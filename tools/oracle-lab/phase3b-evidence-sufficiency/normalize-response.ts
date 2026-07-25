import { parseStrictJson } from '../../../src/oracle-contract/strict-json.js'
import { EvidenceSufficiencyError, canonicalEvidenceBytes, sha256Bytes } from './core.js'
import type { SyntheticLiteralTable } from './normalize-request.js'

export const FAILURE_PROGRAM_IDS = [
  'http_400_terminal',
  'http_401_terminal',
  'http_403_terminal',
  'http_429_terminal',
  'http_500_terminal',
  'http_529_terminal',
  'reset_terminal',
  'partial_sse_then_eof',
  'complete_sse',
  'http_429_then_complete',
  'http_500_then_complete',
  'reset_before_headers_then_complete',
  'delayed_headers_boundary',
] as const

export type FailureProgramId = typeof FAILURE_PROGRAM_IDS[number]

export type ScenarioAction = {
  action_ordinal: number
  kind: 'http' | 'reset_terminal' | 'reset_before_headers' | 'partial_sse_then_eof' | 'delayed_http'
  status: number | null
  ordered_headers: Array<{ name: string; value_class: string }>
  body_kind: 'json_error' | 'complete_sse' | 'partial_sse' | 'none'
  delay_class: 'none' | 'boundary'
  delay_ms: number
  transport_terminal: 'http_complete' | 'eof_after_partial' | 'reset' | 'reset_before_headers'
}

export type ScenarioProgram = {
  scenario_id: FailureProgramId
  actions: ScenarioAction[]
}

export type ScenarioPrograms = {
  schema_id: 'oracle-lab-p3b-es-scenario-program.v1'
  schema_major: 1
  schema_revision: 0
  campaign_id: string
  request_stimuli: ['prompt_only', 'safe_tool_catalog', 'tool_disabled']
  failure_programs: ScenarioProgram[]
}

export type NormalizedScenarioResponse = {
  schema_id: 'oracle-lab-p3b-es-response-ast.v1'
  status: number | null
  header_classes: string[]
  sse_wire_grammar: {
    line_ending_class: 'lf' | 'crlf' | 'mixed' | 'none'
    event_line_presence: boolean
    data_line_count: number
    blank_line_framing: boolean
    utf8_class: 'valid'
  }
  event_sequence: Array<{
    ordinal: number
    event: string
    data_type: string
    data_sha256: string
    literal_refs: string[]
    content_block_index: number | null
    delta_type: string
    stop_reason: string
    usage_field_order: string[]
  }>
  terminal_event: string
  stop_reason: string
  stop_sequence_class: string
  usage_presence: boolean
  usage_field_order: string[]
  materialized_response_sha256: string
  raw_material_persisted: false
}

function fail(code: string, message: string): never {
  throw new EvidenceSufficiencyError(code, message)
}

function requireLiteral(table: SyntheticLiteralTable, id: string): string {
  const value = table[id]
  if (typeof value !== 'string') fail('response_literal_unmaterializable', `required response literal ${id} is missing`)
  return value
}

function action(actionOrdinal: number, kind: ScenarioAction['kind'], status: number | null, bodyKind: ScenarioAction['body_kind']): ScenarioAction {
  const complete = bodyKind === 'complete_sse' || bodyKind === 'partial_sse'
  return {
    action_ordinal: actionOrdinal,
    kind,
    status,
    ordered_headers: status === null ? [] : [{ name: 'content-type', value_class: complete ? 'text-event-stream' : 'application-json' }],
    body_kind: bodyKind,
    delay_class: kind === 'delayed_http' ? 'boundary' : 'none',
    delay_ms: kind === 'delayed_http' ? 250 : 0,
    transport_terminal: kind === 'reset_before_headers' ? 'reset_before_headers'
      : kind === 'reset_terminal' ? 'reset'
        : kind === 'partial_sse_then_eof' ? 'eof_after_partial'
          : 'http_complete',
  }
}

function httpStatus(id: FailureProgramId): number {
  const match = /^http_(\d+)_/.exec(id)
  if (!match) fail('schema_invalid', `scenario ${id} has no status`)
  return Number(match[1])
}

