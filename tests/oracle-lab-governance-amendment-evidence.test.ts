import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const toolRelative = 'tools/oracle-lab/governance-amendment-evidence.ts'
const catalogRelative = 'docs/superpowers/registry/oracle-lab-governance-amendment-command-catalog.json'
const schemaRelatives = [
  'docs/superpowers/schemas/oracle-lab-governance-amendment-exit.schema.json',
  'docs/superpowers/schemas/oracle-lab-governance-amendment-command-catalog.schema.json',
  'docs/superpowers/schemas/oracle-lab-governance-amendment-command-results.schema.json',
  'docs/superpowers/schemas/oracle-lab-governance-amendment-context.schema.json',
  'docs/superpowers/schemas/oracle-lab-governance-amendment-handoff.schema.json',
  'docs/superpowers/schemas/oracle-lab-governance-amendment-receipt.schema.json',
  'docs/superpowers/schemas/oracle-lab-governance-amendment-report.schema.json',
  'docs/superpowers/schemas/oracle-lab-governance-amendment-review-import.schema.json',
  'docs/superpowers/schemas/oracle-lab-governance-amendment-review.schema.json',
]

for (const relative of [toolRelative, catalogRelative, ...schemaRelatives]) {
  assert.equal(existsSync(path.join(root, relative)), true, `${relative} must exist`)
}

const HERMETIC_NETWORK_ENV = {
  npm_config_offline: 'true',
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  GOPROXY: 'off',
  GOSUMDB: 'off',
  GOTOOLCHAIN: 'local',
  HTTP_PROXY: 'http://127.0.0.1:9',
  HTTPS_PROXY: 'http://127.0.0.1:9',
  ALL_PROXY: 'http://127.0.0.1:9',
  NO_PROXY: '127.0.0.1,localhost',
}

const expectedCatalog = [
  ['cc-build', 'green', 'cc-gateway', '${CC_GATEWAY_ROOT}', ['npm', 'run', 'build'], {}],
  ['cc-tests', 'green', 'cc-gateway', '${CC_GATEWAY_ROOT}', ['npm', 'test'], {}],
  ['cc-cross-repo-baseline', 'green', 'cc-gateway', '${CC_GATEWAY_ROOT}', ['npm', 'run', 'test:oracle:cross-repo'], { SUB2API_ROOT: '${SUB2API_ROOT}' }],
  ['sidecar-tests', 'green', 'egress-tls-sidecar', '${CC_GATEWAY_ROOT}/sidecar/egress-tls-sidecar', ['go', 'test', './...', '-count=1'], {}],
  ['sub2api-formal-pool', 'green', 'sub2api', '${SUB2API_ROOT}/backend', ['go', 'test', './internal/service', './internal/server/routes', '-run', 'FormalPool|FormalPoolOperations', '-count=1'], {}],
  ['sub2api-joint-local-chain', 'green', 'sub2api', '${SUB2API_ROOT}/backend', ['go', 'test', './internal/service', '-run', '^(TestClaudePlatformAWSLocalFullChainE2EUsesCCGatewayAndSafeMockUpstream|TestJointLocalCaptureAcceptanceArtifact)$', '-count=1', '-v'], { CC_GATEWAY_REPO_ROOT: '${CC_GATEWAY_ROOT}' }],
  ['p0-1-focused', 'green', 'cc-gateway', '${CC_GATEWAY_ROOT}', ['npm', 'run', 'test:oracle:p0-1'], {}],
  ['cc-boundary-red', 'red', 'cc-gateway', '${CC_GATEWAY_ROOT}', ['npm', 'exec', 'tsx', 'tests/red/phase0-boundary.red.test.ts'], {}],
  ['sidecar-boundary-red', 'red', 'egress-tls-sidecar', '${CC_GATEWAY_ROOT}/sidecar/egress-tls-sidecar', ['go', 'test', '-tags=phase0red', './internal/control', './internal/server', '-count=1'], {}],
  ['sub2api-boundary-red', 'red', 'sub2api', '${SUB2API_ROOT}/backend', ['go', 'test', '-tags=phase0red', './internal/service', './internal/server/routes', '-run', 'FormalPoolOnboarding|FormalPoolOperations|Browser|Egress', '-count=1'], {}],
] as const

const catalog = JSON.parse(readFileSync(path.join(root, catalogRelative), 'utf8'))
assert.equal(Array.isArray(catalog), true)
assert.equal(catalog.length, 10)
assert.deepEqual(catalog.map((entry: any) => [entry.id, entry.group, entry.repository, entry.cwd, entry.argv, Object.fromEntries(Object.entries(entry.env).filter(([key]) => !(key in HERMETIC_NETWORK_ENV) && key !== 'CI'))]), expectedCatalog)
for (const entry of catalog) {
  assert.equal(entry.schema_version, 1)
  assert.deepEqual(Object.fromEntries(Object.entries(entry.env).filter(([key]) => key in HERMETIC_NETWORK_ENV)), HERMETIC_NETWORK_ENV)
  assert.equal(entry.env.CI, '1')
  assert.deepEqual(entry.inherit_env, ['PATH', 'HOME', 'TMPDIR'])
  assert.equal(entry.shell, false)
  assert.equal(entry.max_output_bytes, 8 * 1024 * 1024)
  assert.equal(entry.expected_exit, entry.group === 'green' ? 0 : 'nonzero')
}
assert.deepEqual(catalog.find((entry: any) => entry.id === 'sub2api-joint-local-chain').bindings, ['cc_gateway_head', 'sub2api_head', 'cc_gateway_before_snapshot', 'cc_gateway_after_snapshot', 'sub2api_before_snapshot', 'sub2api_after_snapshot', 'shared_contract_digest'])

const ajv = new Ajv2020({ strict: false, allErrors: true, formats: { 'date-time': true } })
for (const relative of schemaRelatives) {
  const schema = JSON.parse(readFileSync(path.join(root, relative), 'utf8'))
  assert.equal(schema.additionalProperties, false, `${relative} must reject unknown fields`)
  ajv.compile(schema)
}
const validateCatalog = ajv.compile(JSON.parse(readFileSync(path.join(root, schemaRelatives[1]), 'utf8')))
assert.equal(validateCatalog(catalog), true, JSON.stringify(validateCatalog.errors))
const missingEnv = structuredClone(catalog)
delete missingEnv[0].env.GOPROXY
assert.equal(validateCatalog(missingEnv), false)
const wrongEnv = structuredClone(catalog)
wrongEnv[0].env.GOTOOLCHAIN = 'auto'
assert.equal(validateCatalog(wrongEnv), false)
const unknownCatalogField = structuredClone(catalog)
unknownCatalogField[0].surprise = true
assert.equal(validateCatalog(unknownCatalogField), false)
const wrongArgv = structuredClone(catalog)
wrongArgv[0].argv = ['npm', 'test']
assert.equal(validateCatalog(wrongArgv), false)
const wrongCwd = structuredClone(catalog)
wrongCwd[4].cwd = '${CC_GATEWAY_ROOT}'
assert.equal(validateCatalog(wrongCwd), false)
const missingCrossBinding = structuredClone(catalog)
missingCrossBinding[2].bindings = missingCrossBinding[2].bindings.filter((name: string) => name !== 'sub2api_after_snapshot')
assert.equal(validateCatalog(missingCrossBinding), false)
const injectedAllowedDelta = structuredClone(catalog)
injectedAllowedDelta[0].allowed_worktree_delta = ['docs/superpowers/evidence/p0-1/injected.json']
assert.equal(validateCatalog(injectedAllowedDelta), false)

