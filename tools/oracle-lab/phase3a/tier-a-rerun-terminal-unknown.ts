import { closeSync, constants as fsConstants, existsSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'
import { loadLaunchManifest } from './launch-manifest.js'

type JsonObject = Record<string, any>
type Target = Readonly<{ version: string; required_pair: string; hypothesis_id: string; next_action: string }>
type ResultMetadata = Readonly<{ command_digest: string; duration_ms: number; status: string; process_sampled: boolean; safe_diagnostic: boolean }>
export type TargetRerunRoot = Readonly<{ version: string; required_pair: string; rerun_root: string }>
type ResolvedTargetRerunRoot = Readonly<{ target: Target; rerun_root: string; campaign_path: string; campaign: JsonObject }>

export const TIER_A_RERUN_TERMINAL_UNKNOWN_TARGETS: readonly Target[] = [
  {
    version: '2.1.214', required_pair: 'long-run', hypothesis_id: 'r3-214-otel-stream-restart-keepalive',
    next_action: 'Complete every remaining required 2.1.214 Tier A pair in the bounded loopback campaign before any Phase 3B consideration.',
  },
  {
    version: '2.1.214', required_pair: 'restart', hypothesis_id: 'r3-214-otel-stream-restart-keepalive',
    next_action: 'Complete every remaining required 2.1.214 Tier A pair in the bounded loopback campaign before any Phase 3B consideration.',
  },
  {
    version: '2.1.212', required_pair: 'restart', hypothesis_id: 'r3-212-lineage-restart-otel-cache',
    next_action: 'Complete every remaining required 2.1.212 Tier A pair in the bounded loopback campaign before any Phase 3B consideration.',
  },
  {
    version: '2.1.211', required_pair: 'base-url-background-restart', hypothesis_id: 'r3-211-baseurl-restart-cache',
    next_action: 'Complete every remaining required 2.1.211 Tier A pair in the bounded loopback campaign before any Phase 3B consideration.',
  },
] as const

const SHA256 = /^[a-f0-9]{64}$/
const RESULT_STATUSES = new Set(['complete', 'failed', 'timeout', 'resource-limit', 'spawn-error'])
const SEARCHED_SURFACES = [
  'rerun-campaign-summary',
  'rerun-lane-summary',
  'rerun-pair-summary',
  'cell-result-command-digest',
  'cell-result-duration',
  'cell-result-safe-diagnostic',
] as const

function fail(code: string, message: string): never { throw new Phase3AError(code, message) }

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readObject(file: string, code: string): JsonObject {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (!isObject(value)) fail(code, 'expected a JSON object')
    return value
  } catch (error) {
    if (error instanceof Phase3AError) throw error
    fail(code, 'expected valid JSON')
  }
}

function relativeEvidencePath(root: string, file: string): string {
  const relative = path.relative(root, file)
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail('tier_a_rerun_path_invalid', 'path must remain below the evidence root')
  }
  return relative.split(path.sep).join('/')
}

function existingDirectory(root: string, relative: string, code: string): string {
  const candidate = assertEvidencePath(root, path.resolve(root, relative))
  if (!existsSync(candidate)) fail(code, 'required directory is missing')
  const actual = realpathSync(candidate)
  assertEvidencePath(root, actual)
  const stat = lstatSync(actual)
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(code, 'required directory must be a real directory')
  return actual
}

function existingFile(root: string, file: string, code: string): string {
  const checked = assertEvidencePath(root, file)
  if (!existsSync(checked)) fail(code, 'required file is missing')
  const stat = lstatSync(checked)
  if (!stat.isFile() || stat.isSymbolicLink()) fail(code, 'required file must be a regular file')
  return checked
}

function requireSafeSummary(value: JsonObject, schema: string, code: string): void {
  if (value.schema_version !== schema || value.external_socket_budget !== 0 || value.raw_material_persisted !== false) {
    fail(code, 'summary safety binding is invalid')
  }
}

