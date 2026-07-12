import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertSafeArtifact, canonicalJson, cli, COMMIT_RE, DIGEST_RE, digestFile, digestValue, exactKeys, getField, isObject, parseArgs, readJson, result, sha256, writeExclusiveJson, type HarnessErrorRecord, type HarnessResult } from './harness-core.js'
import { validatePostIntegrationEntryArtifact, type PostIntegrationEntryManifest } from './post-integration-entry.js'

export type PostIntegrationCommandCatalogEntry = {
  id: string; schema_version: 1; group: 'post-integration-green' | 'post-integration-red'; owner: string; requirement_ids: string[]
  repository: 'cc-gateway' | 'sub2api' | 'egress-tls-sidecar'; cwd: '${CC_GATEWAY_ROOT}' | '${SUB2API_ROOT}/backend' | '${CC_GATEWAY_ROOT}/sidecar/egress-tls-sidecar'
  argv: string[]; env: Record<string, string>; inherit_env: Array<'PATH' | 'HOME' | 'TMPDIR'>
  manifest_binding: { manifest_path: '${POST_INTEGRATION_MANIFEST}'; repository_head_field: string; contract_digest_field?: 'contract.sha256' }
  allowed_worktree_delta: []; timeout_ms: number; expected_exit: 0 | 'nonzero'; output_policy: 'digest_only' | 'redacted_excerpt'; rollback: string
}
type CommandStatus = 'pass' | 'expected_fail' | 'unexpected_fail' | 'unexpected_pass'
export type PostIntegrationCommandResultRecord = {
  command_id: string; repository: 'cc-gateway' | 'sub2api' | 'egress-tls-sidecar'; repository_commit: string; contract_digest?: string
  manifest_digest: string; environment_digest: string; exit_code: number; expected_exit: 0 | 'nonzero'; status: CommandStatus
  duration_ms: number; output_digest: string; output_excerpt?: string; result_digest: string
}
export type PostIntegrationCommandResultSet = {
  schema_version: 1; generated_at: string; expires_at: string; catalog_digest: string; manifest_digest: string
  records: PostIntegrationCommandResultRecord[]; result_set_digest: string
}
const fields = ['id', 'schema_version', 'group', 'owner', 'requirement_ids', 'repository', 'cwd', 'argv', 'env', 'inherit_env', 'manifest_binding', 'allowed_worktree_delta', 'timeout_ms', 'expected_exit', 'output_policy', 'rollback'] as const
const resultSetFields = ['schema_version', 'generated_at', 'expires_at', 'catalog_digest', 'manifest_digest', 'records', 'result_set_digest'] as const
const resultRecordFields = ['command_id', 'repository', 'repository_commit', 'contract_digest', 'manifest_digest', 'environment_digest', 'exit_code', 'expected_exit', 'status', 'duration_ms', 'output_digest', 'output_excerpt', 'result_digest'] as const
const cwdByRepository: Record<string, string> = { 'cc-gateway': '${CC_GATEWAY_ROOT}', sub2api: '${SUB2API_ROOT}/backend', 'egress-tls-sidecar': '${CC_GATEWAY_ROOT}/sidecar/egress-tls-sidecar' }
const expectedCommandGroups = new Map<string, PostIntegrationCommandCatalogEntry['group']>([
  ['cc-build', 'post-integration-green'],
  ['cc-test', 'post-integration-green'],
  ['cc-cross-repo-baseline', 'post-integration-green'],
  ['sidecar-test', 'post-integration-green'],
  ['sub2api-test', 'post-integration-green'],
  ['cc-b4-b6-red', 'post-integration-red'],
  ['sidecar-b4-b6-red', 'post-integration-red'],
  ['sub2api-b1-b3-red', 'post-integration-red'],
])

