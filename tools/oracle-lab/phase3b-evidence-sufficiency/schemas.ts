import { createHash } from 'node:crypto'
import { lstatSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'

import { canonicalizeJsonValue } from '../../../src/oracle-contract/canonical.js'
import { parseStrictJson } from '../../../src/oracle-contract/strict-json.js'
import {
  buildDeterministicSchedule,
  classifyRetryOwner,
  comparePairedObservations,
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

type MutationAction = {
  kind: string
  fixture?: string
  pointer?: string
  value?: unknown
  index?: number
  other_index?: number
}
export type MutationRecipe = { subject: string; schema: string; action: MutationAction }
export type MutationEntry = { id: string; recipe: MutationRecipe }
export type MutationObservation = { id: string; subject: string; schema: string; actual_code: string; decision: 'deny' | 'allow' }
export type MutationExecution = MutationObservation & { expected_code: string; agrees: boolean }

const MUTATION_CONTRACTS = new Map<string, readonly [string, string, string]>([
  ...['duplicate_json_key', 'invalid_utf8', 'lone_surrogate', 'negative_zero', 'unsafe_integer', 'trailing_data'].map((id) => [id, ['strict_json_bytes', 'strict-json.v1', 'replace_bytes']] as const),
  ['unknown_field', ['clock_attestation', 'clock-attestation.schema.json', 'set_pointer']],
  ['wrong_schema_revision', ['clock_attestation', 'clock-attestation.schema.json', 'set_pointer']],
  ['absolute_path', ['typed_fixture_path', 'typed-fixture.schema.json', 'set_pointer']],
  ['path_traversal', ['typed_fixture_path', 'typed-fixture.schema.json', 'set_pointer']],
  ['symlink_source', ['source_file', 'source-binding.v1', 'replace_with_symlink']],
  ...['header_order_swap', 'message_order_swap', 'system_block_order_swap', 'tool_order_swap'].map((id) => [id, ['request_projection', 'request-projection.v1', 'swap_array_items']] as const),
  ...['header_multiplicity_change', 'tool_schema_change', 'stream_presence_change', 'request_digest_mismatch'].map((id) => [id, ['request_projection', 'request-projection.v1', 'set_pointer']] as const),
  ['request_field_omission_change', ['request_projection', 'request-projection.v1', 'remove_array_item']],
  ['auth_winner_class_change', ['predecessor_projection', 'predecessor-projection.v1', 'set_pointer']],
  ['sse_event_order_swap', ['response_projection', 'response-projection.v1', 'swap_array_items']],
  ['sse_missing_terminal', ['response_projection', 'response-projection.v1', 'remove_array_item']],
  ...['sse_usage_order_change'].map((id) => [id, ['response_projection', 'response-projection.v1', 'insert_array_item']] as const),
  ...['stop_reason_change', 'transport_terminal_change'].map((id) => [id, ['response_projection', 'response-projection.v1', 'set_pointer']] as const),
  ['attempt_duplicate', ['retry_attempts', 'retry-attempts.v1', 'duplicate_array_item']],
  ['attempt_gap', ['retry_attempts', 'retry-attempts.v1', 'set_pointer']],
  ['retry_owner_change', ['retry_attempts', 'retry-attempts.v1', 'insert_array_item']],
  ['paired_instrumentation_difference', ['paired_observation', 'receiver-observation.schema.json', 'set_pointer']],
  ['arm_order_per_repetition_hashing', ['deterministic_schedule', 'deterministic-schedule.v2', 'set_pointer']],
  ['arm_order_wrong_rotation', ['deterministic_schedule', 'deterministic-schedule.v2', 'swap_array_items']],
  ['arm_order_seed_reorder', ['deterministic_schedule', 'deterministic-schedule.v2', 'swap_array_items']],
  ['arm_order_seed_duplicate', ['deterministic_schedule', 'deterministic-schedule.v2', 'set_pointer']],
  ['arm_order_seed_missing', ['deterministic_schedule', 'deterministic-schedule.v2', 'remove_array_item']],
  ['arm_order_label_duplicate', ['deterministic_schedule', 'deterministic-schedule.v2', 'set_pointer']],
  ['arm_order_label_missing', ['deterministic_schedule', 'deterministic-schedule.v2', 'remove_array_item']],
  ['arm_order_ambiguous_encoding', ['deterministic_schedule', 'deterministic-schedule.v2', 'set_pointer']],
  ['arm_order_count_mismatch', ['deterministic_schedule', 'deterministic-schedule.v2', 'set_pointer']],
  ['arm_order_repeat_mismatch', ['deterministic_schedule', 'deterministic-schedule.v2', 'set_pointer']],
  ['predecessor_expiry_edit', ['predecessor_binding', 'predecessor-binding.v1', 'set_pointer']],
  ['successor_issue_time_reuse', ['successor_freshness', 'successor-freshness.v1', 'set_pointer']],
  ['successor_expiry_not_14_days', ['successor_freshness', 'successor-freshness.v1', 'set_pointer']],
  ...['open_contradiction', 'uncovered_e_leaf', 'leak_scan_finding'].map((id) => [id, ['evidence_admission', 'evidence-admission.v1', 'set_pointer']] as const),
  ['artifact_index_omission', ['artifact_index', 'artifact-index.schema.json', 'remove_array_item']],
  ['external_digest_set_mismatch', ['external_digest_set', 'external-digest-set.schema.json', 'set_pointer']],
])
const MUTATION_RECIPE_SET_SHA256 = '0ddfb5d5f5b1677861523e3660570ea04db5629d779111209775a4e3b0a53b03'

function typedError(code: string, message = code): never { throw Object.assign(new Error(message), { code }) }
function stableCode(error: unknown): string {
  return error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'mutation_executor_error'
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).sort().join('\0') === [...allowed].sort().join('\0')
}

export function loadEvidenceMutationCorpus(): MutationEntry[] {
  return parseEvidenceJson(readFileSync(path.join(contractRoot, 'mutation-corpus.json'))) as MutationEntry[]
}

export function validateMutationRecipes(entries: readonly MutationEntry[]): void {
  if (!Array.isArray(entries) || entries.length !== MUTATION_CONTRACTS.size || new Set(entries.map((entry) => entry.id)).size !== entries.length) typedError('mutation_recipe_invalid')
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !exactKeys(entry as unknown as Record<string, unknown>, ['id', 'recipe'])) typedError('mutation_recipe_invalid')
    const contract = MUTATION_CONTRACTS.get(entry.id)
    const recipe = entry.recipe
    if (!contract || !recipe || typeof recipe !== 'object' || !exactKeys(recipe as unknown as Record<string, unknown>, ['subject', 'schema', 'action'])) typedError('mutation_recipe_invalid')
    if (recipe.subject !== contract[0] || recipe.schema !== contract[1] || !recipe.action || typeof recipe.action !== 'object') typedError('mutation_recipe_invalid')
    const actionKeys = Object.keys(recipe.action)
    if (actionKeys.some((key) => !['kind', 'fixture', 'pointer', 'value', 'index', 'other_index'].includes(key)) || actionKeys.includes('expected_code') || recipe.action.kind !== contract[2]) typedError('mutation_recipe_invalid')
    if (JSON.stringify(recipe).includes('expected_code')) typedError('mutation_recipe_invalid')
    if (recipe.action.pointer !== undefined && !/^\/(?:[A-Za-z0-9._~-]+)(?:\/[A-Za-z0-9._~-]+)*$/.test(recipe.action.pointer)) typedError('mutation_recipe_invalid')
  }
  if ([...MUTATION_CONTRACTS.keys()].some((id) => !entries.some((entry) => entry.id === id))) typedError('mutation_recipe_invalid')
  if (createHash('sha256').update(canonicalizeEvidenceJson(entries)).digest('hex') !== MUTATION_RECIPE_SET_SHA256) typedError('mutation_recipe_invalid')
}

