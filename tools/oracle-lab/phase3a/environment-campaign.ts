import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { BASELINE_PROMPT, buildBaselineManifest } from './baseline-cell.js'
import { balancedPairOrder } from './converge.js'
import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'
import { BASE_URL_ENV_KEYS, type EnvironmentMatrix, type EnvironmentMatrixPair, type MatrixSetting, validateMatrixPair } from './environment-matrix.js'
import { instrumentationSemanticDigest } from './instrumentation-capability.js'
import { type LaunchManifest, validateLaunchManifest } from './launch-manifest.js'
import { normalizeCapsule } from './normalize.js'
import { startFakeUpstream, type ObserverStringReplacement, type SafeUpstreamEvent } from './observers/fake-upstream.js'
import { startHttpForwardProxy, type HttpForwardProxy } from './observers/http-forward-proxy.js'
import { runCell, runCellGuardSelfTest, type CellResult } from './run-cell.js'

type CampaignOptions = {
  evidence_root: string
  source_entrypoint: string
  probe_entrypoint: string
  expected_probe_sha256: string
  probe_recipe_sha256: string
  matrix_file: string
  out_relative: string
  campaign_id: string
  repetitions: number
  cc_commit: string
  cc_tree: string
  sub2api_commit: string
  sub2api_tree: string
  plan_sha256: string
  toolchain_digest: string
  pair_family?: EnvironmentMatrixPair['family']
  pair_index?: number
}

type RunRecord = {
  run_id: string
  arm: 'control' | 'treatment'
  repetition: number
  sequence_index: number
  status: CellResult['status']
  semantic_sha256: string
  hook_event_count: number
  observer_event_count: number
  process_samples: number
  source_count: number
  dual_source: boolean
  proxy_event_count: number
}

function fail(code: string, message: string): never { throw new Phase3AError(code, message) }
function writeJson(file: string, value: unknown): void { writeFileSync(file, `${canonicalJson(value)}\n`, { flag: 'wx', mode: 0o600 }) }

function resolvedSettingValue(setting: MatrixSetting, context: { loopback_base: string; loopback_proxy_port?: number; evidence_root: string }): string {
  if (setting.state !== 'value' || !setting.value_template) fail('matrix_value_missing', `value setting for ${setting.variable} has no template`)
  if (setting.value_template === 'LOOPBACK_BASE') return context.loopback_base.replace(/\/$/, '')
  if (setting.value_template.startsWith('EVIDENCE_ROOT/')) return path.join(context.evidence_root, setting.value_template.slice('EVIDENCE_ROOT/'.length))
  if (setting.value_template.includes('LOOPBACK_PROXY_PORT')) {
    if (!context.loopback_proxy_port) fail('matrix_reserved_host_requires_proxy', 'reserved-host matrix rows require the loopback proxy adapter')
    return setting.value_template.replace('LOOPBACK_PROXY_PORT', String(context.loopback_proxy_port))
  }
  return setting.value_template
}

export function applyEnvironmentSetting(
  input: LaunchManifest['environment'],
  setting: MatrixSetting,
  context: { loopback_base: string; loopback_proxy_port?: number; evidence_root: string },
): LaunchManifest['environment'] {
  const output = structuredClone(input)
  delete output.allowlist[setting.variable]
  output.explicit_empty = output.explicit_empty.filter((key) => key !== setting.variable)
  output.unset = output.unset.filter((key) => key !== setting.variable)
  if (setting.state === 'unset') output.unset.push(setting.variable)
  else if (setting.state === 'empty') output.explicit_empty.push(setting.variable)
  else output.allowlist[setting.variable] = resolvedSettingValue(setting, context)
  output.explicit_empty.sort(); output.unset.sort()
  const loopbackHosts = new Set(['127.0.0.1', '[::1]', 'localhost'])
  output.base_urls = [...new Set(BASE_URL_ENV_KEYS.filter((key) => key !== 'ANTHROPIC_UNIX_SOCKET').flatMap((key) => {
    const value = output.allowlist[key]
    if (!value) return []
    try { const parsed = new URL(value); return loopbackHosts.has(parsed.hostname) || parsed.hostname.endsWith('.test') ? [value] : [] } catch { return [] }
  }))].sort()
  return output
}

