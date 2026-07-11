import { readFileSync } from 'node:fs'
import type { ValidationError, ValidationResult } from './validate-requirements.js'

export type RequirementRecord = Record<string, unknown>
export type { ValidationError, ValidationResult }

const fields = ['claim_id', 'requirement_ids', 'claim_class', 'authority_state', 'statement', 'evidence_ids', 'observation_scope', 'server_dependency', 'stability_class', 'confidence', 'contradiction_ids', 'expiry', 'canary_evidence_ids', 'production_gate_ids', 'rollback_evidence_ids', 'deployed_artifacts', 'derived_from', 'authoritative_provider_disclosure'] as const
const classes = new Set(['local_structural', 'local_observational', 'upstream_canary', 'provider_internal'])
const states = ['unverified', 'package_observed', 'local_wire_observed', 'cross_checked', 'gateway_wire_equivalent', 'stateful_behavior_equivalent', 'upstream_canary_observed', 'production_verified'] as const
const stateSet = new Set<string>(states)
const scopes = new Set(['package', 'local', 'local_wire', 'cross_checked', 'gateway', 'stateful', 'upstream_canary', 'production'])
const dependencies = new Set(['none', 'local', 'server', 'provider'])
const ceilings = new Map([['local_structural', 4], ['local_observational', 5], ['upstream_canary', 7], ['provider_internal', 7]])
const authorityScopes = new Map([
  ['package_observed', 'package'], ['local_wire_observed', 'local_wire'], ['cross_checked', 'cross_checked'],
  ['gateway_wire_equivalent', 'gateway'], ['stateful_behavior_equivalent', 'stateful'],
  ['upstream_canary_observed', 'upstream_canary'], ['production_verified', 'production'],
])
const commitPattern = /^[0-9a-f]{40}$/
const digestPattern = /^sha256:[0-9a-f]{64}$/

function isObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isTimestamp(value: unknown): value is string { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) }
function add(errors: ValidationError[], code: string, path: string, message: string) { errors.push({ code, path, message }) }
function stringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry !== '') }

