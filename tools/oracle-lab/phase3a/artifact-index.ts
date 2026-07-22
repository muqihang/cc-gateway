import { lstatSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { canonicalJson, Phase3AError, sha256Bytes, sha256File } from './core.js'
import { assertPhase3A } from './schemas.js'

export type ArtifactIndexInput = {
  artifact_id: string
  relative_path: string
  media_type: string
  source_url: string | null
  scope: string
  requirement_ids: string[]
  sensitivity: 'public-official' | 'synthetic-raw' | 'normalized-safe' | 'quarantine'
  redaction_transform: string
  retention_class: 'synthetic-raw-14d' | 'normalized-until-phase3b' | 'official-artifact-until-acceptance' | 'quarantine-24h'
  expiry: string
  disposition: 'retain' | 'cleanup-candidate' | 'quarantined' | 'superseded-non-reproducible'
  parser_name: string
  parser_version: string
  parser_agreement: 'single-parser' | 'agreed' | 'disagreed' | 'not-applicable'
  negative_result?: string | null
  parent_artifact_ids?: string[]
}

function assertParentGraph(rows: Array<Record<string, unknown>>): void {
  const byId = new Map(rows.map((row) => [String(row.artifact_id), row]))
  if (byId.size !== rows.length) throw new Phase3AError('duplicate_artifact_id', 'artifact index contains duplicate ids')
  for (const row of rows) {
    for (const parent of row.parent_artifact_ids as string[]) {
      if (!byId.has(parent)) throw new Phase3AError('orphan_artifact', `missing parent artifact: ${parent}`)
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (artifactId: string): void => {
    if (visiting.has(artifactId)) throw new Phase3AError('artifact_parent_cycle', `artifact parent cycle includes: ${artifactId}`)
    if (visited.has(artifactId)) return
    visiting.add(artifactId)
    const row = byId.get(artifactId)!
    for (const parent of row.parent_artifact_ids as string[]) visit(parent)
    visiting.delete(artifactId)
    visited.add(artifactId)
  }
  for (const artifactId of [...byId.keys()].sort()) visit(artifactId)
}

function absoluteArtifact(evidenceRootInput: string, relative: string): string {
  const evidenceRoot = realpathSync(evidenceRootInput)
  if (!relative || path.isAbsolute(relative) || path.posix.normalize(relative) !== relative || relative.split('/').includes('..')) {
    throw new Phase3AError('path_outside_evidence_root', 'artifact path must be normalized and relative')
  }
  const candidate = path.join(evidenceRoot, ...relative.split('/'))
  const resolved = realpathSync(candidate)
  const relation = path.relative(evidenceRoot, resolved)
  if (relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new Phase3AError('path_outside_evidence_root', 'artifact resolves outside evidence root')
  }
  if (!lstatSync(candidate).isFile()) throw new Phase3AError('artifact_hash_mismatch', 'artifact is not a regular file')
  return candidate
}

export function artifactRow(input: ArtifactIndexInput, context: { evidenceRoot: string; toolchainDigest: string; commandDigest: string; verificationDigest: string }): Record<string, unknown> {
  const absolute = absoluteArtifact(context.evidenceRoot, input.relative_path)
  const stat = statSync(absolute)
  return {
    artifact_schema_version: 'oracle-lab-phase3a-artifact.v1', artifact_id: input.artifact_id, run_id: null,
    parent_artifact_ids: input.parent_artifact_ids ?? [], relative_path: input.relative_path, media_type: input.media_type,
    byte_size: stat.size, sha256: sha256File(absolute), source_url: input.source_url,
    generating_command_digest: context.commandDigest, verification_command_digest: context.verificationDigest, toolchain_digest: context.toolchainDigest,
    created_at: stat.mtime.toISOString(), scope: input.scope, requirement_ids: input.requirement_ids, owner: 'phase3a-primary', reviewer: null,
    sensitivity: input.sensitivity, redaction_transform: input.redaction_transform, retention_class: input.retention_class, expiry: input.expiry,
    destruction_procedure: 'list as cleanup candidate; deletion requires separate operator approval', disposition: input.disposition,
    environment_fingerprint_cell: 'P3A-0-darwin-arm64', parser_name: input.parser_name, parser_version: input.parser_version,
    parser_agreement: input.parser_agreement, negative_result: input.negative_result ?? null, contradiction_ids: [], contradiction_status: 'none',
    validation_status: input.sensitivity === 'quarantine' ? 'quarantined' : 'valid', run_digest: null, conclusion_digests: [],
  }
}

export function buildArtifactIndex(input: { evidenceRoot: string; evidenceRootId: string; generatedAt: string; previousIndexSha256: string | null; toolchainDigest: string; artifacts: ArtifactIndexInput[] }): Record<string, unknown> {
  const commandDigest = sha256Bytes(canonicalJson({ command: 'phase3a-artifact-index-v1', evidence_root_id: input.evidenceRootId }))
  const verificationDigest = sha256Bytes(canonicalJson({ command: 'phase3a-artifact-index-verify-v1', algorithm: 'sha256-streaming' }))
  const ids = new Set<string>()
  const rows = input.artifacts.map((artifact) => {
    if (ids.has(artifact.artifact_id)) throw new Phase3AError('duplicate_artifact_id', `duplicate artifact id: ${artifact.artifact_id}`)
    ids.add(artifact.artifact_id)
    return artifactRow(artifact, { evidenceRoot: input.evidenceRoot, toolchainDigest: input.toolchainDigest, commandDigest, verificationDigest })
  })
  assertParentGraph(rows)
  const index = { schema_version: 'oracle-lab-phase3a-artifact-index.v1', generated_at: input.generatedAt, evidence_root_id: input.evidenceRootId, previous_index_sha256: input.previousIndexSha256, artifacts: rows }
  assertPhase3A('artifact-index', index)
  return index
}

export function verifyArtifactIndex(index: any, evidenceRoot: string): void {
  assertPhase3A('artifact-index', index)
  assertParentGraph(index.artifacts)
  for (const row of index.artifacts) {
    const absolute = absoluteArtifact(evidenceRoot, row.relative_path)
    if (statSync(absolute).size !== row.byte_size || sha256File(absolute) !== row.sha256) {
      throw new Phase3AError('artifact_hash_mismatch', `artifact bytes disagree: ${row.artifact_id}`)
    }
  }
}

export function writeArtifactIndex(index: Record<string, unknown>, output: string): string {
  writeFileSync(output, `${canonicalJson(index)}\n`, { flag: 'wx', mode: 0o600 })
  return sha256File(output)
}
