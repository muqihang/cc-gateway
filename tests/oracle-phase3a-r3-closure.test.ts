import assert from 'node:assert/strict'

import { evaluateR3Closure } from '../tools/oracle-lab/phase3a/r3-closure.js'

console.log('\ntests/oracle-phase3a-r3-closure.test.ts')

const result = evaluateR3Closure({
  commit: 'a'.repeat(40), tree: 'b'.repeat(40), base_commit: 'c'.repeat(40), worktree_clean: true,
  changed_files: ['tools/oracle_phase3a_adapter.py', 'tools/tests/test_oracle_phase3a_adapter.py'],
  target_tests: 10, boundary_tests: 48,
})
assert.equal(result.status, 'PASS')
assert.equal(result.tier_b.status, 'SKIPPED_BY_RULE')
assert.equal(result.boundary_pairs.length, 4)
assert.throws(() => evaluateR3Closure({ ...result.intake, target_tests: 9 } as any), /target test count/)

console.log(JSON.stringify({ ok: true, cases: 4 }))
