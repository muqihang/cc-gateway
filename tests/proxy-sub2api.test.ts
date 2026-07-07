import { strict as assert } from 'assert'
import { createHmac } from 'crypto'
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { request as httpRequest } from 'http'
import { startProxy } from '../src/proxy.js'
import { baseConfig, close, finish, httpJson, serverUrl, startFakeConnectProxy, startFakeUpstream, test } from './helpers.js'

console.log('\ntests/proxy-sub2api.test.ts')

const ccGatewayHeaders = {
  'x-cc-account-id': 'account-1',
  'x-cc-credential-ref': 'opaque:credential-ref:v1:cred-a',
  'x-cc-egress-bucket': 'bucket-a',
  'x-cc-policy-version': '2.1.175',
}
const defaultSessionId = '123e4567-e89b-42d3-a456-426614174999'
const attestationSecret = 'scheduler-hmac-material-v1-local-safe-fixture-123456'
const internalControlToken = 'internal-control-material-v1-local-safe-fixture-123456'
const envResidueProfileRef = 'env-residue-profile:claude-code-2.1.179-us-pacific-official-anthropic-v1'
const localeProfileRef = 'locale-profile:us-pacific-v1'
const baseUrlResidueProfileRef = 'base-url-residue-profile:official-anthropic-v1'
const sharedContractFixturePath = '/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/claude-platform-aws-formal-pool/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json'

type SharedContractFixture = {
  materials: Record<string, string>
  account: Record<string, string>
  valid_context: Record<string, unknown>
  cases: {
    one_field_mismatch: { mutate_context: Record<string, unknown>; expected_cc_gateway_error_code: string }
    expired: { timestamp_offset_ms: number; expected_cc_gateway_error_code: string }
    replay_nonce: { nonce: string; expected_cc_gateway_error_code: string }
  }
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


function canonicalFormalPoolContext(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = value[key]
    return acc
  }, {} as Record<string, unknown>))
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64url')
}



function credentialBindingHmac(rawCredential: string, tokenType: 'oauth' | 'apikey' = 'oauth', secret = 'scheduler-hmac-material-v1-local-safe-fixture-123456') {
  return `hmac-sha256:${createHmac('sha256', secret)
    .update('formal_pool_credential_binding_v1')
    .update('\0')
    .update(tokenType)
    .update('\0')
    .update(rawCredential)
    .digest('hex')}`
}

function signedFormalPoolHeaders(context: Record<string, unknown>, secret = 'scheduler-hmac-material-v1-local-safe-fixture-123456') {
  const canonical = canonicalFormalPoolContext(context)
  return {
    'x-cc-formal-pool-context': base64url(canonical),
    'x-cc-formal-pool-signature': `hmac-sha256:${createHmac('sha256', secret).update(canonical).digest('hex')}`,
  }
}

function loadSharedContractFixture(): SharedContractFixture {
  return JSON.parse(readFileSync(sharedContractFixturePath, 'utf-8')) as SharedContractFixture
}

test('sub2api shared contract fixture is loaded from current Phase B worktree and carries TLS profile ref', () => {
  assert.equal(sharedContractFixturePath, '/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/claude-platform-aws-formal-pool/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json')
  const fixture = loadSharedContractFixture()
  assert.equal(fixture.valid_context.egress_tls_profile_ref, 'tls-profile:claude-code-2.1.179-real-oracle-tcp-v1')
})

function sharedFixtureContext(fixture: SharedContractFixture, overrides: Record<string, unknown> = {}) {
  return {
    ...fixture.valid_context,
    timestamp_ms: Date.now(),
    ...overrides,
  }
}

function sharedFixtureConfig(fixture: SharedContractFixture, upstreamUrl: string, proxyUrl: string) {
  return sub2apiConfig(upstreamUrl, proxyUrl, {
    auth: {
      gateway_token: fixture.materials.gateway_control_material,
      internal_control_token: fixture.materials.internal_control_material,
      tokens: [],
    },
    shared_pool: {
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:shared-fixture',
      context_attestation_secret: fixture.materials.context_attestation_material,
    },
    account_identities: {
      [fixture.account.account_id]: {
        device_id: fixture.account.device_id,
        account_uuid_hash: fixture.account.account_uuid_ref,
        email_hash: fixture.account.email_ref,
        account_hash: fixture.account.account_ref,
        credential_ref: fixture.account.credential_ref,
        credential_binding_hmac: credentialBindingHmac(
          'Bearer selected-oauth-credential-fixture',
          'oauth',
          fixture.materials.context_attestation_material,
        ),
        persona_variant: fixture.account.persona_profile,
        session_policy: 'preserve_downstream_session_id',
        policy_version: fixture.account.policy_version,
      },
    },
    egress_buckets: {
      [fixture.account.egress_bucket]: {
        enabled: true,
        proxy_url: proxyUrl,
        proxy_identity_ref: fixture.account.proxy_identity_ref,
        allowed_account_ids: [fixture.account.account_id],
      },
    },
  })
}

function sharedFixtureHeaders(fixture: SharedContractFixture, context: Record<string, unknown>) {
  return {
    'x-cc-gateway-token': fixture.materials.gateway_control_material,
    'x-cc-provider': 'anthropic',
    'x-cc-account-id': String(fixture.valid_context.account_id),
    'x-cc-token-type': String(fixture.valid_context.token_type),
    'x-cc-credential-ref': String(fixture.valid_context.credential_ref),
    'x-cc-egress-bucket': String(fixture.valid_context.egress_bucket),
    'x-cc-policy-version': String(fixture.valid_context.policy_version),
    'x-claude-code-session-id': String(fixture.valid_context.session_id),
    authorization: 'Bearer selected-oauth-credential-fixture',
    ...signedFormalPoolHeaders(context, fixture.materials.context_attestation_material),
  }
}

function formalPoolContext(overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    route_class: 'messages',
    path: '/v1/messages',
    account_id: 'account-1',
    token_type: 'oauth',
    credential_ref: 'opaque:credential-ref:v1:cred-a',
    credential_source: 'server_account_credentials',
    egress_bucket: 'bucket-a',
    proxy_identity_ref: 'opaque:proxy-ref:v1:bucket-a',
    policy_version: '2.1.175',
    persona_profile: 'claude-code-2.1.175-macos-local',
    session_id: '123e4567-e89b-42d3-a456-426614174999',
    timestamp_ms: Date.now(),
    nonce: `nonce-${Date.now()}-${Math.random().toString(16).slice(2)}`,
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
      billing_shape: 'absent',
      billing_block_count: 0,
      cc_entrypoint_bucket: 'absent',
      stream: true,
    },
    ...overrides,
  }
}

function proxyIdentityRefForBucket(bucket: string): string {
  if (bucket === 'bucket-replay') return 'opaque:proxy-ref:v1:runtime-bucket-replay'
  if (bucket === 'bucket-b') return 'opaque:proxy-ref:v1:bucket-b'
  return 'opaque:proxy-ref:v1:bucket-a'
}

function schedulerHeaders(
  headers: Record<string, string> = {},
  contextOverrides: Record<string, unknown> = {},
) {
  const merged = {
    ...ccGatewayHeaders,
    'x-cc-gateway-token': 'gateway-token',
    'x-cc-provider': 'anthropic',
    'x-cc-token-type': 'oauth',
    'x-claude-code-session-id': defaultSessionId,
    ...headers,
  }
  const context = formalPoolContext({
    account_id: merged['x-cc-account-id'],
    token_type: merged['x-cc-token-type'],
    credential_ref: merged['x-cc-credential-ref'],
    credential_source: 'server_account_credentials',
    egress_bucket: merged['x-cc-egress-bucket'],
    policy_version: merged['x-cc-policy-version'],
    proxy_identity_ref: proxyIdentityRefForBucket(merged['x-cc-egress-bucket']),
    session_id: merged['x-claude-code-session-id'],
    ...contextOverrides,
  })
  return {
    ...merged,
    ...signedFormalPoolHeaders(context),
  }
}

function attestedSub2apiConfig(upstreamUrl: string, proxyUrl: string, overrides: Record<string, unknown> = {}) {
  return sub2apiConfig(upstreamUrl, proxyUrl, {
    auth: { gateway_token: 'gateway-token', internal_control_token: internalControlToken, tokens: [] },
    shared_pool: { context_attestation_secret_ref: 'opaque:attestation-ref:v1:test', context_attestation_secret: attestationSecret },
    account_identities: {
      'account-1': {
        device_id: 'b'.repeat(64),
        account_uuid_ref: 'hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        email_ref: 'hmac-sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        account_ref: 'hmac-sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        credential_ref: 'opaque:credential-ref:v1:cred-a',
        credential_binding_hmac: credentialBindingHmac('Bearer selected-token'),
        persona_variant: 'claude-code-2.1.175-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.175',
      },
      'account-2': {
        device_id: 'c'.repeat(64),
        account_uuid_ref: 'hmac-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        email_ref: 'hmac-sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        account_ref: 'hmac-sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        credential_ref: 'opaque:credential-ref:v1:cred-b',
        credential_binding_hmac: credentialBindingHmac('Bearer selected-token'),
        persona_variant: 'claude-code-2.1.175-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.175',
      },
    },
    egress_buckets: {
      'bucket-a': { enabled: true, proxy_url: proxyUrl, proxy_identity_ref: 'opaque:proxy-ref:v1:bucket-a', allowed_account_ids: ['account-1'] },
      'bucket-b': { enabled: true, proxy_url: proxyUrl, proxy_identity_ref: 'opaque:proxy-ref:v1:bucket-b', allowed_account_ids: ['account-2'] },
    },
    ...overrides,
  })
}

