import { spawnSync } from 'node:child_process'
import { accessSync, constants as fsConstants, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import canonicalize from 'canonicalize'

import {
  CC_BUNDLE_PATH,
  CONTRACT_FILES,
  CONTRACT_FILE_SHA256,
  PHASE1_CONTRACT_DIGEST,
  PHASE1_CONTRACT_PATH,
  STABLE_CODE_SET_SHA256,
  SUB_BUNDLE_PATH,
  SharedContractError,
  checkSharedContract,
  parseStrictJson,
  sha256Bytes,
  sha256File,
} from './check-shared-contract.js'

export class CrossRepoContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'CrossRepoContractError'
  }
}

export type CrossRepoContractResult = {
  ok: true
  bundleDigest: string
  schemaRange: string
  fixtureCases: number
  commandsRun: number
  decisionRows: number
  mutationRows: number
  decisionsDigest: string
  mutationResultsDigest: string
  requiredSetDigest: string
  stableCodeSetDigest: string
  subReceiptDigest?: string
}

type JsonObject = Record<string, unknown>

export type DecisionRow = {
  case_id: string
  allowed: boolean
  code: string
  next_state_digest: string | null
  canonical_hex: string | null
}

export type CrossRepoRecord = JsonObject & { record_digest: string }

export const SUB_TEST_SELECTOR = '^TestOracleContract(Scaffold|StrictJSON|JCS|Normalization|CBOR|Schema|Admission|ManifestAuthority|Interface|Replay|Sidecar|Mutation|CrossRepo|Receipt)$'
export const SUB_TEST_ARGS = ['test', './internal/oracleevidence', '-run', SUB_TEST_SELECTOR, '-count=1'] as const
export const COMMAND_IDS = ['cc-focused-contract-suite-v1', 'sub-focused-oracleevidence-v1'] as const
export const SEMANTIC_SURFACES = ['strict_json', 'jcs', 'normalization', 'cbor', 'schema', 'admission', 'authority', 'interface', 'replay', 'sidecar'] as const
export const DIAGNOSTIC_FORBIDDEN_KEYS = [
  'absolute_worktree_path', 'db_mtime', 'db_size_bytes', 'divergence', 'edge_count', 'file_count',
  'full_remote_config_digest', 'last_indexed', 'node_count', 'remote_projection_digest', 'worktree_directory_mtime',
] as const
export const MUTATION_CORPUS_SHA256 = '87a7e37f07086a7536c6a3e41b7c87cb00e1f6b1e31f13047c8cccf447dc90e6'
export const MUTATION_SOURCE_MANIFEST_SHA256 = 'd648dd801dc608cb99b68e088e8c7b6ccbd637339cffd86c0a70ef365c464d7c'
export const MUTATION_CONTROL_SHA256 = '217ea37747bd4f42836b90b081988f51af3a1b70e62d38aa69d33abbe747af53'
export const FROZEN_DECISIONS_SHA256 = 'a88805a573742cda40de5648cccb9735cf966d5aba32827a47f326d31477a7e4'
export const FROZEN_MUTATION_RESULTS_SHA256 = 'b0cbf903c93378a8148e74f29564524ba9c6971f19d697c595aca3448606f797'
export const FROZEN_REQUIRED_SET_SHA256 = 'f6eee94d9b1d80e0437474f0db65b35ce874e14edd9cf7f8314b4c38e9970d05'
export const FROZEN_SUB_EXECUTION_DECISIONS_SHA256 = '62223a099e6dff9e96b99b4264472f6c8ab5d91c204686e0eb579a8c2585083c'
export const FROZEN_SUB_EXECUTION_MUTATIONS_SHA256 = '0757f6827786fa5fafc73e8beebe5852819bd913f4da45017ca9cdfd63c2d5ad'
export const FROZEN_MUTATION_CASE_IDS = ['positive-admission-noop'] as const
export const SUB_RECEIPT_MERGE = '910a8fb3caa317409be48af31af699932be1f2a7'
export const SUB_RECEIPT_TREE = 'e6a788c98c9b529a47e88f97ae82fb489cff15cd'
export const SUB_RECEIPT_PARENTS = ['a4ce6e375a5b6ac46d4605bc3be2da1f9a2351a8', 'd2ff3956d3841b51c22de0db95c27dbc47378fcd'] as const
export const SUB_RECEIPT_REQUIRED_TESTS = [
  'TestOracleContractAdmission', 'TestOracleContractCBOR', 'TestOracleContractCrossRepo',
  'TestOracleContractInterface', 'TestOracleContractJCS', 'TestOracleContractManifestAuthority',
  'TestOracleContractMutation', 'TestOracleContractNormalization', 'TestOracleContractReplay',
  'TestOracleContractScaffold', 'TestOracleContractSchema', 'TestOracleContractSidecar',
  'TestOracleContractStrictJSON',
] as const
export const SERIAL_NODE_IDS = ['C0', 'S0', 'S1', 'R1', 'I1', 'SR', 'C1', 'CR'] as const
const SERIAL_ROLES = [
  'merge-this-cc-docs-amendment',
  'fresh-true-sub-mandatory-entry-and-docs-plan',
  'independent-review-and-merge-true-sub-docs-plan',
  'compileable-fail-closed-behavioral-red-scaffold',
  'single-implementation-wave',
  'independent-exact-head-true-sub-review',
  'cc-checker-integration',
  'cross-repo-exact-head-review-and-controller-decision',
] as const

export const CROSS_REPO_RECORD_SCHEMA_PROJECTION = {
  schema_id: 'oracle.cross_repo_record',
  schema_major: 1,
  schema_revision: 0,
  kind: 'oracle_contract_rebaseline',
  top_level_required: ['schema_id', 'schema_major', 'schema_revision', 'kind', 'authority', 'bundle', 'commit_dag', 'result', 'review', 'issued_at_ms', 'expires_at_ms', 'record_digest'],
  stable_code_count: 119,
  stable_code_set_sha256: STABLE_CODE_SET_SHA256,
  mirror_root: SUB_BUNDLE_PATH,
  schema_range: '1:0-0',
  lease_ms: 86_400_000,
  reviewer_model: 'gpt-5.6-sol',
  closed_required: {
    authority: ['cc', 'sub', 'command_id', 'reviewer_model'],
    cc: ['repository_url', 'selected_remote_name', 'selected_remote_ref', 'selected_remote_oid', 'commit', 'tree', 'amendment_sha256'],
    sub: ['repository_url', 'selected_local_ref', 'selected_local_oid', 'commit', 'tree', 'parent', 'ancestor', 'go_mod_sha256', 'go_sum_sha256', 'go_directive', 'predecessor_relative_path', 'predecessor_sha256', 'codegraph_config_sha256', 'codegraph_version', 'codegraph_extraction_revision', 'selection', 'sub_plan_commit', 'sub_plan_tree', 'sub_plan_sha256', 'r1_commit', 'r1_tree', 'i1_commit', 'i1_tree'],
    bundle: ['files', 'contract_index_sha256', 'predecessor_sha256', 'schema_range', 'mirror_root', 'framing'],
    commit_dag: ['nodes', 'edges'],
    decision_row: ['case_id', 'allowed', 'code', 'next_state_digest', 'canonical_hex'],
    result: ['case_rows', 'mutation_rows', 'decisions_sha256', 'mutation_results_sha256', 'required_set_sha256', 'stable_code_count', 'stable_code_set_sha256', 'semantic_surfaces', 'protected_file_count', 'protected_node_count', 'egress_count', 'command_ids'],
    review_item: ['task_id', 'model', 'artifact_sha256', 'critical', 'important', 'verdict'],
  },
} as const

