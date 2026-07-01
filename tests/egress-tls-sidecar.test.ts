import { strict as assert } from 'assert'
import { createHmac } from 'crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { readFileSync } from 'fs'
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import type { AddressInfo } from 'net'
import { baseConfig, close, finish, httpJson, listen, serverUrl, startFakeConnectProxy, startFakeUpstream, test } from './helpers.js'
import { startProxy } from '../src/proxy.js'
import { prepareEgressSidecarRequest, validateEgressSidecarConfig } from '../src/egress-sidecar-client.js'

console.log('\ntests/egress-tls-sidecar.test.ts')

const attestationSecret = 'scheduler-hmac-material-v1-local-safe-fixture-123456'
const internalControlToken = 'internal-control-material-v1-local-safe-fixture-123456'
const controlToken = 'sidecar-control-material-v1-local-safe-fixture-123456'
const expectedTLSProfileRef = 'tls-profile:claude-code-2.1.179-real-oracle-tcp-v1'
const expectedTLSBucket = 'tls-bucket:claude-code-real-oracle-2179'
const sessionId = '123e4567-e89b-42d3-a456-426614174999'
const sharedContractFixturePath = '/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/claude-platform-aws-formal-pool/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json'
const envResidueProfileRef = 'env-residue-profile:claude-code-2.1.179-us-pacific-official-anthropic-v1'
const localeProfileRef = 'locale-profile:us-pacific-v1'
const baseUrlResidueProfileRef = 'base-url-residue-profile:official-anthropic-v1'

type SidecarCapture = {
  control: any
  headers: Record<string, string | string[] | undefined>
  bodyLength: number
}

type SharedContractFixture = {
  materials: Record<string, string>
  account: Record<string, string>
  client_input: Record<string, string>
  valid_context: Record<string, unknown>
}

function loadSharedContractFixture(): SharedContractFixture {
  return JSON.parse(readFileSync(sharedContractFixturePath, 'utf-8')) as SharedContractFixture
}

function sharedFixtureContext(fixture: SharedContractFixture, overrides: Record<string, unknown> = {}) {
  return {
    ...fixture.valid_context,
    timestamp_ms: Date.now(),
    nonce: `sidecar-fixture-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ...overrides,
  }
}

function sharedFixtureConfig(fixture: SharedContractFixture, upstreamUrl: string, sidecarUrl: string, overrides: Record<string, unknown> = {}) {
  return sidecarConfig(upstreamUrl, sidecarUrl, {
    shared_pool: {
      context_attestation_secret_ref: 'opaque:attestation-ref:v1:shared-fixture',
      context_attestation_secret: fixture.materials.context_attestation_material,
      egress_tls: { enabled: true, strict: true },
    },
    egress_tls_sidecar: {
      enabled: true,
      endpoint: sidecarUrl,
      control_token: controlToken,
      allowed_target_hosts: ['api.anthropic.com'],
      logical_target_host: 'api.anthropic.com',
      allowed_routes: ['/v1/messages'],
      allowed_profile_refs: [String(fixture.account.egress_tls_profile_ref)],
      expected_tls_summary_bucket: expectedTLSBucket,
    },
    account_identities: {
      [String(fixture.account.account_id)]: {
        device_id: fixture.account.device_id,
        account_uuid_ref: fixture.account.account_uuid_ref,
        email_ref: fixture.account.email_ref,
        account_ref: fixture.account.account_ref,
        credential_ref: fixture.account.credential_ref,
        credential_binding_hmac: credentialBindingHmac(
          'Bearer fixture',
          'oauth',
          fixture.materials.context_attestation_material,
        ),
        persona_variant: fixture.account.persona_profile,
        session_policy: 'preserve_downstream_session_id',
        policy_version: fixture.account.policy_version,
      },
    },
    egress_buckets: {
      [String(fixture.account.egress_bucket)]: {
        enabled: true,
        proxy_url: 'http://127.0.0.1:9',
        proxy_identity_ref: fixture.account.proxy_identity_ref,
        allowed_account_ids: [String(fixture.account.account_id)],
        tls_profile_ref: fixture.account.egress_tls_profile_ref,
      },
    },
    tls_profiles: {
      'shared-fixture-real-oracle-2179': {
        profile_ref: fixture.account.egress_tls_profile_ref,
        source: 'observed-oracle-63',
        enabled: true,
      },
    },
    ...overrides,
  })
}

function sharedFixtureHeaders(fixture: SharedContractFixture, context: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return {
    'x-cc-gateway-token': 'gateway-token',
    'x-cc-provider': 'anthropic',
    'x-cc-account-id': String(fixture.account.account_id),
    'x-cc-token-type': 'oauth',
    'x-cc-credential-ref': String(fixture.account.credential_ref),
    'x-cc-egress-bucket': String(fixture.account.egress_bucket),
    'x-cc-policy-version': String(fixture.account.policy_version),
    authorization: 'Bearer fixture',
    'x-claude-code-session-id': String(fixture.valid_context.session_id),
    ...signedFormalPoolHeaders(context, fixture.materials.context_attestation_material),
    ...extraHeaders,
  }
}

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

function credentialBindingHmac(rawCredential: string, tokenType: 'oauth' | 'apikey' = 'oauth', secret = attestationSecret) {
  return `hmac-sha256:${createHmac('sha256', secret)
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
    session_id: sessionId,
    timestamp_ms: Date.now(),
    nonce: `sidecar-${Date.now()}-${Math.random().toString(16).slice(2)}`,
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
    },
    ...overrides,
  }
}

