import { ConfigValidationError, type Config } from './config.js'
import { isIP } from 'net'

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

function isStrongAuthMaterial(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 32) return false
  const lower = value.toLowerCase()
  return !WEAK_AUTH_MARKERS.some((marker) => lower.includes(marker))
}

function hasStrongRemoteAuth(config: Config): boolean {
  if (config.mode === 'standalone') {
    return config.auth.tokens.length > 0
      && config.auth.tokens.every((entry) => isStrongAuthMaterial(entry.token))
  }

  const gatewayMaterials = [
    ...(config.auth.gateway_token ? [config.auth.gateway_token] : []),
    ...config.auth.tokens.map((entry) => entry.token),
  ]
  if (gatewayMaterials.length === 0 || !gatewayMaterials.every(isStrongAuthMaterial)) return false

  const internalControl = config.auth.internal_control_token
  return isStrongAuthMaterial(internalControl)
    && !gatewayMaterials.includes(internalControl)
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
