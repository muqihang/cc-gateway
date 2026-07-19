export type AuthorityState =
  | 'unverified'
  | 'package_observed'
  | 'local_wire_observed'
  | 'cross_checked'
  | 'gateway_wire_equivalent'
  | 'stateful_behavior_equivalent'
  | 'upstream_canary_observed'
  | 'production_verified'

export type CompatibilityGateStatus = 'pass' | 'fail' | 'unsupported' | 'unobserved'

export type CompatibilityGate = {
  status: CompatibilityGateStatus
  evidence_ref: string
  authority_signal_id: string
}

export type FourCompatibilityGates = {
  wire: CompatibilityGate
  semantic: CompatibilityGate
  state_sequence: CompatibilityGate
  failure_semantics: CompatibilityGate
}

export type BehaviorCoherenceCertificate = {
  schema_id: 'oracle.compatibility'
  schema_major: 1
  schema_revision: 0
  kind: 'behavior_coherence_certificate'
  certificate_id: string
  package_name: '@anthropic-ai/claude-code'
  package_version: string
  package_artifact_sha256: string
  build_identity_ref: string
  platform: string
  architecture: string
  entrypoint: string
  auth_mode: string
  environment_profile_ref: string
  persona_ref: string
  request_ast_profile_ref: string
  response_profile_ref: string
  cch_policy_ref: string
  tls_http_profile_ref: string
  proxy_generation: number
  credential_generation: number
  retry_policy_ref: string
  state_sequence_ref: string
  failure_semantics_ref: string
  model_capability_set_ref: string
  contract_digest: string
  manifest_digest: string
  profile_generation: number
  sidecar_protocol_generation: number
  replay_ledger_generation: number
  gates: FourCompatibilityGates
  dependency_digests: string[]
}

export type AuthoritySignal = {
  signal_id: string
  authority_state: AuthorityState
  observation_scope: 'package' | 'local_fixture' | 'local_wire' | 'gateway' | 'staging' | 'canary' | 'production'
  server_dependency: boolean
  stability_class: 'immutable_package' | 'version_bound' | 'environment_bound' | 'server_dependent'
  confidence: 'unknown' | 'low' | 'medium' | 'high'
  issued_at_ms: number
  expires_at_ms: number
  owner: string
  revalidation_command_id: string
  invalidating_dependency_digests: string[]
  negative_evidence: string[]
  contradictory_evidence: string[]
  contradiction_status: 'none' | 'open' | 'resolved'
  minimum_authority_after_expiry: AuthorityState
  affected_capabilities: string[]
  failure_action: 'disable' | 'rollback'
}

export type NegativeCapabilities = {
  models: string[]
  beta_tokens: string[]
  transports: string[]
  entrypoints: string[]
  fallbacks: string[]
  feature_combinations: string[]
  authority_states: AuthorityState[]
}

export type AdmissionExpectedTuple = {
  contract_digest: string
  manifest_digest: string
  package_artifact_sha256: string
  package_version: string
  proxy_generation: number
  credential_generation: number
  profile_generation: number
  sidecar_protocol_generation: number
  replay_ledger_generation: number
}

export type AdmissionContext = {
  now_ms: number
  minimum_authority_state: AuthorityState
  expected: AdmissionExpectedTuple
  requested_capabilities: string[]
  invalidated_dependency_digests: string[]
  signals: AuthoritySignal[]
  negativeCapabilities: NegativeCapabilities
}

export type AdmissionDecision = {
  allowed: boolean
  code: string
  action?: 'disable' | 'rollback'
  gate?: keyof FourCompatibilityGates
  signalId?: string
  detail?: string
}
