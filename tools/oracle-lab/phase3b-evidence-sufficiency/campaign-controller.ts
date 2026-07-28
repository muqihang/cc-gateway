import { chmodSync, lstatSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { bindControllerRuntime, createProductionController, sealControllerNamespace } from './controller.js'
import { Phase3BProductionError, assertDigestField, assertExactKeys, assertSha256, canonicalBytes, deepFreeze, sha256Bytes, sha256Canonical } from './core.js'
import { appendTerminal, openExecutionStore, readCampaignFailure, readExecutionReceipts, sealPostTerminalFailure, sealPreSpawnFailure } from './execution-store.js'
import { deriveLaunchAuthority, type LaunchAuthorityReceipt } from './launch-authority.js'
import { buildStaticAnchor, createSealedLaunchImages, loadLaunchImageRecord, loadStaticAnchor, type LaunchImageRecord } from './launch-image.js'
import { FIXED_LITERAL_TABLE, FIXED_LITERAL_TABLE_PATH, PREDECESSOR_AUTHORITY, REPOSITORY_AUTHORITY, TARGET_PROFILE, buildCampaignLedger, crossRepoAuthority, validateCampaignLedger, type CrossRepoAuthority, type TargetProfile } from './ledger.js'
import { abortReceiverGroup, bindReceiverGroup, captureReceiverRuntimeIdentity, type ReceiverAuthority } from './receiver.js'
import { sealTargetControlTranche } from './closeout.js'
import { assertDirectoryEmpty, assertPrivateRuntimeRoot, createPrivateDirectory, readCanonical, readCanonicalTransport, resolveContained, stableRead, writeExclusiveBytes, writeExclusiveCanonical } from './sealed-fs.js'
import { executeProductionRow } from './spawn-adapter.js'
import { controllerExecutableSha256, controllerSourceSetSha256 } from './source-identity.js'
import { TARGET_EXECUTABLE_MAXIMUM_BYTES } from './launch-image.js'
import { CAMPAIGN_REVIEWER_REGISTRY_RELATIVE, IMPLEMENTATION_REVIEW_RELATIVE, fixedGit, fixedGitBytes, validateApprovalAttestation, validateCampaignReviewerRegistry, verifyTrustedSignature, type TrustedReviewerRegistry } from './trust.js'
import { bindMaterializedCrossRepoAuthority, reviewedArtifactSetSha256 } from './authority-materializer.js'
import { PHASE3B_EPOCH_CONSUMPTION_POLICY, PHASE3B_EPOCH_CONSUMPTION_POLICY_SHA256 } from './pre-epoch-admission.js'

export type CampaignInput = Readonly<{
  schema_id: 'oracle-lab-p3b-production-input.v2'
  campaign_id: string
  campaign_input_path: string
  operator_authority_path: string
  evidence_root: string
  cc_repository: string
  sub_repository: string
  cross_review_task_id: string
  cross_review_artifact_path: string
  cross_review_artifact_sha256: string
  cross_repo_review_path: string
  cross_repo_review_sha256: string
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
  es7_typed_fixtures_path: string
  es7_typed_fixtures_sha256: string
  es8_go_receipt_path: string
  es8_go_receipt_sha256: string
  es8_ts_c1_agreement_path: string
  es8_ts_c1_agreement_sha256: string
  es9_coverage_contract_path: string
  es9_coverage_contract_sha256: string
  predecessor_config_auth_path: string
  predecessor_failure_stream_path: string
  input_sha256: string
}>

export type OperatorAuthority = Readonly<{
  schema_id: 'oracle-lab-p3b-production-authority.v2'
  decision: 'authorize_fresh_phase3b_production_campaign'
  campaign_id: string
  campaign_input_sha256: string
  repositories: typeof REPOSITORY_AUTHORITY
  c1: CrossRepoAuthority
  reviewed_candidate_commit: string
  reviewed_candidate_tree: string
  approval_commit: string
  approval_tree: string
  attestation_commit: string
  attestation_tree: string
  campaign_registry_sha256: string
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

type TestCampaignInput = Readonly<Omit<CampaignInput, 'schema_id'> & {
  schema_id: 'oracle-lab-p3b-test-production-input.v1'
  target_profile: TargetProfile
  controller_source_sha256: string
  controller_executable_sha256: string
  materialized_authority_path: string
  materialized_authority_sha256: string
  registry_repository: string
  registry_commit: string
  registry_tree: string
}>

type TestOperatorAuthority = Readonly<Omit<OperatorAuthority, 'schema_id' | 'decision' | 'dynamic_launch_authorized'> & {
  schema_id: 'oracle-lab-p3b-test-production-authority.v1'
  decision: 'authorize_test_owned_offline_campaign'
  dynamic_launch_authorized: true
  registry_repository: string
  registry_commit: string
  registry_tree: string
  materialized_authority_sha256: string
  controller_source_sha256: string
  controller_executable_sha256: string
  campaign_input_path: string
  campaign_input_raw_sha256: string
  signed_gate_b_decision_path: string
  signer_closure_path: string
}>

type SealedCampaignInput = CampaignInput | TestCampaignInput
type SealedOperatorAuthority = OperatorAuthority | TestOperatorAuthority

const INPUT_KEYS = ['schema_id', 'campaign_id', 'campaign_input_path', 'operator_authority_path', 'evidence_root', 'cc_repository', 'sub_repository', 'cross_review_task_id', 'cross_review_artifact_path', 'cross_review_artifact_sha256', 'cross_repo_review_path', 'cross_repo_review_sha256', 'original_source', 'probe_source', 'probe_source_sha256', 'probe_unsigned_source', 'probe_unsigned_source_sha256', 'original_recipe', 'original_recipe_sha256', 'probe_recipe', 'probe_recipe_sha256', 'platform_archive_path', 'platform_archive_sha256', 'source_tree_path', 'source_tree_sha256', 'toolchain_path', 'toolchain_sha256', 'schema_bundle_path', 'schema_bundle_sha256', 'focused_suite_path', 'focused_suite_sha256', 'es7_typed_fixtures_path', 'es7_typed_fixtures_sha256', 'es8_go_receipt_path', 'es8_go_receipt_sha256', 'es8_ts_c1_agreement_path', 'es8_ts_c1_agreement_sha256', 'es9_coverage_contract_path', 'es9_coverage_contract_sha256', 'predecessor_config_auth_path', 'predecessor_failure_stream_path', 'input_sha256'] as const
const AUTHORITY_KEYS = ['schema_id', 'decision', 'campaign_id', 'campaign_input_sha256', 'repositories', 'c1', 'reviewed_candidate_commit', 'reviewed_candidate_tree', 'approval_commit', 'approval_tree', 'attestation_commit', 'attestation_tree', 'campaign_registry_sha256', 'implementation_review_path', 'implementation_review_sha256', 'reviewed_artifact_set_sha256', 'critical', 'important', 'dynamic_launch_authorized', 'created_at_ms', 'expires_at_ms', 'reviewer_identity', 'reviewer_role', 'signing_key_id', 'signature_algorithm', 'signature', 'authority_sha256'] as const
const REVIEW_KEYS = ['schema_id', 'review_kind', 'reviewed_candidate_commit', 'reviewed_candidate_tree', 'repositories', 'c1', 'requirements_public_entry_sha256', 'reviewed_artifact_set_sha256', 'critical', 'important', 'verdict', 'created_at_ms', 'expires_at_ms', 'reviewer_identity', 'reviewer_role', 'signing_key_id', 'signature_algorithm', 'signature', 'review_sha256'] as const
const TEST_INPUT_KEYS = [...INPUT_KEYS, 'target_profile', 'controller_source_sha256', 'controller_executable_sha256', 'materialized_authority_path', 'materialized_authority_sha256', 'registry_repository', 'registry_commit', 'registry_tree'] as const
const TEST_AUTHORITY_KEYS = [...AUTHORITY_KEYS, 'registry_repository', 'registry_commit', 'registry_tree', 'materialized_authority_sha256', 'controller_source_sha256', 'controller_executable_sha256', 'campaign_input_path', 'campaign_input_raw_sha256', 'signed_gate_b_decision_path', 'signer_closure_path'] as const
const TEST_REVIEW_KEYS = ['schema_id', 'review_kind', 'reviewed_candidate_commit', 'reviewed_candidate_tree', 'requirements_public_entry_sha256', 'materialized_authority_sha256', 'controller_source_sha256', 'controller_executable_sha256', 'critical', 'important', 'verdict', 'created_at_ms', 'expires_at_ms', 'reviewer_identity', 'reviewer_role', 'signing_key_id', 'signature_algorithm', 'signature', 'review_sha256'] as const
const COMPLETE_CONTROLLER_KEYS = ['mode', 'authority_path', 'input_path', 'evidence_root', 'signed_gate_b_decision_path', 'signer_closure_path'] as const
const TEST_CONTROLLER_KEYS = ['mode', 'authority_manifest_path', 'evidence_root'] as const

function readExternalCanonical(file: string, maximumBytes = 1_048_576): ReturnType<typeof stableRead> & { value: Record<string, unknown> } {
  const { bytes, identity } = stableRead(file, { mode: 0o600, maximumBytes })
  if (typeof process.getuid === 'function' && identity.uid !== process.getuid()) throw new Phase3BProductionError('authority_owner_invalid', 'authority artifact is not owned by current operator UID')
  if (bytes.at(-1) !== 0x0a) throw new Phase3BProductionError('canonical_record_invalid', 'external authority must be canonical newline JSON')
  let value: unknown
  try { value = JSON.parse(bytes.subarray(0, -1).toString('utf8')) } catch { throw new Phase3BProductionError('canonical_record_invalid', 'external authority JSON is invalid') }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !canonicalBytes(value).equals(bytes.subarray(0, -1))) throw new Phase3BProductionError('canonical_record_invalid', 'external authority is not canonical JSON')
  return { bytes, identity, value: value as Record<string, unknown> }
}

export function readPredecessorConclusion(file: string, expectedSha256: string, maximumBytes = 1_048_576): ReturnType<typeof stableRead> & { value: Record<string, unknown> } {
  const { bytes, identity, value } = readCanonicalTransport(file, { mode: 0o600, maximumBytes })
  if (typeof process.getuid === 'function' && identity.uid !== process.getuid()) throw new Phase3BProductionError('authority_owner_invalid', 'Phase 3A predecessor is not owned by current operator UID')
  if (identity.sha256 !== expectedSha256) throw new Phase3BProductionError('sealed_authority_file_drift', 'Phase 3A predecessor changed before sealing')
  return { bytes, identity, value }
}

export function sealPredecessorConclusion(root: string, relative: string, source: string, expectedSha256: string, expectedConclusionId: string): ReturnType<typeof writeExclusiveBytes> {
  const record = readPredecessorConclusion(source, expectedSha256)
  if (record.value.conclusion_id !== expectedConclusionId) throw new Phase3BProductionError('sealed_authority_file_drift', 'Phase 3A predecessor identity changed before sealing')
  return writeExclusiveBytes(root, relative, record.bytes, 0o600)
}

function parseExternalCanonical(file: string, maximumBytes = 1_048_576): Record<string, unknown> {
  return readExternalCanonical(file, maximumBytes).value
}

function git(repository: string, args: readonly string[]): string { return fixedGit(repository, args, 16_777_216) }

function validateInput(value: Record<string, unknown>): CampaignInput {
  assertExactKeys(value, INPUT_KEYS, 'campaign_input_invalid')
  assertDigestField(value, 'input_sha256', 'campaign_input_invalid')
  if (value.schema_id !== 'oracle-lab-p3b-production-input.v2' || typeof value.campaign_id !== 'string') throw new Phase3BProductionError('campaign_input_invalid', 'campaign input schema or ID drifted')
  for (const field of ['cross_review_artifact_sha256', 'cross_repo_review_sha256', 'probe_source_sha256', 'probe_unsigned_source_sha256', 'original_recipe_sha256', 'probe_recipe_sha256', 'platform_archive_sha256', 'source_tree_sha256', 'toolchain_sha256', 'schema_bundle_sha256', 'focused_suite_sha256', 'es7_typed_fixtures_sha256', 'es8_go_receipt_sha256', 'es8_ts_c1_agreement_sha256', 'es9_coverage_contract_sha256'] as const) assertSha256(value[field], 'campaign_input_invalid', field)
  if (typeof value.cross_review_task_id !== 'string' || !/^[A-Za-z0-9._:-]{3,200}$/.test(value.cross_review_task_id)) throw new Phase3BProductionError('campaign_input_invalid', 'cross review task identity drifted')
  for (const field of ['campaign_input_path', 'operator_authority_path', 'evidence_root', 'cc_repository', 'sub_repository', 'cross_review_artifact_path', 'cross_repo_review_path', 'original_source', 'probe_source', 'probe_unsigned_source', 'original_recipe', 'probe_recipe', 'platform_archive_path', 'source_tree_path', 'toolchain_path', 'schema_bundle_path', 'focused_suite_path', 'es7_typed_fixtures_path', 'es8_go_receipt_path', 'es8_ts_c1_agreement_path', 'es9_coverage_contract_path', 'predecessor_config_auth_path', 'predecessor_failure_stream_path'] as const) if (typeof value[field] !== 'string' || !path.isAbsolute(value[field] as string) || path.normalize(value[field] as string) !== value[field]) throw new Phase3BProductionError('campaign_input_invalid', `${field} must be an operator-bound normalized absolute path`)
  const fixedAuthorityFiles = [
    ['es7_typed_fixtures_path', 'es7_typed_fixtures_sha256', 'phase3b-es7-typed-fixtures.json'],
    ['es8_go_receipt_path', 'es8_go_receipt_sha256', 'phase3b-es8-go-receipt.json'],
    ['es8_ts_c1_agreement_path', 'es8_ts_c1_agreement_sha256', 'phase3b-es8-ts-c1-agreement.json'],
    ['es9_coverage_contract_path', 'es9_coverage_contract_sha256', 'phase3b-es9-coverage-contract.json'],
  ] as const
  for (const [pathField, digestField, basename] of fixedAuthorityFiles) {
    const artifact = readExternalCanonical(String(value[pathField]), 16_777_216)
    if (path.basename(String(value[pathField])) !== basename || artifact.identity.sha256 !== value[digestField]) throw new Phase3BProductionError('campaign_input_invalid', `${pathField} is not the exact reviewed authority artifact`)
  }
  const crossRepo = readExternalCanonical(String(value.cross_repo_review_path))
  if (crossRepo.identity.sha256 !== value.cross_repo_review_sha256 || sha256Canonical(bindMaterializedCrossRepoAuthority(crossRepo.bytes)) !== sha256Canonical(crossRepoAuthority(String(value.cross_repo_review_sha256)))) throw new Phase3BProductionError('campaign_input_invalid', 'actual materialized C1 CROSS_REPO_PASS record drifted')
  const crossReviewRecord = readExternalCanonical(String(value.cross_review_artifact_path))
  const crossReview = crossReviewRecord.value
  assertDigestField(crossReview, 'artifact_sha256', 'campaign_input_invalid')
  const c1Review = crossRepo.value.review
  const c1Cross = c1Review && typeof c1Review === 'object' && !Array.isArray(c1Review) ? (c1Review as Record<string, unknown>).cross : undefined
  const now = Date.now()
  if (!c1Cross || typeof c1Cross !== 'object' || Array.isArray(c1Cross) || crossReviewRecord.identity.sha256 !== value.cross_review_artifact_sha256 || crossReview.schema_id !== 'oracle-lab-p3b-cross-review.v1' || crossReview.task_id !== value.cross_review_task_id || crossReview.model !== 'gpt-5.6-sol' || crossReview.critical !== 0 || crossReview.important !== 0 || crossReview.verdict !== 'CROSS_REPO_PASS' || !Number.isSafeInteger(crossReview.created_at_ms) || !Number.isSafeInteger(crossReview.expires_at_ms) || Number(crossReview.created_at_ms) > now || Number(crossReview.expires_at_ms) <= now || Number(crossReview.expires_at_ms) - Number(crossReview.created_at_ms) > 86_400_000 || (c1Cross as Record<string, unknown>).task_id !== value.cross_review_task_id || (c1Cross as Record<string, unknown>).artifact_sha256 !== value.cross_review_artifact_sha256) throw new Phase3BProductionError('campaign_input_invalid', 'C1 does not bind the actual current 0C/0I cross-review artifact')
  const targetIdentity = stableRead(value.original_source as string, { maximumBytes: TARGET_EXECUTABLE_MAXIMUM_BYTES }).identity
  if (value.platform_archive_sha256 !== TARGET_PROFILE.platform_archive_sha256 || value.source_tree_sha256 !== TARGET_PROFILE.platform_tree_sha256 || targetIdentity.sha256 !== TARGET_PROFILE.entrypoint_sha256 || targetIdentity.size !== TARGET_PROFILE.entrypoint_size) throw new Phase3BProductionError('campaign_input_invalid', 'target artifact is not exact Claude Code 2.1.215 darwin-arm64')
  if (stableRead(value.platform_archive_path as string, { maximumBytes: 134_217_728 }).identity.sha256 !== value.platform_archive_sha256 || stableRead(value.source_tree_path as string, { maximumBytes: 16_777_216 }).identity.sha256 !== value.source_tree_sha256 || stableRead(value.toolchain_path as string, { maximumBytes: 16_777_216 }).identity.sha256 !== value.toolchain_sha256) throw new Phase3BProductionError('campaign_input_invalid', 'actual archive, source-tree, or toolchain artifact bytes drifted')
  for (const [fileField, digestField] of [['probe_source', 'probe_source_sha256'], ['probe_unsigned_source', 'probe_unsigned_source_sha256']] as const) if (stableRead(String(value[fileField]), { maximumBytes: TARGET_EXECUTABLE_MAXIMUM_BYTES }).identity.sha256 !== value[digestField]) throw new Phase3BProductionError('campaign_input_invalid', `${fileField} bytes drifted from its reviewed digest`)
  for (const [fileField, digestField] of [['original_recipe', 'original_recipe_sha256'], ['probe_recipe', 'probe_recipe_sha256']] as const) if (stableRead(String(value[fileField]), { maximumBytes: 1_048_576 }).identity.sha256 !== value[digestField]) throw new Phase3BProductionError('campaign_input_invalid', `${fileField} bytes drifted from its reviewed digest`)
  if (stableRead(value.schema_bundle_path as string, { maximumBytes: 16_777_216 }).identity.sha256 !== value.schema_bundle_sha256) throw new Phase3BProductionError('campaign_input_invalid', 'schema bundle bytes drifted')
  const focusedSuiteRecord = readExternalCanonical(value.focused_suite_path as string)
  const focusedSuite = focusedSuiteRecord.value
  if (focusedSuiteRecord.identity.sha256 !== value.focused_suite_sha256 || focusedSuite.passed !== true || focusedSuite.strict_typescript !== true || focusedSuite.build !== true || focusedSuite.diff_check !== true) throw new Phase3BProductionError('focused_suite_failed', 'actual cumulative focused suite artifact is not green')
  if (stableRead(value.predecessor_config_auth_path as string, { maximumBytes: 1_048_576 }).identity.sha256 !== PREDECESSOR_AUTHORITY.conclusions['CL-P3A-R2-CONFIG-AUTH'] || stableRead(value.predecessor_failure_stream_path as string, { maximumBytes: 1_048_576 }).identity.sha256 !== PREDECESSOR_AUTHORITY.conclusions['CL-P3A-R2-FAILURE-STREAM']) throw new Phase3BProductionError('predecessor_invalid', 'exact Phase 3A conclusion bytes drifted')
  if (Date.now() >= Date.parse(PREDECESSOR_AUTHORITY.expires_at)) throw new Phase3BProductionError('predecessor_expired', 'Phase 3A predecessor authority expired')
  return deepFreeze(value as CampaignInput)
}

function validateRepositories(input: CampaignInput, candidateCommit: string, candidateTree: string, approvalCommit: string, approvalTree: string): void {
  if (git(input.cc_repository, ['rev-parse', 'HEAD']) !== approvalCommit || git(input.cc_repository, ['rev-parse', 'HEAD^{tree}']) !== approvalTree || git(input.cc_repository, ['rev-parse', `${candidateCommit}^{tree}`]) !== candidateTree || git(input.cc_repository, ['status', '--porcelain']) !== '') throw new Phase3BProductionError('repository_authority_invalid', 'CC approval/candidate head/tree/worktree drifted')
  try { git(input.cc_repository, ['merge-base', '--is-ancestor', REPOSITORY_AUTHORITY.cc.commit, candidateCommit]) } catch { throw new Phase3BProductionError('repository_authority_invalid', 'CC exact authority merge is not candidate ancestor') }
  if (git(input.cc_repository, ['rev-parse', `${REPOSITORY_AUTHORITY.cc.commit}^{tree}`]) !== REPOSITORY_AUTHORITY.cc.tree) throw new Phase3BProductionError('repository_authority_invalid', 'CC baseline tree drifted')
  if (git(input.sub_repository, ['rev-parse', 'HEAD']) !== REPOSITORY_AUTHORITY.sub.commit || git(input.sub_repository, ['rev-parse', 'HEAD^{tree}']) !== REPOSITORY_AUTHORITY.sub.tree || git(input.sub_repository, ['status', '--porcelain']) !== '') throw new Phase3BProductionError('repository_authority_invalid', 'Sub authority head/tree/worktree drifted')
}

function validateAuthority(value: Record<string, unknown>, input: CampaignInput): OperatorAuthority {
  assertExactKeys(value, AUTHORITY_KEYS, 'operator_authority_invalid')
  assertDigestField(value, 'authority_sha256', 'operator_authority_invalid')
  for (const field of ['reviewed_candidate_commit', 'reviewed_candidate_tree', 'approval_commit', 'approval_tree', 'attestation_commit', 'attestation_tree'] as const) if (typeof value[field] !== 'string' || !/^[a-f0-9]{40}$/.test(value[field] as string)) throw new Phase3BProductionError('operator_authority_invalid', `${field} is invalid`)
  const approval = validateApprovalAttestation(input.cc_repository, String(value.reviewed_candidate_commit), String(value.reviewed_candidate_tree))
  const crossReviewRecord = readExternalCanonical(input.cross_review_artifact_path)
  const crossReview = crossReviewRecord.value
  if (crossReviewRecord.identity.sha256 !== input.cross_review_artifact_sha256 || crossReview.reviewed_candidate_commit !== value.reviewed_candidate_commit || crossReview.reviewed_candidate_tree !== value.reviewed_candidate_tree || crossReview.model !== 'gpt-5.6-sol') throw new Phase3BProductionError('operator_authority_invalid', 'cross review artifact does not bind the approved implementation candidate')
  const materializedC1 = bindMaterializedCrossRepoAuthority(stableRead(input.cross_repo_review_path, { mode: 0o600, maximumBytes: 1_048_576 }).bytes, { cc_repository: input.cc_repository, sub_repository: input.sub_repository, reviewed_candidate_commit: String(value.reviewed_candidate_commit), reviewed_candidate_tree: String(value.reviewed_candidate_tree) })
  if (materializedC1.review_sha256 !== input.cross_repo_review_sha256) throw new Phase3BProductionError('operator_authority_invalid', 'materialized C1 does not bind the exact reviewed candidate')
  verifyTrustedSignature(value, approval.registry, 'requirements', 'authority_sha256', 'operator_authority_invalid')
  const artifactSetSha256 = reviewedArtifactSetSha256(input)
  const c1 = crossRepoAuthority(input.cross_repo_review_sha256)
  if (value.schema_id !== 'oracle-lab-p3b-production-authority.v2' || value.decision !== 'authorize_fresh_phase3b_production_campaign' || value.campaign_id !== input.campaign_id || value.campaign_input_sha256 !== input.input_sha256 || value.reviewed_artifact_set_sha256 !== artifactSetSha256 || value.critical !== 0 || value.important !== 0 || value.dynamic_launch_authorized !== true || sha256Canonical(value.repositories) !== sha256Canonical(REPOSITORY_AUTHORITY) || sha256Canonical(value.c1) !== sha256Canonical(c1) || value.approval_commit !== approval.approval_commit || value.approval_tree !== approval.approval_tree || value.attestation_commit !== approval.attestation_commit || value.attestation_tree !== approval.attestation_tree || value.campaign_registry_sha256 !== approval.registry_sha256) throw new Phase3BProductionError('operator_authority_invalid', 'operator authority scope/review/source/approval binding drifted')
  if (!Number.isSafeInteger(value.created_at_ms) || !Number.isSafeInteger(value.expires_at_ms) || Number(value.created_at_ms) > Date.now() || Number(value.expires_at_ms) <= Date.now() || Number(value.expires_at_ms) - Number(value.created_at_ms) > 86_400_000) throw new Phase3BProductionError('operator_authority_stale', 'operator authority is future, stale, or overlong')
  assertSha256(value.implementation_review_sha256, 'operator_authority_invalid', 'implementation review')
  if (value.implementation_review_path !== path.join(input.cc_repository, IMPLEMENTATION_REVIEW_RELATIVE) || value.implementation_review_sha256 !== approval.implementation_review_sha256) throw new Phase3BProductionError('operator_authority_invalid', 'implementation review path/digest is not the approval-commit artifact')
  const review = approval.implementation_review as Record<string, unknown>
  assertExactKeys(review, REVIEW_KEYS, 'implementation_review_failed')
  assertDigestField(review, 'review_sha256', 'implementation_review_failed')
  verifyTrustedSignature(review, approval.registry, 'security_quality', 'review_sha256', 'implementation_review_failed')
  if (review.schema_id !== 'oracle-lab-p3b-implementation-review.v3' || review.review_kind !== 'phase3b-production-executor' || review.reviewed_candidate_commit !== value.reviewed_candidate_commit || review.reviewed_candidate_tree !== value.reviewed_candidate_tree || review.requirements_public_entry_sha256 !== sha256Canonical(approval.registry.reviewers[0]) || review.reviewed_artifact_set_sha256 !== artifactSetSha256 || review.critical !== 0 || review.important !== 0 || review.verdict !== 'PASS' || sha256Canonical(review.repositories) !== sha256Canonical(REPOSITORY_AUTHORITY) || sha256Canonical(review.c1) !== sha256Canonical(c1) || !Number.isSafeInteger(review.created_at_ms) || !Number.isSafeInteger(review.expires_at_ms) || Number(review.created_at_ms) > Date.now() || Number(review.expires_at_ms) <= Date.now() || Number(review.expires_at_ms) - Number(review.created_at_ms) > 86_400_000) throw new Phase3BProductionError('implementation_review_failed', 'trusted exact-candidate implementation review is not current 0C/0I')
  validateRepositories(input, String(value.reviewed_candidate_commit), String(value.reviewed_candidate_tree), approval.approval_commit, approval.approval_tree)
  return deepFreeze(value as OperatorAuthority)
}

function validateTargetProfile(value: unknown): TargetProfile {
  assertExactKeys(value, ['package', 'version', 'platform', 'architecture', 'platform_archive_sha256', 'platform_tree_sha256', 'entrypoint_sha256', 'entrypoint_size', 'maximum_executable_bytes'], 'test_authority_manifest_invalid')
  const profile = value as Record<string, unknown>
  for (const field of ['platform_archive_sha256', 'platform_tree_sha256', 'entrypoint_sha256'] as const) assertSha256(profile[field], 'test_authority_manifest_invalid', field)
  if (typeof profile.package !== 'string' || typeof profile.version !== 'string' || profile.platform !== 'darwin' || profile.architecture !== 'arm64' || !Number.isSafeInteger(profile.entrypoint_size) || Number(profile.entrypoint_size) <= 0 || !Number.isSafeInteger(profile.maximum_executable_bytes) || Number(profile.maximum_executable_bytes) < Number(profile.entrypoint_size) || Number(profile.maximum_executable_bytes) > TARGET_EXECUTABLE_MAXIMUM_BYTES) throw new Phase3BProductionError('test_authority_manifest_invalid', 'test target profile is outside the production executable boundary')
  return deepFreeze(value as TargetProfile)
}

function canonicalGitRecord(repository: string, commit: string, relative: string, maximumBytes = 1_048_576): Readonly<{ value: Record<string, unknown>; raw_sha256: string }> {
  const bytes = fixedGitBytes(repository, ['cat-file', 'blob', `${commit}:${relative}`], maximumBytes)
  if (bytes.at(-1) !== 0x0a) throw new Phase3BProductionError('test_authority_manifest_invalid', 'test authority Git blob is not canonical newline JSON')
  let value: unknown
  try { value = JSON.parse(bytes.subarray(0, -1).toString('utf8')) } catch { throw new Phase3BProductionError('test_authority_manifest_invalid', 'test authority Git blob is invalid JSON') }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !canonicalBytes(value).equals(bytes.subarray(0, -1))) throw new Phase3BProductionError('test_authority_manifest_invalid', 'test authority Git blob is not canonical JSON')
  return deepFreeze({ value: value as Record<string, unknown>, raw_sha256: sha256Bytes(bytes) })
}