function sub2apiConfig(upstreamUrl: string, proxyUrl: string, overrides: Record<string, unknown> = {}) {
  return baseConfig({
    mode: 'sub2api',
    upstream: { url: upstreamUrl },
    auth: { gateway_token: 'gateway-token', internal_control_token: internalControlToken, tokens: [] },
    oauth: undefined,
    shared_pool: { context_attestation_secret_ref: 'opaque:attestation-ref:v1:test', context_attestation_secret: attestationSecret },
    account_identities: {
      'account-1': {
        device_id: 'b'.repeat(64),
        account_uuid_hash: 'hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        email_hash: 'hmac-sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        account_hash: 'hmac-sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        credential_ref: 'opaque:credential-ref:v1:cred-a',
        credential_binding_hmac: credentialBindingHmac('Bearer selected-token'),
        persona_variant: 'claude-code-2.1.175-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.175',
      },
    },
    egress_buckets: {
      'bucket-a': { enabled: true, proxy_url: proxyUrl, proxy_identity_ref: 'opaque:proxy-ref:v1:bucket-a', allowed_account_ids: ['account-1'] },
    },
    env: { ...baseConfig().env, version: '2.1.175', version_base: '2.1.175' },
    ...overrides,
  } as any)
}

test('formal-pool healthcheck accepts server-selected 2.1.197 persona with streaming Haiku shape', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url, {
    account_identities: {
      'account-1': {
        device_id: 'b'.repeat(64),
        account_uuid_hash: 'hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        email_hash: 'hmac-sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        account_hash: 'hmac-sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        credential_ref: 'opaque:credential-ref:v1:cred-a',
        credential_binding_hmac: credentialBindingHmac('Bearer selected-token'),
        persona_variant: 'claude-code-2.1.197-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.197',
      },
    },
    env: { ...baseConfig().env, version: '2.1.197', version_base: '2.1.197' },
  }))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        authorization: 'Bearer selected-token',
        'x-cc-policy-version': '2.1.197',
        'x-cc-internal-control-token': internalControlToken,
        'x-sub2api-healthcheck-persona': 'claude-code-2.1.197-macos-local',
      }, {
        policy_version: '2.1.197',
        persona_profile: 'claude-code-2.1.197-macos-local',
        profile_policy_version: 'claude_code_2_1_197_plan76_native_policy_v1',
        request_shape_profile_ref: 'claude_code_2_1_197_messages_streaming_tooldefs_native_v1',
        cache_parity_profile_ref: 'claude_code_2_1_197_cache_parity_native_v1',
        observed_client_profile: {
          schema_version: 'observed_client_profile.v1',
          cli_version_bucket: '2.1.197',
          route_class: 'messages',
          billing_shape: 'absent',
          billing_block_count: 0,
          cc_entrypoint_bucket: 'absent',
          stream: true,
        },
      }),
      body: {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 64,
        stream: true,
        messages: [{ role: 'user', content: 'healthcheck' }],
        tools: [],
      },
    })

    assert.notEqual(response.headers['x-cc-gateway-error-code'], 'unsupported_healthcheck_persona')
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    const forwarded = JSON.parse(upstream.captured[0].body)
    assert.equal(forwarded.model, 'claude-haiku-4-5-20251001')
    assert.equal(forwarded.stream, true)
    assert.equal(upstream.captured[0].headers['anthropic-beta']?.includes('context-1m'), false)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('sub2api Anthropic OAuth preserves selected authorization and strips all x-cc headers', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        'x-cc-extra-secret': 'must-not-leak',
        authorization: 'Bearer selected-token',
      }),
      body: { stream: true, messages: [{ role: 'user', content: 'hello' }] },
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


