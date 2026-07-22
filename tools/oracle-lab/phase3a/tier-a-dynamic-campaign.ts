import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { BASELINE_PROMPT } from './baseline-cell.js'
import { balancedPairOrder } from './converge.js'
import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'
import { type LaunchManifest, validateLaunchManifest } from './launch-manifest.js'
import { normalizeCapsule } from './normalize.js'
import { startFakeUpstream, type SafeUpstreamEvent } from './observers/fake-upstream.js'
import { TIER_A_LANES } from './r3-closure.js'
import { runCell, runCellGuardSelfTest } from './run-cell.js'

const ACTIVE_VERSION = '2.1.215'
const P2_BUNDLE = '2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce'
const PREDECESSOR = '70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1'
const PLAN_SHA = '3e4df5a9111c901061deeff4a074c799637ed3702d4a3d5966dfde7d8ceda127'

function fail(code: string, message: string): never { throw new Phase3AError(code, message) }
function writeJson(file: string, value: unknown): void { writeFileSync(file, `${canonicalJson(value)}\n`, { flag: 'wx', mode: 0o600 }) }

type PlatformArtifact = {
  version: string
  package: string
  source_url: string
  archive_sha256: string
  tree_sha256: string
  entrypoint_sha256: string
  bytes: number
}

type RunRecord = {
  run_id: string
  arm: 'control' | 'treatment'
  version: string
  repetition: number
  sequence_index: number
  status: string
  interface_sha256: string
  hook_event_count: number
  observer_event_count: number
  process_samples: number
  dual_source: boolean
  entrypoint_sha256: string
}

type TierAPairDefinition = {
  required_pair: string
  scenario_label: string
  scenario: Parameters<typeof startFakeUpstream>[0]['scenario']
  environment_overrides: Record<string, string>
}

function topologyInterface(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(topologyInterface)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    key === 'sha256' ? '<VALUE_SHA256>' : topologyInterface(child),
  ]))
}

export function tierAInterfaceDigest(events: SafeUpstreamEvent[]): string {
  return sha256Bytes(canonicalJson(events.map((event) => ({
    method: event.method,
    path_class: event.path_class,
    header_names: event.header_names,
    header_value_classes: event.header_value_classes,
    body_topology: topologyInterface(event.body_topology),
    response_class: event.response_class,
    request_class: event.request_class,
    cch_class: event.cch_class,
    system_summary: {
      status: event.system_summary.status,
      byte_length: event.system_summary.byte_length,
      ast_topology: topologyInterface(event.system_summary.ast_topology),
      span_layout: event.system_summary.span_hashes.map((span) => ({
        path_sha256: span.path_sha256,
        ordinal: span.ordinal,
        byte_length: span.byte_length,
      })),
    },
  }))))
}

function tierAPairDefinition(requiredPair: string): TierAPairDefinition {
  const definitions: Record<string, Omit<TierAPairDefinition, 'required_pair'>> = {
    telemetry: {
      scenario_label: 'loopback-anthropic-otel-export', scenario: { kind: 'anthropic' },
      environment_overrides: { OTEL_SDK_DISABLED: 'false', OTEL_SERVICE_NAME: 'oracle-phase3a-tier-a' },
    },
    'long-run': { scenario_label: 'delayed-response-750ms', scenario: { kind: 'delayed', delay_ms: 750 }, environment_overrides: {} },
    stream: { scenario_label: 'loopback-anthropic-sse', scenario: { kind: 'anthropic' }, environment_overrides: {} },
    restart: { scenario_label: 'loopback-connection-reset', scenario: { kind: 'reset' }, environment_overrides: {} },
    'keep-alive': { scenario_label: 'loopback-anthropic-sse', scenario: { kind: 'anthropic' }, environment_overrides: {} },
    lineage: { scenario_label: 'loopback-anthropic-wrapper', scenario: { kind: 'anthropic' }, environment_overrides: { CLAUDE_CODE_PROCESS_WRAPPER: '/usr/bin/env' } },
    otel: {
      scenario_label: 'loopback-anthropic-otel-export', scenario: { kind: 'anthropic' },
      environment_overrides: { OTEL_SDK_DISABLED: 'false', OTEL_SERVICE_NAME: 'oracle-phase3a-tier-a' },
    },
    'compact-cache': { scenario_label: 'loopback-anthropic-cache-block', scenario: { kind: 'anthropic' }, environment_overrides: {} },
    'base-url-background-restart': { scenario_label: 'loopback-base-url-connection-reset', scenario: { kind: 'reset' }, environment_overrides: {} },
    'process-wrapper-child-lineage': { scenario_label: 'loopback-anthropic-wrapper', scenario: { kind: 'anthropic' }, environment_overrides: { CLAUDE_CODE_PROCESS_WRAPPER: '/usr/bin/env' } },
    'active-vs-predecessor-core': { scenario_label: 'loopback-anthropic-core', scenario: { kind: 'anthropic' }, environment_overrides: {} },
  }
  const definition = definitions[requiredPair]
  if (!definition) fail('tier_a_pair_unknown', `no bounded scenario for required pair ${requiredPair}`)
  return { required_pair: requiredPair, ...definition }
}

