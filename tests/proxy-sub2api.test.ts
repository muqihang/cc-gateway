import { strict as assert } from 'assert'
import { startProxy } from '../src/proxy.js'
import { baseConfig, close, finish, httpJson, serverUrl, startFakeConnectProxy, startFakeUpstream, test } from './helpers.js'

console.log('\ntests/proxy-sub2api.test.ts')

const ccGatewayHeaders = {
  'x-cc-account-id': 'account-1',
  'x-cc-egress-bucket': 'bucket-a',
  'x-cc-policy-version': '2.1.119',
}

function sub2apiConfig(upstreamUrl: string, proxyUrl: string, overrides: Record<string, unknown> = {}) {
  return baseConfig({
    mode: 'sub2api',
    upstream: { url: upstreamUrl },
    auth: { gateway_token: 'gateway-token', tokens: [] },
    oauth: undefined,
    account_identities: {
      'account-1': {
        device_id: 'b'.repeat(64),
        account_uuid_hash: 'sha256:account-uuid',
        email_hash: 'sha256:email',
        account_hash: 'sha256:account-1',
        persona_variant: 'claude-code-2.1.146-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.119',
      },
    },
    egress_buckets: {
      'bucket-a': { enabled: true, proxy_url: proxyUrl, proxy_identity_hash: 'sha256:proxy-a', allowed_account_ids: ['account-1'] },
    },
    ...overrides,
  } as any)
}

test('sub2api Anthropic OAuth preserves selected authorization and strips all x-cc headers', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        ...ccGatewayHeaders,
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-account-id': 'account-1',
        'x-cc-token-type': 'oauth',
        'x-cc-account-email': 'selected@example.com',
        'x-cc-account-uuid': 'acct-uuid',
        'x-cc-organization-uuid': 'org-uuid',
        'x-cc-extra-secret': 'must-not-leak',
        authorization: 'Bearer selected-token',
      },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })

    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    assert.equal(upstream.captured[0].headers.authorization, 'Bearer selected-token')
    assert.equal(upstream.captured[0].headers['x-api-key'], undefined)
    assert.ok(!Object.keys(upstream.captured[0].headers).some((key) => key.startsWith('x-cc-')))
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('sub2api Anthropic OAuth strips incidental x-api-key', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        ...ccGatewayHeaders,
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-token-type': 'oauth',
        authorization: 'Bearer selected-token',
        'x-api-key': 'incidental-api-key',
      },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })

    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured[0].headers.authorization, 'Bearer selected-token')
    assert.equal(upstream.captured[0].headers['x-api-key'], undefined)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('sub2api Anthropic API key preserves selected x-api-key and does not inject gateway OAuth', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        ...ccGatewayHeaders,
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-account-id': 'account-1',
        'x-cc-token-type': 'apikey',
        'x-api-key': 'selected-api-key',
      },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })

    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    assert.equal(upstream.captured[0].headers['x-api-key'], 'selected-api-key')
    assert.notEqual(upstream.captured[0].headers.authorization, 'Bearer gateway-token')
    assert.ok(!Object.keys(upstream.captured[0].headers).some((key) => key.startsWith('x-cc-')))
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('sub2api Anthropic API key strips incidental authorization', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        ...ccGatewayHeaders,
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-token-type': 'apikey',
        'x-api-key': 'selected-api-key',
        authorization: 'Bearer incidental-token',
      },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })

    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured[0].headers['x-api-key'], 'selected-api-key')
    assert.equal(upstream.captured[0].headers.authorization, undefined)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('sub2api mode fails closed when provider is missing', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        ...ccGatewayHeaders,
        'x-cc-gateway-token': 'gateway-token',
      },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 400)
    assert.equal(response.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(response.headers['x-cc-gateway-error-code'], 'missing_provider')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('sub2api mode fails closed when provider is unsupported', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        ...ccGatewayHeaders,
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'gemini_native',
      },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(response.headers['x-cc-gateway-error-code'], 'unsupported_provider')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('sub2api mode fails closed when Anthropic provider is disabled', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url, { providers: { anthropic: false } }))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        ...ccGatewayHeaders,
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-token-type': 'oauth',
        authorization: 'Bearer selected-token',
      },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(response.headers['x-cc-gateway-error-code'], 'provider_disabled')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('sub2api mode blocks unknown event logging routes with a control-plane error contract', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url))

  try {
    const response = await httpJson(serverUrl(gateway, '/api/event_logging/v3/batch'), {
      headers: {
        ...ccGatewayHeaders,
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-token-type': 'oauth',
        authorization: 'Bearer selected-token',
      },
      body: { events: [] },
    })
    assert.equal(response.status, 404)
    assert.equal(response.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(response.headers['x-cc-gateway-error-code'], 'unsupported_event_logging_route')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

await finish()
