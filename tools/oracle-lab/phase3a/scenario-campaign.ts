import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { BASELINE_PROMPT, buildBaselineManifest } from './baseline-cell.js'
import { balancedPairOrder } from './converge.js'
import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'
import { type LaunchManifest, validateLaunchManifest } from './launch-manifest.js'
import { normalizeCapsule } from './normalize.js'
import { startFakeUpstream, type FakeScenario, type ObserverStringReplacement } from './observers/fake-upstream.js'
import { runCell, runCellGuardSelfTest, type CellResult } from './run-cell.js'

type Arm = 'control' | 'treatment'
type StableOutcome = Extract<CellResult['status'], 'complete' | 'failed' | 'timeout' | 'resource-limit'>

export type ScenarioPairDefinition = {
  pair_id: string
  treatment_label: string
  control: FakeScenario
  treatment: FakeScenario
}

export type ScenarioRunRecord = {
  arm: Arm
  repetition: number
  status: CellResult['status']
  source_count: number
}

type CampaignRunRecord = ScenarioRunRecord & {
  run_id: string
  sequence_index: number
  hook_event_count: number
  observer_event_count: number
  process_samples: number
  observer_response_classes_sha256: string
}

type CampaignOptions = {
  evidence_root: string
  source_entrypoint: string
  probe_entrypoint: string
  expected_probe_sha256: string
  probe_recipe_sha256: string
  out_relative: string
  campaign_id: string
  repetitions: number
  cc_commit: string
  cc_tree: string
  sub2api_commit: string
  sub2api_tree: string
  plan_sha256: string
  toolchain_digest: string
  pair_id?: string
}

const COMPLETE_SSE_EVENTS: Array<{ event: string; data: unknown }> = [
  {
    event: 'message_start',
    data: {
      type: 'message_start',
      message: {
        id: 'msg_phase3a_synthetic', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [],
        stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    },
  },
  { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
  { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } } },
  { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
  { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } } },
  { event: 'message_stop', data: { type: 'message_stop' } },
]

const httpPair = (status: number): ScenarioPairDefinition => ({
  pair_id: `scenario-http-${status}`,
  treatment_label: `http-${status}`,
  control: { kind: 'anthropic' },
  treatment: { kind: 'json', status, response: { type: 'error', error: { type: 'synthetic_error' } } },
})

export const SCENARIO_PAIRS: readonly ScenarioPairDefinition[] = [
  ...[400, 401, 403, 429, 500, 529].map(httpPair),
  { pair_id: 'scenario-reset', treatment_label: 'connection-reset', control: { kind: 'anthropic' }, treatment: { kind: 'reset' } },
  { pair_id: 'scenario-partial-sse', treatment_label: 'partial-sse', control: { kind: 'anthropic' }, treatment: { kind: 'sse', events: COMPLETE_SSE_EVENTS, close_after: 3 } },
  { pair_id: 'scenario-complete-sse', treatment_label: 'complete-sse', control: { kind: 'anthropic' }, treatment: { kind: 'sse', events: COMPLETE_SSE_EVENTS } },
]

const TERMINAL_OUTCOMES = new Set<CellResult['status']>(['complete', 'failed', 'timeout', 'resource-limit'])

function fail(code: string, message: string): never { throw new Phase3AError(code, message) }
function writeJson(file: string, value: unknown): void { writeFileSync(file, `${canonicalJson(value)}\n`, { flag: 'wx', mode: 0o600 }) }

export function validateScenarioRepetitions(repetitions: number): number {
  if (!Number.isInteger(repetitions) || repetitions < 5 || repetitions > 12) fail('invalid_repetitions', 'scenario campaign repetitions must be between 5 and 12')
  return repetitions
}

