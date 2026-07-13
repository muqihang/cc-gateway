import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { canonicalJson, digestFile, digestValue, readJson, sha256 } from '../tools/oracle-lab/harness-core.js'
import {
  POST_INTEGRATION_BINDINGS,
  assertContractBinding,
  assertHandoffAncestry,
  inspectIntegratedRepository,
  postIntegrationManifestDigest,
  validatePostIntegrationCaptureInputsAtToolRoot,
  validatePostIntegrationEntryValue,
  type PostIntegrationEntryManifest,
} from '../tools/oracle-lab/post-integration-entry.js'
import {
  buildPostIntegrationContext,
  validatePostIntegrationContextValue,
} from '../tools/oracle-lab/post-integration-context.js'
import {
  postIntegrationCommandRecordDigest,
  postIntegrationCommandEnvironment,
  postIntegrationTouchedRepositories,
  postIntegrationCommandSetDigest,
  runPostIntegrationCommandEntry,
  runPostIntegrationCommandCatalog,
  validatePostIntegrationCommandCatalogValue,
  validatePostIntegrationResultsBindings,
  type PostIntegrationCommandCatalogEntry,
  type PostIntegrationCommandResultSet,
} from '../tools/oracle-lab/post-integration-command-catalog.js'

const d = (character: string): string => `sha256:${character.repeat(64)}`
const h = (character: string): string => character.repeat(40)
const generatedAt = '2026-07-12T12:00:00.000Z'
const now = Date.parse('2026-07-12T12:30:00.000Z')

function validManifest(fixtureGeneratedAt = generatedAt): PostIntegrationEntryManifest {
  const generated = new Date(fixtureGeneratedAt)
  const repository = (head: string, remoteUrl: string) => ({
    head,
    branch: 'main' as const,
    clean: true as const,
    dirty_digest: sha256(Buffer.alloc(0)),
    remote: { name: 'muqihang' as const, ref: 'refs/remotes/muqihang/main' as const, commit: head, url_digest: sha256(remoteUrl) },
  })
  return {
    schema_version: 1,
    entry_kind: 'post_integration_entry',
    generated_at: generated.toISOString(),
    expires_at: new Date(generated.getTime() + 86_400_000).toISOString(),
    repositories: {
      cc_gateway: repository(POST_INTEGRATION_BINDINGS.ccGatewayHead, POST_INTEGRATION_BINDINGS.ccGatewayRemoteUrl),
      sub2api: repository(POST_INTEGRATION_BINDINGS.sub2apiHead, POST_INTEGRATION_BINDINGS.sub2apiRemoteUrl),
    },
    contract: {
      repository: 'sub2api',
      repository_relative_path: POST_INTEGRATION_BINDINGS.contractRelativePath,
      sha256: `sha256:${POST_INTEGRATION_BINDINGS.contractSha256}`,
    },
    governance: { requirement_registry: `sha256:${POST_INTEGRATION_BINDINGS.requirementRegistrySha256}`, claim_registry: `sha256:${POST_INTEGRATION_BINDINGS.claimRegistrySha256}`, roadmap: `sha256:${POST_INTEGRATION_BINDINGS.roadmapSha256}` },
    phase_zero_exit: {
      receipt_path: 'docs/superpowers/evidence/phase-0/phase-0-exit-receipt.json',
      receipt_digest: `sha256:${POST_INTEGRATION_BINDINGS.exitReceiptSha256}`,
      handoff_commit: POST_INTEGRATION_BINDINGS.handoffCommit,
      handoff_is_ancestor_of_integrated_cc_gateway: true,
    },
    capture_inputs: {
      reviewed_tool_head: h('9'),
      manifest_schema: { path: 'docs/superpowers/schemas/oracle-lab-post-integration-entry.schema.json', digest: d('4') },
      context_schema: { path: 'docs/superpowers/schemas/oracle-lab-post-integration-context.schema.json', digest: d('5') },
      results_schema: { path: 'docs/superpowers/schemas/oracle-lab-post-integration-command-results.schema.json', digest: d('6') },
      catalog_schema: { path: 'docs/superpowers/schemas/oracle-lab-post-integration-command-catalog.schema.json', digest: d('7') },
      handoff_schema: { path: 'docs/superpowers/schemas/oracle-lab-post-integration-handoff.schema.json', digest: d('1') },
      receipt_schema: { path: 'docs/superpowers/schemas/oracle-lab-post-integration-receipt.schema.json', digest: d('2') },
      capture_tool: { path: 'tools/oracle-lab/post-integration-entry.ts', digest: d('8') },
      context_tool: { path: 'tools/oracle-lab/post-integration-context.ts', digest: d('9') },
      catalog_tool: { path: 'tools/oracle-lab/post-integration-command-catalog.ts', digest: d('a') },
      binder_tool: { path: 'tools/oracle-lab/post-integration-handoff.ts', digest: d('3') },
      command_catalog: { path: 'docs/superpowers/registry/oracle-lab-post-integration-command-catalog.json', digest: d('b') },
    },
    runtime: { node: d('c'), npm: d('d'), git: d('e'), go: d('f'), environment: d('0') },
    disabled_capabilities: [...POST_INTEGRATION_BINDINGS.disabledCapabilities],
    next_phase_gates: [...POST_INTEGRATION_BINDINGS.nextPhaseGates],
  }
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
}

