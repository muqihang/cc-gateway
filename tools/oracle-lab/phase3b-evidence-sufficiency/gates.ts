import { loadSealedControl } from './campaign-controller.js'
import { CONCLUSION_IDS, CONCLUSION_PATHS, SUCCESSOR_TTL_MS, validateArtifactIndexCoverage, validateConclusionSupport, validateExternalSet } from './closeout.js'
import { Phase3BProductionError, assertDigestField, assertExactKeys, deepFreeze, sha256Canonical } from './core.js'
import { deriveExecutionCounts, openExecutionStore, readExecutionReceipts } from './execution-store.js'
import { validateCampaignLedger } from './ledger.js'
import { assertPrivateRuntimeRoot, createPrivateDirectory, readCanonical, stableRead, writeExclusiveCanonical } from './sealed-fs.js'
import { controllerExecutableSha256, controllerSourceSetSha256 } from './source-identity.js'
import { loadTrustedReviewerRegistry, verifyTrustedSignature } from './trust.js'

const OPERATOR_MAX_DELAY_MS = 300_000
const SCOPE = 'non-resume; claude-code-2.1.215; darwin-arm64; synthetic-loopback-only; no-production; no-real-credentials; no-upstream; no-promotion'
const CURATION_ROOT = 'capsules/P3B-ES1/curation'
const CLOSURE_ROOT = 'capsules/P3B-ES1/closure'
const GATE_ROOT = 'capsules/P3B-ES1/gates'
const CLOSURE_FILES = ['artifact-index.json', 'external-digest-set.json', 'exit-report.json', 'handoff.json', 'leak-report.json', 'terminal-manifest.json'] as const

type GateClock = Readonly<{
  schema_id: 'oracle-lab-p3b-gate-clock.v1'
  gate: 'A' | 'B'
  campaign_id: string
  external_set_sha256: string
  conclusion_sha256s: readonly string[]
  controller_source_set_sha256: string
  controller_executable_sha256: string
  toolchain_sha256: string
  predecessor_clock_sha256: string
  predecessor_wall_clock_ms: number
  predecessor_monotonic_ns: string
  wall_clock_ms: number
  monotonic_ns: string
  clock_sha256: string
}>

function conclusions(root: string): Array<Record<string, unknown>> {
  return CONCLUSION_IDS.map((id) => {
    const value = readCanonical(root, CONCLUSION_PATHS[id]).value
    assertExactKeys(value, ['schema_id', 'conclusion_id', 'campaign_id', 'ledger_sha256', 'level', 'enabled', 'created_at_ms', 'issued_at_ms', 'expires_at_ms', 'clock_attestation_sha256', 'contradiction_ids', 'source_row_set_sha256', 'supporting_evidence_sha256s', 'unknown_or_omitted', 'conclusion_sha256'], 'conclusion_invalid')
    assertDigestField(value, 'conclusion_sha256', 'conclusion_invalid')
    if (value.schema_id !== 'oracle-lab-p3b-successor-conclusion.v1' || value.conclusion_id !== id || value.unknown_or_omitted !== 'disabled') throw new Phase3BProductionError('conclusion_invalid', 'conclusion fixed ID/path/schema drifted')
    return value
  })
}

