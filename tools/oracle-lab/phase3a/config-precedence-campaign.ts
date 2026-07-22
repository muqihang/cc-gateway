import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { BASELINE_PROMPT, buildBaselineManifest } from './baseline-cell.js'
import { balancedPairOrder } from './converge.js'
import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'
import { buildIsolatedEnvironment, type LaunchManifest, validateLaunchManifest } from './launch-manifest.js'
import { normalizeCapsule } from './normalize.js'
import { startFakeUpstream, type ObserverStringReplacement } from './observers/fake-upstream.js'
import { runCell, runCellGuardSelfTest, type CellResult } from './run-cell.js'

type Arm = 'control' | 'treatment'
export type ConfigSource = 'user' | 'project' | 'local' | 'process-env'
type Upstream = 'A' | 'B'
type ObservedUpstream = Upstream | 'none' | 'both'

type ArmDefinition = {
  values: Partial<Record<ConfigSource, Upstream>>
  expected_upstream: Upstream
}

export type ConfigPrecedencePairDefinition = {
  pair_id: string
  comparison_mode: 'user-only-reachability' | 'precedence-override'
  precedence_contract: string
  control: ArmDefinition
  treatment: ArmDefinition
  expected_winner_source: Record<Arm, ConfigSource>
}

export type ConfigPrecedenceRunRecord = {
  arm: Arm
  repetition: number
  status: CellResult['status']
  observed_upstream: ObservedUpstream
  source_count: number
}

