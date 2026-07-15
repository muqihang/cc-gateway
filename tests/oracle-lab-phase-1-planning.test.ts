import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import Ajv2020 from 'ajv/dist/2020.js'

type Value = Record<string, any>

const root = process.cwd()
const entryPath = 'docs/superpowers/evidence/phase-1/phase-1-entry-baseline.json'
const contextPath = 'docs/superpowers/evidence/phase-1/phase-1-context.json'
const entrySchemaPath = 'docs/superpowers/schemas/oracle-lab-phase-1-entry.schema.json'
const contextSchemaPath = 'docs/superpowers/schemas/oracle-lab-phase-1-context.schema.json'
const selectedRequirements = ['AV-B1-001', 'AV-B2-001', 'AV-B3-001', 'RA-P0-008']
const authorityOrder = [
  'docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md',
  'docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md',
  'docs/superpowers/specs/2026-07-11-claude-code-2.1.207-adversarial-validation-v2.md',
  'docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-design.md',
]
const planningEntryConditions = [
  'p0_1_successor_receipt_valid',
  'cc_gateway_p0_1_branch_merged_to_main',
  'sub2api_p0_1_branch_merged_to_main',
  'local_main_equals_muqihang_main_in_both_repositories',
  'p0_1_artifact_and_sub2api_fix_ancestry_verified',
  'historical_phase_0_and_post_integration_v2_receipts_valid',
  'joint_local_chain_green_on_integrated_heads',
  'b1_b3_expected_red_revalidated_for_phase_1',
  'protected_gateway_production_and_real_canary_disabled',
  'fresh_unexpired_p1_entry_baseline_and_context',
]

async function json(relative: string): Promise<Value> {
  return JSON.parse(await readFile(path.join(root, relative), 'utf8')) as Value
}

function digest(bytes: string | Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

async function validate(schemaRelative: string, valueRelative: string): Promise<Value> {
  const schema = await json(schemaRelative)
  const value = await json(valueRelative)
  const validator = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema)
  assert.equal(validator(value), true, JSON.stringify(validator.errors))
  return value
}

test('Phase 1 planning entry and context satisfy their closed schemas', async () => {
  await validate(entrySchemaPath, entryPath)
  await validate(contextSchemaPath, contextPath)
})

test('Phase 1 planning context binds the exact entry bytes and governing source bytes', async () => {
  const context = await json(contextPath)
  assert.equal(context.entry.digest, digest(await readFile(path.join(root, entryPath))))
  for (const binding of [...context.authority_order, ...Object.values(context.registries)] as Value[]) {
    assert.equal(binding.digest, digest(await readFile(path.join(root, binding.path))), binding.path)
  }
})

test('Phase 1 scope owns only B1-B3 and the Phase 1 listener slice', async () => {
  const entry = await json(entryPath)
  const context = await json(contextPath)
  assert.deepEqual(entry.phase_scope.requirement_ids, selectedRequirements)
  assert.deepEqual(context.selected_requirements, selectedRequirements)
  assert.deepEqual(context.authority_order.map((binding: Value) => binding.path), authorityOrder)
  assert.deepEqual(entry.planning_entry_conditions.map((condition: Value) => condition.condition), planningEntryConditions)
  assert.deepEqual(entry.phase_scope.work_package_slices, ['WP-R8:phase_1_loopback_remote_tls_guard'])
  assert.equal(entry.gate_results.records.filter((record: Value) => record.status === 'pass').length, 7)
  assert.equal(entry.gate_results.records.filter((record: Value) => record.status === 'expected_fail').length, 3)
  assert.equal(entry.implementation_entry.status, 'blocked')
  assert.equal(context.implementation_gate.status, 'planning_only')
})

test('Phase 1 evidence window is bounded and all anchors are repository relative', async () => {
  const entry = await json(entryPath)
  const context = await json(contextPath)
  const entryWindow = Date.parse(entry.expires_at) - Date.parse(entry.generated_at)
  const contextWindow = Date.parse(context.expires_at) - Date.parse(context.generated_at)
  assert(entryWindow > 0 && entryWindow <= 24 * 60 * 60 * 1000)
  assert(contextWindow > 0 && contextWindow <= 24 * 60 * 60 * 1000)
  for (const anchor of context.anchors as Value[]) {
    assert.equal(path.isAbsolute(anchor.path), false)
    assert.equal(anchor.path.split('/').includes('..'), false)
  }
})

test('Phase 1 evidence contains no production enablement or raw secret material', async () => {
  const serialized = `${await readFile(path.join(root, entryPath), 'utf8')}\n${await readFile(path.join(root, contextPath), 'utf8')}`
  assert.doesNotMatch(serialized, /ORACLE[_-]?SECRET[_-]?CANARY|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|Bearer\s+[A-Za-z0-9._~+/=-]{4,}|sk-[A-Za-z0-9_-]{8,}/i)
  const entry = await json(entryPath)
  assert(entry.disabled_capabilities.includes('production_deployment'))
  assert(entry.disabled_capabilities.includes('real_canary'))
})
