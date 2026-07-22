import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalJson, Phase3AError, sha256Bytes, sha256File } from './core.js'
import { R2_GAP_CASES } from './r2-gap-campaign.js'

type Bound = { sha256: string; [key: string]: any }
type Inputs = { probe: Bound; environment: Bound; saturation: Bound; scenario: Bound; config: Bound; auth_primary: Bound; auth_supplement: Bound; gap: Bound }
type RepairCell = { summary: Bound; manifest: Record<string, any>; guard: Record<string, any>; observer: Record<string, any>; result: Record<string, any>; fixture_self_test?: Record<string, any>; update_proxy?: Record<string, any> }
type RepairBundle = { summary: Bound; cells: RepairCell[] }
type RepairInputs = { base_closure: Bound; static_anchor: Bound; resume_repair: RepairBundle; update_repair: RepairBundle }
function fail(code: string, message: string): never { throw new Phase3AError(code, message) }
function isSha256(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) }

const GAP_HYPOTHESES = [
  'compact-and-prompt-cache-lifecycle',
  'telemetry-diagnostic-update-error-traffic',
  'restart-resume-and-child-process-lineage',
] as const
const GAP_CASE_IDS = ['compact-cache-long-context', 'telemetry-diagnostic-doctor', 'telemetry-update', 'restart-resume-init', 'restart-resume-resume'] as const
const RESUME_STATIC_ROOT = 'daemon-restart-resume-lifecycle'
export const SAFE_NO_DOWNLOAD_BOUNDARY_CONCLUSION = 'the bounded update command completed the loopback version and manifest exchanges, then stopped at the fixture no-platform boundary before download or replacement'

function assertDeterministic(value: Bound, code: string, message: string): void {
  const { sha256: _sha256, deterministic_digest, ...base } = value
  if (!isSha256(value.sha256) || !isSha256(deterministic_digest) || deterministic_digest !== sha256Bytes(canonicalJson(base))) fail(code, message)
}

function assertRepairSummary(bundle: RepairBundle, campaignId: string, requiredCaseIds: string[]): void {
  const summary = bundle.summary
  assertDeterministic(summary, 'r2_repair_integrity', `repair summary is not deterministic: ${campaignId}`)
  if (summary.schema_version !== 'oracle-lab-phase3a-r2-gap-campaign.v1' || summary.status !== 'FOCUSED_REPAIR' || summary.campaign_id !== campaignId || summary.external_socket_budget !== 0 || summary.raw_material_persisted !== false || !Array.isArray(summary.selected_case_ids) || !Array.isArray(summary.cases) || summary.executed_cells !== summary.cases.length) {
    fail('r2_repair_summary_invalid', `repair summary is not a safe focused repair: ${campaignId}`)
  }
  const caseIds = summary.cases.map((cell: Record<string, any>) => String(cell.case_id))
  if (new Set(caseIds).size !== caseIds.length || canonicalJson(caseIds) !== canonicalJson(summary.selected_case_ids) || requiredCaseIds.some((caseId) => !caseIds.includes(caseId))) {
    fail('r2_repair_summary_invalid', `repair summary has incomplete case coverage: ${campaignId}`)
  }
  for (const cell of bundle.cells) {
    const recorded = summary.cases.find((candidate: Record<string, any>) => candidate.case_id === cell.summary.case_id)
    if (!recorded || canonicalJson(recorded) !== canonicalJson(cell.summary)) fail('r2_repair_cell_binding', `repair cell summary is not bound: ${String(cell.summary.case_id)}`)
  }
}

function repairCell(bundle: RepairBundle, caseId: string): RepairCell {
  const cells = bundle.cells.filter((cell) => cell.summary.case_id === caseId)
  if (cells.length !== 1) fail('r2_repair_cell_missing', `required repair cell is missing: ${caseId}`)
  return cells[0]!
}