function sidecarConfig(upstreamUrl: string, sidecarUrl: string, overrides: Record<string, unknown> = {}) {
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
    egress_tls_sidecar: {
      enabled: true,
      endpoint: sidecarUrl,
      control_token: controlToken,
      allowed_target_hosts: ['api.anthropic.com'],
      logical_target_host: 'api.anthropic.com',
      allowed_routes: ['/v1/messages'],
      allowed_profile_refs: [expectedTLSProfileRef],
      expected_tls_summary_bucket: expectedTLSBucket,
    },
    tls_profiles: {
      'claude-code-real-oracle-2179': {
        profile_ref: expectedTLSProfileRef,
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
        credential_binding_hmac: credentialBindingHmac('Bearer fixture'),
        persona_variant: 'claude-code-2.1.179-macos-local',
        session_policy: 'preserve_downstream_session_id',
        policy_version: '2.1.179',
      },
    },
    egress_buckets: {
      'bucket-a': {
        enabled: true,
        proxy_url: 'http://127.0.0.1:9',
        proxy_identity_ref: 'opaque:proxy-ref:v1:bucket-a',
        allowed_account_ids: ['account-a'],
        tls_profile_ref: expectedTLSProfileRef,
      },
    },
    env: { ...baseConfig().env, version: '2.1.179', version_base: '2.1.179' },
    ...overrides,
  } as any)
}

async function startMockSidecar(options: { status?: number; token?: string; tlsBucket?: string; reject?: boolean; forwardToTarget?: boolean; forwardToUrl?: string } = {}) {
  const captured: SidecarCapture[] = []
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const control = JSON.parse(String(req.headers['x-cc-egress-control'] || '{}'))
      captured.push({ control, headers: req.headers, bodyLength: body.length })
      if (req.headers['x-cc-egress-sidecar-token'] !== (options.token || controlToken)) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'unauthenticated' }))
        return
      }
      if (options.reject) {
        res.writeHead(options.status || 403, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'rejected' }))
        return
      }
      if (!options.forwardToTarget) {
        res.writeHead(options.status || 200, {
          'content-type': 'application/json',
          'x-cc-egress-tls-summary-bucket': options.tlsBucket || expectedTLSBucket,
        })
        res.end(JSON.stringify({ ok: true }))
        return
      }
      const mapped = options.forwardToTarget ? new URL(String((options as any).forwardToUrl || '')) : null
      if (!mapped || control.target_host !== 'api.anthropic.com' || control.target_scheme !== 'https' || Number(control.target_port) !== 443) {
        res.writeHead(403, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'target_not_allowed' }))
        return
      }
      const requestFn = mapped.protocol === 'https:' ? httpsRequest : httpRequest
      const upstreamReq = requestFn({
        protocol: mapped.protocol,
        hostname: mapped.hostname,
        port: Number(mapped.port || (mapped.protocol === 'https:' ? '443' : '80')),
        path: control.target_path,
        method: control.method || 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(body.length),
        },
      }, (upstreamRes) => {
        const responseChunks: Buffer[] = []
        upstreamRes.on('data', (chunk) => responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        upstreamRes.on('end', () => {
          res.writeHead(upstreamRes.statusCode || 502, {
            ...upstreamRes.headers,
            'x-cc-egress-tls-summary-bucket': options.tlsBucket || expectedTLSBucket,
          })
          res.end(Buffer.concat(responseChunks))
        })
      })
      upstreamReq.on('error', () => {
        res.writeHead(502, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'upstream_unavailable' }))
      })
      upstreamReq.write(body)
      upstreamReq.end()
    })
  })
  await listen(server)
  const { port } = server.address() as AddressInfo
  return { server, captured, url: `http://127.0.0.1:${port}` }
}

