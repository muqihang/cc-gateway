import assert from 'node:assert/strict'

import { classifyInstrumentationPair } from '../tools/oracle-lab/phase3a/instrumentation-capability.js'
import type { SafeUpstreamEvent } from '../tools/oracle-lab/phase3a/observers/fake-upstream.js'

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

console.log(JSON.stringify({ ok: true, cases: 10 }))
