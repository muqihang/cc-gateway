import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Phase3BProductionError, assertDigestField, assertExactKeys, assertSha256, canonicalJson, deepFreeze, deterministicUuidV4, sha256Bytes, sha256Canonical, utf8Compare } from './core.js'
import { bootstrapContractFor, configRoutePlanFor, type BootstrapContract } from './route-policy.js'
import { fixedGit, fixedGitBytes } from './trust.js'

export const FIXED_SEEDS = [215001, 215002, 215003, 215004, 215005] as const
export const FIXED_STDIN_LITERAL = 'Return exactly the synthetic marker output.complete.\n'
export const FIXED_STDIN_LITERAL_REF = 'synthetic-literals/control_prompt_v1'
export const LOCAL_AUTH_RESULT_LITERAL = 'Not logged in \u00b7 Please run /login'
export const LOCAL_AUTH_RESULT_SHA256 = sha256Bytes(Buffer.from(LOCAL_AUTH_RESULT_LITERAL, 'utf8'))
export const LOCAL_AUTH_OUTPUT_PROFILE_SHA256 = sha256Canonical({
  schema_id: 'oracle-lab-p3b-local-auth-output-profile.v1',
  top_level: ['api_error_status', 'duration_api_ms', 'duration_ms', 'fast_mode_state', 'is_error', 'modelUsage', 'num_turns', 'permission_denials', 'result', 'session_id', 'stop_reason', 'subtype', 'terminal_reason', 'total_cost_usd', 'type', 'usage', 'uuid'],
  constants: { api_error_status: null, duration_api_ms: 0, fast_mode_state: 'off', is_error: true, num_turns: 1, permission_denials: 'exact-empty-array', result_sha256: LOCAL_AUTH_RESULT_SHA256, session_id: 'exact-run-id', stop_reason: 'stop_sequence', subtype: 'success', terminal_reason: 'api_error', total_cost_usd: 0, type: 'result' },
  dynamic: { duration_ms: 'safe-integer-0-through-120000', uuid: 'uuid-v4' },
  model_usage: 'exact-empty-object',
  usage: { token_counts: 0, server_tool_counts: 0, service_tier: 'standard', cache_creation_counts: 0, inference_geo: '', iterations: 'exact-empty-array', speed: 'standard' },
})
export const CLAUDE_MESSAGES_PATH = '/v1/messages'
export const CLAUDE_MESSAGES_QUERY = 'beta=true'
export const CLAUDE_MESSAGES_REQUEST_TARGET = `${CLAUDE_MESSAGES_PATH}?${CLAUDE_MESSAGES_QUERY}`
export const CLAUDE_MESSAGES_QUERY_ORDER = deepFreeze(['beta'] as const)
export const CLAUDE_MESSAGES_QUERY_ITEMS = deepFreeze([{ name: 'beta', value: 'true' }] as const)
export const CLAUDE_MESSAGES_REQUEST_CONTRACT = deepFreeze({ method: 'POST' as const, path: CLAUDE_MESSAGES_PATH, query_present: true as const, query_order: CLAUDE_MESSAGES_QUERY_ORDER, query_items: CLAUDE_MESSAGES_QUERY_ITEMS })
export const BOOTSTRAP_CONTRACT_SCHEMA = deepFreeze({ schema_id: 'oracle-lab-p3b-bootstrap-contract.v1' as const, expected_count: [0, 1] as const, expected_route_ordinal: [null, 0, 1] as const, derivation: 'exact-winning-config-source-v1' as const })
export const FIXED_LITERAL_TABLE_PATH = 'synthetic-literals/phase3b-v1.json'
export const FIXED_LITERAL_TABLE = deepFreeze({ schema_id: 'oracle-lab-p3b-synthetic-literals.v1', control_prompt_v1: FIXED_STDIN_LITERAL, request_model_v1: 'claude-sonnet-4-6', 'model.test': 'model.test', 'output.complete': 'output.complete' })
export const FIXED_LITERAL_TABLE_SHA256 = sha256Bytes(Buffer.from(`${canonicalJson(FIXED_LITERAL_TABLE)}\n`, 'utf8'))

export const REPOSITORY_AUTHORITY = deepFreeze({
  cc: { commit: '56dc4f86a68157709fb529e9ad64d6386365608a', tree: '3209c46f6455a2bdf2fb8bb1dd816fe12937892f' },
  sub: { commit: '910a8fb3caa317409be48af31af699932be1f2a7', tree: 'e6a788c98c9b529a47e88f97ae82fb489cff15cd' },
})

export const CROSS_REPO_AUTHORITY = deepFreeze({
  verdict: 'CROSS_REPO_PASS',
})

export type CrossRepoAuthority = Readonly<typeof CROSS_REPO_AUTHORITY & { review_sha256: string }>

