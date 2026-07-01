import { strict as assert } from 'assert'
import { createHmac } from 'crypto'
import { loadConfig } from '../src/config.js'
import { assertNoRawTLSProfileMaterial } from '../src/egress-tls-profile.js'
import { baseConfig, close, finish, httpJson, serverUrl, startFakeConnectProxy, startFakeUpstream, test, writeConfigYaml, configYaml } from './helpers.js'
import { startProxy } from '../src/proxy.js'

console.log('\ntests/egress-tls-profile.test.ts')

const attestationSecret = 'scheduler-hmac-material-v1-local-safe-fixture-123456'
const internalControlToken = 'internal-control-material-v1-local-safe-fixture-123456'
const expectedTLSProfileRef = 'tls-profile:claude-code-2.1.179-real-oracle-tcp-v1'
const envResidueProfileRef = 'env-residue-profile:claude-code-2.1.179-us-pacific-official-anthropic-v1'
const localeProfileRef = 'locale-profile:us-pacific-v1'
const baseUrlResidueProfileRef = 'base-url-residue-profile:official-anthropic-v1'

function canonicalFormalPoolContext(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = value[key]
    return acc
  }, {} as Record<string, unknown>))
}

function signedFormalPoolHeaders(context: Record<string, unknown>, secret = attestationSecret) {
  const canonical = canonicalFormalPoolContext(context)
  return {
    'x-cc-formal-pool-context': Buffer.from(canonical, 'utf-8').toString('base64url'),
    'x-cc-formal-pool-signature': `hmac-sha256:${createHmac('sha256', secret).update(canonical).digest('hex')}`,
  }
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

function formalPoolContext(overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    route_class: 'messages',
    path: '/v1/messages',
    account_id: 'account-a',
    token_type: 'oauth',
    credential_ref: 'opaque:credential-ref:v1:cred-a',
    credential_source: 'server_account_credentials',
    egress_bucket: 'bucket-a',
    proxy_identity_ref: 'opaque:proxy-ref:v1:bucket-a',
    egress_tls_profile_ref: expectedTLSProfileRef,
    policy_version: '2.1.179',
    persona_profile: 'claude-code-2.1.179-macos-local',
    session_id: '123e4567-e89b-42d3-a456-426614174999',
    timestamp_ms: Date.now(),
    nonce: `tls-profile-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    trusted_egress_profile_ref: 'strip_attribution',
    profile_policy_version: 'claude_code_2_1_179_cp1_degraded_v1',
    billing_shape_policy: 'strip',
    request_shape_profile_ref: 'claude_code_2_1_179_messages_streaming_tooldefs_degraded_v1',
    cache_parity_profile_ref: 'claude_code_2_1_179_cache_parity_degraded_v1',
    env_residue_profile_ref: envResidueProfileRef,
    locale_profile_ref: localeProfileRef,
    base_url_residue_profile_ref: baseUrlResidueProfileRef,
    observed_client_profile: {
      schema_version: 'observed_client_profile.v1',
      cli_version_bucket: '2.1.179',
      route_class: 'messages',
      billing_shape: 'cch_present',
      billing_block_count: 1,
      cc_entrypoint_bucket: 'sdk-cli',
      stream: true,
    },
    ...overrides,
  }
}

function messageBody() {
  return {
    metadata: { user_id: JSON.stringify({ session_id: '123e4567-e89b-42d3-a456-426614174999' }) },
    stream: true,
    messages: [{ role: 'user', content: 'hello' }],
  }
}

function tlsProfileConfig(upstreamUrl: string, proxyUrl: string, overrides: Record<string, unknown> = {}) {
  return baseConfig({
    mode: 'sub2api',
    upstream: { url: upstreamUrl },
    auth: { gateway_token: 'gateway-token', internal_control_token: internalControlToken, tokens: [] },
    oauth: undefined,
    shared_pool: {
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:test',
      context_attestation_secret: attestationSecret,
      egress_tls: { enabled: true, strict: true },
    },
    tls_profiles: {
      'claude-code-real-oracle-2179': {
        profile_ref: expectedTLSProfileRef,
        source: 'observed-oracle-63',
        enabled: true,
      },
      'node24-known-mismatch': {
        profile_ref: 'tls-profile:claude-code-node24-default',
        source: 'observed-oracle-63',
        enabled: true,
      },
    },
    account_identities: {
      'account-a': {
        device_id: 'b'.repeat(64),
        account_uuid_ref: 'hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        account_ref: 'hmac-sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        credential_ref: 'opaque:credential-ref:v1:cred-a',
        credential_binding_hmac: credentialBindingHmac('Bearer selected-token'),
        persona_variant: 'claude-code-2.1.179-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.179',
      },
    },
    egress_buckets: {
      'bucket-a': {
        enabled: true,
        proxy_url: proxyUrl,
        proxy_identity_ref: 'opaque:proxy-ref:v1:bucket-a',
        allowed_account_ids: ['account-a'],
        tls_profile_ref: expectedTLSProfileRef,
      },
    },
    env: { ...baseConfig().env, version: '2.1.179', version_base: '2.1.179' },
    ...overrides,
  } as any)
}

test('config rejects unsafe TLS refs and raw TLS template material', () => {
  const badRefYaml = configYaml(`
mode: sub2api
auth:
  gateway_token: gateway-token
  internal_control_token: ${internalControlToken}
shared_pool:
  context_attestation_secret_ref: opaque:attestation-ref:v1:formal-pool
  context_attestation_secret: ${attestationSecret}
  egress_tls:
    enabled: true
    strict: true
tls_profiles:
  bad:
    profile_ref: https://example.invalid/raw-profile
    source: observed-oracle-63
    enabled: true
account_identities:
  account-a:
    device_id: ${'a'.repeat(64)}
    account_uuid_ref: opaque:account-ref:v1:acct-a
    credential_ref: opaque:credential-ref:v1:cred-a
    credential_binding_hmac: hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    persona_variant: claude-code-2.1.179-macos-local
    session_policy: preserve_downstream_session_id
    policy_version: "2.1.179"
egress_buckets:
  bucket-a:
    enabled: true
    proxy_url: http://127.0.0.1:8080
    proxy_identity_ref: opaque:proxy-ref:v1:bucket-a
    allowed_account_ids: [account-a]
    tls_profile_ref: https://example.invalid/raw-profile
`).replace(/auth:\n  tokens:\n    - name: client\n      token: client-token\n/, '').replace(/oauth:\n  refresh_token: refresh-token\n/, '')
  assert.throws(() => loadConfig(writeConfigYaml(badRefYaml)), /tls_profile_ref|profile_ref/i)

  const rawMaterialYaml = badRefYaml
    .replace(/profile_ref: https:\/\/example\.invalid\/raw-profile/g, `profile_ref: ${expectedTLSProfileRef}`)
    .replace(/tls_profile_ref: https:\/\/example\.invalid\/raw-profile/g, `tls_profile_ref: ${expectedTLSProfileRef}`)
    .replace('enabled: true\naccount_identities:', 'enabled: true\n    safe_note: omitted_by_policy\naccount_identities:')
  assert.doesNotThrow(() => loadConfig(writeConfigYaml(rawMaterialYaml)))

  const rawMaterialKeyYaml = rawMaterialYaml.replace('  bad:', '  ' + ('client' + 'Hello') + ':')
  assert.throws(() => loadConfig(writeConfigYaml(rawMaterialKeyYaml)), /raw TLS profile material|forbidden/i)

  for (const forbiddenKey of ['client' + 'Hello', 'cert' + '_pem', 'private' + '_key', 'cipher' + '_suites']) {
    assert.throws(
      () => assertNoRawTLSProfileMaterial('tls_profiles.bad', { nested: { [forbiddenKey]: 'omitted_by_policy' } }),
      /raw TLS profile material|forbidden/i,
      forbiddenKey,
    )
  }

  const forbiddenValue = 'omitted_by_policy ' + 'client' + 'Hello' + ' ' + 'cipher' + '_suites'
  assert.throws(
    () => assertNoRawTLSProfileMaterial('tls_profiles.bad', { nested: { safe_note: forbiddenValue } }, { scanStringValues: true }),
    /raw TLS profile material|forbidden/i,
    'primitive values must be scanned too',
  )
})

test('strict mode fails closed when attested TLS profile is missing or mismatched', async () => {
  for (const [caseName, contextOverrides, expectedCode] of [
    ['missing', { egress_tls_profile_ref: undefined }, 'missing_egress_tls_profile_ref'],
    ['mismatch', { egress_tls_profile_ref: 'tls-profile:claude-code-node24-default' }, 'formal_pool_context_mismatch'],
    ['unknown', { egress_tls_profile_ref: 'tls-profile:unknown-future' }, 'unknown_egress_tls_profile_ref'],
  ] as Array<[string, Record<string, unknown>, string]>) {
    const upstream = await startFakeUpstream()
    const proxy = await startFakeConnectProxy()
    const gateway = startProxy(tlsProfileConfig(upstream.url, proxy.url))
    const context = formalPoolContext({ nonce: `strict-${caseName}`, ...contextOverrides })
    if (contextOverrides.egress_tls_profile_ref === undefined) delete (context as any).egress_tls_profile_ref
    try {
      const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
        headers: {
          'x-cc-gateway-token': 'gateway-token',
          'x-cc-provider': 'anthropic',
          'x-cc-account-id': 'account-a',
          'x-cc-token-type': 'oauth',
          'x-cc-credential-ref': 'opaque:credential-ref:v1:cred-a',
          'x-cc-egress-bucket': 'bucket-a',
          'x-cc-policy-version': '2.1.179',
          authorization: 'Bearer selected-token',
          'x-claude-code-session-id': '123e4567-e89b-42d3-a456-426614174999',
          ...signedFormalPoolHeaders(context),
        },
        body: messageBody(),
      })
      assert.equal(response.status, 403, caseName)
      assert.equal(response.headers['x-cc-gateway-error-code'], expectedCode, caseName)
      assert.equal(upstream.captured.length, 0, caseName)
    } finally {
      await close(gateway)
      await close(upstream.server)
      await close(proxy.server)
    }
  }
})



test('strict profile authority fails closed when the TLS sidecar execution path is unavailable', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(tlsProfileConfig(upstream.url, proxy.url))
  const context = formalPoolContext({ nonce: 'strict-no-sidecar-fail-closed' })
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-account-id': 'account-a',
        'x-cc-token-type': 'oauth',
        'x-cc-credential-ref': 'opaque:credential-ref:v1:cred-a',
        'x-cc-egress-bucket': 'bucket-a',
        'x-cc-policy-version': '2.1.179',
        authorization: 'Bearer selected-token',
        'x-claude-code-session-id': '123e4567-e89b-42d3-a456-426614174999',
        ...signedFormalPoolHeaders(context),
      },
      body: messageBody(),
    })
    assert.equal(response.status, 403, response.body)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'egress_tls_sidecar_disabled')
    assert.notEqual(response.headers['x-cc-egress-tls-profile-status'], 'verified')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('degraded mode with matching TLS refs still marks tls_profile_unverified', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(tlsProfileConfig(upstream.url, proxy.url, {
    shared_pool: {
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:test',
      context_attestation_secret: attestationSecret,
      egress_tls: { enabled: true, strict: false },
    },
  }))
  const context = formalPoolContext({ nonce: 'degraded-present-tls' })
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-account-id': 'account-a',
        'x-cc-token-type': 'oauth',
        'x-cc-credential-ref': 'opaque:credential-ref:v1:cred-a',
        'x-cc-egress-bucket': 'bucket-a',
        'x-cc-policy-version': '2.1.179',
        authorization: 'Bearer selected-token',
        'x-claude-code-session-id': '123e4567-e89b-42d3-a456-426614174999',
        ...signedFormalPoolHeaders(context),
      },
      body: messageBody(),
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(response.headers['x-cc-egress-tls-profile-status'], 'tls_profile_unverified')
    assert.equal(upstream.captured.length, 1)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('degraded mode permits plumbing only and marks tls_profile_unverified', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(tlsProfileConfig(upstream.url, proxy.url, {
    shared_pool: {
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:test',
      context_attestation_secret: attestationSecret,
      egress_tls: { enabled: true, strict: false },
    },
    egress_buckets: {
      'bucket-a': {
        enabled: true,
        proxy_url: proxy.url,
        proxy_identity_ref: 'opaque:proxy-ref:v1:bucket-a',
        allowed_account_ids: ['account-a'],
      },
    },
  }))
  const context = formalPoolContext({ nonce: 'degraded-missing-tls' })
  delete (context as any).egress_tls_profile_ref
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-account-id': 'account-a',
        'x-cc-token-type': 'oauth',
        'x-cc-credential-ref': 'opaque:credential-ref:v1:cred-a',
        'x-cc-egress-bucket': 'bucket-a',
        'x-cc-policy-version': '2.1.179',
        authorization: 'Bearer selected-token',
        'x-claude-code-session-id': '123e4567-e89b-42d3-a456-426614174999',
        ...signedFormalPoolHeaders(context),
      },
      body: messageBody(),
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(response.headers['x-cc-egress-tls-profile-status'], 'tls_profile_unverified')
    assert.equal(upstream.captured.length, 1)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

await finish()
