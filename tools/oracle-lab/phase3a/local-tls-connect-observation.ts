import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'
import { type LaunchManifest, validateLaunchManifest } from './launch-manifest.js'
import { startConnectProxy, type ConnectProxy, type LocalTlsMaterial } from './observers/connect-proxy.js'
import { runCell, runCellGuardSelfTest } from './run-cell.js'

export const ACTIVE_ARTIFACT = {
  package: '@anthropic-ai/claude-code',
  version: '2.1.215',
  registry_url: 'https://registry.npmjs.org/@anthropic-ai%2fclaude-code/2.1.215',
  archive_sha256: '1a5cf8e491689154264c0b2f28371bf645cdee2903b45c497915868308502d7b',
  tree_sha256: '024fa410b532ced37cd9e45a95aae6f9eb22e9ce8491e1fad843f24d958f4a88',
  entrypoint_sha256: '90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58',
} as const

export const LOCAL_TLS_CONNECT_PROMPT = Buffer.from('Phase 3A synthetic local TLS CONNECT observation. Reply exactly OK.', 'utf8')

export type LocalTlsConnectOptions = {
  evidence_root: string
  out_relative: string
  entrypoint: string
  run_id: string
  cc_commit: string
  cc_tree: string
  sub2api_commit: string
  sub2api_tree: string
  plan_sha256: string
  toolchain_digest: string
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${canonicalJson(value)}\n`, { flag: 'wx', mode: 0o600 })
}

function assertSha256(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Phase3AError('invalid_arguments', `${label} must be a SHA-256 digest`)
}

function assertCommit(value: string, label: string): void {
  if (!/^[a-f0-9]{40}$/.test(value)) throw new Phase3AError('invalid_arguments', `${label} must be a commit or tree digest`)
}

export function buildLocalTlsConnectManifest(options: LocalTlsConnectOptions, observerPort: number, tls: LocalTlsMaterial): LaunchManifest {
  for (const [label, value] of Object.entries({ plan_sha256: options.plan_sha256, toolchain_digest: options.toolchain_digest, ca_sha256: tls.ca_sha256 })) assertSha256(value, label)
  for (const [label, value] of Object.entries({ cc_commit: options.cc_commit, cc_tree: options.cc_tree, sub2api_commit: options.sub2api_commit, sub2api_tree: options.sub2api_tree })) assertCommit(value, label)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(options.run_id)) throw new Phase3AError('invalid_arguments', 'run_id is invalid')
  if (sha256File(options.entrypoint) !== ACTIVE_ARTIFACT.entrypoint_sha256) throw new Phase3AError('executable_digest_mismatch', 'entrypoint differs from the active artifact')
  const proxyUrl = `http://127.0.0.1:${observerPort}`
  return validateLaunchManifest({
    schema_version: 'oracle-lab-phase3a-launch-manifest.v1', run_id: options.run_id, parent_run_id: null,
    pair_id: `${options.run_id}-pair`, sequence_index: 0, randomization_seed: 215,
    phase: '3A', requirement_ids: ['HA-P1-001', 'HA-P1-003'], hypothesis_id: 'active-artifact-local-tls-connect-observation', evidence_level_ceiling: 'Observed',
    repositories: {
      cc_gateway: { commit: options.cc_commit, tree: options.cc_tree, dirty_digest: sha256Bytes('repository-state-not-assessed-by-observer') },
      sub2api: { commit: options.sub2api_commit, tree: options.sub2api_tree, dirty_digest: sha256Bytes('repository-state-not-assessed-by-observer') },
    },
    contract: { bundle_id: 'oracle.compatibility.v1', bundle_sha256: '2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce', schema_range: '1:0-0', predecessor_sha256: '70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1' },
    artifact: ACTIVE_ARTIFACT, toolchain_digest: options.toolchain_digest,
    platform: { os: process.platform, release: os.release(), arch: process.arch, runtime: 'native', virtualization: 'host-sandbox-exec' },
    command: {
      executable_sha256: ACTIVE_ARTIFACT.entrypoint_sha256,
      argv: ['--bare', '--print', '--output-format', 'json', '--no-session-persistence', '--session-id', '00000000-0000-4000-8000-000000000215', '--model', 'claude-sonnet-4-6', '--permission-mode', 'bypassPermissions'],
      cwd: `runs/${options.run_id}/cwd`, stdin_sha256: sha256Bytes(LOCAL_TLS_CONNECT_PROMPT), timeout_ms: 120_000,
    },
    environment: {
      allowlist: {
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TERM: 'xterm-256color',
        ANTHROPIC_BASE_URL: 'https://api.synthetic.test', CLAUDE_CODE_API_BASE_URL: 'https://api.synthetic.test',
        ANTHROPIC_API_KEY: 'oracle-phase3a-placeholder:local-tls-connect',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, ALL_PROXY: proxyUrl,
      },
      explicit_empty: [],
      unset: ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_CUSTOM_HEADERS', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR', 'AWS_BEARER_TOKEN_BEDROCK', 'NO_PROXY', 'SSH_AUTH_SOCK'],
      home: `runs/${options.run_id}/home`, xdg: `runs/${options.run_id}/xdg`, tmp: `runs/${options.run_id}/tmp`,
      tz: 'UTC', lang: 'C', lc_all: 'C', base_urls: ['https://api.synthetic.test'],
    },
    network: { policy: 'declared_loopback_only', loopback_ports: [observerPort], proxy_mode: 'loopback-mitm', ca_sha256: tls.ca_sha256, external_socket_budget: 0 },
    matrix: { changed_variable: 'transport-observer', control_value: 'not-run', treatment_value: 'loopback-connect-local-ca', fixed_variables: { artifact: ACTIVE_ARTIFACT.entrypoint_sha256, prompt_sha256: sha256Bytes(LOCAL_TLS_CONNECT_PROMPT), target_class: 'reserved-test-host', upstream_dial: false } },
    limits: { wall_ms: 120_000, cpu_ms: 120_000, rss_bytes: 4 * 1024 * 1024 * 1024, output_bytes: 8 * 1024 * 1024, processes: 32, retries: 8, sockets: 16, files: 4096 },
    capture: { hook: false, inspector: false, process: true, fs: true, network: true, tls: true, http: true, pcap: false, stdout: true, stderr: true },
    redaction_policy: 'oracle-lab-phase3a-redaction.v1', retention_class: 'synthetic-raw-14d', expiry: '2026-08-03T00:00:00.000Z', previous_manifest_sha256: null,
    preflight: { status: 'PASS', cc_head: options.cc_commit, cc_tree: options.cc_tree, sub2api_head: options.sub2api_commit, sub2api_tree: options.sub2api_tree, plan_sha256: options.plan_sha256, p2_bundle_sha256: '2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce', predecessor_sha256: '70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1', codegraph_current: true },
  })
}

