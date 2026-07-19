import { strict as assert } from 'assert'
import { createHmac } from 'crypto'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createInertDirectRequestHarness, startProxy } from '../src/proxy.js'
import { getSharedPoolMaxBodyBytes } from '../src/policy.js'
import { evaluateCanaryCostEnvelope } from '../src/canary-cost-gate.js'
import { baseConfig, close, finish, httpJson, serverUrl, startFakeConnectProxy, startFakeUpstream, test, waitForListening } from './helpers.js'

console.log('\ntests/canary-cost-envelope.test.ts')

const attestationSecret = 'canary-attestation-test-secret'
const internalControlToken = 'canary-internal-control-material-test'
const sessionId = '123e4567-e89b-42d3-a456-426614174777'

const headers = {
  'x-cc-gateway-token': 'gateway-token',
  'x-cc-provider': 'anthropic',
  'x-cc-account-id': 'account-a',
  'x-cc-token-type': 'oauth',
  authorization: 'Bearer synthetic-token',
  'x-cc-credential-ref': 'opaque:credential-ref:v1:canary-cred',
  'x-cc-egress-bucket': 'bucket-a',
  'x-cc-policy-version': '2.1.146',
  'x-claude-code-session-id': sessionId,
}


function canonicalFormalPoolContext(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = value[key]
    return acc
  }, {} as Record<string, unknown>))
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

