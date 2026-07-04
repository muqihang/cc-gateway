import { strict as assert } from 'assert'
import { createHmac } from 'crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { startProxy } from '../src/proxy.js'
import { baseConfig, close, finish, httpJson, listen, serverUrl, test } from './helpers.js'

console.log('\ntests/formal-pool-mcp-connector-compat.test.ts')

const attestationSecret = 'scheduler-hmac-material-v1-plan86-safe-fixture-abcdef'
const internalControlToken = 'internal-control-plan86-safe-fixture-abcdef'
const sidecarControlToken = 'sidecar-control-plan86-safe-fixture-abcdef'
const sessionId = '123e4567-e89b-42d3-a456-426614174086'
const selectedCredential = 'Bearer selected-token-plan86'
const credentialRef = 'opaque:credential-ref:v1:plan86-cred-a'
const proxyRef = 'opaque:proxy-ref:v1:plan86-bucket-a'
const tls2197 = 'tls-profile:claude-code-2.1.197-real-oracle-tcp-v1'
const tlsBucket2197 = 'tls-bucket:claude-code-real-oracle-2197'
const requestShape2197 = 'claude_code_2_1_197_messages_streaming_tooldefs_sonnet5_v1'
const cache2197 = 'claude_code_2_1_197_cache_parity_sonnet5_v1'
const profilePolicy2197 = 'claude_code_2_1_197_plan76_sonnet5_policy_v1'
const envResidueProfileRef = 'env-residue-profile:claude-code-2.1.179-us-pacific-official-anthropic-v1'
const localeProfileRef = 'locale-profile:us-pacific-v1'
const baseUrlResidueProfileRef = 'base-url-residue-profile:official-anthropic-v1'
const mcpPolicyRef = 'mcp-connector-policy:official-remote-https-v1'
const mcpBeta = 'mcp-client-2025-11-20'
const mcpHost = ['docs', 'example', 'com'].join('.')
const mcpServerName = 'srv_1'

type SidecarCapture = {
  control: Record<string, unknown>
  headers: IncomingMessage['headers']
  bodyText: string
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

function canonical(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = value[key]
    return acc
  }, {} as Record<string, unknown>))
}

function signedHeaders(context: Record<string, unknown>, headerOverrides: Record<string, string> = {}) {
  const raw = canonical(context)
  return {
    'x-cc-gateway-token': 'gateway-token',
    'x-cc-provider': 'anthropic',
    'x-cc-account-id': String(context.account_id),
    'x-cc-token-type': String(context.token_type),
    'x-cc-credential-ref': String(context.credential_ref),
    'x-cc-egress-bucket': String(context.egress_bucket),
    'x-cc-policy-version': String(context.policy_version),
    'x-claude-code-session-id': String(context.session_id),
    authorization: selectedCredential,
    'anthropic-beta': 'client-supplied-beta-must-not-be-trusted',
    'x-cc-formal-pool-context': Buffer.from(raw, 'utf-8').toString('base64url'),
    'x-cc-formal-pool-signature': `hmac-sha256:${createHmac('sha256', attestationSecret).update(raw).digest('hex')}`,
    ...headerOverrides,
  }
}

function observedProfile(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 'observed_client_profile.v1',
    cli_version_bucket: '2.1.195',
    client_family_bucket: 'cli',
    route_class: 'messages',
    billing_shape: 'absent',
    billing_block_count: 0,
    cc_entrypoint_bucket: 'sdk-cli',
    top_level_body_keys: ['max_tokens', 'mcp_servers', 'messages', 'metadata', 'model', 'stream', 'system', 'tools'],
    unknown_top_level_body_key_count: 0,
    tool_count: 1,
    stream: true,
    thinking_present: false,
    output_config_present: false,
    context_management_present: false,
    local_env_residue_present: false,
    date_format_bucket: 'not_observed',
    apostrophe_bucket: 'not_observed',
    base_url_category_bucket: 'not_observed',
    proxy_env_bucket: 'no_proxy_env',
    mcp_shape_bucket: 'official_remote_url_connector',
    mcp_server_count_bucket: '1',
    mcp_toolset_count_bucket: '1',
    mcp_auth_bucket: 'absent',
    ...overrides,
  }
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    route_class: 'messages',
    path: '/v1/messages',
    account_id: 'account-plan86',
    token_type: 'oauth',
    credential_ref: credentialRef,
    credential_source: 'server_account_credentials',
    credential_binding_hmac: credentialBindingHmac(),
    egress_bucket: 'bucket-plan86',
    proxy_identity_ref: proxyRef,
    trusted_egress_profile_ref: 'strip_attribution',
    billing_shape_policy: 'strip',
    env_residue_profile_ref: envResidueProfileRef,
    locale_profile_ref: localeProfileRef,
    base_url_residue_profile_ref: baseUrlResidueProfileRef,
    session_id: sessionId,
    timestamp_ms: Date.now(),
    nonce: `plan86-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    observed_client_profile: observedProfile(),
    policy_version: '2.1.197',
    persona_profile: 'claude-code-2.1.197-macos-local',
    profile_policy_version: profilePolicy2197,
    request_shape_profile_ref: requestShape2197,
    cache_parity_profile_ref: cache2197,
    egress_tls_profile_ref: tls2197,
    mcp_connector_policy_ref: mcpPolicyRef,
    ...overrides,
  }
}

function nativeBody(overrides: Record<string, unknown> = {}) {
  return {
    model: 'claude-opus-4-8',
    max_tokens: 32,
    metadata: { user_id: JSON.stringify({ session_id: sessionId }) },
    stream: true,
    system: [{ type: 'text', text: 'safe system fixture' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'local fixture' }] }],
    tools: [{ name: 'fixture_tool', description: 'fixture', input_schema: { type: 'object', properties: {} } }],
    ...overrides,
  }
}

function mcpUrl(path = '/mcp') {
  return new URL(path, `https://${mcpHost}`).toString()
}

