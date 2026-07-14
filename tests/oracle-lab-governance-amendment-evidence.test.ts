import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import { chmodSync, closeSync, cpSync, existsSync, ftruncateSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const toolRelative = 'tools/oracle-lab/governance-amendment-evidence.ts'
const launcherRelative = 'tools/oracle-lab/oracle-p0-1'
const secureRuntimeRelative = 'tools/oracle-lab/secure-runtime.ts'
const boundedStateRelative = 'tools/oracle-lab/bounded-repository-state.ts'
const boundedFileRelative = 'tools/oracle-lab/bounded-file-read.ts'
const ignoredInventoryRelative = 'tools/oracle-lab/ignored-path-inventory.ts'
const catalogRelative = 'docs/superpowers/registry/oracle-lab-governance-amendment-command-catalog.json'
const trustedReviewersRelative = 'docs/superpowers/registry/oracle-lab-p0-1-trusted-reviewers.json'
const reviewedToolchainRelative = 'docs/superpowers/registry/oracle-lab-p0-1-reviewed-toolchain.json'
const taskPlanRelative = 'docs/superpowers/plans/2026-07-12-claude-code-2.1.207-p0-1-wp-r0-governance-reconciliation.md'
const sub2apiSourceRoot = '/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-p0-1'
const productionBranch = 'codex/oracle-p0-1-governance'
const MiB = 1024 * 1024
const PRODUCTION_CLI_TIMEOUT_MS = 90_000
const PRODUCTION_CLI_MAX_BUFFER = 16 * MiB
const CC_SPARSE_PATHS = [
  '.gitignore',
  'package.json',
  launcherRelative,
  secureRuntimeRelative,
  boundedStateRelative,
  boundedFileRelative,
  'sidecar/egress-tls-sidecar/go.mod',
  'tools/oracle-lab/governance-amendment-evidence.ts',
  'tools/oracle-lab/harness-core.ts',
  'tools/oracle-lab/freeze-baseline.ts',
  'tools/oracle-lab/governance-amendment-entry.ts',
  'tools/oracle-lab/ignored-path-inventory.ts',
  'tools/oracle-lab/validate-requirements.ts',
  'docs/superpowers/evidence/p0-1/p0-1-entry-baseline.json',
  'docs/superpowers/evidence/p0-1/p0-1-entry-baseline.receipt.json',
  'docs/superpowers/evidence/phase-0/phase-0-exit-receipt.json',
  'docs/superpowers/evidence/post-integration-v2/post-integration-receipt.json',
  'docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md',
  'docs/superpowers/registry/oracle-lab-requirements.json',
  'docs/superpowers/registry/oracle-lab-claims.json',
  'docs/superpowers/registry/oracle-lab-current-observations.json',
  catalogRelative,
  trustedReviewersRelative,
  reviewedToolchainRelative,
  'docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md',
  taskPlanRelative,
  'docs/superpowers/schemas/oracle-lab-requirement.schema.json',
  'docs/superpowers/schemas/oracle-lab-governance-amendment-exit.schema.json',
  'docs/superpowers/schemas/oracle-lab-governance-amendment-command-catalog.schema.json',
  'docs/superpowers/schemas/oracle-lab-governance-amendment-command-results.schema.json',
  'docs/superpowers/schemas/oracle-lab-governance-amendment-context.schema.json',
  'docs/superpowers/schemas/oracle-lab-governance-amendment-handoff.schema.json',
  'docs/superpowers/schemas/oracle-lab-governance-amendment-receipt.schema.json',
  'docs/superpowers/schemas/oracle-lab-governance-amendment-report.schema.json',
  'docs/superpowers/schemas/oracle-lab-governance-amendment-review-import.schema.json',
  'docs/superpowers/schemas/oracle-lab-governance-amendment-review.schema.json',
  'docs/superpowers/schemas/oracle-lab-p0-1-trusted-reviewers.schema.json',
  'docs/superpowers/schemas/oracle-lab-p0-1-reviewed-toolchain.schema.json',
] as const
const SUB_SPARSE_PATHS = [
  '.gitignore',
  'backend/go.mod',
  'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json',
  'backend/internal/service/sse_scanner_buffer_pool.go',
] as const
const CC_GENERATED_SPARSE_PATTERNS = [
  'docs/superpowers/evidence/p0-1/p0-1-review-import.json',
  'docs/superpowers/evidence/p0-1/requirements-review.json',
  'docs/superpowers/evidence/p0-1/security-quality-review.json',
  'docs/superpowers/evidence/p0-1/p0-1-exit-baseline.json',
  'docs/superpowers/evidence/p0-1/p0-1-green-results.json',
  'docs/superpowers/evidence/p0-1/p0-1-red-results.json',
  'docs/superpowers/evidence/p0-1/p0-1-command-results.json',
  'docs/superpowers/evidence/p0-1/p0-1-exit-report.json',
  'docs/superpowers/evidence/p0-1/p0-1-exit-report.md',
  'docs/superpowers/evidence/p0-1/controller-final-report.json',
  'docs/superpowers/evidence/p0-1/controller-final-report.md',
  'docs/superpowers/evidence/p0-1/p0-1-context.json',
  'docs/superpowers/evidence/p0-1/p0-1-handoff.json',
  'docs/superpowers/evidence/p0-1/p0-1-successor-receipt.json',
] as const
assert.equal(CC_SPARSE_PATHS.length, 38)
assert.equal(SUB_SPARSE_PATHS.length, 4)
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
  'docs/superpowers/schemas/oracle-lab-p0-1-trusted-reviewers.schema.json',
  'docs/superpowers/schemas/oracle-lab-p0-1-reviewed-toolchain.schema.json',
]

for (const relative of [launcherRelative, secureRuntimeRelative, boundedStateRelative, boundedFileRelative, toolRelative, ignoredInventoryRelative, catalogRelative, trustedReviewersRelative, reviewedToolchainRelative, ...schemaRelatives]) {
  assert.equal(existsSync(path.join(root, relative)), true, `${relative} must exist`)
}
const amendmentEntrySource = readFileSync(path.join(root, 'tools/oracle-lab/governance-amendment-entry.ts'), 'utf8')
assert.doesNotMatch(amendmentEntrySource, /(?:execFileSync|spawnSync)\(\s*['"]git['"]/)

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
assert.equal(catalog.find((entry: any) => entry.id === 'p0-1-focused').timeout_ms, 600_000)
assert.deepEqual(catalog.filter((entry: any) => entry.id !== 'p0-1-focused').map((entry: any) => entry.timeout_ms), Array(9).fill(360_000))
for (const entry of catalog) {
  assert.equal(entry.schema_version, 1)
  assert.deepEqual(Object.fromEntries(Object.entries(entry.env).filter(([key]) => key in HERMETIC_NETWORK_ENV)), HERMETIC_NETWORK_ENV)
  assert.equal(entry.env.CI, '1')
  assert.deepEqual(entry.inherit_env, [])
  assert.equal(entry.shell, false)
  assert.equal(entry.max_output_bytes, 8 * 1024 * 1024)
  assert.equal(entry.expected_exit, entry.group === 'green' ? 0 : 'nonzero')
  assert.equal(entry.ignored_output_policy, entry.id === 'sub2api-joint-local-chain' ? 'sub2api_joint_safe_deliverable_v1' : 'none')
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
const missingIgnoredPolicy = structuredClone(catalog)
delete missingIgnoredPolicy[0].ignored_output_policy
assert.equal(validateCatalog(missingIgnoredPolicy), false)
const unknownIgnoredPolicy = structuredClone(catalog)
unknownIgnoredPolicy[0].ignored_output_policy = 'free_form_paths'
assert.equal(validateCatalog(unknownIgnoredPolicy), false)
const misplacedIgnoredPolicy = structuredClone(catalog)
misplacedIgnoredPolicy[0].ignored_output_policy = 'sub2api_joint_safe_deliverable_v1'
assert.equal(validateCatalog(misplacedIgnoredPolicy), false)
const freeFormIgnoredAllowance = structuredClone(catalog)
freeFormIgnoredAllowance[5].ignored_output_paths = ['runtime/arbitrary']
assert.equal(validateCatalog(freeFormIgnoredAllowance), false)

const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
assert.equal(packageJson.scripts['oracle:p0-1'], launcherRelative)
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
  'oracle-lab-ignored-path-inventory.test.ts',
  'oracle-lab-governance-amendment-evidence.test.ts',
])

const evidence = await import(pathToFileURL(path.join(root, toolRelative)).href)
const ignoredInventory = await import(pathToFileURL(path.join(root, ignoredInventoryRelative)).href)
const secureRuntime = await import(pathToFileURL(path.join(root, secureRuntimeRelative)).href)
const boundedState = await import(pathToFileURL(path.join(root, boundedStateRelative)).href)
assert.equal(existsSync(path.join(root, boundedFileRelative)), true, `${boundedFileRelative} must exist`)
const boundedFile = await import(pathToFileURL(path.join(root, boundedFileRelative)).href)
assert.equal(Object.isFrozen(boundedFile.BOUNDED_FILE_LIMITS), true)

const boundedFileFixture = mkdtempSync(path.join(tmpdir(), 'oracle-p0-1-bounded-file-'))
const exactBoundedFile = path.join(boundedFileFixture, 'exact.bin')
writeFileSync(exactBoundedFile, Buffer.from('0123456789abcdef'))
const exactBudget = boundedFile.createBoundedReadBudget(16)
const exactRead = boundedFile.readBoundedRegularFile(exactBoundedFile, { maxBytes: 16, budget: exactBudget })
assert.equal(exactRead.bytes.toString('ascii'), '0123456789abcdef')
assert.equal(exactRead.digest, sha256('0123456789abcdef'))
assert.equal(exactBudget.bytes, 16)
const oversizedBoundedFile = path.join(boundedFileFixture, 'oversized.bin')
sparseFile(oversizedBoundedFile, 17)
expectCode(() => boundedFile.readBoundedRegularFile(oversizedBoundedFile, {
  maxBytes: 16,
  budget: boundedFile.createBoundedReadBudget(32),
}), 'bounded_file_size_limit_exceeded')
const boundedSymlinkTarget = path.join(boundedFileFixture, 'target.bin')
writeFileSync(boundedSymlinkTarget, 'target')
const boundedSymlink = path.join(boundedFileFixture, 'symlink.bin')
symlinkSync('target.bin', boundedSymlink)
expectCode(() => boundedFile.readBoundedRegularFile(boundedSymlink, {
  maxBytes: 16,
  budget: boundedFile.createBoundedReadBudget(32),
}), 'bounded_file_type_invalid')
const boundedSpecial = path.join(boundedFileFixture, 'special')
mkdirSync(boundedSpecial)
expectCode(() => boundedFile.hashBoundedRegularFile(boundedSpecial, {
  maxBytes: 16,
  budget: boundedFile.createBoundedReadBudget(32),
}), 'bounded_file_type_invalid')
const aggregateFirst = path.join(boundedFileFixture, 'aggregate-first.bin')
const aggregateSecond = path.join(boundedFileFixture, 'aggregate-second.bin')
writeFileSync(aggregateFirst, '123456')
writeFileSync(aggregateSecond, 'abcdef')
const aggregateBudget = boundedFile.createBoundedReadBudget(10)
boundedFile.hashBoundedRegularFile(aggregateFirst, { maxBytes: 16, budget: aggregateBudget })
expectCode(() => boundedFile.hashBoundedRegularFile(aggregateSecond, { maxBytes: 16, budget: aggregateBudget }), 'bounded_file_aggregate_limit_exceeded')
const driftingBoundedFile = path.join(boundedFileFixture, 'drifting.bin')
sparseFile(driftingBoundedFile, boundedFile.MAX_CODEGRAPH_DATABASE_BYTES)
spawn('/usr/bin/env', ['sh', '-c', 'sleep 0.01; truncate -s 1 "$1"', 'sh', driftingBoundedFile], { stdio: 'ignore' })
expectCode(() => boundedFile.hashBoundedRegularFile(driftingBoundedFile, {
  maxBytes: boundedFile.MAX_CODEGRAPH_DATABASE_BYTES,
  budget: boundedFile.createBoundedReadBudget(boundedFile.MAX_CODEGRAPH_AGGREGATE_BYTES),
}), 'bounded_file_race_detected')
assert.equal(lstatSync(driftingBoundedFile).size, 1)

const productionNamespace = evidence as Record<string, unknown>
for (const runtimeSelector of ['runCliEntry', 'dispatch', 'PRODUCTION_CLI_RUNTIME']) {
  assert.equal(Object.hasOwn(productionNamespace, runtimeSelector), false, `${runtimeSelector} must not be exported`)
}
const namedRuntimeImportProbeRoot = mkdtempSync(path.join(tmpdir(), 'oracle-p0-1-runtime-import-probe-'))
const namedRuntimeImportProbePath = path.join(namedRuntimeImportProbeRoot, 'probe.mjs')
writeFileSync(namedRuntimeImportProbePath, `import { runCliEntry } from ${JSON.stringify(pathToFileURL(path.join(root, toolRelative)).href)}; void runCliEntry\n`)
const namedRuntimeImportProbe = spawnSync(process.execPath, ['--import', 'tsx', namedRuntimeImportProbePath], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, ...HERMETIC_NETWORK_ENV },
})
assert.notEqual(namedRuntimeImportProbe.status, 0, 'named runCliEntry import must fail to link')
assert.match(namedRuntimeImportProbe.stderr, /does not provide an export named ['"]runCliEntry['"]|has no exported member named ['"]runCliEntry['"]|No matching export.*runCliEntry/i)

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

const testReviewerKeys = {
  requirements: generateKeyPairSync('ed25519'),
  security_quality: generateKeyPairSync('ed25519'),
}

function reviewerAuthority(role: 'requirements' | 'security_quality') {
  const publicDer = testReviewerKeys[role].publicKey.export({ format: 'der', type: 'spki' }) as Buffer
  return {
    key_id: sha256(publicDer),
    public_key_der_base64: publicDer.toString('base64'),
    reviewer_identity: `test-${role.replace('_quality', '')}-reviewer`,
    reviewer_role: role,
  }
}

const testReviewerRegistry = {
  schema_version: 1,
  trust_model: 'ed25519_ephemeral_independent_reviewers_v1',
  reviewers: [reviewerAuthority('requirements'), reviewerAuthority('security_quality')],
}

function signedReview(value: Record<string, unknown>, role: 'requirements' | 'security_quality'): any {
  const authority = testReviewerRegistry.reviewers.find((entry) => entry.reviewer_role === role)!
  const unsigned = {
    ...structuredClone(value),
    reviewer_identity: authority.reviewer_identity,
    reviewer_role: role,
    signing_key_id: authority.key_id,
    signature_algorithm: 'ed25519_canonical_json_v1',
  }
  return { ...unsigned, signature: cryptoSign(null, Buffer.from(`${canonical(unsigned)}\n`), testReviewerKeys[role].privateKey).toString('base64') }
}

function installTestReviewerRegistry(repository: string): void {
  writeFileSync(path.join(repository, trustedReviewersRelative), `${canonical(testReviewerRegistry)}\n`)
}

function testToolchainRegistry(shimBin: string) {
  const tools = (['npm', 'go'] as const).map((name) => {
    const executable = realpathSync(path.join(shimBin, name))
    return {
      executable_sha256: sha256(readFileSync(executable)),
      name,
      realpath_sha256: sha256(executable),
      version_sha256: sha256('test-shim-v1'),
    }
  })
  return {
    environment: { goenv: 'off', home: '/dev/null', npm_global_config: '/etc/oracle-p0-1-empty-npmrc', npm_user_config: '/dev/null' },
    fixture_root_sha256: sha256(realpathSync(path.dirname(shimBin))),
    schema_version: 1,
    tools,
    trust_mode: 'test_fixture_root_v1',
  }
}

function resolveRealExecutable(name: string): string {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue
    const candidate = path.join(directory, name)
    if (existsSync(candidate)) return realpathSync(candidate)
  }
  throw new Error(`required executable ${name} is unavailable`)
}

const realCodeGraphExecutable = resolveRealExecutable('codegraph')
assert.equal(path.isAbsolute(realCodeGraphExecutable), true)

function cloneSharedSparseRepository(
  sourceRepository: string,
  destination: string,
  sparsePaths: readonly string[],
  branch = productionBranch,
  startingRef = branch,
): string {
  mkdirSync(path.dirname(destination), { recursive: true })
  execFileSync('git', [
    'clone', '-q', '--shared', '--no-checkout', '--single-branch', '--branch', branch,
    sourceRepository, destination,
  ], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: PRODUCTION_CLI_MAX_BUFFER })
  execFileSync('git', ['-C', destination, 'sparse-checkout', 'init', '--no-cone'], {
    stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: PRODUCTION_CLI_MAX_BUFFER,
  })
  execFileSync('git', ['-C', destination, 'sparse-checkout', 'set', '--no-cone', '--stdin'], {
    input: `${[...sparsePaths].join('\n')}\n`, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: PRODUCTION_CLI_MAX_BUFFER,
  })
  const checkoutArgs = startingRef === branch
    ? ['-C', destination, 'checkout', '-q', branch]
    : ['-C', destination, 'checkout', '-q', '-B', branch, startingRef]
  execFileSync('git', checkoutArgs, {
    stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: PRODUCTION_CLI_MAX_BUFFER,
  })
  const repository = realpathSync(destination)
  const alternates = path.join(repository, '.git/objects/info/alternates')
  assert.equal(lstatSync(alternates).isFile(), true, 'shared clone must use a regular alternates file')
  assert.equal(readFileSync(alternates, 'utf8').trim().length > 0, true)
  return repository
}

function linkCloneDependencies(repository: string, dependencyRoot: string): void {
  const exclude = path.join(repository, '.git/info/exclude')
  const existing = readFileSync(exclude, 'utf8')
  writeFileSync(exclude, `${existing}${existing.endsWith('\n') ? '' : '\n'}node_modules\n`)
  symlinkSync(dependencyRoot, path.join(repository, 'node_modules'), 'dir')
  assert.equal(git(repository, 'check-ignore', '-q', 'node_modules'), '')
}

function directoryBytes(directory: string): number {
  const stat = lstatSync(directory)
  if (stat.isSymbolicLink() || !stat.isDirectory()) return stat.size
  return stat.size + readdirSync(directory).reduce((total, name) => total + directoryBytes(path.join(directory, name)), 0)
}

type ProductionCliResult = ReturnType<typeof spawnSync>

function productionParentEnvironment(shimBin: string, fixtureTmp: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...HERMETIC_NETWORK_ENV,
    CI: '1',
    HOME: process.env.HOME ?? fixtureTmp,
    TMPDIR: fixtureTmp,
    PATH: `${shimBin}${path.delimiter}/Users/muqihang/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.26.5.darwin-arm64/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
    ...extra,
  }
}

function runProductionLauncherCli(repository: string, args: string[], shimBin: string, fixtureTmp: string, extraEnv: Record<string, string> = {}): ProductionCliResult {
  return spawnSync(path.join(repository, launcherRelative), args, {
    cwd: repository,
    encoding: 'utf8',
    timeout: PRODUCTION_CLI_TIMEOUT_MS,
    maxBuffer: PRODUCTION_CLI_MAX_BUFFER,
    env: productionParentEnvironment(shimBin, fixtureTmp, extraEnv),
  })
}

function successRecords(result: ProductionCliResult, command: string): string[] {
  const expected = canonical({ command, ok: true })
  return String(result.stdout).split(/\r?\n/).filter((line) => line === expected)
}

function expectProductionCliOk(result: ProductionCliResult, command: string): void {
  assert.equal(result.error, undefined, `${command} process error: ${result.error?.message}`)
  assert.equal(result.signal, null, `${command} terminated by ${result.signal}`)
  assert.equal(result.status, 0, `${command} failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
  assert.deepEqual(successRecords(result, command), [canonical({ command, ok: true })], `${command} must emit exactly one success record`)
}

function productionCliErrorCode(result: ProductionCliResult): string | undefined {
  for (const line of String(result.stderr).split(/\r?\n/).reverse()) {
    try {
      const value = JSON.parse(line) as { code?: unknown }
      if (typeof value.code === 'string') return value.code
    } catch {}
  }
  return undefined
}

