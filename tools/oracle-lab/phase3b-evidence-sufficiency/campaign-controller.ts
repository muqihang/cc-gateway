import { execFileSync } from 'node:child_process'
import { chmodSync } from 'node:fs'
import path from 'node:path'

import { bindControllerRuntime, createProductionController, sealControllerNamespace } from './controller.js'
import { Phase3BProductionError, assertDigestField, assertExactKeys, assertSha256, canonicalBytes, deepFreeze, sha256Canonical } from './core.js'
import { appendTerminal, openExecutionStore, readCampaignFailure, readExecutionReceipts, sealPostTerminalFailure, sealPreSpawnFailure } from './execution-store.js'
import { deriveLaunchAuthority, type LaunchAuthorityReceipt } from './launch-authority.js'
import { buildStaticAnchor, createSealedLaunchImages, loadLaunchImageRecord, loadStaticAnchor, type LaunchImageRecord } from './launch-image.js'
import { CROSS_REPO_AUTHORITY, FIXED_LITERAL_TABLE, FIXED_LITERAL_TABLE_PATH, PREDECESSOR_AUTHORITY, REPOSITORY_AUTHORITY, TARGET_PROFILE, buildCampaignLedger, validateCampaignLedger } from './ledger.js'
import { abortReceiverGroup, bindReceiverGroup, captureReceiverRuntimeIdentity, type ReceiverAuthority } from './receiver.js'
import { sealTargetControlTranche } from './closeout.js'
import { assertDirectoryEmpty, assertPrivateRuntimeRoot, createPrivateDirectory, readCanonical, stableRead, writeExclusiveCanonical } from './sealed-fs.js'
import { executeProductionRow } from './spawn-adapter.js'
import { controllerExecutableSha256, controllerSourceSetSha256 } from './source-identity.js'
import { TRUSTED_REVIEWER_REGISTRY_RELATIVE, TRUSTED_REVIEWER_REGISTRY_SHA256, loadTrustedReviewerRegistry, verifyTrustedSignature } from './trust.js'

export type CampaignInput = Readonly<{
  schema_id: 'oracle-lab-p3b-production-input.v1'
  campaign_id: string
  campaign_input_path: string
  operator_authority_path: string
  evidence_root: string
  cc_repository: string
  sub_repository: string
  cross_repo_review_path: string
  original_source: string
  probe_source: string
  probe_source_sha256: string
  probe_unsigned_source: string
  probe_unsigned_source_sha256: string
  original_recipe: string
  original_recipe_sha256: string
  probe_recipe: string
  probe_recipe_sha256: string
  platform_archive_path: string
  platform_archive_sha256: string
  source_tree_path: string
  source_tree_sha256: string
  toolchain_path: string
  toolchain_sha256: string
  schema_bundle_path: string
  schema_bundle_sha256: string
  focused_suite_path: string
  focused_suite_sha256: string
  predecessor_config_auth_path: string
  predecessor_failure_stream_path: string
  input_sha256: string
}>

export type OperatorAuthority = Readonly<{
  schema_id: 'oracle-lab-p3b-production-authority.v1'
  decision: 'authorize_fresh_phase3b_production_campaign'
  campaign_id: string
  campaign_input_sha256: string
  repositories: typeof REPOSITORY_AUTHORITY
  c1: typeof CROSS_REPO_AUTHORITY
  reviewed_candidate_commit: string
  reviewed_candidate_tree: string
  implementation_review_path: string
  implementation_review_sha256: string
  reviewed_artifact_set_sha256: string
  critical: 0
  important: 0
  dynamic_launch_authorized: true
  created_at_ms: number
  expires_at_ms: number
  reviewer_identity: string
  reviewer_role: 'requirements'
  signing_key_id: string
  signature_algorithm: 'ed25519_canonical_json_v1'
  signature: string
  authority_sha256: string
}>

