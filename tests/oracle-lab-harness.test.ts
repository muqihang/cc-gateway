import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { buildContextPack } from '../tools/oracle-lab/build-context-pack.js'
import { buildExitReceipt, requiredReceiptArtifacts, validateExitReceiptValue } from '../tools/oracle-lab/build-exit-receipt.js'
import { buildHandoff, validateHandoffValue } from '../tools/oracle-lab/build-handoff-bundle.js'
import { assertSafeArtifact, canonicalJson, digestFile, digestValue, writeJson } from '../tools/oracle-lab/harness-core.js'
import { commandRecordDigest, commandSetDigest, mergeCommandResults, validateCommandResultsBindings, validateCommandResultsValue, type CommandResultRecord, type CommandResultSet } from '../tools/oracle-lab/merge-command-results.js'
import { redactOutput, runCommandCatalog } from '../tools/oracle-lab/run-command-catalog.js'
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
    [{ ...value[0], manifest_binding: { manifest_path: 'docs/superpowers/evidence/phase-0/literal.json', repository_head_field: 'repositories.cc_gateway.head' } }],
    [{ ...value[0], repository: 'cc-gateway', cwd: '${CC_GATEWAY_ROOT}', manifest_binding: { manifest_path: '${EXIT_MANIFEST}', repository_head_field: 'repositories.sub2api.head' } }],
    [{ ...value.find((entry) => entry.repository === 'sub2api')!, manifest_binding: { manifest_path: '${EXIT_MANIFEST}', repository_head_field: 'repositories.sub2api.head' } }],
  ]
  for (const candidate of cases) assert.equal(validateCommandCatalogValue(candidate).ok, false)
})

test('result validation rejects empty sets and derives status exactly from real and expected exits', () => {
  assert.equal(validateCommandResultsValue(resultSet([])).ok, false)
  for (const candidate of [
    { exit_code: 7, expected_exit: 0 as const, status: 'pass' as const },
    { exit_code: 0, expected_exit: 'nonzero' as const, status: 'expected_fail' as const },
    { exit_code: 0, expected_exit: 0 as const, status: 'unexpected_fail' as const },
    { exit_code: 9, expected_exit: 'nonzero' as const, status: 'unexpected_pass' as const },
  ]) {
    const forged = { ...record('forged'), ...candidate }
    const { result_digest: _old, duration_ms: _duration, ...unsigned } = forged
    forged.result_digest = commandRecordDigest(unsigned)
    assert.equal(validateCommandResultsValue(resultSet([forged])).ok, false)
  }
  const unsafe = { ...record('unsafe'), output_excerpt: 'Cookie: session=raw-secret' }; { const { result_digest: _old, duration_ms: _duration, ...unsigned } = unsafe; unsafe.result_digest = commandRecordDigest(unsigned) }
  assert.equal(validateCommandResultsValue(resultSet([unsafe])).ok, false)
})

test('result evidence binds exactly to catalog, manifest, repository heads, contract and complete groups', async () => {
  const catalogValue = await catalog()
  const manifest = { repositories: { cc_gateway: { head: commit }, sub2api: { head: '2'.repeat(40) } }, contract: { sha256: 'c'.repeat(64) } }
  const cc = record('cc-build')
  const valid = resultSet([cc])
  assert.deepEqual(validateCommandResultsBindings(valid, catalogValue, manifest, { catalogDigest: valid.catalog_digest, manifestDigest: valid.manifest_digest }), { ok: true, errors: [] })
  assert.equal(validateCommandResultsBindings({ ...valid, catalog_digest: digest }, catalogValue, manifest, { catalogDigest: otherDigest, manifestDigest: digest }).ok, false)
  assert.equal(validateCommandResultsBindings(valid, catalogValue, manifest, { catalogDigest: otherDigest, manifestDigest: otherDigest }).ok, false)
  assert.equal(validateCommandResultsBindings(valid, catalogValue, { ...manifest, repositories: { ...manifest.repositories, cc_gateway: { head: '3'.repeat(40) } } }, { catalogDigest: otherDigest, manifestDigest: digest }).ok, false)
  assert.equal(validateCommandResultsBindings(valid, catalogValue, manifest, { catalogDigest: otherDigest, manifestDigest: digest, requireGroups: ['phase0-green'] }).ok, false)
})

