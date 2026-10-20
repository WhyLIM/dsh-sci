/**
 * Europe PMC：生命科学/医学的开放题录 + 开放全文 XML。
 * 免费、无 key、覆盖面稳定；同时收录 PubMed、PMC 与部分预印本。
 */
import { httpGet, httpJson } from '../http.mjs'
import { cleanAbstract, cleanText, normalizePaper, dateOf, yearOf } from '../normalize.mjs'

const API = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'

function authorsOf(r) {
  const list = r.authorList?.author
  if (Array.isArray(list) && list.length) {
    return list.map((a) => ({
      name: cleanText([a.firstName, a.lastName].filter(Boolean).join(' ') || a.fullName || ''),
      affiliations: (a.authorAffiliationDetailsList?.authorAffiliation ?? [])
        .map((x) => cleanText(x.affiliation ?? ''))
        .filter(Boolean)
        .slice(0, 2),
    })).filter((a) => a.name)
  }
  const s = cleanText(r.authorString ?? '')
  if (!s) return []
  return s.split(/[,;]/).map((x) => ({ name: x.trim() })).filter((a) => a.name).slice(0, 30)
}

function oaUrls(r) {
  const urls = r.fullTextUrlList?.fullTextUrl ?? []
  const oa = urls.filter((u) => u.availabilityCode === 'OA' || /open access/i.test(u.availability ?? ''))
  const pdf = oa.find((u) => u.documentStyle === 'pdf')?.url
    ?? (r.hasPDF === 'Y' && r.pmcid ? `https://europepmc.org/articles/${r.pmcid}?pdf=render` : '')
  const html = oa.find((u) => u.documentStyle === 'html')?.url
    ?? (r.pmcid ? `https://europepmc.org/article/${r.source}/${r.id}` : '')
  const xml = r.pmcid && r.inEPMC === 'Y'
    ? `https://www.ebi.ac.uk/europepmc/webservices/rest/${r.pmcid}/fullTextXML`
    : ''
  return { pdf, html, xml }
}

function pubTypesOf(r) {
  const x = r.pubTypeList?.pubType
  if (Array.isArray(x)) return x.map((v) => cleanText(String(v))).filter(Boolean)
  if (typeof x === 'string') return [cleanText(x)].filter(Boolean)
  return []
}

function meshOf(r) {
  const list = r.meshHeadingList?.meshHeading
  if (!Array.isArray(list)) return []
  return list.map((h) => cleanText(h.descriptorName ?? '')).filter(Boolean).slice(0, 40)
}

function keywordsOf(r) {
  const list = r.keywordList?.keyword
  if (Array.isArray(list)) return list.map((v) => cleanText(String(v))).filter(Boolean).slice(0, 30)
  if (typeof list === 'string') return [cleanText(list)].filter(Boolean)
  return []
}

function correctionsOf(r) {
  const list = r.commentCorrectionList?.commentCorrection
  if (!Array.isArray(list)) return []
  return list.map((c) => ({
    type: cleanText(c.type ?? ''),
    id: String(c.id ?? ''),
    reference: cleanText(c.reference ?? ''),
  })).filter((c) => c.type || c.reference)
}

function fundingOf(r) {
  if (r.fundingText) return cleanText(r.fundingText)
  const grants = r.grantsList?.grant
  if (Array.isArray(grants)) {
    return grants.map((g) => [g.grantId, g.agency].filter(Boolean).join(' ')).filter(Boolean).join('; ').slice(0, 2000)
  }
  return ''
}

function parseResult(r) {
  const journal = r.journalInfo?.journal
  const venue = cleanText(journal?.title ?? r.bookOrReportDetails?.publisher ?? r.publisher ?? '')
  const urls = oaUrls(r)
  const doi = r.doi ?? ''
  const pubTypes = pubTypesOf(r)
  return normalizePaper({
    id: `${r.source ?? 'epmc'}:${r.id ?? r.pmid ?? ''}`,
    doi,
    pmid: r.pmid ?? '',
    pmcid: r.pmcid ?? '',
    title: r.title ?? '',
    authors: authorsOf(r),
    year: r.pubYear ?? yearOf(r.firstPublicationDate),
    date: dateOf(r.firstPublicationDate ?? r.journalInfo?.dateOfPublication),
    venue,
    publisher: cleanText(journal?.publisher ?? ''),
    abstract: cleanAbstract(r.abstractText ?? ''),
    url: doi ? `https://doi.org/${doi}` : `https://europepmc.org/article/${r.source}/${r.id}`,
    pdfUrl: urls.pdf,
    htmlUrl: urls.html,
    citations: r.citedByCount ?? 0,
    isOA: r.isOpenAccess === 'Y',
    license: r.license ?? '',
    pubTypes,
    mesh: meshOf(r),
    keywords: keywordsOf(r),
    issn: journal?.issn ?? journal?.essn ?? '',
    volume: r.journalInfo?.volume ?? '',
    issue: r.journalInfo?.issue ?? '',
    pages: r.pageInfo ?? '',
    funding: fundingOf(r),
    coi: cleanText(r.conflictOfInterest ?? ''),
    corrections: correctionsOf(r),
    clinicalTrialList: r.clinicalTrialList ?? null,
    type: r.source === 'PPR' ? 'preprint' : 'article',
    peerReviewed: r.source !== 'PPR',
    topics: [],
    sources: ['europepmc'],
    extra: { fullTextXml: urls.xml, source: r.source, epmcId: r.id, inEPMC: r.inEPMC === 'Y' },
  }, 'europepmc')
}

