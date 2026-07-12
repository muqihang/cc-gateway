import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { assertSafeArtifact, cli, COMMIT_RE, DIGEST_RE, digestFile, exactKeys, isObject, parseArgs, readJson, result, writeExclusiveJson, type HarnessErrorRecord, type HarnessResult } from './harness-core.js'
import { POST_INTEGRATION_BINDINGS, validatePostIntegrationEntryValue, type PostIntegrationEntryManifest } from './post-integration-entry.js'
import { validatePostIntegrationCommandResultsValue, type PostIntegrationCommandResultSet } from './post-integration-command-catalog.js'

export type PostIntegrationContext = {
  schema_version: 1
  context_kind: 'post_integration_context'
  generated_at: string
  expires_at: string
  manifest_digest: string
  command_results_digest: string
  registry_digest: string
  claims_digest: string
  repositories: Array<{ name: 'cc_gateway' | 'sub2api'; commit: string; remote_ref: 'refs/remotes/muqihang/main' }>
  command_evidence: Array<{ command_id: string; status: 'pass' | 'expected_fail'; result_digest: string }>
  disabled_capabilities: string[]
  next_phase_gates: string[]
}

const fields = ['schema_version', 'context_kind', 'generated_at', 'expires_at', 'manifest_digest', 'command_results_digest', 'registry_digest', 'claims_digest', 'repositories', 'command_evidence', 'disabled_capabilities', 'next_phase_gates'] as const

export function buildPostIntegrationContext(options: { manifest: PostIntegrationEntryManifest; manifestDigest: string; results: PostIntegrationCommandResultSet; registryDigest: string; claimsDigest: string; generatedAt?: string }): PostIntegrationContext {
  const manifestValidation = validatePostIntegrationEntryValue(options.manifest, Date.parse(options.generatedAt ?? options.manifest.generated_at))
  if (!manifestValidation.ok) throw Object.assign(new Error(JSON.stringify(manifestValidation.errors)), { code: manifestValidation.errors[0].code })
  const resultValidation = validatePostIntegrationCommandResultsValue(options.results, Date.parse(options.generatedAt ?? options.results.generated_at), true)
  if (!resultValidation.ok) throw Object.assign(new Error(JSON.stringify(resultValidation.errors)), { code: resultValidation.errors[0].code })
  if (options.results.manifest_digest !== options.manifestDigest) throw Object.assign(new Error('results do not bind the post-integration manifest'), { code: 'cross_manifest_context' })
  if (!DIGEST_RE.test(options.registryDigest) || !DIGEST_RE.test(options.claimsDigest)) throw Object.assign(new Error('governance digests are invalid'), { code: 'invalid_governance_digest' })
  if (options.registryDigest !== options.manifest.governance.requirement_registry || options.claimsDigest !== options.manifest.governance.claim_registry) throw Object.assign(new Error('context governance differs from manifest'), { code: 'governance_drift' })
  if (options.results.records.some((record) => record.status !== 'pass' && record.status !== 'expected_fail')) throw Object.assign(new Error('context may contain only accepted command classifications'), { code: 'unaccepted_command_result' })
  const generated = new Date(options.generatedAt ?? new Date().toISOString())
  const context: PostIntegrationContext = {
    schema_version: 1, context_kind: 'post_integration_context', generated_at: generated.toISOString(), expires_at: new Date(generated.getTime() + 86_400_000).toISOString(),
    manifest_digest: options.manifestDigest, command_results_digest: options.results.result_set_digest, registry_digest: options.registryDigest, claims_digest: options.claimsDigest,
    repositories: [
      { name: 'cc_gateway', commit: options.manifest.repositories.cc_gateway.head, remote_ref: 'refs/remotes/muqihang/main' },
      { name: 'sub2api', commit: options.manifest.repositories.sub2api.head, remote_ref: 'refs/remotes/muqihang/main' },
    ],
    command_evidence: options.results.records.map(({ command_id, status, result_digest }) => ({ command_id, status: status as 'pass' | 'expected_fail', result_digest })).sort((a, b) => a.command_id.localeCompare(b.command_id)),
    disabled_capabilities: [...options.manifest.disabled_capabilities], next_phase_gates: [...options.manifest.next_phase_gates],
  }
  assertSafeArtifact(context)
  return context
}

