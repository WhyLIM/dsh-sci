# dsh-sci

[GitHub](https://github.com/WhyLIM/dsh-sci) · MIT

`dsh-sci` 是 DSH（DeepSeek Harness）的科研插件。它帮助使用者检索生物医学论文、读取开放获取全文、整理结构化笔记、查询生物信息数据库，并按设定时间自动运行。

它提供检索、读取、记录和查询工具，不提供医学诊断或治疗建议。具体阅读和判断由 DSH 会话中的 agent（执行任务的模型）完成。

---

## 主要功能

| 功能 | 说明 |
|---|---|
| 文献检索 | 默认使用 Europe PMC 和 PubMed；OpenAlex 补充跨学科题录；Crossref 补充 DOI 元数据；ClinicalTrials.gov 补充临床试验注册信息 |
| 检索条件 | 支持 PICO（人群、干预、对照、结局）、研究类型、发表日期、期刊、作者、MeSH 主题词和字段限定 |
| 全文阅读 | 只读取合法的开放获取（OA）或 PMC 全文，支持按章节、表格、图片和关键词阅读 |
| 结构化笔记 | 按研究类型选择模板，记录 PICO、偏倚风险、效应量、置信区间、局限和对课题的启示 |
| 数据库查询 | 内置 50 多个生物信息数据库目录，其中 42 个可直接查询；需要账号或当前 API 不可用的数据库只保留说明，不绕过授权 |
| 数据核对 | 把论文中的基因、变异、蛋白、数据集编号对应到数据库标准记录，并标出未核对的实体 |
| 实体规范化 | 支持基因、变异、蛋白、疾病、药物、通路、表型；可用 `entity batch --file ids.txt` 批量映射 |
| 计算类工作 | 检查 VCF、BED、GFF、FASTA、FASTQ、10x 矩阵等文件；读取 BAM/CRAM/HDF5/BigWig 文件头；检查数据与代码可用性；生成 Methods 草稿和 Benchmark 表 |
| 定时运行 | 自动模式创建 DSH 自动化任务；手动模式只在使用者点击按钮时执行 |
| 导出与筛选 | 导出 RIS、BibTeX、CSL-JSON、CSV；记录纳入、排除和排除原因 |

---

## 安装

在 DSH 中安装本地插件目录：

```text
plugin_manager action=install_bundle target=/absolute/path/to/dsh-sci
```

安装后：

1. 打开 **设置 → 科研**。
2. 填写研究方向、PICO、关键词和常看期刊的 ISSN，然后保存。
3. 点 **依赖体检**，确认至少一个文献来源可用。
4. 点 **现在扫描一轮**，或等待自动任务运行。

设置页顶部可以切换运行模式和立即执行；**保存设置**按钮在页面底部。

---

## 快速开始

DSH 执行会话的默认目录是 `~/.dsh/sci`。下面的命令都在该目录执行：

```bash
cd ~/.dsh/sci
SCI="node /absolute/path/to/dsh-sci/tools/sci.mjs"

$SCI deps
$SCI brief --save
$SCI search --query "myocardial infarction" --days 30 --limit 8

$SCI read --id pmid:42815042 --outline
$SCI read --id pmid:42815042 --tables
$SCI read --id pmid:42815042 --section methods

$SCI note new --id pmid:42815042
$SCI note set --id pmid:42815042 --status read --rating 4

$SCI related --id pmid:42815042 --direction both --limit 10
$SCI export --all --format ris --out exports/library.ris
$SCI export --all --format csv --out exports/library.csv
```

数据库和组学命令：

```bash
$SCI db list --domain variant
$SCI db search uniprot "gene:TP53 AND organism_id:9606" --limit 5
$SCI db get pdb 4HHB

$SCI entity query gene TP53 --species human
$SCI entity resolve disease "type 2 diabetes"
$SCI entity batch --file ids.txt
$SCI dataset get GSE328618
$SCI omics inspect sample.vcf --build GRCh38

$SCI graph build
$SCI graph html --out graph.html
```

大多数命令支持 `--json`，方便脚本处理。完整命令说明见 `node tools/sci.mjs --help`。

---

## 运行模式

设置页的 **运行模式** 有两个选项。

### 自动模式

保存后，插件在指定的 DSH 执行会话中创建 DSH 自动化任务。任务会出现在 DSH 的 **自动化任务** 面板，可以暂停或删除。

默认时间：

```text
周一至周五 09:30、21:30
```

DSH 自动化任务按准确时间触发，不支持随机延迟或跳过。周总结由任务说明根据周总结日和当天最后一个时段判断。

### 手动模式

不创建自动任务。需要时点击设置页顶部的：

```text
现在扫描一轮
现在深读一轮
现在做周总结
```

切换模式后需要保存。关闭设置有未保存内容时，页面会询问是否保存。

---

## 文献来源

| 来源 | 默认 | 用途 |
|---|---|---|
| Europe PMC | 开 | 生物医学题录、PMC 全文、预印本 |
| PubMed | 开 | 使用 PubMed 官方检索接口；支持字段标签和研究类型 |
| OpenAlex | 开 | 跨学科题录和引用信息 |
| Crossref | 关 | DOI 元数据 |
| arXiv | 关 | 预印本 |
| ClinicalTrials.gov | 关 | 临床试验注册信息 |

PubMed 和 NCBI 的 API key 在设置页 PubMed 卡片中填写。未配置时遵守每秒 3 次请求的限制；配置后提高到每秒 10 次。也可以通过环境变量 `NCBI_API_KEY` 提供。

OpenAlex API key 和联系邮箱用于提高请求额度。密钥只写入 `~/.dsh/sci.secrets.json`，设置页不会读回明文。

发现阶段可以查看非开放获取论文的摘要。读取全文时只使用合法的 OA 或 PMC 版本，不绕过付费墙。

---

## 数据与输出

配置文件和数据都在 DSH 用户目录：

```text
~/.dsh/sci.config.json        普通设置
~/.dsh/sci.secrets.json       API key，权限 0600
~/.dsh/sci/                   文献库、缓存、笔记、简报和筛选记录
```

主要数据目录：

```text
~/.dsh/sci/library/papers/       题录
~/.dsh/sci/library/fulltext/     全文和表格缓存
~/.dsh/sci/library/pdfs/         开放获取 PDF
~/.dsh/sci/library/figures/      图片
~/.dsh/sci/notes/                论文笔记
~/.dsh/sci/briefs/               每日简报
~/.dsh/sci/reviews/              周总结
~/.dsh/sci/searches/             检索策略和计数
~/.dsh/sci/topics/               研究课题资料
```

可以在设置页指定单独的 **输出目录**。笔记、简报、周总结、检索策略、研究想法和方法草稿会写入该目录；题录、全文缓存、PDF、图片和数据库缓存仍在数据目录。

默认执行会话是 `dsh-sci`。也可以选择其他 DSH 工作区和会话。数据始终写入 `~/.dsh/sci`，除非另外设置数据目录。

---

## 安全边界

- 只读取合法的开放获取全文，不绕过付费墙或机构订阅。
- 需要账号或授权的数据库只报告可用信息，不尝试绕过。
- 不提供诊断、处方、剂量或个体化治疗建议。
- 撤稿论文默认不进入候选；预印本会标注未经同行评审。
- 不编造 DOI、作者、年份、样本量或效应量。未读全文时标记为仅浏览摘要。
- 不把患者姓名、病历号、住院号等可识别信息写入检索词、笔记或外部 API。
- 笔记和说明要求解释关键概念。写作不使用比喻或类比。

具体规则见 [templates/AGENTS.md](templates/AGENTS.md)。

---

## 已知限制

- 没有 CNKI、万方等中文数据库接口。中文指南可以通过本地 PDF 读取。
- 不支持 OCR。扫描版 PDF 无文字层时会明确失败。
- 图片下载依赖 PMC 和出版社页面。图片缺失时保留图注和链接，不标记为已阅读。
- BAM/CRAM/HDF5/BigWig 目前只检查文件头和签名，不解析全部记录。
- 复杂表格、合并单元格和跨页表格可能解析不完整。
- 非开放获取论文只能读取摘要。
- 引文追踪依赖 Europe PMC 的引用数据，新论文的引用数可能不完整。
- `reading.keepPdfDays` 目前只是配置项，尚未自动清理 PDF。
- RegulomeDB 官方 JSON 端点当前返回网页，ZINC 会触发人机验证；两者暂不自动查询。
- 周总结由 agent 写入文件，Host 不强制固定格式。

---

## 开发

```bash
cd /Users/you/Development/dsh_plugin/dsh-sci
npm test

# 单独检查语法
node --check index.js
node --check client.js
node --check scheduler.js
find tools -name '*.mjs' -print0 | xargs -0 -n1 node --check
```

`npm test` 运行 30 项测试，其中 1 项实时数据库检查默认跳过。设置 `DSH_SCI_LIVE_TESTS=1` 后运行 `npm run test:live`，会检查公开数据库的真实响应；GitHub Actions 不运行这项网络测试。

主要文件：

```text
index.js              Host 接口：设置、状态、手动执行、自动化任务同步
scheduler.js          手动执行说明和 DSH 自动化任务说明
client.js             设置页「科研」
cordis.patch.yml      DSH bundle 声明
tools/sci.mjs         命令行入口
tools/commands/       各命令实现
tools/lib/            配置、HTTP、检索、全文、笔记、数据库、组学、质控
templates/            AGENTS 规范和数据库参考文档
test/                 单元测试
```

安装和开发说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 许可证

MIT。`templates/databases/` 的部分参考资料来自 K-Dense-AI/scientific-agent-skills，按 MIT 许可证使用，详见 [NOTICE](NOTICE)。第三方 API 受各自服务条款约束；下载论文的版权归原作者和出版方所有。
