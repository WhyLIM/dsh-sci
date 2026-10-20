/**
 * PubMed 搜索字段标签的完整目录（对应 PubMed Help 的 Search field tags）。
 *
 * 这一层不做检索，只负责：
 *   - 把用户写的 [Title/Abstract] / [pdat] / [sb] 等别名规范成标准标签；
 *   - 保留 [tiab:~3] 这类邻近搜索后缀；
 *   - 给 pubmed-query 命令提供字段目录与结构化构建。
 */
export const PUBMED_FIELDS = [
  { tag: 'ad', name: 'Affiliation', aliases: ['affiliation'], group: '作者/机构', example: 'cleveland[ad]' },
  { tag: 'all', name: 'All Fields', aliases: ['all fields'], group: '通用', example: 'aspirin[all]' },
  { tag: 'aid', name: 'Article Identifier', aliases: ['article identifier', 'article id'], group: '标识符', example: '"10.1038/xxxx"[aid]' },
  { tag: 'au', name: 'Author', aliases: ['author'], group: '作者/机构', example: 'fauci as[au]' },
  { tag: 'auid', name: 'Author Identifier', aliases: ['author identifier'], group: '作者/机构', example: '0000-0002-1825-0097[auid]' },
  { tag: 'book', name: 'Book', aliases: ['book'], group: '书籍', example: 'genereviews[book]' },
  { tag: 'dcom', name: 'Completion Date', aliases: ['completion date'], group: '日期', example: '2025/01/01:2025/12/31[dcom]' },
  { tag: 'cois', name: 'Conflict of Interest Statement', aliases: ['conflict of interest statement', 'conflict of interest'], group: '声明', example: 'stock[cois]' },
  { tag: 'cn', name: 'Corporate Author', aliases: ['corporate author'], group: '作者/机构', example: '"world health organization"[cn]' },
  { tag: 'crdt', name: 'Create Date', aliases: ['create date'], group: '日期', example: '2025/01/01:2025/12/31[crdt]' },
  { tag: 'rn', name: 'EC/RN Number', aliases: ['ec/rn number', 'ec number', 'rn number'], group: '化学/基因', example: 'EC 1.1.1.57[rn]' },
  { tag: 'ed', name: 'Editor', aliases: ['editor'], group: '作者/机构', example: 'smith ja[ed]' },
  { tag: 'edat', name: 'Entry Date', aliases: ['entry date'], group: '日期', example: '2025/01/01:2025/12/31[edat]' },
  { tag: 'sb', name: 'Filter / Subset', aliases: ['filter', 'subset'], group: '过滤', example: '"free full text"[sb]' },
  { tag: '1au', name: 'First Author Name', aliases: ['first author name', 'first author'], group: '作者/机构', example: 'smith ja[1au]' },
  { tag: 'fau', name: 'Full Author Name', aliases: ['full author name', 'full author'], group: '作者/机构', example: '"wong julia s"[fau]' },
  { tag: 'fir', name: 'Full Investigator Name', aliases: ['full investigator name', 'full investigator'], group: '作者/机构', example: '"janes harry"[fir]' },
  { tag: 'gr', name: 'Grants and Funding', aliases: ['grants and funding', 'grant', 'funding'], group: '资金', example: 'R01[gr]' },
  { tag: 'ir', name: 'Investigator', aliases: ['investigator'], group: '作者/机构', example: 'soller b[ir]' },
  { tag: 'isbn', name: 'ISBN', aliases: ['isbn'], group: '书籍', example: '978-3-16-148410-0[isbn]' },
  { tag: 'ip', name: 'Issue', aliases: ['issue'], group: '期刊', example: '12[ip]' },
  { tag: 'ta', name: 'Journal', aliases: ['journal'], group: '期刊', example: 'J Biol Chem[ta]' },
  { tag: 'la', name: 'Language', aliases: ['language'], group: '语言', example: 'chi[la]' },
  { tag: 'lastau', name: 'Last Author Name', aliases: ['last author name', 'last author'], group: '作者/机构', example: 'smith ja[lastau]' },
  { tag: 'lid', name: 'Location ID', aliases: ['location id'], group: '标识符', example: '"10.1038/xxxx"[lid]' },
  { tag: 'mhda', name: 'MeSH Date', aliases: ['mesh date'], group: '日期', example: '2025/01/01:2025/12/31[mhda]' },
  { tag: 'majr', name: 'MeSH Major Topic', aliases: ['mesh major topic', 'major topic'], group: 'MeSH', example: 'Cytokines/physiology*[majr]' },
  { tag: 'sh', name: 'MeSH Subheadings', aliases: ['mesh subheadings', 'subheading'], group: 'MeSH', example: 'drug therapy[sh]' },
  { tag: 'mh', name: 'MeSH Terms', aliases: ['mesh terms', 'mesh'], group: 'MeSH', example: 'myocardial infarction[mh]' },
  { tag: 'lr', name: 'Modification Date', aliases: ['modification date'], group: '日期', example: '2025/01/01:2025/12/31[lr]' },
  { tag: 'jid', name: 'NLM Unique ID', aliases: ['nlm unique id', 'nlm id'], group: '期刊', example: '0375267[jid]' },
  { tag: 'ot', name: 'Other Term', aliases: ['other term', 'keyword', 'author keyword'], group: '通用', example: 'biomarker[ot]' },
  { tag: 'owner', name: 'Owner', aliases: ['owner'], group: '其他', example: 'ownernasa' },
  { tag: 'pg', name: 'Pagination', aliases: ['pagination', 'page'], group: '期刊', example: '123[pg]' },
  { tag: 'ps', name: 'Personal Name as Subject', aliases: ['personal name as subject'], group: '主题', example: 'varmus h[ps]' },
  { tag: 'pa', name: 'Pharmacological Action', aliases: ['pharmacological action'], group: '化学/基因', example: 'anti-inflammatory agents[pa]' },
  { tag: 'pl', name: 'Place of Publication', aliases: ['place of publication'], group: '期刊', example: 'england[pl]' },
  { tag: 'pmcid', name: 'PMCID (prefix search)', aliases: ['pmcid'], group: '标识符', example: 'PMC2600426', prefix: true },
  { tag: 'mid', name: 'MID (prefix search)', aliases: ['manuscript id', 'mid'], group: '标识符', example: 'NIHMS123456', prefix: true },
  { tag: 'pmid', name: 'PMID', aliases: ['pmid'], group: '标识符', example: '17170002[pmid]' },
  { tag: 'dp', name: 'Publication Date', aliases: ['publication date', 'pdat'], group: '日期', example: '2025/01/01:2025/12/31[dp]' },
  { tag: 'pt', name: 'Publication Type', aliases: ['publication type'], group: '研究类型', example: 'randomized controlled trial[pt]' },
  { tag: 'pubn', name: 'Publisher', aliases: ['publisher'], group: '书籍', example: 'oxford[pubn]' },
  { tag: 'si', name: 'Secondary Source ID', aliases: ['secondary source id'], group: '标识符', example: 'ClinicalTrials.gov/NCT123[si]' },
  { tag: 'nm', name: 'Supplementary Concept', aliases: ['supplementary concept'], group: '化学/基因', example: 'aspirin[nm]' },
  { tag: 'tw', name: 'Text Words', aliases: ['text words', 'text word'], group: '通用', example: 'aspirin[tw]' },
  { tag: 'ti', name: 'Title', aliases: ['title'], group: '通用', example: 'aspirin[ti]' },
  { tag: 'tiab', name: 'Title/Abstract', aliases: ['title/abstract', 'title abstract'], group: '通用', example: 'aspirin[tiab]' },
  { tag: 'tt', name: 'Transliterated Title', aliases: ['transliterated title'], group: '通用', example: 'aspirin[tt]' },
  { tag: 'vi', name: 'Volume', aliases: ['volume'], group: '期刊', example: '12[vi]' },
]

