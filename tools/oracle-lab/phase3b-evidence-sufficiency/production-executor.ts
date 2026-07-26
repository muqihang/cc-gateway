import { pathToFileURL } from 'node:url'

import { Phase3BProductionError } from './core.js'
import { main as campaignMain } from './campaign.js'
import { evaluateGateB } from './gates.js'

export { buildCampaignLedger, type CampaignLedger } from './ledger.js'
export { assertProductionController, createProductionController, type ProductionController } from './controller.js'

export type GateBResult = Readonly<{
  decision: 'PASS' | 'BLOCKED'
  phase3b_usable: boolean
}>

export function evaluateProductionGateB(_input: Readonly<Record<string, unknown>>): GateBResult {
  if (typeof _input.evidence_root !== 'string' || Object.keys(_input).length !== 1) throw new Phase3BProductionError('gate_input_invalid', 'Gate B accepts only one sealed evidence root')
  return evaluateGateB(_input.evidence_root) as GateBResult
}

export async function main(_argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  return campaignMain(_argv)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Phase3BProductionError ? error.code : 'phase3b_production_failed'}\n`)
    process.exitCode = 1
  })
}