function validateTestInput(value: Record<string, unknown>): TestCampaignInput {
  assertExactKeys(value, TEST_INPUT_KEYS, 'test_authority_manifest_invalid')
  assertDigestField(value, 'input_sha256', 'test_authority_manifest_invalid')
  if (value.schema_id !== 'oracle-lab-p3b-test-production-input.v1' || typeof value.campaign_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.campaign_id)) throw new Phase3BProductionError('test_authority_manifest_invalid', 'test campaign input schema or campaign ID drifted')
  const profile = validateTargetProfile(value.target_profile)
  for (const field of ['cross_review_artifact_sha256', 'cross_repo_review_sha256', 'probe_source_sha256', 'probe_unsigned_source_sha256', 'original_recipe_sha256', 'probe_recipe_sha256', 'platform_archive_sha256', 'source_tree_sha256', 'toolchain_sha256', 'schema_bundle_sha256', 'focused_suite_sha256', 'es7_typed_fixtures_sha256', 'es8_go_receipt_sha256', 'es8_ts_c1_agreement_sha256', 'es9_coverage_contract_sha256', 'controller_source_sha256', 'controller_executable_sha256', 'materialized_authority_sha256'] as const) assertSha256(value[field], 'test_authority_manifest_invalid', field)
  for (const field of ['campaign_input_path', 'operator_authority_path', 'evidence_root', 'cc_repository', 'sub_repository', 'cross_review_artifact_path', 'cross_repo_review_path', 'original_source', 'probe_source', 'probe_unsigned_source', 'original_recipe', 'probe_recipe', 'platform_archive_path', 'source_tree_path', 'toolchain_path', 'schema_bundle_path', 'focused_suite_path', 'es7_typed_fixtures_path', 'es8_go_receipt_path', 'es8_ts_c1_agreement_path', 'es9_coverage_contract_path', 'predecessor_config_auth_path', 'predecessor_failure_stream_path', 'materialized_authority_path', 'registry_repository'] as const) if (typeof value[field] !== 'string' || !path.isAbsolute(String(value[field])) || path.normalize(String(value[field])) !== value[field]) throw new Phase3BProductionError('test_authority_manifest_invalid', `${field} is not a normalized absolute path`)
  for (const field of ['registry_commit', 'registry_tree'] as const) if (typeof value[field] !== 'string' || !/^[a-f0-9]{40}$/.test(String(value[field]))) throw new Phase3BProductionError('test_authority_manifest_invalid', `${field} is not an exact Git object`)
  if (value.platform_archive_sha256 !== profile.platform_archive_sha256 || value.source_tree_sha256 !== profile.platform_tree_sha256) throw new Phase3BProductionError('test_authority_manifest_invalid', 'test input target archive/tree does not match its signed profile')
  const exactFiles = [
    ['cross_review_artifact_path', 'cross_review_artifact_sha256', 1_048_576], ['cross_repo_review_path', 'cross_repo_review_sha256', 1_048_576],
    ['probe_source', 'probe_source_sha256', TARGET_EXECUTABLE_MAXIMUM_BYTES], ['probe_unsigned_source', 'probe_unsigned_source_sha256', TARGET_EXECUTABLE_MAXIMUM_BYTES],
    ['original_recipe', 'original_recipe_sha256', 1_048_576], ['probe_recipe', 'probe_recipe_sha256', 1_048_576], ['platform_archive_path', 'platform_archive_sha256', TARGET_EXECUTABLE_MAXIMUM_BYTES],
    ['source_tree_path', 'source_tree_sha256', 16_777_216], ['toolchain_path', 'toolchain_sha256', 16_777_216], ['schema_bundle_path', 'schema_bundle_sha256', 16_777_216], ['focused_suite_path', 'focused_suite_sha256', 1_048_576],
    ['es7_typed_fixtures_path', 'es7_typed_fixtures_sha256', 16_777_216], ['es8_go_receipt_path', 'es8_go_receipt_sha256', 1_048_576], ['es8_ts_c1_agreement_path', 'es8_ts_c1_agreement_sha256', 1_048_576], ['es9_coverage_contract_path', 'es9_coverage_contract_sha256', 16_777_216],
  ] as const
  for (const [pathField, digestField, maximumBytes] of exactFiles) if (stableRead(String(value[pathField]), { maximumBytes }).identity.sha256 !== value[digestField]) throw new Phase3BProductionError('test_authority_manifest_invalid', `${pathField} drifted from the signed test input`)
  const original = stableRead(String(value.original_source), { maximumBytes: TARGET_EXECUTABLE_MAXIMUM_BYTES }).identity
  if (original.sha256 !== profile.entrypoint_sha256 || original.size !== profile.entrypoint_size) throw new Phase3BProductionError('test_authority_manifest_invalid', 'test target executable identity drifted')
  const materialized = readExternalCanonical(String(value.materialized_authority_path), 16_777_216)
  if (materialized.identity.sha256 !== value.materialized_authority_sha256 || materialized.value.materialized_authority_sha256 !== sha256Canonical(Object.fromEntries(Object.entries(materialized.value).filter(([field]) => field !== 'materialized_authority_sha256')))) throw new Phase3BProductionError('test_authority_manifest_invalid', 'materialized test authority bytes drifted')
  const focused = readExternalCanonical(String(value.focused_suite_path)).value
  if (focused.passed !== true || focused.strict_typescript !== true || focused.build !== true || focused.diff_check !== true) throw new Phase3BProductionError('focused_suite_failed', 'test focused receipt is not an executed PASS')
  bindMaterializedCrossRepoAuthority(stableRead(String(value.cross_repo_review_path), { mode: 0o600, maximumBytes: 1_048_576 }).bytes, { cc_repository: String(value.cc_repository), sub_repository: String(value.sub_repository), reviewed_candidate_commit: fixedGit(String(value.cc_repository), ['rev-parse', 'HEAD']), reviewed_candidate_tree: fixedGit(String(value.cc_repository), ['rev-parse', 'HEAD^{tree}']), direct_candidate: true })
  return deepFreeze({ ...value, target_profile: profile } as TestCampaignInput)
}