function expectedStatus(exitCode: number, expectedExit: 0 | 'nonzero'): CommandStatus { return expectedExit === 0 ? (exitCode === 0 ? 'pass' : 'unexpected_fail') : (exitCode === 0 ? 'unexpected_pass' : 'expected_fail') }
export function postIntegrationCommandRecordDigest(record: Omit<PostIntegrationCommandResultRecord, 'duration_ms' | 'result_digest'> & { duration_ms?: number }): string { const { duration_ms: _duration, ...stable } = record; return digestValue(stable) }
export function postIntegrationCommandSetDigest(set: Omit<PostIntegrationCommandResultSet, 'result_set_digest'>): string { const { generated_at: _generated, expires_at: _expires, ...stable } = set; return digestValue({ ...stable, records: set.records.map(({ duration_ms: _duration, ...record }) => record) }) }

export function validatePostIntegrationCommandCatalogValue(value: unknown): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  if (!Array.isArray(value) || value.length === 0) return result([{ code: 'invalid_catalog', path: '$', message: 'catalog must be non-empty' }])
  const ids = new Set<string>()
  for (const [index, entry] of value.entries()) {
    const base = `$[${index}]`
    if (!exactKeys(entry, fields, base, errors)) continue
    if (entry.schema_version !== 1) errors.push({ code: 'unsupported_schema_version', path: `${base}.schema_version`, message: 'schema version must be 1' })
    if (typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(entry.id) || ids.has(entry.id)) errors.push({ code: 'invalid_command_id', path: `${base}.id`, message: 'command ID is invalid or duplicated' }); else ids.add(entry.id)
    if (!['post-integration-green', 'post-integration-red'].includes(String(entry.group))) errors.push({ code: 'invalid_group', path: `${base}.group`, message: 'dedicated post-integration group is required' })
    if (!isObject(entry.manifest_binding) || !exactKeys(entry.manifest_binding, ['manifest_path', 'repository_head_field', ...(entry.repository === 'sub2api' ? ['contract_digest_field'] : [])], `${base}.manifest_binding`, errors)) continue
    if (entry.manifest_binding.manifest_path !== '${POST_INTEGRATION_MANIFEST}') errors.push({ code: 'invalid_manifest_binding', path: `${base}.manifest_binding.manifest_path`, message: 'post-integration manifest is required' })
    const expectedHead = entry.repository === 'sub2api' ? 'repositories.sub2api.head' : 'repositories.cc_gateway.head'
    if (entry.manifest_binding.repository_head_field !== expectedHead || (entry.repository === 'sub2api' && entry.manifest_binding.contract_digest_field !== 'contract.sha256')) errors.push({ code: 'invalid_manifest_binding', path: `${base}.manifest_binding`, message: 'repository binding is invalid' })
    if (!(String(entry.repository) in cwdByRepository) || entry.cwd !== cwdByRepository[String(entry.repository)]) errors.push({ code: 'invalid_cwd', path: `${base}.cwd`, message: 'cwd does not match repository' })
    if (!Array.isArray(entry.argv) || entry.argv.length === 0 || entry.argv.some((item) => typeof item !== 'string') || ['sh', 'bash', 'zsh'].includes(String(entry.argv[0])) || entry.argv.includes('-c')) errors.push({ code: 'shell_string_command', path: `${base}.argv`, message: 'argv must not use a shell' })
    if (!isObject(entry.env) || entry.env.POST_INTEGRATION_MANIFEST !== '${POST_INTEGRATION_MANIFEST}') errors.push({ code: 'invalid_env', path: `${base}.env`, message: 'manifest environment binding is required' })
    if (entry.id === 'cc-cross-repo-baseline' && (
      canonicalJson(entry.argv) !== canonicalJson(['npm', 'run', 'test:oracle:cross-repo'])
      || !isObject(entry.env)
      || entry.env.SUB2API_ROOT !== '${SUB2API_ROOT}'
    )) errors.push({ code: 'invalid_cross_repo_command', path: base, message: 'cross-repository command and explicit Sub2API capture root are required' })
    if (!Array.isArray(entry.inherit_env) || entry.inherit_env.some((name) => !['PATH', 'HOME', 'TMPDIR'].includes(String(name)))) errors.push({ code: 'invalid_inherit_env', path: `${base}.inherit_env`, message: 'unsafe environment inheritance' })
    if (!Array.isArray(entry.allowed_worktree_delta) || entry.allowed_worktree_delta.length !== 0) errors.push({ code: 'invalid_worktree_delta', path: `${base}.allowed_worktree_delta`, message: 'integrated main worktrees must remain unchanged' })
    if (!Number.isInteger(entry.timeout_ms) || Number(entry.timeout_ms) < 1 || Number(entry.timeout_ms) > 3_600_000) errors.push({ code: 'invalid_timeout', path: `${base}.timeout_ms`, message: 'invalid timeout' })
    if (entry.group === 'post-integration-green' && entry.expected_exit !== 0 || entry.group === 'post-integration-red' && entry.expected_exit !== 'nonzero') errors.push({ code: 'invalid_expected_exit', path: `${base}.expected_exit`, message: 'exit does not match group' })
    if (!['digest_only', 'redacted_excerpt'].includes(String(entry.output_policy))) errors.push({ code: 'invalid_output_policy', path: `${base}.output_policy`, message: 'invalid output policy' })
    if (typeof entry.owner !== 'string' || !Array.isArray(entry.requirement_ids) || entry.requirement_ids.length === 0 || typeof entry.rollback !== 'string') errors.push({ code: 'invalid_catalog_metadata', path: base, message: 'owner, requirements, and rollback are required' })
  }
  for (const [id, group] of expectedCommandGroups) {
    const entry = value.find((candidate) => isObject(candidate) && candidate.id === id)
    if (!entry || entry.group !== group) errors.push({ code: 'incomplete_command_catalog', path: '$', message: `${group} requires ${id}` })
  }
  if (value.length !== expectedCommandGroups.size || ids.size !== expectedCommandGroups.size) errors.push({ code: 'invalid_command_inventory', path: '$', message: 'exactly five GREEN and three RED commands are required' })
  return result(errors)
}

