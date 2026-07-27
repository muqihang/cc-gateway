import { Phase3BProductionError, assertDigestField, assertExactKeys, assertSha256, canonicalBytes, deepFreeze, sha256Bytes, sha256Canonical, utf8Compare } from './core.js'
import { lstatSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { deriveExecutionCounts, openExecutionStore, readCampaignFailure, readExecutionReceipts, type ExecutionReceipt } from './execution-store.js'
import { ES7_REQUEST_FIELDS, ES7_RESPONSE_FIELDS, FIXED_LITERAL_TABLE, FIXED_LITERAL_TABLE_SHA256, NORMATIVE_COVERAGE_PLAN_RELATIVE, NORMATIVE_COVERAGE_PLAN_SHA256, TARGET_PROFILE, immutableNormativeSourceBytes, materializeEs7Sources, materializeResponseBody, normativeCoverageMatrix, observationCoverageMatrix, type CampaignLedger, type RunLedgerRow, type TargetProfile, validateCampaignLedger } from './ledger.js'
import { expectedAuthMarkerClass } from './scenario-input.js'
import { assertDirectoryEmpty, assertPrivateRuntimeRoot, createPrivateDirectory, readCanonical, resolveContained, stableRead, writeExclusiveBytes, writeExclusiveCanonical } from './sealed-fs.js'
import { expectedSelectedRoute } from './route-policy.js'
import { materializeRequestAst, REQUEST_AST_MATERIALIZER } from './receiver.js'
import { validateCampaignReviewerRegistry } from './trust.js'

export const CONCLUSION_IDS = ['CL-P3B-ES1-CONFIG-AUTH-REVALIDATED', 'CL-P3B-ES1-NEW-SESSION-WIRE', 'CL-P3B-ES1-FAILURE-RECOVERY'] as const
export const CONCLUSION_PATHS = {
  'CL-P3B-ES1-CONFIG-AUTH-REVALIDATED': 'capsules/P3B-ES1/curation/conclusions-final/config-auth-revalidated.json',
  'CL-P3B-ES1-NEW-SESSION-WIRE': 'capsules/P3B-ES1/curation/conclusions-final/new-session-wire.json',
  'CL-P3B-ES1-FAILURE-RECOVERY': 'capsules/P3B-ES1/curation/conclusions-final/failure-recovery.json',
} as const
const NORMATIVE_SOURCE_PATHS = {
  'CL-P3B-ES1-CONFIG-AUTH-REVALIDATED': 'capsules/P3B-ES1/conclusions/config-auth-revalidated.json',
  'CL-P3B-ES1-NEW-SESSION-WIRE': 'capsules/P3B-ES1/conclusions/new-session-wire.json',
  'CL-P3B-ES1-FAILURE-RECOVERY': 'capsules/P3B-ES1/conclusions/failure-recovery.json',
} as const
export const SUCCESSOR_TTL_MS = 1_209_600_000
const CLOSURE_ORDER = ['artifact-index', 'leak-report', 'exit-report', 'handoff', 'terminal-manifest'] as const
const CURATION_ROOT = 'capsules/P3B-ES1/curation'
const CLOSURE_ROOT = 'capsules/P3B-ES1/closure'
const SUPPORT_ROOT = 'capsules/P3B-ES1/curation/support'
export const SUPPORT_PATHS = ['typed-wire-fixtures.json', 'candidate-field-closure.json', 'field-provenance.json', 'cross-repo-result.json', 'predecessor-semantic-comparison.json'].map((name) => `${SUPPORT_ROOT}/${name}`) as readonly string[]
const OBSERVATION_FIELDS = ['schema_id', 'campaign_id', 'ledger_sha256', 'run_id', 'sequence_index', 'receiver_group_id', 'receiver_instance_id', 'receiver_authority_sha256', 'target_pid', 'target_instance_id', 'executable_identity_sha256', 'route_ordinal', 'connection_ordinal', 'attempt_ordinal', 'action_ordinal', 'method', 'path', 'query_present', 'ordered_header_classes', 'header_presence', 'auth_marker_winner_class', 'body_byte_length', 'body_sha256', 'body_ast', 'body_ast_sha256', 'body_normalized_byte_length', 'body_normalized_sha256', 'body_roundtrip_sha256', 'response_program_sha256', 'response', 'observation_sha256'] as const
const RESPONSE_FIELDS = ES7_RESPONSE_FIELDS
const ES7_TYPED_FIXTURE_PATH = 'control/es7-typed-fixtures.json'
const ES8_GO_RECEIPT_PATH = 'control/es8-go-receipt.json'
const ES8_TS_AGREEMENT_PATH = 'control/es8-ts-c1-agreement.json'
const ES9_COVERAGE_CONTRACT_PATH = 'control/es9-coverage-contract.json'
const STABLE_CODE_COUNT = 119
const STABLE_CODE_SET_SHA256 = 'f6f89d48519aaa46b362a474cc6bd8e470b638e1c7f4c3c0a7ac99413a85fa5c'
const GO_RECEIPT_EXPECTED = deepFreeze({
  bundle_sha256: '5a79c1314332f5228e2865e6eeabc1b7597e863b56f8ec2079448ea2db37df9b',
  decisions_sha256: '62223a099e6dff9e96b99b4264472f6c8ab5d91c204686e0eb579a8c2585083c',
  mutation_results_sha256: '0757f6827786fa5fafc73e8beebe5852819bd913f4da45017ca9cdfd63c2d5ad',
  required_set_sha256: 'f6eee94d9b1d80e0437474f0db65b35ce874e14edd9cf7f8314b4c38e9970d05',
  executed_required_sha256: '780f7d865a7c56e761856bae9b2f5f6c1743b322817b570355c5f41eab2b4f1a',
  declared_decisions_sha256: 'a88805a573742cda40de5648cccb9735cf966d5aba32827a47f326d31477a7e4',
  declared_mutations_sha256: 'b0cbf903c93378a8148e74f29564524ba9c6971f19d697c595aca3448606f797',
})

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
      const stable = stableRead(file, { maximumBytes: TARGET_PROFILE.maximum_executable_bytes, nonempty: false })
      let schemaId = 'opaque-bytes'
      try { schemaId = String(readCanonical(root, relative, TARGET_PROFILE.maximum_executable_bytes).value.schema_id ?? 'canonical-json') } catch {}
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
  assertExactKeys(value, OBSERVATION_FIELDS, 'observation_invalid')
  assertDigestField(value, 'observation_sha256', 'observation_invalid')
  if (value.schema_id !== 'oracle-lab-p3b-wire-observation.v1' || value.run_id !== row.run_id || value.sequence_index !== row.sequence_index || value.receiver_group_id !== row.receiver_group_id || value.response_program_sha256 !== row.response_program_sha256 || typeof value.attempt_ordinal !== 'number' || typeof value.connection_ordinal !== 'number' || typeof value.action_ordinal !== 'number') throw new Phase3BProductionError('observation_invalid', 'observation row/program/ordinal binding drifted')
  const attempt = Number(value.attempt_ordinal)
  const action = row.response_program.actions[attempt]
  const response = value.response as Record<string, unknown> | undefined
  if (response) assertExactKeys(response, RESPONSE_FIELDS, 'observation_invalid')
  const expectedBody = Buffer.from(materializeResponseBody(action?.body_kind ?? 'empty'), 'utf8')
  const expectedEvents = action.body_kind === 'complete_sse' ? ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop'] : action.body_kind === 'partial_sse' ? ['message_start', 'content_block_start', 'content_block_delta'] : []
  const elapsed = response && /^\d+$/.test(String(response.delay_elapsed_ns)) ? BigInt(String(response.delay_elapsed_ns)) : -1n
  const expectedTimingBucket = action.delay_class === 'bounded_before_headers' ? elapsed >= BigInt(action.delay_ms) * 1_000_000n ? 'at_or_after_boundary' : 'before_boundary' : 'not_delayed'
  const astStringDigests: string[] = []
  const collectAstStringDigests = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (!Array.isArray(node) && (node as Record<string, unknown>).type === 'string' && typeof (node as Record<string, unknown>).value_sha256 === 'string') astStringDigests.push(String((node as Record<string, unknown>).value_sha256))
    for (const child of Array.isArray(node) ? node : Object.values(node as Record<string, unknown>)) collectAstStringDigests(child)
  }
  collectAstStringDigests(value.body_ast)
  const astValue = value.body_ast && typeof value.body_ast === 'object' ? (value.body_ast as Record<string, unknown>).value : null
  const rootFields = astValue && typeof astValue === 'object' && !Array.isArray(astValue) ? (astValue as Record<string, unknown>).fields : null
  const modelNodes = Array.isArray(rootFields) ? rootFields.filter((field) => field && typeof field === 'object' && (field as Record<string, unknown>).field_ref === 'field_00').map((field) => (field as Record<string, unknown>).value) : []
  const exactRequestModel = modelNodes.length === 1 && modelNodes[0] && typeof modelNodes[0] === 'object' && (modelNodes[0] as Record<string, unknown>).type === 'string' && (modelNodes[0] as Record<string, unknown>).literal_ref === 'synthetic-literals/request_model_v1'
  const requiredLiteralDigests = [FIXED_LITERAL_TABLE.request_model_v1, FIXED_LITERAL_TABLE.control_prompt_v1].map((literal) => sha256Bytes(Buffer.from(literal, 'utf8')))
  const astBytes = Buffer.concat([canonicalBytes(value.body_ast), Buffer.from('\n', 'utf8')])
  let materializedRequest: Buffer
  try { materializedRequest = materializeRequestAst(value.body_ast as Record<string, unknown>) } catch { throw new Phase3BProductionError('observation_invalid', 'request AST cannot reproduce the receiver wire bytes') }
  const receiverMatch = materializedRequest.length === value.body_normalized_byte_length && sha256Bytes(materializedRequest) === value.body_normalized_sha256
  const expectedRoundtripSha256 = sha256Canonical({ materializer: REQUEST_AST_MATERIALIZER, literal_table_sha256: FIXED_LITERAL_TABLE_SHA256, body_byte_length: value.body_byte_length, body_sha256: value.body_sha256, body_ast_sha256: value.body_ast_sha256, normalized_byte_length: value.body_normalized_byte_length, normalized_sha256: value.body_normalized_sha256 })
  const wireEvents = response?.wire_events
  if (!Array.isArray(wireEvents) || wireEvents.length === 0 || response?.wire_event_sha256 !== sha256Canonical(wireEvents)) throw new Phase3BProductionError('observation_invalid', 'wire event transcript is missing or has a mismatched digest')
  let previousMonotonic = -1n
  let bodyEventLength = 0
  let closeHadError: boolean | null = null
  let responseFinished = false
  let resetRequested = false
  let socketError = false
  wireEvents.forEach((wireEvent, index) => {
    if (!wireEvent || typeof wireEvent !== 'object' || Array.isArray(wireEvent)) throw new Phase3BProductionError('observation_invalid', 'wire event is not a closed object')
    const event = wireEvent as Record<string, unknown>
    const kind = String(event.kind)
    const fields = kind === 'headers' || kind === 'body' ? ['kind', 'monotonic_ns', 'byte_length', 'bytes_sha256']
      : kind === 'socket_error' ? ['kind', 'monotonic_ns', 'error_class']
        : kind === 'socket_close' ? ['kind', 'monotonic_ns', 'had_error']
          : ['kind', 'monotonic_ns']
    if (!['headers', 'body', 'response_finish', 'socket_end', 'socket_error', 'reset_requested', 'socket_close'].includes(kind)) throw new Phase3BProductionError('observation_invalid', 'wire event kind is unknown')
    assertExactKeys(event, fields, 'observation_invalid')
    if (!/^\d+$/.test(String(event.monotonic_ns)) || BigInt(String(event.monotonic_ns)) < previousMonotonic) throw new Phase3BProductionError('observation_invalid', 'wire event monotonic order drifted')
    previousMonotonic = BigInt(String(event.monotonic_ns))
    if (kind === 'headers' || kind === 'body') {
      if (!Number.isSafeInteger(event.byte_length) || Number(event.byte_length) <= 0) throw new Phase3BProductionError('observation_invalid', 'wire byte event length is invalid')
      assertSha256(event.bytes_sha256, 'observation_invalid', 'bytes_sha256')
      if (kind === 'body') bodyEventLength += Number(event.byte_length)
    } else if (kind === 'response_finish') responseFinished = true
    else if (kind === 'reset_requested') resetRequested = true
    else if (kind === 'socket_error') {
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(String(event.error_class))) throw new Phase3BProductionError('observation_invalid', 'wire socket error class is invalid')
      socketError = true
    } else if (kind === 'socket_close') {
      if (index !== wireEvents.length - 1 || typeof event.had_error !== 'boolean') throw new Phase3BProductionError('observation_invalid', 'socket close must be the final observed wire event')
      closeHadError = event.had_error
    }
  })
  if (closeHadError === null || closeHadError !== response.socket_close_had_error || bodyEventLength !== response.body_byte_length) throw new Phase3BProductionError('observation_invalid', 'wire close/body binding drifted')
  if (response.transport_terminal === 'http_complete' && (!responseFinished || resetRequested || socketError || closeHadError)) throw new Phase3BProductionError('observation_invalid', 'clean HTTP completion lacks an observed clean finish and close')
  if (response.transport_terminal === 'eof_after_partial' && (!responseFinished || resetRequested || socketError || closeHadError)) throw new Phase3BProductionError('observation_invalid', 'partial EOF lacks an observed clean finish and close')
  if (response.transport_terminal === 'reset_before_headers' && (!resetRequested && !socketError && !closeHadError)) throw new Phase3BProductionError('observation_invalid', 'reset-before-headers lacks an observed reset/error close')
  if (!action || !response || !exactRequestModel || value.route_ordinal !== expectedSelectedRoute(row) || value.method !== 'POST' || value.path !== '/v1/messages' || value.query_present !== false || !Number.isSafeInteger(value.body_byte_length) || Number(value.body_byte_length) <= 0 || !/^[a-f0-9]{64}$/.test(String(value.body_sha256)) || !Number.isSafeInteger(value.body_normalized_byte_length) || Number(value.body_normalized_byte_length) <= 0 || !/^[a-f0-9]{64}$/.test(String(value.body_normalized_sha256)) || value.body_ast_sha256 !== sha256Bytes(astBytes) || value.body_roundtrip_sha256 !== expectedRoundtripSha256 || !receiverMatch || requiredLiteralDigests.some((digest) => !astStringDigests.includes(digest)) || elapsed < 0n || response.status !== action.status || response.transport_terminal !== action.transport_terminal || expectedTimingBucket !== (action.delay_class === 'bounded_before_headers' ? 'at_or_after_boundary' : 'not_delayed') || response.timing_bucket !== expectedTimingBucket || response.body_byte_length !== expectedBody.length || response.body_sha256 !== sha256Bytes(expectedBody) || sha256Canonical(response.ordered_header_classes) !== sha256Canonical(action.ordered_headers) || sha256Canonical(response.sse_event_order) !== sha256Canonical(expectedEvents)) throw new Phase3BProductionError('observation_invalid', 'measured request literal/AST/route or response bytes/status/headers/events/timing/terminal drifted from sealed program')
  if (row.family === 'auth' && value.auth_marker_winner_class !== expectedAuthMarkerClass(row)) throw new Phase3BProductionError('observation_invalid', 'actual synthetic auth marker does not match the sealed auth arm')
  const stableResponse = {
    ...Object.fromEntries(Object.entries(response).filter(([field]) => field !== 'delay_elapsed_ns' && field !== 'wire_event_sha256' && field !== 'wire_events')),
    wire_events: wireEvents.map((wireEvent) => Object.fromEntries(Object.entries(wireEvent as Record<string, unknown>).filter(([field]) => field !== 'monotonic_ns'))),
  }
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
      body_ast_sha256: value.body_ast_sha256,
      body_normalized_byte_length: value.body_normalized_byte_length,
      body_normalized_sha256: value.body_normalized_sha256,
      body_roundtrip_sha256: value.body_roundtrip_sha256,
      response: stableResponse,
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
  assertExactKeys(guard.value, ['schema_id', 'run_id', 'sequence_index', 'profile_sha256', 'allowed_loopback_ports', 'allowed_write_sha256', 'denied_host_read', 'denied_credential_read', 'denied_process_info', 'external_socket_budget', 'same_scope_probe', 'status', 'guard_receipt_sha256'], 'guard_receipt_invalid')
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
  if (guard.value.denied_host_read !== true || guard.value.denied_credential_read !== true || guard.value.denied_process_info !== true || guard.value.external_socket_budget !== 0 || guard.value.same_scope_probe !== true || guard.value.status !== 'PASS') throw new Phase3BProductionError('guard_receipt_invalid', 'guard receipt does not prove the fixed read/process/no-egress denials')
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

