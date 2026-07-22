import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File } from './core.js'

const TIER_A_VERSIONS = ['2.1.214', '2.1.212', '2.1.211', '2.1.208', '2.1.207']
const TIER_A_TERMINAL_TARGETS = ['2.1.214:long-run', '2.1.214:restart', '2.1.212:restart', '2.1.211:base-url-background-restart']
type Input = {
  index_sha256: string; leak_scan_sha256: string; exit_sha256: string; handoff_sha256: string; identity_graph_sha256: string; r2_sha256: string; r3_sha256: string; tier_a_rerun_sha256: string
  cc_commit: string; cc_tree: string; sub2api_commit: string; sub2api_tree: string
  index: Record<string, any>; exit: Record<string, any>; handoff: Record<string, any>; leak: Record<string, any>; tier_a_rerun: Record<string, any>
}
function fail(code: string, message: string): never { throw new Phase3AError(code, message) }

function indexedSource(artifacts: Array<Record<string, any>>, source: Record<string, any>, label: string): Record<string, any> {
  if (typeof source?.path !== 'string' || !/^[a-f0-9]{64}$/.test(String(source.sha256))) fail('r4_terminal_binding_invalid', `${label} source binding is invalid`)
  const row = artifacts.find((artifact) => artifact.relative_path === source.path && artifact.sha256 === source.sha256)
  if (!row) fail('r4_terminal_binding_invalid', `${label} source is not bound by the terminal index`)
  return row
}

function assertTierARerunEnvelope(value: Record<string, any>, artifacts: Array<Record<string, any>>): void {
  const { deterministic_digest, ...base } = value
  if (deterministic_digest !== sha256Bytes(canonicalJson(base)) || !Array.isArray(value.rerun_mappings) || !Array.isArray(value.pair_outcomes)) fail('r4_terminal_binding_invalid', 'Tier A terminal rerun deterministic envelope is invalid')
  const keys = (rows: Array<Record<string, any>>, nested: string): string[] => rows.map((row) => nested === 'target' ? `${row.target?.version}:${row.target?.required_pair}` : `${row.version}:${row.required_pair}`).sort()
  if (canonicalJson(keys(value.rerun_mappings, 'target')) !== canonicalJson(TIER_A_TERMINAL_TARGETS.slice().sort()) || canonicalJson(keys(value.pair_outcomes, 'outcome')) !== canonicalJson(TIER_A_TERMINAL_TARGETS.slice().sort())) {
    fail('r4_terminal_binding_invalid', 'Tier A terminal rerun does not cover every declared target')
  }
  for (const mapping of value.rerun_mappings) {
    if (typeof mapping.rerun_root !== 'string' || typeof mapping.campaign_id !== 'string') fail('r4_terminal_binding_invalid', 'Tier A rerun mapping is incomplete')
    indexedSource(artifacts, mapping.summary, 'Tier A rerun campaign')
  }
  for (const outcome of value.pair_outcomes) {
    const evidence = outcome.capability_evidence
    if (outcome.classification !== 'TERMINAL_UNKNOWN' || outcome.phase3b_usable !== false || !/^[a-f0-9]{64}$/.test(String(outcome.command_digest))
      || !outcome.source_bindings || typeof outcome.source_bindings.lane_summary?.path !== 'string' || !/^[a-f0-9]{64}$/.test(String(outcome.source_bindings.lane_summary?.sha256))
      || typeof outcome.source_bindings.pair_summary?.path !== 'string' || !/^[a-f0-9]{64}$/.test(String(outcome.source_bindings.pair_summary?.sha256))
      || !/^[a-f0-9]{64}$/.test(String(outcome.source_bindings.result_set_digest))
      || evidence?.external_socket_budget !== 0 || evidence?.raw_material_persisted !== false || evidence?.complete_result_count !== 0
      || !Number.isInteger(evidence?.result_count) || evidence.result_count < 10 || evidence.terminal_result_count !== evidence.result_count
      || evidence.process_sampled_result_count !== evidence.result_count || evidence.safe_diagnostic_result_count !== evidence.result_count) {
      fail('r4_terminal_binding_invalid', 'Tier A terminal rerun outcome is incomplete')
    }
    indexedSource(artifacts, outcome.source_bindings.lane_summary, 'Tier A rerun lane')
    const pair = indexedSource(artifacts, outcome.source_bindings.pair_summary, 'Tier A rerun pair')
    const pairRoot = path.posix.dirname(String(pair.relative_path))
    const resultRows = artifacts.filter((artifact) => typeof artifact.relative_path === 'string' && artifact.relative_path.startsWith(`${pairRoot}/`) && /\/r\d+\/(?:control|treatment)\/result\.json$/.test(artifact.relative_path))
    const manifestRows = artifacts.filter((artifact) => typeof artifact.relative_path === 'string' && artifact.relative_path.startsWith(`${pairRoot}/`) && /\/r\d+\/(?:control|treatment)\/manifest\.json$/.test(artifact.relative_path))
    if (resultRows.length !== evidence.result_count || manifestRows.length !== evidence.result_count) fail('r4_terminal_binding_invalid', 'Tier A terminal rerun result sources are incomplete')
  }
}

