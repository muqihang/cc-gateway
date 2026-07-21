import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { buildProbeObserverReplacements, buildProbePairManifests, classifyInstrumentationPair } from '../tools/oracle-lab/phase3a/instrumentation-capability.js'
import { assessProbeSigning, buildProbePayload, patchProbeCopy } from '../tools/oracle-lab/phase3a/probe-copy.js'
import { sha256Bytes, sha256File } from '../tools/oracle-lab/phase3a/core.js'
import type { LaunchManifest } from '../tools/oracle-lab/phase3a/launch-manifest.js'
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
assert.equal(equivalent.run_identity_equal, true)
assert.match(equivalent.control_run_identity_sha256, /^[a-f0-9]{64}$/)

const unreachable = classifyInstrumentationPair({ ...equivalent.input, treatment_hook_events: 0 })
assert.equal(unreachable.classification, 'hook-unavailable')
assert.equal(unreachable.dual_source, false)
const perturbed = classifyInstrumentationPair({ ...equivalent.input, treatment_status: 'failed' })
assert.equal(perturbed.classification, 'instrumentation-perturbed')
const changed = classifyInstrumentationPair({ ...equivalent.input, treatment_events: [{ ...event, path_class: '/other' }] })
assert.equal(changed.classification, 'instrumentation-perturbed')
assert.match(equivalent.control_semantic_sha256, /^[a-f0-9]{64}$/)
assert.match(equivalent.treatment_semantic_sha256, /^[a-f0-9]{64}$/)

const metadataKey = '45447b7afbd5e544f7d0f1df0fccd26014d9850130abd3f020b89ff96b82079f'
const userIdKey = 'f89d6b6960453241bc5b09b4d0d8ad86d53769e051473350c2bf94e39077967b'
const withRunIdentity = (digest: string): SafeUpstreamEvent => ({
  ...event,
  body_topology: { type: 'object', fields: [{ key_sha256: metadataKey, value: { type: 'object', fields: [{ key_sha256: userIdKey, value: { type: 'string', bytes: 150, sha256: digest } }] } }] },
})
const runIdentityOnly = classifyInstrumentationPair({
  ...equivalent.input,
  control_events: [withRunIdentity('d'.repeat(64))],
  treatment_events: [withRunIdentity('e'.repeat(64))],
})
assert.equal(runIdentityOnly.classification, 'instrumentation-equivalent')
assert.equal(runIdentityOnly.semantic_behavior_equal, true)
assert.equal(runIdentityOnly.run_identity_equal, false)
assert.notEqual(runIdentityOnly.control_run_identity_sha256, runIdentityOnly.treatment_run_identity_sha256)

const runtimeRoot = mkdtempSync(path.join(os.tmpdir(), 'phase3a-bun-hook-'))
const prepared = prepareHookFiles('bun', runtimeRoot)
assert.deepEqual(prepared.env, {})
assert.equal(prepared.argv[0], '--preload')
assert.equal(path.dirname(prepared.argv[1]), runtimeRoot)
const staged = readFileSync(prepared.argv[1], 'utf8')
assert.match(staged, /hook\.ready/)
assert.doesNotMatch(staged, /RAW_VENDOR/)
assert.throws(() => prepareHookFiles('bun'), /isolated runtime root/)

const payload = buildProbePayload(597)
assert.equal(payload.length, 597)
assert.equal(payload.at(-1), 0x0a)
assert.match(payload.toString('ascii'), /probe\.ready/)
assert.match(payload.toString('ascii'), /CLAUDE_CODE_TMPDIR/)
assert.match(payload.toString('ascii'), /globalThis\.fetch/)
assert.match(payload.toString('ascii'), /createHash\("sha256"\)/)
assert.match(payload.toString('ascii'), /destination_sha256/)
assert.throws(() => buildProbePayload(64), /probe payload exceeds comment region/)

