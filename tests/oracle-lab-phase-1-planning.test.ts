import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import Ajv2020 from 'ajv/dist/2020.js'
import { runReviewedGit } from '../tools/oracle-lab/secure-runtime.js'

type Value = Record<string, any>

const root = process.cwd()
const planPath = 'docs/superpowers/plans/2026-07-15-claude-code-2.1.207-phase-1-control-plane-boundary-repairs.md'
const entryPath = 'docs/superpowers/evidence/phase-1/phase-1-entry-baseline.json'
const contextPath = 'docs/superpowers/evidence/phase-1/phase-1-context.json'
const entrySchemaPath = 'docs/superpowers/schemas/oracle-lab-phase-1-entry.schema.json'
const contextSchemaPath = 'docs/superpowers/schemas/oracle-lab-phase-1-context.schema.json'
const executionContextSchemaPath = 'docs/superpowers/schemas/oracle-lab-phase-1-execution-context.schema.json'
const planReviewSchemaPath = 'docs/superpowers/schemas/oracle-lab-phase-1-plan-review.schema.json'
const executionContextPath = 'docs/superpowers/evidence/phase-1/phase-1-execution-context.json'
const executionContextSuccessorPrefix = 'docs/superpowers/evidence/phase-1/phase-1-execution-context-'
const executionContextStages = ['implementation_entry', 'implementation', 'feature_capture'] as const
const maxContextClockSkewMs = 5 * 60 * 1000
const expectedRemoteUrlDigests = {
  cc_gateway: 'sha256:52de8ee497a784b90b33345865754f3e6b9d5d96eed92549a15a4157cabb568a',
  sub2api: 'sha256:22c1a9e3cf8e76d2a20bf24a1ff66fa5d7417ba8b8b83a948c8b3ffa5c33a1a9',
} as const
const expectedImplementationBranches = {
  cc_gateway: 'codex/oracle-phase-1-cc-gateway-v8',
  sub2api: 'codex/oracle-phase-1-sub2api-v8',
} as const
const expectedGateSchemaDigests = {
  execution_context: 'sha256:0c9d478bbc5aa810da044c07c6fc0ffaf016aa014ff416b2ea75c6069dec4e56',
  plan_review: 'sha256:9c4262da2cc8620f6297ecdaacb39c6741fdaba3564a4c795da3d5149abab65a',
} as const
const p01ResultsPath = 'docs/superpowers/evidence/p0-1/p0-1-command-results.json'
const selectedRequirements = ['AV-B1-001', 'AV-B2-001', 'AV-B3-001', 'RA-P0-008']
const redInventoryStart = '<!-- PHASE1_RED_FAILURE_INVENTORY_START -->'
const redInventoryEnd = '<!-- PHASE1_RED_FAILURE_INVENTORY_END -->'
const expectedRedInventoryDigest = 'sha256:11a27ce9a1d0081a544363978bbd616a36ac2a2f6d50e06c6e673a1e83c97c34'
const expectedRedRowKeys = [
  'failure_parser', 'expected_parser_lifecycle', 'expected_failure_count',
  'expected_failure_families', 'expected_failure_names',
]
const expectedRedInventory = {
  'cc-b4-b6-red': {
    failure_parser: 'node_test_tap_v1',
    expected_parser_lifecycle: {
      parser: 'node_test_tap_v1',
      tap_version_count: 1,
      terminal_plan_count: 1,
      declared_test_count: 68,
      observed_test_count: 68,
      pass_count: 7,
      fail_count: 61,
      cancelled_count: 0,
      skipped_count: 0,
      todo_count: 0,
      unexplained_stderr_line_count: 0,
    },
    expected_failure_count: 61,
    expected_failure_families: ['B4', 'B5', 'B6'],
    names_digest: 'sha256:0ac491f7f3ab3c22d1f89f62c9be85e1e81bf93909ffcbb0968055daaf5fd387',
  },
  'sidecar-b5-b6-red': {
    failure_parser: 'go_test_json_leaf_v1',
    expected_parser_lifecycle: {
      parser: 'go_test_json_leaf_v1',
      packages: [
        {
          package_suffix: 'internal/control',
          start_count: 1,
          run_test_count: 4,
          terminal_test_count: 4,
          pass_test_count: 2,
          fail_test_count: 2,
          skip_test_count: 0,
          package_fail_terminal_count: 1,
          post_terminal_event_count: 0,
        },
        {
          package_suffix: 'internal/server',
          start_count: 1,
          run_test_count: 64,
          terminal_test_count: 64,
          pass_test_count: 11,
          fail_test_count: 53,
          skip_test_count: 0,
          package_fail_terminal_count: 1,
          post_terminal_event_count: 0,
        },
      ],
      unexplained_stderr_line_count: 0,
      malformed_or_unparsed_event_count: 0,
    },
    expected_failure_count: 51,
    expected_failure_families: ['TestPhase0B5', 'TestPhase0B6'],
    names_digest: 'sha256:319a965a36b691987ffa7eb38b12ba380cb5fafc549e6d072ff50468cb562903',
  },
} as const
const expectedGateCommandIDs = [
  'cc-build', 'p0-1-focused', 'cc-tests', 'cc-cross-repo-baseline', 'sidecar-tests',
  'sub2api-formal-pool', 'sub2api-joint-local-chain', 'cc-boundary-red',
  'sidecar-boundary-red', 'sub2api-boundary-red',
]
const expectedPlanningHeads = {
  cc_gateway: 'dc195917edb066d826f27c46fd7bea2418f8aa16',
  sub2api: 'b0b77933716487da5fca00329443f88ce9a1c3db',
}
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

