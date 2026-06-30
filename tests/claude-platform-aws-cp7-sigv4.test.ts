import { strict as assert } from 'assert'
import { createHmac } from 'crypto'
import { mkdtempSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { startProxy } from '../src/proxy.js'
import { baseConfig, close, finish, httpJson, serverUrl, startFakeConnectProxy, startFakeUpstream, test } from './helpers.js'

console.log('\ntests/claude-platform-aws-cp7-sigv4.test.ts')

const attestationSecret = 'scheduler-hmac-material-v1-local-safe-fixture-123456'
const internalControlToken = 'internal-control-material-v1-local-safe-fixture-123456'
const workspaceHmacSecret = 'local-fixture-workspace-ref-hmac-material-123456'
const workspaceBindingSecret = 'local-fixture-workspace-binding-hmac-material-123456'
const defaultSessionId = '123e4567-e89b-42d3-a456-426614174999'
const rawWorkspaceId = 'workspace-id-local-fixture-cp7'
const endpointRef = 'endpoint:aws-external-anthropic:us-east-1'
const betaPolicyRef = 'beta-policy:claude-platform-aws-v1-strip'
const requestShapeProfileRef = 'request-shape:claude-platform-aws-v1-strip'
const cacheParityProfileRef = 'cache-profile:claude-platform-aws-v1-strip'
const awsAccessKeyId = 'AKIDCP7LOCALFIXTURE'
const awsSecretAccessKey = 'cp7-local-secret-access-key-material-not-real-1234567890'
const awsSessionToken = 'cp7-local-session-token-fixture-not-real-123456'
const workspaceRef = formalPoolSafeRef('workspace', `claude_platform_aws_workspace_ref_v1\0us-east-1\0${rawWorkspaceId}`)
const workspaceBindingHmac = claudePlatformAwsWorkspaceBindingHmac({ workspaceRef, authScheme: 'sigv4' })
const credentialBinding = credentialBindingHmac(awsAccessKeyId)

function canonicalFormalPoolContext(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = value[key]
    return acc
  }, {} as Record<string, unknown>))
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64url')
}

function signedFormalPoolHeaders(context: Record<string, unknown>, secret = attestationSecret) {
  const canonical = canonicalFormalPoolContext(context)
  return {
    'x-cc-formal-pool-context': base64url(canonical),
    'x-cc-formal-pool-signature': `hmac-sha256:${createHmac('sha256', secret).update(canonical).digest('hex')}`,
  }
}

function credentialBindingHmac(rawCredential: string, tokenType: 'apikey' = 'apikey', secret = attestationSecret) {
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
    credentialRef: 'opaque:credential-ref:v1:cpaws-sigv4',
    workspaceRef,
    endpointRef,
    region: 'us-east-1',
    authScheme: 'sigv4',
    egressBucket: 'bucket-cpaws-sigv4',
    proxyIdentityRef: 'opaque:proxy-ref:v1:cpaws-sigv4',
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

function sigv4FormalPoolContext(overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    route_class: 'messages',
    path: '/v1/messages',
    provider_kind: 'claude_platform_aws',
    upstream_auth_scheme: 'sigv4',
    account_id: 'cpaws-sigv4-account',
    token_type: 'apikey',
    credential_ref: 'opaque:credential-ref:v1:cpaws-sigv4',
    credential_binding_hmac: credentialBinding,
    credential_source: 'server_account_credentials',
    egress_bucket: 'bucket-cpaws-sigv4',
    proxy_identity_ref: 'opaque:proxy-ref:v1:cpaws-sigv4',
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

function sigv4Headers(headers: Record<string, string> = {}, contextOverrides: Record<string, unknown> = {}) {
  const context = sigv4FormalPoolContext(contextOverrides)
  return {
    'x-cc-gateway-token': 'gateway-token',
    'x-cc-provider': 'anthropic',
    'x-cc-account-id': String(context.account_id),
    'x-cc-token-type': String(context.token_type),
    'x-cc-credential-ref': String(context.credential_ref),
    'x-cc-egress-bucket': String(context.egress_bucket),
    'x-cc-policy-version': String(context.policy_version),
    'x-claude-code-session-id': String(context.session_id),
    'x-api-key': awsAccessKeyId,
    ...headers,
    ...signedFormalPoolHeaders(context),
  }
}

function sigv4Body(sessionId = defaultSessionId) {
  return {
    metadata: { user_id: JSON.stringify({ session_id: sessionId }) },
    model: 'claude-sonnet-4-6',
    max_tokens: 32,
    messages: [{ role: 'user', content: 'hello sigv4' }],
  }
}

function sigv4Config(upstreamUrl: string, proxyUrl: string, overrides: Record<string, unknown> = {}) {
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
      claude_platform_aws_sigv4_enabled: true,
      upstream_mode: 'local-capture',
    },
    account_identities: {
      'cpaws-sigv4-account': {
        device_id: 'b'.repeat(64),
        account_uuid_ref: 'hmac-sha256:' + 'a'.repeat(64),
        email_ref: 'hmac-sha256:' + 'c'.repeat(64),
        account_ref: 'hmac-sha256:' + 'e'.repeat(64),
        credential_ref: 'opaque:credential-ref:v1:cpaws-sigv4',
        credential_binding_hmac: credentialBinding,
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
        upstream_auth_scheme: 'sigv4',
        beta_policy_ref: betaPolicyRef,
        request_shape_profile_ref: requestShapeProfileRef,
        cache_parity_profile_ref: cacheParityProfileRef,
        anthropic_workspace_id: rawWorkspaceId,
        aws_access_key_id: awsAccessKeyId,
        aws_secret_access_key: awsSecretAccessKey,
        aws_session_token: awsSessionToken,
      },
    },
    egress_buckets: {
      'bucket-cpaws-sigv4': {
        enabled: true,
        proxy_url: proxyUrl,
        proxy_identity_ref: 'opaque:proxy-ref:v1:cpaws-sigv4',
        allowed_account_ids: ['cpaws-sigv4-account'],
      },
    },
    env: { ...baseConfig().env, version: '2.1.175', version_base: '2.1.175' },
    ...overrides,
  } as any)
}

