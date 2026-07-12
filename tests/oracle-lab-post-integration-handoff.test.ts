import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { canonicalJson, digestFile, sha256 } from '../tools/oracle-lab/harness-core.js'
import {
  buildPostIntegrationHandoff,
  buildPostIntegrationReceipt,
  validatePostIntegrationHandoffValue,
  validatePostIntegrationReceiptArtifact,
  validatePostIntegrationReceiptValue,
  type PostIntegrationHandoff,
} from '../tools/oracle-lab/post-integration-handoff.js'
import { POST_INTEGRATION_BINDINGS, type PostIntegrationEntryManifest } from '../tools/oracle-lab/post-integration-entry.js'
import type { PostIntegrationContext } from '../tools/oracle-lab/post-integration-context.js'
import { postIntegrationCommandRecordDigest, postIntegrationCommandSetDigest, type PostIntegrationCommandResultSet } from '../tools/oracle-lab/post-integration-command-catalog.js'

const d = (character: string): string => `sha256:${character.repeat(64)}`
const h = (character: string): string => character.repeat(40)
const generatedAt = '2026-07-12T12:00:00.000Z'
const now = Date.parse('2026-07-12T12:30:00.000Z')

function validManifest(): PostIntegrationEntryManifest {
  const repository = (head: string, remoteUrl: string) => ({
    head, branch: 'main' as const, clean: true as const, dirty_digest: sha256(Buffer.alloc(0)),
    remote: { name: 'muqihang' as const, ref: 'refs/remotes/muqihang/main' as const, commit: head, url_digest: sha256(remoteUrl) },
  })
  const input = (file: string, character: string) => ({ path: file, digest: d(character) })
  return {
    schema_version: 1, entry_kind: 'post_integration_entry', generated_at: generatedAt, expires_at: '2026-07-13T12:00:00.000Z',
    repositories: { cc_gateway: repository(POST_INTEGRATION_BINDINGS.ccGatewayHead, POST_INTEGRATION_BINDINGS.ccGatewayRemoteUrl), sub2api: repository(POST_INTEGRATION_BINDINGS.sub2apiHead, POST_INTEGRATION_BINDINGS.sub2apiRemoteUrl) },
    contract: { repository: 'sub2api', repository_relative_path: POST_INTEGRATION_BINDINGS.contractRelativePath, sha256: `sha256:${POST_INTEGRATION_BINDINGS.contractSha256}` },
    governance: { requirement_registry: `sha256:${POST_INTEGRATION_BINDINGS.requirementRegistrySha256}`, claim_registry: `sha256:${POST_INTEGRATION_BINDINGS.claimRegistrySha256}`, roadmap: `sha256:${POST_INTEGRATION_BINDINGS.roadmapSha256}` },
    phase_zero_exit: { receipt_path: POST_INTEGRATION_BINDINGS.exitReceiptRelativePath, receipt_digest: `sha256:${POST_INTEGRATION_BINDINGS.exitReceiptSha256}`, handoff_commit: POST_INTEGRATION_BINDINGS.handoffCommit, handoff_is_ancestor_of_integrated_cc_gateway: true },
    capture_inputs: {
      reviewed_tool_head: h('9'),
      manifest_schema: input('docs/superpowers/schemas/oracle-lab-post-integration-entry.schema.json', '1'),
      context_schema: input('docs/superpowers/schemas/oracle-lab-post-integration-context.schema.json', '2'),
      results_schema: input('docs/superpowers/schemas/oracle-lab-post-integration-command-results.schema.json', '3'),
      catalog_schema: input('docs/superpowers/schemas/oracle-lab-post-integration-command-catalog.schema.json', '4'),
      handoff_schema: input('docs/superpowers/schemas/oracle-lab-post-integration-handoff.schema.json', '5'),
      receipt_schema: input('docs/superpowers/schemas/oracle-lab-post-integration-receipt.schema.json', '6'),
      capture_tool: input('tools/oracle-lab/post-integration-entry.ts', '7'),
      context_tool: input('tools/oracle-lab/post-integration-context.ts', '8'),
      catalog_tool: input('tools/oracle-lab/post-integration-command-catalog.ts', '9'),
      binder_tool: input('tools/oracle-lab/post-integration-handoff.ts', 'a'),
      command_catalog: input('docs/superpowers/registry/oracle-lab-post-integration-command-catalog.json', 'b'),
    },
    runtime: { node: d('c'), npm: d('d'), git: d('e'), go: d('f'), environment: d('0') },
    disabled_capabilities: [...POST_INTEGRATION_BINDINGS.disabledCapabilities], next_phase_gates: [...POST_INTEGRATION_BINDINGS.nextPhaseGates],
  }
}