export const SUB_IMMUTABLE_BINDINGS = {
  repository_url: 'https://github.com/Wei-Shaw/sub2api.git', selected_local_ref: 'refs/heads/codex/native-search-gateway', selected_local_oid: '3ac410ea02edc53c3925f28eddcbc22b51c0a137',
  commit: '3ac410ea02edc53c3925f28eddcbc22b51c0a137', tree: 'f7d51fb57c64fbaf6e2db3a7a2d423a491d5788d', parent: '04e42ae0f6c556daad21ac393eb284585092e805', ancestor: 'fc0b1989d7ba9ce06ff151b17c94b50df4170a93',
  go_mod_sha256: 'e637999a38f974c9172c8f69c8fbb9c0d727bacf257558307e97e927cbb468de', go_sum_sha256: 'd3e1fd1510b41f218136b719fdf2c4ef239b05650d3b575fb93c18f25f3dc981', go_directive: '1.26.5',
  predecessor_relative_path: 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json', predecessor_sha256: PHASE1_CONTRACT_DIGEST,
  codegraph_config_sha256: 'a7f3ad7c17d655f9d2494b5b05e55ceb4ea9c7667456ff785c5f2a9291c3783a', codegraph_version: '1.1.6', codegraph_extraction_revision: 24,
} as const

export const CROSS_REPO_RECORD_CONSTRAINTS = {
  bundle_files: CONTRACT_FILES.map((relative_path) => ({ relative_path, sha256: CONTRACT_FILE_SHA256[relative_path] })),
  command_ids: COMMAND_IDS,
  diagnostic_forbidden_keys: DIAGNOSTIC_FORBIDDEN_KEYS,
  serial_node_order: SERIAL_NODE_IDS,
  serial_edges: SERIAL_NODE_IDS.slice(0, -1).map((id, index) => [id, SERIAL_NODE_IDS[index + 1]]),
  semantic_surfaces: SEMANTIC_SURFACES,
  verdict_by_review_role: { sub: 'PLAN_REVIEW_PASS', cross: 'CROSS_REPO_PASS' },
  sub_immutable_bindings: SUB_IMMUTABLE_BINDINGS,
  stable_code_binding: { count: 119, union_jcs_sha256: STABLE_CODE_SET_SHA256 },
  selection_branches: {
    remote_ref: { required: ['mode', 'selected_remote_name', 'selected_remote_url', 'selected_remote_ref', 'selected_remote_oid'], forbidden: ['selection_override_sha256', 'selection_override_controller_id', 'selection_override_task_id', 'selection_override_issued_at_ms', 'selection_override_decision'] },
    total_controller_local_override: { required: ['mode', 'selection_override_sha256', 'selection_override_controller_id', 'selection_override_task_id', 'selection_override_issued_at_ms', 'selection_override_decision'], forbidden: ['selected_remote_name', 'selected_remote_url', 'selected_remote_ref', 'selected_remote_oid'] },
  },
  stage1b_negative_vectors: [
    { id: 'wrong-sub-commit', pointer: '/authority/sub/commit' }, { id: 'wrong-sub-tree', pointer: '/authority/sub/tree' },
    { id: 'wrong-go-mod', pointer: '/authority/sub/go_mod_sha256' }, { id: 'wrong-go-sum', pointer: '/authority/sub/go_sum_sha256' },
    { id: 'wrong-predecessor-blob', pointer: '/authority/sub/predecessor_sha256' }, { id: 'wrong-selected-ref', pointer: '/authority/sub/selected_local_ref' },
    { id: 'enabled-null-override-digest', pointer: '/authority/sub/selection/selection_override_sha256' },
    { id: 'disabled-present-override-digest', pointer: '/authority/sub/selection/selection_override_sha256' },
    { id: 'unknown-sub-field', pointer: '/authority/sub/unexpected' },
  ],
} as const

export const DIGEST_DAG = {
  edges: [
    ['core_files', 'contract_index'], ['contract_index', 'mirror_binding'], ['predecessor', 'mirror_binding'],
    ['mirror_binding', 'required_set'], ['corpus_results', 'decision_digest'], ['mutation_results', 'decision_digest'],
    ['required_set', 'result_payload'], ['decision_digest', 'result_payload'], ['commit_identities', 'authority_payload'],
    ['review_artifacts', 'authority_payload'], ['authority_payload', 'record_payload'], ['result_payload', 'record_payload'],
    ['record_payload', 'record_digest'],
  ],
  isolated_diagnostic_nodes: ['full_remote_projection', 'absolute_worktree', 'raw_graph_counts', 'db_metadata', 'divergence'],
  nodes: [
    'core_files', 'contract_index', 'predecessor', 'mirror_binding', 'required_set', 'corpus_results',
    'mutation_results', 'decision_digest', 'commit_identities', 'review_artifacts', 'authority_payload',
    'result_payload', 'record_payload', 'record_digest', 'full_remote_projection', 'absolute_worktree',
    'raw_graph_counts', 'db_metadata', 'divergence',
  ],
} as const

const ALLOWED_CODES = new Set([
  'admission_allow', 'authority_allow', 'interface_allow', 'interface_terminal_no_retry',
  'interface_sub2api_retry', 'interface_gateway_retry', 'replay_reserved', 'replay_committed',
  'replay_expired', 'replay_revoked',
])
const SHA256 = /^[0-9a-f]{64}$/
const OID = /^[0-9a-f]{40}$/
const SAFE_REF = /^[A-Za-z0-9._:/-]{1,200}$/

function objectValue(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CrossRepoContractError('contract_schema_invalid', `${label} must be an object`)
  }
  return value as JsonObject
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new CrossRepoContractError('contract_schema_invalid', `${label} must be an array`)
  return value
}

function exactKeys(value: JsonObject, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new CrossRepoContractError('cross_repo_binding_mismatch', `${label} has an invalid field set`)
  }
}

function schemaKeys(value: JsonObject, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new CrossRepoContractError('contract_schema_invalid', `${label} has an invalid field set`)
  }
}

function requireSchema(condition: boolean, label: string): void {
  if (!condition) throw new CrossRepoContractError('contract_schema_invalid', `${label} is invalid`)
}

function readJson(file: string): unknown {
  return parseStrictJson(readFileSync(file), path.basename(file))
}

function canonicalBytes(value: unknown, finalLF = false): Buffer {
  const encoded = canonicalize(value)
  if (!encoded) throw new CrossRepoContractError('contract_json_invalid', 'value cannot be canonicalized')
  return Buffer.from(finalLF ? `${encoded}\n` : encoded)
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return canonicalBytes(left).equals(canonicalBytes(right))
}

function digestWithLF(value: unknown): string {
  return sha256Bytes(canonicalBytes(value, true))
}

function decisionRow(caseId: string, allowed: boolean, code: string, next: unknown = null, canonicalHex: unknown = null): DecisionRow {
  return {
    case_id: caseId,
    allowed,
    code,
    next_state_digest: typeof next === 'string' ? next : null,
    canonical_hex: typeof canonicalHex === 'string' ? canonicalHex : null,
  }
}

function expectedCases(rows: unknown[], digests: JsonObject = {}): DecisionRow[] {
  return rows.map((raw, index) => {
    const row = objectValue(raw, `case[${index}]`)
    if (typeof row.id !== 'string' || typeof row.expected_code !== 'string') {
      throw new CrossRepoContractError('contract_schema_invalid', `case[${index}] is missing its decision`)
    }
    return decisionRow(row.id, ALLOWED_CODES.has(row.expected_code), row.expected_code, digests[row.id])
  })
}

