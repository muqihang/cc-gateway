import { createHash } from 'node:crypto'

export class Phase3BProductionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'Phase3BProductionError'
    this.code = code
  }
}

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }

export function utf8Compare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function normalize(value: unknown, seen: Set<object>): Json {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Phase3BProductionError('canonical_json_invalid', 'only safe integer JSON numbers are permitted')
    return value
  }
  if (typeof value !== 'object' || value === undefined) throw new Phase3BProductionError('canonical_json_invalid', 'value is not closed JSON')
  if (seen.has(value)) throw new Phase3BProductionError('canonical_json_invalid', 'cyclic JSON is forbidden')
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map((entry) => normalize(entry, seen))
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new Phase3BProductionError('canonical_json_invalid', 'non-plain JSON object is forbidden')
    const result: Record<string, Json> = {}
    for (const key of Object.keys(value).sort(utf8Compare)) result[key] = normalize((value as Record<string, unknown>)[key], seen)
    return result
  } finally {
    seen.delete(value)
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new Set()))
}

export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value), 'utf8')
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function sha256Canonical(value: unknown): string {
  return sha256Bytes(canonicalBytes(value))
}

export function assertSha256(value: unknown, code = 'digest_invalid', field = 'sha256'): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Phase3BProductionError(code, `${field} must be lowercase SHA-256`)
}

export function assertExactKeys(value: unknown, expected: readonly string[], code: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Phase3BProductionError(code, 'closed object is required')
  const actual = Object.keys(value).sort(utf8Compare)
  const wanted = [...expected].sort(utf8Compare)
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Phase3BProductionError(code, 'object fields are missing, unknown, or duplicated')
}

export function deterministicUuidV4(value: unknown): string {
  const bytes = Buffer.from(sha256Canonical(value).slice(0, 32), 'hex')
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

export function withoutDigest<T extends Record<string, unknown>>(value: T, digestField: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== digestField))
}

export function assertDigestField(value: Record<string, unknown>, digestField: string, code: string): void {
  assertSha256(value[digestField], code, digestField)
  if (value[digestField] !== sha256Canonical(withoutDigest(value, digestField))) throw new Phase3BProductionError(code, `${digestField} does not match canonical bytes`)
}
