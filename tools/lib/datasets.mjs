/**
 * 组学数据集检索：把 GEO / SRA / ENA / PRIDE / HCA / Metabolomics Workbench 聚合成一个入口。
 * 不是“检索引擎”，只是把同一查询分发到权威库并保留 accession；
 * 日期过滤和 completeness 由各库/调用者显式确认。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { databaseSearch, databaseGet, detectAccessionDb } from './databases.mjs'
import { httpGet, httpJson } from './http.mjs'

const DEFAULT_SOURCES = ['geo', 'sra', 'ena', 'pride', 'hca', 'metabolomics-workbench']

export async function searchDatasets(query, { species = '', sources = DEFAULT_SOURCES, limit = 5 } = {}) {
  const q = String(query ?? '').trim()
  if (!q) throw new Error('dataset search 需要关键词')
  const per = Math.max(1, Math.min(20, Number(limit) || 5))
  const jobs = sources.map(async (db) => {
    try {
      const r = await databaseSearch(db, q, { species, limit: per })
      return { db, ...r }
    } catch (e) { return { db, ok: false, error: String(e?.message ?? e) } }
  })
  const results = await Promise.all(jobs)
  const seen = new Set()
  const items = []
  for (const r of results) {
    for (const item of r.items ?? []) {
      const acc = item.accession || item.id || item.run_accession || item.study_accession || item.projectId || item.study_id || ''
      const key = `${r.db}:${acc || JSON.stringify(item).slice(0, 80)}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({ source: r.db, accession: acc, ...item })
    }
  }
  return {
    ok: true, query: q, species, sources,
    items, bySource: Object.fromEntries(results.map((r) => [r.db, r.ok ? (r.items?.length ?? 0) : 0])),
    errors: results.filter((r) => !r.ok).map((r) => ({ db: r.db, error: r.error })),
    warnings: ['各库的日期/物种/过滤语义不同；结果数量不是 completeness 证明。'],
  }
}

export async function getDataset(accession, opts = {}) {
  const a = detectAccessionDb(accession)
  if (!a) throw new Error('无法识别数据集 accession（GSE/PRJNA/SRR/PXD/E-MTAB/ST...）')
  return databaseGet(a.db, a.id, opts)
}


export async function datasetFiles(accession, { limit = 50 } = {}) {
  const a = detectAccessionDb(accession)
  if (!a) throw new Error('无法识别数据集 accession（GSE/PRJNA/SRR/PXD/E-MTAB/ST...）')
  const per = Math.max(1, Math.min(100, Number(limit) || 50))
  if (a.db === 'pride') {
    const d = await httpJson(`https://www.ebi.ac.uk/pride/ws/archive/v3/projects/${encodeURIComponent(a.id)}/files?page=0&pageSize=${per}`, { cacheTtlMs: 7 * 864e5 })
    const items = (Array.isArray(d) ? d : []).map((x) => ({
      accession: x.accession,
      name: x.fileName ?? x.name ?? '',
      category: x.fileCategory?.value ?? x.fileCategory?.name ?? '',
      locations: (x.publicFileLocations ?? []).map((l) => l.value).filter(Boolean),
    }))
    return { ok: true, accession: a.id, source: 'pride', total: items.length, items }
  }
  if (a.db === 'sra' || a.db === 'ena') {
    const field = /^PRJ/i.test(a.id) ? 'study_accession' : /^SR[RXSPZ]/i.test(a.id) ? 'run_accession' : 'study_accession'
    const q = `${field}="${a.id}"`
    const r = await databaseSearch('ena', q, { action: 'read_run', limit: per })
    const items = (r.items ?? []).map((x) => ({
      run: x.run_accession, study: x.study_accession, experiment: x.experiment_accession,
      fastq: String(x.fastq_ftp ?? '').split(';').filter(Boolean),
      submitted: String(x.submitted_ftp ?? '').split(';').filter(Boolean),
      bytes: x.fastq_bytes ?? '', md5: x.fastq_md5 ?? '',
    }))
    return { ok: r.ok, accession: a.id, source: 'ena', total: items.length, items, error: r.error }
  }
  if (a.db === 'geo') {
    const txt = (await httpGet(`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${encodeURIComponent(a.id)}&targ=self&form=text&view=brief`, { cacheTtlMs: 7 * 864e5 })).body
    const items = [...txt.matchAll(/^!Series_supplementary_file\s*=\s*(.+)$/gm)].map((m) => ({ url: m[1].trim() }))
    return { ok: true, accession: a.id, source: 'geo', total: items.length, items, warnings: ['GEO 只列出 supplementary_file 字段；文件可能很大，未自动下载。'] }
  }
  throw new Error(`dataset files 暂不支持 ${a.db}；可用 GSE/PRJNA/SRR/PXD/E-MTAB`)
}


function httpUrl(raw) {
  const u = String(raw ?? '').trim()
  if (!u || /^prd_ascp@|^fasp:/i.test(u)) return ''
  if (/^ftp:\/\//i.test(u)) return u.replace(/^ftp:\/\//i, 'https://')
  if (/^https?:\/\//i.test(u)) return u
  if (/^[\w.-]+\//.test(u)) return `https://${u}`
  return ''
}

export async function downloadUrl(raw, dest, { maxBytes = 2 * 1024 ** 3, timeoutMs = 30 * 60_000 } = {}) {
  const url = httpUrl(raw)
  if (!url) throw new Error(`不支持的下载地址：${raw}`)
  const file = path.resolve(dest)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const part = `${file}.part`
  const before = fs.existsSync(part) ? fs.statSync(part).size : 0
  if (before > maxBytes) throw new Error(`已有部分文件超过 max-bytes：${before}`)
  const headers = before ? { range: `bytes=${before}-` } : {}
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  let res
  try {
    res = await fetch(url, { headers, signal: ac.signal })
  } catch (e) {
    clearTimeout(timer)
    throw e
  }
  if (!res.ok && res.status !== 206) { clearTimeout(timer); throw new Error(`HTTP ${res.status} ${url}`) }
  if (before && res.status !== 206) {
    fs.rmSync(part, { force: true })
  }
  const total = Number(res.headers.get('content-length') ?? 0) + (res.status === 206 ? before : 0)
  if (maxBytes && total > maxBytes) { clearTimeout(timer); throw new Error(`文件 ${total} 字节超过 max-bytes ${maxBytes}`) }
  const out = fs.createWriteStream(part, { flags: res.status === 206 ? 'a' : 'w' })
  const hash = crypto.createHash('sha256')
  if (res.status === 206 && before) {
    const old = fs.createReadStream(part, { start: 0, end: before - 1 })
    for await (const chunk of old) hash.update(chunk)
  }
  try {
    for await (const chunk of res.body) {
      hash.update(chunk)
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
    }
    await new Promise((resolve, reject) => out.end((err) => err ? reject(err) : resolve()))
  } finally {
    clearTimeout(timer)
  }
  fs.renameSync(part, file)
  const sha256 = hash.digest('hex')
  fs.writeFileSync(`${file}.sha256`, `${sha256}  ${path.basename(file)}\n`)
  return { url, path: file, bytes: fs.statSync(file).size, sha256, resumed: Boolean(before && res.status === 206) }
}

function fileUrls(r) {
  const out = []
  for (const x of r.items ?? []) {
    for (const u of [x.url, ...(x.fastq ?? []), ...(x.submitted ?? []), ...(x.locations ?? [])]) {
      if (u && httpUrl(u)) out.push(u)
    }
  }
  return [...new Set(out)]
}

export async function downloadDataset(accession, { outDir = '', limit = 10, maxBytes = 2 * 1024 ** 3, yes = false } = {}) {
  const r = await datasetFiles(accession, { limit })
  const urls = fileUrls(r).slice(0, Math.max(1, Math.min(100, Number(limit) || 10)))
  const dir = path.resolve(outDir || path.join(process.env.DSH_SCI_HOME || path.join(process.env.HOME || '.', '.dsh', 'sci'), 'downloads', String(accession).replace(/[^A-Za-z0-9_.-]/g, '_')))
  if (!yes) return { ok: true, dryRun: true, accession: r.accession, source: r.source, outDir: dir, urls, total: urls.length }
  const items = []
  for (const [i, url] of urls.entries()) {
    const name = `${String(i + 1).padStart(2, '0')}-${path.basename(new URL(url).pathname) || 'file'}`
    try {
      const x = await downloadUrl(url, path.join(dir, name), { maxBytes })
      items.push({ ok: true, ...x })
    } catch (e) {
      items.push({ ok: false, url, error: String(e?.message ?? e) })
    }
  }
  return { ok: items.every((x) => x.ok), accession: r.accession, source: r.source, outDir: dir, items }
}
