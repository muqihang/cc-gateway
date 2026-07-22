import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalJson, Phase3AError, sha256Bytes, sha256File } from './core.js'

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
        next_minimal_action: lane.dynamic.next_minimal_action
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

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

function loadPlatformArtifact(evidenceRoot: string, version: string): Record<string, any> {
  const artifactPath = path.join(evidenceRoot, 'intake', 'platform', version, 'artifact.json')
  if (!existsSync(artifactPath)) fail('r3_intake_missing', `missing platform intake artifact for ${version}: ${artifactPath}`)
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as Record<string, any>
  if (artifact.version !== version) fail('r3_intake_version_drift', `artifact version drift for ${version}`)
  if (!isSha256(artifact.archive_sha256)) fail('r3_intake_invalid', `invalid archive digest for ${version}`)
  return { ...artifact, artifact_path: artifactPath, artifact_sha256: sha256File(artifactPath) }
}

function buildLaneFromIntake(active: Record<string, any>, control: Record<string, any>, expected: (typeof TIER_A_LANES)[number]): TierALaneInput {
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
    dynamic: {
      status: 'CLOSED_WITH_UNKNOWN',
      pair_count: 0,
      required_pairs: [...expected.required_pairs],
      next_minimal_action: `Run bounded loopback pairs for ${expected.required_pairs.join(', ')} against control ${expected.version} and stop after first resolving observation.`,
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const evidenceRoot = argument('--evidence-root')
  const out = argument('--out')
  const activeVersion = argument('--active-version') ?? '2.1.215'
  if (!evidenceRoot || !out) fail('usage', 'r3-closure requires --evidence-root and --out')
  if (activeVersion !== '2.1.215') fail('r3_active_invalid', 'active Claude Code version must be 2.1.215')
  const active = loadPlatformArtifact(evidenceRoot, activeVersion)
  if (!isSha256(active.entrypoint_sha256)) fail('r3_active_digest_invalid', 'active platform entrypoint digest is required')
  const lanes = TIER_A_LANES.map((expected) => buildLaneFromIntake(active, loadPlatformArtifact(evidenceRoot, expected.version), expected))
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
