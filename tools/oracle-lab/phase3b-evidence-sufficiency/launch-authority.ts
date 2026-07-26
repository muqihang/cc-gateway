import { execFileSync } from 'node:child_process'

import { type ProductionController, assertProductionController, controllerState } from './controller.js'
import { Phase3BProductionError, assertDigestField, deepFreeze, sha256Canonical } from './core.js'
import { deriveExecutionCounts, type ExecutionStore } from './execution-store.js'
import { type LaunchImageRecord, verifyLaunchImage } from './launch-image.js'
import { CROSS_REPO_AUTHORITY, PREDECESSOR_AUTHORITY, REPOSITORY_AUTHORITY, TARGET_PROFILE, type RunLedgerRow } from './ledger.js'
import { type ReceiverAuthority, assertReceiverAuthority } from './receiver.js'
import { createPrivateDirectory, readCanonical, stableRead, writeExclusiveCanonical } from './sealed-fs.js'
import { controllerExecutableSha256, controllerSourceSetSha256 } from './source-identity.js'

export type LaunchAuthorityReceipt = Readonly<{
  schema_id: 'oracle-lab-p3b-launch-authority.v1'
  campaign_id: string
  ledger_sha256: string
  run_id: string
  sequence_index: number
  row_sha256: string
  family: string
  schedule_id: string
  seed: number
  repetition: number
  arm: string
  argv_sha256: string
  environment_policy_sha256: string
  cwd_sha256: string
  stdin_sha256: string
  literal_table_sha256: string
  response_program_sha256: string
  guard_profile_sha256: string
  anchor_sha256: string
  receiver_authority_sha256: string
  launch_image_record_sha256: string
  executable_identity_sha256: string
  target_launches_before: number
  target_launch_ceiling: 340
  receipt_sha256: string
}>

const launchAuthorities = new WeakSet<object>()

function git(repository: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', timeout: 10_000 }).trim()
}

