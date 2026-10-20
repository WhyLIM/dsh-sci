/**
 * 从 DOI / arXiv ID / PMID / PMCID / OpenAlex ID 解析出一张统一的题录，
 * 并尽量补齐合法的开放全文链接。
 */
import { normalizeDoi, normalizeArxiv, paperKey, emailFor } from './config.mjs'
import { normalizePaper, dedupePapers, cleanText } from './normalize.mjs'
import { getArxivPaper } from './sources/arxiv.mjs'
import { getCrossrefByDoi } from './sources/crossref.mjs'
import { getEuropePmcByQuery } from './sources/europepmc.mjs'
import { getOpenAlexByDoi, getOpenAlexWork } from './sources/openalex.mjs'
import { searchPubmed } from './sources/pubmed.mjs'
import { unpaywall } from './sources/unpaywall.mjs'

function mergeOne(base, other) {
  if (!other) return base
  const out = { ...base }
  const arrays = ['sources', 'pubTypes', 'mesh', 'keywords', 'trialIds']
  for (const [k, v] of Object.entries(other)) {
    if (v === '' || v == null || (Array.isArray(v) && v.length === 0)) continue
    if (arrays.includes(k)) out[k] = [...new Set([...(out[k] ?? []), ...(Array.isArray(v) ? v : [v])])]
    else if (k === 'corrections') out.corrections = [...(out.corrections ?? []), ...v]
    else if (k === 'citations') out.citations = Math.max(Number(out.citations ?? 0), Number(v ?? 0))
    else if (k === 'isOA' || k === 'hasFullText' || k === 'retracted' || k === 'concern' || k === 'peerReviewed') out[k] = Boolean(out[k] || v)
    else if (k === 'isPreprint') out.isPreprint = Boolean(out.isPreprint && v)
    else if (k === 'authors') { if (!out.authors?.length) out.authors = v }
    else if (k === 'abstract' || k === 'funding' || k === 'coi') {
      if (String(v ?? '').length > String(out[k] ?? '').length) out[k] = v
    } else if (k === 'extra') out.extra = { ...(out.extra ?? {}), ...v }
    else if (!out[k] || (k === 'type' && out[k] === 'preprint' && v !== 'preprint')) out[k] = v
  }
  return out
}