async function repositoryFixture(): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'oracle-post-integration-repo-'))
  git(root, 'init', '-b', 'main')
  git(root, 'config', 'user.email', 'oracle@example.invalid')
  git(root, 'config', 'user.name', 'Oracle Test')
  await writeFile(path.join(root, 'tracked.txt'), 'clean\n')
  git(root, 'add', 'tracked.txt')
  git(root, 'commit', '-m', 'fixture')
  const head = git(root, 'rev-parse', 'HEAD')
  git(root, 'remote', 'add', 'muqihang', 'https://example.invalid/oracle-fixture.git')
  git(root, 'update-ref', 'refs/remotes/muqihang/main', head)
  return { root, head }
}

test('post-integration schemas use a distinct fail-closed namespace', () => {
  for (const file of [
    'docs/superpowers/schemas/oracle-lab-post-integration-entry.schema.json',
    'docs/superpowers/schemas/oracle-lab-post-integration-context.schema.json',
    'docs/superpowers/schemas/oracle-lab-post-integration-command-catalog.schema.json',
    'docs/superpowers/schemas/oracle-lab-post-integration-command-results.schema.json',
    'docs/superpowers/schemas/oracle-lab-post-integration-handoff.schema.json',
    'docs/superpowers/schemas/oracle-lab-post-integration-receipt.schema.json',
  ]) {
    const schema = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    assert.equal(schema.additionalProperties, false)
    assert.doesNotMatch(JSON.stringify(schema), /phase_0_entry|phase_0_exit/)
  }
  const invalid = { ...validManifest(), entry_kind: 'phase_0_exit' }
  assert.equal(validatePostIntegrationEntryValue(invalid, now).ok, false)
})

test('dedicated command catalog binds all GREEN and RED commands to the new manifest', () => {
  const value = JSON.parse(readFileSync('docs/superpowers/registry/oracle-lab-post-integration-command-catalog.json', 'utf8')) as PostIntegrationCommandCatalogEntry[]
  assert.deepEqual(validatePostIntegrationCommandCatalogValue(value), { ok: true, errors: [] })
  assert.equal(POST_INTEGRATION_BINDINGS.ccGatewayHead, 'b38198763ab7e337321e3a0d9e545375d3fb3ad0')
  assert.equal(value.filter((entry) => entry.group === 'post-integration-green').length, 5)
  assert.equal(value.filter((entry) => entry.group === 'post-integration-red').length, 3)
  assert.equal(new Set(value.map((entry) => entry.id)).size, 8)
  const crossRepo = value.find((entry) => entry.id === 'cc-cross-repo-baseline')
  assert.deepEqual(crossRepo?.argv, ['npm', 'run', 'test:oracle:cross-repo'])
  assert.equal(crossRepo?.env.SUB2API_ROOT, '${SUB2API_ROOT}')
  assert(value.every((entry) => entry.manifest_binding.manifest_path === '${POST_INTEGRATION_MANIFEST}'))

  const missingRoot = structuredClone(value)
  delete missingRoot.find((entry) => entry.id === 'cc-cross-repo-baseline')!.env.SUB2API_ROOT
  assert(validatePostIntegrationCommandCatalogValue(missingRoot).errors.some((error) => error.code === 'invalid_cross_repo_command'))
  const wrongArgv = structuredClone(value)
  wrongArgv.find((entry) => entry.id === 'cc-cross-repo-baseline')!.argv = ['npm', 'test']
  assert(validatePostIntegrationCommandCatalogValue(wrongArgv).errors.some((error) => error.code === 'invalid_cross_repo_command'))
})

