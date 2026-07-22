import assert from 'node:assert/strict'

import { TIER_A_LANES, evaluateClaudeCodeR3Closure, evaluateR3Closure, parseR3ClosureArgs, type TierALaneInput } from '../tools/oracle-lab/phase3a/r3-closure.js'
import { buildTierACellSummary, tierAInterfaceDigest } from '../tools/oracle-lab/phase3a/tier-a-dynamic-campaign.js'

console.log('\ntests/oracle-phase3a-r3-closure.test.ts')

const digest = (seed: string): string => {
  let value = Buffer.from(seed).toString('hex')
  while (value.length < 64) value += value
  return value.slice(0, 64)
}

const activeEntrypoint = digest('active-entrypoint')
const activeTree = digest('active-tree')

const lanes: TierALaneInput[] = TIER_A_LANES.map((expected, index) => ({
  version: expected.version,
  role: 'tier-a',
  hypothesis_id: expected.hypothesis_id,
  reason: expected.reason,
  intake: {
    package: '@anthropic-ai/claude-code-darwin-arm64',
    version: expected.version,
    source_url: `https://registry.npmjs.org/@anthropic-ai/claude-code-darwin-arm64/-/claude-code-darwin-arm64-${expected.version}.tgz`,
    archive_sha256: digest(`archive-${index}`),
    tree_sha256: digest(`tree-${index}`),
    entrypoint_sha256: digest(`entry-${index}`),
    artifact_path: `intake/platform/${expected.version}/artifact.json`,
  },
  structural: {
    status: 'PASS',
    method: 'platform-entrypoint-tree-digest-delta',
    semantic_change: true,
    active_entrypoint_sha256: activeEntrypoint,
    control_entrypoint_sha256: digest(`entry-${index}`),
    active_tree_sha256: activeTree,
    control_tree_sha256: digest(`tree-${index}`),
    digest: digest(`structural-${index}`),
  },
  dynamic: {
    status: 'CLOSED_WITH_UNKNOWN',
    pair_count: 0,
    required_pairs: [...expected.required_pairs],
    next_minimal_action: `run ${expected.version} pairs`,
  },
}))

const result = evaluateClaudeCodeR3Closure({
  active_version: '2.1.215',
  active_entrypoint_sha256: activeEntrypoint,
  active_tree_sha256: activeTree,
  lanes,
})
assert.equal(result.status, 'CLOSED_WITH_UNKNOWN')
assert.equal(result.target, 'claude-code-tier-a-change-points')
assert.equal(result.tier_a.lane_count, 5)
assert.equal(result.tier_a.lanes.length, 5)
assert.ok(result.tier_a.lanes.every((lane: any) => lane.role === 'tier-a'))
assert.ok(result.tier_a.lanes.every((lane: any) => lane.version !== '2.1.215'))
assert.equal(result.tier_b.status, 'SKIPPED_BY_RULE')
assert.throws(() => evaluateR3Closure({
  commit: 'a'.repeat(40), tree: 'b'.repeat(40), base_commit: 'c'.repeat(40), worktree_clean: true,
  changed_files: ['tools/oracle_phase3a_adapter.py', 'tools/tests/test_oracle_phase3a_adapter.py'],
  target_tests: 10, boundary_tests: 48,
}), /not Claude Code Tier A/)
assert.throws(() => evaluateClaudeCodeR3Closure({
  active_version: '2.1.215',
  active_entrypoint_sha256: activeEntrypoint,
  lanes: lanes.slice(0, 4),
}), /exactly 5/)
assert.throws(() => evaluateClaudeCodeR3Closure({
  active_version: '2.1.215',
  active_entrypoint_sha256: activeEntrypoint,
  lanes: lanes.map((lane) => ({ ...lane, dynamic: { ...lane.dynamic, status: 'REPRODUCED' as const } })),
}), /dynamic pair count/)
const resolved = evaluateClaudeCodeR3Closure({
  active_version: '2.1.215',
  active_entrypoint_sha256: activeEntrypoint,
  lanes: lanes.map((lane) => ({ ...lane, dynamic: { ...lane.dynamic, status: 'REPRODUCED' as const, pair_count: lane.dynamic.required_pairs.length } })),
})
assert.equal(resolved.status, 'PASS')
assert.ok(resolved.tier_a.lanes.every((lane: any) => lane.dynamic.next_minimal_action === null))
const cellSummary = buildTierACellSummary({
  run_id: 'tier-a-fixture', arm: 'control', version: '2.1.214', status: 'complete',
  hook_event_count: 1, observer_event_count: 1, process_samples: 1,
  manifest_sha256: digest('manifest'), guard_sha256: digest('guard'), observer_sha256: digest('observer'), result_sha256: digest('result'),
})
for (const name of ['manifest', 'guard', 'observer', 'result']) assert.match(String(cellSummary[`${name}_sha256`]), /^[a-f0-9]{64}$/)
const dynamicSystemEvent = (valueDigest: string) => ({
  method: 'POST', path_class: '/v1/messages', header_names: ['content-type'], header_value_classes: { 'content-type': 'json' },
  body_topology: { type: 'object', fields: [{ key_sha256: digest('body-key'), value: { type: 'string', bytes: 12, sha256: valueDigest } }] },
  response_class: 'anthropic:sse', request_class: 'messages', cch_class: 'body-cache-control',
  system_summary: { status: 'observed', byte_length: 40, sha256: valueDigest, ast_topology: { type: 'array', length: 1, items: [{ type: 'string', bytes: 40, sha256: valueDigest }] }, span_hashes: [{ path_sha256: digest('span'), ordinal: 0, byte_length: 40, sha256: valueDigest }] },
})
assert.equal(tierAInterfaceDigest([dynamicSystemEvent(digest('run-a'))]), tierAInterfaceDigest([dynamicSystemEvent(digest('run-b'))]))
assert.notEqual(tierAInterfaceDigest([dynamicSystemEvent(digest('run-a'))]), tierAInterfaceDigest([{ ...dynamicSystemEvent(digest('run-b')), system_summary: { ...dynamicSystemEvent(digest('run-b')).system_summary, byte_length: 41 } }]))
assert.throws(() => parseR3ClosureArgs(['--dynamic-roots', 'legacy']), /unknown argument/)
assert.throws(() => parseR3ClosureArgs(['--out', 'a', '--out', 'b']), /duplicate argument/)

console.log(JSON.stringify({ ok: true, cases: 14 }))
