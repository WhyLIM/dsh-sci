/**
 * 给人看的 Markdown。所有输出都保留 DOI/arXiv/PMID，方便 agent 和用户回查。
 */
import { clip, formatAuthors, typeLabel, isEditorialLike } from './normalize.mjs'
import { paperKey } from './config.mjs'

export function idLine(p) {
  const ids = []
  if (p.doi) ids.push(`DOI: ${p.doi}`)
  if (p.arxivId) ids.push(`arXiv: ${p.arxivId}`)
  if (p.pmid) ids.push(`PMID: ${p.pmid}`)
  if (p.pmcid) ids.push(`PMCID: ${p.pmcid}`)
  return ids.join(' · ')
}

export function linksLine(p) {
  const links = []
  if (p.doi) links.push(`[DOI](https://doi.org/${p.doi})`)
  if (p.arxivId) links.push(`[arXiv](https://arxiv.org/abs/${p.arxivId})`)
  if (p.pmid) links.push(`[PubMed](https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/)`)
  if (p.pmcid) links.push(`[PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/${p.pmcid}/)`)
  if (p.pdfUrl) links.push(`[${p.isOA ? 'OA PDF' : 'PDF'}](${p.pdfUrl})`)
  if (!links.length && p.url) links.push(`[链接](${p.url})`)
  return links.join(' · ')
}

export function paperCard(p, { rank, score, signals, abstractChars = 700 } = {}) {
  const head = `${rank ? `### ${rank}. ` : '### '}${p.title || '未命名文献'}`
  const meta = [
    formatAuthors(p.authors, 5),
    p.venue || '',
    p.year ? String(p.year) : '',
    typeLabel(p.evidenceType ?? p.type),
  ].filter(Boolean).join(' · ')
  const flags = [
    p.isOA ? '开放获取' : (p.hasFullText ? '有全文（非 OA）' : '非 OA（只读摘要）'),
    p.retracted ? '⚠ 已撤稿' : '',
    p.concern ? '⚠ 关注声明' : '',
    p.isPreprint ? '预印本（未同行评审）' : '',
    isEditorialLike(p) ? '社论/评论类' : '',
    p.citations ? `引用 ${p.citations}` : '',
    score != null ? `初筛 ${score}` : '',
  ].filter(Boolean).join(' · ')
  const why = signals?.keywords?.length ? `命中：${signals.keywords.join(' / ')}` : ''
  const lines = [
    head,
    '',
    meta,
    '',
    idLine(p),
    '',
    `key: \`${p.key ?? paperKey(p)}\``,
    '',
    flags + (why ? ` · ${why}` : ''),
    '',
    ...(p.retracted ? ['> ⚠️ **这篇论文有撤稿/关注声明。不要把它当作有效证据。**', ''] : []),
    ...(p.concern && !p.retracted ? ['> ⚠️ **这篇论文有 Expression of Concern。引用前先核对。**', ''] : []),
    ...(p.isPreprint ? ['> 预印本，未经同行评审；临床问题中不能作为疗效证据。', ''] : []),
    p.abstract ? clip(p.abstract, abstractChars) : '（无摘要）',
    '',
    linksLine(p),
    '',
  ]
  return lines.join('\n')
}

export function briefMarkdown({ date, field, cfg, result, extra = '' }) {
  const lines = [
    `# 科研简报 · ${date}`,
    '',
    `**方向**：${field || cfg.researcher.field}`,
    result.topics?.length ? `**课题范围**：${result.topics.join(' · ')}` : '',
    `**本轮**：${result.queries.join(' / ')} · 近 ${result.days} 天 · 扫描 ${result.scanned} 条，过滤后 ${result.afterFilter} 条，取前 ${result.candidates.length} 条`,
    result.prisma ? `**PRISMA 计数**：识别 ${result.prisma.identified} · 去重 ${result.prisma.duplicates} · 初筛 ${result.prisma.screened} · 按类型排除 ${result.prisma.excludedByType} · 已见过 ${result.prisma.excludedBySeen} · 已筛除 ${result.prisma.excludedByScreening ?? 0} · 命中排除词 ${result.prisma.excludedByTerm} · 纳入 ${result.prisma.included}` : '',
    '',
  ]
  for (const r of result.reports) {
    const bits = r.sources.map((s) => `${s.source} ${s.count}${s.error ? '（失败）' : ''}`).join(' · ')
    lines.push(`- 查询「${r.query}」：${bits}`)
    const qs = r.sources.filter((s) => s.query).map((s) => `  - ${s.source}: \`${clip(s.query, 300)}\``)
    lines.push(...qs)
  }
  const failures = result.reports.flatMap((r) => r.sources.filter((s) => s.error))
  if (failures.length) {
    lines.push('', '> 有检索源失败。失败不等于“没有文献”，下面只是其余来源的结果。')
    for (const f of failures) lines.push(`> - ${f.source}: ${clip(f.error, 180)}${f.hint ? ` — ${f.hint}` : ''}`)
  }
  lines.push('', '## 候选（按初筛信号排序，不是最终判断）', '')
  if (!result.candidates.length) {
    lines.push('这一轮没有新的候选。可以放宽时间窗、增加关键词，或先去读未读队列。')
  } else {
    result.candidates.forEach((c, i) => {
      lines.push(paperCard(c.paper, { rank: i + 1, score: c.score, signals: c.signals }))
    })
  }
  if (extra) lines.push('', extra)
  lines.push('', '---', '', '> 初筛分数只看关键词命中、时效、引用、OA 和多源重合；它不能代替读摘要和全文。引用信息以工具返回的题录为准。')
  return lines.join('\n') + '\n'
}

