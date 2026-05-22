import { strict as assert } from 'assert'
import { request as httpRequest } from 'http'
import { startProxy } from '../src/proxy.js'
import { rewriteHeaders } from '../src/rewriter.js'
import { baseConfig, close, finish, httpJson, serverUrl, startFakeConnectProxy, startFakeUpstream, test } from './helpers.js'

console.log('\ntests/checkpoint3-remediation.test.ts')

const sharedHeaders = {
  'x-cc-gateway-token': 'gateway-token',
  'x-cc-provider': 'anthropic',
  'x-cc-account-id': 'account-a',
  'x-cc-token-type': 'oauth',
  authorization: 'Bearer selected-token',
  'x-cc-egress-bucket': 'bucket-a',
  'x-cc-policy-version': '2.1.146',
}

const sharedConfig = () => baseConfig({
  mode: 'sub2api',
  auth: { gateway_token: 'gateway-token', tokens: [] },
  oauth: undefined,
  env: { ...baseConfig().env, version: '2.1.146', version_base: '2.1.146' },
  account_identities: {
    'account-a': {
      device_id: 'b'.repeat(64),
        account_uuid_hash: 'sha256:account-uuid',
      email_hash: 'sha256:email-a',
      account_hash: 'sha256:account-a',
      persona_variant: 'claude-code-2.1.146-macos-local',
      session_policy: 'preserve_downstream_session_id',
      policy_version: '2.1.146',
    },
  },
  egress_buckets: {
    'bucket-a': {
      enabled: true,
      proxy_url: 'http://127.0.0.1:65535',
      proxy_identity_hash: 'sha256:proxy-a',
      allowed_account_ids: ['account-a'],
    },
  },
} as any)

