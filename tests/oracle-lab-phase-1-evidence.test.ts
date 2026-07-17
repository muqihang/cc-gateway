import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'

import {
  authorizePhase1Retry,
  buildPhase1Handoff,
  buildPhase1IntegrationEntry,
  buildPhase1IntegrationReceipt,
  buildPhase1CommandEnvironment,
  canonicalizePhase1FailureEvents,
  classifyPhase1Result,
  comparePhase1IgnoredState,
  derivePhase1ExternalDependencyBinding,
  derivePhase1ExternalDependencyReference,
  derivePhase1IgnoredStateBinding,
  derivePhase1ImplementationTreeBinding,
  derivePhase1StageAuthorityHeads,
  inspectPhase1ReceiptHistory,
  parsePhase1CLI,
  parsePhase1GoModuleList,
  parsePhase1RedFailureLeaves,
  parsePhase1TrackedTree,
  PHASE2_ENTRY_CONDITIONS,
  preparePhase1ExternalDependencies,
  selectPhase1GoModuleContentDirectory,
  selectLatestPhase1ExecutionContext,
  validatePhase1AttemptChain,
  validatePhase1IgnoredSymlinkClosure,
  validatePhase1CatalogValue,
  validatePhase1CaptureInputs,
  validatePhase1FeatureEvidenceCommit,
  validatePhase1FeatureReviewAttestation,
  validatePhase1FeatureReviewValue,
  validatePhase1ExternalDependencyChain,
  validatePhase1ExternalDependencyReference,
  validatePhase1ExternalDependencySet,
  validatePhase1HandoffValue,
  validatePhase1IntegrationEntryValue,
  validatePhase1IntegrationReceiptValue,
  validatePhase1LoadedResultsAuthority,
  validatePhase1LoadedFeatureReview,
  validatePhase1CommittedArtifactChain,
  validatePhase1GoModuleCacheMetadata,
  validatePhase1GoModuleCacheRoot,
  validatePhase1MergeTopology,
  validatePhase1ResultsValue,
  verifyPhase1FinalRemote,
} from '../tools/oracle-lab/phase-1-evidence.js'
import {
  buildPhase1SandboxProfile,
  resolvePhase1LoopbackSandbox,
  runPhase1SandboxCanaries,
  wrapPhase1Command,
} from '../tools/oracle-lab/phase-1-loopback-sandbox.js'
import { canonicalJson, sha256 } from '../tools/oracle-lab/harness-core.js'

const root = path.resolve(import.meta.dirname, '..')
const catalogPath = path.join(root, 'docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json')

const EXPECTED_COMMAND_IDS = [
  'sub-b1-b3', 'sub-formal-pool', 'sub-full-go', 'sub-frontend-h1',
  'sub-frontend-typecheck', 'sub-frontend-build', 'sub-frontend-build-repeat',
  'cc-listener-h1', 'cc-upstream-tls-h1',
  'cc-build', 'cc-build-repeat', 'cc-tests', 'cc-tests-repeat',
  'sidecar-tests', 'joint-local-chain', 'cc-b4-b6-red', 'sidecar-b5-b6-red',
] as const

const CC_RED_LIFECYCLE = {
  parser: 'node_test_tap_v1',
  tap_version_count: 1,
  terminal_plan_count: 1,
  declared_test_count: 68,
  observed_test_count: 68,
  pass_count: 7,
  fail_count: 61,
  cancelled_count: 0,
  skipped_count: 0,
  todo_count: 0,
  unexplained_stderr_line_count: 0,
} as const

const SIDECAR_RED_LIFECYCLE = {
  parser: 'go_test_json_leaf_v1',
  packages: [
    {
      package_suffix: 'internal/control', start_count: 1, run_test_count: 4,
      terminal_test_count: 4, pass_test_count: 2, fail_test_count: 2,
      skip_test_count: 0, package_fail_terminal_count: 1, post_terminal_event_count: 0,
    },
    {
      package_suffix: 'internal/server', start_count: 1, run_test_count: 64,
      terminal_test_count: 64, pass_test_count: 11, fail_test_count: 53,
      skip_test_count: 0, package_fail_terminal_count: 1, post_terminal_event_count: 0,
    },
  ],
  unexplained_stderr_line_count: 0,
  malformed_or_unparsed_event_count: 0,
} as const

const CC_RED_FAILURE_NAMES = [
  'B4 handleRequest denies direct fallback configuration before DNS socket or dial',
  'B4 handleRequest denies mismatched proxy generation before DNS socket or dial',
  'B4 handleRequest denies missing manifest authority before DNS socket or dial',
  'B4 handleRequest denies missing proxy generation before DNS socket or dial',
  'B4 handleRequest denies missing sidecar before DNS socket or dial',
  'B4 handleRequest denies missing verified context before DNS socket or dial',
  'B4 handleRequest denies unknown manifest authority before DNS socket or dial',
  'B5 authentication changes after absolute deadline mutation',
  'B5 authentication changes after account identity mutation',
  'B5 authentication changes after attempt ID mutation',
  'B5 authentication changes after content encoding mutation',
  'B5 authentication changes after content length mutation',
  'B5 authentication changes after envelope version mutation',
  'B5 authentication changes after expected summary mutation',
  'B5 authentication changes after final forwarded-header hash mutation',
  'B5 authentication changes after final request-body hash mutation',
  'B5 authentication changes after key epoch mutation',
  'B5 authentication changes after manifest authority mutation',
  'B5 authentication changes after method mutation',
  'B5 authentication changes after nonce mutation',
  'B5 authentication changes after profile ref mutation',
  'B5 authentication changes after proxy generation mutation',
  'B5 authentication changes after response policy mutation',
  'B5 authentication changes after route mutation',
  'B5 authentication changes after target path mutation',
  'B5 authentication changes after target scheme mutation',
  'B5 authentication changes after timestamp mutation',
  'B5 authentication changes after verified context mutation',
  'B5 complete control includes absolute_deadline_ms',
  'B5 complete control includes account_identity_ref',
  'B5 complete control includes attempt_id',
  'B5 complete control includes content_encoding',
  'B5 complete control includes content_length',
  'B5 complete control includes envelope_version',
  'B5 complete control includes expected_response_policy_ref',
  'B5 complete control includes final_headers_hash',
  'B5 complete control includes key_epoch',
  'B5 complete control includes manifest_authority_ref',
  'B5 complete control includes nonce',
  'B5 complete control includes proxy_generation',
  'B5 complete control includes request_body_hash',
  'B5 complete control includes timestamp_ms',
  'B5 complete control includes verified_context_ref',
  'B6 permits private proxy only through an explicit approved-range policy',
  'B6 rejects DNS rebinding without pinned resolution',
  'B6 rejects IPv4 link-local',
  'B6 rejects IPv4 loopback',
  'B6 rejects IPv4 multicast',
  'B6 rejects IPv4 unspecified',
  'B6 rejects IPv4-mapped IPv6 loopback',
  'B6 rejects IPv6 link-local',
  'B6 rejects IPv6 loopback',
  'B6 rejects IPv6 multicast',
  'B6 rejects IPv6 unspecified',
  'B6 rejects alternate dial target',
  'B6 rejects cloud metadata',
  'B6 rejects expanded IPv4-mapped IPv6',
  'B6 rejects nested proxy directive',
  'B6 rejects private IPv4 without explicit policy',
  'B6 rejects redirect directive',
  'B6 rejects scheme confusion',
] as const

const SIDECAR_RED_FAILURE_NAMES = [
  'TestPhase0B5BindingRejectsEveryControlMutation/expected_tls_summary_bucket',
  'TestPhase0B5BindingRejectsEveryControlMutation/method',
  'TestPhase0B5BindingRejectsEveryControlMutation/profile_ref',
  'TestPhase0B5BindingRejectsEveryControlMutation/route',
  'TestPhase0B5BindingRejectsEveryControlMutation/target_path',
  'TestPhase0B5BindingRejectsEveryControlMutation/target_scheme',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/absolute_deadline_ms',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/account_identity_ref',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/attempt_id',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/content_encoding',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/content_length',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/envelope_version',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/expected_response_policy_ref',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/expected_tls_summary_bucket',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/final_headers_hash',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/key_epoch',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/manifest_authority_ref',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/method',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/nonce',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/profile_ref',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/proxy_generation',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/request_body_hash',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/route',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/target_path',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/target_scheme',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/timestamp_ms',
  'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/verified_context_ref',
  'TestPhase0B5ControlRejectsLegacyIncompleteControl',
  'TestPhase0B5ControlRequiresCompleteV2Envelope',
  'TestPhase0B5RejectsLegacyPartialProxyBinding',
  'TestPhase0B5ReplayRejectedAfterCompletionRestartAndReplicaChange/distinct_replica_with_shared_replay_state',
  'TestPhase0B5ReplayRejectedAfterCompletionRestartAndReplicaChange/restart_with_persistent_replay_state',
  'TestPhase0B5ReplayRejectedAfterCompletionRestartAndReplicaChange/same_instance_after_successful_completion',
  'TestPhase0B6RebindingResolutionIsPinnedBeforeDial',
  'TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/alternate_dial_target',
  'TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/dns_rebinding_unpinned',
  'TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/expanded_mapped_ipv6',
  'TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/ipv4_link_local',
  'TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/ipv4_loopback',
  'TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/ipv4_mapped_ipv6',
  'TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/ipv4_multicast',
  'TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/ipv4_unspecified',
  'TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/ipv6_link_local',
  'TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/ipv6_loopback',
  'TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/ipv6_multicast',
  'TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/ipv6_unspecified',
  'TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/metadata',
  'TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/nested_proxy_directive',
  'TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/private_without_policy',
  'TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/redirect_directive',
  'TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/scheme_confusion',
] as const

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8')) as unknown
}

test('Phase 1 catalog has exact independent IDs and RED inventory', async () => {
  const catalog = await readJson(catalogPath) as Array<Record<string, unknown>>
  assert.deepEqual(catalog.map((entry) => entry.id), EXPECTED_COMMAND_IDS)
  assert.deepEqual(validatePhase1CatalogValue(catalog), { ok: true, errors: [] })
  const cc = catalog.find((entry) => entry.id === 'cc-b4-b6-red')!
  const sidecar = catalog.find((entry) => entry.id === 'sidecar-b5-b6-red')!
  assert.deepEqual(cc.expected_parser_lifecycle, CC_RED_LIFECYCLE)
  assert.deepEqual(cc.expected_failure_names, CC_RED_FAILURE_NAMES)
  assert.deepEqual(cc.expected_failure_families, ['B4', 'B5', 'B6'])
  assert.equal(cc.expected_failure_count, 61)
  assert.deepEqual(sidecar.expected_parser_lifecycle, SIDECAR_RED_LIFECYCLE)
  assert.deepEqual(sidecar.expected_failure_names, SIDECAR_RED_FAILURE_NAMES)
  assert.deepEqual(sidecar.expected_failure_families, ['TestPhase0B5', 'TestPhase0B6'])
  assert.equal(sidecar.expected_failure_count, 51)
})

test('catalog validation rejects duplicate names, count drift, lifecycle drift, and unknown keys', async () => {
  const catalog = await readJson(catalogPath) as Array<Record<string, unknown>>
  for (const mutate of [
    (value: typeof catalog) => (value[15].expected_failure_names as string[]).push(CC_RED_FAILURE_NAMES[0]),
    (value: typeof catalog) => { value[16].expected_failure_count = 50 },
    (value: typeof catalog) => {
      const lifecycle = value[16].expected_parser_lifecycle as { packages: Array<{ run_test_count: number }> }
      lifecycle.packages[1].run_test_count = 63
    },
    (value: typeof catalog) => { value[15].undeclared = true },
  ]) {
    const changed = structuredClone(catalog)
    mutate(changed)
    assert.equal(validatePhase1CatalogValue(changed).ok, false)
  }
})

