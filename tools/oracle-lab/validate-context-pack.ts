import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertSafeArtifact, cli, COMMIT_RE, DIGEST_RE, digestFile, digestValue, exactKeys, isObject, parseArgs, readJson, requireValid, result, type HarnessErrorRecord, type HarnessResult } from './harness-core.js'
import type { CommandCatalogEntry } from './validate-command-catalog.js'

export type ContextPack = {
  schema_version: 1
  generated_at: string
  expires_at: string
  registry_digest: string
  claims_digest: string
  manifest_digest: string
  requirement_ids: string[]
  repositories: Array<{ name: string; commit: string; dirty_digest: string }>
  sources: Array<{ path: string; repository?: 'cc_gateway' | 'sub2api'; symbol?: string; line?: number; digest: string }>
  tests: Array<{ command_id: string; status: 'pass' | 'expected_fail' | 'unexpected_fail' | 'unexpected_pass'; result_digest: string }>
  known_unknowns: string[]
}

const fields = ['schema_version', 'generated_at', 'expires_at', 'registry_digest', 'claims_digest', 'manifest_digest', 'requirement_ids', 'repositories', 'sources', 'tests', 'known_unknowns'] as const

type BoundCommandEvidence = { command_id: string; status: string; result_digest: string }

export function assertContextCommandEvidence(context: Pick<ContextPack, 'requirement_ids' | 'tests'>, catalog: CommandCatalogEntry[], boundCommands: BoundCommandEvidence[]): void {
  for (const requirementId of context.requirement_ids) {
    if (!catalog.some((entry) => entry.requirement_ids.includes(requirementId))) {
      throw Object.assign(new Error(`${requirementId} has no catalog command evidence`), { code: 'missing_requirement_command_evidence' })
    }
  }
  const selectedCommandIds = catalog.filter((entry) => entry.requirement_ids.some((id) => context.requirement_ids.includes(id))).map((entry) => entry.id).sort()
  const contextCommandIds = context.tests.map((entry) => entry.command_id).sort()
  if (JSON.stringify(selectedCommandIds) !== JSON.stringify(contextCommandIds)) {
    throw Object.assign(new Error('context does not contain the exact catalog command evidence for its requirements'), { code: 'context_command_evidence_mismatch' })
  }
  const boundById = new Map(boundCommands.map((command) => [command.command_id, command]))
  if (context.tests.some((test) => {
    const bound = boundById.get(test.command_id)
    return !bound || bound.result_digest !== test.result_digest || bound.status !== test.status
  })) {
    throw Object.assign(new Error('context tests do not match bound command results'), { code: 'cross_result_context' })
  }
}

export function contextPackDigest(pack: ContextPack): string {
  const { generated_at: _generated, expires_at: _expires, ...stable } = pack
  return digestValue(stable)
}

