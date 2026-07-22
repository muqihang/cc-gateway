import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { buildBlockedDeliverables, type CuratedExitInput } from './build-exit.js'
import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File } from './core.js'
import { loadLaunchManifest } from './launch-manifest.js'
import { captureRepositoryBinding } from './repository-binding.js'
import { verifyArtifactIndex } from './artifact-index.js'
import { TIER_A_RERUN_TERMINAL_UNKNOWN_TARGETS } from './tier-a-rerun-terminal-unknown.js'

const ACTIVE = '90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58'
const EXPIRY = '2026-08-03T00:00:00.000Z'
const PROHIBITED = ['CL-LOCAL-EVIDENCE-PRODUCTION-PROHIBITED']
const TIER_A_VERSIONS = ['2.1.214', '2.1.212', '2.1.211', '2.1.208', '2.1.207']
const R2_ARTIFACT_ID = 'p3a2-closure-coverage-v8'
const R3_ARTIFACT_ID = 'p3a3-closure-tier-a-v11'
const TIER_A_RERUN_ARTIFACT_ID = 'p3a3-tier-a-rerun-terminal-unknown-v1'
const TLS_ARTIFACT_ID = 'p3a2-local-tls-connect-v1'
const CROSS_PLATFORM_ARTIFACT_ID = 'p3a1-cross-platform-static-corroboration-v2'
const R2_UPDATE_NO_PLATFORM_REASON = 'The bounded update command reached the loopback no-platform boundary before download or replacement.'
function fail(code: string, message: string): never { throw new Phase3AError(code, message) }

type TerminalUnknown = {
  concern: string
  reason: string
  next_minimal_action: string
  phase3b_usable: false
  capability_exhausted: true
  capability_evidence: string
  searched_surfaces: string[]
}

export function evidenceRelativePath(root: string, file: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(file))
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('r4_output_invalid', 'R4 output must be below the evidence root')
  const normalized = relative.split(path.sep).join('/')
  if (!normalized.startsWith('capsules/')) fail('r4_output_invalid', 'R4 output must be below the evidence root capsules directory')
  return normalized
}

export function closureConclusions(input: { environment_complete?: boolean; tier_a_complete?: boolean } = {}): any[] {
  const reproduced = (id: string, statement: string, support: string[], runs: string[], controls: string[]) => ({
    conclusion: {
      schema_version: 'oracle-lab-phase3a-conclusion.v1', conclusion_id: id, level: 'Reproduced',
      scope: 'claude-code-2.1.215 darwin-arm64 synthetic loopback fixtures', statement,
      supporting_artifact_ids: support, contradicting_artifact_ids: [],
      static_anchor: { artifact_digest: ACTIVE, location: 'P3A-1 bounded static inventory and extracted indexes', reproduction_command_digest: sha256Bytes(`phase3a-static-anchor:${id}`) },
      dynamic_reproduction: { run_ids: runs, control_run_ids: controls, source_count: 2 }, single_source_reason: null,
      platform_limits: ['darwin-arm64 only', 'synthetic loopback observers only'], expiry: EXPIRY, negative_capabilities: [], phase3b_usable: true, prohibited_claims: PROHIBITED,
    }, authority_ceiling: 'Reproduced', observation_count: 5, parser_agreement: 'agreed', perturbed: false,
  })
  const unknown = (id: string, statement: string, negative: string, support = [R2_ARTIFACT_ID]) => ({
    conclusion: {
      schema_version: 'oracle-lab-phase3a-conclusion.v1', conclusion_id: id, level: 'Unknown',
      scope: 'claude-code-2.1.215 darwin-arm64 synthetic loopback fixtures', statement,
      supporting_artifact_ids: support, contradicting_artifact_ids: [], static_anchor: null, dynamic_reproduction: null,
      single_source_reason: 'The bounded campaign did not trigger this positive lifecycle.', platform_limits: ['positive lifecycle trigger absent'], expiry: EXPIRY,
      negative_capabilities: [negative], phase3b_usable: false, prohibited_claims: PROHIBITED,
    }, authority_ceiling: 'Unknown', observation_count: 0, parser_agreement: 'not-applicable', perturbed: false,
  })
  return [
    reproduced('CL-P3A-R2-CONFIG-AUTH', 'Config precedence and placeholder credential lifecycle were stable in the bounded local campaign.', ['p3a2-closure-config', 'p3a2-closure-auth-primary', 'p3a2-closure-auth-supplement', R2_ARTIFACT_ID], ['closure-r2-config-v2', 'closure-r2-auth-v1', 'closure-r2-auth-co-v2'], ['closure-r2-config-v2-control']),
    reproduced('CL-P3A-R2-FAILURE-STREAM', 'HTTP failure, reset, partial stream, and complete stream terminal classes were stable in the bounded local campaign.', ['p3a2-closure-scenarios-v2', R2_ARTIFACT_ID], ['closure-r2-scenario-v2', 'closure-r2-partial-v6', 'closure-r2-complete-v7'], ['closure-r2-scenario-v2-control']),
    ...(input.environment_complete === false ? [unknown('CL-P3A-ROUTING-ENVIRONMENT-UNKNOWN', 'Full environment routing and provider-selection coverage remains unclassified.', 'environment-routing-protocol-coverage-incomplete')] : []),
    unknown('CL-P3A-COMPACT-CACHE-UNKNOWN', 'Compact and cache lifecycle behavior remains unclassified after the bounded long-context attempt.', 'compact-cache-lifecycle-untriggered', ['p3a2-gap-campaign-v2', R2_ARTIFACT_ID]),
    unknown('CL-P3A-TELEMETRY-UPDATE-UNKNOWN', 'Positive telemetry, diagnostic, and update traffic behavior remains unclassified after bounded doctor and update commands.', 'positive-nonessential-traffic-untriggered', ['p3a2-gap-campaign-v2', R2_ARTIFACT_ID]),
    unknown('CL-P3A-RESUME-LINEAGE-UNKNOWN', 'Restart, resume, and child-process lineage behavior remains unclassified after bounded persistent-state resume.', 'resume-restart-lineage-untriggered', ['p3a2-gap-campaign-v2', R2_ARTIFACT_ID]),
    ...(input.tier_a_complete === false ? [unknown('CL-P3A-TIER-A-DYNAMIC-UNKNOWN', 'Some Tier A change-point lanes did not complete all required dynamic pairs.', 'tier-a-dynamic-pairs-incomplete', [R3_ARTIFACT_ID, TIER_A_RERUN_ARTIFACT_ID])] : []),
    unknown('CL-P3A-TLS-RUNTIME-UNKNOWN', 'Provider TLS equivalence remains unclassified beyond the observed local-CA boundary.', 'provider-tls-equivalence-out-of-scope', [TLS_ARTIFACT_ID]),
    unknown('CL-P3A-CROSS-PLATFORM-UNKNOWN', 'Cross-platform runtime behavior remains unclassified beyond static corroboration.', 'cross-platform-runtime-unavailable', [CROSS_PLATFORM_ARTIFACT_ID]),
  ]
}