async function postThroughGateway(gateway: ReturnType<typeof startProxy>, contextOverrides: Record<string, unknown> = {}) {
  const context = formalPoolContext(contextOverrides)
  return httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
    headers: {
      'x-cc-gateway-token': 'gateway-token',
      'x-cc-provider': 'anthropic',
      'x-cc-account-id': 'account-a',
      'x-cc-token-type': 'oauth',
      'x-cc-credential-ref': 'opaque:credential-ref:v1:cred-a',
      'x-cc-egress-bucket': 'bucket-a',
      'x-cc-policy-version': '2.1.179',
      authorization: 'Bearer fixture',
      'x-claude-code-session-id': sessionId,
      ...signedFormalPoolHeaders(context),
    },
    body: { metadata: { user_id: JSON.stringify({ session_id: sessionId }) }, messages: [{ role: 'user', content: 'hello' }] },
  })
}


test('TLS sidecar config rejects production-unsafe target scheme, non-443 port, and request-controlled override allowlists', async () => {
  const upstream = await startFakeUpstream()
  const sidecar = await startMockSidecar()
  try {
    for (const [name, override] of [
      ['http_scheme', { target_scheme: 'http' }],
      ['non_443_port', { target_port: 8443 }],
      ['request_dial_override', { dial_override: '127.0.0.1:1' }],
      ['request_sni_override', { tls_server_name: 'evil.invalid' }],
      ['request_alpn_override', { alpn_protocols: ['h2', 'http/1.1'] }],
      ['localhost_endpoint', { endpoint: sidecar.url.replace('127.0.0.1', 'localhost') }],
    ] as Array<[string, Record<string, unknown>]>) {
      const config = sidecarConfig(upstream.url, sidecar.url, {
        egress_tls_sidecar: {
          enabled: true,
          endpoint: sidecar.url,
          control_token: controlToken,
          allowed_target_hosts: ['127.0.0.1'],
          allowed_routes: ['/v1/messages'],
          allowed_profile_refs: [expectedTLSProfileRef],
          expected_tls_summary_bucket: expectedTLSBucket,
          ...override,
        },
      })
      assert.throws(() => validateEgressSidecarConfig(config as any), /egress_tls_sidecar/i, name)
    }
  } finally {
    await close(upstream.server)
    await close(sidecar.server)
  }
})

test('TLS sidecar config requires logical provider host and expected summary bucket', async () => {
  const upstream = await startFakeUpstream()
  const sidecar = await startMockSidecar()
  try {
    for (const [name, override] of [
      ['missing_logical_target_host', { logical_target_host: undefined }],
      ['localhost_logical_target_host', { logical_target_host: '127.0.0.1' }],
      ['missing_expected_summary_bucket', { expected_tls_summary_bucket: undefined }],
      ['malformed_expected_summary_bucket', { expected_tls_summary_bucket: 'not-a-safe-bucket' }],
    ] as Array<[string, Record<string, unknown>]>) {
      const baseSidecar = {
        enabled: true,
        endpoint: sidecar.url,
        control_token: controlToken,
        allowed_target_hosts: ['api.anthropic.com'],
        logical_target_host: 'api.anthropic.com',
        allowed_routes: ['/v1/messages'],
        allowed_profile_refs: [expectedTLSProfileRef],
        expected_tls_summary_bucket: expectedTLSBucket,
      } as Record<string, unknown>
      for (const [key, value] of Object.entries(override)) {
        if (value === undefined) delete baseSidecar[key]
        else baseSidecar[key] = value
      }
      const config = sidecarConfig(upstream.url, sidecar.url, { egress_tls_sidecar: baseSidecar })
      assert.throws(() => validateEgressSidecarConfig(config as any), /egress_tls_sidecar/i, name)
    }
  } finally {
    await close(upstream.server)
    await close(sidecar.server)
  }
})


