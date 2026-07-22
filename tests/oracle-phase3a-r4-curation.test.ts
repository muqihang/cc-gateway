import assert from 'node:assert/strict'

import { closureConclusions, evidenceRelativePath, parseR4CurationArgs, r2TerminalUnknownReason } from '../tools/oracle-lab/phase3a/r4-curation.js'
import { canonicalJson } from '../tools/oracle-lab/phase3a/core.js'

console.log('\ntests/oracle-phase3a-r4-curation.test.ts')

const rows = closureConclusions()
assert.equal(rows.length, 7)
assert.equal(rows.filter((row: any) => row.conclusion.level === 'Reproduced').length, 2)
assert.equal(rows.filter((row: any) => row.conclusion.level === 'Unknown').length, 5)
assert.ok(rows.filter((row: any) => row.conclusion.level === 'Reproduced').every((row: any) => row.conclusion.phase3b_usable && row.conclusion.dynamic_reproduction.source_count === 2))
assert.ok(rows.find((row: any) => row.conclusion.conclusion_id === 'CL-P3A-R2-FAILURE-STREAM')?.conclusion.supporting_artifact_ids.includes('p3a2-closure-coverage-v8'))
assert.equal(rows.some((row: any) => row.conclusion.conclusion_id === 'CL-P3A-ROUTING-ENVIRONMENT-UNKNOWN'), false)
assert.ok(rows.find((row: any) => row.conclusion.conclusion_id === 'CL-P3A-COMPACT-CACHE-UNKNOWN')?.conclusion.supporting_artifact_ids.includes('p3a2-gap-campaign-v2'))
assert.equal(closureConclusions({ environment_complete: false }).some((row: any) => row.conclusion.conclusion_id === 'CL-P3A-ROUTING-ENVIRONMENT-UNKNOWN'), true)
assert.equal(closureConclusions({ tier_a_complete: false }).some((row: any) => row.conclusion.conclusion_id === 'CL-P3A-TIER-A-DYNAMIC-UNKNOWN'), true)
assert.deepEqual(closureConclusions({ tier_a_complete: false }).find((row: any) => row.conclusion.conclusion_id === 'CL-P3A-TIER-A-DYNAMIC-UNKNOWN')?.conclusion.supporting_artifact_ids, ['p3a3-closure-tier-a-v11', 'p3a3-tier-a-rerun-terminal-unknown-v1'])
assert.deepEqual(parseR4CurationArgs(['--tier-a-terminal-rerun', 'rerun-v1']), { 'tier-a-terminal-rerun': 'rerun-v1' })
assert.throws(() => parseR4CurationArgs(['--r2', '--r3']), /arguments must/)
assert.throws(() => parseR4CurationArgs(['--r2', 'a', '--r2', 'b']), /duplicate argument/)
assert.equal(evidenceRelativePath('/evidence/root', '/evidence/root/capsules/P3A-4/phase-3a-exit-report-v2.json'), 'capsules/P3A-4/phase-3a-exit-report-v2.json')
assert.throws(() => evidenceRelativePath('/evidence/root', '/tmp/unrelated/capsules/P3A-4/exit.json'), /evidence root/)

const r2V8UpdateUnknown = {
  hypothesis: 'telemetry-diagnostic-update-error-traffic',
  source: 'gap-update-repair-v5',
  failure_classification: 'update-no-platform-safe-boundary',
  next_minimal_action: 'Preserve this terminal Unknown unless an operator authorizes a separately isolated update-application fixture.',
}
const r2V8UpdateReason = r2TerminalUnknownReason(r2V8UpdateUnknown)
assert.equal(r2V8UpdateReason, 'The bounded update command reached the loopback no-platform boundary before download or replacement.')
assert.doesNotThrow(() => canonicalJson({ ...r2V8UpdateUnknown, reason: r2V8UpdateReason }))
assert.throws(() => r2TerminalUnknownReason({ hypothesis: 'other', source: 'other' }), (error: any) => error.code === 'r4_input_invalid')

console.log(JSON.stringify({ ok: true, cases: 18 }))
