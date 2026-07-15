import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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
const executionContextSchemaPath = 'docs/superpowers/schemas/oracle-lab-phase-1-execution-context.schema.json'
const executionContextPath = 'docs/superpowers/evidence/phase-1/phase-1-execution-context.json'
const p01ResultsPath = 'docs/superpowers/evidence/p0-1/p0-1-command-results.json'
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
  const validator = compile(schema)
  assert.equal(validator(value), true, JSON.stringify(validator.errors))
  return value
}

function compile(schema: Value) {
  return new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function planningEntrySemantics(entry: Value, sourceResults: Value): boolean {
  if (entry.repositories.cc_gateway.head !== entry.repositories.cc_gateway.remote_main_head) return false
  if (entry.repositories.sub2api.head !== entry.repositories.sub2api.remote_main_head) return false
  const sourceByID = new Map((sourceResults.records as Value[]).map((record) => [record.command_id, record]))
  return (entry.gate_results.records as Value[]).every((record) => {
    const source = sourceByID.get(record.command_id)
    return source
      && source.repository === record.repository
      && source.status === record.status
      && source.exit_code === record.exit_code
      && source.repository_commit === record.source_repository_commit
      && source.result_digest === record.result_digest
  })
}

function executionContextFixture(): Value {
  const commit = 'a'.repeat(40)
  const digestValue = `sha256:${'b'.repeat(64)}`
  const pathDigest = (relative: string) => ({ path: relative, digest: digestValue })
  return {
    schema_version: 1,
    context_kind: 'phase_1_execution_context',
    generated_at: '2026-07-15T10:00:00Z',
    expires_at: '2026-07-16T10:00:00Z',
    plan: {
      path: 'docs/superpowers/plans/2026-07-15-claude-code-2.1.207-phase-1-control-plane-boundary-repairs.md',
      digest: digestValue,
      reviewed_commit: commit,
    },
    planning_provenance: {
      entry: pathDigest(entryPath),
      context: pathDigest(contextPath),
    },
    approval_receipt: {
      artifact: pathDigest('docs/superpowers/evidence/phase-1/phase-1-plan-review.md'),
      decision: 'approved',
      reviewer_id: 'independent-plan-reviewer',
      review_round: 2,
      reviewed_plan_commit: commit,
      reviewed_plan_digest: digestValue,
      critical_findings: 0,
      important_findings: 0,
    },
    repositories: {
      cc_gateway: { baseline_main_head: commit, tracking_ref: 'refs/remotes/muqihang/main', implementation_branch: 'codex/oracle-phase-1-cc-gateway', clean: true, dirty_digest: digest(Buffer.alloc(0)) },
      sub2api: { baseline_main_head: commit, tracking_ref: 'refs/remotes/muqihang/main', implementation_branch: 'codex/oracle-phase-1-sub2api', clean: true, dirty_digest: digest(Buffer.alloc(0)) },
    },
    shared_contract: {
      repository: 'sub2api',
      path: 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json',
      digest: 'sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1',
    },
    authority_order: authorityOrder.map(pathDigest),
    selected_requirements: selectedRequirements,
    implementation_entry: {
      status: 'authorized',
      conditions: [
        'fresh_unexpired_execution_context',
        'exact_plan_digest_bound',
        'independent_plan_approval_bound',
        'critical_and_important_findings_zero',
        'both_main_heads_frozen',
        'shared_contract_unchanged',
        'production_and_real_canary_disabled',
      ],
    },
    disabled_capabilities: [
      'real_upstream_access', 'real_credentials', 'provider_internal_authority', 'profile_promotion',
      'production_deployment', 'real_canary', 'direct_egress_trust', 'unverified_pinned_wire_claims',
      'unsupported_negative_capabilities', 'expired_or_missing_negative_capabilities', 'unrestricted_capture',
      'external_network_requests',
    ],
  }
}

function executionContextBindings(value: Value): boolean {
  return value.plan.reviewed_commit === value.approval_receipt.reviewed_plan_commit
    && value.plan.digest === value.approval_receipt.reviewed_plan_digest
    && value.approval_receipt.decision === 'approved'
    && value.approval_receipt.critical_findings === 0
    && value.approval_receipt.important_findings === 0
}

test('Phase 1 planning entry and context satisfy their closed schemas', async () => {
  await validate(entrySchemaPath, entryPath)
  await validate(contextSchemaPath, contextPath)
  compile(await json(executionContextSchemaPath))
})

test('Phase 1 planning gate records bind exact P0.1 results and reject semantic drift', async () => {
  const entry = await json(entryPath)
  const sourceResults = await json(p01ResultsPath)
  assert.equal(entry.gate_results.source_results.digest, digest(await readFile(path.join(root, p01ResultsPath))))
  assert.equal(planningEntrySemantics(entry, sourceResults), true)

  const wrongHead = clone(entry)
  wrongHead.repositories.cc_gateway.head = 'f'.repeat(40)
  assert.equal(planningEntrySemantics(wrongHead, sourceResults), false)

  const wrongResult = clone(entry)
  wrongResult.gate_results.records[0].result_digest = `sha256:${'f'.repeat(64)}`
  assert.equal(planningEntrySemantics(wrongResult, sourceResults), false)

  const schemaValidator = compile(await json(entrySchemaPath))
  const impossiblePass = clone(entry)
  impossiblePass.gate_results.records[0].exit_code = 1
  assert.equal(schemaValidator(impossiblePass), false)
  const impossibleExpectedFail = clone(entry)
  impossibleExpectedFail.gate_results.records.at(-1).exit_code = 0
  assert.equal(schemaValidator(impossibleExpectedFail), false)
})

test('Phase 1 execution context requires exact plan approval and closed authorization', async () => {
  const validator = compile(await json(executionContextSchemaPath))
  const fixture = executionContextFixture()
  assert.equal(validator(fixture), true, JSON.stringify(validator.errors))
  assert.equal(executionContextBindings(fixture), true)

  const unapproved = clone(fixture)
  unapproved.approval_receipt.important_findings = 1
  assert.equal(validator(unapproved), false)
  const wrongPlan = clone(fixture)
  wrongPlan.approval_receipt.reviewed_plan_digest = `sha256:${'c'.repeat(64)}`
  assert.equal(executionContextBindings(wrongPlan), false)
})

test('required Phase 1 execution context binds live bytes, approval, expiry, and both main heads', async (t) => {
  if (process.env.PHASE1_REQUIRE_EXECUTION_CONTEXT !== '1') {
    t.skip('execution context is created just in time after the reviewed plan merges')
    return
  }
  const sub2apiRoot = process.env.SUB2API_ROOT
  assert(sub2apiRoot, 'SUB2API_ROOT is required with PHASE1_REQUIRE_EXECUTION_CONTEXT=1')
  const context = await validate(executionContextSchemaPath, executionContextPath)
  assert.equal(executionContextBindings(context), true)
  assert.equal(context.plan.digest, digest(await readFile(path.join(root, context.plan.path))))
  assert.equal(context.approval_receipt.artifact.digest, digest(await readFile(path.join(root, context.approval_receipt.artifact.path))))
  assert.equal(context.planning_provenance.entry.digest, digest(await readFile(path.join(root, context.planning_provenance.entry.path))))
  assert.equal(context.planning_provenance.context.digest, digest(await readFile(path.join(root, context.planning_provenance.context.path))))
  for (const binding of context.authority_order as Value[]) {
    assert.equal(binding.digest, digest(await readFile(path.join(root, binding.path))), binding.path)
  }
  const window = Date.parse(context.expires_at) - Date.parse(context.generated_at)
  assert(window > 0 && window <= 24 * 60 * 60 * 1000)
  assert(Date.now() < Date.parse(context.expires_at), 'execution context is expired')
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  assert.equal(context.repositories.cc_gateway.baseline_main_head, git(root, 'rev-parse', 'muqihang/main'))
  assert.equal(context.repositories.sub2api.baseline_main_head, git(sub2apiRoot, 'rev-parse', 'muqihang/main'))
  execFileSync('git', ['merge-base', '--is-ancestor', context.plan.reviewed_commit, 'HEAD'], { cwd: root })
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
