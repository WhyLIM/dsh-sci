import { detectWorkflow, planWorkflow, checkTools, runWorkflow } from '../lib/workflow.mjs'

export async function run({ values, positionals }) {
  const sub = positionals[0] ?? 'inspect'
  const root = values.path ?? positionals[1]
  if (!root) throw new Error('用法：workflow inspect|validate|run --path <project-dir>')
  if (sub === 'inspect') {
    const d = detectWorkflow(root)
    if (values.json) process.stdout.write(JSON.stringify(d, null, 2) + '\n')
    else {
      console.log(`# workflow · ${d.root}`)
      console.log(`入口：${d.entries.map((e) => `${e.kind}:${e.file}`).join(' · ') || '未识别'}`)
      console.log(`环境文件：${d.env.join(', ') || '未识别'}`)
      console.log(`容器/依赖线索：${d.containers.join(', ') || '未识别'}`)
      for (const w of d.warnings) console.log(`⚠️ ${w}`)
    }
    return d.ok ? 0 : 1
  }
  const dryRun = values.execute ? false : true
  const plan = planWorkflow(root, {
    kind: values.kind ?? 'auto',
    dryRun,
    cores: values.cores ?? '1',
    profile: values.profile ?? '',
    timeout: values.timeout ?? '600',
  })
  if (sub === 'validate') {
    const checked = checkTools(plan)
    if (values.json) process.stdout.write(JSON.stringify(checked, null, 2) + '\n')
    else {
      console.log(`# ${plan.kind} · ${plan.entry}`)
      console.log(`命令：${plan.cmd} ${plan.args.join(' ')}`)
      console.log(`工具：${checked.toolAvailable ? '可用' : '缺失'} · ${JSON.stringify(checked.tools)}`)
      for (const w of checked.warnings) console.log(`⚠️ ${w}`)
    }
    return checked.toolAvailable ? 0 : 1
  }
  if (sub === 'run') {
    if (values.execute && !values.yes) throw new Error('实际执行需要 --execute --yes')
    const checked = checkTools(plan)
    if (plan.dryRun) {
      if (values.json) process.stdout.write(JSON.stringify({ ok: checked.toolAvailable, ...checked }, null, 2) + '\n')
      else {
        console.log(`# dry-run · ${plan.kind} · ${plan.entry}`)
        console.log(`将执行：${plan.cmd} ${plan.args.join(' ')}`)
        console.log(`工具：${checked.toolAvailable ? '可用' : '缺失'}`)
      }
      return checked.toolAvailable ? 0 : 1
    }
    const r = await runWorkflow(checked, { yes: values.yes, logDir: values['log-dir'] ?? '' })
    if (values.json) process.stdout.write(JSON.stringify(r, null, 2) + '\n')
    else {
      console.log(`退出码：${r.code}\n日志：${r.log}\n命令：${r.command}`)
      if (!r.ok) console.error(r.output)
    }
    return r.ok ? 0 : 1
  }
  throw new Error(`未知 workflow 子命令：${sub}。可用：inspect/validate/run`)
}