function buildDecisionRows(ccGatewayRoot: string): DecisionRow[] {
  const bundle = path.join(ccGatewayRoot, CC_BUNDLE_PATH)
  const canonical = objectValue(readJson(path.join(bundle, 'canonicalization-corpus.json')), 'canonicalization-corpus.json')
  const coherence = objectValue(readJson(path.join(bundle, 'coherence-corpus.json')), 'coherence-corpus.json')
  const authority = objectValue(readJson(path.join(bundle, 'authority-corpus.json')), 'authority-corpus.json')
  const interfaces = objectValue(readJson(path.join(bundle, 'interface-corpus.json')), 'interface-corpus.json')
  const expected = objectValue(readJson(path.join(bundle, 'expected-results.json')), 'expected-results.json')
  const rows: DecisionRow[] = []

  for (const [index, raw] of arrayValue(canonical.json_cases, 'json_cases').entries()) {
    const row = objectValue(raw, `json_cases[${index}]`)
    if (typeof row.id !== 'string' || typeof row.valid !== 'boolean') throw new CrossRepoContractError('contract_schema_invalid', 'invalid JSON case')
    const input = typeof row.input_hex === 'string' ? Buffer.from(row.input_hex, 'hex') : Buffer.from(String(row.input_json))
    const canonicalHex = row.valid ? canonicalBytes(parseStrictJson(input, String(row.id))).toString('hex') : null
    rows.push(decisionRow(row.id, row.valid, row.valid ? 'authority_allow' : String(row.expected_code), null, canonicalHex))
  }
  for (const [index, raw] of arrayValue(canonical.cbor_cases, 'cbor_cases').entries()) {
    const row = objectValue(raw, `cbor_cases[${index}]`)
    if (typeof row.id !== 'string' || typeof row.valid !== 'boolean') throw new CrossRepoContractError('contract_schema_invalid', 'invalid CBOR case')
    rows.push(decisionRow(row.id, row.valid, row.valid ? 'authority_allow' : String(row.expected_code), null, row.valid ? row.expected_hex : null))
  }
  for (const raw of arrayValue(canonical.normalization_cases, 'normalization_cases')) {
    const row = objectValue(raw, 'normalization case')
    if (typeof row.id !== 'string') throw new CrossRepoContractError('contract_schema_invalid', 'invalid normalization case')
    rows.push(decisionRow(row.id, true, 'authority_allow'))
  }
  rows.push(...expectedCases(arrayValue(coherence.cases, 'coherence cases')))
  rows.push(...expectedCases(arrayValue(authority.cases, 'authority cases'), objectValue(authority.expected_next_state_digests, 'authority digests')))
  const interfaceDigests = { ...objectValue(interfaces.expected_state_digests, 'interface digests') }
  const replayDigests = objectValue(expected.replay_state_digests, 'replay digests')
  interfaceDigests['replay-reserve'] = replayDigests.reserved
  interfaceDigests['replay-commit'] = replayDigests.committed
  rows.push(...expectedCases(arrayValue(interfaces.cases, 'interface cases'), interfaceDigests))
  const sidecar = objectValue(objectValue(expected.canonical_results, 'canonical results').sidecar_unsigned_envelope, 'sidecar result')
  rows.push(decisionRow('sidecar_unsigned_envelope', true, 'sidecar_capability_allow', null, sidecar.canonical_hex))
  if (rows.length !== 69 || new Set(rows.map((row) => row.case_id)).size !== rows.length) {
    throw new CrossRepoContractError('contract_required_set_mismatch', 'frozen decision row set must contain 69 unique cases')
  }
  return rows
}

function buildMutationRows(sub2apiRoot: string): DecisionRow[] {
  const root = path.join(sub2apiRoot, 'backend/internal/oracleevidence/testdata/rebaseline/v1')
  const corpusPath = path.join(root, 'mutation-corpus.json')
  const manifestPath = path.join(root, 'source-manifest.json')
  const controlPath = path.join(root, 'synthetic/control.json')
  if (sha256File(corpusPath) !== MUTATION_CORPUS_SHA256 || sha256File(manifestPath) !== MUTATION_SOURCE_MANIFEST_SHA256 || sha256File(controlPath) !== MUTATION_CONTROL_SHA256) {
    throw new CrossRepoContractError('mutation_source_invalid', 'frozen mutation inputs differ')
  }
  const corpus = objectValue(readJson(corpusPath), 'mutation-corpus.json')
  const manifest = objectValue(readJson(manifestPath), 'source-manifest.json')
  const sources = arrayValue(manifest.sources, 'source manifest')
  const sourceByPath = new Map(sources.map((raw) => {
    const source = objectValue(raw, 'source binding')
    if (typeof source.relative_path !== 'string') throw new CrossRepoContractError('mutation_source_invalid', 'source path is missing')
    return [source.relative_path, source]
  }))
  const rows = arrayValue(corpus.cases, 'mutation cases').map((raw) => {
    const item = objectValue(raw, 'mutation case')
    const source = objectValue(item.source, 'mutation source')
    const operation = objectValue(item.operation, 'mutation operation')
    const expected = objectValue(item.expected, 'mutation expected')
    if (typeof item.case_id !== 'string' || typeof source.relative_path !== 'string' || !SAFE_REF.test(source.relative_path) || source.relative_path.includes('..')) {
      throw new CrossRepoContractError('mutation_descriptor_invalid', 'mutation case identity or source path is invalid')
    }
    const manifestSource = sourceByPath.get(source.relative_path)
    const sourceFile = path.join(root, source.relative_path)
    if (!manifestSource || lstatSync(sourceFile).isSymbolicLink() || sha256File(sourceFile) !== source.sha256 || source.sha256 !== manifestSource.sha256) {
      throw new CrossRepoContractError('mutation_source_invalid', 'mutation source binding differs')
    }
    const bytes = readFileSync(sourceFile)
    if (operation.kind !== 'replace_bytes' || operation.offset !== 0 || operation.delete_count !== 0 || operation.bytes_base64 !== '' || sha256Bytes(bytes) !== source.sha256) {
      throw new CrossRepoContractError('mutation_executor_unexercised', 'frozen mutation must execute as an exact no-op replacement')
    }
    if (typeof expected.allowed !== 'boolean' || typeof expected.code !== 'string') throw new CrossRepoContractError('mutation_descriptor_invalid', 'mutation result is invalid')
    return decisionRow(item.case_id, expected.allowed, expected.code)
  })
  if (rows.length !== FROZEN_MUTATION_CASE_IDS.length || rows.some((row, index) => row.case_id !== FROZEN_MUTATION_CASE_IDS[index])) {
    throw new CrossRepoContractError('contract_required_set_mismatch', 'mutation result set is incomplete')
  }
  return rows
}

function validateDigestDAG(): void {
  const nodes = new Set<string>(DIGEST_DAG.nodes)
  const diagnostics = new Set<string>(DIGEST_DAG.isolated_diagnostic_nodes)
  const edges = DIGEST_DAG.edges.map(([from, to]) => [from, to] as const)
  for (const [from, to] of edges) {
    if (!nodes.has(from) || !nodes.has(to) || diagnostics.has(from) || diagnostics.has(to)) {
      throw new CrossRepoContractError('authority_diagnostic_promotion', 'digest DAG promotes or references an invalid node')
    }
  }
  const core = [...nodes].filter((node) => !diagnostics.has(node))
  const incoming = new Map(core.map((node) => [node, 0]))
  for (const [, to] of edges) incoming.set(to, (incoming.get(to) ?? 0) + 1)
  const ready = core.filter((node) => incoming.get(node) === 0)
  let consumed = 0
  while (ready.length) {
    const node = ready.shift() as string
    consumed += 1
    for (const [from, to] of edges) if (from === node) {
      const count = (incoming.get(to) as number) - 1
      incoming.set(to, count)
      if (count === 0) ready.push(to)
    }
  }
  if (consumed !== core.length) throw new CrossRepoContractError('cross_repo_binding_mismatch', 'digest DAG contains a hash cycle')
}

const SENSITIVE_KEYS = new Set([
  'authorization', 'proxy_authorization', 'cookie', 'set_cookie', 'credentials', 'credential', 'password',
  'passwd', 'secret', 'token', 'access_token', 'refresh_token', 'api_key', 'x_api_key', 'anthropic_api_key',
  'private_key', 'certificate', 'raw_certificate', 'raw_private_key', 'raw_payload', 'raw_material',
  'raw_request_body', 'raw_response_body', 'raw_clienthello', 'prompt', 'body', 'request_body',
  'response_body', 'raw', 'raw_bytes', 'client_hello', 'cch', 'session_id', 'conversation_id',
  'message_id', 'pcap',
])

type ScanBudget = { members: number }

