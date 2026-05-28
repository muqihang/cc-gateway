import { strict as assert } from 'assert'
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { request as httpRequest } from 'http'
import { startProxy } from '../src/proxy.js'
import { baseConfig, close, finish, httpJson, serverUrl, startFakeConnectProxy, startFakeUpstream, test } from './helpers.js'

console.log('\ntests/proxy-sub2api.test.ts')

const ccGatewayHeaders = {
  'x-cc-account-id': 'account-1',
  'x-cc-egress-bucket': 'bucket-a',
  'x-cc-policy-version': '2.1.146',
}

function streamPost(url: string, headers: Record<string, string>, body: unknown) {
  const payload = JSON.stringify(body)
  const started = Date.now()
  return new Promise<{ status: number; firstChunkMs: number; body: string }>((resolve, reject) => {
    let firstChunkMs = -1
    const chunks: Buffer[] = []
    const req = httpRequest(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(payload)),
        ...headers,
      },
    }, (res) => {
      res.on('data', (chunk) => {
        if (firstChunkMs < 0) firstChunkMs = Date.now() - started
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      res.on('end', () => resolve({
        status: res.statusCode || 0,
        firstChunkMs,
        body: Buffer.concat(chunks).toString('utf-8'),
      }))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
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
        account_uuid_hash: 'hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        email_hash: 'hmac-sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        account_hash: 'hmac-sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        persona_variant: 'claude-code-2.1.146-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.146',
      },
    },
    egress_buckets: {
      'bucket-a': { enabled: true, proxy_url: proxyUrl, proxy_identity_hash: 'opaque:proxy-ref:v1:bucket-a', allowed_account_ids: ['account-1'] },
    },
    env: { ...baseConfig().env, version: '2.1.146', version_base: '2.1.146' },
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

test('runtime registration makes a newly onboarded account routable without restart', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const runtimeAccountRef = 'hmac-sha256:runtime-account-ref'
  const runtimeHeaders = {
    ...ccGatewayHeaders,
    'x-cc-account-id': runtimeAccountRef,
  }
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url, {
    account_identities: {},
    egress_buckets: {},
  }))

  try {
    const before = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        ...runtimeHeaders,
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-token-type': 'oauth',
        authorization: 'Bearer selected-token',
      },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(before.status, 403)
    assert.equal(before.headers['x-cc-gateway-error-code'], 'missing_account_identity')
    assert.equal(upstream.captured.length, 0)

    const registered = await httpJson(serverUrl(gateway, '/_runtime/register-account'), {
      headers: { 'x-cc-gateway-token': 'gateway-token' },
      body: {
        account_id: runtimeAccountRef,
        account_ref: runtimeAccountRef,
        egress_bucket: 'bucket-a',
        proxy_url: proxy.url,
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-bucket',
        policy_version: '2.1.146',
      },
    })
    assert.equal(registered.status, 200, registered.body)
    assert.equal(registered.json?.status, 'registered')
    assert.deepEqual(registered.json?.registered, {
      account_identity: true,
      egress_bucket: true,
    })

    const after = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        ...runtimeHeaders,
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-token-type': 'oauth',
        authorization: 'Bearer selected-token',
      },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(after.status, 200, after.body)
    assert.equal(upstream.captured.length, 1)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('runtime registration rejects raw numeric account ids before mutating runtime state', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url, {
    account_identities: {},
    egress_buckets: {},
  }))

  try {
    const rejected = await httpJson(serverUrl(gateway, '/_runtime/register-account'), {
      headers: { 'x-cc-gateway-token': 'gateway-token' },
      body: {
        account_id: '123',
        account_ref: 'hmac-sha256:runtime-account-ref',
        egress_bucket: 'bucket-a',
        proxy_url: proxy.url,
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-bucket',
        policy_version: '2.1.150',
      },
    })
    assert.equal(rejected.status, 400)
    assert.equal(rejected.headers['x-cc-gateway-error-code'], 'invalid_account_id')

    const after = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        ...ccGatewayHeaders,
        'x-cc-account-id': '123',
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-token-type': 'oauth',
        authorization: 'Bearer selected-token',
      },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(after.status, 403)
    assert.equal(after.headers['x-cc-gateway-error-code'], 'missing_account_identity')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})


