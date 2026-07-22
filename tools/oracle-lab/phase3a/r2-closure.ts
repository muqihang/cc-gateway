import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalJson, Phase3AError, sha256Bytes, sha256File } from './core.js'
import { R2_GAP_CASES } from './r2-gap-campaign.js'

type Bound = { sha256: string; [key: string]: any }
type Inputs = { probe: Bound; environment: Bound; saturation: Bound; scenario: Bound; config: Bound; auth_primary: Bound; auth_supplement: Bound; gap: Bound }
function fail(code: string, message: string): never { throw new Phase3AError(code, message) }
function isSha256(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) }

const GAP_HYPOTHESES = [
  'compact-and-prompt-cache-lifecycle',
  'telemetry-diagnostic-update-error-traffic',
  'restart-resume-and-child-process-lineage',
] as const
const GAP_CASE_IDS = ['compact-cache-long-context', 'telemetry-diagnostic-doctor', 'telemetry-update', 'restart-resume-init', 'restart-resume-resume'] as const

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
  const allowed = new Set(['probe', 'environment', 'saturation', 'scenario', 'config', 'auth-primary', 'auth-supplement', 'gap', 'out'])
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
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const values = parseR2ClosureArgs(process.argv.slice(2))
  const names = ['probe', 'environment', 'saturation', 'scenario', 'config', 'auth-primary', 'auth-supplement', 'gap', 'out']
  if (names.some((name) => !values[name])) fail('usage', 'r2-closure requires seven input summaries and --out')
  const result = buildR2CoverageClosure({ probe: bound(values.probe!), environment: bound(values.environment!), saturation: bound(values.saturation!), scenario: bound(values.scenario!), config: bound(values.config!), auth_primary: bound(values['auth-primary']!), auth_supplement: bound(values['auth-supplement']!), gap: bound(values.gap!, true) })
  writeFileSync(values.out!, `${canonicalJson(result)}\n`, { flag: 'wx', mode: 0o600 }); process.stdout.write(`${canonicalJson(result)}\n`)
}
