/**
 * 小 HTTP 客户端：限速、重试、磁盘缓存。
 *
 * 为什么不用依赖：这个插件要能在一个干净的 DSH 里直接跑，不能要求用户先 npm install。
 * 为什么缓存：OpenAlex 免费额度按网络出口算，arXiv 也有礼貌抓取要求；同一轮扫描里
 * 多个命令会重复查同一篇论文，缓存能把请求数压下来。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import net from 'node:net'
import { PATHS, contactEmail, readConfig } from './config.mjs'

const UA = () => {
  const email = contactEmail()
  return `dsh-sci/0.2 (${email ? 'mailto:' + email : 'local research assistant'})`
}

const HOST_INTERVAL = {
  'export.arxiv.org': 3200,
  'arxiv.org': 3200,
  'api.openalex.org': 350,
  'api.crossref.org': 350,
  'www.ebi.ac.uk': 250,
  'eutils.ncbi.nlm.nih.gov': 400,
  'api.unpaywall.org': 400,
  'api.semanticscholar.org': 1200,
}

const lastHit = new Map()

async function throttle(url) {
  let host = ''
  try {
    host = new URL(url).host
  } catch {}
  const ncbiKeyed = host === 'eutils.ncbi.nlm.nih.gov' && /[?&]api_key=[^&]+/.test(url)
  const gap = ncbiKeyed ? 110 : (HOST_INTERVAL[host] ?? 250)
  const prev = lastHit.get(host) ?? 0
  const wait = prev + gap - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastHit.set(host, Date.now())
}

function cachePath(url, extra = '') {
  const h = crypto.createHash('sha1').update(url + '\n' + extra).digest('hex')
  return path.join(PATHS.cache, `${h}.json`)
}

function readCache(file, ttlMs) {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!c?.at || Date.now() - c.at > ttlMs) return null
    return c
  } catch {
    return null
  }
}

function writeCache(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(value))
  } catch {}
}

/**
 * GET 文本。默认缓存 6 小时；传 cacheTtlMs: 0 关闭缓存。
 * @returns {Promise<{body:string,status:number,headers:Headers,fromCache:boolean,url:string}>}
 */
export async function httpGet(url, {
  headers = {},
  timeoutMs = 30_000,
  retries = 2,
  cacheTtlMs = 6 * 60 * 60 * 1000,
  cacheKey = '',
  bypassCache = false,
} = {}) {
  const file = cachePath(url, cacheKey || JSON.stringify(headers))
  if (!bypassCache && cacheTtlMs > 0) {
    const hit = readCache(file, cacheTtlMs)
    if (hit) return { ...hit, fromCache: true, url }
  }

  let lastErr = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await throttle(url)
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': UA(),
          accept: 'application/json, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
          ...headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      })
      const body = await res.text()
      if (res.ok) {
        const value = { at: Date.now(), status: res.status, body, headers: Object.fromEntries(res.headers.entries()) }
        if (cacheTtlMs > 0) writeCache(file, value)
        return { ...value, fromCache: false, url }
      }
      const snippet = body.replace(/\s+/g, ' ').slice(0, 240)
      lastErr = new Error(`HTTP ${res.status} ${url}${snippet ? ' — ' + snippet : ''}`)
      lastErr.status = res.status
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after'))
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 4000 * (attempt + 1)
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, Math.min(wait, 20_000)))
          continue
        }
      }
      if (res.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)))
        continue
      }
      throw lastErr
    } catch (e) {
      lastErr = e
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        lastErr = new Error(`请求超时（${Math.round(timeoutMs / 1000)}s）：${url}`)
      }
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)))
        continue
      }
    }
  }
  throw lastErr ?? new Error(`请求失败：${url}`)
}

export async function httpJson(url, opts = {}) {
  const res = await httpGet(url, opts)
  try {
    const parsed = JSON.parse(res.body)
    const meta = { status: res.status, fromCache: res.fromCache, url }
    if (Array.isArray(parsed)) {
      parsed.__http = meta
      return parsed
    }
    return { ...parsed, __http: meta }
  } catch {
    throw new Error(`返回的不是 JSON：${url} — ${res.body.slice(0, 160)}`)
  }
}

