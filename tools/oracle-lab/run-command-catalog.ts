import { spawn } from 'node:child_process'
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { canonicalJson, cli, digestFile, getField, isObject, parseArgs, readJson, requireValid, sha256, writeJson } from './harness-core.js'
import { commandRecordDigest, commandSetDigest, expectedStatus, type CommandResultRecord, type CommandResultSet } from './merge-command-results.js'
import { validateCommandCatalogValue, type CommandCatalogEntry } from './validate-command-catalog.js'

type RuntimeRoots = Record<'CC_GATEWAY_ROOT' | 'SUB2API_ROOT' | 'ENTRY_MANIFEST' | 'EXIT_MANIFEST', string>

function expand(value: string, roots: RuntimeRoots): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
    if (!(name in roots) || roots[name as keyof RuntimeRoots] === '') throw Object.assign(new Error(`${name} is not declared`), { code: 'undeclared_expansion' })
    return roots[name as keyof RuntimeRoots]
  })
}

import { execFileSync } from 'node:child_process'

function gitOutput(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
}

type WorktreeRecord = { path: string; status: string; content_digest: string }

function worktreeSnapshot(root: string): WorktreeRecord[] {
  const status = execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all'], { encoding: 'utf8' })
  return status.split('\0').filter(Boolean).map((line) => {
    const relative = line.slice(3); const file = path.join(root, relative)
    let contentDigest = sha256('missing')
    try { const metadata = lstatSync(file); contentDigest = metadata.isSymbolicLink() ? sha256(`symlink:${readlinkSync(file)}`) : metadata.isFile() ? sha256(readFileSync(file)) : sha256(`other:${metadata.mode}`) } catch { /* deletion marker remains */ }
    return { path: relative, status: line.slice(0, 2), content_digest: contentDigest }
  }).sort((a, b) => a.path.localeCompare(b.path))
}

function assertAllowedDelta(entry: CommandCatalogEntry, snapshot: WorktreeRecord[], stage: string): void {
  const allowed = [...entry.allowed_worktree_delta].sort()
  if (snapshot.some((changed) => !allowed.includes(changed.path))) throw Object.assign(new Error(`${entry.id} ${stage} worktree delta is ${JSON.stringify(snapshot)}`), { code: 'worktree_delta_mismatch' })
}

