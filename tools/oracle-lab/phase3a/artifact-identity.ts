import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalJson, isSha256, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'
import { scanSafePersisted } from './schemas.js'

type JsonObject = Record<string, any>
export type IdentityNode = { id: string; kind: string; sha256: string; status: string }
export type IdentityEdge = { from: string; to: string; relation: string; status: string }
export type ArtifactIdentityGraph = {
  schema_version: 'oracle-lab-phase3a-artifact-identity-graph.v1'
  artifact_version: '2.1.215'
  nodes: IdentityNode[]
  edges: IdentityEdge[]
  signature: { release_detached_signature: 'Unknown' | 'valid'; macos_code_signature: 'Unknown' | 'valid' }
  aggregate_sha256: string
}

function requireDigest(value: unknown, label: string): string {
  if (!isSha256(value)) throw new Phase3AError('artifact_identity_graph_invalid', `${label} must be a SHA-256 digest`)
  return value
}

function nodeId(kind: string, id: string): string { return `${kind}:${id}` }

export function buildArtifactIdentityGraph(intake: JsonObject, staticSummary: JsonObject, executions: JsonObject[]): ArtifactIdentityGraph {
  if (intake.schema_version !== 'oracle-lab-phase3a-intake.v1' || !Array.isArray(intake.artifacts)) throw new Phase3AError('artifact_identity_graph_invalid', 'normalized intake summary is invalid')
  const nodes: IdentityNode[] = []
  const edges: IdentityEdge[] = []
  const addNode = (id: string, kind: string, sha256: string, status: string): void => { nodes.push({ id, kind, sha256: requireDigest(sha256, id), status }) }
  const addEdge = (from: string, to: string, relation: string, status: string): void => { edges.push({ from, to, relation, status }) }

  for (const artifact of intake.artifacts as JsonObject[]) {
    if (artifact.version !== '2.1.215' || typeof artifact.artifact_id !== 'string') throw new Phase3AError('artifact_identity_graph_invalid', 'artifact version or id drifted')
    const verification = artifact.verification as JsonObject
    if (verification.lifecycle_scripts_executed !== false) throw new Phase3AError('artifact_identity_graph_invalid', 'lifecycle execution must remain false')
    const sourceId = nodeId('source', artifact.artifact_id)
    const archiveId = nodeId('archive', artifact.artifact_id)
    const treeId = nodeId('tree', artifact.artifact_id)
    const metadataDigest = artifact.kind === 'github-release' ? verification.release_metadata_sha256 : verification.metadata_sha256
    addNode(sourceId, 'official-source-metadata', metadataDigest, 'pinned')
    addNode(archiveId, 'official-archive', artifact.archive_sha256, 'digest-verified')
    addNode(treeId, 'unpacked-tree', artifact.tree_sha256, 'streaming-intake-verified')
    const integrityStatus = artifact.kind === 'github-release' ? verification.shasums_match : verification.npm_integrity_match
    if (integrityStatus !== true) throw new Phase3AError('artifact_identity_graph_invalid', `integrity did not verify: ${artifact.artifact_id}`)
    addEdge(sourceId, archiveId, artifact.kind === 'github-release' ? 'release-shasums-verified' : 'npm-integrity-verified', 'verified')
    addEdge(archiveId, treeId, 'streaming-safe-unpack', 'verified')
    if (artifact.entrypoint_sha256) {
      const entryId = nodeId('entrypoint', artifact.entrypoint_sha256)
      if (!nodes.some((node) => node.id === entryId)) addNode(entryId, 'executable', artifact.entrypoint_sha256, 'digest-verified')
      addEdge(treeId, entryId, 'contains-entrypoint', 'verified')
    }
  }

  const entrypointDigest = requireDigest(staticSummary.artifact_sha256, 'static summary artifact')
  const signature = staticSummary.signature as JsonObject
  const codeSignatureStatus = signature?.verification_status === 'valid' ? 'valid' : 'Unknown'
  const releaseArtifact = (intake.artifacts as JsonObject[]).find((artifact) => artifact.kind === 'github-release')
  const releaseSignatureStatus = releaseArtifact?.verification?.signature_verification === 'valid' ? 'valid' : 'Unknown'
  const entryId = nodeId('entrypoint', entrypointDigest)
  const codeSignatureId = nodeId('signature', 'macos-code-signature')
  addNode(codeSignatureId, 'macos-code-signature', requireDigest(signature.verify_command_sha256, 'codesign verification command'), codeSignatureStatus)
  addEdge(entryId, codeSignatureId, 'verified-by-codesign', codeSignatureStatus)
  if (releaseArtifact) {
    const detachedId = nodeId('signature', 'release-detached-signature')
    addNode(detachedId, 'release-detached-signature', requireDigest(releaseArtifact.verification.signature_sha256, 'release detached signature'), releaseSignatureStatus)
    addEdge(nodeId('archive', releaseArtifact.artifact_id), detachedId, 'published-with-detached-signature', releaseSignatureStatus)
  }

  for (const execution of executions) {
    if (typeof execution.run_id !== 'string' || execution.external_socket_budget !== 0) throw new Phase3AError('artifact_identity_graph_invalid', 'execution must be named and external-socket budget zero')
    if (execution.executable_sha256 !== entrypointDigest) throw new Phase3AError('artifact_identity_graph_invalid', `execution digest drifted: ${execution.run_id}`)
    const executionId = nodeId('execution', execution.run_id)
    addNode(executionId, 'loopback-execution', execution.result_sha256, String(execution.status))
    addEdge(entryId, executionId, 'executed-as', 'observed')
  }

  nodes.sort((left, right) => left.id.localeCompare(right.id))
  edges.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))
  const graph: ArtifactIdentityGraph = {
    schema_version: 'oracle-lab-phase3a-artifact-identity-graph.v1', artifact_version: '2.1.215', nodes, edges,
    signature: { release_detached_signature: releaseSignatureStatus, macos_code_signature: codeSignatureStatus },
    aggregate_sha256: sha256Bytes(canonicalJson({ nodes, edges })),
  }
  verifyArtifactIdentityGraph(graph)
  return graph
}

