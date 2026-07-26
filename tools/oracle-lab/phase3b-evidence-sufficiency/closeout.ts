import { Phase3BProductionError, assertDigestField, assertExactKeys, deepFreeze, sha256Bytes, sha256Canonical, utf8Compare } from './core.js'
import { deriveExecutionCounts, openExecutionStore, readCampaignFailure, readExecutionReceipts, type ExecutionReceipt } from './execution-store.js'
import { materializeResponseBody, type RunLedgerRow, validateCampaignLedger } from './ledger.js'
import { expectedAuthMarkerClass } from './scenario-input.js'
import { assertDirectoryEmpty, assertPrivateRuntimeRoot, createPrivateDirectory, readCanonical, stableRead, writeExclusiveCanonical } from './sealed-fs.js'
import { expectedSelectedRoute } from './route-policy.js'

export const CONCLUSION_IDS = ['CL-P3B-ES1-CONFIG-AUTH-REVALIDATED', 'CL-P3B-ES1-NEW-SESSION-WIRE', 'CL-P3B-ES1-FAILURE-RECOVERY'] as const
export const CONCLUSION_PATHS = {
  'CL-P3B-ES1-CONFIG-AUTH-REVALIDATED': 'capsules/P3B-ES1/curation/conclusions/config-auth-revalidated.json',
  'CL-P3B-ES1-NEW-SESSION-WIRE': 'capsules/P3B-ES1/curation/conclusions/new-session-wire.json',
  'CL-P3B-ES1-FAILURE-RECOVERY': 'capsules/P3B-ES1/curation/conclusions/failure-recovery.json',
} as const
export const SUCCESSOR_TTL_MS = 1_209_600_000
const CLOSURE_ORDER = ['artifact-index', 'leak-report', 'exit-report', 'handoff', 'terminal-manifest'] as const
const CURATION_ROOT = 'capsules/P3B-ES1/curation'
const CLOSURE_ROOT = 'capsules/P3B-ES1/closure'
const SUPPORT_ROOT = 'capsules/P3B-ES1/curation/support'
export const SUPPORT_PATHS = ['typed-wire-fixtures.json', 'candidate-field-closure.json', 'field-provenance.json', 'cross-repo-result.json', 'predecessor-semantic-comparison.json'].map((name) => `${SUPPORT_ROOT}/${name}`) as readonly string[]

type ArtifactEntry = Readonly<{ name: string; relative_path: string; schema_id: string; size_bytes: number; sha256: string }>

