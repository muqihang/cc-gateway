import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertSafeArtifact, canonicalJson, cli, COMMIT_RE, DIGEST_RE, digestFile, exactKeys, isObject, parseArgs, result, sha256, writeExclusiveJson, type HarnessErrorRecord, type HarnessResult } from './harness-core.js'

const CLEAN_DIGEST = sha256(Buffer.alloc(0))
const ENTRY_FILES = {
  manifest_schema: 'docs/superpowers/schemas/oracle-lab-post-integration-entry.schema.json',
  context_schema: 'docs/superpowers/schemas/oracle-lab-post-integration-context.schema.json',
  results_schema: 'docs/superpowers/schemas/oracle-lab-post-integration-command-results.schema.json',
  catalog_schema: 'docs/superpowers/schemas/oracle-lab-post-integration-command-catalog.schema.json',
  handoff_schema: 'docs/superpowers/schemas/oracle-lab-post-integration-handoff.schema.json',
  receipt_schema: 'docs/superpowers/schemas/oracle-lab-post-integration-receipt.schema.json',
  capture_tool: 'tools/oracle-lab/post-integration-entry.ts',
  context_tool: 'tools/oracle-lab/post-integration-context.ts',
  catalog_tool: 'tools/oracle-lab/post-integration-command-catalog.ts',
  binder_tool: 'tools/oracle-lab/post-integration-handoff.ts',
  command_catalog: 'docs/superpowers/registry/oracle-lab-post-integration-command-catalog.json',
} as const

export const POST_INTEGRATION_BINDINGS = {
  ccGatewayHead: 'b38198763ab7e337321e3a0d9e545375d3fb3ad0',
  sub2apiHead: 'd5a42bbd24d15af2ce7646d050a5ae5c77911d4f',
  branch: 'main',
  remoteName: 'muqihang',
  remoteRef: 'refs/remotes/muqihang/main',
  ccGatewayRemoteUrl: 'https://github.com/muqihang/cc-gateway.git',
  sub2apiRemoteUrl: 'https://github.com/muqihang/sub2api.git',
  contractRelativePath: 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json',
  contractSha256: '70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1',
  exitReceiptRelativePath: 'docs/superpowers/evidence/phase-0/phase-0-exit-receipt.json',
  exitReceiptSha256: '5a2bef840e04d6533bfc657520c73cbc8fcc5f27ede181d168d9b2bf8a3fedee',
  handoffCommit: 'a5c800ed31990caba610953eb8e989afcdd8b62e',
  requirementRegistrySha256: '2e212e0fd8cfeec8272178fefc3d952a29f76129e5f1c75b1dd57a95456aada5',
  claimRegistrySha256: 'b389c3655641f990bd7e31e9a176576f9664b7620ae90c5829a21dc9ff087943',
  roadmapSha256: '96c2a2843964dfc9ddf9d41dbe3127406d68c0db2c0d7a4d050a0c3af3e40dcc',
  disabledCapabilities: [
    'real_upstream_access', 'real_credentials', 'provider_internal_authority', 'profile_promotion',
    'production_deployment', 'real_canary', 'direct_egress_trust', 'unverified_pinned_wire_claims',
    'unsupported_negative_capabilities', 'expired_or_missing_negative_capabilities',
  ],
  nextPhaseGates: [
    'phase_0_exit_receipt_valid', 'fresh_baseline_and_context_required',
    'b1_b6_and_ha_p0_009_remain_non_promotable',
    'real_upstream_credentials_promotion_and_deploy_disabled', 'named_owner_and_gate_approval_required',
  ],
} as const

export type RepositoryBinding = {
  head: string
  branch: 'main'
  clean: true
  dirty_digest: string
  remote: { name: 'muqihang'; ref: 'refs/remotes/muqihang/main'; commit: string; url_digest: string }
}

