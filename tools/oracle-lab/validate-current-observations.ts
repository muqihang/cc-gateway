import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type ValidationError = { code: string; path: string; message: string }
export type ValidationResult = { ok: boolean; errors: ValidationError[] }

type Value = Record<string, any>
type ValidationOptions = { previousLedger?: unknown; previousLedgerCommit?: string }

const DIGEST = /^sha256:[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/
const OBSERVATION_ID = /^RA-CURRENT-(?:00[1-9]|010)$/
const EVENT_ID = /^RA-CURRENT-(?:00[1-9]|010)-E\d{3}$/
const VERIFICATION_ID = /^OBS\d{3}(?:-[A-Z0-9]+)*$/
const STATES = new Set(['confirmed', 'partial', 'changed', 'resolved', 'stale'])
const PHASES = new Set(['phase_1', 'phase_2', 'phase_3a', 'phase_3b', 'phase_3_5', 'phase_4', 'phase_5'])
const WORK_PACKAGES = new Set(Array.from({ length: 10 }, (_, index) => `WP-R${index}`))
const SCOPES = new Set(['local_structural', 'local_observational', 'cross_repository_local', 'process_local'])
const REPOSITORIES = new Set(['cc-gateway', 'sub2api'])
const ROOT_FIELDS = ['schema_version', 'ledger_kind', 'ledger_role', 'task_0b_entry_binding', 'repository_commits', 'verifications', 'append_history', 'observations']
const ROW_FIELDS = ['observation_id', 'required_consequence', 'prohibited_promotion', 'status_history']
const EVENT_FIELDS = ['event_id', 'sequence', 'state', 'source_section', 'revalidated_at', 'repository_bindings', 'anchors', 'verification_ids', 'evidence_digest', 'result_digest', 'observation_scope', 'confidence', 'phase_slices', 'wp_umbrella', 'change_reason', 'safe_result', 'previous_event_digest', 'event_digest']
const VERIFICATION_FIELDS = ['verification_id', 'repository', 'cwd', 'argv', 'environment_profile', 'env', 'expected_classification', 'result_digest']
const APPEND_FIELDS = ['sequence', 'appended_at', 'previous_ledger_commit', 'previous_ledger_digest', 'previous_append_digest', 'event_digests', 'append_digest']
const CANONICAL_EVIDENCE_DIGESTS: Record<string, string> = {
  'RA-CURRENT-001': 'sha256:01c3bdc63412ddd0c8429f07f3cb668086a8914c4ce4a2c6449c72974b8dd2b6',
  'RA-CURRENT-002': 'sha256:00218a1980bf8bb78cf6a21e85ebe91bfeeb9c14628f83033e62ae4af02c4650',
  'RA-CURRENT-003': 'sha256:3db1edb159c91462414ed5abbd436949fa6309b7adf7c6cea070b40d01f0fcf0',
  'RA-CURRENT-004': 'sha256:500885f61b782b18a2c0752db6b22cea9823b4829daf1598655119f6f4523044',
  'RA-CURRENT-005': 'sha256:b56e114d6a51546a07cfed683ee56dc02ac8b7f02252ebe93e02e8fa437942e1',
  'RA-CURRENT-006': 'sha256:2a527a1f3e3cbcb5c2ced7bcf9499c934608bff6295dc7d29c8c5106cefd8ccf',
  'RA-CURRENT-007': 'sha256:2f3cc75fd939e9b5bd3a8f0e8d7203b65bb0e223b19e4f35acd147d12d29d58c',
  'RA-CURRENT-008': 'sha256:b5f4bdc135a42878e398e2edc7e760c57e14ff947c0e3ebb128db6d6c59f6d99',
  'RA-CURRENT-009': 'sha256:bd6c99550da93feaf4f8e8f1e2ad0b66c6d4d5e6bb31437f4cb9ca9de4b6d36a',
  'RA-CURRENT-010': 'sha256:66cc6fa5637659dd0aaf6bcdda20eb72a460987597de8e568c2b697d7857bf36',
}

const TASK_0B_BINDING = {
  repository: 'cc-gateway',
  path: 'docs/superpowers/evidence/p0-1/p0-1-entry-baseline.json',
  digest: 'sha256:e6d7426c63f8bf96a91de5c47d9fc6807fae5da68ad507e8ba65b93f2732f235',
}

const INITIAL_COMMITS = {
  cc_gateway: { repository: 'cc-gateway', commit: 'c7404e36c576965a6177f6d25cd8657b6550261d' },
  sub2api: { repository: 'sub2api', commit: 'd5a42bbd24d15af2ce7646d050a5ae5c77911d4f' },
}

const CANONICAL_ROWS: Record<string, {
  state: string
  verificationIds: string[]
  phases: string[]
  wp: string
  consequence: string
  prohibited: string
}> = {
  'RA-CURRENT-001': { state: 'confirmed', verificationIds: ['OBS001-T'], phases: ['phase_3a'], wp: 'WP-R4', consequence: 'Expand the version/change-point evidence matrix before profile synthesis.', prohibited: 'Existing 2.1.179 harness cannot satisfy 2.1.207 evidence or profile completion.' },
  'RA-CURRENT-002': { state: 'confirmed', verificationIds: ['OBS002-T1', 'OBS002-T2'], phases: ['phase_3b'], wp: 'WP-R5', consequence: 'Generate a coherent 2.1.207 profile from accepted evidence.', prohibited: 'No handwritten 2.1.207 persona or outbound-persona promotion.' },
  'RA-CURRENT-003': { state: 'confirmed', verificationIds: ['OBS003-G', 'OBS003-T'], phases: ['phase_3a', 'phase_4'], wp: 'WP-R7', consequence: 'Capture evidence, then implement bounded layered response/outcome facts.', prohibited: 'Transparent pipe/chunk capture cannot authorize retry, cost, budget, scheduler, or quarantine decisions.' },
  'RA-CURRENT-004': { state: 'partial', verificationIds: ['OBS004-SUB', 'OBS004-CC'], phases: ['phase_2', 'phase_4'], wp: 'WP-R2', consequence: 'Preserve known re-registration rotation/promotion/TLS-backfill behavior while designing the full signed lifecycle.', prohibited: 'No freeze/drain/revoke/delete/query/reconcile or complete lifecycle claim.' },
  'RA-CURRENT-005': { state: 'confirmed', verificationIds: ['OBS005-CC', 'OBS005-GO-RED'], phases: ['phase_2', 'phase_4'], wp: 'WP-R3', consequence: 'Specify then implement request capability, replay ledger, and resolve/classify/pin/dial enforcement.', prohibited: 'Protected production and real canary remain disabled.' },
  'RA-CURRENT-006': { state: 'confirmed', verificationIds: ['OBS006-SUB', 'OBS006-CC'], phases: ['phase_2', 'phase_3b'], wp: 'WP-R6', consequence: 'Record trusted-device proof as an unavailable capability until independent issuer/verifier lifecycle exists.', prohibited: 'Stable/equal `device_id` is not device proof.' },
  'RA-CURRENT-007': { state: 'confirmed', verificationIds: ['OBS007-G', 'OBS007-T'], phases: ['phase_2', 'phase_4'], wp: 'WP-R8', consequence: 'Add versioned readiness and later shared/replica-consistent authority.', prohibited: 'No multi-replica readiness or production capability claim.' },
  'RA-CURRENT-008': { state: 'confirmed', verificationIds: ['OBS008-G', 'OBS008-T'], phases: ['phase_1', 'phase_4'], wp: 'WP-R8', consequence: 'Plan loopback fail-closed guard in Phase 1 and implement remote TLS/auth/certificate gates before deployment.', prohibited: 'No remote-listen or production authorization.' },
  'RA-CURRENT-009': { state: 'confirmed', verificationIds: ['OBS009-RED-A', 'OBS009-RED-B'], phases: ['phase_2'], wp: 'WP-R1', consequence: 'Preserve the frozen P0.1 failure, repair only four fixture blocks, and add both tests to GREEN.', prohibited: 'Joint-chain evidence is not GREEN until the append-only resolved event exists.' },
  'RA-CURRENT-010': { state: 'confirmed', verificationIds: ['OBS010-G'], phases: ['phase_4'], wp: 'WP-R6', consequence: 'Split only touched security boundaries incrementally, with WP-R7 related response ownership.', prohibited: 'No big-bang refactor and no claim that current concentrated logic is independently reviewable.' },
}

const EXPECTED_VERIFICATIONS: Record<string, [string, string, string[], string, string]> = {
  'OBS001-T': ['cc-gateway', '.', ['npm', 'exec', 'tsx', 'tests/native-oracle-matrix.test.ts'], 'HERMETIC_NETWORK_ENV', 'pass'],
  'OBS002-T1': ['cc-gateway', '.', ['npm', 'exec', 'tsx', 'tests/persona-registry.test.ts'], 'HERMETIC_NETWORK_ENV', 'pass'],
  'OBS002-T2': ['cc-gateway', '.', ['npm', 'exec', 'tsx', 'tests/formal-pool-canonical-promotion.test.ts'], 'HERMETIC_NETWORK_ENV', 'pass'],
  'OBS003-G': ['cc-gateway', '.', ['codegraph', 'explore', 'handleRequest RawCaptureSink EgressSidecarStreamResponse pipe Buffer.concat'], 'INDEXED_CODEGRAPH', 'anchors_present_no_outcome_envelope_owner'],
  'OBS003-T': ['cc-gateway', '.', ['npm', 'exec', 'tsx', 'tests/formal-pool-real-chain-mock-response.test.ts'], 'HERMETIC_NETWORK_ENV', 'pass'],
  'OBS004-SUB': ['sub2api', '.', ['codegraph', 'explore', 'FormalPoolCCGatewayRuntimeRegistrar RegisterCCGatewayRuntime freeze drain revoke delete query reconcile'], 'INDEXED_CODEGRAPH', 'register_present_full_lifecycle_absent'],
  'OBS004-CC': ['cc-gateway', '.', ['codegraph', 'explore', 'RUNTIME_REGISTER_PATH sameRuntimeMappingAuthorityAllowingCredentialRotation isAllowedRuntimeCanonicalPromotion sameRuntimeMappingAuthorityAllowingTLSProfileBackfill'], 'INDEXED_CODEGRAPH', 'limited_paths_present'],
  'OBS005-CC': ['cc-gateway', '.', ['codegraph', 'explore', 'EgressSidecarControl Control replay nonce deadline body hash header hash attempt key epoch resolve classify pin dial'], 'INDEXED_CODEGRAPH', 'capability_and_replay_fields_missing'],
  'OBS005-GO-RED': ['cc-gateway', 'sidecar/egress-tls-sidecar', ['go', 'test', '-tags=phase0red', './internal/control', './internal/server', '-count=1'], 'HERMETIC_NETWORK_ENV', 'expected_fail_b5_b6'],
  'OBS006-SUB': ['sub2api', '.', ['codegraph', 'explore', 'ccGatewayGeneratedDeviceID ccGatewayDeviceID scopedStickyHMACBytes'], 'INDEXED_CODEGRAPH', 'hmac_derived_id_path_present'],
  'OBS006-CC': ['cc-gateway', '.', ['codegraph', 'explore', 'normalizeRuntimeAccountMapping verifyProviderAwareFinalRequest device_id equality'], 'INDEXED_CODEGRAPH', 'format_equality_present_issuer_verifier_absent'],
  'OBS007-G': ['cc-gateway', '.', ['codegraph', 'explore', 'ProxyRuntimeState replayRuntimeMappings RUNTIME_MAPPING_FILE_ENV FORMAL_POOL_SESSION_LEDGER_FILE_ENV /_health'], 'INDEXED_CODEGRAPH', 'process_map_local_file_authority_present'],
  'OBS007-T': ['cc-gateway', '.', ['npm', 'exec', 'tsx', 'tests/health-verify.test.ts'], 'HERMETIC_NETWORK_ENV', 'pass'],
  'OBS008-G': ['cc-gateway', '.', ['codegraph', 'explore', 'Config server.host startProxy listenHost server.listen'], 'INDEXED_CODEGRAPH', 'configured_host_passed_to_listen'],
  'OBS008-T': ['cc-gateway', '.', ['npm', 'exec', 'tsx', 'tests/security-boundary.test.ts'], 'HERMETIC_NETWORK_ENV', 'pass_current_default_ipv6_any'],
  'OBS009-RED-A': ['sub2api', 'backend', ['go', 'test', './internal/service', '-run', '^TestClaudePlatformAWSLocalFullChainE2EUsesCCGatewayAndSafeMockUpstream$', '-count=1', '-v'], 'HERMETIC_NETWORK_ENV', 'expected_fail_gateway_compromise_boundary_required'],
  'OBS009-RED-B': ['sub2api', 'backend', ['go', 'test', './internal/service', '-run', '^TestJointLocalCaptureAcceptanceArtifact$', '-count=1', '-v'], 'HERMETIC_NETWORK_ENV', 'expected_fail_gateway_compromise_boundary_required'],
  'OBS010-G': ['cc-gateway', '.', ['codegraph', 'node', 'src/proxy.ts'], 'INDEXED_CODEGRAPH', 'one_4726_line_concentrated_owner_file'],
}

function isObject(value: unknown): value is Value {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function add(errors: ValidationError[], code: string, pathValue: string, message: string) {
  errors.push({ code, path: pathValue, message })
}

function same(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

function uniqueStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0) && new Set(value).size === value.length
}

function exactKeys(value: unknown, allowed: string[], base: string, errors: ValidationError[]): value is Value {
  if (!isObject(value)) {
    add(errors, 'invalid_record', base, 'value must be an object')
    return false
  }
  for (const field of allowed) {
    if (field === 'safe_result') continue
    if (!Object.hasOwn(value, field)) add(errors, 'missing_field', `${base}.${field}`, `${field} is required`)
  }
  for (const field of Object.keys(value)) {
    if (field === 'account_id' || field === 'proxy_id') add(errors, 'sensitive_identifier', `${base}.${field}`, 'account and proxy identifiers are forbidden')
    else if (!allowed.includes(field)) add(errors, 'unknown_field', `${base}.${field}`, `${field} is not allowed`)
  }
  return true
}

function isRelativeRepositoryPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 300 && !path.isAbsolute(value) && !/^[A-Za-z]:[\\/]/.test(value) && !value.split('/').includes('..') && /^[A-Za-z0-9._/-]+$/.test(value)
}

