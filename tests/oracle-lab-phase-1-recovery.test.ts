import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  derivePhase1BaselineEnvelope,
  derivePhase1RunLease,
  derivePhase1TerminalRecord,
  digestDeliveryValue,
  parsePhase1RecoveryContract,
} from '../tools/oracle-lab/delivery-authority.js'
import {
  PHASE1_RECOVERY_BINDINGS,
  parsePhase1RecoveryCli,
  runPhase1RecoveryPreReplay,
  validatePhase1RecoveryInputs,
  validatePhase1RecoveryOutputs,
  validatePhase1RecoveryReplayMapping,
  validatePhase1RecoveryT2Record,
  type Phase1RecoveryDependencies,
} from '../tools/oracle-lab/phase-1-recovery.js'

type Value = Record<string, any>

const root = path.resolve(new URL('..', import.meta.url).pathname)
const planPath = path.join(root, PHASE1_RECOVERY_BINDINGS.plan_path)
const planBytes = readFileSync(planPath)

function clone<T>(value: T): T { return structuredClone(value) }

function sha256(value: Buffer | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function git(repository: string, ...args: string[]): string {
  return execFileSync('/usr/bin/git', args, {
    cwd: repository,
    encoding: 'utf8',
    env: {
      HOME: '/dev/null', PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_COUNT: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0',
    },
  }).trim()
}

function initRepository(repository: string, remoteUrl: string): string {
  mkdirSync(repository, { recursive: true, mode: 0o700 })
  git(repository, 'init', '-q', '--initial-branch=main')
  git(repository, 'config', 'user.email', 'oracle@example.invalid')
  git(repository, 'config', 'user.name', 'Oracle Test')
  writeFileSync(path.join(repository, 'baseline.txt'), 'baseline\n')
  git(repository, 'add', 'baseline.txt')
  git(repository, 'commit', '-qm', 'baseline')
  git(repository, 'remote', 'add', 'muqihang', remoteUrl)
  const head = git(repository, 'rev-parse', 'HEAD')
  git(repository, 'update-ref', 'refs/remotes/muqihang/main', head)
  return head
}

function inputFixture() {
  const parent = mkdtempSync(path.join(tmpdir(), 'oracle-phase1-recovery-input-'))
  const ccRoot = path.join(parent, 'cc-main')
  const subRoot = path.join(parent, 'sub-main')
  const ccSource = path.join(parent, 'cc-source')
  const subSource = path.join(parent, 'sub-source')
  const ccUrl = 'https://example.invalid/cc.git'
  const subUrl = 'https://example.invalid/sub.git'
  initRepository(ccRoot, ccUrl)
  initRepository(subRoot, subUrl)
  const ccSourceHead = initRepository(ccSource, ccUrl)
  const subSourceHead = initRepository(subSource, subUrl)
  const ccBundle = path.join(parent, 'cc.bundle')
  const subBundle = path.join(parent, 'sub.bundle')
  git(ccSource, 'bundle', 'create', ccBundle, '--all')
  git(subSource, 'bundle', 'create', subBundle, '--all')
  const bindings = clone(PHASE1_RECOVERY_BINDINGS) as Value
  bindings.cc_gateway.remote_url_digest = sha256(ccUrl)
  bindings.cc_gateway.source_head = ccSourceHead
  bindings.cc_gateway.source_commits = [ccSourceHead]
  bindings.cc_gateway.skipped_source_commits = []
  bindings.cc_gateway.bundle_digest = sha256(readFileSync(ccBundle))
  bindings.sub2api.remote_url_digest = sha256(subUrl)
  bindings.sub2api.source_head = subSourceHead
  bindings.sub2api.source_commits = [subSourceHead]
  bindings.sub2api.skipped_source_commits = []
  bindings.sub2api.bundle_digest = sha256(readFileSync(subBundle))
  const input = {
    command: 'pre-replay-red' as const,
    cc_root: ccRoot,
    sub2api_root: subRoot,
    cc_bundle: ccBundle,
    sub2api_bundle: subBundle,
    output_root: path.join(parent, 'output'),
  }
  return { parent, input, bindings, ccBundle }
}

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.equal((error as { code?: string }).code, code)
    return true
  })
}

