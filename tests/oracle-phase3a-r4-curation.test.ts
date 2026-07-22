import assert from 'node:assert/strict'

import { closureConclusions, evidenceRelativePath, parseR4CurationArgs } from '../tools/oracle-lab/phase3a/r4-curation.js'

console.log('\ntests/oracle-phase3a-r4-curation.test.ts')

const rows = closureConclusions()
assert.equal(rows.length, 7)
assert.equal(rows.filter((row: any) => row.conclusion.level === 'Reproduced').length, 2)
assert.equal(rows.filter((row: any) => row.conclusion.level === 'Unknown').length, 5)
assert.ok(rows.filter((row: any) => row.conclusion.level === 'Reproduced').every((row: any) => row.conclusion.phase3b_usable && row.conclusion.dynamic_reproduction.source_count === 2))
assert.equal(rows.some((row: any) => row.conclusion.conclusion_id === 'CL-P3A-ROUTING-ENVIRONMENT-UNKNOWN'), false)
assert.ok(rows.find((row: any) => row.conclusion.conclusion_id === 'CL-P3A-COMPACT-CACHE-UNKNOWN')?.conclusion.supporting_artifact_ids.includes('p3a2-gap-campaign-v2'))
assert.equal(closureConclusions({ environment_complete: false }).some((row: any) => row.conclusion.conclusion_id === 'CL-P3A-ROUTING-ENVIRONMENT-UNKNOWN'), true)
assert.equal(closureConclusions({ tier_a_complete: false }).some((row: any) => row.conclusion.conclusion_id === 'CL-P3A-TIER-A-DYNAMIC-UNKNOWN'), true)
assert.throws(() => parseR4CurationArgs(['--r2', '--r3']), /arguments must/)
assert.throws(() => parseR4CurationArgs(['--r2', 'a', '--r2', 'b']), /duplicate argument/)
assert.equal(evidenceRelativePath('/evidence/root', '/evidence/root/capsules/P3A-4/phase-3a-exit-report-v2.json'), 'capsules/P3A-4/phase-3a-exit-report-v2.json')
assert.throws(() => evidenceRelativePath('/evidence/root', '/tmp/unrelated/capsules/P3A-4/exit.json'), /evidence root/)

console.log(JSON.stringify({ ok: true, cases: 12 }))
