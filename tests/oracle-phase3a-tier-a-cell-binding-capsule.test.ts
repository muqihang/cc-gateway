import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { buildTierACellBindingCapsule, parseTierACellBindingArgs, writeTierACellBindingCapsule } from '../tools/oracle-lab/phase3a/tier-a-cell-binding-capsule.js'
import { Phase3AError, sha256Bytes, sha256File } from '../tools/oracle-lab/phase3a/core.js'

console.log('\ntests/oracle-phase3a-tier-a-cell-binding-capsule.test.ts')

type Fixture = {
  root: string
  campaignRoot: string
  pairPath: string
  lanePath: string
  resultPath: string
  input: { evidence_root: string; campaign_root: string; version: string; pair: string; repetition: number; arm: 'control' }
  rewritePairAndLane: (mutate: (pair: Record<string, unknown>) => void) => void
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value)}\n`)
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
}

function makeFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tier-a-binding-'))
  const campaignRoot = path.join(root, 'capsules', 'P3A-3', 'untrusted-campaign-name')
  const control = { version: '2.1.214', archive_sha256: '', tree_sha256: 'a'.repeat(64), entrypoint_sha256: 'b'.repeat(64) }
  const active = { version: '2.1.215', archive_sha256: '', tree_sha256: 'c'.repeat(64), entrypoint_sha256: 'd'.repeat(64) }
  for (const [directory, artifact, id, contents] of [
    ['not-the-control-version', control, 'claude-code-2.1.214-platform', 'control archive'],
    ['not-the-active-version', active, 'claude-code-2.1.215-platform', 'active archive'],
  ] as const) {
    const archive = path.join(root, 'intake', 'platform', directory, 'archive.tgz')
    mkdirSync(path.dirname(archive), { recursive: true })
    writeFileSync(archive, contents)
    artifact.archive_sha256 = sha256File(archive)
    writeJson(path.join(path.dirname(archive), 'artifact.json'), { artifact_id: id, ...artifact })
  }
  const run = { run_id: 'campaign-214-telemetry-r0-control', arm: 'control', repetition: 0, version: '2.1.214', status: 'complete', entrypoint_sha256: control.entrypoint_sha256 }
  const pair = {
    schema_version: 'oracle-lab-phase3a-tier-a-pair-summary.v1', pair_id: 'tier-a-2.1.214-telemetry', required_pair: 'telemetry',
    version: '2.1.214', hypothesis_id: 'r3-214-otel-stream-restart-keepalive', external_socket_budget: 0, raw_material_persisted: false, runs: [run],
  }
  const cellRoot = path.join(campaignRoot, 'lanes', 'not-the-version', 'pairs', 'not-the-pair', 'opaque-cell-layout', 'anything')
  const manifestPath = path.join(cellRoot, 'manifest.json')
  const observerPath = path.join(cellRoot, 'observer.json')
  const resultPath = path.join(cellRoot, 'result.json')
  const guardPath = path.join(cellRoot, 'guard.json')
  writeJson(manifestPath, {
    schema_version: 'oracle-lab-phase3a-launch-manifest.v1', run_id: run.run_id, pair_id: pair.pair_id, hypothesis_id: `${pair.hypothesis_id}:${pair.required_pair}`,
    artifact: control, command: { executable_sha256: control.entrypoint_sha256, argv: ['opaque-command-material'] },
  })
  writeJson(observerPath, { schema_version: 'oracle-lab-phase3a-safe-observer.v1', raw_material_persisted: false, opaque_raw_material: 'observer-content-must-not-escape' })
  writeJson(resultPath, { status: 'complete', opaque_raw_material: 'result-content-must-not-escape' })
  writeJson(guardPath, { status: 'PASS' })
  writeJson(path.join(cellRoot, 'summary.json'), {
    schema_version: 'oracle-lab-phase3a-tier-a-cell-summary.v1', run_id: run.run_id, arm: run.arm, version: run.version, status: run.status,
    manifest_sha256: sha256File(manifestPath), observer_sha256: sha256File(observerPath), result_sha256: sha256File(resultPath), guard_sha256: sha256File(guardPath),
    external_socket_budget: 0, raw_material_persisted: false,
  })
  const pairPath = path.join(campaignRoot, 'lanes', 'not-the-version', 'pairs', 'not-the-pair', 'summary.json')
  const lanePath = path.join(campaignRoot, 'lanes', 'not-the-version', 'summary.json')
  const writePairAndLane = (mutate: (value: Record<string, unknown>) => void): void => {
    const nextPair = structuredClone(pair) as Record<string, unknown>
    mutate(nextPair)
    writeJson(pairPath, nextPair)
    writeJson(lanePath, {
      schema_version: 'oracle-lab-phase3a-tier-a-lane-summary.v1', role: 'tier-a', version: '2.1.214', hypothesis_id: pair.hypothesis_id,
      required_pairs: ['telemetry'], pair_count: 1, active, control, pairs: [nextPair], external_socket_budget: 0, raw_material_persisted: false,
    })
  }
  writePairAndLane(() => {})
  writeJson(path.join(campaignRoot, 'lanes', 'not-the-version', 'pairs', 'unrelated-pair', 'summary.json'), { required_pair: 'stream' })
  writeJson(path.join(campaignRoot, 'lanes', 'unrelated-directory', 'summary.json'), { version: '2.1.212' })
  writeJson(path.join(campaignRoot, 'summary.json'), {
    schema_version: 'oracle-lab-phase3a-tier-a-dynamic-campaign.v1', campaign_id: 'campaign-binding-fixture', active_version: active.version,
    lanes: [{ version: '2.1.214', hypothesis_id: pair.hypothesis_id, pair_count: 1 }], external_socket_budget: 0, raw_material_persisted: false,
  })
  return {
    root, campaignRoot, pairPath, lanePath, resultPath,
    input: { evidence_root: root, campaign_root: campaignRoot, version: '2.1.214', pair: 'telemetry', repetition: 0, arm: 'control' },
    rewritePairAndLane: writePairAndLane,
  }
}

function withFixture(test: (fixture: Fixture) => void): void {
  const fixture = makeFixture()
  try { test(fixture) } finally { rmSync(fixture.root, { recursive: true, force: true }) }
}

withFixture((fixture) => {
  const written = writeTierACellBindingCapsule({ ...fixture.input, out: 'capsules/P3A-3/bindings/cell.json' })
  assert.equal(written.capsule.version, '2.1.214')
  assert.equal(written.capsule.arm, 'control')
  assert.equal(written.capsule.raw_result_sha256, sha256File(fixture.resultPath))
  assert.equal(written.capsule.command_sha256, sha256Bytes(JSON.stringify({ argv: ['opaque-command-material'], executable_sha256: 'b'.repeat(64) })))
  assert.equal(JSON.stringify(written.capsule).includes('content-must-not-escape'), false)
  assert.throws(() => writeTierACellBindingCapsule({ ...fixture.input, out: 'capsules/P3A-3/bindings/cell.json' }), /output already exists/)
})

withFixture((fixture) => {
  const lane = readJson(fixture.lanePath)
  ;(lane.control as Record<string, unknown>).entrypoint_sha256 = 'e'.repeat(64)
  writeJson(fixture.lanePath, lane)
  assert.throws(() => buildTierACellBindingCapsule(fixture.input), (error: unknown) => error instanceof Phase3AError && error.code === 'tier_a_binding_version_entrypoint_mismatch')
})

withFixture((fixture) => {
  fixture.rewritePairAndLane((pair) => { pair.runs = [] })
  assert.throws(() => buildTierACellBindingCapsule(fixture.input), /missing control/)
})

withFixture((fixture) => {
  fixture.rewritePairAndLane((pair) => { pair.runs = [...(pair.runs as unknown[]), structuredClone((pair.runs as unknown[])[0])] })
  assert.throws(() => buildTierACellBindingCapsule(fixture.input), /duplicate runs/)
})

withFixture((fixture) => {
  writeJson(fixture.resultPath, { status: 'complete', opaque_raw_material: 'drifted-result-content' })
  assert.throws(() => buildTierACellBindingCapsule(fixture.input), /result digest does not match/)
})

withFixture((fixture) => {
  fixture.rewritePairAndLane((pair) => { pair.version = '2.1.212' })
  assert.throws(() => buildTierACellBindingCapsule(fixture.input), /different lane/)
})

assert.throws(() => parseTierACellBindingArgs(['--lane', 'tier-a']), /unknown argument/)
assert.throws(() => parseTierACellBindingArgs(['--out', 'a', '--out', 'b']), /duplicate argument/)

console.log(JSON.stringify({ ok: true, cases: 8 }))
