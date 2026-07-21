import assert from 'node:assert/strict'

import { closeEnvironmentMatrix } from '../tools/oracle-lab/phase3a/environment-closure.js'

console.log('\ntests/oracle-phase3a-environment-closure.test.ts')

const expected = [
  { pair_id: 'pair-a', family: 'region' },
  { pair_id: 'pair-b', family: 'provider-token' },
  { pair_id: 'pair-c', family: 'placeholder-auth' },
]
const closure = closeEnvironmentMatrix({
  matrix_sha256: 'a'.repeat(64), expected,
  rows: [
    { pair_id: 'pair-a', status: 'REPRODUCED', effect: 'no-observed-effect', source: 'core', source_sha256: 'b'.repeat(64) },
    { pair_id: 'pair-b', status: 'REPRODUCED', effect: 'semantic-change', source: 'provider', source_sha256: 'c'.repeat(64) },
    { pair_id: 'pair-c', status: 'REPRODUCED', effect: 'no-observed-effect', source: 'core', source_sha256: 'd'.repeat(64) },
  ],
})
assert.equal(closure.status, 'PASS')
assert.equal(closure.pair_count, 3)
assert.deepEqual(closure.effects, { 'no-observed-effect': 2, 'semantic-change': 1 })
assert.match(closure.deterministic_digest, /^[a-f0-9]{64}$/)
const withUnknown = closeEnvironmentMatrix({ matrix_sha256: 'a'.repeat(64), expected, rows: closure.pairs.map((row: any, index: number) => index === 0 ? { ...row, status: 'UNKNOWN' } : row) })
assert.equal(withUnknown.status, 'CLOSED_WITH_UNKNOWN')
assert.deepEqual(withUnknown.statuses, { UNKNOWN: 1, REPRODUCED: 2 })
assert.throws(() => closeEnvironmentMatrix({ matrix_sha256: 'a'.repeat(64), expected, rows: closure.pairs.slice(0, 2) }), /coverage mismatch/)
assert.throws(() => closeEnvironmentMatrix({ matrix_sha256: 'a'.repeat(64), expected, rows: [...closure.pairs, closure.pairs[0]] }), /duplicate pair/)

console.log(JSON.stringify({ ok: true, cases: 8 }))
