import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalJson, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'
import { DISCOVERY_CATEGORIES, type DiscoveryInventory } from './discovery-inventory.js'
import { REQUIRED_STATIC_ROOTS } from './recover-ast.js'

export type StaticClosureSummary = {
  schema_version: 'oracle-lab-phase3a-static-closure-summary.v1'
  status: 'complete'
  binding: DiscoveryInventory['binding']
  discovery_artifact_sha256: string
  discovery_deterministic_digest: string
  module_slices: {
    count: number
    aggregate_nodes: number
    max_nodes: number
    node_budget: number
    budget_exceeded: number
  }
  source_sink_categories: Array<{
    category: string
    kind: string
    match_count: number
    module_count: number
  }>
  safe_env_key_count: number
  env_key_classes: {
    base_url_proxy_transport: number
    auth_credential: number
    telemetry_diagnostic: number
    lifecycle_compact_process: number
    other: number
  }
  required_roots: Array<{
    root: string
    disposition: 'static-path-recovered' | 'unknown'
    xref_count: number
    call_path_count: number
    cfg_neighborhood_count: number
    state_neighborhood_count: number
    wrapper_cfg_budget_truncations: number
    searched_surfaces: string[]
    next_minimal_action: string | null
  }>
  unresolved_dynamic_edge_count: number
  limitations: string[]
  deterministic_digest: string
}

function fail(code: string, message: string): never { throw new Phase3AError(code, message) }

function assertDigest(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) fail('static_binding_invalid', `${label} must be a SHA-256 digest`)
}

function validateLocation(inventory: DiscoveryInventory, offset: number, length: number): void {
  const start = inventory.binding.candidate_location.offset
  const end = start + inventory.binding.candidate_location.length
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || length < 0 || offset < start || offset + length > end) {
    fail('static_range_invalid', 'discovery location is outside the candidate range')
  }
}

function envClasses(keys: string[]): StaticClosureSummary['env_key_classes'] {
  const counts = { base_url_proxy_transport: 0, auth_credential: 0, telemetry_diagnostic: 0, lifecycle_compact_process: 0, other: 0 }
  for (const key of keys) {
    if (/BASE_URL|PROXY|SOCKET|ENDPOINT|REGION/.test(key)) counts.base_url_proxy_transport += 1
    else if (/AUTH|TOKEN|KEY|CREDENTIAL|OAUTH|SECRET/.test(key)) counts.auth_credential += 1
    else if (/OTEL|TELEMETRY|DIAGNOSTIC|UPDATE|ERROR|LOG/.test(key)) counts.telemetry_diagnostic += 1
    else if (/COMPACT|CACHE|RESTART|RESUME|SESSION|CHILD|SUBAGENT|DAEMON|BACKGROUND|TIMEOUT|RETRY/.test(key)) counts.lifecycle_compact_process += 1
    else counts.other += 1
  }
  return counts
}

