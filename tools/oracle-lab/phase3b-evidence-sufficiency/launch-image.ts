import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync } from 'node:fs'
import path from 'node:path'

import { Phase3BProductionError, assertDigestField, assertExactKeys, assertSha256, deepFreeze, sha256Bytes, sha256Canonical } from './core.js'
import { BOOTSTRAP_CONTRACT_SCHEMA, CLAUDE_MESSAGES_REQUEST_CONTRACT, REPOSITORY_AUTHORITY, TARGET_PROFILE, crossRepoAuthority, type CrossRepoAuthority, type TargetProfile } from './ledger.js'
import { createPrivateDirectory, readCanonical, stableRead, writeExclusiveBytes, writeExclusiveCanonical, type StableFileIdentity } from './sealed-fs.js'

export type LaunchImageRecord = Readonly<{
  schema_id: 'oracle-lab-p3b-launch-image.v1'
  selected_executable_class: 'original_image' | 'probe_image'
  image_identity: StableFileIdentity
  source_identity: StableFileIdentity
  source_tree_sha256: string
  toolchain_sha256: string
  recipe_sha256: string
  recipe_identity: StableFileIdentity
  recipe_identity_sha256: string
  probe_semantics_sha256: string
  code_signature_identity_sha256: string | null
  code_signature_entitlements_sha256: string | null
  reviewed_artifact_set_sha256: string
  record_sha256: string
}>

export type StaticAnchor = Readonly<{
  schema_id: 'oracle-lab-p3b-static-anchor.v1'
  repositories: typeof REPOSITORY_AUTHORITY
  c1: CrossRepoAuthority
  target_profile: TargetProfile
  platform_archive_sha256: string
  source_tree_sha256: string
  toolchain_sha256: string
  original_image_record_sha256: string
  probe_image_record_sha256: string
  receiver_source_sha256: string
  receiver_executable_identity_sha256: string
  receiver_schema_sha256: string
  request_target: typeof CLAUDE_MESSAGES_REQUEST_CONTRACT
  bootstrap_contract_schema: typeof BOOTSTRAP_CONTRACT_SCHEMA
  controller_source_sha256: string
  controller_executable_sha256: string
  schema_bundle_sha256: string
  reviewed_artifact_set_sha256: string
  anchor_sha256: string
}>

type Recipe = Readonly<{
  schema_id: 'oracle-lab-p3b-launch-recipe.v5'
  kind: 'original' | 'probe'
  source_sha256: string
  source_tree_sha256: string
  toolchain_sha256: string
  semantics: readonly string[]
  build_command: readonly (readonly string[])[]
  build_command_sha256: string
  pre_sign_sha256: string
  post_sign_sha256: string
  rebuilt_post_sign_sha256: string
  rebuild_verified: true
  code_signature_identifier: string | null
  code_signature_identity_sha256: string | null
  code_signature_entitlements_sha256: string | null
  reviewed_signed_source_sha256: string | null
  recipe_sha256: string
}>

const images = new WeakSet<object>()
const anchors = new WeakSet<object>()
export const TARGET_EXECUTABLE_MAXIMUM_BYTES = TARGET_PROFILE.maximum_executable_bytes
export const REQUIRED_PROBE_ENTITLEMENTS = deepFreeze({
  'com.apple.security.automation.apple-events': true,
  'com.apple.security.cs.allow-jit': true,
  'com.apple.security.cs.allow-unsigned-executable-memory': true,
  'com.apple.security.cs.disable-library-validation': true,
  'com.apple.security.device.audio-input': true,
})
export const REQUIRED_PROBE_ENTITLEMENTS_SHA256 = sha256Canonical(REQUIRED_PROBE_ENTITLEMENTS)
export const REQUIRED_PROBE_ENTITLEMENTS_XML = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.automation.apple-events</key><true/><key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/><key>com.apple.security.cs.disable-library-validation</key><true/><key>com.apple.security.device.audio-input</key><true/></dict></plist>\n'
const ORIGINAL_SEMANTICS = ['byte-identical-copy', 'no-observer-mutation'] as const
const PROBE_SEMANTICS = ['request-observation-only', 'response-observation-only', 'no-request-mutation', 'no-response-mutation', 'no-retry-mutation', 'no-config-mutation', 'no-auth-mutation'] as const

