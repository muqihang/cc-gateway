import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'

import { migrateRequirementsV1ToV2, validateMigrationMetadata } from '../tools/oracle-lab/migrate-requirements-v1-to-v2.js'
import { validateRequirements } from '../tools/oracle-lab/validate-requirements.js'

const registryPath = path.resolve('docs/superpowers/registry/oracle-lab-requirements.json')
const v1RegistryPath = path.resolve('docs/superpowers/registry/oracle-lab-requirements-v1.json')
const schemaPath = path.resolve('docs/superpowers/schemas/oracle-lab-requirement.schema.json')
const v1SchemaPath = path.resolve('docs/superpowers/schemas/oracle-lab-requirement-v1.schema.json')
const migrationPath = path.resolve('docs/superpowers/registry/oracle-lab-requirement-v2-migration.json')
const migrationSchemaPath = path.resolve('docs/superpowers/schemas/oracle-lab-requirement-v2-migration.schema.json')
const v1RegistryDigest = '2e212e0fd8cfeec8272178fefc3d952a29f76129e5f1c75b1dd57a95456aada5'

type Requirement = Record<string, unknown>

async function registry(): Promise<Requirement[]> {
  return JSON.parse(await readFile(registryPath, 'utf8')) as Requirement[]
}

async function v2Registry(): Promise<Requirement[]> {
  return (await registry()).map((record, index) => ({
    ...record,
    schema_version: 2,
    reviewer: `independent-reviewer-${index}`,
    phase_owner: 'phase_0',
    work_package: null,
    introduced_after_phase: null,
    refines: [],
    supersedes: [],
    related_requirements: [],
  }))
}

function reviewAmendment(template: Requirement, suffix = '001'): Requirement {
  return {
    ...template,
    requirement_id: `RA-WPR0-${suffix}`,
    source_document: '2026-07-12-oracle-p0-1-review-amendments.md',
    source_section: `WP-R0 review amendment ${suffix}`,
    precedence: 'review_amendments',
    priority: 'P0',
    depends_on: [],
    acceptance_gate: 'p0_1_requirement_governance',
    implementation_status: 'design_only',
    owner: 'requirement-governance-owner',
    reviewer: 'requirement-governance-reviewer',
    phase_owner: 'phase_0',
    work_package: 'WP-R0',
    introduced_after_phase: 'phase_0',
    implementation_files: [],
    test_files: [],
    verification_command: '',
    evidence_artifact: '',
    last_verified_commit: null,
    last_verified_at: null,
    expiry: null,
    known_gaps: [],
    canary_evidence_ids: [],
    production_gate_ids: [],
    rollback_evidence_ids: [],
    deployed_artifacts: [],
    contradiction_ids: [],
    refines: [],
    supersedes: [],
    related_requirements: [],
  }
}

async function validateFixture(records: Requirement[]) {
  const directory = await mkdtemp(path.join(tmpdir(), 'oracle-lab-requirements-'))
  const fixturePath = path.join(directory, 'requirements.json')
  await writeFile(fixturePath, JSON.stringify(records))
  return validateRequirements(fixturePath)
}

async function mutateRecord(requirementId: string, changes: Requirement): Promise<Requirement[]> {
  const records = await registry()
  const index = records.findIndex((record) => record.requirement_id === requirementId)
  assert.notEqual(index, -1, `${requirementId} is missing from the seeded registry`)
  records[index] = { ...records[index], ...changes }
  return records
}

function productionEvidence(record: Requirement): Requirement {
  const commit = '0123456789abcdef0123456789abcdef01234567'
  const now = new Date().toISOString()
  return {
    ...record,
    implementation_status: 'production_verified',
    canary_evidence_ids: ['canary-1'],
    production_gate_ids: ['gate-1'],
    rollback_evidence_ids: ['rollback-1'],
    deployed_artifacts: [{
      repository: record.repository,
      commit,
      config_digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      manifest_digest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      deployed_at: now,
    }],
    expiry: new Date(Date.now() + 3_600_000).toISOString(),
    contradiction_ids: [],
    last_verified_commit: commit,
    last_verified_at: now,
  }
}

function expectError(result: Awaited<ReturnType<typeof validateRequirements>>, code: string) {
  assert.equal(result.ok, false)
  assert(result.errors.some((error) => error.code === code), JSON.stringify(result.errors))
}

