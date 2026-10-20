/** 检索词隐私：只在日志/策略里脱敏，不改变真正发给 API 的查询。 */
export function redactPHI(text) {
  let s = String(text ?? '')
  s = s.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
  s = s.replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '[number]' : m))
  s = s.replace(/\b(MRN|Patient\s*ID|病历号|住院号|患者编号|身份证号)\s*[:：]?\s*[A-Z0-9-]{4,}/gi, '$1 [redacted]')
  return s
}

export function queryForLog(query, cfg) {
  const privacy = cfg?.privacy ?? {}
  if (privacy.logQueries === false) return '[query not logged]'
  return privacy.redactQueries === false ? String(query ?? '') : redactPHI(query)
}
