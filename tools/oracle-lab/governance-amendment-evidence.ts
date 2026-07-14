import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  constants as fsConstants,
  linkSync,
  lstatSync,
  openSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertSafeArtifact,
  canonicalJson,
  cli,
  DIGEST_RE,
  exactKeys,
  isObject,
  one,
  parseArgs,
  result,
  sha256,
  type HarnessErrorRecord,
  type HarnessResult,
} from './harness-core.js'
import {
  captureBoundedRepositoryState,
  visibleFileDigest,
} from './bounded-repository-state.js'
import {
  MAX_CODEGRAPH_AGGREGATE_BYTES,
  MAX_EVIDENCE_AGGREGATE_BYTES,
  MAX_EVIDENCE_FILE_BYTES,
  createBoundedReadBudget,
  readBoundedRegularFile,
  type BoundedFileRead,
  type BoundedReadBudget,
} from './bounded-file-read.js'
import {
  DEFAULT_IGNORED_INVENTORY_LIMITS,
  IGNORED_INVENTORY_ALGORITHM,
  IGNORED_OUTPUT_POLICY_DIGESTS,
  compareIgnoredPathInventories,
  computeIgnoredPathInventory,
  type IgnoredInventorySummary,
  type IgnoredOutputPolicy,
  type IgnoredPathInventory,
} from './ignored-path-inventory.js'
import {
  inspectCodeGraphIndex,
  validateGovernanceAmendmentEntryPair,
  type GovernanceAmendmentEntry,
  type GovernanceAmendmentEntryReceipt,
} from './governance-amendment-entry.js'
import Ajv2020 from 'ajv/dist/2020.js'
import {
  REVIEWED_CODEGRAPH_EXECUTABLE,
  assertNoGitReplacementRefs,
  assertProductionStartupEnvironment,
  minimalToolEnvironment,
  runReviewedGit,
} from './secure-runtime.js'

type JsonSchemaValidator = ((value: unknown) => boolean) & { errors?: unknown }
const Ajv2020Constructor = Ajv2020 as unknown as new (options: Record<string, unknown>) => { compile(schema: unknown): JsonSchemaValidator }

let activeEvidenceReadBudget: BoundedReadBudget | undefined
let activeCodeGraphReadBudget: BoundedReadBudget | undefined

function evidenceReadBudget(): BoundedReadBudget {
  return activeEvidenceReadBudget ?? createBoundedReadBudget(MAX_EVIDENCE_AGGREGATE_BYTES)
}

function codeGraphReadBudget(): BoundedReadBudget {
  return activeCodeGraphReadBudget ?? createBoundedReadBudget(MAX_CODEGRAPH_AGGREGATE_BYTES)
}

function withProductionReadBudgets<T>(action: () => T): T {
  const previousEvidence = activeEvidenceReadBudget
  const previousCodeGraph = activeCodeGraphReadBudget
  activeEvidenceReadBudget = createBoundedReadBudget(MAX_EVIDENCE_AGGREGATE_BYTES)
  activeCodeGraphReadBudget = createBoundedReadBudget(MAX_CODEGRAPH_AGGREGATE_BYTES)
  try { return action() } finally {
    activeEvidenceReadBudget = previousEvidence
    activeCodeGraphReadBudget = previousCodeGraph
  }
}

function readEvidenceFile(file: string): BoundedFileRead {
  return readBoundedRegularFile(file, { maxBytes: MAX_EVIDENCE_FILE_BYTES, budget: evidenceReadBudget() })
}

export const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
export const HERMETIC_NETWORK_ENV = {
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

export const DISABLED_CAPABILITIES = [
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

export const NEXT_PLANNING_ENTRY_CONDITIONS = [
  'p0_1_successor_receipt_valid',
  'cc_gateway_p0_1_branch_merged_to_main',
  'sub2api_p0_1_branch_merged_to_main',
  'local_main_equals_muqihang_main_in_both_repositories',
  'p0_1_artifact_and_sub2api_fix_ancestry_verified',
  'historical_phase_0_and_post_integration_v2_receipts_valid',
  'joint_local_chain_green_on_integrated_heads',
  'b1_b3_expected_red_revalidated_for_phase_1',
  'protected_gateway_production_and_real_canary_disabled',
  'fresh_unexpired_p1_entry_baseline_and_context',
] as const

export const NEXT_IMPLEMENTATION_ENTRY_CONDITIONS = [
  ...NEXT_PLANNING_ENTRY_CONDITIONS,
  'b4_b6_expected_red_preserved_for_phase_4',
  'p1_detailed_plan_independently_approved',
] as const

export const ARTIFACT_CHAIN = {
  exit: 'docs/superpowers/evidence/p0-1/p0-1-exit-baseline.json',
  green: 'docs/superpowers/evidence/p0-1/p0-1-green-results.json',
  red: 'docs/superpowers/evidence/p0-1/p0-1-red-results.json',
  results: 'docs/superpowers/evidence/p0-1/p0-1-command-results.json',
  report: 'docs/superpowers/evidence/p0-1/p0-1-exit-report.json',
  report_markdown: 'docs/superpowers/evidence/p0-1/p0-1-exit-report.md',
  controller_report: 'docs/superpowers/evidence/p0-1/controller-final-report.json',
  controller_report_markdown: 'docs/superpowers/evidence/p0-1/controller-final-report.md',
  context: 'docs/superpowers/evidence/p0-1/p0-1-context.json',
  handoff: 'docs/superpowers/evidence/p0-1/p0-1-handoff.json',
  receipt: 'docs/superpowers/evidence/p0-1/p0-1-successor-receipt.json',
} as const

export const STAGE_TRANSITIONS = {
  exit: { prior: [], produced: ['exit'] },
  green: { prior: ['exit'], produced: ['green'] },
  red: { prior: ['exit', 'green'], produced: ['red'] },
  results: { prior: ['exit', 'green', 'red'], produced: ['results'] },
  report: { prior: ['exit', 'green', 'red', 'results'], produced: ['report', 'report_markdown'] },
  controller_report: { prior: ['exit', 'green', 'red', 'results', 'report', 'report_markdown'], produced: ['controller_report', 'controller_report_markdown'] },
  context: { prior: ['exit', 'green', 'red', 'results', 'report', 'report_markdown', 'controller_report', 'controller_report_markdown'], produced: ['context'] },
  handoff: { prior: ['exit', 'green', 'red', 'results', 'report', 'report_markdown', 'controller_report', 'controller_report_markdown', 'context'], produced: ['handoff'] },
  receipt: { prior: ['exit', 'green', 'red', 'results', 'report', 'report_markdown', 'controller_report', 'controller_report_markdown', 'context', 'handoff'], produced: ['receipt'] },
} as const

type ArtifactName = keyof typeof ARTIFACT_CHAIN
type ArtifactStage = keyof typeof STAGE_TRANSITIONS

export const SUPPORTED_SUBCOMMANDS = [
  'capture-exit', 'run', 'merge', 'review-import', 'validate-review-import', 'validate-reviews', 'report',
  'controller-report', 'validate-report', 'context', 'handoff', 'receipt', 'validate-receipt',
] as const

const CLI_ARGUMENTS: Record<(typeof SUPPORTED_SUBCOMMANDS)[number], readonly string[]> = {
  'capture-exit': ['entry', 'entry-receipt', 'cc-gateway-root', 'sub2api-root', 'out'],
  run: ['manifest', 'catalog', 'group', 'cc-gateway-root', 'sub2api-root', 'out'],
  merge: ['manifest', 'green', 'red', 'out'],
  'review-import': ['review-source', 'adopted-amendment', 'out'],
  'validate-review-import': ['review-import', 'review-source', 'adopted-amendment'],
  'validate-reviews': ['requirements-review', 'security-review', 'review-import', 'cc-gateway-root', 'sub2api-root'],
  report: ['manifest', 'results', 'requirements-review', 'security-review', 'out', 'markdown'],
  'controller-report': ['manifest', 'results', 'requirements-review', 'security-review', 'report', 'report-markdown', 'out', 'markdown'],
  'validate-report': ['report', 'markdown'],
  context: ['manifest', 'results', 'review-import', 'requirements-review', 'security-review', 'report', 'report-markdown', 'controller-report', 'controller-report-markdown', 'out'],
  handoff: ['manifest', 'results', 'context', 'report', 'report-markdown', 'controller-report', 'controller-report-markdown', 'out'],
  receipt: ['artifact-commit', 'manifest', 'results', 'context', 'handoff', 'report', 'report-markdown', 'controller-report', 'controller-report-markdown', 'out'],
  'validate-receipt': ['receipt', 'artifact-commit', 'receipt-commit'],
}

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EVIDENCE_ROOT_RELATIVE = 'docs/superpowers/evidence'
const P0_1_EVIDENCE_RELATIVE = `${EVIDENCE_ROOT_RELATIVE}/p0-1`
const REVIEW_IMPORT_PATH = `${P0_1_EVIDENCE_RELATIVE}/p0-1-review-import.json`
const REQUIREMENTS_REVIEW_PATH = `${P0_1_EVIDENCE_RELATIVE}/requirements-review.json`
const SECURITY_REVIEW_PATH = `${P0_1_EVIDENCE_RELATIVE}/security-quality-review.json`
const ENTRY_PATH = `${P0_1_EVIDENCE_RELATIVE}/p0-1-entry-baseline.json`
const ENTRY_RECEIPT_PATH = `${P0_1_EVIDENCE_RELATIVE}/p0-1-entry-baseline.receipt.json`
const ENTRY_CAPTURE_COMMIT = 'ce08739e0b8edae3ea7c9859b935ee5d23ede9f2'
const IMMUTABLE_ENTRY_BINDINGS = {
  entry: { path: ENTRY_PATH, digest: 'sha256:e6d7426c63f8bf96a91de5c47d9fc6807fae5da68ad507e8ba65b93f2732f235' },
  receipt: { path: ENTRY_RECEIPT_PATH, digest: 'sha256:f787ea8bfd1e7f640719dbba11f8e4835d468bed1045e82faa50561bdbcf9d06' },
} as const
const SHARED_CONTRACT_PATH = 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json'
const SHARED_CONTRACT_DIGEST = 'sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1'
const BASE_HEADS = { cc_gateway: '9ca9ea72d881fccd2cfb3fd1b939a2f56db69516', sub2api: 'd5a42bbd24d15af2ce7646d050a5ae5c77911d4f' } as const
const PARENT_RECEIPTS = {
  phase_zero: { path: 'docs/superpowers/evidence/phase-0/phase-0-exit-receipt.json', digest: 'sha256:5a2bef840e04d6533bfc657520c73cbc8fcc5f27ede181d168d9b2bf8a3fedee' },
  post_integration_v2: { path: 'docs/superpowers/evidence/post-integration-v2/post-integration-receipt.json', digest: 'sha256:c6b64e233dfa2df8c4cd8937aa2b8552ac54c68d4593a32a837af20d4923fb64' },
} as const
const PLAN_PATH = 'docs/superpowers/plans/2026-07-12-claude-code-2.1.207-p0-1-wp-r0-governance-reconciliation.md'
const GOVERNANCE_PATHS = {
  amendment: 'docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md',
  requirements: 'docs/superpowers/registry/oracle-lab-requirements.json',
  claims: 'docs/superpowers/registry/oracle-lab-claims.json',
  roadmap: 'docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md',
  observations: 'docs/superpowers/registry/oracle-lab-current-observations.json',
  requirement_schema: 'docs/superpowers/schemas/oracle-lab-requirement.schema.json',
  requirement_validator: 'tools/oracle-lab/validate-requirements.ts',
  plan: PLAN_PATH,
  review_import: REVIEW_IMPORT_PATH,
  requirements_review: REQUIREMENTS_REVIEW_PATH,
  security_review: SECURITY_REVIEW_PATH,
} as const
export const TASK_0B_REVIEW_SOURCE_DIGEST = 'sha256:76e662ede1e113018eb5bf8cb835e2e825ae094d426a1c73c4af17f8a643dbf4'
const TASK_0B_REVIEW_SOURCE_LEAF = '2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md'
export const ADOPTED_AMENDMENT_BINDING = {
  path: GOVERNANCE_PATHS.amendment,
  digest: 'sha256:6883d66d74bd1e92f97625348c67559aa56c1f5e7542398635228a88814c57b2',
} as const
export const REVIEW_IMPORT_TRANSFORMATION = {
  algorithm: 'sha256_exact_bytes_v1',
  source_bytes: 41_663,
  adopted_bytes: 47_748,
  pair_digest: 'sha256:c50bd89681f898b0ec9e712f718ff523c6dc8eade99583f56f12bd208d86b7c2',
} as const
const SCHEMA_PATHS = {
  exit_schema: 'docs/superpowers/schemas/oracle-lab-governance-amendment-exit.schema.json',
  catalog_schema: 'docs/superpowers/schemas/oracle-lab-governance-amendment-command-catalog.schema.json',
  results_schema: 'docs/superpowers/schemas/oracle-lab-governance-amendment-command-results.schema.json',
  context_schema: 'docs/superpowers/schemas/oracle-lab-governance-amendment-context.schema.json',
  handoff_schema: 'docs/superpowers/schemas/oracle-lab-governance-amendment-handoff.schema.json',
  receipt_schema: 'docs/superpowers/schemas/oracle-lab-governance-amendment-receipt.schema.json',
  report_schema: 'docs/superpowers/schemas/oracle-lab-governance-amendment-report.schema.json',
  review_import_schema: 'docs/superpowers/schemas/oracle-lab-governance-amendment-review-import.schema.json',
  review_schema: 'docs/superpowers/schemas/oracle-lab-governance-amendment-review.schema.json',
} as const
const COMMAND_CATALOG_PATH = 'docs/superpowers/registry/oracle-lab-governance-amendment-command-catalog.json'
const CAPTURE_INPUT_PATHS = {
  launcher: 'tools/oracle-lab/oracle-p0-1',
  successor_tool: 'tools/oracle-lab/governance-amendment-evidence.ts',
  secure_runtime: 'tools/oracle-lab/secure-runtime.ts',
  bounded_file_read: 'tools/oracle-lab/bounded-file-read.ts',
  bounded_repository_state: 'tools/oracle-lab/bounded-repository-state.ts',
  ignored_path_inventory: 'tools/oracle-lab/ignored-path-inventory.ts',
  command_catalog: COMMAND_CATALOG_PATH,
  ...SCHEMA_PATHS,
} as const

const COMMAND_IDS = {
  green: ['cc-build', 'cc-tests', 'cc-cross-repo-baseline', 'sidecar-tests', 'sub2api-formal-pool', 'sub2api-joint-local-chain', 'p0-1-focused'],
  red: ['cc-boundary-red', 'sidecar-boundary-red', 'sub2api-boundary-red'],
} as const
const CC_EXECUTION_BINDINGS = ['cc_gateway_head', 'cc_gateway_before_snapshot', 'cc_gateway_after_snapshot'] as const
const SUB_EXECUTION_BINDINGS = ['sub2api_head', 'sub2api_before_snapshot', 'sub2api_after_snapshot', 'shared_contract_digest'] as const
const DUAL_EXECUTION_BINDINGS = ['cc_gateway_head', 'sub2api_head', 'cc_gateway_before_snapshot', 'cc_gateway_after_snapshot', 'sub2api_before_snapshot', 'sub2api_after_snapshot', 'shared_contract_digest'] as const
const COMMAND_SPEC = [
  { id: 'cc-build', group: 'green', repository: 'cc-gateway', cwd: '${CC_GATEWAY_ROOT}', argv: ['npm', 'run', 'build'], bindings: CC_EXECUTION_BINDINGS, ignoredPolicy: 'none' },
  { id: 'cc-tests', group: 'green', repository: 'cc-gateway', cwd: '${CC_GATEWAY_ROOT}', argv: ['npm', 'test'], bindings: CC_EXECUTION_BINDINGS, ignoredPolicy: 'none' },
  { id: 'cc-cross-repo-baseline', group: 'green', repository: 'cc-gateway', cwd: '${CC_GATEWAY_ROOT}', argv: ['npm', 'run', 'test:oracle:cross-repo'], extraEnv: { SUB2API_ROOT: '${SUB2API_ROOT}' }, bindings: DUAL_EXECUTION_BINDINGS, ignoredPolicy: 'none' },
  { id: 'sidecar-tests', group: 'green', repository: 'egress-tls-sidecar', cwd: '${CC_GATEWAY_ROOT}/sidecar/egress-tls-sidecar', argv: ['go', 'test', './...', '-count=1'], bindings: CC_EXECUTION_BINDINGS, ignoredPolicy: 'none' },
  { id: 'sub2api-formal-pool', group: 'green', repository: 'sub2api', cwd: '${SUB2API_ROOT}/backend', argv: ['go', 'test', './internal/service', './internal/server/routes', '-run', 'FormalPool|FormalPoolOperations', '-count=1'], bindings: SUB_EXECUTION_BINDINGS, ignoredPolicy: 'none' },
  { id: 'sub2api-joint-local-chain', group: 'green', repository: 'sub2api', cwd: '${SUB2API_ROOT}/backend', argv: ['go', 'test', './internal/service', '-run', '^(TestClaudePlatformAWSLocalFullChainE2EUsesCCGatewayAndSafeMockUpstream|TestJointLocalCaptureAcceptanceArtifact)$', '-count=1', '-v'], extraEnv: { CC_GATEWAY_REPO_ROOT: '${CC_GATEWAY_ROOT}' }, bindings: DUAL_EXECUTION_BINDINGS, ignoredPolicy: 'sub2api_joint_safe_deliverable_v1' },
  { id: 'p0-1-focused', group: 'green', repository: 'cc-gateway', cwd: '${CC_GATEWAY_ROOT}', argv: ['npm', 'run', 'test:oracle:p0-1'], bindings: CC_EXECUTION_BINDINGS, ignoredPolicy: 'none' },
  { id: 'cc-boundary-red', group: 'red', repository: 'cc-gateway', cwd: '${CC_GATEWAY_ROOT}', argv: ['npm', 'exec', 'tsx', 'tests/red/phase0-boundary.red.test.ts'], bindings: CC_EXECUTION_BINDINGS, ignoredPolicy: 'none' },
  { id: 'sidecar-boundary-red', group: 'red', repository: 'egress-tls-sidecar', cwd: '${CC_GATEWAY_ROOT}/sidecar/egress-tls-sidecar', argv: ['go', 'test', '-tags=phase0red', './internal/control', './internal/server', '-count=1'], bindings: CC_EXECUTION_BINDINGS, ignoredPolicy: 'none' },
  { id: 'sub2api-boundary-red', group: 'red', repository: 'sub2api', cwd: '${SUB2API_ROOT}/backend', argv: ['go', 'test', '-tags=phase0red', './internal/service', './internal/server/routes', '-run', 'FormalPoolOnboarding|FormalPoolOperations|Browser|Egress', '-count=1'], bindings: SUB_EXECUTION_BINDINGS, ignoredPolicy: 'none' },
] as const
const EXPECTED_RED_FAILURE_FAMILIES: Record<string, RegExp[]> = {
  'cc-boundary-red': [/B4/i, /B5/i, /B6/i],
  'sidecar-boundary-red': [/B4/i, /B5/i, /B6/i],
  'sub2api-boundary-red': [/FormalPoolOnboarding/i, /Browser/i, /(?:Egress|FormalPoolOperations)/i],
}

const CATALOG_FIELDS = [
  'id', 'schema_version', 'group', 'owner', 'requirement_ids', 'repository', 'cwd', 'argv', 'env', 'inherit_env', 'shell',
  'bindings', 'allowed_worktree_delta', 'ignored_output_policy', 'timeout_ms', 'max_output_bytes', 'expected_exit', 'output_policy', 'rollback',
] as const

const REPORT_FIELDS = ['schema_version', 'report_type', 'generated_at', 'status', 'manifest', 'results', 'reviews', 'command_summary', 'report_digest'] as const
const HANDOFF_FIELDS = ['schema_version', 'handoff_kind', 'generated_at', 'expires_at', 'bindings', 'disabled_capabilities', 'next_planning_entry_conditions', 'next_implementation_entry_conditions', 'handoff_digest'] as const
const REVIEW_FIELDS = ['schema_version', 'review_kind', 'reviewer_identity', 'reviewer_role', 'reviewed_candidate_heads', 'diff_digests', 'plan_digest', 'review_import_digest', 'decision', 'findings', 'verification'] as const
const RESULT_FIELDS = ['schema_version', 'result_kind', 'generated_at', 'expires_at', 'manifest_digest', 'catalog_digest', 'group', 'initial_ignored_inventories', 'terminal_ignored_inventories', 'records', 'result_set_digest'] as const
const RESULT_RECORD_FIELDS = ['command_id', 'repository', 'repository_commit', 'expected_exit', 'exit_code', 'status', 'duration_ms', 'stdout_digest', 'stderr_digest', 'output_bytes', 'timed_out', 'output_overflow', 'failure_names', 'manifest_digest', 'catalog_entry_digest', 'argv_digest', 'environment_digest', 'execution_bindings', 'ignored_output_observations', 'result_digest'] as const
const CONTEXT_FIELDS = ['schema_version', 'context_kind', 'generated_at', 'expires_at', 'bindings', 'review_import', 'reviews', 'disabled_capabilities', 'context_digest'] as const
const RECEIPT_FIELDS = ['schema_version', 'receipt_kind', 'generated_at', 'artifact_commit', 'reviewed_heads', 'shared_contract', 'review_amendment', 'parent_receipts', 'artifact_digests', 'disabled_capabilities', 'next_planning_entry_conditions', 'next_implementation_entry_conditions', 'receipt_digest'] as const

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

function add(errors: HarnessErrorRecord[], code: string, pathName: string, message: string): void {
  errors.push({ code, path: pathName, message })
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

const RFC3339_UTC_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/

function validUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = RFC3339_UTC_RE.exec(value)
  if (!match) return false
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return false
  const [, year, month, day, hour, minute, second, millisecond] = match
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() + 1 === Number(month) && date.getUTCDate() === Number(day)
    && date.getUTCHours() === Number(hour) && date.getUTCMinutes() === Number(minute) && date.getUTCSeconds() === Number(second)
    && date.getUTCMilliseconds() === Number(millisecond)
}

function digestUnsigned(value: Record<string, unknown>, field: string): string {
  return sha256(canonicalJson(Object.fromEntries(Object.entries(value).filter(([key]) => key !== field))))
}

function validArtifact(value: unknown): value is { path: string; digest: string } {
  if (!isObject(value) || !exactKeys(value, ['path', 'digest'], '$artifact', [])) return false
  if (typeof value.path !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(value.path) || value.path.startsWith('/') || value.path.split('/').includes('..')) return false
  return DIGEST_RE.test(String(value.digest))
}

function validateBindingMap(value: unknown, expected: Record<string, string>, where: string, errors: HarnessErrorRecord[]): void {
  if (!exactKeys(value, Object.keys(expected), where, errors)) return
  for (const [name, expectedPath] of Object.entries(expected)) if (!validArtifact(value[name]) || value[name].path !== expectedPath) add(errors, 'invalid_artifact_binding', `${where}.${name}`, `${name} path or digest is invalid`)
}

export function classifyExit(exitCode: number, expectedExit: 0 | 'nonzero'): 'pass' | 'expected_fail' | 'unexpected_fail' | 'unexpected_pass' {
  if (expectedExit === 0) return exitCode === 0 ? 'pass' : 'unexpected_fail'
  return exitCode === 0 ? 'unexpected_pass' : 'expected_fail'
}

export function validateCommandCatalogValue(value: unknown): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  if (!Array.isArray(value)) return result([{ code: 'invalid_catalog', path: '$', message: 'catalog must be an array' }])
  if (value.length !== 10) add(errors, 'invalid_command_inventory', '$', 'exactly seven GREEN and three RED entries are required')
  const ids = new Set<string>()
  for (const [index, candidate] of value.entries()) {
    const where = `$[${index}]`
    if (!exactKeys(candidate, CATALOG_FIELDS, where, errors)) continue
    if (candidate.schema_version !== 1 || !['green', 'red'].includes(String(candidate.group))) add(errors, 'invalid_catalog_entry', where, 'catalog header is invalid')
    const reviewed = COMMAND_SPEC[index]
    if (!reviewed || candidate.id !== reviewed.id || candidate.group !== reviewed.group || candidate.repository !== reviewed.repository || candidate.cwd !== reviewed.cwd || !same(candidate.argv, reviewed.argv)) {
      add(errors, 'catalog_command_drift', where, 'command ID, order, group, repository, cwd, or argv differs from the reviewed inventory')
    }
    if (typeof candidate.id !== 'string' || ids.has(candidate.id)) add(errors, 'duplicate_command_id', `${where}.id`, 'command ID must be unique')
    else ids.add(candidate.id)
    const expectedIds = candidate.group === 'green' ? COMMAND_IDS.green : COMMAND_IDS.red
    if (!expectedIds.includes(candidate.id as never)) add(errors, 'invalid_command_inventory', `${where}.id`, 'command ID is not in the fixed inventory')
    if (!isObject(candidate.env)) add(errors, 'invalid_environment', `${where}.env`, 'environment must be an object')
    else {
      for (const [key, expected] of Object.entries(HERMETIC_NETWORK_ENV)) {
        if (candidate.env[key] !== expected) add(errors, 'non_hermetic_environment', `${where}.env.${key}`, `${key} must equal the reviewed value`)
      }
      if (candidate.env.CI !== '1') add(errors, 'non_hermetic_environment', `${where}.env.CI`, 'CI must equal 1')
      const allowed = new Set(['CI', ...Object.keys(HERMETIC_NETWORK_ENV), ...(candidate.id === 'cc-cross-repo-baseline' ? ['SUB2API_ROOT'] : []), ...(candidate.id === 'sub2api-joint-local-chain' ? ['CC_GATEWAY_REPO_ROOT'] : [])])
      for (const key of Object.keys(candidate.env)) if (!allowed.has(key)) add(errors, 'non_hermetic_environment', `${where}.env.${key}`, 'undeclared environment override')
      if (reviewed && !same(Object.fromEntries(Object.entries(candidate.env).filter(([key]) => ![...Object.keys(HERMETIC_NETWORK_ENV), 'CI'].includes(key))), 'extraEnv' in reviewed ? reviewed.extraEnv : {})) add(errors, 'non_hermetic_environment', `${where}.env`, 'command-specific environment differs from the reviewed inventory')
    }
    if (!same(candidate.inherit_env, ['PATH', 'HOME', 'TMPDIR'])) add(errors, 'invalid_inherited_environment', `${where}.inherit_env`, 'only PATH, HOME, TMPDIR may be inherited')
    if (!reviewed || !same(candidate.bindings, reviewed.bindings)) add(errors, 'incomplete_execution_binding', `${where}.bindings`, 'execution bindings differ from the reviewed inventory')
    if (!same(candidate.allowed_worktree_delta, [])) add(errors, 'invalid_allowed_delta', `${where}.allowed_worktree_delta`, 'catalog entries cannot add worktree deltas')
    if (!reviewed || candidate.ignored_output_policy !== reviewed.ignoredPolicy) add(errors, 'invalid_ignored_output_policy', `${where}.ignored_output_policy`, 'ignored-output policy differs from the reviewed inventory')
    if (candidate.shell !== false) add(errors, 'unsafe_shell', `${where}.shell`, 'commands require shell false')
    if (candidate.max_output_bytes !== MAX_OUTPUT_BYTES) add(errors, 'invalid_output_bound', `${where}.max_output_bytes`, 'output bound must be 8 MiB')
    if (candidate.expected_exit !== (candidate.group === 'green' ? 0 : 'nonzero')) add(errors, 'invalid_expected_exit', `${where}.expected_exit`, 'classification expectation differs from group')
    if (!Array.isArray(candidate.allowed_worktree_delta)) add(errors, 'invalid_allowed_delta', `${where}.allowed_worktree_delta`, 'allowed delta must be an array')
  }
  for (const id of [...COMMAND_IDS.green, ...COMMAND_IDS.red]) if (!ids.has(id)) add(errors, 'invalid_command_inventory', '$', `${id} is missing`)
  const joint = value.find((entry) => isObject(entry) && entry.id === 'sub2api-joint-local-chain') as Record<string, unknown> | undefined
  if (!joint || !isObject(joint.env) || joint.env.CC_GATEWAY_REPO_ROOT !== '${CC_GATEWAY_ROOT}') add(errors, 'missing_joint_root_binding', '$', 'joint command must bind CC_GATEWAY_REPO_ROOT')
  const jointBindings = ['cc_gateway_head', 'sub2api_head', 'cc_gateway_before_snapshot', 'cc_gateway_after_snapshot', 'sub2api_before_snapshot', 'sub2api_after_snapshot', 'shared_contract_digest']
  if (!joint || !same(joint.bindings, jointBindings)) add(errors, 'incomplete_joint_binding', '$', 'joint command must bind both repositories and the contract')
  return result(errors)
}

const EXECUTION_BINDING_NAMES = ['cc_gateway_head', 'sub2api_head', 'cc_gateway_before_snapshot', 'cc_gateway_after_snapshot', 'sub2api_before_snapshot', 'sub2api_after_snapshot', 'shared_contract_digest'] as const

export function buildExecutionBindings(declared: unknown, values: Record<string, unknown>): Record<string, string> {
  if (!Array.isArray(declared) || declared.length === 0 || new Set(declared).size !== declared.length || declared.some((name) => !EXECUTION_BINDING_NAMES.includes(name as never))) fail('invalid_execution_binding', 'declared execution bindings are invalid')
  const output: Record<string, string> = {}
  for (const name of declared as string[]) {
    const value = values[name]
    const valid = name.endsWith('_head') ? /^[0-9a-f]{40,64}$/.test(String(value)) : DIGEST_RE.test(String(value))
    if (!valid) fail('incomplete_execution_binding', `${name} is missing or invalid`)
    output[name] = String(value)
  }
  return output
}

export type ReviewImport = {
  schema_version: 1
  import_kind: 'governance_amendment_review_import'
  generated_at: string
  source: { path: string; digest: string }
  adopted: { path: string; digest: string }
  transformation: { algorithm: 'sha256_exact_bytes_v1'; source_bytes: number; adopted_bytes: number; pair_digest: string }
}

function safeLeaf(file: string): string {
  const leaf = path.basename(file)
  if (!/^[A-Za-z0-9._-]+$/.test(leaf)) fail('invalid_relative_path', 'review import file name is unsafe')
  return leaf
}

export function buildReviewImport(options: { reviewSource: string; adoptedAmendment: string; generatedAt?: string; repositoryRoot?: string }): ReviewImport {
  const repositoryRoot = realpathSync(options.repositoryRoot ?? REPOSITORY_ROOT)
  const source = readEvidenceFile(options.reviewSource)
  if (source.digest !== TASK_0B_REVIEW_SOURCE_DIGEST) fail('review_source_digest_mismatch', 'review source differs from the immutable Task 0B digest')
  const adoptedRelative = relativeArtifact(repositoryRoot, options.adoptedAmendment)
  if (adoptedRelative !== ADOPTED_AMENDMENT_BINDING.path) fail('adopted_amendment_path_mismatch', 'adopted amendment path is not fixed')
  const adopted = readArtifactAt(repositoryRoot, adoptedRelative)
  if (!same(adopted.binding, ADOPTED_AMENDMENT_BINDING)) fail('adopted_amendment_digest_mismatch', 'adopted amendment bytes differ from the fixed reviewed digest')
  if (source.size === 0 || adopted.read.size === 0) fail('invalid_review_import_bytes', 'review inputs must be nonempty and at most 8 MiB')
  const transformation = {
    algorithm: 'sha256_exact_bytes_v1' as const,
    source_bytes: source.size,
    adopted_bytes: adopted.read.size,
    pair_digest: sha256(Buffer.concat([Buffer.from(source.size.toString(10)), Buffer.from([0]), source.bytes, Buffer.from(adopted.read.size.toString(10)), Buffer.from([0]), adopted.read.bytes])),
  }
  if (!same(transformation, REVIEW_IMPORT_TRANSFORMATION)) fail('review_import_bytes_mismatch', 'review import bytes differ from the fixed source/adopted transformation')
  const value: ReviewImport = {
    schema_version: 1,
    import_kind: 'governance_amendment_review_import',
    generated_at: new Date(options.generatedAt ?? new Date().toISOString()).toISOString(),
    source: { path: safeLeaf(options.reviewSource), digest: TASK_0B_REVIEW_SOURCE_DIGEST },
    adopted: { ...ADOPTED_AMENDMENT_BINDING },
    transformation: { ...REVIEW_IMPORT_TRANSFORMATION },
  }
  assertSafeArtifact(value)
  return value
}

export function validateReviewImportValue(value: unknown): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  try { assertSafeArtifact(value) } catch (error) { add(errors, (error as Error & { code?: string }).code ?? 'unsafe_artifact', '$', (error as Error).message) }
  if (!exactKeys(value, ['schema_version', 'import_kind', 'generated_at', 'source', 'adopted', 'transformation'], '$', errors)) return result(errors)
  if (value.schema_version !== 1 || value.import_kind !== 'governance_amendment_review_import' || !validUtcTimestamp(value.generated_at)) add(errors, 'invalid_review_import', '$', 'review import header is invalid')
  if (!validArtifact(value.source) || !validArtifact(value.adopted)) add(errors, 'invalid_review_import', '$', 'source and adopted bindings are invalid')
  if (!exactKeys(value.transformation, ['algorithm', 'source_bytes', 'adopted_bytes', 'pair_digest'], '$.transformation', errors)) return result(errors)
  if (!same(value.transformation, REVIEW_IMPORT_TRANSFORMATION)) add(errors, 'invalid_review_import', '$.transformation', 'transformation does not match the fixed source/adopted byte pair')
  if (!same(value.source, { path: TASK_0B_REVIEW_SOURCE_LEAF, digest: TASK_0B_REVIEW_SOURCE_DIGEST }) || !same(value.adopted, ADOPTED_AMENDMENT_BINDING)) add(errors, 'review_import_binding_mismatch', '$', 'review import does not bind the fixed Task 0B source and adopted amendment')
  return result(errors)
}

