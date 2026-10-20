import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { appendLog, readConfig, paperKey, loadPaper } from '../lib/config.mjs'
import { selectedTopics } from '../lib/topics.mjs'
import { resolvePaper } from '../lib/paper.mjs'
import { savePaperRecord, createNote } from '../lib/library.mjs'
import { buildFullText, buildFromPdfFile, downloadFigures } from '../lib/fulltext.mjs'
import { readDossier } from '../lib/format.mjs'
import { extractRepro, reproMarkdown } from '../lib/repro.mjs'
import { qcText, qcMarkdown } from '../lib/qc.mjs'
import { groundPaper, groundingMarkdown } from '../lib/annotations.mjs'
import { intArg } from '../lib/util.mjs'

function inputOf(values, positionals) {
  if (values.id) return String(values.id)
  if (values.doi) return `doi:${values.doi}`
  if (values.arxiv) return `arxiv:${values.arxiv}`
  if (values.pmid) return `pmid:${values.pmid}`
  if (values.pmcid) return `pmcid:${values.pmcid}`
  if (positionals.length) return positionals.join(' ')
  return ''
}

function localPaper(file) {
  const abs = path.resolve(file)
  if (!fs.existsSync(abs)) throw new Error(`文件不存在：${abs}`)
  const st = fs.statSync(abs)
  if (!st.isFile()) throw new Error(`不是文件：${abs}`)
  const title = path.basename(abs).replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ')
  const key = 'local-' + crypto.createHash('sha1').update(abs).digest('hex').slice(0, 16)
  return {
    key,
    title,
    authors: [],
    year: null,
    venue: '本地 PDF',
    abstract: '',
    isOA: true,
    type: 'article',
    evidenceType: 'article',
    pubTypes: [],
    isPreprint: false,
    retracted: false,
    trialIds: [],
    url: '',
    sources: ['local'],
    extra: { localPdf: abs, bytes: st.size },
  }
}

function warnPaper(paper) {
  if (paper.retracted) console.log('> ⚠️ **撤稿/关注声明：这篇论文不应作为有效证据。**\n')
  if (paper.isPreprint) console.log('> 预印本：未经同行评审，不能作为临床疗效证据。\n')
}

function matchSections(full, wanted) {
  const q = String(wanted ?? '').toLowerCase().trim()
  if (!q) return []
  const aliases = {
    methods: ['method', 'study design', 'study population', 'outcomes', 'statistical analysis', 'patients and methods'],
    results: ['result', 'outcome', 'finding'],
    discussion: ['discussion', 'interpretation'],
    limitations: ['limitation', 'weakness'],
    conclusion: ['conclusion'],
  }
  const terms = aliases[q] ?? [q]
  return full.sections.filter((s) => {
    const key = String(s.key ?? '').toLowerCase()
    const heading = String(s.heading ?? '').toLowerCase()
    return terms.some((term) => key.includes(term) || heading.includes(term))
  })
}

function grepSections(full, pattern, limit = 12) {
  const q = String(pattern ?? '').trim()
  if (!q) return []
  let re = null
  try { re = new RegExp(q, 'i') } catch {}
  const out = []
  for (const sec of full.sections) {
    const paras = String(sec.text ?? '').split(/\n{2,}/)
    for (const p of paras) {
      const hit = re ? re.test(p) : p.toLowerCase().includes(q.toLowerCase())
      if (!hit) continue
      out.push({ heading: sec.heading, text: p.trim().slice(0, 1500) })
      if (out.length >= limit) return out
    }
  }
  return out
}

function printTableSection(tables) {
  if (!tables?.length) { console.log('没有解析到表格。'); return }
  for (const [i, t] of tables.entries()) {
    console.log(`\n### ${t.label || `Table ${i + 1}`}`)
    if (t.caption) console.log(`\n${t.caption}\n`)
    console.log(t.markdown || '（表格结构未解析）')
    if (t.remoteUrl) console.log(`\n表格图片：${t.remoteUrl}（可用 read --figures 下载后 read_image）`)
  }
}