function pointerParent(value: unknown, pointer: string): { parent: Record<string, unknown> | unknown[]; key: string } {
  const segments = pointer.slice(1).split('/').map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
  let current = value as Record<string, unknown> | unknown[]
  for (const segment of segments.slice(0, -1)) {
    const next = Array.isArray(current) ? current[Number(segment)] : current[segment]
    if (!next || typeof next !== 'object') typedError('mutation_recipe_invalid')
    current = next as Record<string, unknown> | unknown[]
  }
  return { parent: current, key: segments.at(-1)! }
}

function applyAction<T>(base: T, action: MutationAction): T {
  const output = structuredClone(base)
  if (!action.pointer) typedError('mutation_recipe_invalid')
  const { parent, key } = pointerParent(output, action.pointer)
  const target = Array.isArray(parent) ? parent[Number(key)] : parent[key]
  if (action.kind === 'set_pointer') {
    if (Array.isArray(parent)) parent[Number(key)] = structuredClone(action.value)
    else parent[key] = structuredClone(action.value)
  } else if (action.kind === 'swap_array_items') {
    if (!Array.isArray(target) || !Number.isInteger(action.index) || !Number.isInteger(action.other_index)) typedError('mutation_recipe_invalid')
    ;[target[action.index!], target[action.other_index!]] = [target[action.other_index!], target[action.index!]]
  } else if (action.kind === 'remove_array_item') {
    if (!Array.isArray(target) || !Number.isInteger(action.index)) typedError('mutation_recipe_invalid')
    target.splice(action.index!, 1)
  } else if (action.kind === 'insert_array_item') {
    if (!Array.isArray(target) || !Number.isInteger(action.index)) typedError('mutation_recipe_invalid')
    target.splice(action.index!, 0, structuredClone(action.value))
  } else if (action.kind === 'duplicate_array_item') {
    if (!Array.isArray(target) || !Number.isInteger(action.index)) typedError('mutation_recipe_invalid')
    target.splice(action.index! + 1, 0, structuredClone(target[action.index!]))
  } else typedError('mutation_recipe_invalid')
  return output
}

