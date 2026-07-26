import type { RunLedgerRow } from './ledger.js'

export function expectedSelectedRoute(row: RunLedgerRow): number {
  if (row.route_count === 1 || row.family !== 'config') return 0
  if (row.schedule_id === 'config-precedence-process-env-vs-local') return 0
  return row.arm.startsWith('treatment/') ? 1 : 0
}