export function classifyScenarioPairRuns(input: { repetitions: number; runs: ScenarioRunRecord[] }): {
  status: 'REPRODUCED' | 'UNKNOWN'
  effect: 'no-observed-effect' | 'outcome-change' | 'unresolved'
  stable: boolean
  control_outcome: StableOutcome | null
  treatment_outcome: StableOutcome | null
  terminal_cells: number
  dual_source_cells: number
} {
  const repetitions = validateScenarioRepetitions(input.repetitions)
  const byArm = (arm: Arm) => input.runs.filter((run) => run.arm === arm)
  const stableOutcome = (arm: Arm): StableOutcome | null => {
    const outcomes = new Set(byArm(arm).map((run) => run.status))
    const outcome = outcomes.size === 1 ? [...outcomes][0] : null
    return outcome !== null && TERMINAL_OUTCOMES.has(outcome) ? outcome as StableOutcome : null
  }
  const controlOutcome = stableOutcome('control')
  const treatmentOutcome = stableOutcome('treatment')
  const stable = controlOutcome !== null && treatmentOutcome !== null
  const terminalCells = input.runs.filter((run) => TERMINAL_OUTCOMES.has(run.status)).length
  const dualSourceCells = input.runs.filter((run) => Number.isInteger(run.source_count) && run.source_count >= 2).length
  const completeSchedule = input.runs.length === repetitions * 2 && (['control', 'treatment'] as const).every((arm) => {
    const rows = byArm(arm).sort((left, right) => left.repetition - right.repetition)
    return rows.length === repetitions && rows.every((run, index) => run.repetition === index)
  })
  const reproduced = stable && completeSchedule && terminalCells === repetitions * 2 && dualSourceCells === repetitions * 2
  return {
    status: reproduced ? 'REPRODUCED' : 'UNKNOWN',
    effect: !stable ? 'unresolved' : controlOutcome === treatmentOutcome ? 'no-observed-effect' : 'outcome-change',
    stable,
    control_outcome: controlOutcome,
    treatment_outcome: treatmentOutcome,
    terminal_cells: terminalCells,
    dual_source_cells: dualSourceCells,
  }
}

function observerReplacements(root: string, runId: string): ObserverStringReplacement[] {
  const runRoot = path.join(root, 'runs', runId)
  return [
    { value: path.join(runRoot, 'home'), replacement: '<HOME>' },
    { value: path.join(runRoot, 'xdg'), replacement: '<XDG>' },
    { value: path.join(runRoot, 'tmp'), replacement: '<TMP>' },
    { value: path.join(runRoot, 'cwd'), replacement: '<CWD>' },
  ]
}

function scenarioManifest(input: {
  base: LaunchManifest
  pair: ScenarioPairDefinition
  run_id: string
  sequence_index: number
  seed: number
  probe_sha256: string
  probe_recipe_sha256: string
}): LaunchManifest {
  return validateLaunchManifest({
    ...structuredClone(input.base),
    run_id: input.run_id,
    pair_id: input.pair.pair_id,
    sequence_index: input.sequence_index,
    randomization_seed: input.seed,
    hypothesis_id: `${input.pair.pair_id}-terminal-outcome`,
    evidence_level_ceiling: 'Reproduced',
    artifact: { ...input.base.artifact, entrypoint_sha256: input.probe_sha256 },
    command: { ...input.base.command, executable_sha256: input.probe_sha256, cwd: `runs/${input.run_id}/cwd` },
    environment: {
      ...input.base.environment,
      home: `runs/${input.run_id}/home`,
      xdg: `runs/${input.run_id}/xdg`,
      tmp: `runs/${input.run_id}/tmp`,
    },
    matrix: {
      changed_variable: 'fake-upstream-scenario',
      control_value: 'anthropic',
      treatment_value: input.pair.treatment_label,
      fixed_variables: {
        ...input.base.matrix.fixed_variables,
        observer: 'loopback-fake-upstream',
        probe_recipe_sha256: input.probe_recipe_sha256,
      },
    },
    capture: { ...input.base.capture, hook: true, process: true, fs: true, network: true, http: true },
  })
}

