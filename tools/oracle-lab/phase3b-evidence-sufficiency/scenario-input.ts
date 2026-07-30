import path from 'node:path'

import { type ProductionController, assertProductionController, controllerState } from './controller.js'
import { Phase3BProductionError, deepFreeze, sha256Bytes, sha256Canonical } from './core.js'
import { FIXED_STDIN_LITERAL, FIXED_LITERAL_TABLE_SHA256, type CampaignLedger, type RunLedgerRow, validateCampaignLedger } from './ledger.js'
import type { ReceiverTargetBootstrap } from './receiver.js'
import { configRoutePlanFor } from './route-policy.js'
import { createPrivateDirectory, stableRead, writeExclusiveCanonical } from './sealed-fs.js'
import { buildSandboxProfile } from './sandbox-policy.js'

export type PreparedCell = Readonly<{
  schema_id: 'oracle-lab-p3b-prepared-cell.v1'
  campaign_id: string
  ledger_sha256: string
  run_id: string
  sequence_index: number
  cwd: string
  argv: readonly string[]
  environment_sha256: string
  sandbox_profile_sha256: string
  input_descriptor_sha256: string
}>

type PreparedState = {
  row: RunLedgerRow
  env: NodeJS.ProcessEnv
  stdin: Buffer
  cwd: string
  runtimeRoot: string
  profile: string
  routePorts: number[]
}

const preparedCells = new WeakMap<object, PreparedState>()

export function configRoutePlan(row: RunLedgerRow): Readonly<{ user: 0 | 1 | null; project: 0 | 1 | null; local: 0 | 1 | null; 'process-env': 0 | 1 | null; request_route: 0 | 1; preflight_route: 0 | 1 | null }> {
  if (row.family !== 'config') throw new Phase3BProductionError('scenario_input_invalid', 'config schedule is not frozen')
  try { return deepFreeze(configRoutePlanFor(row.schedule_id, row.arm as Extract<RunLedgerRow['arm'], `control/${string}` | `treatment/${string}`>)) } catch { throw new Phase3BProductionError('scenario_input_invalid', 'config schedule is not frozen') }
}

export function materializeRouteDispatch(row: RunLedgerRow, routeUrls: readonly string[]): Readonly<{ request_route: 0 | 1; preflight_route: 0 | 1 | null; actual_route: 0 | 1; selected_url: string }> {
  if (routeUrls.length !== 2 || routeUrls.some((value) => !/^http:\/\/127\.0\.0\.1:\d+$/.test(value))) throw new Phase3BProductionError('scenario_input_invalid', 'synthetic route dispatch requires the exact two loopback URLs')
  const plan = configRoutePlan(row)
  const sourceRoute = plan['process-env'] ?? plan.request_route
  const plannedUrl = routeUrls[sourceRoute]
  const selectedUrl = plan['process-env'] !== null && process.env.ANTHROPIC_BASE_URL !== undefined
    ? process.env.ANTHROPIC_BASE_URL
    : plannedUrl
  if (!routeUrls.includes(selectedUrl)) throw new Phase3BProductionError('scenario_input_invalid', 'process environment selected a URL outside the sealed route set')
  const actualRoute = routeUrls.indexOf(selectedUrl)
  if (actualRoute !== 0 && actualRoute !== 1) throw new Phase3BProductionError('scenario_input_invalid', 'materialized route URL is not in the sealed route set')
  return deepFreeze({ request_route: plan.request_route, preflight_route: plan.preflight_route, actual_route: actualRoute as 0 | 1, selected_url: selectedUrl })
}

const AUTH_VALUES: Readonly<Record<string, Readonly<{ control: Readonly<Record<string, string>>; treatment: Readonly<Record<string, string>> }>>> = {
  'auth-api-key-rotation': { control: { ANTHROPIC_API_KEY: 'oracle-phase3b-placeholder:auth-api-key-a' }, treatment: { ANTHROPIC_API_KEY: 'oracle-phase3b-placeholder:auth-api-key-b' } },
  'auth-token-rotation': { control: { ANTHROPIC_AUTH_TOKEN: 'oracle-phase3b-placeholder:auth-token-a' }, treatment: { ANTHROPIC_AUTH_TOKEN: 'oracle-phase3b-placeholder:auth-token-b' } },
  'auth-credential-coexistence': { control: { ANTHROPIC_API_KEY: 'oracle-phase3b-placeholder:auth-api-key-a', ANTHROPIC_AUTH_TOKEN: 'oracle-phase3b-placeholder:auth-token-a' }, treatment: { ANTHROPIC_API_KEY: 'oracle-phase3b-placeholder:auth-api-key-b', ANTHROPIC_AUTH_TOKEN: 'oracle-phase3b-placeholder:auth-token-b' } },
  'auth-missing-credential': { control: { ANTHROPIC_API_KEY: 'oracle-phase3b-placeholder:auth-api-key-a' }, treatment: {} },
}
const AUTH_ENV_FIELD_IDS = new Map([['ANTHROPIC_API_KEY', 'env_00'], ['ANTHROPIC_AUTH_TOKEN', 'env_01']])