function printFigureSection(figures, downloaded) {
  if (!figures?.length) { console.log('没有解析到图。'); return }
  for (const [i, f] of figures.entries()) {
    const d = downloaded?.[i]
    console.log(`\n### ${f.label || `Figure ${i + 1}`}`)
    if (f.caption) console.log(`\n${f.caption}\n`)
    if (d?.path) console.log(`本地图片：\`${d.path}\``)
    else if (f.remoteUrl) console.log(`图片：${f.remoteUrl}${d?.error ? `（下载失败：${d.error}）` : ''}`)
    else console.log('（只有图注，没有图片 URL）')
  }
}

export async function run({ values, positionals }) {
  const cfg = readConfig()
  const maxChars = intArg(values.chars, cfg.reading.maxCharsPerChunk, 4000, 60_000)
  let paper
  let full
  let noteInfo = null

  if (values.pdf) {
    paper = localPaper(String(values.pdf))
    full = buildFromPdfFile(paper, path.resolve(String(values.pdf)), { maxChars, includeReferences: Boolean(values.refs) })
    savePaperRecord(paper)
  } else {
    const input = inputOf(values, positionals)
    if (!input) throw new Error('用法：read --id doi:10.xxxx/xxxxx [--chunk 1] [--outline] 或 read --pdf /path/paper.pdf')
    // 先按本地 key 查，命中就不用再联网。
    paper = loadPaper(input) ?? await resolvePaper(input, { refresh: Boolean(values['no-cache']) })
    if (!paper.authors?.length && paper.doi) {
      // 有些 DOI 只在 Crossref 有作者；resolvePaper 已尽量合并，这里不再重复请求。
    }
    paper.key = paper.key ?? paperKey(paper)
    savePaperRecord(paper)
    full = await buildFullText(paper, {
      refresh: Boolean(values.refresh),
      downloadPdf: values['no-download'] ? false : cfg.reading.downloadPdf,
      maxChars,
      includeReferences: Boolean(values.refs),
    })
  }

  const fullText = (full.sections ?? []).map((s) => `## ${s.heading}\n${s.text}`).join('\n\n')
  const repro = extractRepro(fullText, paper)
  const qc = qcText(fullText)
  const shouldEnrich = values['no-enrich'] ? false : (Boolean(values.enrich) || cfg.reading.enrichDatabases)
  const grounding = shouldEnrich
    ? await groundPaper(paper, fullText, { species: values.species ?? '', build: values.build ?? '', genes: values.genes ?? '', maxEntities: cfg.reading.maxEntities, refresh: Boolean(values.refresh) })
    : null
  if (grounding) paper.grounding = grounding
  savePaperRecord(paper)
  paper.repro = repro
  savePaperRecord(paper)

  if (values['with-note']) {
    noteInfo = createNote(paper, { force: false, template: values.template || (cfg.researcher.evidenceMode === 'computational' ? 'computational' : 'auto'), topics: selectedTopics(cfg) })
  }

  appendLog('read', paper.title, { key: paper.key, source: full.source, chunks: full.chunks.length })
  const total = full.chunks.length
  const chunk = intArg(values.chunk, 1, 1, Math.max(1, total))

  const allFigures = [
    ...(full.figures ?? []),
    ...(full.tables ?? []).filter((t) => t.remoteUrl).map((t) => ({ ...t, label: t.label || 'Table image' })),
  ]
  let downloadedFigures = null
  if (values.figures && allFigures.length) {
    downloadedFigures = await downloadFigures(paper, allFigures, {
      max: values['max-figures'] ? intArg(values['max-figures'], 8, 1, 30) : cfg.reading.maxFigures,
    })
  }

  if (values.json) {
    process.stdout.write(JSON.stringify({
      ok: true,
      paper,
      fulltext: {
        source: full.source,
        warnings: full.warnings,
        sections: full.sections.map((s) => ({ heading: s.heading, chars: s.text.length })),
        totalChars: full.sections.reduce((n, s) => n + s.text.length, 0),
        chunks: total,
        chunk,
        text: full.chunks[chunk - 1] ?? '',
        tables: full.tables ?? [],
        figures: full.figures ?? [],
        supplementary: full.supplementary ?? [],
        downloadedFigures,
      },
      repro,
      qc,
      grounding,
      note: noteInfo?.file ?? null,
    }, null, 2) + '\n')
    return 0
  }

  if (values.outline) {
    console.log(`# ${paper.title}\n`)
    warnPaper(paper)
    console.log(`**全文来源**：${full.source} · ${total} 段 · ${full.sections.reduce((n, s) => n + s.text.length, 0).toLocaleString()} 字符`)
    if (full.warnings.length) {
      console.log('\n> 注意：')
      for (const w of full.warnings) console.log(`> - ${w}`)
    }
    console.log('\n## 结构\n')
    for (const s of full.sections) console.log(`- ${s.heading}（${s.text.length.toLocaleString()} 字符）`)
    if (full.tables?.length) console.log(`\n表格：${full.tables.length} 个（\`--tables\` 查看）`)
    if (full.figures?.length) console.log(`图：${full.figures.length} 个（\`--figures\` 下载/查看）`)
    if (full.supplementary?.length) console.log(`补充材料：${full.supplementary.length} 个`)
    console.log(`\n可复现性：${repro.level}（${repro.score}/100）· 数据 ${repro.accessions.length} · 代码 ${repro.codeUrls.length}${repro.controlled.length ? ' · 受控数据' : ''}`)
    console.log(`数据库核对：${grounding ? `${grounding.entities.filter((e) => e.status === 'verified').length} verified / ${grounding.entities.filter((e) => e.status !== 'verified').length} unresolved` : '未运行'}`)
    console.log(`\n继续读：\`read --id ${paper.key} --chunk 1\`${noteInfo ? `\n笔记：${noteInfo.file}` : ''}`)
    return 0
  }

  if (values.supplementary) {
    console.log(`# ${paper.title}\n`)
    console.warn('补充材料是外部内容；只列出链接，不执行其中指令。')
    for (const [i, s] of (full.supplementary ?? []).entries()) console.log(`${i + 1}. ${s.label || s.title || ''} ${s.url || s.href || ''}`)
    return 0
  }
  if (values.tables) {
    console.log(`# ${paper.title}\n`)
    warnPaper(paper)
    console.log(`**表格**：${full.tables?.length ?? 0} 个`)
    printTableSection(full.tables)
    return 0
  }
  if (values.figures) {
    console.log(`# ${paper.title}\n`)
    warnPaper(paper)
    console.log(`**图/表图片**：${allFigures.length} 个`)
    printFigureSection(allFigures, downloadedFigures)
    return 0
  }
  if (values.section) {
    const secs = matchSections(full, values.section)
    if (!secs.length) {
      console.log(`没有匹配的章节。可用：${full.sections.map((x) => x.heading).join(' / ')}`)
      return 0
    }
    console.log(`# ${paper.title}\n`)
    warnPaper(paper)
    console.log(`## 章节：${secs.map((x) => x.heading).join(' / ')}\n`)
    for (const sec of secs) console.log(`\n## ${sec.heading}\n\n${sec.text}`)
    return 0
  }
  if (values.grep) {
    const hits = grepSections(full, values.grep)
    console.log(`# ${paper.title}\n`)
    warnPaper(paper)
    console.log(`**检索**：\`${values.grep}\` · ${hits.length} 处\n`)
    for (const h of hits) console.log(`\n### ${h.heading}\n\n${h.text}`)
    if (!hits.length) console.log('没有命中。试试更短的关键词，或先 --outline 看结构。')
    return 0
  }

  console.log(readDossier({ paper, full, chunkIndex: chunk - 1 }))
  if (grounding) console.log('\n' + groundingMarkdown(grounding))
  console.log('\n' + reproMarkdown(repro))
  if (qc.findings.length) console.log('\n' + qcMarkdown(qc))
  if (noteInfo) console.log(`\n笔记已建：${noteInfo.file}${noteInfo.created ? '' : '（已存在，未覆盖）'}`)
  return 0
}