test('sub2api shared-pool header policy synthesizes canonical allowlist and drops contradictory downstream headers', () => {
  const headers = rewriteHeaders({
    authorization: 'Bearer selected-token',
    'x-api-key': 'incidental-api-key',
    'user-agent': 'evil-client/1.0',
    'x-app': 'evil-app',
    'x-stainless-lang': 'python',
    'x-stainless-os': 'Linux',
    'x-stainless-arch': 'x64',
    'x-stainless-package-version': '9.9.9',
    'x-stainless-runtime': 'bun',
    'x-stainless-runtime-version': 'v0.0.0',
    'x-stainless-retry-count': '99',
    'x-stainless-timeout': '1',
    'anthropic-beta': 'wrong-beta',
    'anthropic-version': '2099-01-01',
    'accept-encoding': 'identity',
    'x-claude-code-session-id': 'session-abc',
    'anthropic-dangerous-direct-browser-access': 'false',
    'x-cc-account-id': 'account-a',
    cookie: 'session=secret',
    'x-client-current-telemetry': 'secret-telemetry',
    'x-unknown': 'must-drop',
    accept: 'text/plain',
    'content-type': 'application/json',
  }, sharedConfig(), {
    upstreamAuth: 'oauth',
    stripGatewayControlHeaders: true,
    sharedPool: true,
    route: '/v1/messages',
  } as any)

  assert.equal(headers.authorization, 'Bearer selected-token')
  assert.equal(headers['x-api-key'], undefined)
  assert.equal(headers['User-Agent'], 'claude-cli/2.1.146 (external, sdk-cli)')
  assert.equal(headers['x-app'], 'cli')
  assert.equal(headers['X-Stainless-Lang'], 'js')
  assert.equal(headers['X-Stainless-OS'], 'MacOS')
  assert.equal(headers['X-Stainless-Arch'], 'arm64')
  assert.equal(headers['X-Stainless-Package-Version'], '0.94.0')
  assert.equal(headers['X-Stainless-Runtime'], 'node')
  assert.equal(headers['X-Stainless-Runtime-Version'], 'v24.3.0')
  assert.equal(headers['X-Stainless-Retry-Count'], '0')
  assert.equal(headers['X-Stainless-Timeout'], '600')
  assert.equal(headers['anthropic-version'], '2023-06-01')
  assert.equal(headers['anthropic-beta'], 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advisor-tool-2026-03-01,effort-2025-11-24,extended-cache-ttl-2025-04-11')
  assert.equal(headers['Accept-Encoding'], 'gzip, deflate, br, zstd')
  assert.equal(headers['X-Claude-Code-Session-Id'], 'session-abc')
  assert.equal(headers['anthropic-dangerous-direct-browser-access'], 'true')
  assert.equal(headers.accept, undefined)
  assert.equal(headers.cookie, undefined)
  assert.equal(headers['x-client-current-telemetry'], undefined)
  assert.equal(headers['x-unknown'], undefined)
  assert.ok(!Object.keys(headers).some((key) => key.toLowerCase().startsWith('x-cc-')))
})

test('sub2api route allowlist rejects auxiliary endpoints before upstream forwarding', async () => {
  const upstream = await startFakeUpstream()
  const gateway = startProxy({ ...sharedConfig(), upstream: { url: upstream.url } })

  try {
    const response = await httpJson(serverUrl(gateway, '/api/organizations/abc/settings'), {
      headers: sharedHeaders,
      body: { ok: true },
    })
    assert.equal(response.status, 404)
    assert.equal(response.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(response.headers['x-cc-gateway-error-code'], 'unsupported_route')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
  }
})


test('sub2api blocks messages with non-allowlisted query and defers count_tokens before forwarding', async () => {
  const upstream = await startFakeUpstream()
  const gateway = startProxy({ ...sharedConfig(), upstream: { url: upstream.url } })

  try {
    const badQuery = await httpJson(serverUrl(gateway, '/v1/messages?beta=false'), {
      headers: sharedHeaders,
      body: { metadata: { user_id: JSON.stringify({ session_id: 'session-old' }) }, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(badQuery.status, 404)
    assert.equal(badQuery.headers['x-cc-gateway-error-code'], 'unsupported_route')

    const countTokens = await httpJson(serverUrl(gateway, '/v1/messages/count_tokens?beta=true'), {
      headers: sharedHeaders,
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(countTokens.status, 403)
    assert.equal(countTokens.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(countTokens.headers['x-cc-gateway-error-code'], 'count_tokens_deferred')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
  }
})

test('event_logging legacy and v2 are suppressed locally and never forwarded', async () => {
  const upstream = await startFakeUpstream()
  const gateway = startProxy({ ...sharedConfig(), upstream: { url: upstream.url } })

  try {
    for (const path of ['/api/event_logging/batch', '/api/event_logging/v2/batch']) {
      const response = await httpJson(serverUrl(gateway, path), {
        headers: sharedHeaders,
        body: { events: [{ event_data: { email: 'raw@example.com' } }] },
      })
      assert.equal(response.status, 204, `${path}: ${response.body}`)
      assert.equal(response.headers['x-cc-gateway-event-policy'], 'suppress')
    }
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
  }
})

test('missing per-account identity fails closed', async () => {
  const upstream = await startFakeUpstream()
  const config = sharedConfig()
  const gateway = startProxy({ ...config, upstream: { url: upstream.url }, account_identities: {} } as any)

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: sharedHeaders,
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'missing_account_identity')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
  }
})

test('unknown or disabled egress bucket fails closed before any direct connection', async () => {
  const upstream = await startFakeUpstream()
  const gateway = startProxy({ ...sharedConfig(), upstream: { url: upstream.url } })

  try {
    const unknown = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: { ...sharedHeaders, 'x-cc-egress-bucket': 'bucket-missing' },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(unknown.status, 403)
    assert.equal(unknown.headers['x-cc-gateway-error-code'], 'unknown_egress_bucket')

    const disabledConfig = sharedConfig()
    disabledConfig.egress_buckets!['bucket-a'].enabled = false
    const disabledGateway = startProxy({ ...disabledConfig, upstream: { url: upstream.url } } as any)
    try {
      const disabled = await httpJson(serverUrl(disabledGateway, '/v1/messages?beta=true'), {
        headers: sharedHeaders,
        body: { messages: [{ role: 'user', content: 'hello' }] },
      })
      assert.equal(disabled.status, 403)
      assert.equal(disabled.headers['x-cc-gateway-error-code'], 'disabled_egress_bucket')
    } finally {
      await close(disabledGateway)
    }

    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
  }
})

test('egress proxy failure is a control-plane error and does not expose raw proxy credentials', async () => {
  const upstream = await startFakeUpstream()
  const config = sharedConfig()
  config.egress_buckets!['bucket-a'].proxy_url = 'http://user:pass@127.0.0.1:1'
  config.egress_buckets!['bucket-a'].proxy_identity_hash = 'sha256:proxy-fail'
  const gateway = startProxy({ ...config, upstream: { url: upstream.url } } as any)

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: sharedHeaders,
      body: { messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 502)
    assert.equal(response.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(response.headers['x-cc-gateway-error-code'], 'egress_proxy_failure')
    assert.ok(!response.body.includes('user:pass'))
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
  }
})


test('body cap fails closed before forwarding shared-pool messages', async () => {
  const upstream = await startFakeUpstream()
  const config = sharedConfig()
  config.shared_pool = { max_body_bytes: 16 }
  const gateway = startProxy({ ...config, upstream: { url: upstream.url } } as any)

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: sharedHeaders,
      body: { messages: [{ role: 'user', content: 'this body is intentionally over the tiny cap' }] },
    })
    assert.equal(response.status, 413)
    assert.equal(response.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(response.headers['x-cc-gateway-error-code'], 'body_too_large')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
  }
})

test('retry contract fails closed when a body-mutating retry did not re-enter final-output pipeline', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const config = sharedConfig()
  config.egress_buckets!['bucket-a'].proxy_url = proxy.url
  const gateway = startProxy({ ...config, upstream: { url: upstream.url } } as any)

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        ...sharedHeaders,
        'x-cc-retry-attempt': '1',
        'x-cc-retry-body-mutated': 'true',
      },
      body: {
        metadata: { user_id: JSON.stringify({ session_id: 'session-old' }) },
        messages: [{ role: 'user', content: 'retry mutated body' }],
      },
    })
    assert.equal(response.status, 409)
    assert.equal(response.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(response.headers['x-cc-gateway-error-code'], 'retry_body_mutation_without_reentry')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('retry contract re-enters strip final-output pipeline for approved body-mutating retries', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const config = sharedConfig()
  config.egress_buckets!['bucket-a'].proxy_url = proxy.url
  const gateway = startProxy({ ...config, upstream: { url: upstream.url } } as any)

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        ...sharedHeaders,
        'x-cc-retry-attempt': '1',
        'x-cc-retry-body-mutated': 'true',
        'x-cc-retry-final-output-reentered': 'true',
        'x-claude-code-session-id': 'session-retry',
      },
      body: {
        metadata: { user_id: JSON.stringify({ device_id: 'downstream-device', account_uuid: 'downstream-account', session_id: 'session-old' }) },
        system: 'x-anthropic-billing-header: cc_version=2.1.146.abc; cch=12345;\nkept',
        messages: [{ role: 'user', content: 'retry re-entered body' }],
      },
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    assert.ok(!Object.keys(upstream.captured[0].headers).some((key) => key.startsWith('x-cc-retry-')))
    assert.ok(!upstream.captured[0].body.includes('x-anthropic-billing-header'))
    assert.ok(!upstream.captured[0].body.includes('cch='))
    const upstreamBody = JSON.parse(upstream.captured[0].body)
    const userId = JSON.parse(upstreamBody.metadata.user_id)
    assert.equal(userId.device_id, 'b'.repeat(64))
    assert.equal(userId.session_id, 'session-retry')
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('retry contract rejects changed policy/gates and sign-to-strip downgrades', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const config = sharedConfig()
  config.egress_buckets!['bucket-a'].proxy_url = proxy.url
  const gateway = startProxy({ ...config, upstream: { url: upstream.url } } as any)

  try {
    const policyChanged = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        ...sharedHeaders,
        'x-cc-retry-attempt': '1',
        'x-cc-retry-header-policy-changed': 'true',
      },
      body: {
        metadata: { user_id: JSON.stringify({ session_id: 'session-old' }) },
        messages: [{ role: 'user', content: 'retry policy changed' }],
      },
    })
    assert.equal(policyChanged.status, 409)
    assert.equal(policyChanged.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(policyChanged.headers['x-cc-gateway-error-code'], 'retry_policy_changed_without_reentry')

    const modeChanged = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        ...sharedHeaders,
        'x-cc-retry-attempt': '1',
        'x-cc-retry-previous-billing-cch-mode': 'sign',
      },
      body: {
        metadata: { user_id: JSON.stringify({ session_id: 'session-old' }) },
        messages: [{ role: 'user', content: 'retry mode changed' }],
      },
    })
    assert.equal(modeChanged.status, 409)
    assert.equal(modeChanged.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(modeChanged.headers['x-cc-gateway-error-code'], 'retry_billing_mode_changed')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('strip verifier removes billing/CCH and rewrites per-account metadata before forwarding', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const config = sharedConfig()
  config.egress_buckets!['bucket-a'].proxy_url = proxy.url
  const gateway = startProxy({ ...config, upstream: { url: upstream.url } } as any)

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        ...sharedHeaders,
        'x-claude-code-session-id': 'session-xyz',
        'x-anthropic-billing-header': 'cc_version=2.1.146.abc; cch=12345',
      },
      body: {
        metadata: { user_id: JSON.stringify({ device_id: 'downstream-device', account_uuid: 'downstream-account', session_id: 'session-old' }) },
        system: 'x-anthropic-billing-header: cc_version=2.1.146.abc; cch=12345;\nkept',
        messages: [{ role: 'user', content: 'hello' }],
      },
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    assert.equal(upstream.captured[0].headers['x-anthropic-billing-header'], undefined)
    assert.ok(!upstream.captured[0].body.includes('x-anthropic-billing-header'))
    assert.ok(!upstream.captured[0].body.includes('cch='))
    const upstreamBody = JSON.parse(upstream.captured[0].body)
    const userId = JSON.parse(upstreamBody.metadata.user_id)
    assert.equal(userId.device_id, 'b'.repeat(64))
    assert.equal(userId.session_id, 'session-xyz')
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})


