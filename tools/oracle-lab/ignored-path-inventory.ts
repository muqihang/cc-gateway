import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readlinkSync,
  readSync,
  readdirSync,
  realpathSync,
} from 'node:fs'
import path from 'node:path'

export const IGNORED_INVENTORY_ALGORITHM = 'git_exclude_standard_recursive_v1' as const

export type IgnoredInventoryLimits = {
  readonly maxEndpointRoots: number
  readonly maxEntries: number
  readonly maxRegularFileBytes: number
}

export const DEFAULT_IGNORED_INVENTORY_LIMITS: IgnoredInventoryLimits = Object.freeze({
  maxEndpointRoots: 100_000,
  maxEntries: 250_000,
  maxRegularFileBytes: 1024 * 1024 * 1024,
})

export type IgnoredInventorySummary = {
  algorithm: typeof IGNORED_INVENTORY_ALGORITHM
  endpoint_count: number
  entry_count: number
  regular_file_count: number
  directory_count: number
  symlink_count: number
  regular_file_bytes: number
  digest: string
}

export type IgnoredInventoryRecord = {
  readonly path: Buffer
  readonly type: 'regular' | 'directory' | 'symlink'
  readonly mode: number
  readonly size?: number
  readonly content_digest?: string
  readonly symlink_target_digest?: string
}

export type IgnoredPathInventory = {
  summary: IgnoredInventorySummary
  // Non-enumerable so callers cannot accidentally persist sensitive records.
  records: readonly IgnoredInventoryRecord[]
}

export type IgnoredOutputPolicy = 'none' | 'sub2api_joint_safe_deliverable_v1'

export type IgnoredInventoryTransition = {
  before_protected: IgnoredInventorySummary
  after_protected: IgnoredInventorySummary
  observation?: {
    policy: 'sub2api_joint_safe_deliverable_v1'
    policy_digest: string
    before: IgnoredInventorySummary
    after: IgnoredInventorySummary
  }
}

const ENDPOINT_ROOTS = Symbol('ignoredEndpointRoots')
type InternalInventory = IgnoredPathInventory & { [ENDPOINT_ROOTS]: readonly Buffer[] }

const READ_BUFFER_BYTES = 1024 * 1024
const EMPTY = Buffer.alloc(0)
const SLASH = Buffer.from('/')
const GIT_OUTPUT_LIMIT = 32 * 1024 * 1024

const JOINT_POLICY = Object.freeze({
  policy: 'sub2api_joint_safe_deliverable_v1',
  root: 'docs/anti-ban/captures/real-baseline',
  directory_suffix: '-sub2api-cc-gateway-joint-local-capture',
  safe_directory: 'safe-deliverable',
  modes: Object.freeze({
    directory: 0o755,
    regular_file: 0o644,
  }),
  leaves: Object.freeze({
    'README.md': 131_072,
    'joint_local_capture_summary.redacted.json': 262_144,
  }),
  max_total_regular_file_bytes: 393_216,
})

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function digest(value: Buffer | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

export const IGNORED_OUTPUT_POLICY_DIGESTS = Object.freeze({
  none: digest(canonical({ policy: 'none' })),
  sub2api_joint_safe_deliverable_v1: digest(canonical(JOINT_POLICY)),
})

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

function field(value: Buffer | string | number | undefined): Buffer {
  const bytes = value === undefined ? EMPTY : Buffer.isBuffer(value) ? value : Buffer.from(String(value))
  const length = Buffer.alloc(4)
  length.writeUInt32BE(bytes.length)
  return Buffer.concat([length, bytes])
}

function rawAbsolute(root: string, relative: Buffer): Buffer {
  return Buffer.concat([Buffer.from(root), Buffer.from(path.sep), relative])
}

function splitRawPath(relative: Buffer): Buffer[] {
  const components: Buffer[] = []
  let start = 0
  for (let index = 0; index <= relative.length; index += 1) {
    if (index !== relative.length && relative[index] !== 0x2f) continue
    components.push(relative.subarray(start, index))
    start = index + 1
  }
  return components
}

function validRawRepositoryPath(relative: Buffer): boolean {
  if (relative.length === 0 || relative[0] === 0x2f || relative[relative.length - 1] === 0x2f) return false
  const components = splitRawPath(relative)
  if (components.some((component) => component.length === 0 || component.equals(Buffer.from('.')) || component.equals(Buffer.from('..')))) return false
  return !components[0]?.equals(Buffer.from('.git'))
}

function gitBuffer(root: string, args: string[]): Buffer {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: GIT_OUTPUT_LIMIT,
    })
  } catch {
    fail('ignored_inventory_discovery_failed', 'ignored inventory Git discovery failed')
  }
}

