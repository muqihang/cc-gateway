import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { validateClaims } from '../tools/oracle-lab/validate-claims.js'

const registryPath = path.resolve('docs/superpowers/registry/oracle-lab-requirements.json')
const v1RegistryPath = path.resolve('docs/superpowers/registry/oracle-lab-requirements-v1.json')
const claimsPath = path.resolve('docs/superpowers/registry/oracle-lab-claims.json')
const schemaPath = path.resolve('docs/superpowers/schemas/oracle-lab-claim.schema.json')

type RecordValue = Record<string, unknown>
type Claim = RecordValue

const prohibitedClaims: Record<string, Claim> = {
  'CL-OFFICIAL-CLIENT-IDENTITY-PROHIBITED': { requirement_ids: ['RA-P1-002'], claim_class: 'provider_internal', server_dependency: 'provider', stability_class: 'provider-unknown', confidence: 1.0, statement: 'Matching local headers does not prove official-client identity.' },
  'CL-CCH-SERVER-ACCEPTANCE-PROHIBITED': { requirement_ids: ['RA-P1-001'], claim_class: 'provider_internal', server_dependency: 'server', stability_class: 'server-version-dependent', confidence: 1.0, statement: 'Local CCH verification does not prove server acceptance.' },
  'CL-DEVICE-PROOF-PROHIBITED': { requirement_ids: ['RA-P1-005'], claim_class: 'provider_internal', server_dependency: 'provider', stability_class: 'provider-unknown', confidence: 1.0, statement: 'A stable `device_id` is not trusted-device proof.' },
  'CL-TLS-WIRE-EQUIVALENCE-PROHIBITED': { requirement_ids: ['RA-P0-003', 'RA-P1-001'], claim_class: 'local_observational', server_dependency: 'local', stability_class: 'transport-version-dependent', confidence: 1.0, statement: 'A local TLS summary does not prove complete wire equivalence.' },
  'CL-LONG-TERM-ACCOUNT-SAFETY-PROHIBITED': { requirement_ids: ['RA-P0-009'], claim_class: 'provider_internal', server_dependency: 'provider', stability_class: 'longitudinal-provider-dependent', confidence: 1.0, statement: 'One successful request does not prove long-term account safety.' },
  'CL-CHANGELOG-RISK-RULES-PROHIBITED': { requirement_ids: ['RA-P1-001'], claim_class: 'provider_internal', server_dependency: 'provider', stability_class: 'provider-private', confidence: 1.0, statement: 'Public changelog entries do not reveal private risk-control rules.' },
  'CL-NEWER-PERSONA-PROMOTION-PROHIBITED': { requirement_ids: ['RA-P1-002'], claim_class: 'local_structural', server_dependency: 'local', stability_class: 'profile-version-dependent', confidence: 1.0, statement: 'A newer client version cannot select a newer outbound persona without profile authority.' },
  'CL-LOCAL-EVIDENCE-PRODUCTION-PROHIBITED': { requirement_ids: ['RA-P0-009'], claim_class: 'provider_internal', server_dependency: 'provider', stability_class: 'deployment-gated', confidence: 1.0, statement: 'Local or mock evidence does not authorize production traffic.' },
}

const prohibitedClaimIds = Object.keys(prohibitedClaims)

async function requirements(): Promise<RecordValue[]> {
  return JSON.parse(await readFile(registryPath, 'utf8')) as RecordValue[]
}