function context(sequence: number, state: string): Value {
  const generated = new Date(Date.parse('2026-07-18T18:00:00Z') + sequence * 60_000).toISOString()
  return {
    schema_version: 2,
    context_kind: 'phase_1_recovery_context',
    context_mode: sequence === 0 ? 'initial' : 'successor',
    sequence,
    stage: sequence === 0 ? 'implementation_entry' : 'implementation',
    artifact_path: sequence === 0
      ? 'docs/superpowers/evidence/phase-1/phase-1-execution-context.json'
      : `docs/superpowers/evidence/phase-1/phase-1-execution-context-${String(sequence).padStart(4, '0')}.json`,
    predecessor: sequence === 0 ? null : { sequence: sequence - 1, digest: `sha256:${'1'.repeat(64)}` },
    generated_at: generated,
    expires_at: new Date(Date.parse(generated) + 4 * 60 * 60 * 1000).toISOString(),
    plan: { path: PHASE1_RECOVERY_BINDINGS.plan_path, digest: `sha256:${'2'.repeat(64)}`, reviewed_commit: '2'.repeat(40) },
    approval_receipt: { decision: 'approved', reviewed_plan_digest: `sha256:${'2'.repeat(64)}`, critical_findings: 0, important_findings: 0 },
    gate_schemas: { execution_context: { path: 'context.schema.json', digest: `sha256:${'3'.repeat(64)}` } },
    recovery_authority: { contract_digest: PHASE1_RECOVERY_BINDINGS.contract_digest },
    repositories: {
      cc_gateway: {
        baseline_main_head: '4'.repeat(40), authorized_parent_head: '4'.repeat(40), observed_remote_main_head: '4'.repeat(40),
        remote_name: 'muqihang', remote_url_digest: PHASE1_RECOVERY_BINDINGS.cc_gateway.remote_url_digest,
        tracking_ref: 'refs/remotes/muqihang/main', implementation_branch: PHASE1_RECOVERY_BINDINGS.cc_gateway.recovery_branch,
        pre_issue_clean: true, validation_status: { entries: [], digest: `sha256:${'5'.repeat(64)}` },
      },
      sub2api: {
        baseline_main_head: '6'.repeat(40), authorized_parent_head: '6'.repeat(40), observed_remote_main_head: '6'.repeat(40),
        remote_name: 'muqihang', remote_url_digest: PHASE1_RECOVERY_BINDINGS.sub2api.remote_url_digest,
        tracking_ref: 'refs/remotes/muqihang/main', implementation_branch: PHASE1_RECOVERY_BINDINGS.sub2api.recovery_branch,
        pre_issue_clean: true, validation_status: { entries: [], digest: `sha256:${'7'.repeat(64)}` },
      },
    },
    shared_contract: { repository: 'sub2api', path: 'vectors.json', digest: PHASE1_RECOVERY_BINDINGS.shared_contract_digest },
    authority_order: [{ path: 'authority.md', digest: `sha256:${'8'.repeat(64)}` }],
    selected_requirements: ['AV-B1-001', 'AV-B2-001', 'AV-B3-001', 'RA-P0-008'],
    implementation_entry: { status: 'authorized', conditions: ['closed'] },
    disabled_capabilities: ['production_deployment', 'real_canary', 'external_network_requests'],
    recovery_state: state,
  }
}

function mappingFixture(): Value {
  return {
    schema_version: 1,
    record_kind: 'phase_1_recovery_replay_mapping',
    status: 'equivalent',
    cc_gateway: {
      source_commits: [...PHASE1_RECOVERY_BINDINGS.cc_gateway.source_commits],
      replacement_commits: PHASE1_RECOVERY_BINDINGS.cc_gateway.source_commits.map((_, index) => '12345678'[index].repeat(40)),
      skipped_source_commits: [...PHASE1_RECOVERY_BINDINGS.cc_gateway.skipped_source_commits],
      protected_path_intersection_count: 0,
    },
    sub2api: {
      source_commits: [...PHASE1_RECOVERY_BINDINGS.sub2api.source_commits],
      replacement_commits: PHASE1_RECOVERY_BINDINGS.sub2api.source_commits.map((_, index) => 'abcdef0123'[index].repeat(40)),
      skipped_source_commits: [],
      protected_path_intersection_count: 0,
    },
  }
}

test('Recovery authority selects the exact committed contract and rejects legacy/caller drift', () => {
  const contract = parsePhase1RecoveryContract(planBytes)
  assert.equal(contract.source_digest, PHASE1_RECOVERY_BINDINGS.contract_digest)
  assert.equal(contract.rows.length, 15)
  assert.deepEqual(contract.rows.slice(0, 3).map((row) => row.id), ['P1R-01', 'P1R-02', 'P1R-03'])
  assert.equal(contract.rows.at(-1)?.to, 'exit_verified')

  const changed = planBytes.toString('utf8').replace('run-pre-replay-vertical-red', 'caller-command')
  expectCode(() => parsePhase1RecoveryContract(changed), 'delivery_transition_unknown_command')
  expectCode(() => parsePhase1RecoveryContract(Buffer.from('<!-- ORACLE_PHASE1_RECOVERY_TRANSITIONS_BEGIN -->\n```json\n[]\n```\n<!-- ORACLE_PHASE1_RECOVERY_TRANSITIONS_END -->\n')), 'delivery_transition_malformed')
})

