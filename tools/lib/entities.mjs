/**
 * 生物实体识别 / 规范化 / 查询构建。
 *
 * 解析顺序：明确类型 > 规范 ID > 权威库解析 > 同义词扩展。
 * 不默认人类；species 必须显式传入，否则查询里不写物种限制并在 warnings 中提示。
 */
import { databaseGet, databaseSearch } from './databases.mjs'

const RS = /^rs\d+$/i
const ENSG = /^ENS[GTPE]\d+(?:\.\d+)?$/i
const UNIPROT = /^[A-Z0-9]{6,10}(?:-\d+)?$/
const GENE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,30}$/
const ACC = [
  ['geo', /^GSE\d+$/i], ['geo', /^GDS\d+$/i], ['geo', /^GPL\d+$/i],
  ['sra', /^PRJ[NAEDB]\d+$/i], ['sra', /^SR[RXSPZ]\d+$/i], ['ena', /^ERR\d+$/i], ['ena', /^DRR\d+$/i],
  ['ena', /^E-MTAB-\d+$/i], ['pride', /^PXD\d+$/i], ['hca', /^[0-9a-f-]{36}$/i],
  ['clinicaltrials', /^NCT\d+$/i], ['pdb', /^[0-9][A-Za-z0-9]{3}$/],
  ['emdb', /^EMD-\d+$/i], ['dbsnp', RS], ['hpo', /^HP:\d+$/i], ['quickgo', /^GO:\d+$/i],
  ['monarch', /^MONDO:\d+$/i], ['chembl', /^CHEMBL\d+$/i], ['pubchem', /^CID:\d+$/i],
  ['ensembl', ENSG],
]

export function detectAccession(input) {
  const s = String(input ?? '').trim()
  for (const [db, re] of ACC) if (re.test(s)) return { db, id: db === 'pubchem' ? s.replace(/^CID:/i, '') : s }
  if (UNIPROT.test(s) && /[A-Z]/.test(s) && /\d/.test(s)) return { db: 'uniprot', id: s }
  return null
}

const ALIAS_SPLIT = /[,;|]/

function aliasesOf(text) {
  return String(text ?? '').split(ALIAS_SPLIT).map((x) => x.trim()).filter((x) => x && x.length <= 40 && !/^\d+$/.test(x))
}

export async function resolveEntity({ type = 'gene', id, species = '' } = {}) {
  const value = String(id ?? '').trim()
  if (!value) throw new Error('entity resolve 需要 id')
  const warnings = []
  if (!species) warnings.push('未指定物种；基因符号可能跨物种歧义。建议 --species human/mouse/9606。')
  const t = String(type).toLowerCase()
  if ((t === 'gene' || t === 'auto') && GENE.test(value)) {
    const g = await databaseSearch('ncbi-gene', value, { species, limit: 5 })
    if (g.ok && g.items?.length) {
      const x = g.items[0]
      return { ok: true, type: 'gene', id: value, canonical: x.symbol || value, aliases: aliasesOf(x.aliases), ids: { ncbiGene: x.geneId }, organism: x.organism, chromosome: x.chromosome, warnings, source: 'ncbi-gene' }
    }
    const e = await databaseGet('ensembl', value, { species })
    if (e.ok && e.items?.length) {
      const x = e.items[0]
      return { ok: true, type: 'gene', id: value, canonical: x.symbol || value, aliases: [], ids: { ensembl: x.id }, organism: x.species, chromosome: x.chrom, warnings, source: 'ensembl' }
    }
  }
  if (t === 'protein' || (t === 'auto' && UNIPROT.test(value))) {
    const u = await databaseGet('uniprot', value)
    if (u.ok && u.items?.length) {
      const x = u.items[0]
      return { ok: true, type: 'protein', id: value, canonical: x.gene || x.name || value, aliases: [x.id].filter(Boolean), ids: { uniprot: x.accession }, organism: x.organism, warnings, source: 'uniprot' }
    }
  }
  if (t === 'variant' || (t === 'auto' && RS.test(value))) {
    if (RS.test(value)) {
      const v = await databaseGet('dbsnp', value)
      if (v.ok && v.items?.length) return { ok: true, type: 'variant', id: value, canonical: value, aliases: [], ids: { dbsnp: value }, organism: '', warnings, source: 'dbsnp' }
    }
    const c = await databaseSearch('clinvar', value, { limit: 5 })
    if (c.ok && c.items?.length) return { ok: true, type: 'variant', id: value, canonical: value, aliases: [], ids: { clinvar: c.items[0].variationId }, organism: '', warnings, source: 'clinvar' }
  }
  const acc = detectAccession(value)
  if (acc && t === 'auto') {
    return { ok: true, type: 'accession', id: value, canonical: value, aliases: [], ids: { [acc.db]: acc.id }, organism: '', warnings, source: acc.db, accession: acc }
  }
  return { ok: false, type: t, id: value, canonical: value, aliases: [], ids: {}, organism: '', warnings: [...warnings, '没有解析到权威记录；查询将只使用原始词。'], source: '' }
}

function quoteTerms(terms) {
  return [...new Set(terms.map((x) => String(x).trim()).filter(Boolean))].slice(0, 6)
}

export function buildEntityQueries(entity, { species = '' } = {}) {
  const terms = quoteTerms([entity?.canonical, ...(entity?.aliases ?? [])])
  const orPubmed = terms.map((x) => `"${x.replace(/"/g, '')}"[tiab]`).join(' OR ')
  const orEurope = terms.map((x) => `TITLE_ABS:"${x.replace(/"/g, '')}"`).join(' OR ')
  const speciesClause = species ? ` AND ${species}[Organism]` : ''
  return {
    pubmed: terms.length ? `(${orPubmed})${speciesClause}` : '',
    europepmc: terms.length ? `(${orEurope})` : '',
    terms,
    warning: species ? '' : '未指定物种，PubMed 查询没有物种限制。',
  }
}