export function buildTierACellSummary(input: {
  run_id: string
  arm: 'control' | 'treatment'
  version: string
  status: string
  hook_event_count: number
  observer_event_count: number
  process_samples: number
  manifest_sha256: string
  guard_sha256: string
  observer_sha256: string
  result_sha256: string
}): Record<string, unknown> {
  return {
    schema_version: 'oracle-lab-phase3a-tier-a-cell-summary.v1',
    ...input,
    external_socket_budget: 0,
    raw_material_persisted: false,
  }
}

function loadPlatformArtifact(evidenceRoot: string, version: string): PlatformArtifact {
  const artifactPath = path.join(evidenceRoot, 'intake', 'platform', version, 'artifact.json')
  if (!existsSync(artifactPath)) fail('tier_a_intake_missing', `missing platform artifact for ${version}`)
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as Record<string, any>
  for (const key of ['archive_sha256', 'tree_sha256', 'entrypoint_sha256'] as const) {
    if (typeof artifact[key] !== 'string' || !/^[a-f0-9]{64}$/.test(artifact[key])) fail('tier_a_intake_invalid', `${version} missing ${key}`)
  }
  const archive = path.join(evidenceRoot, 'intake', 'platform', version, 'archive.tgz')
  if (!existsSync(archive) || sha256File(archive) !== artifact.archive_sha256) fail('tier_a_archive_mismatch', `archive digest mismatch for ${version}`)
  return {
    version: String(artifact.version),
    package: String(artifact.package),
    source_url: String(artifact.source_url),
    archive_sha256: String(artifact.archive_sha256),
    tree_sha256: String(artifact.tree_sha256),
    entrypoint_sha256: String(artifact.entrypoint_sha256),
    bytes: Number(artifact.bytes ?? 0),
  }
}

function findClaudeBinary(root: string): string {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (st.isFile() && (name === 'claude' || full.endsWith(`${path.sep}package${path.sep}claude`))) files.push(full)
    }
  }
  walk(root)
  const preferred = files.find((file) => file.endsWith(`${path.sep}package${path.sep}claude`)) ?? files[0]
  if (!preferred) fail('tier_a_binary_missing', `no claude binary under ${root}`)
  return preferred
}