test('catalog binds the dedicated formal-pool contract path only to isolated CC full-suite rows', async () => {
  const catalog = await readJson(catalogPath) as Array<Record<string, any>>
  const contractPath = '${SUB2API_CONTRACT_ROOT}/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json'
  for (const id of ['cc-tests', 'cc-tests-repeat']) {
    assert.deepEqual(catalog.find((entry) => entry.id === id)?.env.SUB2API_FORMAL_POOL_CONTRACT_PATH, contractPath)
    assert.equal(Object.hasOwn(catalog.find((entry) => entry.id === id)!.env, 'SUB2API_ROOT'), false)
  }
  for (const entry of catalog.filter((candidate) => !['cc-tests', 'cc-tests-repeat'].includes(candidate.id))) {
    assert.equal(Object.hasOwn(entry.env, 'SUB2API_FORMAL_POOL_CONTRACT_PATH'), false, entry.id)
  }
  for (const mutate of [
    (value: typeof catalog) => { delete value.find((entry) => entry.id === 'cc-tests')!.env.SUB2API_FORMAL_POOL_CONTRACT_PATH },
    (value: typeof catalog) => { value.find((entry) => entry.id === 'cc-tests')!.env.SUB2API_FORMAL_POOL_CONTRACT_PATH = 'relative/vectors.json' },
    (value: typeof catalog) => { value.find((entry) => entry.id === 'cc-tests-repeat')!.env.SUB2API_ROOT = '${SUB2API_ROOT}' },
    (value: typeof catalog) => { value.find((entry) => entry.id === 'cc-build')!.env.SUB2API_FORMAL_POOL_CONTRACT_PATH = contractPath },
  ]) {
    const changed = structuredClone(catalog)
    mutate(changed)
    assert.equal(validatePhase1CatalogValue(changed).ok, false)
  }
})

