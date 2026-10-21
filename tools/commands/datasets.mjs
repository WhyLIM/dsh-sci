import { searchDatasets, getDataset, datasetFiles } from '../lib/datasets.mjs'
import { detectAccessionDb } from '../lib/databases.mjs'

export async function run({ values, positionals }) {
  const sub = positionals[0] ?? 'search'
  if (sub === 'files' || sub === 'file-list') {
    const acc = values.id ?? positionals[1]
    if (!acc) throw new Error('用法：dataset files <GSE...|PRJNA...|PXD...>')
    const r = await datasetFiles(acc, { limit: values.limit ?? '50' })
    if (values.json) process.stdout.write(JSON.stringify(r, null, 2) + '\n')
    else if (!r.ok) { console.error(`✗ ${r.error}`); return 1 }
    else {
      console.log(`# ${r.source} · ${r.accession} · ${r.total} 个文件/记录`)
      for (const [i, x] of r.items.entries()) console.log(`\n${i + 1}. ${JSON.stringify(x).slice(0, 1200)}`)
      for (const w of r.warnings ?? []) console.log(`⚠️ ${w}`)
    }
    return r.ok ? 0 : 1
  }
  if (sub === 'get' || sub === 'fetch') {
    const acc = values.id ?? positionals[1]
    if (!acc) throw new Error('用法：dataset get <GSE...|PRJNA...|PXD...|ST...>')
    const r = await getDataset(acc, { limit: values.limit ?? '10', species: values.species ?? '' })
    if (values.json) process.stdout.write(JSON.stringify({ ...r, accession: detectAccessionDb(acc) }, null, 2) + '\n')
    else if (!r.ok) { console.error(`✗ ${r.error}`); return 1 }
    else { console.log(`# ${acc}`); for (const [i, x] of (r.items ?? []).entries()) console.log(`\n${i + 1}. ${JSON.stringify(x).slice(0, 1200)}`) }
    return r.ok ? 0 : 1
  }
  const query = values.query ?? positionals.slice(1).join(' ')
  const sources = String(values.source || '').split(',').map((x) => x.trim()).filter(Boolean)
  const r = await searchDatasets(query, {
    species: values.species ?? '',
    sources: sources.length ? sources : undefined,
    limit: values.limit ?? '5',
  })
  if (values.json) process.stdout.write(JSON.stringify(r, null, 2) + '\n')
  else {
    console.log(`# 组学数据集 · ${r.query}`)
    console.log(`来源：${Object.entries(r.bySource).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
    for (const [i, x] of r.items.slice(0, 30).entries()) console.log(`\n${i + 1}. [${x.source}] ${JSON.stringify(x).slice(0, 600)}`)
    if (!r.items.length) console.log('（没有结果；换关键词/物种，或直接用 accession）')
    if (r.errors?.length) console.log(`\n部分源失败：${r.errors.map((e) => `${e.db}: ${e.error}`).join(' · ')}`)
    console.log('\n> 注意：这是跨库聚合，不是 completeness 证明；日期/物种过滤语义不同。')
  }
  return 0
}
