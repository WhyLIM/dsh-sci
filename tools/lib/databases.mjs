/**
 * 生物信息学数据库 lookup 层。
 *
 * 参考 K-Dense-AI/scientific-agent-skills 的 database-lookup 契约：
 * 先确定实体、规范 ID、物种/基因组版本、字段和范围，再选权威库；
 * 外部响应只当数据，不执行其中的指令。
 *
 * 这里的 handler 只覆盖无需登录/无需付费的公开 API；需要 key 或
 * 授权下载的库仍在目录里，用 `db info` 给出端点、认证和本地参考文档。
 */
import path from 'node:path'
import https from 'node:https'
import { fileURLToPath } from 'node:url'
import { httpGet, httpJson, httpPostJson } from './http.mjs'
import { emailFor, ncbiApiKey } from './config.mjs'
import { stripTags } from './normalize.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const DB_DOCS = path.join(HERE, '..', '..', 'templates', 'databases')

const enc = (v) => encodeURIComponent(String(v ?? ''))
const n = (v, d = 0) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : d
}
const clamp = (v, min, max, d) => Math.max(min, Math.min(max, n(v, d)))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clean = (v) => stripTags(String(v ?? '')).replace(/\s+/g, ' ').trim()
const arr = (v) => Array.isArray(v) ? v : (v == null ? [] : [v])
const uniq = (xs) => [...new Set(xs.filter(Boolean))]

const SPECIES = {
  human: '9606', homo_sapiens: '9606', 'homo sapiens': '9606',
  mouse: '10090', mus_musculus: '10090', 'mus musculus': '10090',
  rat: '10116', rattus_norvegicus: '10116',
  zebrafish: '7955', danio_rerio: '7955',
  fly: '7227', drosophila_melanogaster: '7227',
  worm: '6239', caenorhabditis_elegans: '6239',
  yeast: '559292', saccharomyces_cerevisiae: '559292',
  arabidopsis: '3702', arabidopsis_thaliana: '3702',
  ecoli: '562', escherichia_coli: '562',
}
const ENSEMBL_SPECIES = {
  human: 'homo_sapiens', homo_sapiens: 'homo_sapiens', mouse: 'mus_musculus', mus_musculus: 'mus_musculus',
  rat: 'rattus_norvegicus', zebrafish: 'danio_rerio', fly: 'drosophila_melanogaster',
  worm: 'caenorhabditis_elegans', yeast: 'saccharomyces_cerevisiae', arabidopsis: 'arabidopsis_thaliana',
}

