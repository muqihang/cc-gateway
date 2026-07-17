import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'

import {
  REVIEWED_GIT_ENVIRONMENT,
  REVIEWED_GIT_EXECUTABLE,
  REVIEWED_NODE_EXECUTABLE,
  runReviewedGit,
  type ReviewedGitOptions,
} from './secure-runtime.js'

export type ChangedPath = Readonly<{
  status: string
  old_mode: string | null
  new_mode: string | null
  old_path: string | null
  new_path: string | null
}>

type RepositoryBinding = Readonly<{
  supersededHead: string
  archivalBranch: string
  replacementBranch: string
  remoteUrlDigest: string
  sourceCommits: readonly string[]
  forbiddenSourceCommits?: readonly string[]
}>

export type AuthorityRestartBindings = Readonly<{
  schemaVersion: 1
  repairId: 'authority-repair-0001'
  artifactPath: string
  schemaPath: string
  authorityPaths: Readonly<{ plan: string; planReview: string; executionContext: string }>
  projectedTreePolicy: Readonly<{
    authorityRepairPaths: readonly string[]
    historicalAuthorityPaths: readonly string[]
  }>
  ccGateway: RepositoryBinding & Readonly<{
    quarantineCheckpoint: string
    quarantineParent: string
    quarantinePatchId: string
    quarantineChangedPaths: readonly ChangedPath[]
  }>
  sub2api: RepositoryBinding
}>

const QUARANTINE_CHANGED_PATHS: readonly ChangedPath[] = Object.freeze([
  ['docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json', null, '100644', 'A'],
  ['docs/superpowers/schemas/oracle-lab-phase-1-command-catalog.schema.json', null, '100644', 'A'],
  ['docs/superpowers/schemas/oracle-lab-phase-1-exit.schema.json', null, '100644', 'A'],
  ['docs/superpowers/schemas/oracle-lab-phase-1-feature-review.schema.json', null, '100644', 'A'],
  ['docs/superpowers/schemas/oracle-lab-phase-1-handoff.schema.json', null, '100644', 'A'],
  ['docs/superpowers/schemas/oracle-lab-phase-1-integration-entry.schema.json', null, '100644', 'A'],
  ['docs/superpowers/schemas/oracle-lab-phase-1-integration-receipt.schema.json', null, '100644', 'A'],
  ['docs/superpowers/schemas/oracle-lab-phase-1-results.schema.json', null, '100644', 'A'],
  ['package.json', '100644', '100644', 'M'],
  ['tests/oracle-lab-phase-1-evidence.test.ts', null, '100644', 'A'],
  ['tools/oracle-lab/phase-1-evidence.ts', null, '100644', 'A'],
  ['tools/oracle-lab/phase-1-loopback-sandbox.ts', null, '100644', 'A'],
].map(([file, oldMode, newMode, status]) => Object.freeze({
  status: status as string,
  old_mode: oldMode as string | null,
  new_mode: newMode as string | null,
  old_path: oldMode === null ? null : file as string,
  new_path: file as string,
})))

export const AUTHORITY_RESTART_BINDINGS: AuthorityRestartBindings = Object.freeze({
  schemaVersion: 1,
  repairId: 'authority-repair-0001',
  artifactPath: 'docs/superpowers/evidence/phase-1/phase-1-authority-restart-0001.json',
  schemaPath: 'docs/superpowers/schemas/oracle-lab-phase-1-authority-restart.schema.json',
  authorityPaths: Object.freeze({
    plan: 'docs/superpowers/plans/2026-07-15-claude-code-2.1.207-phase-1-control-plane-boundary-repairs.md',
    planReview: 'docs/superpowers/evidence/phase-1/phase-1-plan-review.json',
    executionContext: 'docs/superpowers/evidence/phase-1/phase-1-execution-context.json',
  }),
  projectedTreePolicy: Object.freeze({
    authorityRepairPaths: Object.freeze([
      'docs/superpowers/plans/2026-07-15-claude-code-2.1.207-phase-1-control-plane-boundary-repairs.md',
      'docs/superpowers/schemas/oracle-lab-phase-1-authority-restart.schema.json',
      'tests/oracle-lab-governance-amendment-evidence.test.ts',
      'tests/oracle-lab-ignored-path-inventory.test.ts',
      'tests/oracle-lab-phase-1-planning.test.ts',
      'tests/oracle-lab-phase-1-authority-restart.test.ts',
      'tests/suite-process-runner.ts',
      'tests/suite-process-runner.test.ts',
      'tools/oracle-lab/oracle-phase1-authority-restart',
      'tools/oracle-lab/phase-1-authority-restart.ts',
    ]),
    historicalAuthorityPaths: Object.freeze([
      'docs/superpowers/evidence/phase-1/phase-1-context.json',
      'docs/superpowers/evidence/phase-1/phase-1-entry-baseline.json',
      'docs/superpowers/evidence/phase-1/phase-1-plan-review.json',
      'docs/superpowers/evidence/phase-1/phase-1-execution-context.json',
    ]),
  }),
  ccGateway: Object.freeze({
    supersededHead: '0403674d4c812e1a14704bfc890d66aac75f0325',
    archivalBranch: 'codex/oracle-phase-1-cc-gateway-pre-authority-repair-0001',
    replacementBranch: 'codex/oracle-phase-1-cc-gateway',
    remoteUrlDigest: 'sha256:52de8ee497a784b90b33345865754f3e6b9d5d96eed92549a15a4157cabb568a',
    sourceCommits: Object.freeze([
      '2a1553a4d16ccfdcd186ae78d99deeecbd7dfb4c',
      '49e4639c6f36dc51779c14813acd6e277315b969',
      '0403674d4c812e1a14704bfc890d66aac75f0325',
    ]),
    forbiddenSourceCommits: Object.freeze(['dd5ea716bc84e391daec333ecf03f41643612dde']),
    quarantineCheckpoint: '0403674d4c812e1a14704bfc890d66aac75f0325',
    quarantineParent: '49e4639c6f36dc51779c14813acd6e277315b969',
    quarantinePatchId: 'c48f2a7960e8cdf09ab4be8a3656b789080a0fe0',
    quarantineChangedPaths: QUARANTINE_CHANGED_PATHS,
  }),
  sub2api: Object.freeze({
    supersededHead: 'e2af1be5176854958a3d7b63a029174ffc5792a8',
    archivalBranch: 'codex/oracle-phase-1-sub2api-pre-authority-repair-0001',
    replacementBranch: 'codex/oracle-phase-1-sub2api',
    remoteUrlDigest: 'sha256:22c1a9e3cf8e76d2a20bf24a1ff66fa5d7417ba8b8b83a948c8b3ffa5c33a1a9',
    sourceCommits: Object.freeze([
      'b095307407b7b0bf08a7fc629a5d83dea86c26ab',
      'fadcbd18c0d49bf3562e568fd6b8282c4417a12c',
      '6f1754396b572abf929cb80ea4602306b89fcf9c',
      '7aba29c7387b82e37187d11c80ced09cef86b47f',
      '4e55cb8b0442c3a0f1734615efaf38967f2fe1aa',
      '3b09da2574e07a72e0cac34a28aeb5d4604f4759',
      'fe7753fa5b0b046eea42427e29aab3af467d5312',
      '540d58cb820811e7beaca26e678f499c8cc66351',
      'd25ecc1ddf1cf1e058c903c26915cf11c9c97025',
      'e2af1be5176854958a3d7b63a029174ffc5792a8',
    ]),
  }),
})

