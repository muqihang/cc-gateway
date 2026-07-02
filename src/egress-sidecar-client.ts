import { request as httpRequest, type IncomingHttpHeaders } from 'http'
import { request as httpsRequest } from 'https'
import { URL } from 'url'
import { isSafeTLSProfileRef } from './egress-tls-profile.js'

export type EgressSidecarConfig = {
  enabled?: boolean
  endpoint?: string
  control_token?: string
  allowed_target_hosts?: string[]
  allowed_routes?: string[]
  allowed_profile_refs?: string[]
  logical_target_host?: string
  expected_tls_summary_bucket?: string
  mock_messages_response?: {
    enabled?: boolean
    mode?: 'local_smoke' | string
  }
}

export type EgressSidecarControl = {
  profile_ref: string
  egress_bucket: string
  proxy_identity_ref: string
  target_host: string
  target_port: number
  target_scheme: 'https'
  target_path: string
  route: string
  method: string
  expected_tls_summary_bucket: string
}

export type EgressSidecarPrepared = {
  endpoint: URL
  controlToken: string
  control: EgressSidecarControl
  expectedTLSBucket: string
}

export type EgressSidecarResponse = {
  status: number
  headers: IncomingHttpHeaders
  body: Buffer
}

const ALLOWED_SIDECAR_CONFIG_KEYS = new Set([
  'enabled',
  'endpoint',
  'control_token',
  'allowed_target_hosts',
  'allowed_routes',
  'allowed_profile_refs',
  'logical_target_host',
  'expected_tls_summary_bucket',
  'mock_messages_response',
])
const FORBIDDEN_CONTROL_OR_OVERRIDE_KEY = /(?:authorization|x-api-key|cookie|raw[_-]?body|clienthello|cipher|extension|proxy_url|proxy_username|proxy_password|proxy-authorization|x-forwarded|dial_host|dial_override|tls_server_name|server_name|account_uuid)/i

const SAFE_REF = /^[A-Za-z0-9._:-]{1,160}$/

export function egressSidecarEnabled(config: { egress_tls_sidecar?: EgressSidecarConfig }): boolean {
  return config.egress_tls_sidecar?.enabled === true
}

export function validateEgressSidecarConfig(config: {
  mode?: string
  upstream?: { url?: string }
  shared_pool?: { upstream_mode?: string; production_upstream_enabled?: boolean; real_canary_user_approved?: boolean }
  egress_tls_sidecar?: EgressSidecarConfig
}): void {
  const sidecar = config.egress_tls_sidecar
  if (!sidecar) return
  if (sidecar.mock_messages_response?.enabled === true && sidecar.enabled !== true) {
    throw new Error('config: egress_tls_sidecar.mock_messages_response requires egress_tls_sidecar.enabled true')
  }
  if (sidecar.enabled !== true) return
  const endpoint = parseLoopbackEndpoint(sidecar.endpoint)
  if (!endpoint) throw new Error('config: egress_tls_sidecar.endpoint must be loopback http(s) or unix socket endpoint')
  if (!sidecar.control_token || typeof sidecar.control_token !== 'string' || sidecar.control_token.length < 24) {
    throw new Error('config: egress_tls_sidecar.control_token is required')
  }
  for (const [label, values] of [
    ['allowed_target_hosts', sidecar.allowed_target_hosts],
    ['allowed_routes', sidecar.allowed_routes],
    ['allowed_profile_refs', sidecar.allowed_profile_refs],
  ] as const) {
    if (!Array.isArray(values) || values.length === 0) throw new Error(`config: egress_tls_sidecar.${label} must be a non-empty allowlist`)
  }
  for (const ref of sidecar.allowed_profile_refs || []) {
    if (!isSafeTLSProfileRef(ref)) throw new Error('config: egress_tls_sidecar.allowed_profile_refs must contain only safe tls-profile refs')
  }
  for (const value of [...(sidecar.allowed_target_hosts || []), ...(sidecar.allowed_routes || [])]) {
    if (typeof value !== 'string' || !value || /[\r\n]/.test(value)) throw new Error('config: egress_tls_sidecar allowlists must be safe strings')
  }
  if (!sidecar.logical_target_host || !isSafeHost(sidecar.logical_target_host) || isLoopbackHost(sidecar.logical_target_host) || !sidecar.allowed_target_hosts?.includes(sidecar.logical_target_host)) {
    throw new Error('config: egress_tls_sidecar.logical_target_host must be an allowlisted safe provider host')
  }
  for (const key of Object.keys(sidecar as Record<string, unknown>)) {
    if (!ALLOWED_SIDECAR_CONFIG_KEYS.has(key) || FORBIDDEN_CONTROL_OR_OVERRIDE_KEY.test(key)) {
      throw new Error(`config: egress_tls_sidecar.${key} is not an allowed sidecar config key`)
    }
  }
  if (!sidecar.expected_tls_summary_bucket || !isSafeSummaryBucket(sidecar.expected_tls_summary_bucket)) {
    throw new Error('config: egress_tls_sidecar.expected_tls_summary_bucket must be a safe ref')
  }
  const raw = sidecar as Record<string, unknown>
  if ('target_scheme' in raw) throw new Error('config: egress_tls_sidecar.target_scheme must not override HTTPS provider routing')
  if ('target_port' in raw) throw new Error('config: egress_tls_sidecar.target_port must not override provider port 443')
  validateMockMessagesResponseBridge(config, sidecar)
}

