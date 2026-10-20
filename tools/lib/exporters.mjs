/** 文献导出：RIS / BibTeX / CSL-JSON（Zotero、EndNote、参考管理器的通用入口）。 */
import { paperKey } from './config.mjs'
import { cleanText } from './normalize.mjs'


function parseAuthorName(name) {
  const n = String(name ?? '').trim()
  if (!n) return { family: '', given: '', literal: '' }
  let m = n.match(/^(.+?),\s*(.+)$/)
  if (m) return { family: m[1].trim(), given: m[2].trim() }
  // "Bu S" / "Bu SJ"（中文/韩文等姓在前 + 首字母）
  m = n.match(/^([A-Z][A-Za-z'’.-]+)\s+([A-Z]{1,4})$/)
  if (m) return { family: m[1], given: m[2] }
  // "S Bu"（首字母在前 + 姓在后）
  m = n.match(/^([A-Z]{1,4})\s+([A-Z][A-Za-z'’.-]+)$/)
  if (m) return { family: m[2], given: m[1] }
  const parts = n.split(/\s+/)
  if (parts.length > 1) return { family: parts.at(-1), given: parts.slice(0, -1).join(' ') }
  return { family: n, given: '', literal: n }
}

export function toRis(papers) {
  return papers.map((p) => {
    const lines = []
    const type = p.evidenceType === 'conference' ? 'CPAPER' : 'JOUR'
    lines.push(`TY  - ${type}`)
    if (p.title) lines.push(`TI  - ${p.title}`)
    for (const a of p.authors ?? []) if (a.name) lines.push(`AU  - ${a.name}`)
    if (p.year) lines.push(`PY  - ${p.year}`)
    if (p.date) lines.push(`DA  - ${p.date}`)
    if (p.venue) lines.push(`JO  - ${p.venue}`)
    if (p.volume) lines.push(`VL  - ${p.volume}`)
    if (p.issue) lines.push(`IS  - ${p.issue}`)
    if (p.pages) lines.push(`SP  - ${p.pages}`)
    if (p.doi) lines.push(`DO  - ${p.doi}`)
    if (p.url) lines.push(`UR  - ${p.url}`)
    if (p.abstract) lines.push(`AB  - ${cleanText(p.abstract).replace(/\n+/g, ' ')}`)
    if (p.pmid) lines.push(`AN  - PMID:${p.pmid}`)
    if (p.issn) lines.push(`SN  - ${p.issn}`)
    lines.push('ER  - ', '')
    return lines.join('\n')
  }).join('\n')
}

function bibEscape(s) {
  return String(s ?? '').replace(/[{}]/g, '').replace(/\n+/g, ' ').trim()
}

export function toBibtex(papers) {
  return papers.map((p) => {
    const key = (paperKey(p).replace(/[^a-z0-9:_-]+/gi, '') || 'paper') + (p.year ? `_${p.year}` : '')
    const authors = (p.authors ?? []).map((a) => {
      const parsed = parseAuthorName(bibEscape(a.name))
      return parsed.given ? `${parsed.family}, ${parsed.given}` : parsed.family
    }).join(' and ')
    const fields = [
      ['title', p.title],
      ['author', authors],
      ['journal', p.venue],
      ['year', p.year],
      ['volume', p.volume],
      ['number', p.issue],
      ['pages', p.pages],
      ['doi', p.doi],
      ['url', p.url],
      ['issn', p.issn],
      ['note', p.pmid ? `PMID: ${p.pmid}` : ''],
    ].filter(([, v]) => v != null && v !== '')
    return `@article{${key},\n${fields.map(([k, v]) => `  ${k} = {${bibEscape(v)}}`).join(',\n')}\n}\n`
  }).join('\n')
}

export function toCslJson(papers) {
  return papers.map((p) => {
    const authors = (p.authors ?? []).filter((a) => a.name).map((a) => {
      const parsed = parseAuthorName(a.name)
      return parsed.given ? { family: parsed.family, given: parsed.given } : { literal: parsed.family || a.name }
    })
    return {
      id: p.doi || p.pmid || p.arxivId || paperKey(p),
      type: p.evidenceType === 'conference' ? 'paper-conference' : 'article-journal',
      title: p.title,
      author: authors,
      'container-title': p.venue,
      issued: p.year ? { 'date-parts': [[p.year]] } : undefined,
      DOI: p.doi || undefined,
      PMID: p.pmid || undefined,
      URL: p.url || undefined,
      abstract: p.abstract || undefined,
      ISSN: p.issn || undefined,
      volume: p.volume || undefined,
      issue: p.issue || undefined,
      page: p.pages || undefined,
    }
  })
}


function csvCell(v) {
  const s = Array.isArray(v) ? v.join('; ') : String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(papers) {
  const cols = ['key', 'title', 'authors', 'year', 'venue', 'evidenceType', 'status', 'rating', 'rob', 'grade', 'effect', 'doi', 'pmid', 'pmcid', 'issn', 'retracted', 'isPreprint', 'trialIds', 'funding', 'coi', 'url']
  const rows = papers.map((p) => [
    p.key, p.title, (p.authors ?? []).map((a) => a.name).join('; '), p.year, p.venue,
    p.evidenceType, p.status, p.rating, p.rob, p.grade, p.effect,
    p.doi, p.pmid, p.pmcid, p.issn, p.retracted, p.isPreprint,
    p.trialIds, p.funding, p.coi, p.url,
  ])
  return [cols, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
}

export function formatExport(papers, format = 'ris') {
  if (format === 'bibtex' || format === 'bib') return toBibtex(papers)
  if (format === 'csl-json' || format === 'csl') return JSON.stringify(toCslJson(papers), null, 2) + '\n'
  if (format === 'csv') return toCsv(papers)
  return toRis(papers)
}