function sensitiveText(value: unknown): boolean {
  return typeof value === 'string' && /(Bearer\s+[A-Za-z0-9._-]+|sk-ant-[A-Za-z0-9_-]+|\bprompt\s*:|\b(?:credential|secret|token)\s*[=:]\s*\S+|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i.test(value)
}

function prohibitedOverclaim(value: unknown): boolean {
  return typeof value === 'string' && /\b(?:provider behavior|trusted-device proof|device proof|protected production|production|real canary|multi-replica authority)\b.{0,50}\b(?:confirmed|verified|available|enabled|authorized|ready)\b/i.test(value)
}

function scanPersistedValue(value: unknown, base: string, errors: ValidationError[]) {
  if (typeof value === 'string') {
    if (sensitiveText(value)) add(errors, 'sensitive_material', base, 'persisted strings must not contain prompts, credentials, secrets, or tokens')
    if (prohibitedOverclaim(value)) add(errors, 'prohibited_overclaim', base, 'local observations cannot promote provider, device, production, canary, or replica authority')
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanPersistedValue(entry, `${base}[${index}]`, errors))
    return
  }
  if (!isObject(value)) return
  for (const [key, entry] of Object.entries(value)) {
    if (/^(?:account_id|proxy_id)$/i.test(key)) add(errors, 'sensitive_identifier', `${base}.${key}`, 'account and proxy identifiers are forbidden')
    if (/^(?:prompt|system_prompt|credential|credentials|secret|secrets|raw_output|raw_command_output)$/i.test(key)) add(errors, 'sensitive_material', `${base}.${key}`, 'raw output, prompts, credentials, and secrets are forbidden')
    scanPersistedValue(entry, `${base}.${key}`, errors)
  }
}

