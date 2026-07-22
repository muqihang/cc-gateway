import assert from 'node:assert/strict'

import { canonicalJson, sha256Bytes } from '../tools/oracle-lab/phase3a/core.js'
import { buildR2CoverageClosure, parseR2ClosureArgs } from '../tools/oracle-lab/phase3a/r2-closure.js'

console.log('\ntests/oracle-phase3a-r2-closure.test.ts')

const digest = 'a'.repeat(64)
const gapBase = {
  status: 'CLOSED_WITH_UNKNOWN', executed_cells: 5, external_socket_budget: 0, raw_material_persisted: false,
  cases: [
    'compact-cache-long-context', 'telemetry-diagnostic-doctor', 'telemetry-update', 'restart-resume-init', 'restart-resume-resume',
  ].map((case_id) => ({ case_id, status: 'complete', manifest_sha256: digest, guard_sha256: digest, observer_sha256: digest, result_sha256: digest })),
  families: [
    { hypothesis: 'compact-and-prompt-cache-lifecycle', evidence_level: 'Unknown', commands: ['long-context'], searched_surfaces: ['request-cache-control'], failure_classification: 'transition-not-observed', next_minimal_action: 'preserve terminal unknown' },
    { hypothesis: 'telemetry-diagnostic-update-error-traffic', evidence_level: 'Unknown', commands: ['doctor', 'update'], searched_surfaces: ['observer', 'process'], failure_classification: 'destination-not-observed', next_minimal_action: 'preserve terminal unknown' },
    { hypothesis: 'restart-resume-and-child-process-lineage', evidence_level: 'Unknown', commands: ['session-id', 'resume'], searched_surfaces: ['session-state', 'process-lineage'], failure_classification: 'resume-transition-not-observed', next_minimal_action: 'preserve terminal unknown' },
  ],
}
const gap = { ...gapBase, deterministic_digest: sha256Bytes(canonicalJson(gapBase)), sha256: digest }
const result = buildR2CoverageClosure({
  probe: { status: 'PASS', sha256: digest }, environment: { status: 'PASS', pair_count: 60, sha256: digest },
  saturation: { status: 'SATURATED', consecutive_no_new_batches: 3, sha256: digest }, scenario: { status: 'PASS', pair_count: 9, sha256: digest },
  config: { statuses: { REPRODUCED: 4 }, sha256: digest }, auth_primary: { statuses: { REPRODUCED: 3, UNKNOWN: 1 }, sha256: digest },
  auth_supplement: { statuses: { REPRODUCED: 1 }, sha256: digest },
  gap,
})
assert.equal(result.status, 'CLOSED_WITH_UNKNOWN')
assert.equal(result.coverage_counts.Reproduced, 7)
assert.equal(result.coverage_counts.Unknown, 3)
assert.equal(result.coverage.length, 10)
assert.equal(result.coverage.find((row: any) => row.hypothesis === 'compact-and-prompt-cache-lifecycle')?.source, 'gap')
const unresolved = buildR2CoverageClosure({ ...result.inputs, environment: { ...result.inputs.environment, status: 'CLOSED_WITH_UNKNOWN', statuses: { REPRODUCED: 57, UNKNOWN: 3 } } } as any)
assert.equal(unresolved.coverage_counts.Reproduced, 6)
assert.equal(unresolved.coverage_counts.Unknown, 4)
assert.throws(() => buildR2CoverageClosure({ ...result.inputs, environment: { ...result.inputs.environment, pair_count: 59 } } as any), /environment closure/)
const promotedGapBase = { ...gapBase, families: gapBase.families.map((row) => ({ ...row, evidence_level: 'Reproduced' })) }
assert.throws(() => buildR2CoverageClosure({ ...result.inputs, gap: { ...promotedGapBase, deterministic_digest: sha256Bytes(canonicalJson(promotedGapBase)), sha256: digest } } as any), /gap family/)
assert.throws(() => parseR2ClosureArgs(['--gap', '--out']), /arguments must/)
assert.throws(() => parseR2ClosureArgs(['--out', 'a', '--out', 'b']), /duplicate argument/)

console.log(JSON.stringify({ ok: true, cases: 9 }))