function validResults(manifestDigest: string): PostIntegrationCommandResultSet {
  const records = ['cc-build', 'cc-test', 'sidecar-test', 'sub2api-test', 'cc-b4-b6-red', 'sidecar-b4-b6-red', 'sub2api-b1-b3-red'].map((command_id, index) => {
    const unsigned = { command_id, repository: command_id.startsWith('sub2api') ? 'sub2api' as const : 'cc-gateway' as const,
    repository_commit: command_id.startsWith('sub2api') ? POST_INTEGRATION_BINDINGS.sub2apiHead : POST_INTEGRATION_BINDINGS.ccGatewayHead,
    ...(command_id.startsWith('sub2api') ? { contract_digest: `sha256:${POST_INTEGRATION_BINDINGS.contractSha256}` } : {}),
    manifest_digest: manifestDigest, environment_digest: d(String(index + 1)), exit_code: command_id.includes('red') ? 1 : 0,
    expected_exit: command_id.includes('red') ? 'nonzero' as const : 0 as const,
    status: command_id.includes('red') ? 'expected_fail' as const : 'pass' as const,
    output_digest: d(String(index + 2)) }
    return { ...unsigned, duration_ms: 1, result_digest: postIntegrationCommandRecordDigest(unsigned) }
  })
  const unsigned = { schema_version: 1 as const, generated_at: generatedAt, expires_at: '2026-07-19T12:00:00.000Z', catalog_digest: d('b'), manifest_digest: manifestDigest, records }
  return { ...unsigned, result_set_digest: postIntegrationCommandSetDigest(unsigned) }
}

function validContext(manifestDigest: string, results: PostIntegrationCommandResultSet): PostIntegrationContext {
  return {
    schema_version: 1, context_kind: 'post_integration_context', generated_at: generatedAt, expires_at: '2026-07-13T12:00:00.000Z',
    manifest_digest: manifestDigest, command_results_digest: results.result_set_digest,
    registry_digest: `sha256:${POST_INTEGRATION_BINDINGS.requirementRegistrySha256}`, claims_digest: `sha256:${POST_INTEGRATION_BINDINGS.claimRegistrySha256}`,
    repositories: [{ name: 'cc_gateway', commit: POST_INTEGRATION_BINDINGS.ccGatewayHead, remote_ref: 'refs/remotes/muqihang/main' }, { name: 'sub2api', commit: POST_INTEGRATION_BINDINGS.sub2apiHead, remote_ref: 'refs/remotes/muqihang/main' }],
    command_evidence: results.records.map(({ command_id, status, result_digest }) => ({ command_id, status: status as 'pass' | 'expected_fail', result_digest })).sort((a, b) => a.command_id.localeCompare(b.command_id)),
    disabled_capabilities: [...POST_INTEGRATION_BINDINGS.disabledCapabilities], next_phase_gates: [...POST_INTEGRATION_BINDINGS.nextPhaseGates],
  }
}

async function writeInputs(root: string) {
  const manifestPath = path.join(root, 'post-integration-entry.json')
  const resultsPath = path.join(root, 'post-integration-command-results.json')
  const contextPath = path.join(root, 'post-integration-context.json')
  const exitReceiptPath = path.join(root, 'phase-0-exit-receipt.json')
  const manifest = validManifest()
  const manifestDigest = sha256(`${canonicalJson(manifest)}\n`)
  const results = validResults(manifestDigest)
  const context = validContext(manifestDigest, results)
  await writeFile(manifestPath, `${canonicalJson(manifest)}\n`)
  await writeFile(resultsPath, `${canonicalJson(results)}\n`)
  await writeFile(contextPath, `${canonicalJson(context)}\n`)
  await writeFile(exitReceiptPath, await readFile(POST_INTEGRATION_BINDINGS.exitReceiptRelativePath))
  return { manifestPath, resultsPath, contextPath, exitReceiptPath, manifest, results, context }
}

