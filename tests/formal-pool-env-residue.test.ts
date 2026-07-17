import { strict as assert } from 'assert'
import { createHmac } from 'crypto'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { startProxy } from '../src/proxy.js'
import { baseConfig, close, finish, httpJson, serverUrl, startFakeConnectProxy, startFakeUpstream, test, waitForListening } from './helpers.js'

console.log('\ntests/formal-pool-env-residue.test.ts')

const attestationSecret = 'scheduler-hmac-material-v1-env-residue-fixture-123456'
const sessionId = '123e4567-e89b-42d3-a456-426614174777'
const envResidueProfileRef = 'env-residue-profile:claude-code-2.1.179-us-pacific-official-anthropic-v1'
const localeProfileRef = 'locale-profile:us-pacific-v1'
const baseUrlResidueProfileRef = 'base-url-residue-profile:official-anthropic-v1'
const credentialRef = 'opaque:credential-ref:v1:env-residue-a'
const proxyRef = 'opaque:proxy-ref:v1:env-residue-a'
const selectedCredential = 'Bearer synthetic-env-residue-token'
const workspaceRefSecret = 'env-residue-workspace-ref-hmac-material-123456'
const workspaceBindingSecret = 'env-residue-workspace-binding-hmac-material-123456'
const rawWorkspaceId = 'workspace-fixture-safe'


function formalPoolSafeRef(scope: string, raw: string, secret = workspaceRefSecret) {
  return `hmac-sha256:${createHmac('sha256', secret)
    .update(`formal_pool_${scope}`)
    .update('\0')
    .update('v1')
    .update('\0')
    .update(raw)
    .digest('hex')}`
}

function workspaceBindingHmac(input: {
  providerKind: string
  accountRef: string
  credentialRef: string
  workspaceRef: string
  endpointRef: string
  region: string
  authScheme: string
  egressBucket: string
  proxyIdentityRef: string
}) {
  return `hmac-sha256:${createHmac('sha256', workspaceBindingSecret)
    .update([
      'claude_platform_aws_workspace_binding_v1',
      input.providerKind,
      input.accountRef,
      input.credentialRef,
      input.workspaceRef,
      input.endpointRef,
      input.region,
      input.authScheme,
      input.egressBucket,
      input.proxyIdentityRef,
    ].join('\0'))
    .digest('hex')}`
}

function canonicalFormalPoolContext(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = value[key]
    return acc
  }, {} as Record<string, unknown>))
}

function signedContextHeaders(context: Record<string, unknown>, rawContext?: string, secret = attestationSecret) {
  const canonical = rawContext ?? canonicalFormalPoolContext(context)
  return {
    'x-cc-formal-pool-context': Buffer.from(canonical, 'utf-8').toString('base64url'),
    'x-cc-formal-pool-signature': `hmac-sha256:${createHmac('sha256', secret).update(rawContext ? canonicalFormalPoolContext(context) : canonical).digest('hex')}`,
  }
}

function credentialBindingHmac(raw = selectedCredential, tokenType: 'oauth' | 'apikey' = 'oauth') {
  return `hmac-sha256:${createHmac('sha256', attestationSecret)
    .update('formal_pool_credential_binding_v1')
    .update('\0')
    .update(tokenType)
    .update('\0')
    .update(raw)
    .digest('hex')}`
}

