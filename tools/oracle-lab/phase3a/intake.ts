import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import {
  assertEvidencePath,
  canonicalJson,
  ensureEvidenceRoot,
  Phase3AError,
  sha256Bytes,
  sha256File,
  stableError,
} from './core.js'
import { extractTarGzSafely, type ArchiveLimits, type SafeTarResult } from './safe-tar.js'

const ACTIVE_VERSION = '2.1.215'
const MAX_ARCHIVE_BYTES = 1_073_741_824
const ALLOWED_HOSTS = new Set([
  'registry.npmjs.org',
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
])

type NpmMetadata = {
  name: string
  version: string
  dist: { tarball: string; shasum: string; integrity: string }
}

type ReleaseAsset = { name: string; browser_download_url: string; size: number }
type ReleaseMetadata = { tag_name: string; html_url: string; assets: ReleaseAsset[] }

export type IntakeArtifact = {
  artifact_id: string
  kind: 'npm-wrapper' | 'npm-platform' | 'github-release' | 'release-shasums' | 'release-signature' | 'entrypoint'
  package: string
  version: string
  source_url: string
  archive_sha256?: string
  tree_sha256?: string
  entrypoint_sha256?: string
  bytes: number
  expanded_bytes?: number
  expansion_ratio?: number
  verification: Record<string, string | boolean | number | null>
  warnings?: string[]
}

function safeUrl(input: string): URL {
  const url = new URL(input)
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new Phase3AError('artifact_identity', `untrusted artifact URL: ${url.origin}`)
  }
  return url
}

function durableSourceUrl(input: string): string {
  const url = safeUrl(input)
  if (url.hostname === 'release-assets.githubusercontent.com') url.search = ''
  url.hash = ''
  return url.toString()
}

async function download(urlInput: string, destination: string, maximumBytes = MAX_ARCHIVE_BYTES): Promise<{ finalUrl: string; bytes: number }> {
  const url = safeUrl(urlInput)
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'cc-gateway-phase3a-evidence-factory' } })
  if (!response.ok || !response.body) throw new Phase3AError('artifact_identity', `download failed: HTTP ${response.status}`)
  safeUrl(response.url)
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > maximumBytes) throw new Phase3AError('disk_limit', 'artifact exceeds download cap')
  mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 })
  let bytes = 0
  const bounded = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength
      if (bytes > maximumBytes) throw new Phase3AError('disk_limit', 'artifact exceeds download cap')
      controller.enqueue(chunk)
    },
  })
  await pipeline(Readable.fromWeb(response.body.pipeThrough(bounded) as never), createWriteStream(destination, { flags: 'wx', mode: 0o600 }))
  return { finalUrl: response.url, bytes }
}

async function downloadOrReuseExecutionBytes(urlInput: string, destination: string, maximumBytes: number): Promise<{ finalUrl: string; bytes: number; reused: boolean }> {
  safeUrl(urlInput)
  if (!existsSync(destination)) return { ...(await download(urlInput, destination, maximumBytes)), reused: false }
  const bytes = statSync(destination).size
  if (bytes > maximumBytes) throw new Phase3AError('disk_limit', 'existing execution artifact exceeds byte cap')
  return { finalUrl: urlInput, bytes, reused: true }
}

function verifyNpmArchive(metadata: NpmMetadata, archive: string): Record<string, string | boolean> {
  const bytes = readFileSync(archive)
  const sha1 = createHash('sha1').update(bytes).digest('hex')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const [algorithm, expectedBase64] = metadata.dist.integrity.split('-', 2)
  if (algorithm !== 'sha512' || !expectedBase64) throw new Phase3AError('artifact_identity', 'npm integrity is not pinned sha512')
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  if (sha1 !== metadata.dist.shasum || sha512 !== expectedBase64) {
    throw new Phase3AError('integrity_mismatch', `npm digest mismatch for ${metadata.name}@${metadata.version}`)
  }
  return { sha1, sha256, sha512_base64: sha512, npm_integrity_match: true }
}

