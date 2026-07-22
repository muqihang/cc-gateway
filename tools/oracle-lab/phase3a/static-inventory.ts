import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalJson, Phase3AError, sha256Bytes, stableError } from './core.js'
import { verifyArtifactIndex } from './artifact-index.js'

const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024
const MAX_MARKERS = 4096

export type StaticLocation = {
  artifact_sha256: string
  offset: number
  length: number
}

export type StaticEvidenceBinding = {
  artifact_sha256: string
  parser: string
  parser_version: string
  command_sha256: string
}

export type StaticSection = {
  slice_index: number
  segment: string
  section: string
  offset: number
  length: number
  sha256: string
  flags: number
  file_backed: boolean
  location: StaticLocation
}

export type StaticSlice = {
  index: number
  architecture: string
  offset: number
  length: number
  endian: 'little' | 'big'
  bits: 32 | 64
  filetype: number
  flags: number
  commands: number
  sections: StaticSection[]
  imports: Array<{ name_sha256: string; byte_length: number; location: StaticLocation }>
  symbol_table: null | { offset: number; entries: number; string_offset: number; string_length: number }
  code_signature: null | { offset: number; length: number; sha256: string; location: StaticLocation }
}

export type StaticInventory = {
  schema_version: 'oracle-lab-phase3a-static-inventory.v1'
  binding: StaticEvidenceBinding
  format: 'mach-o' | 'javascript' | 'json' | 'archive' | 'unknown'
  byte_size: number
  slices: StaticSlice[]
  markers: Array<{ category: string; token_sha256: string; byte_length: number; location: StaticLocation }>
  opaque_regions: Array<{ offset: number; length: number; sha256: string; reason: string; location: StaticLocation }>
}

type EndianReader = {
  u32(offset: number): number
  u64(offset: number): number
}

function fail(code: string, message: string): never {
  throw new Phase3AError(code, message)
}

function boundedRange(bytes: Buffer, offset: number, length: number, label: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length) {
    fail('static_range_invalid', `${label} range is outside the artifact`)
  }
}

function reader(bytes: Buffer, endian: 'little' | 'big'): EndianReader {
  return {
    u32(offset) {
      boundedRange(bytes, offset, 4, 'u32')
      return endian === 'little' ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset)
    },
    u64(offset) {
      boundedRange(bytes, offset, 8, 'u64')
      const value = endian === 'little' ? bytes.readBigUInt64LE(offset) : bytes.readBigUInt64BE(offset)
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail('static_range_invalid', 'u64 exceeds the safe integer range')
      return Number(value)
    },
  }
}

function fixedName(bytes: Buffer, offset: number): string {
  boundedRange(bytes, offset, 16, 'Mach-O name')
  const end = bytes.indexOf(0, offset)
  const limit = end >= offset && end < offset + 16 ? end : offset + 16
  const value = bytes.subarray(offset, limit).toString('ascii')
  return /^[\x20-\x7e]{0,16}$/.test(value) ? value : `name-${sha256Bytes(bytes.subarray(offset, limit)).slice(0, 12)}`
}

function location(digest: string, offset: number, length: number): StaticLocation {
  return { artifact_sha256: digest, offset, length }
}

function machoMagic(bytes: Buffer, offset: number): { endian: 'little' | 'big'; bits: 32 | 64 } | null {
  boundedRange(bytes, offset, 4, 'Mach-O magic')
  const hex = bytes.subarray(offset, offset + 4).toString('hex')
  if (hex === 'cefaedfe') return { endian: 'little', bits: 32 }
  if (hex === 'feedface') return { endian: 'big', bits: 32 }
  if (hex === 'cffaedfe') return { endian: 'little', bits: 64 }
  if (hex === 'feedfacf') return { endian: 'big', bits: 64 }
  return null
}