export function validateSuccessorFreshness(input: { predecessor_issued_at_ms: number; successor_issued_at_ms: number; successor_expires_at_ms: number; now_ms: number }): void {
  if (![input.predecessor_issued_at_ms, input.successor_issued_at_ms, input.successor_expires_at_ms, input.now_ms].every(Number.isSafeInteger)) typedError('schema_invalid')
  if (input.successor_issued_at_ms === input.predecessor_issued_at_ms) typedError('successor_issue_time_reuse')
  if (input.successor_expires_at_ms - input.successor_issued_at_ms !== 1_209_600_000) typedError('successor_expiry_not_14_days')
  if (input.successor_expires_at_ms <= input.now_ms) typedError('evidence_expired')
}

export function validatePredecessorBinding(bytes: Uint8Array, expectedSha256: string): void {
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== expectedSha256) typedError('source_binding_invalid')
}

export function validateArtifactIndexCompleteness(requiredPaths: readonly string[], indexedPaths: readonly string[]): void {
  if (requiredPaths.length !== indexedPaths.length || new Set(requiredPaths).size !== requiredPaths.length || new Set(indexedPaths).size !== indexedPaths.length || requiredPaths.some((item) => !indexedPaths.includes(item))) typedError('dag_invalid')
}

export function validateExternalDigestBindings(expected: Readonly<Record<string, string>>, actual: Readonly<Record<string, string>>): void {
  if (!comparePairedProjection(expected, actual).equivalent) typedError('dag_invalid')
}

function baseAdmission() {
  return { conclusions: ['Reproduced', 'Reproduced', 'Reproduced'], phase3b_usable: [true, true, true], uncovered_e_leaves: 0, open_contradictions: 0, leak_findings: 0, mutation_disagreements: 0, fixtures_materializable: true, cross_repo_agreement: true, expires_at_ms: 15_000, now_ms: 1_000 }
}

