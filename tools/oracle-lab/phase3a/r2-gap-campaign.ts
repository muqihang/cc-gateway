import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { BASELINE_PROMPT, buildBaselineManifest } from './baseline-cell.js'
import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'
import { validateLaunchManifest, type LaunchManifest } from './launch-manifest.js'
import { normalizeCapsule } from './normalize.js'
import { startFakeUpstream } from './observers/fake-upstream.js'
import { runUpdateLoopbackProxySelfTest, startUpdateLoopbackProxy, type UpdateLoopbackProxy } from './observers/update-loopback-proxy.js'
import { runCell, runCellGuardSelfTest } from './run-cell.js'

const SESSION_ID = '00000000-0000-4000-8000-0000000003a0'

export const R2_GAP_CASES = [
  {
    id: 'compact-cache-long-context', family: 'compact-and-prompt-cache-lifecycle', command_label: 'long-context-print',
    argv: ['--bare', '--print', '--output-format', 'json', '--session-id', SESSION_ID, '--model', 'claude-sonnet-4-6', '--permission-mode', 'bypassPermissions'],
    stdin_kind: 'long-context', session_state: null,
  },
  {
    id: 'telemetry-diagnostic-doctor', family: 'telemetry-diagnostic-update-error-traffic', command_label: 'doctor',
    argv: ['doctor'], stdin_kind: 'empty', session_state: null,
  },
  {
    id: 'telemetry-update', family: 'telemetry-diagnostic-update-error-traffic', command_label: 'update',
    argv: ['update'], stdin_kind: 'empty', session_state: null,
  },
  {
    id: 'restart-resume-init', family: 'restart-resume-and-child-process-lineage', command_label: 'session-init',
    argv: ['--bare', '--print', '--output-format', 'json', '--session-id', SESSION_ID, '--model', 'claude-sonnet-4-6', '--permission-mode', 'bypassPermissions'],
    stdin_kind: 'baseline', session_state: 'shared-resume-state',
  },
  {
    id: 'restart-resume-resume', family: 'restart-resume-and-child-process-lineage', command_label: 'session-resume',
    argv: ['--bare', '--print', '--output-format', 'json', '--resume', SESSION_ID, '--model', 'claude-sonnet-4-6', '--permission-mode', 'bypassPermissions'],
    stdin_kind: 'baseline', session_state: 'shared-resume-state',
  },
] as const

export type R2GapCase = (typeof R2_GAP_CASES)[number]
export type R2GapOptions = {
  evidence_root: string
  out_relative: string
  campaign_id: string
  entrypoint: string
  cc_commit: string
  cc_tree: string
  sub2api_commit: string
  sub2api_tree: string
  plan_sha256: string
  toolchain_digest: string
  case_ids?: string[]
}

function fail(code: string, message: string): never { throw new Phase3AError(code, message) }
function writeJson(file: string, value: unknown): void { writeFileSync(file, `${canonicalJson(value)}\n`, { flag: 'wx', mode: 0o600 }) }

function inputFor(entry: R2GapCase): Buffer {
  if (entry.stdin_kind === 'empty') return Buffer.alloc(0)
  if (entry.stdin_kind === 'baseline') return Buffer.from(BASELINE_PROMPT)
  return Buffer.concat([BASELINE_PROMPT, Buffer.from('\n', 'utf8'), Buffer.from('phase3a-long-context-cache-probe\n'.repeat(4_096), 'utf8')])
}

export function sessionStatePaths(campaignId: string, entry: R2GapCase, runId: string): { home: string; xdg: string; cwd: string } {
  if (entry.session_state === null) {
    return { home: `runs/${runId}/home`, xdg: `runs/${runId}/xdg`, cwd: `runs/${runId}/cwd` }
  }
  const stateRoot = `r2-gap-state/${campaignId}/${entry.session_state}`
  return { home: `${stateRoot}/home`, xdg: `${stateRoot}/xdg`, cwd: `${stateRoot}/cwd` }
}

