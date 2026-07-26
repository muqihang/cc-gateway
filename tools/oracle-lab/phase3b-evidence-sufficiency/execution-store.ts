import { Phase3BProductionError, assertDigestField, assertExactKeys, assertSha256, deepFreeze, sha256Canonical } from './core.js'
import { type CampaignLedger, type RunLedgerRow, validateCampaignLedger } from './ledger.js'
import { assertLaunchAuthority, type LaunchAuthorityReceipt } from './launch-authority.js'
import { createPrivateDirectory, readCanonical, writeExclusiveCanonical } from './sealed-fs.js'

export type ReceiptState = 'started' | 'spawned' | 'terminal' | 'not_executed'
export type TerminalClass = 'success' | 'spawn_error' | 'failed_after_spawn' | 'not_executed'

export type ExecutionReceipt = Readonly<{
  schema_id: 'oracle-lab-p3b-execution-receipt.v1'
  campaign_id: string
  ledger_sha256: string
  run_id: string
  sequence_index: number
  state: ReceiptState
  previous_receipt_sha256: string | null
  launch_authority_sha256: string | null
  triggering_terminal_receipt_sha256: string | null
  failure_sha256: string | null
  sandbox_pid: number | null
  target_pid: number | null
  executable_identity_sha256: string | null
  started_monotonic_ns: string | null
  terminal_monotonic_ns: string | null
  exit_code: number | null
  signal: string | null
  terminal_class: TerminalClass | null
  cause_code: string | null
  receipt_sha256: string
}>

export type ExecutionStore = Readonly<{ records_root: string; ledger_sha256: string; campaign_id: string }>

type CampaignFailure = Readonly<{
  schema_id: 'oracle-lab-p3b-campaign-failure.v1'
  campaign_id: string
  ledger_sha256: string
  failing_sequence_index: number
  failure_phase: 'before_spawn' | 'after_spawn'
  failure_family: string
  action: 'stop_all_target_launches'
  terminal_receipt_sha256: string | null
  failure_sha256: string
}>

const stores = new WeakMap<object, { runtimeRoot: string; ledger: CampaignLedger }>()
const PRE_SPAWN_FAILURE_CODES = new Set([
  'active_selection_invalid', 'campaign_input_invalid', 'controller_identity_invalid',
  'focused_suite_failed', 'guard_probe_failed', 'guard_profile_invalid',
  'implementation_review_failed', 'isolation_unavailable', 'launch_authority_invalid',
  'launch_image_drift', 'launch_image_invalid', 'launch_image_platform_invalid',
  'launch_image_signature_invalid', 'launch_ledger_invalid', 'launch_recipe_invalid',
  'operator_authority_invalid', 'operator_authority_stale', 'predecessor_expired',
  'predecessor_invalid', 'receiver_authority_invalid', 'receiver_not_loopback',
  'repository_authority_invalid', 'sealed_authority_file_drift', 'sealed_control_drift',
  'sealed_file_invalid', 'sealed_path_invalid', 'static_anchor_invalid',
] as const)

function classifyPreSpawnFailure(cause: unknown): string {
  if (!(cause instanceof Phase3BProductionError)) return 'campaign_execution_failure'
  return PRE_SPAWN_FAILURE_CODES.has(cause.code as (typeof PRE_SPAWN_FAILURE_CODES extends Set<infer T> ? T : never))
    ? cause.code
    : 'campaign_execution_failure'
}

export function openExecutionStore(runtimeRoot: string, ledgerValue: unknown): ExecutionStore {
  const ledger = validateCampaignLedger(ledgerValue)
  const recordsRoot = createPrivateDirectory(runtimeRoot, 'execution-records')
  const store = deepFreeze({ records_root: recordsRoot, ledger_sha256: ledger.ledger_sha256, campaign_id: ledger.campaign_id })
  stores.set(store, { runtimeRoot, ledger })
  readExecutionReceipts(store)
  return store
}

