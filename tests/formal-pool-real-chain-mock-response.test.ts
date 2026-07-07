import { strict as assert } from 'assert'
import { createHmac } from 'crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { baseConfig, close, finish, httpJson, listen, serverUrl, startFakeUpstream, test } from './helpers.js'
import { startProxy } from '../src/proxy.js'

console.log('\ntests/formal-pool-real-chain-mock-response.test.ts')

const attestationSecret = 'scheduler-hmac-material-v1-local-safe-fixture-123456'
const internalControlToken = 'internal-control-material-v1-local-safe-fixture-123456'
const controlToken = 'sidecar-control-material-v1-local-safe-fixture-123456'
const proxyBindingSecret = 'proxy-binding-material-v1-local-safe-fixture-123456'
const expectedTLSProfileRef = 'tls-profile:claude-code-2.1.179-real-oracle-tcp-v1'
const expectedTLSBucket = 'tls-bucket:claude-code-real-oracle-2179'
const sessionId = '123e4567-e89b-42d3-a456-426614174999'

function canonicalFormalPoolContext(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = value[key]
    return acc
  }, {} as Record<string, unknown>))
}

function signedFormalPoolHeaders(context: Record<string, unknown>) {
  const canonical = canonicalFormalPoolContext(context)
  return {
    'x-cc-formal-pool-context': Buffer.from(canonical, 'utf-8').toString('base64url'),
    'x-cc-formal-pool-signature': `hmac-sha256:${createHmac('sha256', attestationSecret).update(canonical).digest('hex')}`,
  }
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

function formalPoolContext(overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    route_class: 'messages',
    path: '/v1/messages',
    account_id: 'account-a',
    token_type: 'oauth',
    credential_ref: 'opaque:credential-ref:v1:cred-a',
    credential_source: 'server_account_credentials',
    egress_bucket: 'bucket-a',
    proxy_identity_ref: 'opaque:proxy-ref:v1:bucket-a',
    egress_tls_profile_ref: expectedTLSProfileRef,
    policy_version: '2.1.179',
    persona_profile: 'claude-code-2.1.179-macos-local',
    session_id: sessionId,
    timestamp_ms: Date.now(),
    nonce: `real-chain-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    trusted_egress_profile_ref: 'strip_attribution',
    profile_policy_version: 'claude_code_2_1_179_cp1_degraded_v1',
    billing_shape_policy: 'strip',
    request_shape_profile_ref: 'claude_code_2_1_179_messages_streaming_tooldefs_degraded_v1',
    cache_parity_profile_ref: 'claude_code_2_1_179_cache_parity_degraded_v1',
    env_residue_profile_ref: 'env-residue-profile:claude-code-2.1.179-us-pacific-official-anthropic-v1',
    locale_profile_ref: 'locale-profile:us-pacific-v1',
    base_url_residue_profile_ref: 'base-url-residue-profile:official-anthropic-v1',
    observed_client_profile: {
      schema_version: 'observed_client_profile.v1',
      cli_version_bucket: '2.1.179',
      route_class: 'messages',
      billing_shape: 'cch_present',
      billing_block_count: 1,
      cc_entrypoint_bucket: 'sdk-cli',
      top_level_body_keys: ['max_tokens', 'messages', 'metadata', 'model', 'stream', 'system', 'tools'],
      tool_count: 1,
      stream: true,
      thinking_present: false,
      output_config_present: false,
      context_management_present: false,
    },
    ...overrides,
  }
}

function gatewayConfig(upstreamUrl: string, sidecarUrl: string) {
  return baseConfig({
    mode: 'sub2api',
    upstream: { url: upstreamUrl },
    auth: { gateway_token: 'gateway-token', internal_control_token: internalControlToken, tokens: [] },
    oauth: undefined,
    shared_pool: {
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:test',
      context_attestation_secret: attestationSecret,
      upstream_mode: 'local-capture',
      egress_tls: { enabled: true, strict: true },
      billing_cch_mode: 'strip',
    },
    egress_tls_sidecar: {
      enabled: true,
      endpoint: sidecarUrl,
      control_token: controlToken,
      proxy_binding_secret: proxyBindingSecret,
      allowed_target_hosts: ['api.anthropic.com'],
      logical_target_host: 'api.anthropic.com',
      allowed_routes: ['/v1/messages'],
      allowed_profile_refs: [expectedTLSProfileRef],
      expected_tls_summary_bucket: expectedTLSBucket,
      mock_messages_response: { enabled: true, mode: 'local_smoke' },
    },
    tls_profiles: {
      'claude-code-real-oracle-2179': {
        profile_ref: expectedTLSProfileRef,
        source: 'observed-oracle-63',
        enabled: true,
      },
    },
    account_identities: {
      'account-a': {
        device_id: 'b'.repeat(64),
        account_uuid_ref: 'hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        account_ref: 'hmac-sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        credential_ref: 'opaque:credential-ref:v1:cred-a',
        credential_binding_hmac: credentialBindingHmac('Bearer fixture'),
        persona_variant: 'claude-code-2.1.179-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.179',
      },
    },
    egress_buckets: {
      'bucket-a': {
        enabled: true,
        proxy_url: 'http://127.0.0.1:9',
        proxy_identity_ref: 'opaque:proxy-ref:v1:bucket-a',
        allowed_account_ids: ['account-a'],
        tls_profile_ref: expectedTLSProfileRef,
      },
    },
    env: { ...baseConfig().env, version: '2.1.179', version_base: '2.1.179' },
  } as any)
}

type SidecarCapture = { control: any; body: string }

async function startMockSidecar() {
  const captured: SidecarCapture[] = []
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const control = JSON.parse(String(req.headers['x-cc-egress-control'] || '{}'))
      captured.push({ control, body: body.toString('utf-8') })
      res.writeHead(200, {
        'content-type': 'application/json',
        'x-cc-egress-tls-summary-bucket': expectedTLSBucket,
      })
      res.end(JSON.stringify({ ok: true }))
    })
  })
  await listen(server)
  const { port } = server.address() as AddressInfo
  return { server, captured, url: `http://127.0.0.1:${port}` }
}

function headers(contextOverrides: Record<string, unknown> = {}) {
  const context = formalPoolContext(contextOverrides)
  return {
    'x-cc-gateway-token': 'gateway-token',
    'x-cc-provider': 'anthropic',
    'x-cc-account-id': 'account-a',
    'x-cc-token-type': 'oauth',
    'x-cc-credential-ref': 'opaque:credential-ref:v1:cred-a',
    'x-cc-egress-bucket': 'bucket-a',
    'x-cc-policy-version': String(context.policy_version),
    'x-claude-code-session-id': sessionId,
    authorization: 'Bearer fixture',
    ...signedFormalPoolHeaders(context),
  }
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    model: 'claude-sonnet-4-6',
    max_tokens: 32,
    stream: true,
    metadata: { user_id: JSON.stringify({ session_id: sessionId }) },
    system: [
      { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.179.abc; cc_entrypoint=sdk-cli; cch=12345;' },
      { type: 'text', text: 'safe system fixture' },
    ],
    tools: [{ name: 'fixture_tool', description: 'fixture', input_schema: { type: 'object', properties: {} } }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'synthetic user fixture' }] }],
    ...overrides,
  }
}

