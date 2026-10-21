/**
 * 多源检索 + 初筛 + 可复现的检索策略。
 *
 * 生物医学的关键差异：
 *   - 发现阶段允许非 OA（只读摘要），阅读阶段才强制 OA 全文；
 *   - PICO 查询优先于散关键词；
 *   - Europe PMC / PubMed 都做标题+摘要字段限定；
 *   - 撤稿、社论、评论、预印本按证据类型过滤，而不是只靠关键词。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULTS, PATHS, outputPaths, readConfig, readState, writeState, writeJson,
  paperKey, ensureDataDirs, appendLog, emailFor,
} from './config.mjs'
import {
  dedupePapers, rankPapers, looksExcluded, looksLikeRepository, daysSince,
  isEditorialLike, isPreprint,
} from './normalize.mjs'
import { searchOpenAlex } from './sources/openalex.mjs'
import { searchArxiv } from './sources/arxiv.mjs'
import { searchBiorxiv } from './sources/biorxiv.mjs'
import { searchEuropePmc } from './sources/europepmc.mjs'
import { searchCrossref } from './sources/crossref.mjs'
import { searchPubmed } from './sources/pubmed.mjs'
import { readSecrets } from './config.mjs'
import { excludedKeys } from './screening.mjs'
import { topicQueries, topicKeywords, topicTitles } from './topics.mjs'
import { queryForLog } from './privacy.mjs'

const PAPER_SOURCES = ['openalex', 'arxiv', 'biorxiv', 'europepmc', 'pubmed', 'crossref']

export function enabledSources(cfg = readConfig()) {
  return Object.entries(cfg.sources)
    .filter(([k, v]) => PAPER_SOURCES.includes(k) && typeof v === 'boolean' && v)
    .map(([k]) => k)
}

export function picoQuery(pico) {
  const parts = ['population', 'intervention', 'comparator', 'outcome']
    .map((k) => String(pico?.[k] ?? '').trim())
    .filter(Boolean)
  if (!parts.length) return ''
  return parts.map((x) => `("${x.replace(/"/g, '')}")`).join(' AND ')
}

export function queriesFor(profile, override) {
  if (override) return [String(override)]
  const pico = picoQuery(profile?.pico)
  if (pico) return [pico]
  const kws = (profile?.keywords ?? []).map((x) => String(x).trim()).filter(Boolean)
  if (kws.length) return [...new Set(kws)].slice(0, 3)
  const field = String(profile?.field ?? '').trim()
  return field ? [field] : [DEFAULTS.researcher.field]
}

function filterDecision(paper, cfg) {
  const profile = cfg.researcher
  if (paper.retracted) return 'retracted'
  if (paper.concern) return 'concern'
  if (!cfg.search.includeEditorials && ['editorial', 'retraction'].includes(paper.evidenceType)) return 'editorial'
  if (!cfg.search.includeGuidelines && paper.evidenceType === 'guideline') return 'guideline'
  if (!cfg.search.includePreprints && (paper.isPreprint || paper.evidenceType === 'preprint')) return 'preprint'
  if (!cfg.search.includeRepositories && looksLikeRepository(paper)) return 'repository'
  if (looksExcluded(paper, profile)) return 'excluded-term'
  return ''
}

export async function searchAll({
  query,
  days = 14,
  perSource = 10,
  discoveryOAOnly = false,
  includePreprints = false,
  includeEditorials = false,
  includeGuidelines = true,
  titleAbstractOnly = true,
  synonymExpansion = true,
  pubTypes = [],
  sourceNames,
  bypassCache = false,
} = {}) {
  const cfg = readConfig()
  const secrets = readSecrets()
  const names = sourceNames?.length ? sourceNames.filter((x) => PAPER_SOURCES.includes(x)) : enabledSources(cfg)
  const jobs = []

  if (names.includes('openalex')) {
    jobs.push(searchOpenAlex({
      query, days, limit: perSource, oaOnly: discoveryOAOnly,
      apiKey: secrets.openalexApiKey, email: emailFor('openalex', cfg, secrets),
      bypassCache,
    }))
  }
  if (names.includes('arxiv')) {
    jobs.push(searchArxiv({ query, days, limit: perSource, bypassCache }))
  }
  if (names.includes('biorxiv')) {
    jobs.push(searchBiorxiv({ query, days, limit: perSource, bypassCache }))
  }
  if (names.includes('europepmc')) {
    jobs.push(searchEuropePmc({
      query, days, limit: perSource, oaOnly: discoveryOAOnly,
      includePreprints, includeEditorials, includeGuidelines,
      titleAbstractOnly, synonymExpansion, pubTypes, bypassCache,
    }))
  }
  if (names.includes('pubmed')) {
    jobs.push(searchPubmed({
      query, days, limit: perSource, titleAbstractOnly, pubTypes,
      email: emailFor('pubmed', cfg, secrets), bypassCache,
    }))
  }
  if (names.includes('crossref')) {
    jobs.push(searchCrossref({ query, days, limit: perSource, email: emailFor('crossref', cfg, secrets), bypassCache }))
  }

  if (!jobs.length) {
    return { papers: [], reports: [{ source: 'none', count: 0, error: '没有启用任何检索源（设置 → 科研 → 检索源）', hint: '' }] }
  }

  const settled = await Promise.allSettled(jobs)
  const papers = []
  const reports = []
  for (const r of settled) {
    if (r.status !== 'fulfilled') {
      reports.push({ source: '?', count: 0, error: String(r.reason?.message ?? r.reason) })
      continue
    }
    papers.push(...r.value.papers)
    reports.push({
      source: r.value.source,
      count: r.value.count,
      total: r.value.total,
      query: r.value.query ?? '',
      error: r.value.error ?? null,
      hint: r.value.hint ?? r.value.warning ?? '',
    })
  }
  const deduped = dedupePapers(papers)
  return { papers: deduped, rawCount: papers.length, reports }
}

/** 已入库 / 最近 N 天出现过的，不再重复推荐。 */
export function seenKeys() {
  const cfg = readConfig()
  const windowDays = cfg.search.seenDays ?? 14
  const seen = new Set()
  try {
    for (const f of fs.readdirSync(PATHS.papers)) {
      if (!f.endsWith('.json')) continue
      const p = JSON.parse(fs.readFileSync(path.join(PATHS.papers, f), 'utf8'))
      for (const k of [p.key, p.doi, p.arxivId, p.pmid, p.pmcid, p.title]) {
        if (k) seen.add(String(k).toLowerCase())
      }
    }
  } catch {}
  const st = readState()
  for (const [k, at] of Object.entries(st.seen ?? {})) {
    const d = daysSince(String(at).slice(0, 10))
    if (d != null && d <= windowDays) seen.add(k)
  }
  return seen
}

