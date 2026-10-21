/**
 * 用真实数据库注释给阅读/笔记“接地”。
 *
 * 关键原则：
 * - 只把数据库返回的 ID/字段当作事实；模型记忆不进入 annotations。
 * - 基因符号歧义大：只接受 NCBI Gene/Ensembl 能精确解析的候选；其余放 unresolved。
 * - 变异必须带 build 和等位基因；没有 build 时只做标识符级查询，不推断坐标。
 * - 每次结果缓存，避免同一篇文章反复打 API。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { PATHS, readConfig, readJson, atomicWrite } from './config.mjs'
import { databaseGet, databaseSearch } from './databases.mjs'

const STOP = new Set(['DNA', 'RNA', 'MRNA', 'CDNA', 'CRISPR', 'GWAS', 'AI', 'LLM', 'LLMS', 'FDA', 'EMA', 'WHO', 'NIH', 'NGS', 'PCR', 'CI', 'SD', 'SEM', 'AUC', 'ROC', 'MCC', 'F1', 'GPU', 'CPU', 'TP53TG5', 'COVID', 'SARS', 'HIV', 'Mtb', 'TCGA', 'GEO', 'SRA', 'ENA', 'PRIDE', 'HCA', 'GTEX', 'HPA', 'PDB', 'EMDB'])
const GENE_TOKEN = /\b[A-Z][A-Z0-9]{1,9}\b/g
const RS = /\brs\d+\b/gi
const HGVS = /\b(?:[A-Z]{1,4}_?\d+(?:\.\d+)?:)?[cgmn]\.\d+[ACGT]>[ACGT]\b/gi
const GENOMIC = /\b(?:chr)?([0-9XYM]{1,2})[:\-](\d{2,})[\s:_-]*([ACGT]+)[>\/]([ACGT]+)\b/gi
const ACC = [
  ['geo', /\bGSE\d{3,}\b/gi], ['geo', /\bGDS\d{3,}\b/gi], ['geo', /\bGPL\d{3,}\b/gi], ['geo', /\bGSM\d{3,}\b/gi],
  ['sra', /\bPRJ[NAEDB]\d{4,}\b/gi], ['sra', /\bSR[RXSPZ]\d{5,}\b/gi], ['sra', /\bSAM[NED][A-Z]?\d{4,}\b/gi],
  ['ena', /\bERR\d{5,}\b/gi], ['ena', /\bDRR\d{5,}\b/gi], ['ena', /\bE-MTAB-\d{3,}\b/gi],
  ['pride', /\bPXD\d{5,}\b/gi], ['dbgap', /\bphs\d{6,}\b/gi], ['ega', /\bEGA[SD]\d{5,}\b/gi],
  ['clinicaltrials', /\bNCT\d{8}\b/gi], ['pdb', /\b(?!19|20)[0-9][A-Za-z0-9]{2}[A-Za-z]\b/g], ['emdb', /\bEMD-\d{4,}\b/gi],
  ['ensembl', /\bENS[GTPE]\d{6,}(?:\.\d+)?\b/gi],
]

function uniq(xs) { return [...new Set(xs.filter(Boolean))] }
function cacheFile(key) { return path.join(PATHS.annotations, `${key}.json`) }
function hashKey(s) { return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16) }

export function extractCandidates({ text = '', title = '', keywords = [], genes = [] } = {}) {
  const body = `${title}\n${text}`
  const explicit = String(genes ?? '').split(/[,;，]/).map((x) => x.trim()).filter(Boolean)
  const tokens = []
  const geneText = `${title}\n${(keywords ?? []).join(' ')}`
  for (const m of geneText.match(GENE_TOKEN) ?? []) {
    if (STOP.has(m.toUpperCase())) continue
    if (!/[0-9]/.test(m)) continue // 无数字的基因符号太容易误报；用 --genes 显式指定
    tokens.push(m)
  }
  const candidates = uniq([...explicit, ...tokens]).slice(0, 12)
  const accessions = []
  for (const [db, re] of ACC) for (const m of body.match(re) ?? []) accessions.push({ db, id: m.toUpperCase() })
  const rsids = uniq((body.match(RS) ?? []).map((x) => x.toLowerCase()))
  const hgvs = uniq(body.match(HGVS) ?? [])
  const genomic = []
  for (const m of body.match(GENOMIC) ?? []) {
    genomic.push(m.replace(/^chr/i, '').toUpperCase())
  }
  return {
    genes: candidates,
    accessions: uniq(accessions.map((x) => `${x.db}:${x.id}`)).map((x) => { const [db, ...r] = x.split(':'); return { db, id: r.join(':') } }),
    rsids,
    hgvs,
    genomic: uniq(genomic),
    explicit,
  }
}

function fieldMap(items, keys) {
  return (items ?? []).map((x) => Object.fromEntries(keys.map((k) => [k, x[k]]).filter(([, v]) => v != null && v !== '')))
}

async function geneAnnotations(symbol, species) {
  const out = []
  const g = await databaseSearch('ncbi-gene', symbol, { species, limit: 5 })
  if (g.ok && g.items?.length) {
    const exact = g.items.find((x) => String(x.symbol).toUpperCase() === String(symbol).toUpperCase()) ?? g.items[0]
    if (String(exact.symbol).toUpperCase() === String(symbol).toUpperCase()) {
      out.push({ db: 'ncbi-gene', fields: { geneId: exact.geneId, symbol: exact.symbol, name: exact.name, organism: exact.organism, chromosome: exact.chromosome, location: exact.location, aliases: exact.aliases } })
    }
  }
  const e = await databaseGet('ensembl', symbol, { species })
  if (e.ok && e.items?.length) {
    const x = e.items[0]
    out.push({ db: 'ensembl', fields: { id: x.id, symbol: x.symbol, description: x.description, assembly: x.assembly, chrom: x.chrom, start: x.start, end: x.end, strand: x.strand, biotype: x.biotype } })
  }
  const u = await databaseSearch('uniprot', `gene:${symbol}`, { species, limit: 3 })
  if (u.ok && u.items?.length) {
    const x = u.items.find((z) => String(z.gene).toUpperCase() === String(symbol).toUpperCase()) ?? u.items[0]
    out.push({ db: 'uniprot', fields: { accession: x.accession, id: x.id, name: x.name, gene: x.gene, organism: x.organism, length: x.length } })
  }
  return out
}

async function variantAnnotations(rsid, build) {
  const out = []
  const isHgvs = /[a-z]\.\d+/.test(String(rsid))
  if (isHgvs) {
    const c = await databaseSearch('clinvar', rsid, { limit: 3 })
    if (c.ok && c.items?.length) out.push({ db: 'clinvar', fields: fieldMap(c.items.slice(0, 3), ['variationId', 'title', 'gene', 'classification', 'review', 'conditions']) })
    return out
  }
  const d = await databaseGet('dbsnp', rsid)
  if (d.ok && d.items?.length) out.push({ db: 'dbsnp', fields: fieldMap(d.items.slice(0, 1), ['rsid', 'createDate', 'placements']) })
  const c = await databaseSearch('clinvar', rsid, { limit: 3 })
  if (c.ok && c.items?.length) out.push({ db: 'clinvar', fields: fieldMap(c.items.slice(0, 3), ['variationId', 'title', 'gene', 'classification', 'review', 'conditions']) })
  if (build && /^([0-9XYM]{1,2})-(\d+)-([ACGT]+)-([ACGT]+)$/i.test(rsid)) {
    const g = await databaseGet('gnomad', rsid, { build, dataset: 'gnomad_r4' })
    if (g.ok && g.items?.length) out.push({ db: 'gnomad', fields: fieldMap(g.items.slice(0, 1), ['variant_id', 'rsids', 'chrom', 'pos', 'ref', 'alt', 'exome', 'genome']) })
  }
  return out
}

async function accessionAnnotations(acc) {
  if (!['geo', 'sra', 'ena', 'pride', 'pdb', 'emdb', 'clinicaltrials', 'ensembl'].includes(acc.db)) return []
  const r = await databaseGet(acc.db, acc.id, { limit: 3 })
  return r.ok && r.items?.length ? [{ db: acc.db, fields: r.items.slice(0, 2) }] : []
}

async function mapLimit(items, limit, fn) {
  const out = []
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      try { out[idx] = await fn(items[idx], idx) } catch (e) { out[idx] = { error: String(e?.message ?? e) } }
    }
  })
  await Promise.all(workers)
  return out
}

export async function groundPaper(paper, text = '', {
  species = '', build = '', genes = '', maxEntities = 8, refresh = false,
} = {}) {
  const cfg = readConfig()
  species = species || cfg.researcher?.species || ''
  build = build || ''
  const candidates = extractCandidates({ text, title: paper?.title ?? '', keywords: paper?.keywords ?? [], genes })
  const cacheKey = hashKey(JSON.stringify({ key: paper?.key, species, build, candidates }))
  const file = cacheFile(cacheKey)
  if (!refresh) {
    const hit = readJson(file, null)
    if (hit && Date.now() - new Date(hit.generatedAt).getTime() < 7 * 864e5) return hit
  }
  const limit = Math.max(1, Math.min(30, Number(maxEntities) || 8))
  const genesIn = candidates.genes.slice(0, limit)
  const variantsIn = [...candidates.rsids, ...candidates.genomic, ...candidates.hgvs].slice(0, limit)
  const accessionsIn = candidates.accessions.slice(0, limit)
  const entities = []
  const warnings = []
  if (!species) warnings.push('未指定物种；基因注释可能不完整。用 --species human/mouse/9606 更可靠。')
  if (!build && variantsIn.length) warnings.push('未指定基因组版本；变异坐标/频率只做了标识符级核对。')

  const geneRows = await mapLimit(genesIn, 2, async (symbol) => {
    const ann = await geneAnnotations(symbol, species)
    const exact = ann.some((a) => a.db === 'ncbi-gene' || a.db === 'ensembl')
    if (!exact) return null
    return { type: 'gene', query: symbol, status: 'verified', annotations: ann, warnings: [] }
  })
  entities.push(...geneRows.filter(Boolean))
  const explicitSet = new Set(candidates.explicit.map((x) => String(x).toUpperCase()))
  const unresolvedGenes = genesIn.filter((g) => !geneRows.some((x) => x?.query === g))
  for (const g of unresolvedGenes) {
    if (!explicitSet.has(String(g).toUpperCase())) continue
    entities.push({ type: 'gene', query: g, status: 'unresolved', annotations: [], warnings: ['NCBI Gene/Ensembl 未精确解析；不要把它当作已核对基因。'] })
  }

  const variantRows = await mapLimit(variantsIn, 2, async (v) => {
    const ann = await variantAnnotations(v, build)
    return ann.length ? { type: 'variant', query: v, status: 'verified', annotations: ann, warnings: build ? [] : ['未指定 build；坐标/频率未做完整核对。'] } : null
  })
  entities.push(...variantRows.filter(Boolean))
  const unresolvedHgvs = candidates.hgvs.filter((h) => !entities.some((e) => e.type === 'variant' && e.query === h))
  for (const h of unresolvedHgvs) {
    entities.push({ type: 'variant', query: h, status: 'unresolved', annotations: [], warnings: ['ClinVar 未解析该 HGVS；不要把它当作已核对变异。'] })
  }

  const accRows = await mapLimit(accessionsIn, 2, async (a) => {
    const ann = await accessionAnnotations(a)
    return ann.length ? { type: 'accession', query: `${a.db}:${a.id}`, status: 'verified', annotations: ann, warnings: [] } : null
  })
  entities.push(...accRows.filter(Boolean))

  const result = {
    version: 1,
    generatedAt: new Date().toISOString(),
    paper: paper ? { key: paper.key, title: paper.title ?? '' } : null,
    species: species || null,
    build: build || null,
    candidates,
    entities,
    unresolved: entities.filter((e) => e.status !== 'verified').map((e) => e.query),
    warnings,
    disclaimer: '只使用这里返回的数据库 ID/字段；未列出的基因、变异、坐标、结构不要写成数据库事实。',
  }
  atomicWrite(file, JSON.stringify(result, null, 2) + '\n')
  return result
}

export function groundingMarkdown(g) {
  const lines = ['## 数据库核对（自动）', '']
  if (!g) return lines.concat('未运行数据库核对。').join('\n')
  if (g.species || g.build) lines.push(`- 物种：${g.species || '未指定'} · 基因组版本：${g.build || '未指定'}`)
  if (!g.entities.length) lines.push('- 没有解析到可核对的实体。')
  for (const e of g.entities) {
    if (e.status !== 'verified') { lines.push(`- ⚠️ **${e.type} \`${e.query}\`**：未在权威库精确解析，不能当作已核对事实。`); continue }
    const bits = e.annotations.map((a) => `${a.db} ${JSON.stringify(a.fields).slice(0, 260)}`)
    lines.push(`- ✅ **${e.type} \`${e.query}\`**：${bits.join(' · ')}`)
  }
  for (const w of g.warnings ?? []) lines.push(`- ⚠️ ${w}`)
  lines.push('', `> ${g.disclaimer}`)
  return lines.join('\n')
}