async function runScenarioCell(input: {
  root: string
  pair_output: string
  pair: ScenarioPairDefinition
  arm: Arm
  repetition: number
  sequence_index: number
  seed: number
  options: CampaignOptions
}): Promise<CampaignRunRecord> {
  const runId = `${input.options.campaign_id}-${input.pair.pair_id}-r${String(input.repetition).padStart(2, '0')}-${input.arm}`
  const scenario = input.arm === 'control' ? input.pair.control : input.pair.treatment
  const upstream = await startFakeUpstream({ scenario, max_body_bytes: 8 * 1024 * 1024, string_replacements: observerReplacements(input.root, runId) })
  try {
    const base = buildBaselineManifest({
      evidence_root: input.root,
      entrypoint: input.options.source_entrypoint,
      out_relative: input.options.out_relative,
      run_id: runId,
      cc_commit: input.options.cc_commit,
      cc_tree: input.options.cc_tree,
      sub2api_commit: input.options.sub2api_commit,
      sub2api_tree: input.options.sub2api_tree,
      plan_sha256: input.options.plan_sha256,
      toolchain_digest: input.options.toolchain_digest,
      command_profile: 'full',
    }, upstream.url, upstream.port)
    const manifest = scenarioManifest({
      base, pair: input.pair, run_id: runId, sequence_index: input.sequence_index, seed: input.seed,
      probe_sha256: input.options.expected_probe_sha256, probe_recipe_sha256: input.options.probe_recipe_sha256,
    })
    const directory = path.join(input.pair_output, `r${String(input.repetition).padStart(2, '0')}`, input.arm)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const guard = await runCellGuardSelfTest(manifest, input.root)
    writeJson(path.join(directory, 'manifest.json'), manifest)
    writeJson(path.join(directory, 'guard.json'), guard)
    const result = await runCell({ manifest, evidence_root: input.root, executable: input.options.probe_entrypoint, instrumentation: 'none', guard, stdin: BASELINE_PROMPT })
    const observer = { schema_version: 'oracle-lab-phase3a-safe-observer.v1', normalization: upstream.normalization, raw_material_persisted: false, events: upstream.events }
    writeJson(path.join(directory, 'observer.json'), observer)
    writeJson(path.join(directory, 'result.json'), result)
    const summary = {
      schema_version: 'oracle-lab-phase3a-scenario-cell-summary.v1',
      run_id: runId, pair_id: input.pair.pair_id, arm: input.arm, repetition: input.repetition,
      manifest_sha256: sha256File(path.join(directory, 'manifest.json')),
      guard_sha256: sha256File(path.join(directory, 'guard.json')),
      observer_sha256: sha256File(path.join(directory, 'observer.json')),
      result_sha256: sha256File(path.join(directory, 'result.json')),
      status: result.status, hook_event_count: result.hook_event_count, observer_event_count: upstream.events.length,
      process_samples: result.process_samples.length, external_socket_budget: 0, raw_material_persisted: false,
    }
    writeJson(path.join(directory, 'summary.json'), summary)
    writeJson(path.join(directory, 'normalized.json'), normalizeCapsule(directory))
    const sourceCount = Number(result.hook_event_count > 0) + Number(upstream.events.length > 0) + Number(result.process_samples.length > 0)
    return {
      run_id: runId, arm: input.arm, repetition: input.repetition, sequence_index: input.sequence_index, status: result.status,
      source_count: sourceCount, hook_event_count: result.hook_event_count, observer_event_count: upstream.events.length,
      process_samples: result.process_samples.length,
      observer_response_classes_sha256: sha256Bytes(canonicalJson(upstream.events.map((event) => event.response_class))),
    }
  } finally {
    await upstream.close()
  }
}