type PathDigest = { path: string; digest: string }
export type PostIntegrationEntryManifest = {
  schema_version: 1
  entry_kind: 'post_integration_entry'
  generated_at: string
  expires_at: string
  repositories: { cc_gateway: RepositoryBinding; sub2api: RepositoryBinding }
  contract: { repository: 'sub2api'; repository_relative_path: string; sha256: string }
  governance: { requirement_registry: string; claim_registry: string; roadmap: string }
  phase_zero_exit: { receipt_path: string; receipt_digest: string; handoff_commit: string; handoff_is_ancestor_of_integrated_cc_gateway: true }
  capture_inputs: { reviewed_tool_head: string } & Record<keyof typeof ENTRY_FILES, PathDigest>
  runtime: { node: string; npm: string; git: string; go: string; environment: string }
  disabled_capabilities: string[]
  next_phase_gates: string[]
}

type RepositoryExpectation = { head: string; branch: string; remoteName: string; remoteRef: string; remoteUrl?: string }

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

export function inspectIntegratedRepository(rootInput: string, expected: RepositoryExpectation): RepositoryBinding {
  const root = realpathSync(rootInput)
  const head = git(root, 'rev-parse', 'HEAD')
  if (head !== expected.head) fail('wrong_repository_head', `repository HEAD is ${head}, expected ${expected.head}`)
  const branch = git(root, 'rev-parse', '--abbrev-ref', 'HEAD')
  if (branch !== expected.branch) fail('wrong_repository_branch', `repository branch is ${branch}, expected ${expected.branch}`)
  let remoteCommit = ''
  try { remoteCommit = git(root, 'rev-parse', '--verify', expected.remoteRef) } catch { fail('wrong_remote_ref', `${expected.remoteRef} is missing`) }
  if (remoteCommit !== head) fail('wrong_remote_ref', `${expected.remoteRef} does not bind integrated HEAD`)
  let remoteUrl = 'test-fixture-remote'
  if (expected.remoteUrl) {
    try { remoteUrl = git(root, 'remote', 'get-url', expected.remoteName) } catch { fail('wrong_remote_ref', `${expected.remoteName} remote is missing`) }
    if (remoteUrl !== expected.remoteUrl) fail('wrong_remote_ref', `${expected.remoteName} remote URL is not the user fork`)
  }
  const status = execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { encoding: 'buffer' })
  if (status.length !== 0) fail('dirty_repository', 'integrated repository must be clean')
  return { head, branch: 'main', clean: true, dirty_digest: CLEAN_DIGEST, remote: { name: 'muqihang', ref: 'refs/remotes/muqihang/main', commit: head, url_digest: sha256(remoteUrl) } }
}

export function assertContractBinding(contractPath: string, expectedDigest: string): string {
  const actual = digestFile(contractPath)
  if (actual !== expectedDigest) fail('contract_drift', `formal-pool contract digest is ${actual}`)
  return actual
}

export function assertHandoffAncestry(root: string, handoffCommit: string, integratedHead: string): void {
  try {
    execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', handoffCommit, integratedHead], { stdio: 'ignore' })
  } catch { fail('missing_handoff_ancestry', 'Phase 0 handoff commit is not an ancestor of integrated CC Gateway main') }
}

const topFields = ['schema_version', 'entry_kind', 'generated_at', 'expires_at', 'repositories', 'contract', 'governance', 'phase_zero_exit', 'capture_inputs', 'runtime', 'disabled_capabilities', 'next_phase_gates'] as const
const repositoryFields = ['head', 'branch', 'clean', 'dirty_digest', 'remote'] as const
const remoteFields = ['name', 'ref', 'commit', 'url_digest'] as const
const pathDigestFields = ['path', 'digest'] as const

function exact(value: unknown, fields: readonly string[], where: string, errors: HarnessErrorRecord[]): value is Record<string, unknown> {
  return exactKeys(value, fields, where, errors)
}

