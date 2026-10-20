/**
 * 统计/ML 论文的静态质量检查。
 * 只提示“文本里出现了可疑模式”，不替代统计审查，也不推断作者没写的内容。
 */
const CHECKS = [
  { code: 'p-threshold', level: 'warn', re: /\bp\s*[<=]\s*0\.05\b/i, need: /(FDR|false discovery|Benjamini|Bonferroni|multiple[-\s]?test|adjusted p)/i, msg: '出现 p≤0.05，但文本未提多重检验校正；确认是主终点还是多重比较。' },
  { code: 'trend', level: 'warn', re: /\btrend\s+(towards?|toward)\s+significan|borderline significan/i, msg: '“trend/borderline significant”不是预设的统计结论；不要当作显著。' },
  { code: 'no-ci', level: 'info', re: /\b(accuracy|AUC|AUROC|sensitivity|specificity|F1|R2|correlation)\b/i, need: /\b(95%\s*CI|confidence interval|bootstrap)\b/i, msg: '报告了性能指标但未见 95% CI/置信区间；检查不确定性。' },
  { code: 'leakage-split', level: 'high', re: /\b(random(ly)? split|train[-\s]?test split|hold[-\s]?out)\b/i, need: /\b(group(ed)? split|by patient|by donor|by species|temporal split|external (test|validation))\b/i, msg: '随机划分但未说明按患者/供体/物种/时间分组；可能有数据泄漏。' },
  { code: 'leakage-preprocess', level: 'high', re: /\b(feature selection|normaliz|imput|batch correction|hyperparameter|tuning)\b/i, need: /\b(within (the )?training|training (only|set)|nested cross[-\s]?validation|independent test)\b/i, msg: '预处理/特征选择/调参可能在全数据上做；确认只在训练集内拟合。' },
  { code: 'no-external', level: 'info', re: /\b(machine learning|deep learning|classifier|prediction model|AUC)\b/i, need: /\b(external (validation|cohort|test)|independent (validation|cohort|dataset))\b/i, msg: '未见外部验证；内部交叉验证不能证明泛化。' },
  { code: 'class-imbalance', level: 'info', re: /\b(class imbalance|imbalanced)\b/i, msg: '提到类别不平衡；检查是否使用 PR-AUC/召回率/重采样，而不是只看 accuracy。' },
  { code: 'pseudoreplication', level: 'high', re: /\b(technical replicates?|multiple measurements|cells from one (donor|patient))\b/i, need: /\b(mixed[-\s]?effects?|random effect|donor|patient|biological replicate)\b/i, msg: '技术重复/同一供体多细胞可能被当作独立样本（伪重复）；确认随机效应/聚类。' },
  { code: 'batch', level: 'info', re: /\b(batch effect|batch correction|ComBat|harmony)\b/i, msg: '涉及批次；确认批次与生物学条件是否混杂。' },
  { code: 'survival', level: 'info', re: /\b(overall survival|progression[-\s]?free|hazard ratio|Kaplan[-\s]?Meier)\b/i, need: /\b(median follow[-\s]?up|censoring|proportional hazards)\b/i, msg: '生存分析；确认随访时间、删失和 PH 假设。' },
  { code: 'overclaim', level: 'warn', re: /\b(first|novel|unprecedented|state[-\s]?of[-\s]?the[-\s]?art|outperform)\b/i, need: /\b(compared? (with|to)|baseline|benchmark)\b/i, msg: '出现“first/novel/outperform”类表述但未见明确对照/benchmark；检查证据。' },
  { code: 'no-effect-size', level: 'info', re: /\b(significant(ly)?|difference)\b/i, need: /\b(effect size|odds ratio|hazard ratio|beta|Cohen|mean difference|fold change)\b/i, msg: '报告了显著性但未必有效应量；显著性不等于实际意义。' },
]

export function qcText(text, { kind = '' } = {}) {
  const s = String(text ?? '')
  const findings = []
  for (const c of CHECKS) {
    if (!c.re.test(s)) continue
    if (c.need && c.need.test(s)) continue
    findings.push({ level: c.level, code: c.code, message: c.msg, kind })
  }
  return {
    ok: true,
    chars: s.length,
    findings,
    summary: findings.length ? `${findings.filter((f) => f.level === 'high').length} high / ${findings.filter((f) => f.level === 'warn').length} warn / ${findings.filter((f) => f.level === 'info').length} info` : '未发现明显的静态风险模式',
    note: '静态规则只提示文本模式；不能代替统计/领域审查。',
  }
}

export function qcMarkdown(r) {
  const lines = ['## 统计 / ML 风险提示', '', `- 静态检查：${r.summary}`]
  for (const f of r.findings) lines.push(`- **${f.level}** \`${f.code}\`：${f.message}`)
  lines.push('', `> ${r.note}`)
  return lines.join('\n')
}
