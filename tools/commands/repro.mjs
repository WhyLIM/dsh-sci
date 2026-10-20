import fs from 'node:fs'
import path from 'node:path'
import { PATHS, loadPaper, paperKey } from '../lib/config.mjs'
import { resolvePaper } from '../lib/paper.mjs'
import { extractRepro, reproMarkdown } from '../lib/repro.mjs'

export async function run({ values, positionals }) {
  let text = ''
  let paper = null
  if (values.file) text = fs.readFileSync(String(values.file), 'utf8')
  else if (values.text) text = String(values.text)
  else {
    const id = values.id ?? positionals[0]
    if (!id) throw new Error('用法：repro --id <paper> | --file <path> | --text "..."')
    paper = loadPaper(id) ?? await resolvePaper(id)
    const key = paper.key ?? paperKey(paper)
    const file = path.join(PATHS.fulltext, `${key}.txt`)
    if (!fs.existsSync(file)) throw new Error(`没有全文缓存：${file}。先 read --id ${id}，或用 --file。`)
    text = fs.readFileSync(file, 'utf8')
  }
  const r = extractRepro(text, paper ?? {})
  if (values.json) { process.stdout.write(JSON.stringify({ ok: true, repro: r }, null, 2) + '\n'); return 0 }
  console.log(reproMarkdown(r))
  return 0
}