function nativeMCPConnectorBody(overrides: Record<string, unknown> = {}) {
  return nativeBody({
    mcp_servers: [{ type: 'url', name: mcpServerName, url: mcpUrl() }],
    tools: [{ type: 'mcp_toolset', mcp_server_name: mcpServerName }],
    ...overrides,
  })
}

function gatewayConfig(sidecarUrl: string, overrides: Record<string, unknown> = {}) {
  return baseConfig({
    mode: 'sub2api',
    upstream: { url: 'http://127.0.0.1:9' },
    auth: { gateway_token: 'gateway-token', internal_control_token: internalControlToken, tokens: [] },
    oauth: undefined,
    env: { ...baseConfig().env, version: '2.1.197', version_base: '2.1.197' },
    shared_pool: {
      upstream_mode: 'preflight',
      billing_cch_mode: 'strip',
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:plan86',
      context_attestation_secret: attestationSecret,
      message_beta_profile: 'claude-code-2.1.197-macos-local',
      egress_tls: { enabled: true, strict: true },
      env_residue: {
        env_residue_profile_ref: envResidueProfileRef,
        locale_profile_ref: localeProfileRef,
        base_url_residue_profile_ref: baseUrlResidueProfileRef,
      },
    },
    formal_pool: {
      enabled: true,
      mcp_connector: {
        enabled: true,
        mode: 'official_remote_https',
        allowed_hosts: [mcpHost],
        allowed_models: ['claude-opus-4-8'],
      },
    },
    egress_tls_sidecar: {
      enabled: true,
      endpoint: sidecarUrl,
      control_token: sidecarControlToken,
      allowed_target_hosts: ['api.anthropic.com'],
      logical_target_host: 'api.anthropic.com',
      allowed_routes: ['/v1/messages'],
      allowed_profile_refs: [tls2197],
      expected_tls_summary_bucket: tlsBucket2197,
      mock_messages_response: { enabled: false, mode: 'local_smoke' },
    },
    tls_profiles: {
      oracle: { profile_ref: tls2197, source: 'observed-oracle-63', enabled: true },
    },
    account_identities: {
      'account-plan86': {
        device_id: 'b'.repeat(64),
        account_uuid_ref: 'hmac-sha256:' + 'a'.repeat(64),
        email_ref: 'hmac-sha256:' + 'c'.repeat(64),
        account_ref: 'hmac-sha256:' + 'd'.repeat(64),
        credential_ref: credentialRef,
        credential_binding_hmac: credentialBindingHmac(),
        token_type: 'oauth',
        persona_variant: 'claude-code-2.1.197-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.197',
      },
    },
    egress_buckets: {
      'bucket-plan86': {
        enabled: true,
        proxy_url: 'http://127.0.0.1:9',
        proxy_identity_ref: proxyRef,
        allowed_account_ids: ['account-plan86'],
        tls_profile_ref: tls2197,
      },
    },
    ...overrides,
  } as any)
}

