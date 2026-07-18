import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const toolPath = path.join(root, 'tools/oracle-lab/phase-1-authority-restart.ts')
const schemaPath = path.join(root, 'docs/superpowers/schemas/oracle-lab-phase-1-authority-restart.schema.json')

assert.equal(existsSync(schemaPath), true)
assert.equal(existsSync(toolPath), true)

const tool = await import(pathToFileURL(toolPath).href)
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
const validateSchema = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema)

type ChildResult = Readonly<{ status: number | null; stdout: string; stderr: string }>

function authorityCacheRoots(): Set<string> {
  return new Set(readdirSync('/tmp').filter((entry) => entry.startsWith('oracle-phase1-authority-npm-cache.')))
}

async function runLauncherWithPostVerificationRace(
  repositoryRoot: string,
  argv: readonly string[],
  mutateLiveRuntime: () => void,
): Promise<ChildResult> {
  const before = authorityCacheRoots()
  const child = spawn(path.join(repositoryRoot, 'tools/oracle-lab/oracle-phase1-authority-restart'), argv, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const completion = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if ([...authorityCacheRoots()].some((entry) => !before.has(entry))) break
    if (child.exitCode !== null) throw new Error(`authority launcher exited before the post-verification race window: ${stderr}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  if (![...authorityCacheRoots()].some((entry) => !before.has(entry))) {
    child.kill('SIGTERM')
    throw new Error('authority launcher did not reach the post-verification race window')
  }

  mutateLiveRuntime()
  const status = await completion
  return Object.freeze({ status, stdout, stderr })
}

function git(repository: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repository,
    encoding: 'utf8',
    env: {
      HOME: '/dev/null',
      PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
      LANG: 'C',
      LC_ALL: 'C',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_COUNT: '0',
      GIT_NO_REPLACE_OBJECTS: '1',
    },
  }).trim()
}

function cloneRepository(source: string, destination: string): void {
  execFileSync('git', ['clone', '--shared', '--quiet', source, destination], { stdio: 'pipe' })
}

function bindReviewedToolUpstream(repository: string): void {
  const branch = git(repository, 'branch', '--show-current')
  assert.notEqual(branch, '')
  try { git(repository, 'remote', 'add', 'muqihang', 'https://github.com/muqihang/cc-gateway.git') }
  catch { git(repository, 'remote', 'set-url', 'muqihang', 'https://github.com/muqihang/cc-gateway.git') }
  git(repository, 'update-ref', `refs/remotes/muqihang/${branch}`, git(repository, 'rev-parse', 'HEAD'))
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function write(repository: string, relative: string, content: string): void {
  const target = path.join(repository, relative)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function commit(repository: string, message: string, changes: Record<string, string>): string {
  for (const [relative, content] of Object.entries(changes)) write(repository, relative, content)
  git(repository, 'add', '--', ...Object.keys(changes))
  git(repository, 'commit', '-qm', message)
  return git(repository, 'rev-parse', 'HEAD')
}

function init(repository: string): string {
  mkdirSync(repository, { recursive: true })
  git(repository, 'init', '-q')
  git(repository, 'config', 'user.email', 'oracle@example.invalid')
  git(repository, 'config', 'user.name', 'Oracle Test')
  write(repository, '.gitignore', '.codegraph/\n')
  write(repository, 'app/common.txt', 'common\n')
  git(repository, 'add', '.')
  git(repository, 'commit', '-qm', 'common base')
  return git(repository, 'rev-parse', 'HEAD')
}

function fixture(options: { projectedTupleDrift?: boolean; extraCcAuthorizedBase?: boolean; extraSubAuthorizedBase?: boolean; skippedAuthorityGap?: boolean } = {}) {
  const parent = mkdtempSync(path.join(tmpdir(), 'oracle-phase1-authority-restart-'))
  const cc = path.join(parent, 'cc')
  const sub = path.join(parent, 'sub')
  const ccCommon = init(cc)
  const subCommon = init(sub)
  const repairPaths = ['authority/execution-context.schema.json', 'authority/plan.md']
  const historicalPaths = ['authority/review.json', 'authority/context.json', 'authority/restart-old.json']

  git(cc, 'checkout', '-qb', 'cc-archive')
  const ccSourceAuthority = commit(cc, 'old authority', {
    'authority/plan.md': 'old plan\n',
    'authority/execution-context.schema.json': 'old execution schema\n',
    'authority/review.json': 'old review\n',
    'authority/context.json': 'old context\n',
  })
  const ccSource1 = commit(cc, 'task six one', { 'app/task6-a.txt': 'alpha\n' })
  const skippedAuthorityCommit = options.skippedAuthorityGap
    ? commit(cc, 'historical restart authority', { 'authority/restart-old.json': 'historical\n' })
    : null
  git(cc, 'mv', 'app/task6-a.txt', 'app/task6-renamed.txt')
  const ccSource2 = commit(cc, 'task six two', { 'app/task6-b.txt': 'beta\n' })
  const checkpoint = commit(cc, 'task seven quarantine', { 'app/task7.txt': 'quarantine\n' })

  git(cc, 'checkout', '-qb', 'codex/oracle-phase-1-cc-gateway', ccCommon)
  const ccPlanMain = commit(cc, 'new plan', {
    'authority/execution-context.schema.json': 'new execution schema\n',
    'authority/plan.md': 'new plan\n',
  })
  const replacementAuthorityChanges: Record<string, string> = {
    'authority/review.json': 'new review\n',
    'authority/context.json': 'new context\n',
  }
  if (options.projectedTupleDrift) replacementAuthorityChanges['app/projected-drift.txt'] = 'drift\n'
  const ccContextCommit = commit(cc, 'new authority', replacementAuthorityChanges)
  const ccReplacementBase = options.extraCcAuthorizedBase
    ? commit(cc, 'unauthorized excluded base delta', { 'authority/tool.ts': 'unreviewed\n' })
    : ccContextCommit
  const ccReplacement1 = commit(cc, 'replay task six one', { 'app/task6-a.txt': 'alpha\n' })
  git(cc, 'mv', 'app/task6-a.txt', 'app/task6-renamed.txt')
  const ccReplacement2 = commit(cc, 'replay task six two', { 'app/task6-b.txt': 'beta\n' })
  const ccReplacement3 = commit(cc, 'replay task seven quarantine', { 'app/task7.txt': 'quarantine\n' })

  git(sub, 'checkout', '-qb', 'sub-archive')
  const subSource1 = commit(sub, 'task one', { 'service/task1.txt': 'one\n' })
  const subSource2 = commit(sub, 'task two', { 'service/task2.txt': 'two\n' })
  git(sub, 'checkout', '-qb', 'codex/oracle-phase-1-sub2api', subCommon)
  const subReplacementBase = options.extraSubAuthorizedBase
    ? commit(sub, 'unauthorized sub base delta', { 'authority/tool.ts': 'unreviewed\n' })
    : subCommon
  const subReplacement1 = commit(sub, 'replay task one', { 'service/task1.txt': 'one\n' })
  const subReplacement2 = commit(sub, 'replay task two', { 'service/task2.txt': 'two\n' })

  for (const repository of [cc, sub]) {
    git(repository, 'remote', 'add', 'muqihang', `https://example.invalid/${path.basename(repository)}.git`)
    git(repository, 'update-ref', 'refs/remotes/muqihang/main', repository === cc ? ccPlanMain : subCommon)
  }

  const checkpointTuple = [{ status: 'A', old_mode: null, new_mode: '100644', old_path: null, new_path: 'app/task7.txt' }]
  const bindings = {
    ...tool.AUTHORITY_RESTART_BINDINGS,
    authorityPaths: { plan: 'authority/plan.md', planReview: 'authority/review.json', executionContext: 'authority/context.json' },
    projectedTreePolicy: { authorityRepairPaths: [...repairPaths, 'authority/tool.ts'], historicalAuthorityPaths: historicalPaths },
    ccGateway: {
      supersededHead: checkpoint,
      archivalBranch: 'cc-archive',
      replacementBranch: 'codex/oracle-phase-1-cc-gateway',
      remoteUrlDigest: sha256('https://example.invalid/cc.git'),
      sourceCommits: [ccSource1, ccSource2, checkpoint],
      allowedSkippedSourceCommits: skippedAuthorityCommit ? [skippedAuthorityCommit] : [],
      pinnedSourceEvidence: [{
        commit: checkpoint,
        parent: ccSource2,
        patchId: tool.inspectStablePatchId(cc, checkpoint),
        changedPaths: checkpointTuple,
      }],
      quarantineCheckpoint: checkpoint,
      quarantineParent: ccSource2,
      quarantinePatchId: tool.inspectStablePatchId(cc, checkpoint),
      quarantineChangedPaths: checkpointTuple,
    },
    sub2api: {
      supersededHead: subSource2,
      archivalBranch: 'sub-archive',
      replacementBranch: 'codex/oracle-phase-1-sub2api',
      remoteUrlDigest: sha256('https://example.invalid/sub.git'),
      sourceCommits: [subSource1, subSource2],
    },
  }
  const repairedAuthority = {
    plan: { path: 'authority/plan.md', digest: sha256('new plan\n'), commit: ccPlanMain },
    plan_review: { path: 'authority/review.json', digest: sha256('new review\n'), commit: ccReplacementBase },
    execution_context: { path: 'authority/context.json', digest: sha256('new context\n'), commit: ccReplacementBase },
  }
  const input = {
    ccGatewayRoot: cc,
    sub2apiRoot: sub,
    repairedAuthority,
    replacementCommits: {
      cc_gateway: [ccReplacement1, ccReplacement2, ccReplacement3],
      sub2api: [subReplacement1, subReplacement2],
    },
  }
  const ccSourceRoot = path.join(parent, 'cc-source')
  const subSourceRoot = path.join(parent, 'sub-source')
  execFileSync('git', ['clone', '--shared', '--quiet', '--branch', 'cc-archive', cc, ccSourceRoot], { stdio: 'pipe' })
  execFileSync('git', ['clone', '--shared', '--quiet', '--branch', 'sub-archive', sub, subSourceRoot], { stdio: 'pipe' })
  git(ccSourceRoot, 'remote', 'add', 'muqihang', 'https://example.invalid/cc.git')
  git(subSourceRoot, 'remote', 'add', 'muqihang', 'https://example.invalid/sub.git')
  git(cc, 'update-ref', '-d', 'refs/heads/cc-archive')
  git(sub, 'update-ref', '-d', 'refs/heads/sub-archive')
  const artifact = tool.buildPhase1AuthorityRestart(input, bindings)
  return { parent, cc, sub, ccSourceRoot, subSourceRoot, bindings, input, artifact, ccPlanMain, ccContextCommit, ccReplacementBase, subReplacementBase, checkpoint, ccSource2, skippedAuthorityCommit }
}

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.equal((error as { code?: string }).code, code)
    return true
  })
}