function parseDylibName(bytes: Buffer, commandOffset: number, commandSize: number, digest: string, read: EndianReader): StaticSlice['imports'][number] {
  const nameOffset = read.u32(commandOffset + 8)
  if (nameOffset < 24 || nameOffset >= commandSize) fail('static_range_invalid', 'invalid LC_LOAD_DYLIB name offset')
  const start = commandOffset + nameOffset
  const commandEnd = commandOffset + commandSize
  const nul = bytes.indexOf(0, start)
  const end = nul >= start && nul < commandEnd ? nul : commandEnd
  const value = bytes.subarray(start, end)
  return { name_sha256: sha256Bytes(value), byte_length: value.length, location: location(digest, start, value.length) }
}

function validateNoSectionOverlap(sections: StaticSection[]): void {
  const backed = sections.filter((section) => section.file_backed && section.length > 0)
    .sort((left, right) => left.offset - right.offset || left.length - right.length)
  for (let index = 1; index < backed.length; index += 1) {
    if (backed[index].offset < backed[index - 1].offset + backed[index - 1].length) {
      fail('static_section_overlap', `Mach-O sections overlap at offset ${backed[index].offset}`)
    }
  }
}

function parseMachoSlice(bytes: Buffer, sliceOffset: number, sliceLength: number, index: number, digest: string): StaticSlice {
  boundedRange(bytes, sliceOffset, sliceLength, 'Mach-O slice')
  const magic = machoMagic(bytes, sliceOffset)
  if (!magic) fail('static_format_invalid', 'fat member is not a supported Mach-O slice')
  const read = reader(bytes, magic.endian)
  const headerSize = magic.bits === 64 ? 32 : 28
  boundedRange(bytes, sliceOffset, headerSize, 'Mach-O header')
  const cpuType = read.u32(sliceOffset + 4)
  const filetype = read.u32(sliceOffset + 12)
  const commands = read.u32(sliceOffset + 16)
  const commandBytes = read.u32(sliceOffset + 20)
  const flags = read.u32(sliceOffset + 24)
  if (commands > 100_000) fail('static_budget_exceeded', 'Mach-O load command count exceeds the parser budget')
  boundedRange(bytes, sliceOffset + headerSize, commandBytes, 'Mach-O load commands')
  if (headerSize + commandBytes > sliceLength) fail('static_range_invalid', 'Mach-O commands exceed their slice')

  const sections: StaticSection[] = []
  const imports: StaticSlice['imports'] = []
  let symbolTable: StaticSlice['symbol_table'] = null
  let codeSignature: StaticSlice['code_signature'] = null
  let cursor = sliceOffset + headerSize
  const commandEnd = cursor + commandBytes
  for (let commandIndex = 0; commandIndex < commands; commandIndex += 1) {
    if (cursor + 8 > commandEnd) fail('static_range_invalid', 'truncated Mach-O load command')
    const command = read.u32(cursor)
    const commandSize = read.u32(cursor + 4)
    if (commandSize < 8 || cursor + commandSize > commandEnd) fail('static_range_invalid', 'invalid Mach-O load command size')
    const baseCommand = command & 0x7fff_ffff
    if (baseCommand === 0x1 || baseCommand === 0x19) {
      const is64 = baseCommand === 0x19
      const fixedSize = is64 ? 72 : 56
      const sectionSize = is64 ? 80 : 68
      if (commandSize < fixedSize) fail('static_range_invalid', 'truncated Mach-O segment command')
      const segmentName = fixedName(bytes, cursor + 8)
      const fileOffset = is64 ? read.u64(cursor + 40) : read.u32(cursor + 32)
      const fileLength = is64 ? read.u64(cursor + 48) : read.u32(cursor + 36)
      const sectionCount = read.u32(cursor + (is64 ? 64 : 48))
      if (sectionCount > 100_000 || fixedSize + sectionCount * sectionSize > commandSize) fail('static_range_invalid', 'invalid Mach-O section table')
      if (fileLength > 0) {
        boundedRange(bytes, sliceOffset + fileOffset, fileLength, 'Mach-O segment')
        if (fileOffset + fileLength > sliceLength) fail('static_range_invalid', 'Mach-O segment exceeds its slice')
      }
      for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
        const sectionOffset = cursor + fixedSize + sectionIndex * sectionSize
        const sectionName = fixedName(bytes, sectionOffset)
        const declaredSegment = fixedName(bytes, sectionOffset + 16)
        const size = is64 ? read.u64(sectionOffset + 40) : read.u32(sectionOffset + 36)
        const fileRelative = read.u32(sectionOffset + (is64 ? 48 : 40))
        const sectionFlags = read.u32(sectionOffset + (is64 ? 64 : 56))
        const sectionType = sectionFlags & 0xff
        const fileBacked = ![0x1, 0xc, 0x12].includes(sectionType) && size > 0
        const absoluteOffset = sliceOffset + fileRelative
        if (fileBacked) {
          boundedRange(bytes, absoluteOffset, size, 'Mach-O section')
          if (fileRelative + size > sliceLength) fail('static_range_invalid', 'Mach-O section exceeds its slice')
          if (fileRelative < fileOffset || fileRelative + size > fileOffset + fileLength) fail('static_range_invalid', 'Mach-O section exceeds its segment')
        }
        const content = fileBacked ? bytes.subarray(absoluteOffset, absoluteOffset + size) : Buffer.alloc(0)
        sections.push({
          slice_index: index,
          segment: declaredSegment || segmentName,
          section: sectionName,
          offset: absoluteOffset,
          length: size,
          sha256: sha256Bytes(content),
          flags: sectionFlags,
          file_backed: fileBacked,
          location: location(digest, absoluteOffset, size),
        })
      }
    } else if ([0xc, 0x18, 0x1f, 0x20, 0x23].includes(baseCommand)) {
      imports.push(parseDylibName(bytes, cursor, commandSize, digest, read))
    } else if (baseCommand === 0x2) {
      if (commandSize < 24) fail('static_range_invalid', 'truncated LC_SYMTAB')
      const symbolOffset = read.u32(cursor + 8)
      const entries = read.u32(cursor + 12)
      const stringOffset = read.u32(cursor + 16)
      const stringLength = read.u32(cursor + 20)
      const entrySize = magic.bits === 64 ? 16 : 12
      boundedRange(bytes, sliceOffset + symbolOffset, entries * entrySize, 'Mach-O symbols')
      boundedRange(bytes, sliceOffset + stringOffset, stringLength, 'Mach-O symbol strings')
      symbolTable = { offset: sliceOffset + symbolOffset, entries, string_offset: sliceOffset + stringOffset, string_length: stringLength }
    } else if (baseCommand === 0x1d) {
      if (commandSize < 16) fail('static_range_invalid', 'truncated LC_CODE_SIGNATURE')
      const signatureOffset = read.u32(cursor + 8)
      const signatureLength = read.u32(cursor + 12)
      boundedRange(bytes, sliceOffset + signatureOffset, signatureLength, 'Mach-O code signature')
      if (signatureOffset + signatureLength > sliceLength) fail('static_range_invalid', 'Mach-O code signature exceeds its slice')
      const absoluteOffset = sliceOffset + signatureOffset
      codeSignature = {
        offset: absoluteOffset,
        length: signatureLength,
        sha256: sha256Bytes(bytes.subarray(absoluteOffset, absoluteOffset + signatureLength)),
        location: location(digest, absoluteOffset, signatureLength),
      }
    }
    cursor += commandSize
  }
  if (cursor !== commandEnd) fail('static_range_invalid', 'Mach-O command count and byte size disagree')
  validateNoSectionOverlap(sections)
  const architecture = ({ 0x0100000c: 'arm64', 0x01000007: 'x86_64', 12: 'arm', 7: 'x86' } as Record<number, string>)[cpuType] ?? `cpu-${cpuType}`
  return { index, architecture, offset: sliceOffset, length: sliceLength, endian: magic.endian, bits: magic.bits, filetype, flags, commands, sections, imports, symbol_table: symbolTable, code_signature: codeSignature }
}

