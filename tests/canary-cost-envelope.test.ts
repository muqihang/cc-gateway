import { strict as assert } from 'assert'
import { startProxy } from '../src/proxy.js'
import { getSharedPoolMaxBodyBytes } from '../src/policy.js'
import { baseConfig, close, finish, httpJson, serverUrl, startFakeConnectProxy, startFakeUpstream, test } from './helpers.js'

console.log('\ntests/canary-cost-envelope.test.ts')

const headers = {
  'x-cc-gateway-token': 'gateway-token',
  'x-cc-provider': 'anthropic',
  'x-cc-account-id': 'account-a',
  'x-cc-token-type': 'oauth',
  authorization: 'Bearer synthetic-token',
  'x-cc-egress-bucket': 'bucket-a',
  'x-cc-policy-version': '2.1.146',
  'x-claude-code-session-id': 'session-lite',
}

const trustedHeaders = {
  ...headers,
  'x-sub2api-persona-trusted': '1',
}

function config(upstreamUrl: string, proxyUrl: string, envelope = {}) {
  return baseConfig({
    mode: 'sub2api',
    upstream: { url: upstreamUrl },
    auth: { gateway_token: 'gateway-token', tokens: [] },
    oauth: undefined,
    env: { ...baseConfig().env, version: '2.1.146', version_base: '2.1.146' },
    shared_pool: {
      upstream_mode: 'preflight',
      billing_cch_mode: 'sign',
      signing_enabled: true,
      signing_evidence_gates_approved: true,
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
        persona_variant: 'claude-code-2.1.146-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.146',
      },
    },
    egress_buckets: {
      'bucket-a': {
        enabled: true,
        proxy_url: proxyUrl,
        proxy_identity_hash: 'opaque:proxy-ref:v1:bucket-a',
        allowed_account_ids: ['account-a'],
      },
    },
  } as any)
}

function liteBody(overrides: Record<string, unknown> = {}) {
  return {
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    metadata: { user_id: JSON.stringify({ session_id: 'session-lite' }) },
    stream: false,
    system: [],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'local lite canary fixture' }] }],
    tools: [],
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    context_management: { edits: [] },
    ...overrides,
  }
}

async function withGateway(envelope: Record<string, unknown>, body: unknown) {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const gateway = startProxy(config(upstream.url, proxy.url, envelope))
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), { headers, body })
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
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers,
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
    signing_enabled: true,
    signing_evidence_gates_approved: true,
  } as any
  const gateway = startProxy(base)
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers,
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
    signing_enabled: true,
    signing_evidence_gates_approved: true,
    production_budget: { mode: 'observe_only', enforcement_enabled: false },
  } as any
  const richTools = Array.from({ length: 30 }, (_, i) => ({ name: `tool_${i}`, description: 'local', input_schema: { type: 'object' } }))
  const gateway = startProxy(base)
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers,
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
    signing_enabled: true,
    signing_evidence_gates_approved: true,
    production_upstream_enabled: true,
    production_budget: { mode: 'observe_only', enforcement_enabled: false, p0_hard_block_only: true },
  } as any
  assert.equal(getSharedPoolMaxBodyBytes(base), Number.MAX_SAFE_INTEGER)
})

test('production upstream mode forwards rich local-mock body without canary envelope or default body cap', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const base = config(upstream.url, proxy.url)
  base.shared_pool = {
    upstream_mode: 'production',
    billing_cch_mode: 'sign',
    signing_enabled: true,
    signing_evidence_gates_approved: true,
    production_upstream_enabled: true,
    production_budget: { mode: 'observe_only', enforcement_enabled: false, p0_hard_block_only: true },
  } as any
  const gateway = startProxy(base)
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers,
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
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})

test('real-canary default envelope allows Opus 4.7 model family', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const base = config(upstream.url, proxy.url)
  base.shared_pool = {
    upstream_mode: 'real-canary',
    real_canary_user_approved: true,
    billing_cch_mode: 'sign',
    signing_enabled: true,
    signing_evidence_gates_approved: true,
  } as any
  const gateway = startProxy(base)
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers,
      body: liteBody({ model: 'claude-opus-4-7', max_tokens: 1024 }),
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})

test('real-canary mode applies default canary cost envelope even without explicit envelope config', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const base = config(upstream.url, proxy.url)
  base.shared_pool = {
    upstream_mode: 'real-canary',
    real_canary_user_approved: true,
    billing_cch_mode: 'sign',
    signing_enabled: true,
    signing_evidence_gates_approved: true,
  } as any
  const gateway = startProxy(base)
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers,
      body: liteBody({ max_tokens: 32000 }),
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'canary_cost_envelope_max_tokens_exceeded')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})

test('real-canary candidate model envelope allows trusted Opus 4.8 only with rollout controls', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const base = config(upstream.url, proxy.url)
  base.shared_pool = {
    upstream_mode: 'real-canary',
    real_canary_user_approved: true,
    billing_cch_mode: 'sign',
    signing_enabled: true,
    signing_evidence_gates_approved: true,
    candidate_model_allowlist: ['claude-opus-4-8'],
    candidate_model_replay_proofs: { 'claude-opus-4-8': 'fixture-opus-48' },
    candidate_model_kill_switches: { 'claude-opus-4-8': false },
    candidate_model_audit_budgets: { 'claude-opus-4-8': 1 },
  } as any
  const gateway = startProxy(base)
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: trustedHeaders,
      body: liteBody({ model: 'claude-opus-4-8', max_tokens: 1024 }),
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1)
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})

test('real-canary candidate model envelope rejects Opus 4.8 without rollout controls', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const base = config(upstream.url, proxy.url)
  base.shared_pool = {
    upstream_mode: 'real-canary',
    real_canary_user_approved: true,
    billing_cch_mode: 'sign',
    signing_enabled: true,
    signing_evidence_gates_approved: true,
    candidate_model_allowlist: ['claude-opus-4-8'],
    candidate_model_kill_switches: { 'claude-opus-4-8': false },
    candidate_model_audit_budgets: { 'claude-opus-4-8': 1 },
  } as any
  const gateway = startProxy(base)
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers,
      body: liteBody({ model: 'claude-opus-4-8', max_tokens: 1024 }),
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'canary_cost_envelope_model_blocked')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})

test('trusted real-canary candidate model envelope rejects Opus 4.8 without rollout controls', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  const base = config(upstream.url, proxy.url)
  base.shared_pool = {
    upstream_mode: 'real-canary',
    real_canary_user_approved: true,
    billing_cch_mode: 'sign',
    signing_enabled: true,
    signing_evidence_gates_approved: true,
    candidate_model_allowlist: ['claude-opus-4-8'],
    candidate_model_kill_switches: { 'claude-opus-4-8': false },
    candidate_model_audit_budgets: { 'claude-opus-4-8': 1 },
  } as any
  const gateway = startProxy(base)
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: trustedHeaders,
      body: liteBody({ model: 'claude-opus-4-8', max_tokens: 1024 }),
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'canary_cost_envelope_model_blocked')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(proxy.server)
    await close(upstream.server)
  }
})

await finish()