test('raw capture evidence headers include safe opaque ref only when capture artifacts are generated', async () => {
  const rawDir = mkdtempSync(join(tmpdir(), 'cc-gateway-raw-evidence-'))
  const oldRawDir = process.env.CC_GATEWAY_RAW_CAPTURE_DIR
  const oldRawLayout = process.env.CC_GATEWAY_RAW_CAPTURE_LAYOUT
  process.env.CC_GATEWAY_RAW_CAPTURE_DIR = rawDir
  process.env.CC_GATEWAY_RAW_CAPTURE_LAYOUT = 'per-request'

  const upstream = await startFakeUpstream((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })
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
      },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })

    assert.equal(response.status, 200, response.body)
    assert.equal(response.headers['x-cc-gateway-seen'], '1')
    const rawRef = response.headers['x-cc-gateway-raw-capture-ref']
    assert.equal(typeof rawRef, 'string')
    assert.match(rawRef as string, /^hmac-sha256:[a-f0-9]{64}$/)
    assert.ok(!(rawRef as string).includes(rawDir), 'raw ref must not expose filesystem path')
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(rawRef as string), 'raw ref must not expose UUID')
    assert.ok(!(rawRef as string).includes('@'), 'raw ref must not expose email')
    assert.ok(!(rawRef as string).includes('selected-token'), 'raw ref must not expose token')
    assert.ok(readdirSync(rawDir).length > 0, 'raw capture artifacts should be generated')
  } finally {
    if (oldRawDir === undefined) delete process.env.CC_GATEWAY_RAW_CAPTURE_DIR
    else process.env.CC_GATEWAY_RAW_CAPTURE_DIR = oldRawDir
    if (oldRawLayout === undefined) delete process.env.CC_GATEWAY_RAW_CAPTURE_LAYOUT
    else process.env.CC_GATEWAY_RAW_CAPTURE_LAYOUT = oldRawLayout
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})