export function buildScenarioPrograms(campaignId: string, literals: SyntheticLiteralTable): ScenarioPrograms {
  requireLiteral(literals, 'model.test')
  requireLiteral(literals, 'output.complete')
  requireLiteral(literals, 'error.synthetic')
  const programs: ScenarioProgram[] = FAILURE_PROGRAM_IDS.map((scenarioId) => {
    if (/^http_(?:400|401|403|429|500|529)_terminal$/.test(scenarioId)) {
      return { scenario_id: scenarioId, actions: [action(0, 'http', httpStatus(scenarioId), 'json_error')] }
    }
    if (scenarioId === 'reset_terminal') return { scenario_id: scenarioId, actions: [action(0, 'reset_terminal', null, 'none')] }
    if (scenarioId === 'partial_sse_then_eof') return { scenario_id: scenarioId, actions: [action(0, 'partial_sse_then_eof', 200, 'partial_sse')] }
    if (scenarioId === 'complete_sse') return { scenario_id: scenarioId, actions: [action(0, 'http', 200, 'complete_sse')] }
    if (scenarioId === 'http_429_then_complete') return { scenario_id: scenarioId, actions: [action(0, 'http', 429, 'json_error'), action(1, 'http', 200, 'complete_sse')] }
    if (scenarioId === 'http_500_then_complete') return { scenario_id: scenarioId, actions: [action(0, 'http', 500, 'json_error'), action(1, 'http', 200, 'complete_sse')] }
    if (scenarioId === 'reset_before_headers_then_complete') return { scenario_id: scenarioId, actions: [action(0, 'reset_before_headers', null, 'none'), action(1, 'http', 200, 'complete_sse')] }
    return { scenario_id: scenarioId, actions: [action(0, 'delayed_http', 200, 'complete_sse')] }
  })
  return {
    schema_id: 'oracle-lab-p3b-es-scenario-program.v1',
    schema_major: 1,
    schema_revision: 0,
    campaign_id: campaignId,
    request_stimuli: ['prompt_only', 'safe_tool_catalog', 'tool_disabled'],
    failure_programs: programs,
  }
}

