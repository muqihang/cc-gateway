export type CampaignLedger = Readonly<{
  schema_id: string
  campaign_id: string
  rows: readonly Readonly<Record<string, unknown>>[]
  ledger_sha256: string
}>

export type ProductionController = Readonly<{
  campaign_id: string
}>

export type GateBResult = Readonly<{
  decision: 'PASS' | 'BLOCKED'
  phase3b_usable: boolean
}>

export function buildCampaignLedger(_campaignId: string): CampaignLedger {
  return {
    schema_id: 'oracle-lab-p3b-production-ledger.unimplemented',
    campaign_id: _campaignId,
    rows: [],
    ledger_sha256: '',
  }
}

export function createProductionController(_input: Readonly<Record<string, unknown>>): ProductionController {
  return { campaign_id: String(_input.campaign_id ?? '') }
}

export function assertProductionController(_controller: ProductionController): void {
  // RED seam: the GREEN implementation must require an internally branded authority.
}

export function evaluateProductionGateB(_input: Readonly<Record<string, unknown>>): GateBResult {
  return { decision: 'PASS', phase3b_usable: true }
}

export async function main(_argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  return 0
}
