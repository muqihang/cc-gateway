import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'

import { buildCrossRepoRecord, encodeCrossRepoRecord, executeCrossRepoRecord, validateCrossRepoRecord } from '../../oracle-contract/check-cross-repo.js'
import { validateIndependentGoReceipt } from './closeout.js'
import { Phase3BProductionError, assertExactKeys, canonicalBytes, deepFreeze, sha256Bytes, sha256Canonical, utf8Compare } from './core.js'
import { REPOSITORY_AUTHORITY, TARGET_PROFILE, buildCampaignLedger, crossRepoAuthority } from './ledger.js'
import { assertDirectoryEmpty, assertPrivateRuntimeRoot, stableRead, writeExclusiveBytes, writeExclusiveCanonical } from './sealed-fs.js'

export type MaterializedCrossRepoAuthority = Readonly<{
  verdict: 'CROSS_REPO_PASS'
  review_sha256: string
}>

export type MaterializedCrossRepoValidation = Readonly<{
  cc_repository: string
  sub_repository: string
  reviewed_candidate_commit: string
  reviewed_candidate_tree: string
}>

export const MATERIALIZED_BASENAMES = deepFreeze({
  campaign_input: 'phase3b-campaign-input.json', operator_authority: 'phase3b-operator-authority.json', c1_record: 'phase3b-c1-cross-repo-record.json', es7_fixtures: 'phase3b-es7-typed-fixtures.json', es8_go_receipt: 'phase3b-es8-go-receipt.json', es8_ts_agreement: 'phase3b-es8-ts-c1-agreement.json', es9_coverage: 'phase3b-es9-coverage-contract.json', focused_suite: 'phase3b-focused-suite.json', original_recipe: 'phase3b-original-launch-recipe.json', probe_recipe: 'phase3b-probe-launch-recipe.json', schema_bundle: 'phase3b-schema-bundle.json',
})

export type AuthorityMaterializerInput = Readonly<{
  output_root: string
  evidence_root: string
  campaign_id: string
  cc_repository: string
  sub_repository: string
  reviewed_candidate_commit: string
  reviewed_candidate_tree: string
  cross_review_task_id: string
  cross_review_artifact_sha256: string
  original_source: string
  probe_source: string
  probe_unsigned_source: string
  platform_archive_path: string
  source_tree_path: string
  toolchain_path: string
  predecessor_config_auth_path: string
  predecessor_failure_stream_path: string
}>

export function reviewedArtifactSetSha256(input: Readonly<Record<string, unknown>>): string {
  const fields = ['cross_repo_review_sha256', 'probe_source_sha256', 'probe_unsigned_source_sha256', 'original_recipe_sha256', 'probe_recipe_sha256', 'source_tree_sha256', 'toolchain_sha256', 'schema_bundle_sha256', 'focused_suite_sha256', 'es7_typed_fixtures_sha256', 'es8_go_receipt_sha256', 'es8_ts_c1_agreement_sha256', 'es9_coverage_contract_sha256'] as const
  const projection = Object.fromEntries(fields.map((field) => [field, input[field]]))
  if (fields.some((field) => typeof input[field] !== 'string' || !/^[a-f0-9]{64}$/.test(String(input[field])))) throw new Phase3BProductionError('authority_materialization_invalid', 'reviewed artifact set contains a missing or invalid digest')
  return sha256Canonical({ schema_id: 'oracle-lab-p3b-reviewed-artifact-set.v3', target_profile: TARGET_PROFILE, ...projection })
}

function git(repository: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', timeout: 30_000 }).trim()
}

