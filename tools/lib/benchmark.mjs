/**
 * 从已缓存的 JATS/HTML 表格中抽取 benchmark 行。
 * 只做结构化提示；单位、数据集划分、指标方向必须人工核对。
 */
import path from 'node:path'
import { PATHS, loadPaper, paperKey, readJson } from './config.mjs'
import { resolvePaper } from './paper.mjs'

const METRIC = /\b(accuracy|acc|auc|auroc|f1|precision|recall|sensitivity|specificity|mcc|r2|r²|mae|rmse|spearman|pearson|top[- ]?1|top[- ]?5|ndcg|map|bleu|rouge)\b/i
const DATASET = /\b(dataset|data set|benchmark|corpus|cohort|test set|task)\b/i
const METHOD = /\b(method|model|tool|approach|pipeline|baseline|ours|this study)\b/i

function parseMarkdown(md) {
  const lines = String(md ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'))
  if (lines.length < 2) return null
  const cells = (l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((x) => x.trim())
  const head = cells(lines[0])
  const rows = lines.slice(1).filter((l) => !/^\|?\s*:?-{2,}/.test(l)).map(cells).filter((r) => r.length === head.length)
  return { head, rows }
}

export function extractBenchmark(tables, { paper = null } = {}) {
  const out = []
  for (const t of tables ?? []) {
    const p = parseMarkdown(t.markdown)
    if (!p) continue
    const metricIdx = p.head.map((h, i) => METRIC.test(h) ? i : -1).filter((i) => i >= 0)
    if (!metricIdx.length) continue
    const dsIdx = p.head.findIndex((h) => DATASET.test(h))
    const methodIdx = p.head.findIndex((h) => METHOD.test(h))
    out.push({
      label: t.label ?? '',
      caption: t.caption ?? '',
      columns: p.head,
      metricColumns: metricIdx.map((i) => p.head[i]),
      datasetColumn: dsIdx >= 0 ? p.head[dsIdx] : '',
      methodColumn: methodIdx >= 0 ? p.head[methodIdx] : '',
      rows: p.rows.slice(0, 200).map((r) => {
        const row = {}
        p.head.forEach((h, i) => { row[h] = r[i] })
        return row
      }),
      warnings: [
        '指标方向/单位/数据集划分未自动核对。',
        ...(t.caption ? [] : ['表格没有 caption；无法确认表意。']),
      ],
    })
  }
  return { ok: true, paper: paper ? { key: paper.key ?? paperKey(paper), title: paper.title } : null, tables: out, note: '从已解析表格抽取，可能遗漏图/补充材料中的 benchmark。' }
}

export function cachedTables(paper) {
  const key = paper.key ?? paperKey(paper)
  const meta = readJson(path.join(PATHS.fulltext, `${key}.json`), null)
  return meta?.tables ?? []
}

export async function loadPaperTables(input) {
  const paper = loadPaper(input) ?? await resolvePaper(input)
  if (!paper) throw new Error(`本地没有题录：${input}。先 read --id ${input} --tables。`)
  const tables = cachedTables(paper)
  if (!tables.length) throw new Error('没有缓存表格；先 read --tables 或 read --id ... --tables。')
  return { paper, tables }
}
