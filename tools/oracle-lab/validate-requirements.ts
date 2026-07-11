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
const commitPattern = /^[0-9a-f]{40}$/
const digestPattern = /^sha256:[0-9a-f]{64}$/
const safeRepositoryPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/

const canonicalSections = new Map<string, string>([
  ['HA-P0-000', 'Adversarial Validation WP0. Baseline and Contract Discovery plus Design Phase 0: Restore Trustworthy Baselines'],
  ['HA-P0-001', '3.1 Requirement Status Registry'],
  ['HA-P0-002', '3. Normative Status and Traceability'],
  ['HA-P0-003', '3.3 Claim Matrix'],
  ['HA-P0-004', '3.2 Baseline Freeze Record'],
  ['HA-P0-005', '4. Required Architecture Decision: Gateway Compromise Boundary'],
  ['HA-P0-006', 'Design 9. Shared Contract Discovery plus Adversarial Validation WP0. Baseline and Contract Discovery'],
  ['HA-P0-007', '16. Required Deliverables (H0 traceability/context/command harness)'],
  ['HA-P0-008', '18. Acceptance Criteria for This Amendment plus Design Validation Gates'],
  ['HA-P0-009', '15. Priority 0 item 4 plus Design Normative Compatibility Contract plus Adversarial Validation WP0.5'],
  ['OL-LEGACY-001', 'Reset of Trust and Normative Compatibility Contract (comparison-only 2.1.197 tuple)'],
  ['AV-B1-001', 'B1. Browser Egress Attestation Bypass'],
  ['AV-B2-001', 'B2. Onboarding Object Authorization'],
  ['AV-B3-001', 'B3. Forwarded-Header and Public-Origin Authority'],
  ['AV-B4-001', 'B4. Formal-Pool Direct-Egress Elimination'],
  ['AV-B5-001', 'B5. Sidecar Request Authentication v2'],
  ['AV-B6-001', 'B6. Proxy Destination Policy'],
  ['HA-P1-001', '5.1 Key Control-Flow Recovery and 5.2 Selective Dynamic Instrumentation'],
  ['HA-P1-002', '5.6 Long-Duration and Lifecycle Runs and 5.9 Stability Convergence Instead of Three Runs'],
  ['HA-P1-003', '6.1 Safe Error Classifier'],
  ['HA-P1-004', '7.1 Proxy Identity Contract and 7.2 Transport-Cell Resource Model'],
  ['HA-P1-005', '7.3 Rotation and Drain State Machine, 7.4 Restart Recovery, 8.1 Fail-Closed Backpressure, and 8.2 Replay-Ledger Partition Semantics'],
  ['HA-P1-006', '8.3 Complete Authorization Matrix and 8.4 Operator and Administrator Threats'],
])

const phase0DeferredPolicy = new Map<string, { acceptanceGate: string; negativeCapabilitiesDisabled: boolean }>([
  ['HA-P0-009', { acceptanceGate: 'phase_1_compatibility_contract', negativeCapabilitiesDisabled: true }],
  ['HA-P1-001', { acceptanceGate: 'phase_1_control_flow_evidence', negativeCapabilitiesDisabled: true }],
  ['HA-P1-002', { acceptanceGate: 'phase_2_stability_convergence', negativeCapabilitiesDisabled: true }],
  ['HA-P1-003', { acceptanceGate: 'phase_1_safe_error_classifier', negativeCapabilitiesDisabled: true }],
  ['HA-P1-004', { acceptanceGate: 'phase_3_transport_cell_contract', negativeCapabilitiesDisabled: true }],
  ['HA-P1-005', { acceptanceGate: 'phase_3_transport_lifecycle', negativeCapabilitiesDisabled: true }],
  ['HA-P1-006', { acceptanceGate: 'phase_3_authorization_matrix', negativeCapabilitiesDisabled: true }],
])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isRfc3339Timestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value)
  if (!match) return false
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false
  if (offsetHourText !== undefined && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59)) return false
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  return calendarDate.getUTCFullYear() === year && calendarDate.getUTCMonth() === month - 1 &&
    calendarDate.getUTCDate() === day && Number.isFinite(Date.parse(value))
}

function isSafeRepository(value: unknown): value is string {
  return typeof value === 'string' && safeRepositoryPattern.test(value) &&
    !value.includes('..') && !value.includes('//') && !value.endsWith('/')
}

function add(errors: ValidationError[], code: string, path: string, message: string) {
  errors.push({ code, path, message })
}

export function validateRequirements(path: string): ValidationResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return {
      ok: false,
      errors: [{ code: 'invalid_registry', path: '$', message: error instanceof Error ? error.message : 'registry is unreadable' }],
    }
  }

  return validateRequirementRecords(parsed)
}