const INPUT_KEYS = ['schema_id', 'campaign_id', 'campaign_input_path', 'operator_authority_path', 'evidence_root', 'cc_repository', 'sub_repository', 'cross_repo_review_path', 'original_source', 'probe_source', 'probe_source_sha256', 'probe_unsigned_source', 'probe_unsigned_source_sha256', 'original_recipe', 'original_recipe_sha256', 'probe_recipe', 'probe_recipe_sha256', 'platform_archive_path', 'platform_archive_sha256', 'source_tree_path', 'source_tree_sha256', 'toolchain_path', 'toolchain_sha256', 'schema_bundle_path', 'schema_bundle_sha256', 'focused_suite_path', 'focused_suite_sha256', 'predecessor_config_auth_path', 'predecessor_failure_stream_path', 'input_sha256'] as const
const AUTHORITY_KEYS = ['schema_id', 'decision', 'campaign_id', 'campaign_input_sha256', 'repositories', 'c1', 'reviewed_candidate_commit', 'reviewed_candidate_tree', 'implementation_review_path', 'implementation_review_sha256', 'reviewed_artifact_set_sha256', 'critical', 'important', 'dynamic_launch_authorized', 'created_at_ms', 'expires_at_ms', 'reviewer_identity', 'reviewer_role', 'signing_key_id', 'signature_algorithm', 'signature', 'authority_sha256'] as const
const REVIEW_KEYS = ['schema_id', 'review_kind', 'reviewed_candidate_commit', 'reviewed_candidate_tree', 'repositories', 'c1', 'reviewed_artifact_set_sha256', 'critical', 'important', 'verdict', 'created_at_ms', 'expires_at_ms', 'reviewer_identity', 'reviewer_role', 'signing_key_id', 'signature_algorithm', 'signature', 'review_sha256'] as const

function parseExternalCanonical(file: string): Record<string, unknown> {
  const { bytes, identity } = stableRead(file, { mode: 0o600, maximumBytes: 1_048_576 })
  if (typeof process.getuid === 'function' && identity.uid !== process.getuid()) throw new Phase3BProductionError('authority_owner_invalid', 'authority artifact is not owned by current operator UID')
  if (bytes.at(-1) !== 0x0a) throw new Phase3BProductionError('canonical_record_invalid', 'external authority must be canonical newline JSON')
  let value: unknown
  try { value = JSON.parse(bytes.subarray(0, -1).toString('utf8')) } catch { throw new Phase3BProductionError('canonical_record_invalid', 'external authority JSON is invalid') }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !canonicalBytes(value).equals(bytes.subarray(0, -1))) throw new Phase3BProductionError('canonical_record_invalid', 'external authority is not canonical JSON')
  return value as Record<string, unknown>
}

function git(repository: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', timeout: 10_000 }).trim()
}

