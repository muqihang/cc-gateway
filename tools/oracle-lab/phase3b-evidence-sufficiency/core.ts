import { createHash } from 'node:crypto'
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  writeSync,
} from 'node:fs'
import path from 'node:path'

import { canonicalizeJsonValue } from '../../../src/oracle-contract/canonical.js'

export class EvidenceSufficiencyError extends Error {
  constructor(readonly code: string, message: string, readonly json_path = '$') {
    super(message)
    this.name = 'EvidenceSufficiencyError'
  }
}

export const FIXED_SEEDS = [215001, 215002, 215003, 215004, 215005] as const

export const RESOURCE_BUDGET = Object.freeze({
  target_launches_max: 340,
  target_launches_parallel: 1,
  campaign_wall_ms_max: 36_000_000,
  cell_wall_ms_max: 90_000,
  cell_cpu_ms_max: 60_000,
  cell_rss_bytes_max: 1_073_741_824,
  cell_output_bytes_max: 8_388_608,
  cell_processes_max: 16,
  cell_sockets_max: 8,
  cell_retries_max: 8,
  cell_files_max: 512,
  receiver_body_bytes_max: 8_388_608,
  receiver_headers_max: 256,
  receiver_events_max: 1024,
  receiver_attempts_max: 8,
  external_socket_budget: 0,
})

export type EvidenceWriterOwner = 'controller' | 'receiver' | 'probe'

export type DeterministicSchedule = {
  algorithm_id: 'fixed-base-plus-cyclic-rotation-v2'
  encoding_id: 'lp-u32be-v1'
  campaign_id: string
  schedule_id: string
  arm_count: 2 | 4
  seeds: number[]
  seed_vector_digest: string
  sorted_labels: string[]
  base_permutation_digest: string
  offset: number
  direction: 1 | -1
  base: string[]
  orders: string[][]
  run_ids: string[][]
  deterministic_repeat_digest: string
}

export type ResourceCounters = {
  wall_ms: number
  cpu_ms: number
  rss_bytes: number
  output_bytes: number
  processes: number
  sockets: number
  retries: number
  files: number
  body_bytes: number
  headers: number
  events: number
  attempts: number
}

export function sha256Bytes(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function canonicalEvidenceBytes(value: unknown): Buffer {
  return canonicalizeJsonValue(value)
}

function fail(code: string, message: string, jsonPath = '$'): never {
  throw new EvidenceSufficiencyError(code, message, jsonPath)
}

function u32(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) fail('arm_order_ambiguous_encoding', 'value is not an unsigned 32-bit integer')
  const output = Buffer.alloc(4)
  output.writeUInt32BE(value)
  return output
}

function lp(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8')
  return Buffer.concat([u32(bytes.length), bytes])
}

function hash(value: Uint8Array): Buffer {
  return createHash('sha256').update(value).digest()
}

function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus
}

function canonicalUtf8Sort(values: readonly string[]): string[] {
  return [...values].sort((left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')))
}

function validateScheduleInputs(campaignId: string, scheduleId: string, labels: readonly string[], seeds: readonly number[]): asserts labels is readonly string[] {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,191}$/.test(campaignId) || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,191}$/.test(scheduleId)) {
    fail('arm_order_ambiguous_encoding', 'campaign and schedule IDs must be bounded safe identifiers')
  }
  if (seeds.length !== FIXED_SEEDS.length || seeds.some((seed, index) => seed !== FIXED_SEEDS[index]) || new Set(seeds).size !== seeds.length) {
    fail('arm_order_seed_vector_invalid', 'seed vector differs from the fixed five-seed vector')
  }
  if (labels.length !== 2 && labels.length !== 4) fail('arm_order_count_mismatch', 'arm count must be 2 or 4')
  if (new Set(labels).size !== labels.length || labels.some((label) => !/^[a-z][a-z/-]{0,63}$/.test(label))) {
    fail('arm_order_label_invalid', 'arm labels must be nonempty, unique, and safe')
  }
  const sorted = canonicalUtf8Sort(labels)
  if (sorted.some((label, index) => label !== labels[index])) fail('arm_order_label_invalid', 'arm labels must already be in unsigned UTF-8 byte order')
}

function seedVectorDigest(seeds: readonly number[]): Buffer {
  return hash(Buffer.concat([lp('p3b-es1-seed-vector-v1'), u32(seeds.length), ...seeds.map(u32)]))
}

function runId(campaignId: string, scheduleId: string, label: string, repetition: number, stimulusSeed: number): string {
  return hash(Buffer.concat([
    lp('p3b-es1-run-id-v1'), lp(campaignId), lp(scheduleId), lp(label), u32(repetition), u32(stimulusSeed),
  ])).toString('hex')
}