const AUTH_MARKERS = new Map<string, string>([
  ['oracle-phase3b-placeholder:auth-api-key-a', 'api-key-a'],
  ['oracle-phase3b-placeholder:auth-api-key-b', 'api-key-b'],
  ['oracle-phase3b-placeholder:auth-token-a', 'auth-token-a'],
  ['oracle-phase3b-placeholder:auth-token-b', 'auth-token-b'],
  ['oracle-phase3b-placeholder:config-precedence', 'campaign-config-placeholder'],
  ['oracle-phase3b-placeholder:campaign', 'campaign-placeholder'],
])

export function classifySyntheticAuthHeader(name: string, value: string): string | null {
  const lowerName = name.toLowerCase()
  const candidate = lowerName === 'authorization' && value.startsWith('Bearer ') ? value.slice(7) : value
  const marker = AUTH_MARKERS.get(candidate)
  if (!marker) return null
  if (lowerName === 'x-api-key' && (marker.startsWith('api-key-') || marker.startsWith('campaign-'))) return marker
  if (lowerName === 'authorization' && marker.startsWith('auth-token-')) return marker
  return null
}

export function expectedAuthMarkerClass(row: RunLedgerRow): string {
  if (row.family !== 'auth') return 'none'
  const values = AUTH_VALUES[row.schedule_id]?.[row.arm.startsWith('treatment/') ? 'treatment' : 'control']
  if (!values) throw new Phase3BProductionError('scenario_input_invalid', 'auth schedule is not frozen')
  const parts: string[] = []
  if (values.ANTHROPIC_AUTH_TOKEN) parts.push(`authorization:${AUTH_MARKERS.get(values.ANTHROPIC_AUTH_TOKEN)}`)
  if (values.ANTHROPIC_API_KEY) parts.push(`x-api-key:${AUTH_MARKERS.get(values.ANTHROPIC_API_KEY)}`)
  return parts.length === 0 ? 'none' : parts.join('+')
}

function materializeConfig(runtimeRoot: string, runRelative: string, row: RunLedgerRow, routeUrls: readonly string[], env: NodeJS.ProcessEnv): Readonly<Record<string, string>> {
  if (routeUrls.length !== 2) throw new Phase3BProductionError('scenario_input_invalid', 'config row does not have exact two-route definition')
  const values = configRoutePlan(row)
  const locations = {
    user: `${runRelative}/home/.claude/settings.json`,
    project: `${runRelative}/cwd/.claude/settings.json`,
    local: `${runRelative}/cwd/.claude/settings.local.json`,
  } as const
  const digests: Record<string, string> = {}
  for (const source of ['user', 'project', 'local'] as const) {
    const route = values[source]
    if (route === null) continue
    const document = { env: { ANTHROPIC_BASE_URL: routeUrls[route] } }
    writeExclusiveCanonical(runtimeRoot, locations[source], document)
    digests[source] = sha256Canonical(document)
  }
  if (values['process-env'] !== null) {
    env.ANTHROPIC_BASE_URL = routeUrls[values['process-env']]
    digests['process-env'] = sha256Canonical({ value_class: `loopback-route-${values['process-env']}` })
  }
  return deepFreeze(digests)
}

function assertBootstrapPolicy(row: RunLedgerRow): void {
  if (row.family !== 'config') {
    if (row.bootstrap_policy.expected_count !== 1 || row.bootstrap_policy.policy !== 'exact_one_loopback_head') throw new Phase3BProductionError('scenario_input_invalid', 'non-config row bootstrap policy drifted')
    return
  }
  const plan = configRoutePlan(row)
  const fileSelected = plan.preflight_route === null && [plan.user, plan.project, plan.local].includes(plan.request_route)
  const expected = fileSelected
    ? { expected_count: 0, policy: 'config_file_precedence_no_bootstrap' }
    : { expected_count: 1, policy: 'exact_one_loopback_head' }
  if (sha256Canonical(row.bootstrap_policy) !== sha256Canonical(expected)) throw new Phase3BProductionError('scenario_input_invalid', 'config bootstrap policy is not derived from the sealed route plan')
}