export function validateArchiveNames(names: string[]): void {
  const exact = new Set<string>()
  const folded = new Set<string>()
  for (const raw of names) {
    const name = raw.replace(/\/$/, '')
    if (!name) continue
    const normalized = path.posix.normalize(name)
    if (name.includes('\0') || path.posix.isAbsolute(name) || normalized === '..' || normalized.startsWith('../')) {
      throw new Phase3AError('archive_unsafe', `unsafe archive path: ${name}`)
    }
    if (exact.has(name)) throw new Phase3AError('archive_unsafe', `duplicate archive path: ${name}`)
    exact.add(name)
    const lower = name.toLocaleLowerCase('en-US')
    if (folded.has(lower)) throw new Phase3AError('archive_unsafe', `case-colliding archive path: ${name}`)
    folded.add(lower)
  }
}

const WRAPPER_LIMITS: ArchiveLimits = {
  archiveBytes: 1024 * 1024,
  totalRegularBytes: 16 * 1024 * 1024,
  entries: 8192,
  regularFiles: 4096,
  singleRegularBytes: 8 * 1024 * 1024,
  pathDepth: 32,
  pathBytes: 1024,
  expansionRatio: null,
}

const PINNED_LARGE_LIMITS: ArchiveLimits = {
  archiveBytes: MAX_ARCHIVE_BYTES,
  totalRegularBytes: MAX_ARCHIVE_BYTES,
  entries: 131_072,
  regularFiles: 65_536,
  singleRegularBytes: 768 * 1024 * 1024,
  pathDepth: 32,
  pathBytes: 1024,
  expansionRatio: null,
}

export const UNPINNED_LIMITS: ArchiveLimits = { ...PINNED_LARGE_LIMITS, expansionRatio: 4 }

function sameInventory(left: SafeTarResult, right: SafeTarResult): boolean {
  return canonicalJson(left.inventory) === canonicalJson(right.inventory)
}

async function npmArtifact(input: {
  evidenceRoot: string
  label: 'wrapper' | 'platform'
  packageName: string
  metadataUrl: string
}): Promise<IntakeArtifact> {
  const base = assertEvidencePath(input.evidenceRoot, path.join(input.evidenceRoot, 'intake', input.label, ACTIVE_VERSION))
  mkdirSync(base, { recursive: true, mode: 0o700 })
  const metadataPath = path.join(base, 'registry.json')
  const metadataDownload = await downloadOrReuseExecutionBytes(input.metadataUrl, metadataPath, 8 * 1024 * 1024)
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as NpmMetadata
  if (metadata.name !== input.packageName || metadata.version !== ACTIVE_VERSION) {
    throw new Phase3AError('version_drift', `registry metadata identity mismatch for ${input.packageName}`)
  }
  safeUrl(metadata.dist.tarball)
  const archive = path.join(base, 'archive.tgz')
  const archiveDownload = await downloadOrReuseExecutionBytes(metadata.dist.tarball, archive, input.label === 'wrapper' ? WRAPPER_LIMITS.archiveBytes : MAX_ARCHIVE_BYTES)
  const verification = verifyNpmArchive(metadata, archive)
  const limits = input.label === 'wrapper' ? WRAPPER_LIMITS : PINNED_LARGE_LIMITS
  const unpacked = await extractTarGzSafely(archive, path.join(base, input.label === 'wrapper' ? 'unpacked-a' : 'unpacked'), limits)
  let duplicate: SafeTarResult | undefined
  if (input.label === 'wrapper') {
    duplicate = await extractTarGzSafely(archive, path.join(base, 'unpacked-b'), limits)
    if (unpacked.tree_sha256 !== duplicate.tree_sha256 || !sameInventory(unpacked, duplicate)) {
      throw new Phase3AError('parser_disagreement', 'independent wrapper unpack inventories or tree digests disagree')
    }
  }
  const artifact: IntakeArtifact = {
    artifact_id: `claude-code-${ACTIVE_VERSION}-${input.label}`,
    kind: input.label === 'wrapper' ? 'npm-wrapper' : 'npm-platform',
    package: input.packageName,
    version: ACTIVE_VERSION,
    source_url: durableSourceUrl(archiveDownload.finalUrl),
    archive_sha256: String(verification.sha256),
    tree_sha256: unpacked.tree_sha256,
    bytes: archiveDownload.bytes,
    expanded_bytes: unpacked.regular_file_bytes,
    expansion_ratio: unpacked.expansion_ratio,
    verification: {
      ...verification,
      metadata_sha256: sha256File(metadataPath),
      metadata_final_url: durableSourceUrl(metadataDownload.finalUrl),
      metadata_reused_from_current_execution: metadataDownload.reused,
      archive_reused_from_current_execution: archiveDownload.reused,
      lifecycle_scripts_executed: false,
      tree_algorithm: unpacked.tree_algorithm,
      regular_file_count: unpacked.regular_file_count,
      independent_unpack_roots: duplicate ? 2 : 1,
      independent_inventory_match: duplicate ? true : null,
    },
    warnings: unpacked.warnings,
  }
  writeFileSync(path.join(base, 'artifact.json'), `${canonicalJson(artifact)}\n`, { flag: 'wx', mode: 0o600 })
  return artifact
}

