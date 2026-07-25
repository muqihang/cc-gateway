import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  CLOSURE_ORDER,
  buildBlockedCandidateClosure,
  buildBlockedConclusions,
  buildMissingCampaignMatrix,
  emitBlockedCloseout,
  evaluateTerminalGates,
  validateClosureOrder,
} from '../tools/oracle-lab/phase3b-evidence-sufficiency/closeout.js'
import { validateEvidenceArtifact } from '../tools/oracle-lab/phase3b-evidence-sufficiency/schemas.js'

const CAMPAIGN_ID = 'p3b-es1-blocked-test'

test('blocked matrix accounts for the exact 340 planned target launches without executing one', () => {
  const matrix = buildMissingCampaignMatrix(CAMPAIGN_ID)
  assert.equal(matrix.runs.length, 340)
  assert.equal(matrix.families.length, 26)
  assert.equal(matrix.runs.filter((run) => run.status === 'missing').length, 340)
  assert.deepEqual(matrix.counts, {
    config: 80,
    auth: 80,
    wire: 30,
    failure: 130,
    controls: 20,
    total: 340,
  })

  for (const family of matrix.families) {
    assert.equal(family.observed_rows, 0)
    assert.equal(family.status, 'Unknown')
    const runs = matrix.runs.filter((run) => run.family_id === family.family_id)
    assert.equal(runs.length, family.expected_rows)
    const armCounts = new Map<string, number>()
    for (const run of runs) armCounts.set(run.arm, (armCounts.get(run.arm) ?? 0) + 1)
    assert.ok([...armCounts.values()].every((count) => count === 5))
  }
})

test('blocked candidate and conclusions are a fail-closed set with exact 14-day expiry', () => {
  const matrix = buildMissingCampaignMatrix(CAMPAIGN_ID)
  const candidate = buildBlockedCandidateClosure(CAMPAIGN_ID, matrix.runs, ['/request/method'])
  assert.equal(candidate.complete, false)
  assert.equal(candidate.fixture_bindings.length, 0)
  assert.equal(candidate.required_runs.length, 340)

  const issuedAtMs = 1_722_000_000_000
  const conclusions = buildBlockedConclusions(CAMPAIGN_ID, issuedAtMs, [
    'prelaunch-mutation-executor-unproven',
    'prelaunch-receiver-identity-omitted',
  ])
  assert.equal(conclusions.length, 3)
  for (const conclusion of conclusions) {
    assert.equal(conclusion.value.level, 'Unknown')
    assert.equal(conclusion.value.phase3b_usable, false)
    assert.equal(conclusion.value.expires_at_ms - conclusion.value.issued_at_ms, 1_209_600_000)
    assert.deepEqual(conclusion.value.fixture_bindings, [])
    assert.deepEqual(conclusion.value.owned_fields, [])
  }
})

test('closure order and independent gates remain fail closed', () => {
  assert.deepEqual(CLOSURE_ORDER, [
    'artifact-index',
    'leak-report',
    'exit-report',
    'handoff',
    'terminal-manifest',
    'external-digest-set',
  ])
  assert.doesNotThrow(() => validateClosureOrder(CLOSURE_ORDER))
  assert.throws(
    () => validateClosureOrder(['leak-report', 'artifact-index', ...CLOSURE_ORDER.slice(2)]),
    (error: unknown) => (error as { code?: string }).code === 'dag_invalid',
  )
  assert.deepEqual(evaluateTerminalGates({
    es0_to_es15_terminal: true,
    closure_chain_valid: true,
    protected_count: 0,
    raw_or_sensitive_persisted: false,
    repositories_clean: true,
    conclusions: ['Unknown', 'Unknown', 'Unknown'],
    phase3b_usable: [false, false, false],
    uncovered_e_leaves: 1,
    open_contradictions: 2,
    leak_findings: 0,
    mutation_disagreements: 0,
    fixtures_materializable: false,
    cross_repo_agreement: false,
    expiry_exact: true,
    unexpired: true,
  }), { gate_a: 'PASS', gate_b: 'FAIL' })
})

test('blocked closeout writes the fixed chain once and validates every closure schema', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'p3b-es-blocked-closeout-'))
  const control = path.join(root, 'capsules/P3B-ES1/control')
  mkdirSync(control, { recursive: true, mode: 0o700 })
  writeFileSync(path.join(control, 'prelaunch-control.json'), JSON.stringify({
    schema_id: 'oracle-lab-p3b-es-test-control.v1',
    raw_material_persisted: false,
  }), { mode: 0o600 })

  const result = await emitBlockedCloseout({
    evidence_root: root,
    cc_root: path.resolve('.'),
    campaign_id: CAMPAIGN_ID,
    issued_at_ms: 1_722_000_000_000,
    protected_count: 0,
    repositories_clean: true,
  })
  assert.equal(result.status, 'BLOCKED')
  assert.equal(result.target_launches, 0)
  assert.deepEqual(result.gates, { gate_a: 'PASS', gate_b: 'FAIL' })

  const schemaById = {
    'artifact-index': 'artifact-index.schema.json',
    'leak-report': 'leak-report.schema.json',
    'exit-report': 'exit-report.schema.json',
    handoff: 'handoff.schema.json',
    'terminal-manifest': 'terminal-manifest.schema.json',
    'external-digest-set': 'external-digest-set.schema.json',
  } as const
  for (const id of CLOSURE_ORDER) {
    const file = path.join(root, `capsules/P3B-ES1/closure/${id}.json`)
    assert.equal(existsSync(file), true, id)
    const value = JSON.parse(readFileSync(file, 'utf8'))
    assert.deepEqual(validateEvidenceArtifact(schemaById[id], value), { allowed: true, code: 'admission_allow' })
  }
  await assert.rejects(
    () => emitBlockedCloseout({
      evidence_root: root, cc_root: path.resolve('.'), campaign_id: CAMPAIGN_ID,
      issued_at_ms: 1_722_000_000_000, protected_count: 0, repositories_clean: true,
    }),
    (error: unknown) => (error as { code?: string }).code === 'evidence_exists',
  )
})
