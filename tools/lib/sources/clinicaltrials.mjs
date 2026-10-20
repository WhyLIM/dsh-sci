/**
 * ClinicalTrials.gov API v2：临床问题的试验注册信息。
 * 只读公开注册数据；不把注册结果当成“已发表疗效证据”。
 */
import { httpJson } from '../http.mjs'

const API = 'https://clinicaltrials.gov/api/v2/studies'

function dateOfStruct(x) {
  return x?.date ?? ''
}

function parseStudy(s) {
  const p = s.protocolSection ?? {}
  const id = p.identificationModule ?? {}
  const status = p.statusModule ?? {}
  const design = p.designModule ?? {}
  const conditions = p.conditionsModule ?? {}
  const arms = p.armsInterventionsModule ?? {}
  const outcomes = p.outcomesModule ?? {}
  const eligibility = p.eligibilityModule ?? {}
  const sponsor = p.sponsorCollaboratorsModule ?? {}
  const desc = p.descriptionModule ?? {}
  return {
    nctId: id.nctId ?? '',
    title: id.briefTitle ?? id.officialTitle ?? '',
    officialTitle: id.officialTitle ?? '',
    status: status.overallStatus ?? '',
    studyType: design.studyType ?? '',
    phases: design.phases ?? [],
    enrollment: design.enrollmentInfo?.count ?? null,
    startDate: dateOfStruct(status.startDateStruct),
    completionDate: dateOfStruct(status.completionDateStruct),
    conditions: conditions.conditions ?? [],
    interventions: (arms.interventions ?? []).map((x) => ({ type: x.type ?? '', name: x.name ?? '' })),
    primaryOutcomes: (outcomes.primaryOutcomes ?? []).map((x) => ({
      measure: x.measure ?? '', description: x.description ?? '', timeFrame: x.timeFrame ?? '',
    })),
    secondaryOutcomes: (outcomes.secondaryOutcomes ?? []).map((x) => ({ measure: x.measure ?? '', timeFrame: x.timeFrame ?? '' })),
    sex: eligibility.sex ?? '',
    minimumAge: eligibility.minimumAge ?? '',
    maximumAge: eligibility.maximumAge ?? '',
    summary: desc.briefSummary ?? '',
    sponsor: sponsor.leadSponsor?.name ?? '',
    url: id.nctId ? `https://clinicaltrials.gov/study/${id.nctId}` : '',
  }
}

export async function searchTrials({ query, limit = 10, status = '', bypassCache = false } = {}) {
  const params = new URLSearchParams()
  params.set('query.term', String(query ?? '').trim())
  params.set('pageSize', String(Math.min(50, Math.max(1, limit))))
  params.set('fields', [
    'NCTId', 'BriefTitle', 'OfficialTitle', 'OverallStatus', 'StartDate', 'CompletionDate',
    'Phase', 'StudyType', 'EnrollmentCount', 'Condition', 'InterventionName', 'InterventionType',
    'PrimaryOutcomeMeasure', 'PrimaryOutcomeTimeFrame', 'Sex', 'MinimumAge', 'MaximumAge',
    'BriefSummary', 'LeadSponsorName',
  ].join(','))
  if (status) params.set('filter.overallStatus', status)
  try {
    const data = await httpJson(`${API}?${params.toString()}`, {
      cacheTtlMs: 60 * 60 * 1000,
      bypassCache,
    })
    const trials = (data.studies ?? []).map(parseStudy).filter((t) => t.nctId)
    return { trials, count: trials.length, total: data.totalCount ?? null, error: null, query: params.get('query.term') }
  } catch (e) {
    return { trials: [], count: 0, total: null, error: String(e?.message ?? e), query: String(query ?? '') }
  }
}

export async function getTrial(nctId, { bypassCache = false } = {}) {
  const id = String(nctId ?? '').trim().toUpperCase()
  if (!/^NCT\d{8}$/.test(id)) throw new Error(`不是 NCT 号：${nctId}`)
  const params = new URLSearchParams({ fields: [
    'NCTId', 'BriefTitle', 'OfficialTitle', 'OverallStatus', 'StartDate', 'CompletionDate',
    'Phase', 'StudyType', 'EnrollmentCount', 'Condition', 'InterventionName', 'InterventionType',
    'PrimaryOutcomeMeasure', 'PrimaryOutcomeTimeFrame', 'SecondaryOutcomeMeasure',
    'Sex', 'MinimumAge', 'MaximumAge', 'BriefSummary', 'LeadSponsorName', 'EligibilityCriteria',
  ].join(',') })
  const data = await httpJson(`${API}/${encodeURIComponent(id)}?${params.toString()}`, {
    cacheTtlMs: 24 * 60 * 60 * 1000,
    bypassCache,
  })
  return parseStudy(data)
}
