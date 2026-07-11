import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { buildExitReceipt, validateExitReceiptValue } from '../tools/oracle-lab/build-exit-receipt.js'
import { validateHandoffValue } from '../tools/oracle-lab/build-handoff-bundle.js'
import { digestFile, digestValue } from '../tools/oracle-lab/harness-core.js'
import { commandRecordDigest, commandSetDigest, mergeCommandResults, validateCommandResultsValue, type CommandResultRecord, type CommandResultSet } from '../tools/oracle-lab/merge-command-results.js'
import { runCommandCatalog } from '../tools/oracle-lab/run-command-catalog.js'
import { validateCommandCatalogValue, type CommandCatalogEntry } from '../tools/oracle-lab/validate-command-catalog.js'
import { contextPackDigest, validateContextPackValue, type ContextPack } from '../tools/oracle-lab/validate-context-pack.js'

const catalogPath = path.resolve('docs/superpowers/registry/oracle-lab-command-catalog.json')
const entryBaseline = 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json'
const digest = `sha256:${'a'.repeat(64)}`
const otherDigest = `sha256:${'b'.repeat(64)}`
const commit = '1'.repeat(40)

async function catalog(): Promise<CommandCatalogEntry[]> {
  return JSON.parse(await readFile(catalogPath, 'utf8')) as CommandCatalogEntry[]
}

function record(commandId: string, repository: CommandResultRecord['repository'] = 'cc-gateway'): CommandResultRecord {
  const unsigned = { command_id: commandId, repository, repository_commit: commit, manifest_digest: digest, environment_digest: otherDigest, exit_code: 0, expected_exit: 0 as const, status: 'pass' as const, output_digest: digest }
  return { ...unsigned, duration_ms: 17, result_digest: commandRecordDigest(unsigned) }
}

function resultSet(records: CommandResultRecord[], generatedAt = '2026-07-11T20:00:00.000Z'): CommandResultSet {
  const unsigned = { schema_version: 1 as const, generated_at: generatedAt, expires_at: '2099-07-18T20:00:00.000Z', catalog_digest: otherDigest, manifest_digest: digest, records }
  return { ...unsigned, result_set_digest: commandSetDigest(unsigned) }
}

function contextPack(overrides: Partial<ContextPack> = {}): ContextPack {
  const generated = new Date(Date.now() + 60_000)
  return {
    schema_version: 1, generated_at: generated.toISOString(), expires_at: new Date(generated.getTime() + 86_400_000).toISOString(),
    registry_digest: digest, claims_digest: otherDigest, manifest_digest: digest, requirement_ids: ['HA-P0-001'],
    repositories: [{ name: 'cc_gateway', commit, dirty_digest: digest }],
    sources: [{ path: 'package.json', line: 1, digest: digestFile('package.json') }], tests: [{ command_id: 'cc-test', status: 'pass', result_digest: digest }], known_unknowns: [], ...overrides,
  }
}

test('committed catalog is complete, immutable-shaped, and validates against the fixed requirement inventory', async () => {
  const value = await catalog()
  assert.deepEqual(value.map((entry) => entry.id).sort(), ['cc-b4-b6-red', 'cc-build', 'cc-test', 'sidecar-b4-b6-red', 'sidecar-test', 'sub2api-b1-b3-red', 'sub2api-test'])
  assert.deepEqual(validateCommandCatalogValue(value), { ok: true, errors: [] })
  assert(value.every((entry) => Array.isArray(entry.argv) && entry.argv.length > 0))
})

test('catalog rejects duplicate IDs, shell commands, undeclared expansion, invalid exits, unknown fields and versions', async () => {
  const value = await catalog()
  const cases: unknown[] = [
    [...value, value[0]],
    [{ ...value[0], argv: ['sh', '-c', 'npm test'] }],
    [{ ...value[0], env: { LEAK: '${UNDECLARED_SECRET}' } }],
    [{ ...value[0], expected_exit: 2 }],
    [{ ...value[0], unexpected: true }],
    [{ ...value[0], schema_version: 2 }],
    [{ ...value[0], manifest_binding: { manifest_path: '${EXIT_MANIFEST}', repository_head_field: 'repositories.missing.head' } }],
  ]
  for (const candidate of cases) assert.equal(validateCommandCatalogValue(candidate).ok, false)
})