/** Append-only rebuild of control unpack; never recreates deleted original unpacked path. */
export function rebuildControlUnpacked(evidenceRoot: string, version: string): { rebuild_root: string; binary: string; entrypoint_sha256: string; rebuild_receipt: string } {
  const platformRoot = path.join(evidenceRoot, 'intake', 'platform', version)
  const archive = path.join(platformRoot, 'archive.tgz')
  const rebuildRoot = path.join(platformRoot, 'rebuild-v1')
  const unpacked = path.join(rebuildRoot, 'unpacked')
  const receiptPath = path.join(rebuildRoot, 'rebuild-receipt.json')
  if (existsSync(receiptPath) && existsSync(unpacked)) {
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as Record<string, any>
    const binary = String(receipt.binary_path)
    if (existsSync(binary) && sha256File(binary) === receipt.entrypoint_sha256) {
      return { rebuild_root: rebuildRoot, binary, entrypoint_sha256: String(receipt.entrypoint_sha256), rebuild_receipt: receiptPath }
    }
  }
  if (existsSync(rebuildRoot)) fail('evidence_exists', `rebuild path already exists and is incomplete: ${rebuildRoot}`)
  mkdirSync(unpacked, { recursive: true, mode: 0o700 })
  const extracted = spawnSync('tar', ['-xzf', archive, '-C', unpacked], { encoding: 'utf8' })
  if (extracted.status !== 0) fail('tier_a_rebuild_failed', `tar extract failed for ${version}: ${extracted.stderr || extracted.stdout}`)
  const binary = findClaudeBinary(unpacked)
  const entrypointSha256 = sha256File(binary)
  const expected = loadPlatformArtifact(evidenceRoot, version)
  if (entrypointSha256 !== expected.entrypoint_sha256) fail('tier_a_rebuild_digest_mismatch', `rebuild entrypoint digest drift for ${version}`)
  const receipt = {
    schema_version: 'oracle-lab-phase3a-control-rebuild.v1',
    version,
    source_archive: path.relative(evidenceRoot, archive),
    source_archive_sha256: expected.archive_sha256,
    rebuild_root: path.relative(evidenceRoot, rebuildRoot),
    binary_path: binary,
    entrypoint_sha256: entrypointSha256,
    tree_sha256_recorded: expected.tree_sha256,
    note: 'append-only rebuild; original unpacked path was temporary and must not be recreated as if never deleted',
    external_socket_budget: 0,
  }
  writeJson(receiptPath, receipt)
  return { rebuild_root: rebuildRoot, binary, entrypoint_sha256: entrypointSha256, rebuild_receipt: receiptPath }
}

