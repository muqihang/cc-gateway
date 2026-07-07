import { createHash, randomUUID } from 'crypto'
import type { Config } from './config.js'
import {
  inferLegacyPersonaVariant,
} from './persona-registry.js'
import { resolvePersonaDecision, type PersonaDecision } from './persona-resolver.js'
import { isSafeTLSProfileRef } from './egress-tls-profile.js'

export type SharedPoolRouteKind = 'messages' | 'count_tokens' | 'control_plane' | 'event_logging_legacy' | 'event_logging_v2'
export type SharedPoolPersonaRoute = 'messages' | 'count_tokens' | 'control_plane'

export type SharedPoolRoutePolicy =
  | { action: 'forward'; kind: 'messages' | 'control_plane' }
  | { action: 'suppress'; kind: 'event_logging_legacy' | 'event_logging_v2' }
  | { action: 'block'; code: string; status: number }

export type AccountIdentityRecord = {
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
  upstream_auth_scheme?: 'x_api_key' | 'bearer_api_key' | 'sigv4'
  beta_policy_ref?: string
  request_shape_profile_ref?: string
  cache_parity_profile_ref?: string
  anthropic_workspace_id?: string
  aws_access_key_id?: string
  aws_secret_access_key?: string
  aws_session_token?: string
}

export type EgressBucketRecord = {
  enabled: boolean
  proxy_url: string
  proxy_identity_ref?: string
  proxy_identity_hash?: string
  allowed_account_ids?: string[]
  tls_profile_ref?: string
}

export type EgressBucketResolution = {
  bucketId: string
  proxyUrl: string
  proxyIdentityRef: string
  tlsProfileRef?: string
}

const COUNT_TOKENS_BETA = null
const UUID_LIKE_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RAW_UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
const RAW_EMAIL_LIKE = /[^@\s]+@[^@\s]+\.[^@\s]+/
const PLAIN_DIGEST_REF = /(?:^|[:=;,])(sha256|md5):/i
const TOKEN_LIKE_MATERIAL = /(?:sk-ant-|sk-[A-Za-z0-9]|Bearer\s+|Basic\s+|oauth|access[_-]?token|refresh[_-]?token|api[_-]?key|secret)/i
const STAINLESS_HEADER_VALUES = {
  lang: 'js',
  retryCount: '0',
  timeout: '600',
} as const
const SHARED_POOL_HEADER_ALLOWLIST = [
  'Accept',
  'Accept-Encoding',
  'User-Agent',
  'X-Claude-Code-Session-Id',
  'X-Stainless-Arch',
  'X-Stainless-Lang',
  'X-Stainless-OS',
  'X-Stainless-Package-Version',
  'X-Stainless-Retry-Count',
  'X-Stainless-Runtime',
  'X-Stainless-Runtime-Version',
  'X-Stainless-Timeout',
  'anthropic-beta',
  'anthropic-dangerous-direct-browser-access',
  'anthropic-version',
  'content-type',
  'x-api-key',
  'x-app',
  'authorization',
] as const

export const DEFAULT_SHARED_POOL_MAX_BODY_BYTES = 16 * 1024 * 1024

export function canonicalPersonaHeaders(
  config: Config,
  route: SharedPoolPersonaRoute,
  sessionId?: string,
  options: { identity?: AccountIdentityRecord; requestedPolicyVersion?: string; requestedModel?: string; trustedClient?: boolean; requestedContext1M?: boolean } = {},
): Record<string, string> {
  const decision = resolveSharedPoolPersonaDecision(
    config,
    options.identity,
    options.requestedPolicyVersion || String(config.env.version),
    options.requestedModel || '',
    options.trustedClient !== false,
    route,
    options.requestedContext1M === true,
  )
  const version = decision.effectiveVersion
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': `claude-cli/${version} (external, sdk-cli)`,
    'X-Stainless-Arch': String(config.env.arch || 'arm64'),
    'X-Stainless-Lang': STAINLESS_HEADER_VALUES.lang,
    'X-Stainless-OS': canonicalStainlessOS(config),
    'X-Stainless-Package-Version': decision.profile.stainlessPackageVersion,
    'X-Stainless-Retry-Count': STAINLESS_HEADER_VALUES.retryCount,
    'X-Stainless-Runtime': String(config.env.runtimes || 'node').split(',')[0] || 'node',
    'X-Stainless-Runtime-Version': String(config.env.node_version || 'v24.3.0'),
    'X-Stainless-Timeout': STAINLESS_HEADER_VALUES.timeout,
    'anthropic-dangerous-direct-browser-access': 'true',
    'anthropic-version': '2023-06-01',
    'x-app': 'cli',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
  }
  headers['anthropic-beta'] = route === 'count_tokens'
    ? (COUNT_TOKENS_BETA ?? decision.betaHeader)
    : decision.betaHeader
  if (sessionId) headers['X-Claude-Code-Session-Id'] = sessionId
  validateSharedPoolPersonaHeaderSchema(headers, route, sessionId)
  return headers
}

