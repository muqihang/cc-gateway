import { createServer as createHttpsServer, type ServerOptions } from 'https'
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'http'
import { readFileSync } from 'fs'
import { createHash } from 'crypto'
import { request as httpsRequest } from 'https'
import { URL } from 'url'
import type { Config } from './config.js'
import { authenticate, authenticateGateway, initAuth } from './auth.js'
import { getAccessToken } from './oauth.js'
import { rewriteBody, rewriteHeaders } from './rewriter.js'
import { audit, log } from './logger.js'
import { getProxyAgent } from './proxy-agent.js'
import {
  getSharedPoolMaxBodyBytes,
  normalizeSharedPoolSessionId,
  resolveAccountIdentity,
  resolveEgressBucket,
  runSigningPipeline,
  selectSharedPoolRoute,
  verifySignedCCH,
  type AccountIdentityRecord,
  type EgressBucketResolution,
} from './policy.js'
import { redactRequestPath, redactSensitiveText } from './redaction.js'

export function startProxy(config: Config) {
  initAuth(config)

  const upstream = new URL(config.upstream.url)
  const useTls = config.server.tls?.cert && config.server.tls?.key

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    handleRequest(req, res, config, upstream)
  }

  let server
  if (useTls) {
    const tlsOptions: ServerOptions = {
      cert: readFileSync(config.server.tls.cert),
      key: readFileSync(config.server.tls.key),
    }
    server = createHttpsServer(tlsOptions, handler)
  } else {
    server = createHttpServer(handler)
    log('warn', 'Running without TLS - only use for local development')
  }

  server.listen(config.server.port, () => {
    log('info', `CC Gateway listening on ${useTls ? 'https' : 'http'}://0.0.0.0:${config.server.port}`)
    log('info', `Upstream: ${redactSensitiveText(config.upstream.url)}`)
    log('info', `Canonical device_id: ${config.identity.device_id.slice(0, 8)}...`)
    log('info', `Authorized clients: ${config.auth.tokens.map(t => t.name).join(', ')}`)
  })

  return server
}

function writeControlPlaneError(res: ServerResponse, status: number, code: string, message: string) {
  const body = JSON.stringify({
    type: 'error',
    error: {
      type: 'cc_gateway_control_plane',
      code,
      message: redactSensitiveText(message),
    },
  })
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'X-CC-Gateway-Error-Kind': 'control-plane',
    'X-CC-Gateway-Error-Code': code,
  })
  res.end(body)
}

function proxyAgentCacheKey(account: AccountContext, upstreamUrl: URL, egress: EgressBucketResolution): string {
  const parts = [
    account.provider,
    account.accountId || '-',
    egress.bucketId,
    egress.proxyIdentityHash,
    upstreamUrl.protocol,
    upstreamUrl.host,
    createHash('sha256').update(upstreamUrl.href).digest('hex').slice(0, 12),
  ]
  return parts.join('|')
}

