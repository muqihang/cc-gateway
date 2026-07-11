import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { validateRequirements } from '../tools/oracle-lab/validate-requirements.js'

const registryPath = path.resolve('docs/superpowers/registry/oracle-lab-requirements.json')

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
  const [record] = await registry()
  expectError(await validateFixture([record, record]), 'duplicate_requirement_id')
})

test('rejects unknown fields and invalid precedence', async () => {
  const [record] = await registry()
  expectError(await validateFixture([{ ...record, unexpected: true }]), 'unknown_field')
  expectError(await validateFixture([{ ...record, precedence: 'later_note' }]), 'invalid_precedence')
})

test('rejects malformed scalar fields and nested deployed artifacts', async () => {
  const [record] = await registry()
  expectError(await validateFixture([{ ...record, acceptance_gate: 42 }]), 'invalid_field')
  expectError(
    await validateFixture([{
      ...record,
      implementation_status: 'production_verified',
      last_verified_commit: '0123456789abcdef0123456789abcdef01234567',
      last_verified_at: new Date().toISOString(),
      canary_evidence_ids: ['canary-1'],
      production_gate_ids: ['gate-1'],
      rollback_evidence_ids: ['rollback-1'],
      deployed_artifacts: [{
        repository: 'cc-gateway', commit: 'abc', config_digest: 'sha256:abc',
        manifest_digest: 'sha256:def', deployed_at: new Date().toISOString(), unexpected: true,
      }],
      expiry: new Date(Date.now() + 3_600_000).toISOString(),
    }]),
    'invalid_deployed_artifact',
  )
})

test('rejects missing source sections and unresolved dependencies', async () => {
  const [record] = await registry()
  expectError(await validateFixture([{ ...record, source_section: '' }]), 'missing_source_section')
  expectError(await validateFixture([{ ...record, depends_on: ['HA-P0-404'] }]), 'unresolved_dependency')
})

test('rejects invalid status transitions and unowned P0/P1 records', async () => {
  const record = (await registry()).find((entry) => entry.requirement_id === 'HA-P0-001')
  assert(record)
  expectError(
    await validateFixture([{ ...record, implementation_status: 'upstream_canary_observed' }]),
    'invalid_status_transition',
  )
  expectError(await validateFixture([{ ...record, owner: '' }]), 'missing_owner')
})

test('rejects omitted and populated production-only fields on non-production records', async () => {
  const [record] = await registry()
  const { canary_evidence_ids: _omitted, ...withoutCanaryEvidence } = record
  expectError(await validateFixture([withoutCanaryEvidence]), 'missing_field')
  expectError(
    await validateFixture([{ ...record, canary_evidence_ids: ['canary-1'] }]),
    'non_production_evidence',
  )
})

test('production_verified requires complete current production evidence without contradictions', async () => {
  const [record] = await registry()
  const incomplete = {
    ...record,
    implementation_status: 'production_verified',
    expiry: new Date(Date.now() - 60_000).toISOString(),
  }
  expectError(await validateFixture([incomplete]), 'invalid_production_evidence')

  const validProduction = {
    ...record,
    implementation_status: 'production_verified',
    canary_evidence_ids: ['canary-1'],
    production_gate_ids: ['gate-1'],
    rollback_evidence_ids: ['rollback-1'],
    deployed_artifacts: [{
      repository: 'cc-gateway',
      commit: '0123456789abcdef0123456789abcdef01234567',
      config_digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      manifest_digest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      deployed_at: new Date().toISOString(),
    }],
    expiry: new Date(Date.now() + 3_600_000).toISOString(),
    contradiction_ids: [],
    last_verified_commit: '0123456789abcdef0123456789abcdef01234567',
    last_verified_at: new Date().toISOString(),
  }
  assert.deepEqual(await validateFixture([validProduction]), { ok: true, errors: [] })

  expectError(
    await validateFixture([{ ...validProduction, contradiction_ids: ['contradiction-1'] }]),
    'invalid_production_evidence',
  )
})