function validateTestAuthority(value: Record<string, unknown>, input: TestCampaignInput): Readonly<{ authority: TestOperatorAuthority; registry: TrustedReviewerRegistry; implementation_review: Record<string, unknown> }> {
  assertExactKeys(value, TEST_AUTHORITY_KEYS, 'test_authority_manifest_invalid')
  assertDigestField(value, 'authority_sha256', 'test_authority_manifest_invalid')
  assertSha256(value.campaign_input_raw_sha256, 'test_authority_manifest_invalid', 'campaign input raw digest')
  for (const field of ['campaign_input_path', 'signed_gate_b_decision_path', 'signer_closure_path'] as const) if (typeof value[field] !== 'string' || !path.isAbsolute(String(value[field])) || path.normalize(String(value[field])) !== value[field]) throw new Phase3BProductionError('test_authority_manifest_invalid', `${field} is not a signed normalized absolute path`)
  if (value.schema_id !== 'oracle-lab-p3b-test-production-authority.v1' || value.decision !== 'authorize_test_owned_offline_campaign' || value.dynamic_launch_authorized !== true || value.critical !== 0 || value.important !== 0 || value.campaign_id !== input.campaign_id || value.campaign_input_sha256 !== input.input_sha256 || value.campaign_input_path !== input.campaign_input_path || value.materialized_authority_sha256 !== input.materialized_authority_sha256 || value.reviewed_artifact_set_sha256 !== input.materialized_authority_sha256 || sha256Canonical(value.repositories) !== sha256Canonical(REPOSITORY_AUTHORITY) || sha256Canonical(value.c1) !== sha256Canonical(crossRepoAuthority(input.cross_repo_review_sha256))) throw new Phase3BProductionError('test_authority_manifest_invalid', 'test authority scope drifted')
  for (const field of ['reviewed_candidate_commit', 'reviewed_candidate_tree', 'registry_commit', 'registry_tree'] as const) if (!/^[a-f0-9]{40}$/.test(String(value[field]))) throw new Phase3BProductionError('test_authority_manifest_invalid', `${field} is invalid`)
  if (value.registry_repository !== input.registry_repository || value.registry_commit !== input.registry_commit || value.registry_tree !== input.registry_tree || value.materialized_authority_sha256 !== input.materialized_authority_sha256 || value.controller_source_sha256 !== input.controller_source_sha256 || value.controller_executable_sha256 !== input.controller_executable_sha256 || value.reviewed_candidate_commit !== fixedGit(input.cc_repository, ['rev-parse', 'HEAD']) || value.reviewed_candidate_tree !== fixedGit(input.cc_repository, ['rev-parse', 'HEAD^{tree}']) || value.registry_commit !== fixedGit(input.registry_repository, ['rev-parse', 'HEAD']) || value.registry_tree !== fixedGit(input.registry_repository, ['rev-parse', 'HEAD^{tree}'])) throw new Phase3BProductionError('test_authority_manifest_invalid', 'test authority Git/source/materialization identity drifted')
  const names = fixedGit(input.registry_repository, ['ls-tree', '-r', '--name-only', input.registry_commit]).split('\n').filter(Boolean).sort()
  if (sha256Canonical(names) !== sha256Canonical([CAMPAIGN_REVIEWER_REGISTRY_RELATIVE, IMPLEMENTATION_REVIEW_RELATIVE].sort())) throw new Phase3BProductionError('test_authority_manifest_invalid', 'test authority Git commit contains an unexpected path')
  const registryRecord = canonicalGitRecord(input.registry_repository, input.registry_commit, CAMPAIGN_REVIEWER_REGISTRY_RELATIVE, 32_768)
  const reviewRecord = canonicalGitRecord(input.registry_repository, input.registry_commit, IMPLEMENTATION_REVIEW_RELATIVE)
  const registry = validateCampaignReviewerRegistry(registryRecord.value)
  if (registryRecord.raw_sha256 !== value.campaign_registry_sha256 || registry.reviewed_candidate_commit !== value.reviewed_candidate_commit || registry.reviewed_candidate_tree !== value.reviewed_candidate_tree || reviewRecord.raw_sha256 !== value.implementation_review_sha256) throw new Phase3BProductionError('test_authority_manifest_invalid', 'test registry or review Git blob binding drifted')
  const review = reviewRecord.value
  assertExactKeys(review, TEST_REVIEW_KEYS, 'implementation_review_failed')
  assertDigestField(review, 'review_sha256', 'implementation_review_failed')
  verifyTrustedSignature(review, registry, 'security_quality', 'review_sha256', 'implementation_review_failed')
  verifyTrustedSignature(value, registry, 'requirements', 'authority_sha256', 'test_authority_manifest_invalid')
  const now = Date.now()
  if (review.schema_id !== 'oracle-lab-p3b-test-implementation-review.v1' || review.review_kind !== 'phase3b-real-controller-test' || review.reviewed_candidate_commit !== value.reviewed_candidate_commit || review.reviewed_candidate_tree !== value.reviewed_candidate_tree || review.requirements_public_entry_sha256 !== sha256Canonical(registry.reviewers[0]) || review.materialized_authority_sha256 !== input.materialized_authority_sha256 || review.controller_source_sha256 !== controllerSourceSetSha256() || review.controller_executable_sha256 !== controllerExecutableSha256() || review.critical !== 0 || review.important !== 0 || review.verdict !== 'PASS' || Number(review.created_at_ms) > now || Number(review.expires_at_ms) <= now || Number(value.created_at_ms) > now || Number(value.expires_at_ms) <= now || Number(value.expires_at_ms) - Number(value.created_at_ms) > 86_400_000) throw new Phase3BProductionError('implementation_review_failed', 'test implementation review is not current, exact-source 0C/0I')
  return deepFreeze({ authority: value as TestOperatorAuthority, registry, implementation_review: review })
}