function expectProductionCliCode(result: ProductionCliResult, code: string): void {
  assert.equal(result.error, undefined, `CLI process error: ${result.error?.message}`)
  assert.notEqual(result.status, 0, `CLI unexpectedly succeeded: ${result.stdout}`)
  assert.equal(productionCliErrorCode(result), code, String(result.stderr))
}

type ShimMutation = Readonly<{
  kind: 'create' | 'modify' | 'rename' | 'symlink'
  repositoryRoot: string
  relativePath: string
  renameTarget?: string
}>

function expandedCatalogValue(value: string, ccRoot: string, subRoot: string): string {
  return value.replaceAll('${CC_GATEWAY_ROOT}', ccRoot).replaceAll('${SUB2API_ROOT}', subRoot)
}

function writeCatalogShims(options: {
  directory: string
  auditLog: string
  ccRoot: string
  subRoot: string
  unsafeCommandId?: string
  unsafeMarker?: string
  earlyFailureCommandId?: string
  mutation?: ShimMutation
  jointModeNode?: 'date-directory' | 'safe-directory' | 'readme' | 'summary'
}): void {
  mkdirSync(options.directory, { recursive: true })
  const accepted = catalog.map((entry: any) => ({
    id: entry.id,
    executable: entry.argv[0],
    argv: entry.argv.slice(1).map((value: string) => expandedCatalogValue(value, options.ccRoot, options.subRoot)),
    cwd: expandedCatalogValue(entry.cwd, options.ccRoot, options.subRoot),
    group: entry.group,
  }))
  const statePath = path.join(path.dirname(options.auditLog), `${path.basename(options.directory)}-mutation-state`)
  const shimConfig = {
    accepted,
    auditLog: options.auditLog,
    mutationState: statePath,
    mutation: options.mutation ?? null,
    unsafeCommandId: options.unsafeCommandId ?? null,
    unsafeMarker: options.unsafeMarker ?? '',
    earlyFailureCommandId: options.earlyFailureCommandId ?? null,
    jointModeNode: options.jointModeNode ?? null,
    subRoot: options.subRoot,
  }
  writeFileSync(path.join(options.directory, 'config.json'), JSON.stringify(shimConfig))
  const script = `#!${process.execPath}
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
const { accepted, auditLog, mutationState, mutation, unsafeCommandId, unsafeMarker, earlyFailureCommandId, jointModeNode, subRoot } = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'))
const executable = path.basename(process.argv[1])
const argv = process.argv.slice(2)
const cwd = process.cwd()
if (argv.length === 1 && (argv[0] === '--version' || argv[0] === 'version')) { process.stdout.write('test-shim-v1\\n'); process.exit(0) }
const match = accepted.find((candidate) => candidate.executable === executable && candidate.cwd === cwd && JSON.stringify(candidate.argv) === JSON.stringify(argv))
const selectedKeys = ['CI','npm_config_offline','npm_config_audit','npm_config_fund','npm_config_userconfig','npm_config_globalconfig','npm_config_cache','GOPROXY','GOSUMDB','GOTOOLCHAIN','GOENV','GOCACHE','GOMODCACHE','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','PATH','HOME','TMPDIR','SUB2API_ROOT','CC_GATEWAY_REPO_ROOT']
appendFileSync(auditLog, JSON.stringify({ executable, argv, cwd, env_keys: Object.keys(process.env).sort(), selected_env: Object.fromEntries(selectedKeys.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]])), platform_env: { __CF_USER_TEXT_ENCODING: process.env.__CF_USER_TEXT_ENCODING }, command_id: match?.id ?? null }) + '\\n')
if (!match) process.exit(97)
if (match.id === earlyFailureCommandId) process.exit(1)
if (mutation && !existsSync(mutationState)) {
  const target = path.join(mutation.repositoryRoot, mutation.relativePath)
  mkdirSync(path.dirname(target), { recursive: true })
  if (mutation.kind === 'create') writeFileSync(target, 'created ignored bytes\\n')
  if (mutation.kind === 'modify') writeFileSync(target, 'modified ignored bytes\\n')
  if (mutation.kind === 'rename') renameSync(target, mutation.renameTarget)
  if (mutation.kind === 'symlink') symlinkSync(path.join(mutation.repositoryRoot, '.gitignore'), target)
  writeFileSync(mutationState, 'done\\n')
}
if (match.id === 'sub2api-joint-local-chain') {
  const now = new Date()
  const localDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') + '-sub2api-cc-gateway-joint-local-capture'
  const output = path.join(subRoot, 'docs/anti-ban/captures/real-baseline', localDate, 'safe-deliverable')
  mkdirSync(output, { recursive: true })
  writeFileSync(path.join(output, 'README.md'), 'safe local acceptance readme\\n')
  writeFileSync(path.join(output, 'joint_local_capture_summary.redacted.json'), '{"safe":true}\\n')
  if (jointModeNode) {
    const targets = {
      'date-directory': path.dirname(output),
      'safe-directory': output,
      readme: path.join(output, 'README.md'),
      summary: path.join(output, 'joint_local_capture_summary.redacted.json'),
    }
    chmodSync(targets[jointModeNode], jointModeNode.endsWith('directory') ? 0o700 : 0o755)
  }
}
if (match.id === unsafeCommandId) {
  process.stderr.write('\\u2716 ' + unsafeMarker + '\\n')
  process.exit(1)
}
if (match.group === 'red') {
  const output = match.id === 'sub2api-boundary-red'
    ? '--- FAIL: TestFormalPoolOnboardingBoundary\\n--- FAIL: TestBrowserBoundary\\n--- FAIL: TestEgressBoundary\\n'
    : match.id === 'sidecar-boundary-red'
      ? '--- FAIL: TestPhase0B5Boundary\\n--- FAIL: TestPhase0B6Boundary\\n'
    : '--- FAIL: TestPhase0B4Boundary\\n--- FAIL: TestPhase0B5Boundary\\n--- FAIL: TestPhase0B6Boundary\\n'
  process.stdout.write(output)
  process.exit(1)
}
process.exit(0)
`
  for (const executable of ['npm', 'go']) {
    const shim = path.join(options.directory, executable)
    writeFileSync(shim, script)
    chmodSync(shim, 0o755)
  }
  for (const forbidden of ['codegraph', 'git', 'node', 'tsx']) assert.equal(existsSync(path.join(options.directory, forbidden)), false)
}

function initializeRealCodeGraph(repository: string, fixtureTmp: string): Record<string, unknown> {
  const environment = productionParentEnvironment('/usr/bin:/bin', fixtureTmp)
  execFileSync(realCodeGraphExecutable, ['init', repository], {
    cwd: repository, env: environment, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: PRODUCTION_CLI_MAX_BUFFER,
  })
  const status = JSON.parse(execFileSync(realCodeGraphExecutable, ['status', '--json', repository], {
    cwd: repository, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: PRODUCTION_CLI_MAX_BUFFER,
  })) as Record<string, any>
  assert.equal(status.initialized, true)
  assert.equal(status.projectPath, repository)
  for (const field of ['fileCount', 'nodeCount', 'edgeCount']) assert.equal(Number.isInteger(status[field]) && status[field] > 0, true, `${field} must be positive`)
  assert.deepEqual(status.pendingChanges, { added: 0, modified: 0, removed: 0 })
  assert.equal(status.worktreeMismatch, null)
  assert.equal(status.index.reindexRecommended, false)
  const database = path.join(repository, '.codegraph/codegraph.db')
  const databaseStat = lstatSync(database)
  assert.equal(databaseStat.isFile(), true)
  assert.equal(databaseStat.isSymbolicLink(), false)
  status.database_digest = sha256(readFileSync(database))
  return status
}

function assertCanonicalBytesEqual(left: unknown, right: unknown, label: string): void {
  assert.equal(`${canonical(left)}\n`, `${canonical(right)}\n`, `${label} canonical JSON bytes drifted`)
}

function cliFixture(label: string): string {
  const parent = mkdtempSync(path.join(tmpdir(), `oracle-p0-1-cli-${label}-`))
  const repository = path.join(parent, 'repository')
  const sparseRepository = cloneSharedSparseRepository(root, repository, [...CC_SPARSE_PATHS, ...CC_GENERATED_SPARSE_PATTERNS])
  writeFileSync(path.join(repository, toolRelative), readFileSync(path.join(root, toolRelative)))
  writeFileSync(path.join(repository, launcherRelative), readFileSync(path.join(root, launcherRelative)))
  writeFileSync(path.join(repository, secureRuntimeRelative), readFileSync(path.join(root, secureRuntimeRelative)))
  writeFileSync(path.join(repository, boundedStateRelative), readFileSync(path.join(root, boundedStateRelative)))
  writeFileSync(path.join(repository, boundedFileRelative), readFileSync(path.join(root, boundedFileRelative)))
  writeFileSync(path.join(repository, 'tools/oracle-lab/governance-amendment-entry.ts'), readFileSync(path.join(root, 'tools/oracle-lab/governance-amendment-entry.ts')))
  chmodSync(path.join(repository, launcherRelative), 0o755)
  writeFileSync(path.join(repository, ignoredInventoryRelative), readFileSync(path.join(root, ignoredInventoryRelative)))
  writeFileSync(path.join(repository, catalogRelative), readFileSync(path.join(root, catalogRelative)))
  writeFileSync(path.join(repository, reviewedToolchainRelative), readFileSync(path.join(root, reviewedToolchainRelative)))
  for (const relative of schemaRelatives) writeFileSync(path.join(repository, relative), readFileSync(path.join(root, relative)))
  linkCloneDependencies(repository, path.join(root, 'node_modules'))
  installTestReviewerRegistry(repository)
  git(repository, 'add', toolRelative, launcherRelative, secureRuntimeRelative, boundedStateRelative, boundedFileRelative, ignoredInventoryRelative, 'tools/oracle-lab/governance-amendment-entry.ts', catalogRelative, trustedReviewersRelative, reviewedToolchainRelative, ...schemaRelatives)
  git(repository, 'commit', '-qm', 'fixture reviewed runtime inputs')
  return sparseRepository
}

function runCli(repository: string, args: string[], env: Record<string, string> = {}): ReturnType<typeof spawnSync> {
  for (const relative of [launcherRelative, secureRuntimeRelative, boundedStateRelative, boundedFileRelative, 'tools/oracle-lab/governance-amendment-entry.ts']) {
    writeFileSync(path.join(repository, relative), readFileSync(path.join(root, relative)))
  }
  chmodSync(path.join(repository, launcherRelative), 0o755)
  return spawnSync(path.join(repository, launcherRelative), args, {
    cwd: repository,
    encoding: 'utf8',
    env: productionParentEnvironment('/usr/bin:/bin', tmpdir(), env),
  })
}

