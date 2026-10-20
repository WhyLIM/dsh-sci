import { detectAccession, resolveEntity, buildEntityQueries } from '../lib/entities.mjs'
import { databaseGet, getDatabase } from '../lib/databases.mjs'

function print(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n') }

export async function run({ values, positionals }) {
  const sub = positionals[0] ?? 'detect'
  if (sub === 'detect') {
    const id = values.id ?? positionals[1]
    if (!id) throw new Error('用法：entity detect <id>')
    print({ ok: true, input: id, accession: detectAccession(id) })
    return 0
  }
  if (sub === 'resolve' || sub === 'query') {
    const type = values.type ?? positionals[1] ?? 'auto'
    const id = values.id ?? positionals[2]
    if (!id) throw new Error(`用法：entity ${sub} <gene|protein|variant|auto> <id> [--species human]`)
    const entity = await resolveEntity({ type, id, species: values.species ?? '' })
    const queries = buildEntityQueries(entity, { species: values.species ?? '' })
    if (values.json || sub === 'query') print({ ok: entity.ok, entity, queries })
    else {
      console.log(`# ${entity.type} · ${entity.canonical}`)
      console.log(`规范 ID：${JSON.stringify(entity.ids)}`)
      console.log(`物种：${entity.organism || '未指定'}`)
      console.log(`别名：${(entity.aliases ?? []).join(', ') || '无'}`)
      console.log(`来源：${entity.source || '原始词'}`)
      for (const w of entity.warnings ?? []) console.log(`⚠️ ${w}`)
      console.log(`\nPubMed：${queries.pubmed || '—'}\nEurope PMC：${queries.europepmc || '—'}`)
    }
    return entity.ok ? 0 : 1
  }
  if (sub === 'accession' || sub === 'lookup') {
    const id = values.id ?? positionals[1]
    if (!id) throw new Error('用法：accession lookup <GSE...|PRJNA...|PXD...|rs...>')
    const acc = detectAccession(id)
    if (!acc) throw new Error(`无法识别 accession：${id}`)
    const r = await databaseGet(acc.db, acc.id, { limit: values.limit ?? '10', species: values.species ?? '' })
    if (values.json) print({ ...r, detected: acc, provenance: { detected: acc, accessDate: new Date().toISOString() } })
    else {
      if (!r.ok) { console.error(`✗ ${r.error}`); return 1 }
      console.log(`# ${getDatabase(acc.db)?.name ?? acc.db} · ${acc.id}`)
      for (const [i, item] of (r.items ?? []).entries()) console.log(`\n${i + 1}. ${JSON.stringify(item).slice(0, 1200)}`)
    }
    return r.ok ? 0 : 1
  }
  throw new Error(`未知 entity 子命令：${sub}。可用：detect/resolve/query/accession`)
}