test('strip verifier fails closed if billing markers remain after rewrite', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const config = sharedConfig()
  config.egress_buckets!['bucket-a'].proxy_url = proxy.url
  const gateway = startProxy({ ...config, upstream: { url: upstream.url } } as any)

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: sharedHeaders,
      body: {
        metadata: { user_id: JSON.stringify({ device_id: 'downstream-device', session_id: 'session-old' }) },
        messages: [{ role: 'user', content: 'literal cch=12345 must fail verifier' }],
      },
    })
    assert.equal(response.status, 400)
    assert.equal(response.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(response.headers['x-cc-gateway-error-code'], 'strip_verifier_failed')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('signing mode skeleton is disabled unless manually approved gates are present', async () => {
  const upstream = await startFakeUpstream()
  const config = sharedConfig()
  config.shared_pool = { billing_cch_mode: 'sign' } as any
  const gateway = startProxy({ ...config, upstream: { url: upstream.url } } as any)

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: sharedHeaders,
      body: { metadata: { user_id: JSON.stringify({ session_id: 'session-old' }) }, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(response.headers['x-cc-gateway-error-code'], 'signing_mode_disabled')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
  }
})

test('rollback to billing_cch_mode disabled fails closed without native fallback', async () => {
  const upstream = await startFakeUpstream()
  const config = sharedConfig()
  config.shared_pool = { billing_cch_mode: 'disabled' } as any
  const gateway = startProxy({ ...config, upstream: { url: upstream.url } } as any)

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: sharedHeaders,
      body: { metadata: { user_id: JSON.stringify({ session_id: 'session-old' }) }, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(response.headers['x-cc-gateway-error-code'], 'billing_cch_mode_disabled')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
  }
})


test('redacted log paths hide all query values including beta', async () => {
  const upstream = await startFakeUpstream()
  const config = sharedConfig()
  config.logging = { level: 'info', audit: false }
  const gateway = startProxy({ ...config, upstream: { url: upstream.url } } as any)
  const originalLog = console.log
  const logs: string[] = []
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')) }

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=false&api_key=query-secret'), {
      headers: sharedHeaders,
      body: { metadata: { user_id: JSON.stringify({ session_id: 'session-old' }) }, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 404)
  } finally {
    console.log = originalLog
    await close(gateway)
    await close(upstream.server)
  }
  const joined = logs.join('\n')
  assert.ok(!joined.includes('beta=false'), joined)
  assert.ok(!joined.includes('query-secret'), joined)
  assert.ok(joined.includes('beta=<redacted>'), joined)
})

