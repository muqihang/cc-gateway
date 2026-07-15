import { createHash } from 'node:crypto'
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from 'node:fs'

export const MAX_EVIDENCE_FILE_BYTES = 8 * 1024 * 1024
export const MAX_EVIDENCE_AGGREGATE_BYTES = 64 * 1024 * 1024
export const MAX_CODEGRAPH_DATABASE_BYTES = 512 * 1024 * 1024
export const MAX_CODEGRAPH_AGGREGATE_BYTES = 1024 * 1024 * 1024
export const BOUNDED_READ_BUFFER_BYTES = 1024 * 1024
export const BOUNDED_FILE_LIMITS = Object.freeze({
  maxEvidenceFileBytes: MAX_EVIDENCE_FILE_BYTES,
  maxEvidenceAggregateBytes: MAX_EVIDENCE_AGGREGATE_BYTES,
  maxCodeGraphDatabaseBytes: MAX_CODEGRAPH_DATABASE_BYTES,
  maxCodeGraphAggregateBytes: MAX_CODEGRAPH_AGGREGATE_BYTES,
  readBufferBytes: BOUNDED_READ_BUFFER_BYTES,
})

export type BoundedReadBudget = { readonly limit: number; bytes: number }
export type BoundedReadOptions = Readonly<{ maxBytes: number; budget: BoundedReadBudget }>
export type BoundedFileDigest = Readonly<{ size: number; digest: string }>
export type BoundedFileRead = BoundedFileDigest & Readonly<{ bytes: Buffer }>

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

function validLimit(value: number, ceiling: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= ceiling
}

export function createBoundedReadBudget(limit: number): BoundedReadBudget {
  if (!validLimit(limit, MAX_CODEGRAPH_AGGREGATE_BYTES)) {
    fail('bounded_file_limit_invalid', 'bounded-file aggregate limit is outside the reviewed ceiling')
  }
  return { limit, bytes: 0 }
}

function validateOptions(options: BoundedReadOptions): void {
  if (!validLimit(options.maxBytes, MAX_CODEGRAPH_DATABASE_BYTES)
    || !validLimit(options.budget.limit, MAX_CODEGRAPH_AGGREGATE_BYTES)
    || !Number.isSafeInteger(options.budget.bytes)
    || options.budget.bytes < 0
    || options.budget.bytes > options.budget.limit) {
    fail('bounded_file_limit_invalid', 'bounded-file limits are outside the reviewed ceilings')
  }
}

type BigIntFileStat = ReturnType<typeof lstatSync>

function sameIdentity(left: BigIntFileStat, right: ReturnType<typeof fstatSync>): boolean {
  const a = left as unknown as Record<string, bigint>
  const b = right as unknown as Record<string, bigint>
  return a.dev === b.dev
    && a.ino === b.ino
    && a.mode === b.mode
    && a.size === b.size
    && a.mtimeNs === b.mtimeNs
    && a.ctimeNs === b.ctimeNs
}

function consumeBoundedRegularFile(file: string, options: BoundedReadOptions, collect: boolean): BoundedFileRead | BoundedFileDigest {
  validateOptions(options)
  let before: BigIntFileStat
  try {
    before = lstatSync(file, { bigint: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail('bounded_file_missing', 'bounded regular file is missing')
    fail('bounded_file_read_failed', 'bounded regular file metadata is unavailable')
  }
  if (!before.isFile() || before.isSymbolicLink()) fail('bounded_file_type_invalid', 'bounded input must be a regular non-symlink file')
  const declaredSize = Number((before as unknown as { size: bigint }).size)
  if (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > options.maxBytes) {
    fail('bounded_file_size_limit_exceeded', 'bounded input exceeds the reviewed apparent-byte limit')
  }
  if (options.budget.bytes + declaredSize > options.budget.limit) {
    fail('bounded_file_aggregate_limit_exceeded', 'bounded inputs exceed the reviewed aggregate apparent-byte limit')
  }
  if (fsConstants.O_NOFOLLOW === undefined) fail('bounded_file_open_failed', 'O_NOFOLLOW is unavailable')

  let descriptor: number | undefined
  try {
    try {
      descriptor = openSync(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    } catch (error) {
      if (['ELOOP', 'ENOENT', 'ENOTDIR'].includes(String((error as NodeJS.ErrnoException).code))) {
        fail('bounded_file_race_detected', 'bounded input changed before descriptor open')
      }
      fail('bounded_file_open_failed', 'bounded input could not be opened')
    }
    const opened = fstatSync(descriptor, { bigint: true })
    if (!opened.isFile() || !sameIdentity(before, opened)) fail('bounded_file_race_detected', 'bounded input identity changed during open')

    const hash = createHash('sha256')
    const bytes = collect ? Buffer.allocUnsafe(declaredSize) : undefined
    const buffer = collect ? bytes! : Buffer.allocUnsafe(BOUNDED_READ_BUFFER_BYTES)
    let total = 0
    while (total < declaredSize) {
      let count: number
      try {
        count = readSync(descriptor, buffer, collect ? total : 0, Math.min(BOUNDED_READ_BUFFER_BYTES, declaredSize - total), null)
      } catch {
        fail('bounded_file_read_failed', 'bounded input read failed')
      }
      if (count === 0) break
      hash.update(buffer.subarray(collect ? total : 0, (collect ? total : 0) + count))
      total += count
    }
    const extra = Buffer.allocUnsafe(1)
    let extraCount: number
    try { extraCount = readSync(descriptor, extra, 0, 1, null) } catch { fail('bounded_file_read_failed', 'bounded input read failed') }
    const final = fstatSync(descriptor, { bigint: true })
    if (total !== declaredSize || extraCount !== 0 || !final.isFile() || !sameIdentity(before, final)) {
      fail('bounded_file_race_detected', 'bounded input changed during read')
    }
    options.budget.bytes += declaredSize
    const digest = `sha256:${hash.digest('hex')}`
    return collect ? Object.freeze({ size: declaredSize, digest, bytes: bytes! }) : Object.freeze({ size: declaredSize, digest })
  } catch (error) {
    if (String((error as Error & { code?: string }).code).startsWith('bounded_file_')) throw error
    fail('bounded_file_read_failed', 'bounded input read failed')
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor) } catch { /* descriptor close cannot change an accepted read */ }
    }
  }
  fail('bounded_file_read_failed', 'bounded input read failed')
}

export function readBoundedRegularFile(file: string, options: BoundedReadOptions): BoundedFileRead {
  return consumeBoundedRegularFile(file, options, true) as BoundedFileRead
}

export function hashBoundedRegularFile(file: string, options: BoundedReadOptions): BoundedFileDigest {
  return consumeBoundedRegularFile(file, options, false) as BoundedFileDigest
}
