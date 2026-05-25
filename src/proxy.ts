import { createServer as createHttpsServer, type ServerOptions } from 'https'
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'http'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { request as httpsRequest } from 'https'
import { URL } from 'url'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'zlib'
import type { Config } from './config.js'
import { authenticate, authenticateGateway, initAuth } from './auth.js'
import { getAccessToken } from './oauth.js'
import { rewriteBody, rewriteHeaders } from './rewriter.js'
import { audit, log } from './logger.js'
import { getProxyAgent } from './proxy-agent.js'
import {
  canonicalClaudeCodeSessionId,
  accountIdentityRef,
  canonicalPersonaHeaders,
  getSharedPoolMaxBodyBytes,
  normalizeSharedPoolSessionId,
  resolveAccountIdentity,
  resolveEgressBucket,
  resolveSharedPoolPersonaDecision,
  runSigningPipeline,
  selectSharedPoolRoute,
  validateSharedPoolPersonaHeaderSchema,
  verifySignedCCH,
  type AccountIdentityRecord,
  type EgressBucketResolution,
  type SharedPoolPersonaRoute,
} from './policy.js'
import { redactRequestPath, redactSensitiveText } from './redaction.js'
import { evaluateUpstreamSafety } from './upstream-safety.js'
import { evaluateCanaryCostEnvelope } from './canary-cost-gate.js'

const TRUSTED_PERSONA_HEADER = 'x-sub2api-persona-trusted'

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

  const listenHost = config.server.host
  server.listen(config.server.port, listenHost, () => {
    const address = server.address()
    const boundHost = typeof address === 'object' && address ? address.address : '0.0.0.0'
    const boundPort = typeof address === 'object' && address ? address.port : config.server.port
    log('info', `CC Gateway listening on ${useTls ? 'https' : 'http'}://${boundHost}:${boundPort}`)
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

function rawCaptureDir(): string | null {
  const dir = process.env.CC_GATEWAY_RAW_CAPTURE_DIR
  return dir && dir.trim() ? dir.trim() : null
}

function writeRawCaptureFile(name: string, payload: unknown) {
  const dir = rawCaptureDir()
  if (!dir) return
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const file = `${dir}/${name}`
  writeFileSync(file, JSON.stringify(payload, null, 2), { mode: 0o600 })
  chmodSync(file, 0o600)
}

function rawCaptureBodyLengthBucket(length: number): string {
  if (length <= 0) return '0'
  if (length <= 256) return '1-256'
  if (length <= 1024) return '257-1024'
  if (length <= 4096) return '1025-4096'
  if (length <= 16384) return '4097-16384'
  return '16385+'
}

function safeHeaderNames(headers: Record<string, string | string[] | undefined>): string[] {
  return Object.keys(headers)
    .map((key) => key.toLowerCase())
    .sort()
}

function safeSchemaSummaryFromBuffer(body: Buffer): unknown {
  const text = body.toString('utf-8')
  try {
    return safeSchemaSummary(JSON.parse(text))
  } catch {
    return { type: 'non_json' }
  }
}

function safeSchemaSummary(value: unknown, depth = 0): unknown {
  if (depth >= 2) {
    if (Array.isArray(value)) return { type: 'array' }
    if (value && typeof value === 'object') return { type: 'object' }
    return { type: value === null ? 'null' : typeof value }
  }
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      item_schema: value.length > 0 ? safeSchemaSummary(value[0], depth + 1) : null,
    }
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    const fields: Record<string, unknown> = {}
    for (const key of keys.slice(0, 12)) {
      fields[key] = safeSchemaSummary(record[key], depth + 1)
    }
    return {
      type: 'object',
      keys,
      fields,
    }
  }
  return { type: value === null ? 'null' : typeof value }
}

function safeQueryKeys(search: string): string[] {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return Array.from(new Set(Array.from(params.keys()))).sort()
}

function safeVerifierSummary(result: unknown): unknown {
  if (!result || typeof result !== 'object') return { ok: false, code: 'unavailable' }
  const typed = result as Record<string, unknown>
  return typed.ok === true
    ? { ok: true }
    : { ok: false, code: typeof typed.code === 'string' ? typed.code : 'unknown' }
}

function safeSensitiveHeaderPresence(headers: Record<string, string | string[] | undefined>) {
  return {
    authorization: headers.authorization !== undefined,
    x_api_key: headers['x-api-key'] !== undefined,
    x_claude_code_session_id: headers['X-Claude-Code-Session-Id'] !== undefined,
  }
}

