import { extractBenchmark, loadPaperTables } from '../lib/benchmark.mjs'

export async function run({ values, positionals }) {
  const id = values.id ?? positionals[0]
  if (!id) throw new Error('用法：benchmark --id <paper>')
  const { paper, tables } = await loadPaperTables(id)
  const r = extractBenchmark(tables, { paper })
  if (values.json) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); return 0 }
  console.log(`# Benchmark · ${paper.title}\n`)
  for (const t of r.tables) {
    console.log(`## ${t.label || 'Table'}`)
    if (t.caption) console.log(`\n${t.caption}\n`)
    console.log(`指标列：${t.metricColumns.join(', ')} · 数据集列：${t.datasetColumn || '—'} · 方法列：${t.methodColumn || '—'}`)
    for (const row of t.rows.slice(0, 30)) console.log(`- ${Object.entries(row).map(([k, v]) => `${k}=${v}`).join(' · ')}`)
    console.log('')
  }
  return 0
}