function requestBase() {
  return { headers: ['content-type', 'x-synthetic'], multiplicity: { 'content-type': 1, 'x-synthetic': 1 }, body: { fields: ['model', 'messages', 'system', 'tools', 'stream'], messages: [0, 1], system: [0, 1], tools: [0, 1], tool_schema: 'a'.repeat(64), stream: true }, digest: 'a'.repeat(64) }
}

function pairedBase() {
  return { arm: 'uninstrumented', cell_id: 'cell-a', sequence_index: 0, repetition: 0, connection_ordinal: 0, receiver_process_digest: 'a'.repeat(64), receiver_source_sha256: 'a'.repeat(64), active_static_anchor_sha256: 'b'.repeat(64), pair_id: 'wire-pair', deterministic_seed: 215001, authority_class: 'synthetic-loopback', method: 'POST', path: '/v1/messages', ordered_header_names: ['content-type'], header_multiplicity: { 'content-type': 1 }, auth_marker_winner_class: 'absent', canonical_body_sha256: 'c'.repeat(64), typed_request_ast: { safe: true }, attempt_ordinal: 0, scenario_action_ordinal: 0, response_program_ref: 'complete_sse', response_projection: { terminal_event: 'message_stop' }, wire_action_completed: true, raw_material_persisted: false }
}

