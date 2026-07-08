import { strict as assert } from 'assert'
import { createHmac } from 'crypto'
import { startProxy } from '../src/proxy.js'
import { baseConfig, close, finish, httpJson, serverUrl, startFakeConnectProxy, startFakeUpstream, test } from './helpers.js'

console.log('\ntests/formal-pool-control-plane-gap-closure.test.ts')

const attestationSecret = 'scheduler-hmac-material-v1-plan76-safe-fixture-abcdef'
const sessionId = '123e4567-e89b-42d3-a456-426614174076'
const selectedCredential = 'Bearer selected-token-plan76'
const credentialRef = 'opaque:credential-ref:v1:plan76-cred-a'
const proxyRef = 'opaque:proxy-ref:v1:plan76-bucket-a'
const tls2179 = 'tls-profile:claude-code-2.1.179-real-oracle-tcp-v1'
const tls2197 = 'tls-profile:claude-code-2.1.197-real-oracle-tcp-v1'
const requestShape2179 = 'claude_code_2_1_179_messages_streaming_tooldefs_degraded_v1'
const requestShape2197 = 'claude_code_2_1_197_messages_streaming_tooldefs_native_v1'
const cache2179 = 'claude_code_2_1_179_cache_parity_degraded_v1'
const cache2197 = 'claude_code_2_1_197_cache_parity_native_v1'
const profilePolicy2179 = 'claude_code_2_1_179_cp1_degraded_v1'
const profilePolicy2197 = 'claude_code_2_1_197_plan76_native_policy_v1'
const envResidueProfileRef = 'env-residue-profile:claude-code-2.1.179-us-pacific-official-anthropic-v1'
const localeProfileRef = 'locale-profile:us-pacific-v1'
const baseUrlResidueProfileRef = 'base-url-residue-profile:official-anthropic-v1'

function credentialBindingHmac(raw = selectedCredential, tokenType: 'oauth' | 'apikey' = 'oauth') {
  return `hmac-sha256:${createHmac('sha256', attestationSecret)
    .update('formal_pool_credential_binding_v1')
    .update('\0')
    .update(tokenType)
    .update('\0')
    .update(raw)
    .digest('hex')}`
}

function canonical(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = value[key]
    return acc
  }, {} as Record<string, unknown>))
}

function signedHeaders(context: Record<string, unknown>) {
  const raw = canonical(context)
  return {
    'x-cc-formal-pool-context': Buffer.from(raw, 'utf-8').toString('base64url'),
    'x-cc-formal-pool-signature': `hmac-sha256:${createHmac('sha256', attestationSecret).update(raw).digest('hex')}`,
  }
}

function tuple(version: '2.1.179' | '2.1.185' | '2.1.197') {
  if (version === '2.1.197') {
    return {
      policy_version: '2.1.197',
      persona_profile: 'claude-code-2.1.197-macos-local',
      profile_policy_version: profilePolicy2197,
      request_shape_profile_ref: requestShape2197,
      cache_parity_profile_ref: cache2197,
      egress_tls_profile_ref: tls2197,
    }
  }
  if (version === '2.1.185') {
    return {
      policy_version: '2.1.185',
      persona_profile: 'claude-code-2.1.185-macos-local',
      profile_policy_version: profilePolicy2179,
      request_shape_profile_ref: requestShape2179,
      cache_parity_profile_ref: cache2179,
      egress_tls_profile_ref: tls2179,
    }
  }
  return {
    policy_version: '2.1.179',
    persona_profile: 'claude-code-2.1.179-macos-local',
    profile_policy_version: profilePolicy2179,
    request_shape_profile_ref: requestShape2179,
    cache_parity_profile_ref: cache2179,
    egress_tls_profile_ref: tls2179,
  }
}

function observedProfile(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 'observed_client_profile.v1',
    cli_version_bucket: '2.1.197',
    client_family_bucket: 'cli',
    route_class: 'messages',
    billing_shape: 'absent',
    billing_block_count: 0,
    cc_entrypoint_bucket: 'absent',
    top_level_body_keys: ['context_management', 'max_tokens', 'messages', 'metadata', 'model', 'output_config', 'stream', 'system', 'thinking', 'tools'],
    tool_count: 1,
    stream: true,
    thinking_present: true,
    output_config_present: true,
    context_management_present: true,
    local_env_residue_present: false,
    date_format_bucket: 'not_observed',
    apostrophe_bucket: 'not_observed',
    base_url_category_bucket: 'not_observed',
    proxy_env_bucket: 'no_proxy_env',
    ...overrides,
  }
}