test('closed command environments omit capture authority from CC full-suite children and bind exclusive caches', async () => {
  const catalog = await readJson(catalogPath) as Array<Record<string, any>>
  const roots = { cc: '/reviewed/cc', sub: '/reviewed/sub', contract: '/reviewed/contract' }
  const runtime = { goBuildCache: '/tmp/oracle-lab-phase1-go-build-unique', goModuleCache: '/reviewed/go/pkg/mod' }
  for (const command of catalog) {
    const env = buildPhase1CommandEnvironment(command as never, roots, runtime)
    assert.equal(env.GOCACHE, runtime.goBuildCache)
    assert.equal(env.GOMODCACHE, runtime.goModuleCache)
    assert.equal(env.GOFLAGS, '-mod=readonly')
    assert.equal(env.NODE_OPTIONS, undefined)
    if (['cc-tests', 'cc-tests-repeat'].includes(command.id)) {
      assert.equal(env.SUB2API_ROOT, undefined)
      assert.equal(env.SUB2API_FORMAL_POOL_CONTRACT_PATH, '/reviewed/contract/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json')
    } else {
      assert.equal(env.SUB2API_FORMAL_POOL_CONTRACT_PATH, undefined, command.id)
      assert.equal(env.SUB2API_ROOT, command.id === 'cc-b4-b6-red' ? roots.contract : roots.sub, command.id)
    }
  }
  assert.throws(() => buildPhase1CommandEnvironment(catalog[11] as never, roots, runtime, { NODE_OPTIONS: '--import=/tmp/evil.mjs' }),
    (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === 'unsafe_full_suite_environment')
  const inheritedCache = buildPhase1CommandEnvironment(catalog[11] as never, roots, runtime, { npm_config_cache: '/tmp/caller-selected' })
  assert.equal(inheritedCache.npm_config_cache, undefined)
  assert.throws(() => buildPhase1CommandEnvironment(catalog[11] as never, roots, { ...runtime, goBuildCache: '/tmp/caller-selected' }),
    (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === 'unsafe_full_suite_build_cache')
})

test('RED event canonicalization preserves the multiset and derives unique families', () => {
  const canonical = canonicalizePhase1FailureEvents([...CC_RED_FAILURE_NAMES].reverse())
  assert.deepEqual(canonical.failure_event_names, CC_RED_FAILURE_NAMES)
  assert.deepEqual(canonical.failure_names, CC_RED_FAILURE_NAMES)
  assert.deepEqual(canonical.observed_failure_families, ['B4', 'B5', 'B6'])
  assert.equal(canonical.failure_event_count, 61)
  assert.equal(canonical.failure_count, 61)
  const duplicated = canonicalizePhase1FailureEvents([...CC_RED_FAILURE_NAMES, CC_RED_FAILURE_NAMES[0]])
  assert.equal(duplicated.failure_event_count, 62)
  assert.equal(duplicated.failure_count, 61)
})

test('RED classification accepts only an exact complete inventory', async () => {
  const catalog = await readJson(catalogPath) as Array<Record<string, unknown>>
  const command = catalog[15]
  const valid = classifyPhase1Result({
    command,
    exitCode: 1,
    stdout: '',
    stderr: '',
    failureEvents: [...CC_RED_FAILURE_NAMES].reverse(),
    parserLifecycle: CC_RED_LIFECYCLE,
  })
  assert.equal(valid.status, 'expected_fail')
  for (const failureEvents of [
    CC_RED_FAILURE_NAMES.slice(1),
    [...CC_RED_FAILURE_NAMES, 'B4 invented same-prefix leaf'],
    [...CC_RED_FAILURE_NAMES, CC_RED_FAILURE_NAMES[0]],
    [...CC_RED_FAILURE_NAMES, 'HA-P0-009 unrelated failure'],
  ]) {
    assert.equal(classifyPhase1Result({
      command, exitCode: 1, stdout: '', stderr: '', failureEvents, parserLifecycle: CC_RED_LIFECYCLE,
    }).status, 'unexpected_fail')
  }
})

test('tracked-tree parser is NUL-safe and implementation policy is exact', () => {
  const raw = Buffer.from(
    '100644 blob 1111111111111111111111111111111111111111\tREADME.md\0' +
    '100755 blob 2222222222222222222222222222222222222222\tscripts/run\0',
  )
  assert.deepEqual(parsePhase1TrackedTree(raw), [
    { mode: '100644', object_type: 'blob', object_oid: '1111111111111111111111111111111111111111', path: 'README.md' },
    { mode: '100755', object_type: 'blob', object_oid: '2222222222222222222222222222222222222222', path: 'scripts/run' },
  ])
  const baseline = derivePhase1ImplementationTreeBinding({
    repository: 'cc_gateway', sourceCommit: 'a'.repeat(40), rawTree: raw,
  })
  const excluded = derivePhase1ImplementationTreeBinding({
    repository: 'cc_gateway', sourceCommit: 'b'.repeat(40), rawTree: Buffer.concat([
      raw,
      Buffer.from('100644 blob 3333333333333333333333333333333333333333\tdocs/superpowers/evidence/phase-1/x.json\0'),
    ]),
  })
  assert.equal(excluded.entries_digest, baseline.entries_digest)
  assert.throws(() => parsePhase1TrackedTree(Buffer.from('100644 blob bad\tbad\0')))
})

test('Phase 1 CLI is closed and rejects duplicate or undeclared flags', () => {
  const valid = [
    'validate-catalog', '--catalog', 'docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json',
  ]
  assert.equal(parsePhase1CLI(valid).command, 'validate-catalog')
  assert.throws(() => parsePhase1CLI([...valid, '--catalog', 'duplicate.json']))
  assert.throws(() => parsePhase1CLI([...valid, '--unknown', 'value']))
  assert.throws(() => parsePhase1CLI(['unknown-command']))
})

function tapStream(names: readonly string[]): string {
  const passes = Array.from({ length: 7 }, (_, index) => `GREEN synthetic ${index + 1}`)
  const points = [...passes.map((name) => ({ ok: true, name })), ...names.map((name) => ({ ok: false, name }))]
  return [
    'TAP version 13',
    ...points.map((point, index) => `${point.ok ? 'ok' : 'not ok'} ${index + 1} - ${point.name}`),
    '1..68', '# tests 68', '# suites 0', '# pass 7', '# fail 61',
    '# cancelled 0', '# skipped 0', '# todo 0', '# duration_ms 1', '',
  ].join('\n')
}

function goJsonStream(names: readonly string[]): string {
  const byPackage = {
    'example/internal/control': names.filter((name) => name.startsWith('TestPhase0B5')).slice(0, 2),
    'example/internal/server': names.filter((name) => !names.filter((item) => item.startsWith('TestPhase0B5')).slice(0, 2).includes(name)),
  }
  const output: string[] = []
  for (const [pkg, failures] of Object.entries(byPackage)) {
    output.push(JSON.stringify({ Action: 'start', Package: pkg }))
    const expectedRuns = pkg.endsWith('internal/control') ? 4 : 64
    const expectedPasses = pkg.endsWith('internal/control') ? 2 : 11
    const parentFailures = pkg.endsWith('internal/server') ? [
      'TestPhase0B5BindingRejectsEveryControlMutation',
      'TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations',
      'TestPhase0B5ReplayRejectedAfterCompletionRestartAndReplicaChange',
      'TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial',
    ] : []
    const terminalFailures = [...parentFailures, ...failures]
    const tests = [
      ...Array.from({ length: expectedPasses }, (_, index) => `TestPassing${index + 1}`),
      ...terminalFailures,
    ]
    assert.equal(tests.length, expectedRuns)
    for (const name of tests) {
      output.push(JSON.stringify({ Action: 'run', Package: pkg, Test: name }))
      output.push(JSON.stringify({ Action: terminalFailures.includes(name) ? 'fail' : 'pass', Package: pkg, Test: name }))
    }
    output.push(JSON.stringify({ Action: 'fail', Package: pkg }))
  }
  return `${output.join('\n')}\n`
}

test('machine RED parsers require complete exact TAP and Go lifecycles', () => {
  const tap = parsePhase1RedFailureLeaves({ parser: 'node_test_tap_v1', stdout: tapStream(CC_RED_FAILURE_NAMES), stderr: '' })
  assert.deepEqual(tap.failure_events, CC_RED_FAILURE_NAMES)
  assert.deepEqual(tap.lifecycle, CC_RED_LIFECYCLE)
  const go = parsePhase1RedFailureLeaves({ parser: 'go_test_json_leaf_v1', stdout: goJsonStream(SIDECAR_RED_FAILURE_NAMES), stderr: '' })
  assert.deepEqual(go.failure_events, SIDECAR_RED_FAILURE_NAMES)
  assert.deepEqual(go.lifecycle, SIDECAR_RED_LIFECYCLE)

  for (const input of [
    { parser: 'node_test_tap_v1' as const, stdout: tapStream(CC_RED_FAILURE_NAMES).replace('1..68\n', ''), stderr: '' },
    { parser: 'node_test_tap_v1' as const, stdout: tapStream(CC_RED_FAILURE_NAMES), stderr: 'diagnostic' },
    { parser: 'go_test_json_leaf_v1' as const, stdout: goJsonStream(SIDECAR_RED_FAILURE_NAMES).split('\n').slice(0, -3).join('\n'), stderr: '' },
    { parser: 'go_test_json_leaf_v1' as const, stdout: `${goJsonStream(SIDECAR_RED_FAILURE_NAMES)}not-json\n`, stderr: '' },
    { parser: 'go_test_json_leaf_v1' as const, stdout: `${goJsonStream(SIDECAR_RED_FAILURE_NAMES)}${JSON.stringify({ Action: 'output', Package: 'example/internal/server', Output: 'package diagnostic' })}\n`, stderr: '' },
    { parser: 'go_test_json_leaf_v1' as const, stdout: `${goJsonStream(SIDECAR_RED_FAILURE_NAMES)}${JSON.stringify({ Action: 'pause', Package: 'example/internal/server', Test: 'TestPassing1' })}\n`, stderr: '' },
  ]) assert.throws(() => parsePhase1RedFailureLeaves(input), (error: unknown) =>
    error instanceof Error && (error as Error & { code?: string }).code === 'red_runner_output_incomplete')
})

test('raw parser event permutation canonicalizes while persisted order remains closed', () => {
  const parsed = parsePhase1RedFailureLeaves({
    parser: 'node_test_tap_v1',
    stdout: tapStream([...CC_RED_FAILURE_NAMES].reverse()),
    stderr: '',
  })
  assert.deepEqual(canonicalizePhase1FailureEvents(parsed.failure_events).failure_names, CC_RED_FAILURE_NAMES)
})

test('ignored-state policies allow only exact deterministic build surfaces', () => {
  const empty = derivePhase1IgnoredStateBinding({ repository: 'cc_gateway', records: [] })
  const dist = derivePhase1IgnoredStateBinding({
    repository: 'cc_gateway',
    records: [
      { path: 'dist', type: 'directory', mode: 0o755 },
      { path: 'dist/index.js', type: 'regular', mode: 0o644, size: 4, content_digest: `sha256:${'1'.repeat(64)}` },
    ],
  })
  assert.doesNotThrow(() => comparePhase1IgnoredState({ repository: 'cc_gateway', before: empty, after: dist, policy: 'cc_build_dist_v1' }))
  assert.throws(() => comparePhase1IgnoredState({ repository: 'cc_gateway', before: empty, after: dist, policy: 'none' }))
  const executable = derivePhase1IgnoredStateBinding({
    repository: 'cc_gateway',
    records: [{ path: 'dist/run', type: 'regular', mode: 0o755, size: 1, content_digest: `sha256:${'2'.repeat(64)}` }],
  })
  assert.throws(() => comparePhase1IgnoredState({ repository: 'cc_gateway', before: empty, after: executable, policy: 'cc_build_dist_v1' }))
})

test('ignored symlink closure accepts internal targets and rejects escapes, dangling links, and cycles', () => {
  assert.doesNotThrow(() => validatePhase1IgnoredSymlinkClosure([
    { path: 'node_modules/pkg/file.js', type: 'regular' },
    { path: 'node_modules/.bin/tool', type: 'symlink', symlink_target: '../pkg/file.js' },
  ]))
  for (const records of [
    [{ path: 'node_modules/tool', type: 'symlink', symlink_target: '/tmp/tool' }],
    [{ path: 'node_modules/tool', type: 'symlink', symlink_target: '../../outside' }],
    [{ path: 'node_modules/tool', type: 'symlink', symlink_target: 'missing' }],
    [
      { path: 'node_modules/a', type: 'symlink', symlink_target: 'b' },
      { path: 'node_modules/b', type: 'symlink', symlink_target: 'a' },
    ],
  ]) assert.throws(() => validatePhase1IgnoredSymlinkClosure(records as never))
})

test('macOS sandbox profile is exact and all commands are wrapped without shell', () => {
  const profile = buildPhase1SandboxProfile()
  assert.equal(profile, [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    '(allow network-outbound (remote tcp "localhost:*"))',
    '(allow network-inbound (local tcp "localhost:*"))',
    '',
  ].join('\n'))
  assert.deepEqual(wrapPhase1Command({ executable: '/usr/bin/sandbox-exec', profilePath: '/tmp/profile', argv: ['npm', 'test'] }),
    ['/usr/bin/sandbox-exec', '-f', '/tmp/profile', 'npm', 'test'])
  assert.throws(() => wrapPhase1Command({ executable: '/usr/bin/sandbox-exec', profilePath: '/tmp/profile', argv: [] }))
})

test('real macOS sandbox canaries return the closed loopback-only verdict', () => {
  const sandbox = resolvePhase1LoopbackSandbox({ temporaryRoot: os.tmpdir() })
  assert.deepEqual(runPhase1SandboxCanaries(sandbox), {
    loopback_socket: 'pass',
    loopback_ipv6_socket: 'pass',
    non_loopback_test_net_socket: 'denied_by_policy',
    policy_bypass_detected: false,
  })
})

const commit = (character: string) => character.repeat(40)
const digest = (character: string) => `sha256:${character.repeat(64)}`

function signed<T extends Record<string, unknown>>(value: T, field: string): T & Record<string, string> {
  return { ...value, [field]: sha256(canonicalJson(value)) }
}

function ignored(repository: 'cc_gateway' | 'sub2api') {
  return {
    algorithm: 'git_exclude_standard_recursive_v1', repository,
    endpoint_count: 0, entry_count: 0, regular_file_count: 0,
    directory_count: 0, symlink_count: 0, regular_file_bytes: 0,
    digest: sha256(canonicalJson([])),
  }
}

function transition(repository: 'cc_gateway' | 'sub2api', policy: string) {
  const state = ignored(repository)
  return { policy, policy_digest: sha256(canonicalJson({ policy })), before: state, after: state }
}

function dependencyBinding(repository: 'cc_gateway' | 'sub2api') {
  const cacheDigest = digest(repository === 'cc_gateway' ? 'f' : '0')
  return derivePhase1ExternalDependencyBinding({
    algorithm: 'phase1_external_dependency_content_v1',
    repository,
    preparation: 'npm_ci_offline_authenticated_cache_and_go_mod_verify_v2',
    node_binary_digest: digest(repository === 'cc_gateway' ? '1' : '2'),
    npm_binary_digest: digest(repository === 'cc_gateway' ? '3' : '4'),
    go_binary_digest: digest(repository === 'cc_gateway' ? '5' : '6'),
    npm_cache_preparation: {
      policy: 'os_account_cow_cache_v1', source_before_digest: cacheDigest, source_after_digest: cacheDigest,
      command_before_digest: cacheDigest, command_after_digest: cacheDigest,
      entry_count: 4, regular_file_count: 1, regular_file_bytes: 24, install_result_digest: digest('e'),
    },
    node_dependency_manifests: [{
      repository_relative_root: repository === 'cc_gateway' ? '.' : 'frontend',
      package_json_digest: digest('7'), package_lock_digest: digest('8'),
      entry_count: 3, content_digest: digest('9'),
    }],
    go_module_manifests: [{
      repository_relative_root: repository === 'cc_gateway' ? 'sidecar/egress-tls-sidecar' : 'backend',
      go_mod_digest: digest('a'), go_sum_digest: digest('b'), module_count: 2,
      module_manifest_digest: digest('c'), module_content_digest: digest('d'),
      go_mod_verify_digest: digest('e'),
    }],
  })
}

function dependencySet() {
  return { cc_gateway: dependencyBinding('cc_gateway'), sub2api: dependencyBinding('sub2api') }
}

test('external dependency bindings are closed, signed, and reject rehashed field drift', () => {
  const dependencies = dependencySet()
  assert.deepEqual(validatePhase1ExternalDependencySet(dependencies), { ok: true, errors: [] })
  for (const mutate of [
    (value: any) => { delete value.cc_gateway.node_binary_digest },
    (value: any) => { value.cc_gateway.extra = true },
    (value: any) => { value.cc_gateway.node_dependency_manifests[0].repository_relative_root = 'frontend' },
    (value: any) => { value.sub2api.go_module_manifests[0].repository_relative_root = 'sidecar/egress-tls-sidecar' },
    (value: any) => { value.sub2api.preparation = 'npm_install' },
    (value: any) => { value.cc_gateway.npm_cache_preparation.command_after_digest = digest('a') },
    (value: any) => { value.cc_gateway.npm_cache_preparation.extra = true },
  ]) {
    const changed: any = structuredClone(dependencies)
    mutate(changed)
    for (const binding of Object.values(changed) as any[]) {
      if (binding && typeof binding === 'object') {
        const unsigned = Object.fromEntries(Object.entries(binding).filter(([key]) => key !== 'binding_digest'))
        binding.binding_digest = sha256(canonicalJson(unsigned))
      }
    }
    assert.equal(validatePhase1ExternalDependencySet(changed).ok, false)
  }
})

function dependencyPreparationFixture() {
  const base = mkdtempSync(path.join(os.tmpdir(), 'phase1-dependencies-'))
  const cc = path.join(base, 'cc'); const sub = path.join(base, 'sub'); const moduleCache = path.join(base, 'gomodcache')
  const npmCache = path.join(base, 'account-npm', '_cacache')
  for (const directory of [cc, path.join(sub, 'frontend'), path.join(cc, 'sidecar/egress-tls-sidecar'), path.join(sub, 'backend'), moduleCache, path.join(npmCache, 'content-v2/sha512/aa')]) mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(npmCache, 'content-v2/sha512/aa/seed'), 'authenticated cache seed\n')
  for (const directory of [cc, path.join(sub, 'frontend')]) {
    writeFileSync(path.join(directory, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n')
    writeFileSync(path.join(directory, 'package-lock.json'), '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"packages":{}}\n')
  }
  for (const directory of [path.join(cc, 'sidecar/egress-tls-sidecar'), path.join(sub, 'backend')]) {
    writeFileSync(path.join(directory, 'go.mod'), 'module example.invalid/fixture\n\ngo 1.24\n')
    writeFileSync(path.join(directory, 'go.sum'), '')
  }
  const calls: Array<{ argv: string[]; cwd: string; env: Record<string, string> }> = []
  const runner = (options: any) => {
    calls.push({ argv: options.argv, cwd: options.cwd, env: options.env })
    if (options.argv.includes('ci')) {
      const modules = path.join(options.cwd, 'node_modules')
      mkdirSync(path.join(modules, 'pkg'), { recursive: true })
      writeFileSync(path.join(modules, 'pkg/index.js'), 'export default 1\n')
    }
    return { exitCode: 0, signal: null, durationMs: 1, stdoutDigest: digest('1'), stderrDigest: digest('2'), outputBytes: 0, outputExcerpt: '', outputOverflow: false, timedOut: false, failureNames: [], infrastructureFailure: false, unsafeOutputDetected: false }
  }
  return { base, cc, sub, moduleCache, npmCache: realpathSync(npmCache), calls, runner }
}

test('dependency preparation runs exact offline installs and Go verification before deriving live bindings', () => {
  const fixture = dependencyPreparationFixture()
  const prepared = preparePhase1ExternalDependencies({
    ccGatewayRoot: fixture.cc, sub2apiRoot: fixture.sub,
    sandbox: { adapter: 'macos_sandbox_exec_loopback_v1', executable: '/usr/bin/sandbox-exec', executable_digest: digest('3'), profile_path: '/tmp/profile', profile_digest: digest('4') },
    runner: fixture.runner as never,
    npmCacheSourceRoot: fixture.npmCache,
    npmCacheExpectedUID: typeof process.getuid === 'function' ? process.getuid() : 0,
  } as never)
  assert.deepEqual(validatePhase1ExternalDependencySet(prepared.dependencies), { ok: true, errors: [] })
  const persisted = canonicalJson(prepared.dependencies)
  assert.doesNotMatch(persisted, /(?:\/private)?\/tmp\/oracle-lab-phase1-npm-cache-/)
  assert.equal(persisted.includes(os.homedir()), false)
  assert.equal(fixture.calls.length, 4)
  const npmCalls = fixture.calls.slice(0, 2)
  assert.deepEqual(npmCalls.map((call) => call.argv.slice(-5, -1)), [
    ['ci', '--offline', '--ignore-scripts', '--cache'],
    ['ci', '--offline', '--ignore-scripts', '--cache'],
  ])
  assert.equal(new Set(npmCalls.map((call) => call.argv.at(-1))).size, 2)
  for (const call of npmCalls) {
    assert.equal(call.env.npm_config_cache, call.argv.at(-1))
    assert.notEqual(call.env.npm_config_cache, '/tmp/.npm')
    assert.match(call.env.npm_config_cache, /^\/(?:private\/)?tmp\/oracle-lab-phase1-npm-cache-/)
  }
  assert.deepEqual(fixture.calls.slice(2).map((call) => call.argv.slice(-2)), [
    ['mod', 'verify'],
    ['mod', 'verify'],
  ])
  const preexisting = path.join(fixture.cc, 'node_modules/preexisting-marker')
  writeFileSync(preexisting, 'must not authorize reuse\n')
  const rebuilt = preparePhase1ExternalDependencies({
    ccGatewayRoot: fixture.cc, sub2apiRoot: fixture.sub,
    sandbox: { adapter: 'macos_sandbox_exec_loopback_v1', executable: '/usr/bin/sandbox-exec', executable_digest: digest('3'), profile_path: '/tmp/profile', profile_digest: digest('4') },
    runner: fixture.runner as never,
    npmCacheSourceRoot: fixture.npmCache,
    npmCacheExpectedUID: typeof process.getuid === 'function' ? process.getuid() : 0,
  } as never)
  assert.deepEqual(validatePhase1ExternalDependencySet(rebuilt.dependencies), { ok: true, errors: [] })
  assert.equal(fixture.calls.filter((call) => call.argv.includes('ci') && call.argv.includes('--cache')).length, 4)
})

test('npm cache preparation rejects unsafe roots, races, install misses, and command-cache drift', () => {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0
  const invoke = (fixture: ReturnType<typeof dependencyPreparationFixture>, runner = fixture.runner) => preparePhase1ExternalDependencies({
    ccGatewayRoot: fixture.cc, sub2apiRoot: fixture.sub,
    sandbox: { adapter: 'macos_sandbox_exec_loopback_v1', executable: '/usr/bin/sandbox-exec', executable_digest: digest('3'), profile_path: '/tmp/profile', profile_digest: digest('4') },
    runner: runner as never, npmCacheSourceRoot: fixture.npmCache, npmCacheExpectedUID: uid,
  } as never)
  const rejected = (run: () => unknown) => assert.throws(run, (error: unknown) =>
    error instanceof Error && (error as Error & { code?: string }).code === 'external_dependency_drift')

  const writable = dependencyPreparationFixture()
  chmodSync(writable.npmCache, 0o777)
  rejected(() => invoke(writable))

  const symlink = dependencyPreparationFixture()
  symlinkSync('/tmp', path.join(symlink.npmCache, 'unsafe-link'))
  rejected(() => invoke(symlink))

  const special = dependencyPreparationFixture()
  execFileSync('/usr/bin/mkfifo', [path.join(special.npmCache, 'unsafe-fifo')])
  rejected(() => invoke(special))

  const sourceRace = dependencyPreparationFixture()
  rejected(() => invoke(sourceRace, ((options: any) => {
    if (options.argv.includes('ci')) writeFileSync(path.join(sourceRace.npmCache, 'source-race'), 'changed\n')
    return sourceRace.runner(options)
  }) as never))

  const commandDrift = dependencyPreparationFixture()
  rejected(() => invoke(commandDrift, ((options: any) => {
    if (options.argv.includes('ci')) writeFileSync(path.join(String(options.env.npm_config_cache), '_cacache', 'command-drift'), 'changed\n')
    return commandDrift.runner(options)
  }) as never))

  const cacheMiss = dependencyPreparationFixture()
  rejected(() => invoke(cacheMiss, ((options: any) => options.argv.includes('ci')
    ? { exitCode: 1, signal: null, durationMs: 1, stdoutDigest: digest('1'), stderrDigest: digest('2'), outputBytes: 0, outputExcerpt: 'ENOTCACHED', outputOverflow: false, timedOut: false, failureNames: [], infrastructureFailure: false, unsafeOutputDetected: false }
    : cacheMiss.runner(options)) as never))
})

test('Go module cache authority is the OS account cache with closed metadata', () => {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0
  assert.doesNotThrow(() => validatePhase1GoModuleCacheMetadata({ is_directory: true, is_symlink: false, uid, mode: 0o755 }, uid))
  for (const metadata of [
    { is_directory: false, is_symlink: false, uid, mode: 0o644 },
    { is_directory: true, is_symlink: true, uid, mode: 0o755 },
    { is_directory: true, is_symlink: false, uid: uid + 1, mode: 0o755 },
    { is_directory: true, is_symlink: false, uid, mode: 0o777 },
  ]) assert.throws(() => validatePhase1GoModuleCacheMetadata(metadata, uid), (error: unknown) =>
    error instanceof Error && (error as Error & { code?: string }).code === 'external_dependency_drift')
  const forged = mkdtempSync(path.join(os.tmpdir(), 'phase1-forged-gomodcache-'))
  assert.throws(() => validatePhase1GoModuleCacheRoot(forged), (error: unknown) =>
    error instanceof Error && (error as Error & { code?: string }).code === 'external_dependency_drift')
})

test('Go module list parser closes concatenated JSON and rejects malformed streams', () => {
  assert.deepEqual(parsePhase1GoModuleList('{"Path":"a","Dir":"/tmp/a"}\n{"Path":"b","Version":"v1.0.0","Dir":"/tmp/b"}\n').map((value) => value.Path), ['a', 'b'])
  for (const raw of ['', '{"Path":"a"', '{not-json}', '[{"Path":"a"}]']) {
    assert.throws(() => parsePhase1GoModuleList(raw), (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === 'external_dependency_drift')
  }
  assert.equal(selectPhase1GoModuleContentDirectory({ Path: 'unused', Version: 'v1.0.0' }), null)
  assert.equal(selectPhase1GoModuleContentDirectory({ Path: 'selected', Dir: '/cache/selected' }), '/cache/selected')
  assert.throws(() => selectPhase1GoModuleContentDirectory({ Path: 'replaced', Replace: { Path: 'local' } }),
    (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === 'external_dependency_drift')
})

async function validResultsFixture() {
  const catalog = await readJson(catalogPath) as Array<Record<string, unknown>>
  const externalDependencies = dependencySet()
  const records = catalog.map((command, index) => {
    const redNames = index === 15 ? [...CC_RED_FAILURE_NAMES] : index === 16 ? [...SIDECAR_RED_FAILURE_NAMES] : []
    const canonical = canonicalizePhase1FailureEvents(redNames)
    return signed({
      command_id: command.id,
      repository: command.repository,
      repository_commit: index < 7 || index === 14 ? commit('b') : commit('a'),
      exit_code: index < 15 ? 0 : 1,
      status: index < 15 ? 'pass' : 'expected_fail',
      stdout_digest: digest('1'), stderr_digest: digest('2'),
      failure_parser: command.failure_parser,
      parser_lifecycle: command.expected_parser_lifecycle,
      ...canonical,
      sandbox_policy_digest: digest('3'),
      network_policy_violations: 0,
      unsafe_output_detected: false,
      ignored_state_transitions: {
        controller: transition('cc_gateway', 'controller_alias_cc_gateway_v1'),
        cc_gateway: transition('cc_gateway', (command.ignored_output_policies as Record<string, string>).cc_gateway),
        sub2api: transition('sub2api', (command.ignored_output_policies as Record<string, string>).sub2api),
      },
      external_dependency_transition: {
        before: externalDependencies,
        after: externalDependencies,
        ephemeral_build_cache_token: 'command_scoped_empty_mkdtemp_v1',
      },
    }, 'result_digest')
  })
  const base = {
    schema_version: 1,
    artifact_kind: 'phase_1_command_results',
    stage: 'feature-candidate',
    generated_at: '2026-07-17T00:00:00.000Z',
    captured_at: '2026-07-17T00:00:01.000Z',
    catalog: { path: 'docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json', digest: 'sha256:0f4528cc2ca311a587a6dbe2eb5a17d5eb82679adf489e80a7b93285576a4777' },
    baseline: { path: 'docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-baseline.json', digest: digest('4') },
    authority: { path: 'docs/superpowers/evidence/phase-1/phase-1-execution-context-0002.json', digest: digest('5'), sequence: 2, stage: 'feature_capture', artifact_commit: commit('a') },
    roots: {
      controller: { stage: 'feature-candidate', head: commit('a'), root_identity_digest: digest('6'), same_as_tested_cc_root: true, preexisting_delta_paths: [], declared_output_paths: ['docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-baseline.json', 'docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-command-results.json'] },
      cc_gateway: { head: commit('a'), root_identity_digest: digest('6'), clean_status_digest: sha256('') },
      sub2api: { head: commit('b'), root_identity_digest: digest('7'), clean_status_digest: sha256('') },
    },
    sub2api_contract_root: { repository: 'sub2api', clone_kind: 'independent_clone', branch: 'main', head: commit('c'), origin_url_digest: digest('8'), root_identity_digest: digest('9'), clean_status_digest: sha256(''), contract_relative_path: 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json', contract_digest: 'sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1' },
    implementation_trees: {
      cc_gateway: { algorithm: 'git_ls_tree_v1_sha256_canonical_json', repository: 'cc_gateway', source_commit: commit('a'), exclusion_policy: 'phase1_evidence_governance_only_v1', excluded_prefixes: ['docs/superpowers/evidence/phase-1/'], excluded_paths: ['docs/superpowers/registry/oracle-lab-requirements.json', 'docs/superpowers/registry/oracle-lab-claims.json', 'docs/superpowers/registry/oracle-lab-current-observations.json'], entry_count: 1, entries_digest: digest('a') },
      sub2api: { algorithm: 'git_ls_tree_v1_sha256_canonical_json', repository: 'sub2api', source_commit: commit('b'), exclusion_policy: 'phase1_evidence_governance_only_v1', excluded_prefixes: [], excluded_paths: [], entry_count: 1, entries_digest: digest('b') },
    },
    ignored_state: { controller: ignored('cc_gateway'), cc_gateway: ignored('cc_gateway'), sub2api: ignored('sub2api') },
    external_dependencies: externalDependencies,
    sandbox: { adapter: 'macos_sandbox_exec_loopback_v1', executable_digest: digest('c'), policy_digest: digest('3'), loopback_ipv4: 'pass', loopback_ipv6: 'pass', non_loopback: 'denied_by_policy', policy_bypass_detected: false },
    disabled_capabilities: ['real_upstream_access', 'real_credentials', 'provider_internal_authority', 'profile_promotion', 'production_deployment', 'real_canary', 'direct_egress_trust', 'unverified_pinned_wire_claims', 'unsupported_negative_capabilities', 'expired_or_missing_negative_capabilities', 'unrestricted_capture', 'external_network_requests'],
    command_results: records,
    ignored_state_chain: { initial: { controller: ignored('cc_gateway'), cc_gateway: ignored('cc_gateway'), sub2api: ignored('sub2api') }, final: { controller: ignored('cc_gateway'), cc_gateway: ignored('cc_gateway'), sub2api: ignored('sub2api') }, transition_count: 17, transitions_digest: sha256(canonicalJson(records.map((record) => record.ignored_state_transitions))) },
    external_dependency_chain: {
      initial: externalDependencies,
      final: externalDependencies,
      transition_count: 17,
      transitions_digest: sha256(canonicalJson(records.map((record) => record.external_dependency_transition))),
    },
  }
  return { catalog, results: signed(base, 'results_digest') }
}

test('external dependency transition chain and evidence reference reject rehashed drift', async () => {
  const { results } = await validResultsFixture()
  assert.deepEqual(validatePhase1ExternalDependencyChain(results), { ok: true, errors: [] })
  const reference = derivePhase1ExternalDependencyReference(
    'docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-command-results.json',
    results,
  )
  assert.deepEqual(validatePhase1ExternalDependencyReference(reference, results), { ok: true, errors: [] })
  for (const mutate of [
    (value: any) => { delete value.command_results[0].external_dependency_transition },
    (value: any) => { value.command_results[0].external_dependency_transition.extra = true },
    (value: any) => { value.command_results[0].external_dependency_transition.ephemeral_build_cache_token = '/tmp/caller-selected' },
    (value: any) => {
      const binding = value.command_results[0].external_dependency_transition.before.cc_gateway
      binding.npm_cache_preparation.command_after_digest = digest('a')
      binding.binding_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(binding).filter(([key]) => key !== 'binding_digest'))))
    },
    (value: any) => { value.command_results[1].external_dependency_transition.before = structuredClone(dependencySet()); value.command_results[1].external_dependency_transition.before.cc_gateway.node_binary_digest = digest('f') },
    (value: any) => { value.external_dependency_chain.transition_count = 16 },
    (value: any) => { value.external_dependency_chain.transitions_digest = digest('f') },
  ]) {
    const changed: any = structuredClone(results)
    mutate(changed)
    for (const record of changed.command_results) {
      const unsigned = Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'result_digest'))
      record.result_digest = sha256(canonicalJson(unsigned))
    }
    changed.results_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(changed).filter(([key]) => key !== 'results_digest'))))
    assert.equal(validatePhase1ExternalDependencyChain(changed).ok, false)
    const forgedReference: any = derivePhase1ExternalDependencyReference(
      'docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-command-results.json',
      results,
    )
    forgedReference.results_digest = changed.results_digest
    forgedReference.chain_digest = changed.external_dependency_chain?.transitions_digest ?? forgedReference.chain_digest
    forgedReference.final = changed.external_dependency_chain?.final ?? forgedReference.final
    assert.equal(validatePhase1ExternalDependencyReference(forgedReference, changed).ok, false)
  }
})

