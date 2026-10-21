/**
 * PubTator 3 注释：只作为候选来源，最终事实仍由本地数据库核对。
 * 接口：https://www.ncbi.nlm.nih.gov/research/pubtator3-api/publications/export/biocjson
 */
import { httpJson } from './http.mjs'

const API = 'https://www.ncbi.nlm.nih.gov/research/pubtator3-api/publications/export/biocjson'

export function normalizePubtator(data) {
  const docs = Array.isArray(data?.PubTator3) ? data.PubTator3 : []
  const seen = new Set()
  const out = { genes: [], diseases: [], chemicals: [], variants: [], species: [], cells: [] }
  for (const doc of docs) {
    for (const passage of doc?.passages ?? []) {
      for (const a of passage?.annotations ?? []) {
        const inf = a?.infons ?? {}
        const type = String(inf.type ?? '')
        const text = String(a.text ?? '').trim()
        const identifier = String(inf.identifier ?? inf.normalized_id ?? '').trim()
        const name = String(inf.name ?? text).trim()
        if (!text || !type) continue
        const key = `${type}|${identifier}|${text.toLowerCase()}`
        if (seen.has(key)) continue
        seen.add(key)
        const row = { text, name, identifier, database: String(inf.database ?? ''), type }
        if (type === 'Gene') out.genes.push(row)
        else if (type === 'Disease') out.diseases.push(row)
        else if (type === 'Chemical') out.chemicals.push(row)
        else if (/Variant|SNP|Mutation/i.test(type)) out.variants.push(row)
        else if (type === 'Species') out.species.push(row)
        else if (type === 'CellLine') out.cells.push(row)
      }
    }
  }
  return out
}

export async function pubtatorAnnotations(pmid, { refresh = false } = {}) {
  const id = String(pmid ?? '').trim()
  if (!id) return { ok: false, pmid: '', ...normalizePubtator(null), error: '没有 PMID' }
  const url = `${API}?pmids=${encodeURIComponent(id)}`
  const data = await httpJson(url, { cacheTtlMs: 7 * 864e5, bypassCache: refresh })
  return { ok: true, pmid: id, ...normalizePubtator(data) }
}

export function pubtatorHints(pt) {
  return {
    genes: [...new Set((pt?.genes ?? []).map((x) => x.name || x.text).filter(Boolean))],
    diseases: [...new Set((pt?.diseases ?? []).map((x) => x.name || x.text).filter(Boolean))],
    drugs: [...new Set((pt?.chemicals ?? []).map((x) => x.name || x.text).filter(Boolean))],
    variants: [...new Set((pt?.variants ?? []).map((x) => x.identifier || x.text).filter(Boolean))],
  }
}