test('cross-repository command environment digest binds the explicit Sub2API capture root', () => {
  const entries = JSON.parse(readFileSync('docs/superpowers/registry/oracle-lab-post-integration-command-catalog.json', 'utf8')) as PostIntegrationCommandCatalogEntry[]
  const crossRepo = entries.find((entry) => entry.id === 'cc-cross-repo-baseline')!
  const baseRoots = { CC_GATEWAY_ROOT: '/capture/cc', TOOL_ROOT: '/capture/tool', POST_INTEGRATION_MANIFEST: '/capture/manifest.json' }
  const first = postIntegrationCommandEnvironment(crossRepo, { ...baseRoots, SUB2API_ROOT: '/capture/sub-a' }, {})
  const second = postIntegrationCommandEnvironment(crossRepo, { ...baseRoots, SUB2API_ROOT: '/capture/sub-b' }, {})
  assert.notEqual(sha256(canonicalJson(first)), sha256(canonicalJson(second)))
  assert.equal(first.SUB2API_ROOT, '/capture/sub-a')
  assert.deepEqual(postIntegrationTouchedRepositories(crossRepo), ['cc_gateway', 'sub2api'])
})

test('cross-repository runner rejects a command that changes the bound Sub2API repository', async () => {
  const cc = await repositoryFixture()
  const sub = await repositoryFixture()
  const temporary = await mkdtemp(path.join(tmpdir(), 'oracle-post-integration-cross-repo-'))
  const manifestPath = path.join(temporary, 'manifest.json')
  const manifest = validManifest(new Date().toISOString())
  const bindFixture = (fixture: { root: string; head: string }) => ({
    head: fixture.head,
    branch: 'main' as const,
    clean: true as const,
    dirty_digest: sha256(Buffer.alloc(0)),
    remote: {
      name: 'muqihang' as const,
      ref: 'refs/remotes/muqihang/main' as const,
      commit: fixture.head,
      url_digest: sha256(git(fixture.root, 'remote', 'get-url', 'muqihang')),
    },
  })
  manifest.repositories.cc_gateway = bindFixture(cc)
  manifest.repositories.sub2api = bindFixture(sub)
  manifest.contract.repository_relative_path = 'tracked.txt'
  manifest.contract.sha256 = digestFile(path.join(sub.root, 'tracked.txt'))
  await writeFile(manifestPath, `${canonicalJson(manifest)}\n`)

  const entries = JSON.parse(readFileSync('docs/superpowers/registry/oracle-lab-post-integration-command-catalog.json', 'utf8')) as PostIntegrationCommandCatalogEntry[]
  const crossRepo = structuredClone(entries.find((entry) => entry.id === 'cc-cross-repo-baseline')!)
  crossRepo.argv = [
    process.execPath,
    '-e',
    "require('node:fs').appendFileSync(process.env.SUB2API_ROOT + '/tracked.txt', 'drift\\n')",
  ]

  await assert.rejects(
    runPostIntegrationCommandEntry(crossRepo, manifest, {
      CC_GATEWAY_ROOT: cc.root,
      SUB2API_ROOT: sub.root,
      TOOL_ROOT: process.cwd(),
      POST_INTEGRATION_MANIFEST: manifestPath,
    }, digestFile(manifestPath)),
    (error: Error & { code?: string }) => error.code === 'worktree_delta_mismatch',
  )
})