test('context and handoff builders reject cross-input evidence and missing selected requirement results', async () => {
  const registry = 'docs/superpowers/registry/oracle-lab-requirements.json'
  const claims = 'docs/superpowers/registry/oracle-lab-claims.json'
  const manifest = JSON.parse(await readFile(entryBaseline, 'utf8')) as { repositories: Record<string, { head: string }>; contract: { sha256: string } }
  const catalogValue = await catalog()
  const make = (entry: CommandCatalogEntry): CommandResultRecord => {
    const repositoryName = entry.repository === 'sub2api' ? 'sub2api' : 'cc_gateway'
    const unsigned = { command_id: entry.id, repository: entry.repository, repository_commit: manifest.repositories[repositoryName].head, ...(entry.repository === 'sub2api' ? { contract_digest: `sha256:${manifest.contract.sha256}` } : {}), manifest_digest: digestFile(entryBaseline), environment_digest: digest, exit_code: entry.expected_exit === 0 ? 0 : 1, expected_exit: entry.expected_exit, status: entry.expected_exit === 0 ? 'pass' as const : 'expected_fail' as const, output_digest: otherDigest, ...(entry.output_policy === 'redacted_excerpt' ? { output_excerpt: '[REDACTED]' } : {}) }
    return { ...unsigned, duration_ms: 1, result_digest: commandRecordDigest(unsigned) }
  }
  const all = catalogValue.map(make)
  const unsigned = { schema_version: 1 as const, generated_at: new Date(Date.now() + 60_000).toISOString(), expires_at: new Date(Date.now() + 7 * 86_400_000 + 60_000).toISOString(), catalog_digest: digestFile(catalogPath), manifest_digest: digestFile(entryBaseline), records: all }
  const bound = { ...unsigned, result_set_digest: commandSetDigest(unsigned) }
  const resultPath = path.join(await mkdtemp(path.join(tmpdir(), 'oracle-h0-bound-')), 'results.json'); await writeFile(resultPath, JSON.stringify(bound))
  const missing = { ...unsigned, records: all.filter((entry) => entry.command_id !== 'cc-test') }; const missingSet = { ...missing, result_set_digest: commandSetDigest(missing) }; const missingPath = path.join(path.dirname(resultPath), 'missing.json'); await writeFile(missingPath, JSON.stringify(missingSet))
  assert.throws(() => buildContextPack({ registry, claims, manifest: entryBaseline, commandResults: missingPath, requirementIds: ['HA-P0-007'] }), (error: Error & { code?: string }) => error.code === 'missing_requirement_evidence')
  assert.throws(() => buildContextPack({ registry, claims, manifest: entryBaseline, commandResults: resultPath, requirementIds: ['HA-P0-000'] }), (error: Error & { code?: string }) => error.code === 'missing_requirement_evidence')
  assert.throws(() => buildHandoff({ phase: 'phase-0', baseline: entryBaseline, commandResults: missingPath }), (error: Error & { code?: string }) => error.code === 'incomplete_result_set')
  const cross = { ...bound, manifest_digest: otherDigest, records: bound.records.map((entry) => ({ ...entry, manifest_digest: otherDigest })) }; cross.records = cross.records.map((entry) => { const { result_digest: _old, duration_ms: _duration, ...recordUnsigned } = entry; return { ...entry, result_digest: commandRecordDigest(recordUnsigned) } }); cross.result_set_digest = commandSetDigest((({ result_set_digest: _old, ...rest }) => rest)(cross)); const crossPath = path.join(path.dirname(resultPath), 'cross.json'); await writeFile(crossPath, JSON.stringify(cross))
  assert.throws(() => buildContextPack({ registry, claims, manifest: entryBaseline, commandResults: crossPath, requirementIds: ['HA-P0-007'] }), (error: Error & { code?: string }) => error.code === 'cross_manifest_results')
  assert.doesNotThrow(() => buildContextPack({ registry, claims, manifest: entryBaseline, commandResults: resultPath, requirementIds: ['HA-P0-007'] }))
})

