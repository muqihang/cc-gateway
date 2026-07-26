import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { main as campaignMain } from '../tools/oracle-lab/phase3b-evidence-sufficiency/campaign.js'
import { SUPPORT_PATHS, deriveCuration, runCloseout, validateArtifactIndexCoverage, validateConclusionSupport, validateExternalSet } from '../tools/oracle-lab/phase3b-evidence-sufficiency/closeout.js'
import { canonicalJson, sha256Canonical } from '../tools/oracle-lab/phase3b-evidence-sufficiency/core.js'
import { deriveExecutionCounts, openExecutionStore, readCampaignFailure, readExecutionReceipts, sealPreSpawnFailure } from '../tools/oracle-lab/phase3b-evidence-sufficiency/execution-store.js'
import { FIXED_STDIN_LITERAL, FIXED_STDIN_LITERAL_REF, buildCampaignLedger, buildResponseProgram, validateCampaignLedger } from '../tools/oracle-lab/phase3b-evidence-sufficiency/ledger.js'
import { classifySyntheticAuthHeader } from '../tools/oracle-lab/phase3b-evidence-sufficiency/scenario-input.js'
import { assertPrivateRuntimeRoot, createPrivateDirectory, readCanonical, writeExclusiveCanonical } from '../tools/oracle-lab/phase3b-evidence-sufficiency/sealed-fs.js'
import { expectedSelectedRoute } from '../tools/oracle-lab/phase3b-evidence-sufficiency/route-policy.js'
import { loadTrustedReviewerRegistry, verifyTrustedSignature } from '../tools/oracle-lab/phase3b-evidence-sufficiency/trust.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function privateRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)))
  chmodSync(root, 0o700)
  return root
}

test('production ledger freezes order, counts, UUIDv4, stdin reference, and family programs', () => {
  const ledger = buildCampaignLedger('p3b-focused-core')
  assert.equal(ledger.rows.length, 340)
  assert.deepEqual(ledger.counts, { mandatory_target_controls: 20, config: 80, auth: 80, request_wire: 30, response_failure_recovery: 130, total_rows: 340 })
  assert.ok(ledger.rows.every((row, index) => row.sequence_index === index && UUID_V4.test(row.run_id) && row.stdin_literal_ref === FIXED_STDIN_LITERAL_REF))
  assert.equal(new Set(ledger.rows.map((row) => row.run_id)).size, 340)
  assert.equal(ledger.rows.slice(0, 10).every((row) => row.schedule_id === 'target-guard-control'), true)
  assert.equal(ledger.rows.slice(10, 20).every((row) => row.schedule_id === 'target-perturbation-control'), true)
  assert.equal(JSON.stringify(ledger).includes(FIXED_STDIN_LITERAL.trim()), false)
  assert.deepEqual(ledger.schedule_descriptors[0], {
    algorithm_id: 'fixed-base-plus-cyclic-rotation-v2', encoding_id: 'lp-u32be-v1', campaign_id: 'p3b-focused-core', schedule_id: 'target-guard-control', arm_count: 2,
    seeds: [215001, 215002, 215003, 215004, 215005], seed_vector_digest: '415e0b1e20a486c05c62267d75647e37eb0fb3abcd7fdd2f1afd01960759f9c1',
    sorted_labels: ['instrumented', 'uninstrumented'], base_permutation_digest: '01c8fed617bea95560d5afff6b399f4ebf14569c6eaecc82f546cff4a4faad51', offset: 0, direction: -1,
    base: ['instrumented', 'uninstrumented'], orders: [['instrumented', 'uninstrumented'], ['uninstrumented', 'instrumented'], ['instrumented', 'uninstrumented'], ['uninstrumented', 'instrumented'], ['instrumented', 'uninstrumented']],
    descriptor_sha256: 'b114f72f558a5c5f8119753e98ec546e785bdee464261ccef448196799acf6f7',
  })
  assert.deepEqual(ledger.rows.slice(0, 4).map((row) => row.run_id), ['08a0a766-70de-46e4-9442-f1a05ca9c993', '833e2bfc-fc51-4046-8f54-352d2295c2df', '8bff393f-5ccc-443f-9083-cf3da0eae3f3', '02061fb0-140c-4a13-8d52-3d4656f6a6e0'])
  assert.deepEqual(buildCampaignLedger('p3b-focused-core'), ledger)
  assert.throws(() => validateCampaignLedger({ ...ledger, rows: [ledger.rows[1], ledger.rows[0], ...ledger.rows.slice(2)] }), (error: Error & { code?: string }) => error.code === 'launch_ledger_invalid')
})

