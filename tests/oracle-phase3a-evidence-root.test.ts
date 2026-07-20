import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { artifactRow, buildArtifactIndex, verifyArtifactIndex } from '../tools/oracle-lab/phase3a/artifact-index.js'
import { artifactSetDigest, terminalArtifactInputs } from '../tools/oracle-lab/phase3a/build-terminal-index.js'
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
for (const runId of expectedAuthoritativeC4RunIds()) mkdirSync(path.join(root, 'capsules/P3A-2', runId), { recursive: true })
const terminalIds = terminalArtifactInputs(root).map((row) => row.artifact_id)
assert.ok(terminalIds.includes(`p3a2-${c4Run}-manifest`))
assert.ok(terminalIds.includes(`p3a2-${c4Run}-normalized`))
assert.ok(terminalIds.includes('p3a2-c4-tz-utc-shanghai-campaign-input'))
assert.ok(terminalIds.includes('p3a2-c4-tz-utc-shanghai-campaign-result'))

console.log(JSON.stringify({ ok: true, cases: 14 }))