export type PreparedScenarioFilesystem = Readonly<{
  run_relative: string
  cwd: string
  env: NodeJS.ProcessEnv
  stdin: Buffer
  profile: string
  route_ports: readonly number[]
  input_class_sha256s: Readonly<Record<string, string>>
}>

export function prepareScenarioFilesystem(runtimeRoot: string, ledgerInput: CampaignLedger, row: RunLedgerRow, bootstrap: ReceiverTargetBootstrap): PreparedScenarioFilesystem {
  const ledger = validateCampaignLedger(ledgerInput)
  const exact = ledger.rows[row.sequence_index]
  if (!exact || exact.row_sha256 !== row.row_sha256 || bootstrap.route_urls.length !== row.route_count || bootstrap.route_urls.some((value) => { try { const url = new URL(value); return url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port } catch { return true } })) throw new Phase3BProductionError('scenario_input_invalid', 'scenario filesystem authority is invalid')
  assertBootstrapPolicy(row)
  const runRelative = `runs/${String(row.sequence_index).padStart(3, '0')}-${row.run_id}`
  for (const relative of [runRelative, `${runRelative}/home`, `${runRelative}/home/.claude`, `${runRelative}/xdg`, `${runRelative}/tmp`, `${runRelative}/cwd`, `${runRelative}/cwd/.claude`]) createPrivateDirectory(runtimeRoot, relative)
  const roots = { home: path.join(runtimeRoot, runRelative, 'home'), xdg: path.join(runtimeRoot, runRelative, 'xdg'), tmp: path.join(runtimeRoot, runRelative, 'tmp'), cwd: path.join(runtimeRoot, runRelative, 'cwd') }
  const env: NodeJS.ProcessEnv = {
    PATH: '/usr/bin:/bin', HOME: roots.home, CLAUDE_CONFIG_DIR: path.join(roots.home, '.claude'), XDG_CONFIG_HOME: path.join(roots.xdg, 'config'),
    XDG_CACHE_HOME: path.join(roots.xdg, 'cache'), XDG_DATA_HOME: path.join(roots.xdg, 'data'), XDG_STATE_HOME: path.join(roots.xdg, 'state'),
    TMPDIR: roots.tmp, TMP: roots.tmp, TEMP: roots.tmp, CLAUDE_CODE_TMPDIR: roots.tmp, TZ: 'UTC', LANG: 'C', LC_ALL: 'C',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', NO_PROXY: '127.0.0.1,localhost', ANTHROPIC_CUSTOM_HEADERS: bootstrap.custom_headers,
    ORACLE_PHASE3B_SELECTED_BASE_URL: bootstrap.selected_base_url,
    ORACLE_PHASE3B_MAX_ATTEMPTS: String(row.response_program.maximum_attempts),
    ORACLE_PHASE3B_EXPECT_COMPLETE: row.response_program.actions.at(-1)?.body_kind === 'complete_sse' ? '1' : '0',
    ORACLE_PHASE3B_EXPECT_FAILURE: (row.family === 'auth' && row.schedule_id === 'auth-missing-credential' && row.arm.startsWith('treatment/')) || (row.family === 'response_failure_recovery' && /_terminal$|^reset_terminal$|^partial_sse_then_eof$/.test(row.schedule_id)) ? '1' : '0',
  }
  for (const relative of [`${runRelative}/xdg/config`, `${runRelative}/xdg/cache`, `${runRelative}/xdg/data`, `${runRelative}/xdg/state`]) createPrivateDirectory(runtimeRoot, relative)
  let inputClasses: Readonly<Record<string, string>> = {}
  if (row.family === 'config') {
    env.ANTHROPIC_API_KEY = 'oracle-phase3b-placeholder:config-precedence'
    inputClasses = materializeConfig(runtimeRoot, runRelative, row, bootstrap.route_urls, env)
  } else {
    env.ANTHROPIC_BASE_URL = bootstrap.selected_base_url
    if (row.family === 'auth') {
      const definition = AUTH_VALUES[row.schedule_id]
      if (!definition) throw new Phase3BProductionError('scenario_input_invalid', 'auth schedule is not frozen')
      Object.assign(env, row.arm.startsWith('treatment/') ? definition.treatment : definition.control)
      inputClasses = deepFreeze(Object.fromEntries(Object.keys(row.arm.startsWith('treatment/') ? definition.treatment : definition.control).sort().map((key) => {
        const fieldId = AUTH_ENV_FIELD_IDS.get(key)
        if (!fieldId) throw new Phase3BProductionError('scenario_input_invalid', 'auth environment field is not in the fixed opaque schema')
        return [fieldId, 'synthetic-marker-present']
      })))
    } else env.ANTHROPIC_API_KEY = 'oracle-phase3b-placeholder:campaign'
  }
  const routePorts = bootstrap.route_urls.map((value) => Number(new URL(value).port))
  const profile = buildSandboxProfile(runtimeRoot, path.join(runtimeRoot, runRelative), routePorts)
  return Object.freeze({ run_relative: runRelative, cwd: roots.cwd, env: deepFreeze(env), stdin: Buffer.from(FIXED_STDIN_LITERAL, 'utf8'), profile, route_ports: deepFreeze(routePorts), input_class_sha256s: inputClasses })
}

