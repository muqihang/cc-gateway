import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'

type JsonObject = Record<string, unknown>
type Arm = 'control' | 'treatment'

const SHA256 = /^[a-f0-9]{64}$/
const VERSION = /^\d+\.\d+\.\d+$/
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,191}$/

function fail(code: string, message: string): never { throw new Phase3AError(code, message) }

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function object(value: unknown, label: string): JsonObject {
  if (!isObject(value)) fail('tier_a_binding_invalid_source', `${label} must be an object`)
  return value
}

function string(value: unknown, label: string, pattern = SAFE_ID): string {
  if (typeof value !== 'string' || !pattern.test(value)) fail('tier_a_binding_invalid_source', `${label} is invalid`)
  return value
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) fail('tier_a_binding_invalid_source', `${label} must be a SHA-256 digest`)
  return value
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) fail('tier_a_binding_invalid_source', `${label} must be a non-negative integer`)
  return value as number
}

function requireSafety(value: JsonObject, label: string): void {
  if (value.external_socket_budget !== 0 || value.raw_material_persisted !== false) {
    fail('tier_a_binding_unsafe_source', `${label} must have no external sockets and no persisted raw material`)
  }
}

function isBelow(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function existingDirectory(root: string, input: string, label: string): string {
  const candidate = path.resolve(root, input)
  if (!existsSync(candidate)) fail('tier_a_binding_path_invalid', `${label} must be an existing directory below the evidence root`)
  const stat = lstatSync(candidate)
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('tier_a_binding_path_invalid', `${label} must be a real directory`)
  const resolved = realpathSync(candidate)
  if (!isBelow(root, resolved) && resolved !== root) fail('tier_a_binding_path_invalid', `${label} resolves outside the evidence root`)
  return resolved
}

function regularFile(file: string, label: string): string {
  if (!existsSync(file)) fail('tier_a_binding_input_missing', `${label} is missing`)
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) fail('tier_a_binding_path_invalid', `${label} must be a regular file`)
  return file
}

function readObject(file: string, label: string): JsonObject {
  regularFile(file, label)
  try {
    return object(JSON.parse(readFileSync(file, 'utf8')) as unknown, label)
  } catch (error) {
    if (error instanceof Phase3AError) throw error
    fail('tier_a_binding_invalid_json', `${label} is not valid JSON`)
  }
}

function directories(root: string, label: string): string[] {
  const directory = existingDirectory(root, root, label)
  return readdirSync(directory, { withFileTypes: true }).map((entry) => {
    const full = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) fail('tier_a_binding_path_invalid', `${label} contains a symlink`)
    return entry.isDirectory() ? full : null
  }).filter((entry): entry is string => entry !== null)
}

function exactlyOne<T>(values: T[], code: string, message: string): T {
  if (values.length !== 1) fail(code, message)
  return values[0]
}

function validateCampaign(campaign: JsonObject): { campaign_id: string; active_version: string; lanes: JsonObject[] } {
  if (campaign.schema_version !== 'oracle-lab-phase3a-tier-a-dynamic-campaign.v1') fail('tier_a_binding_campaign_invalid', 'campaign schema is invalid')
  requireSafety(campaign, 'campaign')
  const campaignId = string(campaign.campaign_id, 'campaign ID')
  const activeVersion = string(campaign.active_version, 'campaign active version', VERSION)
  if (!Array.isArray(campaign.lanes)) fail('tier_a_binding_campaign_invalid', 'campaign lanes are missing')
  return { campaign_id: campaignId, active_version: activeVersion, lanes: campaign.lanes.map((lane, index) => object(lane, `campaign lane ${index}`)) }
}

function validateLane(lane: JsonObject, version: string): { version: string; hypothesis_id: string; required_pairs: string[]; pair_count: number; active: JsonObject; control: JsonObject; pairs: JsonObject[] } {
  if (lane.schema_version !== 'oracle-lab-phase3a-tier-a-lane-summary.v1' || lane.role !== 'tier-a') fail('tier_a_binding_lane_invalid', 'lane schema or role is invalid')
  requireSafety(lane, 'lane')
  const laneVersion = string(lane.version, 'lane version', VERSION)
  if (laneVersion !== version) fail('cross_lane_reference', 'lane version does not match the requested version')
  const hypothesisId = string(lane.hypothesis_id, 'lane hypothesis ID')
  if (!Array.isArray(lane.required_pairs) || !Array.isArray(lane.pairs)) fail('tier_a_binding_lane_invalid', 'lane pair data is missing')
  const requiredPairs = lane.required_pairs.map((pair, index) => string(pair, `lane required pair ${index}`))
  if (new Set(requiredPairs).size !== requiredPairs.length) fail('tier_a_binding_lane_invalid', 'lane required pairs are duplicated')
  const pairCount = nonNegativeInteger(lane.pair_count, 'lane pair count')
  if (pairCount !== requiredPairs.length) fail('tier_a_binding_lane_invalid', 'lane pair count does not match required pairs')
  return {
    version: laneVersion,
    hypothesis_id: hypothesisId,
    required_pairs: requiredPairs,
    pair_count: pairCount,
    active: object(lane.active, 'lane active artifact'),
    control: object(lane.control, 'lane control artifact'),
    pairs: lane.pairs.map((pair, index) => object(pair, `lane pair ${index}`)),
  }
}

