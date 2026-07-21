import assert from 'node:assert/strict'

import { closureConclusions, evidenceRelativePath } from '../tools/oracle-lab/phase3a/r4-curation.js'

console.log('\ntests/oracle-phase3a-r4-curation.test.ts')

const rows = closureConclusions()
assert.equal(rows.length, 8)
assert.equal(rows.filter((row: any) => row.conclusion.level === 'Reproduced').length, 2)
assert.equal(rows.filter((row: any) => row.conclusion.level === 'Unknown').length, 6)
assert.ok(rows.filter((row: any) => row.conclusion.level === 'Reproduced').every((row: any) => row.conclusion.phase3b_usable && row.conclusion.dynamic_reproduction.source_count === 2))
assert.equal(evidenceRelativePath('/evidence/root', '/evidence/root/capsules/P3A-4/phase-3a-exit-report-v2.json'), 'capsules/P3A-4/phase-3a-exit-report-v2.json')
assert.throws(() => evidenceRelativePath('/evidence/root', '/tmp/unrelated/capsules/P3A-4/exit.json'), /evidence root/)

console.log(JSON.stringify({ ok: true, cases: 6 }))
