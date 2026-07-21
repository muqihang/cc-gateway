import assert from 'node:assert/strict'

import {
  AUTH_LIFECYCLE_PAIRS,
  authSourceCount,
  classifyAuthLifecyclePairRuns,
  observeAuthCredential,
  validateAuthLifecycleRepetitions,
  type AuthLifecycleRunRecord,
} from '../tools/oracle-lab/phase3a/auth-lifecycle-campaign.js'

console.log('\ntests/oracle-phase3a-auth-lifecycle-campaign.test.ts')

assert.deepEqual(AUTH_LIFECYCLE_PAIRS.map((pair) => pair.pair_id), [
  'auth-api-key-rotation',
  'auth-token-rotation',
  'auth-credential-coexistence',
  'auth-missing-credential',
])
assert.deepEqual(AUTH_LIFECYCLE_PAIRS.map((pair) => pair.comparison_mode), [
  'rotation', 'rotation', 'empirical-coexistence', 'missing-credential',
])
assert.deepEqual(AUTH_LIFECYCLE_PAIRS[0].control.credentials, { ANTHROPIC_API_KEY: 'api-key-a' })
assert.deepEqual(AUTH_LIFECYCLE_PAIRS[0].treatment.credentials, { ANTHROPIC_API_KEY: 'api-key-b' })
assert.deepEqual(AUTH_LIFECYCLE_PAIRS[1].control.credentials, { ANTHROPIC_AUTH_TOKEN: 'auth-token-a' })
assert.deepEqual(AUTH_LIFECYCLE_PAIRS[1].treatment.credentials, { ANTHROPIC_AUTH_TOKEN: 'auth-token-b' })
assert.deepEqual(AUTH_LIFECYCLE_PAIRS[2].control.admissible_observations, ['authorization:auth-token-a+x-api-key:api-key-a'])
assert.deepEqual(AUTH_LIFECYCLE_PAIRS[2].treatment.admissible_observations, ['authorization:auth-token-b+x-api-key:api-key-b'])
assert.equal(AUTH_LIFECYCLE_PAIRS[2].control.expected_observation, null)
assert.equal(AUTH_LIFECYCLE_PAIRS[2].treatment.expected_observation, null)
assert.deepEqual(AUTH_LIFECYCLE_PAIRS[3].treatment.credentials, {})

assert.equal(validateAuthLifecycleRepetitions(5), 5)
assert.equal(validateAuthLifecycleRepetitions(12), 12)
for (const invalid of [4, 13, 5.5, Number.NaN]) {
  assert.throws(() => validateAuthLifecycleRepetitions(invalid), (error: unknown) =>
    error instanceof Error && 'code' in error && error.code === 'invalid_repetitions')
}

assert.equal(observeAuthCredential([{ header_value_classes: { 'x-api-key': 'api-key-a' } }]), 'x-api-key:api-key-a')
assert.equal(observeAuthCredential([{ header_value_classes: { authorization: 'auth-token-b' } }]), 'authorization:auth-token-b')
assert.equal(observeAuthCredential([{ header_value_classes: { authorization: 'present-redacted' } }]), 'none')
assert.equal(observeAuthCredential([{ header_value_classes: { 'x-api-key': 'api-key-a', authorization: 'auth-token-a' } }]), 'authorization:auth-token-a+x-api-key:api-key-a')
assert.equal(authSourceCount({ hook: 1, observer: 2, process: 3 }), 3)
assert.equal(authSourceCount({ hook: 1, observer: 0, process: 3 }), 2)
assert.equal(authSourceCount({ hook: 0, observer: 0, process: 3 }), 1)

const runs = (pairIndex: number, controlObservation: string, treatmentObservation: string): AuthLifecycleRunRecord[] => {
  const pair = AUTH_LIFECYCLE_PAIRS[pairIndex]
  return Array.from({ length: 5 }, (_, repetition) => [
    { arm: 'control' as const, repetition, status: pair.control.expected_status, observed_credential: controlObservation, source_count: 2 },
    { arm: 'treatment' as const, repetition, status: pair.treatment.expected_status, observed_credential: treatmentObservation, source_count: 2 },
  ]).flat()
}

const apiRotation = runs(0, 'x-api-key:api-key-a', 'x-api-key:api-key-b')
assert.deepEqual(classifyAuthLifecyclePairRuns({ pair: AUTH_LIFECYCLE_PAIRS[0], repetitions: 5, runs: apiRotation }), {
  status: 'REPRODUCED', effect: 'credential-rotation-observed', stable: true,
  control_observation: 'x-api-key:api-key-a', treatment_observation: 'x-api-key:api-key-b',
  terminal_cells: 10, dual_source_cells: 10, correctly_classified_cells: 10,
})

const tokenRotation = runs(1, 'authorization:auth-token-a', 'authorization:auth-token-b')
assert.equal(classifyAuthLifecyclePairRuns({ pair: AUTH_LIFECYCLE_PAIRS[1], repetitions: 5, runs: tokenRotation }).status, 'REPRODUCED')

const coexistence = runs(2, 'authorization:auth-token-a+x-api-key:api-key-a', 'authorization:auth-token-b+x-api-key:api-key-b')
const coexistenceClassified = classifyAuthLifecyclePairRuns({ pair: AUTH_LIFECYCLE_PAIRS[2], repetitions: 5, runs: coexistence })
assert.equal(coexistenceClassified.status, 'REPRODUCED')
assert.equal(coexistenceClassified.effect, 'stable-selection-observed')
const coexistenceNotDistinct = runs(2, 'x-api-key:api-key-a', 'x-api-key:api-key-a')
assert.equal(classifyAuthLifecyclePairRuns({ pair: AUTH_LIFECYCLE_PAIRS[2], repetitions: 5, runs: coexistenceNotDistinct }).status, 'UNKNOWN')

const missing = runs(3, 'x-api-key:api-key-a', 'none')
assert.equal(classifyAuthLifecyclePairRuns({ pair: AUTH_LIFECYCLE_PAIRS[3], repetitions: 5, runs: missing }).effect, 'missing-credential-failure-observed')
const unstable = apiRotation.map((run) => ({ ...run })); unstable[3].observed_credential = 'none'
assert.equal(classifyAuthLifecyclePairRuns({ pair: AUTH_LIFECYCLE_PAIRS[0], repetitions: 5, runs: unstable }).status, 'UNKNOWN')
const incomplete = apiRotation.slice(1)
assert.equal(classifyAuthLifecyclePairRuns({ pair: AUTH_LIFECYCLE_PAIRS[0], repetitions: 5, runs: incomplete }).status, 'UNKNOWN')
const singleSource = apiRotation.map((run) => ({ ...run })); singleSource[0].source_count = 1
assert.equal(classifyAuthLifecyclePairRuns({ pair: AUTH_LIFECYCLE_PAIRS[0], repetitions: 5, runs: singleSource }).status, 'UNKNOWN')

console.log(JSON.stringify({ ok: true, cases: 34 }))