function tierASupportDigest(index: Record<string, any>, r2Sha256: string, r3Sha256: string, rerunSha256: string, rerunValue: Record<string, any>): string {
  if (!Array.isArray(index.artifacts)) fail('r4_terminal_binding_invalid', 'terminal index must contain artifact rows')
  const artifacts = index.artifacts as Array<Record<string, any>>
  const required = (artifactId: string, sha256: string, relativePath: string, label: string): Record<string, any> => {
    const artifact = artifacts.find((row) => row.artifact_id === artifactId)
    if (!artifact || artifact.sha256 !== sha256 || artifact.relative_path !== relativePath) fail('r4_terminal_binding_invalid', `${label} is not bound by the terminal index`)
    return artifact
  }
  const r2 = required('p3a2-closure-coverage-v8', r2Sha256, 'capsules/P3A-2/closure-r2-coverage-v8.json', 'R2 v8')
  const r3 = required('p3a3-closure-tier-a-v11', r3Sha256, 'capsules/P3A-3/closure-r3-tier-a-v11.json', 'R3 v11')
  const rerun = required('p3a3-tier-a-rerun-terminal-unknown-v1', rerunSha256, 'capsules/P3A-3/tier-a-rerun-terminal-unknown-v1.json', 'Tier A terminal rerun artifact')
  const projections = TIER_A_VERSIONS.map((version) => required(`p3a3-tier-a-projection-v5-${version}`, String(artifacts.find((row) => row.artifact_id === `p3a3-tier-a-projection-v5-${version}`)?.sha256 ?? ''), `capsules/P3A-3/tier-a-dynamic-projections-v5/tier-a-dynamic-projection-v5-${version}.json`, `Tier A projection v5 ${version}`))
  const bindings = TIER_A_VERSIONS.flatMap((version) => {
    const prefix = `capsules/P3A-3/tier-a-cell-bindings-v3/${version}/`
    const rows = artifacts.filter((row) => typeof row.relative_path === 'string' && row.relative_path.startsWith(prefix))
    if (rows.length === 0) fail('r4_terminal_binding_invalid', `Tier A binding v3 is missing for ${version}`)
    return rows
  })
  const declaredSources = [
    ...rerunValue.rerun_mappings.map((mapping: Record<string, any>) => indexedSource(artifacts, mapping.summary, 'Tier A rerun campaign')),
    ...rerunValue.pair_outcomes.flatMap((outcome: Record<string, any>) => {
      const lane = indexedSource(artifacts, outcome.source_bindings.lane_summary, 'Tier A rerun lane')
      const pair = indexedSource(artifacts, outcome.source_bindings.pair_summary, 'Tier A rerun pair')
      const pairRoot = path.posix.dirname(String(pair.relative_path))
      return [lane, pair, ...artifacts.filter((artifact) => typeof artifact.relative_path === 'string' && artifact.relative_path.startsWith(`${pairRoot}/`) && /\/r\d+\/(?:control|treatment)\/(?:manifest|result)\.json$/.test(artifact.relative_path))]
    }),
  ]
  const support = [...new Map([...projections, ...bindings, ...declaredSources, r2, r3, rerun].map((row) => [String(row.artifact_id), { artifact_id: row.artifact_id, sha256: row.sha256, relative_path: row.relative_path }])).values()]
  return sha256Bytes(canonicalJson(support.sort((left, right) => left.artifact_id.localeCompare(right.artifact_id))))
}

