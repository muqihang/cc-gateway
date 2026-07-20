import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { evaluate, parse } from '@humanwhocodes/momoa'
import canonicalize from 'canonicalize'

export const PHASE1_CONTRACT_PATH = 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json'
export const PHASE1_CONTRACT_DIGEST = '70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1'
export const CC_BUNDLE_PATH = 'contracts/oracle-lab/v1'
export const SUB_BUNDLE_PATH = 'backend/internal/service/testdata/oracle_lab_contract/v1'
export const CONTRACT_FILES = [
  'authority-corpus.json',
  'canonicalization-corpus.json',
  'coherence-corpus.json',
  'contract-index.json',
  'contract.schema.json',
  'expected-results.json',
  'interface-corpus.json',
  'sidecar-envelope.cddl',
  'sidecar-envelope.schema.json',
] as const
export const INDEXED_CONTRACT_FILES = CONTRACT_FILES.filter((file) => file !== 'contract-index.json')

type JsonObject = Record<string, unknown>

export class SharedContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'SharedContractError'
  }
}

export type SharedContractCheck = {
  ok: true
  bundleDigest: string
  fileCount: number
  predecessorDigest: string
}

export function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function sha256File(file: string): string {
  return sha256Bytes(readFileSync(file))
}

function objectValue(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SharedContractError('contract_json_invalid', `${label} must be a JSON object`)
  }
  return value as JsonObject
}

function rejectDuplicateKeys(node: unknown, location = '$'): void {
  if (!node || typeof node !== 'object') return
  const record = node as Record<string, unknown>
  if (record.type === 'Object') {
    const seen = new Set<string>()
    for (const rawMember of record.members as unknown[]) {
      const member = rawMember as Record<string, unknown>
      const name = (member.name as Record<string, unknown>).value
      if (typeof name !== 'string') throw new SharedContractError('contract_json_invalid', `${location} has a non-string key`)
      if (seen.has(name)) throw new SharedContractError('contract_json_invalid', `${location} has duplicate key ${JSON.stringify(name)}`)
      seen.add(name)
      rejectDuplicateKeys(member.value, `${location}.${name}`)
    }
    return
  }
  if (record.type === 'Array') {
    for (const [index, element] of (record.elements as unknown[]).entries()) rejectDuplicateKeys(element, `${location}[${index}]`)
  }
}

export function parseStrictJson(raw: Uint8Array, label: string): unknown {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch {
    throw new SharedContractError('contract_json_invalid', `${label} is not valid UTF-8`)
  }
  try {
    const ast = parse(text)
    rejectDuplicateKeys(ast.body)
    return evaluate(ast)
  } catch (error) {
    if (error instanceof SharedContractError) throw error
    throw new SharedContractError('contract_json_invalid', `${label} is not strict JSON: ${(error as Error).message}`)
  }
}

function expectedFileNames(actual: string[]): void {
  const expected = [...CONTRACT_FILES]
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) {
    throw new SharedContractError('contract_file_set_invalid', `contract file set differs: ${actual.join(',')}`)
  }
}

function inspectBundle(bundle: string): Map<string, Buffer> {
  if (!existsSync(bundle) || !lstatSync(bundle).isDirectory()) {
    throw new SharedContractError('contract_bundle_missing', `contract bundle is missing: ${bundle}`)
  }
  const entries = readdirSync(bundle, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, 'en'))
  for (const entry of entries) {
    const candidate = path.join(bundle, entry.name)
    if (entry.isSymbolicLink() || lstatSync(candidate).isSymbolicLink()) {
      throw new SharedContractError('contract_symlink', `contract path is a symlink: ${candidate}`)
    }
    if (!entry.isFile()) throw new SharedContractError('contract_file_set_invalid', `contract path is not a regular file: ${candidate}`)
  }
  expectedFileNames(entries.map((entry) => entry.name))
  return new Map(entries.map((entry) => [entry.name, readFileSync(path.join(bundle, entry.name))]))
}

function compareMirrors(ccFiles: Map<string, Buffer>, subFiles: Map<string, Buffer>): void {
  for (const file of CONTRACT_FILES) {
    if (!ccFiles.get(file)?.equals(subFiles.get(file) as Buffer)) {
      throw new SharedContractError('contract_mirror_mismatch', `contract mirror differs at ${file}`)
    }
  }
}

