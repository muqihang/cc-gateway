import assert from 'node:assert/strict'

import { Phase3AError } from '../tools/oracle-lab/phase3a/core.js'
import { evaluatePreflight, type PreflightFacts } from '../tools/oracle-lab/phase3a/preflight.js'

console.log('\ntests/oracle-phase3a-preflight.test.ts')

const facts: PreflightFacts = { cc_head: 'a'.repeat(40), cc_tree: 'b'.repeat(40), sub2api_head: 'c'.repeat(40), sub2api_tree: 'd'.repeat(40), bundle_sha256: 'e'.repeat(64), predecessor_sha256: 'f'.repeat(64), plan_sha256: '1'.repeat(64) }
assert.deepEqual(evaluatePreflight(facts, facts), { status: 'PASS' })
assert.throws(() => evaluatePreflight({ ...facts, cc_head: '0'.repeat(40) }, facts), (error: unknown) => error instanceof Phase3AError && error.code === 'repository_drift')
assert.throws(() => evaluatePreflight({ ...facts, bundle_sha256: '0'.repeat(64) }, facts), (error: unknown) => error instanceof Phase3AError && error.code === 'contract_digest_mismatch')
assert.throws(() => evaluatePreflight({ ...facts, plan_sha256: '0'.repeat(64) }, facts), (error: unknown) => error instanceof Phase3AError && error.code === 'plan_digest_mismatch')

console.log(JSON.stringify({ ok: true, cases: 4 }))