export function validateRequirementRecords(parsed: unknown): ValidationResult {
  const errors: ValidationError[] = []

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
    } else if (typeof id === 'string' && canonicalSections.has(id) && value.source_section !== canonicalSections.get(id)) {
      add(errors, 'invalid_source_section', `${base}.source_section`, `${id} must use its canonical source section`)
    }
    if (typeof value.source_document !== 'string' || value.source_document.trim() === '') {
      add(errors, 'invalid_field', `${base}.source_document`, 'source_document must be non-empty')
    }
    for (const field of ['acceptance_gate'] as const) {
      if (typeof value[field] !== 'string' || value[field].trim() === '') {
        add(errors, 'invalid_field', `${base}.${field}`, `${field} must be a non-empty string`)
      }
    }
    if (!isSafeRepository(value.repository)) {
      add(errors, 'invalid_field', `${base}.repository`, 'repository must be a safe repository identifier')
    }
    for (const field of ['owner', 'verification_command', 'evidence_artifact'] as const) {
      if (typeof value[field] !== 'string') {
        add(errors, 'invalid_field', `${base}.${field}`, `${field} must be a string`)
      }
    }
    if (value.last_verified_commit !== null &&
        (typeof value.last_verified_commit !== 'string' || !commitPattern.test(value.last_verified_commit))) {
      add(errors, 'invalid_field', `${base}.last_verified_commit`, 'last_verified_commit must be a 40-character lowercase hexadecimal commit or null')
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
            !isSafeRepository(artifact.repository) || artifact.repository !== value.repository ||
            typeof artifact.commit !== 'string' || !commitPattern.test(artifact.commit) ||
            artifact.commit !== value.last_verified_commit ||
            typeof artifact.config_digest !== 'string' || !digestPattern.test(artifact.config_digest) ||
            typeof artifact.manifest_digest !== 'string' || !digestPattern.test(artifact.manifest_digest) ||
            !isRfc3339Timestamp(artifact.deployed_at)) {
          add(errors, 'invalid_deployed_artifact', artifactPath, 'deployed artifact is incomplete or invalid')
        }
      })
    }

    for (const field of ['last_verified_at', 'expiry'] as const) {
      if (value[field] !== null && !isRfc3339Timestamp(value[field])) {
        add(errors, 'invalid_field', `${base}.${field}`, `${field} must be an ISO-8601 timestamp or null`)
      }
    }

    const status = value.implementation_status
    const deferredPolicy = typeof id === 'string' ? phase0DeferredPolicy.get(id) : undefined
    if (deferredPolicy && (status !== 'deferred' || value.acceptance_gate !== deferredPolicy.acceptanceGate ||
        (deferredPolicy.negativeCapabilitiesDisabled && Array.isArray(value.implementation_files) && value.implementation_files.length > 0))) {
      add(errors, 'phase_0_promotion_prohibited', `${base}.implementation_status`, `${id} is structurally deferred and prohibited from Phase 0 promotion`)
    }
    const verifiedStatus = status === 'locally_verified' || status === 'upstream_canary_observed' || status === 'production_verified'
    if (verifiedStatus && (typeof value.last_verified_commit !== 'string' || !commitPattern.test(value.last_verified_commit) ||
        !isRfc3339Timestamp(value.last_verified_at))) {
      add(errors, 'invalid_status_transition', `${base}.implementation_status`, `${status} requires verification commit and timestamp`)
    }
    if (status === 'failing_test_added' && (!Array.isArray(value.test_files) || value.test_files.length === 0)) {
      add(errors, 'invalid_status_transition', `${base}.implementation_status`, 'failing_test_added requires at least one test file')
    }
    if (verifiedStatus && ((!Array.isArray(value.implementation_files) || value.implementation_files.length === 0) ||
        (!Array.isArray(value.test_files) || value.test_files.length === 0))) {
      add(errors, 'invalid_status_transition', `${base}.implementation_status`, `${status} requires implementation and test files`)
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
        isRfc3339Timestamp(value.expiry) && Date.parse(value.expiry) > Date.now() &&
        Array.isArray(value.contradiction_ids) && value.contradiction_ids.length === 0
      if (!complete) {
        add(errors, 'invalid_production_evidence', base, 'production_verified requires current canary, gate, rollback, deployment, expiry, and no contradictions')
      }
    }
  }

  for (const expectedId of canonicalSections.keys()) {
    if (!ids.has(expectedId)) add(errors, 'invalid_inventory', '$', `${expectedId} is missing from the fixed Phase 0 inventory`)
  }
  for (const id of ids) {
    if (!canonicalSections.has(id)) add(errors, 'invalid_inventory', '$', `${id} is not in the fixed Phase 0 inventory`)
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