function scanRecord(value: unknown, key = '', depth = 0, budget: ScanBudget = { members: 0 }): void {
  if (depth > 256) throw new CrossRepoContractError('leak_detected', 'record nesting exceeds the bounded scanner limit')
  const normalizedKey = key.toLowerCase().replaceAll('-', '_')
  if (DIAGNOSTIC_FORBIDDEN_KEYS.includes(key as typeof DIAGNOSTIC_FORBIDDEN_KEYS[number])) {
    throw new CrossRepoContractError('authority_diagnostic_promotion', `diagnostic field ${key} is forbidden`)
  }
  if (SENSITIVE_KEYS.has(normalizedKey) || /(?:^|_)(?:credential|password|passwd|secret|token|api_key|private_key)(?:_|$)/.test(normalizedKey)) {
    throw new CrossRepoContractError('leak_detected', 'record contains a sensitive field')
  }
  if (typeof value === 'string') {
    if (/(?:Bearer|Basic)\s+\S+/i.test(value) || /-----BEGIN (?:ENCRYPTED |RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/i.test(value) || /(?:authorization|proxy[_-]?authorization|credentials?|password|passwd|secret|api[_-]?key|anthropic[_-]?api[_-]?key|access[_-]?token|refresh[_-]?token|cookie|set[_-]?cookie|private[_-]?key)\s*[:=]\s*\S+/i.test(value)) {
      throw new CrossRepoContractError('leak_detected', 'record contains credential-shaped material')
    }
    if (normalizedKey.includes('absolute') || /(?:^|[\s"'=:(])(?:\/Users\/|\/home\/|\/private\/|\/var\/folders\/|[A-Za-z]:[\\/]|\\\\[^\\\s]+\\)/.test(value)) {
      throw new CrossRepoContractError('authority_diagnostic_promotion', 'record contains an absolute diagnostic path')
    }
  } else if (Array.isArray(value)) {
    budget.members += value.length
    if (budget.members > 65_536) throw new CrossRepoContractError('leak_detected', 'record exceeds the bounded scanner member limit')
    for (const item of value) scanRecord(item, '', depth + 1, budget)
  } else if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    budget.members += entries.length
    if (budget.members > 65_536) throw new CrossRepoContractError('leak_detected', 'record exceeds the bounded scanner member limit')
    for (const [childKey, child] of entries) scanRecord(child, childKey, depth + 1, budget)
  }
}

function buildResult(ccGatewayRoot: string, sub2apiRoot: string) {
  const shared = checkSharedContract({ ccGatewayRoot, sub2apiRoot })
  const caseRows = buildDecisionRows(ccGatewayRoot)
  const mutationRows = buildMutationRows(sub2apiRoot)
  const requiredSet = {
    case_ids: caseRows.map((row) => row.case_id),
    mutation_case_ids: mutationRows.map((row) => row.case_id),
    bundle_files: shared.files,
    contract_index_sha256: shared.bundleDigest,
    predecessor_sha256: shared.predecessorDigest,
    stable_codes: shared.stableCodes,
    command_ids: [...COMMAND_IDS],
    semantic_surfaces: [...SEMANTIC_SURFACES],
  }
  const result = {
    case_rows: caseRows,
    mutation_rows: mutationRows,
    decisions_sha256: digestWithLF(caseRows),
    mutation_results_sha256: digestWithLF(mutationRows),
    required_set_sha256: digestWithLF(requiredSet),
    stable_code_count: shared.stableCodes.length,
    stable_code_set_sha256: shared.stableCodeSetDigest,
    semantic_surfaces: Object.fromEntries(SEMANTIC_SURFACES.map((surface) => [surface, true])),
    protected_file_count: 0,
    protected_node_count: 0,
    egress_count: 0,
    command_ids: [...COMMAND_IDS],
  }
  if (result.decisions_sha256 !== FROZEN_DECISIONS_SHA256 || result.mutation_results_sha256 !== FROZEN_MUTATION_RESULTS_SHA256 || result.required_set_sha256 !== FROZEN_REQUIRED_SET_SHA256) {
    throw new CrossRepoContractError('contract_required_set_mismatch', 'frozen decision or required-set digest differs')
  }
  return result
}

function validateStaticContract(ccGatewayRoot: string, sub2apiRoot: string): { schemaRange: string; fixtureCases: number; result: ReturnType<typeof buildResult> } {
  const bundle = path.join(ccGatewayRoot, CC_BUNDLE_PATH)
  const index = objectValue(readJson(path.join(bundle, 'contract-index.json')), 'contract-index.json')
  const compatibility = arrayValue(index.compatibility, 'compatibility')
  const range = compatibility.length === 1 ? objectValue(compatibility[0], 'compatibility[0]') : {}
  if (compatibility.length !== 1 || range.schema_major !== 1 || range.minimum_revision !== 0 || range.maximum_revision !== 0) {
    throw new CrossRepoContractError('contract_schema_range_mismatch', 'contract compatibility range must be exactly 1:0-0')
  }
  validateDigestDAG()
  const result = buildResult(ccGatewayRoot, sub2apiRoot)
  const codes = new Set(checkSharedContract({ ccGatewayRoot, sub2apiRoot }).stableCodes)
  for (const row of [...result.case_rows, ...result.mutation_rows]) {
    if (!codes.has(row.code)) throw new CrossRepoContractError('contract_required_set_mismatch', `unregistered expected code ${row.code}`)
  }
  return { schemaRange: '1:0-0', fixtureCases: result.case_rows.length, result }
}

function findGo(): string {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(directory, 'go')
    try {
      accessSync(candidate, fsConstants.X_OK)
      return candidate
    } catch {
      // Keep searching the already configured PATH; there is no network or installer fallback.
    }
  }
  throw new CrossRepoContractError('contract_command_failed', 'pinned Go executable is unavailable')
}

function gitOutput(root: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 64 * 1024,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0', LANG: 'C', LC_ALL: 'C' },
  })
  if (result.status !== 0 || result.error) throw new CrossRepoContractError('cross_repo_binding_mismatch', 'Git identity command failed')
  return result.stdout.trim()
}

function gitValue(root: string, revision: string): string {
  const value = gitOutput(root, ['rev-parse', revision])
  if (!OID.test(value)) throw new CrossRepoContractError('cross_repo_binding_mismatch', 'Git object identity is invalid')
  return value
}

function actualRepositoryIdentities(ccGatewayRoot: string, sub2apiRoot: string, expectedCcC1?: Readonly<{ commit: string; tree: string }>): { ccHead: string; ccTree: string } {
  const liveHead = gitValue(ccGatewayRoot, 'HEAD')
  const liveTree = gitValue(ccGatewayRoot, 'HEAD^{tree}')
  if (gitOutput(ccGatewayRoot, ['status', '--porcelain=v1', '--untracked-files=normal']) !== '') {
    throw new CrossRepoContractError('cross_repo_binding_mismatch', 'CC checkout is not clean')
  }
  let ccHead = liveHead
  let ccTree = liveTree
  if (expectedCcC1) {
    if (!OID.test(expectedCcC1.commit) || !OID.test(expectedCcC1.tree) || gitValue(ccGatewayRoot, `${expectedCcC1.commit}^{tree}`) !== expectedCcC1.tree) throw new CrossRepoContractError('cross_repo_binding_mismatch', 'expected C1 candidate identity is invalid')
    const parents = gitOutput(ccGatewayRoot, ['show', '-s', '--format=%P', liveHead]).split(' ').filter(Boolean)
    if (parents.length !== 2) throw new CrossRepoContractError('cross_repo_binding_mismatch', 'live CC approval is not a two-parent merge')
    const attestation = parents[1]
    const attestationParents = gitOutput(ccGatewayRoot, ['show', '-s', '--format=%P', attestation]).split(' ').filter(Boolean)
    if (attestationParents.length !== 1 || attestationParents[0] !== expectedCcC1.commit || gitValue(ccGatewayRoot, `${attestation}^{tree}`) !== liveTree) throw new CrossRepoContractError('cross_repo_binding_mismatch', 'live CC approval does not merge the direct candidate attestation tree')
    gitOutput(ccGatewayRoot, ['merge-base', '--is-ancestor', parents[0], expectedCcC1.commit])
    ccHead = expectedCcC1.commit
    ccTree = expectedCcC1.tree
  }

  const subHead = gitValue(sub2apiRoot, 'HEAD')
  const subHeadTree = gitValue(sub2apiRoot, 'HEAD^{tree}')
  gitOutput(sub2apiRoot, ['cat-file', '-e', `${SUB_RECEIPT_MERGE}^{commit}`])
  const subMergeTree = gitValue(sub2apiRoot, `${SUB_RECEIPT_MERGE}^{tree}`)
  const subMergeParents = gitOutput(sub2apiRoot, ['show', '-s', '--format=%P', SUB_RECEIPT_MERGE])
  if ((subHead !== SUB_RECEIPT_MERGE && subHead !== SUB_RECEIPT_PARENTS[1]) || subHeadTree !== SUB_RECEIPT_TREE || subMergeTree !== SUB_RECEIPT_TREE || subMergeParents !== SUB_RECEIPT_PARENTS.join(' ') || gitOutput(sub2apiRoot, ['status', '--porcelain=v1', '--untracked-files=no']) !== '') {
    throw new CrossRepoContractError('cross_repo_binding_mismatch', 'Sub checkout or receipt merge identity differs')
  }
  return { ccHead, ccTree }
}

