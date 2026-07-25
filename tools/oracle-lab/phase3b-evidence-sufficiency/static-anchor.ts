import { createHash } from 'node:crypto'
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  readdirSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { sha256File } from '../phase3a/core.js'
import {
  buildProbePayload,
  patchProbeCopy,
  signProbeCopy,
  type ProbePatchRecipe,
  type ProbeSigningRecord,
} from '../phase3a/probe-copy.js'
import {
  EvidenceSufficiencyError,
  canonicalEvidenceBytes,
  sha256Bytes,
  writeExclusiveEvidence,
} from './core.js'
import { parseEvidenceJson, validateEvidenceArtifact, type EvidenceSchemaFile } from './schemas.js'

export type RegularFileIdentity = { sha256: string; size: number; mode: number }
export type ProbeCommentRegion = { offset: number; length: number; sha256: string }

export type ProbeCopyBinding = {
  status: 'PASS' | 'FAIL'
  destination_relative: string
  parent_sha256: string
  patch_recipe_sha256: string
  pre_sign_sha256: string
  post_sign_sha256: string
  post_sign_size: number
  module_offset: number
  module_length: number
  module_before_sha256: string
  module_after_sign_sha256: string
  patch_offset: number
  patch_length: number
  patch_before_sha256: string
  patch_after_sha256: string
  signing_record_sha256: string
}

export type ReceiverExecutableIdentity = {
  schema_id: 'oracle-lab-p3b-es-receiver-executable-identity.v1'
  algorithm: 'receiver-node-tsx-tuple-jcs-sha256-v1'
  source_sha256: string
  launcher_sha256: string
  loader_sha256: string
  digest: string
}

type EvidenceFileFingerprint = {
  absolute_path: string
  relative_path: string
  dev: number
  ino: number
  size: number
  mode: number
  mtime_ms: number
  ctime_ms: number
  sha256: string
}

type BoundEvidenceJson = EvidenceFileFingerprint & { value: Record<string, unknown> }

export type VerifiedActiveStaticAnchor = {
  campaign_id: string
  active_static_anchor_sha256: string
  selection_sha256: string
  anchor_relative_path: string
  receiver_identity: ReceiverExecutableIdentity
  file_bindings: readonly EvidenceFileFingerprint[]
}

const AUTHORITY_RELATIVE = 'capsules/P3B-ES1/control/operator-authority.json'
const FREEZE_RELATIVE = 'capsules/P3B-ES1/control/freeze.json'
const CAMPAIGN_INPUT_RELATIVE = 'capsules/P3B-ES1/control/campaign-input.json'
export const STATIC_ANCHOR_SELECTION_RELATIVE = 'capsules/P3B-ES1/control/static-anchor-selection.json'
const MAX_AUTHORITY_FILE_BYTES = 1024 * 1024

function fail(code: string, message: string): never {
  throw new EvidenceSufficiencyError(code, message)
}

function object(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('schema_invalid', `${label} must be an object`)
  return value as Record<string, any>
}

function equalCanonical(left: unknown, right: unknown): boolean {
  return canonicalEvidenceBytes(left).equals(canonicalEvidenceBytes(right))
}

function assertSafeRelativePath(relative: string): void {
  if (typeof relative !== 'string' || relative.length < 1 || relative.length > 512
    || relative.includes('\\') || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative)
    || path.posix.normalize(relative) !== relative || relative.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    fail('source_binding_invalid', 'evidence path must be normalized, relative, and traversal-free')
  }
}

function resolveEvidenceRoot(rootInput: string): string {
  try {
    const absolute = path.resolve(rootInput)
    const inputStat = lstatSync(absolute)
    if (!inputStat.isDirectory() || inputStat.isSymbolicLink() || (inputStat.mode & 0o777) !== 0o700) {
      fail('source_binding_invalid', 'evidence root must be a non-symlink 0700 directory')
    }
    const root = realpathSync(absolute)
    return root
  } catch (error) {
    if (error instanceof EvidenceSufficiencyError) throw error
    fail('source_binding_invalid', 'evidence root is missing or unreadable')
  }
}

