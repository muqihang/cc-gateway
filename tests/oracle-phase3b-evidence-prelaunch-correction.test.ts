import assert from 'node:assert/strict'
import { chmodSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  compareMutationExecutions,
  executeEvidenceMutations,
  expectedMutationResults,
  loadEvidenceMutationCorpus,
  validateMutationRecipes,
  validateSuccessorFreshness,
} from '../tools/oracle-lab/phase3b-evidence-sufficiency/schemas.js'
import { comparePairedObservations } from '../tools/oracle-lab/phase3b-evidence-sufficiency/core.js'
import {
  runCellGuardSelfTest,
  validateGuardScratchFile,
  writeGuardScratchExclusive,
} from '../tools/oracle-lab/phase3a/run-cell.js'
import { buildSupplementGuardManifest } from '../tools/oracle-lab/phase3b-evidence-sufficiency/controls.js'

const sha = (value: string) => value.repeat(64).slice(0, 64)

function observation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    arm: 'uninstrumented', cell_id: 'cell-a', sequence_index: 1, repetition: 0, connection_ordinal: 0,
    receiver_process_digest: sha('a'), receiver_source_sha256: sha('a'), active_static_anchor_sha256: sha('b'),
    pair_id: 'wire-pair', deterministic_seed: 215001, authority_class: 'synthetic-loopback',
    method: 'POST', path: '/v1/messages', ordered_header_names: ['content-type'], header_multiplicity: { 'content-type': 1 },
    auth_marker_winner_class: 'absent', canonical_body_sha256: sha('c'), typed_request_ast: { safe: true },
    attempt_ordinal: 0, scenario_action_ordinal: 0, response_program_ref: 'complete_sse',
    response_projection: { terminal_event: 'message_stop' }, wire_action_completed: true, raw_material_persisted: false,
    ...overrides,
  }
}

test('48 typed recipes execute independently from expected-results', () => {
  const recipes = loadEvidenceMutationCorpus()
  assert.equal(recipes.length, 48)
  assert.equal(new Set(recipes.map((entry) => entry.id)).size, 48)
  validateMutationRecipes(recipes)
  for (const entry of recipes) {
    assert.deepEqual(Object.keys(entry.recipe).sort(), ['action', 'schema', 'subject'])
    assert.equal(JSON.stringify(entry.recipe).includes('expected_code'), false)
    assert.ok(entry.recipe.subject.length > 0)
    assert.ok(entry.recipe.schema.length > 0)
    assert.ok(entry.recipe.action.kind.length > 0)
  }

  const observations = executeEvidenceMutations(recipes)
  assert.equal(observations.length, 48)
  assert.ok(observations.every((entry) => entry.actual_code !== 'admission_allow'))
  const expected = expectedMutationResults()
  assert.equal(compareMutationExecutions(observations, expected).filter((entry) => !entry.agrees).length, 0)

  const permuted = { ...expected, duplicate_json_key: expected.invalid_utf8 }
  const comparison = compareMutationExecutions(observations, permuted)
  assert.equal(comparison.find((entry) => entry.id === 'duplicate_json_key')?.actual_code, 'json_duplicate_key')
  assert.equal(comparison.find((entry) => entry.id === 'duplicate_json_key')?.agrees, false)
})

test('unknown or expected-code-bearing mutation recipes fail before execution', () => {
  const recipes = loadEvidenceMutationCorpus()
  const unknown = structuredClone(recipes) as any[]
  unknown[0].id = 'unknown_mutation'
  assert.throws(() => validateMutationRecipes(unknown), (error: unknown) => (error as { code?: string }).code === 'mutation_recipe_invalid')

  const mismatched = structuredClone(recipes) as any[]
  mismatched[0].recipe.action.kind = 'unknown_action'
  assert.throws(() => validateMutationRecipes(mismatched), (error: unknown) => (error as { code?: string }).code === 'mutation_recipe_invalid')

  const tautological = structuredClone(recipes) as any[]
  tautological[0].recipe.action.expected_code = 'json_duplicate_key'
  assert.throws(() => validateMutationRecipes(tautological), (error: unknown) => (error as { code?: string }).code === 'mutation_recipe_invalid')
})