test('runtime registration requires internal control token', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url, {
    account_identities: {},
    egress_buckets: {},
  }))

  try {
    const response = await httpJson(serverUrl(gateway, '/_runtime/register-account'), {
      headers: { 'x-cc-gateway-token': 'gateway-token' },
      body: {
        account_id: 'runtime-account-internal-control',
        account_ref: 'opaque:account-ref:v1:runtime-internal-control',
        account_uuid_ref: 'opaque:account-ref:v1:runtime-internal-control',
        device_id: 'd'.repeat(64),
        egress_bucket: 'bucket-runtime-internal-control',
        proxy_url: proxy.url,
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-internal-control',
        credential_ref: 'opaque:credential-ref:v1:cred-a',
        credential_binding_hmac: credentialBindingHmac('Bearer selected-token'),
        token_type: 'oauth',
        policy_version: '2.1.175',
      },
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'missing_internal_control_attestation')
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('runtime registration requires account-owned device_id for formal-pool mapping', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url, {
    account_identities: {},
    egress_buckets: {},
  }))

  try {
    const missing = await httpJson(serverUrl(gateway, '/_runtime/register-account'), {
      headers: { 'x-cc-gateway-token': 'gateway-token', 'x-cc-internal-control-token': internalControlToken, authorization: 'Bearer selected-token' },
      body: {
        account_id: 'runtime-account-missing-device',
        account_ref: 'opaque:account-ref:v1:runtime-missing-device',
        account_uuid_ref: 'opaque:account-ref:v1:runtime-missing-device',
        egress_bucket: 'bucket-runtime-missing-device',
        proxy_url: proxy.url,
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-missing-device',
        credential_ref: 'opaque:credential-ref:v1:cred-a',
        credential_binding_hmac: credentialBindingHmac('Bearer selected-token'),
        token_type: 'oauth',
        policy_version: '2.1.175',
      },
    })
    assert.equal(missing.status, 400)
    assert.equal(missing.headers['x-cc-gateway-error-code'], 'missing_device_id')
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('runtime registration uses account-owned device_id in upstream metadata', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const runtimeAccountRef = 'runtime-account-device-owned'
  const runtimeSessionId = '123e4567-e89b-42d3-a456-426614174012'
  const runtimeDeviceId = 'd'.repeat(64)
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url, {
    account_identities: {},
    egress_buckets: {},
  }))

  try {
    const registered = await httpJson(serverUrl(gateway, '/_runtime/register-account'), {
      headers: { 'x-cc-gateway-token': 'gateway-token', 'x-cc-internal-control-token': internalControlToken, authorization: 'Bearer selected-token' },
      body: {
        account_id: runtimeAccountRef,
        account_ref: 'opaque:account-ref:v1:runtime-device-owned',
        account_uuid_ref: 'opaque:account-ref:v1:runtime-device-owned',
        device_id: runtimeDeviceId,
        egress_bucket: 'bucket-runtime-device-owned',
        proxy_url: proxy.url,
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-device-owned',
        credential_ref: 'opaque:credential-ref:v1:cred-a',
        credential_binding_hmac: credentialBindingHmac('Bearer selected-token'),
        token_type: 'oauth',
        policy_version: '2.1.175',
      },
    })
    assert.equal(registered.status, 200, registered.body)

    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        ...ccGatewayHeaders,
        'x-cc-account-id': runtimeAccountRef,
        'x-cc-egress-bucket': 'bucket-runtime-device-owned',
        'x-claude-code-session-id': runtimeSessionId,
        authorization: 'Bearer selected-token',
      }, { proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-device-owned', session_id: runtimeSessionId }),
      body: { stream: true, metadata: { user_id: JSON.stringify({ session_id: runtimeSessionId }) }, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 200, response.body)
    const forwarded = JSON.parse(upstream.captured[0].body)
    const userId = JSON.parse(forwarded.metadata.user_id)
    assert.equal(userId.device_id, runtimeDeviceId)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('runtime registration propagates strict TLS profile ref into dynamic egress bucket', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const runtimeAccountRef = 'hmac-sha256:runtime-account-strict-tls'
  const runtimeSessionId = '123e4567-e89b-42d3-a456-426614174014'
  const tlsProfileRef = 'tls-profile:claude-code-2.1.197-real-oracle-tcp-v1'
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url, {
    shared_pool: {
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:test',
      context_attestation_secret: attestationSecret,
      egress_tls: { enabled: true, strict: true },
    },
    tls_profiles: {
      'claude-code-real-oracle-2197': { profile_ref: tlsProfileRef, source: 'observed-oracle-2197', enabled: true },
    },
    account_identities: {},
    egress_buckets: {},
  }))

  try {
    const registered = await httpJson(serverUrl(gateway, '/_runtime/register-account'), {
      headers: { 'x-cc-gateway-token': 'gateway-token', 'x-cc-internal-control-token': internalControlToken, authorization: 'Bearer selected-token' },
      body: {
        account_id: runtimeAccountRef,
        account_ref: runtimeAccountRef,
        account_uuid_ref: runtimeAccountRef,
        device_id: 'f'.repeat(64),
        egress_bucket: 'bucket-runtime-strict-tls',
        proxy_url: proxy.url,
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-strict-tls',
        credential_ref: 'opaque:credential-ref:v1:strict-tls',
        credential_binding_hmac: credentialBindingHmac('Bearer selected-token'),
        token_type: 'oauth',
        policy_version: '2.1.197',
        persona_variant: 'claude-code-2.1.197-macos-local',
        egress_tls_profile_ref: tlsProfileRef,
      },
    })
    assert.equal(registered.status, 200, registered.body)

    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        ...ccGatewayHeaders,
        'x-cc-account-id': runtimeAccountRef,
        'x-cc-credential-ref': 'opaque:credential-ref:v1:strict-tls',
        'x-cc-egress-bucket': 'bucket-runtime-strict-tls',
        'x-cc-policy-version': '2.1.197',
        'x-claude-code-session-id': runtimeSessionId,
        authorization: 'Bearer selected-token',
      }, {
        account_id: runtimeAccountRef,
        credential_ref: 'opaque:credential-ref:v1:strict-tls',
        egress_bucket: 'bucket-runtime-strict-tls',
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-strict-tls',
        policy_version: '2.1.197',
        persona_profile: 'claude-code-2.1.197-macos-local',
        profile_policy_version: 'claude_code_2_1_197_plan76_native_policy_v1',
        request_shape_profile_ref: 'claude_code_2_1_197_messages_streaming_tooldefs_native_v1',
        cache_parity_profile_ref: 'claude_code_2_1_197_cache_parity_native_v1',
        egress_tls_profile_ref: tlsProfileRef,
        session_id: runtimeSessionId,
        observed_client_profile: {
          schema_version: 'observed_client_profile.v1',
          cli_version_bucket: '2.1.197',
          route_class: 'messages',
          billing_shape: 'absent',
          billing_block_count: 0,
          cc_entrypoint_bucket: 'absent',
          stream: true,
        },
      }),
      body: { stream: true, metadata: { user_id: JSON.stringify({ session_id: runtimeSessionId }) }, messages: [{ role: 'user', content: 'hello' }] },
    })

    assert.equal(response.status, 403, response.body)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'egress_tls_sidecar_disabled')
    assert.notEqual(response.headers['x-cc-gateway-error-code'], 'missing_egress_tls_profile_ref')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('runtime registration backfills missing TLS profile ref on existing runtime mapping', async () => {
  const mappingDir = mkdtempSync(join(tmpdir(), 'cc-gateway-runtime-tls-backfill-'))
  const previousMappingFile = process.env.CC_GATEWAY_RUNTIME_MAPPING_FILE
  process.env.CC_GATEWAY_RUNTIME_MAPPING_FILE = join(mappingDir, 'runtime-mappings.json')
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const runtimeAccountRef = 'hmac-sha256:runtime-account-tls-backfill'
  const runtimeSessionId = '123e4567-e89b-42d3-a456-426614174015'
  const tlsProfileRef = 'tls-profile:claude-code-2.1.197-real-oracle-tcp-v1'

  writeFileSync(process.env.CC_GATEWAY_RUNTIME_MAPPING_FILE, JSON.stringify({
    version: 1,
    mappings: {
      [runtimeAccountRef]: {
        account_id: runtimeAccountRef,
        account_ref: runtimeAccountRef,
        account_uuid_ref: runtimeAccountRef,
        credential_ref: 'opaque:credential-ref:v1:tls-backfill',
        credential_binding_hmac: credentialBindingHmac('Bearer selected-token'),
        token_type: 'oauth',
        egress_bucket: 'bucket-runtime-tls-backfill',
        proxy_url: proxy.url,
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-tls-backfill',
        persona_variant: 'claude-code-2.1.197-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.197',
        device_id: 'a'.repeat(64),
      },
    },
  }, null, 2))

  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url, {
    shared_pool: {
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:test',
      context_attestation_secret: attestationSecret,
      egress_tls: { enabled: true, strict: true },
    },
    tls_profiles: {
      'claude-code-real-oracle-2197': { profile_ref: tlsProfileRef, source: 'observed-oracle-2197', enabled: true },
    },
    account_identities: {},
    egress_buckets: {},
  }))

  try {
    const registered = await httpJson(serverUrl(gateway, '/_runtime/register-account'), {
      headers: { 'x-cc-gateway-token': 'gateway-token', 'x-cc-internal-control-token': internalControlToken, authorization: 'Bearer selected-token' },
      body: {
        account_id: runtimeAccountRef,
        account_ref: runtimeAccountRef,
        account_uuid_ref: runtimeAccountRef,
        device_id: 'a'.repeat(64),
        egress_bucket: 'bucket-runtime-tls-backfill',
        proxy_url: proxy.url,
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-tls-backfill',
        credential_ref: 'opaque:credential-ref:v1:tls-backfill',
        credential_binding_hmac: credentialBindingHmac('Bearer selected-token'),
        token_type: 'oauth',
        policy_version: '2.1.197',
        persona_variant: 'claude-code-2.1.197-macos-local',
        egress_tls_profile_ref: tlsProfileRef,
      },
    })
    assert.equal(registered.status, 200, registered.body)

    const persisted = JSON.parse(readFileSync(process.env.CC_GATEWAY_RUNTIME_MAPPING_FILE, 'utf-8'))
    assert.equal(persisted.mappings[runtimeAccountRef].egress_tls_profile_ref, tlsProfileRef)

    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        ...ccGatewayHeaders,
        'x-cc-account-id': runtimeAccountRef,
        'x-cc-credential-ref': 'opaque:credential-ref:v1:tls-backfill',
        'x-cc-egress-bucket': 'bucket-runtime-tls-backfill',
        'x-cc-policy-version': '2.1.197',
        'x-claude-code-session-id': runtimeSessionId,
        authorization: 'Bearer selected-token',
      }, {
        account_id: runtimeAccountRef,
        credential_ref: 'opaque:credential-ref:v1:tls-backfill',
        egress_bucket: 'bucket-runtime-tls-backfill',
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-tls-backfill',
        policy_version: '2.1.197',
        persona_profile: 'claude-code-2.1.197-macos-local',
        profile_policy_version: 'claude_code_2_1_197_plan76_native_policy_v1',
        request_shape_profile_ref: 'claude_code_2_1_197_messages_streaming_tooldefs_native_v1',
        cache_parity_profile_ref: 'claude_code_2_1_197_cache_parity_native_v1',
        egress_tls_profile_ref: tlsProfileRef,
        session_id: runtimeSessionId,
        observed_client_profile: {
          schema_version: 'observed_client_profile.v1',
          cli_version_bucket: '2.1.197',
          route_class: 'messages',
          billing_shape: 'absent',
          billing_block_count: 0,
          cc_entrypoint_bucket: 'absent',
          stream: true,
        },
      }),
      body: { stream: true, metadata: { user_id: JSON.stringify({ session_id: runtimeSessionId }) }, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 403, response.body)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'egress_tls_sidecar_disabled')
    assert.equal(upstream.captured.length, 0)
  } finally {
    if (previousMappingFile === undefined) delete process.env.CC_GATEWAY_RUNTIME_MAPPING_FILE
    else process.env.CC_GATEWAY_RUNTIME_MAPPING_FILE = previousMappingFile
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('runtime registration makes a newly onboarded account routable without restart', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const runtimeAccountRef = 'hmac-sha256:runtime-account-ref'
  const runtimeSessionId = '123e4567-e89b-42d3-a456-426614174010'
  const runtimeHeaders = {
    ...ccGatewayHeaders,
    'x-cc-account-id': runtimeAccountRef,
    'x-claude-code-session-id': runtimeSessionId,
  }
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url, {
    account_identities: {},
    egress_buckets: {},
  }))

  try {
    const before = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        ...runtimeHeaders,
        authorization: 'Bearer selected-token',
      }),
      body: { stream: true, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(before.status, 403)
    assert.equal(before.headers['x-cc-gateway-error-code'], 'missing_account_identity')
    assert.equal(upstream.captured.length, 0)

    const registered = await httpJson(serverUrl(gateway, '/_runtime/register-account'), {
      headers: { 'x-cc-gateway-token': 'gateway-token', 'x-cc-internal-control-token': internalControlToken, authorization: 'Bearer selected-token' },
      body: {
        account_id: runtimeAccountRef,
        account_ref: runtimeAccountRef,
        device_id: 'd'.repeat(64),
        egress_bucket: 'bucket-a',
        proxy_url: proxy.url,
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-bucket',
        credential_ref: 'opaque:credential-ref:v1:cred-a',
        credential_binding_hmac: credentialBindingHmac('Bearer selected-token'),
        token_type: 'oauth',
        policy_version: '2.1.175',
      },
    })
    assert.equal(registered.status, 200, registered.body)
    assert.equal(registered.json?.status, 'registered')
    assert.deepEqual(registered.json?.registered, {
      account_identity: true,
      egress_bucket: true,
    })

    const after = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        ...runtimeHeaders,
        authorization: 'Bearer selected-token',
      }, { proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-bucket' }),
      body: { stream: true, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(after.status, 200, after.body)
    assert.equal(upstream.captured.length, 1)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})


