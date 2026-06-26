import { strict as assert } from 'assert'
import { createHmac } from 'crypto'
import { request as httpRequest } from 'http'
import { startProxy } from '../src/proxy.js'
import { baseConfig, close, finish, httpJson, serverUrl, startFakeConnectProxy, startFakeUpstream, test } from './helpers.js'

console.log('\ntests/security-boundary.test.ts')

const ccGatewayHeaders = {
  'x-cc-account-id': 'account-a',
  'x-cc-credential-ref': 'opaque:credential-ref:v1:cred-a',
  'x-cc-egress-bucket': 'bucket-a',
  'x-cc-policy-version': '2.1.146',
}
const sessionId = '123e4567-e89b-42d3-a456-426614174999'
const attestationSecret = 'scheduler-hmac-material-v1-local-safe-fixture-123456'
const internalControlToken = 'internal-control-material-v1-local-safe-fixture-123456'

function canonicalFormalPoolContext(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = value[key]
    return acc
  }, {} as Record<string, unknown>))
}

function credentialBindingHmac(rawCredential: string, tokenType: 'oauth' | 'apikey' = 'oauth') {
  return `hmac-sha256:${createHmac('sha256', attestationSecret)
    .update('formal_pool_credential_binding_v1')
    .update('\0')
    .update(tokenType)
    .update('\0')
    .update(rawCredential)
    .digest('hex')}`
}

function signedSchedulerHeaders(headers: Record<string, string> = {}) {
  const merged = {
    ...ccGatewayHeaders,
    'x-cc-gateway-token': 'gateway-token',
    'x-cc-provider': 'anthropic',
    'x-cc-token-type': 'oauth',
    'x-claude-code-session-id': sessionId,
    ...headers,
  }
  const context = {
    method: 'POST',
    route_class: 'messages',
    path: '/v1/messages',
    account_id: merged['x-cc-account-id'],
    token_type: merged['x-cc-token-type'],
    credential_ref: merged['x-cc-credential-ref'],
    credential_source: 'server_account_credentials',
    egress_bucket: merged['x-cc-egress-bucket'],
    proxy_identity_ref: 'opaque:proxy-ref:v1:bucket-a',
    policy_version: merged['x-cc-policy-version'],
    persona_profile: 'claude-code-2.1.146-macos-local',
    session_id: merged['x-claude-code-session-id'],
    timestamp_ms: Date.now(),
    nonce: `nonce-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    trusted_egress_profile_ref: 'strip_attribution',
    profile_policy_version: 'claude_code_2_1_179_cp1_degraded_v1',
    billing_shape_policy: 'strip',
    request_shape_profile_ref: 'claude_code_2_1_179_messages_streaming_tooldefs_degraded_v1',
    cache_parity_profile_ref: 'claude_code_2_1_179_cache_parity_degraded_v1',
    observed_client_profile: {
      schema_version: 'observed_client_profile.v1',
      cli_version_bucket: 'unknown',
      route_class: 'messages',
      billing_shape: 'absent',
      billing_block_count: 0,
      cc_entrypoint_bucket: 'absent',
    },
  }
  const canonical = canonicalFormalPoolContext(context)
  return {
    ...merged,
    'x-cc-formal-pool-context': Buffer.from(canonical, 'utf-8').toString('base64url'),
    'x-cc-formal-pool-signature': `hmac-sha256:${createHmac('sha256', attestationSecret).update(canonical).digest('hex')}`,
  }
}

function sub2apiConfig(upstreamUrl: string, proxyUrl: string, overrides: Record<string, unknown> = {}) {
  return baseConfig({
    mode: 'sub2api',
    upstream: { url: upstreamUrl },
    auth: { gateway_token: 'gateway-token', internal_control_token: internalControlToken, tokens: [] },
    oauth: undefined,
    shared_pool: { context_attestation_secret_ref: 'opaque:attestation-ref:v1:test', context_attestation_secret: attestationSecret },
    account_identities: {
      'account-a': {
        device_id: 'b'.repeat(64),
        account_uuid_hash: 'hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        email_hash: 'hmac-sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        account_hash: 'hmac-sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        credential_ref: 'opaque:credential-ref:v1:cred-a',
        credential_binding_hmac: credentialBindingHmac('Bearer selected-token'),
        persona_variant: 'claude-code-2.1.146-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.146',
      },
    },
    egress_buckets: {
      'bucket-a': { enabled: true, proxy_url: proxyUrl, proxy_identity_ref: 'opaque:proxy-ref:v1:bucket-a', allowed_account_ids: ['account-a'] },
    },
    ...overrides,
  } as any)
}


test('serverUrl targets IPv6 loopback when gateway binds wildcard IPv6', async () => {
  const gateway = startProxy(baseConfig({ server: { port: 0, tls: { cert: '', key: '' } } }))

  try {
    const address = gateway.address() as any
    assert.equal(address.address, '::')
    assert.match(serverUrl(gateway, '/_health'), /^http:\/\/\[::1\]:\d+\/_health$/)
  } finally {
    await close(gateway)
  }
})

test('explicit server host binds gateway to loopback for localhost-only harnesses', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url, { server: { port: 0, host: '127.0.0.1', tls: { cert: '', key: '' } } } as any))

  try {
    await new Promise((resolve) => gateway.once('listening', resolve))
    const address = gateway.address() as any
    assert.equal(address.address, '127.0.0.1')
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('fixed upstream ignores inbound Host and Forwarded routing headers', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: signedSchedulerHeaders({
        host: 'attacker.example',
        forwarded: 'host=attacker.example;proto=https',
        'x-forwarded-host': 'attacker.example',
        authorization: 'Bearer selected-token',
      }),
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })

    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    assert.match(String(upstream.captured[0].headers.host), /^127\.0\.0\.1:\d+$/)
    assert.equal(upstream.captured[0].headers.forwarded, undefined)
    assert.equal(upstream.captured[0].headers['x-forwarded-host'], undefined)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('absolute-form URL still uses fixed upstream and route-sensitive body rewriting', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url))

  try {
    const body = JSON.stringify({
      metadata: {
        user_id: JSON.stringify({
          device_id: 'REAL_DEVICE_ID_FROM_CLIENT_abc123',
          account_uuid: 'acct-123',
        }),
      },
      messages: [{ role: 'user', content: 'hello' }],
    })
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest({
        host: (gateway.address() as any).address === '::' ? '::1' : '127.0.0.1',
        port: (gateway.address() as any).port,
        method: 'POST',
        path: 'http://attacker.example/v1/messages?beta=true',
        headers: {
          ...signedSchedulerHeaders(),
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
          authorization: 'Bearer selected-token',
        },
      }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') }))
      })
      req.on('error', reject)
      req.write(body)
      req.end()
    })

    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    assert.equal(upstream.captured[0].url, '/v1/messages?beta=true')
    const upstreamBody = JSON.parse(upstream.captured[0].body)
    const userId = JSON.parse(upstreamBody.metadata.user_id)
    assert.equal(userId.device_id, 'b'.repeat(64))
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

await finish()
