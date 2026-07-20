import assert from 'node:assert/strict'

import { buildBlockedDeliverables, type CuratedExitInput } from '../tools/oracle-lab/phase3a/build-exit.js'
import { canonicalJson } from '../tools/oracle-lab/phase3a/core.js'
import { validatePhase3A } from '../tools/oracle-lab/phase3a/schemas.js'

console.log('\ntests/oracle-phase3a-handoff.test.ts')

const a = 'a'.repeat(64)
const b = 'b'.repeat(64)
const baseConclusion = {
  schema_version: 'oracle-lab-phase3a-conclusion.v1', conclusion_id: 'CL-ROW', level: 'Observed', scope: 'darwin-arm64 loopback',
  statement: 'A bounded local observation was captured.', supporting_artifact_ids: ['artifact-1'], contradicting_artifact_ids: [],
  static_anchor: null, dynamic_reproduction: { run_ids: ['run-1'], control_run_ids: ['control-1'], source_count: 1 }, single_source_reason: 'Only one observer was available.',
  platform_limits: [], expiry: '2026-08-03T00:00:00.000Z', negative_capabilities: [], phase3b_usable: true,
  prohibited_claims: ['CL-LOCAL-EVIDENCE-PRODUCTION-PROHIBITED'],
}

function fixture(): CuratedExitInput {
  const rows = [
    { conclusion: { ...baseConclusion, conclusion_id: 'CL-SINGLE' }, authority_ceiling: 'Observed' as const, observation_count: 1, parser_agreement: 'agreed' as const, perturbed: false },
    { conclusion: { ...baseConclusion, conclusion_id: 'CL-PERTURBED' }, authority_ceiling: 'Reproduced' as const, observation_count: 6, parser_agreement: 'agreed' as const, perturbed: true },
    { conclusion: { ...baseConclusion, conclusion_id: 'CL-DISAGREED' }, authority_ceiling: 'Reproduced' as const, observation_count: 6, parser_agreement: 'disagreed' as const, perturbed: false },
    { conclusion: { ...baseConclusion, conclusion_id: 'CL-EXPIRED', expiry: '2026-07-19T00:00:00.000Z' }, authority_ceiling: 'Reproduced' as const, observation_count: 6, parser_agreement: 'agreed' as const, perturbed: false },
    { conclusion: { ...baseConclusion, conclusion_id: 'CL-CONTRADICTED', contradicting_artifact_ids: ['artifact-2'] }, authority_ceiling: 'Reproduced' as const, observation_count: 6, parser_agreement: 'agreed' as const, perturbed: false },
    { conclusion: { ...baseConclusion, conclusion_id: 'CL-UNKNOWN', level: 'Unknown', dynamic_reproduction: null, single_source_reason: 'coverage missing', phase3b_usable: false }, authority_ceiling: 'Unknown' as const, observation_count: 0, parser_agreement: 'not-applicable' as const, perturbed: false },
  ]
  return {
    generated_at: '2026-07-20T12:00:00.000Z', exit_report_path: 'docs/superpowers/evidence/phase3a/exit.json', artifact_index_sha256: a,
    p2: { bundle_sha256: a, predecessor_sha256: b, schema_range: '1:0-0' }, repositories: [], artifacts: [], toolchain_capabilities: {}, static_analysis: {},
    coverage: { active: [], change_points: [], omitted: [{ cell: 'all-positive', reason: 'blocked' }] }, protocol_runtime_summaries: [], perturbation_source_agreement: {},
    evidence_health: { contradictions: [{ contradiction_id: 'CX-1' }], expired: ['CL-EXPIRED'], errors: [], unknowns: ['positive-profile'] }, conclusions: rows,
    p2_mapping: {}, evidence_hygiene: { leak_scan: 'PASS' }, reproduction: { deterministic: true },
    phase3b: { negative_capabilities: ['no-usable-profile'], candidate_input_schema: { type: 'object', required: ['conclusion_id'], additionalProperties: false }, acceptance_cases: ['new-streaming', 'resumed-streaming', 'bounded-recovery', 'deterministic-regeneration', 'ts-go-fixture-agreement'], rollback_reference: { evidence_tuple: 'prior-independent' } },
    safety_confirmation: { no_production: true, no_real_credentials: true, no_real_upstream: true, no_real_canary: true, no_profile_promotion: true, no_phase4_wiring: true, no_protected_file_access: true, runtime_enforcement_implemented: false },
    missing_gates: ['no-reproduced-unperturbed-dual-source-row'],
  }
}

const first = buildBlockedDeliverables(fixture()).handoff
const second = buildBlockedDeliverables(fixture()).handoff
assert.deepEqual(validatePhase3A('handoff', first), [])
assert.equal(canonicalJson(first), canonicalJson(second))
assert.equal(first.status, 'BLOCKED')
assert.equal(first.runtime_enforcement_implemented, false)
assert.deepEqual(first.usable_conclusion_ids, [])
assert.deepEqual(first.candidate_input_rows, [])
assert.deepEqual(first.unknown_conclusion_ids, ['CL-CONTRADICTED', 'CL-DISAGREED', 'CL-EXPIRED', 'CL-PERTURBED', 'CL-SINGLE', 'CL-UNKNOWN'])
assert.equal(JSON.stringify(first).includes('runtime_profile'), false)
assert.equal(JSON.stringify(first).includes('raw_prompt'), false)

console.log(JSON.stringify({ ok: true, blocked_rows: first.unknown_conclusion_ids.length, usable_rows: 0 }))
