import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { cli, one, parseArgs } from './harness-core.js'
import { validateRequirementRecords, type ValidationError, type ValidationResult } from './validate-requirements.js'

type RequirementRecord = Record<string, unknown>
type MigrationMetadata = {
  requirement_id: string
  reviewer: string
  phase_owner: string
  work_package: null
  introduced_after_phase: null
}

const metadataFields = ['requirement_id', 'reviewer', 'phase_owner', 'work_package', 'introduced_after_phase'] as const
const phaseOwners = new Set(['phase_0', 'phase_1', 'phase_2', 'phase_3a', 'phase_4'])
const approvedGovernance = new Map<string, readonly [reviewer: string, phaseOwner: string]>([
  ['HA-P0-000', ['release-evidence-reviewer', 'phase_0']],
  ['HA-P0-001', ['requirement-governance-reviewer', 'phase_0']],
  ['HA-P0-002', ['normative-document-reviewer', 'phase_0']],
  ['HA-P0-003', ['claim-authority-reviewer', 'phase_0']],
  ['HA-P0-004', ['baseline-integrity-reviewer', 'phase_0']],
  ['HA-P0-005', ['gateway-boundary-security-reviewer', 'phase_0']],
  ['HA-P0-006', ['cross-repository-contract-reviewer', 'phase_0']],
  ['HA-P0-007', ['harness-security-reviewer', 'phase_0']],
  ['HA-P0-008', ['phase-exit-reviewer', 'phase_0']],
  ['HA-P0-009', ['compatibility-authority-reviewer', 'phase_2']],
  ['OL-LEGACY-001', ['legacy-evidence-reviewer', 'phase_0']],
  ['AV-B1-001', ['onboarding-security-reviewer', 'phase_1']],
  ['AV-B2-001', ['authorization-security-reviewer', 'phase_1']],
  ['AV-B3-001', ['origin-authority-reviewer', 'phase_1']],
  ['AV-B4-001', ['egress-boundary-reviewer', 'phase_4']],
  ['AV-B5-001', ['sidecar-authentication-reviewer', 'phase_4']],
  ['AV-B6-001', ['destination-policy-reviewer', 'phase_4']],
  ['HA-P1-001', ['oracle-evidence-reviewer', 'phase_3a']],
  ['HA-P1-002', ['convergence-method-reviewer', 'phase_3a']],
  ['HA-P1-003', ['error-classification-reviewer', 'phase_3a']],
  ['HA-P1-004', ['transport-contract-reviewer', 'phase_4']],
  ['HA-P1-005', ['lifecycle-resilience-reviewer', 'phase_4']],
  ['HA-P1-006', ['authorization-matrix-reviewer', 'phase_4']],
])

function invalid(errors: ValidationError[], code: string, path: string, message: string): void {
  errors.push({ code, path, message })
}

