import { createHash } from 'node:crypto'
import Ajv2020 from 'ajv/dist/2020.js'

type JsonObject = Record<string, any>

export type DeliveryTransition = Readonly<{
  id: string
  from: string
  to: string
  command: string
  condition: string
  allowed_delta: readonly string[]
}>

export type Phase1RunLease = Readonly<{
  envelope_digest: string
  sequence: number
  state: string
  transition_id: string
  transition_contract_digest: string
  permitted_delta_digest: string
  predecessor_lease_digest: string | null
  issued_at: string
  expires_at: string
  repository_heads_and_clean_state_digests: Readonly<Record<string, Readonly<{
    head: string
    clean_state_digest: string
  }>>>
  observed_delta_digest: string | null
}>

export type Phase1TerminalRecord = Readonly<{
  schema_version: 1
  record_kind: 'phase_1_terminal_record'
  envelope_digest: string
  sequence: number
  state: string
  transition_id: string
  transition_contract_digest: string
  predecessor_lease_digest: string
  observed_delta_digest: string
  completed_at: string
  repository_heads_and_clean_state_digests: Phase1RunLease['repository_heads_and_clean_state_digests']
}>

const TRANSITION_START = '<!-- ORACLE_DELIVERY_TRANSITIONS_BEGIN -->'
const TRANSITION_END = '<!-- ORACLE_DELIVERY_TRANSITIONS_END -->'
const REVIEWED_TRANSITION_SOURCE_DIGEST = 'sha256:08952a6f2ba48b671b6f8792651040a7292e2a2a4bc8036d8d9e851dc6e46463'
const RECOVERY_TRANSITION_START = '<!-- ORACLE_PHASE1_RECOVERY_TRANSITIONS_BEGIN -->'
const RECOVERY_TRANSITION_END = '<!-- ORACLE_PHASE1_RECOVERY_TRANSITIONS_END -->'
const REVIEWED_RECOVERY_SOURCE_DIGEST = 'sha256:4fb422c47b62519552fe1d21dee53576309df145c280d05c41d575bfdb82c3fe'
const REVIEWED_RECOVERY_CONTEXT_SCHEMA_DIGEST = 'sha256:9860d5ae3e3500698052e166bba37197ee3a84a27dea2dac8f5700df863fa099'
const DIGEST = /^sha256:[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40,64}$/
const DELIVERY_TRANSITION_ID = /^DM-[0-9]{2}[A-Z]?$/
const RECOVERY_TRANSITION_ID = /^P1R-(?:0[1-9]|1[0-4])(?:[AB])?$/
const TRANSITION_ID = /^(?:DM-[0-9]{2}[A-Z]?|P1R-(?:0[1-9]|1[0-4])(?:[AB])?)$/
const TRANSITION_KEYS = ['allowed_delta', 'command', 'condition', 'from', 'id', 'to']
const LEASE_KEYS = [
  'envelope_digest', 'expires_at', 'issued_at', 'observed_delta_digest', 'permitted_delta_digest',
  'predecessor_lease_digest', 'repository_heads_and_clean_state_digests', 'sequence', 'state',
  'transition_contract_digest', 'transition_id',
]
const DELIVERY_COMMANDS = new Set([
  'freeze-source-authority',
  'reproduce-real-red',
  'implement-declared-nine-path-wave',
  'run-real-green-transaction',
  'run-bounded-integrated-review',
  'accept-zero-material-findings',
  'apply-one-closure-batch',
  'rerun-green-and-closure-review',
  'accept-closure',
  'merge-and-rerun-real-green',
  'commit-transition-exit-report',
])
const RECOVERY_COMMANDS = new Set([
  'run-pre-replay-vertical-red',
  'rehydrate-reviewed-implementation',
  'run-replay-verification',
  'issue-feature-capture-lease',
  'capture-feature-evidence',
  'run-stable-tip-campaign-and-bounded-integrated-review',
  'accept-zero-material-findings',
  'apply-one-product-closure-wave',
  'rerun-affected-gates-campaigns-and-closure-review',
  'ordinary-merge-reviewed-implementation',
  'capture-and-commit-post-integration-evidence',
  'review-post-integration-evidence',
  'ordinary-merge-post-integration-evidence',
  'verify-final-remote-mains',
  'publish-phase1-exit',
])
const DECLARED_IMPLEMENTATION_PATHS = Object.freeze([
  'tests/oracle-lab-delivery-authority.test.ts',
  'tests/oracle-lab-phase-1-authority-restart.test.ts',
  'tests/oracle-lab-phase-1-planning.test.ts',
  'tests/oracle-lab-phase-1-transition-rehearsal.test.ts',
  'tools/oracle-lab/delivery-authority.ts',
  'tools/oracle-lab/oracle-phase1-authority-restart',
  'tools/oracle-lab/phase-1-authority-bootstrap.mjs',
  'tools/oracle-lab/phase-1-authority-restart.ts',
  'tools/oracle-lab/phase-1-transition-rehearsal.ts',
].sort(compareBytes))

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: JsonObject, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort(compareBytes)
  const sortedExpected = [...expected].sort(compareBytes)
  return JSON.stringify(actual) === JSON.stringify(sortedExpected)
}

function compareBytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

export function canonicalDeliveryJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalDeliveryJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort(compareBytes).map((key) => `${JSON.stringify(key)}:${canonicalDeliveryJson(record[key])}`).join(',')}}`
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) fail('delivery_value_not_canonical', 'value cannot be represented as canonical JSON')
  return encoded
}

export function digestDeliveryValue(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalDeliveryJson(value)).digest('hex')}`
}

function validateTransitionRow(value: unknown, idPattern: RegExp, commands: ReadonlySet<string>): asserts value is DeliveryTransition {
  if (!isObject(value) || !exactKeys(value, TRANSITION_KEYS)
    || typeof value.id !== 'string' || !idPattern.test(value.id)
    || typeof value.from !== 'string' || value.from.length === 0
    || typeof value.to !== 'string' || value.to.length === 0
    || typeof value.command !== 'string'
    || typeof value.condition !== 'string' || value.condition.length === 0
    || !Array.isArray(value.allowed_delta) || value.allowed_delta.length === 0
    || value.allowed_delta.some((entry: unknown) => typeof entry !== 'string' || entry.length === 0)
    || new Set(value.allowed_delta).size !== value.allowed_delta.length) {
    fail('delivery_transition_malformed', 'delivery transition row is malformed')
  }
  if (!commands.has(value.command)) fail('delivery_transition_unknown_command', 'delivery transition command is not reviewed')
}

