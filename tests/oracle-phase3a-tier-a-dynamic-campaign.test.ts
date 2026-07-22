import assert from 'node:assert/strict'

import { classifyPair, parseTierADynamicArgs } from '../tools/oracle-lab/phase3a/tier-a-dynamic-campaign.js'

console.log('\ntests/oracle-phase3a-tier-a-dynamic-campaign.test.ts')

const runs = (failed = false) => ['control', 'treatment'].flatMap((arm) => Array.from({ length: 5 }, (_, repetition) => ({
  arm, repetition, status: failed && arm === 'treatment' && repetition === 0 ? 'failed' : 'complete',
  interface_sha256: `${arm}-interface`, dual_source: true, observer_event_count: 1,
})))

assert.equal(classifyPair(runs() as any, 5).status, 'REPRODUCED')
assert.equal(classifyPair(runs(true) as any, 5).status, 'UNKNOWN')
assert.throws(() => parseTierADynamicArgs(['--repetitons', '5']), /unknown argument/)
assert.throws(() => parseTierADynamicArgs(['--repetitions', '5', '--repetitions', '6']), /duplicate argument/)

console.log(JSON.stringify({ ok: true, cases: 4 }))