function stateOf(store: ExecutionStore): { runtimeRoot: string; ledger: CampaignLedger } {
  const state = stores.get(store as object)
  if (!state) throw new Phase3BProductionError('execution_store_invalid', 'opaque execution store is required')
  return state
}

function relative(row: RunLedgerRow, state: ReceiptState): string {
  return `execution-records/${String(row.sequence_index).padStart(3, '0')}-${row.run_id}-${state}.json`
}

function validateReceipt(value: Record<string, unknown>, row: RunLedgerRow, ledger: CampaignLedger, state: ReceiptState, previous: string | null): ExecutionReceipt {
  assertExactKeys(value, ['schema_id', 'campaign_id', 'ledger_sha256', 'run_id', 'sequence_index', 'state', 'previous_receipt_sha256', 'launch_authority_sha256', 'triggering_terminal_receipt_sha256', 'failure_sha256', 'sandbox_pid', 'target_pid', 'executable_identity_sha256', 'started_monotonic_ns', 'terminal_monotonic_ns', 'exit_code', 'signal', 'terminal_class', 'cause_code', 'receipt_sha256'], 'execution_receipt_invalid')
  assertDigestField(value, 'receipt_sha256', 'execution_receipt_invalid')
  if (value.schema_id !== 'oracle-lab-p3b-execution-receipt.v1' || value.campaign_id !== ledger.campaign_id || value.ledger_sha256 !== ledger.ledger_sha256 || value.run_id !== row.run_id || value.sequence_index !== row.sequence_index || value.state !== state || value.previous_receipt_sha256 !== previous) throw new Phase3BProductionError('execution_receipt_invalid', 'receipt ledger/order/chain binding drifted')
  return deepFreeze(value as ExecutionReceipt)
}