function parseTransitionContract(planBytes: Buffer | string, binding: Readonly<{
  start: string
  end: string
  id_pattern: RegExp
  commands: ReadonlySet<string>
  digest_kind: 'source-order' | 'canonical'
}>): Readonly<{
  rows: readonly DeliveryTransition[]
  source_digest: string
}> {
  const plan = Buffer.isBuffer(planBytes) ? planBytes.toString('utf8') : planBytes
  if (Buffer.from(plan, 'utf8').toString('utf8') !== plan) fail('delivery_transition_malformed', 'transition plan must be valid UTF-8')
  const starts = plan.split(binding.start).length - 1
  const ends = plan.split(binding.end).length - 1
  if (starts !== 1 || ends !== 1 || plan.indexOf(binding.start) >= plan.indexOf(binding.end)) {
    fail('delivery_transition_malformed', 'transition markers must occur exactly once in order')
  }
  const marked = plan.slice(plan.indexOf(binding.start) + binding.start.length, plan.indexOf(binding.end))
  const match = marked.match(/^\n```json\n([\s\S]*?)\n```\n$/)
  if (!match) fail('delivery_transition_malformed', 'transition marker body must be one exact JSON fence')
  let parsed: unknown
  try { parsed = JSON.parse(match[1]) } catch { fail('delivery_transition_malformed', 'transition JSON is malformed') }
  if (!Array.isArray(parsed) || parsed.length === 0) fail('delivery_transition_malformed', 'transition contract must be a nonempty array')
  for (const row of parsed) validateTransitionRow(row, binding.id_pattern, binding.commands)
  const rows = parsed as DeliveryTransition[]
  const ids = rows.map((row) => row.id)
  if (new Set(ids).size !== ids.length) fail('delivery_transition_duplicate_id', 'transition IDs must be unique')
  if (JSON.stringify(ids) !== JSON.stringify([...ids].sort(compareBytes))) {
    fail('delivery_transition_noncanonical_order', 'transition rows must remain in canonical ID order')
  }
  const branches = new Map<string, DeliveryTransition[]>()
  for (const row of rows) branches.set(row.from, [...(branches.get(row.from) ?? []), row])
  for (const successors of branches.values()) {
    const conditions = successors.map((row) => row.condition)
    if (new Set(conditions).size !== conditions.length || (successors.length > 1 && conditions.includes('always'))) {
      fail('delivery_transition_ambiguous_successor', 'transition state has ambiguous conditional successors')
    }
  }
  const frozen = deepFreeze(structuredClone(rows))
  const sourceDigest = binding.digest_kind === 'canonical'
    ? digestDeliveryValue(rows)
    : `sha256:${createHash('sha256').update(JSON.stringify(rows)).digest('hex')}`
  return deepFreeze({ rows: frozen, source_digest: sourceDigest })
}

export function parseDeliveryTransitionContract(planBytes: Buffer | string): ReturnType<typeof parseTransitionContract> {
  return parseTransitionContract(planBytes, {
    start: TRANSITION_START,
    end: TRANSITION_END,
    id_pattern: DELIVERY_TRANSITION_ID,
    commands: DELIVERY_COMMANDS,
    digest_kind: 'source-order',
  })
}

export function parsePhase1RecoveryContract(planBytes: Buffer | string): ReturnType<typeof parseTransitionContract> {
  const contract = parseTransitionContract(planBytes, {
    start: RECOVERY_TRANSITION_START,
    end: RECOVERY_TRANSITION_END,
    id_pattern: RECOVERY_TRANSITION_ID,
    commands: RECOVERY_COMMANDS,
    digest_kind: 'canonical',
  })
  if (contract.source_digest !== REVIEWED_RECOVERY_SOURCE_DIGEST) {
    fail('delivery_transition_source_drift', 'Recovery authority is not the exact reviewed plan block')
  }
  return contract
}

function reviewedTransitionContract(planBytes: Buffer | string): ReturnType<typeof parseDeliveryTransitionContract> {
  const contract = parseDeliveryTransitionContract(planBytes)
  if (contract.source_digest !== REVIEWED_TRANSITION_SOURCE_DIGEST) {
    fail('delivery_transition_source_drift', 'transition authority is not the exact reviewed plan block')
  }
  return contract
}

function reviewedContractForTransition(planBytes: Buffer | string, transitionId: string): ReturnType<typeof parseTransitionContract> {
  if (DELIVERY_TRANSITION_ID.test(transitionId)) return reviewedTransitionContract(planBytes)
  if (RECOVERY_TRANSITION_ID.test(transitionId)) return parsePhase1RecoveryContract(planBytes)
  fail('delivery_transition_contract_mismatch', 'transition authority kind is unsupported')
}

