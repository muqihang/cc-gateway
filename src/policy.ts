import { createHash, randomUUID } from 'crypto'
import type { Config } from './config.js'

export type SharedPoolRouteKind = 'messages' | 'count_tokens' | 'event_logging_legacy' | 'event_logging_v2'

export type SharedPoolRoutePolicy =
  | { action: 'forward'; kind: 'messages' }
  | { action: 'suppress'; kind: 'event_logging_legacy' | 'event_logging_v2' }
  | { action: 'block'; code: string; status: number }

export type AccountIdentityRecord = {
  device_id: string
  account_uuid_hash: string
  email_hash?: string
  account_hash?: string
  persona_variant: string
  session_policy: 'preserve_downstream_session_id' | 'gateway_generated'
  policy_version: string
}

export type EgressBucketRecord = {
  enabled: boolean
  proxy_url: string
  proxy_identity_hash?: string
  allowed_account_ids?: string[]
}

export type EgressBucketResolution = {
  bucketId: string
  proxyUrl: string
  proxyIdentityHash: string
}

const MESSAGE_BETA = 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advisor-tool-2026-03-01,effort-2025-11-24,extended-cache-ttl-2025-04-11'
const COUNT_TOKENS_BETA = null

export const DEFAULT_SHARED_POOL_MAX_BODY_BYTES = 2 * 1024 * 1024

export function canonicalPersonaHeaders(config: Config, route: 'messages' | 'count_tokens', sessionId?: string): Record<string, string> {
  const version = String(config.env.version)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': `claude-cli/${version} (external, sdk-cli)`,
    'X-Stainless-Arch': String(config.env.arch || 'arm64'),
    'X-Stainless-Lang': 'js',
    'X-Stainless-OS': canonicalStainlessOS(config),
    'X-Stainless-Package-Version': String((config as any).persona?.stainless_package_version || '0.94.0'),
    'X-Stainless-Retry-Count': '0',
    'X-Stainless-Runtime': String(config.env.runtimes || 'node').split(',')[0] || 'node',
    'X-Stainless-Runtime-Version': String(config.env.node_version || 'v24.3.0'),
    'X-Stainless-Timeout': '600',
    'anthropic-dangerous-direct-browser-access': 'true',
    'anthropic-version': '2023-06-01',
    'x-app': 'cli',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
  }
  headers['anthropic-beta'] = route === 'count_tokens'
    ? (COUNT_TOKENS_BETA ?? MESSAGE_BETA)
    : MESSAGE_BETA
  if (sessionId) headers['X-Claude-Code-Session-Id'] = sessionId
  return headers
}

export function selectSharedPoolRoute(method: string, pathname: string, search = ''): SharedPoolRoutePolicy {
  if (method !== 'POST') {
    return { action: 'block', status: 404, code: 'unsupported_route' }
  }
  if (pathname === '/v1/messages') {
    return search === '?beta=true'
      ? { action: 'forward', kind: 'messages' }
      : { action: 'block', status: 404, code: 'unsupported_route' }
  }
  if (pathname === '/v1/messages/count_tokens') {
    return search === '?beta=true'
      ? { action: 'block', status: 403, code: 'count_tokens_deferred' }
      : { action: 'block', status: 404, code: 'unsupported_route' }
  }
  if (pathname === '/api/event_logging/batch') {
    return search === ''
      ? { action: 'suppress', kind: 'event_logging_legacy' }
      : { action: 'block', status: 404, code: 'unsupported_event_logging_route' }
  }
  if (pathname === '/api/event_logging/v2/batch') {
    return search === ''
      ? { action: 'suppress', kind: 'event_logging_v2' }
      : { action: 'block', status: 404, code: 'unsupported_event_logging_route' }
  }
  if (pathname.startsWith('/api/event_logging/')) {
    return { action: 'block', status: 404, code: 'unsupported_event_logging_route' }
  }
  return { action: 'block', status: 404, code: 'unsupported_route' }
}


