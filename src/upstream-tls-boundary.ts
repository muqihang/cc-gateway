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

function canonicalPort(value: string): boolean {
  if (!/^[1-9][0-9]{0,4}$/.test(value)) return false
  return Number(value) <= 65535
}

function canonicalIPv4Loopback(value: string): boolean {
  const octets = value.split('.')
  return octets.length === 4
    && octets[0] === '127'
    && octets.every((octet) => /^(?:0|[1-9][0-9]{0,2})$/.test(octet) && Number(octet) <= 255)
}

function canonicalNumericLoopbackHTTP(raw: string): boolean {
  const match = /^http:\/\/([^/?#]+)(?:[/?#]|$)/.exec(raw)
  if (!match || match[1].includes('@')) return false
  const authority = match[1]
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']')
    if (close < 0 || authority.slice(0, close + 1) !== '[::1]') return false
    const remainder = authority.slice(close + 1)
    return remainder === '' || (remainder.startsWith(':') && canonicalPort(remainder.slice(1)))
  }
  const separator = authority.lastIndexOf(':')
  const host = separator < 0 ? authority : authority.slice(0, separator)
  const port = separator < 0 ? '' : authority.slice(separator + 1)
  return canonicalIPv4Loopback(host) && (separator < 0 || canonicalPort(port))
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
    if (upstream.protocol === 'http:' && !canonicalNumericLoopbackHTTP(config.upstream.url)) {
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
