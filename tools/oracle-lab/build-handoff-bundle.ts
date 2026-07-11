import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { validateManifestArtifact } from './freeze-baseline.js'
import { assertEvidencePath, assertSafeArtifact, cli, digestFile, exactKeys, isObject, parseArgs, readJson, requireValid, result, writeJson, type HarnessErrorRecord, type HarnessResult } from './harness-core.js'
import { validateCommandResultsValue, type CommandResultSet } from './merge-command-results.js'
import { validateCommandResultsBindings } from './merge-command-results.js'
import { validateCommandCatalogValue, type CommandCatalogEntry } from './validate-command-catalog.js'
import { validateContextPackValue, type ContextPack } from './validate-context-pack.js'

export type HandoffBundle = {
  schema_version: 1
  phase: string
  generated_at: string
  expires_at: string
  baseline_digest: string
  command_results_digest: string
  context_pack_digest?: string
  repositories: Array<{ name: string; commit: string; dirty_digest: string }>
  commands: Array<{ command_id: string; status: string; result_digest: string }>
  artifacts: Array<{ path: string; digest: string }>
  known_unknowns: string[]
  retention_policy: { digest_only: string; redacted_excerpt: string }
  redaction_policy: string
  destruction_procedure: string
}

const fields = ['schema_version', 'phase', 'generated_at', 'expires_at', 'baseline_digest', 'command_results_digest', 'context_pack_digest', 'repositories', 'commands', 'artifacts', 'known_unknowns', 'retention_policy', 'redaction_policy', 'destruction_procedure'] as const

function baselineShape(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.repositories)) return false
  return ['cc_gateway', 'sub2api'].every((key) => isObject(value.repositories?.[key]) && typeof value.repositories[key].head === 'string' && typeof value.repositories[key].dirty_digest === 'string')
}

export function validateHandoffValue(value: unknown, now = Date.now(), verifyArtifacts = true): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  try { assertSafeArtifact(value) } catch (error) { errors.push({ code: 'secret_canary', path: '$', message: (error as Error).message }) }
  if (!exactKeys(value, fields.filter((field) => field !== 'context_pack_digest' || isObject(value) && field in value), '$', errors)) return result(errors)
  if (value.schema_version !== 1) errors.push({ code: 'unsupported_schema_version', path: '$.schema_version', message: 'only schema_version 1 is supported' })
  for (const key of ['baseline_digest', 'command_results_digest', ...(value.context_pack_digest ? ['context_pack_digest'] : [])] as const) if (!/^sha256:[0-9a-f]{64}$/.test(String(value[key]))) errors.push({ code: 'invalid_digest', path: `$.${key}`, message: 'invalid digest' })
  const generated = Date.parse(String(value.generated_at)); const expires = Date.parse(String(value.expires_at)); if (!Number.isFinite(generated) || !Number.isFinite(expires) || expires <= generated) errors.push({ code: 'invalid_expiry', path: '$.expires_at', message: 'invalid expiry' }); else if (expires <= now) errors.push({ code: 'expired_handoff', path: '$.expires_at', message: 'handoff is expired' })
  if (typeof value.phase !== 'string' || value.phase === '') errors.push({ code: 'invalid_phase', path: '$.phase', message: 'phase is required' })
  if (!Array.isArray(value.repositories) || value.repositories.length === 0) errors.push({ code: 'missing_repository_digests', path: '$.repositories', message: 'repository provenance is required' })
  else { const names = new Set<string>(); for (const [index, repository] of value.repositories.entries()) { if (!exactKeys(repository, ['name', 'commit', 'dirty_digest'], `$.repositories[${index}]`, errors)) continue; if (!['cc_gateway', 'sub2api'].includes(String(repository.name)) || names.has(String(repository.name)) || !/^[0-9a-f]{40,64}$/.test(String(repository.commit)) || !/^sha256:[0-9a-f]{64}$/.test(String(repository.dirty_digest))) errors.push({ code: 'missing_repository_digests', path: `$.repositories[${index}]`, message: 'invalid repository provenance' }); else names.add(String(repository.name)) } if (names.size !== 2) errors.push({ code: 'missing_repository_digests', path: '$.repositories', message: 'cc_gateway and sub2api provenance are required' }) }
  if (!Array.isArray(value.commands) || value.commands.length === 0) errors.push({ code: 'invalid_commands', path: '$.commands', message: 'command summaries are required' })
  else { const ids = new Set<string>(); for (const [index, command] of value.commands.entries()) { if (!exactKeys(command, ['command_id', 'status', 'result_digest'], `$.commands[${index}]`, errors)) continue; if (typeof command.command_id !== 'string' || ids.has(command.command_id) || !['pass', 'expected_fail'].includes(String(command.status)) || !/^sha256:[0-9a-f]{64}$/.test(String(command.result_digest))) errors.push({ code: 'invalid_commands', path: `$.commands[${index}]`, message: 'invalid command summary' }); else ids.add(command.command_id) } }
  if (!Array.isArray(value.artifacts) || value.artifacts.length === 0) errors.push({ code: 'missing_artifacts', path: '$.artifacts', message: 'artifacts are required' })
  else for (const [index, artifact] of value.artifacts.entries()) { if (!exactKeys(artifact, ['path', 'digest'], `$.artifacts[${index}]`, errors)) continue; if (typeof artifact.path !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(String(artifact.digest))) errors.push({ code: 'invalid_artifact', path: `$.artifacts[${index}]`, message: 'invalid artifact reference' }); else { try { assertEvidencePath(artifact.path); if (verifyArtifacts && digestFile(artifact.path) !== artifact.digest) errors.push({ code: 'artifact_digest_mismatch', path: `$.artifacts[${index}]`, message: 'artifact digest mismatch' }) } catch (error) { errors.push({ code: (error as Error & { code?: string }).code ?? 'missing_artifact', path: `$.artifacts[${index}]`, message: (error as Error).message }) } } }
  if (!Array.isArray(value.known_unknowns) || value.known_unknowns.some((entry) => typeof entry !== 'string')) errors.push({ code: 'invalid_known_unknowns', path: '$.known_unknowns', message: 'known_unknowns must be strings' })
  if (!exactKeys(value.retention_policy, ['digest_only', 'redacted_excerpt'], '$.retention_policy', errors) || value.retention_policy.digest_only !== 'phase_evidence_permanent' || value.retention_policy.redacted_excerpt !== '7_days') errors.push({ code: 'invalid_retention_policy', path: '$.retention_policy', message: 'invalid retention policy' })
  if (value.redaction_policy !== 'digests_and_safe_redacted_excerpts_only' || value.destruction_procedure !== 'git_revert_artifact_commit_after_security_approval') errors.push({ code: 'invalid_metadata', path: '$', message: 'redaction and destruction policy are invalid' })
  return result(errors)
}