function expectCliOk(result: ReturnType<typeof spawnSync>, command: string): void {
  assert.equal(result.status, 0, `${command} failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
  assert.deepEqual(JSON.parse(String(result.stdout).trim()), { command, ok: true })
}

function expectCliCode(result: ReturnType<typeof spawnSync>, code: string): void {
  assert.notEqual(result.status, 0, `CLI unexpectedly succeeded: ${result.stdout}`)
  const lines = String(result.stderr).trim().split('\n')
  const error = JSON.parse(lines.at(-1) ?? '{}') as { code?: string }
  assert.equal(error.code, code, String(result.stderr))
}

assert.equal(evidence.MAX_OUTPUT_BYTES, 8 * 1024 * 1024)
assert.equal(path.isAbsolute(secureRuntime.REVIEWED_GIT_EXECUTABLE), true)
assert.equal(Object.isFrozen(secureRuntime.REVIEWED_GIT_ENVIRONMENT), true)
assert.deepEqual(Object.keys(secureRuntime.REVIEWED_GIT_ENVIRONMENT).sort(), [
  'GIT_CONFIG_COUNT', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_SYSTEM',
  'GIT_NO_REPLACE_OBJECTS', 'GIT_OPTIONAL_LOCKS', 'GIT_PAGER', 'GIT_TERMINAL_PROMPT',
  'HOME', 'LANG', 'LC_ALL', 'PAGER', 'PATH',
].sort())
expectCode(() => secureRuntime.runReviewedGit(root, ['rev-parse', 'HEAD'], { maxOutputBytes: 1 }), 'git_output_limit_exceeded')
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
assert.equal(evidence.validateCommandCatalogValue(missingIgnoredPolicy).ok, false)
assert.equal(evidence.validateCommandCatalogValue(unknownIgnoredPolicy).ok, false)
assert.equal(evidence.validateCommandCatalogValue(misplacedIgnoredPolicy).ok, false)
assert.equal(evidence.validateCommandCatalogValue(freeFormIgnoredAllowance).ok, false)

const source = '/Users/muqihang/chelingxi_workspace/cc-gateway-claude-code-2.1.207-oracle-lab/docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md'
const adopted = path.join(root, 'docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md')
const reviewImport = evidence.buildReviewImport({ reviewSource: source, adoptedAmendment: adopted, generatedAt: '2026-07-13T00:00:00.000Z' })
const reviewImportRepeat = evidence.buildReviewImport({ reviewSource: source, adoptedAmendment: adopted, generatedAt: '2026-07-13T00:00:00.000Z' })
assertCanonicalBytesEqual(reviewImport, reviewImportRepeat, 'review-import')
assert.equal(reviewImport.source.digest, evidence.TASK_0B_REVIEW_SOURCE_DIGEST)
assert.deepEqual(reviewImport.adopted, evidence.ADOPTED_AMENDMENT_BINDING)
assert.deepEqual(reviewImport.transformation, {
  algorithm: 'sha256_exact_bytes_v1',
  source_bytes: 41_663,
  adopted_bytes: 47_748,
  pair_digest: 'sha256:c50bd89681f898b0ec9e712f718ff523c6dc8eade99583f56f12bd208d86b7c2',
})
assert.equal(evidence.validateReviewImportBytes(reviewImport, source, adopted).ok, true)
const validateReviewImportSchema = ajv.compile(JSON.parse(readFileSync(path.join(root, schemaRelatives[7]), 'utf8')))
for (const [field, value] of [
  ['source_bytes', reviewImport.transformation.source_bytes + 1],
  ['adopted_bytes', reviewImport.transformation.adopted_bytes + 1],
  ['pair_digest', sha256('forged-review-import-pair')],
] as const) {
  const forged = structuredClone(reviewImport) as any
  forged.transformation[field] = value
  assert.equal(evidence.validateReviewImportValue(forged).ok, false, `${field} must be frozen by runtime validation`)
  assert.equal(validateReviewImportSchema(forged), false, `${field} must be frozen by the strict schema`)
}
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
const reportRepeat = evidence.buildReportValue({
  reportType: 'exit',
  generatedAt: '2026-07-13T00:00:00.000Z',
  manifest: report.manifest,
  results: report.results,
  reviews: report.reviews,
  status: report.status,
  commandSummary: report.command_summary,
})
assertCanonicalBytesEqual(report, reportRepeat, 'exit report')
const markdown = evidence.renderReportMarkdown(report)
assert.equal(markdown, evidence.renderReportMarkdown(reportRepeat), 'exit report Markdown bytes drifted')
const controllerReportProof = evidence.buildReportValue({
  reportType: 'controller',
  generatedAt: '2026-07-13T00:00:00.000Z',
  manifest: report.manifest,
  results: report.results,
  reviews: report.reviews,
  status: report.status,
  commandSummary: report.command_summary,
})
const controllerReportProofRepeat = evidence.buildReportValue({
  reportType: 'controller',
  generatedAt: '2026-07-13T00:00:00.000Z',
  manifest: report.manifest,
  results: report.results,
  reviews: report.reviews,
  status: report.status,
  commandSummary: report.command_summary,
})
assertCanonicalBytesEqual(controllerReportProof, controllerReportProofRepeat, 'controller report')
assert.equal(evidence.renderReportMarkdown(controllerReportProof), evidence.renderReportMarkdown(controllerReportProofRepeat), 'controller report Markdown bytes drifted')
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
const handoffRepeat = evidence.buildHandoffValue({
  generatedAt: '2026-07-13T00:00:00.000Z',
  bindings: structuredClone(handoff.bindings),
  disabledCapabilities: [...disabled],
})
assertCanonicalBytesEqual(handoff, handoffRepeat, 'handoff')
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
for (const [stream, extractor, marker] of [
  ['stdout', 'go-fail', 'ORACLE_SECRET_CANARY_GO_STDOUT'],
  ['stderr', 'go-fail', 'ORACLE_SECRET_CANARY_GO_STDERR'],
  ['stdout', 'assertion', 'Bearer unsafe-assertion-stdout'],
  ['stderr', 'assertion', 'Bearer unsafe-assertion-stderr'],
  ['stdout', 'node-assertion', 'Bearer unsafe-node-assertion-stdout'],
  ['stderr', 'node-assertion', 'Bearer unsafe-node-assertion-stderr'],
  ['stdout', 'red-file', 'ORACLE_SECRET_CANARY_STDOUT.red.test.ts'],
  ['stderr', 'red-file', 'ORACLE_SECRET_CANARY_STDERR.red.test.ts'],
] as const) {
  const output = extractor === 'go-fail'
    ? `--- FAIL: ${marker}\n`
    : extractor === 'assertion'
      ? `\u2716 ${marker}\n`
      : extractor === 'node-assertion'
        ? `AssertionError: ${marker}\n`
        : `${marker}\n`
  const script = stream === 'stdout'
    ? `process.stdout.write(${JSON.stringify(output)});process.exit(1)`
    : `process.stderr.write(${JSON.stringify(output)});process.exit(1)`
  const observed = evidence.runBoundedProcess({
    argv: [process.execPath, '-e', script],
    cwd: root,
    env: { PATH: process.env.PATH ?? '' },
    timeoutMs: 5_000,
    maxOutputBytes: 8_192,
  })
  assert.equal(observed.unsafeOutputDetected, true, `${stream}/${extractor} must be classified unsafe`)
  assert.deepEqual(observed.failureNames, [], `${stream}/${extractor} must not cross the helper boundary`)
  assert.equal(JSON.stringify(observed).includes(marker), false, `${stream}/${extractor} leaked marker bytes`)
}
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

function gitBinaryDiffDigest(repository: string, base: string, head: string): string {
  return sha256(execFileSync('git', ['-C', repository, 'diff', '--binary', `${base}...${head}`, '--'], {
    maxBuffer: PRODUCTION_CLI_MAX_BUFFER,
  }))
}

const priorRelative = 'docs/superpowers/evidence/p0-1/p0-1-exit-baseline.json'
function snapshotFixture(label: string): { repository: string; priorAbsolute: string; priorBinding: { path: string; digest: string } } {
  const repository = mkdtempSync(path.join(tmpdir(), `oracle-p0-1-${label}-`))
  git(repository, 'init', '-q')
  git(repository, 'config', 'user.email', 'oracle@example.invalid')
  git(repository, 'config', 'user.name', 'Oracle Test')
  git(repository, 'branch', '-m', 'codex/oracle-p0-1-governance')
  writeFileSync(path.join(repository, '.gitignore'), 'ignored/\n')
  writeFileSync(path.join(repository, 'tracked.txt'), 'tracked\n')
  git(repository, 'add', '.gitignore', 'tracked.txt')
  git(repository, 'commit', '-qm', 'base')
  mkdirSync(path.join(repository, 'docs/superpowers/evidence/p0-1'), { recursive: true })
  const priorAbsolute = path.join(repository, priorRelative)
  writeFileSync(priorAbsolute, '{"prior":true}\n')
  return { repository, priorAbsolute, priorBinding: { path: priorRelative, digest: sha256(readFileSync(priorAbsolute)) } }
}

function sparseFile(file: string, bytes: number): void {
  writeFileSync(file, '')
  const descriptor = openSync(file, 'r+')
  try { ftruncateSync(descriptor, bytes) } finally { closeSync(descriptor) }
}

function extendSparseFile(file: string, bytes: number): void {
  const descriptor = openSync(file, 'r+')
  try { ftruncateSync(descriptor, bytes) } finally { closeSync(descriptor) }
}

assert.equal(Object.isFrozen(boundedState.VISIBLE_STATE_LIMITS), true)
for (const value of Object.values(boundedState.VISIBLE_STATE_LIMITS) as number[]) assert.equal(Number.isSafeInteger(value) && value > 0, true)
const perFileBoundCase = snapshotFixture('visible-per-file-bound')
sparseFile(path.join(perFileBoundCase.repository, 'huge-untracked.bin'), 2048)
expectCode(() => boundedState.captureBoundedRepositoryState(perFileBoundCase.repository, { ...boundedState.VISIBLE_STATE_LIMITS, maxFileBytes: 1024 }), 'visible_state_file_limit_exceeded')
const aggregateBoundCase = snapshotFixture('visible-aggregate-bound')
sparseFile(path.join(aggregateBoundCase.repository, 'aggregate-a.bin'), 800)
sparseFile(path.join(aggregateBoundCase.repository, 'aggregate-b.bin'), 800)
expectCode(() => boundedState.captureBoundedRepositoryState(aggregateBoundCase.repository, { ...boundedState.VISIBLE_STATE_LIMITS, maxFileBytes: 1024, maxAggregateBytes: 1200 }), 'visible_state_aggregate_limit_exceeded')
const entryBoundCase = snapshotFixture('visible-entry-bound')
writeFileSync(path.join(entryBoundCase.repository, 'entry-a.txt'), 'a\n')
writeFileSync(path.join(entryBoundCase.repository, 'entry-b.txt'), 'b\n')
expectCode(() => boundedState.captureBoundedRepositoryState(entryBoundCase.repository, { ...boundedState.VISIBLE_STATE_LIMITS, maxEntries: 1 }), 'visible_state_entry_limit_exceeded')
const trackedBoundCase = snapshotFixture('visible-tracked-bound')
sparseFile(path.join(trackedBoundCase.repository, 'tracked.txt'), 2048)
expectCode(() => boundedState.captureBoundedRepositoryState(trackedBoundCase.repository, { ...boundedState.VISIBLE_STATE_LIMITS, maxFileBytes: 1024 }), 'visible_state_file_limit_exceeded')
const symlinkVisibleCase = snapshotFixture('visible-symlink')
symlinkSync('tracked.txt', path.join(symlinkVisibleCase.repository, 'visible-link'))
expectCode(() => boundedState.captureBoundedRepositoryState(symlinkVisibleCase.repository), 'visible_state_unsupported_entry')
const visibleCoverageCase = snapshotFixture('visible-coverage')
writeFileSync(path.join(visibleCoverageCase.repository, 'tracked.txt'), 'staged bytes\n')
git(visibleCoverageCase.repository, 'add', 'tracked.txt')
writeFileSync(path.join(visibleCoverageCase.repository, 'tracked.txt'), 'staged and unstaged bytes\n')
writeFileSync(path.join(visibleCoverageCase.repository, 'untracked.txt'), 'untracked bytes\n')
const visibleCoverage = boundedState.captureBoundedRepositoryState(visibleCoverageCase.repository)
assert.equal(visibleCoverage.dirty_records.some((record: any) => record.status === 'MM'), true)
assert.equal(visibleCoverage.dirty_records.some((record: any) => record.status === '??'), true)

const snapshotCase = snapshotFixture('snapshot')
const snapshotRoot = snapshotCase.repository
const priorAbsolute = path.join(snapshotRoot, priorRelative)
const priorBinding = snapshotCase.priorBinding
const snapshot = evidence.captureRepositorySnapshot(snapshotRoot, [priorBinding])
assert.equal(snapshot.head, git(snapshotRoot, 'rev-parse', 'HEAD'))
assert.deepEqual(snapshot.allowed_artifacts, [priorBinding])
assert.match(snapshot.ignored_exclusion_rules_digest, /^sha256:[0-9a-f]{64}$/)
assert.equal(snapshot.ignored_inventory.algorithm, 'git_exclude_standard_recursive_v1')
assert.match(snapshot.ignored_inventory.digest, /^sha256:[0-9a-f]{64}$/)
assert.equal(snapshot.ignored_output_policy_digest, ignoredInventory.IGNORED_OUTPUT_POLICY_DIGESTS.none)
evidence.assertRepositorySnapshot(snapshotRoot, snapshot, [priorBinding])
const reboundJointSnapshot = evidence.rebindRepositorySnapshotPolicy(snapshot, 'sub2api_joint_safe_deliverable_v1')
assert.notEqual(reboundJointSnapshot.snapshot_digest, snapshot.snapshot_digest)
const reboundNoneSnapshot = evidence.rebindRepositorySnapshotPolicy(reboundJointSnapshot, 'none')
assert.equal(reboundNoneSnapshot.snapshot_digest, snapshot.snapshot_digest)
assert.deepEqual(
  evidence.compareRepositorySnapshots(snapshot, reboundNoneSnapshot, 'none', new Date('2026-07-13T00:00:00'), new Date('2026-07-13T00:01:00')),
  { before_snapshot_digest: snapshot.snapshot_digest, after_snapshot_digest: snapshot.snapshot_digest },
)
writeFileSync(path.join(snapshotRoot, `${priorRelative}.extra`), 'same-prefix extra\n')
expectCode(() => evidence.captureRepositorySnapshot(snapshotRoot, [priorBinding]), 'undeclared_dirty_path')
const priorMutationCase = snapshotFixture('prior-mutation')
writeFileSync(priorMutationCase.priorAbsolute, '{"prior":"mutated"}\n')
expectCode(() => evidence.captureRepositorySnapshot(priorMutationCase.repository, [priorMutationCase.priorBinding]), 'prior_output_mutated')
const trackedMutationCase = snapshotFixture('tracked-mutation')
const trackedSnapshot = evidence.captureRepositorySnapshot(trackedMutationCase.repository, [trackedMutationCase.priorBinding])
writeFileSync(path.join(trackedMutationCase.repository, 'tracked.txt'), 'mutated tracked\n')
expectCode(() => evidence.assertRepositorySnapshot(trackedMutationCase.repository, trackedSnapshot, [trackedMutationCase.priorBinding]), 'repository_mutation')
const ignoredMutationCase = snapshotFixture('ignored-mutation')
mkdirSync(path.join(ignoredMutationCase.repository, 'ignored'))
writeFileSync(path.join(ignoredMutationCase.repository, 'ignored/seed.txt'), 'seed\n')
const ignoredSnapshot = evidence.captureRepositorySnapshot(ignoredMutationCase.repository, [ignoredMutationCase.priorBinding])
writeFileSync(path.join(ignoredMutationCase.repository, 'ignored/seed.txt'), 'mutated ignored bytes\n')
expectCode(() => evidence.assertRepositorySnapshot(ignoredMutationCase.repository, ignoredSnapshot, [ignoredMutationCase.priorBinding]), 'repository_mutation')
const exclusionMutationCase = snapshotFixture('ignored-exclusion-rule')
const exclusionSnapshot = evidence.captureRepositorySnapshot(exclusionMutationCase.repository, [exclusionMutationCase.priorBinding])
writeFileSync(path.join(exclusionMutationCase.repository, '.git/info/exclude'), 'runtime-private/\n')
expectCode(() => evidence.assertRepositorySnapshot(exclusionMutationCase.repository, exclusionSnapshot, [exclusionMutationCase.priorBinding]), 'repository_mutation')
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
for (const stage of ['green', 'red', 'results', 'report', 'controller_report', 'context', 'handoff', 'receipt'] as const) {
  for (const changedRepository of ['cc_gateway', 'sub2api'] as const) {
    const ccFixture = snapshotFixture(`head-policy-${stage}-${changedRepository}-cc`)
    const subFixture = snapshotFixture(`head-policy-${stage}-${changedRepository}-sub`)
    git(subFixture.repository, 'add', priorRelative)
    git(subFixture.repository, 'commit', '-qm', 'tracked Sub fixture baseline')
    const prior = evidence.STAGE_TRANSITIONS[stage].prior.map((name: keyof typeof evidence.ARTIFACT_CHAIN) => {
      const artifactPath = evidence.ARTIFACT_CHAIN[name]
      const absolute = path.join(ccFixture.repository, artifactPath)
      if (!existsSync(absolute)) writeFileSync(absolute, `${JSON.stringify({ stage: name })}\n`)
      return { path: artifactPath, digest: sha256(readFileSync(absolute)) }
    })
    evidence.initializeChainState(ccFixture.repository, prior, subFixture.repository)
    git(changedRepository === 'cc_gateway' ? ccFixture.repository : subFixture.repository, 'commit', '--allow-empty', '-qm', `wrong ${changedRepository} head`)
    expectCode(() => evidence.prepareArtifactChainStage(ccFixture.repository, stage), 'wrong_repository_head')
  }
}
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

const reviewUnsignedBase = {
  schema_version: 1,
  review_kind: 'governance_amendment_review',
  reviewed_candidate_heads: { cc_gateway: '1'.repeat(40), sub2api: '2'.repeat(40) },
  diff_digests: { cc_gateway: sha256('cc-diff'), sub2api: sha256('sub-diff') },
  plan_digest: sha256('plan'),
  review_import_digest: sha256('review-import'),
  decision: 'approved',
  findings: { critical: 0, important: 0, summaries: ['all requirements represented'] },
  verification: ['focused suite passed'],
}
const reviewBase = signedReview(reviewUnsignedBase, 'requirements')
const securityReview = signedReview(reviewUnsignedBase, 'security_quality')
const reviewExpected = {
  heads: reviewBase.reviewed_candidate_heads,
  diffs: reviewBase.diff_digests,
  planDigest: reviewBase.plan_digest,
  reviewImportDigest: reviewBase.review_import_digest,
  candidateCommitIdentities,
  reviewerRegistry: testReviewerRegistry,
}
assert.equal(evidence.validateReviewPair(reviewBase, securityReview, reviewExpected).ok, true)
assert.equal(evidence.validateReviewPair({ ...reviewUnsignedBase, reviewer_identity: 'forged-requirements', reviewer_role: 'requirements' }, { ...reviewUnsignedBase, reviewer_identity: 'forged-security', reviewer_role: 'security_quality' }, reviewExpected).ok, false)
evidence.validateReviewEvidenceSchemas({ root, requirements: reviewBase, security: securityReview, reviewImport })
const reviewWithUnknownNestedField = structuredClone(reviewBase) as any
reviewWithUnknownNestedField.reviewed_candidate_heads.surprise = '3'.repeat(40)
expectCode(() => evidence.validateReviewEvidenceSchemas({ root, requirements: reviewWithUnknownNestedField, security: securityReview, reviewImport, schemaCommit: 'HEAD' }), 'schema_validation_failed')

const reviewCliRoot = cliFixture('strict-reviews')
const subCloneParent = mkdtempSync(path.join(tmpdir(), 'oracle-p0-1-cli-sub2api-'))
const reviewCliSubPath = path.join(subCloneParent, 'repository')
execFileSync('git', ['clone', '-q', '--shared', '/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-p0-1', reviewCliSubPath])
const reviewCliSubRoot = realpathSync(reviewCliSubPath)
git(reviewCliRoot, 'config', 'user.name', 'Fixture Candidate')
git(reviewCliRoot, 'config', 'user.email', 'fixture-candidate@example.invalid')
const reviewImportRelative = 'docs/superpowers/evidence/p0-1/p0-1-review-import.json'
writeFileSync(path.join(reviewCliRoot, reviewImportRelative), `${canonical(reviewImport)}\n`)
git(reviewCliRoot, 'add', reviewImportRelative)
git(reviewCliRoot, 'commit', '-qm', 'candidate review import')
const reviewCliCandidate = git(reviewCliRoot, 'rev-parse', 'HEAD')
const reviewCliSubCandidate = git(reviewCliSubRoot, 'rev-parse', 'HEAD')
const cliReviewUnsigned = {
  ...structuredClone(reviewUnsignedBase),
  reviewed_candidate_heads: { cc_gateway: reviewCliCandidate, sub2api: reviewCliSubCandidate },
  diff_digests: {
    cc_gateway: gitBinaryDiffDigest(reviewCliRoot, '9ca9ea72d881fccd2cfb3fd1b939a2f56db69516', reviewCliCandidate),
    sub2api: gitBinaryDiffDigest(reviewCliSubRoot, 'd5a42bbd24d15af2ce7646d050a5ae5c77911d4f', reviewCliSubCandidate),
  },
  plan_digest: sha256(readFileSync(path.join(reviewCliRoot, 'docs/superpowers/plans/2026-07-12-claude-code-2.1.207-p0-1-wp-r0-governance-reconciliation.md'))),
  review_import_digest: sha256(readFileSync(path.join(reviewCliRoot, reviewImportRelative))),
}
const cliReviewBase = signedReview(cliReviewUnsigned, 'requirements')
const invalidCliRequirementsReview = structuredClone(cliReviewBase) as any
invalidCliRequirementsReview.reviewed_candidate_heads.surprise = '4'.repeat(40)
const cliSecurityReview = signedReview(cliReviewUnsigned, 'security_quality')
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

for (const [field, value] of [
  ['source_bytes', reviewImport.transformation.source_bytes + 1],
  ['adopted_bytes', reviewImport.transformation.adopted_bytes + 1],
  ['pair_digest', sha256('forged-chain-review-import-pair')],
] as const) {
  const forgedCcRoot = cliFixture(`forged-review-${field}`)
  const forgedSubParent = mkdtempSync(path.join(tmpdir(), `oracle-p0-1-forged-review-${field}-sub-`))
  const forgedSubPath = path.join(forgedSubParent, 'repository')
  execFileSync('git', ['clone', '-q', '--shared', '/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-p0-1', forgedSubPath])
  const forgedSubRoot = realpathSync(forgedSubPath)
  git(forgedCcRoot, 'config', 'user.name', 'Forged Review Candidate')
  git(forgedCcRoot, 'config', 'user.email', 'forged-review-candidate@example.invalid')
  const forgedImport = structuredClone(reviewImport) as any
  forgedImport.transformation[field] = value
  writeFileSync(path.join(forgedCcRoot, reviewImportRelative), `${canonical(forgedImport)}\n`)
  git(forgedCcRoot, 'add', reviewImportRelative)
  git(forgedCcRoot, 'commit', '-qm', `fixture forged ${field} candidate`)
  const forgedCandidate = git(forgedCcRoot, 'rev-parse', 'HEAD')
  const forgedSubCandidate = git(forgedSubRoot, 'rev-parse', 'HEAD')
  const forgedReviewUnsigned = {
    ...structuredClone(reviewUnsignedBase),
    reviewed_candidate_heads: { cc_gateway: forgedCandidate, sub2api: forgedSubCandidate },
    diff_digests: {
      cc_gateway: gitBinaryDiffDigest(forgedCcRoot, '9ca9ea72d881fccd2cfb3fd1b939a2f56db69516', forgedCandidate),
      sub2api: gitBinaryDiffDigest(forgedSubRoot, 'd5a42bbd24d15af2ce7646d050a5ae5c77911d4f', forgedSubCandidate),
    },
    plan_digest: sha256(readFileSync(path.join(forgedCcRoot, 'docs/superpowers/plans/2026-07-12-claude-code-2.1.207-p0-1-wp-r0-governance-reconciliation.md'))),
    review_import_digest: sha256(readFileSync(path.join(forgedCcRoot, reviewImportRelative))),
  }
  const forgedRequirementsPath = path.join(forgedCcRoot, 'docs/superpowers/evidence/p0-1/requirements-review.json')
  const forgedSecurityPath = path.join(forgedCcRoot, 'docs/superpowers/evidence/p0-1/security-quality-review.json')
  writeFileSync(forgedRequirementsPath, `${canonical(signedReview(forgedReviewUnsigned, 'requirements'))}\n`)
  writeFileSync(forgedSecurityPath, `${canonical(signedReview(forgedReviewUnsigned, 'security_quality'))}\n`)
  git(forgedCcRoot, 'add', 'docs/superpowers/evidence/p0-1/requirements-review.json', 'docs/superpowers/evidence/p0-1/security-quality-review.json')
  git(forgedCcRoot, 'commit', '-qm', `fixture forged ${field} approvals`)
  const forgedReviewArguments = [
    '--requirements-review', forgedRequirementsPath,
    '--security-review', forgedSecurityPath,
    '--review-import', path.join(forgedCcRoot, reviewImportRelative),
    '--cc-gateway-root', forgedCcRoot,
    '--sub2api-root', forgedSubRoot,
  ]
  expectCliCode(runCli(forgedCcRoot, ['validate-reviews', ...forgedReviewArguments]), 'invalid_review_import')
  expectCliCode(runCli(forgedCcRoot, [
    'capture-exit',
    '--entry', 'docs/superpowers/evidence/p0-1/p0-1-entry-baseline.json',
    '--entry-receipt', 'docs/superpowers/evidence/p0-1/p0-1-entry-baseline.receipt.json',
    '--cc-gateway-root', forgedCcRoot,
    '--sub2api-root', forgedSubRoot,
    '--out', evidence.ARTIFACT_CHAIN.exit,
  ]), 'invalid_review_import')
}
assert.equal(evidence.validateReviewPair(reviewBase, { ...securityReview, reviewer_identity: 'reviewer.requirements' }, reviewExpected).ok, false)
assert.equal(evidence.validateReviewPair({ ...reviewBase, reviewer_identity: 'candidate.author' }, securityReview, reviewExpected).ok, false)
assert.equal(evidence.validateReviewPair(reviewBase, { ...securityReview, reviewer_identity: 'candidate.sub@example.invalid' }, reviewExpected).ok, false)
assert.equal(evidence.validateReviewPair(reviewBase, { ...securityReview, reviewer_identity: reviewBase.reviewer_identity }, reviewExpected).ok, false)
assert.equal(evidence.validateReviewPair(reviewBase, { ...securityReview, reviewer_role: 'requirements' }, reviewExpected).ok, false)
assert.equal(evidence.validateReviewPair({ ...reviewBase, decision: 'blocked' }, securityReview, reviewExpected).ok, false)
assert.equal(evidence.validateReviewPair({ ...reviewBase, findings: { ...reviewBase.findings, important: 1 } }, securityReview, reviewExpected).ok, false)
assert.equal(evidence.validateReviewPair({ ...reviewBase, reviewed_candidate_heads: { ...reviewBase.reviewed_candidate_heads, cc_gateway: '3'.repeat(40) } }, securityReview, reviewExpected).ok, false)

// Drive every formal operation through the reviewed non-Node controller,
// absolute Node and clone-local tsx, cli(main),
// and the private frozen production runtime. Only reviewed catalog children use shims.
const acceptanceFixtureStartedAt = Date.now()
const acceptanceFixtureRoot = mkdtempSync('/tmp/op01-cli-')
const acceptanceTmp = path.join(acceptanceFixtureRoot, 'tmp')
const acceptanceCcPath = path.join(acceptanceFixtureRoot, 'cc-gateway')
const acceptanceSubPath = path.join(acceptanceFixtureRoot, 'sub2api')
mkdirSync(acceptanceTmp, { recursive: true })
const acceptanceCcRoot = cloneSharedSparseRepository(
  root,
  acceptanceCcPath,
  [...CC_SPARSE_PATHS, ...CC_GENERATED_SPARSE_PATTERNS],
  productionBranch,
  'a9c1959a06fa8f836b47f0dbc20799802beda869',
)
const acceptanceSubRoot = cloneSharedSparseRepository(sub2apiSourceRoot, acceptanceSubPath, SUB_SPARSE_PATHS)
const dependencyRoot = path.join(root, 'node_modules')
assert.equal(lstatSync(dependencyRoot).isDirectory(), true)
assert.equal(existsSync(path.join(dependencyRoot, '.bin/tsx')), true)
assert.equal(existsSync(path.join(dependencyRoot, 'ajv')), true)
linkCloneDependencies(acceptanceCcRoot, dependencyRoot)
linkCloneDependencies(acceptanceSubRoot, dependencyRoot)
const acceptanceCandidatePaths = [
  toolRelative,
  launcherRelative,
  secureRuntimeRelative,
  boundedStateRelative,
  boundedFileRelative,
  ignoredInventoryRelative,
  'tools/oracle-lab/governance-amendment-entry.ts',
  'docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md',
  taskPlanRelative,
  catalogRelative,
  trustedReviewersRelative,
  reviewedToolchainRelative,
  schemaRelatives[0],
  schemaRelatives[1],
  schemaRelatives[2],
  schemaRelatives[5],
  schemaRelatives[7],
  schemaRelatives[8],
  schemaRelatives[9],
  schemaRelatives[10],
] as const
for (const relative of acceptanceCandidatePaths) {
  writeFileSync(path.join(acceptanceCcRoot, relative), readFileSync(path.join(root, relative)))
}
chmodSync(path.join(acceptanceCcRoot, launcherRelative), 0o755)
git(acceptanceCcRoot, 'config', 'user.name', 'Acceptance Candidate')
git(acceptanceCcRoot, 'config', 'user.email', 'acceptance-candidate@example.invalid')

const acceptanceShimBin = path.join(acceptanceFixtureRoot, 'shim-bin')
const acceptanceAuditLog = path.join(acceptanceFixtureRoot, 'catalog-audit.jsonl')
writeCatalogShims({
  directory: acceptanceShimBin,
  auditLog: acceptanceAuditLog,
  ccRoot: acceptanceCcRoot,
  subRoot: acceptanceSubRoot,
})
writeFileSync(path.join(acceptanceCcRoot, trustedReviewersRelative), `${canonical(testReviewerRegistry)}\n`)
writeFileSync(path.join(acceptanceCcRoot, reviewedToolchainRelative), `${canonical(testToolchainRegistry(acceptanceShimBin))}\n`)
const acceptanceCommands: string[] = []
let acceptanceAcceptedProcessElapsedNs = 0n
let acceptancePeakBytes = directoryBytes(acceptanceFixtureRoot)
function observeAcceptanceSize(): void {
  acceptancePeakBytes = Math.max(acceptancePeakBytes, directoryBytes(acceptanceFixtureRoot))
}
function runAcceptanceCli(args: string[]): void {
  const startedAt = process.hrtime.bigint()
  const result = runProductionLauncherCli(acceptanceCcRoot, args, acceptanceShimBin, acceptanceTmp)
  acceptanceAcceptedProcessElapsedNs += process.hrtime.bigint() - startedAt
  expectProductionCliOk(result, args[0])
  acceptanceCommands.push(args[0])
  observeAcceptanceSize()
}

const startupAttackDirectory = path.join(acceptanceFixtureRoot, 'startup-attacks')
mkdirSync(startupAttackDirectory)
for (const [label, option] of [
  ['preload', `--require=${path.join(startupAttackDirectory, 'preload.cjs')}`],
  ['loader', `--experimental-loader=${path.join(startupAttackDirectory, 'loader.mjs')}`],
] as const) {
  const marker = path.join(startupAttackDirectory, `${label}.marker`)
  const payload = label === 'preload'
    ? `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed')\n`
    : `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed'); export async function resolve(s,c,n){return n(s,c)}\n`
  writeFileSync(path.join(startupAttackDirectory, label === 'preload' ? 'preload.cjs' : 'loader.mjs'), payload)
  const beforeJournal = existsSync(path.join(acceptanceCcRoot, '.git/oracle-p0-1-chain-state.json'))
  const observed = runProductionLauncherCli(acceptanceCcRoot, ['review-import'], acceptanceShimBin, acceptanceTmp, { NODE_OPTIONS: option })
  expectProductionCliCode(observed, 'unsafe_startup_environment')
  assert.equal(existsSync(marker), false, `${label} startup payload must not execute`)
  assert.equal(existsSync(path.join(acceptanceCcRoot, '.git/oracle-p0-1-chain-state.json')), beforeJournal)
  assert.equal(existsSync(path.join(acceptanceCcRoot, evidence.ARTIFACT_CHAIN.exit)), false)
}

const redirectedGitRepository = path.join(startupAttackDirectory, 'redirected-repository')
mkdirSync(redirectedGitRepository)
git(redirectedGitRepository, 'init', '-q')
git(redirectedGitRepository, 'config', 'user.name', 'Redirect Decoy')
git(redirectedGitRepository, 'config', 'user.email', 'redirect@example.invalid')
writeFileSync(path.join(redirectedGitRepository, 'decoy.txt'), 'decoy\n')
git(redirectedGitRepository, 'add', 'decoy.txt')
git(redirectedGitRepository, 'commit', '-qm', 'decoy')
const redirectedGitHead = git(redirectedGitRepository, 'rev-parse', 'HEAD')
for (const [name, value] of [
  ['GIT_DIR', path.join(redirectedGitRepository, '.git')],
  ['GIT_WORK_TREE', redirectedGitRepository],
  ['GIT_INDEX_FILE', path.join(redirectedGitRepository, '.git/index')],
  ['GIT_OBJECT_DIRECTORY', path.join(redirectedGitRepository, '.git/objects')],
  ['GIT_ALTERNATE_OBJECT_DIRECTORIES', path.join(redirectedGitRepository, '.git/objects')],
] as const) {
  const observed = runProductionLauncherCli(acceptanceCcRoot, ['review-import'], acceptanceShimBin, acceptanceTmp, { [name]: value })
  expectProductionCliCode(observed, 'unsafe_startup_environment')
  assert.equal(existsSync(path.join(acceptanceCcRoot, '.git/oracle-p0-1-chain-state.json')), false)
  assert.equal(existsSync(path.join(acceptanceCcRoot, evidence.ARTIFACT_CHAIN.exit)), false)
  assert.equal(git(redirectedGitRepository, 'rev-parse', 'HEAD'), redirectedGitHead)
}

const gitShadowDirectory = path.join(acceptanceFixtureRoot, 'git-shadow')
const gitShadowMarker = path.join(acceptanceFixtureRoot, 'git-shadow.marker')
mkdirSync(gitShadowDirectory)
writeFileSync(path.join(gitShadowDirectory, 'git'), `#!/bin/sh\nprintf executed > ${JSON.stringify(gitShadowMarker)}\nexit 0\n`)
chmodSync(path.join(gitShadowDirectory, 'git'), 0o755)
const shadowedGit = runProductionLauncherCli(acceptanceCcRoot, ['review-import'], `${gitShadowDirectory}${path.delimiter}${acceptanceShimBin}`, acceptanceTmp)
expectProductionCliCode(shadowedGit, 'unsafe_startup_environment')
assert.equal(existsSync(gitShadowMarker), false)
assert.equal(existsSync(path.join(acceptanceCcRoot, '.git/oracle-p0-1-chain-state.json')), false)
assert.equal(existsSync(path.join(acceptanceCcRoot, evidence.ARTIFACT_CHAIN.exit)), false)

for (const tool of ['npm', 'go'] as const) {
  const shadowDirectory = path.join(acceptanceFixtureRoot, `${tool}-shadow`)
  const marker = path.join(acceptanceFixtureRoot, `${tool}-shadow.marker`)
  mkdirSync(shadowDirectory)
  writeFileSync(path.join(shadowDirectory, tool), `#!/bin/sh\nprintf executed > ${JSON.stringify(marker)}\nprintf 'test-shim-v1\\n'\n`)
  chmodSync(path.join(shadowDirectory, tool), 0o755)
  const observed = runProductionLauncherCli(acceptanceCcRoot, ['capture-exit'], `${shadowDirectory}${path.delimiter}${acceptanceShimBin}`, acceptanceTmp)
  expectProductionCliCode(observed, 'unsafe_startup_environment')
  assert.equal(existsSync(marker), false, `shadowed ${tool} must be rejected before execution`)
}

const replacementRoot = cloneSharedSparseRepository(
  acceptanceCcRoot,
  path.join(acceptanceFixtureRoot, 'replacement-repository'),
  [...CC_SPARSE_PATHS, ...CC_GENERATED_SPARSE_PATTERNS],
)
for (const relative of [toolRelative, launcherRelative, secureRuntimeRelative, boundedStateRelative, boundedFileRelative, ignoredInventoryRelative, 'tools/oracle-lab/governance-amendment-entry.ts', reviewedToolchainRelative, 'docs/superpowers/schemas/oracle-lab-p0-1-reviewed-toolchain.schema.json']) {
  writeFileSync(path.join(replacementRoot, relative), readFileSync(path.join(root, relative)))
}
chmodSync(path.join(replacementRoot, launcherRelative), 0o755)
linkCloneDependencies(replacementRoot, dependencyRoot)
git(replacementRoot, 'replace', git(replacementRoot, 'rev-parse', 'HEAD'), git(replacementRoot, 'rev-parse', 'HEAD^'))
const replacementObserved = runProductionLauncherCli(replacementRoot, ['review-import'], '/usr/bin:/bin', acceptanceTmp)
expectProductionCliCode(replacementObserved, 'git_replace_refs_present')
assert.equal(existsSync(path.join(replacementRoot, '.git/oracle-p0-1-chain-state.json')), false)
assert.equal(existsSync(path.join(replacementRoot, evidence.ARTIFACT_CHAIN.exit)), false)

const replacementSymlinkRoot = candidateIdentityFixture('replacement-symlink', 'Replacement Symlink', 'replacement-symlink@example.invalid').repository
const replacementExternalTarget = path.join(acceptanceFixtureRoot, 'replacement-external-target')
mkdirSync(replacementExternalTarget)
symlinkSync(replacementExternalTarget, path.join(replacementSymlinkRoot, '.git/refs/replace'), 'dir')
expectCode(() => secureRuntime.assertNoGitReplacementRefs(replacementSymlinkRoot), 'git_replace_refs_storage_type')
assert.equal(existsSync(path.join(replacementSymlinkRoot, '.git/oracle-p0-1-chain-state.json')), false)
assert.equal(existsSync(path.join(replacementSymlinkRoot, evidence.ARTIFACT_CHAIN.exit)), false)
git(replacementSymlinkRoot, 'replace', git(replacementSymlinkRoot, 'rev-parse', 'HEAD'), git(replacementSymlinkRoot, 'rev-parse', 'HEAD^'))
expectCode(() => secureRuntime.runReviewedGit(replacementSymlinkRoot, ['rev-parse', 'HEAD']), 'git_replace_refs_storage_type')
assert.equal(existsSync(path.join(replacementSymlinkRoot, '.git/oracle-p0-1-chain-state.json')), false)
assert.equal(existsSync(path.join(replacementSymlinkRoot, evidence.ARTIFACT_CHAIN.exit)), false)

const replacementWrongTypeRoot = candidateIdentityFixture('replacement-wrong-type', 'Replacement Wrong Type', 'replacement-wrong-type@example.invalid').repository
writeFileSync(path.join(replacementWrongTypeRoot, '.git/refs/replace'), 'not a directory\n')
expectCode(() => secureRuntime.assertNoGitReplacementRefs(replacementWrongTypeRoot), 'git_replace_refs_storage_type')
const packedRefsWrongTypeRoot = candidateIdentityFixture('packed-refs-wrong-type', 'Packed Refs Wrong Type', 'packed-refs-wrong-type@example.invalid').repository
mkdirSync(path.join(packedRefsWrongTypeRoot, '.git/packed-refs'))
expectCode(() => secureRuntime.assertNoGitReplacementRefs(packedRefsWrongTypeRoot), 'git_packed_refs_storage_type')

git(acceptanceCcRoot, 'add', ...acceptanceCandidatePaths)
git(acceptanceCcRoot, 'commit', '-qm', 'fixture candidate review-import inputs')
runAcceptanceCli([
  'review-import',
  '--review-source', source,
  '--adopted-amendment', path.join(acceptanceCcRoot, 'docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md'),
  '--out', reviewImportRelative,
])
runAcceptanceCli([
  'validate-review-import',
  '--review-import', reviewImportRelative,
  '--review-source', source,
  '--adopted-amendment', path.join(acceptanceCcRoot, 'docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md'),
])
git(acceptanceCcRoot, 'add', reviewImportRelative)
git(acceptanceCcRoot, 'commit', '-qm', 'fixture candidate review import')
const acceptanceCandidate = git(acceptanceCcRoot, 'rev-parse', 'HEAD')
const acceptanceSubCandidate = git(acceptanceSubRoot, 'rev-parse', 'HEAD')
const acceptanceReviewImport = readFileSync(path.join(acceptanceCcRoot, reviewImportRelative))
const acceptanceReviewUnsigned = {
  ...structuredClone(reviewUnsignedBase),
  reviewed_candidate_heads: { cc_gateway: acceptanceCandidate, sub2api: acceptanceSubCandidate },
  diff_digests: {
    cc_gateway: gitBinaryDiffDigest(acceptanceCcRoot, '9ca9ea72d881fccd2cfb3fd1b939a2f56db69516', acceptanceCandidate),
    sub2api: gitBinaryDiffDigest(acceptanceSubRoot, 'd5a42bbd24d15af2ce7646d050a5ae5c77911d4f', acceptanceSubCandidate),
  },
  plan_digest: sha256(readFileSync(path.join(acceptanceCcRoot, 'docs/superpowers/plans/2026-07-12-claude-code-2.1.207-p0-1-wp-r0-governance-reconciliation.md'))),
  review_import_digest: sha256(acceptanceReviewImport),
}
const acceptanceRequirementsReview = signedReview(acceptanceReviewUnsigned, 'requirements')
const acceptanceSecurityReview = signedReview(acceptanceReviewUnsigned, 'security_quality')
writeFileSync(path.join(acceptanceCcRoot, 'docs/superpowers/evidence/p0-1/requirements-review.json'), `${canonical(acceptanceRequirementsReview)}\n`)
writeFileSync(path.join(acceptanceCcRoot, 'docs/superpowers/evidence/p0-1/security-quality-review.json'), `${canonical(acceptanceSecurityReview)}\n`)
git(acceptanceCcRoot, 'add', 'docs/superpowers/evidence/p0-1/requirements-review.json', 'docs/superpowers/evidence/p0-1/security-quality-review.json')
git(acceptanceCcRoot, 'commit', '-qm', 'fixture approval attestations')
runAcceptanceCli([
  'validate-reviews',
  '--requirements-review', 'docs/superpowers/evidence/p0-1/requirements-review.json',
  '--security-review', 'docs/superpowers/evidence/p0-1/security-quality-review.json',
  '--review-import', reviewImportRelative,
  '--cc-gateway-root', acceptanceCcRoot,
  '--sub2api-root', acceptanceSubRoot,
])

const acceptanceCcCodeGraph = initializeRealCodeGraph(acceptanceCcRoot, acceptanceTmp)
const acceptanceSubCodeGraph = initializeRealCodeGraph(acceptanceSubRoot, acceptanceTmp)
symlinkSync('codegraph.db', path.join(acceptanceCcRoot, '.codegraph/continuity-link'))
symlinkSync('codegraph.db', path.join(acceptanceSubRoot, '.codegraph/continuity-link'))
observeAcceptanceSize()

const codeGraphShadowDirectory = path.join(acceptanceFixtureRoot, 'codegraph-shadow')
const codeGraphShadowMarker = path.join(acceptanceFixtureRoot, 'codegraph-shadow.marker')
mkdirSync(codeGraphShadowDirectory)
writeFileSync(path.join(codeGraphShadowDirectory, 'codegraph'), `#!/bin/sh\nprintf executed > ${JSON.stringify(codeGraphShadowMarker)}\nprintf '%s\\n' '{"initialized":true,"upToDate":true}'\n`)
chmodSync(path.join(codeGraphShadowDirectory, 'codegraph'), 0o755)
const shadowedCodeGraph = runProductionLauncherCli(
  acceptanceCcRoot,
  ['capture-exit'],
  `${codeGraphShadowDirectory}${path.delimiter}${acceptanceShimBin}`,
  acceptanceTmp,
)
expectProductionCliCode(shadowedCodeGraph, 'unsafe_startup_environment')
assert.equal(existsSync(codeGraphShadowMarker), false)
assert.equal(existsSync(path.join(acceptanceCcRoot, '.git/oracle-p0-1-chain-state.json')), false)
assert.equal(existsSync(path.join(acceptanceCcRoot, evidence.ARTIFACT_CHAIN.exit)), false)

const oversizedEntryRoot = cloneAcceptanceProductionBranch('oversized-fixed-entry')
cpSync(path.join(acceptanceCcRoot, '.codegraph'), path.join(oversizedEntryRoot, '.codegraph'), { recursive: true, verbatimSymlinks: true })
const oversizedEntryPath = path.join(oversizedEntryRoot, 'docs/superpowers/evidence/p0-1/p0-1-entry-baseline.json')
sparseFile(oversizedEntryPath, boundedFile.MAX_EVIDENCE_FILE_BYTES + 1)
const oversizedEntryObserved = runProductionLauncherCli(oversizedEntryRoot, [
  'capture-exit',
  '--entry', 'docs/superpowers/evidence/p0-1/p0-1-entry-baseline.json',
  '--entry-receipt', 'docs/superpowers/evidence/p0-1/p0-1-entry-baseline.receipt.json',
  '--cc-gateway-root', oversizedEntryRoot,
  '--sub2api-root', acceptanceSubRoot,
  '--out', evidence.ARTIFACT_CHAIN.exit,
], acceptanceShimBin, acceptanceTmp)
expectProductionCliCode(oversizedEntryObserved, 'bounded_file_size_limit_exceeded')
assert.equal(oversizedEntryObserved.signal, null)
assert.equal(existsSync(path.join(oversizedEntryRoot, evidence.ARTIFACT_CHAIN.exit)), false)
assert.equal(existsSync(path.join(oversizedEntryRoot, '.git/oracle-p0-1-chain-state.json')), false)
assert.equal(lstatSync(oversizedEntryPath).size, boundedFile.MAX_EVIDENCE_FILE_BYTES + 1)

const oversizedCodeGraphRoot = cloneAcceptanceProductionBranch('oversized-codegraph-db')
cpSync(path.join(acceptanceCcRoot, '.codegraph'), path.join(oversizedCodeGraphRoot, '.codegraph'), { recursive: true, verbatimSymlinks: true })
const oversizedCodeGraphPath = path.join(oversizedCodeGraphRoot, '.codegraph/codegraph.db')
extendSparseFile(oversizedCodeGraphPath, boundedFile.MAX_CODEGRAPH_DATABASE_BYTES + 1)
const oversizedCodeGraphStatus = JSON.parse(execFileSync(realCodeGraphExecutable, ['status', '--json', oversizedCodeGraphRoot], {
  cwd: oversizedCodeGraphRoot,
  env: productionParentEnvironment('/usr/bin:/bin', acceptanceTmp),
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  maxBuffer: PRODUCTION_CLI_MAX_BUFFER,
}))
assert.equal(oversizedCodeGraphStatus.initialized, true)
const oversizedCodeGraphObserved = runProductionLauncherCli(oversizedCodeGraphRoot, [
  'capture-exit',
  '--entry', 'docs/superpowers/evidence/p0-1/p0-1-entry-baseline.json',
  '--entry-receipt', 'docs/superpowers/evidence/p0-1/p0-1-entry-baseline.receipt.json',
  '--cc-gateway-root', oversizedCodeGraphRoot,
  '--sub2api-root', acceptanceSubRoot,
  '--out', evidence.ARTIFACT_CHAIN.exit,
], acceptanceShimBin, acceptanceTmp)
expectProductionCliCode(oversizedCodeGraphObserved, 'bounded_file_size_limit_exceeded')
assert.equal(oversizedCodeGraphObserved.signal, null)
assert.equal(existsSync(path.join(oversizedCodeGraphRoot, evidence.ARTIFACT_CHAIN.exit)), false)
assert.equal(existsSync(path.join(oversizedCodeGraphRoot, '.git/oracle-p0-1-chain-state.json')), false)
assert.equal(lstatSync(oversizedCodeGraphPath).size, boundedFile.MAX_CODEGRAPH_DATABASE_BYTES + 1)

runAcceptanceCli([
  'capture-exit',
  '--entry', 'docs/superpowers/evidence/p0-1/p0-1-entry-baseline.json',
  '--entry-receipt', 'docs/superpowers/evidence/p0-1/p0-1-entry-baseline.receipt.json',
  '--cc-gateway-root', acceptanceCcRoot,
  '--sub2api-root', acceptanceSubRoot,
  '--out', evidence.ARTIFACT_CHAIN.exit,
])
const acceptanceManifest = JSON.parse(readFileSync(path.join(acceptanceCcRoot, evidence.ARTIFACT_CHAIN.exit), 'utf8'))
assert.equal(acceptanceManifest.repositories.cc_gateway.head, git(acceptanceCcRoot, 'rev-parse', 'HEAD'))
assert.equal(acceptanceManifest.repositories.sub2api.head, acceptanceSubCandidate)
assert.deepEqual(acceptanceManifest.reviewed_candidate_heads, { cc_gateway: acceptanceCandidate, sub2api: acceptanceSubCandidate })
for (const [name, status] of [['cc_gateway', acceptanceCcCodeGraph], ['sub2api', acceptanceSubCodeGraph]] as const) {
  const binding = acceptanceManifest.codegraph[name]
  assert.equal(binding.version, status.version)
  assert.equal(binding.file_count, status.fileCount)
  assert.equal(binding.node_count, status.nodeCount)
  assert.equal(binding.edge_count, status.edgeCount)
  assert.equal(binding.index_digest, sha256(readFileSync(path.join(name === 'cc_gateway' ? acceptanceCcRoot : acceptanceSubRoot, '.codegraph/codegraph.db'))))
}

function initializeCaptureExitCheckpoint(ccCheckpoint: string, subCheckpoint: string): void {
  cpSync(path.join(acceptanceCcRoot, '.codegraph'), path.join(ccCheckpoint, '.codegraph'), { recursive: true, verbatimSymlinks: true })
  cpSync(path.join(acceptanceSubRoot, '.codegraph'), path.join(subCheckpoint, '.codegraph'), { recursive: true, verbatimSymlinks: true })
  linkCloneDependencies(subCheckpoint, dependencyRoot)
  const exit = path.join(ccCheckpoint, evidence.ARTIFACT_CHAIN.exit)
  mkdirSync(path.dirname(exit), { recursive: true })
  writeFileSync(exit, readFileSync(path.join(acceptanceCcRoot, evidence.ARTIFACT_CHAIN.exit)))
  evidence.initializeArtifactChain(ccCheckpoint, subCheckpoint, {
    cc_gateway: acceptanceManifest.repositories.cc_gateway.initial_ignored_inventory,
    sub2api: acceptanceManifest.repositories.sub2api.initial_ignored_inventory,
  })
}

const oversizedPriorRoot = cloneAcceptanceRef('oversized-prior-artifact', acceptanceManifest.approval_attestation_head)
const oversizedPriorSubRoot = cloneRepositoryRef(acceptanceSubRoot, 'oversized-prior-artifact-sub', acceptanceSubCandidate)
initializeCaptureExitCheckpoint(oversizedPriorRoot, oversizedPriorSubRoot)
const oversizedPriorPath = path.join(oversizedPriorRoot, evidence.ARTIFACT_CHAIN.exit)
sparseFile(oversizedPriorPath, boundedFile.MAX_EVIDENCE_FILE_BYTES + 1)
const oversizedPriorStatePath = git(oversizedPriorRoot, 'rev-parse', '--path-format=absolute', '--git-path', 'oracle-p0-1-chain-state.json')
const oversizedPriorStateBefore = readFileSync(oversizedPriorStatePath)
const oversizedPriorObserved = runProductionLauncherCli(oversizedPriorRoot, [
  'run', '--manifest', evidence.ARTIFACT_CHAIN.exit, '--catalog', catalogRelative, '--group', 'green',
  '--cc-gateway-root', oversizedPriorRoot, '--sub2api-root', oversizedPriorSubRoot, '--out', evidence.ARTIFACT_CHAIN.green,
], acceptanceShimBin, acceptanceTmp)
expectProductionCliCode(oversizedPriorObserved, 'bounded_file_size_limit_exceeded')
assert.equal(oversizedPriorObserved.signal, null)
assert.deepEqual(readFileSync(oversizedPriorStatePath), oversizedPriorStateBefore)
assert.equal(existsSync(path.join(oversizedPriorRoot, evidence.ARTIFACT_CHAIN.green)), false)
assert.equal(lstatSync(oversizedPriorPath).size, boundedFile.MAX_EVIDENCE_FILE_BYTES + 1)

for (const kind of ['untracked', 'tracked'] as const) {
  const label = `visible-state-${kind}-sparse`
  const ccCheckpoint = cloneAcceptanceRef(label, acceptanceManifest.approval_attestation_head)
  const subCheckpoint = cloneRepositoryRef(acceptanceSubRoot, `${label}-sub`, acceptanceSubCandidate)
  initializeCaptureExitCheckpoint(ccCheckpoint, subCheckpoint)
  const target = path.join(ccCheckpoint, kind === 'tracked' ? taskPlanRelative : 'huge-visible-state.bin')
  sparseFile(target, boundedState.VISIBLE_STATE_LIMITS.maxFileBytes + 1)
  const statePath = git(ccCheckpoint, 'rev-parse', '--path-format=absolute', '--git-path', 'oracle-p0-1-chain-state.json')
  const stateBefore = readFileSync(statePath)
  const observed = runProductionLauncherCli(ccCheckpoint, [
    'run', '--manifest', evidence.ARTIFACT_CHAIN.exit, '--catalog', catalogRelative, '--group', 'green',
    '--cc-gateway-root', ccCheckpoint, '--sub2api-root', subCheckpoint, '--out', evidence.ARTIFACT_CHAIN.green,
  ], acceptanceShimBin, acceptanceTmp)
  expectProductionCliCode(observed, 'visible_state_file_limit_exceeded')
  assert.equal(observed.signal, null)
  assert.deepEqual(readFileSync(statePath), stateBefore)
  assert.equal(existsSync(path.join(ccCheckpoint, evidence.ARTIFACT_CHAIN.green)), false)
  assert.equal(lstatSync(target).size, boundedState.VISIBLE_STATE_LIMITS.maxFileBytes + 1)
}

type PersistentIgnoredDrift = 'create' | 'modify' | 'delete' | 'type' | 'mode' | 'symlink-target'
let continuityCheckpointPeakBytes = 0

function applyPersistentIgnoredDrift(root: string, label: string, drift: PersistentIgnoredDrift): void {
  const database = path.join(root, '.codegraph/codegraph.db')
  const retained = path.join(acceptanceFixtureRoot, `${label}-retained`)
  if (drift === 'create') writeFileSync(path.join(root, `.codegraph/${label}.txt`), 'persistent between-stage bytes\n')
  if (drift === 'modify') writeFileSync(database, 'persistent modified database bytes\n')
  if (drift === 'delete') renameSync(database, `${retained}.db`)
  if (drift === 'type') {
    renameSync(database, `${retained}.db`)
    mkdirSync(database)
  }
  if (drift === 'mode') {
    const currentMode = lstatSync(database).mode & 0o777
    chmodSync(database, currentMode === 0o600 ? 0o640 : 0o600)
  }
  if (drift === 'symlink-target') {
    renameSync(path.join(root, '.codegraph/continuity-link'), `${retained}-continuity-link`)
    symlinkSync('alternate-codegraph.db', path.join(root, '.codegraph/continuity-link'))
  }
}

function observeContinuityCheckpoint(ccCheckpoint: string, subCheckpoint: string): void {
  const bytes = directoryBytes(path.dirname(ccCheckpoint)) + directoryBytes(path.dirname(subCheckpoint))
  continuityCheckpointPeakBytes = Math.max(continuityCheckpointPeakBytes, bytes)
  assert.equal(bytes < 12 * MiB, true, `continuity checkpoint ${bytes} bytes exceeded 12 MiB`)
}

function expectCaptureExitToGreenIgnoredDriftRejected(repository: 'cc' | 'sub', drift: PersistentIgnoredDrift): void {
  const label = `exit-green-${repository}-${drift}`
  const ccCheckpoint = cloneAcceptanceRef(label, acceptanceManifest.approval_attestation_head)
  const subCheckpoint = cloneRepositoryRef(acceptanceSubRoot, `${label}-sub`, acceptanceSubCandidate)
  initializeCaptureExitCheckpoint(ccCheckpoint, subCheckpoint)
  const mutatedRoot = repository === 'cc' ? ccCheckpoint : subCheckpoint
  applyPersistentIgnoredDrift(mutatedRoot, label, drift)
  const shimBin = path.join(acceptanceFixtureRoot, `checkpoint-shim-${label}`)
  writeCatalogShims({
    directory: shimBin,
    auditLog: path.join(acceptanceFixtureRoot, `checkpoint-audit-${label}.jsonl`),
    ccRoot: ccCheckpoint,
    subRoot: subCheckpoint,
  })
  const observed = runProductionLauncherCli(ccCheckpoint, [
    'run', '--manifest', evidence.ARTIFACT_CHAIN.exit, '--catalog', catalogRelative, '--group', 'green',
    '--cc-gateway-root', ccCheckpoint, '--sub2api-root', subCheckpoint, '--out', evidence.ARTIFACT_CHAIN.green,
  ], shimBin, acceptanceTmp)
  expectProductionCliCode(observed, 'repository_mutation')
  assert.equal(existsSync(path.join(ccCheckpoint, evidence.ARTIFACT_CHAIN.green)), false)
  observeContinuityCheckpoint(ccCheckpoint, subCheckpoint)
}

for (const repository of ['cc', 'sub'] as const) {
  for (const drift of ['create', 'modify', 'delete', 'type', 'mode', 'symlink-target'] as const) {
    expectCaptureExitToGreenIgnoredDriftRejected(repository, drift)
  }
}

for (const node of ['date-directory', 'safe-directory', 'readme', 'summary'] as const) {
  const label = `joint-mode-${node}`
  const ccCheckpoint = cloneAcceptanceRef(label, acceptanceManifest.approval_attestation_head)
  const subCheckpoint = cloneRepositoryRef(acceptanceSubRoot, `${label}-sub`, acceptanceSubCandidate)
  initializeCaptureExitCheckpoint(ccCheckpoint, subCheckpoint)
  const shimBin = path.join(acceptanceFixtureRoot, `checkpoint-shim-${label}`)
  writeCatalogShims({
    directory: shimBin,
    auditLog: path.join(acceptanceFixtureRoot, `checkpoint-audit-${label}.jsonl`),
    ccRoot: ccCheckpoint,
    subRoot: subCheckpoint,
    jointModeNode: node,
  })
  const observed = runProductionLauncherCli(ccCheckpoint, [
    'run', '--manifest', evidence.ARTIFACT_CHAIN.exit, '--catalog', catalogRelative, '--group', 'green',
    '--cc-gateway-root', ccCheckpoint, '--sub2api-root', subCheckpoint, '--out', evidence.ARTIFACT_CHAIN.green,
  ], shimBin, acceptanceTmp)
  expectProductionCliCode(observed, 'repository_mutation')
  assert.equal(existsSync(path.join(ccCheckpoint, evidence.ARTIFACT_CHAIN.green)), false)
  observeContinuityCheckpoint(ccCheckpoint, subCheckpoint)
}

runAcceptanceCli([
  'run',
  '--manifest', evidence.ARTIFACT_CHAIN.exit,
  '--catalog', catalogRelative,
  '--group', 'green',
  '--cc-gateway-root', acceptanceCcRoot,
  '--sub2api-root', acceptanceSubRoot,
  '--out', evidence.ARTIFACT_CHAIN.green,
])
runAcceptanceCli([
  'run',
  '--manifest', evidence.ARTIFACT_CHAIN.exit,
  '--catalog', catalogRelative,
  '--group', 'red',
  '--cc-gateway-root', acceptanceCcRoot,
  '--sub2api-root', acceptanceSubRoot,
  '--out', evidence.ARTIFACT_CHAIN.red,
])
const acceptanceGreenResults = JSON.parse(readFileSync(path.join(acceptanceCcRoot, evidence.ARTIFACT_CHAIN.green), 'utf8'))
for (const record of acceptanceGreenResults.records) {
  if (record.command_id === 'sub2api-joint-local-chain') {
    assert.equal(record.ignored_output_observations.length, 1)
    assert.deepEqual(Object.keys(record.ignored_output_observations[0]).sort(), ['after', 'before', 'policy', 'policy_digest', 'repository'])
    assert.equal(record.ignored_output_observations[0].repository, 'sub2api')
    assert.equal(record.ignored_output_observations[0].policy, 'sub2api_joint_safe_deliverable_v1')
    assert.equal(record.ignored_output_observations[0].policy_digest, ignoredInventory.IGNORED_OUTPUT_POLICY_DIGESTS.sub2api_joint_safe_deliverable_v1)
    assert.equal(JSON.stringify(record.ignored_output_observations[0]).includes('safe-deliverable'), false)
  } else {
    assert.deepEqual(record.ignored_output_observations, [])
  }
}
runAcceptanceCli([
  'merge',
  '--manifest', evidence.ARTIFACT_CHAIN.exit,
  '--green', evidence.ARTIFACT_CHAIN.green,
  '--red', evidence.ARTIFACT_CHAIN.red,
  '--out', evidence.ARTIFACT_CHAIN.results,
])
runAcceptanceCli([
  'report',
  '--manifest', evidence.ARTIFACT_CHAIN.exit,
  '--results', evidence.ARTIFACT_CHAIN.results,
  '--requirements-review', 'docs/superpowers/evidence/p0-1/requirements-review.json',
  '--security-review', 'docs/superpowers/evidence/p0-1/security-quality-review.json',
  '--out', evidence.ARTIFACT_CHAIN.report,
  '--markdown', evidence.ARTIFACT_CHAIN.report_markdown,
])
runAcceptanceCli([
  'validate-report',
  '--report', evidence.ARTIFACT_CHAIN.report,
  '--markdown', evidence.ARTIFACT_CHAIN.report_markdown,
])
runAcceptanceCli([
  'controller-report',
  '--manifest', evidence.ARTIFACT_CHAIN.exit,
  '--results', evidence.ARTIFACT_CHAIN.results,
  '--requirements-review', 'docs/superpowers/evidence/p0-1/requirements-review.json',
  '--security-review', 'docs/superpowers/evidence/p0-1/security-quality-review.json',
  '--report', evidence.ARTIFACT_CHAIN.report,
  '--report-markdown', evidence.ARTIFACT_CHAIN.report_markdown,
  '--out', evidence.ARTIFACT_CHAIN.controller_report,
  '--markdown', evidence.ARTIFACT_CHAIN.controller_report_markdown,
])
runAcceptanceCli([
  'validate-report',
  '--report', evidence.ARTIFACT_CHAIN.controller_report,
  '--markdown', evidence.ARTIFACT_CHAIN.controller_report_markdown,
])
runAcceptanceCli([
  'context',
  '--manifest', evidence.ARTIFACT_CHAIN.exit,
  '--results', evidence.ARTIFACT_CHAIN.results,
  '--review-import', reviewImportRelative,
  '--requirements-review', 'docs/superpowers/evidence/p0-1/requirements-review.json',
  '--security-review', 'docs/superpowers/evidence/p0-1/security-quality-review.json',
  '--report', evidence.ARTIFACT_CHAIN.report,
  '--report-markdown', evidence.ARTIFACT_CHAIN.report_markdown,
  '--controller-report', evidence.ARTIFACT_CHAIN.controller_report,
  '--controller-report-markdown', evidence.ARTIFACT_CHAIN.controller_report_markdown,
  '--out', evidence.ARTIFACT_CHAIN.context,
])
runAcceptanceCli([
  'handoff',
  '--manifest', evidence.ARTIFACT_CHAIN.exit,
  '--results', evidence.ARTIFACT_CHAIN.results,
  '--context', evidence.ARTIFACT_CHAIN.context,
  '--report', evidence.ARTIFACT_CHAIN.report,
  '--report-markdown', evidence.ARTIFACT_CHAIN.report_markdown,
  '--controller-report', evidence.ARTIFACT_CHAIN.controller_report,
  '--controller-report-markdown', evidence.ARTIFACT_CHAIN.controller_report_markdown,
  '--out', evidence.ARTIFACT_CHAIN.handoff,
])

const acceptanceAudit = readFileSync(acceptanceAuditLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as any)
assert.equal(acceptanceAudit.length, 10)
const acceptanceResultRecords = [...acceptanceGreenResults.records, ...JSON.parse(readFileSync(path.join(acceptanceCcRoot, evidence.ARTIFACT_CHAIN.red), 'utf8')).records]
for (const [index, invocation] of acceptanceAudit.entries()) {
  const [id, , , cwdTemplate, argv, extraEnv] = expectedCatalog[index]
  const expectedCwd = cwdTemplate.replace('${CC_GATEWAY_ROOT}', acceptanceCcRoot).replace('${SUB2API_ROOT}', acceptanceSubRoot)
  assert.equal(invocation.command_id, id)
  assert.equal(invocation.executable, argv[0])
  assert.deepEqual(invocation.argv, argv.slice(1))
  assert.equal(invocation.cwd, expectedCwd)
  assert.deepEqual(invocation.env_keys, [...Object.keys(invocation.selected_env), '__CF_USER_TEXT_ENCODING'].sort())
  assert.deepEqual(invocation.platform_env, { __CF_USER_TEXT_ENCODING: process.env.__CF_USER_TEXT_ENCODING })
  assert.deepEqual(Object.fromEntries(Object.entries(invocation.selected_env).filter(([key]) => key in HERMETIC_NETWORK_ENV)), HERMETIC_NETWORK_ENV)
  assert.equal(invocation.selected_env.CI, '1')
  assert.equal(invocation.selected_env.HOME, '/dev/null')
  assert.equal(invocation.selected_env.TMPDIR, '/tmp')
  assert.equal(invocation.selected_env.npm_config_userconfig, '/dev/null')
  assert.equal(invocation.selected_env.npm_config_globalconfig, '/etc/oracle-p0-1-empty-npmrc')
  assert.equal(invocation.selected_env.GOENV, 'off')
  assert.equal(String(invocation.selected_env.PATH).split(path.delimiter).includes(realpathSync(acceptanceShimBin)), true)
  assert.equal(String(invocation.selected_env.PATH).split(path.delimiter)[0], realpathSync(acceptanceShimBin))
  for (const [key, value] of Object.entries(extraEnv)) {
    assert.equal(invocation.selected_env[key], value.replace('${CC_GATEWAY_ROOT}', acceptanceCcRoot).replace('${SUB2API_ROOT}', acceptanceSubRoot))
  }
  const resultRecord = acceptanceResultRecords.find((record: any) => record.command_id === id)
  assert.equal(resultRecord.environment_digest, sha256(canonical(invocation.selected_env)))
  assert.equal(resultRecord.argv_digest, sha256(canonical([realpathSync(path.join(acceptanceShimBin, argv[0])), ...argv.slice(1)])))
}

const preReceiptArtifactPaths = Object.entries(evidence.ARTIFACT_CHAIN)
  .filter(([name]) => name !== 'receipt')
  .map(([, artifactPath]) => artifactPath as string)
git(acceptanceCcRoot, 'add', ...preReceiptArtifactPaths)
git(acceptanceCcRoot, 'commit', '-qm', 'fixture artifact chain')
const acceptanceArtifactCommit = git(acceptanceCcRoot, 'rev-parse', 'HEAD')
assert.deepEqual(git(acceptanceCcRoot, 'diff-tree', '--no-commit-id', '--name-status', '-r', acceptanceArtifactCommit).split('\n').sort(), preReceiptArtifactPaths.map((artifactPath) => `A\t${artifactPath}`).sort())

const receiptArguments = [
  '--artifact-commit', acceptanceArtifactCommit,
  '--manifest', evidence.ARTIFACT_CHAIN.exit,
  '--results', evidence.ARTIFACT_CHAIN.results,
  '--context', evidence.ARTIFACT_CHAIN.context,
  '--handoff', evidence.ARTIFACT_CHAIN.handoff,
  '--report', evidence.ARTIFACT_CHAIN.report,
  '--report-markdown', evidence.ARTIFACT_CHAIN.report_markdown,
  '--controller-report', evidence.ARTIFACT_CHAIN.controller_report,
  '--controller-report-markdown', evidence.ARTIFACT_CHAIN.controller_report_markdown,
  '--out', evidence.ARTIFACT_CHAIN.receipt,
]
runAcceptanceCli(['receipt', ...receiptArguments])
runAcceptanceCli([
  'validate-receipt',
  '--receipt', evidence.ARTIFACT_CHAIN.receipt,
  '--artifact-commit', acceptanceArtifactCommit,
])
const acceptanceChainState = JSON.parse(readFileSync(git(acceptanceCcRoot, 'rev-parse', '--path-format=absolute', '--git-path', 'oracle-p0-1-chain-state.json'), 'utf8'))
assert.equal(Object.hasOwn(acceptanceChainState, 'repository_head_at_initialization'), false)
assert.equal(acceptanceChainState.repositories.cc_gateway.accepted_head, acceptanceArtifactCommit)
assert.equal(acceptanceChainState.repositories.sub2api.accepted_head, acceptanceSubCandidate)
const acceptanceReceipt = JSON.parse(readFileSync(path.join(acceptanceCcRoot, evidence.ARTIFACT_CHAIN.receipt), 'utf8'))
git(acceptanceCcRoot, 'add', evidence.ARTIFACT_CHAIN.receipt)
git(acceptanceCcRoot, 'commit', '-qm', 'fixture receipt only')
const acceptanceReceiptCommit = git(acceptanceCcRoot, 'rev-parse', 'HEAD')
runAcceptanceCli([
  'validate-receipt',
  '--receipt', evidence.ARTIFACT_CHAIN.receipt,
  '--artifact-commit', acceptanceArtifactCommit,
  '--receipt-commit', 'HEAD',
])
const postReceiptChainState = JSON.parse(readFileSync(git(acceptanceCcRoot, 'rev-parse', '--path-format=absolute', '--git-path', 'oracle-p0-1-chain-state.json'), 'utf8'))
assert.equal(postReceiptChainState.repositories.cc_gateway.accepted_head, acceptanceArtifactCommit)
assert.equal(postReceiptChainState.repositories.sub2api.accepted_head, acceptanceSubCandidate)
assert.equal(git(acceptanceCcRoot, 'rev-parse', `${acceptanceReceiptCommit}^`), acceptanceArtifactCommit)
assert.equal(git(acceptanceCcRoot, 'diff-tree', '--no-commit-id', '--name-status', '-r', acceptanceReceiptCommit), `A\t${evidence.ARTIFACT_CHAIN.receipt}`)
assert.equal(git(acceptanceCcRoot, 'status', '--porcelain=v1', '--untracked-files=all'), '')
assert.equal(git(acceptanceSubRoot, 'status', '--porcelain=v1', '--untracked-files=all'), '')
assert.equal(acceptanceCommands.length, 16)
assert.deepEqual([...new Set(acceptanceCommands)].sort(), [...evidence.SUPPORTED_SUBCOMMANDS].sort())
assert.equal(acceptanceCommands.filter((command) => command === 'run').length, 2)
assert.equal(acceptanceCommands.filter((command) => command === 'validate-report').length, 2)
assert.equal(acceptanceCommands.filter((command) => command === 'validate-receipt').length, 2)
const acceptanceElapsedMs = Math.ceil(Number(acceptanceAcceptedProcessElapsedNs) / 1_000_000)
const acceptanceFixtureWallElapsedMs = Date.now() - acceptanceFixtureStartedAt
const acceptanceSteadyBytes = directoryBytes(acceptanceFixtureRoot)
acceptancePeakBytes = Math.max(acceptancePeakBytes, acceptanceSteadyBytes)
assert.equal(acceptanceElapsedMs <= PRODUCTION_CLI_TIMEOUT_MS, true, `production CLI fixture ${acceptanceElapsedMs} ms exceeded ${PRODUCTION_CLI_TIMEOUT_MS} ms`)
assert.equal(acceptanceSteadyBytes < 30 * MiB, true, `production CLI fixture steady bytes ${acceptanceSteadyBytes} exceeded 30 MiB`)
assert.equal(acceptancePeakBytes < 60 * MiB, true, `production CLI fixture observed peak bytes ${acceptancePeakBytes} exceeded 60 MiB`)
console.log(canonical({
  production_cli_acceptance: {
    catalog_children: '10/10',
    codegraph: {
      cc_gateway: { edges: acceptanceCcCodeGraph.edgeCount, files: acceptanceCcCodeGraph.fileCount, nodes: acceptanceCcCodeGraph.nodeCount },
      sub2api: { edges: acceptanceSubCodeGraph.edgeCount, files: acceptanceSubCodeGraph.fileCount, nodes: acceptanceSubCodeGraph.nodeCount },
    },
    distinct_subcommands: '13/13',
    elapsed_ms: acceptanceElapsedMs,
    fixture_wall_elapsed_ms: acceptanceFixtureWallElapsedMs,
    outer_processes: '16/16',
    peak_bytes_observed: acceptancePeakBytes,
    steady_bytes: acceptanceSteadyBytes,
  },
}))

function initializeGreenCheckpoint(ccCheckpoint: string, subCheckpoint: string): void {
  initializeCaptureExitCheckpoint(ccCheckpoint, subCheckpoint)
  const captureBase = path.join(acceptanceSubRoot, 'docs/anti-ban/captures/real-baseline')
  const dateDirectories = readdirSync(captureBase).filter((name) => name.endsWith('-sub2api-cc-gateway-joint-local-capture'))
  assert.equal(dateDirectories.length, 1)
  const destinationBase = path.join(subCheckpoint, 'docs/anti-ban/captures/real-baseline')
  mkdirSync(destinationBase, { recursive: true })
  cpSync(path.join(captureBase, dateDirectories[0]), path.join(destinationBase, dateDirectories[0]), { recursive: true })
  writeFileSync(
    path.join(ccCheckpoint, evidence.ARTIFACT_CHAIN.green),
    readFileSync(path.join(acceptanceCcRoot, evidence.ARTIFACT_CHAIN.green)),
  )
  evidence.completeArtifactChainStage(ccCheckpoint, 'green', acceptanceGreenResults.terminal_ignored_inventories)
}

for (const repository of ['cc', 'sub'] as const) {
  for (const drift of ['create', 'modify', 'delete', 'type', 'mode', 'symlink-target'] as const) {
    const label = `green-red-${repository}-${drift}`
    const ccCheckpoint = cloneAcceptanceRef(label, acceptanceManifest.approval_attestation_head)
    const subCheckpoint = cloneRepositoryRef(acceptanceSubRoot, `${label}-sub`, acceptanceSubCandidate)
    initializeGreenCheckpoint(ccCheckpoint, subCheckpoint)
    applyPersistentIgnoredDrift(repository === 'cc' ? ccCheckpoint : subCheckpoint, label, drift)
    const shimBin = path.join(acceptanceFixtureRoot, `checkpoint-shim-${label}`)
    writeCatalogShims({
      directory: shimBin,
      auditLog: path.join(acceptanceFixtureRoot, `checkpoint-audit-${label}.jsonl`),
      ccRoot: ccCheckpoint,
      subRoot: subCheckpoint,
    })
    const observed = runProductionLauncherCli(ccCheckpoint, [
      'run', '--manifest', evidence.ARTIFACT_CHAIN.exit, '--catalog', catalogRelative, '--group', 'red',
      '--cc-gateway-root', ccCheckpoint, '--sub2api-root', subCheckpoint, '--out', evidence.ARTIFACT_CHAIN.red,
    ], shimBin, acceptanceTmp)
    expectProductionCliCode(observed, 'repository_mutation')
    assert.equal(existsSync(path.join(ccCheckpoint, evidence.ARTIFACT_CHAIN.red)), false)
    observeContinuityCheckpoint(ccCheckpoint, subCheckpoint)
  }
}
assert.equal(continuityCheckpointPeakBytes < 12 * MiB, true)
console.log(canonical({ production_cli_continuity_negatives: { cases: '28/28', checkpoint_peak_bytes: continuityCheckpointPeakBytes } }))

function cloneRepositoryRef(sourceRepository: string, label: string, commit: string): string {
  const branch = `fixture-${label}`
  git(sourceRepository, 'branch', branch, commit)
  const parent = mkdtempSync(path.join(tmpdir(), `oracle-p0-1-${label}-`))
  const repository = path.join(parent, 'repository')
  const isCcGateway = existsSync(path.join(sourceRepository, 'package.json'))
  const cloned = cloneSharedSparseRepository(
    sourceRepository,
    repository,
    isCcGateway ? [...CC_SPARSE_PATHS, ...CC_GENERATED_SPARSE_PATTERNS] : SUB_SPARSE_PATHS,
    branch,
  )
  if (isCcGateway) linkCloneDependencies(cloned, dependencyRoot)
  git(repository, 'config', 'user.name', 'Acceptance Topology')
  git(repository, 'config', 'user.email', 'acceptance-topology@example.invalid')
  return cloned
}

function cloneAcceptanceRef(label: string, commit: string): string {
  return cloneRepositoryRef(acceptanceCcRoot, label, commit)
}

function cloneAcceptanceProductionBranch(label: string): string {
  const parent = mkdtempSync(path.join(tmpdir(), `oracle-p0-1-${label}-`))
  const repository = cloneSharedSparseRepository(
    acceptanceCcRoot,
    path.join(parent, 'repository'),
    [...CC_SPARSE_PATHS, ...CC_GENERATED_SPARSE_PATTERNS],
  )
  linkCloneDependencies(repository, dependencyRoot)
  git(repository, 'config', 'user.name', 'Acceptance Bounded Read')
  git(repository, 'config', 'user.email', 'acceptance-bounded-read@example.invalid')
  return repository
}

function expectAcceptanceCliCode(repository: string, args: string[], code: string): void {
  expectProductionCliCode(runProductionLauncherCli(repository, args, acceptanceShimBin, acceptanceTmp), code)
}

const unsafeCliRoot = cloneAcceptanceRef('unsafe-cli-persistence', acceptanceManifest.approval_attestation_head)
const unsafeCliSubRoot = cloneRepositoryRef(acceptanceSubRoot, 'unsafe-cli-sub', acceptanceSubCandidate)
initializeCaptureExitCheckpoint(unsafeCliRoot, unsafeCliSubRoot)
const unsafeCliMarker = 'Bearer unsafe-cli-failure-name'
const unsafeShimBin = path.join(acceptanceFixtureRoot, 'unsafe-shim-bin')
writeCatalogShims({
  directory: unsafeShimBin,
  auditLog: path.join(acceptanceFixtureRoot, 'unsafe-catalog-audit.jsonl'),
  ccRoot: unsafeCliRoot,
  subRoot: unsafeCliSubRoot,
  unsafeCommandId: 'cc-build',
  unsafeMarker: unsafeCliMarker,
})
const unsafeCliResult = runProductionLauncherCli(unsafeCliRoot, [
  'run',
  '--manifest', evidence.ARTIFACT_CHAIN.exit,
  '--catalog', catalogRelative,
  '--group', 'green',
  '--cc-gateway-root', unsafeCliRoot,
  '--sub2api-root', unsafeCliSubRoot,
  '--out', evidence.ARTIFACT_CHAIN.green,
], unsafeShimBin, acceptanceTmp)
expectProductionCliCode(unsafeCliResult, 'unexpected_classification')
assert.equal(`${unsafeCliResult.stdout}${unsafeCliResult.stderr}`.includes(unsafeCliMarker), false, 'CLI process output leaked unsafe failure-name bytes')
assert.equal(existsSync(path.join(unsafeCliRoot, evidence.ARTIFACT_CHAIN.green)), false, 'unsafe result artifact must not be persisted')

const earlyJointFailureRoot = cloneAcceptanceRef('early-joint-failure', acceptanceManifest.approval_attestation_head)
const earlyJointFailureSubRoot = cloneRepositoryRef(acceptanceSubRoot, 'early-joint-failure-sub', acceptanceSubCandidate)
initializeCaptureExitCheckpoint(earlyJointFailureRoot, earlyJointFailureSubRoot)
const earlyJointFailureBefore = ignoredInventory.computeIgnoredPathInventory(earlyJointFailureSubRoot).summary
const earlyJointFailureShimBin = path.join(acceptanceFixtureRoot, 'early-joint-failure-shim-bin')
writeCatalogShims({
  directory: earlyJointFailureShimBin,
  auditLog: path.join(acceptanceFixtureRoot, 'early-joint-failure-audit.jsonl'),
  ccRoot: earlyJointFailureRoot,
  subRoot: earlyJointFailureSubRoot,
  earlyFailureCommandId: 'sub2api-joint-local-chain',
})
const earlyJointFailureResult = runProductionLauncherCli(earlyJointFailureRoot, [
  'run',
  '--manifest', evidence.ARTIFACT_CHAIN.exit,
  '--catalog', catalogRelative,
  '--group', 'green',
  '--cc-gateway-root', earlyJointFailureRoot,
  '--sub2api-root', earlyJointFailureSubRoot,
  '--out', evidence.ARTIFACT_CHAIN.green,
], earlyJointFailureShimBin, acceptanceTmp)
expectProductionCliCode(earlyJointFailureResult, 'unexpected_classification')
assert.deepEqual(ignoredInventory.computeIgnoredPathInventory(earlyJointFailureSubRoot).summary, earlyJointFailureBefore)
assert.equal(existsSync(path.join(earlyJointFailureRoot, evidence.ARTIFACT_CHAIN.green)), false)

const failedJointOutputRoot = cloneAcceptanceRef('failed-joint-output', acceptanceManifest.approval_attestation_head)
const failedJointOutputSubRoot = cloneRepositoryRef(acceptanceSubRoot, 'failed-joint-output-sub', acceptanceSubCandidate)
initializeCaptureExitCheckpoint(failedJointOutputRoot, failedJointOutputSubRoot)
const failedJointOutputStatePath = git(failedJointOutputRoot, 'rev-parse', '--path-format=absolute', '--git-path', 'oracle-p0-1-chain-state.json')
const failedJointOutputStateBefore = readFileSync(failedJointOutputStatePath)
const failedJointOutputMarker = 'joint-output-then-failure'
const failedJointOutputShimBin = path.join(acceptanceFixtureRoot, 'failed-joint-output-shim-bin')
writeCatalogShims({
  directory: failedJointOutputShimBin,
  auditLog: path.join(acceptanceFixtureRoot, 'failed-joint-output-audit.jsonl'),
  ccRoot: failedJointOutputRoot,
  subRoot: failedJointOutputSubRoot,
  unsafeCommandId: 'sub2api-joint-local-chain',
  unsafeMarker: failedJointOutputMarker,
})
const failedJointOutputResult = runProductionLauncherCli(failedJointOutputRoot, [
  'run',
  '--manifest', evidence.ARTIFACT_CHAIN.exit,
  '--catalog', catalogRelative,
  '--group', 'green',
  '--cc-gateway-root', failedJointOutputRoot,
  '--sub2api-root', failedJointOutputSubRoot,
  '--out', evidence.ARTIFACT_CHAIN.green,
], failedJointOutputShimBin, acceptanceTmp)
expectProductionCliCode(failedJointOutputResult, 'repository_mutation')
assert.equal(`${failedJointOutputResult.stdout}${failedJointOutputResult.stderr}`.includes(failedJointOutputMarker), false)
assert.equal(existsSync(path.join(failedJointOutputRoot, evidence.ARTIFACT_CHAIN.green)), false)
assert.deepEqual(readFileSync(failedJointOutputStatePath), failedJointOutputStateBefore)

function expectIgnoredMutationRejected(
  label: string,
  setup: (ccRoot: string, subRoot: string) => void,
  mutate: (ccRoot: string, subRoot: string) => ShimMutation,
): void {
  const ccRepository = cloneAcceptanceRef(`ignored-mutation-${label}`, acceptanceManifest.approval_attestation_head)
  const subRepository = cloneRepositoryRef(acceptanceSubRoot, `ignored-mutation-sub-${label}`, acceptanceSubCandidate)
  initializeCaptureExitCheckpoint(ccRepository, subRepository)
  setup(ccRepository, subRepository)
  const mutation = mutate(ccRepository, subRepository)
  const mutationShimBin = path.join(acceptanceFixtureRoot, `mutation-shim-${label}`)
  writeCatalogShims({
    directory: mutationShimBin,
    auditLog: path.join(acceptanceFixtureRoot, `mutation-audit-${label}.jsonl`),
    ccRoot: ccRepository,
    subRoot: subRepository,
    mutation,
  })
  const observed = runProductionLauncherCli(ccRepository, [
    'run', '--manifest', evidence.ARTIFACT_CHAIN.exit, '--catalog', catalogRelative, '--group', 'green',
    '--cc-gateway-root', ccRepository, '--sub2api-root', subRepository, '--out', evidence.ARTIFACT_CHAIN.green,
  ], mutationShimBin, acceptanceTmp)
  expectProductionCliCode(observed, 'repository_mutation')
  assert.equal(`${observed.stdout}${observed.stderr}`.includes('mutation-secret'), false)
}

for (const repository of ['cc', 'sub'] as const) {
  const ignoredRelative = '.codegraph/mutation-secret.txt'
  const existingIgnoredRelative = '.codegraph/codegraph.db'
  expectIgnoredMutationRejected(`${repository}-create`, () => {}, (ccRoot, subRoot) => {
    const root = repository === 'cc' ? ccRoot : subRoot
    return { kind: 'create', repositoryRoot: root, relativePath: ignoredRelative }
  })
  expectIgnoredMutationRejected(`${repository}-modify`, () => {}, (ccRoot, subRoot) => {
    return { kind: 'modify', repositoryRoot: repository === 'cc' ? ccRoot : subRoot, relativePath: existingIgnoredRelative }
  })
  expectIgnoredMutationRejected(`${repository}-delete`, () => {}, (ccRoot, subRoot) => {
    const root = repository === 'cc' ? ccRoot : subRoot
    return { kind: 'rename', repositoryRoot: root, relativePath: existingIgnoredRelative, renameTarget: path.join(acceptanceFixtureRoot, `${repository}-retained-codegraph.db`) }
  })
  expectIgnoredMutationRejected(`${repository}-symlink`, () => {}, (ccRoot, subRoot) => {
    const root = repository === 'cc' ? ccRoot : subRoot
    return { kind: 'symlink', repositoryRoot: root, relativePath: ignoredRelative }
  })
}

function writeAcceptanceReceipt(repository: string, value: unknown = acceptanceReceipt): void {
  writeFileSync(path.join(repository, evidence.ARTIFACT_CHAIN.receipt), `${canonical(value)}\n`)
}

function materializePreReceiptOutputs(repository: string): void {
  for (const artifactPath of preReceiptArtifactPaths) {
    const absolute = path.join(repository, artifactPath)
    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, execFileSync('git', ['show', `${acceptanceArtifactCommit}:${artifactPath}`], { cwd: acceptanceCcRoot, encoding: 'buffer' }))
  }
}