export function prepareScenarioCell(controller: ProductionController, row: RunLedgerRow, bootstrap: ReceiverTargetBootstrap): PreparedCell {
  assertProductionController(controller)
  const state = controllerState(controller)
  if (!state.namespaceSealed || state.runtimeRoot === null) throw new Phase3BProductionError('scenario_input_invalid', 'sealed controller namespace is required')
  const exact = state.ledger.rows[row.sequence_index]
  if (!exact || exact.row_sha256 !== row.row_sha256 || bootstrap.route_urls.length !== row.route_count || bootstrap.route_urls.some((value) => { try { const url = new URL(value); return url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port } catch { return true } })) throw new Phase3BProductionError('scenario_input_invalid', 'row or loopback route binding drifted')
  const filesystem = prepareScenarioFilesystem(state.runtimeRoot, state.ledger, row, bootstrap)
  const environmentSha256 = sha256Canonical(filesystem.env)
  const sandboxProfileSha256 = sha256Bytes(Buffer.from(filesystem.profile, 'utf8'))
  const descriptorUnsigned = {
    schema_id: 'oracle-lab-p3b-cell-input-descriptor.v1', campaign_id: state.ledger.campaign_id, ledger_sha256: state.ledger.ledger_sha256,
    run_id: row.run_id, sequence_index: row.sequence_index, row_sha256: row.row_sha256, argv_sha256: row.argv_sha256, request_stimulus_sha256: row.request_stimulus_sha256,
    environment_sha256: environmentSha256, cwd_sha256: sha256Canonical(filesystem.cwd), stdin_sha256: row.stdin_sha256,
    launch_authority_sha256: bootstrap.launch_authority_sha256, route_authorities_sha256: sha256Canonical(bootstrap.route_urls), bootstrap_policy: row.bootstrap_policy, input_class_sha256s: filesystem.input_class_sha256s, sandbox_profile_sha256: sandboxProfileSha256, unknown_or_omitted: 'disabled', raw_material_persisted: false,
  }
  const inputDescriptorSha256 = sha256Canonical(descriptorUnsigned)
  writeExclusiveCanonical(state.runtimeRoot, `${filesystem.run_relative}/input-descriptor.json`, { ...descriptorUnsigned, input_descriptor_sha256: inputDescriptorSha256 })
  const cell = deepFreeze({ schema_id: 'oracle-lab-p3b-prepared-cell.v1' as const, campaign_id: state.ledger.campaign_id, ledger_sha256: state.ledger.ledger_sha256, run_id: row.run_id, sequence_index: row.sequence_index, cwd: filesystem.cwd, argv: row.argv, environment_sha256: environmentSha256, sandbox_profile_sha256: sandboxProfileSha256, input_descriptor_sha256: inputDescriptorSha256 })
  preparedCells.set(cell, { row, env: filesystem.env, stdin: filesystem.stdin, cwd: filesystem.cwd, runtimeRoot: state.runtimeRoot, profile: filesystem.profile, routePorts: [...filesystem.route_ports] })
  return cell
}

export function preparedCellState(cell: PreparedCell, row?: RunLedgerRow): Readonly<PreparedState> {
  const state = preparedCells.get(cell as object)
  if (!state || (row && state.row.row_sha256 !== row.row_sha256)) throw new Phase3BProductionError('scenario_input_invalid', 'opaque internally prepared cell is required')
  const literalIdentity = stableRead(path.join(state.runtimeRoot, state.row.literal_table_path), { mode: 0o600, maximumBytes: 32_768 }).identity
  if (sha256Canonical(state.env) !== cell.environment_sha256 || sha256Bytes(Buffer.from(state.profile, 'utf8')) !== cell.sandbox_profile_sha256 || sha256Bytes(state.stdin) !== state.row.stdin_sha256 || FIXED_LITERAL_TABLE_SHA256 !== state.row.literal_table_sha256 || literalIdentity.sha256 !== state.row.literal_table_sha256) throw new Phase3BProductionError('scenario_input_invalid', 'prepared cell bytes drifted')
  return state
}
