import assert from 'node:assert/strict'

import {
  BASE_URL_ENV_KEYS,
  REGION_ENV_KEYS,
  buildEnvironmentMatrix,
  validateMatrixPair,
} from '../tools/oracle-lab/phase3a/environment-matrix.js'

console.log('\ntests/oracle-phase3a-matrix.test.ts')

const requiredKeys = [...BASE_URL_ENV_KEYS, ...REGION_ENV_KEYS, 'HOSTNAME', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC']
const census = {
  binding: { artifact_sha256: 'a'.repeat(64) },
  env_reads: requiredKeys.map((key, index) => ({
    key,
    locations: [{ module_id: `module-${index}`, node_kind: 'PropertyAccessExpression', location: { offset: 217_000_000 + index, length: key.length } }],
    match_count: 1,
    module_count: 1,
  })),
}

const matrix = buildEnvironmentMatrix(census)
assert.equal(matrix.pair_count, 60)
assert.equal(matrix.pairs.length, 60)
assert.equal(new Set(matrix.pairs.map((pair) => pair.pair_id)).size, 60)
assert.ok(matrix.pairs.every((pair) => validateMatrixPair(pair) === pair))
assert.ok(matrix.pairs.every((pair) => pair.static_anchor.locations.length > 0))
assert.ok(BASE_URL_ENV_KEYS.every((key) => matrix.pairs.filter((pair) => pair.changed_variable === key).length >= 2))
assert.ok(REGION_ENV_KEYS.every((key) => matrix.pairs.filter((pair) => pair.changed_variable === key).length >= 2))
assert.equal(matrix.pairs.filter((pair) => pair.changed_variable === 'HOSTNAME').length, 2)
assert.deepEqual(
  [...new Set(matrix.pairs.filter((pair) => pair.family === 'provider-token').map((pair) => pair.treatment.value_class))].sort(),
  ['alivun', 'aliyun', 'anthropic', 'china', 'chinax', 'deepseek', 'dot-cn', 'lab', 'labyrinth', 'moonshot', 'punctuation-control', 'qwen', 'unrelated-control', 'volcengine', 'zhipu'],
)
assert.match(matrix.deterministic_digest, /^[a-f0-9]{64}$/)
assert.throws(() => validateMatrixPair({ ...matrix.pairs[0], treatment: { ...matrix.pairs[0].treatment, variable: 'OTHER' } }), /exactly one declared variable/)

console.log(JSON.stringify({ ok: true, pairs: matrix.pair_count }))
