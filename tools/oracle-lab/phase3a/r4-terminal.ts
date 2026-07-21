import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File } from './core.js'

type Input = {
  index_sha256: string; leak_scan_sha256: string; exit_sha256: string; handoff_sha256: string; identity_graph_sha256: string; r2_sha256: string; r3_sha256: string
  cc_commit: string; cc_tree: string; sub2api_commit: string; sub2api_tree: string
  exit: Record<string, any>; handoff: Record<string, any>; leak: Record<string, any>
}
function fail(code: string, message: string): never { throw new Phase3AError(code, message) }

export function buildR4TerminalManifest(input: Input): Record<string, any> {
  for (const digest of [input.index_sha256, input.leak_scan_sha256, input.exit_sha256, input.handoff_sha256, input.identity_graph_sha256, input.r2_sha256, input.r3_sha256]) if (!/^[a-f0-9]{64}$/.test(digest)) fail('r4_terminal_binding_invalid', 'terminal binding must be SHA-256')
  for (const identity of [input.cc_commit, input.cc_tree, input.sub2api_commit, input.sub2api_tree]) if (!/^[a-f0-9]{40}$/.test(identity)) fail('r4_terminal_binding_invalid', 'repository identity must be SHA-1')
  if (input.exit.artifact_index_sha256 !== input.index_sha256 || input.handoff.artifact_index_sha256 !== input.index_sha256) fail('r4_terminal_index_mismatch', 'exit and handoff must bind the pre-exit index')
  if (input.handoff.exit_report_sha256 !== input.exit_sha256) fail('r4_terminal_exit_mismatch', 'handoff must bind the exit report')
  if (input.leak.status !== 'PASS' || input.leak.index_sha256 !== input.index_sha256 || !Array.isArray(input.leak.findings) || input.leak.findings.length !== 0) fail('r4_terminal_leak_mismatch', 'leak scan must pass against the pre-exit index')
  const green = input.exit.status === 'GREEN' && input.handoff.status === 'READY'
  const blocked = input.exit.status === 'BLOCKED' && input.handoff.status === 'BLOCKED'
  if (!green && !blocked) fail('r4_terminal_status_mismatch', 'exit and handoff terminal statuses are inconsistent')
  const bindings = { index_sha256: input.index_sha256, leak_scan_sha256: input.leak_scan_sha256, exit_sha256: input.exit_sha256, handoff_sha256: input.handoff_sha256, identity_graph_sha256: input.identity_graph_sha256, r2_sha256: input.r2_sha256, r3_sha256: input.r3_sha256 }
  const repositories = { cc_gateway: { commit: input.cc_commit, tree: input.cc_tree }, sub2api: { commit: input.sub2api_commit, tree: input.sub2api_tree } }
  const base = { schema_version: 'oracle-lab-phase3a-r4-terminal.v1', status: green ? 'GREEN' : 'BLOCKED_WITH_VALIDATED_SUBSET', index_role: 'pre-exit-evidence-index', bindings, repositories, codegraph_current: true, external_socket_budget: 0, raw_material_persisted: false }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const names = ['evidence-root', 'index', 'leak', 'exit', 'handoff', 'identity-graph', 'r2', 'r3', 'cc-commit', 'cc-tree', 'sub2api-commit', 'sub2api-tree', 'out']
  const values = Object.fromEntries(names.map((name) => [name, argument(`--${name}`)]))
  if (names.some((name) => !values[name])) fail('usage', 'r4-terminal requires all binding inputs and --out')
  const root = ensureEvidenceRoot(values['evidence-root']!); const out = assertEvidencePath(root, values.out!)
  const read = (name: string): Record<string, any> => JSON.parse(readFileSync(values[name]!, 'utf8')) as Record<string, any>
  const result = buildR4TerminalManifest({
    index_sha256: sha256File(values.index!), leak_scan_sha256: sha256File(values.leak!), exit_sha256: sha256File(values.exit!), handoff_sha256: sha256File(values.handoff!), identity_graph_sha256: sha256File(values['identity-graph']!), r2_sha256: sha256File(values.r2!), r3_sha256: sha256File(values.r3!),
    cc_commit: values['cc-commit']!, cc_tree: values['cc-tree']!, sub2api_commit: values['sub2api-commit']!, sub2api_tree: values['sub2api-tree']!, exit: read('exit'), handoff: read('handoff'), leak: read('leak'),
  })
  writeFileSync(out, `${canonicalJson(result)}\n`, { flag: 'wx', mode: 0o600 }); process.stdout.write(`${canonicalJson(result)}\n`)
}