const copyRoot = mkdtempSync(path.join(os.tmpdir(), 'phase3a-probe-copy-'))
const source = path.join(copyRoot, 'source.bin')
const beforeRegion = Buffer.from(`//${' '.repeat(594)}\n`, 'ascii')
const sourceBytes = Buffer.concat([Buffer.from('PREFIX{', 'ascii'), beforeRegion, Buffer.from('var answer=42}', 'ascii')])
writeFileSync(source, sourceBytes, { mode: 0o755 })
const destinationRelative = 'copies/probe.bin'
mkdirSync(path.join(copyRoot, 'copies'), { mode: 0o700 })
const recipe = patchProbeCopy({
  evidence_root: copyRoot,
  source,
  destination_relative: destinationRelative,
  expected_parent_sha256: sha256File(source),
  module_offset: 0,
  module_length: sourceBytes.length,
  expected_module_sha256: sha256Bytes(sourceBytes),
  patch_offset: Buffer.byteLength('PREFIX{'),
  patch_length: beforeRegion.length,
  expected_before_sha256: sha256Bytes(beforeRegion),
  payload: buildProbePayload(beforeRegion.length),
})
const destination = path.join(copyRoot, destinationRelative)
assert.equal(sha256File(source), recipe.parent_sha256)
assert.equal(readFileSync(source).equals(sourceBytes), true)
assert.equal(statSync(destination).size, sourceBytes.length)
assert.equal(recipe.patch.offset, Buffer.byteLength('PREFIX{'))
assert.equal(recipe.patch.length, beforeRegion.length)
assert.equal(recipe.patch.before_sha256, sha256Bytes(beforeRegion))
assert.equal(recipe.patch.after_sha256, sha256Bytes(buildProbePayload(beforeRegion.length)))
assert.equal(recipe.module.before_sha256, sha256Bytes(sourceBytes))
assert.notEqual(recipe.module.after_sha256, recipe.module.before_sha256)
assert.equal(recipe.pre_sign_sha256, sha256File(destination))
assert.equal(existsSync(destination), true)
assert.throws(() => patchProbeCopy({
  evidence_root: copyRoot,
  source,
  destination_relative: destinationRelative,
  expected_parent_sha256: sha256File(source),
  module_offset: 0,
  module_length: sourceBytes.length,
  expected_module_sha256: sha256Bytes(sourceBytes),
  patch_offset: Buffer.byteLength('PREFIX{'),
  patch_length: beforeRegion.length,
  expected_before_sha256: sha256Bytes(beforeRegion),
  payload: buildProbePayload(beforeRegion.length),
}), /destination already exists/)

const originalDigest = 'a'.repeat(64)
const patchedDigest = 'b'.repeat(64)
const probeBase = {
  run_id: 'probe-base',
  artifact: { entrypoint_sha256: originalDigest },
  command: { executable_sha256: originalDigest, cwd: 'runs/probe-base/cwd' },
  environment: { home: 'runs/probe-base/home', xdg: 'runs/probe-base/xdg', tmp: 'runs/probe-base/tmp' },
  matrix: { fixed_variables: {} },
  capture: { hook: false, inspector: false },
  preflight: { status: 'PASS', codegraph_current: true },
} as unknown as LaunchManifest
const probePair = buildProbePairManifests(probeBase, 'closure-probe-copy-v1', patchedDigest, 'c'.repeat(64))
assert.equal(probePair.control.command.executable_sha256, originalDigest)
assert.equal(probePair.control.artifact.entrypoint_sha256, originalDigest)
assert.equal(probePair.treatment.command.executable_sha256, patchedDigest)
assert.equal(probePair.treatment.artifact.entrypoint_sha256, patchedDigest)
assert.equal(probePair.control.matrix.control_value, 'original')
assert.equal(probePair.treatment.matrix.treatment_value, 'probe-copy')
assert.equal(probePair.control.capture.hook, false)
assert.equal(probePair.treatment.capture.hook, true)
assert.notEqual(probePair.control.environment.tmp, probePair.treatment.environment.tmp)
assert.equal(probePair.treatment.matrix.fixed_variables.probe_recipe_sha256, 'c'.repeat(64))
const observerReplacements = buildProbeObserverReplacements('/tmp/phase3a-evidence', 'closure-probe-copy-v1')
assert.equal(observerReplacements.length, 8)
assert.deepEqual([...new Set(observerReplacements.map((entry) => entry.replacement))].sort(), ['<CWD>', '<HOME>', '<TMP>', '<XDG>'])
assert.ok(observerReplacements.some((entry) => entry.value.endsWith('/runs/closure-probe-copy-v1-control/cwd')))
assert.ok(observerReplacements.some((entry) => entry.value.endsWith('/runs/closure-probe-copy-v1-treatment/tmp')))

assert.deepEqual(assessProbeSigning({
  sign_exit_code: 0, verify_exit_code: 0, parent_size: 100, post_sign_size: 120,
  expected_module_sha256: originalDigest, module_after_sign_sha256: originalDigest,
}), { status: 'PASS', size_delta_bytes: 20 })
assert.equal(assessProbeSigning({
  sign_exit_code: 0, verify_exit_code: 0, parent_size: 100, post_sign_size: 100,
  expected_module_sha256: originalDigest, module_after_sign_sha256: patchedDigest,
}).status, 'FAIL')

console.log(JSON.stringify({ ok: true, cases: 58 }))