test('documented Task 8 pipeline canonicalizes the exact transient context into commit-bound evidence', async () => {
  const originalCwd = process.cwd()
  const root = await mkdtemp(path.join(tmpdir(), 'oracle-h0-documented-pipeline-'))
  const transientContext = '/tmp/oracle-lab-context-pack.json'
  const transientResults = '/tmp/oracle-lab-phase-0-command-results.json'
  const baseline = 'docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json'
  const handoffPath = 'docs/superpowers/evidence/phase-0/phase-0-handoff.json'
  const reportPath = 'docs/superpowers/evidence/phase-0/phase-0-exit-report.md'
  const evidenceContext = 'docs/superpowers/evidence/phase-0/phase-0-context-pack.json'
  const fixtureFiles = [
    'docs/superpowers/registry/oracle-lab-requirements.json',
    'docs/superpowers/registry/oracle-lab-claims.json',
    'docs/superpowers/registry/oracle-lab-command-catalog.json',
    'docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md',
    'docs/superpowers/schemas/oracle-lab-requirement.schema.json',
    'docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-design.md',
    'docs/superpowers/specs/2026-07-11-claude-code-2.1.207-adversarial-validation-v2.md',
    'docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md',
    'tools/oracle-lab/validate-requirements.ts',
    'tests/oracle-lab-traceability.test.ts',
  ]
  for (const file of fixtureFiles) {
    const destination = path.join(root, file)
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, await readFile(path.join(originalCwd, file)))
  }
  await mkdir(path.dirname(path.join(root, baseline)), { recursive: true })
  await writeFile(path.join(root, baseline), await readFile(path.join(originalCwd, entryBaseline)))

  process.chdir(root)
  try {
    const catalogValue = JSON.parse(await readFile('docs/superpowers/registry/oracle-lab-command-catalog.json', 'utf8')) as CommandCatalogEntry[]
    const manifest = JSON.parse(await readFile(baseline, 'utf8')) as { repositories: Record<string, { head: string }>; contract: { sha256: string } }
    const records = catalogValue.map((entry): CommandResultRecord => {
      const repositoryName = entry.repository === 'sub2api' ? 'sub2api' : 'cc_gateway'
      const unsigned = { command_id: entry.id, repository: entry.repository, repository_commit: manifest.repositories[repositoryName].head, ...(entry.repository === 'sub2api' ? { contract_digest: `sha256:${manifest.contract.sha256}` } : {}), manifest_digest: digestFile(baseline), environment_digest: digest, exit_code: entry.expected_exit === 0 ? 0 : 1, expected_exit: entry.expected_exit, status: entry.expected_exit === 0 ? 'pass' as const : 'expected_fail' as const, output_digest: otherDigest, ...(entry.output_policy === 'redacted_excerpt' ? { output_excerpt: '[REDACTED]' } : {}) }
      return { ...unsigned, duration_ms: 1, result_digest: commandRecordDigest(unsigned) }
    })
    const unsignedResults = { schema_version: 1 as const, generated_at: new Date(Date.now() + 60_000).toISOString(), expires_at: new Date(Date.now() + 7 * 86_400_000 + 60_000).toISOString(), catalog_digest: digestFile('docs/superpowers/registry/oracle-lab-command-catalog.json'), manifest_digest: digestFile(baseline), records }
    writeJson(transientResults, { ...unsignedResults, result_set_digest: commandSetDigest(unsignedResults) })
    const context = buildContextPack({ registry: 'docs/superpowers/registry/oracle-lab-requirements.json', claims: 'docs/superpowers/registry/oracle-lab-claims.json', manifest: baseline, commandResults: transientResults, requirementIds: ['HA-P0-001', 'HA-P0-002'] })
    await writeFile(transientContext, `${JSON.stringify({ ...context, manifest_digest: otherDigest }, null, 2)}\n`)
    assert.throws(() => buildHandoff({ phase: 'phase-0', baseline, commandResults: transientResults, out: handoffPath }), (error: Error & { code?: string }) => error.code === 'cross_manifest_context')
    await assert.rejects(readFile(evidenceContext), (error: NodeJS.ErrnoException) => error.code === 'ENOENT')
    await writeFile(transientContext, `${JSON.stringify(context, null, 4)}\n`)

    const handoff = buildHandoff({ phase: 'phase-0', baseline, commandResults: transientResults, out: handoffPath })
    assert.deepEqual(handoff.artifacts.map((artifact) => artifact.path).sort(), [baseline, evidenceContext].sort())
    assert.equal(handoff.context_pack_digest, digestFile(evidenceContext))
    assert.equal(await readFile(evidenceContext, 'utf8'), `${canonicalJson(context)}\n`)
    const firstDigest = digestFile(evidenceContext)
    await writeFile(transientContext, `${JSON.stringify(context, null, 2)}\n`)
    buildHandoff({ phase: 'phase-0', baseline, commandResults: transientResults, out: handoffPath })
    assert.equal(digestFile(evidenceContext), firstDigest)

    writeJson(handoffPath, handoff)
    const { buildExitReport } = await import('../tools/oracle-lab/build-exit-report.js')
    await writeFile(reportPath, buildExitReport(handoff))
    execFileSync('git', ['init', '-q']); execFileSync('git', ['config', 'user.email', 'test@example.invalid']); execFileSync('git', ['config', 'user.name', 'Oracle Test'])
    execFileSync('git', ['add', 'docs']); execFileSync('git', ['commit', '-qm', 'test: bind documented pipeline evidence'])
    const handoffCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    assert.deepEqual(validateExitReceiptValue(buildExitReceipt({ baseline, handoff: handoffPath, handoffCommit })), { ok: true, errors: [] })

    const explicitContext = 'docs/superpowers/evidence/phase-0/task-9-context-pack.json'
    await writeFile(explicitContext, `${canonicalJson(context)}\n`)
    const explicit = buildHandoff({ phase: 'phase-0', baseline, commandResults: transientResults, context: explicitContext, out: handoffPath })
    assert(explicit.artifacts.some((artifact) => artifact.path === explicitContext))
    assert(!explicit.artifacts.some((artifact) => artifact.path === evidenceContext))
  } finally {
    process.chdir(originalCwd)
  }
})

