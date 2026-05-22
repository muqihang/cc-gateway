import { readFileSync } from 'fs'
import { parse } from 'yaml'
import { resolve } from 'path'

export type TokenEntry = {
  name: string
  token: string
}

export type AccountIdentityConfig = {
  device_id: string
  account_uuid_hash: string
  email_hash?: string
  account_hash?: string
  persona_variant: string
  session_policy: 'preserve_downstream_session_id' | 'gateway_generated'
  policy_version: string
}

export type EgressBucketConfig = {
  enabled: boolean
  proxy_url: string
  proxy_identity_hash?: string
  allowed_account_ids?: string[]
}

export type Config = {
  mode: 'standalone' | 'sub2api'
  server: {
    port: number
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
    billing_cch_mode?: 'strip' | 'sign'
    signing_enabled?: boolean
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
