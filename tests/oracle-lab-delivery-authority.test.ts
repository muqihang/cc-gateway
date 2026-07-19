import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  assertPhase1BaselineEnvelopeUnchanged,
  derivePhase1BaselineEnvelope,
  derivePhase1RunLease,
  digestDeliveryValue,
  parseDeliveryTransitionContract,
  parsePhase1RecoveryContract,
  validatePhase1LeaseRefresh,
  validatePhase1LeaseSuccessor,
} from '../tools/oracle-lab/delivery-authority.js'

type Value = Record<string, any>

const root = path.resolve(new URL('..', import.meta.url).pathname)
const planPath = path.join(root, 'docs/superpowers/plans/2026-07-18-oracle-delivery-mechanism-transition.md')
const planBytes = readFileSync(planPath)
const recoveryPlanBytes = readFileSync(path.join(root, 'docs/superpowers/plans/2026-07-18-claude-code-2.1.207-phase-1-recovery.md'))

function clone<T>(value: T): T { return structuredClone(value) }

function contextFixture(sequence = 0): Value {
  const generated = new Date(Date.parse('2026-07-18T10:00:00Z') + sequence * 60_000).toISOString()
  const expires = new Date(Date.parse(generated) + 4 * 60 * 60 * 1000).toISOString()
  const context: Value = {
    schema_version: 2,
    context_kind: 'phase_1_execution_context',
    context_mode: sequence === 0 ? 'initial' : 'successor',
    sequence,
    stage: sequence === 0 ? 'implementation_entry' : 'implementation',
    artifact_path: sequence === 0
      ? 'docs/superpowers/evidence/phase-1/phase-1-execution-context.json'
      : `docs/superpowers/evidence/phase-1/phase-1-execution-context-${String(sequence).padStart(4, '0')}.json`,
    predecessor: sequence === 0 ? null : { sequence: sequence - 1, digest: `sha256:${'a'.repeat(64)}` },
    generated_at: generated,
    expires_at: expires,
    plan: { path: 'phase-1-plan.md', digest: `sha256:${'1'.repeat(64)}`, reviewed_commit: '1'.repeat(40) },
    planning_provenance: { entry: { path: 'entry.json', digest: `sha256:${'2'.repeat(64)}` } },
    approval_receipt: { decision: 'approved', reviewed_plan_digest: `sha256:${'1'.repeat(64)}`, critical_findings: 0, important_findings: 0 },
    gate_schemas: { execution_context: { path: 'context.schema.json', digest: `sha256:${'3'.repeat(64)}` } },
    repositories: {
      cc_gateway: {
        baseline_main_head: '4'.repeat(40),
        authorized_parent_head: sequence === 0 ? '4'.repeat(40) : String((sequence % 5) + 5).repeat(40),
        observed_remote_main_head: '4'.repeat(40),
        remote_name: 'muqihang',
        remote_url_digest: `sha256:${'5'.repeat(64)}`,
        tracking_ref: 'refs/remotes/muqihang/main',
        implementation_branch: 'codex/oracle-phase-1-cc-gateway-v8',
        pre_issue_clean: true,
        validation_status: { entries: [], digest: `sha256:${'6'.repeat(64)}` },
      },
      sub2api: {
        baseline_main_head: '7'.repeat(40),
        authorized_parent_head: sequence === 0 ? '7'.repeat(40) : String((sequence % 2) + 8).repeat(40),
        observed_remote_main_head: '7'.repeat(40),
        remote_name: 'muqihang',
        remote_url_digest: `sha256:${'8'.repeat(64)}`,
        tracking_ref: 'refs/remotes/muqihang/main',
        implementation_branch: 'codex/oracle-phase-1-sub2api-v8',
        pre_issue_clean: true,
        validation_status: { entries: [], digest: `sha256:${'9'.repeat(64)}` },
      },
    },
    shared_contract: { repository: 'sub2api', path: 'vectors.json', digest: `sha256:${'b'.repeat(64)}` },
    authority_order: [{ path: 'authority.md', digest: `sha256:${'c'.repeat(64)}` }],
    selected_requirements: ['AV-B1-001', 'RA-P0-008'],
    implementation_entry: { status: 'authorized', conditions: ['closed'] },
    disabled_capabilities: ['production_deployment', 'real_canary', 'external_network_requests'],
  }
  return context
}

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.equal((error as { code?: string }).code, code)
    return true
  })
}

