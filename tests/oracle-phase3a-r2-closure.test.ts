import assert from 'node:assert/strict'

import { buildR2CoverageClosure } from '../tools/oracle-lab/phase3a/r2-closure.js'

console.log('\ntests/oracle-phase3a-r2-closure.test.ts')

const digest = 'a'.repeat(64)
const result = buildR2CoverageClosure({
  probe: { status: 'PASS', sha256: digest }, environment: { status: 'PASS', pair_count: 60, sha256: digest },
  saturation: { status: 'SATURATED', consecutive_no_new_batches: 3, sha256: digest }, scenario: { status: 'PASS', pair_count: 9, sha256: digest },
  config: { statuses: { REPRODUCED: 4 }, sha256: digest }, auth_primary: { statuses: { REPRODUCED: 3, UNKNOWN: 1 }, sha256: digest },
  auth_supplement: { statuses: { REPRODUCED: 1 }, sha256: digest },
})
assert.equal(result.status, 'CLOSED_WITH_UNKNOWN')
assert.equal(result.coverage_counts.Reproduced, 7)
assert.equal(result.coverage_counts.Unknown, 3)
assert.equal(result.coverage.length, 10)
assert.throws(() => buildR2CoverageClosure({ ...result.inputs, environment: { ...result.inputs.environment, pair_count: 59 } } as any), /environment closure/)

console.log(JSON.stringify({ ok: true, cases: 4 }))
