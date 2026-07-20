import { canonicalizeJsonValue, sha256Hex } from './canonical.js'

export type SupportedContractRange = { schema_major: number; minimum_revision: number; maximum_revision: number }

export type ReadinessHandshake = {
  schema_id: 'oracle.compatibility'
  schema_major: 1
  schema_revision: 0
  kind: 'readiness_handshake'
  liveness: boolean
  readiness: boolean
  protected_capability: boolean
  build_digest: string
  contract_digest: string
  manifest_digest: string
  profile_generation: number
  sidecar_generation: number
  replay_ledger_generation: number
  supported_contracts: SupportedContractRange[]
  disabled_capabilities: string[]
  expires_at_ms: number
}

export type ReadinessExpected = {
  now_ms: number
  schema_major: number
  schema_revision: number
  build_digest: string
  contract_digest: string
  manifest_digest: string
  profile_generation: number
  sidecar_generation: number
  replay_ledger_generation: number
  required_capability: string
}

export type CrossProjectDecision<T = never> = { allowed: boolean; code: string; nextState?: T; nextStateDigest?: string }

const SAFE_REF = /^[A-Za-z0-9._:/-]+$/
const SHA256 = /^[0-9a-f]{64}$/
const MAX_GENERATION = 9_007_199_254_740_991

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const required = [...expected].sort()
  return actual.length === required.length && actual.every((key, index) => key === required[index])
}

function safeRef(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 200 && SAFE_REF.test(value)
}

function sha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value)
}

function generation(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_GENERATION
}

function safeRefArray(value: unknown, maximum: number): value is string[] {
  return Array.isArray(value) && value.length <= maximum && value.every(safeRef) && new Set(value).size === value.length
}

function stateDigest(value: unknown): string {
  return sha256Hex(canonicalizeJsonValue(value))
}

function exactSchema(value: unknown, kind: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.schema_id === 'oracle.compatibility' && record.schema_major === 1 && record.schema_revision === 0 && record.kind === kind
}

function supportedRangesAreValid(ranges: readonly SupportedContractRange[]): boolean {
  let previous: SupportedContractRange | undefined
  for (const current of ranges) {
    if (!Number.isInteger(current.schema_major) || !Number.isInteger(current.minimum_revision) || !Number.isInteger(current.maximum_revision)
      || current.schema_major < 0 || current.minimum_revision < 0 || current.maximum_revision < current.minimum_revision) return false
    if (previous && (current.schema_major < previous.schema_major
      || (current.schema_major === previous.schema_major && current.minimum_revision <= previous.maximum_revision))) return false
    previous = current
  }
  return ranges.length > 0
}

function readinessShapeIsValid(handshake: ReadinessHandshake): boolean {
  return hasExactKeys(handshake, [
    'schema_id', 'schema_major', 'schema_revision', 'kind', 'liveness', 'readiness', 'protected_capability',
    'build_digest', 'contract_digest', 'manifest_digest', 'profile_generation', 'sidecar_generation',
    'replay_ledger_generation', 'supported_contracts', 'disabled_capabilities', 'expires_at_ms',
  ])
    && typeof handshake.liveness === 'boolean' && typeof handshake.readiness === 'boolean' && typeof handshake.protected_capability === 'boolean'
    && sha256(handshake.build_digest) && sha256(handshake.contract_digest) && sha256(handshake.manifest_digest)
    && generation(handshake.profile_generation) && generation(handshake.sidecar_generation) && generation(handshake.replay_ledger_generation)
    && Array.isArray(handshake.supported_contracts) && handshake.supported_contracts.length <= 16
    && supportedRangesAreValid(handshake.supported_contracts)
    && safeRefArray(handshake.disabled_capabilities, 128) && generation(handshake.expires_at_ms)
}

export function decideReadiness(handshake: ReadinessHandshake, expected: ReadinessExpected, onReady?: () => void): CrossProjectDecision {
  if (!exactSchema(handshake, 'readiness_handshake') || !readinessShapeIsValid(handshake)) return { allowed: false, code: 'interface_schema_unsupported' }
  const range = handshake.supported_contracts.find((candidate) => candidate.schema_major === expected.schema_major && candidate.minimum_revision <= expected.schema_revision && candidate.maximum_revision >= expected.schema_revision && candidate.minimum_revision <= candidate.maximum_revision)
  if (!range) return { allowed: false, code: 'interface_schema_unsupported' }
  if (handshake.contract_digest !== expected.contract_digest) return { allowed: false, code: 'interface_contract_mismatch' }
  if (handshake.build_digest !== expected.build_digest || handshake.manifest_digest !== expected.manifest_digest || handshake.profile_generation !== expected.profile_generation || handshake.sidecar_generation !== expected.sidecar_generation || handshake.replay_ledger_generation !== expected.replay_ledger_generation) {
    return { allowed: false, code: 'interface_generation_mismatch' }
  }
  if (!handshake.liveness || !handshake.readiness || !handshake.protected_capability || handshake.expires_at_ms < expected.now_ms || handshake.disabled_capabilities.includes(expected.required_capability)) {
    return { allowed: false, code: 'interface_not_ready' }
  }
  onReady?.()
  return { allowed: true, code: 'interface_allow' }
}