function assertContextAuthority(
  context: JsonObject,
  transitionId: string,
  executionContextSchemaBytes?: Buffer | string,
): void {
  const recovery = RECOVERY_TRANSITION_ID.test(transitionId)
  const expectedKind = recovery ? 'phase_1_recovery_context' : 'phase_1_execution_context'
  if (context.context_kind !== expectedKind) fail('delivery_context_authority_mismatch', 'context kind does not match transition authority')
  if (!recovery || context.sequence !== 0) return
  if (executionContextSchemaBytes === undefined) fail('delivery_context_authority_mismatch', 'Recovery sequence zero requires the reviewed carrier schema')
  const schemaBytes = Buffer.isBuffer(executionContextSchemaBytes) ? executionContextSchemaBytes : Buffer.from(executionContextSchemaBytes, 'utf8')
  if (`sha256:${createHash('sha256').update(schemaBytes).digest('hex')}` !== REVIEWED_RECOVERY_CONTEXT_SCHEMA_DIGEST) {
    fail('delivery_context_authority_mismatch', 'Recovery carrier schema bytes are not reviewed')
  }
  let schema: unknown
  try { schema = JSON.parse(schemaBytes.toString('utf8')) } catch { fail('delivery_context_authority_mismatch', 'Recovery carrier schema is malformed') }
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema)
  if (!validate(context)) fail('delivery_context_authority_mismatch', 'Recovery sequence-zero context fails the closed carrier schema')
}

function repositoryEnvelope(repository: JsonObject): JsonObject {
  const projection = {
    baseline_main_head: repository.baseline_main_head,
    remote_name: repository.remote_name,
    remote_url_digest: repository.remote_url_digest,
    tracking_ref: repository.tracking_ref,
    implementation_branch: repository.implementation_branch,
  }
  if (!COMMIT.test(String(projection.baseline_main_head)) || projection.remote_name !== 'muqihang'
    || !DIGEST.test(String(projection.remote_url_digest)) || typeof projection.tracking_ref !== 'string'
    || typeof projection.implementation_branch !== 'string') {
    fail('delivery_context_invalid', 'repository baseline authority is malformed')
  }
  return projection
}

export function derivePhase1BaselineEnvelope(context: unknown): Readonly<JsonObject> {
  if (!isObject(context) || context.schema_version !== 2
    || (context.context_kind !== 'phase_1_execution_context' && context.context_kind !== 'phase_1_recovery_context')
    || !isObject(context.repositories) || !isObject(context.repositories.cc_gateway) || !isObject(context.repositories.sub2api)) {
    fail('delivery_context_invalid', 'Phase 1 execution context is malformed')
  }
  const repositories = Object.fromEntries(Object.keys(context.repositories).sort(compareBytes).map((name) => [name, repositoryEnvelope(context.repositories[name])]))
  const authority = context.context_kind === 'phase_1_recovery_context'
    ? { recovery_authority: context.recovery_authority }
    : { planning_provenance: context.planning_provenance }
  const projection = {
    schema_version: context.schema_version,
    context_kind: context.context_kind,
    plan: context.plan,
    ...authority,
    approval_receipt: context.approval_receipt,
    gate_schemas: context.gate_schemas,
    repositories,
    shared_contract: context.shared_contract,
    authority_order: context.authority_order,
    selected_requirements: context.selected_requirements,
    implementation_entry: context.implementation_entry,
    disabled_capabilities: context.disabled_capabilities,
  }
  return deepFreeze(structuredClone(projection))
}

export function assertPhase1BaselineEnvelopeUnchanged(initialContext: unknown, candidateContext: unknown): void {
  if (digestDeliveryValue(derivePhase1BaselineEnvelope(initialContext)) !== digestDeliveryValue(derivePhase1BaselineEnvelope(candidateContext))) {
    fail('delivery_envelope_drift', 'immutable Phase 1 baseline envelope drifted')
  }
}

function contextRepositories(context: JsonObject): Readonly<Record<string, Readonly<{ head: string; clean_state_digest: string }>>> {
  if (!isObject(context.repositories)) fail('delivery_context_invalid', 'context repository observations are unavailable')
  const entries = Object.keys(context.repositories).sort(compareBytes).map((name) => {
    const repository = context.repositories[name]
    if (!isObject(repository) || repository.pre_issue_clean !== true || !COMMIT.test(String(repository.authorized_parent_head))
      || !isObject(repository.validation_status) || !DIGEST.test(String(repository.validation_status.digest))) {
      fail('delivery_lease_dirty_result', 'lease repository observation must be clean and digest-bound')
    }
    return [name, { head: repository.authorized_parent_head, clean_state_digest: repository.validation_status.digest }]
  })
  return deepFreeze(Object.fromEntries(entries))
}

