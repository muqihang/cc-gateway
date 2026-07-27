import { pathToFileURL } from 'node:url'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { Phase3BProductionError, assertDigestField, canonicalBytes, deepFreeze, sha256Bytes, sha256Canonical } from './core.js'
import { main as campaignMain } from './campaign.js'
import { evaluateGateB, writeGateB, type GateBEvaluationInput } from './gates.js'
import { deriveCuration, runCloseout, CONCLUSION_IDS, CONCLUSION_PATHS, SUPPORT_PATHS } from './closeout.js'
import { appendAdapterRowStartedSpawned, appendAdapterRowTerminal, openExecutionStore, readExecutionReceipts } from './execution-store.js'
import { buildCampaignLedger, crossRepoAuthority, materializeEs7Sources, materializeResponseBody, observationCoverageMatrix, type RunLedgerRow } from './ledger.js'
import { buildEs7TypedFixtureContract, buildEs8TsAgreement, buildEs9CoverageContract } from './authority-materializer.js'
import { createProductionController, assertProductionController } from './controller.js'
import { deriveAdapterLaunchAuthority } from './launch-authority.js'
import { assertPrivateRuntimeRoot, createPrivateDirectory, readCanonical, writeExclusiveCanonical } from './sealed-fs.js'
import { materializeRouteDispatch } from './scenario-input.js'
import { adapterClock, adapterRoutes, adapterRuntimeIdentity, adapterTrace, assertCapturedTransportReceipt, assertIndependentGateBEvaluation, destroySignerAfterVerifiedGate, dispatchCapturedTransport, evaluateIndependentGateB, issueIndependentCampaignInputAuthority, issueIndependentGateAuthorities, verifyIndependentGateAuthority, type CapturedTransportReceipt, type ProductionDryRunAdapters, type SignedAuthority } from './production-dry-run-adapters.js'

export { buildCampaignLedger, type CampaignLedger } from './ledger.js'
export { assertProductionController, createProductionController, type ProductionController } from './controller.js'
export { closeProductionDryRunAdapters, createProductionDryRunAdapters, type ProductionDryRunAdapters } from './production-dry-run-adapters.js'

export type GateBResult = Readonly<{
  decision: 'PASS' | 'BLOCKED'
  phase3b_usable: boolean
}>

export function evaluateProductionGateB(_input: Readonly<Record<string, unknown>>): GateBResult {
  if (typeof _input.evidence_root !== 'string' || Object.keys(_input).length !== 1) throw new Phase3BProductionError('gate_input_invalid', 'Gate B accepts only one sealed evidence root')
  return writeGateB(_input.evidence_root) as GateBResult
}

export type SyntheticProductionDryRunResult = Readonly<Record<string, unknown>>

export async function runProductionCampaignDryRun(_evidenceRoot: string, _adapters: unknown): Promise<SyntheticProductionDryRunResult> {
  return runProductionCampaignDryRunAsync(_evidenceRoot, _adapters as ProductionDryRunAdapters)
}

