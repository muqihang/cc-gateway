import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalJson, Phase3AError, sha256Bytes, stableError } from './core.js'
import { inventoryFile, type StaticInventory, type StaticLocation } from './static-inventory.js'

const MAX_CANDIDATES = 100_000

export type ExtractedCandidate = {
  candidate_id: string
  parent_artifact_sha256: string
  source: 'whole-file' | 'mach-o-section'
  segment: string | null
  section: string | null
  location: StaticLocation
  byte_length: number
  sha256: string
  entropy_bits_per_byte: number
  encoding: 'utf8' | 'binary'
  classification: 'plain' | 'minified' | 'bundled' | 'packed' | 'obfuscated' | 'opaque'
  classification_evidence: string[]
  persisted_payload: false
}

export type ExtractionIndex = {
  schema_version: 'oracle-lab-phase3a-extraction-index.v1'
  artifact_sha256: string
  inventory_sha256: string
  command_sha256: string
  recipe: {
    parser: 'phase3a-format-aware-slice'
    parser_version: '1'
    artifact_sha256: string
    inventory_sha256: string
    payload_policy: 'summary-only-no-raw-source'
  }
  candidates: ExtractedCandidate[]
  deterministic_digest: string
}

function fail(code: string, message: string): never {
  throw new Phase3AError(code, message)
}

function entropy(bytes: Buffer): number {
  if (bytes.length === 0) return 0
  const counts = new Uint32Array(256)
  for (const byte of bytes) counts[byte] += 1
  let result = 0
  for (const count of counts) {
    if (count === 0) continue
    const probability = count / bytes.length
    result -= probability * Math.log2(probability)
  }
  return Number(result.toFixed(6))
}

function utf8(bytes: Buffer): boolean {
  const decoded = bytes.toString('utf8')
  return !decoded.includes('\ufffd') && Buffer.from(decoded, 'utf8').equals(bytes)
}

function classify(bytes: Buffer): Pick<ExtractedCandidate, 'encoding' | 'classification' | 'classification_evidence'> {
  const archiveMagic = bytes.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])) || bytes.subarray(0, 4).equals(Buffer.from('PK\x03\x04', 'binary'))
  if (archiveMagic) fail('static_recursive_archive', 'recursive archive candidates are not extracted')
  const measuredEntropy = entropy(bytes)
  if (!utf8(bytes)) {
    const classification = measuredEntropy >= 7.5 ? 'packed' : 'opaque'
    return { encoding: 'binary', classification, classification_evidence: [measuredEntropy >= 7.5 ? 'high-entropy-binary' : 'non-utf8-binary'] }
  }
  const text = bytes.toString('utf8')
  const lineCount = Math.max(1, text.split('\n').length)
  const maximumLine = text.split('\n').reduce((maximum, line) => Math.max(maximum, Buffer.byteLength(line)), 0)
  const bundleSignals = (text.match(/(?:__webpack_require__|define\(|require\(|exports\.|module\.exports)/g) ?? []).length
  const escapedDensity = (text.match(/\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/gi) ?? []).length / Math.max(1, text.length)
  if (escapedDensity > 0.02 || measuredEntropy > 7.3) return { encoding: 'utf8', classification: 'obfuscated', classification_evidence: ['encoded-literal-or-high-entropy-text'] }
  if (bundleSignals >= 2) return { encoding: 'utf8', classification: 'bundled', classification_evidence: ['module-loader-signals'] }
  if (maximumLine > 4096 || (lineCount <= 3 && text.length > 1024)) return { encoding: 'utf8', classification: 'minified', classification_evidence: ['long-line-density'] }
  return { encoding: 'utf8', classification: 'plain', classification_evidence: ['bounded-readable-utf8'] }
}

function candidate(
  bytes: Buffer,
  artifactDigest: string,
  source: ExtractedCandidate['source'],
  offset: number,
  segment: string | null,
  section: string | null,
): ExtractedCandidate {
  const digest = sha256Bytes(bytes)
  const classification = classify(bytes)
  return {
    candidate_id: `candidate-${offset.toString(16)}-${digest.slice(0, 16)}`,
    parent_artifact_sha256: artifactDigest,
    source,
    segment,
    section,
    location: { artifact_sha256: artifactDigest, offset, length: bytes.length },
    byte_length: bytes.length,
    sha256: digest,
    entropy_bits_per_byte: entropy(bytes),
    ...classification,
    persisted_payload: false,
  }
}

function validateInventory(inventory: StaticInventory, bytes: Buffer): void {
  const artifactDigest = sha256Bytes(bytes)
  if (inventory.binding.artifact_sha256 !== artifactDigest || inventory.byte_size !== bytes.length) {
    fail('artifact_hash_mismatch', 'inventory is not bound to the supplied artifact bytes')
  }
  for (const slice of inventory.slices) {
    if (slice.offset < 0 || slice.length < 0 || slice.offset + slice.length > bytes.length) fail('static_range_invalid', 'inventory slice is out of bounds')
    for (const section of slice.sections) {
      if (section.location.artifact_sha256 !== artifactDigest || section.offset !== section.location.offset || section.length !== section.location.length) {
        fail('static_binding_invalid', 'section location binding is inconsistent')
      }
      if (section.offset < 0 || section.length < 0 || section.offset + section.length > bytes.length) fail('static_range_invalid', 'inventory section is out of bounds')
      if (section.file_backed && sha256Bytes(bytes.subarray(section.offset, section.offset + section.length)) !== section.sha256) {
        fail('artifact_hash_mismatch', 'section bytes disagree with inventory')
      }
    }
  }
}

function unsignedIndex(index: Omit<ExtractionIndex, 'deterministic_digest'>): Omit<ExtractionIndex, 'deterministic_digest'> {
  return index
}

export function extractBundleBytes(bytes: Buffer, inventory: StaticInventory): ExtractionIndex {
  validateInventory(inventory, bytes)
  const artifactDigest = inventory.binding.artifact_sha256
  const inventoryDigest = sha256Bytes(canonicalJson(inventory))
  const candidates: ExtractedCandidate[] = []
  if (inventory.format === 'mach-o') {
    for (const slice of inventory.slices) {
      for (const section of slice.sections) {
        if (!section.file_backed || section.length === 0) continue
        candidates.push(candidate(bytes.subarray(section.offset, section.offset + section.length), artifactDigest, 'mach-o-section', section.offset, section.segment, section.section))
      }
    }
  } else {
    candidates.push(candidate(bytes, artifactDigest, 'whole-file', 0, null, null))
  }
  if (candidates.length > MAX_CANDIDATES) fail('static_budget_exceeded', 'candidate count exceeds extraction budget')
  candidates.sort((left, right) => left.location.offset - right.location.offset || left.candidate_id.localeCompare(right.candidate_id))
  const base: Omit<ExtractionIndex, 'deterministic_digest'> = {
    schema_version: 'oracle-lab-phase3a-extraction-index.v1',
    artifact_sha256: artifactDigest,
    inventory_sha256: inventoryDigest,
    command_sha256: sha256Bytes(canonicalJson({ operation: 'extract-bundle', parser_version: '1', artifact_sha256: artifactDigest, inventory_sha256: inventoryDigest })),
    recipe: { parser: 'phase3a-format-aware-slice', parser_version: '1', artifact_sha256: artifactDigest, inventory_sha256: inventoryDigest, payload_policy: 'summary-only-no-raw-source' },
    candidates,
  }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(unsignedIndex(base))) }
}