export function buildDeterministicSchedule(
  campaignId: string,
  scheduleId: string,
  labelsInput: readonly string[],
  seedsInput: readonly number[] = FIXED_SEEDS,
): DeterministicSchedule {
  validateScheduleInputs(campaignId, scheduleId, labelsInput, seedsInput)
  const labels = [...labelsInput]
  const seeds = [...seedsInput]
  const armCount = labels.length as 2 | 4
  const seedDigest = seedVectorDigest(seeds)
  const encoded = Buffer.concat([
    lp('p3b-es1-arm-order-v2'), lp(campaignId), lp(scheduleId), u32(armCount), u32(labels.length),
    ...labels.map(lp), u32(seedDigest.length), seedDigest,
  ])
  const digest = hash(encoded)
  const offset = digest.readUInt32BE(0) % armCount
  const direction = (digest[4] & 1) === 0 ? 1 : -1
  const base = labels.map((_, index) => labels[positiveMod(offset + direction * index, armCount)])
  const orders = seeds.map((_, repetition) => base.map((__, ordinal) => base[(ordinal + repetition) % armCount]))
  const runIds = orders.map((order, repetition) => order.map((label) => runId(campaignId, scheduleId, label, repetition, seeds[repetition])))
  const payload = {
    algorithm_id: 'fixed-base-plus-cyclic-rotation-v2' as const,
    encoding_id: 'lp-u32be-v1' as const,
    campaign_id: campaignId,
    schedule_id: scheduleId,
    arm_count: armCount,
    seeds,
    seed_vector_digest: seedDigest.toString('hex'),
    sorted_labels: labels,
    base_permutation_digest: digest.toString('hex'),
    offset,
    direction: direction as 1 | -1,
    base,
    orders,
    run_ids: runIds,
  }
  const deterministicRepeatDigest = sha256Bytes(Buffer.from(JSON.stringify(payload), 'utf8'))
  const ids = runIds.flat()
  if (ids.length !== armCount * FIXED_SEEDS.length || new Set(ids).size !== ids.length) fail('arm_order_repeat_mismatch', 'run IDs are not unique')
  return { ...payload, deterministic_repeat_digest: deterministicRepeatDigest }
}

function ensureRoot(rootInput: string): string {
  const absolute = path.resolve(rootInput)
  if (!existsSync(absolute)) fail('evidence_root_missing', 'evidence root must already exist')
  const stat = lstatSync(absolute)
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('evidence_root_unsafe', 'evidence root must be a real directory')
  return realpathSync(absolute)
}

function safeRelative(relativeInput: string): string {
  if (relativeInput.length === 0 || path.isAbsolute(relativeInput) || relativeInput.includes('\\')) fail('source_binding_invalid', 'artifact path must be POSIX-relative')
  const normalized = path.posix.normalize(relativeInput)
  if (normalized !== relativeInput || normalized === '.' || normalized.split('/').includes('..') || normalized.split('/').includes('')) {
    fail('source_binding_invalid', 'artifact path is not canonical')
  }
  return normalized
}

function assertNoExistingSymlink(root: string, destination: string): void {
  let cursor = root
  const relative = path.relative(root, destination)
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment)
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) fail('source_binding_invalid', 'artifact path contains a symlink')
  }
}

function assertWriterNamespace(relative: string, owner: EvidenceWriterOwner): void {
  const receiver = 'capsules/P3B-ES1/observations/receiver/'
  const probe = 'capsules/P3B-ES1/control/probe/'
  if (owner === 'receiver' && !relative.startsWith(receiver)) fail('writer_namespace_violation', 'receiver may write only receiver observations')
  if (owner === 'probe' && !relative.startsWith(probe)) fail('writer_namespace_violation', 'probe may write only probe control artifacts')
  if (owner === 'controller' && (relative.startsWith(receiver) || relative.startsWith(probe))) {
    fail('writer_namespace_violation', 'controller cannot write receiver or probe namespaces')
  }
}

const FORBIDDEN_KEYS = new Set([
  'raw_prompt', 'raw_body', 'response_body', 'credential_value', 'token_value', 'cookie_value',
  'secret', 'account_identifier', 'home_path', 'unnormalized_transcript', 'raw_stdout', 'raw_stderr',
  'raw_headers', 'raw_response', 'raw_request',
])

function assertNormalizedSafe(value: unknown, location = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNormalizedSafe(entry, `${location}[${index}]`))
    return
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return
  if (typeof value === 'string') {
    if (/\bBearer\s+[A-Za-z0-9._~+/-]{4,}/i.test(value) || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)) {
      fail('leak_detected', `${location} contains credential-like material`, location)
    }
    return
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) fail('schema_invalid', `${location} is not a JSON value`, location)
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) fail('schema_invalid', `${location}.${key} is forbidden`, `${location}.${key}`)
    assertNormalizedSafe(entry, `${location}.${key}`)
  }
}

