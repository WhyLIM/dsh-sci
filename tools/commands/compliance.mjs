import fs from 'node:fs'
import path from 'node:path'
import { PATHS, loadPaper, paperKey } from '../lib/config.mjs'
import { resolvePaper } from '../lib/paper.mjs'
import { extractRepro } from '../lib/repro.mjs'

export async function run({ values, positionals }) {
  let text = ''
  if (values.file) text = fs.readFileSync(String(values.file), 'utf8')
  else if (values.text) text = String(values.text)
  else {
    const id = values.id ?? positionals[0]
    if (!id) throw new Error('用法：compliance --id <paper> | --file <path> | --text "..."')
    const paper = loadPaper(id) ?? await resolvePaper(id)
    const key = paper.key ?? paperKey(paper)
    const f = path.join(PATHS.fulltext, `${key}.txt`)
    if (fs.existsSync(f)) text = fs.readFileSync(f, 'utf8')
    else throw new Error('没有全文缓存；先 read，或用 --file/--text')
  }
  const r = extractRepro(text)
  const out = { ok: true, controlled: r.controlled, onRequest: r.onRequest, accessions: r.accessions, warnings: r.warnings, action: '仅报告；不尝试下载受控数据，不使用未经授权的 accessions。' }
  if (values.json) process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  else {
    console.log('# 合规检查（受控数据）\n')
    console.log(`受控/伦理线索：${r.controlled.join(', ') || '未识别'}`)
    console.log(`on-request：${r.onRequest.join(', ') || '未识别'}`)
    console.log(`accessions：${r.accessions.map((x) => `${x.db}:${x.id}`).join(', ') || '未识别'}`)
    for (const w of r.warnings) console.log(`- ${w}`)
    console.log('\n> 不尝试绕过 dbGaP/EGA/DUA/IRB；受控数据只报告，不下载。')
  }
  return 0
}