export function redactOutput(output: string): string {
  return output
    .replace(/^(?:Cookie|Set-Cookie|Authorization)\s*:.*$/gim, '[REDACTED_HEADER]')
    .replace(/(?:Bearer\s+)[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/\b(TOKEN|SECRET|API_KEY)\s*([:=])\s*[^\s"']+/gi, '$1$2[REDACTED]')
    .replace(/(https?:\/\/)[^\s/]+@/gi, '$1[REDACTED]@')
    .replace(/(?:\/Users\/|\/home\/|\/private\/|\/tmp\/|\/var\/folders\/)[^\s"']+/g, '[REDACTED_PATH]')
    .replace(/[A-Za-z]:\\Users\\[^\s"']+/g, '[REDACTED_PATH]')
    .replace(/ORACLE[_-]?SECRET[_-]?CANARY[^\s]*/gi, '[REDACTED]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 2048)
}

function execute(argv: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ exitCode: number; durationMs: number; output: Buffer }> {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint(); const chunks: Buffer[] = []
    const child = spawn(argv[0], argv.slice(1), { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    child.stderr.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeoutMs)
    child.on('error', (error) => chunks.push(Buffer.from(error.message)))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: timedOut ? 124 : code ?? 127, durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n), output: Buffer.concat(chunks) })
    })
  })
}

function binding(entry: CommandCatalogEntry, roots: RuntimeRoots): { manifestPath: string; manifest: Record<string, unknown>; manifestDigest: string; root: string; commit: string; before: WorktreeRecord[]; contractDigest?: string } {
  const manifestPath = path.resolve(roots.CC_GATEWAY_ROOT, expand(entry.manifest_binding.manifest_path, roots))
  const manifest = readJson(manifestPath)
  if (!isObject(manifest)) throw Object.assign(new Error('manifest is not an object'), { code: 'invalid_manifest_binding' })
  const root = entry.repository === 'sub2api' ? roots.SUB2API_ROOT : roots.CC_GATEWAY_ROOT
  const expectedHead = getField(manifest, entry.manifest_binding.repository_head_field)
  const commit = gitOutput(root, ['rev-parse', 'HEAD'])
  if (expectedHead !== commit) throw Object.assign(new Error(`${entry.id} repository head does not match manifest`), { code: 'manifest_binding_mismatch' })
  let contractDigest: string | undefined
  if (entry.manifest_binding.contract_digest_field) {
    const expectedContract = getField(manifest, entry.manifest_binding.contract_digest_field)
    if (typeof expectedContract !== 'string' || !/^[0-9a-f]{64}$/.test(expectedContract)) throw Object.assign(new Error('manifest contract digest is missing'), { code: 'missing_manifest_binding' })
    contractDigest = `sha256:${expectedContract}`
    if (entry.repository === 'sub2api') {
      const encoded = getField(manifest, 'contract.repository_relative_path_base64url')
      if (typeof encoded !== 'string') throw Object.assign(new Error('manifest contract path is missing'), { code: 'missing_manifest_binding' })
      const contractPath = path.resolve(root, Buffer.from(encoded, 'base64url').toString('utf8'))
      if (sha256(readFileSync(contractPath)).slice(7) !== expectedContract) throw Object.assign(new Error('contract digest does not match manifest'), { code: 'manifest_binding_mismatch' })
    }
  }
  const before = worktreeSnapshot(root); assertAllowedDelta(entry, before, 'pre-command')
  return { manifestPath, manifest, manifestDigest: digestFile(manifestPath), root, commit, before, ...(contractDigest ? { contractDigest } : {}) }
}

export async function runCommandCatalog(catalogPath: string, group: 'phase0-green' | 'phase0-red', rootsInput: Partial<RuntimeRoots>, generatedAt = new Date().toISOString()): Promise<CommandResultSet> {
  const catalog = readJson(catalogPath); requireValid(validateCommandCatalogValue(catalog))
  const rootFromCatalog = path.resolve(path.dirname(catalogPath), '../../..')
  const roots: RuntimeRoots = {
    CC_GATEWAY_ROOT: path.resolve(rootsInput.CC_GATEWAY_ROOT ?? process.env.CC_GATEWAY_ROOT ?? rootFromCatalog),
    SUB2API_ROOT: path.resolve(rootsInput.SUB2API_ROOT ?? process.env.SUB2API_ROOT ?? ''),
    ENTRY_MANIFEST: rootsInput.ENTRY_MANIFEST ?? process.env.ENTRY_MANIFEST ?? 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json',
    EXIT_MANIFEST: rootsInput.EXIT_MANIFEST ?? process.env.EXIT_MANIFEST ?? '',
  }
  const selected = (catalog as CommandCatalogEntry[]).filter((entry) => entry.group === group)
  if (selected.length === 0) throw Object.assign(new Error(`catalog group ${group} is empty`), { code: 'empty_command_group' })
  const records: CommandResultRecord[] = []; let manifestDigest = ''
  for (const entry of selected) {
    const bound = binding(entry, roots)
    if (manifestDigest && bound.manifestDigest !== manifestDigest) throw Object.assign(new Error('catalog group crosses manifests'), { code: 'cross_manifest_results' })
    manifestDigest = bound.manifestDigest
    const inherited = Object.fromEntries(entry.inherit_env.map((name) => [name, process.env[name] ?? '']))
    const declared = Object.fromEntries(Object.entries(entry.env).map(([key, value]) => [key, expand(value, roots)]))
    const env = { ...inherited, ...declared }; const environmentDigest = sha256(canonicalJson(env))
    const argv = entry.argv.map((argument) => expand(argument, roots)); const cwd = expand(entry.cwd, roots)
    const observed = await execute(argv, cwd, env, entry.timeout_ms)
    const after = worktreeSnapshot(bound.root); assertAllowedDelta(entry, after, 'post-command')
    if (canonicalJson(after) !== canonicalJson(bound.before)) throw Object.assign(new Error(`${entry.id} changed the declared worktree delta`), { code: 'worktree_delta_mismatch' })
    const status = expectedStatus(observed.exitCode, entry.expected_exit)
    const outputDigest = sha256(observed.output)
    const unsigned = { command_id: entry.id, repository: entry.repository, repository_commit: bound.commit, ...(bound.contractDigest ? { contract_digest: bound.contractDigest } : {}), manifest_digest: bound.manifestDigest, environment_digest: environmentDigest, exit_code: observed.exitCode, expected_exit: entry.expected_exit, status, output_digest: outputDigest, ...(entry.output_policy === 'redacted_excerpt' ? { output_excerpt: redactOutput(observed.output.toString('utf8')) } : {}) }
    records.push({ ...unsigned, duration_ms: observed.durationMs, result_digest: commandRecordDigest(unsigned) })
  }
  const generated = new Date(generatedAt)
  const unsignedSet = { schema_version: 1 as const, generated_at: generated.toISOString(), expires_at: new Date(generated.getTime() + 7 * 86_400_000).toISOString(), catalog_digest: digestFile(catalogPath), manifest_digest: manifestDigest, records }
  return { ...unsignedSet, result_set_digest: commandSetDigest(unsignedSet) }
}

if (realpathSync(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) cli(() => {
  const args = parseArgs(process.argv.slice(2)); const catalog = args.values.catalog?.[0]; const group = args.values.group?.[0]; const results = args.values.results?.[0]
  if (!catalog || !results || (group !== 'phase0-green' && group !== 'phase0-red')) throw Object.assign(new Error('--catalog, --group, and --results are required'), { code: 'invalid_arguments' })
  void runCommandCatalog(catalog, group, {}).then((output) => {
    writeJson(results, output)
    if (output.records.some((record) => record.status === 'unexpected_fail' || record.status === 'unexpected_pass')) process.exitCode = 1
  }).catch((error: Error & { code?: string }) => { console.error(JSON.stringify({ code: error.code ?? 'command_runner_failed', message: error.message })); process.exitCode = 1 })
})