export function extractBundleFile(file: string, inventory: StaticInventory): ExtractionIndex {
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) fail('artifact_identity', 'extraction input must be a regular non-symlink file')
  const bytes = readFileSync(file)
  const after = lstatSync(file)
  if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) fail('artifact_identity', 'artifact changed during extraction')
  return extractBundleBytes(bytes, inventory)
}

function args(argv: string[]): Record<string, string> {
  const output: Record<string, string> = {}
  const values = argv[0] === '--' ? argv.slice(1) : argv
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith('--') || !values[index + 1]) fail('invalid_arguments', 'arguments must be --name value pairs')
    output[values[index].slice(2)] = values[index + 1]
  }
  return output
}

export function runExtractBundleCli(argv: string[]): void {
  const values = args(argv)
  if (!values.entrypoint || !values.inventory || !values.out) fail('invalid_arguments', '--entrypoint, --inventory and --out are required')
  const parsedInput = JSON.parse(readFileSync(values.inventory, 'utf8')) as StaticInventory | { schema_version?: string; inventories?: Array<{ artifact_id: string; inventory: StaticInventory }> }
  let parsed: StaticInventory
  if (parsedInput.schema_version === 'oracle-lab-phase3a-static-inventory-set.v1') {
    const rows = parsedInput.inventories ?? []
    const entrypointDigest = sha256Bytes(readFileSync(values.entrypoint))
    const matches = rows.filter((row) => values['artifact-id'] ? row.artifact_id === values['artifact-id'] : row.inventory.binding.artifact_sha256 === entrypointDigest)
    if (matches.length !== 1) fail('static_input_missing', 'inventory set must select exactly one artifact')
    parsed = matches[0].inventory
  } else {
    parsed = parsedInput as StaticInventory
  }
  if (!parsed.binding?.artifact_sha256) fail('static_binding_invalid', 'inventory binding is missing')
  const independentlyInventoried = inventoryFile(values.entrypoint, parsed.binding?.artifact_sha256)
  if (sha256Bytes(canonicalJson(independentlyInventoried)) !== sha256Bytes(canonicalJson(parsed))) fail('static_binding_invalid', 'inventory does not reproduce')
  const index = extractBundleFile(values.entrypoint, parsed)
  mkdirSync(values.out, { recursive: true, mode: 0o700 })
  writeFileSync(path.join(values.out, 'extraction-index.json'), `${canonicalJson(index)}\n`, { flag: 'wx', mode: 0o600 })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runExtractBundleCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${canonicalJson(stableError(error))}\n`)
    process.exitCode = 1
  }
}