function sharedConfig(upstreamUrl: string, proxyUrl: string, extraSharedPool: Record<string, unknown> = {}) {
  return baseConfig({
    mode: 'sub2api',
    upstream: { url: upstreamUrl },
    auth: { gateway_token: 'gateway-token', internal_control_token: 'internal-control-env-residue-fixture', tokens: [] },
    oauth: undefined,
    env: { ...baseConfig().env, version: '2.1.179', version_base: '2.1.179' },
    shared_pool: {
      upstream_mode: 'preflight',
      billing_cch_mode: 'strip',
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:env-residue',
      context_attestation_secret: attestationSecret,
      env_residue: {
        env_residue_profile_ref: envResidueProfileRef,
        locale_profile_ref: localeProfileRef,
        base_url_residue_profile_ref: baseUrlResidueProfileRef,
      },
      ...extraSharedPool,
    },
    account_identities: {
      'account-env-a': {
        device_id: 'b'.repeat(64),
        account_uuid_ref: 'hmac-sha256:' + 'a'.repeat(64),
        email_ref: 'hmac-sha256:' + 'c'.repeat(64),
        account_ref: 'hmac-sha256:' + 'd'.repeat(64),
        credential_ref: credentialRef,
        credential_binding_hmac: credentialBindingHmac(),
        token_type: 'oauth',
        persona_variant: 'claude_code_2_1_179_native_degraded',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.179',
      },
    },
    egress_buckets: {
      'bucket-env-a': {
        enabled: true,
        proxy_url: proxyUrl,
        proxy_identity_ref: proxyRef,
        allowed_account_ids: ['account-env-a'],
      },
    },
  } as any)
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    route_class: 'messages',
    path: '/v1/messages',
    account_id: 'account-env-a',
    token_type: 'oauth',
    credential_ref: credentialRef,
    credential_source: 'server_account_credentials',
    egress_bucket: 'bucket-env-a',
    proxy_identity_ref: proxyRef,
    policy_version: '2.1.179',
    persona_profile: 'claude_code_2_1_179_native_degraded',
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
      cli_version_bucket: '2.1.196',
      client_family_bucket: 'cli',
      route_class: 'messages',
      billing_shape: 'absent',
      billing_block_count: 0,
      cc_entrypoint_bucket: 'absent',
      stream: true,
      local_env_residue_present: true,
      date_format_bucket: 'slash',
      apostrophe_bucket: 'unicode_variant_1',
      base_url_category_bucket: 'neutral_gateway',
      proxy_env_bucket: 'loopback_proxy_only',
    },
    session_id: sessionId,
    timestamp_ms: Date.now(),
    nonce: `env-residue-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ...overrides,
  }
}

function headers(contextOverrides: Record<string, unknown> = {}, rawContext?: string) {
  const ctx = context(contextOverrides)
  return {
    'x-cc-gateway-token': 'gateway-token',
    'x-cc-provider': 'anthropic',
    'x-cc-account-id': String(ctx.account_id),
    'x-cc-token-type': String(ctx.token_type),
    authorization: selectedCredential,
    'x-cc-credential-ref': String(ctx.credential_ref),
    'x-cc-egress-bucket': String(ctx.egress_bucket),
    'x-cc-policy-version': String(ctx.policy_version),
    'x-claude-code-session-id': String(ctx.session_id),
    ...signedContextHeaders(ctx, rawContext),
  }
}


function canonicalPacificDateMarker(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return `Today's date is ${year}-${month}-${day}.`
}

function assertNoLocalResidueInHeadersOrQuery(captured: Awaited<ReturnType<typeof startFakeUpstream>>['captured'][number]) {
  assert.doesNotMatch(captured.url, /ANTHROPIC_BASE_URL|HTTP_PROXY|HTTPS_PROXY|base_url_residue_profile|env_residue_profile|locale_profile|TZ/i)
  for (const key of Object.keys(captured.headers)) {
    assert.doesNotMatch(key, /anthropic-base-url|http-proxy|https-proxy|env-residue|locale-profile|base-url-residue|^tz$/i)
  }
}

function body(system: unknown = []) {
  return {
    model: 'claude-sonnet-4-6',
    max_tokens: 32,
    metadata: { user_id: JSON.stringify({ session_id: sessionId }) },
    stream: true,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'safe fixture' }] }],
  }
}