function lanePairSummaryFiles(root: string, laneRoot: string): string[] {
  const pairsRoot = existingDirectory(root, relativeEvidencePath(root, path.join(laneRoot, 'pairs')), 'tier_a_rerun_pair_missing')
  const files: string[] = []
  for (const entry of readdirSync(pairsRoot, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) fail('tier_a_rerun_path_invalid', 'rerun pair directory cannot be a symlink')
    if (!entry.isDirectory()) continue
    const summary = path.join(pairsRoot, entry.name, 'summary.json')
    if (existsSync(summary)) files.push(existingFile(root, summary, 'tier_a_rerun_pair_missing'))
  }
  return files
}

function requireTargetInCampaign(campaign: JsonObject, target: Target): void {
  if (!Array.isArray(campaign.lanes)) fail('tier_a_rerun_campaign_invalid', 'campaign lanes are required')
  const rows = campaign.lanes.filter((row: unknown) => isObject(row) && row.version === target.version)
  if (rows.length !== 1 || !Array.isArray(rows[0].selected_pairs) || !rows[0].selected_pairs.includes(target.required_pair)) {
    fail('tier_a_rerun_campaign_invalid', `campaign does not select ${target.version}:${target.required_pair}`)
  }
}

function targetKey(target: Pick<Target, 'version' | 'required_pair'>): string {
  return `${target.version}:${target.required_pair}`
}

function resolveTargetRerunRoots(root: string, mappings: unknown): ResolvedTargetRerunRoot[] {
  if (!Array.isArray(mappings)) fail('tier_a_rerun_target_mapping_invalid', 'target rerun root mappings are required')
  const targets = new Map(TIER_A_RERUN_TERMINAL_UNKNOWN_TARGETS.map((target) => [targetKey(target), target]))
  const resolved: ResolvedTargetRerunRoot[] = []
  const seen = new Set<string>()
  const campaigns = new Map<string, Omit<ResolvedTargetRerunRoot, 'target'>>()
  for (const mapping of mappings) {
    if (!isObject(mapping) || typeof mapping.version !== 'string' || typeof mapping.required_pair !== 'string' || typeof mapping.rerun_root !== 'string' || mapping.rerun_root.length === 0) {
      fail('tier_a_rerun_target_mapping_invalid', 'target rerun root mapping is invalid')
    }
    const key = targetKey({ version: mapping.version, required_pair: mapping.required_pair })
    const target = targets.get(key)
    if (!target || seen.has(key)) fail('tier_a_rerun_target_mapping_invalid', 'target rerun root mappings must be unique and declared')
    seen.add(key)
    const rerunDirectory = existingDirectory(root, mapping.rerun_root, 'tier_a_rerun_root_missing')
    let campaign = campaigns.get(rerunDirectory)
    if (!campaign) {
      const campaignPath = existingFile(root, path.join(rerunDirectory, 'summary.json'), 'tier_a_rerun_campaign_missing')
      const campaignValue = readObject(campaignPath, 'tier_a_rerun_campaign_invalid')
      requireSafeSummary(campaignValue, 'oracle-lab-phase3a-tier-a-dynamic-campaign.v1', 'tier_a_rerun_campaign_invalid')
      if (typeof campaignValue.campaign_id !== 'string' || campaignValue.campaign_id.length === 0) fail('tier_a_rerun_campaign_invalid', 'campaign ID is required')
      campaign = { rerun_root: relativeEvidencePath(root, rerunDirectory), campaign_path: campaignPath, campaign: campaignValue }
      campaigns.set(rerunDirectory, campaign)
    }
    resolved.push({ target, ...campaign })
  }
  if (resolved.length !== targets.size || seen.size !== targets.size) fail('tier_a_rerun_target_mapping_invalid', 'target rerun root mappings must cover every declared terminal-unknown target')
  return resolved
}