function executeRecipe(entry: MutationEntry): void {
  const { subject, action } = entry.recipe
  if (subject === 'strict_json_bytes') {
    const fixtures: Record<string, string | Uint8Array> = { duplicate_json_key: '{"a":1,"a":2}', invalid_utf8: Buffer.from([0xff]), lone_surrogate: '"\\ud800"', negative_zero: '{"n":-0}', unsafe_integer: '{"n":9007199254740992}', trailing_data: '{"a":1} trailing' }
    return void parseEvidenceJson(fixtures[action.fixture!])
  }
  if (subject === 'clock_attestation') {
    const base = { schema_id: 'oracle-lab-p3b-es-clock-attestation.v1', schema_major: 1, schema_revision: 0, campaign_id: 'p3b-es1-mutation', issued_at_ms: 1_000, last_authorizing_cell_sequence: 340 }
    const decision = validateEvidenceArtifact('clock-attestation.schema.json', applyAction(base, action))
    if (!decision.allowed) typedError(decision.code)
    return
  }
  if (subject === 'typed_fixture_path') {
    const base = { schema_id: 'oracle-lab-p3b-es-typed-fixture.v1', schema_major: 1, schema_revision: 0, campaign_id: 'p3b-es1-mutation', fixture_kind: 'request', literal_table_relative_path: 'capsules/P3B-ES1/control/synthetic-literals.json', literal_table_sha256: 'a'.repeat(64), materialization_recipe: 'typed-request-jcs-v1', materialized_bytes_sha256: 'a'.repeat(64), typed_ast_digest: 'a'.repeat(64), ast: {} }
    const decision = validateEvidenceArtifact('typed-fixture.schema.json', applyAction(base, action))
    if (!decision.allowed) typedError(decision.code)
    return
  }
  if (subject === 'source_file') {
    const root = mkdtempSync(path.join(os.tmpdir(), 'p3b-es-mutation-source-'))
    const target = path.join(root, 'target.json'); const link = path.join(root, 'source.json')
    writeFileSync(target, '{}', { mode: 0o600 }); symlinkSync(target, link); assertNoSymlinkSource(link); return
  }
  if (subject === 'request_projection') {
    const base = requestBase(); const mutated = applyAction(base, action)
    if (!comparePairedProjection(base, mutated).equivalent) typedError('request_digest_mismatch')
    return
  }
  if (subject === 'predecessor_projection') {
    const base = { auth: { winner_class: 'api-key-a' } }; const mutated = applyAction(base, action)
    if (!comparePairedProjection(base, mutated).equivalent) typedError('predecessor_contradiction')
    return
  }
  if (subject === 'response_projection') {
    const base = { events: ['message_start', 'message_delta', 'message_stop'], usage: ['output_tokens'], stop_reason: 'end_turn', transport_terminal: 'http_complete' }
    const mutated = applyAction(base, action)
    if (!mutated.events.includes('message_stop')) typedError('sse_grammar_uncovered')
    if (mutated.transport_terminal !== base.transport_terminal) typedError('transport_terminal_uncovered')
    if (!comparePairedProjection(base, mutated).equivalent) typedError('response_digest_mismatch')
    return
  }
  if (subject === 'retry_attempts') {
    const base = action.kind === 'duplicate_array_item' ? { attempts_by_launch: [[0]], launcher_retry_count: 0 }
      : action.kind === 'insert_array_item' ? { attempts_by_launch: [[0], [0]], launcher_retry_count: 1 }
        : { attempts_by_launch: [[0, 1]], launcher_retry_count: 0 }
    return void classifyRetryOwner(applyAction(base, action))
  }
  if (subject === 'paired_observation') {
    const base = pairedBase(); const comparison = comparePairedObservations(base, applyAction(base, action))
    if (!comparison.equivalent) typedError('paired_perturbation')
    return
  }
  if (subject === 'deterministic_schedule') {
    const base = buildDeterministicSchedule('p3b-es1-mutation', 'schedule-mutation', ['instrumented', 'uninstrumented'])
    return void validateDeterministicSchedule(applyAction(base, action) as DeterministicSchedule)
  }
  if (subject === 'predecessor_binding') {
    const base = { predecessor: { issued_at_ms: 1_000, expires_at_ms: 1_000 + 1_209_600_000 } }
    const bytes = canonicalizeEvidenceJson(base); const digest = createHash('sha256').update(bytes).digest('hex')
    return void validatePredecessorBinding(canonicalizeEvidenceJson(applyAction(base, action)), digest)
  }
  if (subject === 'successor_freshness') {
    const base = { predecessor_issued_at_ms: 1_000, successor_issued_at_ms: 2_000, successor_expires_at_ms: 2_000 + 1_209_600_000, now_ms: 3_000 }
    return void validateSuccessorFreshness(applyAction(base, action))
  }
  if (subject === 'evidence_admission') {
    const decision = decideEvidenceAdmission(applyAction(baseAdmission(), action)); if (!decision.allowed) typedError(decision.code); return
  }
  if (subject === 'artifact_index') {
    const base = { required: ['control.json', 'coverage.json'], indexed: ['control.json', 'coverage.json'] }
    const mutated = applyAction(base, action); return void validateArtifactIndexCompleteness(mutated.required, mutated.indexed)
  }
  if (subject === 'external_digest_set') {
    const base = { expected: { index: 'a'.repeat(64), terminal: 'b'.repeat(64) }, actual: { index: 'a'.repeat(64), terminal: 'b'.repeat(64) } }
    const mutated = applyAction(base, action); return void validateExternalDigestBindings(mutated.expected, mutated.actual)
  }
  typedError('mutation_recipe_invalid')
}

export function executeEvidenceMutations(entries: readonly MutationEntry[]): MutationObservation[] {
  validateMutationRecipes(entries)
  return entries.map((entry) => {
    let actualCode = 'admission_allow'
    try { executeRecipe(entry) } catch (error) { actualCode = stableCode(error) }
    return { id: entry.id, subject: entry.recipe.subject, schema: entry.recipe.schema, actual_code: actualCode, decision: actualCode === 'admission_allow' ? 'allow' : 'deny' }
  })
}

export function compareMutationExecutions(observations: readonly MutationObservation[], expected: Readonly<Record<string, string>>): MutationExecution[] {
  return observations.map((observation) => ({ ...observation, expected_code: expected[observation.id] ?? 'mutation_expected_code_missing', agrees: observation.actual_code === expected[observation.id] }))
}

export function executeEvidenceMutationCorpus(): MutationExecution[] {
  return compareMutationExecutions(executeEvidenceMutations(loadEvidenceMutationCorpus()), expectedMutationResults())
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