export function crossRepoAuthority(reviewSha256: string): CrossRepoAuthority {
  assertSha256(reviewSha256, 'cross_repo_authority_invalid', 'cross repo review')
  return deepFreeze({ ...CROSS_REPO_AUTHORITY, review_sha256: reviewSha256 })
}

export const PREDECESSOR_AUTHORITY = deepFreeze({
  scope: 'claude-code-2.1.215 darwin-arm64 synthetic loopback',
  expires_at: '2026-08-03T00:00:00.000Z',
  conclusions: {
    'CL-P3A-R2-CONFIG-AUTH': 'acaffa9fe6e2d9f1eede5d6bf65f32369558275cfa893b9e97187bed3f37b905',
    'CL-P3A-R2-FAILURE-STREAM': 'fa0dafe1edc8afccbcc4f10f94513c432c2e61e518bf6e38c47c90b7ba8224e4',
  },
})

export const TARGET_PROFILE = deepFreeze({
  package: '@anthropic-ai/claude-code-darwin-arm64',
  version: '2.1.215',
  platform: 'darwin',
  architecture: 'arm64',
  platform_archive_sha256: 'b5dd6a135c96957dae232218c4ae5b04328a788f8c509202c92a2fec550601b2',
  platform_tree_sha256: '864f493d9fc237df6a858e1620c83279b8f6c15f205dbb47c058f3f537e924a6',
  entrypoint_sha256: '90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58',
  entrypoint_size: 247_124_336,
  maximum_executable_bytes: 268_435_456,
})

export type TargetProfile = Readonly<{
  package: string
  version: string
  platform: 'darwin'
  architecture: 'arm64'
  platform_archive_sha256: string
  platform_tree_sha256: string
  entrypoint_sha256: string
  entrypoint_size: number
  maximum_executable_bytes: number
}>

export type LedgerFamily = 'target_control' | 'config' | 'auth' | 'request_wire' | 'response_failure_recovery'
export type ExecutableArm = 'instrumented' | 'uninstrumented' | 'control/instrumented' | 'control/uninstrumented' | 'treatment/instrumented' | 'treatment/uninstrumented'

export type ResponseAction = Readonly<{
  action_ordinal: number
  kind: 'http' | 'reset'
  status: number | null
  ordered_headers: readonly Readonly<{ name: string; value_class: string }>[]
  body_kind: 'complete_sse' | 'partial_sse' | 'error_json' | 'empty'
  delay_class: 'none' | 'bounded_before_headers'
  delay_ms: number
  transport_terminal: 'http_complete' | 'eof_after_partial' | 'reset_before_headers'
}>

export type ResponseProgram = Readonly<{
  schema_id: 'oracle-lab-p3b-response-program.v1'
  program_id: string
  maximum_attempts: number
  actions: readonly ResponseAction[]
  complete_sse: Readonly<{
    framing: 'lf'
    event_order: readonly ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']
    materialized_literal_refs: readonly ['synthetic-literals/model.test', 'synthetic-literals/output.complete']
    materialized_response_sha256: string
  }> | null
  program_sha256: string
}>

export type RunLedgerRow = Readonly<{
  run_id: string
  sequence_index: number
  family: LedgerFamily
  schedule_id: string
  seed: number
  repetition: number
  arm: ExecutableArm
  selected_executable_class: 'original_image' | 'probe_image'
  receiver_group_id: string
  route_count: 1 | 2
  guard_profile_sha256: string
  target_launch_cost: 1
  external_socket_budget: 0
  bootstrap_contract: BootstrapContract
  request_target: typeof CLAUDE_MESSAGES_REQUEST_CONTRACT
  argv: readonly string[]
  argv_sha256: string
  request_stimulus: Readonly<{ stimulus_id: string; tool_policy: string; argv_suffix: readonly string[]; stimulus_sha256: string }>
  request_stimulus_sha256: string
  environment_sha256: string
  cwd_ref: '$SEALED_RUNTIME_ROOT'
  cwd_sha256: string
  stdin_literal_ref: typeof FIXED_STDIN_LITERAL_REF
  stdin_sha256: string
  literal_table_path: typeof FIXED_LITERAL_TABLE_PATH
  literal_table_sha256: string
  response_program: ResponseProgram
  response_program_sha256: string
  state: 'planned'
  row_sha256: string
}>

export function isExpectedLocalAuthFailureRow(row: RunLedgerRow): boolean {
  return row.family === 'auth'
    && row.schedule_id === 'auth-missing-credential'
    && (row.arm === 'treatment/instrumented' || row.arm === 'treatment/uninstrumented')
}

export function expectedReceiverAttempts(row: RunLedgerRow): number {
  return isExpectedLocalAuthFailureRow(row) ? 0 : row.response_program.maximum_attempts
}