function completeEvents(literals: SyntheticLiteralTable): Array<{ event: string; data: unknown }> {
  return [
    {
      event: 'message_start',
      data: {
        type: 'message_start',
        message: {
          id: 'msg_synthetic_0001', type: 'message', role: 'assistant', content: [], model: requireLiteral(literals, 'model.test'),
          stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
    },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: requireLiteral(literals, 'output.complete') } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]
}

function encodeSse(events: Array<{ event: string; data: unknown }>): Buffer {
  return Buffer.from(events.map(({ event, data }) => `event: ${event}\ndata: ${canonicalEvidenceBytes(data).toString('utf8')}\n\n`).join(''), 'utf8')
}

export function materializeScenarioResponse(actionInput: ScenarioAction, literals: SyntheticLiteralTable): { bytes: Buffer; sha256: string } {
  let bytes: Buffer
  if (actionInput.body_kind === 'none') bytes = Buffer.alloc(0)
  else if (actionInput.body_kind === 'json_error') {
    bytes = canonicalEvidenceBytes({ type: 'error', error: { type: 'synthetic_error', message: requireLiteral(literals, 'error.synthetic') } })
  } else {
    const events = completeEvents(literals)
    bytes = encodeSse(actionInput.body_kind === 'partial_sse' ? events.slice(0, 3) : events)
  }
  return { bytes, sha256: sha256Bytes(bytes) }
}

function lineEndingClass(text: string): 'lf' | 'crlf' | 'mixed' | 'none' {
  const hasCrLf = text.includes('\r\n')
  const withoutCrLf = text.replaceAll('\r\n', '')
  const hasLf = withoutCrLf.includes('\n')
  if (hasCrLf && hasLf) return 'mixed'
  if (hasCrLf) return 'crlf'
  if (hasLf) return 'lf'
  return 'none'
}

function collectLiteralRefs(value: unknown, table: SyntheticLiteralTable): string[] {
  const byValue = new Map(Object.entries(table).map(([id, literal]) => [literal, id]))
  const refs = new Set<string>()
  const visit = (current: unknown): void => {
    if (typeof current === 'string') {
      const id = byValue.get(current)
      if (id) refs.add(id)
    } else if (Array.isArray(current)) current.forEach(visit)
    else if (current && typeof current === 'object') Object.values(current as Record<string, unknown>).forEach(visit)
  }
  visit(value)
  return [...refs].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function normalizeScenarioResponse(bytesInput: Uint8Array, actionInput: ScenarioAction, literals: SyntheticLiteralTable): NormalizedScenarioResponse {
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytesInput) } catch { fail('sse_grammar_uncovered', 'response is not valid UTF-8') }
  const eventSequence: NormalizedScenarioResponse['event_sequence'] = []
  const lineEnding = lineEndingClass(text)
  const blankLineFraming = /(?:\r?\n){2}/.test(text)
  let dataLineCount = 0
  if (actionInput.body_kind === 'complete_sse' && !/(?:^|\r?\n)event: message_stop(?:\r?\n)/.test(text)) {
    fail('sse_grammar_uncovered', 'complete SSE response is missing message_stop')
  }
  const expected = materializeScenarioResponse(actionInput, literals)
  const observedDigest = sha256Bytes(bytesInput)
  if (observedDigest !== expected.sha256) fail('response_digest_mismatch', 'observed response differs from controlled response bytes')
  if (actionInput.body_kind === 'complete_sse' || actionInput.body_kind === 'partial_sse') {
    const frames = text.split(/\r?\n\r?\n/).filter((frame) => frame.length > 0)
    for (const [ordinal, frame] of frames.entries()) {
      let event = ''
      const dataLines: string[] = []
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('event: ')) event = line.slice(7)
        else if (line.startsWith('data: ')) { dataLines.push(line.slice(6)); dataLineCount += 1 }
      }
      if (!event || dataLines.length !== 1) fail('sse_grammar_uncovered', 'SSE frame lacks one event and one data line')
      const data = parseStrictJson(dataLines[0])
      const record = object(data)
      const delta = object(record.delta)
      const usage = object(record.usage)
      const stopReason = typeof delta.stop_reason === 'string' ? delta.stop_reason : 'absent'
      eventSequence.push({
        ordinal,
        event,
        data_type: typeof record.type === 'string' ? record.type : 'unknown',
        data_sha256: sha256Bytes(canonicalEvidenceBytes(data)),
        literal_refs: collectLiteralRefs(data, literals),
        content_block_index: Number.isSafeInteger(record.index) ? record.index as number : null,
        delta_type: typeof delta.type === 'string' ? delta.type : 'absent',
        stop_reason: stopReason,
        usage_field_order: Object.keys(usage),
      })
    }
  }
  const terminal = eventSequence.at(-1)?.event ?? 'none'
  if (actionInput.body_kind === 'complete_sse' && terminal !== 'message_stop') fail('sse_grammar_uncovered', 'complete SSE response is missing message_stop')
  const messageDelta = eventSequence.find((entry) => entry.event === 'message_delta')
  const raw = Buffer.from(bytesInput)
  raw.fill(0)
  return {
    schema_id: 'oracle-lab-p3b-es-response-ast.v1',
    status: actionInput.status,
    header_classes: actionInput.ordered_headers.map((header) => `${header.name}:${header.value_class}`),
    sse_wire_grammar: {
      line_ending_class: lineEnding,
      event_line_presence: eventSequence.length > 0,
      data_line_count: dataLineCount,
      blank_line_framing: blankLineFraming,
      utf8_class: 'valid',
    },
    event_sequence: eventSequence,
    terminal_event: terminal,
    stop_reason: messageDelta?.stop_reason ?? 'absent',
    stop_sequence_class: messageDelta ? 'null' : 'absent',
    usage_presence: Boolean(messageDelta && messageDelta.usage_field_order.length > 0),
    usage_field_order: messageDelta?.usage_field_order ?? [],
    materialized_response_sha256: expected.sha256,
    raw_material_persisted: false,
  }
}
