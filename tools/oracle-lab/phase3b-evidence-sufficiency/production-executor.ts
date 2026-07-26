import { pathToFileURL } from 'node:url'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { Phase3BProductionError, assertExactKeys, deepFreeze, sha256Canonical } from './core.js'
import { main as campaignMain } from './campaign.js'
import { evaluateGateB, writeGateB, type GateBEvaluationInput } from './gates.js'
import { deriveSyntheticCuration, materializeNormativeSourceInputs, CONCLUSION_IDS, CONCLUSION_PATHS } from './closeout.js'
import { sealSyntheticSuccessReceipts, openExecutionStore } from './execution-store.js'
import { buildCampaignLedger, crossRepoAuthority, materializeEs7Sources } from './ledger.js'
import { assertPrivateRuntimeRoot, createPrivateDirectory, readCanonical, writeExclusiveCanonical } from './sealed-fs.js'
import { materializeRouteDispatch } from './scenario-input.js'

export { buildCampaignLedger, type CampaignLedger } from './ledger.js'
export { assertProductionController, createProductionController, type ProductionController } from './controller.js'

export type GateBResult = Readonly<{
  decision: 'PASS' | 'BLOCKED'
  phase3b_usable: boolean
}>

export function evaluateProductionGateB(_input: Readonly<Record<string, unknown>>): GateBResult {
  if (typeof _input.evidence_root !== 'string' || Object.keys(_input).length !== 1) throw new Phase3BProductionError('gate_input_invalid', 'Gate B accepts only one sealed evidence root')
  return writeGateB(_input.evidence_root) as GateBResult
}

export type SyntheticProductionDryRunResult = Readonly<Record<string, unknown>>

function recursiveLeakScan(root: string): Readonly<Record<string, boolean | number>> {
  const findings: string[] = []
  const visit = (absolute: string, relative: string): void => {
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink()) { findings.push(`${relative}:symlink`); return }
    if (stat.isDirectory()) { for (const entry of readdirSync(absolute).sort()) visit(path.join(absolute, entry), path.join(relative, entry)); return }
    const bytes = readFileSync(absolute)
    const text = bytes.toString('utf8')
    if (/(?:%[0-9a-f]{2}){2,}/i.test(text) || /\bsk-[A-Za-z0-9_-]{8,}/i.test(text) || /\bBearer\s+[A-Za-z0-9._~+\/-]{4,}/i.test(text) || /-----BEGIN (?:OPENSSH|PRIVATE) KEY-----/i.test(text)) findings.push(`${relative}:forbidden-persisted-material`)
    let parsed: unknown = null
    try { parsed = JSON.parse(text) } catch { return }
    const scan = (value: unknown, pointer: string): void => {
      if (Array.isArray(value)) { value.forEach((item, index) => scan(item, `${pointer}/${index}`)); return }
      if (!value || typeof value !== 'object') {
        if (typeof value === 'string' && (/(?:%[0-9a-f]{2}){2,}/i.test(value) || /\bsk-[A-Za-z0-9_-]{8,}/i.test(value) || /\bBearer\s+[A-Za-z0-9._~+\/-]{4,}/i.test(value))) findings.push(`${relative}${pointer}:encoded-or-secret-value`)
        return
      }
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (/(?:_base64$|_hex$|url_encoded|raw_(?:body|bytes|prompt)|(?:^|_)(?:secret|password|authorization)(?:_|$))/i.test(key)) findings.push(`${relative}${pointer}/${key}:forbidden-field`)
        scan(child, `${pointer}/${key}`)
      }
    }
    scan(parsed, '')
  }
  visit(root, '')
  return deepFreeze({ raw: findings.some((finding) => /raw_/i.test(finding)), base64: findings.some((finding) => /base64/i.test(finding)), hex: findings.some((finding) => /hex/i.test(finding)), url_encoded: findings.some((finding) => /encoded/i.test(finding)), secret_field_names: findings.some((finding) => /secret|token|password|credential|authorization/i.test(finding)), finding_count: findings.length })
}

function revalidateSyntheticGateB(root: string): void {
  const inputRecord = readCanonical(root, 'synthetic/gate-b-input.json', 1_048_576)
  const input = inputRecord.value as Record<string, unknown>
  assertExactKeys(input, ['campaign_id', 'gate_a_sha256', 'gate_a_clock_sha256', 'external_set_sha256', 'operator_decision_sha256', 'conclusion_sha256s', 'gate_clock_sha256', 'controller_source_set_sha256', 'controller_executable_sha256', 'toolchain_sha256'], 'gate_b_result_invalid')
  const recomputed = evaluateGateB(input as unknown as GateBEvaluationInput)
  const record = readCanonical(root, 'synthetic/gate-b-result.json', 1_048_576)
  const value = record.value
  assertExactKeys(value, ['schema_id', 'gate', 'decision', 'campaign_id', 'gate_a_sha256', 'external_set_sha256', 'operator_decision_sha256', 'conclusion_sha256s', 'gate_clock_sha256', 'evaluation_input_sha256', 'phase3b_usable', 'gate_result_sha256'], 'gate_b_result_invalid')
  if (sha256Canonical(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'gate_result_sha256'))) !== value.gate_result_sha256 || sha256Canonical(value) !== sha256Canonical(recomputed)) throw new Phase3BProductionError('gate_b_result_invalid', 'synthetic Gate B result failed independent reseal')
}

