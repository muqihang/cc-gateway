import { createHash } from 'node:crypto'
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs'
import path from 'node:path'

import { runReviewedGit } from './secure-runtime.js'

export type VisibleStateLimits = Readonly<{
  maxEntries: number
  maxFileBytes: number
  maxAggregateBytes: number
  maxGitOutputBytes: number
  maxDiffBytes: number
}>

export const VISIBLE_STATE_LIMITS: VisibleStateLimits = Object.freeze({
  maxEntries: 100_000,
  maxFileBytes: 64 * 1024 * 1024,
  maxAggregateBytes: 1024 * 1024 * 1024,
  maxGitOutputBytes: 32 * 1024 * 1024,
  maxDiffBytes: 32 * 1024 * 1024,
})

export type BoundedDirtyRecord = {
  status: string
  destination_path_base64url: string
  source_path_base64url?: string
  object_type: 'regular_file' | 'submodule' | 'deleted'
  file_mode: string
  content_sha256?: string
  deletion_marker?: true
  submodule_head?: string
  submodule_dirty?: boolean
}

export type BoundedRepositoryState = {
  head: string
  branch: string
  clean: boolean
  dirty_digest: string
  dirty_records: BoundedDirtyRecord[]
  dirty_record_format: string
  ignored_exclusion_rules: Array<{ source_category: string; source_path_base64url?: string; rule_sha256: string }>
}

const RECORD_FORMAT = 'u32be_length_prefixed_fields(status,destination,source,object_type,file_mode,content_sha256,symlink_target_sha256,deletion_marker,submodule_head,submodule_dirty); records sorted by destination bytes then source bytes; sha256(records || git_diff_binary_head)'
const READ_BUFFER_BYTES = 1024 * 1024
const EMPTY = Buffer.alloc(0)
const FILE_DIGESTS = Symbol('boundedVisibleFileDigests')
type InternalState = BoundedRepositoryState & { [FILE_DIGESTS]: ReadonlyMap<string, string> }
type IndexEntry = { mode: string; object: string; path: Buffer }

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

function validateLimits(limits: VisibleStateLimits): void {
  for (const [name, ceiling] of Object.entries(VISIBLE_STATE_LIMITS) as Array<[keyof VisibleStateLimits, number]>) {
    const value = limits[name]
    if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) fail('invalid_visible_state_limits', 'visible-state limits must be positive safe integers within reviewed maxima')
  }
}

function encodePath(value: Buffer): string {
  return value.toString('base64url')
}

function validRawPath(value: Buffer): boolean {
  if (value.length === 0 || value[0] === 0x2f || value[value.length - 1] === 0x2f || value.includes(0)) return false
  const components = value.toString('binary').split('/')
  return components.every((component, index) => component.length > 0 && component !== '.' && component !== '..' && !(index === 0 && component === '.git'))
}

function rawAbsolute(root: string, relative: Buffer): Buffer {
  return Buffer.concat([Buffer.from(root), Buffer.from(path.sep), relative])
}

function sameStat(left: ReturnType<typeof lstatSync>, right: ReturnType<typeof fstatSync>): boolean {
  const a = left as unknown as Record<string, bigint>
  const b = right as unknown as Record<string, bigint>
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.size === b.size
    && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs
}