export type SigningPipelineResult =
  | { ok: false; code: 'signing_mode_disabled' | 'signing_evidence_gates_unapproved' | 'signing_verifier_failed' }
  | { ok: true; body: Buffer }

export function runDisabledSigningPipelineSkeleton(config: Config, body: Buffer): SigningPipelineResult {
  const sharedPool = (config as any).shared_pool || {}
  if (!sharedPool.signing_enabled) return { ok: false, code: 'signing_mode_disabled' }
  if (!sharedPool.signing_evidence_gates_approved) return { ok: false, code: 'signing_evidence_gates_unapproved' }

  // Future approved path must normalize -> serialize -> place cch=00000 -> compute
  // 5-hex CCH -> replace -> verify -> forbid post-sign mutation. Until final
  // design is explicitly approved, the skeleton remains fail-closed here.
  void body
  return { ok: false, code: 'signing_verifier_failed' }
}

export function getSharedPoolMaxBodyBytes(config: Config): number {
  const raw = (config as any).shared_pool?.max_body_bytes
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  return DEFAULT_SHARED_POOL_MAX_BODY_BYTES
}

export function resolveAccountIdentity(config: Config, accountId: string | undefined): AccountIdentityRecord | null {
  if (!accountId) return null
  const identities = (config as any).account_identities as Record<string, AccountIdentityRecord> | undefined
  const identity = identities?.[accountId]
  if (!identity || !identity.device_id || !identity.account_uuid_hash || !identity.persona_variant || !identity.session_policy || !identity.policy_version) {
    return null
  }
  return identity
}

export function resolveEgressBucket(config: Config, bucketId: string | undefined, accountId: string | undefined): EgressBucketResolution | { error: string } {
  if (!bucketId) return { error: 'missing_egress_bucket' }
  const buckets = (config as any).egress_buckets as Record<string, EgressBucketRecord> | undefined
  const bucket = buckets?.[bucketId]
  if (!bucket) return { error: 'unknown_egress_bucket' }
  if (!bucket.enabled) return { error: 'disabled_egress_bucket' }
  if (!bucket.proxy_url || bucket.proxy_url === 'undefined' || bucket.proxy_url === 'null') return { error: 'missing_egress_proxy' }
  try {
    const parsed = new URL(bucket.proxy_url)
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return { error: 'invalid_egress_proxy' }
  } catch {
    return { error: 'invalid_egress_proxy' }
  }
  if (bucket.allowed_account_ids?.length && (!accountId || !bucket.allowed_account_ids.includes(accountId))) {
    return { error: 'egress_bucket_account_denied' }
  }
  return {
    bucketId,
    proxyUrl: bucket.proxy_url,
    proxyIdentityHash: bucket.proxy_identity_hash || `sha256:${createHash('sha256').update(bucket.proxy_url).digest('hex')}`,
  }
}

export function normalizeSharedPoolSessionId(
  body: unknown,
  existingSessionId: string | undefined,
  identity: AccountIdentityRecord,
): string | undefined {
  const obj = typeof body === 'object' && body !== null ? body as any : null
  if (!obj) return undefined
  if (!obj.metadata || typeof obj.metadata !== 'object') obj.metadata = {}
  const raw = obj.metadata.user_id
  let parsedUserId: any = null
  if (typeof raw === 'string') {
    try {
      parsedUserId = JSON.parse(raw)
    } catch {
      parsedUserId = null
    }
  }
  const sessionId = existingSessionId || parsedUserId?.session_id || randomUUID()
  obj.metadata.user_id = JSON.stringify({
    device_id: identity.device_id,
    account_uuid: identity.account_uuid_hash,
    session_id: sessionId,
  })
  return sessionId
}

function canonicalStainlessOS(config: Config): string {
  const platform = String(config.env.platform || '').toLowerCase()
  if (platform === 'darwin') return 'MacOS'
  if (platform === 'linux') return 'Linux'
  if (platform === 'win32' || platform === 'windows') return 'Windows'
  return platform || 'MacOS'
}
