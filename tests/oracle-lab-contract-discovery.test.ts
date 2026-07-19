import { strict as assert } from 'assert'
import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { finish, test } from './helpers.js'
import { resolveFormalPoolContract } from '../tools/oracle-lab/resolve-formal-pool-contract.js'

console.log('\ntests/oracle-lab-contract-discovery.test.ts')

const contractRelativePath = 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json'

function fixtureJson(nonce = 'fixture-nonce') {
  return JSON.stringify({
    materials: { context_attestation_material: 'local-safe-material' },
    account: { account_id: 'account-a' },
    client_input: { model: 'claude-sonnet-4-6' },
    valid_context: { nonce },
    cases: {},
  })
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function createRepository(root: string, branch: string, content = fixtureJson()) {
  mkdirSync(join(root, dirname(contractRelativePath)), { recursive: true })
  writeFileSync(join(root, contractRelativePath), content)
  git(root, 'init', '-q', '-b', branch)
  git(root, 'config', 'user.email', 'oracle-lab@example.invalid')
  git(root, 'config', 'user.name', 'Oracle Lab')
  git(root, 'add', contractRelativePath)
  git(root, 'commit', '-q', '-m', 'fixture')
  return { content, digest: sha256(content), head: git(root, 'rev-parse', 'HEAD') }
}

function writeManifest(gatewayRoot: string, sub2apiRoot: string, branch: string, head: string, digest: string, overrides: Record<string, unknown> = {}) {
  const manifestPath = join(gatewayRoot, 'phase-0-entry-baseline.json')
  writeFileSync(manifestPath, JSON.stringify({
    entry_kind: 'phase_0_entry',
    repositories: { sub2api: { branch, head } },
    contract: {
      repository_role: 'sub2api',
      path_category: 'sub2api_formal_pool_contract',
      repository_relative_path_base64url: Buffer.from(contractRelativePath).toString('base64url'),
      sha256: digest,
    },
    ...overrides,
  }))
  try {
    git(gatewayRoot, 'rev-parse', '--git-dir')
  } catch {
    git(gatewayRoot, 'init', '-q', '-b', 'main')
    git(gatewayRoot, 'config', 'user.email', 'oracle-lab@example.invalid')
    git(gatewayRoot, 'config', 'user.name', 'Oracle Lab')
  }
  git(gatewayRoot, 'add', 'phase-0-entry-baseline.json')
  git(gatewayRoot, 'commit', '-q', '-m', `manifest ${Date.now()}`)
  return manifestPath
}

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'oracle-contract-discovery-'))
  const gatewayRoot = join(root, 'cc-gateway')
  mkdirSync(gatewayRoot)
  return { root, gatewayRoot }
}

test('explicit contract path wins and reports explicit_env', () => {
  const { root, gatewayRoot } = workspace()
  const sub2apiRoot = join(root, 'sub2api-zhumeng-main')
  mkdirSync(sub2apiRoot)
  const repo = createRepository(sub2apiRoot, 'main')
  const result = resolveFormalPoolContract({
    explicitPath: join(sub2apiRoot, contractRelativePath),
    gatewayRoot,
    sub2apiRoot,
  })
  assert.equal(result.sourceCategory, 'explicit_env')
  assert.equal(result.digest, repo.digest)
  assert.equal(result.fixture.valid_context.nonce, 'fixture-nonce')
})

test('declared main root reports declared_root', () => {
  const { root, gatewayRoot } = workspace()
  const sub2apiRoot = join(root, 'declared-sub2api')
  mkdirSync(sub2apiRoot)
  const repo = createRepository(sub2apiRoot, 'main')
  const manifestPath = writeManifest(gatewayRoot, sub2apiRoot, 'main', repo.head, repo.digest)
  const result = resolveFormalPoolContract({ gatewayRoot, sub2apiRoot, manifestPath })
  assert.equal(result.sourceCategory, 'declared_root')
})

test('deterministic sibling repository is accepted only on main', () => {
  const { root, gatewayRoot } = workspace()
  const sub2apiRoot = join(root, 'sub2api-zhumeng-main')
  mkdirSync(sub2apiRoot)
  createRepository(sub2apiRoot, 'main')
  const result = resolveFormalPoolContract({ gatewayRoot })
  assert.equal(result.sourceCategory, 'sibling_main')
})

test('missing declared root fails closed without searching feature worktrees', () => {
  const { gatewayRoot } = workspace()
  assert.throws(() => resolveFormalPoolContract({ gatewayRoot, sub2apiRoot: join(gatewayRoot, 'missing') }), /Sub2API root|does not exist/i)
})

test('feature worktree is rejected without a matching committed manifest', () => {
  const { root, gatewayRoot } = workspace()
  const sub2apiRoot = join(root, 'feature-worktree')
  mkdirSync(sub2apiRoot)
  createRepository(sub2apiRoot, 'feature/formal-pool')
  assert.throws(() => resolveFormalPoolContract({ gatewayRoot, sub2apiRoot }), /manifest/i)
})

test('explicit feature-worktree path is rejected without an explicitly declared root', () => {
  const { root, gatewayRoot } = workspace()
  const sub2apiRoot = join(root, 'feature-worktree')
  mkdirSync(sub2apiRoot)
  const repo = createRepository(sub2apiRoot, 'feature/formal-pool')
  const manifestPath = writeManifest(gatewayRoot, sub2apiRoot, 'feature/formal-pool', repo.head, repo.digest)
  assert.throws(() => resolveFormalPoolContract({
    explicitPath: join(sub2apiRoot, contractRelativePath),
    gatewayRoot,
    manifestPath,
  }), /explicit.*root|declared.*root|sub2apiRoot/i)
})

