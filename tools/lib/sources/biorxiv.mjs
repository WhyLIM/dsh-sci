/**
 * bioRxiv API：按日期区间取预印本，再在本地按标题/摘要过滤。
 * API 没有关键词检索参数；为避免一次抓取整月，最多读取 8 页（约 800 条）。
 */
import { httpJson } from '../http.mjs'
import { cleanAbstract, cleanText, normalizePaper, yearOf, dateOf } from '../normalize.mjs'

const API = 'https://api.biorxiv.org/details/biorxiv'

function queryTerms(q) {
  return [...new Set(String(q ?? '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b(AND|OR|NOT)\b/gi, ' ')
    .replace(/["()]/g, ' ')
    .split(/\s+/).map((x) => x.trim().toLowerCase()).filter((x) => x.length > 2 && !/^\d+$/.test(x)))].slice(0, 12)
}

function scoreRecord(x, terms) {
  const title = String(x.title ?? '').toLowerCase()
  const abstract = String(x.abstract ?? '').toLowerCase()
  const hits = terms.filter((t) => title.includes(t) || abstract.includes(t)).length
  const titleHits = terms.filter((t) => title.includes(t)).length
  return { hits, titleHits }
}

export function parseBiorxivItem(x) {
  const doi = cleanText(x.doi ?? '')
  const version = String(x.version ?? '1')
  const authors = String(x.authors ?? '').split(';').map((n) => ({ name: n.trim() })).filter((a) => a.name)
  const url = doi ? `https://www.biorxiv.org/content/${doi}v${version}` : ''
  return normalizePaper({
    id: `biorxiv:${doi}`,
    doi,
    title: x.title ?? '',
    authors,
    date: dateOf(x.date),
    year: yearOf(x.date),
    venue: 'bioRxiv',
    publisher: 'bioRxiv',
    abstract: cleanAbstract(x.abstract ?? ''),
    url,
    pdfUrl: url ? `${url}.full.pdf` : '',
    htmlUrl: url,
    citations: 0,
    isOA: true,
    type: 'preprint',
    isPreprint: true,
    topics: x.category ? [cleanText(x.category)] : [],
    sources: ['biorxiv'],
  }, 'biorxiv')
}

export async function searchBiorxiv({ query, days = 14, limit = 10, bypassCache = false } = {}) {
  const terms = queryTerms(query)
  if (!terms.length) return { papers: [], source: 'biorxiv', count: 0, total: null, error: null }
  const to = new Date()
  const from = new Date(Date.now() - Math.max(1, days) * 86_400_000)
  const start = from.toISOString().slice(0, 10)
  const end = to.toISOString().slice(0, 10)
  const per = Math.min(100, Math.max(10, Number(limit) || 10))
  const maxPages = 8
  const found = []
  let cursor = 0
  let total = 0
  let pages = 0
  try {
    for (let page = 0; page < maxPages; page++) {
      const d = await httpJson(`${API}/${start}/${end}/${cursor}`, { cacheTtlMs: 60 * 60 * 1000, bypassCache })
      pages += 1
      const msg = Array.isArray(d.messages) ? d.messages[0] : null
      total = Number(msg?.total ?? total) || total
      const collection = Array.isArray(d.collection) ? d.collection : []
      if (!collection.length) break
      for (const x of collection) {
        const { hits, titleHits } = scoreRecord(x, terms)
        if (!hits) continue
        const p = parseBiorxivItem(x)
        if (!p.title) continue
        p.extra = { ...(p.extra ?? {}), biorxivCategory: x.category ?? '', matchedTerms: hits, titleHits }
        found.push(p)
      }
      cursor += collection.length
      if (collection.length < 100 || cursor >= total) break
      if (found.length >= per * 8) break
    }
    found.sort((a, b) => (b.extra?.titleHits ?? 0) - (a.extra?.titleHits ?? 0) || String(b.date).localeCompare(String(a.date)))
    return {
      papers: found.slice(0, per), source: 'biorxiv', count: Math.min(found.length, per), total,
      warning: pages >= maxPages && cursor < total ? `只读取了前 ${pages} 页（${cursor}/${total} 条）` : '',
      error: null,
    }
  } catch (e) {
    return { papers: [], source: 'biorxiv', count: 0, total, error: String(e?.message ?? e) }
  }
}
