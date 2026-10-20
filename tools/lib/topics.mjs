/**
 * 自定义研究课题：本地文件/文件夹，或 GitHub 仓库。
 *
 * 插件不会假装“读懂了”代码或 PDF：首次引入时生成 source inventory 和 PROJECT.md 骨架，
 * 由 agent 在会话里阅读后填写结构化描述；搜索时再读取 PROJECT.md/元数据里的关键词。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { stripTags } from './normalize.mjs'
import { PATHS, ensureDataDirs, readJson, writeJson, readConfig, atomicWrite } from './config.mjs'

const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.rst', '.tex', '.org', '.json', '.yaml', '.yml', '.csv', '.tsv', '.py', '.r', '.jl', '.m', '.ipynb', '.js', '.ts', '.tsx', '.jsx', '.java', '.c', '.cc', '.cpp', '.h', '.hpp', '.sh', '.toml', '.ini', '.cfg', '.xml', '.html'])
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', 'target', '.idea', '.vscode', 'coverage'])

function slug(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'topic'
}

function hash(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 6)
}

function topicDir(id) {
  return path.join(PATHS.topics, id)
}

export function readTopics() {
  const raw = readJson(PATHS.topicsFile, null)
  return Array.isArray(raw?.topics) ? raw.topics : []
}

export function writeTopics(topics) {
  ensureDataDirs()
  writeJson(PATHS.topicsFile, { version: 1, topics })
  return topics
}

export function getTopic(id) {
  return readTopics().find((t) => t.id === id) ?? null
}

function safeRead(file, max = 120_000) {
  try {
    const st = fs.statSync(file)
    if (!st.isFile() || st.size > max * 4) return ''
    return fs.readFileSync(file, 'utf8').slice(0, max)
  } catch { return '' }
}

function isText(file) {
  const ext = path.extname(file).toLowerCase()
  if (TEXT_EXT.has(ext)) return true
  const buf = (() => {
    try {
      const fd = fs.openSync(file, 'r')
      const b = Buffer.alloc(512)
      const n = fs.readSync(fd, b, 0, b.length, 0)
      fs.closeSync(fd)
      return b.subarray(0, n)
    } catch { return Buffer.alloc(0) }
  })()
  return buf.length > 0 && !buf.includes(0)
}

function extractDocumentText(file) {
  const ext = path.extname(file).toLowerCase()
  try {
    if (ext === '.pdf') {
      // 延迟加载，避免只需要文本文件时也初始化 PDF 工具链。
      return import('./fulltext.mjs').then((m) => m.extractPdfText(file)).catch(() => '')
    }
    if (ext === '.docx') {
      const r = spawnSync('unzip', ['-p', file, 'word/document.xml'], { encoding: 'utf8', timeout: 30_000, maxBuffer: 20 * 1024 * 1024 })
      if (r.status === 0) return stripTags(r.stdout).slice(0, 120_000)
    }
  } catch {}
  return ''
}

function walk(root, maxFiles = 300, maxDepth = 3) {
  const files = []
  const dirs = []
  function rec(dir, depth) {
    if (depth > maxDepth || files.length >= maxFiles) return
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.github') continue
      if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        dirs.push(full)
        rec(full, depth + 1)
      } else if (e.isFile()) {
        try {
          const st = fs.statSync(full)
          files.push({ path: full, size: st.size })
        } catch {}
      }
      if (files.length >= maxFiles) break
    }
  }
  rec(root, 0)
  return { files, dirs }
}

function rel(root, file) { return path.relative(root, file) || path.basename(file) }

function workflowSummary(root, files) {
  const names = files.map((f) => f.path)
  const pick = (re) => names.filter((p) => re.test(path.basename(p))).slice(0, 12)
  const workflows = pick(/^(nextflow\.config|main\.nf|Snakefile|.*\.wdl|workflow.*\.(nf|smk))$/i)
  const envs = pick(/^(environment\.ya?ml|renv\.lock|requirements\.txt|pyproject\.toml|Pipfile|Conda.*\.ya?ml|Dockerfile|container.*)$/i)
  const data = names.filter((p) => /(^|\/)(data|raw|results|output|inputs|samples)(\/|$)/i.test(p)).slice(0, 30)
  const lines = []
  if (workflows.length) {
    lines.push('### 工作流')
    for (const f of workflows) lines.push(`- \`${rel(root, f)}\``)
  }
  if (envs.length) {
    lines.push('### 环境 / 依赖')
    for (const f of envs) lines.push(`- \`${rel(root, f)}\``)
  }
  if (data.length) {
    lines.push('### 数据资产')
    for (const f of data) lines.push(`- \`${rel(root, f)}\``)
  }
  if (!lines.length) lines.push('（未识别到 Nextflow/Snakemake/WDL 或环境文件；见目录树。）')
  return lines
}

export function buildManifest(id) {
  const t = getTopic(id)
  if (!t) throw new Error(`课题不存在：${id}`)
  if (!t.localPath || !fs.existsSync(t.localPath)) throw new Error('课题没有可读取的本地目录')
  const root = t.localPath
  const { files } = walk(root, 400, 4)
  const names = files.map((f) => f.path)
  const rels = (re) => names.filter((p) => re.test(path.basename(p))).map((p) => rel(root, p)).slice(0, 20)
  const workflows = rels(/^(nextflow\.config|main\.nf|Snakefile|.*\.wdl|workflow.*\.(nf|smk))$/i)
  const envs = rels(/^(environment\.ya?ml|renv\.lock|requirements\.txt|pyproject\.toml|Pipfile|Dockerfile)$/i)
  const dataDirs = names.filter((p) => /(^|\/)(data|raw|results|output|inputs|samples)(\/|$)/i.test(p)).slice(0, 30).map((p) => rel(root, p))
  const read = (p) => safeRead(path.join(root, p), 6000)
  const commands = []
  for (const f of [...workflows, ...envs]) {
    for (const line of read(f).split('\n')) if (/^\s*(nextflow|snakemake|python|Rscript|conda|pip|renv|docker|singularity|apptainer)\b/.test(line)) commands.push(`${f}: ${line.trim()}`)
  }
  const md = `# Project manifest: ${t.title}\n\n- 生成时间：${new Date().toISOString()}\n- 来源：${t.repoUrl || t.localPath}\n- 文件：${files.length}${files.length >= 400 ? '+' : ''}\n\n## 工作流入口\n\n${workflows.length ? workflows.map((x) => `- \`${x}\``).join('\n') : '- 未识别'}\n\n## 环境 / 依赖\n\n${envs.length ? envs.map((x) => `- \`${x}\``).join('\n') : '- 未识别'}\n\n## 数据资产\n\n${dataDirs.length ? dataDirs.map((x) => `- \`${x}\``).join('\n') : '- 未识别'}\n\n## 可复现命令线索\n\n${commands.length ? commands.slice(0, 40).map((x) => `- ${x}`).join('\n') : '- 未识别到明确的运行命令'}\n\n## 待核对\n\n- 数据是否受控/有 license：\n- 参考基因组/数据库版本：\n- 容器 digest / commit：\n- 随机种子与参数：\n`
  const file = path.join(topicDir(id), 'MANIFEST.md')
  atomicWrite(file, md)
  return { file, markdown: md }
}

function inventoryForDirectory(root, { sourceLabel = '' } = {}) {
  const { files, dirs } = walk(root)
  const readme = files.find((f) => /^readme(\.|$)/i.test(path.basename(f.path)))
  const manifests = files.filter((f) => /(^|\/)(package\.json|pyproject\.toml|requirements\.txt|Cargo\.toml|go\.mod|pom\.xml|build\.gradle|CMakeLists\.txt|environment\.ya?ml)$/i.test(f.path))
  const docs = files.filter((f) => /\.(md|rst|txt)$/i.test(f.path)).slice(0, 12)
  const lines = [
    `# Source inventory`,
    '',
    `- 根目录：\`${root}\``,
    sourceLabel ? `- 来源：${sourceLabel}` : '',
    `- 文件：${files.length}${files.length >= 300 ? '+' : ''} · 目录：${dirs.length}`,
    '',
    '## 目录结构（前 3 层）',
    '',
    ...dirs.slice(0, 80).map((d) => `- \`${rel(root, d)}/\``),
    '',
    '## 文件',
    '',
    ...files.slice(0, 160).map((f) => `- \`${rel(root, f.path)}\` (${Math.round(f.size / 1024)} KB)`),
    '',
    '## 工作流 / 环境 / 数据资产',
    '',
    ...workflowSummary(root, files),
    '',
    '## README',
    '',
    readme ? `\`${rel(root, readme.path)}\`\n\n${safeRead(readme.path, 30_000)}` : '（没有找到 README）',
    '',
    '## 依赖/构建清单',
    '',
    ...manifests.slice(0, 10).map((f) => `### ${rel(root, f.path)}\n\n\`\`\`\n${safeRead(f.path, 8000)}\n\`\`\``),
    '',
    '## 文档摘录',
    '',
    ...docs.slice(0, 8).map((f) => `### ${rel(root, f.path)}\n\n${safeRead(f.path, 12_000)}`),
    '',
  ]
  return lines.join('\n')
}

function inventoryForFile(file, text) {
  return [
    '# Source inventory',
    '',
    `- 文件：\`${file}\``,
    `- 大小：${Math.round(fs.statSync(file).size / 1024)} KB`,
    `- 文本：${text ? '是' : '否/无法直接抽取'}`,
    '',
    '## 原文摘录',
    '',
    text ? text.slice(0, 60_000) : '（非文本或无法直接抽取；请用 PDF/Office 工具阅读后补充）',
    '',
  ].join('\n')
}

function assessText(text) {
  const s = String(text ?? '')
  const hasSections = /(研究问题|研究目标|背景|目的|方法|数据|结果|进展|假设|创新|research question|objective|background|method|data|result|contribution)/i.test(s)
  const paragraphs = s.split(/\n{2,}/).length
  if (s.length >= 800 && hasSections) return { quality: 'clear', note: '原文包含较完整的研究描述。' }
  if (s.length >= 400 && (hasSections || paragraphs >= 3)) return { quality: 'partial', note: '原文有描述，但研究问题/方法/数据/进展可能不完整，建议 agent 补齐。' }
  return { quality: 'thin', note: '原文对研究内容的描述不足，PROJECT.md 需要 agent 根据材料补充。' }
}

function projectScaffold({ title, kind, sourcePath, inventoryRel, assessment, keywords }) {
  return `---
topic: ${JSON.stringify(title)}
kind: ${JSON.stringify(kind)}
source: ${JSON.stringify(sourcePath)}
status: "needs-review"
keywords: ${JSON.stringify(keywords ?? [])}
created: ${JSON.stringify(new Date().toISOString())}
updated: ${JSON.stringify(new Date().toISOString())}
---

# 研究课题：${title}

> 这是课题的结构化描述。首次引入时由 agent 阅读 \`${inventoryRel}\` 和原始材料后填写；
> 如果原文是文本文档，请检查研究问题、方法、数据、当前进展是否已经说清楚；不清楚的地方要明确写出。
> 写作要求：规范、非专业人士能懂；关键概念第一次出现时用一句话解释；**严禁使用比喻/类比**。

## 1. 研究问题

- 这个课题要回答什么？
- 为什么重要（对谁重要）？

## 2. 背景与缺口

- 已有工作做到了什么？
- 还缺什么？本课题的切入点是什么？

## 3. 方法 / 数据 / 系统

- 核心方法或系统架构：
- 数据/样本/实验设置：
- 基线/对照：
- 评价指标：

## 4. 当前进展与关键结果

- 已经完成了什么？
- 有哪些初步结果/失败/待验证的假设？
- 目前最大的阻塞是什么？

## 5. 关键概念（给非专业读者）

（每个概念：一句话定义 + 它在本课题里的作用；不要用比喻。）

-

## 6. 与文献的接口

- 需要追踪的文献类型：
- 与本课题最相关的 3–5 个问题：
- 哪些论文可能提供方法/数据/对照/反例：

## 7. 检索关键词

（逗号分隔；会用于 brief/search 的 topic scope）

${(keywords ?? []).join(', ') || '- '}

## 8. 待确认

- 原文没有说清楚的地方：
- 需要问用户的问题：

<details>
<summary>首次引入评估</summary>

${assessment?.note ?? ''}

材料清单：\`${inventoryRel}\`

</details>
`
}

function cloneRepo(url, dest) {
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/i.test(url)) {
    throw new Error('只支持 https://github.com/<owner>/<repo> 形式的仓库地址')
  }
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const r = spawnSync('git', ['clone', '--depth', '1', '--single-branch', url, dest], {
    encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
  })
  if (r.status !== 0) throw new Error(`git clone 失败：${String(r.stderr || r.stdout || '').slice(0, 300)}`)
}

export async function addTopic({ path: inputPath, repo, title, keywords = [] } = {}) {
  if (!inputPath && !repo) throw new Error('需要 --path <文件/文件夹> 或 --repo <GitHub URL>')
  ensureDataDirs()
  const now = new Date().toISOString()
  const cleanTitle = String(title || (repo ? repo.split('/').slice(-2).join('/') : path.basename(inputPath || 'project'))).trim()
  const id = `${slug(cleanTitle)}-${hash(`${repo || inputPath}|${Date.now()}`)}`
  const dir = topicDir(id)
  fs.mkdirSync(dir, { recursive: true })
  let kind = 'repo'
  let sourcePath = repo || path.resolve(inputPath)
  let localPath = ''
  let text = ''
  let inventory = ''

  if (repo) {
    const repoDir = path.join(dir, 'repo')
    cloneRepo(repo, repoDir)
    kind = 'repo'
    localPath = repoDir
    inventory = inventoryForDirectory(repoDir, { sourceLabel: repo })
  } else {
    const rawInput = String(inputPath)
    const expanded = rawInput === '~' ? os.homedir() : rawInput.startsWith('~/') ? path.join(os.homedir(), rawInput.slice(2)) : rawInput
    const abs = path.resolve(expanded)
    if (!fs.existsSync(abs)) throw new Error(`路径不存在：${abs}`)
    const st = fs.statSync(abs)
    if (st.isDirectory()) {
      kind = 'dir'
      localPath = abs
      inventory = inventoryForDirectory(abs, { sourceLabel: abs })
    } else {
      kind = 'file'
      localPath = abs
      text = isText(abs) ? safeRead(abs, 120_000) : await extractDocumentText(abs)
      if (text && st.size < 2 * 1024 * 1024) {
        const copy = path.join(dir, 'source', path.basename(abs))
        fs.mkdirSync(path.dirname(copy), { recursive: true })
        fs.copyFileSync(abs, copy)
      }
      inventory = inventoryForFile(abs, text)
    }
  }

  const inventoryRel = path.join('inventory.md')
  atomicWrite(path.join(dir, 'inventory.md'), inventory + '\n')
  const assessmentText = text || (kind === 'dir' || kind === 'repo' ? inventory.slice(0, 60_000) : '')
  const assessment = assessText(assessmentText)
  const projectFile = path.join(dir, 'PROJECT.md')
  if (!fs.existsSync(projectFile)) {
    atomicWrite(projectFile, projectScaffold({ title: cleanTitle, kind, sourcePath, inventoryRel, assessment, keywords }))
  }
  const entry = {
    id, title: cleanTitle, kind, sourcePath, localPath, repoUrl: repo || '',
    status: 'needs-review', quality: assessment.quality, keywords,
    inventory: path.join(dir, 'inventory.md'), project: projectFile,
    createdAt: now, updatedAt: now,
  }
  writeTopics([...readTopics().filter((t) => t.id !== id), entry])
  return entry
}

export async function refreshTopic(id) {
  const t = getTopic(id)
  if (!t) throw new Error(`课题不存在：${id}`)
  const dir = topicDir(id)
  let inventory = ''
  if (t.kind === 'repo') {
    const repoDir = path.join(dir, 'repo')
    const r = spawnSync('git', ['-C', repoDir, 'pull', '--ff-only'], { encoding: 'utf8', timeout: 120_000 })
    if (r.status !== 0) throw new Error(`git pull 失败：${String(r.stderr || r.stdout || '').slice(0, 300)}`)
    inventory = inventoryForDirectory(repoDir, { sourceLabel: t.repoUrl })
  } else if (t.kind === 'dir') {
    inventory = inventoryForDirectory(t.localPath, { sourceLabel: t.localPath })
  } else {
    const text = isText(t.localPath) ? safeRead(t.localPath, 120_000) : await extractDocumentText(t.localPath)
    inventory = inventoryForFile(t.localPath, text)
  }
  atomicWrite(path.join(dir, 'inventory.md'), inventory + '\n')
  const updatedAt = new Date().toISOString()
  writeTopics(readTopics().map((x) => x.id === id ? { ...x, updatedAt } : x))
  return getTopic(id)
}

export function updateTopic(id, patch) {
  const t = getTopic(id)
  if (!t) throw new Error(`课题不存在：${id}`)
  const next = { ...t, ...patch, updatedAt: new Date().toISOString() }
  if (patch.keywords) next.keywords = [...new Set(patch.keywords.map((x) => String(x).trim()).filter(Boolean))].slice(0, 20)
  if (patch.status && !['needs-review', 'ready', 'paused'].includes(patch.status)) throw new Error('status 只能是 needs-review / ready / paused')
  writeTopics(readTopics().map((x) => x.id === id ? next : x))
  // 同步 PROJECT.md 的 frontmatter，避免 UI 和文件里的状态不一致。
  try {
    let md = fs.readFileSync(next.project, 'utf8')
    md = md.replace(/^status:.*$/m, `status: ${JSON.stringify(next.status)}`)
    md = md.replace(/^keywords:.*$/m, `keywords: ${JSON.stringify(next.keywords ?? [])}`)
    md = md.replace(/^updated:.*$/m, `updated: ${JSON.stringify(next.updatedAt)}`)
    atomicWrite(next.project, md)
  } catch {}
  return next
}

export function removeTopic(id) {
  const t = getTopic(id)
  if (!t) return false
  writeTopics(readTopics().filter((x) => x.id !== id))
  return true
}

export function projectText(id) {
  const t = getTopic(id)
  if (!t) return ''
  try { return fs.readFileSync(t.project, 'utf8') } catch { return '' }
}

export function selectedTopics(cfg = readConfig()) {
  const all = readTopics()
  const sel = cfg.topics?.selected ?? []
  if (sel.length) return all.filter((t) => sel.includes(t.id))
  return all.filter((t) => t.status !== 'paused')
}

export function topicKeywords(cfg = readConfig()) {
  return [...new Set(selectedTopics(cfg).flatMap((t) => t.keywords ?? []).map((x) => String(x).trim()).filter(Boolean))]
}

export function topicQueries(cfg = readConfig()) {
  if (!cfg.topics?.autoScope) return []
  const max = Math.max(0, Math.min(5, cfg.topics?.maxQueries ?? 2))
  return selectedTopics(cfg)
    .map((t) => (t.keywords ?? []).slice(0, 3).map((k) => `"${String(k).replace(/"/g, '')}"`).join(' AND '))
    .filter(Boolean)
    .slice(0, max)
}

export function topicTitles(cfg = readConfig()) {
  return selectedTopics(cfg).map((t) => t.title)
}

export function pendingTopics() {
  return readTopics().filter((t) => t.status === 'needs-review')
}
