import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertSafeArtifact, canonicalJson, cli, COMMIT_RE, DIGEST_RE, digestFile, exactKeys, parseArgs, readJson, result, sha256, writeExclusiveJson, type HarnessErrorRecord, type HarnessResult } from './harness-core.js'
import { POST_INTEGRATION_BINDINGS, validatePostIntegrationCaptureInputsAtToolRoot, validatePostIntegrationEntryValue, type PostIntegrationEntryManifest } from './post-integration-entry.js'
import { validatePostIntegrationContextValue, type PostIntegrationContext } from './post-integration-context.js'
import { validatePostIntegrationCommandResultsValue, type PostIntegrationCommandResultSet } from './post-integration-command-catalog.js'

type ArtifactBinding = { path: string; digest: string }
type HandoffRepository = { name: 'cc_gateway' | 'sub2api'; commit: string; remote_name: 'muqihang'; remote_ref: 'refs/remotes/muqihang/main'; remote_commit: string; remote_url_digest: string }

export type PostIntegrationHandoff = {
  schema_version: 1
  handoff_kind: 'post_integration_handoff'
  generated_at: string
  expires_at: string
  entry_manifest: ArtifactBinding
  command_results: ArtifactBinding & { result_set_digest: string; record_count: 7 }
  context: ArtifactBinding & { manifest_digest: string; command_results_digest: string }
  phase_zero_exit: { receipt_path: string; receipt_digest: string; handoff_commit: string }
  reviewed_tool_head: string
  repositories: HandoffRepository[]
  disabled_capabilities: string[]
  next_phase_gates: string[]
  retention_policy: 'phase_evidence_permanent'
  redaction_policy: 'digests_and_safe_redacted_excerpts_only'
  destruction_procedure: 'git_revert_artifact_commit_after_security_approval'
}

export type PostIntegrationReceipt = {
  schema_version: 1
  receipt_kind: 'post_integration_receipt'
  generated_at: string
  artifact_commit: string
  reviewed_tool_head: string
  entry_manifest_digest: string
  command_results_digest: string
  context_digest: string
  handoff_digest: string
  phase_zero_exit_receipt_digest: string
  artifact_digests: { entry_manifest: ArtifactBinding; command_results: ArtifactBinding; context: ArtifactBinding; handoff: ArtifactBinding }
  repositories: Array<{ name: 'cc_gateway' | 'sub2api'; commit: string; remote_ref: 'refs/remotes/muqihang/main' }>
  disabled_capabilities: string[]
  next_phase_gates: string[]
  retention_policy: 'phase_evidence_permanent'
  redaction_policy: 'digests_and_safe_redacted_excerpts_only'
  destruction_procedure: 'git_revert_artifact_commit_after_security_approval'
}

const handoffFields = ['schema_version', 'handoff_kind', 'generated_at', 'expires_at', 'entry_manifest', 'command_results', 'context', 'phase_zero_exit', 'reviewed_tool_head', 'repositories', 'disabled_capabilities', 'next_phase_gates', 'retention_policy', 'redaction_policy', 'destruction_procedure'] as const
const receiptFields = ['schema_version', 'receipt_kind', 'generated_at', 'artifact_commit', 'reviewed_tool_head', 'entry_manifest_digest', 'command_results_digest', 'context_digest', 'handoff_digest', 'phase_zero_exit_receipt_digest', 'artifact_digests', 'repositories', 'disabled_capabilities', 'next_phase_gates', 'retention_policy', 'redaction_policy', 'destruction_procedure'] as const
const acceptedCommandIds = new Set(['cc-build', 'cc-test', 'sidecar-test', 'sub2api-test', 'cc-b4-b6-red', 'sidecar-b4-b6-red', 'sub2api-b1-b3-red'])

function fail(code: string, message: string): never { throw Object.assign(new Error(message), { code }) }
function exact(value: unknown, fields: readonly string[], where: string, errors: HarnessErrorRecord[]): value is Record<string, unknown> { return exactKeys(value, fields, where, errors) }
function same(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right) }
function persistedPath(file: string): string { return path.isAbsolute(file) ? path.basename(file) : file }