function codeSignatureIdentity(file: string): string {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Phase3BProductionError('authority_materialization_invalid', 'probe signing identity supports only darwin-arm64')
  const verification = spawnSync('/usr/bin/codesign', ['--verify', '--strict', '--verbose=4', file], { encoding: 'utf8', timeout: 10_000 })
  const inspection = spawnSync('/usr/bin/codesign', ['-d', '--verbose=4', file], { encoding: 'utf8', timeout: 10_000 })
  if (verification.status !== 0 || inspection.status !== 0) throw new Phase3BProductionError('authority_materialization_invalid', 'probe code signature is not valid')
  return sha256Bytes(Buffer.from(`${inspection.stdout}${inspection.stderr}`.replaceAll(file, '$SEALED_IMAGE'), 'utf8'))
}

function launchRecipe(kind: 'original' | 'probe', sourceSha256: string, preSignSha256: string, sourceTreeSha256: string, toolchainSha256: string, signature: string | null): Readonly<Record<string, unknown>> {
  const semantics = kind === 'original' ? ['byte-identical-copy', 'no-observer-mutation'] : ['request-observation-only', 'response-observation-only', 'no-request-mutation', 'no-response-mutation', 'no-retry-mutation', 'no-config-mutation', 'no-auth-mutation']
  const buildCommand = ['/bin/cp', '$SOURCE', '$OUTPUT']
  const unsigned = { schema_id: 'oracle-lab-p3b-launch-recipe.v3', kind, source_sha256: sourceSha256, source_tree_sha256: sourceTreeSha256, toolchain_sha256: toolchainSha256, semantics, build_command: buildCommand, build_command_sha256: sha256Canonical(buildCommand), pre_sign_sha256: preSignSha256, post_sign_sha256: sourceSha256, code_signature_identity_sha256: signature }
  return deepFreeze({ ...unsigned, recipe_sha256: sha256Canonical(unsigned) })
}

export function buildEs7TypedFixtureContract(campaignId: string, c1ReviewSha256: string): Readonly<Record<string, unknown>> {
  const ledger = buildCampaignLedger(campaignId, crossRepoAuthority(c1ReviewSha256))
  const unsigned = {
    schema_id: 'oracle-lab-p3b-es7-typed-fixture-contract.v1', campaign_id: campaignId, repositories: ledger.authority, c1: ledger.c1, ledger_sha256: ledger.ledger_sha256,
    request_fields: ['method', 'path', 'query_present', 'ordered_header_classes', 'header_presence', 'auth_marker_winner_class', 'body_byte_length', 'body_sha256', 'body_ast'],
    response_fields: ['status', 'ordered_header_classes', 'body_byte_length', 'body_sha256', 'sse_event_order', 'transport_terminal', 'delay_elapsed_ns', 'timing_bucket', 'wire_events', 'wire_event_sha256', 'socket_close_had_error'],
    rows: ledger.rows.map((row) => ({ sequence_index: row.sequence_index, run_id: row.run_id, row_sha256: row.row_sha256, request_stimulus_sha256: row.request_stimulus_sha256, response_program_sha256: row.response_program_sha256, maximum_attempts: row.response_program.maximum_attempts })),
  }
  return deepFreeze({ ...unsigned, contract_sha256: sha256Canonical(unsigned) })
}

export function buildEs8TsAgreement(goReceipt: Record<string, unknown>, goRawSha256: string, campaignId: string, c1ReviewSha256: string): Readonly<Record<string, unknown>> {
  validateIndependentGoReceipt(goReceipt, c1ReviewSha256)
  const ledger = buildCampaignLedger(campaignId, crossRepoAuthority(c1ReviewSha256))
  const unsigned = { schema_id: 'oracle-lab-p3b-es8-ts-c1-agreement.v1', repositories: ledger.authority, c1_record_sha256: c1ReviewSha256, go_receipt_raw_sha256: goRawSha256, go_receipt_internal_sha256: goReceipt.receipt_digest, decisions_sha256: goReceipt.decisions_sha256, mutation_results_sha256: goReceipt.mutation_results_sha256, required_set_sha256: goReceipt.required_set_sha256, stable_code_count: goReceipt.stable_code_count, stable_code_set_sha256: goReceipt.stable_code_set_sha256, decision: 'PASS' }
  return deepFreeze({ ...unsigned, agreement_sha256: sha256Canonical(unsigned) })
}

