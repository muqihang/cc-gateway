import { constants, closeSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statSync, writeSync } from 'node:fs'
import path from 'node:path'

import { Phase3BProductionError, canonicalBytes, sha256Bytes } from './core.js'

export type StableFileIdentity = Readonly<{
  path: string
  realpath: string
  dev: number
  ino: number
  uid: number
  gid: number
  mode: number
  nlink: number
  size: number
  ctime_ns: string
  mtime_ns: string
  sha256: string
}>

function timeNs(stat: ReturnType<typeof fstatSync>, name: 'ctimeMs' | 'mtimeMs'): string {
  return String(BigInt(Math.round(Number(stat[name]) * 1_000_000)))
}

export function assertAbsoluteNoSymlinkComponents(target: string, requireLeaf = true): string {
  if (!path.isAbsolute(target) || path.normalize(target) !== target) throw new Phase3BProductionError('sealed_path_invalid', 'path must be absolute and normalized')
  const parsed = path.parse(target)
  let cursor = parsed.root
  const components = target.slice(parsed.root.length).split(path.sep).filter(Boolean)
  for (let index = 0; index < components.length; index += 1) {
    cursor = path.join(cursor, components[index])
    try {
      const stat = lstatSync(cursor)
      if (stat.isSymbolicLink()) throw new Phase3BProductionError('sealed_path_invalid', 'path contains a symbolic-link component')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !requireLeaf && index === components.length - 1) return target
      throw error
    }
  }
  return target
}

export function assertPrivateRuntimeRoot(runtimeRoot: string): string {
  const root = assertAbsoluteNoSymlinkComponents(path.resolve(runtimeRoot))
  const stat = lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(root) !== root || (stat.mode & 0o777) !== 0o700) throw new Phase3BProductionError('runtime_root_invalid', 'runtime root must be a real private 0700 directory')
  return root
}

export function createPrivateDirectory(root: string, relative: string): string {
  const runtimeRoot = assertPrivateRuntimeRoot(root)
  if (path.isAbsolute(relative) || relative.split(path.sep).some((part) => !part || part === '.' || part === '..')) throw new Phase3BProductionError('sealed_path_invalid', 'relative directory path is not closed')
  let cursor = runtimeRoot
  for (const component of relative.split(path.sep)) {
    cursor = path.join(cursor, component)
    try { mkdirSync(cursor, { mode: 0o700 }) } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    const stat = lstatSync(cursor)
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(cursor) !== cursor || (stat.mode & 0o777) !== 0o700) throw new Phase3BProductionError('sealed_path_invalid', 'sealed directory identity or mode is invalid')
  }
  return cursor
}

export function resolveContained(root: string, relative: string): string {
  const runtimeRoot = assertPrivateRuntimeRoot(root)
  if (path.isAbsolute(relative) || relative.split(path.sep).some((part) => !part || part === '.' || part === '..')) throw new Phase3BProductionError('sealed_path_invalid', 'relative path is not closed')
  const target = path.resolve(runtimeRoot, relative)
  if (!target.startsWith(`${runtimeRoot}${path.sep}`)) throw new Phase3BProductionError('sealed_path_invalid', 'path escapes sealed runtime root')
  assertAbsoluteNoSymlinkComponents(path.dirname(target))
  return target
}

