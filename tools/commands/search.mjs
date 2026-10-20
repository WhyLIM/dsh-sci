import { readConfig, appendLog, paperKey } from '../lib/config.mjs'
import { searchAll } from '../lib/search.mjs'
import { rankPapers } from '../lib/normalize.mjs'
import { paperCard } from '../lib/format.mjs'
import { intArg } from '../lib/util.mjs'
import { queryForLog } from '../lib/privacy.mjs'
import { topicQueries } from '../lib/topics.mjs'
import { resolveEntity, buildEntityQueries } from '../lib/entities.mjs'

export async function run({ values, positionals }) {
  const cfg = readConfig()
  const inputQuery = String(values.query ?? positionals.join(' ') ?? '').trim()
  let entityQuery = ''
  if (values.entity) {
    const [etype, ...rest] = String(values.entity).includes(':') ? String(values.entity).split(':') : ['auto', String(values.entity)]
    const ent = await resolveEntity({ type: etype, id: rest.join(':'), species: values.species ?? '' })
    entityQuery = buildEntityQueries(ent, { species: values.species ?? '' }).pubmed
    if (values.json) process.stderr.write(`entity=${JSON.stringify(ent)}\n`)
  }
  const topicQ = values['no-topic'] ? '' : (topicQueries(cfg)[0] ?? '')
  const query = inputQuery || entityQuery || topicQ
  if (!query) throw new Error('用法：search --query "protein language model"（或先引入研究课题，search 会使用课题 scope）')
  const days = intArg(values.days, cfg.search.lookbackDays, 1, 3650)
  const limit = intArg(values.limit, cfg.search.perSource, 1, 50)
  const sourceNames = values.source ? String(values.source).split(',').map((s) => s.trim()).filter(Boolean) : undefined
  const discoveryOAOnly = values['no-oa'] ? false : (values['oa-only'] ?? cfg.search.discoveryOAOnly)
  const includePreprints = values['no-preprints'] ? false : (values.preprints ?? cfg.search.includePreprints)
  const includeEditorials = values.editorials ?? cfg.search.includeEditorials
  const includeGuidelines = values['no-guidelines'] ? false : (values.guidelines ?? cfg.search.includeGuidelines)
  const titleAbstractOnly = values['no-title-abs'] ? false : (values['title-abs'] ?? cfg.search.titleAbstractOnly)
  const synonymExpansion = values['no-synonym'] ? false : (values.synonym ?? cfg.search.synonymExpansion)
  const res = await searchAll({
    query,
    days,
    perSource: limit,
    discoveryOAOnly: Boolean(discoveryOAOnly),
    includePreprints: Boolean(includePreprints),
    includeEditorials: Boolean(includeEditorials),
    includeGuidelines: Boolean(includeGuidelines),
    titleAbstractOnly: Boolean(titleAbstractOnly),
    synonymExpansion: Boolean(synonymExpansion),
    pubTypes: cfg.researcher.studyTypes ?? [],
    sourceNames,
    bypassCache: Boolean(values['no-cache']),
  })
  const ranked = rankPapers(res.papers, cfg.researcher, { now: new Date() }).slice(0, limit)
  const errors = res.reports.filter((r) => r.error)
  appendLog('search', `${queryForLog(query, cfg)} · ${ranked.length} 条`, { query: queryForLog(query, cfg), days })
  if (values.json) {
    process.stdout.write(JSON.stringify({
      ok: ranked.length > 0,
      query,
      days,
      reports: res.reports,
      count: ranked.length,
      papers: ranked.map((r) => ({ ...r.paper, key: r.paper.key ?? paperKey(r.paper), _score: r.score, _signals: r.signals })),
    }, null, 2) + '\n')
    return errors.length && !ranked.length ? 2 : 0
  }
  console.log(`# 检索：${query}\n`)
  console.log(`近 ${days} 天 · ${res.reports.map((r) => `${r.source} ${r.count}${r.error ? '（失败）' : ''}`).join(' · ')}\n`)
  if (errors.length) {
    for (const e of errors) console.log(`> ${e.source} 失败：${String(e.error).slice(0, 240)}`)
    console.log('')
  }
  if (!ranked.length) {
    console.log('没有结果。可以放宽 --days、换关键词，或检查上面的源失败信息。')
    return 0
  }
  ranked.forEach((r, i) => console.log(paperCard(r.paper, { rank: i + 1, score: r.score, signals: r.signals }) + '\n'))
  return 0
}