function rawResponseCapturePayload(status: number, responseHeaders: Record<string, string | string[] | undefined>, responseBody: Buffer) {
  const payload: Record<string, unknown> = {
    status_code: status,
    header_names: safeHeaderNames(responseHeaders),
    body_length: responseBody.length,
    body_length_bucket: rawCaptureBodyLengthBucket(responseBody.length),
    body_omitted_reason: 'raw_upstream_response_forbidden',
    digest_omitted_reason: 'plain_body_digest_forbidden',
  }
  const encoding = String(responseHeaders['content-encoding'] || responseHeaders['Content-Encoding'] || '').toLowerCase()
  payload.body_encoding = encoding || 'identity'
  try {
    let decoded: Buffer | null = null
    if (encoding.includes('gzip')) decoded = gunzipSync(responseBody)
    else if (encoding.includes('br')) decoded = brotliDecompressSync(responseBody)
    else if (encoding.includes('deflate')) decoded = inflateSync(responseBody)
    else if (!encoding) decoded = responseBody
    if (decoded) {
      payload.decoded_body_encoding = encoding || 'identity'
      payload.decoded_schema_summary = safeSchemaSummaryFromBuffer(decoded)
      payload.decoded_body_omitted_reason = 'raw_decoded_response_forbidden'
    }
  } catch (err) {
    payload.decoded_body_error = err instanceof Error ? err.name : 'DecodeError'
  }
  return payload
}

function proxyAgentCacheKey(account: AccountContext, upstreamUrl: URL, egress: EgressBucketResolution): string {
  const parts = [
    account.provider,
    account.accountId || '-',
    egress.bucketId,
    egress.proxyIdentityRef,
    upstreamUrl.protocol,
    upstreamUrl.host,
    upstreamUrl.pathname || '/',
  ]
  return parts.join('|')
}