function resolveContainedEvidencePath(root: string, relative: string): string {
  assertSafeRelativePath(relative)
  const absolute = path.resolve(root, ...relative.split('/'))
  const fromRoot = path.relative(root, absolute)
  if (fromRoot === '' || fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
    fail('source_binding_invalid', 'evidence path escapes the evidence root')
  }
  let cursor = root
  for (const segment of relative.split('/').slice(0, -1)) {
    cursor = path.join(cursor, segment)
    try {
      const stat = lstatSync(cursor)
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) {
        fail('source_binding_invalid', 'evidence path must remain beneath non-symlink 0700 directories')
      }
    } catch (error) {
      if (error instanceof EvidenceSufficiencyError) throw error
      fail('source_binding_invalid', 'evidence parent directory is missing or unreadable')
    }
  }
  return absolute
}

function fingerprintMatches(file: string, expected: EvidenceFileFingerprint): boolean {
  try {
    const stat = lstatSync(file)
    return stat.isFile() && !stat.isSymbolicLink() && stat.dev === expected.dev && stat.ino === expected.ino
      && stat.size === expected.size && (stat.mode & 0o777) === expected.mode && stat.nlink === 1
      && stat.mtimeMs === expected.mtime_ms && stat.ctimeMs === expected.ctime_ms
  } catch { return false }
}

function readBoundedCanonicalEvidenceJson(root: string, relative: string): BoundEvidenceJson {
  const absolute = resolveContainedEvidencePath(root, relative)
  let descriptor: number | undefined
  let bytes: Buffer | undefined
  try {
    descriptor = openSync(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
    const before = fstatSync(descriptor)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || (before.mode & 0o777) !== 0o600
      || before.size < 1 || before.size > MAX_AUTHORITY_FILE_BYTES) {
      fail('source_binding_invalid', 'authority input must be a single-link 0600 bounded regular file')
    }
    bytes = Buffer.alloc(before.size)
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset)
      if (count === 0) fail('source_binding_invalid', 'authority input ended during bounded read')
      offset += count
    }
    const after = fstatSync(descriptor)
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.nlink !== 1
      || (after.mode & 0o777) !== 0o600) fail('source_binding_invalid', 'authority input changed during bounded read')
    const fingerprint: EvidenceFileFingerprint = {
      absolute_path: absolute, relative_path: relative, dev: after.dev, ino: after.ino, size: after.size,
      mode: after.mode & 0o777, mtime_ms: after.mtimeMs, ctime_ms: after.ctimeMs, sha256: sha256Bytes(bytes),
    }
    if (!fingerprintMatches(absolute, fingerprint)) fail('source_binding_invalid', 'authority input path changed during bounded read')
    const value = object(parseEvidenceJson(bytes), relative)
    if (!canonicalEvidenceBytes(value).equals(bytes)) fail('json_noncanonical', `${relative} is not canonical JSON`)
    return { ...fingerprint, value }
  } catch (error) {
    if (error instanceof EvidenceSufficiencyError) throw error
    if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
      && !/^E[A-Z0-9]+$/.test((error as { code: string }).code)) throw error
    fail('source_binding_invalid', `${relative} is missing, unsafe, or unreadable`)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    bytes?.fill(0)
  }
}

function requireSchema(file: EvidenceSchemaFile, artifact: BoundEvidenceJson): void {
  const decision = validateEvidenceArtifact(file, artifact.value)
  if (!decision.allowed) fail(decision.code, `${artifact.relative_path} does not satisfy ${file}`)
}

function u32(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) fail('schema_bundle_invalid', 'bundle member is too large')
  const output = Buffer.alloc(4)
  output.writeUInt32BE(value)
  return output
}

function readRange(file: string, offset: number, length: number): Buffer {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1) fail('artifact_identity', 'range is invalid')
  const descriptor = openSync(file, 'r')
  const output = Buffer.alloc(length)
  try {
    let cursor = 0
    while (cursor < length) {
      const count = readSync(descriptor, output, cursor, length - cursor, offset + cursor)
      if (count === 0) fail('artifact_identity', 'artifact ended before declared range')
      cursor += count
    }
  } finally { closeSync(descriptor) }
  return output
}

