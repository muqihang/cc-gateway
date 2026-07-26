import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync } from 'node:fs'
import path from 'node:path'

import { Phase3BProductionError, assertDigestField, assertExactKeys, assertSha256, deepFreeze, sha256Bytes, sha256Canonical } from './core.js'
import { REPOSITORY_AUTHORITY, TARGET_PROFILE, crossRepoAuthority, type CrossRepoAuthority } from './ledger.js'
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
  reviewed_artifact_set_sha256: string
  record_sha256: string
}>

export type StaticAnchor = Readonly<{
  schema_id: 'oracle-lab-p3b-static-anchor.v1'
  repositories: typeof REPOSITORY_AUTHORITY
  c1: CrossRepoAuthority
  target_profile: typeof TARGET_PROFILE
  platform_archive_sha256: string
  source_tree_sha256: string
  toolchain_sha256: string
  original_image_record_sha256: string
  probe_image_record_sha256: string
  receiver_source_sha256: string
  receiver_executable_identity_sha256: string
  receiver_schema_sha256: string
  controller_source_sha256: string
  controller_executable_sha256: string
  schema_bundle_sha256: string
  reviewed_artifact_set_sha256: string
  anchor_sha256: string
}>

type Recipe = Readonly<{
  schema_id: 'oracle-lab-p3b-launch-recipe.v1'
  kind: 'original' | 'probe'
  source_sha256: string
  source_tree_sha256: string
  toolchain_sha256: string
  semantics: readonly string[]
  build_command: readonly string[]
  build_command_sha256: string
  pre_sign_sha256: string
  post_sign_sha256: string
  code_signature_identity_sha256: string | null
  recipe_sha256: string
}>

const images = new WeakSet<object>()
const anchors = new WeakSet<object>()
export const TARGET_EXECUTABLE_MAXIMUM_BYTES = 67_108_864
const ORIGINAL_SEMANTICS = ['byte-identical-copy', 'no-observer-mutation'] as const
const PROBE_SEMANTICS = ['request-observation-only', 'response-observation-only', 'no-request-mutation', 'no-response-mutation', 'no-retry-mutation', 'no-config-mutation', 'no-auth-mutation'] as const

function readRecipe(file: string, expectedRecipeSha256: string, kind: Recipe['kind'], sourceSha256: string, preSignSha256: string, sourceTreeSha256: string, toolchainSha256: string): { recipe: Recipe; identity: StableFileIdentity } {
  const root = path.dirname(file)
  const relative = path.basename(file)
  const { value, identity } = readCanonical(root, relative, 32_768)
  if (identity.sha256 !== expectedRecipeSha256) throw new Phase3BProductionError('launch_recipe_invalid', 'recipe bytes differ from the trusted reviewed artifact set')
  assertExactKeys(value, ['schema_id', 'kind', 'source_sha256', 'source_tree_sha256', 'toolchain_sha256', 'semantics', 'build_command', 'build_command_sha256', 'pre_sign_sha256', 'post_sign_sha256', 'code_signature_identity_sha256', 'recipe_sha256'], 'launch_recipe_invalid')
  assertDigestField(value, 'recipe_sha256', 'launch_recipe_invalid')
  const expectedSemantics = kind === 'probe' ? PROBE_SEMANTICS : ORIGINAL_SEMANTICS
  if (value.schema_id !== 'oracle-lab-p3b-launch-recipe.v3' || value.kind !== kind || value.source_sha256 !== sourceSha256 || value.pre_sign_sha256 !== preSignSha256 || value.post_sign_sha256 !== sourceSha256 || value.source_tree_sha256 !== sourceTreeSha256 || value.toolchain_sha256 !== toolchainSha256 || sha256Canonical(value.semantics) !== sha256Canonical(expectedSemantics) || !Array.isArray(value.build_command) || value.build_command.length < 1 || value.build_command.length > 32 || value.build_command.some((argument) => typeof argument !== 'string' || argument.length === 0 || argument.length > 4096 || /[\u0000\r\n]/.test(argument)) || !String(value.build_command[0]).startsWith('/') || value.build_command_sha256 !== sha256Canonical(value.build_command)) throw new Phase3BProductionError('launch_recipe_invalid', 'recipe command/source/tree/toolchain/probe semantics drifted')
  if (kind === 'probe') assertSha256(value.code_signature_identity_sha256, 'launch_recipe_invalid', 'code signature identity')
  else if (value.code_signature_identity_sha256 !== null) throw new Phase3BProductionError('launch_recipe_invalid', 'original recipe must not claim a probe signature')
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
  const imageIdentity = stableRead(input.imagePath, { mode: 0o500, maximumBytes: 67_108_864 }).identity
  if (imageIdentity.sha256 !== input.sourceIdentity.sha256 || imageIdentity.size !== input.sourceIdentity.size) throw new Phase3BProductionError('launch_image_drift', 'campaign image is not byte-identical to sealed source')
  const signature = input.selectedClass === 'probe_image' ? codeSignatureIdentity(input.imagePath) : null
  if (signature !== input.recipe.code_signature_identity_sha256) throw new Phase3BProductionError('launch_image_signature_invalid', 'probe signature identity does not match recipe')
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
    reviewed_artifact_set_sha256: input.reviewedArtifactSetSha256,
  }
  const record = deepFreeze({ ...unsigned, record_sha256: sha256Canonical(unsigned) })
  images.add(record)
  return record
}

