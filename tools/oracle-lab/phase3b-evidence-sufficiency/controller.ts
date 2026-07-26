import { Phase3BProductionError, deepFreeze } from './core.js'
import { type StaticAnchor, assertStaticAnchor } from './launch-image.js'
import { buildCampaignLedger, type CampaignLedger, type CrossRepoAuthority } from './ledger.js'
import { assertPrivateRuntimeRoot } from './sealed-fs.js'

export type ProductionController = Readonly<{
  campaign_id: string
  authority_kind: 'opaque-production-controller'
}>

type ControllerState = {
  ledger: CampaignLedger
  runtimeRoot: string | null
  anchorSha256: string | null
  namespaceSealed: boolean
}

const controllers = new WeakMap<object, ControllerState>()

export function createProductionController(input: Readonly<{ campaign_id: string; c1: CrossRepoAuthority }>): ProductionController {
  const ledger = buildCampaignLedger(input.campaign_id, input.c1)
  const controller = deepFreeze({ campaign_id: ledger.campaign_id, authority_kind: 'opaque-production-controller' as const })
  controllers.set(controller, { ledger, runtimeRoot: null, anchorSha256: null, namespaceSealed: false })
  return controller
}

export function assertProductionController(controller: unknown): asserts controller is ProductionController {
  if (!controller || typeof controller !== 'object' || !controllers.has(controller as object)) throw new Phase3BProductionError('launch_authority_invalid', 'internally created opaque production controller is required')
}

export function controllerState(controller: ProductionController): Readonly<ControllerState> {
  assertProductionController(controller)
  const state = controllers.get(controller as object)!
  return deepFreeze({ ...state })
}

export function bindControllerRuntime(controller: ProductionController, runtimeRoot: string, anchor: StaticAnchor): void {
  const state = controllers.get(controller as object)
  if (!state || state.runtimeRoot !== null) throw new Phase3BProductionError('launch_authority_invalid', 'controller runtime may be bound exactly once')
  assertStaticAnchor(anchor)
  state.runtimeRoot = assertPrivateRuntimeRoot(runtimeRoot)
  state.anchorSha256 = anchor.anchor_sha256
}

export function sealControllerNamespace(controller: ProductionController): void {
  const state = controllers.get(controller as object)
  if (!state || state.runtimeRoot === null || state.anchorSha256 === null || state.namespaceSealed) throw new Phase3BProductionError('launch_authority_invalid', 'controller namespace cannot be sealed in this state')
  state.namespaceSealed = true
}