type CampaignRunRecord = ConfigPrecedenceRunRecord & {
  run_id: string
  sequence_index: number
  expected_upstream: Upstream
  expected_winner_source: ConfigSource
  upstream_a_events: number
  upstream_b_events: number
  preflight_upstream: ObservedUpstream
  process_samples: number
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

export const CONFIG_PRECEDENCE_PAIRS: readonly ConfigPrecedencePairDefinition[] = [
  {
    pair_id: 'config-precedence-user-vs-default',
    comparison_mode: 'user-only-reachability',
    precedence_contract: 'user settings supply ANTHROPIC_BASE_URL when no higher-precedence source is present',
    control: { values: { user: 'A' }, expected_upstream: 'A' },
    treatment: { values: { user: 'B' }, expected_upstream: 'B' },
    expected_winner_source: { control: 'user', treatment: 'user' },
  },
  {
    pair_id: 'config-precedence-project-vs-user',
    comparison_mode: 'precedence-override',
    precedence_contract: 'project settings override user settings',
    control: { values: { user: 'A' }, expected_upstream: 'A' },
    treatment: { values: { user: 'A', project: 'B' }, expected_upstream: 'B' },
    expected_winner_source: { control: 'user', treatment: 'project' },
  },
  {
    pair_id: 'config-precedence-local-vs-project',
    comparison_mode: 'precedence-override',
    precedence_contract: 'local project settings override shared project settings',
    control: { values: { project: 'A' }, expected_upstream: 'A' },
    treatment: { values: { project: 'A', local: 'B' }, expected_upstream: 'B' },
    expected_winner_source: { control: 'project', treatment: 'local' },
  },
  {
    pair_id: 'config-precedence-process-env-vs-local',
    comparison_mode: 'precedence-override',
    precedence_contract: 'local project settings control the request route while direct process environment controls preflight',
    control: { values: { local: 'A' }, expected_upstream: 'A' },
    treatment: { values: { local: 'A', 'process-env': 'B' }, expected_upstream: 'A' },
    expected_winner_source: { control: 'local', treatment: 'local' },
  },
]

const TERMINAL_OUTCOMES = new Set<CellResult['status']>(['complete', 'failed', 'timeout', 'resource-limit'])

function fail(code: string, message: string): never { throw new Phase3AError(code, message) }
function writeJson(file: string, value: unknown): void { writeFileSync(file, `${canonicalJson(value)}\n`, { flag: 'wx', mode: 0o600 }) }

export function validateConfigPrecedenceRepetitions(repetitions: number): number {
  if (!Number.isInteger(repetitions) || repetitions < 5 || repetitions > 12) fail('invalid_repetitions', 'config precedence campaign repetitions must be between 5 and 12')
  return repetitions
}

export function classifyConfigPrecedencePairRuns(input: {
  pair: ConfigPrecedencePairDefinition
  repetitions: number
  runs: ConfigPrecedenceRunRecord[]
}): {
  status: 'REPRODUCED' | 'UNKNOWN'
  effect: 'precedence-confirmed' | 'precedence-contradicted' | 'unresolved'
  stable: boolean
  control_winner_source: ConfigSource | null
  treatment_winner_source: ConfigSource | null
  terminal_cells: number
  dual_source_cells: number
  correctly_routed_cells: number
} {
  const repetitions = validateConfigPrecedenceRepetitions(input.repetitions)
  const byArm = (arm: Arm) => input.runs.filter((run) => run.arm === arm)
  const stableArm = (arm: Arm): boolean => {
    const observed = new Set(byArm(arm).map((run) => run.observed_upstream))
    return observed.size === 1 && (observed.has('A') || observed.has('B'))
  }
  const stable = stableArm('control') && stableArm('treatment')
  const completeSchedule = input.runs.length === repetitions * 2 && (['control', 'treatment'] as const).every((arm) => {
    const rows = byArm(arm).sort((left, right) => left.repetition - right.repetition)
    return rows.length === repetitions && rows.every((run, index) => run.repetition === index)
  })
  const terminalCells = input.runs.filter((run) => TERMINAL_OUTCOMES.has(run.status)).length
  const dualSourceCells = input.runs.filter((run) => Number.isInteger(run.source_count) && run.source_count >= 2).length
  const correctlyRoutedCells = input.runs.filter((run) => run.observed_upstream === input.pair[run.arm].expected_upstream).length
  const contradicted = input.runs.some((run) => (run.observed_upstream === 'A' || run.observed_upstream === 'B') && run.observed_upstream !== input.pair[run.arm].expected_upstream)
  const confirmed = stable && completeSchedule && terminalCells === repetitions * 2 && dualSourceCells === repetitions * 2 && correctlyRoutedCells === repetitions * 2
  return {
    status: confirmed ? 'REPRODUCED' : 'UNKNOWN',
    effect: confirmed ? 'precedence-confirmed' : contradicted ? 'precedence-contradicted' : 'unresolved',
    stable,
    control_winner_source: stableArm('control') && byArm('control').every((run) => run.observed_upstream === input.pair.control.expected_upstream) ? input.pair.expected_winner_source.control : null,
    treatment_winner_source: stableArm('treatment') && byArm('treatment').every((run) => run.observed_upstream === input.pair.treatment.expected_upstream) ? input.pair.expected_winner_source.treatment : null,
    terminal_cells: terminalCells,
    dual_source_cells: dualSourceCells,
    correctly_routed_cells: correctlyRoutedCells,
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

function pairManifest(input: {
  base: LaunchManifest
  pair: ConfigPrecedencePairDefinition
  arm: Arm
  run_id: string
  sequence_index: number
  seed: number
  probe_sha256: string
  probe_recipe_sha256: string
  upstream_a_url: string
  upstream_a_port: number
  upstream_b_url: string
  upstream_b_port: number
}): LaunchManifest {
  const arm = input.pair[input.arm]
  const allowlist = { ...input.base.environment.allowlist }
  delete allowlist.ANTHROPIC_BASE_URL
  delete allowlist.CLAUDE_CODE_API_BASE_URL
  allowlist.ANTHROPIC_API_KEY = 'oracle-phase3a-placeholder:config-precedence'
  const unset = [...new Set([...input.base.environment.unset, 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_API_BASE_URL'])]
  if (arm.values['process-env']) {
    allowlist.ANTHROPIC_BASE_URL = arm.values['process-env'] === 'A' ? input.upstream_a_url.replace(/\/$/, '') : input.upstream_b_url.replace(/\/$/, '')
    unset.splice(unset.indexOf('ANTHROPIC_BASE_URL'), 1)
  }
  return validateLaunchManifest({
    ...structuredClone(input.base),
    run_id: input.run_id,
    pair_id: input.pair.pair_id,
    sequence_index: input.sequence_index,
    randomization_seed: input.seed,
    hypothesis_id: `${input.pair.pair_id}-winner`,
    evidence_level_ceiling: 'Reproduced',
    artifact: { ...input.base.artifact, entrypoint_sha256: input.probe_sha256 },
    command: { ...input.base.command, executable_sha256: input.probe_sha256, cwd: `runs/${input.run_id}/cwd` },
    environment: {
      ...input.base.environment,
      allowlist,
      unset: unset.sort(),
      home: `runs/${input.run_id}/home`,
      xdg: `runs/${input.run_id}/xdg`,
      tmp: `runs/${input.run_id}/tmp`,
      base_urls: [input.upstream_a_url.replace(/\/$/, ''), input.upstream_b_url.replace(/\/$/, '')].sort(),
    },
    network: {
      ...input.base.network,
      loopback_ports: [input.upstream_a_port, input.upstream_b_port].sort((left, right) => left - right),
      external_socket_budget: 0,
    },
    matrix: {
      changed_variable: 'claude-code-config-precedence',
      control_value: input.pair.control.values,
      treatment_value: input.pair.treatment.values,
      fixed_variables: {
        ...input.base.matrix.fixed_variables,
        precedence_contract: input.pair.precedence_contract,
        expected_winner_source: input.pair.expected_winner_source,
        probe_recipe_sha256: input.probe_recipe_sha256,
        instrumentation: 'none',
        sandbox_guard: 'exact-profile-same-scope',
      },
    },
    capture: { ...input.base.capture, hook: false, inspector: false, process: true, fs: true, network: true, http: true },
  })
}

function prepareConfigFiles(root: string, manifest: LaunchManifest, definition: ArmDefinition, urls: Record<Upstream, string>): Record<string, string> {
  const { directories } = buildIsolatedEnvironment(manifest, root)
  const projectConfig = path.join(directories.cwd, '.claude')
  mkdirSync(projectConfig, { recursive: true, mode: 0o700 })
  const files: Partial<Record<Exclude<ConfigSource, 'process-env'>, string>> = {
    user: path.join(directories.home, '.claude', 'settings.json'),
    project: path.join(projectConfig, 'settings.json'),
    local: path.join(projectConfig, 'settings.local.json'),
  }
  const digests: Record<string, string> = {}
  for (const source of ['user', 'project', 'local'] as const) {
    const upstream = definition.values[source]
    if (!upstream) continue
    const file = files[source]!
    writeJson(file, { env: { ANTHROPIC_BASE_URL: urls[upstream].replace(/\/$/, '') } })
    digests[source] = sha256File(file)
  }
  if (definition.values['process-env']) digests['process-env'] = sha256Bytes(urls[definition.values['process-env']].replace(/\/$/, ''))
  return digests
}

function observedUpstream(aEvents: number, bEvents: number): ObservedUpstream {
  if (aEvents > 0 && bEvents > 0) return 'both'
  if (aEvents > 0) return 'A'
  if (bEvents > 0) return 'B'
  return 'none'
}

export function classifyConfigRouting(
  aEvents: Array<{ request_class?: unknown }>,
  bEvents: Array<{ request_class?: unknown }>,
): { request_upstream: ObservedUpstream; preflight_upstream: ObservedUpstream } {
  const count = (events: Array<{ request_class?: unknown }>, requestClass: string): number => events.filter((event) => event.request_class === requestClass).length
  return {
    request_upstream: observedUpstream(count(aEvents, 'messages'), count(bEvents, 'messages')),
    preflight_upstream: observedUpstream(count(aEvents, 'root'), count(bEvents, 'root')),
  }
}

async function runConfigCell(input: {
  root: string
  pair_output: string
  pair: ConfigPrecedencePairDefinition
  arm: Arm
  repetition: number
  sequence_index: number
  seed: number
  options: CampaignOptions
}): Promise<CampaignRunRecord> {
  const pairIndex = CONFIG_PRECEDENCE_PAIRS.findIndex((pair) => pair.pair_id === input.pair.pair_id)
  const runId = `${input.options.campaign_id}-p${String(pairIndex).padStart(2, '0')}-r${input.repetition}-${input.arm}`
  if (existsSync(path.join(input.root, 'runs', runId))) fail('evidence_exists', 'isolated run root already exists')
  const replacements = observerReplacements(input.root, runId)
  const upstreamA = await startFakeUpstream({ scenario: { kind: 'anthropic' }, max_body_bytes: 8 * 1024 * 1024, string_replacements: replacements })
  let upstreamB: Awaited<ReturnType<typeof startFakeUpstream>>
  try {
    upstreamB = await startFakeUpstream({ scenario: { kind: 'anthropic' }, max_body_bytes: 8 * 1024 * 1024, string_replacements: replacements })
  } catch (error) {
    await upstreamA.close()
    throw error
  }
  try {
    const base = buildBaselineManifest({
      evidence_root: input.root,
      entrypoint: input.options.source_entrypoint,
      out_relative: input.options.out_relative,
      run_id: `${runId}-base`,
      cc_commit: input.options.cc_commit,
      cc_tree: input.options.cc_tree,
      sub2api_commit: input.options.sub2api_commit,
      sub2api_tree: input.options.sub2api_tree,
      plan_sha256: input.options.plan_sha256,
      toolchain_digest: input.options.toolchain_digest,
      command_profile: 'full',
    }, upstreamA.url, upstreamA.port)
    const manifest = pairManifest({
      base, pair: input.pair, arm: input.arm, run_id: runId, sequence_index: input.sequence_index, seed: input.seed,
      probe_sha256: input.options.expected_probe_sha256, probe_recipe_sha256: input.options.probe_recipe_sha256,
      upstream_a_url: upstreamA.url, upstream_a_port: upstreamA.port, upstream_b_url: upstreamB.url, upstream_b_port: upstreamB.port,
    })
    const directory = path.join(input.pair_output, `r${String(input.repetition).padStart(2, '0')}`, input.arm)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const configDigests = prepareConfigFiles(input.root, manifest, input.pair[input.arm], { A: upstreamA.url, B: upstreamB.url })
    const guard = await runCellGuardSelfTest(manifest, input.root)
    writeJson(path.join(directory, 'manifest.json'), manifest)
    writeJson(path.join(directory, 'guard.json'), guard)
    writeJson(path.join(directory, 'config-inputs.json'), {
      schema_version: 'oracle-lab-phase3a-config-inputs.v1', configured_sources: input.pair[input.arm].values,
      expected_winner_source: input.pair.expected_winner_source[input.arm], expected_upstream: input.pair[input.arm].expected_upstream,
      file_sha256: configDigests, raw_material_persisted: false,
    })
    const result = await runCell({ manifest, evidence_root: input.root, executable: input.options.probe_entrypoint, instrumentation: 'none', guard, stdin: BASELINE_PROMPT })
    const events = [
      ...upstreamA.events.map((event) => ({ ...event, observed_upstream: 'A' as const })),
      ...upstreamB.events.map((event) => ({ ...event, observed_upstream: 'B' as const })),
    ].map((event, sequence) => ({ ...event, sequence }))
    writeJson(path.join(directory, 'observer.json'), {
      schema_version: 'oracle-lab-phase3a-safe-config-precedence-observer.v1',
      normalization: { A: upstreamA.normalization, B: upstreamB.normalization }, raw_material_persisted: false, events,
    })
    writeJson(path.join(directory, 'result.json'), result)
    const routing = classifyConfigRouting(upstreamA.events, upstreamB.events)
    const summary = {
      schema_version: 'oracle-lab-phase3a-config-precedence-cell-summary.v1', run_id: runId, pair_id: input.pair.pair_id,
      arm: input.arm, repetition: input.repetition, expected_winner_source: input.pair.expected_winner_source[input.arm],
      expected_upstream: input.pair[input.arm].expected_upstream, observed_upstream: routing.request_upstream,
      preflight_upstream: routing.preflight_upstream,
      manifest_sha256: sha256File(path.join(directory, 'manifest.json')), guard_sha256: sha256File(path.join(directory, 'guard.json')),
      observer_sha256: sha256File(path.join(directory, 'observer.json')), result_sha256: sha256File(path.join(directory, 'result.json')),
      config_inputs_sha256: sha256File(path.join(directory, 'config-inputs.json')), status: result.status,
      upstream_a_events: upstreamA.events.length, upstream_b_events: upstreamB.events.length, process_samples: result.process_samples.length,
      instrumentation: 'none', external_socket_budget: 0, raw_material_persisted: false,
    }
    writeJson(path.join(directory, 'summary.json'), summary)
    writeJson(path.join(directory, 'normalized.json'), normalizeCapsule(directory))
    const sourceCount = Number(events.length > 0) + Number(result.process_samples.length > 0)
    return {
      run_id: runId, arm: input.arm, repetition: input.repetition, sequence_index: input.sequence_index, status: result.status,
      expected_upstream: input.pair[input.arm].expected_upstream, expected_winner_source: input.pair.expected_winner_source[input.arm],
      observed_upstream: routing.request_upstream, preflight_upstream: routing.preflight_upstream, source_count: sourceCount, upstream_a_events: upstreamA.events.length,
      upstream_b_events: upstreamB.events.length, process_samples: result.process_samples.length,
    }
  } finally {
    await Promise.all([upstreamA.close(), upstreamB.close()])
  }
}

export async function runConfigPrecedenceCampaign(options: CampaignOptions): Promise<Record<string, unknown>> {
  if (!/^[a-z0-9][a-z0-9-]{7,63}$/.test(options.campaign_id)) fail('invalid_campaign_id', 'campaign ID must be a bounded lowercase slug')
  validateConfigPrecedenceRepetitions(options.repetitions)
  for (const [label, digest] of [['probe', options.expected_probe_sha256], ['recipe', options.probe_recipe_sha256], ['plan', options.plan_sha256], ['toolchain', options.toolchain_digest]]) {
    if (!/^[a-f0-9]{64}$/.test(digest)) fail('invalid_digest', `${label} digest must be SHA-256`)
  }
  if (sha256File(options.probe_entrypoint) !== options.expected_probe_sha256) fail('artifact_identity', 'probe artifact digest mismatch')
  const selected = options.pair_id === undefined || options.pair_id === 'all'
    ? [...CONFIG_PRECEDENCE_PAIRS]
    : CONFIG_PRECEDENCE_PAIRS.filter((pair) => pair.pair_id === options.pair_id)
  if (selected.length === 0) fail('invalid_pair_id', 'config precedence pair ID is not recognized')
  const root = ensureEvidenceRoot(options.evidence_root)
  const output = assertEvidencePath(root, path.join(root, options.out_relative))
  if (existsSync(output)) fail('evidence_exists', 'campaign output path already exists')
  mkdirSync(output, { recursive: true, mode: 0o700 })
  const pairSummaries: Array<Record<string, unknown>> = []
  let executedCells = 0

  for (const pair of selected) {
    const pairIndex = CONFIG_PRECEDENCE_PAIRS.findIndex((candidate) => candidate.pair_id === pair.pair_id)
    const pairOutput = path.join(output, 'pairs', String(pairIndex).padStart(2, '0'))
    mkdirSync(pairOutput, { recursive: true, mode: 0o700 })
    const seed = Number.parseInt(sha256Bytes(pair.pair_id).slice(0, 8), 16)
    const order = balancedPairOrder(seed, options.repetitions)
    const runs: CampaignRunRecord[] = []
    for (let repetition = 0; repetition < options.repetitions; repetition += 1) {
      for (let position = 0; position < 2; position += 1) {
        const arm = order[repetition][position]
        runs.push(await runConfigCell({ root, pair_output: pairOutput, pair, arm, repetition, sequence_index: repetition * 2 + position, seed, options }))
        executedCells += 1
      }
    }
    const classified = classifyConfigPrecedencePairRuns({ pair, repetitions: options.repetitions, runs })
    const summary = {
      schema_version: 'oracle-lab-phase3a-config-precedence-pair-summary.v1', pair_id: pair.pair_id,
      comparison_mode: pair.comparison_mode, precedence_contract: pair.precedence_contract,
      expected_winner_source: pair.expected_winner_source, repetitions: options.repetitions, seed, ...classified, runs,
      instrumentation: 'none', external_socket_budget: 0, raw_material_persisted: false,
    }
    writeJson(path.join(pairOutput, 'summary.json'), summary)
    pairSummaries.push(summary)
  }

  const statuses = pairSummaries.reduce<Record<string, number>>((counts, pair) => {
    const status = String(pair.status); counts[status] = (counts[status] ?? 0) + 1; return counts
  }, {})
  const summary = {
    schema_version: 'oracle-lab-phase3a-config-precedence-campaign.v1', campaign_id: options.campaign_id,
    config_pair_count: CONFIG_PRECEDENCE_PAIRS.length, selected_pair_count: pairSummaries.length,
    selected_pair_id: options.pair_id ?? 'all', repetitions: options.repetitions, executed_cells: executedCells,
    probe_artifact_sha256: options.expected_probe_sha256, probe_recipe_sha256: options.probe_recipe_sha256, statuses,
    pairs: pairSummaries.map((pair, index) => ({ index, pair_id: pair.pair_id, status: pair.status, effect: pair.effect })),
    isolation: { fresh_home: true, fresh_xdg: true, fresh_tmp: true, fresh_cwd: true },
    fake_upstreams_per_cell: 2, instrumentation: 'none', external_socket_budget: 0, raw_material_persisted: false,
  }
  writeJson(path.join(output, 'summary.json'), summary)
  return summary
}

function args(argv: string[]): Record<string, string> {
  const output: Record<string, string> = {}; const values = argv[0] === '--' ? argv.slice(1) : argv
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, ''); const value = values[index + 1]
    if (!key || value === undefined) fail('invalid_arguments', 'config precedence campaign arguments must be --key value pairs')
    output[key] = value
  }
  return output
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const values = args(process.argv.slice(2))
    const required = ['evidence-root', 'source-entrypoint', 'probe-entrypoint', 'expected-probe-sha256', 'probe-recipe-sha256', 'out-relative', 'campaign-id', 'cc-commit', 'cc-tree', 'sub2api-commit', 'sub2api-tree', 'plan-sha256', 'toolchain-digest']
    for (const key of required) if (!values[key]) fail('invalid_arguments', `--${key} is required`)
    const summary = await runConfigPrecedenceCampaign({
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
