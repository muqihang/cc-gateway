import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertProductionController,
  buildCampaignLedger,
  createProductionController,
  evaluateProductionGateB,
} from '../tools/oracle-lab/phase3b-evidence-sufficiency/production-executor.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('review C1/I4: production ledger is the exact deterministic 340-row campaign', () => {
  const ledger = buildCampaignLedger('p3b-production-red')
  assert.equal(ledger.rows.length, 340)
  assert.equal(new Set(ledger.rows.map((row) => row.run_id)).size, 340)
  assert.ok(ledger.rows.every((row, index) => row.sequence_index === index && typeof row.run_id === 'string' && UUID_V4.test(row.run_id)))
  const counts = Object.fromEntries(['target_control', 'config', 'auth', 'request_wire', 'response_failure_recovery'].map((family) => [family, ledger.rows.filter((row) => row.family === family).length]))
  assert.deepEqual(counts, { target_control: 20, config: 80, auth: 80, request_wire: 30, response_failure_recovery: 130 })
})

test('review C2: launch authority is process-opaque and a structural clone is rejected', () => {
  const authority = createProductionController({ campaign_id: 'p3b-production-red' })
  const forged = JSON.parse(JSON.stringify(authority))
  assert.doesNotThrow(() => assertProductionController(authority))
  assert.throws(() => assertProductionController(forged), (error: Error & { code?: string }) => error.code === 'launch_authority_invalid')
})

test('review C4/I1: Gate B cannot be self-authorized with caller time, hashes, or READY', () => {
  assert.throws(() => evaluateProductionGateB({
    now_ms: 0,
    max_age_ms: Number.MAX_SAFE_INTEGER,
    gate_a: 'READY',
    artifact_sha256s: ['a'.repeat(64)],
    operator_decision: 'READY',
  }), (error: Error & { code?: string }) => error.code === 'gate_input_invalid')
})
