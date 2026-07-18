import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { canonicalDeliveryJson } from './delivery-authority.js'
import {
  AUTHORITY_RESTART_BINDINGS,
  validatePhase1AuthorityRestartSource,
} from './phase-1-authority-restart.js'
import {
  REVIEWED_GIT_ENVIRONMENT,
  REVIEWED_GIT_EXECUTABLE,
  runReviewedGit,
} from './secure-runtime.js'

type RepositoryRehearsalBinding = Readonly<{
  replacement_branch: string
  remote_url_digest: string
  remote_main_head: string
  authorization_base_head: string
  source_commits: readonly string[]
}>

export type Phase1TransitionRehearsalBindings = Readonly<{
  artifact_path: string
  authority_paths: Readonly<{ plan: string; plan_review: string; execution_context: string }>
  tool_remote_url_digest: string
  cc_gateway: RepositoryRehearsalBinding
  sub2api: RepositoryRehearsalBinding
}>

export type Phase1TransitionRehearsalInput = Readonly<{
  tool_root: string
  cc_source_root: string
  sub2api_source_root: string
  cc_authorization_root: string
  sub2api_authorization_root: string
  replacement_parent_root: string
  output_root: string
}>

type LauncherInput = Readonly<{
  command: 'build' | 'validate-pre-commit' | 'validate-post-commit'
  tool_root: string
  cc_source_root: string
  sub2api_source_root: string
  cc_replacement_root: string
  sub2api_replacement_root: string
  artifact_path: string
  arguments: readonly string[]
}>

type LauncherResult = Readonly<{ status: number; stdout: string; stderr: string }>

export type Phase1TransitionRehearsalDependencies = Readonly<{
  validate_sources: (input: Readonly<{ cc_source_root: string; sub2api_source_root: string }>) => void
  invoke_launcher: (input: LauncherInput) => LauncherResult | Promise<LauncherResult>
}>

const INPUT_FLAGS = Object.freeze({
  'tool-root': 'tool_root',
  'cc-source-root': 'cc_source_root',
  'sub2api-source-root': 'sub2api_source_root',
  'cc-authorization-root': 'cc_authorization_root',
  'sub2api-authorization-root': 'sub2api_authorization_root',
  'replacement-parent-root': 'replacement_parent_root',
  'output-root': 'output_root',
} as const)
const COMMIT = /^[0-9a-f]{40,64}$/
const DIGEST = /^sha256:[0-9a-f]{64}$/
const TRANSACTION_RECORD = 'phase-1-transition-transaction.json'

export const PHASE1_TRANSITION_REHEARSAL_BINDINGS: Phase1TransitionRehearsalBindings = Object.freeze({
  artifact_path: AUTHORITY_RESTART_BINDINGS.artifactPath,
  authority_paths: Object.freeze({
    plan: AUTHORITY_RESTART_BINDINGS.authorityPaths.plan,
    plan_review: AUTHORITY_RESTART_BINDINGS.authorityPaths.planReview,
    execution_context: AUTHORITY_RESTART_BINDINGS.authorityPaths.executionContext,
  }),
  tool_remote_url_digest: AUTHORITY_RESTART_BINDINGS.ccGateway.remoteUrlDigest,
  cc_gateway: Object.freeze({
    replacement_branch: AUTHORITY_RESTART_BINDINGS.ccGateway.replacementBranch,
    remote_url_digest: AUTHORITY_RESTART_BINDINGS.ccGateway.remoteUrlDigest,
    remote_main_head: '52469ac0b53c7bd71667c0d34d66badcfedda42d',
    authorization_base_head: '8c386e861eba9aeb4afef058f58ea990b195d499',
    source_commits: AUTHORITY_RESTART_BINDINGS.ccGateway.sourceCommits,
  }),
  sub2api: Object.freeze({
    replacement_branch: AUTHORITY_RESTART_BINDINGS.sub2api.replacementBranch,
    remote_url_digest: AUTHORITY_RESTART_BINDINGS.sub2api.remoteUrlDigest,
    remote_main_head: 'b0b77933716487da5fca00329443f88ce9a1c3db',
    authorization_base_head: 'b0b77933716487da5fca00329443f88ce9a1c3db',
    source_commits: AUTHORITY_RESTART_BINDINGS.sub2api.sourceCommits,
  }),
})

