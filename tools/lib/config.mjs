/**
 * dsh-sci —— 配置、路径与默认值（Host 与 CLI 共用同一份）
 *
 * 只有一份真相：
 *   ~/.dsh/sci.config.json     普通配置（可读）
 *   ~/.dsh/sci.secrets.json    API key / 邮箱（0600，永不回显）
 *   ~/.dsh/sci/                文献库、笔记、简报、日志、缓存
 *
 * 不把 key 写进 config，是为了让“设置页读配置”这个动作永远不需要脱敏逻辑。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

export const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
export const SCI_HOME = process.env.DSH_SCI_HOME || path.join(DSH_HOME, 'sci')
export const CFG_FILE = process.env.DSH_SCI_CONFIG || path.join(DSH_HOME, 'sci.config.json')
export const SECRETS_FILE = process.env.DSH_SCI_SECRETS || path.join(DSH_HOME, 'sci.secrets.json')

export const PATHS = {
  home: SCI_HOME,
  papers: path.join(SCI_HOME, 'library', 'papers'),
  fulltext: path.join(SCI_HOME, 'library', 'fulltext'),
  pdfs: path.join(SCI_HOME, 'library', 'pdfs'),
  figures: path.join(SCI_HOME, 'library', 'figures'),
  notes: path.join(SCI_HOME, 'notes'),
  briefs: path.join(SCI_HOME, 'briefs'),
  searches: path.join(SCI_HOME, 'searches'),
  exports: path.join(SCI_HOME, 'exports'),
  reviews: path.join(SCI_HOME, 'reviews'),
  cache: path.join(SCI_HOME, 'cache'),
  bin: path.join(SCI_HOME, 'bin'),
  log: path.join(SCI_HOME, 'log.jsonl'),
  state: path.join(SCI_HOME, 'state.json'),
  protocol: path.join(SCI_HOME, 'AGENTS.md'),
  ideas: path.join(SCI_HOME, 'ideas.jsonl'),
  screening: path.join(SCI_HOME, 'screening.jsonl'),
  topics: path.join(SCI_HOME, 'topics'),
  annotations: path.join(SCI_HOME, 'annotations'),
  topicsFile: path.join(SCI_HOME, 'topics.json'),
}

export const PUBLICATION_TYPES = [
  'Randomized Controlled Trial', 'Clinical Trial', 'Systematic Review', 'Meta-Analysis',
  'Review', 'Guideline', 'Observational Study', 'Case Reports', 'Preprint',
  'Editorial', 'Comment', 'Letter', 'Retraction of Publication', 'Published Erratum',
  'Comparative Study', 'Evaluation Study',
]
const PUB_TYPE_ALIASES = new Map(Object.entries({
  rct: 'Randomized Controlled Trial',
  'randomized controlled trial': 'Randomized Controlled Trial',
  'randomised controlled trial': 'Randomized Controlled Trial',
  'clinical trial': 'Clinical Trial',
  'systematic review': 'Systematic Review',
  review: 'Review',
  'meta-analysis': 'Meta-Analysis',
  'meta analysis': 'Meta-Analysis',
  meta: 'Meta-Analysis',
  guideline: 'Guideline',
  guidelines: 'Guideline',
  'observational study': 'Observational Study',
  cohort: 'Observational Study',
  'case report': 'Case Reports',
  'case reports': 'Case Reports',
  preprint: 'Preprint',
  editorial: 'Editorial',
  comment: 'Comment',
  letter: 'Letter',
  retraction: 'Retraction of Publication',
  'retraction of publication': 'Retraction of Publication',
  erratum: 'Published Erratum',
  correction: 'Published Erratum',
  'published erratum': 'Published Erratum',
  'comparative study': 'Comparative Study',
  'evaluation study': 'Evaluation Study',
}))

export function canonicalPublicationType(value) {
  const key = String(value ?? '').trim()
  if (!key) return ''
  const exact = PUBLICATION_TYPES.find((x) => x.toLowerCase() === key.toLowerCase())
  return exact ?? PUB_TYPE_ALIASES.get(key.toLowerCase()) ?? ''
}
export function canonicalPublicationTypes(values = []) {
  return [...new Set((values ?? []).map(canonicalPublicationType).filter(Boolean))]
}

export const DEFAULTS = {
  researcher: {
    name: '博士生',
    field: '生物医学',
    species: '',
    keywords: [],
    venues: [],
    issns: [],
    methods: [],
    studyTypes: [],
    excludeTypes: ['Editorial', 'Comment', 'Letter', 'Retraction of Publication', 'Published Erratum'],
    exclude: [],
    evidenceMode: 'clinical',
    pico: { population: '', intervention: '', comparator: '', outcome: '' },
  },
  sources: {
    openalex: true,
    arxiv: false,
    biorxiv: true,
    europepmc: true,
    pubmed: true,
    crossref: false,
    clinicaltrials: false,
    email: '',
    options: {
      openalex: { email: '' },
      pubmed: { email: '' },
      crossref: { email: '' },
      unpaywall: { email: '' },
    },
  },
  search: {
    lookbackDays: 14,
    perSource: 10,
    maxCandidates: 8,
    seenDays: 14,
    discoveryOAOnly: false,
    includePreprints: false,
    includeRepositories: false,
    includeNoAbstract: false,
    includeEditorials: false,
    includeGuidelines: true,
    titleAbstractOnly: true,
    synonymExpansion: true,
  },
  schedule: {
    mode: 'auto',
    times: ['09:30', '21:30'],
    days: [1, 2, 3, 4, 5],
    deepReadPerWake: 1,
    weeklyReviewDay: 7,
  },
  reading: {
    maxCharsPerChunk: 16000,
    downloadPdf: true,
    keepPdfDays: 30,
    downloadFigures: true,
    maxFigures: 8,
    enrichDatabases: true,
    usePubtator: true,
    maxEntities: 8,
  },
  execution: {
    sessionId: 'dsh-sci',
    workspaceId: '',
  },
  output: {
    dir: '',
  },
  topics: {
    selected: [],
    autoScope: true,
    maxQueries: 2,
  },
  privacy: {
    redactQueries: true,
    logQueries: true,
  },
  ui: {
    language: 'zh',
  },
}

const clone = (v) => JSON.parse(JSON.stringify(v))

export function deepMerge(base, ...overrides) {
  const out = clone(base ?? {})
  for (const over of overrides) {
    if (!over || typeof over !== 'object' || Array.isArray(over)) continue
    for (const [k, v] of Object.entries(over)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = deepMerge(out[k] ?? {}, v)
      } else if (v !== undefined) {
        out[k] = v
      }
    }
  }
  return out
}

export function readConfig() {
  let raw = {}
  try {
    raw = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'))
  } catch {
    raw = {}
  }
  return sanitizeConfig(deepMerge(DEFAULTS, raw))
}

export function writeConfig(config) {
  const clean = sanitizeConfig(deepMerge(DEFAULTS, config))
  fs.mkdirSync(path.dirname(CFG_FILE), { recursive: true })
  atomicWrite(CFG_FILE, JSON.stringify(clean, null, 2) + '\n', 0o600)
  return clean
}

/** 把任意输入收敛成“已知字段 + 合法值”。所有写路径都必须经过这里。 */
export function sanitizeConfig(input) {
  const src = input && typeof input === 'object' ? input : {}
  const d = DEFAULTS
  const str = (v, fallback = '', max = 300) =>
    typeof v === 'string' ? v.trim().slice(0, max) : fallback
  const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback)
  const num = (v, fallback, min, max) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return fallback
    return Math.min(max, Math.max(min, n))
  }
  const list = (v, fallback = [], maxItems = 24, maxLen = 120) => {
    if (!Array.isArray(v)) return clone(fallback)
    return [...new Set(v.map((x) => str(x, '', maxLen)).filter(Boolean))].slice(0, maxItems)
  }
  const time = (v) => {
    const m = String(v ?? '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/)
    return m ? `${m[1]}:${m[2]}` : null
  }
  const day = (v) => {
    const n = Number(v)
    return Number.isInteger(n) && n >= 1 && n <= 7 ? n : null
  }

  const r = src.researcher ?? {}
  const s = src.sources ?? {}
  const q = src.search ?? {}
  const sc = src.schedule ?? {}
  const rd = src.reading ?? {}
  const pr = src.privacy ?? {}
  const ex = src.execution ?? {}
  const out = src.output ?? {}
  const tp = src.topics ?? {}
  const ui = src.ui ?? {}
  const pico = r.pico && typeof r.pico === 'object' ? r.pico : {}

  let times = Array.isArray(sc.times) ? sc.times.map(time).filter(Boolean) : clone(d.schedule.times)
  times = [...new Set(times)].sort()
  if (!times.length) times = clone(d.schedule.times)

  let days = Array.isArray(sc.days) ? sc.days.map(day).filter(Boolean) : clone(d.schedule.days)
  days = [...new Set(days)].sort((a, b) => a - b)
  if (!days.length) days = clone(d.schedule.days)

  const email = str(s.email, d.sources.email, 200)
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
  const validOptEmail = (v) => {
    const x = str(v, '', 200)
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x) ? x : ''
  }
  const mode = ['clinical', 'basic', 'methods', 'computational'].includes(r.evidenceMode) ? r.evidenceMode : d.researcher.evidenceMode
  const discoveryOAOnly = typeof q.discoveryOAOnly === 'boolean'
    ? q.discoveryOAOnly
    : (typeof q.openAccessOnly === 'boolean' ? q.openAccessOnly : d.search.discoveryOAOnly)

  return {
    researcher: {
      name: str(r.name, d.researcher.name, 60) || d.researcher.name,
      field: str(r.field, d.researcher.field, 200),
      species: str(r.species, d.researcher.species, 50),
      keywords: list(r.keywords, d.researcher.keywords, 30, 120),
      venues: list(r.venues, d.researcher.venues, 30, 120),
      issns: list(r.issns, d.researcher.issns, 30, 20).map((x) => x.replace(/[^0-9Xx-]/g, '').toUpperCase()).filter(Boolean),
      methods: list(r.methods, d.researcher.methods, 24, 100),
      studyTypes: canonicalPublicationTypes(list(r.studyTypes, [], 20, 60)),
      excludeTypes: (() => {
        const raw = list(r.exclude, [], 24, 60)
        const hasExplicit = Array.isArray(r.excludeTypes)
        const explicit = list(r.excludeTypes, [], 24, 60)
        const migrated = raw.filter((x) => canonicalPublicationType(x))
        return canonicalPublicationTypes(hasExplicit ? explicit : migrated.length ? migrated : d.researcher.excludeTypes)
      })(),
      exclude: list(r.exclude, [], 24, 60).filter((x) => !canonicalPublicationType(x)),
      evidenceMode: mode,
      pico: {
        population: str(pico.population, '', 300),
        intervention: str(pico.intervention, '', 300),
        comparator: str(pico.comparator, '', 300),
        outcome: str(pico.outcome, '', 300),
      },
    },
    sources: {
      openalex: bool(s.openalex, d.sources.openalex),
      arxiv: bool(s.arxiv, d.sources.arxiv),
      biorxiv: bool(s.biorxiv, d.sources.biorxiv),
      europepmc: bool(s.europepmc, d.sources.europepmc),
      pubmed: bool(s.pubmed, d.sources.pubmed),
      crossref: bool(s.crossref, d.sources.crossref),
      clinicaltrials: bool(s.clinicaltrials, d.sources.clinicaltrials),
      email: validEmail,
      options: {
        openalex: { email: validOptEmail(s.options?.openalex?.email) },
        pubmed: { email: validOptEmail(s.options?.pubmed?.email) },
        crossref: { email: validOptEmail(s.options?.crossref?.email) },
        unpaywall: { email: validOptEmail(s.options?.unpaywall?.email) },
      },
    },
    search: {
      lookbackDays: Math.round(num(q.lookbackDays, d.search.lookbackDays, 1, 3650)),
      perSource: Math.round(num(q.perSource, d.search.perSource, 1, 50)),
      maxCandidates: Math.round(num(q.maxCandidates, d.search.maxCandidates, 1, 30)),
      seenDays: Math.round(num(q.seenDays, d.search.seenDays, 1, 365)),
      discoveryOAOnly,
      includePreprints: bool(q.includePreprints, mode !== 'clinical'),
      includeRepositories: bool(q.includeRepositories, d.search.includeRepositories),
      includeNoAbstract: bool(q.includeNoAbstract, d.search.includeNoAbstract),
      includeEditorials: bool(q.includeEditorials, d.search.includeEditorials),
      includeGuidelines: bool(q.includeGuidelines, d.search.includeGuidelines),
      titleAbstractOnly: bool(q.titleAbstractOnly, d.search.titleAbstractOnly),
      synonymExpansion: bool(q.synonymExpansion, d.search.synonymExpansion),
    },
    schedule: {
      mode: ['manual', 'auto'].includes(sc.mode) ? sc.mode : (sc.enabled === false ? 'manual' : 'auto'),
      times,
      days,
      deepReadPerWake: Math.round(num(sc.deepReadPerWake, d.schedule.deepReadPerWake, 1, 3)),
      weeklyReviewDay: day(sc.weeklyReviewDay) ?? d.schedule.weeklyReviewDay,
    },
    reading: {
      maxCharsPerChunk: Math.round(num(rd.maxCharsPerChunk, d.reading.maxCharsPerChunk, 4000, 60000)),
      downloadPdf: bool(rd.downloadPdf, d.reading.downloadPdf),
      keepPdfDays: Math.round(num(rd.keepPdfDays, d.reading.keepPdfDays, 0, 3650)),
      downloadFigures: bool(rd.downloadFigures, d.reading.downloadFigures),
      maxFigures: Math.round(num(rd.maxFigures, d.reading.maxFigures, 0, 30)),
      enrichDatabases: bool(rd.enrichDatabases, d.reading.enrichDatabases),
      usePubtator: bool(rd.usePubtator, d.reading.usePubtator),
      maxEntities: Math.round(num(rd.maxEntities, d.reading.maxEntities, 1, 30)),
    },
    execution: {
      sessionId: str(ex.sessionId, d.execution.sessionId, 100).replace(/[^\w.:-]+/g, '-') || d.execution.sessionId,
      workspaceId: str(ex.workspaceId, d.execution.workspaceId, 100),
    },
    output: {
      dir: str(out.dir, d.output.dir, 500),
    },
    topics: {
      selected: list(tp.selected, d.topics.selected, 30, 100),
      autoScope: bool(tp.autoScope, d.topics.autoScope),
      maxQueries: Math.round(num(tp.maxQueries, d.topics.maxQueries, 0, 5)),
    },
    privacy: {
      redactQueries: bool(pr.redactQueries, d.privacy.redactQueries),
      logQueries: bool(pr.logQueries, d.privacy.logQueries),
    },
    ui: {
      language: str(ui.language, d.ui.language, 10) || d.ui.language,
    },
  }
}