export function writeExclusiveEvidence(
  rootInput: string,
  relativeInput: string,
  value: unknown,
  owner: EvidenceWriterOwner,
): { relative_path: string; sha256: string; size: number } {
  const root = ensureRoot(rootInput)
  const relative = safeRelative(relativeInput)
  assertWriterNamespace(relative, owner)
  assertNormalizedSafe(value)
  const destination = path.resolve(root, ...relative.split('/'))
  const parent = path.dirname(destination)
  if (!path.relative(root, destination) || path.relative(root, destination).startsWith(`..${path.sep}`) || path.isAbsolute(path.relative(root, destination))) {
    fail('source_binding_invalid', 'artifact path escapes evidence root')
  }
  assertNoExistingSymlink(root, destination)
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  assertNoExistingSymlink(root, destination)
  const payload = canonicalEvidenceBytes(value)
  let descriptor: number | undefined
  try {
    descriptor = openSync(destination, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), 0o600)
    let offset = 0
    while (offset < payload.length) offset += writeSync(descriptor, payload, offset, payload.length - offset)
    fsyncSync(descriptor)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('evidence_exists', 'append-only artifact already exists')
    throw error
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  return { relative_path: relative, sha256: sha256Bytes(payload), size: payload.length }
}

function escapedPointer(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1')
}

function differencePointers(left: unknown, right: unknown, pointer: string, output: string[]): void {
  if (Object.is(left, right)) return
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) output.push(`${pointer}/length` || '/length')
    const length = Math.min(left.length, right.length)
    for (let index = 0; index < length; index += 1) differencePointers(left[index], right[index], `${pointer}/${index}`, output)
    return
  }
  if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
    const keys = canonicalUtf8Sort([...new Set([...Object.keys(left as object), ...Object.keys(right as object)])])
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(left, key) || !Object.prototype.hasOwnProperty.call(right, key)) output.push(`${pointer}/${escapedPointer(key)}`)
      else differencePointers((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], `${pointer}/${escapedPointer(key)}`, output)
    }
    return
  }
  output.push(pointer || '/')
}

export function comparePairedProjection(left: unknown, right: unknown): { equivalent: boolean; differing_pointers: string[] } {
  const pointers: string[] = []
  differencePointers(left, right, '', pointers)
  const differing = [...new Set(pointers)].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
  return { equivalent: differing.length === 0, differing_pointers: differing }
}

export function evaluateResourceLimits(counters: ResourceCounters, limits: ResourceCounters): string | null {
  const checks: Array<[keyof ResourceCounters, string]> = [
    ['wall_ms', 'wall_limit'],
    ['cpu_ms', 'cpu_limit'],
    ['rss_bytes', 'rss_limit'],
    ['output_bytes', 'output_limit'],
    ['processes', 'process_limit'],
    ['sockets', 'socket_limit'],
    ['retries', 'retry_limit'],
    ['files', 'file_limit'],
    ['body_bytes', 'receiver_body_overflow'],
    ['headers', 'receiver_header_overflow'],
    ['events', 'receiver_event_overflow'],
    ['attempts', 'receiver_attempt_overflow'],
  ]
  for (const [field, code] of checks) {
    if (!Number.isSafeInteger(counters[field]) || counters[field] < 0 || !Number.isSafeInteger(limits[field]) || limits[field] < 0) {
      fail('resource_counter_invalid', `${field} must be a non-negative safe integer`)
    }
    if (counters[field] > limits[field]) return code
  }
  return null
}

export function classifyRetryOwner(input: { attempts_by_launch: readonly (readonly number[])[]; launcher_retry_count: number }): 'client' | 'launcher' | 'none' {
  if (!Number.isSafeInteger(input.launcher_retry_count) || input.launcher_retry_count < 0) fail('retry_owner_ambiguous', 'launcher retry count is invalid')
  if (input.attempts_by_launch.length !== input.launcher_retry_count + 1 || input.attempts_by_launch.length === 0) {
    fail('retry_owner_ambiguous', 'launch count and launcher retry count disagree')
  }
  let clientRetry = false
  for (const attempts of input.attempts_by_launch) {
    if (attempts.length === 0 || attempts.some((ordinal, index) => ordinal !== index)) fail('attempt_sequence_invalid', 'attempt ordinals must be unique and gap-free from zero')
    if (attempts.length > 1) clientRetry = true
  }
  const launcherRetry = input.launcher_retry_count > 0
  if (clientRetry && launcherRetry) fail('retry_owner_ambiguous', 'client and launcher retries are mixed')
  if (clientRetry) return 'client'
  if (launcherRetry) return 'launcher'
  return 'none'
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false
  const normalized = address.toLowerCase()
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === '::ffff:127.0.0.1'
}