export type LifecycleState = {
  owner: 'sub2api'
  account_ref: string
  account_generation: number
  credential_generation: number
  proxy_generation: number
  profile_generation: number
  state_version: number
  status: 'absent' | 'active' | 'frozen' | 'draining' | 'revoked' | 'deleted'
}

export type LifecycleOperation = {
  schema_id: 'oracle.compatibility'
  schema_major: 1
  schema_revision: 0
  kind: 'lifecycle_operation'
  operation: 'register' | 'replace' | 'freeze' | 'drain' | 'revoke' | 'delete' | 'query' | 'reconcile'
  owner: 'sub2api' | 'cc_gateway'
  account_ref: string
  account_generation: number
  credential_generation: number
  proxy_generation: number
  profile_generation: number
  expected_state_version: number
  next_state_version: number
  idempotency_key: string
}

function lifecycleOperationShapeIsValid(operation: LifecycleOperation): boolean {
  return hasExactKeys(operation, [
    'schema_id', 'schema_major', 'schema_revision', 'kind', 'operation', 'owner', 'account_ref',
    'account_generation', 'credential_generation', 'proxy_generation', 'profile_generation',
    'expected_state_version', 'next_state_version', 'idempotency_key',
  ])
    && ['register', 'replace', 'freeze', 'drain', 'revoke', 'delete', 'query', 'reconcile'].includes(operation.operation)
    && ['sub2api', 'cc_gateway'].includes(operation.owner)
    && safeRef(operation.account_ref) && safeRef(operation.idempotency_key)
    && generation(operation.account_generation) && generation(operation.credential_generation)
    && generation(operation.proxy_generation) && generation(operation.profile_generation)
    && generation(operation.expected_state_version) && generation(operation.next_state_version)
}

export function transitionLifecycle(state: LifecycleState, operation: LifecycleOperation): CrossProjectDecision<LifecycleState> {
  if (!exactSchema(operation, 'lifecycle_operation') || !lifecycleOperationShapeIsValid(operation)) return { allowed: false, code: 'interface_schema_unsupported' }
  if (operation.owner !== 'sub2api' || state.owner !== 'sub2api' || operation.account_ref !== state.account_ref) return { allowed: false, code: 'interface_owner_mismatch' }
  if (operation.expected_state_version !== state.state_version || operation.next_state_version !== state.state_version + 1) return { allowed: false, code: 'interface_stale_state' }
  if (operation.account_generation < state.account_generation || operation.credential_generation < state.credential_generation || operation.proxy_generation < state.proxy_generation || operation.profile_generation < state.profile_generation) {
    return { allowed: false, code: 'interface_generation_regression' }
  }
  if ((operation.operation === 'register' && state.status !== 'absent') || (operation.operation === 'replace' && state.status !== 'active')) return { allowed: false, code: 'interface_state_transition_invalid' }
  const statuses: Partial<Record<LifecycleOperation['operation'], LifecycleState['status']>> = {
    register: 'active', replace: 'active', freeze: 'frozen', drain: 'draining', revoke: 'revoked', delete: 'deleted', reconcile: state.status, query: state.status,
  }
  const nextState: LifecycleState = {
    owner: 'sub2api',
    account_ref: state.account_ref,
    account_generation: operation.account_generation,
    credential_generation: operation.credential_generation,
    proxy_generation: operation.proxy_generation,
    profile_generation: operation.profile_generation,
    state_version: operation.next_state_version,
    status: statuses[operation.operation] as LifecycleState['status'],
  }
  return { allowed: true, code: 'interface_allow', nextState, nextStateDigest: stateDigest(nextState) }
}

export type TaskLineageState = { root_task_ref: string; current_task_ref: string; client_generation: number; profile_generation: number; migration_sequence: number }

export type TaskLineage = {
  schema_id: 'oracle.compatibility'
  schema_major: 1
  schema_revision: 0
  kind: 'task_lineage'
  root_task_ref: string
  parent_task_ref: string
  current_task_ref: string
  client_generation: number
  profile_generation: number
  migration_sequence: number
  attempt_id: string
  deadline_ms: number
  idempotency_key: string
}

