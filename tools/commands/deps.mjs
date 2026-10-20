/**
 * 体检：先确认“能不能安全地检索/读全文”，再开始干活。
 * 退出码：0 = 核心可用；1 = 核心不可用（检索源全挂/数据目录不可写）；2 = 部分源失败。
 */
import fs from 'node:fs'
import path from 'node:path'
import { PATHS, CFG_FILE, readConfig, readSecrets, secretState, emailFor, ensureDataDirs, outputPaths } from '../lib/config.mjs'
import { httpJson, probe } from '../lib/http.mjs'
import { pdfExtractor } from '../lib/fulltext.mjs'

export async function run({ values }) {
  const cfg = readConfig()
  const secrets = readSecrets()
  ensureDataDirs()
  const items = []
  const add = (name, ok, detail, fix = '') => items.push({ name, ok, detail, ...(fix ? { fix } : {}) })

  const major = Number(process.versions.node.split('.')[0])
  add('Node.js', major >= 20, `v${process.versions.node}（需要 ≥20，原生 fetch / parseArgs）`, major < 20 ? '升级 Node.js' : '')

  let writable = false
  try {
    const probeFile = path.join(PATHS.home, `.write-probe-${process.pid}`)
    fs.writeFileSync(probeFile, 'ok')
    fs.unlinkSync(probeFile)
    writable = true
  } catch {}
  add('数据目录', writable, writable ? PATHS.home : `不可写：${PATHS.home}`, writable ? '' : '检查目录权限，或设置 DSH_HOME')

  let outputWritable = false
  const out = outputPaths(cfg)
  try {
    fs.mkdirSync(out.root, { recursive: true })
    const probeFile = path.join(out.root, `.write-probe-${process.pid}`)
    fs.writeFileSync(probeFile, 'ok')
    fs.unlinkSync(probeFile)
    outputWritable = true
  } catch {}
  add('输出目录', outputWritable, outputWritable ? out.root : `不可写：${out.root}`, outputWritable ? '' : '在设置里换成可写目录')

  let cfgOk = true
  try { fs.accessSync(CFG_FILE, fs.constants.R_OK) } catch { cfgOk = false }
  add('配置', true, cfgOk ? '已找到 sci.config.json' : '还没有配置文件，使用默认配置（在设置页保存一次即可）')

  try {
    const ex = pdfExtractor()
    add('PDF 抽取', Boolean(ex), ex ? `${ex.kind}（${ex.cmd}）` : '没有 pdftotext / mutool / PDFKit 可用',
      ex ? '' : 'macOS 安装 Xcode Command Line Tools；或安装 poppler 的 pdftotext。没有它仍可读 PMC/HTML 全文。')
  } catch (e) {
    add('PDF 抽取', false, String(e.message).slice(0, 200))
  }

  try {
    const st = fs.statfsSync(PATHS.home)
    const free = st.bavail * st.bsize
    add('磁盘空间', free > 200 * 1024 * 1024, `${(free / 1e9).toFixed(1)} GB 可用`, free > 200 * 1024 * 1024 ? '' : '清理磁盘后再下载 PDF')
  } catch {}

  const probes = []
  if (cfg.sources.openalex) {
    probes.push((async () => {
      try {
        const p = new URLSearchParams({ select: 'id', per_page: '1' })
        const mail = emailFor('openalex', cfg, secrets)
        if (mail) p.set('mailto', mail)
        if (secrets.openalexApiKey) p.set('api_key', secrets.openalexApiKey)
        const data = await httpJson(`https://api.openalex.org/works?${p.toString()}`, { timeoutMs: 15_000, cacheTtlMs: 0 })
        add('OpenAlex', Array.isArray(data.results), `${data.results?.length ?? 0} 条探测结果${secrets.openalexApiKey ? '（带 API key）' : '（无 API key，共享额度）'}`,
          secrets.openalexApiKey ? '' : '免费额度用完时在设置页填 OpenAlex API key')
      } catch (e) {
        add('OpenAlex', false, String(e.message).slice(0, 220), '可在设置页关闭 OpenAlex，或申请免费 key')
      }
    })())
  } else add('OpenAlex', true, '未启用')

  if (cfg.sources.arxiv) {
    probes.push((async () => {
      try {
        const r = await probe('https://export.arxiv.org/api/query?search_query=all:test&max_results=1', 20_000)
        add('arXiv', r.ok, r.ok ? `HTTP ${r.status}` : `HTTP ${r.status}`, r.ok ? '' : '检查网络；arXiv 有 3 秒/请求的礼貌限制')
      } catch (e) {
        add('arXiv', false, String(e.message).slice(0, 200))
      }
    })())
  } else add('arXiv', true, '未启用')

  if (cfg.sources.europepmc) {
    probes.push((async () => {
      try {
        const data = await httpJson('https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=test&format=json&pageSize=1', { timeoutMs: 15_000, cacheTtlMs: 0 })
        add('Europe PMC', data.hitCount != null, `命中 ${data.hitCount ?? '?'} 条（探测）`)
      } catch (e) {
        add('Europe PMC', false, String(e.message).slice(0, 200))
      }
    })())
  } else add('Europe PMC', true, '未启用')

  if (cfg.sources.pubmed) {
    probes.push((async () => {
      try {
        const p = new URLSearchParams({ db: 'pubmed', term: 'test', retmode: 'json', retmax: '1', tool: 'dsh-sci' })
        const mail = emailFor('pubmed', cfg, secrets)
        if (mail) p.set('email', mail)
        const key = process.env.NCBI_API_KEY || secrets.ncbiApiKey
        if (key) p.set('api_key', key)
        const data = await httpJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${p.toString()}`, { timeoutMs: 15_000, cacheTtlMs: 0 })
        add('PubMed', Boolean(data.esearchresult), `命中 ${data.esearchresult?.count ?? '?'} 条（探测）${key ? ' · 带 API key（10 请求/秒）' : ' · 无 key（3 请求/秒）'}`,
          key ? '' : '可在设置页 PubMed 卡片配置 NCBI API key 提升频率')
      } catch (e) {
        add('PubMed', false, String(e.message).slice(0, 200), '检查网络；NCBI 需要 tool/email')
      }
    })())
  } else add('PubMed', true, '未启用')

  if (cfg.sources.clinicaltrials) {
    probes.push((async () => {
      try {
        const data = await httpJson('https://clinicaltrials.gov/api/v2/studies?query.term=test&pageSize=1', { timeoutMs: 15_000, cacheTtlMs: 0 })
        add('ClinicalTrials.gov', Array.isArray(data.studies), `${data.studies?.length ?? 0} 条探测结果`)
      } catch (e) {
        add('ClinicalTrials.gov', false, String(e.message).slice(0, 200))
      }
    })())
  } else add('ClinicalTrials.gov', true, '未启用')

  if (cfg.sources.crossref) {
    probes.push((async () => {
      try {
        const data = await httpJson('https://api.crossref.org/works?rows=1&select=DOI', { timeoutMs: 15_000, cacheTtlMs: 0 })
        add('Crossref', Boolean(data.message), '元数据接口可用')
      } catch (e) {
        add('Crossref', false, String(e.message).slice(0, 200))
      }
    })())
  } else add('Crossref', true, '未启用')

  await Promise.allSettled(probes)

  const email = emailFor('unpaywall', cfg, secrets)
  if (email) {
    try {
      const u = await httpJson(`https://api.unpaywall.org/v2/10.1038/nature12373?email=${encodeURIComponent(email)}`, { timeoutMs: 15_000, cacheTtlMs: 0 })
      add('Unpaywall', Boolean(u.doi), u.is_oa ? 'OA 解析可用（探测到开放版本）' : '接口可用（探测论文非 OA）')
    } catch (e) {
      add('Unpaywall', false, String(e.message).slice(0, 180), '检查设置里的联系邮箱')
    }
  } else {
    add('Unpaywall', true, '未配置邮箱，跳过（只影响 DOI 的 OA 链接解析）', '在设置页填联系邮箱可提升 OA 命中率')
  }

  const secretsState = secretState()
  add('API key', true, `OpenAlex: ${secretsState.openalexApiKey ? '已设置' : '未设置'} · Unpaywall 邮箱: ${secretsState.unpaywallEmail ? '已设置' : '未设置'}`)

  const core = items.filter((i) => ['Node.js', '数据目录', '输出目录'].includes(i.name))
  const sources = items.filter((i) => ['OpenAlex', 'arXiv', 'Europe PMC', 'PubMed', 'Crossref', 'ClinicalTrials.gov'].includes(i.name))
  const configured = sources.filter((i) => i.detail !== '未启用')
  const coreOk = core.every((i) => i.ok)
  const anySource = configured.some((i) => i.ok)
  const allSources = configured.length > 0 && configured.every((i) => i.ok)
  const ok = coreOk && anySource
  const result = { ok, coreOk, anySource, allSources, generatedAt: new Date().toISOString(), dataDir: PATHS.home, items }
  if (values.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  } else {
    console.log(`dsh-sci 体检 · ${ok ? '可用' : '核心不可用'}\n`)
    for (const i of items) console.log(`${i.ok ? '✓' : '✗'} ${i.name}：${i.detail}${i.fix ? `\n    → ${i.fix}` : ''}`)
    console.log(`\n数据目录：${PATHS.home}`)
  }
  return ok ? (allSources ? 0 : 2) : 1
}
