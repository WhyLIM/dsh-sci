import { addTopic, readTopics, getTopic, projectText, refreshTopic, removeTopic, updateTopic, buildManifest } from '../lib/topics.mjs'

export async function run({ values, positionals }) {
  const sub = positionals[0] ?? 'list'
  if (sub === 'add') {
    const keywords = values.keywords ? String(values.keywords).split(',').map((x) => x.trim()).filter(Boolean) : []
    const entry = await addTopic({ path: values.path, repo: values.repo, title: values.title, keywords })
    if (values.json) { process.stdout.write(JSON.stringify({ ok: true, topic: entry }, null, 2) + '\n'); return 0 }
    console.log(`已引入课题：${entry.title}`)
    console.log(`目录：${entry.project}`)
    console.log(`来源清单：${entry.inventory}`)
    console.log(`状态：${entry.status}（${entry.quality}）`)
    console.log('\n下一步：让 agent 阅读 inventory/原始材料，补全 PROJECT.md；完成后运行：')
    console.log(`  topic set --id ${entry.id} --status ready --keywords "kw1,kw2"`)
    return 0
  }
  if (sub === 'list' || sub === 'ls') {
    const topics = readTopics()
    if (values.json) { process.stdout.write(JSON.stringify({ ok: true, topics }, null, 2) + '\n'); return 0 }
    console.log(`# 研究课题（${topics.length}）\n`)
    for (const t of topics) console.log(`- ${t.status === 'ready' ? '✓' : '○'} **${t.title}** · ${t.kind} · ${t.quality ?? ''}\n  \`${t.id}\` · ${t.project}`)
    if (!topics.length) console.log('还没有课题。用 `topic add --path /path/to/project` 或 `--repo https://github.com/...`。')
    return 0
  }
  if (sub === 'pending') {
    const list = readTopics().filter((t) => t.status === 'needs-review')
    if (values.json) { process.stdout.write(JSON.stringify({ ok: true, topics: list }, null, 2) + '\n'); return 0 }
    for (const t of list) console.log(`- ${t.id} · ${t.title} · ${t.project}`)
    if (!list.length) console.log('没有待补全的课题。')
    return 0
  }
  const id = values.id ?? positionals[1]
  if (!id) throw new Error('需要 --id <topic-id>')
  const t = getTopic(id)
  if (!t) throw new Error(`课题不存在：${id}`)
  if (sub === 'show') {
    process.stdout.write(projectText(id) || '（PROJECT.md 尚未生成）\n')
    return 0
  }
  if (sub === 'manifest') {
    const r = buildManifest(id)
    if (values.json) { process.stdout.write(JSON.stringify({ ok: true, ...r }, null, 2) + '\n'); return 0 }
    console.log(`已生成：${r.file}`)
    return 0
  }
  if (sub === 'refresh') {
    const entry = await refreshTopic(id)
    if (values.json) { process.stdout.write(JSON.stringify({ ok: true, topic: entry }, null, 2) + '\n'); return 0 }
    console.log(`已刷新来源清单：${entry.inventory}`)
    return 0
  }
  if (sub === 'set') {
    const patch = {}
    if (values.status) patch.status = String(values.status)
    if (values.keywords != null) patch.keywords = String(values.keywords).split(',').map((x) => x.trim()).filter(Boolean)
    if (values.title) patch.title = String(values.title)
    const entry = updateTopic(id, patch)
    if (values.json) { process.stdout.write(JSON.stringify({ ok: true, topic: entry }, null, 2) + '\n'); return 0 }
    console.log(`已更新：${entry.title} · ${entry.status} · ${(entry.keywords ?? []).join(', ') || '无关键词'}`)
    return 0
  }
  if (sub === 'remove' || sub === 'rm') {
    removeTopic(id)
    console.log(`已移除课题：${id}`)
    return 0
  }
  throw new Error(`未知子命令：topic ${sub}。可用：add/list/pending/show/refresh/manifest/set/remove`)
}