function reviewedGitText(cwd: string, args: string[]): string {
  return runReviewedGit(cwd, args).stdout.toString('utf8').trim()
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

function phase1RedInventory(plan: string): Value {
  assert.equal(plan.split(redInventoryStart).length, 2, 'RED inventory start marker must occur exactly once')
  assert.equal(plan.split(redInventoryEnd).length, 2, 'RED inventory end marker must occur exactly once')
  const start = plan.indexOf(redInventoryStart) + redInventoryStart.length
  const end = plan.indexOf(redInventoryEnd)
  const body = plan.slice(start, end).trim()
  const match = body.match(/^```json\n([\s\S]*?)\n```$/)
  assert(match, 'RED inventory marker body must be exactly one JSON code block')
  return JSON.parse(match[1]) as Value
}

function canonicalFailureNames(names: string[]): string[] {
  return [...names].sort((left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')))
}

function failureFamily(name: string): string {
  for (const family of ['B4', 'B5', 'B6', 'TestPhase0B5', 'TestPhase0B6']) {
    if (name === family || name.startsWith(`${family} `) || name.startsWith(`${family}/`)
      || (family.startsWith('TestPhase0') && name.startsWith(family))) return family
  }
  return 'unclassified'
}

function planningEntrySemantics(entry: Value, sourceResults: Value): boolean {
  if (entry.repositories.cc_gateway.head !== entry.repositories.cc_gateway.remote_main_head) return false
  if (entry.repositories.sub2api.head !== entry.repositories.sub2api.remote_main_head) return false
  if (entry.repositories.cc_gateway.head !== expectedPlanningHeads.cc_gateway) return false
  if (entry.repositories.sub2api.head !== expectedPlanningHeads.sub2api) return false
  const records = entry.gate_results.records as Value[]
  const ids = records.map((record) => record.command_id)
  if (records.length !== expectedGateCommandIDs.length) return false
  if (new Set(ids).size !== expectedGateCommandIDs.length) return false
  if (!expectedGateCommandIDs.every((id) => ids.includes(id))) return false
  if (records.filter((record) => record.status === 'pass').length !== entry.gate_results.green_count) return false
  if (records.filter((record) => record.status === 'expected_fail').length !== entry.gate_results.expected_fail_count) return false
  const sourceByID = new Map((sourceResults.records as Value[]).map((record) => [record.command_id, record]))
  return records.every((record) => {
    const source = sourceByID.get(record.command_id)
    return source
      && source.repository === record.repository
      && source.status === record.status
      && source.exit_code === record.exit_code
      && source.repository_commit === record.source_repository_commit
      && source.result_digest === record.result_digest
  })
}

function executionContextPathFor(sequence: number): string {
  return sequence === 0
    ? executionContextPath
    : `${executionContextSuccessorPrefix}${String(sequence).padStart(4, '0')}.json`
}

function contextArtifactBytes(value: Value): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`)
}

function validationStatus(entries: string[]): Value {
  const sorted = [...entries].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
  return { entries: sorted, digest: digest(Buffer.from(sorted.join('\0'))) }
}

function repositoryContextState(commit: string, statusEntries: string[], remoteUrlDigest = expectedRemoteUrlDigests.cc_gateway): Value {
  return {
    baseline_main_head: commit,
    authorized_parent_head: commit,
    observed_remote_main_head: commit,
    remote_name: 'muqihang',
    remote_url_digest: remoteUrlDigest,
    tracking_ref: 'refs/remotes/muqihang/main',
    implementation_branch: expectedImplementationBranches.cc_gateway,
    pre_issue_clean: true,
    validation_status: validationStatus(statusEntries),
  }
}

function executionContextFixture(): Value {
  const commit = 'a'.repeat(40)
  const digestValue = `sha256:${'b'.repeat(64)}`
  const pathDigest = (relative: string) => ({ path: relative, digest: digestValue })
  return {
    schema_version: 2,
    context_kind: 'phase_1_execution_context',
    context_mode: 'initial',
    sequence: 0,
    stage: 'implementation_entry',
    artifact_path: executionContextPath,
    predecessor: null,
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
      artifact: pathDigest('docs/superpowers/evidence/phase-1/phase-1-plan-review.json'),
      decision: 'approved',
      reviewer_id: 'independent-plan-reviewer',
      review_round: 2,
      reviewed_plan_commit: commit,
      reviewed_plan_digest: digestValue,
      critical_findings: 0,
      important_findings: 0,
    },
    gate_schemas: {
      execution_context: { path: executionContextSchemaPath, digest: expectedGateSchemaDigests.execution_context },
      plan_review: { path: planReviewSchemaPath, digest: expectedGateSchemaDigests.plan_review },
    },
    repositories: {
      cc_gateway: repositoryContextState(commit, [
        `?? ${executionContextPath}`,
        '?? docs/superpowers/evidence/phase-1/phase-1-plan-review.json',
      ]),
      sub2api: {
        ...repositoryContextState(commit, [], expectedRemoteUrlDigests.sub2api),
        implementation_branch: expectedImplementationBranches.sub2api,
      },
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
        'contiguous_immutable_context_chain',
        'exact_stage_and_repository_state',
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

function successorExecutionContextFixture(previous: Value, sequence: number, stage: 'implementation' | 'feature_capture' = 'implementation'): Value {
  const value = clone(previous)
  const path = executionContextPathFor(sequence)
  const generated = Date.parse(previous.generated_at) + 60 * 60 * 1000
  const ccHead = String(sequence).repeat(40)
  const subHead = String(sequence + 1).repeat(40)
  value.context_mode = 'successor'
  value.sequence = sequence
  value.stage = stage
  value.artifact_path = path
  value.predecessor = {
    path: previous.artifact_path,
    digest: digest(contextArtifactBytes(previous)),
    sequence: previous.sequence,
    stage: previous.stage,
    artifact_commit: 'c'.repeat(40),
  }
  value.generated_at = new Date(generated).toISOString()
  value.expires_at = new Date(generated + 24 * 60 * 60 * 1000).toISOString()
  value.repositories.cc_gateway.authorized_parent_head = ccHead
  value.repositories.cc_gateway.observed_remote_main_head = previous.repositories.cc_gateway.observed_remote_main_head
  value.repositories.cc_gateway.validation_status = validationStatus([`?? ${path}`])
  value.repositories.sub2api.authorized_parent_head = subHead
  value.repositories.sub2api.observed_remote_main_head = previous.repositories.sub2api.observed_remote_main_head
  value.repositories.sub2api.validation_status = validationStatus([])
  return value
}

function planReviewFixture(): Value {
  const execution = executionContextFixture()
  return {
    schema_version: 1,
    review_kind: 'phase_1_plan_review',
    generated_at: execution.generated_at,
    plan: clone(execution.plan),
    reviewer_id: execution.approval_receipt.reviewer_id,
    review_round: execution.approval_receipt.review_round,
    decision: execution.approval_receipt.decision,
    finding_counts: { critical: 0, important: 0, minor: 0 },
    review_scope: [
      'requirements_and_roadmap_coverage',
      'current_code_anchor_realism',
      'dependency_and_side_effect_ordering',
      'fail_closed_security_boundaries',
      'harness_and_evidence_bindings',
      'commands_tests_and_rollback',
    ],
  }
}

function executionContextBindings(value: Value): boolean {
  return value.plan.reviewed_commit === value.approval_receipt.reviewed_plan_commit
    && value.plan.digest === value.approval_receipt.reviewed_plan_digest
    && value.approval_receipt.decision === 'approved'
    && value.approval_receipt.critical_findings === 0
    && value.approval_receipt.important_findings === 0
    && value.gate_schemas.execution_context.path === executionContextSchemaPath
    && value.gate_schemas.execution_context.digest === expectedGateSchemaDigests.execution_context
    && value.gate_schemas.plan_review.path === planReviewSchemaPath
    && value.gate_schemas.plan_review.digest === expectedGateSchemaDigests.plan_review
}

function executionContextWindowValid(value: Value, now: number): boolean {
  const generated = Date.parse(value.generated_at)
  const expires = Date.parse(value.expires_at)
  return Number.isFinite(generated)
    && Number.isFinite(expires)
    && generated <= now + maxContextClockSkewMs
    && expires > generated
    && expires - generated <= 24 * 60 * 60 * 1000
}

function executionContextFresh(value: Value, now: number): boolean {
  return executionContextWindowValid(value, now)
    && Date.parse(value.generated_at) <= now
    && Date.parse(value.expires_at) > now
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function executionContextChainSemantics(
  values: Value[],
  selectedPath: string,
  expectedStage: typeof executionContextStages[number],
  now: number,
): boolean {
  try {
    validateExecutionContextChainValues(values, selectedPath, expectedStage, now)
    return true
  } catch {
    return false
  }
}

function validateExecutionContextChainValues(
  values: Value[],
  selectedPath: string,
  expectedStage: typeof executionContextStages[number],
  now: number,
): void {
  requireContextGate(values.length > 0, 'context_chain_gap', 'execution context chain is empty')
  const ordered = [...values].sort((left, right) => Number(left.sequence) - Number(right.sequence))
  requireContextGate(new Set(ordered.map((value) => value.sequence)).size === ordered.length, 'context_chain_gap', 'duplicate context sequence')
  requireContextGate(new Set(ordered.map((value) => value.artifact_path)).size === ordered.length, 'context_sequence_mismatch', 'duplicate context path')

  const initial = ordered[0]
  requireContextGate(initial.sequence === 0 && initial.context_mode === 'initial' && initial.stage === 'implementation_entry', 'context_initial_head_mismatch', 'sequence zero mode or stage is invalid')
  requireContextGate(initial.artifact_path === executionContextPath && initial.predecessor === null, 'context_sequence_mismatch', 'sequence zero path or predecessor is invalid')

  for (let index = 0; index < ordered.length; index += 1) {
    const value = ordered[index]
    requireContextGate(value.sequence === index, 'context_chain_gap', 'context sequence is not contiguous')
    requireContextGate(value.artifact_path === executionContextPathFor(index), 'context_sequence_mismatch', 'context path does not match sequence')
    const generated = Date.parse(value.generated_at)
    const expires = Date.parse(value.expires_at)
    requireContextGate(Number.isFinite(generated) && Number.isFinite(expires) && expires > generated && expires - generated <= 24 * 60 * 60 * 1000, 'context_window_invalid', 'context validity window is invalid')
    requireContextGate(generated <= now + maxContextClockSkewMs, 'context_future_timestamp', 'context is future-dated')
    requireContextGate(executionContextBindings(value), 'context_binding_drift', 'approval binding drifted')
    for (const repository of Object.values(value.repositories) as Value[]) {
      const entries = repository.validation_status.entries as string[]
      requireContextGate(sameValue(entries, [...entries].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))), 'context_unexpected_delta', 'status entries are not canonical')
      requireContextGate(repository.validation_status.digest === digest(Buffer.from(entries.join('\0'))), 'context_unexpected_delta', 'status digest drifted')
      requireContextGate(repository.pre_issue_clean === true, 'context_dirty_tree', 'pre-issue tree was not clean')
    }
    if (index === 0) continue

    const previous = ordered[index - 1]
    requireContextGate(value.context_mode === 'successor', 'context_sequence_mismatch', 'nonzero context must be successor')
    requireContextGate(value.predecessor.sequence === previous.sequence && value.predecessor.path === previous.artifact_path, 'context_chain_gap', 'predecessor sequence or path is not immediate')
    requireContextGate(value.predecessor.stage === previous.stage, 'context_stage_regression', 'predecessor stage binding drifted')
    requireContextGate(value.predecessor.digest === digest(contextArtifactBytes(previous)), 'predecessor_context_mutated', 'predecessor digest drifted')
    requireContextGate(Date.parse(value.generated_at) >= Date.parse(previous.generated_at), 'context_timestamp_regression', 'context timestamp regressed')
    requireContextGate(executionContextStages.indexOf(value.stage) >= executionContextStages.indexOf(previous.stage), 'context_stage_regression', 'context stage regressed')
    for (const field of ['plan', 'planning_provenance', 'approval_receipt', 'gate_schemas', 'shared_contract', 'authority_order', 'selected_requirements', 'implementation_entry', 'disabled_capabilities']) {
      requireContextGate(sameValue(value[field], initial[field]), 'context_binding_drift', `${field} drifted`)
    }
    for (const name of ['cc_gateway', 'sub2api']) {
      requireContextGate(value.repositories[name].baseline_main_head === initial.repositories[name].baseline_main_head, 'context_binding_drift', `${name} baseline drifted`)
      for (const field of ['remote_name', 'remote_url_digest', 'tracking_ref', 'implementation_branch']) {
        requireContextGate(value.repositories[name][field] === initial.repositories[name][field], 'context_binding_drift', `${name} ${field} drifted`)
      }
    }
  }

  const latest = ordered.at(-1)!
  requireContextGate(latest.artifact_path === selectedPath, 'stale_execution_context', 'selected context is not latest')
  requireContextGate(latest.stage === expectedStage, 'context_stage_regression', 'latest stage is not requested stage')
  requireContextGate(Date.parse(latest.generated_at) <= now, 'context_not_yet_valid', 'latest context validity has not started')
  requireContextGate(Date.parse(latest.expires_at) > now, 'stale_execution_context', 'latest context is expired')
}

test('Phase 1 planning entry and context satisfy their closed schemas', async () => {
  await validate(entrySchemaPath, entryPath)
  await validate(contextSchemaPath, contextPath)
  compile(await json(executionContextSchemaPath))
  compile(await json(planReviewSchemaPath))
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

  const duplicatedCommand = clone(entry)
  duplicatedCommand.gate_results.records[9] = clone(duplicatedCommand.gate_results.records[8])
  assert.equal(planningEntrySemantics(duplicatedCommand, sourceResults), false)

  const fakeEqualHeads = clone(entry)
  fakeEqualHeads.repositories.cc_gateway.head = 'f'.repeat(40)
  fakeEqualHeads.repositories.cc_gateway.remote_main_head = 'f'.repeat(40)
  assert.equal(planningEntrySemantics(fakeEqualHeads, sourceResults), false)

  const schemaValidator = compile(await json(entrySchemaPath))
  const impossiblePass = clone(entry)
  impossiblePass.gate_results.records[0].exit_code = 1
  assert.equal(schemaValidator(impossiblePass), false)
  const impossibleExpectedFail = clone(entry)
  impossibleExpectedFail.gate_results.records.at(-1).exit_code = 0
  assert.equal(schemaValidator(impossibleExpectedFail), false)
  assert.equal(schemaValidator(fakeEqualHeads), false)
})

test('Phase 1 execution context requires exact plan approval and closed authorization', async () => {
  const validator = compile(await json(executionContextSchemaPath))
  const reviewValidator = compile(await json(planReviewSchemaPath))
  const fixture = executionContextFixture()
  const review = planReviewFixture()
  assert.equal(validator(fixture), true, JSON.stringify(validator.errors))
  assert.equal(reviewValidator(review), true, JSON.stringify(reviewValidator.errors))
  assert.equal(executionContextBindings(fixture), true)

  const unapproved = clone(fixture)
  unapproved.approval_receipt.important_findings = 1
  assert.equal(validator(unapproved), false)
  const wrongPlan = clone(fixture)
  wrongPlan.approval_receipt.reviewed_plan_digest = `sha256:${'c'.repeat(64)}`
  assert.equal(executionContextBindings(wrongPlan), false)
  const wrongGateSchema = clone(fixture)
  wrongGateSchema.gate_schemas.execution_context.digest = `sha256:${'c'.repeat(64)}`
  assert.equal(executionContextBindings(wrongGateSchema), false)
  expectsGateCode(() => requireContextGate(executionContextBindings(wrongGateSchema), 'context_schema_binding_drift', 'gate schema drift'), 'context_schema_binding_drift')
  const wrongAuthority = clone(fixture)
  wrongAuthority.authority_order.reverse()
  assert.equal(validator(wrongAuthority), false)
  const duplicateAuthority = clone(fixture)
  duplicateAuthority.authority_order[1] = clone(duplicateAuthority.authority_order[0])
  assert.equal(validator(duplicateAuthority), false)

  const changesRequested = clone(review)
  changesRequested.decision = 'changes_requested'
  changesRequested.finding_counts.important = 1
  assert.equal(reviewValidator(changesRequested), true, JSON.stringify(reviewValidator.errors))
  const blockedContext = clone(fixture)
  blockedContext.approval_receipt.decision = 'changes_requested'
  blockedContext.approval_receipt.important_findings = 1
  assert.equal(validator(blockedContext), false)
  expectsGateCode(() => requireContextGate(validator(blockedContext), 'context_schema_invalid', 'blocked context schema'), 'context_schema_invalid')
  expectsGateCode(() => requireContextGate(reviewValidator({}), 'context_approval_invalid', 'invalid approval schema'), 'context_approval_invalid')
})

test('Phase 1 execution context successor chain is immutable, contiguous, fresh, and latest-only', async () => {
  const validator = compile(await json(executionContextSchemaPath))
  const initial = executionContextFixture()
  const implementation = successorExecutionContextFixture(initial, 1)
  const feature = successorExecutionContextFixture(implementation, 2, 'feature_capture')
  const now = Date.parse('2026-07-15T12:30:00Z')

  assert.equal(validator(initial), true, JSON.stringify(validator.errors))
  assert.equal(validator(implementation), true, JSON.stringify(validator.errors))
  assert.equal(validator(feature), true, JSON.stringify(validator.errors))
  assert.equal(executionContextChainSemantics([initial, implementation, feature], feature.artifact_path, 'feature_capture', now), true)
  assert.equal(executionContextChainSemantics([initial, implementation, feature], implementation.artifact_path, 'feature_capture', now), false)
  assert.equal(executionContextChainSemantics([initial, feature], feature.artifact_path, 'feature_capture', now), false)
  assert.equal(executionContextChainSemantics([initial, implementation, clone(implementation)], implementation.artifact_path, 'implementation', now), false)

  for (const mutate of [
    (value: Value) => { value.predecessor.digest = `sha256:${'f'.repeat(64)}` },
    (value: Value) => { value.predecessor.path = executionContextPath },
    (value: Value) => { value.predecessor.sequence = 0 },
    (value: Value) => { value.sequence = 3 },
    (value: Value) => { value.artifact_path = `${executionContextSuccessorPrefix}0003.json` },
    (value: Value) => { value.stage = 'implementation' },
    (value: Value) => { value.plan.digest = `sha256:${'f'.repeat(64)}` },
    (value: Value) => { value.repositories.cc_gateway.baseline_main_head = 'f'.repeat(40) },
    (value: Value) => { value.repositories.cc_gateway.validation_status.digest = `sha256:${'f'.repeat(64)}` },
  ]) {
    const changed = clone(feature)
    mutate(changed)
    assert.equal(executionContextChainSemantics([initial, implementation, changed], changed.artifact_path, 'feature_capture', now), false)
  }

  const future = clone(feature)
  future.generated_at = '2026-07-15T13:00:01Z'
  future.expires_at = '2026-07-16T13:00:01Z'
  assert.equal(executionContextChainSemantics([initial, implementation, future], future.artifact_path, 'feature_capture', now), false)

  const expired = clone(feature)
  expired.generated_at = '2026-07-14T12:00:00Z'
  expired.expires_at = '2026-07-15T12:00:00Z'
  assert.equal(executionContextChainSemantics([initial, implementation, expired], expired.artifact_path, 'feature_capture', now), false)

  expectsGateCode(() => validateExecutionContextChainValues([initial, implementation, feature], implementation.artifact_path, 'feature_capture', now), 'stale_execution_context')
  expectsGateCode(() => validateExecutionContextChainValues([initial, feature], feature.artifact_path, 'feature_capture', now), 'context_chain_gap')
  const badDigest = clone(feature)
  badDigest.predecessor.digest = `sha256:${'f'.repeat(64)}`
  expectsGateCode(() => validateExecutionContextChainValues([initial, implementation, badDigest], badDigest.artifact_path, 'feature_capture', now), 'predecessor_context_mutated')
  const regressedStage = clone(feature)
  regressedStage.stage = 'implementation'
  expectsGateCode(() => validateExecutionContextChainValues([initial, implementation, regressedStage], regressedStage.artifact_path, 'feature_capture', now), 'context_stage_regression')
  const regressedTime = clone(feature)
  regressedTime.generated_at = '2026-07-15T10:30:00Z'
  regressedTime.expires_at = '2026-07-16T10:30:00Z'
  expectsGateCode(() => validateExecutionContextChainValues([initial, implementation, regressedTime], regressedTime.artifact_path, 'feature_capture', now), 'context_timestamp_regression')
  expectsGateCode(() => validateExecutionContextChainValues([initial, implementation, future], future.artifact_path, 'feature_capture', now), 'context_future_timestamp')
  const stale = clone(feature)
  stale.expires_at = '2026-07-15T12:15:00Z'
  expectsGateCode(() => validateExecutionContextChainValues([initial, implementation, stale], stale.artifact_path, 'feature_capture', now), 'stale_execution_context')
  const wrongSequencePath = clone(feature)
  wrongSequencePath.artifact_path = `${executionContextSuccessorPrefix}0003.json`
  expectsGateCode(() => validateExecutionContextChainValues([initial, implementation, wrongSequencePath], wrongSequencePath.artifact_path, 'feature_capture', now), 'context_sequence_mismatch')
  const invalidWindow = clone(feature)
  invalidWindow.expires_at = invalidWindow.generated_at
  expectsGateCode(() => validateExecutionContextChainValues([initial, implementation, invalidWindow], invalidWindow.artifact_path, 'feature_capture', now), 'context_window_invalid')
  const bindingDrift = clone(feature)
  bindingDrift.plan.digest = `sha256:${'f'.repeat(64)}`
  expectsGateCode(() => validateExecutionContextChainValues([initial, implementation, bindingDrift], bindingDrift.artifact_path, 'feature_capture', now), 'context_binding_drift')

  const notYetValid = clone(feature)
  notYetValid.generated_at = new Date(now + 60_000).toISOString()
  notYetValid.expires_at = new Date(now + 24 * 60 * 60 * 1000).toISOString()
  expectsGateCode(() => validateExecutionContextChainValues([initial, implementation, notYetValid], notYetValid.artifact_path, 'feature_capture', now), 'context_not_yet_valid')
})

test('Phase 1 preflight Git inspection ignores inherited redirect state', () => {
  const expected = reviewedGitText(root, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'])
  const hostile: Record<string, string> = {
    PATH: '/tmp/unreviewed-git-bin',
    GIT_DIR: '/tmp/unreviewed-git-dir',
    GIT_WORK_TREE: '/tmp/unreviewed-worktree',
    GIT_OBJECT_DIRECTORY: '/tmp/unreviewed-objects',
    GIT_ALTERNATE_OBJECT_DIRECTORIES: '/tmp/unreviewed-alternates',
    GIT_CONFIG_GLOBAL: '/tmp/unreviewed-gitconfig',
    GIT_NO_REPLACE_OBJECTS: '0',
  }
  const before = Object.fromEntries(Object.keys(hostile).map((key) => [key, process.env[key]]))
  try {
    Object.assign(process.env, hostile)
    assert.equal(reviewedGitText(root, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}']), expected)
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

function reviewedGitIsAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  try {
    runReviewedGit(cwd, ['merge-base', '--is-ancestor', '--', ancestor, descendant])
    return true
  } catch {
    return false
  }
}

function failContextGate(code: string, message: string): never {
  throw Object.assign(new Error(`${code}: ${message}`), { code })
}

function requireContextGate(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) failContextGate(code, message)
}

function hasGateCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => Boolean(error && typeof error === 'object' && (error as Value).code === code)
}

function gateArtifactPath(base: string, relative: string, invalidCode: string): string {
  requireContextGate(
    relative.length > 0 && !path.isAbsolute(relative) && path.normalize(relative) === relative && !relative.startsWith(`..${path.sep}`),
    invalidCode,
    'gate artifact path is not a normalized repository-relative path',
  )
  const resolved = path.resolve(base, relative)
  requireContextGate(resolved.startsWith(`${path.resolve(base)}${path.sep}`), invalidCode, 'gate artifact path escapes its root')
  return resolved
}

async function readGateArtifact(base: string, relative: string, missingCode: string, invalidCode: string): Promise<Buffer> {
  const absolute = gateArtifactPath(base, relative, invalidCode)
  const components = relative.split(path.sep)
  for (let index = 0; index < components.length - 1; index += 1) {
    const component = path.join(base, ...components.slice(0, index + 1))
    let componentMetadata
    try {
      componentMetadata = await lstat(component)
    } catch {
      failContextGate(missingCode, `${relative} has a missing or unreadable ancestor`)
    }
    requireContextGate(!componentMetadata.isSymbolicLink(), 'context_symlink', `${relative} has a symbolic-link ancestor`)
    requireContextGate(componentMetadata.isDirectory(), invalidCode, `${relative} has a non-directory ancestor`)
  }
  let metadata
  try {
    metadata = await lstat(absolute)
  } catch {
    failContextGate(missingCode, `${relative} is missing or unreadable`)
  }
  requireContextGate(!metadata.isSymbolicLink(), 'context_symlink', `${relative} must not be a symbolic link`)
  requireContextGate(metadata.isFile(), invalidCode, `${relative} is not a regular file`)
  try {
    return await readFile(absolute)
  } catch {
    failContextGate(invalidCode, `${relative} is unreadable`)
  }
}

async function readGateJsonArtifact(
  base: string,
  relative: string,
  missingCode: string,
  invalidCode: string,
): Promise<{ bytes: Buffer; value: Value }> {
  const bytes = await readGateArtifact(base, relative, missingCode, invalidCode)
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) as Value }
  } catch {
    failContextGate(invalidCode, `${relative} is not valid JSON`)
  }
}

async function gateDirectoryNames(base: string, relative: string, code: string): Promise<string[]> {
  const absolute = gateArtifactPath(base, relative, code)
  const components = relative.split(path.sep)
  for (let index = 0; index < components.length; index += 1) {
    const component = path.join(base, ...components.slice(0, index + 1))
    let metadata
    try {
      metadata = await lstat(component)
    } catch {
      failContextGate(code, `${relative} has a missing or unreadable component`)
    }
    requireContextGate(!metadata.isSymbolicLink(), 'context_symlink', `${relative} has a symbolic-link component`)
    requireContextGate(metadata.isDirectory(), code, `${relative} has a non-directory component`)
  }
  try {
    return await readdir(absolute)
  } catch {
    failContextGate(code, `${relative} is missing or unreadable`)
  }
}

function reviewedGitGate(cwd: string, args: string[], code: string): Buffer {
  try {
    return runReviewedGit(cwd, args).stdout
  } catch {
    failContextGate(code, `reviewed Git command failed: ${args[0] ?? 'unknown'}`)
  }
}

function reviewedGitTextGate(cwd: string, args: string[], code: string): string {
  return reviewedGitGate(cwd, args, code).toString('utf8').trim()
}

function reviewedRemoteUrlDigest(cwd: string): string {
  const output = reviewedGitGate(cwd, ['remote', 'get-url', 'muqihang'], 'context_remote_origin_drift').toString('utf8')
  const value = output.replace(/\r?\n$/, '')
  requireContextGate(
    value.length > 0 && value.trim() === value && !/[\r\n]/.test(value),
    'context_remote_origin_drift',
    'muqihang remote URL output is not one canonical line',
  )
  return digest(value)
}

function reviewedGitStatusGate(cwd: string): string[] {
  return reviewedGitGate(
    cwd,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'],
    'context_dirty_tree',
  ).toString('utf8').split('\0').filter(Boolean)
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
}

function reviewedGitIsAncestorGate(cwd: string, ancestor: string, descendant: string): boolean {
  reviewedGitGate(cwd, ['rev-parse', '--verify', '--end-of-options', `${ancestor}^{commit}`], 'context_git_object_invalid')
  reviewedGitGate(cwd, ['rev-parse', '--verify', '--end-of-options', `${descendant}^{commit}`], 'context_git_object_invalid')
  return reviewedGitIsAncestor(cwd, ancestor, descendant)
}

function validateAuthorizedHeadTransition(
  previous: Value,
  current: Value,
  isAncestor: (repository: 'cc_gateway' | 'sub2api', ancestor: string, descendant: string) => boolean,
): void {
  for (const repository of ['cc_gateway', 'sub2api'] as const) {
    requireContextGate(
      isAncestor(
        repository,
        previous.repositories[repository].authorized_parent_head,
        current.repositories[repository].authorized_parent_head,
      ),
      'context_head_not_descendant',
      `${repository} authorized feature head does not descend from its predecessor`,
    )
  }
}

function validateObservedRemoteTransition(
  previous: Value,
  current: Value,
  isAncestor: (repository: 'cc_gateway' | 'sub2api', ancestor: string, descendant: string) => boolean,
): void {
  for (const repository of ['cc_gateway', 'sub2api'] as const) {
    requireContextGate(
      isAncestor(
        repository,
        previous.repositories[repository].observed_remote_main_head,
        current.repositories[repository].observed_remote_main_head,
      ),
      'context_remote_rewind',
      `${repository} observed remote rewound`,
    )
  }
}

function currentRemoteObservation(context: Value): Value {
  return {
    cc_remote_main: context.repositories.cc_gateway.observed_remote_main_head,
    sub2api_remote_main: context.repositories.sub2api.observed_remote_main_head,
    cc_branch: context.repositories.cc_gateway.implementation_branch,
    sub2api_branch: context.repositories.sub2api.implementation_branch,
    cc_remote_url_digest: context.repositories.cc_gateway.remote_url_digest,
    sub2api_remote_url_digest: context.repositories.sub2api.remote_url_digest,
    local_contract_digest: context.shared_contract.digest,
    remote_contract_digest: context.shared_contract.digest,
  }
}

function validateCurrentRemoteObservation(context: Value, observation: Value): void {
  requireContextGate(
    observation.cc_remote_main === context.repositories.cc_gateway.observed_remote_main_head
      && observation.sub2api_remote_main === context.repositories.sub2api.observed_remote_main_head,
    'context_remote_authority_drift',
    'current remote main differs from context binding',
  )
  requireContextGate(
    observation.cc_branch === context.repositories.cc_gateway.implementation_branch
      && observation.sub2api_branch === context.repositories.sub2api.implementation_branch,
    'context_branch_mismatch',
    'implementation branch differs from context binding',
  )
  requireContextGate(
    observation.cc_remote_url_digest === context.repositories.cc_gateway.remote_url_digest
      && observation.sub2api_remote_url_digest === context.repositories.sub2api.remote_url_digest,
    'context_remote_origin_drift',
    'muqihang remote URL digest differs from context binding',
  )
  requireContextGate(
    observation.local_contract_digest === context.shared_contract.digest
      && observation.remote_contract_digest === context.shared_contract.digest,
    'context_shared_contract_drift',
    'shared contract bytes differ from context binding',
  )
}

function selectedContextGateObservation(context: Value, gateMode: 'pre-commit' | 'post-commit'): Value {
  const initial = context.context_mode === 'initial'
  const expectedPreStatus = initial
    ? [`?? ${context.artifact_path}`, `?? ${context.approval_receipt.artifact.path}`].sort()
    : [`?? ${context.artifact_path}`]
  const artifactCommit = 'd'.repeat(40)
  return {
    gate_mode: gateMode,
    context: clone(context),
    selected_context_regular_file: true,
    selected_context_digest: digest(contextArtifactBytes(context)),
    approval_receipt_regular_file: true,
    cc_gateway_head: gateMode === 'pre-commit' ? context.repositories.cc_gateway.authorized_parent_head : artifactCommit,
    sub2api_head: context.repositories.sub2api.authorized_parent_head,
    cc_status: gateMode === 'pre-commit' ? expectedPreStatus : [],
    sub2api_status: [],
    cc_commit_parents: gateMode === 'post-commit' ? [context.repositories.cc_gateway.authorized_parent_head] : [],
    cc_commit_delta: gateMode === 'post-commit'
      ? (initial
          ? [`A\t${context.artifact_path}`, `A\t${context.approval_receipt.artifact.path}`].sort()
          : [`A\t${context.artifact_path}`])
      : [],
    committed_context_digest: gateMode === 'post-commit' ? digest(contextArtifactBytes(context)) : null,
    committed_review_digest: gateMode === 'post-commit' && initial ? context.approval_receipt.artifact.digest : null,
  }
}

function validateSelectedContextGateObservation(expectedContext: Value, observation: Value): void {
  const context = observation.context as Value
  requireContextGate(sameValue(context, expectedContext), 'context_binding_drift', 'selected context observation drifted')
  requireContextGate(observation.selected_context_regular_file === true, 'context_symlink', 'selected context is not a regular file')
  requireContextGate(observation.approval_receipt_regular_file === true, 'context_symlink', 'approval receipt is not a regular file')

  if (context.context_mode === 'initial') {
    for (const repository of ['cc_gateway', 'sub2api'] as const) {
      const state = context.repositories[repository]
      requireContextGate(
        state.authorized_parent_head === state.baseline_main_head
          && state.baseline_main_head === state.observed_remote_main_head,
        'context_initial_head_mismatch',
        `${repository} initial authorized, baseline, and observed remote heads differ`,
      )
    }
    requireContextGate(
      context.repositories.cc_gateway.authorized_parent_head === context.plan.reviewed_commit,
      'context_initial_head_mismatch',
      'initial CC authorized parent differs from reviewed plan commit',
    )
  }

  const expectedPreStatus = context.context_mode === 'initial'
    ? [`?? ${context.artifact_path}`, `?? ${context.approval_receipt.artifact.path}`].sort()
    : [`?? ${context.artifact_path}`]
  requireContextGate(sameValue(context.repositories.cc_gateway.validation_status.entries, expectedPreStatus), 'context_unexpected_delta', 'context does not bind exact pre-commit CC status')
  requireContextGate(sameValue(context.repositories.sub2api.validation_status.entries, []), 'context_unexpected_delta', 'context does not bind clean Sub2API status')
  const gateMode = observation.gate_mode
  requireContextGate(gateMode === 'pre-commit' || gateMode === 'post-commit', 'context_gate_mode_invalid', 'unknown task-boundary gate mode')
  requireContextGate(observation.sub2api_head === context.repositories.sub2api.authorized_parent_head, 'context_head_mismatch', 'Sub2API HEAD differs from authorized parent')
  requireContextGate(sameValue(observation.sub2api_status, []), 'context_dirty_tree', 'Sub2API must be clean')

  if (gateMode === 'pre-commit') {
    requireContextGate(observation.cc_gateway_head === context.repositories.cc_gateway.authorized_parent_head, 'context_head_mismatch', 'pre-commit CC HEAD differs from authorized parent')
    requireContextGate(sameValue(observation.cc_status, expectedPreStatus), 'context_dirty_tree', 'pre-commit CC status is not the exact authorization delta')
    return
  }

  requireContextGate(sameValue(observation.cc_status, []), 'context_dirty_tree', 'post-commit CC must be clean')
  requireContextGate(
    sameValue(observation.cc_commit_parents, [context.repositories.cc_gateway.authorized_parent_head]),
    'context_commit_parent_mismatch',
    'context artifact commit must have the authorized parent as its sole parent',
  )
  const expectedDelta = context.context_mode === 'initial'
    ? [`A\t${context.artifact_path}`, `A\t${context.approval_receipt.artifact.path}`].sort()
    : [`A\t${context.artifact_path}`]
  requireContextGate(sameValue(observation.cc_commit_delta, expectedDelta), 'context_unexpected_delta', 'context artifact commit delta is not exact')
  requireContextGate(observation.committed_context_digest === observation.selected_context_digest, 'predecessor_context_mutated', 'committed context bytes differ from working artifact bytes')
  if (context.context_mode === 'initial') {
    requireContextGate(observation.committed_review_digest === context.approval_receipt.artifact.digest, 'predecessor_context_mutated', 'committed approval bytes differ')
  }
}

function expectsGateCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => Boolean(error && typeof error === 'object' && (error as Value).code === code))
}

test('Phase 1 context task-boundary gate closes both repository lineage and post-commit topology', () => {
  const initial = executionContextFixture()
  const successor = successorExecutionContextFixture(initial, 1)
  assert.doesNotThrow(() => validateAuthorizedHeadTransition(initial, successor, () => true))
  expectsGateCode(
    () => validateAuthorizedHeadTransition(initial, successor, (repository) => repository !== 'sub2api'),
    'context_head_not_descendant',
  )
  assert.doesNotThrow(() => validateObservedRemoteTransition(initial, successor, () => true))
  expectsGateCode(
    () => validateObservedRemoteTransition(initial, successor, (repository) => repository !== 'sub2api'),
    'context_remote_rewind',
  )

  const initialPreCommit = selectedContextGateObservation(initial, 'pre-commit')
  assert.doesNotThrow(() => validateSelectedContextGateObservation(initial, initialPreCommit))
  const unrelatedInitialContext = clone(initial)
  unrelatedInitialContext.repositories.sub2api.authorized_parent_head = 'f'.repeat(40)
  const unrelatedInitialSub = selectedContextGateObservation(unrelatedInitialContext, 'pre-commit')
  expectsGateCode(() => validateSelectedContextGateObservation(unrelatedInitialContext, unrelatedInitialSub), 'context_initial_head_mismatch')

  const initialPostCommit = selectedContextGateObservation(initial, 'post-commit')
  assert.doesNotThrow(() => validateSelectedContextGateObservation(initial, initialPostCommit))
  for (const [mutation, code] of [
    [(value: Value) => { value.cc_commit_parents = ['f'.repeat(40)] }, 'context_commit_parent_mismatch'],
    [(value: Value) => { value.cc_commit_delta.push('A\tunrelated.txt') }, 'context_unexpected_delta'],
    [(value: Value) => { value.committed_context_digest = `sha256:${'f'.repeat(64)}` }, 'predecessor_context_mutated'],
    [(value: Value) => { value.selected_context_regular_file = false }, 'context_symlink'],
    [(value: Value) => { value.cc_status = ['?? stray.txt'] }, 'context_dirty_tree'],
    [(value: Value) => { value.sub2api_head = 'f'.repeat(40) }, 'context_head_mismatch'],
  ] as Array<[(value: Value) => void, string]>) {
    const changed = clone(initialPostCommit)
    mutation(changed)
    expectsGateCode(() => validateSelectedContextGateObservation(initial, changed), code)
  }
  const invalidGateMode = clone(initialPreCommit)
  invalidGateMode.gate_mode = 'other'
  expectsGateCode(() => validateSelectedContextGateObservation(initial, invalidGateMode), 'context_gate_mode_invalid')

  const remote = currentRemoteObservation(initial)
  assert.doesNotThrow(() => validateCurrentRemoteObservation(initial, remote))
  for (const [mutation, code] of [
    [(value: Value) => { value.sub2api_remote_main = 'f'.repeat(40) }, 'context_remote_authority_drift'],
    [(value: Value) => { value.cc_branch = 'wrong-branch' }, 'context_branch_mismatch'],
    [(value: Value) => { value.cc_remote_url_digest = `sha256:${'f'.repeat(64)}` }, 'context_remote_origin_drift'],
    [(value: Value) => { value.remote_contract_digest = `sha256:${'f'.repeat(64)}` }, 'context_shared_contract_drift'],
  ] as Array<[(value: Value) => void, string]>) {
    const changed = clone(remote)
    mutation(changed)
    expectsGateCode(() => validateCurrentRemoteObservation(initial, changed), code)
  }
})

test('Phase 1 live gate maps filesystem and reviewed-Git boundary failures to stable codes', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'phase1-context-gate-'))
  await mkdir(path.join(fixtureRoot, 'gate'))
  await writeFile(path.join(fixtureRoot, 'gate', 'valid.json'), '{"valid":true}\n')
  await writeFile(path.join(fixtureRoot, 'gate', 'malformed.json'), '{not-json}\n')
  await symlink('valid.json', path.join(fixtureRoot, 'gate', 'linked.json'))
  await symlink('gate', path.join(fixtureRoot, 'linked-gate'))

  await assert.rejects(
    readGateJsonArtifact(fixtureRoot, 'gate/missing.json', 'context_chain_gap', 'context_schema_invalid'),
    hasGateCode('context_chain_gap'),
  )
  await assert.rejects(
    readGateJsonArtifact(fixtureRoot, 'gate/malformed.json', 'context_chain_gap', 'context_schema_invalid'),
    hasGateCode('context_schema_invalid'),
  )
  await assert.rejects(
    readGateJsonArtifact(fixtureRoot, 'gate/linked.json', 'context_chain_gap', 'context_schema_invalid'),
    hasGateCode('context_symlink'),
  )
  await assert.rejects(
    readGateJsonArtifact(fixtureRoot, 'linked-gate/valid.json', 'context_chain_gap', 'context_schema_invalid'),
    hasGateCode('context_symlink'),
  )
  assert.deepEqual((await readGateJsonArtifact(fixtureRoot, 'gate/valid.json', 'context_chain_gap', 'context_schema_invalid')).value, { valid: true })
  assert.equal(reviewedRemoteUrlDigest(root), expectedRemoteUrlDigests.cc_gateway)
  expectsGateCode(
    () => reviewedGitGate(root, ['rev-parse', '--verify', '--end-of-options', 'refs/does-not-exist^{commit}'], 'context_remote_authority_drift'),
    'context_remote_authority_drift',
  )
})

async function liveExecutionContextChain(selectedPath: string, now: number): Promise<Value[]> {
  const directoryRelative = path.dirname(executionContextPath)
  const directoryNames = await gateDirectoryNames(root, directoryRelative, 'context_chain_gap')
  const names = directoryNames.filter((name) =>
    name === path.basename(executionContextPath) || /^phase-1-execution-context-[0-9]{4}\.json$/.test(name))
  const nearMatch = directoryNames.find((name) => name.startsWith('phase-1-execution-context') && !names.includes(name))
  requireContextGate(nearMatch === undefined, 'context_sequence_mismatch', `unexpected context-like path ${nearMatch}`)
  const schemaArtifact = await readGateJsonArtifact(root, executionContextSchemaPath, 'context_schema_invalid', 'context_schema_invalid')
  requireContextGate(digest(schemaArtifact.bytes) === expectedGateSchemaDigests.execution_context, 'context_schema_binding_drift', 'execution-context schema bytes differ from the reviewed gate engine')
  let validator: ReturnType<typeof compile>
  try {
    validator = compile(schemaArtifact.value)
  } catch {
    failContextGate('context_schema_invalid', 'execution-context schema cannot be compiled')
  }
  const contexts: Value[] = []
  for (const name of names) {
    const relative = path.posix.join(path.posix.dirname(executionContextPath), name)
    const artifact = await readGateJsonArtifact(root, relative, 'context_chain_gap', 'context_schema_invalid')
    const value = artifact.value
    requireContextGate(validator(value), 'context_schema_invalid', `${relative}: ${JSON.stringify(validator.errors)}`)
    requireContextGate(value.artifact_path === relative, 'context_sequence_mismatch', `${relative} does not match artifact_path`)
    contexts.push(value)
  }
  contexts.sort((left, right) => left.sequence - right.sequence)
  requireContextGate(contexts.length > 0, 'context_chain_gap', 'execution context chain is empty')
  requireContextGate(
    sameValue(contexts.map((value) => value.sequence), Array.from({ length: contexts.length }, (_, index) => index)),
    'context_chain_gap',
    'execution context sequence is not contiguous',
  )
  requireContextGate(contexts.at(-1)!.artifact_path === selectedPath, 'stale_execution_context', 'selected context is not the latest chain head')

  const initial = contexts[0]
  for (let index = 0; index < contexts.length; index += 1) {
    const value = contexts[index]
    requireContextGate(value.artifact_path === executionContextPathFor(index), 'context_sequence_mismatch', 'artifact path does not match sequence')
    const generated = Date.parse(value.generated_at)
    const expires = Date.parse(value.expires_at)
    requireContextGate(Number.isFinite(generated) && Number.isFinite(expires) && expires > generated && expires - generated <= 24 * 60 * 60 * 1000, 'context_window_invalid', 'execution context window is invalid')
    requireContextGate(generated <= now + maxContextClockSkewMs, 'context_future_timestamp', 'execution context is future-dated')
    requireContextGate(executionContextBindings(value), 'context_binding_drift', 'execution context approval binding drifted')
    for (const field of ['plan', 'planning_provenance', 'approval_receipt', 'gate_schemas', 'shared_contract', 'authority_order', 'selected_requirements', 'implementation_entry', 'disabled_capabilities']) {
      requireContextGate(sameValue(value[field], initial[field]), 'context_binding_drift', `${field} drifted across context chain`)
    }
    for (const repository of Object.values(value.repositories) as Value[]) {
      const entries = repository.validation_status.entries as string[]
      requireContextGate(sameValue(entries, [...entries].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))), 'context_unexpected_delta', 'validation status is not canonical')
      requireContextGate(repository.validation_status.digest === digest(Buffer.from(entries.join('\0'))), 'context_unexpected_delta', 'validation status digest drifted')
      requireContextGate(repository.pre_issue_clean === true, 'context_dirty_tree', 'pre-issue repository was not clean')
    }
    if (index === 0) continue

    const previous = contexts[index - 1]
    validateAuthorizedHeadTransition(previous, value, (repository, ancestor, descendant) => reviewedGitIsAncestorGate(
      repository === 'cc_gateway' ? root : String(process.env.SUB2API_ROOT),
      ancestor,
      descendant,
    ))
    requireContextGate(value.predecessor.sequence === previous.sequence, 'context_chain_gap', 'predecessor sequence is not contiguous')
    requireContextGate(value.predecessor.path === previous.artifact_path, 'context_chain_gap', 'predecessor path does not bind previous context')
    requireContextGate(value.predecessor.stage === previous.stage, 'context_stage_regression', 'predecessor stage binding drifted')
    requireContextGate(value.predecessor.digest === digest(await readGateArtifact(root, previous.artifact_path, 'context_chain_gap', 'predecessor_context_mutated')), 'predecessor_context_mutated', 'predecessor bytes drifted')
    requireContextGate(executionContextStages.indexOf(value.stage) >= executionContextStages.indexOf(previous.stage), 'context_stage_regression', 'context stage regressed')
    requireContextGate(Date.parse(value.generated_at) >= Date.parse(previous.generated_at), 'context_timestamp_regression', 'context timestamp regressed')
    for (const name of ['cc_gateway', 'sub2api']) {
      requireContextGate(value.repositories[name].baseline_main_head === initial.repositories[name].baseline_main_head, 'context_binding_drift', `${name} baseline drifted`)
      for (const field of ['remote_name', 'remote_url_digest', 'tracking_ref', 'implementation_branch']) {
        requireContextGate(value.repositories[name][field] === initial.repositories[name][field], 'context_binding_drift', `${name} ${field} drifted`)
      }
    }
    validateObservedRemoteTransition(previous, value, (repository, ancestor, descendant) => reviewedGitIsAncestorGate(
      repository === 'cc_gateway' ? root : String(process.env.SUB2API_ROOT),
      ancestor,
      descendant,
    ))

    const artifactCommit = value.predecessor.artifact_commit
    requireContextGate(reviewedGitIsAncestorGate(root, artifactCommit, value.repositories.cc_gateway.authorized_parent_head), 'context_head_not_descendant', 'CC authorized parent does not descend from predecessor artifact commit')
    const committedBytes = reviewedGitGate(root, ['show', '--format=', '--no-ext-diff', '--no-textconv', `${artifactCommit}:${previous.artifact_path}`], 'predecessor_context_mutated')
    requireContextGate(digest(committedBytes) === value.predecessor.digest, 'predecessor_context_mutated', 'committed predecessor bytes drifted')
    const parents = reviewedGitTextGate(root, ['rev-list', '--parents', '-n', '1', artifactCommit], 'context_git_object_invalid').split(/\s+/)
    requireContextGate(parents.length === 2 && parents[1] === previous.repositories.cc_gateway.authorized_parent_head, 'context_commit_parent_mismatch', 'predecessor context commit parent is not exact')
    const delta = reviewedGitTextGate(root, ['diff-tree', '--no-commit-id', '--name-status', '-r', artifactCommit], 'context_git_object_invalid').split('\n').filter(Boolean).sort()
    const expectedDelta = previous.sequence === 0
      ? [`A\t${previous.artifact_path}`, 'A\tdocs/superpowers/evidence/phase-1/phase-1-plan-review.json'].sort()
      : [`A\t${previous.artifact_path}`]
    requireContextGate(sameValue(delta, expectedDelta), 'context_unexpected_delta', 'predecessor context commit delta mismatch')
    const laterChanges = reviewedGitTextGate(root, ['log', '--format=%H', `${artifactCommit}..${value.repositories.cc_gateway.authorized_parent_head}`, '--', previous.artifact_path], 'context_git_object_invalid')
    requireContextGate(laterChanges === '', 'predecessor_context_mutated', 'predecessor context changed after its artifact commit')
    if (previous.sequence === 0) {
      const reviewPath = previous.approval_receipt.artifact.path
      const committedReviewBytes = reviewedGitGate(root, ['show', '--format=', '--no-ext-diff', '--no-textconv', `${artifactCommit}:${reviewPath}`], 'predecessor_context_mutated')
      requireContextGate(digest(committedReviewBytes) === previous.approval_receipt.artifact.digest, 'predecessor_context_mutated', 'plan approval commit bytes drifted')
      const laterReviewChanges = reviewedGitTextGate(root, ['log', '--format=%H', `${artifactCommit}..${value.repositories.cc_gateway.authorized_parent_head}`, '--', reviewPath], 'context_git_object_invalid')
      requireContextGate(laterReviewChanges === '', 'predecessor_context_mutated', 'plan approval receipt mutated after authorization')
    }
  }
  requireContextGate(Date.parse(contexts.at(-1)!.generated_at) <= now, 'context_not_yet_valid', 'latest execution context validity has not started')
  requireContextGate(Date.parse(contexts.at(-1)!.expires_at) > now, 'stale_execution_context', 'latest execution context is expired')
  return contexts
}

test('required Phase 1 execution context binds live bytes, approval, expiry, and both main heads', async (t) => {
  if (process.env.PHASE1_REQUIRE_EXECUTION_CONTEXT !== '1') {
    t.skip('execution context is created just in time after the reviewed plan merges')
    return
  }
  const sub2apiRoot = process.env.SUB2API_ROOT
  requireContextGate(typeof sub2apiRoot === 'string' && sub2apiRoot.length > 0, 'context_gate_mode_invalid', 'SUB2API_ROOT is required')
  const contextMode = process.env.PHASE1_EXECUTION_CONTEXT_MODE
  const gateMode = process.env.PHASE1_EXECUTION_CONTEXT_GATE
  const selectedPath = process.env.PHASE1_EXECUTION_CONTEXT_PATH
  requireContextGate(contextMode === 'initial' || contextMode === 'successor', 'context_gate_mode_invalid', 'PHASE1_EXECUTION_CONTEXT_MODE must be initial or successor')
  requireContextGate(gateMode === 'pre-commit' || gateMode === 'post-commit', 'context_gate_mode_invalid', 'PHASE1_EXECUTION_CONTEXT_GATE must be pre-commit or post-commit')
  requireContextGate(typeof selectedPath === 'string' && selectedPath.length > 0, 'context_gate_mode_invalid', 'PHASE1_EXECUTION_CONTEXT_PATH is required')
  const contexts = await liveExecutionContextChain(selectedPath, Date.now())
  const context = contexts.at(-1)!
  requireContextGate(context.context_mode === contextMode, 'context_gate_mode_invalid', 'selected context mode does not match requested mode')
  if (contextMode === 'initial') {
    requireContextGate(contexts.length === 1, 'context_chain_gap', 'initial mode must contain only sequence zero')
    requireContextGate(process.env.PHASE1_PREVIOUS_EXECUTION_CONTEXT_PATH === undefined, 'context_gate_mode_invalid', 'initial mode forbids predecessor path')
  } else {
    requireContextGate(contexts.length > 1, 'context_chain_gap', 'successor mode requires a predecessor')
    requireContextGate(process.env.PHASE1_PREVIOUS_EXECUTION_CONTEXT_PATH === contexts.at(-2)!.artifact_path, 'context_chain_gap', 'declared predecessor is not immediate')
  }
  const selectedArtifact = await readGateJsonArtifact(root, selectedPath, 'context_chain_gap', 'context_schema_invalid')
  const reviewArtifact = await readGateJsonArtifact(root, context.approval_receipt.artifact.path, 'context_approval_invalid', 'context_approval_invalid')
  const review = reviewArtifact.value
  const reviewSchemaArtifact = await readGateJsonArtifact(root, planReviewSchemaPath, 'context_approval_invalid', 'context_approval_invalid')
  requireContextGate(digest(reviewSchemaArtifact.bytes) === expectedGateSchemaDigests.plan_review, 'context_schema_binding_drift', 'plan-review schema bytes differ from the reviewed gate engine')
  let reviewValidator: ReturnType<typeof compile>
  try {
    reviewValidator = compile(reviewSchemaArtifact.value)
  } catch {
    failContextGate('context_approval_invalid', 'plan-review schema cannot be compiled')
  }
  requireContextGate(reviewValidator(review), 'context_approval_invalid', JSON.stringify(reviewValidator.errors))
  requireContextGate(executionContextBindings(context), 'context_binding_drift', 'execution context approval binding drifted')
  const currentPlanBytes = await readGateArtifact(root, context.plan.path, 'context_binding_drift', 'context_binding_drift')
  const reviewedPlanBytes = reviewedGitGate(root, ['show', '--format=', '--no-ext-diff', '--no-textconv', `${context.plan.reviewed_commit}:${context.plan.path}`], 'context_binding_drift')
  const remotePlanBytes = reviewedGitGate(root, ['show', '--format=', '--no-ext-diff', '--no-textconv', `${context.repositories.cc_gateway.observed_remote_main_head}:${context.plan.path}`], 'context_remote_authority_drift')
  requireContextGate(context.plan.digest === digest(currentPlanBytes), 'context_binding_drift', 'current plan bytes drifted')
  requireContextGate(context.plan.digest === digest(reviewedPlanBytes), 'context_binding_drift', 'reviewed plan bytes drifted')
  requireContextGate(context.plan.digest === digest(remotePlanBytes), 'context_remote_authority_drift', 'remote plan bytes drifted')
  for (const binding of Object.values(context.gate_schemas) as Value[]) {
    const expectedDigest = binding.path === executionContextSchemaPath
      ? expectedGateSchemaDigests.execution_context
      : expectedGateSchemaDigests.plan_review
    requireContextGate(binding.digest === expectedDigest, 'context_schema_binding_drift', `${binding.path} context binding drifted`)
    requireContextGate(binding.digest === digest(await readGateArtifact(root, binding.path, 'context_schema_binding_drift', 'context_schema_binding_drift')), 'context_schema_binding_drift', `${binding.path} working bytes drifted`)
    const reviewedSchemaBytes = reviewedGitGate(root, ['show', '--format=', '--no-ext-diff', '--no-textconv', `${context.plan.reviewed_commit}:${binding.path}`], 'context_schema_binding_drift')
    const remoteSchemaBytes = reviewedGitGate(root, ['show', '--format=', '--no-ext-diff', '--no-textconv', `${context.repositories.cc_gateway.observed_remote_main_head}:${binding.path}`], 'context_remote_authority_drift')
    requireContextGate(binding.digest === digest(reviewedSchemaBytes), 'context_schema_binding_drift', `${binding.path} reviewed bytes drifted`)
    requireContextGate(binding.digest === digest(remoteSchemaBytes), 'context_remote_authority_drift', `${binding.path} remote bytes drifted`)
  }
  requireContextGate(context.approval_receipt.artifact.digest === digest(reviewArtifact.bytes), 'context_binding_drift', 'approval receipt bytes drifted')
  requireContextGate(sameValue(review.plan, context.plan), 'context_binding_drift', 'review plan binding drifted')
  requireContextGate(review.reviewer_id === context.approval_receipt.reviewer_id, 'context_binding_drift', 'reviewer binding drifted')
  requireContextGate(review.review_round === context.approval_receipt.review_round, 'context_binding_drift', 'review round drifted')
  requireContextGate(review.decision === context.approval_receipt.decision, 'context_binding_drift', 'review decision drifted')
  requireContextGate(review.finding_counts.critical === context.approval_receipt.critical_findings, 'context_binding_drift', 'critical finding count drifted')
  requireContextGate(review.finding_counts.important === context.approval_receipt.important_findings, 'context_binding_drift', 'important finding count drifted')
  requireContextGate(context.planning_provenance.entry.digest === digest(await readGateArtifact(root, context.planning_provenance.entry.path, 'context_binding_drift', 'context_binding_drift')), 'context_binding_drift', 'planning entry bytes drifted')
  requireContextGate(context.planning_provenance.context.digest === digest(await readGateArtifact(root, context.planning_provenance.context.path, 'context_binding_drift', 'context_binding_drift')), 'context_binding_drift', 'planning context bytes drifted')
  for (const binding of context.authority_order as Value[]) {
    requireContextGate(binding.digest === digest(await readGateArtifact(root, binding.path, 'context_binding_drift', 'context_binding_drift')), 'context_binding_drift', `${binding.path} bytes drifted`)
    const remoteBytes = reviewedGitGate(root, ['show', '--format=', '--no-ext-diff', '--no-textconv', `${context.repositories.cc_gateway.observed_remote_main_head}:${binding.path}`], 'context_remote_authority_drift')
    requireContextGate(binding.digest === digest(remoteBytes), 'context_remote_authority_drift', `remote authority drift: ${binding.path}`)
  }
  const ccRemoteMain = reviewedGitTextGate(root, ['rev-parse', '--verify', '--end-of-options', 'refs/remotes/muqihang/main^{commit}'], 'context_remote_authority_drift')
  const subRemoteMain = reviewedGitTextGate(sub2apiRoot, ['rev-parse', '--verify', '--end-of-options', 'refs/remotes/muqihang/main^{commit}'], 'context_remote_authority_drift')
  const remoteObservation = currentRemoteObservation(context)
  remoteObservation.cc_remote_main = ccRemoteMain
  remoteObservation.sub2api_remote_main = subRemoteMain
  remoteObservation.cc_branch = reviewedGitTextGate(root, ['branch', '--show-current'], 'context_branch_mismatch')
  remoteObservation.sub2api_branch = reviewedGitTextGate(sub2apiRoot, ['branch', '--show-current'], 'context_branch_mismatch')
  remoteObservation.cc_remote_url_digest = reviewedRemoteUrlDigest(root)
  remoteObservation.sub2api_remote_url_digest = reviewedRemoteUrlDigest(sub2apiRoot)
  const ccHead = reviewedGitTextGate(root, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'], 'context_git_object_invalid')
  const subHead = reviewedGitTextGate(sub2apiRoot, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'], 'context_git_object_invalid')
  const gateObservation = selectedContextGateObservation(context, gateMode)
  gateObservation.context = clone(context)
  gateObservation.selected_context_regular_file = true
  gateObservation.selected_context_digest = digest(selectedArtifact.bytes)
  gateObservation.approval_receipt_regular_file = true
  gateObservation.cc_gateway_head = ccHead
  gateObservation.sub2api_head = subHead
  gateObservation.cc_status = reviewedGitStatusGate(root)
  gateObservation.sub2api_status = reviewedGitStatusGate(sub2apiRoot)
  if (gateMode === 'post-commit') {
    gateObservation.cc_commit_parents = reviewedGitTextGate(root, ['rev-list', '--parents', '-n', '1', ccHead], 'context_commit_parent_mismatch').split(/\s+/).slice(1)
    gateObservation.cc_commit_delta = reviewedGitTextGate(root, ['diff-tree', '--no-commit-id', '--name-status', '-r', ccHead], 'context_unexpected_delta').split('\n').filter(Boolean).sort()
    gateObservation.committed_context_digest = digest(reviewedGitGate(root, ['show', '--format=', '--no-ext-diff', '--no-textconv', `${ccHead}:${selectedPath}`], 'predecessor_context_mutated'))
    gateObservation.committed_review_digest = contextMode === 'initial'
      ? digest(reviewedGitGate(root, ['show', '--format=', '--no-ext-diff', '--no-textconv', `${ccHead}:${context.approval_receipt.artifact.path}`], 'predecessor_context_mutated'))
      : null
  }
  validateSelectedContextGateObservation(context, gateObservation)

  const contractPath = context.shared_contract.path
  const localContractBytes = await readGateArtifact(sub2apiRoot, contractPath, 'context_shared_contract_drift', 'context_shared_contract_drift')
  const remoteContractBytes = reviewedGitGate(sub2apiRoot, ['show', '--format=', '--no-ext-diff', '--no-textconv', `${subRemoteMain}:${contractPath}`], 'context_shared_contract_drift')
  remoteObservation.local_contract_digest = digest(localContractBytes)
  remoteObservation.remote_contract_digest = digest(remoteContractBytes)
  validateCurrentRemoteObservation(context, remoteObservation)
})

test('Phase 1 planning context binds the exact entry bytes and governing source bytes', async () => {
  const context = await json(contextPath)
  assert.equal(context.entry.digest, digest(await readFile(path.join(root, entryPath))))
  for (const binding of [...context.authority_order, ...Object.values(context.registries)] as Value[]) {
    assert.equal(binding.digest, digest(await readFile(path.join(root, binding.path))), binding.path)
  }
})

test('Phase 1 plan classifies exact consumed-proof replay after owner but before version and state', async () => {
  const plan = await readFile(path.join(root, planPath), 'utf8')
  const ownerCheck = plan.indexOf('authority, snap, err := s.authorizeBrowserEgressOwner(ctx, id)')
  const replayCheck = plan.indexOf('if proof != "" && consumedBrowserProofMatches(snap, proof)')
  const versionAndStateCheck = plan.indexOf('snap, err = s.authorizeBrowserEgressVersionAndState(')

  assert(ownerCheck >= 0, 'browser egress owner authorization is missing')
  assert(replayCheck > ownerCheck, 'consumed-proof replay must follow owner authorization')
  assert(versionAndStateCheck > replayCheck, 'consumed-proof replay must precede version/state checks')
  assert.match(plan, /owner, exact consumed proof, old consume-input version \| `FORMAL_POOL_BROWSER_PROOF_REJECTED`/)
  assert.match(plan, /owner, exact consumed proof, current post-consume version \| `FORMAL_POOL_BROWSER_PROOF_REJECTED`/)
  assert.match(plan, /different owner, exact consumed proof, either version \| `FORMAL_POOL_FORBIDDEN`/)
  assert.match(plan, /owner, different proof, old consume-input version \| `FORMAL_POOL_ONBOARDING_VERSION_CONFLICT`/)
})

test('Phase 1 plan proves defensive startProxy ordering and exact RED leaf inventories', async () => {
  const plan = await readFile(path.join(root, planPath), 'utf8')
  const listenerValidation = plan.indexOf('const listenerBoundary = resolveListenerBoundary(config)')
  const upstreamValidation = plan.indexOf('const upstreamTLSBoundary = resolveUpstreamTLSBoundary(config, process.env)')
  const tlsRead = plan.indexOf('cert: startup.readTLSFile(config.server.tls.cert)')
  const httpsCreate = plan.indexOf('startup.createHTTPSServer(tlsOptions, handler)')
  const httpCreate = plan.indexOf('startup.createHTTPServer(handler)')
  const listen = plan.indexOf('startup.listen(server, config.server.port, listenerBoundary.host, onListening)')

  assert(listenerValidation >= 0 && upstreamValidation > listenerValidation, 'both defensive resolvers must be explicit')
  assert(tlsRead > upstreamValidation, 'startup validation must precede TLS reads')
  assert(httpsCreate > tlsRead && httpCreate > tlsRead, 'startup validation must precede both server constructors')
  assert(listen > httpCreate, 'startup validation must precede listen')
  assert.match(plan, /startProxy\(mutate\(remoteConfig\(\)\), observed\.primitives\)/)
  assert.match(plan, /assert\.deepEqual\(observed\.calls, \[\]\)/)
  assert.match(plan, /failure families \[B4,B5,B6\]/)
  assert.match(plan, /failure families \[TestPhase0B5,TestPhase0B6\]/)
  assert.match(plan, /failure_parser: null \| Phase1FailureParser/)
  assert.match(plan, /expected_failure_count: number/)
  assert.match(plan, /expected_failure_names: string\[\]/)
  assert.match(plan, /expected_parser_lifecycle: null \| Phase1ParserLifecycle/)
  assert.match(plan, /failure_event_count: number/)
  assert.match(plan, /failure_event_names: string\[\]/)
  assert.match(plan, /failure_count: number/)
  assert.match(plan, /node_test_tap_v1/)
  assert.match(plan, /go_test_json_leaf_v1/)
  assert.match(plan, /All safe leaf events, including repeats, are UTF-8-byte-sorted into deterministic `failure_event_names`/)
  assert.match(plan, /Missing, added same-prefix, duplicate, reordered persisted multiset\/unique array/)
  assert.match(plan, /validatePhase1IntegrationEntryValue.*buildPhase1Handoff.*validatePhase1HandoffValue.*buildPhase1IntegrationReceipt/s)

  const inventory = phase1RedInventory(plan)
  assert.deepEqual(Object.keys(inventory), Object.keys(expectedRedInventory))
  assert.equal(digest(JSON.stringify(inventory)), expectedRedInventoryDigest)
  for (const [commandID, expected] of Object.entries(expectedRedInventory)) {
    const row = inventory[commandID]
    const names = row.expected_failure_names as string[]
    assert.deepEqual(Object.keys(row), expectedRedRowKeys)
    assert.equal(row.failure_parser, expected.failure_parser)
    assert.deepEqual(row.expected_parser_lifecycle, expected.expected_parser_lifecycle)
    assert.equal(row.expected_failure_count, expected.expected_failure_count)
    assert.deepEqual(row.expected_failure_families, expected.expected_failure_families)
    assert.equal(names.length, expected.expected_failure_count)
    assert.equal(new Set(names).size, names.length)
    assert.deepEqual(names, canonicalFailureNames(names))
    assert.equal(digest(JSON.stringify(names)), expected.names_digest)
    assert.deepEqual([...new Set(names.map(failureFamily))], row.expected_failure_families)
    assert.equal(names.includes('unclassified'), false)
  }
  assert.match(plan, /const host = configuredHost === '\[::1\]' \? '::1' : configuredHost/)
  assert.match(plan, /createHTTPServer: \(handler: ProxyRequestListener\) => ReturnType<typeof createHttpServer>/)
  assert.match(plan, /createHTTPSServer: \(options: ServerOptions, handler: ProxyRequestListener\) => ReturnType<typeof createHttpsServer>/)
  assert.match(plan, /createHTTPServer: createHttpServer/)
  assert.match(plan, /createHTTPSServer: createHttpsServer/)
})

test('Phase 1 plan freezes the complete authorization matrix and executable task boundaries', async () => {
  const plan = await readFile(path.join(root, planPath), 'utf8')
  assert.match(plan, /exact 15 existing non-public object operations/)
  assert.match(plan, /`GetSession`, `TestProxy`, `BrowserEgressAttestation`/)
  assert.match(plan, /`CreateSession` is a separately frozen sixteenth route/)
  assert.match(plan, /Each operation must execute every row in `formalPoolAuthorityCases`/)
  for (const required of [
    'active ordinary user, creator and non-creator',
    'would-be group administrator: active non-admin JWT with existing `AllowedGroups`',
    'would-be tenant administrator: active non-admin JWT with same/cross requested tenant labels',
    'initially revoked session; initially expired session',
    'service-to-service/admin-API-key caller',
    'concurrent user status, role, or token-version change after JWT middleware',
    'duplicated OAuth callback and concurrent promote',
  ]) assert(plan.includes(required), required)
  assert.match(plan, /owner mismatch, stale version, and wrong state are simultaneously true/)
  assert.match(plan, /proxy\/OAuth\/account\/healthcheck\/cache\/scheduler dependency counter at zero/)
  assert.match(plan, /FormalPoolOnboardingJWTAuthMiddleware/)
  assert.match(plan, /RegisterFormalPoolOnboardingAdminRoutes/)
  assert.match(plan, /FormalPoolOnboardingPrincipalGuard/)
  assert.doesNotMatch(plan, /WithFormalPoolOnboardingPrincipalResolver/)
  assert.match(plan, /No handler method or constructor stores or calls `FormalPoolOnboardingPrincipalResolver`/)
  assert.match(plan, /No handler method or constructor stores or calls `FormalPoolOnboardingPrincipalRevalidator`/)
  assert.match(plan, /AdminComplianceGuard\(settingService\)/)
  assert.match(plan, /ordinary unacknowledged JWT still receives the onboarding common 403/)
  assert.match(plan, /423 ADMIN_COMPLIANCE_ACK_REQUIRED/)
  assert.match(plan, /`AuthSubject` safe claims snapshot/)
  assert.match(plan, /Phase 1 does not invent new role tables, tenant grants, or group-policy persistence/)
  assert.match(plan, /`AllowedGroups` is a binding permission, not an administrator grant/)
  assert.match(plan, /FormalPoolOnboardingGroupReader/)
  assert.match(plan, /Groups: &formalGroupReaderFake/)
  assert.match(plan, /const CallerKindHumanJWT = "human_jwt"/)
  assert.match(plan, /CallerKind: service\.CallerKindHumanJWT/)
  assert.match(plan, /backend\/cmd\/server\/wire_gen\.go/)
  assert.match(plan, /go generate \.\/cmd\/server/)
  assert.match(plan, /go test \.\/cmd\/server -count=1/)
  assert.match(plan, /AuthorityRevision/)
  assert.match(plan, /svc\.authorizeSession\(ctx, session\.ID, true, FormalPoolOnboardingStatusWarming\)/)
  assert.match(plan, /formal_pool_onboarding_flow_test\.go/)
  assert.match(plan, /Task 4 adds only server-proof auto-finalization behavior/)

  assert.match(plan, /type FormalPoolOnboardingPrincipalRevalidator interface/)
  assert.match(plan, /Revalidate\(ctx context\.Context, principal FormalPoolOnboardingPrincipal\) error/)
  assert.match(plan, /PrincipalRevalidator FormalPoolOnboardingPrincipalRevalidator/)
  assert.match(plan, /The guard's single `Resolve` is the pre-compliance authorization oracle; it does not satisfy reservation-adjacent current-authority revalidation/)
  assert.match(plan, /static owner comparison -> service-level principal revalidation -> expected-version requirement -> expected-version equality -> allowed-state membership/)
  assert.match(plan, /`authorizeSession`, `authorizeAccount`, and `authorizeBrowserEgressOwner` each perform exactly one reservation-adjacent revalidation/)
  assert.match(plan, /`authorizeCreate` performs two live revalidation calls/)
  assert.match(plan, /blocking `FormalPoolOnboardingGroupReader`/)
  assert.match(plan, /first revalidation and the group lookup, revokes or changes the principal while the group read is blocked, then releases it/)
  assert.match(plan, /buffers both the group value and lookup error without classifying or returning/)
  assert.match(plan, /second revalidation runs regardless of whether the buffered result is success, error, missing, or inactive/)
  assert.match(plan, /Only after the second revalidation succeeds may creation classify the buffered group result/)
  assert.match(plan, /Missing, malformed, expired, revoked, inactive, token-version-changed, and non-human\/service authorities map to the common 401/)
  assert.match(plan, /static-owner, tenant-envelope, and current-role mismatches map to the common 403/)
  assert.match(plan, /No `FormalPoolOnboardingHandler` business method or constructor parses credentials or stores or calls either interface/)
  assert.match(plan, /context -> record -> static owner -> service-level principal revalidation -> consumed-proof replay -> expected-version -> allowed-state -> remaining-proof-validation -> CAS/)
  assert.match(plan, /after the principal guard succeeds but before the service revalidator runs/)
  assert.match(plan, /CAS reservation, proxy, OAuth, account, healthcheck, cache, and scheduler counters all remain zero/)
  assert.match(plan, /func NewFormalPoolOnboardingPrincipalResolver\(users \*service\.UserService, tenantID string, now func\(\) time\.Time\) FormalPoolOnboardingPrincipalResolver/)
  assert.match(plan, /func NewFormalPoolOnboardingPrincipalRevalidator\(users \*service\.UserService, tenantID string, now func\(\) time\.Time\) service\.FormalPoolOnboardingPrincipalRevalidator/)
  assert.match(plan, /admin\.NewFormalPoolOnboardingPrincipalResolver\(userService, cfg\.FormalPool\.AuthorityTenantID, time\.Now\)/)
  assert.match(plan, /admin\.NewFormalPoolOnboardingPrincipalRevalidator\(userService, cfg\.FormalPool\.AuthorityTenantID, time\.Now\)/)
  assert.match(plan, /if r == nil \|\| r\.users == nil \|\| r\.now == nil \|\| c == nil \|\| c\.Request == nil/)
  assert.match(plan, /if r == nil \|\| r\.users == nil \|\| r\.now == nil \|\| ctx == nil \{/)
  assert.match(plan, /nil receiver, nil user service, nil clock, nil Gin context, and nil Gin request/)
  assert.match(plan, /empty `AuthorityTenantID` returns the common 403 from `Resolve` before compliance/)
  assert.match(plan, /valid-shaped principal with empty tenant returns 403 with zero user-repository fetch/)
  assert.match(plan, /unacknowledged system-admin JWT with empty tenant configuration still receives 403 with zero compliance, handler, service, and dependency calls/)
  assert.match(plan, /go test \.\/internal\/service -count=1/)
  assert.match(plan, /initially expired or revoked JWT is rejected by middleware\/guard before compliance or record lookup/)
  assert.match(plan, /post-guard change for a statically matching owner is rejected after record\/static-owner checks but before version, state, CAS, or dependency work/)
  assert.doesNotMatch(plan, /current user status\/role\/token-version revalidation through the Task 2 resolver/)
  assert.doesNotMatch(plan, /Before state\/version evaluation, the handler resolver re-fetches the current user/)

  const task2 = plan.slice(plan.indexOf('### Task 2:'), plan.indexOf('### Task 3:'))
  const task4 = plan.slice(plan.indexOf('### Task 4:'), plan.indexOf('### Task 5:'))
  assert.match(task2, /ClaudeFormalPoolOnboardingWizard\.vue/)
  assert.match(task2, /ClaudeFormalPoolOnboardingWizardV2\.vue/)
  assert.match(task2, /npm run typecheck/)
  assert.doesNotMatch(task4.slice(task4.lastIndexOf('git add')), /frontend\/src\/api\/admin\/claudeOnboarding\.ts/)
})

test('Phase 1 H1 rejects unrelated RED leaves and proxy-only network controls', async () => {
  const plan = await readFile(path.join(root, planPath), 'utf8')
  assert.match(plan, /CC_RED_FAILURE_NAMES\.slice\(1\)/)
  assert.match(plan, /B4 invented same-prefix leaf/)
  assert.match(plan, /\[\.\.\.CC_RED_FAILURE_NAMES, CC_RED_FAILURE_NAMES\[0\]\]/)
  assert.match(plan, /\[\.\.\.CC_RED_FAILURE_NAMES\]\.reverse\(\)/)
  assert.match(plan, /unclassified_failure_names/)
  assert.match(plan, /--test-reporter=tap/)
  assert.match(plan, /--test-name-pattern=\^\(B4\|B5\|B6\)\(\\\\s\|\$\)/)
  assert.match(plan, /go test -json -tags=phase0red/)
  assert.match(plan, /-run \^TestPhase0B\[56\]/)
  assert.match(plan, /allowed failing prefixes \[B4 ,B5 ,B6 \]/)
  assert.match(plan, /`\/usr\/bin\/sandbox-exec`/)
  assert.match(plan, /remote tcp "localhost:\*"/)
  assert.match(plan, /local tcp "localhost:\*"/)
  assert.match(plan, /fails with `EPERM` or `EACCES`/)
  assert.match(plan, /198\.51\.100\.1/)
  assert.match(plan, /network_sandbox_unavailable/)
  assert.match(plan, /there is no proxy-only degraded mode/)
  assert.match(plan, /only through `wrapPhase1Command`/)
  assert.match(plan, /SUB2API_ROOT=\$\{SUB2API_CONTRACT_ROOT\}/)
  assert.match(plan, /only `cc-b4-b6-red` overrides it with `\$\{SUB2API_CONTRACT_ROOT\}`/)
  assert.match(plan, /separate clean local Git clone/)
  assert.match(plan, /local branch name exactly `main`/)
  assert.match(plan, /do not use `git worktree`/)
  assert.match(plan, /Phase1ContractRootBinding/)
  assert.match(plan, /clone_kind: 'independent_clone'/)
  assert.match(plan, /origin_url_digest: string/)
  assert.match(plan, /root_identity_digest: string/)
  assert.match(plan, /clean_status_digest: string/)
  assert.match(plan, /contract_root_not_authorized/)
  assert.match(plan, /clone-kind\/origin-URL\/root-identity\/head\/branch\/clean-status\/contract binding/)
  assert.match(plan, /controllerRoot: string/)
  assert.match(plan, /entryPath\?: string/)
  assert.match(plan, /post-integration` requires `integrationEntryPath`, forbids both `entryPath` and `executionContextPath`/)
  assert.match(plan, /Phase1ControllerRootBinding/)
  assert.match(plan, /same_as_tested_cc_root: false/)
  assert.match(plan, /preexisting_delta_paths/)
  assert.match(plan, /post-integration separates the declared controller delta from clean tested roots/)
  assert.match(plan, /controllerRoot !== ccGatewayRoot/)
  assert.match(plan, /capture_root_not_authorized/)
  assert.match(plan, /The review is holistic, not limited to the latest patch/)
  assert.match(plan, /missing\/extra-same-prefix\/duplicate-event\/raw-permutation\/persisted-multiset-or-unique-permutation\/event-or-unique-count\/family\/parser\/lifecycle mutation/)
  assert.match(plan, /tap_missing_plan/)
  assert.match(plan, /go_missing_package_terminal/)
  assert.match(plan, /go_json_valid_truncation/)
  assert.match(plan, /nonempty_unexplained_stderr/)
  assert.match(plan, /rehashEveryAffectedArtifact/)
  assert.match(plan, /buildPhase1IntegrationEntry\(fixture\.integrationEntryInputs\)/)
  assert.match(plan, /buildPhase1Handoff\(fixture\.handoffInputs\)/)
  assert.match(plan, /buildPhase1IntegrationReceipt\(fixture\.receiptInputs\)/)
  assert.match(plan, /validatePhase1IntegrationReceiptValue\(fixture\.receiptPostCommit\)/)
  assert.match(plan, /build-integration-entry --catalog docs\/superpowers\/registry\/oracle-lab-phase-1-command-catalog\.json/)
  assert.match(plan, /build-handoff --catalog docs\/superpowers\/registry\/oracle-lab-phase-1-command-catalog\.json/)
  assert.match(plan, /validate-handoff --catalog docs\/superpowers\/registry\/oracle-lab-phase-1-command-catalog\.json/)
  assert.match(plan, /build-integration-receipt --catalog docs\/superpowers\/registry\/oracle-lab-phase-1-command-catalog\.json/)
  assert.match(plan, /validate-integration-receipt --catalog docs\/superpowers\/registry\/oracle-lab-phase-1-command-catalog\.json/)
  assert.doesNotMatch(plan, /cc-b4-b6-red:.*ORACLE_LAB_MANIFEST_PATH/)
})

