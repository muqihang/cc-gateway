import { strict as assert } from 'assert'
import { startProxy } from '../src/proxy.js'
import { baseConfig, close, finish, httpJson, serverUrl, test } from './helpers.js'

console.log('\ntests/health-verify.test.ts')

const secrets = ['gateway-token', 'client-token', 'selected-api-key', 'Bearer selected-token']

function assertNoSecretLeak(body: string) {
  for (const secret of secrets) {
    assert.ok(!body.includes(secret), `response leaked ${secret}`)
  }
  assert.ok(!body.includes('x-cc-gateway-token'))
  assert.ok(!body.includes('x-api-key'))
  assert.ok(!body.includes('authorization'))
}

test('standalone health reflects missing OAuth state without leaking tokens', async () => {
  const gateway = startProxy(baseConfig({ oauth: { refresh_token: 'refresh-token' } } as any))
  try {
    const response = await httpJson(serverUrl(gateway, '/_health'))
    assert.equal(response.status, 503)
    assert.equal(response.json.status, 'degraded')
    assertNoSecretLeak(response.body)
  } finally {
    await close(gateway)
  }
})

test('sub2api health does not require gateway OAuth and does not leak tokens', async () => {
  const gateway = startProxy(baseConfig({
    mode: 'sub2api',
    auth: { gateway_token: 'gateway-token', tokens: [] },
    oauth: undefined,
  } as any))
  try {
    const response = await httpJson(serverUrl(gateway, '/_health'), {
      headers: {
        'x-cc-gateway-token': 'gateway-token',
        authorization: 'Bearer selected-token',
        'x-api-key': 'selected-api-key',
      },
    })
    assert.equal(response.status, 200)
    assert.equal(response.json.status, 'ok')
    assertNoSecretLeak(response.body)
  } finally {
    await close(gateway)
  }
})

test('standalone verify uses legacy x-api-key auth without leaking token values', async () => {
  const gateway = startProxy(baseConfig())
  try {
    const response = await httpJson(serverUrl(gateway, '/_verify'), {
      headers: { 'x-api-key': 'client-token' },
    })
    assert.equal(response.status, 200, response.body)
    assertNoSecretLeak(response.body)
  } finally {
    await close(gateway)
  }
})

test('sub2api verify uses x-cc-gateway-token without leaking credential headers', async () => {
  const gateway = startProxy(baseConfig({
    mode: 'sub2api',
    auth: { gateway_token: 'gateway-token', tokens: [] },
    oauth: undefined,
  } as any))
  try {
    const response = await httpJson(serverUrl(gateway, '/_verify'), {
      headers: {
        'x-cc-gateway-token': 'gateway-token',
        authorization: 'Bearer selected-token',
        'x-api-key': 'selected-api-key',
      },
    })
    assert.equal(response.status, 200, response.body)
    assertNoSecretLeak(response.body)
  } finally {
    await close(gateway)
  }
})

await finish()
