/** Methods 草稿校验和期刊结构提示。只做静态检查，不替代方法学审稿。 */
export function validateMethods(text) {
  const s = String(text ?? '')
  const placeholders = (s.match(/未记录|未识别|未检查|未核对|未指定/g) ?? []).length
  const warnings = []
  if (!/##\s*Study design/i.test(s)) warnings.push('缺少 Study design')
  if (!/##\s*Data/i.test(s)) warnings.push('缺少 Data')
  if (!/##\s*Methods/i.test(s)) warnings.push('缺少 Methods')
  if (!/##\s*Limitations/i.test(s)) warnings.push('缺少 Limitations')
  if (!/\b(?:GSE|PRJ[ A-Z]{2}|PXD|EGA|dbGaP|phs)\d+/i.test(s)) warnings.push('未识别到数据 accession')
  if (!/https?:\/\/(?:github|gitlab|zenodo)/i.test(s)) warnings.push('未识别到代码仓库')
  if (!/\b(?:GRCh3[78]|hg19|hg38|GRCm3[89]|mm10|mm39|参考基因组|reference)/i.test(s)) warnings.push('未记录参考基因组/数据库版本')
  if (placeholders) warnings.push(`${placeholders} 个占位符需要人工填写`)
  const confidence = !warnings.length ? 'medium' : warnings.length <= 2 ? 'low' : 'none'
  return { confidence, placeholders, warnings, note: '静态检查；样本量、统计模型、随机化和伦理必须人工核对。' }
}

export function journalFormat(text, format = 'generic') {
  const f = String(format || 'generic').toLowerCase()
  if (f === 'generic') return text
  const maps = {
    nature: { '## Study design': '## Study design', '## Data': '## Data and materials', '## Methods': '## Experimental procedures', '## Code and reproducibility': '## Code availability', '## Limitations': '## Limitations' },
    jama: { '## Study design': '## Study design, setting, and participants', '## Data': '## Data sources', '## Methods': '## Statistical analysis', '## Limitations': '## Limitations' },
    bmj: { '## Study design': '## Study design', '## Data': '## Data sources', '## Methods': '## Statistical methods', '## Limitations': '## Limitations' },
  }
  if (!maps[f]) throw new Error(`未知 Methods 格式：${format}。可用 generic/nature/jama/bmj`)
  let out = text.replace(`# Methods draft —`, `# Methods draft (${f}) —`)
  out = `> 目标格式：${f}。这是结构提示，不保证满足期刊字数、顺序或报告规范。\n\n${out}`
  for (const [from, to] of Object.entries(maps[f])) out = out.split(from).join(to)
  return out
}
