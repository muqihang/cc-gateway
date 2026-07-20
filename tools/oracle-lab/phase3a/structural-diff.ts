import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalJson, Phase3AError, sha256Bytes, stableError } from './core.js'
import type { ExtractionIndex } from './extract-bundle.js'
import type { AstRecovery } from './recover-ast.js'
import type { StaticInventory } from './static-inventory.js'

export type StaticSnapshot = {
  version: string
  inventory?: StaticInventory
  extraction?: ExtractionIndex
  recoveries: AstRecovery[]
}

export type StructuralDelta = {
  category: 'sections' | 'resources' | 'modules' | 'ast' | 'xrefs' | 'callgraph' | 'cfg' | 'state-machines' | 'serialization'
  added: string[]
  removed: string[]
  changed: string[]
  unchanged_count: number
  fingerprints: Array<{ key: string; active_sha256: string | null; control_sha256: string | null }>
}

export type StructuralDiff = {
  schema_version: 'oracle-lab-phase3a-structural-diff.v1'
  hypothesis_id: string
  active_version: string
  control_version: string
  active_artifact_sha256: string[]
  control_artifact_sha256: string[]
  command_sha256: string
  method: 'bounded-structural-index-diff-no-full-text'
  deltas: StructuralDelta[]
  semantic_change: boolean
  confidence: 'high' | 'medium' | 'low'
  unresolved_paths: Array<{ root: string; reason: string; next_minimal_action: string }>
  dynamic_cells_required: string[]
  deterministic_digest: string
}

function fail(code: string, message: string): never {
  throw new Phase3AError(code, message)
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function delta(category: StructuralDelta['category'], active: Map<string, string>, control: Map<string, string>): StructuralDelta {
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  let unchanged = 0
  for (const key of sorted(new Set([...active.keys(), ...control.keys()]))) {
    const activeValue = active.get(key)
    const controlValue = control.get(key)
    if (activeValue === undefined) removed.push(key)
    else if (controlValue === undefined) added.push(key)
    else if (activeValue !== controlValue) changed.push(key)
    else unchanged += 1
  }
  const fingerprints = [...added, ...removed, ...changed].sort().map((key) => ({ key, active_sha256: active.get(key) ?? null, control_sha256: control.get(key) ?? null }))
  return { category, added, removed, changed, unchanged_count: unchanged, fingerprints }
}

function digestValue(value: unknown): string {
  return sha256Bytes(canonicalJson(value))
}

function sectionMap(snapshot: StaticSnapshot): Map<string, string> {
  const output = new Map<string, string>()
  for (const slice of snapshot.inventory?.slices ?? []) {
    slice.sections.forEach((section, index) => output.set(
      `${slice.index}:${slice.architecture}:${section.segment}:${section.section}:${index}`,
      digestValue({ length: section.length, sha256: section.sha256, flags: section.flags, file_backed: section.file_backed }),
    ))
  }
  return output
}

function resourceMap(snapshot: StaticSnapshot): Map<string, string> {
  const output = new Map<string, string>()
  for (const candidate of snapshot.extraction?.candidates ?? []) {
    const key = `${candidate.source}:${candidate.segment ?? ''}:${candidate.section ?? ''}:${candidate.location.offset}`
    output.set(key, digestValue({ sha256: candidate.sha256, byte_length: candidate.byte_length, encoding: candidate.encoding, classification: candidate.classification }))
  }
  return output
}

function moduleMap(snapshot: StaticSnapshot): Map<string, string> {
  const output = new Map<string, string>()
  snapshot.recoveries.forEach((recovery, recoveryIndex) => recovery.modules.forEach((module, moduleIndex) => {
    output.set(`${recoveryIndex}:${module.kind}:${moduleIndex}`, digestValue({ ast_sha256: module.ast_sha256, key_sha256: module.key_sha256 }))
  }))
  return output
}

function astMap(snapshot: StaticSnapshot): Map<string, string> {
  return new Map(snapshot.recoveries.map((recovery, index) => [String(index), recovery.parse.canonical_ast_sha256]))
}

function xrefMap(snapshot: StaticSnapshot): Map<string, string> {
  const grouped = new Map<string, string[]>()
  for (const recovery of snapshot.recoveries) {
    for (const xref of recovery.literal_xrefs) {
      const values = grouped.get(xref.root) ?? []
      values.push(digestValue({ literal_class: xref.literal_class, value_sha256: xref.value_sha256, byte_length: xref.byte_length }))
      grouped.set(xref.root, values)
    }
  }
  return new Map([...grouped].map(([key, values]) => [key, digestValue(sorted(values))]))
}

function callgraphMap(snapshot: StaticSnapshot): Map<string, string> {
  const output = new Map<string, string>()
  snapshot.recoveries.forEach((recovery, recoveryIndex) => {
    recovery.callgraph.nodes.forEach((node, nodeIndex) => output.set(`${recoveryIndex}:node:${nodeIndex}`, digestValue({ kind: node.kind, ast_sha256: node.ast_sha256 })))
    const nodeOrdinals = new Map(recovery.callgraph.nodes.map((node, index) => [node.id, String(index)]))
    const edges = recovery.callgraph.edges.map((edge) => ({ caller: nodeOrdinals.get(edge.caller) ?? edge.caller, callee: nodeOrdinals.get(edge.callee) ?? edge.callee, kind: edge.kind }))
      .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))
    const unresolved = recovery.callgraph.unresolved.map((edge) => ({ caller: nodeOrdinals.get(edge.caller) ?? edge.caller, reason: edge.reason, shape: edge.callee_shape_sha256 }))
      .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))
    output.set(`${recoveryIndex}:edges`, digestValue({ edges, unresolved }))
  })
  return output
}

