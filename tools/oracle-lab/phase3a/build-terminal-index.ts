import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { buildArtifactIndex, type ArtifactIndexInput, writeArtifactIndex } from './artifact-index.js'
import { canonicalJson, Phase3AError, sha256File, stableError } from './core.js'

const TOOLCHAIN = '6f86c18ddf1f22095d5817ee82ee1ff1d6babae689c1f0ebbe51bb2b8217fd6d'
const EXPIRY = '2026-08-03T00:00:00.000Z'

function safeId(value: string): string { return value.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 120) }

export function terminalArtifactInputs(root: string): ArtifactIndexInput[] {
  const rows: ArtifactIndexInput[] = []
  const add = (artifactId: string, relativePath: string, scope: string, disposition: ArtifactIndexInput['disposition'] = 'retain'): void => {
    if (!existsSync(path.join(root, relativePath))) return
    rows.push({
      artifact_id: safeId(artifactId), relative_path: relativePath, media_type: 'application/json', source_url: null, scope,
      requirement_ids: ['HA-P1-001'], sensitivity: 'normalized-safe', redaction_transform: 'phase3a-safe-summary-v1',
      retention_class: 'normalized-until-phase3b', expiry: EXPIRY, disposition,
      parser_name: 'phase3a-terminal-index', parser_version: '1', parser_agreement: 'agreed', parent_artifact_ids: [],
    })
  }
  add('p3a0-artifact-index', 'capsules/P3A-0/artifact-index.json', 'P3A-0')
  add('p3a1-static-summary', 'capsules/P3A-1/static-summary.json', 'P3A-1')
  const staticRoot = 'static/90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58'
  add('p3a1-inventory', `${staticRoot}/inventory-v2.json`, 'P3A-1')
  add('p3a1-extraction-a', `${staticRoot}/bun-extract-a/extraction-index.json`, 'P3A-1')
  add('p3a1-extraction-b', `${staticRoot}/bun-extract-b/extraction-index.json`, 'P3A-1')
  for (const lane of ['ast-small-a', 'ast-small-b']) {
    const directory = path.join(root, staticRoot, lane)
    if (!existsSync(directory)) continue
    for (const name of readdirSync(directory).filter((entry) => entry.endsWith('.json')).sort()) {
      add(`p3a1-${lane}-${name.replace(/\.json$/, '')}`, `${staticRoot}/${lane}/${name}`, 'P3A-1')
    }
  }
  const invalidAst = `${staticRoot}/ast-a/module-0.json`
  if (existsSync(path.join(root, invalidAst))) rows.push({ artifact_id: 'p3a1-invalid-ast-superseded', relative_path: invalidAst, media_type: 'application/json', source_url: null, scope: 'P3A-1-invalid', requirement_ids: ['HA-P1-001'], sensitivity: 'quarantine', redaction_transform: 'none-superseded', retention_class: 'quarantine-24h', expiry: EXPIRY, disposition: 'superseded-non-reproducible', parser_name: 'phase3a-terminal-index', parser_version: '1', parser_agreement: 'disagreed', negative_result: 'canonical AST traversal short-circuited and is invalid', parent_artifact_ids: [] })
  for (let run = 2; run <= 7; run += 1) {
    const id = `active-baseline-${String(run).padStart(3, '0')}`
    for (const name of ['manifest', 'guard', 'observer', 'result', 'summary']) add(`p3a2-${id}-${name}`, `capsules/P3A-2/${id}/${name}.json`, 'P3A-2')
  }
  add('p3a4-normalized-observations', 'capsules/P3A-4/normalized-observations.json', 'P3A-4')
  rows.push(
    { artifact_id: 'raw-intake-index-quarantine', relative_path: 'intake/artifact-index.json', media_type: 'application/json', source_url: null, scope: 'P3A-0-raw', requirement_ids: ['HA-P1-001'], sensitivity: 'quarantine', redaction_transform: 'none-quarantined', retention_class: 'quarantine-24h', expiry: EXPIRY, disposition: 'quarantined', parser_name: 'phase3a-terminal-index', parser_version: '1', parser_agreement: 'not-applicable', parent_artifact_ids: [] },
    { artifact_id: 'raw-release-intake-record-quarantine', relative_path: 'intake/release/2.1.215/artifact.json', media_type: 'application/json', source_url: null, scope: 'P3A-0-raw', requirement_ids: ['HA-P1-001'], sensitivity: 'quarantine', redaction_transform: 'none-quarantined', retention_class: 'quarantine-24h', expiry: EXPIRY, disposition: 'quarantined', parser_name: 'phase3a-terminal-index', parser_version: '1', parser_agreement: 'not-applicable', parent_artifact_ids: [] },
  )
  return rows.sort((left, right) => left.artifact_id.localeCompare(right.artifact_id))
}

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined }

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const root = argument('--evidence-root'); const out = argument('--out')
    if (!root || !out) throw new Phase3AError('invalid_arguments', '--evidence-root and --out are required')
    const previous = path.join(root, 'capsules/P3A-0/artifact-index.json')
    const index = buildArtifactIndex({ evidenceRoot: root, evidenceRootId: path.basename(root), generatedAt: '2026-07-20T12:00:00.000Z', previousIndexSha256: sha256File(previous), toolchainDigest: TOOLCHAIN, artifacts: terminalArtifactInputs(root) })
    mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 })
    const digest = writeArtifactIndex(index, out)
    process.stdout.write(`${canonicalJson({ artifacts: index.artifacts.length, sha256: digest })}\n`)
  } catch (error) { process.stderr.write(`${canonicalJson(stableError(error))}\n`); process.exitCode = 1 }
}