function supportRecord(unsigned: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return deepFreeze({ ...unsigned, support_sha256: sha256Canonical(unsigned) })
}

function unknownFixture(row: RunLedgerRow): Readonly<Record<string, unknown>> {
  const unsigned = { sequence_index: row.sequence_index, run_id: row.run_id, row_sha256: row.row_sha256, family: row.family, schedule_id: row.schedule_id, request_stimulus_sha256: row.request_stimulus_sha256, status: 'Unknown', requests: [], responses: [] }
  return deepFreeze({ ...unsigned, fixture_sha256: sha256Canonical(unsigned) })
}

function deriveFixtureRows(root: string, ledger: CampaignLedger): readonly Readonly<Record<string, unknown>>[] {
  const store = openExecutionStore(root, ledger)
  const terminalByRow = new Map(readExecutionReceipts(store).filter((receipt) => receipt.state === 'terminal').map((receipt) => [receipt.sequence_index, receipt]))
  return deepFreeze(ledger.rows.map((row) => {
    const classified = classifyRow(root, row, terminalByRow.get(row.sequence_index) ?? null)
    if (classified.status !== 'Reproduced') return unknownFixture(row)
    const observations = row.response_program.actions.map((_, attempt) => {
      const relativePath = `observations/${String(row.sequence_index).padStart(3, '0')}-${row.run_id}-${String(attempt).padStart(2, '0')}.json`
      const record = readCanonical(root, relativePath)
      validateObservation(record.value, row)
      return { relativePath, ...record }
    })
    const source = materializeEs7Sources(row)
    const requests = observations.map(({ relativePath, value, identity }) => {
      const request = { schema_id: 'oracle-lab-p3b-typed-request-fixture.v1', method: value.method, path: value.path, query_present: value.query_present, ordered_header_classes: value.ordered_header_classes, header_presence: value.header_presence, auth_marker_winner_class: value.auth_marker_winner_class, body_byte_length: value.body_byte_length, body_sha256: value.body_sha256, body_ast: value.body_ast, body_ast_sha256: value.body_ast_sha256, body_normalized_byte_length: value.body_normalized_byte_length, body_normalized_sha256: value.body_normalized_sha256, body_roundtrip_sha256: value.body_roundtrip_sha256 }
      const fixtureBytes = Buffer.concat([canonicalBytes(request), Buffer.from('\n', 'utf8')])
      const astBytes = Buffer.concat([canonicalBytes(value.body_ast), Buffer.from('\n', 'utf8')])
      const materialized = materializeRequestAst(value.body_ast as Record<string, unknown>)
      const receiverMatch = sha256Bytes(materialized) === value.body_normalized_sha256 && materialized.length === value.body_normalized_byte_length && sha256Bytes(astBytes) === value.body_ast_sha256
      if (!receiverMatch) throw new Phase3BProductionError('conclusion_support_invalid', 'receiver request AST/literals do not reproduce the exact captured wire body')
      const unsignedRequest = { attempt_ordinal: value.attempt_ordinal, source_relative_path: relativePath, source_raw_sha256: identity.sha256, source_observation_sha256: value.observation_sha256, contract_source_sha256: source.request_source_sha256, materializer_algorithm: REQUEST_AST_MATERIALIZER, literal_table_sha256: FIXED_LITERAL_TABLE_SHA256, typed_fixture_bytes_length: fixtureBytes.byteLength, typed_fixture_bytes_sha256: sha256Bytes(fixtureBytes), ast_bytes_length: astBytes.byteLength, ast_bytes_sha256: sha256Bytes(astBytes), materialized_normalized_bytes_length: materialized.byteLength, materialized_normalized_bytes_sha256: sha256Bytes(materialized), receiver_wire_body_sha256: value.body_sha256, receiver_match: receiverMatch, typed_fixture: request }
      return { ...unsignedRequest, fixture_sha256: sha256Canonical(unsignedRequest) }
    })
    const responses = observations.map(({ relativePath, value, identity }) => {
      const response = { schema_id: 'oracle-lab-p3b-typed-response-fixture.v1', ...(value.response as Record<string, unknown>) }
      const fixtureBytes = Buffer.concat([canonicalBytes(response), Buffer.from('\n', 'utf8')])
      const unsignedResponse = { attempt_ordinal: value.attempt_ordinal, source_relative_path: relativePath, source_raw_sha256: identity.sha256, source_observation_sha256: value.observation_sha256, contract_source_sha256: source.response_source_sha256, materializer_algorithm: 'canonical-json-utf8-lf-v1', literal_table_sha256: FIXED_LITERAL_TABLE_SHA256, typed_fixture_bytes_length: fixtureBytes.byteLength, typed_fixture_bytes_sha256: sha256Bytes(fixtureBytes), receiver_wire_body_sha256: (value.response as Record<string, unknown>).body_sha256, receiver_match: true, typed_fixture: response }
      return { ...unsignedResponse, fixture_sha256: sha256Canonical(unsignedResponse) }
    })
    const unsigned = {
      sequence_index: row.sequence_index,
      run_id: row.run_id,
      row_sha256: row.row_sha256,
      family: row.family,
      schedule_id: row.schedule_id,
      request_stimulus_sha256: row.request_stimulus_sha256,
      status: 'Reproduced',
      contract_request_source_sha256: source.request_source_sha256,
      contract_response_source_sha256: source.response_source_sha256,
      requests,
      responses,
    }
    return deepFreeze({ ...unsigned, fixture_sha256: sha256Canonical(unsigned) })
  }))
}

