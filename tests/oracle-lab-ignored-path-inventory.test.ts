import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, renameSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  DEFAULT_IGNORED_INVENTORY_LIMITS,
  IGNORED_INVENTORY_ALGORITHM,
  IGNORED_OUTPUT_POLICY_DIGESTS,
  compareIgnoredPathInventories,
  computeIgnoredPathInventory,
  type IgnoredPathInventory,
} from '../tools/oracle-lab/ignored-path-inventory.js'

type Flavor = 'cc_gateway' | 'sub2api'

function git(repository: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.equal((error as { code?: string }).code, code)
    return true
  })
}

function fixture(label: string, flavor: Flavor): string {
  const repository = mkdtempSync(path.join(tmpdir(), `oracle-p0-1-ignored-${flavor}-${label}-`))
  git(repository, 'init', '-q')
  git(repository, 'config', 'user.email', 'oracle@example.invalid')
  git(repository, 'config', 'user.name', 'Oracle Test')
  const rules = flavor === 'cc_gateway'
    ? ['node_modules/', 'dist/', '.codegraph/', '.superpowers/sdd/', '.env', 'config.yaml', 'certs/', 'clients/', 'runtime/', 'ignored/']
    : ['node_modules/', 'dist/', '.codegraph/', '.superpowers/', '.env', 'config.yaml', 'certs/', 'clients/', 'runtime/', 'ignored/', 'docs/anti-ban/captures/real-baseline/*-sub2api-cc-gateway-joint-local-capture/']
  writeFileSync(path.join(repository, '.gitignore'), `${rules.join('\n')}\n`)
  writeFileSync(path.join(repository, 'tracked.txt'), 'tracked\n')
  if (flavor === 'cc_gateway') {
    mkdirSync(path.join(repository, '.superpowers'), { recursive: true })
    writeFileSync(path.join(repository, '.superpowers/tracked.txt'), 'tracked parent anchor\n')
  } else {
    mkdirSync(path.join(repository, 'docs/anti-ban/captures/real-baseline'), { recursive: true })
    writeFileSync(path.join(repository, 'docs/anti-ban/captures/real-baseline/tracked.txt'), 'tracked parent anchor\n')
  }
  git(repository, 'add', '.gitignore', 'tracked.txt', ...(flavor === 'cc_gateway'
    ? ['.superpowers/tracked.txt']
    : ['docs/anti-ban/captures/real-baseline/tracked.txt']))
  git(repository, 'commit', '-qm', 'fixture')
  mkdirSync(path.join(repository, 'ignored'), { recursive: true })
  writeFileSync(path.join(repository, 'ignored/seed.txt'), 'seed\n')
  return repository
}

function inventory(repository: string): IgnoredPathInventory {
  return computeIgnoredPathInventory(repository)
}

function expectNoAllowanceDrift(before: IgnoredPathInventory, after: IgnoredPathInventory): void {
  expectCode(
    () => compareIgnoredPathInventories(before, after, 'none', new Date('2026-07-13T10:00:00'), new Date('2026-07-13T10:01:00')),
    'repository_mutation',
  )
}

