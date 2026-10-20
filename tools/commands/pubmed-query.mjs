import { buildPubmedQuery } from '../lib/sources/pubmed.mjs'
import { normalizePubmedQuery } from '../lib/sources/pubmed-fields.mjs'
import { intArg } from '../lib/util.mjs'

function csv(v) {
  return v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : []
}

export async function run({ values, positionals }) {
  const query = String(values.query ?? positionals.join(' ') ?? '').trim()
  const fields = {
    author: values.author,
    firstAuthor: values['first-author'],
    lastAuthor: values['last-author'],
    affiliation: values.affiliation,
    journal: values.journal,
    language: values.language,
    publicationType: values.pt,
    title: values.title,
    mesh: values.mesh,
    grant: values.grant,
    coi: values.coi,
    pmid: values.pmid,
    pmcid: values.pmcid,
    mid: values.mid,
    doi: values.doi ? String(values.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '') : '',
  }
  for (const k of Object.keys(fields)) if (!fields[k]) delete fields[k]
  const filters = csv(values.filter)
  const pubTypes = csv(values.pt)
  if (fields.publicationType) delete fields.publicationType
  const built = buildPubmedQuery({
    query,
    days: intArg(values.days, 14, 1, 3650),
    titleAbstractOnly: !values['no-title-abs'],
    pubTypes,
    fields,
    filters,
    dateFrom: values.from || '',
    dateTo: values.to || '',
    dateField: values['date-field'] || 'dp',
  })
  const norm = normalizePubmedQuery(built)
  if (values.json) {
    process.stdout.write(JSON.stringify({ ok: norm.unknown.length === 0, query: built, tags: norm.tags, unknown: norm.unknown, fields, filters, pubTypes }, null, 2) + '\n')
    return norm.unknown.length ? 2 : 0
  }
  if (values.validate) {
    console.log(`valid=${norm.unknown.length === 0} tags=${norm.tags.join(',') || '-'} unknown=${norm.unknown.join(',') || '-'}`)
    return norm.unknown.length ? 2 : 0
  }
  console.log(built)
  console.log(`\n标签：${norm.tags.join(', ') || '无'}`)
  if (norm.unknown.length) console.log(`⚠️ 未知标签：${norm.unknown.join(', ')}（已原样保留）`)
  return norm.unknown.length ? 2 : 0
}
