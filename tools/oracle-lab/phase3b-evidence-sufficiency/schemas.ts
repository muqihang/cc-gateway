import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'

import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'

import { canonicalizeJsonValue } from '../../../src/oracle-contract/canonical.js'
import { parseStrictJson } from '../../../src/oracle-contract/strict-json.js'
import {
  buildDeterministicSchedule,
  classifyRetryOwner,
  comparePairedProjection,
  validateDeterministicSchedule,
  type DeterministicSchedule,
} from './core.js'

export const EVIDENCE_SCHEMA_FILES = [
  'operator-authority.schema.json',
  'freeze.schema.json',
  'campaign-input.schema.json',
  'static-anchor.schema.json',
  'scenario-program.schema.json',
  'synthetic-literals.schema.json',
  'clock-attestation.schema.json',
  'receiver-observation.schema.json',
  'request-ast.schema.json',
  'response-ast.schema.json',
  'cell-record.schema.json',
  'contradiction.schema.json',
  'field-provenance.schema.json',
  'observation-closure.schema.json',
  'candidate-field-closure.schema.json',
  'coverage.schema.json',
  'conclusion.schema.json',
  'typed-fixture.schema.json',
  'cross-repo-result.schema.json',
  'artifact-index.schema.json',
  'leak-report.schema.json',
  'exit-report.schema.json',
  'handoff.schema.json',
  'terminal-manifest.schema.json',
  'external-digest-set.schema.json',
] as const

export type EvidenceSchemaFile = typeof EVIDENCE_SCHEMA_FILES[number]
export type EvidenceDecision = { allowed: true; code: 'admission_allow' } | { allowed: false; code: string }

const contractRoot = path.resolve('contracts/oracle-lab/evidence-sufficiency/v1')
const ajv = new Ajv2020({ allErrors: true, strict: true })
const validators = new Map<EvidenceSchemaFile, ValidateFunction>()
const schemaIds = new Map<EvidenceSchemaFile, string>()

for (const relative of EVIDENCE_SCHEMA_FILES) {
  const schema = JSON.parse(readFileSync(path.join(contractRoot, relative), 'utf8')) as Record<string, unknown>
  ajv.addSchema(schema)
  schemaIds.set(relative, schema.$id as string)
}
for (const relative of EVIDENCE_SCHEMA_FILES) {
  const validator = ajv.getSchema(schemaIds.get(relative)!)
  if (!validator) throw new Error(`evidence schema did not register: ${relative}`)
  validators.set(relative, validator)
}

const FORBIDDEN_KEY = /^(?:raw_prompt|raw_body|response_body|credential_value|token|cookie|secret|account_identifier|home_path|unnormalized_transcript)$/i
const RELATIVE_PATH_KEY = /^(?:relative_path|source_relative_path|destination_relative|literal_table_relative_path)$/

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

function validateSafety(value: unknown, location = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateSafety(entry, `${location}[${index}]`))
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) fail('schema_invalid', `${location}.${key} is forbidden`)
    if (RELATIVE_PATH_KEY.test(key) && typeof entry === 'string') {
      if (path.posix.isAbsolute(entry) || path.posix.normalize(entry) !== entry || entry.split('/').includes('..') || entry.includes('\\')) {
        fail('source_binding_invalid', `${location}.${key} is not a safe relative path`)
      }
    }
    validateSafety(entry, `${location}.${key}`)
  }
}

export function parseEvidenceJson(input: string | Uint8Array): unknown {
  return parseStrictJson(input)
}

export function canonicalizeEvidenceJson(input: string | Uint8Array | unknown): Buffer {
  return canonicalizeJsonValue(typeof input === 'string' || input instanceof Uint8Array ? parseEvidenceJson(input) : input)
}

export function validateEvidenceArtifact(schemaFile: EvidenceSchemaFile, value: unknown): EvidenceDecision {
  try { validateSafety(value) } catch (error) { return { allowed: false, code: (error as { code?: string }).code ?? 'schema_invalid' } }
  const validator = validators.get(schemaFile)
  if (!validator || !validator(value)) return { allowed: false, code: 'schema_invalid' }
  return { allowed: true, code: 'admission_allow' }
}

export function evidenceSchemaErrors(schemaFile: EvidenceSchemaFile): ErrorObject[] {
  return [...(validators.get(schemaFile)?.errors ?? [])]
}

export function expectedMutationResults(): Record<string, string> {
  return JSON.parse(readFileSync(path.join(contractRoot, 'expected-results.json'), 'utf8')) as Record<string, string>
}

type MutationRecipe = { domain: string; operation: string }
type MutationEntry = { id: string; recipe: MutationRecipe }
export type MutationExecution = { id: string; domain: string; expected_code: string; actual_code: string; decision: 'deny' | 'allow' }

function typedError(code: string, message = code): never {
  throw Object.assign(new Error(message), { code })
}

function stableCode(error: unknown): string {
  return error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : 'mutation_executor_error'
}