test('cross-repository runner rejects a clean committed Sub2API HEAD change', async () => {
  const cc = await repositoryFixture()
  const sub = await repositoryFixture()
  const temporary = await mkdtemp(path.join(tmpdir(), 'oracle-post-integration-cross-repo-head-'))
  const manifestPath = path.join(temporary, 'manifest.json')
  const manifest = validManifest()
  const bindFixture = (fixture: { root: string; head: string }) => ({
    head: fixture.head,
    branch: 'main' as const,
    clean: true as const,
    dirty_digest: sha256(Buffer.alloc(0)),
    remote: {
      name: 'muqihang' as const,
      ref: 'refs/remotes/muqihang/main' as const,
      commit: fixture.head,
      url_digest: sha256(git(fixture.root, 'remote', 'get-url', 'muqihang')),
    },
  })
  manifest.repositories.cc_gateway = bindFixture(cc)
  manifest.repositories.sub2api = bindFixture(sub)
  manifest.contract.repository_relative_path = 'tracked.txt'
  manifest.contract.sha256 = digestFile(path.join(sub.root, 'tracked.txt'))
  await writeFile(manifestPath, `${canonicalJson(manifest)}\n`)

  const entries = JSON.parse(readFileSync('docs/superpowers/registry/oracle-lab-post-integration-command-catalog.json', 'utf8')) as PostIntegrationCommandCatalogEntry[]
  const crossRepo = structuredClone(entries.find((entry) => entry.id === 'cc-cross-repo-baseline')!)
  crossRepo.argv = [
    process.execPath,
    '-e',
    "const {appendFileSync}=require('node:fs');const {execFileSync}=require('node:child_process');const r=process.env.SUB2API_ROOT;appendFileSync(r+'/tracked.txt','committed drift\\n');execFileSync('git',['-C',r,'add','tracked.txt']);execFileSync('git',['-C',r,'commit','-m','fixture drift'])",
  ]

  await assert.rejects(
    runPostIntegrationCommandEntry(crossRepo, manifest, {
      CC_GATEWAY_ROOT: cc.root,
      SUB2API_ROOT: sub.root,
      TOOL_ROOT: process.cwd(),
      POST_INTEGRATION_MANIFEST: manifestPath,
    }, digestFile(manifestPath)),
    (error: Error & { code?: string }) => error.code === 'worktree_delta_mismatch',
  )
})

test('cross-repository runner rehashes a skip-worktree-hidden Sub2API contract change', async () => {
  const cc = await repositoryFixture()
  const sub = await repositoryFixture()
  const temporary = await mkdtemp(path.join(tmpdir(), 'oracle-post-integration-cross-repo-contract-'))
  const manifestPath = path.join(temporary, 'manifest.json')
  const manifest = validManifest()
  const bindFixture = (fixture: { root: string; head: string }) => ({
    head: fixture.head,
    branch: 'main' as const,
    clean: true as const,
    dirty_digest: sha256(Buffer.alloc(0)),
    remote: {
      name: 'muqihang' as const,
      ref: 'refs/remotes/muqihang/main' as const,
      commit: fixture.head,
      url_digest: sha256(git(fixture.root, 'remote', 'get-url', 'muqihang')),
    },
  })
  manifest.repositories.cc_gateway = bindFixture(cc)
  manifest.repositories.sub2api = bindFixture(sub)
  manifest.contract.repository_relative_path = 'tracked.txt'
  manifest.contract.sha256 = digestFile(path.join(sub.root, 'tracked.txt'))
  await writeFile(manifestPath, `${canonicalJson(manifest)}\n`)

  const entries = JSON.parse(readFileSync('docs/superpowers/registry/oracle-lab-post-integration-command-catalog.json', 'utf8')) as PostIntegrationCommandCatalogEntry[]
  const crossRepo = structuredClone(entries.find((entry) => entry.id === 'cc-cross-repo-baseline')!)
  crossRepo.argv = [
    process.execPath,
    '-e',
    "const {writeFileSync}=require('node:fs');const {execFileSync}=require('node:child_process');const r=process.env.SUB2API_ROOT;execFileSync('git',['-C',r,'update-index','--skip-worktree','tracked.txt']);writeFileSync(r+'/tracked.txt','hidden contract drift\\n')",
  ]

  await assert.rejects(
    runPostIntegrationCommandEntry(crossRepo, manifest, {
      CC_GATEWAY_ROOT: cc.root,
      SUB2API_ROOT: sub.root,
      TOOL_ROOT: process.cwd(),
      POST_INTEGRATION_MANIFEST: manifestPath,
    }, digestFile(manifestPath)),
    (error: Error & { code?: string }) => error.code === 'worktree_delta_mismatch',
  )
})

