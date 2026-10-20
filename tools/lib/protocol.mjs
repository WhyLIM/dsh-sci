/**
 * 科研协议：把“怎么做研究”写成 agent 在会话里能读到的项目说明。
 *
 * AGENTS.md 只在第一次创建时写入，之后用户/agent 可以自己改；
 * TOOLING.md 每次启动覆盖，保证工具绝对路径永远是最新的。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { PATHS, CFG_FILE, outputPaths, ensureDataDirs, atomicWrite } from './config.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE = path.resolve(HERE, '..', '..', 'templates', 'AGENTS.md')
// 旧版通用协议（v1）的哈希：只更新“原封未动”的旧文件，用户改过的不覆盖。
const LEGACY_HASHES = new Set([
  '1092defe8d6d7b7a304264994cafa597e142222de60b338bf63394eb60bd95aa', // v1 generic
  '5c95db979bed02e61abb02644a8c7621ab30625d400ff76f351514de88982d36', // v2 biomedical, before EoC/guidelines
  '107cf485afc9b2e81179a23dce89d4b8f05620bb320c38b1661f74c7f8ba41c8', // v3, before topics/output/execution
  '13c065b92cba6e240be27fd719d43faaf05d73ed8b99f81ac9571818fbd54086', // v4, before database lookup
  '19c73a1106f58d1ed7a873c05769801c25cd50a999b0d3d93388ff2be5157d28', // v5, before computational workflow
  'ea0d6600b3fb84d5797d2f305283ec7a3618e970cb399ae52701bcabcc8d9826', // v6, before database grounding
])

export function ensureProtocol(toolPath) {
  ensureDataDirs()
  if (fs.existsSync(TEMPLATE)) {
    try {
      const tpl = fs.readFileSync(TEMPLATE)
      let replace = !fs.existsSync(PATHS.protocol)
      if (!replace) {
        const cur = fs.readFileSync(PATHS.protocol)
        const hash = crypto.createHash('sha256').update(cur).digest('hex')
        replace = LEGACY_HASHES.has(hash)
      }
      if (replace) fs.writeFileSync(PATHS.protocol, tpl)
    } catch {}
  }
  const out = outputPaths()
  const tooling = `# 当前工具入口（自动生成，每次启动覆盖）

- 数据目录：\`${PATHS.home}\`
- 输出目录：\`${out.root}\`
- CLI：\`node "${toolPath}"\`
- 配置：\`${CFG_FILE}\`
- 笔记：\`${out.notes}\`
- 图片：\`${PATHS.figures}\`
- 检索策略：\`${out.searches}\`
- 简报：\`${out.briefs}\`
- 周总结：\`${out.reviews}\`
- 导出：\`${out.exports}\`
- 文献库：\`${PATHS.papers}\`

在 bash 里先 \`cd "${PATHS.home}"\`，再执行下面的命令；路径里有空格时保留引号。

\`\`\`bash
node "${toolPath}" deps --json
node "${toolPath}" brief --save
node "${toolPath}" read --id doi:10.xxxx/xxxxx --outline
node "${toolPath}" read --id doi:10.xxxx/xxxxx --tables
node "${toolPath}" read --id doi:10.xxxx/xxxxx --section methods
node "${toolPath}" read --id doi:10.xxxx/xxxxx --figures
node "${toolPath}" note new --id doi:10.xxxx/xxxxx
node "${toolPath}" related --id doi:10.xxxx/xxxxx
node "${toolPath}" trials --query "disease AND intervention"
node "${toolPath}" guidelines --query "disease"
node "${toolPath}" pubmed-fields
node "${toolPath}" pubmed-query --query "heart attack" --journal "N Engl J Med" --pt "Randomized Controlled Trial"
node "${toolPath}" export --all --format ris
node "${toolPath}" watch
node "${toolPath}" topic pending
node "${toolPath}" topic add --path /path/to/project
node "${toolPath}" topic list
node "${toolPath}" db list
node "${toolPath}" db info uniprot
node "${toolPath}" db search uniprot "gene:TP53 AND organism_id:9606" --limit 5
node "${toolPath}" db get uniprot P04637
node "${toolPath}" entity query gene TP53 --species human
node "${toolPath}" dataset search "BRCA1" --species human
node "${toolPath}" accession GSE328618
node "${toolPath}" omics inspect /path/to/file.vcf --build GRCh38
node "${toolPath}" enrich --id doi:10.xxxx/xxxxx --genes TP53,BRCA1 --species human
node "${toolPath}" repro --id doi:10.xxxx/xxxxx
node "${toolPath}" qc --id doi:10.xxxx/xxxxx
node "${toolPath}" benchmark --id doi:10.xxxx/xxxxx
node "${toolPath}" graph build
node "${toolPath}" methods draft --id doi:10.xxxx/xxxxx
node "${toolPath}" compliance --id doi:10.xxxx/xxxxx
node "${toolPath}" note set --id doi:10.xxxx/xxxxx --status read --rating 4
node "${toolPath}" library list
\`\`\`
`
  const toolingFile = path.join(PATHS.home, 'TOOLING.md')
  try { atomicWrite(toolingFile, tooling) } catch {}
  return { protocol: PATHS.protocol, tooling: toolingFile }
}
