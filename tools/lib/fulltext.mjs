/**
 * 全文获取与切块。
 *
 * 优先级：Europe PMC 开放全文 XML → 出版社/arXiv HTML → 合法 OA PDF → 只有摘要。
 * 不绕过付费墙，不伪造全文。PDF 文本抽取按平台选择 pdftotext / mutool / macOS PDFKit。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { PATHS, atomicWrite, ensureDataDirs, paperKey } from './config.mjs'
import { httpGet, httpBuffer, assertPublicUrl } from './http.mjs'
import { cleanText, stripTags, clip, titleKey } from './normalize.mjs'
import { getEuropePmcFullTextXml } from './sources/europepmc.mjs'

/* ── Europe PMC XML ─────────────────────────────────────────────────────── */

export function textFromPmcXml(xml) {
  const src = String(xml ?? '')
  const body = (src.match(/<body[^>]*>([\s\S]*?)<\/body>/i) ?? [])[1] ?? src
  const out = []
  const re = /<(title|p|list-item|caption|table-wrap|disp-quote)[^>]*>([\s\S]*?)<\/\1>/gi
  let m
  while ((m = re.exec(body))) {
    const tag = m[1].toLowerCase()
    const inner = m[2]
    let text = stripTags(inner, { block: true }).replace(/\s+/g, ' ').trim()
    if (!text) continue
    if (tag === 'title') out.push(`\n\n## ${text}\n`)
    else if (tag === 'list-item') out.push(`- ${text}`)
    else if (tag === 'caption' || tag === 'table-wrap') out.push(`[图表] ${text}`)
    else out.push(`\n${text}\n`)
  }
  const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return text
}


/* ── JATS tables / figures ──────────────────────────────────────────────── */

function mdCell(x) {
  return cleanText(stripTags(x)).replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()
}