export function validatePostIntegrationCommandResultsValue(value: unknown, now = Date.now(), allowExpired = false): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  try { assertSafeArtifact(value) } catch (error) { errors.push({ code: (error as Error & { code?: string }).code ?? 'unsafe_artifact', path: '$', message: (error as Error).message }) }
  if (!exactKeys(value, resultSetFields, '$', errors)) return result(errors)
  if (value.schema_version !== 1) errors.push({ code: 'unsupported_schema_version', path: '$.schema_version', message: 'schema version must be 1' })
  for (const field of ['catalog_digest', 'manifest_digest', 'result_set_digest'] as const) if (!DIGEST_RE.test(String(value[field]))) errors.push({ code: 'invalid_digest', path: `$.${field}`, message: 'invalid digest' })
  const generated = Date.parse(String(value.generated_at)); const expires = Date.parse(String(value.expires_at))
  if (!Number.isFinite(generated) || !Number.isFinite(expires) || expires - generated !== 7 * 86_400_000) errors.push({ code: 'invalid_expiry', path: '$.expires_at', message: 'results expire exactly seven days after generation' })
  else if (!allowExpired && expires <= now) errors.push({ code: 'expired_results', path: '$.expires_at', message: 'results expired' })
  if (!Array.isArray(value.records) || value.records.length === 0) errors.push({ code: 'invalid_records', path: '$.records', message: 'records are required' })
  else {
    const ids = new Set<string>()
    for (const [index, record] of value.records.entries()) {
      const base = `$.records[${index}]`; if (!exactKeys(record, resultRecordFields.filter((field) => (field !== 'contract_digest' && field !== 'output_excerpt') || isObject(record) && field in record), base, errors)) continue
      if (typeof record.command_id !== 'string' || ids.has(record.command_id)) errors.push({ code: 'duplicate_command_id', path: `${base}.command_id`, message: 'command IDs must be unique' }); else ids.add(record.command_id)
      if (!['cc-gateway', 'sub2api', 'egress-tls-sidecar'].includes(String(record.repository)) || !COMMIT_RE.test(String(record.repository_commit))) errors.push({ code: 'invalid_repository_binding', path: base, message: 'repository binding is invalid' })
      for (const field of ['manifest_digest', 'environment_digest', 'output_digest', 'result_digest'] as const) if (!DIGEST_RE.test(String(record[field]))) errors.push({ code: 'invalid_digest', path: `${base}.${field}`, message: 'invalid digest' })
      if ('contract_digest' in record && !DIGEST_RE.test(String(record.contract_digest))) errors.push({ code: 'invalid_digest', path: `${base}.contract_digest`, message: 'invalid contract digest' })
      if (record.manifest_digest !== value.manifest_digest) errors.push({ code: 'cross_manifest_results', path: `${base}.manifest_digest`, message: 'record differs from result set manifest' })
      if (!Number.isInteger(record.exit_code) || Number(record.exit_code) < 0 || !Number.isInteger(record.duration_ms) || Number(record.duration_ms) < 0) errors.push({ code: 'invalid_result', path: base, message: 'exit and duration must be non-negative integers' })
      if (![0, 'nonzero'].includes(record.expected_exit as never) || !['pass', 'expected_fail', 'unexpected_fail', 'unexpected_pass'].includes(String(record.status))) errors.push({ code: 'invalid_result', path: base, message: 'classification is invalid' })
      else if (record.status !== expectedStatus(Number(record.exit_code), record.expected_exit as 0 | 'nonzero')) errors.push({ code: 'classification_mismatch', path: `${base}.status`, message: 'classification differs from real exit' })
      if ('output_excerpt' in record && (typeof record.output_excerpt !== 'string' || record.output_excerpt.length > 2048)) errors.push({ code: 'invalid_excerpt', path: `${base}.output_excerpt`, message: 'excerpt is invalid' })
      const typed = record as unknown as PostIntegrationCommandResultRecord; const { result_digest: _digest, duration_ms, ...unsigned } = typed
      if (typed.result_digest !== postIntegrationCommandRecordDigest({ ...unsigned, duration_ms })) errors.push({ code: 'result_digest_mismatch', path: `${base}.result_digest`, message: 'record digest mismatch' })
    }
    const typed = value as unknown as PostIntegrationCommandResultSet; const { result_set_digest: _digest, ...unsigned } = typed
    if (typed.result_set_digest !== postIntegrationCommandSetDigest(unsigned)) errors.push({ code: 'result_set_digest_mismatch', path: '$.result_set_digest', message: 'result set digest mismatch' })
  }
  return result(errors)
}

