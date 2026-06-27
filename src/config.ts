import { readFileSync } from 'fs'
import { parse } from 'yaml'
import { resolve } from 'path'

export type TokenEntry = {
  name: string
  token: string
}

export type AccountIdentityConfig = {
  device_id: string
  account_uuid_ref?: string
  account_uuid_hash?: string
  email_ref?: string
  email_hash?: string
  account_ref?: string
  account_hash?: string
  credential_ref?: string
  credential_binding_hmac?: string
  token_type?: 'oauth' | 'apikey'
  persona_variant: string
  session_policy: 'preserve_downstream_session_id'
  policy_version: string
  provider_kind?: 'anthropic_first_party' | 'claude_platform_aws'
  workspace_ref?: string
  workspace_binding_hmac?: string
  upstream_endpoint_ref?: string
  aws_region?: string
  upstream_host?: string
  allowed_upstream_path?: string
  upstream_auth_scheme?: 'x_api_key' | 'bearer_api_key'
  beta_policy_ref?: string
  request_shape_profile_ref?: string
  cache_parity_profile_ref?: string
  anthropic_workspace_id?: string
}

export type EgressBucketConfig = {
  enabled: boolean
  proxy_url: string
  proxy_identity_ref?: string
  proxy_identity_hash?: string
  allowed_account_ids?: string[]
}

export type Config = {
  mode: 'standalone' | 'sub2api'
  server: {
    port: number
    host?: string
    tls: {
      cert: string
      key: string
    }
  }
  upstream: {
    url: string
  }
  providers: {
    anthropic: boolean
  }
  auth: {
    gateway_token?: string
    internal_control_token?: string
    tokens: TokenEntry[]
  }
  oauth?: {
    access_token?: string
    refresh_token: string
    expires_at?: number
  }
  identity: {
    device_id: string
    email: string
  }
  env: Record<string, string | boolean | number>
  // System prompt environment masking - must be consistent with env above
  prompt_env: {
    platform: string        // "darwin" — must match env.platform
    shell: string           // "zsh"
    os_version: string      // "Darwin 24.4.0" — uname -sr output
    working_dir: string     // "/Users/jack/projects" — canonical home path prefix
  }
  process: {
    constrained_memory: number
    rss_range: [number, number]
    heap_total_range: [number, number]
    heap_used_range: [number, number]
  }
  shared_pool?: {
    max_body_bytes?: number
    billing_cch_mode?: 'strip' | 'sign' | 'disabled'
    signing_enabled?: boolean
    signing_evidence_gates_approved?: boolean
    signing_2177_oracle_profile_approved?: boolean
    signing_2177_oracle_profile_ref?: string
    upstream_mode?: 'preflight' | 'dry-run' | 'local-capture' | 'real-canary' | 'production'
    real_canary_user_approved?: boolean
    production_upstream_enabled?: boolean
    context_attestation_secret_ref?: string
    context_attestation_secret?: string
    context_attestation_secret_env?: string
    message_beta_profile?: 'claude_code_2_1_146' | 'claude_code_2_1_150_subscription' | 'claude_code_2_1_150_subscription_1m' | 'claude_code_2_1_170_subscription_1m' | 'claude_code_2_1_175_subscription_1m' | 'first_200_oauth_compat' | 'claude_code_candidate_beta' | string
    canary_envelope_role?: string
    canary_cost_envelope?: {
      enabled?: boolean
      max_tokens?: number
      max_body_bytes?: number
      max_tools_count?: number
      allow_thinking?: boolean
      max_thinking_budget_tokens?: number
      allow_output_config?: boolean
      allow_context_management?: boolean
      allow_context_1m?: boolean
      max_context_window_tokens?: number
      allowed_models?: string[]
    }
    candidate_model_allowlist?: string[]
    candidate_model_replay_proofs?: Record<string, string>
    candidate_model_kill_switches?: Record<string, boolean>
    candidate_model_audit_budgets?: Record<string, number>
    candidate_beta_allowlist?: string[]
    candidate_beta_replay_proofs?: Record<string, string>
    candidate_beta_kill_switches?: Record<string, boolean>
    candidate_beta_audit_budgets?: Record<string, number>
    production_budget?: {
      mode?: 'observe_only' | string
      enforcement_enabled?: boolean
      p0_hard_block_only?: boolean
    }
  }
  account_identities?: Record<string, AccountIdentityConfig>
  egress_buckets?: Record<string, EgressBucketConfig>
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error'
    audit: boolean
  }
}

