/**
 * 引文追踪：Europe PMC 的 citations / references 接口。
 * 生物医学里“顺着参考文献和引用往回/往前爬”往往比关键词搜索更有效。
 */
import { httpJson } from '../http.mjs'
import { normalizePaper, cleanText, dateOf, yearOf } from '../normalize.mjs'
import { getEuropePmcByQuery } from './europepmc.mjs'

async function epmcRef(paper) {
  if (paper?.extra?.source && paper?.extra?.epmcId) {
    const id = String(paper.extra.epmcId)
    return { source: paper.extra.source, id: paper.extra.source === 'PMC' ? id.replace(/^PMC/i, '') : id }
  }
  if (paper?.pmid) return { source: 'MED', id: String(paper.pmid) }
  if (paper?.pmcid) return { source: 'PMC', id: String(paper.pmcid).replace(/^PMC/i, '') }
  if (paper?.doi) {
    const rows = await getEuropePmcByQuery(`DOI:"${paper.doi}"`)
    const hit = rows[0]
    if (hit?.extra?.source && hit?.extra?.epmcId) return { source: hit.extra.source, id: String(hit.extra.epmcId) }
  }
  throw new Error('这篇论文不在 Europe PMC，无法做引文追踪')
}

function parseCitation(c) {
  return normalizePaper({
    id: `${c.source ?? 'epmc'}:${c.id ?? ''}`,
    doi: c.doi ?? '',
    pmid: c.source === 'MED' ? c.id : (c.pmid ?? ''),
    pmcid: c.source === 'PMC' ? `PMC${c.id}` : (c.pmcid ?? ''),
    title: c.title ?? '',
    authors: c.authorString ? c.authorString.split(/[,;]/).map((x) => ({ name: cleanText(x) })) : [],
    year: c.pubYear ?? yearOf(c.firstPublicationDate),
    date: dateOf(c.firstPublicationDate),
    venue: c.journalAbbreviation ?? c.journalTitle ?? '',
    abstract: '',
    url: c.doi ? `https://doi.org/${c.doi}` : `https://europepmc.org/article/${c.source}/${c.id}`,
    citations: c.citedByCount ?? 0,
    sources: ['europepmc-citation'],
    peerReviewed: true,
    type: 'article',
  }, 'europepmc-citation')
}

async function fetchDirection(paper, dir, limit) {
  const ref = await epmcRef(paper)
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(ref.source)}/${encodeURIComponent(ref.id)}/${dir}?format=json&pageSize=${Math.min(50, Math.max(1, limit))}`
  const data = await httpJson(url, { cacheTtlMs: 6 * 60 * 60 * 1000 })
  const key = dir === 'citations' ? 'citationList' : 'referenceList'
  const listKey = dir === 'citations' ? 'citation' : 'reference'
  const rows = data[key]?.[listKey] ?? []
  return rows.map(parseCitation).filter((p) => p.title)
}

export async function getRelated(paper, { direction = 'both', limit = 10 } = {}) {
  const dirs = direction === 'both' ? ['citations', 'references'] : [direction]
  const out = {}
  const errors = []
  for (const d of dirs) {
    try {
      out[d] = await fetchDirection(paper, d, limit)
    } catch (e) {
      out[d] = []
      errors.push(`${d}: ${String(e?.message ?? e).slice(0, 160)}`)
    }
  }
  return { ...out, errors, ref: await epmcRef(paper).catch(() => null) }
}