export function selectedR2GapCases(caseIds: string[]): R2GapCase[] {
  const selected = new Set<string>()
  for (const caseId of caseIds) {
    if (selected.has(caseId)) fail('r2_gap_case_ids', `duplicate gap case ID: ${caseId}`)
    if (!R2_GAP_CASES.some((entry) => entry.id === caseId)) fail('r2_gap_case_ids', `unknown gap case ID: ${caseId}`)
    selected.add(caseId)
  }
  return R2_GAP_CASES.filter((entry) => selected.has(entry.id))
}

export type UpdateLoopbackFixtureSelfTest = {
  schema_version: 'oracle-lab-phase3a-update-loopback-self-test.v1'
  status: 'PASS'
  request: { method: 'HEAD'; path_class: '/' }
  response: { status: 204; response_class: 'update:root-head' }
  version_check: { transport: 'loopback-tls-proxy'; response_class: 'current-version' }
  raw_content_persisted: false
}

export async function runUpdateLoopbackFixtureSelfTest(): Promise<UpdateLoopbackFixtureSelfTest> {
  const upstream = await startFakeUpstream({ scenario: { kind: 'update' } })
  try {
    const status = await new Promise<number>((resolve, reject) => {
      const probe = request(upstream.url, { method: 'HEAD' }, (response) => {
        response.resume()
        response.on('end', () => resolve(response.statusCode ?? 0))
      })
      probe.once('error', reject)
      probe.end()
    })
    const event = upstream.events[0]
    if (status !== 204 || !event || event.method !== 'HEAD' || event.path_class !== '/' || event.response_class !== 'update:root-head') {
      fail('update_fixture_self_test', 'update loopback fixture does not satisfy the observed HEAD root exchange')
    }
    const versionCheck = await runUpdateLoopbackProxySelfTest()
    return {
      schema_version: 'oracle-lab-phase3a-update-loopback-self-test.v1', status: 'PASS',
      request: { method: 'HEAD', path_class: '/' }, response: { status: 204, response_class: 'update:root-head' }, version_check: versionCheck, raw_content_persisted: false,
    }
  } finally { await upstream.close() }
}

export function buildR2GapManifest(input: {
  root: string
  entry: R2GapCase
  run_id: string
  sequence_index: number
  stdin: Buffer
  upstream_url: string
  upstream_port: number
  update_proxy?: Pick<UpdateLoopbackProxy, 'url' | 'port'>
  options: R2GapOptions
}): LaunchManifest {
  const base = buildBaselineManifest({
    evidence_root: input.root,
    entrypoint: input.options.entrypoint,
    out_relative: input.options.out_relative,
    run_id: input.run_id,
    cc_commit: input.options.cc_commit,
    cc_tree: input.options.cc_tree,
    sub2api_commit: input.options.sub2api_commit,
    sub2api_tree: input.options.sub2api_tree,
    plan_sha256: input.options.plan_sha256,
    toolchain_digest: input.options.toolchain_digest,
    command_profile: 'minimal',
    pair_id: `r2-gap-${input.entry.family}`,
    hypothesis_id: `r2-gap-${input.entry.id}`,
    changed_variable: 'r2-gap-command',
    control_value: 'hermetic-baseline',
    treatment_value: input.entry.command_label,
    sequence_index: input.sequence_index,
    randomization_seed: 3_000 + input.sequence_index,
  }, input.upstream_url, input.upstream_port)
  const state = sessionStatePaths(input.options.campaign_id, input.entry, input.run_id)
  return validateLaunchManifest({
    ...base,
    run_id: input.run_id,
    pair_id: `r2-gap-${input.entry.family}`,
    hypothesis_id: `r2-gap-${input.entry.id}`,
    sequence_index: input.sequence_index,
    evidence_level_ceiling: 'Observed',
    command: {
      ...base.command,
      argv: [...input.entry.argv],
      stdin_sha256: sha256Bytes(input.stdin),
      timeout_ms: 120_000,
      cwd: state.cwd,
    },
    environment: {
      ...base.environment,
      allowlist: {
        ...base.environment.allowlist,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: input.entry.family === 'telemetry-diagnostic-update-error-traffic' ? '0' : '1',
        ...(input.update_proxy ? {
          HTTP_PROXY: input.update_proxy.url, HTTPS_PROXY: input.update_proxy.url,
          http_proxy: input.update_proxy.url, https_proxy: input.update_proxy.url,
          NODE_TLS_REJECT_UNAUTHORIZED: '0',
        } : {}),
      },
      unset: input.update_proxy ? base.environment.unset.filter((name) => !['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'].includes(name)) : base.environment.unset,
      home: state.home,
      xdg: state.xdg,
      tmp: `runs/${input.run_id}/tmp`,
    },
    matrix: {
      changed_variable: 'r2-gap-command',
      control_value: 'hermetic-baseline',
      treatment_value: input.entry.command_label,
      fixed_variables: {
        ...base.matrix.fixed_variables,
        fake_upstream: input.entry.id === 'telemetry-update' ? 'loopback-update-head' : 'loopback-anthropic',
        update_transport: input.update_proxy ? 'loopback-tls-proxy' : 'not-applicable',
        nonessential_traffic: input.entry.family === 'telemetry-diagnostic-update-error-traffic',
        session_state: input.entry.session_state === null ? 'fresh' : input.entry.session_state,
      },
    },
    network: input.update_proxy ? {
      ...base.network,
      loopback_ports: [...new Set([...base.network.loopback_ports, input.update_proxy.port])].sort((left, right) => left - right),
      proxy_mode: 'loopback-connect',
    } : base.network,
  })
}

