import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalJson, Phase3AError, sha256Bytes, sha256File } from './core.js'
import { projectTierADynamicLane } from './tier-a-dynamic-projection.js'

export const TIER_A_LANES = [
  {
    version: '2.1.214',
    hypothesis_id: 'r3-214-otel-stream-restart-keepalive',
    reason: 'immediate substantive predecessor: OTel correlation/content limit, long-tool heartbeat, stream-json drain, background daemon/restart, keep-alive retry changes',
    required_pairs: ['telemetry', 'long-run', 'stream', 'restart', 'keep-alive'],
  },
  {
    version: '2.1.212',
    hypothesis_id: 'r3-212-lineage-restart-otel-cache',
    reason: '/fork//subtask lineage, streaming control restart, OTel export/context, gateway prompt-cache system block',
    required_pairs: ['lineage', 'restart', 'otel', 'compact-cache'],
  },
  {
    version: '2.1.211',
    hypothesis_id: 'r3-211-baseurl-restart-cache',
    reason: 'background Base URL auth after daemon respawn and cross-provider prompt-cache regression',
    required_pairs: ['base-url-background-restart', 'compact-cache'],
  },
  {
    version: '2.1.208',
    hypothesis_id: 'r3-208-process-wrapper-lineage',
    reason: 'CLAUDE_CODE_PROCESS_WRAPPER and self-spawn routing',
    required_pairs: ['process-wrapper-child-lineage'],
  },
  {
    version: '2.1.207',
    hypothesis_id: 'r3-207-predecessor-boundary',
    reason: 'frozen predecessor target for P2 program and nearest pre-2.1.208 boundary',
    required_pairs: ['active-vs-predecessor-core'],
  },
] as const

export type TierALaneInput = {
  version: string
  role: 'tier-a'
  hypothesis_id: string
  reason: string
  intake: {
    package: string
    version: string
    source_url: string
    archive_sha256: string
    tree_sha256?: string | null
    entrypoint_sha256?: string | null
    artifact_path?: string | null
  }
  structural: {
    status: 'PASS' | 'REPRODUCED' | 'CLOSED_WITH_UNKNOWN'
    method: string
    semantic_change: boolean
    active_entrypoint_sha256: string
    control_entrypoint_sha256: string | null
    active_tree_sha256?: string | null
    control_tree_sha256?: string | null
    digest?: string | null
  }
  dynamic: {
    status: 'PASS' | 'REPRODUCED' | 'CLOSED_WITH_UNKNOWN' | 'UNKNOWN'
    pair_count: number
    required_pairs: string[]
    next_minimal_action?: string | null
    evidence?: {
      campaign_summary_path?: string
      campaign_summary_sha256?: string
      lane_summary_path?: string
      lane_summary_sha256?: string
      projection_path?: string
      projection_sha256?: string
    }
  }
}

function fail(code: string, message: string): never { throw new Phase3AError(code, message) }

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