test('actual downstream value validators independently reject rehashed dependency references', async () => {
  const { results: featureResults } = await validResultsFixture()
  const featureResultsPath = 'docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-command-results.json'
  const postResults: any = structuredClone(featureResults)
  postResults.stage = 'post-integration'
  postResults.results_digest = sha256(canonicalJson(Object.fromEntries(
    Object.entries(postResults).filter(([key]) => key !== 'results_digest'),
  )))
  const postResultsPath = 'docs/superpowers/evidence/phase-1/attempt-0001/phase-1-command-results.json'
  const entry = signed({
    entry_kind: 'phase_1_integration_entry',
    external_dependency_reference: derivePhase1ExternalDependencyReference(featureResultsPath, featureResults),
  }, 'entry_digest')
  const handoff = signed({
    handoff_kind: 'phase_1_handoff',
    external_dependency_reference: derivePhase1ExternalDependencyReference(postResultsPath, postResults),
    next_phase_gates: [...PHASE2_ENTRY_CONDITIONS],
  }, 'handoff_digest')
  const receipt = signed({
    receipt_kind: 'phase_1_integration_receipt',
    external_dependency_reference: derivePhase1ExternalDependencyReference(postResultsPath, postResults),
    historical_valid_at: {
      source_generated_at: '2026-07-17T00:00:00.000Z',
      validated_at: '2026-07-17T00:00:01.000Z',
      source_expires_at: '2026-07-18T00:00:00.000Z',
    },
    next_phase_gates: [...PHASE2_ENTRY_CONDITIONS],
  }, 'receipt_digest')

  assert.deepEqual(validatePhase1IntegrationEntryValue(entry, { featureResults }), { ok: true, errors: [] })
  assert.deepEqual(validatePhase1HandoffValue(handoff, { results: postResults }), { ok: true, errors: [] })
  assert.deepEqual(validatePhase1IntegrationReceiptValue(receipt, { results: postResults }), { ok: true, errors: [] })

  for (const [name, value, digestField, validate] of [
    ['entry', entry, 'entry_digest', (candidate: unknown) => validatePhase1IntegrationEntryValue(candidate, { featureResults })],
    ['handoff', handoff, 'handoff_digest', (candidate: unknown) => validatePhase1HandoffValue(candidate, { results: postResults })],
    ['receipt', receipt, 'receipt_digest', (candidate: unknown) => validatePhase1IntegrationReceiptValue(candidate, { results: postResults })],
  ] as const) {
    const changed: any = structuredClone(value)
    changed.external_dependency_reference.chain_digest = digest('f')
    changed[digestField] = sha256(canonicalJson(Object.fromEntries(
      Object.entries(changed).filter(([key]) => key !== digestField),
    )))
    const validation = validate(changed)
    assert.equal(validation.ok, false, name)
    assert.equal(validation.errors.some((error) => error.code === 'external_dependency_drift'), true, name)
  }
})

