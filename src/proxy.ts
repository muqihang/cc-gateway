import { createServer as createHttpsServer, type ServerOptions } from 'https'
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'http'
import { readFileSync } from 'fs'
import { request as httpsRequest } from 'https'
import { URL } from 'url'
import type { Config } from './config.js'
import { authenticate, authenticateGateway, initAuth } from './auth.js'
import { getAccessToken } from './oauth.js'
import { rewriteBody, rewriteHeaders } from './rewriter.js'
import { audit, log } from './logger.js'
import { getProxyAgent } from './proxy-agent.js'

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
    log('info', `Upstream: ${config.upstream.url}`)
    log('info', `Canonical device_id: ${config.identity.device_id.slice(0, 8)}...`)
    log('info', `Authorized clients: ${config.auth.tokens.map(t => t.name).join(', ')}`)
  })

  return server
}

type AccountContext = {
  provider: string
  accountId?: string
  tokenType: 'oauth' | 'apikey'
  accountEmail?: string
  accountUuid?: string
  organizationUuid?: string
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
  const clientIp = req.socket.remoteAddress || 'unknown'

  log('info', `← ${method} ${path} from ${clientIp}`)

  // Health check - no auth required
  if (path === '/_health') {
    const oauthOk = config.mode === 'sub2api' ? true : !!getAccessToken()
    const status = oauthOk ? 200 : 503
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: oauthOk ? 'ok' : 'degraded',
      mode: config.mode,
      oauth: config.mode === 'sub2api' ? 'not_used' : (oauthOk ? 'valid' : 'expired/refreshing'),
      canonical_device: config.identity.device_id.slice(0, 8) + '...',
      canonical_platform: config.env.platform,
      upstream: config.upstream.url,
      clients: config.auth.tokens.map(t => t.name),
    }))
    return
  }

  // Dry-run verification - shows what would be rewritten (auth required)
  if (path === '/_verify') {
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
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: config.mode === 'sub2api' ? 'Unauthorized - provide gateway token via x-cc-gateway-token header' : 'Unauthorized - provide client token via x-api-key header' }))
    log('warn', `Unauthorized request: ${method} ${path}`)
    return
  }

  log('info', `Client "${clientName}" → ${method} ${path}`)

  let accountContext: AccountContext | null = null
  let oauthToken: string | null = null

  if (config.mode === 'sub2api') {
    const parsed = parseAccountContext(req, config)
    if ('error' in parsed) {
      res.writeHead(parsed.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: parsed.error }))
      return
    }
    accountContext = parsed.context
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

  // Collect request body
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  let body = Buffer.concat(chunks)

  // Rewrite identity fields in body
  if (body.length > 0) {
    try {
      body = rewriteBody(body, path, config) as Buffer<ArrayBuffer>
    } catch (err) {
      log('error', `Body rewrite failed for ${path}: ${err}`)
    }
  }

  // Rewrite headers (strips client auth, normalizes identity headers)
  const rewrittenHeaders = rewriteHeaders(
    req.headers as Record<string, string | string[] | undefined>,
    config,
    config.mode === 'sub2api'
      ? { upstreamAuth: accountContext!.tokenType, stripGatewayControlHeaders: true }
      : {},
  )

  if (oauthToken) {
    // Inject the real OAuth token via x-api-key (Anthropic uses this header for both
    // API keys and OAuth tokens, distinguished by prefix: sk-ant-api03- vs sk-ant-oat01-)
    rewrittenHeaders['x-api-key'] = oauthToken
  }

  // Forward to upstream
  const upstreamUrl = buildFixedUpstreamUrl(target, upstream)

  const agent = getProxyAgent()
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
        audit(clientName, method, path, status)
      }
    },
  )

  proxyReq.on('error', (err) => {
    log('error', `Upstream error: ${err.message}`)
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Bad gateway', detail: err.message }))
    }
    if (config.logging.audit) {
      audit(clientName, method, path, 502)
    }
  })

  proxyReq.write(body)
  proxyReq.end()
}

function authenticateForMode(req: IncomingMessage, config: Config): string | null {
  return config.mode === 'sub2api' ? authenticateGateway(req) : authenticate(req)
}

function parseAccountContext(req: IncomingMessage, config: Config): { context: AccountContext } | { status: number; error: string } {
  const provider = readHeader(req, 'x-cc-provider')
  if (!provider) {
    return { status: 400, error: 'Missing x-cc-provider' }
  }
  if (provider !== 'anthropic') {
    return { status: 403, error: `Unsupported provider: ${provider}` }
  }
  if (!config.providers.anthropic) {
    return { status: 403, error: 'Provider disabled: anthropic' }
  }

  const tokenType = readHeader(req, 'x-cc-token-type')
  if (!tokenType) {
    return { status: 400, error: 'Missing x-cc-token-type' }
  }
  if (!['oauth', 'apikey'].includes(tokenType)) {
    return { status: 400, error: `Unsupported x-cc-token-type: ${tokenType}` }
  }
  const normalizedTokenType = tokenType as 'oauth' | 'apikey'
  if (normalizedTokenType === 'oauth' && !readHeader(req, 'authorization')) {
    return { status: 400, error: 'Missing authorization for oauth token type' }
  }
  if (normalizedTokenType === 'apikey' && !readHeader(req, 'x-api-key')) {
    return { status: 400, error: 'Missing x-api-key for apikey token type' }
  }

  return {
    context: {
      provider,
      accountId: readHeader(req, 'x-cc-account-id'),
      tokenType: normalizedTokenType,
      accountEmail: readHeader(req, 'x-cc-account-email'),
      accountUuid: readHeader(req, 'x-cc-account-uuid'),
      organizationUuid: readHeader(req, 'x-cc-organization-uuid'),
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
        text: `x-anthropic-billing-header: cc_version=2.1.81.a1b; cc_entrypoint=cli;`,
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