const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
assert.equal(packageJson.scripts['oracle:p0-1'], 'tsx tools/oracle-lab/governance-amendment-evidence.ts')
assert.equal(packageJson.scripts['test:oracle:p0-1'], 'tsx tests/run-p0-1.ts')
const focusedRunner = readFileSync(path.join(root, 'tests/run-p0-1.ts'), 'utf8')
assert.deepEqual([...focusedRunner.matchAll(/import ['"]\.\/(.+?)['"]/g)].map((match) => match[1]), [
  'oracle-lab-hermetic-dependencies.test.ts',
  'oracle-lab-governance-amendment-entry.test.ts',
  'oracle-lab-review-overlay.test.ts',
  'oracle-lab-traceability.test.ts',
  'oracle-lab-claim-matrix.test.ts',
  'oracle-lab-current-observations.test.ts',
  'oracle-lab-harness.test.ts',
  'oracle-lab-reviewed-snapshot-binding.test.ts',
  'oracle-lab-governance-amendment-evidence.test.ts',
])

const evidence = await import(pathToFileURL(path.join(root, toolRelative)).href)

const cliCases = [
  ['capture-exit', ['entry', 'entry-receipt', 'cc-gateway-root', 'sub2api-root', 'out']],
  ['run', ['manifest', 'catalog', 'group', 'cc-gateway-root', 'sub2api-root', 'out']],
  ['merge', ['manifest', 'green', 'red', 'out']],
  ['review-import', ['review-source', 'adopted-amendment', 'out']],
  ['validate-review-import', ['review-import', 'review-source', 'adopted-amendment']],
  ['validate-reviews', ['requirements-review', 'security-review', 'review-import', 'cc-gateway-root', 'sub2api-root']],
  ['report', ['manifest', 'results', 'requirements-review', 'security-review', 'out', 'markdown']],
  ['controller-report', ['manifest', 'results', 'requirements-review', 'security-review', 'report', 'report-markdown', 'out', 'markdown']],
  ['validate-report', ['report', 'markdown']],
  ['context', ['manifest', 'results', 'review-import', 'requirements-review', 'security-review', 'report', 'report-markdown', 'controller-report', 'controller-report-markdown', 'out']],
  ['handoff', ['manifest', 'results', 'context', 'report', 'report-markdown', 'controller-report', 'controller-report-markdown', 'out']],
  ['receipt', ['artifact-commit', 'manifest', 'results', 'context', 'handoff', 'report', 'report-markdown', 'controller-report', 'controller-report-markdown', 'out']],
  ['validate-receipt', ['receipt', 'artifact-commit']],
] as const
for (const [command, names] of cliCases) {
  const tokens = names.flatMap((name) => [`--${name}`, `${name}-value`])
  const parsed = evidence.parseCliInvocation([command, ...tokens])
  assert.equal(parsed.command, command)
  assert.deepEqual(Object.keys(parsed.args.values), names)
}
const postCommitReceiptCli = evidence.parseCliInvocation(['validate-receipt', '--receipt', 'receipt-value', '--artifact-commit', 'artifact-value', '--receipt-commit', 'HEAD'])
assert.deepEqual(Object.keys(postCommitReceiptCli.args.values), ['receipt', 'artifact-commit', 'receipt-commit'])
expectCode(() => evidence.parseCliInvocation(['validate-report', '--report', 'report-only']), 'invalid_arguments')
expectCode(() => evidence.parseCliInvocation(['validate-report', '--report', 'a', '--markdown', 'b', '--surprise', 'c']), 'invalid_arguments')
expectCode(() => evidence.parseCliInvocation(['validate-report', '--report', 'a', '--report', 'b', '--markdown', 'c']), 'invalid_arguments')

function candidateIdentityFixture(label: string, name: string, email: string): { repository: string; base: string; candidate: string } {
  const repository = mkdtempSync(path.join(tmpdir(), `oracle-p0-1-candidate-${label}-`))
  git(repository, 'init', '-q')
  git(repository, 'config', 'user.name', name)
  git(repository, 'config', 'user.email', email)
  writeFileSync(path.join(repository, 'candidate.txt'), 'base\n')
  git(repository, 'add', 'candidate.txt')
  git(repository, 'commit', '-qm', 'base')
  const base = git(repository, 'rev-parse', 'HEAD')
  writeFileSync(path.join(repository, 'candidate.txt'), 'candidate\n')
  git(repository, 'commit', '-qam', 'candidate')
  return { repository, base, candidate: git(repository, 'rev-parse', 'HEAD') }
}

const ccCandidate = candidateIdentityFixture('cc', 'Candidate Author', 'candidate.cc@example.invalid')
const subCandidate = candidateIdentityFixture('sub', 'Sub Committer', 'candidate.sub@example.invalid')
assert.notEqual(ccCandidate.candidate, ccCandidate.base)
assert.notEqual(subCandidate.candidate, subCandidate.base)
const candidateCommitIdentities = evidence.readCandidateCommitIdentities({
  ccRoot: ccCandidate.repository,
  ccHead: ccCandidate.candidate,
  subRoot: subCandidate.repository,
  subHead: subCandidate.candidate,
})
assert.deepEqual(candidateCommitIdentities, {
  cc_gateway: {
    author_name: 'Candidate Author',
    author_email: 'candidate.cc@example.invalid',
    committer_name: 'Candidate Author',
    committer_email: 'candidate.cc@example.invalid',
  },
  sub2api: {
    author_name: 'Sub Committer',
    author_email: 'candidate.sub@example.invalid',
    committer_name: 'Sub Committer',
    committer_email: 'candidate.sub@example.invalid',
  },
})

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.equal((error as { code?: string }).code, code)
    return true
  })
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function cliFixture(label: string): string {
  const parent = mkdtempSync(path.join(tmpdir(), `oracle-p0-1-cli-${label}-`))
  const repository = path.join(parent, 'repository')
  execFileSync('git', ['clone', '-q', '--no-hardlinks', root, repository])
  writeFileSync(path.join(repository, toolRelative), readFileSync(path.join(root, toolRelative)))
  symlinkSync(path.join(root, 'node_modules'), path.join(repository, 'node_modules'), 'dir')
  return realpathSync(repository)
}

function runCli(repository: string, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(repository, toolRelative), ...args], {
    cwd: repository,
    encoding: 'utf8',
    env: { ...process.env, ...HERMETIC_NETWORK_ENV },
  })
}

function expectCliCode(result: ReturnType<typeof spawnSync>, code: string): void {
  assert.notEqual(result.status, 0, `CLI unexpectedly succeeded: ${result.stdout}`)
  const lines = String(result.stderr).trim().split('\n')
  const error = JSON.parse(lines.at(-1) ?? '{}') as { code?: string }
  assert.equal(error.code, code, String(result.stderr))
}

assert.equal(evidence.MAX_OUTPUT_BYTES, 8 * 1024 * 1024)
assert.deepEqual(evidence.HERMETIC_NETWORK_ENV, HERMETIC_NETWORK_ENV)
assert.equal(evidence.classifyExit(0, 0), 'pass')
assert.equal(evidence.classifyExit(1, 0), 'unexpected_fail')
assert.equal(evidence.classifyExit(1, 'nonzero'), 'expected_fail')
assert.equal(evidence.classifyExit(0, 'nonzero'), 'unexpected_pass')
assert.equal(evidence.validateCommandCatalogValue(catalog).ok, true)
assert.equal(evidence.validateCommandCatalogValue(missingEnv).ok, false)
assert.equal(evidence.validateCommandCatalogValue(wrongEnv).ok, false)
assert.equal(evidence.validateCommandCatalogValue(wrongArgv).ok, false)
assert.equal(evidence.validateCommandCatalogValue(wrongCwd).ok, false)
assert.equal(evidence.validateCommandCatalogValue(missingCrossBinding).ok, false)
assert.equal(evidence.validateCommandCatalogValue(injectedAllowedDelta).ok, false)

const source = '/Users/muqihang/chelingxi_workspace/cc-gateway-claude-code-2.1.207-oracle-lab/docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md'
const adopted = path.join(root, 'docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md')
const reviewImport = evidence.buildReviewImport({ reviewSource: source, adoptedAmendment: adopted, generatedAt: '2026-07-13T00:00:00.000Z' })
assert.equal(reviewImport.source.digest, evidence.TASK_0B_REVIEW_SOURCE_DIGEST)
assert.deepEqual(reviewImport.adopted, evidence.ADOPTED_AMENDMENT_BINDING)
assert.equal(evidence.validateReviewImportBytes(reviewImport, source, adopted).ok, true)
const zeroLengthImport = structuredClone(reviewImport)
zeroLengthImport.transformation.source_bytes = 0
assert.equal(evidence.validateReviewImportValue(zeroLengthImport).ok, false)
const oversizedImport = structuredClone(reviewImport)
oversizedImport.transformation.adopted_bytes = evidence.MAX_OUTPUT_BYTES + 1
assert.equal(evidence.validateReviewImportValue(oversizedImport).ok, false)
const arbitraryImportDir = mkdtempSync(path.join(tmpdir(), 'oracle-p0-1-review-import-arbitrary-'))
const arbitrarySource = path.join(arbitraryImportDir, 'source.md'); const arbitraryAdopted = path.join(arbitraryImportDir, 'adopted.md')
writeFileSync(arbitrarySource, 'arbitrary source amendment\n'); writeFileSync(arbitraryAdopted, 'arbitrary adopted amendment\n')
expectCode(() => evidence.buildReviewImport({ reviewSource: arbitrarySource, adoptedAmendment: arbitraryAdopted }), 'review_source_digest_mismatch')

