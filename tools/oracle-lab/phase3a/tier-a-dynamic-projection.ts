import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { analyzeConvergence } from './converge.js'
import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'
import { validateTierACellBindingCapsule, type TierACellBindingAssessment } from './tier-a-cell-binding-capsule.js'

type JsonObject = Record<string, any>

export type TierACellBindingSource = { path: string; sha256: string }
export type TierACellBindingSet = {
  binding_root: string
  sources: TierACellBindingSource[]
  cells: TierACellBindingAssessment[]
}

function fail(code: string, message: string): never { throw new Phase3AError(code, message) }

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function asObject(value: unknown, code: string, message: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(code, message)
  return value as JsonObject
}

function evidenceRelative(root: string, file: string): string {
  const relative = path.relative(root, file)
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('tier_a_projection_path_invalid', 'binding path escapes the evidence root')
  return relative.split(path.sep).join('/')
}

function capsuleFiles(root: string, directory: string): string[] {
  const stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('tier_a_projection_binding_path_invalid', 'binding root must be a real directory')
  const files: string[] = []
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const child = path.join(current, entry.name)
      if (entry.isSymbolicLink()) fail('tier_a_projection_binding_path_invalid', 'binding root contains a symlink')
      if (entry.isDirectory()) walk(child)
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(child)
    }
  }
  walk(directory)
  if (files.length === 0) fail('tier_a_projection_binding_missing', 'binding root contains no capsules')
  return files
}

/**
 * Read a lane-local append-only capsule directory and rederive every capsule
 * from the raw cell it claims to bind. The caller must reject a directory that
 * mixes another Tier A lane into this lane's evidence.
 */
export function loadTierACellBindingCapsules(input: {
  evidence_root: string
  campaign_root: string
  binding_root: string
  version: string
}): TierACellBindingSet {
  const evidenceRoot = ensureEvidenceRoot(input.evidence_root)
  const campaignInput = path.resolve(evidenceRoot, input.campaign_root)
  const bindingInput = path.resolve(evidenceRoot, input.binding_root)
  const campaignRoot = assertEvidencePath(evidenceRoot, existsSync(campaignInput) ? realpathSync(campaignInput) : campaignInput)
  const bindingRoot = assertEvidencePath(evidenceRoot, existsSync(bindingInput) ? realpathSync(bindingInput) : bindingInput)
  if (!existsSync(campaignRoot) || !lstatSync(campaignRoot).isDirectory() || lstatSync(campaignRoot).isSymbolicLink()) fail('tier_a_projection_path_invalid', 'campaign root must be a real directory')
  if (!existsSync(bindingRoot)) fail('tier_a_projection_binding_missing', 'binding root is missing')
  const cells: TierACellBindingAssessment[] = []
  const sources: TierACellBindingSource[] = []
  for (const file of capsuleFiles(evidenceRoot, bindingRoot)) {
    let capsule: JsonObject
    try { capsule = asObject(JSON.parse(readFileSync(file, 'utf8')), 'tier_a_projection_binding_invalid', 'binding capsule must be a JSON object') }
    catch (error) {
      if (error instanceof Phase3AError) throw error
      fail('tier_a_projection_binding_invalid', 'binding capsule is not valid JSON')
    }
    if (capsule.schema_version !== 'oracle-lab-phase3a-tier-a-cell-binding-capsule.v1' || capsule.lane !== 'tier-a'
      || typeof capsule.version !== 'string' || typeof capsule.required_pair !== 'string'
      || !Number.isInteger(capsule.repetition) || capsule.repetition < 0
      || (capsule.arm !== 'control' && capsule.arm !== 'treatment')) {
      fail('tier_a_projection_binding_invalid', 'binding capsule shape is invalid')
    }
    const assessed = validateTierACellBindingCapsule({
      evidence_root: evidenceRoot,
      campaign_root: campaignRoot,
      version: capsule.version,
      pair: capsule.required_pair,
      repetition: capsule.repetition,
      arm: capsule.arm,
      capsule,
    })
    if (assessed.version !== input.version) fail('tier_a_projection_binding_cross_lane', `binding capsule belongs to ${assessed.version}, not ${input.version}`)
    cells.push(assessed)
    sources.push({ path: evidenceRelative(evidenceRoot, file), sha256: sha256File(file) })
  }
  return {
    binding_root: evidenceRelative(evidenceRoot, bindingRoot),
    sources: sources.sort((left, right) => left.path.localeCompare(right.path)),
    cells,
  }
}

