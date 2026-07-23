import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import Ajv2020 from 'ajv/dist/2020.js'

import { canonicalJson } from '../tools/oracle-lab/phase3a/core.js'
import {
  claudeCode215StaticConstantSpecs,
  computeStaticReconRecordDigest,
  scanStaticAnchors,
  validateStaticBlockerReconRecord,
  verifyStaticSafeInputs,
  type StaticAnchorSpec,
} from '../tools/oracle-lab/phase3a/static-blocker-recon.js'

console.log('\ntests/oracle-phase3a-static-blocker-recon.test.ts')

const source = Buffer.from([
  'function parseState(value) { if (!value) return null; return JSON.parse(value) }',
  'function loadState(value) { if (value === undefined) return null; try { return parseState(value) } catch { return null } }',
  'function sendState(value) { return client.beta.messages.create({ messages: normalize(value) }) }',
].join('\n'), 'utf8')

const specs: StaticAnchorSpec[] = [
  { id: 'state-reader', function_name: 'loadState', required_markers: ['parseState('], required_calls: ['parseState'] },
  { id: 'request-sink', function_name: 'sendState', required_markers: ['beta.messages.create', 'messages:'], required_calls: ['normalize'] },
]

const first = scanStaticAnchors(source, specs, { artifact_offset: 1000 })
const second = scanStaticAnchors(source, specs, { artifact_offset: 1000 })
assert.deepEqual(first, second)
assert.equal(first.anchors.length, 2)
assert.equal(first.anchors[0]?.function_name, 'loadState')
assert.ok((first.anchors[0]?.cfg.branch_count ?? 0) >= 1)
assert.ok((first.anchors[0]?.cfg.node_count ?? 0) >= 1)
assert.ok((first.anchors[0]?.cfg.edge_count ?? 0) >= 1)
assert.deepEqual(first.anchors[0]?.direct_calls, ['parseState'])
assert.equal(first.anchors[1]?.artifact_offset, 1000 + (first.anchors[1]?.module_offset ?? 0))
assert.deepEqual(first.constant_anchors, [])
assert.match(first.scan_digest, /^[a-f0-9]{64}$/)

assert.throws(
  () => scanStaticAnchors(source, [{ ...specs[0]!, required_markers: ['missing-marker'] }], { artifact_offset: 0 }),
  (error: unknown) => error instanceof Error && 'code' in error && error.code === 'static_anchor_missing',
)
assert.throws(
  () => scanStaticAnchors(source, [{ ...specs[0]!, required_calls: ['missingCall'] }], { artifact_offset: 0 }),
  (error: unknown) => error instanceof Error && 'code' in error && error.code === 'static_call_edge_missing',
)
assert.throws(
  () => verifyStaticSafeInputs('/definitely-not-a-p3as-safe-input-root'),
  (error: unknown) => error instanceof Error && 'code' in error && error.code === 'static_safe_input_root_invalid',
)

const recordPath = new URL('../docs/superpowers/evidence/phase3a/claude-code-2.1.215-p3as-static-blocker-recon-v1.json', import.meta.url)
const rawRecord = readFileSync(recordPath, 'utf8')
assert.ok(rawRecord.endsWith('\n'))
assert.equal(rawRecord.trimEnd().includes('\n'), false, 'record must use one-line JCS plus final LF')
const record = JSON.parse(rawRecord)
assert.equal(rawRecord, `${canonicalJson(record)}\n`)
validateStaticBlockerReconRecord(record)
const schemaPath = new URL('../docs/superpowers/schemas/oracle-lab-phase3a-static-blocker-recon.schema.json', import.meta.url)
const toolPath = new URL('../tools/oracle-lab/phase3a/static-blocker-recon.ts', import.meta.url)
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema)
assert.equal(validateSchema(record), true, JSON.stringify(validateSchema.errors))
const sha256 = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex')
assert.equal(sha256(readFileSync(recordPath)), 'b4f1212584afbeb7d2b59457d778713bd3d8b967bd5a0a48f73c0140f41642ff')
assert.equal(record.authority.record_schema.sha256, sha256(readFileSync(schemaPath)))
assert.equal(record.authority.recon_tool.sha256, sha256(readFileSync(toolPath)))
assert.equal(record.record_digest, computeStaticReconRecordDigest(record))
assert.equal(record.blocker_decision.missing_exact_state_protocol, 'CLOSED')
assert.equal(record.blocker_decision.missing_state_dependent_network_signal, 'CLOSED')
assert.equal(record.blocker_decision.phase3b_usable, false)
assert.equal(record.blocker_decision.dynamic_execution_authorized, false)
assert.equal(record.safe_inputs.length, 5)
assert.deepEqual(record.safe_inputs.map((entry: { relative_path: string }) => entry.relative_path), [
  'phase-3a-exit-report-v13.json',
  'phase-3b-3.5-handoff-v13.json',
  'closure-terminal-manifest-v8.json',
  'artifact-index-v23.json',
  'leak-scan-v23.json',
])
assert.equal(record.static_anchors.length, 36)
assert.deepEqual(record.static_constants.map((entry: { id: string }) => entry.id), claudeCode215StaticConstantSpecs.map((entry) => entry.id))

for (const operation of record.exact_state_protocol.operations) {
  assert.deepEqual(operation.argv.map((entry: { index: number }) => entry.index), operation.argv.map((_: unknown, index: number) => index))
  assert.ok(operation.argv.every((entry: { token_class: string; literal?: string }) => entry.token_class !== 'literal' || entry.literal?.startsWith('--') || ['stream-json', ''].includes(entry.literal ?? '')))
}