export function buildHandoff(options: { phase: string; baseline: string; commandResults: string; context?: string; catalog?: string; out?: string; generatedAt?: string }): HandoffBundle {
  const baseline = readJson(options.baseline)
  try { validateManifestArtifact(baseline) } catch { if (!baselineShape(baseline)) throw Object.assign(new Error('baseline is invalid'), { code: 'invalid_baseline' }) }
  const results = readJson(options.commandResults); requireValid(validateCommandResultsValue(results)); const typedResults = results as CommandResultSet
  const catalogPath = options.catalog ?? 'docs/superpowers/registry/oracle-lab-command-catalog.json'
  const catalogValue = readJson(catalogPath); requireValid(validateCommandCatalogValue(catalogValue)); const catalog = catalogValue as CommandCatalogEntry[]
  requireValid(validateCommandResultsBindings(typedResults, catalog, baseline, { catalogDigest: digestFile(catalogPath), manifestDigest: digestFile(options.baseline), requireGroups: ['phase0-green', 'phase0-red'] }))
  if (typedResults.records.some((record) => record.status === 'unexpected_fail' || record.status === 'unexpected_pass')) throw Object.assign(new Error('handoff cannot contain unexpected command results'), { code: 'unexpected_command_result' })
  let context: ContextPack | undefined
  if (options.context) {
    const value = readJson(options.context); requireValid(validateContextPackValue(value)); context = value as ContextPack
    if (context.manifest_digest !== digestFile(options.baseline)) throw Object.assign(new Error('context does not match baseline'), { code: 'cross_manifest_context' })
    if (JSON.stringify(context.repositories) !== JSON.stringify(Object.entries((baseline as { repositories: Record<string, { head: string; dirty_digest: string }> }).repositories).map(([name, repository]) => ({ name, commit: repository.head, dirty_digest: `sha256:${repository.dirty_digest}` })).sort((a, b) => a.name.localeCompare(b.name)))) throw Object.assign(new Error('context repositories do not match baseline'), { code: 'cross_repository_context' })
    const resultDigests = new Map(typedResults.records.map((record) => [record.command_id, record.result_digest]))
    if (context.tests.some((test) => resultDigests.get(test.command_id) !== test.result_digest)) throw Object.assign(new Error('context tests do not match command results'), { code: 'cross_result_context' })
  }
  const generated = new Date(options.generatedAt ?? new Date().toISOString())
  const artifacts = [{ path: options.baseline, digest: digestFile(options.baseline) }, ...(options.context ? [{ path: options.context, digest: digestFile(options.context) }] : [])]
  for (const artifact of artifacts) assertEvidencePath(artifact.path)
  if (!isObject(baseline) || !isObject(baseline.repositories)) throw Object.assign(new Error('baseline repositories are missing'), { code: 'missing_repository_digests' })
  const repositories = Object.entries(baseline.repositories).map(([name, value]) => ({ name, commit: String((value as Record<string, unknown>).head), dirty_digest: `sha256:${String((value as Record<string, unknown>).dirty_digest)}` })).sort((a, b) => a.name.localeCompare(b.name))
  const handoff: HandoffBundle = { schema_version: 1, phase: options.phase, generated_at: generated.toISOString(), expires_at: new Date(generated.getTime() + 86_400_000).toISOString(), baseline_digest: digestFile(options.baseline), command_results_digest: typedResults.result_set_digest, ...(context ? { context_pack_digest: digestFile(options.context!) } : {}), repositories, commands: typedResults.records.map((record) => ({ command_id: record.command_id, status: record.status, result_digest: record.result_digest })).sort((a, b) => a.command_id.localeCompare(b.command_id)), artifacts, known_unknowns: context?.known_unknowns ?? [], retention_policy: { digest_only: 'phase_evidence_permanent', redacted_excerpt: '7_days' }, redaction_policy: 'digests_and_safe_redacted_excerpts_only', destruction_procedure: 'git_revert_artifact_commit_after_security_approval' }
  requireValid(validateHandoffValue(handoff)); return handoff
}

if (realpathSync(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) cli(() => {
  const args = parseArgs(process.argv.slice(2)); const phase = args.values.phase?.[0]; const baseline = args.values.baseline?.[0]; const commandResults = args.values['command-results']?.[0]; const out = args.values.out?.[0]
  if (!phase || !baseline || !commandResults || !out) throw Object.assign(new Error('--phase, --baseline, --command-results, and --out are required'), { code: 'invalid_arguments' })
  writeJson(out, buildHandoff({ phase, baseline, commandResults, context: args.values.context?.[0], catalog: args.values.catalog?.[0] }))
})