export function r2TerminalUnknownReason(row: Record<string, unknown>): string {
  if (typeof row.reason === 'string' && row.reason.length > 0) return row.reason
  if (row.source === 'gap-update-repair-v5' && row.failure_classification === 'update-no-platform-safe-boundary') {
    return R2_UPDATE_NO_PLATFORM_REASON
  }
  fail('r4_input_invalid', 'R2 terminal Unknown is missing a reason')
}

function expectedCompleteCases(bundle: Record<string, any>, caseIds: string[]): boolean {
  return bundle.status === 'FOCUSED_REPAIR'
    && bundle.external_socket_budget === 0
    && bundle.raw_material_persisted === false
    && Array.isArray(bundle.cases)
    && caseIds.every((caseId) => bundle.cases.some((cell: Record<string, any>) => cell.case_id === caseId && cell.status === 'complete'))
}

export function r2TerminalUnknown(row: Record<string, any>, r2: Record<string, any>): TerminalUnknown {
  const baseGap = r2.inputs?.base_closure?.inputs?.gap
  const resumeRepair = r2.inputs?.resume_repair
  const updateRepair = r2.inputs?.update_repair
  const common = {
    concern: String(row.hypothesis), reason: r2TerminalUnknownReason(row), next_minimal_action: String(row.next_minimal_action), phase3b_usable: false as const,
    capability_exhausted: true as const, searched_surfaces: Array.isArray(row.searched_surfaces) ? row.searched_surfaces.map(String) : [],
  }
  if (row.hypothesis === 'compact-and-prompt-cache-lifecycle'
    && row.source === 'gap'
    && row.failure_classification === 'compact-or-cache-transition-not-observed'
    && baseGap?.status === 'CLOSED_WITH_UNKNOWN'
    && baseGap.external_socket_budget === 0
    && baseGap.raw_material_persisted === false
    && Array.isArray(baseGap.cases)
    && baseGap.cases.some((cell: Record<string, any>) => cell.family === row.hypothesis && cell.status === 'complete')) {
    return { ...common, capability_evidence: 'r2-gap-v2-complete-no-compact-cache-transition' }
  }
  if (row.hypothesis === 'restart-resume-and-child-process-lineage'
    && row.source === 'gap'
    && row.failure_classification === 'resume-cell-execution-failed'
    && expectedCompleteCases(resumeRepair, ['restart-resume-init', 'restart-resume-resume'])) {
    return { ...common, capability_evidence: 'r2-resume-repair-v1-complete-safe-lineage-limit' }
  }
  if (row.hypothesis === 'telemetry-diagnostic-update-error-traffic'
    && row.source === 'gap-update-repair-v5'
    && row.failure_classification === 'update-no-platform-safe-boundary'
    && updateRepair?.status === 'FOCUSED_REPAIR'
    && updateRepair.external_socket_budget === 0
    && updateRepair.raw_material_persisted === false
    && Array.isArray(updateRepair.cases)
    && updateRepair.cases.some((cell: Record<string, any>) => cell.case_id === 'telemetry-update' && cell.update_fixture_outcome === 'no-platform')) {
    return { ...common, capability_evidence: 'r2-update-repair-v5-loopback-no-platform-boundary' }
  }
  fail('r4_terminal_unknown_unproven', `R2 terminal Unknown is not backed by complete bounded evidence: ${String(row.hypothesis)}`)
}

export function r2EnvironmentCoverage(r2: Record<string, any>): { reproduced: number; unknown: number; complete: boolean } {
  const environment = r2.inputs?.base_closure?.inputs?.environment
  const reproduced = Number(environment?.statuses?.REPRODUCED ?? 0)
  const unknown = Number(environment?.statuses?.UNKNOWN ?? 0)
  return { reproduced, unknown, complete: environment?.status === 'PASS' && unknown === 0 }
}