function readResult(root: string, file: string, run: JsonObject): ResultMetadata {
  const result = readObject(existingFile(root, file, 'tier_a_rerun_result_missing'), 'tier_a_rerun_result_invalid')
  if (result.schema_version !== 'oracle-lab-phase3a-cell-result.v1' || result.run_id !== run.run_id || !RESULT_STATUSES.has(result.status)
    || !Number.isSafeInteger(result.duration_ms) || result.duration_ms < 0 || result.duration_ms > 3_600_000
    || result.raw_output_persisted !== false) {
    fail('tier_a_rerun_result_invalid', 'cell result does not carry the required safe terminal metadata')
  }
  let commandDigest: string
  if (Object.hasOwn(result, 'command_digest')) {
    if (!SHA256.test(String(result.command_digest))) fail('tier_a_rerun_result_invalid', 'cell result command digest is invalid')
    commandDigest = result.command_digest
  } else {
    const manifestPath = existingFile(root, path.join(path.dirname(file), 'manifest.json'), 'tier_a_rerun_result_missing')
    try {
      const manifest = loadLaunchManifest(manifestPath)
      if (manifest.run_id !== run.run_id) fail('tier_a_rerun_result_invalid', 'legacy manifest does not bind the cell result run ID')
      commandDigest = sha256Bytes(canonicalJson(manifest.command))
    } catch (error) {
      if (error instanceof Phase3AError && error.code === 'tier_a_rerun_result_invalid') throw error
      fail('tier_a_rerun_result_invalid', 'legacy manifest cannot safely supply the cell command digest')
    }
  }
  return {
    command_digest: commandDigest,
    duration_ms: result.duration_ms,
    status: result.status,
    process_sampled: Array.isArray(result.process_samples) && result.process_samples.length > 0,
    safe_diagnostic: isObject(result.safe_diagnostic),
  }
}

function readTargetOutcome(root: string, rerunRoot: string, campaign: JsonObject, target: Target): JsonObject {
  requireTargetInCampaign(campaign, target)
  const laneRoot = existingDirectory(root, relativeEvidencePath(root, path.join(rerunRoot, 'lanes', target.version)), 'tier_a_rerun_lane_missing')
  const lanePath = existingFile(root, path.join(laneRoot, 'summary.json'), 'tier_a_rerun_lane_missing')
  const lane = readObject(lanePath, 'tier_a_rerun_lane_invalid')
  requireSafeSummary(lane, 'oracle-lab-phase3a-tier-a-lane-summary.v1', 'tier_a_rerun_lane_invalid')
  if (lane.version !== target.version || lane.role !== 'tier-a' || lane.hypothesis_id !== target.hypothesis_id
    || !Array.isArray(lane.selected_pairs) || !lane.selected_pairs.includes(target.required_pair)) {
    fail('tier_a_rerun_lane_invalid', 'lane summary does not bind the targeted pair')
  }

  const matching = lanePairSummaryFiles(root, laneRoot).filter((file) => {
    const summary = readObject(file, 'tier_a_rerun_pair_invalid')
    return summary.required_pair === target.required_pair
  })
  if (matching.length !== 1) fail('tier_a_rerun_pair_invalid', `targeted pair summary is not unique for ${target.version}:${target.required_pair}`)
  const pairPath = matching[0]
  const pair = readObject(pairPath, 'tier_a_rerun_pair_invalid')
  requireSafeSummary(pair, 'oracle-lab-phase3a-tier-a-pair-summary.v1', 'tier_a_rerun_pair_invalid')
  if (pair.version !== target.version || pair.required_pair !== target.required_pair || pair.hypothesis_id !== target.hypothesis_id
    || !Number.isInteger(pair.repetitions) || pair.repetitions < 5 || pair.repetitions > 12 || !Array.isArray(pair.runs)) {
    fail('tier_a_rerun_pair_invalid', 'targeted pair summary is invalid')
  }
  const expectedRuns = pair.repetitions * 2
  if (pair.runs.length !== expectedRuns) fail('tier_a_rerun_pair_invalid', 'pair summary does not contain the complete paired schedule')
  const seen = new Set<string>()
  const results: ResultMetadata[] = []
  const pairRoot = path.dirname(pairPath)
  for (const run of pair.runs) {
    if (!isObject(run) || typeof run.run_id !== 'string' || !['control', 'treatment'].includes(run.arm)
      || !Number.isInteger(run.repetition) || run.repetition < 0 || run.repetition >= pair.repetitions) {
      fail('tier_a_rerun_pair_invalid', 'pair run metadata is invalid')
    }
    const key = `${run.arm}:${run.repetition}`
    if (seen.has(key)) fail('tier_a_rerun_pair_invalid', 'pair run schedule has a duplicate arm/repetition')
    seen.add(key)
    const resultPath = path.join(pairRoot, `r${String(run.repetition).padStart(2, '0')}`, run.arm, 'result.json')
    results.push(readResult(root, resultPath, run))
  }
  for (let repetition = 0; repetition < pair.repetitions; repetition += 1) {
    for (const arm of ['control', 'treatment']) if (!seen.has(`${arm}:${repetition}`)) fail('tier_a_rerun_pair_invalid', 'pair run schedule has a missing arm/repetition')
  }
  const durations = results.map((result) => result.duration_ms)
  const total = durations.reduce((sum, duration) => sum + duration, 0)
  if (!Number.isSafeInteger(total)) fail('tier_a_rerun_result_invalid', 'duration total exceeds the safe integer range')
  const completeResultCount = results.filter((result) => result.status === 'complete').length
  const processSampledResultCount = results.filter((result) => result.process_sampled).length
  const safeDiagnosticResultCount = results.filter((result) => result.safe_diagnostic).length
  const commandDigest = sha256Bytes(canonicalJson(results.map((result) => result.command_digest).sort()))
  return {
    tier: 'A',
    version: target.version,
    required_pair: target.required_pair,
    classification: 'TERMINAL_UNKNOWN',
    phase3b_usable: false,
    command_digest: commandDigest,
    duration_stats: {
      count: durations.length,
      min_ms: Math.min(...durations),
      max_ms: Math.max(...durations),
      total_ms: total,
      mean_ms: total / durations.length,
    },
    searched_surfaces: [...SEARCHED_SURFACES],
    capability_evidence: {
      source_kind: 'rerun-summary-and-cell-result-safe-metadata',
      result_count: results.length,
      terminal_result_count: results.length,
      complete_result_count: completeResultCount,
      process_sampled_result_count: processSampledResultCount,
      safe_diagnostic_result_count: safeDiagnosticResultCount,
      external_socket_budget: 0,
      raw_material_persisted: false,
    },
    next_action: target.next_action,
    source_bindings: {
      lane_summary: { path: relativeEvidencePath(root, lanePath), sha256: sha256File(lanePath) },
      pair_summary: { path: relativeEvidencePath(root, pairPath), sha256: sha256File(pairPath) },
      result_set_digest: sha256Bytes(canonicalJson(results.map((result) => ({ command_digest: result.command_digest, duration_ms: result.duration_ms, status: result.status })))),
    },
  }
}