function validateArtifact(value: unknown, where: string, errors: HarnessErrorRecord[]): value is ArtifactBinding {
  if (!exact(value, ['path', 'digest'], where, errors)) return false
  if (typeof value.path !== 'string' || value.path.length === 0 || !DIGEST_RE.test(String(value.digest))) errors.push({ code: 'invalid_artifact', path: where, message: 'artifact path and digest are required' })
  return true
}

function expectedRepositories(): HandoffRepository[] {
  return [
    { name: 'cc_gateway', commit: POST_INTEGRATION_BINDINGS.ccGatewayHead, remote_name: 'muqihang', remote_ref: 'refs/remotes/muqihang/main', remote_commit: POST_INTEGRATION_BINDINGS.ccGatewayHead, remote_url_digest: sha256(POST_INTEGRATION_BINDINGS.ccGatewayRemoteUrl) },
    { name: 'sub2api', commit: POST_INTEGRATION_BINDINGS.sub2apiHead, remote_name: 'muqihang', remote_ref: 'refs/remotes/muqihang/main', remote_commit: POST_INTEGRATION_BINDINGS.sub2apiHead, remote_url_digest: sha256(POST_INTEGRATION_BINDINGS.sub2apiRemoteUrl) },
  ]
}

export function validatePostIntegrationHandoffValue(value: unknown, now = Date.now()): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  try { assertSafeArtifact(value) } catch (error) { errors.push({ code: (error as Error & { code?: string }).code ?? 'unsafe_artifact', path: '$', message: (error as Error).message }) }
  if (!exact(value, handoffFields, '$', errors)) return result(errors)
  if (value.schema_version !== 1 || value.handoff_kind !== 'post_integration_handoff') errors.push({ code: 'invalid_handoff_kind', path: '$.handoff_kind', message: 'only post_integration_handoff is accepted' })
  const generated = Date.parse(String(value.generated_at)); const expires = Date.parse(String(value.expires_at))
  if (!Number.isFinite(generated) || !Number.isFinite(expires) || expires - generated !== 86_400_000) errors.push({ code: 'invalid_expiry', path: '$.expires_at', message: 'handoff expires exactly 24 hours after generation' })
  else if (expires <= now) errors.push({ code: 'expired_post_integration_handoff', path: '$.expires_at', message: 'post-integration handoff is expired' })
  validateArtifact(value.entry_manifest, '$.entry_manifest', errors)
  if (exact(value.command_results, ['path', 'digest', 'result_set_digest', 'record_count'], '$.command_results', errors)) {
    if (typeof value.command_results.path !== 'string' || !DIGEST_RE.test(String(value.command_results.digest)) || !DIGEST_RE.test(String(value.command_results.result_set_digest)) || value.command_results.record_count !== 7) errors.push({ code: 'invalid_command_results', path: '$.command_results', message: 'complete command results binding is required' })
  }
  if (exact(value.context, ['path', 'digest', 'manifest_digest', 'command_results_digest'], '$.context', errors)) {
    if (typeof value.context.path !== 'string' || !DIGEST_RE.test(String(value.context.digest)) || !DIGEST_RE.test(String(value.context.manifest_digest)) || !DIGEST_RE.test(String(value.context.command_results_digest))) errors.push({ code: 'invalid_context', path: '$.context', message: 'context binding is invalid' })
    if (value.context.manifest_digest !== (value.entry_manifest as Record<string, unknown>).digest || value.context.command_results_digest !== (value.command_results as Record<string, unknown>).result_set_digest) errors.push({ code: 'cross_manifest_handoff', path: '$.context', message: 'context does not bind the handoff manifest and result set' })
  }
  if (exact(value.phase_zero_exit, ['receipt_path', 'receipt_digest', 'handoff_commit'], '$.phase_zero_exit', errors) && (value.phase_zero_exit.receipt_path !== POST_INTEGRATION_BINDINGS.exitReceiptRelativePath || value.phase_zero_exit.receipt_digest !== `sha256:${POST_INTEGRATION_BINDINGS.exitReceiptSha256}` || value.phase_zero_exit.handoff_commit !== POST_INTEGRATION_BINDINGS.handoffCommit)) errors.push({ code: 'phase_zero_exit_drift', path: '$.phase_zero_exit', message: 'Phase 0 exit binding drifted' })
  if (!COMMIT_RE.test(String(value.reviewed_tool_head))) errors.push({ code: 'invalid_reviewed_tool_head', path: '$.reviewed_tool_head', message: 'reviewed tool commit is invalid' })
  if (!same(value.repositories, expectedRepositories())) errors.push({ code: 'repository_binding_drift', path: '$.repositories', message: 'integrated heads and user-fork refs must remain exact' })
  if (!same(value.disabled_capabilities, POST_INTEGRATION_BINDINGS.disabledCapabilities)) errors.push({ code: 'disabled_capability_drift', path: '$.disabled_capabilities', message: 'disabled capabilities must remain exact' })
  if (!same(value.next_phase_gates, POST_INTEGRATION_BINDINGS.nextPhaseGates)) errors.push({ code: 'next_phase_gate_drift', path: '$.next_phase_gates', message: 'next-phase gates must remain exact' })
  if (value.retention_policy !== 'phase_evidence_permanent' || value.redaction_policy !== 'digests_and_safe_redacted_excerpts_only' || value.destruction_procedure !== 'git_revert_artifact_commit_after_security_approval') errors.push({ code: 'invalid_metadata', path: '$', message: 'evidence retention metadata is invalid' })
  return result(errors)
}