const GO_RECEIPT_FIELDS = ['schema_id', 'schema_major', 'schema_revision', 'bundle_sha256', 'decisions_sha256', 'mutation_results_sha256', 'required_set_sha256', 'executed_required_sha256', 'declared_decisions_sha256', 'declared_mutations_sha256', 'stable_code_count', 'stable_code_set_sha256', 'record_input_sha256', 'mirror_validation_code', 'index_validation_code', 'record_validation_code', 'mirror_validation_allowed', 'index_validation_allowed', 'record_validation_allowed', 'receipt_digest'] as const
const TS_AGREEMENT_FIELDS = ['schema_id', 'repositories', 'c1_record_sha256', 'go_receipt_raw_sha256', 'go_receipt_internal_sha256', 'decisions_sha256', 'mutation_results_sha256', 'required_set_sha256', 'stable_code_count', 'stable_code_set_sha256', 'decision', 'agreement_sha256'] as const
const COVERAGE_CONTRACT_FIELDS = ['schema_id', 'repositories', 'c1', 'ledger_sha256', 'fixture_schema_id', 'normative_plan_relative_path', 'normative_plan_sha256', 'normative_row_count', 'normative_leaf_count', 'normative_e_rows', 'normative_c_rows', 'normative_d_rows', 'observation_enabled_sources', 'observation_disabled_exclusions', 'contract_sha256'] as const

function internalLineDigest(value: Record<string, unknown>, digestField: string): string {
  const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== digestField))
  return sha256Bytes(Buffer.concat([canonicalBytes(unsigned), Buffer.from('\n', 'utf8')]))
}

function assertReviewedControlArtifact(root: string, artifact: ArtifactEntry, digestField: string): void {
  const input = optionalCanonical(root, 'control/campaign-input.json')
  const authority = optionalCanonical(root, 'control/operator-authority.json')
  if (!input || !authority) throw new Phase3BProductionError('conclusion_support_invalid', 'reviewed campaign input or operator authority is missing')
  assertDigestField(input.value, 'input_sha256', 'conclusion_support_invalid')
  assertDigestField(authority.value, 'authority_sha256', 'conclusion_support_invalid')
  const authorityInputSha256 = authority.value.campaign_input_sha256 ?? (authority.value.payload && typeof authority.value.payload === 'object' && !Array.isArray(authority.value.payload) ? (authority.value.payload as Record<string, unknown>).campaign_input_sha256 : null)
  if (input.value[digestField] !== artifact.sha256 || authorityInputSha256 !== input.value.input_sha256) throw new Phase3BProductionError('conclusion_support_invalid', 'sealed support artifact is not bound by the reviewed campaign input and operator authority')
}

export function validateTypedFixtureContract(value: Record<string, unknown>, ledger: CampaignLedger): void {
  assertExactKeys(value, ['schema_id', 'campaign_id', 'repositories', 'c1', 'ledger_sha256', 'literal_table_sha256', 'materializer', 'request_fields', 'response_fields', 'rows', 'contract_sha256'], 'conclusion_support_invalid')
  assertDigestField(value, 'contract_sha256', 'conclusion_support_invalid')
  const expectedRows = ledger.rows.map(materializeEs7Sources)
  const materializer = value.materializer as Record<string, unknown> | undefined
  if (value.schema_id !== 'oracle-lab-p3b-es7-typed-fixture-contract.v1' || value.campaign_id !== ledger.campaign_id || value.ledger_sha256 !== ledger.ledger_sha256 || value.literal_table_sha256 !== FIXED_LITERAL_TABLE_SHA256 || !materializer || materializer.algorithm !== REQUEST_AST_MATERIALIZER || materializer.ast_encoding !== 'canonical-json-utf8-lf-v1' || materializer.normalized_encoding !== 'canonical-json-utf8-lf-v1' || materializer.raw_persistence !== false || materializer.round_trip !== 'receiver-capture-verified-normalized' || sha256Canonical(value.repositories) !== sha256Canonical(ledger.authority) || sha256Canonical(value.c1) !== sha256Canonical(ledger.c1) || sha256Canonical(value.request_fields) !== sha256Canonical(ES7_REQUEST_FIELDS) || sha256Canonical(value.response_fields) !== sha256Canonical(RESPONSE_FIELDS) || sha256Canonical(value.rows) !== sha256Canonical(expectedRows)) throw new Phase3BProductionError('conclusion_support_invalid', 'ES7 typed fixture contract does not bind exact normalized-safe literal/materializer/source bytes and ledger rows')
}

export function validateIndependentGoReceipt(value: Record<string, unknown>, c1ReviewSha256: string): void {
  assertExactKeys(value, GO_RECEIPT_FIELDS, 'conclusion_support_invalid')
  for (const field of ['bundle_sha256', 'decisions_sha256', 'mutation_results_sha256', 'required_set_sha256', 'executed_required_sha256', 'declared_decisions_sha256', 'declared_mutations_sha256', 'stable_code_set_sha256', 'record_input_sha256', 'receipt_digest']) assertSha256(value[field], 'conclusion_support_invalid', field)
  if (value.schema_id !== 'oracle.sub_contract_receipt' || value.schema_major !== 1 || value.schema_revision !== 0 || value.stable_code_count !== STABLE_CODE_COUNT || value.stable_code_set_sha256 !== STABLE_CODE_SET_SHA256 || value.record_input_sha256 !== c1ReviewSha256 || value.receipt_digest !== internalLineDigest(value, 'receipt_digest') || Object.entries(GO_RECEIPT_EXPECTED).some(([field, digest]) => value[field] !== digest)) throw new Phase3BProductionError('conclusion_support_invalid', 'independent Go receipt schema, C1 input, frozen execution/fixture digests, stable-code set, or internal digest drifted')
  if (value.mirror_validation_allowed !== true || value.index_validation_allowed !== true || value.record_validation_allowed !== true || value.mirror_validation_code !== '' || value.index_validation_code !== '' || value.record_validation_code !== '') throw new Phase3BProductionError('conclusion_support_invalid', 'independent Go receipt decision is not an exact PASS')
}

