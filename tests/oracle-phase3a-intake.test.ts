import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { assertEvidencePath, canonicalJson, Phase3AError } from '../tools/oracle-lab/phase3a/core.js'
import { digestTree, digestTreeRecords } from '../tools/oracle-lab/phase3a/tree-digest.js'
import { UNPINNED_LIMITS, validateArchiveNames } from '../tools/oracle-lab/phase3a/intake.js'
import { extractTarGzSafely, type ArchiveLimits } from '../tools/oracle-lab/phase3a/safe-tar.js'

console.log('\ntests/oracle-phase3a-intake.test.ts')

function octal(header: Buffer, offset: number, length: number, value: number): void {
  header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii')
}

function rawTar(entries: Array<{ name: Buffer; type?: string; data?: Buffer }>): Buffer {
  const blocks: Buffer[] = []
  for (const item of entries) {
    const data = item.data ?? Buffer.alloc(0)
    const header = Buffer.alloc(512)
    item.name.copy(header, 0, 0, Math.min(item.name.length, 100))
    octal(header, 100, 8, 0o644); octal(header, 108, 8, 0); octal(header, 116, 8, 0)
    octal(header, 124, 12, data.length); octal(header, 136, 12, 0)
    header.fill(0x20, 148, 156)
    header.write(item.type ?? '0', 156, 1, 'ascii')
    header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii')
    let checksum = 0; for (const byte of header) checksum += byte
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

const root = mkdtempSync(path.join(tmpdir(), 'phase3a-intake-'))
const tree = path.join(root, 'tree')
mkdirSync(path.join(tree, 'package'), { recursive: true })
writeFileSync(path.join(tree, 'package', 'a.txt'), 'alpha')
writeFileSync(path.join(tree, 'package', 'b.txt'), 'beta')

const first = digestTree(tree)
const second = digestTree(tree)
assert.equal(first.sha256, second.sha256)
assert.equal(first.records.length, 2)
assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}')

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
assert.equal(digestTreeRecords([{ path: 'empty', executable: false, size: 0, sha256: hash('') }]), '62544ca32d54fc789a2f8c4a5a8e4959063d95517d9e7c56bf007ebc8445d36e')
assert.equal(digestTreeRecords([
  { path: 'b', executable: false, size: 1, sha256: hash('b') },
  { path: 'a', executable: false, size: 1, sha256: hash('a') },
]), 'eb27201de832171a41a7b84015e05b491643980526c5dc03fab04144139b4f2d')
assert.equal(digestTreeRecords([{ path: 'tool', executable: true, size: 1, sha256: hash('x') }]), 'e240de8ae10343aea246c674a93bd9d273aeee44112c8c6f6efee398c0556f48')
assert.equal(digestTreeRecords([{ path: 'tool', executable: false, size: 1, sha256: hash('y') }]), 'b61329f7d037c74bb40f6d24cb9638f6138328f756ae3540a7edb6a3b305fa5b')
assert.throws(
  () => digestTreeRecords([
    { path: 'A', executable: false, size: 0, sha256: hash('') },
    { path: 'a', executable: false, size: 0, sha256: hash('') },
  ]),
  (error: unknown) => error instanceof Phase3AError && error.code === 'path_collision',
)

assert.throws(
  () => assertEvidencePath(root, path.join(root, '..', 'escape')),
  (error: unknown) => error instanceof Phase3AError && error.code === 'path_outside_evidence_root',
)

const unsafe = path.join(root, 'unsafe')
mkdirSync(unsafe)
symlinkSync('../outside', path.join(unsafe, 'escape'))
assert.throws(
  () => digestTree(unsafe),
  (error: unknown) => error instanceof Phase3AError && error.code === 'archive_unsafe',
)

for (const names of [['../escape'], ['/absolute'], ['package/a', 'package/a'], ['package/A', 'package/a']]) {
  assert.throws(
    () => validateArchiveNames(names),
    (error: unknown) => error instanceof Phase3AError && error.code === 'archive_unsafe',
  )
}

const tarSource = path.join(root, 'tar-source')
mkdirSync(path.join(tarSource, 'package'), { recursive: true })
writeFileSync(path.join(tarSource, 'package', 'a.txt'), 'alpha')
writeFileSync(path.join(tarSource, 'package', 'compressible.bin'), 'z'.repeat(4096))
const archive = path.join(root, 'safe.tgz')
const tarResult = spawnSync('tar', ['-czf', archive, '-C', tarSource, 'package'], { encoding: 'utf8' })
assert.equal(tarResult.status, 0, tarResult.stderr)
const pinnedLimits: ArchiveLimits = { ...UNPINNED_LIMITS, archiveBytes: 1024 * 1024, totalRegularBytes: 16 * 1024, singleRegularBytes: 8192, entries: 20, regularFiles: 10, expansionRatio: null }
const extracted = await extractTarGzSafely(archive, path.join(root, 'extracted-safe'), pinnedLimits)
assert.equal(extracted.regular_file_count, 2)
assert.equal(extracted.regular_file_bytes, 4101)
assert.ok(extracted.expansion_ratio > 4)
assert.deepEqual(extracted.warnings, ['expansion_ratio_above_planning_threshold'])

await assert.rejects(
  extractTarGzSafely(archive, path.join(root, 'extracted-single-limit'), { ...pinnedLimits, singleRegularBytes: 100 }),
  (error: unknown) => error instanceof Phase3AError && error.code === 'disk_limit',
)
await assert.rejects(
  extractTarGzSafely(archive, path.join(root, 'extracted-count-limit'), { ...pinnedLimits, regularFiles: 1 }),
  (error: unknown) => error instanceof Phase3AError && error.code === 'disk_limit',
)
await assert.rejects(
  extractTarGzSafely(archive, path.join(root, 'extracted-total-limit'), { ...pinnedLimits, totalRegularBytes: 100 }),
  (error: unknown) => error instanceof Phase3AError && error.code === 'disk_limit',
)
await assert.rejects(
  extractTarGzSafely(archive, path.join(root, 'extracted-entry-limit'), { ...pinnedLimits, entries: 1 }),
  (error: unknown) => error instanceof Phase3AError && error.code === 'disk_limit',
)
await assert.rejects(
  extractTarGzSafely(archive, path.join(root, 'extracted-depth-limit'), { ...pinnedLimits, pathDepth: 1 }),
  (error: unknown) => error instanceof Phase3AError && error.code === 'archive_unsafe',
)
await assert.rejects(
  extractTarGzSafely(archive, path.join(root, 'extracted-path-limit'), { ...pinnedLimits, pathBytes: 5 }),
  (error: unknown) => error instanceof Phase3AError && error.code === 'archive_unsafe',
)
await assert.rejects(
  extractTarGzSafely(archive, path.join(root, 'extracted-unpinned-ratio'), { ...pinnedLimits, expansionRatio: 4 }),
  (error: unknown) => error instanceof Phase3AError && error.code === 'archive_unsafe',
)

const linkSource = path.join(root, 'link-source')
mkdirSync(path.join(linkSource, 'package'), { recursive: true })
symlinkSync('../outside', path.join(linkSource, 'package', 'escape'))
const linkArchive = path.join(root, 'link.tgz')
assert.equal(spawnSync('tar', ['-czf', linkArchive, '-C', linkSource, 'package']).status, 0)
await assert.rejects(
  extractTarGzSafely(linkArchive, path.join(root, 'extracted-link'), pinnedLimits),
  (error: unknown) => error instanceof Phase3AError && error.code === 'archive_unsafe',
)

const rawMutations: Array<[string, Buffer]> = [
  ['traversal', rawTar([{ name: Buffer.from('../escape') }])],
  ['absolute', rawTar([{ name: Buffer.from('/absolute') }])],
  ['invalid-utf8', rawTar([{ name: Buffer.from([0xff, 0xfe]) }])],
  ['duplicate', rawTar([{ name: Buffer.from('same') }, { name: Buffer.from('same') }])],
  ['case-collision', rawTar([{ name: Buffer.from('Case') }, { name: Buffer.from('case') }])],
  ['hardlink', rawTar([{ name: Buffer.from('hard'), type: '1' }])],
  ['special', rawTar([{ name: Buffer.from('fifo'), type: '6' }])],
]
for (const [label, bytes] of rawMutations) {
  const mutationArchive = path.join(root, `${label}.tgz`)
  writeFileSync(mutationArchive, bytes)
  await assert.rejects(
    extractTarGzSafely(mutationArchive, path.join(root, `extracted-${label}`), pinnedLimits),
    (error: unknown) => error instanceof Phase3AError && error.code === 'archive_unsafe',
    label,
  )
}

console.log(JSON.stringify({ ok: true, cases: 31 }))
