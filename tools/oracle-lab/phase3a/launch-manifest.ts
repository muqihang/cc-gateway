import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes } from './core.js'
import { assertPhase3A } from './schemas.js'

export type Instrumentation = 'none' | 'preload' | 'loader' | 'bun' | 'inspector' | 'probe-copy'

export type LaunchManifest = {
  schema_version: 'oracle-lab-phase3a-launch-manifest.v1'
  run_id: string
  parent_run_id: string | null
  pair_id: string
  sequence_index: number
  randomization_seed: number
  phase: '3A'
  requirement_ids: string[]
  hypothesis_id: string
  evidence_level_ceiling: 'Observed' | 'Reproduced' | 'Inferred' | 'Unknown'
  repositories: Record<string, { commit: string; tree: string; dirty_digest: string }>
  contract: Record<string, unknown>
  artifact: { package: string; version: string; registry_url: string; archive_sha256: string; tree_sha256: string; entrypoint_sha256: string }
  toolchain_digest: string
  platform: Record<string, string>
  command: { executable_sha256: string; argv: string[]; cwd: string; stdin_sha256: string; timeout_ms: number }
  environment: {
    allowlist: Record<string, string>
    explicit_empty: string[]
    unset: string[]
    home: string
    xdg: string
    tmp: string
    tz: string
    lang: string
    lc_all: string
    base_urls: string[]
  }
  network: { policy: 'declared_loopback_only'; loopback_ports: number[]; proxy_mode: 'none' | 'loopback-connect' | 'loopback-mitm'; ca_sha256: string | null; external_socket_budget: 0 }
  matrix: { changed_variable: string; control_value: unknown; treatment_value: unknown; fixed_variables: Record<string, unknown> }
  limits: { wall_ms: number; cpu_ms: number; rss_bytes: number; output_bytes: number; processes: number; retries: number; sockets: number; files: number }
  capture: Record<'hook' | 'inspector' | 'process' | 'fs' | 'network' | 'tls' | 'http' | 'pcap' | 'stdout' | 'stderr', boolean>
  redaction_policy: 'oracle-lab-phase3a-redaction.v1'
  retention_class: string
  expiry: string
  previous_manifest_sha256: string | null
  preflight: { status: 'PASS'; codegraph_current: true; [key: string]: unknown }
}

const FORBIDDEN_INHERITED_ENV = new Set([
  'SSH_AUTH_SOCK', 'GPG_AGENT_INFO',
  'NODE_OPTIONS', 'BUN_OPTIONS', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'LD_PRELOAD',
])