test('signing skeleton fails closed even when local signing flag is enabled but gates are unapproved', async () => {
  const upstream = await startFakeUpstream()
  const config = sharedConfig()
  config.shared_pool = { billing_cch_mode: 'sign', signing_enabled: true } as any
  const gateway = startProxy({ ...config, upstream: { url: upstream.url } } as any)

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: sharedHeaders,
      body: { metadata: { user_id: JSON.stringify({ session_id: 'session-old' }) }, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(response.headers['x-cc-gateway-error-code'], 'signing_evidence_gates_unapproved')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
  }
})

test('invalid gateway token emits stable control-plane wire contract', async () => {
  const upstream = await startFakeUpstream()
  const config = sharedConfig()
  const gateway = startProxy({ ...config, upstream: { url: upstream.url } } as any)

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: { ...sharedHeaders, 'x-cc-gateway-token': 'wrong-token' },
      body: { metadata: { user_id: JSON.stringify({ session_id: 'session-old' }) }, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 401)
    assert.equal(response.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(response.headers['x-cc-gateway-error-code'], 'missing_gateway_token')
    assert.equal(response.json?.error?.type, 'cc_gateway_control_plane')
    assert.equal(response.json?.error?.code, 'missing_gateway_token')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
  }
})

test('approved signing rejects downstream CCH material and never downgrades to strip', async () => {
  const upstream = await startFakeUpstream()
  const config = sharedConfig()
  config.shared_pool = {
    billing_cch_mode: 'sign',
    signing_enabled: true,
    signing_evidence_gates_approved: true,
  } as any
  const gateway = startProxy({ ...config, upstream: { url: upstream.url } } as any)

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: sharedHeaders,
      body: { metadata: { user_id: JSON.stringify({ session_id: 'session-old' }) }, messages: [{ role: 'user', content: 'literal cch=12345 must not be trusted' }] },
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(response.headers['x-cc-gateway-error-code'], 'signing_untrusted_billing_input')
    assert.equal(response.json?.error?.type, 'cc_gateway_control_plane')
    assert.equal(response.json?.error?.code, 'signing_untrusted_billing_input')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
  }
})

