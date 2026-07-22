import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { artifactRow, buildArtifactIndex, verifyArtifactIndex } from '../tools/oracle-lab/phase3a/artifact-index.js'
import { artifactSetDigest, assertAppendOnlyArtifactRows, parseTerminalIndexArgs, terminalArtifactInputs } from '../tools/oracle-lab/phase3a/build-terminal-index.js'
import { expectedAuthoritativeC4RunIds } from '../tools/oracle-lab/phase3a/c4-evidence.js'
import { Phase3AError } from '../tools/oracle-lab/phase3a/core.js'

console.log('\ntests/oracle-phase3a-evidence-root.test.ts')

const root = mkdtempSync(path.join(tmpdir(), 'phase3a-root-'))
mkdirSync(path.join(root, 'safe'))
writeFileSync(path.join(root, 'safe', 'artifact.json'), '{}\n')
const base = { artifact_id: 'a-1', relative_path: 'safe/artifact.json', media_type: 'application/json', source_url: null, scope: 'P3A-0', requirement_ids: ['HA-P0-007'], sensitivity: 'normalized-safe' as const, redaction_transform: 'none', retention_class: 'normalized-until-phase3b' as const, expiry: '2026-08-03T00:00:00.000Z', disposition: 'retain' as const, parser_name: 'test', parser_version: 'v1', parser_agreement: 'agreed' as const }
const context = { evidenceRoot: root, toolchainDigest: 'a'.repeat(64), commandDigest: 'b'.repeat(64), verificationDigest: 'c'.repeat(64) }
assert.equal(artifactRow(base, context).byte_size, 3)
assert.throws(() => artifactRow({ ...base, relative_path: '../escape' }, context), (error: unknown) => error instanceof Phase3AError && error.code === 'path_outside_evidence_root')
const index: any = buildArtifactIndex({ evidenceRoot: root, evidenceRootId: 'test-root', generatedAt: '2026-07-20T00:00:00.000Z', previousIndexSha256: null, toolchainDigest: 'a'.repeat(64), artifacts: [base] })
verifyArtifactIndex(index, root)
writeFileSync(path.join(root, 'safe', 'artifact.json'), '{"changed":true}\n')
assert.throws(() => verifyArtifactIndex(index, root), (error: unknown) => error instanceof Phase3AError && error.code === 'artifact_hash_mismatch')

const parent = { ...base, artifact_id: 'parent' }
const child = { ...base, artifact_id: 'child', parent_artifact_ids: ['parent'] }
assert.equal((buildArtifactIndex({ evidenceRoot: root, evidenceRootId: 'test-root', generatedAt: '2026-07-20T00:00:00.000Z', previousIndexSha256: null, toolchainDigest: 'a'.repeat(64), artifacts: [child, parent] }) as any).artifacts.length, 2)
assert.throws(
  () => buildArtifactIndex({ evidenceRoot: root, evidenceRootId: 'test-root', generatedAt: '2026-07-20T00:00:00.000Z', previousIndexSha256: null, toolchainDigest: 'a'.repeat(64), artifacts: [{ ...parent, parent_artifact_ids: ['child'] }, child] }),
  (error: unknown) => error instanceof Phase3AError && error.code === 'artifact_parent_cycle',
)
assert.throws(
  () => buildArtifactIndex({ evidenceRoot: root, evidenceRootId: 'test-root', generatedAt: '2026-07-20T00:00:00.000Z', previousIndexSha256: null, toolchainDigest: 'a'.repeat(64), artifacts: [{ ...parent, parent_artifact_ids: ['parent'] }] }),
  (error: unknown) => error instanceof Phase3AError && error.code === 'artifact_parent_cycle',
)
const aggregateRows = [{ artifact_id: 'b', sha256: 'b'.repeat(64), byte_size: 2, parent_artifact_ids: ['a'], sensitivity: 'normalized-safe' }, { artifact_id: 'a', sha256: 'a'.repeat(64), byte_size: 1, parent_artifact_ids: [], sensitivity: 'normalized-safe' }]
assert.equal(artifactSetDigest(aggregateRows), artifactSetDigest([...aggregateRows].reverse()))
assert.notEqual(artifactSetDigest(aggregateRows), artifactSetDigest([{ ...aggregateRows[0], byte_size: 3 }, aggregateRows[1]]))