function requiredPairRows(lane: JsonObject): Array<{ required_pair: string; repetitions: number; pair: JsonObject }> {
  if (!Array.isArray(lane.required_pairs) || !Array.isArray(lane.pairs) || !Number.isInteger(lane.pair_count)) fail('tier_a_projection_lane_invalid', 'lane pair data is invalid')
  const requiredPairs = lane.required_pairs
  if (requiredPairs.length === 0 || new Set(requiredPairs).size !== requiredPairs.length || requiredPairs.some((pair) => typeof pair !== 'string')) fail('tier_a_projection_lane_invalid', 'lane required pairs are invalid')
  if (lane.pair_count !== requiredPairs.length || lane.pairs.length !== requiredPairs.length) fail('tier_a_projection_lane_invalid', 'lane pair count is invalid')
  return requiredPairs.map((requiredPair) => {
    const matches = lane.pairs.filter((pair: JsonObject) => pair?.required_pair === requiredPair)
    if (matches.length !== 1 || !Number.isInteger(matches[0].repetitions) || matches[0].repetitions < 5 || matches[0].repetitions > 12) {
      fail('tier_a_projection_lane_invalid', `lane pair ${requiredPair} has invalid convergence bounds`)
    }
    return { required_pair: requiredPair, repetitions: matches[0].repetitions, pair: matches[0] }
  })
}

function requireCellCoverage(cells: TierACellBindingAssessment[], lane: JsonObject, rows: ReturnType<typeof requiredPairRows>): void {
  if (cells.length === 0) fail('tier_a_projection_binding_missing', 'no binding capsules were supplied')
  const expectedVersion = String(lane.version)
  const expectedHypothesis = String(lane.hypothesis_id)
  const expectedPairs = new Set(rows.map((row) => row.required_pair))
  const seen = new Set<string>()
  for (const cell of cells) {
    if (cell.version !== expectedVersion || cell.hypothesis_id !== expectedHypothesis || !expectedPairs.has(cell.required_pair)) {
      fail('tier_a_projection_binding_cross_lane', 'binding capsule references a different Tier A lane')
    }
    const key = `${cell.required_pair}:${cell.arm}:${cell.repetition}`
    if (seen.has(key)) fail('tier_a_projection_binding_duplicate', `duplicate binding capsule for ${key}`)
    seen.add(key)
  }
  for (const row of rows) {
    for (let repetition = 0; repetition < row.repetitions; repetition += 1) {
      for (const arm of ['control', 'treatment'] as const) {
        if (!seen.has(`${row.required_pair}:${arm}:${repetition}`)) fail('tier_a_projection_binding_missing', `missing binding capsule for ${row.required_pair}:${arm}:${repetition}`)
      }
    }
  }
  const expectedCellCount = rows.reduce((count, row) => count + row.repetitions * 2, 0)
  if (seen.size !== expectedCellCount) fail('tier_a_projection_binding_cross_lane', 'binding capsules include cells outside the lane schedule')
}