function validateInput(value: Record<string, unknown>): CampaignInput {
  assertExactKeys(value, INPUT_KEYS, 'campaign_input_invalid')
  assertDigestField(value, 'input_sha256', 'campaign_input_invalid')
  if (value.schema_id !== 'oracle-lab-p3b-production-input.v1' || typeof value.campaign_id !== 'string') throw new Phase3BProductionError('campaign_input_invalid', 'campaign input schema or ID drifted')
  for (const field of ['probe_source_sha256', 'probe_unsigned_source_sha256', 'original_recipe_sha256', 'probe_recipe_sha256', 'platform_archive_sha256', 'source_tree_sha256', 'toolchain_sha256', 'schema_bundle_sha256', 'focused_suite_sha256'] as const) assertSha256(value[field], 'campaign_input_invalid', field)
  for (const field of ['campaign_input_path', 'operator_authority_path', 'evidence_root', 'cc_repository', 'sub_repository', 'cross_repo_review_path', 'original_source', 'probe_source', 'probe_unsigned_source', 'original_recipe', 'probe_recipe', 'platform_archive_path', 'source_tree_path', 'toolchain_path', 'schema_bundle_path', 'focused_suite_path', 'predecessor_config_auth_path', 'predecessor_failure_stream_path'] as const) if (typeof value[field] !== 'string' || !path.isAbsolute(value[field] as string) || path.normalize(value[field] as string) !== value[field]) throw new Phase3BProductionError('campaign_input_invalid', `${field} must be an operator-bound normalized absolute path`)
  if (stableRead(value.cross_repo_review_path as string, { maximumBytes: 1_048_576 }).identity.sha256 !== CROSS_REPO_AUTHORITY.review_sha256) throw new Phase3BProductionError('campaign_input_invalid', 'actual C1 CROSS_REPO_PASS review bytes drifted')
  if (stableRead(path.join(String(value.cc_repository), TRUSTED_REVIEWER_REGISTRY_RELATIVE), { maximumBytes: 32_768 }).identity.sha256 !== TRUSTED_REVIEWER_REGISTRY_SHA256) throw new Phase3BProductionError('campaign_input_invalid', 'trusted reviewer root is not the immutable base registry')
  if (value.platform_archive_sha256 !== TARGET_PROFILE.platform_archive_sha256 || value.source_tree_sha256 !== TARGET_PROFILE.platform_tree_sha256 || stableRead(value.original_source as string, { maximumBytes: 67_108_864 }).identity.sha256 !== TARGET_PROFILE.entrypoint_sha256) throw new Phase3BProductionError('campaign_input_invalid', 'target artifact is not exact Claude Code 2.1.215 darwin-arm64')
  if (stableRead(value.platform_archive_path as string, { maximumBytes: 134_217_728 }).identity.sha256 !== value.platform_archive_sha256 || stableRead(value.source_tree_path as string, { maximumBytes: 16_777_216 }).identity.sha256 !== value.source_tree_sha256 || stableRead(value.toolchain_path as string, { maximumBytes: 16_777_216 }).identity.sha256 !== value.toolchain_sha256) throw new Phase3BProductionError('campaign_input_invalid', 'actual archive, source-tree, or toolchain artifact bytes drifted')
  for (const [fileField, digestField] of [['probe_source', 'probe_source_sha256'], ['probe_unsigned_source', 'probe_unsigned_source_sha256'], ['original_recipe', 'original_recipe_sha256'], ['probe_recipe', 'probe_recipe_sha256']] as const) if (stableRead(String(value[fileField]), { maximumBytes: 67_108_864 }).identity.sha256 !== value[digestField]) throw new Phase3BProductionError('campaign_input_invalid', `${fileField} bytes drifted from its reviewed digest`)
  if (stableRead(value.schema_bundle_path as string, { maximumBytes: 16_777_216 }).identity.sha256 !== value.schema_bundle_sha256) throw new Phase3BProductionError('campaign_input_invalid', 'schema bundle bytes drifted')
  const focusedSuite = parseExternalCanonical(value.focused_suite_path as string)
  if (stableRead(value.focused_suite_path as string, { mode: 0o600, maximumBytes: 1_048_576 }).identity.sha256 !== value.focused_suite_sha256 || focusedSuite.passed !== true || focusedSuite.strict_typescript !== true || focusedSuite.build !== true || focusedSuite.diff_check !== true) throw new Phase3BProductionError('focused_suite_failed', 'actual cumulative focused suite artifact is not green')
  if (stableRead(value.predecessor_config_auth_path as string, { maximumBytes: 1_048_576 }).identity.sha256 !== PREDECESSOR_AUTHORITY.conclusions['CL-P3A-R2-CONFIG-AUTH'] || stableRead(value.predecessor_failure_stream_path as string, { maximumBytes: 1_048_576 }).identity.sha256 !== PREDECESSOR_AUTHORITY.conclusions['CL-P3A-R2-FAILURE-STREAM']) throw new Phase3BProductionError('predecessor_invalid', 'exact Phase 3A conclusion bytes drifted')
  if (Date.now() >= Date.parse(PREDECESSOR_AUTHORITY.expires_at)) throw new Phase3BProductionError('predecessor_expired', 'Phase 3A predecessor authority expired')
  return deepFreeze(value as CampaignInput)
}