test('Recovery CLI is closed and never accepts caller-selected commits, mappings, or authority bytes', () => {
  const argv = [
    'pre-replay-red',
    '--cc-root', '/tmp/cc-main',
    '--sub2api-root', '/tmp/sub-main',
    '--cc-bundle', '/tmp/cc.bundle',
    '--sub2api-bundle', '/tmp/sub.bundle',
    '--output-root', '/tmp/output',
  ]
  assert.deepEqual(parsePhase1RecoveryCli(argv), {
    command: 'pre-replay-red',
    cc_root: '/tmp/cc-main', sub2api_root: '/tmp/sub-main', cc_bundle: '/tmp/cc.bundle', sub2api_bundle: '/tmp/sub.bundle', output_root: '/tmp/output',
  })
  for (const injected of [
    ['--source-commit', 'f'.repeat(40)],
    ['--mapping', '/tmp/mapping.json'],
    ['--plan-review', '/tmp/old-review.json'],
    ['--restart-artifact', '/tmp/restart.json'],
    ['--contract-digest', `sha256:${'f'.repeat(64)}`],
  ]) expectCode(() => parsePhase1RecoveryCli([...argv, ...injected]), 'phase1_recovery_cli_invalid')
})

test('Recovery input validator authenticates real bundles and rejects root, type, output, and race mutations', () => {
  const valid = inputFixture()
  assert.doesNotThrow(() => validatePhase1RecoveryInputs(valid.input, valid.bindings as any))
  assert.equal(existsSync(path.join(valid.input.output_root, 'bundle-quarantine/cc-source.bundle')), true)
  assert.doesNotThrow(() => validatePhase1RecoveryOutputs(valid.input, valid.bindings as any))

  const dirty = inputFixture()
  writeFileSync(path.join(dirty.input.cc_root, 'untracked.txt'), 'dirty\n')
  expectCode(() => validatePhase1RecoveryInputs(dirty.input, dirty.bindings as any), 'phase1_recovery_root_invalid')

  const linked = inputFixture()
  const link = path.join(linked.parent, 'cc-link.bundle')
  symlinkSync(linked.ccBundle, link)
  expectCode(() => validatePhase1RecoveryInputs({ ...linked.input, cc_bundle: link }, linked.bindings as any), 'phase1_recovery_bundle_invalid')

  const truncated = inputFixture()
  writeFileSync(truncated.input.cc_bundle, 'not-a-bundle\n')
  expectCode(() => validatePhase1RecoveryInputs(truncated.input, truncated.bindings as any), 'phase1_recovery_bundle_invalid')

  const occupied = inputFixture()
  mkdirSync(occupied.input.output_root, { mode: 0o700 })
  expectCode(() => validatePhase1RecoveryInputs(occupied.input, occupied.bindings as any), 'phase1_recovery_output_invalid')

  const raced = inputFixture()
  let replaced = false
  expectCode(() => validatePhase1RecoveryInputs(raced.input, raced.bindings as any, {
    after_bundle_read: (bundle) => {
      if (replaced || path.basename(bundle) !== 'cc.bundle') return
      replaced = true
      const bytes = readFileSync(bundle)
      renameSync(bundle, `${bundle}.moved`)
      writeFileSync(bundle, bytes, { mode: 0o600 })
    },
  }), 'phase1_recovery_bundle_invalid')
})

test('Recovery replay mapping is exact 8x10 and rejects reorder, skip, extra, duplicate, and protected intersections', () => {
  const valid = mappingFixture()
  assert.doesNotThrow(() => validatePhase1RecoveryReplayMapping(valid))
  for (const mutate of [
    (value: Value) => { value.cc_gateway.source_commits.reverse() },
    (value: Value) => { value.cc_gateway.source_commits.pop() },
    (value: Value) => { value.sub2api.source_commits.push('f'.repeat(40)) },
    (value: Value) => { value.sub2api.replacement_commits[1] = value.sub2api.replacement_commits[0] },
    (value: Value) => { value.cc_gateway.skipped_source_commits.reverse() },
    (value: Value) => { value.cc_gateway.protected_path_intersection_count = 1 },
  ]) {
    const changed = clone(valid); mutate(changed)
    expectCode(() => validatePhase1RecoveryReplayMapping(changed), 'phase1_recovery_mapping_invalid')
  }
})