export function verifyRegularFileIdentity(fileInput: string, expectedSha256?: string): RegularFileIdentity {
  const file = path.resolve(fileInput)
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) fail('artifact_identity', 'artifact must be a non-symlink regular file')
  const sha256 = sha256File(file)
  if (expectedSha256 && sha256 !== expectedSha256) fail('artifact_identity', 'artifact digest differs from frozen identity')
  return { sha256, size: stat.size, mode: stat.mode & 0o777 }
}

export function computeSchemaBundleDigest(rootInput: string): { algorithm: 'lp-u32be-name-bytes-v1'; sha256: string; file_count: number; files: string[] } {
  const root = path.resolve(rootInput)
  const rootStat = lstatSync(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('schema_bundle_invalid', 'schema bundle root must be a real directory')
  const files = readdirSync(root)
    .filter((name) => name.endsWith('.schema.json') || name === 'mutation-corpus.json' || name === 'expected-results.json')
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
  const hash = createHash('sha256')
  hash.update(Buffer.concat([u32(Buffer.byteLength('p3b-es-schema-bundle-v1')), Buffer.from('p3b-es-schema-bundle-v1'), u32(files.length)]))
  for (const name of files) {
    const file = path.join(root, name)
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink()) fail('schema_bundle_invalid', `schema bundle member ${name} is unsafe`)
    const nameBytes = Buffer.from(name)
    const bytes = readFileSync(file)
    hash.update(u32(nameBytes.length)); hash.update(nameBytes); hash.update(u32(bytes.length)); hash.update(bytes)
  }
  return { algorithm: 'lp-u32be-name-bytes-v1', sha256: hash.digest('hex'), file_count: files.length, files }
}

export function discoverProbeCommentRegion(
  fileInput: string,
  moduleOffset: number,
  moduleLength: number,
  minimumCapacity: number,
): ProbeCommentRegion {
  if (!Number.isSafeInteger(minimumCapacity) || minimumCapacity < 1) fail('invalid_probe_range', 'minimum probe capacity is invalid')
  verifyRegularFileIdentity(fileInput)
  const module = readRange(path.resolve(fileInput), moduleOffset, moduleLength)
  let best: { start: number; end: number } | null = null
  let runStart: number | null = null
  let cursor = 0
  while (cursor < module.length) {
    const newline = module.indexOf(0x0a, cursor)
    if (newline < 0) break
    const lineLength = newline - cursor
    const pureComment = lineLength === 0 || (lineLength >= 2 && module[cursor] === 0x2f && module[cursor + 1] === 0x2f)
    if (pureComment) {
      if (runStart === null) runStart = cursor
      const runLength = newline + 1 - runStart
      if (runLength >= minimumCapacity && (!best || runLength < best.end - best.start)) best = { start: runStart, end: newline + 1 }
    } else runStart = null
    cursor = newline + 1
  }
  if (!best) {
    module.fill(0)
    fail('probe_region_missing', 'no bounded pure line-comment region can hold the probe payload')
  }
  const region = Buffer.from(module.subarray(best.start, best.end))
  module.fill(0)
  const result = { offset: moduleOffset + best.start, length: region.length, sha256: sha256Bytes(region) }
  region.fill(0)
  return result
}