async function runGapCell(input: {
  root: string
  output: string
  entry: R2GapCase
  sequence_index: number
  options: R2GapOptions
}): Promise<Record<string, unknown>> {
  const runId = `${input.options.campaign_id}-${input.entry.id}`
  const directory = path.join(input.output, 'cells', String(input.sequence_index).padStart(2, '0'))
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const stdin = inputFor(input.entry)
  const updateSelfTest = input.entry.id === 'telemetry-update' ? await runUpdateLoopbackFixtureSelfTest() : undefined
  const upstream = await startFakeUpstream({ scenario: input.entry.id === 'telemetry-update' ? { kind: 'update' } : { kind: 'anthropic' }, max_body_bytes: 8 * 1024 * 1024 })
  const updateProxy = input.entry.id === 'telemetry-update' ? await startUpdateLoopbackProxy() : undefined
  try {
    const manifest = buildR2GapManifest({
      root: input.root,
      entry: input.entry,
      run_id: runId,
      sequence_index: input.sequence_index,
      stdin,
      upstream_url: upstream.url,
      upstream_port: upstream.port,
      update_proxy: updateProxy,
      options: input.options,
    })
    const guard = await runCellGuardSelfTest(manifest, input.root)
    writeJson(path.join(directory, 'manifest.json'), manifest)
    writeJson(path.join(directory, 'guard.json'), guard)
    const result = await runCell({ manifest, evidence_root: input.root, executable: input.options.entrypoint, instrumentation: 'none', guard, stdin })
    const observer = { schema_version: 'oracle-lab-phase3a-safe-observer.v1', raw_material_persisted: false, events: upstream.events }
    writeJson(path.join(directory, 'observer.json'), observer)
    writeJson(path.join(directory, 'result.json'), result)
    writeJson(path.join(directory, 'diagnostic.json'), result.safe_diagnostic)
    if (updateSelfTest) writeJson(path.join(directory, 'fixture-self-test.json'), updateSelfTest)
    if (updateProxy) writeJson(path.join(directory, 'update-proxy.json'), { schema_version: 'oracle-lab-phase3a-update-loopback-proxy.v1', raw_content_persisted: false, events: updateProxy.events })
    const updateFixtureOutcome = updateProxy?.events.some((event) => event.path_class === 'manifest' && event.response_class === 'no-platform') ? 'no-platform' : undefined
    const summary = {
      schema_version: 'oracle-lab-phase3a-r2-gap-cell-summary.v1',
      run_id: runId,
      case_id: input.entry.id,
      family: input.entry.family,
      command_label: input.entry.command_label,
      session_state: input.entry.session_state,
      status: result.status,
      manifest_sha256: sha256File(path.join(directory, 'manifest.json')),
      guard_sha256: sha256File(path.join(directory, 'guard.json')),
      observer_sha256: sha256File(path.join(directory, 'observer.json')),
      result_sha256: sha256File(path.join(directory, 'result.json')),
      diagnostic_sha256: sha256File(path.join(directory, 'diagnostic.json')),
      ...(updateSelfTest ? { fixture_self_test_sha256: sha256File(path.join(directory, 'fixture-self-test.json')) } : {}),
      ...(updateProxy ? { update_proxy_sha256: sha256File(path.join(directory, 'update-proxy.json')) } : {}),
      ...(updateFixtureOutcome ? { update_fixture_outcome: updateFixtureOutcome } : {}),
      observer_event_count: upstream.events.length,
      process_samples: result.process_samples.length,
      hook_event_count: result.hook_event_count,
      external_socket_budget: 0,
      raw_material_persisted: false,
    }
    writeJson(path.join(directory, 'summary.json'), summary)
    writeJson(path.join(directory, 'normalized.json'), normalizeCapsule(directory))
    return summary
  } finally {
    stdin.fill(0)
    await updateProxy?.close()
    await upstream.close()
  }
}

