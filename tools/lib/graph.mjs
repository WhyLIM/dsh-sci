/**
 * 本地证据图：paper ↔ dataset ↔ gene/tool ↔ topic。
 * 只从本地题录/笔记/frontmatter 抽取；不把自动识别当成事实。
 */
import fs from 'node:fs'
import path from 'node:path'
import { PATHS, readJson, atomicWrite } from './config.mjs'
import { listPapers, readNote, parseFrontmatter } from './library.mjs'
import { readTopics } from './topics.mjs'

export const GRAPH_FILE = path.join(PATHS.home, 'graph.json')

function addNode(nodes, id, type, label, meta = {}) {
  if (!nodes.has(id)) nodes.set(id, { id, type, label: label || id, meta })
  else if (label && nodes.get(id).label === id) nodes.get(id).label = label
  return nodes.get(id)
}
function addEdge(edges, from, to, type, evidence = '') {
  if (!from || !to || from === to) return
  const k = `${from}|${to}|${type}`
  if (!edges.has(k)) edges.set(k, { from, to, type, evidence })
}
function accessions(text) {
  const out = []
  for (const re of [/\bGSE\d{3,}\b/gi, /\bPXD\d{5,}\b/gi, /\bPRJ[NAEDB]\d{4,}\b/gi, /\bE-MTAB-\d{3,}\b/gi, /\bphs\d{6,}\b/gi, /\bEGA[SD]\d{5,}\b/gi]) {
    for (const m of String(text ?? '').match(re) ?? []) out.push(m.toUpperCase())
  }
  return [...new Set(out)]
}
function codeUrls(text) {
  return [...new Set(String(text ?? '').match(/https?:\/\/(?:www\.)?(?:github\.com|gitlab\.com|zenodo\.org)\/[\w./-]+/gi) ?? [])]
}

export function buildGraph() {
  const nodes = new Map()
  const edges = new Map()
  for (const t of readTopics()) {
    const id = `topic:${t.id}`
    addNode(nodes, id, 'topic', t.title, { status: t.status, keywords: t.keywords ?? [] })
  }
  for (const p of listPapers()) {
    const pid = `paper:${p.key}`
    addNode(nodes, pid, 'paper', p.title, { year: p.year, venue: p.venue, doi: p.doi, pmid: p.pmid, retracted: p.retracted })
    for (const e of p.grounding?.entities ?? []) {
      if (e.status !== 'verified') continue
      const id = `${e.type}:${e.query}`
      addNode(nodes, id, e.type, e.query, { databases: (e.annotations ?? []).map((a) => a.db) })
      addEdge(edges, pid, id, 'grounded_entity', 'database annotation')
    }
    const note = readNote(p.key)
    const meta = note ? parseFrontmatter(note.text).data : {}
    const text = `${p.title ?? ''}\n${p.abstract ?? ''}\n${note?.text ?? ''}`
    for (const acc of accessions(`${meta.dataAvailability ?? ''}\n${text}`)) {
      const db = /^GSE/.test(acc) ? 'geo' : /^PXD/.test(acc) ? 'pride' : /^PRJ/.test(acc) ? 'sra' : /^E-MTAB/.test(acc) ? 'ena' : 'controlled'
      const id = `dataset:${acc}`
      addNode(nodes, id, 'dataset', acc, { db })
      addEdge(edges, pid, id, 'uses_dataset', p.key)
    }
    for (const url of codeUrls(`${meta.codeAvailability ?? ''}\n${text}`)) {
      const id = `code:${url.replace(/^https?:\/\//, '').replace(/[).,;]+$/, '')}`
      addNode(nodes, id, 'code', url, { host: new URL(url).host })
      addEdge(edges, pid, id, 'uses_code', p.key)
    }
    for (const tag of (meta.tags ?? [])) {
      const id = `keyword:${String(tag).toLowerCase()}`
      addNode(nodes, id, 'keyword', String(tag), {})
      addEdge(edges, pid, id, 'tagged', p.key)
    }
    if (p.retracted) {
      const id = 'flag:retracted'
      addNode(nodes, id, 'flag', 'Retracted', {})
      addEdge(edges, pid, id, 'has_flag', '')
    }
  }
  const graph = { version: 1, builtAt: new Date().toISOString(), nodes: [...nodes.values()], edges: [...edges.values()] }
  atomicWrite(GRAPH_FILE, JSON.stringify(graph, null, 2) + '\n')
  return graph
}

export function loadGraph() {
  return readJson(GRAPH_FILE, { version: 1, builtAt: null, nodes: [], edges: [] })
}

export function queryGraph(term, limit = 30) {
  const q = String(term ?? '').toLowerCase()
  const g = loadGraph()
  const nodes = g.nodes.filter((n) => `${n.id} ${n.label} ${JSON.stringify(n.meta ?? {})}`.toLowerCase().includes(q)).slice(0, limit)
  const ids = new Set(nodes.map((n) => n.id))
  const edges = g.edges.filter((e) => ids.has(e.from) || ids.has(e.to)).slice(0, limit * 4)
  return { nodes, edges, builtAt: g.builtAt }
}

export function graphMarkdown(r) {
  const lines = [`# 证据图 · ${r.nodes.length} nodes`, '', `构建：${r.builtAt ?? '尚未构建'}`, '' ]
  for (const n of r.nodes) lines.push(`- **${n.type}** \`${n.id}\` — ${n.label}`)
  if (r.edges.length) {
    lines.push('', '## 边')
    for (const e of r.edges) lines.push(`- ${e.from} —[${e.type}]→ ${e.to}`)
  }
  return lines.join('\n')
}