function safeObserver(proxy: ConnectProxy): Record<string, unknown> {
  return {
    schema_version: 'oracle-lab-phase3a-local-tls-observer.v1', mode: 'local-tls', raw_material_persisted: false,
    ca_sha256: proxy.tls?.ca_sha256 ?? null, openssl_sha256: proxy.tls?.openssl_sha256 ?? null, leaf_certificate_sha256s: proxy.tls?.leaf_certificate_sha256s ?? {},
    connect_events: proxy.events, tls_events: proxy.tls_events, http_events: proxy.http_events,
  }
}

export async function runActiveLocalTlsConnectObservation(options: LocalTlsConnectOptions): Promise<Record<string, unknown>> {
  const root = ensureEvidenceRoot(options.evidence_root)
  const output = assertEvidencePath(root, path.join(root, options.out_relative))
  if (existsSync(output)) throw new Phase3AError('evidence_exists', 'local TLS observation output already exists')
  mkdirSync(output, { recursive: true, mode: 0o700 })
  const proxy = await startConnectProxy({ allowed_targets: [{ host: 'api.synthetic.test', port: 443 }], mode: 'local-tls' })
  try {
    if (!proxy.tls) throw new Phase3AError('observer_local_ca_unavailable', 'local TLS observer did not provide CA material')
    const manifest = buildLocalTlsConnectManifest(options, proxy.port, proxy.tls)
    const guard = await runCellGuardSelfTest(manifest, root)
    writeJson(path.join(output, 'manifest.json'), manifest)
    writeJson(path.join(output, 'guard.json'), guard)
    const result = await runCell({
      manifest, evidence_root: root, executable: options.entrypoint, instrumentation: 'none', guard, stdin: LOCAL_TLS_CONNECT_PROMPT,
      trusted_local_ca: { cert_path: proxy.tls.ca_cert_path, sha256: proxy.tls.ca_sha256 },
    })
    const observer = safeObserver(proxy)
    writeJson(path.join(output, 'observer.json'), observer)
    writeJson(path.join(output, 'result.json'), result)
    const tlsObserved = proxy.tls_events.some((event) => event.decision === 'accepted-local-tls')
    const httpObserved = proxy.http_events.length > 0
    const summary = {
      schema_version: 'oracle-lab-phase3a-local-tls-connect-summary.v1',
      status: tlsObserved && httpObserved ? 'OBSERVED' : 'UNKNOWN',
      phase3b_usable: false,
      active_artifact: { package: ACTIVE_ARTIFACT.package, version: ACTIVE_ARTIFACT.version, entrypoint_sha256: ACTIVE_ARTIFACT.entrypoint_sha256, observed_entrypoint_sha256: sha256File(options.entrypoint) },
      command: { digest: result.command_digest, duration_ms: result.duration_ms, status: result.status, exit_code: result.exit_code, termination_reason: result.termination_reason },
      surfaces: { connect_events: proxy.events, tls_events: proxy.tls_events, http_events: proxy.http_events },
      capability: {
        local_ca: { status: 'available', ca_sha256: proxy.tls.ca_sha256, openssl_sha256: proxy.tls.openssl_sha256 },
        local_tls_connect: tlsObserved ? 'observed' : 'not-observed',
        local_https_http: httpObserved ? 'observed' : 'not-observed',
        external_socket_budget: 0,
        raw_material_persisted: false,
      },
      next_action: tlsObserved && httpObserved
        ? 'Run the same guarded active artifact against bounded synthetic JSON, SSE, compact, and failure responses; this loopback observation does not establish provider TLS equivalence.'
        : 'Inspect the safe observer and cell result categories, then repeat only the bounded local CA/CONNECT cell after the identified local capability is repaired.',
      limitations: ['loopback-only', 'no-upstream-dial', 'no-provider-claim', 'single-active-artifact-cell'],
    }
    writeJson(path.join(output, 'summary.json'), summary)
    return summary
  } finally {
    await proxy.close()
  }
}