test('Phase 1 Task 7 binds GREEN full-suite contract discovery without substituting the tested Sub2API root', async () => {
  const plan = await readFile(path.join(root, planPath), 'utf8')
  const contractPath = '${SUB2API_CONTRACT_ROOT}/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json'

  assert.match(plan, /cc-tests:.*env SUB2API_FORMAL_POOL_CONTRACT_PATH=\$\{SUB2API_CONTRACT_ROOT\}\/backend\/internal\/service\/testdata\/cc_gateway_formal_pool_contract\/vectors\.json/)
  assert.match(plan, /cc-tests-repeat:.*env SUB2API_FORMAL_POOL_CONTRACT_PATH=\$\{SUB2API_CONTRACT_ROOT\}\/backend\/internal\/service\/testdata\/cc_gateway_formal_pool_contract\/vectors\.json/)
  assert.equal(plan.includes(contractPath), true)
  assert.match(plan, /only `cc-tests` and `cc-tests-repeat` may set `SUB2API_FORMAL_POOL_CONTRACT_PATH`/)
  assert.match(plan, /the exact catalog value is `\$\{SUB2API_CONTRACT_ROOT\}\/backend\/internal\/service\/testdata\/cc_gateway_formal_pool_contract\/vectors\.json`/)
  assert.match(plan, /all other catalog rows forbid `SUB2API_FORMAL_POOL_CONTRACT_PATH`/)
  assert.match(plan, /[Tt]he capture envelope still binds the tested Sub2API implementation root/)
  assert.match(plan, /the `cc-tests` and `cc-tests-repeat` child environments omit `SUB2API_ROOT`/)
  assert.match(plan, /missing, relative, alternate-root, wrong-suffix, symlink, inherited-startup, and every forbidden-row environment mutation/)
  assert.match(plan, /every forbidden command ID independently receives the variable and must fail `contract_root_not_authorized` with zero spawned commands/)
  assert.match(plan, /Run serially three times from one unchanged clean HEAD: `env -i/)
  assert.match(plan, /SUB2API_FORMAL_POOL_CONTRACT_PATH=\$\{SUB2API_CONTRACT_ROOT\}\/backend\/internal\/service\/testdata\/cc_gateway_formal_pool_contract\/vectors\.json \/opt\/homebrew\/bin\/npm test/)
  assert.match(plan, /Do not combine or parallelize the three runs/)
})

test('Phase 1 full regression uses a serial process-isolation boundary', async () => {
  const [runner, processRunner, packageManifest] = await Promise.all([
    readFile(path.join(root, 'tests/run-all.ts'), 'utf8'),
    readFile(path.join(root, 'tests/suite-process-runner.ts'), 'utf8'),
    readFile(path.join(root, 'package.json'), 'utf8'),
  ])

  assert.match(runner, /runSerialSuiteProcesses/)
  assert.match(runner, /--exclude-oracle-p0-1/)
  assert.match(processRunner, /spawnSync/)
  assert.match(processRunner, /run-p0-1\.ts/)
  assert.match(processRunner, /run-all\.ts.*--exclude-oracle-p0-1/s)
  assert.match(processRunner, /buildClosedFullSuiteEnvironment\(process\.env\)/)
  assert.match(processRunner, /unsafe_full_suite_environment/)
  assert.match(processRunner, /npm_config_userconfig: '\/dev\/null'/)
  assert.match(processRunner, /SUB2API_FORMAL_POOL_CONTRACT_PATH/)
  assert.doesNotMatch(processRunner, /\{ \.\.\.process\.env \}/)
  assert.equal(JSON.parse(packageManifest).scripts.test, 'node --import tsx tests/run-all.ts')
})

test('Phase 1 H1 binds ignored state and repeats the isolated full suite', async () => {
  const plan = await readFile(path.join(root, planPath), 'utf8')
  for (const required of [
    'Phase1IgnoredStateBinding',
    'git_exclude_standard_recursive_v1',
    'computeIgnoredPathInventory',
    'compareIgnoredPathInventories',
    'cc_build_dist_v1',
    'sub_frontend_build_v1',
    'sub2api_joint_safe_deliverable_v1',
    'sub-frontend-build-repeat',
    'cc-tests-repeat',
    'IGNORED_STATE_MUTATIONS',
    'ignored_create',
    'ignored_modify',
    'ignored_delete',
    'ignored_rename',
    'ignored_mode_change',
    'ignored_type_change',
    'ignored_symlink_target_change',
    'ignored_state_drift',
    'ignored_state_symlink_escape',
    'final_verify_ignored_profile_invalid',
    'Phase1IgnoredStateChainBinding',
    'Phase1IgnoredStateEvidenceReference',
    'Phase1ExternalDependencyBinding',
    'Phase1ExternalDependencySet',
    'Phase1ExternalDependencyTransition',
    'Phase1ExternalDependencyChainBinding',
    'Phase1ExternalDependencyEvidenceReference',
    'Phase1NpmCachePreparation',
    'phase1_external_dependency_content_v1',
    'npm_ci_offline_authenticated_cache_and_go_mod_verify_v2',
    'os_account_cow_cache_v1',
    'command_scoped_empty_mkdtemp_v1',
    'external_dependency_drift',
  ]) assert(plan.includes(required), required)

  assert.match(plan, /ignored_output_policies: \{\s*cc_gateway: Phase1IgnoredOutputPolicy\s*sub2api: Phase1IgnoredOutputPolicy/s)
  assert.match(plan, /ignored_state_transitions: \{\s*controller: Phase1ControllerIgnoredStateTransition\s*cc_gateway: Phase1IgnoredStateTransition\s*sub2api: Phase1IgnoredStateTransition/s)
  assert.match(plan, /controller_alias_cc_gateway_v1/)
  assert.match(plan, /transition_count: 17/)
  assert.match(plan, /external_dependencies: Phase1ExternalDependencySet/)
  assert.match(plan, /external_dependency_transition: Phase1ExternalDependencyTransition/)
  assert.match(plan, /external_dependency_chain: Phase1ExternalDependencyChainBinding/)
  assert.match(plan, /feature review, integration entry, handoff, receipt, and final-remote artifacts each embed `Phase1ExternalDependencyEvidenceReference`/i)
  assert.match(plan, /npm ci --offline --ignore-scripts --cache <command-scoped-cache>/)
  assert.match(plan, /source_before_digest.*source_after_digest.*command_before_digest.*command_after_digest.*install_result_digest/s)
  assert.match(plan, /source race.*symlink.*special file.*group[/]world writable.*missing tarball.*command-cache drift/s)
  assert.match(plan, /never persists.*absolute npm-cache path/i)
  assert.match(plan, /listed transitive module without `Dir` remains identity-bound.*replacement without a real selected directory still fails/s)
  assert.match(plan, /go mod verify/)
  assert.match(plan, /mkdtemp\('\/tmp\/oracle-lab-phase1-go-build-'\)/)
  assert.match(plan, /unsafe_full_suite_build_cache/)
  assert.match(plan, /does not follow symbolic links/)
  assert.match(plan, /absolute targets.*repository escape.*same ignored endpoint root.*dangling targets.*cross-endpoint targets.*cycles/s)
  assert.match(plan, /`node_modules` and `\.codegraph`.*before and after every command/s)
  assert.match(plan, /`cc-build`.*exact `dist` directory and descendants.*regular files and directories/s)
  assert.match(plan, /`sub-frontend-build`.*exact `backend\/internal\/web\/dist` directory.*frontend\/tsconfig\.node\.tsbuildinfo/s)
  assert.match(plan, /immediate second builds.*ignored-state digests identical/s)
  assert.match(plan, /captureAndRunPhase1.*validatePhase1ResultsValue.*buildPhase1IntegrationEntry.*validatePhase1IntegrationEntryValue.*buildPhase1Handoff.*validatePhase1HandoffValue.*buildPhase1IntegrationReceipt.*validatePhase1IntegrationReceiptValue.*verifyPhase1FinalRemote/s)
  assert.match(plan, /fifteen `pass`, two `expected_fail`/)
  assert.match(plan, /does not compare fresh-root `\.codegraph` or `node_modules` digests.*does not claim evidence about a mutation that occurred before/s)
  assert.match(plan, /Mutation tests for final remote inject each ignored operation after the before snapshot/)
  assert.match(plan, /three consecutive `env -i` isolated `npm test` runs/)
  assert.match(plan, /derive each temporary branch suffix from the already-created unique temporary parent/)
  assert.match(plan, /actual fresh shared Git clone with no `dist`/)
  assert.match(plan, /Run serially three times from one unchanged clean HEAD: `env -i/)
  assert.match(plan, /Then run `npm run build` in the same frozen worktree/)
})