function clone<T>(value: T): T { return structuredClone(value) }

assert.equal(tool.AUTHORITY_RESTART_BINDINGS.repairId, 'authority-repair-0002')
assert.equal(tool.AUTHORITY_RESTART_BINDINGS.artifactPath, 'docs/superpowers/evidence/phase-1/phase-1-authority-restart-0002.json')
assert.equal(tool.AUTHORITY_RESTART_BINDINGS.ccGateway.replacementBranch, 'codex/oracle-phase-1-cc-gateway-v8')
assert.equal(tool.AUTHORITY_RESTART_BINDINGS.sub2api.replacementBranch, 'codex/oracle-phase-1-sub2api-v8')
assert.equal(tool.AUTHORITY_RESTART_BINDINGS.ccGateway.quarantineCheckpoint, 'd5a711614177906d18486b98ff4c5d45d97e04c7')
assert.equal(tool.AUTHORITY_RESTART_BINDINGS.ccGateway.quarantineParent, '8cbc5c633c7f791b395198aedd2db2e55f01915b')
assert.equal(tool.AUTHORITY_RESTART_BINDINGS.ccGateway.quarantinePatchId, '655f57bc12191566b6f1efd415ce54721252ab08')
assert.equal(tool.AUTHORITY_RESTART_BINDINGS.ccGateway.quarantineChangedPaths.length, 2)
assert.deepEqual(tool.AUTHORITY_RESTART_BINDINGS.ccGateway.sourceCommits.slice(-2), [
  '8cbc5c633c7f791b395198aedd2db2e55f01915b',
  'd5a711614177906d18486b98ff4c5d45d97e04c7',
])
assert.deepEqual(tool.AUTHORITY_RESTART_BINDINGS.ccGateway.pinnedSourceEvidence.map((entry: { commit: string }) => entry.commit), [
  '8cbc5c633c7f791b395198aedd2db2e55f01915b',
  'd5a711614177906d18486b98ff4c5d45d97e04c7',
])
assert.equal(tool.AUTHORITY_RESTART_BINDINGS.ccGateway.sourceCommits.at(-1), tool.AUTHORITY_RESTART_BINDINGS.ccGateway.quarantineCheckpoint)
assert.equal(tool.AUTHORITY_RESTART_BINDINGS.projectedTreePolicy.authorityRepairPaths.includes('tools/oracle-lab/phase-1-authority-bootstrap.mjs'), true)
assert.equal(tool.AUTHORITY_RESTART_BINDINGS.projectedTreePolicy.authorityRepairPaths.includes('docs/superpowers/schemas/oracle-lab-phase-1-execution-context.schema.json'), true)

