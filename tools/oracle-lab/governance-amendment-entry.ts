import { execFileSync } from 'node:child_process'
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ARTIFACT_METADATA,
  assertEvidencePath,
  assertSafeArtifact,
  canonicalJson,
  cli,
  COMMIT_RE,
  DIGEST_RE,
  exactKeys,
  isObject,
  parseArgs,
  result,
  sha256,
  type HarnessErrorRecord,
  type HarnessResult,
} from './harness-core.js'

const CLEAN_DIGEST = sha256(Buffer.alloc(0))
const RFC3339_UTC_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{3}))?Z$/
const CAPTURE_INPUT_PATHS = {
  capture_tool: 'tools/oracle-lab/governance-amendment-entry.ts',
  entry_schema: 'docs/superpowers/schemas/oracle-lab-governance-amendment-entry.schema.json',
  receipt_schema: 'docs/superpowers/schemas/oracle-lab-governance-amendment-entry-receipt.schema.json',
} as const

export type PathDigest = { path: string; digest: string }
export type CodeGraphBinding = {
  version: string
  up_to_date: boolean
  index_digest: string
  file_count: number
  node_count: number
  edge_count: number
}

export type GovernanceAmendmentBindings = {
  ccGatewayBaseMainHead: string
  sub2apiBaseMainHead: string
  ccGatewayBranch: string
  sub2apiBranch: string
  remoteName: 'muqihang'
  remoteRef: 'refs/remotes/muqihang/main'
  ccGatewayRemoteUrlDigest: string
  sub2apiRemoteUrlDigest: string
  sharedContractPath: string
  sharedContractDigest: string
  phaseZeroReceiptPath: string
  phaseZeroReceiptDigest: string
  postIntegrationV2ReceiptPath: string
  postIntegrationV2ReceiptDigest: string
  reviewSourceDigest: string
  codegraphVersion: '1.1.6'
  entryPath: string
  receiptPath: string
  disabledCapabilities: readonly string[]
  scope: {
    readonly release: 'P0.1'
    readonly work_package: 'WP-R0'
    readonly requirement_ids: readonly ['HA-P0-004', 'HA-P0-007', 'RA-P0-001']
    readonly in_scope: readonly string[]
    readonly out_of_scope: readonly string[]
  }
}

const DISABLED_CAPABILITIES = [
  'real_upstream_access',
  'real_credentials',
  'provider_internal_authority',
  'profile_promotion',
  'production_deployment',
  'real_canary',
  'direct_egress_trust',
  'unverified_pinned_wire_claims',
  'unsupported_negative_capabilities',
  'expired_or_missing_negative_capabilities',
  'unrestricted_capture',
  'external_network_requests',
] as const

const P0_1_SCOPE = {
  release: 'P0.1',
  work_package: 'WP-R0',
  requirement_ids: ['HA-P0-004', 'HA-P0-007', 'RA-P0-001'],
  in_scope: [
    'adopt_and_correct_review_amendment',
    'overlay_prior_specifications',
    'preserve_seven_phases_with_mandatory_3b_3_5',
    'wp_r0_through_wp_r9_traceability_umbrellas',
    'requirement_registry_v2_and_v1_migration',
    'register_18_ra_requirements_as_deferred',
    'claim_matrix_prohibited_conclusions',
    'ra_current_observation_ledger',
    'bounded_ra_current_009_four_local_test_yaml_repairs',
    'two_joint_tests_in_successor_cross_repository_green_inventory',
    'successor_p0_1_evidence_chain',
    'exact_p1_entry_conditions',
  ],
  out_of_scope: [
    'b1_through_b3_implementation',
    'b4_through_b6_implementation',
    'shared_readiness_handshake_or_contract_redesign',
    'profile_compiler_profile_or_evidence_factory_implementation',
    'account_policy_replay_response_scheduler_or_replica_runtime_work',
    'large_scale_proxy_refactor',
    'production_credentials_external_network_canary_or_promotion',
    'historical_phase_zero_or_post_integration_evidence_mutation',
  ],
} as const

export const GOVERNANCE_AMENDMENT_BINDINGS: GovernanceAmendmentBindings = {
  ccGatewayBaseMainHead: '9ca9ea72d881fccd2cfb3fd1b939a2f56db69516',
  sub2apiBaseMainHead: 'd5a42bbd24d15af2ce7646d050a5ae5c77911d4f',
  ccGatewayBranch: 'codex/oracle-p0-1-governance',
  sub2apiBranch: 'codex/oracle-p0-1-governance',
  remoteName: 'muqihang',
  remoteRef: 'refs/remotes/muqihang/main',
  ccGatewayRemoteUrlDigest: sha256('https://github.com/muqihang/cc-gateway.git'),
  sub2apiRemoteUrlDigest: sha256('https://github.com/muqihang/sub2api.git'),
  sharedContractPath: 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json',
  sharedContractDigest: 'sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1',
  phaseZeroReceiptPath: 'docs/superpowers/evidence/phase-0/phase-0-exit-receipt.json',
  phaseZeroReceiptDigest: 'sha256:5a2bef840e04d6533bfc657520c73cbc8fcc5f27ede181d168d9b2bf8a3fedee',
  postIntegrationV2ReceiptPath: 'docs/superpowers/evidence/post-integration-v2/post-integration-receipt.json',
  postIntegrationV2ReceiptDigest: 'sha256:c6b64e233dfa2df8c4cd8937aa2b8552ac54c68d4593a32a837af20d4923fb64',
  reviewSourceDigest: 'sha256:76e662ede1e113018eb5bf8cb835e2e825ae094d426a1c73c4af17f8a643dbf4',
  codegraphVersion: '1.1.6',
  entryPath: 'docs/superpowers/evidence/p0-1/p0-1-entry-baseline.json',
  receiptPath: 'docs/superpowers/evidence/p0-1/p0-1-entry-baseline.receipt.json',
  disabledCapabilities: DISABLED_CAPABILITIES,
  scope: P0_1_SCOPE,
}

export type RepositoryEntryBinding = {
  head: string
  base_main_head: string
  branch: string
  descends_from_base_main: true
  clean: true
  dirty_digest: string
  user_fork_main: { name: 'muqihang'; ref: 'refs/remotes/muqihang/main'; commit: string; url_digest: string }
}