export function assertControllerLaunchPrerequisites(controller: ProductionController): void {
  assertProductionController(controller)
  const state = controllerState(controller)
  const root = state.runtimeRoot!
  const authority = readCanonical(root, 'control/operator-authority.json').value
  const input = readCanonical(root, 'control/campaign-input.json').value
  const anchor = readCanonical(root, 'prelaunch/static-anchor.json').value
  const selection = readCanonical(root, 'prelaunch/active-selection.json').value
  const ledger = readCanonical(root, 'prelaunch/run-ledger.json', 16_777_216).value
  for (const [record, digest, code] of [[authority, 'authority_sha256', 'operator_authority_invalid'], [input, 'input_sha256', 'campaign_input_invalid'], [anchor, 'anchor_sha256', 'static_anchor_invalid'], [selection, 'selection_sha256', 'active_selection_invalid'], [ledger, 'ledger_sha256', 'launch_ledger_invalid']] as const) assertDigestField(record, digest, code)
  if (authority.campaign_id !== state.ledger.campaign_id || authority.campaign_input_sha256 !== input.input_sha256 || authority.dynamic_launch_authorized !== true || authority.critical !== 0 || authority.important !== 0 || sha256Canonical(authority.repositories) !== sha256Canonical(REPOSITORY_AUTHORITY) || sha256Canonical(authority.c1) !== sha256Canonical(CROSS_REPO_AUTHORITY) || Number(authority.created_at_ms) > Date.now() || Number(authority.expires_at_ms) <= Date.now()) throw new Phase3BProductionError('operator_authority_invalid', 'live operator authority drifted')
  if (ledger.ledger_sha256 !== state.ledger.ledger_sha256 || anchor.anchor_sha256 !== state.anchorSha256 || selection.ledger_sha256 !== state.ledger.ledger_sha256 || selection.anchor_sha256 !== state.anchorSha256 || selection.original_image_record_sha256 !== anchor.original_image_record_sha256 || selection.probe_image_record_sha256 !== anchor.probe_image_record_sha256) throw new Phase3BProductionError('active_selection_invalid', 'live ledger/anchor/selection drifted')
  if (anchor.controller_source_sha256 !== controllerSourceSetSha256() || anchor.controller_executable_sha256 !== controllerExecutableSha256()) throw new Phase3BProductionError('controller_identity_invalid', 'controller source or executable identity drifted')
  for (const field of ['cc_repository', 'sub_repository', 'implementation_review_path', 'cross_repo_review_path', 'platform_archive_path', 'source_tree_path', 'toolchain_path', 'schema_bundle_path', 'focused_suite_path', 'predecessor_config_auth_path', 'predecessor_failure_stream_path']) if (typeof (field === 'implementation_review_path' ? authority[field] : input[field]) !== 'string') throw new Phase3BProductionError('sealed_path_invalid', `${field} is not sealed`)
  const cc = String(input.cc_repository); const sub = String(input.sub_repository)
  if (git(cc, ['rev-parse', 'HEAD']) !== authority.reviewed_candidate_commit || git(cc, ['rev-parse', 'HEAD^{tree}']) !== authority.reviewed_candidate_tree || git(cc, ['status', '--porcelain']) !== '' || git(sub, ['rev-parse', 'HEAD']) !== REPOSITORY_AUTHORITY.sub.commit || git(sub, ['rev-parse', 'HEAD^{tree}']) !== REPOSITORY_AUTHORITY.sub.tree || git(sub, ['status', '--porcelain']) !== '') throw new Phase3BProductionError('repository_authority_invalid', 'live repository authority drifted')
  try { git(cc, ['merge-base', '--is-ancestor', REPOSITORY_AUTHORITY.cc.commit, String(authority.reviewed_candidate_commit)]) } catch { throw new Phase3BProductionError('repository_authority_invalid', 'CC authority merge is not candidate ancestor') }
  const exactFiles = [
    [String(authority.implementation_review_path), String(authority.implementation_review_sha256)],
    [String(input.cross_repo_review_path), CROSS_REPO_AUTHORITY.review_sha256],
    [String(input.platform_archive_path), TARGET_PROFILE.platform_archive_sha256],
    [String(input.source_tree_path), String(input.source_tree_sha256)],
    [String(input.toolchain_path), String(input.toolchain_sha256)],
    [String(input.schema_bundle_path), String(input.schema_bundle_sha256)],
    [String(input.focused_suite_path), String(input.focused_suite_sha256)],
    [String(input.predecessor_config_auth_path), PREDECESSOR_AUTHORITY.conclusions['CL-P3A-R2-CONFIG-AUTH']],
    [String(input.predecessor_failure_stream_path), PREDECESSOR_AUTHORITY.conclusions['CL-P3A-R2-FAILURE-STREAM']],
  ] as const
  for (const [file, digest] of exactFiles) if (stableRead(file, { maximumBytes: 16_777_216 }).identity.sha256 !== digest) throw new Phase3BProductionError('sealed_authority_file_drift', 'live fixed authority file bytes drifted')
  if (Date.now() >= Date.parse(PREDECESSOR_AUTHORITY.expires_at)) throw new Phase3BProductionError('predecessor_expired', 'predecessor authority expired before launch')
}