test('real-chain mock bridge returns Messages response after sidecar proof and strips billing attribution', async () => {
  const upstream = await startFakeUpstream()
  const sidecar = await startMockSidecar()
  const gateway = startProxy(gatewayConfig(upstream.url, sidecar.url))
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: headers(),
      body: body(),
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 0)
    assert.equal(sidecar.captured.length, 1)
    assert.equal(sidecar.captured[0].control.target_host, 'api.anthropic.com')
    assert.doesNotMatch(sidecar.captured[0].body, /x-anthropic-billing-header/i)
    assert.doesNotMatch(sidecar.captured[0].body, /\bcch=/i)
    assert.equal(response.headers['x-cc-egress-tls-summary-bucket'], expectedTLSBucket)
    assert.equal(response.headers['x-cc-mock-response-schema-bucket'], 'anthropic-messages:synthetic-local-smoke-v1')
    assert.equal(response.json.type, 'message')
    assert.equal(response.json.role, 'assistant')
    assert.equal(response.json.content?.[0]?.type, 'text')
    assert.doesNotMatch(response.body, /synthetic user fixture/i)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(sidecar.server)
  }
})

test('real-chain mock bridge fail-closed cases stop before sidecar', async () => {
  const cases = [
    {
      name: 'non-streaming',
      path: '/v1/messages?beta=true',
      headers: headers(),
      body: body({ stream: false }),
      code: 'formal_pool_non_streaming_profile_unapproved',
    },
    {
      name: 'mcp-configured',
      path: '/v1/messages?beta=true',
      headers: headers(),
      body: body({ mcp_config: { enabled: true } }),
      code: 'formal_pool_mcp_legacy_shape_unapproved',
    },
    {
      name: 'sonnet5-2179',
      path: '/v1/messages?beta=true',
      headers: headers(),
      body: body({ model: 'claude-sonnet-5' }),
      code: 'formal_pool_model_version_unsupported',
    },
    {
      name: 'count-tokens',
      path: '/v1/messages/count_tokens?beta=true',
      headers: headers({ route_class: 'count_tokens', path: '/v1/messages/count_tokens' }),
      body: body(),
      code: 'formal_pool_count_tokens_profile_unapproved',
    },
    {
      name: 'control-plane',
      path: '/v1/models?beta=true',
      headers: headers({ route_class: 'control_plane', path: '/v1/models' }),
      body: body(),
      code: 'formal_pool_control_plane_unapproved',
    },
  ]

  for (const tc of cases) {
    const upstream = await startFakeUpstream()
    const sidecar = await startMockSidecar()
    const gateway = startProxy(gatewayConfig(upstream.url, sidecar.url))
    try {
      const response = await httpJson(serverUrl(gateway, tc.path), { headers: tc.headers, body: tc.body })
      assert.equal(response.status, 403, `${tc.name}: ${response.body}`)
      assert.equal(response.headers['x-cc-gateway-error-code'], tc.code, tc.name)
      assert.equal(sidecar.captured.length, 0, tc.name)
      assert.equal(upstream.captured.length, 0, tc.name)
    } finally {
      await close(gateway)
      await close(upstream.server)
      await close(sidecar.server)
    }
  }
})

test('real-chain mock bridge sanitizes structural env residue before sidecar', async () => {
  const upstream = await startFakeUpstream()
  const sidecar = await startMockSidecar()
  const gateway = startProxy(gatewayConfig(upstream.url, sidecar.url))
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: headers(),
      body: body({ anthropic_base_url: 'https://synthetic.invalid' }),
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 0)
    assert.equal(sidecar.captured.length, 1)
    assert.doesNotMatch(sidecar.captured[0].body, /synthetic\.invalid/i)
    assert.doesNotMatch(sidecar.captured[0].body, /anthropic_base_url/i)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(sidecar.server)
  }
})

await finish()