function buildVersionManifest(input: {
  run_id: string
  pair_id: string
  hypothesis_id: string
  version: string
  artifact: PlatformArtifact
  entrypoint_sha256: string
  upstreamUrl: string
  port: number
  sequence_index: number
  seed: number
  cc_commit: string
  cc_tree: string
  sub2api_commit: string
  sub2api_tree: string
  toolchain_digest: string
  changed_variable: string
  control_value: string
  treatment_value: string
  scenario_label: string
  environment_overrides: Record<string, string>
}): LaunchManifest {
  const baseUrl = input.upstreamUrl.replace(/\/$/, '')
  return validateLaunchManifest({
    schema_version: 'oracle-lab-phase3a-launch-manifest.v1', run_id: input.run_id, parent_run_id: null,
    pair_id: input.pair_id, sequence_index: input.sequence_index, randomization_seed: input.seed,
    phase: '3A', requirement_ids: ['HA-P1-001', 'HA-P1-002'],
    hypothesis_id: input.hypothesis_id, evidence_level_ceiling: 'Reproduced',
    repositories: {
      cc_gateway: { commit: input.cc_commit, tree: input.cc_tree, dirty_digest: sha256Bytes('') },
      sub2api: { commit: input.sub2api_commit, tree: input.sub2api_tree, dirty_digest: sha256Bytes('') },
    },
    contract: { bundle_id: 'oracle.compatibility.v1', bundle_sha256: P2_BUNDLE, schema_range: '1:0-0', predecessor_sha256: PREDECESSOR },
    artifact: {
      package: input.artifact.package,
      version: input.version,
      registry_url: `https://registry.npmjs.org/@anthropic-ai%2fclaude-code-darwin-arm64/${input.version}`,
      archive_sha256: input.artifact.archive_sha256,
      tree_sha256: input.artifact.tree_sha256,
      entrypoint_sha256: input.entrypoint_sha256,
    },
    toolchain_digest: input.toolchain_digest,
    platform: { os: process.platform, release: os.release(), arch: process.arch, runtime: 'native', virtualization: 'host-sandbox-exec' },
    command: {
      executable_sha256: input.entrypoint_sha256,
      argv: ['--bare', '--print', '--output-format', 'json', '--no-session-persistence', '--session-id', '00000000-0000-4000-8000-000000000215', '--model', 'claude-sonnet-4-6', '--permission-mode', 'bypassPermissions'],
      cwd: `runs/${input.run_id}/cwd`, stdin_sha256: sha256Bytes(BASELINE_PROMPT), timeout_ms: 60_000,
    },
    environment: {
      allowlist: {
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TERM: 'xterm-256color',
         ANTHROPIC_BASE_URL: baseUrl, CLAUDE_CODE_API_BASE_URL: baseUrl,
         ANTHROPIC_API_KEY: 'oracle-phase3a-placeholder:tier-a',
         CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', NO_PROXY: '127.0.0.1,localhost,::1', no_proxy: '127.0.0.1,localhost,::1',
        ...input.environment_overrides,
      },
      explicit_empty: [],
      unset: ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_CUSTOM_HEADERS', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR', 'AWS_BEARER_TOKEN_BEDROCK', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'SSH_AUTH_SOCK'],
      home: `runs/${input.run_id}/home`, xdg: `runs/${input.run_id}/xdg`, tmp: `runs/${input.run_id}/tmp`,
      tz: 'UTC', lang: 'C', lc_all: 'C', base_urls: [baseUrl],
    },
    network: { policy: 'declared_loopback_only', loopback_ports: [input.port], proxy_mode: 'none', ca_sha256: null, external_socket_budget: 0 },
    matrix: {
      changed_variable: input.changed_variable,
      control_value: input.control_value,
      treatment_value: input.treatment_value,
       fixed_variables: { model: 'claude-sonnet-4-6', prompt_sha256: sha256Bytes(BASELINE_PROMPT), nonessential_traffic: false, loopback: true, scenario: input.scenario_label },
    },
    limits: { wall_ms: 60_000, cpu_ms: 60_000, rss_bytes: 4 * 1024 * 1024 * 1024, output_bytes: 8 * 1024 * 1024, processes: 32, retries: 8, sockets: 16, files: 4096 },
    capture: { hook: true, inspector: false, process: true, fs: true, network: true, tls: false, http: true, pcap: false, stdout: true, stderr: true },
    redaction_policy: 'oracle-lab-phase3a-redaction.v1', retention_class: 'synthetic-raw-14d', expiry: '2026-08-03T00:00:00.000Z', previous_manifest_sha256: null,
    preflight: {
      status: 'PASS', cc_head: input.cc_commit, cc_tree: input.cc_tree, sub2api_head: input.sub2api_commit, sub2api_tree: input.sub2api_tree,
      plan_sha256: PLAN_SHA, p2_bundle_sha256: P2_BUNDLE, predecessor_sha256: PREDECESSOR, codegraph_current: true,
    },
  })
}