export function readExecutionReceipts(store: ExecutionStore): readonly ExecutionReceipt[] {
  const { runtimeRoot, ledger } = stateOf(store)
  const failure = readCampaignFailure(store)
  const receipts: ExecutionReceipt[] = []
  let previous: string | null = null
  let inFlight: number | null = null
  let inFlightAuthority: string | null = null
  let inFlightStarted: string | null = null
  let inFlightSpawned = false
  let nextSequence = 0
  let globallyStopped = false
  for (const row of ledger.rows) {
    for (const receiptState of ['started', 'spawned', 'terminal', 'not_executed'] as const) {
      let raw: Record<string, unknown>
      try { raw = readCanonical(runtimeRoot, relative(row, receiptState), 32_768).value } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
      const receipt = validateReceipt(raw, row, ledger, receiptState, previous)
      if (receiptState === 'started') {
        if (globallyStopped || inFlight !== null || row.sequence_index !== nextSequence || receipt.launch_authority_sha256 === null || receipt.triggering_terminal_receipt_sha256 !== null || receipt.failure_sha256 !== null || receipt.started_monotonic_ns === null || !/^\d+$/.test(receipt.started_monotonic_ns) || receipt.sandbox_pid !== null || receipt.target_pid !== null || receipt.executable_identity_sha256 !== null || receipt.terminal_monotonic_ns !== null || receipt.exit_code !== null || receipt.signal !== null || receipt.terminal_class !== null || receipt.cause_code !== null) throw new Phase3BProductionError('execution_not_serial', 'started receipt violates one-in-flight order or field closure')
        assertSha256(receipt.launch_authority_sha256, 'execution_receipt_invalid', 'launch_authority_sha256')
        inFlight = row.sequence_index
        inFlightAuthority = receipt.launch_authority_sha256
        inFlightStarted = receipt.started_monotonic_ns
        inFlightSpawned = false
      } else if (receiptState === 'spawned') {
        if (inFlight !== row.sequence_index || inFlightSpawned || receipt.launch_authority_sha256 !== inFlightAuthority || receipt.triggering_terminal_receipt_sha256 !== null || receipt.failure_sha256 !== null || receipt.started_monotonic_ns !== inFlightStarted || !Number.isSafeInteger(receipt.sandbox_pid) || Number(receipt.sandbox_pid) <= 0 || !Number.isSafeInteger(receipt.target_pid) || Number(receipt.target_pid) <= 0 || receipt.executable_identity_sha256 === null || receipt.terminal_monotonic_ns !== null || receipt.exit_code !== null || receipt.signal !== null || receipt.terminal_class !== null || receipt.cause_code !== null) throw new Phase3BProductionError('execution_receipt_invalid', 'spawned receipt has no exact owned start/PID identity or field closure')
        assertSha256(receipt.executable_identity_sha256, 'execution_receipt_invalid', 'executable_identity_sha256')
        inFlightSpawned = true
      } else if (receiptState === 'terminal') {
        const terminalClass = String(receipt.terminal_class)
        if (inFlight !== row.sequence_index || receipt.launch_authority_sha256 !== inFlightAuthority || receipt.triggering_terminal_receipt_sha256 !== null || receipt.failure_sha256 !== null || receipt.started_monotonic_ns !== inFlightStarted || !['success', 'spawn_error', 'failed_after_spawn'].includes(terminalClass) || receipt.terminal_monotonic_ns === null || !/^\d+$/.test(receipt.terminal_monotonic_ns) || BigInt(receipt.terminal_monotonic_ns) < BigInt(inFlightStarted!) || ((terminalClass === 'success' || terminalClass === 'failed_after_spawn') && !inFlightSpawned) || (terminalClass === 'success' ? receipt.cause_code !== null : typeof receipt.cause_code !== 'string') || receipt.sandbox_pid !== null || receipt.target_pid !== null || receipt.executable_identity_sha256 !== null) throw new Phase3BProductionError('execution_receipt_invalid', 'terminal receipt has no exact in-flight transition or field closure')
        inFlight = null
        inFlightAuthority = null
        inFlightStarted = null
        inFlightSpawned = false
        nextSequence += 1
        if (receipt.terminal_class !== 'success') globallyStopped = true
      } else {
        const firstNotExecuted = failure?.failure_phase === 'before_spawn' ? failure.failing_sequence_index : Number(failure?.failing_sequence_index) + 1
        const expectedTrigger = failure?.terminal_receipt_sha256 ?? null
        const expectedAuthority = failure ? notExecutedLaunchAuthoritySha256(ledger, row, failure.failure_sha256, expectedTrigger) : null
        if (!failure || row.sequence_index < firstNotExecuted || receipt.failure_sha256 !== failure.failure_sha256 || receipt.triggering_terminal_receipt_sha256 !== expectedTrigger || receipt.launch_authority_sha256 !== expectedAuthority) throw new Phase3BProductionError('execution_receipt_invalid', 'not_executed does not bind the sealed failure, trigger, and exact ledger row authority')
        if (failure.failure_phase === 'after_spawn') {
          const trigger = receipts.find((candidate) => candidate.receipt_sha256 === expectedTrigger)
          const postTerminalArtifactFailure = failure.failure_family === 'post_terminal_artifact_failure' && trigger?.terminal_class === 'success'
          if (!trigger || trigger.state !== 'terminal' || trigger.sequence_index !== failure.failing_sequence_index || (trigger.terminal_class === 'success' && !postTerminalArtifactFailure)) throw new Phase3BProductionError('execution_receipt_invalid', 'not_executed trigger is not the exact first terminal failure boundary')
        }
        if (!globallyStopped) globallyStopped = true
        if (inFlight !== null || row.sequence_index !== nextSequence || receipt.terminal_class !== 'not_executed' || receipt.started_monotonic_ns !== null || receipt.terminal_monotonic_ns !== null || receipt.sandbox_pid !== null || receipt.target_pid !== null || receipt.executable_identity_sha256 !== null || receipt.exit_code !== null || receipt.signal !== null || receipt.cause_code !== 'first_terminal_global_stop') throw new Phase3BProductionError('execution_receipt_invalid', 'not_executed must follow the first terminal failure with closed fields')
        nextSequence += 1
      }
      receipts.push(receipt)
      previous = receipt.receipt_sha256
    }
  }
  return deepFreeze(receipts)
}

