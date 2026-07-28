import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Phase3BProductionError, assertExactKeys, canonicalBytes, canonicalJson, sha256Canonical } from './core.js'
import { evaluatePreEpochAdmission, type PreEpochAdmissionInput } from './pre-epoch-admission.js'
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
  const unsigned = { ...prepared, schema_id: 'oracle-lab-p3b-pre-epoch-admission-result.v1', decision: 'PASS', checked_at_ms: terminalNowMs }
  delete (unsigned as Record<string, unknown>).predecessor_expiry
  const result = { ...unsigned, output_sha256: sha256Canonical(unsigned) }
  const receiptBytes = Buffer.concat([canonicalBytes(result), Buffer.from('\n')])
  let receipt
  try { receipt = writeExclusiveBytes(path.dirname(input.receipt_path), path.basename(input.receipt_path), receiptBytes, 0o600) } catch { throw new Phase3BProductionError('pre_epoch_admission_receipt_invalid', 'exclusive admission receipt write or reread failed') }
  return { schema_id: 'oracle-lab-p3b-pre-epoch-admission-seal.v1', decision: 'PASS', receipt_path: receipt.path, receipt_raw_sha256: receipt.sha256, receipt_size: receipt.size, receipt_mode: receipt.mode, receipt_nlink: receipt.nlink, admission_output_sha256: result.output_sha256, epoch_consumed: false, signer_starts: 0 }
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
