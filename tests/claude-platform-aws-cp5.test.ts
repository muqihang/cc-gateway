import { strict as assert } from 'assert'
import { createHmac } from 'crypto'
import { createServer } from 'http'
import { mkdtempSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { startProxy } from '../src/proxy.js'
import { baseConfig, close, finish, httpJson, serverUrl, startFakeConnectProxy, startFakeUpstream, test } from './helpers.js'

console.log('\ntests/claude-platform-aws-cp5.test.ts')

const attestationSecret = 'scheduler-hmac-material-v1-local-safe-fixture-123456'
const internalControlToken = 'internal-control-material-v1-local-safe-fixture-123456'
const defaultSessionId = '123e4567-e89b-42d3-a456-426614174999'
const workspaceHmacSecret = 'local-fixture-workspace-ref-hmac-material-123456'
const workspaceBindingSecret = 'local-fixture-workspace-binding-hmac-material-123456'
const rawWorkspaceId = 'workspace-id-local-fixture'
const endpointRef = 'endpoint:aws-external-anthropic:us-east-1'
const betaPolicyRef = 'beta-policy:claude-platform-aws-v1-strip'
const requestShapeProfileRef = 'request-shape:claude-platform-aws-v1-strip'
const cacheParityProfileRef = 'cache-profile:claude-platform-aws-v1-strip'
const selectedApiKey = 'selected-api-key-local-fixture'
const workspaceRef = formalPoolSafeRef('workspace', `claude_platform_aws_workspace_ref_v1\0us-east-1\0${rawWorkspaceId}`)
const workspaceBindingHmac = claudePlatformAwsWorkspaceBindingHmac({ workspaceRef })
const selectedApiKeyBindingHmac = credentialBindingHmac(selectedApiKey)

function canonicalFormalPoolContext(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = value[key]
    return acc
  }, {} as Record<string, unknown>))
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64url')
}

function credentialBindingHmac(rawCredential: string, tokenType: 'oauth' | 'apikey' = 'apikey', secret = attestationSecret) {
  return `hmac-sha256:${createHmac('sha256', secret)
    .update('formal_pool_credential_binding_v1')
    .update('\0')
    .update(tokenType)
    .update('\0')
    .update(rawCredential)
    .digest('hex')}`
}


function formalPoolSafeRef(scope: string, raw: string, secret = workspaceHmacSecret) {
  return `hmac-sha256:${createHmac('sha256', secret)
    .update(`formal_pool_${scope}`)
    .update('\0')
    .update('v1')
    .update('\0')
    .update(raw)
    .digest('hex')}`
}

function claudePlatformAwsWorkspaceBindingHmac(overrides: Record<string, string> = {}, secret = workspaceBindingSecret) {
  const tuple = {
    providerKind: 'claude_platform_aws',
    accountRef: 'hmac-sha256:' + 'e'.repeat(64),
    credentialRef: 'opaque:credential-ref:v1:cpaws-a',
    workspaceRef,
    endpointRef,
    region: 'us-east-1',
    authScheme: 'x_api_key',
    egressBucket: 'bucket-cpaws-a',
    proxyIdentityRef: 'opaque:proxy-ref:v1:cpaws-a',
    ...overrides,
  }
  return `hmac-sha256:${createHmac('sha256', secret)
    .update([
      'claude_platform_aws_workspace_binding_v1',
      tuple.providerKind,
      tuple.accountRef,
      tuple.credentialRef,
      tuple.workspaceRef,
      tuple.endpointRef,
      tuple.region,
      tuple.authScheme,
      tuple.egressBucket,
      tuple.proxyIdentityRef,
    ].join('\0'))
    .digest('hex')}`
}

function signedFormalPoolHeaders(context: Record<string, unknown>, secret = attestationSecret) {
  const canonical = canonicalFormalPoolContext(context)
  return {
    'x-cc-formal-pool-context': base64url(canonical),
    'x-cc-formal-pool-signature': `hmac-sha256:${createHmac('sha256', secret).update(canonical).digest('hex')}`,
  }
}