export function readCampaignFailure(store: ExecutionStore): CampaignFailure | null {
  const { runtimeRoot, ledger } = stateOf(store)
  let value: Record<string, unknown>
  try { value = readCanonical(runtimeRoot, 'campaign-failure.json', 32_768).value } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  assertExactKeys(value, ['schema_id', 'campaign_id', 'ledger_sha256', 'failing_sequence_index', 'failure_phase', 'failure_family', 'action', 'terminal_receipt_sha256', 'failure_sha256'], 'campaign_failure_invalid')
  assertDigestField(value, 'failure_sha256', 'campaign_failure_invalid')
  if (value.failure_phase === 'after_spawn') assertSha256(value.terminal_receipt_sha256, 'campaign_failure_invalid', 'terminal_receipt_sha256')
  if (value.schema_id !== 'oracle-lab-p3b-campaign-failure.v1' || value.campaign_id !== ledger.campaign_id || value.ledger_sha256 !== ledger.ledger_sha256 || !['before_spawn', 'after_spawn'].includes(String(value.failure_phase)) || value.action !== 'stop_all_target_launches' || !Number.isSafeInteger(value.failing_sequence_index) || Number(value.failing_sequence_index) < 0 || Number(value.failing_sequence_index) >= 340 || typeof value.failure_family !== 'string' || !/^[a-z0-9_]{3,64}$/.test(value.failure_family) || (value.failure_phase === 'before_spawn' ? value.terminal_receipt_sha256 !== null : typeof value.terminal_receipt_sha256 !== 'string')) throw new Phase3BProductionError('campaign_failure_invalid', 'campaign failure fields drifted')
  return deepFreeze(value as CampaignFailure)
}

export function sealPreSpawnFailure(store: ExecutionStore, row: RunLedgerRow, cause: unknown): CampaignFailure {
  const failureFamily = classifyPreSpawnFailure(cause)
  const { runtimeRoot, ledger } = stateOf(store)
  if (ledger.rows[row.sequence_index]?.row_sha256 !== row.row_sha256 || readCampaignFailure(store) !== null || readExecutionReceipts(store).some((receipt) => receipt.sequence_index >= row.sequence_index)) throw new Phase3BProductionError('campaign_failure_invalid', 'pre-spawn failure ordinal is invalid')
  const unsigned = { schema_id: 'oracle-lab-p3b-campaign-failure.v1' as const, campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, failing_sequence_index: row.sequence_index, failure_phase: 'before_spawn' as const, failure_family: failureFamily, action: 'stop_all_target_launches' as const, terminal_receipt_sha256: null }
  const failure = deepFreeze({ ...unsigned, failure_sha256: sha256Canonical(unsigned) })
  writeExclusiveCanonical(runtimeRoot, 'campaign-failure.json', failure)
  let previous = readExecutionReceipts(store).at(-1)?.receipt_sha256 ?? null
  for (const remaining of ledger.rows.slice(row.sequence_index)) {
    previous = appendAfter(store, remaining, 'not_executed', { ...blankFields(), launch_authority_sha256: notExecutedLaunchAuthoritySha256(ledger, remaining, failure.failure_sha256, null), failure_sha256: failure.failure_sha256, terminal_class: 'not_executed', cause_code: 'first_terminal_global_stop' }, previous).receipt_sha256
  }
  return failure
}

