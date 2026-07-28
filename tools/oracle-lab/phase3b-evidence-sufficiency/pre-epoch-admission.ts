import { constants, closeSync, fstatSync, lstatSync, openSync, readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'

import { Phase3BProductionError, assertExactKeys, canonicalBytes, deepFreeze, sha256Canonical } from './core.js'
import { PREDECESSOR_AUTHORITY, REPOSITORY_AUTHORITY } from './ledger.js'
import { assertAbsoluteNoSymlinkComponents, stableRead } from './sealed-fs.js'
import { fixedGit, verifyGithubWebFlowCommit } from './trust.js'

const OID = /^[a-f0-9]{40}$/
const CONCLUSION_KEYS = ['conclusion_id', 'contradicting_artifact_ids', 'dynamic_reproduction', 'expiry', 'level', 'negative_capabilities', 'phase3b_usable', 'platform_limits', 'prohibited_claims', 'schema_version', 'scope', 'single_source_reason', 'statement', 'static_anchor', 'supporting_artifact_ids'] as const
const EXPECTED_SCOPE = 'claude-code-2.1.215 darwin-arm64 synthetic loopback fixtures'
const EXPECTED_PLATFORM_LIMITS = ['darwin-arm64 only', 'synthetic loopback observers only'] as const

export type PreEpochAdmissionInput = Readonly<{
  schema_id: 'oracle-lab-p3b-pre-epoch-admission-input.v1'
  campaign_container: string
  cc_expected_head: string
  cc_expected_tree: string
  cc_repository: string
  predecessor_config_auth_path: string
  predecessor_failure_stream_path: string
  receipt_path: string
  sub_repository: string
}>

export type PreEpochAdmissionAuthority = Readonly<{
  cc_required_ancestor_commit: string
  cc_required_ancestor_tree: string
  cc_remote_ref: string
  require_github_web_flow_signature: boolean
  sub_commit: string
  sub_tree: string
  sub_parents: readonly [string, string]
  predecessor_expiry: string
  predecessors: Readonly<Record<'CL-P3A-R2-CONFIG-AUTH' | 'CL-P3A-R2-FAILURE-STREAM', string>>
}>

export type PreEpochAdmissionEvaluationOptions = Readonly<{
  authority?: PreEpochAdmissionAuthority
  hooks?: Readonly<{
    after_initial_cc?: () => void
    after_container_open?: () => void
  }>
}>

export const PRE_EPOCH_ADMISSION_AUTHORITY: PreEpochAdmissionAuthority = deepFreeze({
  cc_required_ancestor_commit: '04003be69f86225da59fa27cf294c43b3d7e0285',
  cc_required_ancestor_tree: 'e62a46de130c874aa53d7232b3a4cf06be45065e',
  cc_remote_ref: 'refs/remotes/muqihang/main',
  require_github_web_flow_signature: true,
  sub_commit: REPOSITORY_AUTHORITY.sub.commit,
  sub_tree: REPOSITORY_AUTHORITY.sub.tree,
  sub_parents: ['a4ce6e375a5b6ac46d4605bc3be2da1f9a2351a8', 'd2ff3956d3841b51c22de0db95c27dbc47378fcd'],
  predecessor_expiry: PREDECESSOR_AUTHORITY.expires_at,
  predecessors: PREDECESSOR_AUTHORITY.conclusions,
})

function assertNormalizedAbsolute(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.normalize(value) !== value) throw new Phase3BProductionError('pre_epoch_admission_input_invalid', `${field} must be a normalized absolute path`)
}

function isEqualOrContained(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

function assertRepository(repository: string): void {
  assertAbsoluteNoSymlinkComponents(repository)
  const stat = lstatSync(repository)
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(repository) !== repository) throw new Phase3BProductionError('pre_epoch_repository_invalid', 'repository path is not a real directory')
  const topLevel = git(repository, ['rev-parse', '--show-toplevel'])
  if (topLevel !== repository || realpathSync(topLevel) !== repository) throw new Phase3BProductionError('pre_epoch_repository_invalid', 'repository path is not the exact Git worktree root')
}

function git(repository: string, args: readonly string[]): string {
  try { return fixedGit(repository, args) } catch { throw new Phase3BProductionError('pre_epoch_repository_invalid', 'fixed Git authority query failed') }
}