export function tierATerminalUnknowns(lanes: Array<Record<string, any>>, rerun: Record<string, any>): { closed: TerminalUnknown[]; open: Array<Record<string, any>> } {
  const outcomes = new Map((Array.isArray(rerun.pair_outcomes) ? rerun.pair_outcomes : []).map((outcome: Record<string, any>) => [`${outcome.version}:${outcome.required_pair}`, outcome]))
  const closed: TerminalUnknown[] = []
  const open: Array<Record<string, any>> = []
  for (const lane of lanes) {
    if (['PASS', 'REPRODUCED'].includes(String(lane.status))) continue
    if (lane.status !== 'CLOSED_WITH_UNKNOWN') { open.push(lane); continue }
    const pairs = lane.dynamic?.admission?.convergence?.pairs
    if (!Array.isArray(pairs)) fail('r4_terminal_unknown_unproven', `Tier A lane has no convergence pairs: ${String(lane.version)}`)
    const incomplete = pairs.filter((pair: Record<string, any>) => pair.run_coverage !== 'PASS')
    if (incomplete.length === 0) fail('r4_terminal_unknown_unproven', `Tier A closed lane has no terminal pair: ${String(lane.version)}`)
    const supported = incomplete.map((pair: Record<string, any>) => outcomes.get(`${lane.version}:${pair.required_pair}`))
    if (supported.some((outcome) => outcome?.classification !== 'TERMINAL_UNKNOWN'
      || outcome.phase3b_usable !== false
      || outcome.capability_evidence?.external_socket_budget !== 0
      || outcome.capability_evidence?.raw_material_persisted !== false
      || outcome.capability_evidence?.complete_result_count !== 0
      || outcome.capability_evidence?.terminal_result_count !== outcome.capability_evidence?.result_count
      || outcome.capability_evidence?.result_count < 10
      || outcome.capability_evidence?.process_sampled_result_count !== outcome.capability_evidence?.result_count
      || outcome.capability_evidence?.safe_diagnostic_result_count !== outcome.capability_evidence?.result_count
      || !Array.isArray(outcome.searched_surfaces)
      || outcome.searched_surfaces.length === 0)) {
      fail('r4_terminal_unknown_unproven', `Tier A terminal rerun does not prove every incomplete pair: ${String(lane.version)}`)
    }
    closed.push({
      concern: `claude-code-tier-a-dynamic-${String(lane.version)}`,
      reason: `required dynamic pairs terminated without reproduced evidence: ${incomplete.map((pair: Record<string, any>) => String(pair.required_pair)).sort().join(',')}`,
      next_minimal_action: String(lane.dynamic?.next_minimal_action ?? 'Resolve the bounded terminal pairs.'),
      phase3b_usable: false,
      capability_exhausted: true,
      capability_evidence: `tier-a-rerun-terminal-unknown-v1:${incomplete.length}-pair(s)`,
      searched_surfaces: ['tier-a-dynamic-projection', 'rerun-campaign-summary', 'rerun-pair-summary', 'cell-result-safe-diagnostic'],
    })
  }
  return { closed, open }
}

function indexedSource(evidenceRoot: string, artifacts: Map<string, { artifact_id: string; sha256: string; relative_path?: string }>, source: Record<string, any>, label: string): { relative: string; value: Record<string, any> } {
  if (typeof source.path !== 'string' || !/^[a-f0-9]{64}$/.test(String(source.sha256))) fail('r4_terminal_source_invalid', `${label} source binding is invalid`)
  const relative = source.path
  const absolute = path.resolve(evidenceRoot, relative)
  if (path.relative(evidenceRoot, absolute).startsWith('..') || path.isAbsolute(path.relative(evidenceRoot, absolute))) fail('r4_terminal_source_invalid', `${label} source binding escapes evidence root`)
  const indexed = [...artifacts.values()].find((artifact) => artifact.relative_path === relative && artifact.sha256 === source.sha256)
  if (!indexed || sha256File(absolute) !== source.sha256) fail('r4_terminal_source_invalid', `${label} source is not hash-bound by the terminal index`)
  try {
    const value = JSON.parse(readFileSync(absolute, 'utf8')) as Record<string, any>
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('r4_terminal_source_invalid', `${label} source must be an object`)
    return { relative, value }
  } catch (error) {
    if (error instanceof Phase3AError) throw error
    fail('r4_terminal_source_invalid', `${label} source is not valid JSON`)
  }
}

function resultCommandDigest(evidenceRoot: string, artifacts: Map<string, { artifact_id: string; sha256: string; relative_path?: string }>, result: Record<string, any>, resultRelative: string): string {
  if (/^[a-f0-9]{64}$/.test(String(result.command_digest))) return result.command_digest
  const manifestRelative = path.join(path.dirname(resultRelative), 'manifest.json').split(path.sep).join('/')
  const manifest = indexedSource(evidenceRoot, artifacts, { path: manifestRelative, sha256: sha256File(path.resolve(evidenceRoot, manifestRelative)) }, 'Tier A result manifest').value
  const parsed = loadLaunchManifest(path.resolve(evidenceRoot, manifestRelative))
  if (parsed.run_id !== result.run_id || manifest.run_id !== result.run_id) fail('r4_terminal_source_invalid', 'Tier A result manifest does not bind its result')
  return sha256Bytes(canonicalJson(parsed.command))
}