export const COMMENT_CORRECTION_FILTERS = [
  ['Comment in', 'hascommentin'], ['Comment on', 'hascommenton'],
  ['Corrected and republished in', 'hascorrectedrepublishedin'],
  ['Corrected and republished from', 'hascorrectedrepublishedfrom'],
  ['Dataset use reported in', 'hasassociatedpublication'],
  ['Dataset described in', 'hasassociateddataset'],
  ['Erratum in', 'haserratumin'], ['Erratum for', 'haserratumfor'],
  ['Expression of concern in', 'hasexpressionofconcernin'],
  ['Expression of concern for', 'hasexpressionofconcernfor'],
  ['Original Report in', 'hasoriginalreportin'],
  ['Republished in', 'hasrepublishedin'], ['Republished from', 'hasrepublishedfrom'],
  ['Retracted and republished in', 'hasretractedandrepublishedin'],
  ['Retracted and republished from', 'hasretractedandrepublishedfrom'],
  ['Retraction in', 'hasretractionin'], ['Retraction of', 'hasretractionof'],
  ['Summary for patients in', 'hassummaryforpatientsin'],
  ['Update in', 'hasupdatein'], ['Update of', 'hasupdateof'],
]

const ALIASES = new Map()
for (const f of PUBMED_FIELDS) {
  for (const a of [f.tag, f.name, ...(f.aliases ?? [])]) {
    ALIASES.set(String(a).toLowerCase().replace(/[._/-]+/g, ' ').replace(/\s+/g, ' ').trim(), f.tag)
  }
}
ALIASES.set('filter', 'sb')
ALIASES.set('subset', 'sb')

