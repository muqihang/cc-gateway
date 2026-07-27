import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { closeProductionDryRunAdapters, createProductionDryRunAdapters, runProductionCampaignDryRun } from '../tools/oracle-lab/phase3b-evidence-sufficiency/production-executor.js'

function privateRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)))
  chmodSync(root, 0o700)
  return root
}

test('production path RED: injected dry-run must traverse the production controller, not a synthetic bypass', async () => {
  const trace: string[] = []
  const root = privateRoot('p3b-production-path-')
  const adapters = await createProductionDryRunAdapters((stage) => trace.push(stage))
  let result: Readonly<Record<string, unknown>>
  try { result = await runProductionCampaignDryRun(root, adapters) } finally { await closeProductionDryRunAdapters(adapters) }
  assert.equal(result.schema_id, 'oracle-lab-p3b-synthetic-dry-run.v1')
  assert.deepEqual(result.stages, ['materialized', 'normative_resolved', 'execution_receipts', 'curation', 'support', 'conclusions', 'gate_b_evaluated', 'gate_b_sealed', 'gate_b_revalidated', 'signer_destruction'])
  assert.equal(result.row_count, 340)
  assert.equal(result.normative_leaf_count, 152)
  const route = result.route_dispatch as Record<string, unknown>
  assert.equal(route.schedule_id, 'config-precedence-process-env-vs-local')
  assert.equal(route.request_route, 1)
  assert.equal(route.preflight_route, 1)
  assert.equal(route.actual_route, 1)
  assert.match(String(route.selected_url), /^http:\/\/127\.0\.0\.1:\d+$/)
  assert.deepEqual(result.persisted_leak_scan, { raw: false, base64: false, hex: false, url_encoded: false, secret_field_names: false })
  const conclusions = result.conclusions as Array<Record<string, unknown>>
  assert.equal(conclusions.length, 3)
  assert.ok(conclusions.every((conclusion) => conclusion.level === 'Reproduced' && conclusion.enabled === true))
  assert.deepEqual(result.gate_b, { decision: 'PASS', phase3b_usable: true, revalidated: true })
  assert.equal(result.signer_destruction, 'verified')
  assert.deepEqual(trace, ['materialize', 'execute', 'curation', 'conclusions', 'gate-a', 'gate-b-evaluate', 'gate-b-seal', 'gate-b-validate', 'signer-destroy'])
  assert.equal(readdirSync(path.join(root, 'execution-records')).filter((name) => name.endsWith('.json')).length, 1020)
  assert.equal(readdirSync(path.join(root, 'production', 'captures')).filter((name) => name.endsWith('.json')).length, 340)
  const provenance = JSON.parse(readFileSync(path.join(root, 'capsules/P3B-ES1/curation/support/field-provenance.json'), 'utf8')) as Record<string, unknown>
  assert.equal((provenance.normative_resolved as unknown[]).length, 152)
  for (const relative of ['production/gate-a.json', 'production/operator-authority.json', 'production/gate-b-input.json', 'production/gate-b-result.json']) {
    const text = readFileSync(path.join(root, relative), 'utf8')
    assert.doesNotMatch(text, /(?:"(?:[^"\n]*(?:_base64|_hex|url_encoded|raw_prompt|raw_body|raw_bytes|password|authorization|secret))"\s*:|\bsk-[A-Za-z0-9_-]{8,}|-----BEGIN (?:OPENSSH|PRIVATE) KEY-----)/i)
  }
})

test('production path RED: controller rejects adapters that author external observations and authorities', async () => {
  const forgeries = [
    { targetTransport: { dispatch: async () => ({ captured_request: 'forged', captured_wire: 'forged' }) } },
    { runtime: { child_pid: 4242, executable_identity_sha256: 'c'.repeat(64) } },
    { receiver: { peer: '127.0.0.1', receiver_identity_sha256: 'd'.repeat(64) } },
    { gateA: { decision: 'PASS' }, gateB: { decision: 'PASS', phase3b_usable: true } },
    { leakScan: { status: 'PASS', findings: [] } },
  ]
  for (const forgedAdapter of forgeries) {
    await assert.rejects(
      runProductionCampaignDryRun(privateRoot('p3b-production-forged-adapter-'), forgedAdapter),
      (error: Error & { code?: string }) => error.code === 'external_fact_authority_invalid',
    )
  }
})