export function buildTierARerunTerminalUnknownArtifact(input: { evidence_root: string; target_rerun_roots: readonly TargetRerunRoot[] }): JsonObject {
  const root = ensureEvidenceRoot(input.evidence_root)
  const reruns = resolveTargetRerunRoots(root, input.target_rerun_roots)
  const pairOutcomes = reruns.map(({ target, rerun_root, campaign }) => readTargetOutcome(root, path.join(root, rerun_root), campaign, target))
  const base = {
    schema_version: 'oracle-lab-phase3a-tier-a-rerun-terminal-unknown.v1',
    classification: 'TERMINAL_UNKNOWN',
    phase3b_usable: false,
    input_policy: 'rerun-summaries-and-cell-results-only',
    rerun_mappings: reruns.map(({ target, rerun_root, campaign_path, campaign }) => ({
      target: { version: target.version, required_pair: target.required_pair },
      rerun_root,
      campaign_id: campaign.campaign_id,
      summary: { path: relativeEvidencePath(root, campaign_path), sha256: sha256File(campaign_path) },
    })),
    pair_outcomes: pairOutcomes,
    external_socket_budget: 0,
    raw_material_persisted: false,
  }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

function writeExclusiveJson(file: string, value: JsonObject): void {
  try {
    if (existsSync(file)) fail('evidence_exists', 'artifact output already exists')
    const payload = `${canonicalJson(value)}\n`
    const temporary = `${file}.tmp-${process.pid}-${sha256Bytes(`${file}:${Date.now()}`).slice(0, 16)}`
    let descriptor: number | undefined
    try {
      descriptor = openSync(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), 0o600)
      writeFileSync(descriptor, payload)
      closeSync(descriptor)
      descriptor = undefined
      linkSync(temporary, file)
      unlinkSync(temporary)
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor)
      try { unlinkSync(temporary) } catch { /* Best effort cleanup for this invocation. */ }
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('evidence_exists', 'artifact output already exists')
      throw error
    }
  } catch (error) {
    if (error instanceof Phase3AError) throw error
    throw error
  }
}

