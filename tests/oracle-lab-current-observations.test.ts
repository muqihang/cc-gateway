import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'

const schemaPath = path.resolve('docs/superpowers/schemas/oracle-lab-current-observation.schema.json')
const registryPath = path.resolve('docs/superpowers/registry/oracle-lab-current-observations.json')
const validatorPath = path.resolve('tools/oracle-lab/validate-current-observations.ts')

type Value = Record<string, any>
type ValidationResult = { ok: boolean; errors: Array<{ code: string; path: string; message: string }> }
type Validator = {
  canonicalJson: (value: unknown) => string
  computeObservationEventDigest: (event: Value) => string
  computeAppendEntryDigest: (entry: Value) => string
  computeCurrentObservationLedgerDigest: (ledger: Value) => string
  validateCurrentObservationLedgerValue: (
    ledger: unknown,
    options?: { previousLedger?: unknown; previousLedgerCommit?: string },
  ) => ValidationResult
}

const expectedIds = Array.from({ length: 10 }, (_, index) => `RA-CURRENT-${String(index + 1).padStart(3, '0')}`)
const expectedVerificationIds = [
  'OBS001-T',
  'OBS002-T1', 'OBS002-T2',
  'OBS003-G', 'OBS003-T',
  'OBS004-SUB', 'OBS004-CC',
  'OBS005-CC', 'OBS005-GO-RED',
  'OBS006-SUB', 'OBS006-CC',
  'OBS007-G', 'OBS007-T',
  'OBS008-G', 'OBS008-T',
  'OBS009-RED-A', 'OBS009-RED-B',
  'OBS010-G',
]
const zeroDigest = `sha256:${'0'.repeat(64)}`

const canonicalRows: Record<string, {
  state: string
  verificationIds: string[]
  phases: string[]
  wp: string
  consequence: string
  prohibited: string
}> = {
  'RA-CURRENT-001': {
    state: 'confirmed', verificationIds: ['OBS001-T'], phases: ['phase_3a'], wp: 'WP-R4',
    consequence: 'Expand the version/change-point evidence matrix before profile synthesis.',
    prohibited: 'Existing 2.1.179 harness cannot satisfy 2.1.207 evidence or profile completion.',
  },
  'RA-CURRENT-002': {
    state: 'confirmed', verificationIds: ['OBS002-T1', 'OBS002-T2'], phases: ['phase_3b'], wp: 'WP-R5',
    consequence: 'Generate a coherent 2.1.207 profile from accepted evidence.',
    prohibited: 'No handwritten 2.1.207 persona or outbound-persona promotion.',
  },
  'RA-CURRENT-003': {
    state: 'confirmed', verificationIds: ['OBS003-G', 'OBS003-T'], phases: ['phase_3a', 'phase_4'], wp: 'WP-R7',
    consequence: 'Capture evidence, then implement bounded layered response/outcome facts.',
    prohibited: 'Transparent pipe/chunk capture cannot authorize retry, cost, budget, scheduler, or quarantine decisions.',
  },
  'RA-CURRENT-004': {
    state: 'partial', verificationIds: ['OBS004-SUB', 'OBS004-CC'], phases: ['phase_2', 'phase_4'], wp: 'WP-R2',
    consequence: 'Preserve known re-registration rotation/promotion/TLS-backfill behavior while designing the full signed lifecycle.',
    prohibited: 'No freeze/drain/revoke/delete/query/reconcile or complete lifecycle claim.',
  },
  'RA-CURRENT-005': {
    state: 'confirmed', verificationIds: ['OBS005-CC', 'OBS005-GO-RED'], phases: ['phase_2', 'phase_4'], wp: 'WP-R3',
    consequence: 'Specify then implement request capability, replay ledger, and resolve/classify/pin/dial enforcement.',
    prohibited: 'Protected production and real canary remain disabled.',
  },
  'RA-CURRENT-006': {
    state: 'confirmed', verificationIds: ['OBS006-SUB', 'OBS006-CC'], phases: ['phase_2', 'phase_3b'], wp: 'WP-R6',
    consequence: 'Record trusted-device proof as an unavailable capability until independent issuer/verifier lifecycle exists.',
    prohibited: 'Stable/equal `device_id` is not device proof.',
  },
  'RA-CURRENT-007': {
    state: 'confirmed', verificationIds: ['OBS007-G', 'OBS007-T'], phases: ['phase_2', 'phase_4'], wp: 'WP-R8',
    consequence: 'Add versioned readiness and later shared/replica-consistent authority.',
    prohibited: 'No multi-replica readiness or production capability claim.',
  },
  'RA-CURRENT-008': {
    state: 'confirmed', verificationIds: ['OBS008-G', 'OBS008-T'], phases: ['phase_1', 'phase_4'], wp: 'WP-R8',
    consequence: 'Plan loopback fail-closed guard in Phase 1 and implement remote TLS/auth/certificate gates before deployment.',
    prohibited: 'No remote-listen or production authorization.',
  },
  'RA-CURRENT-009': {
    state: 'confirmed', verificationIds: ['OBS009-RED-A', 'OBS009-RED-B'], phases: ['phase_2'], wp: 'WP-R1',
    consequence: 'Preserve the frozen P0.1 failure, repair only four fixture blocks, and add both tests to GREEN.',
    prohibited: 'Joint-chain evidence is not GREEN until the append-only resolved event exists.',
  },
  'RA-CURRENT-010': {
    state: 'confirmed', verificationIds: ['OBS010-G'], phases: ['phase_4'], wp: 'WP-R6',
    consequence: 'Split only touched security boundaries incrementally, with WP-R7 related response ownership.',
    prohibited: 'No big-bang refactor and no claim that current concentrated logic is independently reviewable.',
  },
}

