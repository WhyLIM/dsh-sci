import { appendLog } from '../lib/config.mjs'
import { appendIdea, listIdeas } from '../lib/library.mjs'

export async function run({ values, positionals }) {
  const sub = positionals[0] ?? 'list'
  if (sub === 'add') {
    const text = values.text ? String(values.text) : positionals.slice(1).join(' ')
    if (!text.trim()) throw new Error('用法：idea add "一句想法" [--from doi:...] [--tags a,b]')
    const tags = values.tags ? String(values.tags).split(',').map((x) => x.trim()).filter(Boolean) : []
    const row = appendIdea(text, { from: values.from ?? '', tags })
    appendLog('idea', text, { from: row.from })
    if (values.json) {
      process.stdout.write(JSON.stringify({ ok: true, idea: row }, null, 2) + '\n')
      return 0
    }
    console.log(`已记录：${row.text}`)
    return 0
  }
  if (sub === 'list' || sub === 'ls') {
    const ideas = listIdeas({ limit: Number(values.limit ?? 30) })
    if (values.json) {
      process.stdout.write(JSON.stringify({ ok: true, ideas }, null, 2) + '\n')
      return 0
    }
    console.log(`# 想法（${ideas.length} 条）\n`)
    for (const i of ideas) console.log(`- ${String(i.at).slice(0, 10)} · ${i.text}${i.from ? `（来自 ${i.from}）` : ''}`)
    if (!ideas.length) console.log('还没有。读论文时想到什么，就用 `idea add` 记下来。')
    return 0
  }
  throw new Error(`未知子命令：idea ${sub}。可用：add / list`)
}