export function validatePostIntegrationContextValue(value: unknown, expected: { manifestDigest: string; resultsDigest: string }, now = Date.now()): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  try { assertSafeArtifact(value) } catch (error) { errors.push({ code: (error as Error & { code?: string }).code ?? 'unsafe_artifact', path: '$', message: (error as Error).message }) }
  if (!exactKeys(value, fields, '$', errors)) return result(errors)
  if (value.schema_version !== 1 || value.context_kind !== 'post_integration_context') errors.push({ code: 'invalid_context_kind', path: '$.context_kind', message: 'only post_integration_context is accepted' })
  const generated = Date.parse(String(value.generated_at)); const expires = Date.parse(String(value.expires_at))
  if (!Number.isFinite(generated) || !Number.isFinite(expires) || expires - generated !== 86_400_000) errors.push({ code: 'invalid_expiry', path: '$.expires_at', message: 'context expires exactly 24 hours after generation' })
  else if (expires <= now) errors.push({ code: 'expired_post_integration_context', path: '$.expires_at', message: 'post-integration context is expired' })
  for (const field of ['manifest_digest', 'command_results_digest', 'registry_digest', 'claims_digest'] as const) if (!DIGEST_RE.test(String(value[field]))) errors.push({ code: 'invalid_digest', path: `$.${field}`, message: 'invalid digest' })
  if (value.manifest_digest !== expected.manifestDigest) errors.push({ code: 'cross_manifest_context', path: '$.manifest_digest', message: 'context differs from supplied manifest' })
  if (value.command_results_digest !== expected.resultsDigest) errors.push({ code: 'cross_results_context', path: '$.command_results_digest', message: 'context differs from supplied results' })
  if (!Array.isArray(value.repositories) || value.repositories.length !== 2) errors.push({ code: 'invalid_repositories', path: '$.repositories', message: 'both integrated repositories are required' })
  else for (const [index, repository] of value.repositories.entries()) {
    if (!exactKeys(repository, ['name', 'commit', 'remote_ref'], `$.repositories[${index}]`, errors)) continue
    if (!['cc_gateway', 'sub2api'].includes(String(repository.name)) || !COMMIT_RE.test(String(repository.commit)) || repository.remote_ref !== 'refs/remotes/muqihang/main') errors.push({ code: 'invalid_repository_binding', path: `$.repositories[${index}]`, message: 'invalid repository binding' })
  }
  if (!Array.isArray(value.command_evidence) || value.command_evidence.length === 0) errors.push({ code: 'invalid_command_evidence', path: '$.command_evidence', message: 'command evidence is required' })
  else for (const [index, evidence] of value.command_evidence.entries()) {
    if (!exactKeys(evidence, ['command_id', 'status', 'result_digest'], `$.command_evidence[${index}]`, errors)) continue
    if (typeof evidence.command_id !== 'string' || !['pass', 'expected_fail'].includes(String(evidence.status)) || !DIGEST_RE.test(String(evidence.result_digest))) errors.push({ code: 'invalid_command_evidence', path: `$.command_evidence[${index}]`, message: 'invalid command evidence' })
  }
  if (JSON.stringify(value.disabled_capabilities) !== JSON.stringify(POST_INTEGRATION_BINDINGS.disabledCapabilities)) errors.push({ code: 'invalid_disabled_capabilities', path: '$.disabled_capabilities', message: 'disabled capabilities must remain exact' })
  if (JSON.stringify(value.next_phase_gates) !== JSON.stringify(POST_INTEGRATION_BINDINGS.nextPhaseGates)) errors.push({ code: 'invalid_next_phase_gates', path: '$.next_phase_gates', message: 'next phase gates must remain exact' })
  return result(errors)
}

if (realpathSync(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) cli(() => {
  const args = parseArgs(process.argv.slice(2)); const manifestPath = args.values.manifest?.[0]; const resultsPath = args.values.results?.[0]; const registryPath = args.values.registry?.[0]; const claimsPath = args.values.claims?.[0]; const out = args.values.out?.[0]
  if (!manifestPath || !resultsPath || !registryPath || !claimsPath || !out) throw Object.assign(new Error('--manifest, --results, --registry, --claims, and --out are required'), { code: 'invalid_arguments' })
  const manifest = readJson(manifestPath) as PostIntegrationEntryManifest; const results = readJson(resultsPath) as PostIntegrationCommandResultSet
  const context = buildPostIntegrationContext({ manifest, manifestDigest: digestFile(manifestPath), results, registryDigest: digestFile(registryPath), claimsDigest: digestFile(claimsPath) })
  writeExclusiveJson(out, context)
})