function validateRepositoryBinding(value: unknown, base: string, errors: ValidationError[]) {
  if (!isObject(value) || Object.keys(value).length !== 2 || !REPOSITORIES.has(String(value.repository)) || typeof value.commit !== 'string' || !COMMIT.test(value.commit)) {
    add(errors, 'invalid_commit', base, 'repository binding requires a named repository and 40-character commit')
  }
}

function validateAnchor(value: unknown, base: string, errors: ValidationError[]) {
  if (!isObject(value)) return add(errors, 'invalid_anchor', base, 'anchor must be an object')
  const allowed = ['repository', 'path', 'symbols', 'test_names']
  if (Object.keys(value).some((field) => !allowed.includes(field))) add(errors, 'unknown_field', base, 'anchor has an unknown field')
  if (!REPOSITORIES.has(String(value.repository))) add(errors, 'invalid_repository', `${base}.repository`, 'unknown repository')
  if (!isRelativeRepositoryPath(value.path)) add(errors, 'unsafe_path', `${base}.path`, 'anchor path must be repository-relative')
  const hasSymbols = uniqueStrings(value.symbols)
  const hasTests = uniqueStrings(value.test_names)
  if (!hasSymbols && !hasTests) add(errors, 'invalid_anchor', base, 'anchor requires symbols or test names')
  if (hasSymbols && value.symbols.some((item: string) => item.length > 120 || !/^[A-Za-z0-9_./-]+$/.test(item))) add(errors, 'invalid_anchor', `${base}.symbols`, 'invalid symbol')
  if (hasTests && value.test_names.some((item: string) => item.length > 180)) add(errors, 'invalid_anchor', `${base}.test_names`, 'invalid test name')
}

