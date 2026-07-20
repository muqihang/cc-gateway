import assert from 'node:assert/strict'

import { canonicalJson, Phase3AError, sha256Bytes } from '../tools/oracle-lab/phase3a/core.js'
import { extractBundleBytes } from '../tools/oracle-lab/phase3a/extract-bundle.js'
import { recoverAstBytes, type AstRecovery } from '../tools/oracle-lab/phase3a/recover-ast.js'
import { inventoryBytes } from '../tools/oracle-lab/phase3a/static-inventory.js'
import { structuralDiff, type StaticSnapshot } from '../tools/oracle-lab/phase3a/structural-diff.js'

console.log('\ntests/oracle-phase3a-static.test.ts')

function fixed(buffer: Buffer, offset: number, value: string): void {
  buffer.write(value, offset, Math.min(16, value.length), 'ascii')
}

function machoFixture(): Buffer {
  const commandSize = 72 + 2 * 80
  const dataOffset = 32 + commandSize
  const bytes = Buffer.alloc(dataOffset + 48)
  bytes.writeUInt32LE(0xfeedfacf, 0)
  bytes.writeUInt32LE(0x0100000c, 4)
  bytes.writeUInt32LE(0, 8)
  bytes.writeUInt32LE(2, 12)
  bytes.writeUInt32LE(1, 16)
  bytes.writeUInt32LE(commandSize, 20)
  bytes.writeUInt32LE(0x00200085, 24)
  bytes.writeUInt32LE(0, 28)
  const command = 32
  bytes.writeUInt32LE(0x19, command)
  bytes.writeUInt32LE(commandSize, command + 4)
  fixed(bytes, command + 8, '__BUN')
  bytes.writeBigUInt64LE(0n, command + 24)
  bytes.writeBigUInt64LE(BigInt(48), command + 32)
  bytes.writeBigUInt64LE(BigInt(dataOffset), command + 40)
  bytes.writeBigUInt64LE(BigInt(48), command + 48)
  bytes.writeUInt32LE(2, command + 64)
  const first = command + 72
  fixed(bytes, first, '__bun')
  fixed(bytes, first + 16, '__BUN')
  bytes.writeBigUInt64LE(BigInt(32), first + 40)
  bytes.writeUInt32LE(dataOffset, first + 48)
  const second = first + 80
  fixed(bytes, second, '__meta')
  fixed(bytes, second + 16, '__BUN')
  bytes.writeBigUInt64LE(BigInt(16), second + 40)
  bytes.writeUInt32LE(dataOffset + 32, second + 48)
  Buffer.from('const RAW_VENDOR_SENTINEL=1;xxx', 'utf8').copy(bytes, dataOffset, 0, 32)
  Buffer.from('{"version":"x"}', 'utf8').copy(bytes, dataOffset + 32)
  return bytes
}

const macho = machoFixture()
const machoDigest = sha256Bytes(macho)
const inventory = inventoryBytes(macho, machoDigest)
assert.equal(inventory.format, 'mach-o')
assert.equal(inventory.slices.length, 1)
assert.equal(inventory.slices[0].architecture, 'arm64')
assert.deepEqual(inventory.slices[0].sections.map((section) => `${section.segment},${section.section}`), ['__BUN,__bun', '__BUN,__meta'])
assert.ok(inventory.slices[0].sections.every((section) => section.location.artifact_sha256 === machoDigest))
assert.match(inventory.binding.command_sha256, /^[a-f0-9]{64}$/)
assert.throws(
  () => inventoryBytes(macho, '0'.repeat(64)),
  (error: unknown) => error instanceof Phase3AError && error.code === 'artifact_hash_mismatch',
)

const outOfBounds = Buffer.from(macho)
outOfBounds.writeBigUInt64LE(BigInt(4096), 32 + 72 + 40)
assert.throws(
  () => inventoryBytes(outOfBounds),
  (error: unknown) => error instanceof Phase3AError && error.code === 'static_range_invalid',
)

const overlap = Buffer.from(macho)
overlap.writeUInt32LE(32 + 72 + 2 * 80 + 16, 32 + 72 + 80 + 48)
assert.throws(
  () => inventoryBytes(overlap),
  (error: unknown) => error instanceof Phase3AError && error.code === 'static_section_overlap',
)

const firstExtraction = extractBundleBytes(macho, inventory)
const secondExtraction = extractBundleBytes(macho, inventory)
assert.equal(firstExtraction.deterministic_digest, secondExtraction.deterministic_digest)
assert.equal(firstExtraction.candidates.length, 2)
assert.ok(firstExtraction.candidates.every((candidate) => candidate.persisted_payload === false && candidate.location.artifact_sha256 === machoDigest))
assert.ok(!canonicalJson(firstExtraction).includes('RAW_VENDOR_SENTINEL'))

const tamperedInventory = structuredClone(inventory)
tamperedInventory.slices[0].sections[0].sha256 = '0'.repeat(64)
assert.throws(
  () => extractBundleBytes(macho, tamperedInventory),
  (error: unknown) => error instanceof Phase3AError && error.code === 'artifact_hash_mismatch',
)
assert.throws(
  () => extractBundleBytes(Buffer.from([0x1f, 0x8b, 0, 0]), inventoryBytes(Buffer.from([0x1f, 0x8b, 0, 0]))),
  (error: unknown) => error instanceof Phase3AError && error.code === 'static_recursive_archive',
)

