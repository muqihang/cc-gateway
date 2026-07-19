import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  decideOutcome,
  decideReadiness,
  decideTaskLineage,
  transitionLifecycle,
  type LifecycleOperation,
  type LifecycleState,
  type OutcomeEnvelope,
  type ReadinessExpected,
  type ReadinessHandshake,
  type TaskLineage,
  type TaskLineageState,
} from '../src/oracle-contract/cross-project.js'
import { transitionReplayState, type ReplayState } from '../src/oracle-contract/sidecar-envelope.js'

type Corpus = {
  fixtures: {
    readiness_expected: ReadinessExpected
    readiness: ReadinessHandshake
    lifecycle_state: LifecycleState
    lifecycle_operation: LifecycleOperation
    lineage_state: TaskLineageState
    lineage_candidate: TaskLineage
    outcome_partial: OutcomeEnvelope
    outcome_rate_limit: OutcomeEnvelope
  }
  expected_state_digests: Record<string, string>
  cases: Array<{ id: string; kind: string; expected_code: string }>
}
const corpus = JSON.parse(readFileSync(path.resolve('contracts/oracle-lab/v1/interface-corpus.json'), 'utf8')) as Corpus

for (const fixture of corpus.cases) {
  test(`cross-project corpus: ${fixture.id}`, () => {
    let code = ''
    let stateDigest: string | undefined
    if (fixture.kind === 'readiness') {
      const expected = structuredClone(corpus.fixtures.readiness_expected)
      const handshake = structuredClone(corpus.fixtures.readiness)
      if (fixture.id === 'readiness-live-not-ready') handshake.readiness = false
      if (fixture.id === 'readiness-contract-mismatch') handshake.contract_digest = '0'.repeat(64)
      if (fixture.id === 'readiness-revision-unsupported') handshake.supported_contracts = [{ schema_major: 1, minimum_revision: 1, maximum_revision: 1 }]
      let boundaryCalls = 0
      const decision = decideReadiness(handshake, expected, () => { boundaryCalls += 1 })
      code = decision.code
      assert.equal(boundaryCalls, decision.allowed ? 1 : 0)
    } else if (fixture.kind === 'lifecycle') {
      const state = structuredClone(corpus.fixtures.lifecycle_state)
      const operation = structuredClone(corpus.fixtures.lifecycle_operation)
      if (fixture.id === 'lifecycle-register') {
        Object.assign(state, { account_generation: 0, credential_generation: 0, proxy_generation: 0, profile_generation: 0, state_version: 0, status: 'absent' })
        Object.assign(operation, { operation: 'register', account_generation: 1, credential_generation: 1, proxy_generation: 1, profile_generation: 1, expected_state_version: 0, next_state_version: 1 })
      }
      if (fixture.id === 'lifecycle-stale-cas') operation.expected_state_version = 0
      if (fixture.id === 'lifecycle-generation-regression') operation.proxy_generation = 0
      const decision = transitionLifecycle(state, operation)
      code = decision.code
      stateDigest = decision.nextStateDigest
    } else if (fixture.kind === 'lineage') {
      const state = structuredClone(corpus.fixtures.lineage_state)
      const candidate = structuredClone(corpus.fixtures.lineage_candidate)
      if (fixture.id === 'lineage-root-mismatch') candidate.root_task_ref = 'task:root:other'
      if (fixture.id === 'migration-sequence-stale') candidate.migration_sequence = state.migration_sequence
      const decision = decideTaskLineage(state, candidate, corpus.fixtures.readiness_expected.now_ms)
      code = decision.code
      stateDigest = decision.nextStateDigest
    } else if (fixture.kind === 'outcome') {
      const outcome = fixture.id === 'outcome-partial-tool-side-effect' ? corpus.fixtures.outcome_partial : corpus.fixtures.outcome_rate_limit
      code = decideOutcome(outcome).code
    } else {
      const identity = { key_epoch: 11, capability_id: 'capability:fixture:1', attempt_id: 'attempt:fixture:1', nonce: 'nonce:fixture:1' }
      const initial: ReplayState = { ledger_generation: 0, entries: {} }
      const reserved = transitionReplayState(initial, { ...identity, operation: 'reserve', expected_generation: 0, now_ms: 1_800_000_000_000, expires_at_ms: 1_800_000_060_000 })
      if (fixture.id === 'replay-reserve') code = reserved.code
      if (fixture.id === 'replay-commit') code = transitionReplayState(reserved.nextState as ReplayState, { ...identity, operation: 'commit', expected_generation: 1, now_ms: 1_800_000_000_100, expires_at_ms: 1_800_000_060_000 }).code
      if (fixture.id === 'replay-reuse') code = transitionReplayState(reserved.nextState as ReplayState, { ...identity, operation: 'reserve', expected_generation: 1, now_ms: 1_800_000_000_100, expires_at_ms: 1_800_000_060_000 }).code
      if (fixture.id === 'replay-stale-replica') code = transitionReplayState(reserved.nextState as ReplayState, { ...identity, operation: 'commit', expected_generation: 0, now_ms: 1_800_000_000_100, expires_at_ms: 1_800_000_060_000 }).code
    }
    assert.equal(code, fixture.expected_code)
    if (stateDigest) assert.equal(stateDigest, corpus.expected_state_digests[fixture.id])
    if (stateDigest && process.env.ORACLE_PHASE2_DEBUG_DIGESTS === '1') console.log(`interface-digest ${fixture.id} ${stateDigest}`)
  })
}
