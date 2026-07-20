import { createReadStream, existsSync, mkdirSync, openSync, closeSync, writeSync, chmodSync, statSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import path from 'node:path'

import { Phase3AError } from './core.js'
import { digestTree, type TreeFileRecord } from './tree-digest.js'

const DECODER = new TextDecoder('utf-8', { fatal: true })

export type ArchiveLimits = {
  archiveBytes: number
  totalRegularBytes: number
  entries: number
  regularFiles: number
  singleRegularBytes: number
  pathDepth: number
  pathBytes: number
  expansionRatio: number | null
}

export type SafeTarResult = {
  tree_sha256: string
  tree_algorithm: string
  inventory: TreeFileRecord[]
  archive_bytes: number
  regular_file_bytes: number
  regular_file_count: number
  expansion_ratio: number
  warnings: string[]
}

type Entry = {
  kind: 'regular' | 'directory' | 'pax' | 'global-pax' | 'gnu-long-path' | 'gnu-long-link'
  path: string
  size: number
  mode: number
}

function decode(bytes: Buffer, label: string): string {
  try { return DECODER.decode(bytes) }
  catch { throw new Phase3AError('archive_unsafe', `${label} is not valid UTF-8`) }
}

function cString(field: Buffer, label: string): string {
  const nul = field.indexOf(0)
  return decode(nul === -1 ? field : field.subarray(0, nul), label)
}

function tarNumber(field: Buffer, label: string): number {
  if ((field[0] & 0x80) !== 0) throw new Phase3AError('unsupported_format', `${label} uses unsupported base-256 encoding`)
  const text = cString(field, label).trim().replace(/^0+/, '')
  if (text === '') return 0
  if (!/^[0-7]+$/.test(text)) throw new Phase3AError('archive_unsafe', `${label} is not octal`)
  const value = Number.parseInt(text, 8)
  if (!Number.isSafeInteger(value) || value < 0) throw new Phase3AError('archive_unsafe', `${label} is out of range`)
  return value
}

function verifyChecksum(header: Buffer): void {
  const expected = tarNumber(header.subarray(148, 156), 'tar checksum')
  let actual = 0
  for (let index = 0; index < 512; index += 1) actual += index >= 148 && index < 156 ? 0x20 : header[index]
  if (actual !== expected) throw new Phase3AError('archive_unsafe', 'tar header checksum mismatch')
}

function parseHeader(header: Buffer): Entry | null {
  if (header.every((byte) => byte === 0)) return null
  verifyChecksum(header)
  const name = cString(header.subarray(0, 100), 'tar path')
  const prefix = cString(header.subarray(345, 500), 'tar prefix')
  const combined = prefix ? `${prefix}/${name}` : name
  const type = String.fromCharCode(header[156] || 0)
  const kind = type === '\0' || type === '0' ? 'regular'
    : type === '5' ? 'directory'
      : type === 'x' ? 'pax'
        : type === 'g' ? 'global-pax'
          : type === 'L' ? 'gnu-long-path'
            : type === 'K' ? 'gnu-long-link'
              : null
  if (!kind) {
    const description = type === '1' ? 'hardlink' : type === '2' ? 'symlink' : `special type ${JSON.stringify(type)}`
    throw new Phase3AError('archive_unsafe', `${description} is forbidden`)
  }
  return { kind, path: combined, size: tarNumber(header.subarray(124, 136), 'tar size'), mode: tarNumber(header.subarray(100, 108), 'tar mode') }
}

function parsePax(data: Buffer): Record<string, string> {
  const result: Record<string, string> = {}
  let offset = 0
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset)
    if (space === -1) throw new Phase3AError('archive_unsafe', 'invalid PAX record length')
    const lengthText = data.subarray(offset, space).toString('ascii')
    if (!/^[1-9][0-9]*$/.test(lengthText)) throw new Phase3AError('archive_unsafe', 'invalid PAX record length')
    const length = Number(lengthText)
    if (!Number.isSafeInteger(length) || offset + length > data.length || data[offset + length - 1] !== 0x0a) {
      throw new Phase3AError('archive_unsafe', 'truncated PAX record')
    }
    const record = data.subarray(space + 1, offset + length - 1)
    const equals = record.indexOf(0x3d)
    if (equals <= 0) throw new Phase3AError('archive_unsafe', 'invalid PAX key/value')
    const key = decode(record.subarray(0, equals), 'PAX key')
    const value = decode(record.subarray(equals + 1), `PAX ${key}`)
    result[key] = value
    offset += length
  }
  return result
}