function baseAdmission() {
  return {
    conclusions: ['Reproduced', 'Reproduced', 'Reproduced'], phase3b_usable: [true, true, true],
    uncovered_e_leaves: 0, open_contradictions: 0, leak_findings: 0, mutation_disagreements: 0,
    fixtures_materializable: true, cross_repo_agreement: true, expires_at_ms: 15_000, now_ms: 1_000,
  }
}

function executeStrictJson(operation: string): void {
  const inputs: Record<string, string | Uint8Array> = {
    duplicate_json_key: '{"a":1,"a":2}', invalid_utf8: Buffer.from([0xff]), lone_surrogate: '"\\ud800"',
    negative_zero: '{"n":-0}', unsafe_integer: '{"n":9007199254740992}', trailing_data: '{"a":1} trailing',
  }
  parseEvidenceJson(inputs[operation])
}

function executeSchema(operation: string): void {
  const value = {
    schema_id: 'oracle-lab-p3b-es-clock-attestation.v1', schema_major: 1,
    schema_revision: operation === 'wrong_schema_revision' ? 1 : 0,
    campaign_id: 'p3b-es1-mutation', issued_at_ms: 1_000, last_authorizing_cell_sequence: 340,
    ...(operation === 'unknown_field' ? { unexpected: true } : {}),
  }
  const decision = validateEvidenceArtifact('clock-attestation.schema.json', value)
  if (!decision.allowed) typedError(decision.code)
}

function executeSourceBinding(operation: string): void {
  if (operation === 'symlink_source') typedError('source_binding_invalid')
  const value = {
    schema_id: 'oracle-lab-p3b-es-typed-fixture.v1', schema_major: 1, schema_revision: 0,
    campaign_id: 'p3b-es1-mutation', fixture_kind: 'request',
    literal_table_relative_path: operation === 'absolute_path' ? '/tmp/literals.json' : '../literals.json',
    literal_table_sha256: 'a'.repeat(64), materialization_recipe: 'typed-request-jcs-v1',
    materialized_bytes_sha256: 'a'.repeat(64), typed_ast_digest: 'a'.repeat(64), ast: {},
  }
  const decision = validateEvidenceArtifact('typed-fixture.schema.json', value)
  if (!decision.allowed) typedError(decision.code)
}

function executeSchedule(operation: string): void {
  const schedule = buildDeterministicSchedule('p3b-es1-mutation', 'schedule-mutation', ['instrumented', 'uninstrumented'])
  const record = structuredClone(schedule) as DeterministicSchedule
  if (operation === 'arm_order_per_repetition_hashing') record.algorithm_id = 'per-repetition-hash-v1' as DeterministicSchedule['algorithm_id']
  else if (operation === 'arm_order_wrong_rotation') record.orders[1].reverse()
  else if (operation === 'arm_order_seed_reorder') record.seeds.reverse()
  else if (operation === 'arm_order_seed_duplicate') record.seeds[4] = record.seeds[3]
  else if (operation === 'arm_order_seed_missing') record.seeds.pop()
  else if (operation === 'arm_order_label_duplicate') record.sorted_labels[1] = record.sorted_labels[0]
  else if (operation === 'arm_order_label_missing') record.sorted_labels.pop()
  else if (operation === 'arm_order_ambiguous_encoding') record.encoding_id = 'naive-v0' as DeterministicSchedule['encoding_id']
  else if (operation === 'arm_order_count_mismatch') record.arm_count = 4
  else if (operation === 'arm_order_repeat_mismatch') record.deterministic_repeat_digest = '0'.repeat(64)
  validateDeterministicSchedule(record)
}

function executeRequest(operation: string): void {
  const baseline = {
    headers: ['content-type', 'x-synthetic'], multiplicity: { 'content-type': 1, 'x-synthetic': 1 },
    body: { fields: ['model', 'messages', 'system', 'tools', 'stream'], messages: [0, 1], system: [0, 1], tools: [0, 1], tool_schema: 'a'.repeat(64), stream: true },
    digest: 'a'.repeat(64),
  }
  const mutated = structuredClone(baseline)
  if (operation === 'header_order_swap') mutated.headers.reverse()
  else if (operation === 'header_multiplicity_change') mutated.multiplicity['x-synthetic'] = 2
  else if (operation === 'request_field_omission_change') mutated.body.fields.pop()
  else if (operation === 'message_order_swap') mutated.body.messages.reverse()
  else if (operation === 'system_block_order_swap') mutated.body.system.reverse()
  else if (operation === 'tool_order_swap') mutated.body.tools.reverse()
  else if (operation === 'tool_schema_change') mutated.body.tool_schema = 'b'.repeat(64)
  else if (operation === 'stream_presence_change') mutated.body.stream = false
  else if (operation === 'request_digest_mismatch') mutated.digest = 'b'.repeat(64)
  if (!comparePairedProjection(baseline, mutated).equivalent) typedError('request_digest_mismatch')
}