function validateCurationClock(root: string, conclusionRows: readonly Record<string, unknown>[]): Record<string, unknown> {
  const clock = readCanonical(root, `${CURATION_ROOT}/clock-attestation.json`).value
  assertExactKeys(clock, ['schema_id', 'campaign_id', 'ledger_sha256', 'receipt_set_sha256', 'predecessor_receipt_sha256', 'predecessor_terminal_receipt_sha256', 'predecessor_terminal_monotonic_ns', 'created_at_ms', 'created_monotonic_ns', 'clock_sha256'], 'gate_clock_invalid')
  assertDigestField(clock, 'clock_sha256', 'gate_clock_invalid')
  const ledger = validateCampaignLedger(readCanonical(root, 'prelaunch/run-ledger.json', 16_777_216).value)
  const receipts = readExecutionReceipts(openExecutionStore(root, ledger))
  const lastReceipt = receipts.at(-1)
  const lastTerminal = [...receipts].reverse().find((receipt) => receipt.state === 'terminal')
  const curation = readCanonical(root, `${CURATION_ROOT}/result.json`, 16_777_216).value
  assertDigestField(curation, 'curation_sha256', 'curation_invalid')
  const supportSha256s = validateConclusionSupport(root, false)
  const now = Date.now(); const monotonic = process.hrtime.bigint()
  const createdMonotonicText = String(clock.created_monotonic_ns)
  const createdMonotonic = /^\d+$/.test(createdMonotonicText) ? BigInt(createdMonotonicText) : -1n
  if (clock.schema_id !== 'oracle-lab-p3b-curation-clock.v1' || clock.campaign_id !== ledger.campaign_id || clock.ledger_sha256 !== ledger.ledger_sha256 || clock.receipt_set_sha256 !== sha256Canonical(receipts) || clock.predecessor_receipt_sha256 !== (lastReceipt?.receipt_sha256 ?? null) || clock.predecessor_terminal_receipt_sha256 !== (lastTerminal?.receipt_sha256 ?? null) || clock.predecessor_terminal_monotonic_ns !== (lastTerminal?.terminal_monotonic_ns ?? null) || (lastTerminal && createdMonotonic < BigInt(String(lastTerminal.terminal_monotonic_ns))) || curation.clock_attestation_sha256 !== clock.clock_sha256 || curation.issued_at_ms !== clock.created_at_ms || Number(clock.created_at_ms) > now || createdMonotonic < 0n || createdMonotonic > monotonic || conclusionRows.some((row) => row.created_at_ms !== clock.created_at_ms || row.issued_at_ms !== clock.created_at_ms || row.clock_attestation_sha256 !== clock.clock_sha256)) throw new Phase3BProductionError('gate_clock_invalid', 'curation clock does not postdate immutable execution receipts and bind exact conclusions')
  if (sha256Canonical(curation.conclusion_sha256s) !== sha256Canonical(conclusionRows.map((row) => row.conclusion_sha256)) || sha256Canonical(curation.supporting_evidence_sha256s) !== sha256Canonical(supportSha256s) || conclusionRows.some((row) => sha256Canonical(row.supporting_evidence_sha256s) !== sha256Canonical(supportSha256s))) throw new Phase3BProductionError('conclusion_invalid', 'curation/conclusions do not bind exact support evidence bytes')
  return clock
}

function captureClock(root: string, gate: 'A' | 'B', predecessor: Readonly<{ sha256: string; wall: number; monotonic: string }>, externalSetSha256: string, conclusionSha256s: readonly string[], toolchainSha256: string): GateClock {
  const wall = Date.now()
  const monotonic = process.hrtime.bigint().toString()
  if (wall < predecessor.wall || BigInt(monotonic) < BigInt(predecessor.monotonic)) throw new Phase3BProductionError('gate_clock_rollback', 'wall or monotonic clock rolled back')
  const unsigned = {
    schema_id: 'oracle-lab-p3b-gate-clock.v1' as const, gate, campaign_id: String(readCanonical(root, 'prelaunch/run-ledger.json', 16_777_216).value.campaign_id),
    external_set_sha256: externalSetSha256, conclusion_sha256s: conclusionSha256s, controller_source_set_sha256: controllerSourceSetSha256(),
    controller_executable_sha256: controllerExecutableSha256(), toolchain_sha256: toolchainSha256,
    predecessor_clock_sha256: predecessor.sha256, predecessor_wall_clock_ms: predecessor.wall, predecessor_monotonic_ns: predecessor.monotonic,
    wall_clock_ms: wall, monotonic_ns: monotonic,
  }
  return deepFreeze({ ...unsigned, clock_sha256: sha256Canonical(unsigned) })
}

function writeGate(root: string, relative: string, value: unknown): void {
  if (JSON.stringify(value).match(/(?:Bearer\s+|\bsk-[A-Za-z0-9_-]{8,}|BEGIN .*PRIVATE KEY)/i)) throw new Phase3BProductionError('gate_sensitive_material', 'gate record contains forbidden material')
  writeExclusiveCanonical(root, relative, value)
}

