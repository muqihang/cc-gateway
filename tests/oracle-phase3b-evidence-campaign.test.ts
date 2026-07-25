import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  FIXED_SEEDS,
  buildDeterministicSchedule,
  classifyRetryOwner,
  comparePairedObservations,
  comparePairedProjection,
  evaluateResourceLimits,
  writeExclusiveEvidence,
} from '../tools/oracle-lab/phase3b-evidence-sufficiency/core.js'
import {
  computeSchemaBundleDigest,
  discoverProbeCommentRegion,
  verifyRegularFileIdentity,
} from '../tools/oracle-lab/phase3b-evidence-sufficiency/static-anchor.js'
import { buildSupplementGuardManifest } from '../tools/oracle-lab/phase3b-evidence-sufficiency/controls.js'
import { buildCellSandboxProfile } from '../tools/oracle-lab/phase3a/run-cell.js'

test('fixed base plus cyclic rotation is deterministic, unique, and balanced', () => {
  for (const labels of [
    ['instrumented', 'uninstrumented'],
    ['control/instrumented', 'control/uninstrumented', 'treatment/instrumented', 'treatment/uninstrumented'],
  ]) {
    const first = buildDeterministicSchedule('p3b-es1-test', `schedule-${labels.length}`, labels)
    const second = buildDeterministicSchedule('p3b-es1-test', `schedule-${labels.length}`, labels)
    assert.deepEqual(first, second)
    assert.equal(first.orders.length, FIXED_SEEDS.length)
    assert.equal(new Set(first.run_ids.flat()).size, labels.length * FIXED_SEEDS.length)
    const counts = new Map<string, number[]>()
    for (const label of labels) counts.set(label, Array(labels.length).fill(0))
    first.orders.forEach((order) => order.forEach((label, ordinal) => { counts.get(label)![ordinal] += 1 }))
    const flattened = [...counts.values()].flat()
    assert.ok(Math.max(...flattened) - Math.min(...flattened) <= 1)
  }
})

test('exclusive writer enforces append-only owner namespaces', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'p3b-es-writer-'))
  mkdirSync(path.join(root, 'capsules/P3B-ES1/observations/receiver'), { recursive: true, mode: 0o700 })
  const relative = 'capsules/P3B-ES1/observations/receiver/cell-1.json'
  assert.throws(() => writeExclusiveEvidence(root, relative, { schema_id: 'safe.test', raw_material_persisted: false }, 'controller'),
    (error: unknown) => (error as { code?: string }).code === 'writer_namespace_violation')
  assert.throws(() => writeExclusiveEvidence(root, 'capsules/P3B-ES1/observations/receiver/controller.json', { safe: true }, 'controller'),
    (error: unknown) => (error as { code?: string }).code === 'writer_namespace_violation')
})

test('paired comparator detects one mutated normalized leaf', () => {
  const base = { method: 'POST', path: '/v1/messages', ordered_header_names: ['content-type'] }
  assert.deepEqual(comparePairedProjection(base, structuredClone(base)), { equivalent: true, differing_pointers: [] })
  assert.deepEqual(comparePairedProjection(base, { ...base, path: '/v1/changed' }), {
    equivalent: false,
    differing_pointers: ['/path'],
  })
})

test('paired observation projection omits identity-only leaves and detects an authorizing mutation', () => {
  const base = {
    arm: 'uninstrumented', cell_id: 'cell-a', sequence_index: 1, receiver_process_digest: 'a'.repeat(64), receiver_source_sha256: 'a'.repeat(64), active_static_anchor_sha256: 'd'.repeat(64), connection_ordinal: 0,
    pair_id: 'wire-pair', repetition: 0, deterministic_seed: 215001, authority_class: 'synthetic-loopback',
    method: 'POST', path: '/v1/messages', ordered_header_names: ['content-type'], header_multiplicity: { 'content-type': 1 },
    auth_marker_winner_class: 'absent', canonical_body_sha256: 'b'.repeat(64), typed_request_ast: { safe: true },
    attempt_ordinal: 0, scenario_action_ordinal: 0, response_program_ref: 'complete_sse', response_projection: { terminal_event: 'message_stop' }, wire_action_completed: true, raw_material_persisted: false,
  }
  const peer = { ...structuredClone(base), arm: 'instrumented', cell_id: 'cell-b', sequence_index: 2, repetition: 4, connection_ordinal: 5 }
  assert.deepEqual(comparePairedObservations(base, peer), { equivalent: true, differing_pointers: [] })
  assert.throws(() => comparePairedObservations(base, { ...peer, receiver_process_digest: 'c'.repeat(64) }),
    (error: unknown) => (error as { code?: string }).code === 'paired_perturbation')
  assert.deepEqual(comparePairedObservations(base, { ...peer, path: '/v1/changed' }), { equivalent: false, differing_pointers: ['/path'] })
})

