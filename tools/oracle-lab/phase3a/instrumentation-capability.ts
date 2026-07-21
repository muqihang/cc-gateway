import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { BASELINE_PROMPT, buildBaselineManifest } from './baseline-cell.js'
import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'
import type { LaunchManifest } from './launch-manifest.js'
import { startFakeUpstream, type SafeUpstreamEvent } from './observers/fake-upstream.js'
import { buildProbePayload, patchProbeCopy, signProbeCopy } from './probe-copy.js'
import { runCell, runCellGuardSelfTest, type CellResult } from './run-cell.js'

type PairInput = {
  control_status: CellResult['status']
  treatment_status: CellResult['status']
  control_events: SafeUpstreamEvent[]
  treatment_events: SafeUpstreamEvent[]
  treatment_hook_events: number
  control_process_samples: number
  treatment_process_samples: number
}

export type InstrumentationClassification = {
  input: PairInput
  classification: 'instrumentation-equivalent' | 'instrumentation-perturbed' | 'hook-unavailable'
  hook_reachable: boolean
  semantic_behavior_equal: boolean
  dual_source: boolean
  control_semantic_sha256: string
  treatment_semantic_sha256: string
}

type CapabilityOptions = {
  evidence_root: string
  entrypoint: string
  out_relative: string
  capability_id: string
  cc_commit: string
  cc_tree: string
  sub2api_commit: string
  sub2api_tree: string
  plan_sha256: string
  toolchain_digest: string
  static_inventory_sha256: string
}

type ProbeCopyCapabilityOptions = CapabilityOptions & {
  expected_parent_sha256: string
  module_offset: number
  module_length: number
  expected_module_sha256: string
  patch_offset: number
  patch_length: number
  expected_before_sha256: string
}

function fail(code: string, message: string): never { throw new Phase3AError(code, message) }

function semanticEvents(events: SafeUpstreamEvent[]): unknown {
  return events.map((event) => ({
    method: event.method,
    path_class: event.path_class,
    header_names: event.header_names,
    header_value_classes: event.header_value_classes,
    body_topology: event.body_topology,
    response_class: event.response_class,
    request_class: event.request_class,
    system_summary: event.system_summary,
    cch_class: event.cch_class,
  }))
}