const PLACEHOLDER_CREDENTIALS = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'])
const FORBIDDEN_CREDENTIAL_CHANNELS = new Set(['CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR', 'AWS_BEARER_TOKEN_BEDROCK', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'])
const PROXY_VARIABLES = new Set(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'])

function rejectUnsafeEnvironment(manifest: LaunchManifest): void {
  for (const key of FORBIDDEN_INHERITED_ENV) {
    if (Object.hasOwn(manifest.environment.allowlist, key)) {
      throw new Phase3AError('unsafe_environment', `${key} cannot be inherited through allowlist`, `$.environment.allowlist.${key}`)
    }
  }
  for (const key of PLACEHOLDER_CREDENTIALS) {
    const value = manifest.environment.allowlist[key]
    if (value !== undefined && value !== '' && !/^oracle-phase3a-placeholder:[A-Za-z0-9._:-]{1,128}$/.test(value)) {
      throw new Phase3AError('real_credential_forbidden', `${key} must use the explicit Phase 3A placeholder namespace`, `$.environment.allowlist.${key}`)
    }
  }
  for (const key of FORBIDDEN_CREDENTIAL_CHANNELS) {
    if (Object.hasOwn(manifest.environment.allowlist, key)) throw new Phase3AError('real_credential_forbidden', `${key} is not admitted by the Phase 3A launcher`, `$.environment.allowlist.${key}`)
  }
  const declared = new Set(manifest.network.loopback_ports)
  for (const key of PROXY_VARIABLES) {
    const value = manifest.environment.allowlist[key]
    if (value === undefined || value === '') continue
    let parsed: URL
    try { parsed = new URL(value) } catch { throw new Phase3AError('unsafe_proxy', `${key} must be a loopback URL`) }
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80
    if (!['http:', 'https:', 'socks5:'].includes(parsed.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname) || !declared.has(port)) {
      throw new Phase3AError('unsafe_proxy', `${key} must target a declared loopback port`)
    }
  }
  const overlap = new Set<string>()
  for (const key of manifest.environment.explicit_empty) if (manifest.environment.unset.includes(key)) overlap.add(key)
  if (overlap.size > 0) throw new Phase3AError('ambiguous_environment', `variables cannot be both empty and unset: ${[...overlap].sort().join(',')}`)
}

function urlPort(value: string): number {
  const parsed = new URL(value)
  if (!['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname)) {
    throw new Phase3AError('external_destination', 'base URL must be loopback')
  }
  return parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80
}

export function validateLaunchManifest(value: unknown): LaunchManifest {
  assertPhase3A('launch-manifest', value)
  const manifest = value as LaunchManifest
  if (manifest.command.timeout_ms > manifest.limits.wall_ms) {
    throw new Phase3AError('limit_mismatch', 'command timeout exceeds cell wall limit', '$.command.timeout_ms')
  }
  if (manifest.network.external_socket_budget !== 0 || manifest.network.policy !== 'declared_loopback_only') {
    throw new Phase3AError('external_socket_budget', 'dynamic cells require zero-budget declared-loopback policy')
  }
  const declared = new Set(manifest.network.loopback_ports)
  for (const baseUrl of manifest.environment.base_urls) {
    if (!declared.has(urlPort(baseUrl))) throw new Phase3AError('undeclared_loopback_port', 'base URL port is absent from loopback allowlist')
  }
  rejectUnsafeEnvironment(manifest)
  return manifest
}

export function loadLaunchManifest(file: string): LaunchManifest {
  let parsed: unknown
  try { parsed = JSON.parse(readFileSync(file, 'utf8')) } catch (error) {
    throw new Phase3AError('manifest_read_failed', error instanceof Error ? error.message : String(error))
  }
  return validateLaunchManifest(parsed)
}

export function manifestDigest(manifest: LaunchManifest): string {
  return sha256Bytes(canonicalJson(validateLaunchManifest(manifest)))
}

export function assertControlForInstrumentation(instrumented: LaunchManifest, control: LaunchManifest | null, instrumentation: Instrumentation): void {
  if (instrumentation === 'none') return
  if (!control) throw new Phase3AError('missing_control', 'every instrumented cell requires an uninstrumented control')
  validateLaunchManifest(control)
  if (control.pair_id !== instrumented.pair_id || control.hypothesis_id !== instrumented.hypothesis_id) {
    throw new Phase3AError('control_mismatch', 'instrumented cell and control must share pair and hypothesis')
  }
  if (control.run_id === instrumented.run_id) throw new Phase3AError('control_mismatch', 'control and instrumented run IDs must differ')
  if (control.capture.hook || control.capture.inspector) throw new Phase3AError('control_instrumented', 'control manifest must be uninstrumented')
  if (control.artifact.entrypoint_sha256 !== instrumented.artifact.entrypoint_sha256 || control.command.executable_sha256 !== instrumented.command.executable_sha256) {
    throw new Phase3AError('control_artifact_mismatch', 'control and instrumented cell must bind the same executable bytes')
  }
  const comparable = (manifest: LaunchManifest) => ({
    phase: manifest.phase, requirement_ids: manifest.requirement_ids, hypothesis_id: manifest.hypothesis_id,
    repositories: manifest.repositories, contract: manifest.contract, artifact: manifest.artifact,
    toolchain_digest: manifest.toolchain_digest, platform: manifest.platform,
    command: { ...manifest.command, cwd: '<isolated>' },
    environment: { ...manifest.environment, home: '<isolated>', xdg: '<isolated>', tmp: '<isolated>' },
    network: manifest.network, matrix: manifest.matrix, limits: manifest.limits,
    capture: { ...manifest.capture, hook: false, inspector: false },
    redaction_policy: manifest.redaction_policy, retention_class: manifest.retention_class,
    preflight: manifest.preflight,
  })
  if (canonicalJson(comparable(control)) !== canonicalJson(comparable(instrumented))) {
    throw new Phase3AError('control_mismatch', 'instrumented cell differs from control outside isolation paths and instrumentation flags')
  }
}

export function assertSingleVariablePair(control: LaunchManifest, treatment: LaunchManifest): void {
  validateLaunchManifest(control)
  validateLaunchManifest(treatment)
  if (control.pair_id !== treatment.pair_id || control.hypothesis_id !== treatment.hypothesis_id) {
    throw new Phase3AError('pair_mismatch', 'pair IDs and hypotheses must match')
  }
  if (control.matrix.changed_variable !== treatment.matrix.changed_variable) throw new Phase3AError('matrix_mismatch', 'changed variable differs')
  if (canonicalJson(control.matrix.fixed_variables) !== canonicalJson(treatment.matrix.fixed_variables)) {
    throw new Phase3AError('multiple_variables_changed', 'fixed variables differ between pair members')
  }
  if (canonicalJson(control.matrix.control_value) === canonicalJson(control.matrix.treatment_value)) {
    throw new Phase3AError('no_variable_changed', 'control and treatment values must differ')
  }
  const invariant = (manifest: LaunchManifest) => ({
    artifact: manifest.artifact, repositories: manifest.repositories, contract: manifest.contract,
    toolchain_digest: manifest.toolchain_digest, command: { ...manifest.command, cwd: '<isolated>' },
    network: manifest.network, limits: manifest.limits, redaction_policy: manifest.redaction_policy,
  })
  if (canonicalJson(invariant(control)) !== canonicalJson(invariant(treatment))) {
    throw new Phase3AError('multiple_variables_changed', 'pair changed a frozen invariant')
  }
}

export function buildIsolatedEnvironment(manifestInput: LaunchManifest, evidenceRootInput: string): { env: NodeJS.ProcessEnv; directories: { home: string; xdg: string; tmp: string; cwd: string } } {
  const manifest = validateLaunchManifest(manifestInput)
  const root = ensureEvidenceRoot(evidenceRootInput)
  const directory = (relative: string): string => {
    const absolute = assertEvidencePath(root, path.join(root, relative))
    mkdirSync(absolute, { recursive: true, mode: 0o700 })
    return absolute
  }
  const directories = {
    home: directory(manifest.environment.home),
    xdg: directory(manifest.environment.xdg),
    tmp: directory(manifest.environment.tmp),
    cwd: directory(manifest.command.cwd),
  }
  const env: NodeJS.ProcessEnv = { ...manifest.environment.allowlist }
  for (const key of manifest.environment.explicit_empty) env[key] = ''
  for (const key of manifest.environment.unset) delete env[key]
  Object.assign(env, {
    HOME: directories.home,
    CLAUDE_CONFIG_DIR: path.join(directories.home, '.claude'),
    XDG_CONFIG_HOME: path.join(directories.xdg, 'config'),
    XDG_CACHE_HOME: path.join(directories.xdg, 'cache'),
    XDG_DATA_HOME: path.join(directories.xdg, 'data'),
    XDG_STATE_HOME: path.join(directories.xdg, 'state'),
    TMPDIR: directories.tmp,
    TMP: directories.tmp,
    TEMP: directories.tmp,
    TZ: manifest.environment.tz,
    LANG: manifest.environment.lang,
    LC_ALL: manifest.environment.lc_all,
  })
  for (const relative of ['.claude', 'config', 'cache', 'data', 'state']) {
    mkdirSync(relative === '.claude' ? env.CLAUDE_CONFIG_DIR! : path.join(directories.xdg, relative), { recursive: true, mode: 0o700 })
  }
  return { env, directories }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = argument('--manifest')
  if (!file) throw new Phase3AError('usage', 'usage: launch-manifest.ts --manifest FILE')
  const manifest = loadLaunchManifest(file)
  process.stdout.write(`${canonicalJson({ run_id: manifest.run_id, pair_id: manifest.pair_id, sha256: manifestDigest(manifest), status: 'PASS' })}\n`)
}
