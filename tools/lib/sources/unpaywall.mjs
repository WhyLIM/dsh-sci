/**
 * Unpaywall：用 DOI 找合法开放版本。需要邮箱（免费），没有邮箱就跳过。
 * 只返回出版社/仓库提供的 OA 链接，不做任何绕过付费墙的尝试。
 */
import { httpJson } from '../http.mjs'
import { normalizeDoi } from '../config.mjs'

export async function unpaywall(doi, email) {
  const d = normalizeDoi(doi)
  if (!d || !email) return null
  try {
    const data = await httpJson(`https://api.unpaywall.org/v2/${encodeURIComponent(d)}?email=${encodeURIComponent(email)}`, {
      cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
    })
    if (!data?.is_oa) return { isOA: false, pdfUrl: '', htmlUrl: '', license: '', host: '' }
    const best = data.best_oa_location ?? (data.oa_locations ?? [])[0] ?? {}
    return {
      isOA: true,
      pdfUrl: best.url_for_pdf ?? '',
      htmlUrl: best.url ?? best.url_for_landing_page ?? '',
      license: best.license ?? '',
      host: best.host_type ?? '',
      version: best.version ?? '',
      oaStatus: data.oa_status ?? '',
    }
  } catch {
    return null
  }
}
