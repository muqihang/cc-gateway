import { strict as assert } from 'assert'
import { createHmac } from 'crypto'
import { readFileSync } from 'fs'
import { loadConfig } from '../src/config.js'
import { startProxy } from '../src/proxy.js'
import { baseConfig, close, finish, httpJson, serverUrl, startFakeConnectProxy, startFakeUpstream, test, writeConfigYaml, waitForListening } from './helpers.js'

console.log('\ntests/formal-pool-canonical-promotion.test.ts')

const attestationSecret = 'scheduler-hmac-material-v1-plan76-safe-fixture-abcdef'
const selectedCredential = 'Bearer selected-token-plan76'
const proxyRef = 'opaque:proxy-ref:v1:plan76-bucket'
const rollbackTLSProfileRef = 'tls-profile:claude-code-2.1.179-real-oracle-tcp-v1'
const primaryTLSProfileRef = 'tls-profile:claude-code-2.1.197-real-oracle-tcp-v1'
const rollbackTLSBucket = 'tls-bucket:claude-code-real-oracle-2179'
const primaryTLSBucket = 'tls-bucket:claude-code-real-oracle-2197'
const envResidueProfileRef = 'env-residue-profile:claude-code-2.1.179-us-pacific-official-anthropic-v1'
const localeProfileRef = 'locale-profile:us-pacific-v1'
const baseUrlResidueProfileRef = 'base-url-residue-profile:official-anthropic-v1'
const requestShape2179 = 'claude_code_2_1_179_messages_streaming_tooldefs_degraded_v1'
const requestShape2197 = 'claude_code_2_1_197_messages_streaming_tooldefs_native_v1'
const cache2179 = 'claude_code_2_1_179_cache_parity_degraded_v1'
const cache2197 = 'claude_code_2_1_197_cache_parity_native_v1'
const profilePolicy2179 = 'claude_code_2_1_179_cp1_degraded_v1'
const profilePolicy2197 = 'claude_code_2_1_197_plan76_native_policy_v1'
const mcpPolicyRef = 'mcp-connector-policy:official-remote-https-v1'
const mcpHost = ['docs', 'example', 'com'].join('.')

type CanonicalVersion = '2.1.179' | '2.1.185' | '2.1.197'

type CanonicalTuple = ReturnType<typeof tuple>

function tuple(version: CanonicalVersion) {
  if (version === '2.1.197') {
    return {
      policy_version: '2.1.197' as const,
      persona_profile: 'claude-code-2.1.197-macos-local',
      profile_policy_version: profilePolicy2197,
      request_shape_profile_ref: requestShape2197,
      cache_parity_profile_ref: cache2197,
      egress_tls_profile_ref: primaryTLSProfileRef,
    }
  }
  if (version === '2.1.185') {
    return {
      policy_version: '2.1.185' as const,
      persona_profile: 'claude-code-2.1.185-macos-local',
      profile_policy_version: profilePolicy2179,
      request_shape_profile_ref: requestShape2179,
      cache_parity_profile_ref: cache2179,
      egress_tls_profile_ref: rollbackTLSProfileRef,
    }
  }
  return {
    policy_version: '2.1.179' as const,
    persona_profile: 'claude-code-2.1.179-macos-local',
    profile_policy_version: profilePolicy2179,
    request_shape_profile_ref: requestShape2179,
    cache_parity_profile_ref: cache2179,
    egress_tls_profile_ref: rollbackTLSProfileRef,
  }
}

function credentialRef(version: CanonicalVersion) {
  return `opaque:credential-ref:v1:plan76-${version.replaceAll('.', '-')}`
}

function bucketRef(version: CanonicalVersion) {
  return `bucket-plan76-${version.replaceAll('.', '-')}`
}

function accountRef(version: CanonicalVersion) {
  return `account-plan76-${version.replaceAll('.', '-')}`
}

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

function observedProfile(cliVersion: string, overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 'observed_client_profile.v1',
    cli_version_bucket: cliVersion,
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
    mcp_configured_absent_diff_bucket: 'absent_no_diff',
    ...overrides,
  }
}

function sessionId(suffix: string) {
  return `123e4567-e89b-42d3-a456-42661417${suffix.padStart(4, '0').slice(-4)}`
}

