import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FAILURE_PROGRAM_IDS,
  buildScenarioPrograms,
  materializeScenarioResponse,
  normalizeScenarioResponse,
} from '../tools/oracle-lab/phase3b-evidence-sufficiency/normalize-response.js'
import { validateEvidenceArtifact } from '../tools/oracle-lab/phase3b-evidence-sufficiency/schemas.js'

const literals = {
  'model.test': 'claude-synthetic-1',
  'output.complete': 'SYNTHETIC OUTPUT COMPLETE',
  'error.synthetic': 'SYNTHETIC ERROR',
}

test('scenario program set is exact and attempt indexed', () => {
  const programs = buildScenarioPrograms('p3b-es1-test', literals)
  assert.deepEqual(programs.failure_programs.map((program) => program.scenario_id), FAILURE_PROGRAM_IDS)
  assert.equal(programs.failure_programs.find((program) => program.scenario_id === 'http_429_then_complete')?.actions.length, 2)
  assert.equal(programs.failure_programs.find((program) => program.scenario_id === 'reset_before_headers_then_complete')?.actions[0]?.kind, 'reset_before_headers')
})

test('complete SSE response round-trips exact bytes and typed grammar', () => {
  const program = buildScenarioPrograms('p3b-es1-test', literals).failure_programs
    .find((candidate) => candidate.scenario_id === 'complete_sse')!
  const materialized = materializeScenarioResponse(program.actions[0], literals)
  const normalized = normalizeScenarioResponse(materialized.bytes, program.actions[0], literals)
  assert.equal(normalized.materialized_response_sha256, materialized.sha256)
  assert.equal(normalized.sse_wire_grammar.line_ending_class, 'lf')
  assert.equal(normalized.sse_wire_grammar.blank_line_framing, true)
  assert.equal(normalized.event_sequence.at(-1)?.event, 'message_stop')
  assert.equal(normalized.terminal_event, 'message_stop')
  assert.equal(normalized.raw_material_persisted, false)
  assert.doesNotMatch(JSON.stringify(normalized), /SYNTHETIC OUTPUT COMPLETE/)
  assert.deepEqual(validateEvidenceArtifact('response-ast.schema.json', normalized), { allowed: true, code: 'admission_allow' })
  assert.deepEqual(validateEvidenceArtifact('response-ast.schema.json', {
    ...normalized,
    sse_wire_grammar: { ...normalized.sse_wire_grammar, unknown: true },
  }), { allowed: false, code: 'schema_invalid' })
})

test('missing SSE terminal and response mismatch deny', () => {
  const program = buildScenarioPrograms('p3b-es1-test', literals).failure_programs
    .find((candidate) => candidate.scenario_id === 'complete_sse')!
  const materialized = materializeScenarioResponse(program.actions[0], literals)
  const missingTerminal = materialized.bytes.subarray(0, materialized.bytes.lastIndexOf('event: message_stop'))
  assert.throws(() => normalizeScenarioResponse(missingTerminal, program.actions[0], literals),
    (error: unknown) => (error as { code?: string }).code === 'sse_grammar_uncovered')
  const changed = Buffer.from(materialized.bytes)
  changed[changed.length - 2] ^= 1
  assert.throws(() => normalizeScenarioResponse(changed, program.actions[0], literals),
    (error: unknown) => (error as { code?: string }).code === 'response_digest_mismatch')
})
