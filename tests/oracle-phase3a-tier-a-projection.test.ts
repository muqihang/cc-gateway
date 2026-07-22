import assert from 'node:assert/strict'

import { parseTierADynamicProjectionArgs, projectTierADynamicLane } from '../tools/oracle-lab/phase3a/tier-a-dynamic-projection.js'

console.log('\ntests/oracle-phase3a-tier-a-projection.test.ts')

const digest = (value: string): string => value.repeat(64).slice(0, 64)
const control = { archive_sha256: digest('a'), tree_sha256: digest('b'), entrypoint_sha256: digest('c') }
const active = { archive_sha256: digest('d'), tree_sha256: digest('e'), entrypoint_sha256: digest('f') }

function bindings(mutate: (cell: any) => void = () => {}): any {
  const cells: any[] = []
  for (let repetition = 0; repetition < 5; repetition += 1) {
    for (const arm of ['control', 'treatment'] as const) {
      const artifact = arm === 'control' ? control : active
      const cell = {
        run_id: `run-${repetition}-${arm}`, pair_id: 'pair-telemetry', required_pair: 'telemetry', version: '2.1.214', hypothesis_id: 'r3-214-otel-stream-restart-keepalive',
        repetition, arm, sequence_index: repetition * 2 + (repetition % 2 === 0 ? (arm === 'control' ? 0 : 1) : (arm === 'treatment' ? 0 : 1)),
        terminal: true, dual_source: true, perturbation_free: true, interface_sha256: digest(arm === 'control' ? '1' : '2'),
        capsule: { ...artifact },
      }
      mutate(cell)
      cells.push(cell)
    }
  }
  return { binding_root: 'capsules/P3A-3/tier-a-cell-bindings-v1/2.1.214', sources: [], cells }
}

function input(binding_capsules = bindings()): any {
  return {
    campaign: { schema_version: 'oracle-lab-phase3a-tier-a-dynamic-campaign.v1', external_socket_budget: 0, raw_material_persisted: false },
    lane: {
      schema_version: 'oracle-lab-phase3a-tier-a-lane-summary.v1', version: '2.1.214', hypothesis_id: 'r3-214-otel-stream-restart-keepalive',
      status: 'REPRODUCED', pair_count: 1, required_pairs: ['telemetry'], active, control,
      structural: { archive_changed: true, tree_changed: true, entrypoint_changed: true }, external_socket_budget: 0, raw_material_persisted: false,
      pairs: [{ required_pair: 'telemetry', repetitions: 5, status: 'REPRODUCED', terminal_cells: 10, dual_source_cells: 10, protocol_cells: 10, external_socket_budget: 0, raw_material_persisted: false }],
    },
    campaign_summary_path: 'capsules/P3A-3/tier-a-dynamic-campaign-v5-214-required-pairs/summary.json',
    lane_summary_path: 'capsules/P3A-3/tier-a-dynamic-campaign-v5-214-required-pairs/lanes/2.1.214/summary.json',
    campaign_summary_sha256: digest('1'), lane_summary_sha256: digest('2'), binding_capsules,
  }
}

const projection = projectTierADynamicLane(input())
assert.equal(projection.schema_version, 'oracle-lab-phase3a-tier-a-dynamic-projection.v3')
assert.equal(projection.status, 'REPRODUCED')
assert.equal(projection.pairs.length, 1)
assert.equal(projection.admission.status, 'PASS')
assert.deepEqual(Object.fromEntries(Object.entries(projection.admission).filter(([key]) => key !== 'status' && key !== 'convergence').map(([key, value]: any) => [key, value.status])), {
  static_anchor: 'PASS', artifact_binding: 'PASS', control_treatment_run_coverage: 'PASS', dual_source: 'PASS', perturbation: 'PASS',
})
assert.equal(projection.admission.convergence.status, 'PASS')
assert.equal('rebuild' in projection, false)

const downgraded = projectTierADynamicLane(input(bindings((cell) => { if (cell.repetition === 0 && cell.arm === 'control') cell.dual_source = false })))
assert.equal(downgraded.status, 'UNKNOWN')
assert.equal(downgraded.admission.dual_source.status, 'BLOCKED')
assert.throws(() => projectTierADynamicLane(input({ ...bindings(), cells: bindings().cells.slice(1) })), /missing binding capsule/)
assert.throws(() => projectTierADynamicLane(input({ ...bindings(), cells: [...bindings().cells, bindings().cells[0]] })), /duplicate binding capsule/)
assert.throws(() => projectTierADynamicLane(input({ ...bindings(), cells: [...bindings().cells, { ...bindings().cells[0], version: '2.1.212' }] })), /different Tier A lane/)
assert.throws(() => parseTierADynamicProjectionArgs(['--campaign', 'x']), /unknown argument/)
assert.throws(() => parseTierADynamicProjectionArgs(['--out', 'a', '--out', 'b']), /duplicate argument/)

console.log(JSON.stringify({ ok: true, cases: 16 }))
