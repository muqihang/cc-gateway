import assert from 'node:assert/strict'

import { scanSafePersisted } from '../tools/oracle-lab/phase3a/schemas.js'

console.log('\ntests/oracle-phase3a-leak-guard.test.ts')

assert.deepEqual(scanSafePersisted({ summary: { sha256: 'a'.repeat(64), byte_length: 12 } }), [])
for (const value of [
  { raw_prompt: 'synthetic' },
  { nested: { request_body: 'bytes' } },
  { value: 'Bearer abcdefghijk' },
  { source_url: 'https://release-assets.githubusercontent.com/a?sig=secretvalue' },
  { lease: { status: 'PASS' } },
]) {
  assert.ok(scanSafePersisted(value).length > 0)
}

console.log(JSON.stringify({ ok: true, cases: 6 }))