function rehashResultSet(value: any): void {
  for (const record of value.records) {
    const { result_digest: _recordDigest, ...recordUnsigned } = record
    record.result_digest = sha256(canonical(recordUnsigned))
  }
  const { result_set_digest: _setDigest, ...setUnsigned } = value
  value.result_set_digest = sha256(canonical(setUnsigned))
}

const mergedConsumerArguments = {
  report: [
    'report', '--manifest', evidence.ARTIFACT_CHAIN.exit, '--results', evidence.ARTIFACT_CHAIN.results,
    '--requirements-review', 'docs/superpowers/evidence/p0-1/requirements-review.json',
    '--security-review', 'docs/superpowers/evidence/p0-1/security-quality-review.json',
    '--out', evidence.ARTIFACT_CHAIN.report, '--markdown', evidence.ARTIFACT_CHAIN.report_markdown,
  ],
  controller_report: [
    'controller-report', '--manifest', evidence.ARTIFACT_CHAIN.exit, '--results', evidence.ARTIFACT_CHAIN.results,
    '--requirements-review', 'docs/superpowers/evidence/p0-1/requirements-review.json',
    '--security-review', 'docs/superpowers/evidence/p0-1/security-quality-review.json',
    '--report', evidence.ARTIFACT_CHAIN.report, '--report-markdown', evidence.ARTIFACT_CHAIN.report_markdown,
    '--out', evidence.ARTIFACT_CHAIN.controller_report, '--markdown', evidence.ARTIFACT_CHAIN.controller_report_markdown,
  ],
  context: [
    'context', '--manifest', evidence.ARTIFACT_CHAIN.exit, '--results', evidence.ARTIFACT_CHAIN.results,
    '--review-import', reviewImportRelative,
    '--requirements-review', 'docs/superpowers/evidence/p0-1/requirements-review.json',
    '--security-review', 'docs/superpowers/evidence/p0-1/security-quality-review.json',
    '--report', evidence.ARTIFACT_CHAIN.report, '--report-markdown', evidence.ARTIFACT_CHAIN.report_markdown,
    '--controller-report', evidence.ARTIFACT_CHAIN.controller_report, '--controller-report-markdown', evidence.ARTIFACT_CHAIN.controller_report_markdown,
    '--out', evidence.ARTIFACT_CHAIN.context,
  ],
  handoff: [
    'handoff', '--manifest', evidence.ARTIFACT_CHAIN.exit, '--results', evidence.ARTIFACT_CHAIN.results,
    '--context', evidence.ARTIFACT_CHAIN.context,
    '--report', evidence.ARTIFACT_CHAIN.report, '--report-markdown', evidence.ARTIFACT_CHAIN.report_markdown,
    '--controller-report', evidence.ARTIFACT_CHAIN.controller_report, '--controller-report-markdown', evidence.ARTIFACT_CHAIN.controller_report_markdown,
    '--out', evidence.ARTIFACT_CHAIN.handoff,
  ],
} as const