const valid = fixture()
assert.equal(validateSchema(valid.artifact), true, JSON.stringify(validateSchema.errors))
assert.equal(Object.hasOwn(valid.artifact, 'artifact_commit'), false)
assert.equal(Object.hasOwn(valid.artifact, 'artifact_digest'), false)
tool.validatePhase1AuthorityRestart(valid.artifact, {
  ccGatewayRoot: valid.cc,
  sub2apiRoot: valid.sub,
  bindings: valid.bindings,
})
const leakedArchivalRef = fixture()
git(leakedArchivalRef.cc, 'update-ref', 'refs/heads/cc-archive', leakedArchivalRef.checkpoint)
expectCode(() => tool.validatePhase1AuthorityRestart(leakedArchivalRef.artifact, {
  ccGatewayRoot: leakedArchivalRef.cc,
  sub2apiRoot: leakedArchivalRef.sub,
  bindings: leakedArchivalRef.bindings,
}), 'authority_restart_source_ref_leak')
tool.validatePhase1AuthorityRestartSource({
  ccGatewayRoot: valid.ccSourceRoot,
  sub2apiRoot: valid.subSourceRoot,
  bindings: valid.bindings,
})
const skippedAuthority = fixture({ skippedAuthorityGap: true })
tool.validatePhase1AuthorityRestartSource({
  ccGatewayRoot: skippedAuthority.ccSourceRoot,
  sub2apiRoot: skippedAuthority.subSourceRoot,
  bindings: skippedAuthority.bindings,
})
expectCode(() => tool.validatePhase1AuthorityRestartSource({
  ccGatewayRoot: skippedAuthority.ccSourceRoot,
  sub2apiRoot: skippedAuthority.subSourceRoot,
  bindings: {
    ...skippedAuthority.bindings,
    ccGateway: { ...skippedAuthority.bindings.ccGateway, allowedSkippedSourceCommits: [] },
  },
}), 'authority_restart_parent_mismatch')
expectCode(() => tool.validatePhase1AuthorityRestartSource({
  ccGatewayRoot: skippedAuthority.ccSourceRoot,
  sub2apiRoot: skippedAuthority.subSourceRoot,
  bindings: {
    ...skippedAuthority.bindings,
    projectedTreePolicy: {
      ...skippedAuthority.bindings.projectedTreePolicy,
      historicalAuthorityPaths: skippedAuthority.bindings.projectedTreePolicy.historicalAuthorityPaths.filter((entry: string) => entry !== 'authority/restart-old.json'),
    },
  },
}), 'authority_restart_skipped_source_path_mismatch')
expectCode(() => tool.validatePhase1AuthorityRestartSource({
  ccGatewayRoot: valid.ccSourceRoot,
  sub2apiRoot: valid.subSourceRoot,
  bindings: {
    ...valid.bindings,
    ccGateway: {
      ...valid.bindings.ccGateway,
      pinnedSourceEvidence: valid.bindings.ccGateway.pinnedSourceEvidence.map((entry: any) => ({ ...entry, patchId: '0'.repeat(40) })),
    },
  },
}), 'authority_restart_source_evidence_mismatch')
expectCode(() => tool.validatePhase1AuthorityRestartPreCommit(valid.artifact, {
  ccGatewayRoot: valid.cc,
  sub2apiRoot: valid.sub,
  bindings: valid.bindings,
}), 'authority_restart_artifact_bytes_mismatch')