type HandoffBuildOptions = { manifestPath: string; resultsPath: string; contextPath: string; exitReceiptPath: string; manifest?: PostIntegrationEntryManifest; results?: PostIntegrationCommandResultSet; context?: PostIntegrationContext; generatedAt?: string }

export function buildPostIntegrationHandoff(options: HandoffBuildOptions): PostIntegrationHandoff {
  const manifest = options.manifest ?? readJson(options.manifestPath) as PostIntegrationEntryManifest
  const results = options.results ?? readJson(options.resultsPath) as PostIntegrationCommandResultSet
  const context = options.context ?? readJson(options.contextPath) as PostIntegrationContext
  const generated = new Date(options.generatedAt ?? new Date().toISOString())
  const manifestDigest = digestFile(options.manifestPath)
  const resultsDigest = digestFile(options.resultsPath)
  const contextDigest = digestFile(options.contextPath)
  const entryValidation = validatePostIntegrationEntryValue(manifest, generated.getTime()); if (!entryValidation.ok) fail(entryValidation.errors[0].code, JSON.stringify(entryValidation.errors))
  const resultsValidation = validatePostIntegrationCommandResultsValue(results, generated.getTime()); if (!resultsValidation.ok) fail(resultsValidation.errors[0].code, JSON.stringify(resultsValidation.errors))
  if (results.manifest_digest !== manifestDigest || results.records.length !== 7 || new Set(results.records.map((record) => record.command_id)).size !== 7 || results.records.some((record) => !acceptedCommandIds.has(record.command_id) || !['pass', 'expected_fail'].includes(record.status))) fail('incomplete_result_set', 'all four GREEN and three expected RED results must bind the manifest')
  const contextValidation = validatePostIntegrationContextValue(context, { manifestDigest, resultsDigest: results.result_set_digest }, generated.getTime()); if (!contextValidation.ok) fail(contextValidation.errors[0].code, JSON.stringify(contextValidation.errors))
  const expectedEvidence = results.records.map(({ command_id, status, result_digest }) => ({ command_id, status, result_digest })).sort((a, b) => a.command_id.localeCompare(b.command_id))
  if (!same(context.command_evidence, expectedEvidence)) fail('cross_results_context', 'context command evidence differs from the complete result records')
  if (manifest.phase_zero_exit.receipt_digest !== digestFile(options.exitReceiptPath)) fail('phase_zero_exit_drift', 'Phase 0 exit receipt bytes differ from the manifest')
  const handoff: PostIntegrationHandoff = {
    schema_version: 1, handoff_kind: 'post_integration_handoff', generated_at: generated.toISOString(), expires_at: new Date(generated.getTime() + 86_400_000).toISOString(),
    entry_manifest: { path: persistedPath(options.manifestPath), digest: manifestDigest }, command_results: { path: persistedPath(options.resultsPath), digest: resultsDigest, result_set_digest: results.result_set_digest, record_count: 7 },
    context: { path: persistedPath(options.contextPath), digest: contextDigest, manifest_digest: context.manifest_digest, command_results_digest: context.command_results_digest },
    phase_zero_exit: { receipt_path: manifest.phase_zero_exit.receipt_path, receipt_digest: manifest.phase_zero_exit.receipt_digest, handoff_commit: manifest.phase_zero_exit.handoff_commit },
    reviewed_tool_head: manifest.capture_inputs.reviewed_tool_head, repositories: expectedRepositories(), disabled_capabilities: [...manifest.disabled_capabilities], next_phase_gates: [...manifest.next_phase_gates],
    retention_policy: 'phase_evidence_permanent', redaction_policy: 'digests_and_safe_redacted_excerpts_only', destruction_procedure: 'git_revert_artifact_commit_after_security_approval',
  }
  const validation = validatePostIntegrationHandoffValue(handoff, generated.getTime()); if (!validation.ok) fail(validation.errors[0].code, JSON.stringify(validation.errors))
  assertSafeArtifact(handoff); return handoff
}

