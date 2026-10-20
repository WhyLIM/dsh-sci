import { readConfig, emailFor } from '../lib/config.mjs'
import { searchEuropePmc } from '../lib/sources/europepmc.mjs'
import { searchPubmed } from '../lib/sources/pubmed.mjs'
import { dedupePapers, rankPapers } from '../lib/normalize.mjs'
import { paperCard } from '../lib/format.mjs'
import { intArg } from '../lib/util.mjs'
import { searchDatasets } from '../lib/datasets.mjs'
import { httpJson } from '../lib/http.mjs'

export async function run({ values, positionals }) {
  const cfg = readConfig()
  const kind = String(values.kind || 'journal').toLowerCase()
  const q0 = String(values.query ?? positionals.join(' ') ?? '').trim()
  if (kind === 'dataset' || kind === 'datasets' || kind === 'omics') {
    if (!q0) throw new Error('watch --kind dataset 需要 --query "关键词"')
    const r = await searchDatasets(q0, { species: values.species ?? '', limit: intArg(values.limit, 8, 1, 20) })
    if (values.json) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); return 0 }
    console.log(`# 数据集 watch · ${q0}\n`)
    for (const [i, x] of r.items.entries()) console.log(`${i + 1}. [${x.source}] ${JSON.stringify(x).slice(0, 700)}\n`)
    if (r.errors?.length) console.log(`部分源失败：${r.errors.map((e) => `${e.db}: ${e.error}`).join(' · ')}`)
    return 0
  }
  if (kind === 'preprint' || kind === 'preprints' || kind === 'biorxiv') {
    if (!q0) throw new Error('watch --kind preprint 需要 --query "关键词"')
    const e = await searchEuropePmc({ query: q0, days: intArg(values.days, 30, 1, 3650), limit: intArg(values.limit, 8, 1, 50), oaOnly: false, includePreprints: true, titleAbstractOnly: true, includeEditorials: false, includeGuidelines: false, synonymExpansion: true })
    e.papers = (e.papers ?? []).filter((p) => p.isPreprint)
    if (values.json) { process.stdout.write(JSON.stringify({ ok: true, report: e, papers: e.papers }, null, 2) + '\n'); return 0 }
    console.log(`# 预印本 watch · ${q0}\n`)
    for (const [i, p] of e.papers.entries()) console.log(paperCard(p, { rank: i + 1 }) + '\n')
    return 0
  }
  if (kind === 'tool' || kind === 'tools' || kind === 'github') {
    const repos = q0.split(',').map((x) => x.trim()).filter(Boolean)
    if (!repos.length) throw new Error('watch --kind tool 需要 --query owner/repo')
    const out = []
    for (const repo of repos) {
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { out.push({ repo, error: '格式应为 owner/repo' }); continue }
      try {
        const d = await httpJson(`https://api.github.com/repos/${repo}/releases/latest`, { timeoutMs: 20_000, cacheTtlMs: 6 * 36e5, headers: { accept: 'application/vnd.github+json' } })
        out.push({ repo, tag: d.tag_name, name: d.name, published: d.published_at, url: d.html_url })
      } catch (e) { out.push({ repo, error: String(e.message).slice(0, 160) }) }
    }
    if (values.json) { process.stdout.write(JSON.stringify({ ok: true, releases: out }, null, 2) + '\n'); return 0 }
    console.log('# 工具 release watch\n')
    for (const r of out) console.log(r.error ? `- ${r.repo}: ${r.error}` : `- ${r.repo}: ${r.tag} · ${r.published ?? ''} · ${r.url}`)
    return 0
  }
  const issns = (cfg.researcher.issns ?? []).filter(Boolean)
  const fallback = q0
  if (!issns.length && !fallback) throw new Error('先在设置里填「常看期刊 ISSN」，或 watch --query "journal name"')
  const days = intArg(values.days, 30, 1, 3650)
  const limit = intArg(values.limit, 8, 1, 50)
  const all = []
  const reports = []
  const targets = issns.length ? issns : [fallback]
  for (const target of targets) {
    const isIssn = /^\d{4}-?\d{3}[\dX]$/i.test(target)
    const epmcQ = isIssn ? `ISSN:"${target}"` : `JOURNAL:"${target}"`
    const pubmedQ = isIssn ? `"${target}"[issn]` : `"${target}"[ta]`
    const [e, p] = await Promise.all([
      searchEuropePmc({ query: epmcQ, days, limit, oaOnly: false, includePreprints: false, titleAbstractOnly: false, includeEditorials: false, includeGuidelines: true, synonymExpansion: false }),
      searchPubmed({ query: pubmedQ, days, limit, titleAbstractOnly: false, email: emailFor('pubmed', cfg) }),
    ])
    all.push(...e.papers, ...p.papers)
    reports.push({ target, europepmc: e.count, pubmed: p.count, errors: [e.error, p.error].filter(Boolean) })
  }
  const ranked = rankPapers(dedupePapers(all), cfg.researcher, { now: new Date() }).slice(0, limit)
  if (values.json) {
    process.stdout.write(JSON.stringify({ ok: true, issns: targets, days, reports, papers: ranked }, null, 2) + '\n')
    return 0
  }
  console.log(`# 期刊 watchlist · 近 ${days} 天\n`)
  for (const r of reports) console.log(`- ${r.target}: Europe PMC ${r.europepmc} · PubMed ${r.pubmed}${r.errors.length ? ` · 失败 ${r.errors.join(' / ')}` : ''}`)
  console.log('')
  if (!ranked.length) console.log('没有新论文。')
  ranked.forEach((r, i) => console.log(paperCard(r.paper, { rank: i + 1, score: r.score, signals: r.signals }) + '\n'))
  return 0
}