function awsFormalPoolContext(overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    route_class: 'messages',
    path: '/v1/messages',
    provider_kind: 'claude_platform_aws',
    upstream_auth_scheme: 'x_api_key',
    account_id: 'cpaws-account-a',
    token_type: 'apikey',
    credential_ref: 'opaque:credential-ref:v1:cpaws-a',
    credential_binding_hmac: selectedApiKeyBindingHmac,
    credential_source: 'server_account_credentials',
    egress_bucket: 'bucket-cpaws-a',
    proxy_identity_ref: 'opaque:proxy-ref:v1:cpaws-a',
    policy_version: '2.1.175',
    persona_profile: 'claude-code-2.1.175-macos-local',
    trusted_egress_profile_ref: 'strip_attribution',
    profile_policy_version: 'claude_code_2_1_179_cp1_degraded_v1',
    billing_shape_policy: 'strip',
    request_shape_profile_ref: requestShapeProfileRef,
    cache_parity_profile_ref: cacheParityProfileRef,
    beta_policy_ref: betaPolicyRef,
    workspace_ref: workspaceRef,
    workspace_binding_hmac: workspaceBindingHmac,
    upstream_endpoint_ref: endpointRef,
    aws_region: 'us-east-1',
    upstream_host: 'aws-external-anthropic.us-east-1.api.aws',
    allowed_upstream_path: '/v1/messages',
    session_id: defaultSessionId,
    timestamp_ms: Date.now(),
    nonce: `nonce-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    observed_client_profile: {
      schema_version: 'observed_client_profile.v1',
      cli_version_bucket: '2.1.179',
      route_class: 'messages',
      billing_shape: 'absent',
      billing_block_count: 0,
      cc_entrypoint_bucket: 'absent',
    },
    ...overrides,
  }
}

function awsSchedulerHeaders(
  headers: Record<string, string> = {},
  contextOverrides: Record<string, unknown> = {},
) {
  const context = awsFormalPoolContext(contextOverrides)
  return {
    'x-cc-gateway-token': 'gateway-token',
    'x-cc-provider': 'anthropic',
    'x-cc-account-id': String(context.account_id),
    'x-cc-token-type': String(context.token_type),
    'x-cc-credential-ref': String(context.credential_ref),
    'x-cc-egress-bucket': String(context.egress_bucket),
    'x-cc-policy-version': String(context.policy_version),
    'x-claude-code-session-id': String(context.session_id),
    'x-api-key': selectedApiKey,
    ...headers,
    ...signedFormalPoolHeaders(context),
  }
}

function awsBody(sessionId = defaultSessionId) {
  return {
    metadata: { user_id: JSON.stringify({ session_id: sessionId }) },
    model: 'claude-sonnet-4-6',
    max_tokens: 32,
    messages: [{ role: 'user', content: 'hello' }],
  }
}

function awsSub2apiConfig(upstreamUrl: string, proxyUrl: string, overrides: Record<string, unknown> = {}) {
  return baseConfig({
    mode: 'sub2api',
    upstream: { url: upstreamUrl },
    auth: { gateway_token: 'gateway-token', internal_control_token: internalControlToken, tokens: [] },
    oauth: undefined,
    shared_pool: {
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:test',
      context_attestation_secret: attestationSecret,
      sticky_session_hmac_key: workspaceHmacSecret,
      claude_platform_aws_workspace_binding_hmac_key: workspaceBindingSecret,
      upstream_mode: 'local-capture',
    },
    account_identities: {
      'cpaws-account-a': {
        device_id: 'b'.repeat(64),
        account_uuid_ref: 'hmac-sha256:' + 'a'.repeat(64),
        email_ref: 'hmac-sha256:' + 'c'.repeat(64),
        account_ref: 'hmac-sha256:' + 'e'.repeat(64),
        credential_ref: 'opaque:credential-ref:v1:cpaws-a',
        credential_binding_hmac: selectedApiKeyBindingHmac,
        token_type: 'apikey',
        persona_variant: 'claude-code-2.1.175-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.175',
        provider_kind: 'claude_platform_aws',
        workspace_ref: workspaceRef,
        workspace_binding_hmac: workspaceBindingHmac,
        upstream_endpoint_ref: endpointRef,
        aws_region: 'us-east-1',
        upstream_host: 'aws-external-anthropic.us-east-1.api.aws',
        allowed_upstream_path: '/v1/messages',
        upstream_auth_scheme: 'x_api_key',
        beta_policy_ref: betaPolicyRef,
        request_shape_profile_ref: requestShapeProfileRef,
        cache_parity_profile_ref: cacheParityProfileRef,
        anthropic_workspace_id: rawWorkspaceId,
      },
    },
    egress_buckets: {
      'bucket-cpaws-a': {
        enabled: true,
        proxy_url: proxyUrl,
        proxy_identity_ref: 'opaque:proxy-ref:v1:cpaws-a',
        allowed_account_ids: ['cpaws-account-a'],
      },
    },
    env: { ...baseConfig().env, version: '2.1.175', version_base: '2.1.175' },
    ...overrides,
  } as any)
}

async function startDenyConnectProxy() {
  const connectTargets: string[] = []
  const server = createServer()
  server.on('connect', (req, clientSocket) => {
    connectTargets.push(req.url || '')
    clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('proxy listen failed')
  return { server, connectTargets, url: `http://127.0.0.1:${address.port}` }
}

