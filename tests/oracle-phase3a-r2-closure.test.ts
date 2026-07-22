import assert from 'node:assert/strict'

import { canonicalJson, sha256Bytes } from '../tools/oracle-lab/phase3a/core.js'
import { buildR2CoverageClosure, buildR2RepairCoverageClosure, parseR2ClosureArgs, SAFE_NO_DOWNLOAD_BOUNDARY_CONCLUSION } from '../tools/oracle-lab/phase3a/r2-closure.js'

console.log('\ntests/oracle-phase3a-r2-closure.test.ts')

const digest = 'a'.repeat(64)
const gapBase = {
  status: 'CLOSED_WITH_UNKNOWN', executed_cells: 5, external_socket_budget: 0, raw_material_persisted: false,
  cases: [
    'compact-cache-long-context', 'telemetry-diagnostic-doctor', 'telemetry-update', 'restart-resume-init', 'restart-resume-resume',
  ].map((case_id) => ({ case_id, status: 'complete', manifest_sha256: digest, guard_sha256: digest, observer_sha256: digest, result_sha256: digest })),
  families: [
    { hypothesis: 'compact-and-prompt-cache-lifecycle', evidence_level: 'Unknown', commands: ['long-context'], searched_surfaces: ['request-cache-control'], failure_classification: 'transition-not-observed', next_minimal_action: 'preserve terminal unknown' },
    { hypothesis: 'telemetry-diagnostic-update-error-traffic', evidence_level: 'Unknown', commands: ['doctor', 'update'], searched_surfaces: ['observer', 'process'], failure_classification: 'destination-not-observed', next_minimal_action: 'preserve terminal unknown' },
    { hypothesis: 'restart-resume-and-child-process-lineage', evidence_level: 'Unknown', commands: ['session-id', 'resume'], searched_surfaces: ['session-state', 'process-lineage'], failure_classification: 'resume-transition-not-observed', next_minimal_action: 'preserve terminal unknown' },
  ],
}
const gap = { ...gapBase, deterministic_digest: sha256Bytes(canonicalJson(gapBase)), sha256: digest }
const result = buildR2CoverageClosure({
  probe: { status: 'PASS', sha256: digest }, environment: { status: 'PASS', pair_count: 60, sha256: digest },
  saturation: { status: 'SATURATED', consecutive_no_new_batches: 3, sha256: digest }, scenario: { status: 'PASS', pair_count: 9, sha256: digest },
  config: { statuses: { REPRODUCED: 4 }, sha256: digest }, auth_primary: { statuses: { REPRODUCED: 3, UNKNOWN: 1 }, sha256: digest },
  auth_supplement: { statuses: { REPRODUCED: 1 }, sha256: digest },
  gap,
})
assert.equal(result.status, 'CLOSED_WITH_UNKNOWN')
assert.equal(result.coverage_counts.Reproduced, 7)
assert.equal(result.coverage_counts.Unknown, 3)
assert.equal(result.coverage.length, 10)
assert.equal(result.coverage.find((row: any) => row.hypothesis === 'compact-and-prompt-cache-lifecycle')?.source, 'gap')
const unresolved = buildR2CoverageClosure({ ...result.inputs, environment: { ...result.inputs.environment, status: 'CLOSED_WITH_UNKNOWN', statuses: { REPRODUCED: 57, UNKNOWN: 3 } } } as any)
assert.equal(unresolved.coverage_counts.Reproduced, 6)
assert.equal(unresolved.coverage_counts.Unknown, 4)
assert.throws(() => buildR2CoverageClosure({ ...result.inputs, environment: { ...result.inputs.environment, pair_count: 59 } } as any), /environment closure/)
const promotedGapBase = { ...gapBase, families: gapBase.families.map((row) => ({ ...row, evidence_level: 'Reproduced' })) }
assert.throws(() => buildR2CoverageClosure({ ...result.inputs, gap: { ...promotedGapBase, deterministic_digest: sha256Bytes(canonicalJson(promotedGapBase)), sha256: digest } } as any), /gap family/)
assert.throws(() => parseR2ClosureArgs(['--gap', '--out']), /arguments must/)
assert.throws(() => parseR2ClosureArgs(['--out', 'a', '--out', 'b']), /duplicate argument/)