export function validateReviewImportBytes(value: unknown, reviewSource: string, adoptedAmendment: string, repositoryRoot = REPOSITORY_ROOT): HarnessResult {
  const structural = validateReviewImportValue(value)
  if (!structural.ok) return structural
  const expected = buildReviewImport({ reviewSource, adoptedAmendment, generatedAt: String((value as ReviewImport).generated_at), repositoryRoot })
  return same(value, expected) ? result([]) : result([{ code: 'review_import_bytes_mismatch', path: '$', message: 'review import is not derived from the named exact bytes' }])
}

export type ArtifactBinding = { path: string; digest: string }
export type RepositorySnapshot = {
  head: string
  branch: string
  allowed_artifacts: ArtifactBinding[]
  dirty_state_digest: string
  dirty_records_digest: string
  ignored_exclusion_rules_digest: string
  ignored_inventory: IgnoredInventorySummary
  ignored_output_policy_digest: string
  snapshot_digest: string
}

export type RepositorySnapshotTransition = {
  before_snapshot_digest: string
  after_snapshot_digest: string
  ignored_output_observation?: Omit<IgnoredOutputObservation, 'repository'>
}

const SNAPSHOT_IGNORED_INVENTORY = Symbol('repositorySnapshotIgnoredInventory')
type InternalRepositorySnapshot = RepositorySnapshot & { [SNAPSHOT_IGNORED_INVENTORY]: IgnoredPathInventory }

function normalizedRepositoryPath(value: string): boolean {
  return value.length > 0 && !path.isAbsolute(value) && !value.includes('\\') && path.posix.normalize(value) === value && !value.split('/').includes('..')
}

function inspectAllowedArtifact(state: ReturnType<typeof captureBoundedRepositoryState>, binding: ArtifactBinding): void {
  if (!normalizedRepositoryPath(binding.path) || !DIGEST_RE.test(binding.digest)) fail('invalid_allowed_artifact', 'allowed artifact binding is invalid')
  const digest = visibleFileDigest(state, binding.path)
  if (!digest) fail('missing_prior_output', `${binding.path} is missing`)
  if (`sha256:${digest}` !== binding.digest) fail('prior_output_mutated', `${binding.path} bytes differ from the binding`)
}

function snapshotUnsigned(snapshot: Omit<RepositorySnapshot, 'snapshot_digest'>, ignoredInventory = snapshot.ignored_inventory): Omit<RepositorySnapshot, 'snapshot_digest'> {
  return {
    head: snapshot.head,
    branch: snapshot.branch,
    allowed_artifacts: snapshot.allowed_artifacts,
    dirty_state_digest: snapshot.dirty_state_digest,
    dirty_records_digest: snapshot.dirty_records_digest,
    ignored_exclusion_rules_digest: snapshot.ignored_exclusion_rules_digest,
    ignored_inventory: ignoredInventory,
    ignored_output_policy_digest: snapshot.ignored_output_policy_digest,
  }
}

function snapshotWithInventory(unsigned: Omit<RepositorySnapshot, 'snapshot_digest'>, inventory: IgnoredPathInventory): RepositorySnapshot {
  const value = { ...unsigned, snapshot_digest: sha256(canonicalJson(unsigned)) } as InternalRepositorySnapshot
  Object.defineProperty(value, SNAPSHOT_IGNORED_INVENTORY, { value: inventory, enumerable: false })
  return value
}

function internalSnapshot(snapshot: RepositorySnapshot): InternalRepositorySnapshot {
  if (!(SNAPSHOT_IGNORED_INVENTORY in snapshot)) fail('repository_mutation', 'repository state changed across the child command')
  return snapshot as InternalRepositorySnapshot
}

export function captureRepositorySnapshot(
  rootInput: string,
  allowedArtifacts: ArtifactBinding[] = [],
  ignoredOutputPolicy: IgnoredOutputPolicy = 'none',
): RepositorySnapshot {
  const root = realpathSync(rootInput)
  const sortedArtifacts = [...allowedArtifacts].sort((left, right) => left.path.localeCompare(right.path))
  if (new Set(sortedArtifacts.map((binding) => binding.path)).size !== sortedArtifacts.length) fail('duplicate_allowed_artifact', 'allowed artifact paths must be unique')
  let state: ReturnType<typeof captureBoundedRepositoryState>
  try { state = captureBoundedRepositoryState(root, undefined, sortedArtifacts.map((binding) => binding.path)) }
  catch (error) {
    if ((error as Error & { code?: string }).code === 'visible_state_missing_entry') fail('missing_prior_output', 'an allowed artifact is missing')
    if ((error as Error & { code?: string }).code === 'visible_state_unsupported_entry') {
      for (const binding of sortedArtifacts) {
        try { if (lstatSync(path.join(root, binding.path)).isSymbolicLink()) fail('artifact_symlink', `${binding.path} is a symlink`) } catch (inspectionError) {
          if ((inspectionError as Error & { code?: string }).code === 'artifact_symlink') throw inspectionError
        }
      }
    }
    throw error
  }
  for (const binding of sortedArtifacts) inspectAllowedArtifact(state, binding)
  const allowedPaths = new Set(sortedArtifacts.map((binding) => binding.path))
  for (const record of state.dirty_records) {
    const destination = Buffer.from(record.destination_path_base64url, 'base64url').toString('utf8')
    const source = record.source_path_base64url ? Buffer.from(record.source_path_base64url, 'base64url').toString('utf8') : undefined
    if (!allowedPaths.has(destination)) fail('undeclared_dirty_path', `${destination} is not an exact allowed artifact path`)
    if (source && source !== destination && !allowedPaths.has(source)) fail('undeclared_dirty_path', `${source} is an undeclared rename or copy source`)
  }
  const ignoredInventory = computeIgnoredPathInventory(root)
  const unsigned = {
    head: state.head,
    branch: state.branch,
    allowed_artifacts: sortedArtifacts,
    dirty_state_digest: `sha256:${state.dirty_digest}`,
    dirty_records_digest: sha256(canonicalJson(state.dirty_records)),
    ignored_exclusion_rules_digest: sha256(canonicalJson(state.ignored_exclusion_rules)),
    ignored_inventory: ignoredInventory.summary,
    ignored_output_policy_digest: IGNORED_OUTPUT_POLICY_DIGESTS[ignoredOutputPolicy],
  }
  return snapshotWithInventory(unsigned, ignoredInventory)
}

export function rebindRepositorySnapshotPolicy(snapshotInput: RepositorySnapshot, policy: IgnoredOutputPolicy): RepositorySnapshot {
  const snapshot = internalSnapshot(snapshotInput)
  const unsigned = {
    ...snapshotUnsigned(snapshot),
    ignored_output_policy_digest: IGNORED_OUTPUT_POLICY_DIGESTS[policy],
  }
  return snapshotWithInventory(unsigned, snapshot[SNAPSHOT_IGNORED_INVENTORY])
}

export function compareRepositorySnapshots(
  beforeInput: RepositorySnapshot,
  afterInput: RepositorySnapshot,
  policy: IgnoredOutputPolicy,
  commandStartedAt: Date,
  commandFinishedAt: Date,
): RepositorySnapshotTransition {
  try {
    const before = internalSnapshot(beforeInput)
    const after = internalSnapshot(afterInput)
    const policyDigest = IGNORED_OUTPUT_POLICY_DIGESTS[policy]
    if (before.ignored_output_policy_digest !== policyDigest || after.ignored_output_policy_digest !== policyDigest) fail('repository_mutation', 'repository state changed across the child command')
    const ignored = compareIgnoredPathInventories(
      before[SNAPSHOT_IGNORED_INVENTORY],
      after[SNAPSHOT_IGNORED_INVENTORY],
      policy,
      commandStartedAt,
      commandFinishedAt,
    )
    const beforeSnapshot = snapshotWithInventory(snapshotUnsigned(before, ignored.before_protected), before[SNAPSHOT_IGNORED_INVENTORY])
    const afterSnapshot = snapshotWithInventory(snapshotUnsigned(after, ignored.after_protected), after[SNAPSHOT_IGNORED_INVENTORY])
    if (beforeSnapshot.snapshot_digest !== afterSnapshot.snapshot_digest) fail('repository_mutation', 'repository state changed across the child command')
    return {
      before_snapshot_digest: beforeSnapshot.snapshot_digest,
      after_snapshot_digest: afterSnapshot.snapshot_digest,
      ...(ignored.observation ? { ignored_output_observation: ignored.observation } : {}),
    }
  } catch {
    fail('repository_mutation', 'repository state changed across the child command')
  }
}

export function assertRepositorySnapshot(root: string, expected: RepositorySnapshot, allowedArtifacts: ArtifactBinding[] = []): RepositorySnapshot {
  let actual: RepositorySnapshot
  try { actual = captureRepositorySnapshot(root, allowedArtifacts) } catch { fail('repository_mutation', 'repository state changed across the child command') }
  compareRepositorySnapshots(expected, actual, 'none', new Date(0), new Date(0))
  return actual
}

type ChainState = {
  schema_version: 1
  state_kind: 'governance_amendment_chain_state'
  repositories: {
    cc_gateway: { root: string; accepted_head: string; terminal_ignored_inventory: IgnoredInventorySummary }
    sub2api: { root: string; accepted_head: string; terminal_ignored_inventory: IgnoredInventorySummary }
  }
  artifacts: ArtifactBinding[]
  state_digest: string
}

export type RepositoryIgnoredInventories = {
  cc_gateway: IgnoredInventorySummary
  sub2api: IgnoredInventorySummary
}

const FULL_IGNORED_SUMMARY_FIELDS = ['algorithm', 'endpoint_count', 'entry_count', 'regular_file_count', 'directory_count', 'symlink_count', 'regular_file_bytes', 'digest'] as const

function validFullIgnoredSummary(value: unknown): value is IgnoredInventorySummary {
  if (!isObject(value) || !same(Object.keys(value).sort(), [...FULL_IGNORED_SUMMARY_FIELDS].sort())
    || value.algorithm !== IGNORED_INVENTORY_ALGORITHM || !DIGEST_RE.test(String(value.digest))) return false
  for (const field of ['endpoint_count', 'entry_count', 'regular_file_count', 'directory_count', 'symlink_count', 'regular_file_bytes'] as const) {
    if (!Number.isSafeInteger(value[field]) || Number(value[field]) < 0) return false
  }
  return Number(value.endpoint_count) <= DEFAULT_IGNORED_INVENTORY_LIMITS.maxEndpointRoots
    && Number(value.entry_count) <= DEFAULT_IGNORED_INVENTORY_LIMITS.maxEntries
    && Number(value.regular_file_count) + Number(value.directory_count) + Number(value.symlink_count) === Number(value.entry_count)
    && Number(value.regular_file_bytes) <= DEFAULT_IGNORED_INVENTORY_LIMITS.maxRegularFileBytes
}

function validateRepositoryIgnoredInventories(value: unknown, where: string, errors: HarnessErrorRecord[]): value is RepositoryIgnoredInventories {
  if (!exactKeys(value, ['cc_gateway', 'sub2api'], where, errors)) return false
  let valid = true
  for (const name of ['cc_gateway', 'sub2api'] as const) {
    if (!validFullIgnoredSummary(value[name])) {
      add(errors, 'invalid_ignored_inventory', `${where}.${name}`, 'repository ignored inventory summary is invalid')
      valid = false
    }
  }
  return valid
}

function ignoredInventoriesFromSnapshots(cc: RepositorySnapshot, sub: RepositorySnapshot): RepositoryIgnoredInventories {
  return { cc_gateway: cc.ignored_inventory, sub2api: sub.ignored_inventory }
}