function validateArtifact(value: JsonObject, version: string, label: string): { archive_sha256: string; tree_sha256: string; entrypoint_sha256: string } {
  if (string(value.version, `${label} version`, VERSION) !== version) fail('cross_lane_reference', `${label} version does not match its lane`)
  return {
    archive_sha256: digest(value.archive_sha256, `${label} archive digest`),
    tree_sha256: digest(value.tree_sha256, `${label} tree digest`),
    entrypoint_sha256: digest(value.entrypoint_sha256, `${label} entrypoint digest`),
  }
}

function findLane(campaignRoot: string, campaign: ReturnType<typeof validateCampaign>, version: string): { root: string; value: JsonObject; lane: ReturnType<typeof validateLane> } {
  const laneRoot = path.join(campaignRoot, 'lanes')
  const candidates = directories(laneRoot, 'campaign lanes').map((directory) => {
    const value = readObject(path.join(directory, 'summary.json'), 'lane summary')
    return value.version === version ? { root: directory, value, lane: validateLane(value, version) } : null
  }).filter((candidate): candidate is { root: string; value: JsonObject; lane: ReturnType<typeof validateLane> } => candidate !== null)
  const selected = exactlyOne(candidates, 'tier_a_binding_lane_missing', `expected one lane summary for ${version}`)
  const campaignLanes = campaign.lanes.filter((lane) => lane.version === selected.lane.version)
  const campaignLane = exactlyOne(campaignLanes, 'cross_lane_reference', `campaign has an ambiguous lane reference for ${version}`)
  if (string(campaignLane.hypothesis_id, 'campaign lane hypothesis ID') !== selected.lane.hypothesis_id || nonNegativeInteger(campaignLane.pair_count, 'campaign lane pair count') !== selected.lane.pair_count) {
    fail('cross_lane_reference', 'campaign lane reference does not match lane summary content')
  }
  return selected
}

function validatePair(value: JsonObject, lane: ReturnType<typeof validateLane>, requiredPair: string): { pair_id: string; required_pair: string; runs: JsonObject[] } {
  if (value.schema_version !== 'oracle-lab-phase3a-tier-a-pair-summary.v1') fail('tier_a_binding_pair_invalid', 'pair schema is invalid')
  requireSafety(value, 'pair')
  if (string(value.version, 'pair version', VERSION) !== lane.version || string(value.hypothesis_id, 'pair hypothesis ID') !== lane.hypothesis_id) {
    fail('cross_lane_reference', 'pair references a different lane')
  }
  if (string(value.required_pair, 'pair required pair') !== requiredPair) fail('tier_a_binding_pair_invalid', 'pair does not match the requested pair')
  if (!lane.required_pairs.includes(requiredPair)) fail('cross_lane_reference', 'pair is not required by the selected lane')
  if (!Array.isArray(value.runs)) fail('tier_a_binding_pair_invalid', 'pair runs are missing')
  return { pair_id: string(value.pair_id, 'pair ID'), required_pair: string(value.required_pair, 'pair required_pair'), runs: value.runs.map((run, index) => object(run, `pair run ${index}`)) }
}

function findPair(laneRoot: string, lane: ReturnType<typeof validateLane>, requiredPair: string): { root: string; value: JsonObject; pair: ReturnType<typeof validatePair> } {
  const pairsRoot = path.join(laneRoot, 'pairs')
  const candidates = directories(pairsRoot, 'lane pairs').map((directory) => {
    const value = readObject(path.join(directory, 'summary.json'), 'pair summary')
    return value.required_pair === requiredPair ? { root: directory, value, pair: validatePair(value, lane, requiredPair) } : null
  }).filter((candidate): candidate is { root: string; value: JsonObject; pair: ReturnType<typeof validatePair> } => candidate !== null)
  const selected = exactlyOne(candidates, 'tier_a_binding_pair_missing', `expected one pair summary for ${requiredPair}`)
  const lanePair = exactlyOne(lane.pairs.filter((pair) => pair.required_pair === requiredPair), 'cross_lane_reference', 'lane has an ambiguous pair reference')
  if (canonicalJson(lanePair) !== canonicalJson(selected.value)) fail('cross_lane_reference', 'lane pair reference does not match pair summary content')
  return selected
}

