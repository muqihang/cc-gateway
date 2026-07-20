import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { classifyInstrumentationPair } from '../tools/oracle-lab/phase3a/instrumentation-capability.js'
import type { SafeUpstreamEvent } from '../tools/oracle-lab/phase3a/observers/fake-upstream.js'
import { prepareHookFiles } from '../tools/oracle-lab/phase3a/run-cell.js'

console.log('\ntests/oracle-phase3a-instrumentation.test.ts')

const event: SafeUpstreamEvent = {
  sequence: 0,
  method: 'POST',
  path_class: '/v1/messages',
  header_names: ['content-type'],
  header_value_classes: { 'content-type': 'json' },
  body_bytes: 100,
  body_sha256: 'a'.repeat(64),
  body_topology: { type: 'object' },
  response_class: 'anthropic:sse',
  request_class: 'messages',
  system_summary: { status: 'observed', byte_length: 10, sha256: 'b'.repeat(64), ast_topology: { type: 'array' }, span_hashes: [] },
  cch_class: 'body-cache-control',
}

const equivalent = classifyInstrumentationPair({
  control_status: 'complete', treatment_status: 'complete', control_events: [event], treatment_events: [{ ...event, sequence: 9, body_sha256: 'c'.repeat(64) }],
  treatment_hook_events: 4, control_process_samples: 1, treatment_process_samples: 2,
})
assert.equal(equivalent.classification, 'instrumentation-equivalent')
assert.equal(equivalent.hook_reachable, true)
assert.equal(equivalent.semantic_behavior_equal, true)
assert.equal(equivalent.dual_source, true)

const unreachable = classifyInstrumentationPair({ ...equivalent.input, treatment_hook_events: 0 })
assert.equal(unreachable.classification, 'hook-unavailable')
assert.equal(unreachable.dual_source, false)
const perturbed = classifyInstrumentationPair({ ...equivalent.input, treatment_status: 'failed' })
assert.equal(perturbed.classification, 'instrumentation-perturbed')
const changed = classifyInstrumentationPair({ ...equivalent.input, treatment_events: [{ ...event, path_class: '/other' }] })
assert.equal(changed.classification, 'instrumentation-perturbed')
assert.match(equivalent.control_semantic_sha256, /^[a-f0-9]{64}$/)
assert.match(equivalent.treatment_semantic_sha256, /^[a-f0-9]{64}$/)

const runtimeRoot = mkdtempSync(path.join(os.tmpdir(), 'phase3a-bun-hook-'))
const prepared = prepareHookFiles('bun', runtimeRoot)
assert.deepEqual(prepared.env, {})
assert.equal(prepared.argv[0], '--preload')
assert.equal(path.dirname(prepared.argv[1]), runtimeRoot)
const staged = readFileSync(prepared.argv[1], 'utf8')
assert.match(staged, /hook\.ready/)
assert.doesNotMatch(staged, /RAW_VENDOR/)
assert.throws(() => prepareHookFiles('bun'), /isolated runtime root/)

console.log(JSON.stringify({ ok: true, cases: 17 }))