export function prepareBoundProbeCopy(input: {
  evidence_root: string
  entrypoint: string
  expected_entrypoint_sha256: string
  module_offset: number
  module_length: number
  expected_module_sha256: string
  destination_relative?: string
}): ProbeCopyBinding {
  const parent = verifyRegularFileIdentity(input.entrypoint, input.expected_entrypoint_sha256)
  const module = readRange(input.entrypoint, input.module_offset, input.module_length)
  const moduleSha256 = sha256Bytes(module)
  module.fill(0)
  if (moduleSha256 !== input.expected_module_sha256) fail('artifact_identity', 'entry module digest differs from frozen binding')
  const minimumCapacity = 1024
  const region = discoverProbeCommentRegion(input.entrypoint, input.module_offset, input.module_length, minimumCapacity)
  const destinationRelative = input.destination_relative ?? 'capsules/P3B-ES1/control/probe/claude-probe-copy'
  const recipe: ProbePatchRecipe = patchProbeCopy({
    evidence_root: input.evidence_root,
    source: path.resolve(input.entrypoint),
    destination_relative: destinationRelative,
    expected_parent_sha256: parent.sha256,
    module_offset: input.module_offset,
    module_length: input.module_length,
    expected_module_sha256: input.expected_module_sha256,
    patch_offset: region.offset,
    patch_length: region.length,
    expected_before_sha256: region.sha256,
    payload: buildProbePayload(region.length),
  })
  const destination = path.join(path.resolve(input.evidence_root), ...destinationRelative.split('/'))
  const signing: ProbeSigningRecord = signProbeCopy(destination, recipe)
  const binding: ProbeCopyBinding = {
    status: signing.status,
    destination_relative: destinationRelative,
    parent_sha256: recipe.parent_sha256,
    patch_recipe_sha256: recipe.patch.recipe_sha256,
    pre_sign_sha256: recipe.pre_sign_sha256,
    post_sign_sha256: signing.post_sign_sha256,
    post_sign_size: signing.post_sign_size,
    module_offset: recipe.module.offset,
    module_length: recipe.module.length,
    module_before_sha256: recipe.module.before_sha256,
    module_after_sign_sha256: signing.module_after_sign_sha256,
    patch_offset: recipe.patch.offset,
    patch_length: recipe.patch.length,
    patch_before_sha256: recipe.patch.before_sha256,
    patch_after_sha256: recipe.patch.after_sha256,
    signing_record_sha256: sha256Bytes(canonicalEvidenceBytes(signing)),
  }
  if (binding.status !== 'PASS') fail('probe_signing_failed', 'probe-copy signing or module identity failed')
  return binding
}

export function receiverRuntimeFiles(): { source_file: string; launcher_file: string; loader_file: string } {
  return {
    source_file: fileURLToPath(new URL('./wire-receiver.ts', import.meta.url)),
    launcher_file: process.execPath,
    loader_file: fileURLToPath(import.meta.resolve('tsx')),
  }
}

export function receiverExecutableIdentityFromFiles(files: { source_file: string; launcher_file: string; loader_file: string }): ReceiverExecutableIdentity {
  const tuple = {
    schema_id: 'oracle-lab-p3b-es-receiver-executable-identity.v1' as const,
    algorithm: 'receiver-node-tsx-tuple-jcs-sha256-v1' as const,
    source_sha256: verifyRegularFileIdentity(files.source_file).sha256,
    launcher_sha256: verifyRegularFileIdentity(files.launcher_file).sha256,
    loader_sha256: verifyRegularFileIdentity(files.loader_file).sha256,
  }
  return { ...tuple, digest: sha256Bytes(canonicalEvidenceBytes(tuple)) }
}

export function receiverExecutableIdentity(): ReceiverExecutableIdentity {
  return receiverExecutableIdentityFromFiles(receiverRuntimeFiles())
}

export function assertReceiverExecutableIdentity(expected: ReceiverExecutableIdentity, files = receiverRuntimeFiles()): void {
  if (!equalCanonical(receiverExecutableIdentityFromFiles(files), expected)) {
    fail('paired_perturbation', 'receiver runtime artifact differs from verified executable tuple')
  }
}

export function receiverExecutableDigest(): string {
  return receiverExecutableIdentity().digest
}

function expectedRootIdentity(root: string): Record<string, unknown> {
  return {
    leaf_name: path.basename(root),
    realpath_sha256: sha256Bytes(root),
    required_initial_state: 'new_empty_before_authority',
  }
}