function chainIgnoredInventories(state: ChainState): RepositoryIgnoredInventories {
  return {
    cc_gateway: state.repositories.cc_gateway.terminal_ignored_inventory,
    sub2api: state.repositories.sub2api.terminal_ignored_inventory,
  }
}

function manifestInitialIgnoredInventories(manifest: ExitValue): RepositoryIgnoredInventories {
  return {
    cc_gateway: manifest.repositories.cc_gateway.initial_ignored_inventory,
    sub2api: manifest.repositories.sub2api.initial_ignored_inventory,
  }
}

function chainStatePath(root: string): string {
  return gitText(root, 'rev-parse', '--path-format=absolute', '--git-path', 'oracle-p0-1-chain-state.json')
}

function assertChainStateAbsent(root: string): void {
  try {
    lstatSync(chainStatePath(root))
    fail('chain_state_exists', 'P0.1 chain state already exists')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function buildChainState(
  heads: { cc_gateway: string; sub2api: string },
  artifacts: ArtifactBinding[],
  roots: { cc_gateway: string; sub2api: string },
  terminalIgnored: RepositoryIgnoredInventories,
): ChainState {
  const unsigned = {
    schema_version: 1 as const,
    state_kind: 'governance_amendment_chain_state' as const,
    repositories: {
      cc_gateway: { root: roots.cc_gateway, accepted_head: heads.cc_gateway, terminal_ignored_inventory: terminalIgnored.cc_gateway },
      sub2api: { root: roots.sub2api, accepted_head: heads.sub2api, terminal_ignored_inventory: terminalIgnored.sub2api },
    },
    artifacts: [...artifacts].sort((left, right) => left.path.localeCompare(right.path)),
  }
  return { ...unsigned, state_digest: sha256(canonicalJson(unsigned)) }
}

function validateChainState(value: unknown): ChainState {
  const errors: HarnessErrorRecord[] = []
  if (!exactKeys(value, ['schema_version', 'state_kind', 'repositories', 'artifacts', 'state_digest'], '$', errors)
    || value.schema_version !== 1 || value.state_kind !== 'governance_amendment_chain_state'
    || !Array.isArray(value.artifacts) || value.artifacts.some((binding) => !validArtifact(binding)) || !DIGEST_RE.test(String(value.state_digest))
    || value.state_digest !== digestUnsigned(value, 'state_digest')) fail('invalid_chain_state', 'P0.1 chain state is invalid')
  if (!isObject(value.repositories) || !exactKeys(value.repositories, ['cc_gateway', 'sub2api'], '$.repositories', errors)) fail('invalid_chain_state', 'P0.1 chain repositories are invalid')
  for (const name of ['cc_gateway', 'sub2api'] as const) {
    const repository = value.repositories[name]
    if (!exactKeys(repository, ['root', 'accepted_head', 'terminal_ignored_inventory'], `$.repositories.${name}`, errors)
      || typeof repository.root !== 'string' || !path.isAbsolute(repository.root)
      || !/^[0-9a-f]{40,64}$/.test(String(repository.accepted_head))
      || !validFullIgnoredSummary(repository.terminal_ignored_inventory)) fail('invalid_chain_state', 'P0.1 chain repository state is invalid')
  }
  return value as unknown as ChainState
}

function writeChainState(root: string, value: ChainState, exclusive: boolean): void {
  const file = chainStatePath(root); const temp = `${file}.tmp-${process.pid}-${Date.now()}`
  if (exclusive) try { lstatSync(file); fail('chain_state_exists', 'P0.1 chain state already exists') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  else try { if (lstatSync(file).isSymbolicLink()) fail('artifact_symlink', 'chain state is a symlink') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  let fd: number | undefined
  try {
    fd = openSync(temp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), 0o600)
    writeFileSync(fd, `${canonicalJson(value)}\n`); closeSync(fd); fd = undefined; renameSync(temp, file)
  } catch (error) {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(temp) } catch { /* best effort cleanup of invocation-owned temp */ }
    throw error
  }
}

export function initializeChainState(
  rootInput: string,
  artifacts: ArtifactBinding[],
  sub2apiRootInput = rootInput,
  expectedIgnored?: RepositoryIgnoredInventories,
): void {
  const root = realpathSync(rootInput)
  const subRoot = realpathSync(sub2apiRootInput)
  for (const binding of artifacts) if (!same(bindingAt(root, binding.path), binding)) fail('prior_output_mutated', `${binding.path} bytes differ before chain initialization`)
  const actualIgnored = {
    cc_gateway: computeIgnoredPathInventory(root).summary,
    sub2api: subRoot === root ? computeIgnoredPathInventory(root).summary : computeIgnoredPathInventory(subRoot).summary,
  }
  if (expectedIgnored && !same(actualIgnored, expectedIgnored)) fail('repository_mutation', 'initial ignored repository state differs from exit evidence')
  writeChainState(root, buildChainState({
    cc_gateway: gitText(root, 'rev-parse', 'HEAD'),
    sub2api: gitText(subRoot, 'rev-parse', 'HEAD'),
  }, artifacts, { cc_gateway: root, sub2api: subRoot }, actualIgnored), true)
}

function verifiedChainState(root: string): ChainState {
  let parsed: unknown
  const statePath = chainStatePath(root)
  try {
    parsed = JSON.parse(readEvidenceFile(statePath).bytes.toString('utf8')) as unknown
  } catch (error) {
    const code = (error as Error & { code?: string }).code
    if (code?.startsWith('bounded_file_') && code !== 'bounded_file_missing') throw error
    fail('missing_chain_state', 'P0.1 chain state is missing')
  }
  const state = validateChainState(parsed)
  if (state.repositories.cc_gateway.root !== root) fail('chain_repository_drift', 'chain CC Gateway root differs from the active repository')
  for (const name of ['cc_gateway', 'sub2api'] as const) {
    try {
      if (realpathSync(state.repositories[name].root) !== state.repositories[name].root) fail('chain_repository_drift', `chain ${name} root identity changed`)
    } catch { fail('chain_repository_drift', `chain ${name} root is unavailable`) }
  }
  for (const binding of state.artifacts) if (!same(bindingAt(root, binding.path), binding)) fail('prior_output_mutated', `${binding.path} bytes changed after the producing stage`)
  return state
}

function assertAcceptedRepositoryHeads(state: ChainState): void {
  for (const name of ['cc_gateway', 'sub2api'] as const) {
    if (gitText(state.repositories[name].root, 'rev-parse', 'HEAD') !== state.repositories[name].accepted_head) {
      fail('wrong_repository_head', `${name} HEAD differs from the accepted chain head`)
    }
  }
}

function assertChainArtifacts(state: ChainState, expectedArtifacts: ArtifactBinding[]): void {
  const expected = [...expectedArtifacts].sort((left, right) => left.path.localeCompare(right.path))
  if (!same(state.artifacts, expected)) fail('prior_output_mutated', 'prior artifact inventory or digest differs from immutable chain state')
}

export function assertChainState(rootInput: string, expectedArtifacts: ArtifactBinding[]): ChainState {
  const root = realpathSync(rootInput)
  const state = verifiedChainState(root)
  assertAcceptedRepositoryHeads(state)
  assertChainArtifacts(state, expectedArtifacts)
  return state
}

function stageBindings(root: string, names: readonly ArtifactName[]): ArtifactBinding[] {
  return names.map((name) => bindingAt(root, ARTIFACT_CHAIN[name]))
}

export function initializeArtifactChain(rootInput: string, sub2apiRootInput = rootInput, expectedIgnored?: RepositoryIgnoredInventories): void {
  const root = realpathSync(rootInput)
  const subRoot = realpathSync(sub2apiRootInput)
  const produced = stageBindings(root, STAGE_TRANSITIONS.exit.produced)
  const cc = captureRepositorySnapshot(root, produced)
  const sub = subRoot === root ? cc : captureRepositorySnapshot(subRoot)
  const actualIgnored = ignoredInventoriesFromSnapshots(cc, sub)
  if (expectedIgnored && !same(actualIgnored, expectedIgnored)) fail('repository_mutation', 'initial ignored repository state differs from exit evidence')
  initializeChainState(root, produced, subRoot, actualIgnored)
}

function prepareArtifactChainStagePrior(
  rootInput: string,
  stage: Exclude<ArtifactStage, 'exit'>,
  expectedRoots?: { cc_gateway: string; sub2api: string },
): { root: string; prior: ArtifactBinding[]; state: ChainState; cc: RepositorySnapshot; sub: RepositorySnapshot } {
  const root = realpathSync(rootInput)
  const prior = stageBindings(root, STAGE_TRANSITIONS[stage].prior)
  const state = assertChainState(root, prior)
  if (expectedRoots && (realpathSync(expectedRoots.cc_gateway) !== state.repositories.cc_gateway.root
    || realpathSync(expectedRoots.sub2api) !== state.repositories.sub2api.root)) fail('chain_repository_drift', 'stage repository roots differ from chain initialization')
  const cc = captureRepositorySnapshot(root, prior)
  const subRoot = state.repositories.sub2api.root
  const sub = subRoot === root ? cc : captureRepositorySnapshot(subRoot)
  if (!same(ignoredInventoriesFromSnapshots(cc, sub), chainIgnoredInventories(state))) fail('repository_mutation', 'ignored repository state differs from the preceding accepted stage')
  return { root, prior, state, cc, sub }
}

export function prepareArtifactChainStage(rootInput: string, stage: Exclude<ArtifactStage, 'exit'>): ArtifactBinding[] {
  const { prior } = prepareArtifactChainStagePrior(rootInput, stage)
  return prior
}

export function completeArtifactChainStage(
  rootInput: string,
  stage: Exclude<ArtifactStage, 'exit'>,
  terminalIgnored?: RepositoryIgnoredInventories,
): void {
  const root = realpathSync(rootInput)
  const transition = STAGE_TRANSITIONS[stage]
  const prior = stageBindings(root, transition.prior)
  const produced = stageBindings(root, transition.produced)
  const state = assertChainState(root, prior)
  const cc = captureRepositorySnapshot(root, [...prior, ...produced])
  const sub = state.repositories.sub2api.root === root ? cc : captureRepositorySnapshot(state.repositories.sub2api.root)
  const actualIgnored = ignoredInventoriesFromSnapshots(cc, sub)
  const expectedTerminal = terminalIgnored ?? chainIgnoredInventories(state)
  if (!same(actualIgnored, expectedTerminal)) fail('repository_mutation', 'stage terminal ignored repository state differs from accepted evidence')
  advanceChainState(root, prior, produced, expectedTerminal)
}

function advanceChainState(root: string, expectedArtifacts: ArtifactBinding[], newArtifacts: ArtifactBinding[], terminalIgnored: RepositoryIgnoredInventories): void {
  const state = assertChainState(root, expectedArtifacts)
  const paths = new Set(state.artifacts.map((binding) => binding.path))
  for (const binding of newArtifacts) {
    if (paths.has(binding.path) || !same(bindingAt(root, binding.path), binding)) fail('invalid_chain_advance', `${binding.path} cannot advance the chain`)
    paths.add(binding.path)
  }
  writeChainState(root, buildChainState(
    {
      cc_gateway: state.repositories.cc_gateway.accepted_head,
      sub2api: state.repositories.sub2api.accepted_head,
    },
    [...state.artifacts, ...newArtifacts],
    { cc_gateway: state.repositories.cc_gateway.root, sub2api: state.repositories.sub2api.root },
    terminalIgnored,
  ), false)
}

function assertCurrentChainContinuity(rootInput: string): ChainState {
  const root = realpathSync(rootInput)
  const state = verifiedChainState(root)
  assertAcceptedRepositoryHeads(state)
  const cc = captureRepositorySnapshot(root, state.artifacts)
  const sub = state.repositories.sub2api.root === root ? cc : captureRepositorySnapshot(state.repositories.sub2api.root)
  if (!same(ignoredInventoriesFromSnapshots(cc, sub), chainIgnoredInventories(state))) fail('repository_mutation', 'ignored repository state differs from the accepted chain terminal')
  return state
}

type ReviewExpected = {
  heads: { cc_gateway: string; sub2api: string }
  diffs: { cc_gateway: string; sub2api: string }
  planDigest: string
  reviewImportDigest: string
  candidateCommitIdentities: CandidateCommitIdentities
}

export type CommitIdentity = {
  author_name: string
  author_email: string
  committer_name: string
  committer_email: string
}

export type CandidateCommitIdentities = {
  cc_gateway: CommitIdentity
  sub2api: CommitIdentity
}

const COMMIT_IDENTITY_FIELDS = ['author_name', 'author_email', 'committer_name', 'committer_email'] as const

function validCommitIdentity(value: unknown): value is CommitIdentity {
  if (!exactKeys(value, COMMIT_IDENTITY_FIELDS, '$commit_identity', [])) return false
  return COMMIT_IDENTITY_FIELDS.every((field) => {
    const candidate = value[field]
    return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 256 && !/[\u0000-\u001f\u007f]/.test(candidate)
  }) && typeof value.author_email === 'string' && value.author_email.includes('@')
    && typeof value.committer_email === 'string' && value.committer_email.includes('@')
}

function validCandidateCommitIdentities(value: unknown): value is CandidateCommitIdentities {
  return exactKeys(value, ['cc_gateway', 'sub2api'], '$candidate_commit_identities', [])
    && validCommitIdentity(value.cc_gateway) && validCommitIdentity(value.sub2api)
}

function identityAliases(value: string): Set<string> {
  const normalized = value.normalize('NFKC').trim().toLowerCase()
  const aliases = new Set<string>()
  const compact = normalized.replace(/[^a-z0-9]/g, '')
  if (compact) aliases.add(compact)
  const at = normalized.indexOf('@')
  if (at > 0) {
    const local = normalized.slice(0, at).replace(/[^a-z0-9]/g, '')
    if (local) aliases.add(local)
  }
  return aliases
}

function identitiesOverlap(left: string, right: string): boolean {
  const rightAliases = identityAliases(right)
  for (const alias of identityAliases(left)) if (rightAliases.has(alias)) return true
  return false
}

function reviewerMatchesCandidate(reviewer: string, candidates: CandidateCommitIdentities): boolean {
  const reviewerAliases = identityAliases(reviewer)
  for (const identity of Object.values(candidates)) {
    for (const field of COMMIT_IDENTITY_FIELDS) {
      for (const alias of identityAliases(identity[field])) if (reviewerAliases.has(alias)) return true
    }
  }
  return false
}

function readCommitIdentity(root: string, head: string): CommitIdentity {
  const bytes = gitBuffer(root, 'show', '-s', '--format=%an%x00%ae%x00%cn%x00%ce', head)
  const fields = bytes.toString('utf8').replace(/\n$/, '').split('\0')
  if (fields.length !== 4) fail('invalid_candidate_commit_identity', `${head} has an invalid Git identity record`)
  const value: CommitIdentity = {
    author_name: fields[0],
    author_email: fields[1],
    committer_name: fields[2],
    committer_email: fields[3],
  }
  if (!validCommitIdentity(value)) fail('invalid_candidate_commit_identity', `${head} has an unsafe or incomplete Git identity`)
  assertSafeArtifact(value)
  return value
}

export function readCandidateCommitIdentities(options: { ccRoot: string; ccHead: string; subRoot: string; subHead: string }): CandidateCommitIdentities {
  if (!/^[0-9a-f]{40,64}$/.test(options.ccHead) || !/^[0-9a-f]{40,64}$/.test(options.subHead)) fail('invalid_candidate_head', 'candidate heads are invalid')
  return {
    cc_gateway: readCommitIdentity(realpathSync(options.ccRoot), options.ccHead),
    sub2api: readCommitIdentity(realpathSync(options.subRoot), options.subHead),
  }
}

function validateReviewValue(value: unknown, expectedRole: 'requirements' | 'security_quality', expected: ReviewExpected, errors: HarnessErrorRecord[]): void {
  const where = expectedRole === 'requirements' ? '$requirements' : '$security'
  try { assertSafeArtifact(value) } catch (error) { add(errors, (error as Error & { code?: string }).code ?? 'unsafe_artifact', where, (error as Error).message) }
  if (!exactKeys(value, REVIEW_FIELDS, where, errors)) return
  if (value.schema_version !== 1 || value.review_kind !== 'governance_amendment_review') add(errors, 'invalid_review', where, 'review header is invalid')
  if (typeof value.reviewer_identity !== 'string' || !/^[A-Za-z0-9._@-]{3,128}$/.test(value.reviewer_identity) || identityAliases(value.reviewer_identity).size === 0) add(errors, 'invalid_reviewer_identity', `${where}.reviewer_identity`, 'reviewer identity is invalid')
  if (value.reviewer_role !== expectedRole) add(errors, 'wrong_reviewer_role', `${where}.reviewer_role`, 'reviewer role is not the required role')
  if (!same(value.reviewed_candidate_heads, expected.heads)) add(errors, 'review_head_mismatch', `${where}.reviewed_candidate_heads`, 'reviewed heads differ from the candidate')
  if (!same(value.diff_digests, expected.diffs)) add(errors, 'review_diff_mismatch', `${where}.diff_digests`, 'reviewed diffs differ from the candidate')
  if (value.plan_digest !== expected.planDigest || value.review_import_digest !== expected.reviewImportDigest) add(errors, 'review_input_mismatch', where, 'plan or review-import digest differs')
  if (value.decision !== 'approved') add(errors, 'review_not_approved', `${where}.decision`, 'review decision must be approved')
  if (!exactKeys(value.findings, ['critical', 'important', 'summaries'], `${where}.findings`, errors)) return
  if (value.findings.critical !== 0 || value.findings.important !== 0) add(errors, 'blocking_review_findings', `${where}.findings`, 'Critical and Important counts must both be zero')
  if (!Array.isArray(value.findings.summaries) || value.findings.summaries.length > 32 || value.findings.summaries.some((summary) => typeof summary !== 'string' || summary.length < 1 || summary.length > 512)) add(errors, 'invalid_review_summary', `${where}.findings.summaries`, 'review summaries are invalid')
  if (!Array.isArray(value.verification) || value.verification.length < 1 || value.verification.length > 64 || value.verification.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 512)) add(errors, 'invalid_review_verification', `${where}.verification`, 'verification evidence is invalid')
}

export function validateReviewPair(requirementsReview: unknown, securityReview: unknown, expected: ReviewExpected): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  validateReviewValue(requirementsReview, 'requirements', expected, errors)
  validateReviewValue(securityReview, 'security_quality', expected, errors)
  if (isObject(requirementsReview) && isObject(securityReview) && typeof requirementsReview.reviewer_identity === 'string' && typeof securityReview.reviewer_identity === 'string'
    && identitiesOverlap(requirementsReview.reviewer_identity, securityReview.reviewer_identity)) add(errors, 'duplicate_reviewer_identity', '$', 'normalized reviewer identities must be distinct')
  if (!validCandidateCommitIdentities(expected.candidateCommitIdentities)) add(errors, 'invalid_candidate_commit_identities', '$candidate_commit_identities', 'candidate Git identities are invalid')
  else for (const [where, review] of [['$requirements', requirementsReview], ['$security', securityReview]] as const) {
    if (isObject(review) && typeof review.reviewer_identity === 'string' && reviewerMatchesCandidate(review.reviewer_identity, expected.candidateCommitIdentities)) {
      add(errors, 'self_review_identity', `${where}.reviewer_identity`, 'reviewer identity conflicts with a candidate commit author or committer')
    }
  }
  return result(errors)
}

export type IgnoredOutputObservation = {
  repository: 'sub2api'
  policy: 'sub2api_joint_safe_deliverable_v1'
  policy_digest: string
  before: IgnoredInventorySummary
  after: IgnoredInventorySummary
}

export type ResultRecord = {
  command_id: string
  repository: 'cc-gateway' | 'sub2api' | 'egress-tls-sidecar'
  repository_commit: string
  expected_exit: 0 | 'nonzero'
  exit_code: number
  status: 'pass' | 'expected_fail' | 'unexpected_fail' | 'unexpected_pass'
  duration_ms: number
  stdout_digest: string
  stderr_digest: string
  output_bytes: number
  timed_out: boolean
  output_overflow: boolean
  failure_names: string[]
  manifest_digest: string
  catalog_entry_digest: string
  argv_digest: string
  environment_digest: string
  execution_bindings: Record<string, string>
  ignored_output_observations: IgnoredOutputObservation[]
  result_digest: string
}

export type ResultSet = {
  schema_version: 1
  result_kind: 'governance_amendment_command_results'
  generated_at: string
  expires_at: string
  manifest_digest: string
  catalog_digest: string
  group: 'green' | 'red' | 'merged'
  initial_ignored_inventories: RepositoryIgnoredInventories
  terminal_ignored_inventories: RepositoryIgnoredInventories
  records: ResultRecord[]
  result_set_digest: string
}

export function buildResultSet(options: {
  generated_at?: string
  generatedAt?: string
  expires_at?: string
  manifest_digest: string
  catalog_digest: string
  group: ResultSet['group']
  initial_ignored_inventories: RepositoryIgnoredInventories
  terminal_ignored_inventories: RepositoryIgnoredInventories
  records: Array<Record<string, unknown> | ResultRecord>
}): ResultSet {
  const generated = new Date(options.generatedAt ?? options.generated_at ?? new Date().toISOString())
  const records = options.records.map((record) => structuredClone(record) as ResultRecord).sort((left, right) => left.command_id.localeCompare(right.command_id))
  const unsigned = {
    schema_version: 1 as const,
    result_kind: 'governance_amendment_command_results' as const,
    generated_at: generated.toISOString(),
    expires_at: options.expires_at ?? new Date(generated.getTime() + 7 * 86_400_000).toISOString(),
    manifest_digest: options.manifest_digest,
    catalog_digest: options.catalog_digest,
    group: options.group,
    initial_ignored_inventories: structuredClone(options.initial_ignored_inventories),
    terminal_ignored_inventories: structuredClone(options.terminal_ignored_inventories),
    records,
  }
  return { ...unsigned, result_set_digest: sha256(canonicalJson(unsigned)) }
}

const IGNORED_SUMMARY_FIELDS = ['algorithm', 'endpoint_count', 'entry_count', 'regular_file_count', 'directory_count', 'symlink_count', 'regular_file_bytes', 'digest'] as const
const IGNORED_OBSERVATION_FIELDS = ['repository', 'policy', 'policy_digest', 'before', 'after'] as const