export function verifyArtifactIdentityGraph(graph: ArtifactIdentityGraph): void {
  if (graph.schema_version !== 'oracle-lab-phase3a-artifact-identity-graph.v1' || graph.artifact_version !== '2.1.215') throw new Phase3AError('artifact_identity_graph_invalid', 'graph identity is invalid')
  if (graph.aggregate_sha256 !== sha256Bytes(canonicalJson({ nodes: graph.nodes, edges: graph.edges }))) throw new Phase3AError('artifact_identity_graph_invalid', 'aggregate digest mismatch')
  const ids = new Set(graph.nodes.map((node) => node.id))
  if (ids.size !== graph.nodes.length) throw new Phase3AError('artifact_identity_graph_invalid', 'duplicate graph node')
  for (const edge of graph.edges) if (!ids.has(edge.from) || !ids.has(edge.to)) throw new Phase3AError('artifact_identity_graph_invalid', 'orphan graph edge')
  if (scanSafePersisted(graph).length > 0) throw new Phase3AError('artifact_identity_graph_invalid', 'graph contains unsafe persisted material')
}

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const evidenceRoot = argument('--evidence-root'); const out = argument('--out')
    if (!evidenceRoot || !out) throw new Phase3AError('invalid_arguments', '--evidence-root and --out are required')
    const intake = JSON.parse(readFileSync(path.join(evidenceRoot, 'normalized/P3A-0/intake-summary.json'), 'utf8'))
    const staticSummary = JSON.parse(readFileSync(path.join(evidenceRoot, 'capsules/P3A-1/static-summary.json'), 'utf8'))
    const executions = []
    for (let run = 2; run <= 7; run += 1) {
      const runId = `active-baseline-${String(run).padStart(3, '0')}`
      const summary = JSON.parse(readFileSync(path.join(evidenceRoot, `capsules/P3A-2/${runId}/summary.json`), 'utf8'))
      const resultPath = path.join(evidenceRoot, `capsules/P3A-2/${runId}/result.json`)
      const result = JSON.parse(readFileSync(resultPath, 'utf8'))
      if (summary.result_sha256 !== sha256File(resultPath)) throw new Phase3AError('artifact_identity_graph_invalid', `result digest mismatch: ${runId}`)
      const executableDigests = [...new Set(result.process_samples.filter((sample: JsonObject) => sample.executable_class === 'root').map((sample: JsonObject) => sample.executable_sha256))]
      if (executableDigests.length !== 1) throw new Phase3AError('artifact_identity_graph_invalid', `execution identity is ambiguous: ${runId}`)
      executions.push({ run_id: runId, result_sha256: summary.result_sha256, executable_sha256: executableDigests[0], external_socket_budget: summary.external_socket_budget, status: summary.status })
    }
    const graph = buildArtifactIdentityGraph(intake, staticSummary, executions)
    mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 })
    writeFileSync(out, `${canonicalJson(graph)}\n`, { flag: process.argv.includes('--replace-generated') ? 'w' : 'wx', mode: 0o600 })
    process.stdout.write(`${canonicalJson({ aggregate_sha256: graph.aggregate_sha256, file_sha256: sha256File(out), nodes: graph.nodes.length, edges: graph.edges.length })}\n`)
  } catch (error) { process.stderr.write(`${canonicalJson(stableError(error))}\n`); process.exitCode = 1 }
}