export function expectedBootstrapCount(row: RunLedgerRow): 0 | 1 {
  const expected = bootstrapContractFor(row.family, row.schedule_id, row.arm)
  if (sha256Canonical(row.bootstrap_contract) !== sha256Canonical(expected)) throw new Phase3BProductionError('launch_ledger_invalid', 'bootstrap contract is not derived from the sealed row')
  return expected.expected_count
}

export type CampaignLedger = Readonly<{
  schema_id: 'oracle-lab-p3b-production-ledger.v1'
  campaign_id: string
  authority: typeof REPOSITORY_AUTHORITY
  c1: CrossRepoAuthority
  predecessor: typeof PREDECESSOR_AUTHORITY
  fixed_seeds: typeof FIXED_SEEDS
  counts: Readonly<{ mandatory_target_controls: 20; config: 80; auth: 80; request_wire: 30; response_failure_recovery: 130; total_rows: 340 }>
  target_launch_ceiling: 340
  parallel_target_launches: 1
  external_socket_budget: 0
  request_target: typeof CLAUDE_MESSAGES_REQUEST_CONTRACT
  schedule_descriptors: readonly Readonly<Record<string, unknown>>[]
  rows: readonly RunLedgerRow[]
  ledger_sha256: string
}>

const COMPLETE_EVENTS = ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop'] as const
const COMPLETE_RESPONSE_EVENTS = [
  { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_phase3b_synthetic', type: 'message', role: 'assistant', model: 'model.test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } },
  { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
  { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'output.complete' } } },
  { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
  { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } } },
  { event: 'message_stop', data: { type: 'message_stop' } },
] as const
const COMPLETE_RESPONSE = `${COMPLETE_RESPONSE_EVENTS.map(({ event, data }) => `event: ${event}\ndata: ${canonicalJson(data)}\n`).join('\n')}\n`
const ERROR_RESPONSE = canonicalJson({ type: 'error', error: { type: 'synthetic_error' } })

const COMPLETE_ACTION: ResponseAction = deepFreeze({
  action_ordinal: 0,
  kind: 'http',
  status: 200,
  ordered_headers: [{ name: 'content-type', value_class: 'text/event-stream' }],
  body_kind: 'complete_sse',
  delay_class: 'none',
  delay_ms: 0,
  transport_terminal: 'http_complete',
})

function actionFor(programId: string, ordinal: number): ResponseAction {
  if ((programId === 'reset_terminal' || programId === 'reset_before_headers_then_complete') && ordinal === 0) {
    return deepFreeze({ action_ordinal: ordinal, kind: 'reset', status: null, ordered_headers: [], body_kind: 'empty', delay_class: 'none', delay_ms: 0, transport_terminal: 'reset_before_headers' })
  }
  if (programId === 'partial_sse_then_eof') {
    return deepFreeze({ action_ordinal: ordinal, kind: 'http', status: 200, ordered_headers: [{ name: 'content-type', value_class: 'text/event-stream' }], body_kind: 'partial_sse', delay_class: 'none', delay_ms: 0, transport_terminal: 'eof_after_partial' })
  }
  const statusMatch = /^http_(400|401|403|429|500|529)(?:_terminal|_then_complete)$/.exec(programId)
  if (statusMatch && ordinal === 0) {
    return deepFreeze({ action_ordinal: ordinal, kind: 'http', status: Number(statusMatch[1]), ordered_headers: [{ name: 'content-type', value_class: 'application/json' }], body_kind: 'error_json', delay_class: 'none', delay_ms: 0, transport_terminal: 'http_complete' })
  }
  if ((programId === 'http_429_terminal' || programId === 'http_500_terminal' || programId === 'http_529_terminal' || programId === 'reset_terminal') && ordinal === 1) return deepFreeze({ action_ordinal: ordinal, kind: 'http', status: 400, ordered_headers: [{ name: 'content-type', value_class: 'application/json' }], body_kind: 'error_json', delay_class: 'none', delay_ms: 0, transport_terminal: 'http_complete' })
  if (programId === 'delayed_headers_boundary') {
    return deepFreeze({ ...COMPLETE_ACTION, action_ordinal: ordinal, delay_class: 'bounded_before_headers', delay_ms: 25 })
  }
  return deepFreeze({ ...COMPLETE_ACTION, action_ordinal: ordinal })
}

