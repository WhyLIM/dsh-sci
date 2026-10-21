import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

import {
  invertedToText, normalizeTitle, titleKey, dedupePapers, scorePaper,
  normalizePaper, paperType, cleanAbstract,
} from '../tools/lib/normalize.mjs'
import { sanitizeConfig, DEFAULTS, paperKey, outputPaths } from '../tools/lib/config.mjs'
import { parseFrontmatter, formatFrontmatter } from '../tools/lib/library.mjs'
import { headingInfo, splitSections, chunkSections, tablesFromPmcXml, figuresFromPmcXml } from '../tools/lib/fulltext.mjs'
import { classifyInput } from '../tools/lib/paper.mjs'
import { buildPubmedQuery } from '../tools/lib/sources/pubmed.mjs'
import { noteScaffold } from '../tools/lib/library.mjs'
import { toBibtex } from '../tools/lib/exporters.mjs'
import { redactPHI } from '../tools/lib/privacy.mjs'
import { DATABASES, getDatabase, databaseHelp, normalizeClinpgx, normalizeChebiDoc, normalizeChebiCompound, normalizeDailymed } from '../tools/lib/databases.mjs'
import { PUBMED_FIELDS, normalizePubmedQuery } from '../tools/lib/sources/pubmed-fields.mjs'
import { extractRepro } from '../tools/lib/repro.mjs'
import { qcText } from '../tools/lib/qc.mjs'
import { detectAccession } from '../tools/lib/entities.mjs'
import { extractBenchmark } from '../tools/lib/benchmark.mjs'
import { inspectOmics } from '../tools/lib/omics.mjs'
import { extractCandidates } from '../tools/lib/annotations.mjs'

test('inverted abstract reconstructs in position order', () => {
  const s = invertedToText({ Protein: [0], models: [1], learn: [2], structure: [3] })
  assert.equal(s, 'Protein models learn structure')
})

test('title normalization removes punctuation/case', () => {
  assert.equal(normalizeTitle('Attention Is All You Need!'), 'attention is all you need')
  assert.equal(titleKey('A  B'), 'ab')
})

test('dedupe merges same DOI and keeps longest abstract', () => {
  const a = normalizePaper({ doi: '10.1/x', title: 'Paper', abstract: 'short', sources: ['openalex'] })
  const b = normalizePaper({ doi: '10.1/X', title: 'Paper', abstract: 'a much longer abstract', sources: ['europepmc'], citations: 5 })
  const out = dedupePapers([a, b])
  assert.equal(out.length, 1)
  assert.equal(out[0].abstract, 'a much longer abstract')
  assert.equal(out[0].citations, 5)
  assert.deepEqual(out[0].sources.sort(), ['europepmc', 'openalex'])
})

test('repository venues are not labelled journal articles', () => {
  const p = normalizePaper({ title: 'A preprint', venue: 'bioRxiv', doi: '10.1101/2020.01.01.1' })
  assert.equal(p.type, 'preprint')
})

test('retracted papers are detected and denied evidence status', () => {
  const p = normalizePaper({ title: 'A retracted trial', pubTypes: ['Retracted Publication', 'Randomized Controlled Trial'], corrections: [{ type: 'Retraction in', reference: '...' }] })
  assert.equal(p.retracted, true)
  assert.equal(p.evidenceType, 'retraction')
  assert.equal(p.type, 'retraction')
  const s = scorePaper(p, { keywords: [], methods: [], exclude: [] })
  assert.ok(s.score < 0)
})

test('study design classification and preprint policy', () => {
  assert.equal(normalizePaper({ title: 'X', pubTypes: ['Randomized Controlled Trial'] }).evidenceType, 'rct')
  assert.equal(normalizePaper({ title: 'X', pubTypes: ['Systematic Review'] }).evidenceType, 'systematic-review')
  assert.equal(normalizePaper({ title: 'X', pubTypes: ['Guideline'] }).evidenceType, 'guideline')
  assert.equal(normalizePaper({ title: 'X', venue: 'medRxiv', doi: '10.1101/2026.01.01.1' }).evidenceType, 'preprint')
  assert.equal(normalizePaper({ title: 'X', pubTypes: ['Editorial'] }).evidenceType, 'editorial')
})

test('PICO query builder keeps empty components out', async () => {
  const { picoQuery } = await import('../tools/lib/search.mjs')
  assert.equal(picoQuery({ population: 'adults', intervention: 'drug', comparator: '', outcome: 'death' }), '("adults") AND ("drug") AND ("death")')
  assert.equal(picoQuery({}), '')
})

test('abstract labels get paragraph breaks', () => {
  const s = cleanAbstract('BACKGROUND: one. RESULTS: two. CONCLUSION: three.')
  assert.match(s, /BACKGROUND: one/)
  assert.match(s, /\nRESULTS: two/)
})