function releaseAsset(release: ReleaseMetadata, predicate: (asset: ReleaseAsset) => boolean, label: string): ReleaseAsset {
  const matches = release.assets.filter(predicate)
  if (matches.length !== 1) throw new Phase3AError('artifact_identity', `expected one ${label} release asset, got ${matches.length}`)
  return matches[0]
}

async function githubRelease(evidenceRoot: string): Promise<{ artifacts: IntakeArtifact[]; binaryPath: string }> {
  const base = assertEvidencePath(evidenceRoot, path.join(evidenceRoot, 'intake', 'release', ACTIVE_VERSION))
  mkdirSync(base, { recursive: true, mode: 0o700 })
  const metadataPath = path.join(base, 'release.json')
  await downloadOrReuseExecutionBytes(`https://api.github.com/repos/anthropics/claude-code/releases/tags/v${ACTIVE_VERSION}`, metadataPath, 8 * 1024 * 1024)
  const release = JSON.parse(readFileSync(metadataPath, 'utf8')) as ReleaseMetadata
  if (release.tag_name !== `v${ACTIVE_VERSION}` || release.html_url !== `https://github.com/anthropics/claude-code/releases/tag/v${ACTIVE_VERSION}`) {
    throw new Phase3AError('version_drift', 'GitHub release identity mismatch')
  }
  const shasumsAsset = releaseAsset(release, (asset) => asset.name === 'SHASUMS256.txt', 'SHASUMS256.txt')
  const signatureAsset = releaseAsset(release, (asset) => /SHASUMS256\.txt\.(?:sig|asc)$/.test(asset.name), 'SHASUMS signature')
  const arm64Asset = releaseAsset(
    release,
    (asset) => /darwin.*arm64|arm64.*darwin/i.test(asset.name) && /\.(?:tgz|tar\.gz)$/.test(asset.name),
    'Darwin arm64 archive',
  )

  const shasumsPath = path.join(base, shasumsAsset.name)
  const signaturePath = path.join(base, signatureAsset.name)
  const archivePath = path.join(base, arm64Asset.name)
  await downloadOrReuseExecutionBytes(shasumsAsset.browser_download_url, shasumsPath, 4 * 1024 * 1024)
  await downloadOrReuseExecutionBytes(signatureAsset.browser_download_url, signaturePath, 4 * 1024 * 1024)
  const archiveDownload = await downloadOrReuseExecutionBytes(arm64Asset.browser_download_url, archivePath, MAX_ARCHIVE_BYTES)
  const shasums = readFileSync(shasumsPath, 'utf8')
  const expected = shasums.split(/\r?\n/).map((line) => line.trim().split(/\s+/, 2)).find((parts) => parts[1]?.replace(/^\*/, '') === arm64Asset.name)?.[0]
  const archiveSha256 = sha256File(archivePath)
  if (!expected || expected !== archiveSha256) throw new Phase3AError('integrity_mismatch', 'release archive does not match SHASUMS256.txt')
  const unpackedPath = path.join(base, 'unpacked')
  const unpacked = await extractTarGzSafely(archivePath, unpackedPath, PINNED_LARGE_LIMITS)
  const binary = unpacked.inventory.find((entry) => /(^|\/)claude$/.test(entry.path))
  if (!binary) throw new Phase3AError('artifact_identity', 'release archive has no unique Claude entrypoint')
  const binaryPath = path.join(unpackedPath, binary.path)
  const artifact: IntakeArtifact = {
    artifact_id: `claude-code-${ACTIVE_VERSION}-github-release-darwin-arm64`,
    kind: 'github-release',
    package: 'anthropics/claude-code-release',
    version: ACTIVE_VERSION,
    source_url: durableSourceUrl(archiveDownload.finalUrl),
    archive_sha256: archiveSha256,
    tree_sha256: unpacked.tree_sha256,
    entrypoint_sha256: sha256File(binaryPath),
    bytes: archiveDownload.bytes,
    expanded_bytes: unpacked.regular_file_bytes,
    expansion_ratio: unpacked.expansion_ratio,
    verification: {
      shasums_match: true,
      shasums_sha256: sha256File(shasumsPath),
      signature_sha256: sha256File(signaturePath),
      signature_verification: 'Unknown',
      release_metadata_sha256: sha256File(metadataPath),
      lifecycle_scripts_executed: false,
      tree_algorithm: unpacked.tree_algorithm,
      regular_file_count: unpacked.regular_file_count,
    },
    warnings: unpacked.warnings,
  }
  writeFileSync(path.join(base, 'artifact.json'), `${canonicalJson(artifact)}\n`, { flag: 'wx', mode: 0o600 })
  return { artifacts: [artifact], binaryPath }
}