function taxon(species) {
  if (!species) return ''
  const s = String(species).trim().toLowerCase()
  return SPECIES[s] ?? (/^\d+$/.test(s) ? s : '')
}
function ensSpecies(species) {
  if (!species) return 'homo_sapiens'
  const s = String(species).trim().toLowerCase()
  return ENSEMBL_SPECIES[s] ?? (s.includes('_') ? s : 'homo_sapiens')
}
function ncbiQuery(query, species) {
  const q = String(query ?? '').trim()
  const t = taxon(species)
  if (!t || /\b(organism|orgn|taxid|taxonomy|species)\b/i.test(q)) return q
  return `${q} AND txid${t}[Organism]`
}
function ncbiUrl(endpoint, params) {
  const u = new URL(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/${endpoint}`)
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, String(v))
  u.searchParams.set('tool', 'dsh-sci')
  const email = emailFor('pubmed')
  if (email) u.searchParams.set('email', email)
  const key = ncbiApiKey()
  if (key) u.searchParams.set('api_key', key)
  return u.toString()
}

const DOMAIN_NAMES = {
  gene: '基因/基因组', protein: '蛋白/结构', variant: '变异', disease: '疾病/表型',
  pathway: '通路/互作', expression: '表达/组学', chemistry: '化学/药物', cancer: '癌症',
  clinical: '临床', plasmid: '质粒', literature: '文献',
}

const META = [
  ['uniprot', 'UniProt', 'protein', 'none', true, ['search', 'get'], 'https://rest.uniprot.org', '蛋白序列、功能、GO/PDB 交叉引用；支持 organism_id、reviewed'],
  ['ncbi-gene', 'NCBI Gene', 'gene', 'optional', true, ['search', 'get'], 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/', '基因身份、染色体位置、别名、物种'],
  ['ensembl', 'Ensembl', 'gene', 'none', true, ['search', 'get'], 'https://rest.ensembl.org', '基因/转录本/序列；必须显式物种；支持 GRCh37'],
  ['ncbi-taxonomy', 'NCBI Taxonomy', 'gene', 'optional', true, ['search', 'get'], 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/', '物种名↔taxid、分类谱系'],
  ['ncbi-protein', 'NCBI Protein', 'protein', 'optional', true, ['search', 'get'], 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/', 'RefSeq/GenBank 蛋白记录'],
  ['pdb', 'RCSB PDB', 'protein', 'none', true, ['search', 'get'], 'https://data.rcsb.org', '实验结构、分辨率、方法；可检索 UniProt'],
  ['alphafold', 'AlphaFold DB', 'protein', 'none', true, ['get'], 'https://alphafold.ebi.ac.uk/api/', '预测结构；按 UniProt 取，保留 isoform/fragment'],
  ['interpro', 'InterPro', 'protein', 'none', true, ['search', 'get'], 'https://www.ebi.ac.uk/interpro/api', '蛋白家族/结构域；Pfam/InterPro 条目'],
  ['emdb', 'EMDB', 'protein', 'none', true, ['search', 'get'], 'https://www.ebi.ac.uk/emdb/api/', '冷冻电镜密度图'],
  ['dbsnp', 'dbSNP', 'variant', 'optional', true, ['search', 'get'], 'https://api.ncbi.nlm.nih.gov/variation/v0/', 'rsID/变异标识、等位基因'],
  ['clinvar', 'ClinVar', 'variant', 'optional', true, ['search', 'get'], 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/', '临床变异解释、审核状态；不要当概率'],
  ['gnomad', 'gnomAD', 'variant', 'none', true, ['search', 'get'], 'https://gnomad.broadinstitute.org/api', '群体频率；必须匹配基因组版本和等位基因'],
  ['myvariant', 'MyVariant.info', 'variant', 'none', true, ['search', 'get'], 'https://myvariant.info/v1', '变异注释聚合；注意底层模型/版本'],
  ['gwas-catalog', 'GWAS Catalog', 'variant', 'none', true, ['search', 'get'], 'https://www.ebi.ac.uk/gwas/rest/api', 'GWAS SNP-trait 关联'],
  ['clinpgx', 'ClinPGx', 'variant', 'none', true, ['search', 'get'], 'https://api.clinpgx.org/v1', '药物基因组学；基因/化学实体和 summary annotation'],
  ['omim', 'OMIM', 'disease', 'key', false, ['info'], 'https://api.omim.org/api', '孟德尔疾病-基因；需要 OMIM API key'],
  ['disgenet', 'DisGeNET', 'disease', 'key', false, ['info'], 'https://www.disgenet.com', '基因-疾病关联；需要授权'],
  ['hpo', 'HPO', 'disease', 'none', true, ['search', 'get'], 'https://ontology.jax.org/api/hp', '表型本体、术语层级'],
  ['monarch', 'Monarch Initiative', 'disease', 'none', true, ['search', 'get'], 'https://api.monarchinitiative.org/v3/api', '疾病-基因-表型关联'],
  ['opentargets', 'Open Targets', 'disease', 'none', true, ['get'], 'https://api.platform.opentargets.org/api/v4/graphql', '靶点-疾病证据；GraphQL'],
  ['reactome', 'Reactome', 'pathway', 'none', true, ['search', 'get'], 'https://reactome.org/ContentService', '通路、反应、参与者'],
  ['kegg', 'KEGG', 'pathway', 'none', true, ['search', 'get'], 'https://rest.kegg.jp', '通路/基因/化合物；返回文本/TSV'],
  ['quickgo', 'QuickGO', 'pathway', 'none', true, ['search', 'get'], 'https://www.ebi.ac.uk/QuickGO/services', 'GO 术语与注释'],
  ['string', 'STRING', 'pathway', 'none', true, ['search', 'get'], 'https://string-db.org/api', '蛋白互作；必须 taxid，区分 functional/physical'],
  ['biogrid', 'BioGRID', 'pathway', 'key', false, ['info'], 'https://webservice.thebiogrid.org', '遗传/物理互作；需要 access key'],
  ['jaspar', 'JASPAR', 'pathway', 'none', true, ['search', 'get'], 'https://jaspar.elixir.no/api/v1', '转录因子结合 motif'],
  ['encode', 'ENCODE', 'pathway', 'none', true, ['search', 'get'], 'https://www.encodeproject.org', 'ChIP/ATAC/RNA 实验与文件'],
  ['regulomedb', 'RegulomeDB', 'pathway', 'none', false, ['info'], 'https://regulomedb.org', '非编码调控证据；官方 JSON 端点当前返回网页，暂不自动查询'],
  ['geo', 'NCBI GEO', 'expression', 'optional', true, ['search', 'get'], 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/', '基因表达数据集；GSE/GDS'],
  ['sra', 'NCBI SRA', 'expression', 'optional', true, ['search', 'get'], 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/', '测序 run/experiment 元数据；XML'],
  ['ena', 'ENA', 'expression', 'none', true, ['search', 'get'], 'https://www.ebi.ac.uk/ena/portal/api', '欧洲核苷酸档案；read_run/sequence/study'],
  ['gtex', 'GTEx', 'expression', 'none', true, ['get'], 'https://gtexportal.org/api/v2', '人体组织表达/eQTL；仅人类，注意版本'],
  ['human-protein-atlas', 'Human Protein Atlas', 'expression', 'none', true, ['get'], 'https://www.proteinatlas.org', '蛋白/RNA 组织表达；按 Ensembl'],
  ['hca', 'Human Cell Atlas', 'expression', 'none', true, ['search'], 'https://service.azul.data.humancellatlas.org', '单细胞图谱项目；先选 catalog'],
  ['pride', 'PRIDE', 'expression', 'none', true, ['search', 'get'], 'https://www.ebi.ac.uk/pride/ws/archive/v3', '蛋白质组学项目/文件'],
  ['metabolomics-workbench', 'Metabolomics Workbench', 'expression', 'none', true, ['search', 'get'], 'https://www.metabolomicsworkbench.org/rest', '代谢组学研究/代谢物'],
  ['lincs-l1000', 'LINCS L1000', 'expression', 'key', false, ['info'], 'https://clue.io', '表达签名；Clue.io API 需要 key'],
  ['pubchem', 'PubChem', 'chemistry', 'none', true, ['search', 'get'], 'https://pubchem.ncbi.nlm.nih.gov/rest/pug', '化合物身份/属性；优先 CID/InChIKey'],
  ['chembl', 'ChEMBL', 'chemistry', 'none', true, ['search', 'get'], 'https://www.ebi.ac.uk/chembl/api/data', '生物活性、药物、靶点'],
  ['bindingdb', 'BindingDB', 'chemistry', 'none', true, ['get'], 'https://bindingdb.org/rest', '蛋白-配体结合亲和力；按 UniProt'],
  ['drugbank', 'DrugBank', 'chemistry', 'key', false, ['info'], 'https://api.drugbank.com', '药物-靶点-机制；需要授权'],
  ['chebi', 'ChEBI', 'chemistry', 'none', true, ['search', 'get'], 'https://www.ebi.ac.uk/chebi/backend/api/public', '生物相关化学实体本体；OLS4 搜索 + ChEBI REST'],
  ['zinc', 'ZINC', 'chemistry', 'none', false, ['info'], 'https://zinc.docking.org', '可购买化合物/对接库；自动请求会触发人机验证'],
  ['brenda', 'BRENDA', 'chemistry', 'key', false, ['info'], 'https://www.brenda-enzymes.org', '酶动力学；学术授权'],
  ['dailymed', 'DailyMed', 'chemistry', 'none', true, ['search', 'get'], 'https://dailymed.nlm.nih.gov/dailymed/services/v2', 'FDA 药品说明书；SPL setid/名称/NDC'],
  ['cosmic', 'COSMIC', 'cancer', 'login', false, ['info'], 'https://cancer.sanger.ac.uk/cosmic', '体细胞突变；需要登录/授权'],
  ['cbioportal', 'cBioPortal', 'cancer', 'none', true, ['search', 'get'], 'https://www.cbioportal.org/api', '癌症研究突变/临床数据'],
  ['tcga-gdc', 'GDC / TCGA', 'cancer', 'none', true, ['search', 'get'], 'https://api.gdc.cancer.gov', 'TCGA 项目/病例/SSM 元数据'],
  ['clinicaltrials', 'ClinicalTrials.gov', 'clinical', 'none', true, ['search', 'get'], 'https://clinicaltrials.gov/api/v2', '临床试验注册'],
  ['mousemine', 'MouseMine', 'gene', 'none', true, ['search'], 'https://www.mousemine.org/mousemine/service', '小鼠基因/表型；InterMine 查询'],
  ['ucsc-genome', 'UCSC Genome Browser', 'gene', 'none', true, ['get'], 'https://api.genome.ucsc.edu', '基因组区间/序列；需 genome+chrom+start+end'],
  ['addgene', 'Addgene', 'plasmid', 'key', false, ['info'], 'https://api.developers.addgene.org', '质粒仓库；API 需 key'],
]
export const DATABASES = META.map(([id, name, domain, auth, executable, operations, url, note]) => ({
  id, name, domain, domainName: DOMAIN_NAMES[domain] ?? domain, auth, executable, operations, url, note,
  doc: path.join(DB_DOCS, `${id}.md`),
}))

const ALIASES = { hpa: 'human-protein-atlas', gdc: 'tcga-gdc', tcga: 'tcga-gdc', gtex: 'gtex', hpo: 'hpo', string: 'string', 'gwas': 'gwas-catalog', 'gwas-catalog': 'gwas-catalog', 'clinical-trials': 'clinicaltrials', 'clinicaltrials.gov': 'clinicaltrials', 'alphafold-db': 'alphafold', 'pdb': 'pdb', 'uniprotkb': 'uniprot', 'ensembl': 'ensembl' }
const byId = new Map(DATABASES.map((d) => [d.id, d]))
export function listDatabases({ domain } = {}) {
  return DATABASES.filter((d) => !domain || d.domain === domain)
}
export function getDatabase(id) {
  const key = String(id ?? '').toLowerCase()
  return byId.get(ALIASES[key] ?? key) ?? null
}

function fail(id, err) {
  return { ok: false, db: id, error: String(err?.message ?? err), checkedAt: new Date().toISOString() }
}
function ok(id, mode, data) {
  return { ok: true, db: id, mode, checkedAt: new Date().toISOString(), ...data }
}

function httpsText(url, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'dsh-sci database lookup', accept: 'text/plain, text/tsv, */*' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        resolve(httpsText(new URL(res.headers.location, url).toString(), { timeoutMs }))
        return
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        let b = ''
        res.on('data', (d) => { b += d })
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode} ${url} — ${b.slice(0, 160)}`)))
        return
      }
      let body = ''
      res.on('data', (d) => { body += d })
      res.on('end', () => resolve(body))
    })
    req.setTimeout(timeoutMs, () => { req.destroy(new Error(`timeout ${url}`)) })
    req.on('error', reject)
  })
}

async function getJson(url, opts = {}) { return httpJson(url, opts) }
async function getText(url, opts = {}) { return (await httpGet(url, opts)).body }