export function buildResponseProgram(programId: string): ResponseProgram {
  const retryPrograms = new Set(['http_429_terminal', 'http_500_terminal', 'http_529_terminal', 'reset_terminal', 'http_429_then_complete', 'http_500_then_complete', 'reset_before_headers_then_complete'])
  const actionCount = retryPrograms.has(programId) ? 2 : 1
  const actions = Array.from({ length: actionCount }, (_, index) => actionFor(programId, index))
  const completeSse = actions.some((action) => action.body_kind === 'complete_sse') ? deepFreeze({
    framing: 'lf' as const,
    event_order: COMPLETE_EVENTS,
    materialized_literal_refs: ['synthetic-literals/model.test', 'synthetic-literals/output.complete'] as const,
    materialized_response_sha256: sha256Bytes(Buffer.from(COMPLETE_RESPONSE, 'utf8')),
  }) : null
  const unsigned = { schema_id: 'oracle-lab-p3b-response-program.v1' as const, program_id: programId, maximum_attempts: actionCount, actions, complete_sse: completeSse }
  return deepFreeze({ ...unsigned, program_sha256: sha256Canonical(unsigned) })
}

export function materializeResponseBody(kind: ResponseAction['body_kind']): string {
  if (kind === 'complete_sse') return COMPLETE_RESPONSE
  if (kind === 'partial_sse') return COMPLETE_RESPONSE.split('event: content_block_stop', 1)[0]
  if (kind === 'error_json') return ERROR_RESPONSE
  return ''
}

export const ES7_REQUEST_FIELDS = deepFreeze(['method', 'path', 'query_present', 'query_order', 'query_items', 'ordered_header_classes', 'header_presence', 'auth_marker_winner_class', 'body_byte_length', 'body_sha256', 'body_ast', 'body_ast_sha256', 'body_normalized_byte_length', 'body_normalized_sha256', 'body_roundtrip_sha256'] as const)
export const ES7_RESPONSE_FIELDS = deepFreeze(['status', 'ordered_header_classes', 'body_byte_length', 'body_sha256', 'sse_event_order', 'transport_terminal', 'delay_elapsed_ns', 'timing_bucket', 'wire_events', 'wire_event_sha256', 'socket_close_had_error'] as const)

function canonicalLine(value: unknown): Buffer {
  return Buffer.from(`${canonicalJson(value)}\n`, 'utf8')
}

export function materializeEs7Sources(row: RunLedgerRow): Readonly<Record<string, unknown>> {
  const requestBytes = canonicalLine({ schema_id: 'oracle-lab-p3b-es7-request-source.v1', request_target: CLAUDE_MESSAGES_REQUEST_CONTRACT, bootstrap_contract: row.bootstrap_contract, argv: row.argv, request_stimulus: row.request_stimulus, stdin_literal_ref: row.stdin_literal_ref, stdin_byte_length: Buffer.byteLength(FIXED_STDIN_LITERAL), stdin_sha256: sha256Bytes(Buffer.from(FIXED_STDIN_LITERAL, 'utf8')), literal_table: FIXED_LITERAL_TABLE })
  const responseBytes = canonicalLine({ schema_id: 'oracle-lab-p3b-es7-response-source.v1', actions: row.response_program.actions.map((action) => { const body = Buffer.from(materializeResponseBody(action.body_kind), 'utf8'); return { ...action, body_byte_length: body.byteLength, body_sha256: sha256Bytes(body) } }), complete_sse: row.response_program.complete_sse, literal_table: FIXED_LITERAL_TABLE })
  return deepFreeze({
    sequence_index: row.sequence_index, run_id: row.run_id, row_sha256: row.row_sha256, request_stimulus_sha256: row.request_stimulus_sha256, response_program_sha256: row.response_program_sha256, maximum_attempts: row.response_program.maximum_attempts,
    request_source_byte_length: requestBytes.byteLength, request_source_sha256: sha256Bytes(requestBytes), response_source_byte_length: responseBytes.byteLength, response_source_sha256: sha256Bytes(responseBytes),
  })
}

export const NORMATIVE_COVERAGE_PLAN_RELATIVE = 'docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-normalized-safe-evidence-sufficiency-supplement.md'
export const NORMATIVE_COVERAGE_PLAN_SHA256 = '1583dad45085e3dc18941349f323e2342eedd0ff273eb12a7a1a43f5dc736a57'
const NORMATIVE_SOURCE_COMMIT = '64dbbb3822d9dfdc4be8523e801fcfee65983f48'
const NORMATIVE_COVERAGE_PLAN_BLOB = '3a31c9b3e4bb3bb41177a0a644c4436b6d2f2db5'
const NORMATIVE_AMENDMENT_RELATIVE = 'docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-non-resume-amendment.md'
const NORMATIVE_AMENDMENT_BLOB = '458033da9e6a858d2d4ee110456927a2cbcc06ea'
const NORMATIVE_REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const COVERAGE_BLOCK_OPEN = '```json coverage-source-bindings\n'