function replaceTransitionBlock(mutator: (rows: Value[]) => Value[]): Buffer {
  const text = planBytes.toString('utf8')
  const match = text.match(/<!-- ORACLE_DELIVERY_TRANSITIONS_BEGIN -->\n```json\n([\s\S]*?)\n```\n<!-- ORACLE_DELIVERY_TRANSITIONS_END -->/)
  assert.ok(match)
  const rows = mutator(JSON.parse(match[1]))
  return Buffer.from(text.replace(match[1], JSON.stringify(rows, null, 2)))
}

test('committed delivery transition contract is exact, canonical, and unambiguous', () => {
  const contract = parseDeliveryTransitionContract(planBytes)
  assert.equal(contract.rows.length, 11)
  assert.equal(contract.source_digest, 'sha256:08952a6f2ba48b671b6f8792651040a7292e2a2a4bc8036d8d9e851dc6e46463')
  assert.deepEqual(contract.rows.slice(0, 3).map((row) => row.id), ['DM-01', 'DM-02', 'DM-03'])

  expectCode(() => parseDeliveryTransitionContract(replaceTransitionBlock((rows) => [...rows, clone(rows[0])])), 'delivery_transition_duplicate_id')
  expectCode(() => parseDeliveryTransitionContract(replaceTransitionBlock((rows) => [rows[1], rows[0], ...rows.slice(2)])), 'delivery_transition_noncanonical_order')
  expectCode(() => parseDeliveryTransitionContract(replaceTransitionBlock((rows) => rows.map((row, index) => index === 0 ? { ...row, command: 'caller-command' } : row))), 'delivery_transition_unknown_command')
  expectCode(() => parseDeliveryTransitionContract(replaceTransitionBlock((rows) => rows.map((row, index) => index === 0 ? { ...row, extra: true } : row))), 'delivery_transition_malformed')
  expectCode(() => parseDeliveryTransitionContract(replaceTransitionBlock((rows) => rows.map((row) => row.id === 'DM-06B' ? { ...row, condition: 'critical-important-zero' } : row))), 'delivery_transition_ambiguous_successor')
})

test('delivery and Recovery authority kinds remain closed and cross-contract isolated', () => {
  const delivery = parseDeliveryTransitionContract(planBytes)
  const recovery = parsePhase1RecoveryContract(recoveryPlanBytes)
  assert.equal(delivery.rows.every((row) => row.id.startsWith('DM-')), true)
  assert.equal(recovery.rows.every((row) => row.id.startsWith('P1R-')), true)
  expectCode(() => parseDeliveryTransitionContract(recoveryPlanBytes), 'delivery_transition_malformed')
  expectCode(() => parsePhase1RecoveryContract(planBytes), 'delivery_transition_malformed')
  expectCode(() => parsePhase1RecoveryContract(Buffer.from(recoveryPlanBytes.toString('utf8').replace('P1R-01', 'DM-01'))), 'delivery_transition_malformed')
})

test('baseline projection excludes mutable lease observations and rejects immutable drift', () => {
  const initial = contextFixture(0)
  const successor = contextFixture(1)
  assert.deepEqual(derivePhase1BaselineEnvelope(successor), derivePhase1BaselineEnvelope(initial))
  assert.doesNotThrow(() => assertPhase1BaselineEnvelopeUnchanged(initial, successor))

  const branchDrift = clone(successor)
  branchDrift.repositories.cc_gateway.implementation_branch = 'codex/unreviewed'
  expectCode(() => assertPhase1BaselineEnvelopeUnchanged(initial, branchDrift), 'delivery_envelope_drift')

  const authorityDrift = clone(successor)
  authorityDrift.authority_order[0].digest = `sha256:${'d'.repeat(64)}`
  expectCode(() => assertPhase1BaselineEnvelopeUnchanged(initial, authorityDrift), 'delivery_envelope_drift')
})