function appendAfter(store: ExecutionStore, row: RunLedgerRow, state: ReceiptState, fields: Omit<ExecutionReceipt, 'schema_id' | 'campaign_id' | 'ledger_sha256' | 'run_id' | 'sequence_index' | 'state' | 'previous_receipt_sha256' | 'receipt_sha256'>, previousReceiptSha256: string | null): ExecutionReceipt {
  const { runtimeRoot, ledger } = stateOf(store)
  const exact = ledger.rows[row.sequence_index]
  if (!exact || exact.row_sha256 !== row.row_sha256) throw new Phase3BProductionError('execution_receipt_invalid', 'row is not from the immutable ledger')
  const unsigned = {
    schema_id: 'oracle-lab-p3b-execution-receipt.v1' as const,
    campaign_id: ledger.campaign_id,
    ledger_sha256: ledger.ledger_sha256,
    run_id: row.run_id,
    sequence_index: row.sequence_index,
    state,
    previous_receipt_sha256: previousReceiptSha256,
    ...fields,
  }
  const receipt = deepFreeze({ ...unsigned, receipt_sha256: sha256Canonical(unsigned) })
  writeExclusiveCanonical(runtimeRoot, relative(row, state), receipt)
  return validateReceipt(readCanonical(runtimeRoot, relative(row, state), 32_768).value, exact, ledger, state, unsigned.previous_receipt_sha256)
}

function append(store: ExecutionStore, row: RunLedgerRow, state: ReceiptState, fields: Omit<ExecutionReceipt, 'schema_id' | 'campaign_id' | 'ledger_sha256' | 'run_id' | 'sequence_index' | 'state' | 'previous_receipt_sha256' | 'receipt_sha256'>): ExecutionReceipt {
  return appendAfter(store, row, state, fields, readExecutionReceipts(store).at(-1)?.receipt_sha256 ?? null)
}

function blankFields(): Pick<ExecutionReceipt, 'triggering_terminal_receipt_sha256' | 'failure_sha256' | 'sandbox_pid' | 'target_pid' | 'executable_identity_sha256' | 'started_monotonic_ns' | 'terminal_monotonic_ns' | 'exit_code' | 'signal' | 'terminal_class' | 'cause_code'> {
  return { triggering_terminal_receipt_sha256: null, failure_sha256: null, sandbox_pid: null, target_pid: null, executable_identity_sha256: null, started_monotonic_ns: null, terminal_monotonic_ns: null, exit_code: null, signal: null, terminal_class: null, cause_code: null }
}

