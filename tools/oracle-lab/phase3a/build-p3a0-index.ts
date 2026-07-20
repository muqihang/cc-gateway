import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildArtifactIndex, verifyArtifactIndex, writeArtifactIndex, type ArtifactIndexInput } from './artifact-index.js'
import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256File, stableError } from './core.js'

const VERSION = '2.1.215'
const REQUIREMENTS = ['HA-P0-003', 'HA-P0-006', 'HA-P0-007']
const RETAIN = '2027-07-20T00:00:00.000Z'
const QUARANTINE = '2026-07-21T00:00:00.000Z'

function official(id: string, relative_path: string, media_type: string, source_url: string | null, parser = 'phase3a-intake'): ArtifactIndexInput {
  return { artifact_id: id, relative_path, media_type, source_url, scope: 'P3A-0', requirement_ids: REQUIREMENTS, sensitivity: 'public-official', redaction_transform: 'none', retention_class: 'official-artifact-until-acceptance', expiry: RETAIN, disposition: 'retain', parser_name: parser, parser_version: 'v1', parser_agreement: 'agreed' }
}

export function buildP3A0Index(evidenceRootInput: string): { index_path: string; index_sha256: string; artifact_count: number } {
  const evidenceRoot = ensureEvidenceRoot(evidenceRootInput)
  const rawIndexRelative = 'intake/artifact-index.json'
  const raw = JSON.parse(readFileSync(path.join(evidenceRoot, rawIndexRelative), 'utf8')) as { artifacts: any[]; corrections: unknown[] }
  const normalized = {
    schema_version: raw.schema_version,
    corrections: raw.corrections,
    artifacts: raw.artifacts.map((artifact) => ({ ...artifact, source_url: String(artifact.source_url).replace(/[?#].*$/, '') })),
  }
  const normalizedRelative = 'normalized/P3A-0/intake-summary.json'
  const normalizedPath = assertEvidencePath(evidenceRoot, path.join(evidenceRoot, normalizedRelative))
  mkdirSync(path.dirname(normalizedPath), { recursive: true, mode: 0o700 })
  writeFileSync(normalizedPath, `${canonicalJson(normalized)}\n`, { flag: 'wx', mode: 0o600 })

  const schemaIndexRelative = 'normalized/P3A-0/schema-index.json'
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
  const schemaNames = ['launch-manifest', 'artifact-index', 'normalized-observation', 'conclusion', 'handoff']
  const schemaIndex = { schema_version: 'oracle-lab-phase3a-schema-index.v1', schemas: schemaNames.map((name) => ({ name, sha256: sha256File(path.join(repositoryRoot, 'docs/superpowers/schemas', `oracle-lab-phase3a-${name}.schema.json`)) })) }
  writeFileSync(path.join(evidenceRoot, schemaIndexRelative), `${canonicalJson(schemaIndex)}\n`, { flag: 'wx', mode: 0o600 })

  const artifacts: ArtifactIndexInput[] = [
    official('wrapper-metadata', `intake/wrapper/${VERSION}/registry.json`, 'application/json', `https://registry.npmjs.org/@anthropic-ai%2fclaude-code/${VERSION}`),
    official('wrapper-archive', `intake/wrapper/${VERSION}/archive.tgz`, 'application/gzip', `https://registry.npmjs.org/@anthropic-ai/claude-code/-/claude-code-${VERSION}.tgz`),
    official('wrapper-intake-record', `intake/wrapper/${VERSION}/artifact.json`, 'application/json', null),
    official('platform-metadata', `intake/platform/${VERSION}/registry.json`, 'application/json', `https://registry.npmjs.org/@anthropic-ai%2fclaude-code-darwin-arm64/${VERSION}`),
    official('platform-archive', `intake/platform/${VERSION}/archive.tgz`, 'application/gzip', `https://registry.npmjs.org/@anthropic-ai/claude-code-darwin-arm64/-/claude-code-darwin-arm64-${VERSION}.tgz`),
    official('platform-intake-record', `intake/platform/${VERSION}/artifact.json`, 'application/json', null),
    official('platform-entrypoint', `intake/platform/${VERSION}/unpacked/package/claude`, 'application/x-mach-binary', null, 'safe-tar+tree-digest'),
    official('release-metadata', `intake/release/${VERSION}/release.json`, 'application/json', `https://api.github.com/repos/anthropics/claude-code/releases/tags/v${VERSION}`),
    official('release-archive', `intake/release/${VERSION}/claude-darwin-arm64.tar.gz`, 'application/gzip', `https://github.com/anthropics/claude-code/releases/download/v${VERSION}/claude-darwin-arm64.tar.gz`),
    official('release-shasums', `intake/release/${VERSION}/SHASUMS256.txt`, 'text/plain', `https://github.com/anthropics/claude-code/releases/download/v${VERSION}/SHASUMS256.txt`),
    official('release-signature', `intake/release/${VERSION}/SHASUMS256.txt.sig`, 'application/octet-stream', `https://github.com/anthropics/claude-code/releases/download/v${VERSION}/SHASUMS256.txt.sig`),
    official('release-entrypoint', `intake/release/${VERSION}/unpacked/claude`, 'application/x-mach-binary', null, 'safe-tar+tree-digest'),
    {
      artifact_id: 'raw-intake-index-quarantine', relative_path: rawIndexRelative, media_type: 'application/json', source_url: null, scope: 'P3A-0', requirement_ids: REQUIREMENTS,
      sensitivity: 'quarantine', redaction_transform: 'signed redirect query removed in normalized intake summary', retention_class: 'quarantine-24h', expiry: QUARANTINE, disposition: 'quarantined', parser_name: 'phase3a-leak-scan', parser_version: 'v1', parser_agreement: 'single-parser', negative_result: 'contains ephemeral GitHub signed redirect query; excluded from durable safe evidence',
    },
    {
      artifact_id: 'raw-release-intake-record-quarantine', relative_path: `intake/release/${VERSION}/artifact.json`, media_type: 'application/json', source_url: null, scope: 'P3A-0', requirement_ids: REQUIREMENTS,
      sensitivity: 'quarantine', redaction_transform: 'signed redirect query removed in normalized intake summary', retention_class: 'quarantine-24h', expiry: QUARANTINE, disposition: 'quarantined', parser_name: 'phase3a-leak-scan', parser_version: 'v1', parser_agreement: 'single-parser', negative_result: 'contains ephemeral GitHub signed redirect query; excluded from durable safe evidence',
    },
    { ...official('normalized-intake-summary', normalizedRelative, 'application/json', null), sensitivity: 'normalized-safe', redaction_transform: 'strip URL query and fragment', retention_class: 'normalized-until-phase3b' },
    { ...official('schema-index', schemaIndexRelative, 'application/json', null), sensitivity: 'normalized-safe', redaction_transform: 'schema digests only', retention_class: 'normalized-until-phase3b' },
    { ...official('toolchain', 'toolchain/toolchain.json', 'application/json', null, 'phase3a-toolchain'), sensitivity: 'normalized-safe', redaction_transform: 'bounded version output', retention_class: 'normalized-until-phase3b' },
    { ...official('capabilities', 'toolchain/capabilities.json', 'application/json', null, 'phase3a-toolchain'), sensitivity: 'normalized-safe', redaction_transform: 'capability buckets only', retention_class: 'normalized-until-phase3b' },
    { ...official('hermeticity', 'guards/hermeticity.json', 'application/json', null, 'sandbox-exec-self-test'), sensitivity: 'normalized-safe', redaction_transform: 'boolean buckets and digests only', retention_class: 'normalized-until-phase3b' },
    { ...official('preflight', 'preflight/preflight.json', 'application/json', null, 'phase3a-preflight'), sensitivity: 'normalized-safe', redaction_transform: 'repository and contract digests only', retention_class: 'normalized-until-phase3b' },
  ]
  const toolchain = JSON.parse(readFileSync(path.join(evidenceRoot, 'toolchain/toolchain.json'), 'utf8')) as { digest: string }
  const index = buildArtifactIndex({ evidenceRoot, evidenceRootId: 'H3A-claude-code-2.1.215-20260720', generatedAt: new Date().toISOString(), previousIndexSha256: sha256File(path.join(evidenceRoot, rawIndexRelative)), toolchainDigest: toolchain.digest, artifacts })
  verifyArtifactIndex(index, evidenceRoot)
  const output = assertEvidencePath(evidenceRoot, path.join(evidenceRoot, 'capsules', 'P3A-0', 'artifact-index.json'))
  mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 })
  const digest = writeArtifactIndex(index, output)
  return { index_path: output, index_sha256: digest, artifact_count: artifacts.length }
}

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1] }
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const root = argument('--evidence-root'); if (!root) throw new Phase3AError('artifact_index_usage', '--evidence-root is required')
    console.log(canonicalJson(buildP3A0Index(root)))
  } catch (error) { console.error(canonicalJson(stableError(error))); process.exitCode = 1 }
}