function validateSubReceipt(raw: Uint8Array, expected: {
  bundle_sha256: string
  decisions_sha256: string
  mutation_results_sha256: string
  required_set_sha256: string
  executed_required_sha256: string
  declared_decisions_sha256: string
  declared_mutations_sha256: string
  stable_code_count: number
  stable_code_set_sha256: string
  record_input_sha256: string
}): string {
  const bytes = Buffer.from(raw)
  if (bytes.length < 2 || bytes.length > 1 << 20 || bytes.at(-1) !== 0x0a || bytes.at(-2) === 0x0a || bytes.at(-2) === 0x0d || bytes.at(-2) === 0x20 || bytes.at(-2) === 0x09) {
    throw new CrossRepoContractError('contract_command_failed', 'Sub receipt framing is invalid')
  }
  let receipt: JsonObject
  try {
    receipt = objectValue(parseStrictJson(bytes.subarray(0, -1), 'Sub receipt'), 'Sub receipt')
  } catch {
    throw new CrossRepoContractError('contract_command_failed', 'Sub receipt is not strict JSON')
  }
  if (!canonicalBytes(receipt).equals(bytes.subarray(0, -1))) throw new CrossRepoContractError('contract_command_failed', 'Sub receipt is not canonical JCS')
  exactKeys(receipt, [
    'schema_id', 'schema_major', 'schema_revision', 'bundle_sha256', 'decisions_sha256',
    'mutation_results_sha256', 'required_set_sha256', 'executed_required_sha256',
    'declared_decisions_sha256', 'declared_mutations_sha256', 'stable_code_count',
    'stable_code_set_sha256', 'record_input_sha256', 'mirror_validation_code',
    'index_validation_code', 'record_validation_code', 'mirror_validation_allowed',
    'index_validation_allowed', 'record_validation_allowed', 'receipt_digest',
  ], 'Sub receipt')
  if (receipt.schema_id !== 'oracle.sub_contract_receipt' || receipt.schema_major !== 1 || receipt.schema_revision !== 0 ||
      receipt.mirror_validation_code !== '' || receipt.index_validation_code !== '' || receipt.record_validation_code !== '' ||
      receipt.mirror_validation_allowed !== true || receipt.index_validation_allowed !== true || receipt.record_validation_allowed !== true) {
    throw new CrossRepoContractError('contract_command_failed', 'Sub receipt validation decision differs')
  }
  for (const [field, value] of Object.entries(expected)) {
    if (receipt[field] !== value) throw new CrossRepoContractError('contract_command_failed', `Sub receipt ${field} differs`)
  }
  const digest = receipt.receipt_digest
  const unsigned = { ...receipt }
  delete unsigned.receipt_digest
  if (typeof digest !== 'string' || !SHA256.test(digest) || digest !== digestWithLF(unsigned)) {
    throw new CrossRepoContractError('contract_command_failed', 'Sub receipt digest differs')
  }
  return digest
}

function runExactSubCommand(ccGatewayRoot: string, sub2apiRoot: string, staticResult: ReturnType<typeof buildResult>, recordBytes?: Uint8Array): { digest: string; bytes: Buffer } {
  const runRoot = realpathSync(mkdtempSync(path.join(tmpdir(), 'oracle-c1-sub-focused-')))
  for (const directory of ['home', 'tmp', 'go-build', 'go-mod-empty', 'go-tmp']) mkdirSync(path.join(runRoot, directory))
  const boundRecord = Buffer.from(recordBytes ?? encodeCrossRepoRecord(buildCrossRepoRecord(ccGatewayRoot, sub2apiRoot, {
    issuedAtMs: Date.now(),
    ccC1Commit: gitValue(ccGatewayRoot, 'HEAD'),
    ccC1Tree: gitValue(ccGatewayRoot, 'HEAD^{tree}'),
    crossReviewTaskId: 'task:c1-receipt-validation',
    crossReviewArtifactSha256: '1'.repeat(64),
  })))
  validateCrossRepoRecord(boundRecord, ccGatewayRoot, sub2apiRoot)
  const recordPath = path.join(runRoot, 'cross-repo-record.json')
  const receiptPath = path.join(runRoot, 'sub-receipt.json')
  writeFileSync(recordPath, boundRecord, { flag: 'wx', mode: 0o600 })
  const go = findGo()
  const env: NodeJS.ProcessEnv = {
    HOME: path.join(runRoot, 'home'),
    PATH: path.dirname(go),
    TMPDIR: path.join(runRoot, 'tmp'),
    GOCACHE: path.join(runRoot, 'go-build'),
    GOMODCACHE: path.join(runRoot, 'go-mod-empty'),
    GOTMPDIR: path.join(runRoot, 'go-tmp'),
    GOENV: 'off', GOTOOLCHAIN: 'local', CGO_ENABLED: '0', GOPROXY: 'off', GOSUMDB: 'off',
    ORACLE_CONTRACT_RECEIPT_OUTPUT: receiptPath,
    ORACLE_CONTRACT_RECEIPT_RECORD: recordPath,
    ORACLE_CONTRACT_RECEIPT_CC_MIRROR: path.join(ccGatewayRoot, CC_BUNDLE_PATH),
    ORACLE_CONTRACT_RECEIPT_SUB_MIRROR: path.join(sub2apiRoot, SUB_BUNDLE_PATH),
    ORACLE_CONTRACT_RECEIPT_PREDECESSOR: path.join(sub2apiRoot, PHASE1_CONTRACT_PATH),
  }
  const result = spawnSync(go, [...SUB_TEST_ARGS], { cwd: path.join(sub2apiRoot, 'backend'), env, encoding: 'utf8', timeout: 600_000, maxBuffer: 2 << 20 })
  if (result.status !== 0) {
    throw new CrossRepoContractError('contract_command_failed', 'exact Sub oracleevidence command failed')
  }
  const receiptInfo = lstatSync(receiptPath)
  if (!receiptInfo.isFile() || receiptInfo.isSymbolicLink() || (receiptInfo.mode & 0o777) !== 0o600) {
    throw new CrossRepoContractError('contract_command_failed', 'Sub receipt type or mode differs')
  }
  const receiptBytes = readFileSync(receiptPath)
  const digest = validateSubReceipt(receiptBytes, {
    bundle_sha256: digestWithLF(CONTRACT_FILES.map((relative_path) => ({ relative_path, sha256: CONTRACT_FILE_SHA256[relative_path] }))),
    decisions_sha256: FROZEN_SUB_EXECUTION_DECISIONS_SHA256,
    mutation_results_sha256: FROZEN_SUB_EXECUTION_MUTATIONS_SHA256,
    required_set_sha256: staticResult.required_set_sha256,
    executed_required_sha256: digestWithLF([...SUB_RECEIPT_REQUIRED_TESTS]),
    declared_decisions_sha256: staticResult.decisions_sha256,
    declared_mutations_sha256: staticResult.mutation_results_sha256,
    stable_code_count: staticResult.stable_code_count,
    stable_code_set_sha256: staticResult.stable_code_set_sha256,
    record_input_sha256: sha256Bytes(boundRecord),
  })
  return { digest, bytes: receiptBytes }
}