test('run leases form one digest chain and enforce refresh versus successor semantics', () => {
  const { rows } = parseDeliveryTransitionContract(planBytes)
  const dm01 = rows.find((row) => row.id === 'DM-01')!
  const dm02 = rows.find((row) => row.id === 'DM-02')!
  const initialContext = contextFixture(0)
  const envelopeDigest = digestDeliveryValue(derivePhase1BaselineEnvelope(initialContext))
  const initial = derivePhase1RunLease(initialContext, {
    envelope_digest: envelopeDigest,
    plan_bytes: planBytes,
    transition_id: dm01.id,
    predecessor_lease_digest: null,
    observed_delta_digest: null,
  })
  expectCode(() => derivePhase1RunLease(initialContext, {
    envelope_digest: `sha256:${'f'.repeat(64)}`,
    plan_bytes: planBytes,
    transition_id: dm01.id,
    predecessor_lease_digest: null,
    observed_delta_digest: null,
  }), 'delivery_envelope_digest_mismatch')
  expectCode(() => derivePhase1RunLease(initialContext, {
    envelope_digest: digestDeliveryValue(derivePhase1BaselineEnvelope(initialContext)),
    plan_bytes: recoveryPlanBytes,
    transition_id: 'P1R-01',
    predecessor_lease_digest: null,
    observed_delta_digest: null,
  }), 'delivery_context_authority_mismatch')

  const refreshContext = contextFixture(1)
  refreshContext.repositories.cc_gateway.authorized_parent_head = initialContext.repositories.cc_gateway.authorized_parent_head
  refreshContext.repositories.sub2api.authorized_parent_head = initialContext.repositories.sub2api.authorized_parent_head
  const refresh = derivePhase1RunLease(refreshContext, {
    envelope_digest: envelopeDigest,
    plan_bytes: planBytes,
    transition_id: dm01.id,
    predecessor_lease_digest: digestDeliveryValue(initial),
    observed_delta_digest: null,
  })
  assert.doesNotThrow(() => validatePhase1LeaseRefresh({ previous_lease: initial, next_lease: refresh, previous_context: initialContext, next_context: refreshContext, plan_bytes: planBytes, now: Date.parse('2026-07-18T10:02:00Z') }))

  const refreshHeadDrift = clone(refresh)
  refreshHeadDrift.repository_heads_and_clean_state_digests.cc_gateway.head = 'e'.repeat(40)
  const refreshHeadDriftContext = clone(refreshContext)
  refreshHeadDriftContext.repositories.cc_gateway.authorized_parent_head = 'e'.repeat(40)
  expectCode(() => validatePhase1LeaseRefresh({ previous_lease: initial, next_lease: refreshHeadDrift, previous_context: initialContext, next_context: refreshHeadDriftContext, plan_bytes: planBytes, now: Date.parse('2026-07-18T10:02:00Z') }), 'delivery_undeclared_head_advance')

  const observed = [
    { category: 'external:add:cc-source.bundle', digest: `sha256:${'e'.repeat(64)}` },
    { category: 'external:add:sub2api-source.bundle', digest: `sha256:${'f'.repeat(64)}` },
    { category: 'external:append:controller-log' },
  ]
  const successorContext = contextFixture(1)
  const successor = derivePhase1RunLease(successorContext, {
    envelope_digest: envelopeDigest,
    plan_bytes: planBytes,
    transition_id: dm02.id,
    predecessor_lease_digest: digestDeliveryValue(initial),
    observed_delta_digest: digestDeliveryValue(observed),
  })
  assert.doesNotThrow(() => validatePhase1LeaseSuccessor({
    previous_lease: initial,
    next_lease: successor,
    previous_context: initialContext,
    next_context: successorContext,
    plan_bytes: planBytes,
    observed_delta: observed,
    now: Date.parse('2026-07-18T10:02:00Z'),
  }))

  const duplicateSequence = clone(successor)
  duplicateSequence.sequence = 0
  expectCode(() => validatePhase1LeaseSuccessor({ previous_lease: initial, next_lease: duplicateSequence, previous_context: initialContext, next_context: successorContext, plan_bytes: planBytes, observed_delta: observed, now: Date.parse('2026-07-18T10:02:00Z') }), 'delivery_lease_sequence_invalid')
  const wrongPredecessor = clone(successor)
  wrongPredecessor.predecessor_lease_digest = `sha256:${'0'.repeat(64)}`
  expectCode(() => validatePhase1LeaseSuccessor({ previous_lease: initial, next_lease: wrongPredecessor, previous_context: initialContext, next_context: successorContext, plan_bytes: planBytes, observed_delta: observed, now: Date.parse('2026-07-18T10:02:00Z') }), 'delivery_lease_predecessor_invalid')
  const dirtyContext = clone(successorContext)
  dirtyContext.repositories.sub2api.pre_issue_clean = false
  expectCode(() => validatePhase1LeaseSuccessor({ previous_lease: initial, next_lease: successor, previous_context: initialContext, next_context: dirtyContext, plan_bytes: planBytes, observed_delta: observed, now: Date.parse('2026-07-18T10:02:00Z') }), 'delivery_lease_dirty_result')
  expectCode(() => validatePhase1LeaseSuccessor({ previous_lease: initial, next_lease: successor, previous_context: initialContext, next_context: successorContext, plan_bytes: planBytes, observed_delta: observed, now: Date.parse('2026-07-18T15:00:00Z') }), 'delivery_lease_expired')

  expectCode(() => derivePhase1RunLease(initialContext, {
    envelope_digest: envelopeDigest,
    plan_bytes: planBytes,
    transition_id: dm02.id,
    predecessor_lease_digest: null,
    observed_delta_digest: null,
  }), 'delivery_transition_initial_invalid')
  const driftedPlan = replaceTransitionBlock((contractRows) => contractRows.map((row) => row.id === 'DM-01' ? { ...row, condition: 'caller-condition' } : row))
  expectCode(() => derivePhase1RunLease(initialContext, {
    envelope_digest: envelopeDigest,
    plan_bytes: driftedPlan,
    transition_id: dm01.id,
    predecessor_lease_digest: null,
    observed_delta_digest: null,
  }), 'delivery_transition_source_drift')
  const emptySuccessor = derivePhase1RunLease(successorContext, {
    envelope_digest: envelopeDigest,
    plan_bytes: planBytes,
    transition_id: dm02.id,
    predecessor_lease_digest: digestDeliveryValue(initial),
    observed_delta_digest: digestDeliveryValue([]),
  })
  expectCode(() => validatePhase1LeaseSuccessor({ previous_lease: initial, next_lease: emptySuccessor, previous_context: initialContext, next_context: successorContext, plan_bytes: planBytes, observed_delta: [], now: Date.parse('2026-07-18T10:02:00Z') }), 'delivery_observed_delta_missing')
})