export function classifyMatrixPairRuns(input: {
  repetitions: number
  control_semantic_digests: string[]
  treatment_semantic_digests: string[]
  terminal_cells: number
  dual_source_cells: number
  protocol_cells: number
  complete_schedule: boolean
}): { status: 'REPRODUCED' | 'UNKNOWN'; effect: 'no-observed-effect' | 'semantic-change' | 'unresolved'; stable: boolean } {
  const control = new Set(input.control_semantic_digests)
  const treatment = new Set(input.treatment_semantic_digests)
  const stable = control.size === 1 && treatment.size === 1
  const complete = input.complete_schedule && input.terminal_cells === input.repetitions * 2 && input.dual_source_cells === input.repetitions * 2 && input.protocol_cells === input.repetitions * 2
  return {
    status: stable && complete && input.repetitions >= 5 ? 'REPRODUCED' : 'UNKNOWN',
    effect: !stable ? 'unresolved' : [...control][0] === [...treatment][0] ? 'no-observed-effect' : 'semantic-change',
    stable,
  }
}

export function reclassifyMatrixPairSummary(summary: Record<string, any>): Record<string, unknown> {
  const runs = Array.isArray(summary.runs) ? summary.runs as Array<Record<string, any>> : []
  if (runs.length === 0) return {
    pair_id: summary.pair_id, original_status: summary.status, status: summary.status,
    effect: summary.effect, stable: false, repetitions: Number(summary.repetitions ?? 0), terminal_cells: 0, dual_source_cells: 0,
  }
  const terminal = new Set(['complete', 'failed', 'timeout', 'resource-limit'])
  const sourceCount = (run: Record<string, any>): number => Number(run.hook_event_count > 0) + Number(run.observer_event_count > 0) + Number(run.proxy_event_count > 0) + Number(run.process_samples > 0)
  // Positive protocol: observer/proxy traffic. Negative protocol: process terminated under declared loopback with hooks but zero sockets/events.
  const protocol = (run: Record<string, any>): boolean => {
    if (Number(run.observer_event_count) > 0 || Number(run.proxy_event_count) > 0) return true
    const noSocketTerminal = ['timeout', 'failed', 'resource-limit'].includes(String(run.status))
    return noSocketTerminal && Number(run.observer_event_count || 0) === 0 && Number(run.hook_event_count || 0) > 0
  }
  const repetitions = Number(summary.repetitions)
  const completeSchedule = (['control', 'treatment'] as const).every((arm) => {
    const rows = runs.filter((run) => run.arm === arm).sort((left, right) => Number(left.repetition) - Number(right.repetition))
    return rows.length === repetitions && rows.every((run, index) => Number(run.repetition) === index)
  })
  const protocolCells = runs.filter(protocol)
  const classified = classifyMatrixPairRuns({
    repetitions,
    control_semantic_digests: runs.filter((run) => run.arm === 'control').map((run) => String(run.semantic_sha256)),
    treatment_semantic_digests: runs.filter((run) => run.arm === 'treatment').map((run) => String(run.semantic_sha256)),
    terminal_cells: runs.filter((run) => terminal.has(String(run.status))).length,
    dual_source_cells: runs.filter((run) => sourceCount(run) >= 2).length,
    protocol_cells: protocolCells.length,
    complete_schedule: completeSchedule,
  })
  return {
    pair_id: summary.pair_id, original_status: summary.status, ...classified, repetitions: Number(summary.repetitions),
    terminal_cells: runs.filter((run) => terminal.has(String(run.status))).length,
    dual_source_cells: runs.filter((run) => sourceCount(run) >= 2).length,
    protocol_cells: protocolCells.length,
    negative_protocol_cells: protocolCells.filter((run) => Number(run.observer_event_count || 0) === 0 && Number(run.proxy_event_count || 0) === 0).length,
    complete_schedule: completeSchedule,
  }
}