export function requiredProbeEntitlementsSha256(file: string): string {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Phase3BProductionError('launch_image_platform_invalid', 'probe entitlements support only darwin-arm64')
  const extracted = spawnSync('/usr/bin/codesign', ['-d', '--xml', '--entitlements', '-', file], { encoding: 'buffer', timeout: 10_000, maxBuffer: 1_048_576 })
  const expected = Buffer.from(REQUIRED_PROBE_ENTITLEMENTS_XML, 'utf8')
  if (extracted.status !== 0 || extracted.error || !Buffer.isBuffer(extracted.stdout) || !extracted.stdout.equals(expected)) throw new Phase3BProductionError('launch_image_entitlements_invalid', 'probe code signature entitlements differ from the fixed allowlist')
  return REQUIRED_PROBE_ENTITLEMENTS_SHA256
}

function readRecipe(file: string, expectedRecipeSha256: string, kind: Recipe['kind'], sourceSha256: string, preSignSha256: string, sourceTreeSha256: string, toolchainSha256: string): { recipe: Recipe; identity: StableFileIdentity } {
  const root = path.dirname(file)
  const relative = path.basename(file)
  const { value, identity } = readCanonical(root, relative, 32_768)
  if (identity.sha256 !== expectedRecipeSha256) throw new Phase3BProductionError('launch_recipe_invalid', 'recipe bytes differ from the trusted reviewed artifact set')
  assertExactKeys(value, ['schema_id', 'kind', 'source_sha256', 'source_tree_sha256', 'toolchain_sha256', 'semantics', 'build_command', 'build_command_sha256', 'pre_sign_sha256', 'post_sign_sha256', 'rebuilt_post_sign_sha256', 'rebuild_verified', 'code_signature_identifier', 'code_signature_identity_sha256', 'code_signature_entitlements_sha256', 'reviewed_signed_source_sha256', 'recipe_sha256'], 'launch_recipe_invalid')
  assertDigestField(value, 'recipe_sha256', 'launch_recipe_invalid')
  const expectedSemantics = kind === 'probe' ? PROBE_SEMANTICS : ORIGINAL_SEMANTICS
  const expectedBuildCommand = kind === 'original' ? [['/bin/cp', '$SOURCE', '$OUTPUT']] : [['/bin/cp', '$UNSIGNED_SOURCE', '$OUTPUT'], ['/usr/bin/codesign', '--force', '--sign', '-', '--identifier', '$CODE_SIGNATURE_IDENTIFIER', '--timestamp=none', '$OUTPUT'], ['/usr/bin/codesign', '--force', '--sign', '-', '--identifier', '$CODE_SIGNATURE_IDENTIFIER', '--entitlements', '$ENTITLEMENTS', '--timestamp=none', '$OUTPUT']]
  if (value.schema_id !== 'oracle-lab-p3b-launch-recipe.v5' || value.kind !== kind || value.source_sha256 !== sourceSha256 || value.pre_sign_sha256 !== preSignSha256 || value.post_sign_sha256 !== sourceSha256 || value.rebuilt_post_sign_sha256 !== sourceSha256 || value.rebuild_verified !== true || value.source_tree_sha256 !== sourceTreeSha256 || value.toolchain_sha256 !== toolchainSha256 || sha256Canonical(value.semantics) !== sha256Canonical(expectedSemantics) || sha256Canonical(value.build_command) !== sha256Canonical(expectedBuildCommand) || value.build_command_sha256 !== sha256Canonical(expectedBuildCommand)) throw new Phase3BProductionError('launch_recipe_invalid', 'recipe rebuild/source/tree/toolchain/probe semantics drifted')
  if (kind === 'probe') {
    assertSha256(value.code_signature_identity_sha256, 'launch_recipe_invalid', 'code signature identity')
    assertSha256(value.reviewed_signed_source_sha256, 'launch_recipe_invalid', 'reviewed signed source')
    if (typeof value.code_signature_identifier !== 'string' || !/^[A-Za-z0-9._-]{1,255}$/.test(value.code_signature_identifier)) throw new Phase3BProductionError('launch_recipe_invalid', 'probe signature identifier is invalid')
    if (value.code_signature_entitlements_sha256 !== REQUIRED_PROBE_ENTITLEMENTS_SHA256) throw new Phase3BProductionError('launch_recipe_invalid', 'probe recipe does not bind the fixed entitlement allowlist')
  } else if (value.code_signature_identity_sha256 !== null || value.code_signature_identifier !== null || value.code_signature_entitlements_sha256 !== null || value.reviewed_signed_source_sha256 !== null) throw new Phase3BProductionError('launch_recipe_invalid', 'original recipe must not claim a probe signature')
  return { recipe: deepFreeze(value as Recipe), identity }
}

