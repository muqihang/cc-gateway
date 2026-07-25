import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  EVIDENCE_SCHEMA_FILES,
  canonicalizeEvidenceJson,
  decideEvidenceAdmission,
  expectedMutationResults,
  parseEvidenceJson,
  validateEvidenceArtifact,
} from '../tools/oracle-lab/phase3b-evidence-sufficiency/schemas.js'

const contractRoot = path.resolve('contracts/oracle-lab/evidence-sufficiency/v1')

test('evidence contract exposes every planned strict schema', () => {
  assert.equal(EVIDENCE_SCHEMA_FILES.length, 25)
  for (const relative of EVIDENCE_SCHEMA_FILES) {
    const schema = JSON.parse(readFileSync(path.join(contractRoot, relative), 'utf8')) as Record<string, unknown>
    assert.equal(schema.additionalProperties, false, `${relative} must be closed`)
    assert.equal(typeof schema.$id, 'string')
  }
})

test('strict JSON and JCS reject unsafe encodings and stabilize canonical bytes', () => {
  assert.throws(() => parseEvidenceJson('{"a":1,"a":2}'), (error: unknown) => (error as { code?: string }).code === 'json_duplicate_key')
  assert.throws(() => parseEvidenceJson(Buffer.from([0xff])), (error: unknown) => (error as { code?: string }).code === 'json_invalid_utf8')
  assert.throws(() => parseEvidenceJson('{"n":-0}'), (error: unknown) => (error as { code?: string }).code === 'json_negative_zero')
  assert.throws(() => parseEvidenceJson('{"n":9007199254740992}'), (error: unknown) => (error as { code?: string }).code === 'json_number_unsafe')
  assert.throws(() => parseEvidenceJson('{"a":1} trailing'), (error: unknown) => (error as { code?: string }).code === 'json_trailing_data')
  assert.equal(canonicalizeEvidenceJson('{"z":1,"a":[true,null]}').toString(), '{"a":[true,null],"z":1}')
})

test('schema validator rejects unknown fields with a stable code', () => {
  const value = {
    schema_id: 'oracle-lab-p3b-es-clock-attestation.v1',
    schema_major: 1,
    schema_revision: 0,
    campaign_id: 'p3b-es1-test',
    issued_at_ms: 1_000,
    last_authorizing_cell_sequence: 340,
  }
  assert.deepEqual(validateEvidenceArtifact('clock-attestation.schema.json', value), { allowed: true, code: 'admission_allow' })
  assert.deepEqual(validateEvidenceArtifact('clock-attestation.schema.json', { ...value, unknown: true }), { allowed: false, code: 'schema_invalid' })
})

test('mutation corpus has one stable expected deny code per planned mutation', () => {
  const mutations = JSON.parse(readFileSync(path.join(contractRoot, 'mutation-corpus.json'), 'utf8')) as Array<{ id: string }>
  const expected = JSON.parse(readFileSync(path.join(contractRoot, 'expected-results.json'), 'utf8')) as Record<string, string>
  assert.equal(mutations.length, 48)
  assert.equal(new Set(mutations.map((mutation) => mutation.id)).size, mutations.length)
  assert.deepEqual(expectedMutationResults(), expected)
  assert.deepEqual(Object.keys(expected).sort(), mutations.map((mutation) => mutation.id).sort())
  for (const code of Object.values(expected)) assert.match(code, /^[a-z][a-z0-9_]+$/)
})

test('evidence admission is a three-conclusion fail-closed set', () => {
  const base = {
    conclusions: ['Reproduced', 'Reproduced', 'Reproduced'],
    phase3b_usable: [true, true, true],
    uncovered_e_leaves: 0,
    open_contradictions: 0,
    leak_findings: 0,
    mutation_disagreements: 0,
    fixtures_materializable: true,
    cross_repo_agreement: true,
    expires_at_ms: 15_000,
    now_ms: 1_000,
  } as const
  assert.deepEqual(decideEvidenceAdmission(base), { allowed: true, code: 'admission_allow' })
  assert.deepEqual(decideEvidenceAdmission({ ...base, conclusions: ['Reproduced', 'Unknown', 'Reproduced'] }), { allowed: false, code: 'evidence_not_reproduced' })
  assert.deepEqual(decideEvidenceAdmission({ ...base, open_contradictions: 1 }), { allowed: false, code: 'contradiction_open' })
  assert.deepEqual(decideEvidenceAdmission({ ...base, expires_at_ms: 999 }), { allowed: false, code: 'evidence_expired' })
})