async function withGateway<T>(fn: (gateway: ReturnType<typeof startProxy>, upstream: Awaited<ReturnType<typeof startFakeUpstream>>) => Promise<T>, extraSharedPool: Record<string, unknown> = {}) {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(sharedConfig(upstream.url, proxy.url, extraSharedPool))
  await waitForListening(gateway)
  try {
    return await fn(gateway, upstream)
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
}

test('missing canonical env residue refs fail closed before upstream', async () => {
  await withGateway(async (gateway, upstream) => {
    for (const field of ['env_residue_profile_ref', 'locale_profile_ref', 'base_url_residue_profile_ref']) {
      const ctx = context()
      delete (ctx as any)[field]
      const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
        headers: {
          ...headers({}, canonicalFormalPoolContext(ctx)),
          'x-cc-formal-pool-signature': `hmac-sha256:${createHmac('sha256', attestationSecret).update(canonicalFormalPoolContext(ctx)).digest('hex')}`,
        },
        body: body(),
      })
      assert.equal(response.status, 403)
      assert.ok(['missing_env_residue_profile_ref', 'malformed_formal_pool_context_attestation'].includes(String(response.headers['x-cc-gateway-error-code'])))
    }
    assert.equal(upstream.captured.length, 0)
  })
})

test('malformed env residue attestation cases fail closed', async () => {
  await withGateway(async (gateway, upstream) => {
    const cases: Array<[string, Record<string, string>]> = [
      ['bad_base64', { ...headers(), 'x-cc-formal-pool-context': '%%%not-base64url%%%' }],
      ['bad_json', { ...headers(), 'x-cc-formal-pool-context': Buffer.from('{bad-json', 'utf-8').toString('base64url') }],
      ['bad_hmac', { ...headers(), 'x-cc-formal-pool-signature': 'hmac-sha256:' + '0'.repeat(64) }],
      ['expired', headers({ timestamp_ms: Date.now() - 10 * 60 * 1000 })],
    ]
    const duplicateRaw = canonicalFormalPoolContext(context()).replace('"env_residue_profile_ref":"' + envResidueProfileRef + '"', '"env_residue_profile_ref":"env-residue-profile:conflicting-fixture","env_residue_profile_ref":"' + envResidueProfileRef + '"')
    cases.push(['duplicate_conflicting_fields', headers({}, duplicateRaw)])
    for (const [, caseHeaders] of cases) {
      const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), { headers: caseHeaders, body: body() })
      assert.equal(response.status, 403, response.body)
    }
    const escapedDuplicateRaw = canonicalFormalPoolContext(context()).replace('"env_residue_profile_ref":"' + envResidueProfileRef + '"', '"\\u0065nv_residue_profile_ref":"env-residue-profile:conflicting-fixture","env_residue_profile_ref":"' + envResidueProfileRef + '"')
    const escapedDuplicate = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), { headers: headers({}, escapedDuplicateRaw), body: body() })
    assert.equal(escapedDuplicate.status, 403, escapedDuplicate.body)
    assert.equal(escapedDuplicate.headers['x-cc-gateway-error-code'], 'malformed_formal_pool_context_attestation')
    assert.equal(upstream.captured.length, 0)
  })
})

test('unsafe or mismatched env residue refs fail closed', async () => {
  await withGateway(async (gateway, upstream) => {
    const unsafeRefs = [
      { env_residue_profile_ref: 'env-residue-profile:unknown-fixture' },
      { env_residue_profile_ref: 'https://unsafe.invalid/profile' },
      { locale_profile_ref: 'locale-profile:Bearer-token-fixture' },
      { base_url_residue_profile_ref: 'base-url-residue-profile:ANTHROPIC_BASE_URL-fixture' },
      { base_url_residue_profile_ref: 'base-url-residue-profile:raw-domain-list-like-fixture' },
      { env_residue_profile_ref: `${envResidueProfileRef}\nforged` },
      { locale_profile_ref: 'locale-profile:other-v1' },
    ]
    for (const overrides of unsafeRefs) {
      const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), { headers: headers(overrides), body: body() })
      assert.equal(response.status, 403, response.body)
      assert.ok(['formal_pool_context_mismatch', 'formal_pool_env_residue_profile_unapproved', 'malformed_formal_pool_context_attestation'].includes(String(response.headers['x-cc-gateway-error-code'])))
    }
    assert.equal(upstream.captured.length, 0)
  })
})

test('observed client residue safe keys are admitted but cannot override authority refs', async () => {
  await withGateway(async (gateway, upstream) => {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), { headers: headers(), body: body() })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
  })
})