const exactCommands: Record<string, {
  repository: string
  cwd: string
  argv: string[]
  environmentProfile: string
  expectedClassification: string
}> = {
  'OBS001-T': { repository: 'cc-gateway', cwd: '.', argv: ['npm', 'exec', 'tsx', 'tests/native-oracle-matrix.test.ts'], environmentProfile: 'HERMETIC_NETWORK_ENV', expectedClassification: 'pass' },
  'OBS002-T1': { repository: 'cc-gateway', cwd: '.', argv: ['npm', 'exec', 'tsx', 'tests/persona-registry.test.ts'], environmentProfile: 'HERMETIC_NETWORK_ENV', expectedClassification: 'pass' },
  'OBS002-T2': { repository: 'cc-gateway', cwd: '.', argv: ['npm', 'exec', 'tsx', 'tests/formal-pool-canonical-promotion.test.ts'], environmentProfile: 'HERMETIC_NETWORK_ENV', expectedClassification: 'pass' },
  'OBS003-G': { repository: 'cc-gateway', cwd: '.', argv: ['codegraph', 'explore', 'handleRequest RawCaptureSink EgressSidecarStreamResponse pipe Buffer.concat'], environmentProfile: 'INDEXED_CODEGRAPH', expectedClassification: 'anchors_present_no_outcome_envelope_owner' },
  'OBS003-T': { repository: 'cc-gateway', cwd: '.', argv: ['npm', 'exec', 'tsx', 'tests/formal-pool-real-chain-mock-response.test.ts'], environmentProfile: 'HERMETIC_NETWORK_ENV', expectedClassification: 'pass' },
  'OBS004-SUB': { repository: 'sub2api', cwd: '.', argv: ['codegraph', 'explore', 'FormalPoolCCGatewayRuntimeRegistrar RegisterCCGatewayRuntime freeze drain revoke delete query reconcile'], environmentProfile: 'INDEXED_CODEGRAPH', expectedClassification: 'register_present_full_lifecycle_absent' },
  'OBS004-CC': { repository: 'cc-gateway', cwd: '.', argv: ['codegraph', 'explore', 'RUNTIME_REGISTER_PATH sameRuntimeMappingAuthorityAllowingCredentialRotation isAllowedRuntimeCanonicalPromotion sameRuntimeMappingAuthorityAllowingTLSProfileBackfill'], environmentProfile: 'INDEXED_CODEGRAPH', expectedClassification: 'limited_paths_present' },
  'OBS005-CC': { repository: 'cc-gateway', cwd: '.', argv: ['codegraph', 'explore', 'EgressSidecarControl Control replay nonce deadline body hash header hash attempt key epoch resolve classify pin dial'], environmentProfile: 'INDEXED_CODEGRAPH', expectedClassification: 'capability_and_replay_fields_missing' },
  'OBS005-GO-RED': { repository: 'cc-gateway', cwd: 'sidecar/egress-tls-sidecar', argv: ['go', 'test', '-tags=phase0red', './internal/control', './internal/server', '-count=1'], environmentProfile: 'HERMETIC_NETWORK_ENV', expectedClassification: 'expected_fail_b5_b6' },
  'OBS006-SUB': { repository: 'sub2api', cwd: '.', argv: ['codegraph', 'explore', 'ccGatewayGeneratedDeviceID ccGatewayDeviceID scopedStickyHMACBytes'], environmentProfile: 'INDEXED_CODEGRAPH', expectedClassification: 'hmac_derived_id_path_present' },
  'OBS006-CC': { repository: 'cc-gateway', cwd: '.', argv: ['codegraph', 'explore', 'normalizeRuntimeAccountMapping verifyProviderAwareFinalRequest device_id equality'], environmentProfile: 'INDEXED_CODEGRAPH', expectedClassification: 'format_equality_present_issuer_verifier_absent' },
  'OBS007-G': { repository: 'cc-gateway', cwd: '.', argv: ['codegraph', 'explore', 'ProxyRuntimeState replayRuntimeMappings RUNTIME_MAPPING_FILE_ENV FORMAL_POOL_SESSION_LEDGER_FILE_ENV /_health'], environmentProfile: 'INDEXED_CODEGRAPH', expectedClassification: 'process_map_local_file_authority_present' },
  'OBS007-T': { repository: 'cc-gateway', cwd: '.', argv: ['npm', 'exec', 'tsx', 'tests/health-verify.test.ts'], environmentProfile: 'HERMETIC_NETWORK_ENV', expectedClassification: 'pass' },
  'OBS008-G': { repository: 'cc-gateway', cwd: '.', argv: ['codegraph', 'explore', 'Config server.host startProxy listenHost server.listen'], environmentProfile: 'INDEXED_CODEGRAPH', expectedClassification: 'configured_host_passed_to_listen' },
  'OBS008-T': { repository: 'cc-gateway', cwd: '.', argv: ['npm', 'exec', 'tsx', 'tests/security-boundary.test.ts'], environmentProfile: 'HERMETIC_NETWORK_ENV', expectedClassification: 'pass_current_default_ipv6_any' },
  'OBS009-RED-A': { repository: 'sub2api', cwd: 'backend', argv: ['go', 'test', './internal/service', '-run', '^TestClaudePlatformAWSLocalFullChainE2EUsesCCGatewayAndSafeMockUpstream$', '-count=1', '-v'], environmentProfile: 'HERMETIC_NETWORK_ENV', expectedClassification: 'expected_fail_gateway_compromise_boundary_required' },
  'OBS009-RED-B': { repository: 'sub2api', cwd: 'backend', argv: ['go', 'test', './internal/service', '-run', '^TestJointLocalCaptureAcceptanceArtifact$', '-count=1', '-v'], environmentProfile: 'HERMETIC_NETWORK_ENV', expectedClassification: 'expected_fail_gateway_compromise_boundary_required' },
  'OBS010-G': { repository: 'cc-gateway', cwd: '.', argv: ['codegraph', 'node', 'src/proxy.ts'], environmentProfile: 'INDEXED_CODEGRAPH', expectedClassification: 'one_4726_line_concentrated_owner_file' },
}

function assertPublishedFiles() {
  for (const file of [schemaPath, registryPath, validatorPath]) {
    assert.equal(existsSync(file), true, `Task 4 implementation file is missing: ${path.relative(process.cwd(), file)}`)
  }
}

async function validator(): Promise<Validator> {
  assertPublishedFiles()
  return await import(pathToFileURL(validatorPath).href) as Validator
}

async function ledger(): Promise<Value> {
  assertPublishedFiles()
  return JSON.parse(await readFile(registryPath, 'utf8')) as Value
}

async function schemaValidator() {
  assertPublishedFiles()
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'))
  return new Ajv2020({ strict: false, allErrors: true }).compile(schema)
}

function expectError(result: ValidationResult, code: string) {
  assert.equal(result.ok, false)
  assert(result.errors.some((error) => error.code === code), JSON.stringify(result.errors))
}