const anchor = 'b'.repeat(64)
const staticBase = {
  schema_version: 'oracle-lab-phase3a-static-closure-summary.v1', status: 'complete',
  binding: { artifact_sha256: anchor },
  required_roots: [{ root: 'daemon-restart-resume-lifecycle', disposition: 'static-path-recovered' }],
}
const staticAnchor = { ...staticBase, deterministic_digest: sha256Bytes(canonicalJson(staticBase)), sha256: digest }
const resumeEnvironment = { home: 'shared/home', xdg: 'shared/xdg', cwd: 'shared/cwd' }
function repairCell(case_id: string, pid: number, argv: string[]) {
  const manifest = {
    artifact: { entrypoint_sha256: anchor }, command: { argv, executable_sha256: anchor, cwd: resumeEnvironment.cwd }, capture: { process: true },
    environment: { home: resumeEnvironment.home, xdg: resumeEnvironment.xdg }, network: { external_socket_budget: 0 }, hypothesis_id: `r2-gap-${case_id}`,
  }
  const guard = { status: 'PASS', manifest_sha256: sha256Bytes(canonicalJson(manifest)), external_socket_budget: 0, same_scope_probe: true }
  const result = {
    run_id: `repair-${case_id}`, status: 'complete', exit_code: 0, raw_output_persisted: false,
    process_samples: [{ pid, executable_class: 'root', executable_sha256: anchor }],
  }
  const observer = { raw_material_persisted: false, events: [{ request_class: 'messages', response_class: 'anthropic:sse' }] }
  const summary = {
    case_id, command_label: case_id === 'restart-resume-init' ? 'session-init' : 'session-resume',
    family: 'restart-resume-and-child-process-lineage', session_state: 'shared-resume-state', status: 'complete',
    manifest_sha256: digest, guard_sha256: digest, observer_sha256: digest, result_sha256: digest,
    observer_event_count: 1, process_samples: 1, external_socket_budget: 0, raw_material_persisted: false,
  }
  return { summary, manifest, guard, observer, result }
}
const resumeInit = repairCell('restart-resume-init', 100, ['--session-id', 'session'])
const resume = repairCell('restart-resume-resume', 200, ['--resume', 'session'])
const resumeRepairBase = {
  schema_version: 'oracle-lab-phase3a-r2-gap-campaign.v1', status: 'FOCUSED_REPAIR', campaign_id: 'r2-gap-repair-v1',
  selected_case_ids: ['restart-resume-init', 'restart-resume-resume'], executed_cells: 2,
  cases: [resumeInit.summary, resume.summary], families: [], external_socket_budget: 0, raw_material_persisted: false,
}
const resumeRepair = { ...resumeRepairBase, deterministic_digest: sha256Bytes(canonicalJson(resumeRepairBase)), sha256: digest }
const updateManifest = {
  artifact: { entrypoint_sha256: anchor }, command: { argv: ['update'], executable_sha256: anchor }, capture: { process: true },
  environment: { home: 'update/home', xdg: 'update/xdg', cwd: 'update/cwd' }, network: { external_socket_budget: 0 }, hypothesis_id: 'r2-gap-telemetry-update',
}
const updateGuard = { status: 'PASS', manifest_sha256: sha256Bytes(canonicalJson(updateManifest)), external_socket_budget: 0, same_scope_probe: true }
const updateCell = {
  summary: {
    case_id: 'telemetry-update', command_label: 'update', family: 'telemetry-diagnostic-update-error-traffic', session_state: null,
    status: 'failed', manifest_sha256: digest, guard_sha256: digest, observer_sha256: digest, result_sha256: digest,
    observer_event_count: 0, process_samples: 1, external_socket_budget: 0, raw_material_persisted: false, update_fixture_outcome: 'no-platform',
  },
  manifest: updateManifest, guard: updateGuard,
  observer: { raw_material_persisted: false, events: [] },
  result: { run_id: 'repair-update', status: 'failed', exit_code: 1, raw_output_persisted: false, process_samples: [{ pid: 300, executable_class: 'root', executable_sha256: anchor }] },
  fixture_self_test: {
    schema_version: 'oracle-lab-phase3a-update-loopback-self-test.v1', status: 'PASS', raw_content_persisted: false,
    request: { method: 'HEAD', path_class: '/' }, response: { status: 204, response_class: 'update:root-head' },
    version_check: { transport: 'loopback-tls-proxy', response_class: 'current-version' },
  },
  update_proxy: {
    schema_version: 'oracle-lab-phase3a-update-loopback-proxy.v1', raw_content_persisted: false,
    events: [
      { sequence: 0, method: 'GET', path_class: 'version-check', response_class: 'current-version' },
      { sequence: 1, method: 'GET', path_class: 'version-check', response_class: 'current-version' },
      { sequence: 2, method: 'GET', path_class: 'manifest', response_class: 'no-platform' },
    ],
  },
}
const updateRepairBase = {
  schema_version: 'oracle-lab-phase3a-r2-gap-campaign.v1', status: 'FOCUSED_REPAIR', campaign_id: 'r2-gap-update-repair-v5',
  selected_case_ids: ['telemetry-update'], executed_cells: 1, cases: [updateCell.summary], families: [], external_socket_budget: 0, raw_material_persisted: false,
}
const updateRepair = { ...updateRepairBase, deterministic_digest: sha256Bytes(canonicalJson(updateRepairBase)), sha256: digest }
const baseClosure = { ...result, sha256: digest }
const baseBeforeRepair = structuredClone(baseClosure)
const repaired = buildR2RepairCoverageClosure({
  base_closure: baseClosure, static_anchor: staticAnchor, resume_repair: { summary: resumeRepair, cells: [resumeInit, resume] },
  update_repair: { summary: updateRepair, cells: [updateCell] },
})
assert.equal(repaired.schema_version, 'oracle-lab-phase3a-r2-closure.v2')
assert.equal(repaired.coverage_counts.Reproduced, 8)
assert.equal(repaired.coverage_counts.Unknown, 3)
assert.deepEqual(baseClosure, baseBeforeRepair)
assert.equal(repaired.coverage.find((row: any) => row.hypothesis === 'completed-fresh-process-resume')?.evidence_level, 'Reproduced')
const updateConclusion = repaired.coverage.find((row: any) => row.hypothesis === 'telemetry-diagnostic-update-error-traffic')
assert.equal(updateConclusion.statement, SAFE_NO_DOWNLOAD_BOUNDARY_CONCLUSION)
assert.equal(updateConclusion.phase3b_usable, false)
assert.equal(repaired.repair_admission.fresh_process_resume.static_anchor.status, 'PASS')
assert.equal(repaired.repair_admission.fresh_process_resume.process.fresh_processes, true)
assert.throws(() => buildR2RepairCoverageClosure({
  base_closure: baseClosure, static_anchor: staticAnchor, resume_repair: { summary: resumeRepair, cells: [resumeInit, { ...resume, result: { ...resume.result, process_samples: [{ ...resume.result.process_samples[0], pid: 100 }] } }] },
  update_repair: { summary: updateRepair, cells: [updateCell] },
}), /fresh process/)
assert.throws(() => buildR2RepairCoverageClosure({
  base_closure: baseClosure, static_anchor: staticAnchor, resume_repair: { summary: resumeRepair, cells: [resumeInit, resume] },
  update_repair: { summary: updateRepair, cells: [{ ...updateCell, update_proxy: { ...updateCell.update_proxy, events: [...updateCell.update_proxy.events, { sequence: 3, method: 'GET', path_class: 'binary', response_class: 'binary' }] } }] },
}), /safe no-download boundary/)
assert.deepEqual(parseR2ClosureArgs(['--base-closure', 'v7', '--static-anchor', 'r1', '--resume-repair', 'resume', '--update-repair', 'update', '--out', 'v8']), {
  'base-closure': 'v7', 'static-anchor': 'r1', 'resume-repair': 'resume', 'update-repair': 'update', out: 'v8',
})

console.log(JSON.stringify({ ok: true, cases: 20 }))