type AuthorityArtifact = Readonly<{ path: string; digest: string; commit: string }>
type BuildInput = Readonly<{
  ccGatewayRoot: string
  sub2apiRoot: string
  repairedAuthority: Readonly<{
    plan: AuthorityArtifact
    plan_review: AuthorityArtifact
    execution_context: AuthorityArtifact
  }>
  replacementCommits: Readonly<{
    cc_gateway: readonly string[]
    sub2api: readonly string[]
  }>
}>

type ValidateOptions = Readonly<{
  ccGatewayRoot: string
  sub2apiRoot: string
  bindings?: AuthorityRestartBindings
}>

type SourceValidateOptions = Readonly<{
  ccGatewayRoot: string
  sub2apiRoot: string
  bindings?: AuthorityRestartBindings
}>

type AuthorityRestartCommand = 'validate-source' | 'build' | 'validate-pre-commit' | 'validate-post-commit'

export type ParsedAuthorityRestartCli = Readonly<{
  command: AuthorityRestartCommand
  values: Readonly<Record<string, string>>
  repeated: Readonly<Record<string, readonly string[]>>
}>

type JsonObject = Record<string, any>

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function canonicalArtifactBytes(value: unknown): Buffer {
  return Buffer.from(`${canonicalJson(value)}\n`, 'utf8')
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

const UNSAFE_GIT_ENVIRONMENT = Object.freeze([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_REPLACE_REF_BASE',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_GLOBAL',
])

function assertSafeGitEnvironment(): void {
  for (const name of UNSAFE_GIT_ENVIRONMENT) {
    if (Object.hasOwn(process.env, name)) fail('authority_restart_unsafe_git_environment', 'inherited Git startup state is forbidden')
  }
}

function reviewedGit(root: string, args: readonly string[], options: ReviewedGitOptions = {}) {
  assertSafeGitEnvironment()
  try { return runReviewedGit(root, args, options) }
  catch (error) {
    if (String((error as { code?: string }).code).startsWith('authority_restart_')) throw error
    fail('authority_restart_git_inspection_failed', 'reviewed Git inspection failed')
  }
}

function gitText(root: string, args: readonly string[]): string {
  return reviewedGit(root, args).stdout.toString('utf8').trim()
}

function resolveCommit(root: string, revision: string): string {
  try { return gitText(root, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]) }
  catch (error) {
    if (String((error as { code?: string }).code).startsWith('authority_restart_')) throw error
    fail('authority_restart_git_object_invalid', 'authority restart Git object is invalid')
  }
}

function soleParent(root: string, commit: string): string {
  if (!/^[0-9a-f]{40,64}$/.test(commit)) fail('authority_restart_git_object_invalid', 'commit identity is malformed')
  const resolved = resolveCommit(root, commit)
  const fields = gitText(root, ['rev-list', '--parents', '-n', '1', resolved]).split(' ')
  if (fields.length !== 2) fail('authority_restart_parent_mismatch', 'replay commits must be one-parent non-merge commits')
  return fields[1]
}

function modeAt(root: string, revision: string, file: string): string | null {
  const output = reviewedGit(root, ['ls-tree', '-z', '--full-tree', revision, '--', file]).stdout
  if (output.length === 0) return null
  const tab = output.indexOf(0x09)
  if (tab < 0 || !output.subarray(tab + 1, output.length - 1).equals(Buffer.from(file))) {
    fail('authority_restart_changed_paths_invalid', 'ls-tree path binding is malformed')
  }
  return output.subarray(0, output.indexOf(0x20)).toString('ascii')
}

function changedPathSortKey(value: ChangedPath): Buffer {
  return Buffer.from([value.new_path ?? value.old_path ?? '', value.old_path ?? '', value.status, value.old_mode ?? '', value.new_mode ?? ''].join('\0'), 'utf8')
}