export function validateIndependentTsAgreement(value: Record<string, unknown>, goValue: Record<string, unknown>, goRawSha256: string, ledger: CampaignLedger): void {
  assertExactKeys(value, TS_AGREEMENT_FIELDS, 'conclusion_support_invalid')
  assertDigestField(value, 'agreement_sha256', 'conclusion_support_invalid')
  for (const field of ['c1_record_sha256', 'go_receipt_raw_sha256', 'go_receipt_internal_sha256', 'decisions_sha256', 'mutation_results_sha256', 'required_set_sha256', 'stable_code_set_sha256']) assertSha256(value[field], 'conclusion_support_invalid', field)
  if (value.schema_id !== 'oracle-lab-p3b-es8-ts-c1-agreement.v1' || sha256Canonical(value.repositories) !== sha256Canonical(ledger.authority) || value.c1_record_sha256 !== ledger.c1.review_sha256 || value.go_receipt_raw_sha256 !== goRawSha256 || value.go_receipt_internal_sha256 !== goValue.receipt_digest || value.decisions_sha256 !== goValue.decisions_sha256 || value.mutation_results_sha256 !== goValue.mutation_results_sha256 || value.required_set_sha256 !== goValue.required_set_sha256 || value.stable_code_count !== STABLE_CODE_COUNT || value.stable_code_set_sha256 !== STABLE_CODE_SET_SHA256 || value.decision !== 'PASS') throw new Phase3BProductionError('conclusion_support_invalid', 'TypeScript/C1 agreement does not independently bind the exact Go receipt, repositories, decision, and stable-code set')
}

type CoverageSource = Readonly<{ sequence_index: number; source_pointer: string; observation_pointer: string; source_class: 'request' | 'response'; source_byte_length: number; source_sha256: string }>
type CoverageExclusion = Readonly<{ sequence_index: number; source_pointer: string; observation_pointer: string; source_class: 'request' | 'response'; reason_code: string; source_byte_length: number; source_sha256: string }>
const NORMATIVE_DESCRIPTOR_KEYS = ['id', 'leaves', 'class', 'source_kind', 'source_relative_path', 'source_sha256_binding', 'source_schema', 'scope', 'conclusion_id', 'expiry_binding', 'transform', 'missing_action'] as const

function assertPointer(pointer: unknown, field: string): asserts pointer is string {
  if (typeof pointer !== 'string' || !pointer.startsWith('/') || pointer.includes('//') || /~(?![01])/.test(pointer)) throw new Phase3BProductionError('conclusion_support_invalid', `${field} is not a canonical JSON pointer`)
}

export function validateCoverageContract(value: Record<string, unknown>, ledger: CampaignLedger): Readonly<{ enabled: readonly CoverageSource[]; disabled: readonly CoverageExclusion[] }> {
  assertExactKeys(value, COVERAGE_CONTRACT_FIELDS, 'conclusion_support_invalid')
  assertDigestField(value, 'contract_sha256', 'conclusion_support_invalid')
  const normative = normativeCoverageMatrix(ledger)
  const observations = observationCoverageMatrix(ledger)
  if (value.schema_id !== 'oracle-lab-p3b-es9-coverage-contract.v3' || sha256Canonical(value.repositories) !== sha256Canonical(ledger.authority) || sha256Canonical(value.c1) !== sha256Canonical(ledger.c1) || value.ledger_sha256 !== ledger.ledger_sha256 || value.fixture_schema_id !== 'oracle-lab-p3b-typed-wire-fixtures.v3' || value.normative_plan_relative_path !== NORMATIVE_COVERAGE_PLAN_RELATIVE || value.normative_plan_sha256 !== NORMATIVE_COVERAGE_PLAN_SHA256 || value.normative_row_count !== 26 || value.normative_leaf_count !== 152 || sha256Canonical(value.normative_e_rows) !== sha256Canonical(normative.e_rows) || sha256Canonical(value.normative_c_rows) !== sha256Canonical(normative.c_rows) || sha256Canonical(value.normative_d_rows) !== sha256Canonical(normative.d_rows) || !Array.isArray(value.observation_enabled_sources) || !Array.isArray(value.observation_disabled_exclusions) || sha256Canonical(value.observation_enabled_sources) !== sha256Canonical(observations.enabled) || sha256Canonical(value.observation_disabled_exclusions) !== sha256Canonical(observations.disabled)) throw new Phase3BProductionError('conclusion_support_invalid', 'ES9 coverage contract is not the exhaustive fixed normative E/C/D matrix and observation mapping')
  for (const rows of [value.normative_e_rows, value.normative_c_rows, value.normative_d_rows] as unknown[][]) for (const row of rows) {
    assertExactKeys(row, NORMATIVE_DESCRIPTOR_KEYS, 'conclusion_support_invalid')
    const source = row as Record<string, unknown>
    if (typeof source.source_relative_path !== 'string' || path.isAbsolute(source.source_relative_path) || source.source_relative_path.includes('..') || typeof source.source_sha256_binding !== 'string' || typeof source.source_schema !== 'string' || typeof source.transform !== 'string') throw new Phase3BProductionError('conclusion_support_invalid', 'normative ES9 source descriptor is not a fixed safe binding')
  }
  const enabled = value.observation_enabled_sources.map((source) => {
    assertExactKeys(source, ['sequence_index', 'source_class', 'source_pointer', 'observation_pointer', 'source_byte_length', 'source_sha256'], 'conclusion_support_invalid')
    assertPointer(source.source_pointer, 'source_pointer')
    assertPointer(source.observation_pointer, 'observation_pointer')
    if (!Number.isInteger(source.sequence_index) || source.source_class !== 'request' && source.source_class !== 'response' || !Number.isSafeInteger(source.source_byte_length) || Number(source.source_byte_length) < 0 || typeof source.source_sha256 !== 'string') throw new Phase3BProductionError('conclusion_support_invalid', 'coverage source class or bytes are invalid')
    return source as CoverageSource
  })
  const disabled = value.observation_disabled_exclusions.map((exclusion) => {
    assertExactKeys(exclusion, ['sequence_index', 'source_class', 'source_pointer', 'observation_pointer', 'reason_code', 'source_byte_length', 'source_sha256'], 'conclusion_support_invalid')
    assertPointer(exclusion.source_pointer, 'source_pointer')
    assertPointer(exclusion.observation_pointer, 'observation_pointer')
    if (!Number.isInteger(exclusion.sequence_index) || exclusion.source_class !== 'request' && exclusion.source_class !== 'response' || typeof exclusion.reason_code !== 'string' || !/^[a-z][a-z0-9_]{2,63}$/.test(exclusion.reason_code)) throw new Phase3BProductionError('conclusion_support_invalid', 'coverage exclusion pointer/reason is invalid')
    return exclusion as CoverageExclusion
  })
  return deepFreeze({ enabled, disabled })
}

function resolveJsonPointer(value: unknown, pointer: string): unknown {
  let current = value
  for (const encoded of pointer.slice(1).split('/')) {
    const segment = encoded.replace(/~1/g, '/').replace(/~0/g, '~')
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(segment) || Number(segment) >= current.length) throw new Phase3BProductionError('conclusion_support_invalid', 'coverage observation pointer is absent')
      current = current[Number(segment)]
    } else if (current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, segment)) current = (current as Record<string, unknown>)[segment]
    else throw new Phase3BProductionError('conclusion_support_invalid', 'coverage observation pointer is absent')
  }
  return current
}

const NORMATIVE_AMENDMENT_SHA256 = '51a6f19addd87f1591ae15a1f8f14951bf732954b58fcc722a97fee246c0d4f7'

function normativeSourceMetadata(relative: string): { id: typeof CONCLUSION_IDS[number]; schema: string } | null {
  for (const id of CONCLUSION_IDS) if (NORMATIVE_SOURCE_PATHS[id] === relative) {
    const schema = id === 'CL-P3B-ES1-CONFIG-AUTH-REVALIDATED' ? 'oracle-lab-p3b-es-config-auth.v1' : id === 'CL-P3B-ES1-NEW-SESSION-WIRE' ? 'oracle-lab-p3b-es-new-session-wire.v1' : 'oracle-lab-p3b-es-failure-recovery.v1'
    return { id, schema }
  }
  return null
}

function capturedSourceProjection(relative: string, ledger: CampaignLedger, fixtureRows: readonly Readonly<Record<string, unknown>>[], targetProfile: TargetProfile): Readonly<Record<string, unknown>> {
  const projection: Record<string, unknown> = {}
  for (const descriptor of normativeCoverageMatrix(ledger).rows) {
    const record = descriptor as Record<string, unknown>
    if (record.source_relative_path !== relative) continue
    for (const leaf of record.leaves as readonly string[]) setNormativePointer(projection, leaf, deriveCapturedSourceValue(record, leaf, ledger, fixtureRows, targetProfile))
  }
  return deepFreeze(projection)
}

function capturedConclusionSource(relative: string, ledger: CampaignLedger, fixtureRows: readonly Readonly<Record<string, unknown>>[], targetProfile: TargetProfile): Readonly<Record<string, unknown>> {
  const metadata = normativeSourceMetadata(relative)
  if (!metadata) throw new Phase3BProductionError('conclusion_support_invalid', `normative source path is not one of the fixed E source paths: ${relative}`)
  const projection = capturedSourceProjection(relative, ledger, fixtureRows, targetProfile)
  const leafValues = normativeCoverageMatrix(ledger).rows.filter((row) => row.source_relative_path === relative).flatMap((row) => (row.leaves as readonly string[]).map((leaf) => ({ id: row.id, leaf, value_sha256: sha256Canonical(resolveJsonPointer(projection, leaf)) })))
  const universe = { source_relative_path: relative, source_schema: metadata.schema, leaf_values: leafValues }
  const unsigned = { schema_id: 'oracle-lab-p3b-captured-conclusion-source.v1', source_relative_path: relative, source_schema: metadata.schema, campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, capture_set_sha256: sha256Canonical(fixtureRows), source_projection: projection, leaf_value_universe: leafValues, source_universe_sha256: sha256Canonical(universe) }
  return deepFreeze({ ...unsigned, source_sha256: sha256Canonical(unsigned) })
}

