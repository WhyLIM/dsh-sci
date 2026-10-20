/**
 * 数据/代码可用性与可复现性静态检查。
 *
 * 只从文本抽取线索；不把「data available on request」当成可复现数据，
 * 也不把 GitHub 链接当成可运行代码。输出是待核对的证据，不是评分真理。
 */
const ACCESSIONS = [
  ['geo', /\bGSE\d{3,}\b/gi], ['geo', /\bGDS\d{3,}\b/gi], ['geo', /\bGPL\d{3,}\b/gi],
  ['sra', /\bPRJ[NAEDB]\d{4,}\b/gi], ['sra', /\bSR[RXSPZ]\d{5,}\b/gi],
  ['ena', /\bERR\d{5,}\b/gi], ['ena', /\bDRR\d{5,}\b/gi], ['ena', /\bE-MTAB-\d{3,}\b/gi],
  ['pride', /\bPXD\d{5,}\b/gi], ['dbgap', /\bphs\d{6,}\b/gi], ['ega', /\bEGA[SD]\d{5,}\b/gi],
  ['zenodo', /\b10\.5281\/zenodo\.\d+\b/gi], ['bioproject', /\bPRJ[NAEDB]\d{4,}\b/gi],
]
const CODE_HOSTS = /https?:\/\/(?:www\.)?(github\.com|gitlab\.com|bitbucket\.org|codeberg\.org)\/[\w.-]+\/[\w.-]+/gi
const CONTROLLED = /\b(dbGaP|EGA|controlled[- ]access|data use agreement|DUA|IRB|ethics approval|informed consent)\b/gi
const ON_REQUEST = /\b(data|code|materials?)\s+(?:are\s+)?(?:available\s+)?(?:upon|on)\s+request\b/gi
const NO_CODE = /\b(no (?:custom )?(?:code|software)|code is not available|software is not available|not publicly available)\b/gi

function uniq(xs) { return [...new Set(xs.filter(Boolean))] }

export function extractRepro(text, paper = {}) {
  const s = String(text ?? '')
  const accessions = []
  const byDb = {}
  for (const [db, re] of ACCESSIONS) {
    for (const m of s.match(re) ?? []) {
      const id = m.toUpperCase()
      if (!byDb[db]) byDb[db] = []
      if (!byDb[db].includes(id)) byDb[db].push(id)
      accessions.push({ db, id })
    }
  }
  const codeUrls = uniq((s.match(CODE_HOSTS) ?? []).map((u) => u.replace(/[).,;]+$/, '')))
  const controlled = uniq(s.match(CONTROLLED) ?? [])
  const onRequest = uniq(s.match(ON_REQUEST) ?? [])
  const noCode = uniq(s.match(NO_CODE) ?? [])
  const warnings = []
  if (!accessions.length) warnings.push('没有在正文中识别到数据 accession；如果数据在补充材料或独立仓库，请人工核对。')
  if (!codeUrls.length) warnings.push('没有识别到公开代码仓库；这不等于没有代码，可能只在补充材料。')
  if (onRequest.length) warnings.push('数据/代码声明为“available on request”；可复现性依赖作者响应，不能当作公开数据。')
  if (noCode.length) warnings.push('文本明确表示代码/软件不可公开获取。')
  if (controlled.length) warnings.push(`涉及受控/伦理数据（${controlled.slice(0, 4).join(', ')}）；不得尝试绕过授权下载。`)
  let score = 0
  if (accessions.length) score += 40
  if (codeUrls.length) score += 30
  if (!onRequest.length) score += 10
  if (!noCode.length) score += 10
  if (!controlled.length) score += 10
  return {
    accessions,
    byDb,
    codeUrls,
    controlled,
    onRequest,
    noCode,
    score: Math.max(0, Math.min(100, score)),
    level: score >= 70 ? 'high' : score >= 40 ? 'partial' : 'low',
    warnings,
    checkedAt: new Date().toISOString(),
    note: '静态抽取，不等于代码可运行或数据可下载；需人工核对版本、license、受控权限。',
    paper: paper?.key ? { key: paper.key, title: paper.title ?? '' } : undefined,
  }
}

export function reproMarkdown(r) {
  const lines = [
    '## 数据与代码可用性',
    '',
    `- 可复现性线索：**${r.level}**（${r.score}/100，静态检查）`,
    `- 数据 accession：${r.accessions.length ? r.accessions.map((x) => `${x.db}:${x.id}`).join(' · ') : '未识别'}`,
    `- 代码仓库：${r.codeUrls.length ? r.codeUrls.join(' · ') : '未识别'}`,
    `- 受控/伦理数据：${r.controlled.length ? r.controlled.join(' · ') : '未识别'}`,
    '',
  ]
  if (r.warnings.length) {
    lines.push('### 需要核对')
    for (const w of r.warnings) lines.push(`- ${w}`)
  }
  lines.push('', `> ${r.note}`)
  return lines.join('\n')
}