/* ── secrets ─────────────────────────────────────────────────────────────── */

export const SECRET_KEYS = ['openalexApiKey', 'unpaywallEmail', 'semanticScholarApiKey', 'ncbiApiKey']

export function readSecrets() {
  try {
    const raw = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'))
    const out = {}
    for (const k of SECRET_KEYS) out[k] = typeof raw[k] === 'string' ? raw[k] : ''
    return out
  } catch {
    return Object.fromEntries(SECRET_KEYS.map((k) => [k, '']))
  }
}

export function writeSecrets(next) {
  const out = {}
  for (const k of SECRET_KEYS) out[k] = typeof next?.[k] === 'string' ? next[k].trim() : ''
  fs.mkdirSync(path.dirname(SECRETS_FILE), { recursive: true })
  atomicWrite(SECRETS_FILE, JSON.stringify(out, null, 2) + '\n', 0o600)
  return out
}

export function secretState() {
  const s = readSecrets()
  return {
    openalexApiKey: Boolean(s.openalexApiKey),
    unpaywallEmail: Boolean(s.unpaywallEmail),
    semanticScholarApiKey: Boolean(s.semanticScholarApiKey),
    ncbiApiKey: Boolean(s.ncbiApiKey),
  }
}

export function emailFor(source, cfg = readConfig(), secrets = readSecrets()) {
  const own = cfg.sources.options?.[source]?.email
  if (own) return own
  if (cfg.sources.email) return cfg.sources.email
  if (source === 'unpaywall') return secrets.unpaywallEmail || ''
  return ''
}