export function classifyInstrumentationPair(input: PairInput): InstrumentationClassification {
  const controlDigest = sha256Bytes(canonicalJson(semanticEvents(input.control_events)))
  const treatmentDigest = sha256Bytes(canonicalJson(semanticEvents(input.treatment_events)))
  const hookReachable = input.treatment_hook_events > 0
  const equal = input.control_status === input.treatment_status && controlDigest === treatmentDigest
  return {
    input,
    classification: !hookReachable ? 'hook-unavailable' : equal ? 'instrumentation-equivalent' : 'instrumentation-perturbed',
    hook_reachable: hookReachable,
    semantic_behavior_equal: equal,
    dual_source: hookReachable && input.control_events.length > 0 && input.treatment_events.length > 0
      && input.control_process_samples > 0 && input.treatment_process_samples > 0,
    control_semantic_sha256: controlDigest,
    treatment_semantic_sha256: treatmentDigest,
  }
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${canonicalJson(value)}\n`, { flag: 'wx', mode: 0o600 })
}

function pairedManifest(base: LaunchManifest, capabilityId: string, arm: 'control' | 'treatment', sequenceIndex: number, hook: boolean): LaunchManifest {
  const runId = `${capabilityId}-${arm}`
  return {
    ...structuredClone(base),
    run_id: runId,
    pair_id: capabilityId,
    sequence_index: sequenceIndex,
    randomization_seed: 8215,
    hypothesis_id: `${capabilityId}-reachability-and-perturbation`,
    evidence_level_ceiling: 'Observed',
    command: { ...base.command, cwd: `runs/${runId}/cwd` },
    environment: { ...base.environment, home: `runs/${runId}/home`, xdg: `runs/${runId}/xdg`, tmp: `runs/${runId}/tmp` },
    matrix: { changed_variable: 'instrumentation', control_value: 'none', treatment_value: 'bun', fixed_variables: { ...base.matrix.fixed_variables, capability: 'bun-preload' } },
    capture: { ...base.capture, hook, process: true, fs: true, network: true, http: true },
  }
}

export function buildProbePairManifests(
  base: LaunchManifest,
  capabilityId: string,
  treatmentExecutableSha256: string,
  probeRecipeSha256: string,
): { control: LaunchManifest; treatment: LaunchManifest } {
  for (const [label, digest] of [['treatment executable', treatmentExecutableSha256], ['probe recipe', probeRecipeSha256]]) {
    if (!/^[a-f0-9]{64}$/.test(digest)) fail('invalid_digest', `${label} digest must be SHA-256`)
  }
  const manifest = (arm: 'control' | 'treatment', sequenceIndex: number, executableSha256: string, hook: boolean): LaunchManifest => {
    const runId = `${capabilityId}-${arm}`
    return {
      ...structuredClone(base),
      run_id: runId,
      pair_id: capabilityId,
      sequence_index: sequenceIndex,
      hypothesis_id: `${capabilityId}-reachability-and-perturbation`,
      evidence_level_ceiling: 'Observed',
      artifact: { ...base.artifact, entrypoint_sha256: executableSha256 },
      command: { ...base.command, executable_sha256: executableSha256, cwd: `runs/${runId}/cwd` },
      environment: { ...base.environment, home: `runs/${runId}/home`, xdg: `runs/${runId}/xdg`, tmp: `runs/${runId}/tmp` },
      matrix: {
        changed_variable: 'instrumentation-artifact', control_value: 'original', treatment_value: 'probe-copy',
        fixed_variables: { ...base.matrix.fixed_variables, parent_artifact_sha256: base.command.executable_sha256, probe_recipe_sha256: probeRecipeSha256 },
      },
      capture: { ...base.capture, hook, process: true, fs: true, network: true, http: true },
    }
  }
  return {
    control: manifest('control', 0, base.command.executable_sha256, false),
    treatment: manifest('treatment', 1, treatmentExecutableSha256, true),
  }
}

export async function runInstrumentationCapability(options: CapabilityOptions): Promise<Record<string, unknown>> {
  if (!/^[a-z0-9][a-z0-9-]{7,95}$/.test(options.capability_id)) fail('invalid_capability_id', 'capability id must be a bounded lowercase slug')
  for (const [label, digest] of [['plan', options.plan_sha256], ['toolchain', options.toolchain_digest], ['static inventory', options.static_inventory_sha256]]) {
    if (!/^[a-f0-9]{64}$/.test(digest)) fail('invalid_digest', `${label} digest must be SHA-256`)
  }
  const root = ensureEvidenceRoot(options.evidence_root)
  const output = assertEvidencePath(root, path.join(root, options.out_relative))
  if (existsSync(output)) fail('evidence_exists', 'capability output path already exists')
  mkdirSync(output, { recursive: true, mode: 0o700 })
  const upstream = await startFakeUpstream({ scenario: { kind: 'anthropic' }, max_body_bytes: 8 * 1024 * 1024 })
  try {
    const base = buildBaselineManifest({
      evidence_root: root, entrypoint: options.entrypoint, out_relative: options.out_relative,
      run_id: `${options.capability_id}-base`, cc_commit: options.cc_commit, cc_tree: options.cc_tree,
      sub2api_commit: options.sub2api_commit, sub2api_tree: options.sub2api_tree,
      plan_sha256: options.plan_sha256, toolchain_digest: options.toolchain_digest, command_profile: 'full',
    }, upstream.url, upstream.port)
    const control = pairedManifest(base, options.capability_id, 'control', 0, false)
    const treatment = pairedManifest(base, options.capability_id, 'treatment', 1, true)
    const controlDir = path.join(output, 'control')
    const treatmentDir = path.join(output, 'treatment')
    mkdirSync(controlDir, { mode: 0o700 })
    mkdirSync(treatmentDir, { mode: 0o700 })

    const controlGuard = await runCellGuardSelfTest(control, root)
    writeJson(path.join(controlDir, 'manifest.json'), control)
    writeJson(path.join(controlDir, 'guard.json'), controlGuard)
    const controlStart = upstream.events.length
    const controlResult = await runCell({ manifest: control, evidence_root: root, executable: options.entrypoint, instrumentation: 'none', guard: controlGuard, stdin: BASELINE_PROMPT })
    const controlEvents = upstream.events.slice(controlStart)
    writeJson(path.join(controlDir, 'observer.json'), { schema_version: 'oracle-lab-phase3a-safe-observer.v1', raw_material_persisted: false, events: controlEvents })
    writeJson(path.join(controlDir, 'result.json'), controlResult)

    const treatmentGuard = await runCellGuardSelfTest(treatment, root)
    writeJson(path.join(treatmentDir, 'manifest.json'), treatment)
    writeJson(path.join(treatmentDir, 'guard.json'), treatmentGuard)
    const treatmentStart = upstream.events.length
    const treatmentResult = await runCell({ manifest: treatment, control_manifest: control, evidence_root: root, executable: options.entrypoint, instrumentation: 'bun', guard: treatmentGuard, stdin: BASELINE_PROMPT })
    const treatmentEvents = upstream.events.slice(treatmentStart)
    writeJson(path.join(treatmentDir, 'observer.json'), { schema_version: 'oracle-lab-phase3a-safe-observer.v1', raw_material_persisted: false, events: treatmentEvents })
    writeJson(path.join(treatmentDir, 'result.json'), treatmentResult)

    const classified = classifyInstrumentationPair({
      control_status: controlResult.status, treatment_status: treatmentResult.status,
      control_events: controlEvents, treatment_events: treatmentEvents,
      treatment_hook_events: treatmentResult.hook_event_count,
      control_process_samples: controlResult.process_samples.length, treatment_process_samples: treatmentResult.process_samples.length,
    })
    const summary = {
      schema_version: 'oracle-lab-phase3a-instrumentation-capability.v1',
      status: classified.classification === 'instrumentation-equivalent' && classified.dual_source ? 'PASS' : 'UNKNOWN',
      artifact_sha256: sha256File(options.entrypoint), static_inventory_sha256: options.static_inventory_sha256,
      instrumentation: 'bun', classification: classified.classification,
      hook_reachable: classified.hook_reachable, semantic_behavior_equal: classified.semantic_behavior_equal, dual_source: classified.dual_source,
      control: { run_id: control.run_id, status: controlResult.status, event_count: controlEvents.length, process_samples: controlResult.process_samples.length, max_sockets: controlResult.max_sockets, semantic_sha256: classified.control_semantic_sha256 },
      treatment: { run_id: treatment.run_id, status: treatmentResult.status, event_count: treatmentEvents.length, process_samples: treatmentResult.process_samples.length, max_sockets: treatmentResult.max_sockets, hook_event_count: treatmentResult.hook_event_count, semantic_sha256: classified.treatment_semantic_sha256 },
      external_socket_budget: 0, raw_material_persisted: false,
    }
    writeJson(path.join(output, 'summary.json'), summary)
    return summary
  } finally {
    await upstream.close()
  }
}

export async function runProbeCopyCapability(options: ProbeCopyCapabilityOptions): Promise<Record<string, unknown>> {
  if (!/^[a-z0-9][a-z0-9-]{7,95}$/.test(options.capability_id)) fail('invalid_capability_id', 'capability id must be a bounded lowercase slug')
  for (const [label, digest] of [
    ['plan', options.plan_sha256], ['toolchain', options.toolchain_digest], ['static inventory', options.static_inventory_sha256],
    ['parent artifact', options.expected_parent_sha256], ['module', options.expected_module_sha256], ['patch region', options.expected_before_sha256],
  ]) {
    if (!/^[a-f0-9]{64}$/.test(digest)) fail('invalid_digest', `${label} digest must be SHA-256`)
  }
  const root = ensureEvidenceRoot(options.evidence_root)
  const output = assertEvidencePath(root, path.join(root, options.out_relative))
  if (existsSync(output)) fail('evidence_exists', 'capability output path already exists')
  mkdirSync(output, { recursive: true, mode: 0o700 })

  const copyRelative = path.join(options.out_relative, 'artifact', 'claude-probe-copy')
  const copy = assertEvidencePath(root, path.join(root, copyRelative))
  const recipe = patchProbeCopy({
    evidence_root: root,
    source: options.entrypoint,
    destination_relative: copyRelative,
    expected_parent_sha256: options.expected_parent_sha256,
    module_offset: options.module_offset,
    module_length: options.module_length,
    expected_module_sha256: options.expected_module_sha256,
    patch_offset: options.patch_offset,
    patch_length: options.patch_length,
    expected_before_sha256: options.expected_before_sha256,
    payload: buildProbePayload(options.patch_length),
  })
  writeJson(path.join(output, 'patch-recipe.json'), recipe)
  const signing = signProbeCopy(copy, recipe)
  writeJson(path.join(output, 'signing.json'), signing)
  if (signing.status !== 'PASS') fail('probe_sign_failed', 'ad-hoc signing or post-sign verification failed')

  const upstream = await startFakeUpstream({ scenario: { kind: 'anthropic' }, max_body_bytes: 8 * 1024 * 1024 })
  try {
    const base = buildBaselineManifest({
      evidence_root: root, entrypoint: options.entrypoint, out_relative: options.out_relative,
      run_id: `${options.capability_id}-base`, cc_commit: options.cc_commit, cc_tree: options.cc_tree,
      sub2api_commit: options.sub2api_commit, sub2api_tree: options.sub2api_tree,
      plan_sha256: options.plan_sha256, toolchain_digest: options.toolchain_digest, command_profile: 'full',
    }, upstream.url, upstream.port)
    const { control, treatment } = buildProbePairManifests(base, options.capability_id, signing.post_sign_sha256, recipe.patch.recipe_sha256)
    const controlDir = path.join(output, 'control')
    const treatmentDir = path.join(output, 'treatment')
    mkdirSync(controlDir, { mode: 0o700 })
    mkdirSync(treatmentDir, { mode: 0o700 })

    const controlGuard = await runCellGuardSelfTest(control, root)
    writeJson(path.join(controlDir, 'manifest.json'), control)
    writeJson(path.join(controlDir, 'guard.json'), controlGuard)
    const controlStart = upstream.events.length
    const controlResult = await runCell({ manifest: control, evidence_root: root, executable: options.entrypoint, instrumentation: 'none', guard: controlGuard, stdin: BASELINE_PROMPT })
    const controlEvents = upstream.events.slice(controlStart)
    writeJson(path.join(controlDir, 'observer.json'), { schema_version: 'oracle-lab-phase3a-safe-observer.v1', raw_material_persisted: false, events: controlEvents })
    writeJson(path.join(controlDir, 'result.json'), controlResult)

    const treatmentGuard = await runCellGuardSelfTest(treatment, root)
    writeJson(path.join(treatmentDir, 'manifest.json'), treatment)
    writeJson(path.join(treatmentDir, 'guard.json'), treatmentGuard)
    const treatmentStart = upstream.events.length
    const treatmentResult = await runCell({ manifest: treatment, evidence_root: root, executable: copy, instrumentation: 'none', guard: treatmentGuard, stdin: BASELINE_PROMPT })
    const treatmentEvents = upstream.events.slice(treatmentStart)
    writeJson(path.join(treatmentDir, 'observer.json'), { schema_version: 'oracle-lab-phase3a-safe-observer.v1', raw_material_persisted: false, events: treatmentEvents })
    writeJson(path.join(treatmentDir, 'result.json'), treatmentResult)

    const classified = classifyInstrumentationPair({
      control_status: controlResult.status, treatment_status: treatmentResult.status,
      control_events: controlEvents, treatment_events: treatmentEvents,
      treatment_hook_events: treatmentResult.hook_event_count,
      control_process_samples: controlResult.process_samples.length, treatment_process_samples: treatmentResult.process_samples.length,
    })
    const summary = {
      schema_version: 'oracle-lab-phase3a-instrumentation-capability.v1',
      status: classified.classification === 'instrumentation-equivalent' && classified.dual_source ? 'PASS' : 'UNKNOWN',
      method: 'probe-copy', instrumentation: { control: 'none', treatment: 'none' },
      artifact_sha256: options.expected_parent_sha256, static_inventory_sha256: options.static_inventory_sha256,
      artifact_difference: {
        expected: true, original_unchanged: sha256File(options.entrypoint) === options.expected_parent_sha256,
        control_executable_sha256: options.expected_parent_sha256, treatment_executable_sha256: signing.post_sign_sha256,
        pre_sign_sha256: recipe.pre_sign_sha256, post_sign_sha256: signing.post_sign_sha256,
        parent_size: recipe.parent_size, post_sign_size: signing.post_sign_size, size_delta_bytes: signing.size_delta_bytes,
        module_before_sha256: recipe.module.before_sha256, module_after_sha256: recipe.module.after_sha256,
        module_after_sign_sha256: signing.module_after_sign_sha256, patch_recipe_sha256: recipe.patch.recipe_sha256,
      },
      signing_status: signing.status, classification: classified.classification,
      hook_reachable: classified.hook_reachable, semantic_behavior_equal: classified.semantic_behavior_equal, dual_source: classified.dual_source,
      control: {
        run_id: control.run_id, status: controlResult.status, event_count: controlEvents.length,
        process_samples: controlResult.process_samples.length, max_sockets: controlResult.max_sockets,
        hook_event_count: controlResult.hook_event_count, semantic_sha256: classified.control_semantic_sha256,
      },
      treatment: {
        run_id: treatment.run_id, status: treatmentResult.status, event_count: treatmentEvents.length,
        process_samples: treatmentResult.process_samples.length, max_sockets: treatmentResult.max_sockets,
        hook_event_count: treatmentResult.hook_event_count, semantic_sha256: classified.treatment_semantic_sha256,
      },
      source_agreement: {
        observer: controlEvents.length > 0 && treatmentEvents.length > 0,
        process: controlResult.process_samples.length > 0 && treatmentResult.process_samples.length > 0,
        filesystem_hook_jsonl: treatmentResult.hook_event_count > 0,
      },
      external_socket_budget: 0, raw_material_persisted: false,
    }
    writeJson(path.join(output, 'summary.json'), summary)
    return summary
  } finally {
    await upstream.close()
  }
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const values = args(process.argv.slice(2))
    const required = ['evidence-root', 'entrypoint', 'out-relative', 'capability-id', 'cc-commit', 'cc-tree', 'sub2api-commit', 'sub2api-tree', 'plan-sha256', 'toolchain-digest', 'static-inventory-sha256']
    for (const key of required) if (!values[key]) fail('invalid_arguments', `--${key} is required`)
    if (values.method && !['bun', 'probe-copy'].includes(values.method)) fail('invalid_arguments', '--method must be bun or probe-copy')
    if (values.method === 'probe-copy') {
      for (const key of ['expected-parent-sha256', 'expected-module-sha256', 'expected-before-sha256', 'module-offset', 'module-length', 'patch-offset', 'patch-length']) {
        if (!values[key]) fail('invalid_arguments', `--${key} is required for probe-copy`)
      }
    }
    const common = {
      evidence_root: values['evidence-root'], entrypoint: path.resolve(values.entrypoint), out_relative: values['out-relative'], capability_id: values['capability-id'],
      cc_commit: values['cc-commit'], cc_tree: values['cc-tree'], sub2api_commit: values['sub2api-commit'], sub2api_tree: values['sub2api-tree'],
      plan_sha256: values['plan-sha256'], toolchain_digest: values['toolchain-digest'], static_inventory_sha256: values['static-inventory-sha256'],
    }
    const result = values.method === 'probe-copy'
      ? await runProbeCopyCapability({
        ...common,
        expected_parent_sha256: values['expected-parent-sha256'], expected_module_sha256: values['expected-module-sha256'],
        expected_before_sha256: values['expected-before-sha256'], module_offset: Number(values['module-offset']),
        module_length: Number(values['module-length']), patch_offset: Number(values['patch-offset']), patch_length: Number(values['patch-length']),
      })
      : await runInstrumentationCapability(common)
    process.stdout.write(`${canonicalJson(result)}\n`)
  } catch (error) {
    process.stderr.write(`${canonicalJson(stableError(error))}\n`)
    process.exitCode = 1
  }
}
