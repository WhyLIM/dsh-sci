/**
 * Crossref：期刊 DOI 的权威登记源，元数据稳，但摘要覆盖率一般、且会混入审稿记录。
 * 默认关闭，作为“知道 DOI、但 OpenAlex/Europe PMC 都没收录”时的补充。
 */
import { httpJson } from '../http.mjs'
import { cleanAbstract, cleanText, normalizePaper, dateOf, yearOf } from '../normalize.mjs'
import { normalizeDoi } from '../config.mjs'

const API = 'https://api.crossref.org/works'

function dateParts(x) {
  const p = x?.['date-parts']?.[0]
  if (!Array.isArray(p) || !p.length) return ''
  const [y, m = 1, d = 1] = p
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function authorsOf(list) {
  return (list ?? []).map((a) => ({
    name: cleanText(a.name ?? [a.given, a.family].filter(Boolean).join(' ')),
    affiliations: (a.affiliation ?? []).map((x) => cleanText(x.name ?? '')).filter(Boolean).slice(0, 2),
  })).filter((a) => a.name)
}

function parseItem(w) {
  const doi = normalizeDoi(w.DOI ?? '')
  const date = dateParts(w.published) || dateParts(w['published-print']) || dateParts(w['published-online']) || dateParts(w.issued) || dateParts(w.created)
  const title = Array.isArray(w.title) ? w.title[0] : w.title
  const venue = Array.isArray(w['container-title']) ? w['container-title'][0] : w['container-title']
  const licenses = (w.license ?? []).map((l) => l.URL ?? '').filter(Boolean)
  return normalizePaper({
    id: `doi:${doi}`,
    doi,
    title,
    authors: authorsOf(w.author),
    year: yearOf(date),
    date,
    venue: cleanText(venue ?? ''),
    publisher: cleanText(w.publisher ?? ''),
    abstract: cleanAbstract(w.abstract ?? ''),
    url: doi ? `https://doi.org/${doi}` : (w.URL ?? ''),
    pdfUrl: '',
    htmlUrl: w.URL ?? '',
    citations: w['is-referenced-by-count'] ?? 0,
    issn: Array.isArray(w.ISSN) ? (w.ISSN[0] ?? '') : (w.ISSN ?? ''),
    isOA: licenses.some((u) => /creativecommons\.org|openaccess/i.test(u)),
    license: licenses.join(' '),
    type: /review/i.test((w.type ?? '') + ' ' + String(title ?? '')) ? 'review' : 'article',
    topics: Array.isArray(w.subject) ? w.subject.slice(0, 8) : [],
    sources: ['crossref'],
  }, 'crossref')
}

export async function searchCrossref({
  query,
  days = 14,
  limit = 10,
  email = '',
  bypassCache = false,
} = {}) {
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const params = new URLSearchParams()
  params.set('query.bibliographic', query)
  params.set('filter', `from-pub-date:${from},type:journal-article`)
  params.set('rows', String(Math.min(50, Math.max(1, limit))))
  params.set('select', 'DOI,title,author,container-title,abstract,published,published-print,published-online,issued,created,is-referenced-by-count,URL,license,publisher,type,subject')
  if (email) params.set('mailto', email)
  try {
    const data = await httpJson(`${API}?${params.toString()}`, {
      cacheTtlMs: 6 * 60 * 60 * 1000,
      bypassCache,
    })
    const items = data.message?.items ?? []
    const papers = items
      .map(parseItem)
      .filter((p) => p.title && p.doi && !/^review for/i.test(p.title))
    return { papers, source: 'crossref', count: papers.length, total: data.message?.['total-results'] ?? null, error: null }
  } catch (e) {
    return { papers: [], source: 'crossref', count: 0, total: null, error: String(e?.message ?? e) }
  }
}

export async function getCrossrefByDoi(doi) {
  const d = normalizeDoi(doi)
  const data = await httpJson(`${API}/${encodeURIComponent(d)}`, { cacheTtlMs: 24 * 60 * 60 * 1000 })
  const w = data.message
  if (!w) throw new Error(`Crossref 找不到 DOI：${d}`)
  return parseItem(w)
}