test('freshness mutations hit distinct strict contracts', () => {
  const observations = executeEvidenceMutations(loadEvidenceMutationCorpus())
  assert.equal(observations.find((entry) => entry.id === 'predecessor_expiry_edit')?.actual_code, 'source_binding_invalid')
  assert.equal(observations.find((entry) => entry.id === 'successor_issue_time_reuse')?.actual_code, 'successor_issue_time_reuse')
  assert.equal(observations.find((entry) => entry.id === 'successor_expiry_not_14_days')?.actual_code, 'successor_expiry_not_14_days')

  assert.throws(() => validateSuccessorFreshness({
    predecessor_issued_at_ms: 100,
    successor_issued_at_ms: 200,
    successor_expires_at_ms: 1_001,
    now_ms: 1_000,
  }), (error: unknown) => (error as { code?: string }).code === 'successor_expiry_not_14_days')
})

test('paired comparison binds receiver digest, source, and active anchor', () => {
  const left = observation()
  const allowedPeer = observation({ arm: 'instrumented', cell_id: 'cell-b', sequence_index: 9, repetition: 4, connection_ordinal: 7 })
  assert.deepEqual(comparePairedObservations(left, allowedPeer), { equivalent: true, differing_pointers: [] })

  for (const peer of [
    observation({ receiver_process_digest: sha('d') }),
    observation({ receiver_source_sha256: sha('d') }),
    observation({ active_static_anchor_sha256: sha('d') }),
    observation({ receiver_process_digest: undefined }),
    observation({ receiver_process_digest: 'malformed' }),
  ]) assert.throws(() => comparePairedObservations(left, peer), (error: unknown) => (error as { code?: string }).code === 'paired_perturbation')
})

test('guard scratch writer is 0600, exclusive, and symlink refusing', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'p3b-es-guard-scratch-'))
  chmodSync(root, 0o700)
  const file = path.join(root, 'scratch.tmp')
  writeGuardScratchExclusive(file, Buffer.from('synthetic'))
  assert.equal(lstatSync(file).mode & 0o777, 0o600)
  assert.doesNotThrow(() => validateGuardScratchFile(file))
  assert.throws(() => writeGuardScratchExclusive(file, Buffer.from('duplicate')), (error: unknown) => (error as { code?: string }).code === 'evidence_exists')

  const loose = path.join(root, 'loose.tmp')
  writeFileSync(loose, 'synthetic', { mode: 0o644 })
  assert.throws(() => validateGuardScratchFile(loose), (error: unknown) => (error as { code?: string }).code === 'mode_mismatch')

  const target = path.join(root, 'target.tmp')
  writeFileSync(target, 'target', { mode: 0o600 })
  const link = path.join(root, 'link.tmp')
  symlinkSync(target, link)
  assert.throws(() => writeGuardScratchExclusive(link, Buffer.from('blocked')), (error: unknown) => (error as { code?: string }).code === 'source_binding_invalid')

  const nested = path.join(root, 'nested')
  mkdirSync(nested, { mode: 0o755 })
  assert.throws(() => writeGuardScratchExclusive(path.join(nested, 'bad.tmp'), Buffer.from('blocked')), (error: unknown) => (error as { code?: string }).code === 'mode_mismatch')
})

test('actual same-scope guard creates its allowed scratch file as 0600', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'p3b-es-actual-guard-'))
  const listener = createServer((socket) => socket.end())
  const port = await new Promise<number>((resolve, reject) => {
    listener.once('error', reject)
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address()
      if (!address || typeof address === 'string') reject(new Error('listener did not bind'))
      else resolve(address.port)
    })
  })
  try {
    const manifest = buildSupplementGuardManifest({
      campaign_id: 'p3b-es1-correction', cell_id: 'correction-guard', receiver_port: port,
      cc_commit: 'a'.repeat(40), cc_tree: 'b'.repeat(40), sub_commit: 'c'.repeat(40), sub_tree: 'd'.repeat(40),
    })
    const guard = await runCellGuardSelfTest(manifest, root)
    assert.equal(guard.status, 'PASS')
    const scratchRoot = path.join(root, 'capsules/P3B-ES1/control/guard-scratch/correction-guard/tmp')
    const allowed = readdirSync(scratchRoot).filter((name) => name.startsWith('allowed-'))
    assert.equal(allowed.length, 1)
    assert.doesNotThrow(() => validateGuardScratchFile(path.join(scratchRoot, allowed[0])))
  } finally {
    await new Promise<void>((resolve) => listener.close(() => resolve()))
  }
})