function validateCc(input: PreEpochAdmissionInput, authority: PreEpochAdmissionAuthority): Readonly<Record<string, unknown>> {
  assertRepository(input.cc_repository)
  for (const [field, value] of [['cc_expected_head', input.cc_expected_head], ['cc_expected_tree', input.cc_expected_tree], ['cc_required_ancestor_commit', authority.cc_required_ancestor_commit], ['cc_required_ancestor_tree', authority.cc_required_ancestor_tree]] as const) if (!OID.test(value)) throw new Phase3BProductionError('pre_epoch_repository_invalid', `${field} is not an exact Git object ID`)
  const head = git(input.cc_repository, ['rev-parse', 'HEAD'])
  const tree = git(input.cc_repository, ['rev-parse', 'HEAD^{tree}'])
  const status = git(input.cc_repository, ['status', '--porcelain=v1', '--untracked-files=normal'])
  const remoteHead = git(input.cc_repository, ['rev-parse', authority.cc_remote_ref])
  const remoteTree = git(input.cc_repository, ['rev-parse', `${authority.cc_remote_ref}^{tree}`])
  const ancestorType = git(input.cc_repository, ['cat-file', '-t', authority.cc_required_ancestor_commit])
  const ancestorTree = git(input.cc_repository, ['rev-parse', `${authority.cc_required_ancestor_commit}^{tree}`])
  git(input.cc_repository, ['merge-base', '--is-ancestor', authority.cc_required_ancestor_commit, head])
  if (head !== input.cc_expected_head || tree !== input.cc_expected_tree || remoteHead !== head || remoteTree !== tree || status !== '' || ancestorType !== 'commit' || ancestorTree !== authority.cc_required_ancestor_tree) throw new Phase3BProductionError('pre_epoch_repository_invalid', 'CC HEAD, remote ref, tree, cleanliness, or required ancestor drifted')
  if (authority.require_github_web_flow_signature !== false) verifyGithubWebFlowCommit(input.cc_repository, authority.cc_required_ancestor_commit)
  return deepFreeze({ repository: input.cc_repository, head, tree, remote_ref: authority.cc_remote_ref, remote_head: remoteHead, remote_tree: remoteTree, status_clean: true, required_ancestor_commit: authority.cc_required_ancestor_commit, required_ancestor_tree: ancestorTree })
}

function validateSub(repository: string, authority: PreEpochAdmissionAuthority): Readonly<Record<string, unknown>> {
  assertRepository(repository)
  if (!OID.test(authority.sub_commit) || !OID.test(authority.sub_tree) || authority.sub_parents.length !== 2 || authority.sub_parents.some((value) => !OID.test(value))) throw new Phase3BProductionError('pre_epoch_repository_invalid', 'Sub authority constants are invalid')
  const type = git(repository, ['cat-file', '-t', authority.sub_commit])
  const tree = git(repository, ['show', '-s', '--format=%T', authority.sub_commit])
  const parents = git(repository, ['show', '-s', '--format=%P', authority.sub_commit]).split(' ')
  if (type !== 'commit' || tree !== authority.sub_tree || parents.length !== 2 || parents.some((value, index) => value !== authority.sub_parents[index])) throw new Phase3BProductionError('pre_epoch_repository_invalid', 'frozen Sub commit metadata drifted')
  return deepFreeze({ repository, commit: authority.sub_commit, tree, parents })
}

function inspectEmptyContainer(directory: string, afterOpen?: () => void): Readonly<Record<string, unknown>> {
  assertAbsoluteNoSymlinkComponents(directory)
  const pathStat = lstatSync(directory)
  if (!pathStat.isDirectory() || pathStat.isSymbolicLink() || realpathSync(directory) !== directory || (pathStat.mode & 0o777) !== 0o700 || pathStat.uid !== process.getuid?.()) throw new Phase3BProductionError('pre_epoch_container_invalid', 'campaign container must be a real caller-owned 0700 directory')
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try {
    afterOpen?.()
    const before = fstatSync(fd)
    const entries = readdirSync(directory)
    const after = fstatSync(fd)
    const finalPathStat = lstatSync(directory)
    if (entries.length !== 0 || !before.isDirectory() || !after.isDirectory() || !finalPathStat.isDirectory() || finalPathStat.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || before.nlink !== after.nlink || before.ctimeMs !== after.ctimeMs || before.mtimeMs !== after.mtimeMs || pathStat.dev !== after.dev || pathStat.ino !== after.ino || finalPathStat.dev !== after.dev || finalPathStat.ino !== after.ino || (before.mode & 0o777) !== 0o700 || (after.mode & 0o777) !== 0o700 || (finalPathStat.mode & 0o777) !== 0o700 || before.uid !== process.getuid?.() || after.uid !== process.getuid?.() || finalPathStat.uid !== process.getuid?.() || after.nlink < 2 || realpathSync(directory) !== directory) throw new Phase3BProductionError('pre_epoch_container_invalid', 'campaign container pathname, descriptor, contents, owner, or mode changed during admission')
    return deepFreeze({ path: directory, realpath: realpathSync(directory), dev: after.dev, ino: after.ino, uid: after.uid, gid: after.gid, mode: after.mode & 0o777, nlink: after.nlink, size: after.size, empty: true })
  } finally { closeSync(fd) }
}

