import assert from 'node:assert/strict'

import { Phase3AError } from '../tools/oracle-lab/phase3a/core.js'
import { captureToolchain, validateToolRecord } from '../tools/oracle-lab/phase3a/toolchain.js'

console.log('\ntests/oracle-phase3a-toolchain.test.ts')

assert.throws(
  () => validateToolRecord({
    name: 'version-only', status: 'available', executable_path: null, executable_sha256: null,
    version_output_sha256: null, version_first_line: '1.0', probe_exit_code: 0, fallback: 'other',
  }),
  (error: unknown) => error instanceof Phase3AError && error.code === 'toolchain_unpinned',
)

const first = captureToolchain(process.cwd())
const second = captureToolchain(process.cwd())
assert.equal(first.digest, second.digest)
assert.ok(first.records.some((record) => record.name === 'node' && record.status === 'available'))
assert.ok(first.records.every((record) => record.fallback.length > 0))
assert.ok(first.records.filter((record) => record.status === 'available').every((record) => record.executable_sha256 && record.version_output_sha256))

console.log(JSON.stringify({ ok: true, records: first.records.length }))
