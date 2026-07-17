import { strict as assert } from 'assert'
import { createHmac } from 'crypto'
import { startProxy } from '../src/proxy.js'
import { canonicalPersonaHeaders } from '../src/policy.js'
import { baseConfig, close, finish, httpJson, serverUrl, startFakeConnectProxy, startFakeUpstream, test, waitForListening } from './helpers.js'

console.log('\ntests/session-and-beta-policy.test.ts')

const validUuid = '123e4567-e89b-42d3-a456-426614174000'
const formalPoolCredentialRef = 'opaque:credential-ref:v1:cred-a'
const formalPoolProxyRef = 'opaque:proxy-ref:v1:bucket-a'
const formalPoolAttestationSecret = 'scheduler-hmac-material-v1-local-safe-fixture-123456'
const internalControlToken = 'internal-control-material-v1-local-safe-fixture-123456'
const uuidV4Like = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function sharedConfig(upstreamUrl: string, proxyUrl: string, extraSharedPool: Record<string, unknown> = {}) {
  return baseConfig({
    mode: 'sub2api',
    upstream: { url: upstreamUrl },
    auth: { gateway_token: 'gateway-token', internal_control_token: internalControlToken, tokens: [] },
    oauth: undefined,
    env: { ...baseConfig().env, version: '2.1.146', version_base: '2.1.146' },
    shared_pool: {
      upstream_mode: 'preflight',
      billing_cch_mode: 'sign',
      signing_enabled: true,
      signing_evidence_gates_approved: true,
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:session-beta',
      context_attestation_secret: formalPoolAttestationSecret,
      ...extraSharedPool,
    },
    account_identities: {
      'account-a': {
        device_id: 'b'.repeat(64),
        account_uuid_hash: 'hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        email_hash: 'hmac-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        account_hash: 'hmac-sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        credential_ref: formalPoolCredentialRef,
        credential_binding_hmac: credentialBindingHmac('Bearer synthetic-token'),
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
  'x-cc-credential-ref': formalPoolCredentialRef,
  'x-cc-egress-bucket': 'bucket-a',
  'x-cc-policy-version': '2.1.146',
}

function canonicalFormalPoolContext(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = value[key]
    return acc
  }, {} as Record<string, unknown>))
}

function credentialBindingHmac(rawCredential: string, tokenType: 'oauth' | 'apikey' = 'oauth') {
  return `hmac-sha256:${createHmac('sha256', formalPoolAttestationSecret)
    .update('formal_pool_credential_binding_v1')
    .update('\0')
    .update(tokenType)
    .update('\0')
    .update(rawCredential)
    .digest('hex')}`
}

function signedFormalPoolHeaders(context: Record<string, unknown>) {
  const canonical = canonicalFormalPoolContext(context)
  return {
    'x-cc-formal-pool-context': Buffer.from(canonical, 'utf-8').toString('base64url'),
    'x-cc-formal-pool-signature': `hmac-sha256:${createHmac('sha256', formalPoolAttestationSecret).update(canonical).digest('hex')}`,
  }
}

function schedulerHeaders(headers: Record<string, string> = {}, contextOverrides: Record<string, unknown> = {}) {
  const merged = {
    ...sharedHeaders,
    'x-claude-code-session-id': validUuid,
    ...headers,
  }
  const policyVersion = merged['x-cc-policy-version'] || '2.1.146'
  const context = {
    method: 'POST',
    route_class: 'messages',
    path: '/v1/messages',
    account_id: merged['x-cc-account-id'],
    token_type: merged['x-cc-token-type'],
    credential_ref: merged['x-cc-credential-ref'],
    credential_source: 'server_account_credentials',
    egress_bucket: merged['x-cc-egress-bucket'],
    proxy_identity_ref: formalPoolProxyRef,
    policy_version: policyVersion,
    persona_profile: `claude-code-${policyVersion}-macos-local`,
    session_id: merged['x-claude-code-session-id'],
    timestamp_ms: Date.now(),
	    nonce: `session-beta-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	    trusted_egress_profile_ref: 'strip_attribution',
	    env_residue_profile_ref: 'env-residue-profile:claude-code-2.1.179-us-pacific-official-anthropic-v1',
	    locale_profile_ref: 'locale-profile:us-pacific-v1',
	    base_url_residue_profile_ref: 'base-url-residue-profile:official-anthropic-v1',
	    profile_policy_version: 'claude_code_2_1_179_cp1_degraded_v1',
	    billing_shape_policy: 'strip',
	    request_shape_profile_ref: 'claude_code_2_1_179_messages_streaming_tooldefs_degraded_v1',
    cache_parity_profile_ref: 'claude_code_2_1_179_cache_parity_degraded_v1',
    observed_client_profile: {
      schema_version: 'observed_client_profile.v1',
      cli_version_bucket: '2.1.179',
      route_class: 'messages',
	      billing_shape: 'absent',
	      billing_block_count: 0,
	      cc_entrypoint_bucket: 'absent',
	      stream: true,
	      thinking_present: false,
	      output_config_present: false,
	      context_management_present: false,
	    },
    ...contextOverrides,
  }
  return {
    ...merged,
    ...signedFormalPoolHeaders(context),
  }
}

test('shared-pool canonicalizes malformed downstream session IDs to UUID-like Claude Code shape', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sharedConfig(upstream.url, proxy.url))
  await waitForListening(gateway)
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({ 'x-claude-code-session-id': 'short-non-uuid-session' }, { session_id: validUuid }),
      body: {
        model: 'claude-sonnet-4-6',
        max_tokens: 32,
        metadata: { user_id: JSON.stringify({ session_id: validUuid }) },
        stream: true,
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
  await waitForListening(gateway)
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({ 'x-claude-code-session-id': validUuid }),
      body: {
        model: 'claude-sonnet-4-6',
        max_tokens: 32,
        metadata: { user_id: JSON.stringify({ session_id: 'another-short-session' }) },
        stream: true,
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


test('message beta policy supports 2.1.175 final subscription with 1m context enabled', () => {
  const config = sharedConfig('http://127.0.0.1:1', 'http://127.0.0.1:2', { message_beta_profile: 'claude_code_2_1_175_subscription_1m' })
  config.env = { ...config.env, version: '2.1.175', version_base: '2.1.175' }
  config.account_identities!['account-a'] = {
    ...config.account_identities!['account-a'],
    persona_variant: 'claude-code-2.1.175-macos-local',
    policy_version: '2.1.175',
  }
  const identity = config.account_identities!['account-a']
  const finalProfile = canonicalPersonaHeaders(config, 'messages', validUuid, {
    identity,
    requestedPolicyVersion: '2.1.175',
    requestedModel: 'claude-opus-4-8',
  })
  assert.equal(finalProfile['anthropic-beta'], 'claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,effort-2025-11-24')
  assert.equal(finalProfile['User-Agent'], 'claude-cli/2.1.175 (external, sdk-cli)')
})


test('trusted internal healthcheck override uses non-1m beta while normal traffic keeps 1m', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const config = sharedConfig(upstream.url, proxy.url, { message_beta_profile: 'claude_code_2_1_175_subscription_1m' })
  config.env = { ...config.env, version: '2.1.175', version_base: '2.1.175' }
  config.account_identities!['account-a'] = {
    ...config.account_identities!['account-a'],
    persona_variant: 'claude-code-2.1.175-macos-local',
    policy_version: '2.1.175',
  }
  const gateway = startProxy(config)
  await waitForListening(gateway)
  try {
    const body = {
      model: 'claude-sonnet-4-6',
      max_tokens: 64,
      metadata: { user_id: JSON.stringify({ session_id: validUuid }) },
      stream: true,
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'healthcheck' }] }],
    }
    const normal = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({ 'x-cc-policy-version': '2.1.175' }, { persona_profile: 'claude-code-2.1.175-macos-local' }),
      body,
    })
    assert.equal(normal.status, 200, normal.body)
    assert.equal(upstream.captured.length, 1)
    assert.match(String(upstream.captured[0].headers['anthropic-beta']), /context-1m-2025-08-07/)

    const healthcheckSessionId = '123e4567-e89b-42d3-a456-426614174003'
    const healthcheck = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        'x-cc-policy-version': '2.1.175',
        'x-claude-code-session-id': healthcheckSessionId,
        'x-sub2api-healthcheck-persona': 'claude_code_2_1_175_api_key_non_1m',
        'x-cc-internal-control-token': internalControlToken,
      }, { persona_profile: 'claude_code_2_1_175_api_key_non_1m', session_id: healthcheckSessionId }),
      body: {
        ...body,
        metadata: { user_id: JSON.stringify({ session_id: healthcheckSessionId }) },
      },
    })
    assert.equal(healthcheck.status, 200, healthcheck.body)
    assert.equal(upstream.captured.length, 2)
    assert.doesNotMatch(String(upstream.captured[1].headers['anthropic-beta']), /context-1m-2025-08-07/)
    assert.match(String(upstream.captured[1].headers['anthropic-beta']), /claude-code-20250219/)
    assert.equal(upstream.captured[1].headers['user-agent'], 'claude-cli/2.1.175 (external, sdk-cli)')
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})


test('shared-pool uses non-1m persona for ordinary Haiku and Sonnet traffic by default', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const config = sharedConfig(upstream.url, proxy.url)
  config.env = { ...config.env, version: '2.1.175', version_base: '2.1.175' }
  config.account_identities!['account-a'] = {
    ...config.account_identities!['account-a'],
    persona_variant: 'claude_code_2_1_175_api_key_non_1m',
    policy_version: '2.1.175',
  }
  const gateway = startProxy(config)
  await waitForListening(gateway)
  try {
    for (const model of ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6']) {
      const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
        headers: schedulerHeaders({ 'x-cc-policy-version': '2.1.175' }, { persona_profile: 'claude_code_2_1_175_api_key_non_1m' }),
        body: {
          model,
          max_tokens: 64,
          metadata: { user_id: JSON.stringify({ session_id: validUuid }) },
          stream: true,
          system: [],
          messages: [{ role: 'user', content: [{ type: 'text', text: 'ordinary request' }] }],
        },
      })
      assert.equal(response.status, 200, `${model}: ${response.body}`)
    }
    assert.equal(upstream.captured.length, 2)
    for (const captured of upstream.captured) {
      assert.doesNotMatch(String(captured.headers['anthropic-beta']), /context-1m-2025-08-07/)
    }
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})


test('sub2api internal persona headers require internal control attestation', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const config = sharedConfig(upstream.url, proxy.url)
  config.env = { ...config.env, version: '2.1.175', version_base: '2.1.175' }
  config.account_identities!['account-a'] = {
    ...config.account_identities!['account-a'],
    persona_variant: 'claude_code_2_1_175_api_key_non_1m',
    policy_version: '2.1.175',
  }
  const gateway = startProxy(config)
  await waitForListening(gateway)
  try {
    const context1m = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        'x-cc-policy-version': '2.1.175',
        'x-sub2api-context-1m': 'true',
      }, { persona_profile: 'claude_code_2_1_175_api_key_non_1m' }),
      body: {
        model: 'claude-sonnet-4-6',
        max_tokens: 64,
        metadata: { user_id: JSON.stringify({ session_id: validUuid }) },
        stream: true,
        system: [],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'spoofed context request' }] }],
      },
    })
    assert.equal(context1m.status, 403)
    assert.equal(context1m.headers['x-cc-gateway-error-code'], 'missing_internal_control_attestation')

    const healthcheck = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        'x-cc-policy-version': '2.1.175',
        'x-sub2api-healthcheck-persona': 'claude_code_2_1_175_api_key_non_1m',
      }, { persona_profile: 'claude_code_2_1_175_api_key_non_1m', session_id: '123e4567-e89b-42d3-a456-426614174004' }),
      body: {
        model: 'claude-sonnet-4-6',
        max_tokens: 64,
        metadata: { user_id: JSON.stringify({ session_id: '123e4567-e89b-42d3-a456-426614174004' }) },
        stream: true,
        system: [],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'spoofed healthcheck request' }] }],
      },
    })
    assert.equal(healthcheck.status, 403)
    assert.equal(healthcheck.headers['x-cc-gateway-error-code'], 'missing_internal_control_attestation')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})

test('trusted Sub2API context-1m request opts into 1m persona for eligible Sonnet model', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const config = sharedConfig(upstream.url, proxy.url)
  config.env = { ...config.env, version: '2.1.175', version_base: '2.1.175' }
  config.account_identities!['account-a'] = {
    ...config.account_identities!['account-a'],
    persona_variant: 'claude_code_2_1_175_api_key_non_1m',
    policy_version: '2.1.175',
  }
  const gateway = startProxy(config)
  await waitForListening(gateway)
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        'x-cc-policy-version': '2.1.175',
        'x-sub2api-context-1m': 'true',
        'x-cc-internal-control-token': internalControlToken,
      }, { persona_profile: 'claude_code_2_1_175_api_key_non_1m' }),
      body: {
        model: 'claude-sonnet-4-6',
        max_tokens: 64,
        metadata: { user_id: JSON.stringify({ session_id: validUuid }) },
        stream: true,
        system: [],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'long context selected' }] }],
      },
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    assert.match(String(upstream.captured[0].headers['anthropic-beta']), /context-1m-2025-08-07/)
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})

test('context-1m request for Haiku fails closed before upstream', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const config = sharedConfig(upstream.url, proxy.url)
  config.env = { ...config.env, version: '2.1.175', version_base: '2.1.175' }
  config.account_identities!['account-a'] = {
    ...config.account_identities!['account-a'],
    persona_variant: 'claude_code_2_1_175_api_key_non_1m',
    policy_version: '2.1.175',
  }
  const gateway = startProxy(config)
  await waitForListening(gateway)
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        'x-cc-policy-version': '2.1.175',
        'x-sub2api-context-1m': 'true',
        'x-cc-internal-control-token': internalControlToken,
      }, { persona_profile: 'claude_code_2_1_175_api_key_non_1m' }),
      body: {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 64,
        metadata: { user_id: JSON.stringify({ session_id: validUuid }) },
        stream: true,
        system: [],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'haiku should not use 1m' }] }],
      },
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'context_1m_unsupported_model')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})

test('trusted internal healthcheck override accepts 2.1.179 native degraded persona', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const config = sharedConfig(upstream.url, proxy.url, { message_beta_profile: 'claude_code_2_1_179_native_degraded' })
  config.env = { ...config.env, version: '2.1.179', version_base: '2.1.179' }
  config.account_identities!['account-a'] = {
    ...config.account_identities!['account-a'],
    persona_variant: 'claude-code-2.1.179-macos-local',
    policy_version: '2.1.179',
  }
  const gateway = startProxy(config)
  await waitForListening(gateway)
  try {
    const healthcheckSessionId = '123e4567-e89b-42d3-a456-426614174005'
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        'x-cc-policy-version': '2.1.179',
        'x-claude-code-session-id': healthcheckSessionId,
        'x-sub2api-healthcheck-persona': 'claude_code_2_1_179_native_degraded',
        'x-cc-internal-control-token': internalControlToken,
      }, { persona_profile: 'claude_code_2_1_179_native_degraded', session_id: healthcheckSessionId }),
      body: {
        model: 'claude-sonnet-4-6',
        max_tokens: 64,
        metadata: { user_id: JSON.stringify({ session_id: healthcheckSessionId }) },
        stream: true,
        system: [],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'healthcheck' }] }],
      },
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    assert.equal(upstream.captured[0].headers['user-agent'], 'claude-cli/2.1.179 (external, sdk-cli)')
    assert.doesNotMatch(String(upstream.captured[0].headers['anthropic-beta']), /context-1m-2025-08-07/)
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})

test('healthcheck persona override rejects 2.1.175 persona under 2.1.179 policy before upstream', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const config = sharedConfig(upstream.url, proxy.url, { message_beta_profile: 'claude_code_2_1_179_native_degraded' })
  config.env = { ...config.env, version: '2.1.179', version_base: '2.1.179' }
  config.account_identities!['account-a'] = {
    ...config.account_identities!['account-a'],
    persona_variant: 'claude-code-2.1.179-macos-local',
    policy_version: '2.1.179',
  }
  const gateway = startProxy(config)
  await waitForListening(gateway)
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        'x-cc-policy-version': '2.1.179',
        'x-sub2api-healthcheck-persona': 'claude_code_2_1_175_api_key_non_1m',
        'x-cc-internal-control-token': internalControlToken,
      }, { persona_profile: 'claude_code_2_1_175_api_key_non_1m' }),
      body: {
        model: 'claude-sonnet-4-6',
        max_tokens: 64,
        metadata: { user_id: JSON.stringify({ session_id: validUuid }) },
        stream: true,
        system: [],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'healthcheck' }] }],
      },
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'unsupported_healthcheck_persona')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})


test('healthcheck persona override rejects unsupported profiles before upstream', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const config = sharedConfig(upstream.url, proxy.url, { message_beta_profile: 'claude_code_2_1_175_subscription_1m' })
  config.env = { ...config.env, version: '2.1.175', version_base: '2.1.175' }
  config.account_identities!['account-a'] = {
    ...config.account_identities!['account-a'],
    persona_variant: 'claude-code-2.1.175-macos-local',
    policy_version: '2.1.175',
  }
  const gateway = startProxy(config)
  await waitForListening(gateway)
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        'x-cc-policy-version': '2.1.175',
        'x-sub2api-healthcheck-persona': 'claude_code_2_1_175_subscription_1m',
        'x-cc-internal-control-token': internalControlToken,
      }, { persona_profile: 'claude-code-2.1.175-macos-local' }),
      body: {
        model: 'claude-sonnet-4-6',
        max_tokens: 64,
        metadata: { user_id: JSON.stringify({ session_id: validUuid }) },
        stream: true,
        system: [],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'healthcheck' }] }],
      },
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'unsupported_healthcheck_persona')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})

await finish()