const importCliRoot = cliFixture('review-import')
const cliSource = path.join(importCliRoot, 'arbitrary-source.md'); const cliAdopted = path.join(importCliRoot, 'arbitrary-adopted.md')
writeFileSync(cliSource, 'arbitrary source\n'); writeFileSync(cliAdopted, 'arbitrary adopted\n')
expectCliCode(runCli(importCliRoot, [
  'review-import', '--review-source', cliSource, '--adopted-amendment', cliAdopted, '--out', 'docs/superpowers/evidence/p0-1/p0-1-review-import.json',
]), 'review_source_digest_mismatch')

const report = evidence.buildReportValue({
  reportType: 'exit',
  generatedAt: '2026-07-13T00:00:00.000Z',
  manifest: { path: 'docs/superpowers/evidence/p0-1/p0-1-exit-baseline.json', digest: sha256('manifest') },
  results: { path: 'docs/superpowers/evidence/p0-1/p0-1-command-results.json', digest: sha256('results') },
  reviews: [{ role: 'requirements', digest: sha256('requirements') }, { role: 'security_quality', digest: sha256('security') }],
  status: 'pass',
  commandSummary: { pass: 7, expected_fail: 3, unexpected_fail: 0, unexpected_pass: 0 },
})
const markdown = evidence.renderReportMarkdown(report)
assert.equal(markdown, evidence.renderReportMarkdown(structuredClone(report)))
assert.equal(evidence.validateReportPair(report, markdown).ok, true)
assert.equal(evidence.validateReportPair(report, `${markdown}drift\n`).ok, false)
const unknownReport = { ...report, surprise: true }
assert.equal(evidence.validateReportPair(unknownReport, evidence.renderReportMarkdown(unknownReport)).ok, false)
const invalidReviewReport = evidence.buildReportValue({
  reportType: 'exit',
  generatedAt: report.generated_at,
  manifest: report.manifest,
  results: report.results,
  reviews: [{ role: 'requirements', digest: 'not-a-digest' }, { role: 'security_quality', digest: sha256('security') }],
  status: 'pass',
  commandSummary: report.command_summary,
})
assert.equal(evidence.validateReportValue(invalidReviewReport).ok, false)

