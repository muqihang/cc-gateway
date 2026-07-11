import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { validateRequirements } from '../tools/oracle-lab/validate-requirements.js'

const registryPath = path.resolve('docs/superpowers/registry/oracle-lab-requirements.json')
const schemaPath = path.resolve('docs/superpowers/schemas/oracle-lab-requirement.schema.json')

type Requirement = Record<string, unknown>

async function registry(): Promise<Requirement[]> {
  return JSON.parse(await readFile(registryPath, 'utf8')) as Requirement[]
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
    await validateFixture(await mutateRecord('HA-P0-001', { implementation_status: 'upstream_canary_observed' })),
    'invalid_status_transition',
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

test('JSON schema encodes runtime-equivalent production evidence conditions and strict formats', async () => {
  const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as Requirement
  const allOf = schema.allOf as Requirement[]
  assert(Array.isArray(allOf) && allOf.length >= 2)
  assert.equal((schema.properties as Requirement).last_verified_commit instanceof Object, true)
  const definitions = schema.$defs as Requirement
  const artifact = definitions.deployedArtifact as Requirement
  const artifactProperties = artifact.properties as Requirement
  assert.equal((artifactProperties.commit as Requirement).pattern, '^[0-9a-f]{40}$')
  assert.equal((artifactProperties.config_digest as Requirement).pattern, '^sha256:[0-9a-f]{64}$')
  assert.equal((artifactProperties.manifest_digest as Requirement).pattern, '^sha256:[0-9a-f]{64}$')
  assert(allOf.some((rule) => JSON.stringify(rule).includes('production_verified')))
  assert(allOf.some((rule) => JSON.stringify(rule).includes('maxItems')))
  assert(allOf.some((rule) => JSON.stringify(rule).includes('minItems')))
})
