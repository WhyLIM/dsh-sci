/**
 * OpenAlex：覆盖最广的开放题录源。
 *
 * 2026 年起 OpenAlex 对无 key 的请求按出口 IP 共享每日预算；因此：
 *   - 支持 sources.email / secrets.openalexApiKey；
 *   - 失败时不拖垮整轮扫描，其他源继续；
 *   - 错误信息里直接给出“去申请免费 key”的动作。
 */
import { httpJson } from '../http.mjs'
import { normalizePaper, invertedToText, yearOf } from '../normalize.mjs'

const API = 'https://api.openalex.org/works'

export async function searchOpenAlex({
  query,
  days = 14,
  limit = 10,
  oaOnly = true,
  apiKey = '',
  email = '',
  bypassCache = false,
} = {}) {
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const params = new URLSearchParams()
  params.set('search', query)
  const filters = [`from_publication_date:${from}`]
  if (oaOnly) filters.push('is_oa:true')
  params.set('filter', filters.join(','))
  params.set('per_page', String(Math.min(50, Math.max(1, limit))))
  params.set('sort', 'relevance_score:desc')
  params.set('select', [
    'id', 'doi', 'title', 'publication_year', 'publication_date', 'authorships',
    'primary_location', 'open_access', 'best_oa_location', 'cited_by_count',
    'type', 'abstract_inverted_index', 'primary_topic', 'referenced_works_count', 'is_retracted',
  ].join(','))
  if (email) params.set('mailto', email)
  if (apiKey) params.set('api_key', apiKey)

  try {
    const data = await httpJson(`${API}?${params.toString()}`, {
      cacheTtlMs: 60 * 60 * 1000,
      bypassCache,
    })
    const papers = (data.results ?? []).map((w) => {
      const loc = w.best_oa_location ?? w.primary_location ?? {}
      const src = w.primary_location?.source ?? {}
      const date = w.publication_date ?? ''
      return normalizePaper({
        id: String(w.id ?? '').replace('https://openalex.org/', ''),
        doi: w.doi ?? '',
        title: w.title ?? '',
        authors: w.authorships ?? [],
        year: w.publication_year ?? yearOf(date),
        date,
        venue: src.display_name ?? '',
        publisher: src.host_organization_name ?? '',
        abstract: invertedToText(w.abstract_inverted_index),
        url: loc.landing_page_url ?? (w.doi ? String(w.doi).replace('https://doi.org/', 'https://doi.org/') : ''),
        pdfUrl: loc.pdf_url ?? '',
        htmlUrl: loc.landing_page_url ?? '',
        citations: w.cited_by_count ?? 0,
        isOA: Boolean(w.open_access?.is_oa ?? loc.is_oa),
        license: loc.license ?? w.open_access?.oa_status ?? '',
        type: w.type ?? '',
        retracted: Boolean(w.is_retracted),
        issn: src.issn_l ?? '',
        topics: w.primary_topic?.display_name ? [w.primary_topic.display_name] : [],
        sources: ['openalex'],
      }, 'openalex')
    })
    return {
      papers,
      source: 'openalex',
      count: papers.length,
      total: data.meta?.count ?? null,
      notice: data.meta?.notice ?? '',
      error: null,
    }
  } catch (e) {
    const msg = String(e?.message ?? e)
    let hint = ''
    if (/401|403|budget|quota|cost|api.?key/i.test(msg)) {
      hint = 'OpenAlex 免费额度用完了：在设置里填 OpenAlex API key（免费申请：https://openalex.org/settings/api），或先关掉 OpenAlex、用 arXiv + Europe PMC。'
    }
    return { papers: [], source: 'openalex', count: 0, total: null, error: msg, hint }
  }
}

export async function getOpenAlexWork(id) {
  const url = id.startsWith('http') ? id : `https://api.openalex.org/works/${encodeURIComponent(id)}`
  const w = await httpJson(url, { cacheTtlMs: 12 * 60 * 60 * 1000 })
  const loc = w.best_oa_location ?? w.primary_location ?? {}
  return normalizePaper({
    id: String(w.id ?? '').replace('https://openalex.org/', ''),
    doi: w.doi ?? '',
    title: w.title ?? '',
    authors: w.authorships ?? [],
    year: w.publication_year,
    date: w.publication_date,
    venue: w.primary_location?.source?.display_name ?? '',
    publisher: w.primary_location?.source?.host_organization_name ?? '',
    abstract: invertedToText(w.abstract_inverted_index),
    url: loc.landing_page_url ?? w.doi ?? '',
    pdfUrl: loc.pdf_url ?? '',
    htmlUrl: loc.landing_page_url ?? '',
    citations: w.cited_by_count ?? 0,
    isOA: Boolean(w.open_access?.is_oa ?? loc.is_oa),
    license: loc.license ?? w.open_access?.oa_status ?? '',
    type: w.type ?? '',
    retracted: Boolean(w.is_retracted),
    issn: w.primary_location?.source?.issn_l ?? '',
    topics: w.primary_topic?.display_name ? [w.primary_topic.display_name] : [],
    sources: ['openalex'],
  }, 'openalex')
}


export async function getOpenAlexByDoi(doi) {
  const params = new URLSearchParams({ filter: `doi:${doi}`, per_page: '1' })
  const data = await httpJson(`https://api.openalex.org/works?${params.toString()}`, {
    cacheTtlMs: 24 * 60 * 60 * 1000,
  })
  const w = data.results?.[0]
  if (!w) throw new Error(`OpenAlex 找不到 DOI：${doi}`)
  const loc = w.best_oa_location ?? w.primary_location ?? {}
  return normalizePaper({
    id: String(w.id ?? '').replace('https://openalex.org/', ''),
    doi: w.doi ?? '',
    title: w.title ?? '',
    authors: w.authorships ?? [],
    year: w.publication_year,
    date: w.publication_date,
    venue: w.primary_location?.source?.display_name ?? '',
    publisher: w.primary_location?.source?.host_organization_name ?? '',
    abstract: invertedToText(w.abstract_inverted_index),
    url: loc.landing_page_url ?? w.doi ?? '',
    pdfUrl: loc.pdf_url ?? '',
    htmlUrl: loc.landing_page_url ?? '',
    citations: w.cited_by_count ?? 0,
    isOA: Boolean(w.open_access?.is_oa ?? loc.is_oa),
    license: loc.license ?? w.open_access?.oa_status ?? '',
    type: w.type ?? '',
    retracted: Boolean(w.is_retracted),
    issn: w.primary_location?.source?.issn_l ?? '',
    topics: w.primary_topic?.display_name ? [w.primary_topic.display_name] : [],
    sources: ['openalex'],
  }, 'openalex')
}