export function readDossier({ paper, full, chunkIndex }) {
  const lines = [
    `# ${paper.title}`,
    '',
    `**作者**：${formatAuthors(paper.authors, 10)}`,
    `**发表**：${paper.venue || '未知'}${paper.year ? ` · ${paper.year}` : ''} · ${typeLabel(paper.evidenceType ?? paper.type)}`,
    `**标识**：${idLine(paper) || '（无 DOI/arXiv/PMID）'}`,
    `**链接**：${linksLine(paper) || '（无）'}`,
    `**开放获取**：${paper.isOA ? '是' : '否/未知'}${paper.hasFullText ? ' · 有全文/PMC' : ''}${paper.license ? ` · ${paper.license}` : ''} · 引用 ${paper.citations ?? 0}`,
    `**全文来源**：${full.source} · 共 ${full.chunks.length} 段 · ${full.sections.reduce((n, s) => n + s.text.length, 0).toLocaleString()} 字符${full.tables?.length ? ` · 表格 ${full.tables.length}` : ''}${full.figures?.length ? ` · 图 ${full.figures.length}` : ''}`,
    '',
  ]
  if (paper.retracted) {
    lines.push('> ⚠️ **撤稿/关注声明：这篇论文不应作为有效证据。** 请查看 corrections / 撤稿通知，并在笔记里明确标注。', '')
  }
  if (paper.concern && !paper.retracted) {
    lines.push('> ⚠️ **Expression of Concern：引用前核对。**', '')
  }
  if (paper.isPreprint) {
    lines.push('> 预印本：未经同行评审，不能作为临床疗效证据；只能作为“待验证线索”。', '')
  }
  if (paper.pubTypes?.length) {
    lines.push(`**研究类型**：${paper.pubTypes.slice(0, 8).join(' / ')}`)
  }
  if (paper.trialIds?.length) {
    lines.push(`**注册号**：${paper.trialIds.join(' · ')}`)
  }
  if (paper.funding) lines.push(`**资金**：${paper.funding}`)
  if (paper.coi) lines.push(`**利益冲突**：${paper.coi}`)
  if (paper.corrections?.length) lines.push(`**更正/撤稿关联**：${paper.corrections.map((c) => c.type || c.reference).filter(Boolean).join(' / ')}`)
  lines.push('')
  if (full.warnings.length) {
    lines.push('> 注意：')
    for (const w of full.warnings) lines.push(`> - ${w}`)
    lines.push('')
  }
  lines.push('## 读这一篇时，按顺序回答', '')
  lines.push(
    '1. **PICO / 研究问题**：人群、干预/暴露、对照、主要结局分别是什么？',
    '2. **设计**：RCT / 队列 / 病例对照 / 诊断 / 系统综述 / 基础？设计是否支持作者的回答？',
    '3. **偏倚风险**：随机化、盲法、失访、ITT、混杂调整、选择性报告，哪一项最可能推翻结论？',
    '4. **效应量**：RR/OR/HR/ARR/NNT 是多少？95% CI 和绝对风险变化是什么？',
    '5. **局限与外推**：作者承认的局限 + 你看到的额外威胁；结论能外推到谁？',
    '6. **与我的研究**：可借用 / 需改造 / 相冲突 / 引出什么新问题？',
    '',
    '> 只写你在下面文本里真正读到的内容。没有读到的，写“未读到”，不要补全。',
    '> 写作：规范、非专业人士也能看懂；关键概念第一次出现时解释；**严禁使用比喻/类比**。',
    '',
    ...(full.tables?.length ? [`> 本篇有 ${full.tables.length} 个表格：用 \`read --tables\` 看主要结局。`] : []),
    ...(full.figures?.length ? [`> 本篇有 ${full.figures.length} 个图：用 \`read --figures\` 下载后 read_image。`] : []),
    '',
  )
  const start = Math.max(0, Math.min(chunkIndex, full.chunks.length - 1))
  lines.push(`## 全文 · 第 ${start + 1}/${full.chunks.length} 段`, '')
  lines.push(full.chunks[start] ?? '（空）')
  lines.push('')
  if (full.chunks.length > 1) {
    lines.push('---', '', `继续读：\`read --id ${paper.key} --chunk ${start + 2}\`（下一段）`, '')
  }
  return lines.join('\n')
}

export function libraryTable(papers, { limit = 40 } = {}) {
  const rows = papers.slice(0, limit).map((p) => {
    const status = p.status === 'read' ? '✓ 已读' : p.status === 'reading' ? '◐ 在读' : p.status === 'skimmed' ? '◔ 略读' : '○ 未读'
    const rating = p.rating ? `${'★'.repeat(p.rating)}${'☆'.repeat(5 - p.rating)}` : ''
    return `| ${status} | ${p.year ?? ''} | ${typeLabel(p.evidenceType ?? p.type)} | ${clip(p.title, 64)} | ${clip(p.venue, 24)} | ${rating} | \`${p.key}\` |`
  })
  return [
    '| 状态 | 年 | 类型 | 标题 | 发表 | 评分 | key |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n')
}