export function validateClaims(path: string, requirements: RequirementRecord[]): ValidationResult {
  const errors: ValidationError[] = []
  let parsed: unknown
  try { parsed = JSON.parse(readFileSync(path, 'utf8')) } catch (error) {
    return { ok: false, errors: [{ code: 'invalid_registry', path: '$', message: error instanceof Error ? error.message : 'claims are unreadable' }] }
  }
  if (!Array.isArray(parsed)) return { ok: false, errors: [{ code: 'invalid_registry', path: '$', message: 'claims must be an array' }] }
  const requirementsById = new Map(requirements.flatMap((entry) => typeof entry.requirement_id === 'string' ? [[entry.requirement_id, entry] as const] : []))
  const claimIds = new Set<string>()
  for (const [index, value] of parsed.entries()) {
    const base = `$[${index}]`
    if (!isObject(value)) { add(errors, 'invalid_record', base, 'claim must be an object'); continue }
    for (const field of fields) if (!(field in value)) add(errors, 'missing_field', `${base}.${field}`, `${field} is required`)
    for (const field of Object.keys(value)) if (!(fields as readonly string[]).includes(field)) add(errors, 'unknown_field', `${base}.${field}`, `${field} is not allowed`)
    const id = value.claim_id
    if (typeof id !== 'string' || !/^CL-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(id)) add(errors, 'invalid_claim_id', `${base}.claim_id`, 'claim_id has an invalid format')
    else if (claimIds.has(id)) add(errors, 'duplicate_claim_id', `${base}.claim_id`, `${id} is duplicated`)
    else claimIds.add(id)
    if (!stringArray(value.requirement_ids) || value.requirement_ids.length === 0) add(errors, 'invalid_field', `${base}.requirement_ids`, 'requirement_ids must be a non-empty string array')
    else for (const requirementId of value.requirement_ids) if (!requirementsById.has(requirementId)) add(errors, 'unresolved_requirement', `${base}.requirement_ids`, `${requirementId} is not registered`)
    if (!classes.has(String(value.claim_class))) add(errors, 'invalid_claim_class', `${base}.claim_class`, 'claim_class is not recognized')
    if (!stateSet.has(String(value.authority_state))) add(errors, 'invalid_authority_state', `${base}.authority_state`, 'authority_state is not recognized')
    if (typeof value.statement !== 'string' || value.statement.trim() === '') add(errors, 'invalid_field', `${base}.statement`, 'statement must be non-empty')
    for (const field of ['evidence_ids', 'contradiction_ids', 'canary_evidence_ids', 'production_gate_ids', 'rollback_evidence_ids'] as const) {
      if (!stringArray(value[field])) add(errors, 'invalid_field', `${base}.${field}`, `${field} must be a string array`)
      else if (new Set(value[field]).size !== value[field].length) add(errors, 'invalid_field', `${base}.${field}`, `${field} must not contain duplicates`)
    }
    if (!scopes.has(String(value.observation_scope))) add(errors, 'invalid_field', `${base}.observation_scope`, 'observation_scope is not recognized')
    if (!dependencies.has(String(value.server_dependency))) add(errors, 'invalid_field', `${base}.server_dependency`, 'server_dependency is not recognized')
    if (typeof value.stability_class !== 'string' || value.stability_class.trim() === '') add(errors, 'invalid_field', `${base}.stability_class`, 'stability_class must be non-empty')
    if (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1) add(errors, 'invalid_confidence', `${base}.confidence`, 'confidence must be between 0 and 1')
    if (value.expiry !== null && !isTimestamp(value.expiry)) add(errors, 'invalid_field', `${base}.expiry`, 'expiry must be an ISO-8601 timestamp or null')
    if (typeof value.derived_from !== 'string' || value.derived_from.trim() === '') add(errors, 'invalid_field', `${base}.derived_from`, 'derived_from must be non-empty')
    if (typeof value.authoritative_provider_disclosure !== 'boolean') add(errors, 'invalid_field', `${base}.authoritative_provider_disclosure`, 'authoritative_provider_disclosure must be boolean')

    const claimClass = String(value.claim_class)
    const authority = String(value.authority_state)
    const rank = states.indexOf(authority as typeof states[number])
    const ceiling = ceilings.get(claimClass)
    if (rank >= 0 && ceiling !== undefined && rank > ceiling) add(errors, 'authority_ceiling_exceeded', `${base}.authority_state`, `${claimClass} cannot claim ${authority}`)
    const requiredScope = authorityScopes.get(authority)
    if (requiredScope && value.observation_scope !== requiredScope) add(errors, 'authority_scope_mismatch', `${base}.observation_scope`, `${authority} requires ${requiredScope} scope`)
    if (authority !== 'unverified' && (!stringArray(value.evidence_ids) || value.evidence_ids.length === 0)) add(errors, 'evidence_required', `${base}.evidence_ids`, `${authority} requires evidence`)
    if (claimClass === 'provider_internal' && value.authoritative_provider_disclosure !== true && (authority !== 'unverified' || String(value.derived_from).includes('synthetic'))) add(errors, 'provider_disclosure_required', base, 'provider-internal claims remain unknown without authoritative provider disclosure')
    if (claimClass !== 'provider_internal' && value.server_dependency === 'server' && rank >= 2 && rank <= 5) add(errors, 'server_acceptance_unproven', base, 'local evidence cannot imply server acceptance')

    if (authority === 'production_verified') {
      if (claimClass !== 'upstream_canary' && claimClass !== 'provider_internal') add(errors, 'production_authority_class', base, 'production verification requires an upstream-capable claim class')
      if (!stringArray(value.canary_evidence_ids) || value.canary_evidence_ids.length === 0) add(errors, 'production_canary_required', base, 'production_verified requires upstream canary evidence')
      if (!stringArray(value.production_gate_ids) || value.production_gate_ids.length === 0) add(errors, 'production_gate_required', base, 'production_verified requires production gates')
      if (!stringArray(value.rollback_evidence_ids) || value.rollback_evidence_ids.length === 0) add(errors, 'production_rollback_required', base, 'production_verified requires rollback evidence')
      if (!Array.isArray(value.deployed_artifacts) || value.deployed_artifacts.length === 0) add(errors, 'production_deployment_required', base, 'production_verified requires deployed artifacts')
      if (!isTimestamp(value.expiry) || Date.parse(value.expiry) <= Date.now()) add(errors, 'production_expiry_required', base, 'production_verified requires non-expired evidence')
      if (!stringArray(value.contradiction_ids) || value.contradiction_ids.length !== 0) add(errors, 'production_contradiction', base, 'production_verified cannot have unresolved contradictions')
      if (Array.isArray(value.deployed_artifacts)) value.deployed_artifacts.forEach((artifact, artifactIndex) => {
        if (!isObject(artifact) || Object.keys(artifact).some((key) => !['repository', 'commit', 'config_digest', 'manifest_digest', 'deployed_at'].includes(key)) || typeof artifact.repository !== 'string' || typeof artifact.commit !== 'string' || !commitPattern.test(artifact.commit) || typeof artifact.config_digest !== 'string' || !digestPattern.test(artifact.config_digest) || typeof artifact.manifest_digest !== 'string' || !digestPattern.test(artifact.manifest_digest) || !isTimestamp(artifact.deployed_at)) add(errors, 'invalid_deployed_artifact', `${base}.deployed_artifacts[${artifactIndex}]`, 'deployed artifact requires repository, commit, config and manifest digests, and deployed_at')
      })
      const gateIds = new Set(stringArray(value.production_gate_ids) ? value.production_gate_ids : [])
      for (const requirementId of stringArray(value.requirement_ids) ? value.requirement_ids : []) {
        const requiredGates = requirementsById.get(requirementId)?.production_gate_ids
        if (stringArray(requiredGates)) for (const gate of requiredGates) if (!gateIds.has(gate)) add(errors, 'missing_production_gate', `${base}.production_gate_ids`, `${gate} is required by ${requirementId}`)
      }
    } else {
      const populated = value.expiry !== null || [value.canary_evidence_ids, value.production_gate_ids, value.rollback_evidence_ids, value.deployed_artifacts].some((entry) => Array.isArray(entry) && entry.length > 0)
      if (populated) add(errors, 'non_production_evidence', base, 'non-production claims must have empty production evidence and null expiry')
    }
  }
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors }
}