function taskLineageShapeIsValid(candidate: TaskLineage): boolean {
  return hasExactKeys(candidate, [
    'schema_id', 'schema_major', 'schema_revision', 'kind', 'root_task_ref', 'parent_task_ref',
    'current_task_ref', 'client_generation', 'profile_generation', 'migration_sequence', 'attempt_id',
    'deadline_ms', 'idempotency_key',
  ])
    && safeRef(candidate.root_task_ref) && safeRef(candidate.parent_task_ref) && safeRef(candidate.current_task_ref)
    && safeRef(candidate.attempt_id) && safeRef(candidate.idempotency_key)
    && generation(candidate.client_generation) && generation(candidate.profile_generation)
    && generation(candidate.migration_sequence) && generation(candidate.deadline_ms)
}

export function decideTaskLineage(state: TaskLineageState, candidate: TaskLineage, nowMs: number): CrossProjectDecision<TaskLineageState> {
  if (!exactSchema(candidate, 'task_lineage') || !taskLineageShapeIsValid(candidate)) return { allowed: false, code: 'interface_schema_unsupported' }
  if (candidate.root_task_ref !== state.root_task_ref || candidate.parent_task_ref !== state.current_task_ref || candidate.current_task_ref === state.current_task_ref) return { allowed: false, code: 'interface_lineage_mismatch' }
  if (candidate.migration_sequence !== state.migration_sequence + 1 || candidate.client_generation < state.client_generation || candidate.profile_generation < state.profile_generation) return { allowed: false, code: 'interface_migration_stale' }
  if (candidate.deadline_ms < nowMs) return { allowed: false, code: 'interface_deadline_expired' }
  const nextState: TaskLineageState = {
    root_task_ref: state.root_task_ref,
    current_task_ref: candidate.current_task_ref,
    client_generation: candidate.client_generation,
    profile_generation: candidate.profile_generation,
    migration_sequence: candidate.migration_sequence,
  }
  return { allowed: true, code: 'interface_allow', nextState, nextStateDigest: stateDigest(nextState) }
}

export type OutcomeEnvelope = {
  schema_id: 'oracle.compatibility'
  schema_major: 1
  schema_revision: 0
  kind: 'outcome_envelope'
  attempt_id: string
  transport_fact: 'not_attempted' | 'connected' | 'reset' | 'timeout' | 'rejected'
  semantic_outcome: 'none' | 'success' | 'client_error' | 'rate_limited' | 'capacity' | 'server_error' | 'malformed' | 'cancelled'
  partial_output: boolean
  tool_side_effect: boolean
  retry_owner: 'none' | 'cc_gateway' | 'sub2api'
  terminal: boolean
  final_headers_sha256: string
  final_body_sha256: string
}

function outcomeShapeIsValid(outcome: OutcomeEnvelope): boolean {
  return hasExactKeys(outcome, [
    'schema_id', 'schema_major', 'schema_revision', 'kind', 'attempt_id', 'transport_fact',
    'semantic_outcome', 'partial_output', 'tool_side_effect', 'retry_owner', 'terminal',
    'final_headers_sha256', 'final_body_sha256',
  ])
    && safeRef(outcome.attempt_id) && sha256(outcome.final_headers_sha256) && sha256(outcome.final_body_sha256)
    && typeof outcome.partial_output === 'boolean' && typeof outcome.tool_side_effect === 'boolean' && typeof outcome.terminal === 'boolean'
    && ['not_attempted', 'connected', 'reset', 'timeout', 'rejected'].includes(outcome.transport_fact)
    && ['none', 'success', 'client_error', 'rate_limited', 'capacity', 'server_error', 'malformed', 'cancelled'].includes(outcome.semantic_outcome)
    && ['none', 'cc_gateway', 'sub2api'].includes(outcome.retry_owner)
}

export function decideOutcome(outcome: OutcomeEnvelope): CrossProjectDecision {
  if (!exactSchema(outcome, 'outcome_envelope') || !outcomeShapeIsValid(outcome)) return { allowed: false, code: 'interface_schema_unsupported' }
  if (outcome.partial_output || outcome.tool_side_effect || outcome.terminal) return { allowed: true, code: 'interface_terminal_no_retry' }
  if (outcome.semantic_outcome === 'rate_limited' && outcome.retry_owner === 'sub2api') return { allowed: true, code: 'interface_sub2api_retry' }
  if (outcome.retry_owner === 'cc_gateway') return { allowed: true, code: 'interface_gateway_retry' }
  return { allowed: true, code: 'interface_terminal_no_retry' }
}