function assertAuthorityBindings(input: {
  root: string
  expected_campaign_id: string
  identity: ReceiverExecutableIdentity
  authority: BoundEvidenceJson
  freeze: BoundEvidenceJson
  campaign: BoundEvidenceJson
  selection: BoundEvidenceJson
  anchor: BoundEvidenceJson
}): void {
  const authority = object(input.authority.value, 'operator authority')
  const freeze = object(input.freeze.value, 'freeze')
  const campaign = object(input.campaign.value, 'campaign input')
  const selection = object(input.selection.value, 'static anchor selection')
  const anchor = object(input.anchor.value, 'static anchor')
  const rootIdentity = expectedRootIdentity(input.root)

  if (![authority.campaign_id, freeze.campaign_id, campaign.campaign_id, selection.campaign_id, anchor.campaign_id]
    .every((value) => value === input.expected_campaign_id)) fail('paired_perturbation', 'campaign binding differs across active anchor authority')
  if (![authority.evidence_root_identity, freeze.evidence_root_identity, campaign.evidence_root_identity, selection.evidence_root_identity]
    .every((value) => equalCanonical(value, rootIdentity))) fail('paired_perturbation', 'active selection is not bound to the current evidence namespace')

  if (freeze.authority.relative_path !== AUTHORITY_RELATIVE || freeze.authority.sha256 !== input.authority.sha256 || freeze.authority.size_bytes !== input.authority.size
    || campaign.authority.relative_path !== AUTHORITY_RELATIVE || campaign.authority.sha256 !== input.authority.sha256
    || campaign.freeze.relative_path !== FREEZE_RELATIVE || campaign.freeze.sha256 !== input.freeze.sha256
    || selection.authority.relative_path !== AUTHORITY_RELATIVE || selection.authority.sha256 !== input.authority.sha256
    || selection.freeze.relative_path !== FREEZE_RELATIVE || selection.freeze.sha256 !== input.freeze.sha256
    || selection.campaign_input.relative_path !== CAMPAIGN_INPUT_RELATIVE || selection.campaign_input.sha256 !== input.campaign.sha256) {
    fail('paired_perturbation', 'authority, freeze, campaign input, or selection digest binding disagrees')
  }

  const activeAuthority = { selection_relative_path: STATIC_ANCHOR_SELECTION_RELATIVE, receiver_identity: input.identity }
  if (![authority.active_static_anchor, freeze.active_static_anchor, campaign.active_static_anchor]
    .every((value) => equalCanonical(value, activeAuthority)) || !equalCanonical(selection.receiver_identity, input.identity)) {
    fail('paired_perturbation', 'receiver runtime tuple is not independently bound by current authority')
  }

  if (!equalCanonical(authority.plan, freeze.plan) || campaign.plan_sha256 !== authority.plan.sha256 || anchor.plan_sha256 !== authority.plan.sha256) {
    fail('paired_perturbation', 'plan binding differs across active anchor authority')
  }
  for (const repository of ['cc_gateway', 'sub2api'] as const) {
    const authorityRepository = authority.repositories[repository]
    const frozenRepository = freeze.repositories[repository]
    const anchorRepository = anchor.repositories[repository]
    if (authorityRepository.branch !== frozenRepository.branch || authorityRepository.commit !== frozenRepository.commit
      || authorityRepository.tree !== frozenRepository.tree || anchorRepository.commit !== frozenRepository.commit
      || anchorRepository.tree !== frozenRepository.tree) fail('paired_perturbation', `${repository} binding differs across selected anchor`)
  }

  const frozenArtifact = freeze.artifact
  const target = campaign.target
  const anchoredArtifact = anchor.artifact
  for (const [frozenKey, targetKey] of [
    ['architecture', 'architecture'], ['archive_sha256', 'archive_sha256'], ['artifact_record_sha256', 'artifact_record_sha256'],
    ['entrypoint_sha256', 'entrypoint_sha256'], ['package', 'package'], ['platform', 'platform'], ['tree_sha256', 'tree_sha256'], ['version', 'version'],
  ] as const) if (frozenArtifact[frozenKey] !== target[targetKey]) fail('paired_perturbation', 'campaign target differs from frozen artifact')
  for (const [anchorKey, frozenKey] of [
    ['architecture', 'architecture'], ['platform_archive_sha256', 'archive_sha256'], ['entrypoint_sha256', 'entrypoint_sha256'],
    ['package', 'package'], ['platform', 'platform'], ['platform_tree_sha256', 'tree_sha256'], ['version', 'version'],
  ] as const) if (anchoredArtifact[anchorKey] !== frozenArtifact[frozenKey]) fail('paired_perturbation', 'selected anchor artifact differs from current freeze')

  const schemaRoot = fileURLToPath(new URL('../../../contracts/oracle-lab/evidence-sufficiency/v1/', import.meta.url))
  const schemaBundle = computeSchemaBundleDigest(schemaRoot)
  if (!equalCanonical(anchor.schema_bundle, schemaBundle) || anchor.schema_bundle_sha256 !== schemaBundle.sha256) {
    fail('paired_perturbation', 'selected anchor schema bundle differs from current contract bytes')
  }
  const frozenToolchains = freeze.toolchains
  const expectedToolchains = {
    node_version: frozenToolchains.cc_gateway.node,
    npm_version: frozenToolchains.cc_gateway.npm,
    go_version: frozenToolchains.sub2api.go,
    gotooolchain: frozenToolchains.sub2api.gotoolchain,
    files: [
      { repository: 'cc_gateway', path: 'package.json', sha256: frozenToolchains.cc_gateway.package_json_sha256 },
      { repository: 'cc_gateway', path: 'package-lock.json', sha256: frozenToolchains.cc_gateway.package_lock_sha256 },
      { repository: 'cc_gateway', path: 'tsconfig.json', sha256: frozenToolchains.cc_gateway.tsconfig_sha256 },
      { repository: 'sub2api', path: 'backend/go.mod', sha256: frozenToolchains.sub2api.go_mod_sha256 },
      { repository: 'sub2api', path: 'backend/go.sum', sha256: frozenToolchains.sub2api.go_sum_sha256 },
    ],
  }
  if (!equalCanonical(anchor.toolchains, expectedToolchains)) fail('paired_perturbation', 'selected anchor toolchains differ from current freeze')
  if (anchor.invocation_descriptor_sha256 !== input.campaign.sha256) fail('paired_perturbation', 'selected anchor does not bind the exact campaign input bytes')
  if (anchor.receiver_executable_sha256 !== input.identity.digest) fail('paired_perturbation', 'selected anchor receiver executable differs from current runtime tuple')
}