export function canonicalFieldTag(raw) {
  const base = String(raw ?? '').split(':')[0].toLowerCase().replace(/[._/-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return ALIASES.get(base) ?? null
}

export function listPubmedFields() {
  return PUBMED_FIELDS.map((f) => ({ ...f }))
}

/** 规范查询里的 [tag]；保留 [tiab:~3] 的邻近后缀。未知标签不删除，只报告。 */
export function normalizePubmedQuery(query) {
  const unknown = []
  const tags = []
  const q = String(query ?? '').replace(/\[([^\]]+)\]/g, (whole, inner) => {
    const [base, ...rest] = String(inner).split(':')
    const canon = canonicalFieldTag(base)
    if (!canon) { unknown.push(inner); return whole }
    tags.push(canon)
    return `[${canon}${rest.length ? ':' + rest.join(':') : ''}]`
  })
  return {
    query: q,
    tags: [...new Set(tags)],
    unknown: [...new Set(unknown)],
  }
}

function quoteTerm(t) {
  const s = String(t).trim()
  if (!s) return '""'
  if (/^".*"$/.test(s)) return s
  return /\s/.test(s) ? `"${s.replace(/"/g, '')}"` : s
}

const FIELD_MAP = {
  author: 'au', firstAuthor: '1au', lastAuthor: 'lastau', affiliation: 'ad',
  journal: 'ta', language: 'la', publicationType: 'pt', volume: 'vi', issue: 'ip',
  pages: 'pg', title: 'ti', text: 'tw', keyword: 'ot', mesh: 'mh',
  majorTopic: 'majr', subheading: 'sh', grant: 'gr', coi: 'cois',
  publisher: 'pubn', isbn: 'isbn', authorId: 'auid', investigator: 'ir',
  corporate: 'cn', editor: 'ed', subject: 'ps', pharmacological: 'pa',
  supplementary: 'nm', ecrn: 'rn', secondarySource: 'si', book: 'book',
  all: 'all', pmid: 'pmid', doi: 'aid', locationId: 'lid', nlmId: 'jid',
  owner: 'owner', place: 'pl',
}

export function fieldsToQuery(fields = {}) {
  const clauses = []
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) continue
    if (key === 'owner') { clauses.push(`owner${String(Array.isArray(value) ? value[0] : value)}`); continue }
    if (key === 'pmcid' || key === 'mid') {
      for (const v of Array.isArray(value) ? value : [value]) {
        const raw = String(v).trim()
        if (!raw) continue
        if (key === 'pmcid') clauses.push(/^PMC/i.test(raw) ? raw.toUpperCase() : `PMC${raw}`)
        else clauses.push(/^NIHMS/i.test(raw) ? raw : `NIHMS${raw}`)
      }
      continue
    }
    const tag = FIELD_MAP[key]
    if (!tag) continue
    const values = Array.isArray(value) ? value : [value]
    const parts = values.map((v) => `${quoteTerm(v)}[${tag}]`)
    clauses.push(parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0])
  }
  return clauses
}

const FILTER_MAP = {
  hasAbstract: 'hasabstract',
  freeFullText: '"free full text"[sb]',
  fullText: '"full text"[sb]',
  humans: '"humans"[mh]',
  animals: '"animals"[mh]',
  rct: '"randomized controlled trial"[pt]',
  metaAnalysis: '"meta-analysis"[pt]',
  systematicReview: '"systematic review"[pt]',
  guideline: '("guideline"[pt] OR "practice guideline"[pt])',
  retracted: '"retracted publication"[pt]',
  excludeRetracted: 'NOT "retracted publication"[pt]',
  hasCoi: 'hascois',
  hasCommentIn: 'hascommentin',
  hasRetractionIn: 'hasretractionin',
  hasErratumIn: 'haserratumin',
  hasExpressionOfConcern: 'hasexpressionofconcernin',
}

export function filtersToQuery(filters = []) {
  const list = Array.isArray(filters) ? filters : [filters]
  const clauses = []
  for (const f of list) {
    if (typeof f !== 'string' || !f.trim()) continue
    if (FILTER_MAP[f]) clauses.push(FILTER_MAP[f])
    else clauses.push(f)
  }
  return clauses
}

export function normalizeDate(v) {
  const s = String(v ?? '').trim()
  if (!s) return ''
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (m) return `${m[1]}/${String(m[2]).padStart(2, '0')}/${String(m[3]).padStart(2, '0')}`
  m = s.match(/^(\d{4})[-/](\d{1,2})$/)
  if (m) return `${m[1]}/${String(m[2]).padStart(2, '0')}`
  m = s.match(/^(\d{4})$/)
  return m ? m[1] : ''
}

export const DATE_FIELDS = new Set(['dp', 'edat', 'crdt', 'mhda', 'dcom', 'lr'])