function assertTierARerunSources(evidenceRoot: string, rerun: Record<string, any>, artifacts: Map<string, { artifact_id: string; sha256: string; relative_path?: string }>): void {
  if (!Array.isArray(rerun.rerun_mappings) || !Array.isArray(rerun.pair_outcomes)) fail('r4_terminal_source_invalid', 'Tier A rerun sources are required')
  const mappingKeys = new Set<string>()
  for (const mapping of rerun.rerun_mappings) {
    if (!mapping?.target || typeof mapping.rerun_root !== 'string' || typeof mapping.campaign_id !== 'string') fail('r4_terminal_source_invalid', 'Tier A rerun mapping is invalid')
    const key = `${mapping.target.version}:${mapping.target.required_pair}`
    if (mappingKeys.has(key)) fail('r4_terminal_source_invalid', 'Tier A rerun mapping is duplicated')
    mappingKeys.add(key)
    const campaign = indexedSource(evidenceRoot, artifacts, mapping.summary, 'Tier A rerun campaign').value
    if (campaign.campaign_id !== mapping.campaign_id) fail('r4_terminal_source_invalid', 'Tier A rerun campaign ID does not match its mapping')
  }
  for (const outcome of rerun.pair_outcomes) {
    const key = `${outcome.version}:${outcome.required_pair}`
    if (!mappingKeys.has(key)) fail('r4_terminal_source_invalid', 'Tier A outcome has no rerun mapping')
    const lane = indexedSource(evidenceRoot, artifacts, outcome.source_bindings?.lane_summary, 'Tier A rerun lane').value
    const pairSource = indexedSource(evidenceRoot, artifacts, outcome.source_bindings?.pair_summary, 'Tier A rerun pair')
    const pair = pairSource.value
    if (lane.version !== outcome.version || !Array.isArray(lane.selected_pairs) || !lane.selected_pairs.includes(outcome.required_pair)
      || pair.version !== outcome.version || pair.required_pair !== outcome.required_pair || !Array.isArray(pair.runs) || pair.runs.length < 10) {
      fail('r4_terminal_source_invalid', 'Tier A rerun summaries do not bind the declared outcome')
    }
    const rows: Array<{ command_digest: string; duration_ms: number; status: string }> = []
    let sampled = 0
    let diagnostic = 0
    const seen = new Set<string>()
    for (const run of pair.runs) {
      if (!run || !['control', 'treatment'].includes(run.arm) || !Number.isInteger(run.repetition) || typeof run.run_id !== 'string') fail('r4_terminal_source_invalid', 'Tier A rerun pair run is invalid')
      const key = `${run.arm}:${run.repetition}`
      if (seen.has(key)) fail('r4_terminal_source_invalid', 'Tier A rerun pair schedule is duplicated')
      seen.add(key)
      const resultRelative = path.join(path.dirname(pairSource.relative), `r${String(run.repetition).padStart(2, '0')}`, run.arm, 'result.json').split(path.sep).join('/')
      const result = indexedSource(evidenceRoot, artifacts, { path: resultRelative, sha256: sha256File(path.resolve(evidenceRoot, resultRelative)) }, 'Tier A rerun result').value
      if (result.run_id !== run.run_id || result.raw_output_persisted !== false || !Number.isSafeInteger(result.duration_ms) || typeof result.status !== 'string') fail('r4_terminal_source_invalid', 'Tier A rerun result is invalid')
      if (Array.isArray(result.process_samples) && result.process_samples.length > 0) sampled += 1
      if (result.safe_diagnostic && typeof result.safe_diagnostic === 'object' && !Array.isArray(result.safe_diagnostic)) diagnostic += 1
      rows.push({ command_digest: resultCommandDigest(evidenceRoot, artifacts, result, resultRelative), duration_ms: result.duration_ms, status: result.status })
    }
    const evidence = outcome.capability_evidence
    if (evidence?.result_count !== rows.length || evidence.terminal_result_count !== rows.length || evidence.process_sampled_result_count !== sampled || evidence.safe_diagnostic_result_count !== diagnostic
      || outcome.source_bindings?.result_set_digest !== sha256Bytes(canonicalJson(rows))) {
      fail('r4_terminal_source_invalid', 'Tier A rerun capability counts or result digest do not match indexed sources')
    }
  }
}

export function tlsTerminalUnknown(value: Record<string, any>): TerminalUnknown {
  const events = value.surfaces
  if (value.schema_version !== 'oracle-lab-phase3a-local-tls-connect-summary.v1'
    || value.status !== 'OBSERVED'
    || value.active_artifact?.entrypoint_sha256 !== ACTIVE
    || value.active_artifact?.observed_entrypoint_sha256 !== ACTIVE
    || value.capability?.external_socket_budget !== 0
    || value.capability?.raw_material_persisted !== false
    || value.capability?.local_tls_connect !== 'observed'
    || value.capability?.local_https_http !== 'observed'
    || !Array.isArray(events?.tls_events)
    || !Array.isArray(events?.http_events)
    || events.tls_events.length === 0
    || events.http_events.length === 0
    || events.tls_events.some((event: Record<string, any>) => event.decision !== 'accepted-local-tls' || event.protocol !== 'TLSv1.3')
    || events.http_events.some((event: Record<string, any>) => event.response_status !== 200)) {
    fail('r4_tls_evidence_invalid', 'TLS evidence does not prove the bounded local-CA runtime observation')
  }
  return {
    concern: 'tls-positive-runtime-coverage', reason: 'The active artifact completed bounded local-CA TLS and HTTPS observations; provider equivalence remains out of scope.',
    next_minimal_action: 'Use a separately approved provider-equivalence campaign before making any provider TLS claim.', phase3b_usable: false,
    capability_exhausted: true, capability_evidence: 'local-ca-loopback-tls-and-https-observed-no-upstream-dial',
    searched_surfaces: ['connect-proxy', 'local-ca', 'tls-events', 'http-events'],
  }
}