export function executeCrossRepoRecord(input: { ccGatewayRoot: string; sub2apiRoot: string; recordBytes: Uint8Array }): { result: CrossRepoContractResult; receiptBytes: Buffer } {
  const shared = checkSharedContract({ ccGatewayRoot: input.ccGatewayRoot, sub2apiRoot: input.sub2apiRoot })
  const staticResult = validateStaticContract(input.ccGatewayRoot, input.sub2apiRoot)
  validateCrossRepoRecord(input.recordBytes, input.ccGatewayRoot, input.sub2apiRoot)
  const receipt = runExactSubCommand(input.ccGatewayRoot, input.sub2apiRoot, staticResult.result, input.recordBytes)
  return {
    result: {
      ok: true, bundleDigest: shared.bundleDigest, schemaRange: staticResult.schemaRange,
      fixtureCases: staticResult.fixtureCases, commandsRun: 1,
      decisionRows: staticResult.result.case_rows.length, mutationRows: staticResult.result.mutation_rows.length,
      decisionsDigest: staticResult.result.decisions_sha256,
      mutationResultsDigest: staticResult.result.mutation_results_sha256,
      requiredSetDigest: staticResult.result.required_set_sha256,
      stableCodeSetDigest: staticResult.result.stable_code_set_sha256,
      subReceiptDigest: receipt.digest,
    },
    receiptBytes: receipt.bytes,
  }
}

export type CrossRepoRecordInput = {
  issuedAtMs: number
  ccC1Commit: string
  ccC1Tree: string
  crossReviewTaskId: string
  crossReviewArtifactSha256: string
  subReviewTaskId?: string
  subReviewArtifactSha256?: string
  commandId?: string
  selectionOverride?: {
    artifact: Uint8Array
    controllerId: string
    taskId: string
    issuedAtMs: number
  }
}

function recordCore(ccGatewayRoot: string, sub2apiRoot: string, input: CrossRepoRecordInput): JsonObject {
  if (!Number.isSafeInteger(input.issuedAtMs) || input.issuedAtMs < 0 || !OID.test(input.ccC1Commit) || !OID.test(input.ccC1Tree) || !SAFE_REF.test(input.crossReviewTaskId) || !SHA256.test(input.crossReviewArtifactSha256)) {
    throw new CrossRepoContractError('contract_schema_invalid', 'record input bindings are invalid')
  }
  const commandId = input.commandId ?? 'command:c1-cross-repo'
  const subReviewTaskId = input.subReviewTaskId ?? 'task:true-sub-review'
  const subReviewArtifact = input.subReviewArtifactSha256 ?? '0b61d7affdb8b7c867a47c82f2d34cf7a58ecce88c71ffa5ac52a7abb3852869'
  if (!SAFE_REF.test(commandId) || !SAFE_REF.test(subReviewTaskId) || !SHA256.test(subReviewArtifact)) throw new CrossRepoContractError('contract_schema_invalid', 'record review bindings are invalid')
  const selection = input.selectionOverride
    ? {
        mode: 'total_controller_local_override',
        selection_override_sha256: sha256Bytes(input.selectionOverride.artifact),
        selection_override_controller_id: input.selectionOverride.controllerId,
        selection_override_task_id: input.selectionOverride.taskId,
        selection_override_issued_at_ms: input.selectionOverride.issuedAtMs,
        selection_override_decision: 'authorize_refs/heads/codex/native-search-gateway_at_3ac410ea02edc53c3925f28eddcbc22b51c0a137',
      }
    : { mode: 'remote_ref', selected_remote_name: 'muqihang', selected_remote_url: 'https://github.com/muqihang/sub2api.git', selected_remote_ref: 'refs/remotes/muqihang/codex/native-search-gateway', selected_remote_oid: '3ac410ea02edc53c3925f28eddcbc22b51c0a137' }
  if (input.selectionOverride && (!SAFE_REF.test(input.selectionOverride.controllerId) || !SAFE_REF.test(input.selectionOverride.taskId) || !Number.isSafeInteger(input.selectionOverride.issuedAtMs) || input.selectionOverride.issuedAtMs < 0)) {
    throw new CrossRepoContractError('contract_schema_invalid', 'selection override provenance is invalid')
  }

  const shared = checkSharedContract({ ccGatewayRoot, sub2apiRoot })
  const result = buildResult(ccGatewayRoot, sub2apiRoot)
  const heads = [
    ['debe0360384132d6e66c0296219ea6066193e187', 'ffca2a0a892b2292b486533089f3276f28b39d4e'],
    ['3ac410ea02edc53c3925f28eddcbc22b51c0a137', 'f7d51fb57c64fbaf6e2db3a7a2d423a491d5788d'],
    [SUB_RECEIPT_MERGE, SUB_RECEIPT_TREE],
    ['795c1f810b5647840fec508951cfc3272066d8b6', 'efb99a079e76817a38a9a48b053cdc6504e37025'],
    ['ab861d91100354569969335ecf10081b74070e21', '512e1adadba3f8832292872ebf9c6d2ed8619200'],
    ['ab861d91100354569969335ecf10081b74070e21', '512e1adadba3f8832292872ebf9c6d2ed8619200'],
    [input.ccC1Commit, input.ccC1Tree],
    [input.ccC1Commit, input.ccC1Tree],
  ]
  const nodes = SERIAL_NODE_IDS.map((id, index) => ({
    id, role: SERIAL_ROLES[index], parent_ids: index === 0 ? [] : [SERIAL_NODE_IDS[index - 1]],
    head: heads[index][0], tree: heads[index][1],
  }))
  return {
    schema_id: 'oracle.cross_repo_record', schema_major: 1, schema_revision: 0, kind: 'oracle_contract_rebaseline',
    authority: {
      cc: { repository_url: 'https://github.com/muqihang/cc-gateway.git', selected_remote_name: 'muqihang', selected_remote_ref: 'refs/remotes/muqihang/main', selected_remote_oid: 'debe0360384132d6e66c0296219ea6066193e187', commit: 'debe0360384132d6e66c0296219ea6066193e187', tree: 'ffca2a0a892b2292b486533089f3276f28b39d4e', amendment_sha256: 'eeaefeddbfe740003288f9d8ec8ba4673b57cca91f4fc3bf5cea5db02feaefaf' },
      sub: {
        repository_url: 'https://github.com/Wei-Shaw/sub2api.git', selected_local_ref: 'refs/heads/codex/native-search-gateway', selected_local_oid: '3ac410ea02edc53c3925f28eddcbc22b51c0a137',
        commit: '3ac410ea02edc53c3925f28eddcbc22b51c0a137', tree: 'f7d51fb57c64fbaf6e2db3a7a2d423a491d5788d', parent: '04e42ae0f6c556daad21ac393eb284585092e805', ancestor: 'fc0b1989d7ba9ce06ff151b17c94b50df4170a93',
        go_mod_sha256: 'e637999a38f974c9172c8f69c8fbb9c0d727bacf257558307e97e927cbb468de', go_sum_sha256: 'd3e1fd1510b41f218136b719fdf2c4ef239b05650d3b575fb93c18f25f3dc981', go_directive: '1.26.5',
        predecessor_relative_path: 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json', predecessor_sha256: PHASE1_CONTRACT_DIGEST,
        codegraph_config_sha256: 'a7f3ad7c17d655f9d2494b5b05e55ceb4ea9c7667456ff785c5f2a9291c3783a', codegraph_version: '1.1.6', codegraph_extraction_revision: 24,
        selection,
        sub_plan_commit: SUB_RECEIPT_MERGE, sub_plan_tree: SUB_RECEIPT_TREE, sub_plan_sha256: 'eeaefeddbfe740003288f9d8ec8ba4673b57cca91f4fc3bf5cea5db02feaefaf',
        r1_commit: '795c1f810b5647840fec508951cfc3272066d8b6', r1_tree: 'efb99a079e76817a38a9a48b053cdc6504e37025', i1_commit: 'ab861d91100354569969335ecf10081b74070e21', i1_tree: '512e1adadba3f8832292872ebf9c6d2ed8619200',
      },
      command_id: commandId, reviewer_model: 'gpt-5.6-sol',
    },
    bundle: { files: shared.files, contract_index_sha256: shared.bundleDigest, predecessor_sha256: shared.predecessorDigest, schema_range: '1:0-0', mirror_root: SUB_BUNDLE_PATH, framing: 'core-raw-exact;record-jcs-final-lf' },
    commit_dag: { nodes, edges: CROSS_REPO_RECORD_CONSTRAINTS.serial_edges },
    result,
    review: {
      sub: { task_id: subReviewTaskId, model: 'gpt-5.6-sol', artifact_sha256: subReviewArtifact, critical: 0, important: 0, verdict: 'PLAN_REVIEW_PASS' },
      cross: { task_id: input.crossReviewTaskId, model: 'gpt-5.6-sol', artifact_sha256: input.crossReviewArtifactSha256, critical: 0, important: 0, verdict: 'CROSS_REPO_PASS' },
    },
    issued_at_ms: input.issuedAtMs, expires_at_ms: input.issuedAtMs + CROSS_REPO_RECORD_SCHEMA_PROJECTION.lease_ms,
  }
}