// ── UniProt ────────────────────────────────────────────────────────────────
async function uniprot(q, o, mode) {
  const limit = clamp(o.limit, 1, 50, 10)
  if (mode === 'get') {
    const data = await getJson(`https://rest.uniprot.org/uniprotkb/${enc(q)}?format=json`, { cacheTtlMs: 7 * 864e5 })
    return ok('uniprot', 'get', { items: [{
      accession: data.primaryAccession, id: data.uniProtkbId, name: data.proteinDescription?.recommendedName?.fullName?.value ?? '',
      gene: data.genes?.[0]?.geneName?.value ?? '', organism: data.organism?.scientificName ?? '', taxonId: data.organism?.taxonId,
      length: data.sequence?.length, reviewed: String(data.entryType ?? '').includes('reviewed'), function: clean(data.comments?.find((c) => c.commentType === 'FUNCTION')?.texts?.[0]?.value ?? ''),
      pdb: uniq((data.uniProtKBCrossReferences ?? []).filter((x) => x.database === 'PDB').map((x) => x.id)).slice(0, 20),
      sequence: data.sequence?.value ?? '',
    }] })
  }
  let query = String(q).trim()
  if (/^[A-Za-z0-9_.-]+$/.test(query)) query = `(gene:${query} OR protein_name:${query})`
  const t = taxon(o.species)
  if (t && !/organism_id|taxonomy_id/i.test(query)) query += ` AND (organism_id:${t})`
  const fields = 'accession,id,protein_name,gene_names,organism_name,organism_id,length,reviewed,cc_function,xref_pdb'
  const url = `https://rest.uniprot.org/uniprotkb/search?query=${enc(query)}&format=json&size=${limit}&fields=${enc(fields)}`
  const data = await getJson(url, { cacheTtlMs: 864e5 })
  return ok('uniprot', 'search', { query, items: (data.results ?? []).map((x) => ({
    accession: x.primaryAccession, id: x.uniProtkbId, name: x.proteinDescription?.recommendedName?.fullName?.value ?? '',
    gene: x.genes?.[0]?.geneName?.value ?? '', organism: x.organism?.scientificName ?? '', taxonId: x.organism?.taxonId,
    length: x.sequence?.length, reviewed: String(x.entryType ?? '').includes('reviewed'),
    pdb: uniq((x.uniProtKBCrossReferences ?? []).filter((z) => z.database === 'PDB').map((z) => z.id)).slice(0, 10),
  })) })
}

