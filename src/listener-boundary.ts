import { ConfigValidationError, type Config } from './config.js'
import { isIP } from 'net'
import { canonicalAuthMaterialBytes } from './auth-material.js'

export type ApprovedNetworkExposurePolicyRef = 'network-exposure-policy:private-ingress-v1'

export type RemoteListenConfig = {
  capability?: 'remote-listen-v1'
  exposure_policy_ref?: ApprovedNetworkExposurePolicyRef | string
}

export type ListenerBoundary = Readonly<{ host: string; remote: boolean }>

const APPROVED_NETWORK_EXPOSURE_POLICY_REFS = new Set<ApprovedNetworkExposurePolicyRef>([
  'network-exposure-policy:private-ingress-v1',
])

const WEAK_AUTH_MARKERS = [
  'change-me',
  'change_me',
  'placeholder',
  'example',
  'sample',
  'dummy',
  'test',
]

function canonicalStrongAuthMaterial(value: unknown): Buffer | null {
  const canonical = canonicalAuthMaterialBytes(value)
  if (!canonical || typeof value !== 'string' || value.length < 32) return null
  const lower = value.toLowerCase()
  if (WEAK_AUTH_MARKERS.some((marker) => lower.includes(marker))) return null
  return canonical
}

function hasStrongRemoteAuth(config: Config): boolean {
  if (config.mode === 'standalone') {
    return config.auth.tokens.length > 0
      && config.auth.tokens.every((entry) => canonicalStrongAuthMaterial(entry.token) !== null)
  }

  const rawGatewayMaterials = [
    ...(config.auth.gateway_token ? [config.auth.gateway_token] : []),
    ...config.auth.tokens.map((entry) => entry.token),
  ]
  if (rawGatewayMaterials.length === 0) return false
  const gatewayMaterials = rawGatewayMaterials.map(canonicalStrongAuthMaterial)
  if (gatewayMaterials.some((material) => material === null)) return false

  const internalControl = canonicalStrongAuthMaterial(config.auth.internal_control_token)
  return internalControl !== null
    && !gatewayMaterials.some((material) => material?.equals(internalControl))
}

function isLoopbackHost(host: string): boolean {
  const kind = isIP(host)
  if (kind === 4) return host.split('.')[0] === '127'
  return kind === 6 && host.toLowerCase() === '::1'
}

export function resolveListenerBoundary(config: Config): ListenerBoundary {
  const configuredHost = String(config.server.host || '').trim() || '127.0.0.1'
  const host = configuredHost === '[::1]' ? '::1' : configuredHost
  if (isLoopbackHost(host)) return { host, remote: false }

  const remote = config.server.remote_listen
  if (remote?.capability !== 'remote-listen-v1') {
    throw new ConfigValidationError('remote_listen_capability_required')
  }
  if (!config.server.tls?.cert || !config.server.tls?.key) {
    throw new ConfigValidationError('remote_listen_tls_required')
  }
  if (!hasStrongRemoteAuth(config)) {
    throw new ConfigValidationError('remote_listen_strong_auth_required')
  }
  if (!remote.exposure_policy_ref) {
    throw new ConfigValidationError('remote_listen_exposure_policy_required')
  }
  if (!APPROVED_NETWORK_EXPOSURE_POLICY_REFS.has(remote.exposure_policy_ref as ApprovedNetworkExposurePolicyRef)) {
    throw new ConfigValidationError('remote_listen_exposure_policy_unapproved')
  }
  return { host, remote: true }
}