function writeReportFixture(repository: string): void {
  const reportPath = path.join(repository, evidence.ARTIFACT_CHAIN.report)
  mkdirSync(path.dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${canonical(report)}\n`)
}

const leafSymlinkCliRoot = cliFixture('report-leaf-symlink')
writeReportFixture(leafSymlinkCliRoot)
const leafTarget = path.join(leafSymlinkCliRoot, 'report-target.md')
writeFileSync(leafTarget, markdown)
symlinkSync(leafTarget, path.join(leafSymlinkCliRoot, evidence.ARTIFACT_CHAIN.report_markdown))
expectCliCode(runCli(leafSymlinkCliRoot, [
  'validate-report', '--report', evidence.ARTIFACT_CHAIN.report, '--markdown', evidence.ARTIFACT_CHAIN.report_markdown,
]), 'artifact_symlink')

const parentSymlinkCliRoot = cliFixture('report-parent-symlink')
const evidenceParent = path.join(parentSymlinkCliRoot, 'docs/superpowers/evidence')
const evidenceDirectory = path.join(evidenceParent, 'p0-1'); const realEvidenceDirectory = path.join(evidenceParent, 'p0-1-real')
renameSync(evidenceDirectory, realEvidenceDirectory)
symlinkSync(realEvidenceDirectory, evidenceDirectory, 'dir')
writeReportFixture(parentSymlinkCliRoot)
writeFileSync(path.join(parentSymlinkCliRoot, evidence.ARTIFACT_CHAIN.report_markdown), markdown)
expectCliCode(runCli(parentSymlinkCliRoot, [
  'validate-report', '--report', evidence.ARTIFACT_CHAIN.report, '--markdown', evidence.ARTIFACT_CHAIN.report_markdown,
]), 'artifact_symlink')

const disabled = [...evidence.DISABLED_CAPABILITIES]
const handoff = evidence.buildHandoffValue({
  generatedAt: '2026-07-13T00:00:00.000Z',
  bindings: {
    manifest: { path: 'docs/superpowers/evidence/p0-1/p0-1-exit-baseline.json', digest: sha256('m') },
    results: { path: 'docs/superpowers/evidence/p0-1/p0-1-command-results.json', digest: sha256('r') },
    context: { path: 'docs/superpowers/evidence/p0-1/p0-1-context.json', digest: sha256('c') },
    report: { path: 'docs/superpowers/evidence/p0-1/p0-1-exit-report.json', digest: sha256('er') },
    report_markdown: { path: 'docs/superpowers/evidence/p0-1/p0-1-exit-report.md', digest: sha256('erm') },
    controller_report: { path: 'docs/superpowers/evidence/p0-1/controller-final-report.json', digest: sha256('cr') },
    controller_report_markdown: { path: 'docs/superpowers/evidence/p0-1/controller-final-report.md', digest: sha256('crm') },
  },
  disabledCapabilities: disabled,
})
assert.equal(evidence.validateHandoffValue(handoff, Date.parse('2026-07-13T00:30:00.000Z')).ok, true)
assert.equal(evidence.validateHandoffValue(handoff, Date.parse('2026-07-14T00:00:00.000Z')).ok, false)
const enabled = structuredClone(handoff)
enabled.disabled_capabilities.pop()
assert.equal(evidence.validateHandoffValue(enabled, Date.parse('2026-07-13T00:30:00.000Z')).ok, false)
const missingHandoffBinding = evidence.buildHandoffValue({
  generatedAt: handoff.generated_at,
  bindings: Object.fromEntries(Object.entries(handoff.bindings).filter(([name]) => name !== 'report_markdown')),
})
assert.equal(evidence.validateHandoffValue(missingHandoffBinding, Date.parse('2026-07-13T00:30:00.000Z')).ok, false)

const safeRoot = mkdtempSync(path.join(tmpdir(), 'oracle-p0-1-safe-output-'))
mkdirSync(path.join(safeRoot, 'docs/superpowers/evidence/p0-1'), { recursive: true })
const safeOut = path.join(safeRoot, 'docs/superpowers/evidence/p0-1/out.json')
evidence.writeExclusiveArtifact(safeOut, { ok: true }, path.join(safeRoot, 'docs/superpowers/evidence'))
assert.equal(readFileSync(safeOut, 'utf8'), '{"ok":true}\n')
expectCode(() => evidence.writeExclusiveArtifact(path.join(safeRoot, '../escape.json'), { ok: true }, path.join(safeRoot, 'docs/superpowers/evidence')), 'artifact_path_escape')
const symlinkOut = path.join(safeRoot, 'docs/superpowers/evidence/p0-1/link.json')
symlinkSync(path.join(safeRoot, 'target.json'), symlinkOut)
expectCode(() => evidence.writeExclusiveArtifact(symlinkOut, { ok: true }, path.join(safeRoot, 'docs/superpowers/evidence')), 'artifact_symlink')
const pairRoot = mkdtempSync(path.join(tmpdir(), 'oracle-p0-1-pair-output-'))
const pairEvidenceRoot = path.join(pairRoot, 'docs/superpowers/evidence')
mkdirSync(path.join(pairEvidenceRoot, 'p0-1'), { recursive: true })
const pairJson = path.join(pairEvidenceRoot, 'p0-1/report.json'); const pairMarkdown = path.join(pairEvidenceRoot, 'p0-1/report.md')
symlinkSync(path.join(pairRoot, 'target.md'), pairMarkdown)
expectCode(() => evidence.writeExclusiveArtifactPair(pairJson, { ok: true }, pairMarkdown, '# report\n', pairEvidenceRoot), 'artifact_symlink')
assert.equal(existsSync(pairJson), false)

const bounded = evidence.runBoundedProcess({
  argv: [process.execPath, '-e', "process.stdout.write('ok'); process.stderr.write('err')"],
  cwd: root,
  env: { PATH: process.env.PATH ?? '' },
  timeoutMs: 5_000,
  maxOutputBytes: 128,
})
assert.equal(bounded.exitCode, 0)
assert.equal(bounded.stdoutDigest, sha256('ok'))
assert.equal(bounded.stderrDigest, sha256('err'))
assert.equal(bounded.outputOverflow, false)
const overflow = evidence.runBoundedProcess({
  argv: [process.execPath, '-e', "process.stdout.write('x'.repeat(4096)); setInterval(() => {}, 1000)"],
  cwd: root,
  env: { PATH: process.env.PATH ?? '' },
  timeoutMs: 5_000,
  maxOutputBytes: 64,
})
assert.equal(overflow.outputOverflow, true)
assert.notEqual(overflow.exitCode, 0)
const lateFailure = evidence.runBoundedProcess({
  argv: [process.execPath, '-e', "process.stdout.write('x'.repeat(4096)+'\\n--- FAIL: TestPhase0B6LateBoundary\\nmodule lookup disabled by GOPROXY=off\\n');process.exit(1)"],
  cwd: root,
  env: { PATH: process.env.PATH ?? '' },
  timeoutMs: 5_000,
  maxOutputBytes: 8_192,
})
assert.equal(lateFailure.infrastructureFailure, true)
assert.equal(lateFailure.failureNames.includes('TestPhase0B6LateBoundary'), true)
const lateStdoutCanary = 'ORACLE_SECRET_' + 'CANARY=late-stdout-value'
const lateStdoutUnsafe = evidence.runBoundedProcess({
  argv: [process.execPath, '-e', `process.stdout.write('x'.repeat(4096) + ${JSON.stringify(lateStdoutCanary)})`],
  cwd: root,
  env: { PATH: process.env.PATH ?? '' },
  timeoutMs: 5_000,
  maxOutputBytes: 8_192,
})
assert.equal(lateStdoutUnsafe.unsafeOutputDetected, true)
assert.equal(evidence.classifyBoundedProcess(lateStdoutUnsafe, 0), 'unexpected_fail')
assert.equal(JSON.stringify(lateStdoutUnsafe).includes(lateStdoutCanary), false)

const stderrCredential = 'Authorization: Bearer stderr-credential-value'
const stderrUnsafe = evidence.runBoundedProcess({
  argv: [process.execPath, '-e', `process.stderr.write(${JSON.stringify(stderrCredential)})`],
  cwd: root,
  env: { PATH: process.env.PATH ?? '' },
  timeoutMs: 5_000,
  maxOutputBytes: 8_192,
})
assert.equal(stderrUnsafe.unsafeOutputDetected, true)
assert.equal(evidence.classifyBoundedProcess(stderrUnsafe, 0), 'unexpected_fail')
assert.equal(JSON.stringify(stderrUnsafe).includes(stderrCredential), false)

const splitCanary = 'ORACLE_SECRET_' + 'CANARY=split-across-chunks'
const splitUnsafe = evidence.runBoundedProcess({
  argv: [process.execPath, '-e', "process.stdout.write('ORACLE_SECRET_'); setTimeout(() => process.stdout.write('CANARY=split-across-chunks'), 25)"],
  cwd: root,
  env: { PATH: process.env.PATH ?? '' },
  timeoutMs: 5_000,
  maxOutputBytes: 8_192,
})
assert.equal(splitUnsafe.unsafeOutputDetected, true)
assert.equal(evidence.classifyBoundedProcess(splitUnsafe, 0), 'unexpected_fail')
assert.equal(JSON.stringify(splitUnsafe).includes(splitCanary), false)
const timedOut = evidence.runBoundedProcess({
  argv: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
  cwd: root,
  env: { PATH: process.env.PATH ?? '' },
  timeoutMs: 50,
  maxOutputBytes: 128,
})
assert.equal(timedOut.timedOut, true)
assert.notEqual(timedOut.exitCode, 0)

function git(repository: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

const priorRelative = 'docs/superpowers/evidence/p0-1/p0-1-exit-baseline.json'
function snapshotFixture(label: string): { repository: string; priorAbsolute: string; priorBinding: { path: string; digest: string } } {
  const repository = mkdtempSync(path.join(tmpdir(), `oracle-p0-1-${label}-`))
  git(repository, 'init', '-q')
  git(repository, 'config', 'user.email', 'oracle@example.invalid')
  git(repository, 'config', 'user.name', 'Oracle Test')
  git(repository, 'branch', '-m', 'codex/oracle-p0-1-governance')
  writeFileSync(path.join(repository, 'tracked.txt'), 'tracked\n')
  git(repository, 'add', 'tracked.txt')
  git(repository, 'commit', '-qm', 'base')
  mkdirSync(path.join(repository, 'docs/superpowers/evidence/p0-1'), { recursive: true })
  const priorAbsolute = path.join(repository, priorRelative)
  writeFileSync(priorAbsolute, '{"prior":true}\n')
  return { repository, priorAbsolute, priorBinding: { path: priorRelative, digest: sha256(readFileSync(priorAbsolute)) } }
}

const snapshotCase = snapshotFixture('snapshot')
const snapshotRoot = snapshotCase.repository
const priorAbsolute = path.join(snapshotRoot, priorRelative)
const priorBinding = snapshotCase.priorBinding
const snapshot = evidence.captureRepositorySnapshot(snapshotRoot, [priorBinding])
assert.equal(snapshot.head, git(snapshotRoot, 'rev-parse', 'HEAD'))
assert.deepEqual(snapshot.allowed_artifacts, [priorBinding])
evidence.assertRepositorySnapshot(snapshotRoot, snapshot, [priorBinding])
writeFileSync(path.join(snapshotRoot, `${priorRelative}.extra`), 'same-prefix extra\n')
expectCode(() => evidence.captureRepositorySnapshot(snapshotRoot, [priorBinding]), 'undeclared_dirty_path')
const priorMutationCase = snapshotFixture('prior-mutation')
writeFileSync(priorMutationCase.priorAbsolute, '{"prior":"mutated"}\n')
expectCode(() => evidence.captureRepositorySnapshot(priorMutationCase.repository, [priorMutationCase.priorBinding]), 'prior_output_mutated')
const trackedMutationCase = snapshotFixture('tracked-mutation')
const trackedSnapshot = evidence.captureRepositorySnapshot(trackedMutationCase.repository, [trackedMutationCase.priorBinding])
writeFileSync(path.join(trackedMutationCase.repository, 'tracked.txt'), 'mutated tracked\n')
expectCode(() => evidence.assertRepositorySnapshot(trackedMutationCase.repository, trackedSnapshot, [trackedMutationCase.priorBinding]), 'repository_mutation')
const chainStateCase = snapshotFixture('chain-state')
evidence.initializeChainState(chainStateCase.repository, [chainStateCase.priorBinding])
evidence.assertChainState(chainStateCase.repository, [chainStateCase.priorBinding])
writeFileSync(chainStateCase.priorAbsolute, '{"prior":"rehashed-mutation"}\n')
const rehashedPrior = { path: priorRelative, digest: sha256(readFileSync(chainStateCase.priorAbsolute)) }
expectCode(() => evidence.assertChainState(chainStateCase.repository, [rehashedPrior]), 'prior_output_mutated')
assert.deepEqual(evidence.STAGE_TRANSITIONS, {
  exit: { prior: [], produced: ['exit'] },
  green: { prior: ['exit'], produced: ['green'] },
  red: { prior: ['exit', 'green'], produced: ['red'] },
  results: { prior: ['exit', 'green', 'red'], produced: ['results'] },
  report: { prior: ['exit', 'green', 'red', 'results'], produced: ['report', 'report_markdown'] },
  controller_report: { prior: ['exit', 'green', 'red', 'results', 'report', 'report_markdown'], produced: ['controller_report', 'controller_report_markdown'] },
  context: { prior: ['exit', 'green', 'red', 'results', 'report', 'report_markdown', 'controller_report', 'controller_report_markdown'], produced: ['context'] },
  handoff: { prior: ['exit', 'green', 'red', 'results', 'report', 'report_markdown', 'controller_report', 'controller_report_markdown', 'context'], produced: ['handoff'] },
  receipt: { prior: ['exit', 'green', 'red', 'results', 'report', 'report_markdown', 'controller_report', 'controller_report_markdown', 'context', 'handoff'], produced: ['receipt'] },
})
const wiredChain = snapshotFixture('wired-chain')
evidence.initializeArtifactChain(wiredChain.repository)
const wiredGreen = path.join(wiredChain.repository, evidence.ARTIFACT_CHAIN.green)
writeFileSync(wiredGreen, '{"green":true}\n')
evidence.completeArtifactChainStage(wiredChain.repository, 'green')
evidence.prepareArtifactChainStage(wiredChain.repository, 'red')
writeFileSync(wiredGreen, '{"green":"mutated"}\n')
expectCode(() => evidence.prepareArtifactChainStage(wiredChain.repository, 'red'), 'prior_output_mutated')
const dirtyCompletion = snapshotFixture('dirty-completion')
evidence.initializeArtifactChain(dirtyCompletion.repository)
writeFileSync(path.join(dirtyCompletion.repository, evidence.ARTIFACT_CHAIN.green), '{"green":true}\n')
writeFileSync(path.join(dirtyCompletion.repository, 'same-stage-extra.json'), '{}\n')
expectCode(() => evidence.completeArtifactChainStage(dirtyCompletion.repository, 'green'), 'undeclared_dirty_path')

function reportTransactionFixture(label: string): { repository: string; prior: Array<{ path: string; digest: string }> } {
  const fixture = snapshotFixture(`report-transaction-${label}`)
  const reportSchema = schemaRelatives[6]
  mkdirSync(path.dirname(path.join(fixture.repository, reportSchema)), { recursive: true })
  writeFileSync(path.join(fixture.repository, reportSchema), readFileSync(path.join(root, reportSchema)))
  git(fixture.repository, 'add', reportSchema)
  git(fixture.repository, 'commit', '-qm', 'report schema')
  const prior = evidence.STAGE_TRANSITIONS.report.prior.map((name: keyof typeof evidence.ARTIFACT_CHAIN) => {
    const artifactPath = evidence.ARTIFACT_CHAIN[name]
    const absolute = path.join(fixture.repository, artifactPath)
    if (!existsSync(absolute)) writeFileSync(absolute, `${JSON.stringify({ stage: name })}\n`)
    return { path: artifactPath, digest: sha256(readFileSync(absolute)) }
  })
  evidence.initializeChainState(fixture.repository, prior)
  return { repository: fixture.repository, prior }
}

function injectAt(expectedBoundary: string): (boundary: string) => void {
  return (boundary) => {
    if (boundary === expectedBoundary) throw Object.assign(new Error(`injected failure at ${boundary}`), { code: 'injected_pair_failure' })
  }
}

const jsonBoundaryPair = reportTransactionFixture('after-json')
expectCode(() => evidence.writeReportPairTransaction(jsonBoundaryPair.repository, 'report', report, injectAt('after_json_published')), 'injected_pair_failure')
assert.equal(existsSync(path.join(jsonBoundaryPair.repository, evidence.ARTIFACT_CHAIN.report)), true)
assert.equal(existsSync(path.join(jsonBoundaryPair.repository, evidence.ARTIFACT_CHAIN.report_markdown)), false)
expectCode(() => evidence.assertAcceptedReportPair(jsonBoundaryPair.repository, 'report'), 'incomplete_report_transaction')
expectCode(() => evidence.completeArtifactChainStage(jsonBoundaryPair.repository, 'report'), 'missing_artifact')

const markdownBoundaryPair = reportTransactionFixture('after-markdown')
expectCode(() => evidence.writeReportPairTransaction(markdownBoundaryPair.repository, 'report', report, injectAt('after_markdown_published')), 'injected_pair_failure')
assert.equal(existsSync(path.join(markdownBoundaryPair.repository, evidence.ARTIFACT_CHAIN.report)), true)
assert.equal(existsSync(path.join(markdownBoundaryPair.repository, evidence.ARTIFACT_CHAIN.report_markdown)), true)
expectCode(() => evidence.assertAcceptedReportPair(markdownBoundaryPair.repository, 'report'), 'incomplete_report_transaction')
expectCode(() => evidence.prepareArtifactChainStage(markdownBoundaryPair.repository, 'controller_report'), 'prior_output_mutated')

const transitionBoundaryPair = reportTransactionFixture('before-transition')
expectCode(() => evidence.writeReportPairTransaction(transitionBoundaryPair.repository, 'report', report, injectAt('before_chain_transition')), 'injected_pair_failure')
expectCode(() => evidence.assertAcceptedReportPair(transitionBoundaryPair.repository, 'report'), 'incomplete_report_transaction')
expectCode(() => evidence.prepareArtifactChainStage(transitionBoundaryPair.repository, 'controller_report'), 'prior_output_mutated')

const acceptedPair = reportTransactionFixture('accepted')
evidence.writeReportPairTransaction(acceptedPair.repository, 'report', report)
assert.deepEqual(evidence.assertAcceptedReportPair(acceptedPair.repository, 'report'), report)
evidence.prepareArtifactChainStage(acceptedPair.repository, 'controller_report')

const symlinkCase = snapshotFixture('symlink')
const symlinkPrior = path.join(symlinkCase.repository, 'docs/superpowers/evidence/p0-1/symlink.json')
symlinkSync(path.join(symlinkCase.repository, 'tracked.txt'), symlinkPrior)
expectCode(() => evidence.captureRepositorySnapshot(symlinkCase.repository, [{ path: 'docs/superpowers/evidence/p0-1/symlink.json', digest: symlinkCase.priorBinding.digest }]), 'artifact_symlink')
const renameRoot = mkdtempSync(path.join(tmpdir(), 'oracle-p0-1-rename-source-'))
git(renameRoot, 'init', '-q'); git(renameRoot, 'config', 'user.email', 'oracle@example.invalid'); git(renameRoot, 'config', 'user.name', 'Oracle Test'); git(renameRoot, 'branch', '-m', 'codex/oracle-p0-1-governance')
writeFileSync(path.join(renameRoot, 'tracked-source.json'), '{"prior":true}\n'); git(renameRoot, 'add', 'tracked-source.json'); git(renameRoot, 'commit', '-qm', 'tracked source')
mkdirSync(path.join(renameRoot, 'docs/superpowers/evidence/p0-1'), { recursive: true })
git(renameRoot, 'mv', 'tracked-source.json', priorRelative)
expectCode(() => evidence.captureRepositorySnapshot(renameRoot, [{ path: priorRelative, digest: sha256(readFileSync(path.join(renameRoot, priorRelative))) }]), 'undeclared_dirty_path')

const descendantRoot = mkdtempSync(path.join(tmpdir(), 'oracle-p0-1-descendant-'))
const descendantPid = path.join(descendantRoot, 'pid')
const descendantResult = evidence.runBoundedProcess({
  argv: [process.execPath, '-e', `const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});if(process.send)process.send('ready');setInterval(()=>{},1000)"],{stdio:['ignore','ignore','ignore','ipc']});c.once('message',()=>{writeFileSync(${JSON.stringify(descendantPid)},String(c.pid));process.stdout.write('READY\\n')});setInterval(()=>{},1000)`],
  cwd: descendantRoot,
  env: { PATH: process.env.PATH ?? '' },
  timeoutMs: 500,
  maxOutputBytes: 128,
})
assert.equal(descendantResult.timedOut, true)
const descendant = Number(readFileSync(descendantPid, 'utf8'))
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
assert.throws(() => process.kill(descendant, 0), /ESRCH/)