async function v2Requirements(): Promise<RecordValue[]> {
  const records = await requirements()
  if (records.every((record) => record.schema_version === 2)) return records.map((record) => ({ ...record }))
  return records.map((record, index) => ({
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

async function validateRaw(contents: string, records?: RecordValue[]) {
  const directory = await mkdtemp(path.join(tmpdir(), 'oracle-lab-claims-'))
  const fixturePath = path.join(directory, 'claims.json')
  await writeFile(fixturePath, contents)
  return validateClaims(fixturePath, records ?? await requirements())
}

async function validateFixture(claims: unknown, records?: RecordValue[]) {
  return validateRaw(JSON.stringify(claims), records)
}

function expectError(result: Awaited<ReturnType<typeof validateClaims>>, code: string) {
  assert.equal(result.ok, false)
  assert(result.errors.some((error) => error.code === code), JSON.stringify(result.errors))
}

const directEgressStructural: Claim = {
  claim_id: 'CL-DIRECT-EGRESS-001', requirement_ids: ['HA-P0-003'],
  claim_class: 'local_structural', authority_state: 'cross_checked',
  statement: 'The gateway direct-egress path is structurally disabled.',
  evidence_ids: ['fixture-structural-1'], observation_scope: 'cross_checked',
  server_dependency: 'none', stability_class: 'structural', confidence: 0.98,
  contradiction_ids: [], expiry: null, derived_from: 'source-and-static-analysis',
  canary_evidence_ids: [], production_gate_ids: [], rollback_evidence_ids: [], deployed_artifacts: [],
  authoritative_provider_disclosure: false,
}

const pinnedObservation: Claim = {
  claim_id: 'CL-PINNED-OBS-001', requirement_ids: ['HA-P0-006'],
  claim_class: 'local_observational', authority_state: 'local_wire_observed',
  statement: 'The pinned client emitted the recorded request shape in the hermetic lab.',
  evidence_ids: ['fixture-wire-1'], observation_scope: 'local_wire',
  server_dependency: 'none', stability_class: 'observational', confidence: 0.91,
  contradiction_ids: [], expiry: null, derived_from: 'pinned-client-run',
  canary_evidence_ids: [], production_gate_ids: [], rollback_evidence_ids: [], deployed_artifacts: [],
  authoritative_provider_disclosure: false,
}

const productionArtifact = {
  repository: 'cc-gateway',
  commit: '0123456789abcdef0123456789abcdef01234567',
  config_digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  manifest_digest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  deployed_at: '2026-07-11T18:00:00Z',
}

function authoritativeRequirement(record: RecordValue): RecordValue {
  return {
    ...record,
    implementation_status: 'production_verified',
    implementation_files: ['tools/oracle-lab/validate-claims.ts'],
    test_files: ['tests/oracle-lab-claim-matrix.test.ts'],
    repository: productionArtifact.repository,
    last_verified_commit: productionArtifact.commit,
    last_verified_at: '2026-07-11T18:00:00Z',
    expiry: '2099-07-11T18:00:00Z',
    canary_evidence_ids: ['canary-authoritative'],
    production_gate_ids: ['gate-authoritative'],
    rollback_evidence_ids: ['rollback-authoritative'],
    deployed_artifacts: [productionArtifact],
    contradiction_ids: [],
  }
}

function nonAuthoritativeRequirement(record: RecordValue, status: string): RecordValue {
  const verified = status === 'locally_verified' || status === 'upstream_canary_observed'
  return {
    ...record,
    implementation_status: status,
    implementation_files: verified ? ['tools/oracle-lab/validate-claims.ts'] : [],
    test_files: status === 'failing_test_added' || verified ? ['tests/oracle-lab-claim-matrix.test.ts'] : [],
    last_verified_commit: verified ? productionArtifact.commit : null,
    last_verified_at: verified ? '2026-07-11T18:00:00Z' : null,
    expiry: null,
    canary_evidence_ids: [],
    production_gate_ids: [],
    rollback_evidence_ids: [],
    deployed_artifacts: [],
    contradiction_ids: [],
  }
}

function productionClaim(changes: Claim = {}): Claim {
  return {
    ...directEgressStructural,
    claim_id: 'CL-PRODUCTION-VALID-001',
    claim_class: 'upstream_canary',
    authority_state: 'production_verified',
    observation_scope: 'production',
    server_dependency: 'server',
    evidence_ids: ['canary-authoritative', 'gate-authoritative', 'rollback-authoritative'],
    canary_evidence_ids: ['canary-authoritative'],
    production_gate_ids: ['gate-authoritative'],
    rollback_evidence_ids: ['rollback-authoritative'],
    deployed_artifacts: [productionArtifact],
    expiry: '2099-07-11T18:00:00Z',
    ...changes,
  }
}

async function authoritativeRecords(requirementId = 'HA-P0-003') {
  const records = await requirements()
  const index = records.findIndex((entry) => entry.requirement_id === requirementId)
  assert.notEqual(index, -1)
  records[index] = authoritativeRequirement(records[index])
  return records
}

test('accepts valid direct-egress structural and pinned-client observation claims', async () => {
  assert.deepEqual(await validateFixture([directEgressStructural, pinnedObservation]), { ok: true, errors: [] })
})

test('consumes normalized homogeneous v2 requirement arrays without weakening claim authority', async () => {
  const v2 = await v2Requirements()
  const v1 = JSON.parse(await readFile(v1RegistryPath, 'utf8')) as RecordValue[]
  assert.deepEqual(await validateFixture([directEgressStructural, pinnedObservation], v2), { ok: true, errors: [] })
  expectError(await validateFixture([directEgressStructural], [...v1.slice(0, 1), ...v2.slice(1)]), 'invalid_requirement_registry')

  const authoritative = v2.map((record) => ({ ...record }))
  const index = authoritative.findIndex((entry) => entry.requirement_id === 'HA-P0-003')
  assert.notEqual(index, -1)
  authoritative[index] = authoritativeRequirement(authoritative[index])
  assert.deepEqual(await validateFixture([productionClaim()], authoritative), { ok: true, errors: [] })

  const inheritedAuthority = authoritative.map((record) => Object.create(record) as RecordValue)
  expectError(await validateFixture([productionClaim()], inheritedAuthority), 'invalid_requirement_registry')
})

test('seed claims state only the Phase 0 negative capabilities actually supported by evidence', async () => {
  const seeded = JSON.parse(await readFile(claimsPath, 'utf8')) as Claim[]
  const directEgress = seeded.find((claim) => claim.claim_id === 'CL-DIRECT-EGRESS-001')
  const pinnedWire = seeded.find((claim) => claim.claim_id === 'CL-PINNED-OBS-001')
  assert(directEgress)
  assert.equal(directEgress.authority_state, 'unverified')
  assert.equal(directEgress.observation_scope, 'local')
  assert.deepEqual(directEgress.evidence_ids, [])
  assert.match(String(directEgress.statement), /not proven disabled/i)
  assert.match(String(directEgress.statement), /B4 RED/i)
  assert(pinnedWire)
  assert.equal(pinnedWire.authority_state, 'unverified')
  assert.equal(pinnedWire.observation_scope, 'local')
  assert.deepEqual(pinnedWire.evidence_ids, [])
  assert.match(String(pinnedWire.statement), /no persisted local-wire artifact/i)
  assert.match(String(pinnedWire.statement), /Phase 3/i)
})

test('seed claim matrix registers all eight prohibited conclusions as exact negative unverified rows', async () => {
  const seeded = JSON.parse(await readFile(claimsPath, 'utf8')) as Claim[]
  assert.equal(seeded.length, 10)
  assert.deepEqual(seeded.slice(-8).map((claim) => claim.claim_id), prohibitedClaimIds)
  for (const id of prohibitedClaimIds) {
    const claim = seeded.find((entry) => entry.claim_id === id)
    assert(claim, `${id} is missing`)
    for (const [field, value] of Object.entries(prohibitedClaims[id])) assert.deepEqual(claim[field], value, `${id}.${field}`)
    assert.equal(claim.authority_state, 'unverified')
    assert.equal(claim.observation_scope, 'local')
    assert.deepEqual(claim.evidence_ids, [])
    assert.deepEqual(claim.contradiction_ids, [])
    assert.equal(claim.expiry, null)
    assert.deepEqual(claim.canary_evidence_ids, [])
    assert.deepEqual(claim.production_gate_ids, [])
    assert.deepEqual(claim.rollback_evidence_ids, [])
    assert.deepEqual(claim.deployed_artifacts, [])
    assert.equal(claim.derived_from, 'review-amendments-section-2.2')
    assert.equal(claim.authoritative_provider_disclosure, false)
  }
  assert.deepEqual(validateClaims(claimsPath, await requirements()), { ok: true, errors: [] })
})

test('known prohibited claim IDs fail closed if rewritten as positive conclusions', async () => {
  const seeded = JSON.parse(await readFile(claimsPath, 'utf8')) as Claim[]
  for (const id of prohibitedClaimIds) {
    const mutated = seeded.map((claim) => claim.claim_id === id
      ? { ...claim, statement: `Positive provider-internal conclusion asserted by ${id}.` }
      : claim)
    expectError(await validateFixture(mutated), 'invalid_prohibited_claim')
  }
})

test('inherited-only prohibited claim fixtures fail closed at the JSON exact-shape boundary', async () => {
  const seeded = JSON.parse(await readFile(claimsPath, 'utf8')) as Claim[]
  const prohibited = seeded.find((claim) => claim.claim_id === prohibitedClaimIds[0])
  assert(prohibited)
  expectError(await validateFixture([Object.create(prohibited) as Claim]), 'missing_field')
})

test('seeded claim matrix and strict schema expose runtime-equivalent authority rules', async () => {
  assert.deepEqual(validateClaims(claimsPath, await requirements()), { ok: true, errors: [] })
  const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as RecordValue
  const items = schema.items as RecordValue
  const serialized = JSON.stringify(items.allOf)
  assert.equal(items.additionalProperties, false)
  assert.deepEqual((items.properties as RecordValue).claim_class && ((items.properties as RecordValue).claim_class as RecordValue).enum,
    ['local_structural', 'local_observational', 'upstream_canary', 'provider_internal'])
  for (const token of ['local_structural', 'local_observational', 'server_dependency', 'provider',
    'authoritative_provider_disclosure', 'evidence_ids', 'observation_scope', 'production_verified',
    'canary_evidence_ids', 'production_gate_ids', 'rollback_evidence_ids', 'deployed_artifacts']) {
    assert(serialized.includes(token), `schema conditionals are missing ${token}`)
  }
  const definitions = schema.$defs as RecordValue
  assert.equal(((definitions.stringArray as RecordValue).uniqueItems), true)
  assert.equal(((definitions.rfc3339Timestamp as RecordValue).pattern),
    '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$')
})

test('rejects malformed registries, missing and unknown fields, and duplicate values', async () => {
  expectError(await validateRaw('{'), 'invalid_registry')
  expectError(await validateFixture({}), 'invalid_registry')
  expectError(await validateFixture([42]), 'invalid_record')
  const { statement: _statement, ...missing } = directEgressStructural
  expectError(await validateFixture([missing]), 'missing_field')
  expectError(await validateFixture([{ ...directEgressStructural, unexpected: true }]), 'unknown_field')
  expectError(await validateFixture([directEgressStructural, directEgressStructural]), 'duplicate_claim_id')
  for (const field of ['requirement_ids', 'evidence_ids', 'contradiction_ids', 'canary_evidence_ids',
    'production_gate_ids', 'rollback_evidence_ids'] as const) {
    expectError(await validateFixture([{ ...directEgressStructural, [field]: ['duplicate', 'duplicate'] }]), 'invalid_field')
  }
})

test('rejects provider-internal authority without authoritative disclosure at every elevated state', async () => {
  for (const authority of ['package_observed', 'cross_checked', 'production_verified']) {
    const claim = productionClaim({
      claim_id: `CL-PROVIDER-${authority.toUpperCase().replaceAll('_', '-')}`,
      claim_class: 'provider_internal', authority_state: authority,
      observation_scope: authority === 'production_verified' ? 'production' : authority === 'cross_checked' ? 'cross_checked' : 'package',
      server_dependency: 'provider', authoritative_provider_disclosure: false,
      derived_from: authority === 'package_observed' ? 'provider-shaped-package' : 'synthetic-correlation',
    })
    expectError(await validateFixture([claim], await authoritativeRecords()), 'provider_disclosure_required')
  }
  assert.deepEqual(await validateFixture([{
    ...directEgressStructural, claim_id: 'CL-PROVIDER-UNVERIFIED', claim_class: 'provider_internal',
    authority_state: 'unverified', observation_scope: 'local', server_dependency: 'provider',
    evidence_ids: [], authoritative_provider_disclosure: false, derived_from: 'synthetic-correlation',
  }]), { ok: true, errors: [] })
})

test('enforces local claim authority ceilings and forbids every server/provider dependency conclusion', async () => {
  expectError(await validateFixture([{ ...directEgressStructural, observation_scope: 'local' }]), 'authority_scope_mismatch')
  for (const claimClass of ['local_structural', 'local_observational']) {
    for (const dependency of ['server', 'provider']) {
      expectError(await validateFixture([{
        ...directEgressStructural,
        claim_id: `CL-LOCAL-${claimClass.toUpperCase().replaceAll('_', '-')}-${dependency.toUpperCase()}`,
        claim_class: claimClass, authority_state: 'unverified', observation_scope: 'local',
        evidence_ids: [], server_dependency: dependency,
      }]), 'server_dependency_unproven')
    }
  }
  expectError(await validateFixture([{
    ...pinnedObservation, authority_state: 'upstream_canary_observed', observation_scope: 'upstream_canary',
  }]), 'authority_ceiling_exceeded')
})

test('non-unverified authority requires evidence and non-production claims reject production fields', async () => {
  expectError(await validateFixture([{ ...pinnedObservation, evidence_ids: [] }]), 'evidence_required')
  expectError(await validateFixture([{ ...directEgressStructural, expiry: '2099-07-11T18:00:00Z' }]), 'non_production_evidence')
  expectError(await validateFixture([{ ...directEgressStructural, canary_evidence_ids: ['invented'] }]), 'non_production_evidence')
})

test('production authority rejects non-authoritative requirement records and invented registry evidence', async () => {
  for (const status of ['design_only', 'deferred', 'failing_test_added', 'locally_verified', 'upstream_canary_observed']) {
    const records = await authoritativeRecords()
    const index = records.findIndex((entry) => entry.requirement_id === 'HA-P0-003')
    assert.notEqual(index, -1)
    records[index] = nonAuthoritativeRequirement(records[index], status)
    expectError(await validateFixture([productionClaim()], records), 'requirement_authority_insufficient')
  }
  for (const [field, value] of [
    ['canary_evidence_ids', ['invented-canary']],
    ['production_gate_ids', ['invented-gate']],
    ['rollback_evidence_ids', ['invented-rollback']],
    ['evidence_ids', ['invented-evidence']],
  ] as const) {
    expectError(await validateFixture([productionClaim({ [field]: value })], await authoritativeRecords()), 'requirement_evidence_mismatch')
  }
})

test('production authority requires exact requirement repository, commit, and artifact digests', async () => {
  const mutations: Claim[] = [
    { deployed_artifacts: [{ ...productionArtifact, repository: 'other-repository' }] },
    { deployed_artifacts: [{ ...productionArtifact, commit: 'fedcba9876543210fedcba9876543210fedcba98' }] },
    { deployed_artifacts: [{ ...productionArtifact, config_digest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' }] },
    { deployed_artifacts: [{ ...productionArtifact, manifest_digest: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' }] },
    { deployed_artifacts: [{ ...productionArtifact, deployed_at: '2026-02-30T12:00:00Z' }] },
    { deployed_artifacts: [{ ...productionArtifact, unexpected: true }] },
    { deployed_artifacts: 'not-an-array' },
  ]
  for (const mutation of mutations) {
    expectError(await validateFixture([productionClaim(mutation)], await authoritativeRecords()),
      Array.isArray(mutation.deployed_artifacts) && mutation.deployed_artifacts.some((artifact) =>
        typeof artifact === 'object' && artifact !== null && ('unexpected' in artifact || (artifact as RecordValue).deployed_at === '2026-02-30T12:00:00Z'))
        ? 'invalid_deployed_artifact' : 'requirement_artifact_mismatch')
  }

  const records = await authoritativeRecords()
  const record = records.find((entry) => entry.requirement_id === 'HA-P0-003')
  assert(record)
  record.last_verified_commit = 'fedcba9876543210fedcba9876543210fedcba98'
  expectError(await validateFixture([productionClaim()], records), 'invalid_requirement_registry')
})

test('production evidence must be current, contradiction-free, and exactly linked across all requirements', async () => {
  expectError(await validateFixture([productionClaim({ expiry: '2020-01-01T00:00:00Z' })], await authoritativeRecords()), 'production_expiry_required')
  expectError(await validateFixture([productionClaim({ contradiction_ids: ['open-contradiction'] })], await authoritativeRecords()), 'production_contradiction')

  for (const requirementMutation of [
    { expiry: '2020-01-01T00:00:00Z' },
    { contradiction_ids: ['requirement-contradiction'] },
  ]) {
    const expiredOrContradicted = await authoritativeRecords()
    const record = expiredOrContradicted.find((entry) => entry.requirement_id === 'HA-P0-003')
    assert(record)
    Object.assign(record, requirementMutation)
    expectError(await validateFixture([productionClaim()], expiredOrContradicted), 'invalid_requirement_registry')
  }

  const records = await authoritativeRecords()
  const secondIndex = records.findIndex((entry) => entry.requirement_id === 'HA-P0-006')
  assert.notEqual(secondIndex, -1)
  records[secondIndex] = {
    ...authoritativeRequirement(records[secondIndex]),
    canary_evidence_ids: ['canary-second'], production_gate_ids: ['gate-second'], rollback_evidence_ids: ['rollback-second'],
  }
  expectError(await validateFixture([productionClaim({ requirement_ids: ['HA-P0-003', 'HA-P0-006'] })], records), 'requirement_evidence_mismatch')
  assert.deepEqual(await validateFixture([productionClaim({
    requirement_ids: ['HA-P0-003', 'HA-P0-006'],
    evidence_ids: ['canary-authoritative', 'canary-second', 'gate-authoritative', 'gate-second', 'rollback-authoritative', 'rollback-second'],
    canary_evidence_ids: ['canary-authoritative', 'canary-second'],
    production_gate_ids: ['gate-authoritative', 'gate-second'],
    rollback_evidence_ids: ['rollback-authoritative', 'rollback-second'],
  })], records), { ok: true, errors: [] })
})

test('accepts production authority only with fully authoritative requirements and exact artifacts', async () => {
  assert.deepEqual(await validateFixture([productionClaim()], await authoritativeRecords()), { ok: true, errors: [] })
})

test('fails closed before authority derivation when supplied requirements are not a complete Task 1 registry', async () => {
  const records = await authoritativeRecords()
  const partial = records.find((entry) => entry.requirement_id === 'HA-P0-003')
  assert(partial)
  expectError(await validateFixture([productionClaim()], [partial]), 'invalid_requirement_registry')

  const invented = records.map((entry) => entry.requirement_id === 'HA-P0-003'
    ? { ...entry, requirement_id: 'HA-P0-999' }
    : entry)
  expectError(await validateFixture([productionClaim()], invented), 'invalid_requirement_registry')
})

test('fails closed on duplicate requirement evidence arrays before production claim linkage', async () => {
  const records = await authoritativeRecords()
  const record = records.find((entry) => entry.requirement_id === 'HA-P0-003')
  assert(record)
  record.canary_evidence_ids = ['canary-authoritative', 'canary-authoritative']
  expectError(await validateFixture([productionClaim()], records), 'invalid_requirement_registry')
})

test('timestamps reject impossible calendar dates using Task 1 RFC3339 strictness', async () => {
  for (const timestamp of ['2026-02-30T12:00:00Z', '2026-13-01T12:00:00Z', '2026-07-11T25:00:00Z', '2026-07-11 12:00:00Z']) {
    expectError(await validateFixture([productionClaim({ expiry: timestamp })], await authoritativeRecords()), 'invalid_field')
  }
})