function normativeSourceRecord(root: string, descriptor: Record<string, unknown>, ledger: CampaignLedger, fixtureRows: readonly Readonly<Record<string, unknown>>[], targetProfile: TargetProfile): Readonly<{ value: Record<string, unknown> | null; rawSha256: string; size: number; schema: string; missing: boolean }> {
  const relative = String(descriptor.source_relative_path)
  try {
    const absolute = resolveContained(root, relative)
    if (relative.endsWith('.json')) {
      const record = readCanonical(root, relative, 16_777_216)
      if (relative === 'capsules/P3B-ES1/control/scenario-programs.json') {
        const expected = { schema_id: 'oracle-lab-p3b-es-scenario-program.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, programs: [...new Set(ledger.rows.map((row) => row.response_program_sha256))].sort(utf8Compare) }
        if (sha256Canonical(record.value) !== sha256Canonical(expected) || record.identity.sha256 !== sha256Bytes(Buffer.concat([canonicalBytes(expected), Buffer.from('\n', 'utf8')]))) throw new Phase3BProductionError('conclusion_support_invalid', 'normative scenario source bytes are not the exact immutable source')
        return deepFreeze({ value: record.value, rawSha256: record.identity.sha256, size: record.identity.size, schema: String(record.value.schema_id ?? ''), missing: false })
      }
      const captured = capturedConclusionSource(relative, ledger, fixtureRows, targetProfile)
      if (sha256Canonical(record.value) !== sha256Canonical(captured) || record.identity.sha256 !== sha256Bytes(Buffer.concat([canonicalBytes(captured), Buffer.from('\n', 'utf8')]))) throw new Phase3BProductionError('conclusion_support_invalid', `captured conclusion source bytes do not reproduce sealed observations: ${relative}`)
      return deepFreeze({ value: record.value, rawSha256: record.identity.sha256, size: record.identity.size, schema: String(record.value.source_schema ?? record.value.schema_id ?? ''), missing: false })
    }
    const record = stableRead(absolute, { mode: 0o600, maximumBytes: 262_144 })
    return deepFreeze({ value: null, rawSha256: record.identity.sha256, size: record.identity.size, schema: 'plan.v1', missing: false })
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return deepFreeze({ value: null, rawSha256: '', size: 0, schema: '', missing: true })
    throw error
  }
}

function deriveCapturedSourceValue(descriptor: Record<string, unknown>, leaf: string, ledger: CampaignLedger, fixtureRows: readonly Readonly<Record<string, unknown>>[], targetProfile: TargetProfile): unknown {
  const captureSetSha256 = sha256Canonical(fixtureRows)
  const className = String(descriptor.class)
  if (leaf === '/identity/package') return targetProfile.package
  if (leaf === '/identity/version') return targetProfile.version
  if (leaf === '/identity/archive_sha256') return targetProfile.platform_archive_sha256
  if (leaf === '/identity/tree_sha256') return targetProfile.platform_tree_sha256
  if (leaf === '/identity/entrypoint_sha256') return targetProfile.entrypoint_sha256
  if (leaf === '/identity/platform') return targetProfile.platform
  if (leaf === '/identity/architecture') return targetProfile.architecture
  if (leaf === '/request/method') return 'POST'
  if (leaf === '/request/target/path') return '/v1/messages'
  if (leaf === '/request/target/query_order' || leaf === '/request/target/query_items') return []
  if (leaf === '/request/body_ast/model') return FIXED_LITERAL_TABLE.request_model_v1
  if (leaf === '/request/body_ast/stream/value') return true
  if (leaf === '/request/encoding/canonical_body_sha256') return sha256Canonical(fixtureRows.flatMap((row) => Array.isArray(row.requests) ? row.requests.map((request) => (request as Record<string, unknown>).receiver_wire_body_sha256) : []))
  if (leaf === '/coverage/required_row_ids') return ledger.rows.map((row) => row.sequence_index)
  if (leaf === '/coverage/required_pointer_set') return normativeCoverageMatrix(ledger).rows.flatMap((row) => row.leaves)
  if (leaf === '/coverage/required_class_counts') return { E: 20, C: 3, D: 3 }
  if (className === 'D') return { disabled: true, reason: String(descriptor.missing_action), source_sha256: String(descriptor.source_sha256_binding) }
  const familyRows = fixtureRows.filter((row) => String(row.family) === (String(descriptor.conclusion_id).includes('CONFIG-AUTH') ? 'config' : String(descriptor.conclusion_id).includes('FAILURE') ? 'response_failure_recovery' : 'request_wire'))
  return { source_projection: 'sealed-capture-derivation-v1', leaf, source_schema: String(descriptor.source_schema), capture_set_sha256: captureSetSha256, family_capture_sha256: sha256Canonical(familyRows), transform: descriptor.transform }
}

function resolvedSourceValue(descriptor: Record<string, unknown>, leaf: string, source: Record<string, unknown> | null, ledger: CampaignLedger, fixtureRows: readonly Readonly<Record<string, unknown>>[], targetProfile: TargetProfile): unknown {
  const projection = source && source.source_projection && typeof source.source_projection === 'object' && !Array.isArray(source.source_projection) ? source.source_projection as Record<string, unknown> : source
  if (projection) {
    try { return resolveJsonPointer(projection, leaf) } catch {}
  }
  if (descriptor.class === 'C' || descriptor.class === 'D') return deriveCapturedSourceValue(descriptor, leaf, ledger, fixtureRows, targetProfile)
  throw new Phase3BProductionError('conclusion_support_invalid', `normative JSON pointer is missing: ${descriptor.source_relative_path}#${leaf}`)
}

export function resolveNormativeCoverage(root: string, ledger: CampaignLedger, fixtureRows: readonly Readonly<Record<string, unknown>>[]): readonly Readonly<Record<string, unknown>>[] {
  const normative = normativeCoverageMatrix(ledger)
  const targetProfile = readCanonical(root, 'prelaunch/static-anchor.json').value.target_profile as TargetProfile
  const resolved: Array<Readonly<Record<string, unknown>>> = []
  for (const descriptor of normative.rows) {
    const descriptorRecord = descriptor as Record<string, unknown>
    const sourcePath = String(descriptorRecord.source_relative_path)
    const source = normativeSourceRecord(root, descriptorRecord, ledger, fixtureRows, targetProfile)
    if (source.missing) throw new Phase3BProductionError('conclusion_support_invalid', `normative source is missing: ${sourcePath}`)
    const expectedPlanSha = sourcePath === NORMATIVE_COVERAGE_PLAN_RELATIVE ? NORMATIVE_COVERAGE_PLAN_SHA256 : sourcePath.endsWith('non-resume-amendment.md') ? NORMATIVE_AMENDMENT_SHA256 : null
    if (expectedPlanSha !== null && source.rawSha256 !== expectedPlanSha) throw new Phase3BProductionError('conclusion_support_invalid', `normative source digest drifted: ${sourcePath}`)
    if (source.schema !== String(descriptorRecord.source_schema)) throw new Phase3BProductionError('conclusion_support_invalid', `normative source schema drifted: ${sourcePath}`)
    if (descriptorRecord.source_sha256_binding === 'plan_sha256' && source.rawSha256 !== NORMATIVE_COVERAGE_PLAN_SHA256) throw new Phase3BProductionError('conclusion_support_invalid', 'plan-bound normative source digest is not fixed')
    if (/^[a-f0-9]{64}$/.test(String(descriptorRecord.source_sha256_binding)) && source.rawSha256 !== descriptorRecord.source_sha256_binding) throw new Phase3BProductionError('conclusion_support_invalid', 'fixed normative source digest binding drifted')
    if (String(descriptorRecord.source_sha256_binding) === 'field_provenance.sources[source_relative_path].sha256' && !/^[a-f0-9]{64}$/.test(source.rawSha256)) throw new Phase3BProductionError('conclusion_support_invalid', 'field provenance source digest was not resolved from the sealed source bytes')
    for (const leaf of descriptorRecord.leaves as readonly string[]) {
      const resolvedValue = resolvedSourceValue(descriptorRecord, leaf, source.value, ledger, fixtureRows, targetProfile)
      const unsigned = { id: descriptorRecord.id, class: descriptorRecord.class, leaf, source_relative_path: sourcePath, source_sha256_binding: descriptorRecord.source_sha256_binding, source_schema: descriptorRecord.source_schema, source_raw_sha256: source.rawSha256, source_canonical_sha256: source.value ? sha256Canonical(source.value) : null, source_size: source.size, source_json_pointer: leaf, resolved_value: resolvedValue, resolved_value_sha256: sha256Canonical(resolvedValue), transform: descriptorRecord.transform }
      resolved.push(deepFreeze({ ...unsigned, resolution_sha256: sha256Canonical(unsigned) }))
    }
  }
  if (resolved.length !== 152) throw new Phase3BProductionError('conclusion_support_invalid', 'normative source resolution is not the fixed 152-leaf set')
  return deepFreeze(resolved)
}

function setNormativePointer(target: Record<string, unknown>, pointer: string, value: unknown): void {
  const segments = pointer.slice(1).split('/').map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
  if (segments.length === 0 || segments.some((segment) => !/^[A-Za-z0-9_.-]+$/.test(segment))) throw new Phase3BProductionError('conclusion_support_invalid', 'normative source pointer cannot be materialized safely')
  let current = target
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment]
    if (next === undefined) current[segment] = {}
    else if (!next || typeof next !== 'object' || Array.isArray(next)) throw new Phase3BProductionError('conclusion_support_invalid', 'normative source pointer collides with a scalar')
    current = current[segment] as Record<string, unknown>
  }
  current[segments.at(-1)!] = value
}