function fail(code: string, message: string, retained: readonly string[] = []): never {
  throw Object.assign(new Error(message), { code, retained_cleanup_roots: Object.freeze([...retained]) })
}

function sha256(value: Buffer | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function gitText(root: string, args: readonly string[]): string {
  return runReviewedGit(root, args).stdout.toString('utf8').trim()
}

function gitStatus(root: string): Buffer {
  return runReviewedGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']).stdout
}

function resolveCommit(root: string, revision: string): string {
  const value = gitText(root, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`])
  if (!COMMIT.test(value)) fail('transition_rehearsal_git_invalid', 'Git commit identity is malformed')
  return value
}

function remoteUrl(root: string): string {
  return gitText(root, ['remote', 'get-url', 'muqihang'])
}

function assertRealDirectory(rootInput: string, code: string): string {
  let metadata
  try { metadata = lstatSync(rootInput) } catch { fail(code, 'required input root is unavailable') }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail(code, 'required input root must be a real directory')
  return realpathSync(rootInput)
}

function assertCleanBoundRepository(root: string, remoteDigest: string): void {
  if (gitStatus(root).length !== 0) fail('transition_rehearsal_input_dirty', 'preserved repository must be clean')
  if (sha256(remoteUrl(root)) !== remoteDigest) fail('transition_rehearsal_remote_mismatch', 'preserved repository remote URL drifted')
}

function assertToolRoot(root: string, bindings: Phase1TransitionRehearsalBindings): Readonly<{ branch: string; commit: string }> {
  assertCleanBoundRepository(root, bindings.tool_remote_url_digest)
  const branch = gitText(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (branch !== 'main' && !branch.startsWith('codex/')) fail('transition_rehearsal_tool_authority_invalid', 'tool root branch is not reviewable')
  const commit = resolveCommit(root, 'HEAD')
  if (resolveCommit(root, `refs/remotes/muqihang/${branch}`) !== commit) fail('transition_rehearsal_tool_authority_invalid', 'tool root is not equal to its fetched upstream branch')
  const launcher = path.join(root, 'tools/oracle-lab/oracle-phase1-authority-restart')
  let metadata
  try { metadata = lstatSync(launcher) } catch { fail('transition_rehearsal_tool_authority_invalid', 'reviewed launcher is unavailable') }
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o111) === 0) fail('transition_rehearsal_tool_authority_invalid', 'reviewed launcher must be an executable regular file')
  return Object.freeze({ branch, commit })
}

function assertAuthorizationRoot(root: string, binding: RepositoryRehearsalBinding): void {
  assertCleanBoundRepository(root, binding.remote_url_digest)
  if (resolveCommit(root, 'refs/remotes/muqihang/main') !== binding.remote_main_head
    || resolveCommit(root, binding.authorization_base_head) !== binding.authorization_base_head) {
    fail('transition_rehearsal_authorization_invalid', 'authorization base or frozen remote main drifted')
  }
}

function exclusiveDirectoryCandidate(target: string, code: string): string {
  const parent = assertRealDirectory(path.dirname(target), code)
  const basename = path.basename(target)
  if (basename === '.' || basename === '..' || basename.includes(path.sep)) fail(code, 'transaction root basename is invalid')
  return path.join(parent, basename)
}

function createExclusiveDirectory(target: string, code: string, retained: string[]): string {
  const destination = exclusiveDirectoryCandidate(target, code)
  if (existsSync(target) || existsSync(destination)) fail(code, 'exclusive transaction root already exists')
  try { mkdirSync(destination, { mode: 0o700 }) } catch { fail(code, 'exclusive transaction root could not be created', retained) }
  retained.push(destination)
  try {
    chmodSync(destination, 0o700)
    const canonical = realpathSync(destination)
    const metadata = lstatSync(canonical)
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700) fail(code, 'transaction root is not an exclusive 0700 directory', retained)
    retained[retained.length - 1] = canonical
    return canonical
  } catch (error) {
    if (Array.isArray((error as { retained_cleanup_roots?: unknown }).retained_cleanup_roots)) throw error
    fail(code, 'exclusive transaction root validation failed', retained)
  }
}

function rootsOverlap(left: string, right: string): boolean {
  const relative = path.relative(left, right)
  const reverse = path.relative(right, left)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
    || (!reverse.startsWith(`..${path.sep}`) && reverse !== '..' && !path.isAbsolute(reverse))
}

function assertRootContainment(protectedRoots: readonly string[], replacementParent: string, outputRoot: string): void {
  const transactionRoots = [replacementParent, outputRoot]
  if (rootsOverlap(replacementParent, outputRoot)
    || protectedRoots.some((protectedRoot) => transactionRoots.some((transactionRoot) => rootsOverlap(protectedRoot, transactionRoot)))) {
    fail('transition_rehearsal_root_alias', 'transaction roots must not overlap preserved or tool roots')
  }
}

function spawnReviewedGit(root: string, args: readonly string[]): void {
  const observed = spawnSync(REVIEWED_GIT_EXECUTABLE, args, {
    cwd: root,
    encoding: 'buffer',
    env: { ...REVIEWED_GIT_ENVIRONMENT },
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (observed.error || observed.signal !== null || observed.status !== 0) {
    fail('transition_rehearsal_git_failed', 'reviewed Git transaction command failed')
  }
}

function prepareReplacementRoot(
  root: string,
  authorizationRoot: string,
  sourceRoot: string,
  binding: RepositoryRehearsalBinding,
): void {
  spawnReviewedGit(root, ['init', '-q', `--initial-branch=${binding.replacement_branch}`])
  spawnReviewedGit(root, ['remote', 'add', 'muqihang', remoteUrl(authorizationRoot)])
  spawnReviewedGit(root, ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--recurse-submodules=no', authorizationRoot, 'HEAD'])
  spawnReviewedGit(root, ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--recurse-submodules=no', sourceRoot, 'HEAD'])
  if (resolveCommit(root, binding.authorization_base_head) !== binding.authorization_base_head
    || resolveCommit(root, binding.remote_main_head) !== binding.remote_main_head
    || binding.source_commits.some((commit) => resolveCommit(root, commit) !== commit)) {
    fail('transition_rehearsal_git_invalid', 'compiled transaction objects are unavailable')
  }
  runReviewedGit(root, ['update-ref', 'refs/remotes/muqihang/main', binding.remote_main_head])
  runReviewedGit(root, ['switch', '--quiet', '--create', binding.replacement_branch, binding.authorization_base_head])
  runReviewedGit(root, ['config', 'user.name', 'Oracle Transition Rehearsal'])
  runReviewedGit(root, ['config', 'user.email', 'oracle-transition@example.invalid'])
  runReviewedGit(root, ['config', 'core.hooksPath', '/dev/null'])
  runReviewedGit(root, ['config', 'commit.gpgsign', 'false'])
  if (gitStatus(root).length !== 0) fail('transition_rehearsal_git_invalid', 'fresh replacement root is dirty')
}

function replayCompiledCommits(root: string, commits: readonly string[]): readonly string[] {
  const replacements: string[] = []
  for (const commit of commits) {
    runReviewedGit(root, [
      '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
      'cherry-pick', '--no-edit', commit,
    ])
    replacements.push(resolveCommit(root, 'HEAD'))
    if (gitStatus(root).length !== 0) fail('transition_rehearsal_replay_dirty', 'compiled replay left a dirty worktree')
  }
  return Object.freeze(replacements)
}

function launcherArguments(
  command: LauncherInput['command'],
  input: Phase1TransitionRehearsalInput,
  ccRoot: string,
  subRoot: string,
  bindings: Phase1TransitionRehearsalBindings,
  ccCommits: readonly string[],
  subCommits: readonly string[],
): readonly string[] {
  const common = [
    '--cc-source-root', input.cc_source_root,
    '--cc-replacement-root', ccRoot,
    '--sub2api-source-root', input.sub2api_source_root,
    '--sub2api-replacement-root', subRoot,
  ]
  if (command === 'build') return Object.freeze([
    command, ...common,
    '--plan-path', bindings.authority_paths.plan,
    '--plan-review-path', bindings.authority_paths.plan_review,
    '--execution-context-path', bindings.authority_paths.execution_context,
    '--output', bindings.artifact_path,
    ...ccCommits.flatMap((commit) => ['--cc-replacement-commit', commit]),
    ...subCommits.flatMap((commit) => ['--sub2api-replacement-commit', commit]),
  ])
  return Object.freeze([command, ...common, '--artifact', bindings.artifact_path])
}

function defaultInvokeLauncher(input: LauncherInput): LauncherResult {
  const launcher = path.join(input.tool_root, 'tools/oracle-lab/oracle-phase1-authority-restart')
  const observed = spawnSync(launcher, input.arguments, {
    cwd: input.tool_root,
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return Object.freeze({
    status: observed.error || observed.signal !== null || observed.status === null ? 127 : observed.status,
    stdout: observed.stdout ?? '',
    stderr: observed.stderr ?? String(observed.error?.message ?? ''),
  })
}

const DEFAULT_DEPENDENCIES: Phase1TransitionRehearsalDependencies = Object.freeze({
  validate_sources: ({ cc_source_root, sub2api_source_root }) => validatePhase1AuthorityRestartSource({
    ccGatewayRoot: cc_source_root,
    sub2apiRoot: sub2api_source_root,
  }),
  invoke_launcher: defaultInvokeLauncher,
})

function launcherFailure(result: LauncherResult, retained: readonly string[]): never {
  const observed = result.stderr.trim().split(/\r?\n/, 1)[0]
  const code = /^[a-z][a-z0-9_]+$/.test(observed) ? observed : 'transition_rehearsal_launcher_failed'
  fail(code, 'reviewed authority launcher rejected the transaction', retained)
}

function assertPreservedSnapshots(snapshots: readonly Readonly<{ root: string; head: string; status: Buffer }>[]): void {
  for (const snapshot of snapshots) {
    if (resolveCommit(snapshot.root, 'HEAD') !== snapshot.head || !gitStatus(snapshot.root).equals(snapshot.status)) {
      fail('transition_rehearsal_preserved_root_mutated', 'preserved input root changed during rehearsal')
    }
  }
}

export function parsePhase1TransitionRehearsalCli(argv: readonly string[]): Phase1TransitionRehearsalInput {
  if (argv.length !== Object.keys(INPUT_FLAGS).length * 2) fail('transition_rehearsal_cli_invalid', 'rehearsal requires the exact closed root flag set')
  const values: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index]
    const value = argv[index + 1]
    if (!token?.startsWith('--') || value === undefined || !path.isAbsolute(value)) fail('transition_rehearsal_cli_invalid', 'rehearsal roots must be explicit absolute paths')
    const name = token.slice(2) as keyof typeof INPUT_FLAGS
    if (!Object.hasOwn(INPUT_FLAGS, name) || Object.hasOwn(values, INPUT_FLAGS[name])) fail('transition_rehearsal_cli_invalid', 'unknown or duplicate rehearsal flag')
    values[INPUT_FLAGS[name]] = value
  }
  if (Object.keys(values).length !== Object.keys(INPUT_FLAGS).length) fail('transition_rehearsal_cli_invalid', 'rehearsal root flags are incomplete')
  return Object.freeze(values as Phase1TransitionRehearsalInput)
}

export async function runPhase1TransitionRehearsal(
  rawInput: Phase1TransitionRehearsalInput,
  bindings: Phase1TransitionRehearsalBindings = PHASE1_TRANSITION_REHEARSAL_BINDINGS,
  dependencies: Phase1TransitionRehearsalDependencies = DEFAULT_DEPENDENCIES,
): Promise<Record<string, any>> {
  const started = process.hrtime.bigint()
  if (!DIGEST.test(bindings.tool_remote_url_digest) || !DIGEST.test(bindings.cc_gateway.remote_url_digest)
    || !DIGEST.test(bindings.sub2api.remote_url_digest) || !bindings.artifact_path.startsWith('docs/superpowers/evidence/phase-1/')) {
    fail('transition_rehearsal_binding_invalid', 'compiled rehearsal bindings are malformed')
  }
  const input = Object.freeze({
    tool_root: assertRealDirectory(rawInput.tool_root, 'transition_rehearsal_input_invalid'),
    cc_source_root: assertRealDirectory(rawInput.cc_source_root, 'transition_rehearsal_input_invalid'),
    sub2api_source_root: assertRealDirectory(rawInput.sub2api_source_root, 'transition_rehearsal_input_invalid'),
    cc_authorization_root: assertRealDirectory(rawInput.cc_authorization_root, 'transition_rehearsal_input_invalid'),
    sub2api_authorization_root: assertRealDirectory(rawInput.sub2api_authorization_root, 'transition_rehearsal_input_invalid'),
    replacement_parent_root: path.resolve(rawInput.replacement_parent_root),
    output_root: path.resolve(rawInput.output_root),
  })
  if (new Set(Object.values(input)).size !== Object.values(input).length) fail('transition_rehearsal_root_alias', 'transaction roles must have distinct canonical roots')

  const tool = assertToolRoot(input.tool_root, bindings)
  assertAuthorizationRoot(input.cc_authorization_root, bindings.cc_gateway)
  assertAuthorizationRoot(input.sub2api_authorization_root, bindings.sub2api)
  const snapshots = [input.tool_root, input.cc_source_root, input.sub2api_source_root, input.cc_authorization_root, input.sub2api_authorization_root]
    .map((root) => Object.freeze({ root, head: resolveCommit(root, 'HEAD'), status: gitStatus(root) }))
  dependencies.validate_sources({ cc_source_root: input.cc_source_root, sub2api_source_root: input.sub2api_source_root })

  if (existsSync(input.replacement_parent_root)) fail('transition_rehearsal_replacement_exists', 'replacement parent must be absent')
  if (existsSync(input.output_root)) fail('transition_rehearsal_output_exists', 'output root must be absent')
  const replacementCandidate = exclusiveDirectoryCandidate(input.replacement_parent_root, 'transition_rehearsal_replacement_exists')
  const outputCandidate = exclusiveDirectoryCandidate(input.output_root, 'transition_rehearsal_output_exists')
  assertRootContainment(snapshots.map((snapshot) => snapshot.root), replacementCandidate, outputCandidate)
  const retained: string[] = []
  try {
    const replacementParent = createExclusiveDirectory(replacementCandidate, 'transition_rehearsal_replacement_exists', retained)
    const outputRoot = createExclusiveDirectory(outputCandidate, 'transition_rehearsal_output_exists', retained)
    const ccRoot = createExclusiveDirectory(path.join(replacementParent, 'cc'), 'transition_rehearsal_replacement_exists', retained)
    const subRoot = createExclusiveDirectory(path.join(replacementParent, 'sub2api'), 'transition_rehearsal_replacement_exists', retained)
    prepareReplacementRoot(ccRoot, input.cc_authorization_root, input.cc_source_root, bindings.cc_gateway)
    prepareReplacementRoot(subRoot, input.sub2api_authorization_root, input.sub2api_source_root, bindings.sub2api)
    const ccCommits = replayCompiledCommits(ccRoot, bindings.cc_gateway.source_commits)
    const subCommits = replayCompiledCommits(subRoot, bindings.sub2api.source_commits)
    const ccReplayHead = resolveCommit(ccRoot, 'HEAD')
    const subReplayHead = resolveCommit(subRoot, 'HEAD')

    for (const command of ['build', 'validate-pre-commit'] as const) {
      const args = launcherArguments(command, input, ccRoot, subRoot, bindings, ccCommits, subCommits)
      const result = await dependencies.invoke_launcher({
        command,
        tool_root: input.tool_root,
        cc_source_root: input.cc_source_root,
        sub2api_source_root: input.sub2api_source_root,
        cc_replacement_root: ccRoot,
        sub2api_replacement_root: subRoot,
        artifact_path: bindings.artifact_path,
        arguments: args,
      })
      if (result.status !== 0) launcherFailure(result, retained)
    }

    const artifact = path.join(ccRoot, bindings.artifact_path)
    const artifactMetadata = lstatSync(artifact)
    if (!artifactMetadata.isFile() || artifactMetadata.isSymbolicLink()) fail('transition_rehearsal_artifact_invalid', 'restart artifact must be a regular file', retained)
    const artifactBytes = readFileSync(artifact)
    runReviewedGit(ccRoot, ['add', '--', bindings.artifact_path])
    runReviewedGit(ccRoot, [
      '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
      'commit', '--quiet', '-m', 'chore(oracle): record transition rehearsal restart',
    ])
    const artifactCommit = resolveCommit(ccRoot, 'HEAD')
    const parents = gitText(ccRoot, ['rev-list', '--parents', '-n', '1', artifactCommit]).split(' ')
    const delta = runReviewedGit(ccRoot, ['diff-tree', '-r', '--no-commit-id', '--name-status', '-z', ccReplayHead, artifactCommit, '--']).stdout
    if (parents.length !== 2 || parents[1] !== ccReplayHead
      || !delta.equals(Buffer.from(`A\0${bindings.artifact_path}\0`, 'utf8')) || gitStatus(ccRoot).length !== 0) {
      fail('transition_rehearsal_artifact_commit_invalid', 'restart artifact commit is not the exact one-path child', retained)
    }

    const postArgs = launcherArguments('validate-post-commit', input, ccRoot, subRoot, bindings, ccCommits, subCommits)
    const post = await dependencies.invoke_launcher({
      command: 'validate-post-commit',
      tool_root: input.tool_root,
      cc_source_root: input.cc_source_root,
      sub2api_source_root: input.sub2api_source_root,
      cc_replacement_root: ccRoot,
      sub2api_replacement_root: subRoot,
      artifact_path: bindings.artifact_path,
      arguments: postArgs,
    })
    if (post.status !== 0) launcherFailure(post, retained)
    if (gitStatus(subRoot).length !== 0 || resolveCommit(subRoot, 'HEAD') !== subReplayHead) {
      fail('transition_rehearsal_replay_dirty', 'Sub2API replay root changed after validation', retained)
    }
    assertPreservedSnapshots(snapshots)

    const record = {
      schema_version: 1,
      record_kind: 'phase_1_transition_transaction',
      status: 'green',
      tool_authority: { branch: tool.branch, commit: tool.commit, remote_url_digest: bindings.tool_remote_url_digest },
      sources: {
        cc_gateway: { head: snapshots[1].head, commit_count: bindings.cc_gateway.source_commits.length },
        sub2api: { head: snapshots[2].head, commit_count: bindings.sub2api.source_commits.length },
      },
      repositories: {
        cc_gateway: {
          remote_main_head: bindings.cc_gateway.remote_main_head,
          authorization_base_head: bindings.cc_gateway.authorization_base_head,
          replay_head: ccReplayHead,
          replay_commit_count: ccCommits.length,
          artifact_parent_head: ccReplayHead,
          artifact_commit: artifactCommit,
          artifact_digest: sha256(artifactBytes),
        },
        sub2api: {
          remote_main_head: bindings.sub2api.remote_main_head,
          authorization_base_head: bindings.sub2api.authorization_base_head,
          replay_head: subReplayHead,
          replay_commit_count: subCommits.length,
        },
      },
      retained_roots: [
        { role: 'replacement_parent', basename: path.basename(replacementParent) },
        { role: 'cc_replacement', basename: path.basename(ccRoot) },
        { role: 'sub2api_replacement', basename: path.basename(subRoot) },
        { role: 'output', basename: path.basename(outputRoot) },
      ],
      elapsed_ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
    }
    const recordBytes = Buffer.from(`${canonicalDeliveryJson(record)}\n`, 'utf8')
    const recordPath = path.join(outputRoot, TRANSACTION_RECORD)
    writeFileSync(recordPath, recordBytes, { flag: 'wx', mode: 0o600 })
    assertPreservedSnapshots(snapshots)
    return Object.freeze(structuredClone(record))
  } catch (error) {
    const recorded = Array.isArray((error as { retained_cleanup_roots?: unknown }).retained_cleanup_roots)
      ? (error as { retained_cleanup_roots: string[] }).retained_cleanup_roots
      : []
    throw Object.assign(error as Error, { retained_cleanup_roots: Object.freeze([...new Set([...retained, ...recorded])]) })
  }
}

async function main(): Promise<void> {
  try {
    const input = parsePhase1TransitionRehearsalCli(process.argv.slice(2))
    const record = await runPhase1TransitionRehearsal(input)
    process.stdout.write(`${JSON.stringify({ status: record.status, tool_commit: record.tool_authority.commit, transaction_record: TRANSACTION_RECORD })}\n`)
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      code: String((error as { code?: string }).code ?? 'transition_rehearsal_failed'),
      retained_cleanup_roots: (error as { retained_cleanup_roots?: readonly string[] }).retained_cleanup_roots ?? [],
    })}\n`)
    process.exitCode = 1
  }
}

let invokedDirectly = false
try { invokedDirectly = realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url)) } catch { /* import-only */ }
if (invokedDirectly) await main()
