/**
 * dsh-sci —— Host 半边。
 *
 * 职责：
 *   1. 设置页 API（配置 / 密钥状态，绝不回显密钥）
 *   2. 依赖体检（真的跑 tools/sci.mjs deps --json）
 *   3. 状态 / 最近简报
 *   4. 启动“科研作息”调度器：到点在固定会话 dsh-sci 里塞一个回合
 *   5. 手动触发一轮（设置页的「现在开始」）
 *
 * 所有路由都过两层：回环检查 + DSH connection 的信任栅栏，失败时 fail-closed。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  DSH_HOME, PATHS, CFG_FILE, SECRETS_FILE,
  readConfig, writeConfig, deepMerge, sanitizeConfig,
  readSecrets, writeSecrets, secretState, SECRET_KEYS,
  ensureDataDirs, todayLocal, outputPaths,
} from './tools/lib/config.mjs'
import { paperStats, latestBrief } from './tools/lib/library.mjs'
import { readTopics, addTopic } from './tools/lib/topics.mjs'
import { ensureProtocol } from './tools/lib/protocol.mjs'
import { startScheduler } from './scheduler.js'
import { syncNativeSchedule, nativeTasks } from './tools/lib/native-schedule.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOOL = path.join(HERE, 'tools', 'sci.mjs')
const DEFAULT_SESSION_ID = 'dsh-sci'

function findNode() {
  const cands = [
    process.env.DSH_NODE,
    path.join(DSH_HOME, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node'),
    path.join(DSH_HOME, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
  ]
  for (const c of cands) {
    try { if (c && fs.existsSync(c)) return c } catch {}
  }
  return process.execPath
}

const NODE = findNode()
const NODE_ENV = () => ({
  ...process.env,
  DSH_HOME,
  DSH_SCI_HOME: PATHS.home,
  ...(NODE === process.execPath ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
})

function json(res, code, obj) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(obj))
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('请求体太大')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function runCli(args, timeout = 120_000) {
  return new Promise((resolve) => {
    execFile(NODE, [TOOL, ...args], {
      cwd: PATHS.home,
      env: NODE_ENV(),
      timeout,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err?.code ?? 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
        error: err ? String(err.message ?? err) : '',
      })
    })
  })
}

function isLoopback(req) {
  const raw = String(req.headers?.host ?? '').toLowerCase()
  let h = raw.replace(/:\d+$/, '')
  h = h.replace(/^\[|\]$/g, '')
  return h === '127.0.0.1' || h === 'localhost' || h === '::1'
}

export const name = 'dsh-sci'
export const inject = ['sessionController', 'webServer', 'connection', 'workspaceRegistry']

export function apply(ctx) {
  ensureDataDirs()
  try { ensureProtocol(TOOL) } catch (e) { console.warn('[dsh-sci] 写 TOOLING.md 失败：' + e.message) }

  function rejected(req, res) {
    if (!isLoopback(req)) {
      json(res, 403, { ok: false, error: '只接受本机回环访问' })
      return true
    }
    try {
      const conn = ctx.get('connection') ?? ctx.connection
      if (!conn || typeof conn.requestRejection !== 'function') {
        json(res, 503, { ok: false, error: '信任栅栏不可用，拒绝访问（fail-closed）' })
        return true
      }
      const code = conn.requestRejection(req)
      if (code === 401 || code === 403) {
        res.statusCode = code
        res.end()
        return true
      }
      return false
    } catch (e) {
      json(res, 503, { ok: false, error: '信任栅栏异常，拒绝访问（fail-closed）' })
      return true
    }
  }

  const disposers = []
  function route(pathname, handler) {
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: pathname,
      handler: async (req, res) => {
        if (rejected(req, res)) return
        try { await handler(req, res) } catch (e) {
          try { json(res, 500, { ok: false, error: String(e?.message ?? e) }) } catch {}
        }
      },
    }))
  }

  let sched = null
  let nativeSyncError = ''

  /* ── 配置 ─────────────────────────────────────────────────────────────── */

  route('/dsh-sci/api/settings', async (req, res) => {
    if (req.method === 'GET') {
      json(res, 200, {
        ok: true,
        config: readConfig(),
        secrets: secretState(),
        paths: { dataDir: PATHS.home, configFile: CFG_FILE, secretsFile: SECRETS_FILE, outputDir: outputPaths(readConfig()).root },
      })
      return
    }
    if (req.method !== 'POST') { json(res, 405, { ok: false, error: '只支持 GET/POST' }); return }
    const body = JSON.parse(await readBody(req) || '{}')
    const incoming = (body && typeof body.config === 'object' && body.config) || body || {}
    const merged = deepMerge(readConfig(), incoming)
    const clean = sanitizeConfig(merged)
    writeConfig(clean)
    let native = null
    try { native = await syncNativeSchedule(ctx, { toolPath: TOOL }) } catch (e) { native = { ok: false, error: String(e?.message ?? e) } }
    nativeSyncError = native?.ok === false ? (native.error || (native.errors ?? []).join('; ') || '自动化任务同步失败') : ''
    if (native?.tasks) native.tasks = native.tasks.map(({ prompt, ...rest }) => rest)
    json(res, 200, { ok: true, config: clean, secrets: secretState(), nativeSchedule: native, warn: null })
  })

  /* ── 密钥：只写、只返回“有没有” ─────────────────────────────────────── */

  route('/dsh-sci/api/secrets', async (req, res) => {
    if (req.method !== 'POST') { json(res, 405, { ok: false, error: '只支持 POST' }); return }
    const body = JSON.parse(await readBody(req) || '{}')
    const cur = readSecrets()
    const set = (body && typeof body.set === 'object' && body.set) || body || {}
    for (const k of SECRET_KEYS) {
      if (Object.prototype.hasOwnProperty.call(set, k) && typeof set[k] === 'string') {
        cur[k] = set[k].trim()
      }
    }
    for (const k of Array.isArray(body?.clear) ? body.clear : []) {
      if (k in cur) cur[k] = ''
    }
    writeSecrets(cur)
    json(res, 200, { ok: true, secrets: secretState() })
  })

  /* ── 体检 ─────────────────────────────────────────────────────────────── */

  route('/dsh-sci/api/deps', async (req, res) => {
    if (req.method !== 'GET') { json(res, 405, { ok: false, error: '只支持 GET' }); return }
    const r = await runCli(['deps', '--json'], 180_000)
    let parsed = null
    try { parsed = JSON.parse(r.stdout) } catch {}
    if (parsed) {
      json(res, 200, { ...parsed, nodePath: NODE, rawError: r.ok ? '' : r.error.slice(0, 300) })
    } else {
      json(res, 200, {
        ok: false,
        error: '体检没有返回 JSON',
        detail: (r.stderr || r.stdout || r.error).slice(0, 800),
        nodePath: NODE,
      })
    }
  })

  /* ── 研究课题 ─────────────────────────────────────────────────────────── */

  route('/dsh-sci/api/topics', async (req, res) => {
    if (req.method === 'GET') {
      json(res, 200, { ok: true, topics: readTopics() })
      return
    }
    if (req.method !== 'POST') { json(res, 405, { ok: false, error: '只支持 GET/POST' }); return }
    const body = JSON.parse(await readBody(req) || '{}')
    try {
      const topic = await addTopic({
        path: body.path ? String(body.path) : '',
        repo: body.repo ? String(body.repo) : '',
        title: body.title ? String(body.title) : '',
        keywords: Array.isArray(body.keywords) ? body.keywords.map(String) : [],
      })
      let queued = null
      try { queued = await sched?.triggerNow('topic') } catch {}
      json(res, 200, { ok: true, topic, queued, topics: readTopics() })
    } catch (e) {
      json(res, 400, { ok: false, error: String(e?.message ?? e) })
    }
  })

  /* ── 执行目标：会话 / 工作区（workspace）───────────────────────────────── */

  route('/dsh-sci/api/targets', async (req, res) => {
    if (req.method !== 'GET') { json(res, 405, { ok: false, error: '只支持 GET' }); return }
    const cfg = readConfig()
    let workspaces = []
    try {
      const reg = ctx.get('workspaceRegistry') ?? ctx.workspaceRegistry
      workspaces = (reg?.list?.() ?? []).map((w) => ({
        id: w.id, title: w.title, path: w.path,
        sessionIds: [...(w.sessionIds ?? [])],
      }))
    } catch {}
    let sessions = []
    try {
      const signal = new AbortController().signal
      const data = await ctx.sessionController.list({}, signal)
      sessions = await Promise.all((data.items ?? []).filter((x) => x.origin !== 'subagent').map(async (x) => {
        let title = typeof x.projections?.values?.title === 'string' ? x.projections.values.title : ''
        if (!title) {
          try {
            const p = await ctx.sessionController.projections({ sessionId: x.sessionId }, signal)
            const v = p?.kind === 'sequenced' ? p.values : p?.values
            if (typeof v?.title === 'string') title = v.title
          } catch {}
        }
        return {
          sessionId: x.sessionId, title, cwd: x.cwd ?? '', updatedAt: x.updatedAt ?? null,
          blank: Boolean(x.blank), running: Boolean(x.running),
        }
      }))
    } catch {}
    json(res, 200, {
      ok: true,
      workspaces,
      sessions,
      current: {
        sessionId: cfg.execution?.sessionId || DEFAULT_SESSION_ID,
        workspaceId: cfg.execution?.workspaceId || '',
      },
      defaultSessionId: DEFAULT_SESSION_ID,
    })
  })

  /* ── 状态 / 简报 ─────────────────────────────────────────────────────── */

  route('/dsh-sci/api/status', async (req, res) => {
    if (req.method !== 'GET') { json(res, 405, { ok: false, error: '只支持 GET' }); return }
    let stats = null
    try { stats = paperStats() } catch {}
    const brief = (() => { try { return latestBrief() } catch { return null } })()
    const cfg = readConfig()
    const out = outputPaths(cfg)
    const sessionId = cfg.execution?.sessionId || DEFAULT_SESSION_ID
    let native = []
    try { native = await nativeTasks(ctx) } catch {}
    json(res, 200, {
      ok: true,
      today: todayLocal(),
      stats,
      lastBrief: brief ? { date: brief.date, file: brief.file } : null,
      schedule: { mode: cfg.schedule.mode, times: cfg.schedule.times, days: cfg.schedule.days },
      nativeTasks: native.map(({ prompt, ...rest }) => rest),
      nativeSyncError,
      dataDir: PATHS.home,
      outputDir: out.root,
      outputs: out,
      configFile: CFG_FILE,
      sessionId,
      workspaceId: cfg.execution?.workspaceId || '',
      nodePath: NODE,
    })
  })

  route('/dsh-sci/api/brief', async (req, res) => {
    if (req.method !== 'GET') { json(res, 405, { ok: false, error: '只支持 GET' }); return }
    const brief = (() => { try { return latestBrief() } catch { return null } })()
    if (!brief) { json(res, 404, { ok: false, error: '还没有简报；先跑一轮或等下一次扫描' }); return }
    json(res, 200, { ok: true, brief: { date: brief.date, file: brief.file, text: brief.text.slice(0, 120_000) } })
  })

  /* ── 手动触发 ─────────────────────────────────────────────────────────── */

  route('/dsh-sci/api/run', async (req, res) => {
    if (req.method !== 'POST') { json(res, 405, { ok: false, error: '只支持 POST' }); return }
    if (!sched) { json(res, 503, { ok: false, error: '调度器未启动' }); return }
    const body = JSON.parse(await readBody(req) || '{}')
    const kind = ['scan', 'deep', 'review'].includes(body.kind) ? body.kind : 'scan'
    try {
      const out = await sched.triggerNow(kind)
      json(res, 200, { ok: true, ...out, message: `已在会话 ${out.sessionId || readConfig().execution?.sessionId || DEFAULT_SESSION_ID} 里排入一轮「${kind}」` })
    } catch (e) {
      json(res, 500, { ok: false, error: String(e?.message ?? e) })
    }
  })

  /* ── 启动调度器 ───────────────────────────────────────────────────────── */

  try {
    sched = startScheduler(ctx, {
      toolPath: TOOL,
      log: (m) => { try { console.log(m) } catch {} },
    })
  } catch (e) {
    try { console.warn('[dsh-sci] 调度器启动失败：' + e.message) } catch {}
  }
  try { fs.rmSync(path.join(PATHS.home, 'schedule.json'), { force: true }) } catch {}
  syncNativeSchedule(ctx, { toolPath: TOOL }).then((n) => { nativeSyncError = n?.ok === false ? (n.error || (n.errors ?? []).join('; ') || '自动化任务同步失败') : '' }).catch((e) => { nativeSyncError = String(e?.message ?? e); try { console.warn('[dsh-sci] 自动化任务同步失败：' + e.message) } catch {} })

  ctx.effect(() => () => {
    try { sched?.stop() } catch {}
    for (const d of disposers) { try { d() } catch {} }
  })

  try {
    console.log(`[dsh-sci] 已挂载 · 数据 ${PATHS.home} · 会话 ${readConfig().execution?.sessionId || DEFAULT_SESSION_ID} · node ${NODE}`)
  } catch {}
}