function parseMacho(bytes: Buffer, digest: string): StaticSlice[] | null {
  if (bytes.length < 4) return null
  if (machoMagic(bytes, 0)) return [parseMachoSlice(bytes, 0, bytes.length, 0, digest)]
  const magic = bytes.subarray(0, 4).toString('hex')
  const fat = magic === 'cafebabe' || magic === 'bebafeca' || magic === 'cafebabf' || magic === 'bfbafeca'
  if (!fat) return null
  const endian = magic === 'cafebabe' || magic === 'cafebabf' ? 'big' : 'little'
  const is64 = magic === 'cafebabf' || magic === 'bfbafeca'
  const read = reader(bytes, endian)
  const count = read.u32(4)
  const entrySize = is64 ? 32 : 20
  if (count === 0 || count > 64) fail('static_budget_exceeded', 'fat Mach-O slice count is invalid')
  boundedRange(bytes, 8, count * entrySize, 'fat Mach-O table')
  const ranges: Array<{ offset: number; length: number }> = []
  for (let index = 0; index < count; index += 1) {
    const entry = 8 + index * entrySize
    const offset = is64 ? read.u64(entry + 8) : read.u32(entry + 8)
    const length = is64 ? read.u64(entry + 16) : read.u32(entry + 12)
    boundedRange(bytes, offset, length, 'fat Mach-O member')
    ranges.push({ offset, length })
  }
  const ordered = [...ranges].sort((left, right) => left.offset - right.offset)
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].offset < ordered[index - 1].offset + ordered[index - 1].length) fail('static_section_overlap', 'fat Mach-O members overlap')
  }
  return ranges.map((range, index) => parseMachoSlice(bytes, range.offset, range.length, index, digest))
}

