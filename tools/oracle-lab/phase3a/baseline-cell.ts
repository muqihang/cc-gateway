import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'
import { type LaunchManifest, validateLaunchManifest } from './launch-manifest.js'
import { startFakeUpstream } from './observers/fake-upstream.js'
import { runCell, runCellGuardSelfTest } from './run-cell.js'

type BaselineOptions = {
  evidence_root: string
  entrypoint: string
  out_relative: string
  run_id: string
  cc_commit: string
  cc_tree: string
  sub2api_commit: string
  sub2api_tree: string
  plan_sha256: string
  toolchain_digest: string
}

const ARTIFACT = {
  package: '@anthropic-ai/claude-code', version: '2.1.215',
  registry_url: 'https://registry.npmjs.org/@anthropic-ai%2fclaude-code/2.1.215',
  archive_sha256: '1a5cf8e491689154264c0b2f28371bf645cdee2903b45c497915868308502d7b',
  tree_sha256: '024fa410b532ced37cd9e45a95aae6f9eb22e9ce8491e1fad843f24d958f4a88',
  entrypoint_sha256: '90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58',
} as const

const P2_BUNDLE = '2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce'
const PREDECESSOR = '70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1'
const PROMPT = Buffer.from('Phase 3A synthetic loopback baseline. Reply exactly OK.', 'utf8')

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${canonicalJson(value)}\n`, { flag: 'wx', mode: 0o600 })
}

export function buildBaselineManifest(options: BaselineOptions, upstreamUrl: string, port: number): LaunchManifest {
  if (sha256File(options.entrypoint) !== ARTIFACT.entrypoint_sha256) throw new Phase3AError('executable_digest_mismatch', 'baseline entrypoint differs from the frozen artifact')
  const baseUrl = upstreamUrl.replace(/\/$/, '')
  return validateLaunchManifest({
    schema_version: 'oracle-lab-phase3a-launch-manifest.v1', run_id: options.run_id, parent_run_id: null,
    pair_id: 'active-2.1.215-loopback-baseline', sequence_index: 0, randomization_seed: 215,
    phase: '3A', requirement_ids: ['HA-P1-001', 'HA-P1-002', 'CL-PINNED-OBS-001'],
    hypothesis_id: 'active-baseline-loopback-json', evidence_level_ceiling: 'Observed',
    repositories: {
      cc_gateway: { commit: options.cc_commit, tree: options.cc_tree, dirty_digest: sha256Bytes('') },
      sub2api: { commit: options.sub2api_commit, tree: options.sub2api_tree, dirty_digest: sha256Bytes('') },
    },
    contract: { bundle_id: 'oracle.compatibility.v1', bundle_sha256: P2_BUNDLE, schema_range: '1:0-0', predecessor_sha256: PREDECESSOR },
    artifact: ARTIFACT, toolchain_digest: options.toolchain_digest,
    platform: { os: process.platform, release: os.release(), arch: process.arch, runtime: 'native', virtualization: 'host-sandbox-exec' },
    command: {
      executable_sha256: ARTIFACT.entrypoint_sha256,
      argv: ['--bare', '--print', '--output-format', 'json', '--no-session-persistence', '--session-id', '00000000-0000-4000-8000-000000000215', '--model', 'claude-sonnet-4-6', '--permission-mode', 'bypassPermissions'],
      cwd: `runs/${options.run_id}/cwd`, stdin_sha256: sha256Bytes(PROMPT), timeout_ms: 120_000,
    },
    environment: {
      allowlist: {
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TERM: 'xterm-256color',
        ANTHROPIC_BASE_URL: baseUrl, CLAUDE_CODE_API_BASE_URL: baseUrl,
        ANTHROPIC_API_KEY: 'oracle-phase3a-placeholder:baseline',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', NO_PROXY: '127.0.0.1,localhost,::1', no_proxy: '127.0.0.1,localhost,::1',
      },
      explicit_empty: [],
      unset: ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_CUSTOM_HEADERS', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR', 'AWS_BEARER_TOKEN_BEDROCK', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'SSH_AUTH_SOCK'],
      home: `runs/${options.run_id}/home`, xdg: `runs/${options.run_id}/xdg`, tmp: `runs/${options.run_id}/tmp`,
      tz: 'UTC', lang: 'C', lc_all: 'C', base_urls: [baseUrl],
    },
    network: { policy: 'declared_loopback_only', loopback_ports: [port], proxy_mode: 'none', ca_sha256: null, external_socket_budget: 0 },
    matrix: { changed_variable: 'none-baseline', control_value: null, treatment_value: null, fixed_variables: { artifact: ARTIFACT.entrypoint_sha256, model: 'claude-sonnet-4-6', prompt_sha256: sha256Bytes(PROMPT), nonessential_traffic: false } },
    limits: { wall_ms: 120_000, cpu_ms: 120_000, rss_bytes: 4 * 1024 * 1024 * 1024, output_bytes: 8 * 1024 * 1024, processes: 32, retries: 8, sockets: 16, files: 4096 },
    capture: { hook: false, inspector: false, process: true, fs: true, network: true, tls: false, http: true, pcap: false, stdout: true, stderr: true },
    redaction_policy: 'oracle-lab-phase3a-redaction.v1', retention_class: 'synthetic-raw-14d', expiry: '2026-08-03T00:00:00.000Z', previous_manifest_sha256: null,
    preflight: { status: 'PASS', cc_head: options.cc_commit, cc_tree: options.cc_tree, sub2api_head: options.sub2api_commit, sub2api_tree: options.sub2api_tree, plan_sha256: options.plan_sha256, p2_bundle_sha256: P2_BUNDLE, predecessor_sha256: PREDECESSOR, codegraph_current: true },
  })
}

export async function runBaselineCell(options: BaselineOptions): Promise<Record<string, unknown>> {
  const root = ensureEvidenceRoot(options.evidence_root)
  const output = assertEvidencePath(root, path.join(root, options.out_relative))
  mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 })
  mkdirSync(output, { mode: 0o700 })
  const upstream = await startFakeUpstream({ scenario: { kind: 'anthropic' }, max_body_bytes: 8 * 1024 * 1024 })
  try {
    const manifest = buildBaselineManifest(options, upstream.url, upstream.port)
    const guard = await runCellGuardSelfTest(manifest, root)
    writeJson(path.join(output, 'manifest.json'), manifest)
    writeJson(path.join(output, 'guard.json'), guard)
    const result = await runCell({ manifest, evidence_root: root, executable: options.entrypoint, instrumentation: 'none', guard, stdin: PROMPT })
    const observer = { schema_version: 'oracle-lab-phase3a-safe-observer.v1', raw_material_persisted: false, events: upstream.events }
    writeJson(path.join(output, 'observer.json'), observer)
    writeJson(path.join(output, 'result.json'), result)
    const summary = {
      schema_version: 'oracle-lab-phase3a-baseline-summary.v1', run_id: options.run_id,
      manifest_sha256: sha256File(path.join(output, 'manifest.json')), guard_sha256: sha256File(path.join(output, 'guard.json')),
      observer_sha256: sha256File(path.join(output, 'observer.json')), result_sha256: sha256File(path.join(output, 'result.json')),
      request_count: upstream.events.length, request_classes: upstream.events.map((event) => ({ method: event.method, path_class: event.path_class, response_class: event.response_class, body_bytes: event.body_bytes, body_sha256: event.body_sha256 })),
      status: result.status, raw_material_persisted: false, external_socket_budget: 0,
    }
    writeJson(path.join(output, 'summary.json'), summary)
    return summary
  } finally {
    await upstream.close()
  }
}

function args(argv: string[]): Record<string, string> {
  const output: Record<string, string> = {}
  const values = argv[0] === '--' ? argv.slice(1) : argv
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith('--') || !values[index + 1]) throw new Phase3AError('invalid_arguments', 'arguments must be --name value pairs')
    output[values[index].slice(2)] = values[index + 1]
  }
  return output
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const values = args(process.argv.slice(2))
    const required = ['evidence-root', 'entrypoint', 'out-relative', 'run-id', 'cc-commit', 'cc-tree', 'sub2api-commit', 'sub2api-tree', 'plan-sha256', 'toolchain-digest']
    for (const key of required) if (!values[key]) throw new Phase3AError('invalid_arguments', `--${key} is required`)
    const summary = await runBaselineCell({
      evidence_root: values['evidence-root'], entrypoint: path.resolve(values.entrypoint), out_relative: values['out-relative'], run_id: values['run-id'],
      cc_commit: values['cc-commit'], cc_tree: values['cc-tree'], sub2api_commit: values['sub2api-commit'], sub2api_tree: values['sub2api-tree'],
      plan_sha256: values['plan-sha256'], toolchain_digest: values['toolchain-digest'],
    })
    process.stdout.write(`${canonicalJson(summary)}\n`)
  } catch (error) {
    process.stderr.write(`${canonicalJson(stableError(error))}\n`)
    process.exitCode = 1
  }
}
