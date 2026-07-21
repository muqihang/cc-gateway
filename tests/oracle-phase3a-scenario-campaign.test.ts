import assert from 'node:assert/strict'

import {
  SCENARIO_PAIRS,
  classifyScenarioPairRuns,
  validateScenarioRepetitions,
  type ScenarioRunRecord,
} from '../tools/oracle-lab/phase3a/scenario-campaign.js'
import { normalizedEventOrder } from '../tools/oracle-lab/phase3a/normalize.js'

console.log('\ntests/oracle-phase3a-scenario-campaign.test.ts')

assert.equal(SCENARIO_PAIRS.length, 9)
assert.deepEqual(SCENARIO_PAIRS.map((pair) => pair.pair_id), [
  'scenario-http-400',
  'scenario-http-401',
  'scenario-http-403',
  'scenario-http-429',
  'scenario-http-500',
  'scenario-http-529',
  'scenario-reset',
  'scenario-partial-sse',
  'scenario-complete-sse',
])
assert.ok(SCENARIO_PAIRS.every((pair) => pair.control.kind === 'anthropic'))
assert.deepEqual(
  SCENARIO_PAIRS.slice(0, 6).map((pair) => pair.treatment.kind === 'json' ? pair.treatment.status : null),
  [400, 401, 403, 429, 500, 529],
)
assert.equal(SCENARIO_PAIRS[6].treatment.kind, 'reset')
assert.equal(SCENARIO_PAIRS[7].treatment.kind, 'sse')
assert.equal(SCENARIO_PAIRS[8].treatment.kind, 'sse')
if (SCENARIO_PAIRS[7].treatment.kind === 'sse') assert.ok(SCENARIO_PAIRS[7].treatment.close_after! < SCENARIO_PAIRS[7].treatment.events.length)
if (SCENARIO_PAIRS[8].treatment.kind === 'sse') assert.equal(SCENARIO_PAIRS[8].treatment.close_after, undefined)

const runs = (control: ScenarioRunRecord['status'], treatment: ScenarioRunRecord['status'], sourceCount = 2): ScenarioRunRecord[] =>
  Array.from({ length: 5 }, (_, repetition) => [
    { arm: 'control' as const, repetition, status: control, source_count: sourceCount, observer_event_count: 1 },
    { arm: 'treatment' as const, repetition, status: treatment, source_count: sourceCount, observer_event_count: 1 },
  ]).flat()

assert.deepEqual(classifyScenarioPairRuns({ repetitions: 5, runs: runs('complete', 'failed') }), {
  status: 'REPRODUCED', effect: 'outcome-change', stable: true,
  control_outcome: 'complete', treatment_outcome: 'failed', terminal_cells: 10, dual_source_cells: 10, protocol_cells: 10,
})
assert.deepEqual(classifyScenarioPairRuns({ repetitions: 5, runs: runs('timeout', 'resource-limit') }), {
  status: 'REPRODUCED', effect: 'outcome-change', stable: true,
  control_outcome: 'timeout', treatment_outcome: 'resource-limit', terminal_cells: 10, dual_source_cells: 10, protocol_cells: 10,
})
assert.equal(classifyScenarioPairRuns({ repetitions: 5, runs: runs('complete', 'complete') }).effect, 'no-observed-effect')
assert.equal(classifyScenarioPairRuns({ repetitions: 5, runs: runs('complete', 'failed', 1) }).status, 'UNKNOWN')
const unstable = runs('complete', 'failed')
unstable[3] = { ...unstable[3], status: 'timeout' }
assert.deepEqual(classifyScenarioPairRuns({ repetitions: 5, runs: unstable }), {
  status: 'UNKNOWN', effect: 'unresolved', stable: false,
  control_outcome: 'complete', treatment_outcome: null, terminal_cells: 10, dual_source_cells: 10, protocol_cells: 10,
})

assert.equal(validateScenarioRepetitions(5), 5)
assert.equal(validateScenarioRepetitions(12), 12)
for (const invalid of [4, 13, 5.5, Number.NaN]) {
  assert.throws(() => validateScenarioRepetitions(invalid), (error: unknown) =>
    error instanceof Error && 'code' in error && error.code === 'invalid_repetitions')
}
const noProtocol = runs('complete', 'failed').map((run) => ({ ...run, observer_event_count: 0 }))
assert.equal(classifyScenarioPairRuns({ repetitions: 5, runs: noProtocol }).status, 'UNKNOWN')
assert.deepEqual(normalizedEventOrder([{ response_class: 'anthropic:json' }, { response_class: 'anthropic:json' }, { response_class: 'anthropic:sse' }]), ['anthropic:json', 'anthropic:sse'])

console.log(JSON.stringify({ ok: true, cases: 24 }))