function codeSignatureIdentity(file: string): string {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Phase3BProductionError('launch_image_platform_invalid', 'sealed launch images support only darwin-arm64')
  try {
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', '--verbose=4', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 })
    const inspection = spawnSync('/usr/bin/codesign', ['-d', '--verbose=4', file], { encoding: 'utf8', timeout: 10_000 })
    if (inspection.status !== 0) throw new Phase3BProductionError('launch_image_signature_invalid', 'probe code signature inspection failed')
    const details = `${inspection.stdout}${inspection.stderr}`
    return sha256Bytes(Buffer.from(details.replaceAll(file, '$SEALED_IMAGE'), 'utf8'))
  } catch { throw new Phase3BProductionError('launch_image_signature_invalid', 'probe code signature validation failed') }
}

function recordImage(input: { selectedClass: LaunchImageRecord['selected_executable_class']; imagePath: string; sourceIdentity: StableFileIdentity; sourceTreeSha256: string; toolchainSha256: string; recipe: Recipe; recipeIdentity: StableFileIdentity; reviewedArtifactSetSha256: string }): LaunchImageRecord {
  const imageIdentity = stableRead(input.imagePath, { mode: 0o500, maximumBytes: TARGET_EXECUTABLE_MAXIMUM_BYTES }).identity
  if (imageIdentity.sha256 !== input.sourceIdentity.sha256 || imageIdentity.size !== input.sourceIdentity.size) throw new Phase3BProductionError('launch_image_drift', 'campaign image is not byte-identical to sealed source')
  const signature = input.selectedClass === 'probe_image' ? codeSignatureIdentity(input.imagePath) : null
  const entitlements = input.selectedClass === 'probe_image' ? requiredProbeEntitlementsSha256(input.imagePath) : null
  if (signature !== input.recipe.code_signature_identity_sha256) throw new Phase3BProductionError('launch_image_signature_invalid', 'probe signature identity does not match recipe')
  if (entitlements !== input.recipe.code_signature_entitlements_sha256) throw new Phase3BProductionError('launch_image_entitlements_invalid', 'probe entitlements do not match recipe')
  const unsigned = {
    schema_id: 'oracle-lab-p3b-launch-image.v1' as const,
    selected_executable_class: input.selectedClass,
    image_identity: imageIdentity,
    source_identity: input.sourceIdentity,
    source_tree_sha256: input.sourceTreeSha256,
    toolchain_sha256: input.toolchainSha256,
    recipe_sha256: input.recipe.recipe_sha256,
    recipe_identity: input.recipeIdentity,
    recipe_identity_sha256: sha256Canonical(input.recipeIdentity),
    probe_semantics_sha256: sha256Canonical(input.recipe.semantics),
    code_signature_identity_sha256: signature,
    code_signature_entitlements_sha256: entitlements,
    reviewed_artifact_set_sha256: input.reviewedArtifactSetSha256,
  }
  const record = deepFreeze({ ...unsigned, record_sha256: sha256Canonical(unsigned) })
  images.add(record)
  return record
}

