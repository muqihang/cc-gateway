import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { buildCrossPlatformStaticCorroboration, scanStaticArtifact, type PlatformStaticArtifact, type StaticPlatform } from '../tools/oracle-lab/phase3a/cross-platform-static-corroboration.js'
import { canonicalJson, sha256Bytes } from '../tools/oracle-lab/phase3a/core.js'

console.log('\ntests/oracle-phase3a-cross-platform-static-corroboration.test.ts')

const root = mkdtempSync(path.join(tmpdir(), 'phase3a-cross-platform-static-'))
const rawOnlyMarker = 'DO_NOT_PERSIST_CROSS_PLATFORM_VENDOR_MARKER'
const sharedMarkers = [
  'compact cache spawn child_process config settings socket tls ANTHROPIC_BASE_URL CLAUDE_CODE_TEST fetch https keychain credential HOME XDG_ authorization model session nonce state transition telemetry diagnostic setTimeout random ipc named pipe baseURL /v1/ websocket quic',
  rawOnlyMarker,
].join(' ')

function fixture(platform: StaticPlatform): Buffer {
  const prefix = Buffer.alloc(256)
  if (platform === 'darwin-arm64') {
    prefix.writeUInt32LE(0xfeedfacf, 0)
    prefix.writeUInt32LE(0x0100000c, 4)
  } else if (platform === 'linux-x64') {
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(prefix, 0)
    prefix.writeUInt16LE(0x3e, 18)
  } else {
    prefix.write('MZ', 0, 'ascii')
    prefix.writeUInt32LE(128, 0x3c)
    prefix.write('PE\0\0', 128, 'ascii')
    prefix.writeUInt16LE(0x8664, 132)
  }
  return Buffer.concat([prefix, Buffer.from(sharedMarkers, 'utf8')])
}

function platformArtifact(platform: StaticPlatform): PlatformStaticArtifact {
  const file = path.join(root, `${platform}.bin`)
  const bytes = fixture(platform)
  writeFileSync(file, bytes, { flag: 'wx' })
  const digest = sha256Bytes(bytes)
  const scan = scanStaticArtifact(file, digest)
  const packageName = `@anthropic-ai/claude-code-${platform}`
  const base = {
    platform,
    package_name: packageName,
    version: '2.1.215' as const,
    official_registry_url: `https://registry.npmjs.org/${encodeURIComponent(packageName)}/2.1.215`,
    registry_metadata_sha256: 'a'.repeat(64),
    archive_sha256: 'b'.repeat(64),
    npm_shasum_sha1: 'c'.repeat(40),
    npm_integrity_sha512: 'd'.repeat(88),
    npm_integrity_verified: true as const,
    tree_sha256: 'e'.repeat(64),
    entrypoint_sha256: digest,
    entrypoint_bytes: scan.entrypoint_bytes,
    lifecycle_scripts_executed: false as const,
    structural: scan.structural,
    source_sink: scan.source_sink,
  }
  return { ...base, static_fingerprint: sha256Bytes(canonicalJson(base)) }
}

const artifacts = ['darwin-arm64', 'linux-x64', 'win32-x64'].map((platform) => platformArtifact(platform as StaticPlatform))
const report = buildCrossPlatformStaticCorroboration(artifacts)
const repeat = buildCrossPlatformStaticCorroboration([...artifacts].reverse())
assert.equal(report.capability_conclusion.result, 'static-corroborated')
assert.equal(report.capability_conclusion.runtime_capability, 'Unknown')
assert.equal(report.capability_conclusion.dynamic_worker_executed, false)
assert.equal(report.structural_corroboration.status, 'corroborated')
assert.deepEqual(report.structural_corroboration.formats, ['elf', 'mach-o', 'pe'])
assert.equal(report.source_sink_corroboration.length, 17)
assert.equal(report.source_sink_corroboration.find((row) => row.category === 'env-read')?.status, 'corroborated')
assert.equal(report.source_sink_corroboration.find((row) => row.category === 'fetch-http')?.status, 'corroborated')
assert.equal(report.deterministic_digest, repeat.deterministic_digest)
assert.ok(!canonicalJson(report).includes(rawOnlyMarker))
assert.ok(!canonicalJson(report).includes('ANTHROPIC_BASE_URL'))

const altered = structuredClone(artifacts)
altered[1].source_sink[0].match_count = 0
altered[1].static_fingerprint = sha256Bytes(canonicalJson(Object.fromEntries(Object.entries(altered[1]).filter(([key]) => key !== 'static_fingerprint'))))
const partial = buildCrossPlatformStaticCorroboration(altered)
assert.equal(partial.source_sink_corroboration[0].status, 'not-corroborated')

assert.throws(() => scanStaticArtifact(path.join(root, 'darwin-arm64.bin'), '0'.repeat(64)), /entrypoint digest/i)
assert.throws(() => buildCrossPlatformStaticCorroboration(artifacts.slice(0, 1)), /at least two/i)
assert.throws(() => buildCrossPlatformStaticCorroboration([{ ...artifacts[0], entrypoint_bytes: 1 }, artifacts[1]]), /fingerprint/i)

console.log(JSON.stringify({ ok: true, cases: 13 }))