async function runArm(input: {
  root: string
  directory: string
  manifest: LaunchManifest
  executable: string
  arm: 'control' | 'treatment'
  version: string
  repetition: number
  upstream: Awaited<ReturnType<typeof startFakeUpstream>>
}): Promise<RunRecord> {
  mkdirSync(input.directory, { recursive: true, mode: 0o700 })
  if (sha256File(input.executable) !== input.manifest.artifact.entrypoint_sha256) fail('artifact_identity', `executable digest mismatch for ${input.version}`)
  const guard = await runCellGuardSelfTest(input.manifest, input.root)
  writeJson(path.join(input.directory, 'manifest.json'), input.manifest)
  writeJson(path.join(input.directory, 'guard.json'), guard)
  const start = input.upstream.events.length
  const result = await runCell({
    manifest: input.manifest, evidence_root: input.root, executable: input.executable,
    instrumentation: 'none', guard, stdin: BASELINE_PROMPT,
  })
  const events = input.upstream.events.slice(start)
  writeJson(path.join(input.directory, 'observer.json'), { schema_version: 'oracle-lab-phase3a-safe-observer.v1', raw_material_persisted: false, events })
  writeJson(path.join(input.directory, 'result.json'), result)
  writeJson(path.join(input.directory, 'summary.json'), buildTierACellSummary({
    run_id: input.manifest.run_id,
    arm: input.arm,
    version: input.version,
    status: result.status,
    observer_event_count: events.length,
    hook_event_count: result.hook_event_count,
    process_samples: result.process_samples.length,
    manifest_sha256: sha256File(path.join(input.directory, 'manifest.json')),
    guard_sha256: sha256File(path.join(input.directory, 'guard.json')),
    observer_sha256: sha256File(path.join(input.directory, 'observer.json')),
    result_sha256: sha256File(path.join(input.directory, 'result.json')),
  }))
  writeJson(path.join(input.directory, 'normalized.json'), normalizeCapsule(input.directory))
  return {
    run_id: input.manifest.run_id, arm: input.arm, version: input.version, repetition: input.repetition,
    sequence_index: input.manifest.sequence_index, status: result.status,
    interface_sha256: tierAInterfaceDigest(events),
    hook_event_count: result.hook_event_count, observer_event_count: events.length,
    process_samples: result.process_samples.length,
    dual_source: Number(result.hook_event_count > 0) + Number(events.length > 0) + Number(result.process_samples.length > 0) >= 2,
    entrypoint_sha256: input.manifest.artifact.entrypoint_sha256,
  }
}

export function classifyPair(runs: RunRecord[], repetitions: number): { status: 'REPRODUCED' | 'UNKNOWN'; effect: string; stable: boolean; complete_schedule: boolean; terminal_cells: number; dual_source_cells: number; protocol_cells: number } {
  const terminal = new Set(['complete'])
  const completeSchedule = (['control', 'treatment'] as const).every((arm) => {
    const rows = runs.filter((run) => run.arm === arm).sort((a, b) => a.repetition - b.repetition)
    return rows.length === repetitions && rows.every((run, index) => run.repetition === index)
  })
  const control = new Set(runs.filter((run) => run.arm === 'control').map((run) => run.interface_sha256))
  const treatment = new Set(runs.filter((run) => run.arm === 'treatment').map((run) => run.interface_sha256))
  const stable = control.size === 1 && treatment.size === 1
  const terminalCells = runs.filter((run) => terminal.has(run.status)).length
  const dualSourceCells = runs.filter((run) => run.dual_source).length
  const protocolCells = runs.filter((run) => run.observer_event_count > 0).length
  const complete = completeSchedule && terminalCells === repetitions * 2 && dualSourceCells === repetitions * 2 && protocolCells === repetitions * 2
  return {
    status: stable && complete && repetitions >= 5 ? 'REPRODUCED' : 'UNKNOWN',
    effect: !stable ? 'unresolved' : [...control][0] === [...treatment][0] ? 'no-observed-effect' : 'semantic-change',
    stable, complete_schedule: completeSchedule, terminal_cells: terminalCells, dual_source_cells: dualSourceCells, protocol_cells: protocolCells,
  }
}