export function classifyInput(input) {
  const s = String(input ?? '').trim()
  if (!s) return { kind: 'none', value: '' }
  if (/^https?:\/\/(www\.)?arxiv\.org\/(abs|pdf)\//i.test(s)) return { kind: 'arxiv', value: normalizeArxiv(s) }
  if (/^arxiv:/i.test(s)) return { kind: 'arxiv', value: normalizeArxiv(s) }
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(s)) return { kind: 'arxiv', value: normalizeArxiv(s) }
  if (/^https?:\/\/(dx\.)?doi\.org\//i.test(s)) return { kind: 'doi', value: normalizeDoi(s) }
  if (/^doi:/i.test(s)) return { kind: 'doi', value: normalizeDoi(s) }
  if (/^10\.\d{4,9}\/\S+$/.test(s)) return { kind: 'doi', value: normalizeDoi(s) }
  if (/^(pmid|pubmed):\s*\d+$/i.test(s)) return { kind: 'pmid', value: s.replace(/\D/g, '') }
  if (/^pmcid:\s*PMC?\d+$/i.test(s)) return { kind: 'pmcid', value: s.replace(/^pmcid:\s*/i, '').toUpperCase() }
  if (/^PMC\d+$/i.test(s)) return { kind: 'pmcid', value: s.toUpperCase() }
  if (/^\d{7,9}$/.test(s)) return { kind: 'pmid', value: s }
  if (/^https?:\/\/openalex\.org\/W\d+$/i.test(s)) return { kind: 'openalex', value: s.replace(/^https?:\/\/openalex\.org\//i, '') }
  if (/^W\d{6,}$/i.test(s)) return { kind: 'openalex', value: s.toUpperCase() }
  return { kind: 'unknown', value: s }
}

export async function resolvePaper(input, { refresh = false } = {}) {
  const c = classifyInput(input)
  if (c.kind === 'none') throw new Error('需要一个 DOI、arXiv ID、PMID、PMCID 或 OpenAlex ID')
  if (c.kind === 'arxiv') {
    let paper = await getArxivPaper(c.value)
    paper = await enrich(paper, { refresh })
    return finalize(paper)
  }
  if (c.kind === 'doi') return resolveDoi(c.value, { refresh })
  if (c.kind === 'pmid' || c.kind === 'pmcid') {
    const q = c.kind === 'pmid' ? `EXT_ID:${c.value} AND SRC:MED` : `PMCID:${c.value}`
    const rows = await getEuropePmcByQuery(q)
    if (!rows.length) throw new Error(`Europe PMC 找不到 ${c.kind}:${c.value}`)
    let paper = rows[0]
    if (paper.doi) paper = mergeOne(paper, await safe(() => getCrossrefByDoi(paper.doi)))
    paper = await enrich(paper, { refresh })
    return finalize(paper)
  }
  if (c.kind === 'openalex') {
    let paper = await getOpenAlexWork(c.value)
    paper = await enrich(paper, { refresh })
    return finalize(paper)
  }
  throw new Error(`认不出这个标识：${input}。支持 doi: / arxiv: / pmid: / pmcid: / openalex: 或完整链接。`)
}

async function resolveDoi(doi, { refresh } = {}) {
  const tries = await Promise.allSettled([
    getCrossrefByDoi(doi),
    getEuropePmcByQuery(`DOI:"${doi}"`).then((rows) => rows[0]),
    getOpenAlexByDoi(doi),
    searchPubmed({ query: `${doi}[doi]`, limit: 1, days: 3650, titleAbstractOnly: false, email: emailFor('pubmed') }).then((r) => r.papers[0]),
  ])
  let paper = null
  for (const t of tries) {
    if (t.status === 'fulfilled' && t.value) paper = paper ? mergeOne(paper, t.value) : t.value
  }
  if (!paper) {
    paper = normalizePaper({
      doi,
      title: `DOI ${doi}`,
      url: `https://doi.org/${doi}`,
      sources: [],
    })
  }
  paper = await enrich(paper, { refresh })
  return finalize(paper)
}

async function enrich(paper, { refresh } = {}) {
  let out = paper
  // Unpaywall 只在有 DOI + 邮箱时用；没有邮箱也不报错，只是可能少一条 OA 链接。
  if (!out.pdfUrl && out.doi) {
    const email = emailFor('unpaywall')
    const up = await unpaywall(out.doi, email)
    if (up?.isOA) {
      out = mergeOne(out, {
        isOA: true,
        pdfUrl: up.pdfUrl,
        htmlUrl: up.htmlUrl,
        license: up.license,
        extra: { unpaywall: up },
      })
    } else if (up && !up.isOA) {
      out.extra = { ...(out.extra ?? {}), unpaywall: up }
    }
  }
  return out
}

function finalize(paper) {
  const p = normalizePaper(paper)
  p.key = paperKey(p)
  // title 为空时至少给一个可检索的占位，不伪装成已知题录。
  if (!p.title) p.title = p.doi ? `DOI ${p.doi}` : (p.arxivId ? `arXiv:${p.arxivId}` : `未命名文献 ${p.key}`)
  p.abstract = cleanText(p.abstract)
  return p
}

async function safe(fn) {
  try { return await fn() } catch { return null }
}

export async function findBestPaper(query, { limit = 8, days = 3650 } = {}) {
  const { searchOpenAlex } = await import('./sources/openalex.mjs')
  const { searchArxiv } = await import('./sources/arxiv.mjs')
  const { searchEuropePmc } = await import('./sources/europepmc.mjs')
  const results = await Promise.allSettled([
    searchOpenAlex({ query, limit, days, oaOnly: false }),
    searchArxiv({ query, limit, days }),
    searchEuropePmc({ query, limit, days, oaOnly: false }),
    searchPubmed({ query, limit, days, titleAbstractOnly: true }),
  ])
  const papers = []
  for (const r of results) if (r.status === 'fulfilled') papers.push(...r.value.papers)
  const ranked = dedupePapers(papers)
  return ranked[0] ?? null
}