export function deriveLaunchAuthority(input: Readonly<{
  controller: ProductionController
  store: ExecutionStore
  row: RunLedgerRow
  receiver_authority: ReceiverAuthority
  launch_image: LaunchImageRecord
}>): LaunchAuthorityReceipt {
  assertProductionController(input.controller)
  assertControllerLaunchPrerequisites(input.controller)
  assertReceiverAuthority(input.receiver_authority, input.row)
  const launchImage = verifyLaunchImage(input.launch_image)
  const state = controllerState(input.controller)
  if (!state.namespaceSealed || state.runtimeRoot === null) throw new Phase3BProductionError('launch_authority_invalid', 'sealed fixed namespace is required before launch authority')
  const exact = state.ledger.rows[input.row.sequence_index]
  if (!exact || exact.row_sha256 !== input.row.row_sha256 || input.store.ledger_sha256 !== state.ledger.ledger_sha256 || input.store.records_root !== `${state.runtimeRoot}/execution-records`) throw new Phase3BProductionError('launch_authority_invalid', 'ledger, store, runtime, or row binding drifted')
  const anchor = readCanonical(state.runtimeRoot, 'prelaunch/static-anchor.json').value
  const selectedRecord = input.row.selected_executable_class === 'original_image' ? anchor.original_image_record_sha256 : anchor.probe_image_record_sha256
  if (input.receiver_authority.anchor_sha256 !== state.anchorSha256 || input.receiver_authority.ledger_sha256 !== state.ledger.ledger_sha256 || launchImage.selected_executable_class !== input.row.selected_executable_class || launchImage.record_sha256 !== selectedRecord || launchImage.source_tree_sha256 !== anchor.source_tree_sha256 || launchImage.toolchain_sha256 !== anchor.toolchain_sha256) throw new Phase3BProductionError('launch_authority_invalid', 'receiver anchor or selected image source/tree/toolchain drifted')
  const counts = deriveExecutionCounts(input.store)
  if (counts.started >= state.ledger.target_launch_ceiling || counts.started !== input.row.sequence_index || counts.terminal !== input.row.sequence_index || counts.not_executed !== 0) throw new Phase3BProductionError('launch_authority_invalid', 'remaining budget or exact serial ordinal drifted')
  if (input.row.sequence_index >= 20) {
    const receipts = (awaitlessReadReceipts(input.store))
    const controls = receipts.filter((receipt) => receipt.sequence_index < 20 && receipt.state === 'terminal')
    const controlResult = readCanonical(state.runtimeRoot, 'target-controls/result.json').value
    assertDigestField(controlResult, 'control_result_sha256', 'control_tranche_failed')
    if (controls.length !== 20 || controls.some((receipt) => receipt.terminal_class !== 'success') || controlResult.campaign_id !== state.ledger.campaign_id || controlResult.ledger_sha256 !== state.ledger.ledger_sha256 || controlResult.status !== 'PASS') throw new Phase3BProductionError('control_tranche_failed', 'all 20 target controls must terminal successfully and seal exact paired projections first')
  }
  const unsigned = {
    schema_id: 'oracle-lab-p3b-launch-authority.v1' as const,
    campaign_id: state.ledger.campaign_id,
    ledger_sha256: state.ledger.ledger_sha256,
    run_id: input.row.run_id,
    sequence_index: input.row.sequence_index,
    row_sha256: input.row.row_sha256,
    family: input.row.family,
    schedule_id: input.row.schedule_id,
    seed: input.row.seed,
    repetition: input.row.repetition,
    arm: input.row.arm,
    argv_sha256: input.row.argv_sha256,
    environment_policy_sha256: input.row.environment_sha256,
    cwd_sha256: input.row.cwd_sha256,
    stdin_sha256: input.row.stdin_sha256,
    literal_table_sha256: input.row.literal_table_sha256,
    response_program_sha256: input.row.response_program_sha256,
    guard_profile_sha256: input.row.guard_profile_sha256,
    anchor_sha256: state.anchorSha256,
    receiver_authority_sha256: input.receiver_authority.authority_sha256,
    launch_image_record_sha256: launchImage.record_sha256,
    executable_identity_sha256: sha256Canonical(launchImage.image_identity),
    target_launches_before: counts.started,
    target_launch_ceiling: 340 as const,
  }
  const receipt = deepFreeze({ ...unsigned, receipt_sha256: sha256Canonical(unsigned) })
  launchAuthorities.add(receipt)
  createPrivateDirectory(state.runtimeRoot, 'launch-authorities')
  writeExclusiveCanonical(state.runtimeRoot, `launch-authorities/${String(input.row.sequence_index).padStart(3, '0')}-${input.row.run_id}.json`, receipt)
  return receipt
}

// Kept as a late import call so the store/authority modules have no initialization-time dependency.
function awaitlessReadReceipts(store: ExecutionStore) {
  return requireReadReceipts(store)
}

import { readExecutionReceipts as requireReadReceipts } from './execution-store.js'

export function assertLaunchAuthority(receipt: unknown, row?: RunLedgerRow): asserts receipt is LaunchAuthorityReceipt {
  if (!receipt || typeof receipt !== 'object' || !launchAuthorities.has(receipt as object)) throw new Phase3BProductionError('launch_authority_invalid', 'opaque internally derived launch authority is required')
  const value = receipt as LaunchAuthorityReceipt
  if (value.receipt_sha256 !== sha256Canonical(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'receipt_sha256')))) throw new Phase3BProductionError('launch_authority_invalid', 'launch authority digest drifted')
  if (row && (value.run_id !== row.run_id || value.sequence_index !== row.sequence_index || value.row_sha256 !== row.row_sha256)) throw new Phase3BProductionError('launch_authority_invalid', 'launch authority does not bind row')
}