test('score rewards title keyword and open access', () => {
  const p = normalizePaper({ title: 'Protein language model for design', abstract: 'protein design', isOA: true, date: new Date().toISOString().slice(0, 10), sources: ['crossref'] })
  const s = scorePaper(p, { keywords: ['protein language model'], methods: [], exclude: [] })
  assert.ok(s.score > 8)
  assert.deepEqual(s.signals.keywords, ['protein language model'])
})

test('venue watchlist boosts matching papers', () => {
  const p = normalizePaper({ title: 'A paper', venue: 'Nature Methods', date: new Date().toISOString().slice(0, 10), sources: ['crossref'] })
  const s = scorePaper(p, { keywords: [], venues: ['nature methods'], methods: [], exclude: [] })
  assert.ok(s.score >= 3)
  assert.deepEqual(s.signals.venues, ['nature methods'])
})

test('config sanitizer clamps and rejects bad times/days', () => {
  const c = sanitizeConfig({ search: { lookbackDays: 99999, perSource: -3 }, schedule: { times: ['25:00', '09:30'], days: [0, 8, 2], weeklyReviewDay: 99 }, reading: { maxCharsPerChunk: 1 } })
  assert.equal(c.search.lookbackDays, 3650)
  assert.equal(c.search.perSource, 1)
  assert.equal(c.search.discoveryOAOnly, false)
  assert.equal(c.search.includePreprints, false)
  assert.equal(c.output.dir, '')
  assert.equal(c.execution.sessionId, 'dsh-sci')
  assert.equal(c.topics.autoScope, true)
  assert.equal(c.schedule.mode, 'auto')
  assert.deepEqual(c.schedule.times, ['09:30'])
  assert.deepEqual(c.schedule.days, [2])
  assert.equal(c.schedule.weeklyReviewDay, DEFAULTS.schedule.weeklyReviewDay)
  assert.equal(c.reading.maxCharsPerChunk, 4000)
})

test('paper key prefers doi and is stable', () => {
  assert.equal(paperKey({ doi: 'https://doi.org/10.1186/s13059-026-04274-w' }), 'doi-10.1186-s13059-026-04274-w')
  assert.match(paperKey({ arxivId: '2401.12345v2' }), /^arxiv-2401\.12345$/)
})

test('frontmatter roundtrip', () => {
  const data = { id: 'doi:10.1/x', title: 'A "quoted" title', tags: ['a', 'b'], rating: 4, status: 'read' }
  const md = formatFrontmatter(data) + '\n## 一句话\n\nhello\n'
  const p = parseFrontmatter(md)
  assert.equal(p.data.title, 'A "quoted" title')
  assert.deepEqual(p.data.tags, ['a', 'b'])
  assert.equal(p.data.rating, 4)
  assert.match(p.body, /hello/)
})

test('heading detection handles sections but not tables/affiliations', () => {
  assert.equal(headingInfo('1 Introduction')?.key, 'introduction')
  assert.equal(headingInfo('3.2.1 Scaled Dot-Product Attention')?.heading, '3.2.1 Scaled Dot-Product Attention')
  assert.equal(headingInfo('Google Brain'), null)
  assert.equal(headingInfo('5.01 25.4'), null)
  assert.equal(headingInfo('model by multiplying the training time'), null)
})

test('splitSections + chunkSections omit references by default', () => {
  const text = 'Abstract\nWe study X.\n\n1 Introduction\nX is hard.\n\nReferences\n[1] A.\n'
  const sections = splitSections(text)
  assert.ok(sections.some((s) => s.key === 'references'))
  const chunks = chunkSections(sections, 500)
  assert.ok(!chunks.join('\n').includes('[1] A.'))
  const withRefs = chunkSections(sections, 500, { includeReferences: true })
  assert.ok(withRefs.join('\n').includes('[1] A.'))
})

test('JATS tables and figures are structured', () => {
  const xml = `<article><table-wrap><label>Table 1</label><caption><p>Baseline</p></caption><table><thead><tr><th>Group</th><th>N</th></tr></thead><tbody><tr><td>Drug</td><td>100</td></tr><tr><td>Placebo</td><td>98</td></tr></tbody></table></table-wrap><fig><label>Fig. 1</label><caption><p>Forest plot</p></caption><graphic xlink:href="fig1.jpg"/></fig></article>`
  const t = tablesFromPmcXml(xml, 'PMC123')
  assert.equal(t.length, 1)
  assert.match(t[0].markdown, /\| Group \| N \|/)
  assert.match(t[0].markdown, /\| Drug \| 100 \|/)
  const f = figuresFromPmcXml(xml, 'PMC123')
  assert.equal(f.length, 1)
  assert.match(f[0].caption, /Forest plot/)
  assert.match(f[0].remoteUrl, /fig1\.jpg/)
})

