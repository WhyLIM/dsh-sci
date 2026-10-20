/**
 * 组学数据集检索：把 GEO / SRA / ENA / PRIDE / HCA / Metabolomics Workbench 聚合成一个入口。
 * 不是“检索引擎”，只是把同一查询分发到权威库并保留 accession；
 * 日期过滤和 completeness 由各库/调用者显式确认。
 */
import { databaseSearch, databaseGet, detectAccessionDb } from './databases.mjs'

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
