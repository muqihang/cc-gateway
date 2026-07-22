import assert from 'node:assert/strict'

import { buildR4TerminalManifest } from '../tools/oracle-lab/phase3a/r4-terminal.js'
import { canonicalJson, sha256Bytes } from '../tools/oracle-lab/phase3a/core.js'

console.log('\ntests/oracle-phase3a-r4-terminal.test.ts')

const sha = 'a'.repeat(64)
const projectionVersions = ['2.1.214', '2.1.212', '2.1.211', '2.1.208', '2.1.207']
const terminalTargets = [['2.1.214', 'long-run'], ['2.1.214', 'restart'], ['2.1.212', 'restart'], ['2.1.211', 'base-url-background-restart']] as const
const indexed = (artifact_id: string, sha256: string, relative_path: string) => ({ artifact_id, sha256, relative_path })
const rerunBase = {
  schema_version: 'oracle-lab-phase3a-tier-a-rerun-terminal-unknown.v1', classification: 'TERMINAL_UNKNOWN', phase3b_usable: false, external_socket_budget: 0, raw_material_persisted: false,
  rerun_mappings: terminalTargets.map(([version, required_pair], index) => ({ target: { version, required_pair }, rerun_root: `capsules/P3A-3/rerun-${index}`, campaign_id: `campaign-${index}` })),
  pair_outcomes: terminalTargets.map(([version, required_pair]) => ({
    version, required_pair, classification: 'TERMINAL_UNKNOWN', phase3b_usable: false, command_digest: '7'.repeat(64),
    source_bindings: { lane_summary: { path: 'capsules/P3A-3/lane.json', sha256: '8'.repeat(64) }, pair_summary: { path: 'capsules/P3A-3/pair.json', sha256: '9'.repeat(64) }, result_set_digest: 'a'.repeat(64) },
    capability_evidence: { external_socket_budget: 0, raw_material_persisted: false, complete_result_count: 0, result_count: 10, terminal_result_count: 10, process_sampled_result_count: 10, safe_diagnostic_result_count: 10 },
  })),
}
const tier_a_rerun = { ...rerunBase, deterministic_digest: sha256Bytes(canonicalJson(rerunBase)) }
const input = {
  index_sha256: sha, leak_scan_sha256: 'b'.repeat(64), exit_sha256: 'c'.repeat(64), handoff_sha256: 'd'.repeat(64), identity_graph_sha256: 'e'.repeat(64),
  r2_sha256: 'f'.repeat(64), r3_sha256: '1'.repeat(64), tier_a_rerun_sha256: '6'.repeat(64), cc_commit: '2'.repeat(40), cc_tree: '3'.repeat(40), sub2api_commit: '4'.repeat(40), sub2api_tree: '5'.repeat(40),
  index: {
    artifacts: [
      indexed('p3a2-closure-coverage-v8', 'f'.repeat(64), 'capsules/P3A-2/closure-r2-coverage-v8.json'),
      indexed('p3a3-closure-tier-a-v11', '1'.repeat(64), 'capsules/P3A-3/closure-r3-tier-a-v11.json'),
      indexed('p3a3-tier-a-rerun-terminal-unknown-v1', '6'.repeat(64), 'capsules/P3A-3/tier-a-rerun-terminal-unknown-v1.json'),
       ...projectionVersions.map((version, index) => indexed(`p3a3-tier-a-projection-v5-${version}`, `${index}`.repeat(64), `capsules/P3A-3/tier-a-dynamic-projections-v5/tier-a-dynamic-projection-v5-${version}.json`)),
       ...projectionVersions.map((version, index) => indexed(`p3a3-tier-a-binding-v3-${version}-fixture`, `${index + 5}`.repeat(64), `capsules/P3A-3/tier-a-cell-bindings-v3/${version}/fixture.json`)),
       ...terminalTargets.map((_, index) => indexed(`p3a3-tier-a-rerun-source-${index}`, `${index + 1}`.repeat(64), `capsules/P3A-3/rerun-${index}/result.json`)),
    ],
  },
  exit: { artifact_index_sha256: sha, status: 'GREEN' }, handoff: { artifact_index_sha256: sha, exit_report_sha256: 'c'.repeat(64), status: 'READY' }, leak: { index_sha256: sha, status: 'PASS', findings: [] },
  tier_a_rerun,
}
const result = buildR4TerminalManifest(input)
assert.equal(result.status, 'GREEN')
assert.equal(result.bindings.exit_sha256, 'c'.repeat(64))
assert.match(result.bindings.tier_a_support_sha256, /^[a-f0-9]{64}$/)
assert.throws(() => buildR4TerminalManifest({ ...input, exit: { artifact_index_sha256: '0'.repeat(64) } } as any), /pre-exit index/)
assert.throws(() => buildR4TerminalManifest({ ...input, handoff: { ...input.handoff, status: 'BLOCKED' } } as any), /statuses are inconsistent/)
assert.throws(() => buildR4TerminalManifest({ ...input, index: { artifacts: input.index.artifacts.filter((row: any) => row.artifact_id !== 'p3a3-tier-a-rerun-terminal-unknown-v1') } } as any), /terminal rerun artifact/)
assert.throws(() => buildR4TerminalManifest({ ...input, tier_a_rerun: { ...tier_a_rerun, pair_outcomes: [] } } as any), /terminal rerun/)
assert.throws(() => buildR4TerminalManifest({ ...input, tier_a_rerun: { ...tier_a_rerun, pair_outcomes: tier_a_rerun.pair_outcomes.map((outcome: any, index) => index === 0 ? { ...outcome, capability_evidence: { ...outcome.capability_evidence, process_sampled_result_count: 0 } } : outcome) } } as any), /terminal rerun/)

console.log(JSON.stringify({ ok: true, cases: 8 }))