function reviewedArtifactSetSha256(input: CampaignInput): string {
  return sha256Canonical({ schema_id: 'oracle-lab-p3b-reviewed-artifact-set.v1', target_profile: TARGET_PROFILE, probe_source_sha256: input.probe_source_sha256, probe_unsigned_source_sha256: input.probe_unsigned_source_sha256, original_recipe_sha256: input.original_recipe_sha256, probe_recipe_sha256: input.probe_recipe_sha256, source_tree_sha256: input.source_tree_sha256, toolchain_sha256: input.toolchain_sha256, schema_bundle_sha256: input.schema_bundle_sha256, focused_suite_sha256: input.focused_suite_sha256 })
}

function validateRepositories(input: CampaignInput, candidateCommit: string, candidateTree: string): void {
  if (git(input.cc_repository, ['rev-parse', 'HEAD']) !== candidateCommit || git(input.cc_repository, ['rev-parse', 'HEAD^{tree}']) !== candidateTree || git(input.cc_repository, ['status', '--porcelain']) !== '') throw new Phase3BProductionError('repository_authority_invalid', 'CC candidate head/tree/worktree drifted')
  try { git(input.cc_repository, ['merge-base', '--is-ancestor', REPOSITORY_AUTHORITY.cc.commit, candidateCommit]) } catch { throw new Phase3BProductionError('repository_authority_invalid', 'CC exact authority merge is not candidate ancestor') }
  if (git(input.cc_repository, ['rev-parse', `${REPOSITORY_AUTHORITY.cc.commit}^{tree}`]) !== REPOSITORY_AUTHORITY.cc.tree) throw new Phase3BProductionError('repository_authority_invalid', 'CC baseline tree drifted')
  if (git(input.sub_repository, ['rev-parse', 'HEAD']) !== REPOSITORY_AUTHORITY.sub.commit || git(input.sub_repository, ['rev-parse', 'HEAD^{tree}']) !== REPOSITORY_AUTHORITY.sub.tree || git(input.sub_repository, ['status', '--porcelain']) !== '') throw new Phase3BProductionError('repository_authority_invalid', 'Sub authority head/tree/worktree drifted')
}

function validateAuthority(value: Record<string, unknown>, input: CampaignInput): OperatorAuthority {
  assertExactKeys(value, AUTHORITY_KEYS, 'operator_authority_invalid')
  assertDigestField(value, 'authority_sha256', 'operator_authority_invalid')
  const registry = loadTrustedReviewerRegistry(input.cc_repository)
  verifyTrustedSignature(value, registry, 'requirements', 'authority_sha256', 'operator_authority_invalid')
  const artifactSetSha256 = reviewedArtifactSetSha256(input)
  if (value.schema_id !== 'oracle-lab-p3b-production-authority.v1' || value.decision !== 'authorize_fresh_phase3b_production_campaign' || value.campaign_id !== input.campaign_id || value.campaign_input_sha256 !== input.input_sha256 || value.reviewed_artifact_set_sha256 !== artifactSetSha256 || value.critical !== 0 || value.important !== 0 || value.dynamic_launch_authorized !== true || sha256Canonical(value.repositories) !== sha256Canonical(REPOSITORY_AUTHORITY) || sha256Canonical(value.c1) !== sha256Canonical(CROSS_REPO_AUTHORITY)) throw new Phase3BProductionError('operator_authority_invalid', 'operator authority scope/review/source binding drifted')
  if (!Number.isSafeInteger(value.created_at_ms) || !Number.isSafeInteger(value.expires_at_ms) || Number(value.created_at_ms) > Date.now() || Number(value.expires_at_ms) <= Date.now() || Number(value.expires_at_ms) - Number(value.created_at_ms) > 86_400_000) throw new Phase3BProductionError('operator_authority_stale', 'operator authority is future, stale, or overlong')
  for (const field of ['reviewed_candidate_commit', 'reviewed_candidate_tree'] as const) if (typeof value[field] !== 'string' || !/^[a-f0-9]{40}$/.test(value[field] as string)) throw new Phase3BProductionError('operator_authority_invalid', `${field} is invalid`)
  assertSha256(value.implementation_review_sha256, 'operator_authority_invalid', 'implementation review')
  if (typeof value.implementation_review_path !== 'string' || path.basename(value.implementation_review_path) !== 'phase3b-implementation-review.json') throw new Phase3BProductionError('operator_authority_invalid', 'implementation review path is not fixed')
  const reviewBytes = stableRead(value.implementation_review_path as string, { mode: 0o600, maximumBytes: 1_048_576 })
  if (reviewBytes.identity.sha256 !== value.implementation_review_sha256) throw new Phase3BProductionError('implementation_review_failed', 'implementation review bytes drifted')
  const review = parseExternalCanonical(value.implementation_review_path as string)
  assertExactKeys(review, REVIEW_KEYS, 'implementation_review_failed')
  assertDigestField(review, 'review_sha256', 'implementation_review_failed')
  verifyTrustedSignature(review, registry, 'security_quality', 'review_sha256', 'implementation_review_failed')
  if (review.schema_id !== 'oracle-lab-p3b-implementation-review.v2' || review.review_kind !== 'phase3b-production-executor' || review.reviewed_candidate_commit !== value.reviewed_candidate_commit || review.reviewed_candidate_tree !== value.reviewed_candidate_tree || review.reviewed_artifact_set_sha256 !== artifactSetSha256 || review.critical !== 0 || review.important !== 0 || review.verdict !== 'PASS' || sha256Canonical(review.repositories) !== sha256Canonical(REPOSITORY_AUTHORITY) || sha256Canonical(review.c1) !== sha256Canonical(CROSS_REPO_AUTHORITY) || !Number.isSafeInteger(review.created_at_ms) || !Number.isSafeInteger(review.expires_at_ms) || Number(review.created_at_ms) > Date.now() || Number(review.expires_at_ms) <= Date.now()) throw new Phase3BProductionError('implementation_review_failed', 'trusted exact-head implementation review is not current 0C/0I')
  validateRepositories(input, String(value.reviewed_candidate_commit), String(value.reviewed_candidate_tree))
  return deepFreeze(value as OperatorAuthority)
}