function fixedExternalPaths(authorityPath: string, inputPath: string, evidenceRoot: string, input: CampaignInput): void {
  if (path.basename(authorityPath) !== 'phase3b-operator-authority.json' || path.basename(inputPath) !== 'phase3b-campaign-input.json' || path.basename(evidenceRoot) !== `phase3b-${input.campaign_id}` || authorityPath !== input.operator_authority_path || inputPath !== input.campaign_input_path || evidenceRoot !== input.evidence_root) throw new Phase3BProductionError('fixed_path_invalid', 'authority, input, or namespace exact path is not authority-bound')
}

function sealValidatedPrelaunch(input: SealedCampaignInput, authority: SealedOperatorAuthority, registry: TrustedReviewerRegistry, implementationReview: Readonly<Record<string, unknown>>, targetProfile: TargetProfile): Readonly<Record<string, unknown>> {
  const evidenceRoot = input.evidence_root
  const root = assertPrivateRuntimeRoot(evidenceRoot)
  assertDirectoryEmpty(root)
  for (const directory of ['control', 'prelaunch', 'observations', 'receiver-results', 'runs', 'guards', 'cell-results']) createPrivateDirectory(root, directory)
  writeExclusiveCanonical(root, 'control/campaign-input.json', input)
  writeExclusiveCanonical(root, 'control/operator-authority.json', authority)
  writeExclusiveCanonical(root, 'control/implementation-review.json', implementationReview)
  const externalControls = [
    ['control/focused-suite.json', input.focused_suite_path, input.focused_suite_sha256, 1_048_576],
    ['control/cross-review-artifact.json', input.cross_review_artifact_path, input.cross_review_artifact_sha256, 1_048_576],
    ['control/es8-go-receipt.json', input.es8_go_receipt_path, input.es8_go_receipt_sha256, 1_048_576],
    ['control/es7-typed-fixtures.json', input.es7_typed_fixtures_path, input.es7_typed_fixtures_sha256, 16_777_216],
    ['control/es8-ts-c1-agreement.json', input.es8_ts_c1_agreement_path, input.es8_ts_c1_agreement_sha256, 1_048_576],
    ['control/es9-coverage-contract.json', input.es9_coverage_contract_path, input.es9_coverage_contract_sha256, 16_777_216],
  ] as const
  for (const [relative, source, sha256, maximumBytes] of externalControls) {
    const record = readExternalCanonical(source, maximumBytes)
    if (record.identity.sha256 !== sha256) throw new Phase3BProductionError('sealed_authority_file_drift', `${relative} changed before sealing`)
    writeExclusiveCanonical(root, relative, record.value)
  }
  const predecessorControls = [
    ['control/predecessor-config-auth.json', input.predecessor_config_auth_path, 'CL-P3A-R2-CONFIG-AUTH', input.schema_id === 'oracle-lab-p3b-production-input.v2' ? PREDECESSOR_AUTHORITY.conclusions['CL-P3A-R2-CONFIG-AUTH'] : stableRead(input.predecessor_config_auth_path, { mode: 0o600, maximumBytes: 1_048_576 }).identity.sha256],
    ['control/predecessor-failure-stream.json', input.predecessor_failure_stream_path, 'CL-P3A-R2-FAILURE-STREAM', input.schema_id === 'oracle-lab-p3b-production-input.v2' ? PREDECESSOR_AUTHORITY.conclusions['CL-P3A-R2-FAILURE-STREAM'] : stableRead(input.predecessor_failure_stream_path, { mode: 0o600, maximumBytes: 1_048_576 }).identity.sha256],
  ] as const
  for (const [relative, source, conclusionId, sha256] of predecessorControls) {
    if (input.schema_id === 'oracle-lab-p3b-production-input.v2') sealPredecessorConclusion(root, relative, source, sha256, conclusionId)
    else {
      const record = readPredecessorConclusion(source, sha256)
      writeExclusiveCanonical(root, relative, record.value)
    }
  }
  const c1Record = readExternalCanonical(input.cross_repo_review_path)
  if (c1Record.identity.sha256 !== input.cross_repo_review_sha256) throw new Phase3BProductionError('sealed_authority_file_drift', 'C1 changed before sealing')
  const c1Binding = bindMaterializedCrossRepoAuthority(c1Record.bytes)
  const c1BindingUnsigned = { schema_id: 'oracle-lab-p3b-cross-repo-review-binding.v1', verdict: c1Binding.verdict, review_sha256: c1Binding.review_sha256 }
  writeExclusiveCanonical(root, 'control/cross-repo-review.json', { ...c1BindingUnsigned, binding_sha256: sha256Canonical(c1BindingUnsigned) })
  writeExclusiveCanonical(root, 'control/trusted-reviewers.json', registry)
  createPrivateDirectory(root, 'synthetic-literals')
  writeExclusiveCanonical(root, FIXED_LITERAL_TABLE_PATH, FIXED_LITERAL_TABLE)
  const c1 = crossRepoAuthority(input.cross_repo_review_sha256)
  const ledger = buildCampaignLedger(input.campaign_id, c1)
  writeExclusiveCanonical(root, 'prelaunch/run-ledger.json', ledger)
  const images = createSealedLaunchImages({ runtime_root: root, original_source: input.original_source, probe_source: input.probe_source, probe_source_sha256: input.probe_source_sha256, probe_unsigned_source: input.probe_unsigned_source, probe_unsigned_source_sha256: input.probe_unsigned_source_sha256, original_recipe: input.original_recipe, original_recipe_sha256: input.original_recipe_sha256, probe_recipe: input.probe_recipe, probe_recipe_sha256: input.probe_recipe_sha256, source_tree_sha256: input.source_tree_sha256, toolchain_sha256: input.toolchain_sha256, reviewed_artifact_set_sha256: authority.reviewed_artifact_set_sha256, target_profile: targetProfile })
  const receiver = captureReceiverRuntimeIdentity()
  const anchor = buildStaticAnchor({ c1, platform_archive_sha256: input.platform_archive_sha256, source_tree_sha256: input.source_tree_sha256, toolchain_sha256: input.toolchain_sha256, images, ...receiver, controller_source_sha256: controllerSourceSetSha256(), controller_executable_sha256: controllerExecutableSha256(), schema_bundle_sha256: input.schema_bundle_sha256, reviewed_artifact_set_sha256: authority.reviewed_artifact_set_sha256, target_profile: targetProfile })
  writeExclusiveCanonical(root, 'prelaunch/static-anchor.json', anchor)
  const selectionUnsigned = { schema_id: 'oracle-lab-p3b-active-selection.v1', campaign_id: input.campaign_id, ledger_sha256: ledger.ledger_sha256, anchor_sha256: anchor.anchor_sha256, original_image_record_sha256: images.original.record_sha256, probe_image_record_sha256: images.probe.record_sha256 }
  writeExclusiveCanonical(root, 'prelaunch/active-selection.json', { ...selectionUnsigned, selection_sha256: sha256Canonical(selectionUnsigned) })
  const unsigned = { schema_id: 'oracle-lab-p3b-prelaunch-result.v1', campaign_id: input.campaign_id, authority_sha256: authority.authority_sha256, input_sha256: input.input_sha256, ledger_sha256: ledger.ledger_sha256, anchor_sha256: anchor.anchor_sha256, launch_image_set_sha256: sha256Canonical(images), target_launches: 0, receiver_binds: 0, external_sockets: 0, status: 'SEALED' }
  const result = deepFreeze({ ...unsigned, prelaunch_result_sha256: sha256Canonical(unsigned) })
  writeExclusiveCanonical(root, 'prelaunch/result.json', result)
  chmodSync(path.join(root, 'prelaunch'), 0o500)
  return result
}