for (const stage of ['report', 'controller_report', 'context', 'handoff'] as const) {
  const stageRoot = cloneAcceptanceRef(`merged-consistency-${stage}`, acceptanceManifest.approval_attestation_head)
  const stageSubRoot = cloneRepositoryRef(acceptanceSubRoot, `merged-consistency-${stage}-sub`, acceptanceSubCandidate)
  const prior = evidence.STAGE_TRANSITIONS[stage].prior.map((name: keyof typeof evidence.ARTIFACT_CHAIN) => {
    const artifactPath = evidence.ARTIFACT_CHAIN[name]
    const absolute = path.join(stageRoot, artifactPath)
    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, execFileSync('git', ['show', `${acceptanceArtifactCommit}:${artifactPath}`], { cwd: acceptanceCcRoot, encoding: 'buffer' }))
    return { path: artifactPath, digest: sha256(readFileSync(absolute)) }
  })
  const mutatedResults = JSON.parse(readFileSync(path.join(stageRoot, evidence.ARTIFACT_CHAIN.results), 'utf8')) as any
  mutatedResults.records[0].duration_ms += 1
  rehashResultSet(mutatedResults)
  writeFileSync(path.join(stageRoot, evidence.ARTIFACT_CHAIN.results), `${canonical(mutatedResults)}\n`)
  const acceptedPrior = prior.map((binding: any) => binding.path === evidence.ARTIFACT_CHAIN.results
    ? { path: binding.path, digest: sha256(readFileSync(path.join(stageRoot, binding.path))) }
    : binding)
  evidence.initializeChainState(stageRoot, acceptedPrior, stageSubRoot)
  const observed = runProductionLauncherCli(stageRoot, [...mergedConsumerArguments[stage]], acceptanceShimBin, acceptanceTmp)
  expectProductionCliCode(observed, 'merged_result_mismatch')
  for (const name of evidence.STAGE_TRANSITIONS[stage].produced) assert.equal(existsSync(path.join(stageRoot, evidence.ARTIFACT_CHAIN[name])), false)
  evidence.assertChainState(stageRoot, acceptedPrior)
}