test('runtime registration permits same-account credential rotation with fresh internal proof', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const runtimeAccountRef = 'hmac-sha256:runtime-account-rotation'
  const runtimeSessionId = '123e4567-e89b-42d3-a456-426614174013'
  const runtimeDeviceId = 'a'.repeat(64)
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url, {
    account_identities: {},
    egress_buckets: {},
  }))

  try {
    const first = await httpJson(serverUrl(gateway, '/_runtime/register-account'), {
      headers: { 'x-cc-gateway-token': 'gateway-token', 'x-cc-internal-control-token': internalControlToken, authorization: 'Bearer old-selected-token' },
      body: {
        account_id: runtimeAccountRef,
        account_ref: runtimeAccountRef,
        account_uuid_ref: runtimeAccountRef,
        device_id: runtimeDeviceId,
        egress_bucket: 'bucket-runtime-rotation',
        proxy_url: proxy.url,
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-rotation',
        credential_ref: 'opaque:credential-ref:v1:rotation-old',
        credential_binding_hmac: credentialBindingHmac('Bearer old-selected-token'),
        token_type: 'oauth',
        policy_version: '2.1.179',
      },
    })
    assert.equal(first.status, 200, first.body)

    const rotated = await httpJson(serverUrl(gateway, '/_runtime/register-account'), {
      headers: { 'x-cc-gateway-token': 'gateway-token', 'x-cc-internal-control-token': internalControlToken, authorization: 'Bearer new-selected-token' },
      body: {
        account_id: runtimeAccountRef,
        account_ref: runtimeAccountRef,
        account_uuid_ref: runtimeAccountRef,
        device_id: runtimeDeviceId,
        egress_bucket: 'bucket-runtime-rotation',
        proxy_url: proxy.url,
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-rotation',
        credential_ref: 'opaque:credential-ref:v1:rotation-new',
        credential_binding_hmac: credentialBindingHmac('Bearer new-selected-token'),
        token_type: 'oauth',
        policy_version: '2.1.179',
      },
    })
    assert.equal(rotated.status, 200, rotated.body)

    const stale = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        ...ccGatewayHeaders,
        'x-cc-account-id': runtimeAccountRef,
        'x-cc-credential-ref': 'opaque:credential-ref:v1:rotation-new',
        'x-cc-egress-bucket': 'bucket-runtime-rotation',
        'x-cc-policy-version': '2.1.179',
        'x-claude-code-session-id': runtimeSessionId,
        authorization: 'Bearer old-selected-token',
      }, {
        credential_ref: 'opaque:credential-ref:v1:rotation-new',
        egress_bucket: 'bucket-runtime-rotation',
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-rotation',
        policy_version: '2.1.179',
        persona_profile: 'claude-code-2.1.179-macos-local',
        session_id: runtimeSessionId,
      }),
      body: { stream: true, metadata: { user_id: JSON.stringify({ session_id: runtimeSessionId }) }, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(stale.status, 403, stale.body)
    assert.equal(stale.headers['x-cc-gateway-error-code'], 'credential_account_mismatch')

    const fresh = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        ...ccGatewayHeaders,
        'x-cc-account-id': runtimeAccountRef,
        'x-cc-credential-ref': 'opaque:credential-ref:v1:rotation-new',
        'x-cc-egress-bucket': 'bucket-runtime-rotation',
        'x-cc-policy-version': '2.1.179',
        'x-claude-code-session-id': runtimeSessionId,
        authorization: 'Bearer new-selected-token',
      }, {
        credential_ref: 'opaque:credential-ref:v1:rotation-new',
        egress_bucket: 'bucket-runtime-rotation',
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-rotation',
        policy_version: '2.1.179',
        persona_profile: 'claude-code-2.1.179-macos-local',
        session_id: runtimeSessionId,
      }),
      body: { stream: true, metadata: { user_id: JSON.stringify({ session_id: runtimeSessionId }) }, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(fresh.status, 200, fresh.body)
    assert.equal(upstream.captured.length, 1)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('runtime registration permits safe 2.1.179 to 2.1.197 canonical promotion with fresh internal proof', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const runtimeAccountRef = 'hmac-sha256:runtime-account-canonical-promotion'
  const runtimeDeviceId = '9'.repeat(64)
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url, {
    account_identities: {},
    egress_buckets: {},
  }))

  try {
    const oldRuntime = await httpJson(serverUrl(gateway, '/_runtime/register-account'), {
      headers: { 'x-cc-gateway-token': 'gateway-token', 'x-cc-internal-control-token': internalControlToken, authorization: 'Bearer old-selected-token' },
      body: {
        account_id: runtimeAccountRef,
        account_ref: runtimeAccountRef,
        account_uuid_ref: runtimeAccountRef,
        device_id: runtimeDeviceId,
        egress_bucket: 'bucket-runtime-canonical-promotion',
        proxy_url: proxy.url,
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-canonical-promotion',
        credential_ref: 'opaque:credential-ref:v1:canonical-old',
        credential_binding_hmac: credentialBindingHmac('Bearer old-selected-token'),
        token_type: 'oauth',
        policy_version: '2.1.179',
        persona_variant: 'claude-code-2.1.179-macos-local',
      },
    })
    assert.equal(oldRuntime.status, 200, oldRuntime.body)

    const promoted = await httpJson(serverUrl(gateway, '/_runtime/register-account'), {
      headers: { 'x-cc-gateway-token': 'gateway-token', 'x-cc-internal-control-token': internalControlToken, authorization: 'Bearer new-selected-token' },
      body: {
        account_id: runtimeAccountRef,
        account_ref: runtimeAccountRef,
        account_uuid_ref: runtimeAccountRef,
        device_id: runtimeDeviceId,
        egress_bucket: 'bucket-runtime-canonical-promotion',
        proxy_url: proxy.url,
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-canonical-promotion',
        credential_ref: 'opaque:credential-ref:v1:canonical-new',
        credential_binding_hmac: credentialBindingHmac('Bearer new-selected-token'),
        token_type: 'oauth',
        policy_version: '2.1.197',
        persona_variant: 'claude-code-2.1.197-macos-local',
      },
    })
    assert.equal(promoted.status, 200, promoted.body)

    const unsafeDrift = await httpJson(serverUrl(gateway, '/_runtime/register-account'), {
      headers: { 'x-cc-gateway-token': 'gateway-token', 'x-cc-internal-control-token': internalControlToken, authorization: 'Bearer new-selected-token' },
      body: {
        account_id: runtimeAccountRef,
        account_ref: runtimeAccountRef,
        account_uuid_ref: runtimeAccountRef,
        device_id: runtimeDeviceId,
        egress_bucket: 'bucket-runtime-canonical-promotion',
        proxy_url: proxy.url,
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-canonical-promotion',
        credential_ref: 'opaque:credential-ref:v1:canonical-new',
        credential_binding_hmac: credentialBindingHmac('Bearer new-selected-token'),
        token_type: 'oauth',
        policy_version: '2.1.198',
        persona_variant: 'claude-code-2.1.198-macos-local',
      },
    })
    assert.equal(unsafeDrift.status, 409)
    assert.equal(unsafeDrift.headers['x-cc-gateway-error-code'], 'runtime_mapping_authority_exists')
    assert.ok(!unsafeDrift.body.includes('new-selected-token'))
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('runtime registration persists and replays after gateway restart', async () => {
  const mappingDir = mkdtempSync(join(tmpdir(), 'cc-gateway-runtime-mapping-'))
  const previousMappingFile = process.env.CC_GATEWAY_RUNTIME_MAPPING_FILE
  process.env.CC_GATEWAY_RUNTIME_MAPPING_FILE = join(mappingDir, 'runtime-mappings.json')
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const runtimeAccountRef = 'hmac-sha256:runtime-account-replay'
  const runtimeSessionId = '123e4567-e89b-42d3-a456-426614174011'
  const runtimeHeaders = {
    ...ccGatewayHeaders,
    'x-cc-account-id': runtimeAccountRef,
    'x-cc-egress-bucket': 'bucket-replay',
    'x-claude-code-session-id': runtimeSessionId,
  }
  let gateway = startProxy(sub2apiConfig(upstream.url, proxy.url, {
    account_identities: {},
    egress_buckets: {},
  }))

  try {
    const registered = await httpJson(serverUrl(gateway, '/_runtime/register-account'), {
      headers: { 'x-cc-gateway-token': 'gateway-token', 'x-cc-internal-control-token': internalControlToken, authorization: 'Bearer selected-token' },
      body: {
        account_id: runtimeAccountRef,
        account_ref: runtimeAccountRef,
        device_id: 'e'.repeat(64),
        egress_bucket: 'bucket-replay',
        proxy_url: proxy.url,
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-bucket-replay',
        credential_ref: 'opaque:credential-ref:v1:cred-a',
        credential_binding_hmac: credentialBindingHmac('Bearer selected-token'),
        token_type: 'oauth',
        policy_version: '2.1.175',
      },
    })
    assert.equal(registered.status, 200, registered.body)
    await close(gateway)

    gateway = startProxy(sub2apiConfig(upstream.url, proxy.url, {
      account_identities: {},
      egress_buckets: {},
    }))
    const afterRestart = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        ...runtimeHeaders,
        authorization: 'Bearer selected-token',
      }),
      body: { stream: true, messages: [{ role: 'user', content: 'hello' }] },
    })

    assert.equal(afterRestart.status, 200, afterRestart.body)
    assert.equal(upstream.captured.length, 1)
  } finally {
    if (previousMappingFile === undefined) delete process.env.CC_GATEWAY_RUNTIME_MAPPING_FILE
    else process.env.CC_GATEWAY_RUNTIME_MAPPING_FILE = previousMappingFile
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})


test('runtime registration rejects mappings without credential binding refs', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url, {
    account_identities: {},
    egress_buckets: {},
  }))

  try {
    const rejected = await httpJson(serverUrl(gateway, '/_runtime/register-account'), {
      headers: { 'x-cc-gateway-token': 'gateway-token', 'x-cc-internal-control-token': internalControlToken, authorization: 'Bearer selected-token' },
      body: {
        account_id: 'runtime-account-no-credential',
        account_ref: 'hmac-sha256:runtime-account-ref',
        device_id: 'f'.repeat(64),
        egress_bucket: 'bucket-a',
        proxy_url: proxy.url,
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-bucket',
        policy_version: '2.1.175',
      },
    })
    assert.equal(rejected.status, 400)
    assert.equal(rejected.headers['x-cc-gateway-error-code'], 'invalid_credential_ref')

    const after = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        'x-cc-account-id': 'runtime-account-no-credential',
        authorization: 'Bearer selected-token',
      }),
      body: { stream: true, messages: [{ role: 'user', content: 'hello' }] },
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