function selectRun(pair: ReturnType<typeof validatePair>, arm: Arm, repetition: number, expectedVersion: string): { run_id: string; arm: Arm; repetition: number; version: string; status: string; entrypoint_sha256: string } {
  const identifiers = new Set<string>()
  const cells: Array<{ run_id: string; arm: Arm; repetition: number; version: string; status: string; entrypoint_sha256: string }> = []
  for (const row of pair.runs) {
    const runId = string(row.run_id, 'pair run ID')
    const rowArm = row.arm === 'control' || row.arm === 'treatment' ? row.arm : fail('tier_a_binding_pair_invalid', 'pair run arm is invalid')
    const rowRepetition = nonNegativeInteger(row.repetition, 'pair run repetition')
    const key = `${rowArm}:${rowRepetition}`
    if (identifiers.has(runId) || cells.some((cell) => `${cell.arm}:${cell.repetition}` === key)) fail('tier_a_binding_duplicate_run', 'pair summary has duplicate runs')
    identifiers.add(runId)
    cells.push({ run_id: runId, arm: rowArm, repetition: rowRepetition, version: string(row.version, 'pair run version', VERSION), status: string(row.status, 'pair run status'), entrypoint_sha256: digest(row.entrypoint_sha256, 'pair run entrypoint digest') })
  }
  const matches = cells.filter((cell) => cell.arm === arm && cell.repetition === repetition)
  if (matches.length === 0) fail('tier_a_binding_missing_arm', `pair is missing ${arm} at repetition ${repetition}`)
  const run = exactlyOne(matches, 'tier_a_binding_duplicate_run', 'pair has duplicate cells for the requested arm and repetition')
  if (run.version !== expectedVersion) fail('tier_a_binding_version_entrypoint_mismatch', 'pair run version does not match the selected arm')
  return run
}

function cellDirectories(root: string): string[] {
  const output: string[] = []
  const walk = (directory: string): void => {
    for (const child of directories(directory, 'pair cell tree')) {
      output.push(child)
      walk(child)
    }
  }
  walk(root)
  return output
}

function findCell(pairRoot: string, runId: string): string {
  const candidates = cellDirectories(pairRoot).filter((directory) => {
    const manifestPath = path.join(directory, 'manifest.json')
    if (!existsSync(manifestPath)) return false
    return readObject(manifestPath, 'cell manifest').run_id === runId
  })
  return exactlyOne(candidates, 'tier_a_binding_duplicate_run', `expected one raw cell for ${runId}`)
}

function loadIntakeArtifact(evidenceRoot: string, version: string): { artifact_id: string; archive_sha256: string; tree_sha256: string; entrypoint_sha256: string } {
  const platformRoot = path.join(evidenceRoot, 'intake', 'platform')
  const candidates = directories(platformRoot, 'platform intake').map((directory) => {
    const value = readObject(path.join(directory, 'artifact.json'), 'platform artifact')
    return { directory, value, version: string(value.version, 'platform artifact version', VERSION) }
  }).filter((candidate) => candidate.version === version)
  const selected = exactlyOne(candidates, 'tier_a_binding_intake_missing', `expected one platform artifact for ${version}`)
  const artifact = {
    artifact_id: string(selected.value.artifact_id, 'platform artifact ID'),
    archive_sha256: digest(selected.value.archive_sha256, 'platform archive digest'),
    tree_sha256: digest(selected.value.tree_sha256, 'platform tree digest'),
    entrypoint_sha256: digest(selected.value.entrypoint_sha256, 'platform entrypoint digest'),
  }
  if (sha256File(regularFile(path.join(selected.directory, 'archive.tgz'), 'platform archive')) !== artifact.archive_sha256) {
    fail('tier_a_binding_archive_digest_drift', 'platform archive digest drifted from its intake record')
  }
  return artifact
}

function equalDigest(actual: string, expected: unknown, label: string): void {
  if (digest(expected, label) !== actual) fail('tier_a_binding_raw_digest_drift', `${label} does not match file content`)
}