test('result merge is order-independent and rejects duplicates, cross-manifest and cross-commit sets', () => {
  const a = resultSet([record('a')]); const b = resultSet([record('b', 'sub2api')])
  const first = mergeCommandResults([a, b], '2026-07-11T21:00:00.000Z')
  const second = mergeCommandResults([b, a], '2026-07-12T21:00:00.000Z')
  assert.deepEqual(first.records.map((entry) => entry.command_id), ['a', 'b'])
  assert.equal(first.result_set_digest, second.result_set_digest)
  assert.throws(() => mergeCommandResults([a, a]), (error: Error & { code?: string }) => error.code === 'duplicate_command_id')
  const crossManifest = { ...b, manifest_digest: otherDigest, records: b.records.map((entry) => ({ ...entry, manifest_digest: otherDigest })) }
  { const { result_digest: _old, duration_ms: _duration, ...unsigned } = crossManifest.records[0]; crossManifest.records[0].result_digest = commandRecordDigest(unsigned) }
  { const { result_set_digest: _old, ...unsigned } = crossManifest; crossManifest.result_set_digest = commandSetDigest(unsigned) }
  assert.throws(() => mergeCommandResults([a, crossManifest]), (error: Error & { code?: string }) => error.code === 'cross_manifest_results')
  const crossCommitRecord = { ...record('c'), repository_commit: '2'.repeat(40) }; { const { result_digest: _old, duration_ms: _duration, ...unsigned } = crossCommitRecord; crossCommitRecord.result_digest = commandRecordDigest(unsigned) }
  assert.throws(() => mergeCommandResults([a, resultSet([crossCommitRecord])]), (error: Error & { code?: string }) => error.code === 'cross_commit_results')
})

test('context packs round-trip, have stable nonvolatile digests, and fail closed', () => {
  const valid = contextPack(); assert.deepEqual(validateContextPackValue(valid), { ok: true, errors: [] })
  const shifted = { ...valid, generated_at: new Date(Date.parse(valid.generated_at) + 1000).toISOString(), expires_at: new Date(Date.parse(valid.expires_at) + 1000).toISOString() }
  assert.equal(contextPackDigest(valid), contextPackDigest(shifted))
  assert.equal(validateContextPackValue({ ...valid, expires_at: new Date(Date.now() - 1).toISOString() }).ok, false)
  assert.equal(validateContextPackValue({ ...valid, schema_version: 2 }).ok, false)
  assert.equal(validateContextPackValue({ ...valid, unknown: true }).ok, false)
  assert.equal(validateContextPackValue({ ...valid, repositories: [] }).ok, false)
  assert.equal(validateContextPackValue({ ...valid, known_unknowns: ['ORACLE_SECRET_CANARY_123456'] }).ok, false)
})

test('command results and handoffs reject unknown fields, incomplete provenance, escaped artifacts, and secret canaries', () => {
  assert.equal(validateCommandResultsValue({ ...resultSet([record('a')]), extra: true }).ok, false)
  const handoff = { schema_version: 1, phase: 'phase-0', generated_at: new Date(Date.now() + 60_000).toISOString(), expires_at: new Date(Date.now() + 86_460_000).toISOString(), baseline_digest: digest, command_results_digest: otherDigest, repositories: [{ name: 'cc_gateway', commit, dirty_digest: digest }], commands: [{ command_id: 'a', status: 'pass', result_digest: digest }], artifacts: [{ path: entryBaseline, digest: digestFile(entryBaseline) }], known_unknowns: [], retention_policy: { digest_only: 'phase_evidence_permanent', redacted_excerpt: '7_days' }, redaction_policy: 'digests_only', destruction_procedure: 'git_revert' }
  assert.deepEqual(validateHandoffValue(handoff), { ok: true, errors: [] })
  assert.equal(validateHandoffValue({ ...handoff, artifacts: [{ path: '/tmp/raw.log', digest }] }, Date.now(), false).ok, false)
  assert.equal(validateHandoffValue({ ...handoff, known_unknowns: ['Bearer secret-token-value'] }).ok, false)
  assert.equal(validateExitReceiptValue({ schema_version: 1 }).ok, false)
})