function hashRegularFile(absolute: Buffer, limits: VisibleStateLimits, aggregate: { bytes: number }, collect = false, countAggregate = true): { size: number; digest: string; bytes?: Buffer } {
  let before: ReturnType<typeof lstatSync>
  try { before = lstatSync(absolute, { bigint: true }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail('visible_state_missing_entry', 'visible entry is missing')
    fail('visible_state_unstable', 'visible entry changed during capture')
  }
  if (!before.isFile() || before.isSymbolicLink()) fail('visible_state_unsupported_entry', 'visible entry must be a regular non-symlink file')
  const declaredSize = Number((before as unknown as { size: bigint }).size)
  if (!Number.isSafeInteger(declaredSize) || declaredSize > limits.maxFileBytes) fail('visible_state_file_limit_exceeded', 'visible file exceeds the reviewed apparent-byte limit')
  if (countAggregate && aggregate.bytes + declaredSize > limits.maxAggregateBytes) fail('visible_state_aggregate_limit_exceeded', 'visible files exceed the reviewed aggregate apparent-byte limit')
  let descriptor: number | undefined
  try {
    descriptor = openSync(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
    const opened = fstatSync(descriptor, { bigint: true })
    if (!opened.isFile() || !sameStat(before, opened)) fail('visible_state_unstable', 'visible entry changed during capture')
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES)
    const chunks: Buffer[] = []
    let bytesRead = 0
    while (bytesRead < declaredSize) {
      const count = readSync(descriptor, buffer, 0, Math.min(buffer.length, declaredSize - bytesRead), null)
      if (count === 0) break
      bytesRead += count
      const chunk = buffer.subarray(0, count)
      hash.update(chunk)
      if (collect) chunks.push(Buffer.from(chunk))
    }
    const final = fstatSync(descriptor, { bigint: true })
    if (bytesRead !== declaredSize || !sameStat(before, final)) fail('visible_state_unstable', 'visible entry changed during capture')
    if (countAggregate) aggregate.bytes += declaredSize
    return { size: declaredSize, digest: hash.digest('hex'), ...(collect ? { bytes: Buffer.concat(chunks, declaredSize) } : {}) }
  } catch (error) {
    if ((error as Error & { code?: string }).code?.startsWith('visible_state_')) throw error
    fail('visible_state_unstable', 'visible entry changed during capture')
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  fail('visible_state_unstable', 'visible entry changed during capture')
}

function nulRecords(output: Buffer, code: string): Buffer[] {
  if (output.length === 0) return []
  if (output[output.length - 1] !== 0) fail(code, 'bounded Git material is malformed')
  const records: Buffer[] = []
  let start = 0
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue
    if (index === start) fail(code, 'bounded Git material is malformed')
    records.push(Buffer.from(output.subarray(start, index)))
    start = index + 1
  }
  return records
}

function parseIndex(output: Buffer): Map<string, IndexEntry> {
  const entries = new Map<string, IndexEntry>()
  for (const record of nulRecords(output, 'visible_state_git_material_invalid')) {
    const tab = record.indexOf(0x09)
    if (tab < 1) fail('visible_state_git_material_invalid', 'bounded Git index material is malformed')
    const [mode, object, stage] = record.subarray(0, tab).toString('ascii').split(' ')
    const rawPath = Buffer.from(record.subarray(tab + 1))
    if (!/^(100644|100755|120000|160000)$/.test(mode) || !/^[0-9a-f]{40,64}$/.test(object) || stage !== '0' || !validRawPath(rawPath)) {
      fail('visible_state_git_material_invalid', 'bounded Git index material is malformed')
    }
    entries.set(encodePath(rawPath), { mode, object, path: rawPath })
  }
  return entries
}

function parseStatus(output: Buffer): Array<{ status: string; destination: Buffer; source?: Buffer }> {
  const records = nulRecords(output, 'visible_state_git_material_invalid')
  const parsed: Array<{ status: string; destination: Buffer; source?: Buffer }> = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record.length < 4 || record[2] !== 0x20) fail('visible_state_git_material_invalid', 'bounded Git status material is malformed')
    const status = record.subarray(0, 2).toString('ascii')
    const destination = Buffer.from(record.subarray(3))
    if (!validRawPath(destination)) fail('visible_state_path_invalid', 'Git returned an unsafe repository-relative path')
    let source: Buffer | undefined
    if (status.includes('R') || status.includes('C')) {
      source = records[++index]
      if (!source || !validRawPath(source)) fail('visible_state_path_invalid', 'Git returned an unsafe repository-relative path')
    }
    parsed.push({ status, destination, source: source ? Buffer.from(source) : undefined })
  }
  return parsed
}

function field(value: Buffer | string | undefined): Buffer {
  const bytes = value === undefined ? EMPTY : Buffer.isBuffer(value) ? value : Buffer.from(value)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(bytes.length)
  return Buffer.concat([length, bytes])
}