function notExecutedLaunchAuthoritySha256(ledger: CampaignLedger, row: RunLedgerRow, failureSha256: string, triggeringTerminalReceiptSha256: string | null): string {
  return sha256Canonical({ schema_id: 'oracle-lab-p3b-not-executed-launch-authority.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, run_id: row.run_id, sequence_index: row.sequence_index, row_sha256: row.row_sha256, failure_sha256: failureSha256, triggering_terminal_receipt_sha256: triggeringTerminalReceiptSha256 })
}

export function appendStarted(store: ExecutionStore, row: RunLedgerRow, authority: LaunchAuthorityReceipt): ExecutionReceipt {
  assertLaunchAuthority(authority, row)
  const launchAuthoritySha256 = authority.receipt_sha256
  const receipts = readExecutionReceipts(store)
  const completedRows = new Set(receipts.filter((receipt) => receipt.state === 'terminal' || receipt.state === 'not_executed').map((receipt) => receipt.sequence_index))
  if (row.sequence_index !== completedRows.size || receipts.some((receipt) => receipt.state === 'started' && !receipts.some((candidate) => candidate.sequence_index === receipt.sequence_index && candidate.state === 'terminal'))) throw new Phase3BProductionError('execution_not_serial', 'started row is not the exact next one-in-flight row')
  return append(store, row, 'started', { ...blankFields(), launch_authority_sha256: launchAuthoritySha256, started_monotonic_ns: process.hrtime.bigint().toString() })
}

export function appendSpawned(store: ExecutionStore, row: RunLedgerRow, authority: LaunchAuthorityReceipt, sandboxPid: number, targetPid: number, executableIdentitySha256: string): ExecutionReceipt {
  assertLaunchAuthority(authority, row)
  const launchAuthoritySha256 = authority.receipt_sha256
  assertSha256(executableIdentitySha256, 'execution_receipt_invalid', 'executable identity')
  if (![sandboxPid, targetPid].every((pid) => Number.isSafeInteger(pid) && pid > 0)) throw new Phase3BProductionError('execution_receipt_invalid', 'OS PIDs are invalid')
  const started = readExecutionReceipts(store).at(-1)
  if (started?.state !== 'started' || started.run_id !== row.run_id || started.launch_authority_sha256 !== launchAuthoritySha256) throw new Phase3BProductionError('execution_receipt_invalid', 'spawned does not bind the immediately preceding start')
  return append(store, row, 'spawned', { ...blankFields(), launch_authority_sha256: launchAuthoritySha256, sandbox_pid: sandboxPid, target_pid: targetPid, executable_identity_sha256: executableIdentitySha256, started_monotonic_ns: started.started_monotonic_ns })
}

export function appendTerminal(store: ExecutionStore, row: RunLedgerRow, authority: LaunchAuthorityReceipt, result: Readonly<{ terminalClass: Exclude<TerminalClass, 'not_executed'>; exitCode: number | null; signal: string | null; causeCode: string | null }>): ExecutionReceipt {
  assertLaunchAuthority(authority, row)
  const launchAuthoritySha256 = authority.receipt_sha256
  const receipts = readExecutionReceipts(store)
  const started = [...receipts].reverse().find((receipt) => receipt.run_id === row.run_id && receipt.state === 'started')
  if (!started || started.launch_authority_sha256 !== launchAuthoritySha256 || receipts.at(-1)?.run_id !== row.run_id) throw new Phase3BProductionError('execution_receipt_invalid', 'terminal does not bind current in-flight row')
  const receipt = append(store, row, 'terminal', { ...blankFields(), launch_authority_sha256: launchAuthoritySha256, started_monotonic_ns: started.started_monotonic_ns, terminal_monotonic_ns: process.hrtime.bigint().toString(), exit_code: result.exitCode, signal: result.signal, terminal_class: result.terminalClass, cause_code: result.causeCode })
  if (result.terminalClass !== 'success') {
    const { runtimeRoot, ledger } = stateOf(store)
    const unsigned = { schema_id: 'oracle-lab-p3b-campaign-failure.v1' as const, campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, failing_sequence_index: row.sequence_index, failure_phase: 'after_spawn' as const, failure_family: result.terminalClass, action: 'stop_all_target_launches' as const, terminal_receipt_sha256: receipt.receipt_sha256 }
    const failure = { ...unsigned, failure_sha256: sha256Canonical(unsigned) }
    writeExclusiveCanonical(runtimeRoot, 'campaign-failure.json', failure)
    appendNotExecuted(store, row.sequence_index, receipt.receipt_sha256, failure.failure_sha256)
  }
  return receipt
}

export function sealSyntheticSuccessReceipts(store: ExecutionStore): readonly ExecutionReceipt[] {
  const state = stateOf(store)
  let previous = readExecutionReceipts(store).at(-1)?.receipt_sha256 ?? null
  if (previous !== null) throw new Phase3BProductionError('execution_store_invalid', 'synthetic receipt dry-run requires an empty execution store')
  for (const row of state.ledger.rows) {
    const launchAuthoritySha256 = sha256Canonical({ schema_id: 'oracle-lab-p3b-synthetic-launch-authority.v1', campaign_id: state.ledger.campaign_id, run_id: row.run_id, sequence_index: row.sequence_index, row_sha256: row.row_sha256 })
    const startedMonotonicNs = String(1_000_000_000n + BigInt(row.sequence_index) * 10_000n)
    const started = appendAfter(store, row, 'started', { ...blankFields(), launch_authority_sha256: launchAuthoritySha256, started_monotonic_ns: startedMonotonicNs }, previous)
    const spawned = appendAfter(store, row, 'spawned', { ...blankFields(), launch_authority_sha256: launchAuthoritySha256, sandbox_pid: 20_000 + row.sequence_index, target_pid: 30_000 + row.sequence_index, executable_identity_sha256: 'a'.repeat(64), started_monotonic_ns: started.started_monotonic_ns }, started.receipt_sha256)
    const terminal = appendAfter(store, row, 'terminal', { ...blankFields(), launch_authority_sha256: launchAuthoritySha256, started_monotonic_ns: started.started_monotonic_ns, terminal_monotonic_ns: String(BigInt(startedMonotonicNs) + 5_000n), exit_code: 0, signal: null, terminal_class: 'success', cause_code: null }, spawned.receipt_sha256)
    previous = terminal.receipt_sha256
  }
  return readExecutionReceipts(store)
}

export function sealPostTerminalFailure(store: ExecutionStore, row: RunLedgerRow, cause: unknown): CampaignFailure {
  const { runtimeRoot, ledger } = stateOf(store)
  const receipts = readExecutionReceipts(store)
  const terminal = receipts.find((receipt) => receipt.sequence_index === row.sequence_index && receipt.state === 'terminal')
  if (!terminal || terminal.terminal_class !== 'success' || receipts.some((receipt) => receipt.sequence_index > row.sequence_index) || readCampaignFailure(store) !== null) throw new Phase3BProductionError('campaign_failure_invalid', 'post-terminal failure does not bind the latest successful terminal row')
  const classified = classifyPreSpawnFailure(cause)
  const failureFamily = classified === 'campaign_execution_failure' ? 'post_terminal_artifact_failure' : classified
  const unsigned = { schema_id: 'oracle-lab-p3b-campaign-failure.v1' as const, campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, failing_sequence_index: row.sequence_index, failure_phase: 'after_spawn' as const, failure_family: failureFamily, action: 'stop_all_target_launches' as const, terminal_receipt_sha256: terminal.receipt_sha256 }
  const failure = deepFreeze({ ...unsigned, failure_sha256: sha256Canonical(unsigned) })
  writeExclusiveCanonical(runtimeRoot, 'campaign-failure.json', failure)
  appendNotExecuted(store, row.sequence_index, terminal.receipt_sha256, failure.failure_sha256)
  return failure
}

function appendNotExecuted(store: ExecutionStore, failingIndex: number, failureReceiptSha256: string, failureBindingSha256: string): void {
  assertSha256(failureReceiptSha256, 'execution_receipt_invalid', 'failure receipt')
  assertSha256(failureBindingSha256, 'execution_receipt_invalid', 'failure binding')
  const { ledger } = stateOf(store)
  let previous: string | null = failureReceiptSha256
  for (const row of ledger.rows.slice(failingIndex + 1)) {
    previous = appendAfter(store, row, 'not_executed', { ...blankFields(), launch_authority_sha256: notExecutedLaunchAuthoritySha256(ledger, row, failureBindingSha256, failureReceiptSha256), triggering_terminal_receipt_sha256: failureReceiptSha256, failure_sha256: failureBindingSha256, terminal_class: 'not_executed', cause_code: 'first_terminal_global_stop' }, previous).receipt_sha256
  }
}

export function deriveExecutionCounts(store: ExecutionStore): Readonly<Record<'planned' | 'started' | 'spawned' | 'terminal' | 'not_executed', number>> {
  const receipts = readExecutionReceipts(store)
  return deepFreeze({ planned: stateOf(store).ledger.rows.length, started: receipts.filter((row) => row.state === 'started').length, spawned: receipts.filter((row) => row.state === 'spawned').length, terminal: receipts.filter((row) => row.state === 'terminal').length, not_executed: receipts.filter((row) => row.state === 'not_executed').length })
}