const HEX64 = /^[a-f0-9]{64}$/i
const RAW_UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
const RAW_EMAIL_LIKE = /[^@\s]+@[^@\s]+\.[^@\s]+/
const PLAIN_DIGEST_REF = /(?:^|[:=;,])(sha256|md5):/i
const TOKEN_LIKE_MATERIAL = /(?:sk-ant-|sk-[A-Za-z0-9]|Bearer\s+|Basic\s+|oauth|access[_-]?token|refresh[_-]?token|api[_-]?key|secret)/i
const SAFE_INTERNAL_ROUTING_KEY = /^[A-Za-z0-9._:-]{1,128}$/
const CREDENTIAL_BINDING_HMAC = /^hmac-sha256:[a-f0-9]{64}$/i
const WEAK_CONTROL_MATERIAL = /(?:change[-_ ]?me|placeholder|example|sample|dummy|test|local-tests|formal-pool-attestation-secret-test|internal-control-token-for-local-tests)/i

function hasOwnKeys(value: unknown): boolean {
  return !!value && typeof value === 'object' && Object.keys(value as Record<string, unknown>).length > 0
}

function hasFormalPoolSharedPoolConfig(sharedPool: unknown): boolean {
  if (!sharedPool || typeof sharedPool !== 'object') return false
  const pool = sharedPool as Record<string, unknown>
  if (typeof pool.context_attestation_secret_ref === 'string' && pool.context_attestation_secret_ref.trim()) return true
  if (pool.production_upstream_enabled === true || pool.real_canary_user_approved === true) return true
  if (pool.upstream_mode === 'production' || pool.upstream_mode === 'real-canary') return true
  return false
}

export function hasFormalPoolConfig(config: Config): boolean {
  return hasOwnKeys((config as any).account_identities)
    || hasOwnKeys((config as any).egress_buckets)
    || hasFormalPoolSharedPoolConfig((config as any).shared_pool)
}

function isSafeInternalRoutingKey(value: unknown): value is string {
  if (typeof value !== 'string' || !SAFE_INTERNAL_ROUTING_KEY.test(value)) return false
  if (RAW_UUID_LIKE.test(value) || RAW_EMAIL_LIKE.test(value) || PLAIN_DIGEST_REF.test(value) || TOKEN_LIKE_MATERIAL.test(value)) return false
  if (value.includes('://') || value.includes('@')) return false
  return true
}

function isSafeFormalPoolRef(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed !== value || !trimmed || trimmed.length > 512) return false
  if (trimmed.includes('\n') || trimmed.includes('\r')) return false
  if (RAW_UUID_LIKE.test(trimmed) || RAW_EMAIL_LIKE.test(trimmed) || PLAIN_DIGEST_REF.test(trimmed) || TOKEN_LIKE_MATERIAL.test(trimmed)) return false
  if (trimmed.includes('://') || trimmed.includes('@')) return false
  if (trimmed.startsWith('opaque:')) return trimmed.length > 'opaque:'.length
  if (trimmed.startsWith('hmac-sha256:')) return trimmed.length > 'hmac-sha256:'.length
  if (trimmed.startsWith('scoped_hmac_ref:')) return trimmed.length > 'scoped_hmac_ref:'.length
  return false
}

function redactedMapPath(collection: string, key: string, suffix = ''): string {
  const safeKey = isSafeInternalRoutingKey(key) ? key : '<redacted>'
  return `${collection}.${safeKey}${suffix}`
}

function requireSafeFormalPoolRef(label: string, value: unknown): string {
  if (!isSafeFormalPoolRef(value)) {
    throw new Error(`config: ${label} must be a safe opaque/HMAC ref, never raw account, credential, digest, email, UUID, or proxy material`)
  }
  return value
}

function requireCredentialBindingHmac(label: string, value: unknown): string {
  if (typeof value !== 'string' || !CREDENTIAL_BINDING_HMAC.test(value.trim())) {
    throw new Error(`config: ${label} must be hmac-sha256: followed by 64 hex characters`)
  }
  return value.trim()
}

export function isProductionFormalPool(config: Config): boolean {
  const sharedPool = (config as any).shared_pool as Record<string, unknown> | undefined
  return config.mode === 'sub2api'
    && (sharedPool?.upstream_mode === 'production' || sharedPool?.production_upstream_enabled === true)
}