test('repository binding rejects wrong head, branch, remote ref, and dirty tree', async () => {
  const fixture = await repositoryFixture()
  assert.equal(inspectIntegratedRepository(fixture.root, { head: fixture.head, branch: 'main', remoteName: 'muqihang', remoteRef: 'refs/remotes/muqihang/main' }).head, fixture.head)
  assert.throws(() => inspectIntegratedRepository(fixture.root, { head: h('a'), branch: 'main', remoteName: 'muqihang', remoteRef: 'refs/remotes/muqihang/main' }), (error: Error & { code?: string }) => error.code === 'wrong_repository_head')
  git(fixture.root, 'switch', '-c', 'wrong-branch')
  assert.throws(() => inspectIntegratedRepository(fixture.root, { head: fixture.head, branch: 'main', remoteName: 'muqihang', remoteRef: 'refs/remotes/muqihang/main' }), (error: Error & { code?: string }) => error.code === 'wrong_repository_branch')
  git(fixture.root, 'switch', 'main')
  git(fixture.root, 'update-ref', '-d', 'refs/remotes/muqihang/main')
  assert.throws(() => inspectIntegratedRepository(fixture.root, { head: fixture.head, branch: 'main', remoteName: 'muqihang', remoteRef: 'refs/remotes/muqihang/main' }), (error: Error & { code?: string }) => error.code === 'wrong_remote_ref')
  git(fixture.root, 'update-ref', 'refs/remotes/muqihang/main', fixture.head)
  assert.throws(() => inspectIntegratedRepository(fixture.root, { head: fixture.head, branch: 'main', remoteName: 'muqihang', remoteRef: 'refs/remotes/muqihang/main', remoteUrlDigest: d('f') }), (error: Error & { code?: string }) => error.code === 'wrong_remote_ref')
  await writeFile(path.join(fixture.root, 'dirty.txt'), 'dirty\n')
  assert.throws(() => inspectIntegratedRepository(fixture.root, { head: fixture.head, branch: 'main', remoteName: 'muqihang', remoteRef: 'refs/remotes/muqihang/main' }), (error: Error & { code?: string }) => error.code === 'dirty_repository')
})

test('receipt, ancestry, contract, and unknown-field drift fail closed', async () => {
  const manifest = validManifest()
  const receiptDrift = structuredClone(manifest); receiptDrift.phase_zero_exit.receipt_digest = d('9')
  assert(validatePostIntegrationEntryValue(receiptDrift, now).errors.some((error) => error.code === 'exit_receipt_drift'))
  const missingAncestry = structuredClone(manifest) as unknown as Record<string, any>; missingAncestry.phase_zero_exit.handoff_is_ancestor_of_integrated_cc_gateway = false
  assert(validatePostIntegrationEntryValue(missingAncestry, now).errors.some((error) => error.code === 'missing_handoff_ancestry'))
  const unknown = { ...manifest, phase: 'phase_0_exit' }
  assert(validatePostIntegrationEntryValue(unknown, now).errors.some((error) => error.code === 'unknown_field'))

  const fixture = await repositoryFixture()
  await writeFile(path.join(fixture.root, 'contract.json'), '{}\n')
  assert.throws(() => assertContractBinding(path.join(fixture.root, 'contract.json'), d('f')), (error: Error & { code?: string }) => error.code === 'contract_drift')
  assert.throws(() => assertHandoffAncestry(fixture.root, h('f'), fixture.head), (error: Error & { code?: string }) => error.code === 'missing_handoff_ancestry')
})

test('entry validation rejects unsafe material and expired evidence', () => {
  const unsafe = structuredClone(validManifest()) as unknown as Record<string, unknown>
  unsafe.note = 'Authorization: Bearer secret-value'
  const validation = validatePostIntegrationEntryValue(unsafe, now)
  assert(validation.errors.some((error) => error.code === 'unsafe_artifact'))
  assert(validatePostIntegrationEntryValue(validManifest(), Date.parse('2026-07-13T12:00:00.001Z')).errors.some((error) => error.code === 'expired_post_integration_entry'))
})

function catalog(): PostIntegrationCommandCatalogEntry[] {
  return [{
    id: 'cc-build', schema_version: 1, group: 'post-integration-green', owner: 'release-engineering',
    requirement_ids: ['HA-P0-007'], repository: 'cc-gateway', cwd: '${CC_GATEWAY_ROOT}', argv: ['npm', 'run', 'build'],
    env: { CI: '1', POST_INTEGRATION_MANIFEST: '${POST_INTEGRATION_MANIFEST}' }, inherit_env: ['PATH', 'HOME', 'TMPDIR'],
    manifest_binding: { manifest_path: '${POST_INTEGRATION_MANIFEST}', repository_head_field: 'repositories.cc_gateway.head' },
    allowed_worktree_delta: [], timeout_ms: 300000, expected_exit: 0, output_policy: 'digest_only', rollback: 'rerun from the bound clean main',
  }]
}