function validateLeaseShape(value: unknown): asserts value is Phase1RunLease {
  if (!isObject(value) || !exactKeys(value, LEASE_KEYS) || !DIGEST.test(String(value.envelope_digest))
    || !Number.isInteger(value.sequence) || value.sequence < 0 || typeof value.state !== 'string'
    || !TRANSITION_ID.test(String(value.transition_id)) || !DIGEST.test(String(value.transition_contract_digest))
    || !DIGEST.test(String(value.permitted_delta_digest))
    || (value.predecessor_lease_digest !== null && !DIGEST.test(String(value.predecessor_lease_digest)))
    || (value.observed_delta_digest !== null && !DIGEST.test(String(value.observed_delta_digest)))
    || !isObject(value.repository_heads_and_clean_state_digests)) {
    fail('delivery_lease_malformed', 'run lease is malformed')
  }
  const issued = Date.parse(value.issued_at)
  const expires = Date.parse(value.expires_at)
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued) fail('delivery_lease_malformed', 'run lease time window is invalid')
  for (const repository of Object.values(value.repository_heads_and_clean_state_digests)) {
    if (!isObject(repository) || !exactKeys(repository, ['clean_state_digest', 'head'])
      || !COMMIT.test(String(repository.head)) || !DIGEST.test(String(repository.clean_state_digest))) {
      fail('delivery_lease_malformed', 'run lease repository binding is malformed')
    }
  }
}

function assertLeaseMatchesContext(lease: Phase1RunLease, context: unknown): void {
  if (!isObject(context) || lease.sequence !== context.sequence
    || lease.issued_at !== context.generated_at || lease.expires_at !== context.expires_at
    || canonicalDeliveryJson(lease.repository_heads_and_clean_state_digests) !== canonicalDeliveryJson(contextRepositories(context))) {
    fail('delivery_lease_context_mismatch', 'run lease does not match its execution-context observations')
  }
}

function assertLeaseMatchesTransition(lease: Phase1RunLease, transition: DeliveryTransition): void {
  if (lease.state !== transition.from || lease.transition_id !== transition.id
    || lease.transition_contract_digest !== digestDeliveryValue(transition)
    || lease.permitted_delta_digest !== digestDeliveryValue(transition.allowed_delta)) {
    fail('delivery_transition_contract_mismatch', 'run lease does not bind the reviewed transition row')
  }
}