export function runPrelaunchOnly(authorityPath: string, inputPath: string, evidenceRoot: string): Readonly<Record<string, unknown>> {
  const input = validateInput(parseExternalCanonical(inputPath))
  const authority = validateAuthority(parseExternalCanonical(authorityPath), input)
  fixedExternalPaths(authorityPath, inputPath, evidenceRoot, input)
  const approval = validateApprovalAttestation(input.cc_repository, authority.reviewed_candidate_commit, authority.reviewed_candidate_tree)
  return sealValidatedPrelaunch(input, authority, approval.registry, approval.implementation_review, TARGET_PROFILE as TargetProfile)
}

function runTestPrelaunch(authorityPath: string, evidenceRoot: string): Readonly<Record<string, unknown>> {
  const authorityRecord = readExternalCanonical(authorityPath)
  const authorityValue = authorityRecord.value
  if (typeof authorityValue.campaign_input_path !== 'string' || !path.isAbsolute(authorityValue.campaign_input_path)) throw new Phase3BProductionError('test_authority_manifest_invalid', 'test authority does not bind a sealed input path')
  const inputRecord = readExternalCanonical(authorityValue.campaign_input_path, 16_777_216)
  const input = validateTestInput(inputRecord.value)
  if (inputRecord.identity.sha256 !== authorityValue.campaign_input_raw_sha256 || input.campaign_input_path !== authorityValue.campaign_input_path || input.operator_authority_path !== authorityPath || input.evidence_root !== evidenceRoot || authorityValue.campaign_input_sha256 !== input.input_sha256 || path.basename(authorityPath) !== 'phase3b-test-authority-manifest.json' || path.basename(input.campaign_input_path) !== 'phase3b-test-campaign-input.json') throw new Phase3BProductionError('test_authority_manifest_invalid', 'test authority/input/evidence path binding drifted')
  const validated = validateTestAuthority(authorityValue, input)
  return sealValidatedPrelaunch(input, validated.authority, validated.registry, validated.implementation_review, input.target_profile)
}