export function immutableNormativeSourceBytes(relative: string, expectedSha256: string): Buffer {
  const blob = relative === NORMATIVE_COVERAGE_PLAN_RELATIVE ? NORMATIVE_COVERAGE_PLAN_BLOB : relative === NORMATIVE_AMENDMENT_RELATIVE ? NORMATIVE_AMENDMENT_BLOB : null
  if (!blob || fixedGit(NORMATIVE_REPOSITORY, ['rev-parse', `${NORMATIVE_SOURCE_COMMIT}:${relative}`]) !== blob) throw new Phase3BProductionError('conclusion_support_invalid', 'normative Git object/path is outside the fixed source universe')
  const bytes = fixedGitBytes(NORMATIVE_REPOSITORY, ['cat-file', 'blob', blob], 262_144)
  if (sha256Bytes(bytes) !== expectedSha256) throw new Phase3BProductionError('conclusion_support_invalid', 'normative Git object bytes drifted')
  return bytes
}

export function normativeCoverageMatrix(ledger: CampaignLedger): Readonly<{ rows: readonly Readonly<Record<string, unknown>>[]; e_rows: readonly Readonly<Record<string, unknown>>[]; c_rows: readonly Readonly<Record<string, unknown>>[]; d_rows: readonly Readonly<Record<string, unknown>>[]; leaf_count: number }> {
  if (ledger.rows.length !== 340) throw new Phase3BProductionError('conclusion_support_invalid', 'normative coverage requires the exact 340-row campaign ledger')
  const planBytes = immutableNormativeSourceBytes(NORMATIVE_COVERAGE_PLAN_RELATIVE, NORMATIVE_COVERAGE_PLAN_SHA256)
  const text = planBytes.toString('utf8')
  const start = text.indexOf(COVERAGE_BLOCK_OPEN)
  const end = start < 0 ? -1 : text.indexOf('\n```', start + COVERAGE_BLOCK_OPEN.length)
  let parsed: unknown
  try { parsed = JSON.parse(text.slice(start + COVERAGE_BLOCK_OPEN.length, end)) } catch { throw new Phase3BProductionError('conclusion_support_invalid', 'normative E/C/D coverage matrix is not valid JSON') }
  if (start < 0 || end < 0 || !Array.isArray(parsed) || parsed.length !== 26) throw new Phase3BProductionError('conclusion_support_invalid', 'normative E/C/D coverage matrix is absent or incomplete')
  const ids = new Set<string>()
  const leaves = new Set<string>()
  const rows = parsed.map((entry) => {
    assertExactKeys(entry, ['id', 'leaves', 'class', 'source_kind', 'source_relative_path', 'source_sha256_binding', 'source_schema', 'scope', 'conclusion_id', 'expiry_binding', 'transform', 'missing_action'], 'conclusion_support_invalid')
    if (typeof entry.id !== 'string' || ids.has(entry.id) || !Array.isArray(entry.leaves) || entry.leaves.length === 0 || !['E', 'C', 'D'].includes(String(entry.class)) || entry.leaves.some((leaf) => typeof leaf !== 'string' || !leaf.startsWith('/') || leaves.has(leaf))) throw new Phase3BProductionError('conclusion_support_invalid', 'normative coverage row ID, class, or leaf set drifted')
    ids.add(entry.id)
    entry.leaves.forEach((leaf) => leaves.add(String(leaf)))
    return deepFreeze(entry as Record<string, unknown>)
  })
  const byClass = (rowClass: 'E' | 'C' | 'D') => rows.filter((row) => row.class === rowClass)
  const eRows = byClass('E'); const cRows = byClass('C'); const dRows = byClass('D')
  if (eRows.length !== 20 || cRows.length !== 3 || dRows.length !== 3 || leaves.size !== 152) throw new Phase3BProductionError('conclusion_support_invalid', 'normative E/C/D coverage class counts drifted')
  return deepFreeze({ rows, e_rows: eRows, c_rows: cRows, d_rows: dRows, leaf_count: leaves.size })
}