for (const flavor of ['cc_gateway', 'sub2api'] as const) {
  const stableRoot = fixture('stable', flavor)
  const stableOne = inventory(stableRoot)
  const stableTwo = inventory(stableRoot)
  assert.deepEqual(stableOne.summary, stableTwo.summary)
  assert.equal(stableOne.summary.algorithm, IGNORED_INVENTORY_ALGORITHM)
  assert.equal(JSON.stringify(stableOne), JSON.stringify({ summary: stableOne.summary }))

  const rewriteRoot = fixture('identical-rewrite', flavor)
  const rewriteBefore = inventory(rewriteRoot)
  writeFileSync(path.join(rewriteRoot, 'ignored/seed.txt'), 'seed\n')
  utimesSync(path.join(rewriteRoot, 'ignored/seed.txt'), new Date('2026-07-13T01:00:00Z'), new Date('2026-07-13T01:00:00Z'))
  assert.deepEqual(inventory(rewriteRoot).summary, rewriteBefore.summary)

  const createRoot = fixture('create', flavor)
  const createBefore = inventory(createRoot)
  writeFileSync(path.join(createRoot, 'ignored/created.txt'), 'created\n')
  expectNoAllowanceDrift(createBefore, inventory(createRoot))

  const modifyRoot = fixture('modify', flavor)
  const modifyBefore = inventory(modifyRoot)
  writeFileSync(path.join(modifyRoot, 'ignored/seed.txt'), 'mutated\n')
  expectNoAllowanceDrift(modifyBefore, inventory(modifyRoot))

  const deleteRoot = fixture('delete', flavor)
  const deleteBefore = inventory(deleteRoot)
  renameSync(path.join(deleteRoot, 'ignored/seed.txt'), path.join(path.dirname(deleteRoot), `${path.basename(deleteRoot)}-retained-seed.txt`))
  expectNoAllowanceDrift(deleteBefore, inventory(deleteRoot))

  const typeRoot = fixture('type', flavor)
  const typeBefore = inventory(typeRoot)
  renameSync(path.join(typeRoot, 'ignored/seed.txt'), path.join(path.dirname(typeRoot), `${path.basename(typeRoot)}-retained-type.txt`))
  symlinkSync('../tracked.txt', path.join(typeRoot, 'ignored/seed.txt'))
  expectNoAllowanceDrift(typeBefore, inventory(typeRoot))

  const symlinkRoot = fixture('symlink-target', flavor)
  writeFileSync(path.join(symlinkRoot, 'ignored/target-a.txt'), 'same target bytes\n')
  writeFileSync(path.join(symlinkRoot, 'ignored/target-b.txt'), 'same target bytes\n')
  symlinkSync('target-a.txt', path.join(symlinkRoot, 'ignored/link'))
  const symlinkBefore = inventory(symlinkRoot)
  renameSync(path.join(symlinkRoot, 'ignored/link'), path.join(path.dirname(symlinkRoot), `${path.basename(symlinkRoot)}-retained-link`))
  symlinkSync('target-b.txt', path.join(symlinkRoot, 'ignored/link'))
  expectNoAllowanceDrift(symlinkBefore, inventory(symlinkRoot))

  const directoryRoot = fixture('empty-directory', flavor)
  const directoryBefore = inventory(directoryRoot)
  mkdirSync(path.join(directoryRoot, 'ignored/empty'))
  const directoryAfterCreate = inventory(directoryRoot)
  expectNoAllowanceDrift(directoryBefore, directoryAfterCreate)
  renameSync(path.join(directoryRoot, 'ignored/empty'), path.join(path.dirname(directoryRoot), `${path.basename(directoryRoot)}-retained-empty`))
  assert.deepEqual(inventory(directoryRoot).summary, directoryBefore.summary)

  for (const endpoint of ['node_modules/pkg/index.js', 'dist/index.js', '.codegraph/graph.db', '.superpowers/sdd/private.md', '.env', 'config.yaml', 'certs/client.pem', 'clients/client.json', 'runtime/state.json']) {
    const endpointRoot = fixture(`endpoint-${endpoint.replace(/[^a-z]/gi, '-')}`, flavor)
    const endpointBefore = inventory(endpointRoot)
    mkdirSync(path.dirname(path.join(endpointRoot, endpoint)), { recursive: true })
    writeFileSync(path.join(endpointRoot, endpoint), 'sensitive ignored bytes\n')
    expectNoAllowanceDrift(endpointBefore, inventory(endpointRoot))
  }
}

const exclusionRoot = fixture('info-exclude', 'cc_gateway')
const exclusionBefore = inventory(exclusionRoot)
writeFileSync(path.join(exclusionRoot, '.git/info/exclude'), 'private-output/\n')
mkdirSync(path.join(exclusionRoot, 'private-output'))
writeFileSync(path.join(exclusionRoot, 'private-output/data.bin'), 'excluded by info/exclude\n')
assert.notEqual(inventory(exclusionRoot).summary.digest, exclusionBefore.summary.digest)

