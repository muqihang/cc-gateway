import { strict as assert } from 'assert'
import { startProxy } from '../src/proxy.js'
import { baseConfig, close, finish, httpJson, serverUrl, startFakeUpstream, test } from './helpers.js'

console.log('\ntests/proxy-sub2api.test.ts')

test('sub2api Anthropic OAuth preserves selected authorization and strips all x-cc headers', async () => {
  const upstream = await startFakeUpstream()
  const gateway = startProxy(baseConfig({
    mode: 'sub2api',
    upstream: { url: upstream.url },
    auth: { gateway_token: 'gateway-token', tokens: [] },
    oauth: undefined,
  } as any))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: {
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
  }
})

test('sub2api Anthropic OAuth strips incidental x-api-key', async () => {
  const upstream = await startFakeUpstream()
  const gateway = startProxy(baseConfig({
    mode: 'sub2api',
    upstream: { url: upstream.url },
    auth: { gateway_token: 'gateway-token', tokens: [] },
    oauth: undefined,
  } as any))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: {
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
  }
})

test('sub2api Anthropic API key preserves selected x-api-key and does not inject gateway OAuth', async () => {
  const upstream = await startFakeUpstream()
  const gateway = startProxy(baseConfig({
    mode: 'sub2api',
    upstream: { url: upstream.url },
    auth: { gateway_token: 'gateway-token', tokens: [] },
    oauth: undefined,
  } as any))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: {
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
  }
})

test('sub2api Anthropic API key strips incidental authorization', async () => {
  const upstream = await startFakeUpstream()
  const gateway = startProxy(baseConfig({
    mode: 'sub2api',
    upstream: { url: upstream.url },
    auth: { gateway_token: 'gateway-token', tokens: [] },
    oauth: undefined,
  } as any))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: {
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
  }
})

test('sub2api mode fails closed when provider is missing', async () => {
  const upstream = await startFakeUpstream()
  const gateway = startProxy(baseConfig({
    mode: 'sub2api',
    upstream: { url: upstream.url },
    auth: { gateway_token: 'gateway-token', tokens: [] },
    oauth: undefined,
  } as any))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: { 'x-cc-gateway-token': 'gateway-token' },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 400)
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
  }
})

test('sub2api mode fails closed when provider is unsupported', async () => {
  const upstream = await startFakeUpstream()
  const gateway = startProxy(baseConfig({
    mode: 'sub2api',
    upstream: { url: upstream.url },
    auth: { gateway_token: 'gateway-token', tokens: [] },
    oauth: undefined,
  } as any))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: {
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'gemini_native',
      },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 403)
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
  }
})

test('sub2api mode fails closed when Anthropic provider is disabled', async () => {
  const upstream = await startFakeUpstream()
  const gateway = startProxy(baseConfig({
    mode: 'sub2api',
    upstream: { url: upstream.url },
    providers: { anthropic: false },
    auth: { gateway_token: 'gateway-token', tokens: [] },
    oauth: undefined,
  } as any))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: {
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-token-type': 'oauth',
        authorization: 'Bearer selected-token',
      },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 403)
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
  }
})

await finish()