export function buildEs9CoverageContract(): Readonly<Record<string, unknown>> {
  const request = ['auth_marker_winner_class', 'body_ast', 'body_byte_length', 'body_sha256', 'header_presence', 'method', 'ordered_header_classes', 'path', 'query_present'].map((field) => ({ pointer_suffix: `/request/${field}`, observation_pointer: `/${field}`, source_class: 'request' }))
  const response = ['body_byte_length', 'body_sha256', 'delay_elapsed_ns', 'ordered_header_classes', 'socket_close_had_error', 'sse_event_order', 'status', 'timing_bucket', 'transport_terminal', 'wire_event_sha256', 'wire_events'].map((field) => ({ pointer_suffix: `/response/${field}`, observation_pointer: `/response/${field}`, source_class: 'response' }))
  const enabledSources = [...request, ...response].sort((left, right) => utf8Compare(left.pointer_suffix, right.pointer_suffix))
  const disabledExclusions = [{ pointer_suffix: '/request/raw_body', reason_code: 'sensitive_raw_bytes' }, { pointer_suffix: '/response/raw_body', reason_code: 'sensitive_raw_bytes' }]
  const unsigned = { schema_id: 'oracle-lab-p3b-es9-coverage-contract.v1', repositories: REPOSITORY_AUTHORITY, fixture_schema_id: 'oracle-lab-p3b-typed-wire-fixtures.v3', enabled_sources: enabledSources, disabled_exclusions: disabledExclusions }
  return deepFreeze({ ...unsigned, contract_sha256: sha256Canonical(unsigned) })
}