function nulRecords(output: Buffer): Buffer[] {
  if (output.length === 0) return []
  if (output[output.length - 1] !== 0) fail('ignored_inventory_discovery_failed', 'ignored inventory Git discovery failed')
  const records: Buffer[] = []
  let start = 0
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue
    if (index === start) fail('ignored_inventory_discovery_failed', 'ignored inventory Git discovery failed')
    records.push(Buffer.from(output.subarray(start, index)))
    start = index + 1
  }
  return records
}

function rejectTrackedSubmodules(root: string): void {
  const entries = nulRecords(gitBuffer(root, ['ls-files', '-s', '-z']))
  for (const entry of entries) {
    if (entry.subarray(0, entry.indexOf(0x20)).equals(Buffer.from('160000'))) {
      fail('unsupported_ignored_entry_type', 'ignored inventory does not support checked-out submodules')
    }
  }
}

function discoverEndpointRoots(root: string, limits: IgnoredInventoryLimits): Buffer[] {
  const output = gitBuffer(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--directory'])
  const roots = nulRecords(output).map((record) => record[record.length - 1] === 0x2f ? record.subarray(0, -1) : record)
  if (roots.length > limits.maxEndpointRoots) fail('ignored_inventory_limit_exceeded', 'ignored inventory resource limit exceeded')
  roots.sort(Buffer.compare)
  for (let index = 0; index < roots.length; index += 1) {
    const current = roots[index]
    if (!validRawRepositoryPath(current)) fail('ignored_inventory_discovery_failed', 'ignored inventory Git discovery failed')
    const prior = roots[index - 1]
    if (prior && (current.equals(prior) || current.subarray(0, prior.length).equals(prior) && current[prior.length] === 0x2f)) {
      fail('ignored_inventory_discovery_failed', 'ignored inventory Git discovery failed')
    }
  }
  return roots.map((rootPath) => Buffer.from(rootPath))
}

function sameStat(left: ReturnType<typeof lstatSync>, right: ReturnType<typeof lstatSync>): boolean {
  const lhs = left as unknown as { dev: bigint; ino: bigint; mode: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint }
  const rhs = right as unknown as typeof lhs
  return lhs.dev === rhs.dev && lhs.ino === rhs.ino && lhs.mode === rhs.mode && lhs.size === rhs.size && lhs.mtimeNs === rhs.mtimeNs && lhs.ctimeNs === rhs.ctimeNs
}

function streamRegularFile(absolute: Buffer, pathStat: ReturnType<typeof lstatSync>): { size: number; content_digest: string } {
  if (fsConstants.O_NOFOLLOW === undefined) fail('unsupported_ignored_entry_type', 'ignored inventory requires no-follow file access')
  let descriptor: number | undefined
  try {
    descriptor = openSync(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    const before = fstatSync(descriptor, { bigint: true })
    if (!before.isFile() || !sameStat(pathStat, before)) fail('ignored_inventory_unstable', 'ignored inventory changed during capture')
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES)
    let bytesRead = 0
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null)
      if (count === 0) break
      hash.update(buffer.subarray(0, count))
      bytesRead += count
    }
    const after = fstatSync(descriptor, { bigint: true })
    if (!sameStat(before, after) || BigInt(bytesRead) !== before.size) fail('ignored_inventory_unstable', 'ignored inventory changed during capture')
    return { size: bytesRead, content_digest: `sha256:${hash.digest('hex')}` }
  } catch (error) {
    if ((error as Error & { code?: string }).code?.startsWith('ignored_inventory_')) throw error
    return fail('ignored_inventory_unstable', 'ignored inventory changed during capture')
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function serializeRecord(record: IgnoredInventoryRecord): Buffer {
  return Buffer.concat([
    field(record.path),
    field(record.type),
    field(record.mode.toString(8).padStart(4, '0')),
    field(record.size),
    field(record.content_digest),
    field(record.symlink_target_digest),
    field(record.type === 'directory' ? 'directory' : undefined),
  ])
}

function summarize(recordsInput: readonly IgnoredInventoryRecord[], endpointCount: number): IgnoredInventorySummary {
  const records = [...recordsInput].sort((left, right) => Buffer.compare(left.path, right.path))
  const hash = createHash('sha256')
  hash.update(field(IGNORED_INVENTORY_ALGORITHM))
  for (const record of records) hash.update(serializeRecord(record))
  const regular = records.filter((record) => record.type === 'regular')
  return {
    algorithm: IGNORED_INVENTORY_ALGORITHM,
    endpoint_count: endpointCount,
    entry_count: records.length,
    regular_file_count: regular.length,
    directory_count: records.filter((record) => record.type === 'directory').length,
    symlink_count: records.filter((record) => record.type === 'symlink').length,
    regular_file_bytes: regular.reduce((total, record) => total + (record.size ?? 0), 0),
    digest: `sha256:${hash.digest('hex')}`,
  }
}

function internalInventory(inventory: IgnoredPathInventory): InternalInventory {
  if (!(ENDPOINT_ROOTS in inventory) || !Array.isArray(inventory.records)) fail('ignored_inventory_unstable', 'ignored inventory is unavailable')
  return inventory as InternalInventory
}

export function computeIgnoredPathInventory(rootInput: string, limits: IgnoredInventoryLimits = DEFAULT_IGNORED_INVENTORY_LIMITS): IgnoredPathInventory {
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) fail('ignored_inventory_limit_exceeded', 'ignored inventory resource limit exceeded')
  }
  let root: string
  try {
    root = realpathSync(rootInput)
    const topLevel = gitBuffer(root, ['rev-parse', '--show-toplevel']).toString('utf8').trim()
    if (realpathSync(topLevel) !== root) fail('ignored_inventory_discovery_failed', 'ignored inventory requires a repository root')
  } catch (error) {
    if ((error as Error & { code?: string }).code?.startsWith('ignored_inventory_')) throw error
    fail('ignored_inventory_discovery_failed', 'ignored inventory Git discovery failed')
  }
  rejectTrackedSubmodules(root)
  const endpointRoots = discoverEndpointRoots(root, limits)
  const records: IgnoredInventoryRecord[] = []
  let regularFileBytes = 0

  const walk = (relative: Buffer): void => {
    if (records.length >= limits.maxEntries) fail('ignored_inventory_limit_exceeded', 'ignored inventory resource limit exceeded')
    const absolute = rawAbsolute(root, relative)
    let before: ReturnType<typeof lstatSync>
    try { before = lstatSync(absolute, { bigint: true }) }
    catch { fail('ignored_inventory_unstable', 'ignored inventory changed during capture') }
    const mode = Number((before as unknown as { mode: bigint }).mode & 0o7777n)
    if (before.isFile()) {
      const declaredSize = Number((before as unknown as { size: bigint }).size)
      if (!Number.isSafeInteger(declaredSize) || regularFileBytes + declaredSize > limits.maxRegularFileBytes) fail('ignored_inventory_limit_exceeded', 'ignored inventory resource limit exceeded')
      const hashed = streamRegularFile(absolute, before)
      regularFileBytes += hashed.size
      records.push({ path: Buffer.from(relative), type: 'regular', mode, ...hashed })
      return
    }
    if (before.isSymbolicLink()) {
      let target: Buffer
      let after: ReturnType<typeof lstatSync>
      try {
        target = readlinkSync(absolute, { encoding: 'buffer' })
        after = lstatSync(absolute, { bigint: true })
      } catch { fail('ignored_inventory_unstable', 'ignored inventory changed during capture') }
      if (!sameStat(before, after)) fail('ignored_inventory_unstable', 'ignored inventory changed during capture')
      records.push({ path: Buffer.from(relative), type: 'symlink', mode, symlink_target_digest: digest(target) })
      return
    }
    if (!before.isDirectory()) fail('unsupported_ignored_entry_type', 'ignored inventory encountered an unsupported entry type')
    records.push({ path: Buffer.from(relative), type: 'directory', mode })
    let names: Buffer[]
    try {
      names = readdirSync(absolute, { encoding: 'buffer' }) as Buffer[]
    } catch { fail('ignored_inventory_unstable', 'ignored inventory changed during capture') }
    names.sort(Buffer.compare)
    for (const name of names) {
      if (name.length === 0 || name.equals(Buffer.from('.')) || name.equals(Buffer.from('..')) || name.includes(0x2f)) fail('ignored_inventory_unstable', 'ignored inventory changed during capture')
      walk(Buffer.concat([relative, SLASH, name]))
    }
    let after: ReturnType<typeof lstatSync>
    try { after = lstatSync(absolute, { bigint: true }) }
    catch { fail('ignored_inventory_unstable', 'ignored inventory changed during capture') }
    if (!sameStat(before, after)) fail('ignored_inventory_unstable', 'ignored inventory changed during capture')
  }

  for (const endpoint of endpointRoots) walk(endpoint)
  records.sort((left, right) => Buffer.compare(left.path, right.path))
  const finalRoots = discoverEndpointRoots(root, limits)
  if (endpointRoots.length !== finalRoots.length || endpointRoots.some((endpoint, index) => !endpoint.equals(finalRoots[index]))) {
    fail('ignored_inventory_unstable', 'ignored inventory changed during capture')
  }
  const inventory = { summary: summarize(records, endpointRoots.length) } as InternalInventory
  Object.defineProperty(inventory, 'records', { value: Object.freeze(records), enumerable: false })
  Object.defineProperty(inventory, ENDPOINT_ROOTS, { value: Object.freeze(endpointRoots), enumerable: false })
  return Object.freeze(inventory)
}

