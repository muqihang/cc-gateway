import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { BASELINE_PROMPT, buildBaselineManifest } from './baseline-cell.js'
import { balancedPairOrder } from './converge.js'
import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'
import { type LaunchManifest, validateLaunchManifest } from './launch-manifest.js'
import { normalizeCapsule } from './normalize.js'
import { startFakeUpstream, type ObserverHeaderMarker, type ObserverStringReplacement, type SafeUpstreamEvent } from './observers/fake-upstream.js'
import { runCell, runCellGuardSelfTest, type CellResult } from './run-cell.js'

type Arm = 'control' | 'treatment'
type CredentialVariable = 'ANTHROPIC_API_KEY' | 'ANTHROPIC_AUTH_TOKEN'
type CredentialClass = 'api-key-a' | 'api-key-b' | 'auth-token-a' | 'auth-token-b'
type AuthObservation = string

type ArmDefinition = {
  credentials: Partial<Record<CredentialVariable, CredentialClass>>
  expected_observation: AuthObservation | null
  admissible_observations: AuthObservation[]
  expected_status: 'complete' | 'failed'
}

export type AuthLifecyclePairDefinition = {
  pair_id: string
  comparison_mode: 'rotation' | 'empirical-coexistence' | 'missing-credential'
  lifecycle_contract: string
  control: ArmDefinition
  treatment: ArmDefinition
}

export type AuthLifecycleRunRecord = {
  arm: Arm
  repetition: number
  status: CellResult['status']
  observed_credential: AuthObservation
  source_count: number
}