export function buildEnvironmentCampaignReclassification(sourceDirectoryInput: string): Record<string, unknown> {
  const sourceDirectory = path.resolve(sourceDirectoryInput)
  const sourceSummaryFile = path.join(sourceDirectory, 'summary.json')
  const source = JSON.parse(readFileSync(sourceSummaryFile, 'utf8')) as Record<string, any>
  const pairs = (source.pairs as Array<Record<string, any>>).map((row) => {
    const pairFile = path.join(sourceDirectory, 'pairs', String(row.index).padStart(2, '0'), 'summary.json')
    return reclassifyMatrixPairSummary(JSON.parse(readFileSync(pairFile, 'utf8')) as Record<string, any>)
  })
  const statuses = pairs.reduce<Record<string, number>>((counts, pair) => { const status = String(pair.status); counts[status] = (counts[status] ?? 0) + 1; return counts }, {})
  const base = {
    schema_version: 'oracle-lab-phase3a-environment-campaign-reclassification.v1',
    source_campaign_summary_sha256: sha256File(sourceSummaryFile), source_campaign_id: source.campaign_id,
    pair_count: pairs.length, statuses, pairs, external_socket_budget: 0, raw_material_persisted: false,
  }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

function observerReplacements(root: string, runIds: string[]): ObserverStringReplacement[] {
  return runIds.flatMap((runId) => {
    const runRoot = path.join(root, 'runs', runId)
    return [
      { value: path.join(runRoot, 'home'), replacement: '<HOME>' as const },
      { value: path.join(runRoot, 'xdg'), replacement: '<XDG>' as const },
      { value: path.join(runRoot, 'tmp'), replacement: '<TMP>' as const },
      { value: path.join(runRoot, 'cwd'), replacement: '<CWD>' as const },
    ]
  })
}

function pairManifest(
  base: LaunchManifest,
  pair: EnvironmentMatrixPair,
  setting: MatrixSetting,
  arm: 'control' | 'treatment',
  runId: string,
  sequenceIndex: number,
  seed: number,
  probeSha256: string,
  probeRecipeSha256: string,
  loopbackBase: string,
  loopbackProxyPort: number | undefined,
  evidenceRoot: string,
): LaunchManifest {
  const environment = applyEnvironmentSetting(base.environment, setting, { loopback_base: loopbackBase, loopback_proxy_port: loopbackProxyPort, evidence_root: evidenceRoot })
  environment.home = `runs/${runId}/home`; environment.xdg = `runs/${runId}/xdg`; environment.tmp = `runs/${runId}/tmp`
  return validateLaunchManifest({
    ...structuredClone(base), run_id: runId, pair_id: pair.pair_id, sequence_index: sequenceIndex, randomization_seed: seed,
    hypothesis_id: `${pair.pair_id}-single-variable-effect`, evidence_level_ceiling: 'Reproduced',
    artifact: { ...base.artifact, entrypoint_sha256: probeSha256 },
    command: { ...base.command, executable_sha256: probeSha256, cwd: `runs/${runId}/cwd` },
    environment,
    matrix: {
      changed_variable: pair.changed_variable, control_value: pair.control, treatment_value: pair.treatment,
      fixed_variables: { ...base.matrix.fixed_variables, fixed_variables_sha256: pair.fixed_variables_sha256, probe_recipe_sha256: probeRecipeSha256 },
    },
    capture: { ...base.capture, hook: true, process: true, fs: true, network: true, http: true },
  })
}

async function runMatrixCell(input: {
  root: string
  output: string
  manifest: LaunchManifest
  probeEntrypoint: string
  upstream: Awaited<ReturnType<typeof startFakeUpstream>>
  forwardProxy: HttpForwardProxy | null
  proxyStart: number
  arm: 'control' | 'treatment'
  repetition: number
}): Promise<RunRecord> {
  const directory = path.join(input.output, `r${String(input.repetition).padStart(2, '0')}`, input.arm)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const guard = await runCellGuardSelfTest(input.manifest, input.root)
  writeJson(path.join(directory, 'manifest.json'), input.manifest)
  writeJson(path.join(directory, 'guard.json'), guard)
  const start = input.upstream.events.length
  const result = await runCell({ manifest: input.manifest, evidence_root: input.root, executable: input.probeEntrypoint, instrumentation: 'none', guard, stdin: BASELINE_PROMPT })
  const events = input.upstream.events.slice(start)
  const proxyEvents = input.forwardProxy?.events.slice(input.proxyStart) ?? []
  writeJson(path.join(directory, 'observer.json'), { schema_version: 'oracle-lab-phase3a-safe-observer.v1', normalization: input.upstream.normalization, raw_material_persisted: false, events })
  writeJson(path.join(directory, 'proxy.json'), { schema_version: 'oracle-lab-phase3a-safe-forward-proxy.v1', raw_material_persisted: false, events: proxyEvents })
  writeJson(path.join(directory, 'result.json'), result)
  const summary = {
    schema_version: 'oracle-lab-phase3a-matrix-cell-summary.v1', run_id: input.manifest.run_id,
    manifest_sha256: sha256File(path.join(directory, 'manifest.json')), guard_sha256: sha256File(path.join(directory, 'guard.json')),
    observer_sha256: sha256File(path.join(directory, 'observer.json')), result_sha256: sha256File(path.join(directory, 'result.json')),
    raw_material_persisted: false, external_socket_budget: 0,
  }
  writeJson(path.join(directory, 'summary.json'), summary)
  writeJson(path.join(directory, 'normalized.json'), normalizeCapsule(directory))
  return {
    run_id: input.manifest.run_id, arm: input.arm, repetition: input.repetition, sequence_index: input.manifest.sequence_index,
    status: result.status, semantic_sha256: instrumentationSemanticDigest(events), hook_event_count: result.hook_event_count,
    observer_event_count: events.length, process_samples: result.process_samples.length,
    source_count: Number(result.hook_event_count > 0) + Number(events.length > 0) + Number(result.process_samples.length > 0),
    dual_source: Number(result.hook_event_count > 0) + Number(events.length > 0) + Number(result.process_samples.length > 0) >= 2,
    proxy_event_count: proxyEvents.length,
  }
}

export async function runEnvironmentCampaign(options: CampaignOptions): Promise<Record<string, unknown>> {
  if (!/^[a-z0-9][a-z0-9-]{7,63}$/.test(options.campaign_id)) fail('invalid_campaign_id', 'campaign ID must be a bounded lowercase slug')
  if (!Number.isInteger(options.repetitions) || options.repetitions < 5 || options.repetitions > 12) fail('invalid_repetitions', 'campaign repetitions must be between 5 and 12')
  if (options.pair_family && !new Set(['base-url-state', 'provider-token', 'region', 'hostname', 'placeholder-auth', 'telemetry']).has(options.pair_family)) fail('invalid_pair_family', 'campaign pair family is not recognized')
  if (options.pair_index !== undefined && (!Number.isInteger(options.pair_index) || options.pair_index < 0 || options.pair_index >= 60)) fail('invalid_pair_index', 'campaign pair index must be between 0 and 59')
  for (const [label, digest] of [['probe', options.expected_probe_sha256], ['recipe', options.probe_recipe_sha256], ['plan', options.plan_sha256], ['toolchain', options.toolchain_digest]]) {
    if (!/^[a-f0-9]{64}$/.test(digest)) fail('invalid_digest', `${label} digest must be SHA-256`)
  }
  if (sha256File(options.probe_entrypoint) !== options.expected_probe_sha256) fail('artifact_identity', 'probe artifact digest mismatch')
  const matrix = JSON.parse(readFileSync(options.matrix_file, 'utf8')) as EnvironmentMatrix
  if (matrix.schema_version !== 'oracle-lab-phase3a-environment-matrix.v1' || matrix.pair_count !== 60 || matrix.pairs.length !== 60) fail('matrix_invalid', 'campaign requires the complete 60-pair environment matrix')
  const root = ensureEvidenceRoot(options.evidence_root)
  const output = assertEvidencePath(root, path.join(root, options.out_relative))
  if (existsSync(output)) fail('evidence_exists', 'campaign output path already exists')
  mkdirSync(output, { recursive: true, mode: 0o700 })
  const pairSummaries: Record<string, unknown>[] = []
  let executedCells = 0

  for (let pairIndex = 0; pairIndex < matrix.pairs.length; pairIndex += 1) {
    const pair = validateMatrixPair(matrix.pairs[pairIndex])
    if (options.pair_family && pair.family !== options.pair_family) continue
    if (options.pair_index !== undefined && pairIndex !== options.pair_index) continue
    const pairOutput = path.join(output, 'pairs', String(pairIndex).padStart(2, '0'))
    mkdirSync(pairOutput, { recursive: true, mode: 0o700 })
    const seed = Number.parseInt(sha256Bytes(pair.pair_id).slice(0, 8), 16)
    const order = balancedPairOrder(seed, options.repetitions)
    const runs: RunRecord[] = []
    for (let repetition = 0; repetition < options.repetitions; repetition += 1) {
      const ids = {
        control: `${options.campaign_id}-p${String(pairIndex).padStart(2, '0')}-r${repetition}-control`,
        treatment: `${options.campaign_id}-p${String(pairIndex).padStart(2, '0')}-r${repetition}-treatment`,
      }
      const upstream = await startFakeUpstream({ scenario: { kind: 'anthropic' }, max_body_bytes: 8 * 1024 * 1024, string_replacements: observerReplacements(root, [ids.control, ids.treatment]) })
      const forwardProxy = pair.family === 'provider-token' ? await startHttpForwardProxy({ upstream_url: upstream.url }) : null
      try {
        let base = buildBaselineManifest({
          evidence_root: root, entrypoint: options.source_entrypoint, out_relative: options.out_relative, run_id: `${options.campaign_id}-base`,
          cc_commit: options.cc_commit, cc_tree: options.cc_tree, sub2api_commit: options.sub2api_commit, sub2api_tree: options.sub2api_tree,
          plan_sha256: options.plan_sha256, toolchain_digest: options.toolchain_digest, command_profile: 'full',
        }, upstream.url, upstream.port)
        if (forwardProxy) {
          base = validateLaunchManifest({
            ...base,
            environment: {
              ...base.environment,
              allowlist: { ...base.environment.allowlist, HTTP_PROXY: forwardProxy.url },
              unset: base.environment.unset.filter((key) => key !== 'HTTP_PROXY'),
            },
            network: { ...base.network, loopback_ports: [...new Set([...base.network.loopback_ports, forwardProxy.port])].sort((a, b) => a - b), proxy_mode: 'loopback-connect' },
          })
        }
        for (let position = 0; position < 2; position += 1) {
          const arm = order[repetition][position]
          const setting = arm === 'control' ? pair.control : pair.treatment
          const proxyStart = forwardProxy?.events.length ?? 0
          const manifest = pairManifest(base, pair, setting, arm, ids[arm], repetition * 2 + position, seed, options.expected_probe_sha256, options.probe_recipe_sha256, upstream.url, forwardProxy?.port, root)
          runs.push(await runMatrixCell({ root, output: pairOutput, manifest, probeEntrypoint: options.probe_entrypoint, upstream, forwardProxy, proxyStart, arm, repetition }))
          executedCells += 1
        }
      } finally { await Promise.all([forwardProxy?.close(), upstream.close()]) }
    }
    const reclassified = reclassifyMatrixPairSummary({ pair_id: pair.pair_id, status: 'UNKNOWN', repetitions: options.repetitions, runs })
    const summary = {
      schema_version: 'oracle-lab-phase3a-matrix-pair-summary.v1', pair_id: pair.pair_id, family: pair.family,
      static_anchor: pair.static_anchor, ...reclassified, seed,
      complete_cells: runs.filter((run) => run.status === 'complete').length,
      proxy_event_count: runs.reduce((count, run) => count + run.proxy_event_count, 0),
      runs, external_socket_budget: 0,
    }
    writeJson(path.join(pairOutput, 'summary.json'), summary); pairSummaries.push(summary)
  }
  const statuses = pairSummaries.reduce<Record<string, number>>((counts, pair) => { const status = String(pair.status); counts[status] = (counts[status] ?? 0) + 1; return counts }, {})
  const summary = {
    schema_version: 'oracle-lab-phase3a-environment-campaign.v1', campaign_id: options.campaign_id,
    matrix_sha256: sha256File(options.matrix_file), probe_artifact_sha256: options.expected_probe_sha256, probe_recipe_sha256: options.probe_recipe_sha256,
    matrix_pair_count: matrix.pair_count, pair_count: pairSummaries.length, pair_family: options.pair_family ?? 'all', pair_index: options.pair_index ?? null, executed_cells: executedCells, repetitions: options.repetitions, statuses,
    pairs: pairSummaries.map((pair, index) => ({ index, pair_id: pair.pair_id, family: pair.family, status: pair.status, effect: pair.effect })),
    external_socket_budget: 0, raw_material_persisted: false,
  }
  writeJson(path.join(output, 'summary.json'), summary)
  return summary
}

function args(argv: string[]): Record<string, string> {
  const output: Record<string, string> = {}; const values = argv[0] === '--' ? argv.slice(1) : argv
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith('--') || !values[index + 1]) fail('invalid_arguments', 'arguments must be --name value pairs')
    output[values[index].slice(2)] = values[index + 1]
  }
  return output
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const values = args(process.argv.slice(2))
    if (values['reclassify-campaign']) {
      if (!values.out) fail('invalid_arguments', '--out is required with --reclassify-campaign')
      const result = buildEnvironmentCampaignReclassification(values['reclassify-campaign'])
      writeJson(path.resolve(values.out), result); process.stdout.write(`${canonicalJson(result)}\n`); process.exit(0)
    }
    const required = ['evidence-root', 'source-entrypoint', 'probe-entrypoint', 'expected-probe-sha256', 'probe-recipe-sha256', 'matrix', 'out-relative', 'campaign-id', 'cc-commit', 'cc-tree', 'sub2api-commit', 'sub2api-tree', 'plan-sha256', 'toolchain-digest']
    for (const key of required) if (!values[key]) fail('invalid_arguments', `--${key} is required`)
    const summary = await runEnvironmentCampaign({
      evidence_root: values['evidence-root'], source_entrypoint: path.resolve(values['source-entrypoint']), probe_entrypoint: path.resolve(values['probe-entrypoint']),
      expected_probe_sha256: values['expected-probe-sha256'], probe_recipe_sha256: values['probe-recipe-sha256'], matrix_file: path.resolve(values.matrix),
      out_relative: values['out-relative'], campaign_id: values['campaign-id'], repetitions: Number(values.repetitions ?? 5),
      cc_commit: values['cc-commit'], cc_tree: values['cc-tree'], sub2api_commit: values['sub2api-commit'], sub2api_tree: values['sub2api-tree'],
      plan_sha256: values['plan-sha256'], toolchain_digest: values['toolchain-digest'],
      pair_family: values.family as EnvironmentMatrixPair['family'] | undefined,
      pair_index: values['pair-index'] === undefined ? undefined : Number(values['pair-index']),
    })
    process.stdout.write(`${canonicalJson(summary)}\n`)
  } catch (error) { process.stderr.write(`${canonicalJson(stableError(error))}\n`); process.exitCode = 1 }
}
