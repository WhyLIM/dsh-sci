import { appendLog } from '../lib/config.mjs'
import { resolvePaper } from '../lib/paper.mjs'
import { createNote, readNote, updateNoteMeta, listPapers } from '../lib/library.mjs'
import { loadPaper, readConfig } from '../lib/config.mjs'
import { selectedTopics } from '../lib/topics.mjs'

function inputOf(values, positionals, start = 1) {
  if (values.id) return String(values.id)
  if (values.doi) return `doi:${values.doi}`
  if (values.arxiv) return `arxiv:${values.arxiv}`
  if (values.pmid) return `pmid:${values.pmid}`
  if (values.pmcid) return `pmcid:${values.pmcid}`
  if (positionals.length > start) return positionals.slice(start).join(' ')
  return ''
}

async function getPaper(input) {
  if (!input) throw new Error('需要一个论文标识：--id doi:10.xxxx/xxxxx 或 --id <library key>')
  const local = loadPaper(input)
  if (local) return local
  return resolvePaper(input)
}

export async function run({ values, positionals }) {
  const sub = positionals[0] ?? 'list'
  if (sub === 'list') {
    const papers = listPapers().filter((p) => p.hasNote)
    const filtered = values.status ? papers.filter((p) => p.status === values.status) : papers
    if (values.json) {
      process.stdout.write(JSON.stringify({ ok: true, notes: filtered }, null, 2) + '\n')
      return 0
    }
    console.log(`# 笔记（${filtered.length} 篇）\n`)
    for (const p of filtered.slice(0, Number(values.limit ?? 40))) {
      console.log(`- ${p.status === 'read' ? '✓' : p.status === 'reading' ? '◐' : '○'} ${p.year ?? ''} ${p.title}`)
      console.log(`  \`${p.key}\` · ${p.notePath}`)
    }
    if (!filtered.length) console.log('还没有笔记。先 `read --note --id ...` 或 `note new --id ...`。')
    return 0
  }

  if (sub === 'path') {
    const paper = await getPaper(inputOf(values, positionals))
    const note = readNote(paper)
    if (!note) throw new Error('还没有这篇的笔记')
    console.log(note.file)
    return 0
  }

  if (sub === 'show') {
    const paper = await getPaper(inputOf(values, positionals))
    const note = readNote(paper)
    if (!note) throw new Error('还没有这篇的笔记；先 note new')
    process.stdout.write(note.text)
    return 0
  }

  if (sub === 'set') {
    const paper = await getPaper(inputOf(values, positionals))
    const patch = {}
    if (values.status) patch.status = String(values.status)
    if (values.rating != null) patch.rating = Number(values.rating)
    if (values.tags) patch.tags = String(values.tags).split(',').map((x) => x.trim()).filter(Boolean)
    if (values.rob) patch.rob = String(values.rob)
    if (values.grade) patch.grade = String(values.grade)
    if (values.design) patch.design = String(values.design)
    if (values.effect) patch.effect = String(values.effect)
    if (values.trial) patch.trialIds = String(values.trial).split(',').map((x) => x.trim()).filter(Boolean)
    if (!Object.keys(patch).length) throw new Error('至少给一个要改的字段：--status / --rating / --tags')
    const r = updateNoteMeta(paper, patch)
    appendLog('note-update', paper.title, { key: paper.key, patch })
    if (values.json) {
      process.stdout.write(JSON.stringify({ ok: true, ...r }, null, 2) + '\n')
      return 0
    }
    console.log(`已更新：${r.file}`)
    console.log(`状态 ${r.meta.status} · 评分 ${r.meta.rating} · 标签 ${(r.meta.tags ?? []).join(', ') || '无'}`)
    return 0
  }

  if (sub === 'new' || sub === 'scaffold') {
    const paper = await getPaper(inputOf(values, positionals))
    const r = createNote(paper, { force: Boolean(values.force), template: values.template || (readConfig().researcher.evidenceMode === 'computational' ? 'computational' : 'auto'), topics: selectedTopics(readConfig()) })
    appendLog('note-new', paper.title, { key: paper.key, created: r.created })
    if (values.json) {
      process.stdout.write(JSON.stringify({ ok: true, ...r, paper }, null, 2) + '\n')
      return 0
    }
    console.log(r.created ? `已创建笔记：${r.file}` : `笔记已存在，未覆盖：${r.file}`)
    console.log(`\n接下来：读全文（read --id ${paper.key} --tables / --section methods），再把「PICO / 设计 / 证据 / 偏倚风险 / 课题启示」填进去。`)
    return 0
  }

  throw new Error(`未知子命令：note ${sub}。可用：new / show / set / list / path`)
}
