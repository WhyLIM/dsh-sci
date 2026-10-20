import fs from 'node:fs'
import path from 'node:path'
import { PATHS, loadPaper, paperKey } from '../lib/config.mjs'
import { resolvePaper } from '../lib/paper.mjs'
import { readNote } from '../lib/library.mjs'
import { qcText, qcMarkdown } from '../lib/qc.mjs'

export async function run({ values, positionals }) {
  let text = ''
  if (values.file) text = fs.readFileSync(String(values.file), 'utf8')
  else if (values.text) text = String(values.text)
  else {
    const id = values.id ?? positionals[0]
    if (!id) throw new Error('用法：qc --id <paper> | --file <path> | --text "..."')
    const paper = loadPaper(id) ?? await resolvePaper(id)
    const key = paper.key ?? paperKey(paper)
    const full = path.join(PATHS.fulltext, `${key}.txt`)
    if (fs.existsSync(full)) text = fs.readFileSync(full, 'utf8')
    else {
      const note = readNote(key)
      if (!note) throw new Error(`没有全文缓存或笔记：${key}。先 read --id ${id}。`)
      text = note.text
    }
  }
  const r = qcText(text)
  if (values.json) process.stdout.write(JSON.stringify(r, null, 2) + '\n')
  else console.log(qcMarkdown(r))
  return 0
}