export function loadSealedControl(root: string): { input: SealedCampaignInput; authority: SealedOperatorAuthority; registry: TrustedReviewerRegistry } {
  const inputValue = readCanonical(root, 'control/campaign-input.json').value
  const input = inputValue.schema_id === 'oracle-lab-p3b-test-production-input.v1' ? validateTestInput(inputValue) : validateInput(inputValue)
  if (input.evidence_root !== root) throw new Phase3BProductionError('fixed_path_invalid', 'sealed campaign input does not bind this evidence root')
  const authorityValue = readCanonical(root, 'control/operator-authority.json').value
  const testValidated = input.schema_id === 'oracle-lab-p3b-test-production-input.v1' ? validateTestAuthority(authorityValue, input) : null
  const authority = testValidated?.authority ?? validateAuthority(authorityValue, input as CampaignInput)
  const registryRecord = readCanonical(root, 'control/trusted-reviewers.json')
  const registry = testValidated?.registry ?? validateCampaignReviewerRegistry(registryRecord.value)
  if (registryRecord.identity.sha256 !== authority.campaign_registry_sha256 || registry.reviewed_candidate_commit !== authority.reviewed_candidate_commit || registry.reviewed_candidate_tree !== authority.reviewed_candidate_tree) throw new Phase3BProductionError('trusted_reviewer_registry_invalid', 'sealed reviewer registry does not bind the exact authority candidate')
  return { input, authority, registry }
}

const PREEXISTING_EXECUTION_MARKERS = [
  { relative: 'execution-records', mode: 'exists' },
  { relative: 'receiver-authorities', mode: 'exists' },
  { relative: 'launch-authorities', mode: 'exists' },
  { relative: 'campaign-failure.json', mode: 'exists' },
  { relative: 'execution-result.json', mode: 'exists' },
  { relative: 'observations', mode: 'nonempty_directory' },
  { relative: 'receiver-results', mode: 'nonempty_directory' },
  { relative: 'runs', mode: 'nonempty_directory' },
  { relative: 'guards', mode: 'nonempty_directory' },
  { relative: 'cell-results', mode: 'nonempty_directory' },
] as const
const PREEXISTING_CONTROL_MARKERS = ['control/execution-attempt-failure.json', 'control/execution-evidence-assessment.json'] as const