test('results validation rejects rehashed RED semantic drift and accepts only raw-order canonical output', async () => {
  const { catalog, results } = await validResultsFixture()
  assert.deepEqual(validatePhase1ResultsValue(results, { catalog }), { ok: true, errors: [] })
  for (const mutate of [
    (value: any) => { value.command_results[15].failure_event_names.shift(); value.command_results[15].failure_event_count -= 1 },
    (value: any) => { value.command_results[15].failure_event_names.reverse() },
    (value: any) => { value.command_results[16].observed_failure_families = ['TestPhase0B5'] },
    (value: any) => { value.command_results[16].parser_lifecycle.packages[1].run_test_count = 63 },
  ]) {
    const changed: any = structuredClone(results)
    mutate(changed)
    changed.command_results[15].result_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(changed.command_results[15]).filter(([key]) => key !== 'result_digest'))))
    changed.command_results[16].result_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(changed.command_results[16]).filter(([key]) => key !== 'result_digest'))))
    changed.results_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(changed).filter(([key]) => key !== 'results_digest'))))
    assert.equal(validatePhase1ResultsValue(changed, { catalog }).ok, false)
  }
})

test('loaded results authority re-derives baseline, roots, contract, trees, ignored state, and dependencies', async () => {
  const { catalog, results } = await validResultsFixture()
  const baselineBase: any = Object.fromEntries(Object.entries(results).filter(([key]) =>
    !['baseline', 'command_results', 'ignored_state_chain', 'external_dependency_chain', 'results_digest'].includes(key)))
  baselineBase.artifact_kind = 'phase_1_exit_baseline'
  const baseline = signed(baselineBase, 'baseline_digest')
  results.baseline.digest = sha256(Buffer.from(`${canonicalJson(baseline)}\n`))
  results.results_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(results).filter(([key]) => key !== 'results_digest'))))
  const observed = {
    stage: 'feature-candidate' as const, catalog, baseline, results,
    authority: results.authority, roots: results.roots, contract: results.sub2api_contract_root,
    implementationTrees: results.implementation_trees,
    ignoredFinal: results.ignored_state_chain.final,
    externalDependencies: results.external_dependency_chain.final,
    controllerEqualsCC: true,
    outputPaths: { baseline: String(results.baseline.path), results: 'docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-command-results.json' },
    liveStatuses: {
      controller: [`?? ${String(results.baseline.path)}`, '?? docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-command-results.json'],
      cc_gateway: [`?? ${String(results.baseline.path)}`, '?? docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-command-results.json'],
      sub2api: [],
    },
  }
  assert.deepEqual(validatePhase1LoadedResultsAuthority(observed), { ok: true, errors: [] })
  for (const field of ['authority', 'roots', 'contract', 'implementationTrees', 'ignoredFinal', 'externalDependencies'] as const) {
    const changed: any = structuredClone(observed)
    changed[field] = { forged: true }
    assert.equal(validatePhase1LoadedResultsAuthority(changed).ok, false, field)
  }
  for (const liveStatuses of [
    { ...observed.liveStatuses, controller: [...observed.liveStatuses.controller, '?? stray.txt'], cc_gateway: [...observed.liveStatuses.cc_gateway, '?? stray.txt'] },
    { ...observed.liveStatuses, sub2api: ['?? backend/stray.txt'] },
  ]) assert.equal(validatePhase1LoadedResultsAuthority({ ...observed, liveStatuses }).ok, false)

  const integrationEntryPath = 'docs/superpowers/evidence/phase-1/attempt-0001/phase-1-integration-entry.json'
  const postBaselinePath = 'docs/superpowers/evidence/phase-1/attempt-0001/phase-1-exit-baseline.json'
  const postResultsPath = 'docs/superpowers/evidence/phase-1/attempt-0001/phase-1-command-results.json'
  const postResults: any = structuredClone(results)
  postResults.stage = 'post-integration'
  postResults.authority = { path: integrationEntryPath, digest: digest('f'), sequence: 1, stage: 'post_integration', artifact_commit: commit('f') }
  postResults.roots.controller = { stage: 'post-integration', head: commit('f'), root_identity_digest: digest('f'), same_as_tested_cc_root: false, preexisting_delta_paths: [integrationEntryPath], declared_output_paths: [postBaselinePath, postResultsPath] }
  postResults.baseline.path = postBaselinePath
  const postBaselineBase: any = Object.fromEntries(Object.entries(postResults).filter(([key]) =>
    !['baseline', 'command_results', 'ignored_state_chain', 'external_dependency_chain', 'results_digest'].includes(key)))
  postBaselineBase.artifact_kind = 'phase_1_exit_baseline'
  const postBaseline = signed(postBaselineBase, 'baseline_digest')
  postResults.baseline.digest = sha256(Buffer.from(`${canonicalJson(postBaseline)}\n`))
  postResults.results_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(postResults).filter(([key]) => key !== 'results_digest'))))
  const postObserved = {
    ...observed, stage: 'post-integration' as const, baseline: postBaseline, results: postResults,
    authority: postResults.authority, roots: postResults.roots, controllerEqualsCC: false,
    outputPaths: { integrationEntry: integrationEntryPath, baseline: postBaselinePath, results: postResultsPath },
    liveStatuses: { controller: [`?? ${integrationEntryPath}`, `?? ${postBaselinePath}`, `?? ${postResultsPath}`], cc_gateway: [], sub2api: [] },
  }
  assert.deepEqual(validatePhase1LoadedResultsAuthority(postObserved), { ok: true, errors: [] })
  assert.equal(validatePhase1LoadedResultsAuthority({ ...postObserved, liveStatuses: { ...postObserved.liveStatuses, controller: [...postObserved.liveStatuses.controller, '?? stray.txt'] } }).ok, false)
})

test('capture root envelope rejects dirty, aliased, or wrong-delta roots before spawn', () => {
  const valid = { stage: 'post-integration', controllerStatus: ['?? docs/superpowers/evidence/phase-1/attempt-0001/phase-1-integration-entry.json'], ccGatewayStatus: [], sub2apiStatus: [], controllerEqualsCCTestedRoot: false, entryPath: 'docs/superpowers/evidence/phase-1/attempt-0001/phase-1-integration-entry.json' }
  assert.doesNotThrow(() => validatePhase1CaptureInputs(valid))
  for (const changed of [
    { ...valid, controllerStatus: ['?? unrelated.txt'] },
    { ...valid, ccGatewayStatus: [' M src/proxy.ts'] },
    { ...valid, sub2apiStatus: ['?? stray.txt'] },
    { ...valid, controllerEqualsCCTestedRoot: true },
  ]) assert.throws(() => validatePhase1CaptureInputs(changed))
})

test('post-integration capture authority derives tested heads from remote_mains', () => {
  const integrationEntry = {
    repositories: {
      cc_gateway: { integrated_head: commit('9') },
      sub2api: { integrated_head: commit('8'), remote_url_digest: digest('7') },
    },
    remote_mains: {
      cc_gateway: { integrated_head: commit('a') },
      sub2api: { integrated_head: commit('b'), origin_url_digest: digest('c') },
    },
  }
  assert.deepEqual(derivePhase1StageAuthorityHeads(integrationEntry, 'post-integration'), {
    expectedSub: commit('b'),
    contractHead: commit('b'),
    contractOriginDigest: digest('c'),
    integratedCC: commit('a'),
  })
  assert.throws(() => derivePhase1StageAuthorityHeads({ repositories: integrationEntry.repositories }, 'post-integration'))
})

test('feature review, evidence commit, review attestation, and merge topology are closed', () => {
  const evidenceCommit = { tested_head: commit('a'), candidate_head: commit('b'), parents: [commit('a')], added_paths: ['docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-baseline.json', 'docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-command-results.json'], bytes_match: true, sub2api_tested_head: commit('c'), sub2api_candidate_head: commit('c') }
  assert.doesNotThrow(() => validatePhase1FeatureEvidenceCommit(evidenceCommit))
  assert.throws(() => validatePhase1FeatureEvidenceCommit({ ...evidenceCommit, added_paths: [...evidenceCommit.added_paths, 'extra'] }))
  const review = signed({ schema_version: 1, review_kind: 'phase_1_feature_review', generated_at: '2026-07-17T00:00:00.000Z', reviewer_identity: 'independent-reviewer', decision: 'approved', finding_counts: { critical: 0, important: 0, minor: 0 }, tested_heads: { cc_gateway: commit('a'), sub2api: commit('c') }, candidate_heads: { cc_gateway: commit('b'), sub2api: commit('c') }, implementation_trees: { tested_cc_gateway: { entries_digest: digest('a') }, tested_sub2api: { entries_digest: digest('b') }, candidate_cc_gateway: { entries_digest: digest('a') }, candidate_sub2api: { entries_digest: digest('b') } }, feature_baseline: { path: 'docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-baseline.json', digest: digest('1') }, feature_results: { path: 'docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-command-results.json', digest: digest('2') }, context: { path: 'docs/superpowers/evidence/phase-1/phase-1-execution-context-0002.json', digest: digest('3'), sequence: 2, stage: 'feature_capture', artifact_commit: commit('a') }, plan_review: { path: 'docs/superpowers/evidence/phase-1/phase-1-plan-review.json', digest: digest('4') }, external_dependency_reference: { results_path: 'docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-command-results.json', results_digest: digest('2'), chain_digest: digest('5'), final: dependencySet() }, review_scope: ['goal', 'authority', 'ordering', 'sandbox', 'leakage'] }, 'review_digest')
  assert.equal(validatePhase1FeatureReviewValue(review).ok, true)
  assert.equal(validatePhase1FeatureReviewValue({ ...review, decision: 'changes_requested' }).ok, false)
  const attestation = { candidate_head: commit('b'), attestation_head: commit('d'), parents: [commit('b')], added_paths: ['docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-review.json'], bytes_match: true, path_unchanged_after: true }
  assert.doesNotThrow(() => validatePhase1FeatureReviewAttestation(attestation))
  assert.throws(() => validatePhase1FeatureReviewAttestation({ ...attestation, path_unchanged_after: false }))
  const topology = { cc: { pre_merge_main: commit('1'), candidate: commit('d'), merge: commit('2'), parents: [commit('1'), commit('d')], ancestor_of_remote: true }, sub2api: { pre_merge_main: commit('3'), candidate: commit('c'), merge: commit('4'), parents: [commit('3'), commit('c')], ancestor_of_remote: true } }
  assert.doesNotThrow(() => validatePhase1MergeTopology(topology))
  assert.throws(() => validatePhase1MergeTopology({ ...topology, cc: { ...topology.cc, parents: [commit('1')] } }))
})

