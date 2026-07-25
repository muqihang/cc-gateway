import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'

import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'

import { canonicalizeJsonValue } from '../../../src/oracle-contract/canonical.js'
import { parseStrictJson } from '../../../src/oracle-contract/strict-json.js'

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