export function isSeen(paper, seen) {
  const keys = [paperKey(paper), paper.doi, paper.arxivId, paper.pmid, paper.pmcid, paper.title]
  return keys.filter(Boolean).some((k) => seen.has(String(k).toLowerCase()))
}

export function markSeen(papers, windowDays = 14) {
  ensureDataDirs()
  const st = readState()
  const seen = { ...(st.seen ?? {}) }
  const today = new Date().toISOString().slice(0, 10)
  for (const p of papers) {
    const key = p.key ?? paperKey(p)
    if (key) seen[key] = today
    if (p.doi) seen[String(p.doi).toLowerCase()] = today
    if (p.pmid) seen[`pmid:${p.pmid}`] = today
    if (p.arxivId) seen[`arxiv:${p.arxivId}`] = today
  }
  for (const [k, at] of Object.entries(seen)) {
    const d = daysSince(String(at).slice(0, 10))
    if (d == null || d > Math.max(30, windowDays * 2)) delete seen[k]
  }
  writeState({ seen })
}

export function saveStrategy(result) {
  ensureDataDirs()
  const cfg = readConfig()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = path.join(outputPaths(cfg).searches, `${stamp}.json`)
  const payload = {
    createdAt: new Date().toISOString(),
    queries: result.queries.map((q) => queryForLog(q, cfg)),
    days: result.days,
    reports: result.reports,
    prisma: result.prisma,
    candidates: result.candidates.map((c) => ({
      key: c.paper.key, title: c.paper.title, doi: c.paper.doi, pmid: c.paper.pmid,
      evidenceType: c.paper.evidenceType, score: c.score,
    })),
  }
  writeJson(file, payload)
  appendLog('search-strategy', `${result.queries.map((q) => queryForLog(q, cfg)).join(' | ')}`, { file })
  return file
}

