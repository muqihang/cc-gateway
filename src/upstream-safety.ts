import type { Config } from './config.js'

export type UpstreamSafetyResult =
  | { ok: true }
  | { ok: false; status: number; code: string }

const REAL_ANTHROPIC_HOSTS = new Set([
  'api.anthropic.com',
  'platform.claude.com',
  'claude.ai',
])

export function evaluateUpstreamSafety(config: Config, method: string, pathname: string): UpstreamSafetyResult {
  if (config.mode !== 'sub2api') return { ok: true }

  const sharedPool = (config as any).shared_pool || {}
  const upstreamMode = String(sharedPool.upstream_mode || 'preflight')
  const upstream = parseUpstream(config.upstream?.url)
  if (!upstream) return { ok: false, status: 403, code: 'invalid_upstream_url' }

  const isRealAnthropic = isRealAnthropicHost(upstream.hostname)
  const isAWSClaudePlatform = isAWSClaudePlatformHost(upstream.hostname)
  if (upstreamMode === 'real-canary') {
    if (isAWSClaudePlatform) {
      return method === 'POST' && pathname === '/v1/messages'
        ? { ok: true }
        : { ok: false, status: 403, code: 'real_aws_claude_platform_route_forbidden' }
    }
    if (!isRealAnthropic) {
      return isLocalOnlyHost(upstream.hostname)
        ? { ok: true }
        : { ok: false, status: 403, code: 'real-canary_nonlocal_upstream_forbidden' }
    }
    if (method !== 'POST' || pathname !== '/v1/messages') {
      return { ok: false, status: 403, code: 'real_anthropic_canary_route_forbidden' }
    }
    if (process.env.ALLOW_REAL_ANTHROPIC_CANARY !== '1' || sharedPool.real_canary_user_approved !== true) {
      return { ok: false, status: 403, code: 'real_anthropic_canary_not_allowed' }
    }
    return { ok: true }
  }

  if (upstreamMode === 'production') {
    if (isAWSClaudePlatform) {
      return method === 'POST' && pathname === '/v1/messages'
        ? { ok: true }
        : { ok: false, status: 403, code: 'real_aws_claude_platform_route_forbidden' }
    }
    if (!isRealAnthropic) {
      return isLocalOnlyHost(upstream.hostname)
        ? { ok: true }
        : { ok: false, status: 403, code: 'production_nonlocal_upstream_forbidden' }
    }
    if (process.env.ALLOW_REAL_ANTHROPIC_PRODUCTION !== '1' || sharedPool.production_upstream_enabled !== true) {
      return { ok: false, status: 403, code: 'real_anthropic_production_not_allowed' }
    }
    return { ok: true }
  }

  // Preflight/dry-run/local-capture modes must never depend on later identity,
  // session, bucket, or signer gates to stop real egress.
  if (isRealAnthropic) {
    return { ok: false, status: 403, code: 'preflight_real_upstream_forbidden' }
  }
  if (!isLocalOnlyHost(upstream.hostname)) {
    return { ok: false, status: 403, code: 'preflight_nonlocal_upstream_forbidden' }
  }
  return { ok: true }
}

function parseUpstream(raw: string | undefined): URL | null {
  try {
    return new URL(String(raw || ''))
  } catch {
    return null
  }
}

function isRealAnthropicHost(hostname: string): boolean {
  return REAL_ANTHROPIC_HOSTS.has(hostname.toLowerCase())
}

function isAWSClaudePlatformHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return /^aws-external-anthropic\.[a-z0-9-]+\.api\.aws$/.test(host)
}

function isLocalOnlyHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0'
}
