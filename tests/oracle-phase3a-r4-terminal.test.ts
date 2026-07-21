import assert from 'node:assert/strict'

import { buildR4TerminalManifest } from '../tools/oracle-lab/phase3a/r4-terminal.js'

console.log('\ntests/oracle-phase3a-r4-terminal.test.ts')

const sha = 'a'.repeat(64)
const input = {
  index_sha256: sha, leak_scan_sha256: 'b'.repeat(64), exit_sha256: 'c'.repeat(64), handoff_sha256: 'd'.repeat(64), identity_graph_sha256: 'e'.repeat(64),
  r2_sha256: 'f'.repeat(64), r3_sha256: '1'.repeat(64), cc_commit: '2'.repeat(40), cc_tree: '3'.repeat(40), sub2api_commit: '4'.repeat(40), sub2api_tree: '5'.repeat(40),
  exit: { artifact_index_sha256: sha }, handoff: { artifact_index_sha256: sha, exit_report_sha256: 'c'.repeat(64) }, leak: { index_sha256: sha, status: 'PASS', findings: [] },
}
const result = buildR4TerminalManifest(input)
assert.equal(result.status, 'BLOCKED_WITH_VALIDATED_SUBSET')
assert.equal(result.bindings.exit_sha256, 'c'.repeat(64))
assert.throws(() => buildR4TerminalManifest({ ...input, exit: { artifact_index_sha256: '0'.repeat(64) } } as any), /pre-exit index/)

console.log(JSON.stringify({ ok: true, cases: 3 }))