const MARKERS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['source-map', ['sourceMappingURL', 'sourceMap']],
  ['bun-runtime', ['__BUN', 'Bun.']],
  ['node-builtin', ['node:fs', 'node:net', 'node:tls', 'node:http', 'node:https', 'node:dns', 'node:child_process']],
  ['module-boundary', ['require(', 'import ', 'exports.']],
  ['chunk-loader', ['chunk', 'webpack', 'rollup']],
  ['metadata', ['package.json', 'build_time', 'build-time', 'version']],
]

function markerInventory(bytes: Buffer, digest: string): StaticInventory['markers'] {
  const output: StaticInventory['markers'] = []
  for (const [category, tokens] of MARKERS) {
    for (const value of tokens) {
      const token = Buffer.from(value, 'ascii')
      let cursor = 0
      while (cursor <= bytes.length - token.length) {
        const offset = bytes.indexOf(token, cursor)
        if (offset < 0) break
        output.push({ category, token_sha256: sha256Bytes(token), byte_length: token.length, location: location(digest, offset, token.length) })
        if (output.length >= MAX_MARKERS) return output.sort((left, right) => left.location.offset - right.location.offset || left.category.localeCompare(right.category))
        cursor = offset + Math.max(1, token.length)
      }
    }
  }
  return output.sort((left, right) => left.location.offset - right.location.offset || left.category.localeCompare(right.category))
}

function detectTextFormat(bytes: Buffer): StaticInventory['format'] {
  const prefix = bytes.subarray(0, Math.min(bytes.length, 4096)).toString('utf8').trimStart()
  if (prefix.startsWith('{') || prefix.startsWith('[')) return 'json'
  if (/^(?:#!.*\n)?(?:['"]use strict['"];?|import\s|export\s|const\s|let\s|var\s|function\s|\()/m.test(prefix)) return 'javascript'
  if (bytes.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])) || bytes.subarray(0, 4).equals(Buffer.from('PK\x03\x04', 'binary'))) return 'archive'
  return 'unknown'
}