function validateIgnoredSummary(value: unknown, where: string, allowAbsent: boolean, errors: HarnessErrorRecord[]): void {
  if (!exactKeys(value, IGNORED_SUMMARY_FIELDS, where, errors)) return
  if (value.algorithm !== IGNORED_INVENTORY_ALGORITHM || !DIGEST_RE.test(String(value.digest))) add(errors, 'invalid_ignored_output_observation', where, 'ignored inventory summary algorithm or digest is invalid')
  for (const field of ['endpoint_count', 'entry_count', 'regular_file_count', 'directory_count', 'symlink_count', 'regular_file_bytes'] as const) {
    if (!Number.isSafeInteger(value[field]) || Number(value[field]) < 0) add(errors, 'invalid_ignored_output_observation', `${where}.${field}`, 'ignored inventory summary count is invalid')
  }
  const entryCount = Number(value.entry_count)
  const componentCount = Number(value.regular_file_count) + Number(value.directory_count) + Number(value.symlink_count)
  if (entryCount !== componentCount) add(errors, 'invalid_ignored_output_observation', `${where}.entry_count`, 'ignored inventory entry count is inconsistent')
  const absent = Number(value.endpoint_count) === 0 && entryCount === 0 && Number(value.regular_file_bytes) === 0
  const pair = Number(value.endpoint_count) === 1 && entryCount === 4 && Number(value.regular_file_count) === 2
    && Number(value.directory_count) === 2 && Number(value.symlink_count) === 0 && Number(value.regular_file_bytes) <= 393_216
  if (!(pair || allowAbsent && absent)) add(errors, 'invalid_ignored_output_observation', where, 'ignored inventory summary is outside the fixed safe-deliverable surface')
}

function validateIgnoredObservations(record: Record<string, unknown>, where: string, errors: HarnessErrorRecord[]): void {
  if (!Array.isArray(record.ignored_output_observations)) {
    add(errors, 'invalid_ignored_output_observation', `${where}.ignored_output_observations`, 'ignored-output observations must be an array')
    return
  }
  const joint = record.command_id === 'sub2api-joint-local-chain'
  if (record.ignored_output_observations.length !== (joint ? 1 : 0)) {
    add(errors, 'invalid_ignored_output_observation', `${where}.ignored_output_observations`, 'ignored-output observation inventory differs from the fixed catalog policy')
    return
  }
  if (!joint) return
  const observation = record.ignored_output_observations[0]
  if (!exactKeys(observation, IGNORED_OBSERVATION_FIELDS, `${where}.ignored_output_observations[0]`, errors)) return
  if (observation.repository !== 'sub2api' || observation.policy !== 'sub2api_joint_safe_deliverable_v1'
    || observation.policy_digest !== IGNORED_OUTPUT_POLICY_DIGESTS.sub2api_joint_safe_deliverable_v1) {
    add(errors, 'invalid_ignored_output_observation', `${where}.ignored_output_observations[0]`, 'ignored-output observation policy binding is invalid')
  }
  validateIgnoredSummary(observation.before, `${where}.ignored_output_observations[0].before`, true, errors)
  validateIgnoredSummary(observation.after, `${where}.ignored_output_observations[0].after`, false, errors)
}

export function validateResultSetValue(value: unknown, now = Date.now()): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  try { assertSafeArtifact(value) } catch (error) { add(errors, (error as Error & { code?: string }).code ?? 'unsafe_artifact', '$', (error as Error).message) }
  if (!exactKeys(value, RESULT_FIELDS, '$', errors)) return result(errors)
  const generated = Date.parse(String(value.generated_at)); const expires = Date.parse(String(value.expires_at))
  if (value.schema_version !== 1 || value.result_kind !== 'governance_amendment_command_results' || !['green', 'red', 'merged'].includes(String(value.group))) add(errors, 'invalid_result_set', '$', 'result-set header is invalid')
  if (!validUtcTimestamp(value.generated_at) || !validUtcTimestamp(value.expires_at) || !Number.isFinite(generated) || !Number.isFinite(expires) || expires - generated !== 7 * 86_400_000 || expires <= now) add(errors, 'expired_results', '$.expires_at', 'results must be fresh for exactly seven days')
  if (!DIGEST_RE.test(String(value.manifest_digest)) || !DIGEST_RE.test(String(value.catalog_digest))) add(errors, 'invalid_digest', '$', 'manifest and catalog digests are required')
  validateRepositoryIgnoredInventories(value.initial_ignored_inventories, '$.initial_ignored_inventories', errors)
  validateRepositoryIgnoredInventories(value.terminal_ignored_inventories, '$.terminal_ignored_inventories', errors)
  if (!Array.isArray(value.records)) add(errors, 'invalid_records', '$.records', 'records must be an array')
  else {
    const ids = new Set<string>()
    for (const [index, record] of value.records.entries()) {
      const where = `$.records[${index}]`
      if (!exactKeys(record, RESULT_RECORD_FIELDS, where, errors)) continue
      if (typeof record.command_id !== 'string' || ids.has(record.command_id)) add(errors, 'duplicate_command_id', `${where}.command_id`, 'command IDs must be unique'); else ids.add(record.command_id)
      if (!['cc-gateway', 'sub2api', 'egress-tls-sidecar'].includes(String(record.repository)) || !/^[0-9a-f]{40,64}$/.test(String(record.repository_commit))) add(errors, 'invalid_repository_binding', where, 'repository binding is invalid')
      if (![0, 'nonzero'].includes(record.expected_exit as never) || !Number.isInteger(record.exit_code) || !['pass', 'expected_fail', 'unexpected_fail', 'unexpected_pass'].includes(String(record.status))) add(errors, 'invalid_classification', where, 'result classification is invalid')
      const ordinaryStatus = classifyExit(Number(record.exit_code), record.expected_exit as 0 | 'nonzero')
      const expectedStatus = record.timed_out === true || record.output_overflow === true ? 'unexpected_fail' : ordinaryStatus
      if (record.status !== expectedStatus && record.status !== 'unexpected_fail') add(errors, 'classification_mismatch', `${where}.status`, 'classification differs from the observed exit or a conservative safety failure')
      for (const field of ['stdout_digest', 'stderr_digest', 'manifest_digest', 'catalog_entry_digest', 'argv_digest', 'environment_digest', 'result_digest'] as const) if (!DIGEST_RE.test(String(record[field]))) add(errors, 'invalid_digest', `${where}.${field}`, 'digest is invalid')
      if (!Number.isInteger(record.duration_ms) || Number(record.duration_ms) < 0 || !Number.isInteger(record.output_bytes) || Number(record.output_bytes) < 0 || typeof record.timed_out !== 'boolean' || typeof record.output_overflow !== 'boolean') add(errors, 'invalid_result_measurement', where, 'result measurements are invalid')
      if (!Array.isArray(record.failure_names) || record.failure_names.length > 64 || record.failure_names.some((name) => typeof name !== 'string' || name.length < 1 || name.length > 256)) add(errors, 'invalid_failure_names', `${where}.failure_names`, 'failure names are invalid')
      else if (record.status === 'expected_fail' && record.failure_names.length === 0) add(errors, 'invalid_failure_names', `${where}.failure_names`, 'expected RED requires stable named failures')
      if (record.manifest_digest !== value.manifest_digest || !isObject(record.execution_bindings) || Object.keys(record.execution_bindings).length < 3 || Object.entries(record.execution_bindings).some(([name, binding]) => !EXECUTION_BINDING_NAMES.includes(name as never) || !(name.endsWith('_head') ? /^[0-9a-f]{40,64}$/.test(String(binding)) : DIGEST_RE.test(String(binding))))) add(errors, 'invalid_execution_binding', `${where}.execution_bindings`, 'execution bindings are invalid or cross-manifest')
      validateIgnoredObservations(record, where, errors)
      if (record.result_digest !== digestUnsigned(record, 'result_digest')) add(errors, 'result_digest_mismatch', `${where}.result_digest`, 'record digest mismatch')
    }
    const expectedIds = value.group === 'green' ? COMMAND_IDS.green : value.group === 'red' ? COMMAND_IDS.red : [...COMMAND_IDS.green, ...COMMAND_IDS.red]
    if (!same([...ids].sort(), [...expectedIds].sort())) add(errors, 'incomplete_result_set', '$.records', 'result inventory is incomplete or unexpected')
  }
  if (value.result_set_digest !== digestUnsigned(value, 'result_set_digest')) add(errors, 'result_set_digest_mismatch', '$.result_set_digest', 'result-set digest mismatch')
  return result(errors)
}

export function catalogEntryDigest(entry: unknown): string {
  return sha256(canonicalJson(entry))
}

export function validateResultSetBindings(value: ResultSet, catalog: Array<Record<string, unknown>>, manifest: ExitValue, manifestDigest: string, catalogDigest: string): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  const entries = new Map(catalog.map((entry) => [String(entry.id), entry]))
  if (value.manifest_digest !== manifestDigest || value.catalog_digest !== catalogDigest) add(errors, 'cross_manifest_results', '$', 'result-set manifest or catalog digest differs')
  for (const [index, record] of value.records.entries()) {
    const entry = entries.get(record.command_id); const where = `$.records[${index}]`
    if (!entry) { add(errors, 'unknown_command_result', where, 'result command is absent from catalog'); continue }
    const expectedHead = entry.repository === 'sub2api' ? manifest.repositories.sub2api.head : manifest.repositories.cc_gateway.head
    if (record.repository !== entry.repository || record.repository_commit !== expectedHead || record.expected_exit !== entry.expected_exit || record.catalog_entry_digest !== catalogEntryDigest(entry) || record.manifest_digest !== manifestDigest) add(errors, 'catalog_result_mismatch', where, 'result differs from catalog or manifest')
    if (!same(Object.keys(record.execution_bindings).sort(), [...entry.bindings as string[]].sort())) add(errors, 'incomplete_execution_binding', `${where}.execution_bindings`, 'execution bindings differ from catalog declaration')
    const bindings = record.execution_bindings
    if ('cc_gateway_head' in bindings && bindings.cc_gateway_head !== manifest.repositories.cc_gateway.head) add(errors, 'wrong_repository_head', `${where}.execution_bindings.cc_gateway_head`, 'CC Gateway binding differs')
    if ('sub2api_head' in bindings && bindings.sub2api_head !== manifest.repositories.sub2api.head) add(errors, 'wrong_repository_head', `${where}.execution_bindings.sub2api_head`, 'Sub2API binding differs')
    if ('shared_contract_digest' in bindings && bindings.shared_contract_digest !== manifest.shared_contract.digest) add(errors, 'contract_drift', `${where}.execution_bindings.shared_contract_digest`, 'shared contract binding differs')
    if ('cc_gateway_before_snapshot' in bindings && bindings.cc_gateway_before_snapshot !== bindings.cc_gateway_after_snapshot) add(errors, 'repository_mutation', `${where}.execution_bindings`, 'CC Gateway snapshots differ')
    if ('sub2api_before_snapshot' in bindings && bindings.sub2api_before_snapshot !== bindings.sub2api_after_snapshot) add(errors, 'repository_mutation', `${where}.execution_bindings`, 'Sub2API snapshots differ')
    const expectedIgnoredPolicy = entry.ignored_output_policy === 'sub2api_joint_safe_deliverable_v1' ? 1 : 0
    if (record.ignored_output_observations.length !== expectedIgnoredPolicy
      || expectedIgnoredPolicy === 1 && (record.command_id !== 'sub2api-joint-local-chain' || record.repository !== 'sub2api'
        || record.ignored_output_observations[0]?.policy_digest !== IGNORED_OUTPUT_POLICY_DIGESTS.sub2api_joint_safe_deliverable_v1)) {
      add(errors, 'invalid_ignored_output_observation', `${where}.ignored_output_observations`, 'ignored-output observation differs from the catalog policy')
    }
    const expectedFamilies = EXPECTED_RED_FAILURE_FAMILIES[record.command_id]
    if (record.status === 'expected_fail' && expectedFamilies && expectedFamilies.some((pattern) => !record.failure_names.some((name) => pattern.test(name)))) add(errors, 'unexpected_red_inventory', `${where}.failure_names`, 'expected RED failure families are incomplete')
  }
  return result(errors)
}

export function mergeResultSets(green: ResultSet, red: ResultSet, generatedAt?: string): ResultSet {
  const greenValidation = validateResultSetValue(green, Date.parse(green.generated_at)); if (!greenValidation.ok) fail(greenValidation.errors[0].code, JSON.stringify(greenValidation.errors))
  const redValidation = validateResultSetValue(red, Date.parse(red.generated_at)); if (!redValidation.ok) fail(redValidation.errors[0].code, JSON.stringify(redValidation.errors))
  if (green.group !== 'green' || red.group !== 'red') fail('wrong_result_group', 'GREEN and RED result sets are required')
  if (green.manifest_digest !== red.manifest_digest || green.catalog_digest !== red.catalog_digest) fail('cross_manifest_results', 'GREEN and RED result bindings differ')
  if (!same(green.terminal_ignored_inventories, red.initial_ignored_inventories)) fail('repository_mutation', 'RED initial ignored state differs from GREEN terminal evidence')
  if (green.records.some((record) => record.status !== 'pass') || red.records.some((record) => record.status !== 'expected_fail')) fail('unexpected_classification', 'only accepted GREEN and RED classifications can merge')
  return buildResultSet({
    generatedAt: generatedAt ?? green.generated_at,
    manifest_digest: green.manifest_digest,
    catalog_digest: green.catalog_digest,
    group: 'merged',
    initial_ignored_inventories: green.initial_ignored_inventories,
    terminal_ignored_inventories: red.terminal_ignored_inventories,
    records: [...green.records, ...red.records],
  })
}

export function validateMergedResultSetConsistency(green: ResultSet, red: ResultSet, merged: ResultSet): void {
  const mergedValidation = validateResultSetValue(merged, Date.parse(merged.generated_at))
  if (!mergedValidation.ok) fail(mergedValidation.errors[0].code, JSON.stringify(mergedValidation.errors))
  const rebuilt = mergeResultSets(green, red, merged.generated_at)
  if (!same(merged, rebuilt)) fail('merged_result_mismatch', 'merged results differ from the exact deterministic GREEN and RED merge')
}

export function validateIgnoredEvidenceContinuity(manifest: ExitValue, green: ResultSet, red: ResultSet, merged?: ResultSet): void {
  const exitInitial = manifestInitialIgnoredInventories(manifest)
  if (!same(green.initial_ignored_inventories, exitInitial)) fail('repository_mutation', 'GREEN initial ignored state differs from exit evidence')
  if (!same(red.initial_ignored_inventories, green.terminal_ignored_inventories)) fail('repository_mutation', 'RED initial ignored state differs from GREEN terminal evidence')
  if (merged && (!same(merged.initial_ignored_inventories, green.initial_ignored_inventories)
    || !same(merged.terminal_ignored_inventories, red.terminal_ignored_inventories))) fail('repository_mutation', 'merged ignored-state evidence does not preserve exit to GREEN to RED continuity')
}

type CodeGraphValue = ReturnType<typeof inspectCodeGraphIndex>
export type ExitValue = {
  schema_version: 1
  exit_kind: 'governance_amendment_exit'
  generated_at: string
  entry: ArtifactBinding
  entry_receipt: ArtifactBinding
  repositories: {
    cc_gateway: { head: string; branch: string; clean: true; snapshot_digest: string; initial_ignored_inventory: IgnoredInventorySummary }
    sub2api: { head: string; branch: string; clean: true; snapshot_digest: string; initial_ignored_inventory: IgnoredInventorySummary }
  }
  reviewed_candidate_heads: { cc_gateway: string; sub2api: string }
  candidate_commit_identities: CandidateCommitIdentities
  approval_attestation_head: string
  shared_contract: ArtifactBinding
  parent_receipts: { phase_zero: ArtifactBinding; post_integration_v2: ArtifactBinding }
  governance: Record<keyof typeof GOVERNANCE_PATHS, ArtifactBinding>
  capture_inputs: Record<keyof typeof CAPTURE_INPUT_PATHS, ArtifactBinding>
  codegraph: { cc_gateway: CodeGraphValue; sub2api: CodeGraphValue }
  artifact_chain: typeof ARTIFACT_CHAIN
  disabled_capabilities: string[]
  exit_digest: string
}

const EXIT_FIELDS = ['schema_version', 'exit_kind', 'generated_at', 'entry', 'entry_receipt', 'repositories', 'reviewed_candidate_heads', 'candidate_commit_identities', 'approval_attestation_head', 'shared_contract', 'parent_receipts', 'governance', 'capture_inputs', 'codegraph', 'artifact_chain', 'disabled_capabilities', 'exit_digest'] as const

function gitText(root: string, ...args: string[]): string {
  try { return runReviewedGit(root, args).stdout.toString('utf8').trim() }
  catch (error) {
    if ((error as Error & { code?: string }).code !== 'git_command_failed') throw error
    fail('git_inspection_failed', `Git inspection failed for ${args[0] ?? 'command'}`)
  }
}

export function resolveCommitish(root: string, revision: string, errorCode: string): string {
  try {
    const resolved = runReviewedGit(realpathSync(root), ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]).stdout.toString('utf8').trim()
    if (!/^[0-9a-f]{40,64}$/.test(resolved)) fail(errorCode, `${revision} did not resolve to a full commit object ID`)
    return resolved
  } catch (error) {
    if ((error as Error & { code?: string }).code === errorCode) throw error
    if ((error as Error & { code?: string }).code !== 'git_command_failed') throw error
    fail(errorCode, `${revision} is not a valid commit-ish`)
  }
}

function gitBuffer(root: string, ...args: string[]): Buffer {
  try { return runReviewedGit(root, args).stdout }
  catch (error) {
    if ((error as Error & { code?: string }).code !== 'git_command_failed') throw error
    fail('git_inspection_failed', `Git inspection failed for ${args[0] ?? 'command'}`)
  }
}

function isAncestor(root: string, ancestor: string, descendant: string): boolean {
  return runReviewedGit(root, ['merge-base', '--is-ancestor', ancestor, descendant], { allowedExitCodes: [0, 1] }).status === 0
}

function relativeArtifact(rootInput: string, fileInput: string): string {
  const root = realpathSync(rootInput)
  const absolute = path.isAbsolute(fileInput) ? path.resolve(fileInput) : path.resolve(root, fileInput)
  const relative = path.relative(root, absolute).split(path.sep).join('/')
  if (!normalizedRepositoryPath(relative)) fail('artifact_path_escape', 'artifact path escapes the CC Gateway repository')
  return relative
}

function readArtifactAt(root: string, relative: string): { read: BoundedFileRead; binding: ArtifactBinding } {
  if (!normalizedRepositoryPath(relative)) fail('invalid_artifact_path', `${relative} is not repository-relative`)
  const components = relative.split('/')
  let absolute = root
  let stat
  for (let index = 0; index < components.length; index += 1) {
    absolute = path.join(absolute, components[index])
    try { stat = lstatSync(absolute) } catch { fail('missing_artifact', `${relative} is missing`) }
    if (stat.isSymbolicLink()) fail('artifact_symlink', `${relative} contains a symlink`)
    if (index < components.length - 1 && !stat.isDirectory()) fail('invalid_artifact', `${relative} has a non-directory parent`)
  }
  if (!stat?.isFile()) fail('invalid_artifact', `${relative} is not a regular file`)
  const read = readEvidenceFile(absolute)
  return { read, binding: { path: relative, digest: read.digest } }
}

function bindingAt(root: string, relative: string): ArtifactBinding {
  return readArtifactAt(root, relative).binding
}

function bindingsAt<T extends Record<string, string>>(root: string, paths: T): { [K in keyof T]: ArtifactBinding } {
  return Object.fromEntries(Object.entries(paths).map(([name, relative]) => [name, bindingAt(root, relative)])) as { [K in keyof T]: ArtifactBinding }
}

function readJsonAt<T>(root: string, relative: string): T {
  return readJsonArtifactAt<T>(root, relative).value
}

function readJsonArtifactAt<T>(root: string, relative: string): { value: T; binding: ArtifactBinding } {
  const observed = readArtifactAt(root, relative)
  try { return { value: JSON.parse(observed.read.bytes.toString('utf8')) as T, binding: observed.binding } }
  catch { fail('invalid_json', `${relative} is not valid JSON`) }
}

function readTextAt(root: string, relative: string): string {
  return readArtifactAt(root, relative).read.bytes.toString('utf8')
}

function requireValidation(validation: HarnessResult): void {
  if (!validation.ok) fail(validation.errors[0]?.code ?? 'validation_failed', JSON.stringify(validation.errors))
}

function validateAgainstSchema(root: string, schemaRelative: string, value: unknown): void {
  let schema: unknown
  try { schema = readJsonAt(root, schemaRelative) } catch { fail('invalid_schema', `${schemaRelative} is unavailable`) }
  try {
    const ajv = new Ajv2020Constructor({ strict: false, allErrors: true, formats: { 'date-time': true } })
    const validate = ajv.compile(schema)
    if (!validate(value)) fail('schema_validation_failed', JSON.stringify(validate.errors))
  } catch (error) {
    if ((error as Error & { code?: string }).code === 'schema_validation_failed') throw error
    fail('invalid_schema', (error as Error).message)
  }
}

function validateCodeGraphValue(value: unknown, where: string, errors: HarnessErrorRecord[]): void {
  if (!exactKeys(value, ['version', 'up_to_date', 'index_digest', 'file_count', 'node_count', 'edge_count'], where, errors)) return
  if (value.version !== '1.1.6' || value.up_to_date !== true || !DIGEST_RE.test(String(value.index_digest))) add(errors, 'stale_codegraph_index', where, 'CodeGraph binding is not current')
  for (const field of ['file_count', 'node_count', 'edge_count'] as const) if (!Number.isInteger(value[field]) || Number(value[field]) < 1) add(errors, 'invalid_codegraph_binding', `${where}.${field}`, 'CodeGraph count is invalid')
}

export function buildExitValue(options: Omit<ExitValue, 'schema_version' | 'exit_kind' | 'exit_digest' | 'artifact_chain' | 'disabled_capabilities'>): ExitValue {
  const unsigned = {
    schema_version: 1 as const,
    exit_kind: 'governance_amendment_exit' as const,
    ...options,
    artifact_chain: ARTIFACT_CHAIN,
    disabled_capabilities: [...DISABLED_CAPABILITIES],
  }
  return { ...unsigned, exit_digest: sha256(canonicalJson(unsigned)) }
}

