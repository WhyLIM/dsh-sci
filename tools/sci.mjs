#!/usr/bin/env node
/**
 * dsh-sci 的唯一 CLI 入口。
 *
 * 设计原则：所有外部检索/全文/文件读写都从这里走，agent 不自己写爬虫；
 * 所有输出都尽量是 Markdown（人可读）或 --json（agent 可解析）。
 */
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { ensureDataDirs } from './lib/config.mjs'
import { ensureProtocol } from './lib/protocol.mjs'

const HERE = fileURLToPath(import.meta.url)

const OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
  json: { type: 'boolean' },
  'no-cache': { type: 'boolean' },
  refresh: { type: 'boolean' },
  query: { type: 'string' },
  days: { type: 'string' },
  limit: { type: 'string' },
  page: { type: 'string' },
  all: { type: 'boolean' },
  source: { type: 'string' },
  'oa-only': { type: 'boolean' },
  'no-oa': { type: 'boolean' },
  preprints: { type: 'boolean' },
  'no-preprints': { type: 'boolean' },
  id: { type: 'string' },
  path: { type: 'string' },
  repo: { type: 'string' },
  keywords: { type: 'string' },
  doi: { type: 'string' },
  arxiv: { type: 'string' },
  pmid: { type: 'string' },
  pmcid: { type: 'string' },
  mid: { type: 'string' },
  openalex: { type: 'string' },
  save: { type: 'boolean' },
  pdf: { type: 'string' },
  chunk: { type: 'string' },
  chars: { type: 'string' },
  outline: { type: 'boolean' },
  supplementary: { type: 'boolean' },
  'with-note': { type: 'boolean' },
  'no-download': { type: 'boolean' },
  refs: { type: 'boolean' },
  status: { type: 'string' },
  db: { type: 'string' },
  entity: { type: 'string' },
  type: { type: 'string' },
  domain: { type: 'string' },
  species: { type: 'string' },
  build: { type: 'string' },
  dataset: { type: 'string' },
  action: { type: 'string' },
  score: { type: 'string' },
  cutoff: { type: 'string' },
  catalog: { type: 'string' },
  rating: { type: 'string' },
  tags: { type: 'string' },
  tag: { type: 'string' },
  force: { type: 'boolean' },
  max: { type: 'string' },
  'include-seen': { type: 'boolean' },
  'no-topic': { type: 'boolean' },
  text: { type: 'string' },
  file: { type: 'string' },
  genes: { type: 'string' },
  diseases: { type: 'string' },
  drugs: { type: 'string' },
  enrich: { type: 'boolean' },
  'no-enrich': { type: 'boolean' },
  kind: { type: 'string' },
  direction: { type: 'string' },
  format: { type: 'string' },
  out: { type: 'string' },
  author: { type: 'string' },
  'first-author': { type: 'string' },
  'last-author': { type: 'string' },
  affiliation: { type: 'string' },
  journal: { type: 'string' },
  language: { type: 'string' },
  pt: { type: 'string' },
  title: { type: 'string' },
  mesh: { type: 'string' },
  grant: { type: 'string' },
  coi: { type: 'string' },
  from: { type: 'string' },
  to: { type: 'string' },
  'date-field': { type: 'string' },
  filter: { type: 'string' },
  validate: { type: 'boolean' },
  all: { type: 'boolean' },
  decision: { type: 'string' },
  reason: { type: 'string' },
  stage: { type: 'string' },
  template: { type: 'string' },
  section: { type: 'string' },
  grep: { type: 'string' },
  tables: { type: 'boolean' },
  figures: { type: 'boolean' },
  'max-figures': { type: 'string' },
  rob: { type: 'string' },
  grade: { type: 'string' },
  design: { type: 'string' },
  effect: { type: 'string' },
  trial: { type: 'string' },
  editorials: { type: 'boolean' },
  guidelines: { type: 'boolean' },
  'no-guidelines': { type: 'boolean' },
  'title-abs': { type: 'boolean' },
  'no-title-abs': { type: 'boolean' },
  synonym: { type: 'boolean' },
  'no-synonym': { type: 'boolean' },
  list: { type: 'boolean' },
  execute: { type: 'boolean' },
  cores: { type: 'string' },
  profile: { type: 'string' },
  timeout: { type: 'string' },
  'log-dir': { type: 'string' },
  yes: { type: 'boolean' },
  'max-bytes': { type: 'string' },
}