test('TLS sidecar request preparation rejects non-HTTPS and non-443 target authority', () => {
  const base = sidecarConfig('http://127.0.0.1:1', 'http://127.0.0.1:1') as any
  const common = {
    config: base,
    profileRef: expectedTLSProfileRef,
    egressBucket: 'bucket-a',
    proxyIdentityRef: 'opaque:proxy-ref:v1:bucket-a',
    targetHost: 'api.anthropic.com',
    targetPath: '/v1/messages',
    route: '/v1/messages',
    method: 'POST',
  }
  assert.equal(prepareEgressSidecarRequest({ ...common, targetPort: 443, targetScheme: 'http' }).ok, false)
  assert.equal(prepareEgressSidecarRequest({ ...common, targetPort: 8443, targetScheme: 'https' }).ok, false)
})

test('TLS sidecar request preparation rejects missing expected summary bucket', () => {
  const config = sidecarConfig('http://127.0.0.1:1', 'http://127.0.0.1:1') as any
  delete config.egress_tls_sidecar.expected_tls_summary_bucket
  const prepared = prepareEgressSidecarRequest({
    config,
    profileRef: expectedTLSProfileRef,
    egressBucket: 'bucket-a',
    proxyIdentityRef: 'opaque:proxy-ref:v1:bucket-a',
    targetHost: 'api.anthropic.com',
    targetPort: 443,
    targetScheme: 'https',
    targetPath: '/v1/messages',
    route: '/v1/messages',
    method: 'POST',
  })
  assert.equal(prepared.ok, false)
  if (!prepared.ok) assert.equal(prepared.code, 'egress_tls_summary_bucket_missing')
})

test('TLS sidecar response missing malformed duplicate or conflicting summary bucket fails closed', async () => {
  async function startSummaryHeaderSidecar(headerValue: string | string[] | undefined) {
    const captured: SidecarCapture[] = []
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      req.on('end', () => {
        const control = JSON.parse(String(req.headers['x-cc-egress-control'] || '{}'))
        captured.push({ control, headers: req.headers, bodyLength: Buffer.concat(chunks).length })
        if (req.headers['x-cc-egress-sidecar-token'] !== controlToken) {
          res.writeHead(401, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'unauthenticated' }))
          return
        }
        const headers: Record<string, string | string[]> = { 'content-type': 'application/json' }
        if (headerValue !== undefined) headers['x-cc-egress-tls-summary-bucket'] = headerValue
        res.writeHead(200, headers)
        res.end(JSON.stringify({ ok: true }))
      })
    })
    await listen(server)
    const { port } = server.address() as AddressInfo
    return { server, captured, url: `http://127.0.0.1:${port}` }
  }
  for (const [caseName, value] of [
    ['missing', undefined],
    ['malformed', 'not-a-safe-bucket'],
    ['duplicate_same', [expectedTLSBucket, expectedTLSBucket]],
    ['duplicate_conflict', [expectedTLSBucket, 'tls-bucket:other-safe']],
  ] as Array<[string, string | string[] | undefined]>) {
    const upstream = await startFakeUpstream()
    const sidecar = await startSummaryHeaderSidecar(value)
    const gateway = startProxy(sidecarConfig(upstream.url, sidecar.url))
    try {
      const response = await postThroughGateway(gateway, { nonce: `summary-${caseName}` })
      assert.equal(response.status, 502, response.body)
      assert.equal(response.headers['x-cc-gateway-error-code'], 'egress_tls_summary_mismatch', caseName)
      assert.equal(upstream.captured.length, 0, caseName)
    } finally {
      await close(gateway)
      await close(upstream.server)
      await close(sidecar.server)
    }
  }
})