const nonUtfRoot = fixture('non-utf8', 'cc_gateway')
const rawName = Buffer.from([0x72, 0x61, 0x77, 0x2d, 0xff])
try {
  writeFileSync(Buffer.concat([Buffer.from(nonUtfRoot), Buffer.from('/ignored/'), rawName]), 'ORACLE_SECRET_CANARY_IGNORED\n')
} catch (error) {
  assert.equal((error as NodeJS.ErrnoException).code, 'EILSEQ')
  writeFileSync(Buffer.concat([Buffer.from(nonUtfRoot), Buffer.from('/ignored/raw-e\u0301')]), 'ORACLE_SECRET_CANARY_IGNORED\n')
}
const nonUtfOne = inventory(nonUtfRoot)
const nonUtfTwo = inventory(nonUtfRoot)
assert.deepEqual(nonUtfOne.summary, nonUtfTwo.summary)
const serializedInventory = JSON.stringify(nonUtfOne)
assert.equal(serializedInventory.includes(nonUtfRoot), false)
assert.equal(serializedInventory.includes('ORACLE_SECRET_CANARY_IGNORED'), false)
assert.equal(serializedInventory.includes('raw-'), false)

const endpointLimitRoot = fixture('endpoint-limit', 'cc_gateway')
mkdirSync(path.join(endpointLimitRoot, 'dist'))
writeFileSync(path.join(endpointLimitRoot, 'dist/output.js'), 'output\n')
expectCode(() => computeIgnoredPathInventory(endpointLimitRoot, { ...DEFAULT_IGNORED_INVENTORY_LIMITS, maxEndpointRoots: 1 }), 'ignored_inventory_limit_exceeded')
const entryLimitRoot = fixture('entry-limit', 'cc_gateway')
expectCode(() => computeIgnoredPathInventory(entryLimitRoot, { ...DEFAULT_IGNORED_INVENTORY_LIMITS, maxEntries: 1 }), 'ignored_inventory_limit_exceeded')
const byteLimitRoot = fixture('byte-limit', 'cc_gateway')
expectCode(() => computeIgnoredPathInventory(byteLimitRoot, { ...DEFAULT_IGNORED_INVENTORY_LIMITS, maxRegularFileBytes: 4 }), 'ignored_inventory_limit_exceeded')
const hardByteLimitRoot = fixture('hard-byte-limit', 'cc_gateway')
writeFileSync(path.join(hardByteLimitRoot, 'ignored/oversized.bin'), '')
truncateSync(path.join(hardByteLimitRoot, 'ignored/oversized.bin'), DEFAULT_IGNORED_INVENTORY_LIMITS.maxRegularFileBytes + 1)
expectCode(() => inventory(hardByteLimitRoot), 'ignored_inventory_limit_exceeded')

const SAFE_ROOT = 'docs/anti-ban/captures/real-baseline'
const DATE = '2026-07-13'
const DATE_DIRECTORY = `${DATE}-sub2api-cc-gateway-joint-local-capture`
const SAFE_DIRECTORY = `${SAFE_ROOT}/${DATE_DIRECTORY}/safe-deliverable`

function policyFixture(label: string): string {
  return fixture(`policy-${label}`, 'sub2api')
}

function writePair(repository: string, options: { date?: string; readmeBytes?: number; summaryBytes?: number } = {}): void {
  const date = options.date ?? DATE
  const directory = path.join(repository, SAFE_ROOT, `${date}-sub2api-cc-gateway-joint-local-capture`, 'safe-deliverable')
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, 'README.md'), Buffer.alloc(options.readmeBytes ?? 16, 0x52))
  writeFileSync(path.join(directory, 'joint_local_capture_summary.redacted.json'), Buffer.alloc(options.summaryBytes ?? 32, 0x4a))
}

