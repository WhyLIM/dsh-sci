import fs from 'node:fs'
import path from 'node:path'
import { loadPaper, outputPaths, paperKey, readConfig } from '../lib/config.mjs'
import { readNote } from '../lib/library.mjs'
import { resolvePaper } from '../lib/paper.mjs'
import { validateMethods, journalFormat } from '../lib/methods.mjs'

function draft(paper, note, format = 'generic') {
  const r = paper.repro ?? {}
  const noteText = note?.text ?? ''
  const sections = []
  const m = noteText.match(/##\s*方法与数据\n([\s\S]*?)(?=\n##\s|$)/i)
  if (m) sections.push(m[1].trim())
  const pico = noteText.match(/##\s*PICO \/ 研究问题\n([\s\S]*?)(?=\n##\s|$)/i)
  const text = `# Methods draft — ${paper.title ?? 'Untitled'}

> 这是从题录/笔记/可复现性线索生成的结构化草稿，不是可直接投稿的 Methods。每个空位都要人工核对。

## Study design

- 研究类型：${paper.evidenceType ?? paper.design ?? '未记录'}
- 物种/人群/数据集：${paper.organism ?? '未记录'}
- 研究问题：${pico ? pico[1].trim().split('\n').filter(Boolean).slice(0, 4).join('；') : '未记录'}

## Data

- 数据来源 / accession：${(r.accessions ?? []).map((x) => `${x.db}:${x.id}`).join(', ') || '未记录'}
- 样本量 / 纳入排除：未记录
- 参考基因组 / 数据库版本：未记录
- 受控/伦理数据：${(r.controlled ?? []).join(', ') || '未识别'}

## Methods

${sections.join('\n\n') || '- 关键步骤：\n- 参数：\n- 版本：\n- 随机种子：'}

## Code and reproducibility

- 代码仓库：${(r.codeUrls ?? []).join(', ') || '未记录'}
- 环境 / 容器 / commit：未记录
- 可复现性静态检查：${r.level ? `${r.level}（${r.score}/100）` : '未检查'}

## Limitations

- 作者承认的局限：
- 额外方法学风险：
- 不能外推的范围：

## Checklist

- [ ] 数据 accession 与版本已核对
- [ ] 代码/容器/commit 可访问
- [ ] 参考基因组/数据库版本明确
- [ ] 统计模型与多重检验明确
- [ ] 受控数据授权已确认
`
  return journalFormat(text, format)
}

export async function run({ values, positionals }) {
  const sub = positionals[0] ?? 'draft'
  const id = values.id ?? positionals[1]
  if (!id) throw new Error('用法：methods draft --id <paper> [--save]')
  const paper = loadPaper(id) ?? await resolvePaper(id)
  const note = readNote(paper.key ?? paperKey(paper))
  const text = draft(paper, note, values.format ?? 'generic')
  if (sub === 'validate') {
    const v = validateMethods(text)
    if (values.json) process.stdout.write(JSON.stringify({ ok: v.confidence !== 'none', validation: v }, null, 2) + '\n')
    else {
      console.log(`Methods 校验：confidence=${v.confidence} · 占位符=${v.placeholders}`)
      for (const w of v.warnings) console.log(`⚠️ ${w}`)
      console.log(`> ${v.note}`)
    }
    return v.confidence === 'none' ? 1 : 0
  }
  if (sub === 'save' || values.save) {
    const out = outputPaths(readConfig()).methods
    fs.mkdirSync(out, { recursive: true })
    const file = path.join(out, `${paper.key ?? paperKey(paper)}.md`)
    fs.writeFileSync(file, text)
    console.log(`已写入：${file}`)
    return 0
  }
  process.stdout.write(text)
  return 0
}