function bindCell(input: {
  evidenceRoot: string
  campaignRoot: string
  version: string
  pair: string
  repetition: number
  arm: Arm
}): JsonObject {
  const evidenceRoot = ensureEvidenceRoot(input.evidenceRoot)
  const campaignRoot = existingDirectory(evidenceRoot, input.campaignRoot, 'campaign root')
  if (!isBelow(evidenceRoot, realpathSync(campaignRoot))) fail('tier_a_binding_path_invalid', 'campaign root must be below the evidence root')
  const requestedVersion = string(input.version, 'requested version', VERSION)
  const requestedPair = string(input.pair, 'requested pair')
  const requestedRepetition = nonNegativeInteger(input.repetition, 'requested repetition')
  if (input.arm !== 'control' && input.arm !== 'treatment') fail('invalid_arguments', 'arm must be control or treatment')
  const campaign = validateCampaign(readObject(path.join(campaignRoot, 'summary.json'), 'campaign summary'))
  const selectedLane = findLane(campaignRoot, campaign, requestedVersion)
  const expectedVersion = input.arm === 'control' ? selectedLane.lane.version : campaign.active_version
  const selectedPair = findPair(selectedLane.root, selectedLane.lane, requestedPair)
  const run = selectRun(selectedPair.pair, input.arm, requestedRepetition, expectedVersion)
  const cellRoot = findCell(selectedPair.root, run.run_id)
  const manifestPath = regularFile(path.join(cellRoot, 'manifest.json'), 'cell manifest')
  const observerPath = regularFile(path.join(cellRoot, 'observer.json'), 'cell observer')
  const resultPath = regularFile(path.join(cellRoot, 'result.json'), 'cell result')
  const guardPath = regularFile(path.join(cellRoot, 'guard.json'), 'cell guard')
  const summary = readObject(path.join(cellRoot, 'summary.json'), 'cell summary')
  const manifest = readObject(manifestPath, 'cell manifest')
  const observer = readObject(observerPath, 'cell observer')
  const result = readObject(resultPath, 'cell result')

  if (summary.schema_version !== 'oracle-lab-phase3a-tier-a-cell-summary.v1') fail('tier_a_binding_cell_invalid', 'cell summary schema is invalid')
  requireSafety(summary, 'cell summary')
  if (string(summary.run_id, 'cell summary run ID') !== run.run_id || summary.arm !== input.arm || string(summary.version, 'cell summary version', VERSION) !== expectedVersion) {
    fail('cross_lane_reference', 'cell summary does not match the selected run')
  }
  equalDigest(sha256File(manifestPath), summary.manifest_sha256, 'cell summary manifest digest')
  equalDigest(sha256File(observerPath), summary.observer_sha256, 'cell summary observer digest')
  equalDigest(sha256File(resultPath), summary.result_sha256, 'cell summary result digest')
  equalDigest(sha256File(guardPath), summary.guard_sha256, 'cell summary guard digest')

  if (manifest.schema_version !== 'oracle-lab-phase3a-launch-manifest.v1' || string(manifest.run_id, 'manifest run ID') !== run.run_id || string(manifest.pair_id, 'manifest pair ID') !== selectedPair.pair.pair_id || string(manifest.hypothesis_id, 'manifest hypothesis ID') !== `${selectedLane.lane.hypothesis_id}:${selectedPair.pair.required_pair}`) {
    fail('cross_lane_reference', 'manifest does not reference the selected campaign lane and pair')
  }
  const manifestArtifact = object(manifest.artifact, 'manifest artifact')
  const manifestVersion = string(manifestArtifact.version, 'manifest artifact version', VERSION)
  const manifestArchive = digest(manifestArtifact.archive_sha256, 'manifest archive digest')
  const manifestTree = digest(manifestArtifact.tree_sha256, 'manifest tree digest')
  const manifestEntrypoint = digest(manifestArtifact.entrypoint_sha256, 'manifest entrypoint digest')
  const command = object(manifest.command, 'manifest command')
  if (manifestVersion !== expectedVersion || digest(command.executable_sha256, 'manifest command executable digest') !== manifestEntrypoint || run.entrypoint_sha256 !== manifestEntrypoint) {
    fail('tier_a_binding_version_entrypoint_mismatch', 'manifest version and entrypoint are not bound to the selected arm')
  }
  const laneArtifact = validateArtifact(input.arm === 'control' ? selectedLane.lane.control : selectedLane.lane.active, expectedVersion, `${input.arm} lane artifact`)
  const intakeArtifact = loadIntakeArtifact(evidenceRoot, expectedVersion)
  for (const [label, value, expected] of [
    ['archive', manifestArchive, laneArtifact.archive_sha256], ['tree', manifestTree, laneArtifact.tree_sha256], ['entrypoint', manifestEntrypoint, laneArtifact.entrypoint_sha256],
    ['intake archive', manifestArchive, intakeArtifact.archive_sha256], ['intake tree', manifestTree, intakeArtifact.tree_sha256], ['intake entrypoint', manifestEntrypoint, intakeArtifact.entrypoint_sha256],
  ] as const) {
    if (value !== expected) fail('tier_a_binding_version_entrypoint_mismatch', `${label} digest does not match its versioned artifact`)
  }
  if (observer.schema_version !== 'oracle-lab-phase3a-safe-observer.v1' || observer.raw_material_persisted !== false || string(result.status, 'result status') !== run.status || string(summary.status, 'cell summary status') !== run.status) {
    fail('tier_a_binding_cell_invalid', 'raw cell files do not match the pair run record')
  }

  const base = {
    schema_version: 'oracle-lab-phase3a-tier-a-cell-binding-capsule.v1',
    lane: 'tier-a',
    version: selectedLane.lane.version,
    hypothesis_id: selectedLane.lane.hypothesis_id,
    pair_id: selectedPair.pair.pair_id,
    required_pair: requestedPair,
    repetition: requestedRepetition,
    arm: input.arm,
    raw_manifest_sha256: sha256File(manifestPath),
    raw_result_sha256: sha256File(resultPath),
    raw_observer_sha256: sha256File(observerPath),
    archive_sha256: manifestArchive,
    tree_sha256: manifestTree,
    entrypoint_sha256: manifestEntrypoint,
    command_sha256: sha256Bytes(canonicalJson(command)),
    parent_artifact_ids: [campaign.campaign_id, selectedPair.pair.pair_id, run.run_id, intakeArtifact.artifact_id],
    external_socket_budget: 0,
    raw_material_persisted: false,
  }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

export function buildTierACellBindingCapsule(input: {
  evidence_root: string
  campaign_root: string
  version: string
  pair: string
  repetition: number
  arm: Arm
}): JsonObject {
  return bindCell({
    evidenceRoot: input.evidence_root,
    campaignRoot: input.campaign_root,
    version: input.version,
    pair: input.pair,
    repetition: input.repetition,
    arm: input.arm,
  })
}

export function writeTierACellBindingCapsule(input: Parameters<typeof buildTierACellBindingCapsule>[0] & { out: string }): { out: string; sha256: string; capsule: JsonObject } {
  const evidenceRoot = ensureEvidenceRoot(input.evidence_root)
  const output = assertEvidencePath(evidenceRoot, path.resolve(evidenceRoot, input.out))
  if (existsSync(output)) fail('evidence_exists', 'binding capsule output already exists')
  const capsule = buildTierACellBindingCapsule(input)
  mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 })
  writeFileSync(output, `${canonicalJson(capsule)}\n`, { flag: 'wx', mode: 0o600 })
  return { out: path.relative(evidenceRoot, output).split(path.sep).join('/'), sha256: sha256File(output), capsule }
}

