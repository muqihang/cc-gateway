import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { buildTierARerunTerminalUnknownArtifact, parseTierARerunTerminalUnknownArgs, writeTierARerunTerminalUnknownArtifact } from '../tools/oracle-lab/phase3a/tier-a-rerun-terminal-unknown.js'
import { canonicalJson, Phase3AError, sha256Bytes } from '../tools/oracle-lab/phase3a/core.js'
import { cellCommandDigest } from '../tools/oracle-lab/phase3a/run-cell.js'

console.log('\ntests/oracle-phase3a-tier-a-rerun-terminal-unknown.test.ts')

const TARGETS = [
  { version: '2.1.214', pair: 'long-run', hypothesis: 'r3-214-otel-stream-restart-keepalive', rerunRoot: 'capsules/P3A-3/tier-a-dynamic-campaign-v6-rerun-214-long-run-restart' },
  { version: '2.1.214', pair: 'restart', hypothesis: 'r3-214-otel-stream-restart-keepalive', rerunRoot: 'capsules/P3A-3/tier-a-dynamic-campaign-v6-rerun-214-long-run-restart' },
  { version: '2.1.212', pair: 'restart', hypothesis: 'r3-212-lineage-restart-otel-cache', rerunRoot: 'capsules/P3A-3/tier-a-dynamic-campaign-v6-rerun-212-restart' },
  { version: '2.1.211', pair: 'base-url-background-restart', hypothesis: 'r3-211-baseurl-restart-cache', rerunRoot: 'capsules/P3A-3/tier-a-dynamic-campaign-v6-rerun-211-base-url-background-restart' },
] as const

type Fixture = { root: string; targetRerunRoots: Array<{ version: string; required_pair: string; rerun_root: string }>; out: string; firstResult: string }

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, `${canonicalJson(value)}\n`, { mode: 0o600 })
}

function legacyManifest(runId: string): Record<string, unknown> {
  const sha = 'a'.repeat(64)
  const commit = 'b'.repeat(40)
  return {
    schema_version: 'oracle-lab-phase3a-launch-manifest.v1', run_id: runId, parent_run_id: null, pair_id: 'legacy-rerun-pair', sequence_index: 0, randomization_seed: 7,
    phase: '3A', requirement_ids: ['HA-P1-001'], hypothesis_id: 'legacy-rerun-hypothesis', evidence_level_ceiling: 'Observed',
    repositories: { cc_gateway: { commit, tree: commit, dirty_digest: sha }, sub2api: { commit, tree: commit, dirty_digest: sha } },
    contract: { bundle_id: 'oracle.compatibility.v1', bundle_sha256: sha, schema_range: '1:0-0', predecessor_sha256: sha },
    artifact: { package: '@anthropic-ai/claude-code', version: '2.1.215', registry_url: 'https://registry.npmjs.org/', archive_sha256: sha, tree_sha256: sha, entrypoint_sha256: sha },
    toolchain_digest: sha, platform: { os: 'darwin', release: 'test', arch: 'arm64', runtime: 'native', virtualization: 'synthetic-test' },
    command: { executable_sha256: sha, argv: ['--synthetic'], cwd: `runs/${runId}/cwd`, stdin_sha256: sha, timeout_ms: 1000 },
    environment: { allowlist: { PATH: '/usr/bin:/bin' }, explicit_empty: [], unset: ['ANTHROPIC_API_KEY'], home: `runs/${runId}/home`, xdg: `runs/${runId}/xdg`, tmp: `runs/${runId}/tmp`, tz: 'UTC', lang: 'C', lc_all: 'C', base_urls: ['http://127.0.0.1:19001/'] },
    network: { policy: 'declared_loopback_only', loopback_ports: [19001], proxy_mode: 'none', ca_sha256: null, external_socket_budget: 0 },
    matrix: { changed_variable: 'TZ', control_value: 'UTC', treatment_value: 'Asia/Shanghai', fixed_variables: { locale: 'C' } },
    limits: { wall_ms: 1000, cpu_ms: 1000, rss_bytes: 64 * 1024 * 1024, output_bytes: 64 * 1024, processes: 2, retries: 0, sockets: 2, files: 32 },
    capture: { hook: false, inspector: false, process: true, fs: true, network: true, tls: false, http: true, pcap: false, stdout: true, stderr: true },
    redaction_policy: 'oracle-lab-phase3a-redaction.v1', retention_class: 'synthetic-raw-14d', expiry: '2026-08-03T00:00:00.000Z', previous_manifest_sha256: null,
    preflight: { status: 'PASS', cc_head: commit, cc_tree: commit, sub2api_head: commit, sub2api_tree: commit, plan_sha256: sha, p2_bundle_sha256: sha, predecessor_sha256: sha, codegraph_current: true },
  }
}

function makeFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tier-a-rerun-terminal-unknown-'))
  const reruns = new Map<string, typeof TARGETS[number][]>()
  for (const target of TARGETS) reruns.set(target.rerunRoot, [...(reruns.get(target.rerunRoot) ?? []), target])

  let firstResult = ''
  for (const [rerunRoot, targets] of reruns) {
    const lanes = new Map<string, typeof TARGETS[number][]>()
    for (const target of targets) lanes.set(target.version, [...(lanes.get(target.version) ?? []), target])
    writeJson(path.join(root, rerunRoot, 'summary.json'), {
      schema_version: 'oracle-lab-phase3a-tier-a-dynamic-campaign.v1', campaign_id: path.basename(rerunRoot), active_version: '2.1.215',
      lane_count: lanes.size, external_socket_budget: 0, raw_material_persisted: false,
      lanes: [...lanes.entries()].map(([version, selected]) => ({ version, selected_pairs: selected.map((target) => target.pair) })),
    })
    for (const [version, targets] of lanes) {
      writeJson(path.join(root, rerunRoot, 'lanes', version, 'summary.json'), {
        schema_version: 'oracle-lab-phase3a-tier-a-lane-summary.v1', version, role: 'tier-a',
        hypothesis_id: targets[0].hypothesis, selected_pairs: targets.map((target) => target.pair),
        external_socket_budget: 0, raw_material_persisted: false,
      })
      for (const [pairIndex, target] of targets.entries()) {
        const pairRoot = path.join(root, rerunRoot, 'lanes', version, 'pairs', `${String(pairIndex).padStart(2, '0')}-${target.pair}`)
        const runs = ['control', 'treatment'].flatMap((arm) => Array.from({ length: 5 }, (_, repetition) => ({
          run_id: `rerun-${version}-${target.pair}-${arm}-${repetition}`, arm, repetition, status: 'complete',
        })))
        writeJson(path.join(pairRoot, 'summary.json'), {
          schema_version: 'oracle-lab-phase3a-tier-a-pair-summary.v1', pair_id: `tier-a-${version}-${target.pair}`,
          required_pair: target.pair, version, hypothesis_id: target.hypothesis, repetitions: 5, status: 'REPRODUCED',
          runs, external_socket_budget: 0, raw_material_persisted: false,
        })
        for (const [index, run] of runs.entries()) {
          const resultPath = path.join(pairRoot, `r${String(run.repetition).padStart(2, '0')}`, run.arm, 'result.json')
          if (!firstResult) firstResult = resultPath
          writeJson(resultPath, {
            schema_version: 'oracle-lab-phase3a-cell-result.v1', run_id: run.run_id, status: 'complete', duration_ms: 100 + index,
            command_digest: sha256Bytes(canonicalJson({ executable_sha256: 'a'.repeat(64), argv: ['--bare', '--print'], arm: run.arm })),
            safe_diagnostic: { classification: 'no-diagnostic' }, safe_error_categories: [], safe_error_terms: [],
            process_samples: [{ pid: index + 1 }], raw_output_persisted: false,
          })
          writeFileSync(path.join(path.dirname(resultPath), 'manifest.json'), '{"raw_prompt":"builder-must-not-read-this"}\n', { mode: 0o600 })
        }
      }
    }
  }
  return {
    root,
    targetRerunRoots: TARGETS.map((target) => ({ version: target.version, required_pair: target.pair, rerun_root: target.rerunRoot })),
    out: path.join(root, 'capsules/P3A-3/tier-a-rerun-terminal-unknown-v1.json'),
    firstResult,
  }
}

function withFixture(run: (fixture: Fixture) => void): void {
  const fixture = makeFixture()
  try { run(fixture) } finally { rmSync(fixture.root, { recursive: true, force: true }) }
}