export function resolveSharedPoolPersonaDecision(
  config: Config,
  identity: AccountIdentityRecord | null | undefined,
  requestedPolicyVersion: string,
  requestedModel: string,
  trustedClient: boolean,
  route: SharedPoolPersonaRoute = 'messages',
  requestedContext1M = false,
): PersonaDecision {
  const sharedPool = (config as any).shared_pool || {}
  const syntheticPersonaVariant = typeof sharedPool.message_beta_profile === 'string' && sharedPool.message_beta_profile.trim()
    ? sharedPool.message_beta_profile
    : inferLegacyPersonaVariant(String(config.env.version || requestedPolicyVersion))
  const resolvedIdentity = identity || {
    device_id: String(config.identity.device_id || ''),
    account_uuid_ref: 'opaque:synthetic-account-ref',
    account_ref: 'opaque:synthetic-account-ref',
    persona_variant: syntheticPersonaVariant,
    session_policy: 'preserve_downstream_session_id',
    policy_version: requestedPolicyVersion,
  }
  return resolvePersonaDecision({
    config,
    identity: resolvedIdentity,
    route,
    requestedPolicyVersion,
    requestedModel,
    trustedClient,
    requestedContext1M,
  })
}

export function validateSharedPoolPersonaHeaderSchema(
  headers: Record<string, string>,
  route: SharedPoolPersonaRoute,
  sessionId?: string,
): void {
  const allowed = new Set(SHARED_POOL_HEADER_ALLOWLIST)
  for (const key of Object.keys(headers)) {
    if (!allowed.has(key as typeof SHARED_POOL_HEADER_ALLOWLIST[number])) {
      throw new Error(`shared-pool persona header not allowlisted: ${key}`)
    }
  }
  const require = (key: string, pattern: RegExp) => {
    const value = headers[key]
    if (typeof value !== 'string' || !pattern.test(value)) {
      throw new Error(`shared-pool persona header schema mismatch: ${key}`)
    }
  }
  require('User-Agent', /^claude-cli\/\d+\.\d+\.\d+ \(external, sdk-cli\)$/)
  require('X-Stainless-Arch', /^[A-Za-z0-9._-]+$/)
  require('X-Stainless-Lang', /^js$/)
  require('X-Stainless-OS', /^(MacOS|Linux|Windows)$/)
  require('X-Stainless-Package-Version', /^\d+\.\d+\.\d+$/)
  require('X-Stainless-Retry-Count', /^0$/)
  require('X-Stainless-Runtime', /^[A-Za-z0-9._-]+$/)
  require('X-Stainless-Runtime-Version', /^v[\w.-]+$/)
  require('X-Stainless-Timeout', /^\d+$/)
  require('anthropic-version', /^2023-06-01$/)
  require('anthropic-dangerous-direct-browser-access', /^true$/)
  require('x-app', /^cli$/)
  require('Accept', /^application\/json$/)
  require('Accept-Encoding', /^gzip, deflate, br, zstd$/)
  require('anthropic-beta', /^claude-code-20250219,/)
  if (route === 'count_tokens' && !headers['anthropic-beta']) {
    throw new Error('shared-pool persona header schema mismatch: anthropic-beta')
  }
  if (sessionId) {
    require('X-Claude-Code-Session-Id', UUID_LIKE_SESSION_ID)
    if (headers['X-Claude-Code-Session-Id'] !== sessionId) {
      throw new Error('shared-pool persona header schema mismatch: X-Claude-Code-Session-Id')
    }
  }
}

