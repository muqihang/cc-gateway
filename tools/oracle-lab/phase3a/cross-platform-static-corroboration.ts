import { createHash, randomUUID } from 'node:crypto'
import { closeSync, createWriteStream, existsSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'
import { extractTarGzSafely, type ArchiveLimits } from './safe-tar.js'

const VERSION = '2.1.215'
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024
const SCAN_CHUNK_BYTES = 1024 * 1024
const SCAN_CARRY_BYTES = 128

export const STATIC_PLATFORMS = ['darwin-arm64', 'linux-x64', 'win32-x64'] as const
export type StaticPlatform = typeof STATIC_PLATFORMS[number]

type PlatformSpec = {
  platform: StaticPlatform
  package_name: string
  os: 'darwin' | 'linux' | 'win32'
  cpu: 'arm64' | 'x64'
  format: 'mach-o' | 'elf' | 'pe'
  entrypoint_names: string[]
}

const PLATFORM_SPECS: Record<StaticPlatform, PlatformSpec> = {
  'darwin-arm64': { platform: 'darwin-arm64', package_name: '@anthropic-ai/claude-code-darwin-arm64', os: 'darwin', cpu: 'arm64', format: 'mach-o', entrypoint_names: ['claude'] },
  'linux-x64': { platform: 'linux-x64', package_name: '@anthropic-ai/claude-code-linux-x64', os: 'linux', cpu: 'x64', format: 'elf', entrypoint_names: ['claude'] },
  'win32-x64': { platform: 'win32-x64', package_name: '@anthropic-ai/claude-code-win32-x64', os: 'win32', cpu: 'x64', format: 'pe', entrypoint_names: ['claude.exe', 'claude'] },
}

type CategoryKind = 'source' | 'sink' | 'state'
type CategoryRule = { category: string; kind: CategoryKind; markers: string[] }

// Marker values remain in code only; generated evidence persists counts and hashes, never strings.
const CATEGORY_RULES: CategoryRule[] = [
  { category: 'cache-compact', kind: 'state', markers: ['compact', 'cache'] },
  { category: 'child-process', kind: 'sink', markers: ['spawn', 'child_process'] },
  { category: 'config-read', kind: 'source', markers: ['config', 'settings'] },
  { category: 'daemon-lifecycle', kind: 'state', markers: ['daemon', 'restart'] },
  { category: 'dns-socket-tls', kind: 'sink', markers: ['socket', 'tls'] },
  { category: 'env-read', kind: 'source', markers: ['ANTHROPIC_', 'CLAUDE_CODE_'] },
  { category: 'fetch-http', kind: 'sink', markers: ['fetch', 'https'] },
  { category: 'filesystem-keychain-helper', kind: 'source', markers: ['keychain', 'credential'] },
  { category: 'platform-locale', kind: 'source', markers: ['HOME', 'XDG_'] },
  { category: 'request-header-model-auth', kind: 'sink', markers: ['authorization', 'model'] },
  { category: 'session-identity', kind: 'source', markers: ['session', 'nonce'] },
  { category: 'state-edge', kind: 'state', markers: ['state', 'transition'] },
  { category: 'telemetry-diagnostic-update-error', kind: 'sink', markers: ['telemetry', 'diagnostic'] },
  { category: 'timer-random', kind: 'source', markers: ['setTimeout', 'random'] },
  { category: 'unix-ipc', kind: 'sink', markers: ['ipc', 'named pipe'] },
  { category: 'url-host-path', kind: 'sink', markers: ['baseURL', '/v1/'] },
  { category: 'websocket-quic-udp', kind: 'sink', markers: ['websocket', 'quic'] },
]

const ARCHIVE_LIMITS: ArchiveLimits = {
  archiveBytes: MAX_ARCHIVE_BYTES,
  totalRegularBytes: MAX_ARCHIVE_BYTES,
  entries: 131_072,
  regularFiles: 65_536,
  singleRegularBytes: 768 * 1024 * 1024,
  pathDepth: 32,
  pathBytes: 1024,
  expansionRatio: null,
}

type NpmMetadata = {
  name: string
  version: string
  os?: string[]
  cpu?: string[]
  dist: { tarball: string; shasum: string; integrity: string }
}

export type SourceSinkCategory = {
  category: string
  kind: CategoryKind
  match_count: number
  occurrence_sha256: string
}

export type PlatformStaticArtifact = {
  platform: StaticPlatform
  package_name: string
  version: typeof VERSION
  official_registry_url: string
  registry_metadata_sha256: string
  archive_sha256: string
  npm_shasum_sha1: string
  npm_integrity_sha512: string
  npm_integrity_verified: true
  tree_sha256: string
  entrypoint_sha256: string
  entrypoint_bytes: number
  lifecycle_scripts_executed: false
  structural: {
    format: 'mach-o' | 'elf' | 'pe'
    architecture: 'arm64' | 'x64'
    header_sha256: string
  }
  source_sink: SourceSinkCategory[]
  static_fingerprint: string
}

export type CrossPlatformStaticCorroboration = {
  schema_version: 'oracle-lab-phase3a-cross-platform-static-corroboration.v1'
  scope: 'official-claude-code-2.1.215-static-only'
  verification_command_sha256: string
  artifact_count: number
  artifacts: PlatformStaticArtifact[]
  source_sink_corroboration: Array<{
    category: string
    kind: CategoryKind
    present_on: StaticPlatform[]
    missing_on: StaticPlatform[]
    status: 'corroborated' | 'not-corroborated'
    fingerprint_sha256: string
  }>
  structural_corroboration: {
    platforms: StaticPlatform[]
    formats: Array<'mach-o' | 'elf' | 'pe'>
    distinct_entrypoint_sha256_count: number
    status: 'corroborated'
  }
  capability_conclusion: {
    result: 'static-corroborated' | 'Unknown'
    statement: string
    runtime_capability: 'Unknown'
    dynamic_worker_executed: false
    phase3b_usable: false
    negative_capabilities: string[]
  }
  raw_vendor_source_persisted: false
  deterministic_digest: string
}

function fail(code: string, message: string): never { throw new Phase3AError(code, message) }

function isDigest(value: string): boolean { return /^[a-f0-9]{64}$/.test(value) }

function registryUrl(spec: PlatformSpec): string {
  return `https://registry.npmjs.org/${encodeURIComponent(spec.package_name)}/${VERSION}`
}

function assertRegistryUrl(input: string): URL {
  const url = new URL(input)
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.search || url.hash) fail('artifact_identity', 'official static intake requires a query-free npm registry URL')
  return url
}

