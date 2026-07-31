import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { validatePostGateLeakReport, writePostGateLeakReport } from '../tools/oracle-lab/phase3b-evidence-sufficiency/closeout.js'
import { assertProductionController, createProductionController } from '../tools/oracle-lab/phase3b-evidence-sufficiency/controller.js'
import { canonicalBytes, sha256Canonical } from '../tools/oracle-lab/phase3b-evidence-sufficiency/core.js'
import { evaluateGateB, OPERATOR_MAX_DELAY_MS, validateGateBArchivalOrder } from '../tools/oracle-lab/phase3b-evidence-sufficiency/gates.js'
import { buildCampaignLedger, crossRepoAuthority } from '../tools/oracle-lab/phase3b-evidence-sufficiency/ledger.js'
import { createPrivateDirectory, writeExclusiveCanonical } from '../tools/oracle-lab/phase3b-evidence-sufficiency/sealed-fs.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const TEST_C1 = crossRepoAuthority('c'.repeat(64))

function privateRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)))
  chmodSync(root, 0o700)
  return root
}

test('review C1/I4: production ledger is the exact deterministic 340-row campaign', () => {
  const ledger = buildCampaignLedger('p3b-production-red', TEST_C1)
  assert.equal(ledger.rows.length, 340)
  assert.equal(new Set(ledger.rows.map((row) => row.run_id)).size, 340)
  assert.ok(ledger.rows.every((row, index) => row.sequence_index === index && typeof row.run_id === 'string' && UUID_V4.test(row.run_id)))
  const counts = Object.fromEntries(['target_control', 'config', 'auth', 'request_wire', 'response_failure_recovery'].map((family) => [family, ledger.rows.filter((row) => row.family === family).length]))
  assert.deepEqual(counts, { target_control: 20, config: 80, auth: 80, request_wire: 30, response_failure_recovery: 130 })
})

test('review C2: launch authority is process-opaque and a structural clone is rejected', () => {
  const authority = createProductionController({ campaign_id: 'p3b-production-red', c1: TEST_C1 })
  const forged = JSON.parse(JSON.stringify(authority))
  assert.doesNotThrow(() => assertProductionController(authority))
  assert.throws(() => assertProductionController(forged), (error: Error & { code?: string }) => error.code === 'launch_authority_invalid')
})

test('review C4/I1: Gate B cannot be self-authorized with caller time, hashes, or READY', () => {
  assert.throws(() => evaluateGateB({
    now_ms: 0,
    max_age_ms: Number.MAX_SAFE_INTEGER,
    gate_a: 'READY',
    artifact_sha256s: ['a'.repeat(64)],
    operator_decision: 'READY',
  } as never), (error: Error & { code?: string }) => error.code === 'gate_input_invalid')
})

test('Gate B issuance enforces the fixed operator decision window', () => {
  const issuedAt = 1_000_000
  const input = {
    campaign_id: 'p3b-gate-b-issuance-window',
    gate_a_sha256: '1'.repeat(64),
    gate_a_clock_sha256: '2'.repeat(64),
    external_set_sha256: '3'.repeat(64),
    operator_decision_sha256: '4'.repeat(64),
    conclusion_sha256s: ['5'.repeat(64), '6'.repeat(64), '7'.repeat(64)],
    gate_clock_sha256: '8'.repeat(64),
    controller_source_set_sha256: '9'.repeat(64),
    controller_executable_sha256: 'a'.repeat(64),
    toolchain_sha256: 'b'.repeat(64),
    support_status: 'PASS' as const,
    leak_status: 'PASS' as const,
    leak_finding_count: 0,
    conclusion_states: Array.from({ length: 3 }, () => ({ level: 'Reproduced', enabled: true, contradiction_count: 0 })),
    issued_wall_clock_ms: issuedAt,
    issued_monotonic_ns: '1000000000',
  }

  assert.doesNotThrow(() => evaluateGateB({
    ...input,
    evaluation_wall_clock_ms: issuedAt + 276_161,
    evaluation_monotonic_ns: '277161000000',
  }))
  assert.doesNotThrow(() => evaluateGateB({
    ...input,
    evaluation_wall_clock_ms: issuedAt + OPERATOR_MAX_DELAY_MS,
    evaluation_monotonic_ns: '301000000000',
  }))
  assert.throws(() => evaluateGateB({
    ...input,
    evaluation_wall_clock_ms: issuedAt + OPERATOR_MAX_DELAY_MS + 1,
    evaluation_monotonic_ns: '301001000000',
  }), (error: Error & { code?: string }) => error.code === 'gate_b_clock_invalid')
  assert.throws(() => evaluateGateB({
    ...input,
    evaluation_wall_clock_ms: issuedAt - 1,
    evaluation_monotonic_ns: '999999999',
  }), (error: Error & { code?: string }) => error.code === 'gate_b_clock_invalid')
})

