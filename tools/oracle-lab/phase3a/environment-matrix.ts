import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { canonicalJson, Phase3AError, sha256Bytes } from './core.js'

export const BASE_URL_ENV_KEYS = [
  'ANTHROPIC_AWS_BASE_URL',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_BEDROCK_MANTLE_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'CLAUDE_CODE_API_BASE_URL',
  'CLAUDE_LOCAL_OAUTH_API_BASE',
  'CLAUDE_LOCAL_OAUTH_APPS_BASE',
  'CLAUDE_LOCAL_OAUTH_CONSOLE_BASE',
  'MCP_OAUTH_CLIENT_METADATA_URL',
  'SESSION_INGRESS_URL',
  'VOICE_STREAM_BASE_URL',
  'ANTHROPIC_UNIX_SOCKET',
] as const

export const REGION_ENV_KEYS = [
  'ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_REGION',
  'AZURE_REGIONAL_AUTHORITY_NAME',
  'CLOUD_ML_REGION',
] as const

type CensusLocation = { module_id: string | null; node_kind: string; location: { offset: number; length: number; [key: string]: unknown } }
type Census = {
  binding: Record<string, unknown>
  env_reads: Array<{ key: string; locations: CensusLocation[]; match_count: number; module_count: number }>
}

export type MatrixSetting = {
  variable: string
  state: 'unset' | 'empty' | 'value'
  value_class: string
  value_template?: string
}

export type EnvironmentMatrixPair = {
  pair_id: string
  family: 'base-url-state' | 'provider-token' | 'region' | 'hostname' | 'placeholder-auth' | 'telemetry'
  trigger_family: 'routing' | 'region' | 'auth' | 'telemetry'
  changed_variable: string
  control: MatrixSetting
  treatment: MatrixSetting
  fixed_variables_sha256: string
  static_anchor: { key: string; match_count: number; module_count: number; locations: CensusLocation[] }
  execution: { lane: 'active-probe-copy'; status: 'selected'; external_socket_budget: 0; reserved_host_termination: 'loopback-proxy-or-explicit-unknown' }
}

export type EnvironmentMatrix = {
  schema_version: 'oracle-lab-phase3a-environment-matrix.v1'
  artifact_binding: Record<string, unknown>
  pair_count: number
  pairs: EnvironmentMatrixPair[]
  deterministic_digest: string
}

function fail(code: string, message: string): never { throw new Phase3AError(code, message) }

export function validateMatrixPair(pair: EnvironmentMatrixPair): EnvironmentMatrixPair {
  if (pair.changed_variable !== pair.control.variable || pair.changed_variable !== pair.treatment.variable) {
    fail('matrix_multiple_variables', 'matrix pair must change exactly one declared variable')
  }
  if (canonicalJson(pair.control) === canonicalJson(pair.treatment)) fail('matrix_no_change', 'matrix pair control and treatment must differ')
  if (pair.static_anchor.key !== pair.changed_variable || pair.static_anchor.locations.length < 1) fail('matrix_static_anchor_missing', 'matrix pair must bind its changed variable to static locations')
  if (!/^[a-z0-9][a-z0-9-]{7,127}$/.test(pair.pair_id)) fail('matrix_pair_id', 'matrix pair ID must be a bounded lowercase slug')
  return pair
}

function setting(variable: string, state: MatrixSetting['state'], valueClass: string, valueTemplate?: string): MatrixSetting {
  return { variable, state, value_class: valueClass, ...(valueTemplate === undefined ? {} : { value_template: valueTemplate }) }
}