export function crossPlatformTerminalUnknown(value: Record<string, any>): TerminalUnknown {
  const platforms = Array.isArray(value.artifacts) ? value.artifacts.map((artifact: Record<string, any>) => artifact.platform).sort() : []
  if (value.schema_version !== 'oracle-lab-phase3a-cross-platform-static-corroboration.v1'
    || value.scope !== 'official-claude-code-2.1.215-static-only'
    || value.artifact_count !== 3
    || canonicalJson(platforms) !== canonicalJson(['darwin-arm64', 'linux-x64', 'win32-x64'])
    || value.structural_corroboration?.status !== 'corroborated'
    || value.capability_conclusion?.result !== 'static-corroborated'
    || value.capability_conclusion?.runtime_capability !== 'Unknown'
    || value.capability_conclusion?.phase3b_usable !== false
    || !Array.isArray(value.source_sink_corroboration)
    || value.source_sink_corroboration.length === 0
    || value.source_sink_corroboration.some((row: Record<string, any>) => row.status !== 'corroborated' || !Array.isArray(row.missing_on) || row.missing_on.length !== 0)) {
    fail('r4_cross_platform_evidence_invalid', 'cross-platform evidence does not prove official static corroboration')
  }
  return {
    concern: 'cross-platform-corroboration', reason: 'Official Darwin, Linux, and Windows artifacts have static source/sink and structural corroboration; runtime remains unclassified.',
    next_minimal_action: 'Use a second-platform runner before making a cross-platform runtime claim.', phase3b_usable: false,
    capability_exhausted: true, capability_evidence: 'official-three-platform-static-corroboration-no-dynamic-worker',
    searched_surfaces: ['official-darwin-artifact', 'official-linux-artifact', 'official-windows-artifact', 'source-sink-corroboration'],
  }
}

export function parseR4CurationArgs(argv: string[]): Record<string, string> {
  const values = argv[0] === '--' ? argv.slice(1) : argv
  const output: Record<string, string> = {}
  const allowed = new Set(['evidence-root', 'template', 'r2', 'r3', 'artifact-index', 'leak-scan', 'tier-a-terminal-rerun', 'tls-summary', 'cross-platform', 'cc-root', 'sub2api-root', 'cc-base', 'sub2api-base', 'cc-freeze', 'sub2api-freeze', 'out-input', 'out-exit', 'out-markdown', 'out-handoff'])
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith('--') || !values[index + 1] || values[index + 1].startsWith('--')) fail('invalid_arguments', 'arguments must be --name value pairs')
    const name = values[index].slice(2)
    if (!allowed.has(name)) fail('invalid_arguments', `unknown argument: --${name}`)
    if (output[name] !== undefined) fail('invalid_arguments', `duplicate argument: --${name}`)
    output[name] = values[index + 1]
  }
  return output
}

function expectedEvidenceFile(root: string, input: string, relative: string, label: string): string {
  const expected = path.resolve(root, relative)
  if (path.resolve(root, input) !== expected) fail('r4_input_invalid', `${label} must be ${relative}`)
  return expected
}

function assertDeterministic(value: Record<string, any>, name: string): void {
  const { deterministic_digest, ...base } = value
  if (typeof deterministic_digest !== 'string' || deterministic_digest !== sha256Bytes(canonicalJson(base))) fail('r4_input_invalid', `${name} deterministic digest is invalid`)
}

function indexedArtifact(artifacts: Map<string, { artifact_id: string; sha256: string; relative_path?: string }>, artifactId: string, sha256: string, label: string): void {
  const artifact = artifacts.get(artifactId)
  if (!artifact || artifact.sha256 !== sha256) fail('r4_input_invalid', `${label} is not bound to indexed evidence: ${artifactId}`)
}