function firstPartyFormalPoolContext(overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    route_class: 'messages',
    path: '/v1/messages',
    account_id: 'first-party-account-a',
    token_type: 'oauth',
    credential_ref: 'opaque:credential-ref:v1:first-party-a',
    credential_source: 'server_account_credentials',
    egress_bucket: 'bucket-first-party-a',
    proxy_identity_ref: 'opaque:proxy-ref:v1:first-party-a',
    policy_version: '2.1.175',
    persona_profile: 'claude-code-2.1.175-macos-local',
    trusted_egress_profile_ref: 'strip_attribution',
    profile_policy_version: 'claude_code_2_1_179_cp1_degraded_v1',
    billing_shape_policy: 'strip',
    request_shape_profile_ref: 'claude_code_2_1_179_messages_streaming_tooldefs_degraded_v1',
    cache_parity_profile_ref: 'claude_code_2_1_179_cache_parity_degraded_v1',
    session_id: defaultSessionId,
    timestamp_ms: Date.now(),
    nonce: `nonce-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    observed_client_profile: {
      schema_version: 'observed_client_profile.v1',
      cli_version_bucket: '2.1.179',
      route_class: 'messages',
      billing_shape: 'absent',
      billing_block_count: 0,
      cc_entrypoint_bucket: 'absent',
    },
    ...overrides,
  }
}

function firstPartyHeaders(contextOverrides: Record<string, unknown> = {}) {
  const context = firstPartyFormalPoolContext(contextOverrides)
  return {
    'x-cc-gateway-token': 'gateway-token',
    'x-cc-provider': 'anthropic',
    'x-cc-account-id': String(context.account_id),
    'x-cc-token-type': String(context.token_type),
    'x-cc-credential-ref': String(context.credential_ref),
    'x-cc-egress-bucket': String(context.egress_bucket),
    'x-cc-policy-version': String(context.policy_version),
    'x-claude-code-session-id': String(context.session_id),
    authorization: 'Bearer first-party-selected-token',
    ...signedFormalPoolHeaders(context),
  }
}

function firstPartyConfig(upstreamUrl: string, proxyUrl: string) {
  return baseConfig({
    mode: 'sub2api',
    upstream: { url: upstreamUrl },
    auth: { gateway_token: 'gateway-token', internal_control_token: internalControlToken, tokens: [] },
    oauth: undefined,
    shared_pool: {
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:test',
      context_attestation_secret: attestationSecret,
      upstream_mode: 'production',
      production_upstream_enabled: true,
    },
    account_identities: {
      'first-party-account-a': {
        device_id: 'f'.repeat(64),
        account_uuid_ref: 'hmac-sha256:' + '1'.repeat(64),
        credential_ref: 'opaque:credential-ref:v1:first-party-a',
        credential_binding_hmac: credentialBindingHmac('Bearer first-party-selected-token', 'oauth'),
        token_type: 'oauth',
        persona_variant: 'claude-code-2.1.175-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.175',
      },
    },
    egress_buckets: {
      'bucket-first-party-a': {
        enabled: true,
        proxy_url: proxyUrl,
        proxy_identity_ref: 'opaque:proxy-ref:v1:first-party-a',
        allowed_account_ids: ['first-party-account-a'],
      },
    },
    env: { ...baseConfig().env, version: '2.1.175', version_base: '2.1.175' },
  } as any)
}

test('claude platform aws forwards only server-selected workspace/auth to final upstream', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(awsSub2apiConfig(upstream.url, proxy.url))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: awsSchedulerHeaders({
        authorization: 'Bearer client-spoofed-token',
        'anthropic-workspace-id': 'client-spoofed-workspace',
        'anthropic-beta': 'client-spoofed-beta',
        'x-cc-extra-secret': 'must-not-leak',
        'x-sub2api-extra-secret': 'must-not-leak',
      }),
      body: awsBody(),
    })

    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    const captured = upstream.captured[0]
    assert.equal(captured.method, 'POST')
    assert.equal(captured.url, '/v1/messages')
    assert.equal(captured.headers.host, 'aws-external-anthropic.us-east-1.api.aws')
    assert.equal(captured.headers['anthropic-workspace-id'], rawWorkspaceId)
    assert.equal(captured.headers['x-api-key'], selectedApiKey)
    assert.equal(captured.headers.authorization, undefined)
    assert.equal(captured.headers['anthropic-beta'], undefined)
    assert.ok(!Object.keys(captured.headers).some((key) => key.startsWith('x-cc-')))
    assert.ok(!Object.keys(captured.headers).some((key) => key.startsWith('x-sub2api-')))
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('first-party formal-pool traffic cannot use the AWS Claude Platform upstream host', async () => {
  const proxy = await startDenyConnectProxy()
  const gateway = startProxy(firstPartyConfig('https://aws-external-anthropic.us-east-1.api.aws', proxy.url))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: firstPartyHeaders(),
      body: awsBody(),
    })
    assert.equal(response.status, 403, response.body)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'real_aws_claude_platform_provider_mismatch')
    assert.equal(proxy.connectTargets.length, 0)
  } finally {
    await close(gateway)
    await close(proxy.server)
  }
})

test('claude platform aws requires workspace identity and rejects workspace ref mismatch', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(awsSub2apiConfig(upstream.url, proxy.url))

  try {
    const missing = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: awsSchedulerHeaders({}, { workspace_ref: undefined }),
      body: awsBody(),
    })
    assert.equal(missing.status, 403)
    assert.equal(missing.headers['x-cc-gateway-error-code'], 'malformed_formal_pool_context_attestation')

    const mismatch = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: awsSchedulerHeaders({}, { workspace_ref: 'workspace:cpaws-other' }),
      body: awsBody(),
    })
    assert.equal(mismatch.status, 403)
    assert.equal(mismatch.headers['x-cc-gateway-error-code'], 'formal_pool_context_mismatch')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('claude platform aws rejects attested credential binding hmac mismatch', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(awsSub2apiConfig(upstream.url, proxy.url))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: awsSchedulerHeaders({}, { credential_binding_hmac: 'hmac-sha256:' + '9'.repeat(64) }),
      body: awsBody(),
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'credential_account_mismatch')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('claude platform aws rejects region host path and internal beta query mismatches', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(awsSub2apiConfig(upstream.url, proxy.url))

  try {
    const regionMismatch = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: awsSchedulerHeaders({}, { aws_region: 'us-west-2', upstream_host: 'aws-external-anthropic.us-west-2.api.aws' }),
      body: awsBody(),
    })
    assert.equal(regionMismatch.status, 403)
    assert.equal(regionMismatch.headers['x-cc-gateway-error-code'], 'formal_pool_context_mismatch')

    const hostMismatch = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: awsSchedulerHeaders({}, { upstream_host: 'api.anthropic.com' }),
      body: awsBody(),
    })
    assert.equal(hostMismatch.status, 403)
    assert.ok(['malformed_formal_pool_context_attestation', 'formal_pool_context_mismatch'].includes(String(hostMismatch.headers['x-cc-gateway-error-code'])))

    const betaQueryLeak = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: awsSchedulerHeaders({}, { path: '/v1/messages' }),
      body: awsBody(),
    })
    assert.equal(betaQueryLeak.status, 404)
    assert.equal(betaQueryLeak.headers['x-cc-gateway-error-code'], 'unsupported_route')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('aws endpoint host is allowed only for claude platform aws provider kind', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(awsSub2apiConfig(upstream.url, proxy.url, {
    upstream: { url: 'https://aws-external-anthropic.us-east-1.api.aws' },
    shared_pool: {
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:test',
      context_attestation_secret: attestationSecret,
      upstream_mode: 'production',
      production_upstream_enabled: true,
    },
  }))

  try {
    const wrongProvider = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: awsSchedulerHeaders({}, { provider_kind: 'anthropic_first_party' }),
      body: awsBody(),
    })
    assert.ok([403, 404].includes(wrongProvider.status))
    assert.ok(['unsupported_route', 'formal_pool_context_mismatch', 'formal_pool_profile_ref_unapproved'].includes(String(wrongProvider.headers['x-cc-gateway-error-code'])))
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})


test('claude platform aws configured upstream requires valid provider attestation before egress', async () => {
  const proxy = await startDenyConnectProxy()
  const gateway = startProxy(awsSub2apiConfig('https://aws-external-anthropic.us-east-1.api.aws', proxy.url, {
    shared_pool: {
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:test',
      context_attestation_secret: attestationSecret,
      upstream_mode: 'production',
      production_upstream_enabled: true,
      production_budget: { mode: 'observe_only', enforcement_enabled: false, p0_hard_block_only: true },
    },
  }))

  try {
    const missingAttestation = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: {
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-account-id': 'cpaws-account-a',
        'x-cc-token-type': 'apikey',
        'x-cc-credential-ref': 'opaque:credential-ref:v1:cpaws-a',
        'x-cc-egress-bucket': 'bucket-cpaws-a',
        'x-cc-policy-version': '2.1.175',
        'x-claude-code-session-id': defaultSessionId,
        'x-api-key': selectedApiKey,
      },
      body: awsBody(),
    })
    assert.equal(missingAttestation.status, 403)
    assert.equal(missingAttestation.headers['x-cc-gateway-error-code'], 'missing_formal_pool_context_attestation')

    const wrongProvider = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: awsSchedulerHeaders({}, { provider_kind: 'anthropic_first_party' }),
      body: awsBody(),
    })
    assert.ok([403, 404].includes(wrongProvider.status))
    assert.ok(['real_aws_claude_platform_provider_mismatch', 'unsupported_route'].includes(String(wrongProvider.headers['x-cc-gateway-error-code'])))
    assert.equal(proxy.connectTargets.length, 0)
  } finally {
    await close(gateway)
    await close(proxy.server)
  }
})

test('claude platform aws final verifier catches final body profile mismatch before egress', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(awsSub2apiConfig(upstream.url, proxy.url))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: awsSchedulerHeaders(),
      body: { ...awsBody(), cpaws_unknown_final_field: 'fake-profile-mismatch-fixture' },
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'request_shape_profile_mismatch')
    assert.equal(upstream.captured.length, 0)
    assert.equal(proxy.connectTargets.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('claude platform aws session ledger rejects workspace endpoint auth beta profile switches', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(awsSub2apiConfig(upstream.url, proxy.url))

  try {
    const first = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: awsSchedulerHeaders(),
      body: awsBody(),
    })
    assert.equal(first.status, 200, first.body)

    for (const [name, overrides] of [
      ['workspace_ref', { workspace_ref: 'workspace:cpaws-b' }],
      ['workspace_binding_hmac', { workspace_binding_hmac: 'hmac-sha256:' + 'f'.repeat(64) }],
      ['endpoint', { upstream_endpoint_ref: 'endpoint:aws-external-anthropic:us-west-2', aws_region: 'us-west-2', upstream_host: 'aws-external-anthropic.us-west-2.api.aws' }],
      ['auth', { upstream_auth_scheme: 'bearer_api_key' }],
      ['beta_policy', { beta_policy_ref: 'beta-policy:claude-platform-aws-v1-other' }],
      ['request_shape', { request_shape_profile_ref: 'request-shape:claude-platform-aws-v1-other' }],
      ['cache_profile', { cache_parity_profile_ref: 'cache-profile:claude-platform-aws-v1-other' }],
    ] as Array<[string, Record<string, unknown>]>) {
      const switched = await httpJson(serverUrl(gateway, '/v1/messages'), {
        headers: awsSchedulerHeaders({}, overrides),
        body: awsBody(),
      })
      assert.equal(switched.status, 403, name)
      assert.match(String(switched.headers['x-cc-gateway-error-code']), /(formal_pool_(context|session_authority|profile_ref)_|claude_platform_aws_auth_profile_unproven)/)
    }
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})


test('claude platform aws rejects raw workspace id mismatch against workspace ref', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(awsSub2apiConfig(upstream.url, proxy.url, {
    account_identities: {
      'cpaws-account-a': {
        device_id: 'b'.repeat(64),
        account_uuid_ref: 'hmac-sha256:' + 'a'.repeat(64),
        email_ref: 'hmac-sha256:' + 'c'.repeat(64),
        account_ref: 'hmac-sha256:' + 'e'.repeat(64),
        credential_ref: 'opaque:credential-ref:v1:cpaws-a',
        credential_binding_hmac: selectedApiKeyBindingHmac,
        token_type: 'apikey',
        persona_variant: 'claude-code-2.1.175-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.175',
        provider_kind: 'claude_platform_aws',
        workspace_ref: workspaceRef,
        workspace_binding_hmac: workspaceBindingHmac,
        upstream_endpoint_ref: endpointRef,
        aws_region: 'us-east-1',
        upstream_host: 'aws-external-anthropic.us-east-1.api.aws',
        allowed_upstream_path: '/v1/messages',
        upstream_auth_scheme: 'x_api_key',
        beta_policy_ref: betaPolicyRef,
        request_shape_profile_ref: requestShapeProfileRef,
        cache_parity_profile_ref: cacheParityProfileRef,
        anthropic_workspace_id: 'different-workspace-id-local-fixture',
      },
    },
  }))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: awsSchedulerHeaders(),
      body: awsBody(),
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'claude_platform_aws_workspace_ref_mismatch')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('claude platform aws rejects workspace ref not recomputed from raw workspace id', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const badWorkspaceRef = formalPoolSafeRef('workspace', `claude_platform_aws_workspace_ref_v1\0us-east-1\0other-workspace-id-local-fixture`)
  const badBinding = claudePlatformAwsWorkspaceBindingHmac({ workspaceRef: badWorkspaceRef })
  const gateway = startProxy(awsSub2apiConfig(upstream.url, proxy.url, {
    account_identities: {
      'cpaws-account-a': {
        device_id: 'b'.repeat(64),
        account_uuid_ref: 'hmac-sha256:' + 'a'.repeat(64),
        email_ref: 'hmac-sha256:' + 'c'.repeat(64),
        account_ref: 'hmac-sha256:' + 'e'.repeat(64),
        credential_ref: 'opaque:credential-ref:v1:cpaws-a',
        credential_binding_hmac: selectedApiKeyBindingHmac,
        token_type: 'apikey',
        persona_variant: 'claude-code-2.1.175-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.175',
        provider_kind: 'claude_platform_aws',
        workspace_ref: badWorkspaceRef,
        workspace_binding_hmac: badBinding,
        upstream_endpoint_ref: endpointRef,
        aws_region: 'us-east-1',
        upstream_host: 'aws-external-anthropic.us-east-1.api.aws',
        allowed_upstream_path: '/v1/messages',
        upstream_auth_scheme: 'x_api_key',
        beta_policy_ref: betaPolicyRef,
        request_shape_profile_ref: requestShapeProfileRef,
        cache_parity_profile_ref: cacheParityProfileRef,
        anthropic_workspace_id: rawWorkspaceId,
      },
    },
  }))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: awsSchedulerHeaders({}, { workspace_ref: badWorkspaceRef, workspace_binding_hmac: badBinding }),
      body: awsBody(),
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'claude_platform_aws_workspace_ref_mismatch')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('claude platform aws rejects workspace binding hmac tuple mismatch', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const tupleMismatchBinding = claudePlatformAwsWorkspaceBindingHmac({ egressBucket: 'bucket-cpaws-other' })
  const gateway = startProxy(awsSub2apiConfig(upstream.url, proxy.url, {
    account_identities: {
      'cpaws-account-a': {
        device_id: 'b'.repeat(64),
        account_uuid_ref: 'hmac-sha256:' + 'a'.repeat(64),
        email_ref: 'hmac-sha256:' + 'c'.repeat(64),
        account_ref: 'hmac-sha256:' + 'e'.repeat(64),
        credential_ref: 'opaque:credential-ref:v1:cpaws-a',
        credential_binding_hmac: selectedApiKeyBindingHmac,
        token_type: 'apikey',
        persona_variant: 'claude-code-2.1.175-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.175',
        provider_kind: 'claude_platform_aws',
        workspace_ref: workspaceRef,
        workspace_binding_hmac: tupleMismatchBinding,
        upstream_endpoint_ref: endpointRef,
        aws_region: 'us-east-1',
        upstream_host: 'aws-external-anthropic.us-east-1.api.aws',
        allowed_upstream_path: '/v1/messages',
        upstream_auth_scheme: 'x_api_key',
        beta_policy_ref: betaPolicyRef,
        request_shape_profile_ref: requestShapeProfileRef,
        cache_parity_profile_ref: cacheParityProfileRef,
        anthropic_workspace_id: rawWorkspaceId,
      },
    },
  }))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: awsSchedulerHeaders({}, { workspace_binding_hmac: tupleMismatchBinding }),
      body: awsBody(),
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'claude_platform_aws_workspace_binding_mismatch')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('claude platform aws runtime registration persists aws fields and rejects conflicting replay', async () => {
  const mappingDir = mkdtempSync(join(tmpdir(), 'cc-gateway-cpaws-runtime-'))
  const previousMappingFile = process.env.CC_GATEWAY_RUNTIME_MAPPING_FILE
  process.env.CC_GATEWAY_RUNTIME_MAPPING_FILE = join(mappingDir, 'runtime-mappings.json')
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(awsSub2apiConfig(upstream.url, proxy.url, { account_identities: {}, egress_buckets: {} }))

  try {
    const runtimeAccountRef = 'opaque:account-ref:v1:cpaws-runtime-a'
    const runtimeProxyRef = 'opaque:proxy-ref:v1:cpaws-runtime-a'
    const runtimeBucket = 'bucket-cpaws-runtime-a'
    const runtimeBindingHmac = claudePlatformAwsWorkspaceBindingHmac({
      accountRef: runtimeAccountRef,
      egressBucket: runtimeBucket,
      proxyIdentityRef: runtimeProxyRef,
    })
    const registered = await httpJson(serverUrl(gateway, '/_runtime/register-account'), {
      headers: { 'x-cc-gateway-token': 'gateway-token', 'x-cc-internal-control-token': internalControlToken, 'x-api-key': selectedApiKey },
      body: {
        account_id: 'cpaws-runtime-a',
        account_ref: runtimeAccountRef,
        account_uuid_ref: runtimeAccountRef,
        device_id: 'd'.repeat(64),
        egress_bucket: runtimeBucket,
        proxy_url: proxy.url,
        proxy_identity_ref: runtimeProxyRef,
        credential_ref: 'opaque:credential-ref:v1:cpaws-a',
        credential_binding_hmac: selectedApiKeyBindingHmac,
        token_type: 'apikey',
        policy_version: '2.1.175',
        provider_kind: 'claude_platform_aws',
        workspace_ref: workspaceRef,
        workspace_binding_hmac: runtimeBindingHmac,
        upstream_endpoint_ref: endpointRef,
        aws_region: 'us-east-1',
        upstream_host: 'aws-external-anthropic.us-east-1.api.aws',
        allowed_upstream_path: '/v1/messages',
        upstream_auth_scheme: 'x_api_key',
        beta_policy_ref: betaPolicyRef,
        request_shape_profile_ref: requestShapeProfileRef,
        cache_parity_profile_ref: cacheParityProfileRef,
        anthropic_workspace_id: rawWorkspaceId,
      },
    })
    assert.equal(registered.status, 200, registered.body)
    const persisted = JSON.parse(readFileSync(process.env.CC_GATEWAY_RUNTIME_MAPPING_FILE!, 'utf-8'))
    const mapping = persisted.mappings['cpaws-runtime-a']
    assert.equal(mapping.provider_kind, 'claude_platform_aws')
    assert.equal(mapping.workspace_ref, workspaceRef)
    assert.equal(mapping.workspace_binding_hmac, runtimeBindingHmac)
    assert.equal(mapping.upstream_auth_scheme, 'x_api_key')
    assert.equal(mapping.anthropic_workspace_id, rawWorkspaceId)

    const conflictingProxyRef = 'opaque:proxy-ref:v1:cpaws-runtime-other'
    const conflictingBindingHmac = claudePlatformAwsWorkspaceBindingHmac({
      accountRef: runtimeAccountRef,
      egressBucket: runtimeBucket,
      proxyIdentityRef: conflictingProxyRef,
    })
    const conflict = await httpJson(serverUrl(gateway, '/_runtime/register-account'), {
      headers: { 'x-cc-gateway-token': 'gateway-token', 'x-cc-internal-control-token': internalControlToken, 'x-api-key': selectedApiKey },
      body: { ...mapping, proxy_identity_ref: conflictingProxyRef, workspace_binding_hmac: conflictingBindingHmac },
    })
    assert.equal(conflict.status, 409)
    assert.equal(conflict.headers['x-cc-gateway-error-code'], 'runtime_mapping_authority_exists')
  } finally {
    if (previousMappingFile === undefined) delete process.env.CC_GATEWAY_RUNTIME_MAPPING_FILE
    else process.env.CC_GATEWAY_RUNTIME_MAPPING_FILE = previousMappingFile
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('claude platform aws runtime replay blocks old mappings without aws capability fields', async () => {
  const mappingDir = mkdtempSync(join(tmpdir(), 'cc-gateway-cpaws-old-runtime-'))
  const mappingFile = join(mappingDir, 'runtime-mappings.json')
  const previousMappingFile = process.env.CC_GATEWAY_RUNTIME_MAPPING_FILE
  process.env.CC_GATEWAY_RUNTIME_MAPPING_FILE = mappingFile
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const legacy = {
    account_id: 'cpaws-old-runtime',
    account_ref: 'opaque:account-ref:v1:cpaws-old-runtime',
    account_uuid_ref: 'opaque:account-ref:v1:cpaws-old-runtime',
    credential_ref: 'opaque:credential-ref:v1:cpaws-a',
    credential_binding_hmac: credentialBindingHmac(selectedApiKey),
    token_type: 'apikey',
    egress_bucket: 'bucket-cpaws-old-runtime',
    proxy_url: proxy.url,
    proxy_identity_ref: 'opaque:proxy-ref:v1:cpaws-old-runtime',
    persona_variant: 'claude-code-2.1.175-macos-local',
    session_policy: 'preserve_downstream_session_id',
    policy_version: '2.1.175',
    device_id: 'e'.repeat(64),
  }
  await import('fs').then(({ writeFileSync }) => writeFileSync(mappingFile, JSON.stringify({ version: 1, mappings: { [legacy.account_id]: legacy } }, null, 2)))
  const gateway = startProxy(awsSub2apiConfig(upstream.url, proxy.url, { account_identities: {}, egress_buckets: {} }))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: awsSchedulerHeaders({
        'x-cc-account-id': legacy.account_id,
        'x-cc-egress-bucket': legacy.egress_bucket,
        'x-claude-code-session-id': defaultSessionId,
      }, { account_id: legacy.account_id, egress_bucket: legacy.egress_bucket, proxy_identity_ref: legacy.proxy_identity_ref }),
      body: awsBody(),
    })
    assert.equal(response.status, 403)
    assert.ok(['missing_account_identity', 'formal_pool_context_mismatch'].includes(String(response.headers['x-cc-gateway-error-code'])))
    assert.equal(upstream.captured.length, 0)
  } finally {
    if (previousMappingFile === undefined) delete process.env.CC_GATEWAY_RUNTIME_MAPPING_FILE
    else process.env.CC_GATEWAY_RUNTIME_MAPPING_FILE = previousMappingFile
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})





test('claude platform aws production requires explicit workspace authority secrets', async () => {
  const proxy = await startDenyConnectProxy()
  const ledgerDir = mkdtempSync(join(tmpdir(), 'cc-gateway-cpaws-prod-secret-ledger-'))
  const previousLedgerFile = process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE
  process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE = join(ledgerDir, 'formal-pool-session-ledger.json')
  const gateway = startProxy(awsSub2apiConfig('https://aws-external-anthropic.us-east-1.api.aws', proxy.url, {
    shared_pool: {
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:test',
      context_attestation_secret: attestationSecret,
      upstream_mode: 'production',
      production_upstream_enabled: true,
      production_budget: { mode: 'observe_only', enforcement_enabled: false, p0_hard_block_only: true },
    },
  }))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: awsSchedulerHeaders(),
      body: awsBody(),
    })
    assert.equal(response.status, 403, response.body)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'claude_platform_aws_workspace_authority_secret_missing')
    assert.equal(proxy.connectTargets.length, 0)
  } finally {
    if (previousLedgerFile === undefined) delete process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE
    else process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE = previousLedgerFile
    await close(gateway)
    await close(proxy.server)
  }
})

test('claude platform aws production rejects configured upstream endpoint mismatch before egress', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const ledgerDir = mkdtempSync(join(tmpdir(), 'cc-gateway-cpaws-prod-ledger-'))
  const previousLedgerFile = process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE
  process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE = join(ledgerDir, 'formal-pool-session-ledger.json')
  const gateway = startProxy(awsSub2apiConfig(upstream.url, proxy.url, {
    shared_pool: {
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:test',
      context_attestation_secret: attestationSecret,
      upstream_mode: 'production',
      production_upstream_enabled: true,
      production_budget: { mode: 'observe_only', enforcement_enabled: false, p0_hard_block_only: true },
    },
  }))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: awsSchedulerHeaders(),
      body: awsBody(),
    })
    assert.equal(response.status, 403, response.body)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'claude_platform_aws_endpoint_mismatch')
    assert.equal(upstream.captured.length, 0)
  } finally {
    if (previousLedgerFile === undefined) delete process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE
    else process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE = previousLedgerFile
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('claude platform aws raw capture artifacts contain only safe summaries', async () => {
  const captureDir = mkdtempSync(join(tmpdir(), 'cc-gateway-cpaws-capture-'))
  const previousCaptureDir = process.env.CC_GATEWAY_RAW_CAPTURE_DIR
  const previousFullRaw = process.env.CC_GATEWAY_FULL_RAW_CAPTURE
  process.env.CC_GATEWAY_RAW_CAPTURE_DIR = captureDir
  process.env.CC_GATEWAY_FULL_RAW_CAPTURE = '1'
  const upstream = await startFakeUpstream((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, secret_echo: 'not-a-real-secret-response' }))
  })
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(awsSub2apiConfig(upstream.url, proxy.url))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: awsSchedulerHeaders(),
      body: awsBody(),
    })
    assert.equal(response.status, 200, response.body)
    const text = readdirSync(captureDir)
      .map((file) => readFileSync(join(captureDir, file), 'utf-8'))
      .join('\n')
    assert.ok(!text.includes(rawWorkspaceId))
    assert.ok(!text.includes(selectedApiKey))
    assert.ok(!text.includes('not-a-real-secret-response'))
    assert.ok(!text.includes('hello'))
  } finally {
    if (previousCaptureDir === undefined) delete process.env.CC_GATEWAY_RAW_CAPTURE_DIR
    else process.env.CC_GATEWAY_RAW_CAPTURE_DIR = previousCaptureDir
    if (previousFullRaw === undefined) delete process.env.CC_GATEWAY_FULL_RAW_CAPTURE
    else process.env.CC_GATEWAY_FULL_RAW_CAPTURE = previousFullRaw
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

await finish()