function safeFailureDigest(): string {
  return `sha256:${createHash('sha256').update('OBS009-RED-A|expected_fail|gateway_compromise_boundary_required\nOBS009-RED-B|expected_fail|gateway_compromise_boundary_required\n').digest('hex')}`
}

function validateSafeResult(value: unknown, base: string, errors: ValidationError[]) {
  const expected = {
    kind: 'stable_failure_code_aggregate',
    results: [
      { verification_id: 'OBS009-RED-A', classification: 'expected_fail', failure_code: 'gateway_compromise_boundary_required' },
      { verification_id: 'OBS009-RED-B', classification: 'expected_fail', failure_code: 'gateway_compromise_boundary_required' },
    ],
    aggregate_digest: safeFailureDigest(),
  }
  if (!same(value, expected)) add(errors, 'invalid_safe_result', base, 'RA-CURRENT-009 safe result must contain only the ordered stable failure aggregate')
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

export function computeObservationEvidenceDigest(event: Value): string {
  return digest({ repository_bindings: event.repository_bindings, anchors: event.anchors })
}

export function computeObservationEventDigest(event: Value): string {
  const { event_digest: _eventDigest, ...payload } = event
  return digest(payload)
}

export function computeAppendEntryDigest(entry: Value): string {
  const { append_digest: _appendDigest, ...payload } = entry
  return digest(payload)
}

export function computeCurrentObservationLedgerDigest(ledger: Value): string {
  return digest(ledger)
}

function validateVerification(value: unknown, index: number, errors: ValidationError[], ids: Set<string>) {
  const base = `$.verifications[${index}]`
  if (!exactKeys(value, VERIFICATION_FIELDS, base, errors)) return
  if (typeof value.verification_id !== 'string' || !VERIFICATION_ID.test(value.verification_id)) add(errors, 'invalid_verification_id', `${base}.verification_id`, 'invalid verification ID')
  else if (ids.has(value.verification_id)) add(errors, 'duplicate_verification_id', `${base}.verification_id`, 'verification ID is duplicated')
  else ids.add(value.verification_id)
  if (!REPOSITORIES.has(String(value.repository))) add(errors, 'invalid_repository', `${base}.repository`, 'unknown repository')
  if (value.cwd !== '.' && !isRelativeRepositoryPath(value.cwd)) add(errors, 'unsafe_path', `${base}.cwd`, 'cwd must be repository-relative')
  if (!Array.isArray(value.argv) || value.argv.length < 2 || value.argv.length > 12 || value.argv.some((entry: unknown) => typeof entry !== 'string' || entry.length < 1 || entry.length > 240)) add(errors, 'invalid_command', `${base}.argv`, 'argv must contain 2-12 bounded string arguments')
  if (Array.isArray(value.argv) && (['sh', 'bash', 'zsh'].includes(value.argv[0]) || value.argv.includes('-c'))) add(errors, 'invalid_command', `${base}.argv`, 'shell command wrappers are forbidden')
  if (!['HERMETIC_NETWORK_ENV', 'INDEXED_CODEGRAPH'].includes(String(value.environment_profile))) add(errors, 'invalid_environment_profile', `${base}.environment_profile`, 'unknown environment profile')
  if (!isObject(value.env) || Object.entries(value.env).some(([key, item]) => !/^[A-Z_][A-Z0-9_]*$/.test(key) || typeof item !== 'string' || item.length > 100)) add(errors, 'invalid_environment', `${base}.env`, 'env must contain bounded fixed string bindings')
  if (typeof value.expected_classification !== 'string' || value.expected_classification.length > 80 || !/^[a-z0-9_]+$/.test(value.expected_classification)) add(errors, 'invalid_classification', `${base}.expected_classification`, 'invalid safe classification')
  if (typeof value.result_digest !== 'string' || !DIGEST.test(value.result_digest)) add(errors, 'invalid_digest', `${base}.result_digest`, 'result digest must be bounded SHA-256')

  const expected = EXPECTED_VERIFICATIONS[value.verification_id]
  if (expected) {
    const [repository, cwd, argv, environmentProfile, classification] = expected
    if (value.repository !== repository || value.cwd !== cwd || !same(value.argv, argv) || value.environment_profile !== environmentProfile || value.expected_classification !== classification) {
      add(errors, 'invalid_verification_binding', base, 'canonical verification command, cwd, repository, environment, or outcome changed')
    }
    const expectedEnv = value.verification_id.startsWith('OBS009-') ? { CC_GATEWAY_REPO_ROOT: '${CC_GATEWAY_ROOT}' } : {}
    if (!same(value.env, expectedEnv)) add(errors, 'invalid_environment', `${base}.env`, 'verification environment bindings changed')
  }
}

function validateEvent(value: unknown, rowId: string, eventIndex: number, verificationIds: Set<string>, errors: ValidationError[]): Value | undefined {
  const base = `$.observations[${Number(rowId.slice(-3)) - 1}].status_history[${eventIndex}]`
  if (!exactKeys(value, EVENT_FIELDS, base, errors)) return undefined
  const expectedEventId = `${rowId}-E${String(eventIndex + 1).padStart(3, '0')}`
  if (typeof value.event_id !== 'string' || !EVENT_ID.test(value.event_id) || value.event_id !== expectedEventId) add(errors, 'invalid_event_id', `${base}.event_id`, 'event ID suffix must equal its sequence within the observation')
  if (!Number.isInteger(value.sequence) || value.sequence !== eventIndex + 1) add(errors, 'invalid_event_chain', `${base}.sequence`, 'event sequence is not contiguous')
  if (!STATES.has(String(value.state))) add(errors, 'invalid_state', `${base}.state`, 'unknown observation state')
  if (value.source_section !== `Task 4 / ${rowId}`) add(errors, 'invalid_source_section', `${base}.source_section`, 'source section must be canonical')
  if (typeof value.revalidated_at !== 'string' || !TIMESTAMP.test(value.revalidated_at) || !Number.isFinite(Date.parse(value.revalidated_at))) add(errors, 'invalid_timestamp', `${base}.revalidated_at`, 'invalid revalidation timestamp')
  if (!Array.isArray(value.repository_bindings) || value.repository_bindings.length < 1 || value.repository_bindings.length > 2 || new Set(value.repository_bindings.filter(isObject).map((binding: Value) => binding.repository)).size !== value.repository_bindings.length) add(errors, 'invalid_commit', `${base}.repository_bindings`, 'unique repository bindings are required')
  else value.repository_bindings.forEach((binding: unknown, index: number) => validateRepositoryBinding(binding, `${base}.repository_bindings[${index}]`, errors))
  if (!Array.isArray(value.anchors) || value.anchors.length === 0 || value.anchors.length > 8) add(errors, 'invalid_anchor', `${base}.anchors`, 'between one and eight anchors are required')
  else {
    value.anchors.forEach((anchor: unknown, index: number) => validateAnchor(anchor, `${base}.anchors[${index}]`, errors))
    const boundRepositories = new Set((Array.isArray(value.repository_bindings) ? value.repository_bindings : []).filter(isObject).map((binding: Value) => binding.repository))
    for (const anchor of value.anchors.filter(isObject)) if (!boundRepositories.has(anchor.repository)) add(errors, 'invalid_commit', `${base}.anchors`, 'every anchor repository requires a commit binding')
  }
  if (!uniqueStrings(value.verification_ids) || value.verification_ids.length > 4) add(errors, 'invalid_verification_id', `${base}.verification_ids`, 'verification IDs must contain one to four unique strings')
  else for (const id of value.verification_ids) if (!verificationIds.has(id)) add(errors, 'unknown_verification_id', `${base}.verification_ids`, `${id} is not registered`)
  for (const field of ['evidence_digest', 'result_digest']) if (typeof value[field] !== 'string' || !DIGEST.test(value[field])) add(errors, 'invalid_digest', `${base}.${field}`, `${field} must be bounded SHA-256`)
  if (typeof value.evidence_digest === 'string' && DIGEST.test(value.evidence_digest) && value.evidence_digest !== computeObservationEvidenceDigest(value)) add(errors, 'evidence_digest_mismatch', `${base}.evidence_digest`, 'evidence digest does not bind the repository commits and anchors')
  if (!SCOPES.has(String(value.observation_scope))) add(errors, 'invalid_scope', `${base}.observation_scope`, 'unknown observation scope')
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) add(errors, 'invalid_confidence', `${base}.confidence`, 'confidence must be between zero and one')
  if (!uniqueStrings(value.phase_slices) || value.phase_slices.some((phase: string) => !PHASES.has(phase))) add(errors, 'invalid_phase', `${base}.phase_slices`, 'unregistered phase slice')
  if (!WORK_PACKAGES.has(String(value.wp_umbrella))) add(errors, 'invalid_wp', `${base}.wp_umbrella`, 'unregistered WP umbrella')
  if (typeof value.change_reason !== 'string' || value.change_reason.length < 1 || value.change_reason.length > 300) add(errors, 'invalid_change_reason', `${base}.change_reason`, 'bounded change reason is required')
  if (rowId === 'RA-CURRENT-009') {
    if (value.safe_result === undefined) add(errors, 'invalid_safe_result', `${base}.safe_result`, 'RA-CURRENT-009 requires its bounded safe result aggregate')
    else validateSafeResult(value.safe_result, `${base}.safe_result`, errors)
  } else if (value.safe_result !== undefined) add(errors, 'invalid_safe_result', `${base}.safe_result`, 'safe failure aggregates belong only to RA-CURRENT-009')
  if (rowId === 'RA-CURRENT-009' && eventIndex > 0 && value.state === 'resolved') {
    add(errors, 'unproven_resolution', `${base}.state`, 'RA-CURRENT-009 remains expected FAIL until a successor validator adopts a bounded GREEN result aggregate')
  }
  if (typeof value.event_digest !== 'string' || !DIGEST.test(value.event_digest)) add(errors, 'invalid_digest', `${base}.event_digest`, 'event digest must be bounded SHA-256')
  else if (value.event_digest !== computeObservationEventDigest(value)) add(errors, 'event_digest_mismatch', `${base}.event_digest`, 'event digest does not match canonical event content')
  return value
}

