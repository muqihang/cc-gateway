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
  persona_variant: string
  session_policy: 'preserve_downstream_session_id' | 'gateway_generated'
  policy_version: string
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
    upstream_mode?: 'preflight' | 'dry-run' | 'local-capture' | 'real-canary' | 'production'
    real_canary_user_approved?: boolean
    production_upstream_enabled?: boolean
    message_beta_profile?: 'claude_code_2_1_146' | 'claude_code_2_1_150_subscription' | 'claude_code_2_1_150_subscription_1m' | 'first_200_oauth_compat' | 'claude_code_candidate_beta' | string
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

  return config
}