test('unsafe observed client residue keys fail closed', async () => {
  await withGateway(async (gateway, upstream) => {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: headers({ observed_client_profile: { schema_version: 'observed_client_profile.v1', cli_version_bucket: '2.1.196', raw_prompt: 'forbidden-fixture' } }),
      body: body(),
    })
    assert.equal(response.status, 403)
    assert.equal(upstream.captured.length, 0)
  })
})

test('session ledger rejects same session when env residue refs mutate', async () => {
  const ledgerDir = mkdtempSync(join(tmpdir(), 'plan72-env-ledger-'))
  const oldLedger = process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE
  process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE = join(ledgerDir, 'formal-pool-session-ledger.json')
  try {
    await withGateway(async (gateway, upstream) => {
      const first = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), { headers: headers(), body: body() })
      assert.equal(first.status, 200, first.body)
      const second = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), { headers: headers({ nonce: `mutated-${Date.now()}`, locale_profile_ref: 'locale-profile:other-v1' }), body: body() })
      assert.equal(second.status, 403, second.body)
      assert.equal(second.headers['x-cc-gateway-error-code'], 'formal_pool_session_authority_mismatch')
      assert.equal(upstream.captured.length, 1)
    })
  } finally {
    if (oldLedger === undefined) delete process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE
    else process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE = oldLedger
  }
})

// AWS scoped path must require and bind the same canonical refs.
test('claude platform aws scoped path requires and verifies env residue refs', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const awsConfig = sharedConfig(upstream.url, proxy.url, {
    upstream_mode: 'local-capture',
    sticky_session_hmac_key: workspaceRefSecret,
    claude_platform_aws_workspace_binding_hmac_key: workspaceBindingSecret,
  }) as any
  const awsWorkspaceRef = formalPoolSafeRef('workspace', ['claude_platform_aws_workspace_ref_v1', 'us-east-1', rawWorkspaceId].join('\0'))
  const awsWorkspaceBinding = workspaceBindingHmac({
    providerKind: 'claude_platform_aws',
    accountRef: String(awsConfig.account_identities['account-env-a'].account_ref),
    credentialRef,
    workspaceRef: awsWorkspaceRef,
    endpointRef: 'endpoint:cpaws-env-residue-use1',
    region: 'us-east-1',
    authScheme: 'x_api_key',
    egressBucket: 'bucket-env-a',
    proxyIdentityRef: proxyRef,
  })
  awsConfig.account_identities['account-env-a'] = {
    ...awsConfig.account_identities['account-env-a'],
    token_type: 'apikey',
    credential_binding_hmac: credentialBindingHmac('selected-api-key-fixture', 'apikey'),
    provider_kind: 'claude_platform_aws',
    workspace_ref: awsWorkspaceRef,
    workspace_binding_hmac: awsWorkspaceBinding,
    upstream_endpoint_ref: 'endpoint:cpaws-env-residue-use1',
    aws_region: 'us-east-1',
    upstream_host: 'aws-external-anthropic.us-east-1.api.aws',
    allowed_upstream_path: '/v1/messages',
    upstream_auth_scheme: 'x_api_key',
    beta_policy_ref: 'beta-policy:claude-platform-aws-v1-strip',
    request_shape_profile_ref: 'request-shape:claude-platform-aws-v1-strip',
    cache_parity_profile_ref: 'cache-profile:claude-platform-aws-v1-strip',
    anthropic_workspace_id: rawWorkspaceId,
  }
  const gateway = startProxy(awsConfig)
  await waitForListening(gateway)
  try {
    const awsCtx = context({
      provider_kind: 'claude_platform_aws',
      token_type: 'apikey',
      credential_binding_hmac: credentialBindingHmac('selected-api-key-fixture', 'apikey'),
      upstream_auth_scheme: 'x_api_key',
      workspace_ref: awsWorkspaceRef,
      workspace_binding_hmac: awsWorkspaceBinding,
      upstream_endpoint_ref: 'endpoint:cpaws-env-residue-use1',
      aws_region: 'us-east-1',
      upstream_host: 'aws-external-anthropic.us-east-1.api.aws',
      allowed_upstream_path: '/v1/messages',
      beta_policy_ref: 'beta-policy:claude-platform-aws-v1-strip',
      request_shape_profile_ref: 'request-shape:claude-platform-aws-v1-strip',
      cache_parity_profile_ref: 'cache-profile:claude-platform-aws-v1-strip',
    })
    const response = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: {
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-account-id': 'account-env-a',
        'x-cc-token-type': 'apikey',
        'x-cc-credential-ref': credentialRef,
        'x-cc-egress-bucket': 'bucket-env-a',
        'x-cc-policy-version': '2.1.179',
        'x-claude-code-session-id': sessionId,
        'x-api-key': 'selected-api-key-fixture',
        ...signedContextHeaders(awsCtx),
      },
      body: body(),
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)

    const missing = { ...awsCtx }
    delete (missing as any).env_residue_profile_ref
    const missingResponse = await httpJson(serverUrl(gateway, '/v1/messages'), {
      headers: {
        'x-cc-gateway-token': 'gateway-token',
        'x-cc-provider': 'anthropic',
        'x-cc-account-id': 'account-env-a',
        'x-cc-token-type': 'apikey',
        'x-cc-credential-ref': credentialRef,
        'x-cc-egress-bucket': 'bucket-env-a',
        'x-cc-policy-version': '2.1.179',
        'x-claude-code-session-id': sessionId,
        'x-api-key': 'selected-api-key-fixture',
        ...signedContextHeaders(missing),
      },
      body: body(),
    })
    assert.equal(missingResponse.status, 403)
    assert.equal(upstream.captured.length, 1)
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})