function validatePath(rawInput: string, limits: ArchiveLimits): { value: string; bytes: Buffer } {
  const raw = rawInput.replace(/\/$/, '')
  if (!raw || raw.includes('\0') || raw.includes('\\') || path.posix.isAbsolute(raw)) {
    throw new Phase3AError('archive_unsafe', `unsafe archive path: ${JSON.stringify(raw)}`)
  }
  const parts = raw.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..') || path.posix.normalize(raw) !== raw || raw.normalize('NFC') !== raw) {
    throw new Phase3AError('archive_unsafe', `non-normalized archive path: ${JSON.stringify(raw)}`)
  }
  const bytes = Buffer.from(raw, 'utf8')
  if (bytes.length > limits.pathBytes) throw new Phase3AError('archive_unsafe', 'archive path length limit exceeded')
  if (parts.length > limits.pathDepth) throw new Phase3AError('archive_unsafe', 'archive path depth limit exceeded')
  return { value: raw, bytes }
}

export async function extractTarGzSafely(archive: string, destination: string, limits: ArchiveLimits): Promise<SafeTarResult> {
  if (existsSync(destination)) throw new Phase3AError('unpack_failed', 'fresh unpack destination already exists')
  const archiveBytes = statSync(archive).size
  if (archiveBytes > limits.archiveBytes) throw new Phase3AError('disk_limit', 'archive exceeds absolute byte limit')
  mkdirSync(destination, { recursive: true, mode: 0o700 })

  let buffered = Buffer.alloc(0)
  let state: 'header' | 'data' | 'padding' | 'end' = 'header'
  let entry: Entry | null = null
  let remaining = 0
  let padding = 0
  let fd: number | null = null
  let metadata: Buffer[] = []
  let pendingPax: Record<string, string> = {}
  let globalPax: Record<string, string> = {}
  let pendingLongPath: string | undefined
  let pendingLongLink: string | undefined
  let regularBytes = 0
  let regularFiles = 0
  let entries = 0
  let zeroBlocks = 0
  const exact = new Set<string>()
  const folded = new Set<string>()

  const beginEntry = (parsed: Entry): void => {
    entries += 1
    if (entries > limits.entries) throw new Phase3AError('disk_limit', 'archive entry count limit exceeded')
    const pax = { ...globalPax, ...pendingPax }
    pendingPax = {}
    const pathInput = pendingLongPath ?? pax.path ?? parsed.path
    pendingLongPath = undefined
    const linkInput = pendingLongLink ?? pax.linkpath
    pendingLongLink = undefined
    if (linkInput !== undefined) throw new Phase3AError('archive_unsafe', 'link metadata is forbidden')
    if (pax.size !== undefined) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(pax.size)) throw new Phase3AError('archive_unsafe', 'invalid PAX size')
      parsed.size = Number(pax.size)
    }
    if (!Number.isSafeInteger(parsed.size) || parsed.size < 0) throw new Phase3AError('archive_unsafe', 'entry size is out of range')
    if (parsed.kind === 'pax' || parsed.kind === 'global-pax' || parsed.kind === 'gnu-long-path' || parsed.kind === 'gnu-long-link') {
      if (parsed.size > 1024 * 1024) throw new Phase3AError('archive_unsafe', 'archive metadata entry exceeds 1 MiB')
      entry = parsed
      remaining = parsed.size
      metadata = []
      state = remaining === 0 ? 'padding' : 'data'
      padding = (512 - (parsed.size % 512)) % 512
      return
    }
    const safe = validatePath(pathInput, limits)
    const key = safe.bytes.toString('hex')
    const collision = safe.value.toLocaleLowerCase('en-US')
    if (exact.has(key) || folded.has(collision)) throw new Phase3AError('archive_unsafe', `duplicate or Unicode/case-colliding path: ${safe.value}`)
    exact.add(key)
    folded.add(collision)
    const output = path.join(destination, ...safe.value.split('/'))
    if (parsed.kind === 'directory') {
      if (parsed.size !== 0) throw new Phase3AError('archive_unsafe', 'directory entry has nonzero size')
      mkdirSync(output, { recursive: true, mode: 0o755 })
      entry = parsed
      remaining = 0
      padding = 0
      state = 'padding'
      return
    }
    regularFiles += 1
    regularBytes += parsed.size
    if (regularFiles > limits.regularFiles) throw new Phase3AError('disk_limit', 'regular file count limit exceeded')
    if (parsed.size > limits.singleRegularBytes) throw new Phase3AError('disk_limit', 'single regular file limit exceeded')
    if (regularBytes > limits.totalRegularBytes) throw new Phase3AError('disk_limit', 'total regular-file byte limit exceeded')
    if (limits.expansionRatio !== null && regularBytes > archiveBytes * limits.expansionRatio) {
      throw new Phase3AError('archive_unsafe', 'untrusted archive expansion ratio limit exceeded')
    }
    mkdirSync(path.dirname(output), { recursive: true, mode: 0o755 })
    fd = openSync(output, 'wx', parsed.mode & 0o111 ? 0o755 : 0o644)
    entry = parsed
    remaining = parsed.size
    padding = (512 - (parsed.size % 512)) % 512
    state = remaining === 0 ? 'padding' : 'data'
    if (remaining === 0) {
      closeSync(fd)
      fd = null
      chmodSync(output, parsed.mode & 0o111 ? 0o755 : 0o644)
    }
  }

  const finishData = (): void => {
    if (!entry) throw new Phase3AError('archive_unsafe', 'tar parser lost entry state')
    if (fd !== null) { closeSync(fd); fd = null }
    if (entry.kind === 'pax' || entry.kind === 'global-pax') {
      const values = parsePax(Buffer.concat(metadata))
      if (entry.kind === 'global-pax') globalPax = { ...globalPax, ...values }
      else pendingPax = values
    } else if (entry.kind === 'gnu-long-path' || entry.kind === 'gnu-long-link') {
      const combined = Buffer.concat(metadata)
      const nul = combined.indexOf(0)
      const value = decode(nul === -1 ? combined : combined.subarray(0, nul), 'GNU long name')
      if (entry.kind === 'gnu-long-path') pendingLongPath = value
      else pendingLongLink = value
    }
    state = 'padding'
  }

  const process = (): void => {
    while (true) {
      if (state === 'end') {
        if (buffered.some((byte) => byte !== 0)) throw new Phase3AError('archive_unsafe', 'nonzero data follows tar end marker')
        buffered = Buffer.alloc(0)
        return
      }
      if (state === 'header') {
        if (buffered.length < 512) return
        const header = buffered.subarray(0, 512)
        buffered = buffered.subarray(512)
        const parsed = parseHeader(header)
        if (!parsed) {
          zeroBlocks += 1
          if (zeroBlocks >= 2) state = 'end'
          continue
        }
        if (zeroBlocks !== 0) throw new Phase3AError('archive_unsafe', 'nonzero data follows tar end marker')
        beginEntry(parsed)
        if (remaining === 0 && state === 'padding') finishData()
        continue
      }
      if (state === 'data') {
        if (buffered.length === 0) return
        const length = Math.min(remaining, buffered.length)
        const chunk = buffered.subarray(0, length)
        buffered = buffered.subarray(length)
        if (fd !== null) writeSync(fd, chunk)
        else metadata.push(Buffer.from(chunk))
        remaining -= length
        if (remaining === 0) finishData()
        continue
      }
      if (state === 'padding') {
        if (buffered.length < padding) return
        buffered = buffered.subarray(padding)
        padding = 0
        entry = null
        state = 'header'
      }
    }
  }

  try {
    const stream = createReadStream(archive).pipe(createGunzip())
    for await (const chunk of stream) {
      buffered = Buffer.concat([buffered, Buffer.from(chunk)])
      process()
    }
    process()
  } finally {
    if (fd !== null) closeSync(fd)
  }
  if (state !== 'end' || zeroBlocks < 2) throw new Phase3AError('archive_unsafe', 'tar archive is truncated or lacks end markers')
  const tree = digestTree(destination)
  if (tree.records.length !== regularFiles || tree.bytes !== regularBytes) throw new Phase3AError('parser_disagreement', 'streaming inventory disagrees with extracted tree')
  const ratio = archiveBytes === 0 ? Number.POSITIVE_INFINITY : regularBytes / archiveBytes
  return {
    tree_sha256: tree.sha256,
    tree_algorithm: tree.algorithm,
    inventory: tree.records,
    archive_bytes: archiveBytes,
    regular_file_bytes: regularBytes,
    regular_file_count: regularFiles,
    expansion_ratio: ratio,
    warnings: ratio > 4 ? ['expansion_ratio_above_planning_threshold'] : [],
  }
}