test('post-integration handoff and receipt schemas are dedicated and fail closed', async () => {
  for (const file of ['docs/superpowers/schemas/oracle-lab-post-integration-handoff.schema.json', 'docs/superpowers/schemas/oracle-lab-post-integration-receipt.schema.json']) {
    const schema = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    assert.equal(schema.additionalProperties, false)
    assert.doesNotMatch(JSON.stringify(schema), /phase_0_entry|phase_0_exit_receipt_kind/)
  }
  const root = await mkdtemp(path.join(tmpdir(), 'oracle-pi-handoff-'))
  const inputs = await writeInputs(root)
  const handoff = buildPostIntegrationHandoff({ ...inputs, generatedAt })
  assert.equal(validatePostIntegrationHandoffValue({ ...handoff, surprise: true }, now).errors[0].code, 'unknown_field')
})

test('handoff binds exact manifest, complete results, context, exit receipt, tool, repositories, safety, and gates', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oracle-pi-handoff-'))
  const inputs = await writeInputs(root)
  const handoff = buildPostIntegrationHandoff({ ...inputs, generatedAt })
  assert.equal(handoff.handoff_kind, 'post_integration_handoff')
  assert.equal(handoff.entry_manifest.digest, digestFile(inputs.manifestPath))
  assert.equal(handoff.command_results.digest, digestFile(inputs.resultsPath))
  assert.equal(handoff.context.digest, digestFile(inputs.contextPath))
  assert.equal(handoff.phase_zero_exit.receipt_digest, digestFile(inputs.exitReceiptPath))
  assert.equal(handoff.reviewed_tool_head, inputs.manifest.capture_inputs.reviewed_tool_head)
  assert.deepEqual(handoff.disabled_capabilities, POST_INTEGRATION_BINDINGS.disabledCapabilities)
  assert.deepEqual(handoff.next_phase_gates, POST_INTEGRATION_BINDINGS.nextPhaseGates)
  assert.equal(validatePostIntegrationHandoffValue(handoff, now).ok, true)

  const crossManifest = structuredClone(handoff); crossManifest.context.manifest_digest = d('f')
  assert(validatePostIntegrationHandoffValue(crossManifest, now).errors.some((error) => error.code === 'cross_manifest_handoff'))
  const unsafe = { ...handoff, note: 'Authorization: Bearer secret-value' }
  assert(validatePostIntegrationHandoffValue(unsafe, now).errors.some((error) => error.code === 'unsafe_artifact'))
  assert(validatePostIntegrationHandoffValue(handoff, Date.parse(handoff.expires_at) + 1).errors.some((error) => error.code === 'expired_post_integration_handoff'))
})

function git(root: string, ...args: string[]): string { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim() }

