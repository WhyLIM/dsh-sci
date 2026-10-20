import { appendLog, loadPaper } from '../lib/config.mjs'
import { resolvePaper } from '../lib/paper.mjs'
import { getRelated } from '../lib/sources/citations.mjs'
import { paperCard } from '../lib/format.mjs'

function inputOf(values, positionals) {
  if (values.id) return String(values.id)
  if (values.doi) return `doi:${values.doi}`
  if (values.pmid) return `pmid:${values.pmid}`
  if (positionals.length) return positionals.join(' ')
  return ''
}

export async function run({ values, positionals }) {
  const input = inputOf(values, positionals)
  if (!input) throw new Error('用法：related --id doi:... [--direction citations|references|both] [--limit 10]')
  const paper = loadPaper(input) ?? await resolvePaper(input)
  const direction = ['citations', 'references', 'both'].includes(values.direction) ? values.direction : 'both'
  const limit = Math.max(1, Math.min(50, Number(values.limit ?? 10) || 10))
  const r = await getRelated(paper, { direction, limit })
  appendLog('related', paper.title, { key: paper.key, direction, citations: r.citations?.length ?? 0, references: r.references?.length ?? 0 })
  if (values.json) {
    process.stdout.write(JSON.stringify({ ok: true, paper, ...r }, null, 2) + '\n')
    return 0
  }
  console.log(`# 引文追踪：${paper.title}\n`)
  if (r.ref) console.log(`Europe PMC：${r.ref.source}/${r.ref.id}\n`)
  for (const key of ['citations', 'references']) {
    if (!r[key]) continue
    console.log(`\n## ${key === 'citations' ? '被引（谁引用了它）' : '参考文献（它引用了谁）'} · ${r[key].length}\n`)
    r[key].forEach((p, i) => console.log(paperCard(p, { rank: i + 1 }) + '\n'))
  }
  for (const e of r.errors ?? []) console.log(`> 部分失败：${e}`)
  return 0
}