export function observationCoverageMatrix(ledger: CampaignLedger): Readonly<{ enabled: readonly Readonly<Record<string, unknown>>[]; disabled: readonly Readonly<Record<string, unknown>>[] }> {
  const enabled: Array<Readonly<Record<string, unknown>>> = []
  const disabled: Array<Readonly<Record<string, unknown>>> = []
  for (const row of ledger.rows) {
    for (const [sourceClass, fields] of [['request', ES7_REQUEST_FIELDS], ['response', ES7_RESPONSE_FIELDS]] as const) {
      for (const field of fields) {
        const sourceObject = { schema_id: 'oracle-lab-p3b-es9-source.v1', sequence_index: row.sequence_index, row_sha256: row.row_sha256, source_class: sourceClass, field, authority_sha256: sourceClass === 'request' ? row.request_stimulus_sha256 : row.response_program_sha256, ...(sourceClass === 'request' ? { bootstrap_contract_sha256: sha256Canonical(row.bootstrap_contract) } : {}) }
        const sourceBytes = canonicalLine(sourceObject)
        const binding = { sequence_index: row.sequence_index, source_class: sourceClass, source_pointer: `/rows/${row.sequence_index}/${sourceClass === 'request' ? 'request_stimulus' : 'response_program'}/${field}`, observation_pointer: sourceClass === 'request' ? `/${field}` : `/response/${field}`, source_byte_length: sourceBytes.byteLength, source_sha256: sha256Bytes(sourceBytes) }
        if (isExpectedLocalAuthFailureRow(row)) disabled.push({ ...binding, reason_code: 'expected_local_auth_pre_request' })
        else enabled.push(binding)
      }
    }
    for (const sourceClass of ['request', 'response'] as const) {
      const sourceObject = { schema_id: 'oracle-lab-p3b-es9-exclusion.v1', sequence_index: row.sequence_index, row_sha256: row.row_sha256, source_class: sourceClass, field: 'raw_body', reason_code: 'sensitive_raw_bytes' }
      const sourceBytes = canonicalLine(sourceObject)
      disabled.push({ sequence_index: row.sequence_index, source_class: sourceClass, source_pointer: `/rows/${row.sequence_index}/${sourceClass === 'request' ? 'request_stimulus' : 'response_program'}/raw_body`, observation_pointer: sourceClass === 'request' ? '/raw_body' : '/response/raw_body', reason_code: 'sensitive_raw_bytes', source_byte_length: sourceBytes.byteLength, source_sha256: sha256Bytes(sourceBytes) })
    }
  }
  return deepFreeze({ enabled, disabled })
}

const TWO_ARMS = ['instrumented', 'uninstrumented'] as const
const FOUR_ARMS = ['control/instrumented', 'control/uninstrumented', 'treatment/instrumented', 'treatment/uninstrumented'] as const
const CONTROL_DEFINITIONS = [
  { family: 'target_control' as const, schedule_id: 'target-guard-control', arms: TWO_ARMS },
  { family: 'target_control' as const, schedule_id: 'target-perturbation-control', arms: TWO_ARMS },
]
const DYNAMIC_DEFINITIONS: ReadonlyArray<Readonly<{ family: LedgerFamily; schedule_id: string; arms: readonly ExecutableArm[] }>> = [
  ...['config-precedence-user-vs-default', 'config-precedence-project-vs-user', 'config-precedence-local-vs-project', 'config-precedence-process-env-vs-local'].map((schedule_id) => ({ family: 'config' as const, schedule_id, arms: FOUR_ARMS })),
  ...['auth-api-key-rotation', 'auth-token-rotation', 'auth-credential-coexistence', 'auth-missing-credential'].map((schedule_id) => ({ family: 'auth' as const, schedule_id, arms: FOUR_ARMS })),
  ...['prompt_only', 'safe_tool_catalog', 'tool_disabled'].map((schedule_id) => ({ family: 'request_wire' as const, schedule_id, arms: TWO_ARMS })),
  ...['http_400_terminal', 'http_401_terminal', 'http_403_terminal', 'http_429_terminal', 'http_500_terminal', 'http_529_terminal', 'reset_terminal', 'partial_sse_then_eof', 'complete_sse', 'http_429_then_complete', 'http_500_then_complete', 'reset_before_headers_then_complete', 'delayed_headers_boundary'].map((schedule_id) => ({ family: 'response_failure_recovery' as const, schedule_id, arms: TWO_ARMS })),
].sort((left, right) => utf8Compare(left.schedule_id, right.schedule_id))

function u32(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new Phase3BProductionError('launch_ledger_invalid', 'U32 input is invalid')
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32BE(value)
  return bytes
}

function lp(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8')
  return Buffer.concat([u32(bytes.length), bytes])
}

function hashBuffer(bytes: Uint8Array): Buffer {
  return createHash('sha256').update(bytes).digest()
}

const SEED_VECTOR_DIGEST = hashBuffer(Buffer.concat([lp('p3b-es1-seed-vector-v1'), u32(FIXED_SEEDS.length), ...FIXED_SEEDS.map(u32)]))

