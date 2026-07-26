import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { buildEs9CoverageContract } from '../tools/oracle-lab/phase3b-evidence-sufficiency/authority-materializer.js'
import { SUPPORT_PATHS, deriveCuration, validateConclusionSupport, validateCoverageContract, validateIndependentGoReceipt, validateIndependentTsAgreement } from '../tools/oracle-lab/phase3b-evidence-sufficiency/closeout.js'
import { canonicalBytes, canonicalJson, sha256Bytes, sha256Canonical } from '../tools/oracle-lab/phase3b-evidence-sufficiency/core.js'
import { openExecutionStore, readExecutionReceipts } from '../tools/oracle-lab/phase3b-evidence-sufficiency/execution-store.js'
import { buildCampaignLedger, crossRepoAuthority, ES7_REQUEST_FIELDS, ES7_RESPONSE_FIELDS, type RunLedgerRow } from '../tools/oracle-lab/phase3b-evidence-sufficiency/ledger.js'
import { deriveResponseObservationFromWire, type ResponseWireEvent } from '../tools/oracle-lab/phase3b-evidence-sufficiency/receiver.js'
import { configRoutePlan } from '../tools/oracle-lab/phase3b-evidence-sufficiency/scenario-input.js'
import { createPrivateDirectory, writeExclusiveCanonical } from '../tools/oracle-lab/phase3b-evidence-sufficiency/sealed-fs.js'
import { FROZEN_DECISIONS_SHA256, FROZEN_MUTATION_RESULTS_SHA256, FROZEN_REQUIRED_SET_SHA256, FROZEN_SUB_EXECUTION_DECISIONS_SHA256, FROZEN_SUB_EXECUTION_MUTATIONS_SHA256, SUB_RECEIPT_REQUIRED_TESTS } from '../tools/oracle-contract/check-cross-repo.js'
import { CONTRACT_FILES, CONTRACT_FILE_SHA256 } from '../tools/oracle-contract/check-shared-contract.js'

const SUPPORT_SCHEMAS = [
  'oracle-lab-p3b-typed-wire-fixtures.v3',
  'oracle-lab-p3b-candidate-field-closure.v3',
  'oracle-lab-p3b-pointer-source-coverage.v2',
  'oracle-lab-p3b-independent-go-ts-agreement.v2',
  'oracle-lab-p3b-predecessor-semantic-comparison.v2',
] as const
const TEST_C1 = crossRepoAuthority('c'.repeat(64))

function privateRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)))
  chmodSync(root, 0o700)
  return root
}

function sealedRecord(unsigned: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return { ...unsigned, receipt_sha256: sha256Canonical(unsigned) }
}

function receiptFields(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    launch_authority_sha256: null,
    triggering_terminal_receipt_sha256: null,
    failure_sha256: null,
    sandbox_pid: null,
    target_pid: null,
    executable_identity_sha256: null,
    started_monotonic_ns: null,
    terminal_monotonic_ns: null,
    exit_code: null,
    signal: null,
    terminal_class: null,
    cause_code: null,
    ...overrides,
  }
}