function assertSafeCell(cell: RepairCell, expectedStatus: string): void {
  const summary = cell.summary
  if (!['complete', 'failed', 'timeout', 'resource-limit'].includes(summary.status) || summary.status !== expectedStatus || ![summary.manifest_sha256, summary.guard_sha256, summary.observer_sha256, summary.result_sha256].every(isSha256) || summary.external_socket_budget !== 0 || summary.raw_material_persisted !== false) {
    fail('r2_repair_cell_invalid', `repair cell is not terminal and safely bound: ${String(summary.case_id)}`)
  }
  if (cell.manifest.network?.external_socket_budget !== 0 || cell.guard.status !== 'PASS' || cell.guard.manifest_sha256 !== sha256Bytes(canonicalJson(cell.manifest)) || cell.guard.external_socket_budget !== 0 || cell.guard.same_scope_probe !== true || cell.observer.raw_material_persisted !== false || !Array.isArray(cell.observer.events) || cell.result.status !== expectedStatus || cell.result.raw_output_persisted !== false) {
    fail('r2_repair_cell_invalid', `repair cell safety proof is invalid: ${String(summary.case_id)}`)
  }
}

function assertStaticResumeAnchor(staticAnchor: Bound): string {
  assertDeterministic(staticAnchor, 'r2_resume_static_anchor_invalid', 'static anchor is not deterministic')
  const anchor = staticAnchor.binding?.artifact_sha256
  const root = Array.isArray(staticAnchor.required_roots)
    ? staticAnchor.required_roots.find((entry: Record<string, any>) => entry.root === RESUME_STATIC_ROOT)
    : undefined
  if (staticAnchor.schema_version !== 'oracle-lab-phase3a-static-closure-summary.v1' || staticAnchor.status !== 'complete' || !isSha256(anchor) || root?.disposition !== 'static-path-recovered') {
    fail('r2_resume_static_anchor_invalid', 'resume admission requires the recovered daemon/restart/resume static anchor')
  }
  return anchor
}

function rootProcess(cell: RepairCell, anchor: string): Record<string, any> {
  const sample = Array.isArray(cell.result.process_samples)
    ? cell.result.process_samples.find((entry: Record<string, any>) => entry.executable_class === 'root' && entry.executable_sha256 === anchor)
    : undefined
  if (!sample || !Number.isSafeInteger(sample.pid)) fail('r2_resume_process_invalid', `repair cell has no root process proof: ${String(cell.summary.case_id)}`)
  return sample
}

function assertResumeManifest(cell: RepairCell, anchor: string, flag: '--session-id' | '--resume'): void {
  const argv = cell.manifest.command?.argv
  if (cell.manifest.artifact?.entrypoint_sha256 !== anchor || cell.manifest.command?.executable_sha256 !== anchor || cell.manifest.capture?.process !== true || !Array.isArray(argv) || !argv.includes(flag) || cell.manifest.hypothesis_id !== `r2-gap-${String(cell.summary.case_id)}`) {
    fail('r2_resume_manifest_invalid', `repair manifest does not prove ${String(cell.summary.case_id)}`)
  }
  if (!cell.observer.events.some((event: Record<string, any>) => event.request_class === 'messages')) fail('r2_resume_observer_invalid', `repair observer has no messages proof: ${String(cell.summary.case_id)}`)
  if (cell.summary.observer_event_count !== cell.observer.events.length || cell.summary.process_samples !== cell.result.process_samples.length) fail('r2_resume_observer_invalid', `repair summary counts disagree: ${String(cell.summary.case_id)}`)
}