export function evaluateClaudeCodeR3Closure(input: {
  active_version: string
  active_entrypoint_sha256: string
  active_tree_sha256?: string | null
  lanes: TierALaneInput[]
}): Record<string, any> {
  if (input.active_version !== '2.1.215') fail('r3_active_invalid', 'active Claude Code version must be 2.1.215')
  if (!isSha256(input.active_entrypoint_sha256)) fail('r3_active_digest_invalid', 'active entrypoint digest must be SHA-256')
  if (input.lanes.length !== TIER_A_LANES.length) fail('r3_tier_a_incomplete', `Tier A requires exactly ${TIER_A_LANES.length} Claude Code lanes`)

  const lanes = TIER_A_LANES.map((expected) => {
    const lane = input.lanes.find((row) => row.version === expected.version)
    if (!lane) fail('r3_tier_a_missing', `missing Tier A lane for ${expected.version}`)
    if (lane.role !== 'tier-a') fail('r3_tier_a_role_invalid', `lane role must be tier-a for ${expected.version}`)
    if ((lane as { target?: string }).target === 'sub2api-adapter' || (lane as { tier_a_tests?: number }).tier_a_tests !== undefined) {
      fail('r3_wrong_target', 'Sub2API adapter regression is not Claude Code Tier A')
    }
    if (lane.hypothesis_id !== expected.hypothesis_id) fail('r3_hypothesis_invalid', `hypothesis mismatch for ${expected.version}`)
    if (!isSha256(lane.intake.archive_sha256)) fail('r3_intake_invalid', `archive digest missing for ${expected.version}`)
    if (lane.intake.version !== expected.version) fail('r3_intake_version_drift', `intake version drift for ${expected.version}`)
    if (!['PASS', 'REPRODUCED', 'CLOSED_WITH_UNKNOWN'].includes(lane.structural.status)) {
      fail('r3_structural_incomplete', `structural status invalid for ${expected.version}`)
    }
    if (!isSha256(lane.structural.active_entrypoint_sha256) || lane.structural.active_entrypoint_sha256 !== input.active_entrypoint_sha256) {
      fail('r3_structural_active_mismatch', `structural active entrypoint mismatch for ${expected.version}`)
    }
    const expectedPairs = [...expected.required_pairs].sort()
    const actualPairs = Array.isArray(lane.dynamic.required_pairs) ? [...new Set(lane.dynamic.required_pairs)].sort() : []
    if (lane.dynamic.status === 'PASS' || lane.dynamic.status === 'REPRODUCED') {
      if (lane.dynamic.pair_count !== expectedPairs.length) fail('r3_dynamic_pair_count', `dynamic pair count must equal required pairs for ${expected.version}`)
      if (canonicalJson(actualPairs) !== canonicalJson(expectedPairs)) fail('r3_dynamic_pair_coverage', `dynamic required pairs do not match lane requirements for ${expected.version}`)
    }
    const status = lane.dynamic.status === 'UNKNOWN' ? 'CLOSED_WITH_UNKNOWN' : lane.structural.status === 'PASS' && ['PASS', 'REPRODUCED'].includes(lane.dynamic.status)
      ? 'PASS'
      : lane.dynamic.status === 'REPRODUCED' || lane.structural.status === 'REPRODUCED'
        ? 'REPRODUCED'
        : 'CLOSED_WITH_UNKNOWN'
    return {
      version: expected.version,
      role: 'tier-a' as const,
      hypothesis_id: expected.hypothesis_id,
      reason: expected.reason,
      status,
      intake: lane.intake,
      structural: lane.structural,
      dynamic: {
        ...lane.dynamic,
        required_pairs: [...expected.required_pairs],
        next_minimal_action: ['PASS', 'REPRODUCED'].includes(lane.dynamic.status)
          ? null
          : lane.dynamic.next_minimal_action
            ?? `Run bounded loopback pairs for ${expected.required_pairs.join(', ')} against control ${expected.version} and stop after first resolving observation.`,
      },
    }
  })

  const unresolvedDynamic = lanes.filter((lane) => !['PASS', 'REPRODUCED'].includes(lane.dynamic.status)).length
  const status = unresolvedDynamic === 0 && lanes.every((lane) => ['PASS', 'REPRODUCED'].includes(lane.status))
    ? 'PASS'
    : 'CLOSED_WITH_UNKNOWN'
  const base = {
    schema_version: 'oracle-lab-phase3a-r3-closure.v1',
    status,
    target: 'claude-code-tier-a-change-points',
    active: {
      version: input.active_version,
      entrypoint_sha256: input.active_entrypoint_sha256,
      tree_sha256: input.active_tree_sha256 ?? null,
    },
    tier_a: {
      status: lanes.every((lane) => ['PASS', 'REPRODUCED'].includes(lane.structural.status)) ? 'PASS' : 'CLOSED_WITH_UNKNOWN',
      lane_count: lanes.length,
      versions: lanes.map((lane) => lane.version),
      lanes,
    },
    tier_b: {
      status: 'SKIPPED_BY_RULE',
      triggers: [],
      reason: 'Tier A Claude Code change-point lanes are mandatory first; Tier B yields until Tier A intake/static/dynamic questions are resolved or budget-exhausted',
    },
    external_socket_budget: 0,
    raw_material_persisted: false,
  }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

/** @deprecated adapter regression is not Claude Code Tier A; retained only for explicit negative tests. */
export function evaluateR3Closure(intake: {
  commit: string
  tree: string
  base_commit: string
  worktree_clean: boolean
  changed_files: string[]
  target_tests: number
  boundary_tests: number
}): never {
  fail('r3_wrong_target', 'Sub2API adapter regression is not Claude Code Tier A; use evaluateClaudeCodeR3Closure')
}

export function parseR3ClosureArgs(argv: string[]): Record<string, string> {
  const values = argv[0] === '--' ? argv.slice(1) : argv
  const output: Record<string, string> = {}
  const allowed = new Set(['evidence-root', 'out', 'active-version', 'dynamic-projections'])
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith('--') || !values[index + 1] || values[index + 1].startsWith('--')) fail('invalid_arguments', 'arguments must be --name value pairs')
    const name = values[index].slice(2)
    if (!allowed.has(name)) fail('invalid_arguments', `unknown argument: --${name}`)
    if (output[name] !== undefined) fail('invalid_arguments', `duplicate argument: --${name}`)
    output[name] = values[index + 1]
  }
  return output
}

