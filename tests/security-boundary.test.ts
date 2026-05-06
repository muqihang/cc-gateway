import { strict as assert } from 'assert'
import { request as httpRequest } from 'http'
import { startProxy } from '../src/proxy.js'
import { baseConfig, close, finish, httpJson, serverUrl, startFakeUpstream, test } from './helpers.js'

console.log('\ntests/security-boundary.test.ts')

test('fixed upstream ignores inbound Host and Forwarded routing headers', async () => {
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
        host: 'attacker.example',
        forwarded: 'host=attacker.example;proto=https',
        'x-forwarded-host': 'attacker.example',
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-token-type': 'oauth',
        authorization: 'Bearer selected-token',
      },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })

    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    assert.match(String(upstream.captured[0].headers.host), /^127\.0\.0\.1:\d+$/)
    assert.equal(upstream.captured[0].headers.forwarded, undefined)
    assert.equal(upstream.captured[0].headers['x-forwarded-host'], undefined)
  } finally {
    await close(gateway)
    await close(upstream.server)
  }
})

test('absolute-form URL still uses fixed upstream and route-sensitive body rewriting', async () => {
  const upstream = await startFakeUpstream()
  const gateway = startProxy(baseConfig({
    mode: 'sub2api',
    upstream: { url: upstream.url },
    auth: { gateway_token: 'gateway-token', tokens: [] },
    oauth: undefined,
  } as any))

  try {
    const body = JSON.stringify({
      metadata: {
        user_id: JSON.stringify({
          device_id: 'REAL_DEVICE_ID_FROM_CLIENT_abc123',
          account_uuid: 'acct-123',
        }),
      },
      messages: [{ role: 'user', content: 'hello' }],
    })
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1',
        port: (gateway.address() as any).port,
        method: 'POST',
        path: 'http://attacker.example/v1/messages',
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
          'x-cc-gateway-token': 'gateway-token',
          'x-cc-provider': 'anthropic',
          'x-cc-token-type': 'oauth',
          authorization: 'Bearer selected-token',
        },
      }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') }))
      })
      req.on('error', reject)
      req.write(body)
      req.end()
    })

    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    assert.equal(upstream.captured[0].url, '/v1/messages')
    const upstreamBody = JSON.parse(upstream.captured[0].body)
    const userId = JSON.parse(upstreamBody.metadata.user_id)
    assert.equal(userId.device_id, 'a'.repeat(64))
  } finally {
    await close(gateway)
    await close(upstream.server)
  }
})

await finish()
