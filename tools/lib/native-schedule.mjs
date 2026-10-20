/**
 * DSH 原生自动化任务同步。
 *
 * auto: 在目标会话里创建 weekly 任务，交给 DSH 的 schedule 服务投递；
 * manual: 删除本插件创建的所有原生任务；
 * plugin: 保留旧的内置 scheduler（仅作为高级回退，UI 不暴露）。
 */
import { PATHS, readConfig } from './config.mjs'
import { nativePrompt } from '../../scheduler.js'

const PREFIX = '[dsh-sci]'

function timezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai' } catch { return 'Asia/Shanghai' }
}

function targetOf(ctx, cfg) {
  const sessionId = cfg.execution?.sessionId || 'dsh-sci'
  let workspaceId = cfg.execution?.workspaceId || ''
  let cwd = PATHS.home
  let workspaceTitle = ''
  if (workspaceId) {
    try {
      const ws = (ctx.get('workspaceRegistry') ?? ctx.workspaceRegistry)?.get?.(workspaceId)
      if (ws?.path) { cwd = ws.path; workspaceTitle = ws.title || '' }
      else workspaceId = ''
    } catch { workspaceId = '' }
  }
  return { sessionId, workspaceId, workspaceTitle, cwd }
}

export async function nativeTasks(ctx) {
  const schedule = ctx.get('schedule') ?? ctx.schedule
  if (!schedule) return []
  try {
    const all = await schedule.catalog()
    return (all ?? []).filter((t) => String(t.title || '').startsWith(PREFIX))
  } catch { return [] }
}

export async function syncNativeSchedule(ctx, { toolPath = '' } = {}) {
  const cfg = readConfig()
  const schedule = ctx.get('schedule') ?? ctx.schedule
  if (!schedule) return { ok: false, mode: cfg.schedule.mode, error: 'schedule 服务不可用', tasks: [] }
  const target = targetOf(ctx, cfg)
  const existing = await nativeTasks(ctx)

  if (cfg.schedule.mode !== 'auto') {
    let deleted = 0
    for (const t of existing) {
      try { if ((await schedule.delete({ sessionId: t.sessionId, id: t.id }))?.deleted) deleted += 1 } catch {}
    }
    return { ok: true, mode: cfg.schedule.mode, deleted, created: 0, kept: 0, tasks: await nativeTasks(ctx) }
  }

  const tz = timezone()
  const days = [...new Set((cfg.schedule.days ?? []).map(Number).filter((d) => d >= 1 && d <= 7))].sort()
  const times = [...new Set((cfg.schedule.times ?? []).filter(Boolean))].sort()
  const prompt = nativePrompt(cfg, toolPath, target)
  const desired = times.map((time) => ({
    id: `${time}|${days.join(',')}|${tz}`,
    title: `${PREFIX} ${time} 科研`,
    time: /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time,
    timeZone: tz,
    weekdays: days.length ? days : [1, 2, 3, 4, 5],
    prompt,
  }))
  const same = (t, d) =>
    t?.sessionId === target.sessionId &&
    t?.title === d.title &&
    String(t?.time ?? '').slice(0, 8) === d.time.slice(0, 8) &&
    String(t?.timeZone ?? '') === d.timeZone &&
    JSON.stringify(t?.weekdays ?? []) === JSON.stringify(d.weekdays) &&
    String(t?.prompt ?? '') === d.prompt
  const keep = new Set()
  let deleted = 0
  for (const t of existing) {
    const match = desired.find((d) => same(t, d))
    if (match && !keep.has(match.id)) { keep.add(match.id); continue }
    try { if ((await schedule.delete({ sessionId: t.sessionId, id: t.id }))?.deleted) deleted += 1 } catch {}
  }
  try {
    await ctx.sessionController.create({ sessionId: target.sessionId, cwd: target.cwd, ...(target.workspaceId ? { workspaceId: target.workspaceId } : {}) })
  } catch {}

  let created = 0
  const errors = []
  for (const d of desired) {
    if (keep.has(d.id)) continue
    try {
      await schedule.create(target.sessionId, {
        title: d.title,
        prompt: d.prompt,
        weekly: { time: d.time, time_zone: d.timeZone, weekdays: d.weekdays },
      })
      created += 1
    } catch (e) {
      errors.push(`${d.title}: ${String(e?.message ?? e).slice(0, 160)}`)
    }
  }
  return { ok: errors.length === 0, mode: 'auto', sessionId: target.sessionId, timeZone: tz, deleted, created, kept: keep.size, errors, tasks: await nativeTasks(ctx) }
}
