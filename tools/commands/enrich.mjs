import fs from 'node:fs'
import path from 'node:path'
import { PATHS, loadPaper, paperKey, readConfig } from '../lib/config.mjs'
import { savePaperRecord } from '../lib/library.mjs'
import { resolvePaper } from '../lib/paper.mjs'
import { groundPaper, groundingMarkdown } from '../lib/annotations.mjs'

export async function run({ values, positionals }) {
  const id = values.id ?? positionals[0]
  if (!id) throw new Error('用法：enrich --id <paper> [--genes TP53,BRCA1] [--species human --build GRCh38]')
  const paper = loadPaper(id) ?? await resolvePaper(id)
  const cfg = readConfig()
  const key = paper.key ?? paperKey(paper)
  const file = path.join(PATHS.fulltext, `${key}.txt`)
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : `${paper.title ?? ''}\n${paper.abstract ?? ''}`
  const g = await groundPaper(paper, text, {
    species: values.species ?? '', build: values.build ?? '', genes: values.genes ?? '',
    diseases: values.diseases ?? '', drugs: values.drugs ?? '',
    maxEntities: values.limit ?? 8, refresh: Boolean(values.refresh), usePubtator: cfg.reading.usePubtator !== false,
  })
  paper.grounding = g
  savePaperRecord(paper)
  if (values.json) process.stdout.write(JSON.stringify(g, null, 2) + '\n')
  else console.log(groundingMarkdown(g))
  return 0
}