const reviewBase = {
  schema_version: 1,
  review_kind: 'governance_amendment_review',
  reviewer_identity: 'reviewer-requirements',
  reviewer_role: 'requirements',
  reviewed_candidate_heads: { cc_gateway: '1'.repeat(40), sub2api: '2'.repeat(40) },
  diff_digests: { cc_gateway: sha256('cc-diff'), sub2api: sha256('sub-diff') },
  plan_digest: sha256('plan'),
  review_import_digest: sha256('review-import'),
  decision: 'approved',
  findings: { critical: 0, important: 0, summaries: ['all requirements represented'] },
  verification: ['focused suite passed'],
}
const securityReview = { ...structuredClone(reviewBase), reviewer_identity: 'reviewer-security', reviewer_role: 'security_quality' }
const reviewExpected = {
  heads: reviewBase.reviewed_candidate_heads,
  diffs: reviewBase.diff_digests,
  planDigest: reviewBase.plan_digest,
  reviewImportDigest: reviewBase.review_import_digest,
  candidateCommitIdentities,
}
assert.equal(evidence.validateReviewPair(reviewBase, securityReview, reviewExpected).ok, true)
evidence.validateReviewEvidenceSchemas({ root, requirements: reviewBase, security: securityReview, reviewImport, schemaCommit: 'HEAD' })
const reviewWithUnknownNestedField = structuredClone(reviewBase) as any
reviewWithUnknownNestedField.reviewed_candidate_heads.surprise = '3'.repeat(40)
expectCode(() => evidence.validateReviewEvidenceSchemas({ root, requirements: reviewWithUnknownNestedField, security: securityReview, reviewImport, schemaCommit: 'HEAD' }), 'schema_validation_failed')

