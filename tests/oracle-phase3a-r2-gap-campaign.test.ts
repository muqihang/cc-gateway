import assert from 'node:assert/strict'

import { parseR2GapArgs, R2_GAP_CASES, selectedR2GapCases } from '../tools/oracle-lab/phase3a/r2-gap-campaign.js'

console.log('\ntests/oracle-phase3a-r2-gap-campaign.test.ts')

assert.equal(R2_GAP_CASES.length, 5)
assert.deepEqual([...new Set(R2_GAP_CASES.map((entry) => entry.family))].sort(), [
  'compact-and-prompt-cache-lifecycle',
  'restart-resume-and-child-process-lineage',
  'telemetry-diagnostic-update-error-traffic',
])
assert.deepEqual(R2_GAP_CASES.filter((entry) => entry.session_state === 'shared-resume-state').map((entry) => entry.id), ['restart-resume-init', 'restart-resume-resume'])
assert.ok(R2_GAP_CASES.some((entry) => entry.command_label === 'doctor'))
assert.ok(R2_GAP_CASES.some((entry) => entry.command_label === 'update'))
assert.deepEqual(selectedR2GapCases(['telemetry-update', 'restart-resume-init', 'restart-resume-resume']).map((entry) => entry.id), ['telemetry-update', 'restart-resume-init', 'restart-resume-resume'])
assert.deepEqual(parseR2GapArgs(['--case-ids', 'telemetry-update,restart-resume-init'])['case-ids'], 'telemetry-update,restart-resume-init')
assert.throws(() => parseR2GapArgs(['--campaign', 'x']), /unknown argument/)
assert.throws(() => parseR2GapArgs(['--campaign-id', 'a', '--campaign-id', 'b']), /duplicate argument/)

console.log(JSON.stringify({ ok: true, cases: 9 }))