function notExecutedAuthority(ledger: ReturnType<typeof buildCampaignLedger>, row: RunLedgerRow, failureSha256: string, triggeringTerminalReceiptSha256: string | null): string {
  return sha256Canonical({ schema_id: 'oracle-lab-p3b-not-executed-launch-authority.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, run_id: row.run_id, sequence_index: row.sequence_index, row_sha256: row.row_sha256, failure_sha256: failureSha256, triggering_terminal_receipt_sha256: triggeringTerminalReceiptSha256 })
}

function writeReceipt(root: string, ledger: ReturnType<typeof buildCampaignLedger>, row: RunLedgerRow, state: string, previous: string | null, fields: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const unsigned = {
    schema_id: 'oracle-lab-p3b-execution-receipt.v1',
    campaign_id: ledger.campaign_id,
    ledger_sha256: ledger.ledger_sha256,
    run_id: row.run_id,
    sequence_index: row.sequence_index,
    state,
    previous_receipt_sha256: previous,
    ...fields,
  }
  const receipt = sealedRecord(unsigned)
  writeExclusiveCanonical(root, `execution-records/${String(row.sequence_index).padStart(3, '0')}-${row.run_id}-${state}.json`, receipt)
  return receipt
}

test('targeted C1: caller-authored PASS support cannot satisfy Gate B support validation', () => {
  const root = privateRoot('p3b-targeted-support-')
  createPrivateDirectory(root, 'capsules/P3B-ES1/curation/support')
  SUPPORT_PATHS.forEach((relative, index) => {
    const unsigned = { schema_id: SUPPORT_SCHEMAS[index], status: 'PASS' }
    writeExclusiveCanonical(root, relative, { ...unsigned, support_sha256: sha256Canonical(unsigned) })
  })
  assert.throws(() => validateConclusionSupport(root, true), (error: Error & { code?: string }) => error.code === 'conclusion_support_invalid')
})

test('targeted C1 closure: blocked support names missing independent ES8 and normative ES9 artifacts without projection fixtures', () => {
  const root = privateRoot('p3b-targeted-support-shape-')
  createPrivateDirectory(root, 'prelaunch')
  const ledger = buildCampaignLedger('p3b-targeted-support-shape', TEST_C1)
  writeExclusiveCanonical(root, 'prelaunch/run-ledger.json', ledger)
  const store = openExecutionStore(root, ledger)
  const failureUnsigned = { schema_id: 'oracle-lab-p3b-campaign-failure.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, failing_sequence_index: 0, failure_phase: 'before_spawn', failure_family: 'campaign_execution_failure', action: 'stop_all_target_launches', terminal_receipt_sha256: null }
  const failure = { ...failureUnsigned, failure_sha256: sha256Canonical(failureUnsigned) }
  writeExclusiveCanonical(root, 'campaign-failure.json', failure)
  let previous: string | null = null
  for (const row of ledger.rows) {
    const receipt = writeReceipt(root, ledger, row, 'not_executed', previous, receiptFields({ launch_authority_sha256: notExecutedAuthority(ledger, row, failure.failure_sha256, null), failure_sha256: failure.failure_sha256, terminal_class: 'not_executed', cause_code: 'first_terminal_global_stop' }))
    previous = String(receipt.receipt_sha256)
  }
  assert.equal(readExecutionReceipts(store).length, 340)
  deriveCuration(root)
  const fixtures = JSON.parse(Buffer.from(readFileSync(path.join(root, SUPPORT_PATHS[0]))).toString('utf8')) as Record<string, unknown>
  const first = (fixtures.rows as Array<Record<string, unknown>>)[0]
  assert.deepEqual(Object.keys(first).sort(), ['family', 'fixture_sha256', 'request_stimulus_sha256', 'requests', 'responses', 'row_sha256', 'run_id', 'schedule_id', 'sequence_index', 'status'].sort())
  assert.equal('request_projection_sha256' in first, false)
  assert.equal('response_projection_sha256' in first, false)
  const es8 = JSON.parse(Buffer.from(readFileSync(path.join(root, SUPPORT_PATHS[3]))).toString('utf8')) as Record<string, unknown>
  assert.deepEqual(es8.missing_artifacts, ['control/cross-repo-review.json', 'control/es8-go-receipt.json', 'control/es8-ts-c1-agreement.json'])
  const es9 = JSON.parse(Buffer.from(readFileSync(path.join(root, SUPPORT_PATHS[2]))).toString('utf8')) as Record<string, unknown>
  assert.deepEqual(es9.missing_artifacts, ['control/es9-coverage-contract.json'])
})

test('targeted C1 authority: ES8 validates independent raw/internal/C1/repository/decision/stable-code agreement', () => {
  const digest = (value: string) => sha256Bytes(Buffer.from(value, 'utf8'))
  const ledger = buildCampaignLedger('p3b-targeted-es8-authority', TEST_C1)
  const goUnsigned = {
    schema_id: 'oracle.sub_contract_receipt', schema_major: 1, schema_revision: 0,
    bundle_sha256: sha256Bytes(Buffer.concat([canonicalBytes(CONTRACT_FILES.map((relative_path) => ({ relative_path, sha256: CONTRACT_FILE_SHA256[relative_path] }))), Buffer.from('\n', 'utf8')])), decisions_sha256: FROZEN_SUB_EXECUTION_DECISIONS_SHA256, mutation_results_sha256: FROZEN_SUB_EXECUTION_MUTATIONS_SHA256, required_set_sha256: FROZEN_REQUIRED_SET_SHA256,
    executed_required_sha256: sha256Bytes(Buffer.concat([canonicalBytes([...SUB_RECEIPT_REQUIRED_TESTS]), Buffer.from('\n', 'utf8')])), declared_decisions_sha256: FROZEN_DECISIONS_SHA256, declared_mutations_sha256: FROZEN_MUTATION_RESULTS_SHA256,
    stable_code_count: 119, stable_code_set_sha256: 'f6f89d48519aaa46b362a474cc6bd8e470b638e1c7f4c3c0a7ac99413a85fa5c', record_input_sha256: ledger.c1.review_sha256,
    mirror_validation_code: '', index_validation_code: '', record_validation_code: '', mirror_validation_allowed: true, index_validation_allowed: true, record_validation_allowed: true,
  }
  const goReceipt: Record<string, unknown> = { ...goUnsigned, receipt_digest: sha256Bytes(Buffer.concat([canonicalBytes(goUnsigned), Buffer.from('\n', 'utf8')])) }
  validateIndependentGoReceipt(goReceipt, ledger.c1.review_sha256)
  const goRawSha256 = digest('go-raw-bytes')
  const agreementUnsigned = { schema_id: 'oracle-lab-p3b-es8-ts-c1-agreement.v1', repositories: ledger.authority, c1_record_sha256: goUnsigned.record_input_sha256, go_receipt_raw_sha256: goRawSha256, go_receipt_internal_sha256: goReceipt.receipt_digest, decisions_sha256: goReceipt.decisions_sha256, mutation_results_sha256: goReceipt.mutation_results_sha256, required_set_sha256: goReceipt.required_set_sha256, stable_code_count: goReceipt.stable_code_count, stable_code_set_sha256: goReceipt.stable_code_set_sha256, decision: 'PASS' }
  const agreement: Record<string, unknown> = { ...agreementUnsigned, agreement_sha256: sha256Canonical(agreementUnsigned) }
  validateIndependentTsAgreement(agreement, goReceipt, goRawSha256, ledger)
  for (const mutation of [{ stable_code_count: 118 }, { decision: 'READY' }, { go_receipt_raw_sha256: digest('forged') }, { repositories: { ...ledger.authority, cc: { ...ledger.authority.cc, tree: digest('forged-tree') } } }]) {
    const unsigned = { ...agreementUnsigned, ...mutation }
    const forged: Record<string, unknown> = { ...unsigned, agreement_sha256: sha256Canonical(unsigned) }
    assert.throws(() => validateIndependentTsAgreement(forged, goReceipt, goRawSha256, ledger), (error: Error & { code?: string }) => error.code === 'conclusion_support_invalid')
  }
  const goForgedUnsigned = { ...goUnsigned, declared_decisions_sha256: digest('forged-decisions') }
  assert.throws(() => validateIndependentGoReceipt({ ...goForgedUnsigned, receipt_digest: sha256Bytes(Buffer.concat([canonicalBytes(goForgedUnsigned), Buffer.from('\n', 'utf8')])) }, ledger.c1.review_sha256), (error: Error & { code?: string }) => error.code === 'conclusion_support_invalid')
})

test('targeted C1 authority: ES9 accepts only the authority-bound fixed E/C/D coverage contract', () => {
  const ledger = buildCampaignLedger('p3b-targeted-es9-authority', TEST_C1)
  const contract = buildEs9CoverageContract(ledger) as Record<string, unknown>
  const validated = validateCoverageContract(contract, ledger)
  assert.equal(validated.enabled.length, 340 * (ES7_REQUEST_FIELDS.length + ES7_RESPONSE_FIELDS.length))
  assert.equal(validated.disabled.length, 340 * 2)
  assert.equal((contract.normative_e_rows as unknown[]).length, 20)
  assert.equal((contract.normative_c_rows as unknown[]).length, 3)
  assert.equal((contract.normative_d_rows as unknown[]).length, 3)
  const subsetUnsigned: Record<string, unknown> = { ...contract, normative_e_rows: (contract.normative_e_rows as unknown[]).slice(1) }
  delete subsetUnsigned.contract_sha256
  assert.throws(() => validateCoverageContract({ ...subsetUnsigned, contract_sha256: sha256Canonical(subsetUnsigned) }, ledger), (error: Error & { code?: string }) => error.code === 'conclusion_support_invalid')
  const driftedUnsigned: Record<string, unknown> = { ...contract, repositories: { ...ledger.authority, sub: { ...ledger.authority.sub, tree: sha256Bytes(Buffer.from('drift')) } } }
  delete driftedUnsigned.contract_sha256
  assert.throws(() => validateCoverageContract({ ...driftedUnsigned, contract_sha256: sha256Canonical(driftedUnsigned) }, ledger), (error: Error & { code?: string }) => error.code === 'conclusion_support_invalid')
})

test('targeted I1 route: process env controls preflight while local route zero controls the real request', () => {
  const rows = buildCampaignLedger('p3b-targeted-route-plan', TEST_C1).rows
  const processEnv = rows.find((candidate) => candidate.schedule_id === 'config-precedence-process-env-vs-local' && candidate.arm.startsWith('treatment/'))!
  const localFile = rows.find((candidate) => candidate.schedule_id === 'config-precedence-local-vs-project' && candidate.arm.startsWith('treatment/'))!
  assert.deepEqual(configRoutePlan(processEnv), { user: null, project: null, local: 0, 'process-env': 1, request_route: 0, preflight_route: 1 })
  assert.deepEqual(configRoutePlan(localFile), { user: null, project: 0, local: 1, 'process-env': null, request_route: 1, preflight_route: null })
})

test('targeted I1: wire observation is derived from bytes, EOF, ordering, and monotonic header timing', () => {
  const partial = Buffer.from('event: message_start\ndata: {}\n\nevent: content_block_delta\ndata: {}\n\n', 'utf8')
  const events: readonly ResponseWireEvent[] = [
    { kind: 'headers', monotonic_ns: '11000000', bytes: Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 68\r\n\r\n', 'ascii') },
    { kind: 'body', monotonic_ns: '12000000', bytes: partial },
    { kind: 'response_finish', monotonic_ns: '12500000' },
    { kind: 'socket_close', monotonic_ns: '13000000', had_error: false },
  ]
  const observed = deriveResponseObservationFromWire(events, 1_000_000n, 10)
  assert.equal(observed.status, 200)
  assert.deepEqual(observed.ordered_header_classes, [{ name: 'content-type', value_class: 'text/event-stream' }])
  assert.equal(observed.body_byte_length, partial.length)
  assert.equal(observed.body_sha256, sha256Bytes(partial))
  assert.deepEqual(observed.sse_event_order, ['message_start', 'content_block_delta'])
  assert.equal(observed.transport_terminal, 'eof_after_partial')
  assert.equal(observed.delay_elapsed_ns, '10000000')
  assert.equal(observed.timing_bucket, 'at_or_after_boundary')

  const beforeBoundary = deriveResponseObservationFromWire(events.map((event) => ({ ...event, monotonic_ns: String(BigInt(event.monotonic_ns) - 1_000_000n) })) as readonly ResponseWireEvent[], 1_000_000n, 10)
  assert.equal(beforeBoundary.delay_elapsed_ns, '9000000')
  assert.equal(beforeBoundary.timing_bucket, 'before_boundary')
  const completeBody = Buffer.from('event: message_start\ndata: {}\n\nevent: message_stop\ndata: {}\n\n', 'utf8')
  const complete = deriveResponseObservationFromWire([
    { kind: 'headers', monotonic_ns: '20000000', bytes: Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: ${completeBody.length}\r\n\r\n`, 'ascii') },
    { kind: 'body', monotonic_ns: '21000000', bytes: completeBody },
    { kind: 'response_finish', monotonic_ns: '21500000' },
    { kind: 'socket_close', monotonic_ns: '22000000', had_error: false },
  ], 19_000_000n, 0)
  assert.equal(complete.transport_terminal, 'http_complete')
  assert.deepEqual(complete.sse_event_order, ['message_start', 'message_stop'])

  const bodyBeforeHeaders: readonly ResponseWireEvent[] = [events[1], events[0], events[2]]
  assert.throws(() => deriveResponseObservationFromWire(bodyBeforeHeaders, 1_000_000n, 10), (error: Error & { code?: string }) => error.code === 'receiver_wire_invalid')
  const afterTerminal: readonly ResponseWireEvent[] = [...events, { kind: 'body', monotonic_ns: '14000000', bytes: Buffer.from('late') }]
  assert.throws(() => deriveResponseObservationFromWire(afterTerminal, 1_000_000n, 10), (error: Error & { code?: string }) => error.code === 'receiver_wire_invalid')
})

test('targeted I2 wire close: terminal class waits for close and distinguishes clean EOF from reset/error', () => {
  const headers = { kind: 'headers', monotonic_ns: '2', bytes: Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 0\r\n\r\n', 'ascii') } as const
  const clean: readonly ResponseWireEvent[] = [headers, { kind: 'response_finish', monotonic_ns: '3' }, { kind: 'socket_end', monotonic_ns: '4' }, { kind: 'socket_close', monotonic_ns: '5', had_error: false }]
  assert.equal(deriveResponseObservationFromWire(clean, 1n, 0).transport_terminal, 'eof_after_partial')
  const errored: readonly ResponseWireEvent[] = [headers, { kind: 'socket_error', monotonic_ns: '3', error_class: 'ECONNRESET' }, { kind: 'socket_close', monotonic_ns: '4', had_error: true }]
  assert.equal(deriveResponseObservationFromWire(errored, 1n, 0).transport_terminal, 'reset_after_headers')
  const reset: readonly ResponseWireEvent[] = [{ kind: 'reset_requested', monotonic_ns: '2' }, { kind: 'socket_close', monotonic_ns: '3', had_error: false }]
  assert.equal(deriveResponseObservationFromWire(reset, 1n, 0).transport_terminal, 'reset_before_headers')
  assert.throws(() => deriveResponseObservationFromWire([{ kind: 'reset_requested', monotonic_ns: '2' }], 1n, 0), (error: Error & { code?: string }) => error.code === 'receiver_wire_invalid')
})

test('targeted I2: every post-terminal not_executed receipt retains the exact failure binding', () => {
  const root = privateRoot('p3b-targeted-receipts-')
  const ledger = buildCampaignLedger('p3b-targeted-receipts', TEST_C1)
  const store = openExecutionStore(root, ledger)
  const authority = 'a'.repeat(64)
  let previous: string | null = null
  const started = writeReceipt(root, ledger, ledger.rows[0], 'started', previous, receiptFields({ launch_authority_sha256: authority, started_monotonic_ns: '10' }))
  previous = String(started.receipt_sha256)
  const spawned = writeReceipt(root, ledger, ledger.rows[0], 'spawned', previous, receiptFields({ launch_authority_sha256: authority, sandbox_pid: 10, target_pid: 11, executable_identity_sha256: 'b'.repeat(64), started_monotonic_ns: '10' }))
  previous = String(spawned.receipt_sha256)
  const terminal = writeReceipt(root, ledger, ledger.rows[0], 'terminal', previous, receiptFields({ launch_authority_sha256: authority, started_monotonic_ns: '10', terminal_monotonic_ns: '20', exit_code: 1, terminal_class: 'failed_after_spawn', cause_code: 'synthetic_failure' }))
  previous = String(terminal.receipt_sha256)
  const failureUnsigned = { schema_id: 'oracle-lab-p3b-campaign-failure.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, failing_sequence_index: 0, failure_phase: 'after_spawn', failure_family: 'failed_after_spawn', action: 'stop_all_target_launches', terminal_receipt_sha256: terminal.receipt_sha256 }
  const failure = { ...failureUnsigned, failure_sha256: sha256Canonical(failureUnsigned) }
  writeExclusiveCanonical(root, 'campaign-failure.json', failure)
  for (const row of ledger.rows.slice(1)) {
    const receipt = writeReceipt(root, ledger, row, 'not_executed', previous, receiptFields({ launch_authority_sha256: notExecutedAuthority(ledger, row, failure.failure_sha256, String(terminal.receipt_sha256)), triggering_terminal_receipt_sha256: terminal.receipt_sha256, failure_sha256: failure.failure_sha256, terminal_class: 'not_executed', cause_code: 'first_terminal_global_stop' }))
    previous = String(receipt.receipt_sha256)
  }
  assert.equal(readExecutionReceipts(store).length, 342)

  const lastRow = ledger.rows.at(-1)!
  const relative = `execution-records/${String(lastRow.sequence_index).padStart(3, '0')}-${lastRow.run_id}-not_executed.json`
  const last = readExecutionReceipts(store).at(-1)!
  const original = `${canonicalJson(last)}\n`
  const mutations: ReadonlyArray<Readonly<Record<string, unknown>>> = [
    { launch_authority_sha256: 'c'.repeat(64) },
    { triggering_terminal_receipt_sha256: 'd'.repeat(64), launch_authority_sha256: notExecutedAuthority(ledger, lastRow, failure.failure_sha256, 'd'.repeat(64)) },
    { failure_sha256: 'e'.repeat(64), launch_authority_sha256: notExecutedAuthority(ledger, lastRow, 'e'.repeat(64), String(terminal.receipt_sha256)) },
    { previous_receipt_sha256: 'f'.repeat(64) },
  ]
  for (const mutation of mutations) {
    const forgedUnsigned = { ...last, ...mutation } as Record<string, unknown>
    delete forgedUnsigned.receipt_sha256
    const forged = { ...forgedUnsigned, receipt_sha256: sha256Canonical(forgedUnsigned) }
    writeFileSync(path.join(root, relative), `${canonicalJson(forged)}\n`, { encoding: 'utf8' })
    assert.throws(() => readExecutionReceipts(store), (error: Error & { code?: string }) => error.code === 'execution_receipt_invalid')
    writeFileSync(path.join(root, relative), original, { encoding: 'utf8' })
  }
  assert.equal(readExecutionReceipts(store).at(-1)?.receipt_sha256, last.receipt_sha256)
})