export function derivePhase1RunLease(context: unknown, input: Readonly<{
  envelope_digest: string
  plan_bytes: Buffer | string
  transition_id: string
  predecessor_lease_digest: string | null
  observed_delta_digest: string | null
  execution_context_schema_bytes?: Buffer | string
}>): Phase1RunLease {
  if (!isObject(context) || !Number.isInteger(context.sequence) || !DIGEST.test(input.envelope_digest)) {
    fail('delivery_context_invalid', 'lease context or envelope digest is invalid')
  }
  assertContextAuthority(context, input.transition_id, input.execution_context_schema_bytes)
  if (input.envelope_digest !== digestDeliveryValue(derivePhase1BaselineEnvelope(context))) {
    fail('delivery_envelope_digest_mismatch', 'lease envelope digest does not match the derived immutable baseline')
  }
  const contract = reviewedContractForTransition(input.plan_bytes, input.transition_id)
  const transition = contract.rows.find((row) => row.id === input.transition_id)
  if (!transition) fail('delivery_transition_contract_mismatch', 'selected transition is absent from the reviewed plan')
  const initialState = RECOVERY_TRANSITION_ID.test(transition.id) ? 'baseline_frozen' : 'candidate'
  if (context.sequence === 0 && (transition !== contract.rows[0] || transition.from !== initialState)) {
    fail('delivery_transition_initial_invalid', 'sequence zero must bind the first transition from its reviewed entry state')
  }
  if ((context.sequence === 0) !== (input.predecessor_lease_digest === null)
    || (input.predecessor_lease_digest !== null && !DIGEST.test(input.predecessor_lease_digest))
    || (input.observed_delta_digest !== null && !DIGEST.test(input.observed_delta_digest))) {
    fail('delivery_lease_predecessor_invalid', 'lease predecessor or observed-delta digest is invalid')
  }
  const lease: Phase1RunLease = {
    envelope_digest: input.envelope_digest,
    sequence: context.sequence,
    state: transition.from,
    transition_id: transition.id,
    transition_contract_digest: digestDeliveryValue(transition),
    permitted_delta_digest: digestDeliveryValue(transition.allowed_delta),
    predecessor_lease_digest: input.predecessor_lease_digest,
    issued_at: context.generated_at,
    expires_at: context.expires_at,
    repository_heads_and_clean_state_digests: contextRepositories(context),
    observed_delta_digest: input.observed_delta_digest,
  }
  validateLeaseShape(lease)
  return deepFreeze(lease)
}

export function validatePhase1RunLeaseAuthority(input: Readonly<{
  lease: Phase1RunLease
  context: unknown
  plan_bytes: Buffer | string
}>): void {
  validateLeaseShape(input.lease)
  if (!isObject(input.context)) fail('delivery_context_invalid', 'lease authority context is malformed')
  assertContextAuthority(input.context, input.lease.transition_id)
  if (input.lease.envelope_digest !== digestDeliveryValue(derivePhase1BaselineEnvelope(input.context))) {
    fail('delivery_envelope_digest_mismatch', 'lease envelope digest does not match the derived immutable baseline')
  }
  assertLeaseMatchesContext(input.lease, input.context)
  const contract = reviewedContractForTransition(input.plan_bytes, input.lease.transition_id)
  const transition = contract.rows.find((row) => row.id === input.lease.transition_id)
  if (!transition) fail('delivery_transition_contract_mismatch', 'lease transition is absent from reviewed authority')
  assertLeaseMatchesTransition(input.lease, transition)
}

function validateChainCommon(input: Readonly<{
  previous_lease: Phase1RunLease
  next_lease: Phase1RunLease
  previous_context: unknown
  next_context: unknown
  now: number
}>): void {
  validateLeaseShape(input.previous_lease)
  validateLeaseShape(input.next_lease)
  assertPhase1BaselineEnvelopeUnchanged(input.previous_context, input.next_context)
  if (input.next_lease.sequence !== input.previous_lease.sequence + 1) fail('delivery_lease_sequence_invalid', 'lease sequence must be contiguous')
  if (input.next_lease.predecessor_lease_digest !== digestDeliveryValue(input.previous_lease)) fail('delivery_lease_predecessor_invalid', 'lease predecessor digest is not immediate')
  if (input.next_lease.envelope_digest !== input.previous_lease.envelope_digest) fail('delivery_envelope_drift', 'lease envelope digest drifted')
  assertLeaseMatchesContext(input.previous_lease, input.previous_context)
  assertLeaseMatchesContext(input.next_lease, input.next_context)
  if (!Number.isFinite(input.now) || input.now < Date.parse(input.next_lease.issued_at) || input.now >= Date.parse(input.next_lease.expires_at)) {
    fail('delivery_lease_expired', 'successor lease is not currently executable')
  }
}

