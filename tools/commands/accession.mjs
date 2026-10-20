import { detectAccession } from '../lib/entities.mjs'
import { databaseGet, getDatabase } from '../lib/databases.mjs'

export async function run({ values, positionals }) {
  const id = values.id ?? positionals[0]
  if (!id) throw new Error('用法：accession <GSE...|PRJNA...|SRR...|PXD...|rs...|ENSG...>')
  const acc = detectAccession(id)
  if (!acc) throw new Error(`无法识别 accession：${id}`)
  const r = await databaseGet(acc.db, acc.id, { limit: values.limit ?? '10', species: values.species ?? '' })
  if (values.json) process.stdout.write(JSON.stringify({ ...r, detected: acc }, null, 2) + '\n')
  else if (!r.ok) { console.error(`✗ ${r.error}`); return 1 }
  else {
    console.log(`# ${getDatabase(acc.db)?.name ?? acc.db} · ${acc.id}`)
    for (const [i, item] of (r.items ?? []).entries()) console.log(`\n${i + 1}. ${JSON.stringify(item).slice(0, 1500)}`)
  }
  return r.ok ? 0 : 1
}