const reviewCliRoot = cliFixture('strict-reviews')
const subCloneParent = mkdtempSync(path.join(tmpdir(), 'oracle-p0-1-cli-sub2api-'))
const reviewCliSubPath = path.join(subCloneParent, 'repository')
execFileSync('git', ['clone', '-q', '--no-hardlinks', '/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-p0-1', reviewCliSubPath])
const reviewCliSubRoot = realpathSync(reviewCliSubPath)
git(reviewCliRoot, 'config', 'user.name', 'Fixture Candidate')
git(reviewCliRoot, 'config', 'user.email', 'fixture-candidate@example.invalid')
const reviewImportRelative = 'docs/superpowers/evidence/p0-1/p0-1-review-import.json'
writeFileSync(path.join(reviewCliRoot, reviewImportRelative), `${canonical(reviewImport)}\n`)
git(reviewCliRoot, 'add', reviewImportRelative)
git(reviewCliRoot, 'commit', '-qm', 'candidate review import')
const reviewCliCandidate = git(reviewCliRoot, 'rev-parse', 'HEAD')
const reviewCliSubCandidate = git(reviewCliSubRoot, 'rev-parse', 'HEAD')
const cliReviewBase = {
  ...structuredClone(reviewBase),
  reviewed_candidate_heads: { cc_gateway: reviewCliCandidate, sub2api: reviewCliSubCandidate },
  diff_digests: {
    cc_gateway: sha256(execFileSync('git', ['-C', reviewCliRoot, 'diff', '--binary', `9ca9ea72d881fccd2cfb3fd1b939a2f56db69516...${reviewCliCandidate}`, '--'])),
    sub2api: sha256(execFileSync('git', ['-C', reviewCliSubRoot, 'diff', '--binary', `d5a42bbd24d15af2ce7646d050a5ae5c77911d4f...${reviewCliSubCandidate}`, '--'])),
  },
  plan_digest: sha256(readFileSync(path.join(reviewCliRoot, 'docs/superpowers/plans/2026-07-12-claude-code-2.1.207-p0-1-wp-r0-governance-reconciliation.md'))),
  review_import_digest: sha256(readFileSync(path.join(reviewCliRoot, reviewImportRelative))),
}
const invalidCliRequirementsReview = structuredClone(cliReviewBase) as any
invalidCliRequirementsReview.reviewed_candidate_heads.surprise = '4'.repeat(40)
const cliSecurityReview = { ...structuredClone(cliReviewBase), reviewer_identity: 'reviewer-security', reviewer_role: 'security_quality' }
const cliRequirementsPath = path.join(reviewCliRoot, 'docs/superpowers/evidence/p0-1/requirements-review.json')
const cliSecurityPath = path.join(reviewCliRoot, 'docs/superpowers/evidence/p0-1/security-quality-review.json')
writeFileSync(cliRequirementsPath, `${canonical(invalidCliRequirementsReview)}\n`)
writeFileSync(cliSecurityPath, `${canonical(cliSecurityReview)}\n`)
git(reviewCliRoot, 'add', 'docs/superpowers/evidence/p0-1/requirements-review.json', 'docs/superpowers/evidence/p0-1/security-quality-review.json')
git(reviewCliRoot, 'commit', '-qm', 'approval attestations')
expectCliCode(runCli(reviewCliRoot, [
  'validate-reviews',
  '--requirements-review', cliRequirementsPath,
  '--security-review', cliSecurityPath,
  '--review-import', path.join(reviewCliRoot, reviewImportRelative),
  '--cc-gateway-root', reviewCliRoot,
  '--sub2api-root', reviewCliSubRoot,
]), 'schema_validation_failed')
assert.equal(evidence.validateReviewPair(reviewBase, { ...securityReview, reviewer_identity: 'reviewer.requirements' }, reviewExpected).ok, false)
assert.equal(evidence.validateReviewPair({ ...reviewBase, reviewer_identity: 'candidate.author' }, securityReview, reviewExpected).ok, false)
assert.equal(evidence.validateReviewPair(reviewBase, { ...securityReview, reviewer_identity: 'candidate.sub@example.invalid' }, reviewExpected).ok, false)
assert.equal(evidence.validateReviewPair(reviewBase, { ...securityReview, reviewer_identity: reviewBase.reviewer_identity }, reviewExpected).ok, false)
assert.equal(evidence.validateReviewPair(reviewBase, { ...securityReview, reviewer_role: 'requirements' }, reviewExpected).ok, false)
assert.equal(evidence.validateReviewPair({ ...reviewBase, decision: 'blocked' }, securityReview, reviewExpected).ok, false)
assert.equal(evidence.validateReviewPair({ ...reviewBase, findings: { ...reviewBase.findings, important: 1 } }, securityReview, reviewExpected).ok, false)
assert.equal(evidence.validateReviewPair({ ...reviewBase, reviewed_candidate_heads: { ...reviewBase.reviewed_candidate_heads, cc_gateway: '3'.repeat(40) } }, securityReview, reviewExpected).ok, false)

const executionBindingValues = {
  cc_gateway_head: '1'.repeat(40),
  sub2api_head: '2'.repeat(40),
  cc_gateway_before_snapshot: sha256('cc-before'),
  cc_gateway_after_snapshot: sha256('cc-before'),
  sub2api_before_snapshot: sha256('sub-before'),
  sub2api_after_snapshot: sha256('sub-before'),
  shared_contract_digest: 'sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1',
}
assert.deepEqual(evidence.buildExecutionBindings(catalog[5].bindings, executionBindingValues), executionBindingValues)
expectCode(() => evidence.buildExecutionBindings(catalog[5].bindings, { ...executionBindingValues, shared_contract_digest: undefined }), 'incomplete_execution_binding')