test('context builder fails closed when any selected requirement source bytes are missing', async () => {
  const registryPath = 'docs/superpowers/registry/oracle-lab-requirements.json'
  const claims = 'docs/superpowers/registry/oracle-lab-claims.json'
  const registry = JSON.parse(await readFile(registryPath, 'utf8')) as Array<Record<string, unknown>>
  const baseline = JSON.parse(await readFile(entryBaseline, 'utf8')) as Record<string, unknown> & { governance: Record<string, { sha256: string }>; repositories: Record<string, { head: string }>; contract: { sha256: string } }
  const catalogValue = await catalog()
  const root = await mkdtemp(path.join(tmpdir(), 'oracle-h0-missing-source-'))

  for (const [field, value] of [
    ['implementation_files', ['missing/required-implementation.ts']],
    ['test_files', ['missing/required-regression.test.ts']],
    ['source_document', 'missing-required-spec.md'],
  ] as const) {
    const candidate = structuredClone(registry)
    const requirement = candidate.find((entry) => entry.requirement_id === 'HA-P0-007')!
    requirement[field] = value
    const candidateRegistry = path.join(root, `${field}.registry.json`)
    await writeFile(candidateRegistry, JSON.stringify(candidate))
    const candidateManifest = structuredClone(baseline)
    candidateManifest.governance.requirement_registry.sha256 = digestFile(candidateRegistry).slice(7)
    const manifestPath = path.join(root, `${field}.manifest.json`)
    await writeFile(manifestPath, JSON.stringify(candidateManifest))

    const selectedEntries = catalogValue.filter((entry) => entry.requirement_ids.includes('HA-P0-007'))
    const records = selectedEntries.map((entry): CommandResultRecord => {
      const repositoryName = entry.repository === 'sub2api' ? 'sub2api' : 'cc_gateway'
      const unsigned = { command_id: entry.id, repository: entry.repository, repository_commit: candidateManifest.repositories[repositoryName].head, ...(entry.repository === 'sub2api' ? { contract_digest: `sha256:${candidateManifest.contract.sha256}` } : {}), manifest_digest: digestFile(manifestPath), environment_digest: digest, exit_code: entry.expected_exit === 0 ? 0 : 1, expected_exit: entry.expected_exit, status: entry.expected_exit === 0 ? 'pass' as const : 'expected_fail' as const, output_digest: otherDigest, ...(entry.output_policy === 'redacted_excerpt' ? { output_excerpt: '[REDACTED]' } : {}) }
      return { ...unsigned, duration_ms: 1, result_digest: commandRecordDigest(unsigned) }
    })
    const unsigned = { schema_version: 1 as const, generated_at: new Date(Date.now() + 60_000).toISOString(), expires_at: new Date(Date.now() + 7 * 86_400_000 + 60_000).toISOString(), catalog_digest: digestFile(catalogPath), manifest_digest: digestFile(manifestPath), records }
    const resultsPath = path.join(root, `${field}.results.json`)
    await writeFile(resultsPath, JSON.stringify({ ...unsigned, result_set_digest: commandSetDigest(unsigned) }))

    assert.throws(
      () => buildContextPack({ registry: candidateRegistry, claims, manifest: manifestPath, commandResults: resultsPath, requirementIds: ['HA-P0-007'] }),
      (error: Error & { code?: string }) => error.code === 'missing_source',
      String(field),
    )
  }
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
  const handoff = { schema_version: 1, phase: 'phase-0', generated_at: new Date(Date.now() + 60_000).toISOString(), expires_at: new Date(Date.now() + 86_460_000).toISOString(), baseline_digest: digest, command_results_digest: otherDigest, repositories: [{ name: 'cc_gateway', commit, dirty_digest: digest }, { name: 'sub2api', commit: '2'.repeat(40), dirty_digest: otherDigest }], commands: [{ command_id: 'a', status: 'pass', result_digest: digest }], artifacts: [{ path: entryBaseline, digest: digestFile(entryBaseline) }], known_unknowns: [], retention_policy: { digest_only: 'phase_evidence_permanent', redacted_excerpt: '7_days' }, redaction_policy: 'digests_and_safe_redacted_excerpts_only', destruction_procedure: 'git_revert_artifact_commit_after_security_approval' }
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

test('runner rejects every undeclared pre/post command worktree delta and removes no symlink bypass', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oracle-h0-delta-'))
  execFileSync('git', ['init', '-q', root]); execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.invalid']); execFileSync('git', ['-C', root, 'config', 'user.name', 'H0 Test'])
  await writeFile(path.join(root, 'tracked.txt'), 'fixture\n'); execFileSync('git', ['-C', root, 'add', '.']); execFileSync('git', ['-C', root, 'commit', '-qm', 'fixture'])
  const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const manifestPath = path.join(root, 'docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json'); await import('node:fs/promises').then(({ mkdir }) => mkdir(path.dirname(manifestPath), { recursive: true })); await writeFile(manifestPath, JSON.stringify({ repositories: { cc_gateway: { head } } }))
  const common = { id: 'delta-test', schema_version: 1 as const, group: 'phase0-green' as const, owner: 'test', requirement_ids: ['HA-P0-007'], repository: 'cc-gateway' as const, cwd: '${CC_GATEWAY_ROOT}' as const, env: {}, inherit_env: ['PATH' as const], manifest_binding: { manifest_path: '${EXIT_MANIFEST}', repository_head_field: 'repositories.cc_gateway.head' }, allowed_worktree_delta: ['docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json'], timeout_ms: 10_000, expected_exit: 0 as const, output_policy: 'digest_only' as const, rollback: 'none' }
  const catalogDirectory = await mkdtemp(path.join(tmpdir(), 'oracle-h0-delta-catalog-')); const file = path.join(catalogDirectory, 'catalog.json')
  await writeFile(file, JSON.stringify([{ ...common, argv: [process.execPath, '-e', 'require("fs").writeFileSync("rogue.txt", "x")'] }]))
  const roots = { CC_GATEWAY_ROOT: root, SUB2API_ROOT: root, EXIT_MANIFEST: manifestPath, ENTRY_MANIFEST: manifestPath }
  await assert.rejects(runCommandCatalog(file, 'phase0-green', roots), (error: Error & { code?: string }) => error.code === 'worktree_delta_mismatch')
  const modifiedRoot = await mkdtemp(path.join(tmpdir(), 'oracle-h0-modified-'))
  execFileSync('git', ['init', '-q', modifiedRoot]); execFileSync('git', ['-C', modifiedRoot, 'config', 'user.email', 'test@example.invalid']); execFileSync('git', ['-C', modifiedRoot, 'config', 'user.name', 'H0 Test']); await writeFile(path.join(modifiedRoot, 'tracked.txt'), 'fixture\n'); execFileSync('git', ['-C', modifiedRoot, 'add', '.']); execFileSync('git', ['-C', modifiedRoot, 'commit', '-qm', 'fixture'])
  const modifiedHead = execFileSync('git', ['-C', modifiedRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); const modifiedManifest = path.join(modifiedRoot, 'docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json'); await import('node:fs/promises').then(({ mkdir }) => mkdir(path.dirname(modifiedManifest), { recursive: true })); await writeFile(modifiedManifest, JSON.stringify({ repositories: { cc_gateway: { head: modifiedHead } } }))
  await writeFile(file, JSON.stringify([{ ...common, argv: [process.execPath, '-e', `require("fs").writeFileSync(${JSON.stringify(modifiedManifest)}, "changed")`] }]))
  await assert.rejects(runCommandCatalog(file, 'phase0-green', { ...roots, CC_GATEWAY_ROOT: modifiedRoot, SUB2API_ROOT: modifiedRoot, EXIT_MANIFEST: modifiedManifest, ENTRY_MANIFEST: modifiedManifest }), (error: Error & { code?: string }) => error.code === 'worktree_delta_mismatch')
  const cleanRoot = await mkdtemp(path.join(tmpdir(), 'oracle-h0-symlink-'))
  execFileSync('git', ['init', '-q', cleanRoot]); execFileSync('git', ['-C', cleanRoot, 'config', 'user.email', 'test@example.invalid']); execFileSync('git', ['-C', cleanRoot, 'config', 'user.name', 'H0 Test']); await writeFile(path.join(cleanRoot, 'tracked.txt'), 'fixture\n'); execFileSync('git', ['-C', cleanRoot, 'add', '.']); execFileSync('git', ['-C', cleanRoot, 'commit', '-qm', 'fixture'])
  const cleanHead = execFileSync('git', ['-C', cleanRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); const cleanManifest = path.join(cleanRoot, 'docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json'); await import('node:fs/promises').then(({ mkdir }) => mkdir(path.dirname(cleanManifest), { recursive: true })); await writeFile(cleanManifest, JSON.stringify({ repositories: { cc_gateway: { head: cleanHead } } })); await symlink(tmpdir(), path.join(cleanRoot, 'node_modules'))
  await assert.rejects(runCommandCatalog(file, 'phase0-green', { ...roots, CC_GATEWAY_ROOT: cleanRoot, SUB2API_ROOT: cleanRoot, EXIT_MANIFEST: cleanManifest, ENTRY_MANIFEST: cleanManifest }), (error: Error & { code?: string }) => error.code === 'worktree_delta_mismatch')
})

test('safe excerpts redact credentials, assignments, paths, raw logs and canaries', async () => {
  for (const unsafe of ['Cookie: session=abc123', 'Authorization: Basic Zm9vOmJhcg==', 'TOKEN=plain-secret', 'API_KEY: abc123', 'https://user:pass@example.test/x', '/Users/alice/private/file', 'ORACLE_SECRET_CANARY_123456']) {
    assert.throws(() => assertSafeArtifact({ output_excerpt: unsafe }), (error: Error & { code?: string }) => error.code === 'unsafe_artifact')
  }
  const raw = 'Cookie: sid=abc\nAuthorization: Bearer raw-token\nTOKEN=plain\nAPI_KEY: key\nhttps://user:p@ss@example.test/x\n/private/var/folders/ab/raw.log\nORACLE_SECRET_CANARY_123456'
  const redacted = redactOutput(raw)
  for (const leaked of ['sid=abc', 'raw-token', 'plain', ' key', 'user', 'p@ss', '/private/', 'ORACLE_SECRET_CANARY']) assert.equal(redacted.includes(leaked), false, leaked)
})

test('receipt validates semantics before commit inventory verification', () => {
  assert.throws(() => buildExitReceipt({ baseline: entryBaseline, handoff: entryBaseline, handoffCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), artifacts: ['docs/superpowers/evidence/phase-0/not-committed.json'] }), (error: Error & { code?: string }) => error.code === 'missing_field')
})

test('receipt validation rejects empty artifact and repository inventories and weak metadata', () => {
  const receipt = { schema_version: 1, generated_at: new Date().toISOString(), baseline_digest: digest, handoff_digest: otherDigest, handoff_commit: commit, artifact_digests: {}, repository_heads: {}, retention_class: 'phase_evidence_permanent', redaction_policy: 'digests_and_safe_redacted_excerpts_only', destruction_procedure: 'git_revert_artifact_commit_after_security_approval' }
  assert.equal(validateExitReceiptValue(receipt).ok, false)
  assert.equal(validateExitReceiptValue({ ...receipt, artifact_digests: { [entryBaseline]: digest }, repository_heads: { cc_gateway: commit }, retention_class: 'anything' }).ok, false)
})

test('receipt inventory is exact for baseline, context, handoff, report, registry and roadmap', () => {
  assert.deepEqual(requiredReceiptArtifacts('phase-0', 'docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json', 'docs/superpowers/evidence/phase-0/phase-0-context-pack.json', 'docs/superpowers/evidence/phase-0/phase-0-handoff.json'), [
    'docs/superpowers/evidence/phase-0/phase-0-context-pack.json',
    'docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json',
    'docs/superpowers/evidence/phase-0/phase-0-exit-report.md',
    'docs/superpowers/evidence/phase-0/phase-0-handoff.json',
    'docs/superpowers/registry/oracle-lab-requirements.json',
    'docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md',
  ])
})

test('published H0 schemas are strict, versioned, retention-aware, and require migrations for breaking changes', async () => {
  for (const name of ['command-catalog', 'command-results', 'context-pack', 'handoff', 'exit-receipt']) {
    const schema = JSON.parse(await readFile(`docs/superpowers/schemas/oracle-lab-${name}.schema.json`, 'utf8'))
    assert.equal(schema.compatibility_policy, 'phase_0_additive_only_breaking_requires_new_version_and_migration_test')
    assert.equal(schema.retention_class, 'phase_evidence_permanent')
    assert.equal(schema.redaction_policy, 'digests_and_safe_redacted_excerpts_only')
    assert.equal(schema.destruction_procedure, 'git_revert_artifact_commit_after_security_approval')
    if (schema.type === 'array') assert.equal(schema.items.additionalProperties, false); else assert.equal(schema.additionalProperties, false)
    const arrays = Object.values(schema.properties ?? {}).filter((property): property is Record<string, unknown> => typeof property === 'object' && property !== null && (property as { type?: string }).type === 'array')
    for (const property of arrays) assert.ok(property.items, `${name} array must constrain items`)
    if (name === 'command-results') assert.ok(schema.$defs.record.allOf, 'result schema must correlate exit, expectation, and status')
  }
  assert.equal(validateContextPackValue({ ...contextPack(), schema_version: 2, migration: 'missing-test' }).ok, false)
})
