/**
 * arXiv Atom API：预印本的首选源。
 * 只使用公开 API，不抓网页；限速由 http.mjs 统一处理（3.2s/请求）。
 */
import { httpGet } from '../http.mjs'
import { cleanAbstract, cleanText, normalizePaper, normalizeAuthors, yearOf, dateOf } from '../normalize.mjs'
import { normalizeArxiv } from '../config.mjs'

const API = 'https://export.arxiv.org/api/query'

function xml(text, tag) {
  const m = String(text).match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return m ? cleanText(m[1]) : ''
}

function allXml(text, tag) {
  const out = []
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi')
  let m
  while ((m = re.exec(String(text)))) out.push(m[1])
  return out
}

function queryFor(q) {
  const s = String(q ?? '').trim()
  if (!s) return 'all:science'
  if (/\b(all|ti|abs|au|cat|co|jr|rn|id):/i.test(s) || /\b(AND|OR|ANDNOT)\b/.test(s)) return s
  // 多词查询按短语处理，避免 arXiv 把常用词拆散后召回大量噪声。
  return `all:"${s.replace(/"/g, '')}"`
}

function parseEntry(entry) {
  const idRaw = xml(entry, 'id')
  const arxivId = normalizeArxiv(idRaw)
  const title = xml(entry, 'title').replace(/\s+/g, ' ')
  const summary = cleanAbstract(xml(entry, 'summary'))
  const published = xml(entry, 'published')
  const updated = xml(entry, 'updated')
  const authors = allXml(entry, 'author').map((a) => ({ name: xml(a, 'name') })).filter((a) => a.name)
  const doi = xml(entry, 'arxiv:doi') || xml(entry, 'doi')
  const journalRef = xml(entry, 'arxiv:journal_ref') || xml(entry, 'journal_ref')
  const category = xml(entry, 'arxiv:primary_category') || ''
  const links = [...String(entry).matchAll(/<link\b[^>]*>/gi)].map((m) => m[0])
  const pdfTag = links.find((l) => /title=["']pdf["']/i.test(l)) ?? links.find((l) => /\/pdf\//.test(l)) ?? ''
  const pdfUrl = (pdfTag.match(/href=["']([^"']+)["']/i) ?? [])[1] ?? ''
  const absUrl = (links.find((l) => /rel=["']alternate["']/i.test(l))?.match(/href=["']([^"']+)["']/i) ?? [])[1]
    ?? `https://arxiv.org/abs/${arxivId}`

  return normalizePaper({
    id: `arxiv:${arxivId}`,
    arxivId,
    doi,
    title,
    authors: normalizeAuthors(authors),
    year: yearOf(published),
    date: dateOf(published),
    venue: journalRef || 'arXiv',
    publisher: 'arXiv',
    abstract: summary,
    url: absUrl,
    pdfUrl: pdfUrl || (arxivId ? `https://arxiv.org/pdf/${arxivId}` : ''),
    htmlUrl: arxivId ? `https://arxiv.org/html/${arxivId}` : '',
    citations: 0,
    isOA: true,
    type: journalRef || doi ? 'article' : 'preprint',
    topics: category ? [category] : [],
    sources: ['arxiv'],
  }, 'arxiv')
}

export async function searchArxiv({
  query,
  days = 14,
  limit = 10,
  bypassCache = false,
} = {}) {
  const params = new URLSearchParams()
  params.set('search_query', queryFor(query))
  params.set('start', '0')
  params.set('max_results', String(Math.min(50, Math.max(1, limit * 2))))
  params.set('sortBy', 'submittedDate')
  params.set('sortOrder', 'descending')

  try {
    const res = await httpGet(`${API}?${params.toString()}`, {
      cacheTtlMs: 60 * 60 * 1000,
      bypassCache,
    })
    const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    const entries = [...res.body.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((m) => m[1])
    const papers = []
    for (const e of entries) {
      const p = parseEntry(e)
      if (!p.title) continue
      if (p.date && p.date < from) continue
      papers.push(p)
      if (papers.length >= limit) break
    }
    return { papers, source: 'arxiv', count: papers.length, total: entries.length, error: null }
  } catch (e) {
    return { papers: [], source: 'arxiv', count: 0, total: null, error: String(e?.message ?? e) }
  }
}

export async function getArxivPaper(id) {
  const arxivId = normalizeArxiv(id)
  const params = new URLSearchParams({ id_list: arxivId, max_results: '1' })
  const res = await httpGet(`${API}?${params.toString()}`, { cacheTtlMs: 24 * 60 * 60 * 1000 })
  const entry = (res.body.match(/<entry>([\s\S]*?)<\/entry>/i) ?? [])[1]
  if (!entry) throw new Error(`arXiv 找不到 ${arxivId}`)
  return parseEntry(entry)
}