assert.deepEqual(
  tool.parseAuthorityRestartCli([
    'validate-source',
    '--cc-source-root', valid.ccSourceRoot,
    '--cc-replacement-root', valid.cc,
    '--sub2api-source-root', valid.subSourceRoot,
    '--sub2api-replacement-root', valid.sub,
  ]),
  {
    command: 'validate-source',
    values: {
      'cc-source-root': valid.ccSourceRoot,
      'cc-replacement-root': valid.cc,
      'sub2api-source-root': valid.subSourceRoot,
      'sub2api-replacement-root': valid.sub,
    },
    repeated: {},
  },
)
const commonCliArguments = [
  '--cc-source-root', valid.ccSourceRoot,
  '--cc-replacement-root', valid.cc,
  '--sub2api-source-root', valid.subSourceRoot,
  '--sub2api-replacement-root', valid.sub,
]
const parsedBuild = tool.parseAuthorityRestartCli([
  'build',
  ...commonCliArguments,
  '--plan-path', valid.bindings.authorityPaths.plan,
  '--plan-review-path', valid.bindings.authorityPaths.planReview,
  '--execution-context-path', valid.bindings.authorityPaths.executionContext,
  '--output', valid.bindings.artifactPath,
  '--cc-replacement-commit', '1'.repeat(40),
  '--cc-replacement-commit', '2'.repeat(40),
  '--sub2api-replacement-commit', '3'.repeat(40),
])
assert.deepEqual(parsedBuild.repeated, {
  'cc-replacement-commit': ['1'.repeat(40), '2'.repeat(40)],
  'sub2api-replacement-commit': ['3'.repeat(40)],
})
for (const command of ['validate-pre-commit', 'validate-post-commit']) {
  const parsed = tool.parseAuthorityRestartCli([command, ...commonCliArguments, '--artifact', valid.bindings.artifactPath])
  assert.equal(parsed.command, command)
  assert.equal(parsed.values.artifact, valid.bindings.artifactPath)
  assert.deepEqual(parsed.repeated, {})
}
expectCode(() => tool.parseAuthorityRestartCli(['validate-source', '--cc-source-root', valid.ccSourceRoot]), 'authority_restart_cli_arguments_invalid')
expectCode(() => tool.parseAuthorityRestartCli([
  'validate-source',
  '--cc-source-root', valid.ccSourceRoot,
  '--cc-source-root', valid.ccSourceRoot,
  '--cc-replacement-root', valid.cc,
  '--sub2api-source-root', valid.subSourceRoot,
  '--sub2api-replacement-root', valid.sub,
]), 'authority_restart_cli_arguments_invalid')
expectCode(() => tool.parseAuthorityRestartCli(['unknown-command']), 'authority_restart_cli_arguments_invalid')
expectCode(() => tool.parseAuthorityRestartCli([
  'build',
  ...commonCliArguments,
  '--plan-path', valid.bindings.authorityPaths.plan,
  '--plan-review-path', valid.bindings.authorityPaths.planReview,
  '--execution-context-path', valid.bindings.authorityPaths.executionContext,
  '--output', valid.bindings.artifactPath,
  '--cc-replacement-commit', '1'.repeat(40),
]), 'authority_restart_cli_arguments_invalid')
assert.equal((tool as any).runAuthorityRestartCli, undefined)

process.env.GIT_DIR = '/tmp/forged-authority-restart-git-dir'
expectCode(() => tool.validatePhase1AuthorityRestart(valid.artifact, { ccGatewayRoot: valid.cc, sub2apiRoot: valid.sub, bindings: valid.bindings }), 'authority_restart_unsafe_git_environment')
delete process.env.GIT_DIR

const replaced = fixture()
const replacementObject = git(replaced.cc, 'commit-tree', `${replaced.checkpoint}^{tree}`, '-p', replaced.ccSource2, '-m', 'replacement object')
git(replaced.cc, 'update-ref', `refs/replace/${replaced.checkpoint}`, replacementObject)
expectCode(() => tool.validatePhase1AuthorityRestart(replaced.artifact, { ccGatewayRoot: replaced.cc, sub2apiRoot: replaced.sub, bindings: replaced.bindings }), 'authority_restart_git_inspection_failed')

const additional = { ...clone(valid.artifact), unexpected: true }
assert.equal(validateSchema(additional), false)
const nestedAdditional = clone(valid.artifact)
nestedAdditional.repositories.cc_gateway.replay_mappings[0].unexpected = true
assert.equal(validateSchema(nestedAdditional), false)

const wrongSource = clone(valid.artifact)
wrongSource.repositories.cc_gateway.replay_mappings[0].source_commit = '0'.repeat(40)
expectCode(() => tool.validatePhase1AuthorityRestart(wrongSource, { ccGatewayRoot: valid.cc, sub2apiRoot: valid.sub, bindings: valid.bindings }), 'authority_restart_source_commit_mismatch')

const substituteCheckpoint = clone(valid.artifact)
const alternateCheckpoint = git(valid.cc, 'commit-tree', `${valid.checkpoint}^{tree}`, '-p', valid.ccSource2, '-m', 'alternate valid checkpoint')
substituteCheckpoint.repositories.cc_gateway.quarantine_checkpoint.commit = alternateCheckpoint
substituteCheckpoint.repositories.cc_gateway.replay_mappings.at(-1).source_commit = alternateCheckpoint
expectCode(() => tool.validatePhase1AuthorityRestart(substituteCheckpoint, { ccGatewayRoot: valid.cc, sub2apiRoot: valid.sub, bindings: valid.bindings }), 'authority_restart_checkpoint_mismatch')

const parentDrift = clone(valid.artifact)
parentDrift.repositories.cc_gateway.replay_mappings[1].replacement_parent = valid.ccReplacementBase
expectCode(() => tool.validatePhase1AuthorityRestart(parentDrift, { ccGatewayRoot: valid.cc, sub2apiRoot: valid.sub, bindings: valid.bindings }), 'authority_restart_parent_mismatch')

const orderDrift = clone(valid.artifact)
orderDrift.repositories.sub2api.replay_mappings.reverse()
expectCode(() => tool.validatePhase1AuthorityRestart(orderDrift, { ccGatewayRoot: valid.cc, sub2apiRoot: valid.sub, bindings: valid.bindings }), 'authority_restart_mapping_order_mismatch')

const patchDrift = clone(valid.artifact)
patchDrift.repositories.cc_gateway.replay_mappings[0].stable_patch_id = '0'.repeat(40)
expectCode(() => tool.validatePhase1AuthorityRestart(patchDrift, { ccGatewayRoot: valid.cc, sub2apiRoot: valid.sub, bindings: valid.bindings }), 'authority_restart_patch_id_mismatch')