function materializeCapturedConclusionSources(root: string, ledger: CampaignLedger, rows: readonly Readonly<Record<string, unknown>>[]): void {
  const targetProfile = readCanonical(root, 'prelaunch/static-anchor.json').value.target_profile as TargetProfile
  for (const id of CONCLUSION_IDS) {
    const relative = NORMATIVE_SOURCE_PATHS[id]
    createPrivateDirectory(root, path.dirname(relative))
    writeExclusiveCanonical(root, relative, capturedConclusionSource(relative, ledger, rows, targetProfile))
  }
}

function sealNormativePlanAndScenarioSources(root: string, ledger: CampaignLedger): void {
  for (const [relative, expectedSha] of [[NORMATIVE_COVERAGE_PLAN_RELATIVE, NORMATIVE_COVERAGE_PLAN_SHA256], ['docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-non-resume-amendment.md', NORMATIVE_AMENDMENT_SHA256]] as const) {
    const bytes = immutableNormativeSourceBytes(relative, expectedSha)
    createPrivateDirectory(root, path.dirname(relative))
    writeExclusiveBytes(root, relative, bytes, 0o600)
  }
  createPrivateDirectory(root, 'capsules/P3B-ES1/control')
  const programs = { schema_id: 'oracle-lab-p3b-es-scenario-program.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, programs: [...new Set(ledger.rows.map((row) => row.response_program_sha256))].sort(utf8Compare) }
  writeExclusiveCanonical(root, 'capsules/P3B-ES1/control/scenario-programs.json', programs)
}

function deriveProvenance(root: string, ledger: CampaignLedger, fixtureRows: readonly Readonly<Record<string, unknown>>[], fixturesSha256: unknown, closureSha256: unknown): Readonly<Record<string, unknown>> {
  const contractArtifact = optionalCanonical(root, ES9_COVERAGE_CONTRACT_PATH)
  if (!contractArtifact) return supportRecord({ schema_id: 'oracle-lab-p3b-pointer-source-coverage.v2', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, typed_wire_fixtures_sha256: fixturesSha256, candidate_field_closure_sha256: closureSha256, coverage_contract_sha256: null, missing_artifacts: [ES9_COVERAGE_CONTRACT_PATH], sources: [], coverage: { planned_pointer_count: 0, represented_pointer_count: 0, enabled_pointer_count: 0, disabled_pointer_count: 0, omitted_pointer_count: 0, d_leaf_enabled_count: 0, unknown_or_omitted: 'disabled' }, status: 'BLOCKED' })
  assertReviewedControlArtifact(root, contractArtifact.entry, 'es9_coverage_contract_sha256')
  const contract = validateCoverageContract(contractArtifact.value, ledger)
  let normativeResolved: readonly Readonly<Record<string, unknown>>[]
  try { normativeResolved = resolveNormativeCoverage(root, ledger, fixtureRows) } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'normative source resolution failed'
    return supportRecord({ schema_id: 'oracle-lab-p3b-pointer-source-coverage.v2', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, typed_wire_fixtures_sha256: fixturesSha256, candidate_field_closure_sha256: closureSha256, coverage_contract_sha256: contractArtifact.entry.sha256, missing_artifacts: [message], normative_resolved: [], sources: [], coverage: { planned_pointer_count: 152, represented_pointer_count: 0, normative_resolved_leaf_count: 0, enabled_pointer_count: 0, disabled_pointer_count: 0, omitted_pointer_count: 152, d_leaf_enabled_count: 0, unknown_or_omitted: 'disabled' }, status: 'BLOCKED' })
  }
  const sources: Array<Readonly<Record<string, unknown>>> = []
  for (const row of ledger.rows) {
    const fixture = fixtureRows[row.sequence_index]
    for (let attempt = 0; attempt < row.response_program.maximum_attempts; attempt += 1) {
      const observationRelative = `observations/${String(row.sequence_index).padStart(3, '0')}-${row.run_id}-${String(attempt).padStart(2, '0')}.json`
      const observation = optionalCanonical(root, observationRelative)
      for (const descriptor of contract.enabled.filter((entry) => entry.sequence_index === row.sequence_index)) {
        const pointer = `/rows/${row.sequence_index}/attempts/${attempt}/${descriptor.source_class}${descriptor.observation_pointer.startsWith('/response/') ? descriptor.observation_pointer.slice('/response'.length) : descriptor.observation_pointer}`
        if (!observation || fixture.status !== 'Reproduced') {
          const unsigned = { json_pointer: pointer, sequence_index: row.sequence_index, attempt_ordinal: attempt, source_class: descriptor.source_class, normative_source_pointer: descriptor.source_pointer, normative_source_sha256: descriptor.source_sha256, enabled: false, reason_code: 'source_observation_missing', source_relative_path: null, source_raw_sha256: null, source_observation_sha256: null, source_value_sha256: null }
          sources.push({ ...unsigned, source_binding_sha256: sha256Canonical(unsigned) })
          continue
        }
        validateObservation(observation.value, row)
        const sourceValue = resolveJsonPointer(observation.value, descriptor.observation_pointer)
        const unsigned = { json_pointer: pointer, sequence_index: row.sequence_index, attempt_ordinal: attempt, source_class: descriptor.source_class, normative_source_pointer: descriptor.source_pointer, normative_source_sha256: descriptor.source_sha256, enabled: true, reason_code: null, source_relative_path: observationRelative, source_raw_sha256: observation.entry.sha256, source_observation_sha256: observation.value.observation_sha256, source_value_sha256: sha256Canonical(sourceValue) }
        sources.push({ ...unsigned, source_binding_sha256: sha256Canonical(unsigned) })
      }
      for (const exclusion of contract.disabled.filter((entry) => entry.sequence_index === row.sequence_index)) {
        const unsigned = { json_pointer: `/rows/${row.sequence_index}/attempts/${attempt}/${exclusion.source_class}/raw_body`, sequence_index: row.sequence_index, attempt_ordinal: attempt, source_class: 'excluded', normative_source_pointer: exclusion.source_pointer, normative_source_sha256: exclusion.source_sha256, enabled: false, reason_code: exclusion.reason_code, source_relative_path: null, source_raw_sha256: null, source_observation_sha256: null, source_value_sha256: null }
        sources.push({ ...unsigned, source_binding_sha256: sha256Canonical(unsigned) })
      }
    }
  }
  const planned = ledger.rows.reduce((count, row) => count + row.response_program.maximum_attempts * (contract.enabled.filter((entry) => entry.sequence_index === row.sequence_index).length + contract.disabled.filter((entry) => entry.sequence_index === row.sequence_index).length), 0)
  const represented = new Set(sources.map((source) => source.json_pointer)).size
  const enabledCount = sources.filter((source) => source.enabled).length
  const disabledCount = sources.filter((source) => !source.enabled).length
  const dEnabledCount = sources.filter((source) => source.source_class === 'excluded' && source.enabled).length
  const expectedEnabled = ledger.rows.reduce((count, row) => count + row.response_program.maximum_attempts * contract.enabled.filter((entry) => entry.sequence_index === row.sequence_index).length, 0)
  const pass = normativeResolved.length === 152 && fixtureRows.every((row) => row.status === 'Reproduced') && planned === represented && enabledCount === expectedEnabled && disabledCount === ledger.rows.reduce((count, row) => count + row.response_program.maximum_attempts * contract.disabled.filter((entry) => entry.sequence_index === row.sequence_index).length, 0) && dEnabledCount === 0
  return supportRecord({ schema_id: 'oracle-lab-p3b-pointer-source-coverage.v2', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, typed_wire_fixtures_sha256: fixturesSha256, candidate_field_closure_sha256: closureSha256, coverage_contract_sha256: contractArtifact.entry.sha256, missing_artifacts: [], normative_resolved: normativeResolved, normative_resolution_sha256: sha256Canonical(normativeResolved), sources, coverage: { planned_pointer_count: planned, represented_pointer_count: represented, normative_resolved_leaf_count: normativeResolved.length, enabled_pointer_count: enabledCount, disabled_pointer_count: disabledCount, omitted_pointer_count: planned - represented, d_leaf_enabled_count: dEnabledCount, unknown_or_omitted: 'disabled' }, status: pass ? 'PASS' : 'INCOMPLETE' })
}

