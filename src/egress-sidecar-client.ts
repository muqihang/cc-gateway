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
  expected_tls_summary_bucket?: string
}

export type EgressSidecarControl = {
  profile_ref: string
  egress_bucket: string
  proxy_identity_ref: string
  target_host: string
  target_port: number
  target_scheme: 'http' | 'https'
  target_path: string
  route: string
  method: string
  expected_tls_summary_bucket?: string
}

export type EgressSidecarPrepared = {
  endpoint: URL
  controlToken: string
  control: EgressSidecarControl
  expectedTLSBucket?: string
}

export type EgressSidecarResponse = {
  status: number
  headers: IncomingHttpHeaders
  body: Buffer
}

const SAFE_REF = /^[A-Za-z0-9._:-]{1,160}$/

export function egressSidecarEnabled(config: { egress_tls_sidecar?: EgressSidecarConfig }): boolean {
  return config.egress_tls_sidecar?.enabled === true
}

export function validateEgressSidecarConfig(config: { egress_tls_sidecar?: EgressSidecarConfig }): void {
  const sidecar = config.egress_tls_sidecar
  if (!sidecar || sidecar.enabled !== true) return
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
  if (sidecar.expected_tls_summary_bucket !== undefined && !isSafeBucket(sidecar.expected_tls_summary_bucket)) {
    throw new Error('config: egress_tls_sidecar.expected_tls_summary_bucket must be a safe ref')
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
  if (!sidecar.allowed_target_hosts?.includes(input.targetHost)) return { ok: false, status: 403, code: 'egress_tls_sidecar_target_not_allowed', message: 'TLS sidecar target host is not allowlisted' }
  if (!sidecar.allowed_routes?.includes(input.targetPath) || !sidecar.allowed_routes?.includes(input.route)) {
    return { ok: false, status: 403, code: 'egress_tls_sidecar_route_not_allowed', message: 'TLS sidecar route is not allowlisted' }
  }
  if (!input.egressBucket || !isSafeBucket(input.egressBucket)) return { ok: false, status: 403, code: 'egress_tls_sidecar_egress_mismatch', message: 'TLS sidecar egress bucket is unsafe' }
  if (!input.proxyIdentityRef || !isSafeBucket(input.proxyIdentityRef)) return { ok: false, status: 403, code: 'egress_tls_sidecar_proxy_mismatch', message: 'TLS sidecar proxy identity is unsafe' }
  if (input.targetScheme !== 'http' && input.targetScheme !== 'https') return { ok: false, status: 403, code: 'egress_tls_sidecar_target_not_allowed', message: 'TLS sidecar target scheme is not allowed' }
  if (!Number.isInteger(input.targetPort) || input.targetPort < 1 || input.targetPort > 65535) return { ok: false, status: 403, code: 'egress_tls_sidecar_target_not_allowed', message: 'TLS sidecar target port is not allowed' }
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
    ...(sidecar.expected_tls_summary_bucket ? { expected_tls_summary_bucket: sidecar.expected_tls_summary_bucket } : {}),
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
        const observedBucket = typeof res.headers['x-cc-egress-tls-summary-bucket'] === 'string' ? res.headers['x-cc-egress-tls-summary-bucket'] : undefined
        if (prepared.expectedTLSBucket && observedBucket !== prepared.expectedTLSBucket) {
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
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1' && hostname !== '[::1]') return null
  if (parsed.username || parsed.password) return null
  return parsed
}

function isSafeBucket(value: string): boolean {
  return SAFE_REF.test(value) && !/[\r\n]/.test(value)
}