const formalStageArguments = {
  results: [
    'merge', '--manifest', evidence.ARTIFACT_CHAIN.exit, '--green', evidence.ARTIFACT_CHAIN.green,
    '--red', evidence.ARTIFACT_CHAIN.red, '--out', evidence.ARTIFACT_CHAIN.results,
  ],
  ...mergedConsumerArguments,
} as const

for (const stage of ['results', 'report', 'controller_report', 'context', 'handoff'] as const) {
  for (const changedRepository of ['cc_gateway', 'sub2api'] as const) {
    const label = `cli-head-${stage}-${changedRepository}`
    const stageRoot = cloneAcceptanceRef(label, acceptanceManifest.approval_attestation_head)
    const stageSubRoot = cloneRepositoryRef(acceptanceSubRoot, `${label}-sub`, acceptanceSubCandidate)
    const prior = evidence.STAGE_TRANSITIONS[stage].prior.map((name: keyof typeof evidence.ARTIFACT_CHAIN) => {
      const artifactPath = evidence.ARTIFACT_CHAIN[name]
      const absolute = path.join(stageRoot, artifactPath)
      mkdirSync(path.dirname(absolute), { recursive: true })
      writeFileSync(absolute, execFileSync('git', ['show', `${acceptanceArtifactCommit}:${artifactPath}`], { cwd: acceptanceCcRoot, encoding: 'buffer' }))
      return { path: artifactPath, digest: sha256(readFileSync(absolute)) }
    })
    evidence.initializeChainState(stageRoot, prior, stageSubRoot)
    const chainStatePath = git(stageRoot, 'rev-parse', '--path-format=absolute', '--git-path', 'oracle-p0-1-chain-state.json')
    const chainStateBefore = readFileSync(chainStatePath)
    git(changedRepository === 'cc_gateway' ? stageRoot : stageSubRoot, 'commit', '--allow-empty', '-qm', `wrong ${changedRepository} head`)
    expectProductionCliCode(runProductionLauncherCli(stageRoot, [...formalStageArguments[stage]], acceptanceShimBin, acceptanceTmp), 'wrong_repository_head')
    assert.equal(readFileSync(chainStatePath).equals(chainStateBefore), true)
    for (const name of evidence.STAGE_TRANSITIONS[stage].produced) assert.equal(existsSync(path.join(stageRoot, evidence.ARTIFACT_CHAIN[name])), false)
  }
}

