/** 筛选日志：给“这篇为什么纳入/排除”留痕，方便复现和写 PRISMA。 */
import fs from 'node:fs'
import { PATHS, ensureDataDirs, paperKey } from './config.mjs'
import { readJson } from './config.mjs'

export function appendScreening({ paper, decision, reason = '', stage = 'abstract' }) {
  ensureDataDirs()
  const row = {
    at: new Date().toISOString(),
    key: paper.key ?? paperKey(paper),
    title: paper.title ?? '',
    doi: paper.doi ?? '',
    pmid: paper.pmid ?? '',
    decision,
    stage,
    reason: String(reason ?? '').slice(0, 500),
  }
  fs.appendFileSync(PATHS.screening, JSON.stringify(row) + '\n')
  return row
}

export function listScreening() {
  try {
    return fs.readFileSync(PATHS.screening, 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)
  } catch { return [] }
}

export function latestScreening() {
  const map = new Map()
  for (const row of listScreening()) map.set(row.key, row)
  return map
}

export function excludedKeys() {
  const set = new Set()
  for (const [key, row] of latestScreening()) if (row.decision === 'exclude') set.add(key)
  return set
}