function localDate(value: Date): string {
  if (!Number.isFinite(value.getTime())) fail('repository_mutation', 'repository state changed across the child command')
  const year = String(value.getFullYear()).padStart(4, '0')
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function under(candidate: Buffer, parent: Buffer): boolean {
  return candidate.equals(parent) || candidate.length > parent.length && candidate.subarray(0, parent.length).equals(parent) && candidate[parent.length] === 0x2f
}

function dateRoot(date: string): Buffer {
  return Buffer.from(`${JOINT_POLICY.root}/${date}${JOINT_POLICY.directory_suffix}`)
}

function surface(inventory: InternalInventory, root: Buffer): IgnoredInventoryRecord[] {
  return inventory.records.filter((record) => under(record.path, root))
}

function validSurface(records: readonly IgnoredInventoryRecord[], root: Buffer, allowAbsent: boolean): boolean {
  if (records.length === 0) return allowAbsent
  const safe = Buffer.concat([root, SLASH, Buffer.from(JOINT_POLICY.safe_directory)])
  const readme = Buffer.concat([safe, SLASH, Buffer.from('README.md')])
  const summary = Buffer.concat([safe, SLASH, Buffer.from('joint_local_capture_summary.redacted.json')])
  const expected = [root, safe, readme, summary].sort(Buffer.compare)
  const actual = records.map((record) => record.path).sort(Buffer.compare)
  if (actual.length !== expected.length || actual.some((recordPath, index) => !recordPath.equals(expected[index]))) return false
  const rootRecord = records.find((record) => record.path.equals(root))
  const safeRecord = records.find((record) => record.path.equals(safe))
  const readmeRecord = records.find((record) => record.path.equals(readme))
  const summaryRecord = records.find((record) => record.path.equals(summary))
  if (rootRecord?.type !== 'directory' || safeRecord?.type !== 'directory' || readmeRecord?.type !== 'regular' || summaryRecord?.type !== 'regular') return false
  if (rootRecord.mode !== JOINT_POLICY.modes.directory || safeRecord.mode !== JOINT_POLICY.modes.directory
    || readmeRecord.mode !== JOINT_POLICY.modes.regular_file || summaryRecord.mode !== JOINT_POLICY.modes.regular_file) return false
  if ((readmeRecord.size ?? Number.POSITIVE_INFINITY) > JOINT_POLICY.leaves['README.md']) return false
  if ((summaryRecord.size ?? Number.POSITIVE_INFINITY) > JOINT_POLICY.leaves['joint_local_capture_summary.redacted.json']) return false
  return (readmeRecord.size ?? 0) + (summaryRecord.size ?? 0) <= JOINT_POLICY.max_total_regular_file_bytes
}

function projectedSummary(inventory: InternalInventory, projectedRoot: Buffer): IgnoredInventorySummary {
  const records = inventory.records.filter((record) => !under(record.path, projectedRoot))
  const endpoints = inventory[ENDPOINT_ROOTS].filter((endpoint) => !under(endpoint, projectedRoot))
  return summarize(records, endpoints.length)
}

function surfaceSummary(inventory: InternalInventory, projectedRoot: Buffer): IgnoredInventorySummary {
  const records = surface(inventory, projectedRoot)
  const endpoints = inventory[ENDPOINT_ROOTS].filter((endpoint) => under(endpoint, projectedRoot))
  return summarize(records, endpoints.length)
}

function sameSummary(left: IgnoredInventorySummary, right: IgnoredInventorySummary): boolean {
  return canonical(left) === canonical(right)
}

export function compareIgnoredPathInventories(
  beforeInput: IgnoredPathInventory,
  afterInput: IgnoredPathInventory,
  policy: IgnoredOutputPolicy,
  commandStartedAt: Date,
  commandFinishedAt: Date,
): IgnoredInventoryTransition {
  const before = internalInventory(beforeInput)
  const after = internalInventory(afterInput)
  if (policy === 'none') {
    if (!sameSummary(before.summary, after.summary)) fail('repository_mutation', 'repository state changed across the child command')
    return { before_protected: before.summary, after_protected: after.summary }
  }
  if (policy !== 'sub2api_joint_safe_deliverable_v1') fail('repository_mutation', 'repository state changed across the child command')
  const dates = [...new Set([localDate(commandStartedAt), localDate(commandFinishedAt)])]
  const presentAfter = dates.map((date) => ({ date, root: dateRoot(date) })).filter(({ root }) => surface(after, root).length > 0)
  if (presentAfter.length !== 1) fail('repository_mutation', 'repository state changed across the child command')
  const selected = presentAfter[0].root
  for (const date of dates) {
    const root = dateRoot(date)
    if (!root.equals(selected) && (surface(before, root).length > 0 || surface(after, root).length > 0)) fail('repository_mutation', 'repository state changed across the child command')
  }
  const beforeSurface = surface(before, selected)
  const afterSurface = surface(after, selected)
  if (!validSurface(beforeSurface, selected, true) || !validSurface(afterSurface, selected, false)) fail('repository_mutation', 'repository state changed across the child command')
  const beforeProtected = projectedSummary(before, selected)
  const afterProtected = projectedSummary(after, selected)
  if (!sameSummary(beforeProtected, afterProtected)) fail('repository_mutation', 'repository state changed across the child command')
  return {
    before_protected: beforeProtected,
    after_protected: afterProtected,
    observation: {
      policy,
      policy_digest: IGNORED_OUTPUT_POLICY_DIGESTS[policy],
      before: surfaceSummary(before, selected),
      after: surfaceSummary(after, selected),
    },
  }
}
