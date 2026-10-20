import { loadPaper } from '../lib/config.mjs'
import { resolvePaper } from '../lib/paper.mjs'
import { appendScreening, listScreening } from '../lib/screening.mjs'

function inputOf(values, positionals) {
  if (values.id) return String(values.id)
  if (values.doi) return `doi:${values.doi}`
  if (positionals.length) return positionals.join(' ')
  return ''
}

export async function run({ values, positionals }) {
  if (positionals[0] === 'list' || values.list) {
    const rows = listScreening().slice(-Math.max(1, Number(values.limit ?? 50)))
    if (values.json) { process.stdout.write(JSON.stringify({ ok: true, rows }, null, 2) + '\n'); return 0 }
    for (const r of rows) console.log(`${String(r.at).slice(0, 10)} · ${r.decision} · ${r.key} · ${r.reason}`)
    if (!rows.length) console.log('还没有筛选记录。')
    return 0
  }
  const input = inputOf(values, positionals)
  if (!input) throw new Error('用法：screen --id doi:... --decision include|exclude|maybe --reason "..."')
  const decision = String(values.decision ?? '').toLowerCase()
  if (!['include', 'exclude', 'maybe'].includes(decision)) throw new Error('--decision 只能是 include / exclude / maybe')
  const paper = loadPaper(input) ?? await resolvePaper(input)
  const row = appendScreening({ paper, decision, reason: values.reason ?? '', stage: values.stage ?? 'abstract' })
  if (values.json) { process.stdout.write(JSON.stringify({ ok: true, row }, null, 2) + '\n'); return 0 }
  console.log(`已记录：${decision} · ${paper.title}`)
  return 0
}