test('seeded registry contains exactly the fixed Phase 0 P0/P1 inventory and validates', async () => {
  const records = await registry()
  const expectedSections = {
    'HA-P0-000': 'Adversarial Validation WP0. Baseline and Contract Discovery plus Design Phase 0: Restore Trustworthy Baselines',
    'HA-P0-001': '3.1 Requirement Status Registry',
    'HA-P0-002': '3. Normative Status and Traceability',
    'HA-P0-003': '3.3 Claim Matrix',
    'HA-P0-004': '3.2 Baseline Freeze Record',
    'HA-P0-005': '4. Required Architecture Decision: Gateway Compromise Boundary',
    'HA-P0-006': 'Design 9. Shared Contract Discovery plus Adversarial Validation WP0. Baseline and Contract Discovery',
    'HA-P0-007': '16. Required Deliverables (H0 traceability/context/command harness)',
    'HA-P0-008': '18. Acceptance Criteria for This Amendment plus Design Validation Gates',
    'HA-P0-009': '15. Priority 0 item 4 plus Design Normative Compatibility Contract plus Adversarial Validation WP0.5',
    'OL-LEGACY-001': 'Reset of Trust and Normative Compatibility Contract (comparison-only 2.1.197 tuple)',
    'AV-B1-001': 'B1. Browser Egress Attestation Bypass',
    'AV-B2-001': 'B2. Onboarding Object Authorization',
    'AV-B3-001': 'B3. Forwarded-Header and Public-Origin Authority',
    'AV-B4-001': 'B4. Formal-Pool Direct-Egress Elimination',
    'AV-B5-001': 'B5. Sidecar Request Authentication v2',
    'AV-B6-001': 'B6. Proxy Destination Policy',
    'HA-P1-001': '5.1 Key Control-Flow Recovery and 5.2 Selective Dynamic Instrumentation',
    'HA-P1-002': '5.6 Long-Duration and Lifecycle Runs and 5.9 Stability Convergence Instead of Three Runs',
    'HA-P1-003': '6.1 Safe Error Classifier',
    'HA-P1-004': '7.1 Proxy Identity Contract and 7.2 Transport-Cell Resource Model',
    'HA-P1-005': '7.3 Rotation and Drain State Machine, 7.4 Restart Recovery, 8.1 Fail-Closed Backpressure, and 8.2 Replay-Ledger Partition Semantics',
    'HA-P1-006': '8.3 Complete Authorization Matrix and 8.4 Operator and Administrator Threats',
  }

  assert.deepEqual(records.map((record) => record.requirement_id).sort(), Object.keys(expectedSections).sort())
  assert.deepEqual(
    Object.fromEntries(records.map((record) => [record.requirement_id, record.source_section])),
    expectedSections,
  )
  assert.deepEqual(await validateRequirements(registryPath), { ok: true, errors: [] })
})

test('preserves the reviewed v1 bytes and validates the complete v1 array under its versioned schema', async () => {
  const canonicalBytes = await readFile(registryPath)
  const v1Bytes = await readFile(v1RegistryPath)
  assert.deepEqual(v1Bytes, canonicalBytes)
  assert.equal(createHash('sha256').update(v1Bytes).digest('hex'), v1RegistryDigest)
  assert.deepEqual(await validateRequirements(v1RegistryPath), { ok: true, errors: [] })

  const schema = JSON.parse(await readFile(v1SchemaPath, 'utf8')) as Requirement
  assert.equal(schema.$id, 'https://cc-gateway.local/schemas/oracle-lab-requirement-v1.schema.json')
  assert.notEqual(schema.$id, 'https://cc-gateway.local/schemas/oracle-lab-requirement.schema.json')
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema)
  for (const record of JSON.parse(v1Bytes.toString('utf8')) as Requirement[]) {
    assert.equal(validate(record), true, JSON.stringify(validate.errors))
  }
})

