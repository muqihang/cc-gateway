import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { buildArtifactIdentityGraph, discoverExecutionRunIds, rootExecutableDigest, verifyArtifactIdentityGraph } from '../tools/oracle-lab/phase3a/artifact-identity.js'
import { expectedAuthoritativeC4RunIds } from '../tools/oracle-lab/phase3a/c4-evidence.js'
import { canonicalJson, Phase3AError, sha256Bytes } from '../tools/oracle-lab/phase3a/core.js'

console.log('\ntests/oracle-phase3a-artifact-identity.test.ts')

const h = (character: string): string => character.repeat(64)
const intake = {
  schema_version: 'oracle-lab-phase3a-intake.v1',
  artifacts: [
    { artifact_id: 'claude-code-2.1.215-wrapper', kind: 'npm-wrapper', version: '2.1.215', source_url: 'https://registry.npmjs.org/wrapper.tgz', archive_sha256: h('a'), tree_sha256: h('b'), verification: { npm_integrity_match: true, lifecycle_scripts_executed: false, metadata_sha256: h('c'), independent_unpack_roots: 2, independent_inventory_match: true } },
    { artifact_id: 'claude-code-2.1.215-platform', kind: 'npm-platform', version: '2.1.215', source_url: 'https://registry.npmjs.org/platform.tgz', archive_sha256: h('d'), tree_sha256: h('e'), entrypoint_sha256: h('f'), verification: { npm_integrity_match: true, lifecycle_scripts_executed: false, metadata_sha256: h('1') } },
    { artifact_id: 'claude-code-2.1.215-github-release-darwin-arm64', kind: 'github-release', version: '2.1.215', source_url: 'https://github.com/anthropics/claude-code/releases/download/v2.1.215/claude.tar.gz', archive_sha256: h('2'), tree_sha256: h('3'), entrypoint_sha256: h('f'), verification: { shasums_match: true, lifecycle_scripts_executed: false, release_metadata_sha256: h('4'), shasums_sha256: h('5'), signature_sha256: h('6'), signature_verification: 'Unknown' } },
  ],
}
const staticSummary = { artifact_sha256: h('f'), signature: { verification_status: 'valid', authority: 'Developer ID Application: Anthropic PBC', identifier: 'com.anthropic.claude-code', team_identifier: 'TEAM', verify_command_sha256: h('7'), detail_command_sha256: h('8'), raw_command_output_persisted: false } }
const executions = [{ run_id: 'run-1', result_sha256: h('9'), executable_sha256: h('f'), external_socket_budget: 0, status: 'failed' }]

const first = buildArtifactIdentityGraph(intake, staticSummary, executions)
const second = buildArtifactIdentityGraph(intake, staticSummary, executions)
verifyArtifactIdentityGraph(first)
assert.equal(canonicalJson(first), canonicalJson(second))
assert.equal(first.aggregate_sha256, sha256Bytes(canonicalJson({ nodes: first.nodes, edges: first.edges })))
assert.equal(first.signature.release_detached_signature, 'Unknown')
assert.equal(first.signature.macos_code_signature, 'valid')
assert.ok(first.edges.some((edge) => edge.relation === 'executed-as'))

assert.throws(
  () => buildArtifactIdentityGraph({ ...intake, artifacts: intake.artifacts.map((artifact) => artifact.kind === 'npm-platform' ? { ...artifact, verification: { ...artifact.verification, npm_integrity_match: false } } : artifact) }, staticSummary, executions),
  (error: unknown) => error instanceof Phase3AError && error.code === 'artifact_identity_graph_invalid',
)

const evidenceRoot = mkdtempSync(path.join(tmpdir(), 'phase3a-identity-'))
const capsules = path.join(evidenceRoot, 'capsules/P3A-2')
for (const runId of ['active-baseline-002', 'c4-tz-utc-shanghai-r00-control', 'c4-locale-c-en-r11-treatment', 'c4-locale-c-zh-r07-control', 'c3-tz-utc-shanghai-r00-control']) {
  mkdirSync(path.join(capsules, runId), { recursive: true })
}
assert.throws(() => discoverExecutionRunIds(evidenceRoot), (error: unknown) => error instanceof Phase3AError && error.code === 'c4_evidence_incomplete')
for (const runId of expectedAuthoritativeC4RunIds()) mkdirSync(path.join(capsules, runId), { recursive: true })
assert.equal(discoverExecutionRunIds(evidenceRoot).length, 73)
const unexpectedRoot = mkdtempSync(path.join(tmpdir(), 'phase3a-identity-unexpected-'))
mkdirSync(path.join(unexpectedRoot, 'capsules/P3A-2/c4-tz-utc-shanghai-r12-control'), { recursive: true })
assert.throws(() => discoverExecutionRunIds(unexpectedRoot), (error: unknown) => error instanceof Phase3AError && error.code === 'c4_evidence_incomplete')
assert.equal(rootExecutableDigest({ process_samples: [{ executable_class: 'root', executable_sha256: h('f') }, { executable_class: 'root', executable_sha256: null }] }, 'run-with-exit-race'), h('f'))
assert.throws(
  () => rootExecutableDigest({ process_samples: [{ executable_class: 'root', executable_sha256: h('f') }, { executable_class: 'root', executable_sha256: h('e') }] }, 'run-with-drift'),
  (error: unknown) => error instanceof Phase3AError && error.code === 'artifact_identity_graph_invalid',
)
assert.throws(
  () => rootExecutableDigest({ process_samples: [{ executable_class: 'root', executable_sha256: h('f') }, { executable_class: 'root', executable_sha256: 'malformed' }] }, 'run-with-malformed-digest'),
  (error: unknown) => error instanceof Phase3AError && error.code === 'artifact_identity_graph_invalid',
)

console.log(JSON.stringify({ ok: true, nodes: first.nodes.length, edges: first.edges.length, execution_discovery: 73, root_identity_cases: 3 }))