export function selectSharedPoolRoute(method: string, pathname: string, search = ''): SharedPoolRoutePolicy {
  if (method !== 'POST') {
    return { action: 'block', status: 404, code: 'unsupported_route' }
  }
  if (pathname === '/v1/models') {
    return search === '?beta=true'
      ? { action: 'block', status: 403, code: 'formal_pool_control_plane_unapproved' }
      : { action: 'block', status: 404, code: 'unsupported_route' }
  }
  if (pathname === '/v1/messages') {
    return search === '?beta=true'
      ? { action: 'forward', kind: 'messages' }
      : { action: 'block', status: 404, code: 'unsupported_route' }
  }
  if (pathname === '/v1/messages/count_tokens') {
    return search === '?beta=true'
      ? { action: 'block', status: 403, code: 'formal_pool_count_tokens_profile_unapproved' }
      : { action: 'block', status: 404, code: 'unsupported_route' }
  }
  if (pathname === '/api/event_logging/batch') {
    return search === ''
      ? { action: 'suppress', kind: 'event_logging_legacy' }
      : { action: 'block', status: 404, code: 'unsupported_event_logging_route' }
  }
  if (pathname === '/api/event_logging/v2/batch') {
    return search === ''
      ? { action: 'suppress', kind: 'event_logging_v2' }
      : { action: 'block', status: 404, code: 'unsupported_event_logging_route' }
  }
  if (pathname.startsWith('/api/event_logging/')) {
    return { action: 'block', status: 404, code: 'unsupported_event_logging_route' }
  }
  return { action: 'block', status: 404, code: 'unsupported_route' }
}


export type SigningPipelineResult =
  | {
    ok: false
    code:
      | 'signing_mode_disabled'
      | 'signing_evidence_gates_unapproved'
      | 'signing_invalid_json'
      | 'signing_untrusted_billing_input'
      | 'signing_placeholder_missing'
      | 'signing_verifier_failed'
      | 'sign_primary_2177_oracle_missing'
  }
  | { ok: true; body: Buffer; cch: string; ccVersionSuffix: string }

const CC_VERSION_SALT = '59cf53e54c78'
const CC_VERSION_POSITIONS = [4, 7, 20]
const BILLING_HEADER_PREFIX = 'x-anthropic-billing-header:'
const CCH_SEED = 0x4d659218e32a3268n
const CCH_MASK = 0xfffffn
const UINT64_MASK = 0xffffffffffffffffn
const PRIME64_1 = 0x9e3779b185ebca87n
const PRIME64_2 = 0xc2b2ae3d27d4eb4fn
const PRIME64_3 = 0x165667b19e3779f9n
const PRIME64_4 = 0x85ebca77c2b2ae63n
const PRIME64_5 = 0x27d4eb2f165667c5n

