import { DATABASES, getDatabase, listDatabases, databaseSearch, databaseGet, databaseDoc, databaseHelp, databaseProvenance } from '../lib/databases.mjs'
import { intArg } from '../lib/util.mjs'

const DOMAINS = {
  gene: '基因/基因组', protein: '蛋白/结构', variant: '变异', disease: '疾病/表型',
  pathway: '通路/互作', expression: '表达/组学', chemistry: '化学/药物', cancer: '癌症',
  clinical: '临床', plasmid: '质粒',
}

function compact(v, max = 220) {
  if (v == null) return ''
  if (typeof v === 'string') return v.length > max ? v.slice(0, max) + '…' : v
  if (Array.isArray(v)) return v.slice(0, 5).map((x) => compact(x, 60)).join('; ')
  if (typeof v === 'object') return compact(Object.entries(v).slice(0, 5).map(([k, x]) => `${k}=${compact(x, 50)}`).join(' '), max)
  return String(v)
}

export async function run({ values, positionals }) {
  const sub = positionals[0] ?? 'list'
  if (sub === 'list' || sub === 'ls') {
    const list = listDatabases({ domain: values.domain })
    if (values.json) { process.stdout.write(JSON.stringify({ ok: true, databases: list }, null, 2) + '\n'); return 0 }
    console.log(`# 生物信息学数据库（${list.length}）\n`)
    for (const domain of Object.keys(DOMAINS)) {
      const rows = list.filter((d) => d.domain === domain)
      if (!rows.length) continue
      console.log(`## ${DOMAINS[domain]}`)
      for (const d of rows) console.log(`- ${d.executable ? '✓' : '○'} **${d.id}** ${d.name} · ${d.auth}${d.executable ? '' : ' · 需参考文档/授权'}`)
      console.log('')
    }
    console.log('✓ = 可直接 db search/get；○ = 目录/参考文档，需 key、登录或尚未接入自动查询。')
    return 0
  }

  const dbId = values.db ?? positionals[1]
  if (!dbId) throw new Error('用法：db info <db> 或 db search <db> "query" 或 db get <db> <id>')
  const db = getDatabase(dbId)
  if (!db) throw new Error(`未知数据库：${dbId}。先跑 db list。`)

  if (sub === 'info' || sub === 'show') {
    const info = databaseHelp(dbId)
    if (values.json) { process.stdout.write(JSON.stringify({ ok: true, database: info }, null, 2) + '\n'); return 0 }
    console.log(`# ${db.name} (${db.id})`)
    console.log(`领域：${db.domainName}`)
    console.log(`认证：${db.auth}`)
    console.log(`自动查询：${info.executable ? '支持' : '暂不支持（见参考文档/授权）'}`)
    console.log(`端点：${db.url}`)
    console.log(`说明：${db.note}`)
    console.log(`本地参考：${db.doc}`)
    const doc = await databaseDoc(dbId)
    if (doc) console.log(`\n${doc.slice(0, 5000)}`)
    return 0
  }

  if (sub === 'doc' || sub === 'docs') {
    const doc = await databaseDoc(dbId)
    process.stdout.write(doc || `（没有 ${dbId} 的本地参考）\n`)
    return 0
  }

  const opts = {
    limit: intArg(values.limit, 10, 1, 50),
    page: intArg(values.page, 1, 1, 1000),
    species: values.species ?? '',
    build: values.build ?? '',
    dataset: values.dataset ?? '',
    action: values.action ?? '',
    score: intArg(values.score, 700, 0, 1000),
    cutoff: intArg(values.cutoff, 1000, 1, 100000),
    catalog: values.catalog ?? '',
  }
  const query = values.query ?? positionals[2] ?? ''
  const identifier = values.id ?? positionals[2] ?? ''
  if (sub === 'search' || sub === 'query' || sub === 'lookup') {
    if (!query) throw new Error('db search 需要查询词')
    if (values.all) {
      if (!['chebi', 'dailymed'].includes(db.id)) throw new Error('--all 目前只支持 chebi / dailymed；其他库的翻页语义未确认')
      const first = await databaseSearch(dbId, query, { ...opts, page: 1 })
      if (!first.ok) { console.error(`✗ ${first.error}`); return 1 }
      const seen = new Set()
      const items = []
      let pages = 1
      let total = first.total ?? 0
      const add = (x) => {
        const k = JSON.stringify(x)
        if (seen.has(k)) return false
        seen.add(k); items.push(x); return true
      }
      for (const x of first.items ?? []) add(x)
      const maxPages = Math.min(100, Math.max(1, Math.ceil((total || items.length) / opts.limit)))
      for (let page = 2; page <= maxPages && items.length < 10_000; page++) {
        const r = await databaseSearch(dbId, query, { ...opts, page })
        if (!r.ok) break
        pages += 1
        let added = 0
        for (const x of r.items ?? []) if (add(x)) added += 1
        if (!added) break
      }
      const warning = items.length >= 10_000 ? '达到 10000 条上限，未继续分页' : (pages >= maxPages && items.length < total ? `只取了前 ${pages} 页（共 ${total} 条）；达到页数上限` : '')
      const result = { ok: true, db: db.id, mode: 'search', query, total, pages, items, checkedAt: new Date().toISOString(), warning }
      if (values.json) { process.stdout.write(JSON.stringify({ ...result, provenance: databaseProvenance(db, { ...opts, query, page: null }) }, null, 2) + '\n'); return 0 }
      console.log(`# ${db.name} · all pages · ${query}`)
      console.log(`来源：${databaseProvenance(db, { ...opts, query }).endpoint} · 页数：${pages} · 条数：${items.length}/${total}`)
      for (const [i, item] of items.entries()) console.log(`\n${i + 1}. ${compact(item, 500)}`)
      if (result.warning) console.log(`\n⚠️ ${result.warning}`)
      return 0
    }
    const result = await databaseSearch(dbId, query, opts)
    if (values.json) { process.stdout.write(JSON.stringify({ ...result, provenance: databaseProvenance(db, { ...opts, query }) }, null, 2) + '\n'); return result.ok ? 0 : 1 }
    if (!result.ok) { console.error(`✗ ${result.error}`); return 1 }
    console.log(`# ${db.name} · ${result.mode} · ${query}${opts.page > 1 ? ` · 第 ${opts.page} 页` : ''}`)
    console.log(`来源：${databaseProvenance(db, { ...opts, query }).endpoint} · 访问：${result.checkedAt ?? new Date().toISOString()}`)
    if (result.total != null) console.log(`命中：${result.total}`)
    if (result.gene) console.log(`基因：${compact(result.gene)}`)
    for (const [i, item] of (result.items ?? []).entries()) {
      console.log(`\n${i + 1}. ${compact(item, 500)}`)
    }
    if (!(result.items ?? []).length) console.log('（没有结果；检查物种/基因组版本/标识符）')
    return 0
  }
  if (sub === 'get' || sub === 'fetch') {
    if (!identifier) throw new Error('db get 需要标识符')
    const result = await databaseGet(dbId, identifier, opts)
    if (values.json) { process.stdout.write(JSON.stringify({ ...result, provenance: databaseProvenance(db, { ...opts, id: identifier }) }, null, 2) + '\n'); return result.ok ? 0 : 1 }
    if (!result.ok) { console.error(`✗ ${result.error}`); return 1 }
    console.log(`# ${db.name} · ${result.mode} · ${identifier}`)
    console.log(`来源：${databaseProvenance(db, { ...opts, id: identifier }).endpoint} · 访问：${result.checkedAt ?? new Date().toISOString()}`)
    for (const [i, item] of (result.items ?? []).entries()) console.log(`\n${i + 1}. ${compact(item, 1200)}`)
    return 0
  }
  throw new Error(`未知 db 子命令：${sub}。可用：list/info/doc/search/get`)
}