export function validatePostIntegrationReceiptValue(value: unknown): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  try { assertSafeArtifact(value) } catch (error) { errors.push({ code: (error as Error & { code?: string }).code ?? 'unsafe_artifact', path: '$', message: (error as Error).message }) }
  if (!exact(value, receiptFields, '$', errors)) return result(errors)
  if (value.schema_version !== 1 || value.receipt_kind !== 'post_integration_receipt' || !Number.isFinite(Date.parse(String(value.generated_at))) || !COMMIT_RE.test(String(value.artifact_commit)) || !COMMIT_RE.test(String(value.reviewed_tool_head))) errors.push({ code: 'invalid_receipt', path: '$', message: 'receipt header is invalid' })
  for (const field of ['entry_manifest_digest', 'command_results_digest', 'context_digest', 'handoff_digest', 'phase_zero_exit_receipt_digest'] as const) if (!DIGEST_RE.test(String(value[field]))) errors.push({ code: 'invalid_digest', path: `$.${field}`, message: 'receipt digest is invalid' })
  if (exact(value.artifact_digests, ['entry_manifest', 'command_results', 'context', 'handoff'], '$.artifact_digests', errors)) {
    const aggregate = { entry_manifest: value.entry_manifest_digest, command_results: value.command_results_digest, context: value.context_digest, handoff: value.handoff_digest }
    for (const key of Object.keys(aggregate) as Array<keyof typeof aggregate>) {
      validateArtifact(value.artifact_digests[key], `$.artifact_digests.${key}`, errors)
      if ((value.artifact_digests[key] as Record<string, unknown>)?.digest !== aggregate[key]) errors.push({ code: 'artifact_digest_mismatch', path: `$.artifact_digests.${key}.digest`, message: 'artifact and aggregate receipt digests differ' })
    }
  }
  if (value.phase_zero_exit_receipt_digest !== `sha256:${POST_INTEGRATION_BINDINGS.exitReceiptSha256}`) errors.push({ code: 'phase_zero_exit_drift', path: '$.phase_zero_exit_receipt_digest', message: 'Phase 0 exit receipt digest drifted' })
  const expectedRepos = expectedRepositories().map(({ name, commit, remote_ref }) => ({ name, commit, remote_ref }))
  if (!same(value.repositories, expectedRepos)) errors.push({ code: 'repository_binding_drift', path: '$.repositories', message: 'receipt repository heads and refs drifted' })
  if (!same(value.disabled_capabilities, POST_INTEGRATION_BINDINGS.disabledCapabilities) || !same(value.next_phase_gates, POST_INTEGRATION_BINDINGS.nextPhaseGates)) errors.push({ code: 'safety_binding_drift', path: '$', message: 'receipt safety bindings drifted' })
  if (value.retention_policy !== 'phase_evidence_permanent' || value.redaction_policy !== 'digests_and_safe_redacted_excerpts_only' || value.destruction_procedure !== 'git_revert_artifact_commit_after_security_approval') errors.push({ code: 'invalid_metadata', path: '$', message: 'receipt retention metadata is invalid' })
  return result(errors)
}