type AccountContext = {
  provider: string
  accountId?: string
  tokenType: 'oauth' | 'apikey'
  accountEmail?: string
  accountUuid?: string
  organizationUuid?: string
  egressBucket?: string
  policyVersion?: string
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  upstream: URL,
) {
  const method = req.method || 'GET'
  const target = normalizeRequestTarget(req.url || '/')
  const path = target.path
  const safePath = redactRequestPath(path)
  const clientIp = req.socket.remoteAddress || 'unknown'

  log('info', `← ${method} ${safePath} from ${clientIp}`)

  // Health check - no auth required
  if (target.pathname === '/_health') {
    const oauthOk = config.mode === 'sub2api' ? true : !!getAccessToken()
    const status = oauthOk ? 200 : 503
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: oauthOk ? 'ok' : 'degraded',
      mode: config.mode,
      oauth: config.mode === 'sub2api' ? 'not_used' : (oauthOk ? 'valid' : 'expired/refreshing'),
      canonical_device: config.identity.device_id.slice(0, 8) + '...',
      canonical_platform: config.env.platform,
      upstream: redactSensitiveText(config.upstream.url),
      clients: config.auth.tokens.map(t => t.name),
    }))
    return
  }

  // Dry-run verification - shows what would be rewritten (auth required)
  if (target.pathname === '/_verify') {
    const clientName = authenticateForMode(req, config)
    if (!clientName) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }
    const sample = buildVerificationPayload(config)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(sample, null, 2))
    return
  }

  // Authenticate client (proxy-level auth)
  const clientName = authenticateForMode(req, config)
  if (!clientName) {
    if (config.mode === 'sub2api') {
      writeControlPlaneError(res, 401, 'missing_gateway_token', 'Unauthorized - provide gateway token via x-cc-gateway-token header')
    } else {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized - provide client token via x-api-key header' }))
    }
    log('warn', `Unauthorized request: ${method} ${safePath}`)
    return
  }

  log('info', `Client "${clientName}" → ${method} ${safePath}`)

  let accountContext: AccountContext | null = null
  let accountIdentity: AccountIdentityRecord | null = null
  let egress: EgressBucketResolution | null = null
  let oauthToken: string | null = null
  let routePolicy: ReturnType<typeof selectSharedPoolRoute> | null = null

  if (config.mode === 'sub2api') {
    routePolicy = selectSharedPoolRoute(method, target.pathname, target.search)
    if (routePolicy.action === 'block') {
      writeControlPlaneError(res, routePolicy.status, routePolicy.code, `Unsupported route: ${safePath}`)
      return
    }

    const parsed = parseAccountContext(req, config)
    if ('error' in parsed) {
      writeControlPlaneError(res, parsed.status, parsed.code, parsed.error)
      return
    }
    accountContext = parsed.context

    accountIdentity = resolveAccountIdentity(config, accountContext.accountId)
    if (!accountIdentity) {
      writeControlPlaneError(res, 403, 'missing_account_identity', 'Missing per-account identity for selected upstream account')
      return
    }
    if (accountIdentity.policy_version !== accountContext.policyVersion) {
      writeControlPlaneError(res, 403, 'identity_policy_version_mismatch', 'Account identity policy version mismatch')
      return
    }

    const resolvedEgress = resolveEgressBucket(config, accountContext.egressBucket, accountContext.accountId)
    if ('error' in resolvedEgress) {
      writeControlPlaneError(res, 403, resolvedEgress.error, 'Egress bucket is not eligible for the selected upstream account')
      return
    }
    egress = resolvedEgress
  } else {
    // Get the real OAuth token (managed by gateway)
    oauthToken = getAccessToken()
    if (!oauthToken) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'OAuth token not available - gateway is refreshing' }))
      log('error', 'No valid OAuth token available')
      return
    }
  }

  if (config.mode === 'sub2api' && routePolicy?.action === 'suppress') {
    await drainRequestWithinLimit(req, getSharedPoolMaxBodyBytes(config), res)
    if (!res.writableEnded) {
      res.writeHead(204, { 'X-CC-Gateway-Event-Policy': 'suppress' })
      res.end()
      if (config.logging.audit) audit(clientName, method, safePath, 204)
    }
    return
  }

  const bodyResult = await readRequestBody(req, config.mode === 'sub2api' ? getSharedPoolMaxBodyBytes(config) : undefined)
  if ('error' in bodyResult) {
    writeControlPlaneError(res, 413, 'body_too_large', 'Shared-pool request body exceeds configured cap')
    return
  }
  let body = bodyResult.body

  let parsedBody: unknown = null
  if (config.mode === 'sub2api' && body.length > 0) {
    try {
      parsedBody = JSON.parse(body.toString('utf-8'))
    } catch {
      parsedBody = null
    }
  }
  const sessionId = accountIdentity ? normalizeSharedPoolSessionId(parsedBody, readHeader(req, 'x-claude-code-session-id'), accountIdentity) : undefined
  if (config.mode === 'sub2api' && !sessionId) {
    writeControlPlaneError(res, 400, 'session_binding_failed', 'Unable to bind X-Claude-Code-Session-Id to metadata.user_id')
    return
  }
  if (parsedBody && body.length > 0) {
    body = Buffer.from(JSON.stringify(parsedBody), 'utf-8')
  }

  const billingMode = (config as any).shared_pool?.billing_cch_mode || 'strip'
  if (config.mode === 'sub2api') {
    const retryContract = verifyRetryFinalOutputContract(req, billingMode)
    if (!retryContract.ok) {
      writeControlPlaneError(res, retryContract.status, retryContract.code, retryContract.message)
      return
    }
  }

  if (config.mode === 'sub2api' && billingMode === 'disabled') {
    writeControlPlaneError(res, 403, 'billing_cch_mode_disabled', 'Shared-pool billing/CCH mode is disabled')
    return
  }
  if (config.mode === 'sub2api' && !['strip', 'sign'].includes(billingMode)) {
    writeControlPlaneError(res, 403, 'unsupported_billing_cch_mode', 'Unsupported shared-pool billing/CCH mode')
    return
  }

  // Rewrite identity fields in body
  if (body.length > 0) {
    try {
      body = rewriteBody(body, target.pathname, config, { accountIdentity: accountIdentity ?? undefined, sessionId }) as Buffer<ArrayBuffer>
    } catch (err) {
      log('error', `Body rewrite failed for ${safePath}: ${redactSensitiveText(String(err))}`)
    }
  }

  // Rewrite headers (strips client auth, normalizes identity headers)
  const rewrittenHeaders = rewriteHeaders(
    req.headers as Record<string, string | string[] | undefined>,
    config,
    config.mode === 'sub2api'
      ? { upstreamAuth: accountContext!.tokenType, stripGatewayControlHeaders: true, sharedPool: true, route: target.pathname }
      : {},
  )

  if (sessionId && config.mode === 'sub2api') {
    rewrittenHeaders['X-Claude-Code-Session-Id'] = sessionId
  }

  if (config.mode === 'sub2api' && billingMode === 'sign') {
    const signing = runSigningPipeline(config, body)
    if (!signing.ok) {
      writeControlPlaneError(res, 403, signing.code, 'Manual signing mode is disabled or signer verification failed')
      return
    }
    body = signing.body
    const verifier = verifySignedCCH(body)
    if (!verifier.ok) {
      writeControlPlaneError(res, 400, verifier.code, 'Shared-pool signing verifier failed')
      return
    }
  } else if (config.mode === 'sub2api') {
    const verifier = verifySharedPoolFinalOutput(rewrittenHeaders, body)
    if (!verifier.ok) {
      writeControlPlaneError(res, 400, verifier.code, 'Shared-pool final-output verifier failed')
      return
    }
  }

  if (oauthToken) {
    // Inject the real OAuth token via x-api-key (Anthropic uses this header for both
    // API keys and OAuth tokens, distinguished by prefix: sk-ant-api03- vs sk-ant-oat01-)
    rewrittenHeaders['x-api-key'] = oauthToken
  }

  // Forward to upstream
  const upstreamUrl = buildFixedUpstreamUrl(target, upstream)

  const agentKey = config.mode === 'sub2api' && accountContext && egress
    ? proxyAgentCacheKey(accountContext, upstream, egress)
    : 'default'
  const agent = config.mode === 'sub2api' && egress
    ? getProxyAgent(agentKey, egress.proxyUrl)
    : getProxyAgent(agentKey)
  if (config.mode === 'sub2api' && !agent) {
    writeControlPlaneError(res, 403, 'missing_egress_proxy', 'Configured egress proxy is unavailable')
    return
  }
  const requestFn = upstreamUrl.protocol === 'http:' ? httpRequest : httpsRequest
  const proxyReq = requestFn(
    upstreamUrl,
    {
      method,
      headers: {
        ...rewrittenHeaders,
        host: upstream.host,
        'content-length': String(body.length),
      },
      ...(agent && { agent }),
    },
    (proxyRes) => {
      const status = proxyRes.statusCode || 502

      const responseHeaders = { ...proxyRes.headers }
      delete responseHeaders['transfer-encoding']

      res.writeHead(status, responseHeaders)

      // Stream response directly (SSE for Claude responses)
      proxyRes.pipe(res)

      if (config.logging.audit) {
        audit(clientName, method, safePath, status)
      }
    },
  )

  proxyReq.on('error', (err) => {
    const safeMessage = redactSensitiveText(err.message)
    log('error', `Upstream error: ${safeMessage}`)
    if (!res.headersSent) {
      if (config.mode === 'sub2api') {
        writeControlPlaneError(res, 502, 'egress_proxy_failure', 'Configured egress proxy failed before upstream response')
      } else {
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Bad gateway', detail: safeMessage }))
      }
    }
    if (config.logging.audit) {
      audit(clientName, method, safePath, 502)
    }
  })

  proxyReq.write(body)
  proxyReq.end()
}


