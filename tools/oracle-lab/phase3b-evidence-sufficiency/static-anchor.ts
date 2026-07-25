import { createHash } from 'node:crypto'
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
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

function fail(code: string, message: string): never {
  throw new EvidenceSufficiencyError(code, message)
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

export function receiverExecutableDigest(): string {
  return sha256File(fileURLToPath(new URL('./wire-receiver.ts', import.meta.url)))
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