function resultRecord(commandId: string, status: string, expectedExit: 0 | 'nonzero'): Record<string, unknown> {
  const catalogEntry = catalog.find((entry: any) => entry.id === commandId)
  const execution_bindings = evidence.buildExecutionBindings(catalogEntry.bindings, executionBindingValues)
  const unsigned = {
    command_id: commandId,
    repository: commandId.startsWith('sub2api') ? 'sub2api' : commandId.startsWith('sidecar') ? 'egress-tls-sidecar' : 'cc-gateway',
    repository_commit: commandId.startsWith('sub2api') ? '2'.repeat(40) : '1'.repeat(40),
    expected_exit: expectedExit,
    exit_code: expectedExit === 0 ? 0 : 1,
    status,
    duration_ms: 1,
    stdout_digest: sha256(''),
    stderr_digest: sha256(''),
    output_bytes: 0,
    timed_out: false,
    output_overflow: false,
    failure_names: expectedExit === 'nonzero'
      ? commandId === 'sub2api-boundary-red'
        ? ['TestFormalPoolOnboardingBoundary', 'TestBrowserBoundary', 'TestEgressBoundary']
        : ['TestPhase0B4Boundary', 'TestPhase0B5Boundary', 'TestPhase0B6Boundary']
      : [],
    manifest_digest: sha256('manifest'),
    catalog_entry_digest: evidence.catalogEntryDigest(catalogEntry),
    argv_digest: sha256(JSON.stringify(catalogEntry.argv)),
    environment_digest: sha256(JSON.stringify(catalogEntry.env)),
    execution_bindings,
  }
  return { ...unsigned, result_digest: sha256(canonical(unsigned)) }
}
const resultBase = {
  schema_version: 1,
  result_kind: 'governance_amendment_command_results',
  generated_at: '2026-07-13T00:00:00.000Z',
  expires_at: '2026-07-20T00:00:00.000Z',
  manifest_digest: sha256('manifest'),
  catalog_digest: sha256('catalog'),
}
const greenRecords = expectedCatalog.slice(0, 7).map(([id]) => resultRecord(id, 'pass', 0))
const redRecords = expectedCatalog.slice(7).map(([id]) => resultRecord(id, 'expected_fail', 'nonzero'))
const greenSet = evidence.buildResultSet({ ...resultBase, group: 'green', records: greenRecords })
const redSet = evidence.buildResultSet({ ...resultBase, group: 'red', records: redRecords })
assert.equal(evidence.validateResultSetValue(greenSet, Date.parse('2026-07-13T01:00:00.000Z')).ok, true)
assert.equal(evidence.validateResultSetValue(redSet, Date.parse('2026-07-13T01:00:00.000Z')).ok, true)
const safeUnexpectedRecords = structuredClone(greenRecords) as any[]
safeUnexpectedRecords[0].status = 'unexpected_fail'
const { result_digest: _safeUnexpectedDigest, ...safeUnexpectedUnsigned } = safeUnexpectedRecords[0]
safeUnexpectedRecords[0].result_digest = sha256(canonical(safeUnexpectedUnsigned))
const safeUnexpectedSet = evidence.buildResultSet({ ...resultBase, group: 'green', records: safeUnexpectedRecords })
assert.equal(evidence.validateResultSetValue(safeUnexpectedSet, Date.parse('2026-07-13T01:00:00.000Z')).ok, true)
const merged = evidence.mergeResultSets(greenSet, redSet, '2026-07-13T00:00:00.000Z')
assert.equal(merged.group, 'merged')
assert.deepEqual(merged.records.map((record: any) => record.command_id), [...COMMAND_IDS_FOR_TEST('green'), ...COMMAND_IDS_FOR_TEST('red')].sort())
assert.equal(evidence.validateResultSetValue(merged, Date.parse('2026-07-13T01:00:00.000Z')).ok, true)
const validateResultsSchema = ajv.compile(JSON.parse(readFileSync(path.join(root, schemaRelatives[2]), 'utf8')))
assert.equal(validateResultsSchema(merged), true, JSON.stringify(validateResultsSchema.errors))
const unknownExecutionBindingSet = structuredClone(merged) as any
unknownExecutionBindingSet.records[0].execution_bindings.surprise = sha256('surprise')
assert.equal(validateResultsSchema(unknownExecutionBindingSet), false)
expectCode(() => evidence.mergeResultSets(evidence.buildResultSet({ ...resultBase, group: 'green', records: greenRecords.slice(1) }), redSet), 'incomplete_result_set')

assert.deepEqual(evidence.ARTIFACT_CHAIN, {
  exit: 'docs/superpowers/evidence/p0-1/p0-1-exit-baseline.json',
  green: 'docs/superpowers/evidence/p0-1/p0-1-green-results.json',
  red: 'docs/superpowers/evidence/p0-1/p0-1-red-results.json',
  results: 'docs/superpowers/evidence/p0-1/p0-1-command-results.json',
  report: 'docs/superpowers/evidence/p0-1/p0-1-exit-report.json',
  report_markdown: 'docs/superpowers/evidence/p0-1/p0-1-exit-report.md',
  controller_report: 'docs/superpowers/evidence/p0-1/controller-final-report.json',
  controller_report_markdown: 'docs/superpowers/evidence/p0-1/controller-final-report.md',
  context: 'docs/superpowers/evidence/p0-1/p0-1-context.json',
  handoff: 'docs/superpowers/evidence/p0-1/p0-1-handoff.json',
  receipt: 'docs/superpowers/evidence/p0-1/p0-1-successor-receipt.json',
})
const contextValue = evidence.buildContextValue({
  generatedAt: '2026-07-13T00:00:00.000Z',
  bindings: Object.fromEntries(Object.entries(handoff.bindings).filter(([name]) => name !== 'context')),
  reviewImport: { path: 'docs/superpowers/evidence/p0-1/p0-1-review-import.json', digest: sha256('review-import') },
  reviews: [
    { path: 'docs/superpowers/evidence/p0-1/requirements-review.json', digest: sha256('requirements') },
    { path: 'docs/superpowers/evidence/p0-1/security-quality-review.json', digest: sha256('security') },
  ],
})
assert.equal(evidence.validateContextValue(contextValue, Date.parse('2026-07-13T00:30:00.000Z')).ok, true)
assert.equal(evidence.validateContextValue(contextValue, Date.parse('2026-07-14T00:00:00.000Z')).ok, false)
const missingContextBinding = evidence.buildContextValue({
  generatedAt: contextValue.generated_at,
  bindings: Object.fromEntries(Object.entries(contextValue.bindings).filter(([name]) => name !== 'controller_report_markdown')),
  reviewImport: contextValue.review_import,
  reviews: contextValue.reviews,
})
assert.equal(evidence.validateContextValue(missingContextBinding, Date.parse('2026-07-13T00:30:00.000Z')).ok, false)
const impossibleContext = structuredClone(contextValue) as any
impossibleContext.generated_at = '2026-02-31T00:00:00.000Z'
impossibleContext.expires_at = '2026-03-04T00:00:00.000Z'
const { context_digest: _impossibleDigest, ...impossibleUnsigned } = impossibleContext
impossibleContext.context_digest = sha256(canonical(impossibleUnsigned))
assert.equal(evidence.validateContextValue(impossibleContext, Date.parse('2026-03-03T00:30:00.000Z')).ok, false)
const receiptValue = evidence.buildReceiptValue({
  generatedAt: '2026-07-13T00:00:00.000Z',
  artifactCommit: '1'.repeat(40),
  reviewedHeads: { cc_gateway: '2'.repeat(40), sub2api: '3'.repeat(40) },
  parentReceipts: {
    phase_zero: { path: 'docs/superpowers/evidence/phase-0/phase-0-exit-receipt.json', digest: sha256('phase-zero') },
    post_integration_v2: { path: 'docs/superpowers/evidence/post-integration-v2/post-integration-receipt.json', digest: sha256('post-integration-v2') },
  },
  artifactDigests: Object.fromEntries((Object.values(evidence.ARTIFACT_CHAIN) as string[]).slice(0, -1).map((artifactPath) => [artifactPath, sha256(artifactPath)])),
})
assert.equal(evidence.validateReceiptValue(receiptValue).ok, true)
assert.equal(evidence.validateReceiptValue({ ...receiptValue, artifact_commit: 'not-a-commit' }).ok, false)
assert.equal(evidence.validateReceiptValue({ ...receiptValue, disabled_capabilities: receiptValue.disabled_capabilities.slice(1) }).ok, false)
const arbitraryReceiptAmendment = evidence.buildReceiptValue({
  generatedAt: receiptValue.generated_at,
  artifactCommit: receiptValue.artifact_commit,
  reviewedHeads: receiptValue.reviewed_heads,
  parentReceipts: receiptValue.parent_receipts,
  artifactDigests: receiptValue.artifact_digests,
  reviewAmendment: { source_digest: sha256('arbitrary-source'), adopted_digest: sha256('arbitrary-adopted') },
})
assert.equal(evidence.validateReceiptValue(arbitraryReceiptAmendment).ok, false)