export function assertActiveStaticAnchorAuthorityStable(binding: VerifiedActiveStaticAnchor): void {
  if (!binding.file_bindings.every((file) => fingerprintMatches(file.absolute_path, file))) {
    fail('source_binding_invalid', 'active anchor authority file changed after validation')
  }
  assertReceiverExecutableIdentity(binding.receiver_identity)
}

export function resolveActiveStaticAnchorAuthority(input: {
  evidence_root: string
  expected_campaign_id: string
  expected_active_static_anchor_sha256: string
}): VerifiedActiveStaticAnchor {
  const root = resolveEvidenceRoot(input.evidence_root)
  const authority = readBoundedCanonicalEvidenceJson(root, AUTHORITY_RELATIVE)
  const freeze = readBoundedCanonicalEvidenceJson(root, FREEZE_RELATIVE)
  const campaign = readBoundedCanonicalEvidenceJson(root, CAMPAIGN_INPUT_RELATIVE)
  const selection = readBoundedCanonicalEvidenceJson(root, STATIC_ANCHOR_SELECTION_RELATIVE)
  requireSchema('operator-authority.schema.json', authority)
  requireSchema('freeze.schema.json', freeze)
  requireSchema('campaign-input.schema.json', campaign)
  requireSchema('static-anchor-selection.schema.json', selection)

  const selectionValue = object(selection.value, 'static anchor selection')
  const active = object(selectionValue.active_anchor, 'active anchor selection')
  if (!/^capsules\/P3B-ES1\/control\/static-anchor(?:-[A-Za-z0-9._-]+)?\.json$/.test(active.relative_path)) {
    fail('source_binding_invalid', 'selection active anchor path is outside the closed static-anchor namespace')
  }
  const superseded = selectionValue.superseded_anchors as Array<Record<string, unknown>>
  const supersededKeys = superseded.map((entry) => canonicalEvidenceBytes(entry).toString('utf8'))
  if (supersededKeys.some((key, index) => index > 0 && key <= supersededKeys[index - 1])) fail('schema_invalid', 'superseded anchors must be unique canonical-order path/digest entries')
  if (superseded.some((entry) => entry.relative_path === active.relative_path || entry.sha256 === active.sha256)) {
    fail('paired_perturbation', 'selected active anchor is superseded')
  }

  const anchor = readBoundedCanonicalEvidenceJson(root, active.relative_path)
  requireSchema('static-anchor.schema.json', anchor)
  if (anchor.sha256 !== active.sha256) fail('paired_perturbation', 'selected anchor file digest differs from selection')
  const identity = receiverExecutableIdentity()
  assertAuthorityBindings({ root, expected_campaign_id: input.expected_campaign_id, identity, authority, freeze, campaign, selection, anchor })
  if (!/^[a-f0-9]{64}$/.test(input.expected_active_static_anchor_sha256)
    || input.expected_active_static_anchor_sha256 !== anchor.sha256) {
    fail('paired_perturbation', 'caller expected anchor digest differs from independently selected anchor')
  }
  const binding: VerifiedActiveStaticAnchor = {
    campaign_id: input.expected_campaign_id,
    active_static_anchor_sha256: anchor.sha256,
    selection_sha256: selection.sha256,
    anchor_relative_path: active.relative_path,
    receiver_identity: identity,
    file_bindings: [authority, freeze, campaign, selection, anchor].map(({ value: _value, ...file }) => file),
  }
  assertActiveStaticAnchorAuthorityStable(binding)
  return binding
}