function argumentsMap(argv: string[]): Record<string, string> {
  const values = argv[0] === '--' ? argv.slice(1) : argv
  if (values.length % 2 !== 0) throw new Phase3AError('invalid_arguments', 'arguments must be --name value pairs')
  const output: Record<string, string> = {}
  const allowed = new Set(['evidence-root', 'out-relative', 'entrypoint', 'run-id', 'cc-commit', 'cc-tree', 'sub2api-commit', 'sub2api-tree', 'plan-sha256', 'toolchain-digest'])
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index]; const value = values[index + 1]
    if (!flag?.startsWith('--') || !value || value.startsWith('--')) throw new Phase3AError('invalid_arguments', 'arguments must be --name value pairs')
    const name = flag.slice(2)
    if (!allowed.has(name) || output[name] !== undefined) throw new Phase3AError('invalid_arguments', 'unknown or duplicate argument')
    output[name] = value
  }
  return output
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const values = argumentsMap(process.argv.slice(2))
    const required = ['evidence-root', 'out-relative', 'entrypoint', 'run-id', 'cc-commit', 'cc-tree', 'sub2api-commit', 'sub2api-tree', 'plan-sha256', 'toolchain-digest']
    for (const key of required) if (!values[key]) throw new Phase3AError('invalid_arguments', `--${key} is required`)
    runActiveLocalTlsConnectObservation({
      evidence_root: values['evidence-root'], out_relative: values['out-relative'], entrypoint: path.resolve(values.entrypoint), run_id: values['run-id'],
      cc_commit: values['cc-commit'], cc_tree: values['cc-tree'], sub2api_commit: values['sub2api-commit'], sub2api_tree: values['sub2api-tree'], plan_sha256: values['plan-sha256'], toolchain_digest: values['toolchain-digest'],
    }).then((summary) => process.stdout.write(`${canonicalJson(summary)}\n`)).catch((error) => {
      process.stderr.write(`${canonicalJson(stableError(error))}\n`)
      process.exitCode = 1
    })
  } catch (error) {
    process.stderr.write(`${canonicalJson(stableError(error))}\n`)
    process.exitCode = 1
  }
}