export async function runScenarioCampaign(options: CampaignOptions): Promise<Record<string, unknown>> {
  if (!/^[a-z0-9][a-z0-9-]{7,63}$/.test(options.campaign_id)) fail('invalid_campaign_id', 'campaign ID must be a bounded lowercase slug')
  validateScenarioRepetitions(options.repetitions)
  for (const [label, digest] of [['probe', options.expected_probe_sha256], ['recipe', options.probe_recipe_sha256], ['plan', options.plan_sha256], ['toolchain', options.toolchain_digest]]) {
    if (!/^[a-f0-9]{64}$/.test(digest)) fail('invalid_digest', `${label} digest must be SHA-256`)
  }
  if (sha256File(options.probe_entrypoint) !== options.expected_probe_sha256) fail('artifact_identity', 'probe artifact digest mismatch')
  const selected = options.pair_id === undefined ? [...SCENARIO_PAIRS] : SCENARIO_PAIRS.filter((pair) => pair.pair_id === options.pair_id)
  if (selected.length === 0) fail('invalid_pair_id', 'scenario pair ID is not recognized')
  const root = ensureEvidenceRoot(options.evidence_root)
  const output = assertEvidencePath(root, path.join(root, options.out_relative))
  if (existsSync(output)) fail('evidence_exists', 'campaign output path already exists')
  mkdirSync(output, { recursive: true, mode: 0o700 })
  const pairSummaries: Array<Record<string, unknown>> = []
  let executedCells = 0

  for (const pair of selected) {
    const pairIndex = SCENARIO_PAIRS.findIndex((candidate) => candidate.pair_id === pair.pair_id)
    const pairOutput = path.join(output, 'pairs', String(pairIndex).padStart(2, '0'))
    mkdirSync(pairOutput, { recursive: true, mode: 0o700 })
    const seed = Number.parseInt(sha256Bytes(pair.pair_id).slice(0, 8), 16)
    const order = balancedPairOrder(seed, options.repetitions)
    const runs: CampaignRunRecord[] = []
    for (let repetition = 0; repetition < options.repetitions; repetition += 1) {
      for (let position = 0; position < 2; position += 1) {
        const arm = order[repetition][position]
        runs.push(await runScenarioCell({ root, pair_output: pairOutput, pair, arm, repetition, sequence_index: repetition * 2 + position, seed, options }))
        executedCells += 1
      }
    }
    const classification = classifyScenarioPairRuns({ repetitions: options.repetitions, runs })
    const summary = {
      schema_version: 'oracle-lab-phase3a-scenario-pair-summary.v1',
      pair_id: pair.pair_id, control_scenario: 'anthropic', treatment_scenario: pair.treatment_label,
      repetitions: options.repetitions, seed, ...classification, runs,
      external_socket_budget: 0, raw_material_persisted: false,
    }
    writeJson(path.join(pairOutput, 'summary.json'), summary)
    pairSummaries.push(summary)
  }

  const statuses = pairSummaries.reduce<Record<string, number>>((counts, pair) => {
    const status = String(pair.status); counts[status] = (counts[status] ?? 0) + 1; return counts
  }, {})
  const summary = {
    schema_version: 'oracle-lab-phase3a-scenario-campaign.v1', campaign_id: options.campaign_id,
    scenario_pair_count: SCENARIO_PAIRS.length, selected_pair_count: pairSummaries.length, selected_pair_id: options.pair_id ?? null,
    repetitions: options.repetitions, executed_cells: executedCells, probe_artifact_sha256: options.expected_probe_sha256,
    probe_recipe_sha256: options.probe_recipe_sha256, statuses,
    pairs: pairSummaries.map((pair, index) => ({ index, pair_id: pair.pair_id, status: pair.status, effect: pair.effect })),
    external_socket_budget: 0, raw_material_persisted: false,
  }
  writeJson(path.join(output, 'summary.json'), summary)
  return summary
}

function args(argv: string[]): Record<string, string> {
  const output: Record<string, string> = {}; const values = argv[0] === '--' ? argv.slice(1) : argv
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, ''); const value = values[index + 1]
    if (!key || value === undefined) fail('invalid_arguments', 'scenario campaign arguments must be --key value pairs')
    output[key] = value
  }
  return output
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const values = args(process.argv.slice(2))
    const required = ['evidence-root', 'source-entrypoint', 'probe-entrypoint', 'expected-probe-sha256', 'probe-recipe-sha256', 'out-relative', 'campaign-id', 'cc-commit', 'cc-tree', 'sub2api-commit', 'sub2api-tree', 'plan-sha256', 'toolchain-digest']
    for (const key of required) if (!values[key]) fail('invalid_arguments', `--${key} is required`)
    const summary = await runScenarioCampaign({
      evidence_root: values['evidence-root'], source_entrypoint: path.resolve(values['source-entrypoint']), probe_entrypoint: path.resolve(values['probe-entrypoint']),
      expected_probe_sha256: values['expected-probe-sha256'], probe_recipe_sha256: values['probe-recipe-sha256'], out_relative: values['out-relative'],
      campaign_id: values['campaign-id'], repetitions: Number(values.repetitions ?? 5), cc_commit: values['cc-commit'], cc_tree: values['cc-tree'],
      sub2api_commit: values['sub2api-commit'], sub2api_tree: values['sub2api-tree'], plan_sha256: values['plan-sha256'], toolchain_digest: values['toolchain-digest'],
      pair_id: values['pair-id'],
    })
    process.stdout.write(`${canonicalJson(summary)}\n`)
  } catch (error) {
    process.stderr.write(`${canonicalJson(stableError(error))}\n`)
    process.exitCode = 1
  }
}
