/**
 * 本地文献库与笔记。所有状态都是普通文件，agent 可以直接读、直接改。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  PATHS, outputPaths, ensureDataDirs, readJson, writeJson, paperKey, readState, writeState, atomicWrite,
} from './config.mjs'

const NOTE_STATUS = ['unread', 'queued', 'reading', 'read', 'skimmed', 'archived']

export function parseFrontmatter(md) {
  const s = String(md ?? '')
  if (!s.startsWith('---')) return { data: {}, body: s }
  const end = s.indexOf('\n---', 3)
  if (end < 0) return { data: {}, body: s }
  const head = s.slice(3, end).trim()
  const body = s.slice(end + 4).replace(/^\s*\n/, '')
  const data = {}
  for (const line of head.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!m) continue
    const [, k, raw] = m
    let v = raw.trim()
    if (v === '') { data[k] = ''; continue }
    if (/^\[.*\]$/.test(v)) {
      try { v = JSON.parse(v.replace(/'/g, '"')) } catch { v = v.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean) }
    } else if (/^".*"$/.test(v) || /^'.*'$/.test(v)) {
      try { v = JSON.parse(v) } catch { v = v.slice(1, -1) }
    } else if (/^(true|false)$/i.test(v)) v = v.toLowerCase() === 'true'
    else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v)
    else if (v === 'null') v = null
    data[k] = v
  }
  return { data, body }
}

function yamlValue(v) {
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return JSON.stringify(v)
  if (v == null) return 'null'
  return JSON.stringify(String(v))
}

export function formatFrontmatter(data) {
  const order = ['id', 'title', 'authors', 'year', 'venue', 'doi', 'arxivId', 'pmid', 'pmcid', 'url', 'evidenceType', 'design', 'status', 'rating', 'rob', 'grade', 'effect', 'tags', 'trialIds', 'funding', 'coi', 'retracted', 'dataAvailability', 'codeAvailability', 'reproducibility', 'databaseAnnotations', 'created', 'updated']
  const keys = [...order.filter((k) => k in data), ...Object.keys(data).filter((k) => !order.includes(k))]
  return '---\n' + keys.map((k) => `${k}: ${yamlValue(data[k])}`).join('\n') + '\n---\n'
}

function notesDir() { return outputPaths().notes }
function noteCandidates(key) {
  return [path.join(notesDir(), `${key}.md`), path.join(PATHS.notes, `${key}.md`)]
}

export function readNote(keyOrPaper) {
  const key = typeof keyOrPaper === 'string' ? keyOrPaper.replace(/\.md$/, '') : (keyOrPaper.key ?? paperKey(keyOrPaper))
  for (const file of noteCandidates(key)) {
    try { return { key, file, text: fs.readFileSync(file, 'utf8') } } catch {}
  }
  return null
}

export function listPapers() {
  ensureDataDirs()
  const out = []
  let files = []
  try { files = fs.readdirSync(PATHS.papers).filter((f) => f.endsWith('.json')) } catch { return out }
  for (const f of files) {
    const p = readJson(path.join(PATHS.papers, f), null)
    if (!p) continue
    const key = p.key ?? f.replace(/\.json$/, '')
    const note = readNote(key)
    const meta = note ? parseFrontmatter(note.text).data : {}
    out.push({
      ...p,
      key,
      notePath: note?.file ?? '',
      hasNote: Boolean(note),
      status: NOTE_STATUS.includes(meta.status) ? meta.status : 'unread',
      rating: Number(meta.rating ?? 0) || 0,
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      noteUpdated: meta.updated ?? '',
      oneLine: extractOneLine(note?.text ?? ''),
    })
  }
  return out.sort((a, b) => String(b.savedAt ?? '').localeCompare(String(a.savedAt ?? '')))
}

function extractOneLine(md) {
  const m = String(md).match(/##\s*一句话\s*\n+([^\n#][^\n]*)/)
  return m ? m[1].trim() : ''
}

export function paperStats() {
  const papers = listPapers()
  const by = { unread: 0, queued: 0, reading: 0, read: 0, skimmed: 0, archived: 0 }
  const byEvidence = {}
  for (const p of papers) {
    by[p.status] = (by[p.status] ?? 0) + 1
    byEvidence[p.evidenceType ?? 'article'] = (byEvidence[p.evidenceType ?? 'article'] ?? 0) + 1
  }
  return {
    papers: papers.length,
    notes: papers.filter((p) => p.hasNote).length,
    unread: by.unread + by.queued,
    reading: by.reading,
    read: by.read,
    byStatus: by,
    byEvidence,
    retracted: papers.filter((p) => p.retracted).length,
    preprints: papers.filter((p) => p.isPreprint).length,
    lastSaved: papers[0]?.savedAt ?? null,
  }
}

export function savePaperRecord(paper) {
  ensureDataDirs()
  const key = paper.key ?? paperKey(paper)
  const file = path.join(PATHS.papers, `${key}.json`)
  const old = readJson(file, null)
  const record = {
    ...old,
    ...paper,
    key,
    savedAt: old?.savedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  writeJson(file, record)
  return record
}

export function autoTemplate(paper) {
  const ev = paper?.evidenceType
  if (['rct', 'clinical-trial'].includes(ev)) return 'rct'
  if (['cohort', 'case-control'].includes(ev)) return 'observational'
  if (ev === 'diagnostic') return 'diagnostic'
  if (['systematic-review', 'meta-analysis', 'review'].includes(ev)) return 'review'
  if (ev === 'preclinical') return 'preclinical'
  if (ev === 'guideline') return 'guideline'
  const text = `${paper?.title ?? ''} ${paper?.abstract ?? ''} ${paper?.venue ?? ''}`.toLowerCase()
  if (/single[- ]cell|scrna|single cell/.test(text)) return 'singlecell'
  if (/metagenom|microbiome|16s|shotgun/.test(text)) return 'metagenomics'
  if (/proteom|mass spectrometry|phosphoproteom/.test(text)) return 'proteomics'
  if (/gwas|genome[- ]wide association|fine[- ]mapping/.test(text)) return 'gwas'
  if (/benchmark|benchmarking|evaluation of (methods|tools)|head[- ]to[- ]head/.test(text)) return 'benchmark'
  if (/dataset|data resource|atlas|database/.test(text)) return 'dataset'
  if (/we (present|introduce|develop)|software|pipeline|workflow|toolkit|framework|package/.test(text)) return 'tool'
  if (/machine learning|deep learning|neural network|classifier|foundation model/.test(text)) return 'ml'
  return 'general'
}

function templateBlock(template) {
  if (template === 'rct') return `## 设计与偏倚风险（RoB 2）

- 随机化序列生成 / 分配隐藏：
- 盲法：参与者 / 实施者 / 结局评估者：
- 失访与退出（各组人数、原因）：
- 分析人群：ITT / mITT / PP？是否预注册？
- 主要结局与样本量计算是否一致：
- 选择性报告（注册 vs 发表）：
- **RoB 2 总体判断**：低 / 有些担忧 / 高；理由：

## 效应量

- 主要结局：干预组 vs 对照组（事件数/均值）：
- 效应量：RR / OR / HR / ARR / NNT =（95% CI）：
- 绝对风险变化：
- 次要结局 / 不良事件：
- 亚组 / 交互作用：
`
  if (template === 'observational') return `## 设计与偏倚风险（ROBINS-I）

- 研究设计：前瞻/回顾队列、病例对照、横断面：
- 暴露定义 / 结局定义 / 随访时间：
- 失访比例与处理：
- 混杂因素与调整策略（模型、协变量）：
- 选择偏倚 / 信息偏倚 / 测量偏倚：
- 时间相关偏倚 / 反向因果：
- **ROBINS-I 总体判断**：低 / 中等 / 严重 / 极严重；理由：

## 效应量

- 暴露组 vs 对照组（事件数/人年/均值）：
- 未调整 / 调整后效应量（RR/OR/HR，95% CI）：
- 剂量-反应 / 亚组：
- 绝对风险 / 人群归因分数（如适用）：
`
  if (template === 'diagnostic') return `## 设计与偏倚风险（QUADAS-2）

- 患者选择（连续/随机/病例对照？）：
- 索引试验（index test）与阈值是否预设：
- 参考标准（reference standard）：
- 检查流程与时间间隔：
- 敏感度 / 特异度 / PPV / NPV / LR+ / LR-：
- **QUADAS-2 总体判断**：低 / 有些担忧 / 高；理由：

## 效应量

- 2×2 表（TP/FP/FN/TN）：
- 敏感度（95% CI）/ 特异度（95% CI）：
- 阳性/阴性似然比：
- 适用人群与患病率对 PPV 的影响：
`
  if (template === 'review') return `## 综述方法与偏倚风险（AMSTAR 2 / PRISMA）

- 检索数据库、时间范围、检索策略是否可复现：
- 纳入/排除标准：
- 筛选与数据提取是否双人独立：
- 偏倚风险评估工具：
- 合并方法 / 异质性（I²、τ²）/ 亚组 / 敏感性分析：
- 发表偏倚（漏斗图/Egger）：
- **AMSTAR 2 总体置信度**：高 / 中 / 低 / 极低；理由：

## 证据确定性（GRADE）

- 主要结局的确定性：高 / 中 / 低 / 极低
- 降级理由：偏倚风险 / 不一致 / 间接性 / 不精确 / 发表偏倚
`
  if (template === 'preclinical') return `## 设计与偏倚风险（ARRIVE）

- 模型系统（物种、品系、细胞系、器官oid）：
- 样本量 / 功效计算：
- 随机化 / 盲法 / 对照：
- 纳入/排除标准、 humane endpoints：
- 重复实验 / 独立复制：
- 细胞系鉴定 / 支原体检测 / 抗体验证：
- **可重复性判断**：高 / 中 / 低；理由：

## 效应量

- 主要终点（均值 ± SD / SEM，n）：
- 效应量 / 置信区间：
- 剂量反应 / 时间进程：
`
  if (template === 'dataset') return `## 数据集档案

- 数据类型 / 物种 / 样本量：
- 采集平台 / 测序平台 / 试剂：
- 原始数据 accession（GEO/SRA/ENA/PRIDE 等）：
- 处理后数据 / 矩阵 / 元数据：
- 伦理/受控访问（dbGaP/EGA/IRB/consent）：
- 数据 license 与复用限制：
- 批次 / 站点 / 时间跨度：
- 适合回答的问题与不适合回答的问题：

## 数据质量与偏倚

- 缺失值 / 异常值 / 污染：
- 样本代表性：
- 元数据完整性：
- 版本 / 参考基因组 / 注释版本：

## 可复现性

- 下载与预处理流程：
- 代码 / 容器 / 版本：
`
  if (template === 'tool') return `## 工具档案

- 解决的问题 / 输入 / 输出：
- 方法核心（一句话 + 关键步骤）：
- 依赖 / 运行环境 / 版本：
- 安装方式 / 许可：
- 数据集 / 基准 / 对照：
- 评价指标与主结果：
- 运行时间 / 内存 / 可扩展性：
- 失败模式 / 输入限制：

## 代码与可复现性

- 代码仓库 / commit / release：
- 容器 / 环境文件：
- 测试 / 示例数据：
- 是否有独立复现：

## 与我的工作流的关系

- 可直接替换的步骤：
- 需要改造的接口：
- 需要验证的假设：
`
  if (template === 'benchmark') return `## Benchmark 设计

- 任务 / 数据集 / 划分（train/val/test）：
- 基线 / 对照方法：
- 评价指标（主指标 + 次要指标）：
- 统计检验 / 置信区间 / 多次重复：
- 数据泄漏检查（预处理、特征选择、调参是否只在训练集）：
- 外部验证 / 跨数据集 / 跨物种：
- 计算资源与超参数搜索：

## 结果与公平性

- 主结果（均值 ± 标准差 / 95% CI）：
- 是否超过基线？差异是否具有实际意义：
- 失败案例 / 消融：
- 可复现性（代码 / 数据 / 版本）：

## 结论边界

- 能推广到哪些数据/物种/平台：
- 不能推广到哪些场景：
`
  if (template === 'gwas') return `## GWAS 设计

- 表型定义 / 样本量 / 病例对照比例：
- 基因型平台 / 插补 / QC（MAF、HWE、缺失率）：
- 群体分层校正（PCA / 混合模型）：
- 关联模型 / 协变量：
- 多重检验阈值（5e-8 / FDR）：
- 独立信号 / fine-mapping / 共定位：
- 外部验证队列：

## 结果

- 主效 SNP / locus / effect allele / OR-beta（95% CI）/ P：
- 等位基因频率 / 样本量：
- 是否经过独立验证：
- 功能注释 / eQTL / 通路：

## 偏倚与限制

- 人群代表性：
- Winner's curse / 发表偏倚：
- 表型异质性：
`
  if (template === 'rnaseq') return `## RNA-seq 设计与流程

- 物种 / 组织 / 处理 / 生物学重复：
- 建库 / 测序平台 / 读长 / 深度：
- 参考基因组 / 注释版本：
- 比对 / 定量工具与版本：
- 归一化方法 / 批次校正：
- 差异分析模型 / 协变量 / FDR：
- 独立验证（qPCR / 外部队列）：

## 结果

- 主差异基因 / 通路 / 效应量：
- 倍数变化与置信区间：
- 是否被独立数据支持：

## 可复现性

- 原始数据 accession：
- 代码 / 参数 / 环境：
`
  if (template === 'singlecell') return `## 单细胞设计

- 物种 / 组织 / 条件 / 供体数：
- 平台（10x 等）/ 文库 / 目标细胞数：
- 质控：低质量细胞、doublets、ambient RNA、线粒体比例：
- 归一化 / 降维 / 聚类 / 注释：
- 批次整合 / 供体效应：
- 差异表达 / 富集 / 轨迹：
- 独立验证（蛋白 / 组织学 / 外部数据）：

## 结果与风险

- 主要细胞群 / marker / 比例变化：
- 注释是否只靠 marker？是否有参考映射：
- 伪重复 / 供体作为随机效应：
- 可复现性（代码 / 数据 / 版本）：
`
  if (template === 'metagenomics') return `## 宏基因组/微生物组设计

- 样本来源 / 队列 / 时间点：
- 测序策略（16S / 宏基因组 / 宏转录组）：
- DNA 提取 / 建库 / 平台：
- 质控 / 去宿主 / 拼接 / 分箱：
- 分类数据库 / 版本 / 丰度归一化：
- 多样性 / 差异丰度 / 混杂因素：
- 污染 / 低复杂度 / 阴性对照：

## 结果与限制

- 主要 taxa / 功能通路 / 效应量：
- 是否只是相关？有无因果/干预验证：
- 可复现性（accession / 代码 / 数据库版本）：
`
  if (template === 'proteomics') return `## 蛋白质组设计

- 样本 / 物种 / 处理 / 重复：
- 质谱平台 / 采集模式 / 标记方法：
- 数据库 / 搜索引擎 / FDR：
- 缺失值 / 归一化 / 批次：
- 差异蛋白 / 修饰 / 通路：
- 独立验证（WB / PRM / 外部数据）：

## 结果与限制

- 主要蛋白 / 修饰 / 效应量：
- 鉴定深度与假阳性控制：
- 可复现性（PRIDE accession / 代码 / 版本）：
`
  if (template === 'ml') return `## 机器学习设计

- 任务定义 / 输入 / 输出 / 标签来源：
- 数据划分（train/val/test；是否按样本/患者/物种分组）：
- 特征工程 / 预训练 / 数据泄漏检查：
- 模型 / 基线 / 超参数搜索：
- 评价指标（主指标 + 校准 + 置信区间）：
- 外部验证 / 跨队列 / 跨平台：
- 类别不平衡 / 缺失值 / 分布偏移：

## 结果与风险

- 主结果与基线差异：
- 校准 / 决策曲线 / 亚组：
- 失败模式 / 可解释性：
- 代码 / 模型权重 / 数据 accession：
`
  if (template === 'guideline') return `## 指南背景

- 制定机构 / 年份 / 版本：
- 适用人群与场景：
- 证据分级与推荐强度体系（GRADE/SIGN/ACC-AHA 等）：
- 关键推荐（原文 + 强度）：
- 与当前临床实践的差异：
- 是否需要本地适用性评估（资源、可及性、患者偏好）：
`
  return `## 方法与数据

- 研究设计 / 核心方法：
- 数据 / 样本 / 实验设置：
- 基线 / 对照：
- 评价指标：
- 有没有开源代码 / 数据：

## 偏倚与局限

- 作者自己承认的局限：
- 我认为还存在的方法/数据/推断问题：
- 结论是否超出了证据：
`
}

export function noteScaffold(paper, template = 'auto', topics = []) {
  const id = paper.doi ? `doi:${paper.doi}` : (paper.arxivId ? `arxiv:${paper.arxivId}` : (paper.pmid ? `pmid:${paper.pmid}` : (paper.pmcid ? `pmcid:${paper.pmcid}` : paper.key)))
  const now = new Date().toISOString()
  const authors = (paper.authors ?? []).map((a) => a.name).filter(Boolean).join(', ')
  const design = template === 'auto' ? autoTemplate(paper) : template
  const fm = formatFrontmatter({
    id,
    title: paper.title ?? '',
    authors: authors.slice(0, 2000),
    year: paper.year ?? null,
    venue: paper.venue ?? '',
    doi: paper.doi ?? '',
    arxivId: paper.arxivId ?? '',
    pmid: paper.pmid ?? '',
    pmcid: paper.pmcid ?? '',
    url: paper.url ?? '',
    evidenceType: paper.evidenceType ?? '',
    design,
    status: 'reading',
    rating: 0,
    rob: '',
    grade: '',
    effect: '',
    tags: [],
    trialIds: paper.trialIds ?? [],
    funding: paper.funding ?? '',
    coi: paper.coi ?? '',
    retracted: Boolean(paper.retracted),
    dataAvailability: (paper.repro?.accessions ?? []).map((x) => `${x.db}:${x.id}`).join(', '),
    codeAvailability: (paper.repro?.codeUrls ?? []).join(', '),
    reproducibility: paper.repro ? `${paper.repro.level}/${paper.repro.score}` : '',
    databaseAnnotations: (paper.grounding?.entities ?? []).filter((e) => e.status === 'verified').map((e) => `${e.type}:${e.query}`).join(', '),
    created: now,
    updated: now,
  })
  const links = [
    paper.doi ? `DOI: https://doi.org/${paper.doi}` : '',
    paper.arxivId ? `arXiv: https://arxiv.org/abs/${paper.arxivId}` : '',
    paper.pmid ? `PubMed: https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/` : '',
    paper.pmcid ? `PMC: https://www.ncbi.nlm.nih.gov/pmc/articles/${paper.pmcid}/` : '',
    paper.pdfUrl ? `OA PDF: ${paper.pdfUrl}` : '',
  ].filter(Boolean).join(' · ')
  const repro = paper.repro ?? null
  const grounding = paper.grounding ?? null
  const groundingLines = (grounding?.entities ?? []).length
    ? grounding.entities.map((e) => e.status === 'verified'
      ? `- ✅ **${e.type} \`${e.query}\`**：${e.annotations.map((a) => `${a.db} ${JSON.stringify(a.fields).slice(0, 260)}`).join(' · ')}`
      : `- ⚠️ **${e.type} \`${e.query}\`**：未在权威库精确解析，不能当作已核对事实。`).join('\n')
    : '- 未运行数据库核对（或没有解析到实体）。'
  const topicBlocks = (topics ?? []).map((t) => `## 对课题「${t.title}」的启示

- 这篇论文能回答/支持课题的哪个问题：
- 可以直接借用的方法/数据：
- 需要改造才能用：
- 与本课题冲突或未覆盖的地方：

### 可结合章节

- 可写进：背景 / 方法 / 结果解释 / 讨论 / 实验设计
- 下一步验证：
`).join('\n')
  const warnings = [
    paper.retracted ? '> ⚠️ **撤稿/关注声明：这篇论文不应作为有效证据。** 在引用前核对撤稿通知。' : '',
    paper.concern && !paper.retracted ? '> ⚠️ **Expression of Concern：引用前核对。**' : '',
    paper.isPreprint ? '> 预印本：未经同行评审，不能作为临床疗效证据。' : '',
    paper.corrections?.length ? `> 更正/撤稿关联：${paper.corrections.map((c) => c.type || c.reference).filter(Boolean).join(' / ')}` : '',
  ].filter(Boolean).join('\n\n')
  return `${fm}
# ${paper.title ?? '未命名文献'}

> 写作要求：用规范、非专业人士也能看懂的语言；关键概念第一次出现时用一句话解释；**严禁使用比喻/类比**（不要写“就像/好比/仿佛”）。

${warnings ? warnings + '\n\n' : ''}${authors ? `**作者**：${authors}\n` : ''}${paper.venue ? `**发表**：${paper.venue}` : ''}${paper.year ? ` · ${paper.year}` : ''}${links ? `\n**链接**：${links}` : ''}

**证据类型**：${paper.evidenceType ?? '未分类'}${paper.pubTypes?.length ? `（${paper.pubTypes.join(' / ')}）` : ''}

## 读前：我为什么点开它

（一句话：是标题、摘要、方法，还是和最近的问题有关？）

## 一句话

（用一句不带形容词的话说清：这篇论文做了什么？）

## PICO / 研究问题

- 人群（P）：
- 干预/暴露（I/E）：
- 对照（C）：
- 主要结局（O）：
- 研究问题类型：治疗 / 诊断 / 预后 / 病因 / 定性 / 基础

## 数据库核对（自动）

（只使用工具返回的 ID/字段；未列出的基因/变异/坐标不要写成数据库事实。）

${groundingLines}

- 物种 / 基因组版本：${grounding ? `${grounding.species || '未指定'} / ${grounding.build || '未指定'}` : ''}

## 问题与缺口

- 它试图回答的问题：
- 它认为现有工作缺什么：
- 这个问题为什么重要（对谁重要）：

${templateBlock(design)}
## 关键证据

（只写你在摘要/全文/表格/图中真正读到的数字。没有读到的写“未读到”。）

- 主要结局：
- 效应量（95% CI）：
- 次要结局 / 不良事件：
- 与基线/对照的差异：

## 数据与代码可用性

- 数据 accession：${repro ? (repro.accessions ?? []).map((x) => `${x.db}:${x.id}`).join(', ') || '未识别' : ''}
- 代码仓库 / 版本：${repro ? (repro.codeUrls ?? []).join(', ') || '未识别' : ''}
- 受控/伦理数据（dbGaP/EGA/IRB/consent）：${repro ? (repro.controlled ?? []).join(', ') || '未识别' : ''}
- 可复现性检查（静态）：${repro ? `${repro.level}（${repro.score}/100）` : ''}
- 不能复现的原因：

## 局限与外推

- 作者承认的局限：
- 我看到的额外威胁（选择/信息/混杂/测量/报告）：
- 结论是否超出了证据：
- 能外推到谁？不能外推到谁？
- 可复现性 / 数据共享：

## 与我的研究的关系

- 可以直接借用：
- 需要改造才能用：
- 和我的结论冲突的地方：
- 它引出了什么新问题：

${topicBlocks}
## 三个可跟进的问题

1.
2.
3.

## 下一步

- [ ] 读相关工作的哪一篇：
- [ ] 复现哪个分析 / 试验：
- [ ] 写进哪段综述 / 指南 / 提案：

<details>
<summary>摘要原文（工具返回，未经改写）</summary>

${paper.abstract ? paper.abstract : '（这条题录没有摘要。不要根据标题推断结论。）'}

</details>
`
}
export function writeNote(paper, content) {
  ensureDataDirs()
  const key = paper.key ?? paperKey(paper)
  const file = path.join(notesDir(), `${key}.md`)
  atomicWrite(file, content)
  // 入库：即使论文元数据还没保存，也先保存一份，保证 note 能反查。
  savePaperRecord(paper)
  return file
}

export function createNote(paper, { force = false, template = 'auto', topics = [] } = {}) {
  const key = paper.key ?? paperKey(paper)
  const file = path.join(notesDir(), `${key}.md`)
  if (fs.existsSync(file) && !force) return { file, created: false }
  if (!force) {
    const old = noteCandidates(key)[1]
    if (old !== file && fs.existsSync(old)) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.copyFileSync(old, file)
      return { file, created: false, migrated: true }
    }
  }
  const content = noteScaffold(paper, template, topics)
  fs.mkdirSync(notesDir(), { recursive: true })
  atomicWrite(file, content)
  savePaperRecord(paper)
  return { file, created: true }
}

export function updateNoteMeta(paper, patch) {
  const key = paper.key ?? paperKey(paper)
  const file = path.join(notesDir(), `${key}.md`)
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch {
    const old = noteCandidates(key)[1]
    try { text = fs.readFileSync(old, 'utf8') } catch { text = noteScaffold(paper, 'auto', []) }
  }
  const { data, body } = parseFrontmatter(text)
  const next = { ...data, ...patch, updated: new Date().toISOString() }
  if (next.status && !NOTE_STATUS.includes(next.status)) throw new Error(`status 只能是：${NOTE_STATUS.join(' / ')}`)
  if (next.rating != null) next.rating = Math.max(0, Math.min(5, Number(next.rating) || 0))
  if (Array.isArray(next.tags)) next.tags = [...new Set(next.tags.map((x) => String(x).trim()).filter(Boolean))].slice(0, 20)
  const out = formatFrontmatter(next) + '\n' + body.replace(/^\n+/, '')
  atomicWrite(file, out)
  savePaperRecord(paper)
  return { file, meta: next }
}

/* ── ideas ──────────────────────────────────────────────────────────────── */