export function runSigningPipeline(
  config: Config,
  body: Buffer,
  options: { cliVersion?: string } = {},
): SigningPipelineResult {
  const sharedPool = (config as any).shared_pool || {}
  if (!sharedPool.signing_enabled) return { ok: false, code: 'signing_mode_disabled' }
  if (!sharedPool.signing_evidence_gates_approved) return { ok: false, code: 'signing_evidence_gates_unapproved' }
  const version = String(options.cliVersion || config.env.version)
  if (!isSignPrimaryAllowedForVersion(version, config)) return { ok: false, code: 'sign_primary_2177_oracle_missing' }

  let parsed: any
  try {
    parsed = JSON.parse(body.toString('utf-8'))
  } catch {
    return { ok: false, code: 'signing_invalid_json' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, code: 'signing_invalid_json' }

  const cleaned = removeExistingBillingMaterial(parsed)
  if (!cleaned.ok) return { ok: false, code: cleaned.code }

  const firstUserText = extractFirstUserText(parsed.messages)
  const ccVersionSuffix = computeCCVersionSuffix(firstUserText, version)
  const billingHeader = `${BILLING_HEADER_PREFIX} cc_version=${version}.${ccVersionSuffix}; cc_entrypoint=sdk-cli; cch=00000;`
  prependBillingHeader(parsed, billingHeader)

  const placeholderBody = Buffer.from(JSON.stringify(parsed), 'utf-8')
  if (!placeholderBody.includes(Buffer.from('cch=00000;'))) return { ok: false, code: 'signing_placeholder_missing' }
  const cch = computeCCH5Hex(placeholderBody, version)
  const signed = Buffer.from(placeholderBody.toString('utf-8').replace('cch=00000;', `cch=${cch};`), 'utf-8')
  const verifier = verifySignedCCH(signed)
  if (!verifier.ok || verifier.cch !== cch) return { ok: false, code: 'signing_verifier_failed' }
  return { ok: true, body: signed, cch, ccVersionSuffix }
}


export function isSignPrimaryAllowedForVersion(version: string, config: Config): boolean {
  const normalized = String(version || '').trim()
  const sharedPool = (config as any).shared_pool || {}
  if (normalized === '2.1.177') {
    return sharedPool.signing_2177_oracle_profile_approved === true
      && isSafeIdentityRef(sharedPool.signing_2177_oracle_profile_ref)
  }
  if (normalized === '2.1.179') {
    return sharedPool.signed_cch_2179_oracle_profile_approved === true
      && sharedPool.signed_cch_2179_oracle_profile_ref === 'claude_code_2_1_179_first_party_signed_cch_oracle_cp1_degraded_v1'
  }
  return false
}

function isSafeProfileApprovalRef(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed === value && /^[A-Za-z0-9._:-]{1,160}$/.test(trimmed)
}

export function computeCCVersionSuffix(firstUserText: string, cliVersion: string): string {
  const chars = CC_VERSION_POSITIONS.map((i) => firstUserText[i] || '0').join('')
  return createHash('sha256')
    .update(`${CC_VERSION_SALT}${chars}${cliVersion}`)
    .digest('hex')
    .slice(0, 3)
}

export function verifySignedCCH(body: Buffer): { ok: true; cch: string } | { ok: false; code: 'signing_placeholder_missing' | 'signing_verifier_failed' } {
  const text = body.toString('utf-8')
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, code: 'signing_verifier_failed' }
  }
  const billing = locateTrustedBillingHeader(parsed)
  if (!billing.ok) return { ok: false, code: billing.code }
  if (containsCCHValueMarkerOutsidePath(parsed, billing.path)) {
    return { ok: false, code: 'signing_verifier_failed' }
  }
  const normalizedText = text.replace(billing.text, billing.text.replace(`cch=${billing.cch};`, 'cch=00000;'))
  const expected = computeCCH5Hex(Buffer.from(normalizedText, 'utf-8'), billing.version)
  if (expected !== billing.cch) return { ok: false, code: 'signing_verifier_failed' }
  return { ok: true, cch: expected }
}

type TrustedBillingHeaderLocation =
  | { ok: true; text: string; cch: string; version: string; path: Array<string | number> }
  | { ok: false; code: 'signing_placeholder_missing' | 'signing_verifier_failed' }

function locateTrustedBillingHeader(parsed: any): TrustedBillingHeaderLocation {
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.system)) {
    return { ok: false, code: 'signing_placeholder_missing' }
  }

  const candidates: Array<{ text: string; path: Array<string | number> }> = []
  parsed.system.forEach((item: any, index: number) => {
    const text = typeof item === 'string' ? item : item?.type === 'text' ? item.text : undefined
    if (typeof text !== 'string' || !isBillingHeaderText(text)) return
    candidates.push({ text, path: typeof item === 'string' ? ['system', index] : ['system', index, 'text'] })
  })

  if (candidates.length === 0) return { ok: false, code: 'signing_placeholder_missing' }
  if (candidates.length !== 1) return { ok: false, code: 'signing_verifier_failed' }

  const [candidate] = candidates
  const cch = candidate.text.match(/\bcch=([a-f0-9]{5});/i)?.[1]
  const version = extractBillingCLIVersion(candidate.text)
  if (!cch || !version) return { ok: false, code: 'signing_verifier_failed' }
  return { ok: true, text: candidate.text, cch, version, path: candidate.path }
}

function containsCCHValueMarkerOutsidePath(value: any, allowedPath: Array<string | number>, path: Array<string | number> = []): boolean {
  if (typeof value === 'string') {
    return !samePath(path, allowedPath) && /\bcch=[a-f0-9]{5}\b/i.test(value)
  }
  if (Array.isArray(value)) return value.some((item, index) => containsCCHValueMarkerOutsidePath(item, allowedPath, [...path, index]))
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, child]) => containsCCHValueMarkerOutsidePath(child, allowedPath, [...path, key]))
  }
  return false
}

function samePath(left: Array<string | number>, right: Array<string | number>): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index])
}

function extractFirstUserText(messages: any): string {
  if (!Array.isArray(messages)) return ''
  const firstUser = messages.find((message: any) => message?.role === 'user')
  if (!firstUser) return ''
  if (typeof firstUser.content === 'string') {
    return firstUser.content.includes('<system-reminder>') ? '' : firstUser.content
  }
  if (Array.isArray(firstUser.content)) {
    const block = firstUser.content.find((item: any) => {
      return item?.type === 'text' && typeof item.text === 'string' && !item.text.includes('<system-reminder>')
    })
    return block?.text || ''
  }
  return ''
}