const revisionRoot = cliFixture('receipt-revision')
const revisionHead = git(revisionRoot, 'rev-parse', 'HEAD')
assert.equal(evidence.resolveCommitish(revisionRoot, 'HEAD', 'invalid_receipt_commit'), revisionHead)
const blobPath = path.join(revisionRoot, 'not-a-commit.txt')
writeFileSync(blobPath, 'not a commit\n')
const blob = git(revisionRoot, 'hash-object', '-w', blobPath)
expectCode(() => evidence.resolveCommitish(revisionRoot, 'does-not-exist', 'invalid_receipt_commit'), 'invalid_receipt_commit')
expectCode(() => evidence.resolveCommitish(revisionRoot, blob, 'invalid_receipt_commit'), 'invalid_receipt_commit')
expectCliCode(runCli(revisionRoot, [
  'validate-receipt', '--receipt', evidence.ARTIFACT_CHAIN.receipt, '--artifact-commit', revisionHead, '--receipt-commit', 'does-not-exist',
]), 'invalid_receipt_commit')
expectCliCode(runCli(revisionRoot, [
  'validate-receipt', '--receipt', evidence.ARTIFACT_CHAIN.receipt, '--artifact-commit', revisionHead, '--receipt-commit', blob,
]), 'invalid_receipt_commit')
assert.deepEqual(evidence.SUPPORTED_SUBCOMMANDS, [
  'capture-exit',
  'run',
  'merge',
  'review-import',
  'validate-review-import',
  'validate-reviews',
  'report',
  'controller-report',
  'validate-report',
  'context',
  'handoff',
  'receipt',
  'validate-receipt',
])

const artifact = (artifactPath: string) => ({ path: artifactPath, digest: sha256(artifactPath) })
const exitValue = evidence.buildExitValue({
  generated_at: '2026-07-13T00:00:00.000Z',
  entry: { path: 'docs/superpowers/evidence/p0-1/p0-1-entry-baseline.json', digest: 'sha256:e6d7426c63f8bf96a91de5c47d9fc6807fae5da68ad507e8ba65b93f2732f235' },
  entry_receipt: { path: 'docs/superpowers/evidence/p0-1/p0-1-entry-baseline.receipt.json', digest: 'sha256:f787ea8bfd1e7f640719dbba11f8e4835d468bed1045e82faa50561bdbcf9d06' },
  repositories: {
    cc_gateway: { head: '1'.repeat(40), branch: 'codex/oracle-p0-1-governance', clean: true, snapshot_digest: sha256('cc-snapshot') },
    sub2api: { head: '2'.repeat(40), branch: 'codex/oracle-p0-1-governance', clean: true, snapshot_digest: sha256('sub-snapshot') },
  },
  reviewed_candidate_heads: { cc_gateway: '3'.repeat(40), sub2api: '2'.repeat(40) },
  candidate_commit_identities: candidateCommitIdentities,
  approval_attestation_head: '1'.repeat(40),
  shared_contract: { path: 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json', digest: 'sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1' },
  parent_receipts: {
    phase_zero: { path: 'docs/superpowers/evidence/phase-0/phase-0-exit-receipt.json', digest: 'sha256:5a2bef840e04d6533bfc657520c73cbc8fcc5f27ede181d168d9b2bf8a3fedee' },
    post_integration_v2: { path: 'docs/superpowers/evidence/post-integration-v2/post-integration-receipt.json', digest: 'sha256:c6b64e233dfa2df8c4cd8937aa2b8552ac54c68d4593a32a837af20d4923fb64' },
  },
  governance: Object.fromEntries(Object.entries({
    amendment: 'docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md', requirements: 'docs/superpowers/registry/oracle-lab-requirements.json', claims: 'docs/superpowers/registry/oracle-lab-claims.json', roadmap: 'docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md', observations: 'docs/superpowers/registry/oracle-lab-current-observations.json', requirement_schema: 'docs/superpowers/schemas/oracle-lab-requirement.schema.json', requirement_validator: 'tools/oracle-lab/validate-requirements.ts', plan: 'docs/superpowers/plans/2026-07-12-claude-code-2.1.207-p0-1-wp-r0-governance-reconciliation.md', review_import: 'docs/superpowers/evidence/p0-1/p0-1-review-import.json', requirements_review: 'docs/superpowers/evidence/p0-1/requirements-review.json', security_review: 'docs/superpowers/evidence/p0-1/security-quality-review.json',
  }).map(([name, artifactPath]) => [name, artifact(artifactPath)])),
  capture_inputs: Object.fromEntries(Object.entries({
    successor_tool: 'tools/oracle-lab/governance-amendment-evidence.ts', command_catalog: 'docs/superpowers/registry/oracle-lab-governance-amendment-command-catalog.json', exit_schema: schemaRelatives[0], catalog_schema: schemaRelatives[1], results_schema: schemaRelatives[2], context_schema: schemaRelatives[3], handoff_schema: schemaRelatives[4], receipt_schema: schemaRelatives[5], report_schema: schemaRelatives[6], review_import_schema: schemaRelatives[7], review_schema: schemaRelatives[8],
  }).map(([name, artifactPath]) => [name, artifact(artifactPath)])),
  codegraph: {
    cc_gateway: { version: '1.1.6', up_to_date: true, index_digest: sha256('cc-index'), file_count: 1, node_count: 1, edge_count: 1 },
    sub2api: { version: '1.1.6', up_to_date: true, index_digest: sha256('sub-index'), file_count: 1, node_count: 1, edge_count: 1 },
  },
})
assert.equal(evidence.validateExitValue(exitValue).ok, true)
const validateExitSchema = ajv.compile(JSON.parse(readFileSync(path.join(root, schemaRelatives[0]), 'utf8')))
assert.equal(validateExitSchema(exitValue), true, JSON.stringify(validateExitSchema.errors))
const exitWithoutCandidateIdentities = structuredClone(exitValue) as any
delete exitWithoutCandidateIdentities.candidate_commit_identities
assert.equal(evidence.validateExitValue(exitWithoutCandidateIdentities).ok, false)
assert.equal(validateExitSchema(exitWithoutCandidateIdentities), false)
assert.equal(evidence.validateResultSetBindings(merged, catalog, exitValue, sha256('manifest'), sha256('catalog')).ok, true)
const mutatedBindingRecords = structuredClone(merged.records) as any[]
const jointRecord = mutatedBindingRecords.find((record) => record.command_id === 'sub2api-joint-local-chain')
jointRecord.execution_bindings.sub2api_after_snapshot = sha256('mutated-after')
const { result_digest: _jointDigest, ...jointUnsigned } = jointRecord
jointRecord.result_digest = sha256(canonical(jointUnsigned))
const mutatedBindingSet = evidence.buildResultSet({ ...resultBase, group: 'merged', records: mutatedBindingRecords })
assert.equal(evidence.validateResultSetBindings(mutatedBindingSet, catalog, exitValue, sha256('manifest'), sha256('catalog')).ok, false)
function rebuildExit(mutate: (value: any) => void): unknown {
  const candidate = structuredClone(exitValue) as any
  mutate(candidate)
  const { schema_version: _schema, exit_kind: _kind, artifact_chain: _chain, disabled_capabilities: _disabled, exit_digest: _digest, ...options } = candidate
  return evidence.buildExitValue(options)
}
assert.equal(evidence.validateExitValue(rebuildExit((value) => { value.entry = artifact('docs/superpowers/evidence/p0-1/other-entry.json') })).ok, false)
assert.equal(evidence.validateExitValue(rebuildExit((value) => { value.parent_receipts.phase_zero.digest = sha256('wrong-parent') })).ok, false)
assert.equal(evidence.validateExitValue(rebuildExit((value) => { value.approval_attestation_head = '4'.repeat(40) })).ok, false)

function COMMAND_IDS_FOR_TEST(group: 'green' | 'red'): string[] {
  return expectedCatalog.filter((entry) => entry[1] === group).map((entry) => entry[0])
}

console.log('oracle-lab governance amendment evidence tests passed')