function uuidFromRunDigest(digest: Buffer): string {
  const bytes = Buffer.from(digest.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function exactRunId(campaignId: string, scheduleId: string, arm: ExecutableArm, repetition: number, seed: number): string {
  return uuidFromRunDigest(hashBuffer(Buffer.concat([lp('p3b-es1-run-id-v1'), lp(campaignId), lp(scheduleId), lp(arm), u32(repetition), u32(seed)])))
}

function deriveSchedule(campaignId: string, scheduleId: string, arms: readonly ExecutableArm[]): Readonly<{ descriptor: Readonly<Record<string, unknown>>; orders: readonly (readonly ExecutableArm[])[] }> {
  const labels = [...arms].sort(utf8Compare)
  if (![2, 4].includes(labels.length) || new Set(labels).size !== labels.length || labels.some((label) => label.length === 0) || sha256Canonical(labels) !== sha256Canonical(arms)) throw new Phase3BProductionError('launch_ledger_invalid', 'arm labels/count/order are not canonical')
  const encoded = Buffer.concat([lp('p3b-es1-arm-order-v2'), lp(campaignId), lp(scheduleId), u32(labels.length), u32(labels.length), ...labels.map(lp), u32(SEED_VECTOR_DIGEST.length), SEED_VECTOR_DIGEST])
  const digest = hashBuffer(encoded)
  const offset = digest.readUInt32BE(0) % labels.length
  const direction = (digest[4] & 1) === 0 ? 1 : -1
  const positiveMod = (value: number) => ((value % labels.length) + labels.length) % labels.length
  const base = labels.map((_, index) => labels[positiveMod(offset + direction * index)])
  const orders = FIXED_SEEDS.map((_, repetition) => base.map((__, ordinal) => base[(ordinal + repetition) % base.length]))
  const descriptorUnsigned = { algorithm_id: 'fixed-base-plus-cyclic-rotation-v2', encoding_id: 'lp-u32be-v1', campaign_id: campaignId, schedule_id: scheduleId, arm_count: labels.length, seeds: FIXED_SEEDS, seed_vector_digest: SEED_VECTOR_DIGEST.toString('hex'), sorted_labels: labels, base_permutation_digest: digest.toString('hex'), offset, direction, base, orders }
  const descriptor = deepFreeze({ ...descriptorUnsigned, descriptor_sha256: sha256Canonical(descriptorUnsigned) })
  return deepFreeze({ descriptor, orders })
}

function selectedExecutable(arm: ExecutableArm): 'original_image' | 'probe_image' {
  return arm.includes('instrumented') && !arm.includes('uninstrumented') ? 'probe_image' : 'original_image'
}

function requestStimulus(family: LedgerFamily, scheduleId: string): Readonly<{ stimulus_id: string; tool_policy: string; argv_suffix: readonly string[]; stimulus_sha256: string }> {
  let toolPolicy = 'campaign-default'
  let argvSuffix: readonly string[] = []
  if (family === 'request_wire' && scheduleId === 'prompt_only') { toolPolicy = 'no-tools'; argvSuffix = ['--tools', ''] }
  else if (family === 'request_wire' && scheduleId === 'safe_tool_catalog') { toolPolicy = 'safe-readonly-catalog'; argvSuffix = ['--tools', 'Read,Glob,Grep'] }
  else if (family === 'request_wire' && scheduleId === 'tool_disabled') { toolPolicy = 'explicitly-disabled-read'; argvSuffix = ['--tools', 'Read', '--disallowedTools', 'Read'] }
  const unsigned = { stimulus_id: scheduleId, tool_policy: toolPolicy, argv_suffix: argvSuffix }
  return deepFreeze({ ...unsigned, stimulus_sha256: sha256Canonical(unsigned) })
}

function expandRow(campaignId: string, family: LedgerFamily, scheduleId: string, repetition: number, arm: ExecutableArm, sequenceIndex: number): RunLedgerRow {
  const seed = FIXED_SEEDS[repetition]
  const runId = exactRunId(campaignId, scheduleId, arm, repetition, seed)
  const stimulus = requestStimulus(family, scheduleId)
  const argv = ['--bare', '--print', '--output-format', 'json', '--no-session-persistence', '--session-id', runId, '--model', 'claude-sonnet-4-6', '--permission-mode', 'bypassPermissions', ...stimulus.argv_suffix]
  const responseProgram = buildResponseProgram(family === 'target_control' || family === 'config' || family === 'auth' || family === 'request_wire' ? 'complete_sse' : scheduleId)
  const bootstrapContract = bootstrapContractFor(family, scheduleId, arm)
  const unsigned = {
    run_id: runId,
    sequence_index: sequenceIndex,
    family,
    schedule_id: scheduleId,
    seed,
    repetition,
    arm,
    selected_executable_class: selectedExecutable(arm),
    receiver_group_id: deterministicUuidV4({ campaign_id: campaignId, run_id: runId, kind: 'receiver-group' }),
    route_count: (family === 'config' || family === 'auth' ? 2 : 1) as 1 | 2,
    guard_profile_sha256: sha256Canonical({ profile: 'phase3b-darwin-loopback-no-egress-v1', parallel_target_launches: 1, external_socket_budget: 0 }),
    target_launch_cost: 1 as const,
    external_socket_budget: 0 as const,
    bootstrap_contract: bootstrapContract,
    request_target: CLAUDE_MESSAGES_REQUEST_CONTRACT,
    argv,
    argv_sha256: sha256Canonical(argv),
    request_stimulus: stimulus,
    request_stimulus_sha256: stimulus.stimulus_sha256,
    environment_sha256: sha256Canonical({
      fixed_policy: 'closed-isolated-environment-v1',
      unknown_or_omitted: 'disabled',
      ...(family === 'config' ? {
        config_route_plan: configRoutePlanFor(scheduleId, arm as Extract<ExecutableArm, `control/${string}` | `treatment/${string}`>),
        auth_marker_winner_class: 'x-api-key:campaign-config-placeholder',
      } : {}),
    }),
    cwd_ref: '$SEALED_RUNTIME_ROOT' as const,
    cwd_sha256: sha256Canonical('$SEALED_RUNTIME_ROOT'),
    stdin_literal_ref: FIXED_STDIN_LITERAL_REF as typeof FIXED_STDIN_LITERAL_REF,
    stdin_sha256: sha256Bytes(Buffer.from(FIXED_STDIN_LITERAL, 'utf8')),
    literal_table_path: FIXED_LITERAL_TABLE_PATH as typeof FIXED_LITERAL_TABLE_PATH,
    literal_table_sha256: FIXED_LITERAL_TABLE_SHA256,
    response_program: responseProgram,
    response_program_sha256: responseProgram.program_sha256,
    state: 'planned' as const,
  }
  return deepFreeze({ ...unsigned, row_sha256: sha256Canonical(unsigned) })
}

export function buildCampaignLedger(campaignId: string, c1: CrossRepoAuthority): CampaignLedger {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(campaignId)) throw new Phase3BProductionError('launch_ledger_invalid', 'campaign_id is invalid')
  if (c1.verdict !== 'CROSS_REPO_PASS') throw new Phase3BProductionError('cross_repo_authority_invalid', 'cross repo verdict is not PASS')
  assertSha256(c1.review_sha256, 'cross_repo_authority_invalid', 'cross repo review')
  const rows: RunLedgerRow[] = []
  const scheduleDescriptors: Readonly<Record<string, unknown>>[] = []
  for (const definition of [...CONTROL_DEFINITIONS, ...DYNAMIC_DEFINITIONS]) {
    const schedule = deriveSchedule(campaignId, definition.schedule_id, definition.arms)
    scheduleDescriptors.push(schedule.descriptor)
    for (let repetition = 0; repetition < FIXED_SEEDS.length; repetition += 1) {
      const arms = schedule.orders[repetition]
      for (const arm of arms) rows.push(expandRow(campaignId, definition.family, definition.schedule_id, repetition, arm, rows.length))
    }
  }
  const unsigned = {
    schema_id: 'oracle-lab-p3b-production-ledger.v1' as const,
    campaign_id: campaignId,
    authority: REPOSITORY_AUTHORITY,
    c1,
    predecessor: PREDECESSOR_AUTHORITY,
    fixed_seeds: FIXED_SEEDS,
    counts: { mandatory_target_controls: 20 as const, config: 80 as const, auth: 80 as const, request_wire: 30 as const, response_failure_recovery: 130 as const, total_rows: 340 as const },
    target_launch_ceiling: 340 as const,
    parallel_target_launches: 1 as const,
    external_socket_budget: 0 as const,
    request_target: CLAUDE_MESSAGES_REQUEST_CONTRACT,
    schedule_descriptors: scheduleDescriptors,
    rows,
  }
  if (rows.length !== 340 || new Set(rows.map((row) => row.run_id)).size !== 340) throw new Phase3BProductionError('launch_ledger_invalid', 'derived ledger count or run IDs drifted')
  return deepFreeze({ ...unsigned, ledger_sha256: sha256Canonical(unsigned) })
}

export function validateCampaignLedger(value: unknown): CampaignLedger {
  assertExactKeys(value, ['schema_id', 'campaign_id', 'authority', 'c1', 'predecessor', 'fixed_seeds', 'counts', 'target_launch_ceiling', 'parallel_target_launches', 'external_socket_budget', 'request_target', 'schedule_descriptors', 'rows', 'ledger_sha256'], 'launch_ledger_invalid')
  assertSha256(value.ledger_sha256, 'launch_ledger_invalid', 'ledger_sha256')
  assertDigestField(value, 'ledger_sha256', 'launch_ledger_invalid')
  assertExactKeys(value.c1, ['verdict', 'review_sha256'], 'launch_ledger_invalid')
  const expected = buildCampaignLedger(String(value.campaign_id), crossRepoAuthority(String(value.c1.review_sha256)))
  if (sha256Canonical(value) !== sha256Canonical(expected)) throw new Phase3BProductionError('launch_ledger_invalid', 'ledger bytes, order, programs, or authority drifted')
  return expected
}
