import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { SUPPORT_PATHS, validateConclusionSupport } from '../tools/oracle-lab/phase3b-evidence-sufficiency/closeout.js'
import { canonicalJson, sha256Bytes, sha256Canonical } from '../tools/oracle-lab/phase3b-evidence-sufficiency/core.js'
import { openExecutionStore, readExecutionReceipts } from '../tools/oracle-lab/phase3b-evidence-sufficiency/execution-store.js'
import { buildCampaignLedger, type RunLedgerRow } from '../tools/oracle-lab/phase3b-evidence-sufficiency/ledger.js'
import { deriveResponseObservationFromWire, type ResponseWireEvent } from '../tools/oracle-lab/phase3b-evidence-sufficiency/receiver.js'
import { createPrivateDirectory, writeExclusiveCanonical } from '../tools/oracle-lab/phase3b-evidence-sufficiency/sealed-fs.js'

const SUPPORT_SCHEMAS = [
  'oracle-lab-p3b-typed-wire-fixtures.v1',
  'oracle-lab-p3b-candidate-field-closure.v1',
  'oracle-lab-p3b-field-provenance.v1',
  'oracle-lab-p3b-cross-repo-result.v1',
  'oracle-lab-p3b-predecessor-semantic-comparison.v1',
] as const

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

test('targeted I1: wire observation is derived from bytes, EOF, ordering, and monotonic header timing', () => {
  const partial = Buffer.from('event: message_start\ndata: {}\n\nevent: content_block_delta\ndata: {}\n\n', 'utf8')
  const events: readonly ResponseWireEvent[] = [
    { kind: 'headers', monotonic_ns: '11000000', bytes: Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 68\r\n\r\n', 'ascii') },
    { kind: 'body', monotonic_ns: '12000000', bytes: partial },
    { kind: 'terminal', monotonic_ns: '13000000', terminal: 'eof' },
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

  const bodyBeforeHeaders: readonly ResponseWireEvent[] = [events[1], events[0], events[2]]
  assert.throws(() => deriveResponseObservationFromWire(bodyBeforeHeaders, 1_000_000n, 10), (error: Error & { code?: string }) => error.code === 'receiver_wire_invalid')
  const afterTerminal: readonly ResponseWireEvent[] = [...events, { kind: 'body', monotonic_ns: '14000000', bytes: Buffer.from('late') }]
  assert.throws(() => deriveResponseObservationFromWire(afterTerminal, 1_000_000n, 10), (error: Error & { code?: string }) => error.code === 'receiver_wire_invalid')
})

test('targeted I2: every post-terminal not_executed receipt retains the exact failure binding', () => {
  const root = privateRoot('p3b-targeted-receipts-')
  const ledger = buildCampaignLedger('p3b-targeted-receipts')
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
    const receipt = writeReceipt(root, ledger, row, 'not_executed', previous, receiptFields({ launch_authority_sha256: failure.failure_sha256, terminal_class: 'not_executed', cause_code: 'first_terminal_global_stop' }))
    previous = String(receipt.receipt_sha256)
  }
  assert.equal(readExecutionReceipts(store).length, 342)

  const lastRow = ledger.rows.at(-1)!
  const relative = `execution-records/${String(lastRow.sequence_index).padStart(3, '0')}-${lastRow.run_id}-not_executed.json`
  const last = readExecutionReceipts(store).at(-1)!
  const forgedUnsigned = { ...last, launch_authority_sha256: 'c'.repeat(64) } as Record<string, unknown>
  delete forgedUnsigned.receipt_sha256
  const forged = { ...forgedUnsigned, receipt_sha256: sha256Canonical(forgedUnsigned) }
  writeFileSync(path.join(root, relative), `${canonicalJson(forged)}\n`, { encoding: 'utf8' })
  assert.throws(() => readExecutionReceipts(store), (error: Error & { code?: string }) => error.code === 'execution_receipt_invalid')
})
