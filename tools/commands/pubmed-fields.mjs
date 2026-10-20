import { listPubmedFields, COMMENT_CORRECTION_FILTERS } from '../lib/sources/pubmed-fields.mjs'

export async function run({ values }) {
  const fields = listPubmedFields()
  if (values.json) {
    process.stdout.write(JSON.stringify({ ok: true, fields, commentCorrectionFilters: COMMENT_CORRECTION_FILTERS }, null, 2) + '\n')
    return 0
  }
  console.log(`# PubMed 搜索字段（${fields.length} 个）\n`)
  let group = ''
  for (const f of fields.sort((a, b) => a.group.localeCompare(b.group, 'zh'))) {
    if (f.group !== group) { group = f.group; console.log(`\n## ${group}`) }
    console.log(`- [${f.tag}] ${f.name}${f.example ? ` — e.g. \`${f.example}\`` : ''}`)
  }
  console.log('\n## 评论/更正特殊检索词')
  for (const [label, q] of COMMENT_CORRECTION_FILTERS) console.log(`- ${label}: \`${q}\``)
  console.log('\n> 完整说明：https://pubmed.ncbi.nlm.nih.gov/help/#using-search-field-tags')
  return 0
}