test('runtime registration rejects raw numeric account ids before mutating runtime state', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url, {
    account_identities: {},
    egress_buckets: {},
  }))

  try {
    const rejected = await httpJson(serverUrl(gateway, '/_runtime/register-account'), {
      headers: { 'x-cc-gateway-token': 'gateway-token', 'x-cc-internal-control-token': internalControlToken, authorization: 'Bearer selected-token' },
      body: {
        account_id: '123',
        account_ref: 'hmac-sha256:runtime-account-ref',
        device_id: 'f'.repeat(64),
        egress_bucket: 'bucket-a',
        proxy_url: proxy.url,
        proxy_identity_ref: 'opaque:proxy-ref:v1:runtime-bucket',
        policy_version: '2.1.175',
      },
    })
    assert.equal(rejected.status, 400)
    assert.equal(rejected.headers['x-cc-gateway-error-code'], 'invalid_account_id')

    const after = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        'x-cc-account-id': '123',
        authorization: 'Bearer selected-token',
      }),
      body: { stream: true, messages: [{ role: 'user', content: 'hello' }] },
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
      headers: schedulerHeaders({
        authorization: 'Bearer selected-token',
      }),
      body: { stream: true, messages: [{ role: 'user', content: 'hello' }] },
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

  const rawPrompt = 'RAW_PROMPT_DO_NOT_CAPTURE_cch_marker_TOKEN_unsafe-token-prefix-secret'
  const upstreamRaw = 'UPSTREAM_RESPONSE_RAW_SECRET_cch_marker_TOKEN'
  const upstream = await startFakeUpstream((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, completion: upstreamRaw }))
  })
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        authorization: 'Bearer selected-token',
      }),
      body: {
        stream: true,
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

    for (const forbidden of [rawPrompt, upstreamRaw, 'unsafe-token-prefix-secret', 'cch_marker_TOKEN']) {
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
      headers: schedulerHeaders({
        authorization: 'Bearer selected-token',
      }),
      body: { stream: true, messages: [{ role: 'user', content: 'hello' }] },
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
      authorization: 'Bearer selected-token',
      ...schedulerHeaders(),
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
      headers: schedulerHeaders({
        authorization: 'Bearer selected-token',
        'x-api-key': 'incidental-api-key',
      }),
      body: { stream: true, messages: [{ role: 'user', content: 'hello' }] },
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


test('formal-pool attestation must bind credential ref to selected account identity', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(attestedSub2apiConfig(upstream.url, proxy.url, {
    account_identities: {
      'account-1': {
        device_id: 'b'.repeat(64),
        account_uuid_ref: 'hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        email_ref: 'hmac-sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        account_ref: 'hmac-sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        credential_ref: 'opaque:credential-ref:v1:identity-owned-cred',
        credential_binding_hmac: 'hmac-sha256:k-test:credential-binding:v1:identity-owned-cred',
        persona_variant: 'claude-code-2.1.175-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.175',
      },
    },
  }))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        authorization: 'Bearer selected-token',
      }),
      body: { stream: true, messages: [{ role: 'user', content: 'hello' }] },
    })

    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(response.headers['x-cc-gateway-error-code'], 'formal_pool_context_mismatch')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})



test('formal-pool selected raw credential must match account credential binding hmac', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const config = attestedSub2apiConfig(upstream.url, proxy.url)
  config.account_identities!['account-1'].credential_binding_hmac = credentialBindingHmac('Bearer selected-token-good')
  const gateway = startProxy(config)
  const sessionId = '123e4567-e89b-42d3-a456-426614174776'

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        authorization: 'Bearer selected-token-wrong',
        'x-claude-code-session-id': sessionId,
      }, { session_id: sessionId, nonce: 'credential-binding-mismatch' }),
      body: { stream: true, metadata: { user_id: JSON.stringify({ session_id: sessionId }) }, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 403, response.body)
    assert.equal(response.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(response.headers['x-cc-gateway-error-code'], 'credential_account_mismatch')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('formal-pool attestation must bind policy version to selected account identity', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(attestedSub2apiConfig(upstream.url, proxy.url, {
    account_identities: {
      'account-1': {
        device_id: 'b'.repeat(64),
        account_uuid_ref: 'hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        email_ref: 'hmac-sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        account_ref: 'hmac-sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        credential_ref: 'opaque:credential-ref:v1:cred-a',
        credential_binding_hmac: credentialBindingHmac('Bearer selected-token'),
        persona_variant: 'claude-code-2.1.170-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.170',
      },
    },
  }))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        authorization: 'Bearer selected-token',
        'x-cc-policy-version': '2.1.150',
      }, { policy_version: '2.1.150', persona_profile: 'claude-code-2.1.170-macos-local' }),
      body: { stream: true, messages: [{ role: 'user', content: 'hello' }] },
    })

    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(response.headers['x-cc-gateway-error-code'], 'formal_pool_context_mismatch')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('formal-pool session rejects valid re-attestation that switches account authority fields', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(attestedSub2apiConfig(upstream.url, proxy.url))

  try {
    const first = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        authorization: 'Bearer selected-token',
      }),
      body: { stream: true, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(first.status, 200, first.body)

    const switched = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        authorization: 'Bearer selected-token',
        'x-cc-account-id': 'account-2',
        'x-cc-credential-ref': 'opaque:credential-ref:v1:cred-b',
        'x-cc-egress-bucket': 'bucket-b',
      }),
      body: { stream: true, messages: [{ role: 'user', content: 'same session must not switch authority' }] },
    })

    assert.equal(switched.status, 403)
    assert.equal(switched.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(switched.headers['x-cc-gateway-error-code'], 'formal_pool_session_authority_mismatch')
    assert.equal(upstream.captured.length, 1)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('formal-pool production fails closed when persistent session authority ledger is unavailable', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const previousLedgerFile = process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE
  delete process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE
  const gateway = startProxy(attestedSub2apiConfig(upstream.url, proxy.url, {
    shared_pool: {
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:test',
      context_attestation_secret: attestationSecret,
      upstream_mode: 'production',
      production_upstream_enabled: true,
    },
  }))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        authorization: 'Bearer selected-token',
        'x-claude-code-session-id': '123e4567-e89b-42d3-a456-426614174012',
      }),
      body: { stream: true, messages: [{ role: 'user', content: 'hello' }] },
    })

    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-kind'], 'control-plane')
    assert.equal(response.headers['x-cc-gateway-error-code'], 'formal_pool_session_ledger_unavailable')
    assert.equal(upstream.captured.length, 0)
  } finally {
    if (previousLedgerFile === undefined) delete process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE
    else process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE = previousLedgerFile
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})



test('formal-pool production fails closed when persistent session authority ledger is corrupt', async () => {
  const ledgerDir = mkdtempSync(join(tmpdir(), 'cc-gateway-corrupt-session-ledger-'))
  const previousLedgerFile = process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE
  process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE = join(ledgerDir, 'formal-pool-session-ledger.json')
  writeFileSync(process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE, '{"version":1,"sessions":[]}')
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(attestedSub2apiConfig(upstream.url, proxy.url, {
    shared_pool: {
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:test',
      context_attestation_secret: attestationSecret,
      upstream_mode: 'production',
      production_upstream_enabled: true,
    },
  }))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        authorization: 'Bearer selected-token',
        'x-claude-code-session-id': '123e4567-e89b-42d3-a456-426614174014',
      }),
      body: { stream: true, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 403, response.body)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'formal_pool_session_ledger_unavailable')
    assert.equal(upstream.captured.length, 0)
  } finally {
    if (previousLedgerFile === undefined) delete process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE
    else process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE = previousLedgerFile
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('formal-pool session authority ledger persists safe refs without raw session or device material', async () => {
  const ledgerDir = mkdtempSync(join(tmpdir(), 'cc-gateway-session-ledger-'))
  const previousLedgerFile = process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE
  process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE = join(ledgerDir, 'formal-pool-session-ledger.json')
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(attestedSub2apiConfig(upstream.url, proxy.url))
  const sessionId = '123e4567-e89b-42d3-a456-426614174013'

  try {
    const headers = schedulerHeaders({
        authorization: 'Bearer selected-token',
        'x-claude-code-session-id': sessionId,
      })
    const attestedContext = JSON.parse(Buffer.from(headers['x-cc-formal-pool-context'], 'base64url').toString('utf-8'))
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers,
      body: { stream: true, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 200, response.body)

    const ledger = readFileSync(process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE!, 'utf-8')
    assert.ok(ledger.includes('hmac-sha256:'))
    assert.ok(ledger.includes('attestation_nonces'), ledger)
    assert.ok(!ledger.includes(sessionId), ledger)
    assert.ok(!ledger.includes(attestedContext.nonce), ledger)
    assert.ok(!ledger.includes('b'.repeat(64)), ledger)
    assert.ok(!ledger.includes('selected-token'), ledger)
  } finally {
    if (previousLedgerFile === undefined) delete process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE
    else process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE = previousLedgerFile
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('failed persistent session ledger write does not poison in-memory authority state', async () => {
  const ledgerDir = mkdtempSync(join(tmpdir(), 'cc-gateway-session-ledger-readonly-'))
  const ledgerFile = join(ledgerDir, 'formal-pool-session-ledger.json')
  const previousLedgerFile = process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE
  process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE = ledgerFile
  writeFileSync(ledgerFile, JSON.stringify({ version: 1, sessions: {}, attestation_nonces: {} }))
  const previousNodeEnv = process.env.NODE_ENV
  const previousFailWrite = process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FAIL_WRITE_FOR_TEST
  process.env.NODE_ENV = 'test'
  process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FAIL_WRITE_FOR_TEST = 'session_authority'
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(attestedSub2apiConfig(upstream.url, proxy.url))
  const session = '123e4567-e89b-42d3-a456-426614174015'

  try {
    const first = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        authorization: 'Bearer selected-token',
        'x-claude-code-session-id': session,
      }),
      body: { stream: true, messages: [{ role: 'user', content: 'first write should fail' }] },
    })
    assert.equal(first.status, 500, first.body)
    assert.equal(first.headers['x-cc-gateway-error-code'], 'formal_pool_session_ledger_persist_failed')

    const switched = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        authorization: 'Bearer selected-token',
        'x-claude-code-session-id': session,
        'x-cc-account-id': 'account-2',
        'x-cc-credential-ref': 'opaque:credential-ref:v1:cred-b',
        'x-cc-egress-bucket': 'bucket-b',
      }),
      body: { stream: true, messages: [{ role: 'user', content: 'failed write must not create sticky memory' }] },
    })
    assert.equal(switched.status, 500, switched.body)
    assert.equal(switched.headers['x-cc-gateway-error-code'], 'formal_pool_session_ledger_persist_failed')
    assert.equal(upstream.captured.length, 0)
  } finally {
    if (previousFailWrite === undefined) delete process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FAIL_WRITE_FOR_TEST
    else process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FAIL_WRITE_FOR_TEST = previousFailWrite
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
    if (previousLedgerFile === undefined) delete process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE
    else process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE = previousLedgerFile
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('sub2api Anthropic API key preserves selected x-api-key and does not inject gateway OAuth', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const config = sub2apiConfig(upstream.url, proxy.url)
  config.account_identities!['account-1'].credential_binding_hmac = credentialBindingHmac('selected-api-key', 'apikey')
  const gateway = startProxy(config)

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        'x-cc-token-type': 'apikey',
        'x-api-key': 'selected-api-key',
      }),
      body: { stream: true, messages: [{ role: 'user', content: 'hello' }] },
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
  const config = sub2apiConfig(upstream.url, proxy.url)
  config.account_identities!['account-1'].credential_binding_hmac = credentialBindingHmac('selected-api-key', 'apikey')
  const gateway = startProxy(config)

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        'x-cc-token-type': 'apikey',
        'x-api-key': 'selected-api-key',
        authorization: 'Bearer incidental-token',
      }),
      body: { stream: true, messages: [{ role: 'user', content: 'hello' }] },
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
      body: { stream: true, messages: [{ role: 'user', content: 'hello' }] },
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
      body: { stream: true, messages: [{ role: 'user', content: 'hello' }] },
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
      body: { stream: true, messages: [{ role: 'user', content: 'hello' }] },
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