function recover(source: string): AstRecovery {
  const bytes = Buffer.from(source, 'utf8')
  const digest = sha256Bytes(bytes)
  return recoverAstBytes(bytes, { sha256: digest, location: { artifact_sha256: digest, offset: 0, length: bytes.length } })
}

const source = `
const RAW_VENDOR_SENTINEL = "do-not-persist-this-vendor-source";
const decodedKeys = ["TZ", "systemPrompt"];
function send(state) {
  const target = request;
  target();
  handlers[state]();
  if (process.env.TZ) fetch("baseURL");
  process.env[decodedKeys[0]];
  switch (state) {
    case "starting": state = "running"; break;
    case "running": state = "shutdown"; break;
  }
  return { systemPrompt: "systemPrompt", compact: "compact" };
}
function request() { return JSON.stringify({ body: true }); }
send("starting");
`
const recovered = recover(source)
const recoveredAgain = recover(source)
assert.equal(recovered.deterministic_digest, recoveredAgain.deterministic_digest)
assert.equal(recovered.parse.canonical_ast_sha256, recovered.parse.reparsed_canonical_ast_sha256)
assert.equal(recovered.parse.parser_agreement, 'agreed')
assert.equal(recovered.parse.persisted_raw_source, false)
assert.ok(recovered.callgraph.edges.some((edge) => edge.kind === 'alias'))
assert.ok(recovered.callgraph.unresolved.some((edge) => edge.reason === 'dynamic-property-call'))
assert.equal(recovered.state_machines.length, 1)
assert.ok(recovered.state_machines[0].transitions.some((transition) => transition.kind === 'assignment'))
assert.equal(recovered.root_coverage.find((root) => root.root === 'home-xdg-tmp-tz-lang-locale-host-platform-arch')?.status, 'observed')
assert.equal(recovered.root_coverage.find((root) => root.root === 'system-prompt')?.status, 'observed')
assert.ok(recovered.decoded_constants.some((entry) => entry.rule === 'constant-table-index-v1'))
assert.ok(recovered.literal_xrefs.some((entry) => entry.literal_class === 'decoded'))
assert.ok(!canonicalJson(recovered).includes('do-not-persist-this-vendor-source'))
assert.ok(!canonicalJson(recovered).includes('RAW_VENDOR_SENTINEL'))
assert.ok(recovered.literal_xrefs.every((xref) => xref.location.artifact_sha256 === recovered.binding.artifact_sha256))
assert.throws(
  () => recover('function broken( {'),
  (error: unknown) => error instanceof Phase3AError && error.code === 'static_syntax_invalid',
)

function snapshot(version: string, recovery: AstRecovery): StaticSnapshot {
  return { version, recoveries: [recovery] }
}

const renameControl = recover(`function alpha(value){if(value){return "systemPrompt"}return "compact"}`)
const renameActive = recover(`function renamed(thing) {
  if (thing) { return 'systemPrompt'; }
  return 'compact';
}`)
assert.equal(renameControl.parse.canonical_ast_sha256, renameActive.parse.canonical_ast_sha256)
const renameDiff = structuralDiff({ active: snapshot('2.1.215', renameActive), control: snapshot('2.1.201', renameControl), hypothesisId: 'fixture-rename' })
assert.equal(renameDiff.semantic_change, false)
assert.ok(renameDiff.deltas.filter((entry) => ['modules', 'ast', 'xrefs', 'callgraph', 'cfg', 'state-machines', 'serialization'].includes(entry.category)).every((entry) => entry.added.length + entry.removed.length + entry.changed.length === 0))

const branchActive = recover(`function renamed(thing) { if (thing) { return 'systemPrompt'; } else if (Date.now()) { return 'compact'; } return 'compact'; }`)
const branchDiff = structuralDiff({ active: snapshot('2.1.215', branchActive), control: snapshot('2.1.201', renameControl), hypothesisId: 'fixture-branch' })
assert.equal(branchDiff.semantic_change, true)
assert.ok(branchDiff.deltas.find((entry) => entry.category === 'cfg')!.changed.length > 0)
assert.match(branchDiff.command_sha256, /^[a-f0-9]{64}$/)
assert.equal(branchDiff.method, 'bounded-structural-index-diff-no-full-text')

const stateControl = recover(`function f(state){switch(state){case "a":state="b";break}}`)
const stateActive = recover(`function f(state){switch(state){case "a":state="c";break}}`)
const stateDiff = structuralDiff({ active: snapshot('2.1.215', stateActive), control: snapshot('2.1.200', stateControl), hypothesisId: 'fixture-state' })
assert.ok(stateDiff.deltas.find((entry) => entry.category === 'state-machines')!.changed.length > 0)
assert.ok(stateDiff.dynamic_cells_required.includes('dynamic-hypothesis:fixture-state:state-machine'))

console.log(JSON.stringify({ ok: true, cases: 35 }))