function context(version: '2.1.179' | '2.1.185' | '2.1.197', overrides: Record<string, unknown> = {}) {
  const t = tuple(version)
  return {
    method: 'POST',
    route_class: 'messages',
    path: '/v1/messages',
    account_id: 'account-plan76',
    token_type: 'oauth',
    credential_ref: credentialRef,
    credential_source: 'server_account_credentials',
    credential_binding_hmac: credentialBindingHmac(),
    egress_bucket: 'bucket-plan76',
    proxy_identity_ref: proxyRef,
    trusted_egress_profile_ref: 'strip_attribution',
    billing_shape_policy: 'strip',
    env_residue_profile_ref: envResidueProfileRef,
    locale_profile_ref: localeProfileRef,
    base_url_residue_profile_ref: baseUrlResidueProfileRef,
    session_id: sessionId,
    timestamp_ms: Date.now(),
    nonce: `plan76-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    observed_client_profile: observedProfile({ cli_version_bucket: version }),
    ...t,
    ...overrides,
  }
}

function headers(version: '2.1.179' | '2.1.185' | '2.1.197', overrides: Record<string, unknown> = {}, headerOverrides: Record<string, string> = {}) {
  const ctx = context(version, overrides)
  return {
    'x-cc-gateway-token': 'gateway-token',
    'x-cc-provider': 'anthropic',
    'x-cc-account-id': String(ctx.account_id),
    'x-cc-token-type': String(ctx.token_type),
    'x-cc-credential-ref': String(ctx.credential_ref),
    'x-cc-egress-bucket': String(ctx.egress_bucket),
    'x-cc-policy-version': String(ctx.policy_version),
    'x-claude-code-session-id': String(ctx.session_id),
    authorization: selectedCredential,
    ...signedHeaders(ctx),
    ...headerOverrides,
  }
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    model: 'claude-sonnet-5',
    max_tokens: 32,
    metadata: { user_id: JSON.stringify({ session_id: sessionId }) },
    stream: true,
    system: [{ type: 'text', text: 'safe system fixture' }],
    thinking: { type: 'enabled', budget_tokens: 1024 },
    context_management: { edits: [{ type: 'clear_tool_uses_20250919', keep: 'none' }] },
    output_config: { effort: 'medium' },
    tools: [{ name: 'fixture_tool', description: 'fixture', input_schema: { type: 'object', properties: {} } }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'local fixture' }] }],
    ...overrides,
  }
}

function config(upstreamUrl: string, proxyUrl: string, version: '2.1.179' | '2.1.185' | '2.1.197', extraSharedPool: Record<string, unknown> = {}) {
  const t = tuple(version)
  return baseConfig({
    mode: 'sub2api',
    upstream: { url: upstreamUrl },
    auth: { gateway_token: 'gateway-token', internal_control_token: 'internal-control-plan76', tokens: [] },
    oauth: undefined,
    env: { ...baseConfig().env, version, version_base: version },
    shared_pool: {
      upstream_mode: 'preflight',
      billing_cch_mode: 'strip',
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:plan76',
      context_attestation_secret: attestationSecret,
      message_beta_profile: t.persona_profile,
      egress_tls: { enabled: true, strict: false },
      env_residue: {
        env_residue_profile_ref: envResidueProfileRef,
        locale_profile_ref: localeProfileRef,
        base_url_residue_profile_ref: baseUrlResidueProfileRef,
      },
      ...extraSharedPool,
    },
    account_identities: {
      'account-plan76': {
        device_id: 'b'.repeat(64),
        account_uuid_ref: 'hmac-sha256:' + 'a'.repeat(64),
        email_ref: 'hmac-sha256:' + 'c'.repeat(64),
        account_ref: 'hmac-sha256:' + 'd'.repeat(64),
        credential_ref: credentialRef,
        credential_binding_hmac: credentialBindingHmac(),
        token_type: 'oauth',
        persona_variant: t.persona_profile,
        session_policy: 'preserve_downstream_session_id',
        policy_version: version,
      },
    },
    egress_buckets: {
      'bucket-plan76': {
        enabled: true,
        proxy_url: proxyUrl,
        proxy_identity_ref: proxyRef,
        allowed_account_ids: ['account-plan76'],
        tls_profile_ref: t.egress_tls_profile_ref,
      },
    },
    tls_profiles: {
      selected: { profile_ref: t.egress_tls_profile_ref, source: 'observed-oracle-63', enabled: true },
    },
  } as any)
}

async function withGateway<T>(version: '2.1.179' | '2.1.185' | '2.1.197', fn: (gateway: ReturnType<typeof startProxy>, upstream: Awaited<ReturnType<typeof startFakeUpstream>>) => Promise<T>, extraSharedPool: Record<string, unknown> = {}) {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(config(upstream.url, proxy.url, version, extraSharedPool))
  try {
    return await fn(gateway, upstream)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
}

async function expectClosed(version: '2.1.179' | '2.1.185' | '2.1.197', path: string, code: string, requestBody: Record<string, unknown>, contextOverrides: Record<string, unknown> = {}, headerOverrides: Record<string, string> = {}) {
  await withGateway(version, async (gateway, upstream) => {
    const response = await httpJson(serverUrl(gateway, path), {
      headers: headers(version, contextOverrides, headerOverrides),
      body: requestBody,
    })
    const expectedStatus = code === 'formal_pool_env_residue_verifier_failed' ? 400 : 403
    assert.equal(response.status, expectedStatus, response.body)
    assert.equal(response.headers['x-cc-gateway-error-code'], code)
    assert.equal(upstream.captured.length, 0)
  })
}

test('formal-pool count_tokens fails closed with Plan76 stable error before upstream', async () => {
  for (const version of ['2.1.179', '2.1.185', '2.1.197'] as const) {
    await withGateway(version, async (gateway, upstream) => {
      const response = await httpJson(serverUrl(gateway, '/v1/messages/count_tokens?beta=true'), {
        headers: headers(version, { route_class: 'count_tokens', path: '/v1/messages/count_tokens', observed_client_profile: observedProfile({ route_class: 'count_tokens', cli_version_bucket: version }) }),
        body: body({ stream: undefined }),
      })
      assert.equal(response.status, 403)
      assert.equal(response.headers['x-cc-gateway-error-code'], 'formal_pool_count_tokens_profile_unapproved')
      assert.equal(upstream.captured.length, 0)
    })
  }
})

test('formal-pool structured unsafe MCP configured markers fail closed before upstream', async () => {
  for (const version of ['2.1.179', '2.1.185', '2.1.197'] as const) {
    await expectClosed(version, '/v1/messages?beta=true', 'formal_pool_mcp_legacy_shape_unapproved', body({ mcp_servers: { synthetic: { command: 'safe-local-fixture' } } }), {
      observed_client_profile: observedProfile({ cli_version_bucket: version, mcp_configured_absent_diff_bucket: 'configured_marker_present' }),
    })
    await expectClosed(version, '/v1/messages?beta=true', 'formal_pool_mcp_legacy_shape_unapproved', body({ mcpAuthority: 'synthetic-local' }), {
      observed_client_profile: observedProfile({ cli_version_bucket: version, mcp_configured_absent_diff_bucket: 'configured_no_upstream_diff' }),
    })
  }
})

test('formal-pool non-streaming messages fail closed unless stream is explicitly true', async () => {
  for (const version of ['2.1.179', '2.1.185', '2.1.197'] as const) {
    for (const streamValue of [false, undefined, null, 'true', 1] as const) {
      await expectClosed(version, '/v1/messages?beta=true', 'formal_pool_non_streaming_profile_unapproved', body({ stream: streamValue }), {
        observed_client_profile: observedProfile({ cli_version_bucket: version, stream: true }),
      })
    }
    await expectClosed(version, '/v1/messages?beta=true', 'formal_pool_non_streaming_profile_unapproved', body({ stream: true }), {
      observed_client_profile: observedProfile({ cli_version_bucket: version, stream: undefined }),
    })
  }
})

test('formal-pool model/control-plane paths fail closed with Plan76 stable error', async () => {
  for (const version of ['2.1.179', '2.1.185', '2.1.197'] as const) {
    await withGateway(version, async (gateway, upstream) => {
      const response = await httpJson(serverUrl(gateway, '/v1/models?beta=true'), {
        headers: headers(version, { route_class: 'control_plane', path: '/v1/models', observed_client_profile: observedProfile({ route_class: 'control_plane', cli_version_bucket: version }) }),
        body: {},
      })
      assert.equal(response.status, 403)
      assert.equal(response.headers['x-cc-gateway-error-code'], 'formal_pool_control_plane_unapproved')
      assert.equal(upstream.captured.length, 0)
    })
  }
})

test('2.1.185 fallback tuple rejects Sonnet 5 before upstream', async () => {
  await expectClosed('2.1.185', '/v1/messages?beta=true', 'formal_pool_model_version_unsupported', body({ model: 'claude-sonnet-5' }))
})

test('2.1.197 Sonnet 5 requires server-selected canonical policy and rejects user self-authorization', async () => {
  await withGateway('2.1.197', async (gateway, upstream) => {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: headers('2.1.197', {
        policy_version: '2.1.179',
        persona_profile: 'claude-code-2.1.179-macos-local',
        profile_policy_version: profilePolicy2179,
        request_shape_profile_ref: requestShape2179,
        cache_parity_profile_ref: cache2179,
        egress_tls_profile_ref: tls2179,
        observed_client_profile: observedProfile({ cli_version_bucket: '2.1.197' }),
      }),
      body: body({ model: 'claude-sonnet-5' }),
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'formal_pool_model_version_unsupported')
    assert.equal(upstream.captured.length, 0)
  })
})

test('2.1.197 server-selected canonical Sonnet 5 path forwards and strips CCH/billing/client attribution', async () => {
  await withGateway('2.1.197', async (gateway, upstream) => {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: headers('2.1.197', {}, { 'x-anthropic-billing-test': 'client-attribution-forbidden' }),
      body: body({ system: [{ type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.197.abc; cc_entrypoint=sdk-cli; cch=12345;' }] }),
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    const captured = upstream.captured[0]
    assert.equal(captured.headers['x-anthropic-billing-test'], undefined)
    assert.equal(captured.headers['x-anthropic-billing-header'], undefined)
    assert.equal(captured.headers['x-cc-formal-pool-context'], undefined)
    assert.equal(captured.headers['x-cc-formal-pool-signature'], undefined)
    assert.match(String(captured.headers['user-agent']), /^claude-cli\/2\.1\.197 /)
    const sent = JSON.parse(captured.body)
    assert.equal(sent.model, 'claude-sonnet-5')
    assert.equal(sent.stream, true)
    assert.doesNotMatch(captured.body, /x-anthropic-billing-header|cch=/i)
  })
})

test('2.1.197 server-selected canonical path admits observed 2.1.198 after future observed keys are cleaned', async () => {
  await withGateway('2.1.197', async (gateway, upstream) => {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: headers('2.1.197', {
        observed_client_profile: observedProfile({
          cli_version_bucket: '2.1.198',
          top_level_body_keys: ['context_management', 'future_client_field', 'max_tokens', 'messages', 'metadata', 'model', 'output_config', 'stream', 'system', 'thinking', 'tools'],
          unknown_top_level_body_key_count: 1,
        }),
      }),
      body: body({ system: [{ type: 'text', text: 'safe system fixture for future observed client' }] }),
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    assert.match(String(upstream.captured[0].headers['user-agent']), /^claude-cli\/2\.1\.197 /)
    assert.doesNotMatch(upstream.captured[0].body, /future_client_field/i)
  })
})

test('2.1.197 server-selected canonical path observes safe MCP metadata residue without enabling connector', async () => {
  await withGateway('2.1.197', async (gateway, upstream) => {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: headers('2.1.197', {
        observed_client_profile: observedProfile({
          cli_version_bucket: '2.1.201',
          mcp_configured_absent_diff_bucket: 'configured_no_upstream_diff',
          mcp_shape_bucket: 'absent',
          mcp_server_count_bucket: '0',
          mcp_toolset_count_bucket: '0',
          mcp_auth_bucket: 'absent',
        }),
      }),
      body: body({
        metadata: {
          user_id: JSON.stringify({ session_id: sessionId }),
          safe_nested: { mcpAuthority: 'configured locally but not forwarded upstream' },
        },
      }),
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    assert.equal(response.headers['x-cc-mcp-connector-decision-bucket'], 'absent')
    assert.doesNotMatch(upstream.captured[0].body, /mcp_servers|mcp_toolset|mcpAuthority|command|authorization_token/i)
  })
})

test('Plan75 residue marker buckets are observed-only and structural body residue is sanitized', async () => {
  await withGateway('2.1.197', async (gateway, upstream) => {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: headers('2.1.197', {
        observed_client_profile: observedProfile({ cli_version_bucket: '2.1.197', base_url_category_bucket: 'neutral_gateway', proxy_env_bucket: 'loopback_proxy_only' }),
      }),
      body: body({ metadata: { user_id: JSON.stringify({ session_id: sessionId }), ANTHROPIC_BASE_URL: 'http://127.0.0.1/synthetic' } }),
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    assert.doesNotMatch(upstream.captured[0].body, /ANTHROPIC_BASE_URL|127\.0\.0\.1\/synthetic/i)
  })
})

await finish()