test('TLS sidecar path sends only safe authenticated control metadata and never uses Node direct fallback', async () => {
  const upstream = await startFakeUpstream()
  const sidecar = await startMockSidecar()
  const gateway = startProxy(sidecarConfig(upstream.url, sidecar.url))
  try {
    const response = await postThroughGateway(gateway)
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 0, 'Node direct/proxy upstream path must not be used when TLS sidecar is enabled')
    assert.equal(sidecar.captured.length, 1)
    const control = sidecar.captured[0].control
    assert.deepEqual(Object.keys(control).sort(), [
      'egress_bucket',
      'expected_tls_summary_bucket',
      'method',
      'profile_ref',
      'proxy_identity_ref',
      'route',
      'target_host',
      'target_path',
      'target_port',
      'target_scheme',
    ].sort())
    assert.equal(control.profile_ref, expectedTLSProfileRef)
    assert.equal(control.expected_tls_summary_bucket, expectedTLSBucket)
    assert.equal(control.egress_bucket, 'bucket-a')
    assert.equal(control.proxy_identity_ref, 'opaque:proxy-ref:v1:bucket-a')
    assert.equal(control.target_host, 'api.anthropic.com')
    assert.equal(control.target_scheme, 'https')
    assert.equal(control.target_port, 443)
    assert.equal(control.target_path, '/v1/messages')
    const serialized = JSON.stringify(control)
    assert(!/authorization|x-api-key|cookie|raw[_-]?(prompt|body|response)|prompt|clientHello|pcap|private|hello/i.test(serialized), serialized)
    assert.equal(sidecar.captured[0].headers['x-cc-egress-sidecar-token'], controlToken)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(sidecar.server)
  }
})

test('TLS sidecar disabled under strict formal-pool TLS fails closed without Node direct fallback', async () => {
  const upstream = await startFakeUpstream()
  const sidecar = await startMockSidecar()
  const gateway = startProxy(sidecarConfig(upstream.url, sidecar.url, {
    egress_tls_sidecar: {
      enabled: false,
      endpoint: sidecar.url,
      control_token: controlToken,
      allowed_target_hosts: ['api.anthropic.com'],
      logical_target_host: 'api.anthropic.com',
      allowed_routes: ['/v1/messages'],
      allowed_profile_refs: [expectedTLSProfileRef],
      expected_tls_summary_bucket: expectedTLSBucket,
    },
  }))
  try {
    const response = await postThroughGateway(gateway, { nonce: 'sidecar-disabled-strict' })
    assert.equal(response.status, 403, response.body)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'egress_tls_sidecar_disabled')
    assert.notEqual(response.headers['x-cc-egress-tls-summary-bucket'], expectedTLSBucket)
    assert.notEqual(response.headers['x-cc-egress-tls-profile-status'], 'verified')
    assert.equal(sidecar.captured.length, 0)
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(sidecar.server)
  }
})

test('TLS sidecar unavailable fails closed without Node direct fallback', async () => {
  const upstream = await startFakeUpstream()
  const proxy = await startFakeConnectProxy()
  await close(proxy.server)
  const gateway = startProxy(sidecarConfig(upstream.url, proxy.url))
  try {
    const response = await postThroughGateway(gateway)
    assert.equal(response.status, 502, response.body)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'egress_tls_sidecar_unavailable')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
  }
})

test('TLS sidecar logical target allowlist mismatch fails closed before sidecar request and without fallback', async () => {
  const upstream = await startFakeUpstream()
  const sidecar = await startMockSidecar()
  const gateway = startProxy(sidecarConfig(upstream.url, sidecar.url, {
    egress_tls_sidecar: {
      enabled: true,
      endpoint: sidecar.url,
      control_token: controlToken,
      allowed_target_hosts: ['example.invalid'],
      allowed_routes: ['/v1/messages'],
      allowed_profile_refs: [expectedTLSProfileRef],
      expected_tls_summary_bucket: expectedTLSBucket,
    },
  }))
  try {
    const response = await postThroughGateway(gateway)
    assert.equal(response.status, 403, response.body)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'egress_tls_sidecar_logical_target_missing')
    assert.equal(sidecar.captured.length, 0)
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(sidecar.server)
  }
})