function verifySharedPoolFinalOutput(headers: Record<string, string>, body: Buffer): { ok: true } | { ok: false; code: string } {
  const headerKeys = Object.keys(headers).map((key) => key.toLowerCase())
  if (headerKeys.includes('x-anthropic-billing-header')) return { ok: false, code: 'strip_verifier_failed' }
  const bodyText = body.toString('utf-8')
  if (/x-anthropic-billing-header/i.test(bodyText) || /\bcch=/i.test(bodyText)) {
    return { ok: false, code: 'strip_verifier_failed' }
  }
  try {
    const parsed = JSON.parse(bodyText)
    const userIdRaw = parsed?.metadata?.user_id
    if (typeof userIdRaw !== 'string') return { ok: false, code: 'session_binding_failed' }
    const userId = JSON.parse(userIdRaw)
    const allowed = ['account_uuid', 'device_id', 'session_id']
    if (!allowed.every((key) => typeof userId[key] === 'string')) return { ok: false, code: 'session_binding_failed' }
    if (Object.keys(userId).some((key) => !allowed.includes(key))) return { ok: false, code: 'identity_verifier_failed' }
  } catch {
    return { ok: false, code: 'identity_verifier_failed' }
  }
  return { ok: true }
}

function verifyRetryFinalOutputContract(
  req: IncomingMessage,
  billingMode: string,
): { ok: true } | { ok: false; status: number; code: string; message: string } {
  const retryAttempt = readHeader(req, 'x-cc-retry-attempt')
  if (!retryAttempt || retryAttempt === '0') return { ok: true }

  const finalOutputReentered = readBooleanHeader(req, 'x-cc-retry-final-output-reentered')
  const previousBillingMode = readHeader(req, 'x-cc-retry-previous-billing-cch-mode')
  if (previousBillingMode && previousBillingMode !== billingMode) {
    return {
      ok: false,
      status: 409,
      code: 'retry_billing_mode_changed',
      message: 'Retry billing/CCH mode changed; refusing silent downgrade or unsigned fallback',
    }
  }

  if (readBooleanHeader(req, 'x-cc-retry-body-mutated') && !finalOutputReentered) {
    return {
      ok: false,
      status: 409,
      code: 'retry_body_mutation_without_reentry',
      message: 'Body-mutating retry must re-enter final-output pipeline',
    }
  }

  if (readBooleanHeader(req, 'x-cc-retry-header-policy-changed') && !finalOutputReentered) {
    return {
      ok: false,
      status: 409,
      code: 'retry_policy_changed_without_reentry',
      message: 'Retry with changed header policy or signing gates must re-enter final-output pipeline',
    }
  }

  return { ok: true }
}