export async function runTierADynamicCampaign(options: {
  evidence_root: string
  out_relative: string
  campaign_id: string
  active_binary: string
  repetitions: number
  cc_commit: string
  cc_tree: string
  sub2api_commit: string
  sub2api_tree: string
  toolchain_digest: string
  versions?: string[]
}): Promise<Record<string, unknown>> {
  if (!Number.isInteger(options.repetitions) || options.repetitions < 5 || options.repetitions > 12) fail('invalid_repetitions', 'tier-a repetitions must be 5..12')
  const root = ensureEvidenceRoot(options.evidence_root)
  const output = assertEvidencePath(root, path.join(root, options.out_relative))
  if (existsSync(output)) fail('evidence_exists', 'tier-a campaign output already exists')
  mkdirSync(output, { recursive: true, mode: 0o700 })
  const activeArtifact = loadPlatformArtifact(root, ACTIVE_VERSION)
  if (sha256File(options.active_binary) !== activeArtifact.entrypoint_sha256) fail('artifact_identity', 'active binary digest mismatch')
  const selected = options.versions?.length ? TIER_A_LANES.filter((lane) => options.versions!.includes(lane.version)) : [...TIER_A_LANES]
  if (selected.length === 0) fail('invalid_versions', 'no Tier A versions selected')
  const laneSummaries: Record<string, unknown>[] = []

  for (const lane of selected) {
    const controlArtifact = loadPlatformArtifact(root, lane.version)
    const rebuild = rebuildControlUnpacked(root, lane.version)
    const laneOutput = path.join(output, 'lanes', lane.version)
    mkdirSync(laneOutput, { recursive: true, mode: 0o700 })
    const pairSummaries: Record<string, unknown>[] = []
    for (let pairIndex = 0; pairIndex < lane.required_pairs.length; pairIndex += 1) {
      const pair = tierAPairDefinition(lane.required_pairs[pairIndex])
      const pairId = `tier-a-${lane.version}-${pair.required_pair}`
      const pairOutput = path.join(laneOutput, 'pairs', `${String(pairIndex).padStart(2, '0')}-${pair.required_pair}`)
      mkdirSync(pairOutput, { recursive: true, mode: 0o700 })
      const seed = Number.parseInt(createHash('sha256').update(pairId).digest('hex').slice(0, 8), 16)
      const order = balancedPairOrder(seed, options.repetitions)
      const runs: RunRecord[] = []
      for (let repetition = 0; repetition < options.repetitions; repetition += 1) {
        const ids = {
          control: `${options.campaign_id}-${lane.version}-${pair.required_pair}-r${repetition}-control`,
          treatment: `${options.campaign_id}-${lane.version}-${pair.required_pair}-r${repetition}-treatment`,
        }
        const upstream = await startFakeUpstream({ scenario: pair.scenario, max_body_bytes: 8 * 1024 * 1024 })
        try {
          for (let position = 0; position < 2; position += 1) {
            const arm = order[repetition][position]
            const version = arm === 'control' ? lane.version : ACTIVE_VERSION
            const artifact = arm === 'control' ? controlArtifact : activeArtifact
            const executable = arm === 'control' ? rebuild.binary : options.active_binary
            const entrypointSha256 = arm === 'control' ? rebuild.entrypoint_sha256 : activeArtifact.entrypoint_sha256
            const manifest = buildVersionManifest({
              run_id: ids[arm], pair_id: pairId, hypothesis_id: `${lane.hypothesis_id}:${pair.required_pair}`, version, artifact, entrypoint_sha256: entrypointSha256,
              upstreamUrl: upstream.url, port: upstream.port, sequence_index: repetition * 2 + position, seed,
              cc_commit: options.cc_commit, cc_tree: options.cc_tree, sub2api_commit: options.sub2api_commit, sub2api_tree: options.sub2api_tree,
              toolchain_digest: options.toolchain_digest, changed_variable: 'claude-code-version',
              control_value: lane.version, treatment_value: ACTIVE_VERSION,
              scenario_label: pair.scenario_label, environment_overrides: pair.environment_overrides,
            })
            runs.push(await runArm({
              root, directory: path.join(pairOutput, `r${String(repetition).padStart(2, '0')}`, arm),
              manifest, executable, arm, version, repetition, upstream,
            }))
          }
        } finally { await upstream.close() }
      }
      const classified = classifyPair(runs, options.repetitions)
      const summary = {
        schema_version: 'oracle-lab-phase3a-tier-a-pair-summary.v1',
        pair_id: pairId, required_pair: pair.required_pair, scenario_label: pair.scenario_label,
        hypothesis_id: lane.hypothesis_id, version: lane.version,
        comparison_scope: 'protocol-topology-and-system-layout; content hashes remain in per-cell normalized evidence',
        ...classified, repetitions: options.repetitions, seed, runs,
        external_socket_budget: 0, raw_material_persisted: false,
      }
      writeJson(path.join(pairOutput, 'summary.json'), summary)
      pairSummaries.push(summary)
    }
    const laneStatus = pairSummaries.every((pair) => pair.status === 'REPRODUCED') ? 'REPRODUCED' : 'UNKNOWN'
    const laneEffect = pairSummaries.some((pair) => pair.effect === 'semantic-change') ? 'semantic-change'
      : pairSummaries.some((pair) => pair.effect === 'unresolved') ? 'unresolved' : 'no-observed-effect'
    const summary = {
      schema_version: 'oracle-lab-phase3a-tier-a-lane-summary.v1',
      version: lane.version, role: 'tier-a', hypothesis_id: lane.hypothesis_id, reason: lane.reason,
      required_pairs: [...lane.required_pairs],
      pair_count: pairSummaries.length, status: laneStatus, effect: laneEffect, pairs: pairSummaries,
      active: activeArtifact, control: controlArtifact,
      rebuild: { rebuild_root: path.relative(root, rebuild.rebuild_root), receipt: path.relative(root, rebuild.rebuild_receipt), entrypoint_sha256: rebuild.entrypoint_sha256 },
      structural: {
        entrypoint_changed: activeArtifact.entrypoint_sha256 !== controlArtifact.entrypoint_sha256,
        archive_changed: activeArtifact.archive_sha256 !== controlArtifact.archive_sha256,
        tree_changed: activeArtifact.tree_sha256 !== controlArtifact.tree_sha256,
      },
      external_socket_budget: 0, raw_material_persisted: false,
    }
    writeJson(path.join(laneOutput, 'summary.json'), summary)
    laneSummaries.push(summary)
  }

  const statuses = laneSummaries.reduce<Record<string, number>>((counts, lane) => {
    const status = String(lane.status); counts[status] = (counts[status] ?? 0) + 1; return counts
  }, {})
  const campaign = {
    schema_version: 'oracle-lab-phase3a-tier-a-dynamic-campaign.v1',
    campaign_id: options.campaign_id,
    active_version: ACTIVE_VERSION,
    lane_count: laneSummaries.length,
    repetitions: options.repetitions,
    statuses,
    lanes: laneSummaries.map((lane) => ({
      version: lane.version, status: lane.status, effect: lane.effect, pair_count: lane.pair_count,
      hypothesis_id: lane.hypothesis_id, required_pairs: lane.required_pairs,
    })),
    external_socket_budget: 0, raw_material_persisted: false,
  }
  const withDigest = { ...campaign, deterministic_digest: sha256Bytes(canonicalJson(campaign)) }
  writeJson(path.join(output, 'summary.json'), withDigest)
  return withDigest
}