for (const changedRepository of ['cc_gateway', 'sub2api'] as const) {
  const label = `cli-head-validate-report-${changedRepository}`
  const stageRoot = cloneAcceptanceRef(label, acceptanceManifest.approval_attestation_head)
  const stageSubRoot = cloneRepositoryRef(acceptanceSubRoot, `${label}-sub`, acceptanceSubCandidate)
  const acceptedNames = [...evidence.STAGE_TRANSITIONS.report.prior, ...evidence.STAGE_TRANSITIONS.report.produced] as Array<keyof typeof evidence.ARTIFACT_CHAIN>
  const accepted = acceptedNames.map((name) => {
    const artifactPath = evidence.ARTIFACT_CHAIN[name]
    const absolute = path.join(stageRoot, artifactPath)
    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, execFileSync('git', ['show', `${acceptanceArtifactCommit}:${artifactPath}`], { cwd: acceptanceCcRoot, encoding: 'buffer' }))
    return { path: artifactPath, digest: sha256(readFileSync(absolute)) }
  })
  evidence.initializeChainState(stageRoot, accepted, stageSubRoot)
  const chainStatePath = git(stageRoot, 'rev-parse', '--path-format=absolute', '--git-path', 'oracle-p0-1-chain-state.json')
  const chainStateBefore = readFileSync(chainStatePath)
  git(changedRepository === 'cc_gateway' ? stageRoot : stageSubRoot, 'commit', '--allow-empty', '-qm', `wrong ${changedRepository} head`)
  expectProductionCliCode(runProductionLauncherCli(stageRoot, [
    'validate-report', '--report', evidence.ARTIFACT_CHAIN.report, '--markdown', evidence.ARTIFACT_CHAIN.report_markdown,
  ], acceptanceShimBin, acceptanceTmp), 'wrong_repository_head')
  assert.equal(readFileSync(chainStatePath).equals(chainStateBefore), true)
}

function receiptArgumentsFor(artifactCommit: string): string[] {
  return [
    '--artifact-commit', artifactCommit,
    '--manifest', evidence.ARTIFACT_CHAIN.exit,
    '--results', evidence.ARTIFACT_CHAIN.results,
    '--context', evidence.ARTIFACT_CHAIN.context,
    '--handoff', evidence.ARTIFACT_CHAIN.handoff,
    '--report', evidence.ARTIFACT_CHAIN.report,
    '--report-markdown', evidence.ARTIFACT_CHAIN.report_markdown,
    '--controller-report', evidence.ARTIFACT_CHAIN.controller_report,
    '--controller-report-markdown', evidence.ARTIFACT_CHAIN.controller_report_markdown,
    '--out', evidence.ARTIFACT_CHAIN.receipt,
  ]
}

for (const changedRepository of ['cc_gateway', 'sub2api'] as const) {
  const label = `cli-head-receipt-${changedRepository}`
  const receiptRoot = cloneAcceptanceRef(label, acceptanceManifest.approval_attestation_head)
  const receiptSubRoot = cloneRepositoryRef(acceptanceSubRoot, `${label}-sub`, acceptanceSubCandidate)
  materializePreReceiptOutputs(receiptRoot)
  const prior = evidence.STAGE_TRANSITIONS.receipt.prior.map((name: keyof typeof evidence.ARTIFACT_CHAIN) => {
    const artifactPath = evidence.ARTIFACT_CHAIN[name]
    return { path: artifactPath, digest: sha256(readFileSync(path.join(receiptRoot, artifactPath))) }
  })
  evidence.initializeChainState(receiptRoot, prior, receiptSubRoot)
  git(receiptRoot, 'add', ...preReceiptArtifactPaths)
  git(receiptRoot, 'commit', '-qm', 'fixture artifact chain for wrong-head receipt')
  const artifactCommit = git(receiptRoot, 'rev-parse', 'HEAD')
  const chainStatePath = git(receiptRoot, 'rev-parse', '--path-format=absolute', '--git-path', 'oracle-p0-1-chain-state.json')
  const chainStateBefore = readFileSync(chainStatePath)
  git(changedRepository === 'cc_gateway' ? receiptRoot : receiptSubRoot, 'commit', '--allow-empty', '-qm', `wrong ${changedRepository} receipt head`)
  expectProductionCliCode(
    runProductionLauncherCli(receiptRoot, ['receipt', ...receiptArgumentsFor(artifactCommit)], acceptanceShimBin, acceptanceTmp),
    changedRepository === 'cc_gateway' ? 'wrong_artifact_commit' : 'wrong_repository_head',
  )
  assert.equal(existsSync(path.join(receiptRoot, evidence.ARTIFACT_CHAIN.receipt)), false)
  assert.equal(readFileSync(chainStatePath).equals(chainStateBefore), true)
}

function receiptForArtifact(repository: string, artifactCommit: string): unknown {
  const artifactDigests = Object.fromEntries(
    Object.keys(acceptanceReceipt.artifact_digests).map((artifactPath) => [artifactPath, sha256(readFileSync(path.join(repository, artifactPath)))]),
  )
  return evidence.buildReceiptValue({
    generatedAt: acceptanceReceipt.generated_at,
    artifactCommit,
    reviewedHeads: acceptanceReceipt.reviewed_heads,
    parentReceipts: acceptanceReceipt.parent_receipts,
    artifactDigests,
    reviewAmendment: acceptanceReceipt.review_amendment,
  })
}

for (const [label, mutate] of [
  ['stable-stdout-digest', (results: any) => { results.records[0].stdout_digest = sha256('merged-only stdout digest') }],
  ['volatile-duration', (results: any) => { results.records[0].duration_ms += 1 }],
] as const) {
  const mutationRoot = cloneAcceptanceRef(`merged-commit-${label}`, acceptanceManifest.approval_attestation_head)
  const mutationSubRoot = cloneRepositoryRef(acceptanceSubRoot, `merged-commit-${label}-sub`, acceptanceSubCandidate)
  materializePreReceiptOutputs(mutationRoot)
  const results = JSON.parse(readFileSync(path.join(mutationRoot, evidence.ARTIFACT_CHAIN.results), 'utf8')) as any
  mutate(results)
  rehashResultSet(results)
  writeFileSync(path.join(mutationRoot, evidence.ARTIFACT_CHAIN.results), `${canonical(results)}\n`)
  assert.equal(evidence.validateResultSetValue(results).ok, true)
  const prior = evidence.STAGE_TRANSITIONS.receipt.prior.map((name: keyof typeof evidence.ARTIFACT_CHAIN) => {
    const artifactPath = evidence.ARTIFACT_CHAIN[name]
    return { path: artifactPath, digest: sha256(readFileSync(path.join(mutationRoot, artifactPath))) }
  })
  evidence.initializeChainState(mutationRoot, prior, mutationSubRoot)
  git(mutationRoot, 'add', ...preReceiptArtifactPaths)
  git(mutationRoot, 'commit', '-qm', `fixture merged-only ${label} artifact`)
  const artifactCommit = git(mutationRoot, 'rev-parse', 'HEAD')
  const chainStatePath = git(mutationRoot, 'rev-parse', '--path-format=absolute', '--git-path', 'oracle-p0-1-chain-state.json')
  const chainStateBefore = readFileSync(chainStatePath)
  expectProductionCliCode(
    runProductionLauncherCli(mutationRoot, ['receipt', ...receiptArgumentsFor(artifactCommit)], acceptanceShimBin, acceptanceTmp),
    'merged_result_mismatch',
  )
  assert.equal(existsSync(path.join(mutationRoot, evidence.ARTIFACT_CHAIN.receipt)), false)
  assert.equal(readFileSync(chainStatePath).equals(chainStateBefore), true)

  writeAcceptanceReceipt(mutationRoot, receiptForArtifact(mutationRoot, artifactCommit))
  expectAcceptanceCliCode(mutationRoot, [
    'validate-receipt', '--receipt', evidence.ARTIFACT_CHAIN.receipt, '--artifact-commit', artifactCommit,
  ], 'merged_result_mismatch')
  git(mutationRoot, 'add', evidence.ARTIFACT_CHAIN.receipt)
  git(mutationRoot, 'commit', '-qm', 'fixture receipt only')
  expectAcceptanceCliCode(mutationRoot, [
    'validate-receipt', '--receipt', evidence.ARTIFACT_CHAIN.receipt, '--artifact-commit', artifactCommit, '--receipt-commit', 'HEAD',
  ], 'merged_result_mismatch')
}

function expectArtifactCommitRejected(sourceRepository: string, label: string, artifactCommit: string, code: string): void {
  const constructionRoot = cloneRepositoryRef(sourceRepository, `${label}-construction`, artifactCommit)
  expectAcceptanceCliCode(constructionRoot, ['receipt', ...receiptArgumentsFor(artifactCommit)], code)
  assert.equal(existsSync(path.join(constructionRoot, evidence.ARTIFACT_CHAIN.receipt)), false)

  const preCommitRoot = cloneRepositoryRef(sourceRepository, `${label}-pre`, artifactCommit)
  writeAcceptanceReceipt(preCommitRoot, receiptForArtifact(preCommitRoot, artifactCommit))
  expectAcceptanceCliCode(preCommitRoot, [
    'validate-receipt', '--receipt', evidence.ARTIFACT_CHAIN.receipt, '--artifact-commit', artifactCommit,
  ], code)

  const postCommitRoot = cloneRepositoryRef(sourceRepository, `${label}-post`, artifactCommit)
  writeAcceptanceReceipt(postCommitRoot, receiptForArtifact(postCommitRoot, artifactCommit))
  git(postCommitRoot, 'add', evidence.ARTIFACT_CHAIN.receipt)
  git(postCommitRoot, 'commit', '-qm', 'fixture receipt only')
  expectAcceptanceCliCode(postCommitRoot, [
    'validate-receipt', '--receipt', evidence.ARTIFACT_CHAIN.receipt, '--artifact-commit', artifactCommit, '--receipt-commit', 'HEAD',
  ], code)
}

const approvalHead = acceptanceManifest.approval_attestation_head as string
const artifactTree = git(acceptanceCcRoot, 'rev-parse', `${acceptanceArtifactCommit}^{tree}`)
const approvalTree = git(acceptanceCcRoot, 'rev-parse', `${approvalHead}^{tree}`)
const wrongArtifactParentCommit = git(acceptanceCcRoot, 'commit-tree', artifactTree, '-p', acceptanceCandidate, '-m', 'fixture wrong artifact parent')
expectArtifactCommitRejected(acceptanceCcRoot, 'wrong-artifact-parent', wrongArtifactParentCommit, 'invalid_artifact_commit_parent')

const intermediateCommit = git(acceptanceCcRoot, 'commit-tree', approvalTree, '-p', approvalHead, '-m', 'fixture intermediate commit')
const intermediateArtifactCommit = git(acceptanceCcRoot, 'commit-tree', artifactTree, '-p', intermediateCommit, '-m', 'fixture artifact after intermediate')
expectArtifactCommitRejected(acceptanceCcRoot, 'intermediate-artifact-parent', intermediateArtifactCommit, 'invalid_artifact_commit_parent')

const extraArtifactRoot = cloneAcceptanceRef('artifact-extra-source', approvalHead)
materializePreReceiptOutputs(extraArtifactRoot)
writeFileSync(path.join(extraArtifactRoot, 'artifact-extra.txt'), 'extra artifact commit path\n')
git(extraArtifactRoot, 'add', '--sparse', ...preReceiptArtifactPaths, 'artifact-extra.txt')
git(extraArtifactRoot, 'commit', '-qm', 'fixture artifact plus extra path')
const extraArtifactCommit = git(extraArtifactRoot, 'rev-parse', 'HEAD')
expectArtifactCommitRejected(extraArtifactRoot, 'artifact-extra', extraArtifactCommit, 'invalid_artifact_commit_delta')

const wrongStatusRoot = cloneAcceptanceRef('artifact-wrong-status-source', approvalHead)
materializePreReceiptOutputs(wrongStatusRoot)
git(wrongStatusRoot, 'add', evidence.ARTIFACT_CHAIN.exit)
git(wrongStatusRoot, 'commit', '-qm', 'fixture preexisting exit output')
const wrongStatusApproval = git(wrongStatusRoot, 'rev-parse', 'HEAD')
const wrongStatusManifest = JSON.parse(readFileSync(path.join(wrongStatusRoot, evidence.ARTIFACT_CHAIN.exit), 'utf8')) as any
wrongStatusManifest.approval_attestation_head = wrongStatusApproval
wrongStatusManifest.repositories.cc_gateway.head = wrongStatusApproval
const { exit_digest: _wrongStatusDigest, ...wrongStatusUnsigned } = wrongStatusManifest
wrongStatusManifest.exit_digest = sha256(canonical(wrongStatusUnsigned))
writeFileSync(path.join(wrongStatusRoot, evidence.ARTIFACT_CHAIN.exit), `${canonical(wrongStatusManifest)}\n`)
git(wrongStatusRoot, 'add', ...preReceiptArtifactPaths)
git(wrongStatusRoot, 'commit', '-qm', 'fixture modified output status')
const wrongStatusArtifactCommit = git(wrongStatusRoot, 'rev-parse', 'HEAD')
assert.match(git(wrongStatusRoot, 'diff-tree', '--no-commit-id', '--name-status', '-r', wrongStatusArtifactCommit), new RegExp(`M\\t${evidence.ARTIFACT_CHAIN.exit}`))
expectArtifactCommitRejected(wrongStatusRoot, 'artifact-wrong-status', wrongStatusArtifactCommit, 'invalid_artifact_commit_delta')

for (const [label, mutatedPath] of [
  ['registry', 'docs/superpowers/registry/oracle-lab-requirements.json'],
  ['claims', 'docs/superpowers/registry/oracle-lab-claims.json'],
  ['roadmap', 'docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md'],
  ['schema', schemaRelatives[8]],
  ['tool', toolRelative],
  ['capture-input', catalogRelative],
] as const) {
  const mutatedRoot = cloneAcceptanceRef(`artifact-${label}-source`, approvalHead)
  materializePreReceiptOutputs(mutatedRoot)
  writeFileSync(path.join(mutatedRoot, mutatedPath), `${readFileSync(path.join(mutatedRoot, mutatedPath), 'utf8')}\n`)
  git(mutatedRoot, 'add', ...preReceiptArtifactPaths, mutatedPath)
  git(mutatedRoot, 'commit', '-qm', `fixture modified ${label}`)
  const mutatedArtifactCommit = git(mutatedRoot, 'rev-parse', 'HEAD')
  assert.equal(git(mutatedRoot, 'diff-tree', '--no-commit-id', '--name-status', '-r', mutatedArtifactCommit).split('\n').includes(`M\t${mutatedPath}`), true)
  expectArtifactCommitRejected(mutatedRoot, `artifact-${label}`, mutatedArtifactCommit, 'invalid_artifact_commit_delta')
}