function results(manifestDigest: string): PostIntegrationCommandResultSet {
  const unsignedRecord = {
    command_id: 'cc-build', repository: 'cc-gateway' as const, repository_commit: POST_INTEGRATION_BINDINGS.ccGatewayHead,
    manifest_digest: manifestDigest, environment_digest: d('1'), exit_code: 0, expected_exit: 0 as const, status: 'pass' as const,
    output_digest: d('2'),
  }
  const record = { ...unsignedRecord, duration_ms: 1, result_digest: postIntegrationCommandRecordDigest(unsignedRecord) }
  const unsigned = { schema_version: 1 as const, generated_at: generatedAt, expires_at: '2026-07-19T12:00:00.000Z', catalog_digest: d('3'), manifest_digest: manifestDigest, records: [record] }
  return { ...unsigned, result_set_digest: postIntegrationCommandSetDigest(unsigned) }
}

function completeResults(manifestDigest: string, entries: PostIntegrationCommandCatalogEntry[]): PostIntegrationCommandResultSet {
  const records = entries.map((entry, index) => {
    const expectedFail = entry.expected_exit === 'nonzero'
    const unsignedRecord = {
      command_id: entry.id,
      repository: entry.repository,
      repository_commit: entry.repository === 'sub2api' ? POST_INTEGRATION_BINDINGS.sub2apiHead : POST_INTEGRATION_BINDINGS.ccGatewayHead,
      ...(entry.repository === 'sub2api' ? { contract_digest: `sha256:${POST_INTEGRATION_BINDINGS.contractSha256}` } : {}),
      manifest_digest: manifestDigest,
      environment_digest: d(String((index + 1) % 10)),
      exit_code: expectedFail ? 1 : 0,
      expected_exit: entry.expected_exit,
      status: expectedFail ? 'expected_fail' as const : 'pass' as const,
      output_digest: d(String((index + 2) % 10)),
    }
    return { ...unsignedRecord, duration_ms: 1, result_digest: postIntegrationCommandRecordDigest(unsignedRecord) }
  })
  const unsigned = {
    schema_version: 1 as const,
    generated_at: generatedAt,
    expires_at: '2026-07-19T12:00:00.000Z',
    catalog_digest: digestFile('docs/superpowers/registry/oracle-lab-post-integration-command-catalog.json'),
    manifest_digest: manifestDigest,
    records,
  }
  return { ...unsigned, result_set_digest: postIntegrationCommandSetDigest(unsigned) }
}

test('command results cannot cross-bind manifests', () => {
  const manifest = validManifest()
  const manifestDigest = postIntegrationManifestDigest(manifest)
  const set = results(d('9'))
  const validation = validatePostIntegrationResultsBindings(set, catalog(), manifest, { catalogDigest: d('3'), manifestDigest, requireGroups: ['post-integration-green'] }, now)
  assert(validation.errors.some((error) => error.code === 'cross_manifest_results'))
})

test('context binds the new manifest and results, rejects cross-binding and expiry', () => {
  const manifest = validManifest()
  const entries = JSON.parse(readFileSync('docs/superpowers/registry/oracle-lab-post-integration-command-catalog.json', 'utf8')) as PostIntegrationCommandCatalogEntry[]
  const catalogDigest = digestFile('docs/superpowers/registry/oracle-lab-post-integration-command-catalog.json')
  manifest.capture_inputs.command_catalog.digest = catalogDigest
  const manifestDigest = postIntegrationManifestDigest(manifest)
  const set = completeResults(manifestDigest, entries)
  const context = buildPostIntegrationContext({ manifest, manifestDigest, results: set, catalog: entries, catalogDigest, registryDigest: manifest.governance.requirement_registry, claimsDigest: manifest.governance.claim_registry, generatedAt, validationNow: now })
  assert.equal(context.context_kind, 'post_integration_context')
  assert.equal(context.manifest_digest, manifestDigest)
  assert.equal(validatePostIntegrationContextValue(context, { manifestDigest, resultsDigest: set.result_set_digest }, now).ok, true)
  assert(validatePostIntegrationContextValue(context, { manifestDigest: d('f'), resultsDigest: set.result_set_digest }, now).errors.some((error) => error.code === 'cross_manifest_context'))
  assert(validatePostIntegrationContextValue(context, { manifestDigest, resultsDigest: set.result_set_digest }, Date.parse(context.expires_at) + 1).errors.some((error) => error.code === 'expired_post_integration_context'))
  assert.equal(digestValue(context).startsWith('sha256:'), true)
})