test('claude platform aws sigv4 signs the final rewritten request with service and endpoint region', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sigv4Config(upstream.url, proxy.url))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: sigv4Headers({
        authorization: 'Bearer client-spoofed-token',
        'anthropic-workspace-id': 'client-spoofed-workspace',
        'x-amz-security-token': 'client-spoofed-session-token',
        'x-api-key': awsAccessKeyId,
      }),
      body: sigv4Body(),
    })

    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    const captured = upstream.captured[0]
    const authorization = String(captured.headers.authorization || '')
    assert.equal(captured.url, '/v1/messages')
    assert.equal(captured.headers.host, 'aws-external-anthropic.us-east-1.api.aws')
    assert.equal(captured.headers['anthropic-workspace-id'], rawWorkspaceId)
    assert.equal(captured.headers['x-api-key'], undefined)
    assert.equal(captured.headers['x-amz-security-token'], awsSessionToken)
    assert.match(authorization, /^AWS4-HMAC-SHA256 /)
    assert.match(authorization, /Credential=AKIDCP7LOCALFIXTURE\/\d{8}\/us-east-1\/aws-external-anthropic\/aws4_request/)
    assert.match(authorization, /SignedHeaders=[^,]*anthropic-workspace-id[^,]*/)
    assert.match(authorization, /SignedHeaders=[^,]*x-amz-security-token[^,]*/)
    assert.ok(!authorization.includes('bedrock'))
    assert.ok(!Object.keys(captured.headers).some((key) => key.startsWith('x-cc-') || key.startsWith('x-sub2api-')))
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('claude platform aws sigv4 refuses to sign without explicit profile gate', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sigv4Config(upstream.url, proxy.url, {
    shared_pool: {
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:test',
      context_attestation_secret: attestationSecret,
      sticky_session_hmac_key: workspaceHmacSecret,
      claude_platform_aws_workspace_binding_hmac_key: workspaceBindingSecret,
      upstream_mode: 'local-capture',
    },
  }))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: sigv4Headers(),
      body: sigv4Body(),
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'claude_platform_aws_sigv4_profile_unproven')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(proxy.server)
  }
})

test('claude platform aws sigv4 capture omits canonical request secrets workspace and raw body', async () => {
  const captureDir = mkdtempSync(join(tmpdir(), 'cc-gateway-cpaws-sigv4-capture-'))
  const previousCaptureDir = process.env.CC_GATEWAY_RAW_CAPTURE_DIR
  const previousFullRaw = process.env.CC_GATEWAY_FULL_RAW_CAPTURE
  process.env.CC_GATEWAY_RAW_CAPTURE_DIR = captureDir
  process.env.CC_GATEWAY_FULL_RAW_CAPTURE = '1'
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sigv4Config(upstream.url, proxy.url))

  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: sigv4Headers(),
      body: sigv4Body(),
    })
    assert.equal(response.status, 200, response.body)
    const text = readdirSync(captureDir)
      .map((file) => readFileSync(join(captureDir, file), 'utf-8'))
      .join('\n')
    assert.ok(!text.includes(rawWorkspaceId))
    assert.ok(!text.includes(awsAccessKeyId))
    assert.ok(!text.includes(awsSecretAccessKey))
    assert.ok(!text.includes(awsSessionToken))
    assert.ok(!text.includes('hello sigv4'))
    assert.ok(!text.includes('AWS4-HMAC-SHA256'))
    assert.ok(!text.includes('canonical_request'))
    assert.ok(!text.includes('string_to_sign'))
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