function assertFixedDirectory(root: string, relative: string, expectedFiles: readonly string[]): void {
  const directory = path.join(root, relative)
  const actual = readdirSync(directory).sort()
  const expected = [...expectedFiles].sort()
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) throw new Phase3BProductionError('namespace_inventory_invalid', `${relative} contains an unexpected or missing leaf`)
  for (const name of actual) {
    const stat = lstatSync(path.join(directory, name))
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Phase3BProductionError('namespace_inventory_invalid', `${relative} contains a non-regular leaf`)
  }
}

export function evaluateGateA(evidenceRoot: string): Readonly<Record<string, unknown>> {
  if (typeof evidenceRoot !== 'string') throw new Phase3BProductionError('gate_input_invalid', 'Gate A accepts only a sealed evidence root')
  const root = assertPrivateRuntimeRoot(evidenceRoot)
  createPrivateDirectory(root, GATE_ROOT)
  assertFixedDirectory(root, GATE_ROOT, [])
  assertFixedDirectory(root, CLOSURE_ROOT, CLOSURE_FILES)
  const external = validateExternalSet(root)
  const terminal = readCanonical(root, `${CLOSURE_ROOT}/terminal-manifest.json`).value
  assertExactKeys(terminal, ['schema_id', 'campaign_id', 'ledger_sha256', 'artifact_index_sha256', 'leak_report_sha256', 'exit_report_sha256', 'handoff_sha256', 'terminal_state', 'phase3b_usable', 'terminal_manifest_sha256'], 'terminal_manifest_invalid')
  assertDigestField(terminal, 'terminal_manifest_sha256', 'terminal_manifest_invalid')
  const exit = readCanonical(root, `${CLOSURE_ROOT}/exit-report.json`).value
  assertExactKeys(exit, ['schema_id', 'campaign_id', 'ledger_sha256', 'counts', 'receipt_set_sha256', 'campaign_failure_sha256', 'curation_sha256', 'status', 'phase3b_usable', 'closed_at_ms', 'closed_monotonic_ns', 'exit_report_sha256'], 'exit_report_invalid')
  assertDigestField(exit, 'exit_report_sha256', 'exit_report_invalid')
  const artifactIndex = readCanonical(root, `${CLOSURE_ROOT}/artifact-index.json`, 16_777_216).value
  validateArtifactIndexCoverage(root, artifactIndex)
  const leak = readCanonical(root, `${CLOSURE_ROOT}/leak-report.json`).value
  const handoff = readCanonical(root, `${CLOSURE_ROOT}/handoff.json`).value
  for (const [record, digest, code] of [[artifactIndex, 'artifact_index_sha256', 'artifact_index_invalid'], [leak, 'leak_report_sha256', 'leak_report_invalid'], [handoff, 'handoff_sha256', 'handoff_invalid']] as const) assertDigestField(record, digest, code)
  const ledger = validateCampaignLedger(readCanonical(root, 'prelaunch/run-ledger.json', 16_777_216).value)
  const store = openExecutionStore(root, ledger)
  const receipts = readExecutionReceipts(store)
  const actualCounts = deriveExecutionCounts(store)
  const { input, authority } = loadSealedControl(root)
  const sealedFocused = readCanonical(root, 'control/focused-suite.json')
  const focused = sealedFocused.value
  if (sealedFocused.identity.sha256 !== input.focused_suite_sha256 || stableRead(input.focused_suite_path, { mode: 0o600, maximumBytes: 1_048_576 }).identity.sha256 !== input.focused_suite_sha256 || focused.passed !== true || focused.strict_typescript !== true || focused.build !== true || focused.diff_check !== true) throw new Phase3BProductionError('focused_suite_failed', 'Gate A actual focused suite drifted')
  if (!['COMPLETE', 'Unknown', 'BLOCKED'].includes(String(terminal.terminal_state)) || terminal.terminal_state !== exit.status || terminal.artifact_index_sha256 !== artifactIndex.artifact_index_sha256 || terminal.leak_report_sha256 !== leak.leak_report_sha256 || terminal.exit_report_sha256 !== exit.exit_report_sha256 || terminal.handoff_sha256 !== handoff.handoff_sha256 || exit.counts === null || sha256Canonical(exit.counts) !== sha256Canonical(actualCounts) || exit.receipt_set_sha256 !== sha256Canonical(receipts) || terminal.phase3b_usable !== false || exit.phase3b_usable !== false || actualCounts.terminal + actualCounts.not_executed !== 340) throw new Phase3BProductionError('gate_a_invalid', 'terminal closure does not honestly derive from the sealed matrix and exact five artifacts')
  const conclusionRows = conclusions(root)
  validateCurationClock(root, conclusionRows)
  const closeWall = Number(exit.closed_at_ms)
  const closeMonotonic = String(exit.closed_monotonic_ns)
  if (!Number.isSafeInteger(closeWall) || !/^\d+$/.test(closeMonotonic)) throw new Phase3BProductionError('gate_clock_invalid', 'closeout predecessor clock is invalid')
  const clock = captureClock(root, 'A', { sha256: String(exit.exit_report_sha256), wall: closeWall, monotonic: closeMonotonic }, String(external.external_set_sha256), conclusionRows.map((row) => String(row.conclusion_sha256)), input.toolchain_sha256)
  writeGate(root, `${GATE_ROOT}/gate-a-clock.json`, clock)
  const unsigned = { schema_id: 'oracle-lab-p3b-gate-result.v1', gate: 'A', decision: 'PASS', campaign_id: authority.campaign_id, external_set_sha256: external.external_set_sha256, terminal_manifest_sha256: terminal.terminal_manifest_sha256, implementation_review_sha256: authority.implementation_review_sha256, focused_suite_sha256: input.focused_suite_sha256, conclusion_sha256s: conclusionRows.map((row) => row.conclusion_sha256), gate_clock_sha256: clock.clock_sha256, phase3b_usable: false }
  const result = deepFreeze({ ...unsigned, gate_result_sha256: sha256Canonical(unsigned) })
  writeGate(root, `${GATE_ROOT}/gate-a-result.json`, result)
  return result
}

