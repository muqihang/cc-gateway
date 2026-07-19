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

function stateDigest(value: unknown): string {
  return sha256Hex(canonicalizeJsonValue(value))
}

export function decideReadiness(handshake: ReadinessHandshake, expected: ReadinessExpected, onReady?: () => void): CrossProjectDecision {
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

export function transitionLifecycle(state: LifecycleState, operation: LifecycleOperation): CrossProjectDecision<LifecycleState> {
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

export function decideTaskLineage(state: TaskLineageState, candidate: TaskLineage, nowMs: number): CrossProjectDecision<TaskLineageState> {
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

export function decideOutcome(outcome: OutcomeEnvelope): CrossProjectDecision {
  if (outcome.partial_output || outcome.tool_side_effect || outcome.terminal) return { allowed: true, code: 'interface_terminal_no_retry' }
  if (outcome.semantic_outcome === 'rate_limited' && outcome.retry_owner === 'sub2api') return { allowed: true, code: 'interface_sub2api_retry' }
  if (outcome.retry_owner === 'cc_gateway') return { allowed: true, code: 'interface_gateway_retry' }
  return { allowed: true, code: 'interface_terminal_no_retry' }
}