export function inventoryBytes(bytes: Buffer, expectedSha256?: string): StaticInventory {
  if (bytes.length > MAX_ARTIFACT_BYTES) fail('static_budget_exceeded', 'artifact exceeds the static inventory byte budget')
  const digest = sha256Bytes(bytes)
  if (expectedSha256 !== undefined && digest !== expectedSha256) fail('artifact_hash_mismatch', 'artifact digest differs from intake')
  const slices = parseMacho(bytes, digest)
  const format = slices ? 'mach-o' : detectTextFormat(bytes)
  const covered = slices?.flatMap((slice) => slice.sections.filter((section) => section.file_backed).map((section) => ({ offset: section.offset, length: section.length }))) ?? []
  const opaqueRegions = slices && covered.length === 0
    ? [{ offset: 0, length: bytes.length, sha256: digest, reason: 'no_file_backed_sections', location: location(digest, 0, bytes.length) }]
    : []
  return {
    schema_version: 'oracle-lab-phase3a-static-inventory.v1',
    binding: {
      artifact_sha256: digest,
      parser: 'phase3a-static-inventory',
      parser_version: '1',
      command_sha256: sha256Bytes(canonicalJson({ operation: 'static-inventory', parser_version: '1', artifact_sha256: digest })),
    },
    format,
    byte_size: bytes.length,
    slices: slices ?? [],
    markers: markerInventory(bytes, digest),
    opaque_regions: opaqueRegions,
  }
}

export function inventoryFile(file: string, expectedSha256?: string): StaticInventory {
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) fail('artifact_identity', 'static input must be a regular non-symlink file')
  if (stat.size > MAX_ARTIFACT_BYTES) fail('static_budget_exceeded', 'artifact exceeds the static inventory byte budget')
  const bytes = readFileSync(file)
  const after = lstatSync(file)
  if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) fail('artifact_identity', 'artifact changed while being inventoried')
  return inventoryBytes(bytes, expectedSha256)
}

function args(argv: string[]): Record<string, string> {
  const output: Record<string, string> = {}
  const values = argv[0] === '--' ? argv.slice(1) : argv
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index]
    const value = values[index + 1]
    if (!name?.startsWith('--') || !value) fail('invalid_arguments', 'arguments must be --name value pairs')
    output[name.slice(2)] = value
  }
  return output
}

export function runStaticInventoryCli(argv: string[]): void {
  const values = args(argv)
  let output: StaticInventory | Record<string, unknown>
  if (values.artifact) {
    const evidenceRoot = values['evidence-root'] ?? process.env.P3A_EVIDENCE_ROOT
    if (!evidenceRoot) fail('invalid_arguments', '--evidence-root or P3A_EVIDENCE_ROOT is required with --artifact')
    const index = JSON.parse(readFileSync(values.artifact, 'utf8')) as { artifacts?: Array<{ artifact_id: string; relative_path: string; sha256: string }> }
    verifyArtifactIndex(index, evidenceRoot)
    const root = realpathSync(evidenceRoot)
    const selected = (index.artifacts ?? []).filter((row) => !values['artifact-id'] || row.artifact_id === values['artifact-id'])
    if (selected.length === 0) fail('static_input_missing', 'artifact index selection is empty')
    const inventories = selected.map((row) => {
      const file = path.resolve(root, ...row.relative_path.split('/'))
      const relation = path.relative(root, realpathSync(file))
      if (relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) fail('path_outside_evidence_root', 'artifact index entry escapes evidence root')
      return { artifact_id: row.artifact_id, inventory: inventoryFile(file, row.sha256) }
    })
    output = {
      schema_version: 'oracle-lab-phase3a-static-inventory-set.v1',
      artifact_index_sha256: sha256Bytes(readFileSync(values.artifact)),
      command_sha256: sha256Bytes(canonicalJson({ operation: 'static-inventory-set', parser_version: '1', artifact_index_sha256: sha256Bytes(readFileSync(values.artifact)), artifact_ids: selected.map((row) => row.artifact_id).sort() })),
      inventories,
    }
  } else {
    if (!values.entrypoint) fail('invalid_arguments', '--artifact or --entrypoint is required')
    output = inventoryFile(values.entrypoint, values['expected-sha256'])
  }
  const serialized = `${canonicalJson(output)}\n`
  if (values.out) writeFileSync(values.out, serialized, { flag: 'wx', mode: 0o600 })
  else process.stdout.write(serialized)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runStaticInventoryCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${canonicalJson(stableError(error))}\n`)
    process.exitCode = 1
  }
}