function resolveContextAttestationSecret(sharedPool: Record<string, unknown> | undefined): string {
  const direct = typeof sharedPool?.context_attestation_secret === 'string' ? sharedPool.context_attestation_secret.trim() : ''
  if (direct) return direct
  const envName = typeof sharedPool?.context_attestation_secret_env === 'string' ? sharedPool.context_attestation_secret_env.trim() : ''
  if (envName) return String(process.env[envName] || '').trim()
  return String(process.env.CC_GATEWAY_CONTEXT_ATTESTATION_SECRET || '').trim()
}

function requireNonWeakProductionMaterial(label: string, value: string): void {
  if (value.length < 32 || WEAK_CONTROL_MATERIAL.test(value)) {
    throw new Error(`config: ${label} must be high-entropy non-placeholder material in production formal-pool mode`)
  }
}

export function validateFormalPoolAccountIdentity(accountId: string, identity: AccountIdentityConfig): void {
  const path = (suffix = '') => redactedMapPath('account_identities', accountId, suffix)
  if (!isSafeInternalRoutingKey(accountId)) {
    throw new Error(`config: ${path('.id')} must be a safe internal routing key`)
  }
  if (!identity || typeof identity !== 'object') {
    throw new Error(`config: ${path()} must be an object`)
  }
  if (!HEX64.test(identity.device_id || '')) {
    throw new Error(`config: ${path('.device_id')} must be exactly 64 hex characters`)
  }
  const accountRef = identity.account_uuid_ref || identity.account_uuid_hash
  requireSafeFormalPoolRef(path('.account_uuid_ref'), accountRef)
  if (identity.email_ref || identity.email_hash) {
    requireSafeFormalPoolRef(path('.email_ref'), identity.email_ref || identity.email_hash)
  }
  if (identity.account_ref || identity.account_hash) {
    requireSafeFormalPoolRef(path('.account_ref'), identity.account_ref || identity.account_hash)
  }
  requireSafeFormalPoolRef(path('.credential_ref'), identity.credential_ref)
  requireCredentialBindingHmac(path('.credential_binding_hmac'), identity.credential_binding_hmac)
  if (identity.token_type !== undefined && identity.token_type !== 'oauth' && identity.token_type !== 'apikey') {
    throw new Error(`config: ${path('.token_type')} must be oauth or apikey`)
  }
  if (!identity.persona_variant || typeof identity.persona_variant !== 'string' || /[\r\n]/.test(identity.persona_variant)) {
    throw new Error(`config: ${path('.persona_variant')} is required`)
  }
  if (identity.session_policy !== 'preserve_downstream_session_id') {
    throw new Error(`config: ${path('.session_policy')} must be preserve_downstream_session_id until gateway_generated is implemented`)
  }
  if (!identity.policy_version || typeof identity.policy_version !== 'string' || /[\r\n]/.test(identity.policy_version)) {
    throw new Error(`config: ${path('.policy_version')} is required`)
  }
}

export function validateFormalPoolEgressBucket(
  bucketId: string,
  bucket: EgressBucketConfig,
  accountIds: Set<string> = new Set(),
): void {
  const path = (suffix = '') => redactedMapPath('egress_buckets', bucketId, suffix)
  if (!isSafeInternalRoutingKey(bucketId)) {
    throw new Error(`config: ${path('.id')} must be a safe internal routing key`)
  }
  if (!bucket || typeof bucket !== 'object') {
    throw new Error(`config: ${path()} must be an object`)
  }
  if (bucket.enabled !== true) {
    throw new Error(`config: ${path('.enabled')} must be true for formal-pool routing`)
  }
  if (!bucket.proxy_url || typeof bucket.proxy_url !== 'string') {
    throw new Error(`config: ${path('.proxy_url')} is required`)
  }
  requireSafeFormalPoolRef(path('.proxy_identity_ref'), bucket.proxy_identity_ref)
  if (!Array.isArray(bucket.allowed_account_ids) || bucket.allowed_account_ids.length === 0) {
    throw new Error(`config: ${path('.allowed_account_ids')} must be an explicit non-empty account allowlist`)
  }
  for (const accountId of bucket.allowed_account_ids) {
    if (!isSafeInternalRoutingKey(accountId) || (accountIds.size > 0 && !accountIds.has(accountId))) {
      throw new Error(`config: ${path('.allowed_account_ids')} contains an unknown or unsafe account id`)
    }
  }
}