function cfgMap(snapshot: StaticSnapshot): Map<string, string> {
  const output = new Map<string, string>()
  snapshot.recoveries.forEach((recovery, recoveryIndex) => recovery.cfg.forEach((cfg, functionIndex) => {
    const edgeKinds = cfg.edges.map((edge) => edge.kind).sort()
    output.set(`${recoveryIndex}:${functionIndex}`, digestValue({ node_count: cfg.node_count, edge_kinds: edgeKinds }))
  }))
  return output
}

function stateMap(snapshot: StaticSnapshot): Map<string, string> {
  const output = new Map<string, string>()
  snapshot.recoveries.forEach((recovery, recoveryIndex) => recovery.state_machines.forEach((machine, machineIndex) => {
    const transitions = machine.transitions.map((transition) => ({ from: transition.from_sha256, to: transition.to_sha256, kind: transition.kind }))
      .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))
    output.set(`${recoveryIndex}:${machineIndex}`, digestValue({ discriminator: machine.discriminator_sha256, transitions }))
  }))
  return output
}

function serializationMap(snapshot: StaticSnapshot): Map<string, string> {
  const output = new Map<string, string>()
  snapshot.recoveries.forEach((recovery, recoveryIndex) => {
    const xrefs = recovery.literal_xrefs.filter((xref) => xref.root === 'request-serialization' || xref.root === 'system-prompt' || xref.root === 'cch-billing-cache-compact')
      .map((xref) => ({ root: xref.root, literal_class: xref.literal_class, value_sha256: xref.value_sha256, byte_length: xref.byte_length }))
      .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))
    output.set(String(recoveryIndex), digestValue(xrefs))
  })
  return output
}

function artifactDigests(snapshot: StaticSnapshot): string[] {
  return sorted(new Set([
    ...(snapshot.inventory ? [snapshot.inventory.binding.artifact_sha256] : []),
    ...(snapshot.extraction ? [snapshot.extraction.artifact_sha256] : []),
    ...snapshot.recoveries.map((recovery) => recovery.binding.artifact_sha256),
  ]))
}

function validateSnapshot(snapshot: StaticSnapshot, role: string): void {
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(snapshot.version)) fail('static_version_invalid', `${role} version must be exact semver`)
  if (snapshot.recoveries.length === 0) fail('static_input_missing', `${role} snapshot has no AST recovery`)
  for (const recovery of snapshot.recoveries) {
    if (recovery.parse.canonical_ast_sha256 !== recovery.parse.reparsed_canonical_ast_sha256 || recovery.parse.parser_agreement !== 'agreed') {
      fail('static_ast_drift', `${role} recovery lacks parser agreement`)
    }
  }
  if (snapshot.inventory && snapshot.extraction && snapshot.inventory.binding.artifact_sha256 !== snapshot.extraction.artifact_sha256) {
    fail('static_binding_invalid', `${role} inventory and extraction bind different artifacts`)
  }
}