function compareJoint(before: IgnoredPathInventory, after: IgnoredPathInventory, started = new Date('2026-07-13T23:58:00'), finished = new Date('2026-07-13T23:59:00')) {
  return compareIgnoredPathInventories(before, after, 'sub2api_joint_safe_deliverable_v1', started, finished)
}

const policyCreateRoot = policyFixture('create')
const policyCreateBefore = inventory(policyCreateRoot)
writePair(policyCreateRoot)
const policyCreateTransition = compareJoint(policyCreateBefore, inventory(policyCreateRoot))
assert.deepEqual(policyCreateTransition.before_protected, policyCreateTransition.after_protected)
assert.equal(policyCreateTransition.observation?.policy_digest, IGNORED_OUTPUT_POLICY_DIGESTS.sub2api_joint_safe_deliverable_v1)
assert.equal(policyCreateTransition.observation?.before.entry_count, 0)
assert.equal(policyCreateTransition.observation?.after.entry_count, 4)
assert.equal(JSON.stringify(policyCreateTransition).includes(SAFE_ROOT), false)

const policyRewriteRoot = policyFixture('rewrite')
writePair(policyRewriteRoot)
const policyRewriteBefore = inventory(policyRewriteRoot)
writeFileSync(path.join(policyRewriteRoot, SAFE_DIRECTORY, 'README.md'), 'rewritten readme\n')
writeFileSync(path.join(policyRewriteRoot, SAFE_DIRECTORY, 'joint_local_capture_summary.redacted.json'), '{"rewritten":true}\n')
assert.equal(compareJoint(policyRewriteBefore, inventory(policyRewriteRoot)).observation?.after.regular_file_count, 2)

for (const [label, relative, mode] of [
  ['date-directory', `${SAFE_ROOT}/${DATE_DIRECTORY}`, 0o700],
  ['safe-directory', SAFE_DIRECTORY, 0o700],
  ['readme', `${SAFE_DIRECTORY}/README.md`, 0o755],
  ['summary', `${SAFE_DIRECTORY}/joint_local_capture_summary.redacted.json`, 0o755],
] as const) {
  const repository = policyFixture(`mode-${label}`)
  writePair(repository)
  const before = inventory(repository)
  chmodSync(path.join(repository, relative), mode)
  expectCode(() => compareJoint(before, inventory(repository)), 'repository_mutation')
}

for (const [label, mutate] of [
  ['one-file', (repository: string) => {
    const directory = path.join(repository, SAFE_DIRECTORY); mkdirSync(directory, { recursive: true }); writeFileSync(path.join(directory, 'README.md'), 'only one\n')
  }],
  ['third-file', (repository: string) => { writePair(repository); writeFileSync(path.join(repository, SAFE_DIRECTORY, 'third.txt'), 'third\n') }],
  ['wrong-leaf', (repository: string) => {
    const directory = path.join(repository, SAFE_DIRECTORY); mkdirSync(directory, { recursive: true }); writeFileSync(path.join(directory, 'README.md'), 'readme\n'); writeFileSync(path.join(directory, 'summary.json'), '{}\n')
  }],
  ['wrong-date', (repository: string) => writePair(repository, { date: '2026-07-12' })],
  ['oversized-readme', (repository: string) => writePair(repository, { readmeBytes: 131_073 })],
  ['oversized-summary', (repository: string) => writePair(repository, { summaryBytes: 262_145 })],
] as const) {
  const repository = policyFixture(label)
  const before = inventory(repository)
  mutate(repository)
  expectCode(() => compareJoint(before, inventory(repository)), 'repository_mutation')
}