export function inspectChangedPaths(root: string, commit: string): readonly ChangedPath[] {
  const parent = soleParent(root, commit)
  const output = reviewedGit(root, ['diff-tree', '-r', '--no-commit-id', '--name-status', '-z', '--find-renames', parent, commit, '--']).stdout
  const fields: string[] = []
  for (let start = 0; start < output.length;) {
    const end = output.indexOf(0, start)
    if (end < 0) fail('authority_restart_changed_paths_invalid', 'name-status output is truncated')
    const bytes = output.subarray(start, end)
    const value = bytes.toString('utf8')
    if (!Buffer.from(value, 'utf8').equals(bytes)) fail('authority_restart_changed_paths_invalid', 'paths must be valid UTF-8')
    fields.push(value)
    start = end + 1
  }
  const records: ChangedPath[] = []
  for (let index = 0; index < fields.length;) {
    const status = fields[index++]
    if (!/^(?:A|D|M|T|R[0-9]{1,3}|C[0-9]{1,3})$/.test(status)) fail('authority_restart_changed_paths_invalid', 'unsupported Git status')
    const pair = status.startsWith('R') || status.startsWith('C')
    const oldPath = status === 'A' ? null : fields[index++]
    const newPath = status === 'D' ? null : pair ? fields[index++] : oldPath ?? fields[index++]
    if ((oldPath === undefined) || (newPath === undefined)) fail('authority_restart_changed_paths_invalid', 'name-status output is incomplete')
    records.push(Object.freeze({
      status,
      old_mode: oldPath === null ? null : modeAt(root, parent, oldPath),
      new_mode: newPath === null ? null : modeAt(root, commit, newPath),
      old_path: oldPath,
      new_path: newPath,
    }))
  }
  records.sort((left, right) => Buffer.compare(changedPathSortKey(left), changedPathSortKey(right)))
  return Object.freeze(records)
}

export function inspectStablePatchId(root: string, commit: string): string {
  const parent = soleParent(root, commit)
  const patch = reviewedGit(root, ['diff', '--binary', '--full-index', '--find-renames', parent, commit, '--']).stdout
  if (patch.length === 0) fail('authority_restart_empty_commit', 'empty replay commits are forbidden')
  const observed = spawnSync(REVIEWED_GIT_EXECUTABLE, ['patch-id', '--stable'], {
    cwd: realpathSync(root),
    env: { ...REVIEWED_GIT_ENVIRONMENT },
    input: patch,
    encoding: 'buffer',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024,
    shell: false,
  })
  if (observed.error || observed.signal !== null || observed.status !== 0) fail('authority_restart_patch_id_failed', 'stable patch-id failed')
  const match = observed.stdout.toString('ascii').match(/^([0-9a-f]{40}) [0-9a-f]{40}\n?$/)
  if (!match) fail('authority_restart_patch_id_failed', 'stable patch-id output is malformed')
  return match[1]
}

function projectedTree(root: string, commit: string, exclusions: readonly string[]): Buffer {
  const excluded = new Set(exclusions)
  const output = reviewedGit(root, ['ls-tree', '-r', '-z', '--full-tree', commit]).stdout
  const retained: Buffer[] = []
  for (let start = 0; start < output.length;) {
    const end = output.indexOf(0, start)
    if (end < 0) fail('authority_restart_projected_tree_invalid', 'ls-tree output is truncated')
    const tuple = output.subarray(start, end)
    const tab = tuple.indexOf(0x09)
    if (tab < 0) fail('authority_restart_projected_tree_invalid', 'ls-tree tuple is malformed')
    const pathBytes = tuple.subarray(tab + 1)
    const file = pathBytes.toString('utf8')
    if (!Buffer.from(file).equals(pathBytes)) fail('authority_restart_projected_tree_invalid', 'tree path is not valid UTF-8')
    if (!excluded.has(file)) retained.push(tuple, Buffer.from([0]))
    start = end + 1
  }
  return Buffer.concat(retained)
}

function remoteUrlDigest(root: string): string {
  return sha256(gitText(root, ['remote', 'get-url', '--', 'muqihang']))
}

function buildEndpoint(root: string, binding: RepositoryBinding): JsonObject {
  if (remoteUrlDigest(root) !== binding.remoteUrlDigest) fail('authority_restart_remote_mismatch', 'remote origin differs from the pinned authority')
  return {
    branch: binding.archivalBranch,
    head: binding.supersededHead,
    remote_name: 'muqihang',
    remote_ref: 'refs/remotes/muqihang/main',
    remote_url_digest: binding.remoteUrlDigest,
  }
}

function buildMappings(root: string, sourceCommits: readonly string[], replacementCommits: readonly string[]): JsonObject[] {
  if (sourceCommits.length !== replacementCommits.length || sourceCommits.length === 0) fail('authority_restart_mapping_count_mismatch', 'source and replacement mapping counts differ')
  return sourceCommits.map((sourceCommit, index) => {
    const replacementCommit = replacementCommits[index]
    const sourcePatch = inspectStablePatchId(root, sourceCommit)
    const replacementPatch = inspectStablePatchId(root, replacementCommit)
    if (sourcePatch !== replacementPatch) fail('authority_restart_patch_id_mismatch', 'source and replacement stable patch-id differ')
    const sourcePaths = inspectChangedPaths(root, sourceCommit)
    const replacementPaths = inspectChangedPaths(root, replacementCommit)
    if (!same(sourcePaths, replacementPaths)) fail('authority_restart_changed_paths_mismatch', 'source and replacement changed path/mode/status differ')
    return {
      source_commit: sourceCommit,
      source_parent: soleParent(root, sourceCommit),
      replacement_commit: replacementCommit,
      replacement_parent: soleParent(root, replacementCommit),
      stable_patch_id: sourcePatch,
      changed_paths: sourcePaths,
    }
  })
}

function buildRepository(root: string, binding: RepositoryBinding, replacementCommits: readonly string[], exclusions: readonly string[]): JsonObject {
  const mappings = buildMappings(root, binding.sourceCommits, replacementCommits)
  const authorizedBase = mappings[0].replacement_parent
  const remoteMain = resolveCommit(root, 'refs/remotes/muqihang/main')
  const replayHead = mappings.at(-1).replacement_commit
  const sourceTree = projectedTree(root, binding.supersededHead, exclusions)
  const replacementTree = projectedTree(root, replayHead, exclusions)
  if (!sourceTree.equals(replacementTree)) fail('authority_restart_projected_tree_mismatch', 'projected implementation trees differ')
  return {
    superseded: buildEndpoint(root, binding),
    replacement: {
      branch: binding.replacementBranch,
      remote_main_head: remoteMain,
      authorized_base_head: authorizedBase,
      replay_head: replayHead,
      remote_name: 'muqihang',
      remote_ref: 'refs/remotes/muqihang/main',
      remote_url_digest: binding.remoteUrlDigest,
    },
    replay_mappings: mappings,
    projected_tree_digest: sha256(sourceTree),
  }
}