export type GovernanceAmendmentEntry = {
  schema_version: 1
  compatibility_policy: typeof ARTIFACT_METADATA.compatibility_policy
  retention_class: typeof ARTIFACT_METADATA.retention_class
  redaction_policy: typeof ARTIFACT_METADATA.redaction_policy
  destruction_procedure: typeof ARTIFACT_METADATA.destruction_procedure
  entry_kind: 'governance_amendment_entry'
  generated_at: string
  base_main_heads: { cc_gateway: string; sub2api: string }
  reviewed_tool_head: string
  repositories: { cc_gateway: RepositoryEntryBinding; sub2api: RepositoryEntryBinding }
  shared_contract: { repository: 'sub2api'; path: string; digest: string }
  parent_receipts: { phase_zero: PathDigest; post_integration_v2: PathDigest }
  review_amendment: { source_digest: string }
  capture_inputs: Record<keyof typeof CAPTURE_INPUT_PATHS, PathDigest>
  codegraph: { cc_gateway: CodeGraphBinding; sub2api: CodeGraphBinding }
  runtime: { node: string; npm: string; git: string; go: string; codegraph: string; network_policy: string }
  disabled_capabilities: string[]
  p0_1_scope: { release: string; work_package: string; requirement_ids: string[]; in_scope: string[]; out_of_scope: string[] }
  artifacts: { entry_path: string; receipt_path: string }
}

export type GovernanceAmendmentEntryReceipt = {
  schema_version: 1
  compatibility_policy: typeof ARTIFACT_METADATA.compatibility_policy
  retention_class: typeof ARTIFACT_METADATA.retention_class
  redaction_policy: typeof ARTIFACT_METADATA.redaction_policy
  destruction_procedure: typeof ARTIFACT_METADATA.destruction_procedure
  receipt_kind: 'governance_amendment_entry_receipt'
  generated_at: string
  reviewed_tool_head: string
  base_main_heads: { cc_gateway: string; sub2api: string }
  entry: PathDigest
  receipt_path: string
  entry_schema_digest: string
  receipt_schema_digest: string
}

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

function git(root: string, ...args: string[]): string {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    fail('git_inspection_failed', `Git inspection failed for ${args[0] ?? 'command'}`)
  }
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function add(errors: HarnessErrorRecord[], code: string, pathName: string, message: string): void {
  errors.push({ code, path: pathName, message })
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function exact(value: unknown, fields: readonly string[], where: string, errors: HarnessErrorRecord[]): value is Record<string, unknown> {
  const exactShape = exactKeys(value, fields, where, errors)
  if (!isObject(value)) return false
  for (const field of fields) {
    if (!hasOwn(value, field) && field in value) add(errors, 'missing_field', `${where}.${field}`, `${field} must be an own property`)
  }
  return exactShape
}

function metadataValid(value: Record<string, unknown>): boolean {
  return value.compatibility_policy === ARTIFACT_METADATA.compatibility_policy
    && value.retention_class === ARTIFACT_METADATA.retention_class
    && value.redaction_policy === ARTIFACT_METADATA.redaction_policy
    && value.destruction_procedure === ARTIFACT_METADATA.destruction_procedure
}

function isValidUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = RFC3339_UTC_RE.exec(value)
  if (!match) return false
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return false
  const [, year, month, day, hour, minute, second, millisecond = '000'] = match
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() + 1 === Number(month)
    && date.getUTCDate() === Number(day)
    && date.getUTCHours() === Number(hour)
    && date.getUTCMinutes() === Number(minute)
    && date.getUTCSeconds() === Number(second)
    && date.getUTCMilliseconds() === Number(millisecond)
}

function isRelativeArtifactPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value) || value.includes('\\')) return false
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return false
  const parts = value.split('/')
  return !parts.includes('..') && !parts.includes('') && path.posix.normalize(value) === value
}

function validatePathDigest(value: unknown, where: string, errors: HarnessErrorRecord[]): value is Record<string, unknown> {
  if (!exact(value, ['path', 'digest'], where, errors)) return false
  if (!isRelativeArtifactPath(value.path)) add(errors, 'invalid_relative_path', `${where}.path`, 'path must be repository-relative')
  if (!DIGEST_RE.test(String(value.digest))) add(errors, 'invalid_digest', `${where}.digest`, 'digest must be SHA-256')
  return true
}

function validateCodeGraphValue(value: unknown, where: string, bindings: GovernanceAmendmentBindings, errors: HarnessErrorRecord[]): void {
  if (!exact(value, ['version', 'up_to_date', 'index_digest', 'file_count', 'node_count', 'edge_count'], where, errors)) return
  if (value.version !== bindings.codegraphVersion) add(errors, 'wrong_codegraph_version', `${where}.version`, 'CodeGraph version is not reviewed')
  if (value.up_to_date !== true) add(errors, 'stale_codegraph_index', `${where}.up_to_date`, 'CodeGraph index must be up to date')
  if (!DIGEST_RE.test(String(value.index_digest))) add(errors, 'invalid_digest', `${where}.index_digest`, 'CodeGraph index digest is invalid')
  for (const field of ['file_count', 'node_count', 'edge_count'] as const) {
    if (!Number.isInteger(value[field]) || Number(value[field]) < 1) add(errors, 'invalid_codegraph_status', `${where}.${field}`, 'CodeGraph count must be a positive integer')
  }
}

const metadataFields = ['compatibility_policy', 'retention_class', 'redaction_policy', 'destruction_procedure'] as const
const entryFields = [
  'schema_version', ...metadataFields, 'entry_kind', 'generated_at', 'base_main_heads', 'reviewed_tool_head',
  'repositories', 'shared_contract', 'parent_receipts', 'review_amendment', 'capture_inputs', 'codegraph',
  'runtime', 'disabled_capabilities', 'p0_1_scope', 'artifacts',
] as const
const receiptFields = [
  'schema_version', ...metadataFields, 'receipt_kind', 'generated_at', 'reviewed_tool_head', 'base_main_heads',
  'entry', 'receipt_path', 'entry_schema_digest', 'receipt_schema_digest',
] as const