export function createSealedLaunchImages(input: Readonly<{ runtime_root: string; original_source: string; probe_source: string; probe_source_sha256: string; probe_unsigned_source: string; probe_unsigned_source_sha256: string; original_recipe: string; original_recipe_sha256: string; probe_recipe: string; probe_recipe_sha256: string; source_tree_sha256: string; toolchain_sha256: string; reviewed_artifact_set_sha256: string; target_profile?: TargetProfile }>): Readonly<{ original: LaunchImageRecord; probe: LaunchImageRecord }> {
  assertSha256(input.source_tree_sha256, 'launch_image_input_invalid', 'source tree')
  assertSha256(input.toolchain_sha256, 'launch_image_input_invalid', 'toolchain')
  const targetProfile: TargetProfile = input.target_profile ?? TARGET_PROFILE as TargetProfile
  const originalSource = stableRead(input.original_source, { maximumBytes: TARGET_EXECUTABLE_MAXIMUM_BYTES }).identity
  if (originalSource.sha256 !== targetProfile.entrypoint_sha256 || originalSource.size !== targetProfile.entrypoint_size || input.source_tree_sha256 !== targetProfile.platform_tree_sha256 || targetProfile.platform !== 'darwin' || targetProfile.architecture !== 'arm64' || !Number.isSafeInteger(targetProfile.maximum_executable_bytes) || targetProfile.maximum_executable_bytes < targetProfile.entrypoint_size || targetProfile.maximum_executable_bytes > TARGET_EXECUTABLE_MAXIMUM_BYTES) throw new Phase3BProductionError('launch_image_invalid', 'original launch image does not match the authority-bound target profile')
  const probeSource = stableRead(input.probe_source, { maximumBytes: TARGET_EXECUTABLE_MAXIMUM_BYTES }).identity
  const probeUnsignedSource = stableRead(input.probe_unsigned_source, { maximumBytes: TARGET_EXECUTABLE_MAXIMUM_BYTES }).identity
  if (probeSource.sha256 !== input.probe_source_sha256 || probeUnsignedSource.sha256 !== input.probe_unsigned_source_sha256) throw new Phase3BProductionError('launch_image_invalid', 'probe pre-sign or post-sign bytes drifted from trusted review')
  const originalRecipe = readRecipe(input.original_recipe, input.original_recipe_sha256, 'original', originalSource.sha256, originalSource.sha256, input.source_tree_sha256, input.toolchain_sha256)
  const probeRecipe = readRecipe(input.probe_recipe, input.probe_recipe_sha256, 'probe', probeSource.sha256, probeUnsignedSource.sha256, input.source_tree_sha256, input.toolchain_sha256)
  const imageRoot = createPrivateDirectory(input.runtime_root, 'launch-images')
  const originalPath = path.join(imageRoot, 'original-image')
  const probePath = path.join(imageRoot, 'probe-image')
  writeExclusiveBytes(input.runtime_root, 'launch-images/original-image', stableRead(input.original_source, { maximumBytes: TARGET_EXECUTABLE_MAXIMUM_BYTES }).bytes, 0o500)
  writeExclusiveBytes(input.runtime_root, 'launch-images/probe-image', stableRead(input.probe_source, { maximumBytes: TARGET_EXECUTABLE_MAXIMUM_BYTES }).bytes, 0o500)
  const result = deepFreeze({
    original: recordImage({ selectedClass: 'original_image', imagePath: originalPath, sourceIdentity: originalSource, sourceTreeSha256: input.source_tree_sha256, toolchainSha256: input.toolchain_sha256, recipe: originalRecipe.recipe, recipeIdentity: originalRecipe.identity, reviewedArtifactSetSha256: input.reviewed_artifact_set_sha256 }),
    probe: recordImage({ selectedClass: 'probe_image', imagePath: probePath, sourceIdentity: probeSource, sourceTreeSha256: input.source_tree_sha256, toolchainSha256: input.toolchain_sha256, recipe: probeRecipe.recipe, recipeIdentity: probeRecipe.identity, reviewedArtifactSetSha256: input.reviewed_artifact_set_sha256 }),
  })
  writeExclusiveCanonical(input.runtime_root, 'launch-images.json', { schema_id: 'oracle-lab-p3b-launch-image-set.v1', original: result.original, probe: result.probe, set_sha256: sha256Canonical(result) })
  chmodSync(imageRoot, 0o500)
  return result
}

export function verifyLaunchImage(record: unknown): LaunchImageRecord {
  if (!record || typeof record !== 'object' || !images.has(record as object)) throw new Phase3BProductionError('launch_image_invalid', 'opaque campaign-owned launch image is required')
  const value = record as LaunchImageRecord
  const current = stableRead(value.image_identity.path, { mode: 0o500, maximumBytes: TARGET_EXECUTABLE_MAXIMUM_BYTES }).identity
  const source = stableRead(value.source_identity.path, { maximumBytes: TARGET_EXECUTABLE_MAXIMUM_BYTES }).identity
  const recipe = stableRead(value.recipe_identity.path, { mode: 0o600, maximumBytes: 32_768 }).identity
  if (sha256Canonical(current) !== sha256Canonical(value.image_identity) || sha256Canonical(source) !== sha256Canonical(value.source_identity) || sha256Canonical(recipe) !== sha256Canonical(value.recipe_identity) || sha256Canonical(recipe) !== value.recipe_identity_sha256 || value.record_sha256 !== sha256Canonical(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'record_sha256')))) throw new Phase3BProductionError('launch_image_drift', 'launch image/source/recipe live identity drifted')
  if (value.selected_executable_class === 'probe_image' && codeSignatureIdentity(value.image_identity.path) !== value.code_signature_identity_sha256) throw new Phase3BProductionError('launch_image_signature_invalid', 'probe signature drifted')
  if (value.selected_executable_class === 'probe_image' && requiredProbeEntitlementsSha256(value.image_identity.path) !== value.code_signature_entitlements_sha256) throw new Phase3BProductionError('launch_image_entitlements_invalid', 'probe entitlements drifted')
  return value
}

