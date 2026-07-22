import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { classifyPair, parseTierADynamicArgs, runTierADynamicCampaign, selectTierADynamicLanes } from '../tools/oracle-lab/phase3a/tier-a-dynamic-campaign.js'
import { Phase3AError } from '../tools/oracle-lab/phase3a/core.js'

console.log('\ntests/oracle-phase3a-tier-a-dynamic-campaign.test.ts')

const runs = (failed = false) => ['control', 'treatment'].flatMap((arm) => Array.from({ length: 5 }, (_, repetition) => ({
  arm, repetition, status: failed && arm === 'treatment' && repetition === 0 ? 'failed' : 'complete',
  interface_sha256: `${arm}-interface`, dual_source: true, observer_event_count: 1,
})))

assert.equal(classifyPair(runs() as any, 5).status, 'REPRODUCED')
assert.equal(classifyPair(runs(true) as any, 5).status, 'UNKNOWN')
assert.throws(() => parseTierADynamicArgs(['--repetitons', '5']), /unknown argument/)
assert.throws(() => parseTierADynamicArgs(['--repetitions', '5', '--repetitions', '6']), /duplicate argument/)
assert.equal(parseTierADynamicArgs(['--pairs', '2.1.214:long-run'])['pairs'], '2.1.214:long-run')

const selected = selectTierADynamicLanes({
  versions: ['2.1.214', '2.1.212', '2.1.211'],
  pairs: '2.1.214:long-run,2.1.214:restart,2.1.212:restart,2.1.211:base-url-background-restart',
})
assert.deepEqual(selected.map(({ lane, pairs }) => ({ version: lane.version, pairs })), [
  { version: '2.1.214', pairs: ['long-run', 'restart'] },
  { version: '2.1.212', pairs: ['restart'] },
  { version: '2.1.211', pairs: ['base-url-background-restart'] },
])
assert.equal(selected.every(({ complete }) => complete === false), true)
assert.deepEqual(selectTierADynamicLanes({ versions: ['2.1.211'] }).map(({ pairs, complete }) => ({ pairs, complete })), [
  { pairs: ['base-url-background-restart', 'compact-cache'], complete: true },
])

const expectSelectionError = (input: Parameters<typeof selectTierADynamicLanes>[0], code: string): void => {
  assert.throws(() => selectTierADynamicLanes(input), (error: unknown) => error instanceof Phase3AError && error.code === code)
}

expectSelectionError({ versions: ['2.1.214', '2.1.999'] }, 'tier_a_version_unknown')
expectSelectionError({ versions: ['2.1.214', '2.1.214'] }, 'tier_a_version_duplicate')
expectSelectionError({ versions: ['2.1.214'], pairs: '2.1.214:not-a-pair' }, 'tier_a_pair_unknown')
expectSelectionError({ versions: ['2.1.214'], pairs: '2.1.214:long-run,2.1.214:long-run' }, 'tier_a_pair_duplicate')
expectSelectionError({ versions: ['2.1.214'], pairs: '2.1.214:compact-cache' }, 'tier_a_pair_cross_lane')
expectSelectionError({ versions: ['2.1.214', '2.1.212'], pairs: '2.1.214:long-run' }, 'tier_a_pair_selection_incomplete')

const rejectedEvidenceRoot = path.join(tmpdir(), `tier-a-invalid-selection-${process.pid}-${Date.now()}`)
await assert.rejects(runTierADynamicCampaign({
  evidence_root: rejectedEvidenceRoot, out_relative: 'must-not-exist', campaign_id: 'invalid-selection', active_binary: '/missing/claude', repetitions: 5,
  cc_commit: 'a'.repeat(40), cc_tree: 'b'.repeat(40), sub2api_commit: 'c'.repeat(40), sub2api_tree: 'd'.repeat(40), toolchain_digest: 'e'.repeat(64),
  versions: ['2.1.214', '2.1.212'], pairs: '2.1.214:long-run',
}), (error: unknown) => error instanceof Phase3AError && error.code === 'tier_a_pair_selection_incomplete')
assert.equal(existsSync(rejectedEvidenceRoot), false)

console.log(JSON.stringify({ ok: true, cases: 15 }))