test('context builder requires the exact catalog and the complete five GREEN plus three RED results', () => {
  const manifest = validManifest()
  const entries = JSON.parse(readFileSync('docs/superpowers/registry/oracle-lab-post-integration-command-catalog.json', 'utf8')) as PostIntegrationCommandCatalogEntry[]
  const catalogDigest = digestFile('docs/superpowers/registry/oracle-lab-post-integration-command-catalog.json')
  manifest.capture_inputs.command_catalog.digest = catalogDigest
  const manifestDigest = postIntegrationManifestDigest(manifest)
  assert.throws(
    () => buildPostIntegrationContext({ manifest, manifestDigest, results: results(manifestDigest), catalog: entries, catalogDigest, registryDigest: manifest.governance.requirement_registry, claimsDigest: manifest.governance.claim_registry, generatedAt, validationNow: now }),
    (error: Error & { code?: string }) => error.code === 'incomplete_result_set',
  )
  const complete = completeResults(manifestDigest, entries)
  assert.throws(
    () => buildPostIntegrationContext({ manifest, manifestDigest, results: complete, catalog: entries, catalogDigest: d('f'), registryDigest: manifest.governance.requirement_registry, claimsDigest: manifest.governance.claim_registry, generatedAt, validationNow: now }),
    (error: Error & { code?: string }) => error.code === 'cross_catalog_results',
  )
})

test('context validator requires the exact integrated repository set and commits', () => {
  const manifest = validManifest()
  const entries = JSON.parse(readFileSync('docs/superpowers/registry/oracle-lab-post-integration-command-catalog.json', 'utf8')) as PostIntegrationCommandCatalogEntry[]
  manifest.capture_inputs.command_catalog.digest = digestFile('docs/superpowers/registry/oracle-lab-post-integration-command-catalog.json')
  const manifestDigest = postIntegrationManifestDigest(manifest)
  const set = completeResults(manifestDigest, entries)
  const context = buildPostIntegrationContext({ manifest, manifestDigest, results: set, catalog: entries, catalogDigest: set.catalog_digest, registryDigest: manifest.governance.requirement_registry, claimsDigest: manifest.governance.claim_registry, generatedAt, validationNow: now })
  const duplicate = structuredClone(context)
  duplicate.repositories[1] = structuredClone(duplicate.repositories[0])
  assert(validatePostIntegrationContextValue(duplicate, { manifestDigest, resultsDigest: set.result_set_digest }, now).errors.some((error) => error.code === 'invalid_repository_binding'))
  const drift = structuredClone(context)
  drift.repositories[0].commit = h('f')
  assert(validatePostIntegrationContextValue(drift, { manifestDigest, resultsDigest: set.result_set_digest }, now).errors.some((error) => error.code === 'invalid_repository_binding'))
})

test('capture input validation re-derives every digest from the reviewed tool commit', async () => {
  const manifest = validManifest()
  const toolRoot = process.cwd()
  const temporaryIndexRoot = await mkdtemp(path.join(tmpdir(), 'oracle-reviewed-tool-index-'))
  const env = { ...process.env, GIT_INDEX_FILE: path.join(temporaryIndexRoot, 'index'), GIT_AUTHOR_NAME: 'Oracle Test', GIT_AUTHOR_EMAIL: 'oracle@example.invalid', GIT_COMMITTER_NAME: 'Oracle Test', GIT_COMMITTER_EMAIL: 'oracle@example.invalid' }
  execFileSync('git', ['-C', toolRoot, 'read-tree', 'HEAD'], { env })
  for (const binding of Object.values(manifest.capture_inputs).filter((value): value is { path: string; digest: string } => typeof value === 'object')) {
    const blob = execFileSync('git', ['-C', toolRoot, 'hash-object', '-w', binding.path], { encoding: 'utf8', env }).trim()
    execFileSync('git', ['-C', toolRoot, 'update-index', '--add', '--cacheinfo', `100644,${blob},${binding.path}`], { env })
    binding.digest = digestFile(binding.path)
  }
  const tree = execFileSync('git', ['-C', toolRoot, 'write-tree'], { encoding: 'utf8', env }).trim()
  const parent = git(toolRoot, 'rev-parse', 'HEAD')
  const reviewedHead = execFileSync('git', ['-C', toolRoot, 'commit-tree', tree, '-p', parent, '-m', 'reviewed input fixture'], { encoding: 'utf8', env }).trim()
  manifest.capture_inputs.reviewed_tool_head = reviewedHead
  validatePostIntegrationCaptureInputsAtToolRoot(manifest, toolRoot)
  manifest.capture_inputs.capture_tool.digest = d('f')
  assert.throws(() => validatePostIntegrationCaptureInputsAtToolRoot(manifest, toolRoot), (error: Error & { code?: string }) => error.code === 'capture_input_drift')
})