test('runner executes argv without a shell, records real exits, environment digests and continues expected RED', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oracle-h0-runner-'))
  execFileSync('git', ['init', '-q', root]); execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.invalid']); execFileSync('git', ['-C', root, 'config', 'user.name', 'H0 Test'])
  await writeFile(path.join(root, 'tracked.txt'), 'fixture\n'); execFileSync('git', ['-C', root, 'add', '.']); execFileSync('git', ['-C', root, 'commit', '-qm', 'fixture'])
  const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const manifestPath = path.join(root, 'docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json'); await import('node:fs/promises').then(({ mkdir }) => mkdir(path.dirname(manifestPath), { recursive: true })); await writeFile(manifestPath, JSON.stringify({ repositories: { cc_gateway: { head } } }))
  const common = { schema_version: 1 as const, owner: 'test', requirement_ids: ['HA-P0-007'], repository: 'cc-gateway' as const, cwd: '${CC_GATEWAY_ROOT}' as const, env: { FIXED: 'value' }, inherit_env: ['PATH' as const], manifest_binding: { manifest_path: '${EXIT_MANIFEST}', repository_head_field: 'repositories.cc_gateway.head' }, allowed_worktree_delta: ['docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json'], timeout_ms: 10_000, output_policy: 'digest_only' as const, rollback: 'none' }
  const runnerCatalog: CommandCatalogEntry[] = [
    { ...common, id: 'green', group: 'phase0-green', argv: [process.execPath, '-e', 'process.stdout.write(process.env.FIXED); process.exit(0)'], expected_exit: 0 },
    { ...common, id: 'red-one', group: 'phase0-red', argv: [process.execPath, '-e', 'process.stderr.write("expected one"); process.exit(3)'], expected_exit: 'nonzero' },
    { ...common, id: 'red-two', group: 'phase0-red', argv: [process.execPath, '-e', 'process.stderr.write("expected two"); process.exit(4)'], expected_exit: 'nonzero' },
  ]
  const catalogDirectory = await mkdtemp(path.join(tmpdir(), 'oracle-h0-catalog-')); const runnerCatalogPath = path.join(catalogDirectory, 'catalog.json'); await writeFile(runnerCatalogPath, JSON.stringify(runnerCatalog))
  const roots = { CC_GATEWAY_ROOT: root, SUB2API_ROOT: root, EXIT_MANIFEST: manifestPath, ENTRY_MANIFEST: manifestPath }
  const green = await runCommandCatalog(runnerCatalogPath, 'phase0-green', roots); assert.equal(green.records[0].status, 'pass'); assert.equal(green.records[0].exit_code, 0); assert(green.records[0].duration_ms >= 0)
  const red = await runCommandCatalog(runnerCatalogPath, 'phase0-red', roots); assert.deepEqual(red.records.map((entry) => entry.status), ['expected_fail', 'expected_fail']); assert.deepEqual(red.records.map((entry) => entry.exit_code), [3, 4]); assert(red.records.every((entry) => entry.environment_digest.startsWith('sha256:')))
})

test('receipt rejects a commit that does not contain every named artifact', () => {
  assert.throws(() => buildExitReceipt({ baseline: entryBaseline, handoff: entryBaseline, handoffCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), artifacts: ['docs/superpowers/evidence/phase-0/not-committed.json'] }), (error: Error & { code?: string }) => error.code === 'commit_missing_artifact')
})

test('published H0 schemas are strict, versioned, retention-aware, and require migrations for breaking changes', async () => {
  for (const name of ['command-catalog', 'command-results', 'context-pack', 'handoff', 'exit-receipt']) {
    const schema = JSON.parse(await readFile(`docs/superpowers/schemas/oracle-lab-${name}.schema.json`, 'utf8'))
    assert.equal(schema.compatibility_policy, 'phase_0_additive_only_breaking_requires_new_version_and_migration_test')
    assert.equal(schema.retention_class, 'phase_evidence_permanent')
    assert.equal(schema.redaction_policy, 'digests_and_safe_redacted_excerpts_only')
    assert.equal(schema.destruction_procedure, 'git_revert_artifact_commit_after_security_approval')
    if (schema.type === 'array') assert.equal(schema.items.additionalProperties, false); else assert.equal(schema.additionalProperties, false)
  }
  assert.equal(validateContextPackValue({ ...contextPack(), schema_version: 2, migration: 'missing-test' }).ok, false)
})