export function buildStaticAnchorRecord(input: {
  campaign_id: string
  plan_sha256: string
  artifact: {
    package: '@anthropic-ai/claude-code-darwin-arm64'
    version: '2.1.215'
    platform: 'darwin'
    architecture: 'arm64'
    platform_archive_sha256: string
    platform_tree_sha256: string
    entrypoint: string
    entrypoint_sha256: string
    entry_module_offset: number
    entry_module_length: number
    entry_module_sha256: string
  }
  repositories: Record<'cc_gateway' | 'sub2api', { commit: string; tree: string }>
  toolchains: Record<string, unknown>
  invocation_descriptor: Record<string, unknown>
  schema_root: string
  probe_copy: ProbeCopyBinding
}): Record<string, unknown> {
  const entrypoint = verifyRegularFileIdentity(input.artifact.entrypoint, input.artifact.entrypoint_sha256)
  const module = readRange(input.artifact.entrypoint, input.artifact.entry_module_offset, input.artifact.entry_module_length)
  const moduleSha256 = sha256Bytes(module)
  module.fill(0)
  if (moduleSha256 !== input.artifact.entry_module_sha256) fail('artifact_identity', 'entry module digest differs from static anchor')
  const schemaBundle = computeSchemaBundleDigest(input.schema_root)
  return {
    schema_id: 'oracle-lab-p3b-es-static-anchor.v1',
    schema_major: 1,
    schema_revision: 0,
    campaign_id: input.campaign_id,
    plan_sha256: input.plan_sha256,
    artifact: {
      package: input.artifact.package,
      version: input.artifact.version,
      platform: input.artifact.platform,
      architecture: input.artifact.architecture,
      platform_archive_sha256: input.artifact.platform_archive_sha256,
      platform_tree_sha256: input.artifact.platform_tree_sha256,
      entrypoint_sha256: entrypoint.sha256,
      entrypoint_size: entrypoint.size,
      entrypoint_mode: entrypoint.mode,
      entry_module_offset: input.artifact.entry_module_offset,
      entry_module_length: input.artifact.entry_module_length,
      entry_module_sha256: moduleSha256,
    },
    repositories: input.repositories,
    toolchains: input.toolchains,
    schema_bundle: schemaBundle,
    schema_bundle_sha256: schemaBundle.sha256,
    invocation_descriptor_sha256: sha256Bytes(canonicalEvidenceBytes(input.invocation_descriptor)),
    receiver_executable_sha256: receiverExecutableDigest(),
    probe_copy: input.probe_copy,
    static_evidence_level: 'Observed-local',
    raw_material_persisted: false,
  }
}

export function writeStaticAnchor(evidenceRoot: string, record: Record<string, unknown>): { relative_path: string; sha256: string; size: number } {
  return writeExclusiveEvidence(evidenceRoot, 'capsules/P3B-ES1/control/static-anchor.json', record, 'controller')
}
