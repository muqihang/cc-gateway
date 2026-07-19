import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import { userInfo } from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

import { canonicalDeliveryJson, digestDeliveryValue, validatePhase1RunLeaseChain, type Phase1RunLease } from './delivery-authority.js'
import {
  assertNoGitReplacementRefs,
  REVIEWED_GIT_ENVIRONMENT,
  REVIEWED_GIT_EXECUTABLE,
  runReviewedGit,
} from './secure-runtime.js'

type JsonObject = Record<string, any>
type RecoveryFamily = 'b1' | 'b2' | 'b3' | 'listener_tls'

type RepositoryBinding = Readonly<{
  remote_url_digest: string
  bootstrap_head: string
  recovery_branch: string
  source_head: string
  source_commits: readonly string[]
  skipped_source_commits: readonly string[]
  bundle_digest: string
}>

export type Phase1RecoveryBindings = Readonly<{
  plan_path: string
  contract_digest: string
  plan_digest: string
  reviewed_plan_commit: string
  shared_contract_digest: string
  cc_gateway: RepositoryBinding
  sub2api: RepositoryBinding
  pre_replay_red: Readonly<Record<RecoveryFamily, readonly string[]>>
  pre_replay_classifications: Readonly<Record<RecoveryFamily, readonly string[]>>
  pre_replay_failure_signatures: Readonly<Record<RecoveryFamily, Readonly<{
    failed_tests_digest: string
    required_output_markers: readonly string[]
  }>>>
}>

export type Phase1RecoveryCli = Readonly<{
  command: 'pre-replay-red'
  cc_root: string
  sub2api_root: string
  cc_bundle: string
  sub2api_bundle: string
  output_root: string
}>

type RedRecord = Readonly<{
  family: RecoveryFamily
  status: 'expected_fail'
  leaf_names: readonly string[]
  classifications: readonly string[]
  external_side_effect_count: 0
  unauthorized_socket_count: 0
  failure_signature_digest: string
  observer: Readonly<{
    boundary: 'sandbox_network_deny' | 'active_listener_inventory'
    external_side_effect_count: 0
    unauthorized_socket_count: 0
  }>
}>

export type Phase1RecoveryInputValidationHooks = Readonly<{
  after_bundle_read?: (bundle: string) => void
  after_quarantine_open?: (bundle: string) => void
}>

export type Phase1RecoveryReplayObservation = Readonly<{
  cc_gateway: Readonly<{ source_root: string; replacement_root: string }>
  sub2api: Readonly<{ source_root: string; replacement_root: string }>
}>

export type Phase1RecoveryT2Observation = Readonly<{
  lease_chain: readonly Readonly<{ lease: Phase1RunLease; context: JsonObject; context_bytes: Buffer | string; artifact_commit: string }>[]
  plan_bytes: Buffer | string
  execution_context_schema_bytes: Buffer | string
  cc_root: string
  sub2api_root: string
  result_artifacts: Readonly<{ t0: string; t1: string; owned: string; preserved_red: string }>
}>

export type Phase1RecoveryDependencies = Readonly<{
  validate_inputs: (input: Phase1RecoveryCli, bindings: Phase1RecoveryBindings) => void | Promise<void>
  validate_outputs: (input: Phase1RecoveryCli, bindings: Phase1RecoveryBindings) => void | Promise<void>
  observe_baseline: (input: Phase1RecoveryCli) => Readonly<{ cc_gateway: string; sub2api: string }> | Promise<Readonly<{ cc_gateway: string; sub2api: string }>>
  run_red: (family: RecoveryFamily, input: Phase1RecoveryCli, bindings: Phase1RecoveryBindings) => RedRecord | Promise<RedRecord>
  replay_required: (input: Phase1RecoveryCli, bindings: Phase1RecoveryBindings) => boolean | Promise<boolean>
  persist_record: (input: Phase1RecoveryCli, record: JsonObject) => void | Promise<void>
}>

const COMMIT = /^[0-9a-f]{40,64}$/
const DIGEST = /^sha256:[0-9a-f]{64}$/
const RECOVERY_FAMILIES = Object.freeze(['b1', 'b2', 'b3', 'listener_tls'] as const)
const RECORD_KEYS = Object.freeze(['classifications', 'external_side_effect_count', 'failure_signature_digest', 'family', 'leaf_names', 'observer', 'status', 'unauthorized_socket_count'])
const REPLAY_RECORD_KEYS = Object.freeze(['cc_gateway', 'record_kind', 'schema_version', 'status', 'sub2api'])
const REPLAY_REPOSITORY_KEYS = Object.freeze(['protected_path_intersection_count', 'replacement_commits', 'skipped_source_commits', 'source_commits'])
const T2_KEYS = Object.freeze([
  'command_result_digests', 'external_side_effect_count', 'lease_digest', 'owned_outcomes', 'preserved_red', 'record_kind',
  'repositories_clean', 'schema_version', 'status', 'tested_heads', 'unauthorized_socket_count',
])
const CLI_FLAGS = Object.freeze({
  '--cc-root': 'cc_root',
  '--sub2api-root': 'sub2api_root',
  '--cc-bundle': 'cc_bundle',
  '--sub2api-bundle': 'sub2api_bundle',
  '--output-root': 'output_root',
} as const)
const PRE_REPLAY_ABSENT_PATHS = Object.freeze([
  'docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json',
  'tools/oracle-lab/phase-1-evidence.ts',
  'docs/superpowers/evidence/phase-1/phase-1-plan-review.json',
  'docs/superpowers/evidence/phase-1/phase-1-execution-context.json',
  'docs/superpowers/evidence/phase-1/phase-1-authority-restart-0001.json',
  'docs/superpowers/evidence/phase-1/phase-1-authority-restart-0002.json',
])
const ACCOUNT_HOME = userInfo().homedir
const GO_MODULE_CACHE = path.join(ACCOUNT_HOME, 'go/pkg/mod')
const GO_EXECUTABLE = path.join(GO_MODULE_CACHE, 'golang.org/toolchain@v0.0.1-go1.26.5.darwin-arm64/bin/go')
const OUTPUT_RECORD = 'phase-1-recovery-pre-replay-red.json'