export function stableRead(file: string, options: { mode?: number; maximumBytes?: number; nonempty?: boolean } = {}): { bytes: Buffer; identity: StableFileIdentity } {
  const exact = assertAbsoluteNoSymlinkComponents(path.resolve(file))
  const pathStat = lstatSync(exact)
  if (!pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.nlink !== 1) throw new Phase3BProductionError('sealed_file_invalid', 'sealed input must be a regular single-link file')
  if (options.mode !== undefined && (pathStat.mode & 0o777) !== options.mode) throw new Phase3BProductionError('sealed_file_invalid', 'sealed input mode drifted')
  const fd = openSync(exact, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = fstatSync(fd)
    const maximum = options.maximumBytes ?? 67_108_864
    if (before.size > maximum || (options.nonempty !== false && before.size === 0)) throw new Phase3BProductionError('sealed_file_invalid', 'sealed input size is outside its fixed boundary')
    const bytes = readFileSync(fd)
    const after = fstatSync(fd)
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.ctimeMs !== after.ctimeMs || before.mtimeMs !== after.mtimeMs || after.nlink !== 1) throw new Phase3BProductionError('sealed_file_invalid', 'sealed input changed while reading')
    const identity = Object.freeze({ path: exact, realpath: realpathSync(exact), dev: after.dev, ino: after.ino, uid: after.uid, gid: after.gid, mode: after.mode & 0o777, nlink: after.nlink, size: after.size, ctime_ns: timeNs(after, 'ctimeMs'), mtime_ns: timeNs(after, 'mtimeMs'), sha256: sha256Bytes(bytes) })
    if (identity.realpath !== exact) throw new Phase3BProductionError('sealed_file_invalid', 'sealed input realpath drifted')
    return { bytes, identity }
  } finally { closeSync(fd) }
}

export function readCanonicalTransport(file: string, options: { mode?: number; maximumBytes?: number; nonempty?: boolean } = {}): { bytes: Buffer; identity: StableFileIdentity; value: Record<string, unknown> } {
  const { bytes, identity } = stableRead(file, options)
  const payload = bytes.at(-1) === 0x0a ? bytes.subarray(0, -1) : bytes
  if (payload.includes(0x0a) || payload.includes(0x0d)) throw new Phase3BProductionError('canonical_record_invalid', 'canonical transport contains noncanonical line breaks')
  let value: unknown
  try { value = JSON.parse(payload.toString('utf8')) } catch { throw new Phase3BProductionError('canonical_record_invalid', 'canonical transport JSON is invalid') }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !canonicalBytes(value).equals(payload)) throw new Phase3BProductionError('canonical_record_invalid', 'canonical transport is not canonical JSON')
  return { bytes, identity, value: value as Record<string, unknown> }
}

export function writeExclusiveBytes(root: string, relative: string, bytes: Uint8Array, mode = 0o600): StableFileIdentity {
  const file = resolveContained(root, relative)
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode)
  try {
    fchmodSync(fd, mode)
    let offset = 0
    while (offset < bytes.byteLength) offset += writeSync(fd, bytes, offset, bytes.byteLength - offset)
    fsyncSync(fd)
  } finally { closeSync(fd) }
  return stableRead(file, { mode, maximumBytes: Math.max(bytes.byteLength, 1), nonempty: bytes.byteLength !== 0 }).identity
}

export function writeExclusiveCanonical(root: string, relative: string, value: unknown): StableFileIdentity {
  return writeExclusiveBytes(root, relative, Buffer.concat([canonicalBytes(value), Buffer.from('\n', 'utf8')]), 0o600)
}

export function readCanonical(root: string, relative: string, maximumBytes = 1_048_576): { value: Record<string, unknown>; identity: StableFileIdentity } {
  const file = resolveContained(root, relative)
  const { bytes, identity } = stableRead(file, { mode: 0o600, maximumBytes })
  if (bytes.at(-1) !== 0x0a || bytes.subarray(0, -1).includes(0x0a)) throw new Phase3BProductionError('canonical_record_invalid', 'record must be one canonical JSON line')
  let value: unknown
  try { value = JSON.parse(bytes.subarray(0, -1).toString('utf8')) } catch { throw new Phase3BProductionError('canonical_record_invalid', 'record is not valid UTF-8 JSON') }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !canonicalBytes(value).equals(bytes.subarray(0, -1))) throw new Phase3BProductionError('canonical_record_invalid', 'record is not canonical closed JSON')
  return { value: value as Record<string, unknown>, identity }
}

export function assertDirectoryEmpty(directory: string): void {
  const root = assertAbsoluteNoSymlinkComponents(path.resolve(directory))
  const stat = statSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Phase3BProductionError('namespace_invalid', 'evidence root is not a directory')
  const entries = readdirSync(root)
  if (entries.length !== 0) throw new Phase3BProductionError('namespace_invalid', 'new evidence root must be empty')
}