function validateAppendEntry(value: unknown, index: number, errors: ValidationError[]): Value | undefined {
  const base = `$.append_history[${index}]`
  if (!exactKeys(value, APPEND_FIELDS, base, errors)) return undefined
  if (!Number.isInteger(value.sequence) || value.sequence !== index + 1) add(errors, 'invalid_append_chain', `${base}.sequence`, 'append sequence is not contiguous')
  if (typeof value.appended_at !== 'string' || !TIMESTAMP.test(value.appended_at) || !Number.isFinite(Date.parse(value.appended_at))) add(errors, 'invalid_timestamp', `${base}.appended_at`, 'invalid append timestamp')
  if (value.previous_ledger_commit !== null && (typeof value.previous_ledger_commit !== 'string' || !COMMIT.test(value.previous_ledger_commit))) add(errors, 'invalid_commit', `${base}.previous_ledger_commit`, 'invalid prior ledger commit')
  for (const field of ['previous_ledger_digest', 'previous_append_digest']) if (value[field] !== null && (typeof value[field] !== 'string' || !DIGEST.test(value[field]))) add(errors, 'invalid_digest', `${base}.${field}`, 'invalid prior digest')
  if (!uniqueStrings(value.event_digests) || value.event_digests.some((entry: string) => !DIGEST.test(entry))) add(errors, 'invalid_digest', `${base}.event_digests`, 'append event digests must be unique SHA-256 values')
  if (typeof value.append_digest !== 'string' || !DIGEST.test(value.append_digest)) add(errors, 'invalid_digest', `${base}.append_digest`, 'invalid append digest')
  else if (value.append_digest !== computeAppendEntryDigest(value)) add(errors, 'append_digest_mismatch', `${base}.append_digest`, 'append digest does not match canonical append content')
  return value
}

