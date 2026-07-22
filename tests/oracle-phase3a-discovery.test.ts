import assert from 'node:assert/strict'

import { canonicalJson, sha256Bytes } from '../tools/oracle-lab/phase3a/core.js'
import { buildDiscoveryInventory, DISCOVERY_CATEGORIES } from '../tools/oracle-lab/phase3a/discovery-inventory.js'

console.log('\ntests/oracle-phase3a-discovery.test.ts')

const source = Buffer.from(`
const RAW_VENDOR_DISCOVERY_SENTINEL = "must-not-persist";
const modules = {
  config: () => {
    const endpoint = process.env.ANTHROPIC_BASE_URL;
    const token = process.env.ANTHROPIC_API_KEY;
    if (endpoint) fetch(endpoint, { headers: { authorization: token } });
  },
  lifecycle: function () {
    setTimeout(() => child_process.spawn("helper"), Math.random());
    switch (state) { case "starting": state = "running"; break; }
    return JSON.stringify({ systemPrompt: "fixture", compact: true });
  },
};
`, 'utf8')
const digest = sha256Bytes(source)
const candidate = {
  sha256: digest,
  location: { artifact_sha256: digest, offset: 4096, length: source.length },
}

const first = buildDiscoveryInventory(source, candidate)
const second = buildDiscoveryInventory(source, candidate)
assert.equal(first.deterministic_digest, second.deterministic_digest)
assert.equal(first.binding.candidate_sha256, digest)
assert.equal(first.parse.syntax_diagnostics, 0)
assert.equal(first.module_slices.length, 2)
assert.ok(first.module_slices.every((entry) => entry.node_count > 0 && entry.node_count <= 50_000))
assert.ok(first.module_slices.every((entry) => entry.location.offset >= candidate.location.offset))
assert.deepEqual(first.inventory.map((entry) => entry.category), [...DISCOVERY_CATEGORIES])
assert.ok(first.inventory.find((entry) => entry.category === 'env-read')!.match_count >= 2)
assert.ok(first.inventory.find((entry) => entry.category === 'fetch-http')!.match_count >= 1)
assert.ok(first.inventory.find((entry) => entry.category === 'child-process')!.match_count >= 1)
assert.ok(first.inventory.find((entry) => entry.category === 'timer-random')!.match_count >= 2)
assert.ok(first.inventory.find((entry) => entry.category === 'cache-compact')!.match_count >= 1)
assert.ok(first.safe_env_keys.includes('ANTHROPIC_API_KEY'))
assert.ok(first.safe_env_keys.includes('ANTHROPIC_BASE_URL'))
assert.ok(first.env_reads.find((entry) => entry.key === 'ANTHROPIC_BASE_URL')!.locations.length > 0)
assert.ok(first.env_reads.every((entry) => entry.locations.every((location) => location.location.offset >= candidate.location.offset)))

const baseUrl = first.root_coverage.find((entry) => entry.root === 'base-url-proxy')!
assert.equal(baseUrl.status, 'observed')
assert.ok(baseUrl.xref_count > 0)
assert.ok(baseUrl.call_paths.length > 0)
assert.ok(baseUrl.cfg_neighborhoods.length > 0)
assert.equal(baseUrl.next_minimal_action, null)
const model = first.root_coverage.find((entry) => entry.root === 'model-capability')!
assert.equal(model.status, 'unknown')
assert.ok(model.searched_surfaces.includes('bundle-table-module-slices'))
assert.match(model.next_minimal_action!, /dynamic|module/i)

const serialized = canonicalJson(first)
assert.ok(!serialized.includes('RAW_VENDOR_DISCOVERY_SENTINEL'))
assert.ok(!serialized.includes('must-not-persist'))
assert.ok(!serialized.includes('"helper"'))
assert.match(first.deterministic_digest, /^[a-f0-9]{64}$/)

assert.throws(
  () => buildDiscoveryInventory(source, { ...candidate, sha256: '0'.repeat(64) }),
  /candidate digest/i,
)
assert.throws(
  () => buildDiscoveryInventory(Buffer.from('function broken( {'), {
    sha256: sha256Bytes('function broken( {'),
    location: { artifact_sha256: digest, offset: 0, length: 18 },
  }),
  /syntax/i,
)

console.log(JSON.stringify({ ok: true, cases: 29 }))
