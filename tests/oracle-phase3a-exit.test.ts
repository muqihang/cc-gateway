import assert from 'node:assert/strict'

import { buildBlockedDeliverables, buildExitReport, assertExitReport, type CuratedExitInput } from '../tools/oracle-lab/phase3a/build-exit.js'
import { canonicalJson } from '../tools/oracle-lab/phase3a/core.js'
import { sha256Bytes } from '../tools/oracle-lab/phase3a/core.js'

console.log('\ntests/oracle-phase3a-exit.test.ts')

const a = 'a'.repeat(64)
const b = 'b'.repeat(64)
function repository(repository: 'cc-gateway' | 'sub2api'): any {
  const codegraphUnsigned = { version: '1.1.6', built_with_version: '1.1.6', extraction_version: 24, file_count: 1, node_count: 1, edge_count: 0, up_to_date: true as const }
  const codegraph = { ...codegraphUnsigned, binding_sha256: sha256Bytes(canonicalJson(codegraphUnsigned)) }
  const unsigned = { repository, base: 'c'.repeat(40), tool_review_freeze_head: 'd'.repeat(40), head: 'd'.repeat(40), tree: 'e'.repeat(40), dirty_path_count: 0 as const, dirty_state_sha256: sha256Bytes('[]'), codegraph }
  return { ...unsigned, repository_binding_sha256: sha256Bytes(canonicalJson(unsigned)) }
}
const unknown = {
  schema_version: 'oracle-lab-phase3a-conclusion.v1', conclusion_id: 'CL-ACTIVE-BASELINE-BLOCKED', level: 'Unknown',
  scope: 'claude-code-2.1.215 darwin-arm64 loopback baseline', statement: 'The bounded cell failed before messages coverage was obtained.',
  supporting_artifact_ids: ['active-baseline-002-summary'], contradicting_artifact_ids: [], static_anchor: null, dynamic_reproduction: null,
  single_source_reason: 'Only one safe loopback observer produced a bounded HEAD request.', platform_limits: ['TLS and OS tracing unavailable in this cell'],
  expiry: '2026-08-03T00:00:00.000Z', negative_capabilities: ['messages-request-unobserved'], phase3b_usable: false,
  prohibited_claims: ['CL-LOCAL-EVIDENCE-PRODUCTION-PROHIBITED'],
}

function fixture(): CuratedExitInput {
  return {
    generated_at: '2026-07-20T12:00:00.000Z', exit_report_path: 'docs/superpowers/evidence/phase3a/phase-3a-exit-report.json', artifact_index_sha256: a,
    p2: { bundle_sha256: a, predecessor_sha256: b, schema_range: '1:0-0' },
    repositories: [repository('cc-gateway'), repository('sub2api')],
    artifacts: [{ artifact_id: 'claude-code-2.1.215', entrypoint_sha256: a, signature_status: 'valid' }],
    toolchain_capabilities: { codegraph: 'available', os_trace: 'degraded' },
    static_analysis: { inventory: 'partial', ast: 'blocked' },
    coverage: { active: [{ platform: 'darwin-arm64', status: 'partial' }], change_points: [], omitted: [{ cell: 'messages', reason: 'baseline failed before request' }] },
    protocol_runtime_summaries: [{ run_id: 'active-baseline-002', request: 'HEAD-root-only', terminal_state: 'failed' }],
    perturbation_source_agreement: { source_agreement: 'single-source', usable: false },
    evidence_health: { contradictions: [], expired: [], errors: [{ category: 'transport' }], unknowns: ['messages', 'system', 'cch', 'tls', 'sse', 'compact'] },
    conclusions: [{ conclusion: unknown, authority_ceiling: 'Observed', observation_count: 1, parser_agreement: 'not-applicable', perturbed: false }],
    p2_mapping: { wire: 'unknown', semantic: 'unknown', state_sequence: 'unknown', failure_semantics: 'observed-only', bundle_unchanged: true },
    evidence_hygiene: { leak_scan: 'PASS', retention: 'retained', no_deletion: true },
    reproduction: { commands: ['npm exec tsx tests/oracle-phase3a-exit.test.ts'], unavailable_tools: ['os-trace'] },
    phase3b: { negative_capabilities: ['messages-request-unobserved'], candidate_input_schema: { type: 'object', additionalProperties: false }, acceptance_cases: ['new-streaming', 'resumed-streaming', 'bounded-recovery', 'deterministic-regeneration', 'ts-go-fixture-agreement'], rollback_reference: null },
    safety_confirmation: { no_production: true, no_real_credentials: true, no_real_upstream: true, no_real_canary: true, no_profile_promotion: true, no_phase4_wiring: true, no_protected_file_access: true, runtime_enforcement_implemented: false },
    missing_gates: ['messages-request-coverage', 'dual-source-agreement', 'change-point-coverage'],
  }
}

const first = buildBlockedDeliverables(fixture())
const second = buildBlockedDeliverables(fixture())
assertExitReport(first.exit)
assert.equal(canonicalJson(first.exit), canonicalJson(second.exit))
assert.equal(first.markdown, second.markdown)
assert.equal(Object.keys(first.exit.sections).length, 14)
assert.equal((first.exit.sections.phase3b_inputs.details as any).generated_runtime_profile, false)
assert.equal(first.markdown.match(/^## \d+\./gm)?.length, 14)
assert.equal(first.exit.status, 'BLOCKED')

const missing = structuredClone(first.exit) as any
delete missing.sections.static_analysis
assert.throws(() => assertExitReport(missing), (error: any) => error.code === 'exit_schema_invalid')
const extra = structuredClone(first.exit) as any
extra.sections.unplanned = { status: 'COMPLETE', details: {} }
assert.throws(() => assertExitReport(extra), (error: any) => error.code === 'exit_schema_invalid')
const unsafe = fixture() as any
unsafe.protocol_runtime_summaries[0].raw_prompt = 'synthetic'
assert.throws(() => buildExitReport(unsafe), (error: any) => error.code === 'exit_unsafe_material' || error.code === 'exit_forbidden_material')

console.log(JSON.stringify({ ok: true, sections: 14, deterministic: true }))