test('explicit feature-worktree path accepts an exact pinned digest without a manifest', () => {
  const { root, gatewayRoot } = workspace()
  const sub2apiRoot = join(root, 'feature-worktree')
  mkdirSync(sub2apiRoot)
  const repo = createRepository(sub2apiRoot, 'feature/formal-pool')
  const result = resolveFormalPoolContract({
    explicitPath: join(sub2apiRoot, contractRelativePath),
    gatewayRoot,
    expectedDigest: repo.digest,
  })
  assert.equal(result.sourceCategory, 'explicit_env')
  assert.equal(result.digest, repo.digest)
})

test('declared feature worktree requires matching role path category HEAD branch digest and realpath', () => {
  const { root, gatewayRoot } = workspace()
  const sub2apiRoot = join(root, 'feature-worktree')
  mkdirSync(sub2apiRoot)
  const repo = createRepository(sub2apiRoot, 'feature/formal-pool')
  const manifestPath = writeManifest(gatewayRoot, sub2apiRoot, 'feature/formal-pool', repo.head, repo.digest)
  const result = resolveFormalPoolContract({ gatewayRoot, sub2apiRoot, manifestPath })
  assert.equal(result.sourceCategory, 'declared_worktree')

  let invalid = writeManifest(gatewayRoot, sub2apiRoot, 'feature/formal-pool', repo.head, repo.digest, { contract: { path_category: 'sub2api_formal_pool_contract', repository_relative_path_base64url: Buffer.from(contractRelativePath).toString('base64url'), sha256: repo.digest } })
  assert.throws(() => resolveFormalPoolContract({ gatewayRoot, sub2apiRoot, manifestPath: invalid }), /contract role|repository_role|Sub2API/i)
  invalid = writeManifest(gatewayRoot, sub2apiRoot, 'feature/formal-pool', repo.head, repo.digest, { contract: { repository_role: 'cc_gateway', path_category: 'sub2api_formal_pool_contract', repository_relative_path_base64url: Buffer.from(contractRelativePath).toString('base64url'), sha256: repo.digest } })
  assert.throws(() => resolveFormalPoolContract({ gatewayRoot, sub2apiRoot, manifestPath: invalid }), /contract role|repository_role|Sub2API/i)

  invalid = writeManifest(gatewayRoot, sub2apiRoot, 'feature/formal-pool', repo.head, repo.digest, { repositories: { wrong_role: { branch: 'feature/formal-pool', head: repo.head } } })
  assert.throws(() => resolveFormalPoolContract({ gatewayRoot, sub2apiRoot, manifestPath: invalid }), /role/i)
  invalid = writeManifest(gatewayRoot, sub2apiRoot, 'feature/formal-pool', repo.head, repo.digest, { contract: { repository_role: 'sub2api', path_category: 'wrong', repository_relative_path_base64url: Buffer.from(contractRelativePath).toString('base64url'), sha256: repo.digest } })
  assert.throws(() => resolveFormalPoolContract({ gatewayRoot, sub2apiRoot, manifestPath: invalid }), /path category/i)
  invalid = writeManifest(gatewayRoot, sub2apiRoot, 'feature/formal-pool', '0'.repeat(40), repo.digest)
  assert.throws(() => resolveFormalPoolContract({ gatewayRoot, sub2apiRoot, manifestPath: invalid }), /HEAD/i)
  invalid = writeManifest(gatewayRoot, sub2apiRoot, 'wrong', repo.head, repo.digest)
  assert.throws(() => resolveFormalPoolContract({ gatewayRoot, sub2apiRoot, manifestPath: invalid }), /branch/i)
  invalid = writeManifest(gatewayRoot, sub2apiRoot, 'feature/formal-pool', repo.head, '0'.repeat(64))
  assert.throws(() => resolveFormalPoolContract({ gatewayRoot, sub2apiRoot, manifestPath: invalid }), /digest/i)
  invalid = writeManifest(gatewayRoot, sub2apiRoot, 'feature/formal-pool', repo.head, repo.digest, { repositories: { sub2api: { branch: 'feature/formal-pool', head: repo.head, root_realpath: join(root, 'other') } } })
  assert.throws(() => resolveFormalPoolContract({ gatewayRoot, sub2apiRoot, manifestPath: invalid }), /realpath/i)
})

test('symlinked contract escaping the declared root is rejected', () => {
  const { root, gatewayRoot } = workspace()
  const sub2apiRoot = join(root, 'declared-sub2api')
  const outside = join(root, 'outside.json')
  mkdirSync(join(sub2apiRoot, dirname(contractRelativePath)), { recursive: true })
  writeFileSync(outside, fixtureJson())
  symlinkSync(outside, join(sub2apiRoot, contractRelativePath))
  git(sub2apiRoot, 'init', '-q', '-b', 'main')
  assert.throws(() => resolveFormalPoolContract({ gatewayRoot, sub2apiRoot }), /escape|outside|symlink/i)
})

test('expected digest tightens manifest validation and digest changes are rejected in one process', () => {
  const { root, gatewayRoot } = workspace()
  const sub2apiRoot = join(root, 'declared-sub2api')
  mkdirSync(sub2apiRoot)
  const repo = createRepository(sub2apiRoot, 'main')
  const contractPath = join(sub2apiRoot, contractRelativePath)
  assert.throws(() => resolveFormalPoolContract({ gatewayRoot, sub2apiRoot, expectedDigest: '0'.repeat(64) }), /digest/i)
  resolveFormalPoolContract({ gatewayRoot, sub2apiRoot, expectedDigest: repo.digest })
  writeFileSync(contractPath, fixtureJson('changed'))
  assert.throws(() => resolveFormalPoolContract({ gatewayRoot, sub2apiRoot }), /changed.*process|digest/i)
})

await finish()