function schemaValidator(): ((value: unknown) => boolean) & { errors?: unknown } {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const schema = JSON.parse(readFileSync(path.join(repositoryRoot, AUTHORITY_RESTART_BINDINGS.schemaPath), 'utf8'))
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false })
  return ajv.compile(schema) as ((value: unknown) => boolean) & { errors?: unknown }
}

function assertSchema(value: unknown): void {
  const validate = schemaValidator()
  if (!validate(value)) fail('authority_restart_schema_invalid', `authority restart artifact violates its closed schema: ${JSON.stringify(validate.errors)}`)
}

function assertAuthority(root: string, value: AuthorityArtifact): void {
  let bytes: Buffer
  try { bytes = reviewedGit(root, ['show', `${value.commit}:${value.path}`]).stdout }
  catch (error) {
    if (String((error as { code?: string }).code).startsWith('authority_restart_')) throw error
    fail('authority_restart_authority_commit_mismatch', 'authority artifact is absent from its pinned commit')
  }
  if (sha256(bytes) !== value.digest) fail('authority_restart_authority_digest_mismatch', 'authority artifact digest drifted')
}

function assertEndpoint(root: string, artifact: JsonObject, binding: RepositoryBinding): void {
  if (artifact.superseded.head !== binding.supersededHead || artifact.superseded.branch !== binding.archivalBranch) fail('authority_restart_source_head_mismatch', 'superseded repository binding drifted')
  if (resolveCommit(root, `refs/heads/${binding.archivalBranch}`) !== binding.supersededHead) fail('authority_restart_source_head_mismatch', 'archival branch does not pin the superseded head')
  if (artifact.replacement.branch !== binding.replacementBranch) fail('authority_restart_branch_mismatch', 'replacement branch binding drifted')
  if (artifact.superseded.remote_url_digest !== binding.remoteUrlDigest || artifact.replacement.remote_url_digest !== binding.remoteUrlDigest || remoteUrlDigest(root) !== binding.remoteUrlDigest) fail('authority_restart_remote_mismatch', 'remote origin binding drifted')
  if (resolveCommit(root, 'refs/remotes/muqihang/main') !== artifact.replacement.remote_main_head) fail('authority_restart_remote_mismatch', 'frozen remote main drifted')
}

function assertMappings(root: string, artifact: JsonObject, binding: RepositoryBinding): void {
  if (artifact.replay_mappings.length !== binding.sourceCommits.length) fail('authority_restart_mapping_count_mismatch', 'mapping count drifted')
  const observedSources = artifact.replay_mappings.map((mapping: JsonObject) => mapping.source_commit)
  if (!same(observedSources, binding.sourceCommits)) {
    const observedSet = [...observedSources].sort()
    const expectedSet = [...binding.sourceCommits].sort()
    if (same(observedSet, expectedSet)) fail('authority_restart_mapping_order_mismatch', 'source mapping order drifted')
    fail('authority_restart_source_commit_mismatch', 'source mapping commit drifted')
  }
  for (let index = 0; index < artifact.replay_mappings.length; index += 1) {
    const mapping = artifact.replay_mappings[index]
    if (binding.forbiddenSourceCommits?.includes(mapping.source_commit)) fail('authority_restart_source_commit_forbidden', 'superseded authority commits cannot be replayed')
    if (index > 0 && mapping.replacement_parent !== artifact.replay_mappings[index - 1].replacement_commit) fail('authority_restart_parent_mismatch', 'replacement mapping parents are not contiguous')
    const sourceParent = soleParent(root, mapping.source_commit)
    const replacementParent = soleParent(root, mapping.replacement_commit)
    if (mapping.source_parent !== sourceParent || mapping.replacement_parent !== replacementParent) fail('authority_restart_parent_mismatch', 'recorded mapping parent drifted')
    if (index > 0 && mapping.source_parent !== artifact.replay_mappings[index - 1].source_commit) fail('authority_restart_parent_mismatch', 'source mapping parents are not contiguous')
    const sourcePatch = inspectStablePatchId(root, mapping.source_commit)
    const replacementPatch = inspectStablePatchId(root, mapping.replacement_commit)
    if (mapping.stable_patch_id !== sourcePatch || sourcePatch !== replacementPatch) fail('authority_restart_patch_id_mismatch', 'stable patch-id drifted')
    const sourcePaths = inspectChangedPaths(root, mapping.source_commit)
    const replacementPaths = inspectChangedPaths(root, mapping.replacement_commit)
    if (!same(mapping.changed_paths, sourcePaths) || !same(sourcePaths, replacementPaths)) fail('authority_restart_changed_paths_mismatch', 'changed path/mode/status tuples drifted')
  }
  if (artifact.replacement.authorized_base_head !== artifact.replay_mappings[0].replacement_parent || artifact.replacement.replay_head !== artifact.replay_mappings.at(-1).replacement_commit) fail('authority_restart_replay_head_mismatch', 'replacement replay endpoints drifted')
}

function assertRepository(root: string, artifact: JsonObject, binding: RepositoryBinding, exclusions: readonly string[]): void {
  assertEndpoint(root, artifact, binding)
  assertMappings(root, artifact, binding)
  const sourceTree = projectedTree(root, binding.supersededHead, exclusions)
  const replacementTree = projectedTree(root, artifact.replacement.replay_head, exclusions)
  if (!sourceTree.equals(replacementTree) || artifact.projected_tree_digest !== sha256(sourceTree)) fail('authority_restart_projected_tree_mismatch', 'projected path/mode/type/OID tuples drifted')
}

function expectedInitialAuthorityDelta(bindings: AuthorityRestartBindings): readonly ChangedPath[] {
  return [bindings.authorityPaths.planReview, bindings.authorityPaths.executionContext]
    .map((file) => Object.freeze({ status: 'A', old_mode: null, new_mode: '100644', old_path: null, new_path: file }))
    .sort((left, right) => Buffer.compare(changedPathSortKey(left), changedPathSortKey(right)))
}

