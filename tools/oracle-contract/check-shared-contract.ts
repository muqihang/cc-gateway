import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { evaluate, parse } from '@humanwhocodes/momoa'
import canonicalize from 'canonicalize'

export const PHASE1_CONTRACT_PATH = 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json'
export const PHASE1_CONTRACT_DIGEST = '70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1'
export const CC_BUNDLE_PATH = 'contracts/oracle-lab/v1'
export const SUB_BUNDLE_PATH = 'backend/internal/oracleevidence/testdata/oracle_lab_contract/v1'
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
export const CONTRACT_FILE_SHA256: Readonly<Record<(typeof CONTRACT_FILES)[number], string>> = {
  'authority-corpus.json': '42e89c1933f7c2b9f71dfd41d739345b3f2253f0217c6ebb2ee77b25ab94d8de',
  'canonicalization-corpus.json': 'a2925a1c04aa90dbc42eee3045574faf829ccddaa776d75d2497558821c0ab20',
  'coherence-corpus.json': '85b7209d31370bd56bb4a374cf796ecabd11ee191b30e9e9a485ff65b2d03d82',
  'contract-index.json': '2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce',
  'contract.schema.json': '380c7f3db80baa2d288838f3a550c3588abd19de11627d34ae90f5d3a0add4fe',
  'expected-results.json': '8671744730e94e88b439f05a0e934539fe5b148b3e3dfdc1243beba9774ced44',
  'interface-corpus.json': '9c2f0864097911b3b9612ee5bb6a4b62e363b2152abe7bfd5ff07221a6c60dca',
  'sidecar-envelope.cddl': '7697364dcaa7189449e94305a4df86d8d5476078b3dee78fac2fb34ccc60905d',
  'sidecar-envelope.schema.json': 'a9256710c040d2a018fbc42f188a59f11fc1dd9dc46ea7be89ca2294aaace003',
}
export const STABLE_CODE_SET_SHA256 = 'f6f89d48519aaa46b362a474cc6bd8e470b638e1c7f4c3c0a7ac99413a85fa5c'

const PRESERVED_STABLE_CODES = [
  'admission_allow', 'authority_allow', 'authority_resource_limit', 'authority_signature_invalid',
  'cbor_frame_length', 'cbor_frame_truncated', 'cbor_integer_unsafe', 'cbor_invalid', 'cbor_invalid_utf8',
  'cbor_map_key_invalid', 'cbor_not_deterministic', 'cbor_resource_limit', 'cbor_simple_forbidden',
  'cbor_tag_forbidden', 'cbor_truncated', 'cbor_type_invalid', 'cbor_undefined_forbidden', 'interface_allow',
  'interface_deadline_expired', 'interface_gateway_retry', 'interface_generation_mismatch', 'interface_owner_mismatch',
  'interface_state_transition_invalid', 'interface_sub2api_retry', 'interface_terminal_no_retry',
  'json_canonicalization_failed', 'json_invalid', 'json_number_invalid', 'json_type_invalid', 'replay_committed',
  'replay_expired', 'replay_reserved', 'replay_revoked', 'sidecar_capability_allow',
  'sidecar_capability_decode_invalid', 'url_host_invalid', 'url_path_invalid', 'url_port_invalid',
] as const

const REBASELINE_STABLE_CODES = [
  'authority_diagnostic_promotion', 'contract_bundle_missing', 'contract_file_digest_mismatch',
  'contract_file_set_invalid', 'contract_index_not_canonical', 'contract_index_path_invalid',
  'contract_index_version_invalid', 'contract_json_invalid', 'contract_mirror_mismatch',
  'contract_predecessor_mismatch', 'contract_required_set_mismatch', 'contract_schema_invalid',
  'contract_schema_keyword_unsupported', 'contract_schema_range_mismatch', 'contract_symlink',
  'cross_repo_binding_mismatch', 'cross_repo_record_expired', 'cross_repo_result_mismatch', 'leak_detected',
  'mutation_descriptor_invalid', 'mutation_executor_unexercised', 'mutation_pointer_invalid',
  'mutation_source_invalid', 'oracle_not_implemented',
] as const

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
  files: Array<{ relative_path: string; sha256: string }>
  stableCodes: string[]
  stableCodeSetDigest: string
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

export function stableCodesFromExpectedResults(value: unknown): string[] {
  const expected = objectValue(value, 'expected-results.json')
  if (!Array.isArray(expected.stable_error_codes) || expected.stable_error_codes.some((code) => typeof code !== 'string')) {
    throw new SharedContractError('contract_required_set_mismatch', 'stable_error_codes must be a string array')
  }
  const source = expected.stable_error_codes as string[]
  if (new Set(source).size !== source.length) {
    throw new SharedContractError('contract_required_set_mismatch', 'stable_error_codes contains duplicates')
  }
  const union = [...new Set([...source, ...PRESERVED_STABLE_CODES, ...REBASELINE_STABLE_CODES])].sort()
  const encoded = canonicalize(union)
  if (!encoded || union.length !== 119 || sha256Bytes(Buffer.from(encoded)) !== STABLE_CODE_SET_SHA256) {
    throw new SharedContractError('contract_required_set_mismatch', 'stable code union differs from the frozen 119-code set')
  }
  return union
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
  for (const file of CONTRACT_FILES) {
    if (sha256Bytes(files.get(file) as Buffer) !== CONTRACT_FILE_SHA256[file]) {
      throw new SharedContractError('contract_file_digest_mismatch', `frozen digest differs for ${file}`)
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
  const stableCodes = stableCodesFromExpectedResults(parseStrictJson(ccFiles.get('expected-results.json') as Buffer, 'expected-results.json'))
  const predecessor = path.resolve(input.sub2apiRoot, PHASE1_CONTRACT_PATH)
  if (!existsSync(predecessor) || lstatSync(predecessor).isSymbolicLink() || sha256File(predecessor) !== PHASE1_CONTRACT_DIGEST) {
    throw new SharedContractError('contract_predecessor_mismatch', 'Phase 1 predecessor file is missing or changed')
  }
  return {
    ok: true,
    bundleDigest: sha256Bytes(ccFiles.get('contract-index.json') as Buffer),
    fileCount: CONTRACT_FILES.length,
    predecessorDigest: PHASE1_CONTRACT_DIGEST,
    files: CONTRACT_FILES.map((relative_path) => ({ relative_path, sha256: sha256Bytes(ccFiles.get(relative_path) as Buffer) })),
    stableCodes,
    stableCodeSetDigest: STABLE_CODE_SET_SHA256,
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
