# dsh-sci

[GitHub](https://github.com/WhyLIM/dsh-sci) · MIT

让 DSH 像一个训练有素的**生物医学博士生**那样做文献工作：按 PICO/研究方向扫新论文 → 看研究类型与撤稿状态 → 粗筛 → 读开放获取全文（含表格/图）→ 写带偏倚风险与效应量的笔记 → 每周总结。

它不是“论文摘要生成器”，也不是医生。工具链负责检索、全文、表格/图、笔记和作息；判断由 agent 在会话里完成，并受 [templates/AGENTS.md](templates/AGENTS.md) 的证据纪律约束。

---

## 1. 它到底做什么

| 能力 | 实现 |
|---|---|
| 生物医学检索 | **Europe PMC + PubMed** 为主，OpenAlex 补跨学科，Crossref 补 DOI，ClinicalTrials.gov 补注册信息 |
| 查询精度 | `TITLE_ABS` / `[tiab]` 字段限定、`synonym=true` 同义词扩展、`PUB_TYPE`/`[pt]` 研究类型过滤、PICO 查询、MeSH 词提示 |
| 发现 vs 阅读 | 发现阶段默认**允许非 OA**（只看摘要）；阅读阶段只取合法 OA/PMC 全文，不绕过付费墙 |
| 研究类型 | 指南/共识、系统综述、Meta 分析、RCT、队列、病例对照、诊断准确性、基础/临床前、综述、社论/评论；按证据层级排序 |
| 撤稿安全 | 解析 `Retracted Publication` / `Retraction in` / `Erratum in`；撤稿论文默认不进候选，`paper/read/note` 显著警告 |
| 预印本策略 | 临床模式默认排除 medRxiv/bioRxiv/arXiv 预印本；打开时必须标“未同行评审”，不能当疗效证据 |
| 读全文 | Europe PMC 全文 XML → 出版社/arXiv HTML → 合法 OA PDF；默认不把 References 塞进分段 |
| **表格/图** | JATS `<table-wrap>` 转 Markdown 表格；PMC/HTML 图片下载到 `library/figures/`，可用 `read_image` 看森林图、KM 曲线、流程图 |
| 章节阅读 | `read --section methods|results|...`、`--grep "primary endpoint"`、`--tables`、`--figures` |
| 笔记 | 按研究类型自动选模板：RCT（RoB 2）、队列（ROBINS-I）、诊断（QUADAS-2）、系统综述（AMSTAR 2/GRADE）、基础（ARRIVE）、指南；含 PICO、效应量 95% CI、资金/COI/注册号 |
| 数据库 lookup | `db list/info/search/get`：UniProt、Ensembl、NCBI Gene、PDB、AlphaFold、GEO、SRA、ENA、ClinVar、gnomAD、Reactome、KEGG、STRING、PubChem、ChEMBL、cBioPortal、GDC 等 50+ 目录，39 个可自动查询 |
| 引文追踪 | `related --id`：Europe PMC 被引 / 参考文献 |
| 期刊 watchlist | `watch` 按设置里的 ISSN 看最近论文（Europe PMC + PubMed） |
| 临床试验/指南 | `trials --query`：ClinicalTrials.gov API v2；`guidelines --query`：Europe PMC + PubMed 指南/共识；brief 可附带相关试验 |
| 可复现 | `brief --save` 同时写 `searches/*.json`（每个源的精确 query、过滤条件、PRISMA 计数） |
| 筛选 | `screen --id ... --decision include|exclude|maybe --reason ...`，brief 默认排除已 exclude 的论文 |
| 导出 | RIS / BibTeX / CSL-JSON / CSV，直接进 Zotero/EndNote 或做数据提取 |
| 研究课题 | 本地文件/文件夹或 GitHub 仓库引入；生成 inventory + PROJECT.md；agent 首次阅读后补全结构化描述；课题关键词自动进入检索 scope |
| 输出目录 | 笔记/简报/周总结/检索策略/导出可自定义目录；默认 `~/.dsh/sci` |
| 执行位置 | 设置里指定 DSH 工作区（Workspace）和执行会话；默认 `dsh-sci` + 数据目录 |
| 作息 | **自动模式**：在目标会话创建 DSH 原生 weekly 自动化任务；**手动模式**：不自动唤醒，点「扫描 / 深读 / 周总结」立即执行 |
| 设置页 | 「设置 → 科研」：PICO、关键词、ISSN watchlist、证据模式、每个检索源独立邮箱/API、研究课题、输出目录、执行会话/工作区、分段、图片、隐私、体检、手动触发 |

---

## 1.5 当前输出有什么

| 输出 | 默认位置 | 内容 |
|---|---|---|
| 笔记 | `~/.dsh/sci/notes/*.md` | 结构化论文笔记（PICO/RoB/效应量/GRADE/课题启示） |
| 简报 | `~/.dsh/sci/briefs/YYYY-MM-DD.md` | 每日候选、PRISMA 计数、每个源的精确 query、相关试验 |
| Methods 草稿 | `<输出目录>/methods/*.md` | `methods draft --save` 生成的结构化 Methods |
| 周总结 | `~/.dsh/sci/reviews/*-week.md` | 本周证据变化、下周计划（agent 写） |
| 检索策略 | `~/.dsh/sci/searches/*.json` | 查询、过滤条件、命中数、候选，可复现 |
| 导出 | 由 `export --out` 指定 | RIS / BibTeX / CSL-JSON / CSV |
| 课题 | `~/.dsh/sci/topics/<id>/` | `inventory.md`、`PROJECT.md`、克隆的仓库/源文件副本 |
| 文献库 | `~/.dsh/sci/library/` | 题录 JSON、全文缓存、PDF、图片 |
| 运行状态 | `~/.dsh/sci/state.json`、`schedule.json`、`log.jsonl`、`screening.jsonl` | 去重、作息、事件、筛选记录 |

**数据目录和输出目录是两件事**：

- **数据目录**：`~/.dsh/sci`。题录 `library/papers/`、全文缓存 `library/fulltext/`、PDF `library/pdfs/`、图片 `library/figures/`、`cache/`、`topics/`、`state.json`、`schedule.json`、`screening.jsonl`、`log.jsonl` 都在这里。
- **输出目录**：用户直接阅读/归档的文件。默认也是 `~/.dsh/sci`，但可以在设置里改到 Obsidian、项目文件夹或 DSH Workspace。

**自定义输出目录**：设置页「输出目录」留空 = 数据目录；填绝对路径或相对数据目录的路径后，`notes / briefs / reviews / searches / ideas.jsonl` 会写到该目录，文献库/缓存/图片/PDF/全文仍在数据目录。旧笔记仍可读取，`note new` 会迁移到新目录。

**为什么分开**：题录、全文缓存和图片是按 DOI/PMID 定位的内部状态，路径必须稳定，agent 的 `read/library` 也依赖它；输出文件则可能需要放进 Obsidian/项目仓库，或者跟随 DSH Workspace。把两者解耦，换输出目录不会打断文献库和全文缓存。

**执行会话与工作区**：设置页可选择 DSH 工作区（Workspace），插件会自动列出该工作区里的会话供下拉选择，也可以选择「＋ 新建会话」。调度器到点会在该会话里排回合；默认 `dsh-sci`。切换工作区后，新回合的 cwd 是该 Workspace 路径，数据仍写 `~/.dsh/sci`；如果该工作区没有写权限，请把输出目录也设到工作区内，或保持默认工作区。

输出目录、课题本地路径使用系统「选择文件夹…」对话框（DSH 原生目录选择器），不需要手输路径。DSH 目前只暴露目录选择器，不暴露文件选择器；单个文件（如 PDF）作为课题时仍需填绝对路径，或者把文件所在文件夹选进来。

---

## 2. 安装

在 DSH 里用 `plugin_manager` 安装本地目录（绝对路径）：

```text
plugin_manager action=install_bundle target=/Users/you/Development/dsh_plugin/dsh-sci
```

安装后：

1. 打开 **设置 → 科研**，填 **PICO / 研究方向 / 关键词 / 常看期刊 ISSN**，保存。
2. 点 **依赖体检**，确认 PubMed、Europe PMC、至少一个来源是绿的。
3. 点 **现在扫描一轮**，或等作息时间。

> 默认作息：周一到周五 `09:30` / `21:30`（±25 分钟，8% 概率休息）。周总结默认周日；若周日不在工作日里，自动落到最后一个工作日（默认周五晚上）。
> 不想自动跑，先在设置里关掉「启用自动作息」。

---

## 3. 快速开始

```bash
cd ~/.dsh/sci
SCI="node /absolute/path/to/dsh-sci/tools/sci.mjs"

# 体检
$SCI deps

# PICO 写在设置里后，brief 会优先用 PICO；也可以直接指定查询
$SCI brief --save
$SCI search --query "myocardial infarction" --days 30 --limit 8

# 题录 + 摘要 + 研究类型 + MeSH + 注册号
$SCI paper --id pmid:42815042

# 先看结构，再看表格/方法/图
$SCI read --id pmid:42815042 --outline
$SCI read --id pmid:42815042 --tables
$SCI read --id pmid:42815042 --section methods
$SCI read --id pmid:42815042 --grep "primary endpoint"
$SCI read --id pmid:42815042 --figures
$SCI read --id pmid:42815042 --chunk 1 --with-note

# 笔记（自动按研究类型选模板；也可 --template rct）
$SCI note new --id pmid:42815042 --template auto
$SCI note set --id pmid:42815042 --status read --rating 4 --rob low --grade moderate --effect "HR 0.54 (0.38-0.77)"

# 引文追踪 / 试验 / 导出 / 筛选
$SCI related --id pmid:42815042 --direction both --limit 10
$SCI trials --query "myocardial infarction AND antiplatelet" --limit 10
$SCI guidelines --query "myocardial infarction" --days 365 --limit 5
$SCI export --all --format ris --out exports/library.ris
$SCI export --all --format csv --out exports/library.csv
$SCI screen --id pmid:42815042 --decision exclude --reason "wrong population"

# 文献库
$SCI library list
$SCI library stats
$SCI library week

# 研究课题
$SCI topic add --path ~/projects/my-lab --title "My lab project" --keywords "protein design,enzyme"
$SCI topic add --repo https://github.com/owner/repo
$SCI topic pending
$SCI topic set --id <id> --status ready --keywords "kw1,kw2"
$SCI topic list

# 本地 PDF（中文指南/扫描件也可以，但扫描件不做 OCR）
$SCI read --pdf ~/papers/guideline.pdf --outline
```

`--json` 所有主要命令都支持。`--no-cache` 绕过 HTTP 缓存；`--refresh` 重新抓全文。

---

## 4. 来源与限额

| 源 | 默认 | 说明 |
|---|---|---|
| Europe PMC | 开 | 免费；PubMed/PMC + 预印本；开放全文 XML；支持 `TITLE_ABS`、`synonym`、`PUB_TYPE` |
| PubMed | 开 | E-utilities；`[tiab]`/`[MeSH]`/`[pt]`/`[dp]`；遵守 3 请求/秒，带 `tool=dsh-sci`/邮箱 |
| OpenAlex | 开 | 跨学科题录；无 key 时共享每日预算，额度用完会失败，不影响其他源 |
| Crossref | 关 | DOI 权威元数据；摘要覆盖一般 |
| arXiv | 关 | 预印本；临床模式默认不启用 |
| ClinicalTrials.gov | 关 | 注册信息；开启后 brief 附相关试验；也可以直接用 `trials` 命令 |

**OpenAlex key**：设置页「API key」写入 `~/.dsh/sci.secrets.json`（0600，只写不读回）。免费申请：<https://openalex.org/settings/api>。

**邮箱**：设置页「联系邮箱」用于 OpenAlex/Crossref 礼貌池和 Unpaywall OA 解析。

---

## 4.5 PubMed 字段标签

PubMed 的完整搜索字段标签已经内置，共 50 个，覆盖 `[ad] [all] [aid] [au] [auid] [book] [dcom] [cois] [cn] [crdt] [rn] [ed] [edat] [sb] [1au] [fau] [fir] [gr] [ir] [isbn] [ip] [ta] [la] [lastau] [lid] [mhda] [majr] [sh] [mh] [lr] [jid] [ot] [owner] [pg] [ps] [pa] [pl] [pmcid] [mid] [pmid] [dp] [pt] [pubn] [si] [nm] [tw] [ti] [tiab] [tt] [vi]`，以及 `hascommentin`、`hasretractionin`、`hasexpressionofconcernin` 等评论/更正检索词。

```bash
$SCI pubmed-fields
$SCI pubmed-query --query "heart attack" --author "Fauci AS" --journal "N Engl J Med" --language eng --pt "Randomized Controlled Trial" --filter hasabstract --from 2025-01-01
$SCI search --query '"myocardial infarction"[Title/Abstract] AND "randomized controlled trial"[pt]' --source pubmed
```

- 字段名、全名、常见别名（如 `Title/Abstract`、`pdat`、`filter`）都会规范成标准标签；`[tiab:~3]` 的邻近搜索后缀会保留。
- 未知标签不会删除，会在 `pubmed-query` 里以 `unknown` 返回。
- 结构化构建支持：作者/第一作者/最后作者、机构、期刊、语言、出版类型、标题、MeSH、资金、COI、PMID、DOI、日期范围、常用 filter。
- 字段说明来自 PubMed 官方帮助：<https://pubmed.ncbi.nlm.nih.gov/help/#using-search-field-tags>。

## 4.6 生物信息学数据库 lookup

插件内置了一个数据库目录和公开 API 查询层，参考 K-Dense-AI/scientific-agent-skills 的 database-lookup 契约（MIT，见 `NOTICE`）：先确定实体、规范 ID、物种/基因组版本和范围，再选权威库。

```bash
# 目录
$SCI db list
$SCI db list --domain variant

# 端点、认证、本地参考
$SCI db info uniprot
$SCI db doc ena

# 检索 / 取记录
$SCI db search uniprot "gene:TP53 AND organism_id:9606" --limit 5
$SCI db search ensembl TP53 --species human --build grch38
$SCI db search gnomad BRCA1 --limit 5
$SCI db get uniprot P04637
$SCI db get pdb 4HHB
$SCI db get clinvar 37088
$SCI db get gwas-catalog rs7329174
$SCI db get tcga-gdc TCGA-BRCA
```

已接入自动查询的重点库：

- 基因/蛋白：NCBI Gene、Ensembl、UniProt、NCBI Taxonomy、NCBI Protein、PDB、AlphaFold、InterPro、EMDB
- 变异/疾病：dbSNP、ClinVar、gnomAD、MyVariant、GWAS Catalog、HPO、Monarch、Open Targets
- 通路/互作：Reactome、KEGG、QuickGO、STRING、JASPAR、ENCODE
- 表达/组学：GEO、SRA、ENA、GTEx、Human Protein Atlas、HCA、PRIDE、Metabolomics Workbench
- 化学/药物：PubChem、ChEMBL、BindingDB
- 癌症/临床：cBioPortal、GDC/TCGA、ClinicalTrials.gov

需要 key 或登录的库（OMIM、BioGRID、DrugBank、DisGeNET、COSMIC、Addgene、BRENDA 等）保留在目录和本地参考中；没有授权时明确报告缺口，不绕过。NCBI/PubMed 可在设置页 PubMed 卡片下配置 API key（`NCBI_API_KEY` 环境变量也可作为覆盖），配置后 E-utilities 从 3 次/秒提升到 10 次/秒。

每个库的完整端点、参数、返回结构和坑都在 `templates/databases/*.md`，可用 `db info` 或 `db doc` 直接看。

## 4.7 生物信息学工作流（P0–P2）

- **计算证据模式**：设置里新增「生物信息/计算（预印本可用）」；预印本默认可进入候选，但仍会标记未同行评审。
- **实体规范化**：
  ```bash
  $SCI entity query gene TP53 --species human
  $SCI entity resolve variant rs334
  $SCI search --entity gene:TP53 --species human --limit 5
  ```
- **数据集检索**：
  ```bash
  $SCI dataset search "single-cell lung" --species human --limit 5
  $SCI dataset get GSE328618
  $SCI accession PXD000001
  ```
- **计算类笔记模板**：`dataset / tool / benchmark / gwas / rnaseq / singlecell / metagenomics / proteomics / ml`；`note new` 自动按标题/摘要选，也可 `--template`。
- **读文章时的数据库接地**：`read` 默认会对标题/关键词中的基因候选、正文中的 rsID/accession 做数据库核对，输出「数据库核对」；`read --genes TP53,BRCA1 --species human` 可显式指定。设置里可关闭或限制实体数。只使用返回的 ID/坐标；未解析实体标为未核对。
- **数据/代码可用性**：`read` 自动抽取 accession、GitHub/Zenodo、dbGaP/EGA/on-request，并写入笔记 frontmatter；`repro --id` 可单独复核。
- **组学文件检查**：`omics inspect file.vcf --build GRCh38`；支持 VCF/BED/GFF/GTF/FASTA/FASTQ/MTX/10x 目录，报告 SHA256、样本数、参考版本和明显错配。
- **统计/ML 风险**：`qc --id` / `read` 自动提示多重检验、数据泄漏、外部验证、伪重复、类别不平衡等静态模式；不是统计审查替代品。
- **项目 manifest**：`topic manifest --id <id>` 识别 Nextflow/Snakemake/WDL、environment.yml/renv/requirements、数据目录和运行命令。
- **watchlist 扩展**：
  ```bash
  $SCI watch --kind dataset --query "cancer" --species human
  $SCI watch --kind preprint --query "protein language model"
  $SCI watch --kind tool --query owner/repo
  ```
- **证据图**：`graph build` → `graph query GSE...`，连接 paper ↔ dataset ↔ code ↔ keyword ↔ topic。
- **Benchmark 表**：`benchmark --id <paper>` 从已缓存表格抽 dataset/method/metric 行。
- **Methods 草稿**：`methods draft --id <paper>`，输出结构化 Methods 草稿（必须人工核对）。
- **受控数据合规**：`compliance --id` 只报告 dbGaP/EGA/DUA/IRB，不尝试下载或绕过授权。

## 4.8 手动模式 / 自动模式

设置 → 科研 → 科研作息：

- **自动模式（默认）**
  - 保存后会在「执行会话」里创建 DSH 原生自动化任务，标题形如 `[dsh-sci] 09:30 科研`
  - DSH 的「自动化任务」面板可以看到、暂停或删除这些任务
  - 按设置的星期和时段触发；周总结由 prompt 按「周总结日 + 当天最后一个时段」判断
  - DSH 原生 weekly 任务只按精确时间触发，不支持 jitter/skip

- **手动模式**
  - 不会创建自动任务；保存时删除本插件创建的 DSH 自动化任务
  - 需要时点「扫描 / 深读 / 周总结」按钮立即执行
  - 适合调试、赶稿、或不想让 agent 在后台自己跑

模式是 `schedule.mode`：`auto` / `manual`。切换后保存即可同步 DSH 自动化任务。

## 5. 数据放在哪

```text
~/.dsh/sci.config.json          普通配置（设置页读写）
~/.dsh/sci.secrets.json         API key / 邮箱（0600，只写不读回）
~/.dsh/sci/
  AGENTS.md                     生物医学科研协议（首次生成；旧版未改会自动升级）
  TOOLING.md                    当前 CLI 绝对路径（每次启动覆盖）
  library/papers/*.json         题录（含 pubTypes/MeSH/ISSN/retraction）
  library/fulltext/*.txt        全文缓存
  library/fulltext/*.json       表格/图/警告缓存
  library/pdfs/*.pdf            OA PDF
  library/figures/<key>/        下载的图片（含表格图片）
  notes/*.md                    结构化笔记（按研究类型模板）
  briefs/YYYY-MM-DD.md          每日候选简报
  searches/*.json               检索策略 + PRISMA 计数
  screening.jsonl               纳入/排除记录
  reviews/YYYY-MM-DD-week.md    周总结
  ideas.jsonl                   研究想法
  log.jsonl                     事件流（检索词按隐私设置脱敏）
  schedule.json                 当日作息计划
  state.json                    已推荐过的文献等状态
  cache/                        HTTP 缓存
  bin/pdftext                   macOS PDFKit 抽取器（按需编译）
```

默认执行会话的 cwd 是 `~/.dsh/sci`；如果选择了其他 Workspace，cwd 是 Workspace 路径，数据仍在 `~/.dsh/sci`。agent 用 `read` / `write` / `bash` 都能直接看到这些文件。

---

## 6. 生物医学证据纪律

硬规则写在 `AGENTS.md`，代码也做了一部分强制：

- **撤稿**：`retracted`/`Retracted Publication`/`Retraction in` 默认不进 brief 候选；paper/read/note 显示警告。
- **预印本**：临床模式默认排除；打开后标“未同行评审”，不能作为疗效证据。
- **研究类型**：社论/评论/来信默认过滤；指南/系统综述/Meta 分析/RCT 在排序中优先。
- **OA 分离**：发现阶段可看非 OA 摘要；全文只读合法 OA/PMC，不绕过付费墙。
- **医学边界**：不是医生，不给诊断/处方/剂量/个体化治疗建议；临床决策引用指南并建议咨询临床医生。
- **隐私**：不把患者姓名、病历号、住院号、罕见病+地点等可识别信息放进检索词/笔记/外部 API；检索日志可脱敏或关闭。
- **引用**：不编造 DOI/作者/年份/样本量/效应量；没读全文就标 `skimmed`；区分作者说的/数据支持的/我的判断。
- **写作语言**：规范、非专业人士也能看懂；关键概念第一次出现时用一句话解释；**严禁使用比喻/类比**。

---

## 7. 已知限制

- 没有 CNKI/万方等中文数据库 API；中文指南可以用 `read --pdf` 读本地文件。
- 不做 OCR：扫描版 PDF 抽不出文字时会明确失败。
- 图片下载依赖 PMC CDN/出版社页面；个别图片会 404，此时保留图注和远程链接，不假装看过图。
- 表格解析是 JATS 启发式；复杂合并单元格/跨页表可能不完美；表格是图片时会提示用 `--figures` 下载后 `read_image`。
- 非 OA 论文只能读摘要；没有机构订阅代理。
- 引文追踪依赖 Europe PMC 的 citations/references 覆盖；新论文被引可能为 0。
- `reading.keepPdfDays` 目前只是配置项，尚未自动清理 PDF。
- 周总结由 agent 用 `write` 写文件，Host 不强制格式。

---

## 8. 开发与测试

```bash
cd /Users/you/Development/dsh_plugin/dsh-sci

# 语法检查
for f in $(find . -name '*.mjs'); do node --check "$f" || exit 1; done
node --check client.js

# 单元测试（纯函数）
node --test test/*.test.mjs

# 用临时数据目录跑真实网络（不污染 ~/.dsh/sci）
DSH_SCI_HOME=/tmp/dsh-sci-test DSH_SCI_CONFIG=/tmp/dsh-sci-test.json node tools/sci.mjs deps
DSH_SCI_HOME=/tmp/dsh-sci-test DSH_SCI_CONFIG=/tmp/dsh-sci-test.json node tools/sci.mjs search --query "myocardial infarction" --days 14 --limit 3
```

### 目录结构

```text
index.js              Host：设置 API、体检、状态、手动触发、DSH 自动化任务同步
scheduler.js          手动触发的 prompt / DSH native prompt
client.js             设置 → 科研（React，走 slot）
cordis.patch.yml      bundle 挂载声明
tools/sci.mjs         CLI 入口
tools/lib/            配置、HTTP、归一化、检索、全文、表格/图、笔记、导出、隐私、
                      数据库 lookup、实体接地、repro/QC、组学、证据图
tools/lib/sources/    OpenAlex / arXiv / Europe PMC / PubMed / Crossref / ClinicalTrials / 引文
tools/commands/       deps/search/paper/read/note/library/brief/
                      db/entity/dataset/accession/enrich/
                      omics/repro/qc/benchmark/graph/methods/compliance/
                      related/trials/guidelines/watch/topic/export/screen/idea/log
templates/AGENTS.md   科研协议模板
templates/databases/  54 份数据库 API reference（MIT，见 NOTICE）
test/                 node:test 纯函数测试
```

---

## 9. Contributing

见 [CONTRIBUTING.md](CONTRIBUTING.md)。GitHub Actions 在 Node 22/24 上跑语法检查和 `npm test`。

## 10. License

MIT。`templates/databases/` 的部分 reference 来自 K-Dense-AI/scientific-agent-skills，MIT，详见 [NOTICE](NOTICE)。第三方 API 的使用受各自条款约束；下载的论文版权归原作者/出版方，插件只保存合法开放获取的副本供本地阅读。