export function validateGovernanceAmendmentEntryValue(
  value: unknown,
  bindings: GovernanceAmendmentBindings = GOVERNANCE_AMENDMENT_BINDINGS,
): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  try { assertSafeArtifact(value) } catch (error) {
    add(errors, (error as Error & { code?: string }).code ?? 'unsafe_artifact', '$', (error as Error).message)
  }
  if (!exact(value, entryFields, '$', errors)) return result(errors)
  if (!metadataValid(value)) add(errors, 'invalid_metadata', '$', 'artifact lifecycle metadata is invalid')
  if (value.schema_version !== 1 || value.entry_kind !== 'governance_amendment_entry') add(errors, 'invalid_entry', '$.entry_kind', 'entry header is invalid')
  if (!isValidUtcTimestamp(value.generated_at)) add(errors, 'invalid_timestamp', '$.generated_at', 'generated_at must be a real UTC RFC 3339 instant')
  if (!COMMIT_RE.test(String(value.reviewed_tool_head))) add(errors, 'invalid_tool_head', '$.reviewed_tool_head', 'reviewed tool head is invalid')

  const expectedBases = { cc_gateway: bindings.ccGatewayBaseMainHead, sub2api: bindings.sub2apiBaseMainHead }
  if (exact(value.base_main_heads, ['cc_gateway', 'sub2api'], '$.base_main_heads', errors) && !same(value.base_main_heads, expectedBases)) {
    add(errors, 'wrong_base_main_head', '$.base_main_heads', 'frozen base-main heads drifted')
  }

  if (exact(value.repositories, ['cc_gateway', 'sub2api'], '$.repositories', errors)) {
    for (const name of ['cc_gateway', 'sub2api'] as const) {
      const repository = value.repositories[name]
      const where = `$.repositories.${name}`
      if (!exact(repository, ['head', 'base_main_head', 'branch', 'descends_from_base_main', 'clean', 'dirty_digest', 'user_fork_main'], where, errors)) continue
      const expectedBase = name === 'cc_gateway' ? bindings.ccGatewayBaseMainHead : bindings.sub2apiBaseMainHead
      const expectedBranch = name === 'cc_gateway' ? bindings.ccGatewayBranch : bindings.sub2apiBranch
      if (!COMMIT_RE.test(String(repository.head))) add(errors, 'invalid_repository_head', `${where}.head`, 'repository head is invalid')
      if (repository.base_main_head !== expectedBase) add(errors, 'wrong_base_main_head', `${where}.base_main_head`, 'repository base-main head drifted')
      if (repository.branch !== expectedBranch) add(errors, 'wrong_repository_branch', `${where}.branch`, 'repository branch drifted')
      if (repository.descends_from_base_main !== true) add(errors, 'invalid_base_ancestry', `${where}.descends_from_base_main`, 'base ancestry is not proven')
      if (repository.clean !== true || repository.dirty_digest !== CLEAN_DIGEST) add(errors, 'dirty_repository', where, 'repository capture state is not clean')
      if (name === 'cc_gateway' && repository.head !== value.reviewed_tool_head) add(errors, 'reviewed_tool_head_mismatch', `${where}.head`, 'CC Gateway head must equal the reviewed tool head')
      if (name === 'sub2api' && repository.head !== expectedBase) add(errors, 'wrong_repository_head', `${where}.head`, 'Sub2API must remain at its frozen base for entry capture')
      if (exact(repository.user_fork_main, ['name', 'ref', 'commit', 'url_digest'], `${where}.user_fork_main`, errors)) {
        const expectedUrlDigest = name === 'cc_gateway' ? bindings.ccGatewayRemoteUrlDigest : bindings.sub2apiRemoteUrlDigest
        if (repository.user_fork_main.name !== bindings.remoteName || repository.user_fork_main.ref !== bindings.remoteRef
          || repository.user_fork_main.commit !== expectedBase || repository.user_fork_main.url_digest !== expectedUrlDigest) {
          add(errors, 'wrong_base_main_head', `${where}.user_fork_main`, 'user-fork main binding drifted')
        }
      }
    }
  }

  if (exact(value.shared_contract, ['repository', 'path', 'digest'], '$.shared_contract', errors)) {
    if (value.shared_contract.repository !== 'sub2api' || value.shared_contract.path !== bindings.sharedContractPath
      || value.shared_contract.digest !== bindings.sharedContractDigest) add(errors, 'contract_drift', '$.shared_contract', 'shared contract binding drifted')
  }
  if (exact(value.parent_receipts, ['phase_zero', 'post_integration_v2'], '$.parent_receipts', errors)) {
    const expected = {
      phase_zero: { path: bindings.phaseZeroReceiptPath, digest: bindings.phaseZeroReceiptDigest },
      post_integration_v2: { path: bindings.postIntegrationV2ReceiptPath, digest: bindings.postIntegrationV2ReceiptDigest },
    }
    for (const name of ['phase_zero', 'post_integration_v2'] as const) {
      if (validatePathDigest(value.parent_receipts[name], `$.parent_receipts.${name}`, errors) && !same(value.parent_receipts[name], expected[name])) {
        add(errors, 'parent_receipt_drift', `$.parent_receipts.${name}`, 'historical parent receipt binding drifted')
      }
    }
  }
  if (exact(value.review_amendment, ['source_digest'], '$.review_amendment', errors)
    && value.review_amendment.source_digest !== bindings.reviewSourceDigest) add(errors, 'review_amendment_drift', '$.review_amendment.source_digest', 'review amendment source drifted')

  if (exact(value.capture_inputs, Object.keys(CAPTURE_INPUT_PATHS), '$.capture_inputs', errors)) {
    for (const [name, expectedPath] of Object.entries(CAPTURE_INPUT_PATHS)) {
      const binding = value.capture_inputs[name]
      if (validatePathDigest(binding, `$.capture_inputs.${name}`, errors) && binding.path !== expectedPath) add(errors, 'capture_input_drift', `$.capture_inputs.${name}.path`, 'reviewed capture input path drifted')
    }
  }
  if (exact(value.codegraph, ['cc_gateway', 'sub2api'], '$.codegraph', errors)) {
    validateCodeGraphValue(value.codegraph.cc_gateway, '$.codegraph.cc_gateway', bindings, errors)
    validateCodeGraphValue(value.codegraph.sub2api, '$.codegraph.sub2api', bindings, errors)
  }
  if (exact(value.runtime, ['node', 'npm', 'git', 'go', 'codegraph', 'network_policy'], '$.runtime', errors)) {
    for (const field of ['node', 'npm', 'git', 'go', 'codegraph', 'network_policy'] as const) if (!DIGEST_RE.test(String(value.runtime[field]))) add(errors, 'invalid_digest', `$.runtime.${field}`, 'runtime digest is invalid')
  }
  if (!same(value.disabled_capabilities, bindings.disabledCapabilities)) add(errors, 'disabled_capability_drift', '$.disabled_capabilities', 'disabled capabilities must remain exact')
  if (!same(value.p0_1_scope, bindings.scope)) add(errors, 'scope_drift', '$.p0_1_scope', 'P0.1 scope must remain exact')
  if (exact(value.artifacts, ['entry_path', 'receipt_path'], '$.artifacts', errors)) {
    if (!isRelativeArtifactPath(value.artifacts.entry_path) || !isRelativeArtifactPath(value.artifacts.receipt_path)) add(errors, 'invalid_relative_path', '$.artifacts', 'entry paths must be repository-relative')
    if (value.artifacts.entry_path !== bindings.entryPath || value.artifacts.receipt_path !== bindings.receiptPath) add(errors, 'artifact_path_drift', '$.artifacts', 'entry pair paths drifted')
  }
  return result(errors)
}