export function structuralDiff(input: { active: StaticSnapshot; control: StaticSnapshot; hypothesisId: string }): StructuralDiff {
  validateSnapshot(input.active, 'active')
  validateSnapshot(input.control, 'control')
  if (input.active.version === input.control.version) fail('static_control_invalid', 'active and control versions must differ')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.hypothesisId)) fail('static_hypothesis_invalid', 'hypothesis id is invalid')
  const deltas = [
    delta('sections', sectionMap(input.active), sectionMap(input.control)),
    delta('resources', resourceMap(input.active), resourceMap(input.control)),
    delta('modules', moduleMap(input.active), moduleMap(input.control)),
    delta('ast', astMap(input.active), astMap(input.control)),
    delta('xrefs', xrefMap(input.active), xrefMap(input.control)),
    delta('callgraph', callgraphMap(input.active), callgraphMap(input.control)),
    delta('cfg', cfgMap(input.active), cfgMap(input.control)),
    delta('state-machines', stateMap(input.active), stateMap(input.control)),
    delta('serialization', serializationMap(input.active), serializationMap(input.control)),
  ]
  const semanticCategories = new Set<StructuralDelta['category']>(['modules', 'ast', 'xrefs', 'callgraph', 'cfg', 'state-machines', 'serialization'])
  const semanticChange = deltas.some((entry) => semanticCategories.has(entry.category) && entry.added.length + entry.removed.length + entry.changed.length > 0)
  const unknownRoots = new Map<string, string>()
  for (const snapshot of [input.active, input.control]) {
    for (const recovery of snapshot.recoveries) {
      for (const root of recovery.root_coverage) {
        if (root.status === 'unknown') unknownRoots.set(root.root, root.next_minimal_action ?? 'perform a bounded dynamic observation')
      }
    }
  }
  const unresolved = sorted(unknownRoots.keys()).map((root) => ({ root, reason: 'static-path-unknown', next_minimal_action: unknownRoots.get(root)! }))
  const dynamicCells = sorted(new Set([
    ...unresolved.map((entry) => `dynamic-root:${entry.root}`),
    ...deltas.filter((entry) => entry.category === 'serialization' && entry.added.length + entry.removed.length + entry.changed.length > 0).map(() => `dynamic-hypothesis:${input.hypothesisId}:serialization`),
    ...deltas.filter((entry) => entry.category === 'state-machines' && entry.added.length + entry.removed.length + entry.changed.length > 0).map(() => `dynamic-hypothesis:${input.hypothesisId}:state-machine`),
  ]))
  const activeDigests = artifactDigests(input.active)
  const controlDigests = artifactDigests(input.control)
  const base: Omit<StructuralDiff, 'deterministic_digest'> = {
    schema_version: 'oracle-lab-phase3a-structural-diff.v1',
    hypothesis_id: input.hypothesisId,
    active_version: input.active.version,
    control_version: input.control.version,
    active_artifact_sha256: activeDigests,
    control_artifact_sha256: controlDigests,
    command_sha256: sha256Bytes(canonicalJson({ operation: 'structural-diff', version: '1', hypothesis_id: input.hypothesisId, active_version: input.active.version, control_version: input.control.version, active_artifacts: activeDigests, control_artifacts: controlDigests })),
    method: 'bounded-structural-index-diff-no-full-text',
    deltas,
    semantic_change: semanticChange,
    confidence: unresolved.length === 0 ? 'high' : semanticChange ? 'medium' : 'low',
    unresolved_paths: unresolved,
    dynamic_cells_required: dynamicCells,
  }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

function args(argv: string[]): Record<string, string> {
  const output: Record<string, string> = {}
  const values = argv[0] === '--' ? argv.slice(1) : argv
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith('--') || !values[index + 1]) fail('invalid_arguments', 'arguments must be --name value pairs')
    output[values[index].slice(2)] = values[index + 1]
  }
  return output
}

export function runStructuralDiffCli(argv: string[]): void {
  const values = args(argv)
  if (!values.active || !values.control || !values.hypothesis) fail('invalid_arguments', '--active, --control and --hypothesis are required')
  let active: StaticSnapshot
  let control: StaticSnapshot
  if (values['static-root']) {
    active = JSON.parse(readFileSync(path.join(values['static-root'], values.active, 'snapshot.json'), 'utf8')) as StaticSnapshot
    control = JSON.parse(readFileSync(path.join(values['static-root'], values.control, 'snapshot.json'), 'utf8')) as StaticSnapshot
  } else {
    active = JSON.parse(readFileSync(values.active, 'utf8')) as StaticSnapshot
    control = JSON.parse(readFileSync(values.control, 'utf8')) as StaticSnapshot
  }
  const result = structuralDiff({ active, control, hypothesisId: values.hypothesis })
  const serialized = `${canonicalJson(result)}\n`
  if (values.out) writeFileSync(values.out, serialized, { flag: 'wx', mode: 0o600 })
  else process.stdout.write(serialized)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runStructuralDiffCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${canonicalJson(stableError(error))}\n`)
    process.exitCode = 1
  }
}