export function validatePostIntegrationResultsBindings(results: PostIntegrationCommandResultSet, catalog: PostIntegrationCommandCatalogEntry[], manifest: PostIntegrationEntryManifest, expected: { catalogDigest: string; manifestDigest: string; requireGroups?: Array<'post-integration-green' | 'post-integration-red'> }, now = Date.now()): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  const structural = validatePostIntegrationCommandResultsValue(results, now)
  if (!structural.ok) errors.push(...structural.errors)
  if (results.catalog_digest !== expected.catalogDigest) errors.push({ code: 'cross_catalog_results', path: '$.catalog_digest', message: 'results differ from catalog' })
  if (results.manifest_digest !== expected.manifestDigest) errors.push({ code: 'cross_manifest_results', path: '$.manifest_digest', message: 'results differ from manifest' })
  const entries = new Map(catalog.map((entry) => [entry.id, entry])); const seen = new Set<string>()
  for (const [index, record] of results.records.entries()) {
    const entry = entries.get(record.command_id)
    if (!entry) { errors.push({ code: 'unknown_command_result', path: `$.records[${index}]`, message: 'command is not in catalog' }); continue }
    seen.add(record.command_id)
    const head = entry.repository === 'sub2api' ? manifest.repositories.sub2api.head : manifest.repositories.cc_gateway.head
    if (record.repository !== entry.repository || record.repository_commit !== head || record.expected_exit !== entry.expected_exit) errors.push({ code: 'catalog_result_mismatch', path: `$.records[${index}]`, message: 'result binding differs from catalog or manifest' })
    if (record.manifest_digest !== expected.manifestDigest) errors.push({ code: 'cross_manifest_results', path: `$.records[${index}].manifest_digest`, message: 'record differs from manifest' })
    if (entry.repository === 'sub2api' && record.contract_digest !== manifest.contract.sha256) errors.push({ code: 'contract_digest_mismatch', path: `$.records[${index}].contract_digest`, message: 'contract differs from manifest' })
  }
  for (const group of expected.requireGroups ?? []) for (const entry of catalog.filter((candidate) => candidate.group === group)) if (!seen.has(entry.id)) errors.push({ code: 'incomplete_result_set', path: '$.records', message: `${group} is missing ${entry.id}` })
  if ((expected.requireGroups ?? []).length === 2 && (results.records.length !== expectedCommandGroups.size || seen.size !== expectedCommandGroups.size)) errors.push({ code: 'invalid_command_inventory', path: '$.records', message: 'exactly five GREEN and three RED command results are required' })
  return result(errors)
}

