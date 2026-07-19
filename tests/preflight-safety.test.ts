import { strict as assert } from 'assert'
import { createHmac } from 'crypto'
import { startProxy } from '../src/proxy.js'
import { evaluateUpstreamSafety } from '../src/upstream-safety.js'
import { baseConfig, close, finish, httpJson, serverUrl, startFakeConnectProxy, startFakeUpstream, test, waitForListening } from './helpers.js'

console.log('\ntests/preflight-safety.test.ts')

const attestationSecret = 'scheduler-hmac-material-v1-local-safe-fixture-123456'
const internalControlToken = 'internal-control-material-v1-local-safe-fixture-123456'
const sessionId = '123e4567-e89b-42d3-a456-426614174999'

const sharedHeaders = {
  'x-cc-gateway-token': 'gateway-token',
  'x-cc-provider': 'anthropic',
  'x-cc-account-id': 'account-a',
  'x-cc-token-type': 'oauth',
  'x-cc-credential-ref': 'opaque:credential-ref:v1:cred-a',
  authorization: 'Bearer synthetic-token',
  'x-cc-egress-bucket': 'bucket-a',
  'x-cc-policy-version': '2.1.146',
  'x-claude-code-session-id': sessionId,
}

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

function signedSharedHeaders() {
  const context = {
    method: 'POST',
    route_class: 'messages',
    path: '/v1/messages',
    account_id: sharedHeaders['x-cc-account-id'],
    token_type: sharedHeaders['x-cc-token-type'],
    credential_ref: sharedHeaders['x-cc-credential-ref'],
    credential_source: 'server_account_credentials',
    egress_bucket: sharedHeaders['x-cc-egress-bucket'],
    proxy_identity_ref: 'opaque:proxy-ref:v1:bucket-a',
    policy_version: sharedHeaders['x-cc-policy-version'],
    persona_profile: 'claude-code-2.1.146-macos-local',
    session_id: sharedHeaders['x-claude-code-session-id'],
    timestamp_ms: Date.now(),
    nonce: `nonce-${Date.now()}-${Math.random().toString(16).slice(2)}`,
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
  }
  const canonical = canonicalFormalPoolContext(context)
  return {
    ...sharedHeaders,
    'x-cc-formal-pool-context': Buffer.from(canonical, 'utf-8').toString('base64url'),
    'x-cc-formal-pool-signature': `hmac-sha256:${createHmac('sha256', attestationSecret).update(canonical).digest('hex')}`,
  }
}

function sharedPreflightConfig(upstreamUrl: string) {
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
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:test',
      context_attestation_secret: attestationSecret,
    },
    account_identities: {
      'account-a': {
        device_id: 'b'.repeat(64),
        account_uuid_hash: 'hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        email_hash: 'hmac-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        account_hash: 'hmac-sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        credential_ref: 'opaque:credential-ref:v1:cred-a',
        credential_binding_hmac: credentialBindingHmac('Bearer synthetic-token'),
        persona_variant: 'claude-code-2.1.146-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.146',
      },
    },
    egress_buckets: {
      'bucket-a': {
        enabled: true,
        proxy_url: 'http://127.0.0.1:65535',
        proxy_identity_hash: 'opaque:proxy-ref:v1:bucket-a',
        allowed_account_ids: ['account-a'],
      },
    },
  } as any)
}

test('preflight safety blocks real Anthropic upstream hosts without network forwarding', () => {
  for (const host of ['https://api.anthropic.com', 'https://platform.claude.com', 'https://claude.ai']) {
    const result = evaluateUpstreamSafety(sharedPreflightConfig(host), 'POST', '/v1/messages')
    assert.deepEqual(result, { ok: false, status: 403, code: 'preflight_real_upstream_forbidden' })
  }
})

test('preflight safety allows localhost mock upstreams', async () => {
  const upstream = await startFakeUpstream()
  try {
    const result = evaluateUpstreamSafety(sharedPreflightConfig(upstream.url), 'POST', '/v1/messages')
    assert.deepEqual(result, { ok: true })
  } finally {
    await close(upstream.server)
  }
})

test('real Anthropic upstream requires explicit real-canary mode, env switch, and user approval', () => {
  const config = sharedPreflightConfig('https://api.anthropic.com')
  ;(config.shared_pool as any).upstream_mode = 'real-canary'
  ;(config.shared_pool as any).real_canary_user_approved = true

  const previous = process.env.ALLOW_REAL_ANTHROPIC_CANARY
  delete process.env.ALLOW_REAL_ANTHROPIC_CANARY
  try {
    assert.deepEqual(evaluateUpstreamSafety(config, 'POST', '/v1/messages'), {
      ok: false,
      status: 403,
      code: 'real_anthropic_canary_not_allowed',
    })
    process.env.ALLOW_REAL_ANTHROPIC_CANARY = '1'
    assert.deepEqual(evaluateUpstreamSafety(config, 'POST', '/v1/messages'), { ok: true })
    assert.deepEqual(evaluateUpstreamSafety(config, 'POST', '/v1/messages/count_tokens'), {
      ok: false,
      status: 403,
      code: 'real_anthropic_canary_route_forbidden',
    })
  } finally {
    if (previous === undefined) delete process.env.ALLOW_REAL_ANTHROPIC_CANARY
    else process.env.ALLOW_REAL_ANTHROPIC_CANARY = previous
  }
})