export function validateExitValue(value: unknown): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  try { assertSafeArtifact(value) } catch (error) { add(errors, (error as Error & { code?: string }).code ?? 'unsafe_artifact', '$', (error as Error).message) }
  if (!exactKeys(value, EXIT_FIELDS, '$', errors)) return result(errors)
  if (value.schema_version !== 1 || value.exit_kind !== 'governance_amendment_exit' || !validUtcTimestamp(value.generated_at)) add(errors, 'invalid_exit', '$', 'exit header is invalid')
  if (!validArtifact(value.entry) || !validArtifact(value.entry_receipt) || !same(value.entry, IMMUTABLE_ENTRY_BINDINGS.entry) || !same(value.entry_receipt, IMMUTABLE_ENTRY_BINDINGS.receipt)) add(errors, 'invalid_entry_binding', '$', 'entry pair bindings are not the immutable Task 0B bytes')
  if (!isObject(value.repositories) || !exactKeys(value.repositories, ['cc_gateway', 'sub2api'], '$.repositories', errors)) add(errors, 'invalid_repository_binding', '$.repositories', 'both repository bindings are required')
  else for (const name of ['cc_gateway', 'sub2api'] as const) {
    const repository = value.repositories[name]
    const where = `$.repositories.${name}`
    if (!exactKeys(repository, ['head', 'branch', 'clean', 'snapshot_digest', 'initial_ignored_inventory'], where, errors)) continue
    if (!/^[0-9a-f]{40,64}$/.test(String(repository.head)) || repository.branch !== 'codex/oracle-p0-1-governance' || repository.clean !== true || !DIGEST_RE.test(String(repository.snapshot_digest))) add(errors, 'invalid_repository_binding', where, 'repository binding is invalid')
    if (!validFullIgnoredSummary(repository.initial_ignored_inventory)) add(errors, 'invalid_repository_binding', `${where}.initial_ignored_inventory`, 'initial ignored inventory is invalid')
  }
  if (!isObject(value.reviewed_candidate_heads) || !exactKeys(value.reviewed_candidate_heads, ['cc_gateway', 'sub2api'], '$.reviewed_candidate_heads', errors) || !Object.values(value.reviewed_candidate_heads).every((head) => /^[0-9a-f]{40,64}$/.test(String(head))) || !/^[0-9a-f]{40,64}$/.test(String(value.approval_attestation_head))) add(errors, 'invalid_reviewed_heads', '$', 'reviewed and approval heads are invalid')
  else if (isObject(value.repositories) && isObject(value.repositories.cc_gateway) && isObject(value.repositories.sub2api)
    && (value.approval_attestation_head !== value.repositories.cc_gateway.head || value.reviewed_candidate_heads.sub2api !== value.repositories.sub2api.head)) add(errors, 'review_head_mismatch', '$', 'approval and Sub2API reviewed heads differ from captured repositories')
  if (!validCandidateCommitIdentities(value.candidate_commit_identities)) add(errors, 'invalid_candidate_commit_identities', '$.candidate_commit_identities', 'candidate Git identities are invalid')
  if (!validArtifact(value.shared_contract) || value.shared_contract.path !== SHARED_CONTRACT_PATH || value.shared_contract.digest !== SHARED_CONTRACT_DIGEST) add(errors, 'contract_drift', '$.shared_contract', 'shared contract binding drifted')
  if (!isObject(value.parent_receipts) || !exactKeys(value.parent_receipts, ['phase_zero', 'post_integration_v2'], '$.parent_receipts', errors) || !Object.values(value.parent_receipts).every(validArtifact) || !same(value.parent_receipts, PARENT_RECEIPTS)) add(errors, 'invalid_parent_receipts', '$.parent_receipts', 'both exact historical parent receipts are required')
  for (const [field, paths] of [['governance', GOVERNANCE_PATHS], ['capture_inputs', CAPTURE_INPUT_PATHS]] as const) {
    const candidate = value[field]
    if (!isObject(candidate) || !exactKeys(candidate, Object.keys(paths), `$.${field}`, errors)) { add(errors, `invalid_${field}`, `$.${field}`, `${field} inventory is incomplete`); continue }
    for (const [name, expectedPath] of Object.entries(paths)) if (!validArtifact(candidate[name]) || candidate[name].path !== expectedPath) add(errors, `invalid_${field}`, `$.${field}.${name}`, `${name} binding is invalid`)
  }
  if (!isObject(value.codegraph) || !exactKeys(value.codegraph, ['cc_gateway', 'sub2api'], '$.codegraph', errors)) add(errors, 'invalid_codegraph_binding', '$.codegraph', 'both CodeGraph bindings are required')
  else { validateCodeGraphValue(value.codegraph.cc_gateway, '$.codegraph.cc_gateway', errors); validateCodeGraphValue(value.codegraph.sub2api, '$.codegraph.sub2api', errors) }
  if (!same(value.artifact_chain, ARTIFACT_CHAIN)) add(errors, 'artifact_chain_drift', '$.artifact_chain', 'artifact chain paths are not exact')
  if (!same(value.disabled_capabilities, DISABLED_CAPABILITIES)) add(errors, 'disabled_capability_drift', '$.disabled_capabilities', 'deferred capabilities must remain disabled')
  if (value.exit_digest !== digestUnsigned(value, 'exit_digest')) add(errors, 'exit_digest_mismatch', '$.exit_digest', 'exit digest mismatch')
  return result(errors)
}

function diffDigest(root: string, base: string, head: string): string {
  return sha256(gitBuffer(root, 'diff', '--binary', `${base}...${head}`, '--'))
}

type ValidatedReviews = {
  requirements: Record<string, unknown>
  security: Record<string, unknown>
  expected: ReviewExpected
  approvalHead: string
}

function validateReviewArtifacts(options: { ccRoot: string; subRoot: string; requirementsPath?: string; securityPath?: string; reviewImportPath?: string }): ValidatedReviews {
  const ccRoot = realpathSync(options.ccRoot); const subRoot = realpathSync(options.subRoot)
  const requirementsRelative = options.requirementsPath ? relativeArtifact(ccRoot, options.requirementsPath) : REQUIREMENTS_REVIEW_PATH
  const securityRelative = options.securityPath ? relativeArtifact(ccRoot, options.securityPath) : SECURITY_REVIEW_PATH
  const reviewImportRelative = options.reviewImportPath ? relativeArtifact(ccRoot, options.reviewImportPath) : REVIEW_IMPORT_PATH
  const requirements = readJsonAt<Record<string, unknown>>(ccRoot, requirementsRelative)
  const security = readJsonAt<Record<string, unknown>>(ccRoot, securityRelative)
  const reviewImportObserved = readJsonArtifactAt(ccRoot, reviewImportRelative)
  const reviewImport = reviewImportObserved.value
  validateReviewEvidenceSchemas({ root: ccRoot, requirements, security, reviewImport, schemaCommit: gitText(ccRoot, 'rev-parse', 'HEAD') })
  const heads = isObject(requirements.reviewed_candidate_heads) ? requirements.reviewed_candidate_heads as ReviewExpected['heads'] : { cc_gateway: '', sub2api: '' }
  const expected: ReviewExpected = {
    heads,
    diffs: { cc_gateway: diffDigest(ccRoot, BASE_HEADS.cc_gateway, heads.cc_gateway), sub2api: diffDigest(subRoot, BASE_HEADS.sub2api, heads.sub2api) },
    planDigest: bindingAt(ccRoot, PLAN_PATH).digest,
    reviewImportDigest: reviewImportObserved.binding.digest,
    candidateCommitIdentities: readCandidateCommitIdentities({ ccRoot, ccHead: heads.cc_gateway, subRoot, subHead: heads.sub2api }),
  }
  requireValidation(validateReviewPair(requirements, security, expected))
  if (!isAncestor(ccRoot, BASE_HEADS.cc_gateway, heads.cc_gateway) || !isAncestor(subRoot, BASE_HEADS.sub2api, heads.sub2api)) fail('invalid_candidate_ancestry', 'reviewed candidates do not descend from frozen bases')
  if (gitText(subRoot, 'rev-parse', 'HEAD') !== heads.sub2api) fail('review_head_mismatch', 'Sub2API HEAD differs from reviewed candidate')
  const approvalHead = gitText(ccRoot, 'rev-parse', 'HEAD')
  if (gitText(ccRoot, 'rev-parse', `${approvalHead}^`) !== heads.cc_gateway) fail('invalid_approval_commit_parent', 'approval commit parent is not the reviewed candidate')
  const delta = gitText(ccRoot, 'diff-tree', '--no-commit-id', '--name-status', '-r', approvalHead).split('\n').filter(Boolean).sort()
  const expectedDelta = [`A\t${requirementsRelative}`, `A\t${securityRelative}`].sort()
  if (!same(delta, expectedDelta)) fail('invalid_approval_commit_delta', 'approval commit must add exactly the two review attestations')
  return { requirements, security, expected, approvalHead }
}

export type ReportValue = {
  schema_version: 1
  report_type: 'exit' | 'controller'
  generated_at: string
  status: 'pass' | 'blocked'
  manifest: { path: string; digest: string }
  results: { path: string; digest: string }
  reviews: Array<{ role: 'requirements' | 'security_quality'; digest: string }>
  command_summary: { pass: number; expected_fail: number; unexpected_fail: number; unexpected_pass: number }
  report_digest: string
}

export function buildReportValue(options: {
  reportType: 'exit' | 'controller'
  generatedAt?: string
  status: 'pass' | 'blocked'
  manifest: ReportValue['manifest']
  results: ReportValue['results']
  reviews: ReportValue['reviews']
  commandSummary: ReportValue['command_summary']
}): ReportValue {
  const unsigned = {
    schema_version: 1 as const,
    report_type: options.reportType,
    generated_at: new Date(options.generatedAt ?? new Date().toISOString()).toISOString(),
    status: options.status,
    manifest: options.manifest,
    results: options.results,
    reviews: options.reviews,
    command_summary: options.commandSummary,
  }
  return { ...unsigned, report_digest: sha256(canonicalJson(unsigned)) }
}

export function validateReportValue(value: unknown): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  try { assertSafeArtifact(value) } catch (error) { add(errors, (error as Error & { code?: string }).code ?? 'unsafe_artifact', '$', (error as Error).message) }
  if (!exactKeys(value, REPORT_FIELDS, '$', errors)) return result(errors)
  if (value.schema_version !== 1 || !['exit', 'controller'].includes(String(value.report_type)) || !['pass', 'blocked'].includes(String(value.status)) || !validUtcTimestamp(value.generated_at)) add(errors, 'invalid_report', '$', 'report header is invalid')
  if (!validArtifact(value.manifest) || value.manifest.path !== ARTIFACT_CHAIN.exit || !validArtifact(value.results) || value.results.path !== ARTIFACT_CHAIN.results) add(errors, 'invalid_report_binding', '$', 'manifest and results bindings are invalid')
  if (!Array.isArray(value.reviews) || value.reviews.length !== 2 || !same(value.reviews.map((review) => isObject(review) ? review.role : undefined), ['requirements', 'security_quality'])) add(errors, 'invalid_review_binding', '$.reviews', 'exact requirements and security reviews are required')
  else for (const [index, review] of value.reviews.entries()) if (!exactKeys(review, ['role', 'digest'], `$.reviews[${index}]`, errors) || !DIGEST_RE.test(String(review.digest))) add(errors, 'invalid_review_binding', `$.reviews[${index}]`, 'review binding digest is invalid')
  if (!isObject(value.command_summary) || !exactKeys(value.command_summary, ['pass', 'expected_fail', 'unexpected_fail', 'unexpected_pass'], '$.command_summary', errors)) add(errors, 'invalid_command_summary', '$.command_summary', 'command summary is invalid')
  else {
    for (const field of ['pass', 'expected_fail', 'unexpected_fail', 'unexpected_pass'] as const) if (!Number.isInteger(value.command_summary[field]) || Number(value.command_summary[field]) < 0) add(errors, 'invalid_command_summary', `$.command_summary.${field}`, 'summary count is invalid')
    const accepted = value.command_summary.pass === 7 && value.command_summary.expected_fail === 3 && value.command_summary.unexpected_fail === 0 && value.command_summary.unexpected_pass === 0
    if ((value.status === 'pass') !== accepted) add(errors, 'report_status_mismatch', '$.status', 'report status differs from the exact accepted inventory')
  }
  if (value.report_digest !== digestUnsigned(value, 'report_digest')) add(errors, 'report_digest_mismatch', '$.report_digest', 'report digest mismatch')
  return result(errors)
}

export function renderReportMarkdown(value: Record<string, unknown>): string {
  const summary = isObject(value.command_summary) ? value.command_summary : {}
  const lines = [
    `# P0.1 ${value.report_type === 'controller' ? 'Controller Final' : 'Exit'} Report`,
    '',
    `Status: ${String(value.status).toUpperCase()}`,
    '',
    `Generated: ${String(value.generated_at)}`,
    '',
    '| Classification | Count |',
    '| --- | ---: |',
    `| pass | ${String(summary.pass ?? '')} |`,
    `| expected_fail | ${String(summary.expected_fail ?? '')} |`,
    `| unexpected_fail | ${String(summary.unexpected_fail ?? '')} |`,
    `| unexpected_pass | ${String(summary.unexpected_pass ?? '')} |`,
    '',
    `Report digest: ${String(value.report_digest)}`,
    '',
  ]
  return lines.join('\n')
}

export function validateReportPair(value: unknown, markdown: string): HarnessResult {
  const validation = validateReportValue(value)
  if (!validation.ok) return validation
  return markdown === renderReportMarkdown(value as Record<string, unknown>)
    ? result([])
    : result([{ code: 'report_markdown_mismatch', path: '$markdown', message: 'Markdown is not the exact deterministic render' }])
}

export type HandoffValue = {
  schema_version: 1
  handoff_kind: 'governance_amendment_handoff'
  generated_at: string
  expires_at: string
  bindings: Record<string, { path: string; digest: string }>
  disabled_capabilities: string[]
  next_planning_entry_conditions: string[]
  next_implementation_entry_conditions: string[]
  handoff_digest: string
}

export function buildHandoffValue(options: { generatedAt?: string; bindings: HandoffValue['bindings']; disabledCapabilities?: string[] }): HandoffValue {
  const generated = new Date(options.generatedAt ?? new Date().toISOString())
  const unsigned = {
    schema_version: 1 as const,
    handoff_kind: 'governance_amendment_handoff' as const,
    generated_at: generated.toISOString(),
    expires_at: new Date(generated.getTime() + 86_400_000).toISOString(),
    bindings: options.bindings,
    disabled_capabilities: options.disabledCapabilities ?? [...DISABLED_CAPABILITIES],
    next_planning_entry_conditions: [...NEXT_PLANNING_ENTRY_CONDITIONS],
    next_implementation_entry_conditions: [...NEXT_IMPLEMENTATION_ENTRY_CONDITIONS],
  }
  return { ...unsigned, handoff_digest: sha256(canonicalJson(unsigned)) }
}

export function validateHandoffValue(value: unknown, now = Date.now()): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  try { assertSafeArtifact(value) } catch (error) { add(errors, (error as Error & { code?: string }).code ?? 'unsafe_artifact', '$', (error as Error).message) }
  if (!exactKeys(value, HANDOFF_FIELDS, '$', errors)) return result(errors)
  const generated = Date.parse(String(value.generated_at)); const expires = Date.parse(String(value.expires_at))
  if (value.schema_version !== 1 || value.handoff_kind !== 'governance_amendment_handoff') add(errors, 'invalid_handoff', '$', 'handoff header is invalid')
  if (!validUtcTimestamp(value.generated_at) || !validUtcTimestamp(value.expires_at) || !Number.isFinite(generated) || !Number.isFinite(expires) || expires - generated !== 86_400_000 || expires <= now) add(errors, 'expired_handoff', '$.expires_at', 'handoff must be fresh for exactly 24 hours')
  validateBindingMap(value.bindings, {
    manifest: ARTIFACT_CHAIN.exit,
    results: ARTIFACT_CHAIN.results,
    context: ARTIFACT_CHAIN.context,
    report: ARTIFACT_CHAIN.report,
    report_markdown: ARTIFACT_CHAIN.report_markdown,
    controller_report: ARTIFACT_CHAIN.controller_report,
    controller_report_markdown: ARTIFACT_CHAIN.controller_report_markdown,
  }, '$.bindings', errors)
  if (!same(value.disabled_capabilities, DISABLED_CAPABILITIES)) add(errors, 'disabled_capability_drift', '$.disabled_capabilities', 'deferred capabilities must remain disabled')
  if (!same(value.next_planning_entry_conditions, NEXT_PLANNING_ENTRY_CONDITIONS) || !same(value.next_implementation_entry_conditions, NEXT_IMPLEMENTATION_ENTRY_CONDITIONS)) add(errors, 'next_entry_condition_drift', '$', 'P1 entry conditions drifted')
  if (value.handoff_digest !== digestUnsigned(value, 'handoff_digest')) add(errors, 'handoff_digest_mismatch', '$.handoff_digest', 'handoff digest mismatch')
  return result(errors)
}

export type ContextValue = {
  schema_version: 1
  context_kind: 'governance_amendment_context'
  generated_at: string
  expires_at: string
  bindings: Record<string, ArtifactBinding>
  review_import: ArtifactBinding
  reviews: ArtifactBinding[]
  disabled_capabilities: string[]
  context_digest: string
}

export function buildContextValue(options: { generatedAt?: string; bindings: ContextValue['bindings']; reviewImport: ArtifactBinding; reviews: ArtifactBinding[] }): ContextValue {
  const generated = new Date(options.generatedAt ?? new Date().toISOString())
  const unsigned = {
    schema_version: 1 as const,
    context_kind: 'governance_amendment_context' as const,
    generated_at: generated.toISOString(),
    expires_at: new Date(generated.getTime() + 86_400_000).toISOString(),
    bindings: options.bindings,
    review_import: options.reviewImport,
    reviews: options.reviews,
    disabled_capabilities: [...DISABLED_CAPABILITIES],
  }
  return { ...unsigned, context_digest: sha256(canonicalJson(unsigned)) }
}

export function validateContextValue(value: unknown, now = Date.now()): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  try { assertSafeArtifact(value) } catch (error) { add(errors, (error as Error & { code?: string }).code ?? 'unsafe_artifact', '$', (error as Error).message) }
  if (!exactKeys(value, CONTEXT_FIELDS, '$', errors)) return result(errors)
  const generated = Date.parse(String(value.generated_at)); const expires = Date.parse(String(value.expires_at))
  if (value.schema_version !== 1 || value.context_kind !== 'governance_amendment_context') add(errors, 'invalid_context', '$', 'context header is invalid')
  if (!validUtcTimestamp(value.generated_at) || !validUtcTimestamp(value.expires_at) || !Number.isFinite(generated) || !Number.isFinite(expires) || expires - generated !== 86_400_000 || expires <= now) add(errors, 'expired_context', '$.expires_at', 'context must be fresh for exactly 24 hours')
  validateBindingMap(value.bindings, {
    manifest: ARTIFACT_CHAIN.exit,
    results: ARTIFACT_CHAIN.results,
    report: ARTIFACT_CHAIN.report,
    report_markdown: ARTIFACT_CHAIN.report_markdown,
    controller_report: ARTIFACT_CHAIN.controller_report,
    controller_report_markdown: ARTIFACT_CHAIN.controller_report_markdown,
  }, '$.bindings', errors)
  if (!validArtifact(value.review_import) || value.review_import.path !== REVIEW_IMPORT_PATH || !Array.isArray(value.reviews) || value.reviews.length !== 2 || !value.reviews.every(validArtifact)
    || value.reviews[0].path !== REQUIREMENTS_REVIEW_PATH || value.reviews[1].path !== SECURITY_REVIEW_PATH) add(errors, 'invalid_review_binding', '$', 'review-import and two exact review bindings are required')
  if (!same(value.disabled_capabilities, DISABLED_CAPABILITIES)) add(errors, 'disabled_capability_drift', '$.disabled_capabilities', 'deferred capabilities must remain disabled')
  if (value.context_digest !== digestUnsigned(value, 'context_digest')) add(errors, 'context_digest_mismatch', '$.context_digest', 'context digest mismatch')
  return result(errors)
}

export type ReceiptValue = {
  schema_version: 1
  receipt_kind: 'governance_amendment_successor_receipt'
  generated_at: string
  artifact_commit: string
  reviewed_heads: { cc_gateway: string; sub2api: string }
  shared_contract: ArtifactBinding
  review_amendment: { source_digest: string; adopted_digest: string }
  parent_receipts: { phase_zero: ArtifactBinding; post_integration_v2: ArtifactBinding }
  artifact_digests: Record<string, string>
  disabled_capabilities: string[]
  next_planning_entry_conditions: string[]
  next_implementation_entry_conditions: string[]
  receipt_digest: string
}

export function buildReceiptValue(options: {
  generatedAt?: string
  artifactCommit: string
  reviewedHeads: ReceiptValue['reviewed_heads']
  parentReceipts: ReceiptValue['parent_receipts']
  artifactDigests: Record<string, string>
  reviewAmendment?: ReceiptValue['review_amendment']
}): ReceiptValue {
  const unsigned = {
    schema_version: 1 as const,
    receipt_kind: 'governance_amendment_successor_receipt' as const,
    generated_at: new Date(options.generatedAt ?? new Date().toISOString()).toISOString(),
    artifact_commit: options.artifactCommit,
    reviewed_heads: options.reviewedHeads,
    shared_contract: { path: SHARED_CONTRACT_PATH, digest: SHARED_CONTRACT_DIGEST },
    review_amendment: options.reviewAmendment ?? { source_digest: TASK_0B_REVIEW_SOURCE_DIGEST, adopted_digest: ADOPTED_AMENDMENT_BINDING.digest },
    parent_receipts: options.parentReceipts,
    artifact_digests: Object.fromEntries(Object.entries(options.artifactDigests).sort(([left], [right]) => left.localeCompare(right))),
    disabled_capabilities: [...DISABLED_CAPABILITIES],
    next_planning_entry_conditions: [...NEXT_PLANNING_ENTRY_CONDITIONS],
    next_implementation_entry_conditions: [...NEXT_IMPLEMENTATION_ENTRY_CONDITIONS],
  }
  return { ...unsigned, receipt_digest: sha256(canonicalJson(unsigned)) }
}