withFixture((fixture) => {
  const artifact = buildTierARerunTerminalUnknownArtifact({ evidence_root: fixture.root, target_rerun_roots: fixture.targetRerunRoots })
  assert.equal(artifact.schema_version, 'oracle-lab-phase3a-tier-a-rerun-terminal-unknown.v1')
  assert.equal(artifact.classification, 'TERMINAL_UNKNOWN')
  assert.equal(artifact.phase3b_usable, false)
  assert.deepEqual(artifact.pair_outcomes.map((row: any) => `${row.version}:${row.required_pair}`), TARGETS.map((target) => `${target.version}:${target.pair}`))
  assert.ok(artifact.pair_outcomes.every((row: any) => row.classification === 'TERMINAL_UNKNOWN' && row.phase3b_usable === false))
  assert.deepEqual(artifact.pair_outcomes[0].duration_stats, { count: 10, min_ms: 100, max_ms: 109, total_ms: 1045, mean_ms: 104.5 })
  assert.ok(artifact.pair_outcomes.every((row: any) => /^[a-f0-9]{64}$/.test(row.command_digest)))
  assert.ok(artifact.pair_outcomes.every((row: any) => row.searched_surfaces.includes('cell-result-command-digest') && row.capability_evidence.result_count === 10))
  assert.ok(artifact.pair_outcomes.every((row: any) => typeof row.next_action === 'string' && row.next_action.length > 0))
  assert.deepEqual(artifact.rerun_mappings.map((row: any) => `${row.target.version}:${row.target.required_pair}=${row.rerun_root}`), TARGETS.map((target) => `${target.version}:${target.pair}=${target.rerunRoot}`))
  const serialized = canonicalJson(artifact).toLowerCase()
  assert.equal(/\b(absent|reproduced)\b/.test(serialized), false)
  assert.equal(serialized.includes('builder-must-not-read-this'), false)
  const written = writeTierARerunTerminalUnknownArtifact({ evidence_root: fixture.root, target_rerun_roots: fixture.targetRerunRoots, out: path.relative(fixture.root, fixture.out) })
  assert.equal(written.sha256, sha256Bytes(readFileSync(fixture.out)))
  assert.throws(() => writeTierARerunTerminalUnknownArtifact({ evidence_root: fixture.root, target_rerun_roots: fixture.targetRerunRoots, out: path.relative(fixture.root, fixture.out) }), (error: unknown) => error instanceof Phase3AError && error.code === 'evidence_exists')
})

withFixture((fixture) => {
  const result = JSON.parse(readFileSync(fixture.firstResult, 'utf8')) as Record<string, unknown>
  delete result.command_digest
  writeJson(fixture.firstResult, result)
  assert.throws(() => buildTierARerunTerminalUnknownArtifact({ evidence_root: fixture.root, target_rerun_roots: fixture.targetRerunRoots }), (error: unknown) => error instanceof Phase3AError && error.code === 'tier_a_rerun_result_invalid')
})

withFixture((fixture) => {
  const result = JSON.parse(readFileSync(fixture.firstResult, 'utf8')) as Record<string, unknown>
  delete result.command_digest
  writeJson(fixture.firstResult, result)
  writeJson(path.join(path.dirname(fixture.firstResult), 'manifest.json'), legacyManifest(String(result.run_id)))
  assert.equal(buildTierARerunTerminalUnknownArtifact({ evidence_root: fixture.root, target_rerun_roots: fixture.targetRerunRoots }).pair_outcomes.length, TARGETS.length)
})

withFixture((fixture) => {
  assert.throws(() => buildTierARerunTerminalUnknownArtifact({ evidence_root: fixture.root, target_rerun_roots: fixture.targetRerunRoots.slice(1) }), (error: unknown) => error instanceof Phase3AError && error.code === 'tier_a_rerun_target_mapping_invalid')
  assert.throws(() => buildTierARerunTerminalUnknownArtifact({ evidence_root: fixture.root, target_rerun_roots: [...fixture.targetRerunRoots, { version: '2.1.215', required_pair: 'long-run', rerun_root: fixture.targetRerunRoots[0].rerun_root }] }), (error: unknown) => error instanceof Phase3AError && error.code === 'tier_a_rerun_target_mapping_invalid')
})

assert.deepEqual(parseTierARerunTerminalUnknownArgs([
  '--target-rerun-root', '2.1.214:long-run=capsules/P3A-3/tier-a-dynamic-campaign-v6-rerun-214-long-run-restart',
  '--target-rerun-root', '2.1.214:restart=capsules/P3A-3/tier-a-dynamic-campaign-v6-rerun-214-long-run-restart',
]).target_rerun_roots, [
  { version: '2.1.214', required_pair: 'long-run', rerun_root: 'capsules/P3A-3/tier-a-dynamic-campaign-v6-rerun-214-long-run-restart' },
  { version: '2.1.214', required_pair: 'restart', rerun_root: 'capsules/P3A-3/tier-a-dynamic-campaign-v6-rerun-214-long-run-restart' },
])
assert.throws(() => parseTierARerunTerminalUnknownArgs(['--unknown', 'x']), /unknown argument/)
assert.throws(() => parseTierARerunTerminalUnknownArgs(['--target-rerun-root', '2.1.214:long-run=a', '--target-rerun-root', '2.1.214:long-run=b']), /duplicate target mapping/)
const command = { executable_sha256: 'a'.repeat(64), argv: ['--bare', '--print'], cwd: 'runs/cwd', stdin_sha256: 'b'.repeat(64), timeout_ms: 60_000 }
assert.equal(cellCommandDigest({ command } as any), sha256Bytes(canonicalJson(command)))

console.log(JSON.stringify({ ok: true, cases: 20 }))