export function buildStaticClosureSummary(inventory: DiscoveryInventory, discoveryArtifactSha256: string): StaticClosureSummary {
  assertDigest(discoveryArtifactSha256, 'discovery artifact')
  if (inventory.schema_version !== 'oracle-lab-phase3a-discovery-inventory.v1') fail('static_schema_invalid', 'unexpected discovery inventory schema')
  const { deterministic_digest: recordedDigest, ...inventoryBase } = inventory
  if (sha256Bytes(canonicalJson(inventoryBase)) !== recordedDigest) fail('static_integrity_mismatch', 'discovery deterministic digest does not reproduce')
  if (inventory.parse.module_slice_count !== inventory.module_slices.length) fail('static_integrity_mismatch', 'module slice count disagrees with module inventory')
  if (inventory.parse.budget_exceeded_modules !== inventory.module_slices.filter((entry) => entry.node_count > inventory.parse.node_budget).length) fail('static_integrity_mismatch', 'module budget count disagrees with module inventory')
  if (inventory.parse.budget_exceeded_modules !== 0) fail('static_budget_exceeded', 'module slicing did not resolve the AST node budget')
  if (inventory.parse.max_module_nodes !== Math.max(0, ...inventory.module_slices.map((entry) => entry.node_count))) fail('static_integrity_mismatch', 'maximum module node count disagrees with module inventory')
  if (inventory.parse.aggregate_module_nodes !== inventory.module_slices.reduce((total, entry) => total + entry.node_count, 0)) fail('static_integrity_mismatch', 'aggregate module node count disagrees with module inventory')

  const roots = inventory.root_coverage.map((entry) => entry.root)
  if (new Set(roots).size !== REQUIRED_STATIC_ROOTS.length || REQUIRED_STATIC_ROOTS.some((root) => !roots.includes(root))) fail('static_root_incomplete', 'required static roots are not exact and complete')
  const categories = inventory.inventory.map((entry) => entry.category)
  if (new Set(categories).size !== DISCOVERY_CATEGORIES.length || DISCOVERY_CATEGORIES.some((category) => !categories.includes(category))) fail('static_inventory_incomplete', 'source/sink discovery categories are not exact and complete')
  if (new Set(inventory.safe_env_keys).size !== inventory.safe_env_keys.length || [...inventory.safe_env_keys].sort().some((key, index) => key !== inventory.safe_env_keys[index])) fail('static_inventory_invalid', 'safe env keys must be unique and sorted')
  if (inventory.env_reads.length !== inventory.safe_env_keys.length || inventory.env_reads.some((entry, index) => entry.key !== inventory.safe_env_keys[index])) fail('static_inventory_invalid', 'env read inventory must bind every safe env key')

  for (const module of inventory.module_slices) validateLocation(inventory, module.location.offset, module.location.length)
  for (const env of inventory.env_reads) for (const anchor of env.locations) validateLocation(inventory, anchor.location.offset, anchor.location.length)
  for (const root of inventory.root_coverage) {
    for (const anchor of root.evidence_locations) validateLocation(inventory, anchor.location.offset, anchor.location.length)
    for (const row of [...root.call_paths, ...root.cfg_neighborhoods, ...root.state_neighborhoods]) validateLocation(inventory, row.location.offset, row.location.length)
  }

  const requiredRoots = REQUIRED_STATIC_ROOTS.map((root) => {
    const entry = inventory.root_coverage.find((candidate) => candidate.root === root)!
    const recovered = entry.status === 'observed' && entry.xref_count > 0 && entry.call_paths.length > 0 && entry.cfg_neighborhoods.length > 0
    return {
      root,
      disposition: recovered ? 'static-path-recovered' as const : 'unknown' as const,
      xref_count: entry.xref_count,
      call_path_count: entry.call_paths.length,
      cfg_neighborhood_count: entry.cfg_neighborhoods.length,
      state_neighborhood_count: entry.state_neighborhoods.length,
      wrapper_cfg_budget_truncations: entry.cfg_neighborhoods.filter((row) => row.budget_truncated).length,
      searched_surfaces: entry.searched_surfaces,
      next_minimal_action: recovered ? null : (entry.next_minimal_action ?? 'use a dynamic hook anchor to select the next bounded module neighborhood'),
    }
  })
  const limitations = [
    'root matches are static candidates and do not establish runtime reachability',
    'wrapper CFGs above the per-root node budget are marked truncated while bundle-table module slices remain complete',
    'native or encrypted transport paths without a recovered JavaScript anchor remain bounded Unknown until dynamic corroboration',
  ]
  const base: Omit<StaticClosureSummary, 'deterministic_digest'> = {
    schema_version: 'oracle-lab-phase3a-static-closure-summary.v1',
    status: 'complete',
    binding: inventory.binding,
    discovery_artifact_sha256: discoveryArtifactSha256,
    discovery_deterministic_digest: recordedDigest,
    module_slices: {
      count: inventory.parse.module_slice_count,
      aggregate_nodes: inventory.parse.aggregate_module_nodes,
      max_nodes: inventory.parse.max_module_nodes,
      node_budget: inventory.parse.node_budget,
      budget_exceeded: inventory.parse.budget_exceeded_modules,
    },
    source_sink_categories: inventory.inventory.map(({ category, kind, match_count, module_count }) => ({ category, kind, match_count, module_count })),
    safe_env_key_count: inventory.safe_env_keys.length,
    env_key_classes: envClasses(inventory.safe_env_keys),
    required_roots: requiredRoots,
    unresolved_dynamic_edge_count: inventory.unresolved_dynamic_edges.length,
    limitations,
  }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

function args(argv: string[]): Record<string, string> {
  const output: Record<string, string> = {}
  const values = argv[0] === '--' ? argv.slice(1) : argv
  for (let index = 0; index < values.length; index += 1) {
    if (!values[index]?.startsWith('--')) fail('invalid_arguments', 'arguments must start with --name')
    const name = values[index].slice(2)
    const next = values[index + 1]
    if (!next || next.startsWith('--')) output[name] = 'true'
    else { output[name] = next; index += 1 }
  }
  return output
}

export function runStaticClosureCli(argv: string[]): void {
  const values = args(argv)
  if (!values.inventory || !values.out) fail('invalid_arguments', '--inventory and --out are required')
  const inventory = JSON.parse(readFileSync(values.inventory, 'utf8')) as DiscoveryInventory
  const summary = buildStaticClosureSummary(inventory, sha256File(values.inventory))
  writeFileSync(values.out, `${canonicalJson(summary)}\n`, { flag: 'wx', mode: 0o600 })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runStaticClosureCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${canonicalJson(stableError(error))}\n`)
    process.exitCode = 1
  }
}