export function validatePostIntegrationEntryValue(value: unknown, now = Date.now()): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  try { assertSafeArtifact(value) } catch (error) { errors.push({ code: (error as Error & { code?: string }).code ?? 'unsafe_artifact', path: '$', message: (error as Error).message }) }
  if (!exact(value, topFields, '$', errors)) return result(errors)
  if (value.schema_version !== 1 || value.entry_kind !== 'post_integration_entry') errors.push({ code: 'invalid_entry_kind', path: '$.entry_kind', message: 'only post_integration_entry is accepted' })
  const generated = Date.parse(String(value.generated_at)); const expires = Date.parse(String(value.expires_at))
  if (!Number.isFinite(generated) || !Number.isFinite(expires) || expires - generated !== 86_400_000) errors.push({ code: 'invalid_expiry', path: '$.expires_at', message: 'entry expires exactly 24 hours after generation' })
  else if (expires <= now) errors.push({ code: 'expired_post_integration_entry', path: '$.expires_at', message: 'entry evidence is expired' })

  if (exact(value.repositories, ['cc_gateway', 'sub2api'], '$.repositories', errors)) {
    for (const [name, expectedHead] of [['cc_gateway', POST_INTEGRATION_BINDINGS.ccGatewayHead], ['sub2api', POST_INTEGRATION_BINDINGS.sub2apiHead]] as const) {
      const repository = value.repositories[name]
      if (!exact(repository, repositoryFields, `$.repositories.${name}`, errors)) continue
      if (repository.head !== expectedHead) errors.push({ code: 'wrong_repository_head', path: `$.repositories.${name}.head`, message: 'integrated head drift' })
      if (repository.branch !== 'main') errors.push({ code: 'wrong_repository_branch', path: `$.repositories.${name}.branch`, message: 'integrated branch must be main' })
      if (repository.clean !== true || repository.dirty_digest !== CLEAN_DIGEST) errors.push({ code: 'dirty_repository', path: `$.repositories.${name}`, message: 'integrated repository must be clean' })
      if (exact(repository.remote, remoteFields, `$.repositories.${name}.remote`, errors)) {
        const expectedUrl = name === 'cc_gateway' ? POST_INTEGRATION_BINDINGS.ccGatewayRemoteUrl : POST_INTEGRATION_BINDINGS.sub2apiRemoteUrl
        if (repository.remote.name !== 'muqihang' || repository.remote.ref !== 'refs/remotes/muqihang/main' || repository.remote.commit !== expectedHead || repository.remote.url_digest !== sha256(expectedUrl)) errors.push({ code: 'wrong_remote_ref', path: `$.repositories.${name}.remote`, message: 'user-fork remote ref drift' })
      }
    }
  }
  if (exact(value.contract, ['repository', 'repository_relative_path', 'sha256'], '$.contract', errors)) {
    if (value.contract.repository !== 'sub2api' || value.contract.repository_relative_path !== POST_INTEGRATION_BINDINGS.contractRelativePath || value.contract.sha256 !== `sha256:${POST_INTEGRATION_BINDINGS.contractSha256}`) errors.push({ code: 'contract_drift', path: '$.contract', message: 'formal-pool contract drift' })
  }
  if (exact(value.governance, ['requirement_registry', 'claim_registry', 'roadmap'], '$.governance', errors)) {
    const expected = { requirement_registry: `sha256:${POST_INTEGRATION_BINDINGS.requirementRegistrySha256}`, claim_registry: `sha256:${POST_INTEGRATION_BINDINGS.claimRegistrySha256}`, roadmap: `sha256:${POST_INTEGRATION_BINDINGS.roadmapSha256}` }
    for (const field of ['requirement_registry', 'claim_registry', 'roadmap'] as const) if (value.governance[field] !== expected[field]) errors.push({ code: 'governance_drift', path: `$.governance.${field}`, message: 'governance digest drift' })
  }
  if (exact(value.phase_zero_exit, ['receipt_path', 'receipt_digest', 'handoff_commit', 'handoff_is_ancestor_of_integrated_cc_gateway'], '$.phase_zero_exit', errors)) {
    if (value.phase_zero_exit.receipt_path !== POST_INTEGRATION_BINDINGS.exitReceiptRelativePath || value.phase_zero_exit.receipt_digest !== `sha256:${POST_INTEGRATION_BINDINGS.exitReceiptSha256}`) errors.push({ code: 'exit_receipt_drift', path: '$.phase_zero_exit.receipt_digest', message: 'Phase 0 exit receipt drift' })
    if (value.phase_zero_exit.handoff_commit !== POST_INTEGRATION_BINDINGS.handoffCommit || value.phase_zero_exit.handoff_is_ancestor_of_integrated_cc_gateway !== true) errors.push({ code: 'missing_handoff_ancestry', path: '$.phase_zero_exit', message: 'Phase 0 handoff ancestry is not proven' })
  }
  if (exact(value.capture_inputs, ['reviewed_tool_head', ...Object.keys(ENTRY_FILES)], '$.capture_inputs', errors)) {
    if (!COMMIT_RE.test(String(value.capture_inputs.reviewed_tool_head))) errors.push({ code: 'invalid_tool_head', path: '$.capture_inputs.reviewed_tool_head', message: 'reviewed tool head is invalid' })
    for (const [field, expectedPath] of Object.entries(ENTRY_FILES)) if (exact(value.capture_inputs[field], pathDigestFields, `$.capture_inputs.${field}`, errors) && (value.capture_inputs[field].path !== expectedPath || !DIGEST_RE.test(String(value.capture_inputs[field].digest)))) errors.push({ code: 'capture_input_drift', path: `$.capture_inputs.${field}`, message: 'capture input path or digest is invalid' })
  }
  if (exact(value.runtime, ['node', 'npm', 'git', 'go', 'environment'], '$.runtime', errors)) for (const field of ['node', 'npm', 'git', 'go', 'environment']) if (!DIGEST_RE.test(String(value.runtime[field]))) errors.push({ code: 'invalid_runtime_digest', path: `$.runtime.${field}`, message: 'runtime digest is invalid' })
  if (canonicalJson(value.disabled_capabilities) !== canonicalJson(POST_INTEGRATION_BINDINGS.disabledCapabilities)) errors.push({ code: 'disabled_capability_drift', path: '$.disabled_capabilities', message: 'disabled capabilities must remain exact' })
  if (canonicalJson(value.next_phase_gates) !== canonicalJson(POST_INTEGRATION_BINDINGS.nextPhaseGates)) errors.push({ code: 'next_phase_gate_drift', path: '$.next_phase_gates', message: 'next-phase gates must remain exact' })
  return result(errors)
}

