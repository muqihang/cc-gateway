import { readFileSync } from 'node:fs'

export type ValidationError = { code: string; path: string; message: string }
export type ValidationResult =
  | { ok: true; errors: [] }
  | { ok: false; errors: ValidationError[] }

const fields = [
  'requirement_id', 'source_document', 'source_section', 'precedence', 'priority', 'depends_on',
  'acceptance_gate', 'implementation_status', 'owner', 'repository', 'implementation_files',
  'test_files', 'verification_command', 'evidence_artifact', 'last_verified_commit',
  'last_verified_at', 'expiry', 'known_gaps', 'canary_evidence_ids', 'production_gate_ids',
  'rollback_evidence_ids', 'deployed_artifacts', 'contradiction_ids',
] as const

const arrayFields = [
  'depends_on', 'implementation_files', 'test_files', 'known_gaps', 'canary_evidence_ids',
  'production_gate_ids', 'rollback_evidence_ids', 'contradiction_ids',
] as const

const statuses = new Set([
  'design_only', 'deferred', 'failing_test_added', 'locally_verified',
  'upstream_canary_observed', 'production_verified', 'blocked_by_baseline',
])
const precedences = new Set(['oracle_lab_design', 'adversarial_validation_v2', 'hardening_amendments'])
const productionFields = ['canary_evidence_ids', 'production_gate_ids', 'rollback_evidence_ids'] as const

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && /T/.test(value)
}

function add(errors: ValidationError[], code: string, path: string, message: string) {
  errors.push({ code, path, message })
}