function admitFreshProcessResume(staticAnchor: Bound, repair: RepairBundle): Record<string, any> {
  assertRepairSummary(repair, 'r2-gap-repair-v1', ['restart-resume-init', 'restart-resume-resume'])
  const anchor = assertStaticResumeAnchor(staticAnchor)
  const init = repairCell(repair, 'restart-resume-init')
  const resume = repairCell(repair, 'restart-resume-resume')
  assertSafeCell(init, 'complete'); assertSafeCell(resume, 'complete')
  assertResumeManifest(init, anchor, '--session-id'); assertResumeManifest(resume, anchor, '--resume')
  const state = (cell: RepairCell) => ({ home: cell.manifest.environment?.home, xdg: cell.manifest.environment?.xdg, cwd: cell.manifest.command?.cwd })
  const initState = state(init); const resumeState = state(resume)
  if (!Object.values(initState).every((value) => typeof value === 'string') || canonicalJson(initState) !== canonicalJson(resumeState)) fail('r2_resume_state_invalid', 'resume admission requires the same preserved isolated state')
  const initProcess = rootProcess(init, anchor); const resumeProcess = rootProcess(resume, anchor)
  if (initProcess.pid === resumeProcess.pid) fail('r2_resume_process_invalid', 'resume admission requires a completed fresh process')
  return {
    status: 'PASS', conclusion: 'completed-fresh-process-resume', phase3b_usable: false,
    static_anchor: { status: 'PASS', artifact_sha256: anchor, required_root: RESUME_STATIC_ROOT },
    process: { status: 'PASS', root_executable_sha256: anchor, fresh_processes: true, completed_cells: ['restart-resume-init', 'restart-resume-resume'] },
    observer: { status: 'PASS', messages_observed: true, init_event_count: init.observer.events.length, resume_event_count: resume.observer.events.length },
  }
}

function admitSafeNoDownloadUpdateBoundary(repair: RepairBundle): Record<string, any> {
  assertRepairSummary(repair, 'r2-gap-update-repair-v5', ['telemetry-update'])
  const update = repairCell(repair, 'telemetry-update')
  assertSafeCell(update, 'failed')
  if (update.summary.command_label !== 'update' || update.summary.family !== 'telemetry-diagnostic-update-error-traffic' || update.summary.update_fixture_outcome !== 'no-platform' || canonicalJson(update.manifest.command?.argv) !== canonicalJson(['update'])) {
    fail('r2_update_boundary_invalid', 'update repair does not bind the no-platform update command')
  }
  const fixture = update.fixture_self_test
  const expectedFixture = {
    schema_version: 'oracle-lab-phase3a-update-loopback-self-test.v1', status: 'PASS', raw_content_persisted: false,
    request: { method: 'HEAD', path_class: '/' }, response: { status: 204, response_class: 'update:root-head' },
    version_check: { transport: 'loopback-tls-proxy', response_class: 'current-version' },
  }
  const proxy = update.update_proxy
  const expectedEvents = [
    { sequence: 0, method: 'GET', path_class: 'version-check', response_class: 'current-version' },
    { sequence: 1, method: 'GET', path_class: 'version-check', response_class: 'current-version' },
    { sequence: 2, method: 'GET', path_class: 'manifest', response_class: 'no-platform' },
  ]
  if (!fixture || canonicalJson(fixture) !== canonicalJson(expectedFixture) || !proxy || proxy.schema_version !== 'oracle-lab-phase3a-update-loopback-proxy.v1' || proxy.raw_content_persisted !== false || canonicalJson(proxy.events) !== canonicalJson(expectedEvents)) {
    fail('r2_update_boundary_invalid', 'update repair does not prove the safe no-download boundary')
  }
  return {
    status: 'PASS', conclusion: SAFE_NO_DOWNLOAD_BOUNDARY_CONCLUSION, phase3b_usable: false,
    fixture: { status: 'PASS', loopback_only: true },
    proxy: { status: 'PASS', event_count: expectedEvents.length, binary_or_replacement_observed: false },
  }
}

function assertV7Closure(baseClosure: Bound): void {
  assertDeterministic(baseClosure, 'r2_base_closure_invalid', 'base R2 closure is not deterministic')
  if (baseClosure.schema_version !== 'oracle-lab-phase3a-r2-closure.v1' || baseClosure.status !== 'CLOSED_WITH_UNKNOWN' || baseClosure.external_socket_budget !== 0 || baseClosure.raw_material_persisted !== false || !Array.isArray(baseClosure.coverage)) {
    fail('r2_base_closure_invalid', 'repair closure must be based on the terminal R2 v7 closure')
  }
}