function fixedExternalPaths(authorityPath: string, inputPath: string, evidenceRoot: string, input: CampaignInput): void {
  if (path.basename(authorityPath) !== 'phase3b-operator-authority.json' || path.basename(inputPath) !== 'phase3b-campaign-input.json' || path.basename(evidenceRoot) !== `phase3b-${input.campaign_id}` || authorityPath !== input.operator_authority_path || inputPath !== input.campaign_input_path || evidenceRoot !== input.evidence_root) throw new Phase3BProductionError('fixed_path_invalid', 'authority, input, or namespace exact path is not authority-bound')
}

export function runPrelaunchOnly(authorityPath: string, inputPath: string, evidenceRoot: string): Readonly<Record<string, unknown>> {
  const input = validateInput(parseExternalCanonical(inputPath))
  const authority = validateAuthority(parseExternalCanonical(authorityPath), input)
  fixedExternalPaths(authorityPath, inputPath, evidenceRoot, input)
  const root = assertPrivateRuntimeRoot(evidenceRoot)
  assertDirectoryEmpty(root)
  for (const directory of ['control', 'prelaunch', 'observations', 'receiver-results', 'runs', 'guards', 'cell-results']) createPrivateDirectory(root, directory)
  writeExclusiveCanonical(root, 'control/campaign-input.json', input)
  writeExclusiveCanonical(root, 'control/operator-authority.json', authority)
  writeExclusiveCanonical(root, 'control/focused-suite.json', parseExternalCanonical(input.focused_suite_path))
  writeExclusiveCanonical(root, 'control/implementation-review.json', parseExternalCanonical(authority.implementation_review_path))
  writeExclusiveCanonical(root, 'control/cross-repo-review.json', parseExternalCanonical(input.cross_repo_review_path))
  writeExclusiveCanonical(root, 'control/predecessor-config-auth.json', parseExternalCanonical(input.predecessor_config_auth_path))
  writeExclusiveCanonical(root, 'control/predecessor-failure-stream.json', parseExternalCanonical(input.predecessor_failure_stream_path))
  writeExclusiveCanonical(root, 'control/trusted-reviewers.json', loadTrustedReviewerRegistry(input.cc_repository))
  createPrivateDirectory(root, 'synthetic-literals')
  writeExclusiveCanonical(root, FIXED_LITERAL_TABLE_PATH, FIXED_LITERAL_TABLE)
  const ledger = buildCampaignLedger(input.campaign_id)
  writeExclusiveCanonical(root, 'prelaunch/run-ledger.json', ledger)
  const images = createSealedLaunchImages({ runtime_root: root, original_source: input.original_source, probe_source: input.probe_source, probe_source_sha256: input.probe_source_sha256, probe_unsigned_source: input.probe_unsigned_source, probe_unsigned_source_sha256: input.probe_unsigned_source_sha256, original_recipe: input.original_recipe, original_recipe_sha256: input.original_recipe_sha256, probe_recipe: input.probe_recipe, probe_recipe_sha256: input.probe_recipe_sha256, source_tree_sha256: input.source_tree_sha256, toolchain_sha256: input.toolchain_sha256, reviewed_artifact_set_sha256: authority.reviewed_artifact_set_sha256 })
  const receiver = captureReceiverRuntimeIdentity()
  const anchor = buildStaticAnchor({ platform_archive_sha256: input.platform_archive_sha256, source_tree_sha256: input.source_tree_sha256, toolchain_sha256: input.toolchain_sha256, images, ...receiver, controller_source_sha256: controllerSourceSetSha256(), controller_executable_sha256: controllerExecutableSha256(), schema_bundle_sha256: input.schema_bundle_sha256, reviewed_artifact_set_sha256: authority.reviewed_artifact_set_sha256 })
  writeExclusiveCanonical(root, 'prelaunch/static-anchor.json', anchor)
  const selectionUnsigned = { schema_id: 'oracle-lab-p3b-active-selection.v1', campaign_id: input.campaign_id, ledger_sha256: ledger.ledger_sha256, anchor_sha256: anchor.anchor_sha256, original_image_record_sha256: images.original.record_sha256, probe_image_record_sha256: images.probe.record_sha256 }
  writeExclusiveCanonical(root, 'prelaunch/active-selection.json', { ...selectionUnsigned, selection_sha256: sha256Canonical(selectionUnsigned) })
  const unsigned = { schema_id: 'oracle-lab-p3b-prelaunch-result.v1', campaign_id: input.campaign_id, authority_sha256: authority.authority_sha256, input_sha256: input.input_sha256, ledger_sha256: ledger.ledger_sha256, anchor_sha256: anchor.anchor_sha256, launch_image_set_sha256: sha256Canonical(images), target_launches: 0, receiver_binds: 0, external_sockets: 0, status: 'SEALED' }
  const result = deepFreeze({ ...unsigned, prelaunch_result_sha256: sha256Canonical(unsigned) })
  writeExclusiveCanonical(root, 'prelaunch/result.json', result)
  chmodSync(path.join(root, 'prelaunch'), 0o500)
  return result
}