test('receipt proves exact committed bytes and rejects changed, missing, uncommitted, and non-ancestor artifacts', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'oracle-pi-receipt-'))
  const root = path.join(parent, 'repository')
  execFileSync('git', ['clone', '--shared', process.cwd(), root], { stdio: 'ignore' })
  git(root, 'config', 'user.email', 'oracle@example.invalid'); git(root, 'config', 'user.name', 'Oracle Test')
  const inputs = await writeInputs(root)
  const capturePaths = Object.values(inputs.manifest.capture_inputs).filter((value): value is { path: string; digest: string } => typeof value === 'object')
  for (const binding of capturePaths) {
    const destination = path.join(root, binding.path)
    await mkdir(path.dirname(destination), { recursive: true })
    await copyFile(path.join(process.cwd(), binding.path), destination)
    binding.digest = digestFile(destination)
    git(root, 'add', binding.path)
  }
  git(root, 'commit', '--allow-empty', '-m', 'tool')
  const reviewedToolHead = git(root, 'rev-parse', 'HEAD')
  inputs.manifest.capture_inputs.reviewed_tool_head = reviewedToolHead
  await writeFile(inputs.manifestPath, `${canonicalJson(inputs.manifest)}\n`)
  inputs.results = validResults(digestFile(inputs.manifestPath)); inputs.context = validContext(digestFile(inputs.manifestPath), inputs.results)
  await writeFile(inputs.resultsPath, `${canonicalJson(inputs.results)}\n`); await writeFile(inputs.contextPath, `${canonicalJson(inputs.context)}\n`)
  const fixedHandoff = buildPostIntegrationHandoff({ ...inputs, generatedAt })
  const handoffPath = path.join(root, 'post-integration-handoff.json')
  await writeFile(handoffPath, `${canonicalJson(fixedHandoff)}\n`)
  git(root, 'add', '.'); git(root, 'commit', '-m', 'artifacts')
  const artifactCommit = git(root, 'rev-parse', 'HEAD')

  const receipt = buildPostIntegrationReceipt({ root, artifactCommit, manifestPath: inputs.manifestPath, resultsPath: inputs.resultsPath, contextPath: inputs.contextPath, handoffPath, generatedAt })
  assert.equal(validatePostIntegrationReceiptValue(receipt).ok, true)
  assert(validatePostIntegrationReceiptValue({ ...receipt, unknown: true }).errors.some((error) => error.code === 'unknown_field'))
  validatePostIntegrationReceiptArtifact(receipt, { root, manifestPath: inputs.manifestPath, resultsPath: inputs.resultsPath, contextPath: inputs.contextPath, handoffPath, now })
  assert.throws(() => validatePostIntegrationReceiptArtifact(receipt, { root, manifestPath: inputs.manifestPath, resultsPath: inputs.resultsPath, contextPath: inputs.contextPath, handoffPath, now: Date.parse(fixedHandoff.expires_at) + 1 }), (error: Error & { code?: string }) => (error.code ?? '').startsWith('expired_'))

  assert.throws(() => buildPostIntegrationReceipt({ root, artifactCommit, manifestPath: inputs.manifestPath, resultsPath: inputs.resultsPath, contextPath: path.join(root, 'missing.json'), handoffPath, generatedAt }), (error: Error & { code?: string }) => error.code === 'missing_artifact')
  await writeFile(path.join(root, 'uncommitted.txt'), 'not evidence\n')
  assert.throws(() => buildPostIntegrationReceipt({ root, artifactCommit, manifestPath: inputs.manifestPath, resultsPath: inputs.resultsPath, contextPath: inputs.contextPath, handoffPath, generatedAt }), (error: Error & { code?: string }) => error.code === 'uncommitted_artifact')
  git(root, 'add', 'uncommitted.txt'); git(root, 'commit', '-m', 'unrelated committed file')

  await writeFile(inputs.contextPath, '{}\n')
  assert.throws(() => validatePostIntegrationReceiptArtifact(receipt, { root, manifestPath: inputs.manifestPath, resultsPath: inputs.resultsPath, contextPath: inputs.contextPath, handoffPath, now }), (error: Error & { code?: string }) => error.code === 'artifact_digest_mismatch')
  git(root, 'add', inputs.contextPath); git(root, 'commit', '-m', 'changed')
  assert.throws(() => buildPostIntegrationReceipt({ root, artifactCommit: git(root, 'rev-parse', 'HEAD'), manifestPath: inputs.manifestPath, resultsPath: inputs.resultsPath, contextPath: inputs.contextPath, handoffPath, generatedAt }), (error: Error & { code?: string }) => ['cross_manifest_handoff', 'invalid_context_kind', 'missing_field', 'artifact_digest_mismatch'].includes(error.code ?? ''))

  const sibling = git(root, 'commit-tree', git(root, 'rev-parse', `${artifactCommit}^{tree}`), '-m', 'sibling')
  assert.throws(() => validatePostIntegrationReceiptArtifact(receipt, { root, artifactCommit: sibling, manifestPath: inputs.manifestPath, resultsPath: inputs.resultsPath, contextPath: inputs.contextPath, handoffPath, now }), (error: Error & { code?: string }) => error.code === 'non_ancestor_artifact_commit')
})