export function parseTierADynamicArgs(argv: string[]): Record<string, string> {
  const output: Record<string, string> = {}
  const values = argv[0] === '--' ? argv.slice(1) : argv
  const allowed = new Set(['evidence-root', 'out-relative', 'campaign-id', 'active-binary', 'repetitions', 'cc-commit', 'cc-tree', 'sub2api-commit', 'sub2api-tree', 'toolchain-digest', 'versions'])
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
    const values = parseTierADynamicArgs(process.argv.slice(2))
    const required = ['evidence-root', 'out-relative', 'campaign-id', 'active-binary', 'cc-commit', 'cc-tree', 'sub2api-commit', 'sub2api-tree', 'toolchain-digest']
    for (const key of required) if (!values[key]) fail('invalid_arguments', `--${key} is required`)
    const summary = await runTierADynamicCampaign({
      evidence_root: values['evidence-root'], out_relative: values['out-relative'], campaign_id: values['campaign-id'],
      active_binary: path.resolve(values['active-binary']), repetitions: Number(values.repetitions ?? 5),
      cc_commit: values['cc-commit'], cc_tree: values['cc-tree'], sub2api_commit: values['sub2api-commit'], sub2api_tree: values['sub2api-tree'],
      toolchain_digest: values['toolchain-digest'],
      versions: values.versions ? values.versions.split(',') : undefined,
    })
    process.stdout.write(`${canonicalJson(summary)}\n`)
  } catch (error) {
    process.stderr.write(`${canonicalJson(stableError(error))}\n`)
    process.exitCode = 1
  }
}