function signedHeaders(base: Record<string, string> = headers, contextOverrides: Record<string, unknown> = {}) {
  const context = {
    method: 'POST',
    route_class: 'messages',
    path: '/v1/messages',
    account_id: base['x-cc-account-id'],
    token_type: base['x-cc-token-type'],
    credential_ref: base['x-cc-credential-ref'],
    credential_source: 'server_account_credentials',
    egress_bucket: base['x-cc-egress-bucket'],
    proxy_identity_ref: 'opaque:proxy-ref:v1:bucket-a',
    policy_version: base['x-cc-policy-version'],
    persona_profile: 'claude_code_2_1_146',
    session_id: base['x-claude-code-session-id'],
    timestamp_ms: Date.now(),
    nonce: `canary-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    trusted_egress_profile_ref: 'strip_attribution',
    env_residue_profile_ref: 'env-residue-profile:claude-code-2.1.179-us-pacific-official-anthropic-v1',
    locale_profile_ref: 'locale-profile:us-pacific-v1',
    base_url_residue_profile_ref: 'base-url-residue-profile:official-anthropic-v1',
    profile_policy_version: 'claude_code_2_1_179_cp1_degraded_v1',
    billing_shape_policy: 'strip',
    request_shape_profile_ref: 'claude_code_2_1_179_messages_streaming_tooldefs_degraded_v1',
    cache_parity_profile_ref: 'claude_code_2_1_179_cache_parity_degraded_v1',
    observed_client_profile: {
      schema_version: 'observed_client_profile.v1',
      cli_version_bucket: '2.1.179',
      route_class: 'messages',
      billing_shape: 'absent',
      billing_block_count: 0,
      cc_entrypoint_bucket: 'absent',
      stream: true,
    },
    ...contextOverrides,
  }
  const canonical = canonicalFormalPoolContext(context)
  return {
    ...base,
    'x-cc-formal-pool-context': Buffer.from(canonical, 'utf-8').toString('base64url'),
    'x-cc-formal-pool-signature': `hmac-sha256:${createHmac('sha256', attestationSecret).update(canonical).digest('hex')}`,
  }
}

function trustedSignedHeaders() {
  return signedHeaders({
    ...headers,
    'x-sub2api-persona-trusted': '1',
    'x-cc-internal-control-token': internalControlToken,
  })
}

function config(upstreamUrl: string, proxyUrl: string, envelope = {}) {
  return baseConfig({
    mode: 'sub2api',
    upstream: { url: upstreamUrl },
    auth: { gateway_token: 'gateway-token', internal_control_token: internalControlToken, tokens: [] },
    oauth: undefined,
    env: { ...baseConfig().env, version: '2.1.146', version_base: '2.1.146' },
    shared_pool: {
      upstream_mode: 'preflight',
      billing_cch_mode: 'sign',
      signing_enabled: true,
      signing_evidence_gates_approved: true,
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:canary',
      context_attestation_secret: attestationSecret,
      canary_cost_envelope: {
        enabled: true,
        max_tokens: 2048,
        max_body_bytes: 32 * 1024,
        max_tools_count: 3,
        allow_thinking: false,
        allow_output_config: true,
        allow_context_management: true,
        allowed_models: ['claude-sonnet-4-6'],
        ...envelope,
      },
    },
    account_identities: {
      'account-a': {
        device_id: 'b'.repeat(64),
        account_uuid_hash: 'hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        email_hash: 'hmac-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        account_hash: 'hmac-sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        credential_ref: 'opaque:credential-ref:v1:canary-cred',
        credential_binding_hmac: credentialBindingHmac('Bearer synthetic-token'),
        persona_variant: 'claude-code-2.1.146-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.146',
      },
    },
    egress_buckets: {
      'bucket-a': {
        enabled: true,
        proxy_url: proxyUrl,
        proxy_identity_ref: 'opaque:proxy-ref:v1:bucket-a',
        allowed_account_ids: ['account-a'],
      },
    },
  } as any)
}

function liteBody(overrides: Record<string, unknown> = {}) {
  return {
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    metadata: { user_id: JSON.stringify({ session_id: sessionId }) },
    stream: true,
    system: [],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'local lite canary fixture' }] }],
    tools: [],
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    context_management: { edits: [] },
    ...overrides,
  }
}

function realModeConfig(
  mode: 'real-canary' | 'production',
  sharedPoolOverrides: Record<string, unknown> = {},
) {
  const base = config('https://api.anthropic.com', 'http://127.0.0.1:9')
  base.upstream = {
    url: 'https://api.anthropic.com',
    tls: { verification: 'required', trust_store: 'system' },
  }
  base.shared_pool = {
    upstream_mode: mode,
    real_canary_user_approved: mode === 'real-canary',
    production_upstream_enabled: mode === 'production',
    billing_cch_mode: 'sign',
    context_attestation_secret_ref: 'opaque:attestation-ref:v1:canary',
    context_attestation_secret: attestationSecret,
    signing_enabled: true,
    signing_evidence_gates_approved: true,
    ...(mode === 'production'
      ? { production_budget: { mode: 'observe_only', enforcement_enabled: false, p0_hard_block_only: true } }
      : {}),
    ...sharedPoolOverrides,
  } as any
  return base
}

async function withRealModeRequest(input: {
  mode: 'real-canary' | 'production'
  body: unknown
  requestHeaders?: Record<string, string>
  sharedPoolOverrides?: Record<string, unknown>
}) {
  const previousCanary = process.env.ALLOW_REAL_ANTHROPIC_CANARY
  const previousProduction = process.env.ALLOW_REAL_ANTHROPIC_PRODUCTION
  const previousLedgerFile = process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE
  const harness = createInertDirectRequestHarness()
  let gateway: ReturnType<typeof startProxy> | undefined
  try {
    if (input.mode === 'real-canary') process.env.ALLOW_REAL_ANTHROPIC_CANARY = '1'
    if (input.mode === 'production') {
      process.env.ALLOW_REAL_ANTHROPIC_PRODUCTION = '1'
      process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE = join(
        mkdtempSync(join(tmpdir(), 'cc-gateway-real-mode-ledger-')),
        'formal-pool-session-ledger.json',
      )
    }
    gateway = startProxy(
      realModeConfig(input.mode, input.sharedPoolOverrides),
      undefined,
      harness,
    )
    await waitForListening(gateway)
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: input.requestHeaders ?? signedHeaders(),
      body: input.body,
    })
    return { response, attempts: harness.observations() }
  } finally {
    if (gateway) await close(gateway)
    if (previousCanary === undefined) delete process.env.ALLOW_REAL_ANTHROPIC_CANARY
    else process.env.ALLOW_REAL_ANTHROPIC_CANARY = previousCanary
    if (previousProduction === undefined) delete process.env.ALLOW_REAL_ANTHROPIC_PRODUCTION
    else process.env.ALLOW_REAL_ANTHROPIC_PRODUCTION = previousProduction
    if (previousLedgerFile === undefined) delete process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE
    else process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE = previousLedgerFile
  }
}

async function withGateway(envelope: Record<string, unknown>, body: unknown) {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(config(upstream.url, proxy.url, envelope))
  try {
    await waitForListening(gateway)
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), { headers: signedHeaders(), body })
    return { response, upstreamCount: upstream.captured.length }
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
}

test('canary cost envelope fails closed when max_tokens exceeds canary limit', async () => {
  const { response, upstreamCount } = await withGateway({}, liteBody({ max_tokens: 32000 }))
  assert.equal(response.status, 403)
  assert.equal(response.headers['x-cc-gateway-error-code'], 'canary_cost_envelope_max_tokens_exceeded')
  assert.equal(upstreamCount, 0)
})

test('canary cost envelope fails closed when body size exceeds canary limit', async () => {
  const { response, upstreamCount } = await withGateway({ max_body_bytes: 512 }, liteBody({ system: [{ type: 'text', text: 'x'.repeat(2048) }] }))
  assert.equal(response.status, 413)
  assert.equal(response.headers['x-cc-gateway-error-code'], 'canary_cost_envelope_body_too_large')
  assert.equal(upstreamCount, 0)
})

test('canary cost envelope fails closed when tools count exceeds canary limit', async () => {
  const tools = Array.from({ length: 4 }, (_, i) => ({ name: `tool_${i}`, description: 'local', input_schema: { type: 'object' } }))
  const { response, upstreamCount } = await withGateway({}, liteBody({ tools }))
  assert.equal(response.status, 403)
  assert.equal(response.headers['x-cc-gateway-error-code'], 'canary_cost_envelope_tools_exceeded')
  assert.equal(upstreamCount, 0)
})

test('canary cost envelope fails closed before upstream when output_config.type is present', async () => {
  const { response, upstreamCount } = await withGateway({}, liteBody({ output_config: { type: 'json' } }))
  assert.equal(response.status, 403)
  assert.equal(response.headers['x-cc-gateway-error-code'], 'canary_cost_envelope_output_config_shape_blocked')
  assert.equal(upstreamCount, 0)
})

test('canary cost envelope fails closed before upstream for unknown output_config shape', async () => {
  const { response, upstreamCount } = await withGateway({}, liteBody({ output_config: { mode: 'compact' } }))
  assert.equal(response.status, 403)
  assert.equal(response.headers['x-cc-gateway-error-code'], 'canary_cost_envelope_output_config_shape_blocked')
  assert.equal(upstreamCount, 0)
})

test('canary cost envelope allows body with output_config removed', async () => {
  const body = liteBody()
  delete (body as any).output_config
  const { response, upstreamCount } = await withGateway({}, body)
  assert.equal(response.status, 200, response.body)
  assert.equal(upstreamCount, 1)
})

test('canary cost envelope allows qualified Claude-Code-shaped-lite body to localhost mock', async () => {
  const { response, upstreamCount } = await withGateway({}, liteBody())
  assert.equal(response.status, 200, response.body)
  assert.equal(upstreamCount, 1)
})

test('canary cost envelope allows captured Claude Code output_config effort plus format shape', async () => {
  const body = liteBody({
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          additionalProperties: true,
        },
      },
    },
  })
  const { response, upstreamCount } = await withGateway({}, body)
  assert.equal(response.status, 200, response.body)
  assert.equal(upstreamCount, 1)
})

test('canary cost envelope does not affect non-canary path when disabled', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(config(upstream.url, proxy.url, { enabled: false, max_tokens: 1 }))
  try {
    await waitForListening(gateway)
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: signedHeaders(),
      body: liteBody({ max_tokens: 1024 }),
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})


test('canary cost envelope stays disabled for non-canary routing when no envelope is configured', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const base = config(upstream.url, proxy.url)
  base.shared_pool = {
    upstream_mode: 'preflight',
    billing_cch_mode: 'sign',
    context_attestation_secret_ref: 'opaque:attestation-ref:v1:canary',
      context_attestation_secret: attestationSecret,
    signing_enabled: true,
    signing_evidence_gates_approved: true,
  } as any
  const gateway = startProxy(base)
  try {
    await waitForListening(gateway)
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: signedHeaders(),
      body: liteBody({ max_tokens: 32000, tools: Array.from({ length: 10 }, (_, i) => ({ name: `tool_${i}`, description: 'local', input_schema: { type: 'object' } })) }),
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})



test('production observe-only budget does not inherit canary cost envelope defaults', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const base = config(upstream.url, proxy.url)
  base.shared_pool = {
    upstream_mode: 'preflight',
    billing_cch_mode: 'sign',
    context_attestation_secret_ref: 'opaque:attestation-ref:v1:canary',
      context_attestation_secret: attestationSecret,
    signing_enabled: true,
    signing_evidence_gates_approved: true,
    production_budget: { mode: 'observe_only', enforcement_enabled: false },
  } as any
  const richTools = Array.from({ length: 30 }, (_, i) => ({ name: `tool_${i}`, description: 'local', input_schema: { type: 'object' } }))
  const gateway = startProxy(base)
  try {
    await waitForListening(gateway)
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: signedHeaders(),
      body: liteBody({
        max_tokens: 32000,
        tools: richTools,
        thinking: { type: 'adaptive' },
        context_management: { edits: [{ type: 'clear_thinking_20251015', keep: 'all' }] },
        stream: true,
      }),
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})

test('production observe-only budget does not inherit shared-pool default body cap', () => {
  const base = config('https://api.anthropic.com', 'http://127.0.0.1:65535')
  base.shared_pool = {
    upstream_mode: 'production',
    billing_cch_mode: 'sign',
    context_attestation_secret_ref: 'opaque:attestation-ref:v1:canary',
      context_attestation_secret: attestationSecret,
    signing_enabled: true,
    signing_evidence_gates_approved: true,
    production_upstream_enabled: true,
    production_budget: { mode: 'observe_only', enforcement_enabled: false, p0_hard_block_only: true },
  } as any
  assert.equal(getSharedPoolMaxBodyBytes(base), Number.MAX_SAFE_INTEGER)
})

test('local-capture mode forwards rich local-mock body without canary envelope or default body cap', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const base = config(upstream.url, proxy.url)
  base.shared_pool = {
    upstream_mode: 'local-capture',
    billing_cch_mode: 'sign',
    context_attestation_secret_ref: 'opaque:attestation-ref:v1:canary',
      context_attestation_secret: attestationSecret,
    signing_enabled: true,
    signing_evidence_gates_approved: true,
    production_budget: { mode: 'observe_only', enforcement_enabled: false, p0_hard_block_only: true },
  } as any
  const previousLedgerFile = process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE
  process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE = join(mkdtempSync(join(tmpdir(), 'cc-gateway-canary-ledger-')), 'formal-pool-session-ledger.json')
  const gateway = startProxy(base)
  try {
    await waitForListening(gateway)
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: signedHeaders(),
      body: liteBody({
        max_tokens: 32000,
        tools: Array.from({ length: 30 }, (_, i) => ({ name: `tool_${i}`, description: 'local', input_schema: { type: 'object' } })),
        thinking: { type: 'adaptive' },
        context_management: { edits: [{ type: 'clear_thinking_20251015', keep: 'all' }] },
        system: [{ type: 'text', text: 'x'.repeat(2 * 1024 * 1024 + 1024) }],
        stream: true,
      }),
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
  } finally {
    if (previousLedgerFile === undefined) delete process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE
    else process.env.CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE = previousLedgerFile
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})

test('real-canary default envelope allows Opus 4.7 model family without opening transport', () => {
  const base = config('https://api.anthropic.com', 'http://127.0.0.1:9')
  base.shared_pool = {
    upstream_mode: 'real-canary',
    real_canary_user_approved: true,
    billing_cch_mode: 'sign',
    context_attestation_secret_ref: 'opaque:attestation-ref:v1:canary',
      context_attestation_secret: attestationSecret,
    signing_enabled: true,
    signing_evidence_gates_approved: true,
  } as any
  const result = evaluateCanaryCostEnvelope(base, Buffer.from(JSON.stringify(liteBody({ model: 'claude-opus-4-7', max_tokens: 1024 }))))
  assert.equal(result.ok, true)
})

test('real-canary mode applies default canary cost envelope without opening transport', () => {
  const base = config('https://api.anthropic.com', 'http://127.0.0.1:9')
  base.shared_pool = {
    upstream_mode: 'real-canary',
    real_canary_user_approved: true,
    billing_cch_mode: 'sign',
    context_attestation_secret_ref: 'opaque:attestation-ref:v1:canary',
      context_attestation_secret: attestationSecret,
    signing_enabled: true,
    signing_evidence_gates_approved: true,
  } as any
  const result = evaluateCanaryCostEnvelope(base, Buffer.from(JSON.stringify(liteBody({ max_tokens: 32000 }))))
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, 'canary_cost_envelope_max_tokens_exceeded')
})

test('real-canary candidate model envelope allows Opus 4.8 only with rollout controls without opening transport', () => {
  const base = config('https://api.anthropic.com', 'http://127.0.0.1:9')
  base.shared_pool = {
    upstream_mode: 'real-canary',
    real_canary_user_approved: true,
    billing_cch_mode: 'sign',
    context_attestation_secret_ref: 'opaque:attestation-ref:v1:canary',
      context_attestation_secret: attestationSecret,
    signing_enabled: true,
    signing_evidence_gates_approved: true,
    candidate_model_allowlist: ['claude-opus-4-8'],
    candidate_model_replay_proofs: { 'claude-opus-4-8': 'fixture-opus-48' },
    candidate_model_kill_switches: { 'claude-opus-4-8': false },
    candidate_model_audit_budgets: { 'claude-opus-4-8': 1 },
  } as any
  const result = evaluateCanaryCostEnvelope(base, Buffer.from(JSON.stringify(liteBody({ model: 'claude-opus-4-8', max_tokens: 1024 }))))
  assert.equal(result.ok, true)
})

test('real-canary candidate model envelope rejects Opus 4.8 without rollout controls without opening transport', () => {
  const base = config('https://api.anthropic.com', 'http://127.0.0.1:9')
  base.shared_pool = {
    upstream_mode: 'real-canary',
    real_canary_user_approved: true,
    billing_cch_mode: 'sign',
    context_attestation_secret_ref: 'opaque:attestation-ref:v1:canary',
      context_attestation_secret: attestationSecret,
    signing_enabled: true,
    signing_evidence_gates_approved: true,
    candidate_model_allowlist: ['claude-opus-4-8'],
    candidate_model_kill_switches: { 'claude-opus-4-8': false },
    candidate_model_audit_budgets: { 'claude-opus-4-8': 1 },
  } as any
  const result = evaluateCanaryCostEnvelope(base, Buffer.from(JSON.stringify(liteBody({ model: 'claude-opus-4-8', max_tokens: 1024 }))))
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, 'canary_cost_envelope_model_blocked')
})

test('trusted routing does not relax real-canary candidate model rollout controls', () => {
  const base = config('https://api.anthropic.com', 'http://127.0.0.1:9')
  base.shared_pool = {
    upstream_mode: 'real-canary',
    real_canary_user_approved: true,
    billing_cch_mode: 'sign',
    context_attestation_secret_ref: 'opaque:attestation-ref:v1:canary',
      context_attestation_secret: attestationSecret,
    signing_enabled: true,
    signing_evidence_gates_approved: true,
    candidate_model_allowlist: ['claude-opus-4-8'],
    candidate_model_kill_switches: { 'claude-opus-4-8': false },
    candidate_model_audit_budgets: { 'claude-opus-4-8': 1 },
  } as any
  assert.equal(trustedSignedHeaders()['x-sub2api-persona-trusted'], '1')
  const result = evaluateCanaryCostEnvelope(base, Buffer.from(JSON.stringify(liteBody({ model: 'claude-opus-4-8', max_tokens: 1024 }))))
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, 'canary_cost_envelope_model_blocked')
})

test('production request path forwards rich body once with verified direct TLS options', async () => {
  const { response, attempts } = await withRealModeRequest({
    mode: 'production',
    body: liteBody({
      max_tokens: 32000,
      tools: Array.from({ length: 30 }, (_, index) => ({ name: `tool_${index}`, description: 'local', input_schema: { type: 'object' } })),
      thinking: { type: 'adaptive' },
      context_management: { edits: [{ type: 'clear_thinking_20251015', keep: 'all' }] },
      system: [{ type: 'text', text: 'x'.repeat(2 * 1024 * 1024 + 1024) }],
      stream: true,
    }),
  })
  assert.equal(response.status, 200, response.body)
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0].protocol, 'https:')
  assert.equal(attempts[0].hostname, 'api.anthropic.com')
  assert.equal(attempts[0].rejectUnauthorized, true)
})

test('real-canary request path allows Opus 4.7 and observes one verified TLS attempt', async () => {
  const { response, attempts } = await withRealModeRequest({
    mode: 'real-canary',
    body: liteBody({ model: 'claude-opus-4-7', max_tokens: 1024 }),
  })
  assert.equal(response.status, 200, response.body)
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0].rejectUnauthorized, true)
})

test('real-canary request path rejects default max-token overflow before transport', async () => {
  const { response, attempts } = await withRealModeRequest({
    mode: 'real-canary',
    body: liteBody({ max_tokens: 32000 }),
  })
  assert.equal(response.status, 403, response.body)
  assert.equal(response.headers['x-cc-gateway-error-code'], 'canary_cost_envelope_max_tokens_exceeded')
  assert.equal(attempts.length, 0)
})

test('real-canary request path rejects invalid gateway authentication before transport', async () => {
  const { response, attempts } = await withRealModeRequest({
    mode: 'real-canary',
    requestHeaders: signedHeaders({ ...headers, 'x-cc-gateway-token': 'wrong-gateway-token' }),
    body: liteBody(),
  })
  assert.equal(response.status, 401, response.body)
  assert.equal(response.headers['x-cc-gateway-error-code'], 'missing_gateway_token')
  assert.equal(attempts.length, 0)
})

test('real-canary request path rejects missing scheduler attestation before transport', async () => {
  const { response, attempts } = await withRealModeRequest({
    mode: 'real-canary',
    requestHeaders: { ...headers },
    body: liteBody(),
  })
  assert.equal(response.status, 403, response.body)
  assert.equal(response.headers['x-cc-gateway-error-code'], 'missing_formal_pool_context_attestation')
  assert.equal(attempts.length, 0)
})

test('real-canary trusted routing controls candidate model transport eligibility', async () => {
  const candidateModel = 'claude-opus-9-9'
  const controls = {
    candidate_model_allowlist: [candidateModel],
    candidate_model_replay_proofs: { [candidateModel]: 'fixture-opus-99' },
    candidate_model_kill_switches: { [candidateModel]: false },
    candidate_model_audit_budgets: { [candidateModel]: 1 },
  }
  const untrusted = await withRealModeRequest({
    mode: 'real-canary',
    body: liteBody({ model: candidateModel, max_tokens: 1024 }),
    sharedPoolOverrides: controls,
  })
  assert.equal(untrusted.response.status, 403, untrusted.response.body)
  assert.equal(untrusted.response.headers['x-cc-gateway-error-code'], 'persona_reject_untrusted_model')
  assert.equal(untrusted.attempts.length, 0)

  const trusted = await withRealModeRequest({
    mode: 'real-canary',
    requestHeaders: trustedSignedHeaders(),
    body: liteBody({ model: candidateModel, max_tokens: 1024 }),
    sharedPoolOverrides: controls,
  })
  assert.equal(trusted.response.status, 200, trusted.response.body)
  assert.equal(trusted.attempts.length, 1)
  assert.equal(trusted.attempts[0].rejectUnauthorized, true)
})

test('real-canary trusted request still rejects missing rollout proof before transport', async () => {
  const { response, attempts } = await withRealModeRequest({
    mode: 'real-canary',
    requestHeaders: trustedSignedHeaders(),
    body: liteBody({ model: 'claude-opus-4-8', max_tokens: 1024 }),
    sharedPoolOverrides: {
      candidate_model_allowlist: ['claude-opus-4-8'],
      candidate_model_kill_switches: { 'claude-opus-4-8': false },
      candidate_model_audit_budgets: { 'claude-opus-4-8': 1 },
    },
  })
  assert.equal(response.status, 403, response.body)
  assert.equal(response.headers['x-cc-gateway-error-code'], 'canary_cost_envelope_model_blocked')
  assert.equal(attempts.length, 0)
})

await finish()