export function loadSealedControl(root: string): { input: CampaignInput; authority: OperatorAuthority } {
  const input = validateInput(readCanonical(root, 'control/campaign-input.json').value)
  if (input.evidence_root !== root) throw new Phase3BProductionError('fixed_path_invalid', 'sealed campaign input does not bind this evidence root')
  const authority = validateAuthority(readCanonical(root, 'control/operator-authority.json').value, input)
  return { input, authority }
}

export async function runExecuteFromSealedPrelaunch(evidenceRoot: string): Promise<Readonly<Record<string, unknown>>> {
  const root = assertPrivateRuntimeRoot(evidenceRoot)
  const { input, authority } = loadSealedControl(root)
  const ledger = validateCampaignLedger(readCanonical(root, 'prelaunch/run-ledger.json', 16_777_216).value)
  const imageSet = readCanonical(root, 'launch-images.json', 16_777_216).value as Record<string, any>
  if (imageSet.schema_id !== 'oracle-lab-p3b-launch-image-set.v1' || imageSet.set_sha256 !== sha256Canonical({ original: imageSet.original, probe: imageSet.probe })) throw new Phase3BProductionError('launch_image_invalid', 'sealed launch image set drifted')
  const images = { original: loadLaunchImageRecord(imageSet.original), probe: loadLaunchImageRecord(imageSet.probe) }
  const anchor = loadStaticAnchor(readCanonical(root, 'prelaunch/static-anchor.json').value)
  if (anchor.original_image_record_sha256 !== images.original.record_sha256 || anchor.probe_image_record_sha256 !== images.probe.record_sha256 || anchor.source_tree_sha256 !== input.source_tree_sha256 || anchor.toolchain_sha256 !== input.toolchain_sha256 || anchor.reviewed_artifact_set_sha256 !== authority.reviewed_artifact_set_sha256) throw new Phase3BProductionError('static_anchor_invalid', 'static anchor image/source/toolchain/review drifted')
  const receiverIdentity = captureReceiverRuntimeIdentity()
  if (anchor.receiver_source_sha256 !== receiverIdentity.receiver_source_sha256 || anchor.receiver_executable_identity_sha256 !== receiverIdentity.receiver_executable_identity_sha256 || anchor.receiver_schema_sha256 !== receiverIdentity.receiver_schema_sha256 || anchor.controller_source_sha256 !== controllerSourceSetSha256() || anchor.controller_executable_sha256 !== controllerExecutableSha256()) throw new Phase3BProductionError('static_anchor_invalid', 'receiver/controller runtime tuple drifted')
  const controller = createProductionController({ campaign_id: input.campaign_id })
  bindControllerRuntime(controller, root, anchor)
  sealControllerNamespace(controller)
  const store = openExecutionStore(root, ledger)
  if (readExecutionReceipts(store).length !== 0) throw new Phase3BProductionError('execution_resume_forbidden', 'execute mode never resumes a partial namespace')
  for (const row of ledger.rows) {
    let receiver: ReceiverAuthority | null = null
    let launchAuthority: LaunchAuthorityReceipt | null = null
    try {
      if (row.sequence_index === 20) sealTargetControlTranche(root)
      receiver = await bindReceiverGroup(controller, row)
      const image: LaunchImageRecord = row.selected_executable_class === 'original_image' ? images.original : images.probe
      launchAuthority = deriveLaunchAuthority({ controller, store, row, receiver_authority: receiver, launch_image: image })
      const result = await executeProductionRow({ controller, store, row, receiver, authority: launchAuthority, image })
      if (result.terminal_class !== 'success') break
    } catch (error: unknown) {
      if (receiver) await abortReceiverGroup(receiver)
      const receipts = readExecutionReceipts(store)
      const started = receipts.find((receipt) => receipt.sequence_index === row.sequence_index && receipt.state === 'started')
      const terminal = receipts.find((receipt) => receipt.sequence_index === row.sequence_index && receipt.state === 'terminal')
      if (started && !terminal && launchAuthority) appendTerminal(store, row, launchAuthority, { terminalClass: 'spawn_error', exitCode: null, signal: null, causeCode: 'runner_ownership_failure' })
      else if (terminal?.terminal_class === 'success' && readCampaignFailure(store) === null) sealPostTerminalFailure(store, row, error)
      else if (!started) sealPreSpawnFailure(store, row, error)
      break
    }
  }
  const receipts = readExecutionReceipts(store)
  const unsigned = { schema_id: 'oracle-lab-p3b-execution-result.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, authority_sha256: authority.authority_sha256, planned: 340, started: receipts.filter((row) => row.state === 'started').length, spawned: receipts.filter((row) => row.state === 'spawned').length, terminal: receipts.filter((row) => row.state === 'terminal').length, not_executed: receipts.filter((row) => row.state === 'not_executed').length, receipt_set_sha256: sha256Canonical(receipts), completed_all_rows: receipts.filter((row) => row.state === 'terminal' && row.terminal_class === 'success').length === 340 }
  const result = deepFreeze({ ...unsigned, execution_result_sha256: sha256Canonical(unsigned) })
  writeExclusiveCanonical(root, 'execution-result.json', result)
  return result
}
