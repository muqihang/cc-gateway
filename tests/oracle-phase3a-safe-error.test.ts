import assert from 'node:assert/strict'

import { classifySafeError, SAFE_ERROR_CATEGORIES } from '../tools/oracle-lab/phase3a/safe-error-classifier.js'

console.log('\ntests/oracle-phase3a-safe-error.test.ts')

const canaries = [
  'ORACLE_SECRET_CANARY', 'Bearer abcdefghijklmnop', 'https://secret.example.test/path?token=opaque',
  '/Users/operator/private.txt', 'SYSTEM PROMPT confidential', 'x-anthropic-billing-header: cch=secret',
  'ＡＰＩ＿ＫＥＹ confusable', 'line\u0000break',
]
for (let index = 0; index < 1000; index += 1) canaries.push(`sk-ant-fuzz-${index.toString(16).padStart(8, '0')}`)

for (const canary of canaries) {
  const result = classifySafeError({ status: 401, type: 'authentication_error', message: canary, cause: { stack: canary }, request_id: canary, unknown_field: canary })
  const encoded = JSON.stringify(result)
  assert.equal(result.category, 'authentication')
  assert.equal(result.provider_error_type, 'authentication_error')
  assert.match(result.request_correlation_sha256!, /^[a-f0-9]{64}$/)
  assert.equal(encoded.includes(canary), false)
  assert.deepEqual(Object.keys(result).sort(), ['category', 'protocol_status', 'provider_error_type', 'reauthorization_indicated', 'request_correlation_sha256', 'retry_after_bucket', 'retryable', 'state_changes'])
}

const cases = [
  [{ status: 403, type: 'permission_error' }, 'entitlement'], [{ status: 429, retry_after: 12 }, 'capacity'],
  [{ status: 400, type: 'invalid_request_error' }, 'request-shape'], [{ status: 502, type: 'proxy_error' }, 'proxy'],
  [{ status: 503, type: 'api_error' }, 'transport'], [{ status: 422, type: 'model_error' }, 'model'],
] as const
for (const [input, expected] of cases) assert.equal(classifySafeError(input).category, expected)
assert.deepEqual([...SAFE_ERROR_CATEGORIES], ['authentication', 'entitlement', 'capacity', 'model', 'request-shape', 'proxy', 'transport'])
assert.throws(() => classifySafeError({ message: 'unclassified opaque failure' }), (error: any) => error.code === 'safe_error_unknown_class')
assert.throws(() => classifySafeError({ status: 500, message: 'x'.repeat(1024 * 1024) }), (error: any) => error.code === 'safe_error_input_limit')

console.log(JSON.stringify({ ok: true, fuzz_cases: canaries.length, categories: SAFE_ERROR_CATEGORIES.length }))
