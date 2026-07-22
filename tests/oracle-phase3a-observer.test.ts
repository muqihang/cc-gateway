import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { connect } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { canonicalJson, sha256Bytes, sha256File } from '../tools/oracle-lab/phase3a/core.js'
import { baselineEnvironmentSelection } from '../tools/oracle-lab/phase3a/baseline-cell.js'
import { assertControlForInstrumentation, buildIsolatedEnvironment, type LaunchManifest, validateLaunchManifest } from '../tools/oracle-lab/phase3a/launch-manifest.js'
import { startConnectProxy } from '../tools/oracle-lab/phase3a/observers/connect-proxy.js'
import { startFakeUpstream } from '../tools/oracle-lab/phase3a/observers/fake-upstream.js'
import { descendants, enforceProcessLimits } from '../tools/oracle-lab/phase3a/process-sampler.js'
import { assertGuardAuthority, buildCellSandboxProfile, classifySafeErrorText, evaluateCellCounters, extractSafeErrorTerms, fingerprintSafeErrorText, runCell, runCellGuardSelfTest } from '../tools/oracle-lab/phase3a/run-cell.js'

console.log('\ntests/oracle-phase3a-observer.test.ts')

assert.deepEqual(baselineEnvironmentSelection({}), { tz: 'UTC', lang: 'C', lc_all: 'C' })
assert.deepEqual(baselineEnvironmentSelection({ tz: 'Asia/Shanghai', lang: 'zh_CN.UTF-8', lc_all: 'zh_CN.UTF-8' }), { tz: 'Asia/Shanghai', lang: 'zh_CN.UTF-8', lc_all: 'zh_CN.UTF-8' })
assert.throws(() => baselineEnvironmentSelection({ tz: '../unsafe' }), (error: any) => error.code === 'invalid_matrix_value')

const diagnosticMarker = 'synthetic-private-diagnostic-marker'
const diagnostic = fingerprintSafeErrorText(Buffer.from(`Error: ${diagnosticMarker}\n`, 'utf8'))
assert.equal(diagnostic.utf8_valid, true)
assert.equal(diagnostic.line_count, 2)
assert.equal(diagnostic.tokens.length, 5)
assert.ok(diagnostic.tokens.every((token) => /^[a-f0-9]{64}$/.test(token.sha256)))
assert.equal(JSON.stringify(diagnostic).includes(diagnosticMarker), false)

const sha = 'a'.repeat(64)
const commit = 'b'.repeat(40)
function fixture(runId: string, port: number): LaunchManifest {
  return {
    schema_version: 'oracle-lab-phase3a-launch-manifest.v1', run_id: runId, parent_run_id: null, pair_id: 'pair-observer', sequence_index: 0, randomization_seed: 17,
    phase: '3A', requirement_ids: ['HA-P1-001'], hypothesis_id: 'observer-self-test', evidence_level_ceiling: 'Observed',
    repositories: { cc_gateway: { commit, tree: commit, dirty_digest: sha }, sub2api: { commit, tree: commit, dirty_digest: sha } },
    contract: { bundle_id: 'oracle.compatibility.v1', bundle_sha256: sha, schema_range: '1:0-0', predecessor_sha256: sha },
    artifact: { package: '@anthropic-ai/claude-code', version: '2.1.215', registry_url: 'https://registry.npmjs.org/', archive_sha256: sha, tree_sha256: sha, entrypoint_sha256: sha },
    toolchain_digest: sha, platform: { os: 'darwin', release: 'test', arch: 'arm64', runtime: 'native', virtualization: 'synthetic-test' },
    command: { executable_sha256: sha, argv: ['--synthetic'], cwd: `runs/${runId}/cwd`, stdin_sha256: sha, timeout_ms: 1000 },
    environment: { allowlist: { PATH: '/usr/bin:/bin' }, explicit_empty: [], unset: ['ANTHROPIC_API_KEY'], home: `runs/${runId}/home`, xdg: `runs/${runId}/xdg`, tmp: `runs/${runId}/tmp`, tz: 'UTC', lang: 'C', lc_all: 'C', base_urls: [`http://127.0.0.1:${port}/`] },
    network: { policy: 'declared_loopback_only', loopback_ports: [port], proxy_mode: 'none', ca_sha256: null, external_socket_budget: 0 },
    matrix: { changed_variable: 'instrumentation', control_value: 'none', treatment_value: 'preload', fixed_variables: { synthetic: true } },
    limits: { wall_ms: 1000, cpu_ms: 1000, rss_bytes: 64 * 1024 * 1024, output_bytes: 64 * 1024, processes: 2, retries: 0, sockets: 2, files: 32 },
    capture: { hook: false, inspector: false, process: true, fs: true, network: true, tls: false, http: true, pcap: false, stdout: true, stderr: true },
    redaction_policy: 'oracle-lab-phase3a-redaction.v1', retention_class: 'synthetic-raw-14d', expiry: '2026-08-03T00:00:00.000Z', previous_manifest_sha256: null,
    preflight: { status: 'PASS', cc_head: commit, cc_tree: commit, sub2api_head: commit, sub2api_tree: commit, plan_sha256: sha, p2_bundle_sha256: sha, predecessor_sha256: sha, codegraph_current: true },
  }
}