function assertTierAProjectionSupport(evidenceRoot: string, artifacts: Map<string, { artifact_id: string; sha256: string; relative_path?: string }>, lanes: Array<Record<string, any>>): void {
  for (const version of TIER_A_VERSIONS) {
    const lane = lanes.find((row) => row.version === version)
    const evidence = lane?.dynamic?.evidence
    const relativeProjection = `capsules/P3A-3/tier-a-dynamic-projections-v5/tier-a-dynamic-projection-v5-${version}.json`
    if (evidence?.projection_path !== relativeProjection || typeof evidence.projection_sha256 !== 'string') fail('r4_input_invalid', `R3 lane ${version} must bind Tier A projection v5`)
    indexedArtifact(artifacts, `p3a3-tier-a-projection-v5-${version}`, evidence.projection_sha256, `Tier A projection ${version}`)
    const projectionPath = expectedEvidenceFile(evidenceRoot, evidence.projection_path, relativeProjection, `Tier A projection ${version}`)
    const projection = JSON.parse(readFileSync(projectionPath, 'utf8')) as Record<string, any>
    assertDeterministic(projection, `Tier A projection ${version}`)
    const bindings = projection.source_bindings
    const bindingRoot = `capsules/P3A-3/tier-a-cell-bindings-v3/${version}`
    if (projection.schema_version !== 'oracle-lab-phase3a-tier-a-dynamic-projection.v3' || projection.version !== version || projection.external_socket_budget !== 0 || projection.raw_material_persisted !== false || bindings?.binding_root !== bindingRoot || !Array.isArray(bindings.binding_capsules) || bindings.binding_capsules.length === 0) {
      fail('r4_input_invalid', `Tier A projection ${version} does not bind v3 cell capsules`)
    }
    for (const binding of bindings.binding_capsules) {
      if (typeof binding?.path !== 'string' || typeof binding.sha256 !== 'string' || !binding.path.startsWith(`${bindingRoot}/`)) fail('r4_input_invalid', `Tier A projection ${version} has an invalid v3 binding capsule`)
      const indexed = [...artifacts.values()].find((artifact) => artifact.relative_path === binding.path)
      if (!indexed || indexed.sha256 !== binding.sha256) fail('r4_input_invalid', `Tier A projection ${version} binding capsule is not indexed`)
    }
  }
}

