import { validateBehaviorCoherenceCertificate } from './schema.js'
import { canonicalizeJsonValue, sha256Hex } from './canonical.js'
import type {
  AdmissionContext,
  AdmissionDecision,
  AuthoritySignal,
  AuthorityState,
  BehaviorCoherenceCertificate,
  FourCompatibilityGates,
} from './types.js'

const AUTHORITY_RANK: Record<AuthorityState, number> = {
  unverified: 0,
  package_observed: 1,
  local_wire_observed: 2,
  cross_checked: 3,
  gateway_wire_equivalent: 4,
  stateful_behavior_equivalent: 5,
  upstream_canary_observed: 6,
  production_verified: 7,
}

const LOCAL_SCOPES = new Set(['package', 'local_fixture', 'local_wire', 'gateway'])

function deny(code: string, action: 'disable' | 'rollback' = 'disable', extra: Partial<AdmissionDecision> = {}): AdmissionDecision {
  return { allowed: false, code, action, ...extra }
}

export function admissionPayloadDigest(
  certificate: unknown,
  signals: readonly AuthoritySignal[],
  negativeCapabilities: AdmissionContext['negativeCapabilities'],
): string {
  return sha256Hex(canonicalizeJsonValue({
    certificate,
    negative_capabilities: negativeCapabilities,
    signals,
  }))
}

function tupleDecision(certificate: BehaviorCoherenceCertificate, context: AdmissionContext): AdmissionDecision | undefined {
  const generationFields = ['proxy_generation', 'credential_generation', 'profile_generation', 'sidecar_protocol_generation', 'replay_ledger_generation'] as const
  for (const field of generationFields) {
    if (certificate[field] < context.expected[field]) return deny('admission_downgrade', 'rollback', { detail: field })
    if (certificate[field] !== context.expected[field]) return deny('admission_tuple_mismatch', 'disable', { detail: field })
  }
  const exactFields = ['contract_digest', 'manifest_digest', 'package_artifact_sha256', 'package_version'] as const
  for (const field of exactFields) {
    if (certificate[field] !== context.expected[field]) return deny('admission_tuple_mismatch', 'disable', { detail: field })
  }
  return undefined
}

function negativeDecision(certificate: BehaviorCoherenceCertificate, context: AdmissionContext): AdmissionDecision | undefined {
  const negative = context.negativeCapabilities
  const denied = new Set([
    ...negative.models,
    ...negative.beta_tokens,
    ...negative.transports,
    ...negative.entrypoints,
    ...negative.fallbacks,
    ...negative.feature_combinations,
  ])
  const selected = [
    certificate.package_version,
    certificate.entrypoint,
    certificate.model_capability_set_ref,
    certificate.tls_http_profile_ref,
    certificate.persona_ref,
    certificate.request_ast_profile_ref,
    certificate.response_profile_ref,
    ...context.requested_capabilities,
  ]
  const match = selected.find((value) => denied.has(value))
  return match ? deny('admission_negative_capability', 'disable', { detail: match }) : undefined
}

function authorityDecision(signal: AuthoritySignal | undefined, context: AdmissionContext): AdmissionDecision | undefined {
  if (!signal) return deny('admission_authority_insufficient')
  const extra = { signalId: signal.signal_id, action: signal.failure_action }
  if (signal.contradiction_status === 'open' || signal.contradictory_evidence.length > 0) {
    return deny('admission_authority_contradicted', signal.failure_action, extra)
  }
  if (signal.expires_at_ms < context.now_ms) return deny('admission_authority_expired', signal.failure_action, extra)
  if (signal.invalidating_dependency_digests.some((digest) => context.invalidated_dependency_digests.includes(digest))) {
    return deny('admission_dependency_invalidated', signal.failure_action, extra)
  }
  if (AUTHORITY_RANK[signal.authority_state] < AUTHORITY_RANK[context.minimum_authority_state]) {
    return deny('admission_authority_insufficient', signal.failure_action, extra)
  }
  if (signal.server_dependency && LOCAL_SCOPES.has(signal.observation_scope)) {
    return deny('admission_authority_insufficient', signal.failure_action, extra)
  }
  if (context.negativeCapabilities.authority_states.includes(signal.authority_state)) {
    return deny('admission_negative_capability', signal.failure_action, extra)
  }
  return undefined
}

export function decideBehaviorAdmission(
  candidate: unknown,
  context: AdmissionContext,
  onAllowed?: () => void,
): AdmissionDecision {
  const schema = validateBehaviorCoherenceCertificate(candidate)
  if (!schema.valid) return deny('admission_schema_invalid', 'disable', { detail: schema.errors[0]?.instancePath || schema.errors[0]?.keyword })
  const certificate = candidate as BehaviorCoherenceCertificate
  if (admissionPayloadDigest(certificate, context.signals, context.negativeCapabilities) !== context.expected.manifest_payload_digest) {
    return deny('admission_manifest_payload_mismatch')
  }
  const tuple = tupleDecision(certificate, context)
  if (tuple) return tuple
  const negative = negativeDecision(certificate, context)
  if (negative) return negative
  const signals = new Map(context.signals.map((signal) => [signal.signal_id, signal]))
  for (const gate of ['wire', 'semantic', 'state_sequence', 'failure_semantics'] as const satisfies ReadonlyArray<keyof FourCompatibilityGates>) {
    const current = certificate.gates[gate]
    if (current.status === 'fail') return deny('admission_gate_failed', 'disable', { gate })
    if (current.status === 'unsupported') return deny('admission_gate_unsupported', 'disable', { gate })
    if (current.status === 'unobserved') return deny('admission_gate_unobserved', 'disable', { gate })
    const authority = authorityDecision(signals.get(current.authority_signal_id), context)
    if (authority) return { ...authority, gate }
  }
  onAllowed?.()
  return { allowed: true, code: 'admission_allow' }
}