export function buildCrossRepoRecord(ccGatewayRoot: string, sub2apiRoot: string, input: CrossRepoRecordInput): CrossRepoRecord {
  const core = recordCore(ccGatewayRoot, sub2apiRoot, input)
  return { ...core, record_digest: digestWithLF(core) }
}

export function encodeCrossRepoRecord(record: CrossRepoRecord): Buffer {
  return canonicalBytes(record, true)
}

function validateNestedRecordSchema(record: JsonObject): void {
  const authority = objectValue(record.authority, 'authority')
  schemaKeys(authority, CROSS_REPO_RECORD_SCHEMA_PROJECTION.closed_required.authority, 'authority')
  const cc = objectValue(authority.cc, 'authority.cc')
  const sub = objectValue(authority.sub, 'authority.sub')
  schemaKeys(cc, CROSS_REPO_RECORD_SCHEMA_PROJECTION.closed_required.cc, 'authority.cc')
  schemaKeys(sub, CROSS_REPO_RECORD_SCHEMA_PROJECTION.closed_required.sub, 'authority.sub')
  const immutableSub = Object.fromEntries(Object.keys(SUB_IMMUTABLE_BINDINGS).map((key) => [key, sub[key]]))
  requireSchema(canonicalEqual(immutableSub, SUB_IMMUTABLE_BINDINGS), 'authority.sub immutable binding')
  requireSchema(OID.test(String(sub.sub_plan_commit)) && OID.test(String(sub.sub_plan_tree)) && SHA256.test(String(sub.sub_plan_sha256)) && OID.test(String(sub.r1_commit)) && OID.test(String(sub.r1_tree)) && OID.test(String(sub.i1_commit)) && OID.test(String(sub.i1_tree)), 'authority.sub implementation binding')

  const selection = objectValue(sub.selection, 'authority.sub.selection')
  if (selection.mode === 'remote_ref') {
    schemaKeys(selection, CROSS_REPO_RECORD_CONSTRAINTS.selection_branches.remote_ref.required, 'authority.sub.selection')
    requireSchema(SAFE_REF.test(String(selection.selected_remote_name)) && SAFE_REF.test(String(selection.selected_remote_ref)) && OID.test(String(selection.selected_remote_oid)) && String(selection.selected_remote_url).startsWith('https://'), 'remote selection')
  } else if (selection.mode === 'total_controller_local_override') {
    schemaKeys(selection, CROSS_REPO_RECORD_CONSTRAINTS.selection_branches.total_controller_local_override.required, 'authority.sub.selection')
    requireSchema(SHA256.test(String(selection.selection_override_sha256)) && SAFE_REF.test(String(selection.selection_override_controller_id)) && SAFE_REF.test(String(selection.selection_override_task_id)) && Number.isSafeInteger(selection.selection_override_issued_at_ms) && selection.selection_override_decision === 'authorize_refs/heads/codex/native-search-gateway_at_3ac410ea02edc53c3925f28eddcbc22b51c0a137', 'local override selection')
  } else {
    requireSchema(false, 'authority.sub.selection mode')
  }

  const bundle = objectValue(record.bundle, 'bundle')
  schemaKeys(bundle, CROSS_REPO_RECORD_SCHEMA_PROJECTION.closed_required.bundle, 'bundle')
  const files = arrayValue(bundle.files, 'bundle.files')
  requireSchema(files.length === CONTRACT_FILES.length, 'bundle.files')
  for (const raw of files) {
    const file = objectValue(raw, 'bundle file')
    schemaKeys(file, ['relative_path', 'sha256'], 'bundle file')
    requireSchema(typeof file.relative_path === 'string' && SHA256.test(String(file.sha256)), 'bundle file')
  }

  const dag = objectValue(record.commit_dag, 'commit_dag')
  schemaKeys(dag, CROSS_REPO_RECORD_SCHEMA_PROJECTION.closed_required.commit_dag, 'commit_dag')
  for (const raw of arrayValue(dag.nodes, 'commit_dag.nodes')) {
    const node = objectValue(raw, 'commit DAG node')
    schemaKeys(node, ['id', 'role', 'parent_ids', 'head', 'tree'], 'commit DAG node')
    requireSchema(SAFE_REF.test(String(node.id)) && SAFE_REF.test(String(node.role)) && OID.test(String(node.head)) && OID.test(String(node.tree)) && arrayValue(node.parent_ids, 'parent_ids').every((id) => typeof id === 'string' && SAFE_REF.test(id)), 'commit DAG node')
  }
  for (const edge of arrayValue(dag.edges, 'commit_dag.edges')) requireSchema(Array.isArray(edge) && edge.length === 2 && edge.every((id) => typeof id === 'string' && SAFE_REF.test(id)), 'commit DAG edge')

  const result = objectValue(record.result, 'result')
  schemaKeys(result, CROSS_REPO_RECORD_SCHEMA_PROJECTION.closed_required.result, 'result')
  for (const field of ['case_rows', 'mutation_rows'] as const) for (const raw of arrayValue(result[field], `result.${field}`)) {
    const row = objectValue(raw, 'decision row')
    schemaKeys(row, CROSS_REPO_RECORD_SCHEMA_PROJECTION.closed_required.decision_row, 'decision row')
    requireSchema(SAFE_REF.test(String(row.case_id)) && typeof row.allowed === 'boolean' && typeof row.code === 'string' && (row.next_state_digest === null || SHA256.test(String(row.next_state_digest))) && (row.canonical_hex === null || (typeof row.canonical_hex === 'string' && /^[0-9a-f]*$/.test(row.canonical_hex) && row.canonical_hex.length % 2 === 0)), 'decision row')
  }
  const surfaces = objectValue(result.semantic_surfaces, 'result.semantic_surfaces')
  schemaKeys(surfaces, SEMANTIC_SURFACES, 'result.semantic_surfaces')
  requireSchema(SEMANTIC_SURFACES.every((surface) => surfaces[surface] === true), 'result.semantic_surfaces')
  requireSchema(['decisions_sha256', 'mutation_results_sha256', 'required_set_sha256', 'stable_code_set_sha256'].every((field) => SHA256.test(String(result[field]))), 'result digests')

  const review = objectValue(record.review, 'review')
  schemaKeys(review, ['sub', 'cross'], 'review')
  for (const role of ['sub', 'cross']) {
    const item = objectValue(review[role], `review.${role}`)
    schemaKeys(item, CROSS_REPO_RECORD_SCHEMA_PROJECTION.closed_required.review_item, `review.${role}`)
    requireSchema(SAFE_REF.test(String(item.task_id)) && item.model === 'gpt-5.6-sol' && SHA256.test(String(item.artifact_sha256)) && item.critical === 0 && item.important === 0 && typeof item.verdict === 'string', `review.${role}`)
  }
}