export function tablesFromPmcXml(xml, pmcid = '') {
  const out = []
  const pmc = String(pmcid ?? '').replace(/^PMC/i, '')
  const blocks = [...String(xml ?? '').matchAll(/<table-wrap\b[^>]*>([\s\S]*?)<\/table-wrap>/gi)]
  for (const m of blocks) {
    const inner = m[1]
    const label = cleanText(stripTags((inner.match(/<label[^>]*>([\s\S]*?)<\/label>/i) ?? [])[1] ?? ''))
    const caption = cleanText(stripTags((inner.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i) ?? [])[1] ?? ''))
    const table = (inner.match(/<table\b[^>]*>([\s\S]*?)<\/table>/i) ?? [])[1] ?? ''
    const graphicHref = (inner.match(/<graphic\b[^>]*xlink:href=["']([^"']+)["']/i) ?? [])[1] ?? ''
    const urn = (inner.match(/urn:cdn:blobs\/([^\s?]+)/) ?? [])[1] ?? ''
    const rows = []
    for (const tr of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = []
      for (const cell of tr[1].matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
        const span = Math.max(1, Math.min(8, Number((cell[2].match(/colspan=["']?(\d+)/i) ?? [])[1] ?? 1)))
        const val = mdCell(cell[3])
        cells.push(val)
        for (let i = 1; i < span; i += 1) cells.push('')
      }
      if (cells.length) rows.push(cells)
    }
    let markdown = ''
    if (rows.length) {
      const width = Math.max(...rows.map((r) => r.length))
      const norm = rows.map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill('')])
      markdown = [
        `| ${norm[0].join(' | ')} |`,
        `| ${norm[0].map(() => '---').join(' | ')} |`,
        ...norm.slice(1).map((r) => `| ${r.join(' | ')} |`),
      ].join('\n')
    }
    const remoteUrls = []
    if (urn) remoteUrls.push(`https://cdn.ncbi.nlm.nih.gov/pmc/blobs/${urn}`)
    if (graphicHref && pmc) remoteUrls.push(`https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${pmc}/bin/${graphicHref}`)
    out.push({ label, caption, rows, markdown, imageHref: graphicHref, remoteUrl: remoteUrls[0] ?? '', remoteUrls })
  }
  return out
}

export function figuresFromPmcXml(xml, pmcid = '') {
  const out = []
  const blocks = [...String(xml ?? '').matchAll(/<fig\b[^>]*>([\s\S]*?)<\/fig>/gi)]
  const pmc = String(pmcid ?? '').replace(/^PMC/i, '')
  for (const m of blocks) {
    const inner = m[1]
    const label = cleanText(stripTags((inner.match(/<label[^>]*>([\s\S]*?)<\/label>/i) ?? [])[1] ?? ''))
    const caption = cleanText(stripTags((inner.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i) ?? [])[1] ?? ''))
    const href = (inner.match(/<graphic\b[^>]*xlink:href=["']([^"']+)["']/i) ?? [])[1]
      ?? (inner.match(/<media\b[^>]*xlink:href=["']([^"']+)["']/i) ?? [])[1] ?? ''
    const urn = (inner.match(/urn:cdn:blobs\/([^\s?]+)/) ?? [])[1] ?? ''
    const remoteUrls = []
    if (urn) remoteUrls.push(`https://cdn.ncbi.nlm.nih.gov/pmc/blobs/${urn}`)
    if (href && pmc) remoteUrls.push(`https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${pmc}/bin/${href}`)
    out.push({ label, caption, href, remoteUrl: remoteUrls[0] ?? '', remoteUrls, pmcid: pmc })
  }
  return out
}

export function figuresFromHtml(html, baseUrl = '') {
  const out = []
  const blocks = [...String(html ?? '').matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/gi)]
  for (const m of blocks) {
    const inner = m[1]
    const caption = cleanText(stripTags((inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i) ?? [])[1] ?? ''))
    const src = (inner.match(/<img\b[^>]*src=["']([^"']+)["']/i) ?? [])[1] ?? ''
    let remoteUrl = src
    try { if (src && baseUrl) remoteUrl = new URL(src, baseUrl).toString() } catch {}
    out.push({ label: '', caption, href: src, remoteUrl, pmcid: '' })
  }
  if (!out.length) {
    for (const m of String(html ?? '').matchAll(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi)) {
      const src = m[1]
      if (!/\.(png|jpe?g|webp|gif)(\?|$)/i.test(src)) continue
      let remoteUrl = src
      try { if (baseUrl) remoteUrl = new URL(src, baseUrl).toString() } catch {}
      out.push({ label: '', caption: '', href: src, remoteUrl, pmcid: '' })
    }
  }
  return out.slice(0, 20)
}

/* ── HTML ───────────────────────────────────────────────────────────────── */