function validateMockMessagesResponseBridge(config: {
  mode?: string
  upstream?: { url?: string }
  shared_pool?: { upstream_mode?: string; production_upstream_enabled?: boolean; real_canary_user_approved?: boolean }
}, sidecar: EgressSidecarConfig): void {
  const mock = sidecar.mock_messages_response
  if (!mock || mock.enabled !== true) return
  const mockRecord = mock as Record<string, unknown>
  for (const key of Object.keys(mockRecord)) {
    if (!['enabled', 'mode'].includes(key) || FORBIDDEN_CONTROL_OR_OVERRIDE_KEY.test(key)) {
      throw new Error(`config: egress_tls_sidecar.mock_messages_response.${key} is not an allowed mock bridge config key`)
    }
  }
  const sharedPool = config.shared_pool || {}
  const upstreamMode = sharedPool.upstream_mode
  const productionLike = upstreamMode === 'production'
    || upstreamMode === 'real-canary'
    || sharedPool.production_upstream_enabled === true
    || sharedPool.real_canary_user_approved === true
  if (mock.mode !== 'local_smoke') {
    throw new Error('config: egress_tls_sidecar.mock_messages_response requires mode: local_smoke')
  }
  if (config.mode !== 'sub2api' || productionLike || !['local-capture', 'preflight'].includes(String(upstreamMode || ''))) {
    throw new Error('config: egress_tls_sidecar.mock_messages_response is local-only and forbidden in production/provider-direct modes')
  }
  if (sidecar.logical_target_host !== 'api.anthropic.com') {
    throw new Error('config: egress_tls_sidecar.mock_messages_response requires logical target api.anthropic.com')
  }
  if (!isLoopbackUpstreamUrl(config.upstream?.url)) {
    throw new Error('config: egress_tls_sidecar.mock_messages_response requires a local-only loopback upstream URL')
  }
}


export function prepareEgressSidecarRequest(input: {
  config: { egress_tls_sidecar?: EgressSidecarConfig }
  profileRef?: string
  egressBucket?: string
  proxyIdentityRef?: string
  targetHost: string
  targetPort: number
  targetScheme: 'http' | 'https'
  targetPath: string
  route: string
  method: string
}): { ok: true; prepared: EgressSidecarPrepared } | { ok: false; status: number; code: string; message: string } {
  const sidecar = input.config.egress_tls_sidecar
  if (!sidecar || sidecar.enabled !== true) return { ok: false, status: 403, code: 'egress_tls_sidecar_disabled', message: 'TLS sidecar is disabled' }
  const endpoint = parseLoopbackEndpoint(sidecar.endpoint)
  if (!endpoint) return { ok: false, status: 403, code: 'egress_tls_sidecar_endpoint_unsafe', message: 'TLS sidecar endpoint is not loopback-scoped' }
  if (!sidecar.control_token) return { ok: false, status: 403, code: 'egress_tls_sidecar_unauthenticated', message: 'TLS sidecar control token is missing' }
  if (!input.profileRef || !isSafeTLSProfileRef(input.profileRef)) return { ok: false, status: 403, code: 'egress_tls_sidecar_profile_missing', message: 'TLS profile ref is missing' }
  if (!sidecar.allowed_profile_refs?.includes(input.profileRef)) return { ok: false, status: 403, code: 'egress_tls_sidecar_profile_not_allowed', message: 'TLS profile ref is not allowlisted' }
  if (!sidecar.logical_target_host || !isSafeHost(sidecar.logical_target_host) || isLoopbackHost(sidecar.logical_target_host) || !sidecar.allowed_target_hosts?.includes(sidecar.logical_target_host)) {
    return { ok: false, status: 403, code: 'egress_tls_sidecar_logical_target_missing', message: 'TLS sidecar logical target host is missing or unsafe' }
  }
  if (!sidecar.expected_tls_summary_bucket || !isSafeSummaryBucket(sidecar.expected_tls_summary_bucket)) {
    return { ok: false, status: 403, code: 'egress_tls_summary_bucket_missing', message: 'TLS sidecar expected summary bucket is missing' }
  }
  if (input.targetHost !== sidecar.logical_target_host) return { ok: false, status: 403, code: 'egress_tls_sidecar_target_not_allowed', message: 'TLS sidecar target host is not the logical provider host' }
  if (!sidecar.allowed_target_hosts?.includes(input.targetHost)) return { ok: false, status: 403, code: 'egress_tls_sidecar_target_not_allowed', message: 'TLS sidecar target host is not allowlisted' }
  if (!sidecar.allowed_routes?.includes(input.targetPath) || !sidecar.allowed_routes?.includes(input.route)) {
    return { ok: false, status: 403, code: 'egress_tls_sidecar_route_not_allowed', message: 'TLS sidecar route is not allowlisted' }
  }
  if (!input.egressBucket || !isSafeBucket(input.egressBucket)) return { ok: false, status: 403, code: 'egress_tls_sidecar_egress_mismatch', message: 'TLS sidecar egress bucket is unsafe' }
  if (!input.proxyIdentityRef || !isSafeBucket(input.proxyIdentityRef)) return { ok: false, status: 403, code: 'egress_tls_sidecar_proxy_mismatch', message: 'TLS sidecar proxy identity is unsafe' }
  if (input.targetScheme !== 'https') return { ok: false, status: 403, code: 'egress_tls_sidecar_target_not_allowed', message: 'TLS sidecar target scheme is not allowed' }
  if (input.targetPort !== 443) return { ok: false, status: 403, code: 'egress_tls_sidecar_target_not_allowed', message: 'TLS sidecar target port is not allowed' }
  const control: EgressSidecarControl = {
    profile_ref: input.profileRef,
    egress_bucket: input.egressBucket,
    proxy_identity_ref: input.proxyIdentityRef,
    target_host: input.targetHost,
    target_port: input.targetPort,
    target_scheme: input.targetScheme,
    target_path: input.targetPath,
    route: input.route,
    method: input.method,
    expected_tls_summary_bucket: sidecar.expected_tls_summary_bucket,
  }
  return { ok: true, prepared: { endpoint, controlToken: sidecar.control_token, control, expectedTLSBucket: sidecar.expected_tls_summary_bucket } }
}

