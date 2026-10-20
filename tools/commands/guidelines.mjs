import { readConfig } from '../lib/config.mjs'
import { searchAll } from '../lib/search.mjs'
import { rankPapers } from '../lib/normalize.mjs'
import { paperCard } from '../lib/format.mjs'
import { intArg } from '../lib/util.mjs'

export async function run({ values, positionals }) {
  const cfg = readConfig()
  const query = String(values.query ?? positionals.join(' ') ?? '').trim()
  if (!query) throw new Error('用法：guidelines --query "myocardial infarction" [--days 3650] [--limit 10]')
  const days = intArg(values.days, 3650, 1, 3650)
  const limit = intArg(values.limit, 10, 1, 50)
  const pubTypes = ['Guideline', 'Practice Guideline', 'Consensus Development Conference']
  const res = await searchAll({
    query,
    days,
    perSource: limit,
    discoveryOAOnly: false,
    includePreprints: false,
    includeEditorials: false,
    includeGuidelines: true,
    titleAbstractOnly: cfg.search.titleAbstractOnly,
    synonymExpansion: cfg.search.synonymExpansion,
    pubTypes,
    sourceNames: ['europepmc', 'pubmed'],
    bypassCache: Boolean(values['no-cache']),
  })
  const ranked = rankPapers(res.papers, cfg.researcher, { now: new Date() }).slice(0, limit)
  if (values.json) {
    process.stdout.write(JSON.stringify({ ok: ranked.length > 0, query, reports: res.reports, papers: ranked }, null, 2) + '\n')
    return 0
  }
  console.log(`# 指南/共识：${query}\n`)
  console.log(res.reports.map((r) => `${r.source} ${r.count}${r.error ? '（失败）' : ''}`).join(' · ') + '\n')
  if (!ranked.length) console.log('没有找到指南。可以放宽 --days，或改用普通 search。')
  ranked.forEach((r, i) => console.log(paperCard(r.paper, { rank: i + 1, score: r.score, signals: r.signals }) + '\n'))
  return 0
}
