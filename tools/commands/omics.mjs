import { inspectOmics } from '../lib/omics.mjs'

export async function run({ values, positionals }) {
  const sub = positionals[0] ?? 'inspect'
  const file = values.path ?? positionals[1]
  if (!file) throw new Error('用法：omics inspect <file|10x-dir> [--build GRCh38]')
  if (sub !== 'inspect' && sub !== 'validate') throw new Error(`未知 omics 子命令：${sub}`)
  const r = await inspectOmics(file, { expectedBuild: values.build ?? '' })
  if (values.json) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); return 0 }
  console.log(`# ${r.kind} · ${r.path}`)
  console.log(`大小：${r.size == null ? '目录' : `${(r.size / 1024 / 1024).toFixed(2)} MB`}${r.sha256 ? ` · sha256 ${r.sha256.slice(0, 16)}…` : ''}`)
  for (const [k, v] of Object.entries(r)) {
    if (['ok', 'kind', 'path', 'size', 'sha256', 'warnings', 'docs'].includes(k)) continue
    if (v == null || v === '') continue
    console.log(`${k}：${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : v}`)
  }
  if (r.warnings?.length) { console.log('\n## 警告'); for (const w of r.warnings) console.log(`- ${w}`) }
  return 0
}