export const PHASE1_RECOVERY_BINDINGS: Phase1RecoveryBindings = Object.freeze({
  plan_path: 'docs/superpowers/plans/2026-07-18-claude-code-2.1.207-phase-1-recovery.md',
  contract_digest: 'sha256:4fb422c47b62519552fe1d21dee53576309df145c280d05c41d575bfdb82c3fe',
  plan_digest: 'sha256:ccbf47fa2bb7185efe96bc1bf3f90150e679c6e7f6082db8f04ae25b8c98a41b',
  reviewed_plan_commit: '09ae6a67242d19c28351c568b0d46a5a2e9ab8ef',
  shared_contract_digest: 'sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1',
  cc_gateway: Object.freeze({
    remote_url_digest: 'sha256:52de8ee497a784b90b33345865754f3e6b9d5d96eed92549a15a4157cabb568a',
    bootstrap_head: 'ac12e0863afbd2385dde9a4aa865ee9397f3b8fa',
    recovery_branch: 'codex/oracle-phase-1-recovery-cc',
    source_head: 'd5a711614177906d18486b98ff4c5d45d97e04c7',
    source_commits: Object.freeze([
      '410fbe0c784c9eea04685cc251909d8df75b6871',
      'e2972e6f6b27c658d9a6e91379ba9cea834cd4cb',
      'beabd36547daa6236c1caa142a0a1b5a926bbde3',
      'bedc81ca5c0aa9e0991a2f0bc42b62c4dd62f8db',
      '540962ea9c068c82d5dbe07b5aeae172fa6258e6',
      'e43f50816c8b693f875fc485a99dcdf9d985080e',
      '8cbc5c633c7f791b395198aedd2db2e55f01915b',
      'd5a711614177906d18486b98ff4c5d45d97e04c7',
    ]),
    skipped_source_commits: Object.freeze([
      '1c8f25bb1ca31c5c16262fec71f93dd1e14f512d',
      '6621c7a78432a895d261054e291aed74c04978c3',
    ]),
    bundle_digest: 'sha256:27e9e3cea6a2d18eb1e6423e9e7589aa53b5779fcf71a55008bbdbca838c9fd3',
  }),
  sub2api: Object.freeze({
    remote_url_digest: 'sha256:22c1a9e3cf8e76d2a20bf24a1ff66fa5d7417ba8b8b83a948c8b3ffa5c33a1a9',
    bootstrap_head: 'b0b77933716487da5fca00329443f88ce9a1c3db',
    recovery_branch: 'codex/oracle-phase-1-recovery-sub2api',
    source_head: '20217731da9521f9676434b7bd5f9cb73020c32c',
    source_commits: Object.freeze([
      '267b3d074248a7e1f7cf16bf302f91b41fa754ec',
      'cff380892f64720c046d581723d0faf13cb566fc',
      'b90254865b11be445a73faeeb0bbf1c0ff5384dd',
      'e49100746f8e00d83168864dab2a4235053d16d7',
      '33cac77640cccf5bbd87ab79ea9e44ef2c125da7',
      '7ffaebdaa32aa3b9896cf6a3c554a671255b98d3',
      'da7a01ac692553c9886c4ef14d0f9d5cb29c0a45',
      '75dc3c0fd38acea12f373207521d9927c01c25ad',
      '0f2271946686458458e959d3952e56f75c9e50fe',
      '20217731da9521f9676434b7bd5f9cb73020c32c',
    ]),
    skipped_source_commits: Object.freeze([]),
    bundle_digest: 'sha256:3df0933834ed3bcc692b421e317c19314c1594492571a4abeae84375152fe47e',
  }),
  pre_replay_red: Object.freeze({
    b1: Object.freeze(['TestFormalPoolBrowserEgressAttestationRejectsUntrustedProofs']),
    b2: Object.freeze([
      'TestFormalPoolOnboardingAuthorizationDimensionsAreIndependent',
      'TestFormalPoolOnboardingAuthorizationRejectsCrossBoundaryOperations',
    ]),
    b3: Object.freeze(['TestFormalPoolOnboardingPublicOriginAuthority']),
    listener_tls: Object.freeze(['listener_boundary_not_enforced', 'tls_boundary_order_not_enforced']),
  }),
  pre_replay_classifications: Object.freeze({
    b1: Object.freeze(['b1_proof_finalization_missing']),
    b2: Object.freeze(['b2_authority_reservation_missing']),
    b3: Object.freeze(['b3_public_origin_authority_missing']),
    listener_tls: Object.freeze(['listener_boundary_not_enforced', 'tls_boundary_order_not_enforced']),
  }),
  pre_replay_failure_signatures: Object.freeze({
    b1: Object.freeze({
      failed_tests_digest: 'sha256:cd1b16c6a9ef61f56098d5762a0b0858f0302c19be836238d9392397cfc6df54',
      required_output_markers: Object.freeze([
        'client-chosen text must not attest browser egress',
        'proofs must be bound to exactly one onboarding session',
        'a proxy re-test must invalidate every earlier proof',
      ]),
    }),
    b2: Object.freeze({
      failed_tests_digest: 'sha256:7934a21e3f5864fc7f1278488a8ee8978f4cf3862fed72058f07c2a993d96be5',
      required_output_markers: Object.freeze([
        'authorization must deny before lookup, state, version, or dependency handling',
        'stale version must be rejected as a state/version conflict',
      ]),
    }),
    b3: Object.freeze({
      failed_tests_digest: 'sha256:ac6ea66b37d6fedb326b6d10bc728b7d69577a675302338aa2823d6d942018a1',
      required_output_markers: Object.freeze([
        'without configured origin or trusted ingress, changing one request-derived origin dimension must not change the returned authority',
      ]),
    }),
    listener_tls: Object.freeze({
      failed_tests_digest: 'sha256:5e66b867586bca0f26a69cc866f2e30b7f0019feb9c1a775c7c2bdfb9632f8b2',
      required_output_markers: Object.freeze(['ERR_SOCKET_BAD_PORT', 'ENOENT']),
    }),
  }),
})

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

function compareBytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: JsonObject, expected: readonly string[]): boolean {
  return canonicalDeliveryJson(Object.keys(value).sort(compareBytes)) === canonicalDeliveryJson([...expected].sort(compareBytes))
}

function sha256(value: Buffer | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function same(left: unknown, right: unknown): boolean {
  return canonicalDeliveryJson(left) === canonicalDeliveryJson(right)
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

export function parsePhase1RecoveryCli(argv: readonly string[]): Phase1RecoveryCli {
  if (argv[0] !== 'pre-replay-red' || argv.length !== 1 + Object.keys(CLI_FLAGS).length * 2) {
    fail('phase1_recovery_cli_invalid', 'Recovery CLI requires one exact command and closed arguments')
  }
  const parsed: Record<string, string> = {}
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index] as keyof typeof CLI_FLAGS
    const field = CLI_FLAGS[flag]
    const value = argv[index + 1]
    if (!field || typeof value !== 'string' || value.length === 0 || field in parsed || !path.isAbsolute(value) || path.normalize(value) !== value) {
      fail('phase1_recovery_cli_invalid', 'Recovery CLI path arguments are invalid')
    }
    parsed[field] = value
  }
  if (Object.keys(parsed).length !== Object.keys(CLI_FLAGS).length || new Set(Object.values(parsed)).size !== Object.values(parsed).length) {
    fail('phase1_recovery_cli_invalid', 'Recovery CLI arguments are missing, duplicate, or aliased')
  }
  return Object.freeze({ command: 'pre-replay-red', ...parsed }) as Phase1RecoveryCli
}

function validateReplayRepository(value: unknown, binding: RepositoryBinding): asserts value is JsonObject {
  if (!isObject(value) || !exactKeys(value, REPLAY_REPOSITORY_KEYS)
    || !same(value.source_commits, binding.source_commits)
    || !same(value.skipped_source_commits, binding.skipped_source_commits)
    || value.protected_path_intersection_count !== 0
    || !Array.isArray(value.replacement_commits)
    || value.replacement_commits.length !== binding.source_commits.length
    || new Set(value.replacement_commits).size !== value.replacement_commits.length
    || value.replacement_commits.some((commit: unknown) => typeof commit !== 'string' || !COMMIT.test(commit))) {
    fail('phase1_recovery_mapping_invalid', 'Recovery replay mapping is not the exact compiled sequence')
  }
}

