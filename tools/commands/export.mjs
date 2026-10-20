import fs from 'node:fs'
import path from 'node:path'
import { ensureDataDirs, loadPaper } from '../lib/config.mjs'
import { listPapers } from '../lib/library.mjs'
import { resolvePaper } from '../lib/paper.mjs'
import { formatExport } from '../lib/exporters.mjs'

function inputOf(values, positionals) {
  if (values.id) return String(values.id)
  if (values.doi) return `doi:${values.doi}`
  if (positionals.length) return positionals.join(' ')
  return ''
}

export async function run({ values, positionals }) {
  const format = String(values.format ?? 'ris').toLowerCase()
  let papers = []
  const input = inputOf(values, positionals)
  if (values.all || values.tag || values.status) {
    papers = listPapers()
    if (values.tag) {
      const tags = String(values.tag).split(',').map((x) => x.trim()).filter(Boolean)
      papers = papers.filter((p) => tags.every((t) => p.tags?.includes(t)))
    }
    if (values.status) papers = papers.filter((p) => p.status === values.status)
  } else if (input) {
    papers = [loadPaper(input) ?? await resolvePaper(input)]
  } else {
    throw new Error('用法：export --all --format ris|bibtex|csl-json [--out file] 或 export --id doi:...')
  }
  if (!papers.length) throw new Error('没有可导出的论文')
  const text = formatExport(papers, format)
  if (values.out) {
    ensureDataDirs()
    const file = path.resolve(String(values.out))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
    console.log(`已导出 ${papers.length} 篇到 ${file}`)
  } else {
    process.stdout.write(text)
  }
  return 0
}
