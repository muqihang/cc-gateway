import assert from 'node:assert/strict'

import { parseTierADynamicProjectionArgs, projectTierADynamicLane } from '../tools/oracle-lab/phase3a/tier-a-dynamic-projection.js'

console.log('\ntests/oracle-phase3a-tier-a-projection.test.ts')

const projection = projectTierADynamicLane({
  campaign: { schema_version: 'oracle-lab-phase3a-tier-a-dynamic-campaign.v1', external_socket_budget: 0, raw_material_persisted: false },
  lane: {
    schema_version: 'oracle-lab-phase3a-tier-a-lane-summary.v1', version: '2.1.214', hypothesis_id: 'r3-214-otel-stream-restart-keepalive',
    status: 'REPRODUCED', pair_count: 1, external_socket_budget: 0, raw_material_persisted: false,
    rebuild: { receipt: 'unsafe-source-only' },
    pairs: [{ required_pair: 'telemetry', status: 'REPRODUCED', terminal_cells: 10, dual_source_cells: 10, protocol_cells: 10, external_socket_budget: 0, raw_material_persisted: false, runs: Array.from({ length: 10 }, () => ({ status: 'complete', manifest_sha256: 'a'.repeat(64), guard_sha256: 'b'.repeat(64), observer_sha256: 'c'.repeat(64), result_sha256: 'd'.repeat(64) })) }],
  },
  campaign_summary_path: 'capsules/P3A-3/tier-a-dynamic-campaign-v4-214-required-pairs/summary.json',
  lane_summary_path: 'capsules/P3A-3/tier-a-dynamic-campaign-v4-214-required-pairs/lanes/2.1.214/summary.json',
  campaign_summary_sha256: 'a'.repeat(64),
  lane_summary_sha256: 'b'.repeat(64),
})
assert.equal(projection.status, 'REPRODUCED')
assert.equal(projection.pairs.length, 1)
assert.equal('rebuild' in projection, false)
assert.equal(JSON.stringify(projection).includes('receipt'), false)
assert.equal(projection.source_bindings.campaign_summary_path.endsWith('/summary.json'), true)
const downgraded = projectTierADynamicLane({
  campaign: { schema_version: 'oracle-lab-phase3a-tier-a-dynamic-campaign.v1', external_socket_budget: 0, raw_material_persisted: false },
  lane: { schema_version: 'oracle-lab-phase3a-tier-a-lane-summary.v1', version: '2.1.214', hypothesis_id: 'r3-214-otel-stream-restart-keepalive', status: 'REPRODUCED', pair_count: 1, external_socket_budget: 0, raw_material_persisted: false, pairs: [{ required_pair: 'telemetry', status: 'REPRODUCED', terminal_cells: 10, dual_source_cells: 10, protocol_cells: 10, external_socket_budget: 0, raw_material_persisted: false, runs: Array.from({ length: 10 }, (_, index) => ({ status: index === 0 ? 'failed' : 'complete' })) }] },
  campaign_summary_path: 'capsules/P3A-3/tier-a-dynamic-campaign-v4-214-required-pairs/summary.json', lane_summary_path: 'capsules/P3A-3/tier-a-dynamic-campaign-v4-214-required-pairs/lanes/2.1.214/summary.json', campaign_summary_sha256: 'a'.repeat(64), lane_summary_sha256: 'b'.repeat(64),
})
assert.equal(downgraded.status, 'UNKNOWN')
assert.throws(() => parseTierADynamicProjectionArgs(['--campaign', 'x']), /unknown argument/)
assert.throws(() => parseTierADynamicProjectionArgs(['--out', 'a', '--out', 'b']), /duplicate argument/)

console.log(JSON.stringify({ ok: true, cases: 8 }))