export function postIntegrationManifestDigest(value: PostIntegrationEntryManifest): string { return sha256(`${canonicalJson(value)}\n`) }

function versionDigest(command: string, args: string[]): string {
  try { return sha256(execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()) }
  catch { fail('missing_runtime_tool', `${command} is required`) }
}

function assertReviewedToolSnapshot(root: string): string {
  const status = execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { encoding: 'buffer' })
  if (status.length !== 0) fail('dirty_tool_repository', 'post-integration capture tooling must run from a clean reviewed HEAD')
  const head = git(root, 'rev-parse', 'HEAD')
  for (const relative of Object.values(ENTRY_FILES)) {
    let reviewed: Buffer
    try { reviewed = execFileSync('git', ['-C', root, 'show', `${head}:${relative}`], { encoding: 'buffer' }) }
    catch { fail('missing_reviewed_capture_input', `${relative} is absent from reviewed tool HEAD`) }
    if (sha256(reviewed) !== digestFile(path.join(root, relative))) fail('capture_input_drift', `${relative} differs from reviewed tool HEAD`)
  }
  return head
}

export function validatePostIntegrationCaptureInputsAtToolRoot(manifest: PostIntegrationEntryManifest, toolRootInput: string): void {
  const toolRoot = realpathSync(toolRootInput)
  const reviewedHead = manifest.capture_inputs.reviewed_tool_head
  try { git(toolRoot, 'cat-file', '-e', `${reviewedHead}^{commit}`) }
  catch { fail('missing_reviewed_tool_commit', 'reviewed tool commit is unavailable in the supplied tool repository') }
  try { execFileSync('git', ['-C', toolRoot, 'merge-base', '--is-ancestor', POST_INTEGRATION_BINDINGS.ccGatewayHead, reviewedHead], { stdio: 'ignore' }) }
  catch { fail('invalid_reviewed_tool_ancestry', 'reviewed tool commit does not descend from integrated CC Gateway main') }
  for (const [field, expectedPath] of Object.entries(ENTRY_FILES) as Array<[keyof typeof ENTRY_FILES, string]>) {
    const binding = manifest.capture_inputs[field]
    if (binding.path !== expectedPath) fail('capture_input_drift', `${field} path differs from the reviewed binding`)
    let reviewed: Buffer
    try { reviewed = execFileSync('git', ['-C', toolRoot, 'show', `${reviewedHead}:${expectedPath}`], { encoding: 'buffer' }) }
    catch { fail('missing_reviewed_capture_input', `${expectedPath} is absent from reviewed tool commit`) }
    if (sha256(reviewed) !== binding.digest) fail('capture_input_drift', `${expectedPath} digest differs from reviewed tool commit`)
  }
}