function assertTierARerunArtifact(evidenceRoot: string, value: Record<string, any>, sha256: string, artifacts: Map<string, { artifact_id: string; sha256: string; relative_path?: string }>): void {
  indexedArtifact(artifacts, TIER_A_RERUN_ARTIFACT_ID, sha256, 'Tier A terminal rerun artifact')
  assertDeterministic(value, 'Tier A terminal rerun artifact')
  if (value.schema_version !== 'oracle-lab-phase3a-tier-a-rerun-terminal-unknown.v1' || value.classification !== 'TERMINAL_UNKNOWN' || value.phase3b_usable !== false || value.external_socket_budget !== 0 || value.raw_material_persisted !== false || !Array.isArray(value.pair_outcomes)) {
    fail('r4_input_invalid', 'Tier A terminal rerun artifact is invalid')
  }
  const expected = TIER_A_RERUN_TERMINAL_UNKNOWN_TARGETS.map((target) => `${target.version}:${target.required_pair}`).sort()
  const actual = value.pair_outcomes.map((row: Record<string, any>) => `${row.version}:${row.required_pair}`).sort()
  if (canonicalJson(actual) !== canonicalJson(expected) || value.pair_outcomes.some((row: Record<string, any>) => row.classification !== 'TERMINAL_UNKNOWN' || row.phase3b_usable !== false)) {
    fail('r4_input_invalid', 'Tier A terminal rerun artifact does not cover the declared terminal Unknowns')
  }
  assertTierARerunSources(evidenceRoot, value, artifacts)
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const required = ['evidence-root', 'template', 'r2', 'r3', 'artifact-index', 'leak-scan', 'tier-a-terminal-rerun', 'tls-summary', 'cross-platform', 'cc-root', 'sub2api-root', 'cc-base', 'sub2api-base', 'cc-freeze', 'sub2api-freeze', 'out-input', 'out-exit', 'out-markdown', 'out-handoff']
  const values = parseR4CurationArgs(process.argv.slice(2))
  if (required.some((name) => !values[name])) fail('usage', 'r4-curation requires template, closure, repository, and output arguments')
  const evidenceRoot = ensureEvidenceRoot(values['evidence-root']!)
  const template = JSON.parse(readFileSync(values.template!, 'utf8')) as CuratedExitInput
  const r2Path = expectedEvidenceFile(evidenceRoot, values.r2!, 'capsules/P3A-2/closure-r2-coverage-v8.json', 'R2 closure')
  const r3Path = expectedEvidenceFile(evidenceRoot, values.r3!, 'capsules/P3A-3/closure-r3-tier-a-v11.json', 'R3 closure')
  const leakPath = expectedEvidenceFile(evidenceRoot, values['leak-scan']!, 'capsules/P3A-4/leak-scan-v23.json', 'leak scan')
  const rerunPath = expectedEvidenceFile(evidenceRoot, values['tier-a-terminal-rerun']!, 'capsules/P3A-3/tier-a-rerun-terminal-unknown-v1.json', 'Tier A terminal rerun artifact')
  const tlsPath = expectedEvidenceFile(evidenceRoot, values['tls-summary']!, 'capsules/P3A-2/closure-r2-local-tls-connect-v1/summary.json', 'TLS summary')
  const crossPlatformPath = expectedEvidenceFile(evidenceRoot, values['cross-platform']!, 'capsules/P3A-1/cross-platform-static-corroboration-v2.json', 'cross-platform summary')
  const r2 = JSON.parse(readFileSync(r2Path, 'utf8')) as Record<string, any>; const r3 = JSON.parse(readFileSync(r3Path, 'utf8')) as Record<string, any>
  if (!['PASS', 'CLOSED_WITH_UNKNOWN'].includes(String(r2.status)) || !['PASS', 'CLOSED_WITH_UNKNOWN', 'INCOMPLETE'].includes(String(r3.status))) fail('r4_input_invalid', 'R2 and R3 closures are not terminal')
  const r1Path = path.join(evidenceRoot, 'capsules/P3A-1/r1-static-closure-v1.json')
  const censusPath = path.join(evidenceRoot, 'static/90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58/discovery-r1-census-v3.json')
  if (!existsSync(r1Path) || !existsSync(censusPath)) fail('r4_static_unbound', 'R1 static-closure and census-v3 are required')
  const r1 = JSON.parse(readFileSync(r1Path, 'utf8')) as Record<string, any>
  const r1Sha = sha256File(r1Path); const censusSha = sha256File(censusPath)
  const recoveredRoots = Array.isArray(r1.required_roots) ? r1.required_roots.filter((row: any) => row.disposition === 'static-path-recovered') : []
  if (r1.status !== 'complete' || recoveredRoots.length !== 15) fail('r4_static_incomplete', 'R1 must recover all 15 required roots before R4 can claim complete static analysis')
  const r2Sha = sha256File(r2Path); const r3Sha = sha256File(r3Path); const indexSha = sha256File(values['artifact-index']!); const leakSha = sha256File(leakPath); const rerunSha = sha256File(rerunPath)
  const artifactIndex = JSON.parse(readFileSync(values['artifact-index']!, 'utf8')) as { artifacts: Array<{ artifact_id: string; sha256: string; relative_path?: string }> }
  verifyArtifactIndex(artifactIndex, evidenceRoot)
  const leak = JSON.parse(readFileSync(leakPath, 'utf8')) as Record<string, any>
  if (leak.schema_version !== 'oracle-lab-phase3a-leak-scan.v1' || leak.status !== 'PASS' || leak.index_sha256 !== indexSha || !Array.isArray(leak.findings) || leak.findings.length !== 0) fail('r4_input_invalid', 'leak scan must pass against the supplied artifact index')
  const artifactById = new Map(artifactIndex.artifacts.map((row) => [row.artifact_id, row]))
  indexedArtifact(artifactById, R2_ARTIFACT_ID, r2Sha, 'R2 closure')
  indexedArtifact(artifactById, R3_ARTIFACT_ID, r3Sha, 'R3 closure')
  indexedArtifact(artifactById, TLS_ARTIFACT_ID, sha256File(tlsPath), 'TLS summary')
  indexedArtifact(artifactById, CROSS_PLATFORM_ARTIFACT_ID, sha256File(crossPlatformPath), 'cross-platform summary')
  assertDeterministic(r2, 'R2')
  assertDeterministic(r3, 'R3')
  const environmentCoverage = r2EnvironmentCoverage(r2)
  const envReproduced = environmentCoverage.reproduced
  const envUnknown = environmentCoverage.unknown
  const coverageComplete = environmentCoverage.complete
  const changePoints = Array.isArray(r3.tier_a?.lanes)
    ? r3.tier_a.lanes
    : Array.isArray(r3.lanes)
      ? r3.lanes
      : [{ target: 'sub2api-adapter', status: r3.status, tier_a_tests: r3.tier_a?.total_tests, tier_b: r3.tier_b?.status }]
  const expectedTierAVersions = ['2.1.214', '2.1.212', '2.1.211', '2.1.208', '2.1.207']
  if (changePoints.length !== expectedTierAVersions.length || expectedTierAVersions.some((version) => changePoints.filter((lane: any) => lane.version === version && lane.role === 'tier-a').length !== 1)) fail('r4_input_invalid', 'R3 must contain exactly the five expected Tier A lanes')
  assertTierAProjectionSupport(evidenceRoot, artifactById, changePoints)
  const rerun = JSON.parse(readFileSync(rerunPath, 'utf8')) as Record<string, any>
  assertTierARerunArtifact(evidenceRoot, rerun, rerunSha, artifactById)
  const tierA = tierATerminalUnknowns(changePoints, rerun)
  const tlsUnknown = tlsTerminalUnknown(JSON.parse(readFileSync(tlsPath, 'utf8')) as Record<string, any>)
  const crossPlatformUnknown = crossPlatformTerminalUnknown(JSON.parse(readFileSync(crossPlatformPath, 'utf8')) as Record<string, any>)
  const conclusions = closureConclusions({ environment_complete: coverageComplete, tier_a_complete: tierA.open.length === 0 })
  const indexedIds = new Set(artifactIndex.artifacts.map((row) => row.artifact_id))
  for (const row of conclusions) for (const id of row.conclusion.supporting_artifact_ids) if (!indexedIds.has(id)) fail('r4_support_unresolved', `conclusion support is not indexed: ${id}`)
  const executableUnknowns = (r2.coverage ?? []).filter((row: any) => row.evidence_level === 'Unknown')
  const r2Unknowns = executableUnknowns.map((row: Record<string, any>) => r2TerminalUnknown(row, r2))
  const missingGates = [
    ...(coverageComplete ? [] : ['environment-routing-protocol-coverage']),
    ...(Array.isArray(r3.tier_a?.lanes) && r3.tier_a.lanes.length === 5 ? [] : ['claude-code-tier-a-change-points']),
    ...tierA.open.map((lane: any) => `claude-code-tier-a-dynamic-${String(lane.version ?? lane.hypothesis_id)}`),
  ]
  const terminalUnknowns = [
    ...r2Unknowns,
    ...tierA.closed,
    tlsUnknown,
    crossPlatformUnknown,
  ]
  const input: CuratedExitInput = {
    ...template, generated_at: '2026-07-21T12:00:00.000Z', exit_report_path: evidenceRelativePath(evidenceRoot, values['out-exit']!), artifact_index_sha256: indexSha,
    repositories: [
      captureRepositoryBinding(values['cc-root']!, { repository: 'cc-gateway', base: values['cc-base']!, freezeHead: values['cc-freeze']! }),
      captureRepositoryBinding(values['sub2api-root']!, { repository: 'sub2api', base: values['sub2api-base']!, freezeHead: values['sub2api-freeze']! }),
    ], repository_capture_required: false,
    static_analysis: {
      phase_status: 'COMPLETE', required_root_count: 15, required_root_unknown_count: 0,
      entry_module_ast: 'recovered-module-slices', module_slice_count: r1.module_slices?.count ?? null,
      r1_static_closure_sha256: r1Sha, census_sha256: censusSha, discovery_artifact_sha256: r1.discovery_artifact_sha256 ?? null,
      recovered_roots: recoveredRoots.map((row: any) => row.root), limitations: r1.limitations ?? [],
    },
    coverage: {
      active: [{
        platform: 'darwin-arm64', status: coverageComplete ? 'complete' : 'partial',
        environment_pairs: 60, environment_reproduced_pairs: envReproduced, environment_unknown_pairs: envUnknown,
        scenario_pairs: 9, config_pairs: 4, auth_pairs: 4, reproduced_hypotheses: r2.coverage_counts?.Reproduced ?? 0,
      }],
      change_points: changePoints,
      omitted: terminalUnknowns.map((row) => ({ cell: row.concern, reason: row.reason, next_minimal_action: row.next_minimal_action, phase3b_usable: false })),
    },
    protocol_runtime_summaries: [
      { closure: 'R2', sha256: r2Sha, status: r2.status, reproduced: r2.coverage_counts?.Reproduced ?? 0, unknown: r2.coverage_counts?.Unknown ?? 0 },
      { closure: 'R3', sha256: r3Sha, status: r3.status, tier_a: r3.tier_a ?? null, tier_b: r3.tier_b ?? null, lanes: changePoints },
      { closure: 'TLS', sha256: sha256File(tlsPath), status: 'OBSERVED', phase3b_usable: false },
      { closure: 'CROSS_PLATFORM', sha256: sha256File(crossPlatformPath), status: 'STATIC_CORROBORATED', phase3b_usable: false },
    ],
    perturbation_source_agreement: { instrumentation: 'instrumentation-equivalent', saturation: 'SATURATED', source_count: 3, external_socket_budget: 0 },
    evidence_health: { contradictions: [], expired: [], errors: [{ category: 'append-only-superseded-campaigns-retained' }], unknowns: terminalUnknowns },
    conclusions,
    p2_mapping: { wire: 'Reproduced-local-loopback', semantic: 'Reproduced-local-loopback', state_sequence: 'Unknown-resume-untriggered', failure_semantics: 'Reproduced-local-loopback', bundle_unchanged: true },
    evidence_hygiene: { leak_scan: 'PASS', leak_scan_sha256: leakSha, artifact_index_sha256: indexSha, retention: 'retained', no_deletion: true, append_only: true },
    reproduction: { commands: ['npm exec tsx tests/oracle-phase3a-exit.test.ts', 'npm exec tsx tests/oracle-phase3a-handoff.test.ts', 'npm exec tsx tests/oracle-phase3a-r2-closure.test.ts', 'npm exec tsx tests/oracle-phase3a-r3-closure.test.ts'], unavailable_tools: ['second-platform-runner'] },
    phase3b: { ...template.phase3b, negative_capabilities: [...new Set(terminalUnknowns.map((row) => String(row.concern)))], rollback_reference: template.p2 },
    missing_gates: missingGates,
  }
  const first = buildBlockedDeliverables(input); const second = buildBlockedDeliverables(input)
  if (canonicalJson(first) !== canonicalJson(second)) fail('r4_nondeterministic', 'R4 deliverables are not byte deterministic')
  const outputFiles = [values['out-input']!, values['out-exit']!, values['out-markdown']!, values['out-handoff']!]
  for (const file of outputFiles) { assertEvidencePath(evidenceRoot, file); if (existsSync(file)) fail('evidence_exists', `R4 output already exists: ${path.basename(file)}`) }
  for (const file of outputFiles) mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(values['out-input']!, `${canonicalJson(input)}\n`, { flag: 'wx', mode: 0o600 })
  writeFileSync(values['out-exit']!, `${canonicalJson(first.exit)}\n`, { flag: 'wx', mode: 0o600 })
  writeFileSync(values['out-markdown']!, first.markdown, { flag: 'wx', mode: 0o600 })
  writeFileSync(values['out-handoff']!, `${canonicalJson(first.handoff)}\n`, { flag: 'wx', mode: 0o600 })
  process.stdout.write(`${canonicalJson({ status: first.exit.status, exit_sha256: sha256File(values['out-exit']!), handoff_sha256: sha256File(values['out-handoff']!), usable_conclusions: first.handoff.usable_conclusion_ids.length, unknown_conclusions: first.handoff.unknown_conclusion_ids.length })}\n`)
}