function loadPlatformArtifact(evidenceRoot: string, version: string): Record<string, any> {
  const artifactPath = path.join(evidenceRoot, 'intake', 'platform', version, 'artifact.json')
  if (!existsSync(artifactPath)) fail('r3_intake_missing', `missing platform intake artifact for ${version}: ${artifactPath}`)
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as Record<string, any>
  if (artifact.version !== version) fail('r3_intake_version_drift', `artifact version drift for ${version}`)
  if (!isSha256(artifact.archive_sha256)) fail('r3_intake_invalid', `invalid archive digest for ${version}`)
  return { ...artifact, artifact_path: artifactPath, artifact_sha256: sha256File(artifactPath) }
}

function loadDynamicLane(evidenceRoot: string, dynamicRoot: string, expected: (typeof TIER_A_LANES)[number]): TierALaneInput['dynamic'] {
  const root = path.resolve(evidenceRoot)
  const campaignRoot = path.resolve(root, dynamicRoot)
  const relativeRoot = path.relative(root, campaignRoot)
  if (relativeRoot === '' || relativeRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRoot)) fail('r3_dynamic_path_invalid', 'dynamic campaign must be inside evidence root')
  const campaignPath = path.join(campaignRoot, 'summary.json')
  const lanePath = path.join(campaignRoot, 'lanes', expected.version, 'summary.json')
  if (!existsSync(campaignPath) || !existsSync(lanePath)) fail('r3_dynamic_evidence_missing', `missing dynamic evidence for ${expected.version}`)
  const campaign = JSON.parse(readFileSync(campaignPath, 'utf8')) as Record<string, any>
  const lane = JSON.parse(readFileSync(lanePath, 'utf8')) as Record<string, any>
  if (campaign.external_socket_budget !== 0 || lane.external_socket_budget !== 0 || campaign.raw_material_persisted !== false || lane.raw_material_persisted !== false) {
    fail('r3_dynamic_evidence_invalid', `dynamic evidence safety invariant failed for ${expected.version}`)
  }
  if (lane.version !== expected.version || lane.hypothesis_id !== expected.hypothesis_id || !Array.isArray(lane.pairs)) {
    fail('r3_dynamic_evidence_invalid', `dynamic lane identity invalid for ${expected.version}`)
  }
  const pairs = lane.pairs as Array<Record<string, any>>
  const pairNames = [...new Set(pairs.map((pair) => String(pair.required_pair)))].sort()
  const expectedPairs = [...expected.required_pairs].sort()
  if (pairs.length !== expectedPairs.length || canonicalJson(pairNames) !== canonicalJson(expectedPairs)) {
    fail('r3_dynamic_pair_coverage', `dynamic pair coverage invalid for ${expected.version}`)
  }
  if (pairs.some((pair) => pair.status !== 'REPRODUCED' || pair.external_socket_budget !== 0 || pair.raw_material_persisted !== false)) {
    fail('r3_dynamic_pair_incomplete', `dynamic pair did not reproduce safely for ${expected.version}`)
  }
  return {
    status: lane.status === 'REPRODUCED' ? 'REPRODUCED' : 'CLOSED_WITH_UNKNOWN',
    pair_count: pairs.length,
    required_pairs: pairNames,
    next_minimal_action: lane.status === 'REPRODUCED' ? null : `Resolve incomplete dynamic pairs for ${expected.version}`,
    evidence: {
      campaign_summary_path: path.relative(root, campaignPath),
      campaign_summary_sha256: sha256File(campaignPath),
      lane_summary_path: path.relative(root, lanePath),
      lane_summary_sha256: sha256File(lanePath),
    },
  }
}