const policyDeleteRoot = policyFixture('delete')
writePair(policyDeleteRoot)
const policyDeleteBefore = inventory(policyDeleteRoot)
renameSync(path.join(policyDeleteRoot, SAFE_DIRECTORY, 'README.md'), path.join(path.dirname(policyDeleteRoot), `${path.basename(policyDeleteRoot)}-retained-readme.md`))
expectCode(() => compareJoint(policyDeleteBefore, inventory(policyDeleteRoot)), 'repository_mutation')

const policySymlinkLeafRoot = policyFixture('symlink-leaf')
const policySymlinkLeafBefore = inventory(policySymlinkLeafRoot)
writePair(policySymlinkLeafRoot)
renameSync(path.join(policySymlinkLeafRoot, SAFE_DIRECTORY, 'README.md'), path.join(path.dirname(policySymlinkLeafRoot), `${path.basename(policySymlinkLeafRoot)}-retained-readme.md`))
symlinkSync('../../../../../../../tracked.txt', path.join(policySymlinkLeafRoot, SAFE_DIRECTORY, 'README.md'))
expectCode(() => compareJoint(policySymlinkLeafBefore, inventory(policySymlinkLeafRoot)), 'repository_mutation')

const policySymlinkParentRoot = policyFixture('symlink-parent')
const policySymlinkParentBefore = inventory(policySymlinkParentRoot)
const retainedSafeDirectory = path.join(path.dirname(policySymlinkParentRoot), `${path.basename(policySymlinkParentRoot)}-retained-safe`)
mkdirSync(retainedSafeDirectory)
writeFileSync(path.join(retainedSafeDirectory, 'README.md'), 'readme\n')
writeFileSync(path.join(retainedSafeDirectory, 'joint_local_capture_summary.redacted.json'), '{}\n')
const dateParent = path.join(policySymlinkParentRoot, SAFE_ROOT, DATE_DIRECTORY)
mkdirSync(dateParent, { recursive: true })
symlinkSync(retainedSafeDirectory, path.join(dateParent, 'safe-deliverable'), 'dir')
expectCode(() => compareJoint(policySymlinkParentBefore, inventory(policySymlinkParentRoot)), 'repository_mutation')

const policyOutsideRoot = policyFixture('outside-change')
const policyOutsideBefore = inventory(policyOutsideRoot)
writePair(policyOutsideRoot)
writeFileSync(path.join(policyOutsideRoot, 'ignored/outside.txt'), 'outside\n')
expectCode(() => compareJoint(policyOutsideBefore, inventory(policyOutsideRoot)), 'repository_mutation')

const policySecondDateRoot = policyFixture('second-date')
const policySecondDateBefore = inventory(policySecondDateRoot)
writePair(policySecondDateRoot, { date: '2026-07-13' })
writePair(policySecondDateRoot, { date: '2026-07-14' })
expectCode(
  () => compareIgnoredPathInventories(policySecondDateBefore, inventory(policySecondDateRoot), 'sub2api_joint_safe_deliverable_v1', new Date('2026-07-13T23:59:00'), new Date('2026-07-14T00:01:00')),
  'repository_mutation',
)

const policyMidnightRoot = policyFixture('midnight')
const policyMidnightBefore = inventory(policyMidnightRoot)
writePair(policyMidnightRoot, { date: '2026-07-14' })
assert.ok(compareIgnoredPathInventories(policyMidnightBefore, inventory(policyMidnightRoot), 'sub2api_joint_safe_deliverable_v1', new Date('2026-07-13T23:59:00'), new Date('2026-07-14T00:01:00')).observation)

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname)
const buildBefore = inventory(projectRoot)
execFileSync('npm', ['run', 'build'], { cwd: projectRoot, env: { ...process.env, npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false' }, stdio: 'pipe' })
const buildAfter = inventory(projectRoot)
assert.deepEqual(
  compareIgnoredPathInventories(buildBefore, buildAfter, 'none', new Date('2026-07-13T00:00:00'), new Date('2026-07-13T00:01:00')),
  { before_protected: buildBefore.summary, after_protected: buildAfter.summary },
)

console.log('oracle-lab ignored path inventory tests passed')