function validateConclusion(file: string, conclusionId: keyof PreEpochAdmissionAuthority['predecessors'], authority: PreEpochAdmissionAuthority): Readonly<Record<string, unknown>> {
  const record = stableRead(file, { mode: 0o600, maximumBytes: 1_048_576 })
  if (record.bytes.at(-1) !== 0x0a || record.bytes.subarray(0, -1).includes(0x0a) || record.identity.sha256 !== authority.predecessors[conclusionId]) throw new Phase3BProductionError('pre_epoch_predecessor_invalid', 'Phase 3A conclusion raw bytes drifted')
  let value: unknown
  try { value = JSON.parse(record.bytes.subarray(0, -1).toString('utf8')) } catch { throw new Phase3BProductionError('pre_epoch_predecessor_invalid', 'Phase 3A conclusion JSON is invalid') }
  assertExactKeys(value, CONCLUSION_KEYS, 'pre_epoch_predecessor_invalid')
  if (!canonicalBytes(value).equals(record.bytes.subarray(0, -1))) throw new Phase3BProductionError('pre_epoch_predecessor_invalid', 'Phase 3A conclusion is not canonical JSON')
  const conclusion = value as Record<string, unknown>
  const expiryMs = Date.parse(String(conclusion.expiry))
  if (conclusion.schema_version !== 'oracle-lab-phase3a-conclusion.v1' || conclusion.conclusion_id !== conclusionId || conclusion.level !== 'Reproduced' || conclusion.phase3b_usable !== true || conclusion.scope !== EXPECTED_SCOPE || conclusion.expiry !== authority.predecessor_expiry || !Number.isSafeInteger(expiryMs) || !Array.isArray(conclusion.platform_limits) || sha256Canonical(conclusion.platform_limits) !== sha256Canonical(EXPECTED_PLATFORM_LIMITS) || !Array.isArray(conclusion.contradicting_artifact_ids) || conclusion.contradicting_artifact_ids.length !== 0 || !Array.isArray(conclusion.negative_capabilities) || conclusion.negative_capabilities.length !== 0) throw new Phase3BProductionError('pre_epoch_predecessor_invalid', 'Phase 3A conclusion schema, scope, level, or expiry is inadmissible')
  return deepFreeze({ conclusion_id: conclusionId, path: record.identity.path, raw_sha256: record.identity.sha256, size: record.identity.size, mode: record.identity.mode, nlink: record.identity.nlink, dev: record.identity.dev, ino: record.identity.ino, level: conclusion.level, phase3b_usable: conclusion.phase3b_usable, scope: conclusion.scope, expiry: conclusion.expiry })
}

export function evaluatePreEpochAdmission(input: PreEpochAdmissionInput, options: PreEpochAdmissionEvaluationOptions = {}): Readonly<Record<string, unknown>> {
  const authority = options.authority ?? PRE_EPOCH_ADMISSION_AUTHORITY
  if (input.schema_id !== 'oracle-lab-p3b-pre-epoch-admission-input.v1') throw new Phase3BProductionError('pre_epoch_admission_input_invalid', 'admission input schema drifted')
  for (const [field, value] of [['campaign_container', input.campaign_container], ['cc_repository', input.cc_repository], ['predecessor_config_auth_path', input.predecessor_config_auth_path], ['predecessor_failure_stream_path', input.predecessor_failure_stream_path], ['receipt_path', input.receipt_path], ['sub_repository', input.sub_repository]] as const) assertNormalizedAbsolute(value, field)
  assertRepository(input.cc_repository)
  assertRepository(input.sub_repository)
  if (!OID.test(input.cc_expected_head) || !OID.test(input.cc_expected_tree) || input.predecessor_config_auth_path === input.predecessor_failure_stream_path || isEqualOrContained(input.campaign_container, input.receipt_path) || isEqualOrContained(input.cc_repository, input.receipt_path) || isEqualOrContained(input.sub_repository, input.receipt_path) || isEqualOrContained(input.cc_repository, input.campaign_container) || isEqualOrContained(input.sub_repository, input.campaign_container)) throw new Phase3BProductionError('pre_epoch_admission_input_invalid', 'Git binding, predecessor tuple, or runtime output path is invalid')

  const initialCc = validateCc(input, authority)
  options.hooks?.after_initial_cc?.()
  const sub = validateSub(input.sub_repository, authority)
  const predecessors = [
    validateConclusion(input.predecessor_config_auth_path, 'CL-P3A-R2-CONFIG-AUTH', authority),
    validateConclusion(input.predecessor_failure_stream_path, 'CL-P3A-R2-FAILURE-STREAM', authority),
  ]
  const campaignContainer = inspectEmptyContainer(input.campaign_container, options.hooks?.after_container_open)
  const cc = validateCc(input, authority)
  if (sha256Canonical(initialCc) !== sha256Canonical(cc)) throw new Phase3BProductionError('pre_epoch_repository_invalid', 'CC state changed across admission validation')
  return deepFreeze({
    schema_id: 'oracle-lab-p3b-pre-epoch-admission-prepared.v1', predecessor_expiry: authority.predecessor_expiry,
    admission_input_sha256: sha256Canonical(input), admission_authority_sha256: sha256Canonical(authority),
    cc, sub, predecessors, campaign_container: campaignContainer,
    epoch_consumed: false, campaign_id_generated: false, signer_starts: 0, signer_signatures: 0, materializer_runs: 0,
    attestation_writes: 0, authority_writes: 0, official_namespaces: 0, prelaunches: 0, receiver_binds: 0, target_launches: 0, sockets: 0,
  })
}