const pathDrift = clone(valid.artifact)
pathDrift.repositories.cc_gateway.replay_mappings[0].changed_paths[0].new_path = 'app/forged.txt'
expectCode(() => tool.validatePhase1AuthorityRestart(pathDrift, { ccGatewayRoot: valid.cc, sub2apiRoot: valid.sub, bindings: valid.bindings }), 'authority_restart_changed_paths_mismatch')

const modeDrift = clone(valid.artifact)
modeDrift.repositories.cc_gateway.replay_mappings[0].changed_paths[0].new_mode = '100755'
expectCode(() => tool.validatePhase1AuthorityRestart(modeDrift, { ccGatewayRoot: valid.cc, sub2apiRoot: valid.sub, bindings: valid.bindings }), 'authority_restart_changed_paths_mismatch')

const renameDrift = clone(valid.artifact)
const renameTuple = renameDrift.repositories.cc_gateway.replay_mappings[1].changed_paths.find((entry: { status: string }) => entry.status.startsWith('R'))
assert.ok(renameTuple)
renameTuple.old_path = 'app/forged-old-name.txt'
expectCode(() => tool.validatePhase1AuthorityRestart(renameDrift, { ccGatewayRoot: valid.cc, sub2apiRoot: valid.sub, bindings: valid.bindings }), 'authority_restart_changed_paths_mismatch')

const broadenedExclusion = clone(valid.artifact)
broadenedExclusion.projected_tree_policy.authority_repair_paths.push('app/task6-a.txt')
expectCode(() => tool.validatePhase1AuthorityRestart(broadenedExclusion, { ccGatewayRoot: valid.cc, sub2apiRoot: valid.sub, bindings: valid.bindings }), 'authority_restart_exclusion_policy_mismatch')

const projectedDrift = clone(valid.artifact)
projectedDrift.repositories.cc_gateway.projected_tree_digest = sha256('forged')
expectCode(() => tool.validatePhase1AuthorityRestart(projectedDrift, { ccGatewayRoot: valid.cc, sub2apiRoot: valid.sub, bindings: valid.bindings }), 'authority_restart_projected_tree_mismatch')
expectCode(() => fixture({ projectedTupleDrift: true }), 'authority_restart_projected_tree_mismatch')
expectCode(() => fixture({ extraCcAuthorizedBase: true }), 'authority_restart_initial_authority_topology_mismatch')
expectCode(() => fixture({ extraSubAuthorizedBase: true }), 'authority_restart_initial_authority_topology_mismatch')

for (const field of ['plan_review', 'execution_context'] as const) {
  const drift = clone(valid.artifact)
  drift.repaired_authority[field].digest = sha256(`forged ${field}`)
  expectCode(() => tool.validatePhase1AuthorityRestart(drift, { ccGatewayRoot: valid.cc, sub2apiRoot: valid.sub, bindings: valid.bindings }), 'authority_restart_authority_digest_mismatch')
}

tool.writePhase1AuthorityRestart(valid.cc, valid.artifact)
tool.validatePhase1AuthorityRestart(valid.artifact, { ccGatewayRoot: valid.cc, sub2apiRoot: valid.sub, bindings: valid.bindings })
tool.validatePhase1AuthorityRestartPreCommit(valid.artifact, { ccGatewayRoot: valid.cc, sub2apiRoot: valid.sub, bindings: valid.bindings })
expectCode(() => tool.writePhase1AuthorityRestart(valid.cc, valid.artifact), 'authority_restart_artifact_exists')

const committed = fixture()
const bytes = tool.writePhase1AuthorityRestart(committed.cc, committed.artifact)
tool.validatePhase1AuthorityRestart(committed.artifact, { ccGatewayRoot: committed.cc, sub2apiRoot: committed.sub, bindings: committed.bindings })
git(committed.cc, 'add', '--', tool.AUTHORITY_RESTART_BINDINGS.artifactPath)
git(committed.cc, 'commit', '-qm', 'record authority restart')
tool.validatePhase1AuthorityRestartPostCommit(committed.artifact, bytes, {
  ccGatewayRoot: committed.cc,
  sub2apiRoot: committed.sub,
  bindings: committed.bindings,
})

const mutatedBytes = Buffer.from(bytes)
mutatedBytes[mutatedBytes.length - 2] ^= 1
expectCode(() => tool.validatePhase1AuthorityRestartPostCommit(committed.artifact, mutatedBytes, { ccGatewayRoot: committed.cc, sub2apiRoot: committed.sub, bindings: committed.bindings }), 'authority_restart_artifact_bytes_mismatch')

const extraDelta = fixture()
tool.writePhase1AuthorityRestart(extraDelta.cc, extraDelta.artifact)
write(extraDelta.cc, 'extra.txt', 'extra\n')
git(extraDelta.cc, 'add', '--', tool.AUTHORITY_RESTART_BINDINGS.artifactPath, 'extra.txt')
git(extraDelta.cc, 'commit', '-qm', 'invalid restart delta')
expectCode(() => tool.validatePhase1AuthorityRestartPostCommit(extraDelta.artifact, readFileSync(path.join(extraDelta.cc, tool.AUTHORITY_RESTART_BINDINGS.artifactPath)), { ccGatewayRoot: extraDelta.cc, sub2apiRoot: extraDelta.sub, bindings: extraDelta.bindings }), 'authority_restart_artifact_delta_mismatch')

const wrongParent = fixture()
const artifactBytes = tool.writePhase1AuthorityRestart(wrongParent.cc, wrongParent.artifact)
git(wrongParent.cc, 'add', '--', tool.AUTHORITY_RESTART_BINDINGS.artifactPath)
const tree = git(wrongParent.cc, 'write-tree')
const wrongParentCommit = git(wrongParent.cc, 'commit-tree', tree, '-p', wrongParent.ccContextCommit, '-m', 'wrong parent restart')
git(wrongParent.cc, 'update-ref', 'refs/heads/codex/oracle-phase-1-cc-gateway', wrongParentCommit)
expectCode(() => tool.validatePhase1AuthorityRestartPostCommit(wrongParent.artifact, artifactBytes, { ccGatewayRoot: wrongParent.cc, sub2apiRoot: wrongParent.sub, bindings: wrongParent.bindings }), 'authority_restart_artifact_parent_mismatch')