export function validateGovernanceAmendmentEntryReceiptValue(
  value: unknown,
  bindings: GovernanceAmendmentBindings = GOVERNANCE_AMENDMENT_BINDINGS,
): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  try { assertSafeArtifact(value) } catch (error) {
    add(errors, (error as Error & { code?: string }).code ?? 'unsafe_artifact', '$', (error as Error).message)
  }
  if (!exact(value, receiptFields, '$', errors)) return result(errors)
  if (!metadataValid(value)) add(errors, 'invalid_metadata', '$', 'artifact lifecycle metadata is invalid')
  if (value.schema_version !== 1 || value.receipt_kind !== 'governance_amendment_entry_receipt') add(errors, 'invalid_receipt', '$.receipt_kind', 'receipt header is invalid')
  if (!isValidUtcTimestamp(value.generated_at)) add(errors, 'invalid_timestamp', '$.generated_at', 'generated_at must be a real UTC RFC 3339 instant')
  if (!COMMIT_RE.test(String(value.reviewed_tool_head))) add(errors, 'invalid_tool_head', '$.reviewed_tool_head', 'reviewed tool head is invalid')
  const expectedBases = { cc_gateway: bindings.ccGatewayBaseMainHead, sub2api: bindings.sub2apiBaseMainHead }
  if (exact(value.base_main_heads, ['cc_gateway', 'sub2api'], '$.base_main_heads', errors) && !same(value.base_main_heads, expectedBases)) add(errors, 'wrong_base_main_head', '$.base_main_heads', 'receipt base-main heads drifted')
  validatePathDigest(value.entry, '$.entry', errors)
  if (value.receipt_path !== bindings.receiptPath || !isRelativeArtifactPath(value.receipt_path)) add(errors, 'artifact_path_drift', '$.receipt_path', 'receipt path drifted')
  for (const field of ['entry_schema_digest', 'receipt_schema_digest'] as const) if (!DIGEST_RE.test(String(value[field]))) add(errors, 'invalid_digest', `$.${field}`, 'schema digest is invalid')
  return result(errors)
}

function requireValid(validation: HarnessResult): void {
  if (!validation.ok) fail(validation.errors[0]?.code ?? 'validation_failed', JSON.stringify(validation.errors))
}

function artifactBytes(value: unknown): Buffer {
  return Buffer.from(`${canonicalJson(value)}\n`)
}

export function validateGovernanceAmendmentEntryPair(
  entry: unknown,
  receipt: unknown,
  options: { bindings?: GovernanceAmendmentBindings } = {},
): asserts entry is GovernanceAmendmentEntry {
  if (!isObject(entry) || !isObject(receipt)) fail('missing_entry_pair', 'entry and receipt must be supplied together')
  const bindings = options.bindings ?? GOVERNANCE_AMENDMENT_BINDINGS
  requireValid(validateGovernanceAmendmentEntryValue(entry, bindings))
  requireValid(validateGovernanceAmendmentEntryReceiptValue(receipt, bindings))
  if (receipt.generated_at !== entry.generated_at || receipt.reviewed_tool_head !== entry.reviewed_tool_head
    || !same(receipt.base_main_heads, entry.base_main_heads)) fail('entry_receipt_binding_mismatch', 'receipt header does not bind the entry')
  if (!isObject(receipt.entry) || !isObject(entry.artifacts) || receipt.entry.path !== entry.artifacts.entry_path
    || receipt.entry.digest !== sha256(artifactBytes(entry)) || receipt.receipt_path !== entry.artifacts.receipt_path) {
    fail('entry_receipt_digest_mismatch', 'receipt does not bind the canonical entry bytes and pair paths')
  }
  if (!isObject(entry.capture_inputs)
    || !isObject(entry.capture_inputs.entry_schema)
    || !isObject(entry.capture_inputs.receipt_schema)
    || receipt.entry_schema_digest !== entry.capture_inputs.entry_schema.digest
    || receipt.receipt_schema_digest !== entry.capture_inputs.receipt_schema.digest) {
    fail('entry_receipt_binding_mismatch', 'receipt schema digests do not bind reviewed capture inputs')
  }
}

function assertRelativePath(value: string, label: string): void {
  if (!isRelativeArtifactPath(value)) fail('invalid_relative_path', `${label} must be repository-relative`)
}

function confinedFile(root: string, relative: string, label: string): string {
  assertRelativePath(relative, label)
  const absolute = path.resolve(root, relative)
  const rel = path.relative(root, absolute)
  if (rel.startsWith('..') || path.isAbsolute(rel)) fail('artifact_path_escape', `${label} escapes its repository`)
  return absolute
}

function readBoundBytes(root: string, relative: string, label: string): Buffer {
  const absolute = confinedFile(root, relative, label)
  let stat
  try { stat = lstatSync(absolute) } catch { fail('missing_capture_input', `${label} is missing`) }
  if (!stat.isFile() || stat.isSymbolicLink()) fail('capture_input_symlink', `${label} must be a regular non-symlink file`)
  const real = realpathSync(absolute)
  const rel = path.relative(root, real)
  if (rel.startsWith('..') || path.isAbsolute(rel)) fail('capture_input_escape', `${label} escapes its repository`)
  return readFileSync(real)
}

function assertImmutableInputs(options: {
  ccGatewayRoot: string
  sub2apiRoot: string
  reviewSourcePath: string
  bindings: GovernanceAmendmentBindings
}): void {
  const { ccGatewayRoot, sub2apiRoot, reviewSourcePath, bindings } = options
  if (sha256(readBoundBytes(sub2apiRoot, bindings.sharedContractPath, 'shared contract')) !== bindings.sharedContractDigest) fail('contract_drift', 'shared-contract bytes drifted')
  if (sha256(readBoundBytes(ccGatewayRoot, bindings.phaseZeroReceiptPath, 'Phase 0 receipt')) !== bindings.phaseZeroReceiptDigest) fail('parent_receipt_drift', 'historical Phase 0 receipt bytes drifted')
  if (sha256(readBoundBytes(ccGatewayRoot, bindings.postIntegrationV2ReceiptPath, 'post-integration V2 receipt')) !== bindings.postIntegrationV2ReceiptDigest) fail('parent_receipt_drift', 'historical post-integration V2 receipt bytes drifted')
  let sourceStat
  try { sourceStat = lstatSync(reviewSourcePath) } catch { fail('missing_review_amendment', 'review amendment source is missing') }
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) fail('review_amendment_symlink', 'review amendment source must be a regular non-symlink file')
  if (sha256(readFileSync(realpathSync(reviewSourcePath))) !== bindings.reviewSourceDigest) fail('review_amendment_drift', 'unadopted review-amendment source bytes drifted')
}

