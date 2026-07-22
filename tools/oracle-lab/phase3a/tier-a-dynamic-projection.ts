import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'

type JsonObject = Record<string, any>

function fail(code: string, message: string): never { throw new Phase3AError(code, message) }

export function projectTierADynamicLane(input: {
  campaign: JsonObject
  lane: JsonObject
  campaign_summary_path: string
  lane_summary_path: string
  campaign_summary_sha256: string
  lane_summary_sha256: string
}): JsonObject {
  if (input.campaign.schema_version !== 'oracle-lab-phase3a-tier-a-dynamic-campaign.v1' || input.campaign.external_socket_budget !== 0 || input.campaign.raw_material_persisted !== false) {
    fail('tier_a_projection_campaign_invalid', 'campaign safety binding is invalid')
  }
  if (input.lane.schema_version !== 'oracle-lab-phase3a-tier-a-lane-summary.v1' || !['REPRODUCED', 'UNKNOWN'].includes(input.lane.status) || input.lane.external_socket_budget !== 0 || input.lane.raw_material_persisted !== false || !Array.isArray(input.lane.pairs)) {
    fail('tier_a_projection_lane_invalid', 'lane safety binding is invalid')
  }
  for (const digest of [input.campaign_summary_sha256, input.lane_summary_sha256]) if (!/^[a-f0-9]{64}$/.test(digest)) fail('tier_a_projection_digest_invalid', 'source digest must be SHA-256')
  for (const sourcePath of [input.campaign_summary_path, input.lane_summary_path]) if (!/^capsules\/P3A-3\/[A-Za-z0-9._/-]+\/summary\.json$/.test(sourcePath) || sourcePath.includes('..')) fail('tier_a_projection_path_invalid', 'source path must be an evidence-relative summary path')
  const pairs = input.lane.pairs.map((pair: JsonObject) => {
    if (typeof pair.required_pair !== 'string' || !['REPRODUCED', 'UNKNOWN'].includes(pair.status) || !Number.isInteger(pair.terminal_cells) || !Number.isInteger(pair.dual_source_cells) || !Number.isInteger(pair.protocol_cells) || pair.external_socket_budget !== 0 || pair.raw_material_persisted !== false) {
      fail('tier_a_projection_pair_invalid', 'lane pair is incomplete')
    }
    const boundRuns = Array.isArray(pair.runs) && pair.runs.length > 0 && pair.runs.every((run: JsonObject) => run.status === 'complete' && [run.manifest_sha256, run.guard_sha256, run.observer_sha256, run.result_sha256].every((value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)))
    const reproduced = pair.status === 'REPRODUCED' && boundRuns && pair.terminal_cells === pair.runs.length && pair.dual_source_cells === pair.runs.length && pair.protocol_cells === pair.runs.length
    return {
      required_pair: pair.required_pair,
      status: reproduced ? 'REPRODUCED' : 'UNKNOWN',
      terminal_cells: pair.terminal_cells,
      dual_source_cells: pair.dual_source_cells,
      protocol_cells: pair.protocol_cells,
      external_socket_budget: pair.external_socket_budget,
      raw_material_persisted: pair.raw_material_persisted,
    }
  }).sort((left: JsonObject, right: JsonObject) => String(left.required_pair).localeCompare(String(right.required_pair)))
  const base = {
    schema_version: 'oracle-lab-phase3a-tier-a-dynamic-projection.v2',
    version: input.lane.version,
    hypothesis_id: input.lane.hypothesis_id,
    status: input.lane.status === 'REPRODUCED' && pairs.every((pair) => pair.status === 'REPRODUCED') ? 'REPRODUCED' : 'UNKNOWN',
    pair_count: input.lane.pair_count,
    pairs,
    source_bindings: {
      campaign_summary_path: input.campaign_summary_path,
      lane_summary_path: input.lane_summary_path,
      campaign_summary_sha256: input.campaign_summary_sha256,
      lane_summary_sha256: input.lane_summary_sha256,
    },
    external_socket_budget: 0,
    raw_material_persisted: false,
  }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

export function parseTierADynamicProjectionArgs(argv: string[]): Record<string, string> {
  const values = argv[0] === '--' ? argv.slice(1) : argv
  const output: Record<string, string> = {}
  const allowed = new Set(['evidence-root', 'campaign-root', 'version', 'out'])
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
    const version = values.version
    const outInput = values.out
    if (!evidenceRootInput || !campaignRootInput || !version || !outInput) fail('usage', 'tier-a-dynamic-projection requires evidence root, campaign root, version, and out')
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
      campaign_summary_path: path.relative(root, campaignPath).split(path.sep).join('/'),
      lane_summary_path: path.relative(root, lanePath).split(path.sep).join('/'),
      campaign_summary_sha256: sha256File(campaignPath),
      lane_summary_sha256: sha256File(lanePath),
    })
    const output = assertEvidencePath(root, outInput)
    mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 })
    writeFileSync(output, `${canonicalJson(projection)}\n`, { flag: 'wx', mode: 0o600 })
    process.stdout.write(`${canonicalJson({ out: path.relative(root, output), sha256: sha256File(output), status: projection.status, pair_count: projection.pair_count })}\n`)
  } catch (error) {
    process.stderr.write(`${canonicalJson(stableError(error))}\n`)
    process.exitCode = 1
  }
}