export function validateReceiptValue(value: unknown): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  try { assertSafeArtifact(value) } catch (error) { add(errors, (error as Error & { code?: string }).code ?? 'unsafe_artifact', '$', (error as Error).message) }
  if (!exactKeys(value, RECEIPT_FIELDS, '$', errors)) return result(errors)
  if (value.schema_version !== 1 || value.receipt_kind !== 'governance_amendment_successor_receipt' || !validUtcTimestamp(value.generated_at) || !/^[0-9a-f]{40,64}$/.test(String(value.artifact_commit))) add(errors, 'invalid_receipt', '$', 'receipt header is invalid')
  if (!isObject(value.reviewed_heads) || !exactKeys(value.reviewed_heads, ['cc_gateway', 'sub2api'], '$.reviewed_heads', errors) || !Object.values(value.reviewed_heads).every((head) => /^[0-9a-f]{40,64}$/.test(String(head)))) add(errors, 'invalid_reviewed_heads', '$.reviewed_heads', 'reviewed heads are invalid')
  if (!validArtifact(value.shared_contract) || value.shared_contract.path !== SHARED_CONTRACT_PATH || value.shared_contract.digest !== SHARED_CONTRACT_DIGEST) add(errors, 'contract_drift', '$.shared_contract', 'shared contract binding drifted')
  if (!isObject(value.review_amendment) || !exactKeys(value.review_amendment, ['source_digest', 'adopted_digest'], '$.review_amendment', errors)
    || !same(value.review_amendment, { source_digest: TASK_0B_REVIEW_SOURCE_DIGEST, adopted_digest: ADOPTED_AMENDMENT_BINDING.digest })) add(errors, 'invalid_review_amendment', '$.review_amendment', 'review amendment digests do not bind the fixed reviewed pair')
  if (!isObject(value.parent_receipts) || !exactKeys(value.parent_receipts, ['phase_zero', 'post_integration_v2'], '$.parent_receipts', errors) || !Object.values(value.parent_receipts).every(validArtifact)) add(errors, 'invalid_parent_receipts', '$.parent_receipts', 'both parent receipt bindings are required')
  if (!isObject(value.artifact_digests) || Object.keys(value.artifact_digests).length < 8 || Object.entries(value.artifact_digests).some(([artifactPath, digest]) => !normalizedRepositoryPath(artifactPath) || !DIGEST_RE.test(String(digest)))) add(errors, 'invalid_artifact_digests', '$.artifact_digests', 'artifact digests are invalid')
  if (!same(value.disabled_capabilities, DISABLED_CAPABILITIES)) add(errors, 'disabled_capability_drift', '$.disabled_capabilities', 'deferred capabilities must remain disabled')
  if (!same(value.next_planning_entry_conditions, NEXT_PLANNING_ENTRY_CONDITIONS) || !same(value.next_implementation_entry_conditions, NEXT_IMPLEMENTATION_ENTRY_CONDITIONS)) add(errors, 'next_entry_condition_drift', '$', 'P1 entry conditions drifted')
  if (value.receipt_digest !== digestUnsigned(value, 'receipt_digest')) add(errors, 'receipt_digest_mismatch', '$.receipt_digest', 'receipt digest mismatch')
  return result(errors)
}