test('static anchor binds regular bytes, schema bundle, and a pure comment probe region', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'p3b-es-static-'))
  const artifact = path.join(root, 'synthetic-artifact')
  const bytes = Buffer.from(`prefix\n//${' '.repeat(1024)}\nmodule-tail`)
  writeFileSync(artifact, bytes, { mode: 0o700 })
  const identity = verifyRegularFileIdentity(artifact)
  assert.equal(identity.size, bytes.length)
  assert.match(identity.sha256, /^[a-f0-9]{64}$/)
  const region = discoverProbeCommentRegion(artifact, 0, bytes.length, 512)
  assert.equal(region.offset, 'prefix\n'.length)
  assert.ok(region.length >= 512)
  assert.match(region.sha256, /^[a-f0-9]{64}$/)

  const bundle = computeSchemaBundleDigest(path.resolve('contracts/oracle-lab/evidence-sufficiency/v1'))
  assert.equal(bundle.file_count, 28)
  assert.match(bundle.sha256, /^[a-f0-9]{64}$/)
})

test('every resource ceiling has a stable terminal failure family', () => {
  const base = { wall_ms: 1, cpu_ms: 1, rss_bytes: 1, output_bytes: 1, processes: 1, sockets: 1, retries: 0, files: 1, body_bytes: 1, headers: 1, events: 1, attempts: 1 }
  const limits = { wall_ms: 10, cpu_ms: 10, rss_bytes: 10, output_bytes: 10, processes: 10, sockets: 10, retries: 1, files: 10, body_bytes: 10, headers: 10, events: 10, attempts: 10 }
  assert.equal(evaluateResourceLimits(base, limits), null)
  for (const [field, code] of Object.entries({
    wall_ms: 'wall_limit', cpu_ms: 'cpu_limit', rss_bytes: 'rss_limit', output_bytes: 'output_limit',
    processes: 'process_limit', sockets: 'socket_limit', retries: 'retry_limit', files: 'file_limit',
    body_bytes: 'receiver_body_overflow', headers: 'receiver_header_overflow', events: 'receiver_event_overflow', attempts: 'receiver_attempt_overflow',
  })) assert.equal(evaluateResourceLimits({ ...base, [field]: 11 }, limits), code, field)
})

test('client, launcher, and none retry owners are distinct and mixed ownership denies', () => {
  assert.equal(classifyRetryOwner({ attempts_by_launch: [[0]], launcher_retry_count: 0 }), 'none')
  assert.equal(classifyRetryOwner({ attempts_by_launch: [[0, 1]], launcher_retry_count: 0 }), 'client')
  assert.equal(classifyRetryOwner({ attempts_by_launch: [[0], [0]], launcher_retry_count: 1 }), 'launcher')
  assert.throws(() => classifyRetryOwner({ attempts_by_launch: [[0, 1], [0]], launcher_retry_count: 1 }),
    (error: unknown) => (error as { code?: string }).code === 'retry_owner_ambiguous')
})

test('exact sandbox profile excludes receiver and probe artifact namespaces', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'p3b-es-guard-'))
  const manifest = buildSupplementGuardManifest({
    campaign_id: 'p3b-es1-test', cell_id: 'guard-cell', receiver_port: 19001,
    cc_commit: 'a'.repeat(40), cc_tree: 'b'.repeat(40), sub_commit: 'c'.repeat(40), sub_tree: 'd'.repeat(40),
  })
  const profile = buildCellSandboxProfile(manifest, root)
  assert.doesNotMatch(profile, /observations\/receiver|control\/probe/)
  assert.match(profile, /deny network\*/)
  assert.match(profile, /127\.0\.0\.1|localhost:19001/)
  assert.equal(manifest.network.external_socket_budget, 0)
})