export function parseTierACellBindingArgs(argv: string[]): Record<string, string> {
  const values = argv[0] === '--' ? argv.slice(1) : argv
  const output: Record<string, string> = {}
  const allowed = new Set(['evidence-root', 'campaign-root', 'version', 'pair', 'repetition', 'arm', 'out'])
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
    const values = parseTierACellBindingArgs(process.argv.slice(2))
    for (const key of ['evidence-root', 'campaign-root', 'version', 'pair', 'repetition', 'arm', 'out']) {
      if (!values[key]) fail('invalid_arguments', `--${key} is required`)
    }
    if (!/^\d+$/.test(values.repetition)) fail('invalid_arguments', '--repetition must be a non-negative integer')
    if (values.arm !== 'control' && values.arm !== 'treatment') fail('invalid_arguments', '--arm must be control or treatment')
    const result = writeTierACellBindingCapsule({
      evidence_root: values['evidence-root'], campaign_root: values['campaign-root'], version: values.version, pair: values.pair,
      repetition: Number(values.repetition), arm: values.arm, out: values.out,
    })
    process.stdout.write(`${canonicalJson({ out: result.out, sha256: result.sha256, deterministic_digest: result.capsule.deterministic_digest })}\n`)
  } catch (error) {
    process.stderr.write(`${canonicalJson(stableError(error))}\n`)
    process.exitCode = 1
  }
}