test('real Anthropic production upstream requires production mode and production env switch without canary flag', () => {
  const config = sharedPreflightConfig('https://api.anthropic.com')
  ;(config.shared_pool as any).upstream_mode = 'production'
  ;(config.shared_pool as any).production_upstream_enabled = true
  delete (config.shared_pool as any).real_canary_user_approved

  const previousProduction = process.env.ALLOW_REAL_ANTHROPIC_PRODUCTION
  const previousCanary = process.env.ALLOW_REAL_ANTHROPIC_CANARY
  delete process.env.ALLOW_REAL_ANTHROPIC_PRODUCTION
  delete process.env.ALLOW_REAL_ANTHROPIC_CANARY
  try {
    assert.deepEqual(evaluateUpstreamSafety(config, 'POST', '/v1/messages'), {
      ok: false,
      status: 403,
      code: 'real_anthropic_production_not_allowed',
    })
    process.env.ALLOW_REAL_ANTHROPIC_CANARY = '1'
    assert.deepEqual(evaluateUpstreamSafety(config, 'POST', '/v1/messages'), {
      ok: false,
      status: 403,
      code: 'real_anthropic_production_not_allowed',
    })
    process.env.ALLOW_REAL_ANTHROPIC_PRODUCTION = '1'
    assert.deepEqual(evaluateUpstreamSafety(config, 'POST', '/v1/messages'), { ok: true })
  } finally {
    if (previousProduction === undefined) delete process.env.ALLOW_REAL_ANTHROPIC_PRODUCTION
    else process.env.ALLOW_REAL_ANTHROPIC_PRODUCTION = previousProduction
    if (previousCanary === undefined) delete process.env.ALLOW_REAL_ANTHROPIC_CANARY
    else process.env.ALLOW_REAL_ANTHROPIC_CANARY = previousCanary
  }
})



test('real AWS Claude Platform upstream requires post-attestation provider gate', () => {
  for (const mode of ['real-canary', 'production'] as const) {
    const config = sharedPreflightConfig('https://aws-external-anthropic.us-east-1.api.aws')
    ;(config.shared_pool as any).upstream_mode = mode
    ;(config.shared_pool as any).real_canary_user_approved = true
    ;(config.shared_pool as any).production_upstream_enabled = true
    assert.deepEqual(evaluateUpstreamSafety(config, 'POST', '/v1/messages'), {
      ok: false,
      status: 428,
      code: 'real_aws_claude_platform_requires_post_attestation',
    })
    assert.deepEqual(evaluateUpstreamSafety(config, 'POST', '/v1/messages/count_tokens'), {
      ok: false,
      status: 403,
      code: 'real_aws_claude_platform_route_forbidden',
    })
  }
})

test('real modes reject nonlocal non-Anthropic upstreams unless explicitly supported by code', () => {
  for (const mode of ['real-canary', 'production'] as const) {
    const config = sharedPreflightConfig('https://example.invalid')
    ;(config.shared_pool as any).upstream_mode = mode
    ;(config.shared_pool as any).real_canary_user_approved = true
    ;(config.shared_pool as any).production_upstream_enabled = true
    assert.deepEqual(evaluateUpstreamSafety(config, 'POST', '/v1/messages'), {
      ok: false,
      status: 403,
      code: `${mode}_nonlocal_upstream_forbidden`,
    })
  }
})

test('preflight gateway fails closed before account/session gates when upstream is real Anthropic', async () => {
  const gateway = startProxy(sharedPreflightConfig('https://api.anthropic.com'))
  await waitForListening(gateway)
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: sharedHeaders,
      body: { metadata: {}, messages: [] },
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'preflight_real_upstream_forbidden')
  } finally {
    await close(gateway)
  }
})

test('messages-shaped preflight with identity and bucket uses localhost mock only', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const config = sharedPreflightConfig(upstream.url)
  config.egress_buckets!['bucket-a'].proxy_url = proxy.url
  const gateway = startProxy(config)
  await waitForListening(gateway)
  try {
	  const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
	    headers: signedSharedHeaders(),
	    body: { stream: true, metadata: {}, messages: [{ role: 'user', content: 'hello' }] },
	  })
    assert.equal(response.status, 200)
    assert.equal(upstream.captured.length, 1)
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})

await finish()
