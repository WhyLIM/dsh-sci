/**
 * PubMed E-utilities：生物医学检索的“字段语法”入口。
 *
 * 为什么在 Europe PMC 之外还要它：
 *   - [tiab] / [MeSH Terms] / [pt] / [dp] 是临床检索的常用语义；
 *   - Europe PMC 覆盖 PubMed，但查询语法和排序不完全等价；
 *   - 两者都保留，可以在 brief 里看到“同一策略在不同库里的命中”。
 *
 * NCBI 礼貌要求：tool=dsh-sci，带联系邮箱，≤3 请求/秒（http.mjs 已限速）。
 */
import { httpGet, httpJson } from '../http.mjs'
import { ncbiApiKey } from '../config.mjs'
import {
  normalizePaper, cleanText, cleanAbstract, stripTags, decodeEntities,
} from '../normalize.mjs'
import {
  normalizePubmedQuery, normalizeDate, DATE_FIELDS, fieldsToQuery, filtersToQuery,
} from './pubmed-fields.mjs'

const ESEARCH = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi'
const EFETCH = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi'

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

function tag(block, name) {
  const m = String(block ?? '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? m[1] : ''
}

function all(block, name) {
  const out = []
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi')
  let m
  while ((m = re.exec(String(block ?? '')))) out.push(m[1])
  return out
}

function text(block, name) {
  return cleanText(stripTags(tag(block, name)))
}

function dateFromArticle(article) {
  const pub = tag(article, 'PubDate') || tag(article, 'ArticleDate')
  let y = Number(text(pub, 'Year'))
  let mo = String(text(pub, 'Month')).toLowerCase().slice(0, 3)
  let d = Number(text(pub, 'Day'))
  if (!y) {
    const med = text(pub, 'MedlineDate')
    const m = med.match(/(19|20)\d{2}/)
    if (m) y = Number(m[0])
    const mm = med.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i)
    if (mm) mo = mm[1].toLowerCase()
  }
  let month = MONTHS[mo] ?? Number(mo) ?? 1
  if (!Number.isFinite(month) || month < 1 || month > 12) month = 1
  if (!Number.isFinite(d) || d < 1 || d > 31) d = 1
  if (!y) return { date: '', year: null }
  return {
    date: `${String(y).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    year: y,
  }
}

function authorsOf(article) {
  const list = tag(article, 'AuthorList')
  return all(list, 'Author').map((a) => {
    const collective = text(a, 'CollectiveName')
    if (collective) return { name: collective }
    const last = text(a, 'LastName')
    const fore = text(a, 'ForeName')
    const initials = text(a, 'Initials')
    return { name: cleanText([fore || initials, last].filter(Boolean).join(' ')) }
  }).filter((a) => a.name)
}

function abstractOf(article) {
  const abs = tag(article, 'Abstract')
  if (!abs) return ''
  const parts = [...abs.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/gi)].map((m) => {
    const label = (m[1].match(/Label="([^"]+)"/i) ?? [])[1]
    const body = cleanText(stripTags(m[2]))
    return label ? `${cleanText(decodeEntities(label))}: ${body}` : body
  }).filter(Boolean)
  return cleanAbstract(parts.join('\n'))
}

function idsOf(article) {
  const idBlock = tag(article, 'ArticleIdList')
  const ids = {}
  for (const raw of all(idBlock, 'ArticleId')) {
    const type = (raw.match(/IdType="([^"]+)"/i) ?? [])[1]?.toLowerCase()
    const val = cleanText(stripTags(raw))
    if (type && val) ids[type] = val
  }
  const pmid = text(article, 'PMID')
  const eloc = [...String(article).matchAll(/<ELocationID[^>]*EIdType="doi"[^>]*>([\s\S]*?)<\/ELocationID>/gi)].map((m) => cleanText(stripTags(m[1])))
  return { pmid, doi: ids.doi || eloc[0] || '', pmcid: ids.pmc ?? '' }
}

function journalOf(article) {
  const j = tag(article, 'Journal')
  const journalIssue = tag(j, 'JournalIssue')
  return {
    title: text(j, 'Title'),
    abbrev: text(j, 'ISOAbbreviation') || text(j, 'MedlineTA'),
    issn: text(j, 'ISSN'),
    volume: text(journalIssue, 'Volume'),
    issue: text(journalIssue, 'Issue'),
    pages: text(tag(article, 'Pagination'), 'MedlinePgn') || text(tag(article, 'Pagination'), 'StartPage'),
  }
}

function parseArticle(block) {
  const article = tag(block, 'MedlineCitation') ? tag(tag(block, 'MedlineCitation'), 'Article') : block
  const meta = dateFromArticle(article)
  const journal = journalOf(article)
  const ids = idsOf(block)
  const pubTypes = all(tag(article, 'PublicationTypeList'), 'PublicationType').map((x) => cleanText(stripTags(x))).filter(Boolean)
  const mesh = all(tag(block, 'MeshHeadingList'), 'MeshHeading').map((h) => text(h, 'DescriptorName')).filter(Boolean)
  const keywords = all(tag(block, 'KeywordList'), 'Keyword').map((x) => cleanText(stripTags(x))).filter(Boolean)
  const grants = all(tag(block, 'GrantList'), 'Grant').map((g) => [text(g, 'GrantID'), text(g, 'Agency')].filter(Boolean).join(' ')).filter(Boolean)
  const coi = text(block, 'CoiStatement')
  const title = text(article, 'ArticleTitle') || text(block, 'VernacularTitle')
  const abstract = abstractOf(article)
  return normalizePaper({
    id: `pubmed:${ids.pmid}`,
    doi: ids.doi,
    pmid: ids.pmid,
    pmcid: ids.pmcid,
    title,
    authors: authorsOf(article),
    year: meta.year,
    date: meta.date,
    venue: journal.title || journal.abbrev,
    publisher: '',
    abstract,
    url: ids.doi ? `https://doi.org/${ids.doi}` : `https://pubmed.ncbi.nlm.nih.gov/${ids.pmid}/`,
    htmlUrl: '',
    isOA: Boolean(ids.pmcid),
    pubTypes,
    mesh,
    keywords,
    issn: journal.issn,
    volume: journal.volume,
    issue: journal.issue,
    pages: journal.pages,
    funding: grants.join('; '),
    coi,
    peerReviewed: true,
    type: 'article',
    sources: ['pubmed'],
    extra: { pubmed: true },
  }, 'pubmed')
}