function staticAnchor(lane: JsonObject): JsonObject {
  const active = asObject(lane.active, 'tier_a_projection_lane_invalid', 'lane active artifact is invalid')
  const control = asObject(lane.control, 'tier_a_projection_lane_invalid', 'lane control artifact is invalid')
  const structural = asObject(lane.structural, 'tier_a_projection_lane_invalid', 'lane static anchor is invalid')
  const fields = ['archive_sha256', 'tree_sha256', 'entrypoint_sha256'] as const
  const artifactsValid = fields.every((field) => isSha256(active[field]) && isSha256(control[field]))
  const expected = {
    archive_changed: active.archive_sha256 !== control.archive_sha256,
    tree_changed: active.tree_sha256 !== control.tree_sha256,
    entrypoint_changed: active.entrypoint_sha256 !== control.entrypoint_sha256,
  }
  const status = artifactsValid && structural.archive_changed === expected.archive_changed && structural.tree_changed === expected.tree_changed && structural.entrypoint_changed === expected.entrypoint_changed
    ? 'PASS' : 'BLOCKED'
  return { status, method: 'platform-entrypoint-tree-digest-delta', ...expected }
}

function artifactBinding(lane: JsonObject, cells: TierACellBindingAssessment[]): JsonObject {
  const active = asObject(lane.active, 'tier_a_projection_lane_invalid', 'lane active artifact is invalid')
  const control = asObject(lane.control, 'tier_a_projection_lane_invalid', 'lane control artifact is invalid')
  const matched = cells.every((cell) => {
    const capsule = cell.capsule as JsonObject
    const artifact = cell.arm === 'control' ? control : active
    return ['archive_sha256', 'tree_sha256', 'entrypoint_sha256'].every((field) => capsule[field] === artifact[field] && isSha256(capsule[field]))
  })
  return { status: matched ? 'PASS' : 'BLOCKED', validated_cells: cells.length }
}

function pairDiagnostics(row: ReturnType<typeof requiredPairRows>[number], cells: TierACellBindingAssessment[]): JsonObject {
  const pairCells = cells.filter((cell) => cell.required_pair === row.required_pair)
  const terminalCells = pairCells.filter((cell) => cell.terminal).length
  const dualSourceCells = pairCells.filter((cell) => cell.dual_source).length
  const perturbationFreeCells = pairCells.filter((cell) => cell.perturbation_free).length
  const sequence = pairCells.map((cell) => cell.sequence_index)
  const sequenceValid = sequence.every((index): index is number => index !== null) && new Set(sequence).size === sequence.length
  const convergence = analyzeConvergence(
    pairCells[0]?.pair_id ?? `tier-a-${row.required_pair}`,
    [...pairCells].sort((left, right) => (left.sequence_index ?? Number.MAX_SAFE_INTEGER) - (right.sequence_index ?? Number.MAX_SAFE_INTEGER)).map((cell) => ({
      run_id: cell.run_id,
      repetition: cell.repetition,
      arm: cell.arm,
      success: cell.terminal,
      observer_failures: cell.dual_source ? [] : ['dual-source-missing'],
      instrumented: !cell.perturbation_free,
      perturbation: cell.perturbation_free ? 'not-applicable' as const : 'perturbed' as const,
      normalized: { interface_sha256: cell.interface_sha256 },
    })),
  )
  const expectedCells = row.repetitions * 2
  return {
    required_pair: row.required_pair,
    expected_cells: expectedCells,
    terminal_cells: terminalCells,
    dual_source_cells: dualSourceCells,
    perturbation_free_cells: perturbationFreeCells,
    run_coverage: terminalCells === expectedCells ? 'PASS' : 'BLOCKED',
    dual_source: dualSourceCells === expectedCells ? 'PASS' : 'BLOCKED',
    perturbation: perturbationFreeCells === expectedCells ? 'PASS' : 'BLOCKED',
    convergence: sequenceValid && convergence.status === 'CONVERGED' ? 'PASS' : 'BLOCKED',
    convergence_status: convergence.status,
    convergence_order_digest: convergence.order_digest,
  }
}