export function inspectGovernanceRepository(options: {
  root: string
  baseMainHead: string
  branch: string
  remoteName: string
  remoteRef: string
  remoteUrlDigest: string
}): RepositoryEntryBinding {
  const root = realpathSync(options.root)
  let remoteCommit: string
  try { remoteCommit = git(root, 'rev-parse', '--verify', options.remoteRef) } catch { fail('wrong_base_main_head', `${options.remoteRef} is unavailable`) }
  if (remoteCommit !== options.baseMainHead) fail('wrong_base_main_head', 'user-fork main no longer equals the frozen base')
  const head = git(root, 'rev-parse', 'HEAD')
  try { execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', options.baseMainHead, head], { stdio: 'ignore' }) }
  catch { fail('invalid_base_ancestry', 'working branch does not descend from frozen user-fork main') }
  const branch = git(root, 'rev-parse', '--abbrev-ref', 'HEAD')
  if (branch !== options.branch) fail('wrong_repository_branch', `repository branch is ${branch}`)
  let remoteUrl: string
  try { remoteUrl = git(root, 'remote', 'get-url', options.remoteName) } catch { fail('wrong_remote_ref', 'user-fork remote is missing') }
  if (sha256(remoteUrl) !== options.remoteUrlDigest) fail('wrong_remote_ref', 'user-fork remote URL digest drifted')
  const status = execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { encoding: 'buffer' })
  if (status.length !== 0) fail('dirty_repository', 'repository has tracked or untracked inputs outside ignored local state')
  return {
    head,
    base_main_head: options.baseMainHead,
    branch,
    descends_from_base_main: true,
    clean: true,
    dirty_digest: sha256(status),
    user_fork_main: { name: 'muqihang', ref: 'refs/remotes/muqihang/main', commit: remoteCommit, url_digest: sha256(remoteUrl) },
  }
}

export function parseCodeGraphStatus(value: unknown, indexDigest: string): CodeGraphBinding {
  if (!isObject(value)) fail('invalid_codegraph_status', 'CodeGraph status must be an object')
  for (const field of ['initialized', 'version', 'fileCount', 'nodeCount', 'edgeCount', 'pendingChanges', 'worktreeMismatch', 'index']) {
    if (!hasOwn(value, field)) fail('invalid_codegraph_status', `CodeGraph status is missing ${field}`)
  }
  if (value.initialized !== true) fail('missing_codegraph_index', 'CodeGraph index is not initialized')
  if (typeof value.version !== 'string' || value.version.length === 0) fail('invalid_codegraph_status', 'CodeGraph version is invalid')
  for (const field of ['fileCount', 'nodeCount', 'edgeCount'] as const) {
    if (!Number.isInteger(value[field]) || Number(value[field]) < 1) fail('invalid_codegraph_status', `CodeGraph ${field} is invalid`)
  }
  if (!DIGEST_RE.test(indexDigest)) fail('invalid_codegraph_status', 'CodeGraph index digest is invalid')
  if (!isObject(value.pendingChanges)) fail('invalid_codegraph_status', 'CodeGraph pendingChanges must be an object')
  for (const field of ['added', 'modified', 'removed'] as const) {
    if (!hasOwn(value.pendingChanges, field) || !Number.isInteger(value.pendingChanges[field]) || Number(value.pendingChanges[field]) < 0) {
      fail('invalid_codegraph_status', `CodeGraph pendingChanges is missing valid ${field}`)
    }
  }
  if (!hasOwn(value, 'worktreeMismatch') || (value.worktreeMismatch !== null && !isObject(value.worktreeMismatch))) {
    fail('invalid_codegraph_status', 'CodeGraph worktreeMismatch is missing or invalid')
  }
  if (!isObject(value.index) || !hasOwn(value.index, 'reindexRecommended') || typeof value.index.reindexRecommended !== 'boolean') {
    fail('invalid_codegraph_status', 'CodeGraph index.reindexRecommended is missing or invalid')
  }
  const upToDate = value.pendingChanges.added === 0
    && value.pendingChanges.modified === 0
    && value.pendingChanges.removed === 0
    && value.worktreeMismatch === null
    && value.index.reindexRecommended === false
  return {
    version: value.version,
    up_to_date: upToDate,
    index_digest: indexDigest,
    file_count: Number(value.fileCount),
    node_count: Number(value.nodeCount),
    edge_count: Number(value.edgeCount),
  }
}