function loadDynamicProjection(evidenceRoot: string, projectionInput: string, expected: (typeof TIER_A_LANES)[number]): TierALaneInput['dynamic'] {
  const root = path.resolve(evidenceRoot)
  const projectionPath = path.resolve(root, projectionInput)
  const relative = path.relative(root, projectionPath)
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !existsSync(projectionPath)) fail('r3_dynamic_projection_invalid', 'dynamic projection must be an evidence-root file')
  const projection = JSON.parse(readFileSync(projectionPath, 'utf8')) as Record<string, any>
  if (projection.schema_version !== 'oracle-lab-phase3a-tier-a-dynamic-projection.v2' || projection.version !== expected.version || projection.hypothesis_id !== expected.hypothesis_id || !['REPRODUCED', 'UNKNOWN'].includes(projection.status) || projection.external_socket_budget !== 0 || projection.raw_material_persisted !== false || !Array.isArray(projection.pairs)) {
    fail('r3_dynamic_projection_invalid', `dynamic projection is invalid for ${expected.version}`)
  }
  const pairs = projection.pairs as Array<Record<string, any>>
  const pairNames = [...new Set(pairs.map((pair) => String(pair.required_pair)))].sort()
  const expectedPairs = [...expected.required_pairs].sort()
  if (pairs.length !== expectedPairs.length || canonicalJson(pairNames) !== canonicalJson(expectedPairs)) fail('r3_dynamic_projection_incomplete', `dynamic projection lacks required pair coverage for ${expected.version}`)
  const bindings = projection.source_bindings as Record<string, any>
  if (!bindings || !isSha256(bindings.campaign_summary_sha256) || !isSha256(bindings.lane_summary_sha256) || typeof bindings.campaign_summary_path !== 'string' || typeof bindings.lane_summary_path !== 'string') fail('r3_dynamic_projection_invalid', `dynamic projection source bindings are invalid for ${expected.version}`)
  const sourcePath = (relativePath: string): string => {
    const absolute = path.resolve(root, relativePath)
    const relation = path.relative(root, absolute)
    if (relation === '' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation) || !existsSync(absolute)) fail('r3_dynamic_projection_invalid', `dynamic projection source is unavailable for ${expected.version}`)
    return absolute
  }
  const campaignPath = sourcePath(bindings.campaign_summary_path)
  const lanePath = sourcePath(bindings.lane_summary_path)
  if (sha256File(campaignPath) !== bindings.campaign_summary_sha256 || sha256File(lanePath) !== bindings.lane_summary_sha256) fail('r3_dynamic_projection_invalid', `dynamic projection source hash mismatch for ${expected.version}`)
  const regenerated = projectTierADynamicLane({
    campaign: JSON.parse(readFileSync(campaignPath, 'utf8')) as Record<string, any>,
    lane: JSON.parse(readFileSync(lanePath, 'utf8')) as Record<string, any>,
    campaign_summary_path: bindings.campaign_summary_path,
    lane_summary_path: bindings.lane_summary_path,
    campaign_summary_sha256: bindings.campaign_summary_sha256,
    lane_summary_sha256: bindings.lane_summary_sha256,
  })
  if (canonicalJson(projection) !== canonicalJson(regenerated)) fail('r3_dynamic_projection_invalid', `dynamic projection does not reproduce its source summaries for ${expected.version}`)
  if (pairs.some((pair) => pair.external_socket_budget !== 0 || pair.raw_material_persisted !== false)) fail('r3_dynamic_projection_invalid', `dynamic projection safety invariant failed for ${expected.version}`)
  const reproduced = projection.status === 'REPRODUCED' && pairs.every((pair) => pair.status === 'REPRODUCED' && Number(pair.terminal_cells) >= 10 && Number(pair.dual_source_cells) >= 10 && Number(pair.protocol_cells) >= 10)
  return {
    status: reproduced ? 'REPRODUCED' : 'CLOSED_WITH_UNKNOWN',
    pair_count: pairs.length,
    required_pairs: pairNames,
    next_minimal_action: reproduced ? null : `Resolve incomplete dynamic pairs for ${expected.version}`,
    evidence: { projection_path: path.relative(root, projectionPath), projection_sha256: sha256File(projectionPath) },
  }
}

