/**
 * 组学文件静态检查：只读头部/采样，不把大文件塞进上下文。
 * 目标不是替代 samtools/bcftools，而是先发现格式、参考版本、样本量、明显错配。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'

const TEXT_EXT = new Set(['.vcf', '.bed', '.gtf', '.gff', '.gff3', '.fa', '.fasta', '.fna', '.ffn', '.faa', '.fq', '.fastq', '.tsv', '.csv', '.txt', '.mtx', '.gmt', '.bedgraph'])
const BIN_EXT = new Set(['.bam', '.cram', '.bw', '.bigwig', '.h5', '.hdf5', '.h5ad', '.rds', '.rdata'])
const BUILD_RE = /(GRCh3[78]|hg19|hg38|GRCm3[89]|mm10|mm39|T2T|CHM13|GRCh37|GRCh38)/i

function readSample(file, maxBytes = 2 * 1024 * 1024) {
  const fd = fs.openSync(file, 'r')
  const buf = Buffer.alloc(maxBytes)
  const n = fs.readSync(fd, buf, 0, maxBytes, 0)
  fs.closeSync(fd)
  return buf.subarray(0, n)
}

function textOf(file) {
  const buf = readSample(file)
  const ext = path.extname(file).toLowerCase()
  if (ext === '.gz') {
    try { return zlib.gunzipSync(buf).toString('utf8') } catch { return '' }
  }
  if (buf.includes(0) && !/\.(h5|hdf5|h5ad|bam|cram|bw)$/i.test(file)) return ''
  return buf.toString('utf8')
}

function sha256(file) {
  return new Promise((resolve) => {
    const h = crypto.createHash('sha256')
    const st = fs.createReadStream(file)
    st.on('data', (d) => h.update(d))
    st.on('end', () => resolve(h.digest('hex')))
    st.on('error', () => resolve(''))
  })
}

function buildOf(text) {
  const m = String(text).match(BUILD_RE)
  return m ? m[0] : ''
}

function detectDirectory(dir) {
  const files = new Set(fs.readdirSync(dir))
  if (files.has('matrix.mtx') || files.has('matrix.mtx.gz') || files.has('features.tsv.gz') || files.has('barcodes.tsv.gz')) {
    return { kind: '10x', files: [...files].filter((f) => /matrix|barcode|feature|genes/i.test(f)) }
  }
  return null
}

function gunzipSample(file, maxBytes = 256 * 1024) {
  return new Promise((resolve) => {
    const chunks = []
    const st = fs.createReadStream(file, { start: 0, end: maxBytes - 1 })
    const gz = zlib.createGunzip()
    let settled = false
    const done = (v) => { if (!settled) { settled = true; resolve(v) } }
    st.on('error', () => done(null))
    gz.on('error', () => done(chunks.length ? Buffer.concat(chunks) : null))
    gz.on('data', (d) => { chunks.push(d); if (Buffer.concat(chunks).length >= 64 * 1024) { done(Buffer.concat(chunks)); st.destroy(); gz.destroy() } })
    gz.on('end', () => done(Buffer.concat(chunks)))
    st.pipe(gz)
  })
}

async function binaryInfo(file, ext, base) {
  const head = readSample(file, 16)
  const raw = path.extname(file).toLowerCase()
  if (raw === '.cram' || head.subarray(0, 4).toString('latin1') === 'CRAM') {
    return { ...base, ok: true, kind: 'cram', version: `${head[4]}.${head[5]}`, warnings: [...base.warnings, 'CRAM 只读取了文件头；请用 samtools 校验索引和参考序列。'] }
  }
  if (raw === '.bam' || ext === '.bam') {
    const headBuf = await gunzipSample(file)
    if (!headBuf || headBuf.subarray(0, 4).toString('latin1') !== 'BAM\u0001') {
      return { ...base, ok: true, kind: 'bam', warnings: [...base.warnings, 'BAM 无法解压或不是 BAM 格式；请用 samtools quickcheck。'] }
    }
    const lText = headBuf.readInt32LE(4)
    const text = lText > 0 && lText <= headBuf.length - 8 ? headBuf.subarray(8, 8 + lText).toString('utf8') : ''
    const refs = (text.match(/^@SQ\t/gm) ?? []).length
    return { ...base, ok: true, kind: 'bam', header: text.split('\n').slice(0, 8), referenceCount: refs, warnings: [...base.warnings, ...(refs ? [] : ['BAM header 未发现 @SQ；参考序列信息不完整。'])] }
  }
  if (ext === '.h5' || ext === '.hdf5' || ext === '.h5ad' || head.subarray(0, 8).equals(Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ...base, ok: true, kind: ext === '.h5ad' ? 'h5ad' : 'hdf5', warnings: [...base.warnings, '只确认 HDF5 文件签名；未解析 h5ad 的 obs/var/shape，请用 anndata/h5py 校验。'] }
  }
  const magic = head.readUInt32LE(0)
  if (ext === '.bw' || ext === '.bigwig' || magic === 0x888ffc26) {
    return { ...base, ok: true, kind: 'bigwig', warnings: [...base.warnings, '只确认 BigWig 文件签名；未解析染色体和区间。'] }
  }
  return { ...base, ok: true, kind: ext.replace('.', ''), magic: head.toString('hex'), warnings: [...base.warnings, '二进制格式未解析；请用专用工具验证。'] }
}

export async function inspectOmics(file, { expectedBuild = '' } = {}) {
  const abs = path.resolve(String(file))
  const st = fs.statSync(abs)
  if (st.isDirectory()) {
    const d = detectDirectory(abs)
    if (!d) throw new Error('目录不是可识别的 10x 结构（缺 matrix.mtx/features.tsv.gz/barcodes.tsv.gz）')
    return { ok: true, kind: '10x', path: abs, files: d.files, size: null, sha256: null, warnings: [], note: '10x 目录；需确认 features/barcodes 与 matrix 维度一致。' }
  }
  const rawExt = path.extname(abs).toLowerCase()
  const baseName = abs.replace(/\.gz$/i, '')
  const ext = path.extname(baseName).toLowerCase() || rawExt
  const base = { path: abs, size: st.size, ext, sha256: await sha256(abs), warnings: [] }
  if (st.size > 500 * 1024 * 1024) base.warnings.push('文件超过 500 MB；只读取头部样本，未做全量校验。')
  if (BIN_EXT.has(ext) || rawExt === '.bam' || rawExt === '.cram') {
    return binaryInfo(abs, ext, base)
  }
  const text = textOf(abs)
  if (!text) return { ...base, ok: true, kind: 'binary/unknown', warnings: [...base.warnings, '无法作为文本读取；未解析。'] }
  const lines = text.split(/\r?\n/)
  const build = buildOf(text)
  if (expectedBuild && build && build.toLowerCase() !== String(expectedBuild).toLowerCase()) {
    base.warnings.push(`参考版本不匹配：文件=${build}，期望=${expectedBuild}`)
  } else if (expectedBuild && !build) {
    base.warnings.push(`未在头部识别到参考版本；无法确认与 ${expectedBuild} 匹配。`)
  }
  if (ext === '.vcf') {
    const samples = (lines.find((l) => l.startsWith('#CHROM')) ?? '').split('\t').slice(9)
    const variants = lines.filter((l) => l && !l.startsWith('#')).length
    const ref = (lines.find((l) => /^##reference=/i.test(l)) ?? '').replace(/^##reference=/i, '')
    return { ...base, ok: true, kind: 'vcf', build: build || ref, samples: samples.length, sampleNames: samples.slice(0, 20), variantsSampled: variants, warnings: [...base.warnings, ...(variants >= 2000 ? ['只统计了头部样本中的变异数，不是全文件总数。'] : [])] }
  }
  if (ext === '.bed' || ext === '.bedgraph') {
    const rows = lines.filter((l) => l && !l.startsWith('#') && !l.startsWith('track') && !l.startsWith('browser')).slice(0, 2000)
    const chroms = [...new Set(rows.map((l) => l.split('\t')[0]))]
    return { ...base, ok: true, kind: 'bed', build, chroms: chroms.slice(0, 30), intervalsSampled: rows.length, warnings: base.warnings }
  }
  if (ext === '.gtf' || ext === '.gff' || ext === '.gff3') {
    const rows = lines.filter((l) => l && !l.startsWith('#')).slice(0, 5000)
    const genes = new Set()
    for (const l of rows) { const f = l.split('\t'); const m = l.match(/(?:gene_id|ID=gene:?|Name=)([^;"\s]+)/); if (f[2] === 'gene' || f[2] === 'mRNA') genes.add(m?.[1] ?? '') }
    return { ...base, ok: true, kind: ext.slice(1), build, featuresSampled: rows.length, genes: [...genes].filter(Boolean).slice(0, 20), warnings: base.warnings }
  }
  if (['.fa', '.fasta', '.fna', '.ffn', '.faa', '.fq', '.fastq'].includes(ext)) {
    const isFastq = ext.includes('q')
    const records = isFastq ? Math.floor(lines.filter((l) => l.startsWith('@')).length) : lines.filter((l) => l.startsWith('>')).length
    const seq = isFastq ? (lines[1] ?? '') : (lines[1] ?? '')
    return { ...base, ok: true, kind: isFastq ? 'fastq' : 'fasta', recordsSampled: records, firstLength: seq.length, warnings: [...base.warnings, ...(records >= 1000 ? ['只统计了头部样本的 records。'] : [])] }
  }
  if (ext === '.mtx') {
    const dims = lines.find((l) => l && !l.startsWith('%'))
    return { ...base, ok: true, kind: 'mtx', dimensions: dims?.trim(), warnings: base.warnings }
  }
  if (ext === '.csv' || ext === '.tsv') {
    const sep = ext === '.csv' ? ',' : '\t'
    const header = (lines[0] ?? '').split(sep).map((x) => x.trim())
    return { ...base, ok: true, kind: ext.slice(1), columns: header.slice(0, 50), rowsSampled: lines.filter(Boolean).length - 1, warnings: base.warnings }
  }
  return { ...base, ok: true, kind: ext.slice(1) || 'text', linesSampled: lines.length, build, warnings: base.warnings }
}