function readBooleanHeader(req: IncomingMessage, name: string): boolean {
  const value = readHeader(req, name)
  return value === '1' || value?.toLowerCase() === 'true'
}

function authenticateForMode(req: IncomingMessage, config: Config): string | null {
  return config.mode === 'sub2api' ? authenticateGateway(req) : authenticate(req)
}

function parseAccountContext(req: IncomingMessage, config: Config): { context: AccountContext } | { status: number; code: string; error: string } {
  const provider = readHeader(req, 'x-cc-provider')
  if (!provider) {
    return { status: 400, code: 'missing_provider', error: 'Missing x-cc-provider' }
  }
  if (provider !== 'anthropic') {
    return { status: 403, code: 'unsupported_provider', error: `Unsupported provider: ${provider}` }
  }
  if (!config.providers.anthropic) {
    return { status: 403, code: 'provider_disabled', error: 'Provider disabled: anthropic' }
  }

  const tokenType = readHeader(req, 'x-cc-token-type')
  if (!tokenType) {
    return { status: 400, code: 'missing_token_type', error: 'Missing x-cc-token-type' }
  }
  if (!['oauth', 'apikey'].includes(tokenType)) {
    return { status: 400, code: 'unsupported_token_type', error: `Unsupported x-cc-token-type: ${tokenType}` }
  }
  const normalizedTokenType = tokenType as 'oauth' | 'apikey'
  if (normalizedTokenType === 'oauth' && !readHeader(req, 'authorization')) {
    return { status: 400, code: 'missing_authorization', error: 'Missing authorization for oauth token type' }
  }
  if (normalizedTokenType === 'apikey' && !readHeader(req, 'x-api-key')) {
    return { status: 400, code: 'missing_api_key', error: 'Missing x-api-key for apikey token type' }
  }

  const accountId = readHeader(req, 'x-cc-account-id')
  if (!accountId) {
    return { status: 400, code: 'missing_account_id', error: 'Missing x-cc-account-id' }
  }

  const egressBucket = readHeader(req, 'x-cc-egress-bucket')
  if (!egressBucket) {
    return { status: 400, code: 'missing_egress_bucket', error: 'Missing x-cc-egress-bucket' }
  }

  const policyVersion = readHeader(req, 'x-cc-policy-version')
  if (!policyVersion) {
    return { status: 400, code: 'missing_policy_version', error: 'Missing x-cc-policy-version' }
  }
  if (policyVersion !== config.env.version) {
    return { status: 403, code: 'policy_version_mismatch', error: `Policy version mismatch: ${policyVersion}` }
  }

  return {
    context: {
      provider,
      accountId,
      tokenType: normalizedTokenType,
      accountEmail: readHeader(req, 'x-cc-account-email'),
      accountUuid: readHeader(req, 'x-cc-account-uuid'),
      organizationUuid: readHeader(req, 'x-cc-organization-uuid'),
      egressBucket,
      policyVersion,
    },
  }
}

function readHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  if (Array.isArray(value)) return value[0]
  return value
}

type RequestTarget = {
  path: string
  pathname: string
  search: string
}

function normalizeRequestTarget(reqUrl: string): RequestTarget {
  const parsed = new URL(reqUrl, 'http://cc-gateway.local')
  return {
    path: `${parsed.pathname}${parsed.search}`,
    pathname: parsed.pathname,
    search: parsed.search,
  }
}

function buildFixedUpstreamUrl(target: RequestTarget, upstream: URL): URL {
  const upstreamUrl = new URL(upstream.toString())
  upstreamUrl.pathname = target.pathname
  upstreamUrl.search = target.search
  return upstreamUrl
}

async function readRequestBody(req: IncomingMessage, maxBytes?: number): Promise<{ body: Buffer } | { error: 'body_too_large' }> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    total += buffer.length
    if (maxBytes !== undefined && total > maxBytes) {
      for await (const _ of req) {
        // Drain remaining bytes so the client receives the control-plane response.
      }
      return { error: 'body_too_large' }
    }
    chunks.push(buffer)
  }
  return { body: Buffer.concat(chunks) }
}

async function drainRequestWithinLimit(req: IncomingMessage, maxBytes: number, res: ServerResponse): Promise<void> {
  const result = await readRequestBody(req, maxBytes)
  if ('error' in result) {
    writeControlPlaneError(res, 413, 'body_too_large', 'Shared-pool request body exceeds configured cap')
  }
}

/**
 * Build a sample payload showing what the rewriter produces.
 * Used by /_verify endpoint for admin validation.
 */
function buildVerificationPayload(config: Config) {
  // Simulate a /v1/messages request body
  const sampleInput = {
    metadata: {
      user_id: JSON.stringify({
        device_id: 'REAL_DEVICE_ID_FROM_CLIENT_abc123',
        account_uuid: 'shared-account-uuid',
        session_id: 'session-xxx',
      }),
    },
    system: [
      {
        type: 'text',
        text: `x-anthropic-billing-header: cc_version=${config.env.version}.a1b;`,
      },
      {
        type: 'text',
        text: `Here is useful information about the environment:\n<env>\nWorking directory: /home/bob/myproject\nPlatform: linux\nShell: bash\nOS Version: Linux 6.5.0-generic\n</env>`,
      },
    ],
    messages: [{ role: 'user', content: 'hello' }],
  }

  const rewritten = JSON.parse(
    rewriteBody(Buffer.from(JSON.stringify(sampleInput)), '/v1/messages', config).toString('utf-8'),
  )

  return {
    _info: 'This shows how the gateway rewrites a sample request',
    before: {
      'metadata.user_id': JSON.parse(sampleInput.metadata.user_id),
      billing_header: sampleInput.system[0].text,
      system_prompt_env: sampleInput.system[1].text,
      system_block_count: sampleInput.system.length,
    },
    after: {
      'metadata.user_id': JSON.parse(rewritten.metadata.user_id),
      billing_header: '(stripped)',
      system_prompt_env: rewritten.system[0]?.text ?? '(empty)',
      system_block_count: rewritten.system.length,
    },
  }
}