function buildLaneFromIntake(active: Record<string, any>, control: Record<string, any>, expected: (typeof TIER_A_LANES)[number], dynamic?: TierALaneInput['dynamic']): TierALaneInput {
  const controlEntrypoint = typeof control.entrypoint_sha256 === 'string' ? control.entrypoint_sha256 : null
  const activeEntrypoint = String(active.entrypoint_sha256)
  const semanticChange = Boolean(controlEntrypoint && controlEntrypoint !== activeEntrypoint)
    || Boolean(control.tree_sha256 && active.tree_sha256 && control.tree_sha256 !== active.tree_sha256)
  const structuralBase = {
    method: 'platform-entrypoint-tree-digest-delta',
    semantic_change: semanticChange,
    active_entrypoint_sha256: activeEntrypoint,
    control_entrypoint_sha256: controlEntrypoint,
    active_tree_sha256: active.tree_sha256 ?? null,
    control_tree_sha256: control.tree_sha256 ?? null,
  }
  return {
    version: expected.version,
    role: 'tier-a',
    hypothesis_id: expected.hypothesis_id,
    reason: expected.reason,
    intake: {
      package: String(control.package),
      version: String(control.version),
      source_url: String(control.source_url),
      archive_sha256: String(control.archive_sha256),
      tree_sha256: control.tree_sha256 ?? null,
      entrypoint_sha256: controlEntrypoint,
      artifact_path: control.artifact_path ?? null,
    },
    structural: {
      status: controlEntrypoint ? 'PASS' : 'CLOSED_WITH_UNKNOWN',
      ...structuralBase,
      digest: sha256Bytes(canonicalJson(structuralBase)),
    },
    dynamic: dynamic ?? {
      status: 'CLOSED_WITH_UNKNOWN',
      pair_count: 0,
      required_pairs: [...expected.required_pairs],
      next_minimal_action: `Run bounded loopback pairs for ${expected.required_pairs.join(', ')} against control ${expected.version} and stop after first resolving observation.`,
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const values = parseR3ClosureArgs(process.argv.slice(2))
  const evidenceRoot = values['evidence-root']
  const out = values.out
  const activeVersion = values['active-version'] ?? '2.1.215'
  if (!evidenceRoot || !out) fail('usage', 'r3-closure requires --evidence-root and --out')
  if (activeVersion !== '2.1.215') fail('r3_active_invalid', 'active Claude Code version must be 2.1.215')
  const active = loadPlatformArtifact(evidenceRoot, activeVersion)
  if (!isSha256(active.entrypoint_sha256)) fail('r3_active_digest_invalid', 'active platform entrypoint digest is required')
  const dynamicProjections = values['dynamic-projections']?.split(',').filter(Boolean) ?? []
  const dynamicByVersion = new Map<string, TierALaneInput['dynamic']>()
  if (dynamicProjections.length !== TIER_A_LANES.length) fail('r3_dynamic_projection_incomplete', 'exactly five dynamic projections are required')
  for (const projection of dynamicProjections) {
    const absolute = path.resolve(evidenceRoot, projection)
    if (!existsSync(absolute)) fail('r3_dynamic_projection_invalid', `dynamic projection does not exist: ${projection}`)
    const version = String((JSON.parse(readFileSync(absolute, 'utf8')) as Record<string, any>).version)
    const expected = TIER_A_LANES.find((lane) => lane.version === version)
    if (!expected || dynamicByVersion.has(version)) fail('r3_dynamic_projection_invalid', 'dynamic projections must cover each Tier A version exactly once')
    dynamicByVersion.set(version, loadDynamicProjection(evidenceRoot, projection, expected))
  }
  const lanes = TIER_A_LANES.map((expected) => buildLaneFromIntake(active, loadPlatformArtifact(evidenceRoot, expected.version), expected, dynamicByVersion.get(expected.version)))
  const result = evaluateClaudeCodeR3Closure({
    active_version: activeVersion,
    active_entrypoint_sha256: String(active.entrypoint_sha256),
    active_tree_sha256: active.tree_sha256 ?? null,
    lanes,
  })
  mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 })
  writeFileSync(out, `${canonicalJson(result)}\n`, { flag: 'wx', mode: 0o600 })
  process.stdout.write(`${canonicalJson(result)}\n`)
}