function context(version: CanonicalVersion, options: {
  observedVersion?: string
  session?: string
  overrides?: Record<string, unknown>
} = {}) {
  const t = tuple(version)
  const session = options.session || sessionId(version.replaceAll('.', '').slice(-4))
  return {
    method: 'POST',
    route_class: 'messages',
    path: '/v1/messages',
    account_id: accountRef(version),
    token_type: 'oauth',
    credential_ref: credentialRef(version),
    credential_source: 'server_account_credentials',
    credential_binding_hmac: credentialBindingHmac(),
    egress_bucket: bucketRef(version),
    proxy_identity_ref: proxyRef,
    trusted_egress_profile_ref: 'strip_attribution',
    billing_shape_policy: 'strip',
    env_residue_profile_ref: envResidueProfileRef,
    locale_profile_ref: localeProfileRef,
    base_url_residue_profile_ref: baseUrlResidueProfileRef,
    session_id: session,
    timestamp_ms: Date.now(),
    nonce: `plan76-cp7-${version}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    observed_client_profile: observedProfile(options.observedVersion || version),
    ...t,
    ...(options.overrides || {}),
  }
}

function headers(version: CanonicalVersion, options: {
  observedVersion?: string
  session?: string
  contextOverrides?: Record<string, unknown>
  headerOverrides?: Record<string, string>
} = {}) {
  const ctx = context(version, {
    observedVersion: options.observedVersion,
    session: options.session,
    overrides: options.contextOverrides,
  })
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
    ...(options.headerOverrides || {}),
  }
}

function body(session: string, overrides: Record<string, unknown> = {}) {
  return {
    model: 'claude-sonnet-4-6',
    max_tokens: 32,
    metadata: { user_id: JSON.stringify({ session_id: session }) },
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

function plan76Config(upstreamUrl: string, proxyUrl: string, versions: CanonicalVersion[]) {
  const selected = versions[0]
  return baseConfig({
    mode: 'sub2api',
    upstream: { url: upstreamUrl },
    auth: { gateway_token: 'gateway-token', internal_control_token: 'internal-control-plan76', tokens: [] },
    oauth: undefined,
    env: { ...baseConfig().env, version: selected, version_base: selected },
    shared_pool: {
      upstream_mode: 'preflight',
      billing_cch_mode: 'strip',
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:plan76',
      context_attestation_secret: attestationSecret,
      ...(versions.length === 1 ? { message_beta_profile: tuple(selected).persona_profile } : {}),
      egress_tls: { enabled: true, strict: false },
      env_residue: {
        env_residue_profile_ref: envResidueProfileRef,
        locale_profile_ref: localeProfileRef,
        base_url_residue_profile_ref: baseUrlResidueProfileRef,
      },
    },
    account_identities: Object.fromEntries(versions.map((version) => {
      const t = tuple(version)
      return [accountRef(version), {
        device_id: version === '2.1.197' ? 'b'.repeat(64) : version === '2.1.185' ? 'c'.repeat(64) : 'd'.repeat(64),
        account_uuid_ref: `hmac-sha256:${version === '2.1.197' ? 'a'.repeat(64) : version === '2.1.185' ? 'b'.repeat(64) : 'c'.repeat(64)}`,
        email_ref: `hmac-sha256:${version === '2.1.197' ? 'c'.repeat(64) : version === '2.1.185' ? 'd'.repeat(64) : 'e'.repeat(64)}`,
        account_ref: `hmac-sha256:${version === '2.1.197' ? 'd'.repeat(64) : version === '2.1.185' ? 'e'.repeat(64) : 'f'.repeat(64)}`,
        credential_ref: credentialRef(version),
        credential_binding_hmac: credentialBindingHmac(),
        token_type: 'oauth',
        persona_variant: t.persona_profile,
        session_policy: 'preserve_downstream_session_id',
        policy_version: version,
      }]
    })),
    egress_buckets: Object.fromEntries(versions.map((version) => [bucketRef(version), {
      enabled: true,
      proxy_url: proxyUrl,
      proxy_identity_ref: proxyRef,
      allowed_account_ids: [accountRef(version)],
      tls_profile_ref: tuple(version).egress_tls_profile_ref,
    }])),
    tls_profiles: {
      rollback: { profile_ref: rollbackTLSProfileRef, source: 'observed-oracle-63', enabled: true },
      primary: { profile_ref: primaryTLSProfileRef, source: 'observed-oracle-63', enabled: true },
    },
  } as any)
}

function withMCPConnectorEnabled(config: ReturnType<typeof plan76Config>) {
  return {
    ...config,
    formal_pool: {
      enabled: true,
      mcp_connector: {
        enabled: true,
        mode: 'official_remote_https',
        allowed_hosts: [mcpHost],
        allowed_models: ['claude-sonnet-4-6'],
      },
    },
  } as any
}

async function withGateway<T>(
  versions: CanonicalVersion[],
  fn: (gateway: ReturnType<typeof startProxy>, upstream: Awaited<ReturnType<typeof startFakeUpstream>>, proxy: Awaited<ReturnType<typeof startFakeConnectProxy>>) => Promise<T>,
  options: { mcpConnectorEnabled?: boolean } = {},
) {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const config = plan76Config(upstream.url, proxy.url, versions)
  const gateway = startProxy(options.mcpConnectorEnabled ? withMCPConnectorEnabled(config) : config)
  await waitForListening(gateway)
  try {
    return await fn(gateway, upstream, proxy)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
}

async function request(gateway: ReturnType<typeof startProxy>, version: CanonicalVersion, requestSession: string, options: {
  observedVersion?: string
  contextOverrides?: Record<string, unknown>
  headerOverrides?: Record<string, string>
  bodyOverrides?: Record<string, unknown>
} = {}) {
  return httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
    headers: headers(version, {
      observedVersion: options.observedVersion,
      session: requestSession,
      contextOverrides: options.contextOverrides,
      headerOverrides: options.headerOverrides,
    }),
    body: body(requestSession, options.bodyOverrides),
  })
}

function assertNoAttribution(captured: Awaited<ReturnType<typeof startFakeUpstream>>['captured'][number]) {
  for (const key of Object.keys(captured.headers)) {
    assert.equal(key.startsWith('x-anthropic-billing-'), false, `forbidden billing header ${key}`)
    assert.equal(key.startsWith('x-cc-'), false, `gateway control header leaked ${key}`)
  }
  assert.equal(captured.headers['x-anthropic-billing-header'], undefined)
  assert.equal(captured.headers['x-cc-formal-pool-context'], undefined)
  assert.equal(captured.headers['x-cc-formal-pool-signature'], undefined)
  assert.doesNotMatch(captured.body, /x-anthropic-billing-header|\bcch=/i)
}

function assertUserAgentVersion(captured: Awaited<ReturnType<typeof startFakeUpstream>>['captured'][number], version: CanonicalVersion) {
  assert.match(String(captured.headers['user-agent']), new RegExp(`^claude-cli/${version.replaceAll('.', '\\.')} `))
}

function rollbackOnlyFormalPoolYaml(): string {
  return `
server:
  port: 0
  tls:
    cert: ""
    key: ""
mode: sub2api
upstream:
  url: https://api.anthropic.com
providers:
  anthropic: true
auth:
  gateway_token: gateway-token
  internal_control_token: internal-control-material-v1-plan76-safe-fixture-abcdef
identity:
  device_id: ${'a'.repeat(64)}
  email: redacted-email
env:
  platform: darwin
  version: "2.1.179"
  version_base: "2.1.179"
prompt_env:
  platform: darwin
  shell: zsh
  os_version: "Darwin 24.4.0"
  working_dir: /Users/jack/projects
process:
  constrained_memory: 34359738368
  rss_range: [300000000, 500000000]
  heap_total_range: [40000000, 80000000]
  heap_used_range: [100000000, 200000000]
shared_pool:
  gateway_compromise_boundary: trusted_gateway
  context_attestation_secret_ref: opaque:attestation-ref:v1:formal-pool
  context_attestation_secret: ${attestationSecret}
  billing_cch_mode: strip
  upstream_mode: preflight
  egress_tls:
    enabled: true
    strict: true
  env_residue:
    env_residue_profile_ref: ${envResidueProfileRef}
    locale_profile_ref: ${localeProfileRef}
    base_url_residue_profile_ref: ${baseUrlResidueProfileRef}
tls_profiles:
  rollback-2179:
    profile_ref: ${rollbackTLSProfileRef}
    source: observed-oracle-63
    enabled: true
egress_tls_sidecar:
  enabled: true
  endpoint: http://127.0.0.1:19081
  control_token: independent-sidecar-control-token-plan76
  proxy_binding_secret: proxy-binding-material-v1-plan76-safe-fixture-abcdef
  allowed_target_hosts: ["api.anthropic.com"]
  logical_target_host: api.anthropic.com
  allowed_routes: ["/v1/messages"]
  allowed_profile_refs:
    - ${rollbackTLSProfileRef}
  expected_tls_summary_bucket: ${rollbackTLSBucket}
account_identities:
  account-a:
    device_id: ${'b'.repeat(64)}
    account_uuid_ref: opaque:account-ref:v1:acct-a
    account_ref: opaque:account-partition:v1:acct-a
    credential_ref: opaque:credential-ref:v1:cred-a
    credential_binding_hmac: hmac-sha256:${'c'.repeat(64)}
    persona_variant: claude-code-2.1.179-macos-local
    session_policy: preserve_downstream_session_id
    policy_version: "2.1.179"
egress_buckets:
  bucket-a:
    enabled: true
    proxy_url: http://127.0.0.1:19080
    proxy_identity_ref: opaque:proxy-ref:v1:bucket-a
    allowed_account_ids: [account-a]
    tls_profile_ref: ${rollbackTLSProfileRef}
logging:
  level: error
  audit: false
`
}

test('rollback 2.1.179 formal-pool config remains accepted for rollback canonical', () => {
  const config = loadConfig(writeConfigYaml(rollbackOnlyFormalPoolYaml()))
  assert.equal(config.env.version, '2.1.179')
  assert.equal(config.account_identities?.['account-a'].policy_version, '2.1.179')
  assert.equal(config.egress_buckets?.['bucket-a'].tls_profile_ref, rollbackTLSProfileRef)
  assert.deepEqual(config.egress_tls_sidecar?.allowed_profile_refs, [rollbackTLSProfileRef])
})

test('2.1.197 TLS oracle is compiled in sidecar and promoted tuple can reference it explicitly', () => {
  const profileSource = readFileSync(new URL('../sidecar/egress-tls-sidecar/internal/profile/profile.go', import.meta.url), 'utf-8')
  const cfg = plan76Config('http://127.0.0.1:9', 'http://127.0.0.1:9', ['2.1.197'])
  assert.match(profileSource, /tls-profile:claude-code-2\.1\.197-real-oracle-tcp-v1/)
  assert.match(profileSource, /tls-bucket:claude-code-real-oracle-2197/)
  assert.equal(cfg.egress_buckets?.[bucketRef('2.1.197')].tls_profile_ref, primaryTLSProfileRef)
  assert.equal(cfg.tls_profiles?.primary.profile_ref, primaryTLSProfileRef)
})

test('observed client 2.1.179 with server canonical 2.1.197 emits 2.1.197 identity', async () => {
  await withGateway(['2.1.197'], async (gateway, upstream) => {
    const s = sessionId('2197')
    const response = await request(gateway, '2.1.197', s, { observedVersion: '2.1.179', bodyOverrides: { model: 'claude-sonnet-5' } })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    const captured = upstream.captured[0]
    assertUserAgentVersion(captured, '2.1.197')
    assert.match(String(captured.headers['anthropic-beta']), /claude-code-20250219/)
    assert.equal(JSON.parse(captured.body).model, 'claude-sonnet-5')
    assertNoAttribution(captured)
  })
})

test('observed client 2.1.197 with server canonical 2.1.185 uses fallback and fail-closes Sonnet 5', async () => {
  await withGateway(['2.1.185'], async (gateway, upstream) => {
    const sonnet5Session = sessionId('2185')
    const blocked = await request(gateway, '2.1.185', sonnet5Session, { observedVersion: '2.1.197', bodyOverrides: { model: 'claude-sonnet-5' } })
    assert.equal(blocked.status, 403, blocked.body)
    assert.equal(blocked.headers['x-cc-gateway-error-code'], 'formal_pool_model_version_unsupported')
    assert.equal(upstream.captured.length, 0)

    const fallbackSession = sessionId('1185')
    const ok = await request(gateway, '2.1.185', fallbackSession, { observedVersion: '2.1.197', bodyOverrides: { model: 'claude-sonnet-4-6' } })
    assert.equal(ok.status, 200, ok.body)
    assert.equal(upstream.captured.length, 1)
    assertUserAgentVersion(upstream.captured[0], '2.1.185')
    assert.equal(JSON.parse(upstream.captured[0].body).model, 'claude-sonnet-4-6')
    assertNoAttribution(upstream.captured[0])
  })
})

test('fallback 2.1.185 tuple cannot opt into MCP connector even when model is otherwise allowed', async () => {
  await withGateway(['2.1.185'], async (gateway, upstream) => {
    const s = sessionId('1186')
    const response = await request(gateway, '2.1.185', s, {
      contextOverrides: {
        mcp_connector_policy_ref: mcpPolicyRef,
        observed_client_profile: observedProfile('2.1.197', {
          top_level_body_keys: ['max_tokens', 'mcp_servers', 'messages', 'metadata', 'model', 'stream', 'system', 'tools'],
          thinking_present: false,
          output_config_present: false,
          context_management_present: false,
          mcp_shape_bucket: 'official_remote_url_connector',
          mcp_server_count_bucket: '1',
          mcp_toolset_count_bucket: '1',
          mcp_auth_bucket: 'absent',
        }),
      },
      bodyOverrides: {
        thinking: undefined,
        context_management: undefined,
        output_config: undefined,
        mcp_servers: [{ type: 'url', name: 'srv_1', url: new URL('/mcp', `https://${mcpHost}`).toString() }],
        tools: [{ type: 'mcp_toolset', mcp_server_name: 'srv_1' }],
      },
    })
    assert.equal(response.status, 403, response.body)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'formal_pool_mcp_canonical_tuple_required')
    assert.equal(upstream.captured.length, 0)
  }, { mcpConnectorEnabled: true })
})

