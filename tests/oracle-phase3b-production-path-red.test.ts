import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as campaignController from '../tools/oracle-lab/phase3b-evidence-sufficiency/campaign-controller.js'

function privateRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)))
  chmodSync(root, 0o700)
  return root
}

const MODULE_ROOT = realpathSync(path.join(import.meta.dirname, '../tools/oracle-lab/phase3b-evidence-sufficiency'))
const ENTRY_SOURCE = path.join(MODULE_ROOT, 'campaign-controller.ts')
const BANNED_SECURITY_PATHS = new Set(['production-executor.ts', 'production-dry-run-adapters.ts'])

function reachableTypescriptFiles(entry: string): Set<string> {
  const seen = new Set<string>()
  const visit = (file: string): void => {
    const normalized = realpathSync(file)
    if (seen.has(normalized)) return
    seen.add(normalized)
    const source = readFileSync(normalized, 'utf8')
    for (const match of source.matchAll(/(?:from\s+|import\s*)['\"](\.\.?\/[^'\"]+)['\"]/g)) {
      const candidate = path.resolve(path.dirname(normalized), match[1].replace(/\.js$/, '.ts'))
      if (candidate.startsWith(`${MODULE_ROOT}${path.sep}`)) visit(candidate)
    }
  }
  visit(entry)
  return seen
}

test('production path RED: only the real campaign-controller entry is reachable', () => {
  const thisTest = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const productionImports = [...thisTest.matchAll(/from ['\"]\.\.\/tools\/oracle-lab\/phase3b-evidence-sufficiency\/([^'\"]+)['\"]/g)].map((match) => match[1])
  assert.deepEqual(productionImports, ['campaign-controller.js'])
  const reachable = [...reachableTypescriptFiles(ENTRY_SOURCE)].map((file) => path.basename(file))
  assert.deepEqual(reachable.filter((name) => BANNED_SECURITY_PATHS.has(name)), [])
})

test('production path RED: the real controller owns the complete sealed lifecycle', async () => {
  const root = privateRoot('p3b-real-controller-red-')
  const fixtureRoot = privateRoot('p3b-real-controller-authority-red-')
  const authorityManifestPath = path.join(fixtureRoot, 'phase3b-test-authority-manifest.json')
  writeFileSync(authorityManifestPath, '{"schema_id":"oracle-lab-p3b-test-authority-manifest.v1"}\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 })

  const entry = (campaignController as Record<string, unknown>).runCampaignController
  assert.equal(typeof entry, 'function', 'campaign-controller must expose the one complete production entry')
  const result = await (entry as (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>)({
    mode: 'test-owned-offline-full-path',
    authority_manifest_path: authorityManifestPath,
    evidence_root: root,
  })
  assert.equal(result.schema_id, 'oracle-lab-p3b-campaign-controller-result.v1')
  assert.equal(result.row_count, 340)
  assert.equal(result.receipt_count, 1020)
  assert.equal(result.normative_leaf_count, 152)
  assert.equal(result.pre_gate_leak_status, 'PASS')
  assert.equal(result.post_gate_leak_status, 'PASS')
  assert.equal(result.gate_b_validated, true)
  assert.equal(result.signer_destroyed, true)
})

test('production path RED: public entry accepts sealed paths, never authored verdict fields', async () => {
  const entry = (campaignController as Record<string, unknown>).runCampaignController
  assert.equal(typeof entry, 'function')
  for (const forged of [
    { gate_a: { decision: 'PASS' } },
    { gate_b: { decision: 'PASS' } },
    { leak_status: 'PASS' },
    { child_pid: process.pid },
    { peer: '127.0.0.1' },
    { es9_values: [] },
    { signer_destroyed: true },
  ]) {
    await assert.rejects(
      (entry as (input: Readonly<Record<string, unknown>>) => Promise<unknown>)({
        mode: 'test-owned-offline-full-path',
        authority_manifest_path: path.join(privateRoot('p3b-forged-real-entry-'), 'sealed-manifest.json'),
        evidence_root: privateRoot('p3b-forged-real-root-'),
        ...forged,
      }),
      (error: Error & { code?: string }) => error.code === 'campaign_controller_input_invalid',
    )
  }
})