test('recognized Claude Code date marker variants rewrite to canonical Pacific marker', async () => {
  const variants = [
    "Today's date is 2026-06-29.",
    'Today’s date is 2026-06-29.',
    'Todayʼs date is 2026-06-29.',
    'Todayʹs date is 2026-06-29.',
    "Today's date is 2026/06/29.",
    'Today’s date is 2026/06/29.',
    'Todayʼs date is 2026/06/29.',
    'Todayʹs date is 2026/06/29.',
    "Today's date is 1999-01-02.",
  ]
  for (const marker of variants) {
    await withGateway(async (gateway, upstream) => {
      const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
        headers: headers({ nonce: `rewrite-${Date.now()}-${Math.random()}` }),
        body: body([{ type: 'text', text: marker }]),
      })
      assert.equal(response.status, 200, response.body)
      assert.equal(upstream.captured.length, 1)
      const parsed = JSON.parse(upstream.captured[0].body)
      assert.equal(parsed.system[0].text, canonicalPacificDateMarker())
      assert.doesNotMatch(parsed.system[0].text, /Today’s|\d{4}\/\d{2}\/\d{2}/)
      assertNoLocalResidueInHeadersOrQuery(upstream.captured[0])
    })
  }
})

test('marker absent is allowed and normal system dates are not rewritten', async () => {
  await withGateway(async (gateway, upstream) => {
    const ordinary = 'Release window 2026-06-29 remains a normal instruction.'
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: headers(),
      body: body([{ type: 'text', text: ordinary }]),
    })
    assert.equal(response.status, 200, response.body)
    const parsed = JSON.parse(upstream.captured[0].body)
    assert.equal(parsed.system[0].text, ordinary)
    assert.notEqual(parsed.system[0].text, canonicalPacificDateMarker())
  })
})

test('messages content is not scanned or rewritten for local env residue', async () => {
  await withGateway(async (gateway, upstream) => {
    const requestBody = body([]) as any
    requestBody.messages[0].content[0].text = 'User text mentions ANTHROPIC_BASE_URL and Today’s date is 2026/06/29.'
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: headers(),
      body: requestBody,
    })
    assert.equal(response.status, 200, response.body)
    const parsed = JSON.parse(upstream.captured[0].body)
    assert.equal(parsed.messages[0].content[0].text, requestBody.messages[0].content[0].text)
  })
})