const launcherPath = path.join(root, 'tools/oracle-lab/oracle-phase1-authority-restart')
const launcher = readFileSync(launcherPath, 'utf8')
for (const required of [
  '/usr/bin/env -i',
  'ORACLE_PHASE1_AUTHORITY_LAUNCHER=posix-v1',
  ['NODE_OPTIONS', ['NODE', 'PATH'].join('_')].join(' '),
  'DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH LD_PRELOAD',
  'phase-1-authority-bootstrap.mjs',
  'bootstrap_snapshot',
  '"$tool_head:tools/oracle-lab/phase-1-authority-bootstrap.mjs"',
]) assert.ok(launcher.includes(required), required)
assert.equal(launcher.includes('"$node_executable" "$bootstrap_entry"'), false, 'launcher must never execute the live bootstrap pathname')
const bootstrap = readFileSync(path.join(root, 'tools/oracle-lab/phase-1-authority-bootstrap.mjs'), 'utf8')
for (const required of [
  'COPYFILE_FICLONE_FORCE',
  "spawnSync('/bin/cp', ['-c'",
  "path.join(npmRoot, '_cacache')",
  "['ci', '--offline', '--ignore-scripts'",
  "mkdtempSync('/tmp/oracle-phase1-authority-dependencies.')",
  'materializeReviewedRuntime(runtime, dependencyRoot, account)',
  "path.join(dependencies.dependencyRoot, 'tools/oracle-lab/phase-1-authority-restart.ts')",
  'runAuthorityCommand',
  'sourceBefore.digest !== sourceAfter.digest',
  'assertDistinctRuntimeRoots',
  'assertReviewedRuntimeUnchanged',
]) assert.ok(bootstrap.includes(required), required)
assert.ok(
  bootstrap.indexOf('const runtime = verifyRuntime(toolRoot, git)') < bootstrap.indexOf('const dependencies = prepareDependencies(runtime, npm)'),
  'reviewed runtime bytes must be frozen before isolated dependency preparation',
)
assert.equal(bootstrap.includes('installDependencies(repositoryRoot'), false, 'replacement dependency installation is forbidden')
assert.equal(bootstrap.includes('runAuthorityRestartCli'), false)
const injectedLauncher = spawnSync('/bin/sh', [launcherPath, 'validate-source'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, NODE_OPTIONS: '--require=/tmp/authority-restart-hook.cjs' },
})
assert.equal(injectedLauncher.status, 1)
assert.equal(injectedLauncher.stderr.trim(), 'authority_restart_unsafe_startup_environment')

const positiveParent = mkdtempSync(path.join(tmpdir(), 'oracle-phase1-authority-launcher-positive-'))
const positiveRoot = path.join(positiveParent, 'tool')
cloneRepository(root, positiveRoot)
for (const relative of [
  'tools/oracle-lab/oracle-phase1-authority-restart',
  'tools/oracle-lab/phase-1-authority-bootstrap.mjs',
  'tools/oracle-lab/phase-1-authority-restart.ts',
]) copyFileSync(path.join(root, relative), path.join(positiveRoot, relative))
write(positiveRoot, 'launcher-positive-fixture.txt', 'positive launcher fixture\n')
git(positiveRoot, 'add', '--',
  'tools/oracle-lab/oracle-phase1-authority-restart',
  'tools/oracle-lab/phase-1-authority-bootstrap.mjs',
  'tools/oracle-lab/phase-1-authority-restart.ts',
  'launcher-positive-fixture.txt',
)
git(positiveRoot, 'commit', '-qm', 'positive launcher fixture')
bindReviewedToolUpstream(positiveRoot)
const positiveReplacementRoot = path.join(positiveParent, 'cc-replacement')
const positiveSubReplacementRoot = path.join(positiveParent, 'sub-replacement')
cloneRepository(positiveRoot, positiveReplacementRoot)
cloneRepository(positiveRoot, positiveSubReplacementRoot)
const positiveLauncher = spawnSync(path.join(positiveRoot, 'tools/oracle-lab/oracle-phase1-authority-restart'), [
  'validate-runtime',
  '--cc-replacement-root', positiveReplacementRoot,
], {
  cwd: positiveRoot,
  encoding: 'utf8',
  env: { ...process.env, npm_config_cache: '/dev/null/forged-cache' },
})
assert.equal(positiveLauncher.status, 0, `${positiveLauncher.stdout}\n${positiveLauncher.stderr}`)
assert.equal(existsSync(path.join(positiveRoot, 'node_modules')), false, 'validate-runtime must keep dependencies outside the tool root')
assert.equal(existsSync(path.join(positiveReplacementRoot, 'node_modules')), false, 'validate-runtime must keep dependencies outside the replacement root')

const aliasLauncher = spawnSync(path.join(positiveRoot, 'tools/oracle-lab/oracle-phase1-authority-restart'), [
  'validate-runtime', '--cc-replacement-root', positiveRoot,
], { cwd: positiveRoot, encoding: 'utf8', env: process.env })
assert.equal(aliasLauncher.status, 1)
assert.equal(aliasLauncher.stderr.trim(), 'authority_restart_tool_replacement_alias')

write(positiveReplacementRoot, 'package.json', '{ replacement product manifest\n')
write(positiveReplacementRoot, 'package-lock.json', '{ replacement product lock\n')
const replacementManifestMutation = spawnSync(path.join(positiveRoot, 'tools/oracle-lab/oracle-phase1-authority-restart'), [
  'validate-runtime', '--cc-replacement-root', positiveReplacementRoot,
], { cwd: positiveRoot, encoding: 'utf8', env: process.env })
assert.equal(replacementManifestMutation.status, 0, `${replacementManifestMutation.stdout}\n${replacementManifestMutation.stderr}`)