assert.notEqual(record.state_dependent_network_signal.observer_a.capture_surface, record.state_dependent_network_signal.observer_b.capture_surface)
assert.notEqual(record.state_dependent_network_signal.observer_a.failure_mode, record.state_dependent_network_signal.observer_b.failure_mode)
assert.equal(record.state_dependent_network_signal.safe_projection.raw_values_persisted, false)
assert.equal(record.state_dependent_network_signal.safe_projection.session_ids_persisted, false)
assert.equal(record.state_dependent_network_signal.safe_projection.credentials_persisted, false)

for (const mutation of [
  (value: any) => { value.blocker_decision.missing_exact_state_protocol = 'OPEN' },
  (value: any) => { value.blocker_decision.dynamic_execution_authorized = true },
  (value: any) => { value.exact_state_protocol.operations[0].argv[0].index = 7 },
  (value: any) => { value.state_dependent_network_signal.observer_b.capture_surface = value.state_dependent_network_signal.observer_a.capture_surface },
  (value: any) => { value.static_anchors.pop() },
]) {
  const changed = structuredClone(record)
  mutation(changed)
  changed.record_digest = computeStaticReconRecordDigest(changed)
  assert.throws(() => validateStaticBlockerReconRecord(changed))
}

for (const mutation of [
  (value: any) => { value.exact_state_protocol.operations[2].argv[7].literal = '--session-id' },
  (value: any) => { value.exact_state_protocol.state_storage.state_path_derivation = 'unspecified-state-path' },
  (value: any) => { value.state_dependent_network_signal.state_to_network_flow[1] = { from: 'state-jsonl-reader', to: 'state-jsonl-reader', relation: 'self' } },
  (value: any) => { value.state_dependent_network_signal.observer_b.parser_class = value.state_dependent_network_signal.observer_a.parser_class },
  (value: any) => { value.exact_state_protocol.environment.fake_upstream_endpoint_binding.endpoint_safe_ref_name = 'unbound-endpoint' },
  (value: any) => { value.static_constants.pop() },
  (value: any) => { value.safe_inputs[0].sha256 = '0'.repeat(64) },
]) {
  const changed = structuredClone(record)
  mutation(changed)
  changed.record_digest = computeStaticReconRecordDigest(changed)
  assert.throws(() => validateStaticBlockerReconRecord(changed))
  assert.equal(validateSchema(changed), false)
}

const staleDerivation = structuredClone(record)
staleDerivation.state_dependent_network_signal.derivation_digest = '0'.repeat(64)
staleDerivation.record_digest = computeStaticReconRecordDigest(staleDerivation)
assert.throws(() => validateStaticBlockerReconRecord(staleDerivation), /exact value mismatch/)

for (const mutation of [
  (value: any) => { value.unknown_field = true },
  (value: any) => { delete value.artifact.architecture },
  (value: any) => { value.exact_state_protocol.operations[0].argv[0].safe_ref_name = 'not-null' },
  (value: any) => { value.static_anchors.pop() },
]) {
  const changed = structuredClone(record)
  mutation(changed)
  assert.equal(validateSchema(changed), false)
}

const staleDigest = structuredClone(record)
staleDigest.record_digest = '0'.repeat(64)
assert.throws(() => validateStaticBlockerReconRecord(staleDigest), /record_digest/)

const reportPath = new URL('../docs/superpowers/evidence/phase3a/claude-code-2.1.215-p3as-static-blocker-recon-v1.md', import.meta.url)
const supplementPlanPath = new URL('../docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3a-resume-supplement.md', import.meta.url)
const phase3bPlanPath = new URL('../docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3b-profile-synthesis.md', import.meta.url)
const reportSha256 = '3e1b025ca5f075e21ca528544c9be096e1b1afb090a9aecfe448660563fe38bc'
assert.equal(sha256(readFileSync(reportPath)), reportSha256)

const supplementPlan = readFileSync(supplementPlanPath, 'utf8')
const phase3bPlan = readFileSync(phase3bPlanPath, 'utf8')
const supplementAppendix = '\n## 16. Append-only static blocker closure authority (2026-07-23)'
const phase3bAppendix = '\n## 17. Append-only P3A-S static blocker closure binding (2026-07-23)'
assert.equal(sha256(Buffer.from(supplementPlan.slice(0, supplementPlan.indexOf(supplementAppendix)), 'utf8')), 'c13969d1d838e3a921eda8d7a0491fa0472ed35f15bb3ea7374a7b3d153059a6')
assert.equal(sha256(Buffer.from(phase3bPlan.slice(0, phase3bPlan.indexOf(phase3bAppendix)), 'utf8')), '0687ccaea710647a357993aaefc389078d68f54c2d5ae51f6710d63c2e3906d3')
for (const plan of [supplementPlan, phase3bPlan]) {
  for (const binding of [
    'b4f1212584afbeb7d2b59457d778713bd3d8b967bd5a0a48f73c0140f41642ff',
    'ea6ec9d5b9d027d5ed434714cfc38b28ecd81af93d7b51d102821d9d5ecba5a9',
    reportSha256,
    record.authority.record_schema.sha256,
    record.authority.recon_tool.sha256,
  ]) assert.ok(plan.includes(binding), `authority plan is missing binding ${binding}`)
  assert.ok(plan.includes('RECON_APPEND_ONLY_CLOSED'))
  assert.ok(plan.includes('phase3b_usable=false'))
}
const dag = (plan: string): unknown => {
  const match = plan.match(/```json supplement-closure-dag\n([\s\S]*?)\n```/)
  assert.ok(match)
  return JSON.parse(match[1]!)
}
assert.deepEqual(dag(supplementPlan), dag(phase3bPlan))

console.log(JSON.stringify({ ok: true, cases: 61 }))
