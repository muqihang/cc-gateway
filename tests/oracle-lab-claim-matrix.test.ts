import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { validateClaims } from '../tools/oracle-lab/validate-claims.js'

const registryPath = path.resolve('docs/superpowers/registry/oracle-lab-requirements.json')
const claimsPath = path.resolve('docs/superpowers/registry/oracle-lab-claims.json')
const schemaPath = path.resolve('docs/superpowers/schemas/oracle-lab-claim.schema.json')

type Claim = Record<string, unknown>

async function requirements(): Promise<Record<string, unknown>[]> {
  return JSON.parse(await readFile(registryPath, 'utf8')) as Record<string, unknown>[]
}

async function validateFixture(claims: Claim[]) {
  const directory = await mkdtemp(path.join(tmpdir(), 'oracle-lab-claims-'))
  const fixturePath = path.join(directory, 'claims.json')
  await writeFile(fixturePath, JSON.stringify(claims))
  return validateClaims(fixturePath, await requirements())
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

test('accepts valid direct-egress structural and pinned-client observation claims', async () => {
  assert.deepEqual(await validateFixture([directEgressStructural, pinnedObservation]), { ok: true, errors: [] })
})

test('seeded claim matrix and strict schema expose the fixed authority enums', async () => {
  assert.deepEqual(validateClaims(claimsPath, await requirements()), { ok: true, errors: [] })
  const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as Record<string, any>
  assert.equal(schema.items.additionalProperties, false)
  assert.deepEqual(schema.items.properties.claim_class.enum, ['local_structural', 'local_observational', 'upstream_canary', 'provider_internal'])
  assert.deepEqual(schema.items.properties.authority_state.enum, ['unverified', 'package_observed', 'local_wire_observed', 'cross_checked', 'gateway_wire_equivalent', 'stateful_behavior_equivalent', 'upstream_canary_observed', 'production_verified'])
  assert(Array.isArray(schema.items.allOf) && schema.items.allOf.length >= 3, 'schema must encode authority ceilings and production evidence conditions')
})

test('rejects provider-internal claims derived only from synthetic correlation', async () => {
  expectError(await validateFixture([{
    ...directEgressStructural, claim_id: 'CL-PROVIDER-001', requirement_ids: ['HA-P0-003'],
    claim_class: 'provider_internal', authority_state: 'cross_checked', server_dependency: 'provider',
    statement: 'Provider linked this request to an account.', derived_from: 'synthetic-correlation',
  }]), 'provider_disclosure_required')
})

test('rejects authority/scope mismatches and local claims that imply server acceptance', async () => {
  expectError(await validateFixture([{ ...directEgressStructural, observation_scope: 'local' }]), 'authority_scope_mismatch')
  expectError(await validateFixture([{ ...pinnedObservation, server_dependency: 'server' }]), 'server_acceptance_unproven')
})

test('rejects production claims without upstream canary evidence', async () => {
  expectError(await validateFixture([{
    ...directEgressStructural, claim_id: 'CL-PRODUCTION-001', authority_state: 'production_verified',
    server_dependency: 'server', observation_scope: 'production',
    production_gate_ids: ['gate-1'], rollback_evidence_ids: ['rollback-1'],
    deployed_artifacts: [{ repository: 'cc-gateway', commit: '0123456789abcdef0123456789abcdef01234567',
      config_digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      manifest_digest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      deployed_at: new Date().toISOString() }],
    expiry: new Date(Date.now() + 3600000).toISOString(),
  }]), 'production_canary_required')
})

test('accepts production authority only after canary, gates, rollback, deployment, and current evidence', async () => {
  const records = await requirements()
  const requirement = records.find((entry) => entry.requirement_id === 'HA-P0-003')
  assert(requirement)
  requirement.production_gate_ids = ['gate-required']
  const directory = await mkdtemp(path.join(tmpdir(), 'oracle-lab-production-'))
  const fixturePath = path.join(directory, 'claims.json')
  await writeFile(fixturePath, JSON.stringify([{
    ...directEgressStructural, claim_id: 'CL-PRODUCTION-VALID-001', claim_class: 'upstream_canary',
    authority_state: 'production_verified', observation_scope: 'production', server_dependency: 'server',
    canary_evidence_ids: ['canary-1'], production_gate_ids: ['gate-required'], rollback_evidence_ids: ['rollback-1'],
    deployed_artifacts: [{ repository: 'cc-gateway', commit: '0123456789abcdef0123456789abcdef01234567',
      config_digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      manifest_digest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      deployed_at: new Date().toISOString() }], expiry: new Date(Date.now() + 3600000).toISOString(),
  }]))
  assert.deepEqual(validateClaims(fixturePath, records), { ok: true, errors: [] })
})