test('TLS sidecar profile mismatch fails closed before sidecar request and without fallback', async () => {
  const upstream = await startFakeUpstream()
  const sidecar = await startMockSidecar()
  const gateway = startProxy(sidecarConfig(upstream.url, sidecar.url, {
    egress_tls_sidecar: {
      enabled: true,
      endpoint: sidecar.url,
      control_token: controlToken,
      allowed_target_hosts: ['api.anthropic.com'],
      logical_target_host: 'api.anthropic.com',
      allowed_routes: ['/v1/messages'],
      allowed_profile_refs: ['tls-profile:other-safe-profile'],
      expected_tls_summary_bucket: expectedTLSBucket,
    },
  }))
  try {
    const response = await postThroughGateway(gateway)
    assert.equal(response.status, 403, response.body)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'egress_tls_sidecar_profile_not_allowed')
    assert.equal(sidecar.captured.length, 0)
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(sidecar.server)
  }
})

test('TLS sidecar unauthenticated or TLS summary mismatch fails closed without fallback', async () => {
  for (const [caseName, mockOptions, expectedCode] of [
    ['unauthenticated', { token: 'different-token' }, 'egress_tls_sidecar_unauthenticated'],
    ['summary_mismatch', { tlsBucket: 'tls-bucket:node-agent-mismatch' }, 'egress_tls_summary_mismatch'],
  ] as Array<[string, Parameters<typeof startMockSidecar>[0], string]>) {
    const upstream = await startFakeUpstream()
    const sidecar = await startMockSidecar(mockOptions)
    const gateway = startProxy(sidecarConfig(upstream.url, sidecar.url))
    try {
      const response = await postThroughGateway(gateway, { nonce: `sidecar-${caseName}` })
      assert.equal(response.status, caseName === 'unauthenticated' ? 502 : 502, response.body)
      assert.equal(response.headers['x-cc-gateway-error-code'], expectedCode, caseName)
      assert.equal(upstream.captured.length, 0, caseName)
    } finally {
      await close(gateway)
      await close(upstream.server)
      await close(sidecar.server)
    }
  }
})


test('mock E2E shared fixture reaches TLS sidecar and local upstream with coherent account egress profile tuple', async () => {
  const fixture = loadSharedContractFixture()
  const upstream = await startFakeUpstream((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'x-local-upstream-seen': 'true' })
    res.end(JSON.stringify({ ok: true, via: 'local-upstream' }))
  })
  const sidecar = await startMockSidecar({ forwardToTarget: true, forwardToUrl: upstream.url })
  const gateway = startProxy(sharedFixtureConfig(fixture, upstream.url, sidecar.url))
  const context = sharedFixtureContext(fixture)
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: sharedFixtureHeaders(fixture, context),
      body: { metadata: { user_id: JSON.stringify({ session_id: fixture.valid_context.session_id }) }, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(upstream.captured.length, 1, 'mock E2E sidecar must forward to the local upstream/collector exactly once')
    assert.equal(upstream.captured[0].url, '/v1/messages')
    assert.equal(response.headers['x-local-upstream-seen'], 'true')
    assert.match(response.body, /local-upstream/)
    assert.equal(sidecar.captured.length, 1)
    const control = sidecar.captured[0].control
    assert.equal(control.profile_ref, fixture.account.egress_tls_profile_ref)
    assert.equal(control.egress_bucket, fixture.account.egress_bucket)
    assert.equal(control.proxy_identity_ref, fixture.account.proxy_identity_ref)
    assert.equal(control.expected_tls_summary_bucket, expectedTLSBucket)
    assert.equal(response.headers['x-cc-egress-tls-profile-status'], 'tls_profile_unverified')
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(sidecar.server)
  }
})