export function contactEmail() {
  return emailFor('openalex')
}

export function ncbiApiKey() {
  return process.env.NCBI_API_KEY || readSecrets().ncbiApiKey || ''
}

/** 用户可见输出（笔记/简报/周总结/检索策略/导出）的根目录。空值 = 数据目录本身。 */
export function outputRoot(cfg = readConfig()) {
  const raw = String(cfg.output?.dir ?? '').trim()
  if (!raw) return SCI_HOME
  const expanded = raw === '~' ? os.homedir() : raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(2)) : raw
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(SCI_HOME, expanded)
}

export function outputPaths(cfg = readConfig()) {
  const root = outputRoot(cfg)
  return {
    root,
    notes: path.join(root, 'notes'),
    briefs: path.join(root, 'briefs'),
    reviews: path.join(root, 'reviews'),
    searches: path.join(root, 'searches'),
    exports: path.join(root, 'exports'),
    ideas: path.join(root, 'ideas.jsonl'),
    methods: path.join(root, 'methods'),
  }
}

/* ── storage ─────────────────────────────────────────────────────────────── */

export function ensureDataDirs() {
  const out = outputPaths()
  for (const p of [PATHS.home, PATHS.papers, PATHS.fulltext, PATHS.pdfs, PATHS.figures,
    PATHS.cache, PATHS.bin, PATHS.topics, PATHS.annotations, path.dirname(PATHS.log),
    out.notes, out.briefs, out.reviews, out.searches, out.exports, out.methods]) {
    fs.mkdirSync(p, { recursive: true })
  }
}

