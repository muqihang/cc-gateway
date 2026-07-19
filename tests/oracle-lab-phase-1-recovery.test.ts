import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  derivePhase1BaselineEnvelope,
  derivePhase1RunLease,
  derivePhase1TerminalRecord,
  digestDeliveryValue,
  parsePhase1RecoveryContract,
} from '../tools/oracle-lab/delivery-authority.js'
import {
  PHASE1_RECOVERY_BINDINGS,
  derivePhase1RecoveryT2Record,
  parsePhase1RecoveryGoRedEvidence,
  parsePhase1RecoveryCli,
  runPhase1RecoveryPreReplay,
  validatePhase1RecoveryInputs,
  validatePhase1RecoveryOutputs,
  validatePhase1RecoveryReplayMapping,
  validatePhase1RecoveryT2Record,
  type Phase1RecoveryDependencies,
} from '../tools/oracle-lab/phase-1-recovery.js'

type Value = Record<string, any>

const root = path.resolve(new URL('..', import.meta.url).pathname)
const planPath = path.join(root, PHASE1_RECOVERY_BINDINGS.plan_path)
const planBytes = readFileSync(planPath)
const executionContextSchemaPath = 'docs/superpowers/schemas/oracle-lab-phase-1-execution-context.schema.json'
const planReviewSchemaPath = 'docs/superpowers/schemas/oracle-lab-phase-1-plan-review.schema.json'
const executionContextSchemaBytes = readFileSync(path.join(root, executionContextSchemaPath))
const executionContextSchemaDigest = 'sha256:9860d5ae3e3500698052e166bba37197ee3a84a27dea2dac8f5700df863fa099'
const planReviewSchemaDigest = 'sha256:4d49e5682dbade4f7bd22d44cd7fadeeb1669de5b66e690fb4c988f3f07a34e0'
const authorityOrder = [
  'docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md',
  'docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md',
  'docs/superpowers/specs/2026-07-11-claude-code-2.1.207-adversarial-validation-v2.md',
  'docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-design.md',
]

function clone<T>(value: T): T { return structuredClone(value) }

function sha256(value: Buffer | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function git(repository: string, ...args: string[]): string {
  return execFileSync('/usr/bin/git', args, {
    cwd: repository,
    encoding: 'utf8',
    env: {
      HOME: '/dev/null', PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_COUNT: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0',
    },
  }).trim()
}

function initRepository(repository: string, remoteUrl: string): string {
  mkdirSync(repository, { recursive: true, mode: 0o700 })
  git(repository, 'init', '-q', '--initial-branch=main')
  git(repository, 'config', 'user.email', 'oracle@example.invalid')
  git(repository, 'config', 'user.name', 'Oracle Test')
  writeFileSync(path.join(repository, 'baseline.txt'), 'baseline\n')
  git(repository, 'add', 'baseline.txt')
  git(repository, 'commit', '-qm', 'baseline')
  git(repository, 'remote', 'add', 'muqihang', remoteUrl)
  const head = git(repository, 'rev-parse', 'HEAD')
  git(repository, 'update-ref', 'refs/remotes/muqihang/main', head)
  return head
}

function inputFixture() {
  const parent = mkdtempSync(path.join(tmpdir(), 'oracle-phase1-recovery-input-'))
  const ccRoot = path.join(parent, 'cc-main')
  const subRoot = path.join(parent, 'sub-main')
  const ccSource = path.join(parent, 'cc-source')
  const subSource = path.join(parent, 'sub-source')
  const ccUrl = 'https://example.invalid/cc.git'
  const subUrl = 'https://example.invalid/sub.git'
  initRepository(ccRoot, ccUrl)
  initRepository(subRoot, subUrl)
  const ccSourceHead = initRepository(ccSource, ccUrl)
  const subSourceHead = initRepository(subSource, subUrl)
  const ccBundle = path.join(parent, 'cc.bundle')
  const subBundle = path.join(parent, 'sub.bundle')
  git(ccSource, 'bundle', 'create', ccBundle, '--all')
  git(subSource, 'bundle', 'create', subBundle, '--all')
  const bindings = clone(PHASE1_RECOVERY_BINDINGS) as Value
  bindings.cc_gateway.remote_url_digest = sha256(ccUrl)
  bindings.cc_gateway.bootstrap_head = git(ccRoot, 'rev-parse', 'HEAD')
  bindings.cc_gateway.source_head = ccSourceHead
  bindings.cc_gateway.source_commits = [ccSourceHead]
  bindings.cc_gateway.skipped_source_commits = []
  bindings.cc_gateway.bundle_digest = sha256(readFileSync(ccBundle))
  bindings.sub2api.remote_url_digest = sha256(subUrl)
  bindings.sub2api.bootstrap_head = git(subRoot, 'rev-parse', 'HEAD')
  bindings.sub2api.source_head = subSourceHead
  bindings.sub2api.source_commits = [subSourceHead]
  bindings.sub2api.skipped_source_commits = []
  bindings.sub2api.bundle_digest = sha256(readFileSync(subBundle))
  const input = {
    command: 'pre-replay-red' as const,
    cc_root: ccRoot,
    sub2api_root: subRoot,
    cc_bundle: ccBundle,
    sub2api_bundle: subBundle,
    output_root: path.join(parent, 'output'),
  }
  return { parent, input, bindings, ccBundle }
}

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.equal((error as { code?: string }).code, code)
    return true
  })
}