function validateInitialCanonicalRows(ledger: Value, errors: ValidationError[]) {
  const expectedIds = Object.keys(CANONICAL_ROWS)
  const actualIds = Array.isArray(ledger.observations) ? ledger.observations.map((row: Value) => row?.observation_id) : []
  if (!same(actualIds, expectedIds)) add(errors, 'invalid_inventory', '$.observations', 'ledger must contain exactly RA-CURRENT-001 through RA-CURRENT-010 in order')
  for (const [index, row] of (Array.isArray(ledger.observations) ? ledger.observations : []).entries()) {
    if (!isObject(row) || typeof row.observation_id !== 'string') continue
    const expected = CANONICAL_ROWS[row.observation_id]
    const initial = Array.isArray(row.status_history) ? row.status_history[0] : undefined
    if (!expected || !isObject(initial)) continue
    if (row.required_consequence !== expected.consequence || row.prohibited_promotion !== expected.prohibited) add(errors, 'invalid_canonical_observation', `$.observations[${index}]`, 'canonical consequence or prohibited promotion changed')
    if (initial.state !== expected.state || !same(initial.verification_ids, expected.verificationIds) || !same(initial.phase_slices, expected.phases) || initial.wp_umbrella !== expected.wp || initial.evidence_digest !== CANONICAL_EVIDENCE_DIGESTS[row.observation_id]) add(errors, 'invalid_canonical_observation', `$.observations[${index}].status_history[0]`, 'initial canonical state, anchor snapshot, verification, phase, or WP changed')
    if (initial.event_id !== `${row.observation_id}-E001`) add(errors, 'invalid_event_id', `$.observations[${index}].status_history[0].event_id`, 'initial event ID must end in E001')
    if (row.observation_id === 'RA-CURRENT-009') {
      if (initial.safe_result === undefined) add(errors, 'invalid_safe_result', `$.observations[${index}].status_history[0].safe_result`, 'RA-CURRENT-009 requires its safe failure aggregate')
      else if (initial.result_digest !== safeFailureDigest()) add(errors, 'invalid_safe_result', `$.observations[${index}].status_history[0].result_digest`, 'RA-CURRENT-009 result digest must equal its safe aggregate')
    } else if (initial.safe_result !== undefined) add(errors, 'invalid_safe_result', `$.observations[${index}].status_history[0].safe_result`, 'safe failure aggregate belongs only to RA-CURRENT-009')
  }
}