export function validatePhase1LeaseRefresh(input: Readonly<{
  previous_lease: Phase1RunLease
  next_lease: Phase1RunLease
  previous_context: unknown
  next_context: unknown
  plan_bytes: Buffer | string
  now: number
}>): void {
  validateChainCommon(input)
  const contract = reviewedContractForTransition(input.plan_bytes, input.previous_lease.transition_id)
  const transition = contract.rows.find((row) => row.id === input.previous_lease.transition_id)
  if (!transition) fail('delivery_transition_contract_mismatch', 'refresh transition is absent from the reviewed plan')
  assertLeaseMatchesTransition(input.previous_lease, transition)
  assertLeaseMatchesTransition(input.next_lease, transition)
  if (input.next_lease.state !== input.previous_lease.state || input.next_lease.transition_id !== input.previous_lease.transition_id
    || input.next_lease.transition_contract_digest !== input.previous_lease.transition_contract_digest
    || input.next_lease.permitted_delta_digest !== input.previous_lease.permitted_delta_digest
    || input.next_lease.observed_delta_digest !== null) {
    fail('delivery_lease_refresh_invalid', 'same-state refresh changed transition authority')
  }
  for (const name of Object.keys(input.previous_lease.repository_heads_and_clean_state_digests)) {
    if (input.next_lease.repository_heads_and_clean_state_digests[name]?.head !== input.previous_lease.repository_heads_and_clean_state_digests[name].head) {
      fail('delivery_undeclared_head_advance', 'same-state refresh cannot advance repository heads')
    }
  }
}

function assertObservedDelta(previous: DeliveryTransition, observed: readonly JsonObject[], digest: string | null): void {
  if (digest !== digestDeliveryValue(observed)) fail('delivery_observed_delta_mismatch', 'observed delta digest drifted')
  const categories = observed.map((record) => record?.category)
  if (new Set(categories).size !== categories.length) fail('delivery_observed_delta_forbidden', 'observed delta categories must be unique')
  for (const record of observed) {
    if (!isObject(record) || typeof record.category !== 'string' || !previous.allowed_delta.includes(record.category)) {
      fail('delivery_observed_delta_forbidden', 'observed delta is not permitted by the reviewed transition')
    }
  }
  for (const token of previous.allowed_delta) {
    const record = observed.find((candidate) => candidate.category === token)
    if (!record) fail('delivery_observed_delta_missing', `required observed delta ${token} is absent`)
    if (token.startsWith('forbid:')) {
      if (!exactKeys(record, ['artifact_absent', 'category']) || record.artifact_absent !== true) {
        fail('delivery_observed_delta_forbidden', 'forbid assertion must be one exact explicit absence proof')
      }
    } else if (token === 'git:implementation-root:declared-nine-paths') {
      if (!Array.isArray(record.paths) || canonicalDeliveryJson([...record.paths].sort(compareBytes)) !== canonicalDeliveryJson(DECLARED_IMPLEMENTATION_PATHS)) {
        fail('delivery_observed_delta_forbidden', 'implementation path delta is not the declared nine-path set')
      }
    } else if (token === 'git:implementation-root:max-four-commits' || token === 'git:implementation-root:max-one-closure-commit') {
      const maximum = token.endsWith('max-four-commits') ? 4 : 1
      if (!Number.isInteger(record.commit_count) || record.commit_count < 0 || record.commit_count > maximum
        || !Array.isArray(record.commits) || record.commits.length !== record.commit_count
        || new Set(record.commits).size !== record.commits.length
        || record.commits.some((commit: unknown) => typeof commit !== 'string' || !COMMIT.test(commit))) {
        fail('delivery_observed_delta_forbidden', 'bounded implementation commit delta is malformed')
      }
    } else if (token === 'git:implementation-root:none') {
      if (record.clean !== true || typeof record.head !== 'string' || !COMMIT.test(record.head)) {
        fail('delivery_observed_delta_forbidden', 'no-change implementation proof is malformed')
      }
    }
  }
}