function optionalCanonical(root: string, relative: string): { value: Record<string, unknown>; entry: ArtifactEntry } | null {
  try {
    const record = readCanonical(root, relative, 16_777_216)
    return { value: record.value, entry: { name: relative, relative_path: relative, schema_id: String(record.value.schema_id), size_bytes: record.identity.size, sha256: record.identity.sha256 } }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function inventoryNamespace(root: string): readonly ArtifactEntry[] {
  const entries: ArtifactEntry[] = []
  const walk = (relativeDirectory: string) => {
    const absolute = relativeDirectory ? path.join(root, relativeDirectory) : root
    for (const name of readdirSync(absolute).sort(utf8Compare)) {
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name
      if (relative === CLOSURE_ROOT || relative.startsWith(`${CLOSURE_ROOT}/`) || relative === 'capsules/P3B-ES1/gates' || relative.startsWith('capsules/P3B-ES1/gates/')) continue
      const file = path.join(root, relative)
      const stat = lstatSync(file)
      if (stat.isSymbolicLink()) throw new Phase3BProductionError('artifact_index_invalid', 'runtime namespace contains a symlink')
      if (stat.isDirectory()) { walk(relative); continue }
      if (!stat.isFile() || stat.nlink !== 1) throw new Phase3BProductionError('artifact_index_invalid', 'runtime namespace contains a non-regular or hard-linked leaf')
      const stable = stableRead(file, { maximumBytes: 134_217_728, nonempty: false })
      let schemaId = 'opaque-bytes'
      try { schemaId = String(readCanonical(root, relative, 134_217_728).value.schema_id ?? 'canonical-json') } catch {}
      entries.push({ name: relative, relative_path: relative, schema_id: schemaId, size_bytes: stable.identity.size, sha256: stable.identity.sha256 })
    }
  }
  walk('')
  return deepFreeze(entries.sort((left, right) => utf8Compare(left.relative_path, right.relative_path)))
}

export function validateArtifactIndexCoverage(root: string, artifactIndex: Record<string, unknown>): void {
  assertExactKeys(artifactIndex, ['schema_id', 'campaign_id', 'ledger_sha256', 'entries', 'artifact_index_sha256'], 'artifact_index_invalid')
  assertDigestField(artifactIndex, 'artifact_index_sha256', 'artifact_index_invalid')
  if (artifactIndex.schema_id !== 'oracle-lab-p3b-artifact-index.v1' || !Array.isArray(artifactIndex.entries) || sha256Canonical(artifactIndex.entries) !== sha256Canonical(inventoryNamespace(root))) throw new Phase3BProductionError('artifact_index_invalid', 'artifact index does not cover every live non-closure namespace leaf')
}

function validateObservation(value: Record<string, unknown>, row: RunLedgerRow): Readonly<{ sha256: string; projection: Readonly<Record<string, unknown>> }> {
  assertExactKeys(value, ['schema_id', 'campaign_id', 'ledger_sha256', 'run_id', 'sequence_index', 'receiver_group_id', 'receiver_instance_id', 'receiver_authority_sha256', 'target_pid', 'target_instance_id', 'executable_identity_sha256', 'route_ordinal', 'connection_ordinal', 'attempt_ordinal', 'action_ordinal', 'method', 'path', 'query_present', 'ordered_header_classes', 'header_presence', 'auth_marker_winner_class', 'body_byte_length', 'body_sha256', 'body_ast', 'response_program_sha256', 'response', 'observation_sha256'], 'observation_invalid')
  assertDigestField(value, 'observation_sha256', 'observation_invalid')
  if (value.schema_id !== 'oracle-lab-p3b-wire-observation.v1' || value.run_id !== row.run_id || value.sequence_index !== row.sequence_index || value.receiver_group_id !== row.receiver_group_id || value.response_program_sha256 !== row.response_program_sha256 || typeof value.attempt_ordinal !== 'number' || typeof value.connection_ordinal !== 'number' || typeof value.action_ordinal !== 'number') throw new Phase3BProductionError('observation_invalid', 'observation row/program/ordinal binding drifted')
  const attempt = Number(value.attempt_ordinal)
  const action = row.response_program.actions[attempt]
  const response = value.response as Record<string, unknown> | undefined
  if (response) assertExactKeys(response, ['status', 'ordered_header_classes', 'body_byte_length', 'body_sha256', 'sse_event_order', 'transport_terminal', 'delay_elapsed_ns', 'timing_bucket'], 'observation_invalid')
  const expectedBody = Buffer.from(materializeResponseBody(action?.body_kind ?? 'empty'), 'utf8')
  const expectedEvents = action.body_kind === 'complete_sse' ? ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop'] : action.body_kind === 'partial_sse' ? ['message_start', 'content_block_start', 'content_block_delta'] : []
  const elapsed = response && /^\d+$/.test(String(response.delay_elapsed_ns)) ? BigInt(String(response.delay_elapsed_ns)) : -1n
  const expectedTimingBucket = action.delay_class === 'bounded_before_headers' ? elapsed >= BigInt(action.delay_ms) * 1_000_000n ? 'at_or_after_boundary' : 'before_boundary' : 'not_delayed'
  if (!action || !response || elapsed < 0n || response.status !== action.status || response.transport_terminal !== action.transport_terminal || expectedTimingBucket !== (action.delay_class === 'bounded_before_headers' ? 'at_or_after_boundary' : 'not_delayed') || response.timing_bucket !== expectedTimingBucket || response.body_byte_length !== expectedBody.length || response.body_sha256 !== sha256Bytes(expectedBody) || sha256Canonical(response.ordered_header_classes) !== sha256Canonical(action.ordered_headers) || sha256Canonical(response.sse_event_order) !== sha256Canonical(expectedEvents)) throw new Phase3BProductionError('observation_invalid', 'measured response bytes/status/headers/events/timing/terminal drifted from sealed program')
  if (row.family === 'auth' && value.auth_marker_winner_class !== expectedAuthMarkerClass(row)) throw new Phase3BProductionError('observation_invalid', 'actual synthetic auth marker does not match the sealed auth arm')
  return deepFreeze({
    sha256: String(value.observation_sha256),
    projection: {
      route_ordinal: value.route_ordinal,
      connection_ordinal: value.connection_ordinal,
      attempt_ordinal: value.attempt_ordinal,
      action_ordinal: value.action_ordinal,
      method: value.method,
      path: value.path,
      query_present: value.query_present,
      ordered_header_classes: value.ordered_header_classes,
      header_presence: value.header_presence,
      auth_marker_winner_class: value.auth_marker_winner_class,
      body_byte_length: value.body_byte_length,
      body_sha256: value.body_sha256,
      body_ast: value.body_ast,
      response,
    },
  })
}

function unknownRow(row: RunLedgerRow, reasonCode: string): Readonly<Record<string, unknown>> {
  return deepFreeze({ run_id: row.run_id, sequence_index: row.sequence_index, family: row.family, schedule_id: row.schedule_id, arm: row.arm, repetition: row.repetition, status: 'Unknown', enabled: false, reason_code: reasonCode, projection_sha256: null })
}

function classifyRow(root: string, row: RunLedgerRow, terminal: ExecutionReceipt | null): Readonly<Record<string, unknown>> {
  if (terminal?.terminal_class !== 'success') return unknownRow(row, terminal?.terminal_class === 'not_executed' ? 'dependency_failure_not_executed' : 'target_terminal_not_success')
  const receiver = optionalCanonical(root, `receiver-results/${String(row.sequence_index).padStart(3, '0')}-${row.run_id}.json`)
  const receiverAuthority = optionalCanonical(root, `receiver-authorities/${String(row.sequence_index).padStart(3, '0')}-${row.run_id}.json`)
  const launchAuthority = optionalCanonical(root, `launch-authorities/${String(row.sequence_index).padStart(3, '0')}-${row.run_id}.json`)
  const inputDescriptor = optionalCanonical(root, `runs/${String(row.sequence_index).padStart(3, '0')}-${row.run_id}/input-descriptor.json`)
  const cell = optionalCanonical(root, `cell-results/${String(row.sequence_index).padStart(3, '0')}-${row.run_id}.json`)
  const guard = optionalCanonical(root, `guards/${String(row.sequence_index).padStart(3, '0')}-${row.run_id}.json`)
  if (!receiver || !receiverAuthority || !launchAuthority || !inputDescriptor || !cell || !guard) return unknownRow(row, 'sealed_result_missing')
  assertExactKeys(receiver.value, ['schema_id', 'campaign_id', 'ledger_sha256', 'run_id', 'sequence_index', 'receiver_group_id', 'receiver_authority_sha256', 'request_count', 'response_count', 'route_request_counts', 'attempt_ordinals', 'connection_ordinals', 'action_ordinals', 'observation_sha256s', 'receiver_terminal', 'result_sha256'], 'receiver_terminal_invalid')
  assertExactKeys(receiverAuthority.value, ['schema_id', 'campaign_id', 'ledger_sha256', 'run_id', 'sequence_index', 'receiver_group_id', 'receiver_pid', 'receiver_executable_identity_sha256', 'receiver_source_sha256', 'receiver_schema_sha256', 'anchor_sha256', 'response_program_sha256', 'routes', 'authority_sha256'], 'receiver_authority_invalid')
  if (!Array.isArray(receiverAuthority.value.routes) || receiverAuthority.value.routes.length !== row.route_count) throw new Phase3BProductionError('receiver_authority_invalid', 'receiver route set is not exact')
  for (const route of receiverAuthority.value.routes) assertExactKeys(route, ['route_ordinal', 'receiver_instance_id', 'host', 'port', 'expected_selected', 'listener_identity_sha256'], 'receiver_authority_invalid')
  assertExactKeys(launchAuthority.value, ['schema_id', 'campaign_id', 'ledger_sha256', 'run_id', 'sequence_index', 'row_sha256', 'family', 'schedule_id', 'seed', 'repetition', 'arm', 'argv_sha256', 'request_stimulus_sha256', 'environment_policy_sha256', 'cwd_sha256', 'stdin_sha256', 'literal_table_sha256', 'response_program_sha256', 'guard_profile_sha256', 'anchor_sha256', 'receiver_authority_sha256', 'launch_image_record_sha256', 'executable_identity_sha256', 'target_launches_before', 'target_launch_ceiling', 'receipt_sha256'], 'launch_authority_invalid')
  assertExactKeys(inputDescriptor.value, ['schema_id', 'campaign_id', 'ledger_sha256', 'run_id', 'sequence_index', 'row_sha256', 'argv_sha256', 'request_stimulus_sha256', 'environment_sha256', 'cwd_sha256', 'stdin_sha256', 'launch_authority_sha256', 'route_authorities_sha256', 'input_class_sha256s', 'sandbox_profile_sha256', 'unknown_or_omitted', 'raw_material_persisted', 'input_descriptor_sha256'], 'scenario_input_invalid')
  assertExactKeys(guard.value, ['schema_id', 'run_id', 'sequence_index', 'profile_sha256', 'allowed_loopback_ports', 'allowed_write_sha256', 'external_socket_budget', 'same_scope_probe', 'status', 'guard_receipt_sha256'], 'guard_receipt_invalid')
  assertExactKeys(cell.value, ['schema_id', 'campaign_id', 'ledger_sha256', 'run_id', 'sequence_index', 'family', 'schedule_id', 'seed', 'repetition', 'arm', 'row_sha256', 'launch_authority_sha256', 'receiver_authority_sha256', 'launch_image_record_sha256', 'executable_identity_sha256', 'input_descriptor_sha256', 'sandbox_profile_sha256', 'terminal_class', 'terminal_receipt_sha256', 'receiver_result_sha256', 'guard_receipt_sha256', 'target_terminal', 'stdout', 'stderr', 'external_socket_count', 'raw_material_persisted', 'cell_result_sha256'], 'cell_result_invalid')
  assertExactKeys(cell.value.target_terminal, ['exit_code', 'signal'], 'cell_result_invalid')
  assertExactKeys(cell.value.stdout, ['byte_length', 'safe_output_class', 'safe_output_sha256'], 'cell_result_invalid')
  assertExactKeys(cell.value.stderr, ['byte_length', 'safe_diagnostic'], 'cell_result_invalid')
  assertExactKeys((cell.value.stderr as Record<string, unknown>).safe_diagnostic, ['categories', 'normalized_sha256'], 'cell_result_invalid')
  assertDigestField(receiver.value, 'result_sha256', 'receiver_terminal_invalid')
  assertDigestField(receiverAuthority.value, 'authority_sha256', 'receiver_authority_invalid')
  assertDigestField(launchAuthority.value, 'receipt_sha256', 'launch_authority_invalid')
  assertDigestField(inputDescriptor.value, 'input_descriptor_sha256', 'scenario_input_invalid')
  assertDigestField(cell.value, 'cell_result_sha256', 'cell_result_invalid')
  assertDigestField(guard.value, 'guard_receipt_sha256', 'guard_receipt_invalid')
  const allowedWrite = optionalCanonical(root, `runs/${String(row.sequence_index).padStart(3, '0')}-${row.run_id}/guard-allowed.tmp`)
  if (!allowedWrite || allowedWrite.entry.sha256 !== guard.value.allowed_write_sha256 || allowedWrite.value.schema_id !== 'oracle-lab-p3b-guard-write.v1' || allowedWrite.value.value !== 'synthetic') return unknownRow(row, 'guard_write_binding_mismatch')
  const attempts = receiver.value.attempt_ordinals
  const connections = receiver.value.connection_ordinals
  const actions = receiver.value.action_ordinals
  const observationSha256s = receiver.value.observation_sha256s
  const stdout = cell.value.stdout as Record<string, unknown> | undefined
  const expectsComplete = row.response_program.actions.at(-1)?.body_kind === 'complete_sse'
  const outputValid = stdout && (expectsComplete
    ? stdout.safe_output_class === 'synthetic-output-complete' && stdout.safe_output_sha256 === sha256Bytes(Buffer.from('output.complete', 'utf8'))
    : stdout.safe_output_class !== 'synthetic-output-complete' && stdout.safe_output_sha256 === null)
  const connectionOrderValid = Array.isArray(connections) && connections.every((value, index) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= index && (index === 0 ? value === 0 : value === connections[index - 1] || value === Number(connections[index - 1]) + 1))
  const routeCounts = receiver.value.route_request_counts
  const selectedRoute = expectedSelectedRoute(row)
  const routeCountsValid = Array.isArray(routeCounts) && routeCounts.length === row.route_count && routeCounts.every((value, index) => value === (index === selectedRoute ? row.response_program.maximum_attempts : 0))
  if (launchAuthority.value.row_sha256 !== row.row_sha256 || launchAuthority.value.run_id !== row.run_id || launchAuthority.value.argv_sha256 !== row.argv_sha256 || launchAuthority.value.request_stimulus_sha256 !== row.request_stimulus_sha256 || launchAuthority.value.guard_profile_sha256 !== guard.value.profile_sha256 || launchAuthority.value.receiver_authority_sha256 !== receiverAuthority.value.authority_sha256 || inputDescriptor.value.run_id !== row.run_id || inputDescriptor.value.row_sha256 !== row.row_sha256 || inputDescriptor.value.argv_sha256 !== row.argv_sha256 || inputDescriptor.value.request_stimulus_sha256 !== row.request_stimulus_sha256 || inputDescriptor.value.launch_authority_sha256 !== launchAuthority.value.receipt_sha256 || inputDescriptor.value.sandbox_profile_sha256 !== guard.value.profile_sha256 || receiver.value.run_id !== row.run_id || receiver.value.receiver_group_id !== row.receiver_group_id || receiver.value.receiver_authority_sha256 !== receiverAuthority.value.authority_sha256 || receiver.value.request_count !== row.response_program.maximum_attempts || receiver.value.response_count !== row.response_program.maximum_attempts || receiver.value.receiver_terminal !== 'sealed' || cell.value.run_id !== row.run_id || cell.value.row_sha256 !== row.row_sha256 || cell.value.launch_authority_sha256 !== launchAuthority.value.receipt_sha256 || cell.value.receiver_authority_sha256 !== receiverAuthority.value.authority_sha256 || cell.value.input_descriptor_sha256 !== inputDescriptor.value.input_descriptor_sha256 || cell.value.sandbox_profile_sha256 !== guard.value.profile_sha256 || cell.value.terminal_class !== 'success' || cell.value.terminal_receipt_sha256 !== terminal.receipt_sha256 || cell.value.guard_receipt_sha256 !== guard.value.guard_receipt_sha256 || !outputValid || !routeCountsValid || cell.value.receiver_result_sha256 !== receiver.value.result_sha256 || !Array.isArray(attempts) || !Array.isArray(actions) || !Array.isArray(observationSha256s) || attempts.length !== row.response_program.maximum_attempts || attempts.some((value, index) => value !== index) || !connectionOrderValid || actions.some((value, index) => value !== row.response_program.actions[index].action_ordinal)) return unknownRow(row, 'receiver_attempt_or_terminal_mismatch')
  const observationProjections: Readonly<Record<string, unknown>>[] = []
  for (let attempt = 0; attempt < row.response_program.maximum_attempts; attempt += 1) {
    const observation = optionalCanonical(root, `observations/${String(row.sequence_index).padStart(3, '0')}-${row.run_id}-${String(attempt).padStart(2, '0')}.json`)
    if (!observation) return unknownRow(row, 'observation_missing')
    if (observation.value.receiver_authority_sha256 !== receiverAuthority.value.authority_sha256 || observation.value.executable_identity_sha256 !== cell.value.executable_identity_sha256) return unknownRow(row, 'observation_binding_mismatch')
    const validated = validateObservation(observation.value, row)
    if (validated.sha256 !== observationSha256s[attempt]) return unknownRow(row, 'observation_binding_mismatch')
    observationProjections.push(validated.projection)
  }
  const stderr = cell.value.stderr as Record<string, unknown> | undefined
  const targetTerminal = cell.value.target_terminal as Record<string, unknown> | undefined
  const projection = {
    schedule_id: row.schedule_id,
    semantic_arm: row.arm.includes('/') ? row.arm.split('/')[0] : 'single',
    observations: observationProjections,
    target_terminal: targetTerminal,
    safe_output: { safe_output_class: stdout?.safe_output_class, safe_output_sha256: stdout?.safe_output_sha256 },
    safe_diagnostic_categories: (stderr?.safe_diagnostic as Record<string, unknown> | undefined)?.categories ?? [],
    external_socket_count: cell.value.external_socket_count,
  }
  return deepFreeze({ run_id: row.run_id, sequence_index: row.sequence_index, family: row.family, schedule_id: row.schedule_id, arm: row.arm, repetition: row.repetition, status: 'Reproduced', enabled: true, reason_code: 'sealed_receipt_projection', projection_sha256: sha256Canonical(projection) })
}

function enforcePairAndRepetitionStability(ledgerRows: readonly RunLedgerRow[], inputRows: readonly Readonly<Record<string, unknown>>[]): readonly Readonly<Record<string, unknown>>[] {
  const rows = inputRows.map((row) => ({ ...row }))
  const bySequence = new Map(rows.map((row) => [Number(row.sequence_index), row]))
  const markUnknown = (members: readonly RunLedgerRow[]) => {
    for (const member of members) {
      const current = bySequence.get(member.sequence_index)!
      if (current.status === 'Reproduced') Object.assign(current, { status: 'Unknown', enabled: false, reason_code: 'pair_or_repetition_mismatch', projection_sha256: null })
    }
  }
  const semanticArm = (row: RunLedgerRow) => row.arm.includes('/') ? row.arm.split('/')[0] : 'single'
  const instrumentation = (row: RunLedgerRow) => row.arm.endsWith('uninstrumented') ? 'uninstrumented' : 'instrumented'
  const pairGroups = new Map<string, RunLedgerRow[]>()
  const repetitionGroups = new Map<string, RunLedgerRow[]>()
  for (const row of ledgerRows) {
    const pairKey = `${row.schedule_id}\u0000${semanticArm(row)}\u0000${row.repetition}`
    const repetitionKey = `${row.schedule_id}\u0000${semanticArm(row)}\u0000${instrumentation(row)}`
    pairGroups.set(pairKey, [...(pairGroups.get(pairKey) ?? []), row])
    repetitionGroups.set(repetitionKey, [...(repetitionGroups.get(repetitionKey) ?? []), row])
  }
  for (const members of pairGroups.values()) {
    const projections = members.map((member) => bySequence.get(member.sequence_index)?.projection_sha256)
    if (members.length !== 2 || projections.some((value) => typeof value !== 'string') || new Set(projections).size !== 1) markUnknown(members)
  }
  for (const members of repetitionGroups.values()) {
    const projections = members.map((member) => bySequence.get(member.sequence_index)?.projection_sha256)
    if (members.length !== 5 || projections.some((value) => typeof value !== 'string') || new Set(projections).size !== 1) markUnknown(members)
  }
  return deepFreeze(rows)
}

export function sealTargetControlTranche(evidenceRoot: string): Readonly<Record<string, unknown>> {
  const root = assertPrivateRuntimeRoot(evidenceRoot)
  createPrivateDirectory(root, 'target-controls')
  const ledger = validateCampaignLedger(readCanonical(root, 'prelaunch/run-ledger.json', 16_777_216).value)
  const store = openExecutionStore(root, ledger)
  const receipts = readExecutionReceipts(store)
  const terminalByRow = new Map(receipts.filter((receipt) => receipt.state === 'terminal').map((receipt) => [receipt.sequence_index, receipt]))
  const controls = ledger.rows.slice(0, 20)
  const rows = enforcePairAndRepetitionStability(controls, controls.map((row) => classifyRow(root, row, terminalByRow.get(row.sequence_index) ?? null)))
  if (receipts.some((receipt) => receipt.sequence_index >= 20) || rows.length !== 20 || rows.some((row) => row.status !== 'Reproduced')) throw new Phase3BProductionError('control_tranche_failed', 'mandatory target control projections are incomplete, unstable, or already bypassed')
  const unsigned = { schema_id: 'oracle-lab-p3b-target-control-result.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, sequence_indexes: controls.map((row) => row.sequence_index), projection_sha256s: rows.map((row) => row.projection_sha256), status: 'PASS' }
  const result = deepFreeze({ ...unsigned, control_result_sha256: sha256Canonical(unsigned) })
  writeExclusiveCanonical(root, 'target-controls/result.json', result)
  return result
}

function conclusionFamily(id: typeof CONCLUSION_IDS[number]): readonly string[] {
  if (id === 'CL-P3B-ES1-CONFIG-AUTH-REVALIDATED') return ['config', 'auth']
  if (id === 'CL-P3B-ES1-NEW-SESSION-WIRE') return ['request_wire']
  return ['response_failure_recovery']
}

function writeSupportRecord(root: string, relative: string, unsigned: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const value = deepFreeze({ ...unsigned, support_sha256: sha256Canonical(unsigned) })
  writeExclusiveCanonical(root, relative, value)
  return value
}

function sealConclusionSupport(root: string, ledger: ReturnType<typeof validateCampaignLedger>, rows: readonly Readonly<Record<string, unknown>>[]): readonly Readonly<Record<string, unknown>>[] {
  createPrivateDirectory(root, SUPPORT_ROOT)
  const fixtureRows = ledger.rows.map((row) => {
    const classified = rows[row.sequence_index]
    if (classified.status !== 'Reproduced') return { sequence_index: row.sequence_index, run_id: row.run_id, family: row.family, schedule_id: row.schedule_id, request_stimulus_sha256: row.request_stimulus_sha256, status: 'Unknown', request_projection_sha256: null, response_projection_sha256: null, observation_sha256s: [] }
    const observations = row.response_program.actions.map((_, attempt) => readCanonical(root, `observations/${String(row.sequence_index).padStart(3, '0')}-${row.run_id}-${String(attempt).padStart(2, '0')}.json`).value)
    return { sequence_index: row.sequence_index, run_id: row.run_id, family: row.family, schedule_id: row.schedule_id, request_stimulus_sha256: row.request_stimulus_sha256, status: 'Reproduced', request_projection_sha256: sha256Canonical(observations.map((value) => ({ method: value.method, path: value.path, query_present: value.query_present, ordered_header_classes: value.ordered_header_classes, header_presence: value.header_presence, auth_marker_winner_class: value.auth_marker_winner_class, body_byte_length: value.body_byte_length, body_sha256: value.body_sha256, body_ast: value.body_ast }))), response_projection_sha256: sha256Canonical(observations.map((value) => value.response)), observation_sha256s: observations.map((value) => value.observation_sha256) }
  })
  const allReproduced = fixtureRows.every((row) => row.status === 'Reproduced')
  const fixtures = writeSupportRecord(root, SUPPORT_PATHS[0], { schema_id: 'oracle-lab-p3b-typed-wire-fixtures.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, rows: fixtureRows, status: allReproduced ? 'PASS' : 'INCOMPLETE' })
  const fieldClosure = writeSupportRecord(root, SUPPORT_PATHS[1], { schema_id: 'oracle-lab-p3b-candidate-field-closure.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, typed_wire_fixtures_sha256: fixtures.support_sha256, closed_fields: { observation: ['schema_id', 'campaign_id', 'ledger_sha256', 'run_id', 'sequence_index', 'receiver_group_id', 'receiver_instance_id', 'receiver_authority_sha256', 'target_pid', 'target_instance_id', 'executable_identity_sha256', 'route_ordinal', 'connection_ordinal', 'attempt_ordinal', 'action_ordinal', 'method', 'path', 'query_present', 'ordered_header_classes', 'header_presence', 'auth_marker_winner_class', 'body_byte_length', 'body_sha256', 'body_ast', 'response_program_sha256', 'response', 'observation_sha256'], response: ['status', 'ordered_header_classes', 'body_byte_length', 'body_sha256', 'sse_event_order', 'transport_terminal', 'delay_elapsed_ns', 'timing_bucket'], unknown_fields: 'rejected' }, status: allReproduced ? 'PASS' : 'INCOMPLETE' })
  const conclusionSources = Object.fromEntries(CONCLUSION_IDS.map((id) => [id, ledger.rows.filter((row) => conclusionFamily(id).includes(row.family)).map((row) => ({ sequence_index: row.sequence_index, run_id: row.run_id, row_sha256: row.row_sha256, projection_sha256: rows[row.sequence_index].projection_sha256 }))]))
  const sourceControlSha256s = ['control/campaign-input.json', 'control/operator-authority.json', 'control/implementation-review.json'].map((relative) => optionalCanonical(root, relative)?.entry.sha256 ?? null)
  const provenance = writeSupportRecord(root, SUPPORT_PATHS[2], { schema_id: 'oracle-lab-p3b-field-provenance.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, typed_wire_fixtures_sha256: fixtures.support_sha256, candidate_field_closure_sha256: fieldClosure.support_sha256, conclusion_sources: conclusionSources, source_control_sha256s: sourceControlSha256s, status: allReproduced && sourceControlSha256s.every((value) => value !== null) ? 'PASS' : 'INCOMPLETE' })
  const crossRepoIdentity = optionalCanonical(root, 'control/cross-repo-review.json')?.entry
  const implementationReviewIdentity = optionalCanonical(root, 'control/implementation-review.json')?.entry
  const crossRepoPass = crossRepoIdentity?.sha256 === ledger.c1.review_sha256 && implementationReviewIdentity !== undefined
  const crossRepo = writeSupportRecord(root, SUPPORT_PATHS[3], { schema_id: 'oracle-lab-p3b-cross-repo-result.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, repositories: ledger.authority, c1: ledger.c1, actual_cross_repo_review_sha256: crossRepoIdentity?.sha256 ?? null, trusted_implementation_review_sha256: implementationReviewIdentity?.sha256 ?? null, status: crossRepoPass ? 'PASS' : 'BLOCKED' })
  const predecessorConfig = optionalCanonical(root, 'control/predecessor-config-auth.json')?.entry
  const predecessorFailure = optionalCanonical(root, 'control/predecessor-failure-stream.json')?.entry
  const mappings = [
    { predecessor_id: 'CL-P3A-R2-CONFIG-AUTH', predecessor_sha256: predecessorConfig?.sha256 ?? null, schedules: ledger.rows.filter((row) => row.family === 'config' || row.family === 'auth').map((row) => row.schedule_id) },
    { predecessor_id: 'CL-P3A-R2-FAILURE-STREAM', predecessor_sha256: predecessorFailure?.sha256 ?? null, schedules: ['complete_sse', 'http_400_terminal', 'http_401_terminal', 'http_403_terminal', 'http_429_terminal', 'http_500_terminal', 'http_529_terminal', 'partial_sse_then_eof', 'reset_terminal'] },
  ].map((mapping) => ({ ...mapping, schedules: [...new Set(mapping.schedules)].sort(utf8Compare), reproduced_schedule_ids: [...new Set(ledger.rows.filter((row) => mapping.schedules.includes(row.schedule_id) && rows[row.sequence_index].status === 'Reproduced').map((row) => row.schedule_id))].sort(utf8Compare) }))
  const predecessorPass = predecessorConfig?.sha256 === ledger.predecessor.conclusions['CL-P3A-R2-CONFIG-AUTH'] && predecessorFailure?.sha256 === ledger.predecessor.conclusions['CL-P3A-R2-FAILURE-STREAM'] && mappings.every((mapping) => sha256Canonical(mapping.schedules) === sha256Canonical(mapping.reproduced_schedule_ids))
  const predecessor = writeSupportRecord(root, SUPPORT_PATHS[4], { schema_id: 'oracle-lab-p3b-predecessor-semantic-comparison.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, predecessor_scope: ledger.predecessor.scope, mappings, status: predecessorPass ? 'PASS' : 'INCOMPLETE' })
  return deepFreeze([fixtures, fieldClosure, provenance, crossRepo, predecessor])
}

export function validateConclusionSupport(root: string, requirePass: boolean): readonly string[] {
  const expectedSchemas = ['oracle-lab-p3b-typed-wire-fixtures.v1', 'oracle-lab-p3b-candidate-field-closure.v1', 'oracle-lab-p3b-field-provenance.v1', 'oracle-lab-p3b-cross-repo-result.v1', 'oracle-lab-p3b-predecessor-semantic-comparison.v1']
  return SUPPORT_PATHS.map((relative, index) => {
    const value = readCanonical(root, relative, 16_777_216).value
    assertDigestField(value, 'support_sha256', 'conclusion_support_invalid')
    if (value.schema_id !== expectedSchemas[index] || (requirePass && value.status !== 'PASS')) throw new Phase3BProductionError('conclusion_support_invalid', 'fixed conclusion support is missing, incomplete, or has wrong schema')
    return String(value.support_sha256)
  })
}

export function deriveCuration(evidenceRoot: string): Readonly<Record<string, unknown>> {
  const root = assertPrivateRuntimeRoot(evidenceRoot)
  createPrivateDirectory(root, CURATION_ROOT)
  createPrivateDirectory(root, `${CURATION_ROOT}/conclusions`)
  const ledger = validateCampaignLedger(readCanonical(root, 'prelaunch/run-ledger.json', 16_777_216).value)
  const store = openExecutionStore(root, ledger)
  const receipts = readExecutionReceipts(store)
  const terminalByRow = new Map(receipts.filter((receipt) => receipt.state === 'terminal' || receipt.state === 'not_executed').map((receipt) => [receipt.sequence_index, receipt]))
  const rows = enforcePairAndRepetitionStability(ledger.rows, ledger.rows.map((row) => classifyRow(root, row, terminalByRow.get(row.sequence_index) ?? null)))
  const represented = rows.length === 340 && rows.every((row, index) => row.sequence_index === index)
  if (!represented) throw new Phase3BProductionError('curation_invalid', 'curation must explicitly represent all 340 rows')
  const issuedAt = Date.now()
  const issuedMonotonic = process.hrtime.bigint().toString()
  const lastReceipt = receipts.at(-1)
  const lastTerminal = [...receipts].reverse().find((receipt) => receipt.state === 'terminal')
  const clockUnsigned = { schema_id: 'oracle-lab-p3b-curation-clock.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, receipt_set_sha256: sha256Canonical(receipts), predecessor_receipt_sha256: lastReceipt?.receipt_sha256 ?? null, predecessor_terminal_receipt_sha256: lastTerminal?.receipt_sha256 ?? null, predecessor_terminal_monotonic_ns: lastTerminal?.terminal_monotonic_ns ?? null, created_at_ms: issuedAt, created_monotonic_ns: issuedMonotonic }
  const curationClock = deepFreeze({ ...clockUnsigned, clock_sha256: sha256Canonical(clockUnsigned) })
  writeExclusiveCanonical(root, `${CURATION_ROOT}/clock-attestation.json`, curationClock)
  const openContradictionIds = [...new Set(rows.filter((row) => row.status !== 'Reproduced').map((row) => `P3B-UNKNOWN-${String(row.schedule_id).toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`))].sort(utf8Compare)
  const support = sealConclusionSupport(root, ledger, rows)
  const supportSha256s = support.map((value) => value.support_sha256)
  if (support.some((value) => value.status !== 'PASS')) openContradictionIds.push('P3B-CONCLUSION-SUPPORT-INCOMPLETE')
  const conclusionRecords: Array<Readonly<Record<string, unknown>>> = []
  for (const conclusionId of CONCLUSION_IDS) {
    const familyRows = rows.filter((row) => conclusionFamily(conclusionId).includes(String(row.family)))
    const reproduced = familyRows.length > 0 && familyRows.every((row) => row.status === 'Reproduced') && support.every((value) => value.status === 'PASS')
    const familyContradictions = openContradictionIds.filter((id) => id === 'P3B-CONCLUSION-SUPPORT-INCOMPLETE' || familyRows.some((row) => id.endsWith(String(row.schedule_id).toUpperCase().replace(/[^A-Z0-9]+/g, '-'))))
    const unsigned = { schema_id: 'oracle-lab-p3b-successor-conclusion.v1', conclusion_id: conclusionId, campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, level: reproduced ? 'Reproduced' : 'Unknown', enabled: reproduced, created_at_ms: issuedAt, issued_at_ms: issuedAt, expires_at_ms: issuedAt + SUCCESSOR_TTL_MS, clock_attestation_sha256: curationClock.clock_sha256, contradiction_ids: familyContradictions, source_row_set_sha256: sha256Canonical(familyRows), supporting_evidence_sha256s: supportSha256s, unknown_or_omitted: 'disabled' }
    const conclusion = deepFreeze({ ...unsigned, conclusion_sha256: sha256Canonical(unsigned) })
    writeExclusiveCanonical(root, CONCLUSION_PATHS[conclusionId], conclusion)
    conclusionRecords.push(conclusion)
  }
  const predecessorOverlap = ['complete_sse', 'http_400_terminal', 'http_401_terminal', 'http_403_terminal', 'http_429_terminal', 'http_500_terminal', 'http_529_terminal', 'partial_sse_then_eof', 'reset_terminal'].sort(utf8Compare)
  const reproducedOverlap = [...new Set(ledger.rows.filter((row) => row.family === 'response_failure_recovery' && predecessorOverlap.includes(row.schedule_id) && rows[row.sequence_index].status === 'Reproduced').map((row) => row.schedule_id))].sort(utf8Compare)
  if (sha256Canonical(reproducedOverlap) !== sha256Canonical(predecessorOverlap)) openContradictionIds.push('P3B-PREDECESSOR-OVERLAP-INCOMPLETE')
  const contradictionUnsigned = { schema_id: 'oracle-lab-p3b-contradiction-record.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, exact_predecessor_ids: ['CL-P3A-R2-CONFIG-AUTH', 'CL-P3A-R2-FAILURE-STREAM'], required_predecessor_overlap_schedule_ids: predecessorOverlap, reproduced_predecessor_overlap_schedule_ids: reproducedOverlap, compared_schedule_ids: [...new Set(ledger.rows.filter((row) => row.family !== 'target_control').map((row) => row.schedule_id))].sort(utf8Compare), open_contradiction_ids: [...new Set(openContradictionIds)].sort(utf8Compare), status: rows.every((row) => row.status === 'Reproduced') && support.every((value) => value.status === 'PASS') && reproducedOverlap.length === predecessorOverlap.length ? 'consistent' : 'incomplete' }
  const contradiction = { ...contradictionUnsigned, contradiction_sha256: sha256Canonical(contradictionUnsigned) }
  writeExclusiveCanonical(root, `${CURATION_ROOT}/contradictions.json`, contradiction)
  const coverageUnsigned = { schema_id: 'oracle-lab-p3b-coverage-record.v1', campaign_id: ledger.campaign_id, planned_rows: 340, represented_rows: rows.length, reproduced_rows: rows.filter((row) => row.status === 'Reproduced').length, unknown_rows: rows.filter((row) => row.status === 'Unknown').length, omitted_rows: 0, unknown_or_omitted: 'disabled', status: represented ? 'complete' : 'incomplete' }
  const coverage = { ...coverageUnsigned, coverage_sha256: sha256Canonical(coverageUnsigned) }
  writeExclusiveCanonical(root, `${CURATION_ROOT}/coverage.json`, coverage)
  const artifactEntries = inventoryNamespace(root)
  const payloadUnsigned = { schema_id: 'oracle-lab-p3b-payload-manifest.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, files: artifactEntries }
  const payload = { ...payloadUnsigned, payload_manifest_sha256: sha256Canonical(payloadUnsigned) }
  writeExclusiveCanonical(root, `${CURATION_ROOT}/payload-manifest.json`, payload)
  const unsigned = { schema_id: 'oracle-lab-p3b-curation-result.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, rows, clock_attestation_sha256: curationClock.clock_sha256, contradiction_sha256: contradiction.contradiction_sha256, coverage_sha256: coverage.coverage_sha256, conclusion_sha256s: conclusionRecords.map((value) => value.conclusion_sha256), supporting_evidence_sha256s: supportSha256s, payload_manifest_sha256: payload.payload_manifest_sha256, issued_at_ms: issuedAt, status: conclusionRecords.every((value) => value.level === 'Reproduced') ? 'Reproduced' : 'Unknown', phase3b_usable: false }
  const result = deepFreeze({ ...unsigned, curation_sha256: sha256Canonical(unsigned) })
  writeExclusiveCanonical(root, `${CURATION_ROOT}/result.json`, result)
  return result
}

function forbiddenMaterialBytes(bytes: Buffer): boolean {
  return /(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{8,}|\bBearer\s+[A-Za-z0-9._~+\/-]{4,}|"(?:raw_prompt|raw_body|credential|secret|token)"\s*:)/i.test(bytes.toString('utf8'))
}

export function runCloseout(evidenceRoot: string): Readonly<Record<string, unknown>> {
  const root = assertPrivateRuntimeRoot(evidenceRoot)
  const closureDirectory = createPrivateDirectory(root, CLOSURE_ROOT)
  assertDirectoryEmpty(closureDirectory)
  const ledger = validateCampaignLedger(readCanonical(root, 'prelaunch/run-ledger.json', 16_777_216).value)
  const store = openExecutionStore(root, ledger)
  const receipts = readExecutionReceipts(store)
  const counts = deriveExecutionCounts(store)
  if (counts.terminal + counts.not_executed !== 340) throw new Phase3BProductionError('closeout_not_terminal', 'every ledger row must be terminal or explicitly not executed')
  const curation = readCanonical(root, `${CURATION_ROOT}/result.json`, 16_777_216).value
  assertDigestField(curation, 'curation_sha256', 'curation_invalid')
  const entries = inventoryNamespace(root)
  const indexUnsigned = { schema_id: 'oracle-lab-p3b-artifact-index.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, entries }
  const artifactIndex = { ...indexUnsigned, artifact_index_sha256: sha256Canonical(indexUnsigned) }
  writeExclusiveCanonical(root, `${CLOSURE_ROOT}/artifact-index.json`, artifactIndex)
  const findings = entries.filter((entry) => !(entry.relative_path === 'launch-images/original-image' || entry.relative_path === 'launch-images/probe-image')).filter((entry) => forbiddenMaterialBytes(stableRead(path.join(root, entry.relative_path), { maximumBytes: 134_217_728, nonempty: false }).bytes)).map((entry) => ({ relative_path: entry.relative_path, finding: 'forbidden_material' }))
  const leakUnsigned = { schema_id: 'oracle-lab-p3b-leak-report.v1', campaign_id: ledger.campaign_id, scanned_artifact_index_sha256: artifactIndex.artifact_index_sha256, findings, status: findings.length === 0 ? 'PASS' : 'BLOCKED' }
  const leak = { ...leakUnsigned, leak_report_sha256: sha256Canonical(leakUnsigned) }
  writeExclusiveCanonical(root, `${CLOSURE_ROOT}/leak-report.json`, leak)
  const failure = readCampaignFailure(store)
  const exitUnsigned = { schema_id: 'oracle-lab-p3b-exit-report.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, counts, receipt_set_sha256: sha256Canonical(receipts), campaign_failure_sha256: failure?.failure_sha256 ?? null, curation_sha256: curation.curation_sha256, status: failure ? 'BLOCKED' : curation.status === 'Reproduced' && findings.length === 0 ? 'COMPLETE' : 'Unknown', phase3b_usable: false, closed_at_ms: Date.now(), closed_monotonic_ns: process.hrtime.bigint().toString() }
  const exit = { ...exitUnsigned, exit_report_sha256: sha256Canonical(exitUnsigned) }
  writeExclusiveCanonical(root, `${CLOSURE_ROOT}/exit-report.json`, exit)
  const handoffUnsigned = { schema_id: 'oracle-lab-p3b-handoff.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, exit_report_sha256: exit.exit_report_sha256, next_action: exit.status === 'COMPLETE' ? 'evaluate_gate_a' : 'retain_append_only_blocked', phase3b_usable: false }
  const handoff = { ...handoffUnsigned, handoff_sha256: sha256Canonical(handoffUnsigned) }
  writeExclusiveCanonical(root, `${CLOSURE_ROOT}/handoff.json`, handoff)
  const terminalUnsigned = { schema_id: 'oracle-lab-p3b-terminal-manifest.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, artifact_index_sha256: artifactIndex.artifact_index_sha256, leak_report_sha256: leak.leak_report_sha256, exit_report_sha256: exit.exit_report_sha256, handoff_sha256: handoff.handoff_sha256, terminal_state: exit.status, phase3b_usable: false }
  const terminal = { ...terminalUnsigned, terminal_manifest_sha256: sha256Canonical(terminalUnsigned) }
  writeExclusiveCanonical(root, `${CLOSURE_ROOT}/terminal-manifest.json`, terminal)
  const closureRecords = CLOSURE_ORDER.map((name) => {
    const relative = `${CLOSURE_ROOT}/${name}.json`
    const record = readCanonical(root, relative)
    return { name, relative_path: relative, schema_id: String(record.value.schema_id), sha256: record.identity.sha256 }
  })
  const externalUnsigned = { schema_id: 'oracle-lab-p3b-external-digest-set.v1', campaign_id: ledger.campaign_id, records: closureRecords }
  const external = { ...externalUnsigned, external_set_sha256: sha256Canonical(externalUnsigned) }
  writeExclusiveCanonical(root, `${CLOSURE_ROOT}/external-digest-set.json`, external)
  return deepFreeze({ schema_id: 'oracle-lab-p3b-closeout-result.v1', campaign_id: ledger.campaign_id, status: exit.status, phase3b_usable: false, terminal_manifest_sha256: terminal.terminal_manifest_sha256, external_set_sha256: external.external_set_sha256 })
}

export function validateExternalSet(evidenceRoot: string): Record<string, unknown> {
  const root = assertPrivateRuntimeRoot(evidenceRoot)
  const external = readCanonical(root, `${CLOSURE_ROOT}/external-digest-set.json`).value
  assertExactKeys(external, ['schema_id', 'campaign_id', 'records', 'external_set_sha256'], 'external_set_invalid')
  assertDigestField(external, 'external_set_sha256', 'external_set_invalid')
  if (external.schema_id !== 'oracle-lab-p3b-external-digest-set.v1' || !Array.isArray(external.records) || external.records.length !== 5) throw new Phase3BProductionError('external_set_invalid', 'external set is not the exact five-class set')
  external.records.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Phase3BProductionError('external_set_invalid', 'external set entry is invalid')
    const record = entry as Record<string, unknown>
    assertExactKeys(record, ['name', 'relative_path', 'schema_id', 'sha256'], 'external_set_invalid')
    if (record.name !== CLOSURE_ORDER[index] || record.relative_path !== `${CLOSURE_ROOT}/${CLOSURE_ORDER[index]}.json`) throw new Phase3BProductionError('external_set_invalid', 'external set order/path drifted')
    const actual = readCanonical(root, String(record.relative_path))
    if (actual.identity.sha256 !== record.sha256 || actual.value.schema_id !== record.schema_id) throw new Phase3BProductionError('external_set_invalid', 'external set does not bind actual artifact bytes')
  })
  return external
}
import { lstatSync, readdirSync } from 'node:fs'
import path from 'node:path'