test('metadata env residue fields are sanitized and bucketed without blocking normal requests', async () => {
  await withGateway(async (gateway, upstream) => {
    const requestBody = body([]) as any
    requestBody.metadata.ANTHROPIC_BASE_URL = 'https://deepseek.sankuai.com/v1'
    requestBody.metadata.TZ = 'Asia/Shanghai'
    requestBody.metadata.proxyUrl = 'http://127.0.0.1:9999'
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: headers(),
      body: requestBody,
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
    const parsed = JSON.parse(upstream.captured[0].body)
    const serialized = JSON.stringify(parsed)
    assert.doesNotMatch(serialized, /ANTHROPIC_BASE_URL|deepseek|sankuai|Asia\/Shanghai|proxyUrl/i)
    const userId = JSON.parse(parsed.metadata.user_id)
    assert.equal(userId.session_id, sessionId)
  })
})

test('unrecognized system marker or env literal variants fail closed with env residue verifier code', async () => {
  const badSystems: unknown[] = [
    [{ type: 'text', text: "Today's date is 2026-6-29." }],
    [{ type: 'text', text: "Today's date is 2026-06/29." }],
    [{ type: 'text', text: "Today's date is 2026-06-29. classification=fixture" }],
    [{ type: 'text', text: "Today's date is 2026-06-29. ANTHROPIC_BASE_URL=fixture" }],
    [{ type: 'text', text: "Today's date is 2026-06-29. BASE_URL=fixture" }],
    [{ type: 'text', text: "Instruction prefix. Today's date is 2026-06-29. Continue." }],
    [{ type: 'text', text: "Today's date is 2026-06-29." }, { type: 'text', text: "Today's date is 2026-06-30." }],
  ]
  await withGateway(async (gateway, upstream) => {
    for (const system of badSystems) {
      const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
        headers: headers({ nonce: `bad-system-${Date.now()}-${Math.random()}` }),
        body: body(system),
      })
      assert.equal(response.status, 400, response.body)
      assert.equal(response.headers['x-cc-gateway-error-code'], 'formal_pool_env_residue_verifier_failed')
    }
    assert.equal(upstream.captured.length, 0)
  })
})


test('env residue verifier failure safe summary records stage bucket without raw marker', async () => {
  const captureDir = mkdtempSync(join(tmpdir(), 'cc-gateway-env-residue-capture-'))
  const oldCaptureDir = process.env.CC_GATEWAY_RAW_CAPTURE_DIR
  process.env.CC_GATEWAY_RAW_CAPTURE_DIR = captureDir
  try {
    await withGateway(async (gateway, upstream) => {
      const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
        headers: headers({ nonce: `bad-system-capture-${Date.now()}` }),
        body: body([{ type: 'text', text: "Today's date is 2026-6-29." }]),
      })
      assert.equal(response.status, 400, response.body)
      assert.equal(response.headers['x-cc-gateway-error-code'], 'formal_pool_env_residue_verifier_failed')
      const controlPlane = JSON.parse(readFileSync(join(captureDir, '00_control_plane_error.json'), 'utf-8'))
      assert.equal(controlPlane.env_residue_verifier_stage, 'body_system')
      assert.equal(controlPlane.raw_body_omitted_reason, 'control_plane_error_raw_body_forbidden')
      assert.ok(!JSON.stringify(controlPlane).includes('2026-6-29'))
      assert.equal(upstream.captured.length, 0)
    })
  } finally {
    if (oldCaptureDir === undefined) delete process.env.CC_GATEWAY_RAW_CAPTURE_DIR
    else process.env.CC_GATEWAY_RAW_CAPTURE_DIR = oldCaptureDir
  }
})