function stablePatchId(root: string, commit: string, parent: string): string {
  const patch = runReviewedGit(root, ['diff', '--binary', '--full-index', parent, commit]).stdout
  assertNoGitReplacementRefs(root)
  const observed = spawnSync(REVIEWED_GIT_EXECUTABLE, ['patch-id', '--stable'], {
    cwd: root,
    input: patch,
    encoding: 'buffer',
    env: { ...REVIEWED_GIT_ENVIRONMENT },
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const output = Buffer.from(observed.stdout ?? []).toString('utf8').trim().split(/\s+/)[0]
  if (observed.error || observed.signal !== null || observed.status !== 0 || !/^[0-9a-f]{40,64}$/.test(output)) {
    fail('phase1_recovery_mapping_invalid', 'stable patch-id is unavailable')
  }
  return output
}

function soleParent(root: string, commit: string): string {
  const fields = gitText(root, ['rev-list', '--parents', '-n', '1', commit]).split(' ')
  if (fields.length !== 2 || fields[0] !== commit || !COMMIT.test(fields[1])) fail('phase1_recovery_mapping_invalid', 'mapped commit must have exactly one parent')
  return fields[1]
}

function pathStatusDigest(root: string, parent: string, commit: string): Readonly<{ digest: string; paths: readonly string[] }> {
  const output = runReviewedGit(root, ['diff-tree', '--no-commit-id', '--name-status', '-r', '-z', parent, commit]).stdout
  const fields = output.toString('utf8').split('\0').filter(Boolean)
  const paths: string[] = []
  for (let index = 0; index < fields.length;) {
    const status = fields[index++]
    if (!/^[ACDMRTUXB][0-9]*$/.test(status)) fail('phase1_recovery_mapping_invalid', 'mapped path status is malformed')
    const count = status.startsWith('R') || status.startsWith('C') ? 2 : 1
    for (let pathIndex = 0; pathIndex < count; pathIndex += 1) {
      const changedPath = fields[index++]
      if (!changedPath || changedPath.startsWith('/') || changedPath.split('/').includes('..')) fail('phase1_recovery_mapping_invalid', 'mapped path is unsafe')
      paths.push(changedPath)
    }
  }
  return Object.freeze({ digest: sha256(output), paths: Object.freeze(paths) })
}

const PROTECTED_REPLAY_PATHS = Object.freeze([
  'backend/internal/service/openai_compact_sse_keepalive_test.go',
  'docs/superpowers/evidence/phase-1/phase-1-plan-review.json',
  'docs/superpowers/evidence/phase-1/phase-1-execution-context.json',
])

function validateObservedReplayRepository(value: JsonObject, binding: RepositoryBinding, observation: Readonly<{ source_root: string; replacement_root: string }>): void {
  const sourceRoot = assertRealPath(observation.source_root, 'directory', 'phase1_recovery_mapping_invalid')
  const replacementRoot = assertRealPath(observation.replacement_root, 'directory', 'phase1_recovery_mapping_invalid')
  const replacementStatus = runReviewedGit(replacementRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']).stdout
  const replacementBase = gitText(replacementRoot, ['rev-parse', '--verify', '--end-of-options', 'refs/remotes/muqihang/main^{commit}'])
  if (replacementStatus.length !== 0 || replacementBase !== binding.bootstrap_head
    || gitText(sourceRoot, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}']) !== binding.source_head
    || gitText(replacementRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']) !== binding.recovery_branch
    || gitText(replacementRoot, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}']) !== value.replacement_commits.at(-1)) {
    fail('phase1_recovery_mapping_invalid', 'observed replay endpoints do not match compiled authority')
  }
  for (const skippedCommit of binding.skipped_source_commits) {
    if (gitText(sourceRoot, ['rev-parse', '--verify', '--end-of-options', `${skippedCommit}^{commit}`]) !== skippedCommit) {
      fail('phase1_recovery_mapping_invalid', 'compiled skipped source commit is unavailable')
    }
  }
  let expectedReplacementParent = binding.bootstrap_head
  for (let index = 0; index < binding.source_commits.length; index += 1) {
    const sourceCommit = binding.source_commits[index]
    const replacementCommit = value.replacement_commits[index]
    const sourceParent = soleParent(sourceRoot, sourceCommit)
    const replacementParent = soleParent(replacementRoot, replacementCommit)
    if (replacementParent !== expectedReplacementParent || stablePatchId(sourceRoot, sourceCommit, sourceParent) !== stablePatchId(replacementRoot, replacementCommit, replacementParent)) {
      fail('phase1_recovery_mapping_invalid', 'observed replay parent or patch-id drifted')
    }
    const sourcePaths = pathStatusDigest(sourceRoot, sourceParent, sourceCommit)
    const replacementPaths = pathStatusDigest(replacementRoot, replacementParent, replacementCommit)
    if (sourcePaths.digest !== replacementPaths.digest || sourcePaths.paths.some((entry) => PROTECTED_REPLAY_PATHS.includes(entry))) {
      fail('phase1_recovery_mapping_invalid', 'observed replay path/status or protected-path boundary drifted')
    }
    expectedReplacementParent = replacementCommit
  }
}

export function validatePhase1RecoveryReplayMapping(
  value: unknown,
  bindings: Phase1RecoveryBindings,
  observation: Phase1RecoveryReplayObservation,
): void {
  if (!isObject(value) || !exactKeys(value, REPLAY_RECORD_KEYS) || value.schema_version !== 1
    || value.record_kind !== 'phase_1_recovery_replay_mapping' || value.status !== 'equivalent') {
    fail('phase1_recovery_mapping_invalid', 'Recovery replay mapping record is malformed')
  }
  validateReplayRepository(value.cc_gateway, bindings.cc_gateway)
  validateReplayRepository(value.sub2api, bindings.sub2api)
  validateObservedReplayRepository(value.cc_gateway, bindings.cc_gateway, observation.cc_gateway)
  validateObservedReplayRepository(value.sub2api, bindings.sub2api, observation.sub2api)
}

function readStableResultArtifact(fileInput: string): Readonly<{ bytes: Buffer; value: JsonObject }> {
  const file = assertRealPath(fileInput, 'file', 'phase1_recovery_t2_invalid')
  let descriptor = -1
  try {
    descriptor = openSync(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    const before = fstatSync(descriptor)
    if (!before.isFile() || before.size < 2 || before.size > 16 * 1024 * 1024) fail('phase1_recovery_t2_invalid', 'T2 result artifact has an unsafe size or type')
    const bytes = readFileSync(descriptor)
    const after = fstatSync(descriptor)
    const pathAfter = lstatSync(file)
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || pathAfter.isSymbolicLink() || pathAfter.dev !== after.dev || pathAfter.ino !== after.ino || bytes.length !== after.size) {
      fail('phase1_recovery_t2_invalid', 'T2 result artifact bytes are unstable')
    }
    let value: unknown
    try { value = JSON.parse(bytes.toString('utf8')) } catch { fail('phase1_recovery_t2_invalid', 'T2 result artifact is malformed') }
    if (!isObject(value)) fail('phase1_recovery_t2_invalid', 'T2 result artifact is not an object')
    return Object.freeze({ bytes, value })
  } finally {
    if (descriptor >= 0) closeSync(descriptor)
  }
}

function validateT2ResultArtifact(
  value: JsonObject,
  kind: 't0' | 't1' | 'owned' | 'preserved_red',
  leaseDigest: string,
  testedHeads: JsonObject,
): void {
  const baseKeys = ['lease_digest', 'record_kind', 'schema_version', 'status', 'tested_heads']
  const extraKeys = kind === 't1' || kind === 'preserved_red' ? ['preserved_red']
    : kind === 'owned' ? ['external_side_effect_count', 'owned_outcomes', 'unauthorized_socket_count'] : []
  if (!exactKeys(value, [...baseKeys, ...extraKeys]) || value.schema_version !== 1
    || value.record_kind !== `phase_1_recovery_${kind}_result` || value.status !== 'green'
    || value.lease_digest !== leaseDigest || !same(value.tested_heads, testedHeads)
    || ((kind === 't1' || kind === 'preserved_red') && !same(value.preserved_red, { cc_event_count: 61, cc_unique_count: 61, sidecar_event_count: 51, sidecar_unique_count: 51 }))
    || (kind === 'owned' && (!same(value.owned_outcomes, { b1: 'green', b2: 'green', b3: 'green', listener_tls: 'green' })
      || value.external_side_effect_count !== 0 || value.unauthorized_socket_count !== 0))) {
    fail('phase1_recovery_t2_invalid', 'T2 result artifact semantics drifted')
  }
}

export function derivePhase1RecoveryT2Record(observation: Phase1RecoveryT2Observation): Readonly<JsonObject> {
  validatePhase1RunLeaseChain({ chain: observation.lease_chain, plan_bytes: observation.plan_bytes, execution_context_schema_bytes: observation.execution_context_schema_bytes })
  const currentLease = observation.lease_chain.at(-1)?.lease
  if (!currentLease || currentLease.transition_id !== 'P1R-03' || currentLease.state !== 'replay_complete'
    || !exactKeys(observation.result_artifacts as JsonObject, ['owned', 'preserved_red', 't0', 't1'])
    || new Set(Object.values(observation.result_artifacts)).size !== 4) {
    fail('phase1_recovery_t2_invalid', 'Recovery T2 observation does not bind the exact lease chain and result artifacts')
  }
  const roots = {
    cc_gateway: assertRealPath(observation.cc_root, 'directory', 'phase1_recovery_t2_invalid'),
    sub2api: assertRealPath(observation.sub2api_root, 'directory', 'phase1_recovery_t2_invalid'),
  }
  const testedHeads: JsonObject = {}
  for (const [name, root] of Object.entries(roots)) {
    if (runReviewedGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']).stdout.length !== 0) {
      fail('phase1_recovery_t2_invalid', 'Recovery T2 repository is not clean')
    }
    testedHeads[name] = gitText(root, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'])
  }
  const authorizedHeads = currentLease.repository_heads_and_clean_state_digests
  if (!exactKeys(authorizedHeads as JsonObject, ['cc_gateway', 'sub2api'])
    || Object.entries(testedHeads).some(([name, head]) => authorizedHeads[name]?.head !== head)) {
    fail('phase1_recovery_t2_invalid', 'Recovery T2 tested heads differ from the current lease authority')
  }
  const leaseDigest = digestDeliveryValue(currentLease)
  const results = Object.fromEntries((['t0', 't1', 'owned', 'preserved_red'] as const).map((kind) => {
    const artifact = readStableResultArtifact(observation.result_artifacts[kind])
    validateT2ResultArtifact(artifact.value, kind, leaseDigest, testedHeads)
    return [kind, sha256(artifact.bytes)]
  }))
  return deepFreeze({
    schema_version: 1,
    record_kind: 'phase_1_recovery_t2',
    status: 'green',
    lease_digest: leaseDigest,
    tested_heads: testedHeads,
    owned_outcomes: { b1: 'green', b2: 'green', b3: 'green', listener_tls: 'green' },
    preserved_red: { cc_event_count: 61, cc_unique_count: 61, sidecar_event_count: 51, sidecar_unique_count: 51 },
    command_result_digests: results,
    external_side_effect_count: 0,
    unauthorized_socket_count: 0,
    repositories_clean: { cc_gateway: true, sub2api: true },
  })
}

export function validatePhase1RecoveryT2Record(value: unknown, observation: Phase1RecoveryT2Observation): void {
  if (!isObject(value) || !exactKeys(value, T2_KEYS) || !same(value, derivePhase1RecoveryT2Record(observation))) {
    fail('phase1_recovery_t2_invalid', 'Recovery T2 record differs from the observed lease, roots, or command outcomes')
  }
}

function gitText(root: string, args: readonly string[]): string {
  return runReviewedGit(root, args).stdout.toString('utf8').trim()
}

function assertRealPath(input: string, kind: 'directory' | 'file', code: string): string {
  let metadata
  try { metadata = lstatSync(input) } catch { fail(code, 'required Recovery input is unavailable') }
  if (metadata.isSymbolicLink() || (kind === 'directory' ? !metadata.isDirectory() : !metadata.isFile())) {
    fail(code, 'required Recovery input has an unsafe type')
  }
  return realpathSync(input)
}

function assertRepository(rootInput: string, binding: RepositoryBinding): string {
  const root = assertRealPath(rootInput, 'directory', 'phase1_recovery_root_invalid')
  const status = runReviewedGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']).stdout
  const head = gitText(root, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'])
  if (status.length !== 0 || sha256(gitText(root, ['remote', 'get-url', 'muqihang'])) !== binding.remote_url_digest
    || head !== binding.bootstrap_head
    || head !== gitText(root, ['rev-parse', '--verify', '--end-of-options', 'refs/remotes/muqihang/main^{commit}'])) {
    fail('phase1_recovery_root_invalid', 'Recovery root is not clean current main authority')
  }
  return root
}

function readStableBundle(bundleInput: string, binding: RepositoryBinding, hooks: Phase1RecoveryInputValidationHooks = {}): Readonly<{ path: string; bytes: Buffer }> {
  const bundle = assertRealPath(bundleInput, 'file', 'phase1_recovery_bundle_invalid')
  let descriptor = -1
  try {
    descriptor = openSync(bundle, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    const before = fstatSync(descriptor)
    const bytes = readFileSync(descriptor)
    hooks.after_bundle_read?.(bundle)
    const after = fstatSync(descriptor)
    const pathAfter = lstatSync(bundle)
    if (!before.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || pathAfter.isSymbolicLink() || pathAfter.dev !== after.dev
      || pathAfter.ino !== after.ino || bytes.length !== after.size || sha256(bytes) !== binding.bundle_digest) {
      fail('phase1_recovery_bundle_invalid', 'source bundle bytes are unstable or drifted')
    }
    return Object.freeze({ path: bundle, bytes })
  } finally {
    if (descriptor >= 0) closeSync(descriptor)
  }
}

function verifyQuarantinedBundle(
  root: string,
  bundle: string,
  binding: RepositoryBinding,
  hooks: Phase1RecoveryInputValidationHooks = {},
): void {
  let descriptor = -1
  try {
    descriptor = openSync(bundle, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    const before = fstatSync(descriptor)
    if (!before.isFile() || before.size < 1 || before.size > 1024 * 1024 * 1024) fail('phase1_recovery_bundle_invalid', 'quarantined source bundle has an unsafe type or size')
    const bytes = Buffer.alloc(Number(before.size))
    let offset = 0
    while (offset < bytes.length) {
      const read = readSync(descriptor, bytes, offset, bytes.length - offset, offset)
      if (read < 1) fail('phase1_recovery_bundle_invalid', 'quarantined source bundle is truncated')
      offset += read
    }
    hooks.after_quarantine_open?.(bundle)
    const pathBefore = lstatSync(bundle)
    if (pathBefore.isSymbolicLink() || !pathBefore.isFile() || pathBefore.dev !== before.dev || pathBefore.ino !== before.ino
      || pathBefore.size !== before.size || sha256(bytes) !== binding.bundle_digest) {
      fail('phase1_recovery_bundle_invalid', 'quarantined source bundle drifted')
    }
    assertNoGitReplacementRefs(root)
    const observed = spawnSync(REVIEWED_GIT_EXECUTABLE, ['bundle', 'verify', '/dev/fd/3'], {
      cwd: root,
      encoding: 'buffer',
      env: { ...REVIEWED_GIT_ENVIRONMENT },
      maxBuffer: 32 * 1024 * 1024,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe', descriptor],
    })
    const output = Buffer.concat([Buffer.from(observed.stdout ?? []), Buffer.from(observed.stderr ?? [])]).toString('utf8')
    const after = fstatSync(descriptor)
    const pathAfter = lstatSync(bundle)
    if (observed.error || observed.signal !== null || observed.status !== 0
      || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs
      || pathAfter.isSymbolicLink() || !pathAfter.isFile() || pathAfter.dev !== before.dev || pathAfter.ino !== before.ino
      || !output.split('\n').some((entry) => entry.startsWith(binding.source_head))) {
      fail('phase1_recovery_bundle_invalid', 'quarantined source bundle verification drifted')
    }
  } finally {
    if (descriptor >= 0) closeSync(descriptor)
  }
}

function prepareOutputRoot(outputInput: string): string {
  const parent = assertRealPath(path.dirname(outputInput), 'directory', 'phase1_recovery_output_invalid')
  const output = path.join(parent, path.basename(outputInput))
  if (existsSync(output)) fail('phase1_recovery_output_invalid', 'Recovery output root already exists')
  mkdirSync(output, { mode: 0o700 })
  chmodSync(output, 0o700)
  const metadata = lstatSync(output)
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700) fail('phase1_recovery_output_invalid', 'Recovery output root is not exclusive')
  return realpathSync(output)
}

export function validatePhase1RecoveryInputs(
  input: Phase1RecoveryCli,
  bindings: Phase1RecoveryBindings = PHASE1_RECOVERY_BINDINGS,
  hooks: Phase1RecoveryInputValidationHooks = {},
): void {
  const ccRoot = assertRepository(input.cc_root, bindings.cc_gateway)
  const subRoot = assertRepository(input.sub2api_root, bindings.sub2api)
  const ccBundle = readStableBundle(input.cc_bundle, bindings.cc_gateway, hooks)
  const subBundle = readStableBundle(input.sub2api_bundle, bindings.sub2api, hooks)
  const identities = [ccRoot, subRoot, ccBundle.path, subBundle.path, path.resolve(input.output_root)]
  if (new Set(identities).size !== identities.length) fail('phase1_recovery_root_alias', 'Recovery roots or bundles alias')
  const output = prepareOutputRoot(input.output_root)
  const quarantine = path.join(output, 'bundle-quarantine')
  mkdirSync(quarantine, { mode: 0o700 })
  const ccCopy = path.join(quarantine, 'cc-source.bundle')
  const subCopy = path.join(quarantine, 'sub2api-source.bundle')
  writeFileSync(ccCopy, ccBundle.bytes, { flag: 'wx', mode: 0o400 })
  writeFileSync(subCopy, subBundle.bytes, { flag: 'wx', mode: 0o400 })
  verifyQuarantinedBundle(ccRoot, ccCopy, bindings.cc_gateway, hooks)
  verifyQuarantinedBundle(subRoot, subCopy, bindings.sub2api, hooks)
}

export function validatePhase1RecoveryOutputs(input: Phase1RecoveryCli, bindings: Phase1RecoveryBindings = PHASE1_RECOVERY_BINDINGS): void {
  const ccRoot = assertRepository(input.cc_root, bindings.cc_gateway)
  const subRoot = assertRepository(input.sub2api_root, bindings.sub2api)
  readStableBundle(input.cc_bundle, bindings.cc_gateway)
  readStableBundle(input.sub2api_bundle, bindings.sub2api)
  const output = assertRealPath(input.output_root, 'directory', 'phase1_recovery_output_invalid')
  verifyQuarantinedBundle(ccRoot, path.join(output, 'bundle-quarantine/cc-source.bundle'), bindings.cc_gateway)
  verifyQuarantinedBundle(subRoot, path.join(output, 'bundle-quarantine/sub2api-source.bundle'), bindings.sub2api)
}

export function parsePhase1RecoveryGoRedEvidence(
  stdout: string,
  family: 'b1' | 'b2' | 'b3',
  bindings: Phase1RecoveryBindings = PHASE1_RECOVERY_BINDINGS,
): Readonly<{ top_level_leaves: readonly string[]; failure_signature_digest: string }> {
  const failed = new Set<string>()
  const failedTests = new Set<string>()
  let output = ''
  for (const line of stdout.split('\n')) {
    if (!line) continue
    let event: JsonObject
    try { event = JSON.parse(line) } catch { fail('phase1_recovery_vertical_red_mismatch', 'Go RED output is malformed') }
    if (event.Action === 'output' && typeof event.Output === 'string') output += event.Output
    if (event.Action === 'fail' && typeof event.Test === 'string' && event.Test.length > 0) {
      failed.add(event.Test.split('/')[0])
      failedTests.add(event.Test)
    }
  }
  const topLevelLeaves = Object.freeze([...failed].sort(compareBytes))
  const signatureDigest = sha256(Buffer.from(JSON.stringify([...failedTests].sort(compareBytes)), 'utf8'))
  const signature = bindings.pre_replay_failure_signatures[family]
  if (!same(topLevelLeaves, bindings.pre_replay_red[family]) || signatureDigest !== signature.failed_tests_digest
    || signature.required_output_markers.some((marker) => !output.includes(marker))) {
    fail('phase1_recovery_vertical_red_mismatch', 'Go RED semantic failure signature drifted')
  }
  return Object.freeze({ top_level_leaves: topLevelLeaves, failure_signature_digest: signatureDigest })
}

function runGoRed(family: 'b1' | 'b2' | 'b3', input: Phase1RecoveryCli, bindings: Phase1RecoveryBindings): RedRecord {
  const expected = bindings.pre_replay_red[family]
  const packagePath = family === 'b1' ? './internal/service' : './internal/server/routes'
  const pattern = `^(${expected.join('|')})$`
  const cacheRoot = path.join(input.output_root, `go-build-cache-${family}`)
  mkdirSync(cacheRoot, { mode: 0o700 })
  const moduleCacheMetadata = lstatSync(GO_MODULE_CACHE)
  const goMetadata = lstatSync(GO_EXECUTABLE)
  if (!moduleCacheMetadata.isDirectory() || moduleCacheMetadata.isSymbolicLink() || (moduleCacheMetadata.mode & 0o022) !== 0
    || !goMetadata.isFile() || goMetadata.isSymbolicLink()) fail('phase1_recovery_dependency_invalid', 'reviewed Go toolchain is unavailable')
  const sandboxProfile = '(version 1) (allow default) (deny network*)'
  const result = spawnSync('/usr/bin/sandbox-exec', ['-p', sandboxProfile, GO_EXECUTABLE, 'test', '-mod=readonly', '-tags', 'phase0red', packagePath, '-run', pattern, '-count=1', '-json'], {
    cwd: path.join(input.sub2api_root, 'backend'),
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      HOME: ACCOUNT_HOME,
      PATH: '/opt/homebrew/bin:/usr/bin:/bin',
      LANG: 'C',
      LC_ALL: 'C',
      GOCACHE: cacheRoot,
      GOMODCACHE: GO_MODULE_CACHE,
      GOPROXY: 'off',
      GOSUMDB: 'off',
      GOTOOLCHAIN: 'local',
      GOFLAGS: '-mod=readonly',
    },
  })
  if (result.error || result.status === 0 || result.status === null || result.signal !== null) {
    fail('phase1_recovery_vertical_red_mismatch', 'Go RED did not reach the exact expected failure lifecycle')
  }
  const evidence = parsePhase1RecoveryGoRedEvidence(result.stdout, family, bindings)
  const deniedAttempts = (result.stderr.match(/(?:operation not permitted|sandbox|deny network)/gi) ?? []).length
  if (deniedAttempts !== 0) fail('phase1_recovery_external_side_effect', 'Go RED attempted a forbidden external network effect')
  const observer = Object.freeze({ boundary: 'sandbox_network_deny' as const, external_side_effect_count: 0 as const, unauthorized_socket_count: 0 as const })
  return Object.freeze({ family, status: 'expected_fail', leaf_names: evidence.top_level_leaves, classifications: bindings.pre_replay_classifications[family], failure_signature_digest: evidence.failure_signature_digest, observer, external_side_effect_count: observer.external_side_effect_count, unauthorized_socket_count: observer.unauthorized_socket_count })
}

function activeListenerCount(): number {
  const handles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? []
  return handles.filter((handle) => isObject(handle) && handle.listening === true && typeof handle.address === 'function').length
}

async function runListenerRed(input: Phase1RecoveryCli, bindings: Phase1RecoveryBindings): Promise<RedRecord> {
  const proxyModule = await import(`${pathToFileURL(path.join(input.cc_root, 'src/proxy.ts')).href}?phase1-recovery`)
  const helperModule = await import(`${pathToFileURL(path.join(input.cc_root, 'tests/helpers.ts')).href}?phase1-recovery`)
  const startProxy = proxyModule.startProxy as (config: JsonObject) => unknown
  const baseConfig = helperModule.baseConfig as (overrides?: JsonObject) => JsonObject
  const observed: string[] = []
  const listenersBefore = activeListenerCount()
  try {
    startProxy(baseConfig({ server: { host: '0.0.0.0', port: -1, tls: { cert: '', key: '' } } }))
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_SOCKET_BAD_PORT') observed.push('listener_boundary_not_enforced')
  }
  try {
    startProxy(baseConfig({ server: { host: '127.0.0.1', port: 0, tls: { cert: '/phase1-recovery/missing.crt', key: '/phase1-recovery/missing.key' } } }))
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') observed.push('tls_boundary_order_not_enforced')
  }
  if (!same(observed, bindings.pre_replay_red.listener_tls)) fail('phase1_recovery_vertical_red_mismatch', 'listener/TLS RED ordering drifted')
  const unauthorizedSocketCount = Math.max(0, activeListenerCount() - listenersBefore)
  if (unauthorizedSocketCount !== 0) fail('phase1_recovery_external_side_effect', 'listener/TLS RED left an unauthorized listener')
  const failureSignatureDigest = sha256(Buffer.from(JSON.stringify(observed), 'utf8'))
  if (failureSignatureDigest !== bindings.pre_replay_failure_signatures.listener_tls.failed_tests_digest) fail('phase1_recovery_vertical_red_mismatch', 'listener/TLS failure signature drifted')
  const observer = Object.freeze({ boundary: 'active_listener_inventory' as const, external_side_effect_count: 0 as const, unauthorized_socket_count: 0 as const })
  return Object.freeze({ family: 'listener_tls', status: 'expected_fail', leaf_names: bindings.pre_replay_red.listener_tls, classifications: bindings.pre_replay_classifications.listener_tls, failure_signature_digest: failureSignatureDigest, observer, external_side_effect_count: observer.external_side_effect_count, unauthorized_socket_count: observer.unauthorized_socket_count })
}

function defaultReplayRequired(input: Phase1RecoveryCli): boolean {
  return PRE_REPLAY_ABSENT_PATHS.every((entry) => !existsSync(path.join(input.cc_root, entry)))
}

function defaultPersistRecord(input: Phase1RecoveryCli, record: JsonObject): void {
  const output = assertRealPath(input.output_root, 'directory', 'phase1_recovery_output_invalid')
  writeFileSync(path.join(output, OUTPUT_RECORD), `${canonicalDeliveryJson(record)}\n`, { flag: 'wx', mode: 0o600 })
}

const DEFAULT_DEPENDENCIES: Phase1RecoveryDependencies = Object.freeze({
  validate_inputs: validatePhase1RecoveryInputs,
  validate_outputs: validatePhase1RecoveryOutputs,
  observe_baseline: (input) => Object.freeze({ cc_gateway: gitText(input.cc_root, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}']), sub2api: gitText(input.sub2api_root, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}']) }),
  run_red: (family, input, bindings) => family === 'listener_tls' ? runListenerRed(input, bindings) : runGoRed(family, input, bindings),
  replay_required: defaultReplayRequired,
  persist_record: defaultPersistRecord,
})

function validateRedRecord(value: unknown, family: RecoveryFamily, bindings: Phase1RecoveryBindings): asserts value is RedRecord {
  if (!isObject(value) || !exactKeys(value, RECORD_KEYS) || value.family !== family || value.status !== 'expected_fail'
    || !same(value.leaf_names, bindings.pre_replay_red[family])
    || !same(value.classifications, bindings.pre_replay_classifications[family]) || value.external_side_effect_count !== 0
    || value.failure_signature_digest !== bindings.pre_replay_failure_signatures[family].failed_tests_digest
    || !isObject(value.observer) || value.observer.external_side_effect_count !== 0 || value.observer.unauthorized_socket_count !== 0
    || value.unauthorized_socket_count !== 0) {
    fail('phase1_recovery_vertical_red_mismatch', 'pre-replay RED record is not exact')
  }
}

export async function runPhase1RecoveryPreReplay(
  input: Phase1RecoveryCli,
  bindings: Phase1RecoveryBindings = PHASE1_RECOVERY_BINDINGS,
  dependencies: Phase1RecoveryDependencies = DEFAULT_DEPENDENCIES,
): Promise<Readonly<JsonObject>> {
  if (input.command !== 'pre-replay-red') fail('phase1_recovery_cli_invalid', 'unsupported Recovery command')
  await dependencies.validate_inputs(input, bindings)
  const families: RedRecord[] = []
  for (const family of RECOVERY_FAMILIES) {
    const record = await dependencies.run_red(family, input, bindings)
    validateRedRecord(record, family, bindings)
    families.push(record)
  }
  if (!await dependencies.replay_required(input, bindings)) fail('phase1_recovery_replay_sentinel_invalid', 'current-main roots do not require the reviewed replay')
  await dependencies.validate_outputs(input, bindings)
  const baselineHeads = await dependencies.observe_baseline(input)
  if (!COMMIT.test(baselineHeads.cc_gateway) || !COMMIT.test(baselineHeads.sub2api)) fail('phase1_recovery_root_invalid', 'Recovery baseline heads are malformed')
  const record = deepFreeze({
    schema_version: 1,
    record_kind: 'phase_1_recovery_pre_replay_red',
    status: 'red_confirmed',
    plan: { path: bindings.plan_path, digest: bindings.plan_digest, reviewed_commit: bindings.reviewed_plan_commit },
    contract_digest: bindings.contract_digest,
    baseline_heads: baselineHeads,
    remote_url_digests: { cc_gateway: bindings.cc_gateway.remote_url_digest, sub2api: bindings.sub2api.remote_url_digest },
    source_bundle_digests: { cc_gateway: bindings.cc_gateway.bundle_digest, sub2api: bindings.sub2api.bundle_digest },
    families,
    replay_sentinel: 'phase1_recovery_replay_required',
    cleanup_candidates: ['bundle-quarantine', 'go-build-cache-b1', 'go-build-cache-b2', 'go-build-cache-b3'],
  })
  await dependencies.persist_record(input, record)
  return record
}

async function main(): Promise<void> {
  try {
    const input = parsePhase1RecoveryCli(process.argv.slice(2))
    const record = await runPhase1RecoveryPreReplay(input)
    process.stdout.write(`${canonicalDeliveryJson({ record: OUTPUT_RECORD, status: record.status })}\n`)
  } catch (error) {
    process.stderr.write(`${canonicalDeliveryJson({ code: String((error as { code?: string }).code ?? 'phase1_recovery_failed') })}\n`)
    process.exitCode = 1
  }
}

let invokedDirectly = false
try { invokedDirectly = realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url)) } catch { /* import-only */ }
if (invokedDirectly) await main()
