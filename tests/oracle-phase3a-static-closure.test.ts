import assert from 'node:assert/strict'

import { canonicalJson, sha256Bytes } from '../tools/oracle-lab/phase3a/core.js'
import { buildDiscoveryInventory } from '../tools/oracle-lab/phase3a/discovery-inventory.js'
import { buildStaticClosureSummary } from '../tools/oracle-lab/phase3a/static-closure.js'

console.log('\ntests/oracle-phase3a-static-closure.test.ts')

const source = Buffer.from(`
const table = {
  a: () => process.env.ANTHROPIC_BASE_URL || fetch("https://example.test/v1/messages"),
  b: () => JSON.stringify({systemPrompt, model, authorization, compact}),
};
`, 'utf8')
const digest = sha256Bytes(source)
const inventory = buildDiscoveryInventory(source, { sha256: digest, location: { artifact_sha256: digest, offset: 100, length: source.length } })
const summary = buildStaticClosureSummary(inventory, 'f'.repeat(64))
assert.equal(summary.status, 'complete')
assert.equal(summary.discovery_artifact_sha256, 'f'.repeat(64))
assert.equal(summary.required_roots.length, 15)
assert.ok(summary.required_roots.every((entry) => ['static-path-recovered', 'unknown'].includes(entry.disposition)))
assert.ok(summary.required_roots.every((entry) => entry.disposition !== 'unknown' || entry.next_minimal_action !== null))
assert.equal(summary.module_slices.budget_exceeded, 0)
assert.equal(summary.source_sink_categories.length, 17)
assert.equal(summary.safe_env_key_count, 1)
assert.ok(!JSON.stringify(summary).includes('ANTHROPIC_BASE_URL'))
assert.match(summary.deterministic_digest, /^[a-f0-9]{64}$/)

const tampered = structuredClone(inventory)
tampered.parse.module_slice_count += 1
tampered.deterministic_digest = sha256Bytes(canonicalJson(Object.fromEntries(Object.entries(tampered).filter(([key]) => key !== 'deterministic_digest'))))
assert.throws(() => buildStaticClosureSummary(tampered, 'f'.repeat(64)), /module slice count/i)
const missingRoot = structuredClone(inventory)
missingRoot.root_coverage.pop()
missingRoot.deterministic_digest = sha256Bytes(canonicalJson(Object.fromEntries(Object.entries(missingRoot).filter(([key]) => key !== 'deterministic_digest'))))
assert.throws(() => buildStaticClosureSummary(missingRoot, 'f'.repeat(64)), /required static roots/i)
const stale = structuredClone(inventory)
stale.deterministic_digest = '0'.repeat(64)
assert.throws(() => buildStaticClosureSummary(stale, 'f'.repeat(64)), /deterministic digest/i)

console.log(JSON.stringify({ ok: true, cases: 12 }))
