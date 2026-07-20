import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'

import { Phase3AError, sha256File } from './core.js'

const DOMAIN = Buffer.from('oracle-lab-phase3a-tree-digest-v1\0', 'ascii')
const UTF8 = new TextEncoder()

export type TreeFileRecord = {
  path: string
  executable: boolean
  size: number
  sha256: string
}

function u32(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Phase3AError('tree_digest_invalid', 'u32 value is out of range')
  }
  const result = Buffer.alloc(4)
  result.writeUInt32BE(value)
  return result
}

function u64(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) throw new Phase3AError('tree_digest_invalid', 'u64 value is out of range')
  const result = Buffer.alloc(8)
  result.writeBigUInt64BE(BigInt(value))
  return result
}

function pathBytes(value: string): Buffer {
  const bytes = Buffer.from(UTF8.encode(value))
  if (bytes.length === 0 || bytes.length > 1024 || path.posix.isAbsolute(value)) {
    throw new Phase3AError('tree_digest_invalid', 'tree path is not bounded relative UTF-8')
  }
  const parts = value.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..') || path.posix.normalize(value) !== value || value.normalize('NFC') !== value) {
    throw new Phase3AError('tree_digest_invalid', 'tree path is not normalized POSIX UTF-8')
  }
  return bytes
}

export function encodeTreeRecords(recordsInput: readonly TreeFileRecord[]): Buffer {
  const records = recordsInput.map((record) => ({ ...record, bytes: pathBytes(record.path) }))
    .sort((left, right) => Buffer.compare(left.bytes, right.bytes))
  const seen = new Set<string>()
  const collision = new Set<string>()
  const fields: Buffer[] = [DOMAIN, u32(records.length)]
  for (const record of records) {
    const exact = record.bytes.toString('hex')
    const folded = record.path.normalize('NFC').toLocaleLowerCase('en-US')
    if (seen.has(exact) || collision.has(folded)) throw new Phase3AError('path_collision', `tree path collision: ${record.path}`)
    seen.add(exact)
    collision.add(folded)
    if (!Number.isSafeInteger(record.size) || record.size < 0 || !/^[a-f0-9]{64}$/.test(record.sha256)) {
      throw new Phase3AError('tree_digest_invalid', `invalid file record: ${record.path}`)
    }
    fields.push(u32(record.bytes.length), record.bytes, Buffer.from([record.executable ? 1 : 0]), u64(record.size), Buffer.from(record.sha256, 'hex'))
  }
  return Buffer.concat(fields)
}

export function digestTreeRecords(records: readonly TreeFileRecord[]): string {
  return createHash('sha256').update(encodeTreeRecords(records)).digest('hex')
}

export function inventoryTree(rootInput: string): TreeFileRecord[] {
  const root = realpathSync(rootInput)
  const records: TreeFileRecord[] = []
  const walk = (absolute: string, relative: string): void => {
    pathBytes(relative)
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink()) throw new Phase3AError('archive_unsafe', `symlink is forbidden: ${relative}`)
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))) {
        walk(path.join(absolute, name), `${relative}/${name}`)
      }
      return
    }
    if (!stat.isFile()) throw new Phase3AError('archive_unsafe', `special file is forbidden: ${relative}`)
    records.push({
      path: relative,
      executable: (stat.mode & 0o111) !== 0,
      size: stat.size,
      sha256: sha256File(absolute),
    })
  }
  for (const name of readdirSync(root).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))) {
    walk(path.join(root, name), name)
  }
  return records.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))
}

export function digestTree(root: string): { algorithm: string; sha256: string; records: TreeFileRecord[]; bytes: number } {
  const records = inventoryTree(root)
  return {
    algorithm: 'oracle-lab-phase3a-tree-digest-v1',
    sha256: digestTreeRecords(records),
    records,
    bytes: records.reduce((total, record) => total + record.size, 0),
  }
}