test('raw capture records Sub2API inbound and CC Gateway normalized routes', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url))
  const dir = mkdtempSync(join(tmpdir(), 'cc-gateway-route-capture-'))
  const previous = process.env.CC_GATEWAY_RAW_CAPTURE_DIR
  process.env.CC_GATEWAY_RAW_CAPTURE_DIR = dir

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        'x-sub2api-compat-inbound-route': '/v1/messages',
        'x-sub2api-compat-cc-gateway-route': '/v1/messages?beta=true',
        'x-sub2api-compat-client-type': 'claude_code_compat',
        'x-sub2api-compat-server-filled-shape': 'true',
        'x-sub2api-compat-server-filled-fields': 'system,metadata.user_id,tool_reference,defer_loading,eager_input_streaming,tools.native_only',
        'x-sub2api-compat-persona-source': 'server_selected',
        'x-sub2api-compat-fidelity-level': 'L2',
        'x-sub2api-compat-tool-search-mode': 'strip_with_audit',
        'x-sub2api-compat-tool-reference-present': 'true',
        'x-sub2api-compat-defer-loading-present': 'true',
        'x-sub2api-compat-eager-input-streaming-present': 'true',
        'x-sub2api-compat-capability-backed': 'false',
        authorization: 'Bearer selected-token',
      }),
      body: { stream: true, metadata: { user_id: JSON.stringify({ session_id: 'session-old' }) }, messages: [{ role: 'user', content: 'hello' }] },
    })

    assert.equal(response.status, 200, response.body)
    const requestCapture = JSON.parse(readFileSync(join(dir, '01_final_upstream_request.json'), 'utf-8'))
    assert.equal(requestCapture.inbound_route, '/v1/messages')
    assert.equal(requestCapture.cc_gateway_route, '/v1/messages?beta=true')
    assert.equal(requestCapture.client_type, 'claude_code_compat')
    assert.equal(requestCapture.server_filled_shape, true)
    assert.deepEqual(requestCapture.server_filled_fields, ['system', 'metadata.user_id', 'tool_reference', 'defer_loading', 'eager_input_streaming', 'tools.native_only'])
    assert.equal(requestCapture.persona_source, 'server_selected')
    assert.equal(requestCapture.compat_fidelity_level, 'L2')
    assert.equal(requestCapture.tool_search_mode, 'strip_with_audit')
    assert.equal(requestCapture.tool_reference_present, true)
    assert.equal(requestCapture.defer_loading_present, true)
    assert.equal(requestCapture.eager_input_streaming_present, true)
    assert.equal(requestCapture.capability_backed, false)
    assert.equal(requestCapture.body, undefined)
  } finally {
    if (previous === undefined) delete process.env.CC_GATEWAY_RAW_CAPTURE_DIR
    else process.env.CC_GATEWAY_RAW_CAPTURE_DIR = previous
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('raw capture ignores unsafe Sub2API route audit headers', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sub2apiConfig(upstream.url, proxy.url))
  const dir = mkdtempSync(join(tmpdir(), 'cc-gateway-route-capture-'))
  const previous = process.env.CC_GATEWAY_RAW_CAPTURE_DIR
  process.env.CC_GATEWAY_RAW_CAPTURE_DIR = dir

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        'x-sub2api-compat-inbound-route': '/v1/messages?token=secret',
        'x-sub2api-compat-cc-gateway-route': '/v1/messages?beta=true&token=secret',
        authorization: 'Bearer selected-token',
      }),
      body: { stream: true, metadata: { user_id: JSON.stringify({ session_id: 'session-old' }) }, messages: [{ role: 'user', content: 'hello' }] },
    })

    assert.equal(response.status, 200, response.body)
    const requestCapture = JSON.parse(readFileSync(join(dir, '01_final_upstream_request.json'), 'utf-8'))
    assert.equal(requestCapture.inbound_route, '/v1/messages')
    assert.equal(requestCapture.cc_gateway_route, '/v1/messages?beta=true')
  } finally {
    if (previous === undefined) delete process.env.CC_GATEWAY_RAW_CAPTURE_DIR
    else process.env.CC_GATEWAY_RAW_CAPTURE_DIR = previous
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})


test('sub2api rejects unattested scheduler x-cc context before rewrite', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(attestedSub2apiConfig(upstream.url, proxy.url))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        ...ccGatewayHeaders,
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-token-type': 'oauth',
        'x-cc-credential-ref': 'opaque:credential-ref:v1:cred-a',
        authorization: 'Bearer selected-token',
        'x-claude-code-session-id': '123e4567-e89b-42d3-a456-426614174999',
      },
      body: { stream: true, metadata: { user_id: JSON.stringify({ session_id: '123e4567-e89b-42d3-a456-426614174999' }) }, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'missing_formal_pool_context_attestation')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('sub2api rejects scheduler context when attested account mismatches x-cc header', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(attestedSub2apiConfig(upstream.url, proxy.url))
  const sessionId = '123e4567-e89b-42d3-a456-426614174999'
  const attested = formalPoolContext({ session_id: sessionId })

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: {
        ...ccGatewayHeaders,
        ...signedFormalPoolHeaders(attested),
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-account-id': 'account-2',
        'x-cc-token-type': 'oauth',
        'x-cc-credential-ref': 'opaque:credential-ref:v1:cred-a',
        authorization: 'Bearer selected-token',
        'x-claude-code-session-id': sessionId,
      },
      body: { stream: true, metadata: { user_id: JSON.stringify({ session_id: sessionId }) }, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'formal_pool_context_mismatch')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})