const manifestMismatchRoot = cloneAcceptanceRef('artifact-manifest-binding-source', approvalHead)
materializePreReceiptOutputs(manifestMismatchRoot)
const manifestMismatch = JSON.parse(readFileSync(path.join(manifestMismatchRoot, evidence.ARTIFACT_CHAIN.exit), 'utf8')) as any
manifestMismatch.governance.requirements.digest = sha256('forged-manifest-registry-binding')
const { exit_digest: _manifestMismatchDigest, ...manifestMismatchUnsigned } = manifestMismatch
manifestMismatch.exit_digest = sha256(canonical(manifestMismatchUnsigned))
writeFileSync(path.join(manifestMismatchRoot, evidence.ARTIFACT_CHAIN.exit), `${canonical(manifestMismatch)}\n`)
git(manifestMismatchRoot, 'add', ...preReceiptArtifactPaths)
git(manifestMismatchRoot, 'commit', '-qm', 'fixture manifest artifact digest mismatch')
const manifestMismatchArtifactCommit = git(manifestMismatchRoot, 'rev-parse', 'HEAD')
expectArtifactCommitRejected(manifestMismatchRoot, 'artifact-manifest-binding', manifestMismatchArtifactCommit, 'manifest_artifact_digest_mismatch')

for (const [field, value] of [
  ['source_bytes', reviewImport.transformation.source_bytes + 1],
  ['adopted_bytes', reviewImport.transformation.adopted_bytes + 1],
  ['pair_digest', sha256('forged-receipt-review-import-pair')],
] as const) {
  const preCommitRoot = cloneAcceptanceRef(`receipt-forged-${field}-pre`, acceptanceArtifactCommit)
  writeAcceptanceReceipt(preCommitRoot)
  const preCommitImport = JSON.parse(readFileSync(path.join(preCommitRoot, reviewImportRelative), 'utf8')) as any
  preCommitImport.transformation[field] = value
  writeFileSync(path.join(preCommitRoot, reviewImportRelative), `${canonical(preCommitImport)}\n`)
  expectAcceptanceCliCode(preCommitRoot, [
    'validate-receipt', '--receipt', evidence.ARTIFACT_CHAIN.receipt, '--artifact-commit', acceptanceArtifactCommit,
  ], 'invalid_review_import')

  const postCommitRoot = cloneAcceptanceRef(`receipt-forged-${field}-post`, acceptanceReceiptCommit)
  const postCommitImport = JSON.parse(readFileSync(path.join(postCommitRoot, reviewImportRelative), 'utf8')) as any
  postCommitImport.transformation[field] = value
  writeFileSync(path.join(postCommitRoot, reviewImportRelative), `${canonical(postCommitImport)}\n`)
  expectAcceptanceCliCode(postCommitRoot, [
    'validate-receipt', '--receipt', evidence.ARTIFACT_CHAIN.receipt, '--artifact-commit', acceptanceArtifactCommit, '--receipt-commit', 'HEAD',
  ], 'invalid_review_import')
}

const invalidSchemaRoot = cloneAcceptanceRef('invalid-committed-receipt-schema', acceptanceArtifactCommit)
writeFileSync(path.join(invalidSchemaRoot, schemaRelatives[5]), '{ invalid committed schema\n')
git(invalidSchemaRoot, 'add', schemaRelatives[5])
git(invalidSchemaRoot, 'commit', '-qm', 'fixture invalid committed receipt schema')
const invalidSchemaArtifactCommit = git(invalidSchemaRoot, 'rev-parse', 'HEAD')
writeAcceptanceReceipt(invalidSchemaRoot, evidence.buildReceiptValue({
  generatedAt: acceptanceReceipt.generated_at,
  artifactCommit: invalidSchemaArtifactCommit,
  reviewedHeads: acceptanceReceipt.reviewed_heads,
  parentReceipts: acceptanceReceipt.parent_receipts,
  artifactDigests: acceptanceReceipt.artifact_digests,
  reviewAmendment: acceptanceReceipt.review_amendment,
}))
expectAcceptanceCliCode(invalidSchemaRoot, [
  'validate-receipt', '--receipt', evidence.ARTIFACT_CHAIN.receipt, '--artifact-commit', invalidSchemaArtifactCommit,
], 'invalid_schema')

const wrongArtifactRoot = cloneAcceptanceRef('wrong-artifact-commit', acceptanceArtifactCommit)
writeAcceptanceReceipt(wrongArtifactRoot)
expectAcceptanceCliCode(wrongArtifactRoot, [
  'validate-receipt', '--receipt', evidence.ARTIFACT_CHAIN.receipt, '--artifact-commit', acceptanceCandidate,
], 'wrong_artifact_commit')

const artifactBytesRoot = cloneAcceptanceRef('artifact-worktree-bytes', acceptanceArtifactCommit)
writeAcceptanceReceipt(artifactBytesRoot)
writeFileSync(path.join(artifactBytesRoot, evidence.ARTIFACT_CHAIN.context), `${readFileSync(path.join(artifactBytesRoot, evidence.ARTIFACT_CHAIN.context), 'utf8')}\n`)
expectAcceptanceCliCode(artifactBytesRoot, [
  'validate-receipt', '--receipt', evidence.ARTIFACT_CHAIN.receipt, '--artifact-commit', acceptanceArtifactCommit,
], 'artifact_digest_mismatch')

const receiptTree = git(acceptanceCcRoot, 'rev-parse', `${acceptanceReceiptCommit}^{tree}`)
const wrongParentCommit = git(acceptanceCcRoot, 'commit-tree', receiptTree, '-p', acceptanceCandidate, '-m', 'fixture wrong receipt parent')
const wrongParentRoot = cloneAcceptanceRef('wrong-receipt-parent', wrongParentCommit)
expectAcceptanceCliCode(wrongParentRoot, [
  'validate-receipt', '--receipt', evidence.ARTIFACT_CHAIN.receipt, '--artifact-commit', acceptanceArtifactCommit, '--receipt-commit', 'HEAD',
], 'invalid_receipt_commit_parent')

const extraDeltaRoot = cloneAcceptanceRef('receipt-extra-delta', acceptanceArtifactCommit)
writeAcceptanceReceipt(extraDeltaRoot)
writeFileSync(path.join(extraDeltaRoot, 'receipt-extra.txt'), 'extra receipt commit path\n')
git(extraDeltaRoot, 'add', '--sparse', evidence.ARTIFACT_CHAIN.receipt, 'receipt-extra.txt')
git(extraDeltaRoot, 'commit', '-qm', 'fixture receipt plus extra path')
expectAcceptanceCliCode(extraDeltaRoot, [
  'validate-receipt', '--receipt', evidence.ARTIFACT_CHAIN.receipt, '--artifact-commit', acceptanceArtifactCommit, '--receipt-commit', 'HEAD',
], 'invalid_receipt_commit_delta')

const receiptBytesRoot = cloneAcceptanceRef('receipt-worktree-bytes', acceptanceReceiptCommit)
writeAcceptanceReceipt(receiptBytesRoot, evidence.buildReceiptValue({
  generatedAt: new Date(Date.parse(acceptanceReceipt.generated_at) + 1).toISOString(),
  artifactCommit: acceptanceArtifactCommit,
  reviewedHeads: acceptanceReceipt.reviewed_heads,
  parentReceipts: acceptanceReceipt.parent_receipts,
  artifactDigests: acceptanceReceipt.artifact_digests,
  reviewAmendment: acceptanceReceipt.review_amendment,
}))
expectAcceptanceCliCode(receiptBytesRoot, [
  'validate-receipt', '--receipt', evidence.ARTIFACT_CHAIN.receipt, '--artifact-commit', acceptanceArtifactCommit, '--receipt-commit', 'HEAD',
], 'receipt_commit_bytes_mismatch')

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

function ignoredSummary(label: string, options: { endpoints: number; regular: number; directories: number; symlinks?: number; bytes: number }): Record<string, unknown> {
  return {
    algorithm: 'git_exclude_standard_recursive_v1',
    endpoint_count: options.endpoints,
    entry_count: options.regular + options.directories + (options.symlinks ?? 0),
    regular_file_count: options.regular,
    directory_count: options.directories,
    symlink_count: options.symlinks ?? 0,
    regular_file_bytes: options.bytes,
    digest: sha256(label),
  }
}

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
    ignored_output_observations: commandId === 'sub2api-joint-local-chain'
      ? [{
          repository: 'sub2api',
          policy: 'sub2api_joint_safe_deliverable_v1',
          policy_digest: ignoredInventory.IGNORED_OUTPUT_POLICY_DIGESTS.sub2api_joint_safe_deliverable_v1,
          before: ignoredSummary('ignored-before-empty', { endpoints: 0, regular: 0, directories: 0, bytes: 0 }),
          after: ignoredSummary('ignored-after-pair', { endpoints: 1, regular: 2, directories: 2, bytes: 1_024 }),
        }]
      : [],
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
  initial_ignored_inventories: {
    cc_gateway: ignoredSummary('cc-stage-state', { endpoints: 1, regular: 1, directories: 1, bytes: 4_096 }),
    sub2api: ignoredSummary('sub-stage-state', { endpoints: 1, regular: 1, directories: 1, bytes: 4_096 }),
  },
  terminal_ignored_inventories: {
    cc_gateway: ignoredSummary('cc-stage-state', { endpoints: 1, regular: 1, directories: 1, bytes: 4_096 }),
    sub2api: ignoredSummary('sub-stage-state', { endpoints: 1, regular: 1, directories: 1, bytes: 4_096 }),
  },
}
const greenRecords = expectedCatalog.slice(0, 7).map(([id]) => resultRecord(id, 'pass', 0))
const redRecords = expectedCatalog.slice(7).map(([id]) => resultRecord(id, 'expected_fail', 'nonzero'))
const greenSet = evidence.buildResultSet({ ...resultBase, group: 'green', records: greenRecords })
const redSet = evidence.buildResultSet({ ...resultBase, group: 'red', records: redRecords })
assertCanonicalBytesEqual(greenSet, evidence.buildResultSet({ ...resultBase, group: 'green', records: structuredClone(greenRecords) }), 'GREEN result set')
assertCanonicalBytesEqual(redSet, evidence.buildResultSet({ ...resultBase, group: 'red', records: structuredClone(redRecords) }), 'RED result set')
assert.equal(evidence.validateResultSetValue(greenSet, Date.parse('2026-07-13T01:00:00.000Z')).ok, true)
assert.equal(evidence.validateResultSetValue(redSet, Date.parse('2026-07-13T01:00:00.000Z')).ok, true)
const safeUnexpectedRecords = structuredClone(greenRecords) as any[]
safeUnexpectedRecords[0].status = 'unexpected_fail'
const { result_digest: _safeUnexpectedDigest, ...safeUnexpectedUnsigned } = safeUnexpectedRecords[0]
safeUnexpectedRecords[0].result_digest = sha256(canonical(safeUnexpectedUnsigned))
const safeUnexpectedSet = evidence.buildResultSet({ ...resultBase, group: 'green', records: safeUnexpectedRecords })
assert.equal(evidence.validateResultSetValue(safeUnexpectedSet, Date.parse('2026-07-13T01:00:00.000Z')).ok, true)
const merged = evidence.mergeResultSets(greenSet, redSet, '2026-07-13T00:00:00.000Z')
assertCanonicalBytesEqual(merged, evidence.mergeResultSets(structuredClone(greenSet), structuredClone(redSet), '2026-07-13T00:00:00.000Z'), 'merged result set')
assert.equal(merged.group, 'merged')
assert.deepEqual(merged.records.map((record: any) => record.command_id), [...COMMAND_IDS_FOR_TEST('green'), ...COMMAND_IDS_FOR_TEST('red')].sort())
assert.equal(evidence.validateResultSetValue(merged, Date.parse('2026-07-13T01:00:00.000Z')).ok, true)
const mergedOnlyDurationMutation = structuredClone(merged) as any
mergedOnlyDurationMutation.records[0].duration_ms += 1
const { result_digest: _mergedOnlyRecordDigest, ...mergedOnlyRecordUnsigned } = mergedOnlyDurationMutation.records[0]
mergedOnlyDurationMutation.records[0].result_digest = sha256(canonical(mergedOnlyRecordUnsigned))
const { result_set_digest: _mergedOnlySetDigest, ...mergedOnlySetUnsigned } = mergedOnlyDurationMutation
mergedOnlyDurationMutation.result_set_digest = sha256(canonical(mergedOnlySetUnsigned))
assert.equal(evidence.validateResultSetValue(mergedOnlyDurationMutation, Date.parse('2026-07-13T01:00:00.000Z')).ok, true)
expectCode(() => evidence.validateMergedResultSetConsistency(greenSet, redSet, mergedOnlyDurationMutation), 'merged_result_mismatch')
for (const [label, mutate, rehash = true] of [
  ['output bytes', (value: any) => { value.records[0].output_bytes += 1 }],
  ['stdout digest', (value: any) => { value.records[0].stdout_digest = sha256('merged-only stdout') }],
  ['stderr digest', (value: any) => { value.records[0].stderr_digest = sha256('merged-only stderr') }],
  ['exit and status', (value: any) => { value.records[0].exit_code = 1; value.records[0].status = 'unexpected_fail' }],
  ['failure names', (value: any) => { value.records[7].failure_names = [...value.records[7].failure_names, 'MergedOnlyFailure'] }],
  ['argv digest', (value: any) => { value.records[0].argv_digest = sha256('merged-only argv') }],
  ['environment digest', (value: any) => { value.records[0].environment_digest = sha256('merged-only environment') }],
  ['catalog binding', (value: any) => { value.records[0].catalog_entry_digest = sha256('merged-only catalog') }],
  ['repository binding', (value: any) => { value.records[0].repository = 'sub2api'; value.records[0].repository_commit = '2'.repeat(40) }],
  ['execution snapshot binding', (value: any) => {
    value.records[0].execution_bindings.cc_gateway_before_snapshot = sha256('merged-only snapshot')
    value.records[0].execution_bindings.cc_gateway_after_snapshot = sha256('merged-only snapshot')
  }],
  ['ignored snapshot binding', (value: any) => {
    value.records.find((record: any) => record.command_id === 'sub2api-joint-local-chain').ignored_output_observations[0].after.digest = sha256('merged-only ignored snapshot')
  }],
  ['record ordering', (value: any) => { value.records.reverse() }],
  ['record inventory', (value: any) => { value.records.pop() }],
  ['record self digest', (value: any) => { value.records[0].result_digest = sha256('merged-only record digest') }, false],
  ['result-set self digest', (value: any) => { value.result_set_digest = sha256('merged-only result-set digest') }, false],
] as const) {
  const mutation = structuredClone(merged) as any
  mutate(mutation)
  if (rehash) rehashResultSet(mutation)
  assert.throws(() => evidence.validateMergedResultSetConsistency(greenSet, redSet, mutation), `${label} mutation must fail closed`)
}
const validateResultsSchema = ajv.compile(JSON.parse(readFileSync(path.join(root, schemaRelatives[2]), 'utf8')))
assert.equal(validateResultsSchema(merged), true, JSON.stringify(validateResultsSchema.errors))
const unknownExecutionBindingSet = structuredClone(merged) as any
unknownExecutionBindingSet.records[0].execution_bindings.surprise = sha256('surprise')
assert.equal(validateResultsSchema(unknownExecutionBindingSet), false)
const missingIgnoredObservationSet = structuredClone(merged) as any
delete missingIgnoredObservationSet.records[0].ignored_output_observations
assert.equal(validateResultsSchema(missingIgnoredObservationSet), false)
const jointObservation = (merged.records as any[]).find((record) => record.command_id === 'sub2api-joint-local-chain').ignored_output_observations[0]
for (const mutate of [
  (value: any) => { value.repository = 'cc-gateway' },
  (value: any) => { value.policy = 'none' },
  (value: any) => { value.policy_digest = sha256('wrong-policy') },
  (value: any) => { value.before.algorithm = 'wrong' },
  (value: any) => { value.before.endpoint_count += 1 },
  (value: any) => { value.before.entry_count += 1 },
  (value: any) => { value.before.regular_file_count += 1 },
  (value: any) => { value.before.directory_count += 1 },
  (value: any) => { value.before.symlink_count += 1 },
  (value: any) => { value.before.regular_file_bytes += 1 },
  (value: any) => { value.before.digest = sha256('mutated-before') },
  (value: any) => { value.after.algorithm = 'wrong' },
  (value: any) => { value.after.endpoint_count += 1 },
  (value: any) => { value.after.entry_count += 1 },
  (value: any) => { value.after.regular_file_count += 1 },
  (value: any) => { value.after.directory_count += 1 },
  (value: any) => { value.after.symlink_count += 1 },
  (value: any) => { value.after.regular_file_bytes += 1 },
  (value: any) => { value.after.digest = sha256('mutated-after') },
]) {
  const mutated = structuredClone(merged) as any
  const record = mutated.records.find((candidate: any) => candidate.command_id === 'sub2api-joint-local-chain')
  mutate(record.ignored_output_observations[0])
  assert.equal(evidence.validateResultSetValue(mutated, Date.parse('2026-07-13T01:00:00.000Z')).ok, false)
}
assert.equal(jointObservation.after.entry_count, 4)
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
const contextValueRepeat = evidence.buildContextValue({
  generatedAt: '2026-07-13T00:00:00.000Z',
  bindings: structuredClone(contextValue.bindings),
  reviewImport: structuredClone(contextValue.review_import),
  reviews: structuredClone(contextValue.reviews),
})
assertCanonicalBytesEqual(contextValue, contextValueRepeat, 'context')
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
const receiptValueRepeat = evidence.buildReceiptValue({
  generatedAt: '2026-07-13T00:00:00.000Z',
  artifactCommit: '1'.repeat(40),
  reviewedHeads: { cc_gateway: '2'.repeat(40), sub2api: '3'.repeat(40) },
  parentReceipts: structuredClone(receiptValue.parent_receipts),
  artifactDigests: structuredClone(receiptValue.artifact_digests),
})
assertCanonicalBytesEqual(receiptValue, receiptValueRepeat, 'receipt')
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
expectCliCode(runCli(revisionRoot, ['receipt', ...receiptArgumentsFor(blob)]), 'invalid_artifact_commit')
expectCliCode(runCli(revisionRoot, [
  'validate-receipt', '--receipt', evidence.ARTIFACT_CHAIN.receipt, '--artifact-commit', blob,
]), 'invalid_artifact_commit')
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
    cc_gateway: { head: '1'.repeat(40), branch: 'codex/oracle-p0-1-governance', clean: true, snapshot_digest: sha256('cc-snapshot'), initial_ignored_inventory: resultBase.initial_ignored_inventories.cc_gateway },
    sub2api: { head: '2'.repeat(40), branch: 'codex/oracle-p0-1-governance', clean: true, snapshot_digest: sha256('sub-snapshot'), initial_ignored_inventory: resultBase.initial_ignored_inventories.sub2api },
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
    launcher: launcherRelative, successor_tool: 'tools/oracle-lab/governance-amendment-evidence.ts', secure_runtime: secureRuntimeRelative, bounded_file_read: boundedFileRelative, bounded_repository_state: boundedStateRelative, ignored_path_inventory: ignoredInventoryRelative, command_catalog: 'docs/superpowers/registry/oracle-lab-governance-amendment-command-catalog.json', trusted_reviewers: trustedReviewersRelative, reviewed_toolchain: reviewedToolchainRelative, exit_schema: schemaRelatives[0], catalog_schema: schemaRelatives[1], results_schema: schemaRelatives[2], context_schema: schemaRelatives[3], handoff_schema: schemaRelatives[4], receipt_schema: schemaRelatives[5], report_schema: schemaRelatives[6], review_import_schema: schemaRelatives[7], review_schema: schemaRelatives[8], trusted_reviewers_schema: schemaRelatives[9], reviewed_toolchain_schema: schemaRelatives[10],
  }).map(([name, artifactPath]) => [name, artifact(artifactPath)])),
  codegraph: {
    cc_gateway: { version: '1.1.6', up_to_date: true, index_digest: sha256('cc-index'), file_count: 1, node_count: 1, edge_count: 1 },
    sub2api: { version: '1.1.6', up_to_date: true, index_digest: sha256('sub-index'), file_count: 1, node_count: 1, edge_count: 1 },
  },
})
const { schema_version: _exitSchema, exit_kind: _exitKind, artifact_chain: _exitChain, disabled_capabilities: _exitDisabled, exit_digest: _exitDigest, ...exitBuildOptions } = structuredClone(exitValue)
assertCanonicalBytesEqual(exitValue, evidence.buildExitValue(exitBuildOptions), 'exit manifest')
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
