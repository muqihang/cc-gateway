import assert from 'node:assert/strict'

import {
  CONFIG_PRECEDENCE_PAIRS,
  classifyConfigRouting,
  classifyConfigPrecedencePairRuns,
  validateConfigPrecedenceRepetitions,
  type ConfigPrecedenceRunRecord,
} from '../tools/oracle-lab/phase3a/config-precedence-campaign.js'

console.log('\ntests/oracle-phase3a-config-precedence-campaign.test.ts')

assert.deepEqual(CONFIG_PRECEDENCE_PAIRS.map((pair) => pair.pair_id), [
  'config-precedence-user-vs-default',
  'config-precedence-project-vs-user',
  'config-precedence-local-vs-project',
  'config-precedence-process-env-vs-local',
])
assert.deepEqual(CONFIG_PRECEDENCE_PAIRS.map((pair) => pair.expected_winner_source.treatment), [
  'user', 'project', 'local', 'local',
])
assert.deepEqual(CONFIG_PRECEDENCE_PAIRS.map((pair) => pair.expected_winner_source.control), [
  'user', 'user', 'project', 'local',
])
assert.deepEqual(CONFIG_PRECEDENCE_PAIRS[0].control.values, { user: 'A' })
assert.deepEqual(CONFIG_PRECEDENCE_PAIRS[0].treatment.values, { user: 'B' })
assert.equal(CONFIG_PRECEDENCE_PAIRS[0].comparison_mode, 'user-only-reachability')
for (const pair of CONFIG_PRECEDENCE_PAIRS.slice(1)) {
  assert.equal(Object.keys(pair.treatment.values).length, 2)
  assert.equal(pair.control.expected_upstream, 'A')
}
assert.deepEqual(CONFIG_PRECEDENCE_PAIRS.slice(1).map((pair) => pair.treatment.expected_upstream), ['B', 'B', 'A'])
assert.deepEqual(classifyConfigRouting(
  [{ request_class: 'root' }],
  [{ request_class: 'messages' }],
), { request_upstream: 'B', preflight_upstream: 'A' })
assert.deepEqual(classifyConfigRouting(
  [{ request_class: 'messages' }],
  [{ request_class: 'root' }],
), { request_upstream: 'A', preflight_upstream: 'B' })
assert.deepEqual(classifyConfigRouting([], []), { request_upstream: 'none', preflight_upstream: 'none' })

assert.equal(validateConfigPrecedenceRepetitions(5), 5)
assert.equal(validateConfigPrecedenceRepetitions(12), 12)
for (const invalid of [4, 13, 5.5, Number.NaN]) {
  assert.throws(() => validateConfigPrecedenceRepetitions(invalid), (error: unknown) =>
    error instanceof Error && 'code' in error && error.code === 'invalid_repetitions')
}

const pair = CONFIG_PRECEDENCE_PAIRS[1]
const runs = (): ConfigPrecedenceRunRecord[] => Array.from({ length: 5 }, (_, repetition) => [
  { arm: 'control' as const, repetition, status: 'complete' as const, observed_upstream: 'A' as const, source_count: 2 },
  { arm: 'treatment' as const, repetition, status: 'complete' as const, observed_upstream: 'B' as const, source_count: 2 },
]).flat()

assert.deepEqual(classifyConfigPrecedencePairRuns({ pair, repetitions: 5, runs: runs() }), {
  status: 'REPRODUCED', effect: 'precedence-confirmed', stable: true,
  control_winner_source: 'user', treatment_winner_source: 'project',
  terminal_cells: 10, dual_source_cells: 10, correctly_routed_cells: 10,
})
const wrongRoute = runs(); wrongRoute[3] = { ...wrongRoute[3], observed_upstream: 'A' }
assert.equal(classifyConfigPrecedencePairRuns({ pair, repetitions: 5, runs: wrongRoute }).status, 'UNKNOWN')
assert.equal(classifyConfigPrecedencePairRuns({ pair, repetitions: 5, runs: wrongRoute }).effect, 'precedence-contradicted')
const unstable = runs(); unstable[3] = { ...unstable[3], observed_upstream: 'both' }
assert.equal(classifyConfigPrecedencePairRuns({ pair, repetitions: 5, runs: unstable }).stable, false)
assert.equal(classifyConfigPrecedencePairRuns({ pair, repetitions: 5, runs: runs().slice(1) }).status, 'UNKNOWN')
const singleSource = runs(); singleSource[0] = { ...singleSource[0], source_count: 1 }
assert.equal(classifyConfigPrecedencePairRuns({ pair, repetitions: 5, runs: singleSource }).status, 'UNKNOWN')

console.log(JSON.stringify({ ok: true, cases: 27 }))
