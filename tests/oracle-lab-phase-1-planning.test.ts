import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
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
      artifact: pathDigest('docs/superpowers/evidence/phase-1/phase-1-plan-review.json'),
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
  const wrongAuthority = clone(fixture)
  wrongAuthority.authority_order.reverse()
  assert.equal(validator(wrongAuthority), false)
  const duplicateAuthority = clone(fixture)
  duplicateAuthority.authority_order[1] = clone(duplicateAuthority.authority_order[0])
  assert.equal(validator(duplicateAuthority), false)
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

test('required Phase 1 execution context binds live bytes, approval, expiry, and both main heads', async (t) => {
  if (process.env.PHASE1_REQUIRE_EXECUTION_CONTEXT !== '1') {
    t.skip('execution context is created just in time after the reviewed plan merges')
    return
  }
  const sub2apiRoot = process.env.SUB2API_ROOT
  assert(sub2apiRoot, 'SUB2API_ROOT is required with PHASE1_REQUIRE_EXECUTION_CONTEXT=1')
  const context = await validate(executionContextSchemaPath, executionContextPath)
  const review = await validate(planReviewSchemaPath, context.approval_receipt.artifact.path)
  assert.equal(executionContextBindings(context), true)
  const currentPlanBytes = await readFile(path.join(root, context.plan.path))
  const reviewedPlanBytes = runReviewedGit(root, ['show', '--format=', '--no-ext-diff', '--no-textconv', `${context.plan.reviewed_commit}:${context.plan.path}`]).stdout
  assert.equal(context.plan.digest, digest(currentPlanBytes))
  assert.equal(context.plan.digest, digest(reviewedPlanBytes))
  assert.equal(context.approval_receipt.artifact.digest, digest(await readFile(path.join(root, context.approval_receipt.artifact.path))))
  assert.deepEqual(review.plan, context.plan)
  assert.equal(review.reviewer_id, context.approval_receipt.reviewer_id)
  assert.equal(review.review_round, context.approval_receipt.review_round)
  assert.equal(review.decision, context.approval_receipt.decision)
  assert.equal(review.finding_counts.critical, context.approval_receipt.critical_findings)
  assert.equal(review.finding_counts.important, context.approval_receipt.important_findings)
  assert.equal(context.planning_provenance.entry.digest, digest(await readFile(path.join(root, context.planning_provenance.entry.path))))
  assert.equal(context.planning_provenance.context.digest, digest(await readFile(path.join(root, context.planning_provenance.context.path))))
  for (const binding of context.authority_order as Value[]) {
    assert.equal(binding.digest, digest(await readFile(path.join(root, binding.path))), binding.path)
  }
  const window = Date.parse(context.expires_at) - Date.parse(context.generated_at)
  assert(window > 0 && window <= 24 * 60 * 60 * 1000)
  assert(Date.now() < Date.parse(context.expires_at), 'execution context is expired')
  const ccRemoteMain = reviewedGitText(root, ['rev-parse', '--verify', '--end-of-options', 'refs/remotes/muqihang/main^{commit}'])
  const subRemoteMain = reviewedGitText(sub2apiRoot, ['rev-parse', '--verify', '--end-of-options', 'refs/remotes/muqihang/main^{commit}'])
  assert.equal(context.repositories.cc_gateway.baseline_main_head, ccRemoteMain)
  assert.equal(context.repositories.sub2api.baseline_main_head, subRemoteMain)
  assert.equal(reviewedGitText(root, ['branch', '--show-current']), context.repositories.cc_gateway.implementation_branch)
  assert.equal(reviewedGitText(sub2apiRoot, ['branch', '--show-current']), context.repositories.sub2api.implementation_branch)
  assert.equal(reviewedGitText(root, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}']), context.plan.reviewed_commit)
  assert.equal(reviewedGitText(sub2apiRoot, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}']), subRemoteMain)

  const ccStatus = runReviewedGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']).stdout
    .toString('utf8').split('\0').filter(Boolean).sort()
  assert.deepEqual(ccStatus, [
    '?? docs/superpowers/evidence/phase-1/phase-1-execution-context.json',
    '?? docs/superpowers/evidence/phase-1/phase-1-plan-review.json',
  ])
  const subStatus = runReviewedGit(sub2apiRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']).stdout
  assert.equal(subStatus.length, 0, 'Sub2API implementation worktree must be clean before Phase 1 edits')
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
    'revoked session; expired session',
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
  assert.match(plan, /validate-handoff --catalog docs\/superpowers\/registry\/oracle-lab-phase-1-command-catalog\.json --controller-root/)
  assert.match(plan, /build-integration-receipt --catalog docs\/superpowers\/registry\/oracle-lab-phase-1-command-catalog\.json --controller-root/)
  assert.match(plan, /validate-integration-receipt --catalog docs\/superpowers\/registry\/oracle-lab-phase-1-command-catalog\.json --controller-root/)
  assert.match(plan, /--receipt-commit HEAD/)
  assert.match(plan, /CC_GATEWAY_EVIDENCE_ROOT/)
  assert.match(plan, /CC_GATEWAY_INTEGRATION_ROOT/)
  assert.match(plan, /controller status must contain exactly that one untracked path while both tested roots remain empty/)
  assert.match(plan, /artifact commit's sole parent to be the exact captured CC integrated main head/)
  assert.match(plan, /post-commit validator requires `--receipt-commit HEAD`, proves that commit has the artifact commit as its sole parent, and proves its delta adds exactly one path/)
  assert.match(plan, /Sub2API remote main to remain exactly the receipt's integrated Sub2API head/)
  assert.match(plan, /CC remote main to descend from the receipt commit/)
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
