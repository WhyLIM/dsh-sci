import { readConfig, todayLocal, appendLog } from '../lib/config.mjs'
import { collectCandidates, markSeen, saveStrategy } from '../lib/search.mjs'
import { briefMarkdown } from '../lib/format.mjs'
import { listPapers, listIdeas, saveBrief } from '../lib/library.mjs'
import { intArg } from '../lib/util.mjs'
import { queryForLog } from '../lib/privacy.mjs'
import { searchTrials } from '../lib/sources/clinicaltrials.mjs'

export async function run({ values }) {
  const cfg = readConfig()
  const result = await collectCandidates({
    query: values.query ? String(values.query) : undefined,
    days: values.days ? intArg(values.days, undefined, 1, 3650) : undefined,
    maxCandidates: values.max ? intArg(values.max, undefined, 1, 30) : undefined,
    bypassCache: Boolean(values['no-cache']),
    includeSeen: Boolean(values['include-seen']),
  })
  const date = todayLocal()
  const extraLines = []

  const queue = listPapers().filter((p) => ['reading', 'queued'].includes(p.status)).slice(0, 4)
  if (queue.length) {
    extraLines.push('## 继续读（之前没读完的）', '')
    for (const p of queue) {
      extraLines.push(`- ${p.title}（${p.status}）· \`${p.key}\`${p.oneLine ? ` — ${p.oneLine}` : ''}`)
    }
    extraLines.push('')
  }
  let trials = null
  if (cfg.sources.clinicaltrials) {
    const tq = result.queries[0] || cfg.researcher.field
    const tr = await searchTrials({ query: tq, limit: 5 })
    trials = tr
    if (tr.trials?.length) {
      extraLines.push('## 相关临床试验（注册信息，不等于疗效证据）', '')
      for (const t of tr.trials) {
        extraLines.push(`- **${t.nctId}** ${t.title} · ${t.status} · ${t.studyType || ''} ${t.phases?.join('/') || ''} · 入组 ${t.enrollment ?? '?'}`)
        extraLines.push(`  ${t.url}`)
      }
      extraLines.push('')
    } else if (tr.error) {
      extraLines.push(`## 相关临床试验\n\n> 检索失败：${tr.error}\n`)
    }
  }
  const ideas = listIdeas({ limit: 4 })
  if (ideas.length) {
    extraLines.push('## 最近的想法', '')
    for (const i of ideas) extraLines.push(`- ${i.text}${i.from ? `（来自 ${i.from}）` : ''}`)
    extraLines.push('')
  }

  const md = briefMarkdown({ date, field: cfg.researcher.field, cfg, result, extra: extraLines.join('\n') })
  let file = null
  let strategyFile = null
  if (values.save) {
    file = saveBrief(md, date)
    strategyFile = saveStrategy(result)
    markSeen(result.candidates.map((c) => c.paper), cfg.search.seenDays)
    appendLog('brief', `${date} · ${result.candidates.length} 条候选`, { file, queries: result.queries.map((q) => queryForLog(q, cfg)) })
  }
  if (values.json) {
    process.stdout.write(JSON.stringify({
      ok: true,
      date,
      file,
      strategyFile,
      queries: result.queries,
      prisma: result.prisma,
      trials,
      scanned: result.scanned,
      afterFilter: result.afterFilter,
      candidates: result.candidates,
      markdown: md,
    }, null, 2) + '\n')
    return 0
  }
  process.stdout.write(md)
  if (file) console.log(`\n已保存：${file}${strategyFile ? `\n检索策略：${strategyFile}` : ''}`)
  return 0
}