function sha256(lines: string): string {
  return `sha256:${createHash('sha256').update(lines).digest('hex')}`
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function rehashHistory(module: Validator, history: Value[]) {
  let previous: string | null = null
  history.forEach((event, index) => {
    event.sequence = index + 1
    event.previous_event_digest = previous
    event.event_digest = module.computeObservationEventDigest(event)
    previous = event.event_digest
  })
}

function observationEvidenceDigest(module: Validator, event: Value): string {
  return sha256(module.canonicalJson({
    repository_bindings: event.repository_bindings,
    anchors: event.anchors,
  }))
}

function referencedOutcomeDigest(value: Value, event: Value): string {
  const verificationById = new Map(
    value.verifications.map((entry: Value) => [entry.verification_id, entry]),
  )
  return sha256(event.verification_ids.map((id: string) => {
    const verification = verificationById.get(id)
    return `${id}|${verification.expected_classification}\n`
  }).join(''))
}

function refreshInitialLedger(module: Validator, value: Value) {
  for (const row of value.observations as Value[]) {
    const event = row.status_history[0]
    event.evidence_digest = observationEvidenceDigest(module, event)
    event.event_digest = module.computeObservationEventDigest(event)
  }
  value.append_history[0].event_digests = value.observations.map((row: Value) => row.status_history[0].event_digest)
  value.append_history[0].append_digest = module.computeAppendEntryDigest(value.append_history[0])
}

function refreshLatestAppend(module: Validator, value: Value, rowIndex: number) {
  const event = value.observations[rowIndex].status_history.at(-1)
  event.evidence_digest = observationEvidenceDigest(module, event)
  event.event_digest = module.computeObservationEventDigest(event)
  const append = value.append_history.at(-1)
  append.event_digests = [event.event_digest]
  append.append_digest = module.computeAppendEntryDigest(append)
}

function appendEvent(module: Validator, prior: Value, rowIndex: number, commit: string, state: string): Value {
  const next = clone(prior)
  const history = next.observations[rowIndex].status_history as Value[]
  const previous = history.at(-1) as Value
  const event: Value = {
    ...clone(previous),
    event_id: `${next.observations[rowIndex].observation_id}-E${String(history.length + 1).padStart(3, '0')}`,
    sequence: history.length + 1,
    state,
    revalidated_at: '2026-07-13T08:00:00Z',
    change_reason: 'successor_revalidation_state_transition',
    previous_event_digest: previous.event_digest,
  }
  event.event_digest = module.computeObservationEventDigest(event)
  history.push(event)

  const previousAppend = next.append_history.at(-1) as Value
  const appendEntry: Value = {
    sequence: next.append_history.length + 1,
    appended_at: '2026-07-13T08:00:00Z',
    previous_ledger_commit: commit,
    previous_ledger_digest: module.computeCurrentObservationLedgerDigest(prior),
    previous_append_digest: previousAppend.append_digest,
    event_digests: [event.event_digest],
  }
  appendEntry.append_digest = module.computeAppendEntryDigest(appendEntry)
  next.append_history.push(appendEntry)
  return next
}

test('Task 4 starts RED until the schema, registry, and validator are all present', () => {
  assertPublishedFiles()
})

test('published ledger passes both JSON Schema and semantic validator', async () => {
  const value = await ledger()
  const validateSchema = await schemaValidator()
  assert.equal(validateSchema(value), true, JSON.stringify(validateSchema.errors))
  assert.deepEqual((await validator()).validateCurrentObservationLedgerValue(value), { ok: true, errors: [] })
  assert.equal(value.ledger_kind, 'ra_current_observation_ledger')
  assert.equal(value.ledger_role, 'evidence_not_requirement')
  assert.deepEqual(value.task_0b_entry_binding, {
    repository: 'cc-gateway',
    path: 'docs/superpowers/evidence/p0-1/p0-1-entry-baseline.json',
    digest: 'sha256:e6d7426c63f8bf96a91de5c47d9fc6807fae5da68ad507e8ba65b93f2732f235',
  })
})

test('ledger contains the exact RA-CURRENT inventory and canonical consequences without promotion', async () => {
  const value = await ledger()
  assert.deepEqual(value.observations.map((row: Value) => row.observation_id), expectedIds)
  for (const row of value.observations as Value[]) {
    const expected = canonicalRows[row.observation_id]
    assert(expected)
    assert.equal(row.required_consequence, expected.consequence)
    assert.equal(row.prohibited_promotion, expected.prohibited)
    assert.equal(row.status_history.length, row.observation_id === 'RA-CURRENT-009' ? 2 : 1)
    const event = row.status_history[0]
    assert.equal(event.state, expected.state)
    assert.equal(event.source_section, `Task 4 / ${row.observation_id}`)
    assert.deepEqual(event.verification_ids, expected.verificationIds)
    assert.deepEqual(event.phase_slices, expected.phases)
    assert.equal(event.wp_umbrella, expected.wp)
    assert.match(event.evidence_digest, /^sha256:[0-9a-f]{64}$/)
    assert.match(event.result_digest, /^sha256:[0-9a-f]{64}$/)
    assert.notEqual(event.evidence_digest, zeroDigest)
    assert.notEqual(event.result_digest, zeroDigest)
    assert(Number.isFinite(event.confidence) && event.confidence >= 0 && event.confidence <= 1)
    assert.equal(typeof event.observation_scope, 'string')
  }
  const serialized = JSON.stringify(value).toLowerCase()
  assert.doesNotMatch(serialized, /"state":"fixed"/)
  assert.doesNotMatch(serialized, /provider behavior (is|was|has been) confirmed/)
  assert.doesNotMatch(serialized, /device proof (is|was) available/)
  assert.doesNotMatch(serialized, /production (is|was) enabled/)
  assert.doesNotMatch(serialized, /multi-replica authority (is|was) available/)
})

test('verification IDs occur exactly once and bind exact argv, repository cwd, environment, and outcome', async () => {
  const value = await ledger()
  assert.deepEqual(value.verifications.map((entry: Value) => entry.verification_id), expectedVerificationIds)
  const references = new Map<string, number>()
  for (const row of value.observations as Value[]) {
    for (const id of row.status_history[0].verification_ids as string[]) references.set(id, (references.get(id) ?? 0) + 1)
  }
  assert.deepEqual([...references.keys()], expectedVerificationIds)
  assert(expectedVerificationIds.every((id) => references.get(id) === 1))

  for (const verification of value.verifications as Value[]) {
    const expected = exactCommands[verification.verification_id]
    assert(expected)
    assert.equal(verification.repository, expected.repository)
    assert.equal(verification.cwd, expected.cwd)
    assert.deepEqual(verification.argv, expected.argv)
    assert.equal(verification.environment_profile, expected.environmentProfile)
    assert.equal(verification.expected_classification, expected.expectedClassification)
    assert.match(verification.result_digest, /^sha256:[0-9a-f]{64}$/)
    assert.notEqual(verification.result_digest, zeroDigest)
    if (verification.verification_id.startsWith('OBS009-')) {
      assert.deepEqual(verification.env, { CC_GATEWAY_REPO_ROOT: '${CC_GATEWAY_ROOT}' })
    } else {
      assert.deepEqual(verification.env, {})
    }
  }
})

test('canonical anchors are repository-relative and bound to the named current commits', async () => {
  const value = await ledger()
  assert.deepEqual(value.repository_commits, {
    cc_gateway: { repository: 'cc-gateway', commit: 'c7404e36c576965a6177f6d25cd8657b6550261d' },
    sub2api: { repository: 'sub2api', commit: 'd5a42bbd24d15af2ce7646d050a5ae5c77911d4f' },
  })
  for (const row of value.observations as Value[]) {
    const event = row.status_history[0]
    assert(event.repository_bindings.length > 0)
    for (const binding of event.repository_bindings as Value[]) {
      const expectedCommit = binding.repository === 'cc-gateway'
        ? value.repository_commits.cc_gateway.commit
        : value.repository_commits.sub2api.commit
      assert.equal(binding.commit, expectedCommit)
    }
    assert(event.anchors.length > 0)
    for (const anchor of event.anchors as Value[]) {
      assert.equal(path.isAbsolute(anchor.path), false)
      assert.doesNotMatch(anchor.path, /(^|\/)\.\.(\/|$)/)
      assert(['cc-gateway', 'sub2api'].includes(anchor.repository))
      assert(Array.isArray(anchor.symbols) || Array.isArray(anchor.test_names))
    }
  }

  const row1 = value.observations[0].status_history[0]
  assert(row1.anchors.some((anchor: Value) => anchor.path === 'tools/claude-native-oracle-matrix.ts'
    && ['DEFAULT_VERSION', 'runNativeOracleMatrix', 'runMockProfile', 'runRealProfile'].every((name) => anchor.symbols.includes(name))))
  const row4 = value.observations[3].status_history[0]
  assert(row4.anchors.some((anchor: Value) => anchor.path === 'backend/internal/service/formal_pool_onboarding_service.go'
    && anchor.symbols.includes('FormalPoolCCGatewayRuntimeRegistrar') && anchor.symbols.includes('RegisterCCGatewayRuntime')))
  const row10 = value.observations[9].status_history[0]
  assert(row10.anchors.some((anchor: Value) => anchor.path === 'src/proxy.ts'
    && ['startProxy', 'handleRequest', 'ProxyRuntimeState', 'RawCaptureSink', 'RUNTIME_REGISTER_PATH'].every((name) => anchor.symbols.includes(name))))
})

test('standalone validation binds every initial canonical anchor and repository commit', async () => {
  const module = await validator()
  const value = await ledger()

  const anchorDrift = clone(value)
  anchorDrift.observations[1].status_history[0].anchors[0].symbols[0] = 'InventedProfile'
  refreshInitialLedger(module, anchorDrift)
  expectError(module.validateCurrentObservationLedgerValue(anchorDrift), 'invalid_canonical_observation')

  const commitDrift = clone(value)
  commitDrift.observations[4].status_history[0].repository_bindings[0].commit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  refreshInitialLedger(module, commitDrift)
  expectError(module.validateCurrentObservationLedgerValue(commitDrift), 'invalid_canonical_observation')
})

test('RA-CURRENT-009 E001 retains only ordered safe failure classifications and the reproduced RED', async () => {
  const value = await ledger()
  const row = value.observations.find((entry: Value) => entry.observation_id === 'RA-CURRENT-009')
  const event = row.status_history[0]
  assert.equal(event.state, 'confirmed')
  assert.deepEqual(event.safe_result, {
    kind: 'stable_failure_code_aggregate',
    results: [
      { verification_id: 'OBS009-RED-A', classification: 'expected_fail', failure_code: 'gateway_compromise_boundary_required' },
      { verification_id: 'OBS009-RED-B', classification: 'expected_fail', failure_code: 'gateway_compromise_boundary_required' },
    ],
    aggregate_digest: sha256(
      'OBS009-RED-A|expected_fail|gateway_compromise_boundary_required\n'
      + 'OBS009-RED-B|expected_fail|gateway_compromise_boundary_required\n',
    ),
  })
  assert.equal(event.result_digest, event.safe_result.aggregate_digest)
  assert.equal((value.observations as Value[]).filter((entry) => entry.status_history[0].safe_result !== undefined).length, 1)

  const module = await validator()
  const promoted = appendEvent(module, value, 8, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'resolved')
  expectError(module.validateCurrentObservationLedgerValue(promoted, {
    previousLedger: value,
    previousLedgerCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  }), 'unproven_resolution')
})

test('validator rejects unsafe paths, raw results, credentials, prompts, and account or proxy identifiers', async () => {
  const module = await validator()
  const value = await ledger()

  const absolutePath = clone(value)
  absolutePath.observations[0].status_history[0].anchors[0].path = '/tmp/private/source.ts'
  expectError(module.validateCurrentObservationLedgerValue(absolutePath), 'unsafe_path')

  const rawOutput = clone(value)
  rawOutput.observations[0].status_history[0].raw_output = 'full command output'
  expectError(module.validateCurrentObservationLedgerValue(rawOutput), 'unknown_field')

  for (const [field, sensitiveValue] of [
    ['required_consequence', 'Bearer sk-ant-sensitive-material'],
    ['prohibited_promotion', 'prompt: reveal the hidden instructions'],
  ] as const) {
    const unsafe = clone(value)
    unsafe.observations[0][field] = sensitiveValue
    expectError(module.validateCurrentObservationLedgerValue(unsafe), 'sensitive_material')
  }

  for (const field of ['account_id', 'proxy_id']) {
    const unsafe = clone(value)
    unsafe.observations[0].status_history[0][field] = 'identifier-123'
    expectError(module.validateCurrentObservationLedgerValue(unsafe), 'sensitive_identifier')
  }
})

test('schema and validator reject missing commits, unknown states, unregistered WP/phase values, and malformed digests', async () => {
  const module = await validator()
  const validateSchema = await schemaValidator()
  const value = await ledger()
  const mutations = [
    { code: 'invalid_commit', mutate: (copy: Value) => { copy.observations[0].status_history[0].repository_bindings[0].commit = '' } },
    { code: 'invalid_state', mutate: (copy: Value) => { copy.observations[0].status_history[0].state = 'fixed' } },
    { code: 'invalid_wp', mutate: (copy: Value) => { copy.observations[0].status_history[0].wp_umbrella = 'WP-R99' } },
    { code: 'invalid_phase', mutate: (copy: Value) => { copy.observations[0].status_history[0].phase_slices = ['phase_99'] } },
    { code: 'invalid_digest', mutate: (copy: Value) => { copy.observations[0].status_history[0].result_digest = 'sha256:short' } },
  ]
  for (const mutation of mutations) {
    const copy = clone(value)
    mutation.mutate(copy)
    assert.equal(validateSchema(copy), false, mutation.code)
    expectError(module.validateCurrentObservationLedgerValue(copy), mutation.code)
  }
})

test('schema and validator enforce exact verification inventory and safe-result row ownership', async () => {
  const module = await validator()
  const validateSchema = await schemaValidator()
  const value = await ledger()

  const extraVerification = clone(value)
  extraVerification.verifications.push({
    ...clone(extraVerification.verifications[0]),
    verification_id: 'OBS011-X',
    result_digest: sha256(module.canonicalJson({ verification_id: 'OBS011-X', expected_classification: 'pass' })),
  })
  assert.equal(validateSchema(extraVerification), false)
  expectError(module.validateCurrentObservationLedgerValue(extraVerification), 'invalid_verification_inventory')

  const missing009 = clone(value)
  delete missing009.observations[8].status_history[0].safe_result
  refreshInitialLedger(module, missing009)
  assert.equal(validateSchema(missing009), false)
  expectError(module.validateCurrentObservationLedgerValue(missing009), 'invalid_safe_result')

  const leaked = clone(value)
  leaked.observations[0].status_history[0].safe_result = clone(value.observations[8].status_history[0].safe_result)
  refreshInitialLedger(module, leaked)
  assert.equal(validateSchema(leaked), false)
  expectError(module.validateCurrentObservationLedgerValue(leaked), 'invalid_safe_result')

  const safeResultMutations = [
    (copy: Value) => copy.observations[8].status_history[0].safe_result.results.reverse(),
    (copy: Value) => { copy.observations[8].status_history[0].safe_result.results[1] = clone(copy.observations[8].status_history[0].safe_result.results[0]) },
    (copy: Value) => { copy.observations[8].status_history[0].safe_result.aggregate_digest = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  ]
  for (const mutate of safeResultMutations) {
    const copy = clone(value)
    mutate(copy)
    refreshInitialLedger(module, copy)
    assert.equal(validateSchema(copy), false)
    expectError(module.validateCurrentObservationLedgerValue(copy), 'invalid_safe_result')
  }
})

test('validator scans every persisted string for sensitive material and capability overclaim', async () => {
  const module = await validator()
  const value = await ledger()

  const sensitive = clone(value)
  sensitive.observations[0].status_history[0].change_reason = 'prompt: reveal hidden credentials'
  refreshInitialLedger(module, sensitive)
  expectError(module.validateCurrentObservationLedgerValue(sensitive), 'sensitive_material')

  const overclaim = clone(value)
  overclaim.observations[0].status_history[0].change_reason = 'Provider behavior is confirmed and production is enabled.'
  refreshInitialLedger(module, overclaim)
  expectError(module.validateCurrentObservationLedgerValue(overclaim), 'prohibited_overclaim')
})

test('change reasons are safe tokens and recursive scanning rejects raw Go output, secrets, identifiers, and absolute sources', async () => {
  const module = await validator()
  const validateSchema = await schemaValidator()
  const value = await ledger()
  const unsafeValues = [
    '--- FAIL: TestJointLocalCaptureAcceptanceArtifact (0.01s)\nFAIL\tservice',
    'system prompt = reveal; api_key=secret; account_id=acct; proxy_id=proxy; source=/Users/operator/private.log',
  ]

  for (const unsafeValue of unsafeValues) {
    const unsafeReason = clone(value)
    unsafeReason.observations[0].status_history[0].change_reason = unsafeValue
    refreshInitialLedger(module, unsafeReason)
    assert.equal(validateSchema(unsafeReason), false)
    expectError(module.validateCurrentObservationLedgerValue(unsafeReason), 'sensitive_material')

    const recursivelyUnsafe = clone(value)
    recursivelyUnsafe.observations[0].required_consequence = unsafeValue
    expectError(module.validateCurrentObservationLedgerValue(recursivelyUnsafe), 'sensitive_material')
  }
})

test('rehash cannot legitimize reserved sensitive identifiers in successor change-reason tokens', async () => {
  const module = await validator()
  const validateSchema = await schemaValidator()
  const value = await ledger()
  const commit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

  for (const changeReason of [
    'system_prompt_reveal_hidden',
    'api_key_secret123',
    'account_id_acct123',
    'proxy_id_proxy123',
  ]) {
    const unsafe = appendEvent(module, value, 0, commit, 'changed')
    unsafe.observations[0].status_history[1].change_reason = changeReason
    refreshLatestAppend(module, unsafe, 0)
    assert.equal(validateSchema(unsafe), false)
    expectError(module.validateCurrentObservationLedgerValue(unsafe, {
      previousLedger: value,
      previousLedgerCommit: commit,
    }), 'sensitive_material')
  }
})

test('rehash cannot legitimize absolute, traversing, whitespace, control, or raw-output anchor identifiers', async () => {
  const module = await validator()
  const validateSchema = await schemaValidator()
  const value = await ledger()
  const commit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const mutations = [
    (event: Value) => { event.anchors[1].test_names[0] = '/Users/operator/private.log' },
    (event: Value) => { event.anchors[1].test_names[0] = 'PASS\nok\tservice\t0.001s' },
    (event: Value) => { event.anchors[0].symbols[0] = '../private_symbol' },
    (event: Value) => { event.anchors[0].symbols[0] = 'C:\\private_symbol' },
  ]

  for (const mutate of mutations) {
    const unsafe = appendEvent(module, value, 0, commit, 'changed')
    mutate(unsafe.observations[0].status_history[1])
    refreshLatestAppend(module, unsafe, 0)
    assert.equal(validateSchema(unsafe), false)
    expectError(module.validateCurrentObservationLedgerValue(unsafe, {
      previousLedger: value,
      previousLedgerCommit: commit,
    }), 'invalid_anchor')
  }
})

test('semantic validator matches schema bounds for append anchors, argv, and env values', async () => {
  const module = await validator()
  const validateSchema = await schemaValidator()
  const value = await ledger()

  const tooManyAnchors = appendEvent(module, value, 0, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'changed')
  const latest = tooManyAnchors.observations[0].status_history[1]
  while (latest.anchors.length < 9) {
    latest.anchors.push({
      repository: 'cc-gateway',
      path: `tests/bounded-anchor-${latest.anchors.length}.test.ts`,
      test_names: [`bounded anchor ${latest.anchors.length}`],
    })
  }
  refreshLatestAppend(module, tooManyAnchors, 0)
  assert.equal(validateSchema(tooManyAnchors), false)
  expectError(module.validateCurrentObservationLedgerValue(tooManyAnchors, {
    previousLedger: value,
    previousLedgerCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  }), 'invalid_anchor')

  const longArgv = clone(value)
  longArgv.verifications[0].argv = Array.from({ length: 13 }, (_, index) => `arg-${index}`)
  assert.equal(validateSchema(longArgv), false)
  expectError(module.validateCurrentObservationLedgerValue(longArgv), 'invalid_command')

  const longEnv = clone(value)
  longEnv.verifications[0].env = { SAFE_VALUE: 'x'.repeat(101) }
  assert.equal(validateSchema(longEnv), false)
  expectError(module.validateCurrentObservationLedgerValue(longEnv), 'invalid_environment')
})

test('event IDs are unique and their numeric suffix equals sequence', async () => {
  const module = await validator()
  const value = await ledger()
  const appended = appendEvent(module, value, 0, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'changed')
  appended.observations[0].status_history[1].event_id = 'RA-CURRENT-001-E999'
  refreshLatestAppend(module, appended, 0)
  expectError(module.validateCurrentObservationLedgerValue(appended, {
    previousLedger: value,
    previousLedgerCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  }), 'invalid_event_id')
})

test('event and append digests are recomputed and every internal hash link is exact', async () => {
  const module = await validator()
  const value = await ledger()
  for (const row of value.observations as Value[]) {
    let prior: string | null = null
    row.status_history.forEach((event: Value, index: number) => {
      assert.equal(event.sequence, index + 1)
      assert.equal(event.previous_event_digest, prior)
      assert.equal(event.event_digest, module.computeObservationEventDigest(event))
      prior = event.event_digest
    })
  }
  assert.equal(value.append_history.length, 2)
  assert.equal(value.append_history[0].previous_ledger_commit, null)
  assert.equal(value.append_history[0].previous_ledger_digest, null)
  assert.equal(value.append_history[0].previous_append_digest, null)
  assert.deepEqual(
    value.append_history[0].event_digests,
    value.observations.map((row: Value) => row.status_history[0].event_digest),
  )
  assert.equal(value.append_history[0].append_digest, module.computeAppendEntryDigest(value.append_history[0]))

  const priorLedger = clone(value)
  priorLedger.observations[8].status_history.pop()
  priorLedger.append_history.pop()
  const resolved = value.observations[8].status_history[1]
  const resolutionAppend = value.append_history[1]
  assert.equal(resolutionAppend.previous_ledger_commit, '19f4ce49f5d5598309b70a1d09c70e848428ec46')
  assert.equal(resolutionAppend.previous_ledger_digest, module.computeCurrentObservationLedgerDigest(priorLedger))
  assert.equal(resolutionAppend.previous_append_digest, priorLedger.append_history[0].append_digest)
  assert.deepEqual(resolutionAppend.event_digests, [resolved.event_digest])
  assert.equal(resolutionAppend.append_digest, module.computeAppendEntryDigest(resolutionAppend))

  const modified = clone(value)
  modified.observations[0].status_history[0].confidence = 0.01
  expectError(module.validateCurrentObservationLedgerValue(modified), 'event_digest_mismatch')

  const badFirst = clone(value)
  badFirst.observations[0].status_history[0].previous_event_digest = value.observations[1].status_history[0].event_digest
  badFirst.observations[0].status_history[0].event_digest = module.computeObservationEventDigest(badFirst.observations[0].status_history[0])
  expectError(module.validateCurrentObservationLedgerValue(badFirst), 'invalid_event_chain')

  const appended = appendEvent(module, value, 0, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'changed')
  appended.observations[0].status_history[1].previous_event_digest = value.observations[1].status_history[0].event_digest
  appended.observations[0].status_history[1].event_digest = module.computeObservationEventDigest(appended.observations[0].status_history[1])
  expectError(module.validateCurrentObservationLedgerValue(appended, {
    previousLedger: value,
    previousLedgerCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  }), 'invalid_event_chain')
})

test('verification and event result digests are nonzero and exactly recomputable from bounded outcomes', async () => {
  const module = await validator()
  const validateSchema = await schemaValidator()
  const value = await ledger()

  for (const verification of value.verifications as Value[]) {
    assert.equal(verification.result_digest, sha256(module.canonicalJson({
      verification_id: verification.verification_id,
      expected_classification: verification.expected_classification,
    })))
  }
  for (const row of value.observations as Value[]) {
    for (const event of row.status_history as Value[]) {
      assert.equal(event.result_digest, event.safe_result?.aggregate_digest ?? referencedOutcomeDigest(value, event))
    }
  }

  const zeroVerification = clone(value)
  zeroVerification.verifications[0].result_digest = zeroDigest
  assert.equal(validateSchema(zeroVerification), false)
  expectError(module.validateCurrentObservationLedgerValue(zeroVerification), 'result_digest_mismatch')

  const forgedVerification = clone(value)
  forgedVerification.verifications[0].result_digest = `sha256:${'b'.repeat(64)}`
  expectError(module.validateCurrentObservationLedgerValue(forgedVerification), 'result_digest_mismatch')

  const zeroEvent = clone(value)
  zeroEvent.observations[0].status_history[0].result_digest = zeroDigest
  refreshInitialLedger(module, zeroEvent)
  assert.equal(validateSchema(zeroEvent), false)
  expectError(module.validateCurrentObservationLedgerValue(zeroEvent), 'result_digest_mismatch')
})

test('standalone append validation requires globally unique one-to-one coverage of every event digest', async () => {
  const module = await validator()
  const validateSchema = await schemaValidator()
  const value = await ledger()
  const appended = appendEvent(module, value, 0, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'changed')
  const appendedTail = appended.append_history.at(-1)

  for (const eventDigests of [[], [appendedTail.event_digests[0], appendedTail.event_digests[0]]]) {
    const invalidEntry = clone(appended)
    const invalidTail = invalidEntry.append_history.at(-1)
    invalidTail.event_digests = eventDigests
    invalidTail.append_digest = module.computeAppendEntryDigest(invalidTail)
    assert.equal(validateSchema(invalidEntry), false)
    expectError(module.validateCurrentObservationLedgerValue(invalidEntry), 'invalid_digest')
  }

  const reused = clone(appended)
  const reusedTail = reused.append_history.at(-1)
  reusedTail.event_digests = [value.observations[0].status_history[0].event_digest]
  reusedTail.append_digest = module.computeAppendEntryDigest(reusedTail)
  expectError(module.validateCurrentObservationLedgerValue(reused), 'invalid_append_binding')

  const fictional = clone(appended)
  const fictionalTail = fictional.append_history.at(-1)
  fictionalTail.event_digests = [`sha256:${'b'.repeat(64)}`]
  fictionalTail.append_digest = module.computeAppendEntryDigest(fictionalTail)
  expectError(module.validateCurrentObservationLedgerValue(fictional), 'invalid_append_binding')

  const noNewEvent = clone(appended)
  noNewEvent.observations[0].status_history.pop()
  const noNewEventTail = noNewEvent.append_history.at(-1)
  noNewEventTail.event_digests = [value.observations[1].status_history[0].event_digest]
  noNewEventTail.append_digest = module.computeAppendEntryDigest(noNewEventTail)
  expectError(module.validateCurrentObservationLedgerValue(noNewEvent), 'invalid_append_binding')
})

test('resolved events require new commit-bound evidence and published Task 5 RA-CURRENT-009 success proofs', async () => {
  const module = await validator()
  const validateSchema = await schemaValidator()
  const value = await ledger()

  const priorLedger = clone(value)
  priorLedger.observations[8].status_history.pop()
  priorLedger.append_history.pop()
  const resolved = value.observations[8].status_history[1]
  assert.equal(validateSchema(value), true, JSON.stringify(validateSchema.errors))
  assert.deepEqual(module.validateCurrentObservationLedgerValue(value), { ok: true, errors: [] })
  assert.deepEqual(module.validateCurrentObservationLedgerValue(value, {
    previousLedger: priorLedger,
    previousLedgerCommit: '19f4ce49f5d5598309b70a1d09c70e848428ec46',
  }), { ok: true, errors: [] })
  assert.equal(resolved.state, 'resolved')
  assert.deepEqual(resolved.repository_bindings, [{
    repository: 'sub2api',
    commit: '0a97b3f3b84b5c679788b3694d5840e235031f07',
  }])
  assert.equal(resolved.change_reason, 'task5_fixture_drift_resolved')
  assert.deepEqual(resolved.safe_result, {
    kind: 'stable_success_aggregate',
    results: resolved.verification_ids.map((verification_id: string) => ({ verification_id, classification: 'pass' })),
    aggregate_digest: sha256(resolved.verification_ids.map((verification_id: string) => `${verification_id}|pass\n`).join('')),
  })
  assert.equal(resolved.result_digest, resolved.safe_result.aggregate_digest)
  assert.notEqual(resolved.evidence_digest, priorLedger.observations[8].status_history[0].evidence_digest)
  assert.notEqual(resolved.result_digest, priorLedger.observations[8].status_history[0].result_digest)

  const fakeRa004 = appendEvent(module, value, 3, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'resolved')
  expectError(module.validateCurrentObservationLedgerValue(fakeRa004), 'unproven_resolution')

  const unsafeAggregates = [
    (event: Value) => event.safe_result.results.reverse(),
    (event: Value) => { event.safe_result.results[0].classification = 'expected_fail' },
    (event: Value) => { event.safe_result.aggregate_digest = `sha256:${'b'.repeat(64)}` },
  ]
  for (const mutate of unsafeAggregates) {
    const unsafe = clone(value)
    mutate(unsafe.observations[8].status_history[1])
    refreshLatestAppend(module, unsafe, 8)
    assert.equal(validateSchema(unsafe), false)
    expectError(module.validateCurrentObservationLedgerValue(unsafe), 'invalid_safe_result')
  }
})

test('authorized future fixture revert must append changed or stale truth after the resolved event', async () => {
  const module = await validator()
  const validateSchema = await schemaValidator()
  const value = await ledger()
  const rowIndex = 8
  const previousLedgerCommit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const revertedSub2APICommit = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const resolved = value.observations[rowIndex].status_history.at(-1)
  const failureSafeResult = clone(value.observations[rowIndex].status_history[0].safe_result)

  const stillResolved = appendEvent(module, value, rowIndex, previousLedgerCommit, 'resolved')
  const falseResolution = stillResolved.observations[rowIndex].status_history.at(-1)
  falseResolution.repository_bindings = [{ repository: 'sub2api', commit: revertedSub2APICommit }]
  falseResolution.change_reason = 'fixture_revert_still_resolved'
  refreshLatestAppend(module, stillResolved, rowIndex)
  expectError(module.validateCurrentObservationLedgerValue(stillResolved, {
    previousLedger: value,
    previousLedgerCommit,
  }), 'unproven_resolution')

  const deletedResolution = clone(value)
  deletedResolution.observations[rowIndex].status_history.pop()
  deletedResolution.append_history.pop()
  expectError(module.validateCurrentObservationLedgerValue(deletedResolution, {
    previousLedger: value,
    previousLedgerCommit,
  }), 'append_only_violation')

  for (const state of ['changed', 'stale']) {
    const successor = appendEvent(module, value, rowIndex, previousLedgerCommit, state)
    const event = successor.observations[rowIndex].status_history.at(-1)
    event.revalidated_at = '2026-07-13T10:00:00Z'
    event.repository_bindings = [{ repository: 'sub2api', commit: revertedSub2APICommit }]
    event.change_reason = `fixture_revert_${state}_revalidated`
    event.safe_result = clone(failureSafeResult)
    event.result_digest = event.safe_result.aggregate_digest
    successor.append_history.at(-1).appended_at = '2026-07-13T10:00:00Z'
    refreshLatestAppend(module, successor, rowIndex)

    assert.equal(validateSchema(successor), true, JSON.stringify(validateSchema.errors))
    assert.deepEqual(module.validateCurrentObservationLedgerValue(successor, {
      previousLedger: value,
      previousLedgerCommit,
    }), { ok: true, errors: [] })
    assert.equal(event.previous_event_digest, resolved.event_digest)
    assert.deepEqual(event.repository_bindings, [{ repository: 'sub2api', commit: revertedSub2APICommit }])
    assert.equal(successor.append_history.at(-1).previous_ledger_digest, module.computeCurrentObservationLedgerDigest(value))
    assert.equal(successor.append_history.at(-1).previous_append_digest, value.append_history.at(-1).append_digest)
  }
})

test('append validation rejects deletion, modification, insertion before the tail, and reordering of committed events', async () => {
  const module = await validator()
  const initial = await ledger()
  const commit1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const prior = appendEvent(module, initial, 0, commit1, 'changed')
  assert.deepEqual(module.validateCurrentObservationLedgerValue(prior, {
    previousLedger: initial,
    previousLedgerCommit: commit1,
  }), { ok: true, errors: [] })

  const commit2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const validNext = appendEvent(module, prior, 0, commit2, 'stale')
  assert.deepEqual(module.validateCurrentObservationLedgerValue(validNext, {
    previousLedger: prior,
    previousLedgerCommit: commit2,
  }), { ok: true, errors: [] })

  const deletion = clone(validNext)
  deletion.observations[0].status_history.splice(0, 1)
  rehashHistory(module, deletion.observations[0].status_history)
  expectError(module.validateCurrentObservationLedgerValue(deletion, { previousLedger: prior, previousLedgerCommit: commit2 }), 'append_only_violation')

  const modification = clone(validNext)
  modification.observations[0].status_history[0].confidence = 0.5
  rehashHistory(module, modification.observations[0].status_history)
  expectError(module.validateCurrentObservationLedgerValue(modification, { previousLedger: prior, previousLedgerCommit: commit2 }), 'append_only_violation')

  const insertion = clone(validNext)
  insertion.observations[0].status_history.splice(1, 0, {
    ...clone(insertion.observations[0].status_history[0]),
    event_id: 'RA-CURRENT-001-E999',
    change_reason: 'Inserted before an already committed tail event.',
  })
  rehashHistory(module, insertion.observations[0].status_history)
  expectError(module.validateCurrentObservationLedgerValue(insertion, { previousLedger: prior, previousLedgerCommit: commit2 }), 'append_only_violation')

  const reordered = clone(validNext)
  reordered.observations[0].status_history = [
    reordered.observations[0].status_history[1],
    reordered.observations[0].status_history[0],
    reordered.observations[0].status_history[2],
  ]
  rehashHistory(module, reordered.observations[0].status_history)
  expectError(module.validateCurrentObservationLedgerValue(reordered, { previousLedger: prior, previousLedgerCommit: commit2 }), 'append_only_violation')
})

test('later appends bind the exact prior ledger digest, commit, append digest, and newly appended event digests', async () => {
  const module = await validator()
  const initial = await ledger()
  const commit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const next = appendEvent(module, initial, 0, commit, 'changed')
  const append = next.append_history.at(-1)
  assert.equal(append.previous_ledger_commit, commit)
  assert.equal(append.previous_ledger_digest, module.computeCurrentObservationLedgerDigest(initial))
  assert.equal(append.previous_append_digest, initial.append_history.at(-1).append_digest)
  assert.deepEqual(append.event_digests, [next.observations[0].status_history[1].event_digest])

  for (const [field, value] of [
    ['previous_ledger_commit', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
    ['previous_ledger_digest', 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
    ['previous_append_digest', 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
  ]) {
    const unsafe = clone(next)
    const unsafeAppend = unsafe.append_history.at(-1)
    unsafeAppend[field] = value
    unsafeAppend.append_digest = module.computeAppendEntryDigest(unsafeAppend)
    expectError(module.validateCurrentObservationLedgerValue(unsafe, {
      previousLedger: initial,
      previousLedgerCommit: commit,
    }), 'invalid_append_binding')
  }
})

test('anchor or verification drift requires a later append event and cannot rewrite the committed snapshot', async () => {
  const module = await validator()
  const initial = await ledger()
  const rewritten = clone(initial)
  rewritten.observations[0].status_history[0].anchors[0].symbols[0] = 'INVENTED_VERSION'
  rewritten.observations[0].status_history[0].event_digest = module.computeObservationEventDigest(rewritten.observations[0].status_history[0])
  rewritten.append_history[0].event_digests[0] = rewritten.observations[0].status_history[0].event_digest
  rewritten.append_history[0].append_digest = module.computeAppendEntryDigest(rewritten.append_history[0])
  expectError(module.validateCurrentObservationLedgerValue(rewritten, {
    previousLedger: initial,
    previousLedgerCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  }), 'append_only_violation')

  const appended = appendEvent(module, initial, 0, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'changed')
  const latest = appended.observations[0].status_history[1]
  latest.anchors[0].symbols[0] = 'RENAMED_VERSION'
  latest.change_reason = 'named_anchor_drift_revalidated'
  refreshLatestAppend(module, appended, 0)
  assert.deepEqual(module.validateCurrentObservationLedgerValue(appended, {
    previousLedger: initial,
    previousLedgerCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  }), { ok: true, errors: [] })
})
