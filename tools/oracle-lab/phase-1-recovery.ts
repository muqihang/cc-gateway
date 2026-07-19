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
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import { userInfo } from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

import { canonicalDeliveryJson } from './delivery-authority.js'
import { runReviewedGit } from './secure-runtime.js'

type JsonObject = Record<string, any>
type RecoveryFamily = 'b1' | 'b2' | 'b3' | 'listener_tls'

type RepositoryBinding = Readonly<{
  remote_url_digest: string
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
}>

export type Phase1RecoveryInputValidationHooks = Readonly<{
  after_bundle_read?: (bundle: string) => void
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
const RECORD_KEYS = Object.freeze(['classifications', 'external_side_effect_count', 'family', 'leaf_names', 'status', 'unauthorized_socket_count'])
const REPLAY_RECORD_KEYS = Object.freeze(['cc_gateway', 'record_kind', 'schema_version', 'status', 'sub2api'])
const REPLAY_REPOSITORY_KEYS = Object.freeze(['protected_path_intersection_count', 'replacement_commits', 'skipped_source_commits', 'source_commits'])
const T2_KEYS = Object.freeze([
  'external_side_effect_count', 'lease_digest', 'owned_outcomes', 'preserved_red', 'record_kind',
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

function validateReplayRepository(value: unknown, binding: RepositoryBinding): void {
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

export function validatePhase1RecoveryReplayMapping(value: unknown, bindings: Phase1RecoveryBindings = PHASE1_RECOVERY_BINDINGS): void {
  if (!isObject(value) || !exactKeys(value, REPLAY_RECORD_KEYS) || value.schema_version !== 1
    || value.record_kind !== 'phase_1_recovery_replay_mapping' || value.status !== 'equivalent') {
    fail('phase1_recovery_mapping_invalid', 'Recovery replay mapping record is malformed')
  }
  validateReplayRepository(value.cc_gateway, bindings.cc_gateway)
  validateReplayRepository(value.sub2api, bindings.sub2api)
}

export function validatePhase1RecoveryT2Record(value: unknown): void {
  if (!isObject(value) || !exactKeys(value, T2_KEYS) || value.schema_version !== 1
    || value.record_kind !== 'phase_1_recovery_t2' || value.status !== 'green'
    || !DIGEST.test(String(value.lease_digest)) || !isObject(value.tested_heads)
    || !COMMIT.test(String(value.tested_heads.cc_gateway)) || !COMMIT.test(String(value.tested_heads.sub2api))
    || !same(value.owned_outcomes, { b1: 'green', b2: 'green', b3: 'green', listener_tls: 'green' })
    || !same(value.preserved_red, { cc_event_count: 61, cc_unique_count: 61, sidecar_event_count: 51, sidecar_unique_count: 51 })
    || value.external_side_effect_count !== 0 || value.unauthorized_socket_count !== 0
    || !same(value.repositories_clean, { cc_gateway: true, sub2api: true })) {
    fail('phase1_recovery_t2_invalid', 'Recovery T2 record does not bind the exact owned and preserved outcomes')
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
  if (status.length !== 0 || sha256(gitText(root, ['remote', 'get-url', 'muqihang'])) !== binding.remote_url_digest
    || gitText(root, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}']) !== gitText(root, ['rev-parse', '--verify', '--end-of-options', 'refs/remotes/muqihang/main^{commit}'])) {
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

function verifyQuarantinedBundle(root: string, bundle: string, binding: RepositoryBinding): void {
  const metadata = lstatSync(bundle)
  if (!metadata.isFile() || metadata.isSymbolicLink() || sha256(readFileSync(bundle)) !== binding.bundle_digest) {
    fail('phase1_recovery_bundle_invalid', 'quarantined source bundle drifted')
  }
  runReviewedGit(root, ['bundle', 'verify', bundle])
  const heads = runReviewedGit(root, ['bundle', 'list-heads', bundle]).stdout.toString('utf8').trim().split('\n')
  if (!heads.some((entry) => entry.startsWith(`${binding.source_head} `))) fail('phase1_recovery_bundle_invalid', 'source bundle head is absent')
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
  verifyQuarantinedBundle(ccRoot, ccCopy, bindings.cc_gateway)
  verifyQuarantinedBundle(subRoot, subCopy, bindings.sub2api)
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

function parseGoFailedLeaves(stdout: string): readonly string[] {
  const failed = new Set<string>()
  for (const line of stdout.split('\n')) {
    if (!line) continue
    let event: JsonObject
    try { event = JSON.parse(line) } catch { fail('phase1_recovery_vertical_red_mismatch', 'Go RED output is malformed') }
    if (event.Action === 'fail' && typeof event.Test === 'string' && event.Test.length > 0) failed.add(event.Test.split('/')[0])
  }
  return Object.freeze([...failed].sort(compareBytes))
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
  const result = spawnSync(GO_EXECUTABLE, ['test', '-mod=readonly', '-tags', 'phase0red', packagePath, '-run', pattern, '-count=1', '-json'], {
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
  const leaves = parseGoFailedLeaves(result.stdout)
  if (!same(leaves, expected)) fail('phase1_recovery_vertical_red_mismatch', 'Go RED failing leaves drifted')
  return Object.freeze({ family, status: 'expected_fail', leaf_names: expected, classifications: bindings.pre_replay_classifications[family], external_side_effect_count: 0, unauthorized_socket_count: 0 })
}

async function runListenerRed(input: Phase1RecoveryCli, bindings: Phase1RecoveryBindings): Promise<RedRecord> {
  const proxyModule = await import(`${pathToFileURL(path.join(input.cc_root, 'src/proxy.ts')).href}?phase1-recovery`)
  const helperModule = await import(`${pathToFileURL(path.join(input.cc_root, 'tests/helpers.ts')).href}?phase1-recovery`)
  const startProxy = proxyModule.startProxy as (config: JsonObject) => unknown
  const baseConfig = helperModule.baseConfig as (overrides?: JsonObject) => JsonObject
  const observed: string[] = []
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
  return Object.freeze({ family: 'listener_tls', status: 'expected_fail', leaf_names: bindings.pre_replay_red.listener_tls, classifications: bindings.pre_replay_classifications.listener_tls, external_side_effect_count: 0, unauthorized_socket_count: 0 })
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