test('rollback 2.1.179 tuple is accepted and rewrites upstream as rollback identity', async () => {
  await withGateway(['2.1.179'], async (gateway, upstream) => {
    const s = sessionId('2179')
    const response = await request(gateway, '2.1.179', s, { observedVersion: '2.1.197', bodyOverrides: { model: 'claude-sonnet-4-6' } })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    assertUserAgentVersion(upstream.captured[0], '2.1.179')
    assert.equal(JSON.parse(upstream.captured[0].body).model, 'claude-sonnet-4-6')
    assertNoAttribution(upstream.captured[0])
  })
})

test('missing and mixed canonical tuple attestations fail closed before upstream', async () => {
  await withGateway(['2.1.197'], async (gateway, upstream) => {
    const missing = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-account-id': accountRef('2.1.197'),
        'x-cc-token-type': 'oauth',
        'x-cc-credential-ref': credentialRef('2.1.197'),
        'x-cc-egress-bucket': bucketRef('2.1.197'),
        'x-cc-policy-version': '2.1.197',
        'x-claude-code-session-id': sessionId('9097'),
        authorization: selectedCredential,
      },
      body: body(sessionId('9097'), { model: 'claude-sonnet-5' }),
    })
    assert.equal(missing.status, 403, missing.body)
    assert.equal(missing.headers['x-cc-gateway-error-code'], 'missing_formal_pool_context_attestation')

    const mixedSession = sessionId('8197')
    const mixed = await request(gateway, '2.1.197', mixedSession, {
      contextOverrides: { request_shape_profile_ref: requestShape2179, cache_parity_profile_ref: cache2179 },
      bodyOverrides: { model: 'claude-sonnet-5' },
    })
    assert.equal(mixed.status, 403, mixed.body)
    assert.equal(mixed.headers['x-cc-gateway-error-code'], 'formal_pool_profile_ref_unapproved')
    assert.equal(upstream.captured.length, 0)
  })
})