test('Recovery T2 record binds owned GREEN, exact preserved RED, clean roots, lease, and zero side effects', () => {
  const valid = {
    schema_version: 1,
    record_kind: 'phase_1_recovery_t2',
    status: 'green',
    lease_digest: `sha256:${'1'.repeat(64)}`,
    tested_heads: { cc_gateway: '2'.repeat(40), sub2api: '3'.repeat(40) },
    owned_outcomes: { b1: 'green', b2: 'green', b3: 'green', listener_tls: 'green' },
    preserved_red: { cc_event_count: 61, cc_unique_count: 61, sidecar_event_count: 51, sidecar_unique_count: 51 },
    external_side_effect_count: 0,
    unauthorized_socket_count: 0,
    repositories_clean: { cc_gateway: true, sub2api: true },
  }
  assert.doesNotThrow(() => validatePhase1RecoveryT2Record(valid))
  for (const mutate of [
    (value: Value) => { value.owned_outcomes.b2 = 'red' },
    (value: Value) => { value.preserved_red.cc_unique_count = 60 },
    (value: Value) => { value.external_side_effect_count = 1 },
    (value: Value) => { value.repositories_clean.sub2api = false },
  ]) {
    const changed = clone(valid); mutate(changed)
    expectCode(() => validatePhase1RecoveryT2Record(changed), 'phase1_recovery_t2_invalid')
  }
})

test('pre-replay transaction requires four exact real RED records plus the replay sentinel', async () => {
  const dependencies: Phase1RecoveryDependencies = {
    validate_inputs: () => undefined,
    validate_outputs: () => undefined,
    observe_baseline: () => ({ cc_gateway: '1'.repeat(40), sub2api: '2'.repeat(40) }),
    run_red: (family) => ({ family, status: 'expected_fail', leaf_names: PHASE1_RECOVERY_BINDINGS.pre_replay_red[family], classifications: PHASE1_RECOVERY_BINDINGS.pre_replay_classifications[family], external_side_effect_count: 0, unauthorized_socket_count: 0 }),
    replay_required: () => true,
    persist_record: () => undefined,
  }
  const input = parsePhase1RecoveryCli(['pre-replay-red', '--cc-root', '/tmp/cc-main', '--sub2api-root', '/tmp/sub-main', '--cc-bundle', '/tmp/cc.bundle', '--sub2api-bundle', '/tmp/sub.bundle', '--output-root', '/tmp/output'])
  const record = await runPhase1RecoveryPreReplay(input, PHASE1_RECOVERY_BINDINGS, dependencies)
  assert.equal(record.status, 'red_confirmed')
  assert.deepEqual(record.families.map((entry: Value) => entry.family), ['b1', 'b2', 'b3', 'listener_tls'])
  assert.equal(record.replay_sentinel, 'phase1_recovery_replay_required')

  const missing = { ...dependencies, run_red: (family: keyof typeof PHASE1_RECOVERY_BINDINGS.pre_replay_red) => ({ family, status: family === 'b3' ? 'pass' : 'expected_fail', leaf_names: PHASE1_RECOVERY_BINDINGS.pre_replay_red[family], classifications: PHASE1_RECOVERY_BINDINGS.pre_replay_classifications[family], external_side_effect_count: 0, unauthorized_socket_count: 0 }) }
  await assert.rejects(runPhase1RecoveryPreReplay(input, PHASE1_RECOVERY_BINDINGS, missing), (error: unknown) => (error as { code?: string }).code === 'phase1_recovery_vertical_red_mismatch')
})

test('terminal Recovery transition emits a terminal record and cannot mint a successor lease', () => {
  const contract = parsePhase1RecoveryContract(planBytes)
  const final = contract.rows.at(-1)!
  const current = context(14, final.from)
  const envelope = digestDeliveryValue(derivePhase1BaselineEnvelope(current))
  const lease = derivePhase1RunLease(current, {
    envelope_digest: envelope,
    plan_bytes: planBytes,
    transition_id: final.id,
    predecessor_lease_digest: `sha256:${'9'.repeat(64)}`,
    observed_delta_digest: null,
  })
  const observed = [{ category: 'external:add:phase1-exit-record' }]
  const terminal = derivePhase1TerminalRecord({
    lease,
    context: current,
    plan_bytes: planBytes,
    observed_delta: observed,
    completed_at: '2026-07-18T18:15:00Z',
    now: Date.parse('2026-07-18T18:15:00Z'),
  })
  assert.equal(terminal.state, 'exit_verified')
  assert.equal(terminal.transition_id, 'P1R-14')
  assert.equal(terminal.predecessor_lease_digest, digestDeliveryValue(lease))
  assert.equal(terminal.observed_delta_digest, digestDeliveryValue(observed))
})