function removeExistingBillingMaterial(body: any): { ok: true } | { ok: false; code: 'signing_untrusted_billing_input' } {
  if (Array.isArray(body.system)) {
    const kept: any[] = []
    for (const item of body.system) {
      const text = typeof item === 'string' ? item : item?.text
      if (typeof text === 'string' && isBillingHeaderText(text)) continue
      kept.push(item)
    }
    body.system = kept
  } else if (typeof body.system === 'string') {
    body.system = body.system
      .split(/\r?\n/)
      .filter((line: string) => !isBillingHeaderText(line))
      .join('\n')
  }

  if (containsCCHValueMarker(body)) return { ok: false, code: 'signing_untrusted_billing_input' }
  return { ok: true }
}

function isBillingHeaderText(text: string): boolean {
  return text.trimStart().toLowerCase().startsWith(BILLING_HEADER_PREFIX)
}

function containsCCHValueMarker(value: any): boolean {
  if (typeof value === 'string') return /\bcch=[a-f0-9]{5}\b/i.test(value)
  if (Array.isArray(value)) return value.some(containsCCHValueMarker)
  if (value && typeof value === 'object') return Object.values(value).some(containsCCHValueMarker)
  return false
}

function prependBillingHeader(body: any, header: string) {
  const billingBlock = { type: 'text', text: header }
  if (Array.isArray(body.system)) {
    body.system = [billingBlock, ...body.system]
    return
  }
  if (typeof body.system === 'string' && body.system.trim() !== '') {
    body.system = [billingBlock, { type: 'text', text: body.system }]
    return
  }
  body.system = [billingBlock]
}

function computeCCH5Hex(bodyWithPlaceholder: Buffer, cliVersion = ''): string {
  const preimage = cchPreimage(bodyWithPlaceholder, cliVersion)
  const digest = xxh64(preimage, CCH_SEED)
  return (digest & CCH_MASK).toString(16).padStart(5, '0')
}

function cchPreimage(bodyWithPlaceholder: Buffer, cliVersion: string): Buffer {
  if (!usesNormalizedCCHPreimage(cliVersion)) return bodyWithPlaceholder
  try {
    const parsed = JSON.parse(bodyWithPlaceholder.toString('utf-8'))
    return Buffer.from(JSON.stringify(normalizeCCHPreimageValue(parsed)), 'utf-8')
  } catch {
    return bodyWithPlaceholder
  }
}

function normalizeCCHPreimageValue(value: any): any {
  if (Array.isArray(value)) return value.map(normalizeCCHPreimageValue)
  if (value && typeof value === 'object') {
    const normalized: Record<string, any> = Object.create(null)
    for (const [key, child] of Object.entries(value)) {
      if (key === 'model' && typeof child === 'string') {
        defineNormalizedProperty(normalized, key, '')
      } else if (key === 'max_tokens' && typeof child === 'number') {
        // Claude Code 2.1.172+ omits numeric max_tokens from the CCH preimage only.
      } else {
        defineNormalizedProperty(normalized, key, normalizeCCHPreimageValue(child))
      }
    }
    return normalized
  }
  return value
}

function defineNormalizedProperty(target: Record<string, any>, key: string, value: any) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

function extractBillingCLIVersion(billingHeader: string): string {
  return billingHeader.match(/\bcc_version=(\d+\.\d+\.\d+)(?:\.[a-f0-9]{3})?;/i)?.[1] || ''
}

function usesNormalizedCCHPreimage(cliVersion: string): boolean {
  const version = parseCLIVersion(cliVersion)
  if (!version) return false
  if (version.major !== 2 || version.minor !== 1) return version.major > 2 || (version.major === 2 && version.minor > 1)
  return version.patch >= 172
}

function parseCLIVersion(cliVersion: string): { major: number; minor: number; patch: number } | null {
  const match = String(cliVersion || '').match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!match) return null
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  }
}