/**
 * 一轮“选题”：多关键词/PICO × 多源 → 去重 → 证据过滤 → 初筛排序。
 */
export async function collectCandidates({
  query,
  days,
  maxCandidates,
  bypassCache = false,
  includeSeen = false,
} = {}) {
  const cfg = readConfig()
  const profile = cfg.researcher
  const qs = [...new Set([...queriesFor(profile, query), ...topicQueries(cfg)])]
  const reports = []
  const all = []
  let rawCount = 0
  for (const q of qs) {
    const r = await searchAll({
      query: q,
      days: days ?? cfg.search.lookbackDays,
      perSource: cfg.search.perSource,
      discoveryOAOnly: cfg.search.discoveryOAOnly,
      includePreprints: cfg.search.includePreprints,
      includeEditorials: cfg.search.includeEditorials,
      includeGuidelines: cfg.search.includeGuidelines,
      titleAbstractOnly: cfg.search.titleAbstractOnly,
      synonymExpansion: cfg.search.synonymExpansion,
      pubTypes: profile.studyTypes ?? [],
      bypassCache,
    })
    all.push(...r.papers)
    rawCount += r.rawCount ?? r.papers.length
    reports.push({ query: q, sources: r.reports })
  }

  const deduped = dedupePapers(all)
  const seen = includeSeen ? new Set() : seenKeys()
  const counts = {
    identified: rawCount,
    duplicates: Math.max(0, rawCount - deduped.length),
    screened: deduped.length,
    excludedByType: 0,
    excludedBySeen: 0,
    excludedByScreening: 0,
    excludedByTerm: 0,
    included: 0,
  }
  const fresh = []
  const screenedOut = excludedKeys()
  for (const p of deduped) {
    if (screenedOut.has(paperKey(p))) { counts.excludedByScreening += 1; continue }
    if (!includeSeen && isSeen(p, seen)) { counts.excludedBySeen += 1; continue }
    const reason = filterDecision(p, cfg)
    if (reason) {
      if (reason === 'excluded-term') counts.excludedByTerm += 1
      else counts.excludedByType += 1
      continue
    }
    fresh.push(p)
  }
  counts.included = fresh.length
  const rankProfile = { ...profile, topicKeywords: topicKeywords(cfg) }
  const ranked = rankPapers(fresh, rankProfile, { now: new Date() })
  const max = maxCandidates ?? cfg.search.maxCandidates
  const candidates = ranked.slice(0, max).map((c) => ({
    ...c,
    paper: { ...c.paper, key: c.paper.key ?? paperKey(c.paper) },
  }))
  return {
    candidates,
    scanned: deduped.length,
    afterFilter: fresh.length,
    queries: qs,
    reports,
    days: days ?? cfg.search.lookbackDays,
    topics: topicTitles(cfg),
    prisma: counts,
    strategy: {
      mode: profile.evidenceMode,
      pico: profile.pico,
      titleAbstractOnly: cfg.search.titleAbstractOnly,
      discoveryOAOnly: cfg.search.discoveryOAOnly,
      includePreprints: cfg.search.includePreprints,
      includeEditorials: cfg.search.includeEditorials,
      includeGuidelines: cfg.search.includeGuidelines,
    },
  }
}