export function loadLaunchImageRecord(value: unknown): LaunchImageRecord {
  assertExactKeys(value, ['schema_id', 'selected_executable_class', 'image_identity', 'source_identity', 'source_tree_sha256', 'toolchain_sha256', 'recipe_sha256', 'recipe_identity', 'recipe_identity_sha256', 'probe_semantics_sha256', 'code_signature_identity_sha256', 'code_signature_entitlements_sha256', 'reviewed_artifact_set_sha256', 'record_sha256'], 'launch_image_invalid')
  assertDigestField(value, 'record_sha256', 'launch_image_invalid')
  if (value.schema_id !== 'oracle-lab-p3b-launch-image.v1' || !['original_image', 'probe_image'].includes(String(value.selected_executable_class))) throw new Phase3BProductionError('launch_image_invalid', 'launch image schema or class drifted')
  for (const field of ['source_tree_sha256', 'toolchain_sha256', 'recipe_sha256', 'recipe_identity_sha256', 'probe_semantics_sha256', 'reviewed_artifact_set_sha256'] as const) assertSha256(value[field], 'launch_image_invalid', field)
  const record = deepFreeze(value as LaunchImageRecord)
  images.add(record)
  return verifyLaunchImage(record)
}

export function buildStaticAnchor(input: Readonly<{ c1: CrossRepoAuthority; platform_archive_sha256: string; source_tree_sha256: string; toolchain_sha256: string; images: Readonly<{ original: LaunchImageRecord; probe: LaunchImageRecord }>; receiver_source_sha256: string; receiver_executable_identity_sha256: string; receiver_schema_sha256: string; controller_source_sha256: string; controller_executable_sha256: string; schema_bundle_sha256: string; reviewed_artifact_set_sha256: string; target_profile?: TargetProfile }>): StaticAnchor {
  for (const field of ['platform_archive_sha256', 'source_tree_sha256', 'toolchain_sha256', 'receiver_source_sha256', 'receiver_executable_identity_sha256', 'receiver_schema_sha256', 'controller_source_sha256', 'controller_executable_sha256', 'schema_bundle_sha256', 'reviewed_artifact_set_sha256'] as const) assertSha256(input[field], 'static_anchor_invalid', field)
  const targetProfile: TargetProfile = input.target_profile ?? TARGET_PROFILE as TargetProfile
  if (input.platform_archive_sha256 !== targetProfile.platform_archive_sha256 || input.source_tree_sha256 !== targetProfile.platform_tree_sha256) throw new Phase3BProductionError('static_anchor_invalid', 'static anchor target profile drifted')
  const original = verifyLaunchImage(input.images.original)
  const probe = verifyLaunchImage(input.images.probe)
  if (original.source_identity.sha256 !== targetProfile.entrypoint_sha256 || original.source_identity.size !== targetProfile.entrypoint_size || original.source_tree_sha256 !== input.source_tree_sha256 || probe.source_tree_sha256 !== input.source_tree_sha256 || original.toolchain_sha256 !== input.toolchain_sha256 || probe.toolchain_sha256 !== input.toolchain_sha256 || original.reviewed_artifact_set_sha256 !== input.reviewed_artifact_set_sha256 || probe.reviewed_artifact_set_sha256 !== input.reviewed_artifact_set_sha256) throw new Phase3BProductionError('static_anchor_invalid', 'launch image target/source/tree/toolchain/review continuity drifted')
  const unsigned = {
    schema_id: 'oracle-lab-p3b-static-anchor.v1' as const,
    repositories: REPOSITORY_AUTHORITY,
    c1: input.c1,
    target_profile: targetProfile,
    platform_archive_sha256: input.platform_archive_sha256,
    source_tree_sha256: input.source_tree_sha256,
    toolchain_sha256: input.toolchain_sha256,
    original_image_record_sha256: original.record_sha256,
    probe_image_record_sha256: probe.record_sha256,
    receiver_source_sha256: input.receiver_source_sha256,
    receiver_executable_identity_sha256: input.receiver_executable_identity_sha256,
    receiver_schema_sha256: input.receiver_schema_sha256,
    request_target: CLAUDE_MESSAGES_REQUEST_CONTRACT,
    bootstrap_contract_schema: BOOTSTRAP_CONTRACT_SCHEMA,
    controller_source_sha256: input.controller_source_sha256,
    controller_executable_sha256: input.controller_executable_sha256,
    schema_bundle_sha256: input.schema_bundle_sha256,
    reviewed_artifact_set_sha256: input.reviewed_artifact_set_sha256,
  }
  const anchor = deepFreeze({ ...unsigned, anchor_sha256: sha256Canonical(unsigned) })
  anchors.add(anchor)
  return anchor
}