export function importSignedOperatorDecision(evidenceRoot: string, signedDecisionPath: string): Readonly<Record<string, unknown>> {
  const root = assertPrivateRuntimeRoot(evidenceRoot)
  assertFixedDirectory(root, GATE_ROOT, ['gate-a-clock.json', 'gate-a-result.json'])
  assertFixedDirectory(root, CLOSURE_ROOT, CLOSURE_FILES)
  const gateA = readCanonical(root, `${GATE_ROOT}/gate-a-result.json`).value
  const gateAClock = readCanonical(root, `${GATE_ROOT}/gate-a-clock.json`).value
  assertExactKeys(gateA, ['schema_id', 'gate', 'decision', 'campaign_id', 'external_set_sha256', 'terminal_manifest_sha256', 'implementation_review_sha256', 'focused_suite_sha256', 'conclusion_sha256s', 'gate_clock_sha256', 'phase3b_usable', 'gate_result_sha256'], 'gate_a_invalid')
  assertExactKeys(gateAClock, ['schema_id', 'gate', 'campaign_id', 'external_set_sha256', 'conclusion_sha256s', 'controller_source_set_sha256', 'controller_executable_sha256', 'toolchain_sha256', 'predecessor_clock_sha256', 'predecessor_wall_clock_ms', 'predecessor_monotonic_ns', 'wall_clock_ms', 'monotonic_ns', 'clock_sha256'], 'gate_clock_invalid')
  assertDigestField(gateA, 'gate_result_sha256', 'gate_a_invalid')
  assertDigestField(gateAClock, 'clock_sha256', 'gate_clock_invalid')
  const external = validateExternalSet(root)
  validateArtifactIndexCoverage(root, readCanonical(root, `${CLOSURE_ROOT}/artifact-index.json`, 16_777_216).value)
  const conclusionRows = conclusions(root)
  const { input, authority } = loadSealedControl(root)
  if (gateA.gate !== 'A' || gateA.decision !== 'PASS' || gateA.phase3b_usable !== false || gateA.external_set_sha256 !== external.external_set_sha256 || gateA.implementation_review_sha256 !== authority.implementation_review_sha256 || gateA.focused_suite_sha256 !== input.focused_suite_sha256 || gateA.gate_clock_sha256 !== gateAClock.clock_sha256 || gateAClock.gate !== 'A' || gateAClock.external_set_sha256 !== external.external_set_sha256 || gateAClock.controller_source_set_sha256 !== controllerSourceSetSha256() || gateAClock.controller_executable_sha256 !== controllerExecutableSha256() || gateAClock.toolchain_sha256 !== input.toolchain_sha256 || sha256Canonical(gateA.conclusion_sha256s) !== sha256Canonical(conclusionRows.map((row) => row.conclusion_sha256)) || sha256Canonical(gateAClock.conclusion_sha256s) !== sha256Canonical(conclusionRows.map((row) => row.conclusion_sha256))) throw new Phase3BProductionError('gate_a_invalid', 'operator decision requires the exact live Gate A inputs')
  const externalDecision = stableRead(signedDecisionPath, { mode: 0o600, maximumBytes: 1_048_576 })
  if (externalDecision.bytes.at(-1) !== 0x0a) throw new Phase3BProductionError('operator_decision_invalid', 'signed operator decision is not canonical newline JSON')
  let parsed: unknown
  try { parsed = JSON.parse(externalDecision.bytes.subarray(0, -1).toString('utf8')) } catch { throw new Phase3BProductionError('operator_decision_invalid', 'signed operator decision is invalid JSON') }
  assertExactKeys(parsed, ['schema_id', 'decision_id', 'decision', 'campaign_id', 'gate_a_path', 'gate_a_sha256', 'gate_a_clock_sha256', 'external_set_path', 'external_set_sha256', 'conclusion_paths', 'conclusion_sha256s', 'implementation_review_sha256', 'issued_at_ms', 'issued_monotonic_ns', 'maximum_evaluation_delay_ms', 'scope', 'prohibited_claims', 'reviewer_identity', 'reviewer_role', 'signing_key_id', 'signature_algorithm', 'signature', 'decision_sha256'], 'operator_decision_invalid')
  assertDigestField(parsed, 'decision_sha256', 'operator_decision_invalid')
  verifyTrustedSignature(parsed, loadTrustedReviewerRegistry(input.cc_repository, authority.reviewed_candidate_commit, authority.reviewed_candidate_tree), 'requirements', 'decision_sha256', 'operator_decision_invalid')
  const decision = deepFreeze(parsed)
  const issuedAt = Number(decision.issued_at_ms)
  const issuedMonotonic = BigInt(String(decision.issued_monotonic_ns))
  if (decision.schema_id !== 'oracle-lab-p3b-operator-decision.v2' || decision.decision !== 'evaluate_successor_amendment_startable' || decision.campaign_id !== gateA.campaign_id || decision.gate_a_path !== `${GATE_ROOT}/gate-a-result.json` || decision.gate_a_sha256 !== gateA.gate_result_sha256 || decision.gate_a_clock_sha256 !== gateAClock.clock_sha256 || decision.external_set_path !== `${CLOSURE_ROOT}/external-digest-set.json` || decision.external_set_sha256 !== external.external_set_sha256 || sha256Canonical(decision.conclusion_paths) !== sha256Canonical(CONCLUSION_IDS.map((id) => CONCLUSION_PATHS[id])) || sha256Canonical(decision.conclusion_sha256s) !== sha256Canonical(conclusionRows.map((row) => row.conclusion_sha256)) || decision.implementation_review_sha256 !== authority.implementation_review_sha256 || decision.maximum_evaluation_delay_ms !== OPERATOR_MAX_DELAY_MS || decision.scope !== SCOPE || sha256Canonical(decision.prohibited_claims) !== sha256Canonical(['production_ready', 'real_upstream_validated', 'real_credentials_validated', 'resume_supported', 'cross_platform_validated']) || !Number.isSafeInteger(issuedAt) || issuedAt < Number(gateAClock.wall_clock_ms) || issuedMonotonic < BigInt(String(gateAClock.monotonic_ns))) throw new Phase3BProductionError('operator_decision_invalid', 'signed operator decision does not bind the exact Gate A scope')
  writeGate(root, `${GATE_ROOT}/successor-amendment-decision.json`, decision)
  return decision
}