test('schema-validated migration is deterministic, exact-covering, and never infers governance metadata', async () => {
  const v1 = JSON.parse(await readFile(v1RegistryPath, 'utf8')) as Requirement[]
  const metadata = JSON.parse(await readFile(migrationPath, 'utf8')) as Requirement[]
  const schema = JSON.parse(await readFile(migrationSchemaPath, 'utf8')) as Requirement
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema)
  assert.equal(validate(metadata), true, JSON.stringify(validate.errors))
  assert.deepEqual(validateMigrationMetadata(metadata, v1), { ok: true, errors: [] })
  assert.equal(metadata.length, 23)
  assert.deepEqual(metadata.map((row) => row.requirement_id), v1.map((row) => row.requirement_id))
  assert(metadata.every((row) => row.work_package === null && row.introduced_after_phase === null))

  const first = migrateRequirementsV1ToV2(v1, metadata)
  const second = migrateRequirementsV1ToV2(
    JSON.parse(JSON.stringify(v1)) as Requirement[],
    JSON.parse(JSON.stringify(metadata)) as Requirement[],
  )
  assert.deepEqual(first, second)
  assert.deepEqual(first.map((row) => row.requirement_id), v1.map((row) => row.requirement_id))
  assert(first.every((row) => row.schema_version === 2 && row.work_package === null && row.introduced_after_phase === null))
  assert.deepEqual(await validateFixture(first), { ok: true, errors: [] })
  assert.equal(createHash('sha256').update(await readFile(registryPath)).digest('hex'), v1RegistryDigest)

  for (const invalid of [metadata.slice(1), [...metadata, metadata[0]]]) {
    assert.throws(
      () => migrateRequirementsV1ToV2(v1, invalid),
      (error: Error & { code?: string }) => error.code === 'invalid_migration_coverage',
    )
  }
  const missingReviewer = metadata.map((row, index) => index === 0
    ? Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'reviewer'))
    : row)
  assert.throws(
    () => migrateRequirementsV1ToV2(v1, missingReviewer),
    (error: Error & { code?: string }) => error.code === 'invalid_migration_metadata',
  )
  const substitutedReviewer = metadata.map((row, index) => index === 0
    ? { ...row, reviewer: 'plausible-but-unapproved-reviewer', phase_owner: 'phase_4' }
    : row)
  assert.equal(validate(substitutedReviewer), false)
  assert.throws(
    () => migrateRequirementsV1ToV2(v1, substitutedReviewer),
    (error: Error & { code?: string }) => error.code === 'invalid_migration_metadata',
  )
})

test('accepts homogeneous v2 records and rejects mixed or unsupported record versions', async () => {
  const v2 = await v2Registry()
  assert.deepEqual(await validateFixture(v2), { ok: true, errors: [] })
  expectError(await validateFixture([...(await registry()).slice(0, 1), ...v2.slice(1)]), 'mixed_schema_versions')
  expectError(await validateFixture(v2.map((record, index) => index === 0 ? { ...record, schema_version: 3 } : record)), 'unsupported_schema_version')
  assert(v2.every((record) => record.schema_version === 2))
})

test('v2 requires exact governance fields and unique relationship arrays', async () => {
  for (const field of ['schema_version', 'reviewer', 'phase_owner', 'work_package', 'introduced_after_phase',
    'refines', 'supersedes', 'related_requirements'] as const) {
    const records = await v2Registry()
    const { [field]: _omitted, ...withoutField } = records[0]
    records[0] = withoutField
    expectError(await validateFixture(records), field === 'schema_version' ? 'mixed_schema_versions' : 'missing_field')
  }
  for (const field of ['refines', 'supersedes', 'related_requirements'] as const) {
    const records = await v2Registry()
    records[0][field] = [String(records[1].requirement_id), String(records[1].requirement_id)]
    expectError(await validateFixture(records), 'invalid_field')
  }
})

test('RA IDs and review precedence are v2-only and require honest post-Phase-0 work-package history', async () => {
  const v2 = await v2Registry()
  const ra = reviewAmendment(v2[0])
  assert.deepEqual(await validateFixture([...v2, ra]), { ok: true, errors: [] })

  expectError(await validateFixture([...(await registry()), {
    ...ra,
    schema_version: undefined,
  }]), 'invalid_requirement_id')
  expectError(await validateFixture([...v2, { ...ra, work_package: null }]), 'invalid_review_amendment')
  expectError(await validateFixture([...v2, { ...ra, introduced_after_phase: null }]), 'invalid_review_amendment')
  expectError(await validateFixture([...v2, { ...ra, introduced_after_phase: 'phase_1' }]), 'invalid_review_amendment')

  const fabricated = await v2Registry()
  fabricated[0] = { ...fabricated[0], work_package: 'WP-R0', introduced_after_phase: 'phase_0' }
  expectError(await validateFixture(fabricated), 'invalid_legacy_governance_history')
})