type CampaignRunRecord = AuthLifecycleRunRecord & {
  run_id: string
  sequence_index: number
  observer_events: number
  process_samples: number
  hook_event_count: number
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

export const AUTH_LIFECYCLE_PAIRS: readonly AuthLifecyclePairDefinition[] = [
  {
    pair_id: 'auth-api-key-rotation',
    comparison_mode: 'rotation',
    lifecycle_contract: 'rotating ANTHROPIC_API_KEY rotates the observed x-api-key class',
    control: { credentials: { ANTHROPIC_API_KEY: 'api-key-a' }, expected_observation: 'x-api-key:api-key-a', admissible_observations: ['x-api-key:api-key-a'], expected_status: 'complete' },
    treatment: { credentials: { ANTHROPIC_API_KEY: 'api-key-b' }, expected_observation: 'x-api-key:api-key-b', admissible_observations: ['x-api-key:api-key-b'], expected_status: 'complete' },
  },
  {
    pair_id: 'auth-token-rotation',
    comparison_mode: 'rotation',
    lifecycle_contract: 'rotating ANTHROPIC_AUTH_TOKEN rotates the observed authorization Bearer class',
    control: { credentials: { ANTHROPIC_AUTH_TOKEN: 'auth-token-a' }, expected_observation: 'authorization:auth-token-a', admissible_observations: ['authorization:auth-token-a'], expected_status: 'complete' },
    treatment: { credentials: { ANTHROPIC_AUTH_TOKEN: 'auth-token-b' }, expected_observation: 'authorization:auth-token-b', admissible_observations: ['authorization:auth-token-b'], expected_status: 'complete' },
  },
  {
    pair_id: 'auth-credential-coexistence',
    comparison_mode: 'empirical-coexistence',
    lifecycle_contract: 'coexisting API key and auth token send both credential headers with stable distinguishable classes',
    control: {
      credentials: { ANTHROPIC_API_KEY: 'api-key-a', ANTHROPIC_AUTH_TOKEN: 'auth-token-a' }, expected_observation: null,
      admissible_observations: ['authorization:auth-token-a+x-api-key:api-key-a'], expected_status: 'complete',
    },
    treatment: {
      credentials: { ANTHROPIC_API_KEY: 'api-key-b', ANTHROPIC_AUTH_TOKEN: 'auth-token-b' }, expected_observation: null,
      admissible_observations: ['authorization:auth-token-b+x-api-key:api-key-b'], expected_status: 'complete',
    },
  },
  {
    pair_id: 'auth-missing-credential',
    comparison_mode: 'missing-credential',
    lifecycle_contract: 'removing all credentials produces a process failure and no credential-bearing loopback request',
    control: { credentials: { ANTHROPIC_API_KEY: 'api-key-a' }, expected_observation: 'x-api-key:api-key-a', admissible_observations: ['x-api-key:api-key-a'], expected_status: 'complete' },
    treatment: { credentials: {}, expected_observation: 'none', admissible_observations: ['none'], expected_status: 'failed' },
  },
]

const PLACEHOLDERS: Record<CredentialClass, string> = {
  'api-key-a': 'oracle-phase3a-placeholder:auth-api-key-a',
  'api-key-b': 'oracle-phase3a-placeholder:auth-api-key-b',
  'auth-token-a': 'oracle-phase3a-placeholder:auth-token-a',
  'auth-token-b': 'oracle-phase3a-placeholder:auth-token-b',
}
const OBSERVED_CLASSES = new Set<CredentialClass>(Object.keys(PLACEHOLDERS) as CredentialClass[])
const TERMINAL_OUTCOMES = new Set<CellResult['status']>(['complete', 'failed', 'timeout', 'resource-limit'])

function fail(code: string, message: string): never { throw new Phase3AError(code, message) }
function writeJson(file: string, value: unknown): void { writeFileSync(file, `${canonicalJson(value)}\n`, { flag: 'wx', mode: 0o600 }) }

export function validateAuthLifecycleRepetitions(repetitions: number): number {
  if (!Number.isInteger(repetitions) || repetitions < 5 || repetitions > 12) fail('invalid_repetitions', 'auth lifecycle campaign repetitions must be between 5 and 12')
  return repetitions
}

export function observeAuthCredential(events: Array<{ header_value_classes?: Record<string, string> }>): AuthObservation {
  const observed = new Set<string>()
  for (const event of events) {
    for (const header of ['authorization', 'x-api-key'] as const) {
      const valueClass = event.header_value_classes?.[header]
      if (valueClass && OBSERVED_CLASSES.has(valueClass as CredentialClass)) observed.add(`${header}:${valueClass}`)
    }
  }
  if (observed.size === 0) return 'none'
  return [...observed].sort().join('+')
}

export function authSourceCount(input: { hook: number; observer: number; process: number }): number {
  return Number(input.hook > 0) + Number(input.observer > 0) + Number(input.process > 0)
}

export function classifyAuthLifecyclePairRuns(input: {
  pair: AuthLifecyclePairDefinition
  repetitions: number
  runs: AuthLifecycleRunRecord[]
}): {
  status: 'REPRODUCED' | 'UNKNOWN'
  effect: 'credential-rotation-observed' | 'stable-selection-observed' | 'missing-credential-failure-observed' | 'unresolved'
  stable: boolean
  control_observation: string | null
  treatment_observation: string | null
  terminal_cells: number
  dual_source_cells: number
  correctly_classified_cells: number
} {
  const repetitions = validateAuthLifecycleRepetitions(input.repetitions)
  const byArm = (arm: Arm): AuthLifecycleRunRecord[] => input.runs.filter((run) => run.arm === arm)
  const stableObservation = (arm: Arm): string | null => {
    const observed = new Set(byArm(arm).map((run) => run.observed_credential))
    return observed.size === 1 ? [...observed][0] : null
  }
  const controlObservation = stableObservation('control')
  const treatmentObservation = stableObservation('treatment')
  const stable = controlObservation !== null && treatmentObservation !== null
  const completeSchedule = input.runs.length === repetitions * 2 && (['control', 'treatment'] as const).every((arm) => {
    const rows = byArm(arm).sort((left, right) => left.repetition - right.repetition)
    return rows.length === repetitions && rows.every((run, index) => run.repetition === index)
  })
  const terminalCells = input.runs.filter((run) => TERMINAL_OUTCOMES.has(run.status)).length
  const dualSourceCells = input.runs.filter((run) => Number.isInteger(run.source_count) && run.source_count >= 2).length
  const correctlyClassifiedCells = input.runs.filter((run) => {
    const definition = input.pair[run.arm]
    return run.status === definition.expected_status && definition.admissible_observations.includes(run.observed_credential)
  }).length
  const observationsDistinct = controlObservation !== treatmentObservation
  const reproduced = stable && completeSchedule && observationsDistinct && terminalCells === repetitions * 2
    && dualSourceCells === repetitions * 2 && correctlyClassifiedCells === repetitions * 2
  const effect = !reproduced ? 'unresolved'
    : input.pair.comparison_mode === 'rotation' ? 'credential-rotation-observed'
      : input.pair.comparison_mode === 'empirical-coexistence' ? 'stable-selection-observed'
        : 'missing-credential-failure-observed'
  return {
    status: reproduced ? 'REPRODUCED' : 'UNKNOWN', effect, stable,
    control_observation: controlObservation, treatment_observation: treatmentObservation,
    terminal_cells: terminalCells, dual_source_cells: dualSourceCells, correctly_classified_cells: correctlyClassifiedCells,
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

function headerMarkers(): ObserverHeaderMarker[] {
  return [
    { header_name: 'x-api-key', value: PLACEHOLDERS['api-key-a'], value_class: 'api-key-a' },
    { header_name: 'x-api-key', value: PLACEHOLDERS['api-key-b'], value_class: 'api-key-b' },
    { header_name: 'authorization', value: `Bearer ${PLACEHOLDERS['auth-token-a']}`, value_class: 'auth-token-a' },
    { header_name: 'authorization', value: `Bearer ${PLACEHOLDERS['auth-token-b']}`, value_class: 'auth-token-b' },
  ]
}

function authManifest(input: {
  base: LaunchManifest
  pair: AuthLifecyclePairDefinition
  arm: Arm
  run_id: string
  sequence_index: number
  seed: number
  probe_sha256: string
  probe_recipe_sha256: string
  upstream_url: string
  upstream_port: number
}): LaunchManifest {
  const definition = input.pair[input.arm]
  const allowlist = { ...input.base.environment.allowlist }
  delete allowlist.ANTHROPIC_API_KEY
  delete allowlist.ANTHROPIC_AUTH_TOKEN
  for (const [name, credentialClass] of Object.entries(definition.credentials) as Array<[CredentialVariable, CredentialClass]>) {
    allowlist[name] = PLACEHOLDERS[credentialClass]
  }
  const credentialVariables: CredentialVariable[] = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']
  const unset = [...new Set([...input.base.environment.unset, ...credentialVariables])]
    .filter((name) => !Object.hasOwn(definition.credentials, name)).sort()
  return validateLaunchManifest({
    ...structuredClone(input.base),
    run_id: input.run_id,
    pair_id: input.pair.pair_id,
    sequence_index: input.sequence_index,
    randomization_seed: input.seed,
    hypothesis_id: `${input.pair.pair_id}-lifecycle`,
    evidence_level_ceiling: 'Reproduced',
    artifact: { ...input.base.artifact, entrypoint_sha256: input.probe_sha256 },
    command: { ...input.base.command, executable_sha256: input.probe_sha256, cwd: `runs/${input.run_id}/cwd` },
    environment: {
      ...input.base.environment,
      allowlist,
      explicit_empty: input.base.environment.explicit_empty.filter((name) => !credentialVariables.includes(name as CredentialVariable)),
      unset,
      home: `runs/${input.run_id}/home`,
      xdg: `runs/${input.run_id}/xdg`,
      tmp: `runs/${input.run_id}/tmp`,
      base_urls: [input.upstream_url.replace(/\/$/, '')],
    },
    network: { ...input.base.network, loopback_ports: [input.upstream_port], external_socket_budget: 0 },
    matrix: {
      changed_variable: 'claude-code-auth-lifecycle',
      control_value: input.pair.control.credentials,
      treatment_value: input.pair.treatment.credentials,
      fixed_variables: {
        ...input.base.matrix.fixed_variables,
        lifecycle_contract: input.pair.lifecycle_contract,
        comparison_mode: input.pair.comparison_mode,
        probe_recipe_sha256: input.probe_recipe_sha256,
        probe_artifact: 'patched-copy',
        instrumentation: 'none',
        sandbox_guard: 'exact-profile-same-scope',
      },
    },
    capture: { ...input.base.capture, hook: true, inspector: false, process: true, fs: true, network: true, http: true },
  })
}

async function runAuthCell(input: {
  root: string
  pair_output: string
  pair: AuthLifecyclePairDefinition
  arm: Arm
  repetition: number
  sequence_index: number
  seed: number
  options: CampaignOptions
}): Promise<CampaignRunRecord> {
  const pairIndex = AUTH_LIFECYCLE_PAIRS.findIndex((pair) => pair.pair_id === input.pair.pair_id)
  const runId = `${input.options.campaign_id}-p${String(pairIndex).padStart(2, '0')}-r${input.repetition}-${input.arm}`
  if (existsSync(path.join(input.root, 'runs', runId))) fail('evidence_exists', 'isolated run root already exists')
  const upstream = await startFakeUpstream({
    scenario: { kind: 'anthropic' }, max_body_bytes: 8 * 1024 * 1024,
    string_replacements: observerReplacements(input.root, runId), header_markers: headerMarkers(),
  })
  try {
    const base = buildBaselineManifest({
      evidence_root: input.root, entrypoint: input.options.source_entrypoint, out_relative: input.options.out_relative,
      run_id: `${runId}-base`, cc_commit: input.options.cc_commit, cc_tree: input.options.cc_tree,
      sub2api_commit: input.options.sub2api_commit, sub2api_tree: input.options.sub2api_tree,
      plan_sha256: input.options.plan_sha256, toolchain_digest: input.options.toolchain_digest, command_profile: 'full',
    }, upstream.url, upstream.port)
    const manifest = authManifest({
      base, pair: input.pair, arm: input.arm, run_id: runId, sequence_index: input.sequence_index, seed: input.seed,
      probe_sha256: input.options.expected_probe_sha256, probe_recipe_sha256: input.options.probe_recipe_sha256,
      upstream_url: upstream.url, upstream_port: upstream.port,
    })
    const directory = path.join(input.pair_output, `r${String(input.repetition).padStart(2, '0')}`, input.arm)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const guard = await runCellGuardSelfTest(manifest, input.root)
    writeJson(path.join(directory, 'manifest.json'), manifest)
    writeJson(path.join(directory, 'guard.json'), guard)
    const result = await runCell({ manifest, evidence_root: input.root, executable: input.options.probe_entrypoint, instrumentation: 'none', guard, stdin: BASELINE_PROMPT })
    const observer = {
      schema_version: 'oracle-lab-phase3a-safe-auth-lifecycle-observer.v1', normalization: upstream.normalization,
      evidence_source: 'loopback-http-observer', raw_material_persisted: false, events: upstream.events,
    }
    writeJson(path.join(directory, 'observer.json'), observer)
    writeJson(path.join(directory, 'result.json'), result)
    const observedCredential = observeAuthCredential(upstream.events)
    const sourceCount = authSourceCount({ hook: result.hook_event_count, observer: upstream.events.length, process: result.process_samples.length })
    const evidenceSources = [
      ...(result.hook_event_count > 0 ? ['hook'] : []),
      ...(upstream.events.length > 0 ? ['observer'] : []),
      ...(result.process_samples.length > 0 ? ['process'] : []),
    ]
    const summary = {
      schema_version: 'oracle-lab-phase3a-auth-lifecycle-cell-summary.v1', run_id: runId, pair_id: input.pair.pair_id,
      arm: input.arm, repetition: input.repetition, observed_credential: observedCredential, status: result.status,
      evidence_sources: evidenceSources, source_count: sourceCount, observer_events: upstream.events.length,
      process_samples: result.process_samples.length, hook_event_count: result.hook_event_count, manifest_sha256: sha256File(path.join(directory, 'manifest.json')),
      guard_sha256: sha256File(path.join(directory, 'guard.json')), observer_sha256: sha256File(path.join(directory, 'observer.json')),
      result_sha256: sha256File(path.join(directory, 'result.json')), instrumentation: 'none', external_socket_budget: 0,
      raw_material_persisted: false,
    }
    writeJson(path.join(directory, 'summary.json'), summary)
    const normalized = normalizeCapsule(directory)
    writeJson(path.join(directory, 'normalized.json'), normalized)
    return {
      run_id: runId, arm: input.arm, repetition: input.repetition, sequence_index: input.sequence_index,
      status: result.status, observed_credential: observedCredential, source_count: sourceCount,
      observer_events: upstream.events.length, process_samples: result.process_samples.length, hook_event_count: result.hook_event_count,
    }
  } finally { await upstream.close() }
}

export async function runAuthLifecycleCampaign(options: CampaignOptions): Promise<Record<string, unknown>> {
  if (!/^[a-z0-9][a-z0-9-]{7,63}$/.test(options.campaign_id)) fail('invalid_campaign_id', 'campaign ID must be a bounded lowercase slug')
  validateAuthLifecycleRepetitions(options.repetitions)
  for (const [label, digest] of [['probe', options.expected_probe_sha256], ['recipe', options.probe_recipe_sha256], ['plan', options.plan_sha256], ['toolchain', options.toolchain_digest]]) {
    if (!/^[a-f0-9]{64}$/.test(digest)) fail('invalid_digest', `${label} digest must be SHA-256`)
  }
  if (sha256File(options.probe_entrypoint) !== options.expected_probe_sha256) fail('artifact_identity', 'patched probe artifact digest mismatch')
  const selected = options.pair_id === undefined || options.pair_id === 'all'
    ? [...AUTH_LIFECYCLE_PAIRS]
    : AUTH_LIFECYCLE_PAIRS.filter((pair) => pair.pair_id === options.pair_id)
  if (selected.length === 0) fail('invalid_pair_id', 'auth lifecycle pair ID is not recognized')
  const root = ensureEvidenceRoot(options.evidence_root)
  const output = assertEvidencePath(root, path.join(root, options.out_relative))
  if (existsSync(output)) fail('evidence_exists', 'campaign output path already exists')
  mkdirSync(output, { recursive: true, mode: 0o700 })
  const pairSummaries: Array<Record<string, unknown>> = []
  let executedCells = 0

  for (const pair of selected) {
    const pairIndex = AUTH_LIFECYCLE_PAIRS.findIndex((candidate) => candidate.pair_id === pair.pair_id)
    const pairOutput = path.join(output, 'pairs', String(pairIndex).padStart(2, '0'))
    mkdirSync(pairOutput, { recursive: true, mode: 0o700 })
    const seed = Number.parseInt(sha256Bytes(pair.pair_id).slice(0, 8), 16)
    const order = balancedPairOrder(seed, options.repetitions)
    const runs: CampaignRunRecord[] = []
    for (let repetition = 0; repetition < options.repetitions; repetition += 1) {
      for (let position = 0; position < 2; position += 1) {
        const arm = order[repetition][position]
        runs.push(await runAuthCell({ root, pair_output: pairOutput, pair, arm, repetition, sequence_index: repetition * 2 + position, seed, options }))
        executedCells += 1
      }
    }
    const classified = classifyAuthLifecyclePairRuns({ pair, repetitions: options.repetitions, runs })
    const summary = {
      schema_version: 'oracle-lab-phase3a-auth-lifecycle-pair-summary.v1', pair_id: pair.pair_id,
      comparison_mode: pair.comparison_mode, lifecycle_contract: pair.lifecycle_contract, repetitions: options.repetitions,
      seed, ...classified, runs, evidence_sources: ['observer', 'process'], instrumentation: 'none',
      external_socket_budget: 0, raw_material_persisted: false,
    }
    writeJson(path.join(pairOutput, 'summary.json'), summary)
    pairSummaries.push(summary)
  }

  const statuses = pairSummaries.reduce<Record<string, number>>((counts, pair) => {
    const status = String(pair.status); counts[status] = (counts[status] ?? 0) + 1; return counts
  }, {})
  const summary = {
    schema_version: 'oracle-lab-phase3a-auth-lifecycle-campaign.v1', campaign_id: options.campaign_id,
    auth_pair_count: AUTH_LIFECYCLE_PAIRS.length, selected_pair_count: pairSummaries.length,
    selected_pair_id: options.pair_id ?? 'all', repetitions: options.repetitions, executed_cells: executedCells,
    probe_artifact_sha256: options.expected_probe_sha256, probe_recipe_sha256: options.probe_recipe_sha256, statuses,
    pairs: pairSummaries.map((pair, index) => ({ index, pair_id: pair.pair_id, status: pair.status, effect: pair.effect })),
    isolation: { fresh_home: true, fresh_xdg: true, fresh_tmp: true, fresh_cwd: true },
    evidence_sources: ['observer', 'process'], fake_upstreams_per_cell: 1, instrumentation: 'none',
    exact_guard: true, external_socket_budget: 0, raw_material_persisted: false,
  }
  writeJson(path.join(output, 'summary.json'), summary)
  return summary
}

function args(argv: string[]): Record<string, string> {
  const output: Record<string, string> = {}
  const values = argv[0] === '--' ? argv.slice(1) : argv
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith('--') || !values[index + 1]) fail('invalid_arguments', 'arguments must be --name value pairs')
    output[values[index].slice(2)] = values[index + 1]
  }
  return output
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const values = args(process.argv.slice(2))
    const required = ['evidence-root', 'source-entrypoint', 'probe-entrypoint', 'expected-probe-sha256', 'probe-recipe-sha256', 'out-relative', 'campaign-id', 'cc-commit', 'cc-tree', 'sub2api-commit', 'sub2api-tree', 'plan-sha256', 'toolchain-digest']
    for (const key of required) if (!values[key]) fail('invalid_arguments', `--${key} is required`)
    const summary = await runAuthLifecycleCampaign({
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
