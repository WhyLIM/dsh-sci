import { appendLog } from '../lib/config.mjs'
import { resolvePaper } from '../lib/paper.mjs'
import { savePaperRecord } from '../lib/library.mjs'
import { formatAuthors, typeLabel } from '../lib/normalize.mjs'
import { idLine, linksLine } from '../lib/format.mjs'

function inputOf(values, positionals) {
  if (values.id) return String(values.id)
  if (values.doi) return `doi:${values.doi}`
  if (values.arxiv) return `arxiv:${values.arxiv}`
  if (values.pmid) return `pmid:${values.pmid}`
  if (values.pmcid) return `pmcid:${values.pmcid}`
  if (values.openalex) return `openalex:${values.openalex}`
  if (positionals.length) return positionals.join(' ')
  return ''
}

export async function run({ values, positionals }) {
  const input = inputOf(values, positionals)
  if (!input) throw new Error('用法：paper --id doi:10.xxxx/xxxxx | --arxiv 2401.12345 | --pmid 12345678')
  const paper = await resolvePaper(input, { refresh: Boolean(values['no-cache']) })
  if (values.save) {
    const saved = savePaperRecord(paper)
    paper.key = saved.key
  }
  appendLog('paper', paper.title, { key: paper.key, doi: paper.doi, arxiv: paper.arxivId })
  if (values.json) {
    process.stdout.write(JSON.stringify({ ok: true, paper }, null, 2) + '\n')
    return 0
  }
  console.log(`# ${paper.title}\n`)
  console.log(`**作者**：${formatAuthors(paper.authors, 12)}`)
  console.log(`**发表**：${paper.venue || '未知'}${paper.year ? ` · ${paper.year}` : ''} · ${typeLabel(paper.evidenceType ?? paper.type)}`)
  if (idLine(paper)) console.log(`**标识**：${idLine(paper)}`)
  if (linksLine(paper)) console.log(`**链接**：${linksLine(paper)}`)
  console.log(`**开放获取**：${paper.isOA ? '是' : '否/未知'}${paper.hasFullText ? ' · 有全文/PMC' : ''}${paper.pdfUrl ? ' · 有 PDF 链接' : ''} · 引用 ${paper.citations ?? 0}`)
  if (paper.sources?.length) console.log(`**来源**：${paper.sources.join(' / ')}`)
  if (paper.pubTypes?.length) console.log(`**研究类型**：${paper.pubTypes.join(' / ')}`)
  if (paper.issn) console.log(`**ISSN**：${paper.issn}`)
  if (paper.trialIds?.length) console.log(`**注册号**：${paper.trialIds.join(' · ')}`)
  if (paper.mesh?.length) console.log(`**MeSH**：${paper.mesh.slice(0, 12).join(' / ')}`)
  if (paper.keywords?.length) console.log(`**关键词**：${paper.keywords.slice(0, 12).join(' / ')}`)
  if (paper.funding) console.log(`**资金**：${paper.funding}`)
  if (paper.coi) console.log(`**利益冲突**：${paper.coi}`)
  if (paper.corrections?.length) console.log(`**更正/撤稿关联**：${paper.corrections.map((c) => c.type || c.reference).filter(Boolean).join(' / ')}`)
  if (paper.retracted) console.log('\n> ⚠️ **撤稿/关注声明：这篇论文不应作为有效证据。**')
  if (paper.concern && !paper.retracted) console.log('> ⚠️ **Expression of Concern：引用前核对。**')
  if (paper.isPreprint) console.log('> 预印本：未经同行评审，不能作为临床疗效证据。')
  if (paper.key) console.log(`**key**：\`${paper.key}\``)
  console.log('\n## 摘要\n')
  console.log(paper.abstract || '（这条题录没有摘要。不要根据标题推断结论；可以尝试读全文或换一个源。）')
  if (!paper.isOA) console.log('\n> 非开放获取：只能读摘要。不要尝试绕过付费墙。')
  if (values.save) console.log(`\n已入库：\`${paper.key}\``)
  return 0
}