async function runProductionCampaignDryRunAsync(evidenceRoot: string, adapters: ProductionDryRunAdapters): Promise<SyntheticProductionDryRunResult> {
  const root = assertPrivateRuntimeRoot(evidenceRoot)
  const trace = (stage: string) => adapterTrace(adapters, stage)
  const routeUrls = adapterRoutes(adapters)
  const runtime = adapterRuntimeIdentity(adapters)
  const c1Record = { schema_id: 'oracle.cross_repo_record', review: { cross: { task_id: 'phase3b-production-dry-run', model: 'gpt-5.6-sol', artifact_sha256: 'a'.repeat(64), critical: 0, important: 0, verdict: 'CROSS_REPO_PASS' } } }
  const c1Raw = Buffer.concat([canonicalBytes(c1Record), Buffer.from('\n', 'utf8')])
  const c1Digest = sha256Bytes(c1Raw)
  const authority = crossRepoAuthority(c1Digest)
  const ledger = buildCampaignLedger('p3b-production-dry-run', authority)
  createPrivateDirectory(root, 'prelaunch')
  writeExclusiveCanonical(root, 'prelaunch/run-ledger.json', ledger)
  trace('materialize')
  materializeControlArtifacts(root, ledger, c1Record, c1Raw)
  const campaignInputAuthority = issueIndependentCampaignInputAuthority(adapters, root)
  verifyIndependentGateAuthority(adapters, campaignInputAuthority, 'requirements')
  writeExclusiveCanonical(root, 'control/operator-authority.json', campaignInputAuthority)
  const controller = createProductionController({ campaign_id: ledger.campaign_id, c1: authority })
  assertProductionController(controller)
  const store = openExecutionStore(root, ledger)
  const transportRows: Readonly<Record<string, unknown>>[] = []
  const dispatchDigests: string[] = []
  const captured: Array<{ receipt: CapturedTransportReceipt; raw_sha256: string; relative_path: string }> = []
  createPrivateDirectory(root, 'production')
  createPrivateDirectory(root, 'production/captures')
  const previousBaseUrl = process.env.ANTHROPIC_BASE_URL
  process.env.ANTHROPIC_BASE_URL = routeUrls[1]
  trace('execute')
  try {
    let previousReceiptSha256: string | null = null
    for (const row of ledger.rows) {
      const launchAuthority = deriveAdapterLaunchAuthority(controller, row, runtime)
      const transition = appendAdapterRowStartedSpawned(store, row, launchAuthority, previousReceiptSha256, { sandbox_pid: process.pid, target_pid: runtime.child_pid, executable_identity_sha256: runtime.executable_identity_sha256 })
      const route = row.family === 'config' ? materializeRouteDispatch(row, routeUrls) : { request_route: 0 as const, preflight_route: null, actual_route: 0 as const, selected_url: routeUrls[0] }
      const routeMode = row.schedule_id === 'config-precedence-process-env-vs-local' && row.arm.startsWith('treatment/') ? 'process-env' as const : 'local' as const
      const response = await dispatchCapturedTransport(adapters, { sequence_index: row.sequence_index, run_id: row.run_id, selected_url: route.selected_url, route_mode: routeMode, response_program_id: row.response_program.program_id, response_program_sha256: row.response_program_sha256 })
      assertCapturedTransportReceipt(response)
      validateCapturedTransport(row, response, route.actual_route, runtime)
      const relative = `production/captures/${String(row.sequence_index).padStart(3, '0')}-${row.run_id}.json`
      const captureIdentity = writeExclusiveCanonical(root, relative, response)
      const dispatchDigest = response.capture_sha256
      dispatchDigests.push(dispatchDigest)
      captured.push({ receipt: response, raw_sha256: captureIdentity.sha256, relative_path: relative })
      const terminal = appendAdapterRowTerminal(store, row, launchAuthority, transition.started, transition.spawned)
      previousReceiptSha256 = terminal.receipt_sha256
      const source = materializeEs7Sources(row)
      const unsigned = { sequence_index: row.sequence_index, run_id: row.run_id, row_sha256: row.row_sha256, family: row.family, schedule_id: row.schedule_id, request_stimulus_sha256: row.request_stimulus_sha256, status: 'Reproduced', contract_request_source_sha256: source.request_source_sha256, contract_response_source_sha256: source.response_source_sha256, requests: response.attempts.map((attempt) => attempt.request), responses: response.attempts.map((attempt) => attempt.response), transport_receipt_sha256: dispatchDigest, target_pid: response.child_pid, executable_identity_sha256: response.executable_identity_sha256, receiver_listener_sha256: response.receiver_listener_sha256, route_index: response.route_index }
      transportRows.push({ ...unsigned, fixture_sha256: sha256Canonical(unsigned) })
    }
  } finally {
    if (previousBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = previousBaseUrl
  }
  const receipts = readExecutionReceipts(store)
  writeExclusiveCanonical(root, 'production/transport-results.json', { schema_id: 'oracle-lab-p3b-transport-results.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, receipt_set_sha256: sha256Canonical(receipts), rows: transportRows, rows_sha256: sha256Canonical(transportRows), dispatch_digests: dispatchDigests })
  const sourceRecords = buildTransportSourceRecords(ledger, captured)
  deriveCuration(root, { fixtureRows: transportRows, receipt_set_sha256: sha256Canonical(receipts), sourceRecords })
  trace('curation')
  trace('conclusions')
  const closeout = runCloseout(root)
  const conclusions = CONCLUSION_IDS.map((id) => readCanonical(root, CONCLUSION_PATHS[id], 1_048_576).value)
  const leak = readCanonical(root, 'capsules/P3B-ES1/closure/leak-report.json', 1_048_576).value
  const routeRow = ledger.rows.find((row) => row.schedule_id === 'config-precedence-process-env-vs-local' && row.arm.startsWith('treatment/'))
  if (!routeRow) throw new Phase3BProductionError('scenario_input_invalid', 'process-env route row is missing from the production ledger')
  const routeDispatch = materializeRouteDispatch(routeRow, routeUrls)
  trace('gate-a')
  const signedAuthorities = issueIndependentGateAuthorities(adapters, root)
  verifyIndependentGateAuthority(adapters, signedAuthorities.gateA, 'security_quality')
  verifyIndependentGateAuthority(adapters, signedAuthorities.operator, 'requirements')
  writeExclusiveCanonical(root, 'production/gate-a.json', signedAuthorities.gateA)
  writeExclusiveCanonical(root, 'production/operator-authority.json', signedAuthorities.operator)
  const gatePayload = signedAuthorities.gateA.payload
  const operatorPayload = signedAuthorities.operator.payload
  const now = adapterClock(adapters)
  const supportRecords = SUPPORT_PATHS.map((relative) => readCanonical(root, relative, 67_108_864).value)
  if (supportRecords.some((value) => value.status !== 'PASS') || leak.status !== 'PASS' || !Array.isArray(leak.findings) || leak.findings.length !== 0) throw new Phase3BProductionError('gate_b_blocked', 'sealed support or leak report is not PASS')
  const gateInput = { campaign_id: ledger.campaign_id, gate_a_sha256: signedAuthorities.gateA.authority_sha256, gate_a_clock_sha256: sha256Canonical({ wall_ms: gatePayload.created_wall_ms, monotonic_ns: gatePayload.created_monotonic_ns }), external_set_sha256: String(closeout.external_set_sha256), operator_decision_sha256: signedAuthorities.operator.authority_sha256, conclusion_sha256s: conclusions.map((value) => String(value.conclusion_sha256)), gate_clock_sha256: sha256Canonical({ wall_ms: now.wallMs, monotonic_ns: now.monotonicNs, predecessor: gatePayload.created_monotonic_ns }), controller_source_set_sha256: sha256Canonical({ controller: 'production-controller', ledger_sha256: ledger.ledger_sha256 }), controller_executable_sha256: runtime.executable_identity_sha256, toolchain_sha256: sha256Canonical({ node: process.version, executable_sha256: runtime.executable_identity_sha256 }), support_status: 'PASS' as const, leak_status: leak.status as 'PASS', leak_finding_count: 0, conclusion_states: conclusions.map((value) => ({ level: value.level, enabled: value.enabled, contradiction_count: Array.isArray(value.contradiction_ids) ? value.contradiction_ids.length : -1 })), evaluation_wall_clock_ms: now.wallMs, issued_wall_clock_ms: Number(operatorPayload.issued_wall_ms), evaluation_monotonic_ns: now.monotonicNs, issued_monotonic_ns: String(operatorPayload.issued_monotonic_ns) }
  writeExclusiveCanonical(root, 'production/gate-b-input.json', gateInput)
  trace('gate-b-evaluate')
  const independentEvaluation = evaluateIndependentGateB(adapters, root)
  assertIndependentGateBEvaluation(independentEvaluation)
  if (independentEvaluation.input_raw_sha256 !== readCanonical(root, 'production/gate-b-input.json').identity.sha256 || independentEvaluation.evaluation_sha256 !== sha256Canonical({ schema_id: independentEvaluation.schema_id, input_raw_sha256: independentEvaluation.input_raw_sha256, result: independentEvaluation.result })) throw new Phase3BProductionError('gate_b_result_invalid', 'independent Gate B evaluation does not bind the sealed input bytes')
  const gateResult = independentEvaluation.result
  const gateResultIdentity = writeExclusiveCanonical(root, 'production/gate-b-result.json', gateResult)
  trace('gate-b-seal')
  const sealedResult = validateProductionDryRunGateB(root, adapters)
  trace('gate-b-validate')
  if (gateResultIdentity.sha256 !== readCanonical(root, 'production/gate-b-result.json').identity.sha256) throw new Phase3BProductionError('gate_b_result_invalid', 'sealed Gate B result identity drifted before signer destruction')
  destroySignerAfterVerifiedGate(adapters, { gate_b_result_sha256: String(sealedResult.gate_result_sha256), revalidated: true })
  trace('signer-destroy')
  const persistedLeakScan = recursiveLeakScan(root)
  if (persistedLeakScan.finding_count !== 0) throw new Phase3BProductionError('synthetic_leak_invalid', 'recursive persisted-tree leak scan found forbidden material')
  const result = { schema_id: 'oracle-lab-p3b-synthetic-dry-run.v1', campaign_id: ledger.campaign_id, stages: ['materialized', 'normative_resolved', 'execution_receipts', 'curation', 'support', 'conclusions', 'gate_b_evaluated', 'gate_b_sealed', 'gate_b_revalidated', 'signer_destruction'], row_count: ledger.rows.length, normative_leaf_count: 152, route_dispatch: { schedule_id: routeRow.schedule_id, ...routeDispatch }, persisted_leak_scan: { raw: persistedLeakScan.raw, base64: persistedLeakScan.base64, hex: persistedLeakScan.hex, url_encoded: persistedLeakScan.url_encoded, secret_field_names: persistedLeakScan.secret_field_names }, conclusions, gate_b: { decision: gateResult.decision, phase3b_usable: gateResult.phase3b_usable, revalidated: true }, signer_destruction: 'verified' }
  createPrivateDirectory(root, 'synthetic')
  writeExclusiveCanonical(root, 'synthetic/result.json', result)
  return deepFreeze(result)
}

function validateCapturedTransport(row: RunLedgerRow, receipt: CapturedTransportReceipt, expectedRoute: 0 | 1, runtime: Readonly<{ child_pid: number; executable_identity_sha256: string; receiver_identity_sha256: string }>): void {
  if (receipt.sequence_index !== row.sequence_index || receipt.run_id !== row.run_id || receipt.route_index !== expectedRoute || receipt.child_pid !== runtime.child_pid || receipt.executable_identity_sha256 !== runtime.executable_identity_sha256 || receipt.receiver_listener_sha256 !== runtime.receiver_identity_sha256 || receipt.peer.remote_address !== '127.0.0.1' || !Number.isSafeInteger(receipt.peer.local_port) || receipt.peer.local_port <= 0 || receipt.attempts.length !== row.response_program.maximum_attempts || receipt.capture_sha256 !== sha256Canonical(Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'capture_sha256')))) throw new Phase3BProductionError('external_fact_authority_invalid', 'captured transport receipt does not bind the exact row, route, PID, executable, receiver, peer, or attempts')
  receipt.attempts.forEach((attempt, index) => {
    const action = row.response_program.actions[index]
    const request = attempt.request
    const response = attempt.response
    const ast = request.body_ast as Record<string, unknown> | undefined
    const expectedBody = Buffer.from(materializeResponseBody(action.body_kind), 'utf8')
    const expectedEvents = [...expectedBody.toString('utf8').matchAll(/^event: ([^\n]+)$/gm)].map((match) => match[1])
    if (attempt.attempt_ordinal !== index || request.method !== 'POST' || request.path !== '/v1/messages' || request.query_present !== false || !ast || ast.model !== 'claude-sonnet-4-6' || ast.sequence_index !== row.sequence_index || ast.attempt_ordinal !== index || response.attempt_ordinal !== index || response.status !== action.status || response.body_byte_length !== expectedBody.length || response.body_sha256 !== sha256Bytes(expectedBody) || sha256Canonical(response.sse_event_order) !== sha256Canonical(expectedEvents) || response.transport_terminal !== action.transport_terminal || typeof response.delay_elapsed_ns !== 'string' || BigInt(response.delay_elapsed_ns) < BigInt(action.delay_ms) * 1_000_000n || response.socket_close_had_error !== (action.kind === 'reset') || attempt.receiver_wire_event_sha256 !== sha256Canonical(attempt.receiver_wire_events) || BigInt(attempt.monotonic_terminal_ns) < BigInt(attempt.monotonic_start_ns)) throw new Phase3BProductionError('external_fact_authority_invalid', 'captured request, wire, terminal, or timing does not match the frozen row program')
  })
}

function readSignedAuthority(root: string, relative: string): SignedAuthority {
  const value = readCanonical(root, relative).value
  assertDigestField(value, 'authority_sha256', 'external_fact_authority_invalid')
  if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload) || typeof value.signature !== 'string' || value.role !== 'security_quality' && value.role !== 'requirements') throw new Phase3BProductionError('external_fact_authority_invalid', 'sealed independent authority shape drifted')
  return value as unknown as SignedAuthority
}