test('v2 validates relationship targets, self references, and refines or supersedes cycles', async () => {
  for (const field of ['refines', 'supersedes', 'related_requirements'] as const) {
    const unresolved = await v2Registry()
    unresolved[0][field] = ['RA-MISSING-001']
    expectError(await validateFixture(unresolved), 'unresolved_relationship')

    const self = await v2Registry()
    self[0][field] = [String(self[0].requirement_id)]
    expectError(await validateFixture(self), 'self_relationship')
  }
  for (const field of ['refines', 'supersedes'] as const) {
    const cyclic = await v2Registry()
    cyclic[0][field] = [String(cyclic[1].requirement_id)]
    cyclic[1][field] = [String(cyclic[0].requirement_id)]
    expectError(await validateFixture(cyclic), 'cyclic_relationship')
  }
})

test('v2 permits only symmetric registered contradictions on non-production records', async () => {
  const symmetric = await v2Registry()
  symmetric[0].contradiction_ids = [String(symmetric[1].requirement_id)]
  symmetric[1].contradiction_ids = [String(symmetric[0].requirement_id)]
  assert.deepEqual(await validateFixture(symmetric), { ok: true, errors: [] })

  const unresolved = await v2Registry()
  unresolved[0].contradiction_ids = ['RA-MISSING-001']
  expectError(await validateFixture(unresolved), 'unresolved_relationship')
  const asymmetric = await v2Registry()
  asymmetric[0].contradiction_ids = [String(asymmetric[1].requirement_id)]
  expectError(await validateFixture(asymmetric), 'asymmetric_contradiction')
  const self = await v2Registry()
  self[0].contradiction_ids = [String(self[0].requirement_id)]
  expectError(await validateFixture(self), 'self_relationship')

  const production = await v2Registry()
  production[0] = { ...productionEvidence(production[0]), contradiction_ids: [String(production[1].requirement_id)] }
  production[1].contradiction_ids = [String(production[0].requirement_id)]
  expectError(await validateFixture(production), 'invalid_production_evidence')
})

test('all design Status sections declare registry authority, precedence, and ID prefix', async () => {
  const documents = [
    ['2026-07-11-claude-code-2.1.207-oracle-lab-design.md', 'OL-*'],
    ['2026-07-11-claude-code-2.1.207-adversarial-validation-v2.md', 'AV-*'],
    ['2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md', 'HA-*'],
  ]
  for (const [filename, prefix] of documents) {
    const contents = await readFile(path.resolve('docs/superpowers/specs', filename), 'utf8')
    const status = contents.slice(contents.indexOf('## Status'), contents.indexOf('\n## ', contents.indexOf('## Status') + 3))
    assert.match(status, /docs\/superpowers\/registry\/oracle-lab-requirements\.json/)
    assert.match(status, /hardening_amendments > adversarial_validation_v2 > oracle_lab_design/)
    assert(status.includes(prefix), `${filename} Status is missing ${prefix}`)
  }
})

test('rejects duplicate IDs', async () => {
  const records = await registry()
  expectError(await validateFixture([...records, records[0]]), 'duplicate_requirement_id')
})

test('validator enforces the exact inventory and canonical source-section map', async () => {
  const records = await registry()
  expectError(await validateFixture(records.slice(1)), 'invalid_inventory')
  expectError(
    await validateFixture([...records, { ...records[0], requirement_id: 'HA-P0-010' }]),
    'invalid_inventory',
  )
  expectError(
    await validateFixture(await mutateRecord('HA-P0-001', { source_section: '3.1 Invented Section' })),
    'invalid_source_section',
  )
})

test('rejects unknown fields and invalid precedence', async () => {
  expectError(await validateFixture(await mutateRecord('HA-P0-001', { unexpected: true })), 'unknown_field')
  expectError(await validateFixture(await mutateRecord('HA-P0-001', { precedence: 'later_note' })), 'invalid_precedence')
})

test('rejects malformed scalar fields and nested deployed artifacts', async () => {
  expectError(await validateFixture(await mutateRecord('HA-P0-001', { acceptance_gate: 42 })), 'invalid_field')
  const records = await registry()
  const record = records.find((entry) => entry.requirement_id === 'HA-P0-001')
  assert(record)
  expectError(
    await validateFixture(await mutateRecord('HA-P0-001', {
      ...productionEvidence(record),
      deployed_artifacts: [{
        repository: 'cc-gateway', commit: 'abc', config_digest: 'sha256:abc',
        manifest_digest: 'sha256:def', deployed_at: new Date().toISOString(), unexpected: true,
      }],
    })),
    'invalid_deployed_artifact',
  )
})