export function writeExclusiveArtifact(file: string, value: unknown, evidenceRoot = path.resolve('docs/superpowers/evidence')): void {
  assertSafeArtifact(value)
  assertArtifactOutputPath(file, evidenceRoot)
  try { lstatSync(file); fail('artifact_exists', 'artifact output already exists') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const payload = `${canonicalJson(value)}\n`
  const temp = `${file}.tmp-${process.pid}-${createHash('sha256').update(`${file}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16)}`
  let fd: number | undefined
  try {
    fd = openSync(temp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), 0o600)
    writeFileSync(fd, payload)
    closeSync(fd); fd = undefined
    linkSync(temp, file)
    unlinkSync(temp)
  } catch (error) {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(temp) } catch { /* best effort removal of this invocation's temp */ }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('artifact_exists', 'artifact output already exists')
    throw error
  }
}

function assertArtifactOutputPath(file: string, evidenceRoot: string): void {
  const lexicalRoot = path.resolve(evidenceRoot)
  const lexicalFile = path.resolve(file)
  const rootReal = realpathSync(lexicalRoot)
  const parentReal = realpathSync(path.dirname(lexicalFile))
  const relative = path.relative(rootReal, path.join(parentReal, path.basename(lexicalFile)))
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) fail('artifact_path_escape', 'artifact output escapes the evidence root')
  const lexicalRelative = path.relative(lexicalRoot, lexicalFile)
  if (lexicalRelative.startsWith('..') || path.isAbsolute(lexicalRelative)) fail('artifact_path_escape', 'artifact output escapes the evidence root')
  let cursor = lexicalRoot
  for (const segment of lexicalRelative.split(path.sep).slice(0, -1)) {
    cursor = path.join(cursor, segment)
    if (lstatSync(cursor).isSymbolicLink()) fail('artifact_symlink', 'artifact output traverses a symlink')
  }
  try { if (lstatSync(lexicalFile).isSymbolicLink()) fail('artifact_symlink', 'artifact output is a symlink') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

const BOUNDED_PROCESS_HELPER = String.raw`
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const options = JSON.parse(process.argv[1]);
const max = options.maxOutputBytes;
const started = Date.now();
const child = spawn(options.argv[0], options.argv.slice(1), { cwd: options.cwd, env: options.env, detached: process.platform !== 'win32', shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
const stdoutHash = createHash('sha256'); const stderrHash = createHash('sha256');
const unsafeOutputPattern = /(?:ORACLE[_-]?SECRET[_-]?CANARY|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{8,4096}|\bBearer\s+[A-Za-z0-9._~+\/-]{4,4096}|\b(?:Cookie|Set-Cookie|Authorization)\s*:|\b(?:TOKEN|SECRET|API_KEY)\s*[:=]\s*[^\s"']{1,4096}|https?:\/\/[^\s/]{1,4096}@)/i;
let retained = Buffer.alloc(0), total = 0, overflow = false, timedOut = false, terminating = false, forceTimer, closeState, forceKillDone = false, emitted = false, infrastructureFailure = false, unsafeOutputDetected = false;
const scanCarry = { stdout: '', stderr: '' };
const failureNames = new Set();
function scan(stream, chunk) {
  const text = scanCarry[stream] + chunk.toString('utf8');
  infrastructureFailure ||= /(?:go: downloading|module lookup disabled|GOPROXY=off|toolchain.*(?:unavailable|download)|npm ERR|command not found|ENOENT|network is unreachable)/i.test(text);
  unsafeOutputDetected ||= unsafeOutputPattern.test(text);
  for (const pattern of [/--- FAIL: ([A-Za-z0-9_./-]+)/g, /\u2716\s+([^\r\n]{1,200})/g, /([A-Za-z0-9_.-]+\.red\.test\.(?:ts|go))/g]) {
    for (const match of text.matchAll(pattern)) if (failureNames.size < 128) failureNames.add(match[1]);
  }
  scanCarry[stream] = text.slice(-8192);
}
function redact(text) {
  return text.replace(new RegExp(unsafeOutputPattern.source, 'ig'), '[REDACTED]');
}
function emit() {
  if (emitted || !closeState || (terminating && !forceKillDone)) return; emitted = true;
  process.stdout.write(JSON.stringify({ exitCode: closeState.code === null ? 128 : closeState.code, signal: closeState.signal, durationMs: Date.now() - started, stdoutDigest: 'sha256:' + stdoutHash.digest('hex'), stderrDigest: 'sha256:' + stderrHash.digest('hex'), outputBytes: total, outputExcerpt: unsafeOutputDetected ? '[REDACTED]' : redact(retained.toString('utf8')).slice(0, 2048), outputOverflow: overflow, timedOut, failureNames: unsafeOutputDetected ? [] : [...failureNames].sort(), infrastructureFailure, unsafeOutputDetected }));
}
function terminate(reason) {
  if (terminating) return; terminating = true;
  if (reason === 'overflow') overflow = true; if (reason === 'timeout') timedOut = true;
  try { process.platform === 'win32' ? child.kill('SIGTERM') : process.kill(-child.pid, 'SIGTERM'); } catch {}
  forceTimer = setTimeout(() => {
    try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {}
    forceKillDone = true; setTimeout(emit, 50);
  }, 250);
}
function consume(stream, hash, chunk) { hash.update(chunk); scan(stream, chunk); total += chunk.length; if (retained.length < max) retained = Buffer.concat([retained, chunk.subarray(0, max - retained.length)]); if (total > max) terminate('overflow'); }
child.stdout.on('data', chunk => consume('stdout', stdoutHash, chunk)); child.stderr.on('data', chunk => consume('stderr', stderrHash, chunk));
const timeout = setTimeout(() => terminate('timeout'), options.timeoutMs);
child.on('error', error => { clearTimeout(timeout); if (forceTimer) clearTimeout(forceTimer); emitted = true; process.stdout.write(JSON.stringify({ helperError: error.message })); });
child.on('close', (code, signal) => { clearTimeout(timeout); closeState = { code, signal }; emit(); });
`

export type BoundedProcessResult = {
  exitCode: number
  signal: string | null
  durationMs: number
  stdoutDigest: string
  stderrDigest: string
  outputBytes: number
  outputExcerpt: string
  outputOverflow: boolean
  timedOut: boolean
  failureNames: string[]
  infrastructureFailure: boolean
  unsafeOutputDetected: boolean
}

export function runBoundedProcess(options: { argv: string[]; cwd: string; env: Record<string, string>; timeoutMs: number; maxOutputBytes?: number }): BoundedProcessResult {
  if (!Array.isArray(options.argv) || options.argv.length === 0 || options.argv.some((part) => typeof part !== 'string' || part.length === 0)) fail('invalid_argv', 'argv must be a nonempty string array')
  const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > MAX_OUTPUT_BYTES) fail('invalid_output_bound', 'output bound must be within 8 MiB')
  const helper = spawnSync(process.execPath, ['-e', BOUNDED_PROCESS_HELPER, JSON.stringify({ ...options, maxOutputBytes })], {
    encoding: 'utf8',
    timeout: options.timeoutMs + 5_000,
    maxBuffer: 1024 * 1024,
    shell: false,
    env: { PATH: process.env.PATH ?? '' },
  })
  if (helper.error || helper.status !== 0) fail('bounded_runner_failed', helper.error?.message ?? helper.stderr ?? 'bounded process helper failed')
  let parsed: BoundedProcessResult & { helperError?: string }
  try { parsed = JSON.parse(helper.stdout) as BoundedProcessResult & { helperError?: string } } catch { fail('bounded_runner_failed', 'bounded process helper returned invalid output') }
  if (parsed.helperError) fail('child_spawn_failed', parsed.helperError)
  if (parsed.unsafeOutputDetected) parsed.failureNames = []
  return parsed
}

type CliRuntime = Readonly<{
  repositoryRoot: string
  runBoundedProcess: typeof runBoundedProcess
  inspectCodeGraphIndex: typeof inspectCodeGraphIndex
  writeStdout: (value: string) => void
}>

const PRODUCTION_CLI_RUNTIME: CliRuntime = Object.freeze({
  repositoryRoot: REPOSITORY_ROOT,
  runBoundedProcess,
  inspectCodeGraphIndex: (root: string) => inspectCodeGraphIndex(root, REVIEWED_CODEGRAPH_EXECUTABLE, minimalToolEnvironment(), codeGraphReadBudget()),
  writeStdout: (value: string) => process.stdout.write(value),
})

export function classifyBoundedProcess(observed: BoundedProcessResult, expectedExit: 0 | 'nonzero'): 'pass' | 'expected_fail' | 'unexpected_fail' | 'unexpected_pass' {
  if (observed.timedOut || observed.outputOverflow || observed.infrastructureFailure || observed.unsafeOutputDetected) return 'unexpected_fail'
  return classifyExit(observed.exitCode, expectedExit)
}

function parseCommandArgs(tokens: string[], allowed: readonly string[]): ReturnType<typeof parseArgs> {
  const parsed = parseArgs(tokens)
  if (parsed.positionals.length > 0) fail('invalid_arguments', `unexpected positional arguments: ${parsed.positionals.join(',')}`)
  for (const name of Object.keys(parsed.values)) if (!allowed.includes(name)) fail('invalid_arguments', `--${name} is not accepted by this subcommand`)
  return parsed
}

export function parseCliInvocation(tokens: string[]): { command: (typeof SUPPORTED_SUBCOMMANDS)[number]; args: ReturnType<typeof parseArgs> } {
  const [commandInput, ...argumentTokens] = tokens
  if (!SUPPORTED_SUBCOMMANDS.includes(commandInput as (typeof SUPPORTED_SUBCOMMANDS)[number])) fail('invalid_arguments', `unsupported P0.1 subcommand: ${commandInput ?? ''}`)
  const command = commandInput as (typeof SUPPORTED_SUBCOMMANDS)[number]
  const args = parseCommandArgs(argumentTokens, CLI_ARGUMENTS[command])
  for (const name of CLI_ARGUMENTS[command]) if (!(command === 'validate-receipt' && name === 'receipt-commit')) one(args, name)
  return { command, args }
}

function exactArgumentPath(root: string, input: string, expected: string): string {
  const relative = relativeArtifact(root, input)
  if (relative !== expected) fail('artifact_path_mismatch', `expected ${expected}, received ${relative}`)
  return path.join(root, relative)
}

function loadManifest(root: string, input: string): { value: ExitValue; path: string; binding: ArtifactBinding } {
  const file = exactArgumentPath(root, input, ARTIFACT_CHAIN.exit)
  const observed = readJsonArtifactAt<ExitValue>(root, ARTIFACT_CHAIN.exit)
  const value = observed.value
  requireValidation(validateExitValue(value))
  validateAgainstSchema(root, SCHEMA_PATHS.exit_schema, value)
  return { value, path: file, binding: observed.binding }
}

function allowedBindings(root: string, names: Array<keyof typeof ARTIFACT_CHAIN>): ArtifactBinding[] {
  return names.map((name) => bindingAt(root, ARTIFACT_CHAIN[name]))
}

function assertStageState(root: string, names: Array<keyof typeof ARTIFACT_CHAIN>): ArtifactBinding[] {
  const bindings = allowedBindings(root, names)
  captureRepositorySnapshot(root, bindings)
  return bindings
}

function assertManifestHeads(manifest: ExitValue, ccRoot: string, subRoot: string): void {
  if (gitText(ccRoot, 'rev-parse', 'HEAD') !== manifest.repositories.cc_gateway.head) fail('wrong_repository_head', 'CC Gateway HEAD differs from exit manifest')
  if (gitText(subRoot, 'rev-parse', 'HEAD') !== manifest.repositories.sub2api.head) fail('wrong_repository_head', 'Sub2API HEAD differs from exit manifest')
}

function validateCatalogAt(root: string, fileInput: string, manifest: ExitValue): { value: Array<Record<string, unknown>>; binding: ArtifactBinding } {
  const relative = relativeArtifact(root, fileInput)
  if (relative !== COMMAND_CATALOG_PATH) fail('catalog_path_mismatch', 'catalog is not the reviewed command catalog')
  const observed = readJsonArtifactAt<Array<Record<string, unknown>>>(root, relative)
  const binding = observed.binding
  if (binding.digest !== manifest.capture_inputs.command_catalog.digest) fail('catalog_digest_mismatch', 'catalog bytes differ from the exit binding')
  const value = observed.value
  requireValidation(validateCommandCatalogValue(value))
  validateAgainstSchema(root, SCHEMA_PATHS.catalog_schema, value)
  return { value, binding }
}

function expandCatalogString(value: string, roots: { CC_GATEWAY_ROOT: string; SUB2API_ROOT: string }): string {
  const expanded = value.replace(/\$\{(CC_GATEWAY_ROOT|SUB2API_ROOT)\}/g, (_match, name: keyof typeof roots) => roots[name])
  if (/\$\{[^}]+\}/.test(expanded)) fail('undeclared_expansion', `${value} contains an undeclared expansion`)
  return expanded
}

function childEnvironment(entry: Record<string, unknown>, roots: { CC_GATEWAY_ROOT: string; SUB2API_ROOT: string }): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const name of entry.inherit_env as string[]) {
    const inherited = process.env[name]
    if (inherited !== undefined) environment[name] = inherited
  }
  if (!environment.PATH) fail('missing_tool_path', 'PATH is required to locate the cached local toolchain')
  for (const [name, value] of Object.entries(entry.env as Record<string, string>)) environment[name] = expandCatalogString(value, roots)
  return environment
}

function failureNames(excerpt: string): string[] {
  const names = new Set<string>()
  for (const line of excerpt.split(/\r?\n/)) {
    const go = /--- FAIL: ([A-Za-z0-9_./-]+)/.exec(line)
    if (go) names.add(go[1])
    for (const match of line.matchAll(/([A-Za-z0-9_.-]+\.red\.test\.(?:ts|go))/g)) names.add(match[1])
    const assertion = /AssertionError(?: \[[^\]]+\])?:\s*([^\r\n]{1,160})/.exec(line)
    if (assertion && !/(?:Bearer|Authorization|Cookie|\/Users\/|\/home\/|\/tmp\/)/i.test(assertion[1])) names.add(assertion[1].replace(/[^A-Za-z0-9 _.:()/-]/g, '').slice(0, 160))
  }
  return [...names].filter(Boolean).sort().slice(0, 64)
}

function infrastructureFailure(excerpt: string): boolean {
  return /(?:go: downloading|module lookup disabled|GOPROXY=off|toolchain.*(?:unavailable|download)|npm ERR|command not found|ENOENT|network is unreachable)/i.test(excerpt)
}

function buildResultRecord(
  entry: Record<string, unknown>,
  manifest: ExitValue,
  manifestDigest: string,
  observed: BoundedProcessResult,
  argv: string[],
  environment: Record<string, string>,
  ccTransition: RepositorySnapshotTransition,
  subTransition: RepositorySnapshotTransition,
  ignoredOutputObservations: IgnoredOutputObservation[],
): ResultRecord {
  const expected = entry.expected_exit as 0 | 'nonzero'
  const names = observed.unsafeOutputDetected
    ? []
    : [...new Set([...observed.failureNames, ...failureNames(observed.outputExcerpt)])].filter((name) => /^[A-Za-z0-9 _.:()/-]{1,256}$/.test(name)).sort().slice(0, 64)
  const infra = observed.infrastructureFailure || infrastructureFailure(observed.outputExcerpt)
  let status = classifyBoundedProcess({ ...observed, infrastructureFailure: infra }, expected)
  const expectedFamilies = EXPECTED_RED_FAILURE_FAMILIES[String(entry.id)]
  if (status === 'expected_fail' && (names.length === 0 || (expectedFamilies && expectedFamilies.some((pattern) => !names.some((name) => pattern.test(name)))))) status = 'unexpected_fail'
  const unsigned = {
    command_id: String(entry.id),
    repository: entry.repository as ResultRecord['repository'],
    repository_commit: entry.repository === 'sub2api' ? manifest.repositories.sub2api.head : manifest.repositories.cc_gateway.head,
    expected_exit: expected,
    exit_code: observed.exitCode,
    status,
    duration_ms: observed.durationMs,
    stdout_digest: observed.stdoutDigest,
    stderr_digest: observed.stderrDigest,
    output_bytes: observed.outputBytes,
    timed_out: observed.timedOut,
    output_overflow: observed.outputOverflow,
    failure_names: names,
    manifest_digest: manifestDigest,
    catalog_entry_digest: catalogEntryDigest(entry),
    argv_digest: sha256(canonicalJson(argv)),
    environment_digest: sha256(canonicalJson(environment)),
    execution_bindings: buildExecutionBindings(entry.bindings, {
      cc_gateway_head: manifest.repositories.cc_gateway.head,
      sub2api_head: manifest.repositories.sub2api.head,
      cc_gateway_before_snapshot: ccTransition.before_snapshot_digest,
      cc_gateway_after_snapshot: ccTransition.after_snapshot_digest,
      sub2api_before_snapshot: subTransition.before_snapshot_digest,
      sub2api_after_snapshot: subTransition.after_snapshot_digest,
      shared_contract_digest: manifest.shared_contract.digest,
    }),
    ignored_output_observations: ignoredOutputObservations,
  }
  return { ...unsigned, result_digest: sha256(canonicalJson(unsigned)) }
}

function commandCaptureExit(args: ReturnType<typeof parseArgs>, runtime: CliRuntime): void {
  const ccRoot = realpathSync(String(one(args, 'cc-gateway-root'))); const subRoot = realpathSync(String(one(args, 'sub2api-root')))
  const out = exactArgumentPath(ccRoot, String(one(args, 'out')), ARTIFACT_CHAIN.exit)
  assertChainStateAbsent(ccRoot)
  const entryRelative = relativeArtifact(ccRoot, String(one(args, 'entry'))); const receiptRelative = relativeArtifact(ccRoot, String(one(args, 'entry-receipt')))
  if (entryRelative !== ENTRY_PATH || receiptRelative !== ENTRY_RECEIPT_PATH) fail('entry_path_mismatch', 'capture requires the immutable P0.1 entry pair')
  const entryObserved = readJsonArtifactAt<GovernanceAmendmentEntry>(ccRoot, entryRelative)
  const receiptObserved = readJsonArtifactAt<GovernanceAmendmentEntryReceipt>(ccRoot, receiptRelative)
  const entry = entryObserved.value; const entryReceipt = receiptObserved.value
  validateGovernanceAmendmentEntryPair(entry, entryReceipt)
  if (!same(entryObserved.binding, IMMUTABLE_ENTRY_BINDINGS.entry) || !same(receiptObserved.binding, IMMUTABLE_ENTRY_BINDINGS.receipt)
    || committedDigest(ccRoot, ENTRY_CAPTURE_COMMIT, entryRelative) !== IMMUTABLE_ENTRY_BINDINGS.entry.digest
    || committedDigest(ccRoot, ENTRY_CAPTURE_COMMIT, receiptRelative) !== IMMUTABLE_ENTRY_BINDINGS.receipt.digest
    || !isAncestor(ccRoot, ENTRY_CAPTURE_COMMIT, gitText(ccRoot, 'rev-parse', 'HEAD'))) fail('changed_entry_baseline', 'P0.1 entry pair differs from immutable Task 0B bytes')
  const reviews = validateReviewArtifacts({ ccRoot, subRoot })
  const ccSnapshot = captureRepositorySnapshot(ccRoot); const subSnapshot = captureRepositorySnapshot(subRoot)
  if (ccSnapshot.branch !== 'codex/oracle-p0-1-governance' || subSnapshot.branch !== 'codex/oracle-p0-1-governance') fail('wrong_repository_branch', 'both repositories must be on the reviewed P0.1 branch')
  if (ccSnapshot.head !== reviews.approvalHead || subSnapshot.head !== reviews.expected.heads.sub2api) fail('review_head_mismatch', 'capture heads differ from approved heads')
  const contract = bindingAt(subRoot, SHARED_CONTRACT_PATH)
  if (contract.digest !== SHARED_CONTRACT_DIGEST) fail('contract_drift', 'shared contract digest drifted')
  const value = buildExitValue({
    generated_at: new Date().toISOString(),
    entry: entryObserved.binding,
    entry_receipt: receiptObserved.binding,
    repositories: {
      cc_gateway: { head: ccSnapshot.head, branch: ccSnapshot.branch, clean: true, snapshot_digest: ccSnapshot.snapshot_digest, initial_ignored_inventory: ccSnapshot.ignored_inventory },
      sub2api: { head: subSnapshot.head, branch: subSnapshot.branch, clean: true, snapshot_digest: subSnapshot.snapshot_digest, initial_ignored_inventory: subSnapshot.ignored_inventory },
    },
    reviewed_candidate_heads: reviews.expected.heads,
    candidate_commit_identities: reviews.expected.candidateCommitIdentities,
    approval_attestation_head: reviews.approvalHead,
    shared_contract: contract,
    parent_receipts: { phase_zero: entry.parent_receipts.phase_zero, post_integration_v2: entry.parent_receipts.post_integration_v2 },
    governance: bindingsAt(ccRoot, GOVERNANCE_PATHS),
    capture_inputs: bindingsAt(ccRoot, CAPTURE_INPUT_PATHS),
    codegraph: { cc_gateway: runtime.inspectCodeGraphIndex(ccRoot), sub2api: runtime.inspectCodeGraphIndex(subRoot) },
  })
  requireValidation(validateExitValue(value)); validateAgainstSchema(ccRoot, SCHEMA_PATHS.exit_schema, value)
  writeExclusiveArtifact(out, value, path.join(ccRoot, EVIDENCE_ROOT_RELATIVE))
  initializeArtifactChain(ccRoot, subRoot, manifestInitialIgnoredInventories(value))
}

function commandRun(args: ReturnType<typeof parseArgs>, runtime: CliRuntime): void {
  const ccRoot = realpathSync(String(one(args, 'cc-gateway-root'))); const subRoot = realpathSync(String(one(args, 'sub2api-root')))
  const manifestLoaded = loadManifest(ccRoot, String(one(args, 'manifest'))); const group = String(one(args, 'group'))
  if (group !== 'green' && group !== 'red') fail('invalid_result_group', '--group must be green or red')
  const outputName = group as 'green' | 'red'; const out = exactArgumentPath(ccRoot, String(one(args, 'out')), ARTIFACT_CHAIN[outputName])
  const catalog = validateCatalogAt(ccRoot, String(one(args, 'catalog')), manifestLoaded.value)
  assertManifestHeads(manifestLoaded.value, ccRoot, subRoot)
  const prepared = prepareArtifactChainStagePrior(ccRoot, outputName, { cc_gateway: ccRoot, sub2api: subRoot })
  const initialIgnored = ignoredInventoriesFromSnapshots(prepared.cc, prepared.sub)
  if (group === 'green' && !same(initialIgnored, manifestInitialIgnoredInventories(manifestLoaded.value))) fail('repository_mutation', 'GREEN initial ignored state differs from exit evidence')
  if (group === 'red') {
    const priorGreen = readJsonAt<ResultSet>(ccRoot, ARTIFACT_CHAIN.green)
    requireValidation(validateResultSetValue(priorGreen)); if (priorGreen.group !== 'green' || priorGreen.manifest_digest !== manifestLoaded.binding.digest) fail('cross_manifest_results', 'prior GREEN result differs from the manifest')
    if (!same(initialIgnored, priorGreen.terminal_ignored_inventories)) fail('repository_mutation', 'RED initial ignored state differs from GREEN terminal evidence')
  }
  const { prior } = prepared
  let currentCc = prepared.cc
  let currentSub = prepared.sub
  const roots = { CC_GATEWAY_ROOT: ccRoot, SUB2API_ROOT: subRoot }
  const records: ResultRecord[] = []
  for (const entry of catalog.value.filter((candidate) => candidate.group === group)) {
    const policy = entry.ignored_output_policy as IgnoredOutputPolicy
    const beforeCc = rebindRepositorySnapshotPolicy(currentCc, 'none')
    const beforeSub = rebindRepositorySnapshotPolicy(currentSub, policy)
    const cwd = expandCatalogString(String(entry.cwd), roots)
    const argv = (entry.argv as string[]).map((part) => expandCatalogString(part, roots)); const environment = childEnvironment(entry, roots)
    const commandStartedAt = new Date()
    const observed = runtime.runBoundedProcess({ argv, cwd, env: environment, timeoutMs: Number(entry.timeout_ms), maxOutputBytes: Number(entry.max_output_bytes) })
    const commandFinishedAt = new Date()
    let afterCc: RepositorySnapshot
    let afterSub: RepositorySnapshot
    let ccTransition: RepositorySnapshotTransition
    let subTransition: RepositorySnapshotTransition
    try {
      afterCc = captureRepositorySnapshot(ccRoot, prior, 'none')
      afterSub = captureRepositorySnapshot(subRoot, [], policy)
      ccTransition = compareRepositorySnapshots(beforeCc, afterCc, 'none', commandStartedAt, commandFinishedAt)
      subTransition = compareRepositorySnapshots(beforeSub, afterSub, policy, commandStartedAt, commandFinishedAt)
    } catch { fail('repository_mutation', 'repository state changed across the child command') }
    const ignoredOutputObservations: IgnoredOutputObservation[] = subTransition.ignored_output_observation
      ? [{ repository: 'sub2api', ...subTransition.ignored_output_observation }]
      : []
    records.push(buildResultRecord(entry, manifestLoaded.value, manifestLoaded.binding.digest, observed, argv, environment, ccTransition, subTransition, ignoredOutputObservations))
    currentCc = afterCc
    currentSub = afterSub
  }
  const terminalIgnored = ignoredInventoriesFromSnapshots(currentCc, currentSub)
  const value = buildResultSet({
    generatedAt: new Date().toISOString(),
    manifest_digest: manifestLoaded.binding.digest,
    catalog_digest: catalog.binding.digest,
    group,
    initial_ignored_inventories: initialIgnored,
    terminal_ignored_inventories: terminalIgnored,
    records,
  })
  requireValidation(validateResultSetValue(value, Date.parse(value.generated_at))); requireValidation(validateResultSetBindings(value, catalog.value, manifestLoaded.value, manifestLoaded.binding.digest, catalog.binding.digest)); validateAgainstSchema(ccRoot, SCHEMA_PATHS.results_schema, value)
  if (value.records.some((record) => !['pass', 'expected_fail'].includes(record.status))) fail('unexpected_classification', 'command group contains an unexpected result')
  writeExclusiveArtifact(out, value, path.join(ccRoot, EVIDENCE_ROOT_RELATIVE))
  completeArtifactChainStage(ccRoot, outputName, terminalIgnored)
}

function commandMerge(args: ReturnType<typeof parseArgs>, root: string): void {
  const manifest = loadManifest(root, String(one(args, 'manifest')))
  exactArgumentPath(root, String(one(args, 'green')), ARTIFACT_CHAIN.green); exactArgumentPath(root, String(one(args, 'red')), ARTIFACT_CHAIN.red)
  const out = exactArgumentPath(root, String(one(args, 'out')), ARTIFACT_CHAIN.results)
  prepareArtifactChainStage(root, 'results')
  const green = readJsonAt<ResultSet>(root, ARTIFACT_CHAIN.green); const red = readJsonAt<ResultSet>(root, ARTIFACT_CHAIN.red)
  if (green.manifest_digest !== manifest.binding.digest || red.manifest_digest !== manifest.binding.digest) fail('cross_manifest_results', 'result set does not bind the named manifest')
  const catalog = validateCatalogAt(root, path.join(root, COMMAND_CATALOG_PATH), manifest.value)
  requireValidation(validateResultSetBindings(green, catalog.value, manifest.value, manifest.binding.digest, catalog.binding.digest)); requireValidation(validateResultSetBindings(red, catalog.value, manifest.value, manifest.binding.digest, catalog.binding.digest))
  validateIgnoredEvidenceContinuity(manifest.value, green, red)
  const value = mergeResultSets(green, red, green.generated_at)
  validateIgnoredEvidenceContinuity(manifest.value, green, red, value)
  validateMergedResultSetConsistency(green, red, value)
  requireValidation(validateResultSetValue(value, Date.parse(value.generated_at))); validateAgainstSchema(root, SCHEMA_PATHS.results_schema, value)
  writeExclusiveArtifact(out, value, path.join(root, EVIDENCE_ROOT_RELATIVE))
  completeArtifactChainStage(root, 'results')
}

function validateReviewsForManifest(root: string, manifest: ExitValue, requirementsInput: string, securityInput: string, schemaCommit = gitText(root, 'rev-parse', 'HEAD')): { requirements: Record<string, unknown>; security: Record<string, unknown> } {
  const requirementsRelative = relativeArtifact(root, requirementsInput); const securityRelative = relativeArtifact(root, securityInput)
  if (requirementsRelative !== REQUIREMENTS_REVIEW_PATH || securityRelative !== SECURITY_REVIEW_PATH) fail('review_path_mismatch', 'review paths differ from the fixed attestations')
  const requirementsObserved = readJsonArtifactAt<Record<string, unknown>>(root, requirementsRelative)
  const securityObserved = readJsonArtifactAt<Record<string, unknown>>(root, securityRelative)
  const reviewImportObserved = readJsonArtifactAt(root, REVIEW_IMPORT_PATH)
  const requirementsBinding = requirementsObserved.binding; const securityBinding = securityObserved.binding
  if (!same(requirementsBinding, manifest.governance.requirements_review) || !same(securityBinding, manifest.governance.security_review)) fail('review_digest_mismatch', 'review bytes differ from the exit manifest')
  const requirements = requirementsObserved.value; const security = securityObserved.value
  const reviewImport = reviewImportObserved.value
  validateReviewEvidenceSchemas({ root, requirements, security, reviewImport, schemaCommit })
  if (!same(reviewImportObserved.binding, manifest.governance.review_import) || !same(manifest.governance.amendment, ADOPTED_AMENDMENT_BINDING)) fail('review_import_binding_mismatch', 'manifest review amendment bindings are not the fixed reviewed pair')
  const diffs = isObject(requirements.diff_digests) ? requirements.diff_digests as ReviewExpected['diffs'] : { cc_gateway: '', sub2api: '' }
  requireValidation(validateReviewPair(requirements, security, {
    heads: manifest.reviewed_candidate_heads,
    diffs,
    planDigest: manifest.governance.plan.digest,
    reviewImportDigest: manifest.governance.review_import.digest,
    candidateCommitIdentities: manifest.candidate_commit_identities,
  }))
  return { requirements, security }
}

function writeExclusiveTextArtifact(file: string, text: string, evidenceRoot: string): void {
  assertSafeArtifact(text)
  assertArtifactOutputPath(file, evidenceRoot)
  try { lstatSync(file); fail('artifact_exists', 'artifact output already exists') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const temp = `${file}.tmp-${process.pid}-${createHash('sha256').update(`${file}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16)}`
  let fd: number | undefined
  try {
    fd = openSync(temp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), 0o600)
    writeFileSync(fd, text); closeSync(fd); fd = undefined; linkSync(temp, file); unlinkSync(temp)
  } catch (error) {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(temp) } catch { /* best effort removal of this invocation's temp */ }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('artifact_exists', 'artifact output already exists')
    throw error
  }
}

export type ArtifactPairPublicationBoundary = 'after_json_published' | 'after_markdown_published'
export type ReportPairTransactionBoundary = ArtifactPairPublicationBoundary | 'before_chain_transition'

export function writeExclusiveArtifactPair(
  jsonPath: string,
  jsonValue: unknown,
  textPath: string,
  textValue: string,
  evidenceRoot: string,
  onBoundary?: (boundary: ArtifactPairPublicationBoundary) => void,
): void {
  assertSafeArtifact(jsonValue); assertSafeArtifact(textValue)
  for (const file of [jsonPath, textPath]) {
    assertArtifactOutputPath(file, evidenceRoot)
    try { lstatSync(file); fail('artifact_exists', 'paired artifact output already exists') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  writeExclusiveArtifact(jsonPath, jsonValue, evidenceRoot)
  onBoundary?.('after_json_published')
  writeExclusiveTextArtifact(textPath, textValue, evidenceRoot)
  onBoundary?.('after_markdown_published')
}

type ReportPairStage = 'report' | 'controller_report'

function reportPairNames(stage: ReportPairStage): readonly [ArtifactName, ArtifactName] {
  return stage === 'report' ? ['report', 'report_markdown'] : ['controller_report', 'controller_report_markdown']
}

function readVerifiedReportPair(root: string, stage: ReportPairStage): ReportValue {
  const [jsonName, markdownName] = reportPairNames(stage)
  const value = readJsonAt<ReportValue>(root, ARTIFACT_CHAIN[jsonName])
  requireValidation(validateReportPair(value, readTextAt(root, ARTIFACT_CHAIN[markdownName])))
  validateAgainstSchema(root, SCHEMA_PATHS.report_schema, value)
  const expectedType = stage === 'report' ? 'exit' : 'controller'
  if (value.report_type !== expectedType) fail('report_type_mismatch', 'report discriminator differs from its fixed path')
  return value
}

export function assertAcceptedReportPair(rootInput: string, stage: ReportPairStage): ReportValue {
  const root = realpathSync(rootInput)
  let value: ReportValue
  try { value = readVerifiedReportPair(root, stage) } catch (error) {
    if ((error as Error & { code?: string }).code === 'missing_artifact') fail('incomplete_report_transaction', 'report pair is incomplete and was not transactionally accepted')
    throw error
  }
  const expected = stageBindings(root, reportPairNames(stage))
  const state = verifiedChainState(root)
  for (const binding of expected) {
    if (!state.artifacts.some((candidate) => same(candidate, binding))) fail('incomplete_report_transaction', 'report pair is not bound by the accepted chain state')
  }
  assertCurrentChainContinuity(root)
  return value
}

export function writeReportPairTransaction(
  rootInput: string,
  stage: ReportPairStage,
  value: ReportValue,
  onBoundary?: (boundary: ReportPairTransactionBoundary) => void,
): void {
  const root = realpathSync(rootInput)
  const [jsonName, markdownName] = reportPairNames(stage)
  const jsonPath = path.join(root, ARTIFACT_CHAIN[jsonName]); const markdownPath = path.join(root, ARTIFACT_CHAIN[markdownName])
  const evidenceRoot = path.join(root, EVIDENCE_ROOT_RELATIVE); const markdown = renderReportMarkdown(value)
  requireValidation(validateReportPair(value, markdown)); validateAgainstSchema(root, SCHEMA_PATHS.report_schema, value)
  writeExclusiveArtifactPair(jsonPath, value, markdownPath, markdown, evidenceRoot, onBoundary)
  const published = readVerifiedReportPair(root, stage)
  if (!same(published, value)) fail('report_bytes_mismatch', 'published report JSON differs from the validated value')
  onBoundary?.('before_chain_transition')
  completeArtifactChainStage(root, stage)
  assertAcceptedReportPair(root, stage)
}

function commandReviewImport(args: ReturnType<typeof parseArgs>, root: string): void {
  const out = exactArgumentPath(root, String(one(args, 'out')), REVIEW_IMPORT_PATH)
  const value = buildReviewImport({ reviewSource: String(one(args, 'review-source')), adoptedAmendment: String(one(args, 'adopted-amendment')), repositoryRoot: root })
  requireValidation(validateReviewImportValue(value)); validateAgainstCommittedSchema(root, gitText(root, 'rev-parse', 'HEAD'), SCHEMA_PATHS.review_import_schema, value)
  writeExclusiveArtifact(out, value, path.join(root, EVIDENCE_ROOT_RELATIVE))
}

function commandValidateReviewImport(args: ReturnType<typeof parseArgs>, root: string): void {
  const relative = relativeArtifact(root, String(one(args, 'review-import')))
  if (relative !== REVIEW_IMPORT_PATH) fail('review_import_path_mismatch', 'review import path is not fixed')
  const value = readJsonAt(root, relative)
  requireValidation(validateReviewImportBytes(value, String(one(args, 'review-source')), String(one(args, 'adopted-amendment')), root))
  validateAgainstCommittedSchema(root, gitText(root, 'rev-parse', 'HEAD'), SCHEMA_PATHS.review_import_schema, value)
}

function commandValidateReviews(args: ReturnType<typeof parseArgs>): void {
  const ccRoot = realpathSync(String(one(args, 'cc-gateway-root'))); const subRoot = realpathSync(String(one(args, 'sub2api-root')))
  validateReviewArtifacts({
    ccRoot,
    subRoot,
    requirementsPath: String(one(args, 'requirements-review')),
    securityPath: String(one(args, 'security-review')),
    reviewImportPath: String(one(args, 'review-import')),
  })
}

function loadValidatedMergedResultArtifacts(root: string, manifest: { value: ExitValue; binding: ArtifactBinding }, now = Date.now()): ResultSet {
  const green = readJsonAt<ResultSet>(root, ARTIFACT_CHAIN.green)
  const red = readJsonAt<ResultSet>(root, ARTIFACT_CHAIN.red)
  const results = readJsonAt<ResultSet>(root, ARTIFACT_CHAIN.results)
  for (const value of [green, red, results]) requireValidation(validateResultSetValue(value, now))
  const catalog = validateCatalogAt(root, path.join(root, COMMAND_CATALOG_PATH), manifest.value)
  for (const value of [green, red, results]) {
    requireValidation(validateResultSetBindings(value, catalog.value, manifest.value, manifest.binding.digest, catalog.binding.digest))
  }
  validateIgnoredEvidenceContinuity(manifest.value, green, red, results)
  validateMergedResultSetConsistency(green, red, results)
  return results
}

function commandReport(args: ReturnType<typeof parseArgs>, reportType: 'exit' | 'controller', root: string): void {
  const manifest = loadManifest(root, String(one(args, 'manifest')))
  const resultsRelative = relativeArtifact(root, String(one(args, 'results')))
  if (resultsRelative !== ARTIFACT_CHAIN.results) fail('results_path_mismatch', 'merged results path is not fixed')
  const reportKey = reportType === 'exit' ? 'report' : 'controller_report'; const markdownKey = reportType === 'exit' ? 'report_markdown' : 'controller_report_markdown'
  const out = exactArgumentPath(root, String(one(args, 'out')), ARTIFACT_CHAIN[reportKey]); const markdownOut = exactArgumentPath(root, String(one(args, 'markdown')), ARTIFACT_CHAIN[markdownKey])
  const stage = reportType === 'exit' ? 'report' : 'controller_report'
  prepareArtifactChainStage(root, stage)
  const results = loadValidatedMergedResultArtifacts(root, manifest)
  if (results.group !== 'merged' || results.manifest_digest !== manifest.binding.digest || results.records.some((record) => !['pass', 'expected_fail'].includes(record.status))) fail('unexpected_classification', 'report requires accepted merged results')
  if (reportType === 'controller') {
    exactArgumentPath(root, String(one(args, 'report')), ARTIFACT_CHAIN.report); exactArgumentPath(root, String(one(args, 'report-markdown')), ARTIFACT_CHAIN.report_markdown)
    assertAcceptedReportPair(root, 'report')
  }
  const reviews = validateReviewsForManifest(root, manifest.value, String(one(args, 'requirements-review')), String(one(args, 'security-review')))
  const summary = { pass: 0, expected_fail: 0, unexpected_fail: 0, unexpected_pass: 0 }
  for (const record of results.records) summary[record.status] += 1
  const value = buildReportValue({
    reportType,
    generatedAt: results.generated_at,
    status: summary.unexpected_fail === 0 && summary.unexpected_pass === 0 ? 'pass' : 'blocked',
    manifest: manifest.binding,
    results: bindingAt(root, resultsRelative),
    reviews: [
      { role: 'requirements', digest: bindingAt(root, REQUIREMENTS_REVIEW_PATH).digest },
      { role: 'security_quality', digest: bindingAt(root, SECURITY_REVIEW_PATH).digest },
    ],
    commandSummary: summary,
  })
  void reviews
  void out; void markdownOut
  writeReportPairTransaction(root, stage, value)
}

function commandValidateReport(args: ReturnType<typeof parseArgs>, root: string): void {
  const reportRelative = relativeArtifact(root, String(one(args, 'report'))); const markdownRelative = relativeArtifact(root, String(one(args, 'markdown')))
  const validPair = (reportRelative === ARTIFACT_CHAIN.report && markdownRelative === ARTIFACT_CHAIN.report_markdown) || (reportRelative === ARTIFACT_CHAIN.controller_report && markdownRelative === ARTIFACT_CHAIN.controller_report_markdown)
  if (!validPair) fail('report_path_mismatch', 'report JSON/Markdown paths are not a declared pair')
  assertAcceptedReportPair(root, reportRelative === ARTIFACT_CHAIN.report ? 'report' : 'controller_report')
}

function verifiedReports(root: string, args: ReturnType<typeof parseArgs>): Record<'report' | 'report_markdown' | 'controller_report' | 'controller_report_markdown', ArtifactBinding> {
  const paths = {
    report: relativeArtifact(root, String(one(args, 'report'))),
    report_markdown: relativeArtifact(root, String(one(args, 'report-markdown'))),
    controller_report: relativeArtifact(root, String(one(args, 'controller-report'))),
    controller_report_markdown: relativeArtifact(root, String(one(args, 'controller-report-markdown'))),
  }
  for (const [name, relative] of Object.entries(paths)) if (relative !== ARTIFACT_CHAIN[name as keyof typeof ARTIFACT_CHAIN]) fail('report_path_mismatch', `${name} path is not fixed`)
  assertAcceptedReportPair(root, 'report'); assertAcceptedReportPair(root, 'controller_report')
  return bindingsAt(root, paths)
}

function commandContext(args: ReturnType<typeof parseArgs>, root: string): void {
  const manifest = loadManifest(root, String(one(args, 'manifest')))
  const resultsRelative = relativeArtifact(root, String(one(args, 'results')))
  if (resultsRelative !== ARTIFACT_CHAIN.results) fail('results_path_mismatch', 'merged results path is not fixed')
  const out = exactArgumentPath(root, String(one(args, 'out')), ARTIFACT_CHAIN.context)
  prepareArtifactChainStage(root, 'context')
  const results = loadValidatedMergedResultArtifacts(root, manifest); if (results.manifest_digest !== manifest.binding.digest) fail('cross_manifest_results', 'context results differ from manifest')
  const reviewImportRelative = relativeArtifact(root, String(one(args, 'review-import'))); if (reviewImportRelative !== REVIEW_IMPORT_PATH) fail('review_import_path_mismatch', 'review import path is not fixed')
  const reviews = validateReviewsForManifest(root, manifest.value, String(one(args, 'requirements-review')), String(one(args, 'security-review')))
  const reportBindings = verifiedReports(root, args)
  const value = buildContextValue({
    generatedAt: new Date().toISOString(),
    bindings: { manifest: manifest.binding, results: bindingAt(root, resultsRelative), ...reportBindings },
    reviewImport: bindingAt(root, reviewImportRelative),
    reviews: [bindingAt(root, REQUIREMENTS_REVIEW_PATH), bindingAt(root, SECURITY_REVIEW_PATH)],
  })
  void reviews
  requireValidation(validateContextValue(value)); validateAgainstSchema(root, SCHEMA_PATHS.context_schema, value)
  writeExclusiveArtifact(out, value, path.join(root, EVIDENCE_ROOT_RELATIVE))
  completeArtifactChainStage(root, 'context')
}

function commandHandoff(args: ReturnType<typeof parseArgs>, root: string): void {
  const manifest = loadManifest(root, String(one(args, 'manifest')))
  const resultsRelative = relativeArtifact(root, String(one(args, 'results'))); const contextRelative = relativeArtifact(root, String(one(args, 'context')))
  if (resultsRelative !== ARTIFACT_CHAIN.results || contextRelative !== ARTIFACT_CHAIN.context) fail('artifact_path_mismatch', 'handoff inputs are not fixed')
  const out = exactArgumentPath(root, String(one(args, 'out')), ARTIFACT_CHAIN.handoff)
  prepareArtifactChainStage(root, 'handoff')
  const results = loadValidatedMergedResultArtifacts(root, manifest); if (results.manifest_digest !== manifest.binding.digest) fail('cross_manifest_results', 'handoff results differ from manifest')
  const context = readJsonAt<ContextValue>(root, contextRelative); requireValidation(validateContextValue(context))
  const reportBindings = verifiedReports(root, args)
  validateReviewsForManifest(root, manifest.value, path.join(root, REQUIREMENTS_REVIEW_PATH), path.join(root, SECURITY_REVIEW_PATH))
  const value = buildHandoffValue({ generatedAt: new Date().toISOString(), bindings: { manifest: manifest.binding, results: bindingAt(root, resultsRelative), context: bindingAt(root, contextRelative), ...reportBindings } })
  requireValidation(validateHandoffValue(value)); validateAgainstSchema(root, SCHEMA_PATHS.handoff_schema, value)
  writeExclusiveArtifact(out, value, path.join(root, EVIDENCE_ROOT_RELATIVE))
  completeArtifactChainStage(root, 'handoff')
}

function committedBytes(root: string, commit: string, relative: string): Buffer {
  try { return gitBuffer(root, 'show', `${commit}:${relative}`) } catch { fail('missing_committed_artifact', `${relative} is missing from ${commit}`) }
}

function committedDigest(root: string, commit: string, relative: string): string {
  return sha256(committedBytes(root, commit, relative))
}

function validateAgainstCommittedSchema(root: string, commit: string, schemaRelative: string, value: unknown): void {
  let schema: unknown
  try { schema = JSON.parse(committedBytes(root, commit, schemaRelative).toString('utf8')) as unknown } catch { fail('invalid_schema', `${schemaRelative} is invalid committed JSON`) }
  try {
    const ajv = new Ajv2020Constructor({ strict: false, allErrors: true, formats: { 'date-time': true } })
    const validate = ajv.compile(schema)
    if (!validate(value)) fail('schema_validation_failed', JSON.stringify(validate.errors))
  } catch (error) {
    if ((error as Error & { code?: string }).code === 'schema_validation_failed') throw error
    fail('invalid_schema', (error as Error).message)
  }
}

export function validateReviewEvidenceSchemas(options: {
  root: string
  requirements: unknown
  security: unknown
  reviewImport: unknown
  schemaCommit?: string
}): void {
  const root = realpathSync(options.root)
  const validate = options.schemaCommit
    ? (schemaRelative: string, value: unknown) => validateAgainstCommittedSchema(root, options.schemaCommit as string, schemaRelative, value)
    : (schemaRelative: string, value: unknown) => validateAgainstSchema(root, schemaRelative, value)
  requireValidation(validateReviewImportValue(options.reviewImport))
  validate(SCHEMA_PATHS.review_schema, options.requirements)
  validate(SCHEMA_PATHS.review_schema, options.security)
  validate(SCHEMA_PATHS.review_import_schema, options.reviewImport)
  if (!same(bindingAt(root, ADOPTED_AMENDMENT_BINDING.path), ADOPTED_AMENDMENT_BINDING)) fail('adopted_amendment_digest_mismatch', 'adopted amendment differs from the fixed reviewed bytes')
}

function receiptArtifactPaths(manifest: ExitValue): string[] {
  const paths = new Set<string>([
    manifest.entry.path,
    manifest.entry_receipt.path,
    manifest.parent_receipts.phase_zero.path,
    manifest.parent_receipts.post_integration_v2.path,
    ...Object.values(manifest.governance).map((binding) => binding.path),
    ...Object.values(manifest.capture_inputs).map((binding) => binding.path),
    ...Object.entries(manifest.artifact_chain).filter(([name]) => name !== 'receipt').map(([, relative]) => relative),
  ])
  return [...paths].sort()
}

function preReceiptArtifactPaths(manifest: ExitValue): string[] {
  return Object.entries(manifest.artifact_chain)
    .filter(([name]) => name !== 'receipt')
    .map(([, relative]) => relative)
    .sort()
}

function manifestInputBindings(manifest: ExitValue): ArtifactBinding[] {
  const bindings = [
    manifest.entry,
    manifest.entry_receipt,
    manifest.parent_receipts.phase_zero,
    manifest.parent_receipts.post_integration_v2,
    ...Object.values(manifest.governance),
    ...Object.values(manifest.capture_inputs),
  ]
  const byPath = new Map<string, ArtifactBinding>()
  for (const binding of bindings) {
    const existing = byPath.get(binding.path)
    if (existing && existing.digest !== binding.digest) fail('manifest_artifact_digest_mismatch', `${binding.path} has conflicting manifest bindings`)
    byPath.set(binding.path, binding)
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path))
}

export function validateArtifactCommit(rootInput: string, manifest: ExitValue, revision: string): string {
  const root = realpathSync(rootInput)
  const artifactCommit = resolveCommitish(root, revision, 'invalid_artifact_commit')
  const ancestry = gitText(root, 'rev-list', '--parents', '-n', '1', artifactCommit).split(/\s+/)
  if (ancestry.length !== 2 || ancestry[1] !== manifest.approval_attestation_head) {
    fail('invalid_artifact_commit_parent', 'artifact commit must be the sole direct child of the approval-attestation head')
  }
  const delta = gitText(root, 'diff-tree', '--no-commit-id', '--name-status', '--no-renames', '-r', artifactCommit).split('\n').filter(Boolean).sort()
  const expectedDelta = preReceiptArtifactPaths(manifest).map((relative) => `A\t${relative}`).sort()
  if (!same(delta, expectedDelta)) fail('invalid_artifact_commit_delta', 'artifact commit must add exactly the ten pre-receipt output paths')
  for (const binding of manifestInputBindings(manifest)) {
    if (committedDigest(root, artifactCommit, binding.path) !== binding.digest) {
      fail('manifest_artifact_digest_mismatch', `${binding.path} differs from the digest captured in the exit manifest`)
    }
  }
  return artifactCommit
}

function assertReceiptInputs(root: string, args: ReturnType<typeof parseArgs>): void {
  const expected: Record<string, string> = {
    manifest: ARTIFACT_CHAIN.exit,
    results: ARTIFACT_CHAIN.results,
    context: ARTIFACT_CHAIN.context,
    handoff: ARTIFACT_CHAIN.handoff,
    report: ARTIFACT_CHAIN.report,
    'report-markdown': ARTIFACT_CHAIN.report_markdown,
    'controller-report': ARTIFACT_CHAIN.controller_report,
    'controller-report-markdown': ARTIFACT_CHAIN.controller_report_markdown,
  }
  for (const [name, relative] of Object.entries(expected)) if (relativeArtifact(root, String(one(args, name))) !== relative) fail('artifact_path_mismatch', `--${name} does not name the fixed artifact`)
}

function assertReceiptRepositoryHeads(state: ChainState, manifest: ExitValue, artifactCommit: string): void {
  if (state.repositories.cc_gateway.accepted_head !== manifest.approval_attestation_head
    || state.repositories.sub2api.accepted_head !== manifest.repositories.sub2api.head
    || gitText(state.repositories.cc_gateway.root, 'rev-parse', 'HEAD') !== artifactCommit
    || gitText(state.repositories.sub2api.root, 'rev-parse', 'HEAD') !== manifest.repositories.sub2api.head) {
    fail('wrong_repository_head', 'receipt repository heads differ from the reviewed approval, artifact, or Sub2API heads')
  }
}

function prepareReceiptArtifactChainStage(rootInput: string, manifest: ExitValue, artifactCommit: string): void {
  const root = realpathSync(rootInput)
  const prior = stageBindings(root, STAGE_TRANSITIONS.receipt.prior)
  const state = verifiedChainState(root)
  assertChainArtifacts(state, prior)
  assertReceiptRepositoryHeads(state, manifest, artifactCommit)
  const cc = captureRepositorySnapshot(root, prior)
  const sub = state.repositories.sub2api.root === root ? cc : captureRepositorySnapshot(state.repositories.sub2api.root)
  if (!same(ignoredInventoriesFromSnapshots(cc, sub), chainIgnoredInventories(state))) fail('repository_mutation', 'ignored repository state differs before receipt construction')
}

function completeReceiptArtifactChainStage(rootInput: string, manifest: ExitValue, artifactCommit: string): void {
  const root = realpathSync(rootInput)
  const prior = stageBindings(root, STAGE_TRANSITIONS.receipt.prior)
  const produced = stageBindings(root, STAGE_TRANSITIONS.receipt.produced)
  const state = verifiedChainState(root)
  assertChainArtifacts(state, prior)
  assertReceiptRepositoryHeads(state, manifest, artifactCommit)
  const cc = captureRepositorySnapshot(root, [...prior, ...produced])
  const sub = state.repositories.sub2api.root === root ? cc : captureRepositorySnapshot(state.repositories.sub2api.root)
  const terminalIgnored = ignoredInventoriesFromSnapshots(cc, sub)
  if (!same(terminalIgnored, chainIgnoredInventories(state))) fail('repository_mutation', 'ignored repository state differs after receipt construction')
  const paths = new Set(state.artifacts.map((binding) => binding.path))
  for (const binding of produced) {
    if (paths.has(binding.path) || !same(bindingAt(root, binding.path), binding)) fail('invalid_chain_advance', `${binding.path} cannot advance the chain`)
    paths.add(binding.path)
  }
  writeChainState(root, buildChainState(
    { cc_gateway: artifactCommit, sub2api: state.repositories.sub2api.accepted_head },
    [...state.artifacts, ...produced],
    { cc_gateway: state.repositories.cc_gateway.root, sub2api: state.repositories.sub2api.root },
    terminalIgnored,
  ), false)
}

function validateReceiptChainValues(root: string, manifest: ExitValue, now = Date.now(), schemaCommit = gitText(root, 'rev-parse', 'HEAD')): void {
  const reviewImport = readJsonAt<ReviewImport>(root, REVIEW_IMPORT_PATH)
  validateReviewsForManifest(root, manifest, path.join(root, REQUIREMENTS_REVIEW_PATH), path.join(root, SECURITY_REVIEW_PATH), schemaCommit)
  const green = readJsonAt<ResultSet>(root, ARTIFACT_CHAIN.green); requireValidation(validateResultSetValue(green, now))
  const red = readJsonAt<ResultSet>(root, ARTIFACT_CHAIN.red); requireValidation(validateResultSetValue(red, now))
  const results = readJsonAt<ResultSet>(root, ARTIFACT_CHAIN.results); requireValidation(validateResultSetValue(results, now))
  const manifestBinding = bindingAt(root, ARTIFACT_CHAIN.exit); const catalog = validateCatalogAt(root, path.join(root, COMMAND_CATALOG_PATH), manifest)
  requireValidation(validateResultSetBindings(green, catalog.value, manifest, manifestBinding.digest, catalog.binding.digest))
  requireValidation(validateResultSetBindings(red, catalog.value, manifest, manifestBinding.digest, catalog.binding.digest))
  requireValidation(validateResultSetBindings(results, catalog.value, manifest, manifestBinding.digest, catalog.binding.digest))
  validateIgnoredEvidenceContinuity(manifest, green, red, results)
  validateMergedResultSetConsistency(green, red, results)
  if (results.group !== 'merged' || results.records.some((record) => !['pass', 'expected_fail'].includes(record.status))) fail('unexpected_classification', 'receipt requires accepted merged results')
  const context = readJsonAt<ContextValue>(root, ARTIFACT_CHAIN.context); requireValidation(validateContextValue(context, now))
  const handoff = readJsonAt<HandoffValue>(root, ARTIFACT_CHAIN.handoff); requireValidation(validateHandoffValue(handoff, now))
  const exitReport = readJsonAt<ReportValue>(root, ARTIFACT_CHAIN.report); requireValidation(validateReportPair(exitReport, readTextAt(root, ARTIFACT_CHAIN.report_markdown)))
  const controllerReport = readJsonAt<ReportValue>(root, ARTIFACT_CHAIN.controller_report); requireValidation(validateReportPair(controllerReport, readTextAt(root, ARTIFACT_CHAIN.controller_report_markdown)))
  if (exitReport.report_type !== 'exit' || controllerReport.report_type !== 'controller') fail('report_type_mismatch', 'receipt report discriminators differ from fixed paths')
  const resultsBinding = bindingAt(root, ARTIFACT_CHAIN.results)
  const reportBindings = {
    report: bindingAt(root, ARTIFACT_CHAIN.report),
    report_markdown: bindingAt(root, ARTIFACT_CHAIN.report_markdown),
    controller_report: bindingAt(root, ARTIFACT_CHAIN.controller_report),
    controller_report_markdown: bindingAt(root, ARTIFACT_CHAIN.controller_report_markdown),
  }
  const reviewBindings = [bindingAt(root, REQUIREMENTS_REVIEW_PATH), bindingAt(root, SECURITY_REVIEW_PATH)]
  const expectedReportReviews = [{ role: 'requirements', digest: reviewBindings[0].digest }, { role: 'security_quality', digest: reviewBindings[1].digest }]
  if (!same(exitReport.manifest, manifestBinding) || !same(exitReport.results, resultsBinding) || !same(exitReport.reviews, expectedReportReviews)
    || !same(controllerReport.manifest, manifestBinding) || !same(controllerReport.results, resultsBinding) || !same(controllerReport.reviews, expectedReportReviews)) fail('cross_report_binding', 'reports do not bind actual manifest, results, and review bytes')
  const expectedContextBindings = { manifest: manifestBinding, results: resultsBinding, ...reportBindings }
  if (!same(context.bindings, expectedContextBindings) || !same(context.review_import, bindingAt(root, REVIEW_IMPORT_PATH)) || !same(context.reviews, reviewBindings)) fail('cross_context_binding', 'context does not bind actual prior artifacts')
  const expectedHandoffBindings = { manifest: manifestBinding, results: resultsBinding, context: bindingAt(root, ARTIFACT_CHAIN.context), ...reportBindings }
  if (!same(handoff.bindings, expectedHandoffBindings)) fail('cross_handoff_binding', 'handoff does not bind actual context and report bytes')
  if (results.manifest_digest !== manifestBinding.digest || context.bindings.manifest.digest !== results.manifest_digest || handoff.bindings.manifest.digest !== results.manifest_digest) fail('cross_manifest_handoff', 'receipt chain does not share one manifest')
  if (!same(manifest.disabled_capabilities, context.disabled_capabilities) || !same(context.disabled_capabilities, handoff.disabled_capabilities)) fail('disabled_capability_drift', 'receipt chain enables a deferred capability')
}

function commandReceipt(args: ReturnType<typeof parseArgs>, root: string): void {
  const artifactCommit = resolveCommitish(root, String(one(args, 'artifact-commit')), 'invalid_artifact_commit')
  if (gitText(root, 'rev-parse', 'HEAD') !== artifactCommit) fail('wrong_artifact_commit', 'receipt must be built at the exact artifact commit')
  const manifest = loadManifest(root, String(one(args, 'manifest')))
  assertReceiptInputs(root, args)
  validateArtifactCommit(root, manifest.value, artifactCommit)
  prepareReceiptArtifactChainStage(root, manifest.value, artifactCommit)
  validateReceiptChainValues(root, manifest.value, Date.now(), artifactCommit)
  const artifactPaths = receiptArtifactPaths(manifest.value)
  const artifactDigests: Record<string, string> = {}
  for (const relative of artifactPaths) {
    const binding = bindingAt(root, relative)
    const committed = committedDigest(root, artifactCommit, relative)
    if (binding.digest !== committed) fail('artifact_digest_mismatch', `${relative} differs from the artifact commit`)
    artifactDigests[relative] = binding.digest
  }
  const reviewImport = readJsonAt<ReviewImport>(root, REVIEW_IMPORT_PATH)
  const value = buildReceiptValue({
    generatedAt: (readJsonAt<ResultSet>(root, ARTIFACT_CHAIN.results)).generated_at,
    artifactCommit,
    reviewedHeads: { cc_gateway: manifest.value.repositories.cc_gateway.head, sub2api: manifest.value.repositories.sub2api.head },
    parentReceipts: manifest.value.parent_receipts,
    artifactDigests,
    reviewAmendment: { source_digest: reviewImport.source.digest, adopted_digest: reviewImport.adopted.digest },
  })
  requireValidation(validateReceiptValue(value)); validateAgainstCommittedSchema(root, artifactCommit, SCHEMA_PATHS.receipt_schema, value)
  const out = exactArgumentPath(root, String(one(args, 'out')), ARTIFACT_CHAIN.receipt)
  writeExclusiveArtifact(out, value, path.join(root, EVIDENCE_ROOT_RELATIVE))
  completeReceiptArtifactChainStage(root, manifest.value, artifactCommit)
}

export function validateReceiptArtifact(options: { root: string; receiptPath: string; artifactCommit: string; receiptCommit?: string; now?: number }): void {
  const root = realpathSync(options.root)
  const artifactCommit = resolveCommitish(root, options.artifactCommit, 'invalid_artifact_commit')
  const receiptCommit = options.receiptCommit ? resolveCommitish(root, options.receiptCommit, 'invalid_receipt_commit') : undefined
  const receiptRelative = relativeArtifact(root, options.receiptPath)
  if (receiptRelative !== ARTIFACT_CHAIN.receipt) fail('receipt_path_mismatch', 'receipt path is not fixed')
  const receipt = readJsonAt<ReceiptValue>(root, receiptRelative)
  requireValidation(validateReceiptValue(receipt))
  if (receipt.artifact_commit !== artifactCommit) fail('wrong_artifact_commit', 'receipt artifact commit differs from the requested commit')
  validateAgainstCommittedSchema(root, artifactCommit, SCHEMA_PATHS.receipt_schema, receipt)
  const manifestBytes = committedBytes(root, artifactCommit, ARTIFACT_CHAIN.exit)
  let manifest: ExitValue
  try { manifest = JSON.parse(manifestBytes.toString('utf8')) as ExitValue } catch { fail('invalid_committed_manifest', 'artifact commit manifest is invalid JSON') }
  requireValidation(validateExitValue(manifest))
  validateArtifactCommit(root, manifest, artifactCommit)
  validateReviewsForManifest(root, manifest, path.join(root, REQUIREMENTS_REVIEW_PATH), path.join(root, SECURITY_REVIEW_PATH), artifactCommit)
  const expectedPaths = receiptArtifactPaths(manifest)
  if (!same(Object.keys(receipt.artifact_digests).sort(), expectedPaths)) fail('artifact_inventory_mismatch', 'receipt artifact inventory is not exact')
  for (const relative of expectedPaths) {
    const current = bindingAt(root, relative).digest; const committed = committedDigest(root, artifactCommit, relative)
    if (receipt.artifact_digests[relative] !== current || current !== committed) fail('artifact_digest_mismatch', `${relative} differs from receipt or artifact commit`)
  }
  if (!same(receipt.reviewed_heads, { cc_gateway: manifest.repositories.cc_gateway.head, sub2api: manifest.repositories.sub2api.head }) || !same(receipt.parent_receipts, manifest.parent_receipts)) fail('receipt_binding_mismatch', 'receipt heads or parent receipts differ from the manifest')
  const reviewImport = readJsonAt<ReviewImport>(root, REVIEW_IMPORT_PATH)
  if (!same(receipt.review_amendment, { source_digest: reviewImport.source.digest, adopted_digest: reviewImport.adopted.digest })) fail('review_import_bytes_mismatch', 'receipt review-amendment digests differ from review import')
  validateReceiptChainValues(root, manifest, options.now, artifactCommit)
  if (receiptCommit) {
    if (gitText(root, 'rev-parse', 'HEAD') !== receiptCommit) fail('wrong_receipt_commit', 'worktree HEAD is not the receipt commit')
    if (gitText(root, 'rev-parse', `${receiptCommit}^`) !== artifactCommit) fail('invalid_receipt_commit_parent', 'receipt commit parent is not the artifact commit')
    const delta = gitText(root, 'diff-tree', '--no-commit-id', '--name-status', '-r', receiptCommit).split('\n').filter(Boolean)
    if (!same(delta, [`A\t${ARTIFACT_CHAIN.receipt}`])) fail('invalid_receipt_commit_delta', 'receipt commit must add exactly one receipt path')
    if (!readArtifactAt(root, receiptRelative).read.bytes.equals(committedBytes(root, receiptCommit, receiptRelative))) fail('receipt_commit_bytes_mismatch', 'committed receipt differs from validated worktree bytes')
    captureRepositorySnapshot(root)
  } else {
    if (gitText(root, 'rev-parse', 'HEAD') !== artifactCommit) fail('wrong_artifact_commit', 'pre-commit validation must run at the artifact commit')
    captureRepositorySnapshot(root, [bindingAt(root, receiptRelative)])
  }
}

function commandValidateReceipt(args: ReturnType<typeof parseArgs>, root: string): void {
  validateReceiptArtifact({
    root,
    receiptPath: String(one(args, 'receipt')),
    artifactCommit: String(one(args, 'artifact-commit')),
    receiptCommit: one(args, 'receipt-commit', false),
  })
}

function dispatch(command: string, tokens: string[], runtime: CliRuntime): void {
  const invocation = parseCliInvocation([command, ...tokens])
  const args = invocation.args
  const root = realpathSync(runtime.repositoryRoot)
  switch (invocation.command) {
    case 'capture-exit': commandCaptureExit(args, runtime); break
    case 'run': commandRun(args, runtime); break
    case 'merge': commandMerge(args, root); break
    case 'review-import': commandReviewImport(args, root); break
    case 'validate-review-import': commandValidateReviewImport(args, root); break
    case 'validate-reviews': commandValidateReviews(args); break
    case 'report': commandReport(args, 'exit', root); break
    case 'controller-report': commandReport(args, 'controller', root); break
    case 'validate-report': commandValidateReport(args, root); break
    case 'context': commandContext(args, root); break
    case 'handoff': commandHandoff(args, root); break
    case 'receipt': commandReceipt(args, root); break
    case 'validate-receipt': commandValidateReceipt(args, root); break
  }
  runtime.writeStdout(`${canonicalJson({ ok: true, command: invocation.command })}\n`)
}

function runProductionCli(tokens: string[]): void {
  assertProductionStartupEnvironment()
  withProductionReadBudgets(() => {
    assertNoGitReplacementRefs(REPOSITORY_ROOT)
    const [command, ...argumentTokens] = tokens
    if (!command) fail('invalid_arguments', 'a supported P0.1 subcommand is required')
    dispatch(command, argumentTokens, PRODUCTION_CLI_RUNTIME)
  })
}

function main(): void {
  if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) !== realpathSync(process.argv[1])) return
  runProductionCli(process.argv.slice(2))
}

cli(main)
