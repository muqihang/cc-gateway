import { strict as assert } from 'assert'
import { createHmac } from 'crypto'
import { startProxy } from '../src/proxy.js'
import { baseConfig, close, finish, httpJson, serverUrl, startFakeConnectProxy, startFakeUpstream, test } from './helpers.js'

console.log('\ntests/claude-code-future-version-compat.test.ts')

const attestationSecret = 'future-compat-attestation-local-safe-fixture'
const sessionId = '123e4567-e89b-42d3-a456-426614174181'
const downstreamAuthHeaderName = 'authorization'
const downstreamAuthHeaderValue = ['Bearer', 'selected-token'].join(' ')

function canonicalContext(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = value[key]
    return acc
  }, {} as Record<string, unknown>))
}

function credentialBindingHmac(rawCredential: string) {
  return `hmac-sha256:${createHmac('sha256', attestationSecret)
    .update('formal_pool_credential_binding_v1')
    .update('\0')
    .update('oauth')
    .update('\0')
    .update(rawCredential)
    .digest('hex')}`
}

function contextFor(version: string, overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    route_class: 'messages',
    path: '/v1/messages',
    account_id: 'account-a',
    token_type: 'oauth',
    credential_ref: 'opaque:credential-ref:v1:future-compat',
    credential_source: 'server_account_credentials',
    egress_bucket: 'bucket-a',
    proxy_identity_ref: 'opaque:proxy-ref:v1:bucket-a',
    policy_version: '2.1.179',
    persona_profile: 'claude-code-2.1.179-macos-local',
    trusted_egress_profile_ref: 'strip_attribution',
    profile_policy_version: 'claude_code_2_1_179_cp1_degraded_v1',
    billing_shape_policy: 'strip',
    request_shape_profile_ref: 'claude_code_2_1_179_messages_streaming_tooldefs_degraded_v1',
    cache_parity_profile_ref: 'claude_code_2_1_179_cache_parity_degraded_v1',
    observed_client_profile: {
      schema_version: 'observed_client_profile.v1',
      cli_version_bucket: version,
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
    session_id: sessionId,
    timestamp_ms: Date.now(),
    nonce: `future-compat-${version}-${Date.now()}`,
    ...overrides,
  }
}

function signedHeaders(context: Record<string, unknown>) {
  const canonical = canonicalContext(context)
  return {
    'x-cc-gateway-token': 'gateway-token',
    'x-cc-provider': 'anthropic',
    'x-cc-account-id': String(context.account_id),
    'x-cc-token-type': 'oauth',
    'x-cc-credential-ref': String(context.credential_ref),
    'x-cc-egress-bucket': String(context.egress_bucket),
    'x-cc-policy-version': '2.1.179',
    'x-claude-code-session-id': sessionId,
    [downstreamAuthHeaderName]: downstreamAuthHeaderValue,
    'x-cc-formal-pool-context': Buffer.from(canonical, 'utf-8').toString('base64url'),
    'x-cc-formal-pool-signature': `hmac-sha256:${createHmac('sha256', attestationSecret).update(canonical).digest('hex')}`,
  }
}

function gatewayConfig(upstreamUrl: string, proxyUrl: string) {
  return baseConfig({
    mode: 'sub2api',
    upstream: { url: upstreamUrl },
    auth: { gateway_token: 'gateway-token', internal_control_token: 'internal-control-local-safe-fixture', tokens: [] },
    oauth: undefined,
    env: { ...baseConfig().env, version: '2.1.179', version_base: '2.1.179' },
    shared_pool: {
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:future-compat',
      context_attestation_secret: attestationSecret,
      billing_cch_mode: 'strip',
    },
    account_identities: {
      'account-a': {
        device_id: 'b'.repeat(64),
        account_uuid_hash: 'hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        email_hash: 'hmac-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        account_hash: 'hmac-sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        credential_ref: 'opaque:credential-ref:v1:future-compat',
        credential_binding_hmac: credentialBindingHmac(downstreamAuthHeaderValue),
        persona_variant: 'claude-code-2.1.179-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.179',
      },
    },
    egress_buckets: {
      'bucket-a': {
        enabled: true,
        proxy_url: proxyUrl,
        proxy_identity_hash: 'opaque:proxy-ref:v1:bucket-a',
        allowed_account_ids: ['account-a'],
      },
    },
  } as any)
}

function nativeLikeBody(version: string, overrides: Record<string, unknown> = {}) {
  return {
    model: 'claude-sonnet-4-6',
    max_tokens: 32,
    metadata: { user_id: JSON.stringify({ session_id: sessionId }) },
    stream: true,
    system: [
      { type: 'text', text: `x-anthropic-billing-header: cc_version=${version}.abc; cc_entrypoint=sdk-cli; cch=<redacted>;` },
      { type: 'text', text: 'safe system fixture' },
    ],
    tools: [{ name: 'fixture_tool', description: 'fixture', input_schema: { type: 'object', properties: {} } }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'local fixture' }] }],
    ...overrides,
  }
}

test('2.1.181 and 2.1.195 observed profiles pass only through strip_attribution and strip billing markers', async () => {
  for (const version of ['2.1.181', '2.1.195']) {
    const upstream = await startFakeUpstream()
    const proxy = await startFakeConnectProxy()
    const gateway = startProxy(gatewayConfig(upstream.url, proxy.url))
    try {
      const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
        headers: signedHeaders(contextFor(version)),
        body: nativeLikeBody(version),
      })
      assert.equal(response.status, 200, version)
      assert.equal(upstream.captured.length, 1, version)
      assert.doesNotMatch(upstream.captured[0].body, /x-anthropic-billing-header/i, version)
      assert.doesNotMatch(upstream.captured[0].body, /\bcch=/i, version)
    } finally {
      await close(gateway)
      await close(upstream.server)
      await close(proxy.server)
    }
  }
})

test('unapproved named future observed profile fails closed even under strip_attribution', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(gatewayConfig(upstream.url, proxy.url))
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: signedHeaders(contextFor('2.1.200')),
      body: nativeLikeBody('2.1.200'),
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'formal_pool_observed_client_profile_unapproved')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('2.1.181 and 2.1.195 observed profiles cannot self-promote to optional CCH profiles', async () => {
  const cases = [
    { ref: 'claude_code_2_1_179_first_party_signed_cch', policy: 'signed_cch' },
    { ref: 'claude_code_2_1_179_custom_base_no_cch', policy: 'no_cch' },
  ]
  for (const version of ['2.1.181', '2.1.195']) {
    for (const tc of cases) {
      const upstream = await startFakeUpstream()
      const proxy = await startFakeConnectProxy()
      const gateway = startProxy(gatewayConfig(upstream.url, proxy.url))
      try {
        const context = contextFor(version, {
          trusted_egress_profile_ref: tc.ref,
          billing_shape_policy: tc.policy,
        })
        const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
          headers: signedHeaders(context),
          body: nativeLikeBody(version),
        })
        assert.equal(response.status, 403, `${version}:${tc.policy}`)
        assert.equal(response.headers['x-cc-gateway-error-code'], 'formal_pool_observed_client_profile_unapproved', `${version}:${tc.policy}`)
        assert.equal(upstream.captured.length, 0, `${version}:${tc.policy}`)
      } finally {
        await close(gateway)
        await close(upstream.server)
        await close(proxy.server)
      }
    }
  }
})

await finish()