function serialize(record: BoundedDirtyRecord, destination: Buffer, source?: Buffer): Buffer {
  return Buffer.concat([
    field(record.status), field(destination), field(source), field(record.object_type), field(record.file_mode),
    field(record.content_sha256), field(undefined), field(record.deletion_marker ? '1' : ''),
    field(record.submodule_head), field(record.submodule_dirty === undefined ? '' : record.submodule_dirty ? '1' : '0'),
  ])
}

function exclusionRules(root: string, limits: VisibleStateLimits, aggregate: { bytes: number }, digests: Map<string, string>): BoundedRepositoryState['ignored_exclusion_rules'] {
  const output = runReviewedGit(root, ['ls-files', '-z', '--', '.gitignore', '**/.gitignore'], { maxOutputBytes: limits.maxGitOutputBytes }).stdout
  const rules: BoundedRepositoryState['ignored_exclusion_rules'] = []
  for (const relative of nulRecords(output, 'visible_state_git_material_invalid')) {
    if (!validRawPath(relative)) fail('visible_state_path_invalid', 'Git returned an unsafe exclusion path')
    const encoded = encodePath(relative)
    const previousDigest = digests.get(encoded)
    const hashed = hashRegularFile(rawAbsolute(root, relative), limits, aggregate, true, previousDigest === undefined)
    if (previousDigest !== undefined && previousDigest !== hashed.digest) fail('visible_state_unstable', 'visible exclusion bytes changed during capture')
    digests.set(encoded, hashed.digest)
    for (const rule of hashed.bytes!.toString('utf8').split(/\r?\n/).filter((value) => value.length > 0 && !value.startsWith('#'))) {
      rules.push({ source_category: 'repository_gitignore', source_path_base64url: encodePath(relative), rule_sha256: createHash('sha256').update(rule).digest('hex') })
    }
  }
  const infoPath = runReviewedGit(root, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'], { maxOutputBytes: limits.maxGitOutputBytes }).stdout.toString('utf8').trim()
  try {
    const hashed = hashRegularFile(Buffer.from(infoPath), limits, aggregate, true)
    for (const rule of hashed.bytes!.toString('utf8').split(/\r?\n/).filter((value) => value.length > 0 && !value.startsWith('#'))) {
      rules.push({ source_category: 'repository_info_exclude', rule_sha256: createHash('sha256').update(rule).digest('hex') })
    }
  } catch (error) {
    if ((error as Error & { code?: string }).code === 'visible_state_missing_entry') return rules
    throw error
  }
  return rules.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
}

export function captureBoundedRepositoryState(
  rootInput: string,
  limits: VisibleStateLimits = VISIBLE_STATE_LIMITS,
  additionalRegularPaths: readonly string[] = [],
): BoundedRepositoryState {
  validateLimits(limits)
  const root = realpathSync(rootInput)
  const index = parseIndex(runReviewedGit(root, ['ls-files', '-s', '-z'], { maxOutputBytes: limits.maxGitOutputBytes }).stdout)
  const parsed = parseStatus(runReviewedGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'], { maxOutputBytes: limits.maxGitOutputBytes }).stdout)
  if (parsed.length > limits.maxEntries) fail('visible_state_entry_limit_exceeded', 'visible entry count exceeds the reviewed limit')
  const aggregate = { bytes: 0 }
  const fileDigests = new Map<string, string>()
  const records: Array<{ destination: Buffer; source?: Buffer; record: BoundedDirtyRecord }> = []
  for (const item of parsed) {
    const encoded = encodePath(item.destination)
    const absolute = rawAbsolute(root, item.destination)
    let stat: ReturnType<typeof lstatSync> | undefined
    try { stat = lstatSync(absolute, { bigint: true }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('visible_state_unstable', 'visible entry changed during capture')
    }
    const base = { status: item.status, destination_path_base64url: encoded, ...(item.source ? { source_path_base64url: encodePath(item.source) } : {}) }
    if (!stat) {
      records.push({ ...item, record: { ...base, object_type: 'deleted', file_mode: '000000', deletion_marker: true } })
      continue
    }
    const indexed = index.get(encoded)
    if (indexed?.mode === '160000') {
      let head = 'unavailable'; let dirty = true
      try {
        head = runReviewedGit(absolute.toString(), ['rev-parse', 'HEAD'], { maxOutputBytes: limits.maxGitOutputBytes }).stdout.toString('utf8').trim()
        dirty = runReviewedGit(absolute.toString(), ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'], { maxOutputBytes: limits.maxGitOutputBytes }).stdout.length > 0
      } catch { /* fail-closed submodule state */ }
      records.push({ ...item, record: { ...base, object_type: 'submodule', file_mode: '160000', submodule_head: head, submodule_dirty: dirty } })
      continue
    }
    const hashed = hashRegularFile(absolute, limits, aggregate)
    fileDigests.set(encoded, hashed.digest)
    const mode = indexed?.mode ?? ((Number((stat as unknown as { mode: bigint }).mode) & 0o111) ? '100755' : '100644')
    records.push({ ...item, record: { ...base, object_type: 'regular_file', file_mode: mode, content_sha256: hashed.digest } })
  }
  const seen = new Set(records.map((item) => encodePath(item.destination)))
  for (const entry of index.values()) {
    if (entry.mode !== '160000' || seen.has(encodePath(entry.path))) continue
    let head = 'unavailable'; let dirty = true
    try {
      const target = rawAbsolute(root, entry.path).toString()
      head = runReviewedGit(target, ['rev-parse', 'HEAD'], { maxOutputBytes: limits.maxGitOutputBytes }).stdout.toString('utf8').trim()
      dirty = runReviewedGit(target, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'], { maxOutputBytes: limits.maxGitOutputBytes }).stdout.length > 0
    } catch { /* fail-closed submodule state */ }
    if (head !== entry.object || dirty) records.push({ destination: entry.path, record: { status: 'SM', destination_path_base64url: encodePath(entry.path), object_type: 'submodule', file_mode: '160000', submodule_head: head, submodule_dirty: dirty } })
  }
  if (records.length > limits.maxEntries) fail('visible_state_entry_limit_exceeded', 'visible entry count exceeds the reviewed limit')
  for (const relative of additionalRegularPaths) {
    if (relative.length === 0 || path.isAbsolute(relative) || path.posix.normalize(relative) !== relative || relative.split('/').includes('..')) fail('visible_state_path_invalid', 'additional visible path is unsafe')
    const raw = Buffer.from(relative)
    const encoded = encodePath(raw)
    if (fileDigests.has(encoded)) continue
    const hashed = hashRegularFile(rawAbsolute(root, raw), limits, aggregate)
    fileDigests.set(encoded, hashed.digest)
  }
  const ignoredExclusionRules = exclusionRules(root, limits, aggregate, fileDigests)
  records.sort((left, right) => Buffer.compare(left.destination, right.destination) || Buffer.compare(left.source ?? EMPTY, right.source ?? EMPTY))
  const diff = runReviewedGit(root, ['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--'], { maxOutputBytes: limits.maxDiffBytes }).stdout
  const serialized = Buffer.concat(records.map((item) => serialize(item.record, item.destination, item.source)))
  const state = {
    head: runReviewedGit(root, ['rev-parse', 'HEAD'], { maxOutputBytes: limits.maxGitOutputBytes }).stdout.toString('utf8').trim(),
    branch: runReviewedGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'], { maxOutputBytes: limits.maxGitOutputBytes }).stdout.toString('utf8').trim(),
    clean: records.length === 0 && diff.length === 0,
    dirty_digest: createHash('sha256').update(serialized).update(diff).digest('hex'),
    dirty_records: records.map((item) => item.record),
    dirty_record_format: RECORD_FORMAT,
    ignored_exclusion_rules: ignoredExclusionRules,
  } as InternalState
  Object.defineProperty(state, FILE_DIGESTS, { value: fileDigests, enumerable: false })
  return state
}

export function visibleFileDigest(state: BoundedRepositoryState, relative: string): string | undefined {
  return (state as InternalState)[FILE_DIGESTS]?.get(Buffer.from(relative).toString('base64url'))
}
