import { strict as assert } from 'assert'
import { startProxy } from '../src/proxy.js'
import { canonicalPersonaHeaders } from '../src/policy.js'
import { baseConfig, close, finish, httpJson, serverUrl, startFakeConnectProxy, startFakeUpstream, test } from './helpers.js'

console.log('\ntests/session-and-beta-policy.test.ts')

const validUuid = '123e4567-e89b-42d3-a456-426614174000'
const uuidV4Like = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function sharedConfig(upstreamUrl: string, proxyUrl: string, extraSharedPool: Record<string, unknown> = {}) {
  return baseConfig({
    mode: 'sub2api',
    upstream: { url: upstreamUrl },
    auth: { gateway_token: 'gateway-token', tokens: [] },
    oauth: undefined,
    env: { ...baseConfig().env, version: '2.1.146', version_base: '2.1.146' },
    shared_pool: {
      upstream_mode: 'preflight',
      billing_cch_mode: 'sign',
      signing_enabled: true,
      signing_evidence_gates_approved: true,
      ...extraSharedPool,
    },
    account_identities: {
      'account-a': {
        device_id: 'b'.repeat(64),
        account_uuid_hash: 'hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        email_hash: 'hmac-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        account_hash: 'hmac-sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        persona_variant: 'claude-code-2.1.146-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.146',
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

const sharedHeaders = {
  'x-cc-gateway-token': 'gateway-token',
  'x-cc-provider': 'anthropic',
  'x-cc-account-id': 'account-a',
  'x-cc-token-type': 'oauth',
  authorization: 'Bearer synthetic-token',
  'x-cc-egress-bucket': 'bucket-a',
  'x-cc-policy-version': '2.1.146',
}

test('shared-pool canonicalizes malformed downstream session IDs to UUID-like Claude Code shape', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sharedConfig(upstream.url, proxy.url))
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: { ...sharedHeaders, 'x-claude-code-session-id': 'short-non-uuid-session' },
      body: {
        model: 'claude-sonnet-4-6',
        max_tokens: 32,
        metadata: { user_id: JSON.stringify({ session_id: 'another-short-session' }) },
        stream: false,
        system: [],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'local fixture' }] }],
      },
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    const forwarded = upstream.captured[0]
    const headerSession = forwarded.headers['x-claude-code-session-id'] as string
    const userId = JSON.parse(JSON.parse(forwarded.body).metadata.user_id)
    assert.match(headerSession, uuidV4Like)
    assert.equal(userId.session_id, headerSession)
    assert.notEqual(headerSession, 'short-non-uuid-session')
    assert.notEqual(userId.session_id, 'another-short-session')
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})

test('shared-pool preserves valid UUID-like Claude Code session IDs', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sharedConfig(upstream.url, proxy.url))
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: { ...sharedHeaders, 'x-claude-code-session-id': validUuid },
      body: {
        model: 'claude-sonnet-4-6',
        max_tokens: 32,
        metadata: { user_id: JSON.stringify({ session_id: 'another-short-session' }) },
        stream: false,
        system: [],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'local fixture' }] }],
      },
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    const forwarded = upstream.captured[0]
    const userId = JSON.parse(JSON.parse(forwarded.body).metadata.user_id)
    assert.equal(forwarded.headers['x-claude-code-session-id'], validUuid)
    assert.equal(userId.session_id, validUuid)
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})

test('message beta policy keeps 2.1.146 baseline by default and allows 2.1.150 subscription profile', () => {
  const baseline = canonicalPersonaHeaders(sharedConfig('http://127.0.0.1:1', 'http://127.0.0.1:2'), 'messages', validUuid)
  assert.equal(baseline['anthropic-beta'], 'claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,effort-2025-11-24')

  const subscriptionProfile = canonicalPersonaHeaders(
    sharedConfig('http://127.0.0.1:1', 'http://127.0.0.1:2', { message_beta_profile: 'claude_code_2_1_150_subscription' }),
    'messages',
    validUuid,
  )
  assert.equal(subscriptionProfile['anthropic-beta'], 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advisor-tool-2026-03-01,effort-2025-11-24,extended-cache-ttl-2025-04-11')

  const firstSuccessProfile = canonicalPersonaHeaders(
    sharedConfig('http://127.0.0.1:1', 'http://127.0.0.1:2', { message_beta_profile: 'first_200_oauth_compat' }),
    'messages',
    validUuid,
  )
  assert.equal(firstSuccessProfile['anthropic-beta'], subscriptionProfile['anthropic-beta'])
})

test('message beta policy supports 2.1.150 subscription with 1m context enabled', () => {
  const oneMillionContextProfile = canonicalPersonaHeaders(
    sharedConfig('http://127.0.0.1:1', 'http://127.0.0.1:2', { message_beta_profile: 'claude_code_2_1_150_subscription_1m' }),
    'messages',
    validUuid,
  )
  assert.equal(oneMillionContextProfile['anthropic-beta'], 'claude-code-20250219,oauth-2025-04-20,context-1m-2025-08-07,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advisor-tool-2026-03-01,effort-2025-11-24,extended-cache-ttl-2025-04-11')
})


test('message beta policy supports 2.1.170 interim subscription with 1m context enabled', () => {
  const config = sharedConfig('http://127.0.0.1:1', 'http://127.0.0.1:2', { message_beta_profile: 'claude_code_2_1_170_subscription_1m' })
  config.env = { ...config.env, version: '2.1.170', version_base: '2.1.170' }
  config.account_identities!['account-a'] = {
    ...config.account_identities!['account-a'],
    persona_variant: 'claude-code-2.1.170-macos-local',
    policy_version: '2.1.170',
  }
  const identity = config.account_identities!['account-a']
  const interimProfile = canonicalPersonaHeaders(config, 'messages', validUuid, {
    identity,
    requestedPolicyVersion: '2.1.170',
    requestedModel: 'claude-opus-4-8',
  })
  assert.equal(interimProfile['anthropic-beta'], 'claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,effort-2025-11-24')
  assert.equal(interimProfile['User-Agent'], 'claude-cli/2.1.170 (external, sdk-cli)')
})

await finish()