export function buildR2RepairCoverageClosure(inputs: RepairInputs): Record<string, any> {
  assertV7Closure(inputs.base_closure)
  const resumeAdmission = admitFreshProcessResume(inputs.static_anchor, inputs.resume_repair)
  const updateAdmission = admitSafeNoDownloadUpdateBoundary(inputs.update_repair)
  const coverage = inputs.base_closure.coverage.map((row: Record<string, any>) => {
    if (row.hypothesis !== 'telemetry-diagnostic-update-error-traffic') return { ...row }
    return {
      hypothesis: row.hypothesis, evidence_level: 'Unknown', source: 'gap-update-repair-v5',
      statement: SAFE_NO_DOWNLOAD_BOUNDARY_CONCLUSION, failure_classification: 'update-no-platform-safe-boundary',
      commands: ['update'], searched_surfaces: ['loopback-update-proxy', 'fixture-self-test', 'safe-error-category'],
      next_minimal_action: 'Preserve this terminal Unknown unless an operator authorizes a separately isolated update-application fixture.',
      phase3b_usable: false,
    }
  })
  coverage.push({
    hypothesis: 'completed-fresh-process-resume', evidence_level: 'Reproduced', source: 'gap-repair-v1',
    statement: 'A fresh process completed the --resume command against the preserved isolated session state with matching static, process, and observer proof.',
    phase3b_usable: false,
  })
  const coverageCounts = coverage.reduce<Record<string, number>>((counts, row) => { counts[row.evidence_level] = (counts[row.evidence_level] ?? 0) + 1; return counts }, {})
  const base = {
    schema_version: 'oracle-lab-phase3a-r2-closure.v2', status: 'CLOSED_WITH_UNKNOWN',
    prior_closure: { artifact_id: 'p3a2-closure-coverage-v7', sha256: inputs.base_closure.sha256 },
    inputs: {
      base_closure: inputs.base_closure, static_anchor: inputs.static_anchor,
      resume_repair: inputs.resume_repair.summary, update_repair: inputs.update_repair.summary,
    },
    repair_admission: { fresh_process_resume: resumeAdmission, update_no_download_boundary: updateAdmission },
    coverage_counts: coverageCounts, coverage, external_socket_budget: 0, raw_material_persisted: false,
  }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

function gapCoverage(input: Bound): Array<Record<string, any>> {
  const { sha256: _sha256, deterministic_digest, ...base } = input
  if (input.status !== 'CLOSED_WITH_UNKNOWN' || !Number.isInteger(input.executed_cells) || input.executed_cells !== GAP_CASE_IDS.length || input.external_socket_budget !== 0 || input.raw_material_persisted !== false || !Array.isArray(input.families) || !Array.isArray(input.cases) || input.cases.length !== GAP_CASE_IDS.length || deterministic_digest !== sha256Bytes(canonicalJson(base))) {
    fail('r2_gap_incomplete', 'gap campaign must contain at least five safe executed cells')
  }
  const cases = new Map(input.cases.map((cell: Record<string, any>) => [cell.case_id, cell]))
  if (cases.size !== GAP_CASE_IDS.length || GAP_CASE_IDS.some((caseId) => !cases.has(caseId))) fail('r2_gap_cells', 'gap campaign must bind all five expected cells')
  for (const caseId of GAP_CASE_IDS) {
    const cell = cases.get(caseId) as Record<string, any>
    if (!['complete', 'failed', 'timeout', 'resource-limit'].includes(cell.status) || ![cell.manifest_sha256, cell.guard_sha256, cell.observer_sha256, cell.result_sha256].every(isSha256)) {
      fail('r2_gap_cells', `gap cell is not terminal and hash-bound: ${caseId}`)
    }
  }
  const families = new Map(input.families.map((family: Record<string, any>) => [family.hypothesis, family]))
  if (families.size !== GAP_HYPOTHESES.length || GAP_HYPOTHESES.some((hypothesis) => !families.has(hypothesis))) fail('r2_gap_coverage', 'gap campaign must cover every terminal unknown family')
  return GAP_HYPOTHESES.map((hypothesis) => {
    const family = families.get(hypothesis) as Record<string, any>
    if (family.evidence_level !== 'Unknown' || !Array.isArray(family.commands) || family.commands.length === 0 || !Array.isArray(family.searched_surfaces) || family.searched_surfaces.length === 0 || typeof family.failure_classification !== 'string' || typeof family.next_minimal_action !== 'string') {
      fail('r2_gap_invalid', `gap family is incomplete: ${hypothesis}`)
    }
    return {
      hypothesis,
      evidence_level: family.evidence_level,
      source: 'gap',
      commands: family.commands,
      searched_surfaces: family.searched_surfaces,
      failure_classification: family.failure_classification,
      reason: family.reason ?? family.failure_classification,
      next_minimal_action: family.next_minimal_action,
    }
  })
}

export function buildR2CoverageClosure(inputs: Inputs): Record<string, any> {
  if (inputs.probe.status !== 'PASS') fail('r2_probe_incomplete', 'instrumentation probe is not PASS')
  if (!['PASS', 'CLOSED_WITH_UNKNOWN'].includes(inputs.environment.status) || inputs.environment.pair_count !== 60) fail('r2_environment_incomplete', 'environment closure must contain 60 classified pairs')
  if (inputs.saturation.status !== 'SATURATED' || inputs.saturation.consecutive_no_new_batches !== 3) fail('r2_saturation_incomplete', 'saturation closure must contain three no-new batches')
  if (inputs.scenario.status !== 'PASS' || inputs.scenario.pair_count !== 9) fail('r2_scenario_incomplete', 'scenario closure must contain nine PASS pairs')
  if (inputs.config.statuses?.REPRODUCED !== 4) fail('r2_config_incomplete', 'config precedence must contain four reproduced pairs')
  if (inputs.auth_primary.statuses?.REPRODUCED !== 3 || inputs.auth_supplement.statuses?.REPRODUCED !== 1) fail('r2_auth_incomplete', 'auth lifecycle must contain four reproduced pairs across primary and supplement')
  for (const bound of Object.values(inputs)) if (!/^[a-f0-9]{64}$/.test(bound.sha256)) fail('r2_binding_invalid', 'R2 input binding must be SHA-256')
  const gaps = gapCoverage(inputs.gap)
  const coverage = [
    { hypothesis: 'instrumentation-equivalence', evidence_level: 'Reproduced', source: 'probe' },
    inputs.environment.status === 'PASS'
      ? { hypothesis: 'environment-routing-and-provider-selection', evidence_level: 'Reproduced', source: 'environment+saturation' }
      : { hypothesis: 'environment-routing-and-provider-selection', evidence_level: 'Unknown', reason: `${String(inputs.environment.statuses?.UNKNOWN ?? 0)} matrix pairs lacked complete protocol observation`, next_minimal_action: 'Route default API and empty socket arms through a loopback protocol observer, then rerun only the three unresolved pairs.' },
    { hypothesis: 'config-precedence-and-phase-split', evidence_level: 'Reproduced', source: 'config' },
    { hypothesis: 'placeholder-auth-initialization-rotation-coexistence-and-missing', evidence_level: 'Reproduced', source: 'auth' },
    { hypothesis: 'http-failure-reset-and-terminal-outcomes', evidence_level: 'Reproduced', source: 'scenario' },
    { hypothesis: 'partial-and-complete-sse-topology', evidence_level: 'Reproduced', source: 'scenario' },
    { hypothesis: 'request-cache-control-surface', evidence_level: 'Reproduced', source: 'environment+observer' },
    ...gaps,
  ]
  const coverageCounts = coverage.reduce<Record<string, number>>((counts, row) => { counts[row.evidence_level] = (counts[row.evidence_level] ?? 0) + 1; return counts }, {})
  const base = { schema_version: 'oracle-lab-phase3a-r2-closure.v1', status: 'CLOSED_WITH_UNKNOWN', inputs, coverage_counts: coverageCounts, coverage, external_socket_budget: 0, raw_material_persisted: false }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

export function parseR2ClosureArgs(argv: string[]): Record<string, string> {
  const values = argv[0] === '--' ? argv.slice(1) : argv
  const output: Record<string, string> = {}
  const allowed = new Set(['probe', 'environment', 'saturation', 'scenario', 'config', 'auth-primary', 'auth-supplement', 'gap', 'base-closure', 'static-anchor', 'resume-repair', 'update-repair', 'out'])
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith('--') || !values[index + 1] || values[index + 1].startsWith('--')) fail('invalid_arguments', 'arguments must be --name value pairs')
    const name = values[index].slice(2)
    if (!allowed.has(name)) fail('invalid_arguments', `unknown argument: --${name}`)
    if (output[name] !== undefined) fail('invalid_arguments', `duplicate argument: --${name}`)
    output[name] = values[index + 1]
  }
  return output
}
function assertGapCellFiles(file: string, summary: Record<string, any>): void {
  if (!Array.isArray(summary.cases)) fail('r2_gap_cells', 'gap campaign cases are missing')
  for (let index = 0; index < GAP_CASE_IDS.length; index += 1) {
    const cell = summary.cases[index] as Record<string, any>
    const expected = R2_GAP_CASES[index]
    const directory = path.join(path.dirname(file), 'cells', String(index).padStart(2, '0'))
    if (!cell || cell.case_id !== GAP_CASE_IDS[index]) fail('r2_gap_cells', 'gap campaign cell order is invalid')
    for (const [name, digest] of [['manifest.json', cell.manifest_sha256], ['guard.json', cell.guard_sha256], ['observer.json', cell.observer_sha256], ['result.json', cell.result_sha256]] as const) {
      const cellFile = path.join(directory, name)
      if (!existsSync(cellFile) || sha256File(cellFile) !== digest) fail('r2_gap_cells', `gap campaign cell binding is invalid: ${cell.case_id}:${name}`)
    }
    const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8')) as Record<string, any>
    const guard = JSON.parse(readFileSync(path.join(directory, 'guard.json'), 'utf8')) as Record<string, any>
    const observer = JSON.parse(readFileSync(path.join(directory, 'observer.json'), 'utf8')) as Record<string, any>
    const result = JSON.parse(readFileSync(path.join(directory, 'result.json'), 'utf8')) as Record<string, any>
    if (manifest.hypothesis_id !== `r2-gap-${expected.id}` || canonicalJson(manifest.command?.argv) !== canonicalJson(expected.argv) || manifest.network?.external_socket_budget !== 0) fail('r2_gap_cells', `gap campaign manifest does not match its expected case: ${cell.case_id}`)
    if (guard.status !== 'PASS' || guard.manifest_sha256 !== sha256Bytes(canonicalJson(manifest)) || guard.external_socket_budget !== 0 || guard.same_scope_probe !== true) fail('r2_gap_cells', `gap campaign guard is invalid: ${cell.case_id}`)
    if (observer.raw_material_persisted !== false || !Array.isArray(observer.events) || result.status !== cell.status) fail('r2_gap_cells', `gap campaign observation is invalid: ${cell.case_id}`)
  }
}
function bound(file: string, verifyGap = false): Bound {
  const summary = JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>
  if (verifyGap) assertGapCellFiles(file, summary)
  return { ...summary, sha256: sha256File(file) }
}
function readRepairCell(campaignFile: string, campaign: Bound, caseId: string, includeUpdateBoundaryFiles = false): RepairCell {
  const cases = Array.isArray(campaign.cases) ? campaign.cases as Bound[] : []
  const index = cases.findIndex((cell) => cell.case_id === caseId)
  if (index === -1) fail('r2_repair_cell_missing', `repair campaign does not contain ${caseId}`)
  const directory = path.join(path.dirname(campaignFile), 'cells', String(index).padStart(2, '0'))
  const summaryFile = path.join(directory, 'summary.json')
  const summary = JSON.parse(readFileSync(summaryFile, 'utf8')) as Bound
  if (canonicalJson(summary) !== canonicalJson(cases[index])) fail('r2_repair_cell_binding', `repair campaign summary drifted: ${caseId}`)
  const readBound = (name: 'manifest' | 'guard' | 'observer' | 'result'): Record<string, any> => {
    const expected = summary[`${name}_sha256`]
    const file = path.join(directory, `${name}.json`)
    if (!isSha256(expected) || !existsSync(file) || sha256File(file) !== expected) fail('r2_repair_cell_binding', `repair cell binding is invalid: ${caseId}:${name}`)
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>
  }
  const manifest = readBound('manifest'); const guard = readBound('guard'); const observer = readBound('observer'); const result = readBound('result')
  const readSupplement = (name: 'fixture-self-test' | 'update-proxy', field: 'fixture_self_test_sha256' | 'update_proxy_sha256'): Record<string, any> => {
    const file = path.join(directory, `${name}.json`); const expected = summary[field]
    if (!isSha256(expected) || !existsSync(file) || sha256File(file) !== expected) fail('r2_repair_cell_binding', `repair cell binding is invalid: ${caseId}:${name}`)
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>
  }
  return {
    summary, manifest, guard, observer, result,
    ...(includeUpdateBoundaryFiles ? { fixture_self_test: readSupplement('fixture-self-test', 'fixture_self_test_sha256'), update_proxy: readSupplement('update-proxy', 'update_proxy_sha256') } : {}),
  }
}
function readRepairBundle(file: string, caseIds: string[], includeUpdateBoundaryFiles = false): RepairBundle {
  const summary = bound(file)
  return { summary, cells: caseIds.map((caseId) => readRepairCell(file, summary, caseId, includeUpdateBoundaryFiles)) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const values = parseR2ClosureArgs(process.argv.slice(2))
  const repairNames = ['base-closure', 'static-anchor', 'resume-repair', 'update-repair']
  const legacyNames = ['probe', 'environment', 'saturation', 'scenario', 'config', 'auth-primary', 'auth-supplement', 'gap']
  const repairMode = repairNames.some((name) => values[name] !== undefined)
  const result = repairMode
    ? (() => {
        if (!values.out || repairNames.some((name) => !values[name]) || legacyNames.some((name) => values[name] !== undefined)) fail('usage', 'R2 repair closure requires --base-closure, --static-anchor, --resume-repair, --update-repair, and --out only')
        if (path.basename(values['base-closure']!) !== 'closure-r2-coverage-v7.json') fail('r2_base_closure_invalid', 'R2 repair closure must retain closure-r2-coverage-v7.json unchanged as its base')
        return buildR2RepairCoverageClosure({
          base_closure: bound(values['base-closure']!), static_anchor: bound(values['static-anchor']!),
          resume_repair: readRepairBundle(values['resume-repair']!, ['restart-resume-init', 'restart-resume-resume']),
          update_repair: readRepairBundle(values['update-repair']!, ['telemetry-update'], true),
        })
      })()
    : (() => {
        if (!values.out || legacyNames.some((name) => !values[name])) fail('usage', 'r2-closure requires eight input summaries and --out')
        return buildR2CoverageClosure({ probe: bound(values.probe!), environment: bound(values.environment!), saturation: bound(values.saturation!), scenario: bound(values.scenario!), config: bound(values.config!), auth_primary: bound(values['auth-primary']!), auth_supplement: bound(values['auth-supplement']!), gap: bound(values.gap!, true) })
      })()
  writeFileSync(values.out!, `${canonicalJson(result)}\n`, { flag: 'wx', mode: 0o600 }); process.stdout.write(`${canonicalJson(result)}\n`)
}
