import type { ExecutableArm, LedgerFamily, RunLedgerRow } from './ledger.js'
import { Phase3BProductionError } from './core.js'

type ConfigArm = Extract<RunLedgerRow['arm'], `control/${string}` | `treatment/${string}`>
type ConfigRoutePlan = Readonly<Record<'user' | 'project' | 'local' | 'process-env', 0 | 1 | null> & { request_route: 0 | 1; preflight_route: 0 | 1 | null }>
export type BootstrapContract = Readonly<{ expected_count: 0 | 1; expected_route_ordinal: null | 0 | 1 }>

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
  const requestRoute = scheduleId === 'config-precedence-process-env-vs-local' ? 0 : arm.startsWith('treatment/') ? 1 : 0
  return Object.freeze({ ...selected, request_route: requestRoute as 0 | 1, preflight_route: selected['process-env'] })
}

export function bootstrapContractFor(family: LedgerFamily, scheduleId: string, arm: ExecutableArm): BootstrapContract {
  if (family !== 'config') return Object.freeze({ expected_count: 1, expected_route_ordinal: 0 })
  const plan = configRoutePlanFor(scheduleId, arm as ConfigArm)
  if (plan.preflight_route !== null) return Object.freeze({ expected_count: 1, expected_route_ordinal: plan.preflight_route })
  if (plan.user === plan.request_route) return Object.freeze({ expected_count: 1, expected_route_ordinal: plan.request_route })
  return Object.freeze({ expected_count: 0, expected_route_ordinal: null })
}

export function expectedSelectedRoute(row: RunLedgerRow): 0 | 1 {
  if (row.route_count === 1 || row.family !== 'config') return 0
  return configRoutePlanFor(row.schedule_id, row.arm as ConfigArm).request_route
}

export function expectedBootstrapRoute(row: RunLedgerRow): 0 | 1 | null {
  return bootstrapContractFor(row.family, row.schedule_id, row.arm).expected_route_ordinal
}