export async function httpPostJson(url, payload, {
  headers = {},
  timeoutMs = 45_000,
  retries = 1,
} = {}) {
  let lastErr = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await assertPublicUrl(url)
    await throttle(url)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'user-agent': UA(),
          accept: 'application/json',
          'content-type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      })
      const body = await res.text()
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url} — ${body.slice(0, 180)}`)
      try {
        const parsed = JSON.parse(body)
        const meta = { status: res.status, url }
        if (Array.isArray(parsed)) { parsed.__http = meta; return parsed }
        return { ...parsed, __http: meta }
      } catch {
        throw new Error(`返回的不是 JSON：${url} — ${body.slice(0, 160)}`)
      }
    } catch (e) {
      lastErr = e
      if (attempt < retries) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)))
    }
  }
  throw lastErr
}

export async function httpBuffer(url, {
  timeoutMs = 120_000,
  maxBytes = 80 * 1024 * 1024,
  headers = {},
  retries = 1,
} = {}) {
  let lastErr = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let current = url
    try {
      for (let hop = 0; hop <= 5; hop += 1) {
        await assertPublicUrl(current)
        await throttle(current)
        const res = await fetch(current, {
          headers: { 'user-agent': UA(), accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1', ...headers },
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'manual',
        })
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location')
          if (!loc) throw new Error(`重定向没有 Location：${current}`)
          current = new URL(loc, current).toString()
          continue
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} ${current}`)
        const len = Number(res.headers.get('content-length') ?? 0)
        if (len && len > maxBytes) throw new Error(`文件太大（${Math.round(len / 1e6)} MB，上限 ${Math.round(maxBytes / 1e6)} MB）`)
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length > maxBytes) throw new Error(`文件太大（${Math.round(buf.length / 1e6)} MB）`)
        return buf
      }
      throw new Error(`重定向过多：${url}`)
    } catch (e) {
      lastErr = e
      if (attempt < retries) await new Promise((r) => setTimeout(r, 800))
    }
  }
  throw lastErr
}


/* ── 只允许公网 HTTP(S)：OA 链接来自第三方 API，不能让它把请求引到内网 ── */

function privateIp(ip) {
  const kind = net.isIP(ip)
  if (kind === 4) {
    const p = ip.split('.').map(Number)
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true
    if (p[0] === 169 && p[1] === 254) return true
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
    if (p[0] === 192 && p[1] === 168) return true
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true
    if (p[0] >= 224) return true
    // 198.18.0.0/15 是 RFC 2544 基准测试网段；本机网络代理会把公网域名解析到这里。
    // 不把它当内网，否则在代理环境下所有 OA PDF 都会被误拒。
    return false
  }
  if (kind === 6) {
    const s = ip.toLowerCase()
    if (s === '::1' || s === '::') return true
    if (s.startsWith('fe80') || s.startsWith('fc') || s.startsWith('fd')) return true
    if (s.startsWith('::ffff:')) return privateIp(s.slice(7))
    return false
  }
  return true
}

export async function assertPublicUrl(raw) {
  let u
  try { u = new URL(raw) } catch { throw new Error(`非法链接：${raw}`) }
  if (!/^https?:$/.test(u.protocol)) throw new Error(`只允许 http(s) 链接：${raw}`)
  if (u.username || u.password) throw new Error('链接里不允许带用户名/密码')
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host === 'metadata.google.internal') {
    throw new Error(`拒绝访问内网地址：${host}`)
  }
  if (net.isIP(host)) {
    if (privateIp(host)) throw new Error(`拒绝访问内网地址：${host}`)
    return u
  }
  let addrs = []
  try { addrs = await dns.lookup(host, { all: true }) } catch { throw new Error(`域名解析失败：${host}`) }
  if (!addrs.length) throw new Error(`域名没有地址：${host}`)
  if (addrs.some((a) => privateIp(a.address))) throw new Error(`域名解析到内网地址：${host}`)
  return u
}

/** 探测一个 URL 是否可访问（只取头部/少量字节，不下载全文）。 */
export async function probe(url, timeoutMs = 12_000) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'user-agent': UA(), range: 'bytes=0-512' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    })
    return { ok: res.ok || res.status === 206, status: res.status }
  } catch (e) {
    return { ok: false, status: 0, error: String(e?.message ?? e) }
  }
}

export function contact() {
  return contactEmail() || readConfig().sources.email || ''
}