function runFocusedSuite(repository: string): Readonly<Record<string, unknown>> {
  const focused = ['tests/oracle-phase3b-production-executor-red.test.ts', 'tests/oracle-phase3b-production-core.test.ts', 'tests/oracle-phase3b-targeted-closure-red.test.ts', 'tests/oracle-phase3b-authority-materialization-red.test.ts']
  const sources = ['authority-materializer-cli.ts', 'authority-materializer.ts', 'campaign-controller.ts', 'closeout.ts', 'controller.ts', 'core.ts', 'ephemeral-signer.ts', 'execution-store.ts', 'gates.ts', 'launch-authority.ts', 'launch-image.ts', 'ledger.ts', 'operator-decision.ts', 'production-executor.ts', 'receiver.ts', 'route-policy.ts', 'sandbox-policy.ts', 'scenario-input.ts', 'sealed-fs.ts', 'source-identity.ts', 'spawn-adapter.ts', 'trust.ts'].map((name) => `tools/oracle-lab/phase3b-evidence-sufficiency/${name}`)
  const commands = [
    [process.execPath, ['--import', 'tsx', '--test', ...focused]],
    [path.join(repository, 'node_modules/.bin/tsc'), ['--noEmit', '--strict', '--noUnusedLocals', '--noUnusedParameters', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--esModuleInterop', '--skipLibCheck', ...focused, ...sources, 'tools/oracle-contract/check-cross-repo.ts']],
    ['/usr/bin/env', ['npm', 'run', 'build']],
    ['/usr/bin/git', ['-C', repository, 'diff', '--check', `${REPOSITORY_AUTHORITY.cc.commit}..HEAD`]],
  ] as const
  for (const [executable, args] of commands) {
    const result = spawnSync(executable, args, { cwd: repository, encoding: 'utf8', timeout: 600_000, maxBuffer: 8_388_608 })
    if (result.status !== 0) throw new Phase3BProductionError('focused_suite_failed', `focused authority command failed: ${path.basename(executable)}`)
  }
  if (git(repository, ['status', '--porcelain=v1', '--untracked-files=normal']) !== '') throw new Phase3BProductionError('focused_suite_failed', 'implementation candidate is not clean')
  const unsigned = { schema_id: 'oracle-lab-p3b-focused-suite.v2', reviewed_candidate_commit: git(repository, ['rev-parse', 'HEAD']), reviewed_candidate_tree: git(repository, ['rev-parse', 'HEAD^{tree}']), focused_files: focused, passed: true, strict_typescript: true, build: true, diff_check: true }
  return deepFreeze({ ...unsigned, receipt_sha256: sha256Canonical(unsigned) })
}

export function materializeAuthorityArtifacts(input: AuthorityMaterializerInput): Readonly<Record<string, unknown>> {
  const root = assertPrivateRuntimeRoot(input.output_root)
  assertDirectoryEmpty(root)
  const absolutePaths = [input.output_root, input.evidence_root, input.cc_repository, input.sub_repository, input.original_source, input.probe_source, input.probe_unsigned_source, input.platform_archive_path, input.source_tree_path, input.toolchain_path, input.predecessor_config_auth_path, input.predecessor_failure_stream_path]
  if (absolutePaths.some((entry) => !path.isAbsolute(entry) || path.normalize(entry) !== entry) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.campaign_id) || !/^[A-Za-z0-9._:-]{3,200}$/.test(input.cross_review_task_id) || !/^[a-f0-9]{64}$/.test(input.cross_review_artifact_sha256) || !/^[a-f0-9]{40}$/.test(input.reviewed_candidate_commit) || !/^[a-f0-9]{40}$/.test(input.reviewed_candidate_tree) || path.basename(input.evidence_root) !== `phase3b-${input.campaign_id}` || git(input.cc_repository, ['rev-parse', 'HEAD']) !== input.reviewed_candidate_commit || git(input.cc_repository, ['rev-parse', 'HEAD^{tree}']) !== input.reviewed_candidate_tree || git(input.cc_repository, ['status', '--porcelain=v1', '--untracked-files=normal']) !== '') throw new Phase3BProductionError('authority_materialization_invalid', 'candidate, campaign, path, review, or future evidence namespace binding drifted')
  const c1Record = buildCrossRepoRecord(input.cc_repository, input.sub_repository, { issuedAtMs: Date.now(), ccC1Commit: input.reviewed_candidate_commit, ccC1Tree: input.reviewed_candidate_tree, crossReviewTaskId: input.cross_review_task_id, crossReviewArtifactSha256: input.cross_review_artifact_sha256 })
  const c1Bytes = encodeCrossRepoRecord(c1Record)
  const executed = executeCrossRepoRecord({ ccGatewayRoot: input.cc_repository, sub2apiRoot: input.sub_repository, recordBytes: c1Bytes })
  const c1Sha256 = sha256Bytes(c1Bytes)
  const c1 = bindMaterializedCrossRepoAuthority(c1Bytes)
  if (c1.review_sha256 !== c1Sha256) throw new Phase3BProductionError('authority_materialization_invalid', 'materialized C1 digest drifted')
  const c1Identity = writeExclusiveBytes(root, MATERIALIZED_BASENAMES.c1_record, c1Bytes)
  const goIdentity = writeExclusiveBytes(root, MATERIALIZED_BASENAMES.es8_go_receipt, executed.receiptBytes)
  const goValue = JSON.parse(executed.receiptBytes.subarray(0, -1).toString('utf8')) as Record<string, unknown>
  validateIndependentGoReceipt(goValue, c1Sha256)
  const es7Identity = writeExclusiveCanonical(root, MATERIALIZED_BASENAMES.es7_fixtures, buildEs7TypedFixtureContract(input.campaign_id, c1Sha256))
  const es8Identity = writeExclusiveCanonical(root, MATERIALIZED_BASENAMES.es8_ts_agreement, buildEs8TsAgreement(goValue, goIdentity.sha256, input.campaign_id, c1Sha256))
  const es9Identity = writeExclusiveCanonical(root, MATERIALIZED_BASENAMES.es9_coverage, buildEs9CoverageContract())
  const original = stableRead(input.original_source, { maximumBytes: 67_108_864 }).identity
  const probe = stableRead(input.probe_source, { maximumBytes: 67_108_864 }).identity
  const probeUnsigned = stableRead(input.probe_unsigned_source, { maximumBytes: 67_108_864 }).identity
  const sourceTree = stableRead(input.source_tree_path, { maximumBytes: 16_777_216 }).identity
  const toolchain = stableRead(input.toolchain_path, { maximumBytes: 16_777_216 }).identity
  const archive = stableRead(input.platform_archive_path, { maximumBytes: 134_217_728 }).identity
  if (original.sha256 !== TARGET_PROFILE.entrypoint_sha256 || sourceTree.sha256 !== TARGET_PROFILE.platform_tree_sha256 || archive.sha256 !== TARGET_PROFILE.platform_archive_sha256) throw new Phase3BProductionError('authority_materialization_invalid', 'target source/tree/archive identity drifted')
  const originalRecipeIdentity = writeExclusiveCanonical(root, MATERIALIZED_BASENAMES.original_recipe, launchRecipe('original', original.sha256, original.sha256, sourceTree.sha256, toolchain.sha256, null))
  const probeRecipeIdentity = writeExclusiveCanonical(root, MATERIALIZED_BASENAMES.probe_recipe, launchRecipe('probe', probe.sha256, probeUnsigned.sha256, sourceTree.sha256, toolchain.sha256, codeSignatureIdentity(input.probe_source)))
  const schemaFiles = ['authority-materializer-cli.ts', 'authority-materializer.ts', 'campaign-controller.ts', 'closeout.ts', 'ephemeral-signer.ts', 'execution-store.ts', 'launch-authority.ts', 'launch-image.ts', 'ledger.ts', 'receiver.ts', 'trust.ts'].map((name) => {
    const relative = `tools/oracle-lab/phase3b-evidence-sufficiency/${name}`
    return { relative_path: relative, sha256: stableRead(path.join(input.cc_repository, relative), { maximumBytes: 1_048_576 }).identity.sha256 }
  })
  const schemaUnsigned = { schema_id: 'oracle-lab-p3b-schema-bundle.v1', reviewed_candidate_commit: input.reviewed_candidate_commit, reviewed_candidate_tree: input.reviewed_candidate_tree, files: schemaFiles }
  const schemaIdentity = writeExclusiveCanonical(root, MATERIALIZED_BASENAMES.schema_bundle, { ...schemaUnsigned, bundle_sha256: sha256Canonical(schemaUnsigned) })
  const focusedIdentity = writeExclusiveCanonical(root, MATERIALIZED_BASENAMES.focused_suite, runFocusedSuite(input.cc_repository))
  const campaignInputUnsigned = {
    schema_id: 'oracle-lab-p3b-production-input.v2', campaign_id: input.campaign_id,
    campaign_input_path: path.join(root, MATERIALIZED_BASENAMES.campaign_input), operator_authority_path: path.join(root, MATERIALIZED_BASENAMES.operator_authority), evidence_root: input.evidence_root,
    cc_repository: input.cc_repository, sub_repository: input.sub_repository,
    cross_repo_review_path: c1Identity.path, cross_repo_review_sha256: c1Identity.sha256,
    original_source: original.path, probe_source: probe.path, probe_source_sha256: probe.sha256, probe_unsigned_source: probeUnsigned.path, probe_unsigned_source_sha256: probeUnsigned.sha256,
    original_recipe: originalRecipeIdentity.path, original_recipe_sha256: originalRecipeIdentity.sha256, probe_recipe: probeRecipeIdentity.path, probe_recipe_sha256: probeRecipeIdentity.sha256,
    platform_archive_path: archive.path, platform_archive_sha256: archive.sha256, source_tree_path: sourceTree.path, source_tree_sha256: sourceTree.sha256, toolchain_path: toolchain.path, toolchain_sha256: toolchain.sha256,
    schema_bundle_path: schemaIdentity.path, schema_bundle_sha256: schemaIdentity.sha256, focused_suite_path: focusedIdentity.path, focused_suite_sha256: focusedIdentity.sha256,
    es7_typed_fixtures_path: es7Identity.path, es7_typed_fixtures_sha256: es7Identity.sha256,
    es8_go_receipt_path: goIdentity.path, es8_go_receipt_sha256: goIdentity.sha256, es8_ts_c1_agreement_path: es8Identity.path, es8_ts_c1_agreement_sha256: es8Identity.sha256, es9_coverage_contract_path: es9Identity.path, es9_coverage_contract_sha256: es9Identity.sha256,
    predecessor_config_auth_path: input.predecessor_config_auth_path, predecessor_failure_stream_path: input.predecessor_failure_stream_path,
  }
  const campaignInput = deepFreeze({ ...campaignInputUnsigned, input_sha256: sha256Canonical(campaignInputUnsigned) })
  const inputIdentity = writeExclusiveCanonical(root, MATERIALIZED_BASENAMES.campaign_input, campaignInput)
  return deepFreeze({ schema_id: 'oracle-lab-p3b-authority-materialization-result.v1', campaign_id: input.campaign_id, c1_record_sha256: c1Identity.sha256, go_receipt_sha256: goIdentity.sha256, campaign_input_sha256: campaignInput.input_sha256, campaign_input_raw_sha256: inputIdentity.sha256, target_launches: 0, receiver_binds: 0, official_evidence_namespaces: 0 })
}

export function bindMaterializedCrossRepoAuthority(rawRecord: Uint8Array, validation?: MaterializedCrossRepoValidation): MaterializedCrossRepoAuthority {
  const bytes = Buffer.from(rawRecord)
  if (bytes.length < 2 || bytes.length > 1_048_576 || bytes.at(-1) !== 0x0a) throw new Phase3BProductionError('cross_repo_authority_invalid', 'C1 record must be bounded canonical JSON plus LF')
  let value: unknown
  try { value = JSON.parse(bytes.subarray(0, -1).toString('utf8')) } catch { throw new Phase3BProductionError('cross_repo_authority_invalid', 'C1 record JSON is invalid') }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !canonicalBytes(value).equals(bytes.subarray(0, -1))) throw new Phase3BProductionError('cross_repo_authority_invalid', 'C1 record is not canonical JSON')
  const record = value as Record<string, unknown>
  const review = record.review as Record<string, unknown> | undefined
  const cross = review?.cross as Record<string, unknown> | undefined
  if (record.schema_id !== 'oracle.cross_repo_record' || !cross) throw new Phase3BProductionError('cross_repo_authority_invalid', 'C1 record schema or cross review is absent')
  assertExactKeys(cross, ['task_id', 'model', 'artifact_sha256', 'critical', 'important', 'verdict'], 'cross_repo_authority_invalid')
  if (cross.model !== 'gpt-5.6-sol' || cross.critical !== 0 || cross.important !== 0 || cross.verdict !== 'CROSS_REPO_PASS') throw new Phase3BProductionError('cross_repo_authority_invalid', 'C1 record does not contain an exact 0C/0I CROSS_REPO_PASS')
  if (validation) {
    try {
      validateCrossRepoRecord(bytes, validation.cc_repository, validation.sub_repository, { expectedCcC1: { commit: validation.reviewed_candidate_commit, tree: validation.reviewed_candidate_tree } })
    } catch (error) {
      throw new Phase3BProductionError('cross_repo_authority_invalid', `materialized C1 validation failed: ${(error as Error).message}`)
    }
  }
  return deepFreeze({ verdict: 'CROSS_REPO_PASS', review_sha256: sha256Bytes(bytes) })
}
