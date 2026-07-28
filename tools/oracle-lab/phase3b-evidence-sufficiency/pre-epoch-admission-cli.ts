import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Phase3BProductionError, assertExactKeys, canonicalBytes, canonicalJson, sha256Canonical } from './core.js'
import { classifyPhase3BCampaignAttempt, evaluatePreEpochAdmission, PHASE3B_EPOCH_CONSUMPTION_POLICY, PHASE3B_EPOCH_CONSUMPTION_POLICY_SHA256, type PreEpochAdmissionInput } from './pre-epoch-admission.js'
import { stableRead, writeExclusiveBytes } from './sealed-fs.js'

const INPUT_KEYS = ['schema_id', 'campaign_container', 'cc_expected_head', 'cc_expected_tree', 'cc_repository', 'predecessor_config_auth_path', 'predecessor_failure_stream_path', 'receipt_path', 'sub_repository'] as const

function parseInput(file: string): PreEpochAdmissionInput {
  const { bytes } = stableRead(file, { mode: 0o600, maximumBytes: 1_048_576 })
  if (bytes.at(-1) !== 0x0a || bytes.subarray(0, -1).includes(0x0a)) throw new Phase3BProductionError('pre_epoch_admission_cli_invalid', 'input must be one canonical JSON line plus LF')
  let value: unknown
  try { value = JSON.parse(bytes.subarray(0, -1).toString('utf8')) } catch { throw new Phase3BProductionError('pre_epoch_admission_cli_invalid', 'input JSON is invalid') }
  assertExactKeys(value, INPUT_KEYS, 'pre_epoch_admission_cli_invalid')
  if (!canonicalBytes(value).equals(bytes.subarray(0, -1))) throw new Phase3BProductionError('pre_epoch_admission_cli_invalid', 'input is not canonical JSON')
  return value as PreEpochAdmissionInput
}

export function sealPreEpochAdmissionReceiptAt(input: PreEpochAdmissionInput, prepared: Readonly<Record<string, unknown>>, terminalNowMs: number): Readonly<Record<string, unknown>> {
  const expiryMs = Date.parse(String(prepared.predecessor_expiry))
  if (!Number.isSafeInteger(terminalNowMs) || terminalNowMs < 0 || !Number.isSafeInteger(expiryMs) || terminalNowMs >= expiryMs) throw new Phase3BProductionError('pre_epoch_predecessor_invalid', 'Phase 3A predecessor expired before admission receipt sealing')
  let attemptState: Readonly<Record<string, unknown>>
  try { attemptState = classifyPhase3BCampaignAttempt((prepared.attempt_state as Record<string, unknown> | undefined)?.counters) } catch { throw new Phase3BProductionError('pre_epoch_admission_result_invalid', 'prepared campaign attempt state is invalid') }
  const counters = attemptState.counters as Record<string, unknown>
  const topLevelCountersMatch = ['signer_starts', 'signer_signatures', 'materializer_runs', 'attestation_writes', 'authority_writes', 'official_namespaces', 'prelaunches', 'receiver_binds', 'target_launches', 'sockets'].every((key) => prepared[key] === counters[key])
  if (sha256Canonical(prepared.epoch_policy) !== PHASE3B_EPOCH_CONSUMPTION_POLICY_SHA256 || prepared.epoch_policy_sha256 !== PHASE3B_EPOCH_CONSUMPTION_POLICY_SHA256 || sha256Canonical(prepared.epoch_policy) !== sha256Canonical(PHASE3B_EPOCH_CONSUMPTION_POLICY) || sha256Canonical(prepared.attempt_state) !== sha256Canonical(attemptState) || prepared.attempt_state_sha256 !== attemptState.attempt_state_sha256 || attemptState.state !== 'PREPARING' || attemptState.epoch_consumed !== false || attemptState.fresh_preparation_allowed !== true || prepared.epoch_consumed !== false || prepared.campaign_id_generated !== false || !topLevelCountersMatch) throw new Phase3BProductionError('pre_epoch_admission_result_invalid', 'prepared epoch policy or campaign attempt state drifted')
  const unsigned = { ...prepared, schema_id: 'oracle-lab-p3b-pre-epoch-admission-result.v1', decision: 'PASS', checked_at_ms: terminalNowMs }
  delete (unsigned as Record<string, unknown>).predecessor_expiry
  const result = { ...unsigned, output_sha256: sha256Canonical(unsigned) }
  const receiptBytes = Buffer.concat([canonicalBytes(result), Buffer.from('\n')])
  let receipt
  try { receipt = writeExclusiveBytes(path.dirname(input.receipt_path), path.basename(input.receipt_path), receiptBytes, 0o600) } catch { throw new Phase3BProductionError('pre_epoch_admission_receipt_invalid', 'exclusive admission receipt write or reread failed') }
  return { schema_id: 'oracle-lab-p3b-pre-epoch-admission-seal.v1', decision: 'PASS', receipt_path: receipt.path, receipt_raw_sha256: receipt.sha256, receipt_size: receipt.size, receipt_mode: receipt.mode, receipt_nlink: receipt.nlink, admission_output_sha256: result.output_sha256, consumption_boundary: PHASE3B_EPOCH_CONSUMPTION_POLICY.consumption_boundary, epoch_policy_sha256: PHASE3B_EPOCH_CONSUMPTION_POLICY_SHA256, attempt_state: attemptState.state, attempt_state_sha256: attemptState.attempt_state_sha256, epoch_consumed: false, signer_starts: 0 }
}

export function sealPreEpochAdmissionReceipt(input: PreEpochAdmissionInput, prepared: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return sealPreEpochAdmissionReceiptAt(input, prepared, Date.now())
}

export function main(argv: readonly string[] = process.argv.slice(2)): void {
  if (argv.length !== 2 || argv[0] !== '--input' || !path.isAbsolute(argv[1]) || path.normalize(argv[1]) !== argv[1]) throw new Phase3BProductionError('pre_epoch_admission_cli_invalid', 'usage: pre-epoch-admission-cli.ts --input ABSOLUTE_PATH')
  const input = parseInput(argv[1])
  const prepared = evaluatePreEpochAdmission(input)
  process.stdout.write(`${canonicalJson(sealPreEpochAdmissionReceipt(input, prepared))}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { main() } catch (error: unknown) {
    const typed = error instanceof Phase3BProductionError ? error : new Phase3BProductionError('pre_epoch_admission_failed', (error as Error).message)
    process.stderr.write(`${canonicalJson({ code: typed.code, message: typed.message })}\n`)
    process.exitCode = 1
  }
}