function validateAppendOnly(current: Value, previous: unknown, commit: unknown, errors: ValidationError[]) {
  if (!isObject(previous)) return add(errors, 'invalid_append_binding', '$', 'previous ledger must be an object')
  if (typeof commit !== 'string' || !COMMIT.test(commit)) return add(errors, 'invalid_append_binding', '$', 'previous ledger commit is required')
  for (const field of ['schema_version', 'ledger_kind', 'ledger_role', 'task_0b_entry_binding', 'repository_commits'] as const) {
    if (!same(current[field], previous[field])) add(errors, 'append_only_violation', `$.${field}`, `${field} cannot be rewritten`)
  }
  if (!Array.isArray(previous.verifications) || !Array.isArray(current.verifications) || current.verifications.length < previous.verifications.length || previous.verifications.some((item: unknown, index: number) => !same(item, current.verifications[index]))) add(errors, 'append_only_violation', '$.verifications', 'committed verification definitions cannot be deleted, modified, inserted before the tail, or reordered')
  if (!Array.isArray(previous.observations) || !Array.isArray(current.observations) || previous.observations.length !== current.observations.length) return add(errors, 'append_only_violation', '$.observations', 'committed observations cannot be deleted or inserted')

  const newEventDigests: string[] = []
  for (let index = 0; index < previous.observations.length; index++) {
    const priorRow = previous.observations[index]
    const currentRow = current.observations[index]
    if (!isObject(priorRow) || !isObject(currentRow) || priorRow.observation_id !== currentRow.observation_id || priorRow.required_consequence !== currentRow.required_consequence || priorRow.prohibited_promotion !== currentRow.prohibited_promotion) {
      add(errors, 'append_only_violation', `$.observations[${index}]`, 'committed observation identity and consequences are immutable')
      continue
    }
    const priorHistory = priorRow.status_history
    const currentHistory = currentRow.status_history
    if (!Array.isArray(priorHistory) || !Array.isArray(currentHistory) || currentHistory.length < priorHistory.length || priorHistory.some((event: unknown, eventIndex: number) => !same(event, currentHistory[eventIndex]))) {
      add(errors, 'append_only_violation', `$.observations[${index}].status_history`, 'committed events cannot be deleted, modified, inserted before the tail, or reordered')
      continue
    }
    for (const event of currentHistory.slice(priorHistory.length)) if (isObject(event) && typeof event.event_digest === 'string') newEventDigests.push(event.event_digest)
  }
  if (newEventDigests.length === 0) add(errors, 'invalid_append_binding', '$.observations', 'append must add at least one event')

  const priorAppends = previous.append_history
  const currentAppends = current.append_history
  if (!Array.isArray(priorAppends) || !Array.isArray(currentAppends) || currentAppends.length !== priorAppends.length + 1 || priorAppends.some((entry: unknown, index: number) => !same(entry, currentAppends[index]))) {
    return add(errors, 'append_only_violation', '$.append_history', 'append history must preserve its committed prefix and add exactly one tail entry')
  }
  const tail = currentAppends.at(-1)
  const priorTail = priorAppends.at(-1)
  if (!isObject(tail) || !isObject(priorTail) || tail.previous_ledger_commit !== commit || tail.previous_ledger_digest !== computeCurrentObservationLedgerDigest(previous) || tail.previous_append_digest !== priorTail.append_digest || !same(tail.event_digests, newEventDigests)) {
    add(errors, 'invalid_append_binding', '$.append_history', 'tail append must bind the exact prior ledger digest, commit, append digest, and new events')
  }
}