export function appendIdea(text, { from = '', tags = [] } = {}) {
  ensureDataDirs()
  const row = { at: new Date().toISOString(), text: String(text).trim(), from: String(from ?? ''), tags }
  if (!row.text) throw new Error('idea 不能为空')
  const ideasFile = outputPaths().ideas
  fs.mkdirSync(path.dirname(ideasFile), { recursive: true })
  fs.appendFileSync(ideasFile, JSON.stringify(row) + '\n')
  return row
}

export function listIdeas({ limit = 50 } = {}) {
  const files = [...new Set([outputPaths().ideas, PATHS.ideas])]
  const rows = []
  for (const file of files) {
    try {
      for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
        try { rows.push(JSON.parse(line)) } catch {}
      }
    } catch {}
  }
  return [...new Map(rows.map((r) => [`${r.at}|${r.text}`, r])).values()]
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .slice(-limit)
    .reverse()
}

/* ── briefs ─────────────────────────────────────────────────────────────── */

export function briefFile(date = new Date().toLocaleDateString('sv-SE')) {
  return path.join(outputPaths().briefs, `${date}.md`)
}

export function saveBrief(text, date) {
  ensureDataDirs()
  const file = briefFile(date)
  atomicWrite(file, text)
  writeState({ lastBriefAt: new Date().toISOString(), lastBriefFile: file })
  return file
}

export function latestBrief() {
  try {
    let dir = outputPaths().briefs
    let files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
    if (!files.length && dir !== PATHS.briefs) {
      dir = PATHS.briefs
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
    }
    if (!files.length) return null
    const file = path.join(dir, files.at(-1))
    return { file, date: files.at(-1).replace(/\.md$/, ''), text: fs.readFileSync(file, 'utf8') }
  } catch {
    return null
  }
}

/* ── weekly ─────────────────────────────────────────────────────────────── */

export function reviewFile(date = new Date()) {
  const d = new Date(date)
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  const iso = d.toLocaleDateString('sv-SE')
  return path.join(outputPaths().reviews, `${iso}-week.md`)
}

export function recentNotes(days = 7) {
  const cutoff = Date.now() - days * 86_400_000
  return listPapers().filter((p) => p.hasNote && new Date(p.noteUpdated || p.savedAt || 0).getTime() >= cutoff)
}
