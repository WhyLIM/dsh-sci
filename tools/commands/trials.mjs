import { searchTrials, getTrial } from '../lib/sources/clinicaltrials.mjs'
import { clip } from '../lib/normalize.mjs'

function card(t) {
  return [
    `### ${t.nctId} · ${t.title}`,
    '',
    `**状态**：${t.status || '?'} · **类型**：${t.studyType || '?'} · **阶段**：${(t.phases || []).join('/') || '?'} · **入组**：${t.enrollment ?? '?'}`,
    `**时间**：${t.startDate || '?'} → ${t.completionDate || '?'} · **申办方**：${t.sponsor || '?'}`,
    `**条件**：${(t.conditions || []).join(' / ') || '?'}`,
    `**干预**：${(t.interventions || []).map((x) => `${x.type}:${x.name}`).join(' / ') || '?'}`,
    t.primaryOutcomes?.length ? `**主要结局**：${t.primaryOutcomes.map((x) => x.measure).join(' / ')}` : '',
    t.summary ? `\n${clip(t.summary, 600)}` : '',
    '',
    t.url,
    '',
  ].filter(Boolean).join('\n')
}

export async function run({ values, positionals }) {
  const sub = positionals[0] ?? 'search'
  if (sub === 'get' || values.id || /^NCT\d{8}$/i.test(sub)) {
    const id = values.id ?? (sub === 'get' ? positionals[1] : sub)
    if (!id) throw new Error('用法：trials get NCT12345678')
    const t = await getTrial(id)
    if (values.json) { process.stdout.write(JSON.stringify({ ok: true, trial: t }, null, 2) + '\n'); return 0 }
    console.log(card(t))
    return 0
  }
  const query = String(values.query ?? (sub === 'search' ? positionals.slice(1).join(' ') : positionals.join(' ')) ?? '').trim()
  if (!query) throw new Error('用法：trials --query "myocardial infarction" [--status RECRUITING] [--limit 10]')
  const r = await searchTrials({ query, limit: Math.max(1, Math.min(50, Number(values.limit ?? 10) || 10)), status: values.status ?? '' })
  if (values.json) { process.stdout.write(JSON.stringify({ ok: !r.error, ...r }, null, 2) + '\n'); return r.error ? 2 : 0 }
  console.log(`# ClinicalTrials.gov：${query}\n`)
  if (r.error) console.log(`> 失败：${r.error}\n`)
  for (const t of r.trials) console.log(card(t))
  if (!r.trials.length) console.log('没有结果。')
  return 0
}
