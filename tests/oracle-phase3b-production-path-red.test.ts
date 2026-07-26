import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { runSyntheticProductionDryRun } from '../tools/oracle-lab/phase3b-evidence-sufficiency/production-executor.js'

function privateRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)))
  chmodSync(root, 0o700)
  return root
}

test('production path: synthetic dry-run traverses materialization through signer destruction without reversible evidence', () => {
  const result = runSyntheticProductionDryRun(privateRoot('p3b-production-path-'))
  assert.equal(result.schema_id, 'oracle-lab-p3b-synthetic-dry-run.v1')
  assert.deepEqual(result.stages, ['materialized', 'normative_resolved', 'execution_receipts', 'curation', 'support', 'conclusions', 'gate_b_evaluated', 'gate_b_sealed', 'gate_b_revalidated', 'signer_destruction'])
  assert.equal(result.row_count, 340)
  assert.equal(result.normative_leaf_count, 152)
  const route = result.route_dispatch as Record<string, unknown>
  assert.deepEqual(route, { schedule_id: 'config-precedence-process-env-vs-local', request_route: 1, preflight_route: 1, actual_route: 1, selected_url: 'http://127.0.0.1:41001' })
  assert.deepEqual(result.persisted_leak_scan, { raw: false, base64: false, hex: false, url_encoded: false, secret_field_names: false })
  const conclusions = result.conclusions as Array<Record<string, unknown>>
  assert.equal(conclusions.length, 3)
  assert.ok(conclusions.every((conclusion) => conclusion.level === 'Reproduced' && conclusion.enabled === true))
  assert.deepEqual(result.gate_b, { decision: 'PASS', phase3b_usable: true, revalidated: true })
  assert.equal(result.signer_destruction, 'verified')
})
