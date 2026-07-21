import assert from 'node:assert/strict'

import { closureConclusions } from '../tools/oracle-lab/phase3a/r4-curation.js'

console.log('\ntests/oracle-phase3a-r4-curation.test.ts')

const rows = closureConclusions('a'.repeat(64), 'b'.repeat(64))
assert.equal(rows.length, 5)
assert.equal(rows.filter((row: any) => row.conclusion.level === 'Reproduced').length, 2)
assert.equal(rows.filter((row: any) => row.conclusion.level === 'Unknown').length, 3)
assert.ok(rows.filter((row: any) => row.conclusion.level === 'Reproduced').every((row: any) => row.conclusion.phase3b_usable && row.conclusion.dynamic_reproduction.source_count === 3))

console.log(JSON.stringify({ ok: true, cases: 4 }))