test('sub2api rejects every attested scheduler authority-field mismatch', async () => {
  const mismatchCases: Array<[string, Record<string, unknown>, Record<string, string>, string]> = [
    ['route_class', { route_class: 'count_tokens' }, {}, 'formal_pool_context_mismatch'],
    ['token_type', { token_type: 'apikey' }, {}, 'formal_pool_context_mismatch'],
    ['credential_ref', { credential_ref: 'opaque:credential-ref:v1:cred-b' }, {}, 'formal_pool_context_mismatch'],
    ['egress_bucket', { egress_bucket: 'bucket-b' }, {}, 'formal_pool_context_mismatch'],
    ['proxy_identity_ref', { proxy_identity_ref: 'opaque:proxy-ref:v1:bucket-b' }, {}, 'formal_pool_context_mismatch'],
    ['policy_version', { policy_version: '2.1.176' }, {}, 'formal_pool_context_mismatch'],
    ['persona_profile', { persona_profile: 'claude-code-2.1.170-macos-local' }, {}, 'formal_pool_context_mismatch'],
    ['session_id', { session_id: '123e4567-e89b-42d3-a456-426614174998' }, {}, 'formal_pool_context_mismatch'],
  ]

  for (const [caseName, contextOverrides, headerOverrides, expectedCode] of mismatchCases) {
    const upstream = await startFakeUpstream()
    const proxy = await startFakeConnectProxy()
    const gateway = startProxy(attestedSub2apiConfig(upstream.url, proxy.url))
    const sessionId = '123e4567-e89b-42d3-a456-426614174999'
    const context = formalPoolContext({ session_id: sessionId, nonce: `mismatch-${caseName}`, ...contextOverrides })

    try {
      const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
        headers: {
          ...ccGatewayHeaders,
          ...signedFormalPoolHeaders(context),
          'x-cc-gateway-token': 'gateway-token',
          'x-cc-provider': 'anthropic',
          'x-cc-token-type': 'oauth',
          'x-cc-credential-ref': 'opaque:credential-ref:v1:cred-a',
          authorization: 'Bearer selected-token',
          'x-claude-code-session-id': sessionId,
          ...headerOverrides,
        },
        body: { stream: true, metadata: { user_id: JSON.stringify({ session_id: sessionId }) }, messages: [{ role: 'user', content: 'hello' }] },
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

test('sub2api rejects expired or replayed formal-pool scheduler context', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(attestedSub2apiConfig(upstream.url, proxy.url))
  const sessionId = '123e4567-e89b-42d3-a456-426614174999'
  const baseHeaders = {
    ...ccGatewayHeaders,
    'x-cc-gateway-token': 'gateway-token',
    'x-cc-provider': 'anthropic',
    'x-cc-token-type': 'oauth',
    'x-cc-credential-ref': 'opaque:credential-ref:v1:cred-a',
    authorization: 'Bearer selected-token',
    'x-claude-code-session-id': sessionId,
  }
  const body = { stream: true, metadata: { user_id: JSON.stringify({ session_id: sessionId }) }, messages: [{ role: 'user', content: 'hello' }] }

  try {
    const expired = formalPoolContext({ session_id: sessionId, timestamp_ms: Date.now() - 10 * 60 * 1000, nonce: 'expired-nonce' })
    const expiredResponse = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: { ...baseHeaders, ...signedFormalPoolHeaders(expired) },
      body,
    })
    assert.equal(expiredResponse.status, 403)
    assert.equal(expiredResponse.headers['x-cc-gateway-error-code'], 'expired_formal_pool_context_attestation')

    const context = formalPoolContext({ session_id: sessionId, nonce: 'replay-nonce' })
    const first = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: { ...baseHeaders, ...signedFormalPoolHeaders(context) },
      body,
    })
    assert.equal(first.status, 200, first.body)

    const replay = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: { ...baseHeaders, ...signedFormalPoolHeaders(context) },
      body,
    })
    assert.equal(replay.status, 403)
    assert.equal(replay.headers['x-cc-gateway-error-code'], 'replayed_formal_pool_context_attestation')
    assert.equal(upstream.captured.length, 1)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('sub2api accepts Sub2API shared formal-pool contract fixture', async () => {
  const fixture = loadSharedContractFixture()
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sharedFixtureConfig(fixture, upstream.url, proxy.url))
  const context = sharedFixtureContext(fixture)

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: sharedFixtureHeaders(fixture, context),
      body: {
        stream: true,
        metadata: { user_id: JSON.stringify({ session_id: fixture.valid_context.session_id }) },
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hello' }],
      },
    })

    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    const sent = JSON.parse(upstream.captured[0].body)
    const userId = JSON.parse(sent.metadata.user_id)
    assert.equal(userId.session_id, fixture.valid_context.session_id)
    assert.equal(userId.device_id, fixture.account.device_id)
    assert.equal(userId.account_uuid, fixture.account.account_uuid_ref)
    assert.equal(upstream.captured[0].headers['x-cc-formal-pool-context'], undefined)
    assert.equal(upstream.captured[0].headers['x-cc-formal-pool-signature'], undefined)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('sub2api rejects Sub2API shared formal-pool contract negative vectors', async () => {
  const fixture = loadSharedContractFixture()
  const body = {
    stream: true,
    metadata: { user_id: JSON.stringify({ session_id: fixture.valid_context.session_id }) },
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'hello' }],
  }

  const mismatchUpstream = await startFakeUpstream()
  const mismatchProxy = await startFakeConnectProxy()
  const mismatchGateway = startProxy(sharedFixtureConfig(fixture, mismatchUpstream.url, mismatchProxy.url))
  try {
    const mismatchContext = sharedFixtureContext(fixture, fixture.cases.one_field_mismatch.mutate_context)
    const response = await httpJson(serverUrl(mismatchGateway, '/v1/messages?beta=true'), {
      headers: sharedFixtureHeaders(fixture, mismatchContext),
      body,
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], fixture.cases.one_field_mismatch.expected_cc_gateway_error_code)
    assert.equal(mismatchUpstream.captured.length, 0)
  } finally {
    await close(mismatchGateway)
    await close(mismatchUpstream.server)
    await close(mismatchProxy.server)
  }

  const expiredUpstream = await startFakeUpstream()
  const expiredProxy = await startFakeConnectProxy()
  const expiredGateway = startProxy(sharedFixtureConfig(fixture, expiredUpstream.url, expiredProxy.url))
  try {
    const expiredContext = sharedFixtureContext(fixture, {
      timestamp_ms: Date.now() + fixture.cases.expired.timestamp_offset_ms,
      nonce: 'shared-fixture-expired-nonce',
    })
    const response = await httpJson(serverUrl(expiredGateway, '/v1/messages?beta=true'), {
      headers: sharedFixtureHeaders(fixture, expiredContext),
      body,
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], fixture.cases.expired.expected_cc_gateway_error_code)
    assert.equal(expiredUpstream.captured.length, 0)
  } finally {
    await close(expiredGateway)
    await close(expiredUpstream.server)
    await close(expiredProxy.server)
  }

  const replayUpstream = await startFakeUpstream()
  const replayProxy = await startFakeConnectProxy()
  const replayGateway = startProxy(sharedFixtureConfig(fixture, replayUpstream.url, replayProxy.url))
  try {
    const replayContext = sharedFixtureContext(fixture, { nonce: fixture.cases.replay_nonce.nonce })
    const first = await httpJson(serverUrl(replayGateway, '/v1/messages?beta=true'), {
      headers: sharedFixtureHeaders(fixture, replayContext),
      body,
    })
    assert.equal(first.status, 200, first.body)
    const replay = await httpJson(serverUrl(replayGateway, '/v1/messages?beta=true'), {
      headers: sharedFixtureHeaders(fixture, replayContext),
      body,
    })
    assert.equal(replay.status, 403)
    assert.equal(replay.headers['x-cc-gateway-error-code'], fixture.cases.replay_nonce.expected_cc_gateway_error_code)
    assert.equal(replayUpstream.captured.length, 1)
  } finally {
    await close(replayGateway)
    await close(replayUpstream.server)
    await close(replayProxy.server)
  }
})


test('in-memory formal-pool session authority ledger is scoped per startProxy instance', async () => {
  const upstreamA = await startFakeUpstream()
  const upstreamB = await startFakeUpstream()
  const proxyA = await startFakeConnectProxy()
  const proxyB = await startFakeConnectProxy()
  const configA = attestedSub2apiConfig(upstreamA.url, proxyA.url)
  const configB = attestedSub2apiConfig(upstreamB.url, proxyB.url)
  const gatewayA = startProxy(configA)
  const gatewayB = startProxy(configB)
  const sessionId = '123e4567-e89b-42d3-a456-426614174777'

  try {
    const first = await httpJson(serverUrl(gatewayA, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        authorization: 'Bearer selected-token',
        'x-claude-code-session-id': sessionId,
      }, { session_id: sessionId, nonce: 'instance-a' }),
      body: { stream: true, metadata: { user_id: JSON.stringify({ session_id: sessionId }) }, messages: [{ role: 'user', content: 'hello-a' }] },
    })
    assert.equal(first.status, 200, first.body)

    const second = await httpJson(serverUrl(gatewayB, '/v1/messages?beta=true'), {
      headers: schedulerHeaders({
        authorization: 'Bearer selected-token',
        'x-cc-account-id': 'account-2',
        'x-cc-credential-ref': 'opaque:credential-ref:v1:cred-b',
        'x-cc-egress-bucket': 'bucket-b',
        'x-claude-code-session-id': sessionId,
      }, {
        session_id: sessionId,
        account_id: 'account-2',
        credential_ref: 'opaque:credential-ref:v1:cred-b',
        egress_bucket: 'bucket-b',
        proxy_identity_ref: 'opaque:proxy-ref:v1:bucket-b',
        nonce: 'instance-b',
      }),
      body: { stream: true, metadata: { user_id: JSON.stringify({ session_id: sessionId }) }, messages: [{ role: 'user', content: 'hello-b' }] },
    })
    assert.equal(second.status, 200, second.body)
    assert.equal(upstreamA.captured.length, 1)
    assert.equal(upstreamB.captured.length, 1)
  } finally {
    await close(gatewayA)
    await close(gatewayB)
    await close(upstreamA.server)
    await close(upstreamB.server)
    await close(proxyA.server)
    await close(proxyB.server)
  }
})


function native2179FormalPoolContext(overrides: Record<string, unknown> = {}) {
  return formalPoolContext({
    policy_version: '2.1.179',
    persona_profile: 'claude-code-2.1.179-macos-local',
    trusted_egress_profile_ref: 'strip_attribution',
    profile_policy_version: 'claude_code_2_1_179_cp1_degraded_v1',
    billing_shape_policy: 'strip',
    request_shape_profile_ref: 'claude_code_2_1_179_messages_streaming_tooldefs_degraded_v1',
    cache_parity_profile_ref: 'claude_code_2_1_179_cache_parity_degraded_v1',
    observed_client_profile: {
      schema_version: 'observed_client_profile.v1',
      cli_version_bucket: '2.1.179',
      route_class: 'messages',
      billing_shape: 'cch_present',
      billing_block_count: 1,
      cc_entrypoint_bucket: 'sdk-cli',
      top_level_body_keys: ['max_tokens', 'messages', 'metadata', 'model', 'stream', 'system', 'tools'],
      tool_count: 1,
      stream: true,
      thinking_present: false,
      output_config_present: false,
      context_management_present: false,
    },
    ...overrides,
  })
}