test('RCT note template includes PICO and RoB 2', () => {
  const md = noteScaffold({ title: 'Trial', evidenceType: 'rct', pubTypes: ['Randomized Controlled Trial'], abstract: 'x', authors: [] })
  assert.match(md, /PICO/)
  assert.match(md, /RoB 2/)
  assert.match(md, /效应量/)
})

test('PubMed query uses fields, date and publication type', () => {
  const q = buildPubmedQuery({ query: 'heart attack', days: 30, titleAbstractOnly: true, pubTypes: ['Randomized Controlled Trial'] })
  assert.match(q, /\[tiab\]/)
  assert.match(q, /\[MeSH Terms\]/)
  assert.match(q, /\[dp\]/)
  assert.match(q, /Randomized Controlled Trial"\[pt\]/)
})

test('BibTeX author parsing handles family-first names', () => {
  const bib = toBibtex([{ title: 'T', authors: [{ name: 'Bu S' }, { name: 'Seonghyeon Kim' }], year: 2026, doi: '10.1/x' }])
  assert.match(bib, /Bu, S/)
  assert.match(bib, /Kim, Seonghyeon/)
})

test('search query PHI redaction', () => {
  assert.match(redactPHI('patient MRN: 12345678 email a@b.com'), /\[redacted\]/)
  assert.match(redactPHI('patient MRN: 12345678 email a@b.com'), /\[email\]/)
})

test('every PubMed field tag normalizes', () => {
  const bad = []
  for (const f of PUBMED_FIELDS) {
    const r = normalizePubmedQuery(`x[${f.tag}]`)
    if (!r.tags.includes(f.tag)) bad.push(f.tag)
  }
  assert.deepEqual(bad, [])
  assert.deepEqual(normalizePubmedQuery('x[Title/Abstract:~3]').query, 'x[tiab:~3]')
  assert.deepEqual(normalizePubmedQuery('x[pdat]').query, 'x[dp]')
})

test('structured PubMed fields build valid clauses', () => {
  const q = buildPubmedQuery({ query: '', fields: { author: 'Fauci AS', journal: 'N Engl J Med', pmcid: '123' }, filters: ['freeFullText'], days: 30 })
  assert.match(q, /"Fauci AS"\[au\]/)
  assert.match(q, /"N Engl J Med"\[ta\]/)
  assert.match(q, /PMC123/)
  assert.match(q, /free full text/)
})

test('output/execution/topics/source options sanitize', () => {
  const c = sanitizeConfig({
    output: { dir: '~/research-output' },
    execution: { sessionId: 'research session', workspaceId: 'w1' },
    topics: { selected: ['a', 'a', 'b'], autoScope: false, maxQueries: 9 },
    sources: { options: { pubmed: { email: 'p@example.com' }, openalex: { email: 'bad' } } },
  })
  assert.equal(c.execution.sessionId, 'research-session')
  assert.equal(sanitizeConfig({ schedule: { mode: 'manual' } }).schedule.mode, 'manual')
  assert.deepEqual(c.topics.selected, ['a', 'b'])
  assert.equal(c.topics.maxQueries, 5)
  assert.equal(c.sources.options.pubmed.email, 'p@example.com')
  assert.equal(c.sources.options.openalex.email, '')
  assert.equal(outputPaths(c).root.startsWith('/'), true)
})

test('bioinformatics database catalog is unique and aliased', () => {
  assert.ok(DATABASES.length >= 45)
  assert.equal(DATABASES.filter((d) => d.executable).length, 42)
  assert.equal(new Set(DATABASES.map((d) => d.id)).size, DATABASES.length)
  assert.equal(getDatabase('hpa')?.id, 'human-protein-atlas')
  assert.equal(getDatabase('gdc')?.id, 'tcga-gdc')
  assert.equal(databaseHelp('uniprot')?.executable, true)
  assert.equal(databaseHelp('clinpgx')?.executable, true)
  assert.equal(databaseHelp('chebi')?.executable, true)
  assert.equal(databaseHelp('dailymed')?.executable, true)
  assert.equal(databaseHelp('lincs-l1000')?.auth, 'key')
  assert.equal(databaseHelp('omim')?.executable, false)
  assert.ok(DATABASES.every((d) => d.doc.endsWith('.md')))
})

test('bioinformatics P0-P2 primitives', async () => {
  const r = extractRepro('Data: GSE12345 and PXD000001. Code: https://github.com/a/b. Data available on request. dbGaP phs000001.')
  assert.equal(r.accessions.some((x) => x.id === 'GSE12345'), true)
  assert.equal(r.codeUrls.length, 1)
  assert.equal(r.controlled.length > 0, true)
  assert.ok(r.score >= 40)

  const q = qcText('We randomly split the data and normalized before training. p<0.05. AUC 0.9.')
  assert.ok(q.findings.some((f) => f.code === 'leakage-split'))
  assert.ok(q.findings.some((f) => f.code === 'p-threshold'))

  assert.deepEqual(detectAccession('GSE12345'), { db: 'geo', id: 'GSE12345' })
  assert.deepEqual(detectAccession('PXD000001'), { db: 'pride', id: 'PXD000001' })
  assert.equal(detectAccession('not-an-id'), null)

  const b = extractBenchmark([{ label: 'T1', markdown: '| Dataset | Method | Accuracy |\n|---|---|---|\n| D1 | M1 | 0.9 |' }])
  assert.equal(b.tables[0].metricColumns[0], 'Accuracy')
  assert.equal(b.tables[0].rows[0].Dataset, 'D1')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-omics-'))
  const vcf = path.join(dir, 'test.vcf')
  fs.writeFileSync(vcf, '##fileformat=VCFv4.2\n##reference=GRCh38\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n1\t1\trs1\tA\tG\t.\tPASS\t.\n')
  const o = await inspectOmics(vcf, { expectedBuild: 'GRCh38' })
  assert.equal(o.kind, 'vcf')
  assert.equal(o.build, 'GRCh38')
  assert.equal(o.samples, 0)

  const cram = path.join(dir, 'test.cram')
  fs.writeFileSync(cram, Buffer.from([0x43, 0x52, 0x41, 0x4d, 3, 0, 0, 0]))
  assert.equal((await inspectOmics(cram)).kind, 'cram')

  const h5 = path.join(dir, 'test.h5ad')
  fs.writeFileSync(h5, Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]))
  assert.equal((await inspectOmics(h5)).kind, 'h5ad')

  const header = Buffer.from('@HD\tVN:1.6\n@SQ\tSN:chr1\tLN:1000\n')
  const bam = Buffer.alloc(8 + header.length)
  bam.write('BAM\u0001', 0, 'latin1')
  bam.writeInt32LE(header.length, 4)
  header.copy(bam, 8)
  const bamFile = path.join(dir, 'test.bam')
  fs.writeFileSync(bamFile, zlib.gzipSync(bam))
  const bi = await inspectOmics(bamFile)
  assert.equal(bi.kind, 'bam')
  assert.equal(bi.referenceCount, 1)
})