export function validateRequirements(path: string): ValidationResult {
  const errors: ValidationError[] = []
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    add(errors, 'invalid_registry', '$', error instanceof Error ? error.message : 'registry is unreadable')
    return { ok: false, errors }
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, errors: [{ code: 'invalid_registry', path: '$', message: 'registry must be an array' }] }
  }

  const ids = new Set<string>()
  for (const [index, value] of parsed.entries()) {
    const base = `$[${index}]`
    if (!isObject(value)) {
      add(errors, 'invalid_record', base, 'requirement must be an object')
      continue
    }

    for (const field of fields) {
      if (!(field in value)) add(errors, 'missing_field', `${base}.${field}`, `${field} is required`)
    }
    for (const field of Object.keys(value)) {
      if (!(fields as readonly string[]).includes(field)) {
        add(errors, 'unknown_field', `${base}.${field}`, `${field} is not allowed`)
      }
    }

    const id = value.requirement_id
    if (typeof id !== 'string' || !/^(OL|AV|HA)-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(id)) {
      add(errors, 'invalid_requirement_id', `${base}.requirement_id`, 'requirement_id has an invalid format')
    } else if (ids.has(id)) {
      add(errors, 'duplicate_requirement_id', `${base}.requirement_id`, `${id} is duplicated`)
    } else {
      ids.add(id)
    }

    if (typeof value.source_section !== 'string' || value.source_section.trim() === '') {
      add(errors, 'missing_source_section', `${base}.source_section`, 'source_section must be non-empty')
    }
    if (typeof value.source_document !== 'string' || value.source_document.trim() === '') {
      add(errors, 'invalid_field', `${base}.source_document`, 'source_document must be non-empty')
    }
    for (const field of ['acceptance_gate', 'repository'] as const) {
      if (typeof value[field] !== 'string' || value[field].trim() === '') {
        add(errors, 'invalid_field', `${base}.${field}`, `${field} must be a non-empty string`)
      }
    }
    for (const field of ['owner', 'verification_command', 'evidence_artifact'] as const) {
      if (typeof value[field] !== 'string') {
        add(errors, 'invalid_field', `${base}.${field}`, `${field} must be a string`)
      }
    }
    if (value.last_verified_commit !== null &&
        (typeof value.last_verified_commit !== 'string' || value.last_verified_commit === '')) {
      add(errors, 'invalid_field', `${base}.last_verified_commit`, 'last_verified_commit must be a non-empty string or null')
    }
    if (!precedences.has(String(value.precedence))) {
      add(errors, 'invalid_precedence', `${base}.precedence`, 'precedence is not recognized')
    }
    if (!['P0', 'P1', 'P2'].includes(String(value.priority))) {
      add(errors, 'invalid_field', `${base}.priority`, 'priority is not recognized')
    }
    if (!statuses.has(String(value.implementation_status))) {
      add(errors, 'invalid_status', `${base}.implementation_status`, 'implementation_status is not recognized')
    }
    if ((value.priority === 'P0' || value.priority === 'P1') &&
        (typeof value.owner !== 'string' || value.owner.trim() === '')) {
      add(errors, 'missing_owner', `${base}.owner`, 'P0/P1 requirements must have an owner')
    }

    for (const field of arrayFields) {
      const entries = value[field]
      if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== 'string' || entry === '')) {
        add(errors, 'invalid_field', `${base}.${field}`, `${field} must be a string array`)
      } else if (new Set(entries).size !== entries.length) {
        add(errors, 'invalid_field', `${base}.${field}`, `${field} must not contain duplicates`)
      }
    }
    if (!Array.isArray(value.deployed_artifacts)) {
      add(errors, 'invalid_field', `${base}.deployed_artifacts`, 'deployed_artifacts must be an array')
    } else {
      value.deployed_artifacts.forEach((artifact, artifactIndex) => {
        const artifactPath = `${base}.deployed_artifacts[${artifactIndex}]`
        const expected = ['repository', 'commit', 'config_digest', 'manifest_digest', 'deployed_at']
        if (!isObject(artifact) || Object.keys(artifact).some((key) => !expected.includes(key)) ||
            expected.some((key) => typeof artifact[key] !== 'string' || artifact[key] === '') ||
            !isTimestamp(artifact.deployed_at)) {
          add(errors, 'invalid_deployed_artifact', artifactPath, 'deployed artifact is incomplete or invalid')
        }
      })
    }

    for (const field of ['last_verified_at', 'expiry'] as const) {
      if (value[field] !== null && !isTimestamp(value[field])) {
        add(errors, 'invalid_field', `${base}.${field}`, `${field} must be an ISO-8601 timestamp or null`)
      }
    }

    const status = value.implementation_status
    const verifiedStatus = status === 'locally_verified' || status === 'upstream_canary_observed' || status === 'production_verified'
    if (verifiedStatus && (typeof value.last_verified_commit !== 'string' || value.last_verified_commit === '' ||
        !isTimestamp(value.last_verified_at))) {
      add(errors, 'invalid_status_transition', `${base}.implementation_status`, `${status} requires verification commit and timestamp`)
    }

    if (status !== 'production_verified') {
      const populated = productionFields.some((field) => Array.isArray(value[field]) && value[field].length > 0) ||
        (Array.isArray(value.deployed_artifacts) && value.deployed_artifacts.length > 0) ||
        (Array.isArray(value.contradiction_ids) && value.contradiction_ids.length > 0) || value.expiry !== null
      if (populated) {
        add(errors, 'non_production_evidence', base, 'non-production records must have empty production fields and null expiry')
      }
    } else {
      const complete = productionFields.every((field) => Array.isArray(value[field]) && value[field].length > 0) &&
        Array.isArray(value.deployed_artifacts) && value.deployed_artifacts.length > 0 &&
        isTimestamp(value.expiry) && Date.parse(value.expiry) > Date.now() &&
        Array.isArray(value.contradiction_ids) && value.contradiction_ids.length === 0
      if (!complete) {
        add(errors, 'invalid_production_evidence', base, 'production_verified requires current canary, gate, rollback, deployment, expiry, and no contradictions')
      }
    }
  }

  for (const [index, value] of parsed.entries()) {
    if (!isObject(value) || !Array.isArray(value.depends_on)) continue
    for (const dependency of value.depends_on) {
      if (typeof dependency === 'string' && !ids.has(dependency)) {
        add(errors, 'unresolved_dependency', `$[${index}].depends_on`, `${dependency} is not registered`)
      }
    }
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors }
}