const c4Run = 'c4-tz-utc-shanghai-r00-control'
const c4Capsule = path.join(root, 'capsules/P3A-2', c4Run)
mkdirSync(c4Capsule, { recursive: true })
for (const name of ['manifest.json', 'guard.json', 'observer.json', 'result.json', 'summary.json']) writeFileSync(path.join(c4Capsule, name), '{}\n')
mkdirSync(path.join(root, 'normalized/P3A-2'), { recursive: true })
writeFileSync(path.join(root, 'normalized/P3A-2', `${c4Run}.json`), '{}\n')
mkdirSync(path.join(root, 'campaign/P3A-2/c4-tz-utc-shanghai'), { recursive: true })
writeFileSync(path.join(root, 'campaign/P3A-2/c4-tz-utc-shanghai/input.json'), '{}\n')
writeFileSync(path.join(root, 'campaign/P3A-2/c4-tz-utc-shanghai/result.json'), '{}\n')
assert.throws(() => terminalArtifactInputs(root), (error: unknown) => error instanceof Phase3AError && error.code === 'c4_evidence_incomplete')
const authoritativeC4RunIds = expectedAuthoritativeC4RunIds()
for (const runId of authoritativeC4RunIds) {
  const capsule = path.join(root, 'capsules/P3A-2', runId)
  mkdirSync(capsule, { recursive: true })
  for (const name of ['manifest.json', 'guard.json', 'observer.json', 'result.json', 'summary.json']) writeFileSync(path.join(capsule, name), '{}\n')
  writeFileSync(path.join(root, 'normalized/P3A-2', `${runId}.json`), '{}\n')
}
for (const pairId of [...new Set(authoritativeC4RunIds.map((id) => id.replace(/-r\d{2}-(?:control|treatment)$/, '')))]) {
  const campaign = path.join(root, 'campaign/P3A-2', pairId)
  mkdirSync(campaign, { recursive: true })
  writeFileSync(path.join(campaign, 'input.json'), '{}\n')
  writeFileSync(path.join(campaign, 'result.json'), '{}\n')
}
mkdirSync(path.join(root, 'capsules/P3A-0'), { recursive: true })
writeFileSync(path.join(root, 'capsules/P3A-0', 'artifact-index.json'), '{}\n')
mkdirSync(path.join(root, 'capsules/P3A-1'), { recursive: true })
writeFileSync(path.join(root, 'capsules/P3A-1', 'static-summary.json'), '{}\n')
writeFileSync(path.join(root, 'capsules/P3A-1', 'r1-static-closure-v1.json'), '{}\n')
for (const relative of [
  'static/90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58/inventory-v2.json',
  'static/90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58/bun-extract-a/extraction-index.json',
  'static/90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58/bun-extract-b/extraction-index.json',
]) {
  const file = path.join(root, relative)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, '{}\n')
}
writeFileSync(path.join(root, 'capsules/P3A-2', 'closure-r2-coverage-v7.json'), '{}\n')
for (const repair of [{ name: 'closure-r2-gap-repair-v1', cells: 3 }, { name: 'closure-r2-gap-update-repair-v5', cells: 1 }]) {
  for (let index = 0; index < repair.cells; index += 1) {
    const cell = path.join(root, 'capsules/P3A-2', repair.name, 'cells', String(index).padStart(2, '0'))
    mkdirSync(cell, { recursive: true })
    for (const file of ['manifest.json', 'guard.json', 'observer.json', 'result.json', 'summary.json', 'normalized.json']) writeFileSync(path.join(cell, file), '{}\n')
    if (repair.name === 'closure-r2-gap-update-repair-v5') {
      writeFileSync(path.join(cell, 'fixture-self-test.json'), '{}\n')
      writeFileSync(path.join(cell, 'update-proxy.json'), '{}\n')
    }
  }
  writeFileSync(path.join(root, 'capsules/P3A-2', repair.name, 'summary.json'), '{}\n')
}
writeFileSync(path.join(root, 'capsules/P3A-2', 'closure-r2-coverage-v8.json'), '{}\n')
mkdirSync(path.join(root, 'capsules/P3A-2', 'closure-r2-local-tls-connect-v1'), { recursive: true })
writeFileSync(path.join(root, 'capsules/P3A-2', 'closure-r2-local-tls-connect-v1', 'summary.json'), '{}\n')
writeFileSync(path.join(root, 'capsules/P3A-1', 'cross-platform-static-corroboration-v2.json'), '{}\n')
for (const relative of [
  'capsules/P3A-2/closure-r2-capability-probe-copy-v7/summary.json',
  'capsules/P3A-2/closure-r2-environment-matrix-closure-v1.json',
  'capsules/P3A-2/closure-r2-saturation-v1.json',
  'capsules/P3A-2/closure-r2-scenario-closure-v2.json',
  'capsules/P3A-2/closure-r2-config-precedence-v2/summary.json',
  'capsules/P3A-2/closure-r2-auth-lifecycle-v1/summary.json',
  'capsules/P3A-2/closure-r2-auth-coexistence-v2/summary.json',
  'capsules/P3A-2/closure-r2-environment-matrix-closure-v3.json',
]) {
  const file = path.join(root, relative)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, '{}\n')
}
for (const campaign of ['closure-r2-gap-campaign-v1', 'closure-r2-gap-campaign-v2']) {
  for (let index = 0; index < 5; index += 1) {
    const cell = path.join(root, 'capsules/P3A-2', campaign, 'cells', String(index).padStart(2, '0'))
    mkdirSync(cell, { recursive: true })
    for (const file of ['manifest.json', 'guard.json', 'observer.json', 'result.json', 'summary.json', 'normalized.json']) writeFileSync(path.join(cell, file), '{}\n')
  }
  writeFileSync(path.join(root, 'capsules/P3A-2', campaign, 'summary.json'), '{}\n')
}
mkdirSync(path.join(root, 'capsules/P3A-3'), { recursive: true })
for (const version of ['2.1.214', '2.1.212', '2.1.211', '2.1.208', '2.1.207']) {
  const projection = path.join(root, 'capsules/P3A-3', 'tier-a-dynamic-projections-v5', `tier-a-dynamic-projection-v5-${version}.json`)
  mkdirSync(path.dirname(projection), { recursive: true })
  writeFileSync(projection, '{}\n')
  const binding = path.join(root, 'capsules/P3A-3', 'tier-a-cell-bindings-v3', version, 'telemetry', 'r00-control.json')
  mkdirSync(path.dirname(binding), { recursive: true })
  writeFileSync(binding, '{}\n')
}
writeFileSync(path.join(root, 'capsules/P3A-3', 'closure-r3-tier-a-v11.json'), '{}\n')
writeFileSync(path.join(root, 'capsules/P3A-3', 'tier-a-rerun-terminal-unknown-v1.json'), '{}\n')
const rerunSource = path.join(root, 'capsules/P3A-3', 'tier-a-dynamic-campaign-v6-rerun-214-long-run-restart')
mkdirSync(path.join(rerunSource, 'lanes/2.1.214/pairs/00-long-run/r00/control'), { recursive: true })
for (const relative of ['summary.json', 'lanes/2.1.214/summary.json', 'lanes/2.1.214/pairs/00-long-run/summary.json', 'lanes/2.1.214/pairs/00-long-run/r00/control/manifest.json', 'lanes/2.1.214/pairs/00-long-run/r00/control/result.json']) writeFileSync(path.join(rerunSource, relative), '{}\n')
for (const relative of ['intake/artifact-index.json', 'intake/release/2.1.215/artifact.json']) {
  const file = path.join(root, relative)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, '{}\n')
}
const terminalInputs = terminalArtifactInputs(root)
const terminalIds = terminalInputs.map((row) => row.artifact_id)
assert.ok(terminalIds.includes(`p3a2-${c4Run}-manifest`))
assert.ok(terminalIds.includes(`p3a2-${c4Run}-normalized`))
assert.ok(terminalIds.includes('p3a2-c4-tz-utc-shanghai-campaign-input'))
assert.ok(terminalIds.includes('p3a2-c4-tz-utc-shanghai-campaign-result'))
assert.ok(terminalIds.includes('p3a1-r1-static-closure'))
assert.ok(terminalIds.includes('p3a2-gap-repair-v1-cell-01-result'))
assert.ok(terminalIds.includes('p3a2-gap-update-repair-v5-cell-00-update-proxy'))
assert.ok(terminalIds.includes('p3a2-closure-coverage-v8'))
assert.ok(terminalIds.includes('p3a3-tier-a-projection-v5-2.1.214'))
assert.ok(terminalIds.some((id) => id.startsWith('p3a3-tier-a-binding-v3-2.1.214-')))
assert.ok(terminalIds.includes('p3a3-closure-tier-a-v11'))
assert.ok(terminalIds.includes('p3a3-tier-a-rerun-terminal-unknown-v1'))
assert.ok(terminalInputs.some((row) => row.relative_path === 'capsules/P3A-3/tier-a-dynamic-campaign-v6-rerun-214-long-run-restart/lanes/2.1.214/pairs/00-long-run/r00/control/result.json'))
assert.equal(terminalInputs.find((row) => row.relative_path === 'capsules/P3A-3/tier-a-dynamic-campaign-v6-rerun-214-long-run-restart/lanes/2.1.214/pairs/00-long-run/r00/control/result.json')?.sensitivity, 'quarantine')
assert.ok(terminalIds.includes('p3a2-local-tls-connect-v1'))
assert.ok(terminalIds.includes('p3a1-cross-platform-static-corroboration-v2'))
assert.doesNotThrow(() => buildArtifactIndex({ evidenceRoot: root, evidenceRootId: 'test-root', generatedAt: '2026-07-20T00:00:00.000Z', previousIndexSha256: null, toolchainDigest: 'a'.repeat(64), artifacts: terminalInputs }))
assert.doesNotThrow(() => assertAppendOnlyArtifactRows([{ artifact_id: 'a', relative_path: 'a.json', sha256: 'a', byte_size: 1 }], [{ artifact_id: 'a', relative_path: 'a.json', sha256: 'a', byte_size: 1 }, { artifact_id: 'b' }]))
assert.throws(() => assertAppendOnlyArtifactRows([{ artifact_id: 'a', relative_path: 'a.json', sha256: 'a', byte_size: 1 }], []), /row disappeared/)
assert.throws(() => assertAppendOnlyArtifactRows([{ artifact_id: 'a', relative_path: 'a.json', sha256: 'a', byte_size: 1, sensitivity: 'normalized-safe' }], [{ artifact_id: 'a', relative_path: 'a.json', sha256: 'a', byte_size: 1, sensitivity: 'quarantine' }]), /artifact row changed/)
const rerunSourceRow = { artifact_id: 'p3a3-tier-a-rerun-source-fixture', relative_path: 'capsules/P3A-3/rerun/result.json', sha256: 'a', byte_size: 1, sensitivity: 'normalized-safe', redaction_transform: 'phase3a-safe-summary-v1', retention_class: 'normalized-until-phase3b', disposition: 'retain', validation_status: 'valid' }
assert.doesNotThrow(() => assertAppendOnlyArtifactRows([rerunSourceRow], [{ ...rerunSourceRow, sensitivity: 'quarantine', redaction_transform: 'quarantine-unredacted-terminal-source', retention_class: 'quarantine-24h', disposition: 'quarantined', validation_status: 'quarantined' }]))
assert.throws(() => parseTerminalIndexArgs(['--out', '--previous-index']), /arguments must/)
assert.throws(() => parseTerminalIndexArgs(['--out', 'a', '--out', 'b']), /duplicate argument/)

console.log(JSON.stringify({ ok: true, cases: 28 }))