function attested2179Sub2apiConfig(upstreamUrl: string, proxyUrl: string, overrides: Record<string, unknown> = {}) {
  return attestedSub2apiConfig(upstreamUrl, proxyUrl, {
    env: { ...baseConfig().env, version: '2.1.179', version_base: '2.1.179' },
    account_identities: {
      'account-1': {
        device_id: 'b'.repeat(64),
        account_uuid_hash: 'hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        email_hash: 'hmac-sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        account_hash: 'hmac-sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        credential_ref: 'opaque:credential-ref:v1:cred-a',
        credential_binding_hmac: credentialBindingHmac('Bearer selected-token'),
        persona_variant: 'claude-code-2.1.179-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.179',
      },
      'account-2': {
        device_id: 'c'.repeat(64),
        account_uuid_hash: 'hmac-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        email_hash: 'hmac-sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        account_hash: 'hmac-sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        credential_ref: 'opaque:credential-ref:v1:cred-b',
        credential_binding_hmac: credentialBindingHmac('Bearer selected-token'),
        persona_variant: 'claude-code-2.1.179-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.179',
      },
    },
    shared_pool: {
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:test',
      context_attestation_secret: attestationSecret,
      billing_cch_mode: 'strip',
    },
    ...overrides,
  })
}

function native2179Headers(contextOverrides: Record<string, unknown> = {}, headerOverrides: Record<string, string> = {}) {
  const merged = {
    ...ccGatewayHeaders,
    'x-cc-gateway-token': 'gateway-token',
    'x-cc-provider': 'anthropic',
    'x-cc-token-type': 'oauth',
    'x-cc-policy-version': '2.1.179',
    'x-claude-code-session-id': defaultSessionId,
    authorization: 'Bearer selected-token',
    ...headerOverrides,
  }
  const context = native2179FormalPoolContext({
    account_id: merged['x-cc-account-id'],
    token_type: merged['x-cc-token-type'],
    credential_ref: merged['x-cc-credential-ref'],
    egress_bucket: merged['x-cc-egress-bucket'],
    policy_version: merged['x-cc-policy-version'],
    proxy_identity_ref: proxyIdentityRefForBucket(merged['x-cc-egress-bucket']),
    session_id: merged['x-claude-code-session-id'],
    ...contextOverrides,
  })
  return {
    ...merged,
    ...signedFormalPoolHeaders(context),
  }
}

function native2179Body(overrides: Record<string, unknown> = {}) {
  return {
    model: 'claude-sonnet-4-6',
    max_tokens: 32,
    metadata: { user_id: JSON.stringify({ session_id: defaultSessionId }) },
    stream: true,
    system: [
      { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.179.abc; cc_entrypoint=sdk-cli; cch=12345;' },
      { type: 'text', text: 'safe system fixture' },
    ],
    tools: [{ name: 'fixture_tool', description: 'fixture', input_schema: { type: 'object', properties: {} } }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'local fixture' }] }],
    ...overrides,
  }
}

test('formal-pool attestation requires CP2 profile authority fields and safe observed profile', async () => {
  const requiredFields = [
    'trusted_egress_profile_ref',
    'profile_policy_version',
    'billing_shape_policy',
    'request_shape_profile_ref',
    'cache_parity_profile_ref',
    'observed_client_profile',
  ]
  for (const field of requiredFields) {
    const upstream = await startFakeUpstream()
    const proxy = await startFakeConnectProxy()
    const gateway = startProxy(attested2179Sub2apiConfig(upstream.url, proxy.url))
    try {
      const context = native2179FormalPoolContext({ nonce: `missing-${field}` }) as Record<string, unknown>
      delete context[field]
      const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
        headers: {
          ...ccGatewayHeaders,
          'x-cc-gateway-token': 'gateway-token',
          'x-cc-provider': 'anthropic',
          'x-cc-token-type': 'oauth',
          'x-cc-policy-version': '2.1.179',
          'x-claude-code-session-id': defaultSessionId,
          authorization: 'Bearer selected-token',
          ...signedFormalPoolHeaders(context),
        },
        body: native2179Body(),
      })
      assert.equal(response.status, 403, field)
      assert.equal(response.headers['x-cc-gateway-error-code'], 'malformed_formal_pool_context_attestation', field)
      assert.equal(upstream.captured.length, 0, field)
    } finally {
      await close(gateway)
      await close(upstream.server)
      await close(proxy.server)
    }
  }
})

test('formal-pool strip_attribution profile strips native 2.1.179 CCH billing block before upstream', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(attested2179Sub2apiConfig(upstream.url, proxy.url))
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: native2179Headers(),
      body: native2179Body(),
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    const forwarded = upstream.captured[0]
    const forwardedBody = forwarded.body
    assert.doesNotMatch(forwardedBody, /x-anthropic-billing-header/i)
    assert.doesNotMatch(forwardedBody, /\bcch=/i)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('formal-pool session ledger binds CP2 profile authority tuple fields', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(attested2179Sub2apiConfig(upstream.url, proxy.url, {
    shared_pool: {
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:test',
      context_attestation_secret: attestationSecret,
      billing_cch_mode: 'strip',
      no_cch_2179_oracle_profile_approved: true,
      no_cch_2179_oracle_profile_ref: 'claude_code_2_1_179_custom_base_no_cch_oracle_cp1_degraded_v1',
    },
  }))
  try {
    const first = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: native2179Headers({ nonce: 'profile-ledger-first' }),
      body: native2179Body({ system: [{ type: 'text', text: 'safe system fixture' }] }),
    })
    assert.equal(first.status, 200, first.body)

    const changed = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: native2179Headers({
        nonce: 'profile-ledger-second',
        trusted_egress_profile_ref: 'claude_code_2_1_179_custom_base_no_cch',
        billing_shape_policy: 'no_cch',
      }),
      body: native2179Body({ system: [{ type: 'text', text: 'safe system fixture' }] }),
    })
    assert.equal(changed.status, 403)
    assert.equal(changed.headers['x-cc-gateway-error-code'], 'formal_pool_session_authority_mismatch')
    assert.equal(upstream.captured.length, 1)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('formal-pool signed/no-CCH egress profiles require explicit 2.1.179 oracle proof', async () => {
  const cases = [
    {
      name: 'no-cch',
      trusted_egress_profile_ref: 'claude_code_2_1_179_custom_base_no_cch',
      billing_shape_policy: 'no_cch',
    },
    {
      name: 'signed-cch',
      trusted_egress_profile_ref: 'claude_code_2_1_179_first_party_signed_cch',
      billing_shape_policy: 'signed_cch',
    },
  ]
  for (const tc of cases) {
    const upstream = await startFakeUpstream()
    const proxy = await startFakeConnectProxy()
    const gateway = startProxy(attested2179Sub2apiConfig(upstream.url, proxy.url))
    try {
      const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
        headers: native2179Headers({
          nonce: `oracle-proof-${tc.name}`,
          trusted_egress_profile_ref: tc.trusted_egress_profile_ref,
          billing_shape_policy: tc.billing_shape_policy,
        }),
        body: native2179Body({ system: [{ type: 'text', text: 'safe system fixture' }] }),
      })
      assert.equal(response.status, 403, tc.name)
      assert.equal(response.headers['x-cc-gateway-error-code'], 'formal_pool_egress_profile_oracle_missing', tc.name)
      assert.equal(upstream.captured.length, 0, tc.name)
    } finally {
      await close(gateway)
      await close(upstream.server)
      await close(proxy.server)
    }
  }
})

test('formal-pool request-shape/cache profile gates fail closed on unknown future refs and final body keys', async () => {
  const unknownRefUpstream = await startFakeUpstream()
  const unknownRefProxy = await startFakeConnectProxy()
  const unknownRefGateway = startProxy(attested2179Sub2apiConfig(unknownRefUpstream.url, unknownRefProxy.url))
  try {
    const response = await httpJson(serverUrl(unknownRefGateway, '/v1/messages?beta=true'), {
      headers: native2179Headers({
        nonce: 'unknown-profile-ref',
        request_shape_profile_ref: 'claude_code_2_1_191_latest_observed_only',
      }),
      body: native2179Body(),
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'formal_pool_profile_ref_unapproved')
    assert.equal(unknownRefUpstream.captured.length, 0)
  } finally {
    await close(unknownRefGateway)
    await close(unknownRefUpstream.server)
    await close(unknownRefProxy.server)
  }

  const unknownBodyUpstream = await startFakeUpstream()
  const unknownBodyProxy = await startFakeConnectProxy()
  const unknownBodyGateway = startProxy(attested2179Sub2apiConfig(unknownBodyUpstream.url, unknownBodyProxy.url))
  try {
    const response = await httpJson(serverUrl(unknownBodyGateway, '/v1/messages?beta=true'), {
      headers: native2179Headers({
        nonce: 'unknown-body-key',
        observed_client_profile: {
          schema_version: 'observed_client_profile.v1',
          cli_version_bucket: '2.1.179',
          route_class: 'messages',
          billing_shape: 'absent',
          stream: true,
          unknown_top_level_body_key_count: 1,
        },
      }),
      body: native2179Body({ future_client_field: 'cleaning-missed', system: [{ type: 'text', text: 'safe system fixture' }] }),
    })
    assert.equal(response.status, 400)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'request_shape_profile_mismatch')
    assert.equal(unknownBodyUpstream.captured.length, 0)
  } finally {
    await close(unknownBodyGateway)
    await close(unknownBodyUpstream.server)
    await close(unknownBodyProxy.server)
  }
})

await finish()