const invalidSourceLauncher = spawnSync(path.join(positiveRoot, 'tools/oracle-lab/oracle-phase1-authority-restart'), [
  'validate-source',
  '--cc-source-root', path.join(positiveParent, 'missing-cc-source'),
  '--cc-replacement-root', positiveReplacementRoot,
  '--sub2api-source-root', path.join(positiveParent, 'missing-sub-source'),
  '--sub2api-replacement-root', positiveSubReplacementRoot,
], { cwd: positiveRoot, encoding: 'utf8', env: process.env })
assert.notEqual(invalidSourceLauncher.status, 0, 'invalid source authority must fail')
assert.equal(existsSync(path.join(positiveReplacementRoot, 'node_modules')), false, 'source validation failure must not mutate replacement dependencies')

const driftRoot = path.join(mkdtempSync(path.join(tmpdir(), 'oracle-phase1-authority-tool-drift-')), 'tool')
cloneRepository(positiveRoot, driftRoot)
bindReviewedToolUpstream(driftRoot)
writeFileSync(path.join(driftRoot, 'tools/oracle-lab/phase-1-authority-bootstrap.mjs'), `${readFileSync(path.join(driftRoot, 'tools/oracle-lab/phase-1-authority-bootstrap.mjs'), 'utf8')}\n`)
const driftLauncher = spawnSync(path.join(driftRoot, 'tools/oracle-lab/oracle-phase1-authority-restart'), [
  'validate-runtime', '--cc-replacement-root', positiveReplacementRoot,
], { cwd: driftRoot, encoding: 'utf8', env: process.env })
assert.equal(driftLauncher.status, 1)
assert.equal(driftLauncher.stderr.trim(), 'authority_restart_unsafe_startup_environment')

const upstreamDriftRoot = path.join(mkdtempSync(path.join(tmpdir(), 'oracle-phase1-authority-upstream-drift-')), 'tool')
cloneRepository(positiveRoot, upstreamDriftRoot)
bindReviewedToolUpstream(upstreamDriftRoot)
const upstreamBranch = git(upstreamDriftRoot, 'branch', '--show-current')
git(upstreamDriftRoot, 'update-ref', `refs/remotes/muqihang/${upstreamBranch}`, git(upstreamDriftRoot, 'rev-parse', 'HEAD^'))
const upstreamDriftLauncher = spawnSync(path.join(upstreamDriftRoot, 'tools/oracle-lab/oracle-phase1-authority-restart'), [
  'validate-runtime', '--cc-replacement-root', positiveReplacementRoot,
], { cwd: upstreamDriftRoot, encoding: 'utf8', env: process.env })
assert.equal(upstreamDriftLauncher.status, 1)
assert.equal(upstreamDriftLauncher.stderr.trim(), 'authority_restart_unsafe_startup_environment')

const symlinkRoot = path.join(mkdtempSync(path.join(tmpdir(), 'oracle-phase1-authority-symlink-')), 'tool')
cloneRepository(positiveRoot, symlinkRoot)
bindReviewedToolUpstream(symlinkRoot)
renameSync(path.join(symlinkRoot, 'tools/oracle-lab/phase-1-authority-bootstrap.mjs'), path.join(symlinkRoot, 'bootstrap.saved'))
execFileSync('ln', ['-s', path.join(symlinkRoot, 'bootstrap.saved'), path.join(symlinkRoot, 'tools/oracle-lab/phase-1-authority-bootstrap.mjs')])
const symlinkLauncher = spawnSync(path.join(symlinkRoot, 'tools/oracle-lab/oracle-phase1-authority-restart'), [
  'validate-runtime', '--cc-replacement-root', positiveReplacementRoot,
], { cwd: symlinkRoot, encoding: 'utf8', env: process.env })
assert.equal(symlinkLauncher.status, 1)
assert.equal(symlinkLauncher.stderr.trim(), 'authority_restart_unsafe_startup_environment')

const manifestRaceRoot = path.join(mkdtempSync(path.join(tmpdir(), 'oracle-phase1-authority-manifest-race-')), 'tool')
cloneRepository(positiveRoot, manifestRaceRoot)
bindReviewedToolUpstream(manifestRaceRoot)
const manifestRace = await runLauncherWithPostVerificationRace(manifestRaceRoot, [
  'validate-runtime',
  '--cc-replacement-root', positiveReplacementRoot,
], () => {
  for (const relative of ['package.json', 'package-lock.json']) {
    const replacement = path.join(manifestRaceRoot, `${relative}.race`)
    writeFileSync(replacement, '{ malformed runtime manifest\n')
    renameSync(replacement, path.join(manifestRaceRoot, relative))
  }
})
assert.equal(manifestRace.status, 1, `${manifestRace.stdout}\n${manifestRace.stderr}`)
assert.equal(manifestRace.stderr.trim(), 'authority_restart_runtime_binding_mismatch')
assert.equal(existsSync(path.join(manifestRaceRoot, 'node_modules')), false, 'manifest race must not install into the tool root')

const toolRaceRoot = path.join(mkdtempSync(path.join(tmpdir(), 'oracle-phase1-authority-tool-race-')), 'tool')
cloneRepository(positiveRoot, toolRaceRoot)
bindReviewedToolUpstream(toolRaceRoot)
const toolRaceMarker = path.join(toolRaceRoot, 'live-tool-race-executed')
const toolRace = await runLauncherWithPostVerificationRace(toolRaceRoot, [
  'validate-source',
  '--cc-source-root', path.join(positiveParent, 'missing-race-cc-source'),
  '--cc-replacement-root', positiveReplacementRoot,
  '--sub2api-source-root', path.join(positiveParent, 'missing-race-sub-source'),
  '--sub2api-replacement-root', positiveSubReplacementRoot,
], () => {
  const replacement = path.join(toolRaceRoot, 'tools/oracle-lab/phase-1-authority-restart.ts.race')
  writeFileSync(replacement, [
    "import { writeFileSync } from 'node:fs'",
    `writeFileSync(${JSON.stringify(toolRaceMarker)}, 'executed\\n')`,
    "throw new Error('live authority tool was imported')",
    '',
  ].join('\n'))
  renameSync(replacement, path.join(toolRaceRoot, 'tools/oracle-lab/phase-1-authority-restart.ts'))
})
assert.notEqual(toolRace.status, 0, 'invalid source authority must still fail during a live-tool race')
assert.equal(existsSync(toolRaceMarker), false, 'post-verification live authority tool bytes must never execute')
assert.equal(existsSync(path.join(toolRaceRoot, 'node_modules')), false, 'tool race must not install into the tool root')