function validateProductionDryRunGateB(root: string, adapters: ProductionDryRunAdapters): Record<string, unknown> {
  const gateA = readSignedAuthority(root, 'production/gate-a.json')
  const operator = readSignedAuthority(root, 'production/operator-authority.json')
  verifyIndependentGateAuthority(adapters, gateA, 'security_quality')
  verifyIndependentGateAuthority(adapters, operator, 'requirements')
  const gatePayload = gateA.payload; const operatorPayload = operator.payload
  const ledger = readCanonical(root, 'prelaunch/run-ledger.json').value
  const curation = readCanonical(root, 'capsules/P3B-ES1/curation/result.json').value
  const external = readCanonical(root, 'capsules/P3B-ES1/closure/external-digest-set.json').value
  const leak = readCanonical(root, 'capsules/P3B-ES1/closure/leak-report.json').value
  const conclusions = CONCLUSION_IDS.map((id) => readCanonical(root, CONCLUSION_PATHS[id]).value)
  const supports = SUPPORT_PATHS.map((relative) => readCanonical(root, relative, 67_108_864).value)
  const current = adapterClock(adapters)
  if (gatePayload.schema_id !== 'oracle-lab-p3b-independent-gate-a.v1' || gatePayload.campaign_id !== ledger.campaign_id || gatePayload.decision !== 'PASS' || gatePayload.phase3b_usable !== false || gatePayload.curation_sha256 !== curation.curation_sha256 || gatePayload.external_set_sha256 !== external.external_set_sha256 || gatePayload.leak_report_sha256 !== leak.leak_report_sha256 || sha256Canonical(gatePayload.conclusion_sha256s) !== sha256Canonical(conclusions.map((value) => value.conclusion_sha256)) || curation.status !== 'Reproduced' || leak.status !== 'PASS' || !Array.isArray(leak.findings) || leak.findings.length !== 0 || supports.some((value) => value.status !== 'PASS') || conclusions.some((value) => value.level !== 'Reproduced' || value.enabled !== true || !Array.isArray(value.contradiction_ids) || value.contradiction_ids.length !== 0)) throw new Phase3BProductionError('gate_b_result_invalid', 'Gate A is not the independently reviewed exact sealed artifact set')
  const issuedWall = Number(operatorPayload.issued_wall_ms); const expiresWall = Number(operatorPayload.expires_wall_ms); const issuedMono = BigInt(String(operatorPayload.issued_monotonic_ns))
  if (operatorPayload.schema_id !== 'oracle-lab-p3b-independent-operator-authority.v1' || operatorPayload.campaign_id !== ledger.campaign_id || operatorPayload.decision !== 'evaluate_successor_amendment_startable' || operatorPayload.scope !== 'phase3b-offline-synthetic-only' || operatorPayload.gate_a_sha256 !== gateA.authority_sha256 || operatorPayload.external_set_sha256 !== external.external_set_sha256 || sha256Canonical(operatorPayload.conclusion_sha256s) !== sha256Canonical(conclusions.map((value) => value.conclusion_sha256)) || !Number.isSafeInteger(issuedWall) || !Number.isSafeInteger(expiresWall) || issuedWall > current.wallMs || current.wallMs >= expiresWall || issuedMono > BigInt(current.monotonicNs)) throw new Phase3BProductionError('gate_b_result_invalid', 'operator authority signature, scope, freshness, or artifact binding drifted')
  const sealedInput = readCanonical(root, 'production/gate-b-input.json').value as unknown as GateBEvaluationInput
  if (sealedInput.campaign_id !== ledger.campaign_id || sealedInput.gate_a_sha256 !== gateA.authority_sha256 || sealedInput.external_set_sha256 !== external.external_set_sha256 || sealedInput.operator_decision_sha256 !== operator.authority_sha256 || sha256Canonical(sealedInput.conclusion_sha256s) !== sha256Canonical(conclusions.map((value) => value.conclusion_sha256)) || sealedInput.support_status !== 'PASS' || sealedInput.leak_status !== 'PASS' || sealedInput.leak_finding_count !== 0 || sealedInput.issued_wall_clock_ms !== issuedWall || sealedInput.issued_monotonic_ns !== String(operatorPayload.issued_monotonic_ns)) throw new Phase3BProductionError('gate_b_result_invalid', 'Gate B input is not the exact sealed Gate A/operator/support/leak/conclusion tuple')
  const sealedResult = readCanonical(root, 'production/gate-b-result.json').value
  const recomputed = evaluateGateB(sealedInput)
  if (sha256Canonical(sealedResult) !== sha256Canonical(recomputed) || sealedResult.decision !== 'PASS' || sealedResult.phase3b_usable !== true) throw new Phase3BProductionError('gate_b_result_invalid', 'sealed production Gate B result failed full independent re-evaluation')
  return sealedResult
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
  void c1Raw
}