export function createSealedLaunchImages(input: Readonly<{ runtime_root: string; original_source: string; probe_source: string; probe_source_sha256: string; probe_unsigned_source: string; probe_unsigned_source_sha256: string; original_recipe: string; original_recipe_sha256: string; probe_recipe: string; probe_recipe_sha256: string; source_tree_sha256: string; toolchain_sha256: string; reviewed_artifact_set_sha256: string }>): Readonly<{ original: LaunchImageRecord; probe: LaunchImageRecord }> {
  assertSha256(input.source_tree_sha256, 'launch_image_input_invalid', 'source tree')
  assertSha256(input.toolchain_sha256, 'launch_image_input_invalid', 'toolchain')
  const originalSource = stableRead(input.original_source, { maximumBytes: 67_108_864 }).identity
  if (originalSource.sha256 !== TARGET_PROFILE.entrypoint_sha256 || input.source_tree_sha256 !== TARGET_PROFILE.platform_tree_sha256) throw new Phase3BProductionError('launch_image_invalid', 'original launch image is not exact Claude Code 2.1.215 darwin-arm64')
  const probeSource = stableRead(input.probe_source, { maximumBytes: 67_108_864 }).identity
  const probeUnsignedSource = stableRead(input.probe_unsigned_source, { maximumBytes: 67_108_864 }).identity
  if (probeSource.sha256 !== input.probe_source_sha256 || probeUnsignedSource.sha256 !== input.probe_unsigned_source_sha256) throw new Phase3BProductionError('launch_image_invalid', 'probe pre-sign or post-sign bytes drifted from trusted review')
  const originalRecipe = readRecipe(input.original_recipe, input.original_recipe_sha256, 'original', originalSource.sha256, originalSource.sha256, input.source_tree_sha256, input.toolchain_sha256)
  const probeRecipe = readRecipe(input.probe_recipe, input.probe_recipe_sha256, 'probe', probeSource.sha256, probeUnsignedSource.sha256, input.source_tree_sha256, input.toolchain_sha256)
  const imageRoot = createPrivateDirectory(input.runtime_root, 'launch-images')
  const originalPath = path.join(imageRoot, 'original-image')
  const probePath = path.join(imageRoot, 'probe-image')
  writeExclusiveBytes(input.runtime_root, 'launch-images/original-image', stableRead(input.original_source, { maximumBytes: 67_108_864 }).bytes, 0o500)
  writeExclusiveBytes(input.runtime_root, 'launch-images/probe-image', stableRead(input.probe_source, { maximumBytes: 67_108_864 }).bytes, 0o500)
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
  const current = stableRead(value.image_identity.path, { mode: 0o500, maximumBytes: 67_108_864 }).identity
  const source = stableRead(value.source_identity.path, { maximumBytes: 67_108_864 }).identity
  const recipe = stableRead(value.recipe_identity.path, { mode: 0o600, maximumBytes: 32_768 }).identity
  if (sha256Canonical(current) !== sha256Canonical(value.image_identity) || sha256Canonical(source) !== sha256Canonical(value.source_identity) || sha256Canonical(recipe) !== sha256Canonical(value.recipe_identity) || sha256Canonical(recipe) !== value.recipe_identity_sha256 || value.record_sha256 !== sha256Canonical(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'record_sha256')))) throw new Phase3BProductionError('launch_image_drift', 'launch image/source/recipe live identity drifted')
  if (value.selected_executable_class === 'probe_image' && codeSignatureIdentity(value.image_identity.path) !== value.code_signature_identity_sha256) throw new Phase3BProductionError('launch_image_signature_invalid', 'probe signature drifted')
  return value
}

export function loadLaunchImageRecord(value: unknown): LaunchImageRecord {
  assertExactKeys(value, ['schema_id', 'selected_executable_class', 'image_identity', 'source_identity', 'source_tree_sha256', 'toolchain_sha256', 'recipe_sha256', 'recipe_identity', 'recipe_identity_sha256', 'probe_semantics_sha256', 'code_signature_identity_sha256', 'reviewed_artifact_set_sha256', 'record_sha256'], 'launch_image_invalid')
  assertDigestField(value, 'record_sha256', 'launch_image_invalid')
  if (value.schema_id !== 'oracle-lab-p3b-launch-image.v1' || !['original_image', 'probe_image'].includes(String(value.selected_executable_class))) throw new Phase3BProductionError('launch_image_invalid', 'launch image schema or class drifted')
  for (const field of ['source_tree_sha256', 'toolchain_sha256', 'recipe_sha256', 'recipe_identity_sha256', 'probe_semantics_sha256', 'reviewed_artifact_set_sha256'] as const) assertSha256(value[field], 'launch_image_invalid', field)
  const record = deepFreeze(value as LaunchImageRecord)
  images.add(record)
  return verifyLaunchImage(record)
}