// ── NCBI E-utilities ───────────────────────────────────────────────────────
async function esearch(db, term, limit) {
  const j = await getJson(ncbiUrl('esearch.fcgi', { db, term, retmode: 'json', retmax: limit }), { cacheTtlMs: 6 * 36e5 })
  return { count: n(j.esearchresult?.count), ids: arr(j.esearchresult?.idlist).map(String) }
}
async function esummary(db, ids) {
  if (!ids.length) return {}
  const j = await getJson(ncbiUrl('esummary.fcgi', { db, id: ids.join(','), retmode: 'json' }), { cacheTtlMs: 6 * 36e5 })
  return j.result ?? {}
}
async function ncbiGene(q, o, mode) {
  const limit = clamp(o.limit, 1, 50, 10)
  const term = /^[A-Za-z0-9_.-]+$/.test(String(q)) ? `${q}[gene]` : q
  let ids = []
  let count = 0
  if (mode === 'get') {
    if (/^\d+$/.test(q)) ids = [String(q)]
    else { const s = await esearch('gene', ncbiQuery(term, o.species), limit); ids = s.ids; count = s.count }
  } else {
    const s = await esearch('gene', ncbiQuery(term, o.species), limit); ids = s.ids; count = s.count
  }
  const sum = await esummary('gene', ids)
  return ok('ncbi-gene', mode, { query: q, total: count, items: ids.map((id) => {
    const x = sum[id] ?? {}
    return { geneId: id, symbol: x.nomenclaturesymbol ?? x.name ?? '', name: x.description ?? '', organism: x.organism?.scientificname ?? x.organism ?? '', chromosome: x.chromosome ?? '', location: x.maplocation ?? '', aliases: clean(x.otheraliases ?? '') }
  }) })
}
async function ncbiProtein(q, o, mode) {
  const limit = clamp(o.limit, 1, 50, 10)
  const term = mode === 'get' ? `${q}[Accession]` : ncbiQuery(q, o.species)
  const s = await esearch('protein', term, limit)
  const sum = await esummary('protein', s.ids)
  return ok('ncbi-protein', mode, { query: q, total: s.count, items: s.ids.map((id) => {
    const x = sum[id] ?? {}
    return { id, accession: x.accessionversion ?? '', title: x.title ?? '', organism: x.organism ?? '', length: x.slen ?? '' }
  }) })
}
async function ncbiTaxonomy(q, o, mode) {
  const limit = clamp(o.limit, 1, 50, 10)
  const term = mode === 'get' && /^\d+$/.test(q) ? q : q
  const s = await esearch('taxonomy', term, limit)
  const sum = await esummary('taxonomy', s.ids)
  return ok('ncbi-taxonomy', mode, { query: q, total: s.count, items: s.ids.map((id) => {
    const x = sum[id] ?? {}
    return { taxId: id, name: x.scientificname ?? '', rank: x.rank ?? '', division: x.division ?? '', lineage: x.lineage ?? '' }
  }) })
}
async function geo(q, o, mode) {
  const limit = clamp(o.limit, 1, 50, 10)
  const term = mode === 'get' ? `${q}[Accession]` : ncbiQuery(q, o.species)
  const s = await esearch('gds', term, limit)
  const sum = await esummary('gds', s.ids)
  return ok('geo', mode, { query: q, total: s.count, items: s.ids.map((id) => {
    const x = sum[id] ?? {}
    return { id, accession: x.accession ?? '', title: x.title ?? '', summary: x.summary ?? '', organism: x.taxon ?? '', samples: x.n_samples ?? '', type: x.gdsType ?? '' }
  }) })
}
async function sra(q, o, mode) {
  const limit = clamp(o.limit, 1, 50, 10)
  const term = mode === 'get' ? `${q}[Accession]` : ncbiQuery(q, o.species)
  const s = await esearch('sra', term, limit)
  const sum = await esummary('sra', s.ids)
  return ok('sra', mode, { query: q, total: s.count, items: s.ids.map((id) => {
    const x = sum[id] ?? {}
    const exp = String(x.expxml ?? '')
    const acc = (exp.match(/<EXPERIMENT accession="([^"]+)"/) ?? [])[1] ?? x.accession ?? ''
    return { id, accession: acc, title: (exp.match(/<Title>(.*?)<\/Title>/) ?? [])[1] ?? x.title ?? '', platform: (exp.match(/instrument_model="([^"]+)"/) ?? [])[1] ?? '', runs: (exp.match(/total_runs="(\d+)"/) ?? [])[1] ?? '', spots: (exp.match(/total_spots="(\d+)"/) ?? [])[1] ?? '' }
  }) })
}
async function clinvar(q, o, mode) {
  const limit = clamp(o.limit, 1, 50, 10)
  const term = /^[A-Za-z0-9_.-]+$/.test(String(q)) ? `${q}[gene]` : q
  const s = await esearch('clinvar', term, limit)
  const sum = await esummary('clinvar', s.ids)
  return ok('clinvar', mode, { query: q, total: s.count, items: s.ids.map((id) => {
    const x = sum[id] ?? {}
    return { variationId: id, title: x.title ?? '', gene: x.gene ?? '', classification: x.germline_classification?.description ?? '', review: x.germline_classification?.review_status ?? '', conditions: arr(x.conditions?.traitSet).map((t) => t.traitName).filter(Boolean) }
  }) })
}
async function dbsnp(q, o, mode) {
  const id = String(q).replace(/^rs/i, '')
  if (!/^\d+$/.test(id)) throw new Error('dbSNP 需要 rsID，例如 rs334')
  const data = await getJson(`https://api.ncbi.nlm.nih.gov/variation/v0/refsnp/${enc(id)}`, { cacheTtlMs: 7 * 864e5 })
  const placements = arr(data.primary_snapshot_data?.placements_with_allele)
  return ok('dbsnp', 'get', { items: [{
    rsid: `rs${data.refsnp_id ?? id}`, createDate: data.create_date ?? '',
    placements: placements.slice(0, 20).map((p) => ({ assembly: p.seq_id ?? p.assembly_name ?? '', alleles: arr(p.alleles).map((a) => a.allele?.spdi?.deleted_sequence ? `${a.allele.spdi.deleted_sequence}>${a.allele.spdi.inserted_sequence}` : '').filter(Boolean) })),
  }] })
}
async function gnomad(q, o, mode) {
  const dataset = String(o.dataset || 'gnomad_r4')
  const build = /grch37|hg19/i.test(String(o.build || '')) ? 'GRCh37' : 'GRCh38'
  let query
  if (mode === 'get') {
    const id = String(q).trim()
    query = `query { variant(variantId: ${JSON.stringify(id)}, dataset: ${dataset}) { variant_id rsids chrom pos ref alt exome { ac an af } genome { ac an af } } }`
  } else {
    const symbol = String(q).replace(/["\\]/g, '').trim()
    query = `query { gene(gene_symbol: ${JSON.stringify(symbol)}, reference_genome: ${build}) { gene_id symbol chrom start stop strand variants(dataset: ${dataset}) { variant_id consequence rsids exome { ac an af } genome { ac an af } } } }`
  }
  const data = await httpPostJson('https://gnomad.broadinstitute.org/api', { query }, { timeoutMs: 45_000 })
  if (data.errors) throw new Error(data.errors.map((e) => e.message).join('; '))
  const g = data.data?.gene
  const v = data.data?.variant
  const items = v ? [v] : (g?.variants ?? []).slice(0, clamp(o.limit, 1, 50, 10)).map((x) => ({ ...x, gene: g.symbol, gene_id: g.gene_id }))
  return ok('gnomad', mode, { dataset, build, items, gene: g ? { id: g.gene_id, symbol: g.symbol, chrom: g.chrom, start: g.start, stop: g.stop, strand: g.strand } : null })
}

// ── Ensembl / structures / pathways ────────────────────────────────────────
async function ensembl(q, o, mode) {
  const sp = ensSpecies(o.species)
  const base = /grch37|hg19/i.test(String(o.build || '')) ? 'https://grch37.rest.ensembl.org' : 'https://rest.ensembl.org'
  const isId = /^ENS[GTPE]\d+/i.test(String(q))
  const url = isId
    ? `${base}/lookup/id/${enc(q)}?content-type=application/json;expand=1`
    : `${base}/lookup/symbol/${enc(sp)}/${enc(q)}?content-type=application/json;expand=1`
  const d = await getJson(url, { cacheTtlMs: 7 * 864e5 })
  return ok('ensembl', mode, { species: sp, items: [{
    id: d.id, symbol: d.display_name, description: d.description, biotype: d.biotype, assembly: d.assembly_name,
    chrom: d.seq_region_name, start: d.start, end: d.end, strand: d.strand, version: d.version,
    transcripts: arr(d.Transcript).slice(0, 20).map((t) => ({ id: t.id, name: t.display_name, biotype: t.biotype, length: t.length })),
  }] })
}
async function pdb(q, o, mode) {
  const id = String(q).trim().toUpperCase()
  if (mode === 'get' || /^[0-9A-Z]{4}$/.test(id)) {
    const d = await getJson(`https://data.rcsb.org/rest/v1/core/entry/${enc(id)}`, { cacheTtlMs: 7 * 864e5 })
    return ok('pdb', 'get', { items: [{ id, title: d.struct?.title ?? '', method: d.exptl?.[0]?.method ?? '', resolution: d.rcsb_entry_info?.resolution_combined?.[0] ?? '', deposited: d.rcsb_accession_info?.deposit_date ?? '', authors: d.audit_author?.map((a) => a.name).filter(Boolean).slice(0, 20) ?? [] }] })
  }
  const body = { query: { type: 'terminal', service: 'full_text', parameters: { value: String(q) } }, return_type: 'entry', request_options: { paginate: { start: 0, rows: clamp(o.limit, 1, 50, 10) } } }
  const s = await httpPostJson('https://search.rcsb.org/rcsbsearch/v2/query', body, { timeoutMs: 45_000 })
  const ids = arr(s.result_set).map((x) => x.identifier).filter(Boolean)
  const items = []
  for (const pid of ids.slice(0, 10)) {
    try { const d = await getJson(`https://data.rcsb.org/rest/v1/core/entry/${enc(pid)}`, { cacheTtlMs: 7 * 864e5 }); items.push({ id: pid, title: d.struct?.title ?? '', method: d.exptl?.[0]?.method ?? '', resolution: d.rcsb_entry_info?.resolution_combined?.[0] ?? '' }) } catch {}
    await sleep(120)
  }
  return ok('pdb', 'search', { query: q, total: s.total_count ?? ids.length, items })
}
async function alphafold(q, o) {
  const d = await getJson(`https://alphafold.ebi.ac.uk/api/prediction/${enc(q)}`, { cacheTtlMs: 7 * 864e5 })
  return ok('alphafold', 'get', { items: arr(d).map((x) => ({ modelEntityId: x.modelEntityId, accession: x.uniprotAccession, latestVersion: x.latestVersion, plddt: x.globalMetricValue, sequenceStart: x.sequenceStart, sequenceEnd: x.sequenceEnd, organism: x.organismScientificName, pdbUrl: x.pdbUrl, cifUrl: x.cifUrl, paeUrl: x.paeDocUrl })) })
}
async function interpro(q, o, mode) {
  const limit = clamp(o.limit, 1, 50, 10)
  const id = String(q).trim()
  if (mode === 'get') {
    const kind = /^PF\d+/i.test(id) ? 'pfam' : 'interpro'
    const d = await getJson(`https://www.ebi.ac.uk/interpro/api/entry/${kind}/${enc(id)}`, { cacheTtlMs: 7 * 864e5 })
    const m = d.metadata ?? d.results?.[0]?.metadata ?? {}
    return ok('interpro', 'get', { items: [{ accession: m.accession, name: m.name?.name ?? m.name ?? m.hierarchy?.name, type: m.type, description: arr(m.description).map((x) => x.text ?? x).join(' '), go: arr(m.go_terms).map((x) => `${x.identifier} ${x.name}`) }] })
  }
  const d = await getJson(`https://www.ebi.ac.uk/interpro/api/entry/interpro?search=${enc(q)}&page_size=${limit}`, { cacheTtlMs: 864e5 })
  return ok('interpro', 'search', { query: q, total: d.count ?? 0, items: arr(d.results).map((r) => ({ accession: r.metadata?.accession, name: r.metadata?.name, type: r.metadata?.type })) })
}
async function emdb(q, o, mode) {
  const id = /^EMD-/i.test(q) ? String(q).toUpperCase() : null
  if (mode === 'get' || id) {
    const d = await getJson(`https://www.ebi.ac.uk/emdb/api/entry/${enc(id ?? q)}`, { cacheTtlMs: 7 * 864e5 })
    return ok('emdb', 'get', { items: [{ id: d.emdb_id ?? id, title: d.admin?.title ?? d.structure_determination?.title ?? '', resolution: d.structure_determination?.resolution ?? '', method: d.structure_determination?.method ?? '' }] })
  }
  const d = await getJson(`https://www.ebi.ac.uk/emdb/api/search/${enc(q)}?rows=${clamp(o.limit, 1, 50, 10)}`, { cacheTtlMs: 864e5 })
  return ok('emdb', 'search', { query: q, total: d.hit_count ?? 0, items: arr(d.entries).map((x) => ({ id: x.emdb_id, title: x.title })) })
}
async function reactome(q, o, mode) {
  if (mode === 'get') {
    const d = await getJson(`https://reactome.org/ContentService/data/query/${enc(q)}`, { cacheTtlMs: 7 * 864e5 })
    return ok('reactome', 'get', { items: [{ id: d.stId, dbId: d.dbId, name: d.displayName ?? d.name, species: arr(d.speciesName) }] })
  }
  const d = await getJson(`https://reactome.org/ContentService/search/query?query=${enc(q)}&species=${enc(o.species || 'Homo sapiens')}&types=Pathway&rows=${clamp(o.limit, 1, 50, 10)}`, { cacheTtlMs: 864e5 })
  return ok('reactome', 'search', { query: q, total: d.found ?? arr(d.results).flatMap((g) => arr(g.entries ?? g.rows)).length, items: arr(d.results).flatMap((g) => arr(g.entries ?? g.rows)).map((r) => ({ id: r.stId, dbId: r.dbId, name: clean(r.name), species: arr(r.species) })) })
}
async function kegg(q, o, mode) {
  const database = String(o.action || o.database || 'genes').toLowerCase()
  if (mode === 'get') return ok('kegg', 'get', { items: [{ id: q, text: (await httpsText(`https://rest.kegg.jp/get/${enc(q)}`)).slice(0, 20_000) }] })
  const text = await httpsText(`https://rest.kegg.jp/find/${enc(database)}/${enc(q)}`)
  return ok('kegg', 'search', { query: q, database, items: text.split('\n').filter(Boolean).slice(0, clamp(o.limit, 1, 50, 10)).map((line) => { const [id, ...rest] = line.split('\t'); return { id, name: rest.join('\t') } }) })
}
async function quickgo(q, o, mode) {
  const limit = clamp(o.limit, 1, 50, 10)
  if (mode === 'get') {
    const id = /^GO:/i.test(q) ? q.toUpperCase() : null
    if (id) {
      const d = await getJson(`https://www.ebi.ac.uk/QuickGO/services/ontology/go/terms/${enc(id)}`, { cacheTtlMs: 7 * 864e5 })
      return ok('quickgo', 'get', { items: arr(d.results).map((x) => ({ id: x.id, name: x.name, definition: x.definition?.text ?? '', obsolete: x.isObsolete ?? false })) })
    }
    const d = await getJson(`https://www.ebi.ac.uk/QuickGO/services/ontology/go/search?query=${enc(q)}&limit=${limit}`, { cacheTtlMs: 864e5 })
    return ok('quickgo', 'search', { query: q, total: d.numberOfHits ?? 0, items: arr(d.results).map((x) => ({ id: x.id, name: x.name, definition: x.definition ?? '' })) })
  }
  const d = await getJson(`https://www.ebi.ac.uk/QuickGO/services/ontology/go/search?query=${enc(q)}&limit=${limit}`, { cacheTtlMs: 864e5 })
  return ok('quickgo', 'search', { query: q, total: d.numberOfHits ?? 0, items: arr(d.results).map((x) => ({ id: x.id, name: x.name })) })
}
async function stringDb(q, o, mode) {
  const tax = taxon(o.species) || '9606'
  const action = String(o.action || (mode === 'get' ? 'partners' : 'ids')).toLowerCase()
  if (action === 'network') {
    const d = await getJson(`https://string-db.org/api/json/network?identifiers=${enc(String(q).split(',').join('\r'))}&species=${tax}&required_score=${clamp(o.score, 0, 1000, 700)}`, { cacheTtlMs: 864e5 })
    return ok('string', 'network', { species: tax, items: arr(d).map((x) => ({ a: x.preferredName_A, b: x.preferredName_B, score: x.score, mode: x.mode })) })
  }
  if (action === 'partners' || mode === 'get') {
    const d = await getJson(`https://string-db.org/api/json/interaction_partners?identifiers=${enc(q)}&species=${tax}&limit=${clamp(o.limit, 1, 50, 10)}&required_score=${clamp(o.score, 0, 1000, 700)}`, { cacheTtlMs: 864e5 })
    return ok('string', 'partners', { species: tax, items: arr(d).map((x) => ({ a: x.preferredName_A, b: x.preferredName_B, score: x.score, mode: x.mode })) })
  }
  const d = await getJson(`https://string-db.org/api/json/get_string_ids?identifiers=${enc(q)}&species=${tax}&limit=${clamp(o.limit, 1, 50, 10)}`, { cacheTtlMs: 864e5 })
  return ok('string', 'ids', { species: tax, items: arr(d).map((x) => ({ stringId: x.stringId, preferredName: x.preferredName, taxon: x.ncbiTaxonId, annotation: clean(x.annotation) })) })
}

// ── Chemistry ──────────────────────────────────────────────────────────────
async function pubchem(q, o, mode) {
  const id = String(q).trim()
  const props = 'MolecularFormula,MolecularWeight,CanonicalSMILES,IsomericSMILES,InChIKey,IUPACName'
  if (mode === 'get' && /^\d+$/.test(id)) {
    const d = await getJson(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${id}/property/${props}/JSON`, { cacheTtlMs: 7 * 864e5 })
    return ok('pubchem', 'get', { items: arr(d.PropertyTable?.Properties).map((x) => ({ cid: x.CID, ...x })) })
  }
  const d = await getJson(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${enc(id)}/property/${props}/JSON`, { cacheTtlMs: 7 * 864e5 })
  return ok('pubchem', 'search', { query: id, items: arr(d.PropertyTable?.Properties).map((x) => ({ cid: x.CID, ...x })) })
}
async function chembl(q, o, mode) {
  const limit = clamp(o.limit, 1, 50, 10)
  if (mode === 'get' || /^CHEMBL\d+$/i.test(q)) {
    const d = await getJson(`https://www.ebi.ac.uk/chembl/api/data/molecule/${enc(q)}.json`, { cacheTtlMs: 7 * 864e5 })
    return ok('chembl', 'get', { items: [{ id: d.molecule_chembl_id, name: d.pref_name ?? '', phase: d.max_phase, formula: d.molecule_properties?.full_molformula ?? '', smiles: d.molecule_structures?.canonical_smiles ?? '', inchiKey: d.molecule_structures?.standard_inchi_key ?? '' }] })
  }
  const d = await getJson(`https://www.ebi.ac.uk/chembl/api/data/molecule/search?q=${enc(q)}&format=json&limit=${limit}`, { cacheTtlMs: 864e5 })
  return ok('chembl', 'search', { query: q, total: d.page_meta?.total_count ?? 0, items: arr(d.molecules).map((x) => ({ id: x.molecule_chembl_id, name: x.pref_name ?? '', phase: x.max_phase, formula: x.molecule_properties?.full_molformula ?? '' })) })
}
async function bindingdb(q, o) {
  const cutoff = clamp(o.cutoff, 1, 100000, 1000)
  const d = await getJson(`https://bindingdb.org/rest/getLigandsByUniprot?uniprot=${enc(q)};${cutoff}&response=application/json`, { cacheTtlMs: 7 * 864e5 })
  const raw = d.getLindsByUniprotResponse ?? d.getLigandsByUniprotResponse ?? d
  const list = raw?.['bdb.affinities'] ?? raw?.bdb?.affinities ?? raw?.bdb?.ligands ?? []
  return ok('bindingdb', 'get', { query: q, cutoffNm: cutoff, total: raw?.['bdb.hit'] ?? raw?.bdb?.hit, items: arr(list).slice(0, clamp(o.limit, 1, 50, 10)) })
}

// ── Disease / variant / cancer / omics ─────────────────────────────────────
async function hpo(q, o, mode) {
  if (mode === 'get' || /^HP:\d+/i.test(q)) {
    const id = String(q).toUpperCase()
    const d = await getJson(`https://ontology.jax.org/api/hp/terms/${enc(id)}`, { cacheTtlMs: 7 * 864e5 })
    return ok('hpo', 'get', { items: [{ id: d.id, name: d.name, definition: d.definition, synonyms: arr(d.synonyms).map((x) => x.label ?? x) }] })
  }
  const d = await getJson(`https://ontology.jax.org/api/hp/search?q=${enc(q)}&page=0&limit=${clamp(o.limit, 1, 50, 10)}`, { cacheTtlMs: 864e5 })
  return ok('hpo', 'search', { query: q, total: d.totalCount ?? 0, items: arr(d.terms).map((x) => ({ id: x.id, name: x.name, definition: x.definition })) })
}
async function gwas(q, o, mode) {
  if (mode === 'get' || /^rs\d+$/i.test(q)) {
    const d = await getJson(`https://www.ebi.ac.uk/gwas/rest/api/v2/associations?rs_id=${enc(q)}&size=${clamp(o.limit, 1, 50, 10)}`, { cacheTtlMs: 7 * 864e5 })
    return ok('gwas-catalog', 'get', { query: q, items: arr(d._embedded?.associations).map((a) => ({ id: a.association_id, rsid: q, pvalue: a.p_value, beta: a.beta, riskFrequency: a.risk_frequency, traits: arr(a.efo_traits).map((t) => t.efo_trait), accession: a.accession_id, mappedGenes: arr(a.mapped_genes) })) })
  }
  const d = await getJson(`https://www.ebi.ac.uk/gwas/rest/api/v2/studies?trait=${enc(q)}&size=${clamp(o.limit, 1, 50, 10)}`, { cacheTtlMs: 864e5 })
  return ok('gwas-catalog', 'search', { query: q, items: arr(d._embedded?.studies).map((x) => ({ accession: x.accession_id, trait: x.disease_trait, efo: arr(x.efo_traits).map((t) => t.efo_trait), pmid: x.pubmed_id, samples: x.initial_sample_size })) })
}

async function cbioportal(q, o, mode) {
  if (mode === 'get') {
    const d = await getJson(`https://www.cbioportal.org/api/studies/${enc(q)}?projection=SUMMARY`, { cacheTtlMs: 864e5 })
    return ok('cbioportal', 'get', { items: [{ id: d.studyId, name: d.name, cancerType: d.cancerTypeId, pmid: d.pmid, samples: d.allSampleCount, referenceGenome: d.referenceGenome }] })
  }
  const d = await getJson('https://www.cbioportal.org/api/studies?projection=SUMMARY&pageSize=1000', { cacheTtlMs: 864e5 })
  const ql = String(q).toLowerCase()
  return ok('cbioportal', 'search', { query: q, total: arr(d).length, items: arr(d).filter((x) => `${x.studyId} ${x.name} ${x.cancerTypeId}`.toLowerCase().includes(ql)).slice(0, clamp(o.limit, 1, 50, 10)).map((x) => ({ id: x.studyId, name: x.name, cancerType: x.cancerTypeId, pmid: x.pmid, samples: x.allSampleCount })) })
}
async function gdc(q, o, mode) {
  const size = clamp(o.limit, 1, 50, 10)
  if (mode === 'get' || /^TCGA-[A-Z0-9]+$/i.test(q)) {
    const id = String(q).toUpperCase()
    const d = await getJson(`https://api.gdc.cancer.gov/projects/${enc(id)}?format=json&expand=summary,primary_site&pretty=true`, { cacheTtlMs: 864e5 })
    const x = d.data ?? {}
    return ok('tcga-gdc', 'get', { items: [{ id: x.project_id, name: x.name, primarySite: x.primary_site, diseaseType: x.disease_type, cases: x.summary?.case_count }] })
  }
  const d = await getJson(`https://api.gdc.cancer.gov/projects?size=${size}&fields=project_id,name,primary_site,disease_type&pretty=true`, { cacheTtlMs: 864e5 })
  return ok('tcga-gdc', 'search', { query: q, total: d.data?.pagination?.total ?? 0, items: arr(d.data?.hits).map((x) => ({ id: x.project_id, name: x.name, primarySite: x.primary_site, diseaseType: x.disease_type })) })
}
async function pride(q, o, mode) {
  if (mode === 'get' || /^PXD\d+$/i.test(q)) {
    const d = await getJson(`https://www.ebi.ac.uk/pride/ws/archive/v3/projects/${enc(q)}`, { cacheTtlMs: 864e5 })
    return ok('pride', 'get', { items: [{ id: d.accession, title: d.title, description: d.projectDescription, species: arr(d.organisms).map((x) => x.name), submission: d.submissionDate }] })
  }
  const d = await getJson(`https://www.ebi.ac.uk/pride/ws/archive/v3/search/projects?keyword=${enc(q)}&page=0&pageSize=${clamp(o.limit, 1, 50, 10)}`, { cacheTtlMs: 864e5 })
  return ok('pride', 'search', { query: q, items: arr(d).map((x) => ({ id: x.accession, title: x.title, species: arr(x.organisms).map((z) => z.name) })) })
}
async function encode(q, o, mode) {
  if (mode === 'get' || /^ENCSR\d+/i.test(q)) {
    const d = await getJson(`https://www.encodeproject.org/experiments/${enc(q)}/?format=json`, { cacheTtlMs: 864e5 })
    return ok('encode', 'get', { items: [{ id: d.accession, assay: d.assay_title, target: d.target?.label, biosample: d.biosample_ontology?.term_name, status: d.status, lab: d.lab?.title }] })
  }
  const simple = /^[A-Za-z0-9_.-]+$/.test(String(q))
  const filter = simple ? `target.label=${enc(q)}` : `searchTerm=${enc(q)}`
  const d = await getJson(`https://www.encodeproject.org/search/?type=Experiment&${filter}&format=json&limit=${clamp(o.limit, 1, 50, 10)}`, { cacheTtlMs: 864e5 })
  return ok('encode', 'search', { query: q, total: d.total ?? 0, items: arr(d['@graph']).map((x) => ({ id: x.accession, assay: x.assay_title, target: x.target?.label, biosample: x.biosample_ontology?.term_name, status: x.status })) })
}
async function hca(q, o) {
  const cat = await getJson('https://service.azul.data.humancellatlas.org/index/catalogs', { cacheTtlMs: 864e5 })
  const catalog = o.catalog || cat.default_catalog || arr(cat.catalogs)[0]
  const filters = JSON.stringify({ projectTitle: { is: [String(q)] } })
  const d = await getJson(`https://service.azul.data.humancellatlas.org/index/projects?size=${clamp(o.limit, 1, 50, 10)}&catalog=${enc(catalog)}&filters=${enc(filters)}`, { cacheTtlMs: 864e5 })
  return ok('hca', 'search', { query: q, catalog, items: arr(d.hits).map((h) => ({ id: h.projects?.[0]?.projectId, title: h.projects?.[0]?.projectTitle, organ: h.specimens?.map((s) => s.organ) })) })
}
async function gtex(q, o, mode) {
  const d = await getJson(`https://gtexportal.org/api/v2/reference/gene?geneId=${enc(q)}&gencodeVersion=v26&genomeBuild=GRCh38%2Fhg38`, { cacheTtlMs: 864e5 })
  return ok('gtex', 'get', { items: arr(d.data).map((x) => ({ gene: x.geneSymbol, ensembl: x.gencodeId, description: x.geneName, chromosome: x.chromosome })) })
}
async function hpa(q, o) {
  const d = await getJson(`https://www.proteinatlas.org/${enc(q)}.json`, { cacheTtlMs: 7 * 864e5 })
  return ok('human-protein-atlas', 'get', { items: [{ gene: d.Gene, ensembl: d.Ensembl, description: d['Gene description'], uniprot: arr(d.Uniprot), location: arr(d['Subcellular location']), tissue: d['RNA tissue specificity'] }] })
}
async function myvariant(q, o, mode) {
  if (mode === 'get' || /^(rs|chr)/i.test(q)) {
    const d = await getJson(`https://myvariant.info/v1/variant/${enc(q)}?fields=all`, { cacheTtlMs: 864e5 })
    return ok('myvariant', 'get', { items: arr(d) })
  }
  const d = await getJson(`https://myvariant.info/v1/query?q=${enc(q)}&size=${clamp(o.limit, 1, 50, 10)}`, { cacheTtlMs: 864e5 })
  return ok('myvariant', 'search', { query: q, total: d.total ?? 0, items: arr(d.hits) })
}
async function jaspar(q, o, mode) {
  if (mode === 'get' || /^MA\d+/i.test(q)) {
    const d = await getJson(`https://jaspar.elixir.no/api/v1/matrix/${enc(q)}/`, { cacheTtlMs: 7 * 864e5 })
    return ok('jaspar', 'get', { items: [{ id: d.matrix_id, name: d.name, taxon: d.tax_group, family: d.family, type: d.type }] })
  }
  const d = await getJson(`https://jaspar.elixir.no/api/v1/matrix/?tax_id=${taxon(o.species) || '9606'}&collection=CORE&page_size=${clamp(o.limit, 1, 50, 10)}&search=${enc(q)}`, { cacheTtlMs: 864e5 })
  return ok('jaspar', 'search', { query: q, total: d.count ?? 0, items: arr(d.results).map((x) => ({ id: x.matrix_id, name: x.name, taxon: x.tax_group, family: x.family })) })
}
async function metabolomics(q, o, mode) {
  if (mode === 'get' || /^ST\d+/i.test(q)) {
    const d = await getJson(`https://www.metabolomicsworkbench.org/rest/study/study_id/${enc(q)}/summary`, { cacheTtlMs: 864e5 })
    return ok('metabolomics-workbench', 'get', { items: arr(d) })
  }
  const d = await getJson(`https://www.metabolomicsworkbench.org/rest/study/study_title/${enc(q)}/summary`, { cacheTtlMs: 864e5 })
  return ok('metabolomics-workbench', 'search', { query: q, items: arr(d).slice(0, clamp(o.limit, 1, 50, 10)) })
}
async function monarch(q, o, mode) {
  if (mode === 'get' || /^[A-Z]+:\d+/.test(q)) {
    const d = await getJson(`https://api.monarchinitiative.org/v3/api/entity/${enc(q)}`, { cacheTtlMs: 864e5 })
    return ok('monarch', 'get', { items: [{ id: d.id, name: d.name, category: d.category, description: d.description }] })
  }
  const d = await getJson(`https://api.monarchinitiative.org/v3/api/search?q=${enc(q)}&limit=${clamp(o.limit, 1, 50, 10)}`, { cacheTtlMs: 864e5 })
  return ok('monarch', 'search', { query: q, total: d.total ?? 0, items: arr(d.items).map((x) => ({ id: x.id, name: x.name, category: x.category })) })
}
async function ucsc(q, o) {
  const m = String(q).match(/^([a-z0-9]+)[:\s]+(chr[\w]+)[:\s]+(\d+)[-:](\d+)$/i)
  if (!m) throw new Error('UCSC 需要 genome:chrom:start-end，例如 hg38:chr17:43044295-43125483')
  const [, genome, chrom, start, end] = m
  const d = await getJson(`https://api.genome.ucsc.edu/getData/sequence?genome=${enc(genome)}&chrom=${enc(chrom)}&start=${start}&end=${end}`, { cacheTtlMs: 7 * 864e5 })
  return ok('ucsc-genome', 'get', { items: [{ genome, chrom, start: Number(start), end: Number(end), sequence: d.dna ?? '' }] })
}

async function mousemine(q, o) {
  const d = await getJson(`https://www.mousemine.org/mousemine/service/search?q=${enc(q)}&format=json`, { cacheTtlMs: 864e5 })
  return ok('mousemine', 'search', { query: q, items: arr(d).slice(0, clamp(o.limit, 1, 50, 10)) })
}
async function opentargets(q, o, mode) {
  if (mode !== 'get') throw new Error('Open Targets 请用 db get opentargets <ENSG...|EFO_...>')
  const id = String(q).trim()
  const isDisease = /^(EFO_|MONDO_|Orphanet_|HP_)/i.test(id)
  const query = isDisease
    ? `query { disease(efoId: ${JSON.stringify(id)}) { id name description } }`
    : `query { target(ensemblId: ${JSON.stringify(id)}) { id approvedSymbol approvedName biotype proteinIds { id source } pathways { pathway pathwayId } } }`
  const d = await httpPostJson('https://api.platform.opentargets.org/api/v4/graphql', { query }, { timeoutMs: 45_000 })
  if (d.errors) throw new Error(d.errors.map((e) => e.message).join('; '))
  return ok('opentargets', 'get', { items: [isDisease ? d.data?.disease : d.data?.target].filter(Boolean) })
}

async function ena(q, o, mode) {
  const id = String(q).trim()
  if (mode === 'get' || /^(PRJ|SRR|ERR|DRR|SAM|ERS|GCA|GCF)/i.test(id)) {
    const text = await getText(`https://www.ebi.ac.uk/ena/browser/api/xml/${enc(id)}`)
    return ok('ena', 'get', { items: [{ id, xml: text.slice(0, 20_000) }] })
  }
  const result = String(o.action || 'read_run')
  const fields = result === 'sequence'
    ? 'accession,description,tax_id,scientific_name,base_count'
    : result === 'study'
      ? 'study_accession,study_title,study_description,first_public'
      : 'run_accession,experiment_accession,sample_accession,study_accession,instrument_platform,library_strategy,read_count,base_count'
  const query = /[=<>]/.test(id) ? id : (result === 'sequence' ? `description="*${id}*"` : `study_title="*${id}*"`)
  const d = await getJson(`https://www.ebi.ac.uk/ena/portal/api/search?result=${enc(result)}&query=${enc(query)}&fields=${enc(fields)}&limit=${clamp(o.limit, 1, 50, 10)}&format=json`, { cacheTtlMs: 864e5 })
  return ok('ena', 'search', { query: id, result, items: arr(d) })
}

async function clinicaltrials(q, o, mode) {
  if (mode === 'get' || /^NCT\d+$/i.test(q)) {
    const d = await getJson(`https://clinicaltrials.gov/api/v2/studies/${enc(q)}`, { cacheTtlMs: 864e5 })
    return ok('clinicaltrials', 'get', { items: [{ id: d.protocolSection?.identificationModule?.nctId, title: d.protocolSection?.identificationModule?.briefTitle, status: d.protocolSection?.statusModule?.overallStatus, phase: d.protocolSection?.designModule?.phases }] })
  }
  const d = await getJson(`https://clinicaltrials.gov/api/v2/studies?query.term=${enc(q)}&pageSize=${clamp(o.limit, 1, 50, 10)}&fields=NCTId,BriefTitle,OverallStatus,Phase`, { cacheTtlMs: 864e5 })
  return ok('clinicaltrials', 'search', { query: q, total: d.totalCount ?? 0, items: arr(d.studies).map((s) => ({ id: s.protocolSection?.identificationModule?.nctId, title: s.protocolSection?.identificationModule?.briefTitle, status: s.protocolSection?.statusModule?.overallStatus, phase: s.protocolSection?.designModule?.phases })) })
}

// ── ClinPGx ────────────────────────────────────────────────────────────────
function clinpgxGene(x) {
  if (!x) return null
  return {
    type: 'gene', id: x.id, symbol: x.symbol, name: x.name,
    chromosome: x.chr?.name, cytoband: [x.cbStart, x.cbStop].filter(Boolean).join('-'),
    build: x.buildVersion, strand: x.strand, cpic: x.cpicGene === true,
  }
}
function clinpgxChemical(x) {
  if (!x) return null
  return { type: 'chemical', id: x.id, name: x.name, objCls: x.objCls }
}
export function normalizeClinpgx(data) {
  return arr(data?.data ?? data).map((x) => x?.objCls === 'Chemical' || x?.smiles || x?.inchi ? clinpgxChemical(x) : clinpgxGene(x)).filter(Boolean)
}
async function clinpgx(q, o, mode) {
  const base = 'https://api.clinpgx.org/v1'
  const limit = clamp(o.limit, 1, 50, 10)
  if (mode === 'get' || /^PA\d+$/i.test(String(q))) {
    const id = String(q).trim()
    try {
      const d = await getJson(`${base}/data/gene/${enc(id)}`, { cacheTtlMs: 7 * 864e5 })
      const items = normalizeClinpgx(d)
      if (items.length) return ok('clinpgx', 'get', { items, query: q })
    } catch {}
    try {
      const d = await getJson(`${base}/data/chemical/${enc(id)}`, { cacheTtlMs: 7 * 864e5 })
      const items = normalizeClinpgx(d)
      if (items.length) return ok('clinpgx', 'get', { items, query: q })
    } catch {}
    try {
      const d = await getJson(`${base}/data/chemical?name=${enc(id)}`, { cacheTtlMs: 7 * 864e5 })
      const items = normalizeClinpgx(d)
      if (items.length) return ok('clinpgx', 'get', { items: items.slice(0, limit), query: q })
    } catch {}
    throw new Error(`ClinPGx 未找到 ${id}`)
  }
  const qs = String(q).trim()
  let items = []
  let kind = 'gene'
  try {
    const d = await getJson(`${base}/data/gene?symbol=${enc(qs)}`, { cacheTtlMs: 7 * 864e5 })
    items = normalizeClinpgx(d)
  } catch {}
  if (!items.length) {
    kind = 'chemical'
    try {
      const d = await getJson(`${base}/data/chemical?name=${enc(qs)}`, { cacheTtlMs: 7 * 864e5 })
      items = normalizeClinpgx(d)
    } catch {}
  }
  return ok('clinpgx', 'search', { query: q, kind, total: items.length, items: items.slice(0, limit) })
}

// ── ChEBI ──────────────────────────────────────────────────────────────────
function chebiNumber(q) {
  const m = String(q ?? '').trim().match(/^(?:CHEBI[:_])?(\d+)$/i)
  return m ? m[1] : ''
}
export function normalizeChebiDoc(x) {
  if (!x) return null
  return {
    id: x.obo_id ?? x.short_form ?? x.id, name: x.label ?? x.name,
    definition: clean(arr(x.description)[0] ?? x.definition ?? ''),
    synonyms: uniq([...arr(x.exact_synonyms), ...arr(x.related_synonyms), ...arr(x.synonyms)]).slice(0, 20),
    iri: x.iri ?? '', ontology: x.ontology_name ?? 'chebi',
  }
}
export function normalizeChebiCompound(x) {
  if (!x) return null
  return {
    id: x.chebi_accession ?? (x.id ? `CHEBI:${x.id}` : ''), name: x.name ?? x.ascii_name,
    definition: clean(x.definition ?? ''),
    stars: x.stars ?? null,
    synonyms: arr(x.names?.SYNONYM).map((v) => v?.name).filter(Boolean).slice(0, 20),
  }
}
async function chebiSearch(q, limit, page = 1) {
  const rows = Math.max(page * limit * 5, 20)
  const d = await getJson(`https://www.ebi.ac.uk/ols4/api/search?q=${enc(q)}&ontology=chebi&rows=${rows}`, { cacheTtlMs: 7 * 864e5 })
  const ql = String(q).trim().toLowerCase()
  const rank = (x) => x.name.toLowerCase() === ql ? 0
    : x.synonyms.some((s) => String(s).toLowerCase() === ql) ? 1
      : x.name.toLowerCase().startsWith(ql) ? 2 : 3
  const docs = arr(d.response?.docs).map(normalizeChebiDoc).filter(Boolean).sort((a, b) => rank(a) - rank(b))
  const start = (page - 1) * limit
  return { total: d.response?.numFound ?? docs.length, items: docs.slice(start, start + limit) }
}
async function chebi(q, o, mode) {
  const limit = clamp(o.limit, 1, 50, 10)
  const numeric = chebiNumber(q)
  if (mode === 'get' || numeric) {
    let id = numeric
    if (!id) {
      const s = await chebiSearch(q, 1, 1)
      id = chebiNumber(s.items[0]?.id)
    }
    if (!id) throw new Error('ChEBI 需要 CHEBI:ID 或可搜索的名称')
    const d = await getJson(`https://www.ebi.ac.uk/chebi/backend/api/public/compound/${enc(id)}/`, { cacheTtlMs: 7 * 864e5 })
    return ok('chebi', 'get', { items: [normalizeChebiCompound(d)].filter(Boolean), query: q })
  }
  const r = await chebiSearch(q, limit, clamp(o.page, 1, 1000, 1))
  return ok('chebi', 'search', { query: q, total: r.total, items: r.items })
}

// ── DailyMed ───────────────────────────────────────────────────────────────
export function normalizeDailymed(x) {
  if (!x) return null
  return {
    setid: x.setid, title: x.title, publishedDate: x.published_date,
    version: x.spl_version ?? null,
  }
}
async function dailymed(q, o, mode) {
  const limit = clamp(o.limit, 1, 50, 10)
  const value = String(q ?? '').trim()
  const isSetid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  if (mode === 'get' || isSetid) {
    const query = isSetid ? `setid=${enc(value)}` : `drug_name=${enc(value.replace(/^setid:/i, ''))}`
    const d = await getJson(`https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?${query}&pagesize=${limit}`, { cacheTtlMs: 7 * 864e5 })
    return ok('dailymed', 'get', { items: arr(d.data).map(normalizeDailymed).filter(Boolean).slice(0, 1), query: value })
  }
  const d = await getJson(`https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name=${enc(value)}&pagesize=${limit}&page=${clamp(o.page, 1, 1000, 1)}`, { cacheTtlMs: 7 * 864e5 })
  return ok('dailymed', 'search', { query: value, total: d.metadata?.total_elements ?? arr(d.data).length, items: arr(d.data).map(normalizeDailymed).filter(Boolean) })
}

const HANDLERS = {
  uniprot, 'ncbi-gene': ncbiGene, 'ncbi-protein': ncbiProtein, 'ncbi-taxonomy': ncbiTaxonomy,
  ensembl, geo, sra, ena, clinvar, dbsnp, gnomad, pdb, alphafold, interpro, emdb, reactome, kegg,
  quickgo, string: stringDb, pubchem, chembl, bindingdb, hpo, 'gwas-catalog': gwas,
  cbioportal, 'tcga-gdc': gdc, pride, encode, hca, gtex, 'human-protein-atlas': hpa,
  myvariant, jaspar, 'metabolomics-workbench': metabolomics, monarch, mousemine, 'ucsc-genome': ucsc,
  clinicaltrials, opentargets, clinpgx, chebi, dailymed,
}

export function detectAccessionDb(id) {
  const s = String(id ?? '').trim()
  if (/^GSE\d+$/i.test(s) || /^GDS\d+$/i.test(s) || /^GPL\d+$/i.test(s)) return { db: 'geo', id: s }
  if (/^PRJ[NAEDB]\d+$/i.test(s) || /^SR[RXSPZ]\d+$/i.test(s)) return { db: 'sra', id: s }
  if (/^ERR\d+$/i.test(s) || /^DRR\d+$/i.test(s) || /^E-MTAB-\d+$/i.test(s)) return { db: 'ena', id: s }
  if (/^PXD\d+$/i.test(s)) return { db: 'pride', id: s }
  if (/^ST\d+$/i.test(s)) return { db: 'metabolomics-workbench', id: s }
  return null
}

export function databaseHelp(id) {
  const db = getDatabase(id)
  if (!db) return null
  return { ...db, executable: Boolean(HANDLERS[db.id]), supported: Boolean(HANDLERS[db.id]) }
}

export async function databaseSearch(id, query, opts = {}) {
  const db = getDatabase(id)
  if (!db) throw new Error(`未知数据库：${id}`)
  const handler = HANDLERS[db.id]
  if (!handler) return fail(id, `${db.name} 需要登录/API key 或尚未接入自动查询；用 db info ${id} 查看端点和 ${db.doc}`)
  try { return await handler(query, opts, 'search') } catch (e) { return fail(id, e) }
}

export async function databaseGet(id, identifier, opts = {}) {
  const db = getDatabase(id)
  if (!db) throw new Error(`未知数据库：${id}`)
  const handler = HANDLERS[db.id]
  if (!handler) return fail(id, `${db.name} 需要登录/API key 或尚未接入自动查询；用 db info ${id} 查看端点和 ${db.doc}`)
  try { return await handler(identifier, opts, 'get') } catch (e) { return fail(id, e) }
}

export async function databaseDoc(id) {
  const db = getDatabase(id)
  if (!db) throw new Error(`未知数据库：${id}`)
  try { return (await import('node:fs/promises')).readFile(db.doc, 'utf8') } catch { return '' }
}

export function databaseProvenance(db, opts = {}) {
  return {
    database: db.name,
    endpoint: db.url,
    accessDate: new Date().toISOString(),
    organismTaxId: taxon(opts.species) || null,
    genomeBuild: opts.build || null,
    dataset: opts.dataset || null,
    filters: { query: opts.query ?? null, identifier: opts.id ?? null, action: opts.action ?? null, limit: opts.limit ?? null, page: opts.page ?? null },
  }
}
