import { spawnSync } from 'node:child_process'
import {
  closeSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  writeSync,
} from 'node:fs'
import path from 'node:path'

import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File } from './core.js'

const PROBE_STATEMENT = `try{let f=require("fs"),c=require("crypto"),p=process.env.CLAUDE_CODE_TMPDIR+"/hook-events.jsonl",h=x=>c.createHash("sha256").update(x).digest("hex"),e=(kind,detail)=>f.appendFileSync(p,JSON.stringify({schema_version:"oracle-lab-phase3a-probe.v1",kind,detail})+"\\n"),o=globalThis.fetch;globalThis.fetch=async function(i,n){let d="request-object";try{d=new URL(i instanceof Request?i.url:String(i)).origin}catch{}e("fetch",{destination_sha256:h(d),body_class:n?.body?typeof n.body:"absent"});return o.call(this,i,n)};e("probe.ready",{runtime:"bun"})}catch{};`

export type ProbePatchOptions = {
  evidence_root: string
  source: string
  destination_relative: string
  expected_parent_sha256: string
  module_offset: number
  module_length: number
  expected_module_sha256: string
  patch_offset: number
  patch_length: number
  expected_before_sha256: string
  payload: Buffer
}

export type ProbePatchRecipe = {
  schema_version: 'oracle-lab-phase3a-probe-patch.v1'
  method: 'probe-copy'
  parent_sha256: string
  parent_size: number
  copied_size: number
  pre_sign_sha256: string
  module: { offset: number; length: number; before_sha256: string; after_sha256: string }
  patch: { offset: number; length: number; before_sha256: string; after_sha256: string; recipe_sha256: string }
}

export type ProbeSigningRecord = {
  schema_version: 'oracle-lab-phase3a-probe-signing.v1'
  method: 'adhoc-codesign'
  sign: { command: string[]; exit_code: number | null; signal: string | null; stdout_bytes: number; stdout_sha256: string; stderr_bytes: number; stderr_sha256: string }
  verify: { command: string[]; exit_code: number | null; signal: string | null; stdout_bytes: number; stdout_sha256: string; stderr_bytes: number; stderr_sha256: string }
  pre_sign_sha256: string
  post_sign_sha256: string
  post_sign_size: number
  size_delta_bytes: number
  module_after_sign_sha256: string
  status: 'PASS' | 'FAIL'
}

export function assessProbeSigning(input: {
  sign_exit_code: number | null
  verify_exit_code: number | null
  parent_size: number
  post_sign_size: number
  expected_module_sha256: string
  module_after_sign_sha256: string
}): { status: 'PASS' | 'FAIL'; size_delta_bytes: number } {
  return {
    status: input.sign_exit_code === 0 && input.verify_exit_code === 0
      && input.module_after_sign_sha256 === input.expected_module_sha256 ? 'PASS' : 'FAIL',
    size_delta_bytes: input.post_sign_size - input.parent_size,
  }
}

function fail(code: string, message: string): never { throw new Phase3AError(code, message) }

function boundedInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) fail('invalid_probe_range', `${name} must be a non-negative safe integer`)
  return value
}

function readRange(file: string, offset: number, length: number): Buffer {
  boundedInteger(offset, 'offset'); boundedInteger(length, 'length')
  const fd = openSync(file, 'r')
  const output = Buffer.alloc(length)
  let cursor = 0
  try {
    while (cursor < length) {
      const count = readSync(fd, output, cursor, length - cursor, offset + cursor)
      if (count === 0) fail('probe_range_short', 'artifact ended before the declared range')
      cursor += count
    }
  } finally { closeSync(fd) }
  return output
}

function assertPureLineCommentRegion(region: Buffer): void {
  const text = region.toString('ascii')
  if (!Buffer.from(text, 'ascii').equals(region) || !text.endsWith('\n')) fail('unsafe_probe_region', 'probe region must be newline-terminated ASCII')
  const lines = text.slice(0, -1).split('\n')
  if (lines.some((line) => line !== '' && !line.startsWith('//'))) fail('unsafe_probe_region', 'probe region contains executable bytes')
}

export function buildProbePayload(capacity: number): Buffer {
  boundedInteger(capacity, 'capacity')
  const statement = Buffer.from(PROBE_STATEMENT, 'ascii')
  const suffixBytes = 3
  if (statement.length + suffixBytes > capacity) fail('probe_payload_too_large', 'probe payload exceeds comment region')
  return Buffer.from(`${PROBE_STATEMENT}//${' '.repeat(capacity - statement.length - suffixBytes)}\n`, 'ascii')
}

