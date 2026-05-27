import { strict as assert } from 'assert'
import { request as httpRequest } from 'http'
import { startProxy, verifySharedPoolFinalOutput } from '../src/proxy.js'
import { canonicalPersonaHeaders, resolveAccountIdentity, resolveEgressBucket, runSigningPipeline } from '../src/policy.js'
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

const uuidSessionA = '123e4567-e89b-42d3-a456-426614174000'
const uuidSessionB = '123e4567-e89b-42d3-a456-426614174001'
const uuidSessionC = '123e4567-e89b-42d3-a456-426614174002'

const sharedConfig = () => baseConfig({
  mode: 'sub2api',
  auth: { gateway_token: 'gateway-token', tokens: [] },
  oauth: undefined,
  env: { ...baseConfig().env, version: '2.1.146', version_base: '2.1.146' },
  account_identities: {
    'account-a': {
      device_id: 'b'.repeat(64),
      account_uuid_hash: 'hmac-sha256:k-test:account-ref:v1:acct-a',
      email_hash: 'hmac-sha256:k-test:email-ref:v1:user-a',
      account_hash: 'hmac-sha256:k-test:account-partition:v1:acct-a',
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
    'x-claude-code-session-id': uuidSessionA,
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
  assert.equal(headers['anthropic-beta'], 'claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,effort-2025-11-24')
  assert.equal(headers['Accept-Encoding'], 'gzip, deflate, br, zstd')
  assert.equal(headers['X-Claude-Code-Session-Id'], uuidSessionA)
  assert.equal(headers['anthropic-dangerous-direct-browser-access'], 'true')
  assert.equal(headers.accept, undefined)
  assert.equal(headers.cookie, undefined)
  assert.equal(headers['x-client-current-telemetry'], undefined)
  assert.equal(headers['x-unknown'], undefined)
  assert.ok(!Object.keys(headers).some((key) => key.toLowerCase().startsWith('x-cc-')))
})

test('shared-pool verifier fails closed on persona header mismatch', () => {
  const config = sharedConfig()
  const identity = config.account_identities!['account-a']
  const headers = canonicalPersonaHeaders(config, 'messages', uuidSessionA, {
    identity,
    requestedPolicyVersion: '2.1.146',
    requestedModel: 'claude-sonnet-4-6',
  })
  headers['anthropic-beta'] = 'claude-code-20250219,wrong-beta'
  const body = Buffer.from(JSON.stringify({
    metadata: { user_id: JSON.stringify({ device_id: identity.device_id, account_uuid: identity.account_uuid_hash, session_id: uuidSessionA }) },
    messages: [{ role: 'user', content: 'hello' }],
  }), 'utf-8')
  assert.deepEqual(
    verifySharedPoolFinalOutput(config, headers, body, {
      route: 'messages',
      sessionId: uuidSessionA,
      accountIdentity: identity,
      expectedVersion: '2.1.146',
      expectedBeta: canonicalPersonaHeaders(config, 'messages', uuidSessionA, {
        identity,
        requestedPolicyVersion: '2.1.146',
        requestedModel: 'claude-sonnet-4-6',
      })['anthropic-beta'],
      billingMode: 'strip',
    }),
    { ok: false, code: 'persona_header_mismatch' },
  )
})

test('shared-pool verifier fails closed on signed cc_version mismatch', () => {
  const config = sharedConfig()
  config.env = { ...config.env, version: '2.1.150', version_base: '2.1.150' }
  config.account_identities!['account-a'] = {
    ...config.account_identities!['account-a'],
    persona_variant: 'claude-code-2.1.150-macos-local',
    policy_version: '2.1.150',
  }
  config.shared_pool = {
    billing_cch_mode: 'sign',
    signing_enabled: true,
    signing_evidence_gates_approved: true,
  } as any
  const identity = config.account_identities!['account-a']
  const headers = canonicalPersonaHeaders(config, 'messages', uuidSessionB, {
    identity,
    requestedPolicyVersion: '2.1.151',
    requestedModel: 'claude-sonnet-4-6',
  })
  const body = Buffer.from(JSON.stringify({
    metadata: { user_id: JSON.stringify({ device_id: identity.device_id, account_uuid: identity.account_uuid_hash, session_id: uuidSessionB }) },
    messages: [{ role: 'user', content: 'hello from mismatched sign lane' }],
  }), 'utf-8')
  const signed = runSigningPipeline(config, body, { cliVersion: '2.1.150' })
  assert.equal(signed.ok, true)
  if (!signed.ok) return
  assert.deepEqual(
    verifySharedPoolFinalOutput(config, headers, signed.body, {
      route: 'messages',
      sessionId: uuidSessionB,
      accountIdentity: identity,
      expectedVersion: '2.1.151',
      expectedBeta: headers['anthropic-beta'],
      billingMode: 'sign',
    }),
    { ok: false, code: 'persona_cch_version_mismatch' },
  )
})

test('account identity and egress refs reject raw identifiers and plain hashes', () => {
  const config = sharedConfig()

  const invalidIdentityCases: Array<[string, Record<string, unknown>]> = [
    ['raw-uuid-ref', { account_uuid_ref: '123e4567-e89b-42d3-a456-426614174999', account_uuid_hash: undefined }],
    ['raw-uuid-hash', { account_uuid_ref: undefined, account_uuid_hash: '123e4567-e89b-42d3-a456-426614174999' }],
    ['plain-account-digest-ref', { account_uuid_ref: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', account_uuid_hash: undefined }],
    ['plain-account-digest-hash', { account_uuid_ref: undefined, account_uuid_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
    ['raw-email-ref', { email_ref: 'user@example.com', email_hash: undefined }],
    ['raw-email-hash', { email_ref: undefined, email_hash: 'user@example.com' }],
    ['plain-email-digest-ref', { email_ref: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', email_hash: undefined }],
    ['plain-email-digest-hash', { email_ref: undefined, email_hash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }],
    ['raw-partition-ref', { account_ref: 'user@example.com', account_hash: undefined }],
    ['raw-partition-hash', { account_ref: undefined, account_hash: 'user@example.com' }],
    ['raw-uuid-partition-hash', { account_ref: undefined, account_hash: '123e4567-e89b-42d3-a456-426614174999' }],
    ['plain-partition-digest-ref', { account_ref: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', account_hash: undefined }],
    ['plain-partition-digest-hash', { account_ref: undefined, account_hash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' }],
  ]
  for (const [caseName, overrides] of invalidIdentityCases) {
    config.account_identities![caseName] = {
      ...config.account_identities!['account-a'],
      ...overrides,
    } as any
    assert.equal(resolveAccountIdentity(config, caseName), null, caseName)
  }

  const validIdentityCases: Array<[string, Record<string, unknown>, string]> = [
    ['valid-uuid-opaque-ref', { account_uuid_ref: 'opaque:account-ref:v1:acct-a', account_uuid_hash: undefined }, 'opaque:account-ref:v1:acct-a'],
    ['valid-uuid-scoped-ref', { account_uuid_ref: 'scoped_hmac_ref:key_id=test;scope=account-ref;version=1;value=acct-a', account_uuid_hash: undefined }, 'scoped_hmac_ref:key_id=test;scope=account-ref;version=1;value=acct-a'],
    ['valid-uuid-hmac-hash', { account_uuid_ref: undefined, account_uuid_hash: 'hmac-sha256:k-test:account-ref:v1:acct-a' }, 'hmac-sha256:k-test:account-ref:v1:acct-a'],
    ['valid-email-ref', { email_ref: 'opaque:email-ref:v1:user-a', email_hash: undefined }, 'hmac-sha256:k-test:account-ref:v1:acct-a'],
    ['valid-email-hash', { email_ref: undefined, email_hash: 'scoped_hmac_ref:key_id=test;scope=email-ref;version=1;value=user-a' }, 'hmac-sha256:k-test:account-ref:v1:acct-a'],
    ['valid-account-ref', { account_ref: 'opaque:partition-ref:v1:acct-a', account_hash: undefined }, 'hmac-sha256:k-test:account-ref:v1:acct-a'],
    ['valid-account-hash', { account_ref: undefined, account_hash: 'scoped_hmac_ref:key_id=test;scope=partition-ref;version=1;value=acct-a' }, 'hmac-sha256:k-test:account-ref:v1:acct-a'],
  ]
  for (const [caseName, overrides, expectedAccountUuidRef] of validIdentityCases) {
    config.account_identities![caseName] = {
      ...config.account_identities!['account-a'],
      ...overrides,
    } as any
    assert.equal(resolveAccountIdentity(config, caseName)?.account_uuid_ref, expectedAccountUuidRef, caseName)
  }

  const invalidProxyCases: Array<[string, Record<string, unknown>]> = [
    ['bad-proxy-ref-plain-digest', { proxy_identity_ref: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', proxy_identity_hash: undefined }],
    ['bad-proxy-hash-plain-digest', { proxy_identity_ref: undefined, proxy_identity_hash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }],
    ['bad-proxy-ref-raw-uuid', { proxy_identity_ref: '123e4567-e89b-42d3-a456-426614174999', proxy_identity_hash: undefined }],
    ['bad-proxy-hash-raw-uuid', { proxy_identity_ref: undefined, proxy_identity_hash: '123e4567-e89b-42d3-a456-426614174999' }],
    ['bad-proxy-ref-raw-email', { proxy_identity_ref: 'proxy@example.com', proxy_identity_hash: undefined }],
    ['bad-proxy-hash-raw-email', { proxy_identity_ref: undefined, proxy_identity_hash: 'proxy@example.com' }],
  ]
  for (const [caseName, overrides] of invalidProxyCases) {
    config.egress_buckets![caseName] = {
      ...config.egress_buckets!['bucket-a'],
      ...overrides,
    } as any
    assert.deepEqual(resolveEgressBucket(config, caseName, 'account-a'), { error: 'invalid_egress_proxy_identity_ref' }, caseName)
  }

  const validProxyCases: Array<[string, Record<string, unknown>, string]> = [
    ['valid-proxy-ref-opaque', { proxy_identity_ref: 'opaque:proxy-ref:v1:bucket-a', proxy_identity_hash: undefined }, 'opaque:proxy-ref:v1:bucket-a'],
    ['valid-proxy-hash-hmac', { proxy_identity_ref: undefined, proxy_identity_hash: 'hmac-sha256:k-test:proxy-ref:v1:bucket-a' }, 'hmac-sha256:k-test:proxy-ref:v1:bucket-a'],
    ['valid-proxy-hash-scoped', { proxy_identity_ref: undefined, proxy_identity_hash: 'scoped_hmac_ref:key_id=test;scope=proxy-ref;version=1;value=bucket-a' }, 'scoped_hmac_ref:key_id=test;scope=proxy-ref;version=1;value=bucket-a'],
  ]
  for (const [caseName, overrides, expectedProxyIdentityRef] of validProxyCases) {
    config.egress_buckets![caseName] = {
      ...config.egress_buckets!['bucket-a'],
      ...overrides,
    } as any
    assert.deepEqual(resolveEgressBucket(config, caseName, 'account-a'), {
      bucketId: caseName,
      proxyUrl: config.egress_buckets!['bucket-a'].proxy_url,
      proxyIdentityRef: expectedProxyIdentityRef,
    }, caseName)
  }
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

test('suppressed control-plane routes fail closed on spoofed persona headers', async () => {
  const upstream = await startFakeUpstream()
  const gateway = startProxy({ ...sharedConfig(), upstream: { url: upstream.url } })

  try {
    const response = await httpJson(serverUrl(gateway, '/api/event_logging/batch'), {
      headers: {
        ...sharedHeaders,
        'user-agent': 'evil-client/1.0',
        'x-app': 'evil-app',
        'anthropic-beta': 'wrong-beta',
        'x-stainless-lang': 'python',
      },
      body: { events: [{ event_data: { email: 'raw@example.com' } }] },
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(response.headers['x-cc-gateway-error-code'], 'control_plane_persona_mismatch')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
  }
})

test('suppressed control-plane routes reject downstream billing/CCH markers without invoking messages verifier', async () => {
  const upstream = await startFakeUpstream()
  const gateway = startProxy({ ...sharedConfig(), upstream: { url: upstream.url } })

  try {
    const response = await httpJson(serverUrl(gateway, '/api/event_logging/v2/batch'), {
      headers: {
        ...sharedHeaders,
        'x-anthropic-billing-header': 'cc_version=2.1.146.abc; cch=12345',
      },
      body: {
        events: [{
          event_data: {
            note: 'x-anthropic-billing-header: cc_version=2.1.146.abc; cch=12345;',
          },
        }],
      },
    })
    assert.equal(response.status, 400)
    assert.equal(response.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(response.headers['x-cc-gateway-error-code'], 'control_plane_cch_marker_forbidden')
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
  config.egress_buckets!['bucket-a'].proxy_identity_hash = 'opaque:proxy-ref:v1:bucket-fail'
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
        'x-claude-code-session-id': uuidSessionB,
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
    assert.equal(userId.session_id, uuidSessionB)
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
        'x-claude-code-session-id': uuidSessionC,
        'x-anthropic-billing-header': 'cc_version=2.1.146.abc; cch=12345',
      },
      body: {
        metadata: { user_id: JSON.stringify({ device_id: 'client-device', account_uuid: 'acct-client', session_id: 'session-old' }) },
        system: 'x-anthropic-billing-header: cc_version=2.1.146.abc; cch=12345;\nkept',
        messages: [{ role: 'user', content: 'hello' }],
      },
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    assert.equal(upstream.captured[0].headers['x-anthropic-billing-header'], undefined)
    assert.ok(!upstream.captured[0].body.includes('x-anthropic-billing-header'))
    assert.ok(!upstream.captured[0].body.includes('cch='))
    assert.ok(!upstream.captured[0].body.includes('client-device'))
    assert.ok(!upstream.captured[0].body.includes('acct-client'))
    const upstreamBody = JSON.parse(upstream.captured[0].body)
    const userId = JSON.parse(upstreamBody.metadata.user_id)
    assert.equal(userId.device_id, 'b'.repeat(64))
    assert.equal(userId.account_uuid, 'hmac-sha256:k-test:account-ref:v1:acct-a')
    assert.equal(userId.session_id, uuidSessionC)
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
      body: { metadata: { user_id: JSON.stringify({ device_id: 'client-device', account_uuid: 'acct-client', session_id: 'session-old' }) }, messages: [{ role: 'user', content: 'hello' }] },
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

test('approved signing allows literal billing header text without downstream CCH value', async () => {
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
        metadata: { user_id: JSON.stringify({ session_id: uuidSessionA }) },
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: 'Log text mentions x-anthropic-billing-header: without a cch value.' }],
        }],
      },
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    assert.match(upstream.captured[0].body, /x-anthropic-billing-header: cc_version=2\.1\.146\.[a-f0-9]{3}; cc_entrypoint=sdk-cli; cch=[a-f0-9]{5};/)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
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
        metadata: { user_id: JSON.stringify({ session_id: uuidSessionA }) },
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello from sign lane' }] }],
      },
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    const forwarded = upstream.captured[0]
    assert.match(forwarded.body, /x-anthropic-billing-header: cc_version=2\.1\.146\.[a-f0-9]{3}; cc_entrypoint=sdk-cli; cch=[a-f0-9]{5};/)
    assert.ok(!forwarded.body.includes('cch=00000;'), forwarded.body)
    assert.equal(forwarded.headers['user-agent'], 'claude-cli/2.1.146 (external, sdk-cli)')
    assert.equal(forwarded.headers['x-claude-code-session-id'], uuidSessionA)
    assert.equal(proxy.connectTargets.length, 1)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('sign-primary same-minor drift keeps final UA and signed cc_version aligned with resolver decision', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const config = sharedConfig()
  config.env = { ...config.env, version: '2.1.150', version_base: '2.1.150' }
  config.account_identities!['account-a'] = {
    ...config.account_identities!['account-a'],
    persona_variant: 'claude-code-2.1.150-macos-local',
    policy_version: '2.1.150',
  }
  config.shared_pool = {
    billing_cch_mode: 'sign',
    signing_enabled: true,
    signing_evidence_gates_approved: true,
  } as any
  config.egress_buckets!['bucket-a'].proxy_url = proxy.url
  const gateway = startProxy({ ...config, upstream: { url: upstream.url } } as any)

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        ...sharedHeaders,
        'x-cc-policy-version': '2.1.151',
        'x-sub2api-persona-trusted': '1',
      },
      body: {
        metadata: { user_id: JSON.stringify({ session_id: uuidSessionB }) },
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello from minor drift sign lane' }] }],
      },
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    const forwarded = upstream.captured[0]
    assert.equal(forwarded.headers['user-agent'], 'claude-cli/2.1.151 (external, sdk-cli)')
    assert.match(forwarded.body, /x-anthropic-billing-header: cc_version=2\.1\.151\.[a-f0-9]{3}; cc_entrypoint=sdk-cli; cch=[a-f0-9]{5};/)
    assert.equal(forwarded.headers['x-claude-code-session-id'], uuidSessionB)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('same-minor drift without internal trust header fails closed before upstream forwarding', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const config = sharedConfig()
  config.env = { ...config.env, version: '2.1.150', version_base: '2.1.150' }
  config.account_identities!['account-a'] = {
    ...config.account_identities!['account-a'],
    persona_variant: 'claude-code-2.1.150-macos-local',
    policy_version: '2.1.150',
  }
  config.shared_pool = {
    billing_cch_mode: 'sign',
    signing_enabled: true,
    signing_evidence_gates_approved: true,
  } as any
  config.egress_buckets!['bucket-a'].proxy_url = proxy.url
  const gateway = startProxy({ ...config, upstream: { url: upstream.url } } as any)

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        ...sharedHeaders,
        'x-cc-policy-version': '2.1.151',
      },
      body: {
        metadata: { user_id: JSON.stringify({ session_id: uuidSessionB }) },
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello from untrusted minor drift lane' }] }],
      },
    })
    assert.equal(response.status, 403, response.body)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'persona_quarantine_unknown_major')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})


test('raw capture omits raw bodies and plain digests while retaining safe response summaries', async () => {
  const { gzipSync } = await import('zlib')
  const { mkdtempSync, readFileSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  const payload = JSON.stringify({ ok: true, usage: { input_tokens: 1, output_tokens: 2 } })
  const upstream = await startFakeUpstream((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' })
    res.end(gzipSync(Buffer.from(payload, 'utf-8')))
  })
  const proxy = await startFakeConnectProxy()
  const config = sharedConfig()
  config.egress_buckets!['bucket-a'].proxy_url = proxy.url
  const gateway = startProxy({ ...config, upstream: { url: upstream.url } } as any)
  const dir = mkdtempSync(join(tmpdir(), 'cc-gateway-raw-capture-'))
  const previous = process.env.CC_GATEWAY_RAW_CAPTURE_DIR
  process.env.CC_GATEWAY_RAW_CAPTURE_DIR = dir

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: sharedHeaders,
      body: { metadata: { user_id: JSON.stringify({ session_id: 'session-old' }) }, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 200)
    const requestCapture = JSON.parse(readFileSync(join(dir, '01_final_upstream_request.json'), 'utf-8'))
    const responseCapture = JSON.parse(readFileSync(join(dir, '02_upstream_response.json'), 'utf-8'))
    const finalOutputCapture = JSON.parse(readFileSync(join(dir, '03_final_output.json'), 'utf-8'))

    assert.equal(requestCapture.body_omitted_reason, 'raw_upstream_request_forbidden')
    assert.equal(requestCapture.digest_omitted_reason, 'plain_body_digest_forbidden')
    assert.equal(Array.isArray(requestCapture.header_names), true)
    assert.equal(typeof requestCapture.schema_summary, 'object')
    assert.equal(requestCapture.body, undefined)
    assert.equal(requestCapture.final_signed_body, undefined)
    assert.equal(requestCapture.body_sha256, undefined)

    assert.equal(responseCapture.body_encoding, 'gzip')
    assert.equal(responseCapture.body_omitted_reason, 'raw_upstream_response_forbidden')
    assert.equal(responseCapture.digest_omitted_reason, 'plain_body_digest_forbidden')
    assert.equal(responseCapture.decoded_body_omitted_reason, 'raw_decoded_response_forbidden')
    assert.equal(typeof responseCapture.decoded_schema_summary, 'object')
    assert.equal(responseCapture.body_base64, undefined)
    assert.equal(responseCapture.decoded_body, undefined)
    assert.equal(responseCapture.decoded_body_sha256, undefined)

    assert.equal(finalOutputCapture.body_omitted_reason, 'raw_final_output_forbidden')
    assert.equal(finalOutputCapture.digest_omitted_reason, 'plain_body_digest_forbidden')
    assert.equal(typeof finalOutputCapture.cch_present, 'boolean')
    assert.equal(finalOutputCapture.cch, undefined)
    assert.equal(finalOutputCapture.signing_input_body, undefined)
    assert.equal(finalOutputCapture.signing_output_body, undefined)
    assert.ok(!JSON.stringify(requestCapture).includes('client-device'))
    assert.ok(!JSON.stringify(requestCapture).includes('acct-client'))
    assert.ok(!JSON.stringify(responseCapture).includes('client-device'))
    assert.ok(!JSON.stringify(responseCapture).includes('acct-client'))
    assert.ok(!JSON.stringify(finalOutputCapture).includes('client-device'))
    assert.ok(!JSON.stringify(finalOutputCapture).includes('acct-client'))
  } finally {
    if (previous === undefined) delete process.env.CC_GATEWAY_RAW_CAPTURE_DIR
    else process.env.CC_GATEWAY_RAW_CAPTURE_DIR = previous
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