export function validateFormalPoolMode(config: Config): void {
  const formalPool = hasFormalPoolConfig(config)
  if (formalPool && config.mode !== 'sub2api') {
    throw new Error('config: formal-pool/shared-account configuration requires mode: sub2api; standalone is forbidden for formal-pool production')
  }
  if (config.mode !== 'sub2api') return

  const identities = (config as any).account_identities as Record<string, AccountIdentityConfig> | undefined
  const buckets = (config as any).egress_buckets as Record<string, EgressBucketConfig> | undefined
  if (!hasOwnKeys(identities) || !hasOwnKeys(buckets)) {
    throw new Error('config: sub2api formal-pool mode requires account_identities and egress_buckets')
  }
  const accountIds = new Set(Object.keys(identities || {}))
  for (const [accountId, identity] of Object.entries(identities || {})) {
    validateFormalPoolAccountIdentity(accountId, identity)
  }
  for (const [bucketId, bucket] of Object.entries(buckets || {})) {
    validateFormalPoolEgressBucket(bucketId, bucket, accountIds)
  }
  validateFormalPoolAttestationConfig(config)
}

function validateFormalPoolAttestationConfig(config: Config): void {
  const sharedPool = (config as any).shared_pool as Record<string, unknown> | undefined
  if (typeof sharedPool?.context_attestation_secret_ref !== 'string') {
    throw new Error('config: shared_pool.context_attestation_secret_ref is required for sub2api formal-pool context attestation')
  }
  requireSafeFormalPoolRef('shared_pool.context_attestation_secret_ref', sharedPool.context_attestation_secret_ref)
  const internal = config.auth.internal_control_token
  if (!internal || typeof internal !== 'string' || !internal.trim()) {
    throw new Error('config: auth.internal_control_token is required when formal-pool context attestation is enabled')
  }
  const trimmedInternal = internal.trim()
  const gatewayToken = typeof config.auth.gateway_token === 'string' ? config.auth.gateway_token.trim() : ''
  if (trimmedInternal === gatewayToken || config.auth.tokens.some((token) => token.token.trim() === trimmedInternal)) {
    throw new Error('config: auth.internal_control_token must be independent from gateway/client tokens')
  }

  const attestationSecret = resolveContextAttestationSecret(sharedPool)
  if (!attestationSecret) {
    throw new Error('config: shared_pool.context_attestation_secret or context_attestation_secret_env is required for sub2api formal-pool context attestation')
  }
  if (attestationSecret === trimmedInternal || attestationSecret === gatewayToken || config.auth.tokens.some((token) => token.token.trim() === attestationSecret)) {
    throw new Error('config: shared_pool.context_attestation_secret must be independent from internal_control_token and gateway/client tokens')
  }
  if (isProductionFormalPool(config)) {
    requireNonWeakProductionMaterial('auth.internal_control_token', trimmedInternal)
    requireNonWeakProductionMaterial('shared_pool.context_attestation_secret', attestationSecret)
  }
}

export function loadConfig(configPath?: string): Config {
  const filePath = configPath || resolve(process.cwd(), 'config.yaml')
  const raw = readFileSync(filePath, 'utf-8')
  const config = parse(raw) as Config
  config.mode = config.mode ?? 'standalone'
  config.providers = {
    ...config.providers,
    anthropic: config.providers?.anthropic ?? true,
  }
  config.auth = {
    ...config.auth,
    tokens: config.auth?.tokens ?? [],
  }

  if (!['standalone', 'sub2api'].includes(config.mode)) {
    throw new Error('config: mode must be either "standalone" or "sub2api"')
  }

  if (!config.identity?.device_id || config.identity.device_id.includes('0000000000')) {
    throw new Error('config: identity.device_id must be set to a real 64-char hex value. Run: npm run generate-identity')
  }
  const hasLegacyTokens = config.auth.tokens.length > 0
  const hasGatewayToken = !!config.auth.gateway_token

  if (config.mode === 'standalone' && !hasLegacyTokens) {
    throw new Error('config: auth.tokens must have at least one entry')
  }
  if (config.mode === 'sub2api' && !hasGatewayToken && !hasLegacyTokens) {
    throw new Error('config: sub2api mode requires auth.gateway_token or auth.tokens gateway token')
  }
  if (config.mode === 'standalone' && !config.oauth?.refresh_token) {
    throw new Error('config: oauth.refresh_token is required. Do a browser OAuth login on the admin machine, then copy the refresh token from ~/.claude/.credentials.json')
  }

  validateFormalPoolMode(config)

  return config
}
