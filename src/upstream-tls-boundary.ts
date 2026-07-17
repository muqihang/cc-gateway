import { isIP } from 'net'
import { ConfigValidationError, type Config } from './config.js'

export type UpstreamTLSBoundary = Readonly<{
  real: boolean
  requestOptions: Readonly<{ rejectUnauthorized?: true }>
}>

const CUSTOM_TRUST_ENVIRONMENT = new Set([
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
])

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost') return true
  const kind = isIP(hostname)
  if (kind === 4) return hostname.split('.')[0] === '127'
  return kind === 6 && hostname.toLowerCase() === '::1'
}

function processTrustOverridePresent(env: NodeJS.ProcessEnv): boolean {
  for (const [rawKey, rawValue] of Object.entries(env)) {
    const key = rawKey.toUpperCase()
    const value = String(rawValue ?? '').trim()
    if (key === 'NODE_TLS_REJECT_UNAUTHORIZED' && value.toLowerCase() === '0') return true
    if (CUSTOM_TRUST_ENVIRONMENT.has(key) && value !== '') return true
  }
  return false
}

export function resolveUpstreamTLSBoundary(
  config: Config,
  env: NodeJS.ProcessEnv,
): UpstreamTLSBoundary {
  let upstream: URL
  try {
    upstream = new URL(config.upstream.url)
  } catch {
    throw new ConfigValidationError('upstream_url_invalid')
  }

  const mode = config.shared_pool?.upstream_mode
  const real = mode === 'real-canary' || mode === 'production'
  if (!real) {
    if (upstream.protocol !== 'http:' && upstream.protocol !== 'https:') {
      throw new ConfigValidationError('upstream_protocol_unsupported')
    }
    if (upstream.protocol === 'http:' && !isLoopbackHostname(upstream.hostname)) {
      throw new ConfigValidationError('upstream_http_loopback_required')
    }
    return { real: false, requestOptions: {} }
  }

  if (upstream.protocol !== 'https:') {
    throw new ConfigValidationError('upstream_https_required')
  }
  if (config.upstream.tls?.verification !== 'required') {
    throw new ConfigValidationError('upstream_tls_verification_required')
  }
  if (config.upstream.tls?.trust_store !== 'system') {
    throw new ConfigValidationError('upstream_tls_trust_store_required')
  }
  if (processTrustOverridePresent(env)) {
    throw new ConfigValidationError('upstream_tls_trust_override_forbidden')
  }
  return { real: true, requestOptions: { rejectUnauthorized: true } }
}