export function buildR4TerminalManifest(input: Input): Record<string, any> {
  for (const digest of [input.index_sha256, input.leak_scan_sha256, input.exit_sha256, input.handoff_sha256, input.identity_graph_sha256, input.r2_sha256, input.r3_sha256, input.tier_a_rerun_sha256]) if (!/^[a-f0-9]{64}$/.test(digest)) fail('r4_terminal_binding_invalid', 'terminal binding must be SHA-256')
  for (const identity of [input.cc_commit, input.cc_tree, input.sub2api_commit, input.sub2api_tree]) if (!/^[a-f0-9]{40}$/.test(identity)) fail('r4_terminal_binding_invalid', 'repository identity must be SHA-1')
  if (input.exit.artifact_index_sha256 !== input.index_sha256 || input.handoff.artifact_index_sha256 !== input.index_sha256) fail('r4_terminal_index_mismatch', 'exit and handoff must bind the pre-exit index')
  if (input.handoff.exit_report_sha256 !== input.exit_sha256) fail('r4_terminal_exit_mismatch', 'handoff must bind the exit report')
  if (input.leak.status !== 'PASS' || input.leak.index_sha256 !== input.index_sha256 || !Array.isArray(input.leak.findings) || input.leak.findings.length !== 0) fail('r4_terminal_leak_mismatch', 'leak scan must pass against the pre-exit index')
  if (input.tier_a_rerun.schema_version !== 'oracle-lab-phase3a-tier-a-rerun-terminal-unknown.v1' || input.tier_a_rerun.classification !== 'TERMINAL_UNKNOWN' || input.tier_a_rerun.phase3b_usable !== false || input.tier_a_rerun.external_socket_budget !== 0 || input.tier_a_rerun.raw_material_persisted !== false) fail('r4_terminal_binding_invalid', 'Tier A terminal rerun artifact is invalid')
  assertTierARerunEnvelope(input.tier_a_rerun, input.index.artifacts as Array<Record<string, any>>)
  const green = input.exit.status === 'GREEN' && input.handoff.status === 'READY'
  const blocked = input.exit.status === 'BLOCKED' && input.handoff.status === 'BLOCKED'
  if (!green && !blocked) fail('r4_terminal_status_mismatch', 'exit and handoff terminal statuses are inconsistent')
  const tierASupportSha256 = tierASupportDigest(input.index, input.r2_sha256, input.r3_sha256, input.tier_a_rerun_sha256, input.tier_a_rerun)
  const bindings = { index_sha256: input.index_sha256, leak_scan_sha256: input.leak_scan_sha256, exit_sha256: input.exit_sha256, handoff_sha256: input.handoff_sha256, identity_graph_sha256: input.identity_graph_sha256, r2_sha256: input.r2_sha256, r3_sha256: input.r3_sha256, tier_a_rerun_sha256: input.tier_a_rerun_sha256, tier_a_support_sha256: tierASupportSha256 }
  const repositories = { cc_gateway: { commit: input.cc_commit, tree: input.cc_tree }, sub2api: { commit: input.sub2api_commit, tree: input.sub2api_tree } }
  const base = { schema_version: 'oracle-lab-phase3a-r4-terminal.v1', status: green ? 'GREEN' : 'BLOCKED_WITH_VALIDATED_SUBSET', index_role: 'pre-exit-evidence-index', bindings, repositories, codegraph_current: true, external_socket_budget: 0, raw_material_persisted: false }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
function expectedEvidenceInput(root: string, input: string, relative: string, label: string): void {
  if (path.resolve(root, input) !== path.resolve(root, relative)) fail('usage', `${label} must be ${relative}`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const names = ['evidence-root', 'index', 'leak', 'exit', 'handoff', 'identity-graph', 'r2', 'r3', 'tier-a-rerun', 'cc-commit', 'cc-tree', 'sub2api-commit', 'sub2api-tree', 'out']
  const values = Object.fromEntries(names.map((name) => [name, argument(`--${name}`)]))
  if (names.some((name) => !values[name])) fail('usage', 'r4-terminal requires all binding inputs and --out')
  const root = ensureEvidenceRoot(values['evidence-root']!); const out = assertEvidencePath(root, values.out!)
  expectedEvidenceInput(root, values.r2!, 'capsules/P3A-2/closure-r2-coverage-v8.json', 'R2 closure')
  expectedEvidenceInput(root, values.r3!, 'capsules/P3A-3/closure-r3-tier-a-v11.json', 'R3 closure')
  expectedEvidenceInput(root, values.leak!, 'capsules/P3A-4/leak-scan-v23.json', 'leak scan')
  expectedEvidenceInput(root, values['tier-a-rerun']!, 'capsules/P3A-3/tier-a-rerun-terminal-unknown-v1.json', 'Tier A terminal rerun artifact')
  const read = (name: string): Record<string, any> => JSON.parse(readFileSync(values[name]!, 'utf8')) as Record<string, any>
  const result = buildR4TerminalManifest({
    index_sha256: sha256File(values.index!), leak_scan_sha256: sha256File(values.leak!), exit_sha256: sha256File(values.exit!), handoff_sha256: sha256File(values.handoff!), identity_graph_sha256: sha256File(values['identity-graph']!), r2_sha256: sha256File(values.r2!), r3_sha256: sha256File(values.r3!), tier_a_rerun_sha256: sha256File(values['tier-a-rerun']!),
    cc_commit: values['cc-commit']!, cc_tree: values['cc-tree']!, sub2api_commit: values['sub2api-commit']!, sub2api_tree: values['sub2api-tree']!, index: read('index'), exit: read('exit'), handoff: read('handoff'), leak: read('leak'), tier_a_rerun: read('tier-a-rerun'),
  })
  writeFileSync(out, `${canonicalJson(result)}\n`, { flag: 'wx', mode: 0o600 }); process.stdout.write(`${canonicalJson(result)}\n`)
}