function assertInitialAuthorityTopology(artifact: JsonObject, ccRoot: string, subRoot: string, bindings: AuthorityRestartBindings): void {
  const authority = artifact.repaired_authority
  const ccReplacement = artifact.repositories.cc_gateway.replacement
  const subReplacement = artifact.repositories.sub2api.replacement
  const contextCommit = ccReplacement.authorized_base_head
  if (authority.plan.commit !== ccReplacement.remote_main_head
    || authority.plan_review.commit !== contextCommit
    || authority.execution_context.commit !== contextCommit
    || soleParent(ccRoot, contextCommit) !== authority.plan.commit
    || !same(inspectChangedPaths(ccRoot, contextCommit), expectedInitialAuthorityDelta(bindings))) {
    fail('authority_restart_initial_authority_topology_mismatch', 'CC initial authority must be the exact two-artifact child of repaired main')
  }
  if (subReplacement.authorized_base_head !== subReplacement.remote_main_head
    || resolveCommit(subRoot, subReplacement.authorized_base_head) !== subReplacement.remote_main_head) {
    fail('authority_restart_initial_authority_topology_mismatch', 'Sub2API replay must start at frozen remote main')
  }
}

function assertCleanHead(root: string, branch: string, head: string): void {
  if (gitText(root, ['rev-parse', '--abbrev-ref', 'HEAD']) !== branch || resolveCommit(root, 'HEAD') !== head) fail('authority_restart_branch_mismatch', 'replacement branch or head drifted')
  if (reviewedGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']).stdout.length !== 0) fail('authority_restart_dirty_tree', 'replacement repository must be clean')
}

function assertSourceRepository(root: string, binding: RepositoryBinding): void {
  assertCleanHead(root, binding.archivalBranch, binding.supersededHead)
  if (remoteUrlDigest(root) !== binding.remoteUrlDigest) fail('authority_restart_remote_mismatch', 'source remote origin differs from the pinned authority')
  if (binding.sourceCommits.length === 0 || binding.sourceCommits.at(-1) !== binding.supersededHead) fail('authority_restart_source_head_mismatch', 'source history does not terminate at the superseded head')
  for (let index = 0; index < binding.sourceCommits.length; index += 1) {
    const commit = binding.sourceCommits[index]
    if (binding.forbiddenSourceCommits?.includes(commit)) fail('authority_restart_source_commit_forbidden', 'superseded authority commits cannot be replayed')
    if (resolveCommit(root, commit) !== commit) fail('authority_restart_source_commit_mismatch', 'source commit identity drifted')
    if (index > 0 && soleParent(root, commit) !== binding.sourceCommits[index - 1]) fail('authority_restart_parent_mismatch', 'source commits are not contiguous')
    inspectStablePatchId(root, commit)
    inspectChangedPaths(root, commit)
  }
}

export function validatePhase1AuthorityRestartSource(options: SourceValidateOptions): void {
  const bindings = options.bindings ?? AUTHORITY_RESTART_BINDINGS
  const ccRoot = realpathSync(options.ccGatewayRoot)
  const subRoot = realpathSync(options.sub2apiRoot)
  assertSourceRepository(ccRoot, bindings.ccGateway)
  assertSourceRepository(subRoot, bindings.sub2api)
  if (soleParent(ccRoot, bindings.ccGateway.quarantineCheckpoint) !== bindings.ccGateway.quarantineParent) fail('authority_restart_checkpoint_mismatch', 'quarantine checkpoint topology drifted')
  if (inspectStablePatchId(ccRoot, bindings.ccGateway.quarantineCheckpoint) !== bindings.ccGateway.quarantinePatchId
    || !same(inspectChangedPaths(ccRoot, bindings.ccGateway.quarantineCheckpoint), bindings.ccGateway.quarantineChangedPaths)) {
    fail('authority_restart_checkpoint_evidence_mismatch', 'quarantine checkpoint Git evidence drifted')
  }
  const exclusions = new Set([...bindings.projectedTreePolicy.authorityRepairPaths, ...bindings.projectedTreePolicy.historicalAuthorityPaths])
  if (bindings.ccGateway.quarantineChangedPaths.some((entry) => (entry.old_path !== null && exclusions.has(entry.old_path)) || (entry.new_path !== null && exclusions.has(entry.new_path)))) {
    fail('authority_restart_checkpoint_exclusion_overlap', 'checkpoint implementation paths cannot be excluded from projected-tree proof')
  }
}

function assertCcPreCommitState(root: string, branch: string, head: string, artifact: JsonObject, bindings: AuthorityRestartBindings): void {
  if (gitText(root, ['rev-parse', '--abbrev-ref', 'HEAD']) !== branch || resolveCommit(root, 'HEAD') !== head) fail('authority_restart_branch_mismatch', 'replacement branch or head drifted')
  const status = reviewedGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']).stdout
  if (status.length === 0) return
  const expected = Buffer.from(`?? ${bindings.artifactPath}\0`, 'utf8')
  if (!status.equals(expected)) fail('authority_restart_dirty_tree', 'pre-commit CC delta must contain only the untracked restart artifact')
  const target = path.join(root, bindings.artifactPath)
  let metadata
  try { metadata = lstatSync(target) } catch { fail('authority_restart_artifact_bytes_mismatch', 'pre-commit restart artifact is unavailable') }
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail('authority_restart_artifact_path_escape', 'pre-commit restart artifact must be a regular file')
  if (!readFileSync(target).equals(canonicalArtifactBytes(artifact))) fail('authority_restart_artifact_bytes_mismatch', 'pre-commit restart bytes differ from the validated artifact')
}

export function buildPhase1AuthorityRestart(input: BuildInput, bindings: AuthorityRestartBindings = AUTHORITY_RESTART_BINDINGS): JsonObject {
  const ccRoot = realpathSync(input.ccGatewayRoot)
  const subRoot = realpathSync(input.sub2apiRoot)
  const exclusions = [...bindings.projectedTreePolicy.authorityRepairPaths, ...bindings.projectedTreePolicy.historicalAuthorityPaths]
  const cc = buildRepository(ccRoot, bindings.ccGateway, input.replacementCommits.cc_gateway, exclusions)
  const sub = buildRepository(subRoot, bindings.sub2api, input.replacementCommits.sub2api, exclusions)
  cc.quarantine_checkpoint = {
    commit: bindings.ccGateway.quarantineCheckpoint,
    parent: bindings.ccGateway.quarantineParent,
    stable_patch_id: bindings.ccGateway.quarantinePatchId,
    changed_paths: bindings.ccGateway.quarantineChangedPaths,
  }
  const artifact = {
    schema_version: bindings.schemaVersion,
    repair_id: bindings.repairId,
    repaired_authority: input.repairedAuthority,
    repositories: { cc_gateway: cc, sub2api: sub },
    projected_tree_policy: {
      authority_repair_paths: bindings.projectedTreePolicy.authorityRepairPaths,
      historical_authority_paths: bindings.projectedTreePolicy.historicalAuthorityPaths,
    },
  }
  validatePhase1AuthorityRestart(artifact, { ccGatewayRoot: ccRoot, sub2apiRoot: subRoot, bindings })
  return Object.freeze(structuredClone(artifact))
}

function validateArtifactSemantics(artifact: JsonObject, ccRoot: string, subRoot: string, bindings: AuthorityRestartBindings): void {
  if (artifact.schema_version !== bindings.schemaVersion || artifact.repair_id !== bindings.repairId) fail('authority_restart_binding_mismatch', 'restart identity drifted')
  const authorityPaths = artifact.repaired_authority
  if (authorityPaths.plan.path !== bindings.authorityPaths.plan || authorityPaths.plan_review.path !== bindings.authorityPaths.planReview || authorityPaths.execution_context.path !== bindings.authorityPaths.executionContext) fail('authority_restart_authority_path_mismatch', 'authority artifact path drifted')
  if (!same(artifact.projected_tree_policy.authority_repair_paths, bindings.projectedTreePolicy.authorityRepairPaths) || !same(artifact.projected_tree_policy.historical_authority_paths, bindings.projectedTreePolicy.historicalAuthorityPaths)) fail('authority_restart_exclusion_policy_mismatch', 'projected tree exclusions drifted')
  const checkpoint = artifact.repositories.cc_gateway.quarantine_checkpoint
  if (checkpoint.commit !== bindings.ccGateway.quarantineCheckpoint || checkpoint.parent !== bindings.ccGateway.quarantineParent) fail('authority_restart_checkpoint_mismatch', 'quarantine checkpoint binding drifted')
  if (checkpoint.stable_patch_id !== bindings.ccGateway.quarantinePatchId || !same(checkpoint.changed_paths, bindings.ccGateway.quarantineChangedPaths)) fail('authority_restart_checkpoint_evidence_mismatch', 'quarantine checkpoint evidence drifted')
  if (soleParent(ccRoot, bindings.ccGateway.quarantineCheckpoint) !== bindings.ccGateway.quarantineParent) fail('authority_restart_checkpoint_mismatch', 'quarantine checkpoint topology drifted')
  if (inspectStablePatchId(ccRoot, bindings.ccGateway.quarantineCheckpoint) !== bindings.ccGateway.quarantinePatchId || !same(inspectChangedPaths(ccRoot, bindings.ccGateway.quarantineCheckpoint), bindings.ccGateway.quarantineChangedPaths)) fail('authority_restart_checkpoint_evidence_mismatch', 'quarantine checkpoint Git evidence drifted')
  for (const authority of Object.values(artifact.repaired_authority) as AuthorityArtifact[]) assertAuthority(ccRoot, authority)
  const exclusions = [...bindings.projectedTreePolicy.authorityRepairPaths, ...bindings.projectedTreePolicy.historicalAuthorityPaths]
  const excluded = new Set(exclusions)
  if (bindings.ccGateway.quarantineChangedPaths.some((entry) => (entry.old_path !== null && excluded.has(entry.old_path)) || (entry.new_path !== null && excluded.has(entry.new_path)))) fail('authority_restart_checkpoint_exclusion_overlap', 'checkpoint implementation paths cannot be excluded from projected-tree proof')
  assertRepository(ccRoot, artifact.repositories.cc_gateway, bindings.ccGateway, exclusions)
  assertRepository(subRoot, artifact.repositories.sub2api, bindings.sub2api, exclusions)
  assertInitialAuthorityTopology(artifact, ccRoot, subRoot, bindings)
  const ccReplacement = artifact.repositories.cc_gateway.replacement
  if (authorityPaths.plan.commit !== ccReplacement.remote_main_head || authorityPaths.plan_review.commit !== ccReplacement.authorized_base_head || authorityPaths.execution_context.commit !== ccReplacement.authorized_base_head) fail('authority_restart_authority_commit_mismatch', 'reviewed plan or initial authorization commit drifted')
  if (reviewedGit(ccRoot, ['merge-base', '--is-ancestor', authorityPaths.plan.commit, authorityPaths.plan_review.commit], { allowedExitCodes: [0, 1] }).status !== 0) fail('authority_restart_authority_commit_mismatch', 'initial authorization is not descended from the reviewed plan')
}

export function validatePhase1AuthorityRestart(value: unknown, options: ValidateOptions): void {
  assertSchema(value)
  const artifact = value as JsonObject
  const bindings = options.bindings ?? AUTHORITY_RESTART_BINDINGS
  const ccRoot = realpathSync(options.ccGatewayRoot)
  const subRoot = realpathSync(options.sub2apiRoot)
  validateArtifactSemantics(artifact, ccRoot, subRoot, bindings)
  assertCcPreCommitState(ccRoot, bindings.ccGateway.replacementBranch, artifact.repositories.cc_gateway.replacement.replay_head, artifact, bindings)
  assertCleanHead(subRoot, bindings.sub2api.replacementBranch, artifact.repositories.sub2api.replacement.replay_head)
}

export function validatePhase1AuthorityRestartPreCommit(value: unknown, options: ValidateOptions): void {
  validatePhase1AuthorityRestart(value, options)
  const artifact = value as JsonObject
  const bindings = options.bindings ?? AUTHORITY_RESTART_BINDINGS
  const root = realpathSync(options.ccGatewayRoot)
  const status = reviewedGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']).stdout
  const expected = Buffer.from(`?? ${bindings.artifactPath}\0`, 'utf8')
  if (!status.equals(expected)) fail('authority_restart_artifact_bytes_mismatch', 'pre-commit restart artifact must be the sole untracked delta')
  const target = path.join(root, bindings.artifactPath)
  if (!readFileSync(target).equals(canonicalArtifactBytes(artifact))) fail('authority_restart_artifact_bytes_mismatch', 'pre-commit restart bytes differ from the validated artifact')
}

export function writePhase1AuthorityRestart(rootInput: string, value: unknown, bindings: AuthorityRestartBindings = AUTHORITY_RESTART_BINDINGS): Buffer {
  assertSchema(value)
  const root = realpathSync(rootInput)
  const destination = path.join(root, bindings.artifactPath)
  const parent = path.dirname(destination)
  mkdirSync(parent, { recursive: true })
  const canonicalParent = realpathSync(parent)
  if (canonicalParent !== path.dirname(destination)) fail('authority_restart_artifact_path_escape', 'artifact parent escapes the repository')
  const bytes = canonicalArtifactBytes(value)
  try { writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('authority_restart_artifact_exists', 'authority restart artifact already exists')
    fail('authority_restart_artifact_write_failed', 'authority restart artifact could not be written')
  }
  return bytes
}

export function validatePhase1AuthorityRestartPostCommit(value: unknown, expectedBytes: Buffer, options: ValidateOptions): void {
  assertSchema(value)
  const artifact = value as JsonObject
  const bindings = options.bindings ?? AUTHORITY_RESTART_BINDINGS
  const ccRoot = realpathSync(options.ccGatewayRoot)
  const subRoot = realpathSync(options.sub2apiRoot)
  const head = resolveCommit(ccRoot, 'HEAD')
  const parent = soleParent(ccRoot, head)
  if (parent !== artifact.repositories.cc_gateway.replacement.replay_head) fail('authority_restart_artifact_parent_mismatch', 'restart artifact commit has the wrong parent')
  const delta = reviewedGit(ccRoot, ['diff-tree', '-r', '--no-commit-id', '--name-status', '-z', parent, head, '--']).stdout
  const expectedDelta = Buffer.from(`A\0${bindings.artifactPath}\0`, 'utf8')
  if (!delta.equals(expectedDelta)) fail('authority_restart_artifact_delta_mismatch', 'restart artifact commit must add exactly one path')
  const committed = reviewedGit(ccRoot, ['show', `${head}:${bindings.artifactPath}`]).stdout
  if (!committed.equals(expectedBytes) || !committed.equals(canonicalArtifactBytes(value))) fail('authority_restart_artifact_bytes_mismatch', 'committed restart bytes differ from the validated artifact')
  validateArtifactSemantics(artifact, ccRoot, subRoot, bindings)
  if (gitText(ccRoot, ['rev-parse', '--abbrev-ref', 'HEAD']) !== bindings.ccGateway.replacementBranch) fail('authority_restart_branch_mismatch', 'artifact commit is on the wrong replacement branch')
  if (reviewedGit(ccRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']).stdout.length !== 0) fail('authority_restart_dirty_tree', 'CC repository is dirty after restart commit')
  assertCleanHead(subRoot, bindings.sub2api.replacementBranch, artifact.repositories.sub2api.replacement.replay_head)
}

const COMMON_CLI_FLAGS = Object.freeze(['cc-source-root', 'cc-replacement-root', 'sub2api-source-root', 'sub2api-replacement-root'])
const COMMAND_FLAGS: Readonly<Record<AuthorityRestartCommand, readonly string[]>> = Object.freeze({
  'validate-source': COMMON_CLI_FLAGS,
  build: Object.freeze([...COMMON_CLI_FLAGS, 'plan-path', 'plan-review-path', 'execution-context-path', 'output']),
  'validate-pre-commit': Object.freeze([...COMMON_CLI_FLAGS, 'artifact']),
  'validate-post-commit': Object.freeze([...COMMON_CLI_FLAGS, 'artifact']),
})

export function parseAuthorityRestartCli(argv: readonly string[]): ParsedAuthorityRestartCli {
  const command = argv[0] as AuthorityRestartCommand
  if (!Object.hasOwn(COMMAND_FLAGS, command)) fail('authority_restart_cli_arguments_invalid', 'unknown authority restart command')
  const allowed = new Set([...COMMAND_FLAGS[command], 'cc-replacement-commit', 'sub2api-replacement-commit'])
  const values: Record<string, string> = {}
  const repeated: Record<string, string[]> = {}
  for (let index = 1; index < argv.length; index += 2) {
    const token = argv[index]
    const value = argv[index + 1]
    if (!token?.startsWith('--') || value === undefined || value.startsWith('--')) fail('authority_restart_cli_arguments_invalid', 'authority restart flags require one explicit value')
    const name = token.slice(2)
    if (!allowed.has(name)) fail('authority_restart_cli_arguments_invalid', 'unknown authority restart flag')
    if (name.endsWith('-replacement-commit')) (repeated[name] ??= []).push(value)
    else {
      if (Object.hasOwn(values, name)) fail('authority_restart_cli_arguments_invalid', 'duplicate authority restart flag')
      values[name] = value
    }
  }
  const expected = COMMAND_FLAGS[command]
  if (Object.keys(values).length !== expected.length || expected.some((name) => !Object.hasOwn(values, name))) fail('authority_restart_cli_arguments_invalid', 'authority restart command flags are incomplete')
  const repeatedNames = Object.keys(repeated)
  if (command === 'build') {
    if (!same(repeatedNames.sort(), ['cc-replacement-commit', 'sub2api-replacement-commit']) || repeated['cc-replacement-commit'].length === 0 || repeated['sub2api-replacement-commit'].length === 0) fail('authority_restart_cli_arguments_invalid', 'build requires ordered replacement commits for both repositories')
  } else if (repeatedNames.length !== 0) fail('authority_restart_cli_arguments_invalid', 'replacement commits are accepted only by build')
  return Object.freeze({ command, values: Object.freeze(values), repeated: Object.freeze(repeated) })
}

function authorityFromCommit(root: string, file: string, commit: string): AuthorityArtifact {
  const bytes = reviewedGit(root, ['show', `${commit}:${file}`]).stdout
  return { path: file, digest: sha256(bytes), commit }
}

function assertCanonicalCliPaths(parsed: ParsedAuthorityRestartCli, bindings: AuthorityRestartBindings): void {
  if (parsed.command === 'build') {
    if (parsed.values['plan-path'] !== bindings.authorityPaths.plan
      || parsed.values['plan-review-path'] !== bindings.authorityPaths.planReview
      || parsed.values['execution-context-path'] !== bindings.authorityPaths.executionContext
      || path.resolve(parsed.values['cc-replacement-root'], parsed.values.output) !== path.resolve(parsed.values['cc-replacement-root'], bindings.artifactPath)) {
      fail('authority_restart_cli_arguments_invalid', 'authority or output path differs from the compiled contract')
    }
  } else if (parsed.command !== 'validate-source'
    && path.resolve(parsed.values['cc-replacement-root'], parsed.values.artifact) !== path.resolve(parsed.values['cc-replacement-root'], bindings.artifactPath)) {
    fail('authority_restart_cli_arguments_invalid', 'artifact path differs from the compiled contract')
  }
}

const AUTHORITY_RESTART_RUNTIME_PATHS = Object.freeze([
  'docs/superpowers/schemas/oracle-lab-phase-1-authority-restart.schema.json',
  'tools/oracle-lab/oracle-phase1-authority-restart',
  'tools/oracle-lab/phase-1-authority-restart.ts',
  'tools/oracle-lab/secure-runtime.ts',
  'package-lock.json',
])

function assertAuthorityRestartCliStartup(ccRootInput: string): void {
  if (process.env.ORACLE_PHASE1_AUTHORITY_LAUNCHER !== 'posix-v1'
    || process.env.HOME !== '/dev/null'
    || process.env.TMPDIR !== '/tmp'
    || realpathSync(process.execPath) !== REVIEWED_NODE_EXECUTABLE) {
    fail('authority_restart_unsafe_startup_environment', 'the reviewed hermetic authority-restart launcher is required')
  }
  for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'TSX_TSCONFIG_PATH', 'TSX_DISABLE_CACHE', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'LD_PRELOAD']) {
    if (Object.hasOwn(process.env, name)) fail('authority_restart_unsafe_startup_environment', 'unsafe authority-restart startup state is forbidden')
  }
  const ccRoot = realpathSync(ccRootInput)
  const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  if (ccRoot !== moduleRoot) fail('authority_restart_runtime_binding_mismatch', 'CLI must execute from the tested CC replacement root')
  const reviewedMain = resolveCommit(ccRoot, 'refs/remotes/muqihang/main')
  for (const file of AUTHORITY_RESTART_RUNTIME_PATHS) {
    const target = path.join(ccRoot, file)
    let metadata
    try { metadata = lstatSync(target) } catch { fail('authority_restart_runtime_binding_mismatch', 'reviewed runtime path is unavailable') }
    if (!metadata.isFile() || metadata.isSymbolicLink()) fail('authority_restart_runtime_binding_mismatch', 'reviewed runtime path must be a regular file')
    const committed = reviewedGit(ccRoot, ['show', `${reviewedMain}:${file}`]).stdout
    if (!readFileSync(target).equals(committed)) fail('authority_restart_runtime_binding_mismatch', 'working runtime bytes differ from repaired main')
  }
}

export function runAuthorityRestartCli(argv: readonly string[]): void {
  const parsed = parseAuthorityRestartCli(argv)
  const bindings = AUTHORITY_RESTART_BINDINGS
  assertCanonicalCliPaths(parsed, bindings)
  assertAuthorityRestartCliStartup(parsed.values['cc-replacement-root'])
  validatePhase1AuthorityRestartSource({ ccGatewayRoot: parsed.values['cc-source-root'], sub2apiRoot: parsed.values['sub2api-source-root'], bindings })
  if (parsed.command === 'validate-source') return
  const ccRoot = realpathSync(parsed.values['cc-replacement-root'])
  const subRoot = realpathSync(parsed.values['sub2api-replacement-root'])
  if (parsed.command === 'build') {
    const ccCommits = parsed.repeated['cc-replacement-commit']
    const subCommits = parsed.repeated['sub2api-replacement-commit']
    const authorizedBase = soleParent(ccRoot, ccCommits[0])
    const remoteMain = resolveCommit(ccRoot, 'refs/remotes/muqihang/main')
    const artifact = buildPhase1AuthorityRestart({
      ccGatewayRoot: ccRoot,
      sub2apiRoot: subRoot,
      repairedAuthority: {
        plan: authorityFromCommit(ccRoot, bindings.authorityPaths.plan, remoteMain),
        plan_review: authorityFromCommit(ccRoot, bindings.authorityPaths.planReview, authorizedBase),
        execution_context: authorityFromCommit(ccRoot, bindings.authorityPaths.executionContext, authorizedBase),
      },
      replacementCommits: { cc_gateway: ccCommits, sub2api: subCommits },
    }, bindings)
    writePhase1AuthorityRestart(ccRoot, artifact, bindings)
    validatePhase1AuthorityRestartPreCommit(artifact, { ccGatewayRoot: ccRoot, sub2apiRoot: subRoot, bindings })
    return
  }
  const artifactPath = path.join(ccRoot, bindings.artifactPath)
  const bytes = readFileSync(artifactPath)
  const artifact = JSON.parse(bytes.toString('utf8'))
  if (parsed.command === 'validate-pre-commit') validatePhase1AuthorityRestartPreCommit(artifact, { ccGatewayRoot: ccRoot, sub2apiRoot: subRoot, bindings })
  else validatePhase1AuthorityRestartPostCommit(artifact, bytes, { ccGatewayRoot: ccRoot, sub2apiRoot: subRoot, bindings })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runAuthorityRestartCli(process.argv.slice(2))
  } catch (error) {
    const code = String((error as { code?: string }).code ?? 'authority_restart_failed')
    process.stderr.write(`${code}\n`)
    process.exitCode = 1
  }
}
