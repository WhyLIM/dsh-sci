import { listPapers, paperStats, listIdeas, recentNotes } from '../lib/library.mjs'
import { libraryTable } from '../lib/format.mjs'
import { intArg } from '../lib/util.mjs'

export async function run({ values, positionals }) {
  const sub = positionals[0] ?? 'list'

  if (sub === 'stats') {
    const stats = paperStats()
    if (values.json) {
      process.stdout.write(JSON.stringify({ ok: true, ...stats }, null, 2) + '\n')
      return 0
    }
    console.log(`# 文献库\n`)
    console.log(`共 ${stats.papers} 篇 · 有笔记 ${stats.notes} 篇 · 未读 ${stats.unread} · 在读 ${stats.reading} · 已读 ${stats.read}`)
    console.log(`证据类型：${Object.entries(stats.byEvidence ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ') || '无'}`)
    console.log(`撤稿 ${stats.retracted ?? 0} · 预印本 ${stats.preprints ?? 0}`)
    console.log(`最近入库：${stats.lastSaved ?? '无'}`)
    return 0
  }

  if (sub === 'week') {
    const papers = recentNotes(7)
    const ideas = listIdeas({ limit: 20 })
    const lines = [
      `# 本周阅读（最近 7 天）`,
      '',
      `共 ${papers.length} 篇有笔记的论文。`,
      '',
    ]
    for (const p of papers) {
      lines.push(`## ${p.title}`)
      lines.push('')
      lines.push(`- 状态：${p.status} · 评分：${p.rating || '未评'} · 发表：${p.venue || '未知'} ${p.year ?? ''}`)
      lines.push(`- 一句话：${p.oneLine || '（还没有写）'}`)
      lines.push(`- 笔记：${p.notePath}`)
      lines.push(`- 标识：${p.doi ? `DOI ${p.doi}` : p.arxivId ? `arXiv ${p.arxivId}` : p.key}`)
      lines.push('')
    }
    if (ideas.length) {
      lines.push('## 最近的想法', '')
      for (const i of ideas) lines.push(`- ${String(i.at).slice(0, 10)}：${i.text}${i.from ? `（来自 ${i.from}）` : ''}`)
    }
    const text = lines.join('\n') + '\n'
    if (values.json) {
      process.stdout.write(JSON.stringify({ ok: true, papers, ideas, markdown: text }, null, 2) + '\n')
      return 0
    }
    process.stdout.write(text)
    return 0
  }

  // list（默认）
  let papers = listPapers()
  if (values.status) papers = papers.filter((p) => p.status === values.status)
  if (values.tag) {
    const tags = String(values.tag).split(',').map((x) => x.trim()).filter(Boolean)
    papers = papers.filter((p) => tags.every((t) => p.tags?.includes(t)))
  }
  const limit = intArg(values.limit, 40, 1, 200)
  if (values.json) {
    process.stdout.write(JSON.stringify({ ok: true, count: papers.length, papers: papers.slice(0, limit) }, null, 2) + '\n')
    return 0
  }
  console.log(`# 文献库（${papers.length} 篇${values.status ? ` · ${values.status}` : ''}）\n`)
  if (!papers.length) {
    console.log('还没有入库的论文。先 `search` 或 `brief`，再 `read --id ...`。')
    return 0
  }
  console.log(libraryTable(papers, { limit }))
  if (papers.length > limit) console.log(`\n（只显示前 ${limit} 条；用 --limit 调整）`)
  return 0
}
