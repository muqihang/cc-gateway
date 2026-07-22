import assert from 'node:assert/strict'

import { analyzeConvergence, balancedPairOrder, type ConvergenceRun } from '../tools/oracle-lab/phase3a/converge.js'

console.log('\ntests/oracle-phase3a-convergence.test.ts')

const first = balancedPairOrder(41, 6)
const second = balancedPairOrder(41, 6)
assert.deepEqual(first, second)
assert.equal(first.filter((order) => order[0] === 'control').length, 3)
assert.equal(first.filter((order) => order[0] === 'treatment').length, 3)
assert.throws(() => balancedPairOrder(1, 13), /between 1 and 12/)

function runs(repetitions: number, mutate?: (run: ConvergenceRun) => void): ConvergenceRun[] {
  const result: ConvergenceRun[] = []
  const order = balancedPairOrder(23, repetitions)
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const arm of order[repetition]) {
      const run: ConvergenceRun = {
        run_id: `${repetition}-${arm}`, repetition, arm, success: true, observer_failures: [], instrumented: arm === 'treatment', perturbation: arm === 'treatment' ? 'equivalent' : 'not-applicable',
        normalized: { endpoint: '/v1/messages', arm_value: arm, stable: true, variable_bucket: repetition % 2 },
      }
      mutate?.(run); result.push(run)
    }
  }
  return result
}

const three = analyzeConvergence('pair-1', runs(3))
assert.equal(three.status, 'CONTINUE', 'fixed three-run completion must be rejected')
assert.equal(three.evidence_level, 'Observed')

const stable = analyzeConvergence('pair-1', runs(5))
assert.equal(stable.status, 'CONVERGED', JSON.stringify(stable))
assert.equal(stable.evidence_level, 'Reproduced')
assert.equal(stable.profile_usable, true)
assert.ok(stable.variable_leaves.includes('control:$.variable_bucket'))

const failed = analyzeConvergence('pair-1', runs(5, (run) => { if (run.run_id === '2-control') { run.success = false; run.observer_failures.push('socket-sampler') } }))
assert.notEqual(failed.status, 'CONVERGED', 'a failed repetition must remain visible')
assert.deepEqual(failed.outlier_run_ids, ['2-control'])

const unclassified = analyzeConvergence('pair-1', runs(5, (run) => { if (run.instrumented) run.perturbation = 'unclassified' }))
assert.equal(unclassified.instrumentation_classified, false)
assert.notEqual(unclassified.status, 'CONVERGED')

const perturbed = analyzeConvergence('pair-1', runs(5, (run) => { if (run.instrumented) run.perturbation = 'perturbed' }))
assert.equal(perturbed.status, 'CONVERGED')
assert.equal(perturbed.profile_usable, false)

const newTail = analyzeConvergence('pair-1', runs(5, (run) => { if (run.repetition >= 3) run.normalized = { ...(run.normalized as object), late_value: run.repetition } }))
assert.notEqual(newTail.status, 'CONVERGED')
assert.ok(newTail.unresolved_leaves.some((leaf) => leaf.endsWith('$.late_value')))

const maxed = analyzeConvergence('pair-1', runs(12, (run) => { if (run.repetition >= 10) run.normalized = { ...(run.normalized as object), late_value: run.repetition } }))
assert.equal(maxed.status, 'MAX_UNRESOLVED')

const gap = runs(5).map((run) => run.repetition >= 2 ? { ...run, repetition: run.repetition + 1 } : run)
assert.equal(analyzeConvergence('pair-1', gap).status, 'INVALID')

console.log(JSON.stringify({ ok: true, minimum_repetitions: 5, maximum_repetitions: 12 }))