function xxh64(input: Buffer, seed: bigint): bigint {
  let offset = 0
  const len = input.length
  let acc: bigint

  if (len >= 32) {
    const limit = len - 32
    let v1 = u64(seed + PRIME64_1 + PRIME64_2)
    let v2 = u64(seed + PRIME64_2)
    let v3 = u64(seed)
    let v4 = u64(seed - PRIME64_1)
    while (offset <= limit) {
      v1 = xxh64Round(v1, input.readBigUInt64LE(offset)); offset += 8
      v2 = xxh64Round(v2, input.readBigUInt64LE(offset)); offset += 8
      v3 = xxh64Round(v3, input.readBigUInt64LE(offset)); offset += 8
      v4 = xxh64Round(v4, input.readBigUInt64LE(offset)); offset += 8
    }
    acc = u64(rotl64(v1, 1n) + rotl64(v2, 7n) + rotl64(v3, 12n) + rotl64(v4, 18n))
    acc = xxh64MergeRound(acc, v1)
    acc = xxh64MergeRound(acc, v2)
    acc = xxh64MergeRound(acc, v3)
    acc = xxh64MergeRound(acc, v4)
  } else {
    acc = u64(seed + PRIME64_5)
  }

  acc = u64(acc + BigInt(len))

  while (offset + 8 <= len) {
    const lane = xxh64Round(0n, input.readBigUInt64LE(offset))
    acc = u64(rotl64(acc ^ lane, 27n) * PRIME64_1 + PRIME64_4)
    offset += 8
  }

  if (offset + 4 <= len) {
    acc = u64(rotl64(acc ^ (BigInt(input.readUInt32LE(offset)) * PRIME64_1), 23n) * PRIME64_2 + PRIME64_3)
    offset += 4
  }

  while (offset < len) {
    acc = u64(rotl64(acc ^ (BigInt(input[offset]) * PRIME64_5), 11n) * PRIME64_1)
    offset += 1
  }

  acc ^= acc >> 33n
  acc = u64(acc * PRIME64_2)
  acc ^= acc >> 29n
  acc = u64(acc * PRIME64_3)
  acc ^= acc >> 32n
  return u64(acc)
}

function xxh64Round(acc: bigint, lane: bigint): bigint {
  return u64(rotl64(u64(acc + u64(lane * PRIME64_2)), 31n) * PRIME64_1)
}

function xxh64MergeRound(acc: bigint, lane: bigint): bigint {
  return u64(u64((acc ^ xxh64Round(0n, lane)) * PRIME64_1) + PRIME64_4)
}

function rotl64(value: bigint, bits: bigint): bigint {
  const normalized = u64(value)
  return u64((normalized << bits) | (normalized >> (64n - bits)))
}

function u64(value: bigint): bigint {
  return value & UINT64_MASK
}

export function getSharedPoolMaxBodyBytes(config: Config): number {
  const sharedPool = (config as any).shared_pool || {}
  const raw = sharedPool.max_body_bytes
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  if (sharedPool.upstream_mode === 'production' && sharedPool.production_budget?.mode === 'observe_only') {
    return Number.MAX_SAFE_INTEGER
  }
  return DEFAULT_SHARED_POOL_MAX_BODY_BYTES
}

export function resolveAccountIdentity(config: Config, accountId: string | undefined): AccountIdentityRecord | null {
  if (!accountId) return null
  const identities = (config as any).account_identities as Record<string, AccountIdentityRecord> | undefined
  const identity = identities?.[accountId]
  const accountUuidRef = accountIdentityRef(identity)
  if (!identity || !identity.device_id || !accountUuidRef || !isSafeIdentityRef(accountUuidRef) || !identity.persona_variant || !identity.session_policy || !identity.policy_version) {
    return null
  }
  const emailRef = identity.email_ref || identity.email_hash
  const accountRef = identity.account_ref || identity.account_hash
  if (emailRef && !isSafeIdentityRef(emailRef)) return null
  if (accountRef && !isSafeIdentityRef(accountRef)) return null
  if (identity.account_uuid_ref && !isSafeIdentityRef(identity.account_uuid_ref)) return null
  if (identity.account_uuid_hash && !isSafeLegacyHashRef(identity.account_uuid_hash)) {
    return null
  }
  return {
    ...identity,
    account_uuid_ref: accountUuidRef,
    email_ref: emailRef,
    account_ref: accountRef,
  }
}

