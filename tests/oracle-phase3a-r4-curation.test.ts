import assert from 'node:assert/strict'

import { closureConclusions, crossPlatformTerminalUnknown, evidenceRelativePath, parseR4CurationArgs, r2EnvironmentCoverage, r2TerminalUnknown, r2TerminalUnknownReason, tierATerminalUnknowns, tlsTerminalUnknown } from '../tools/oracle-lab/phase3a/r4-curation.js'
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

const r2Fixture = {
  inputs: {
    base_closure: { inputs: { environment: { status: 'PASS', statuses: { REPRODUCED: 60 } }, gap: { status: 'CLOSED_WITH_UNKNOWN', external_socket_budget: 0, raw_material_persisted: false, cases: [{ family: 'compact-and-prompt-cache-lifecycle', status: 'complete' }] } } },
    resume_repair: { status: 'FOCUSED_REPAIR', external_socket_budget: 0, raw_material_persisted: false, cases: [{ case_id: 'restart-resume-init', status: 'complete' }, { case_id: 'restart-resume-resume', status: 'complete' }] },
    update_repair: { status: 'FOCUSED_REPAIR', external_socket_budget: 0, raw_material_persisted: false, cases: [{ case_id: 'telemetry-update', status: 'failed', update_fixture_outcome: 'no-platform' }] },
  },
}
assert.deepEqual(r2EnvironmentCoverage(r2Fixture), { reproduced: 60, unknown: 0, complete: true })
assert.equal(r2TerminalUnknown({ hypothesis: 'compact-and-prompt-cache-lifecycle', source: 'gap', failure_classification: 'compact-or-cache-transition-not-observed', reason: 'x', next_minimal_action: 'y', searched_surfaces: ['z'] }, r2Fixture).capability_exhausted, true)
assert.equal(r2TerminalUnknown({ ...r2V8UpdateUnknown, searched_surfaces: ['z'] }, r2Fixture).capability_evidence, 'r2-update-repair-v5-loopback-no-platform-boundary')
assert.throws(() => r2TerminalUnknown({ ...r2V8UpdateUnknown, reason: r2V8UpdateReason, failure_classification: 'other', searched_surfaces: ['z'] }, r2Fixture), (error: any) => error.code === 'r4_terminal_unknown_unproven')

const tierTerminal = tierATerminalUnknowns([{ version: '2.1.214', status: 'CLOSED_WITH_UNKNOWN', dynamic: { next_minimal_action: 'next', admission: { convergence: { pairs: [{ required_pair: 'restart', run_coverage: 'BLOCKED' }] } } } }], {
  pair_outcomes: [{ version: '2.1.214', required_pair: 'restart', classification: 'TERMINAL_UNKNOWN', phase3b_usable: false, searched_surfaces: ['safe'], capability_evidence: { external_socket_budget: 0, raw_material_persisted: false, complete_result_count: 0, terminal_result_count: 10, result_count: 10, process_sampled_result_count: 10, safe_diagnostic_result_count: 10 } }],
})
assert.equal(tierTerminal.closed.length, 1)
assert.throws(() => tierATerminalUnknowns([{ version: '2.1.214', status: 'CLOSED_WITH_UNKNOWN', dynamic: { admission: { convergence: { pairs: [{ required_pair: 'restart', run_coverage: 'BLOCKED' }] } } } }], { pair_outcomes: [] }), (error: any) => error.code === 'r4_terminal_unknown_unproven')
assert.throws(() => tierATerminalUnknowns([{ version: '2.1.214', status: 'CLOSED_WITH_UNKNOWN', dynamic: { admission: { convergence: { pairs: [{ required_pair: 'restart', run_coverage: 'BLOCKED' }] } } } }], { pair_outcomes: [{ version: '2.1.214', required_pair: 'restart', classification: 'TERMINAL_UNKNOWN', phase3b_usable: false, searched_surfaces: ['safe'], capability_evidence: { external_socket_budget: 0, raw_material_persisted: false, complete_result_count: 0, terminal_result_count: 10, result_count: 10, process_sampled_result_count: 0, safe_diagnostic_result_count: 10 } }] }), (error: any) => error.code === 'r4_terminal_unknown_unproven')

const tlsFixture = { schema_version: 'oracle-lab-phase3a-local-tls-connect-summary.v1', status: 'OBSERVED', active_artifact: { entrypoint_sha256: '90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58', observed_entrypoint_sha256: '90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58' }, capability: { external_socket_budget: 0, raw_material_persisted: false, local_tls_connect: 'observed', local_https_http: 'observed' }, surfaces: { tls_events: [{ decision: 'accepted-local-tls', protocol: 'TLSv1.3' }], http_events: [{ response_status: 200 }] } }
assert.equal(tlsTerminalUnknown(tlsFixture).capability_exhausted, true)
assert.throws(() => tlsTerminalUnknown({ ...tlsFixture, surfaces: { ...tlsFixture.surfaces, tls_events: [] } }), (error: any) => error.code === 'r4_tls_evidence_invalid')

const crossFixture = { schema_version: 'oracle-lab-phase3a-cross-platform-static-corroboration.v1', scope: 'official-claude-code-2.1.215-static-only', artifact_count: 3, artifacts: [{ platform: 'darwin-arm64' }, { platform: 'linux-x64' }, { platform: 'win32-x64' }], structural_corroboration: { status: 'corroborated' }, capability_conclusion: { result: 'static-corroborated', runtime_capability: 'Unknown', phase3b_usable: false }, source_sink_corroboration: [{ status: 'corroborated', missing_on: [] }] }
assert.equal(crossPlatformTerminalUnknown(crossFixture).capability_exhausted, true)
assert.throws(() => crossPlatformTerminalUnknown({ ...crossFixture, artifact_count: 2 }), (error: any) => error.code === 'r4_cross_platform_evidence_invalid')

console.log(JSON.stringify({ ok: true, cases: 27 }))