test('loaded feature review closes baseline, results, context, plan review, dependency reference, and evidence topology', async () => {
  const { catalog, results } = await validResultsFixture()
  const planReviewSchemaPath = path.join(root, 'docs/superpowers/schemas/oracle-lab-phase-1-plan-review.schema.json')
  const planReviewSchema = await readJson(planReviewSchemaPath)
  const planReviewSchemaBinding = { path: 'docs/superpowers/schemas/oracle-lab-phase-1-plan-review.schema.json', digest: sha256(await readFile(planReviewSchemaPath)) }
  const executionContextSchemaPath = path.join(root, 'docs/superpowers/schemas/oracle-lab-phase-1-execution-context.schema.json')
  const executionContextSchema = await readJson(executionContextSchemaPath)
  const executionContextSchemaBinding = { path: 'docs/superpowers/schemas/oracle-lab-phase-1-execution-context.schema.json', digest: sha256(await readFile(executionContextSchemaPath)) }
  const planReview = {
    schema_version: 1, review_kind: 'phase_1_plan_review', generated_at: '2026-07-17T00:00:00.000Z',
    plan: { path: 'docs/superpowers/plans/2026-07-15-claude-code-2.1.207-phase-1-control-plane-boundary-repairs.md', digest: digest('a'), reviewed_commit: commit('d') },
    reviewer_id: 'independent-reviewer', review_round: 1, decision: 'approved', finding_counts: { critical: 0, important: 0, minor: 0 },
    review_scope: ['requirements_and_roadmap_coverage', 'current_code_anchor_realism', 'dependency_and_side_effect_ordering', 'fail_closed_security_boundaries', 'harness_and_evidence_bindings', 'commands_tests_and_rollback'],
  }
  const planReviewBinding = { path: 'docs/superpowers/evidence/phase-1/phase-1-plan-review.json', digest: sha256(Buffer.from(`${canonicalJson(planReview)}\n`)) }
  const planningEntryBinding = { path: 'docs/superpowers/evidence/phase-1/phase-1-entry-baseline.json', digest: digest('b') }
  const planningContextBinding = { path: 'docs/superpowers/evidence/phase-1/phase-1-context.json', digest: digest('c') }
  const initialContext: any = await readJson(path.join(root, 'docs/superpowers/evidence/phase-1/phase-1-execution-context.json'))
  const context: any = {
    ...initialContext, context_mode: 'successor', sequence: 2, stage: 'feature_capture',
    artifact_path: String(results.authority.path),
    predecessor: { path: 'docs/superpowers/evidence/phase-1/phase-1-execution-context-0001.json', digest: digest('d'), sequence: 1, stage: 'implementation', artifact_commit: commit('e') },
    plan: planReview.plan,
    planning_provenance: { entry: { ...planningEntryBinding }, context: { ...planningContextBinding } },
    approval_receipt: { artifact: planReviewBinding, decision: 'approved', reviewer_id: planReview.reviewer_id, review_round: planReview.review_round, reviewed_plan_commit: planReview.plan.reviewed_commit, reviewed_plan_digest: planReview.plan.digest, critical_findings: 0, important_findings: 0 },
    gate_schemas: { execution_context: { ...executionContextSchemaBinding }, plan_review: { ...planReviewSchemaBinding } },
  }
  const contextBinding = { path: String(results.authority.path), digest: sha256(Buffer.from(`${canonicalJson(context)}\n`)) }
  results.authority = { ...results.authority, digest: contextBinding.digest }
  const baselineBase: any = Object.fromEntries(Object.entries(results).filter(([key]) =>
    !['baseline', 'command_results', 'ignored_state_chain', 'external_dependency_chain', 'results_digest'].includes(key)))
  baselineBase.artifact_kind = 'phase_1_exit_baseline'
  const featureBaseline = signed(baselineBase, 'baseline_digest')
  const featureBaselineBinding = { path: results.baseline.path, digest: sha256(Buffer.from(`${canonicalJson(featureBaseline)}\n`)) }
  results.baseline = featureBaselineBinding
  results.results_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(results).filter(([key]) => key !== 'results_digest'))))
  const featureResultsBinding = { path: 'docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-command-results.json', digest: sha256(Buffer.from(`${canonicalJson(results)}\n`)) }
  const reviewBase: any = {
    schema_version: 1, review_kind: 'phase_1_feature_review', generated_at: '2026-07-17T00:00:02.000Z',
    reviewer_identity: 'independent-reviewer', decision: 'approved', finding_counts: { critical: 0, important: 0, minor: 0 },
    tested_heads: { cc_gateway: commit('a'), sub2api: commit('b') }, candidate_heads: { cc_gateway: commit('c'), sub2api: commit('b') },
    implementation_trees: { tested_cc_gateway: results.implementation_trees.cc_gateway, tested_sub2api: results.implementation_trees.sub2api, candidate_cc_gateway: results.implementation_trees.cc_gateway, candidate_sub2api: results.implementation_trees.sub2api },
    feature_baseline: featureBaselineBinding, feature_results: featureResultsBinding,
    context: results.authority, plan_review: planReviewBinding,
    external_dependency_reference: derivePhase1ExternalDependencyReference(featureResultsBinding.path, results),
    review_scope: ['goal', 'authority', 'ordering', 'sandbox', 'leakage'],
  }
  const featureReview = signed(reviewBase, 'review_digest')
  const evidenceCommit = { tested_head: commit('a'), candidate_head: commit('c'), parents: [commit('a')], added_paths: [featureBaselineBinding.path, featureResultsBinding.path], bytes_match: true, sub2api_tested_head: commit('b'), sub2api_candidate_head: commit('b') }
  const valid = {
    catalog, featureBaseline, featureResults: results, context, planReview, planReviewSchema, executionContextSchema,
    featureReview, featureReviewPath: 'docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-review.json',
    reviewMode: 'uncommitted' as const,
    liveStatuses: { cc_gateway: ['?? docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-review.json'], sub2api: [] },
    bindings: { featureBaseline: featureBaselineBinding, featureResults: featureResultsBinding, context: contextBinding, planReview: planReviewBinding, planReviewSchema: planReviewSchemaBinding, executionContextSchema: executionContextSchemaBinding, planningEntry: planningEntryBinding, planningContext: planningContextBinding }, evidenceCommit,
  }
  assert.deepEqual(validatePhase1LoadedFeatureReview(valid), { ok: true, errors: [] })
  assert.deepEqual(validatePhase1LoadedFeatureReview({ ...valid, reviewMode: 'committed', liveStatuses: { cc_gateway: [], sub2api: [] } }), { ok: true, errors: [] })
  for (const [name, mutate] of [
    ['baseline', (value: any) => { value.featureBaseline.baseline_digest = digest('f') }],
    ['plan decision', (value: any) => { value.planReview.decision = 'changes_requested' }],
    ['schema binding', (value: any) => { value.context.gate_schemas.plan_review.digest = digest('f') }],
    ['execution schema required authority', (value: any) => {
      delete value.context.repositories
      value.bindings.context.digest = sha256(Buffer.from(`${canonicalJson(value.context)}\n`))
      value.featureResults.authority.digest = value.bindings.context.digest
      value.featureResults.results_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(value.featureResults).filter(([key]) => key !== 'results_digest'))))
      value.bindings.featureResults.digest = sha256(Buffer.from(`${canonicalJson(value.featureResults)}\n`))
      value.featureReview.context = value.featureResults.authority
      value.featureReview.feature_results = value.bindings.featureResults
      value.featureReview.external_dependency_reference = derivePhase1ExternalDependencyReference(value.bindings.featureResults.path, value.featureResults)
      value.featureReview.review_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(value.featureReview).filter(([key]) => key !== 'review_digest'))))
    }],
    ['approval identity', (value: any) => { value.context.approval_receipt.reviewer_id = 'alternate-approved-reviewer' }],
    ['CC dirt', (value: any) => { value.liveStatuses.cc_gateway.push(' M src/proxy.ts') }],
    ['Sub2API dirt', (value: any) => { value.liveStatuses.sub2api.push('?? backend/stray.txt') }],
    ['context path', (value: any) => { value.context.artifact_path = 'wrong.json' }],
    ['evidence bytes', (value: any) => { value.evidenceCommit.bytes_match = false }],
    ['dependency reference', (value: any) => { value.featureReview.external_dependency_reference.chain_digest = digest('f'); value.featureReview.review_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(value.featureReview).filter(([key]) => key !== 'review_digest')))) }],
  ] as const) {
    const changed = structuredClone(valid); mutate(changed)
    const validation = validatePhase1LoadedFeatureReview(changed)
    assert.equal(validation.ok, false, name)
    if (name === 'execution schema required authority') assert.equal(validation.errors.some((error) => error.code === 'context_schema_invalid'), true)
  }
})

test('attempt chain, retries, and final remote decisions are closed', () => {
  assert.doesNotThrow(() => validatePhase1AttemptChain({ committed: [], requested: 'attempt-0001', predecessor: null }))
  const prior = { attempt_id: 'attempt-0001', path: 'docs/superpowers/evidence/phase-1/attempt-0001/phase-1-integration-receipt.json', digest: digest('1'), receipt_commit: commit('1'), introduced_once: true, present_unchanged: true, ancestor: true, child_topology_valid: true }
  const successor = { committed: [prior], requested: 'attempt-0002', predecessor: { attempt_id: 'attempt-0001', receipt: { path: prior.path, digest: prior.digest }, receipt_commit: prior.receipt_commit } }
  assert.doesNotThrow(() => validatePhase1AttemptChain(successor))
  assert.throws(() => validatePhase1AttemptChain({ ...successor, requested: 'attempt-0003' }))
  const retry = authorizePhase1Retry({ kind: 'evidence_only_pre_merge', latest_attempt_id: 'attempt-0001', latest_draft_run_id: 'run-0001', predecessor: successor.predecessor, immutable_paths: ['evidence.json'], root_identity_digest: digest('2'), next_root_identity_digest: digest('3') })
  assert.equal(retry.attempt_id, 'attempt-0002')
  assert.equal(retry.draft_run_id, 'run-0002')
  assert.throws(() => authorizePhase1Retry({ kind: 'implementation_tree_drift' }))
  assert.equal(verifyPhase1FinalRemote({ decision: 'ready', safe: true, ignored_state_stable: true }).decision, 'ready')
  assert.throws(() => verifyPhase1FinalRemote({ decision: 'ready', safe: false, error_code: 'phase1_implementation_drift' }))
})