export async function intakeActiveArtifact(evidenceRootInput: string): Promise<{ schema_version: string; artifacts: IntakeArtifact[] }> {
  const evidenceRoot = ensureEvidenceRoot(evidenceRootInput)
  const wrapper = await npmArtifact({
    evidenceRoot,
    label: 'wrapper',
    packageName: '@anthropic-ai/claude-code',
    metadataUrl: `https://registry.npmjs.org/@anthropic-ai%2fclaude-code/${ACTIVE_VERSION}`,
  })
  const platform = await npmArtifact({
    evidenceRoot,
    label: 'platform',
    packageName: '@anthropic-ai/claude-code-darwin-arm64',
    metadataUrl: `https://registry.npmjs.org/@anthropic-ai%2fclaude-code-darwin-arm64/${ACTIVE_VERSION}`,
  })
  const release = await githubRelease(evidenceRoot)
  const platformBinary = path.join(evidenceRoot, 'intake', 'platform', ACTIVE_VERSION, 'unpacked', 'package', 'claude')
  const platformEntrypointSha256 = sha256File(platformBinary)
  if (release.artifacts[0].entrypoint_sha256 !== platformEntrypointSha256) {
    throw new Phase3AError('artifact_identity', 'npm platform and GitHub release entrypoint bytes disagree')
  }
  platform.entrypoint_sha256 = platformEntrypointSha256
  const result = {
    schema_version: 'oracle-lab-phase3a-intake.v1',
    corrections: [{
      code: 'planning_tree_digest_non_reproducible',
      superseded_digest: '9cec9c9ad4edea1c4f64cf515033fcf3ecac347231e20f6e7f63f54b0ad87b04',
      disposition: 'superseded_non_reproducible',
      operator_decision: 'tiered_pinned_archive_limits_and_binary_tree_digest_v1',
    }],
    artifacts: [wrapper, platform, ...release.artifacts],
  }
  const indexPath = path.join(evidenceRoot, 'intake', 'artifact-index.json')
  writeFileSync(indexPath, `${canonicalJson(result)}\n`, { flag: 'wx', mode: 0o600 })
  return result
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function runCli(): Promise<void> {
  const evidenceRoot = argument('--evidence-root')
  const version = argument('--version')
  if (!evidenceRoot || version !== ACTIVE_VERSION || !process.argv.includes('--no-scripts')) {
    throw new Phase3AError('artifact_identity', `usage: intake.ts --version ${ACTIVE_VERSION} --no-scripts --evidence-root PATH`)
  }
  console.log(canonicalJson(await intakeActiveArtifact(evidenceRoot)))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runCli().catch((error) => {
    console.error(canonicalJson(stableError(error)))
    process.exitCode = 1
  })
}