export function validatePhase1LeaseSuccessor(input: Readonly<{
  previous_lease: Phase1RunLease
  next_lease: Phase1RunLease
  previous_context: unknown
  next_context: unknown
  plan_bytes: Buffer | string
  observed_delta: readonly JsonObject[]
  now: number
  satisfied_condition?: string
}>): void {
  validateChainCommon(input)
  if (input.now >= Date.parse(input.previous_lease.expires_at)) fail('delivery_lease_expired', 'expired lease cannot authorize a transition command')
  const contract = reviewedContractForTransition(input.plan_bytes, input.previous_lease.transition_id)
  const previous = contract.rows.find((row) => row.id === input.previous_lease.transition_id)
  if (!previous) fail('delivery_transition_contract_mismatch', 'previous transition row is unavailable')
  assertLeaseMatchesTransition(input.previous_lease, previous)
  if (input.next_lease.state !== previous.to) fail('delivery_transition_state_invalid', 'successor state is not declared by the previous transition')
  const candidates = contract.rows.filter((row) => row.from === previous.to)
  if (candidates.length === 0) fail('delivery_transition_state_invalid', 'successor state has no reviewed command')
  if (candidates.length > 1 && input.satisfied_condition === undefined) fail('delivery_transition_ambiguous_successor', 'conditional successor requires one reviewed outcome')
  const selected = candidates.length === 1
    ? candidates[0]
    : candidates.find((row) => row.condition === input.satisfied_condition)
  if (!selected || (input.satisfied_condition !== undefined && selected.condition !== input.satisfied_condition)) {
    fail('delivery_transition_condition_mismatch', 'successor condition does not select the bound transition')
  }
  if (selected.id !== input.next_lease.transition_id) {
    fail('delivery_transition_condition_mismatch', 'condition outcome selects a different reviewed transition')
  }
  assertLeaseMatchesTransition(input.next_lease, selected)
  assertObservedDelta(previous, input.observed_delta, input.next_lease.observed_delta_digest)
}

export function derivePhase1TerminalRecord(input: Readonly<{
  lease: Phase1RunLease
  context: unknown
  plan_bytes: Buffer | string
  observed_delta: readonly JsonObject[]
  completed_at: string
  now: number
}>): Phase1TerminalRecord {
  validateLeaseShape(input.lease)
  assertLeaseMatchesContext(input.lease, input.context)
  const contract = reviewedContractForTransition(input.plan_bytes, input.lease.transition_id)
  const transition = contract.rows.find((row) => row.id === input.lease.transition_id)
  if (!transition) fail('delivery_transition_contract_mismatch', 'terminal transition row is unavailable')
  assertLeaseMatchesTransition(input.lease, transition)
  if (transition.to !== 'exit_verified' || contract.rows.some((row) => row.from === transition.to)) {
    fail('delivery_terminal_transition_invalid', 'selected transition is not the reviewed terminal edge')
  }
  const completed = Date.parse(input.completed_at)
  if (!Number.isFinite(input.now) || completed !== input.now || input.now < Date.parse(input.lease.issued_at)
    || input.now >= Date.parse(input.lease.expires_at)) {
    fail('delivery_lease_expired', 'terminal transition is outside its executable lease window')
  }
  if (input.lease.observed_delta_digest !== null) fail('delivery_terminal_transition_invalid', 'terminal lease already contains an observed delta')
  const observedDeltaDigest = digestDeliveryValue(input.observed_delta)
  assertObservedDelta(transition, input.observed_delta, observedDeltaDigest)
  const record: Phase1TerminalRecord = {
    schema_version: 1,
    record_kind: 'phase_1_terminal_record',
    envelope_digest: input.lease.envelope_digest,
    sequence: input.lease.sequence,
    state: transition.to,
    transition_id: transition.id,
    transition_contract_digest: input.lease.transition_contract_digest,
    predecessor_lease_digest: digestDeliveryValue(input.lease),
    observed_delta_digest: observedDeltaDigest,
    completed_at: input.completed_at,
    repository_heads_and_clean_state_digests: input.lease.repository_heads_and_clean_state_digests,
  }
  return deepFreeze(record)
}