test('Phase 1 plan closes context refresh, review, merge-topology, and retry lifecycles', async () => {
  const plan = await readFile(path.join(root, planPath), 'utf8')
  for (const required of [
    'context_mode',
    'authorized_parent_head',
    'observed_remote_main_head',
    'predecessor artifact commit',
    'phase-1-execution-context-0001.json',
    'PHASE1_EXECUTION_CONTEXT_MODE=successor',
    'PHASE1_EXECUTION_CONTEXT_GATE=pre-commit',
    'PHASE1_EXECUTION_CONTEXT_GATE=post-commit',
    'PHASE1_EXECUTION_CONTEXT_PATH',
    'stale_execution_context',
    'context_chain_gap',
    'predecessor_context_mutated',
    'phase-1-feature-review.json',
    'oracle-lab-phase-1-feature-review.schema.json',
    'review_attestation_head',
    '--cc-merge-commit',
    '--sub2api-merge-commit',
    'merge_commit_parent_mismatch',
    'historical_valid_at',
    'PHASE1_ATTEMPT_ID',
    '--previous-attempt-id',
    '--previous-attempt-receipt',
    '--previous-attempt-receipt-digest',
    '--previous-attempt-receipt-commit',
    'attempt_chain_invalid',
    'PHASE1_DRAFT_RUN_ID',
    'an unmerged draft never consumes a canonical attempt sequence',
    'git_ls_tree_v1_sha256_canonical_json',
    'phase1_evidence_governance_only_v1',
    'phase1_implementation_drift',
    'context_remote_origin_drift',
    'context_git_object_invalid',
    'feature-[0-9]{4}',
    'attempt-[0-9]{4}',
    'derive its CC artifact commit as the unique one-parent child',
    'tested Sub2API feature HEAD to equal `repositories.sub2api.authorized_parent_head` exactly',
    'CC_GATEWAY_TESTED_HEAD',
    'SUB2API_TESTED_HEAD',
    'feature_evidence_commit_mismatch',
  ]) assert(plan.includes(required), required)

  assert.doesNotMatch(plan, /repeat Steps 1-4/)
  assert.doesNotMatch(plan, /--execution-context docs\/superpowers\/evidence\/phase-1\/phase-1-execution-context\.json/)
  assert.match(plan, /latest contiguous context chain head/)
  assert.match(plan, /generated_at.*clock skew/i)
  assert.match(plan, /shared-contract bytes.*live/i)
  assert.match(plan, /sole parent.*authorized_parent_head/i)
  assert.match(plan, /feature results.*context chain head/i)
  assert.match(plan, /changes_requested/)
  assert.match(plan, /attempt-0001` is sequence `1` with `predecessor: null`/)
  assert.match(plan, /missing_predecessor.*attempt_gap.*attempt_jump/s)
  assert.match(plan, /validate-feature-review --catalog docs\/superpowers\/registry\/oracle-lab-phase-1-command-catalog\.json/)
  assert.match(plan, /context_commit_parent_mismatch/)
  assert.match(plan, /failContextGate\(code, message\)/)
  assert.match(plan, /git remote get-url muqihang/)
  assert.match(plan, /remote names\/refs\/URL digests, implementation branches, and both `gate_schemas` bindings immutable across the chain/)
  assert.match(plan, /hard-codes those two digests outside either mutable schema/)
  assert.match(plan, /context_schema_binding_drift/)
  assert.match(plan, /readGateArtifact.*readGateJsonArtifact.*gateDirectoryNames.*reviewedGitGate/)
  assert.match(plan, /git ls-tree -r -z --full-tree <commit>/)
  assert.match(plan, /docs\/superpowers\/evidence\/phase-1\//)
  assert.match(plan, /docs\/superpowers\/registry\/oracle-lab-requirements\.json/)
  assert.match(plan, /Sub2API has `excluded_prefixes: \[\]` and `excluded_paths: \[\]`/)
  assert.match(plan, /source_add.*source_modify.*source_delete.*source_rename/s)
  assert.match(plan, /executable_mode_change.*symlink_target_change.*submodule_pointer_change/s)
  assert.match(plan, /RAW_TREE_STREAM_MUTATIONS/)
  assert.match(plan, /implementation_tree_stream_invalid/)
  assert.match(plan, /phase1_prefix_collision.*governance_suffix_collision/s)
  assert.match(plan, /No path may reuse an old feature review after implementation-tree drift/)
  assert.match(plan, /They do not claim the future evidence commit that will contain their own bytes/)
  assert.match(plan, /unique one-parent child of `CC_GATEWAY_TESTED_HEAD`/)
  assert.match(plan, /exact delta is `A` for only the two feature baseline\/results paths/)
  assert.match(plan, /sole authoritative review artifact.*phase-1-feature-review\.json/)
  assert.doesNotMatch(plan, /phase-1-feature-review\.md/)
  assert.match(plan, /verify-final-remote --catalog docs\/superpowers\/registry\/oracle-lab-phase-1-command-catalog\.json/)
  assert.match(plan, /Remote URL\/name\/ref mismatch returns `context_remote_origin_drift`/)
  assert.match(plan, /superseded is never an early bypass/)
  assert.match(plan, /historical_receipt_deleted.*historical_receipt_deleted_readded.*attempt_chain_reset_to_0001/s)
  assert.match(plan, /Stop this plan, preserve prior evidence/)
  assert.match(plan, /no successor attempt is legal/)
})

test('Phase 1 mid-execution plan repair restarts canonical initial authority instead of mutating a successor chain', async () => {
  const plan = await readFile(path.join(root, planPath), 'utf8')
  const executionContextSchema = await json(executionContextSchemaPath)

  assert.equal(
    executionContextSchema.properties.repositories.properties.cc_gateway.allOf[1].properties.implementation_branch.const,
    expectedImplementationBranches.cc_gateway,
  )
  assert.equal(
    executionContextSchema.properties.repositories.properties.sub2api.allOf[1].properties.implementation_branch.const,
    expectedImplementationBranches.sub2api,
  )
  assert.match(
    plan,
    /current replacement branch and worktree: `codex\/oracle-phase-1-sub2api-v8` and `codex\/oracle-phase-1-cc-gateway-v8`/,
  )
  assert.match(
    plan,
    /current branches are exactly `codex\/oracle-phase-1-cc-gateway-v8` and `codex\/oracle-phase-1-sub2api-v8`/,
  )
  assert.match(
    plan,
    /Push `codex\/oracle-phase-1-sub2api-v8` and `codex\/oracle-phase-1-cc-gateway-v8`/,
  )

  for (const required of [
    'Mid-Execution Plan Authority Repair Restart',
    'quarantine checkpoint',
    'fresh replacement implementation worktrees',
    'codex/oracle-phase-1-cc-gateway-v8',
    'codex/oracle-phase-1-sub2api-v8',
    'new canonical initial plan review and sequence-zero execution context',
    'patch-id and implementation-tree equivalence',
    'Do not replay superseded plan review, execution context, or restart artifacts',
    'Task 7 broad gate remains blocked',
    'oracle-lab-phase-1-authority-restart.schema.json',
    'phase-1-authority-restart-0002.json',
    'buildPhase1AuthorityRestart',
    'validatePhase1AuthorityRestart',
    'validatePhase1AuthorityRestartSource',
    'oracle-phase1-authority-restart',
    'phase-1-authority-bootstrap.mjs',
    'validate-runtime',
    'canonical OS account',
    'untrusted content seed only',
    'initial-authority child of repaired remote main',
    'Sub2API replay base equals frozen remote main',
    '8cbc5c633c7f791b395198aedd2db2e55f01915b',
    'd5a711614177906d18486b98ff4c5d45d97e04c7',
    '295de5938e2ed0001dc51b520ebf62a223b44a3c',
    '655f57bc12191566b6f1efd415ce54721252ab08',
    '1c8f25bb1ca31c5c16262fec71f93dd1e14f512d',
    '6621c7a78432a895d261054e291aed74c04978c3',
    'authority_restart_checkpoint_mismatch',
  ]) assert(plan.includes(required), required)

  assert.match(plan, /plan, review, or gate-schema drift is never represented as an ordinary successor context/)
  assert.match(plan, /old review and context bytes remain historical only and cannot authorize the replacement branches/)
  assert.match(plan, /The replacement CC branch starts at the newly reviewed merged plan commit/)
  assert.match(plan, /the replacement Sub2API branch starts at freshly fetched `muqihang\/main`/i)
  assert.match(plan, /replay only the enumerated implementation commits/)
  assert.match(plan, /stable patch-id, exact source parent, contiguous replacement parent order, and exact changed-path\/mode set for every source-to-replacement mapping/)
  assert.match(plan, /projected tracked-tree comparison excludes exactly the reviewed authority-repair path set and canonical historical authority paths/)
  assert.match(plan, /all nonexcluded projected path, mode, object-type, and object-ID tuples remain byte-identical/)
  assert.match(plan, /intentionally omits the restart artifact's own digest and commit to avoid Git self-reference/)
  assert.match(plan, /rejects Node\/tsx, dynamic-library, and Git startup injection before Node starts/)
  assert.match(plan, /dependency-free bootstrap uses only Node built-ins and reviewed absolute OS tools to inventory and copy-on-write clone only `_cacache`/)
  assert.match(plan, /source inventory is byte-identical before and after the clone/)
  assert.match(plan, /TypeScript entry point always rejects direct execution/)
  assert.match(plan, /No importable TypeScript export dispatches authority commands/)
  assert.match(plan, /npm ci --offline --ignore-scripts/)
  assert.match(plan, /exclusive command cache is mode 0700/)
  assert.match(plan, /Inherited `HOME`, `npm_config_cache`.*cannot select dependency bytes/)
  assert.match(plan, /strict pre-commit gate requires the artifact to be the sole untracked delta and rejects a fully clean tree/)
  assert.match(plan, /external controller decision package is informational only/)
  assert.match(plan, /pinned checkpoint's exact changed-path set is disjoint from every authority-repair and historical exclusion/)
  assert.match(plan, /Source gaps are forbidden except the two compiled authority-only commits/)
  assert.match(plan, /must change only its one exact historical authority path, and must be consumed exactly once/)
  assert.match(plan, /Do not create another Task 7 continuation unless those replay-verification gates find a demonstrable implementation regression/)
  assert.match(plan, /then begin Task 8 with a fresh feature-capture context and fresh baseline\/results/)
})

test('Phase 1 final handoff is minted only after merged-main recapture and a receipt chain', async () => {
  const plan = await readFile(path.join(root, planPath), 'utf8')
  const merge = plan.indexOf('Step 4: Merge both implementation PRs before final evidence')
  const freeze = plan.indexOf('Step 5: Freeze exact integrated mains in new clean worktrees')
  const recapture = plan.indexOf('Step 6: Rerun the complete catalog on the exact integrated main heads')
  const artifact = plan.indexOf('Step 9: Commit the exact post-integration artifact set')
  const receipt = plan.indexOf('Step 10: Generate a self-reference-safe receipt and commit only it')
  const finalRemote = plan.indexOf('Step 12: Perform final remote-main verification without minting a false receipt')
  assert(merge >= 0 && freeze > merge && recapture > freeze && artifact > recapture && receipt > artifact && finalRemote > receipt)
  assert.match(plan, /phase-1-integration-entry\.json/)
  assert.match(plan, /phase-1-integration-receipt\.json/)
  assert.match(plan, /build-integration-entry --catalog docs\/superpowers\/registry\/oracle-lab-phase-1-command-catalog\.json --controller-root/)
  assert.match(plan, /validate-catalog --catalog/)
  assert.match(plan, /validate-results --stage feature-candidate/)
  assert.match(plan, /validate-results --stage post-integration/)
  assert.match(plan, /build-handoff --catalog[^\n]+--controller-root[^\n]+--cc-gateway-root[^\n]+--sub2api-root[^\n]+--sub2api-contract-root/)
  assert.match(plan, /validate-handoff --catalog docs\/superpowers\/registry\/oracle-lab-phase-1-command-catalog\.json --controller-root/)
  assert.match(plan, /validate-handoff --catalog[^\n]+--controller-root[^\n]+--cc-gateway-root[^\n]+--sub2api-root[^\n]+--sub2api-contract-root/)
  assert.match(plan, /build-integration-receipt --catalog docs\/superpowers\/registry\/oracle-lab-phase-1-command-catalog\.json --controller-root/)
  assert.match(plan, /validate-integration-receipt --catalog docs\/superpowers\/registry\/oracle-lab-phase-1-command-catalog\.json --controller-root/)
  assert.match(plan, /--receipt-commit HEAD/)
  assert.match(plan, /CC_GATEWAY_EVIDENCE_ROOT/)
  assert.match(plan, /CC_GATEWAY_INTEGRATION_ROOT/)
  assert.match(plan, /controller status must contain exactly that one untracked path while both tested roots remain empty/)
  assert.match(plan, /artifact commit's sole parent to be the exact captured CC integrated main head/)
  assert.match(plan, /post-commit validator requires `--receipt-commit HEAD`, proves that commit has the artifact commit as its sole parent, and proves its delta adds exactly one path/)
  assert.match(plan, /each remote main to equal or descend from the effective receipt's corresponding integrated head/)
  assert.match(plan, /CC remote main additionally to descend from the effective receipt commit/)
  assert.match(plan, /A descendant is accepted only when all changed CC paths are under the exact Phase 1 evidence prefix/)
  assert.match(plan, /Sub2API has no changed tracked path/)
  assert.match(plan, /implementation descendants \(`phase1_implementation_drift` and mandatory re-review\)/)
  assert.match(plan, /rewind\/non-ancestor movement \(no attempt allocation\)/)
  assert.doesNotMatch(plan, /implementation-path tree digest/)
  assert.doesNotMatch(plan, /Sub2API remote main to remain exactly the receipt's integrated Sub2API head/)
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