test('downstream builders and validators reject a rehashed RED source mutation', async () => {
  const { catalog, results } = await validResultsFixture()
  const source = { catalog, results }
  const entry = buildPhase1IntegrationEntry({ source, payload: { attempt_id: 'attempt-0001' } })
  assert.equal(validatePhase1IntegrationEntryValue(entry, { source }).ok, true)
  const handoff = buildPhase1Handoff({ source, payload: { attempt_id: 'attempt-0001' } })
  assert.equal(validatePhase1HandoffValue(handoff, { source }).ok, true)
  const receipt = buildPhase1IntegrationReceipt({ source, payload: { attempt_id: 'attempt-0001' } })
  assert.equal(validatePhase1IntegrationReceiptValue(receipt, { source }).ok, true)
  const changed: any = structuredClone(results)
  changed.command_results[15].failure_event_names.shift()
  changed.command_results[15].failure_event_count -= 1
  changed.command_results[15].result_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(changed.command_results[15]).filter(([key]) => key !== 'result_digest'))))
  changed.results_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(changed).filter(([key]) => key !== 'results_digest'))))
  for (const invoke of [
    () => buildPhase1IntegrationEntry({ source: { catalog, results: changed }, payload: {} }),
    () => buildPhase1Handoff({ source: { catalog, results: changed }, payload: {} }),
    () => buildPhase1IntegrationReceipt({ source: { catalog, results: changed }, payload: {} }),
  ]) assert.throws(invoke, (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === 'red_evidence_mismatch')

  const cacheChanged: any = structuredClone(results)
  const binding = cacheChanged.command_results[0].external_dependency_transition.before.cc_gateway
  binding.npm_cache_preparation.command_after_digest = digest('a')
  binding.binding_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(binding).filter(([key]) => key !== 'binding_digest'))))
  cacheChanged.command_results[0].result_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(cacheChanged.command_results[0]).filter(([key]) => key !== 'result_digest'))))
  cacheChanged.external_dependency_chain.transitions_digest = sha256(canonicalJson(cacheChanged.command_results.map((record: any) => record.external_dependency_transition)))
  cacheChanged.results_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(cacheChanged).filter(([key]) => key !== 'results_digest'))))
  for (const [name, invoke] of [
    ['entry', () => buildPhase1IntegrationEntry({ source: { catalog, results: cacheChanged }, payload: {} })],
    ['handoff', () => buildPhase1Handoff({ source: { catalog, results: cacheChanged }, payload: {} })],
    ['receipt', () => buildPhase1IntegrationReceipt({ source: { catalog, results: cacheChanged }, payload: {} })],
  ] as const) assert.throws(invoke, (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === 'external_dependency_drift', name)
})

test('committed artifact chain reload rejects source, reference, and receipt binding drift after rehash', async () => {
  const { catalog, results: featureResults } = await validResultsFixture()
  const artifact = (pathName: string, value: unknown) => ({ path: pathName, digest: sha256(Buffer.from(`${canonicalJson(value)}\n`)) })
  const featureResultsPath = 'docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-command-results.json'
  const featureReviewBase: any = {
    schema_version: 1, review_kind: 'phase_1_feature_review', generated_at: '2026-07-17T00:00:02.000Z', reviewer_identity: 'reviewer', decision: 'approved', finding_counts: { critical: 0, important: 0, minor: 0 },
    tested_heads: { cc_gateway: commit('a'), sub2api: commit('b') }, candidate_heads: { cc_gateway: commit('c'), sub2api: commit('b') },
    implementation_trees: { tested_cc_gateway: featureResults.implementation_trees.cc_gateway, tested_sub2api: featureResults.implementation_trees.sub2api, candidate_cc_gateway: featureResults.implementation_trees.cc_gateway, candidate_sub2api: featureResults.implementation_trees.sub2api },
    feature_baseline: { path: 'docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-baseline.json', digest: digest('1') },
    feature_results: artifact(featureResultsPath, featureResults), context: featureResults.authority,
    plan_review: { path: 'docs/superpowers/evidence/phase-1/phase-1-plan-review.json', digest: digest('2') },
    external_dependency_reference: derivePhase1ExternalDependencyReference(featureResultsPath, featureResults), review_scope: ['goal', 'authority', 'ordering', 'sandbox', 'leakage'],
  }
  const featureReview = signed(featureReviewBase, 'review_digest')
  const featureReviewBinding = artifact('docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-review.json', featureReview)
  const ignoredReference = { results_path: featureResultsPath, results_digest: featureResults.results_digest, chain_digest: featureResults.ignored_state_chain.transitions_digest, final: featureResults.ignored_state_chain.final }
  const sharedContract = { repository: 'sub2api', path: featureResults.sub2api_contract_root.contract_relative_path, digest: featureResults.sub2api_contract_root.contract_digest }
  const entryBase: any = {
    entry_kind: 'phase_1_integration_entry', feature_results: featureReviewBase.feature_results,
    feature_review: featureReviewBinding, external_dependency_reference: featureReviewBase.external_dependency_reference,
    remote_mains: { cc_gateway: { integrated_head: commit('a') }, sub2api: { integrated_head: commit('b') } },
    implementation_trees: featureResults.implementation_trees, ignored_state_reference: ignoredReference,
    shared_contract: sharedContract, disabled_capabilities: featureResults.disabled_capabilities,
  }
  const entry = signed(entryBase, 'entry_digest')
  const postResults: any = structuredClone(featureResults)
  postResults.stage = 'post-integration'
  postResults.baseline.path = 'docs/superpowers/evidence/phase-1/attempt-0001/phase-1-exit-baseline.json'
  postResults.results_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(postResults).filter(([key]) => key !== 'results_digest'))))
  const baselineBase: any = Object.fromEntries(Object.entries(postResults).filter(([key]) => !['baseline', 'command_results', 'ignored_state_chain', 'external_dependency_chain', 'results_digest'].includes(key)))
  baselineBase.artifact_kind = 'phase_1_exit_baseline'
  const baseline = signed(baselineBase, 'baseline_digest')
  postResults.baseline.digest = artifact(postResults.baseline.path, baseline).digest
  postResults.results_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(postResults).filter(([key]) => key !== 'results_digest'))))
  const bindings: any = {
    featureResults: artifact(featureResultsPath, featureResults), featureReview: featureReviewBinding,
    entry: artifact('docs/superpowers/evidence/phase-1/attempt-0001/phase-1-integration-entry.json', entry),
    baseline: artifact(postResults.baseline.path, baseline),
    results: artifact('docs/superpowers/evidence/phase-1/attempt-0001/phase-1-command-results.json', postResults),
  }
  const postIgnoredReference = { results_digest: postResults.results_digest, chain_digest: postResults.ignored_state_chain.transitions_digest, final: postResults.ignored_state_chain.final }
  const handoff = signed({ handoff_kind: 'phase_1_handoff', integration_entry: bindings.entry, baseline: bindings.baseline, results: bindings.results, external_dependency_reference: derivePhase1ExternalDependencyReference(bindings.results.path, postResults), implementation_trees: postResults.implementation_trees, ignored_state_reference: postIgnoredReference, shared_contract: sharedContract, disabled_capabilities: postResults.disabled_capabilities }, 'handoff_digest')
  bindings.handoff = artifact('docs/superpowers/evidence/phase-1/attempt-0001/phase-1-handoff.json', handoff)
  const receipt = signed({ receipt_kind: 'phase_1_integration_receipt', artifacts: { integration_entry: bindings.entry, baseline: bindings.baseline, results: bindings.results, handoff: bindings.handoff }, external_dependency_reference: derivePhase1ExternalDependencyReference(bindings.results.path, postResults), integrated_heads: { cc_gateway: commit('a'), sub2api: commit('b') }, implementation_trees: postResults.implementation_trees, ignored_state_reference: postIgnoredReference, shared_contract: sharedContract, disabled_capabilities: postResults.disabled_capabilities }, 'receipt_digest')
  const valid = { catalog, featureResults, featureReview, entry, baseline, results: postResults, handoff, receipt, bindings }
  assert.deepEqual(validatePhase1CommittedArtifactChain(valid), { ok: true, errors: [] })
  for (const mutate of [
    (value: any) => { value.receipt.artifacts.results.digest = digest('f') },
    (value: any) => { value.handoff.results.path = 'docs/superpowers/evidence/phase-1/attempt-0002/phase-1-command-results.json' },
    (value: any) => { value.entry.external_dependency_reference.chain_digest = digest('f') },
    (value: any) => { value.receipt.integrated_heads.cc_gateway = commit('f') },
    (value: any) => { value.receipt.implementation_trees.cc_gateway.entries_digest = digest('f') },
    (value: any) => { delete value.bindings.featureReview },
  ]) {
    const changed: any = structuredClone(valid); mutate(changed)
    for (const [value, field] of [[changed.entry, 'entry_digest'], [changed.handoff, 'handoff_digest'], [changed.receipt, 'receipt_digest']] as const) value[field] = sha256(canonicalJson(Object.fromEntries(Object.entries(value).filter(([key]) => key !== field))))
    assert.equal(validatePhase1CommittedArtifactChain(changed).ok, false)
  }
})

test('all Phase 1 schemas compile and representative catalog/results validate', async () => {
  const schemaNames = [
    'oracle-lab-phase-1-command-catalog.schema.json',
    'oracle-lab-phase-1-exit.schema.json',
    'oracle-lab-phase-1-results.schema.json',
    'oracle-lab-phase-1-feature-review.schema.json',
    'oracle-lab-phase-1-handoff.schema.json',
    'oracle-lab-phase-1-integration-entry.schema.json',
    'oracle-lab-phase-1-integration-receipt.schema.json',
  ]
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false })
  const validators = new Map<string, ReturnType<typeof ajv.compile>>()
  for (const name of schemaNames) {
    const schema = await readJson(path.join(root, 'docs/superpowers/schemas', name))
    validators.set(name, ajv.compile(schema))
  }
  const catalog = await readJson(catalogPath)
  assert.equal(validators.get(schemaNames[0])!(catalog), true)
  const { results } = await validResultsFixture()
  assert.equal(validators.get('oracle-lab-phase-1-results.schema.json')!(results), true,
    JSON.stringify(validators.get('oracle-lab-phase-1-results.schema.json')!.errors))
})

test('verify-final-remote CLI requires every explicit authority flag and rejects fallback', () => {
  const valid = [
    'verify-final-remote',
    '--catalog', 'docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json',
    '--cc-gateway-root', '/tmp/cc', '--sub2api-root', '/tmp/sub',
    '--attempt-id', 'attempt-0001',
    '--receipt', 'docs/superpowers/evidence/phase-1/attempt-0001/phase-1-integration-receipt.json',
    '--receipt-commit', commit('a'), '--cc-remote', 'muqihang',
    '--cc-remote-ref', 'refs/remotes/muqihang/main', '--cc-origin-digest', digest('1'),
    '--sub2api-remote', 'muqihang', '--sub2api-remote-ref', 'refs/remotes/muqihang/main',
    '--sub2api-origin-digest', digest('2'),
  ]
  assert.equal(parsePhase1CLI(valid).command, 'verify-final-remote')
  for (const flag of ['--catalog', '--cc-gateway-root', '--receipt', '--receipt-commit', '--cc-origin-digest']) {
    const index = valid.indexOf(flag)
    assert.throws(() => parsePhase1CLI([...valid.slice(0, index), ...valid.slice(index + 2)]))
  }
  assert.throws(() => parsePhase1CLI([...valid, '--receipt', valid[valid.indexOf('--receipt') + 1]]))
  assert.throws(() => parsePhase1CLI([...valid, '--unknown', 'value']))
})

