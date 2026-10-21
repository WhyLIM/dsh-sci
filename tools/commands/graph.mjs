import fs from 'node:fs'
import path from 'node:path'
import { buildGraph, loadGraph, queryGraph, graphMarkdown, graphHtml, GRAPH_FILE } from '../lib/graph.mjs'

export async function run({ values, positionals }) {
  const sub = positionals[0] ?? 'stats'
  if (sub === 'build' || sub === 'rebuild') {
    const g = buildGraph()
    if (values.json) process.stdout.write(JSON.stringify({ ok: true, file: GRAPH_FILE, nodes: g.nodes.length, edges: g.edges.length }, null, 2) + '\n')
    else console.log(`已构建：${GRAPH_FILE}\n节点 ${g.nodes.length} · 边 ${g.edges.length}`)
    return 0
  }
  if (sub === 'html') {
    const g = loadGraph()
    const out = path.resolve(values.out ?? path.join(path.dirname(GRAPH_FILE), 'graph.html'))
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, graphHtml(g))
    if (values.json) process.stdout.write(JSON.stringify({ ok: true, file: out, nodes: g.nodes.length, edges: g.edges.length }, null, 2) + '\n')
    else console.log(`已生成：${out}\n节点 ${g.nodes.length} · 边 ${g.edges.length}`)
    return 0
  }
  if (sub === 'stats') {
    const g = loadGraph()
    const byType = {}
    for (const n of g.nodes) byType[n.type] = (byType[n.type] ?? 0) + 1
    if (values.json) process.stdout.write(JSON.stringify({ ok: true, ...g, byType }, null, 2) + '\n')
    else console.log(`图：${g.nodes.length} 节点 · ${g.edges.length} 边 · 构建 ${g.builtAt ?? '—'}\n${Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(' · ')}`)
    return 0
  }
  if (sub === 'query' || sub === 'find') {
    const term = values.query ?? positionals.slice(1).join(' ')
    if (!term) throw new Error('用法：graph query <term>')
    const r = queryGraph(term, values.limit ? Number(values.limit) : 30)
    if (values.json) process.stdout.write(JSON.stringify({ ok: true, query: term, ...r }, null, 2) + '\n')
    else console.log(graphMarkdown(r))
    return 0
  }
  throw new Error(`未知 graph 子命令：${sub}。可用：build/stats/query/html`)
}