test('conditional successor requires one exact reviewed condition', () => {
  const { rows } = parseDeliveryTransitionContract(planBytes)
  const dm05 = rows.find((row) => row.id === 'DM-05')!
  const dm06a = rows.find((row) => row.id === 'DM-06A')!
  const initialContext = contextFixture(0)
  const successorContext = contextFixture(1)
  const envelopeDigest = digestDeliveryValue(derivePhase1BaselineEnvelope(initialContext))
  const previousContext = contextFixture(1)
  const previous = derivePhase1RunLease(previousContext, { envelope_digest: envelopeDigest, plan_bytes: planBytes, transition_id: dm05.id, predecessor_lease_digest: `sha256:${'d'.repeat(64)}`, observed_delta_digest: null })
  const observed = [
    { category: 'external:add:review-verdict' },
    { category: 'git:implementation-root:none', head: previousContext.repositories.cc_gateway.authorized_parent_head, clean: true },
  ]
  const nextContext = contextFixture(2)
  const next = derivePhase1RunLease(nextContext, {
    envelope_digest: envelopeDigest,
    plan_bytes: planBytes,
    transition_id: dm06a.id,
    predecessor_lease_digest: digestDeliveryValue(previous),
    observed_delta_digest: digestDeliveryValue(observed),
  })
  const input = { previous_lease: previous, next_lease: next, previous_context: previousContext, next_context: nextContext, plan_bytes: planBytes, observed_delta: observed, now: Date.parse('2026-07-18T10:03:00Z') }
  expectCode(() => validatePhase1LeaseSuccessor(input), 'delivery_transition_ambiguous_successor')
  assert.doesNotThrow(() => validatePhase1LeaseSuccessor({ ...input, satisfied_condition: 'critical-important-zero' }))
  expectCode(() => validatePhase1LeaseSuccessor({ ...input, satisfied_condition: 'critical-important-nonzero' }), 'delivery_transition_condition_mismatch')
})

test('forbid tokens require exact absence proofs and cannot replace mandatory deltas', () => {
  const { rows } = parseDeliveryTransitionContract(planBytes)
  const dm02 = rows.find((row) => row.id === 'DM-02')!
  const dm03 = rows.find((row) => row.id === 'DM-03')!
  const previousContext = contextFixture(1)
  const nextContext = contextFixture(2)
  const envelopeDigest = digestDeliveryValue(derivePhase1BaselineEnvelope(previousContext))
  const previous = derivePhase1RunLease(previousContext, { envelope_digest: envelopeDigest, plan_bytes: planBytes, transition_id: dm02.id, predecessor_lease_digest: `sha256:${'e'.repeat(64)}`, observed_delta_digest: null })
  const bogus = [{ category: 'forbid:restart-artifact', bogus: true }]
  const next = derivePhase1RunLease(nextContext, { envelope_digest: envelopeDigest, plan_bytes: planBytes, transition_id: dm03.id, predecessor_lease_digest: digestDeliveryValue(previous), observed_delta_digest: digestDeliveryValue(bogus) })
  expectCode(() => validatePhase1LeaseSuccessor({ previous_lease: previous, next_lease: next, previous_context: previousContext, next_context: nextContext, plan_bytes: planBytes, observed_delta: bogus, now: Date.parse('2026-07-18T10:03:00Z') }), 'delivery_observed_delta_missing')
})