export function evaluateGateB(evidenceRoot: string): Readonly<Record<string, unknown>> {
  if (typeof evidenceRoot !== 'string') throw new Phase3BProductionError('gate_input_invalid', 'Gate B accepts only a sealed evidence root')
  const root = assertPrivateRuntimeRoot(evidenceRoot)
  assertFixedDirectory(root, GATE_ROOT, ['gate-a-clock.json', 'gate-a-result.json', 'successor-amendment-decision.json'])
  assertFixedDirectory(root, CLOSURE_ROOT, CLOSURE_FILES)
  const external = validateExternalSet(root)
  validateArtifactIndexCoverage(root, readCanonical(root, `${CLOSURE_ROOT}/artifact-index.json`, 16_777_216).value)
  const gateA = readCanonical(root, `${GATE_ROOT}/gate-a-result.json`).value
  const gateAClock = readCanonical(root, `${GATE_ROOT}/gate-a-clock.json`).value
  const decision = readCanonical(root, `${GATE_ROOT}/successor-amendment-decision.json`).value
  assertExactKeys(gateA, ['schema_id', 'gate', 'decision', 'campaign_id', 'external_set_sha256', 'terminal_manifest_sha256', 'implementation_review_sha256', 'focused_suite_sha256', 'conclusion_sha256s', 'gate_clock_sha256', 'phase3b_usable', 'gate_result_sha256'], 'gate_a_invalid')
  assertExactKeys(gateAClock, ['schema_id', 'gate', 'campaign_id', 'external_set_sha256', 'conclusion_sha256s', 'controller_source_set_sha256', 'controller_executable_sha256', 'toolchain_sha256', 'predecessor_clock_sha256', 'predecessor_wall_clock_ms', 'predecessor_monotonic_ns', 'wall_clock_ms', 'monotonic_ns', 'clock_sha256'], 'gate_clock_invalid')
  assertExactKeys(decision, ['schema_id', 'decision_id', 'decision', 'campaign_id', 'gate_a_path', 'gate_a_sha256', 'gate_a_clock_sha256', 'external_set_path', 'external_set_sha256', 'conclusion_paths', 'conclusion_sha256s', 'implementation_review_sha256', 'issued_at_ms', 'issued_monotonic_ns', 'maximum_evaluation_delay_ms', 'scope', 'prohibited_claims', 'reviewer_identity', 'reviewer_role', 'signing_key_id', 'signature_algorithm', 'signature', 'decision_sha256'], 'operator_decision_invalid')
  for (const [value, digest, code] of [[gateA, 'gate_result_sha256', 'gate_a_invalid'], [gateAClock, 'clock_sha256', 'gate_clock_invalid'], [decision, 'decision_sha256', 'operator_decision_invalid']] as const) assertDigestField(value, digest, code)
  if (gateA.gate !== 'A' || gateA.decision !== 'PASS' || gateA.phase3b_usable !== false || decision.decision !== 'evaluate_successor_amendment_startable' || decision.gate_a_sha256 !== gateA.gate_result_sha256 || decision.external_set_sha256 !== external.external_set_sha256 || decision.maximum_evaluation_delay_ms !== OPERATOR_MAX_DELAY_MS || decision.scope !== SCOPE) throw new Phase3BProductionError('operator_decision_invalid', 'operator decision scope or Gate A binding drifted')
  const conclusionRows = conclusions(root)
  const curationClock = validateCurationClock(root, conclusionRows)
  const supportSha256s = validateConclusionSupport(root, true)
  const now = Date.now()
  const nowMonotonic = process.hrtime.bigint()
  const issued = Number(decision.issued_at_ms)
  if (!Number.isSafeInteger(issued) || now < issued || now - issued > OPERATOR_MAX_DELAY_MS || nowMonotonic < BigInt(String(decision.issued_monotonic_ns)) || issued < Number(gateAClock.wall_clock_ms) || BigInt(String(decision.issued_monotonic_ns)) < BigInt(String(gateAClock.monotonic_ns))) throw new Phase3BProductionError('operator_decision_stale', 'operator decision is future, stale, monotonic-invalid, or predates Gate A')
  for (const conclusion of conclusionRows) {
    const createdAt = Number(conclusion.created_at_ms); const issuedAt = Number(conclusion.issued_at_ms); const expiresAt = Number(conclusion.expires_at_ms)
    if (conclusion.level !== 'Reproduced' || conclusion.enabled !== true || createdAt !== issuedAt || issuedAt !== Number(curationClock.created_at_ms) || !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || expiresAt !== issuedAt + SUCCESSOR_TTL_MS || issuedAt > now || now >= expiresAt || !Array.isArray(conclusion.contradiction_ids) || conclusion.contradiction_ids.length !== 0 || sha256Canonical(conclusion.supporting_evidence_sha256s) !== sha256Canonical(supportSha256s)) throw new Phase3BProductionError('conclusion_expiry_invalid', 'conclusion is Unknown, future, stale, expired, contradicted, or unsupported')
  }
  const expectedDigests = conclusionRows.map((row) => row.conclusion_sha256)
  if (sha256Canonical(decision.conclusion_paths) !== sha256Canonical(CONCLUSION_IDS.map((id) => CONCLUSION_PATHS[id])) || sha256Canonical(decision.conclusion_sha256s) !== sha256Canonical(expectedDigests) || sha256Canonical(gateA.conclusion_sha256s) !== sha256Canonical(expectedDigests) || sha256Canonical(gateAClock.conclusion_sha256s) !== sha256Canonical(expectedDigests)) throw new Phase3BProductionError('conclusion_invalid', 'decision/Gate A clock/result conclusion binding drifted')
  const { input, authority } = loadSealedControl(root)
  verifyTrustedSignature(decision, loadTrustedReviewerRegistry(input.cc_repository, authority.reviewed_candidate_commit, authority.reviewed_candidate_tree), 'requirements', 'decision_sha256', 'operator_decision_invalid')
  if (gateA.gate_clock_sha256 !== gateAClock.clock_sha256 || gateA.external_set_sha256 !== external.external_set_sha256 || gateAClock.gate !== 'A' || gateAClock.campaign_id !== gateA.campaign_id || gateAClock.external_set_sha256 !== external.external_set_sha256 || gateAClock.controller_source_set_sha256 !== controllerSourceSetSha256() || gateAClock.controller_executable_sha256 !== controllerExecutableSha256() || gateAClock.toolchain_sha256 !== input.toolchain_sha256 || decision.gate_a_clock_sha256 !== gateAClock.clock_sha256 || decision.implementation_review_sha256 !== authority.implementation_review_sha256 || decision.gate_a_path !== `${GATE_ROOT}/gate-a-result.json` || decision.external_set_path !== `${CLOSURE_ROOT}/external-digest-set.json`) throw new Phase3BProductionError('gate_a_invalid', 'Gate A clock/result/operator bindings drifted')
  const clock = captureClock(root, 'B', { sha256: String(gateAClock.clock_sha256), wall: Number(gateAClock.wall_clock_ms), monotonic: String(gateAClock.monotonic_ns) }, String(external.external_set_sha256), expectedDigests.map(String), input.toolchain_sha256)
  if (clock.wall_clock_ms < issued) throw new Phase3BProductionError('gate_clock_rollback', 'Gate B clock predates operator decision')
  writeGate(root, `${GATE_ROOT}/gate-b-clock.json`, clock)
  const unsigned = { schema_id: 'oracle-lab-p3b-gate-result.v1', gate: 'B', decision: 'PASS', campaign_id: gateA.campaign_id, gate_a_sha256: gateA.gate_result_sha256, external_set_sha256: external.external_set_sha256, operator_decision_sha256: decision.decision_sha256, conclusion_sha256s: expectedDigests, gate_clock_sha256: clock.clock_sha256, phase3b_usable: true }
  const result = deepFreeze({ ...unsigned, gate_result_sha256: sha256Canonical(unsigned) })
  writeGate(root, `${GATE_ROOT}/gate-b-result.json`, result)
  return result
}
import { lstatSync, readdirSync } from 'node:fs'
import path from 'node:path'