export function atomicWrite(file, text, mode = 0o644) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`)
  fs.writeFileSync(tmp, text, { mode })
  try {
    fs.chmodSync(tmp, mode)
  } catch {}
  fs.renameSync(tmp, file)
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJson(file, value, mode = 0o644) {
  atomicWrite(file, JSON.stringify(value, null, 2) + '\n', mode)
}

/* ── paper identity ──────────────────────────────────────────────────────── */

export function normalizeDoi(doi) {
  if (!doi) return ''
  return String(doi)
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase()
}

export function normalizeArxiv(id) {
  if (!id) return ''
  return String(id)
    .trim()
    .replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//i, '')
    .replace(/^arxiv:\s*/i, '')
    .replace(/\.pdf$/i, '')
    .replace(/v\d+$/i, '')
}

export function paperKey(paper) {
  if (paper?.doi) return 'doi-' + normalizeDoi(paper.doi).replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120)
  if (paper?.arxivId) return 'arxiv-' + normalizeArxiv(paper.arxivId).replace(/[^a-z0-9.-]+/gi, '-')
  if (paper?.pmid) return 'pmid-' + String(paper.pmid).replace(/\D/g, '')
  if (paper?.pmcid) return 'pmcid-' + String(paper.pmcid).replace(/[^a-z0-9]/gi, '').toUpperCase()
  const seed = `${paper?.title ?? ''}|${paper?.year ?? ''}|${paper?.authors?.[0]?.name ?? ''}`
  return 'title-' + crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16)
}

export function paperFile(paper) {
  return path.join(PATHS.papers, `${paperKey(paper)}.json`)
}


export function fulltextFile(paper) {
  return path.join(PATHS.fulltext, `${paperKey(paper)}.txt`)
}

export function pdfFile(paper) {
  return path.join(PATHS.pdfs, `${paperKey(paper)}.pdf`)
}

export function loadPaper(idOrPaper) {
  if (idOrPaper && typeof idOrPaper === 'object') {
    const f = paperFile(idOrPaper)
    return readJson(f, null) ?? idOrPaper
  }
  const key = String(idOrPaper ?? '').replace(/\.json$/i, '')
  return readJson(path.join(PATHS.papers, `${key}.json`), null)
}


/* ── state / log ─────────────────────────────────────────────────────────── */

export function readState() {
  return readJson(PATHS.state, {}) ?? {}
}

export function writeState(patch) {
  const next = { ...readState(), ...patch, updatedAt: new Date().toISOString() }
  writeJson(PATHS.state, next)
  return next
}

export function appendLog(kind, note, extra = {}) {
  try {
    ensureDataDirs()
    fs.appendFileSync(PATHS.log, JSON.stringify({
      at: new Date().toISOString(),
      kind,
      note: String(note ?? '').slice(0, 500),
      ...extra,
    }) + '\n')
  } catch {}
}

export function todayLocal() {
  return new Date().toLocaleDateString('sv-SE')
}

export function localDate(iso) {
  const d = iso ? new Date(iso) : new Date()
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('sv-SE')
}