const reviewedTsxCli = path.join(root, 'node_modules/tsx/dist/cli.mjs')
const directBypass = spawnSync(process.execPath, [
  reviewedTsxCli,
  path.join(positiveRoot, 'tools/oracle-lab/phase-1-authority-restart.ts'),
  'validate-runtime',
  '--cc-replacement-root', positiveRoot,
], {
  cwd: positiveRoot,
  encoding: 'utf8',
  env: {
    HOME: '/dev/null',
    TMPDIR: '/tmp',
    PATH: `${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`,
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    ORACLE_PHASE1_AUTHORITY_LAUNCHER: 'posix-v1',
    ORACLE_PHASE1_AUTHORITY_CACHE: 'command_scoped_lockfile_verified_v1',
    ORACLE_P0_1_NODE: process.execPath,
    ORACLE_P0_1_GIT: '/opt/homebrew/bin/git',
  },
})
assert.notEqual(directBypass.status, 0, 'direct tsx invocation must not reach the authority CLI')
assert.equal(directBypass.stderr.trim(), 'authority_restart_direct_invocation_forbidden')

const forgedCliEnvironment = {
  HOME: '/dev/null',
  TMPDIR: '/tmp',
  PATH: `${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`,
  LANG: 'C',
  LC_ALL: 'C',
  TZ: 'UTC',
  ORACLE_PHASE1_AUTHORITY_LAUNCHER: 'posix-v1',
  ORACLE_PHASE1_AUTHORITY_BOOTSTRAP: 'verified-v1',
  ORACLE_PHASE1_AUTHORITY_CACHE: 'command_scoped_lockfile_verified_v1',
  ORACLE_P0_1_NODE: process.execPath,
  ORACLE_P0_1_GIT: '/opt/homebrew/bin/git',
}
const importBypassExpression = `
  import * as tool from './tools/oracle-lab/phase-1-authority-restart.ts';
  if (typeof tool.runAuthorityRestartCli !== 'function') {
    console.error('authority_restart_direct_invocation_forbidden');
    process.exit(1);
  }
  tool.runAuthorityRestartCli(['validate-runtime', '--cc-replacement-root', process.cwd()]);
  console.log('TSX_EVAL_BYPASS_REACHED');
`
const tsxEvalBypass = spawnSync(process.execPath, [
  reviewedTsxCli,
  '-e', importBypassExpression,
], { cwd: positiveRoot, encoding: 'utf8', env: forgedCliEnvironment })
assert.notEqual(tsxEvalBypass.status, 0, 'tsx -e import must not expose an authority command dispatcher')
assert.equal(tsxEvalBypass.stderr.trim(), 'authority_restart_direct_invocation_forbidden')

const reviewedTsImportApi = pathToFileURL(path.join(root, 'node_modules/tsx/dist/esm/api/index.mjs')).href
const tsImportBypassExpression = `
  const { tsImport } = await import(${JSON.stringify(reviewedTsImportApi)});
  const tool = await tsImport('./tools/oracle-lab/phase-1-authority-restart.ts', import.meta.url);
  if (typeof tool.runAuthorityRestartCli !== 'function') {
    console.error('authority_restart_direct_invocation_forbidden');
    process.exit(1);
  }
  tool.runAuthorityRestartCli(['validate-runtime', '--cc-replacement-root', process.cwd()]);
  console.log('NODE_TSIMPORT_BYPASS_REACHED');
`
const nodeImportBypass = spawnSync(process.execPath, [
  '--input-type=module', '-e', tsImportBypassExpression,
], { cwd: positiveRoot, encoding: 'utf8', env: forgedCliEnvironment })
assert.notEqual(nodeImportBypass.status, 0, 'Node tsImport must not expose an authority command dispatcher')
assert.equal(nodeImportBypass.stderr.trim(), 'authority_restart_direct_invocation_forbidden')

const bootstrapPath = path.join(root, 'tools/oracle-lab/phase-1-authority-bootstrap.mjs')
assert.equal(existsSync(bootstrapPath), true)
const unsafeCache = path.join(positiveParent, 'unsafe-cache')
mkdirSync(path.join(unsafeCache, 'content'), { recursive: true })
writeFileSync(path.join(positiveParent, 'outside-cache-entry'), 'outside\n')
execFileSync('ln', ['-s', path.join(positiveParent, 'outside-cache-entry'), path.join(unsafeCache, 'content', 'escape')])
const unsafeInventory = spawnSync(process.execPath, [bootstrapPath, 'inventory-cache', '--root', unsafeCache], {
  cwd: root,
  encoding: 'utf8',
  env: { HOME: '/dev/null', TMPDIR: '/tmp', PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
})
assert.equal(unsafeInventory.status, 1)
assert.equal(unsafeInventory.stderr.trim(), 'authority_restart_dependency_cache_unsafe')

const specialCache = path.join(positiveParent, 'special-cache')
mkdirSync(specialCache, { recursive: true })
execFileSync('mkfifo', [path.join(specialCache, 'named-pipe')])
const specialInventory = spawnSync(process.execPath, [bootstrapPath, 'inventory-cache', '--root', specialCache], {
  cwd: root,
  encoding: 'utf8',
  env: { HOME: '/dev/null', TMPDIR: '/tmp', PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
})
assert.equal(specialInventory.status, 1)
assert.equal(specialInventory.stderr.trim(), 'authority_restart_dependency_cache_unsafe')

console.log('oracle-lab Phase 1 authority restart tests passed')