function quoteTerm(t) {
  const s = String(t).trim()
  if (!s) return '""'
  if (/^".*"$/.test(s)) return s
  return /\s/.test(s) ? `"${s.replace(/"/g, '')}"` : s
}

export function buildPubmedQuery({
  query,
  days = 14,
  titleAbstractOnly = true,
  pubTypes = [],
  dateFrom = '',
  dateTo = '',
  dateField = 'dp',
  fields = {},
  filters = [],
} = {}) {
  let q = String(query ?? '').trim()
  const hasOther = (Array.isArray(pubTypes) && pubTypes.length)
    || Object.keys(fields ?? {}).length > 0
    || (Array.isArray(filters) ? filters.length > 0 : Boolean(filters))
  if (!q && !hasOther) q = 'medicine'
  const normalized = normalizePubmedQuery(q)
  q = normalized.query
  const hasFieldTags = normalized.tags.length > 0 || /\[[^\]]+\]/.test(q)

  if (q && !hasFieldTags) {
    if (/\bAND\b/.test(q) && titleAbstractOnly) {
      q = q.split(/\s+AND\s+/).map((part) => `((${part})[tiab] OR (${part})[MeSH Terms])`).join(' AND ')
    } else if (/\b(AND|OR|NOT)\b/.test(q)) q = `(${q})`
    else if (titleAbstractOnly) q = `((${quoteTerm(q)})[tiab] OR (${quoteTerm(q)})[MeSH Terms])`
    else q = `(${quoteTerm(q)})`
  }

  const clauses = q ? [q] : []
  clauses.push(...fieldsToQuery(fields ?? {}))
  if (Array.isArray(pubTypes) && pubTypes.length) {
    clauses.push(`(${pubTypes.map((pt) => `"${String(pt).replace(/"/g, '')}"[pt]`).join(' OR ')})`)
  }

  const df = DATE_FIELDS.has(dateField) ? dateField : 'dp'
  const hasDateTag = normalized.tags.some((t) => DATE_FIELDS.has(t))
  const from = normalizeDate(dateFrom) || (() => {
    const d = new Date(Date.now() - days * 86_400_000)
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
  })()
  const to = normalizeDate(dateTo) || '3000/12/31'
  if (from && !hasDateTag) clauses.push(`("${from}"[${df}] : "${to}"[${df}])`)
  clauses.push(...filtersToQuery(filters ?? []))

  return clauses.filter(Boolean).map((c) => `(${c})`).join(' AND ')
}

export async function searchPubmed({
  query,
  days = 14,
  limit = 10,
  titleAbstractOnly = true,
  pubTypes = [],
  fields = {},
  filters = [],
  dateFrom = '',
  dateTo = '',
  dateField = 'dp',
  email = '',
  bypassCache = false,
} = {}) {
  const term = buildPubmedQuery({ query, days, titleAbstractOnly, pubTypes, fields, filters, dateFrom, dateTo, dateField })
  const params = new URLSearchParams({
    db: 'pubmed', term, retmode: 'json', retmax: String(Math.min(50, Math.max(1, limit))),
    sort: 'pub date', tool: 'dsh-sci',
  })
  if (email) params.set('email', email)
  const key = ncbiApiKey()
  if (key) params.set('api_key', key)
  try {
    const search = await httpJson(`${ESEARCH}?${params.toString()}`, {
      cacheTtlMs: 60 * 60 * 1000,
      bypassCache,
    })
    const ids = search.esearchresult?.idlist ?? []
    if (!ids.length) {
      return { papers: [], source: 'pubmed', count: 0, total: Number(search.esearchresult?.count ?? 0), query: term, error: null }
    }
    const fp = new URLSearchParams({ db: 'pubmed', id: ids.join(','), retmode: 'xml', rettype: 'abstract', tool: 'dsh-sci' })
    if (email) fp.set('email', email)
    if (key) fp.set('api_key', key)
    const xml = await httpGet(`${EFETCH}?${fp.toString()}`, {
      cacheTtlMs: 60 * 60 * 1000,
      bypassCache,
      timeoutMs: 45_000,
      headers: { accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1' },
    })
    const blocks = [...xml.body.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/gi)].map((m) => m[1])
    const papers = blocks.map(parseArticle).filter((p) => p.title)
    return {
      papers, source: 'pubmed', count: papers.length,
      total: Number(search.esearchresult?.count ?? papers.length), query: term, error: null,
    }
  } catch (e) {
    return { papers: [], source: 'pubmed', count: 0, total: null, query: term, error: String(e?.message ?? e) }
  }
}