test('2.1.197 TLS profile is selectable only by the server-selected tuple', async () => {
  await withGateway(['2.1.197'], async (gateway, upstream) => {
    const badSession = sessionId('7297')
    const bad = await request(gateway, '2.1.197', badSession, {
      contextOverrides: { egress_tls_profile_ref: rollbackTLSProfileRef },
      bodyOverrides: { model: 'claude-sonnet-5' },
    })
    assert.equal(bad.status, 403, bad.body)
    assert.equal(bad.headers['x-cc-gateway-error-code'], 'formal_pool_context_mismatch')
    assert.equal(upstream.captured.length, 0)

    const okSession = sessionId('7397')
    const ok = await request(gateway, '2.1.197', okSession, { bodyOverrides: { model: 'claude-sonnet-5' } })
    assert.equal(ok.status, 200, ok.body)
    assert.equal(ok.headers['x-cc-egress-tls-profile-status'], 'tls_profile_unverified')
    assert.equal(upstream.captured.length, 1)
    assertUserAgentVersion(upstream.captured[0], '2.1.197')
  })
})

test('CP4 count_tokens MCP non-streaming and control-plane policies remain enforced under promoted tuple', async () => {
  await withGateway(['2.1.197'], async (gateway, upstream) => {
    const countTokens = await httpJson(serverUrl(gateway, '/v1/messages/count_tokens?beta=true'), {
      headers: headers('2.1.197', {
        session: sessionId('1001'),
        contextOverrides: {
          route_class: 'count_tokens',
          path: '/v1/messages/count_tokens',
          observed_client_profile: observedProfile('2.1.197', { route_class: 'count_tokens' }),
        },
      }),
      body: body(sessionId('1001')),
    })
    assert.equal(countTokens.status, 403, countTokens.body)
    assert.equal(countTokens.headers['x-cc-gateway-error-code'], 'formal_pool_count_tokens_profile_unapproved')

    const nonStreaming = await request(gateway, '2.1.197', sessionId('1002'), { bodyOverrides: { stream: false } })
    assert.equal(nonStreaming.status, 403, nonStreaming.body)
    assert.equal(nonStreaming.headers['x-cc-gateway-error-code'], 'formal_pool_non_streaming_profile_unapproved')

    const mcp = await request(gateway, '2.1.197', sessionId('1003'), { bodyOverrides: { mcp_servers: { synthetic: { command: 'safe-local-fixture' } } } })
    assert.equal(mcp.status, 403, mcp.body)
    assert.equal(mcp.headers['x-cc-gateway-error-code'], 'formal_pool_mcp_connector_disabled')

    const controlPlane = await httpJson(serverUrl(gateway, '/v1/models?beta=true'), {
      headers: headers('2.1.197', {
        session: sessionId('1004'),
        contextOverrides: {
          route_class: 'control_plane',
          path: '/v1/models',
          observed_client_profile: observedProfile('2.1.197', { route_class: 'control_plane' }),
        },
      }),
      body: {},
    })
    assert.equal(controlPlane.status, 403, controlPlane.body)
    assert.equal(controlPlane.headers['x-cc-gateway-error-code'], 'formal_pool_control_plane_unapproved')
    assert.equal(upstream.captured.length, 0)
  })
})

