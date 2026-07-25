import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  EVIDENCE_SCHEMA_FILES,
  canonicalizeEvidenceJson,
  decideEvidenceAdmission,
  expectedMutationResults,
  executeEvidenceMutationCorpus,
  parseEvidenceJson,
  validateEvidenceArtifact,
} from '../tools/oracle-lab/phase3b-evidence-sufficiency/schemas.js'

const contractRoot = path.resolve('contracts/oracle-lab/evidence-sufficiency/v1')

test('evidence contract exposes every planned strict schema', () => {
  assert.equal(EVIDENCE_SCHEMA_FILES.length, 26)
  for (const relative of EVIDENCE_SCHEMA_FILES) {
    const schema = JSON.parse(readFileSync(path.join(contractRoot, relative), 'utf8')) as Record<string, unknown>
    assert.equal(schema.additionalProperties, false, `${relative} must be closed`)
    assert.equal(typeof schema.$id, 'string')
  }
})

test('every nested JSON Schema object is explicitly closed or a typed map', () => {
  const visit = (value: unknown, location: string): void => {
    if (Array.isArray(value)) { value.forEach((entry, index) => visit(entry, `${location}[${index}]`)); return }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (record.type === 'object') {
      assert.ok(Object.prototype.hasOwnProperty.call(record, 'additionalProperties'), `${location} is an open object schema`)
      assert.notEqual(record.additionalProperties, true, `${location} explicitly permits arbitrary properties`)
    }
    for (const [key, entry] of Object.entries(record)) visit(entry, `${location}.${key}`)
  }
  for (const relative of EVIDENCE_SCHEMA_FILES) {
    visit(JSON.parse(readFileSync(path.join(contractRoot, relative), 'utf8')), relative)
  }
})

test('operator authority rejects a nested unknown field', () => {
  const digest = 'a'.repeat(64)
  const commit = 'b'.repeat(40)
  const repository = { branch: 'codex/test', commit, tree: commit }
  const receiverIdentity = {
    schema_id: 'oracle-lab-p3b-es-receiver-executable-identity.v1', algorithm: 'receiver-node-tsx-tuple-jcs-sha256-v1',
    source_sha256: digest, launcher_sha256: digest, loader_sha256: digest, digest,
  }
  const authority = {
    active_static_anchor: { selection_relative_path: 'capsules/P3B-ES1/control/static-anchor-selection.json', receiver_identity: receiverIdentity },
    schema_id: 'oracle-lab-p3b-es-operator-authority.v1', schema_major: 1, schema_revision: 0,
    authority_id: 'operator-decision-test-authority', campaign_id: 'p3b-es1-test-campaign', decision: 'authorized',
    delegated_source_task_id: '019f518f-1a68-71d2-a959-b495302afe80',
    allowed_scope: Array.from({ length: 18 }, (_, index) => `ES${index}`), prohibited_scope: ['resume'],
    capability_mode: 'new_non_resume', no_reused_dynamic_authority: true, synthetic_loopback_only: true,
    evidence_root_identity: { leaf_name: 'evidence-test', realpath_sha256: digest, required_initial_state: 'new_empty_before_authority' },
    plan: { head: commit, merge_commit: commit, relative_path: 'docs/plan.md', sha256: digest },
    repositories: { cc_gateway: repository, sub2api: repository },
    resource_budget: {
      target_launches_max: 340, target_launches_parallel: 1, campaign_wall_ms_max: 36_000_000,
      cell_wall_ms_max: 90_000, cell_cpu_ms_max: 60_000, cell_rss_bytes_max: 1_073_741_824,
      cell_output_bytes_max: 8_388_608, cell_processes_max: 16, cell_sockets_max: 8, cell_retries_max: 8,
      cell_files_max: 512, receiver_body_bytes_max: 8_388_608, receiver_headers_max: 256,
      receiver_events_max: 1024, receiver_attempts_max: 8, external_socket_budget: 0,
    },
  }
  assert.deepEqual(validateEvidenceArtifact('operator-authority.schema.json', authority), { allowed: true, code: 'admission_allow' })
  assert.deepEqual(validateEvidenceArtifact('operator-authority.schema.json', {
    ...authority, plan: { ...authority.plan, unexpected_nested: true },
  }), { allowed: false, code: 'schema_invalid' })
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
  const mutations = JSON.parse(readFileSync(path.join(contractRoot, 'mutation-corpus.json'), 'utf8')) as Array<{ id: string; recipe: { subject: string; schema: string; action: { kind: string } } }>
  const expected = JSON.parse(readFileSync(path.join(contractRoot, 'expected-results.json'), 'utf8')) as Record<string, string>
  assert.equal(mutations.length, 48)
  assert.equal(new Set(mutations.map((mutation) => mutation.id)).size, mutations.length)
  assert.deepEqual(expectedMutationResults(), expected)
  assert.deepEqual(Object.keys(expected).sort(), mutations.map((mutation) => mutation.id).sort())
  assert.ok(mutations.every((mutation) => mutation.recipe.subject.length > 0 && mutation.recipe.schema.length > 0 && mutation.recipe.action.kind.length > 0))
  for (const code of Object.values(expected)) assert.match(code, /^[a-z][a-z0-9_]+$/)
  const results = executeEvidenceMutationCorpus()
  assert.equal(results.length, 48)
  for (const result of results) {
    assert.equal(result.actual_code, result.expected_code, result.id)
    assert.equal(result.agrees, true, result.id)
    assert.equal(result.decision, 'deny', result.id)
  }
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