export async function callEgressSidecar(prepared: EgressSidecarPrepared, body: Buffer): Promise<{ ok: true; response: EgressSidecarResponse } | { ok: false; status: number; code: string; message: string }> {
  const endpoint = new URL(prepared.endpoint.toString())
  const requestFn = endpoint.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve) => {
    const req = requestFn(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(body.length),
        'x-cc-egress-sidecar-token': prepared.controlToken,
        'x-cc-egress-control': JSON.stringify(prepared.control),
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => {
        const status = res.statusCode || 502
        if (status === 401 || status === 403) {
          resolve({ ok: false, status: 502, code: status === 401 ? 'egress_tls_sidecar_unauthenticated' : 'egress_tls_sidecar_rejected', message: 'TLS sidecar rejected authenticated egress' })
          return
        }
        if (status < 200 || status >= 300) {
          resolve({ ok: false, status: 502, code: 'egress_tls_sidecar_failure', message: 'TLS sidecar failed before upstream response' })
          return
        }
        const observedBucket = parseSingleSafeSummaryBucket(res.headers['x-cc-egress-tls-summary-bucket'])
        if (observedBucket !== prepared.expectedTLSBucket) {
          resolve({ ok: false, status: 502, code: 'egress_tls_summary_mismatch', message: 'TLS sidecar summary bucket does not match expected profile' })
          return
        }
        resolve({ ok: true, response: { status, headers: res.headers, body: Buffer.concat(chunks) } })
      })
    })
    req.on('error', () => resolve({ ok: false, status: 502, code: 'egress_tls_sidecar_unavailable', message: 'TLS sidecar is unavailable' }))
    req.write(body)
    req.end()
  })
}

function parseLoopbackEndpoint(value: unknown): URL | null {
  if (typeof value !== 'string' || !value.trim()) return null
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  const hostname = parsed.hostname.toLowerCase()
  if (hostname !== '127.0.0.1' && hostname !== '::1' && hostname !== '[::1]') return null
  if (parsed.username || parsed.password) return null
  return parsed
}

export function egressSidecarTargetHost(config: { egress_tls_sidecar?: EgressSidecarConfig }, fallbackHost: string): string {
  const sidecar = config.egress_tls_sidecar
  if (sidecar?.enabled === true && !sidecar.logical_target_host) return ''
  const logical = sidecar?.logical_target_host
  return logical && isSafeHost(logical) && !isLoopbackHost(logical) ? logical : fallbackHost
}

function parseSingleSafeSummaryBucket(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  if (!isSafeSummaryBucket(value)) return undefined
  return value
}

function isSafeBucket(value: string): boolean {
  return SAFE_REF.test(value) && !/[\r\n]/.test(value)
}

function isSafeHost(value: string): boolean {
  return /^[A-Za-z0-9.-]{1,253}$/.test(value) && !/[\r\n/@:]/.test(value)
}

function isSafeSummaryBucket(value: string): boolean {
  return value.startsWith('tls-bucket:') && isSafeBucket(value)
}

function isLoopbackHost(value: string): boolean {
  const host = value.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

function isLoopbackUpstreamUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (parsed.username || parsed.password) return false
  return isLoopbackHost(parsed.hostname)
}