test('headers and query env residue control-plane injection fail closed before upstream', async () => {
  await withGateway(async (gateway, upstream) => {
    const cases = [
      { path: '/v1/messages?beta=true&ANTHROPIC_BASE_URL=fixture', headers: headers(), requestBody: body([]) },
      { path: '/v1/messages?beta=true&env_residue_profile_ref=env-residue-profile:client-forged', headers: headers(), requestBody: body([]) },
      { path: '/v1/messages?beta=true&envResidueProfileRef=env-residue-profile:client-forged', headers: headers(), requestBody: body([]) },
      { path: '/v1/messages?beta=true&base-url-residue-profile-ref=base-url-residue-profile:client-forged', headers: headers(), requestBody: body([]) },
      { path: '/v1/messages?beta=true&TZ=Asia%2FShanghai', headers: headers(), requestBody: body([]) },
      { path: '/v1/messages?beta=true&timeZone=Pacific%2FForged', headers: headers(), requestBody: body([]) },
      { path: '/v1/messages?beta=true&timeZone=Asia%2FUrumqi', headers: headers(), requestBody: body([]) },
      { path: '/v1/messages?beta=true&baseUrl=fixture', headers: headers(), requestBody: body([]) },
      { path: '/v1/messages?beta=true&proxyUrl=fixture', headers: headers(), requestBody: body([]) },
      { path: '/v1/messages?beta=true&ANTHROPIC_BASE_URL=https%3A%2F%2Ffixture.example.cn', headers: headers(), requestBody: body([]) },
      { path: '/v1/messages?beta=true&ANTHROPIC_BASE_URL=https%3A%2F%2Fmodel-lab.invalid', headers: headers(), requestBody: body([]) },
      { path: '/v1/messages?beta=true', headers: { ...headers(), 'anthropic-base-url': 'fixture' }, requestBody: body([]) },
      { path: '/v1/messages?beta=true', headers: { ...headers(), 'anthropic-base-url': 'https://fixture.example.cn' }, requestBody: body([]) },
      { path: '/v1/messages?beta=true', headers: { ...headers(), timezone: 'Pacific/Forged' }, requestBody: body([]) },
      { path: '/v1/messages?beta=true', headers: { ...headers(), timezone: 'Asia/Urumqi' }, requestBody: body([]) },
      { path: '/v1/messages?beta=true', headers: { ...headers(), 'base-url': 'fixture' }, requestBody: body([]) },
      { path: '/v1/messages?beta=true', headers: { ...headers(), 'proxy-url': 'fixture' }, requestBody: body([]) },
    ]
    for (const item of cases) {
      const response = await httpJson(serverUrl(gateway, item.path), {
        headers: { ...headers({ nonce: `control-plane-${Date.now()}-${Math.random()}` }), ...item.headers },
        body: item.requestBody,
      })
      assert.equal(response.status, 400, response.body)
      assert.equal(response.headers['x-cc-gateway-error-code'], 'formal_pool_env_residue_verifier_failed')
    }
    assert.equal(upstream.captured.length, 0)
  })
})

test('structural body env residue is sanitized without blocking normal requests', async () => {
  await withGateway(async (gateway, upstream) => {
    const cases = [
      { metadata: { TZ: 'fixture' } },
      { metadata: { TZ: 'Asia/Shanghai' } },
      { metadata: { timeZone: 'Pacific/Forged' } },
      { metadata: { timeZone: 'Asia/Urumqi' } },
      { metadata: { baseUrl: 'fixture' } },
      { metadata: { ANTHROPIC_BASE_URL: 'https://model-lab.invalid' } },
      { metadata: { ANTHROPIC_BASE_URL: 'https://deepseek.sankuai.com/v1' } },
      { metadata: { proxyUrl: 'fixture' } },
      { metadata: { envResidueProfileRef: 'env-residue-profile:client-forged' } },
      { messages: [{ role: 'user', envResidueProfileRef: 'env-residue-profile:client-forged', content: [{ type: 'text', text: 'safe fixture' }] }] },
      { messages: [{ role: 'user', metadata: { proxyUrl: 'fixture' }, content: [{ type: 'text', text: 'safe fixture' }] }] },
      { messages: [{ role: 'user', metadata: { note: 'PROXY_URL=fixture' }, content: [{ type: 'text', text: 'safe fixture' }] }] },
      { messages: [{ role: 'user', metadata: { note: 'BASE_URL=fixture' }, content: [{ type: 'text', text: 'safe fixture' }] }] },
      { system: [{ type: 'text', text: 'safe system fixture', ANTHROPIC_BASE_URL: 'fixture' }] },
      { system: [{ type: 'text', text: 'safe system fixture', envResidueProfileRef: 'env-residue-profile:client-forged' }] },
    ]
    for (const patch of cases) {
      const requestBody = { ...body([]), ...(patch as any) } as any
      if ((patch as any).metadata) requestBody.metadata = { ...(body([]) as any).metadata, ...(patch as any).metadata }
      const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
        headers: headers({ nonce: `structural-clean-${Date.now()}-${Math.random()}` }),
        body: requestBody,
      })
      assert.equal(response.status, 200, response.body)
    }
    assert.equal(upstream.captured.length, cases.length)
    for (const captured of upstream.captured) {
      const serialized = captured.body
      assert.doesNotMatch(serialized, /ANTHROPIC_BASE_URL|envResidueProfileRef|deepseek|sankuai|Asia\/Shanghai|Asia\/Urumqi|Pacific\/Forged|PROXY_URL=fixture|BASE_URL=fixture|proxyUrl|baseUrl/i)
    }
  })
})