export function patchProbeCopy(options: ProbePatchOptions): ProbePatchRecipe {
  const source = path.resolve(options.source)
  if (!path.isAbsolute(options.source) || !lstatSync(source).isFile() || lstatSync(source).isSymbolicLink()) fail('invalid_probe_source', 'probe source must be an absolute regular file')
  const parentSha256 = sha256File(source)
  if (parentSha256 !== options.expected_parent_sha256) fail('artifact_identity', 'probe parent digest differs from the declared artifact')
  const parentSize = statSync(source).size
  const moduleOffset = boundedInteger(options.module_offset, 'module offset')
  const moduleLength = boundedInteger(options.module_length, 'module length')
  const patchOffset = boundedInteger(options.patch_offset, 'patch offset')
  const patchLength = boundedInteger(options.patch_length, 'patch length')
  if (moduleOffset + moduleLength > parentSize || patchOffset < moduleOffset || patchOffset + patchLength > moduleOffset + moduleLength) fail('invalid_probe_range', 'patch range must be contained by the declared module')
  if (options.payload.length !== patchLength) fail('probe_length_mismatch', 'probe payload must exactly fill the comment region')

  const moduleBefore = readRange(source, moduleOffset, moduleLength)
  if (sha256Bytes(moduleBefore) !== options.expected_module_sha256) fail('artifact_identity', 'probe module digest differs from the declared module')
  const regionBefore = readRange(source, patchOffset, patchLength)
  if (sha256Bytes(regionBefore) !== options.expected_before_sha256) fail('artifact_identity', 'probe comment-region digest differs from the declared bytes')
  assertPureLineCommentRegion(regionBefore)

  const root = ensureEvidenceRoot(options.evidence_root)
  const destination = assertEvidencePath(root, path.join(root, options.destination_relative))
  if (existsSync(destination)) fail('evidence_exists', 'probe destination already exists')
  mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 })
  copyFileSync(source, destination, fsConstants.COPYFILE_EXCL)
  const fd = openSync(destination, 'r+')
  try {
    let cursor = 0
    while (cursor < options.payload.length) cursor += writeSync(fd, options.payload, cursor, options.payload.length - cursor, patchOffset + cursor)
    fsyncSync(fd)
  } finally { closeSync(fd) }

  const copiedSize = statSync(destination).size
  if (copiedSize !== parentSize) fail('probe_length_mismatch', 'patched copy changed artifact length')
  if (sha256File(source) !== parentSha256) fail('artifact_identity', 'probe parent changed during copy construction')
  const regionAfter = readRange(destination, patchOffset, patchLength)
  if (!regionAfter.equals(options.payload)) fail('probe_write_failed', 'patched bytes do not match the declared payload')
  const moduleAfter = readRange(destination, moduleOffset, moduleLength)
  const recipeCore = {
    parent_sha256: parentSha256,
    module_offset: moduleOffset,
    module_length: moduleLength,
    module_before_sha256: sha256Bytes(moduleBefore),
    patch_offset: patchOffset,
    patch_length: patchLength,
    patch_before_sha256: sha256Bytes(regionBefore),
    patch_after_sha256: sha256Bytes(regionAfter),
  }
  return {
    schema_version: 'oracle-lab-phase3a-probe-patch.v1', method: 'probe-copy', parent_sha256: parentSha256,
    parent_size: parentSize, copied_size: copiedSize, pre_sign_sha256: sha256File(destination),
    module: { offset: moduleOffset, length: moduleLength, before_sha256: sha256Bytes(moduleBefore), after_sha256: sha256Bytes(moduleAfter) },
    patch: { offset: patchOffset, length: patchLength, before_sha256: sha256Bytes(regionBefore), after_sha256: sha256Bytes(regionAfter), recipe_sha256: sha256Bytes(canonicalJson(recipeCore)) },
  }
}

function commandRecord(command: string[], result: ReturnType<typeof spawnSync>): Omit<ProbeSigningRecord['sign'], 'command'> {
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? '')
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr ?? '')
  return {
    exit_code: result.status, signal: result.signal,
    stdout_bytes: stdout.length, stdout_sha256: sha256Bytes(stdout), stderr_bytes: stderr.length, stderr_sha256: sha256Bytes(stderr),
  }
}

export function signProbeCopy(file: string, recipe: ProbePatchRecipe): ProbeSigningRecord {
  const absolute = path.resolve(file)
  if (sha256File(absolute) !== recipe.pre_sign_sha256) fail('artifact_identity', 'probe copy differs from pre-sign digest')
  const signCommand = ['/usr/bin/codesign', '--force', '--sign', '-', '--timestamp=none', absolute]
  const signResult = spawnSync(signCommand[0], signCommand.slice(1), { shell: false })
  const verifyCommand = ['/usr/bin/codesign', '--verify', '--verbose=2', absolute]
  const verifyResult = spawnSync(verifyCommand[0], verifyCommand.slice(1), { shell: false })
  const postSignSha256 = sha256File(absolute)
  const postSignSize = statSync(absolute).size
  const moduleAfterSignSha256 = sha256Bytes(readRange(absolute, recipe.module.offset, recipe.module.length))
  const assessment = assessProbeSigning({
    sign_exit_code: signResult.status, verify_exit_code: verifyResult.status,
    parent_size: recipe.parent_size, post_sign_size: postSignSize,
    expected_module_sha256: recipe.module.after_sha256, module_after_sign_sha256: moduleAfterSignSha256,
  })
  return {
    schema_version: 'oracle-lab-phase3a-probe-signing.v1', method: 'adhoc-codesign',
    sign: { command: signCommand, ...commandRecord(signCommand, signResult) },
    verify: { command: verifyCommand, ...commandRecord(verifyCommand, verifyResult) },
    pre_sign_sha256: recipe.pre_sign_sha256, post_sign_sha256: postSignSha256, post_sign_size: postSignSize,
    size_delta_bytes: assessment.size_delta_bytes, module_after_sign_sha256: moduleAfterSignSha256, status: assessment.status,
  }
}