test('rejects missing source sections and unresolved dependencies', async () => {
  expectError(await validateFixture(await mutateRecord('HA-P0-001', { source_section: '' })), 'missing_source_section')
  expectError(await validateFixture(await mutateRecord('HA-P0-001', { depends_on: ['HA-P0-404'] })), 'unresolved_dependency')
})

test('rejects invalid status transitions and unowned P0/P1 records', async () => {
  const record = (await registry()).find((entry) => entry.requirement_id === 'HA-P0-001')
  assert(record)
  expectError(
    await validateFixture(await mutateRecord('HA-P0-001', { implementation_status: 'production_verified' })),
    'invalid_production_evidence',
  )
  expectError(await validateFixture(await mutateRecord('HA-P0-001', { owner: '' })), 'missing_owner')
  expectError(
    await validateFixture(await mutateRecord('HA-P0-001', {
      implementation_status: 'failing_test_added',
      test_files: [],
    })),
    'invalid_status_transition',
  )
  expectError(
    await validateFixture(await mutateRecord('HA-P0-001', {
      implementation_status: 'locally_verified',
      implementation_files: [],
      last_verified_commit: '0123456789abcdef0123456789abcdef01234567',
      last_verified_at: new Date().toISOString(),
    })),
    'invalid_status_transition',
  )
})

test('Phase 0 structurally prohibits promotion of deferred compatibility and P1 requirements', async () => {
  const deferredIds = ['HA-P0-009', 'HA-P1-001', 'HA-P1-002', 'HA-P1-003', 'HA-P1-004', 'HA-P1-005', 'HA-P1-006']
  const records = await registry()
  for (const requirementId of deferredIds) {
    const record = records.find((entry) => entry.requirement_id === requirementId)
    assert(record)
    expectError(
      await validateFixture(await mutateRecord(requirementId, productionEvidence(record))),
      'phase_0_promotion_prohibited',
    )
  }
  expectError(
    await validateFixture(await mutateRecord('HA-P0-009', {
      implementation_files: ['src/negative-capability.ts'],
    })),
    'phase_0_promotion_prohibited',
  )
})

test('HA-P0-009 records the Phase 0 RED fixture while deferring enforcement to Phase 2', async () => {
  const record = (await registry()).find((entry) => entry.requirement_id === 'HA-P0-009')
  assert(record)
  assert.equal(record.implementation_status, 'deferred')
  assert.equal(record.acceptance_gate, 'phase_2_negative_capability_enforcement')
  assert.deepEqual(record.implementation_files, [])
  assert.deepEqual(record.test_files, ['tests/red/phase0-boundary.red.test.ts'])
  assert.equal(record.verification_command, 'npm exec tsx tests/red/phase0-boundary.red.test.ts')
  assert.equal(record.evidence_artifact, 'docs/superpowers/evidence/phase-0/ha-p0-009-negative-capability.failure-names.json')
  assert.deepEqual(record.known_gaps, [
    'Phase 0 fixture drives complete local HTTP requests through startProxy/handleRequest and proves missing, unknown, contradictory, unsupported, and incoherent compatibility declarations reach the upstream observer instead of failing closed',
    'implementation and enforcement are deferred to Phase 2',
    'promotion is prohibited before all compatibility gates and rollback review pass',
  ])
})

test('HA-P0-009 evidence contains only stable failure names with a reproducible digest', async () => {
  const evidence = JSON.parse(await readFile(
    path.resolve('docs/superpowers/evidence/phase-0/ha-p0-009-negative-capability.failure-names.json'),
    'utf8',
  )) as Record<string, unknown>
  const names = evidence.failure_names as string[]
  assert.equal(evidence.requirement_id, 'HA-P0-009')
  assert.equal(evidence.content, 'stable_leaf_failure_test_names_only')
  assert.deepEqual(names, [...new Set(names)].sort())
  const digest = createHash('sha256').update(`${names.join('\n')}\n`).digest('hex')
  assert.equal(evidence.failure_name_digest, `sha256:${digest}`)
  assert.deepEqual(names, [
    'HA-P0-009 rejects contradictory positive and negative capability',
    'HA-P0-009 rejects incoherent negative-capability tuple',
    'HA-P0-009 rejects missing negative-capability declaration',
    'HA-P0-009 rejects requested capability declared unsupported',
    'HA-P0-009 rejects unknown negative-capability declaration',
  ])
})