function artifactPath(root: string, platform: StaticPlatform, name: string): string {
  return assertEvidencePath(root, path.join(root, 'intake', 'cross-platform-static', VERSION, platform, name))
}

function assertRegularFile(file: string): void {
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) fail('artifact_identity', 'static intake artifact must be a regular non-symlink file')
}

async function downloadOrReuse(urlInput: string, destination: string, maximumBytes: number): Promise<void> {
  assertRegistryUrl(urlInput)
  if (existsSync(destination)) {
    assertRegularFile(destination)
    if (lstatSync(destination).size > maximumBytes) fail('disk_limit', 'existing official artifact exceeds the byte limit')
    return
  }
  const response = await fetch(urlInput, { redirect: 'follow', headers: { 'user-agent': 'cc-gateway-phase3a-static-corroboration' } })
  if (!response.ok || !response.body) fail('artifact_identity', `official artifact download failed: HTTP ${response.status}`)
  assertRegistryUrl(response.url)
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > maximumBytes) fail('disk_limit', 'official artifact exceeds the byte limit')
  mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 })
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`
  let bytes = 0
  const bounded = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength
      if (bytes > maximumBytes) throw new Phase3AError('disk_limit', 'official artifact exceeds the byte limit')
      controller.enqueue(chunk)
    },
  })
  try {
    await pipeline(Readable.fromWeb(response.body.pipeThrough(bounded) as never), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
    linkSync(temporary, destination)
    unlinkSync(temporary)
  } catch (error) {
    try { unlinkSync(temporary) } catch { /* Invocation-local temporary artifact cleanup. */ }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('artifact_exists', 'official static intake output already exists')
    throw error
  }
}

function archiveDigests(file: string): { sha1: string; sha256: string; sha512_base64: string } {
  assertRegularFile(file)
  const fd = openSync(file, 'r')
  const sha1 = createHash('sha1')
  const sha256 = createHash('sha256')
  const sha512 = createHash('sha512')
  const buffer = Buffer.allocUnsafe(SCAN_CHUNK_BYTES)
  try {
    const before = fstatSync(fd)
    let offset = 0
    while (true) {
      const count = readSync(fd, buffer, 0, buffer.length, offset)
      if (count === 0) break
      const chunk = buffer.subarray(0, count)
      sha1.update(chunk); sha256.update(chunk); sha512.update(chunk)
      offset += count
    }
    const after = fstatSync(fd)
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail('artifact_identity', 'official archive changed while hashing')
  } finally {
    buffer.fill(0)
    closeSync(fd)
  }
  return { sha1: sha1.digest('hex'), sha256: sha256.digest('hex'), sha512_base64: sha512.digest('base64') }
}

function header(file: string, expectedSha256: string): PlatformStaticArtifact['structural'] {
  assertRegularFile(file)
  if (sha256File(file) !== expectedSha256) fail('artifact_hash_mismatch', 'entrypoint digest differs from its verified intake record')
  const fd = openSync(file, 'r')
  const bytes = Buffer.alloc(4096)
  let count = 0
  try { count = readSync(fd, bytes, 0, bytes.length, 0) } finally { closeSync(fd) }
  const prefix = bytes.subarray(0, count)
  const headerSha256 = sha256Bytes(prefix)
  if (prefix.length >= 8 && prefix.subarray(0, 4).toString('hex') === 'cffaedfe') return { format: 'mach-o', architecture: prefix.readUInt32LE(4) === 0x0100000c ? 'arm64' : fail('static_platform_mismatch', 'Mach-O static artifact does not declare arm64')!, header_sha256: headerSha256 }
  if (prefix.length >= 20 && prefix.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    if (prefix[5] !== 1) fail('static_platform_mismatch', 'ELF static artifact is not little endian')
    const machine = prefix.readUInt16LE(18)
    return { format: 'elf', architecture: machine === 0x3e ? 'x64' : machine === 0xb7 ? 'arm64' : fail('static_platform_mismatch', 'ELF static artifact has an unsupported architecture')!, header_sha256: headerSha256 }
  }
  if (prefix.length >= 64 && prefix.subarray(0, 2).toString('ascii') === 'MZ') {
    const peOffset = prefix.readUInt32LE(0x3c)
    if (peOffset + 6 > prefix.length || prefix.subarray(peOffset, peOffset + 4).toString('ascii') !== 'PE\0\0') fail('static_platform_mismatch', 'PE static artifact header is invalid')
    if (prefix.readUInt16LE(peOffset + 4) !== 0x8664) fail('static_platform_mismatch', 'PE static artifact does not declare x64')
    return { format: 'pe', architecture: 'x64', header_sha256: headerSha256 }
  }
  fail('static_platform_mismatch', 'official static artifact format is unsupported')
}

export function scanStaticArtifact(file: string, expectedSha256: string): { entrypoint_bytes: number; structural: PlatformStaticArtifact['structural']; source_sink: SourceSinkCategory[] } {
  const structural = header(file, expectedSha256)
  const hashes = CATEGORY_RULES.map(() => createHash('sha256'))
  const counts = CATEGORY_RULES.map(() => 0)
  const patterns = CATEGORY_RULES.map((rule) => rule.markers.map((marker) => Buffer.from(marker, 'utf8')))
  const fd = openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(SCAN_CHUNK_BYTES)
  let carry = Buffer.alloc(0)
  let offset = 0
  try {
    const before = fstatSync(fd)
    while (true) {
      const count = readSync(fd, buffer, 0, buffer.length, offset)
      if (count === 0) break
      const current = buffer.subarray(0, count)
      const joined = carry.length === 0 ? Buffer.from(current) : Buffer.concat([carry, current])
      for (let categoryIndex = 0; categoryIndex < patterns.length; categoryIndex += 1) {
        for (let markerIndex = 0; markerIndex < patterns[categoryIndex].length; markerIndex += 1) {
          const marker = patterns[categoryIndex][markerIndex]
          let cursor = 0
          while (cursor <= joined.length - marker.length) {
            const found = joined.indexOf(marker, cursor)
            if (found < 0) break
            if (found + marker.length > carry.length) {
              counts[categoryIndex] += 1
              hashes[categoryIndex].update(`${offset - carry.length + found}:${markerIndex};`)
            }
            cursor = found + Math.max(1, marker.length)
          }
        }
      }
      carry = Buffer.from(joined.subarray(Math.max(0, joined.length - SCAN_CARRY_BYTES)))
      joined.fill(0)
      offset += count
    }
    const after = fstatSync(fd)
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail('artifact_identity', 'entrypoint changed while statically scanned')
  } finally {
    buffer.fill(0); carry.fill(0); closeSync(fd)
  }
  return {
    entrypoint_bytes: offset,
    structural,
    source_sink: CATEGORY_RULES.map((rule, index) => ({ category: rule.category, kind: rule.kind, match_count: counts[index], occurrence_sha256: hashes[index].digest('hex') })),
  }
}

async function intakePlatform(root: string, platform: StaticPlatform): Promise<PlatformStaticArtifact> {
  const spec = PLATFORM_SPECS[platform]
  const metadataFile = artifactPath(root, platform, 'registry.json')
  await downloadOrReuse(registryUrl(spec), metadataFile, 8 * 1024 * 1024)
  const metadata = JSON.parse(Buffer.from(await (async () => {
    const fd = openSync(metadataFile, 'r'); const size = fstatSync(fd).size; const bytes = Buffer.alloc(size)
    try { readSync(fd, bytes, 0, bytes.length, 0); return bytes } finally { closeSync(fd) }
  })()).toString('utf8')) as NpmMetadata
  if (metadata.name !== spec.package_name || metadata.version !== VERSION || metadata.os?.length !== 1 || metadata.os[0] !== spec.os || metadata.cpu?.length !== 1 || metadata.cpu[0] !== spec.cpu) fail('artifact_identity', 'npm metadata platform identity does not match the requested static lane')
  const tarballUrl = assertRegistryUrl(metadata.dist.tarball).toString()
  const archive = artifactPath(root, platform, 'archive.tgz')
  await downloadOrReuse(tarballUrl, archive, MAX_ARCHIVE_BYTES)
  const digests = archiveDigests(archive)
  const [algorithm, expectedSha512] = metadata.dist.integrity.split('-', 2)
  if (algorithm !== 'sha512' || !expectedSha512 || digests.sha1 !== metadata.dist.shasum || digests.sha512_base64 !== expectedSha512) fail('integrity_mismatch', 'official npm archive integrity does not match registry metadata')
  const unpackedRoot = artifactPath(root, platform, 'unpacked')
  const unpacked = await extractTarGzSafely(archive, unpackedRoot, ARCHIVE_LIMITS)
  const entrypoint = spec.entrypoint_names.map((name) => path.join(unpackedRoot, 'package', name)).find((candidate) => existsSync(candidate))
  if (!entrypoint) fail('artifact_identity', 'official platform archive has no expected entrypoint')
  assertRegularFile(entrypoint)
  const entrypointSha256 = sha256File(entrypoint)
  const scanned = scanStaticArtifact(entrypoint, entrypointSha256)
  if (scanned.structural.format !== spec.format || scanned.structural.architecture !== spec.cpu) fail('static_platform_mismatch', 'official artifact header conflicts with the requested platform lane')
  const base = {
    platform,
    package_name: spec.package_name,
    version: VERSION,
    official_registry_url: registryUrl(spec),
    registry_metadata_sha256: sha256File(metadataFile),
    archive_sha256: digests.sha256,
    npm_shasum_sha1: digests.sha1,
    npm_integrity_sha512: digests.sha512_base64,
    npm_integrity_verified: true as const,
    tree_sha256: unpacked.tree_sha256,
    entrypoint_sha256: entrypointSha256,
    entrypoint_bytes: scanned.entrypoint_bytes,
    lifecycle_scripts_executed: false as const,
    structural: scanned.structural,
    source_sink: scanned.source_sink,
  }
  return { ...base, static_fingerprint: sha256Bytes(canonicalJson(base)) }
}

function assertArtifact(artifact: PlatformStaticArtifact): void {
  const spec = PLATFORM_SPECS[artifact.platform]
  if (!spec || artifact.package_name !== spec.package_name || artifact.version !== VERSION || artifact.official_registry_url !== registryUrl(spec)) fail('artifact_identity', 'cross-platform artifact has an unexpected official identity')
  for (const digest of [artifact.registry_metadata_sha256, artifact.archive_sha256, artifact.tree_sha256, artifact.entrypoint_sha256, artifact.structural.header_sha256, artifact.static_fingerprint]) if (!isDigest(digest)) fail('artifact_identity', 'cross-platform artifact has an invalid SHA-256 binding')
  const { static_fingerprint, ...fingerprintInput } = artifact
  if (sha256Bytes(canonicalJson(fingerprintInput)) !== static_fingerprint) fail('artifact_hash_mismatch', 'cross-platform static fingerprint does not reproduce')
  if (!/^[a-f0-9]{40}$/.test(artifact.npm_shasum_sha1) || artifact.npm_integrity_sha512.length < 64 || !artifact.npm_integrity_verified || artifact.lifecycle_scripts_executed) fail('artifact_identity', 'cross-platform artifact provenance is incomplete')
  if (artifact.structural.format !== spec.format || artifact.structural.architecture !== spec.cpu || artifact.entrypoint_bytes <= 0) fail('static_platform_mismatch', 'cross-platform artifact header does not match its platform')
  if (artifact.source_sink.length !== CATEGORY_RULES.length || artifact.source_sink.some((entry, index) => entry.category !== CATEGORY_RULES[index].category || entry.kind !== CATEGORY_RULES[index].kind || entry.match_count < 0 || !isDigest(entry.occurrence_sha256))) fail('static_scan_invalid', 'cross-platform source/sink scan is incomplete')
}

export function buildCrossPlatformStaticCorroboration(inputArtifacts: PlatformStaticArtifact[]): CrossPlatformStaticCorroboration {
  const artifacts = [...inputArtifacts].sort((left, right) => left.platform.localeCompare(right.platform))
  if (artifacts.length < 2 || new Set(artifacts.map((artifact) => artifact.platform)).size !== artifacts.length) fail('static_platform_incomplete', 'cross-platform corroboration requires at least two distinct platform artifacts')
  artifacts.forEach(assertArtifact)
  const platforms = artifacts.map((artifact) => artifact.platform)
  const sourceSink = CATEGORY_RULES.map((rule) => {
    const presentOn = artifacts.filter((artifact) => artifact.source_sink.find((entry) => entry.category === rule.category)!.match_count > 0).map((artifact) => artifact.platform)
    const missingOn = platforms.filter((platform) => !presentOn.includes(platform))
    const fingerprint = sha256Bytes(canonicalJson({ category: rule.category, artifacts: artifacts.map((artifact) => {
      const entry = artifact.source_sink.find((candidate) => candidate.category === rule.category)!
      return { platform: artifact.platform, match_count: entry.match_count, occurrence_sha256: entry.occurrence_sha256 }
    }) }))
    return { category: rule.category, kind: rule.kind, present_on: presentOn, missing_on: missingOn, status: missingOn.length === 0 ? 'corroborated' as const : 'not-corroborated' as const, fingerprint_sha256: fingerprint }
  })
  const corroboratedSource = sourceSink.some((entry) => entry.kind === 'source' && entry.status === 'corroborated')
  const corroboratedSink = sourceSink.some((entry) => entry.kind === 'sink' && entry.status === 'corroborated')
  const result = corroboratedSource && corroboratedSink ? 'static-corroborated' as const : 'Unknown' as const
  const base: Omit<CrossPlatformStaticCorroboration, 'deterministic_digest'> = {
    schema_version: 'oracle-lab-phase3a-cross-platform-static-corroboration.v1',
    scope: 'official-claude-code-2.1.215-static-only',
    verification_command_sha256: sha256Bytes(canonicalJson({ operation: 'phase3a-cross-platform-static-corroboration', version: 1, platforms })),
    artifact_count: artifacts.length,
    artifacts,
    source_sink_corroboration: sourceSink,
    structural_corroboration: {
      platforms,
      formats: [...new Set(artifacts.map((artifact) => artifact.structural.format))].sort() as Array<'mach-o' | 'elf' | 'pe'>,
      distinct_entrypoint_sha256_count: new Set(artifacts.map((artifact) => artifact.entrypoint_sha256)).size,
      status: 'corroborated',
    },
    capability_conclusion: {
      result,
      statement: result === 'static-corroborated'
        ? 'Official platform artifacts corroborate static source/sink category presence and native structural bindings only; runtime reachability and transport behavior remain Unknown.'
        : 'Official platform artifacts did not corroborate a source and sink category across every static lane; runtime reachability and transport behavior remain Unknown.',
      runtime_capability: 'Unknown',
      dynamic_worker_executed: false,
      phase3b_usable: false,
      negative_capabilities: ['no-dynamic-worker', 'no-runtime-reachability-claim', 'no-transport-behavior-claim', 'no-profile-promotion'],
    },
    raw_vendor_source_persisted: false,
  }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

type CliArguments = { evidence_root: string; out: string; platforms: StaticPlatform[] }

function parseCliArguments(argv: string[]): CliArguments {
  const values = argv[0] === '--' ? argv.slice(1) : argv
  let evidenceRoot: string | undefined
  let out: string | undefined
  const platforms: StaticPlatform[] = []
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index]; const value = values[index + 1]
    if (!name?.startsWith('--') || !value || value.startsWith('--')) fail('invalid_arguments', 'arguments must be --name value pairs')
    if (name === '--evidence-root') { if (evidenceRoot) fail('invalid_arguments', 'duplicate --evidence-root'); evidenceRoot = value }
    else if (name === '--out') { if (out) fail('invalid_arguments', 'duplicate --out'); out = value }
    else if (name === '--platform') {
      if (!(STATIC_PLATFORMS as readonly string[]).includes(value)) fail('invalid_arguments', `unsupported static platform: ${value}`)
      platforms.push(value as StaticPlatform)
    } else fail('invalid_arguments', `unknown argument: ${name}`)
  }
  if (!evidenceRoot || !out || platforms.length < 2 || new Set(platforms).size !== platforms.length) fail('invalid_arguments', 'cross-platform static corroboration requires one evidence root, one output, and at least two unique --platform values')
  return { evidence_root: evidenceRoot, out, platforms }
}

export async function runCrossPlatformStaticCorroboration(argumentsInput: CliArguments): Promise<{ out: string; sha256: string; result: CrossPlatformStaticCorroboration['capability_conclusion']['result'] }> {
  const root = ensureEvidenceRoot(argumentsInput.evidence_root)
  const out = assertEvidencePath(root, path.join(root, argumentsInput.out))
  if (existsSync(out)) fail('artifact_exists', 'cross-platform static corroboration output already exists')
  const artifacts: PlatformStaticArtifact[] = []
  for (const platform of argumentsInput.platforms) artifacts.push(await intakePlatform(root, platform))
  const result = buildCrossPlatformStaticCorroboration(artifacts)
  mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 })
  writeFileSync(out, `${canonicalJson(result)}\n`, { flag: 'wx', mode: 0o600 })
  return { out, sha256: sha256File(out), result: result.capability_conclusion.result }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const result = await runCrossPlatformStaticCorroboration(parseCliArguments(process.argv.slice(2)))
    process.stdout.write(`${canonicalJson(result)}\n`)
  } catch (error) {
    process.stderr.write(`${canonicalJson(stableError(error))}\n`)
    process.exitCode = 1
  }
}
