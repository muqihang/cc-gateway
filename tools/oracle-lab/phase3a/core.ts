import { createHash } from 'node:crypto'
import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs'
import path from 'node:path'

export class Phase3AError extends Error {
  constructor(readonly code: string, message: string, readonly jsonPath = '$') {
    super(message)
    this.name = 'Phase3AError'
  }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Phase3AError('canonicalization_failed', 'undefined is not canonical JSON')
  return encoded
}

export function sha256Bytes(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function sha256File(file: string): string {
  const hash = createHash('sha256')
  const fd = openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    const before = fstatSync(fd)
    let offset = 0
    while (true) {
      const count = readSync(fd, buffer, 0, buffer.length, offset)
      if (count === 0) break
      hash.update(buffer.subarray(0, count))
      offset += count
    }
    const after = fstatSync(fd)
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || offset !== before.size) {
      throw new Phase3AError('artifact_identity', 'file changed while hashing')
    }
  } finally {
    closeSync(fd)
  }
  return hash.digest('hex')
}

export function ensureEvidenceRoot(rootInput: string): string {
  const absolute = path.resolve(rootInput)
  mkdirSync(absolute, { recursive: true, mode: 0o700 })
  const root = realpathSync(absolute)
  const stat = lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Phase3AError('unsafe_evidence_root', 'evidence root must be a real directory')
  }
  return root
}

export function assertEvidencePath(rootInput: string, candidateInput: string): string {
  const root = ensureEvidenceRoot(rootInput)
  const candidate = path.resolve(candidateInput)
  const relative = path.relative(root, candidate)
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Phase3AError('path_outside_evidence_root', 'path must be below the evidence root')
  }

  let cursor = path.dirname(candidate)
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  const realParent = realpathSync(cursor)
  const parentRelative = path.relative(root, realParent)
  if (parentRelative === '..' || parentRelative.startsWith(`..${path.sep}`) || path.isAbsolute(parentRelative)) {
    throw new Phase3AError('path_outside_evidence_root', 'path parent escapes the evidence root')
  }
  return candidate
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

export function stableError(error: unknown): { code: string; message: string; path: string } {
  if (error instanceof Phase3AError) return { code: error.code, message: error.message, path: error.jsonPath }
  return { code: 'unknown', message: error instanceof Error ? error.message : String(error), path: '$' }
}