export function writeTierARerunTerminalUnknownArtifact(input: { evidence_root: string; target_rerun_roots: readonly TargetRerunRoot[]; out: string }): { out: string; sha256: string; artifact: JsonObject } {
  const root = ensureEvidenceRoot(input.evidence_root)
  const artifact = buildTierARerunTerminalUnknownArtifact({ evidence_root: root, target_rerun_roots: input.target_rerun_roots })
  const output = assertEvidencePath(root, path.resolve(root, input.out))
  mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 })
  assertEvidencePath(root, output)
  writeExclusiveJson(output, artifact)
  return { out: relativeEvidencePath(root, output), sha256: sha256File(output), artifact }
}

export function parseTierARerunTerminalUnknownArgs(argv: string[]): { 'evidence-root'?: string; target_rerun_roots: TargetRerunRoot[]; out?: string } {
  const values = argv[0] === '--' ? argv.slice(1) : argv
  const output: { 'evidence-root'?: string; target_rerun_roots: TargetRerunRoot[]; out?: string } = { target_rerun_roots: [] }
  const allowed = new Set(['evidence-root', 'target-rerun-root', 'out'])
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith('--') || !values[index + 1] || values[index + 1].startsWith('--')) fail('invalid_arguments', 'arguments must be --name value pairs')
    const name = values[index].slice(2)
    if (!allowed.has(name)) fail('invalid_arguments', `unknown argument: --${name}`)
    const value = values[index + 1]
    if (name === 'target-rerun-root') {
      const separator = value.indexOf('=')
      const target = value.slice(0, separator)
      const rerun_root = value.slice(separator + 1)
      const targetSeparator = target.indexOf(':')
      const version = target.slice(0, targetSeparator)
      const required_pair = target.slice(targetSeparator + 1)
      if (separator <= 0 || targetSeparator <= 0 || !required_pair || !rerun_root) fail('invalid_arguments', '--target-rerun-root must be VERSION:PAIR=PATH')
      const key = targetKey({ version, required_pair })
      if (!TIER_A_RERUN_TERMINAL_UNKNOWN_TARGETS.some((candidate) => targetKey(candidate) === key)) fail('invalid_arguments', 'target rerun root mapping is not declared')
      if (output.target_rerun_roots.some((candidate) => targetKey(candidate) === key)) fail('invalid_arguments', 'duplicate target mapping')
      output.target_rerun_roots.push({ version, required_pair, rerun_root })
      continue
    }
    if (output[name as 'evidence-root' | 'out'] !== undefined) fail('invalid_arguments', `duplicate argument: --${name}`)
    output[name as 'evidence-root' | 'out'] = value
  }
  return output
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const values = parseTierARerunTerminalUnknownArgs(process.argv.slice(2))
    if (!values['evidence-root'] || values.target_rerun_roots.length === 0 || !values.out) fail('usage', 'tier-a-rerun-terminal-unknown requires --evidence-root, --target-rerun-root VERSION:PAIR=PATH, and --out')
    const written = writeTierARerunTerminalUnknownArtifact({ evidence_root: values['evidence-root'], target_rerun_roots: values.target_rerun_roots, out: values.out })
    process.stdout.write(`${canonicalJson({ out: written.out, sha256: written.sha256, classification: written.artifact.classification, pair_count: written.artifact.pair_outcomes.length, phase3b_usable: false })}\n`)
  } catch (error) {
    process.stderr.write(`${canonicalJson(stableError(error))}\n`)
    process.exitCode = 1
  }
}