export function validateContextPackValue(value: unknown, now = Date.now(), verifySources = true): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  try { assertSafeArtifact(value) } catch (error) { errors.push({ code: 'secret_canary', path: '$', message: (error as Error).message }) }
  if (!exactKeys(value, fields, '$', errors)) return result(errors)
  if (value.schema_version !== 1) errors.push({ code: 'unsupported_schema_version', path: '$.schema_version', message: 'only schema_version 1 is supported' })
  for (const key of ['registry_digest', 'claims_digest', 'manifest_digest'] as const) if (!DIGEST_RE.test(String(value[key]))) errors.push({ code: 'invalid_digest', path: `$.${key}`, message: `${key} is invalid` })
  const generated = Date.parse(String(value.generated_at)); const expires = Date.parse(String(value.expires_at))
  if (!Number.isFinite(generated) || !Number.isFinite(expires) || expires - generated !== 86_400_000) errors.push({ code: 'invalid_expiry', path: '$.expires_at', message: 'context packs expire exactly 24 hours after generation' })
  else if (expires <= now) errors.push({ code: 'expired_context_pack', path: '$.expires_at', message: 'context pack is expired' })
  if (!Array.isArray(value.requirement_ids) || value.requirement_ids.length === 0 || value.requirement_ids.some((id) => typeof id !== 'string') || new Set(value.requirement_ids).size !== value.requirement_ids.length) errors.push({ code: 'invalid_requirements', path: '$.requirement_ids', message: 'requirement IDs must be unique strings' })
  if (!Array.isArray(value.repositories) || value.repositories.length === 0) errors.push({ code: 'missing_repository_digests', path: '$.repositories', message: 'repositories are required' })
  else { const names = new Set<string>(); for (const [index, repository] of value.repositories.entries()) {
    if (!exactKeys(repository, ['name', 'commit', 'dirty_digest'], `$.repositories[${index}]`, errors)) continue
    if (typeof repository.name !== 'string' || !COMMIT_RE.test(String(repository.commit)) || !DIGEST_RE.test(String(repository.dirty_digest))) errors.push({ code: 'missing_repository_digests', path: `$.repositories[${index}]`, message: 'repository provenance is incomplete' })
    else if (names.has(repository.name)) errors.push({ code: 'duplicate_repository', path: `$.repositories[${index}].name`, message: 'repository names must be unique' }); else names.add(repository.name)
  } }
  if (!Array.isArray(value.sources) || value.sources.length === 0) errors.push({ code: 'invalid_sources', path: '$.sources', message: 'sources are required' })
  else for (const [index, source] of value.sources.entries()) {
    const sourceFields = ['path', ...isObject(source) && 'repository' in source ? ['repository'] : [], 'digest', ...isObject(source) && 'symbol' in source ? ['symbol'] : [], ...isObject(source) && 'line' in source ? ['line'] : []]
    if (!exactKeys(source, sourceFields, `$.sources[${index}]`, errors)) continue
    if (typeof source.path !== 'string' || path.isAbsolute(source.path) || source.path.split('/').includes('..') || !DIGEST_RE.test(String(source.digest))) errors.push({ code: 'invalid_source', path: `$.sources[${index}]`, message: 'source reference is invalid' })
    else if (verifySources) { try { const root = source.repository === 'sub2api' ? process.env.SUB2API_ROOT : process.cwd(); const absolute = path.resolve(root ?? '', source.path); if (digestFile(absolute) !== source.digest) errors.push({ code: 'source_digest_mismatch', path: `$.sources[${index}].digest`, message: 'source digest mismatch' }) } catch { errors.push({ code: 'missing_source', path: `$.sources[${index}].path`, message: 'source is missing' }) } }
    if ('symbol' in source && (typeof source.symbol !== 'string' || source.symbol === '')) errors.push({ code: 'invalid_source', path: `$.sources[${index}].symbol`, message: 'symbol is invalid' })
    if ('line' in source && (!Number.isInteger(source.line) || Number(source.line) < 1)) errors.push({ code: 'invalid_source', path: `$.sources[${index}].line`, message: 'line is invalid' })
  }
  if (!Array.isArray(value.tests) || value.tests.length === 0) errors.push({ code: 'invalid_tests', path: '$.tests', message: 'tests must be a non-empty array' })
  else { const commandIds = new Set<string>(); for (const [index, test] of value.tests.entries()) {
    if (!exactKeys(test, ['command_id', 'status', 'result_digest'], `$.tests[${index}]`, errors)) continue
    if (typeof test.command_id !== 'string' || !['pass', 'expected_fail', 'unexpected_fail', 'unexpected_pass'].includes(String(test.status)) || !DIGEST_RE.test(String(test.result_digest))) errors.push({ code: 'invalid_test', path: `$.tests[${index}]`, message: 'test reference is invalid' })
    else if (commandIds.has(test.command_id)) errors.push({ code: 'duplicate_command_id', path: `$.tests[${index}].command_id`, message: 'test command IDs must be unique' }); else commandIds.add(test.command_id)
  } }
  if (!Array.isArray(value.known_unknowns) || value.known_unknowns.some((entry) => typeof entry !== 'string')) errors.push({ code: 'invalid_known_unknowns', path: '$.known_unknowns', message: 'known_unknowns must be strings' })
  return result(errors)
}

if (realpathSync(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) cli(() => {
  const args = parseArgs(process.argv.slice(2)); const pack = args.values.pack?.[0]
  if (!pack) throw Object.assign(new Error('--pack is required'), { code: 'invalid_arguments' })
  requireValid(validateContextPackValue(readJson(pack))); console.log(JSON.stringify({ valid: true }))
})