export function validatePostIntegrationEntryArtifact(manifest: PostIntegrationEntryManifest, options: { ccGatewayRoot: string; sub2apiRoot: string; toolRoot: string; now?: number }): void {
  const validation = validatePostIntegrationEntryValue(manifest, options.now ?? Date.now())
  if (!validation.ok) fail(validation.errors[0].code, JSON.stringify(validation.errors))
  validatePostIntegrationCaptureInputsAtToolRoot(manifest, options.toolRoot)

  const cc = inspectIntegratedRepository(options.ccGatewayRoot, { head: POST_INTEGRATION_BINDINGS.ccGatewayHead, branch: 'main', remoteName: POST_INTEGRATION_BINDINGS.remoteName, remoteRef: POST_INTEGRATION_BINDINGS.remoteRef, remoteUrl: POST_INTEGRATION_BINDINGS.ccGatewayRemoteUrl })
  const sub = inspectIntegratedRepository(options.sub2apiRoot, { head: POST_INTEGRATION_BINDINGS.sub2apiHead, branch: 'main', remoteName: POST_INTEGRATION_BINDINGS.remoteName, remoteRef: POST_INTEGRATION_BINDINGS.remoteRef, remoteUrl: POST_INTEGRATION_BINDINGS.sub2apiRemoteUrl })
  if (canonicalJson(manifest.repositories) !== canonicalJson({ cc_gateway: cc, sub2api: sub })) fail('repository_binding_drift', 'manifest repository bindings differ from the integrated repositories')

  assertContractBinding(path.join(options.sub2apiRoot, manifest.contract.repository_relative_path), manifest.contract.sha256)
  const governancePaths = {
    requirement_registry: 'docs/superpowers/registry/oracle-lab-requirements.json',
    claim_registry: 'docs/superpowers/registry/oracle-lab-claims.json',
    roadmap: 'docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md',
  } as const
  for (const [field, relative] of Object.entries(governancePaths) as Array<[keyof typeof governancePaths, string]>) {
    if (digestFile(path.join(options.ccGatewayRoot, relative)) !== manifest.governance[field]) fail('governance_drift', `${field} bytes differ from the manifest`)
  }
  const receiptPath = path.join(options.ccGatewayRoot, manifest.phase_zero_exit.receipt_path)
  if (!existsSync(receiptPath) || digestFile(receiptPath) !== manifest.phase_zero_exit.receipt_digest) fail('exit_receipt_drift', 'Phase 0 exit receipt bytes differ from the manifest')
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as Record<string, unknown>
  if (receipt.handoff_commit !== manifest.phase_zero_exit.handoff_commit) fail('exit_receipt_drift', 'Phase 0 exit receipt handoff commit differs from the manifest')
  assertHandoffAncestry(options.ccGatewayRoot, manifest.phase_zero_exit.handoff_commit, manifest.repositories.cc_gateway.head)
}