export function buildEnvironmentMatrix(census: Census): EnvironmentMatrix {
  if (!census || !Array.isArray(census.env_reads) || !census.binding || typeof census.binding !== 'object') fail('matrix_census_invalid', 'environment matrix requires a bound static census')
  const anchors = new Map(census.env_reads.map((row) => [row.key, row]))
  const pairs: EnvironmentMatrixPair[] = []
  const add = (
    family: EnvironmentMatrixPair['family'], triggerFamily: EnvironmentMatrixPair['trigger_family'], variable: string,
    suffix: string, control: MatrixSetting, treatment: MatrixSetting,
  ): void => {
    const anchor = anchors.get(variable)
    if (!anchor || !Array.isArray(anchor.locations) || anchor.locations.length === 0) fail('matrix_static_anchor_missing', `static census has no location for ${variable}`)
    const fixed = { artifact_binding: census.binding, command_profile: 'full', model: 'claude-sonnet-4-6', observer: 'loopback-fake-upstream', instrumentation: 'probe-copy' }
    pairs.push(validateMatrixPair({
      pair_id: `r2-${family}-${variable.toLowerCase().replaceAll('_', '-')}-${suffix}`,
      family, trigger_family: triggerFamily, changed_variable: variable, control, treatment,
      fixed_variables_sha256: sha256Bytes(canonicalJson(fixed)),
      static_anchor: { key: variable, match_count: anchor.match_count, module_count: anchor.module_count, locations: anchor.locations },
      execution: { lane: 'active-probe-copy', status: 'selected', external_socket_budget: 0, reserved_host_termination: 'loopback-proxy-or-explicit-unknown' },
    }))
  }

  for (const variable of BASE_URL_ENV_KEYS) {
    const neutralClass = variable === 'ANTHROPIC_UNIX_SOCKET' ? 'loopback-unix-socket' : 'loopback-neutral'
    const neutralTemplate = variable === 'ANTHROPIC_UNIX_SOCKET' ? 'EVIDENCE_ROOT/ipc/anthropic.sock' : 'LOOPBACK_BASE'
    add('base-url-state', 'routing', variable, 'unset-empty', setting(variable, 'unset', 'unset'), setting(variable, 'empty', 'empty'))
    add('base-url-state', 'routing', variable, 'empty-neutral', setting(variable, 'empty', 'empty'), setting(variable, 'value', neutralClass, neutralTemplate))
  }

  const tokens: Array<[string, string]> = [
    ['aliyun', 'aliyun.phase3a.test'], ['qwen', 'qwen.phase3a.test'], ['deepseek', 'deepseek.phase3a.test'],
    ['volcengine', 'volcengine.phase3a.test'], ['moonshot', 'moonshot.phase3a.test'], ['zhipu', 'zhipu.phase3a.test'],
    ['china', 'china.phase3a.test'], ['dot-cn', 'provider.phase3a.cn.test'], ['lab', 'lab.phase3a.test'],
    ['anthropic', 'anthropic.phase3a.test'], ['unrelated-control', 'neutral.phase3a.test'], ['alivun', 'alivun.phase3a.test'],
    ['chinax', 'chinax.phase3a.test'], ['labyrinth', 'labyrinth.phase3a.test'], ['punctuation-control', 'a-b_c.phase3a.test'],
  ]
  for (const [valueClass, hostname] of tokens) {
    const variable = 'ANTHROPIC_BASE_URL'
    add('provider-token', 'routing', variable, valueClass, setting(variable, 'value', 'loopback-neutral', 'LOOPBACK_BASE'), setting(variable, 'value', valueClass, `http://${hostname}:LOOPBACK_PROXY_PORT`))
  }

  for (const variable of REGION_ENV_KEYS) {
    add('region', 'region', variable, 'unset-empty', setting(variable, 'unset', 'unset'), setting(variable, 'empty', 'empty'))
    add('region', 'region', variable, 'empty-neutral', setting(variable, 'empty', 'empty'), setting(variable, 'value', 'neutral-region', 'oracle-phase3a-neutral'))
  }
  add('hostname', 'region', 'HOSTNAME', 'unset-empty', setting('HOSTNAME', 'unset', 'unset'), setting('HOSTNAME', 'empty', 'empty'))
  add('hostname', 'region', 'HOSTNAME', 'empty-neutral', setting('HOSTNAME', 'empty', 'empty'), setting('HOSTNAME', 'value', 'synthetic-hostname', 'phase3a.local'))

  for (const variable of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) {
    add('placeholder-auth', 'auth', variable, 'unset-empty', setting(variable, 'unset', 'unset'), setting(variable, 'empty', 'empty'))
    add('placeholder-auth', 'auth', variable, 'empty-placeholder', setting(variable, 'empty', 'empty'), setting(variable, 'value', 'placeholder', `oracle-phase3a-placeholder:${variable.toLowerCase()}`))
  }
  add('telemetry', 'telemetry', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'disabled-enabled', setting('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'value', 'disabled', '1'), setting('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'value', 'enabled', '0'))

  if (pairs.length !== 60) fail('matrix_budget_mismatch', `environment matrix must contain exactly 60 pairs, observed ${pairs.length}`)
  const base = { schema_version: 'oracle-lab-phase3a-environment-matrix.v1' as const, artifact_binding: census.binding, pair_count: pairs.length, pairs }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const censusFile = argument('--census'); const out = argument('--out')
  if (!censusFile) fail('usage', 'usage: environment-matrix.ts --census FILE [--out FILE]')
  const matrix = buildEnvironmentMatrix(JSON.parse(readFileSync(censusFile, 'utf8')) as Census)
  const bytes = `${canonicalJson(matrix)}\n`
  if (out) writeFileSync(out, bytes, { flag: 'wx', mode: 0o600 }); else process.stdout.write(bytes)
}