export function validateCrossRepoRecord(raw: Uint8Array, ccGatewayRoot: string, sub2apiRoot: string, options: { selectionOverrideArtifact?: Uint8Array; expectedCcC1?: Readonly<{ commit: string; tree: string }> } = {}): CrossRepoRecord {
  const bytes = Buffer.from(raw)
  if (bytes.length < 2 || bytes.length > 1 << 20 || bytes.at(-1) !== 0x0a || bytes.at(-2) === 0x0a || bytes.at(-2) === 0x0d || bytes.at(-2) === 0x20 || bytes.at(-2) === 0x09) {
    throw new CrossRepoContractError('cross_repo_binding_mismatch', 'record must be JCS plus exactly one LF')
  }
  const parsed = objectValue(parseStrictJson(bytes.subarray(0, -1), 'cross-repo record'), 'cross-repo record')
  if (!canonicalBytes(parsed).equals(bytes.subarray(0, -1))) throw new CrossRepoContractError('cross_repo_binding_mismatch', 'record is not canonical JCS')
  scanRecord(parsed)
  exactKeys(parsed, CROSS_REPO_RECORD_SCHEMA_PROJECTION.top_level_required, 'record')
  if (parsed.schema_id !== 'oracle.cross_repo_record' || parsed.schema_major !== 1 || parsed.schema_revision !== 0 || parsed.kind !== 'oracle_contract_rebaseline') {
    throw new CrossRepoContractError('contract_schema_invalid', 'record schema identity differs')
  }
  validateNestedRecordSchema(parsed)
  if (!Number.isSafeInteger(parsed.issued_at_ms) || !Number.isSafeInteger(parsed.expires_at_ms) || parsed.expires_at_ms !== (parsed.issued_at_ms as number) + CROSS_REPO_RECORD_SCHEMA_PROJECTION.lease_ms) {
    throw new CrossRepoContractError('cross_repo_binding_mismatch', 'record lease is invalid')
  }
  if (Date.now() > (parsed.expires_at_ms as number)) throw new CrossRepoContractError('cross_repo_record_expired', 'record lease expired')
  const dag = objectValue(parsed.commit_dag, 'commit_dag')
  const nodes = arrayValue(dag.nodes, 'commit_dag.nodes').map((node) => objectValue(node, 'DAG node'))
  const c1 = nodes.find((node) => node.id === 'C1')
  const review = objectValue(parsed.review, 'review')
  const subReview = objectValue(review.sub, 'review.sub')
  const crossReview = objectValue(review.cross, 'review.cross')
  const authority = objectValue(parsed.authority, 'authority')
  if (!c1 || !OID.test(String(c1.head)) || !OID.test(String(c1.tree)) || !SAFE_REF.test(String(authority.command_id)) || authority.reviewer_model !== 'gpt-5.6-sol' || !SAFE_REF.test(String(subReview.task_id)) || !SAFE_REF.test(String(crossReview.task_id)) || !SHA256.test(String(subReview.artifact_sha256)) || !SHA256.test(String(crossReview.artifact_sha256))) {
    throw new CrossRepoContractError('contract_schema_invalid', 'record authority or review binding is invalid')
  }
  const actual = actualRepositoryIdentities(ccGatewayRoot, sub2apiRoot, options.expectedCcC1)
  if (c1.head !== actual.ccHead || c1.tree !== actual.ccTree) {
    throw new CrossRepoContractError('cross_repo_binding_mismatch', 'record C1 identity differs from the CC checkout')
  }
  const expected = buildCrossRepoRecord(ccGatewayRoot, sub2apiRoot, {
    issuedAtMs: parsed.issued_at_ms as number,
    ccC1Commit: String(c1.head), ccC1Tree: String(c1.tree), commandId: String(authority.command_id),
    subReviewTaskId: String(subReview.task_id), subReviewArtifactSha256: String(subReview.artifact_sha256),
    crossReviewTaskId: String(crossReview.task_id), crossReviewArtifactSha256: String(crossReview.artifact_sha256),
    selectionOverride: (() => {
      const sub = objectValue(authority.sub, 'authority.sub')
      const selection = objectValue(sub.selection, 'authority.sub.selection')
      if (selection.mode === 'remote_ref') return undefined
      if (selection.mode !== 'total_controller_local_override' || !options.selectionOverrideArtifact) {
        throw new CrossRepoContractError('contract_schema_invalid', 'selection override artifact is missing')
      }
      return {
        artifact: options.selectionOverrideArtifact,
        controllerId: String(selection.selection_override_controller_id),
        taskId: String(selection.selection_override_task_id),
        issuedAtMs: Number(selection.selection_override_issued_at_ms),
      }
    })(),
  })
  if (!canonicalEqual(parsed.result, expected.result)) throw new CrossRepoContractError('cross_repo_result_mismatch', 'record result differs from independently computed results')
  const unsigned = { ...parsed }
  delete unsigned.record_digest
  if (!SHA256.test(String(parsed.record_digest)) || parsed.record_digest !== digestWithLF(unsigned)) {
    throw new CrossRepoContractError('cross_repo_binding_mismatch', 'record digest differs')
  }
  if (!canonicalEqual(parsed, expected)) throw new CrossRepoContractError('cross_repo_binding_mismatch', 'record schema or constraint projection differs')
  return parsed as CrossRepoRecord
}

export function checkCrossRepoContract(input: { ccGatewayRoot: string; sub2apiRoot: string; runCommands: boolean; recordBytes?: Uint8Array }): CrossRepoContractResult {
  let shared
  try {
    shared = checkSharedContract({ ccGatewayRoot: input.ccGatewayRoot, sub2apiRoot: input.sub2apiRoot })
  } catch (error) {
    if (error instanceof SharedContractError) throw new CrossRepoContractError(error.code, error.message)
    throw error
  }
  const staticResult = validateStaticContract(input.ccGatewayRoot, input.sub2apiRoot)
  const subReceiptDigest = input.runCommands ? runExactSubCommand(input.ccGatewayRoot, input.sub2apiRoot, staticResult.result, input.recordBytes).digest : undefined
  return {
    ok: true, bundleDigest: shared.bundleDigest, schemaRange: staticResult.schemaRange,
    fixtureCases: staticResult.fixtureCases, commandsRun: input.runCommands ? 1 : 0,
    decisionRows: staticResult.result.case_rows.length, mutationRows: staticResult.result.mutation_rows.length,
    decisionsDigest: staticResult.result.decisions_sha256,
    mutationResultsDigest: staticResult.result.mutation_results_sha256,
    requiredSetDigest: staticResult.result.required_set_sha256,
    stableCodeSetDigest: staticResult.result.stable_code_set_sha256,
    subReceiptDigest,
  }
}

function argument(name: string): string | undefined {
  const position = process.argv.indexOf(name)
  return position === -1 ? undefined : process.argv[position + 1]
}

function runCli(): void {
  if (!process.argv.includes('--check')) throw new CrossRepoContractError('contract_cli_usage', 'usage: check-cross-repo.ts --sub2api-root PATH [--cc-gateway-root PATH] --check')
  const sub2apiRoot = argument('--sub2api-root')
  if (!sub2apiRoot) throw new CrossRepoContractError('contract_cli_usage', '--sub2api-root is required')
  console.log(JSON.stringify(checkCrossRepoContract({ ccGatewayRoot: path.resolve(argument('--cc-gateway-root') ?? process.cwd()), sub2apiRoot: path.resolve(sub2apiRoot), runCommands: true })))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    runCli()
  } catch (error) {
    const typed = error instanceof CrossRepoContractError ? error : new CrossRepoContractError('contract_check_failed', (error as Error).message)
    console.error(JSON.stringify({ code: typed.code, message: typed.message }))
    process.exitCode = 1
  }
}