export function resolveEgressBucket(config: Config, bucketId: string | undefined, accountId: string | undefined): EgressBucketResolution | { error: string } {
  if (!bucketId) return { error: 'missing_egress_bucket' }
  const buckets = (config as any).egress_buckets as Record<string, EgressBucketRecord> | undefined
  const bucket = buckets?.[bucketId]
  if (!bucket) return { error: 'unknown_egress_bucket' }
  if (!bucket.enabled) return { error: 'disabled_egress_bucket' }
  if (!bucket.proxy_url || bucket.proxy_url === 'undefined' || bucket.proxy_url === 'null') return { error: 'missing_egress_proxy' }
  try {
    const parsed = new URL(bucket.proxy_url)
    if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol) || !parsed.hostname) return { error: 'invalid_egress_proxy' }
  } catch {
    return { error: 'invalid_egress_proxy' }
  }
  if (!Array.isArray(bucket.allowed_account_ids) || bucket.allowed_account_ids.length === 0) {
    return { error: 'missing_egress_account_allowlist' }
  }
  if (!accountId || !bucket.allowed_account_ids.includes(accountId)) {
    return { error: 'egress_bucket_account_denied' }
  }
  const proxyIdentityRef = bucket.proxy_identity_ref || bucket.proxy_identity_hash || buildScopedOpaqueRef('proxy-ref', bucket.proxy_url)
  if (!isSafeIdentityRef(proxyIdentityRef)) return { error: 'invalid_egress_proxy_identity_ref' }
  if (bucket.tls_profile_ref !== undefined && !isSafeTLSProfileRef(bucket.tls_profile_ref)) return { error: 'invalid_egress_tls_profile_ref' }
  return {
    bucketId,
    proxyUrl: bucket.proxy_url,
    proxyIdentityRef,
    ...(bucket.tls_profile_ref ? { tlsProfileRef: bucket.tls_profile_ref } : {}),
  }
}

export function normalizeSharedPoolSessionId(
  body: unknown,
  existingSessionId: string | undefined,
  identity: AccountIdentityRecord,
): string | undefined {
  const obj = typeof body === 'object' && body !== null ? body as any : null
  if (!obj) return undefined
  if (!obj.metadata || typeof obj.metadata !== 'object') obj.metadata = {}
  const raw = obj.metadata.user_id
  let parsedUserId: any = null
  if (typeof raw === 'string') {
    try {
      parsedUserId = JSON.parse(raw)
    } catch {
      parsedUserId = null
    }
  }
  const sessionId = canonicalClaudeCodeSessionId(existingSessionId)
    || canonicalClaudeCodeSessionId(parsedUserId?.session_id)
    || randomUUID()
  obj.metadata.user_id = JSON.stringify({
    device_id: identity.device_id,
    account_uuid: accountIdentityRef(identity),
    session_id: sessionId,
  })
  return sessionId
}

export function accountIdentityRef(identity: AccountIdentityRecord | null | undefined): string {
  return identity?.account_uuid_ref || identity?.account_uuid_hash || ''
}

function isSafeLegacyHashRef(value: string): boolean {
  return isSafeIdentityRef(value) && (value.startsWith('hmac-sha256:') || value.startsWith('scoped_hmac_ref:'))
}

export function isSafeIdentityRef(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed !== value || !trimmed || trimmed.length > 512) return false
  if (RAW_UUID_LIKE.test(trimmed) || RAW_EMAIL_LIKE.test(trimmed) || PLAIN_DIGEST_REF.test(trimmed) || TOKEN_LIKE_MATERIAL.test(trimmed)) return false
  if (trimmed.includes('\n') || trimmed.includes('\r')) return false
  if (trimmed.includes('://') || trimmed.includes('@')) return false
  if (trimmed.startsWith('opaque:')) return trimmed.length > 'opaque:'.length
  if (trimmed.startsWith('hmac-sha256:')) return trimmed.length > 'hmac-sha256:'.length
  if (trimmed.startsWith('scoped_hmac_ref:')) return trimmed.length > 'scoped_hmac_ref:'.length
  return false
}

export function canonicalClaudeCodeSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return UUID_LIKE_SESSION_ID.test(trimmed) ? trimmed : undefined
}

function buildScopedOpaqueRef(scope: string, value: string): string {
  void value
  return `opaque:${scope}:v1:omitted_by_policy`
}

function canonicalStainlessOS(config: Config): string {
  const platform = String(config.env.platform || '').toLowerCase()
  if (platform === 'darwin') return 'MacOS'
  if (platform === 'linux') return 'Linux'
  if (platform === 'win32' || platform === 'windows') return 'Windows'
  return platform || 'MacOS'
}