test('rejects omitted and populated production-only fields on non-production records', async () => {
  const records = await registry()
  const index = records.findIndex((record) => record.requirement_id === 'HA-P0-001')
  const record = records[index]
  const { canary_evidence_ids: _omitted, ...withoutCanaryEvidence } = record
  records[index] = withoutCanaryEvidence
  expectError(await validateFixture(records), 'missing_field')
  expectError(
    await validateFixture(await mutateRecord('HA-P0-001', { canary_evidence_ids: ['canary-1'] })),
    'non_production_evidence',
  )
})

test('production_verified requires complete current production evidence without contradictions', async () => {
  const record = (await registry()).find((entry) => entry.requirement_id === 'HA-P0-001')
  assert(record)
  const incomplete = {
    ...record,
    implementation_status: 'production_verified',
    expiry: new Date(Date.now() - 60_000).toISOString(),
  }
  expectError(await validateFixture(await mutateRecord('HA-P0-001', incomplete)), 'invalid_production_evidence')

  const validProduction = productionEvidence(record)
  assert.deepEqual(
    await validateFixture(await mutateRecord('HA-P0-001', validProduction)),
    { ok: true, errors: [] },
  )

  expectError(
    await validateFixture(await mutateRecord('HA-P0-001', { ...validProduction, contradiction_ids: ['contradiction-1'] })),
    'invalid_production_evidence',
  )
})

test('production artifacts are bound to repository and last verified commit with strict digests', async () => {
  const record = (await registry()).find((entry) => entry.requirement_id === 'HA-P0-001')
  assert(record)
  const validProduction = productionEvidence(record)
  const [artifact] = validProduction.deployed_artifacts as Requirement[]
  for (const deployedArtifact of [
    { ...artifact, repository: 'other-repository' },
    { ...artifact, commit: 'fedcba9876543210fedcba9876543210fedcba98' },
    { ...artifact, config_digest: 'sha256:ABCDEF' },
    { ...artifact, manifest_digest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  ]) {
    expectError(
      await validateFixture(await mutateRecord('HA-P0-001', {
        ...validProduction,
        deployed_artifacts: [deployedArtifact],
      })),
      'invalid_deployed_artifact',
    )
  }
  expectError(
    await validateFixture(await mutateRecord('HA-P0-001', {
      ...validProduction,
      last_verified_commit: 'not-a-commit',
    })),
    'invalid_field',
  )
})

test('timestamps require strict RFC3339 date-time values', async () => {
  for (const timestamp of ['2026-07-11', '2026-07-11 12:00:00Z', '2026-02-30T12:00:00Z', '2026-07-11T12:00:00']) {
    expectError(
      await validateFixture(await mutateRecord('HA-P0-000', { last_verified_at: timestamp })),
      'invalid_field',
    )
  }
})

test('canonical v2 JSON schema is executable and encodes governance plus production conditions', async () => {
  const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as Requirement
  assert.equal(schema.schema_version, '2.0.0')
  assert.equal(schema.$id, 'https://cc-gateway.local/schemas/oracle-lab-requirement.schema.json')
  const properties = schema.properties as Requirement
  assert.equal((properties.schema_version as Requirement).const, 2)
  for (const field of ['reviewer', 'phase_owner', 'work_package', 'introduced_after_phase', 'refines', 'supersedes', 'related_requirements']) {
    assert(field in properties, `${field} is missing from the v2 schema`)
  }
  const allOf = schema.allOf as Requirement[]
  assert(Array.isArray(allOf) && allOf.length >= 2)
  assert.equal(properties.last_verified_commit instanceof Object, true)
  const definitions = schema.$defs as Requirement
  const artifact = definitions.deployedArtifact as Requirement
  const artifactProperties = artifact.properties as Requirement
  assert.equal((artifactProperties.commit as Requirement).pattern, '^[0-9a-f]{40}$')
  assert.equal((artifactProperties.config_digest as Requirement).pattern, '^sha256:[0-9a-f]{64}$')
  assert.equal((artifactProperties.manifest_digest as Requirement).pattern, '^sha256:[0-9a-f]{64}$')
  assert(allOf.some((rule) => JSON.stringify(rule).includes('production_verified')))
  assert(allOf.some((rule) => JSON.stringify(rule).includes('maxItems')))
  assert(allOf.some((rule) => JSON.stringify(rule).includes('minItems')))
  assert(allOf.some((rule) => JSON.stringify(rule).includes('review_amendments')))

  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema)
  for (const record of await v2Registry()) assert.equal(validate(record), true, JSON.stringify(validate.errors))
})
