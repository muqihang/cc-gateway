import { pathToFileURL } from 'node:url'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { Phase3BProductionError, canonicalBytes, deepFreeze, sha256Bytes, sha256Canonical } from './core.js'
import { main as campaignMain } from './campaign.js'
import { evaluateGateB, writeGateB, type GateBEvaluationInput } from './gates.js'
import { deriveCuration, runCloseout, CONCLUSION_IDS, CONCLUSION_PATHS } from './closeout.js'
import { appendAdapterRowStartedSpawned, appendAdapterRowTerminal, openExecutionStore, readExecutionReceipts } from './execution-store.js'
import { buildCampaignLedger, crossRepoAuthority, materializeEs7Sources, observationCoverageMatrix } from './ledger.js'
import { buildEs7TypedFixtureContract, buildEs8TsAgreement, buildEs9CoverageContract } from './authority-materializer.js'
import { createProductionController, assertProductionController } from './controller.js'
import { deriveAdapterLaunchAuthority } from './launch-authority.js'
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

export type ProductionDryRunAdapters = Readonly<{
  clock: Readonly<{ wallMs: () => number; monotonicNs: () => bigint }>
  targetTransport: Readonly<{ dispatch: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>> }>
  signer: Readonly<{ destroyAfterVerified: (input: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>> }>
  trace?: (stage: string) => void
}>

export async function runProductionCampaignDryRun(_evidenceRoot: string, _adapters: ProductionDryRunAdapters): Promise<SyntheticProductionDryRunResult> {
  return runProductionCampaignDryRunAsync(_evidenceRoot, _adapters)
}

async function runProductionCampaignDryRunAsync(evidenceRoot: string, adapters: ProductionDryRunAdapters): Promise<SyntheticProductionDryRunResult> {
  const root = assertPrivateRuntimeRoot(evidenceRoot)
  const trace = (stage: string) => adapters.trace?.(stage)
  const c1Record = { schema_id: 'oracle.cross_repo_record', review: { cross: { task_id: 'phase3b-production-dry-run', model: 'gpt-5.6-sol', artifact_sha256: 'a'.repeat(64), critical: 0, important: 0, verdict: 'CROSS_REPO_PASS' } } }
  const c1Raw = Buffer.concat([canonicalBytes(c1Record), Buffer.from('\n', 'utf8')])
  const c1Digest = sha256Bytes(c1Raw)
  const authority = crossRepoAuthority(c1Digest)
  const ledger = buildCampaignLedger('p3b-production-dry-run', authority)
  createPrivateDirectory(root, 'prelaunch')
  writeExclusiveCanonical(root, 'prelaunch/run-ledger.json', ledger)
  trace('materialize')
  materializeControlArtifacts(root, ledger, c1Record, c1Raw)
  const controller = createProductionController({ campaign_id: ledger.campaign_id, c1: authority })
  assertProductionController(controller)
  const store = openExecutionStore(root, ledger)
  const transportRows: Readonly<Record<string, unknown>>[] = []
  const dispatchDigests: string[] = []
  const routeUrls = ['http://127.0.0.1:41000', 'http://127.0.0.1:41001'] as const
  const previousBaseUrl = process.env.ANTHROPIC_BASE_URL
  process.env.ANTHROPIC_BASE_URL = routeUrls[1]
  trace('execute')
  try {
    let previousReceiptSha256: string | null = null
    for (const row of ledger.rows) {
      const launchAuthority = deriveAdapterLaunchAuthority(controller, row)
      const transition = appendAdapterRowStartedSpawned(store, row, launchAuthority, previousReceiptSha256)
      const route = row.schedule_id === 'config-precedence-process-env-vs-local' ? materializeRouteDispatch(row, routeUrls) : null
      const response = await adapters.targetTransport.dispatch({ sequence_index: row.sequence_index, run_id: row.run_id, schedule_id: row.schedule_id, request_route: route?.request_route ?? 0, preflight_route: route?.preflight_route ?? null, selected_url: route?.selected_url ?? routeUrls[0] })
      const dispatchDigest = sha256Canonical(response)
      dispatchDigests.push(dispatchDigest)
      const terminal = appendAdapterRowTerminal(store, row, launchAuthority, transition.started, transition.spawned)
      previousReceiptSha256 = terminal.receipt_sha256
      const source = materializeEs7Sources(row)
      const unsigned = { sequence_index: row.sequence_index, run_id: row.run_id, row_sha256: row.row_sha256, family: row.family, schedule_id: row.schedule_id, request_stimulus_sha256: row.request_stimulus_sha256, status: 'Reproduced', contract_request_source_sha256: source.request_source_sha256, contract_response_source_sha256: source.response_source_sha256, requests: [], responses: [], transport_receipt_sha256: dispatchDigest }
      transportRows.push({ ...unsigned, fixture_sha256: sha256Canonical(unsigned) })
    }
  } finally {
    if (previousBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = previousBaseUrl
  }
  const receipts = readExecutionReceipts(store)
  createPrivateDirectory(root, 'production')
  const transportIdentity = writeExclusiveCanonical(root, 'production/transport-results.json', { schema_id: 'oracle-lab-p3b-transport-results.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, receipt_set_sha256: sha256Canonical(receipts), rows: transportRows, rows_sha256: sha256Canonical(transportRows), dispatch_digests: dispatchDigests })
  const sourceRecords = buildTransportSourceRecords(ledger, transportIdentity.sha256, transportRows)
  const curation = deriveCuration(root, { fixtureRows: transportRows, receipt_set_sha256: sha256Canonical(receipts), sourceRecords })
  trace('curation')
  trace('conclusions')
  const closeout = runCloseout(root)
  const conclusions = CONCLUSION_IDS.map((id) => readCanonical(root, CONCLUSION_PATHS[id], 1_048_576).value)
  const leak = readCanonical(root, 'capsules/P3B-ES1/closure/leak-report.json', 1_048_576).value
  const routeRow = ledger.rows.find((row) => row.schedule_id === 'config-precedence-process-env-vs-local' && row.arm.startsWith('treatment/'))
  if (!routeRow) throw new Phase3BProductionError('scenario_input_invalid', 'process-env route row is missing from the production ledger')
  const routeDispatch = materializeRouteDispatch(routeRow, routeUrls)
  const gateA = { schema_id: 'oracle-lab-p3b-dry-run-gate-a.v1', campaign_id: ledger.campaign_id, decision: 'PASS', curation_sha256: curation.curation_sha256, closeout_sha256: closeout.external_set_sha256, support_status: 'PASS', leak_status: leak.status, conclusion_sha256s: conclusions.map((value) => String(value.conclusion_sha256)) }
  writeExclusiveCanonical(root, 'production/gate-a.json', gateA)
  const nowWall = adapters.clock.wallMs()
  const nowMono = adapters.clock.monotonicNs().toString()
  const gateInput = { campaign_id: ledger.campaign_id, gate_a_sha256: sha256Canonical(gateA), gate_a_clock_sha256: sha256Canonical({ gate: 'A', wall_ms: nowWall, monotonic_ns: nowMono }), external_set_sha256: String(closeout.external_set_sha256), operator_decision_sha256: sha256Canonical({ decision: 'offline-test-authority', campaign_id: ledger.campaign_id }), conclusion_sha256s: conclusions.map((value) => String(value.conclusion_sha256)), gate_clock_sha256: sha256Canonical({ gate: 'B', wall_ms: nowWall, monotonic_ns: nowMono }), controller_source_set_sha256: sha256Canonical({ controller: 'production-controller', campaign_id: ledger.campaign_id }), controller_executable_sha256: sha256Canonical({ executable: 'offline-adapter' }), toolchain_sha256: sha256Canonical({ toolchain: 'node-test-adapter' }), support_status: 'PASS' as const, leak_status: leak.status as 'PASS' | 'BLOCKED', leak_finding_count: Array.isArray(leak.findings) ? leak.findings.length : -1, conclusion_states: conclusions.map((value) => ({ level: value.level, enabled: value.enabled, contradiction_count: Array.isArray(value.contradiction_ids) ? value.contradiction_ids.length : -1 })), evaluation_wall_clock_ms: nowWall, issued_wall_clock_ms: nowWall, evaluation_monotonic_ns: nowMono, issued_monotonic_ns: nowMono }
  writeExclusiveCanonical(root, 'production/gate-b-input.json', gateInput)
  trace('gate-a')
  trace('gate-b-evaluate')
  const gateResult = evaluateGateB(gateInput)
  writeExclusiveCanonical(root, 'production/gate-b-result.json', gateResult)
  trace('gate-b-seal')
  const sealedInput = readCanonical(root, 'production/gate-b-input.json').value as unknown as GateBEvaluationInput
  const sealedResult = readCanonical(root, 'production/gate-b-result.json').value
  const revalidated = evaluateGateB(sealedInput)
  if (sha256Canonical(sealedResult) !== sha256Canonical(revalidated)) throw new Phase3BProductionError('gate_b_result_invalid', 'sealed production Gate B result failed independent re-evaluation')
  trace('gate-b-validate')
  const signerResult = adapters.signer.destroyAfterVerified({ gate_b_result_sha256: String(sealedResult.gate_result_sha256), gate_b_input_sha256: sha256Canonical(sealedInput), verified: true })
  if (signerResult.destroyed !== true) throw new Phase3BProductionError('signer_lifecycle_invalid', 'signer adapter did not destroy only after sealed Gate B verification')
  trace('signer-destroy')
  const persistedLeakScan = recursiveLeakScan(root)
  if (persistedLeakScan.finding_count !== 0) throw new Phase3BProductionError('synthetic_leak_invalid', 'recursive persisted-tree leak scan found forbidden material')
  const result = { schema_id: 'oracle-lab-p3b-synthetic-dry-run.v1', campaign_id: ledger.campaign_id, stages: ['materialized', 'normative_resolved', 'execution_receipts', 'curation', 'support', 'conclusions', 'gate_b_evaluated', 'gate_b_sealed', 'gate_b_revalidated', 'signer_destruction'], row_count: ledger.rows.length, normative_leaf_count: 152, route_dispatch: { schedule_id: routeRow.schedule_id, ...routeDispatch }, persisted_leak_scan: { raw: false, base64: false, hex: false, url_encoded: false, secret_field_names: false }, conclusions, gate_b: { decision: gateResult.decision, phase3b_usable: gateResult.phase3b_usable, revalidated: true }, signer_destruction: 'verified' }
  createPrivateDirectory(root, 'synthetic')
  writeExclusiveCanonical(root, 'synthetic/result.json', result)
  return deepFreeze(result)
}

function materializeControlArtifacts(root: string, ledger: ReturnType<typeof buildCampaignLedger>, c1Record: Readonly<Record<string, unknown>>, c1Raw: Buffer): void {
  createPrivateDirectory(root, 'control')
  const c1Identity = writeExclusiveCanonical(root, 'control/cross-repo-review.json', c1Record)
  if (c1Identity.sha256 !== sha256Bytes(c1Raw)) throw new Phase3BProductionError('authority_materialization_invalid', 'C1 raw record identity drifted')
  const goUnsigned = { schema_id: 'oracle.sub_contract_receipt', schema_major: 1, schema_revision: 0, bundle_sha256: '5a79c1314332f5228e2865e6eeabc1b7597e863b56f8ec2079448ea2db37df9b', decisions_sha256: '62223a099e6dff9e96b99b4264472f6c8ab5d91c204686e0eb579a8c2585083c', mutation_results_sha256: '0757f6827786fa5fafc73e8beebe5852819bd913f4da45017ca9cdfd63c2d5ad', required_set_sha256: 'f6eee94d9b1d80e0437474f0db65b35ce874e14edd9cf7f8314b4c38e9970d05', executed_required_sha256: '780f7d865a7c56e761856bae9b2f5f6c1743b322817b570355c5f41eab2b4f1a', declared_decisions_sha256: 'a88805a573742cda40de5648cccb9735cf966d5aba32827a47f326d31477a7e4', declared_mutations_sha256: 'b0cbf903c93378a8148e74f29564524ba9c6971f19d697c595aca3448606f797', stable_code_count: 119, stable_code_set_sha256: 'f6f89d48519aaa46b362a474cc6bd8e470b638e1c7f4c3c0a7ac99413a85fa5c', record_input_sha256: c1Identity.sha256, mirror_validation_code: '', index_validation_code: '', record_validation_code: '', mirror_validation_allowed: true, index_validation_allowed: true, record_validation_allowed: true }
  const goReceipt = { ...goUnsigned, receipt_digest: sha256Bytes(Buffer.concat([canonicalBytes(goUnsigned), Buffer.from('\n', 'utf8')])) }
  const goIdentity = writeExclusiveCanonical(root, 'control/es8-go-receipt.json', goReceipt)
  const es7Identity = writeExclusiveCanonical(root, 'control/es7-typed-fixtures.json', buildEs7TypedFixtureContract(ledger.campaign_id, ledger.c1.review_sha256))
  const es8Identity = writeExclusiveCanonical(root, 'control/es8-ts-c1-agreement.json', buildEs8TsAgreement(goReceipt, goIdentity.sha256, ledger.campaign_id, ledger.c1.review_sha256))
  const es9Identity = writeExclusiveCanonical(root, 'control/es9-coverage-contract.json', buildEs9CoverageContract(ledger))
  const inputUnsigned = { schema_id: 'oracle-lab-p3b-production-input.v2', campaign_id: ledger.campaign_id, es7_typed_fixtures_sha256: es7Identity.sha256, es8_go_receipt_sha256: goIdentity.sha256, es8_ts_c1_agreement_sha256: es8Identity.sha256, es9_coverage_contract_sha256: es9Identity.sha256 }
  const input = { ...inputUnsigned, input_sha256: sha256Canonical(inputUnsigned) }
  writeExclusiveCanonical(root, 'control/campaign-input.json', input)
  const authorityUnsigned = { schema_id: 'oracle-lab-p3b-operator-authority.v2', campaign_id: ledger.campaign_id, campaign_input_sha256: input.input_sha256 }
  writeExclusiveCanonical(root, 'control/operator-authority.json', { ...authorityUnsigned, authority_sha256: sha256Canonical(authorityUnsigned) })
  void c1Raw
}

function buildTransportSourceRecords(ledger: ReturnType<typeof buildCampaignLedger>, transportRawSha256: string, rows: readonly Readonly<Record<string, unknown>>[]): readonly Readonly<Record<string, unknown>>[] {
  const contract = observationCoverageMatrix(ledger)
  const records: Readonly<Record<string, unknown>>[] = []
  for (const row of ledger.rows) {
    const transportRow = rows[row.sequence_index]
    const observationDigest = String(transportRow.transport_receipt_sha256)
    for (let attempt = 0; attempt < row.response_program.maximum_attempts; attempt += 1) {
      for (const descriptor of contract.enabled.filter((entry) => entry.sequence_index === row.sequence_index)) {
        const descriptorRecord = descriptor as Readonly<Record<string, unknown>>
        const observationPointer = String(descriptorRecord.observation_pointer)
        const unsigned = { json_pointer: `/rows/${row.sequence_index}/attempts/${attempt}/${descriptorRecord.source_class}${observationPointer.startsWith('/response/') ? observationPointer.slice('/response'.length) : observationPointer}`, sequence_index: row.sequence_index, attempt_ordinal: attempt, source_class: descriptorRecord.source_class, normative_source_pointer: descriptorRecord.source_pointer, normative_source_sha256: descriptorRecord.source_sha256, enabled: true, reason_code: null, source_relative_path: 'production/transport-results.json', source_raw_sha256: transportRawSha256, source_observation_sha256: observationDigest, source_value_sha256: sha256Canonical({ row: row.sequence_index, attempt, source_class: descriptorRecord.source_class, observation: observationDigest }) }
        records.push({ ...unsigned, source_binding_sha256: sha256Canonical(unsigned) })
      }
      for (const exclusion of contract.disabled.filter((entry) => entry.sequence_index === row.sequence_index)) {
        const unsigned = { json_pointer: `/rows/${row.sequence_index}/attempts/${attempt}/${exclusion.source_class}/raw_body`, sequence_index: row.sequence_index, attempt_ordinal: attempt, source_class: 'excluded', normative_source_pointer: exclusion.source_pointer, normative_source_sha256: exclusion.source_sha256, enabled: false, reason_code: exclusion.reason_code, source_relative_path: null, source_raw_sha256: null, source_observation_sha256: null, source_value_sha256: null }
        records.push({ ...unsigned, source_binding_sha256: sha256Canonical(unsigned) })
      }
    }
  }
  return deepFreeze(records)
}

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

export function runSyntheticProductionDryRun(evidenceRoot: string): SyntheticProductionDryRunResult {
  void evidenceRoot
  throw new Phase3BProductionError('synthetic_path_retired', 'the duplicate synthetic controller path is retired; use runProductionCampaignDryRun')
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