export function validateCurrentObservationLedgerValue(input: unknown, options: ValidationOptions = {}): ValidationResult {
  const errors: ValidationError[] = []
  if (!exactKeys(input, ROOT_FIELDS, '$', errors)) return { ok: false, errors }
  const ledger = input
  scanPersistedValue(ledger, '$', errors)
  if (ledger.schema_version !== 1) add(errors, 'unsupported_schema_version', '$.schema_version', 'only schema version 1 is supported')
  if (ledger.ledger_kind !== 'ra_current_observation_ledger' || ledger.ledger_role !== 'evidence_not_requirement') add(errors, 'invalid_ledger_role', '$', 'ledger must remain evidence, not a requirement registry')
  if (!same(ledger.task_0b_entry_binding, TASK_0B_BINDING)) add(errors, 'invalid_task_0b_binding', '$.task_0b_entry_binding', 'Task 0B immutable entry binding changed')
  if (!same(ledger.repository_commits, INITIAL_COMMITS)) add(errors, 'invalid_commit', '$.repository_commits', 'initial named repository commits changed')

  const verificationIds = new Set<string>()
  if (!Array.isArray(ledger.verifications)) add(errors, 'invalid_verifications', '$.verifications', 'verifications must be an array')
  else ledger.verifications.forEach((entry: unknown, index: number) => validateVerification(entry, index, errors, verificationIds))
  const expectedVerificationIds = Object.keys(EXPECTED_VERIFICATIONS)
  if (!Array.isArray(ledger.verifications) || ledger.verifications.length !== expectedVerificationIds.length || !same([...verificationIds], expectedVerificationIds)) add(errors, 'invalid_verification_inventory', '$.verifications', 'canonical verification inventory must contain exactly 18 entries in order')

  if (!Array.isArray(ledger.observations)) add(errors, 'invalid_inventory', '$.observations', 'observations must be an array')
  else ledger.observations.forEach((row: unknown, rowIndex: number) => {
    const base = `$.observations[${rowIndex}]`
    if (!exactKeys(row, ROW_FIELDS, base, errors)) return
    if (typeof row.observation_id !== 'string' || !OBSERVATION_ID.test(row.observation_id)) add(errors, 'invalid_observation_id', `${base}.observation_id`, 'invalid observation ID')
    if (typeof row.required_consequence !== 'string' || row.required_consequence.length < 1 || row.required_consequence.length > 500 || sensitiveText(row.required_consequence)) add(errors, sensitiveText(row.required_consequence) ? 'sensitive_material' : 'invalid_consequence', `${base}.required_consequence`, 'required consequence must be bounded and contain no sensitive material')
    if (typeof row.prohibited_promotion !== 'string' || row.prohibited_promotion.length < 1 || row.prohibited_promotion.length > 500 || sensitiveText(row.prohibited_promotion)) add(errors, sensitiveText(row.prohibited_promotion) ? 'sensitive_material' : 'invalid_prohibition', `${base}.prohibited_promotion`, 'prohibited promotion must be bounded and contain no sensitive material')
    if (!Array.isArray(row.status_history) || row.status_history.length === 0) add(errors, 'invalid_event_chain', `${base}.status_history`, 'status history must be non-empty')
    else {
      let previousDigest: string | null = null
      row.status_history.forEach((event: unknown, eventIndex: number) => {
        const valid = validateEvent(event, String(row.observation_id), eventIndex, verificationIds, errors)
        if (!valid) return
        if (valid.previous_event_digest !== previousDigest) add(errors, 'invalid_event_chain', `${base}.status_history[${eventIndex}].previous_event_digest`, 'event does not point to the exact prior event digest')
        previousDigest = valid.event_digest
      })
    }
  })
  validateInitialCanonicalRows(ledger, errors)

  if (!Array.isArray(ledger.append_history) || ledger.append_history.length === 0) add(errors, 'invalid_append_chain', '$.append_history', 'append history must be non-empty')
  else {
    let previousAppendDigest: string | null = null
    ledger.append_history.forEach((entry: unknown, index: number) => {
      const valid = validateAppendEntry(entry, index, errors)
      if (!valid) return
      if (index === 0) {
        if (valid.previous_ledger_commit !== null || valid.previous_ledger_digest !== null || valid.previous_append_digest !== null) add(errors, 'invalid_append_binding', '$.append_history[0]', 'first append has no previous ledger or append')
      } else if (valid.previous_append_digest !== previousAppendDigest) add(errors, 'invalid_append_chain', `$.append_history[${index}].previous_append_digest`, 'append does not point to the exact prior append digest')
      previousAppendDigest = valid.append_digest
    })
    if (ledger.append_history.length === 1 && Array.isArray(ledger.observations)) {
      const initialDigests = ledger.observations.flatMap((row: Value) => Array.isArray(row.status_history) && row.status_history[0]?.event_digest ? [row.status_history[0].event_digest] : [])
      if (!same(ledger.append_history[0].event_digests, initialDigests)) add(errors, 'invalid_append_binding', '$.append_history[0].event_digests', 'initial append must bind every initial event digest in row order')
    }
  }
  if (options.previousLedger !== undefined) validateAppendOnly(ledger, options.previousLedger, options.previousLedgerCommit, errors)
  return { ok: errors.length === 0, errors }
}

export function validateCurrentObservationLedger(file: string, options: ValidationOptions = {}): ValidationResult {
  try {
    return validateCurrentObservationLedgerValue(JSON.parse(readFileSync(file, 'utf8')), options)
  } catch (error) {
    return { ok: false, errors: [{ code: 'invalid_ledger', path: '$', message: error instanceof Error ? error.message : 'ledger is unreadable' }] }
  }
}

if (realpathSync(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? 'docs/superpowers/registry/oracle-lab-current-observations.json'
  const result = validateCurrentObservationLedger(file)
  if (!result.ok) {
    process.stderr.write(`${JSON.stringify(result)}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(`${JSON.stringify({ valid: true, observations: 10, verifications: 18 })}\n`)
  }
}