export function buildStaticAnchor(input: Readonly<{ c1: CrossRepoAuthority; platform_archive_sha256: string; source_tree_sha256: string; toolchain_sha256: string; images: Readonly<{ original: LaunchImageRecord; probe: LaunchImageRecord }>; receiver_source_sha256: string; receiver_executable_identity_sha256: string; receiver_schema_sha256: string; controller_source_sha256: string; controller_executable_sha256: string; schema_bundle_sha256: string; reviewed_artifact_set_sha256: string }>): StaticAnchor {
  for (const field of ['platform_archive_sha256', 'source_tree_sha256', 'toolchain_sha256', 'receiver_source_sha256', 'receiver_executable_identity_sha256', 'receiver_schema_sha256', 'controller_source_sha256', 'controller_executable_sha256', 'schema_bundle_sha256', 'reviewed_artifact_set_sha256'] as const) assertSha256(input[field], 'static_anchor_invalid', field)
  if (input.platform_archive_sha256 !== TARGET_PROFILE.platform_archive_sha256 || input.source_tree_sha256 !== TARGET_PROFILE.platform_tree_sha256) throw new Phase3BProductionError('static_anchor_invalid', 'static anchor target profile drifted')
  const original = verifyLaunchImage(input.images.original)
  const probe = verifyLaunchImage(input.images.probe)
  if (original.source_tree_sha256 !== input.source_tree_sha256 || probe.source_tree_sha256 !== input.source_tree_sha256 || original.toolchain_sha256 !== input.toolchain_sha256 || probe.toolchain_sha256 !== input.toolchain_sha256 || original.reviewed_artifact_set_sha256 !== input.reviewed_artifact_set_sha256 || probe.reviewed_artifact_set_sha256 !== input.reviewed_artifact_set_sha256) throw new Phase3BProductionError('static_anchor_invalid', 'launch image source/tree/toolchain/review continuity drifted')
  const unsigned = {
    schema_id: 'oracle-lab-p3b-static-anchor.v1' as const,
    repositories: REPOSITORY_AUTHORITY,
    c1: input.c1,
    target_profile: TARGET_PROFILE,
    platform_archive_sha256: input.platform_archive_sha256,
    source_tree_sha256: input.source_tree_sha256,
    toolchain_sha256: input.toolchain_sha256,
    original_image_record_sha256: original.record_sha256,
    probe_image_record_sha256: probe.record_sha256,
    receiver_source_sha256: input.receiver_source_sha256,
    receiver_executable_identity_sha256: input.receiver_executable_identity_sha256,
    receiver_schema_sha256: input.receiver_schema_sha256,
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
  assertExactKeys(value, ['schema_id', 'repositories', 'c1', 'target_profile', 'platform_archive_sha256', 'source_tree_sha256', 'toolchain_sha256', 'original_image_record_sha256', 'probe_image_record_sha256', 'receiver_source_sha256', 'receiver_executable_identity_sha256', 'receiver_schema_sha256', 'controller_source_sha256', 'controller_executable_sha256', 'schema_bundle_sha256', 'reviewed_artifact_set_sha256', 'anchor_sha256'], 'static_anchor_invalid')
  assertDigestField(value, 'anchor_sha256', 'static_anchor_invalid')
  assertExactKeys(value.c1, ['verdict', 'review_sha256'], 'static_anchor_invalid')
  if (value.schema_id !== 'oracle-lab-p3b-static-anchor.v1' || sha256Canonical(value.repositories) !== sha256Canonical(REPOSITORY_AUTHORITY) || sha256Canonical(value.c1) !== sha256Canonical(crossRepoAuthority(String(value.c1.review_sha256))) || sha256Canonical(value.target_profile) !== sha256Canonical(TARGET_PROFILE) || value.platform_archive_sha256 !== TARGET_PROFILE.platform_archive_sha256 || value.source_tree_sha256 !== TARGET_PROFILE.platform_tree_sha256) throw new Phase3BProductionError('static_anchor_invalid', 'static anchor authority or target profile drifted')
  for (const field of ['platform_archive_sha256', 'source_tree_sha256', 'toolchain_sha256', 'original_image_record_sha256', 'probe_image_record_sha256', 'receiver_source_sha256', 'receiver_executable_identity_sha256', 'receiver_schema_sha256', 'controller_source_sha256', 'controller_executable_sha256', 'schema_bundle_sha256', 'reviewed_artifact_set_sha256'] as const) assertSha256(value[field], 'static_anchor_invalid', field)
  const anchor = deepFreeze(value as StaticAnchor)
  anchors.add(anchor)
  assertStaticAnchor(anchor)
  return anchor
}