test('complete_sse and recovery descriptors are complete, ordered, and attempt-bound', () => {
  const complete = buildResponseProgram('complete_sse')
  assert.equal(complete.maximum_attempts, 1)
  assert.deepEqual(complete.actions[0], { action_ordinal: 0, kind: 'http', status: 200, ordered_headers: [{ name: 'content-type', value_class: 'text/event-stream' }], body_kind: 'complete_sse', delay_class: 'none', delay_ms: 0, transport_terminal: 'http_complete' })
  assert.deepEqual(complete.complete_sse?.event_order, ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop'])
  assert.deepEqual(complete.complete_sse?.materialized_literal_refs, ['synthetic-literals/model.test', 'synthetic-literals/output.complete'])
  const retry = buildResponseProgram('http_429_then_complete')
  assert.equal(retry.maximum_attempts, 2)
  assert.deepEqual(retry.actions.map((action) => [action.action_ordinal, action.status, action.body_kind]), [[0, 429, 'error_json'], [1, 200, 'complete_sse']])
})

test('request-wire schedules carry three distinct real argv stimuli with paired-arm stability', () => {
  const rows = buildCampaignLedger('p3b-request-stimuli').rows.filter((row) => row.family === 'request_wire')
  const bySchedule = ['prompt_only', 'safe_tool_catalog', 'tool_disabled'].map((schedule) => rows.filter((row) => row.schedule_id === schedule))
  assert.equal(new Set(bySchedule.map((members) => members[0].request_stimulus_sha256)).size, 3)
  assert.equal(new Set(bySchedule.map((members) => JSON.stringify(members[0].request_stimulus.argv_suffix))).size, 3)
  for (const members of bySchedule) assert.equal(new Set(members.map((row) => row.request_stimulus_sha256)).size, 1)
})

test('retryable terminal and recovery programs share the trigger then diverge deterministically', () => {
  const terminal = buildResponseProgram('http_429_terminal')
  const recovery = buildResponseProgram('http_429_then_complete')
  assert.equal(terminal.maximum_attempts, 2)
  assert.deepEqual(terminal.actions.map((action) => [action.status, action.body_kind]), [[429, 'error_json'], [400, 'error_json']])
  assert.deepEqual(recovery.actions.map((action) => [action.status, action.body_kind]), [[429, 'error_json'], [200, 'complete_sse']])
  assert.deepEqual(buildResponseProgram('reset_terminal').actions.map((action) => [action.kind, action.status]), [['reset', null], ['http', 400]])
})

test('config route policy keeps process-env on request route zero and uses route one only for file treatments', () => {
  const rows = buildCampaignLedger('p3b-route-policy').rows
  const processEnv = rows.find((candidate) => candidate.schedule_id === 'config-precedence-process-env-vs-local' && candidate.arm.startsWith('treatment/'))!
  const localFile = rows.find((candidate) => candidate.schedule_id === 'config-precedence-local-vs-project' && candidate.arm.startsWith('treatment/'))!
  const control = rows.find((candidate) => candidate.schedule_id === 'config-precedence-local-vs-project' && candidate.arm.startsWith('control/'))!
  assert.equal(expectedSelectedRoute(processEnv), 0)
  assert.equal(expectedSelectedRoute(localFile), 1)
  assert.equal(expectedSelectedRoute(control), 0)
})

test('fixed reviewer registry rejects a caller-fabricated signature', () => {
  const registry = loadTrustedReviewerRegistry(process.cwd())
  const reviewer = registry.reviewers.find((candidate) => candidate.reviewer_role === 'requirements')!
  assert.throws(() => verifyTrustedSignature({ reviewer_identity: reviewer.reviewer_identity, reviewer_role: reviewer.reviewer_role, signing_key_id: reviewer.key_id, signature_algorithm: 'ed25519_canonical_json_v1', signature: Buffer.alloc(64).toString('base64'), authority_sha256: 'a'.repeat(64) }, registry, 'requirements', 'authority_sha256', 'operator_authority_invalid'), (error: Error & { code?: string }) => error.code === 'operator_authority_invalid')
})

test('sealed filesystem rejects symlink runtime components and O_EXCL rewrite', () => {
  const parent = privateRoot('p3b-sealed-fs-')
  const real = path.join(parent, 'real')
  const link = path.join(parent, 'link')
  mkdirSync(real, { mode: 0o700 })
  symlinkSync(real, link)
  assert.throws(() => assertPrivateRuntimeRoot(link), (error: Error & { code?: string }) => error.code === 'sealed_path_invalid')
  writeExclusiveCanonical(parent, 'record.json', { schema_id: 'focused.v1', value: 1 })
  assert.deepEqual(readCanonical(parent, 'record.json').value, { schema_id: 'focused.v1', value: 1 })
  assert.throws(() => writeExclusiveCanonical(parent, 'record.json', { schema_id: 'focused.v1', value: 2 }), (error: NodeJS.ErrnoException) => error.code === 'EEXIST')
})

test('pre-spawn first failure closes all 340 rows from sealed state without caller counts', () => {
  const root = privateRoot('p3b-receipts-')
  const ledger = buildCampaignLedger('p3b-focused-receipts')
  const store = openExecutionStore(root, ledger)
  const failure = sealPreSpawnFailure(store, ledger.rows[0], 'authority_drift')
  const receipts = readExecutionReceipts(store)
  assert.equal(failure.failing_sequence_index, 0)
  assert.equal(failure.failure_family, 'campaign_execution_failure')
  assert.equal(receipts.length, 340)
  assert.ok(receipts.every((receipt, index) => receipt.sequence_index === index && receipt.state === 'not_executed' && receipt.terminal_class === 'not_executed'))
  assert.deepEqual(deriveExecutionCounts(store), { planned: 340, started: 0, spawned: 0, terminal: 0, not_executed: 340 })
  assert.equal(readCampaignFailure(store)?.failure_sha256, failure.failure_sha256)
  assert.throws(() => sealPreSpawnFailure(store, ledger.rows[0], 'second_failure'), (error: Error & { code?: string }) => error.code === 'campaign_failure_invalid')
})

test('auth projection recognizes only fixed synthetic marker values', () => {
  assert.equal(classifySyntheticAuthHeader('x-api-key', 'oracle-phase3b-placeholder:auth-api-key-a'), 'api-key-a')
  assert.equal(classifySyntheticAuthHeader('authorization', 'Bearer oracle-phase3b-placeholder:auth-token-b'), 'auth-token-b')
  assert.equal(classifySyntheticAuthHeader('x-api-key', 'caller-selected-value'), null)
})

test('campaign CLI rejects missing and unknown arguments before side effects', async () => {
  await assert.rejects(campaignMain([]), (error: Error & { code?: string }) => error.code === 'runner_cli_invalid')
  await assert.rejects(campaignMain(['--mode', 'prelaunch-only', '--operator-authority', 'a', '--campaign-input', 'b', '--evidence-root', 'c', '--now-ms', '0']), (error: Error & { code?: string }) => error.code === 'runner_cli_invalid')
})

test('curation and exact five-record closeout derive Unknown/disabled only from sealed receipts', () => {
  const root = privateRoot('p3b-closeout-')
  createPrivateDirectory(root, 'prelaunch')
  const ledger = buildCampaignLedger('p3b-focused-closeout')
  writeExclusiveCanonical(root, 'prelaunch/run-ledger.json', ledger)
  const store = openExecutionStore(root, ledger)
  sealPreSpawnFailure(store, ledger.rows[0], 'authority_drift')
  const curation = deriveCuration(root)
  assert.equal(curation.status, 'Unknown')
  assert.equal((curation.rows as Array<Record<string, unknown>>).length, 340)
  assert.ok((curation.rows as Array<Record<string, unknown>>).every((row) => row.status === 'Unknown' && row.enabled === false))
  const closeout = runCloseout(root)
  assert.equal(closeout.status, 'BLOCKED')
  assert.equal(closeout.phase3b_usable, false)
  const external = validateExternalSet(root)
  assert.deepEqual((external.records as Array<Record<string, unknown>>).map((record) => record.name), ['artifact-index', 'leak-report', 'exit-report', 'handoff', 'terminal-manifest'])
  assert.equal(SUPPORT_PATHS.length, 5)
  assert.equal(validateConclusionSupport(root, false).length, 5)
  assert.throws(() => validateConclusionSupport(root, true), (error: Error & { code?: string }) => error.code === 'conclusion_support_invalid')
  createPrivateDirectory(root, 'runs')
  writeExclusiveCanonical(root, 'runs/unindexed-extra.json', { schema_id: 'unexpected.v1', value: 'caller-leftover' })
  assert.throws(() => validateArtifactIndexCoverage(root, readCanonical(root, 'capsules/P3B-ES1/closure/artifact-index.json', 16_777_216).value), (error: Error & { code?: string }) => error.code === 'artifact_index_invalid')
  const provenance = readCanonical(root, SUPPORT_PATHS[2], 16_777_216).value
  const unsigned: Record<string, unknown> = { ...provenance, coverage: { ...(provenance.coverage as Record<string, unknown>), represented_pointer_count: 339 } }
  delete unsigned.support_sha256
  const drifted = { ...unsigned, support_sha256: sha256Canonical(unsigned) }
  writeFileSync(path.join(root, SUPPORT_PATHS[2]), `${canonicalJson(drifted)}\n`, 'utf8')
  assert.throws(() => validateConclusionSupport(root, false), (error: Error & { code?: string }) => error.code === 'conclusion_support_invalid')
})