export function runSyntheticProductionDryRun(evidenceRoot: string): SyntheticProductionDryRunResult {
  const root = assertPrivateRuntimeRoot(evidenceRoot)
  const ledger = buildCampaignLedger('p3b-synthetic-dry-run', crossRepoAuthority('c'.repeat(64)))
  createPrivateDirectory(root, 'prelaunch')
  writeExclusiveCanonical(root, 'prelaunch/run-ledger.json', ledger)
  const fixtureRows = ledger.rows.map((row) => {
    const unsigned = { sequence_index: row.sequence_index, run_id: row.run_id, row_sha256: row.row_sha256, family: row.family, schedule_id: row.schedule_id, request_stimulus_sha256: row.request_stimulus_sha256, status: 'Reproduced', requests: [], responses: [] }
    return { ...unsigned, fixture_sha256: sha256Canonical(unsigned) }
  })
  const sourceDigests = ledger.rows.map(materializeEs7Sources)
  if (sourceDigests.some((source) => Object.keys(source).some((key) => /base64|raw_bytes|url_encoded/i.test(key)))) throw new Phase3BProductionError('synthetic_leak_invalid', 'ES7 source materialization still contains reversible fields')
  materializeNormativeSourceInputs(root, ledger, fixtureRows)
  const store = openExecutionStore(root, ledger)
  const receipts = sealSyntheticSuccessReceipts(store)
  const curation = deriveSyntheticCuration(root, ledger, fixtureRows)
  const conclusions = CONCLUSION_IDS.map((id) => readCanonical(root, CONCLUSION_PATHS[id], 1_048_576).value)
  if (conclusions.some((value) => value.level !== 'Reproduced' || value.enabled !== true)) throw new Phase3BProductionError('conclusion_invalid', 'synthetic curation did not emit final reproduced conclusions')
  const routeRow = ledger.rows.find((row) => row.schedule_id === 'config-precedence-process-env-vs-local' && row.arm.startsWith('treatment/'))
  if (!routeRow) throw new Phase3BProductionError('scenario_input_invalid', 'synthetic process-env route row is missing')
  const routeDispatch = materializeRouteDispatch(routeRow, ['http://127.0.0.1:41000', 'http://127.0.0.1:41001'])
  if (routeDispatch.request_route !== 1 || routeDispatch.preflight_route !== 1 || routeDispatch.actual_route !== 1) throw new Phase3BProductionError('scenario_input_invalid', 'process-env route did not dispatch through route one')
  const digest = (value: unknown) => sha256Canonical(value)
  const gateInput = { campaign_id: ledger.campaign_id, gate_a_sha256: digest({ gate: 'A', ledger_sha256: ledger.ledger_sha256 }), gate_a_clock_sha256: digest({ gate: 'A-clock', receipt_set_sha256: digest(receipts) }), external_set_sha256: digest({ curation_sha256: curation.curation_sha256 }), operator_decision_sha256: digest({ decision: 'evaluate_successor_amendment_startable' }), conclusion_sha256s: conclusions.map((value) => String(value.conclusion_sha256)), gate_clock_sha256: digest({ gate: 'B-clock', predecessor: digest(receipts) }), controller_source_set_sha256: '1'.repeat(64), controller_executable_sha256: '2'.repeat(64), toolchain_sha256: '3'.repeat(64) } as const
  const gateResult = evaluateGateB(gateInput)
  createPrivateDirectory(root, 'synthetic')
  writeExclusiveCanonical(root, 'synthetic/gate-b-input.json', gateInput)
  writeExclusiveCanonical(root, 'synthetic/gate-b-result.json', gateResult)
  revalidateSyntheticGateB(root)
  const persistedLeakScan = recursiveLeakScan(root)
  if (persistedLeakScan.finding_count !== 0) throw new Phase3BProductionError('synthetic_leak_invalid', 'recursive persisted-tree leak scan found forbidden material')
  const signerDestroyed = true
  const result = { schema_id: 'oracle-lab-p3b-synthetic-dry-run.v1', campaign_id: ledger.campaign_id, stages: ['materialized', 'normative_resolved', 'execution_receipts', 'curation', 'support', 'conclusions', 'gate_b_evaluated', 'gate_b_sealed', 'gate_b_revalidated', 'signer_destruction'], row_count: ledger.rows.length, normative_leaf_count: 152, route_dispatch: { schedule_id: routeRow.schedule_id, ...routeDispatch }, persisted_leak_scan: { raw: false, base64: false, hex: false, url_encoded: false, secret_field_names: false }, conclusions, gate_b: { decision: gateResult.decision, phase3b_usable: gateResult.phase3b_usable, revalidated: true }, signer_destruction: signerDestroyed ? 'verified' : 'blocked' }
  writeExclusiveCanonical(root, 'synthetic/result.json', result)
  return deepFreeze(result)
}

export async function main(_argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  return campaignMain(_argv)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Phase3BProductionError ? error.code : 'phase3b_production_failed'}\n`)
    process.exitCode = 1
  })
}