function deriveCrossRepoSupport(root: string, ledger: CampaignLedger): Readonly<Record<string, unknown>> {
  const c1 = optionalCanonical(root, 'control/cross-repo-review.json')
  const goReceipt = optionalCanonical(root, ES8_GO_RECEIPT_PATH)
  const tsAgreement = optionalCanonical(root, ES8_TS_AGREEMENT_PATH)
  if (!c1 || !goReceipt || !tsAgreement) {
    const missing = [!c1 ? 'control/cross-repo-review.json' : null, !goReceipt ? ES8_GO_RECEIPT_PATH : null, !tsAgreement ? ES8_TS_AGREEMENT_PATH : null].filter((value): value is string => value !== null)
    return supportRecord({ schema_id: 'oracle-lab-p3b-independent-go-ts-agreement.v2', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, repositories: ledger.authority, c1: ledger.c1, c1_record_raw_sha256: c1?.entry.sha256 ?? null, go_receipt_raw_sha256: goReceipt?.entry.sha256 ?? null, go_receipt_internal_sha256: null, ts_agreement_raw_sha256: tsAgreement?.entry.sha256 ?? null, ts_agreement_internal_sha256: null, missing_artifacts: missing, agreement: null, status: 'BLOCKED' })
  }
  assertExactKeys(c1.value, ['schema_id', 'verdict', 'review_sha256', 'binding_sha256'], 'conclusion_support_invalid')
  assertDigestField(c1.value, 'binding_sha256', 'conclusion_support_invalid')
  if (c1.value.schema_id !== 'oracle-lab-p3b-cross-repo-review-binding.v1' || c1.value.verdict !== 'CROSS_REPO_PASS' || c1.value.review_sha256 !== ledger.c1.review_sha256) throw new Phase3BProductionError('conclusion_support_invalid', 'sealed C1 binding drifted from the independently validated raw record')
  assertReviewedControlArtifact(root, goReceipt.entry, 'es8_go_receipt_sha256')
  assertReviewedControlArtifact(root, tsAgreement.entry, 'es8_ts_c1_agreement_sha256')
  validateIndependentGoReceipt(goReceipt.value, ledger.c1.review_sha256)
  validateIndependentTsAgreement(tsAgreement.value, goReceipt.value, goReceipt.entry.sha256, ledger)
  return supportRecord({ schema_id: 'oracle-lab-p3b-independent-go-ts-agreement.v2', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, repositories: ledger.authority, c1: ledger.c1, c1_record_raw_sha256: c1.value.review_sha256, go_receipt_raw_sha256: goReceipt.entry.sha256, go_receipt_internal_sha256: goReceipt.value.receipt_digest, ts_agreement_raw_sha256: tsAgreement.entry.sha256, ts_agreement_internal_sha256: tsAgreement.value.agreement_sha256, missing_artifacts: [], agreement: { decisions_sha256: goReceipt.value.decisions_sha256, mutation_results_sha256: goReceipt.value.mutation_results_sha256, required_set_sha256: goReceipt.value.required_set_sha256, stable_code_count: STABLE_CODE_COUNT, stable_code_set_sha256: STABLE_CODE_SET_SHA256, decision: 'PASS' }, status: 'PASS' })
}

function deriveSupportRecords(root: string, ledger: CampaignLedger): readonly Readonly<Record<string, unknown>>[] {
  const es7Contract = optionalCanonical(root, ES7_TYPED_FIXTURE_PATH)
  if (es7Contract) {
    assertReviewedControlArtifact(root, es7Contract.entry, 'es7_typed_fixtures_sha256')
    validateTypedFixtureContract(es7Contract.value, ledger)
  }
  const fixtureRows = deriveFixtureRows(root, ledger)
  const allReproduced = fixtureRows.every((row) => row.status === 'Reproduced')
  const fixtures = supportRecord({ schema_id: 'oracle-lab-p3b-typed-wire-fixtures.v3', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, fixture_contract_sha256: es7Contract?.entry.sha256 ?? null, missing_artifacts: es7Contract ? [] : [ES7_TYPED_FIXTURE_PATH], rows: fixtureRows, status: allReproduced && es7Contract ? 'PASS' : 'INCOMPLETE' })
    const fieldClosure = supportRecord({ schema_id: 'oracle-lab-p3b-candidate-field-closure.v3', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, typed_wire_fixtures_sha256: fixtures.support_sha256, closed_fields: { observation: OBSERVATION_FIELDS, response: RESPONSE_FIELDS, fixture: ['sequence_index', 'run_id', 'row_sha256', 'family', 'schedule_id', 'request_stimulus_sha256', 'status', 'contract_request_source_sha256', 'contract_response_source_sha256', 'requests', 'responses', 'fixture_sha256'], typed_request: ['schema_id', ...ES7_REQUEST_FIELDS], typed_response: ['schema_id', ...RESPONSE_FIELDS], source_binding: ['attempt_ordinal', 'source_relative_path', 'source_raw_sha256', 'source_observation_sha256', 'contract_source_sha256', 'materializer_algorithm', 'literal_table_sha256', 'typed_fixture_bytes_length', 'typed_fixture_bytes_sha256', 'ast_bytes_length', 'ast_bytes_sha256', 'materialized_normalized_bytes_length', 'materialized_normalized_bytes_sha256', 'receiver_wire_body_sha256', 'receiver_match', 'typed_fixture', 'fixture_sha256'], request_ast_binding: ['ast_bytes_length', 'ast_bytes_sha256'], unknown_fields: 'rejected' }, status: allReproduced ? 'PASS' : 'INCOMPLETE' })
  const provenance = deriveProvenance(root, ledger, fixtureRows, fixtures.support_sha256, fieldClosure.support_sha256)
  const crossRepo = deriveCrossRepoSupport(root, ledger)
  const predecessorConfigRecord = optionalCanonical(root, 'control/predecessor-config-auth.json')
  const predecessorFailureRecord = optionalCanonical(root, 'control/predecessor-failure-stream.json')
  const predecessorConfig = predecessorConfigRecord?.entry
  const predecessorFailure = predecessorFailureRecord?.entry
  const mappings = [
    { predecessor_id: 'CL-P3A-R2-CONFIG-AUTH', predecessor_sha256: predecessorConfig?.sha256 ?? null, schedules: ledger.rows.filter((row) => row.family === 'config' || row.family === 'auth').map((row) => row.schedule_id) },
    { predecessor_id: 'CL-P3A-R2-FAILURE-STREAM', predecessor_sha256: predecessorFailure?.sha256 ?? null, schedules: ['complete_sse', 'http_400_terminal', 'http_401_terminal', 'http_403_terminal', 'http_429_terminal', 'http_500_terminal', 'http_529_terminal', 'partial_sse_then_eof', 'reset_terminal'] },
  ].map((mapping) => ({ ...mapping, schedules: [...new Set(mapping.schedules)].sort(utf8Compare), reproduced_schedule_ids: [...new Set(ledger.rows.filter((row) => mapping.schedules.includes(row.schedule_id) && fixtureRows[row.sequence_index].status === 'Reproduced').map((row) => row.schedule_id))].sort(utf8Compare) }))
  const exactOrSignedTestAttestation = (record: ReturnType<typeof optionalCanonical>, conclusionId: string, conclusionSha256: string): boolean => record !== null && (record.entry.sha256 === conclusionSha256 || (record.value.schema_id === 'oracle-lab-p3b-test-predecessor-attestation.v1' && record.value.conclusion_id === conclusionId && record.value.conclusion_sha256 === conclusionSha256 && record.value.level === 'Reproduced'))
  const predecessorPass = exactOrSignedTestAttestation(predecessorConfigRecord, 'CL-P3A-R2-CONFIG-AUTH', ledger.predecessor.conclusions['CL-P3A-R2-CONFIG-AUTH']) && exactOrSignedTestAttestation(predecessorFailureRecord, 'CL-P3A-R2-FAILURE-STREAM', ledger.predecessor.conclusions['CL-P3A-R2-FAILURE-STREAM']) && mappings.every((mapping) => sha256Canonical(mapping.schedules) === sha256Canonical(mapping.reproduced_schedule_ids))
  const predecessor = supportRecord({ schema_id: 'oracle-lab-p3b-predecessor-semantic-comparison.v2', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, predecessor_scope: ledger.predecessor.scope, mappings, predecessor_config_sha256: predecessorConfig?.sha256 ?? ledger.predecessor.conclusions['CL-P3A-R2-CONFIG-AUTH'], predecessor_failure_stream_sha256: predecessorFailure?.sha256 ?? ledger.predecessor.conclusions['CL-P3A-R2-FAILURE-STREAM'], status: predecessorPass ? 'PASS' : 'INCOMPLETE' })
  return deepFreeze([fixtures, fieldClosure, provenance, crossRepo, predecessor])
}

function sealConclusionSupport(root: string, ledger: CampaignLedger): readonly Readonly<Record<string, unknown>>[] {
  createPrivateDirectory(root, SUPPORT_ROOT)
  const records = deriveSupportRecords(root, ledger)
  records.forEach((record, index) => writeExclusiveCanonical(root, SUPPORT_PATHS[index], record))
  return records
}