function epmcQuery(query, titleAbstractOnly) {
  const q = String(query ?? '').trim()
  if (!q) return 'TITLE_ABS:("medicine")'
  if (/TITLE_ABS|PUB_TYPE|SRC:|FIRST_PDATE|ISSN:|\[[a-z]+\]/i.test(q)) return q
  if (!titleAbstractOnly) return `(${q})`
  // Europe PMC 对字段内的布尔表达式需要用 TITLE_ABS:(("a") AND ("b")) 或逐项加字段；
  // 这里只对“单一查询串”做短语限定，PICO 生成的 AND 查询保持原样，避免语法错误。
  if (/\bAND\b/.test(q) && titleAbstractOnly) {
    return q.split(/\s+AND\s+/).map((part) => `TITLE_ABS:(${part})`).join(' AND ')
  }
  if (/\b(AND|OR|NOT)\b/.test(q)) return `(${q})`
  return `TITLE_ABS:("${q.replace(/"/g, '\\"')}")`
}

export async function searchEuropePmc({
  query,
  days = 14,
  limit = 10,
  oaOnly = false,
  includePreprints = false,
  titleAbstractOnly = true,
  synonymExpansion = true,
  includeEditorials = false,
  includeGuidelines = true,
  pubTypes = [],
  bypassCache = false,
} = {}) {
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const filters = [`FIRST_PDATE:[${from} TO 2999-12-31]`]
  if (oaOnly) filters.push('OPEN_ACCESS:Y')
  if (!includePreprints) filters.push('NOT SRC:PPR')
  if (Array.isArray(pubTypes) && pubTypes.length) {
    filters.push(`PUB_TYPE:(${pubTypes.map((x) => `"${String(x).replace(/"/g, '')}"`).join(' OR ')})`)
  }
  const q = `(${epmcQuery(query, titleAbstractOnly)}) AND (${filters.join(' AND ')})`
  const params = new URLSearchParams({
    query: q,
    format: 'json',
    pageSize: String(Math.min(50, Math.max(1, limit))),
    resultType: 'core',
    sort: 'P_PDATE_D desc',
    synonym: synonymExpansion ? 'true' : 'false',
  })
  try {
    const data = await httpJson(`${API}?${params.toString()}`, {
      cacheTtlMs: 60 * 60 * 1000,
      bypassCache,
    })
    let rows = data.resultList?.result ?? []
    if (!includeEditorials) {
      rows = rows.filter((r) => {
        const types = pubTypesOf(r).join(' ').toLowerCase()
        return !/(editorial|comment|letter|news|address|speech|obituary|interview|erratum)/.test(types)
      })
    }
    if (!includeGuidelines) {
      rows = rows.filter((r) => !/guideline|consensus/.test(pubTypesOf(r).join(' ').toLowerCase()))
    }
    const papers = rows.map(parseResult).filter((p) => p.title)
    return {
      papers, source: 'europepmc', count: papers.length, total: data.hitCount ?? null,
      query: q, error: null,
    }
  } catch (e) {
    return { papers: [], source: 'europepmc', count: 0, total: null, query: q, error: String(e?.message ?? e) }
  }
}

export async function getEuropePmcByQuery(query) {
  const params = new URLSearchParams({ query, format: 'json', pageSize: '3', resultType: 'core' })
  const data = await httpJson(`${API}?${params.toString()}`, { cacheTtlMs: 24 * 60 * 60 * 1000 })
  const rows = data.resultList?.result ?? []
  if (!rows.length) throw new Error(`Europe PMC 找不到：${query}`)
  return rows.map(parseResult)
}

export async function getEuropePmcFullTextXml(pmcid) {
  const id = String(pmcid).replace(/^PMC/i, '')
  const res = await httpGet(`https://www.ebi.ac.uk/europepmc/webservices/rest/PMC${id}/fullTextXML`, {
    cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
    timeoutMs: 60_000,
  })
  return res.body
}