function isObject(value: unknown): value is RequirementRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateMigrationMetadata(metadata: unknown, input: RequirementRecord[]): ValidationResult {
  const errors: ValidationError[] = []
  if (!Array.isArray(metadata)) {
    return { ok: false, errors: [{ code: 'invalid_migration_metadata', path: '$', message: 'migration metadata must be an array' }] }
  }

  const inputIds = input.map((record) => record.requirement_id).filter((id): id is string => typeof id === 'string')
  const metadataIds: string[] = []
  for (const [index, value] of metadata.entries()) {
    const base = `$[${index}]`
    if (!isObject(value)) {
      invalid(errors, 'invalid_migration_metadata', base, 'migration metadata row must be an object')
      continue
    }
    for (const field of metadataFields) {
      if (!(field in value)) invalid(errors, 'invalid_migration_metadata', `${base}.${field}`, `${field} is required and cannot be inferred`)
    }
    for (const field of Object.keys(value)) {
      if (!(metadataFields as readonly string[]).includes(field)) invalid(errors, 'invalid_migration_metadata', `${base}.${field}`, `${field} is not allowed`)
    }
    if (typeof value.requirement_id !== 'string' || value.requirement_id === '') {
      invalid(errors, 'invalid_migration_metadata', `${base}.requirement_id`, 'requirement_id must be non-empty')
    } else {
      metadataIds.push(value.requirement_id)
      const approved = approvedGovernance.get(value.requirement_id)
      if (!approved || value.reviewer !== approved[0] || value.phase_owner !== approved[1]) {
        invalid(errors, 'invalid_migration_metadata', base, 'reviewer and phase_owner must match the approved migration mapping')
      }
    }
    if (typeof value.reviewer !== 'string' || value.reviewer.trim() === '') invalid(errors, 'invalid_migration_metadata', `${base}.reviewer`, 'reviewer must be non-empty')
    if (typeof value.phase_owner !== 'string' || !phaseOwners.has(value.phase_owner)) invalid(errors, 'invalid_migration_metadata', `${base}.phase_owner`, 'phase_owner is not recognized')
    if (value.work_package !== null || value.introduced_after_phase !== null) invalid(errors, 'invalid_migration_metadata', base, 'legacy governance history must remain null')
  }

  const inputSet = new Set(inputIds)
  const metadataSet = new Set(metadataIds)
  if (inputIds.length !== input.length || metadataIds.length !== metadata.length ||
      inputSet.size !== inputIds.length || metadataSet.size !== metadataIds.length ||
      inputSet.size !== metadataSet.size || inputIds.some((id) => !metadataSet.has(id))) {
    invalid(errors, 'invalid_migration_coverage', '$', 'migration metadata must cover every input requirement ID exactly once')
  }
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors }
}

export function migrateRequirementsV1ToV2(input: RequirementRecord[], metadata: unknown): RequirementRecord[] {
  const inputValidation = validateRequirementRecords(input)
  if (!inputValidation.ok || input.some((record) => 'schema_version' in record)) {
    throw Object.assign(new Error('migration input must be a complete homogeneous v1 registry'), { code: 'invalid_migration_input' })
  }
  const metadataValidation = validateMigrationMetadata(metadata, input)
  if (!metadataValidation.ok) {
    throw Object.assign(new Error(JSON.stringify(metadataValidation.errors)), { code: metadataValidation.errors[0].code })
  }
  const byId = new Map((metadata as MigrationMetadata[]).map((row) => [row.requirement_id, row]))
  const output = input.map((record) => {
    const governance = byId.get(String(record.requirement_id))!
    return {
      schema_version: 2,
      ...record,
      reviewer: governance.reviewer,
      phase_owner: governance.phase_owner,
      work_package: governance.work_package,
      introduced_after_phase: governance.introduced_after_phase,
      refines: [],
      supersedes: [],
      related_requirements: [],
    }
  })
  const outputValidation = validateRequirementRecords(output)
  if (!outputValidation.ok) throw Object.assign(new Error(JSON.stringify(outputValidation.errors)), { code: 'invalid_migration_output' })
  return output
}

const invoked = process.argv[1]
if (invoked && existsSync(invoked) && realpathSync(invoked) === fileURLToPath(import.meta.url)) cli(() => {
  const args = parseArgs(process.argv.slice(2))
  const input = one(args, 'input')!
  const metadata = one(args, 'metadata')!
  const out = one(args, 'out')!
  const inputValue = JSON.parse(readFileSync(input, 'utf8')) as unknown
  if (!Array.isArray(inputValue) || !inputValue.every(isObject)) throw Object.assign(new Error('migration input must be an object array'), { code: 'invalid_migration_input' })
  const metadataValue = JSON.parse(readFileSync(metadata, 'utf8')) as unknown
  writeFileSync(out, `${JSON.stringify(migrateRequirementsV1ToV2(inputValue, metadataValue), null, 2)}\n`, { mode: 0o600 })
})