function help() {
  console.log(`dsh-sci · 生物医学文献检索与阅读

用法：node sci.mjs <command> [options]

命令：
  deps                          体检（Node / 数据目录 / 检索源 / PDF 抽取）
  search --query "..."          多源检索（Europe PMC / PubMed / OpenAlex / Crossref / arXiv）
  paper --id doi:...            取一篇论文的题录、摘要和 OA 链接
  read --id doi:...             取全文并输出阅读包（分段）
  note new --id ...             建结构化笔记
  note set --id ...             改笔记状态/评分/标签
  note show|list|path ...       看笔记
  library list|stats|week       文献库、统计、本周阅读
  brief --save                  按研究方向生成今日候选简报
  related --id ...               引文追踪（被引 / 参考文献）
  trials --query "..."           ClinicalTrials.gov 试验检索
  guidelines --query "..."       指南/共识检索（Europe PMC + PubMed）
  pubmed-query --query "..."    构建/校验 PubMed 字段查询（--author/--journal/--pt/...）
  pubmed-fields                列出 PubMed 全部字段标签
  watch                         按 ISSN watchlist 看最近论文
  db list|info|search|get       生物信息数据库 lookup（UniProt/Ensembl/PDB/GEO/...）
  entity resolve|query|accession|batch 生物实体规范化 / accession / 批量
  dataset search|get|files|download GEO/SRA/ENA/PRIDE/HCA 聚合 / 文件 / 下载
  omics inspect                 VCF/BED/FASTA/FASTQ/GTF/10x/BAM/CRAM/HDF5 检查
  repro --id|--file            数据/代码可用性抽取
  qc --id|--file|--text        统计/ML 静态风险提示
  workflow inspect|validate|run  本地 Nextflow/Snakemake/WDL 检查与执行
  graph build|query|stats|html 本地证据图
  entity batch --file ids.txt  批量实体规范化
  benchmark --id               从缓存表格抽 benchmark
  methods validate|draft --id  Methods 校验 / 草稿（generic/nature/jama/bmj）
  compliance --id|--file       受控数据合规检查
  topic add --path <dir|file>   引入本地研究课题（或 --repo GitHub URL）
  topic list|show|set|refresh   管理研究课题
  export --all --format ris     导出 RIS / BibTeX / CSL-JSON / CSV
  screen --id ... --decision ... 记录纳入/排除及理由
  idea add "..."                记一条研究想法
  log tail                      看事件流

常用参数：
  --days 14           时间窗（默认取配置）
  --limit 10          每个源取多少
  --page 2            数据库搜索翻页（ChEBI / DailyMed）
  --all               数据库搜索取完所有页（仅 ChEBI / DailyMed）
  --execute           工作流实际执行（需再给 --yes）
  --yes               确认下载或执行
  --max-bytes <n>     单文件最大字节数（默认 2GB）
  --cores 4           工作流 CPU 数
  --profile <name>    Nextflow profile
  --timeout 600       工作流超时秒数
  --source europepmc,pubmed,openalex
  --oa-only           发现阶段只要开放获取（默认按配置；阅读阶段始终 OA）
  --no-cache          绕过本地缓存
  --json              机器可读输出
  --chunk 1           读全文的第几段
  --outline           只看全文结构，不输出正文
  --section methods   只读某一章节（methods/results/...）
  --grep "primary"    在全文里找关键词
  --tables            输出结构化表格
  --figures           下载/列出图片（再用 read_image 看）
  --template rct      指定笔记模板（auto/rct/observational/diagnostic/review/preclinical/guideline）
  --refs              把 References 也放进分段（默认省略）
  --with-note         读完顺便建笔记
  --save              把论文/简报写入本地

示例：
  node sci.mjs deps
  node sci.mjs search --query "protein language model" --days 30 --limit 8
  node sci.mjs read --id arxiv:1706.03762 --outline
  node sci.mjs read --id arxiv:1706.03762 --chunk 1 --with-note
  node sci.mjs brief --save
  node sci.mjs library stats

数据默认在 ~/.dsh/sci；配置在 ~/.dsh/sci.config.json。
`)
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: OPTIONS,
    allowPositionals: true,
    strict: false,
  })
  if (values.version) {
    console.log('dsh-sci 0.9.6')
    return 0
  }
  const cmd = positionals[0]
  if (!cmd || values.help || cmd === 'help') {
    help()
    return 0
  }
  ensureDataDirs()
  try { ensureProtocol(HERE) } catch (e) {
    // 从别的 workspace 手动跑时可能没有 ~/.dsh/sci 的写权限；读命令仍然应该能跑。
    if (process.env.DSH_SCI_DEBUG) console.error(`[dsh-sci] 写 TOOLING.md 失败：${e.message}`)
  }

  const table = {
    deps: './commands/deps.mjs',
    search: './commands/search.mjs',
    paper: './commands/paper.mjs',
    read: './commands/read.mjs',
    note: './commands/note.mjs',
    library: './commands/library.mjs',
    lib: './commands/library.mjs',
    brief: './commands/brief.mjs',
    feed: './commands/brief.mjs',
    idea: './commands/idea.mjs',
    log: './commands/log.mjs',
    related: './commands/related.mjs',
    citations: './commands/related.mjs',
    export: './commands/export.mjs',
    screen: './commands/screen.mjs',
    trials: './commands/trials.mjs',
    trial: './commands/trials.mjs',
    guidelines: './commands/guidelines.mjs',
    'pubmed-query': './commands/pubmed-query.mjs',
    'pubmed-fields': './commands/pubmed-fields.mjs',
    watch: './commands/watch.mjs',
    db: './commands/db.mjs',
    entity: './commands/entity.mjs',
    accession: './commands/accession.mjs',
    omics: './commands/omics.mjs',
    qc: './commands/qc.mjs',
    repro: './commands/repro.mjs',
    graph: './commands/graph.mjs',
    enrich: './commands/enrich.mjs',
    ground: './commands/enrich.mjs',
    benchmark: './commands/benchmark.mjs',
    methods: './commands/methods.mjs',
    compliance: './commands/compliance.mjs',
    dataset: './commands/datasets.mjs',
    datasets: './commands/datasets.mjs',
    database: './commands/db.mjs',
    topics: './commands/topics.mjs',
    workflow: './commands/workflow.mjs',
    topic: './commands/topics.mjs',
  }
  const file = table[cmd]
  if (!file) {
    console.error(`未知命令：${cmd}\n`)
    help()
    return 2
  }
  const mod = await import(file)
  const code = await mod.run({ values, positionals: positionals.slice(1), command: cmd })
  return Number.isInteger(code) ? code : 0
}

main().then((code) => {
  process.exitCode = code
}).catch((e) => {
  console.error(`错误：${e?.message ?? e}`)
  if (process.env.DSH_SCI_DEBUG) console.error(e?.stack ?? '')
  process.exitCode = 1
})