export function capturePostIntegrationEntry(options: { ccGatewayRoot: string; sub2apiRoot: string; toolRoot: string; generatedAt?: string }): PostIntegrationEntryManifest {
  const toolRoot = realpathSync(options.toolRoot)
  const reviewedToolHead = assertReviewedToolSnapshot(toolRoot)
  const cc = inspectIntegratedRepository(options.ccGatewayRoot, { head: POST_INTEGRATION_BINDINGS.ccGatewayHead, branch: 'main', remoteName: 'muqihang', remoteRef: POST_INTEGRATION_BINDINGS.remoteRef, remoteUrl: POST_INTEGRATION_BINDINGS.ccGatewayRemoteUrl })
  const sub = inspectIntegratedRepository(options.sub2apiRoot, { head: POST_INTEGRATION_BINDINGS.sub2apiHead, branch: 'main', remoteName: 'muqihang', remoteRef: POST_INTEGRATION_BINDINGS.remoteRef, remoteUrl: POST_INTEGRATION_BINDINGS.sub2apiRemoteUrl })
  assertContractBinding(path.join(options.sub2apiRoot, POST_INTEGRATION_BINDINGS.contractRelativePath), `sha256:${POST_INTEGRATION_BINDINGS.contractSha256}`)
  const receiptPath = path.join(options.ccGatewayRoot, POST_INTEGRATION_BINDINGS.exitReceiptRelativePath)
  if (!existsSync(receiptPath) || digestFile(receiptPath) !== `sha256:${POST_INTEGRATION_BINDINGS.exitReceiptSha256}`) fail('exit_receipt_drift', 'Phase 0 exit receipt bytes drifted')
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as Record<string, unknown>
  if (receipt.handoff_commit !== POST_INTEGRATION_BINDINGS.handoffCommit) fail('exit_receipt_drift', 'Phase 0 receipt handoff commit drifted')
  assertHandoffAncestry(options.ccGatewayRoot, POST_INTEGRATION_BINDINGS.handoffCommit, POST_INTEGRATION_BINDINGS.ccGatewayHead)
  const generated = new Date(options.generatedAt ?? new Date().toISOString())
  const inputs = Object.fromEntries(Object.entries(ENTRY_FILES).map(([key, relative]) => {
    const absolute = path.join(toolRoot, relative)
    if (!existsSync(absolute)) fail('missing_capture_input', `${relative} is missing`)
    return [key, { path: relative, digest: digestFile(absolute) }]
  })) as Record<keyof typeof ENTRY_FILES, PathDigest>
  const environment = { CI: '1', network: 'local_fixture_only', sensitive_material: 'digest_only' }
  const manifest: PostIntegrationEntryManifest = {
    schema_version: 1, entry_kind: 'post_integration_entry', generated_at: generated.toISOString(), expires_at: new Date(generated.getTime() + 86_400_000).toISOString(),
    repositories: { cc_gateway: cc, sub2api: sub },
    contract: { repository: 'sub2api', repository_relative_path: POST_INTEGRATION_BINDINGS.contractRelativePath, sha256: `sha256:${POST_INTEGRATION_BINDINGS.contractSha256}` },
    governance: {
      requirement_registry: digestFile(path.join(options.ccGatewayRoot, 'docs/superpowers/registry/oracle-lab-requirements.json')),
      claim_registry: digestFile(path.join(options.ccGatewayRoot, 'docs/superpowers/registry/oracle-lab-claims.json')),
      roadmap: digestFile(path.join(options.ccGatewayRoot, 'docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md')),
    },
    phase_zero_exit: { receipt_path: POST_INTEGRATION_BINDINGS.exitReceiptRelativePath, receipt_digest: `sha256:${POST_INTEGRATION_BINDINGS.exitReceiptSha256}`, handoff_commit: POST_INTEGRATION_BINDINGS.handoffCommit, handoff_is_ancestor_of_integrated_cc_gateway: true },
    capture_inputs: { reviewed_tool_head: reviewedToolHead, ...inputs },
    runtime: { node: versionDigest('node', ['--version']), npm: versionDigest('npm', ['--version']), git: versionDigest('git', ['--version']), go: versionDigest('go', ['version']), environment: sha256(canonicalJson(environment)) },
    disabled_capabilities: [...POST_INTEGRATION_BINDINGS.disabledCapabilities], next_phase_gates: [...POST_INTEGRATION_BINDINGS.nextPhaseGates],
  }
  const validation = validatePostIntegrationEntryValue(manifest, generated.getTime())
  if (!validation.ok) fail(validation.errors[0].code, JSON.stringify(validation.errors))
  return manifest
}

if (realpathSync(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) cli(() => {
  const args = parseArgs(process.argv.slice(2)); const cc = args.values['cc-gateway-root']?.[0]; const sub = args.values['sub2api-root']?.[0]; const tool = args.values['tool-root']?.[0]; const out = args.values.out?.[0]
  if (!cc || !sub || !tool || !out) fail('invalid_arguments', '--cc-gateway-root, --sub2api-root, --tool-root, and --out are required')
  writeExclusiveJson(out, capturePostIntegrationEntry({ ccGatewayRoot: cc, sub2apiRoot: sub, toolRoot: tool }))
})