test('catalog runner validates the complete manifest before spawning any command', async () => {
  const cc = await repositoryFixture()
  const sub = await repositoryFixture()
  const root = await mkdtemp(path.join(tmpdir(), 'oracle-post-integration-runner-'))
  const marker = path.join(root, 'executed')
  const manifest = validManifest(new Date().toISOString())
  manifest.repositories.cc_gateway.head = cc.head
  manifest.repositories.cc_gateway.remote.commit = cc.head
  manifest.repositories.sub2api.head = sub.head
  manifest.repositories.sub2api.remote.commit = sub.head
  const manifestPath = path.join(root, 'manifest.json')
  const catalogPath = path.join(root, 'catalog.json')
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`)
  const entries = JSON.parse(readFileSync('docs/superpowers/registry/oracle-lab-post-integration-command-catalog.json', 'utf8')) as PostIntegrationCommandCatalogEntry[]
  entries.find((entry) => entry.id === 'cc-build')!.argv = ['/usr/bin/touch', marker]
  await writeFile(catalogPath, `${JSON.stringify(entries)}\n`)
  await assert.rejects(
    runPostIntegrationCommandCatalog(catalogPath, 'post-integration-green', { CC_GATEWAY_ROOT: cc.root, SUB2API_ROOT: sub.root, TOOL_ROOT: process.cwd(), POST_INTEGRATION_MANIFEST: manifestPath }),
    (error: Error & { code?: string }) => error.code === 'wrong_repository_head',
  )
  assert.equal(existsSync(marker), false)
})

test('context uses the persisted manifest file bytes digest including the canonical newline', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oracle-post-integration-file-digest-'))
  const manifest = validManifest()
  const entries = JSON.parse(readFileSync('docs/superpowers/registry/oracle-lab-post-integration-command-catalog.json', 'utf8')) as PostIntegrationCommandCatalogEntry[]
  const catalogDigest = digestFile('docs/superpowers/registry/oracle-lab-post-integration-command-catalog.json')
  manifest.capture_inputs.command_catalog.digest = catalogDigest
  const manifestPath = path.join(root, 'manifest.json')
  await writeFile(manifestPath, `${canonicalJson(manifest)}\n`)
  const persistedManifest = readJson(manifestPath) as PostIntegrationEntryManifest
  const persistedDigest = digestFile(manifestPath)
  assert.notEqual(persistedDigest, digestValue(persistedManifest))
  const set = completeResults(persistedDigest, entries)
  const context = buildPostIntegrationContext({ manifest: persistedManifest, manifestDigest: persistedDigest, results: set, catalog: entries, catalogDigest, registryDigest: manifest.governance.requirement_registry, claimsDigest: manifest.governance.claim_registry, generatedAt, validationNow: now })
  assert.equal(context.manifest_digest, persistedDigest)
})

test('expired results cannot mint a fresh context using their own generated timestamp', () => {
  const manifest = validManifest()
  manifest.generated_at = '2026-07-20T12:00:00.000Z'
  manifest.expires_at = '2026-07-21T12:00:00.000Z'
  const entries = JSON.parse(readFileSync('docs/superpowers/registry/oracle-lab-post-integration-command-catalog.json', 'utf8')) as PostIntegrationCommandCatalogEntry[]
  const catalogDigest = digestFile('docs/superpowers/registry/oracle-lab-post-integration-command-catalog.json')
  manifest.capture_inputs.command_catalog.digest = catalogDigest
  const manifestDigest = postIntegrationManifestDigest(manifest)
  const expired = completeResults(manifestDigest, entries)
  expired.generated_at = '2026-07-01T12:00:00.000Z'
  expired.expires_at = '2026-07-08T12:00:00.000Z'
  const { result_set_digest: _oldDigest, ...unsignedExpired } = expired
  expired.result_set_digest = postIntegrationCommandSetDigest(unsignedExpired)
  assert.throws(
    () => buildPostIntegrationContext({ manifest, manifestDigest, results: expired, catalog: entries, catalogDigest, registryDigest: manifest.governance.requirement_registry, claimsDigest: manifest.governance.claim_registry, validationNow: Date.parse('2026-07-20T12:30:00.000Z') }),
    (error: Error & { code?: string }) => error.code === 'expired_results',
  )
})
