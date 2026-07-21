import assert from 'node:assert/strict'

import { analyzeSaturation } from '../tools/oracle-lab/phase3a/saturation.js'

console.log('\ntests/oracle-phase3a-saturation.test.ts')

const result = analyzeSaturation({
  baseline_signatures: ['effect:no-observed-effect', 'terminal:complete', 'source-count:3'],
  batches: [
    { family: 'routing', signatures: ['terminal:complete', 'source-count:3'] },
    { family: 'region', signatures: ['effect:no-observed-effect'] },
    { family: 'auth', signatures: ['terminal:complete'] },
  ],
})
assert.equal(result.status, 'SATURATED')
assert.equal(result.consecutive_no_new_batches, 3)
assert.ok(result.batches.every((batch: any) => batch.new_signatures.length === 0))
assert.throws(() => analyzeSaturation({ baseline_signatures: [], batches: [{ family: 'routing', signatures: [] }, { family: 'routing', signatures: [] }, { family: 'auth', signatures: [] }] }), /distinct trigger families/)

console.log(JSON.stringify({ ok: true, cases: 4 }))