const upstream = await startFakeUpstream({ scenario: { kind: 'sse', events: [{ event: 'message_start', data: { secret: 'synthetic prompt material' } }, { event: 'message_stop', data: { done: true } }] } })
try {
  const response = await new Promise<string>((resolve, reject) => {
    const req = request(`${upstream.url}v1/messages?token=must-not-persist`, { method: 'POST', headers: { authorization: 'Synthetic placeholder material', 'content-type': 'application/json' } }, (res) => {
      let body = ''; res.on('data', (chunk) => { body += chunk.toString('utf8') }); res.on('end', () => resolve(body))
    })
    req.on('error', reject); req.end(JSON.stringify({ system: 'raw synthetic prompt', messages: [{ content: 'private body' }] }))
  })
  assert.match(response, /message_start/)
  assert.equal(upstream.events.length, 1)
  const persistedShape = JSON.stringify(upstream.events)
  assert.doesNotMatch(persistedShape, /raw synthetic prompt|private body|placeholder material|must-not-persist/)
  assert.equal(upstream.events[0].header_value_classes.authorization, 'present-redacted')
  assert.equal(upstream.events[0].path_class, '/v1/messages')
} finally { await upstream.close() }

const proxy = await startConnectProxy({ allowed_targets: [{ host: 'api.synthetic.test', port: 443 }] })
try {
  const exchange = (authority: string) => new Promise<string>((resolve, reject) => {
    const socket = connect(proxy.port, '127.0.0.1'); let output = ''
    socket.on('connect', () => socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`))
    socket.on('data', (chunk) => { output += chunk.toString('ascii') }); socket.on('end', () => resolve(output)); socket.on('error', reject)
  })
  assert.match(await exchange('api.synthetic.test:443'), /200 Connection Established/)
  assert.match(await exchange('1.1.1.1:443'), /403 Forbidden/)
  assert.deepEqual(proxy.events.map((event) => event.decision), ['accepted-local-termination', 'rejected'])
  assert.doesNotMatch(JSON.stringify(proxy.events), /api\.synthetic\.test|1\.1\.1\.1/)
} finally { await proxy.close() }

const manifest = validateLaunchManifest(fixture('control', 19001))
assert.throws(() => validateLaunchManifest({ ...manifest, environment: { ...manifest.environment, base_urls: ['https://example.com/'] } }), /phase3a_schema_invalid/)
assert.throws(() => validateLaunchManifest({ ...manifest, environment: { ...manifest.environment, allowlist: { PATH: '/usr/bin', NODE_OPTIONS: '--require=x' } } }), /cannot be inherited/)
assert.throws(() => validateLaunchManifest({ ...manifest, environment: { ...manifest.environment, allowlist: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'not-a-placeholder' } } }), /placeholder namespace/)
assert.throws(() => validateLaunchManifest({ ...manifest, environment: { ...manifest.environment, allowlist: { PATH: '/usr/bin', ANTHROPIC_AUTH_TOKEN: 'not-a-placeholder' } } }), /placeholder namespace/)
assert.throws(() => validateLaunchManifest({ ...manifest, environment: { ...manifest.environment, allowlist: { PATH: '/usr/bin', CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR: '3' } } }), /not admitted/)
validateLaunchManifest({ ...manifest, environment: { ...manifest.environment, allowlist: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'oracle-phase3a-placeholder:api-key', HTTPS_PROXY: 'http://127.0.0.1:19001/' } } })
assert.throws(() => validateLaunchManifest({ ...manifest, environment: { ...manifest.environment, allowlist: { PATH: '/usr/bin', HTTPS_PROXY: 'http://192.0.2.1:19001/' } } }), /declared loopback port/)
assert.throws(() => assertControlForInstrumentation({ ...manifest, run_id: 'instrumented' }, null, 'preload'), /requires an uninstrumented control/)
assertControlForInstrumentation({ ...manifest, run_id: 'instrumented' }, manifest, 'preload')

const evidenceRoot = mkdtempSync(path.join(os.tmpdir(), 'phase3a-observer-test-'))
const isolated = buildIsolatedEnvironment(manifest, evidenceRoot)
assert.equal(isolated.env.CLAUDE_CODE_TMPDIR, isolated.directories.tmp)
assert.ok(classifySafeErrorText("EPERM: operation not permitted, mkdir '/tmp/claude-501'").includes('filesystem'))
assert.deepEqual(extractSafeErrorTerms("EPERM: operation not permitted, mkdir '/tmp/claude-501'"), ['eperm', 'mkdir', 'permitted'])
assert.equal(isolated.env.HOME, isolated.directories.home)
assert.equal(path.isAbsolute(isolated.directories.cwd), true)
assert.equal(isolated.env.ANTHROPIC_API_KEY, undefined)
assert.equal(isolated.env.SSH_AUTH_SOCK, undefined)
const profile = buildCellSandboxProfile(manifest, evidenceRoot)
const guard = {
  schema_version: 'oracle-lab-phase3a-cell-guard.v1' as const, status: 'PASS' as const, profile_sha256: sha256Bytes(profile), manifest_sha256: sha256Bytes(JSON.stringify(manifest)), allowed_loopback_ports: [19001], external_socket_budget: 0 as const, same_scope_probe: true as const,
  probe: { declared_loopback_reachable: true, alternate_loopback_blocked: true, unix_socket_blocked: true, ipv4_external_tcp_blocked: true, ipv6_external_tcp_blocked: true, external_udp_blocked: true, inside_root_write_allowed: true, outside_root_write_blocked: true },
}
assert.throws(() => assertGuardAuthority(manifest, guard, profile), /exact launch manifest/)
assertGuardAuthority(manifest, { ...guard, manifest_sha256: sha256Bytes(canonicalJson(manifest)) }, profile)

assert.deepEqual([...descendants([{ pid: 10, ppid: 1 }, { pid: 11, ppid: 10 }, { pid: 12, ppid: 11 }, { pid: 20, ppid: 1 }], 10)].sort(), [10, 11, 12])
assert.equal(enforceProcessLimits([{ sequence: 0, monotonic_ns: '1', pid: 1, ppid: 0, rss_bytes: 2, cpu_ms: 1, executable_sha256: null, executable_class: 'root' }], { processes: 1, rss_bytes: 1, cpu_ms: 2 }), 'rss_limit')
assert.equal(evaluateCellCounters({ output_bytes: 65_537, processes: 1, retries: 0, sockets: 1 }, manifest.limits), 'output_limit')
assert.equal(evaluateCellCounters({ output_bytes: 1, processes: 3, retries: 0, sockets: 1 }, manifest.limits), 'process_limit')
assert.equal(evaluateCellCounters({ output_bytes: 1, processes: 1, retries: 1, sockets: 1 }, manifest.limits), 'retry_limit')
assert.equal(evaluateCellCounters({ output_bytes: 1, processes: 1, retries: 0, sockets: 3 }, manifest.limits), 'socket_limit')
assert.deepEqual(classifySafeErrorText('invalid API key; connection denied'), ['authentication', 'permission', 'request-shape', 'transport'])
assert.deepEqual(classifySafeErrorText('unrecognized failure text'), ['unknown'])
assert.deepEqual(extractSafeErrorTerms('Error: session UUID invalid; raw detail hidden'), ['error', 'invalid', 'session', 'uuid'])

const hookOutput = path.join(evidenceRoot, 'hook.jsonl')
const preload = path.resolve('tools/oracle-lab/phase3a/hooks/preload.cjs')
await new Promise<void>((resolve, reject) => {
  const child = spawn(process.execPath, ['--require', preload, '-e', "require('node:fs').readFileSync(process.execPath); fetch('data:text/plain,synthetic')"], { env: { PATH: process.env.PATH, ORACLE_PHASE3A_HOOK_OUTPUT: hookOutput }, stdio: 'ignore' })
  child.on('error', reject); child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`hook child exit ${code}`)))
})
const hookText = readFileSync(hookOutput, 'utf8')
assert.match(hookText, /hook.ready/)
assert.match(hookText, /fs.readFileSync/)
assert.doesNotMatch(hookText, /data:text|synthetic/)
assert.equal(sha256File(preload).length, 64)

const anthropic = await startFakeUpstream({ scenario: { kind: 'anthropic' } })
try {
  const response = await new Promise<string>((resolve, reject) => {
    const req = request(`${anthropic.url}v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let body = ''; res.on('data', (chunk) => { body += chunk.toString('utf8') }); res.on('end', () => resolve(body))
    })
    req.on('error', reject); req.end(JSON.stringify({ model: 'synthetic-model', stream: true, system: [{ type: 'text', text: 'synthetic system', cache_control: { type: 'ephemeral' } }], messages: [] }))
  })
  assert.match(response, /message_start/)
  assert.equal(anthropic.events[0].response_class, 'anthropic:sse')
  assert.equal(anthropic.events[0].request_class, 'messages')
  assert.equal(anthropic.events[0].system_summary.status, 'observed')
  assert.ok(anthropic.events[0].system_summary.span_hashes.length >= 2)
  assert.equal(anthropic.events[0].cch_class, 'body-cache-control')
  assert.doesNotMatch(canonicalJson(anthropic.events), /synthetic-model/)
  assert.doesNotMatch(canonicalJson(anthropic.events), /synthetic system|ephemeral/)
} finally { await anthropic.close() }

