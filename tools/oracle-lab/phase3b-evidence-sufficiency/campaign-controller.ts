import { execFileSync } from 'node:child_process'
import { chmodSync } from 'node:fs'
import path from 'node:path'

import { bindControllerRuntime, createProductionController, sealControllerNamespace } from './controller.js'
import { Phase3BProductionError, assertDigestField, assertExactKeys, assertSha256, canonicalBytes, deepFreeze, sha256Canonical } from './core.js'
import { appendTerminal, openExecutionStore, readCampaignFailure, readExecutionReceipts, sealPostTerminalFailure, sealPreSpawnFailure } from './execution-store.js'
import { deriveLaunchAuthority, type LaunchAuthorityReceipt } from './launch-authority.js'
import { buildStaticAnchor, createSealedLaunchImages, loadLaunchImageRecord, loadStaticAnchor, type LaunchImageRecord } from './launch-image.js'
import { FIXED_LITERAL_TABLE, FIXED_LITERAL_TABLE_PATH, PREDECESSOR_AUTHORITY, REPOSITORY_AUTHORITY, TARGET_PROFILE, buildCampaignLedger, crossRepoAuthority, validateCampaignLedger, type CrossRepoAuthority } from './ledger.js'
import { abortReceiverGroup, bindReceiverGroup, captureReceiverRuntimeIdentity, type ReceiverAuthority } from './receiver.js'
import { sealTargetControlTranche } from './closeout.js'
import { assertDirectoryEmpty, assertPrivateRuntimeRoot, createPrivateDirectory, readCanonical, stableRead, writeExclusiveCanonical } from './sealed-fs.js'
import { executeProductionRow } from './spawn-adapter.js'
import { controllerExecutableSha256, controllerSourceSetSha256 } from './source-identity.js'
import { TARGET_EXECUTABLE_MAXIMUM_BYTES } from './launch-image.js'
import { IMPLEMENTATION_REVIEW_RELATIVE, validateApprovalAttestation, verifyTrustedSignature } from './trust.js'
import { bindMaterializedCrossRepoAuthority, reviewedArtifactSetSha256 } from './authority-materializer.js'

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

const INPUT_KEYS = ['schema_id', 'campaign_id', 'campaign_input_path', 'operator_authority_path', 'evidence_root', 'cc_repository', 'sub_repository', 'cross_review_task_id', 'cross_review_artifact_path', 'cross_review_artifact_sha256', 'cross_repo_review_path', 'cross_repo_review_sha256', 'original_source', 'probe_source', 'probe_source_sha256', 'probe_unsigned_source', 'probe_unsigned_source_sha256', 'original_recipe', 'original_recipe_sha256', 'probe_recipe', 'probe_recipe_sha256', 'platform_archive_path', 'platform_archive_sha256', 'source_tree_path', 'source_tree_sha256', 'toolchain_path', 'toolchain_sha256', 'schema_bundle_path', 'schema_bundle_sha256', 'focused_suite_path', 'focused_suite_sha256', 'es7_typed_fixtures_path', 'es7_typed_fixtures_sha256', 'es8_go_receipt_path', 'es8_go_receipt_sha256', 'es8_ts_c1_agreement_path', 'es8_ts_c1_agreement_sha256', 'es9_coverage_contract_path', 'es9_coverage_contract_sha256', 'predecessor_config_auth_path', 'predecessor_failure_stream_path', 'input_sha256'] as const
const AUTHORITY_KEYS = ['schema_id', 'decision', 'campaign_id', 'campaign_input_sha256', 'repositories', 'c1', 'reviewed_candidate_commit', 'reviewed_candidate_tree', 'approval_commit', 'approval_tree', 'attestation_commit', 'attestation_tree', 'campaign_registry_sha256', 'implementation_review_path', 'implementation_review_sha256', 'reviewed_artifact_set_sha256', 'critical', 'important', 'dynamic_launch_authorized', 'created_at_ms', 'expires_at_ms', 'reviewer_identity', 'reviewer_role', 'signing_key_id', 'signature_algorithm', 'signature', 'authority_sha256'] as const
const REVIEW_KEYS = ['schema_id', 'review_kind', 'reviewed_candidate_commit', 'reviewed_candidate_tree', 'repositories', 'c1', 'requirements_public_entry_sha256', 'reviewed_artifact_set_sha256', 'critical', 'important', 'verdict', 'created_at_ms', 'expires_at_ms', 'reviewer_identity', 'reviewer_role', 'signing_key_id', 'signature_algorithm', 'signature', 'review_sha256'] as const

function readExternalCanonical(file: string, maximumBytes = 1_048_576): ReturnType<typeof stableRead> & { value: Record<string, unknown> } {
  const { bytes, identity } = stableRead(file, { mode: 0o600, maximumBytes })
  if (typeof process.getuid === 'function' && identity.uid !== process.getuid()) throw new Phase3BProductionError('authority_owner_invalid', 'authority artifact is not owned by current operator UID')
  if (bytes.at(-1) !== 0x0a) throw new Phase3BProductionError('canonical_record_invalid', 'external authority must be canonical newline JSON')
  let value: unknown
  try { value = JSON.parse(bytes.subarray(0, -1).toString('utf8')) } catch { throw new Phase3BProductionError('canonical_record_invalid', 'external authority JSON is invalid') }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !canonicalBytes(value).equals(bytes.subarray(0, -1))) throw new Phase3BProductionError('canonical_record_invalid', 'external authority is not canonical JSON')
  return { bytes, identity, value: value as Record<string, unknown> }
}