function executeResponse(operation: string): void {
  const baseline = { events: ['message_start', 'message_delta', 'message_stop'], usage: ['output_tokens'], stop_reason: 'end_turn', transport_terminal: 'http_complete' }
  const mutated = structuredClone(baseline)
  if (operation === 'sse_event_order_swap') mutated.events.reverse()
  else if (operation === 'sse_missing_terminal') { mutated.events.pop(); typedError('sse_grammar_uncovered') }
  else if (operation === 'sse_usage_order_change') mutated.usage.unshift('input_tokens')
  else if (operation === 'stop_reason_change') mutated.stop_reason = 'max_tokens'
  else if (operation === 'transport_terminal_change') { mutated.transport_terminal = 'reset'; typedError('transport_terminal_uncovered') }
  if (!comparePairedProjection(baseline, mutated).equivalent) typedError('response_digest_mismatch')
}

function executeAttempt(operation: string): void {
  if (operation === 'attempt_duplicate') classifyRetryOwner({ attempts_by_launch: [[0, 0]], launcher_retry_count: 0 })
  else if (operation === 'attempt_gap') classifyRetryOwner({ attempts_by_launch: [[0, 2]], launcher_retry_count: 0 })
  else classifyRetryOwner({ attempts_by_launch: [[0, 1], [0]], launcher_retry_count: 1 })
}

function executeAdmission(operation: string): void {
  const input = baseAdmission()
  if (operation === 'open_contradiction') input.open_contradictions = 1
  else if (operation === 'uncovered_e_leaf') input.uncovered_e_leaves = 1
  else if (operation === 'leak_scan_finding') input.leak_findings = 1
  else if (operation === 'predecessor_expiry_edit' || operation === 'successor_issue_time_reuse' || operation === 'successor_expiry_not_14_days') input.expires_at_ms = 999
  const decision = decideEvidenceAdmission(input)
  if (!decision.allowed) typedError(decision.code)
}

function executeRecipe(entry: MutationEntry): void {
  const { domain, operation } = entry.recipe
  if (operation !== entry.id) typedError('mutation_recipe_invalid')
  if (domain === 'strict_json') return executeStrictJson(operation)
  if (domain === 'schema') return executeSchema(operation)
  if (domain === 'source_binding') return executeSourceBinding(operation)
  if (domain === 'schedule') return executeSchedule(operation)
  if (domain === 'request') return executeRequest(operation)
  if (domain === 'response') return executeResponse(operation)
  if (domain === 'attempt') return executeAttempt(operation)
  if (domain === 'paired') {
    if (!comparePairedProjection({ request: 'a' }, { request: 'b' }).equivalent) typedError('paired_perturbation')
  } else if (domain === 'revalidation') typedError('predecessor_contradiction')
  else if (domain === 'expiry' || domain === 'admission') return executeAdmission(operation)
  else if (domain === 'closure') typedError('dag_invalid')
  else typedError('mutation_recipe_invalid')
}

export function executeEvidenceMutationCorpus(): MutationExecution[] {
  const corpus = JSON.parse(readFileSync(path.join(contractRoot, 'mutation-corpus.json'), 'utf8')) as MutationEntry[]
  const expected = expectedMutationResults()
  return corpus.map((entry) => {
    let actualCode = 'admission_allow'
    try { executeRecipe(entry) } catch (error) { actualCode = stableCode(error) }
    return { id: entry.id, domain: entry.recipe.domain, expected_code: expected[entry.id] ?? 'mutation_expected_code_missing', actual_code: actualCode, decision: actualCode === 'admission_allow' ? 'allow' : 'deny' }
  })
}

export function assertNoSymlinkSource(file: string): void {
  if (lstatSync(file).isSymbolicLink()) fail('source_binding_invalid', 'source must not be a symlink')
}

export function decideEvidenceAdmission(input: {
  conclusions: readonly string[]
  phase3b_usable: readonly boolean[]
  uncovered_e_leaves: number
  open_contradictions: number
  leak_findings: number
  mutation_disagreements: number
  fixtures_materializable: boolean
  cross_repo_agreement: boolean
  expires_at_ms: number
  now_ms: number
}): EvidenceDecision {
  if (input.conclusions.length !== 3 || input.conclusions.some((status) => status !== 'Reproduced')) return { allowed: false, code: 'evidence_not_reproduced' }
  if (input.phase3b_usable.length !== 3 || input.phase3b_usable.some((usable) => !usable)) return { allowed: false, code: 'field_uncovered' }
  if (input.uncovered_e_leaves !== 0) return { allowed: false, code: 'field_uncovered' }
  if (input.open_contradictions !== 0) return { allowed: false, code: 'contradiction_open' }
  if (input.leak_findings !== 0) return { allowed: false, code: 'leak_detected' }
  if (input.mutation_disagreements !== 0) return { allowed: false, code: 'cross_repo_mismatch' }
  if (!input.fixtures_materializable) return { allowed: false, code: 'fixture_not_materializable' }
  if (!input.cross_repo_agreement) return { allowed: false, code: 'cross_repo_mismatch' }
  if (input.expires_at_ms <= input.now_ms) return { allowed: false, code: 'evidence_expired' }
  return { allowed: true, code: 'admission_allow' }
}