export function inspectCodeGraphIndex(rootInput: string): CodeGraphBinding {
  const root = realpathSync(rootInput)
  let status: unknown
  try {
    status = JSON.parse(execFileSync('codegraph', ['status', '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) as unknown
  } catch {
    fail('missing_codegraph_index', 'CodeGraph status is unavailable')
  }
  const dbPath = path.join(root, '.codegraph/codegraph.db')
  let dbStat
  try { dbStat = lstatSync(dbPath) } catch { fail('missing_codegraph_index', 'CodeGraph database is missing') }
  if (!dbStat.isFile() || dbStat.isSymbolicLink()) fail('missing_codegraph_index', 'CodeGraph database must be a regular non-symlink file')
  return parseCodeGraphStatus(status, sha256(readFileSync(dbPath)))
}

function reviewedCaptureInputs(root: string, head: string): Record<keyof typeof CAPTURE_INPUT_PATHS, PathDigest> {
  return Object.fromEntries(Object.entries(CAPTURE_INPUT_PATHS).map(([name, relative]) => {
    const worktreeBytes = readBoundBytes(root, relative, relative)
    let committedBytes: Buffer
    try { committedBytes = execFileSync('git', ['-C', root, 'show', `${head}:${relative}`], { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch { fail('missing_reviewed_capture_input', `${relative} is absent from reviewed tool head`) }
    const digest = sha256(committedBytes)
    if (sha256(worktreeBytes) !== digest) fail('capture_input_drift', `${relative} differs from reviewed tool head`)
    return [name, { path: relative, digest }]
  })) as Record<keyof typeof CAPTURE_INPUT_PATHS, PathDigest>
}

export function validateGovernanceAmendmentCaptureInputsAtToolCommit(options: {
  ccGatewayRoot: string
  toolCommit: string
  entry: GovernanceAmendmentEntry
  bindings?: GovernanceAmendmentBindings
}): void {
  const bindings = options.bindings ?? GOVERNANCE_AMENDMENT_BINDINGS
  const root = realpathSync(options.ccGatewayRoot)
  const toolCommit = git(root, 'rev-parse', `${options.toolCommit}^{commit}`)
  if (options.entry.reviewed_tool_head !== toolCommit) fail('reviewed_tool_head_mismatch', 'entry reviewed_tool_head differs from the supplied tool commit')
  try { execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', bindings.ccGatewayBaseMainHead, toolCommit], { stdio: 'ignore' }) }
  catch { fail('invalid_reviewed_tool_ancestry', 'reviewed tool commit does not descend from frozen CC Gateway main') }
  for (const [name, relative] of Object.entries(CAPTURE_INPUT_PATHS) as Array<[keyof typeof CAPTURE_INPUT_PATHS, string]>) {
    const binding = options.entry.capture_inputs[name]
    if (binding.path !== relative) fail('capture_input_drift', `${name} path differs from the reviewed tool binding`)
    let committedBytes: Buffer
    try { committedBytes = execFileSync('git', ['-C', root, 'show', `${toolCommit}:${relative}`], { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch { fail('missing_reviewed_capture_input', `${relative} is absent from the reviewed tool commit`) }
    if (sha256(committedBytes) !== binding.digest) fail('capture_input_drift', `${relative} digest differs from the reviewed tool commit`)
  }
}

function checkedCodeGraph(value: CodeGraphBinding, bindings: GovernanceAmendmentBindings): CodeGraphBinding {
  if (!isObject(value)) fail('missing_codegraph_index', 'CodeGraph inspector did not return a status object')
  if (value.version !== bindings.codegraphVersion) fail('wrong_codegraph_version', `CodeGraph ${value.version} is not reviewed`)
  if (value.up_to_date !== true) fail('stale_codegraph_index', 'CodeGraph index has pending or stale state')
  if (!DIGEST_RE.test(String(value.index_digest)) || !Number.isInteger(value.file_count) || value.file_count < 1
    || !Number.isInteger(value.node_count) || value.node_count < 1 || !Number.isInteger(value.edge_count) || value.edge_count < 1) {
    fail('invalid_codegraph_status', 'CodeGraph status is incomplete')
  }
  return value
}

function versionDigest(command: string, args: string[]): string {
  try { return sha256(execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()) }
  catch { fail('missing_runtime_tool', `${command} is required`) }
}

const HERMETIC_NETWORK_ENV = {
  npm_config_offline: 'true',
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  GOPROXY: 'off',
  GOSUMDB: 'off',
  GOTOOLCHAIN: 'local',
  HTTP_PROXY: 'http://127.0.0.1:9',
  HTTPS_PROXY: 'http://127.0.0.1:9',
  ALL_PROXY: 'http://127.0.0.1:9',
  NO_PROXY: '127.0.0.1,localhost',
} as const

export function assertHermeticNetworkEnvironment(environment: Record<string, string | undefined> = process.env): void {
  for (const [name, expected] of Object.entries(HERMETIC_NETWORK_ENV)) {
    if (environment[name] !== expected) fail('non_hermetic_environment', `${name} must equal the reviewed hermetic network control`)
  }
}

export function captureGovernanceAmendmentEntry(options: {
  ccGatewayRoot: string
  sub2apiRoot: string
  reviewSourcePath: string
  generatedAt?: string
  bindings?: GovernanceAmendmentBindings
  inspectCodeGraph?: (root: string) => CodeGraphBinding
  environment?: Record<string, string | undefined>
}): { entry: GovernanceAmendmentEntry; receipt: GovernanceAmendmentEntryReceipt } {
  const bindings = options.bindings ?? GOVERNANCE_AMENDMENT_BINDINGS
  assertHermeticNetworkEnvironment(options.environment ?? process.env)
  const ccGatewayRoot = realpathSync(options.ccGatewayRoot)
  const sub2apiRoot = realpathSync(options.sub2apiRoot)
  assertImmutableInputs({ ccGatewayRoot, sub2apiRoot, reviewSourcePath: options.reviewSourcePath, bindings })
  const cc = inspectGovernanceRepository({
    root: ccGatewayRoot,
    baseMainHead: bindings.ccGatewayBaseMainHead,
    branch: bindings.ccGatewayBranch,
    remoteName: bindings.remoteName,
    remoteRef: bindings.remoteRef,
    remoteUrlDigest: bindings.ccGatewayRemoteUrlDigest,
  })
  const sub = inspectGovernanceRepository({
    root: sub2apiRoot,
    baseMainHead: bindings.sub2apiBaseMainHead,
    branch: bindings.sub2apiBranch,
    remoteName: bindings.remoteName,
    remoteRef: bindings.remoteRef,
    remoteUrlDigest: bindings.sub2apiRemoteUrlDigest,
  })
  if (sub.head !== bindings.sub2apiBaseMainHead) fail('wrong_repository_head', 'Sub2API must remain at its frozen base for entry capture')
  const reviewedToolHead = cc.head
  const captureInputs = reviewedCaptureInputs(ccGatewayRoot, reviewedToolHead)
  const inspector = options.inspectCodeGraph ?? inspectCodeGraphIndex
  const ccGraph = checkedCodeGraph(inspector(ccGatewayRoot), bindings)
  const subGraph = checkedCodeGraph(inspector(sub2apiRoot), bindings)
  const generated = new Date(options.generatedAt ?? new Date().toISOString())
  if (!Number.isFinite(generated.getTime())) fail('invalid_timestamp', 'generatedAt is invalid')
  const entry: GovernanceAmendmentEntry = {
    schema_version: 1,
    ...ARTIFACT_METADATA,
    entry_kind: 'governance_amendment_entry',
    generated_at: generated.toISOString(),
    base_main_heads: { cc_gateway: bindings.ccGatewayBaseMainHead, sub2api: bindings.sub2apiBaseMainHead },
    reviewed_tool_head: reviewedToolHead,
    repositories: { cc_gateway: cc, sub2api: sub },
    shared_contract: { repository: 'sub2api', path: bindings.sharedContractPath, digest: bindings.sharedContractDigest },
    parent_receipts: {
      phase_zero: { path: bindings.phaseZeroReceiptPath, digest: bindings.phaseZeroReceiptDigest },
      post_integration_v2: { path: bindings.postIntegrationV2ReceiptPath, digest: bindings.postIntegrationV2ReceiptDigest },
    },
    review_amendment: { source_digest: bindings.reviewSourceDigest },
    capture_inputs: captureInputs,
    codegraph: { cc_gateway: ccGraph, sub2api: subGraph },
    runtime: {
      node: versionDigest('node', ['--version']),
      npm: versionDigest('npm', ['--version']),
      git: versionDigest('git', ['--version']),
      go: versionDigest('go', ['version']),
      codegraph: sha256(bindings.codegraphVersion),
      network_policy: sha256(canonicalJson(HERMETIC_NETWORK_ENV)),
    },
    disabled_capabilities: [...bindings.disabledCapabilities],
    p0_1_scope: {
      release: bindings.scope.release,
      work_package: bindings.scope.work_package,
      requirement_ids: [...bindings.scope.requirement_ids],
      in_scope: [...bindings.scope.in_scope],
      out_of_scope: [...bindings.scope.out_of_scope],
    },
    artifacts: { entry_path: bindings.entryPath, receipt_path: bindings.receiptPath },
  }
  requireValid(validateGovernanceAmendmentEntryValue(entry, bindings))
  const receipt: GovernanceAmendmentEntryReceipt = {
    schema_version: 1,
    ...ARTIFACT_METADATA,
    receipt_kind: 'governance_amendment_entry_receipt',
    generated_at: entry.generated_at,
    reviewed_tool_head: reviewedToolHead,
    base_main_heads: { ...entry.base_main_heads },
    entry: { path: bindings.entryPath, digest: sha256(artifactBytes(entry)) },
    receipt_path: bindings.receiptPath,
    entry_schema_digest: captureInputs.entry_schema.digest,
    receipt_schema_digest: captureInputs.receipt_schema.digest,
  }
  validateGovernanceAmendmentEntryPair(entry, receipt, { bindings })
  return { entry, receipt }
}

function writeStagedArtifact(file: string, value: unknown, evidenceRoot: string): void {
  assertSafeArtifact(value)
  assertEvidencePath(file, evidenceRoot)
  const payload = artifactBytes(value)
  let fd: number | undefined
  try {
    fd = openSync(file, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), 0o600)
    writeFileSync(fd, payload)
    closeSync(fd)
    fd = undefined
  } catch (error) {
    if (fd !== undefined) closeSync(fd)
    throw error
  }
}

function assertAbsentDestination(file: string): void {
  try {
    const stat = lstatSync(file)
    if (stat.isSymbolicLink()) fail('artifact_symlink', `${file} is a symlink`)
    fail('artifact_exists', `${file} already exists`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function unlinkIfSameInode(file: string, staged: string): void {
  try {
    const publishedStat = lstatSync(file)
    const stagedStat = lstatSync(staged)
    if (publishedStat.dev === stagedStat.dev && publishedStat.ino === stagedStat.ino) unlinkSync(file)
  } catch { /* rollback is limited to the link created by this invocation */ }
}

export function writeGovernanceAmendmentEntryPair(
  ccGatewayRootInput: string,
  entry: unknown,
  receipt: unknown,
  options: { bindings?: GovernanceAmendmentBindings; publishLink?: (source: string, destination: string) => void } = {},
): void {
  const bindings = options.bindings ?? GOVERNANCE_AMENDMENT_BINDINGS
  validateGovernanceAmendmentEntryPair(entry, receipt, { bindings })
  const root = realpathSync(ccGatewayRootInput)
  const entryFile = confinedFile(root, bindings.entryPath, 'entry path')
  const receiptFile = confinedFile(root, bindings.receiptPath, 'receipt path')
  const evidenceRoot = path.join(root, 'docs/superpowers/evidence')
  assertEvidencePath(entryFile, evidenceRoot)
  assertEvidencePath(receiptFile, evidenceRoot)
  mkdirSync(path.dirname(entryFile), { recursive: true, mode: 0o700 })
  if (path.dirname(entryFile) !== path.dirname(receiptFile)) mkdirSync(path.dirname(receiptFile), { recursive: true, mode: 0o700 })
  assertEvidencePath(entryFile, evidenceRoot)
  assertEvidencePath(receiptFile, evidenceRoot)
  if (path.dirname(entryFile) !== path.dirname(receiptFile)) fail('artifact_pair_directory_mismatch', 'entry pair must share one evidence directory')
  assertAbsentDestination(entryFile)
  assertAbsentDestination(receiptFile)

  const stageDirectory = path.join(evidenceRoot, `.p0-1-entry-stage-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(stageDirectory, { mode: 0o700 })
  const stagedEntry = path.join(stageDirectory, path.basename(entryFile))
  const stagedReceipt = path.join(stageDirectory, path.basename(receiptFile))
  const publishLink = options.publishLink ?? linkSync
  let entryPublished = false
  let receiptPublished = false
  try {
    writeStagedArtifact(stagedEntry, entry, evidenceRoot)
    writeStagedArtifact(stagedReceipt, receipt, evidenceRoot)
    publishLink(stagedEntry, entryFile)
    entryPublished = true
    publishLink(stagedReceipt, receiptFile)
    receiptPublished = true
  } catch (error) {
    if (receiptPublished) unlinkIfSameInode(receiptFile, stagedReceipt)
    if (entryPublished) unlinkIfSameInode(entryFile, stagedEntry)
    throw error
  } finally {
    try { unlinkSync(stagedEntry) } catch { /* best effort cleanup of new staging files */ }
    try { unlinkSync(stagedReceipt) } catch { /* best effort cleanup of new staging files */ }
    try { rmdirSync(stageDirectory) } catch { /* preserve unexpected staging state for inspection */ }
  }
}

export function validateGovernanceAmendmentEntryCommit(options: {
  ccGatewayRoot: string
  entryCommit: string
  toolCommit: string
  entryPath: unknown
  receiptPath: unknown
  entry: unknown
  receipt: unknown
  bindings?: GovernanceAmendmentBindings
}): void {
  const bindings = options.bindings ?? GOVERNANCE_AMENDMENT_BINDINGS
  validateGovernanceAmendmentEntryPair(options.entry, options.receipt, { bindings })
  if (typeof options.entryPath !== 'string' || typeof options.receiptPath !== 'string') fail('invalid_relative_path', 'entry commit paths must be strings')
  assertRelativePath(options.entryPath, 'entry path')
  assertRelativePath(options.receiptPath, 'receipt path')
  if (options.entryPath !== bindings.entryPath || options.receiptPath !== bindings.receiptPath) fail('artifact_path_drift', 'entry commit paths drifted')
  const root = realpathSync(options.ccGatewayRoot)
  const entryBytes = artifactBytes(options.entry)
  const receiptBytes = artifactBytes(options.receipt)
  if (!readFileSync(confinedFile(root, options.entryPath, 'entry path')).equals(entryBytes)
    || !readFileSync(confinedFile(root, options.receiptPath, 'receipt path')).equals(receiptBytes)) {
    fail('entry_commit_bytes_mismatch', 'worktree pair differs from the pre-commit validated bytes')
  }
  const entryCommit = git(root, 'rev-parse', `${options.entryCommit}^{commit}`)
  const toolCommit = git(root, 'rev-parse', `${options.toolCommit}^{commit}`)
  const parents = git(root, 'rev-list', '--parents', '-n', '1', entryCommit).split(/\s+/)
  if (parents.length !== 2 || parents[1] !== toolCommit) fail('entry_commit_parent_mismatch', 'entry commit must have exactly the reviewed tool commit as parent')
  if ((options.entry as GovernanceAmendmentEntry).reviewed_tool_head !== toolCommit) fail('entry_commit_parent_mismatch', 'entry reviewed_tool_head differs from tool commit')
  validateGovernanceAmendmentCaptureInputsAtToolCommit({
    ccGatewayRoot: root,
    toolCommit,
    entry: options.entry as GovernanceAmendmentEntry,
    bindings,
  })
  const delta = execFileSync('git', ['-C', root, 'diff-tree', '--root', '--no-commit-id', '--name-only', '--no-renames', '-r', '-z', entryCommit], { encoding: 'buffer' })
    .toString('utf8').split('\0').filter(Boolean).sort()
  const expectedDelta = [options.entryPath, options.receiptPath].sort()
  if (!same(delta, expectedDelta)) fail('entry_commit_delta_mismatch', 'entry commit delta is not exactly the reviewed pair')
  let committedEntry: Buffer
  let committedReceipt: Buffer
  try {
    committedEntry = execFileSync('git', ['-C', root, 'show', `${entryCommit}:${options.entryPath}`], { encoding: 'buffer' })
    committedReceipt = execFileSync('git', ['-C', root, 'show', `${entryCommit}:${options.receiptPath}`], { encoding: 'buffer' })
  } catch { fail('entry_commit_delta_mismatch', 'entry commit does not contain the reviewed pair') }
  if (!committedEntry.equals(entryBytes) || !committedReceipt.equals(receiptBytes)) fail('entry_commit_bytes_mismatch', 'committed pair differs from the pre-commit validated bytes')
}

function argument(args: ReturnType<typeof parseArgs>, name: string, required = true): string | undefined {
  const values = args.values[name]
  if ((!values || values.length !== 1) && required) fail('invalid_arguments', `--${name} is required exactly once`)
  if (values && values.length > 1) fail('invalid_arguments', `--${name} may appear only once`)
  return values?.[0]
}

function repositoryRootFromCwd(): string {
  try { return realpathSync(git(process.cwd(), 'rev-parse', '--show-toplevel')) }
  catch { fail('invalid_repository_root', 'current directory is not the CC Gateway repository') }
}

export function runGovernanceAmendmentEntryCli(argv: string[]): void {
  assertHermeticNetworkEnvironment(process.env)
  const args = parseArgs(argv)
  if (args.positionals.length !== 1 || !['capture', 'validate'].includes(args.positionals[0])) fail('invalid_arguments', 'exactly one capture or validate command is required')
  const command = args.positionals[0]
  if (command === 'capture') {
    const ccGatewayRoot = argument(args, 'cc-gateway-root') as string
    const sub2apiRoot = argument(args, 'sub2api-root') as string
    const reviewSourcePath = argument(args, 'review-source') as string
    const out = argument(args, 'out') as string
    const receiptPath = argument(args, 'receipt') as string
    if (out !== GOVERNANCE_AMENDMENT_BINDINGS.entryPath || receiptPath !== GOVERNANCE_AMENDMENT_BINDINGS.receiptPath) fail('artifact_path_drift', 'capture outputs must use the reviewed P0.1 pair paths')
    const pair = captureGovernanceAmendmentEntry({ ccGatewayRoot, sub2apiRoot, reviewSourcePath })
    writeGovernanceAmendmentEntryPair(ccGatewayRoot, pair.entry, pair.receipt)
    process.stdout.write(`${canonicalJson({ entry_digest: pair.receipt.entry.digest, receipt_written: true })}\n`)
    return
  }
  const root = repositoryRootFromCwd()
  const manifestRelative = argument(args, 'manifest') as string
  const receiptRelative = argument(args, 'receipt') as string
  if (manifestRelative !== GOVERNANCE_AMENDMENT_BINDINGS.entryPath || receiptRelative !== GOVERNANCE_AMENDMENT_BINDINGS.receiptPath) fail('artifact_path_drift', 'validation paths must use the reviewed P0.1 pair paths')
  const entry = JSON.parse(readFileSync(confinedFile(root, manifestRelative, 'manifest path'), 'utf8')) as unknown
  const receipt = JSON.parse(readFileSync(confinedFile(root, receiptRelative, 'receipt path'), 'utf8')) as unknown
  validateGovernanceAmendmentEntryPair(entry, receipt)
  const entryCommit = argument(args, 'entry-commit', false)
  const toolCommit = argument(args, 'tool-commit', false)
  if ((entryCommit && !toolCommit) || (!entryCommit && toolCommit)) fail('invalid_arguments', '--entry-commit and --tool-commit must be supplied together')
  if (entryCommit && toolCommit) validateGovernanceAmendmentEntryCommit({
    ccGatewayRoot: root,
    entryCommit,
    toolCommit,
    entryPath: manifestRelative,
    receiptPath: receiptRelative,
    entry,
    receipt,
  })
  else validateGovernanceAmendmentCaptureInputsAtToolCommit({
    ccGatewayRoot: root,
    toolCommit: git(root, 'rev-parse', 'HEAD'),
    entry: entry as GovernanceAmendmentEntry,
  })
  process.stdout.write(`${canonicalJson({ valid: true, commit_validated: Boolean(entryCommit) })}\n`)
}

const invokedPath = process.argv[1]
if (invokedPath && existsSync(invokedPath) && realpathSync(invokedPath) === fileURLToPath(import.meta.url)) {
  cli(() => runGovernanceAmendmentEntryCli(process.argv.slice(2)))
}
