import { strict as assert } from 'assert'
import { createHmac } from 'crypto'
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createServer } from 'net'
import { once } from 'events'
import type { AddressInfo, Socket } from 'net'
import { mkdtempSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { baseConfig, close, httpJson, listen, serverUrl, startFakeUpstream, test } from './helpers.js'
import { startProxy } from '../src/proxy.js'

console.log('\ntests/egress-tls-sidecar-real.test.ts')

const repoRoot = new URL('..', import.meta.url).pathname
const sidecarDir = join(repoRoot, 'sidecar/egress-tls-sidecar')
const fixturePath = '/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/claude-platform-aws-formal-pool/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json'
const controlToken = 'sidecar-control-material-v1-local-safe-fixture-123456'
const expectedTLSBucket = 'tls-bucket:claude-code-real-oracle-2179'

function base64url(value: string): string { return Buffer.from(value, 'utf8').toString('base64url') }
function canonical(value: Record<string, unknown>): string { return JSON.stringify(Object.keys(value).sort().reduce((acc, key) => { acc[key] = value[key]; return acc }, {} as Record<string, unknown>)) }
function hmac(value: string, secret: string): string { return createHmac('sha256', secret).update(value).digest('hex') }
function credentialBinding(raw: string, secret: string): string {
  return `hmac-sha256:${createHmac('sha256', secret).update('formal_pool_credential_binding_v1').update('\0').update('oauth').update('\0').update(raw).digest('hex')}`
}

async function startClientHelloCollector() {
  const captured: Buffer[] = []
  const server = createServer((socket: Socket) => {
    socket.once('data', (chunk) => {
      captured.push(Buffer.from(chunk))
      socket.destroy()
    })
  })
  await listen(server as any)
  const { port } = server.address() as AddressInfo
  return { server, captured, address: `127.0.0.1:${port}` }
}

async function startRealSidecar(collectorAddress: string, egressBucket: string, proxyRef: string) {
  const listenAddress = '127.0.0.1:0'
  const binDir = mkdtempSync(join(tmpdir(), 'plan74-real-sidecar-bin-'))
  const bin = join(binDir, 'egress-tls-sidecar')
  execFileSync('go', ['build', '-o', bin, './cmd/egress-tls-sidecar'], { cwd: sidecarDir, stdio: 'ignore' })
  const proc = spawn(bin, [], {
    cwd: sidecarDir,
    env: {
      ...process.env,
      EGRESS_TLS_SIDECAR_LISTEN: listenAddress,
      EGRESS_TLS_SIDECAR_CONTROL_TOKEN: controlToken,
      EGRESS_TLS_SIDECAR_ALLOWED_EGRESS_BUCKETS: egressBucket,
      EGRESS_TLS_SIDECAR_ALLOWED_PROXY_REFS: proxyRef,
      EGRESS_TLS_SIDECAR_TEST_DIAL_OVERRIDE_API_ANTHROPIC: collectorAddress,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams
  let stderr = ''
  proc.stderr.on('data', (chunk) => { stderr += String(chunk) })
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const m = stderr.match(/listening on (127\.0\.0\.1:\d+)/)
    if (m) return { proc, url: `http://${m[1]}` }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  proc.kill('SIGKILL')
  throw new Error(`sidecar did not start: ${stderr}`)
}

async function stopProcess(proc: ChildProcessWithoutNullStreams) {
  if (proc.exitCode !== null) return
  proc.kill('SIGTERM')
  await Promise.race([once(proc, 'exit'), new Promise(resolve => setTimeout(resolve, 1000))])
  if (proc.exitCode === null) proc.kill('SIGKILL')
}

test('real Go uTLS sidecar local-only E2E proves TLS bucket before mock Messages response', async () => {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
  const collector = await startClientHelloCollector()
  const realSidecar = await startRealSidecar(collector.address, String(fixture.account.egress_bucket), String(fixture.account.proxy_identity_ref))
  const upstream = await startFakeUpstream()
  const context = {
    ...fixture.valid_context,
    timestamp_ms: Date.now(),
    nonce: `real-sidecar-${Date.now()}`,
  }
  const canonicalContext = canonical(context)
  const gateway = startProxy(baseConfig({
    upstream: { url: upstream.url },
    providers: { anthropic: true },
    auth: { gateway_token: 'gateway-token', internal_control_token: 'internal-control-material-v1-local-safe-fixture-123456', tokens: [] },
    oauth: undefined,
    logging: { level: 'error', audit: false },
    mode: 'sub2api',
    shared_pool: {
      upstream_mode: 'local-capture',
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:shared-fixture',
      context_attestation_secret: fixture.materials.context_attestation_material,
      egress_tls: { enabled: true, strict: true },
    },
    egress_tls_sidecar: {
      enabled: true,
      endpoint: realSidecar.url,
      control_token: controlToken,
      allowed_target_hosts: ['api.anthropic.com'],
      logical_target_host: 'api.anthropic.com',
      allowed_routes: ['/v1/messages'],
      allowed_profile_refs: [String(fixture.account.egress_tls_profile_ref)],
      expected_tls_summary_bucket: expectedTLSBucket,
      mock_messages_response: { enabled: true, mode: 'local_smoke' },
    },
    account_identities: {
      [String(fixture.account.account_id)]: {
        device_id: fixture.account.device_id,
        account_uuid_ref: fixture.account.account_uuid_ref,
        email_ref: fixture.account.email_ref,
        account_ref: fixture.account.account_ref,
        credential_ref: fixture.account.credential_ref,
        credential_binding_hmac: credentialBinding('Bearer fixture', fixture.materials.context_attestation_material),
        persona_variant: fixture.account.persona_profile,
        session_policy: 'preserve_downstream_session_id',
        policy_version: fixture.account.policy_version,
      },
    },
    egress_buckets: {
      [String(fixture.account.egress_bucket)]: { enabled: true, proxy_url: 'http://127.0.0.1:9', proxy_identity_ref: fixture.account.proxy_identity_ref, allowed_account_ids: [String(fixture.account.account_id)], tls_profile_ref: fixture.account.egress_tls_profile_ref },
    },
    tls_profiles: { 'shared-fixture-real-oracle-2179': { profile_ref: fixture.account.egress_tls_profile_ref, source: 'plan70-sni-oracle', enabled: true } },
    env: { ...baseConfig().env, platform: 'darwin', version: '2.1.179', version_base: '2.1.179', build_time: '2026-04-23T19:08:52Z' },
  } as any))
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-account-id': String(fixture.account.account_id),
        'x-cc-token-type': 'oauth',
        'x-cc-credential-ref': String(fixture.account.credential_ref),
        'x-cc-egress-bucket': String(fixture.account.egress_bucket),
        'x-cc-policy-version': String(fixture.account.policy_version),
        authorization: 'Bearer fixture',
        'x-claude-code-session-id': String(fixture.valid_context.session_id),
        'x-cc-formal-pool-context': base64url(canonicalContext),
        'x-cc-formal-pool-signature': `hmac-sha256:${hmac(canonicalContext, fixture.materials.context_attestation_material)}`,
      },
      body: {
        model: 'claude-sonnet-4-6',
        stream: true,
        metadata: { user_id: JSON.stringify({ session_id: fixture.valid_context.session_id }) },
        messages: [{ role: 'user', content: 'hello' }],
      },
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(response.headers['x-cc-egress-tls-summary-bucket'], expectedTLSBucket)
    assert.equal(response.headers['x-cc-mock-response-schema-bucket'], 'anthropic-messages:synthetic-local-smoke-v1')
    assert.equal(response.json?.type, 'message')
    assert.equal(response.json?.role, 'assistant')
    assert.ok(Array.isArray(response.json?.content), 'mock response must use Anthropic Messages content array')
    assert.equal(response.json?.usage?.input_tokens, 1)
    assert.equal(upstream.captured.length, 0, 'Node direct upstream fallback must be zero')
    assert.equal(collector.captured.length, 1, 'real sidecar must emit one ClientHello to local collector')
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(collector.server as any)
    await stopProcess(realSidecar.proc)
  }
})

await (await import('./helpers.js')).finish()