type AccountContext = {
  provider: string
  accountId?: string
  tokenType: 'oauth' | 'apikey'
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

  if (config.mode === 'sub2api') {
    const upstreamSafety = evaluateUpstreamSafety(config, method, target.pathname)
    if (!upstreamSafety.ok) {
      writeControlPlaneError(res, upstreamSafety.status, upstreamSafety.code, 'Upstream is not allowed for this CC Gateway preflight/canary mode')
      return
    }
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
  const trustedPersonaClient = isTrustedPersonaClient(req)

  let accountContext: AccountContext | null = null
  let accountIdentity: AccountIdentityRecord | null = null
  let egress: EgressBucketResolution | null = null
  let personaDecision: ReturnType<typeof resolveSharedPoolPersonaDecision> | null = null
  let oauthToken: string | null = null
  let routePolicy: ReturnType<typeof selectSharedPoolRoute> | null = null
  const sharedPoolRoute: SharedPoolPersonaRoute = target.pathname === '/v1/messages/count_tokens' ? 'count_tokens' : 'messages'

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

  const bodyResult = await readRequestBody(req, config.mode === 'sub2api' ? getSharedPoolMaxBodyBytes(config) : undefined)
  if ('error' in bodyResult) {
    writeControlPlaneError(res, 413, 'body_too_large', 'Shared-pool request body exceeds configured cap')
    return
  }
  let body = bodyResult.body
  let rawSigningOutputBody = ''
  let rawCCH: string | null = null
  let rawVerifierResult: unknown = null

  if (config.mode === 'sub2api' && routePolicy?.action === 'suppress') {
    const controlPlaneCheck = verifySuppressedControlPlaneRequest(
      req,
      body,
      config,
      accountIdentity!,
      accountContext!.policyVersion || String(config.env.version),
      trustedPersonaClient,
    )
    if (!controlPlaneCheck.ok) {
      writeControlPlaneError(res, controlPlaneCheck.status, controlPlaneCheck.code, controlPlaneCheck.message)
      return
    }
    res.writeHead(204, { 'X-CC-Gateway-Event-Policy': 'suppress' })
    res.end()
    if (config.logging.audit) audit(clientName, method, safePath, 204)
    return
  }

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

  if (config.mode === 'sub2api') {
    const requestedModel = parsedBody && typeof (parsedBody as any).model === 'string' ? String((parsedBody as any).model) : ''
    personaDecision = resolveSharedPoolPersonaDecision(
      config,
      accountIdentity,
      accountContext!.policyVersion || String(config.env.version),
      requestedModel,
      trustedPersonaClient,
      sharedPoolRoute,
    )
    if (personaDecision.status.startsWith('quarantine') || personaDecision.status.startsWith('reject')) {
      writeControlPlaneError(res, 403, `persona_${personaDecision.status}`, 'Persona policy rejected request')
      return
    }
  }

  if (config.mode === 'sub2api') {
    const canaryCostEnvelope = evaluateCanaryCostEnvelope(config, body)
    if (!canaryCostEnvelope.ok) {
      writeControlPlaneError(res, canaryCostEnvelope.status, canaryCostEnvelope.code, 'Canary request exceeds the configured cost envelope')
      return
    }
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
      ? {
          upstreamAuth: accountContext!.tokenType,
          stripGatewayControlHeaders: true,
          sharedPool: true,
          route: target.pathname,
          accountIdentity: accountIdentity ?? undefined,
          requestedPolicyVersion: accountContext!.policyVersion,
          requestedModel: parsedBody && typeof (parsedBody as any).model === 'string' ? String((parsedBody as any).model) : '',
          trustedClient: personaDecision?.trustedClient ?? false,
          sessionId,
        }
      : {},
  )

  if (sessionId && config.mode === 'sub2api') {
    rewrittenHeaders['X-Claude-Code-Session-Id'] = sessionId
  }

  const signingInputBody = body.toString('utf-8')
  if (config.mode === 'sub2api' && billingMode === 'sign') {
    const signing = runSigningPipeline(config, body, {
      cliVersion: personaDecision?.effectiveVersion || String(config.env.version),
    })
    if (!signing.ok) {
      writeControlPlaneError(res, 403, signing.code, 'Manual signing mode is disabled or signer verification failed')
      return
    }
    body = signing.body
    rawSigningOutputBody = body.toString('utf-8')
    rawCCH = signing.cch
    const verifier = verifySharedPoolFinalOutput(config, rewrittenHeaders, body, {
      route: sharedPoolRoute,
      sessionId,
      accountIdentity: accountIdentity ?? undefined,
      expectedVersion: personaDecision?.effectiveVersion,
      expectedBeta: personaDecision?.betaHeader,
      billingMode: 'sign',
    })
    rawVerifierResult = verifier
    if (!verifier.ok) {
      writeControlPlaneError(res, 400, verifier.code, 'Shared-pool signing verifier failed')
      return
    }
  } else if (config.mode === 'sub2api') {
    const verifier = verifySharedPoolFinalOutput(config, rewrittenHeaders, body, {
      route: sharedPoolRoute,
      sessionId,
      accountIdentity: accountIdentity ?? undefined,
      expectedVersion: personaDecision?.effectiveVersion,
      expectedBeta: personaDecision?.betaHeader,
      billingMode: 'strip',
    })
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
  const forwardHeaders = {
    ...rewrittenHeaders,
    host: upstream.host,
    'content-length': String(body.length),
  }
  writeRawCaptureFile('01_final_upstream_request.json', {
    method,
    path: upstreamUrl.pathname,
    query_keys: safeQueryKeys(upstreamUrl.search),
    header_names: safeHeaderNames(forwardHeaders),
    sensitive_header_presence: safeSensitiveHeaderPresence(forwardHeaders),
    body_length: body.length,
    body_length_bucket: rawCaptureBodyLengthBucket(body.length),
    schema_summary: safeSchemaSummaryFromBuffer(body),
    body_omitted_reason: 'raw_upstream_request_forbidden',
    digest_omitted_reason: 'plain_body_digest_forbidden',
  })
  writeRawCaptureFile('03_final_output.json', {
    billing_cch_mode: billingMode,
    body_length: body.length,
    body_length_bucket: rawCaptureBodyLengthBucket(body.length),
    schema_summary: safeSchemaSummaryFromBuffer(body),
    body_omitted_reason: 'raw_final_output_forbidden',
    digest_omitted_reason: 'plain_body_digest_forbidden',
    signing_input_length: Buffer.byteLength(signingInputBody),
    signing_output_length: rawSigningOutputBody ? Buffer.byteLength(rawSigningOutputBody) : body.length,
    cch_present: rawCCH !== null,
    verifier_result: safeVerifierSummary(rawVerifierResult),
    post_sign_mutation_check: {
      final_body_length: body.length,
      signing_output_length: rawSigningOutputBody ? Buffer.byteLength(rawSigningOutputBody) : body.length,
      pass: !rawSigningOutputBody || body.toString('utf-8') === rawSigningOutputBody,
    },
    fallback_check: {
      sign_to_strip_fallback: false,
      direct_fallback: false,
    },
  })

  const requestFn = upstreamUrl.protocol === 'http:' ? httpRequest : httpsRequest
  const proxyReq = requestFn(
    upstreamUrl,
    {
      method,
      headers: forwardHeaders,
      ...(agent && { agent }),
    },
    (proxyRes) => {
      const status = proxyRes.statusCode || 502

      const responseHeaders = { ...proxyRes.headers }
      delete responseHeaders['transfer-encoding']

      if (rawCaptureDir()) {
        const chunks: Buffer[] = []
        proxyRes.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        proxyRes.on('end', () => {
          const responseBody = Buffer.concat(chunks)
          writeRawCaptureFile('02_upstream_response.json', rawResponseCapturePayload(status, responseHeaders, responseBody))
          res.writeHead(status, responseHeaders)
          res.end(responseBody)
          if (config.logging.audit) audit(clientName, method, safePath, status)
        })
      } else {
        res.writeHead(status, responseHeaders)
        // Stream response directly (SSE for Claude responses)
        proxyRes.pipe(res)
        if (config.logging.audit) audit(clientName, method, safePath, status)
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


export function verifySharedPoolFinalOutput(
  config: Config,
  headers: Record<string, string>,
  body: Buffer,
  options: {
    route: SharedPoolPersonaRoute
    sessionId?: string
    accountIdentity?: AccountIdentityRecord
    expectedVersion?: string
    expectedBeta?: string
    billingMode: 'strip' | 'sign'
  },
): { ok: true } | { ok: false; code: string } {
  try {
    validateSharedPoolPersonaHeaderSchema(headers, options.route, options.sessionId)
  } catch {
    return { ok: false, code: 'persona_header_mismatch' }
  }
  if (options.expectedVersion && userAgentVersion(headers['User-Agent']) !== options.expectedVersion) {
    return { ok: false, code: 'persona_header_mismatch' }
  }
  if (options.expectedBeta && headers['anthropic-beta'] !== options.expectedBeta) {
    return { ok: false, code: 'persona_header_mismatch' }
  }
  if (options.sessionId && headers['X-Claude-Code-Session-Id'] !== options.sessionId) {
    return { ok: false, code: 'session_binding_failed' }
  }
  const headerKeys = Object.keys(headers).map((key) => key.toLowerCase())
  const bodyText = body.toString('utf-8')
  if (options.billingMode === 'sign') {
    if (headerKeys.includes('x-anthropic-billing-header')) return { ok: false, code: 'persona_cch_version_mismatch' }
    const billingVersion = extractBillingHeaderVersion(bodyText)
    if (!billingVersion) return { ok: false, code: 'persona_cch_version_mismatch' }
    if (options.expectedVersion && billingVersion !== options.expectedVersion) {
      return { ok: false, code: 'persona_cch_version_mismatch' }
    }
    const verifier = verifySignedCCH(body)
    if (!verifier.ok) return { ok: false, code: verifier.code }
  } else {
    if (headerKeys.includes('x-anthropic-billing-header')) return { ok: false, code: 'strip_verifier_failed' }
    if (/x-anthropic-billing-header/i.test(bodyText) || /\bcch=/i.test(bodyText)) {
      return { ok: false, code: 'strip_verifier_failed' }
    }
  }
  try {
    const parsed = JSON.parse(bodyText)
    const userIdRaw = parsed?.metadata?.user_id
    if (typeof userIdRaw !== 'string') return { ok: false, code: 'session_binding_failed' }
    const userId = JSON.parse(userIdRaw)
    const allowed = ['account_uuid', 'device_id', 'session_id']
    if (!allowed.every((key) => typeof userId[key] === 'string')) return { ok: false, code: 'session_binding_failed' }
    if (Object.keys(userId).some((key) => !allowed.includes(key))) return { ok: false, code: 'identity_verifier_failed' }
    if (options.sessionId && userId.session_id !== options.sessionId) return { ok: false, code: 'session_binding_failed' }
    if (options.accountIdentity) {
      if (userId.device_id !== options.accountIdentity.device_id) return { ok: false, code: 'identity_verifier_failed' }
      if (userId.account_uuid !== accountIdentityRef(options.accountIdentity)) return { ok: false, code: 'identity_verifier_failed' }
    }
  } catch {
    return { ok: false, code: 'identity_verifier_failed' }
  }
  return { ok: true }
}

function verifySuppressedControlPlaneRequest(
  req: IncomingMessage,
  body: Buffer,
  config: Config,
  accountIdentity: AccountIdentityRecord,
  requestedPolicyVersion: string,
  trustedPersonaClient: boolean,
): { ok: true } | { ok: false; status: number; code: string; message: string } {
  const rawSessionId = readHeader(req, 'x-claude-code-session-id')
  const sessionId = canonicalClaudeCodeSessionId(rawSessionId)
  if (rawSessionId && !sessionId) {
    return {
      ok: false,
      status: 403,
      code: 'control_plane_persona_mismatch',
      message: 'Control-plane session header is not a canonical Claude Code UUID',
    }
  }

  const decision = resolveSharedPoolPersonaDecision(
    config,
    accountIdentity,
    requestedPolicyVersion,
    '',
    trustedPersonaClient,
    'control_plane',
  )
  if (decision.status.startsWith('quarantine') || decision.status.startsWith('reject')) {
    return {
      ok: false,
      status: 403,
      code: `persona_${decision.status}`,
      message: 'Control-plane persona policy rejected request',
    }
  }

  if (hasControlPlaneBillingMarker(req.headers, body)) {
    return {
      ok: false,
      status: 400,
      code: 'control_plane_cch_marker_forbidden',
      message: 'Control-plane routes must not carry messages billing/CCH material',
    }
  }

  const expectedHeaders = canonicalPersonaHeaders(config, 'control_plane', sessionId, {
    identity: accountIdentity,
    requestedPolicyVersion,
    trustedClient: decision.trustedClient,
  })
  if (findControlPlanePersonaMismatch(req.headers, expectedHeaders)) {
    return {
      ok: false,
      status: 403,
      code: 'control_plane_persona_mismatch',
      message: 'Control-plane persona headers do not match the resolver decision',
    }
  }
  return { ok: true }
}

function isTrustedPersonaClient(req: IncomingMessage): boolean {
  const marker = readHeader(req, TRUSTED_PERSONA_HEADER)
  if (marker !== '1' && marker?.toLowerCase() !== 'true') return false
  const remote = (req.socket?.remoteAddress || '').trim()
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
}

function userAgentVersion(userAgent: string | undefined): string | null {
  const match = String(userAgent || '').match(/^claude-cli\/(\d+\.\d+\.\d+) \(external, sdk-cli\)$/)
  return match ? match[1] : null
}

function extractBillingHeaderVersion(bodyText: string): string | null {
  const match = bodyText.match(/x-anthropic-billing-header:[^"\n]*cc_version=(\d+\.\d+\.\d+)\.[a-f0-9]{3};/i)
  return match ? match[1] : null
}

function hasControlPlaneBillingMarker(
  headers: IncomingMessage['headers'],
  body: Buffer,
): boolean {
  if (readHeaderValue(headers, 'x-anthropic-billing-header')) return true
  const text = body.toString('utf-8')
  return /x-anthropic-billing-header/i.test(text) || /\bcch=[a-f0-9]{5}\b/i.test(text)
}

function findControlPlanePersonaMismatch(
  headers: IncomingMessage['headers'],
  expectedHeaders: Record<string, string>,
): string | null {
  const personaHeaderNames = new Set([
    'anthropic-beta',
    'anthropic-dangerous-direct-browser-access',
    'anthropic-version',
    'user-agent',
    'x-app',
    'x-claude-code-session-id',
    'x-stainless-arch',
    'x-stainless-lang',
    'x-stainless-os',
    'x-stainless-package-version',
    'x-stainless-retry-count',
    'x-stainless-runtime',
    'x-stainless-runtime-version',
    'x-stainless-timeout',
  ])
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    const normalized = key.toLowerCase()
    if (!personaHeaderNames.has(normalized) && !normalized.startsWith('x-stainless-')) continue
    const expectedKey = Object.keys(expectedHeaders).find((candidate) => candidate.toLowerCase() === normalized)
    if (!expectedKey) return key
    const actual = Array.isArray(value) ? value.join(', ') : value
    if (actual !== expectedHeaders[expectedKey]) return key
  }
  return null
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

  return {
    context: {
      provider,
      accountId,
      tokenType: normalizedTokenType,
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

function readHeaderValue(
  headers: IncomingMessage['headers'],
  name: string,
): string | undefined {
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target || value === undefined) continue
    return Array.isArray(value) ? value.join(', ') : value
  }
  return undefined
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
