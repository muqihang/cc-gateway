import { strict as assert } from 'assert'
import { startProxy } from '../src/proxy.js'
import { evaluateUpstreamSafety } from '../src/upstream-safety.js'
import { baseConfig, close, finish, httpJson, serverUrl, startFakeConnectProxy, startFakeUpstream, test } from './helpers.js'

console.log('\ntests/preflight-safety.test.ts')

const sharedHeaders = {
  'x-cc-gateway-token': 'gateway-token',
  'x-cc-provider': 'anthropic',
  'x-cc-account-id': 'account-a',
  'x-cc-token-type': 'oauth',
  authorization: 'Bearer synthetic-token',
  'x-cc-egress-bucket': 'bucket-a',
  'x-cc-policy-version': '2.1.146',
}

function sharedPreflightConfig(upstreamUrl: string) {
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
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: sharedHeaders,
      body: { metadata: {}, messages: [{ role: 'user', content: 'hello' }] },
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
