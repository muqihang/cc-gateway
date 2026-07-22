import assert from 'node:assert/strict'

import { closeScenarioPairs } from '../tools/oracle-lab/phase3a/scenario-closure.js'

console.log('\ntests/oracle-phase3a-scenario-closure.test.ts')

const result = closeScenarioPairs(['a', 'b'], [
  { pair_id: 'a', status: 'REPRODUCED', effect: 'outcome-change', source_sha256: 'a'.repeat(64) },
  { pair_id: 'b', status: 'REPRODUCED', effect: 'no-observed-effect', source_sha256: 'b'.repeat(64) },
])
assert.equal(result.status, 'PASS')
assert.equal(result.pair_count, 2)
assert.deepEqual(result.effects, { 'outcome-change': 1, 'no-observed-effect': 1 })
assert.throws(() => closeScenarioPairs(['a', 'b'], result.pairs.slice(0, 1)), /coverage mismatch/)

console.log(JSON.stringify({ ok: true, cases: 4 }))