function validateIndex(files: Map<string, Buffer>): JsonObject {
  for (const file of CONTRACT_FILES.filter((name) => name.endsWith('.json'))) {
    parseStrictJson(files.get(file) as Buffer, file)
  }
  const raw = files.get('contract-index.json') as Buffer
  const index = objectValue(parseStrictJson(raw, 'contract-index.json'), 'contract-index.json')
  const encoded = canonicalize(index)
  if (!encoded || !raw.equals(Buffer.from(encoded))) {
    throw new SharedContractError('contract_index_not_canonical', 'contract-index.json is not raw RFC 8785 JCS')
  }
  if (index.bundle_id !== 'oracle.compatibility.v1' || index.schema_id !== 'oracle.compatibility' || index.schema_major !== 1 || index.schema_revision !== 0) {
    throw new SharedContractError('contract_index_version_invalid', 'contract index version fields are invalid')
  }
  const predecessor = objectValue(index.predecessor, 'contract-index.json.predecessor')
  if (predecessor.repository !== 'sub2api' || predecessor.path !== PHASE1_CONTRACT_PATH || predecessor.sha256 !== PHASE1_CONTRACT_DIGEST) {
    throw new SharedContractError('contract_predecessor_mismatch', 'Phase 1 predecessor binding is invalid')
  }
  if (!Array.isArray(index.files) || index.files.length !== INDEXED_CONTRACT_FILES.length) {
    throw new SharedContractError('contract_index_file_order_invalid', 'contract index file list length is invalid')
  }
  const listed = index.files.map((entry, position) => {
    const record = objectValue(entry, `contract-index.json.files[${position}]`)
    if (typeof record.relative_path !== 'string' || path.posix.basename(record.relative_path) !== record.relative_path || !INDEXED_CONTRACT_FILES.includes(record.relative_path as typeof INDEXED_CONTRACT_FILES[number])) {
      throw new SharedContractError('contract_index_path_invalid', `invalid indexed path at position ${position}`)
    }
    if (typeof record.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(record.sha256)) {
      throw new SharedContractError('contract_file_digest_mismatch', `invalid digest for ${record.relative_path}`)
    }
    return record as { relative_path: string; sha256: string }
  })
  const expectedOrder = [...INDEXED_CONTRACT_FILES]
  if (listed.some((entry, index) => entry.relative_path !== expectedOrder[index])) {
    throw new SharedContractError('contract_index_file_order_invalid', 'contract index files are not byte-name sorted')
  }
  for (const entry of listed) {
    if (sha256Bytes(files.get(entry.relative_path) as Buffer) !== entry.sha256) {
      throw new SharedContractError('contract_file_digest_mismatch', `stale digest for ${entry.relative_path}`)
    }
  }
  return index
}

export function checkSharedContract(input: { ccGatewayRoot: string; sub2apiRoot: string }): SharedContractCheck {
  const ccBundle = path.resolve(input.ccGatewayRoot, CC_BUNDLE_PATH)
  const subBundle = path.resolve(input.sub2apiRoot, SUB_BUNDLE_PATH)
  const ccFiles = inspectBundle(ccBundle)
  const subFiles = inspectBundle(subBundle)
  compareMirrors(ccFiles, subFiles)
  validateIndex(ccFiles)
  const predecessor = path.resolve(input.sub2apiRoot, PHASE1_CONTRACT_PATH)
  if (!existsSync(predecessor) || lstatSync(predecessor).isSymbolicLink() || sha256File(predecessor) !== PHASE1_CONTRACT_DIGEST) {
    throw new SharedContractError('contract_predecessor_mismatch', 'Phase 1 predecessor file is missing or changed')
  }
  return {
    ok: true,
    bundleDigest: sha256Bytes(ccFiles.get('contract-index.json') as Buffer),
    fileCount: CONTRACT_FILES.length,
    predecessorDigest: PHASE1_CONTRACT_DIGEST,
  }
}

function argument(name: string): string | undefined {
  const position = process.argv.indexOf(name)
  return position === -1 ? undefined : process.argv[position + 1]
}

function runCli(): void {
  if (!process.argv.includes('--check')) throw new SharedContractError('contract_cli_usage', 'usage: check-shared-contract.ts --sub2api-root PATH [--cc-gateway-root PATH] --check')
  const ccGatewayRoot = path.resolve(argument('--cc-gateway-root') ?? process.cwd())
  const sub2apiRoot = argument('--sub2api-root')
  if (!sub2apiRoot) throw new SharedContractError('contract_cli_usage', '--sub2api-root is required')
  console.log(JSON.stringify(checkSharedContract({ ccGatewayRoot, sub2apiRoot: path.resolve(sub2apiRoot) })))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    runCli()
  } catch (error) {
    const typed = error instanceof SharedContractError ? error : new SharedContractError('contract_check_failed', (error as Error).message)
    console.error(JSON.stringify({ code: typed.code, message: typed.message }))
    process.exitCode = 1
  }
}
