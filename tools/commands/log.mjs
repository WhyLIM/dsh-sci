import fs from 'node:fs'
import { PATHS, appendLog, ensureDataDirs } from '../lib/config.mjs'
import { intArg } from '../lib/util.mjs'

export async function run({ values, positionals }) {
  const sub = positionals[0] ?? 'tail'
  if (sub === 'add') {
    const kind = String(values.kind ?? 'note')
    const note = values.note ? String(values.note) : positionals.slice(1).join(' ')
    if (!note.trim()) throw new Error('用法：log add --kind search --note "..."')
    appendLog(kind, note)
    console.log('已记录')
    return 0
  }
  if (sub === 'tail' || sub === 'list') {
    ensureDataDirs()
    let lines = []
    try { lines = fs.readFileSync(PATHS.log, 'utf8').split('\n').filter(Boolean) } catch {}
    const rows = lines.slice(-intArg(values.limit, 30, 1, 500)).map((l) => {
      try { return JSON.parse(l) } catch { return { at: '', kind: '?', note: l } }
    }).reverse()
    if (values.json) {
      process.stdout.write(JSON.stringify({ ok: true, events: rows }, null, 2) + '\n')
      return 0
    }
    for (const r of rows) console.log(`${String(r.at).slice(0, 19).replace('T', ' ')} · ${r.kind} · ${r.note}`)
    if (!rows.length) console.log('还没有事件。')
    return 0
  }
  throw new Error(`未知子命令：log ${sub}。可用：add / tail`)
}