test('session authority ledger rejects tuple drift while new sessions can switch tuples', async () => {
  await withGateway(['2.1.197', '2.1.185', '2.1.179'], async (gateway, upstream) => {
    const driftingSession = sessionId('4242')
    const primary = await request(gateway, '2.1.197', driftingSession, { bodyOverrides: { model: 'claude-sonnet-5' } })
    assert.equal(primary.status, 200, primary.body)

    const drift = await request(gateway, '2.1.185', driftingSession, { bodyOverrides: { model: 'claude-sonnet-4-6' } })
    assert.equal(drift.status, 403, drift.body)
    assert.equal(drift.headers['x-cc-gateway-error-code'], 'formal_pool_session_authority_mismatch')

    const fallback = await request(gateway, '2.1.185', sessionId('4243'), { bodyOverrides: { model: 'claude-sonnet-4-6' } })
    assert.equal(fallback.status, 200, fallback.body)
    const rollback = await request(gateway, '2.1.179', sessionId('4244'), { bodyOverrides: { model: 'claude-sonnet-4-6' } })
    assert.equal(rollback.status, 200, rollback.body)

    assert.equal(upstream.captured.length, 3)
    assertUserAgentVersion(upstream.captured[0], '2.1.197')
    assertUserAgentVersion(upstream.captured[1], '2.1.185')
    assertUserAgentVersion(upstream.captured[2], '2.1.179')
  })
})

await finish()
