import type { ExecutableArm, LedgerFamily, RunLedgerRow } from './ledger.js'
import { Phase3BProductionError } from './core.js'

type ConfigArm = Extract<RunLedgerRow['arm'], `control/${string}` | `treatment/${string}`>
export type ConfigSource = 'user' | 'project' | 'local' | 'process-env'
type ConfigWinnerSource = Exclude<ConfigSource, 'process-env'>
type ConfigRoutePlan = Readonly<Record<ConfigSource, 0 | 1 | null> & { request_route: 0 | 1; preflight_route: 0 | 1 | null }>
export type BootstrapContract = Readonly<{
  winner_source: ConfigWinnerSource | 'direct'
  selected_route_ordinal: 0 | 1
  bootstrap_source: ConfigSource | 'direct' | null
  expected_count: 0 | 1
  expected_route_ordinal: null | 0 | 1
}>

const CONFIG_VALUES: Readonly<Record<string, Readonly<{ control: Readonly<Record<'user' | 'project' | 'local' | 'process-env', 0 | 1 | null>>; treatment: Readonly<Record<'user' | 'project' | 'local' | 'process-env', 0 | 1 | null>> }>>> = {
  'config-precedence-user-vs-default': { control: { user: 0, project: null, local: null, 'process-env': null }, treatment: { user: 1, project: null, local: null, 'process-env': null } },
  'config-precedence-project-vs-user': { control: { user: 0, project: null, local: null, 'process-env': null }, treatment: { user: 0, project: 1, local: null, 'process-env': null } },
  'config-precedence-local-vs-project': { control: { user: null, project: 0, local: null, 'process-env': null }, treatment: { user: null, project: 0, local: 1, 'process-env': null } },
  'config-precedence-process-env-vs-local': { control: { user: null, project: null, local: 0, 'process-env': null }, treatment: { user: null, project: null, local: 0, 'process-env': 1 } },
}

export function configRoutePlanFor(scheduleId: string, arm: ConfigArm): ConfigRoutePlan {
  const definition = CONFIG_VALUES[scheduleId]
  if (!definition) throw new Phase3BProductionError('scenario_input_invalid', 'config route plan is not frozen')
  const selected = arm.startsWith('treatment/') ? definition.treatment : definition.control
  const winnerSource = (['local', 'user', 'project'] as const).find((source) => selected[source] !== null)
  if (!winnerSource) throw new Phase3BProductionError('scenario_input_invalid', 'config route plan has no staged request source')
  const requestRoute = selected[winnerSource]
  if (requestRoute === null) throw new Phase3BProductionError('scenario_input_invalid', 'winning config source has no route')
  return Object.freeze({ ...selected, request_route: requestRoute as 0 | 1, preflight_route: selected['process-env'] })
}

export function bootstrapContractFor(family: LedgerFamily, scheduleId: string, arm: ExecutableArm): BootstrapContract {
  if (family !== 'config') return Object.freeze({ winner_source: 'direct', selected_route_ordinal: 0, bootstrap_source: 'direct', expected_count: 1, expected_route_ordinal: 0 })
  const plan = configRoutePlanFor(scheduleId, arm as ConfigArm)
  const winnerSource = (['local', 'user', 'project'] as const).find((source) => plan[source] !== null)
  if (!winnerSource) throw new Phase3BProductionError('scenario_input_invalid', 'winning config source could not be derived')
  if (plan.preflight_route !== null) return Object.freeze({ winner_source: winnerSource, selected_route_ordinal: plan.request_route, bootstrap_source: 'process-env', expected_count: 1, expected_route_ordinal: plan.preflight_route })
  if (winnerSource === 'user') return Object.freeze({ winner_source: winnerSource, selected_route_ordinal: plan.request_route, bootstrap_source: 'user', expected_count: 1, expected_route_ordinal: plan.request_route })
  return Object.freeze({ winner_source: winnerSource, selected_route_ordinal: plan.request_route, bootstrap_source: null, expected_count: 0, expected_route_ordinal: null })
}

export function expectedSelectedRoute(row: RunLedgerRow): 0 | 1 {
  if (row.route_count === 1 || row.family !== 'config') return 0
  return bootstrapContractFor(row.family, row.schedule_id, row.arm).selected_route_ordinal
}

export function expectedBootstrapRoute(row: RunLedgerRow): 0 | 1 | null {
  return bootstrapContractFor(row.family, row.schedule_id, row.arm).expected_route_ordinal
}