export function projectTierADynamicLane(input: {
  campaign: JsonObject
  lane: JsonObject
  campaign_summary_path: string
  lane_summary_path: string
  campaign_summary_sha256: string
  lane_summary_sha256: string
  binding_capsules: TierACellBindingSet
}): JsonObject {
  if (input.campaign.schema_version !== 'oracle-lab-phase3a-tier-a-dynamic-campaign.v1' || input.campaign.external_socket_budget !== 0 || input.campaign.raw_material_persisted !== false) {
    fail('tier_a_projection_campaign_invalid', 'campaign safety binding is invalid')
  }
  if (input.lane.schema_version !== 'oracle-lab-phase3a-tier-a-lane-summary.v1' || !['REPRODUCED', 'UNKNOWN'].includes(input.lane.status) || input.lane.external_socket_budget !== 0 || input.lane.raw_material_persisted !== false) {
    fail('tier_a_projection_lane_invalid', 'lane safety binding is invalid')
  }
  for (const digest of [input.campaign_summary_sha256, input.lane_summary_sha256]) if (!isSha256(digest)) fail('tier_a_projection_digest_invalid', 'source digest must be SHA-256')
  for (const sourcePath of [input.campaign_summary_path, input.lane_summary_path]) if (!/^capsules\/P3A-3\/[A-Za-z0-9._/-]+\/summary\.json$/.test(sourcePath) || sourcePath.includes('..')) fail('tier_a_projection_path_invalid', 'source path must be an evidence-relative summary path')
  if (!input.binding_capsules || typeof input.binding_capsules.binding_root !== 'string' || !Array.isArray(input.binding_capsules.sources) || !Array.isArray(input.binding_capsules.cells)) fail('tier_a_projection_binding_missing', 'content-validated binding capsules are required')
  const rows = requiredPairRows(input.lane)
  requireCellCoverage(input.binding_capsules.cells, input.lane, rows)
  const diagnostics = rows.map((row) => pairDiagnostics(row, input.binding_capsules.cells))
  const staticAnchorDiagnostic = staticAnchor(input.lane)
  const artifactBindingDiagnostic = artifactBinding(input.lane, input.binding_capsules.cells)
  const everyPair = (key: 'run_coverage' | 'dual_source' | 'perturbation' | 'convergence') => diagnostics.every((row) => row[key] === 'PASS')
  const admission = {
    status: staticAnchorDiagnostic.status === 'PASS' && artifactBindingDiagnostic.status === 'PASS' && everyPair('run_coverage') && everyPair('dual_source') && everyPair('perturbation') && everyPair('convergence') ? 'PASS' : 'BLOCKED',
    static_anchor: staticAnchorDiagnostic,
    artifact_binding: artifactBindingDiagnostic,
    control_treatment_run_coverage: { status: everyPair('run_coverage') ? 'PASS' : 'BLOCKED' },
    dual_source: { status: everyPair('dual_source') ? 'PASS' : 'BLOCKED' },
    perturbation: { status: everyPair('perturbation') ? 'PASS' : 'BLOCKED' },
    convergence: { status: everyPair('convergence') ? 'PASS' : 'BLOCKED', pairs: diagnostics },
  }
  const pairs = rows.map((row) => {
    const diagnostic = diagnostics.find((candidate) => candidate.required_pair === row.required_pair)!
    const reproduced = row.pair.status === 'REPRODUCED' && diagnostic.run_coverage === 'PASS' && diagnostic.dual_source === 'PASS' && diagnostic.perturbation === 'PASS' && diagnostic.convergence === 'PASS'
    return {
      required_pair: row.required_pair,
      status: reproduced ? 'REPRODUCED' : 'UNKNOWN',
      terminal_cells: diagnostic.terminal_cells,
      dual_source_cells: diagnostic.dual_source_cells,
      protocol_cells: diagnostic.dual_source_cells,
      external_socket_budget: 0,
      raw_material_persisted: false,
    }
  }).sort((left, right) => left.required_pair.localeCompare(right.required_pair))
  const base = {
    schema_version: 'oracle-lab-phase3a-tier-a-dynamic-projection.v3',
    version: input.lane.version,
    hypothesis_id: input.lane.hypothesis_id,
    status: input.lane.status === 'REPRODUCED' && admission.status === 'PASS' && pairs.every((pair) => pair.status === 'REPRODUCED') ? 'REPRODUCED' : 'UNKNOWN',
    pair_count: input.lane.pair_count,
    pairs,
    admission,
    source_bindings: {
      campaign_summary_path: input.campaign_summary_path,
      lane_summary_path: input.lane_summary_path,
      campaign_summary_sha256: input.campaign_summary_sha256,
      lane_summary_sha256: input.lane_summary_sha256,
      binding_root: input.binding_capsules.binding_root,
      binding_capsules: [...input.binding_capsules.sources].sort((left, right) => left.path.localeCompare(right.path)),
    },
    external_socket_budget: 0,
    raw_material_persisted: false,
  }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

export function parseTierADynamicProjectionArgs(argv: string[]): Record<string, string> {
  const values = argv[0] === '--' ? argv.slice(1) : argv
  const output: Record<string, string> = {}
  const allowed = new Set(['evidence-root', 'campaign-root', 'binding-root', 'version', 'out'])
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith('--') || !values[index + 1] || values[index + 1].startsWith('--')) fail('invalid_arguments', 'arguments must be --name value pairs')
    const name = values[index].slice(2)
    if (!allowed.has(name)) fail('invalid_arguments', `unknown argument: --${name}`)
    if (output[name] !== undefined) fail('invalid_arguments', `duplicate argument: --${name}`)
    output[name] = values[index + 1]
  }
  return output
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const values = parseTierADynamicProjectionArgs(process.argv.slice(2))
    const evidenceRootInput = values['evidence-root']
    const campaignRootInput = values['campaign-root']
    const bindingRootInput = values['binding-root']
    const version = values.version
    const outInput = values.out
    if (!evidenceRootInput || !campaignRootInput || !bindingRootInput || !version || !outInput) fail('usage', 'tier-a-dynamic-projection requires evidence root, campaign root, binding root, version, and out')
    const root = ensureEvidenceRoot(evidenceRootInput)
    const campaignRoot = path.resolve(root, campaignRootInput)
    const relativeCampaign = path.relative(root, campaignRoot)
    if (relativeCampaign === '' || relativeCampaign === '..' || relativeCampaign.startsWith(`..${path.sep}`) || path.isAbsolute(relativeCampaign)) fail('tier_a_projection_path_invalid', 'campaign root must be below evidence root')
    const campaignPath = path.join(campaignRoot, 'summary.json')
    const lanePath = path.join(campaignRoot, 'lanes', version, 'summary.json')
    if (!existsSync(campaignPath) || !existsSync(lanePath)) fail('tier_a_projection_input_missing', 'campaign or lane summary is missing')
    const projection = projectTierADynamicLane({
      campaign: JSON.parse(readFileSync(campaignPath, 'utf8')) as JsonObject,
      lane: JSON.parse(readFileSync(lanePath, 'utf8')) as JsonObject,
      campaign_summary_path: evidenceRelative(root, campaignPath),
      lane_summary_path: evidenceRelative(root, lanePath),
      campaign_summary_sha256: sha256File(campaignPath),
      lane_summary_sha256: sha256File(lanePath),
      binding_capsules: loadTierACellBindingCapsules({ evidence_root: root, campaign_root: campaignRoot, binding_root: bindingRootInput, version }),
    })
    const output = assertEvidencePath(root, outInput)
    mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 })
    writeFileSync(output, `${canonicalJson(projection)}\n`, { flag: 'wx', mode: 0o600 })
    process.stdout.write(`${canonicalJson({ out: path.relative(root, output), sha256: sha256File(output), status: projection.status, pair_count: projection.pair_count, admission: projection.admission.status })}\n`)
  } catch (error) {
    process.stderr.write(`${canonicalJson(stableError(error))}\n`)
    process.exitCode = 1
  }
}