test('public database normalizers keep verified fields', () => {
  const g = normalizeClinpgx({ data: [{ objCls: 'Gene', id: 'PA128', symbol: 'CYP2D6', name: 'cytochrome P450 family 2 subfamily D member 6', chr: { name: 'chr22' }, buildVersion: 'GRCh38.p7', cpicGene: true }] })
  assert.equal(g[0].symbol, 'CYP2D6')
  assert.equal(g[0].chromosome, 'chr22')
  assert.equal(g[0].cpic, true)

  const c = normalizeChebiDoc({ obo_id: 'CHEBI:15365', label: 'aspirin', description: ['A benzoic acid.'], exact_synonyms: ['ASA'] })
  assert.equal(c.id, 'CHEBI:15365')
  assert.equal(c.synonyms[0], 'ASA')
  assert.equal(normalizeChebiCompound({ id: 15365, chebi_accession: 'CHEBI:15365', name: 'acetylsalicylic acid', stars: 3 }).stars, 3)

  const d = normalizeDailymed({ setid: 'abc', title: 'METFORMIN', published_date: 'Oct 19, 2026', spl_version: 3 })
  assert.equal(d.setid, 'abc')
  assert.equal(d.version, 3)
})

test('database grounding candidates are explicit/ID based', () => {
  const c = extractCandidates({ title: 'TP53 and BRCA1 in cancer', text: 'Data GSE12345; variant rs334; https://github.com/a/b', genes: 'EGFR' })
  assert.equal(c.genes.includes('TP53'), true)
  assert.equal(c.genes.includes('EGFR'), true)
  assert.equal(c.accessions.some((x) => x.db === 'geo' && x.id === 'GSE12345'), true)
  assert.equal(c.rsids.includes('rs334'), true)
  const h = extractCandidates({ text: 'NM_000546.6:c.818G>A and chr17:7675087 A>G' })
  assert.equal(h.hgvs[0], 'NM_000546.6:c.818G>A')
  assert.equal(h.genomic.length > 0, true)
})

test('classify input forms', () => {
  assert.deepEqual(classifyInput('https://arxiv.org/abs/2401.12345v2'), { kind: 'arxiv', value: '2401.12345' })
  assert.equal(classifyInput('doi:10.1038/nature12373').kind, 'doi')
  assert.equal(classifyInput('PMC1234567').kind, 'pmcid')
  assert.equal(classifyInput('00000000').kind, 'pmid')
  assert.equal(classifyInput('hello world').kind, 'unknown')
})
