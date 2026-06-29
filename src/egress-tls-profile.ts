export type EgressTLSMode = {
  enabled: boolean
  strict: boolean
}

export type TLSProfileConfig = {
  profile_ref: string
  source?: string
  enabled?: boolean
}

const SAFE_TLS_PROFILE_REF = /^tls-profile:[A-Za-z0-9._:-]{1,140}$/
const FORBIDDEN_TLS_REF_MATERIAL = /(?:secret|token|api[_-]?key|sk-|bearer|basic|sha256:|md5:|clienthello|cipher|extension|pcap|cert|private[_-]?key|raw)/i
const RAW_TLS_PROFILE_KEY_PATTERN = /(?:raw.*client.*hello|client.*hello|cipher|ciphersuite|extension|ja3.*string|private.*key|cert|certificate|pcap|key|pem)/i

export function isSafeTLSProfileRef(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed !== value || !SAFE_TLS_PROFILE_REF.test(trimmed)) return false
  if (FORBIDDEN_TLS_REF_MATERIAL.test(trimmed)) return false
  return true
}

export function tlsProfileMode(sharedPool: unknown): EgressTLSMode {
  const egressTLS = sharedPool && typeof sharedPool === 'object' ? (sharedPool as Record<string, unknown>).egress_tls : undefined
  if (!egressTLS || typeof egressTLS !== 'object') return { enabled: false, strict: true }
  const raw = egressTLS as Record<string, unknown>
  return {
    enabled: raw.enabled === true,
    strict: raw.strict !== false,
  }
}

export function assertNoRawTLSProfileMaterial(label: string, value: unknown, options: { scanStringValues?: boolean } = {}): void {
  assertNoRawTLSProfileMaterialInner(label, value, 0, options.scanStringValues === true)
}

function assertNoRawTLSProfileMaterialInner(label: string, value: unknown, depth: number, scanStringValues: boolean): void {
  if (typeof value === 'string') {
    if (scanStringValues && (RAW_TLS_PROFILE_KEY_PATTERN.test(value) || FORBIDDEN_TLS_REF_MATERIAL.test(value))) {
      throw new Error(`config: ${label} contains raw TLS profile material and is forbidden; use safe profile_ref only`)
    }
    return
  }
  if (!value || typeof value !== 'object' || depth > 8) return
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertNoRawTLSProfileMaterialInner(`${label}[${i}]`, value[i], depth + 1, scanStringValues)
    }
    return
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (RAW_TLS_PROFILE_KEY_PATTERN.test(key)) {
      throw new Error(`config: ${label}.${key} is raw TLS profile material and is forbidden; use safe profile_ref only`)
    }
    assertNoRawTLSProfileMaterialInner(`${label}.${key}`, nested, depth + 1, scanStringValues)
  }
}

export function validateTLSProfilesConfig(tlsProfiles: unknown): Map<string, TLSProfileConfig> {
  const out = new Map<string, TLSProfileConfig>()
  if (tlsProfiles === undefined || tlsProfiles === null) return out
  if (typeof tlsProfiles !== 'object' || Array.isArray(tlsProfiles)) {
    throw new Error('config: tls_profiles must be a map')
  }
  for (const [id, rawProfile] of Object.entries(tlsProfiles as Record<string, unknown>)) {
    if (RAW_TLS_PROFILE_KEY_PATTERN.test(id) || FORBIDDEN_TLS_REF_MATERIAL.test(id)) {
      throw new Error('config: tls_profiles map key is raw TLS profile material and is forbidden; use safe opaque profile ids only')
    }
    const label = `tls_profiles.${id}`
    if (!rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) {
      throw new Error(`config: ${label} must be an object`)
    }
    assertNoRawTLSProfileMaterial(label, rawProfile, { scanStringValues: true })
    const profile = rawProfile as Record<string, unknown>
    if (!isSafeTLSProfileRef(profile.profile_ref)) {
      throw new Error(`config: ${label}.profile_ref must be a safe tls-profile ref and never raw TLS material`)
    }
    if (profile.enabled === false) continue
    out.set(profile.profile_ref, {
      profile_ref: profile.profile_ref,
      source: typeof profile.source === 'string' ? profile.source : undefined,
      enabled: profile.enabled !== false,
    })
  }
  return out
}

export function isKnownEnabledTLSProfileRef(config: { tls_profiles?: unknown }, profileRef: string | undefined): boolean {
  if (!profileRef) return false
  return validateTLSProfilesConfig((config as any).tls_profiles).has(profileRef)
}