if (process.platform === 'darwin') {
  const guardedUpstream = await startFakeUpstream({ scenario: { kind: 'json', response: { synthetic: true } } })
  try {
    const syntheticManifest = fixture('synthetic-runner', guardedUpstream.port)
    syntheticManifest.command = {
      executable_sha256: sha256File(process.execPath),
      argv: ['-e', `require('node:http').get(${JSON.stringify(guardedUpstream.url)},r=>{r.resume();r.on('end',()=>process.stdout.write('synthetic-ok'))}).on('error',()=>process.exit(2))`],
      cwd: 'runs/synthetic-runner/cwd', stdin_sha256: sha256Bytes(new Uint8Array()), timeout_ms: 5000,
    }
    syntheticManifest.limits = { ...syntheticManifest.limits, wall_ms: 5000, cpu_ms: 5000, processes: 4, sockets: 4, files: 64 }
    const authority = await runCellGuardSelfTest(syntheticManifest, evidenceRoot)
    const result = await runCell({ manifest: syntheticManifest, evidence_root: evidenceRoot, executable: process.execPath, instrumentation: 'none', guard: authority })
    assert.equal(result.status, 'complete', JSON.stringify(result))
    assert.equal(result.raw_output_persisted, false)
    assert.equal(result.stdout.bytes, Buffer.byteLength('synthetic-ok'))
  } finally { await guardedUpstream.close() }
}

console.log(JSON.stringify({ ok: true, observer_events: 3, raw_material_persisted: false }))