export function buildR2GapFamilySummary(hypothesis: string, cells: Array<Record<string, any>>): Record<string, unknown> {
  const complete = cells.every((cell) => cell.status === 'complete')
  const commands = cells.map((cell) => String(cell.command_label))
  if (hypothesis === 'compact-and-prompt-cache-lifecycle') {
    return {
      hypothesis,
      evidence_level: 'Unknown',
      commands,
      searched_surfaces: ['loopback-request-cache-control', 'normalized-system-summary', 'terminal-result'],
      failure_classification: complete ? 'compact-or-cache-transition-not-observed' : 'compact-cell-execution-failed',
      reason: complete ? 'bounded long-context request completed without an observable compact or cache lifecycle transition' : 'one or more bounded long-context cells did not complete; no absence classification is available',
      next_minimal_action: 'Preserve this terminal Unknown unless a locally controllable multi-turn compaction trigger is added.',
    }
  }
  if (hypothesis === 'telemetry-diagnostic-update-error-traffic') {
    const updateNoPlatform = cells.some((cell) => cell.command_label === 'update' && cell.update_fixture_outcome === 'no-platform')
    return {
      hypothesis,
      evidence_level: 'Unknown',
      commands,
      searched_surfaces: ['doctor-command', 'update-command', 'loopback-observer', 'process-lineage', 'safe-error-category'],
      failure_classification: updateNoPlatform ? 'update-no-platform-safe-boundary' : complete ? 'nonessential-destination-not-observed-under-loopback-guard' : 'diagnostic-cell-execution-failed',
      reason: updateNoPlatform ? 'the bounded update command completed the loopback version and manifest exchanges, then stopped at the fixture no-platform boundary before download or replacement' : complete ? 'diagnostic and update branches were executed with nonessential traffic enabled; no corroborated loopback telemetry, update, or error-report destination was observed' : 'one or more diagnostic or update cells did not complete; no absence classification is available',
      next_minimal_action: updateNoPlatform ? 'Preserve this terminal Unknown unless an operator authorizes a separately isolated update-application fixture.' : 'Preserve this terminal Unknown unless a documented local collector trigger becomes available.',
    }
  }
  return {
    hypothesis,
    evidence_level: 'Unknown',
    commands,
    searched_surfaces: ['persistent-isolated-home', 'persistent-isolated-xdg', 'resume-command', 'process-lineage', 'loopback-observer'],
    failure_classification: complete ? 'resume-transition-not-verifiable-from-safe-observation' : 'resume-cell-execution-failed',
    reason: complete ? 'a fresh process executed the session resume command against preserved isolated state, but safe observations did not establish a durable resume lineage transition' : 'one or more session resume cells did not complete; no absence classification is available',
    next_minimal_action: 'Preserve this terminal Unknown unless a local session-state fixture exposes a resume transition without retaining raw state.',
  }
}