async function startMockSidecar() {
  const captured: SidecarCapture[] = []
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8')
      const control = JSON.parse(String(req.headers['x-cc-egress-control'] || '{}'))
      captured.push({ control, headers: req.headers, bodyText: body })
      if (req.headers['x-cc-egress-sidecar-token'] !== sidecarControlToken) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'unauthenticated' }))
        return
      }
      res.writeHead(200, {
        'content-type': 'application/json',
        'x-cc-egress-tls-summary-bucket': tlsBucket2197,
      })
      res.end(JSON.stringify({ ok: true }))
    })
  })
  await listen(server)
  const { port } = server.address() as AddressInfo
  return { server, captured, url: `http://127.0.0.1:${port}` }
}

async function sendFormalPoolRequest(input: {
  body?: Record<string, unknown>
  contextOverrides?: Record<string, unknown>
  configOverrides?: Record<string, unknown>
  headerOverrides?: Record<string, string>
} = {}) {
  const sidecar = await startMockSidecar()
  const gateway = startProxy(gatewayConfig(sidecar.url, input.configOverrides || {}))
  try {
    const ctx = context(input.contextOverrides || {})
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: signedHeaders(ctx, input.headerOverrides || {}),
      body: input.body || nativeMCPConnectorBody(),
    })
    return { response, sidecarCount: sidecar.captured.length, sidecarCaptured: sidecar.captured }
  } finally {
    await close(gateway)
    await close(sidecar.server)
  }
}

test('formal-pool official remote MCP connector passes only when explicitly enabled and account opted in', async () => {
  const { response, sidecarCount, sidecarCaptured } = await sendFormalPoolRequest()
  assert.equal(response.status, 200, response.body)
  assert.equal(response.headers['x-cc-mcp-connector-decision-bucket'], 'official_url_connector_allowed')
  assert.equal(response.headers['x-cc-mcp-server-count-bucket'], '1')
  assert.equal(response.headers['x-cc-mcp-auth-bucket'], 'absent')
  assert.equal(sidecarCount, 1)
  assert.equal(sidecarCaptured[0].control.target_host, 'api.anthropic.com')
  assert.equal(sidecarCaptured[0].control.target_port, 443)
  assert.equal(sidecarCaptured[0].control.profile_ref, tls2197)
  assert.match(sidecarCaptured[0].bodyText, /mcp_servers/)
  assert.doesNotMatch(sidecarCaptured[0].bodyText, /x-anthropic-billing-header|cch=/i)
})

test('formal-pool MCP connector is rejected when config disabled or account policy ref missing', async () => {
  const disabled = await sendFormalPoolRequest({
    configOverrides: { formal_pool: { enabled: true, mcp_connector: { enabled: false } } },
  })
  assert.equal(disabled.response.status, 403, disabled.response.body)
  assert.equal(disabled.response.headers['x-cc-gateway-error-code'], 'formal_pool_mcp_connector_disabled')
  assert.equal(disabled.sidecarCount, 0)

  const missingPolicy = await sendFormalPoolRequest({ contextOverrides: { mcp_connector_policy_ref: undefined } })
  assert.equal(missingPolicy.response.status, 403, missingPolicy.response.body)
  assert.equal(missingPolicy.response.headers['x-cc-gateway-error-code'], 'formal_pool_mcp_connector_account_disabled')
  assert.equal(missingPolicy.sidecarCount, 0)
})

test('normal text mentioning MCP server does not trip MCP policy scanner', async () => {
  const { response, sidecarCount } = await sendFormalPoolRequest({
    body: nativeBody({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Explain what an MCP server is.' }] }],
    }),
    contextOverrides: {
      mcp_connector_policy_ref: undefined,
      observed_client_profile: observedProfile({
        mcp_shape_bucket: 'absent',
        mcp_server_count_bucket: '0',
        mcp_toolset_count_bucket: '0',
        top_level_body_keys: ['max_tokens', 'messages', 'metadata', 'model', 'stream', 'system', 'tools'],
      }),
    },
  })
  assert.equal(response.status, 200, response.body)
  assert.equal(response.headers['x-cc-mcp-connector-decision-bucket'], 'absent')
  assert.equal(sidecarCount, 1)
})

test('ordinary tool schema command fields do not trip MCP local-config policy', async () => {
  const { response, sidecarCount } = await sendFormalPoolRequest({
    body: nativeBody({
      tools: [{
        name: 'Bash',
        description: 'fixture',
        input_schema: {
          type: 'object',
          properties: {
            command: { type: 'string' },
          },
        },
      }],
    }),
    contextOverrides: {
      mcp_connector_policy_ref: undefined,
      observed_client_profile: observedProfile({
        mcp_shape_bucket: 'absent',
        mcp_server_count_bucket: '0',
        mcp_toolset_count_bucket: '0',
        top_level_body_keys: ['max_tokens', 'messages', 'metadata', 'model', 'stream', 'system', 'tools'],
      }),
    },
  })
  assert.equal(response.status, 200, response.body)
  assert.equal(response.headers['x-cc-mcp-connector-decision-bucket'], 'absent')
  assert.equal(sidecarCount, 1)
})