test('actual tool and MCP outbound-control residue still fails closed before upstream', async () => {
  await withGateway(async (gateway, upstream) => {
    const cases = [
      { path: '/v1/messages?beta=true', headers: headers(), requestBody: { ...body([]), tools: [{ name: 'Fixture', metadata: { baseUrlResidueProfileRef: 'base-url-residue-profile:client-forged' } }] } },
      { path: '/v1/messages?beta=true', headers: headers(), requestBody: { ...body([]), tools: [{ name: 'Fixture', input_schema: { type: 'object', properties: { value: { type: 'string', HTTP_PROXY: 'fixture' } } } }] } },
      { path: '/v1/messages?beta=true', headers: headers(), requestBody: { ...body([]), mcp_servers: [{ name: 'bad', url: 'https://example.com', env: { ANTHROPIC_BASE_URL: 'fixture' } }] } },
      { path: '/v1/messages?beta=true', headers: headers(), requestBody: { ...body([]), mcp_servers: [{ name: 'bad', url: 'https://example.com', authorization: 'Bearer fixture' }] } },
    ]
    for (const item of cases) {
      const response = await httpJson(serverUrl(gateway, item.path), {
        headers: { ...headers({ nonce: `outbound-control-${Date.now()}-${Math.random()}` }), ...item.headers },
        body: item.requestBody,
      })
      assert.ok([400, 403].includes(response.status), response.body)
      assert.ok([
        'formal_pool_env_residue_verifier_failed',
        'formal_pool_mcp_connector_disabled',
      ].includes(String(response.headers['x-cc-gateway-error-code'])))
    }
    assert.equal(upstream.captured.length, 0)
  })
})

test('retry path reruns env residue verifier before each upstream attempt', async () => {
  await withGateway(async (gateway, upstream) => {
    const first = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: headers({ nonce: `retry-ok-${Date.now()}` }),
      body: body([{ type: 'text', text: "Today's date is 2026/06/29." }]),
    })
    assert.equal(first.status, 200, first.body)
    const retry = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: { ...headers({ nonce: `retry-bad-${Date.now()}` }), 'x-cc-retry-attempt': '1', 'x-cc-retry-final-output-reentered': 'true' },
      body: body([{ type: 'text', text: "Today's date is 2026-6-29." }]),
    })
    assert.equal(retry.status, 400, retry.body)
    assert.equal(retry.headers['x-cc-gateway-error-code'], 'formal_pool_env_residue_verifier_failed')
    assert.equal(upstream.captured.length, 1)
  })
})


test('tool JSON schema property names that resemble env keys are treated as schema, not env residue control-plane', async () => {
  await withGateway(async (gateway, upstream) => {
    const requestBody = body([]) as any
    requestBody.tools = [
      {
        name: 'fixture_tool',
        description: 'safe fixture tool',
        input_schema: {
          type: 'object',
          properties: {
            timezone: { type: 'string', description: 'safe user timezone option' },
            baseUrl: { type: 'string', description: 'safe application setting name' },
          },
        },
      },
    ]
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: headers({ nonce: `tool-schema-env-key-${Date.now()}` }),
      body: requestBody,
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
  })
})

await finish()