function existingMarkers(root: string, relatives: readonly string[]): readonly string[] {
  const evidence: string[] = []
  for (const relative of relatives) {
    try { lstatSync(resolveContained(root, relative)); evidence.push(relative) } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return deepFreeze(evidence)
}

function preexistingExecutionEvidence(root: string): readonly string[] {
  const evidence: string[] = []
  for (const marker of PREEXISTING_EXECUTION_MARKERS) {
    const absolute = resolveContained(root, marker.relative)
    try {
      const stat = lstatSync(absolute)
      if (stat.isSymbolicLink() || (marker.mode === 'nonempty_directory' && !stat.isDirectory())) evidence.push(`${marker.relative}:invalid`)
      else if (marker.mode === 'exists' || readdirSync(absolute).length > 0) evidence.push(marker.relative)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
  }
  return deepFreeze(evidence)
}

function claimExecutionAttempt(root: string): Readonly<Record<string, unknown>> {
  const preexistingControlEvidence = existingMarkers(root, PREEXISTING_CONTROL_MARKERS)
  const blocked = preexistingControlEvidence.length > 0
  const unsigned = {
    schema_id: 'oracle-lab-p3b-execution-attempt-claim.v1',
    evidence_root: root,
    epoch_policy_sha256: PHASE3B_EPOCH_CONSUMPTION_POLICY_SHA256,
    consumption_boundary: PHASE3B_EPOCH_CONSUMPTION_POLICY.consumption_boundary,
    attempt_state_at_claim: blocked ? 'BLOCKED_PREEXISTING_CONTROL_EVIDENCE' : 'UNVERIFIED',
    preexisting_control_evidence: preexistingControlEvidence,
    epoch_consumed_at_claim: null,
    receiver_binds_at_claim: null,
    target_launches_at_claim: null,
    sockets_at_claim: null,
    same_attempt_resume_allowed: false,
    automatic_retry_allowed: false,
    failure_disposition_at_claim: blocked ? 'root_cause_review_and_fresh_admission_required' : null,
    terminal_status_at_claim: blocked ? 'CLOSED_UNVERIFIED_CONTROL_STATE' : null,
  }
  const claim = deepFreeze({ ...unsigned, claim_sha256: sha256Canonical(unsigned) })
  try { writeExclusiveCanonical(root, 'control/execution-attempt.json', claim) } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Phase3BProductionError('execution_resume_forbidden', 'execute mode may be invoked only once for a sealed namespace')
    throw error
  }
  if (blocked) throw new Phase3BProductionError('execution_control_evidence_preexisting', 'preexisting unbound execution control evidence requires root-cause review and fresh admission')
  return claim
}

function executionAttemptFailureCode(cause: unknown): string {
  if (cause instanceof Phase3BProductionError) return cause.code
  const code = (cause as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? `filesystem_${code.toLowerCase()}` : 'campaign_execution_failure'
}

export function executionCompletedAllRows(receipts: readonly Readonly<{ terminal_class: unknown }>[], campaignFailure: unknown): boolean {
  return campaignFailure === null && receipts.filter((receipt) => receipt.terminal_class === 'success').length === 340
}

type ExecutionAttemptFailureStage = 'execution_evidence_assessment' | 'external_control_validation' | 'sealed_prelaunch_validation' | 'live_execution' | 'execution_finalization'

export function sealExecutionAttemptFailure(root: string, claim: Readonly<Record<string, unknown>>, assessmentSha256: unknown, executionEvidence: readonly string[], failureStage: ExecutionAttemptFailureStage, cause: unknown): Readonly<Record<string, unknown>> {
  const currentEvidence = preexistingExecutionEvidence(root)
  const combinedEvidence = deepFreeze([...new Set([...executionEvidence, ...currentEvidence])].sort())
  const unverifiedLiveIo = combinedEvidence.length > 0
  const unsigned = {
    schema_id: 'oracle-lab-p3b-execution-attempt-failure.v1',
    evidence_root: root,
    execution_attempt_claim_sha256: claim.claim_sha256,
    execution_evidence_assessment_sha256: assessmentSha256,
    epoch_policy_sha256: PHASE3B_EPOCH_CONSUMPTION_POLICY_SHA256,
    failure_stage: failureStage,
    cause_code: executionAttemptFailureCode(cause),
    preexisting_execution_evidence: combinedEvidence,
    consumption_status: unverifiedLiveIo ? 'UNKNOWN_OR_CONSUMED' : 'NOT_CONSUMED',
    epoch_consumed: unverifiedLiveIo ? null : false,
    receiver_binds: unverifiedLiveIo ? null : 0,
    target_launches: unverifiedLiveIo ? null : 0,
    sockets: unverifiedLiveIo ? null : 0,
    same_attempt_resume_allowed: false,
    automatic_retry_allowed: false,
    failure_disposition: unverifiedLiveIo ? 'root_cause_review_and_fresh_admission_required' : 'close_attempt_and_start_fresh_preparation',
    terminal_status: unverifiedLiveIo ? 'CLOSED_UNVERIFIED_LIVE_IO_STATE' : 'CLOSED_BEFORE_LIVE_IO',
  }
  const failure = deepFreeze({ ...unsigned, failure_sha256: sha256Canonical(unsigned) })
  writeExclusiveCanonical(root, 'control/execution-attempt-failure.json', failure)
  return failure
}

function sealExecutionEvidenceAssessment(root: string, claim: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const before = preexistingExecutionEvidence(root)
  const unsigned = {
    schema_id: 'oracle-lab-p3b-execution-evidence-assessment.v1',
    evidence_root: root,
    execution_attempt_claim_sha256: claim.claim_sha256,
    epoch_policy_sha256: PHASE3B_EPOCH_CONSUMPTION_POLICY_SHA256,
    preexisting_execution_evidence: before,
    status: before.length === 0 ? 'CLEAR' : 'BLOCKED',
  }
  const assessment = deepFreeze({ ...unsigned, assessment_sha256: sha256Canonical(unsigned) })
  writeExclusiveCanonical(root, 'control/execution-evidence-assessment.json', assessment)
  const after = preexistingExecutionEvidence(root)
  if (sha256Canonical(after) !== sha256Canonical(before)) {
    const combined = deepFreeze([...new Set([...before, ...after])].sort())
    const error = new Phase3BProductionError('execution_evidence_drift', 'execution evidence changed across the sealed assessment')
    sealExecutionAttemptFailure(root, claim, assessment.assessment_sha256, combined, 'execution_evidence_assessment', error)
    throw error
  }
  if (before.length > 0) {
    const error = new Phase3BProductionError('execution_evidence_preexisting', 'preexisting execution evidence requires root-cause review and fresh admission')
    sealExecutionAttemptFailure(root, claim, assessment.assessment_sha256, before, 'execution_evidence_assessment', error)
    throw error
  }
  return assessment
}

export function assertExternalMatchesSealed(root: string, authorityPath: string, inputPath: string): void {
  const evidenceRoot = assertPrivateRuntimeRoot(root)
  if (path.basename(authorityPath) !== 'phase3b-operator-authority.json' || path.basename(inputPath) !== 'phase3b-campaign-input.json') throw new Phase3BProductionError('fixed_path_invalid', 'authority and input basenames are fixed')
  const pairs = [[authorityPath, 'control/operator-authority.json'], [inputPath, 'control/campaign-input.json']] as const
  for (const [external, relative] of pairs) {
    const externalIdentity = stableRead(path.resolve(external), { mode: 0o600, maximumBytes: 1_048_576 }).identity
    const sealedIdentity = readCanonical(evidenceRoot, relative).identity
    if (externalIdentity.sha256 !== sealedIdentity.sha256) throw new Phase3BProductionError('sealed_control_drift', 'CLI authority/input differs from sealed control bytes')
  }
  const sealedInput = readCanonical(evidenceRoot, 'control/campaign-input.json').value
  if (sealedInput.operator_authority_path !== authorityPath || sealedInput.campaign_input_path !== inputPath || sealedInput.evidence_root !== evidenceRoot) throw new Phase3BProductionError('fixed_path_invalid', 'CLI paths do not match the sealed namespace tuple')
}

async function executeAndFinalizeClaimedCampaign(evidenceRoot: string, claim: Readonly<Record<string, unknown>>, assessment: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>> {
  const root = assertPrivateRuntimeRoot(evidenceRoot)
  let failureStage: ExecutionAttemptFailureStage = 'sealed_prelaunch_validation'
  let attemptFailureSealed = false
  try {
    const { input, authority } = loadSealedControl(root)
    const ledger = validateCampaignLedger(readCanonical(root, 'prelaunch/run-ledger.json', 16_777_216).value)
    const imageSet = readCanonical(root, 'launch-images.json', 16_777_216).value as Record<string, any>
    if (imageSet.schema_id !== 'oracle-lab-p3b-launch-image-set.v1' || imageSet.set_sha256 !== sha256Canonical({ original: imageSet.original, probe: imageSet.probe })) throw new Phase3BProductionError('launch_image_invalid', 'sealed launch image set drifted')
    const images = { original: loadLaunchImageRecord(imageSet.original), probe: loadLaunchImageRecord(imageSet.probe) }
    const anchor = loadStaticAnchor(readCanonical(root, 'prelaunch/static-anchor.json').value)
    if (anchor.original_image_record_sha256 !== images.original.record_sha256 || anchor.probe_image_record_sha256 !== images.probe.record_sha256 || anchor.source_tree_sha256 !== input.source_tree_sha256 || anchor.toolchain_sha256 !== input.toolchain_sha256 || anchor.reviewed_artifact_set_sha256 !== authority.reviewed_artifact_set_sha256 || sha256Canonical(anchor.c1) !== sha256Canonical(crossRepoAuthority(input.cross_repo_review_sha256))) throw new Phase3BProductionError('static_anchor_invalid', 'static anchor image/source/toolchain/review/C1 drifted')
    const receiverIdentity = captureReceiverRuntimeIdentity()
    if (anchor.receiver_source_sha256 !== receiverIdentity.receiver_source_sha256 || anchor.receiver_executable_identity_sha256 !== receiverIdentity.receiver_executable_identity_sha256 || anchor.receiver_schema_sha256 !== receiverIdentity.receiver_schema_sha256 || anchor.controller_source_sha256 !== controllerSourceSetSha256() || anchor.controller_executable_sha256 !== controllerExecutableSha256()) throw new Phase3BProductionError('static_anchor_invalid', 'receiver/controller runtime tuple drifted')
    const controller = createProductionController({ campaign_id: input.campaign_id, c1: crossRepoAuthority(input.cross_repo_review_sha256) })
    bindControllerRuntime(controller, root, anchor)
    sealControllerNamespace(controller)
    const store = openExecutionStore(root, ledger)
    if (readExecutionReceipts(store).length !== 0) throw new Phase3BProductionError('execution_resume_forbidden', 'execute mode never resumes a partial namespace')
    failureStage = 'live_execution'
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
    const campaignFailure = readCampaignFailure(store)
    if (campaignFailure !== null) {
      sealExecutionAttemptFailure(root, claim, assessment.assessment_sha256, assessment.preexisting_execution_evidence as readonly string[], 'live_execution', new Phase3BProductionError(String(campaignFailure.failure_family), 'sealed campaign execution reached a terminal failure'))
      attemptFailureSealed = true
    }
    failureStage = 'execution_finalization'
    const receipts = readExecutionReceipts(store)
    const unsigned = { schema_id: 'oracle-lab-p3b-execution-result.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, authority_sha256: authority.authority_sha256, execution_attempt_claim_sha256: claim.claim_sha256, execution_evidence_assessment_sha256: assessment.assessment_sha256, planned: 340, started: receipts.filter((row) => row.state === 'started').length, spawned: receipts.filter((row) => row.state === 'spawned').length, terminal: receipts.filter((row) => row.state === 'terminal').length, not_executed: receipts.filter((row) => row.state === 'not_executed').length, receipt_set_sha256: sha256Canonical(receipts), completed_all_rows: executionCompletedAllRows(receipts, campaignFailure) }
    const result = deepFreeze({ ...unsigned, execution_result_sha256: sha256Canonical(unsigned) })
    writeExclusiveCanonical(root, 'execution-result.json', result)
    return result
  } catch (error: unknown) {
    if (!attemptFailureSealed) sealExecutionAttemptFailure(root, claim, assessment.assessment_sha256, assessment.preexisting_execution_evidence as readonly string[], failureStage, error)
    throw error
  }
}

export async function runExecuteFromSealedPrelaunch(evidenceRoot: string): Promise<Readonly<Record<string, unknown>>> {
  const root = assertPrivateRuntimeRoot(evidenceRoot)
  const claim = claimExecutionAttempt(root)
  const assessment = sealExecutionEvidenceAssessment(root, claim)
  return executeAndFinalizeClaimedCampaign(root, claim, assessment)
}

export async function runExecuteFromExternalSealedPrelaunch(evidenceRoot: string, authorityPath: string, inputPath: string): Promise<Readonly<Record<string, unknown>>> {
  const root = assertPrivateRuntimeRoot(evidenceRoot)
  const claim = claimExecutionAttempt(root)
  const assessment = sealExecutionEvidenceAssessment(root, claim)
  try { assertExternalMatchesSealed(root, authorityPath, inputPath) } catch (error: unknown) {
    sealExecutionAttemptFailure(root, claim, assessment.assessment_sha256, assessment.preexisting_execution_evidence as readonly string[], 'external_control_validation', error)
    throw error
  }
  return executeAndFinalizeClaimedCampaign(root, claim, assessment)
}

async function waitForExternalCanonical(file: string, timeoutMs = 180_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs
  do {
    try { return readExternalCanonical(file).value } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  } while (Date.now() < deadline)
  throw new Phase3BProductionError('external_authority_timeout', `external authority path was not sealed in time: ${path.basename(file)}`)
}

function validateControllerRequest(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Phase3BProductionError('campaign_controller_input_invalid', 'campaign controller accepts one closed path-only request')
  const value = input as Record<string, unknown>
  const keys = value.mode === 'test-owned-offline-full-path' ? TEST_CONTROLLER_KEYS : COMPLETE_CONTROLLER_KEYS
  try { assertExactKeys(value, keys, 'campaign_controller_input_invalid') } catch { throw new Phase3BProductionError('campaign_controller_input_invalid', 'campaign controller request contains a missing or caller-authored field') }
  for (const field of keys.filter((key) => key !== 'mode')) if (typeof value[field] !== 'string' || !path.isAbsolute(String(value[field])) || path.normalize(String(value[field])) !== value[field]) throw new Phase3BProductionError('campaign_controller_input_invalid', `${field} must be a normalized absolute sealed path`)
  return value
}

function validateSignerClosure(root: string, closurePath: string, gateBResultPath: string): Readonly<Record<string, unknown>> {
  const closureRecord = readExternalCanonical(closurePath)
  const closure = closureRecord.value
  assertExactKeys(closure, ['schema_id', 'campaign_id', 'operator_decision_sha256', 'gate_b_result_sha256', 'gate_b_result_raw_sha256', 'gate_b_result_dev', 'gate_b_result_ino', 'gate_b_result_size', 'post_gate_leak_report_sha256', 'evaluation_input_sha256', 'evidence_root', 'result_path', 'reviewer_identity', 'reviewer_role', 'signing_key_id', 'signature_algorithm', 'status', 'signature', 'closure_sha256'], 'signer_closure_invalid')
  assertDigestField(closure, 'closure_sha256', 'signer_closure_invalid')
  const { authority, registry } = loadSealedControl(root)
  verifyTrustedSignature(closure, registry, 'requirements', 'closure_sha256', 'signer_closure_invalid')
  const gateB = readCanonical(root, 'capsules/P3B-ES1/gates/gate-b-result.json').value
  const postGateLeak = readCanonical(root, 'capsules/P3B-ES1/gates/post-gate-leak-report.json').value
  const gateBIdentity = stableRead(gateBResultPath, { mode: 0o600, maximumBytes: 1_048_576 }).identity
  if (closure.schema_id !== 'oracle-lab-p3b-requirements-signer-closure.v2' || closure.campaign_id !== authority.campaign_id || closure.gate_b_result_sha256 !== gateB.gate_result_sha256 || closure.gate_b_result_raw_sha256 !== gateBIdentity.sha256 || closure.gate_b_result_dev !== gateBIdentity.dev || closure.gate_b_result_ino !== gateBIdentity.ino || closure.gate_b_result_size !== gateBIdentity.size || closure.post_gate_leak_report_sha256 !== postGateLeak.post_gate_leak_report_sha256 || closure.evaluation_input_sha256 !== gateB.evaluation_input_sha256 || closure.evidence_root !== root || closure.result_path !== gateBResultPath || closure.status !== 'private_key_destroyed_after_gate_b') throw new Phase3BProductionError('signer_closure_invalid', 'signer closure does not bind the independently validated Gate B and post-Gate leak report')
  return deepFreeze(closure)
}

export async function runCampaignController(request: unknown): Promise<Readonly<Record<string, unknown>>> {
  const input = validateControllerRequest(request)
  const root = String(input.evidence_root)
  let decisionPath: string
  let closurePath: string
  let gateAExternallyOwned = false
  if (input.mode === 'test-owned-offline-full-path') {
    const authorityPath = String(input.authority_manifest_path)
    const authority = readExternalCanonical(authorityPath).value
    runTestPrelaunch(authorityPath, root)
    decisionPath = String(authority.signed_gate_b_decision_path)
    closurePath = String(authority.signer_closure_path)
    gateAExternallyOwned = true
  } else if (input.mode === 'production-full-path') {
    const authorityPath = String(input.authority_path)
    const inputPath = String(input.input_path)
    decisionPath = String(input.signed_gate_b_decision_path)
    closurePath = String(input.signer_closure_path)
    runPrelaunchOnly(authorityPath, inputPath, root)
  } else throw new Phase3BProductionError('campaign_controller_input_invalid', 'campaign controller mode is not fixed')
  for (const [file, basename] of [[decisionPath, 'phase3b-successor-amendment-decision.json'], [closurePath, 'phase3b-requirements-signer-closure.json']] as const) if (path.basename(file) !== basename) throw new Phase3BProductionError('campaign_controller_input_invalid', 'external decision and signer closure basenames are fixed')

  const execution = await runExecuteFromSealedPrelaunch(root)
  if (execution.completed_all_rows !== true) throw new Phase3BProductionError('campaign_execution_failed', 'campaign execution stopped before all sealed rows reached a successful terminal receipt')
  const closeoutModule = await import('./closeout.js')
  const gatesModule = await import('./gates.js')
  const curation = closeoutModule.deriveCuration(root)
  const closeout = closeoutModule.runCloseout(root)
  const gateAPath = path.join(root, 'capsules/P3B-ES1/gates/gate-a-result.json')
  if (gateAExternallyOwned) await waitForExternalCanonical(gateAPath)
  else gatesModule.evaluateGateA(root)
  const gateA = readCanonical(root, 'capsules/P3B-ES1/gates/gate-a-result.json').value
  await waitForExternalCanonical(decisionPath)
  gatesModule.importSignedOperatorDecision(root, decisionPath)
  const gateB = gatesModule.writeGateB(root)
  const postGateLeak = closeoutModule.writePostGateLeakReport(root)
  const gateBPath = path.join(root, 'capsules/P3B-ES1/gates/gate-b-result.json')
  const validatedGateB = gatesModule.validateSealedGateBResult(root, gateBPath)
  await waitForExternalCanonical(closurePath)
  const signerClosure = validateSignerClosure(root, closurePath, gateBPath)
  const ledger = validateCampaignLedger(readCanonical(root, 'prelaunch/run-ledger.json', 16_777_216).value)
  const receipts = readExecutionReceipts(openExecutionStore(root, ledger))
  const provenance = readCanonical(root, 'capsules/P3B-ES1/curation/support/field-provenance.json', 16_777_216).value
  const normalized = provenance.normative_resolved
  const result = { schema_id: 'oracle-lab-p3b-campaign-controller-result.v1', campaign_id: ledger.campaign_id, row_count: ledger.rows.length, receipt_count: receipts.length, normative_leaf_count: Array.isArray(normalized) ? normalized.length : -1, pre_gate_leak_status: readCanonical(root, 'capsules/P3B-ES1/closure/leak-report.json').value.status, post_gate_leak_status: postGateLeak.status, gate_b_validated: validatedGateB.value.gate_result_sha256 === gateB.gate_result_sha256 && validatedGateB.value.decision === 'PASS', signer_destroyed: signerClosure.status === 'private_key_destroyed_after_gate_b', execution_result_sha256: execution.execution_result_sha256, curation_sha256: curation.curation_sha256, closeout_sha256: closeout.external_set_sha256, gate_a_sha256: gateA.gate_result_sha256, gate_b_sha256: gateB.gate_result_sha256 }
  return deepFreeze({ ...result, controller_result_sha256: sha256Canonical(result) })
}
