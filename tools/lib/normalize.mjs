/**
 * 题录归一化、去重、初筛信号。
 *
 * 这一层刻意不做“科学判断”——它只把不同来源的字段摆成同一张表，
 * 再用可解释的信号排序。真正的取舍由 agent 读摘要/全文后决定。
 */
import { normalizeArxiv, normalizeDoi } from './config.mjs'

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', middot: '·', times: '×',
  le: '≤', ge: '≥', plusmn: '±', micro: 'µ', deg: '°', alpha: 'α', beta: 'β', gamma: 'γ',
  delta: 'δ', epsilon: 'ε', lambda: 'λ', mu: 'μ', sigma: 'σ', tau: 'τ', phi: 'φ', omega: 'ω',
}

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)) } catch { return '' }
    })
    .replace(/&#(\d+);/g, (_, d) => {
      try { return String.fromCodePoint(Number(d)) } catch { return '' }
    })
    .replace(/&([a-z]+);/gi, (m, k) => NAMED[k.toLowerCase()] ?? m)
}

export function stripTags(html, { block = true } = {}) {
  let s = String(html ?? '')
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ')
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
  if (block) {
    s = s.replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote|figcaption|title)>/gi, '\n')
    s = s.replace(/<br\s*\/?>/gi, '\n')
  }
  s = s.replace(/<[^>]+>/g, ' ')
  s = decodeEntities(s)
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function cleanText(s) {
  return stripTags(s)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function cleanAbstract(s) {
  let t = cleanText(s)
  t = t.replace(/^(abstract|summary)\s*[:.\-—]?\s*/i, '')
  t = t.replace(/^(背景|目的|方法|结果|结论)\s*[:：]\s*/gm, '')
  t = t.replace(/\b(BACKGROUND|OBJECTIVE|OBJECTIVES|AIM|AIMS|PURPOSE|METHODS|PATIENTS AND METHODS|MATERIALS AND METHODS|DESIGN|SETTING|PARTICIPANTS|INTERVENTIONS?|MAIN OUTCOME MEASURES?|MEASUREMENTS|RESULTS|FINDINGS|CONCLUSIONS?|INTERPRETATION|SIGNIFICANCE|IMPORTANCE|FUNDING):\s*/gi, '\n$1: ')
  return t.replace(/\n{3,}/g, '\n\n').trim()
}

export function normalizeTitle(title) {
  return cleanText(title)
    .toLowerCase()
    .replace(/^review for\s+["“]?/i, '')
    .replace(/[“”"']/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function titleKey(title) {
  return normalizeTitle(title).replace(/\s+/g, '').slice(0, 180)
}

export function invertedToText(index) {
  if (!index || typeof index !== 'object') return ''
  const slots = []
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue
    for (const p of positions) slots[Number(p)] = word
  }
  return slots.filter((x) => x != null).join(' ').replace(/\s+([,.;:!?)\]])/g, '$1').trim()
}

export function normalizeAuthor(a) {
  if (!a) return null
  if (typeof a === 'string') return { name: cleanText(a) }
  const name = cleanText(a.name ?? a.display_name ?? a.author?.display_name ?? a.fullName ?? '')
  if (!name) return null
  const affiliations = []
  for (const x of a.affiliations ?? a.institutions ?? a.raw_affiliation_strings ?? []) {
    const v = typeof x === 'string' ? x : x?.raw_affiliation_string ?? x?.display_name ?? ''
    if (v && !affiliations.includes(v)) affiliations.push(cleanText(v))
  }
  return { name, ...(affiliations.length ? { affiliations: affiliations.slice(0, 3) } : {}) }
}

export function normalizeAuthors(list, max = 30) {
  return (Array.isArray(list) ? list : []).map(normalizeAuthor).filter(Boolean).slice(0, max)
}

export function formatAuthors(authors, max = 6) {
  const names = (authors ?? []).map((a) => a.name).filter(Boolean)
  if (!names.length) return '作者未知'
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')} 等（共 ${names.length} 人）`
}

export function yearOf(dateLike) {
  if (!dateLike) return null
  if (typeof dateLike === 'number') return dateLike
  const m = String(dateLike).match(/(19|20)\d{2}/)
  return m ? Number(m[0]) : null
}

export function dateOf(dateLike) {
  if (!dateLike) return ''
  const s = String(dateLike)
  const m = s.match(/(19|20)\d{2}(-\d{2}(-\d{2})?)?/)
  return m ? m[0] : ''
}

const EDITORIAL_PATTERNS = /editorial|comment|letter|news|address|speech|obituary|interview|erratum|retraction of publication|retracted publication/i

export function pubTypeList(paper) {
  const raw = paper?.pubTypes ?? paper?.pubTypeList ?? []
  if (Array.isArray(raw)) return raw.map((x) => cleanText(String(x))).filter(Boolean)
  if (typeof raw === 'string') return raw.split(/[;,|]/).map((x) => cleanText(x)).filter(Boolean)
  return []
}

export function isPreprint(paper) {
  if (paper?.isPreprint === true) return true
  if (paper?.arxivId) return true
  if (/^10\.(48550\/arxiv|1101\/)/i.test(String(paper?.doi ?? ''))) return true
  if (/arxiv|biorxiv|medrxiv|research square|ssrn|preprints?\.org|osf preprints/i.test(String(paper?.venue ?? ''))) return true
  if ((paper?.sources ?? []).includes('arxiv')) return true
  return /preprint|posted-content/i.test(String(paper?.type ?? ''))
}

export function isEditorialLike(paper) {
  const t = `${paper?.evidenceType ?? ''} ${pubTypeList(paper).join(' ')} ${paper?.title ?? ''}`.toLowerCase()
  return /editorial|comment|letter|news|address|speech|obituary|interview|erratum|peer review|referee report/.test(t)
}

export function isRetracted(paper) {
  if (paper?.retracted === true) return true
  const types = pubTypeList(paper).join(' ').toLowerCase()
  if (/retracted publication|retraction of publication/.test(types)) return true
  if ((paper?.corrections ?? []).some((c) => /retraction in|retracted/i.test(`${c.type ?? ''} ${c.reference ?? ''}`))) return true
  return false
}

export function classifyEvidence(paper) {
  const types = pubTypeList(paper).join(' ').toLowerCase()
  const title = String(paper?.title ?? '').toLowerCase()
  const abstract = String(paper?.abstract ?? '').toLowerCase()
  if (isRetracted(paper)) return 'retraction'
  if (/guideline|practice guideline|consensus statement/.test(types) || /\b(guideline|consensus statement)\b/.test(title)) return 'guideline'
  if (/systematic review/.test(types)) return 'systematic-review'
  if (/meta-analysis/.test(types)) return 'meta-analysis'
  if (/randomized controlled trial|randomised controlled trial/.test(types) || /\brandomi[sz]ed (controlled )?trial\b/.test(title)) return 'rct'
  if (/clinical trial|controlled clinical trial/.test(types)) return 'clinical-trial'
  if (/observational study|cohort/.test(types) || /\b(cohort|observational)\b/.test(title)) return 'cohort'
  if (/case-control/.test(types) || /\bcase-control\b/.test(title)) return 'case-control'
  if (/diagnostic accuracy|diagnostic/.test(types) || /\bdiagnostic accuracy\b/.test(title)) return 'diagnostic'
  if (/review|meta-analysis|systematic/.test(types) || /\b(review|survey)\b/.test(title)) return 'review'
  if (EDITORIAL_PATTERNS.test(types) || /\b(editorial|commentary|letter to the editor|speech)\b/.test(title)) return 'editorial'
  if (isPreprint(paper)) return 'preprint'
  // 基础/临床前：只在没有更强临床设计线索时使用。
  if (/\b(mice|mouse|murine|rat|zebrafish|cell line|in vitro|in vivo|organoid|xenograft)\b/.test(`${title} ${abstract}`)) return 'preclinical'
  return 'article'
}

export function paperType(paper) {
  if (isRetracted(paper)) return 'retraction'
  if (isPreprint(paper)) return 'preprint'
  const venue = String(paper.venue ?? '').toLowerCase()
  if (/zenodo|figshare|osf preprints|ssrn|research square|concept library|data catalog|dataverse|dryad/.test(venue)) return 'repository'
  if (/peer review|review for|referee report/.test(String(paper.title ?? '').toLowerCase())) return 'peer-review'
  const ev = paper.evidenceType ?? classifyEvidence(paper)
  if (['guideline', 'systematic-review', 'meta-analysis', 'review'].includes(ev)) return 'review'
  if (['editorial', 'retraction'].includes(ev)) return 'correction'
  if (/proceedings|conference/.test(`${paper.type ?? ''} ${paper.title ?? ''}`.toLowerCase())) return 'conference'
  return 'article'
}

export function typeLabel(type) {
  return ({
    article: '期刊论文',
    review: '综述',
    preprint: '预印本',
    conference: '会议论文',
    correction: '社论/更正/撤稿',
    retraction: '撤稿',
    'peer-review': '审稿记录',
    repository: '仓库/预印本平台',
    guideline: '指南/共识',
    'systematic-review': '系统综述',
    'meta-analysis': 'Meta 分析',
    rct: '随机对照试验',
    'clinical-trial': '临床试验',
    cohort: '队列研究',
    'case-control': '病例对照',
    diagnostic: '诊断准确性',
    preclinical: '基础/临床前',
    editorial: '社论/评论/来信',
    other: '其他',
  })[type] ?? '论文'
}

function firstText(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (Array.isArray(v) && v.length) return v
  }
  return ''
}

export function normalizeTrialIds(paper) {
  const raw = [];
  for (const x of [paper?.trialIds, paper?.clinicalTrialList, paper?.clinicalTrial]) {
    if (Array.isArray(x)) raw.push(...x)
    else if (typeof x === 'string') raw.push(x)
    else if (x && typeof x === 'object') raw.push(JSON.stringify(x))
  }
  const text = `${raw.join(' ')} ${paper?.abstract ?? ''} ${paper?.title ?? ''}`
  return [...new Set([...String(text).matchAll(/\b(NCT\d{8}|ISRCTN\d+|ChiCTR[-\w]+|EudraCT[-\w]+)\b/gi)].map((m) => m[1].toUpperCase()))].slice(0, 12)
}

export function normalizePaper(raw, source = '') {
  const p = raw ?? {}
  const doi = normalizeDoi(p.doi ?? p.DOI ?? '')
  let arxivId = normalizeArxiv(p.arxivId ?? p.arxiv_id ?? p.arxiv ?? '')
  if (!arxivId && /^10\.48550\/arxiv\./i.test(doi)) arxivId = normalizeArxiv(doi.split('/').pop().replace(/^arxiv\./i, ''))
  const authors = normalizeAuthors(p.authors ?? p.authorships ?? p.author ?? [])
  const date = dateOf(p.date ?? p.publicationDate ?? p.publication_date ?? p.published ?? p.firstPublicationDate ?? p.issued)
  const year = p.year ?? p.publicationYear ?? p.publication_year ?? yearOf(date)
  const abstract = cleanAbstract(p.abstract ?? p.abstractText ?? p.summary ?? '')
  const venue = cleanText(p.venue ?? p.journal ?? p.journalTitle ?? p.containerTitle ?? p['container-title'] ?? p.primary_location?.source?.display_name ?? p.sourceName ?? '')
  const pubTypes = pubTypeList(p)
  const corrections = Array.isArray(p.corrections) ? p.corrections : (Array.isArray(p.commentCorrectionList) ? p.commentCorrectionList : [])
  const trialIds = normalizeTrialIds(p)
  const paper = {
    id: p.id ?? '',
    doi,
    arxivId,
    pmid: p.pmid ? String(p.pmid) : '',
    pmcid: p.pmcid ? String(p.pmcid) : '',
    title: cleanText(p.title ?? ''),
    authors,
    year: Number.isFinite(Number(year)) ? Number(year) : null,
    date,
    venue,
    publisher: cleanText(p.publisher ?? ''),
    abstract,
    url: firstText(p.url, p.landingUrl, p.landing_page_url, doi ? `https://doi.org/${doi}` : '', ''),
    pdfUrl: firstText(p.pdfUrl, p.pdf_url, ''),
    htmlUrl: firstText(p.htmlUrl, p.html_url, ''),
    citations: Number.isFinite(Number(p.citations ?? p.citedBy ?? p.cited_by_count ?? p['is-referenced-by-count']))
      ? Number(p.citations ?? p.citedBy ?? p.cited_by_count ?? p['is-referenced-by-count'])
      : 0,
    isOA: Boolean(p.isOA ?? p.is_oa ?? p.openAccess ?? p.isOpenAccess ?? p.pdfUrl ?? p.pdf_url),
    hasFullText: Boolean(p.hasFullText ?? p.pmcid ?? p.pdfUrl ?? p.pdf_url ?? p.htmlUrl ?? p.html_url),
    license: cleanText(p.license ?? ''),
    type: p.type ?? '',
    topics: Array.isArray(p.topics) ? p.topics.filter(Boolean).slice(0, 8) : [],
    source: source || p.source || '',
    extra: p.extra && typeof p.extra === 'object' ? { ...p.extra } : {},
    pubTypes,
    mesh: Array.isArray(p.mesh) ? p.mesh.map((x) => cleanText(String(x))).filter(Boolean).slice(0, 40) : [],
    keywords: Array.isArray(p.keywords) ? p.keywords.map((x) => cleanText(String(x))).filter(Boolean).slice(0, 30) : [],
    issn: cleanText(p.issn ?? p.ISSN ?? ''),
    volume: cleanText(p.volume ?? ''),
    issue: cleanText(p.issue ?? ''),
    pages: cleanText(p.pages ?? p.page ?? ''),
    funding: cleanText(p.funding ?? p.fundingText ?? ''),
    coi: cleanText(p.coi ?? p.conflictOfInterest ?? ''),
    trialIds,
    corrections,
    retracted: isRetracted({ ...p, pubTypes, corrections }),
    concern: /expression of concern/i.test(`${pubTypes.join(' ')} ${corrections.map((c) => c.type ?? '').join(' ')}`),
    isPreprint: isPreprint({ ...p, arxivId, doi, venue }),
    peerReviewed: p.peerReviewed == null ? !isPreprint({ ...p, arxivId, doi, venue }) : Boolean(p.peerReviewed),
  }
  paper.evidenceType = classifyEvidence(paper)
  paper.type = paperType(paper)
  paper.sources = [...new Set([...(Array.isArray(p.sources) ? p.sources : []), source].filter(Boolean))]
  return paper
}

/** 同一篇论文可能同时出现在 OpenAlex / arXiv / Europe PMC / Crossref。先合并，再排序。 */
export function dedupePapers(papers) {
  const byKey = new Map()
  for (const raw of papers) {
    const p = normalizePaper(raw)
    if (!p.title) continue
    const keys = []
    if (p.doi) keys.push('doi:' + p.doi)
    if (p.arxivId) keys.push('arxiv:' + p.arxivId)
    if (p.pmid) keys.push('pmid:' + p.pmid)
    if (p.pmcid) keys.push('pmcid:' + p.pmcid.toUpperCase())
    keys.push('title:' + titleKey(p.title))
    let hit = null
    for (const k of keys) if (byKey.has(k)) { hit = byKey.get(k); break }
    if (!hit) {
      const copy = { ...p }
      byKey.set(keys[0], copy)
      for (const k of keys) byKey.set(k, copy)
      continue
    }
    // 合并：不覆盖已有非空字段，只补空缺 / 取更可信的值。
    const arrayFields = ['sources', 'pubTypes', 'mesh', 'keywords', 'trialIds']
    for (const [k, v] of Object.entries(p)) {
      if (v === '' || v == null || (Array.isArray(v) && v.length === 0)) continue
      if (arrayFields.includes(k)) {
        hit[k] = [...new Set([...(hit[k] ?? []), ...(Array.isArray(v) ? v : [v])])]
      } else if (k === 'corrections') {
        const cur = hit.corrections ?? []
        const seenC = new Set(cur.map((x) => `${x.type}|${x.id}|${x.reference}`))
        hit.corrections = [...cur, ...v.filter((x) => !seenC.has(`${x.type}|${x.id}|${x.reference}`))]
      } else if (k === 'extra') {
        hit.extra = { ...(hit.extra ?? {}), ...(v ?? {}) }
      } else if (k === 'citations') {
        hit.citations = Math.max(Number(hit.citations ?? 0), Number(v ?? 0))
      } else if (k === 'isOA' || k === 'hasFullText' || k === 'retracted' || k === 'concern' || k === 'peerReviewed') {
        hit[k] = Boolean(hit[k] || v)
      } else if (k === 'isPreprint') {
        hit.isPreprint = Boolean(hit.isPreprint && v)
      } else if (k === 'authors') {
        if (!hit.authors?.length) hit.authors = v
      } else if (k === 'abstract' || k === 'funding' || k === 'coi') {
        if ((String(hit[k] ?? '').length) < String(v ?? '').length) hit[k] = v
      } else if (!hit[k] || (hit[k] === 'article' && (k === 'type' || k === 'evidenceType'))) {
        hit[k] = v
      }
    }
    hit.evidenceType = classifyEvidence(hit)
    hit.type = paperType(hit)
    for (const k of keys) byKey.set(k, hit)
  }
  const seen = new Set()
  const out = []
  for (const p of byKey.values()) {
    if (seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

export function daysSince(date, now = new Date()) {
  if (!date) return null
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return Math.max(0, Math.round((now.getTime() - d.getTime()) / 86_400_000))
}

export function profileTerms(profile) {
  return {
    keywords: (profile?.keywords ?? []).map((s) => String(s).toLowerCase()).filter(Boolean),
    venues: (profile?.venues ?? []).map((s) => String(s).toLowerCase()).filter(Boolean),
    issns: (profile?.issns ?? []).map((s) => String(s).replace(/[^0-9Xx]/g, '').toUpperCase()).filter(Boolean),
    evidenceMode: profile?.evidenceMode ?? 'clinical',
    methods: (profile?.methods ?? []).map((s) => String(s).toLowerCase()).filter(Boolean),
    topics: (profile?.topicKeywords ?? []).map((s) => String(s).toLowerCase()).filter(Boolean),
    exclude: (profile?.exclude ?? []).map((s) => String(s).toLowerCase()).filter(Boolean),
  }
}

/**
 * 初筛信号：完全可解释，不假装是“科学品味”。
 * 命中关键词、够新、有人引用、开放获取、多源同时出现，都会加分；
 * 命中排除词会显著减分。最终排序仍由 agent 阅读后决定。
 */
const EVIDENCE_WEIGHTS = {
  guideline: 5,
  'systematic-review': 4.5,
  'meta-analysis': 4.5,
  rct: 4,
  'clinical-trial': 3,
  cohort: 2.5,
  'case-control': 2,
  diagnostic: 2,
  preclinical: 1,
  review: 1,
  article: 0,
  editorial: -6,
  retraction: -100,
  preprint: -1,
}

export function scorePaper(paper, profile, { now = new Date() } = {}) {
  const terms = profileTerms(profile)
  const mode = terms.evidenceMode
  const title = (paper.title ?? '').toLowerCase()
  const abstract = (paper.abstract ?? '').toLowerCase()
  const text = `${title} ${abstract}`
  const titleHits = terms.keywords.filter((k) => title.includes(k))
  const abstractHits = terms.keywords.filter((k) => abstract.includes(k))
  const methodHits = terms.methods.filter((k) => text.includes(k))
  const topicHits = terms.topics.filter((k) => text.includes(k))
  const venueText = String(paper.venue ?? '').toLowerCase()
  const venueHits = terms.venues.filter((k) => venueText.includes(k))
  const issnHits = terms.issns.filter((k) => String(paper.issn ?? '').replace(/[^0-9Xx]/g, '').toUpperCase() === k)
  const excluded = terms.exclude.filter((k) => text.includes(k))
  const age = daysSince(paper.date, now)
  const evidenceType = paper.evidenceType ?? classifyEvidence(paper)

  let score = 0
  score += titleHits.length * 4
  score += abstractHits.length * 1.5
  score += methodHits.length * 1
  score += Math.min(8, topicHits.length * 2)
  score += Math.min(6, venueHits.length * 3)
  score += Math.min(6, issnHits.length * 5)
  score += EVIDENCE_WEIGHTS[evidenceType] ?? 0
  if (age != null) {
    score += age <= 7 ? 6 : age <= 30 ? 4 : age <= 90 ? 2 : age <= 365 ? 1 : 0
  }
  score += Math.min(4, Math.log10(1 + Math.max(0, paper.citations ?? 0)) * 1.8)
  if (paper.isOA) score += 1.5
  if (paper.pdfUrl || paper.htmlUrl) score += 0.5
  score += Math.max(0, (paper.sources?.length ?? 1) - 1) * 1
  if (paper.retracted) score -= 100
  if (isEditorialLike(paper)) score -= 4
  if (evidenceType === 'preprint' && mode === 'clinical') score -= 4
  if (excluded.length) score -= 10

  return {
    score: Math.round(score * 10) / 10,
    signals: {
      keywords: [...new Set([...titleHits, ...abstractHits])],
      methods: [...new Set(methodHits)],
      topics: [...new Set(topicHits)],
      venues: [...new Set(venueHits)],
      issns: [...new Set(issnHits)],
      evidenceType,
      retracted: Boolean(paper.retracted),
      preprint: evidenceType === 'preprint',
      excluded,
      ageDays: age,
      citations: paper.citations ?? 0,
      openAccess: Boolean(paper.isOA),
      sources: paper.sources ?? [],
    },
  }
}
export function rankPapers(papers, profile, opts) {
  return dedupePapers(papers)
    .map((paper) => ({ paper, ...scorePaper(paper, profile, opts) }))
    .sort((a, b) => b.score - a.score || String(b.paper.date).localeCompare(String(a.paper.date)))
}

export function looksLikeRepository(paper) {
  return /zenodo|figshare|osf preprints|ssrn|research square|preprints\.org|concept library|data catalog|dataverse|dryad/i.test(String(paper?.venue ?? ''))
}

export function looksExcluded(paper, profile) {
  const { exclude } = profileTerms(profile)
  if (!exclude.length) return false
  const text = `${paper.title ?? ''} ${paper.abstract ?? ''}`.toLowerCase()
  return exclude.some((k) => text.includes(k))
}

export function clip(text, n) {
  const s = String(text ?? '')
  return s.length <= n ? s : s.slice(0, Math.max(0, n - 1)).trimEnd() + '…'
}
