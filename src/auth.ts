import type { IncomingMessage } from 'http'
import type { Config, TokenEntry } from './config.js'
import { canonicalAuthMaterialBytes } from './auth-material.js'

const tokenMap = new Map<string, TokenEntry>()
let gatewayToken: string | null = null

export function initAuth(config: Config) {
  tokenMap.clear()
  gatewayToken = canonicalAuthMaterialBytes(config.auth.gateway_token)?.toString('utf8') ?? null
  for (const entry of config.auth.tokens ?? []) {
    const token = canonicalAuthMaterialBytes(entry.token)?.toString('utf8')
    if (token) tokenMap.set(token, entry)
  }
}

/**
 * Authenticate incoming request by Bearer token.
 * Returns the token entry name (for audit logging) or null if unauthorized.
 */
export function authenticate(req: IncomingMessage): string | null {
  // CC with ANTHROPIC_API_KEY sends x-api-key header
  const apiKey = req.headers['x-api-key']
  if (apiKey && typeof apiKey === 'string') {
    const canonical = canonicalAuthMaterialBytes(apiKey)?.toString('utf8')
    const entry = canonical ? tokenMap.get(canonical) : undefined
    if (entry) return entry.name
  }

  // Fallback: Bearer token in Authorization or Proxy-Authorization
  const authHeader = req.headers['proxy-authorization'] || req.headers['authorization']
  if (!authHeader || typeof authHeader !== 'string') return null

  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) return null

  const canonical = canonicalAuthMaterialBytes(match[1])?.toString('utf8')
  const entry = canonical ? tokenMap.get(canonical) : undefined
  return entry?.name ?? null
}

/**
 * Authenticate cc-gateway control-plane callers.
 *
 * In sub2api mode, x-api-key and authorization belong to the selected
 * upstream account. Only x-cc-gateway-token is accepted here.
 */
export function authenticateGateway(req: IncomingMessage): string | null {
  const token = req.headers['x-cc-gateway-token']
  if (!token || typeof token !== 'string') return null
  const canonical = canonicalAuthMaterialBytes(token)?.toString('utf8')
  if (!canonical) return null

  if (gatewayToken && canonical === gatewayToken) return 'gateway'

  const entry = tokenMap.get(canonical)
  return entry?.name ?? null
}