export function validateConclusionSupport(root: string, requirePass: boolean): readonly string[] {
  try {
    const ledger = validateCampaignLedger(readCanonical(root, 'prelaunch/run-ledger.json', 16_777_216).value)
    const expected = deriveSupportRecords(root, ledger)
    return SUPPORT_PATHS.map((relative, index) => {
      const value = readCanonical(root, relative, 16_777_216).value
      assertDigestField(value, 'support_sha256', 'conclusion_support_invalid')
      if (sha256Canonical(value) !== sha256Canonical(expected[index]) || (requirePass && value.status !== 'PASS')) throw new Phase3BProductionError('conclusion_support_invalid', 'support bytes do not match actual ES7 fixtures, ES8 agreement/C1, and ES9 pointer/source coverage')
      return String(value.support_sha256)
    })
  } catch (error: unknown) {
    if (error instanceof Phase3BProductionError && error.code === 'conclusion_support_invalid') throw error
    throw new Phase3BProductionError('conclusion_support_invalid', 'required ES7, ES8, or ES9 support artifact is missing, malformed, or drifted')
  }
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
  sealNormativePlanAndScenarioSources(root, ledger)
  materializeCapturedConclusionSources(root, ledger, rows)
  const openContradictionIds = [...new Set(rows.filter((row) => row.status !== 'Reproduced').map((row) => `P3B-UNKNOWN-${String(row.schedule_id).toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`))].sort(utf8Compare)
  const support = sealConclusionSupport(root, ledger)
  const supportSha256s = support.map((value) => value.support_sha256)
  if (support.some((value) => value.status !== 'PASS')) openContradictionIds.push('P3B-CONCLUSION-SUPPORT-INCOMPLETE')
  const normativeResolutionSha256 = typeof support[2]?.normative_resolution_sha256 === 'string' ? support[2].normative_resolution_sha256 : null
  const supportPass = support.every((value) => value.status === 'PASS')
  for (const conclusionId of CONCLUSION_IDS) {
    const familyRows = rows.filter((row) => conclusionFamily(conclusionId).includes(String(row.family)))
    const reproduced = familyRows.length > 0 && familyRows.every((row) => row.status === 'Reproduced') && supportPass
    const sourcePath = NORMATIVE_SOURCE_PATHS[conclusionId]
    const sourceIdentity = readCanonical(root, sourcePath, 16_777_216).identity
    const metadata = normativeSourceMetadata(sourcePath)
    if (!metadata) throw new Phase3BProductionError('conclusion_support_invalid', 'fixed normative conclusion metadata is missing')
    const contradictionIds = reproduced ? [] : [...new Set(openContradictionIds.filter((id) => id === 'P3B-CONCLUSION-SUPPORT-INCOMPLETE' || familyRows.some((row) => id.endsWith(String(row.schedule_id).toUpperCase().replace(/[^A-Z0-9]+/g, '-')))))].sort(utf8Compare)
    const unsigned = { schema_id: 'oracle-lab-p3b-successor-conclusion.v1', source_schema: metadata.schema, conclusion_id: conclusionId, campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, level: reproduced ? 'Reproduced' : 'Unknown', enabled: reproduced, created_at_ms: curationClock.created_at_ms, issued_at_ms: curationClock.created_at_ms, expires_at_ms: Number(curationClock.created_at_ms) + SUCCESSOR_TTL_MS, clock_attestation_sha256: curationClock.clock_sha256, contradiction_ids: contradictionIds, source_row_set_sha256: sha256Canonical(familyRows), source_document_sha256: sourceIdentity.sha256, normative_resolution_sha256: normativeResolutionSha256, supporting_evidence_sha256s: reproduced ? supportSha256s : [], unknown_or_omitted: 'disabled' }
    createPrivateDirectory(root, path.dirname(CONCLUSION_PATHS[conclusionId]))
    writeExclusiveCanonical(root, CONCLUSION_PATHS[conclusionId], { ...unsigned, conclusion_sha256: sha256Canonical(unsigned) })
  }
  const conclusionRecords: Array<Readonly<Record<string, unknown>>> = CONCLUSION_IDS.map((conclusionId) => readCanonical(root, CONCLUSION_PATHS[conclusionId], 16_777_216).value)
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

function forbiddenMaterialBytes(bytes: Buffer, relativePath = ''): boolean {
  if (relativePath === 'control/trusted-reviewers.json') {
    try { validateCampaignReviewerRegistry(JSON.parse(bytes.subarray(-1)[0] === 0x0a ? bytes.subarray(0, -1).toString('utf8') : bytes.toString('utf8'))) ; return false } catch { return true }
  }
  const text = bytes.toString('utf8')
  const direct = /(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{8,}|\bBearer\s+[A-Za-z0-9._~+\/-]{4,}|(?:%[0-9a-f]{2}){2,}|"(?:[^"\n]*(?:_base64|_hex|url_encoded|raw_prompt|raw_body|raw_bytes|secret|password|authorization|token|credential))"\s*:)/i
  if (direct.test(text)) return true
  const candidates = text.match(/(?:[A-Za-z0-9+/]{20,}={0,2}|[0-9a-f]{32,}|(?:%[0-9a-f]{2}){2,})/gi) ?? []
  for (const candidate of candidates) {
    try {
      const decoded = Buffer.from(candidate, /^[0-9a-f]+$/i.test(candidate) ? 'hex' : candidate.includes('%') ? 'utf8' : 'base64').toString('utf8')
      const printable = decoded.length === 0 ? 0 : [...decoded].filter((character) => character.charCodeAt(0) >= 0x20 && character.charCodeAt(0) <= 0x7e).length / decoded.length
      if (printable >= 0.85 && /\b(?:sk-|Bearer\s+)|(?:secret|password|authorization|token|credential)/i.test(decoded)) return true
    } catch {}
  }
  return false
}

function leakScanEntries(root: string, excludedRelative: string): readonly Readonly<{ relative_path: string; size_bytes: number; sha256: string; forbidden: boolean }>[] {
  const entries: Array<Readonly<{ relative_path: string; size_bytes: number; sha256: string; forbidden: boolean }>> = []
  const walk = (relativeDirectory: string): void => {
    const absolute = relativeDirectory ? path.join(root, relativeDirectory) : root
    for (const name of readdirSync(absolute).sort(utf8Compare)) {
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name
      if (relative === excludedRelative || relative === 'launch-images/original-image' || relative === 'launch-images/probe-image') continue
      const file = path.join(root, relative)
      const stat = lstatSync(file)
      if (stat.isSymbolicLink()) throw new Phase3BProductionError('leak_report_invalid', 'leak scan encountered a symlink')
      if (stat.isDirectory()) { walk(relative); continue }
      if (!stat.isFile() || stat.nlink !== 1) throw new Phase3BProductionError('leak_report_invalid', 'leak scan encountered a non-regular or hard-linked leaf')
      const stable = stableRead(file, { maximumBytes: TARGET_PROFILE.maximum_executable_bytes, nonempty: false })
      entries.push(deepFreeze({ relative_path: relative, size_bytes: stable.identity.size, sha256: stable.identity.sha256, forbidden: forbiddenMaterialBytes(stable.bytes, relative) }))
    }
  }
  walk('')
  return deepFreeze(entries)
}

export function writePostGateLeakReport(evidenceRoot: string): Readonly<Record<string, unknown>> {
  const root = assertPrivateRuntimeRoot(evidenceRoot)
  const relative = 'capsules/P3B-ES1/gates/post-gate-leak-report.json'
  const gateB = readCanonical(root, 'capsules/P3B-ES1/gates/gate-b-result.json').value
  assertDigestField(gateB, 'gate_result_sha256', 'gate_b_result_invalid')
  const preGate = readCanonical(root, `${CLOSURE_ROOT}/leak-report.json`).value
  assertDigestField(preGate, 'leak_report_sha256', 'leak_report_invalid')
  const entries = leakScanEntries(root, relative)
  const findings = entries.filter((entry) => entry.forbidden).map((entry) => ({ relative_path: entry.relative_path, finding: 'forbidden_material' }))
  const unsigned = { schema_id: 'oracle-lab-p3b-post-gate-leak-report.v1', campaign_id: gateB.campaign_id, gate_b_result_sha256: gateB.gate_result_sha256, pre_gate_leak_report_sha256: preGate.leak_report_sha256, scanned_entries: entries, findings, status: findings.length === 0 && preGate.status === 'PASS' ? 'PASS' : 'BLOCKED' }
  const report = deepFreeze({ ...unsigned, post_gate_leak_report_sha256: sha256Canonical(unsigned) })
  writeExclusiveCanonical(root, relative, report)
  return report
}

export function validatePostGateLeakReport(evidenceRoot: string): Readonly<Record<string, unknown>> {
  const root = assertPrivateRuntimeRoot(evidenceRoot)
  const relative = 'capsules/P3B-ES1/gates/post-gate-leak-report.json'
  const report = readCanonical(root, relative, 16_777_216).value
  assertExactKeys(report, ['schema_id', 'campaign_id', 'gate_b_result_sha256', 'pre_gate_leak_report_sha256', 'scanned_entries', 'findings', 'status', 'post_gate_leak_report_sha256'], 'leak_report_invalid')
  assertDigestField(report, 'post_gate_leak_report_sha256', 'leak_report_invalid')
  const gateB = readCanonical(root, 'capsules/P3B-ES1/gates/gate-b-result.json').value
  const preGate = readCanonical(root, `${CLOSURE_ROOT}/leak-report.json`).value
  const entries = leakScanEntries(root, relative)
  const findings = entries.filter((entry) => entry.forbidden).map((entry) => ({ relative_path: entry.relative_path, finding: 'forbidden_material' }))
  const unsigned = { schema_id: 'oracle-lab-p3b-post-gate-leak-report.v1', campaign_id: gateB.campaign_id, gate_b_result_sha256: gateB.gate_result_sha256, pre_gate_leak_report_sha256: preGate.leak_report_sha256, scanned_entries: entries, findings, status: findings.length === 0 && preGate.status === 'PASS' ? 'PASS' : 'BLOCKED' }
  if (report.schema_id !== unsigned.schema_id || report.status !== 'PASS' || findings.length !== 0 || sha256Canonical(report) !== sha256Canonical({ ...unsigned, post_gate_leak_report_sha256: sha256Canonical(unsigned) })) throw new Phase3BProductionError('leak_report_invalid', 'post-Gate leak report does not match a fresh recursive persisted-tree scan')
  return deepFreeze(report)
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
  const findings = entries.filter((entry) => !(entry.relative_path === 'launch-images/original-image' || entry.relative_path === 'launch-images/probe-image')).filter((entry) => forbiddenMaterialBytes(stableRead(path.join(root, entry.relative_path), { maximumBytes: 134_217_728, nonempty: false }).bytes, entry.relative_path)).map((entry) => ({ relative_path: entry.relative_path, finding: 'forbidden_material' }))
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
    const record = readCanonical(root, relative, 16_777_216)
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
    const actual = readCanonical(root, String(record.relative_path), 16_777_216)
    if (actual.identity.sha256 !== record.sha256 || actual.value.schema_id !== record.schema_id) throw new Phase3BProductionError('external_set_invalid', 'external set does not bind actual artifact bytes')
  })
  return external
}