test('representative actual authority artifacts satisfy their closed schemas', async () => {
  const { catalog, results: featureResults } = await validResultsFixture()
  const results: any = structuredClone(featureResults)
  results.stage = 'post-integration'
  results.baseline.path = 'docs/superpowers/evidence/phase-1/attempt-0001/phase-1-exit-baseline.json'
  results.roots.controller = { stage: 'post-integration', head: commit('a'), root_identity_digest: digest('6'), same_as_tested_cc_root: false, preexisting_delta_paths: ['docs/superpowers/evidence/phase-1/attempt-0001/phase-1-integration-entry.json'], declared_output_paths: ['docs/superpowers/evidence/phase-1/attempt-0001/phase-1-exit-baseline.json', 'docs/superpowers/evidence/phase-1/attempt-0001/phase-1-command-results.json'] }
  results.results_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(results).filter(([key]) => key !== 'results_digest'))))
  const baselineBase: any = Object.fromEntries(Object.entries(results).filter(([key]) => !['baseline', 'command_results', 'ignored_state_chain', 'results_digest'].includes(key)))
  baselineBase.artifact_kind = 'phase_1_exit_baseline'
  let baseline = { ...baselineBase, baseline_digest: sha256(canonicalJson(baselineBase)) }
  const attempt = { attempt_id: 'attempt-0001', sequence: 1, predecessor: null }
  const entryBase: any = {
    schema_version: 1, entry_kind: 'phase_1_integration_entry', generated_at: '2026-07-17T00:00:00.000Z', expires_at: '2026-07-18T00:00:00.000Z', attempt,
    catalog: results.catalog, context: results.authority,
    plan_review: { path: 'docs/superpowers/evidence/phase-1/phase-1-plan-review.json', digest: digest('1') },
    feature_results: { path: 'docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-command-results.json', digest: digest('2') },
    feature_review: { path: 'docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-review.json', digest: digest('3') },
    review_attestation_head: commit('d'), candidate_heads: { cc_gateway: commit('a'), sub2api: commit('b') },
    merge_topology: {
      cc: { pre_merge_main: commit('1'), candidate: commit('d'), merge: commit('a'), parents: [commit('1'), commit('d')], ancestor_of_remote: true },
      sub2api: { pre_merge_main: commit('2'), candidate: commit('b'), merge: commit('b'), parents: [commit('2'), commit('b')], ancestor_of_remote: true },
    },
    remote_mains: {
      cc_gateway: { name: 'muqihang', ref: 'refs/remotes/muqihang/main', integrated_head: commit('a'), origin_url_digest: digest('a') },
      sub2api: { name: 'muqihang', ref: 'refs/remotes/muqihang/main', integrated_head: commit('b'), origin_url_digest: digest('b') },
    },
    roots: results.roots, sub2api_contract_root: results.sub2api_contract_root,
    implementation_trees: results.implementation_trees,
    ignored_state_reference: { results_path: 'docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-command-results.json', results_digest: digest('2'), chain_digest: digest('4'), final: results.ignored_state_chain.final },
    external_dependency_reference: derivePhase1ExternalDependencyReference('docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-command-results.json', featureResults),
    sandbox_policy_digest: digest('3'),
    shared_contract: { repository: 'sub2api', path: 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json', digest: 'sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1' },
    disabled_capabilities: results.disabled_capabilities,
  }
  const entry = { ...entryBase, entry_digest: sha256(canonicalJson(entryBase)) }
  results.authority = {
    path: 'docs/superpowers/evidence/phase-1/attempt-0001/phase-1-integration-entry.json',
    digest: sha256(Buffer.from(`${canonicalJson(entry)}\n`)),
    sequence: 1,
    stage: 'post_integration',
    artifact_commit: commit('a'),
  }
  results.results_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(results).filter(([key]) => key !== 'results_digest'))))
  const rebuiltBaselineBase: any = Object.fromEntries(Object.entries(results).filter(([key]) => !['baseline', 'command_results', 'ignored_state_chain', 'external_dependency_chain', 'results_digest'].includes(key)))
  rebuiltBaselineBase.artifact_kind = 'phase_1_exit_baseline'
  baseline = { ...rebuiltBaselineBase, baseline_digest: sha256(canonicalJson(rebuiltBaselineBase)) }
  results.baseline.digest = sha256(Buffer.from(`${canonicalJson(baseline)}\n`))
  results.results_digest = sha256(canonicalJson(Object.fromEntries(Object.entries(results).filter(([key]) => key !== 'results_digest'))))
  const handoff = buildPhase1Handoff({ actual: true, controllerRoot: root, catalog, entry, baseline, results, registries: { requirements: { path: 'docs/superpowers/registry/oracle-lab-requirements.json', digest: digest('5') }, claims: { path: 'docs/superpowers/registry/oracle-lab-claims.json', digest: digest('6') }, observations: { path: 'docs/superpowers/registry/oracle-lab-current-observations.json', digest: digest('7') } }, generatedAt: '2026-07-17T00:00:02.000Z' })
  const receipt = buildPhase1IntegrationReceipt({ actual: true, catalog, artifactCommit: commit('e'), entry, baseline, results, handoff, report: { path: 'docs/superpowers/evidence/phase-1/attempt-0001/phase-1-exit-report.md', digest: digest('8') }, registries: { requirements: { path: 'docs/superpowers/registry/oracle-lab-requirements.json', digest: digest('5') }, claims: { path: 'docs/superpowers/registry/oracle-lab-claims.json', digest: digest('6') }, observations: { path: 'docs/superpowers/registry/oracle-lab-current-observations.json', digest: digest('7') } }, generatedAt: '2026-07-17T00:00:03.000Z' })
  const reviewBase: any = { schema_version: 1, review_kind: 'phase_1_feature_review', generated_at: '2026-07-17T00:00:00.000Z', reviewer_identity: 'independent-reviewer', decision: 'approved', finding_counts: { critical: 0, important: 0, minor: 0 }, tested_heads: { cc_gateway: commit('a'), sub2api: commit('b') }, candidate_heads: { cc_gateway: commit('a'), sub2api: commit('b') }, implementation_trees: { tested_cc_gateway: results.implementation_trees.cc_gateway, tested_sub2api: results.implementation_trees.sub2api, candidate_cc_gateway: results.implementation_trees.cc_gateway, candidate_sub2api: results.implementation_trees.sub2api }, feature_baseline: { path: 'docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-baseline.json', digest: digest('9') }, feature_results: { path: 'docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-command-results.json', digest: digest('2') }, context: results.authority, plan_review: { path: 'docs/superpowers/evidence/phase-1/phase-1-plan-review.json', digest: digest('1') }, external_dependency_reference: derivePhase1ExternalDependencyReference('docs/superpowers/evidence/phase-1/feature-0001/phase-1-feature-command-results.json', featureResults), review_scope: ['goal', 'authority', 'ordering', 'sandbox', 'leakage'] }
  const review = { ...reviewBase, review_digest: sha256(canonicalJson(reviewBase)) }
  const values: Array<[string, unknown]> = [
    ['oracle-lab-phase-1-exit.schema.json', baseline],
    ['oracle-lab-phase-1-results.schema.json', results],
    ['oracle-lab-phase-1-feature-review.schema.json', review],
    ['oracle-lab-phase-1-integration-entry.schema.json', entry],
    ['oracle-lab-phase-1-handoff.schema.json', handoff],
    ['oracle-lab-phase-1-integration-receipt.schema.json', receipt],
  ]
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false })
  for (const [name, value] of values) {
    const validate = ajv.compile(await readJson(path.join(root, 'docs/superpowers/schemas', name)))
    assert.equal(validate(value), true, `${name}: ${JSON.stringify(validate.errors)}`)
  }
})

function contextChainFixture() {
  const immutable = {
    plan: { path: 'docs/superpowers/plans/phase-1.md', digest: digest('1'), reviewed_commit: commit('1') },
    planning_provenance: { digest: digest('2') }, approval_receipt: { decision: 'approved' },
    gate_schemas: { execution_context: { digest: digest('3') }, plan_review: { digest: digest('4') } },
    shared_contract: { digest: digest('5') }, authority_order: ['review'], selected_requirements: ['AV-B1-001'],
    implementation_entry: { allowed: true }, disabled_capabilities: ['real_canary'],
  }
  const nodes: any[] = []
  for (const [sequence, stage] of ['implementation_entry', 'implementation', 'feature_capture'].entries()) {
    const artifactPath = sequence === 0
      ? 'docs/superpowers/evidence/phase-1/phase-1-execution-context.json'
      : `docs/superpowers/evidence/phase-1/phase-1-execution-context-${String(sequence).padStart(4, '0')}.json`
    const value: any = {
      schema_version: 2, context_mode: sequence === 0 ? 'initial' : 'successor', sequence, stage,
      artifact_path: artifactPath, generated_at: `2026-07-17T00:00:0${sequence}.000Z`, expires_at: '2026-07-17T12:00:00.000Z',
      predecessor: sequence === 0 ? null : { path: nodes[sequence - 1].path, digest: nodes[sequence - 1].digest, artifact_commit: nodes[sequence - 1].artifact_commit },
      ...structuredClone(immutable),
      repositories: {
        cc_gateway: { baseline_main_head: commit('1'), remote_name: 'muqihang', remote_url_digest: digest('6'), tracking_ref: 'refs/remotes/muqihang/main', implementation_branch: 'codex/cc', head_descends_from_predecessor: true },
        sub2api: { baseline_main_head: commit('2'), remote_name: 'muqihang', remote_url_digest: digest('7'), tracking_ref: 'refs/remotes/muqihang/main', implementation_branch: 'codex/sub', head_descends_from_predecessor: true },
      },
    }
    nodes.push({ path: artifactPath, digest: digest(String(sequence + 1)), artifact_commit: commit(String(sequence + 3)), introduced_once: true, unchanged_after: true, commit_parent_valid: true, commit_delta_valid: true, repository_heads_descend: true, value })
  }
  return nodes
}

test('execution context selects only one fresh contiguous immutable latest chain head', () => {
  const contexts = contextChainFixture()
  const selected = contexts.at(-1).path
  assert.equal(selectLatestPhase1ExecutionContext({ contexts, selectedPath: selected, expectedStage: 'feature_capture', now: '2026-07-17T01:00:00.000Z' }).path, selected)
  const mutations: Array<(value: any[]) => string> = [
    (value) => { value[2].value.predecessor.digest = digest('f'); return selected },
    (value) => { value[1].value.sequence = 2; return selected },
    (value) => { value[2].value.stage = 'implementation'; return selected },
    (value) => { value[2].value.plan.digest = digest('f'); return selected },
    (value) => { value[2].introduced_once = false; return selected },
    () => contexts[1].path,
  ]
  for (const mutate of mutations) {
    const changed = structuredClone(contexts)
    const selectedPath = mutate(changed)
    assert.throws(() => selectLatestPhase1ExecutionContext({ contexts: changed, selectedPath, expectedStage: 'feature_capture', now: '2026-07-17T01:00:00.000Z' }))
  }
  assert.throws(() => selectLatestPhase1ExecutionContext({ contexts, selectedPath: selected, expectedStage: 'feature_capture', now: '2026-07-18T01:00:00.000Z' }))
})

function git(rootPath: string, ...argv: string[]): string {
  return execFileSync('/usr/bin/git', argv, { cwd: rootPath, encoding: 'utf8' }).trim()
}

function receiptHistoryRepository(firstAttempt = 'attempt-0001'): string {
  const repository = mkdtempSync(path.join(os.tmpdir(), 'phase1-receipt-history-'))
  git(repository, 'init', '-q')
  git(repository, 'config', 'user.name', 'Phase1 Test')
  git(repository, 'config', 'user.email', 'phase1@example.invalid')
  writeFileSync(path.join(repository, 'base.txt'), 'base\n')
  git(repository, 'add', 'base.txt'); git(repository, 'commit', '-q', '-m', 'base')
  const artifact = git(repository, 'rev-parse', 'HEAD')
  const receiptDirectory = path.join(repository, 'docs/superpowers/evidence/phase-1', firstAttempt)
  mkdirSync(receiptDirectory, { recursive: true })
  writeFileSync(path.join(receiptDirectory, 'phase-1-integration-receipt.json'), `${JSON.stringify({ attempt: { attempt_id: firstAttempt }, artifact_commit: artifact })}\n`)
  git(repository, 'add', '.'); git(repository, 'commit', '-q', '-m', `receipt ${firstAttempt}`)
  return repository
}

test('reachable Git history selects one immutable contiguous receipt chain', () => {
  const repository = receiptHistoryRepository()
  let history = inspectPhase1ReceiptHistory(repository)
  assert.deepEqual(history.map((node) => node.attempt_id), ['attempt-0001'])
  writeFileSync(path.join(repository, 'artifact-2.txt'), 'artifact\n')
  git(repository, 'add', 'artifact-2.txt'); git(repository, 'commit', '-q', '-m', 'artifact 2')
  const artifact = git(repository, 'rev-parse', 'HEAD')
  const directory = path.join(repository, 'docs/superpowers/evidence/phase-1/attempt-0002')
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, 'phase-1-integration-receipt.json'), `${JSON.stringify({ attempt: { attempt_id: 'attempt-0002' }, artifact_commit: artifact })}\n`)
  git(repository, 'add', '.'); git(repository, 'commit', '-q', '-m', 'receipt 2')
  history = inspectPhase1ReceiptHistory(repository)
  assert.deepEqual(history.map((node) => node.attempt_id), ['attempt-0001', 'attempt-0002'])

  const gapRepository = receiptHistoryRepository('attempt-0002')
  assert.throws(() => inspectPhase1ReceiptHistory(gapRepository), (error: unknown) =>
    error instanceof Error && (error as Error & { code?: string }).code === 'attempt_chain_invalid')
})