test('Gate B archival verification preserves the issuance decision after the freshness window', () => {
  const decisionWall = 1_000_000
  const gateBWall = decisionWall + 276_161
  const valid = {
    decision_wall_clock_ms: decisionWall,
    decision_monotonic_ns: '1000000000000',
    gate_b_wall_clock_ms: gateBWall,
    gate_b_monotonic_ns: '1276161000000',
    post_gate_scan_wall_clock_ms: decisionWall + OPERATOR_MAX_DELAY_MS + 20_000,
    post_gate_scan_monotonic_ns: '1320000000000',
    confirmation_wall_clock_ms: decisionWall + OPERATOR_MAX_DELAY_MS + 120_000,
    confirmation_monotonic_ns: '1420000000000',
  }
  assert.doesNotThrow(() => validateGateBArchivalOrder(valid))

  for (const changed of [
    { gate_b_wall_clock_ms: decisionWall + OPERATOR_MAX_DELAY_MS + 1 },
    { gate_b_wall_clock_ms: decisionWall - 1 },
    { gate_b_monotonic_ns: '999999999999' },
    { post_gate_scan_wall_clock_ms: gateBWall - 1 },
    { post_gate_scan_monotonic_ns: '1276160999999' },
    { confirmation_wall_clock_ms: gateBWall - 1 },
    { confirmation_monotonic_ns: '1276160999999' },
  ]) {
    assert.throws(() => validateGateBArchivalOrder({ ...valid, ...changed }), (error: Error & { code?: string }) => error.code === 'gate_b_clock_invalid' || error.code === 'gate_b_result_invalid')
  }
})

test('post-Gate leak report seals its clock and rejects reordered scan or changed Gate B bytes', () => {
  const root = privateRoot('p3b-gate-b-archive-')
  createPrivateDirectory(root, 'capsules/P3B-ES1/gates')
  createPrivateDirectory(root, 'capsules/P3B-ES1/closure')
  const gateBClockUnsigned = {
    schema_id: 'oracle-lab-p3b-gate-clock.v1',
    wall_clock_ms: Date.now() - 1_000,
    monotonic_ns: (process.hrtime.bigint() - 1_000_000_000n).toString(),
  }
  const gateBClock = { ...gateBClockUnsigned, clock_sha256: sha256Canonical(gateBClockUnsigned) }
  const gateBUnsigned = { schema_id: 'oracle-lab-p3b-gate-result.v1', campaign_id: 'p3b-gate-b-archive', gate_clock_sha256: gateBClock.clock_sha256 }
  const gateB = { ...gateBUnsigned, gate_result_sha256: sha256Canonical(gateBUnsigned) }
  const preGateUnsigned = { schema_id: 'oracle-lab-p3b-leak-report.v1', status: 'PASS' }
  writeExclusiveCanonical(root, 'capsules/P3B-ES1/gates/gate-b-clock.json', gateBClock)
  writeExclusiveCanonical(root, 'capsules/P3B-ES1/gates/gate-b-result.json', gateB)
  writeExclusiveCanonical(root, 'capsules/P3B-ES1/closure/leak-report.json', { ...preGateUnsigned, leak_report_sha256: sha256Canonical(preGateUnsigned) })

  const report = writePostGateLeakReport(root)
  assert.equal(report.schema_id, 'oracle-lab-p3b-post-gate-leak-report.v2')
  assert.doesNotThrow(() => validatePostGateLeakReport(root))
  const reportPath = path.join(root, 'capsules/P3B-ES1/gates/post-gate-leak-report.json')
  const { post_gate_leak_report_sha256: _oldDigest, ...reportUnsigned } = report
  const reorderedUnsigned = { ...reportUnsigned, scanned_at_ms: Number(gateBClock.wall_clock_ms) - 1 }
  const reordered = { ...reorderedUnsigned, post_gate_leak_report_sha256: sha256Canonical(reorderedUnsigned) }
  writeFileSync(reportPath, Buffer.concat([canonicalBytes(reordered), Buffer.from('\n')]), { mode: 0o600 })
  assert.throws(() => validatePostGateLeakReport(root), (error: Error & { code?: string }) => error.code === 'leak_report_invalid')

  writeFileSync(reportPath, Buffer.concat([canonicalBytes(report), Buffer.from('\n')]), { mode: 0o600 })
  const changedGateBUnsigned = { ...gateBUnsigned, campaign_id: 'p3b-gate-b-changed' }
  writeFileSync(path.join(root, 'capsules/P3B-ES1/gates/gate-b-result.json'), Buffer.concat([canonicalBytes({ ...changedGateBUnsigned, gate_result_sha256: sha256Canonical(changedGateBUnsigned) }), Buffer.from('\n')]), { mode: 0o600 })
  assert.throws(() => validatePostGateLeakReport(root), (error: Error & { code?: string }) => error.code === 'leak_report_invalid')
})