test('approved sign-primary mode generates billing CCH and forwards only after verifier passes', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const config = sharedConfig()
  config.shared_pool = {
    billing_cch_mode: 'sign',
    signing_enabled: true,
    signing_evidence_gates_approved: true,
  } as any
  config.egress_buckets!['bucket-a'].proxy_url = proxy.url
  const gateway = startProxy({ ...config, upstream: { url: upstream.url } } as any)

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: sharedHeaders,
      body: {
        metadata: { user_id: JSON.stringify({ session_id: 'session-old' }) },
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello from sign lane' }] }],
      },
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    const forwarded = upstream.captured[0]
    assert.match(forwarded.body, /x-anthropic-billing-header: cc_version=2\.1\.146\.[a-f0-9]{3}; cc_entrypoint=cli; cch=[a-f0-9]{5};/)
    assert.ok(!forwarded.body.includes('cch=00000;'), forwarded.body)
    assert.equal(forwarded.headers['user-agent'], 'claude-cli/2.1.146 (external, sdk-cli)')
    assert.equal(forwarded.headers['x-claude-code-session-id'], 'session-old')
    assert.equal(proxy.connectTargets.length, 1)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('audit/error logs redact path query secrets and do not print raw authorization', async () => {
  const upstream = await startFakeUpstream()
  const config = sharedConfig()
  config.logging = { level: 'info', audit: true }
  const gateway = startProxy({ ...config, upstream: { url: upstream.url } } as any)
  const originalLog = console.log
  const logs: string[] = []
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')) }

  try {
    const response = await httpJson(serverUrl(gateway, '/api/organizations/abc/settings?api_key=raw-secret&email=raw@example.com'), {
      headers: sharedHeaders,
      body: { ok: true },
    })
    assert.equal(response.status, 404)
  } finally {
    console.log = originalLog
    await close(gateway)
    await close(upstream.server)
  }

  const joined = logs.join('\n')
  assert.ok(!joined.includes('raw-secret'), joined)
  assert.ok(!joined.includes('raw@example.com'), joined)
  assert.ok(!joined.includes('selected-token'), joined)
  assert.ok(joined.includes('<redacted>') || joined.includes('[redacted]'), joined)
})

await finish()