function git(root: string, ...args: string[]): string { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
function isAncestor(root: string, ancestor: string, descendant: string): boolean { try { execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', ancestor, descendant], { stdio: 'ignore' }); return true } catch { return false } }
function relativeArtifact(root: string, file: string): string { let real: string; try { real = realpathSync(file) } catch { fail('missing_artifact', `${file} is missing`) }; const relative = path.relative(root, real); if (relative.startsWith('..') || path.isAbsolute(relative)) fail('artifact_outside_repository', `${file} is outside the artifact repository`); return relative }
function commitDigest(root: string, commit: string, relative: string): string { try { return sha256(execFileSync('git', ['-C', root, 'show', `${commit}:${relative}`], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 })) } catch { fail('commit_missing_artifact', `${commit} does not contain ${relative}`) } }

type ReceiptArtifactOptions = { root: string; artifactCommit?: string; manifestPath: string; resultsPath: string; contextPath: string; handoffPath: string; now?: number }

export function validatePostIntegrationReceiptArtifact(receipt: PostIntegrationReceipt, options: ReceiptArtifactOptions): void {
  const validation = validatePostIntegrationReceiptValue(receipt); if (!validation.ok) fail(validation.errors[0].code, JSON.stringify(validation.errors))
  const root = realpathSync(options.root)
  const validationCommit = options.artifactCommit ?? git(root, 'rev-parse', 'HEAD')
  if (!isAncestor(root, receipt.reviewed_tool_head, receipt.artifact_commit)) fail('non_ancestor_reviewed_tool', 'artifact commit does not descend from reviewed tool head')
  if (!isAncestor(root, receipt.artifact_commit, validationCommit)) fail('non_ancestor_artifact_commit', 'artifact commit is not an ancestor of the validation commit')
  const paths = { entry_manifest: options.manifestPath, command_results: options.resultsPath, context: options.contextPath, handoff: options.handoffPath }
  for (const [key, file] of Object.entries(paths) as Array<[keyof typeof paths, string]>) {
    const relative = relativeArtifact(root, file); const binding = receipt.artifact_digests[key]
    if (binding.path !== relative) fail('artifact_path_mismatch', `${key} path differs from receipt`)
    const current = digestFile(file)
    if (current !== binding.digest || current !== commitDigest(root, receipt.artifact_commit, relative)) fail('artifact_digest_mismatch', `${key} bytes differ from the artifact commit`)
  }
  const manifest = readJson(options.manifestPath) as PostIntegrationEntryManifest; const results = readJson(options.resultsPath) as PostIntegrationCommandResultSet; const context = readJson(options.contextPath) as PostIntegrationContext; const handoff = readJson(options.handoffPath) as PostIntegrationHandoff
  const now = options.now ?? Date.now()
  const manifestValidation = validatePostIntegrationEntryValue(manifest, now); if (!manifestValidation.ok) fail(manifestValidation.errors[0].code, JSON.stringify(manifestValidation.errors))
  validatePostIntegrationCaptureInputsAtToolRoot(manifest, root)
  const resultsValidation = validatePostIntegrationCommandResultsValue(results, now); if (!resultsValidation.ok) fail(resultsValidation.errors[0].code, JSON.stringify(resultsValidation.errors))
  const contextValidation = validatePostIntegrationContextValue(context, { manifestDigest: receipt.entry_manifest_digest, resultsDigest: results.result_set_digest }, now); if (!contextValidation.ok) fail(contextValidation.errors[0].code, JSON.stringify(contextValidation.errors))
  const handoffValidation = validatePostIntegrationHandoffValue(handoff, now); if (!handoffValidation.ok) fail(handoffValidation.errors[0].code, JSON.stringify(handoffValidation.errors))
  if (handoff.reviewed_tool_head !== manifest.capture_inputs.reviewed_tool_head || handoff.entry_manifest.digest !== receipt.entry_manifest_digest || handoff.command_results.digest !== receipt.command_results_digest || handoff.context.digest !== receipt.context_digest || digestFile(options.handoffPath) !== receipt.handoff_digest || handoff.phase_zero_exit.receipt_digest !== receipt.phase_zero_exit_receipt_digest || results.manifest_digest !== receipt.entry_manifest_digest || context.manifest_digest !== receipt.entry_manifest_digest || context.command_results_digest !== results.result_set_digest) fail('cross_manifest_handoff', 'receipt, handoff, manifest, results, and context bindings differ')
  const expectedEvidence = results.records.map(({ command_id, status, result_digest }) => ({ command_id, status, result_digest })).sort((a, b) => a.command_id.localeCompare(b.command_id))
  if (!same(context.command_evidence, expectedEvidence)) fail('cross_results_context', 'context evidence differs from committed results')
}

export function buildPostIntegrationReceipt(options: ReceiptArtifactOptions & { artifactCommit: string; generatedAt?: string }): PostIntegrationReceipt {
  const root = realpathSync(options.root)
  if (git(root, 'rev-parse', 'HEAD') !== options.artifactCommit) fail('uncommitted_artifact', 'artifact commit must be the current repository HEAD')
  if (execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { encoding: 'buffer' }).length !== 0) fail('uncommitted_artifact', 'artifact repository must be clean before receipt generation')
  const handoff = readJson(options.handoffPath) as PostIntegrationHandoff
  const handoffValidation = validatePostIntegrationHandoffValue(handoff, Date.parse(options.generatedAt ?? new Date().toISOString())); if (!handoffValidation.ok) fail(handoffValidation.errors[0].code, JSON.stringify(handoffValidation.errors))
  if (!isAncestor(root, handoff.reviewed_tool_head, options.artifactCommit)) fail('non_ancestor_reviewed_tool', 'artifact commit does not descend from reviewed tool head')
  const paths = { entry_manifest: options.manifestPath, command_results: options.resultsPath, context: options.contextPath, handoff: options.handoffPath }
  const artifactDigests = Object.fromEntries(Object.entries(paths).map(([key, file]) => { const relative = relativeArtifact(root, file); const digest = digestFile(file); if (commitDigest(root, options.artifactCommit, relative) !== digest) fail('commit_artifact_digest_mismatch', `${relative} is not committed with its current bytes`); return [key, { path: relative, digest }] })) as PostIntegrationReceipt['artifact_digests']
  const receipt: PostIntegrationReceipt = {
    schema_version: 1, receipt_kind: 'post_integration_receipt', generated_at: new Date(options.generatedAt ?? new Date().toISOString()).toISOString(), artifact_commit: options.artifactCommit, reviewed_tool_head: handoff.reviewed_tool_head,
    entry_manifest_digest: handoff.entry_manifest.digest, command_results_digest: handoff.command_results.digest, context_digest: handoff.context.digest, handoff_digest: digestFile(options.handoffPath), phase_zero_exit_receipt_digest: handoff.phase_zero_exit.receipt_digest,
    artifact_digests: artifactDigests, repositories: handoff.repositories.map(({ name, commit, remote_ref }) => ({ name, commit, remote_ref })), disabled_capabilities: [...handoff.disabled_capabilities], next_phase_gates: [...handoff.next_phase_gates],
    retention_policy: 'phase_evidence_permanent', redaction_policy: 'digests_and_safe_redacted_excerpts_only', destruction_procedure: 'git_revert_artifact_commit_after_security_approval',
  }
  const validation = validatePostIntegrationReceiptValue(receipt); if (!validation.ok) fail(validation.errors[0].code, JSON.stringify(validation.errors))
  validatePostIntegrationReceiptArtifact(receipt, { root, manifestPath: options.manifestPath, resultsPath: options.resultsPath, contextPath: options.contextPath, handoffPath: options.handoffPath, now: Date.parse(receipt.generated_at) })
  return receipt
}

if (realpathSync(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) cli(() => {
  const args = parseArgs(process.argv.slice(2)); const mode = args.positionals[0]; const root = args.values.root?.[0]; const manifestPath = args.values.manifest?.[0]; const resultsPath = args.values.results?.[0]; const contextPath = args.values.context?.[0]; const handoffPath = args.values.handoff?.[0]; const out = args.values.out?.[0]
  if (!manifestPath || !resultsPath || !contextPath || !out) fail('invalid_arguments', 'mode plus --manifest, --results, --context, and --out are required')
  if (mode === 'handoff') {
    const exitReceiptPath = args.values['phase-zero-exit-receipt']?.[0]; if (!exitReceiptPath) fail('invalid_arguments', '--phase-zero-exit-receipt is required')
    writeExclusiveJson(out, buildPostIntegrationHandoff({ manifestPath, resultsPath, contextPath, exitReceiptPath }))
  } else if (mode === 'receipt') {
    const artifactCommit = args.values['artifact-commit']?.[0]; if (!root || !artifactCommit || !handoffPath) fail('invalid_arguments', '--root, --artifact-commit, and --handoff are required')
    writeExclusiveJson(out, buildPostIntegrationReceipt({ root, artifactCommit, manifestPath, resultsPath, contextPath, handoffPath }))
  } else fail('invalid_arguments', 'mode must be handoff or receipt')
})