function expand(value: string, roots: Record<string, string>): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
    if (!roots[name]) throw Object.assign(new Error(`${name} is undeclared`), { code: 'undeclared_expansion' })
    return roots[name]
  })
}
export function postIntegrationCommandEnvironment(entry: PostIntegrationCommandCatalogEntry, roots: Record<string, string>, sourceEnvironment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(entry.inherit_env.map((name) => [name, sourceEnvironment[name] ?? '']))
  const declared = Object.fromEntries(Object.entries(entry.env).map(([key, value]) => [key, expand(value, roots)]))
  return { ...inherited, ...declared }
}
function git(root: string, ...args: string[]): string { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim() }
function status(root: string): Buffer { return execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { encoding: 'buffer' }) }
function execute(argv: string[], cwd: string, env: NodeJS.ProcessEnv, timeout: number): Promise<{ exitCode: number; durationMs: number; output: Buffer }> {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint(); const chunks: Buffer[] = []; const child = spawn(argv[0], argv.slice(1), { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk)); child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk))
    let timedOut = false; const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeout)
    child.on('error', (error) => chunks.push(Buffer.from(error.message))); child.on('close', (code) => { clearTimeout(timer); resolve({ exitCode: timedOut ? 124 : code ?? 127, durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n), output: Buffer.concat(chunks) }) })
  })
}
function redact(output: string): string { return output.replace(/(?:Cookie|Set-Cookie|Authorization)\s*:.*$/gim, '[REDACTED]').replace(/(?:\/Users\/|\/home\/|\/tmp\/)[^\s"']+/g, '[REDACTED_PATH]').replace(/[\r\n]+/g, ' ').slice(0, 2048) }

export async function runPostIntegrationCommandCatalog(catalogPath: string, group: 'post-integration-green' | 'post-integration-red', rootsInput: { CC_GATEWAY_ROOT: string; SUB2API_ROOT: string; TOOL_ROOT: string; POST_INTEGRATION_MANIFEST: string }, generatedAt = new Date().toISOString()): Promise<PostIntegrationCommandResultSet> {
  const catalog = readJson(catalogPath); const validation = validatePostIntegrationCommandCatalogValue(catalog)
  if (!validation.ok) throw Object.assign(new Error(JSON.stringify(validation.errors)), { code: validation.errors[0].code })
  const entries = (catalog as PostIntegrationCommandCatalogEntry[]).filter((entry) => entry.group === group)
  if (entries.length === 0) throw Object.assign(new Error(`${group} is empty`), { code: 'empty_command_group' })
  const roots = Object.fromEntries(Object.entries(rootsInput).map(([key, value]) => [key, path.resolve(value)])); const manifest = readJson(roots.POST_INTEGRATION_MANIFEST)
  if (!isObject(manifest)) throw Object.assign(new Error('manifest is invalid'), { code: 'invalid_manifest_binding' })
  validatePostIntegrationEntryArtifact(manifest as PostIntegrationEntryManifest, { ccGatewayRoot: roots.CC_GATEWAY_ROOT, sub2apiRoot: roots.SUB2API_ROOT, toolRoot: roots.TOOL_ROOT })
  if (digestFile(catalogPath) !== (manifest as PostIntegrationEntryManifest).capture_inputs.command_catalog.digest) throw Object.assign(new Error('catalog differs from the reviewed manifest input'), { code: 'cross_catalog_results' })
  const manifestDigest = digestFile(roots.POST_INTEGRATION_MANIFEST); const records: PostIntegrationCommandResultRecord[] = []
  for (const entry of entries) {
    const root = entry.repository === 'sub2api' ? roots.SUB2API_ROOT : roots.CC_GATEWAY_ROOT
    const expectedHead = getField(manifest, entry.manifest_binding.repository_head_field); const commit = git(root, 'rev-parse', 'HEAD')
    if (commit !== expectedHead || status(root).length !== 0) throw Object.assign(new Error(`${entry.id} repository binding drift`), { code: 'manifest_binding_mismatch' })
    let contractDigest: string | undefined
    if (entry.repository === 'sub2api') {
      contractDigest = String(getField(manifest, 'contract.sha256')); const relative = String(getField(manifest, 'contract.repository_relative_path'))
      if (contractDigest !== digestFile(path.join(root, relative))) throw Object.assign(new Error('contract drift'), { code: 'contract_digest_mismatch' })
    }
    const env = postIntegrationCommandEnvironment(entry, roots)
    const observed = await execute(entry.argv.map((value) => expand(value, roots)), expand(entry.cwd, roots), env, entry.timeout_ms)
    if (status(root).length !== 0) throw Object.assign(new Error(`${entry.id} changed integrated main`), { code: 'worktree_delta_mismatch' })
    const classification = expectedStatus(observed.exitCode, entry.expected_exit); const unsigned = { command_id: entry.id, repository: entry.repository, repository_commit: commit, ...(contractDigest ? { contract_digest: contractDigest } : {}), manifest_digest: manifestDigest, environment_digest: sha256(canonicalJson(env)), exit_code: observed.exitCode, expected_exit: entry.expected_exit, status: classification, output_digest: sha256(observed.output), ...(entry.output_policy === 'redacted_excerpt' ? { output_excerpt: redact(observed.output.toString('utf8')) } : {}) }
    records.push({ ...unsigned, duration_ms: observed.durationMs, result_digest: postIntegrationCommandRecordDigest(unsigned) })
  }
  const generated = new Date(generatedAt); const unsigned = { schema_version: 1 as const, generated_at: generated.toISOString(), expires_at: new Date(generated.getTime() + 7 * 86_400_000).toISOString(), catalog_digest: digestFile(catalogPath), manifest_digest: manifestDigest, records }
  const output = { ...unsigned, result_set_digest: postIntegrationCommandSetDigest(unsigned) }; assertSafeArtifact(output); return output
}

if (realpathSync(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) cli(() => {
  const args = parseArgs(process.argv.slice(2)); const catalog = args.values.catalog?.[0]; const group = args.values.group?.[0] as 'post-integration-green' | 'post-integration-red'; const cc = args.values['cc-gateway-root']?.[0]; const sub = args.values['sub2api-root']?.[0]; const tool = args.values['tool-root']?.[0]; const manifest = args.values.manifest?.[0]; const out = args.values.out?.[0]
  if (!catalog || !['post-integration-green', 'post-integration-red'].includes(group) || !cc || !sub || !tool || !manifest || !out) throw Object.assign(new Error('--catalog, --group, --cc-gateway-root, --sub2api-root, --tool-root, --manifest, and --out are required'), { code: 'invalid_arguments' })
  void runPostIntegrationCommandCatalog(catalog, group, { CC_GATEWAY_ROOT: cc, SUB2API_ROOT: sub, TOOL_ROOT: tool, POST_INTEGRATION_MANIFEST: manifest }).then((output) => { writeExclusiveJson(out, output); if (output.records.some((record) => record.status.startsWith('unexpected'))) process.exitCode = 1 }).catch((error: Error & { code?: string }) => { console.error(JSON.stringify({ code: error.code ?? 'post_integration_runner_failed', message: error.message })); process.exitCode = 1 })
})