function resolveObservationPointer(value: unknown, pointer: string): unknown {
  let current = value
  for (const segment of pointer.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, segment)) throw new Phase3BProductionError('curation_invalid', `captured observation pointer is absent: ${pointer}`)
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function buildTransportSourceRecords(ledger: ReturnType<typeof buildCampaignLedger>, captures: readonly Readonly<{ receipt: CapturedTransportReceipt; raw_sha256: string; relative_path: string }>[]): readonly Readonly<Record<string, unknown>>[] {
  const contract = observationCoverageMatrix(ledger)
  const records: Readonly<Record<string, unknown>>[] = []
  for (const row of ledger.rows) {
    const capture = captures[row.sequence_index]
    if (!capture || capture.receipt.sequence_index !== row.sequence_index || capture.receipt.capture_sha256 !== sha256Canonical(Object.fromEntries(Object.entries(capture.receipt).filter(([key]) => key !== 'capture_sha256')))) throw new Phase3BProductionError('curation_invalid', 'ES9 actual source is not the sealed opaque capture set')
    for (let attempt = 0; attempt < row.response_program.maximum_attempts; attempt += 1) {
      const capturedAttempt = capture.receipt.attempts[attempt]
      if (!capturedAttempt) throw new Phase3BProductionError('curation_invalid', 'ES9 actual source attempt is absent')
      for (const descriptor of contract.enabled.filter((entry) => entry.sequence_index === row.sequence_index)) {
        const descriptorRecord = descriptor as Readonly<Record<string, unknown>>
        const observationPointer = String(descriptorRecord.observation_pointer)
        const sourceClass = String(descriptorRecord.source_class)
        const pointer = sourceClass === 'response' ? observationPointer.slice('/response'.length) : observationPointer
        const actual = resolveObservationPointer(sourceClass === 'response' ? capturedAttempt.response : capturedAttempt.request, pointer)
        const unsigned = { json_pointer: `/rows/${row.sequence_index}/attempts/${attempt}/${sourceClass}${pointer}`, sequence_index: row.sequence_index, attempt_ordinal: attempt, source_class: sourceClass, normative_source_pointer: descriptorRecord.source_pointer, normative_source_sha256: descriptorRecord.source_sha256, enabled: true, reason_code: null, source_relative_path: capture.relative_path, source_raw_sha256: capture.raw_sha256, source_observation_sha256: capture.receipt.capture_sha256, source_value_sha256: sha256Canonical(actual) }
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
