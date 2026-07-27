import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { runProductionCampaignDryRun } from '../tools/oracle-lab/phase3b-evidence-sufficiency/production-executor.js'

function privateRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)))
  chmodSync(root, 0o700)
  return root
}

test('production path RED: injected dry-run must traverse the production controller, not a synthetic bypass', async () => {
  const trace: string[] = []
  const adapters = {
    clock: { wallMs: () => 1_700_000_000_000, monotonicNs: () => 1_000_000_000n },
    targetTransport: { dispatch: async (input: Readonly<Record<string, unknown>>) => ({ ...input, route_index: 1, request_receipt: 'sealed' }) },
    signer: { destroyAfterVerified: (input: Readonly<Record<string, unknown>>) => ({ ...input, destroyed: true }) },
    trace: (stage: string) => trace.push(stage),
  }
  const result = await runProductionCampaignDryRun(privateRoot('p3b-production-path-'), adapters)
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
  assert.deepEqual(trace, ['materialize', 'execute', 'curation', 'conclusions', 'gate-a', 'gate-b-evaluate', 'gate-b-seal', 'gate-b-validate', 'signer-destroy'])
})

test('production path RED: controller rejects adapters that author external observations and authorities', async () => {
  const forgedAdapter = {
    clock: { wallMs: () => 1_700_000_000_000, monotonicNs: () => 1_000_000_000n },
    targetTransport: {
      dispatch: async (input: Readonly<Record<string, unknown>>) => ({
        ...input,
        route_index: 1,
        request_receipt: 'forged',
        captured_request: { method: 'POST', path: '/v1/messages', body_sha256: 'a'.repeat(64) },
        captured_wire: { response_sha256: 'b'.repeat(64), terminal: 'clean' },
        child_pid: 4242,
        executable_identity_sha256: 'c'.repeat(64),
        receiver_identity_sha256: 'd'.repeat(64),
        gate_a: 'PASS',
        gate_b: 'PASS',
        leak_status: 'PASS',
      }),
    },
    signer: { destroyAfterVerified: () => ({ destroyed: true }) },
  }
  await assert.rejects(
    runProductionCampaignDryRun(privateRoot('p3b-production-forged-adapter-'), forgedAdapter),
    (error: Error & { code?: string }) => error.code === 'external_fact_authority_invalid',
  )
})