export function assertStaticAnchor(anchor: unknown): asserts anchor is StaticAnchor {
  if (!anchor || typeof anchor !== 'object' || !anchors.has(anchor as object)) throw new Phase3BProductionError('static_anchor_invalid', 'opaque static anchor is required')
  const value = anchor as StaticAnchor
  if (value.anchor_sha256 !== sha256Canonical(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'anchor_sha256')))) throw new Phase3BProductionError('static_anchor_invalid', 'static anchor digest drifted')
}

export function loadStaticAnchor(value: unknown): StaticAnchor {
  assertExactKeys(value, ['schema_id', 'repositories', 'c1', 'target_profile', 'platform_archive_sha256', 'source_tree_sha256', 'toolchain_sha256', 'original_image_record_sha256', 'probe_image_record_sha256', 'receiver_source_sha256', 'receiver_executable_identity_sha256', 'receiver_schema_sha256', 'request_target', 'bootstrap_contract_schema', 'controller_source_sha256', 'controller_executable_sha256', 'schema_bundle_sha256', 'reviewed_artifact_set_sha256', 'anchor_sha256'], 'static_anchor_invalid')
  assertDigestField(value, 'anchor_sha256', 'static_anchor_invalid')
  assertExactKeys(value.c1, ['verdict', 'review_sha256'], 'static_anchor_invalid')
  const targetProfile = value.target_profile as TargetProfile
  if (!targetProfile || typeof targetProfile !== 'object' || targetProfile.platform !== 'darwin' || targetProfile.architecture !== 'arm64' || !Number.isSafeInteger(targetProfile.entrypoint_size) || !Number.isSafeInteger(targetProfile.maximum_executable_bytes) || targetProfile.entrypoint_size <= 0 || targetProfile.maximum_executable_bytes < targetProfile.entrypoint_size || targetProfile.maximum_executable_bytes > TARGET_EXECUTABLE_MAXIMUM_BYTES) throw new Phase3BProductionError('static_anchor_invalid', 'static anchor target profile shape is invalid')
  for (const field of ['platform_archive_sha256', 'platform_tree_sha256', 'entrypoint_sha256'] as const) assertSha256(targetProfile[field], 'static_anchor_invalid', `target profile ${field}`)
  if (value.schema_id !== 'oracle-lab-p3b-static-anchor.v1' || sha256Canonical(value.repositories) !== sha256Canonical(REPOSITORY_AUTHORITY) || sha256Canonical(value.c1) !== sha256Canonical(crossRepoAuthority(String(value.c1.review_sha256))) || sha256Canonical(value.request_target) !== sha256Canonical(CLAUDE_MESSAGES_REQUEST_CONTRACT) || sha256Canonical(value.bootstrap_contract_schema) !== sha256Canonical(BOOTSTRAP_CONTRACT_SCHEMA) || value.platform_archive_sha256 !== targetProfile.platform_archive_sha256 || value.source_tree_sha256 !== targetProfile.platform_tree_sha256) throw new Phase3BProductionError('static_anchor_invalid', 'static anchor authority, request/bootstrap contract, or target profile drifted')
  for (const field of ['platform_archive_sha256', 'source_tree_sha256', 'toolchain_sha256', 'original_image_record_sha256', 'probe_image_record_sha256', 'receiver_source_sha256', 'receiver_executable_identity_sha256', 'receiver_schema_sha256', 'controller_source_sha256', 'controller_executable_sha256', 'schema_bundle_sha256', 'reviewed_artifact_set_sha256'] as const) assertSha256(value[field], 'static_anchor_invalid', field)
  const anchor = deepFreeze(value as StaticAnchor)
  anchors.add(anchor)
  assertStaticAnchor(anchor)
  return anchor
}