export function textFromHtml(html, url = '') {
  let s = String(html ?? '')
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ')
  s = s.replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
  s = s.replace(/<header[\s\S]*?<\/header>/gi, ' ')
  s = s.replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
  s = s.replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
  s = s.replace(/<form[\s\S]*?<\/form>/gi, ' ')
  const article = (s.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ?? [])[1]
    ?? (s.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ?? [])[1]
    ?? s
  const out = []
  const re = /<(h[1-6]|p|li|figcaption|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi
  let m
  while ((m = re.exec(article))) {
    const tag = m[1].toLowerCase()
    let text = stripTags(m[2], { block: true }).replace(/\s+/g, ' ').trim()
    if (!text) continue
    if (text.length < 2) continue
    if (/^(skip to|menu|search|sign in|log in|cookie|share|cite|download pdf|view pdf)$/i.test(text)) continue
    if (tag.startsWith('h')) out.push(`\n\n## ${text}\n`)
    else if (tag === 'li') out.push(`- ${text}`)
    else if (tag === 'figcaption') out.push(`[图注] ${text}`)
    else out.push(`\n${text}\n`)
  }
  let text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (text.length < 500) {
    // 有些页面没有 article/p，退化为整页清洗；至少不要返回空。
    text = stripTags(s, { block: true })
  }
  return text
}

export function titleFromHtml(html) {
  const s = String(html ?? '')
  const meta = (s.match(/<meta[^>]+name=["']citation_title["'][^>]+content=["']([^"']+)["']/i)
    ?? s.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']citation_title["']/i) ?? [])[1]
  if (meta) return cleanText(meta)
  const h1 = (s.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ?? [])[1]
  if (h1) return cleanText(stripTags(h1))
  const t = (s.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1]
  return t ? cleanText(stripTags(t)) : ''
}

/* ── PDF ────────────────────────────────────────────────────────────────── */

function commandExists(cmd) {
  const r = spawnSync(cmd, ['-v'], { encoding: 'utf8', timeout: 4000 })
  return !r.error && r.status !== null
}

function swiftcPath() {
  if (process.platform !== 'darwin') return ''
  for (const c of ['/usr/bin/swiftc', '/usr/bin/swift']) {
    if (fs.existsSync(c)) return c
  }
  const r = spawnSync('xcrun', ['-f', 'swiftc'], { encoding: 'utf8', timeout: 5000 })
  return r.status === 0 ? String(r.stdout).trim() : ''
}

function ensureSwiftPdfText() {
  const bin = path.join(PATHS.bin, 'pdftext')
  const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pdftext.swift')
  const source = path.resolve(src)
  if (!fs.existsSync(source)) return ''
  try {
    if (fs.existsSync(bin) && fs.statSync(bin).mtimeMs >= fs.statSync(source).mtimeMs) return bin
    const swift = swiftcPath()
    if (!swift) return ''
    fs.mkdirSync(PATHS.bin, { recursive: true })
    const env = {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: path.join(PATHS.bin, 'clang'),
      TMPDIR: path.join(PATHS.bin, 'tmp'),
    }
    fs.mkdirSync(env.CLANG_MODULE_CACHE_PATH, { recursive: true })
    fs.mkdirSync(env.TMPDIR, { recursive: true })
    const r = spawnSync(swift, ['-O', source, '-o', bin], { env, encoding: 'utf8', timeout: 90_000 })
    if (r.status !== 0 || !fs.existsSync(bin)) return ''
    return bin
  } catch {
    return ''
  }
}

export function pdfExtractor() {
  if (commandExists('pdftotext')) return { kind: 'pdftotext', cmd: 'pdftotext' }
  if (commandExists('mutool')) return { kind: 'mutool', cmd: 'mutool' }
  const swiftBin = ensureSwiftPdfText()
  if (swiftBin) return { kind: 'pdfkit', cmd: swiftBin }
  return null
}

export function extractPdfText(file) {
  const ex = pdfExtractor()
  if (!ex) throw new Error('没有可用的 PDF 文本抽取器（可安装 poppler 的 pdftotext，或在 macOS 安装 Xcode Command Line Tools）')
  let args
  if (ex.kind === 'pdftotext') args = ['-enc', 'UTF-8', '-nopgbrk', file, '-']
  else if (ex.kind === 'mutool') args = ['draw', '-F', 'txt', '-o', '-', file]
  else args = [file]
  const r = spawnSync(ex.cmd, args, { encoding: 'utf8', timeout: 180_000, maxBuffer: 128 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`PDF 抽取失败：${String(r.stderr ?? '').slice(0, 300)}`)
  return String(r.stdout ?? '')
}

export function cleanPdfText(raw) {
  const pages = String(raw ?? '').split(/\f/)
  const counts = new Map()
  const pageLines = pages.map((p) => p.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()))
  for (const lines of pageLines) {
    const seen = new Set()
    for (const l of lines) {
      if (!l || l.length > 90 || seen.has(l)) continue
      seen.add(l)
      counts.set(l, (counts.get(l) ?? 0) + 1)
    }
  }
  const threshold = Math.max(3, Math.floor(pages.length * 0.5))
  const boiler = new Set([...counts].filter(([, n]) => n >= threshold).map(([l]) => l))
  const kept = []
  for (const lines of pageLines) {
    const out = []
    for (const l of lines) {
      if (!l) { out.push(''); continue }
      if (/^(page\s*)?\d{1,4}$/i.test(l)) continue
      if (boiler.has(l) && !/abstract|introduction|method|result|discussion|conclusion/i.test(l)) continue
      out.push(l)
    }
    kept.push(out.join('\n'))
  }
  let text = kept.join('\n\n')
  text = text.replace(/([A-Za-z])-\n([a-z])/g, '$1$2')
  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

/* ── sections / chunks ──────────────────────────────────────────────────── */

const HEADING_WORDS = [
  'abstract', 'summary', 'introduction', 'background', 'related work', 'literature review',
  'motivation', 'problem statement', 'contributions', 'method', 'methods', 'methodology',
  'materials and methods', 'patients and methods', 'methods and materials', 'study design',
  'study population', 'participants', 'setting', 'interventions', 'main outcome measures',
  'outcomes', 'statistical analysis', 'sensitivity analysis', 'subgroup analysis',
  'approach', 'model', 'architecture', 'experiment', 'experiments',
  'experimental setup', 'evaluation', 'results', 'result', 'analysis', 'ablation',
  'discussion', 'conclusion', 'conclusions', 'limitations', 'future work',
  'references', 'acknowledgements', 'acknowledgments', 'appendix', 'supplementary',
  'data availability', 'code availability', 'author contributions', 'funding',
  'disclosure statement', 'declaration of generative ai use', 'acknowledgments', 'graphical abstract',
]

export function headingInfo(line) {
  const t = String(line ?? '').replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim()
  if (!t || t.length > 140) return null
  const words = t.split(/\s+/)
  const plain = t.replace(/^[\dIVXLC]+(?:\.[\dIVXLC]+)*[.)]?\s+/i, '').replace(/^[（(]\d+[)）]\s*/, '')
  const lower = plain.toLowerCase()
  const endsPunct = /[.!?;,]$/.test(t)
  const startsLower = /^[a-z]/.test(plain)

  // 1) 编号标题：1 Introduction / 2.1. Methods / III. Results
  if (!startsLower && /^\d+(\.\d+)*[.)]?\s+[A-Za-z]/.test(t) && words.length <= 12 && !endsPunct) {
    return { heading: t, key: lower }
  }

  // 2) 已知章节词开头
  const hit = HEADING_WORDS.find((w) => lower === w || lower.startsWith(w + ':') || lower.startsWith(w + ' '))
  if (hit && !startsLower) {
    if (words.length > 10) return null
    if (/[()\[\]]/.test(t) && lower !== hit) return null
    if (/\b(BLEU|FLOPs?|GPU|Table|Figure|Fig\.)\b/i.test(t)) return null
    if (endsPunct && words.length > 3) return null
    const rest = plain.slice(hit.length).trim().replace(/^[:：]\s*/, '')
    if (rest) {
      const first = rest.split(/\s+/)[0]
      const stop = /^(and|of|for|the|in|on|to|with|from|by|a|an)$/i.test(first)
      if (!stop && !/^[A-Z0-9]/.test(first)) return null
    }
    return { heading: t, key: hit }
  }

  // 3) 标题式短行（每个实词首字母大写），避免把表格/句子/作者单位当标题
  const affiliation = /(University|Universit[a-z]*|Institute|Institution|Department|Dept\.?|Laboratory|\bLab\b|College|School of|Hospital|Center for|Centre for|Google|Microsoft|Meta AI|OpenAI|DeepMind|Inc\.?|Corp\.?)/i
  if (!affiliation.test(t) && !startsLower && !endsPunct && !/[0-9[\]{}+=()]/.test(t) && words.length >= 2 && words.length <= 10) {
    const titleCase = words.every((w) => /^[A-Z][a-z0-9-]*$/.test(w)
      || /^(and|of|for|the|in|on|to|with|from|by|a|an|is|are|as)$/i.test(w))
    if (titleCase) return { heading: t, key: lower }
  }

  // 4) 全大写短标题，排除表格行（数字、括号、加号、连字符）
  if (!startsLower && !endsPunct && words.length <= 6 && !/[0-9[\]{}+=]/.test(t) && !t.includes('-')) {
    const letters = t.replace(/[^A-Za-z]/g, '')
    if (letters.length >= 4 && letters === letters.toUpperCase()) return { heading: t, key: lower }
  }
  return null
}

export function splitSections(text) {
  const lines = String(text ?? '').split('\n')
  const sections = []
  let cur = { heading: '正文', key: 'body', lines: [] }
  const push = () => {
    const body = cur.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    if (body.length > 0 || cur.key !== 'body') sections.push({ heading: cur.heading, key: cur.key, text: body })
    cur = { heading: '', key: '', lines: [] }
  }
  for (const line of lines) {
    const h = headingInfo(line)
    if (h) {
      if (cur.lines.some((l) => l.trim())) push()
      cur = { heading: h.heading, key: h.key, lines: [] }
    } else {
      cur.lines.push(line)
    }
  }
  if (cur.lines.some((l) => l.trim()) || !sections.length) push()
  return sections.filter((s) => s.text.length > 0 || !['body', 'references', 'acknowledgements', 'acknowledgments'].includes(s.key))
}

function hardSplit(text, maxChars) {
  const out = []
  let rest = String(text ?? '')
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf('\n\n', maxChars)
    if (cut < maxChars * 0.5) cut = rest.lastIndexOf('. ', maxChars)
    if (cut < maxChars * 0.5) cut = rest.lastIndexOf(' ', maxChars)
    if (cut < maxChars * 0.5) cut = maxChars
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out
}

export function chunkSections(sections, maxChars = 16_000, { includeReferences = false } = {}) {
  sections = sections.filter((s) => includeReferences || s.key !== 'references')
  const chunks = []
  let cur = ''
  const flush = () => {
    if (cur.trim()) chunks.push(cur.trim())
    cur = ''
  }
  for (const sec of sections) {
    const head = `## ${sec.heading}\n\n`
    const pieces = sec.text.length > maxChars ? hardSplit(sec.text, Math.max(2000, maxChars - head.length)) : [sec.text]
    for (const piece of pieces) {
      const block = head + piece.trim() + '\n\n'
      if (cur.length + block.length > maxChars && cur.trim()) flush()
      cur += block
    }
  }
  flush()
  return chunks
}

/**
 * 把一篇论文变成可读的 sections + chunks。
 * @returns {{text:string, sections:Array, chunks:string[], source:string, warnings:string[]}}
 */
function supplementaryFromPmcXml(xml) {
  const out = []
  for (const m of String(xml ?? '').matchAll(/<supplementary-material\b[^>]*xlink:href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/supplementary-material>/gi)) {
    out.push({
      href: m[1],
      caption: cleanText(stripTags((m[2].match(/<caption[^>]*>([\s\S]*?)<\/caption>/i) ?? [])[1] ?? '')),
    })
  }
  return out.slice(0, 20)
}

export async function downloadFigures(paper, figures, { max = 8 } = {}) {
  const key = paper.key ?? paperKey(paper)
  const dir = path.join(PATHS.figures, key)
  fs.mkdirSync(dir, { recursive: true })
  const out = []
  const list = (figures ?? []).slice(0, Math.max(0, max))
  for (let i = 0; i < list.length; i += 1) {
    const f = list[i]
    if (!f.remoteUrl) { out.push({ ...f, path: '', error: '没有图片 URL（只有图注）' }); continue }
    let lastErr = ''
    let saved = ''
    for (const url of (f.remoteUrls?.length ? f.remoteUrls : [f.remoteUrl])) {
      if (!url) continue
      try {
        const buf = await httpBuffer(url, { maxBytes: 25 * 1024 * 1024, timeoutMs: 60_000 })
        const ext = (path.extname(new URL(url).pathname) || '.img').toLowerCase().slice(0, 6)
        const file = path.join(dir, `figure-${String(i + 1).padStart(2, '0')}${ext}`)
        fs.writeFileSync(file, buf)
        saved = file
        break
      } catch (e) { lastErr = String(e?.message ?? e).slice(0, 180) }
    }
    out.push({ ...f, path: saved, error: saved ? '' : lastErr })
  }
  return out
}

export function mdpiPdfCandidates(paper) {
  const doi = String(paper?.doi ?? '').replace(/^https?:\/\/doi\.org\//i, '').trim()
  const m = doi.match(/^10\.3390\/([a-z][a-z0-9-]*?)(\d+)$/i)
  if (!m) return []
  const slug = m[1].toLowerCase()
  const digits = m[2]
  const out = []
  for (const vlen of [1, 2]) {
    if (digits.length < vlen + 3) continue
    const vol = digits.slice(0, vlen).padStart(2, '0')
    const rest = digits.slice(vlen + 2)
    if (!rest) continue
    for (const pad of [4, 5]) {
      const article = rest.padStart(pad, '0')
      const name = `${slug}-${vol}-${article}`
      out.push(`https://mdpi-res.com/d_attachment/${slug}/${name}/article_deploy/${name}.pdf`)
    }
  }
  return [...new Set(out)]
}

export async function buildFullText(paper, {
  refresh = false,
  downloadPdf = true,
  maxChars = 16_000,
  includeReferences = false,
} = {}) {
  ensureDataDirs()
  const key = paper.key ?? paperKey(paper)
  const cacheFile = path.join(PATHS.fulltext, `${key}.txt`)
  const warnings = []
  let text = ''
  let source = ''
  let tables = []
  let figures = []
  let supplementary = []
  const metaFile = path.join(PATHS.fulltext, `${key}.json`)

  if (!refresh && fs.existsSync(cacheFile)) {
    text = fs.readFileSync(cacheFile, 'utf8')
    source = '缓存'
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
      tables = meta.tables ?? []
      figures = meta.figures ?? []
      supplementary = meta.supplementary ?? []
      if (Array.isArray(meta.warnings)) warnings.push(...meta.warnings)
    } catch {}
  }

  if (!text) {
    // 1) Europe PMC 开放全文 XML
    const pmcid = paper.pmcid || paper.extra?.fullTextXml?.match(/PMC(\d+)/)?.[1]
    if (pmcid) {
      try {
        const xml = await getEuropePmcFullTextXml(pmcid)
        text = textFromPmcXml(xml)
        tables = tablesFromPmcXml(xml, pmcid)
        figures = figuresFromPmcXml(xml, pmcid)
        supplementary = supplementaryFromPmcXml(xml)
        source = 'Europe PMC 全文 XML'
      } catch (e) {
        warnings.push(`PMC 全文 XML 获取失败：${clip(e.message, 120)}`)
      }
    }

    // 2) HTML 全文（arXiv / 出版社 OA）
    if (!text && paper.htmlUrl && !/europepmc\.org\/article/i.test(paper.htmlUrl)) {
      try {
        await assertPublicUrl(paper.htmlUrl)
        const res = await httpGet(paper.htmlUrl, {
          timeoutMs: 45_000,
          cacheTtlMs: 0,
          headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' },
        })
        const ct = String(res.headers?.['content-type'] ?? '')
        if (!/html|xml/i.test(ct) || /^\s*[\[{]/.test(res.body)) {
          throw new Error(`不是网页正文（content-type: ${ct || '未知'}）`)
        }
        const t = textFromHtml(res.body, paper.htmlUrl)
        const paywall = /(access through your institution|subscribe to (the )?journal|buy (this )?article|rent this article|log in to read|purchase access|get access to this article)/i
        if (t.length > 1500 && !(paywall.test(t) && t.length < 40_000)) {
          text = t
          figures = figuresFromHtml(res.body, paper.htmlUrl)
          source = 'HTML 全文'
        } else if (paywall.test(t)) {
          warnings.push('网页看起来是付费墙/订阅页，没有当作全文。')
        }
      } catch (e) {
        warnings.push(`HTML 全文获取失败：${clip(e.message, 120)}`)
      }
    }

    // 3) OA PDF
    if (!text && downloadPdf && !paper.pdfUrl && /^10\.3390\//i.test(String(paper.doi ?? ''))) {
      for (const url of mdpiPdfCandidates(paper)) {
        try {
          const buf = await httpBuffer(url, { maxBytes: 80 * 1024 * 1024 })
          const pdfPath = path.join(PATHS.pdfs, `${key}.pdf`)
          fs.writeFileSync(pdfPath, buf)
          text = cleanPdfText(extractPdfText(pdfPath))
          if (text) { source = 'MDPI OA PDF'; paper.pdfUrl = url; break }
        } catch {}
      }
    }
    if (!text && downloadPdf && paper.pdfUrl) {
      try {
        const buf = await httpBuffer(paper.pdfUrl, { maxBytes: 80 * 1024 * 1024 })
        const pdfPath = path.join(PATHS.pdfs, `${key}.pdf`)
        fs.writeFileSync(pdfPath, buf)
        text = cleanPdfText(extractPdfText(pdfPath))
        source = 'OA PDF'
      } catch (e) {
        warnings.push(`PDF 获取/抽取失败：${clip(e.message, 160)}`)
      }
    }

    if (text) {
      atomicWrite(cacheFile, text)
      try { atomicWrite(metaFile, JSON.stringify({ source, tables, figures, supplementary, warnings: [...warnings] }, null, 2) + '\n') } catch {}
    }
  }

  if (!text) {
    warnings.push('没有拿到开放全文；下面只使用题录与摘要。不要凭标题推断结果。')
    text = ''
  }

  const sections = []
  if (paper.abstract) sections.push({ heading: 'Abstract', key: 'abstract', text: paper.abstract })
  if (text) {
    const parsed = splitSections(text)
    const tkey = titleKey(paper.title ?? '')
    // 如果解析出来的只有“正文”一段，仍然保留，至少可切块阅读。
    for (const s of parsed) {
      if (s.key === 'abstract' && paper.abstract) continue
      if (tkey && titleKey(s.heading) === tkey) continue
      sections.push(s)
    }
  }
  if (!sections.length) {
    sections.push({ heading: '（无全文）', key: 'none', text: '没有可读的摘要或全文。请只根据题录信息做最低限度判断，并明确标注“未读全文”。' })
  }

  const hasRefs = sections.some((s) => s.key === 'references')
  if (hasRefs && !includeReferences && !warnings.some((w) => w.includes('References 默认'))) {
    warnings.push('References 默认不放进分段，避免占满上下文；需要时加 --refs。')
  }
  const chunks = chunkSections(sections, maxChars, { includeReferences })
  return { text, sections, chunks, tables, figures, supplementary, source: source || '仅摘要', warnings }
}



/** 本地 PDF：用于用户自己丢进来的文件。 */
export function buildFromPdfFile(paper, file, { maxChars = 16_000, includeReferences = false } = {}) {
  const raw = extractPdfText(file)
  const text = cleanPdfText(raw)
  if (!text) throw new Error('PDF 没有抽出文字（可能是扫描件；本插件不做 OCR）')
  const sections = []
  if (paper.abstract) sections.push({ heading: 'Abstract', key: 'abstract', text: paper.abstract })
  sections.push(...splitSections(text))
  return {
    text,
    sections,
    chunks: chunkSections(sections, maxChars, { includeReferences }),
    tables: [], figures: [], supplementary: [],
    source: '本地 PDF',
    warnings: ['这是本地 PDF；请自己确认你有权阅读。'],
  }
}