test('full raw capture writes only safe summaries and no raw body material', async () => {
  const rawDir = mkdtempSync(join(tmpdir(), 'cc-gateway-full-safe-'))
  const oldRawDir = process.env.CC_GATEWAY_RAW_CAPTURE_DIR
  const oldRawLayout = process.env.CC_GATEWAY_RAW_CAPTURE_LAYOUT
  const oldFullRaw = process.env.CC_GATEWAY_FULL_RAW_CAPTURE
  process.env.CC_GATEWAY_RAW_CAPTURE_DIR = rawDir
  process.env.CC_GATEWAY_RAW_CAPTURE_LAYOUT = 'per-request'
  process.env.CC_GATEWAY_FULL_RAW_CAPTURE = '1'

  const rawPrompt = 'RAW_PROMPT_DO_NOT_CAPTURE_cch_marker_TOKEN_sk-ant-oat01-secret'
  const upstreamRaw = 'UPSTREAM_RESPONSE_RAW_SECRET_cch_marker_TOKEN'
  const upstream = await startFakeUpstream((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, completion: upstreamRaw }))
  })
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
      },
      body: {
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: rawPrompt }],
      },
    })

    assert.equal(response.status, 200, response.body)
    const rawRef = response.headers['x-cc-gateway-raw-capture-ref']
    assert.equal(typeof rawRef, 'string')
    assert.match(rawRef as string, /^hmac-sha256:[a-f0-9]{64}$/)

    const artifactDirs = readdirSync(rawDir)
    assert.ok(artifactDirs.length > 0, 'expected raw capture artifact directory')
    const artifactTexts: string[] = []
    for (const entry of artifactDirs) {
      const artifactDir = join(rawDir, entry)
      if (!statSync(artifactDir).isDirectory()) continue
      for (const file of readdirSync(artifactDir)) {
        artifactTexts.push(readFileSync(join(artifactDir, file), 'utf-8'))
      }
    }
    assert.ok(artifactTexts.length >= 3, 'expected request/response/final-output artifacts')
    const joinedArtifacts = artifactTexts.join('\n')

    for (const forbidden of [rawPrompt, upstreamRaw, 'sk-ant-oat01-secret', 'cch_marker_TOKEN']) {
      assert.ok(!joinedArtifacts.includes(forbidden), `raw capture artifact leaked ${forbidden}`)
    }
    for (const forbiddenField of ['"body_utf8"', '"body_base64"', '"decoded_body_utf8"']) {
      assert.ok(!joinedArtifacts.includes(forbiddenField), `raw capture artifact contains forbidden field ${forbiddenField}`)
    }
    assert.ok(joinedArtifacts.includes('"schema_summary"'), 'safe schema summary should be retained')
    assert.ok(joinedArtifacts.includes('"body_length_bucket"'), 'safe size bucket should be retained')
    assert.ok(joinedArtifacts.includes('"body_omitted_reason"'), 'safe omission reason should be retained')
  } finally {
    if (oldRawDir === undefined) delete process.env.CC_GATEWAY_RAW_CAPTURE_DIR
    else process.env.CC_GATEWAY_RAW_CAPTURE_DIR = oldRawDir
    if (oldRawLayout === undefined) delete process.env.CC_GATEWAY_RAW_CAPTURE_LAYOUT
    else process.env.CC_GATEWAY_RAW_CAPTURE_LAYOUT = oldRawLayout
    if (oldFullRaw === undefined) delete process.env.CC_GATEWAY_FULL_RAW_CAPTURE
    else process.env.CC_GATEWAY_FULL_RAW_CAPTURE = oldFullRaw
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('disabled raw capture omits raw capture evidence ref header', async () => {
  const oldRawDir = process.env.CC_GATEWAY_RAW_CAPTURE_DIR
  delete process.env.CC_GATEWAY_RAW_CAPTURE_DIR

  const upstream = await startFakeUpstream((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })
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
      },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })

    assert.equal(response.status, 200, response.body)
    assert.equal(response.headers['x-cc-gateway-seen'], '1')
    assert.equal(response.headers['x-cc-gateway-raw-capture-ref'], undefined)
  } finally {
    if (oldRawDir === undefined) delete process.env.CC_GATEWAY_RAW_CAPTURE_DIR
    else process.env.CC_GATEWAY_RAW_CAPTURE_DIR = oldRawDir
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('raw capture does not buffer streaming responses before first downstream chunk', async () => {
  const rawDir = mkdtempSync(join(tmpdir(), 'cc-gateway-raw-stream-'))
  const oldRawDir = process.env.CC_GATEWAY_RAW_CAPTURE_DIR
  const oldRawLayout = process.env.CC_GATEWAY_RAW_CAPTURE_LAYOUT
  process.env.CC_GATEWAY_RAW_CAPTURE_DIR = rawDir
  process.env.CC_GATEWAY_RAW_CAPTURE_LAYOUT = 'per-request'

  const upstream = await startFakeUpstream((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' })
    res.write('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1,"output_tokens":0}}}\n\n')
    setTimeout(() => {
      res.write('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":1}}\n\n')
      res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n')
    }, 350)
  })
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url))

  try {
    const response = await streamPost(serverUrl(gateway, '/v1/messages?beta=true'), {
      ...ccGatewayHeaders,
      'x-cc-gateway-token': 'gateway-token',
      'x-cc-provider': 'anthropic',
      'x-cc-token-type': 'oauth',
      authorization: 'Bearer selected-token',
    }, {
      model: 'claude-sonnet-4-6',
      stream: true,
      messages: [{ role: 'user', content: 'hello' }],
    })

    assert.equal(response.status, 200, response.body)
    assert.ok(response.body.includes('message_start'), response.body)
    assert.ok(response.body.includes('message_stop'), response.body)
    assert.ok(response.firstChunkMs >= 0, 'expected at least one streamed chunk')
    assert.ok(response.firstChunkMs < 250, `first streamed chunk was buffered for ${response.firstChunkMs}ms`)
    assert.ok(readdirSync(rawDir).length > 0, 'raw capture should still write per-request artifacts')
  } finally {
    if (oldRawDir === undefined) delete process.env.CC_GATEWAY_RAW_CAPTURE_DIR
    else process.env.CC_GATEWAY_RAW_CAPTURE_DIR = oldRawDir
    if (oldRawLayout === undefined) delete process.env.CC_GATEWAY_RAW_CAPTURE_LAYOUT
    else process.env.CC_GATEWAY_RAW_CAPTURE_LAYOUT = oldRawLayout
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