export async function runR2GapCampaign(options: R2GapOptions): Promise<Record<string, unknown>> {
  if (!/^[a-z0-9][a-z0-9-]{7,63}$/.test(options.campaign_id)) fail('r2_gap_campaign_id', 'campaign ID must be a bounded lowercase slug')
  const root = ensureEvidenceRoot(options.evidence_root)
  const output = assertEvidencePath(root, path.join(root, options.out_relative))
  if (existsSync(output)) fail('evidence_exists', 'gap campaign output already exists')
  mkdirSync(output, { recursive: true, mode: 0o700 })
  const entries = options.case_ids === undefined ? [...R2_GAP_CASES] : selectedR2GapCases(options.case_ids)
  if (entries.length === 0) fail('r2_gap_case_ids', 'at least one gap case ID is required')
  const cells: Array<Record<string, unknown>> = []
  for (let index = 0; index < entries.length; index += 1) cells.push(await runGapCell({ root, output, entry: entries[index], sequence_index: index, options }))
  const families = [...new Set(entries.map((entry) => entry.family))].sort().map((family) => buildR2GapFamilySummary(family, cells.filter((cell) => cell.family === family)))
  const base = {
    schema_version: 'oracle-lab-phase3a-r2-gap-campaign.v1',
    status: entries.length === R2_GAP_CASES.length ? 'CLOSED_WITH_UNKNOWN' : 'FOCUSED_REPAIR',
    campaign_id: options.campaign_id,
    selected_case_ids: entries.map((entry) => entry.id),
    executed_cells: cells.length,
    cases: cells,
    families,
    external_socket_budget: 0,
    raw_material_persisted: false,
  }
  const summary = { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
  writeJson(path.join(output, 'summary.json'), summary)
  return summary
}

export function parseR2GapArgs(argv: string[]): Record<string, string> {
  const values = argv[0] === '--' ? argv.slice(1) : argv
  const output: Record<string, string> = {}
  const allowed = new Set(['evidence-root', 'out-relative', 'campaign-id', 'entrypoint', 'cc-commit', 'cc-tree', 'sub2api-commit', 'sub2api-tree', 'plan-sha256', 'toolchain-digest', 'case-ids'])
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith('--') || !values[index + 1] || values[index + 1].startsWith('--')) fail('invalid_arguments', 'arguments must be --name value pairs')
    const name = values[index].slice(2)
    if (!allowed.has(name)) fail('invalid_arguments', `unknown argument: --${name}`)
    if (output[name] !== undefined) fail('invalid_arguments', `duplicate argument: --${name}`)
    output[name] = values[index + 1]
  }
  return output
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const values = parseR2GapArgs(process.argv.slice(2))
    const required = ['evidence-root', 'out-relative', 'campaign-id', 'entrypoint', 'cc-commit', 'cc-tree', 'sub2api-commit', 'sub2api-tree', 'plan-sha256', 'toolchain-digest']
    for (const key of required) if (!values[key]) fail('invalid_arguments', `--${key} is required`)
    const summary = await runR2GapCampaign({
      evidence_root: values['evidence-root'], out_relative: values['out-relative'], campaign_id: values['campaign-id'], entrypoint: path.resolve(values.entrypoint),
      cc_commit: values['cc-commit'], cc_tree: values['cc-tree'], sub2api_commit: values['sub2api-commit'], sub2api_tree: values['sub2api-tree'],
      plan_sha256: values['plan-sha256'], toolchain_digest: values['toolchain-digest'], case_ids: values['case-ids']?.split(','),
    })
    process.stdout.write(`${canonicalJson(summary)}\n`)
  } catch (error) {
    process.stderr.write(`${canonicalJson(stableError(error))}\n`)
    process.exitCode = 1
  }
}