function parseExternalCanonical(file: string, maximumBytes = 1_048_576): Record<string, unknown> {
  return readExternalCanonical(file, maximumBytes).value
}

function git(repository: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', timeout: 10_000 }).trim()
}

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
  writeExclusiveCanonical(root, 'control/implementation-review.json', validateApprovalAttestation(input.cc_repository, authority.reviewed_candidate_commit, authority.reviewed_candidate_tree).implementation_review)
  const externalControls = [
    ['control/focused-suite.json', input.focused_suite_path, input.focused_suite_sha256, 1_048_576],
    ['control/cross-review-artifact.json', input.cross_review_artifact_path, input.cross_review_artifact_sha256, 1_048_576],
    ['control/cross-repo-review.json', input.cross_repo_review_path, input.cross_repo_review_sha256, 1_048_576],
    ['control/es8-go-receipt.json', input.es8_go_receipt_path, input.es8_go_receipt_sha256, 1_048_576],
    ['control/es7-typed-fixtures.json', input.es7_typed_fixtures_path, input.es7_typed_fixtures_sha256, 16_777_216],
    ['control/es8-ts-c1-agreement.json', input.es8_ts_c1_agreement_path, input.es8_ts_c1_agreement_sha256, 1_048_576],
    ['control/es9-coverage-contract.json', input.es9_coverage_contract_path, input.es9_coverage_contract_sha256, 16_777_216],
    ['control/predecessor-config-auth.json', input.predecessor_config_auth_path, PREDECESSOR_AUTHORITY.conclusions['CL-P3A-R2-CONFIG-AUTH'], 1_048_576],
    ['control/predecessor-failure-stream.json', input.predecessor_failure_stream_path, PREDECESSOR_AUTHORITY.conclusions['CL-P3A-R2-FAILURE-STREAM'], 1_048_576],
  ] as const
  for (const [relative, source, sha256, maximumBytes] of externalControls) {
    const record = readExternalCanonical(source, maximumBytes)
    if (record.identity.sha256 !== sha256) throw new Phase3BProductionError('sealed_authority_file_drift', `${relative} changed before sealing`)
    writeExclusiveCanonical(root, relative, record.value)
  }
  writeExclusiveCanonical(root, 'control/trusted-reviewers.json', validateApprovalAttestation(input.cc_repository, authority.reviewed_candidate_commit, authority.reviewed_candidate_tree).registry)
  createPrivateDirectory(root, 'synthetic-literals')
  writeExclusiveCanonical(root, FIXED_LITERAL_TABLE_PATH, FIXED_LITERAL_TABLE)
  const c1 = crossRepoAuthority(input.cross_repo_review_sha256)
  const ledger = buildCampaignLedger(input.campaign_id, c1)
  writeExclusiveCanonical(root, 'prelaunch/run-ledger.json', ledger)
  const images = createSealedLaunchImages({ runtime_root: root, original_source: input.original_source, probe_source: input.probe_source, probe_source_sha256: input.probe_source_sha256, probe_unsigned_source: input.probe_unsigned_source, probe_unsigned_source_sha256: input.probe_unsigned_source_sha256, original_recipe: input.original_recipe, original_recipe_sha256: input.original_recipe_sha256, probe_recipe: input.probe_recipe, probe_recipe_sha256: input.probe_recipe_sha256, source_tree_sha256: input.source_tree_sha256, toolchain_sha256: input.toolchain_sha256, reviewed_artifact_set_sha256: authority.reviewed_artifact_set_sha256 })
  const receiver = captureReceiverRuntimeIdentity()
  const anchor = buildStaticAnchor({ c1, platform_archive_sha256: input.platform_archive_sha256, source_tree_sha256: input.source_tree_sha256, toolchain_sha256: input.toolchain_sha256, images, ...receiver, controller_source_sha256: controllerSourceSetSha256(), controller_executable_sha256: controllerExecutableSha256(), schema_bundle_sha256: input.schema_bundle_sha256, reviewed_artifact_set_sha256: authority.reviewed_artifact_set_sha256 })
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
  if (anchor.original_image_record_sha256 !== images.original.record_sha256 || anchor.probe_image_record_sha256 !== images.probe.record_sha256 || anchor.source_tree_sha256 !== input.source_tree_sha256 || anchor.toolchain_sha256 !== input.toolchain_sha256 || anchor.reviewed_artifact_set_sha256 !== authority.reviewed_artifact_set_sha256 || sha256Canonical(anchor.c1) !== sha256Canonical(crossRepoAuthority(input.cross_repo_review_sha256))) throw new Phase3BProductionError('static_anchor_invalid', 'static anchor image/source/toolchain/review/C1 drifted')
  const receiverIdentity = captureReceiverRuntimeIdentity()
  if (anchor.receiver_source_sha256 !== receiverIdentity.receiver_source_sha256 || anchor.receiver_executable_identity_sha256 !== receiverIdentity.receiver_executable_identity_sha256 || anchor.receiver_schema_sha256 !== receiverIdentity.receiver_schema_sha256 || anchor.controller_source_sha256 !== controllerSourceSetSha256() || anchor.controller_executable_sha256 !== controllerExecutableSha256()) throw new Phase3BProductionError('static_anchor_invalid', 'receiver/controller runtime tuple drifted')
  const controller = createProductionController({ campaign_id: input.campaign_id, c1: crossRepoAuthority(input.cross_repo_review_sha256) })
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
