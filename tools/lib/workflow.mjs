/**
 * 本地工作流检查与受控执行。
 *
 * 只识别 Nextflow / Snakemake / miniwdl；执行必须显式 --yes，
 * 命令通过 argv 传入，不经过 shell。默认只做检查和 dry-run。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const ENTRY = [
  ['nextflow', /^main\.nf$|^workflow\.nf$|^.*\.nf$/i],
  ['snakemake', /^Snakefile$|^workflow\/Snakefile$/i],
  ['wdl', /\.wdl$/i],
]

function walk(root, maxDepth = 4) {
  const out = []
  const visit = (dir, depth) => {
    if (depth > maxDepth) return
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === '.nextflow') continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) visit(p, depth + 1)
      else out.push(p)
      if (out.length > 5000) return
    }
  }
  visit(root, 0)
  return out
}

export function detectWorkflow(root) {
  const abs = path.resolve(String(root ?? ''))
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`目录不存在：${abs}`)
  const files = walk(abs)
  const rel = (p) => path.relative(abs, p).split(path.sep).join('/')
  const entries = []
  for (const [kind, re] of ENTRY) {
    for (const f of files) if (re.test(rel(f))) entries.push({ kind, file: rel(f) })
  }
  const env = files.filter((f) => /(^|\/)(environment\.ya?ml|requirements\.txt|pyproject\.toml|renv\.lock|Dockerfile|container.*\.(sif|def)|.*\.def)$/i.test(rel(f))).map(rel)
  const text = files.filter((f) => /\.(nf|smk|wdl|config|ya?ml)$/i.test(f)).map((f) => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } }).join('\n')
  const containers = [...new Set([...text.matchAll(/\b(docker|singularity|apptainer|podman|conda)\b/gi)].map((m) => m[1].toLowerCase()))]
  const warnings = []
  if (!entries.length) warnings.push('未识别到 Nextflow / Snakemake / WDL 入口')
  if (/\b(GRCh3[78]|hg19|hg38|GRCm3[89]|mm10|mm39)\b/i.test(text)) warnings.push('检测到参考基因组字符串；执行前确认数据与参考版本一致')
  if (/\b(dbGaP|EGA|DUA|IRB)\b/i.test(text)) warnings.push('检测到受控数据线索；执行前确认授权和合规')
  return { ok: entries.length > 0, root: abs, entries, env, containers, warnings, files: files.length }
}

export function planWorkflow(root, { kind = 'auto', dryRun = true, cores = 1, profile = '', timeout = 600 } = {}) {
  const d = detectWorkflow(root)
  let e = d.entries[0]
  if (kind && kind !== 'auto') e = d.entries.find((x) => x.kind === kind) ?? null
  if (!e) throw new Error(`没有找到 ${kind === 'auto' ? '可用' : kind} 工作流入口；先运行 workflow inspect`)
  const entry = path.join(d.root, e.file)
  const n = Math.max(1, Math.min(64, Number(cores) || 1))
  let cmd, args
  if (e.kind === 'nextflow') {
    cmd = 'nextflow'
    args = ['run', entry]
    if (profile) args.push('-profile', String(profile))
    if (dryRun) args.push('-preview')
  } else if (e.kind === 'snakemake') {
    cmd = 'snakemake'
    args = ['--cores', String(n)]
    if (dryRun) args.push('-n')
  } else {
    cmd = 'miniwdl'
    args = dryRun ? ['check', entry] : ['run', entry]
  }
  return { ...d, kind: e.kind, entry, cmd, args, dryRun, timeout: Math.max(10, Math.min(86_400, Number(timeout) || 600)) }
}

export function checkTools(plan) {
  const tools = ['nextflow', 'snakemake', 'miniwdl', 'java', 'docker', 'singularity', 'apptainer', 'podman']
  const found = {}
  for (const t of tools) {
    const r = spawnSync(t, ['--version'], { encoding: 'utf8', timeout: 5_000 })
    found[t] = r.error ? false : true
  }
  return {
    ...plan,
    tools: found,
    toolAvailable: Boolean(found[plan.cmd]),
    warnings: [...(plan.warnings ?? []), ...(found[plan.cmd] ? [] : [`找不到 ${plan.cmd}；只能检查文件，不能执行`])],
  }
}

export async function runWorkflow(plan, { yes = false, logDir = '' } = {}) {
  if (!yes) throw new Error('执行工作流需要显式 --yes')
  const checked = checkTools(plan)
  if (!checked.toolAvailable) throw new Error(`找不到 ${plan.cmd}；先安装或在 PATH 中提供`)
  const dir = path.resolve(logDir || path.join(process.env.DSH_SCI_HOME || path.join(process.env.HOME || '.', '.dsh', 'sci'), 'workflows'))
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const log = path.join(dir, `${stamp}-${plan.kind}.log`)
  const child = spawn(plan.cmd, plan.args, { cwd: plan.root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (d) => { output += d; fs.appendFileSync(log, d) })
  child.stderr.on('data', (d) => { output += d; fs.appendFileSync(log, d) })
  const code = await new Promise((resolve) => {
    let done = false
    const timer = setTimeout(() => { if (!done) { try { child.kill('SIGTERM') } catch {} ; done = true; resolve(124) } }, plan.timeout * 1000)
    child.on('error', () => { clearTimeout(timer); done = true; resolve(127) })
    child.on('close', (c) => { clearTimeout(timer); done = true; resolve(c ?? 1) })
  })
  fs.appendFileSync(log, `\n[dsh-sci] exit ${code}\n`)
  return { ok: code === 0, code, log, command: `${plan.cmd} ${plan.args.join(' ')}`, output: output.slice(-4000) }
}