test('formal-pool MCP connector canonicalizes beta without trusting user supplied beta', async () => {
  const { response } = await sendFormalPoolRequest()
  assert.equal(response.status, 200, response.body)
  assert.equal(response.headers['x-cc-mcp-connector-decision-bucket'], 'official_url_connector_allowed')
})

test('formal-pool unsafe MCP shapes fail closed before sidecar', async () => {
  const unsafeCases: Array<[string, Record<string, unknown>, string]> = [
    ['stdio transport', { mcp_servers: [{ type: 'stdio', name: mcpServerName, command: 'node' }] }, 'formal_pool_mcp_local_stdio_unapproved'],
    ['command field', { mcp_servers: [{ type: 'url', name: mcpServerName, url: mcpUrl(), command: 'node' }] }, 'formal_pool_mcp_local_command_unapproved'],
    ['args field', { mcp_servers: [{ type: 'url', name: mcpServerName, url: mcpUrl(), args: ['--unsafe'] }] }, 'formal_pool_mcp_local_command_unapproved'],
    ['env field', { mcp_servers: [{ type: 'url', name: mcpServerName, url: mcpUrl(), env: { A: 'B' } }] }, 'formal_pool_mcp_raw_credential_unapproved'],
    ['http url', { mcp_servers: [{ type: 'url', name: mcpServerName, url: mcpUrl().replace('https:', 'http:') }] }, 'formal_pool_mcp_unsafe_url_unapproved'],
    ['loopback url', { mcp_servers: [{ type: 'url', name: mcpServerName, url: 'https://127.0.0.1/mcp' }] }, 'formal_pool_mcp_unsafe_url_unapproved'],
    ['metadata ip', { mcp_servers: [{ type: 'url', name: mcpServerName, url: 'https://169.254.169.254/mcp' }] }, 'formal_pool_mcp_unsafe_url_unapproved'],
    ['userinfo', { mcp_servers: [{ type: 'url', name: mcpServerName, url: `https://u:p@${mcpHost}/mcp` }] }, 'formal_pool_mcp_unsafe_url_unapproved'],
    ['non-default port', { mcp_servers: [{ type: 'url', name: mcpServerName, url: `https://${mcpHost}:8443/mcp` }] }, 'formal_pool_mcp_unsafe_url_unapproved'],
    ['query credential', { mcp_servers: [{ type: 'url', name: mcpServerName, url: `https://${mcpHost}/mcp?token=fixture` }] }, 'formal_pool_mcp_unsafe_url_unapproved'],
    ['fragment component', { mcp_servers: [{ type: 'url', name: mcpServerName, url: `https://${mcpHost}/mcp#fragment` }] }, 'formal_pool_mcp_unsafe_url_unapproved'],
    ['raw authorization token', { mcp_servers: [{ type: 'url', name: mcpServerName, url: mcpUrl(), authorization_token: 'redacted-fixture' }] }, 'formal_pool_mcp_raw_credential_unapproved'],
    ['unknown toolset server', { mcp_servers: [{ type: 'url', name: mcpServerName, url: mcpUrl() }], tools: [{ type: 'mcp_toolset', mcp_server_name: 'missing' }] }, 'formal_pool_mcp_toolset_unapproved'],
    ['forced tool choice', { mcp_servers: [{ type: 'url', name: mcpServerName, url: mcpUrl() }], tools: [{ type: 'mcp_toolset', mcp_server_name: mcpServerName }], tool_choice: { type: 'tool', name: 'unknown' } }, 'formal_pool_mcp_tool_choice_unapproved'],
    ['cache control under MCP server', { mcp_servers: [{ type: 'url', name: mcpServerName, url: mcpUrl(), cache_control: { type: 'ephemeral' } }], tools: [{ type: 'mcp_toolset', mcp_server_name: mcpServerName }] }, 'formal_pool_mcp_cache_control_unapproved'],
  ]

  for (const [name, override, expectedCode] of unsafeCases) {
    const { response, sidecarCount } = await sendFormalPoolRequest({ body: nativeBody(override) })
    assert.equal(response.status, 403, `${name}: ${response.body}`)
    assert.equal(response.headers['x-cc-gateway-error-code'], expectedCode, name)
    assert.equal(sidecarCount, 0, name)
  }
})

await finish()