function validationStatus(entries: string[]): Value {
  const sorted = [...entries].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
  return { entries: sorted, digest: sha256(Buffer.from(sorted.join('\0'))) }
}

function recoveryAuthority(): Value {
  const pathDigest = (relative: string, digest: string) => ({ path: relative, digest })
  return {
    operating_model: pathDigest('docs/superpowers/roadmaps/2026-07-18-oracle-lab-delivery-operating-model-v2.md', 'sha256:a53e7384d6cf353877af82f16196b8d58ed823277e76e03337dfc9fadff7d0ea'),
    roadmap: pathDigest('docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md', 'sha256:00519348d9dd8972dbea92a647d67c2fc42e9015ece6dcb0eb427df02480b107'),
    transition_plan: pathDigest('docs/superpowers/plans/2026-07-18-oracle-delivery-mechanism-transition.md', 'sha256:f21023b1d6705855e00ee0f9ceafc78c6cf1c7b928982fd88e821faffa7a8111'),
    transition_exit_report: pathDigest('docs/superpowers/evidence/delivery-model/delivery-mechanism-transition-exit-report.md', 'sha256:44c9322ba157c1ce4f3b9a974387026aad143f73c6991848be3f50f13af00f48'),
    terminal_controller_chain: { kind: 'terminal_controller_chain', digest: 'sha256:3faa939ec6f78a7478a5ea5c2773ea74d5ea42d0b699e1880798cac980192433' },
    terminal_acceptance_record: { kind: 'terminal_acceptance_record', digest: 'sha256:00f84b989d0db40d0c47429bcd5d444709159027f21f4dec0e33812b9c539ecd' },
    recovery_contract: { plan_path: PHASE1_RECOVERY_BINDINGS.plan_path, digest: PHASE1_RECOVERY_BINDINGS.contract_digest },
    source_bundles: { cc_gateway: PHASE1_RECOVERY_BINDINGS.cc_gateway.bundle_digest, sub2api: PHASE1_RECOVERY_BINDINGS.sub2api.bundle_digest },
    shared_contract: { path: 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json', digest: PHASE1_RECOVERY_BINDINGS.shared_contract_digest },
  }
}

function context(sequence: number, authorizedHeads: Readonly<{ cc_gateway: string; sub2api: string }> = {
  cc_gateway: PHASE1_RECOVERY_BINDINGS.cc_gateway.bootstrap_head,
  sub2api: PHASE1_RECOVERY_BINDINGS.sub2api.bootstrap_head,
}): Value {
  const generated = new Date(Date.parse('2026-07-18T18:00:00Z') + sequence * 60_000).toISOString()
  const artifactPath = sequence === 0
    ? 'docs/superpowers/evidence/phase-1/phase-1-execution-context.json'
    : `docs/superpowers/evidence/phase-1/phase-1-execution-context-${String(sequence).padStart(4, '0')}.json`
  const previousPath = sequence <= 1
    ? 'docs/superpowers/evidence/phase-1/phase-1-execution-context.json'
    : `docs/superpowers/evidence/phase-1/phase-1-execution-context-${String(sequence - 1).padStart(4, '0')}.json`
  const ccHead = PHASE1_RECOVERY_BINDINGS.cc_gateway.bootstrap_head
  const subHead = PHASE1_RECOVERY_BINDINGS.sub2api.bootstrap_head
  return {
    schema_version: 2,
    context_kind: 'phase_1_recovery_context',
    context_mode: sequence === 0 ? 'initial' : 'successor',
    sequence,
    stage: sequence === 0 ? 'implementation_entry' : 'implementation',
    artifact_path: artifactPath,
    predecessor: sequence === 0 ? null : {
      path: previousPath,
      digest: `sha256:${'1'.repeat(64)}`,
      sequence: sequence - 1,
      stage: sequence === 1 ? 'implementation_entry' : 'implementation',
      artifact_commit: ccHead,
    },
    generated_at: generated,
    expires_at: new Date(Date.parse(generated) + 4 * 60 * 60 * 1000).toISOString(),
    plan: { path: PHASE1_RECOVERY_BINDINGS.plan_path, digest: PHASE1_RECOVERY_BINDINGS.plan_digest, reviewed_commit: PHASE1_RECOVERY_BINDINGS.reviewed_plan_commit },
    approval_receipt: {
      artifact: { path: 'docs/superpowers/evidence/phase-1/phase-1-plan-review.json', digest: `sha256:${'2'.repeat(64)}` },
      decision: 'approved',
      reviewer_id: 'phase1-recovery-acceptance-review',
      review_round: 1,
      reviewed_plan_commit: PHASE1_RECOVERY_BINDINGS.reviewed_plan_commit,
      reviewed_plan_digest: PHASE1_RECOVERY_BINDINGS.plan_digest,
      critical_findings: 0,
      important_findings: 0,
      reviewer_roles: ['product', 'authority'],
    },
    gate_schemas: {
      execution_context: { path: executionContextSchemaPath, digest: executionContextSchemaDigest },
      plan_review: { path: planReviewSchemaPath, digest: planReviewSchemaDigest },
    },
    recovery_authority: recoveryAuthority(),
    repositories: {
      cc_gateway: {
        baseline_main_head: ccHead, authorized_parent_head: authorizedHeads.cc_gateway, observed_remote_main_head: ccHead,
        remote_name: 'muqihang', remote_url_digest: PHASE1_RECOVERY_BINDINGS.cc_gateway.remote_url_digest,
        tracking_ref: 'refs/remotes/muqihang/main', implementation_branch: PHASE1_RECOVERY_BINDINGS.cc_gateway.recovery_branch,
        pre_issue_clean: true, validation_status: validationStatus([]),
      },
      sub2api: {
        baseline_main_head: subHead, authorized_parent_head: authorizedHeads.sub2api, observed_remote_main_head: subHead,
        remote_name: 'muqihang', remote_url_digest: PHASE1_RECOVERY_BINDINGS.sub2api.remote_url_digest,
        tracking_ref: 'refs/remotes/muqihang/main', implementation_branch: PHASE1_RECOVERY_BINDINGS.sub2api.recovery_branch,
        pre_issue_clean: true, validation_status: validationStatus([]),
      },
    },
    shared_contract: { repository: 'sub2api', path: 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json', digest: PHASE1_RECOVERY_BINDINGS.shared_contract_digest },
    authority_order: authorityOrder.map((authorityPath) => ({ path: authorityPath, digest: `sha256:${'8'.repeat(64)}` })),
    selected_requirements: ['AV-B1-001', 'AV-B2-001', 'AV-B3-001', 'RA-P0-008'],
    implementation_entry: {
      status: 'authorized',
      conditions: [
        'fresh_unexpired_execution_context', 'contiguous_immutable_context_chain', 'exact_stage_and_repository_state',
        'exact_plan_digest_bound', 'independent_plan_approval_bound', 'critical_and_important_findings_zero',
        'both_main_heads_frozen', 'shared_contract_unchanged', 'production_and_real_canary_disabled',
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

function mappingFixture() {
  const parent = mkdtempSync(path.join(tmpdir(), 'oracle-phase1-recovery-mapping-'))
  const bindings = clone(PHASE1_RECOVERY_BINDINGS) as Value
  const observation: Value = {}
  const repositories: Value = {}
  for (const [name, file] of [['cc_gateway', 'cc-product.txt'], ['sub2api', 'sub-product.txt']] as const) {
    const sourceRoot = path.join(parent, `${name}-source`)
    const replacementRoot = path.join(parent, `${name}-replacement`)
    initRepository(sourceRoot, `https://example.invalid/${name}-source.git`)
    const baseline = initRepository(replacementRoot, `https://example.invalid/${name}-replacement.git`)
    const skipped: string[] = []
    if (name === 'cc_gateway') {
      const evidence = path.join(sourceRoot, 'docs/superpowers/evidence/phase-1')
      mkdirSync(evidence, { recursive: true })
      for (const index of [1, 2]) {
        const skippedFile = path.join(evidence, `historical-${index}.json`)
        writeFileSync(skippedFile, `{"historical":${index}}\n`)
        git(sourceRoot, 'add', path.relative(sourceRoot, skippedFile))
        git(sourceRoot, 'commit', '-qm', `historical authority ${index}`)
        skipped.push(git(sourceRoot, 'rev-parse', 'HEAD'))
      }
    }
    writeFileSync(path.join(sourceRoot, file), 'reviewed product delta\n')
    git(sourceRoot, 'add', file)
    git(sourceRoot, 'commit', '-qm', 'source product delta')
    const sourceCommit = git(sourceRoot, 'rev-parse', 'HEAD')
    git(replacementRoot, 'switch', '-qc', bindings[name].recovery_branch)
    writeFileSync(path.join(replacementRoot, file), 'reviewed product delta\n')
    git(replacementRoot, 'add', file)
    git(replacementRoot, 'commit', '-qm', 'replacement product delta')
    const replacementCommit = git(replacementRoot, 'rev-parse', 'HEAD')
    bindings[name].bootstrap_head = baseline
    bindings[name].source_head = sourceCommit
    bindings[name].source_commits = [sourceCommit]
    bindings[name].skipped_source_commits = skipped
    observation[name] = { source_root: sourceRoot, replacement_root: replacementRoot }
    repositories[name] = {
      source_commits: [sourceCommit], replacement_commits: [replacementCommit], skipped_source_commits: [...bindings[name].skipped_source_commits], protected_path_intersection_count: 0,
    }
  }
  const record = {
    schema_version: 1,
    record_kind: 'phase_1_recovery_replay_mapping',
    status: 'equivalent',
    cc_gateway: repositories.cc_gateway,
    sub2api: repositories.sub2api,
  }
  return { record, bindings, observation }
}

test('Recovery authority selects the exact committed contract and rejects legacy/caller drift', () => {
  const contract = parsePhase1RecoveryContract(planBytes)
  assert.equal(contract.source_digest, PHASE1_RECOVERY_BINDINGS.contract_digest)
  assert.equal(contract.rows.length, 15)
  assert.deepEqual(contract.rows.slice(0, 3).map((row) => row.id), ['P1R-01', 'P1R-02', 'P1R-03'])
  assert.equal(contract.rows.at(-1)?.to, 'exit_verified')

  const changed = planBytes.toString('utf8').replace('run-pre-replay-vertical-red', 'caller-command')
  expectCode(() => parsePhase1RecoveryContract(changed), 'delivery_transition_unknown_command')
  expectCode(() => parsePhase1RecoveryContract(Buffer.from('<!-- ORACLE_PHASE1_RECOVERY_TRANSITIONS_BEGIN -->\n```json\n[]\n```\n<!-- ORACLE_PHASE1_RECOVERY_TRANSITIONS_END -->\n')), 'delivery_transition_malformed')
})

test('Recovery CLI is closed and never accepts caller-selected commits, mappings, or authority bytes', () => {
  const argv = [
    'pre-replay-red',
    '--cc-root', '/tmp/cc-main',
    '--sub2api-root', '/tmp/sub-main',
    '--cc-bundle', '/tmp/cc.bundle',
    '--sub2api-bundle', '/tmp/sub.bundle',
    '--output-root', '/tmp/output',
  ]
  assert.deepEqual(parsePhase1RecoveryCli(argv), {
    command: 'pre-replay-red',
    cc_root: '/tmp/cc-main', sub2api_root: '/tmp/sub-main', cc_bundle: '/tmp/cc.bundle', sub2api_bundle: '/tmp/sub.bundle', output_root: '/tmp/output',
  })
  for (const injected of [
    ['--source-commit', 'f'.repeat(40)],
    ['--mapping', '/tmp/mapping.json'],
    ['--plan-review', '/tmp/old-review.json'],
    ['--restart-artifact', '/tmp/restart.json'],
    ['--contract-digest', `sha256:${'f'.repeat(64)}`],
  ]) expectCode(() => parsePhase1RecoveryCli([...argv, ...injected]), 'phase1_recovery_cli_invalid')
})

test('Recovery input validator authenticates real bundles and rejects root, type, output, and race mutations', () => {
  const valid = inputFixture()
  assert.doesNotThrow(() => validatePhase1RecoveryInputs(valid.input, valid.bindings as any))
  assert.equal(existsSync(path.join(valid.input.output_root, 'bundle-quarantine/cc-source.bundle')), true)
  assert.doesNotThrow(() => validatePhase1RecoveryOutputs(valid.input, valid.bindings as any))

  const dirty = inputFixture()
  writeFileSync(path.join(dirty.input.cc_root, 'untracked.txt'), 'dirty\n')
  expectCode(() => validatePhase1RecoveryInputs(dirty.input, dirty.bindings as any), 'phase1_recovery_root_invalid')

  const forgedRemoteMain = inputFixture()
  writeFileSync(path.join(forgedRemoteMain.input.cc_root, 'forged.txt'), 'forged\n')
  git(forgedRemoteMain.input.cc_root, 'add', 'forged.txt')
  git(forgedRemoteMain.input.cc_root, 'commit', '-qm', 'forged main')
  git(forgedRemoteMain.input.cc_root, 'update-ref', 'refs/remotes/muqihang/main', git(forgedRemoteMain.input.cc_root, 'rev-parse', 'HEAD'))
  expectCode(() => validatePhase1RecoveryInputs(forgedRemoteMain.input, forgedRemoteMain.bindings as any), 'phase1_recovery_root_invalid')

  const linked = inputFixture()
  const link = path.join(linked.parent, 'cc-link.bundle')
  symlinkSync(linked.ccBundle, link)
  expectCode(() => validatePhase1RecoveryInputs({ ...linked.input, cc_bundle: link }, linked.bindings as any), 'phase1_recovery_bundle_invalid')

  const truncated = inputFixture()
  writeFileSync(truncated.input.cc_bundle, 'not-a-bundle\n')
  expectCode(() => validatePhase1RecoveryInputs(truncated.input, truncated.bindings as any), 'phase1_recovery_bundle_invalid')

  const occupied = inputFixture()
  mkdirSync(occupied.input.output_root, { mode: 0o700 })
  expectCode(() => validatePhase1RecoveryInputs(occupied.input, occupied.bindings as any), 'phase1_recovery_output_invalid')

  const raced = inputFixture()
  let replaced = false
  expectCode(() => validatePhase1RecoveryInputs(raced.input, raced.bindings as any, {
    after_bundle_read: (bundle) => {
      if (replaced || path.basename(bundle) !== 'cc.bundle') return
      replaced = true
      const bytes = readFileSync(bundle)
      renameSync(bundle, `${bundle}.moved`)
      writeFileSync(bundle, bytes, { mode: 0o600 })
    },
  }), 'phase1_recovery_bundle_invalid')

  const quarantineRaced = inputFixture()
  let quarantineReplaced = false
  expectCode(() => validatePhase1RecoveryInputs(quarantineRaced.input, quarantineRaced.bindings as any, {
    after_quarantine_open: (bundle) => {
      if (quarantineReplaced || path.basename(bundle) !== 'cc-source.bundle') return
      quarantineReplaced = true
      const bytes = readFileSync(bundle)
      renameSync(bundle, `${bundle}.moved`)
      writeFileSync(bundle, bytes, { mode: 0o400 })
    },
  }), 'phase1_recovery_bundle_invalid')
})

test('Recovery replay mapping is exact 8x10 and rejects reorder, skip, extra, duplicate, and protected intersections', () => {
  const fixture = mappingFixture()
  assert.doesNotThrow(() => validatePhase1RecoveryReplayMapping(fixture.record, fixture.bindings, fixture.observation as any))
  for (const mutate of [
    (value: Value) => { value.cc_gateway.source_commits[0] = 'f'.repeat(40) },
    (value: Value) => { value.cc_gateway.source_commits.pop() },
    (value: Value) => { value.sub2api.source_commits.push('f'.repeat(40)) },
    (value: Value) => { value.sub2api.replacement_commits.push(value.sub2api.replacement_commits[0]) },
    (value: Value) => { value.cc_gateway.skipped_source_commits.reverse() },
    (value: Value) => { value.cc_gateway.protected_path_intersection_count = 1 },
  ]) {
    const changed = clone(fixture.record); mutate(changed)
    expectCode(() => validatePhase1RecoveryReplayMapping(changed, fixture.bindings, fixture.observation as any), 'phase1_recovery_mapping_invalid')
  }

  const forgedReplacement = mappingFixture()
  writeFileSync(path.join(forgedReplacement.observation.cc_gateway.replacement_root, 'forged.txt'), 'forged\n')
  expectCode(() => validatePhase1RecoveryReplayMapping(forgedReplacement.record, forgedReplacement.bindings, forgedReplacement.observation as any), 'phase1_recovery_mapping_invalid')
})

test('Recovery T2 record binds owned GREEN, exact preserved RED, clean roots, lease, and zero side effects', () => {
  const roots = inputFixture()
  const testedHeads = {
    cc_gateway: git(roots.input.cc_root, 'rev-parse', 'HEAD'),
    sub2api: git(roots.input.sub2api_root, 'rev-parse', 'HEAD'),
  }
  const contexts: Value[] = []
  const contextBytes: Buffer[] = []
  const artifactCommits: string[] = []
  for (const sequence of [0, 1, 2]) {
    const leaseContext = context(sequence, testedHeads)
    if (sequence > 0) {
      leaseContext.predecessor.digest = sha256(contextBytes[sequence - 1])
      leaseContext.predecessor.artifact_commit = artifactCommits[sequence - 1]
    }
    contexts.push(leaseContext)
    contextBytes.push(Buffer.from(`${JSON.stringify(leaseContext)}\n`))
    artifactCommits.push(testedHeads.cc_gateway)
  }
  const leases = [] as ReturnType<typeof derivePhase1RunLease>[]
  for (const [index, leaseContext] of contexts.entries()) {
    leases.push(derivePhase1RunLease(leaseContext, {
      envelope_digest: digestDeliveryValue(derivePhase1BaselineEnvelope(leaseContext)),
      plan_bytes: planBytes,
      transition_id: `P1R-0${index + 1}`,
      predecessor_lease_digest: index === 0 ? null : digestDeliveryValue(leases[index - 1]),
      observed_delta_digest: index === 0 ? null : `sha256:${String(index).repeat(64)}`,
      execution_context_schema_bytes: executionContextSchemaBytes,
    }))
  }
  const leaseDigest = digestDeliveryValue(leases[2])
  const artifacts = {
    t0: path.join(roots.parent, 't0-result.json'),
    t1: path.join(roots.parent, 't1-result.json'),
    owned: path.join(roots.parent, 'owned-result.json'),
    preserved_red: path.join(roots.parent, 'preserved-red-result.json'),
  }
  const results: Value = {
    t0: { schema_version: 1, record_kind: 'phase_1_recovery_t0_result', status: 'green', lease_digest: leaseDigest, tested_heads: testedHeads },
    t1: { schema_version: 1, record_kind: 'phase_1_recovery_t1_result', status: 'green', lease_digest: leaseDigest, tested_heads: testedHeads, preserved_red: { cc_event_count: 61, cc_unique_count: 61, sidecar_event_count: 51, sidecar_unique_count: 51 } },
    owned: { schema_version: 1, record_kind: 'phase_1_recovery_owned_result', status: 'green', lease_digest: leaseDigest, tested_heads: testedHeads, owned_outcomes: { b1: 'green', b2: 'green', b3: 'green', listener_tls: 'green' }, external_side_effect_count: 0, unauthorized_socket_count: 0 },
    preserved_red: { schema_version: 1, record_kind: 'phase_1_recovery_preserved_red_result', status: 'green', lease_digest: leaseDigest, tested_heads: testedHeads, preserved_red: { cc_event_count: 61, cc_unique_count: 61, sidecar_event_count: 51, sidecar_unique_count: 51 } },
  }
  for (const kind of ['t0', 't1', 'owned', 'preserved_red'] as const) writeFileSync(artifacts[kind], `${JSON.stringify(results[kind])}\n`)
  const observation = {
    lease_chain: leases.map((lease, index) => ({ lease, context: contexts[index], context_bytes: contextBytes[index], artifact_commit: artifactCommits[index] })),
    plan_bytes: planBytes,
    execution_context_schema_bytes: executionContextSchemaBytes,
    cc_root: roots.input.cc_root,
    sub2api_root: roots.input.sub2api_root,
    result_artifacts: artifacts,
  }
  const valid = derivePhase1RecoveryT2Record(observation as any)
  assert.doesNotThrow(() => validatePhase1RecoveryT2Record(valid, observation as any))
  for (const kind of ['t0', 't1', 'owned', 'preserved_red'] as const) {
    assert.equal(valid.command_result_digests[kind], sha256(readFileSync(artifacts[kind])))
  }
  for (const mutate of [
    (value: Value) => { value.owned_outcomes.b2 = 'red' },
    (value: Value) => { value.preserved_red.cc_unique_count = 60 },
    (value: Value) => { value.external_side_effect_count = 1 },
    (value: Value) => { value.repositories_clean.sub2api = false },
  ]) {
    const changed = clone(valid); mutate(changed)
    expectCode(() => validatePhase1RecoveryT2Record(changed, observation as any), 'phase1_recovery_t2_invalid')
  }
  const forgedLease = {
    ...observation,
    lease_chain: observation.lease_chain.map((entry, index) => index === 2
      ? { ...entry, lease: { ...entry.lease, envelope_digest: `sha256:${'f'.repeat(64)}` } }
      : entry),
  }
  expectCode(() => validatePhase1RecoveryT2Record(valid, forgedLease as any), 'delivery_envelope_digest_mismatch')

  const brokenChain = {
    ...observation,
    lease_chain: observation.lease_chain.map((entry, index) => index === 2
      ? { ...entry, lease: { ...entry.lease, predecessor_lease_digest: `sha256:${'f'.repeat(64)}` } }
      : entry),
  }
  expectCode(() => derivePhase1RecoveryT2Record(brokenChain as any), 'delivery_lease_predecessor_invalid')
  expectCode(() => derivePhase1RecoveryT2Record({ ...observation, lease_chain: observation.lease_chain.slice(1) } as any), 'delivery_lease_sequence_invalid')

  for (const mutate of [
    (value: Value) => { value.predecessor.digest = `sha256:${'f'.repeat(64)}` },
    (value: Value) => { value.predecessor.artifact_commit = 'f'.repeat(40) },
  ]) {
    const changedContext = clone(contexts[2]); mutate(changedContext)
    const changedChain = observation.lease_chain.map((entry, index) => index === 2
      ? { ...entry, context: changedContext, context_bytes: Buffer.from(`${JSON.stringify(changedContext)}\n`) }
      : entry)
    expectCode(() => derivePhase1RecoveryT2Record({ ...observation, lease_chain: changedChain } as any), 'delivery_lease_predecessor_invalid')
  }

  const driftedContext = clone(contexts[2])
  driftedContext.repositories.cc_gateway.baseline_main_head = 'f'.repeat(40)
  const driftedLease = derivePhase1RunLease(driftedContext, {
    envelope_digest: digestDeliveryValue(derivePhase1BaselineEnvelope(driftedContext)),
    plan_bytes: planBytes,
    transition_id: 'P1R-03',
    predecessor_lease_digest: digestDeliveryValue(leases[1]),
    observed_delta_digest: `sha256:${'2'.repeat(64)}`,
    execution_context_schema_bytes: executionContextSchemaBytes,
  })
  const driftedChain = observation.lease_chain.map((entry, index) => index === 2
    ? { ...entry, lease: driftedLease, context: driftedContext, context_bytes: Buffer.from(`${JSON.stringify(driftedContext)}\n`) }
    : entry)
  expectCode(() => derivePhase1RecoveryT2Record({ ...observation, lease_chain: driftedChain } as any), 'delivery_lease_predecessor_invalid')

  const invalidSuccessor = context(2)
  invalidSuccessor.recovery_state = 'caller_selected'
  expectCode(() => derivePhase1RunLease(invalidSuccessor, {
    envelope_digest: digestDeliveryValue(derivePhase1BaselineEnvelope(invalidSuccessor)),
    plan_bytes: planBytes,
    transition_id: 'P1R-03',
    predecessor_lease_digest: digestDeliveryValue(leases[1]),
    observed_delta_digest: `sha256:${'2'.repeat(64)}`,
    execution_context_schema_bytes: executionContextSchemaBytes,
  }), 'delivery_context_authority_mismatch')

  const originalOwned = readFileSync(artifacts.owned)
  writeFileSync(artifacts.owned, `${JSON.stringify({ ...results.owned, external_side_effect_count: 1 })}\n`)
  expectCode(() => validatePhase1RecoveryT2Record(valid, observation as any), 'phase1_recovery_t2_invalid')
  writeFileSync(artifacts.owned, originalOwned)
  const originalT0 = readFileSync(artifacts.t0)
  writeFileSync(artifacts.t0, `${JSON.stringify(results.t0, null, 2)}\n`)
  expectCode(() => validatePhase1RecoveryT2Record(valid, observation as any), 'phase1_recovery_t2_invalid')
  writeFileSync(artifacts.t0, originalT0)
  writeFileSync(path.join(roots.input.cc_root, 'advanced.txt'), 'advanced\n')
  git(roots.input.cc_root, 'add', 'advanced.txt')
  git(roots.input.cc_root, 'commit', '-qm', 'advance tested head')
  expectCode(() => derivePhase1RecoveryT2Record(observation as any), 'phase1_recovery_t2_invalid')
  writeFileSync(path.join(roots.input.cc_root, 'dirty.txt'), 'dirty\n')
  expectCode(() => derivePhase1RecoveryT2Record(observation as any), 'phase1_recovery_t2_invalid')
})

test('Go RED evidence requires the exact semantic subtest signature and assertion marker', () => {
  const tests = [
    'TestFormalPoolOnboardingPublicOriginAuthority',
    'TestFormalPoolOnboardingPublicOriginAuthority/forwarded_host_is_untrusted',
    'TestFormalPoolOnboardingPublicOriginAuthority/forwarded_proto_is_untrusted',
    'TestFormalPoolOnboardingPublicOriginAuthority/host_is_untrusted',
  ]
  const events = [
    ...tests.map((Test) => JSON.stringify({ Action: 'fail', Test })),
    JSON.stringify({ Action: 'output', Output: 'without configured origin or trusted ingress, changing one request-derived origin dimension must not change the returned authority' }),
  ].join('\n')
  assert.equal(parsePhase1RecoveryGoRedEvidence(events, 'b3').failure_signature_digest, PHASE1_RECOVERY_BINDINGS.pre_replay_failure_signatures.b3.failed_tests_digest)
  expectCode(() => parsePhase1RecoveryGoRedEvidence(events.replace('/host_is_untrusted', '/unrelated_failure'), 'b3'), 'phase1_recovery_vertical_red_mismatch')
  expectCode(() => parsePhase1RecoveryGoRedEvidence(events.replace('changing one request-derived origin dimension', 'unrelated assertion'), 'b3'), 'phase1_recovery_vertical_red_mismatch')
})

test('pre-replay transaction requires four exact real RED records plus the replay sentinel', async () => {
  const dependencies: Phase1RecoveryDependencies = {
    validate_inputs: () => undefined,
    validate_outputs: () => undefined,
    observe_baseline: () => ({ cc_gateway: '1'.repeat(40), sub2api: '2'.repeat(40) }),
    run_red: (family) => ({ family, status: 'expected_fail', leaf_names: PHASE1_RECOVERY_BINDINGS.pre_replay_red[family], classifications: PHASE1_RECOVERY_BINDINGS.pre_replay_classifications[family], failure_signature_digest: PHASE1_RECOVERY_BINDINGS.pre_replay_failure_signatures[family].failed_tests_digest, observer: { boundary: family === 'listener_tls' ? 'active_listener_inventory' : 'sandbox_network_deny', external_side_effect_count: 0, unauthorized_socket_count: 0 }, external_side_effect_count: 0, unauthorized_socket_count: 0 }),
    replay_required: () => true,
    persist_record: () => undefined,
  }
  const input = parsePhase1RecoveryCli(['pre-replay-red', '--cc-root', '/tmp/cc-main', '--sub2api-root', '/tmp/sub-main', '--cc-bundle', '/tmp/cc.bundle', '--sub2api-bundle', '/tmp/sub.bundle', '--output-root', '/tmp/output'])
  const record = await runPhase1RecoveryPreReplay(input, PHASE1_RECOVERY_BINDINGS, dependencies)
  assert.equal(record.status, 'red_confirmed')
  assert.deepEqual(record.families.map((entry: Value) => entry.family), ['b1', 'b2', 'b3', 'listener_tls'])
  assert.equal(record.replay_sentinel, 'phase1_recovery_replay_required')

  const missing = { ...dependencies, run_red: (family: keyof typeof PHASE1_RECOVERY_BINDINGS.pre_replay_red) => ({ family, status: family === 'b3' ? 'pass' : 'expected_fail', leaf_names: PHASE1_RECOVERY_BINDINGS.pre_replay_red[family], classifications: PHASE1_RECOVERY_BINDINGS.pre_replay_classifications[family], failure_signature_digest: PHASE1_RECOVERY_BINDINGS.pre_replay_failure_signatures[family].failed_tests_digest, observer: { boundary: family === 'listener_tls' ? 'active_listener_inventory' as const : 'sandbox_network_deny' as const, external_side_effect_count: 0 as const, unauthorized_socket_count: 0 as const }, external_side_effect_count: 0 as const, unauthorized_socket_count: 0 as const }) }
  await assert.rejects(runPhase1RecoveryPreReplay(input, PHASE1_RECOVERY_BINDINGS, missing), (error: unknown) => (error as { code?: string }).code === 'phase1_recovery_vertical_red_mismatch')
})

test('terminal Recovery transition emits a terminal record and cannot mint a successor lease', () => {
  const contract = parsePhase1RecoveryContract(planBytes)
  const final = contract.rows.at(-1)!
  const current = context(14)
  const envelope = digestDeliveryValue(derivePhase1BaselineEnvelope(current))
  const lease = derivePhase1RunLease(current, {
    envelope_digest: envelope,
    plan_bytes: planBytes,
    transition_id: final.id,
    predecessor_lease_digest: `sha256:${'9'.repeat(64)}`,
    observed_delta_digest: null,
    execution_context_schema_bytes: executionContextSchemaBytes,
  })
  const observed = [{ category: 'external:add:phase1-exit-record' }]
  const terminal = derivePhase1TerminalRecord({
    lease,
    context: current,
    plan_bytes: planBytes,
    observed_delta: observed,
    completed_at: '2026-07-18T18:15:00Z',
    now: Date.parse('2026-07-18T18:15:00Z'),
  })
  assert.equal(terminal.state, 'exit_verified')
  assert.equal(terminal.transition_id, 'P1R-14')
  assert.equal(terminal.predecessor_lease_digest, digestDeliveryValue(lease))
  assert.equal(terminal.observed_delta_digest, digestDeliveryValue(observed))
})