test('mock E2E forged client TLS headers do not alter sidecar profile authority', async () => {
  const fixture = loadSharedContractFixture()
  const upstream = await startFakeUpstream()
  const sidecar = await startMockSidecar()
  const gateway = startProxy(sharedFixtureConfig(fixture, upstream.url, sidecar.url))
  const context = sharedFixtureContext(fixture)
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: sharedFixtureHeaders(fixture, context, {
        'x-cc-egress-tls-profile-ref': 'tls-profile:client-forged-header',
        'x-sub2api-tls-profile': 'tls-profile:client-forged-sub2api',
      }),
      body: {
        metadata: { user_id: JSON.stringify({ session_id: fixture.valid_context.session_id }) },
        messages: [{ role: 'user', content: 'hello' }],
      },
    })
    assert.equal(response.status, 200, response.body)
    assert.equal(sidecar.captured.length, 1)
    const serialized = JSON.stringify(sidecar.captured[0].control)
    assert.equal(sidecar.captured[0].control.profile_ref, fixture.account.egress_tls_profile_ref)
    assert(!serialized.includes('client-forged'), serialized)
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(sidecar.server)
  }
})

test('mock E2E forged body TLS hint is rejected before sidecar authority or upstream egress', async () => {
  const fixture = loadSharedContractFixture()
  const upstream = await startFakeUpstream()
  const sidecar = await startMockSidecar()
  const gateway = startProxy(sharedFixtureConfig(fixture, upstream.url, sidecar.url))
  const context = sharedFixtureContext(fixture)
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: sharedFixtureHeaders(fixture, context),
      body: {
        metadata: { user_id: JSON.stringify({ session_id: fixture.valid_context.session_id }) },
        egress_tls_profile_ref: 'tls-profile:client-forged-body',
        tls_profile: { ref: 'tls-profile:client-forged-nested' },
        messages: [{ role: 'user', content: 'hello' }],
      },
    })
    assert.equal(response.status, 400, response.body)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'request_shape_profile_mismatch')
    assert.equal(sidecar.captured.length, 0)
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(sidecar.server)
  }
})

test('mock E2E forged query TLS hint is rejected before sidecar authority or upstream egress', async () => {
  const fixture = loadSharedContractFixture()
  const upstream = await startFakeUpstream()
  const sidecar = await startMockSidecar()
  const gateway = startProxy(sharedFixtureConfig(fixture, upstream.url, sidecar.url))
  const context = sharedFixtureContext(fixture)
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true&egress_tls_profile_ref=tls-profile:client-forged-query'), {
      headers: sharedFixtureHeaders(fixture, context),
      body: { metadata: { user_id: JSON.stringify({ session_id: fixture.valid_context.session_id }) }, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 404, response.body)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'unsupported_route')
    assert.equal(sidecar.captured.length, 0)
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(sidecar.server)
  }
})

test('mock E2E account bucket profile mismatch fails closed before sidecar', async () => {
  const fixture = loadSharedContractFixture()
  const upstream = await startFakeUpstream()
  const sidecar = await startMockSidecar()
  const gateway = startProxy(sharedFixtureConfig(fixture, upstream.url, sidecar.url, {
    egress_buckets: {
      [String(fixture.account.egress_bucket)]: {
        enabled: true,
        proxy_url: 'http://127.0.0.1:9',
        proxy_identity_ref: fixture.account.proxy_identity_ref,
        allowed_account_ids: [String(fixture.account.account_id)],
        tls_profile_ref: 'tls-profile:other-safe-profile',
      },
    },
    tls_profiles: {
      'shared-fixture-real-oracle-2179': {
        profile_ref: fixture.account.egress_tls_profile_ref,
        source: 'observed-oracle-63',
        enabled: true,
      },
      'shared-fixture-other': {
        profile_ref: 'tls-profile:other-safe-profile',
        source: 'observed-oracle-63',
        enabled: true,
      },
    },
  }))
  const context = sharedFixtureContext(fixture)
  try {
    const response = await httpJson(serverUrl(gateway, '/v1/messages?beta=true'), {
      headers: sharedFixtureHeaders(fixture, context),
      body: { metadata: { user_id: JSON.stringify({ session_id: fixture.valid_context.session_id }) }, messages: [{ role: 'user', content: 'hello' }] },
    })
    assert.equal(response.status, 403, response.body)
    assert.equal(response.headers['x-cc-gateway-error-code'], 'formal_pool_context_mismatch')
    assert.equal(sidecar.captured.length, 0)
    assert.equal(upstream.captured.length, 0)
  } finally {
    await close(gateway)
    await close(upstream.server)
    await close(sidecar.server)
  }
})

await finish()
