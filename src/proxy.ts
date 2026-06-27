import { createServer as createHttpsServer, type ServerOptions } from 'https'
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'http'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { request as httpsRequest } from 'https'
import { URL } from 'url'
import { dirname } from 'path'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'zlib'
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import { isProductionFormalPool, type Config } from './config.js'
import { authenticate, authenticateGateway, initAuth } from './auth.js'
import { getAccessToken } from './oauth.js'
import { rewriteBody, rewriteHeaders } from './rewriter.js'
import { audit, log } from './logger.js'
import { getProxyAgent } from './proxy-agent.js'
import {
  canonicalClaudeCodeSessionId,
  accountIdentityRef,
  computeCCVersionSuffix,
  canonicalPersonaHeaders,
  getSharedPoolMaxBodyBytes,
  isSafeIdentityRef,
  isSignPrimaryAllowedForVersion,
  normalizeSharedPoolSessionId,
  resolveAccountIdentity,
  resolveEgressBucket,
  resolveSharedPoolPersonaDecision,
  runSigningPipeline,
  selectSharedPoolRoute,
  validateSharedPoolPersonaHeaderSchema,
  verifySignedCCH,
  type AccountIdentityRecord,
  type EgressBucketResolution,
  type SharedPoolPersonaRoute,
} from './policy.js'
import { redactRequestPath, redactSensitiveText } from './redaction.js'
import { evaluateUpstreamSafety } from './upstream-safety.js'
import { evaluateCanaryCostEnvelope } from './canary-cost-gate.js'
import { resolvePersonaProfileId } from './persona-registry.js'

const TRUSTED_PERSONA_HEADER = 'x-sub2api-persona-trusted'
const HEALTHCHECK_PERSONA_HEADER = 'x-sub2api-healthcheck-persona'
const CONTEXT_1M_REQUEST_HEADER = 'x-sub2api-context-1m'
const INTERNAL_CONTROL_HEADER = 'x-cc-internal-control-token'
const HEALTHCHECK_2175_NON_1M_PROFILE = 'claude_code_2_1_175_api_key_non_1m'
const HEALTHCHECK_2179_NATIVE_DEGRADED_PROFILE = 'claude_code_2_1_179_native_degraded'
const RUNTIME_REGISTER_PATH = '/_runtime/register-account'
const RUNTIME_MAPPING_FILE_ENV = 'CC_GATEWAY_RUNTIME_MAPPING_FILE'
const RUNTIME_MAPPING_DEFAULT_DOCKER_FILE = '/app/runtime/runtime-mappings.json'
const FORMAL_POOL_SESSION_LEDGER_FILE_ENV = 'CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FILE'
const FORMAL_POOL_SESSION_LEDGER_DEFAULT_DOCKER_FILE = '/app/runtime/formal-pool-session-ledger.json'
const FORMAL_POOL_CONTEXT_HEADER = 'x-cc-formal-pool-context'
const FORMAL_POOL_SIGNATURE_HEADER = 'x-cc-formal-pool-signature'
const FORMAL_POOL_ATTESTATION_MAX_SKEW_MS = 5 * 60 * 1000
const FORMAL_POOL_SESSION_LEDGER_FAIL_WRITE_FOR_TEST_ENV = 'CC_GATEWAY_FORMAL_POOL_SESSION_LEDGER_FAIL_WRITE_FOR_TEST'
const FORMAL_POOL_DEFAULT_EGRESS_PROFILE_REF = 'strip_attribution'
const FORMAL_POOL_2179_PROFILE_POLICY_VERSION = 'claude_code_2_1_179_cp1_degraded_v1'
const FORMAL_POOL_2179_REQUEST_SHAPE_PROFILE_REF = 'claude_code_2_1_179_messages_streaming_tooldefs_degraded_v1'
const FORMAL_POOL_2179_CACHE_PARITY_PROFILE_REF = 'claude_code_2_1_179_cache_parity_degraded_v1'
const FORMAL_POOL_2179_NO_CCH_PROFILE_REF = 'claude_code_2_1_179_custom_base_no_cch'
const FORMAL_POOL_2179_SIGNED_CCH_PROFILE_REF = 'claude_code_2_1_179_first_party_signed_cch'
const FORMAL_POOL_2179_NO_CCH_ORACLE_PROFILE_REF = 'claude_code_2_1_179_custom_base_no_cch_oracle_cp1_degraded_v1'
const FORMAL_POOL_2179_SIGNED_CCH_ORACLE_PROFILE_REF = 'claude_code_2_1_179_first_party_signed_cch_oracle_cp1_degraded_v1'
const CLAUDE_PLATFORM_AWS_PROVIDER_KIND = 'claude_platform_aws'
const CLAUDE_PLATFORM_AWS_REQUEST_SHAPE_PROFILE_REF = 'request-shape:claude-platform-aws-v1-strip'
const CLAUDE_PLATFORM_AWS_CACHE_PARITY_PROFILE_REF = 'cache-profile:claude-platform-aws-v1-strip'
const CLAUDE_PLATFORM_AWS_BETA_POLICY_REF = 'beta-policy:claude-platform-aws-v1-strip'
const CLAUDE_PLATFORM_AWS_ALLOWED_PATH = '/v1/messages'
const CLAUDE_PLATFORM_AWS_HOST_PREFIX = 'aws-external-anthropic.'
const CLAUDE_PLATFORM_AWS_HOST_SUFFIX = '.api.aws'
const SAFE_PROFILE_REF = /^[A-Za-z0-9._:-]{1,160}$/
const OBSERVED_CLIENT_PROFILE_SAFE_KEYS = new Set([
  'schema_version',
  'cli_version_bucket',
  'route_class',
  'stream',
  'top_level_body_keys',
  'unknown_top_level_body_key_count',
  'tool_count',
  'thinking_present',
  'output_config_present',
  'context_management_present',
  'billing_block_count',
  'billing_shape',
  'cc_entrypoint_bucket',
])

type RuntimeRegisterRequest = {
  account_id?: unknown
  account_ref?: unknown
  account_uuid_ref?: unknown
  email_ref?: unknown
  credential_ref?: unknown
  credential_binding_hmac?: unknown
  token_type?: unknown
  egress_bucket?: unknown
  proxy_url?: unknown
  proxy_identity_ref?: unknown
  persona_variant?: unknown
  session_policy?: unknown
  policy_version?: unknown
  device_id?: unknown
  provider_kind?: unknown
  workspace_ref?: unknown
  workspace_binding_hmac?: unknown
  upstream_endpoint_ref?: unknown
  aws_region?: unknown
  upstream_host?: unknown
  allowed_upstream_path?: unknown
  upstream_auth_scheme?: unknown
  beta_policy_ref?: unknown
  request_shape_profile_ref?: unknown
  cache_parity_profile_ref?: unknown
  anthropic_workspace_id?: unknown
}

type RuntimeMappingRecord = {
  account_id: string
  account_ref: string
  account_uuid_ref: string
  email_ref?: string
  credential_ref: string
  credential_binding_hmac: string
  token_type: 'oauth' | 'apikey'
  egress_bucket: string
  proxy_url: string
  proxy_identity_ref: string
  persona_variant: string
  session_policy: 'preserve_downstream_session_id'
  policy_version: string
  device_id: string
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

type RuntimeMappingFile = {
  version: 1
  mappings: Record<string, RuntimeMappingRecord>
}

type FormalPoolSessionAuthorityBinding = {
  account_id: string
  credential_ref: string
  credential_source: 'server_account_credentials'
  egress_bucket: string
  proxy_identity_ref: string
  policy_version: string
  persona_profile: string
  trusted_egress_profile_ref: string
  profile_policy_version: string
  billing_shape_policy: FormalPoolBillingShapePolicy
  request_shape_profile_ref: string
  cache_parity_profile_ref: string
  device_ref: string
  provider_kind?: 'anthropic_first_party' | 'claude_platform_aws'
  workspace_ref?: string
  workspace_binding_hmac?: string
  upstream_endpoint_ref?: string
  aws_region?: string
  upstream_host?: string
  allowed_upstream_path?: string
  upstream_auth_scheme?: 'x_api_key' | 'bearer_api_key'
  beta_policy_ref?: string
}

type FormalPoolBillingShapePolicy = 'strip' | 'no_cch' | 'signed_cch'

type FormalPoolBillingMode = 'strip' | 'no_cch' | 'sign'

type FormalPoolSessionAuthorityLedgerFile = {
  version: 1
  sessions: Record<string, FormalPoolSessionAuthorityBinding>
  attestation_nonces: Record<string, number>
}

type ProxyRuntimeState = {
  formalPoolSessionAuthorityLedger: Map<string, FormalPoolSessionAuthorityBinding>
  formalPoolAttestationNonces: Map<string, number>
}

export function startProxy(config: Config) {
  initAuth(config)
  replayRuntimeMappings(config)

  const upstream = new URL(config.upstream.url)
  const useTls = config.server.tls?.cert && config.server.tls?.key
  const runtimeState: ProxyRuntimeState = {
    formalPoolSessionAuthorityLedger: new Map(),
    formalPoolAttestationNonces: new Map(),
  }

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    handleRequest(req, res, config, upstream, runtimeState)
  }

  let server
  if (useTls) {
    const tlsOptions: ServerOptions = {
      cert: readFileSync(config.server.tls.cert),
      key: readFileSync(config.server.tls.key),
    }
    server = createHttpsServer(tlsOptions, handler)
  } else {
    server = createHttpServer(handler)
    log('warn', 'Running without TLS - only use for local development')
  }

  const listenHost = config.server.host
  server.listen(config.server.port, listenHost, () => {
    const address = server.address()
    const boundHost = typeof address === 'object' && address ? address.address : '0.0.0.0'
    const boundPort = typeof address === 'object' && address ? address.port : config.server.port
    log('info', `CC Gateway listening on ${useTls ? 'https' : 'http'}://${boundHost}:${boundPort}`)
    log('info', `Upstream: ${redactSensitiveText(config.upstream.url)}`)
    log('info', `Canonical device_id: ${config.identity.device_id.slice(0, 8)}...`)
    log('info', `Authorized clients: ${config.auth.tokens.map(t => t.name).join(', ')}`)
  })

  return server
}

function writeControlPlaneError(res: ServerResponse, status: number, code: string, message: string) {
  const body = JSON.stringify({
    type: 'error',
    error: {
      type: 'cc_gateway_control_plane',
      code,
      message: redactSensitiveText(message),
    },
  })
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'X-CC-Gateway-Error-Kind': 'control-plane',
    'X-CC-Gateway-Error-Code': code,
  })
  res.end(body)
}

async function handleRuntimeRegister(req: IncomingMessage, res: ServerResponse, config: Config, method: string) {
  if (config.mode !== 'sub2api') {
    writeControlPlaneError(res, 404, 'unsupported_route', 'Runtime registration is only available in sub2api mode')
    return
  }
  if (method !== 'POST') {
    writeControlPlaneError(res, 405, 'method_not_allowed', 'Runtime registration requires POST')
    return
  }
  const clientName = authenticateForMode(req, config)
  if (!clientName) {
    writeControlPlaneError(res, 401, 'missing_gateway_token', 'Unauthorized - provide gateway token via x-cc-gateway-token header')
    return
  }
  const bodyResult = await readRequestBody(req, 64 * 1024)
  if ('error' in bodyResult) {
    writeControlPlaneError(res, 413, 'body_too_large', 'Runtime registration body exceeds configured cap')
    return
  }
  let parsed: RuntimeRegisterRequest
  try {
    parsed = JSON.parse(bodyResult.body.toString('utf-8'))
  } catch {
    writeControlPlaneError(res, 400, 'invalid_json', 'Runtime registration requires JSON')
    return
  }
  const result = registerRuntimeAccount(config, parsed, { req })
  if ('status' in result) {
    writeControlPlaneError(res, result.status, result.code, result.message)
    return
  }
  log('info', 'Runtime account mapping registered', {
    accountRef: 'omitted_by_policy',
    egressBucketRef: result.egressBucket.slice(0, 32),
  })
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    status: 'registered',
    registered: { account_identity: true, egress_bucket: true },
  }))
}

function registerRuntimeAccount(
  config: Config,
  input: RuntimeRegisterRequest,
  options: { persist?: boolean; req?: IncomingMessage; verifiedReplay?: boolean } = {},
): { egressBucket: string } | { status: number; code: string; message: string } {
  const normalized = normalizeRuntimeAccountMapping(config, input, options.req, options.verifiedReplay === true)
  if ('status' in normalized) return normalized
  const conflict = findRuntimeMappingConflict(config, normalized)
  if (conflict) return conflict
  if (options.persist !== false) {
    const persisted = persistRuntimeMapping(normalized)
    if (persisted) return persisted
  }
  applyRuntimeAccountMapping(config, normalized)
  return { egressBucket: normalized.egress_bucket }
}

function normalizeRuntimeAccountMapping(
  config: Config,
  input: RuntimeRegisterRequest,
  req?: IncomingMessage,
  verifiedReplay = false,
): RuntimeMappingRecord | { status: number; code: string; message: string } {
  const accountId = stringField(input.account_id)
  const accountRef = stringField(input.account_ref) || accountId
  const accountUuidRef = stringField(input.account_uuid_ref) || accountRef
  const emailRef = stringField(input.email_ref)
  const credentialRef = stringField(input.credential_ref)
  const credentialBindingHmac = stringField(input.credential_binding_hmac)
  const tokenType = stringField(input.token_type)
  const egressBucket = stringField(input.egress_bucket)
  const proxyUrl = stringField(input.proxy_url)
  const proxyIdentityRef = stringField(input.proxy_identity_ref)
  const policyVersion = stringField(input.policy_version) || String(config.env.version || '')
  const personaVariant = stringField(input.persona_variant) || `claude-code-${policyVersion}-macos-local`
  const sessionPolicy = stringField(input.session_policy) || 'preserve_downstream_session_id'
  const deviceId = stringField(input.device_id)
  const providerKind = stringField(input.provider_kind)
  const workspaceRef = stringField(input.workspace_ref)
  const workspaceBindingHmac = stringField(input.workspace_binding_hmac)
  const upstreamEndpointRef = stringField(input.upstream_endpoint_ref)
  const awsRegion = stringField(input.aws_region)
  const upstreamHost = stringField(input.upstream_host)
  const allowedUpstreamPath = stringField(input.allowed_upstream_path)
  const upstreamAuthScheme = stringField(input.upstream_auth_scheme)
  const betaPolicyRef = stringField(input.beta_policy_ref)
  const requestShapeProfileRef = stringField(input.request_shape_profile_ref)
  const cacheParityProfileRef = stringField(input.cache_parity_profile_ref)
  const anthropicWorkspaceId = stringField(input.anthropic_workspace_id)

  if (!accountId || !isSafeInternalRoutingKey(accountId)) return { status: 400, code: 'invalid_account_id', message: 'Runtime account id must be a safe internal routing key' }
  if (!accountRef || !isSafeIdentityRef(accountRef)) return { status: 400, code: 'invalid_account_ref', message: 'Runtime account ref must be a safe ref' }
  if (!accountUuidRef || !isSafeIdentityRef(accountUuidRef)) return { status: 400, code: 'invalid_account_uuid_ref', message: 'Runtime account uuid ref must be a safe ref' }
  if (emailRef && !isSafeIdentityRef(emailRef)) return { status: 400, code: 'invalid_email_ref', message: 'Runtime email ref must be a safe ref' }
  if (!credentialRef || !isSafeIdentityRef(credentialRef)) return { status: 400, code: 'invalid_credential_ref', message: 'Runtime credential ref must be a safe ref' }
  if (!/^hmac-sha256:[a-f0-9]{64}$/i.test(credentialBindingHmac)) return { status: 400, code: 'invalid_credential_binding_hmac', message: 'Runtime credential binding HMAC must be a keyed HMAC ref' }
  if (tokenType !== 'oauth' && tokenType !== 'apikey') {
    return { status: 400, code: 'invalid_token_type', message: 'Runtime registration token type is unsupported' }
  }
  if (!egressBucket || !isSafeInternalRoutingKey(egressBucket)) return { status: 400, code: 'invalid_egress_bucket', message: 'Runtime egress bucket must be a safe internal routing key' }
  if (!proxyIdentityRef || !isSafeIdentityRef(proxyIdentityRef)) return { status: 400, code: 'invalid_proxy_identity_ref', message: 'Runtime proxy identity ref must be a safe ref' }
  if (!policyVersion) return { status: 400, code: 'missing_policy_version', message: 'Runtime registration requires policy version' }
  if (!/^[a-f0-9]{64}$/i.test(deviceId)) return { status: 400, code: 'missing_device_id', message: 'Runtime registration requires account-owned 64-hex device_id' }
  if (sessionPolicy !== 'preserve_downstream_session_id') {
    return { status: 400, code: 'invalid_session_policy', message: 'Runtime registration session policy must be preserve_downstream_session_id until gateway_generated is implemented' }
  }
  const awsValidation = validateRuntimeClaudePlatformAWSFields({
    provider_kind: providerKind,
    token_type: tokenType,
    workspace_ref: workspaceRef,
    workspace_binding_hmac: workspaceBindingHmac,
    upstream_endpoint_ref: upstreamEndpointRef,
    aws_region: awsRegion,
    upstream_host: upstreamHost,
    allowed_upstream_path: allowedUpstreamPath,
    upstream_auth_scheme: upstreamAuthScheme,
    beta_policy_ref: betaPolicyRef,
    request_shape_profile_ref: requestShapeProfileRef,
    cache_parity_profile_ref: cacheParityProfileRef,
    anthropic_workspace_id: anthropicWorkspaceId,
  })
  if (awsValidation) return awsValidation
  const proxyValidation = validateRuntimeProxyUrl(proxyUrl)
  if (proxyValidation) return proxyValidation
  if (!verifiedReplay) {
    const credentialProof = req ? selectedRawCredentialForBinding(req, tokenType as 'oauth' | 'apikey') : undefined
    const secret = formalPoolAttestationSecret(config)
    if (!credentialProof || !secret) {
      return { status: 403, code: 'credential_account_mismatch', message: 'Runtime registration credential proof is required' }
    }
    const expectedHex = credentialBindingHmac.slice('hmac-sha256:'.length)
    const actualHex = credentialBindingHmacHex(secret, tokenType as 'oauth' | 'apikey', credentialProof)
    if (!safeEqualHex(actualHex, expectedHex)) {
      return { status: 403, code: 'credential_account_mismatch', message: 'Runtime registration credential proof does not match credential binding' }
    }
  }

  return {
    account_id: accountId,
    account_ref: accountRef,
    account_uuid_ref: accountUuidRef,
    ...(emailRef ? { email_ref: emailRef } : {}),
    credential_ref: credentialRef,
    credential_binding_hmac: credentialBindingHmac,
    token_type: tokenType as 'oauth' | 'apikey',
    egress_bucket: egressBucket,
    proxy_url: proxyUrl,
    proxy_identity_ref: proxyIdentityRef,
    persona_variant: personaVariant,
    session_policy: sessionPolicy as 'preserve_downstream_session_id',
    policy_version: policyVersion,
    device_id: deviceId,
    ...(providerKind ? { provider_kind: providerKind as 'anthropic_first_party' | 'claude_platform_aws' } : {}),
    ...(providerKind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND ? {
      workspace_ref: workspaceRef,
      workspace_binding_hmac: workspaceBindingHmac,
      upstream_endpoint_ref: upstreamEndpointRef,
      aws_region: awsRegion,
      upstream_host: upstreamHost,
      allowed_upstream_path: allowedUpstreamPath,
      upstream_auth_scheme: upstreamAuthScheme as 'x_api_key' | 'bearer_api_key',
      beta_policy_ref: betaPolicyRef,
      request_shape_profile_ref: requestShapeProfileRef,
      cache_parity_profile_ref: cacheParityProfileRef,
      anthropic_workspace_id: anthropicWorkspaceId,
    } : {}),
  }
}

function applyRuntimeAccountMapping(config: Config, mapping: RuntimeMappingRecord) {
  config.account_identities = config.account_identities || {}
  config.account_identities[mapping.account_id] = {
    device_id: mapping.device_id,
    account_uuid_ref: mapping.account_uuid_ref,
    account_ref: mapping.account_ref,
    ...(mapping.email_ref ? { email_ref: mapping.email_ref } : {}),
    credential_ref: mapping.credential_ref,
    credential_binding_hmac: mapping.credential_binding_hmac,
    token_type: mapping.token_type,
    persona_variant: mapping.persona_variant,
    session_policy: mapping.session_policy,
    policy_version: mapping.policy_version,
    ...(mapping.provider_kind ? { provider_kind: mapping.provider_kind } : {}),
    ...(mapping.provider_kind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND ? {
      workspace_ref: mapping.workspace_ref,
      workspace_binding_hmac: mapping.workspace_binding_hmac,
      upstream_endpoint_ref: mapping.upstream_endpoint_ref,
      aws_region: mapping.aws_region,
      upstream_host: mapping.upstream_host,
      allowed_upstream_path: mapping.allowed_upstream_path,
      upstream_auth_scheme: mapping.upstream_auth_scheme,
      beta_policy_ref: mapping.beta_policy_ref,
      request_shape_profile_ref: mapping.request_shape_profile_ref,
      cache_parity_profile_ref: mapping.cache_parity_profile_ref,
      anthropic_workspace_id: mapping.anthropic_workspace_id,
    } : {}),
  }
  config.egress_buckets = config.egress_buckets || {}
  config.egress_buckets[mapping.egress_bucket] = {
    enabled: true,
    proxy_url: mapping.proxy_url,
    proxy_identity_ref: mapping.proxy_identity_ref,
    allowed_account_ids: [mapping.account_id],
  }
}

function validateRuntimeProxyUrl(value: string): { status: number; code: string; message: string } | null {
  if (!value || value.length > 2048) return { status: 400, code: 'invalid_proxy_url', message: 'Runtime proxy URL is invalid' }
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol) || !parsed.hostname) {
      return { status: 400, code: 'invalid_proxy_url', message: 'Runtime proxy URL scheme is not supported' }
    }
  } catch {
    return { status: 400, code: 'invalid_proxy_url', message: 'Runtime proxy URL is invalid' }
  }
  return null
}

function validateRuntimeClaudePlatformAWSFields(input: Record<string, string>): { status: number; code: string; message: string } | null {
  const providerKind = input.provider_kind
  if (!providerKind) return null
  if (providerKind !== 'anthropic_first_party' && providerKind !== CLAUDE_PLATFORM_AWS_PROVIDER_KIND) {
    return { status: 400, code: 'invalid_provider_kind', message: 'Runtime registration provider kind is unsupported' }
  }
  if (providerKind !== CLAUDE_PLATFORM_AWS_PROVIDER_KIND) return null
  if (input.token_type !== 'apikey') {
    return { status: 400, code: 'invalid_token_type', message: 'Claude Platform on AWS phase 1 requires protected API-key credential proof' }
  }
  const requiredSafeRefs = [
    ['workspace_ref', input.workspace_ref, 'workspace:'],
    ['upstream_endpoint_ref', input.upstream_endpoint_ref, 'endpoint:'],
  ] as const
  for (const [label, value, prefix] of requiredSafeRefs) {
    if (!isSafeClaudePlatformAWSRef(value, prefix)) return { status: 400, code: `invalid_${label}`, message: 'Claude Platform on AWS runtime registration requires safe refs' }
  }
  if (!/^hmac-sha256:[a-f0-9]{64}$/i.test(input.workspace_binding_hmac)) {
    return { status: 400, code: 'invalid_workspace_binding_hmac', message: 'Claude Platform on AWS runtime registration requires workspace binding' }
  }
  if (!isSafeAWSRegion(input.aws_region)) return { status: 400, code: 'invalid_aws_region', message: 'Claude Platform on AWS runtime registration requires AWS region' }
  const expectedHost = claudePlatformAWSHostForRegion(input.aws_region)
  if (input.upstream_host !== expectedHost) {
    return { status: 400, code: 'invalid_upstream_host', message: 'Claude Platform on AWS runtime registration endpoint mismatch' }
  }
  if (input.allowed_upstream_path !== CLAUDE_PLATFORM_AWS_ALLOWED_PATH) {
    return { status: 400, code: 'invalid_allowed_upstream_path', message: 'Claude Platform on AWS phase 1 requires /v1/messages path' }
  }
  if (input.upstream_auth_scheme !== 'x_api_key' && input.upstream_auth_scheme !== 'bearer_api_key') {
    return { status: 400, code: 'invalid_upstream_auth_scheme', message: 'Claude Platform on AWS runtime registration requires proven auth scheme' }
  }
  if (input.upstream_auth_scheme !== 'x_api_key') {
    return { status: 403, code: 'claude_platform_aws_auth_profile_unproven', message: 'Claude Platform on AWS auth scheme is not enabled without CP0 evidence' }
  }
  if (input.beta_policy_ref !== CLAUDE_PLATFORM_AWS_BETA_POLICY_REF
    || input.request_shape_profile_ref !== CLAUDE_PLATFORM_AWS_REQUEST_SHAPE_PROFILE_REF
    || input.cache_parity_profile_ref !== CLAUDE_PLATFORM_AWS_CACHE_PARITY_PROFILE_REF) {
    return { status: 400, code: 'invalid_claude_platform_aws_profile', message: 'Claude Platform on AWS runtime registration requires provider-scoped profiles' }
  }
  if (!input.anthropic_workspace_id || /[\r\n]/.test(input.anthropic_workspace_id) || input.anthropic_workspace_id.length > 512) {
    return { status: 400, code: 'missing_anthropic_workspace_id', message: 'Claude Platform on AWS runtime registration requires workspace id in sensitive storage' }
  }
  return null
}

function isSafeInternalRoutingKey(value: string): boolean {
  if (!value || value.length > 128) return false
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) return false
  if (/^[0-9]+$/.test(value)) return false
  if (/^[a-f0-9]{64}$/i.test(value)) return false
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return false
  return !value.includes('@')
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function runtimeMappingFilePath(): string | null {
  const explicit = process.env[RUNTIME_MAPPING_FILE_ENV]?.trim()
  if (explicit) return explicit
  // Docker images run with WORKDIR=/app; keep local development side-effect free
  // while making container restarts recover mappings by default.
  if (process.cwd() === '/app') return RUNTIME_MAPPING_DEFAULT_DOCKER_FILE
  return null
}

function formalPoolSessionLedgerFilePath(): string | null {
  const explicit = process.env[FORMAL_POOL_SESSION_LEDGER_FILE_ENV]?.trim()
  if (explicit) return explicit
  if (process.cwd() === '/app') return FORMAL_POOL_SESSION_LEDGER_DEFAULT_DOCKER_FILE
  return null
}

function formalPoolSessionLedgerPersistenceRequired(config: Config): boolean {
  return isProductionFormalPool(config)
}

function replayRuntimeMappings(config: Config) {
  const file = runtimeMappingFilePath()
  if (!file) return
  const loaded = loadRuntimeMappingFile(file)
  const entries = Object.values(loaded.mappings)
  let registered = 0
  let failed = 0
  for (const mapping of entries) {
    const result = registerRuntimeAccount(config, mapping, { persist: false, verifiedReplay: true })
    if ('status' in result) {
      failed++
      continue
    }
    registered++
  }
  if (entries.length > 0 || failed > 0) {
    log('info', 'Runtime account mappings replayed', { registered, failed })
  }
}

function persistRuntimeMapping(mapping: RuntimeMappingRecord): { status: number; code: string; message: string } | null {
  const file = runtimeMappingFilePath()
  if (!file) return null
  try {
    const existing = loadRuntimeMappingFile(file)
    const conflict = findRuntimeMappingFileConflict(existing, mapping)
    if (conflict) return conflict
    existing.mappings[mapping.account_id] = mapping
    writeRuntimeMappingFile(file, existing)
    return null
  } catch (err) {
    log('error', 'Runtime account mapping persistence failed', { error: err instanceof Error ? err.message : 'unknown' })
    return { status: 500, code: 'runtime_mapping_persist_failed', message: 'Runtime account mapping could not be persisted for replay' }
  }
}

function findRuntimeMappingConflict(
  config: Config,
  mapping: RuntimeMappingRecord,
): { status: number; code: string; message: string } | null {
  const existingIdentity = config.account_identities?.[mapping.account_id]
  if (existingIdentity) {
    const existing: RuntimeMappingRecord = {
      account_id: mapping.account_id,
      account_ref: existingIdentity.account_ref || existingIdentity.account_hash || existingIdentity.account_uuid_ref || existingIdentity.account_uuid_hash || '',
      account_uuid_ref: existingIdentity.account_uuid_ref || existingIdentity.account_uuid_hash || '',
      ...(existingIdentity.email_ref || existingIdentity.email_hash ? { email_ref: existingIdentity.email_ref || existingIdentity.email_hash } : {}),
      credential_ref: existingIdentity.credential_ref || '',
      credential_binding_hmac: existingIdentity.credential_binding_hmac || '',
      token_type: existingIdentity.token_type || mapping.token_type,
      egress_bucket: mapping.egress_bucket,
      proxy_url: mapping.proxy_url,
      proxy_identity_ref: mapping.proxy_identity_ref,
      persona_variant: existingIdentity.persona_variant,
      session_policy: existingIdentity.session_policy,
      policy_version: existingIdentity.policy_version,
      device_id: existingIdentity.device_id,
      ...(existingIdentity.provider_kind ? { provider_kind: existingIdentity.provider_kind } : {}),
      ...(existingIdentity.provider_kind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND ? {
        workspace_ref: existingIdentity.workspace_ref,
        workspace_binding_hmac: existingIdentity.workspace_binding_hmac,
        upstream_endpoint_ref: existingIdentity.upstream_endpoint_ref,
        aws_region: existingIdentity.aws_region,
        upstream_host: existingIdentity.upstream_host,
        allowed_upstream_path: existingIdentity.allowed_upstream_path,
        upstream_auth_scheme: existingIdentity.upstream_auth_scheme,
        beta_policy_ref: existingIdentity.beta_policy_ref,
        request_shape_profile_ref: existingIdentity.request_shape_profile_ref,
        cache_parity_profile_ref: existingIdentity.cache_parity_profile_ref,
        anthropic_workspace_id: existingIdentity.anthropic_workspace_id,
      } : {}),
    }
    const existingBucket = findExistingRuntimeBucketForAccount(config, mapping.account_id)
    if (!existingBucket || !sameRuntimeMappingAuthority({ ...existing, ...existingBucket }, mapping)) {
      return { status: 409, code: 'runtime_mapping_authority_exists', message: 'Runtime account authority mapping already exists' }
    }
  }
  for (const [bucketId, bucket] of Object.entries(config.egress_buckets || {})) {
    if (bucketId !== mapping.egress_bucket) continue
    if (!bucket.allowed_account_ids?.includes(mapping.account_id)
      || bucket.proxy_url !== mapping.proxy_url
      || (bucket.proxy_identity_ref || bucket.proxy_identity_hash || '') !== mapping.proxy_identity_ref) {
      return { status: 409, code: 'runtime_mapping_authority_exists', message: 'Runtime egress authority mapping already exists' }
    }
  }
  return null
}

function findExistingRuntimeBucketForAccount(
  config: Config,
  accountId: string,
): Pick<RuntimeMappingRecord, 'egress_bucket' | 'proxy_url' | 'proxy_identity_ref'> | null {
  for (const [bucketId, bucket] of Object.entries(config.egress_buckets || {})) {
    if (bucket.allowed_account_ids?.includes(accountId)) {
      return {
        egress_bucket: bucketId,
        proxy_url: bucket.proxy_url,
        proxy_identity_ref: bucket.proxy_identity_ref || bucket.proxy_identity_hash || '',
      }
    }
  }
  return null
}

function findRuntimeMappingFileConflict(
  file: RuntimeMappingFile,
  mapping: RuntimeMappingRecord,
): { status: number; code: string; message: string } | null {
  for (const existing of Object.values(file.mappings)) {
    const sameAccount = existing.account_id === mapping.account_id
    const sameBucket = existing.egress_bucket === mapping.egress_bucket
    if ((sameAccount || sameBucket) && !sameRuntimeMappingAuthority(existing, mapping)) {
      return { status: 409, code: 'runtime_mapping_authority_exists', message: 'Runtime account authority mapping already exists' }
    }
  }
  return null
}

function sameRuntimeMappingAuthority(a: RuntimeMappingRecord, b: RuntimeMappingRecord): boolean {
  return a.account_id === b.account_id
    && a.account_ref === b.account_ref
    && a.account_uuid_ref === b.account_uuid_ref
    && (a.email_ref || '') === (b.email_ref || '')
    && a.credential_ref === b.credential_ref
    && a.credential_binding_hmac === b.credential_binding_hmac
    && a.token_type === b.token_type
    && a.egress_bucket === b.egress_bucket
    && a.proxy_url === b.proxy_url
    && a.proxy_identity_ref === b.proxy_identity_ref
    && a.persona_variant === b.persona_variant
    && a.session_policy === b.session_policy
    && a.policy_version === b.policy_version
    && a.device_id === b.device_id
    && (a.provider_kind || '') === (b.provider_kind || '')
    && (a.workspace_ref || '') === (b.workspace_ref || '')
    && (a.workspace_binding_hmac || '') === (b.workspace_binding_hmac || '')
    && (a.upstream_endpoint_ref || '') === (b.upstream_endpoint_ref || '')
    && (a.aws_region || '') === (b.aws_region || '')
    && (a.upstream_host || '') === (b.upstream_host || '')
    && (a.allowed_upstream_path || '') === (b.allowed_upstream_path || '')
    && (a.upstream_auth_scheme || '') === (b.upstream_auth_scheme || '')
    && (a.beta_policy_ref || '') === (b.beta_policy_ref || '')
    && (a.request_shape_profile_ref || '') === (b.request_shape_profile_ref || '')
    && (a.cache_parity_profile_ref || '') === (b.cache_parity_profile_ref || '')
    && (a.anthropic_workspace_id || '') === (b.anthropic_workspace_id || '')
}

function loadRuntimeMappingFile(file: string): RuntimeMappingFile {
  try {
    const raw = readFileSync(file, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<RuntimeMappingFile>
    if (parsed.version !== 1 || !parsed.mappings || typeof parsed.mappings !== 'object' || Array.isArray(parsed.mappings)) {
      log('warn', 'Runtime mapping file ignored because its shape is invalid')
      return emptyRuntimeMappingFile()
    }
    const mappings: Record<string, RuntimeMappingRecord> = {}
    for (const [key, value] of Object.entries(parsed.mappings)) {
      if (!isRuntimeMappingRecord(value) || value.account_id !== key) continue
      mappings[key] = value
    }
    return { version: 1, mappings }
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : ''
    if (code !== 'ENOENT') {
      log('warn', 'Runtime mapping file could not be loaded; starting with empty replay set', { error: err instanceof Error ? err.message : 'unknown' })
    }
    return emptyRuntimeMappingFile()
  }
}

function writeRuntimeMappingFile(file: string, state: RuntimeMappingFile) {
  const dir = dirname(file)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, file)
  chmodSync(file, 0o600)
}

function emptyRuntimeMappingFile(): RuntimeMappingFile {
  return { version: 1, mappings: {} }
}

function loadFormalPoolSessionAuthorityLedger(file: string): FormalPoolSessionAuthorityLedgerFile {
  try {
    const raw = readFileSync(file, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<FormalPoolSessionAuthorityLedgerFile>
    if (parsed.version !== 1 || !parsed.sessions || typeof parsed.sessions !== 'object' || Array.isArray(parsed.sessions)) {
      throw new Error('invalid_formal_pool_session_ledger')
    }
    if (!parsed.attestation_nonces || typeof parsed.attestation_nonces !== 'object' || Array.isArray(parsed.attestation_nonces)) {
      throw new Error('invalid_formal_pool_session_ledger')
    }
    const sessions: Record<string, FormalPoolSessionAuthorityBinding> = {}
    for (const [key, value] of Object.entries(parsed.sessions)) {
      if (!isSafeIdentityRef(key) || !isFormalPoolSessionAuthorityBinding(value)) {
        throw new Error('invalid_formal_pool_session_ledger')
      }
      sessions[key] = value
    }
    const attestation_nonces: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed.attestation_nonces)) {
      if (!isSafeIdentityRef(key) || !isSafeLedgerExpiry(value)) {
        throw new Error('invalid_formal_pool_session_ledger')
      }
      attestation_nonces[key] = value
    }
    return { version: 1, sessions, attestation_nonces }
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : ''
    if (code === 'ENOENT') return emptyFormalPoolSessionAuthorityLedgerFile()
    throw err
  }
}

function writeFormalPoolSessionAuthorityLedger(
  file: string,
  state: FormalPoolSessionAuthorityLedgerFile,
  faultScope: 'session_authority' | 'attestation_nonce' = 'session_authority',
) {
  if (process.env.NODE_ENV === 'test') {
    const fault = process.env[FORMAL_POOL_SESSION_LEDGER_FAIL_WRITE_FOR_TEST_ENV]?.trim()
    if (fault === '1' || fault === faultScope) {
      throw new Error('injected_formal_pool_session_ledger_write_failure')
    }
  }
  const dir = dirname(file)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, file)
  chmodSync(file, 0o600)
}

function emptyFormalPoolSessionAuthorityLedgerFile(): FormalPoolSessionAuthorityLedgerFile {
  return { version: 1, sessions: {}, attestation_nonces: {} }
}

function isSafeLedgerExpiry(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isFormalPoolSessionAuthorityBinding(value: unknown): value is FormalPoolSessionAuthorityBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<FormalPoolSessionAuthorityBinding>
  const base = typeof record.account_id === 'string' && isSafeInternalRoutingKey(record.account_id)
    && isSafeIdentityRef(record.credential_ref)
    && record.credential_source === 'server_account_credentials'
    && typeof record.egress_bucket === 'string' && isSafeInternalRoutingKey(record.egress_bucket)
    && isSafeIdentityRef(record.proxy_identity_ref)
    && typeof record.policy_version === 'string' && record.policy_version.trim() === record.policy_version && !/[\r\n]/.test(record.policy_version)
    && typeof record.persona_profile === 'string' && record.persona_profile.trim() === record.persona_profile && !/[\r\n]/.test(record.persona_profile)
    && isSafeIdentityRef(record.device_ref)
  if (!base) return false
  if (record.provider_kind === undefined) return true
  if (record.provider_kind !== 'anthropic_first_party' && record.provider_kind !== CLAUDE_PLATFORM_AWS_PROVIDER_KIND) return false
  if (record.provider_kind !== CLAUDE_PLATFORM_AWS_PROVIDER_KIND) return true
  return isSafeClaudePlatformAWSRef(record.workspace_ref, 'workspace:')
    && /^hmac-sha256:[a-f0-9]{64}$/i.test(String(record.workspace_binding_hmac || ''))
    && isSafeClaudePlatformAWSRef(record.upstream_endpoint_ref, 'endpoint:')
    && isSafeAWSRegion(record.aws_region)
    && record.upstream_host === claudePlatformAWSHostForRegion(String(record.aws_region || ''))
    && record.allowed_upstream_path === CLAUDE_PLATFORM_AWS_ALLOWED_PATH
    && (record.upstream_auth_scheme === 'x_api_key' || record.upstream_auth_scheme === 'bearer_api_key')
    && record.beta_policy_ref === CLAUDE_PLATFORM_AWS_BETA_POLICY_REF
}

function isRuntimeMappingRecord(value: unknown): value is RuntimeMappingRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const base = typeof record.account_id === 'string' &&
    typeof record.account_ref === 'string' &&
    typeof record.account_uuid_ref === 'string' &&
    (record.email_ref === undefined || typeof record.email_ref === 'string') &&
    typeof record.credential_ref === 'string' &&
    typeof record.credential_binding_hmac === 'string' &&
    (record.token_type === 'oauth' || record.token_type === 'apikey') &&
    typeof record.egress_bucket === 'string' &&
    typeof record.proxy_url === 'string' &&
    typeof record.proxy_identity_ref === 'string' &&
    typeof record.device_id === 'string' &&
    typeof record.persona_variant === 'string' &&
    record.session_policy === 'preserve_downstream_session_id' &&
    typeof record.policy_version === 'string'
  if (!base) return false
  if (record.provider_kind === undefined) return true
  if (record.provider_kind !== 'anthropic_first_party' && record.provider_kind !== CLAUDE_PLATFORM_AWS_PROVIDER_KIND) return false
  if (record.provider_kind !== CLAUDE_PLATFORM_AWS_PROVIDER_KIND) return true
  return typeof record.workspace_ref === 'string'
    && typeof record.workspace_binding_hmac === 'string'
    && typeof record.upstream_endpoint_ref === 'string'
    && typeof record.aws_region === 'string'
    && typeof record.upstream_host === 'string'
    && typeof record.allowed_upstream_path === 'string'
    && (record.upstream_auth_scheme === 'x_api_key' || record.upstream_auth_scheme === 'bearer_api_key')
    && typeof record.beta_policy_ref === 'string'
    && typeof record.request_shape_profile_ref === 'string'
    && typeof record.cache_parity_profile_ref === 'string'
    && typeof record.anthropic_workspace_id === 'string'
}

type RawCaptureSink = {
  dir: string | null
  fullRaw: boolean
  captureRef: string | null
  generated: boolean
}

function rawCaptureDir(): string | null {
  const dir = process.env.CC_GATEWAY_RAW_CAPTURE_DIR
  return dir && dir.trim() ? dir.trim() : null
}

function createRawCaptureSink(method: string, pathname: string): RawCaptureSink {
  const root = rawCaptureDir()
  if (!root) return { dir: null, fullRaw: false, captureRef: null, generated: false }
  mkdirSync(root, { recursive: true, mode: 0o700 })
  chmodSync(root, 0o700)

  let dir = root
  if (process.env.CC_GATEWAY_RAW_CAPTURE_LAYOUT === 'per-request') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const safeRoute = pathname.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'root'
    dir = `${root}/${timestamp}-${method.toUpperCase()}-${safeRoute}-${randomUUID()}`
  }
  return {
    dir,
    fullRaw: process.env.CC_GATEWAY_FULL_RAW_CAPTURE === '1',
    captureRef: createRawCaptureRef(method, pathname),
    generated: false,
  }
}

function createRawCaptureRef(method: string, pathname: string): string {
  const key = randomBytes(32)
  const nonce = randomBytes(32).toString('hex')
  const digest = createHmac('sha256', key)
    .update(method.toUpperCase())
    .update('\0')
    .update(pathname)
    .update('\0')
    .update(nonce)
    .digest('hex')
  return `hmac-sha256:${digest}`
}

function writeRawCaptureFile(sink: RawCaptureSink, name: string, payload: unknown): boolean {
  const dir = sink.dir
  if (!dir) return false
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const file = `${dir}/${name}`
  writeFileSync(file, JSON.stringify(payload, null, 2), { mode: 0o600 })
  chmodSync(file, 0o600)
  sink.generated = true
  return true
}

function applyGatewayEvidenceHeaders(
  headers: Record<string, string | string[] | undefined>,
  rawCapture?: RawCaptureSink,
): Record<string, string | string[] | undefined> {
  const out = { ...headers }
  for (const key of Object.keys(out)) {
    const normalized = key.toLowerCase()
    if (normalized === 'x-cc-gateway-seen' || normalized === 'x-cc-gateway-raw-capture-ref') {
      delete out[key]
    }
  }
  out['X-CC-Gateway-Seen'] = '1'
  if (rawCapture?.generated && rawCapture.captureRef) {
    out['X-CC-Gateway-Raw-Capture-Ref'] = rawCapture.captureRef
  }
  return out
}

function redactedHeaderValues(headers: Record<string, string | string[] | undefined>): Record<string, string | string[]> {
  const sensitive = new Set([
    'authorization',
    'x-api-key',
    'api-key',
    'cookie',
    'set-cookie',
    'proxy-authorization',
  ])
  const out: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    const normalized = key.toLowerCase()
    out[key] = sensitive.has(normalized) ? '<redacted>' : value
  }
  return out
}

function rawCaptureBodyLengthBucket(length: number): string {
  if (length <= 0) return '0'
  if (length <= 256) return '1-256'
  if (length <= 1024) return '257-1024'
  if (length <= 4096) return '1025-4096'
  if (length <= 16384) return '4097-16384'
  return '16385+'
}

function safeHeaderNames(headers: Record<string, string | string[] | undefined>): string[] {
  return Object.keys(headers)
    .map((key) => key.toLowerCase())
    .sort()
}

function safeSchemaSummaryFromBuffer(body: Buffer): unknown {
  const text = body.toString('utf-8')
  try {
    return safeSchemaSummary(JSON.parse(text))
  } catch {
    return { type: 'non_json' }
  }
}

function safeSchemaSummary(value: unknown, depth = 0): unknown {
  if (depth >= 2) {
    if (Array.isArray(value)) return { type: 'array' }
    if (value && typeof value === 'object') return { type: 'object' }
    return { type: value === null ? 'null' : typeof value }
  }
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      item_schema: value.length > 0 ? safeSchemaSummary(value[0], depth + 1) : null,
    }
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    const fields: Record<string, unknown> = {}
    for (const key of keys.slice(0, 12)) {
      fields[key] = safeSchemaSummary(record[key], depth + 1)
    }
    return {
      type: 'object',
      keys,
      fields,
    }
  }
  return { type: value === null ? 'null' : typeof value }
}

function safeQueryKeys(search: string): string[] {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return Array.from(new Set(Array.from(params.keys()))).sort()
}

function safeSub2ApiCompatInboundRoute(req: IncomingMessage, target: RequestTarget): string {
  return readHeader(req, 'x-sub2api-compat-inbound-route') === '/v1/messages' ? '/v1/messages' : target.pathname
}

function safeSub2ApiCompatCCGatewayRoute(req: IncomingMessage, target: RequestTarget): string {
  const normalized = `${target.pathname}${target.search}`
  return readHeader(req, 'x-sub2api-compat-cc-gateway-route') === '/v1/messages?beta=true'
    ? '/v1/messages?beta=true'
    : normalized
}

function safeCompatHeaderValue(req: IncomingMessage, name: string, allowed: readonly string[]): string | undefined {
  const value = readHeader(req, name)
  return value && allowed.includes(value) ? value : undefined
}

function safeCompatBoolHeader(req: IncomingMessage, name: string): boolean | undefined {
  const value = readHeader(req, name)
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function safeCompatFilledFields(req: IncomingMessage): string[] | undefined {
  const allowed = new Set(['system', 'metadata', 'metadata.user_id', 'tools', 'tool_reference', 'defer_loading', 'eager_input_streaming', 'tools.native_only'])
  const value = readHeader(req, 'x-sub2api-compat-server-filled-fields')
  if (!value) return undefined
  const fields = value.split(',').map((item) => item.trim()).filter((item) => item.length > 0)
  return fields.length > 0 && fields.every((item) => allowed.has(item)) ? fields : undefined
}

function safeVerifierSummary(result: unknown): unknown {
  if (!result || typeof result !== 'object') return { ok: false, code: 'unavailable' }
  const typed = result as Record<string, unknown>
  return typed.ok === true
    ? { ok: true }
    : { ok: false, code: typeof typed.code === 'string' ? typed.code : 'unknown' }
}

function safeSensitiveHeaderPresence(headers: Record<string, string | string[] | undefined>) {
  return {
    authorization_present: headers.authorization !== undefined,
    x_api_key_present: headers['x-api-key'] !== undefined,
    x_claude_code_session_id_present: headers['X-Claude-Code-Session-Id'] !== undefined,
  }
}

function rawResponseCapturePayload(
  status: number,
  responseHeaders: Record<string, string | string[] | undefined>,
  responseBody: Buffer,
  sink: RawCaptureSink,
) {
  const payload: Record<string, unknown> = {
    status_code: status,
    header_names: safeHeaderNames(responseHeaders),
    body_length: responseBody.length,
    body_length_bucket: rawCaptureBodyLengthBucket(responseBody.length),
    body_omitted_reason: 'raw_upstream_response_forbidden',
    digest_omitted_reason: 'plain_body_digest_forbidden',
  }
  if (sink.fullRaw) {
    payload.raw_capture_scope = 'safe_summary_only_full_raw_disabled_by_policy'
    payload.safe_headers = { names: safeHeaderNames(responseHeaders), sensitive_presence: safeSensitiveHeaderPresence(responseHeaders) }
    payload.raw_body_omitted_reason = 'full_raw_capture_must_not_persist_body'
  }
  const encoding = String(responseHeaders['content-encoding'] || responseHeaders['Content-Encoding'] || '').toLowerCase()
  payload.body_encoding = encoding || 'identity'
  try {
    let decoded: Buffer | null = null
    if (encoding.includes('gzip')) decoded = gunzipSync(responseBody)
    else if (encoding.includes('br')) decoded = brotliDecompressSync(responseBody)
    else if (encoding.includes('deflate')) decoded = inflateSync(responseBody)
    else if (!encoding) decoded = responseBody
    if (decoded) {
      payload.decoded_body_encoding = encoding || 'identity'
      payload.decoded_schema_summary = safeSchemaSummaryFromBuffer(decoded)
      payload.decoded_body_omitted_reason = 'raw_decoded_response_forbidden'
      if (sink.fullRaw) {
        payload.decoded_raw_body_omitted_reason = 'full_raw_capture_must_not_persist_decoded_body'
      }
    }
  } catch (err) {
    payload.decoded_body_error = err instanceof Error ? err.name : 'DecodeError'
  }
  return payload
}

function proxyAgentCacheKey(account: AccountContext, upstreamUrl: URL, egress: EgressBucketResolution): string {
  const parts = [
    account.provider,
    account.accountId || '-',
    egress.bucketId,
    egress.proxyIdentityRef,
    upstreamUrl.protocol,
    upstreamUrl.host,
    upstreamUrl.pathname || '/',
  ]
  return parts.join('|')
}

type AccountContext = {
  provider: string
  accountId?: string
  tokenType: 'oauth' | 'apikey'
  credentialRef?: string
  egressBucket?: string
  policyVersion?: string
}

type AttestedFormalPoolContext = {
  method: string
  route_class: string
  path: string
  account_id: string
  token_type: 'oauth' | 'apikey'
  credential_ref: string
  credential_source: 'server_account_credentials'
  egress_bucket: string
  proxy_identity_ref: string
  policy_version: string
  persona_profile: string
  trusted_egress_profile_ref: string
  profile_policy_version: string
  billing_shape_policy: FormalPoolBillingShapePolicy
  request_shape_profile_ref: string
  cache_parity_profile_ref: string
  observed_client_profile: Record<string, unknown>
  session_id: string
  timestamp_ms: number
  nonce: string
  credential_binding_hmac?: string
  provider_kind?: 'anthropic_first_party' | 'claude_platform_aws'
  upstream_auth_scheme?: 'x_api_key' | 'bearer_api_key'
  workspace_ref?: string
  workspace_binding_hmac?: string
  upstream_endpoint_ref?: string
  aws_region?: string
  upstream_host?: string
  allowed_upstream_path?: string
  beta_policy_ref?: string
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  upstream: URL,
  runtimeState: ProxyRuntimeState,
) {
  const method = req.method || 'GET'
  const target = normalizeRequestTarget(req.url || '/')
  const path = target.path
  const safePath = redactRequestPath(path)
  const clientIp = req.socket.remoteAddress || 'unknown'
  const rawCapture = createRawCaptureSink(method, target.pathname)
  res.setHeader('X-CC-Gateway-Seen', '1')

  log('info', `← ${method} ${safePath} from ${clientIp}`)

  // Health check - no auth required
  if (target.pathname === '/_health') {
    const oauthOk = config.mode === 'sub2api' ? true : !!getAccessToken()
    const status = oauthOk ? 200 : 503
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: oauthOk ? 'ok' : 'degraded',
      mode: config.mode,
      oauth: config.mode === 'sub2api' ? 'not_used' : (oauthOk ? 'valid' : 'expired/refreshing'),
      canonical_device: config.identity.device_id.slice(0, 8) + '...',
      canonical_platform: config.env.platform,
      upstream: redactSensitiveText(config.upstream.url),
      clients: config.auth.tokens.map(t => t.name),
    }))
    return
  }

  // Dry-run verification - shows what would be rewritten (auth required)
  if (target.pathname === '/_verify') {
    const clientName = authenticateForMode(req, config)
    if (!clientName) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }
    const sample = buildVerificationPayload(config)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(sample, null, 2))
    return
  }

  if (target.pathname === RUNTIME_REGISTER_PATH) {
    if (config.mode === 'sub2api' && !isTrustedInternalControl(req, config)) {
      writeControlPlaneError(res, 403, 'missing_internal_control_attestation', 'Runtime account registration requires internal control attestation')
      return
    }
    await handleRuntimeRegister(req, res, config, method)
    return
  }

  if (config.mode === 'sub2api') {
    const upstreamSafety = evaluateUpstreamSafety(config, method, target.pathname)
    if (!upstreamSafety.ok) {
      writeControlPlaneError(res, upstreamSafety.status, upstreamSafety.code, 'Upstream is not allowed for this CC Gateway preflight/canary mode')
      return
    }
  }

  // Authenticate client (proxy-level auth)
  const clientName = authenticateForMode(req, config)
  if (!clientName) {
    if (config.mode === 'sub2api') {
      writeControlPlaneError(res, 401, 'missing_gateway_token', 'Unauthorized - provide gateway token via x-cc-gateway-token header')
    } else {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized - provide client token via x-api-key header' }))
    }
    log('warn', `Unauthorized request: ${method} ${safePath}`)
    return
  }

  log('info', `Client "${clientName}" → ${method} ${safePath}`)
  const configuredBillingMode = (config as any).shared_pool?.billing_cch_mode || 'strip'
  if (config.mode === 'sub2api' && configuredBillingMode === 'disabled') {
    writeControlPlaneError(res, 403, 'billing_cch_mode_disabled', 'Shared-pool billing/CCH mode is disabled')
    return
  }
  let billingMode: FormalPoolBillingMode | 'disabled' | string = configuredBillingMode
  const trustedInternalControl = isTrustedInternalControl(req, config)
  if (config.mode === 'sub2api' && hasProtectedInternalControlInput(req) && !trustedInternalControl) {
    writeControlPlaneError(res, 403, 'missing_internal_control_attestation', 'Internal Sub2API control headers require internal control attestation')
    return
  }
  const trustedPersonaClient = isTrustedPersonaClient(req, trustedInternalControl)
  const requestedContext1M = readTrustedContext1MRequest(req, clientName, trustedInternalControl)
  const healthcheckPersonaProfile = readTrustedHealthcheckPersonaProfile(req, clientName, trustedInternalControl)
  if (healthcheckPersonaProfile && !isSupportedHealthcheckPersonaForPolicy(healthcheckPersonaProfile, readHeader(req, 'x-cc-policy-version') || String(config.env.version || ''))) {
    writeControlPlaneError(res, 403, 'unsupported_healthcheck_persona', 'Unsupported internal healthcheck persona profile')
    return
  }

  let accountContext: AccountContext | null = null
  let accountIdentity: AccountIdentityRecord | null = null
  let egress: EgressBucketResolution | null = null
  let personaDecision: ReturnType<typeof resolveSharedPoolPersonaDecision> | null = null
  let oauthToken: string | null = null
  let routePolicy: ReturnType<typeof selectSharedPoolRoute> | null = null
  let formalPoolAttestation: AttestedFormalPoolContext | null = null
  const sharedPoolRoute: SharedPoolPersonaRoute = target.pathname === '/v1/messages/count_tokens' ? 'count_tokens' : 'messages'

  if (config.mode === 'sub2api') {
    routePolicy = selectSharedPoolRoute(method, target.pathname, target.search)
    if (routePolicy.action === 'block') {
      const awsRoutePolicy = maybeAllowClaudePlatformAWSMessagesRoute(req, config, method, target, routePolicy)
      if ('status' in awsRoutePolicy) {
        writeControlPlaneError(res, awsRoutePolicy.status, awsRoutePolicy.code, 'Formal-pool scheduler context attestation is required')
        return
      }
      routePolicy = awsRoutePolicy.routePolicy
    }
    if (routePolicy.action === 'block') {
      writeControlPlaneError(res, routePolicy.status, routePolicy.code, `Unsupported route: ${safePath}`)
      return
    }

    const parsed = parseAccountContext(req, config)
    if ('error' in parsed) {
      writeControlPlaneError(res, parsed.status, parsed.code, parsed.error)
      return
    }
    accountContext = parsed.context

    if (formalPoolAttestationRequired(config)) {
      const attestation = parseFormalPoolContext(req, config)
      if (!attestation.ok) {
        writeControlPlaneError(res, attestation.status, attestation.code, 'Formal-pool scheduler context attestation is required')
        return
      }
      formalPoolAttestation = attestation.context
      if (isConfiguredClaudePlatformAWSUpstream(upstream) && formalPoolAttestation.provider_kind !== CLAUDE_PLATFORM_AWS_PROVIDER_KIND) {
        writeControlPlaneError(res, 403, 'real_aws_claude_platform_provider_mismatch', 'AWS Claude Platform upstream requires Claude Platform on AWS provider attestation')
        return
      }
      if (formalPoolAttestation.provider_kind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND && target.search !== '') {
        writeControlPlaneError(res, 404, 'unsupported_route', 'Claude Platform on AWS phase 1 allows /v1/messages without internal query markers only')
        return
      }
      const headerCheck = verifyFormalPoolAttestedHeaders(req, method, target, routePolicy, accountContext, formalPoolAttestation)
      if (!headerCheck.ok) {
        writeControlPlaneError(res, headerCheck.status, headerCheck.code, 'Formal-pool scheduler context does not match selected request context')
        return
      }
      const profileCheck = verifyFormalPoolAttestedProfiles(config, formalPoolAttestation)
      if (!profileCheck.ok) {
        writeControlPlaneError(res, profileCheck.status, profileCheck.code, profileCheck.message)
        return
      }
      billingMode = formalPoolBillingModeFromAttestation(formalPoolAttestation)
    }

    accountIdentity = resolveAccountIdentity(config, accountContext.accountId)
    if (!accountIdentity) {
      writeControlPlaneError(res, 403, 'missing_account_identity', 'Missing per-account identity for selected upstream account')
      return
    }
    if (healthcheckPersonaProfile) {
      accountIdentity = {
        ...accountIdentity,
        persona_variant: healthcheckPersonaProfile,
        policy_version: accountContext.policyVersion || '',
      }
    }
    if (formalPoolAttestation) {
      const selectedIdentity = accountIdentity
      const identityCheck = verifyFormalPoolAttestedAccountIdentity(formalPoolAttestation, selectedIdentity)
      if (!identityCheck.ok) {
        writeControlPlaneError(res, identityCheck.status, identityCheck.code, 'Formal-pool scheduler context does not match selected account identity')
        return
      }
      const credentialBindingCheck = verifySelectedCredentialBinding(req, config, accountContext, selectedIdentity, formalPoolAttestation.credential_ref, formalPoolAttestation.credential_binding_hmac)
      if (!credentialBindingCheck.ok) {
        writeControlPlaneError(res, credentialBindingCheck.status, credentialBindingCheck.code, 'Selected upstream credential does not match selected account identity')
        return
      }
      const personaCheck = verifyFormalPoolAttestedPersona(formalPoolAttestation, selectedIdentity.persona_variant)
      if (!personaCheck.ok) {
        writeControlPlaneError(res, personaCheck.status, personaCheck.code, 'Formal-pool scheduler context does not match selected persona profile')
        return
      }
    }

    const resolvedEgress = resolveEgressBucket(config, accountContext.egressBucket, accountContext.accountId)
    if ('error' in resolvedEgress) {
      writeControlPlaneError(res, 403, resolvedEgress.error, 'Egress bucket is not eligible for the selected upstream account')
      return
    }
    egress = resolvedEgress
    if (formalPoolAttestation) {
      const egressCheck = verifyFormalPoolAttestedHeaders(req, method, target, routePolicy, accountContext, formalPoolAttestation, egress)
      if (!egressCheck.ok) {
        writeControlPlaneError(res, egressCheck.status, egressCheck.code, 'Formal-pool scheduler context does not match selected egress context')
        return
      }
    }
  } else {
    // Get the real OAuth token (managed by gateway)
    oauthToken = getAccessToken()
    if (!oauthToken) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'OAuth token not available - gateway is refreshing' }))
      log('error', 'No valid OAuth token available')
      return
    }
  }

  const bodyResult = await readRequestBody(req, config.mode === 'sub2api' ? getSharedPoolMaxBodyBytes(config) : undefined)
  if ('error' in bodyResult) {
    writeControlPlaneError(res, 413, 'body_too_large', 'Shared-pool request body exceeds configured cap')
    return
  }
  let body = bodyResult.body
  let rawSigningOutputBody = ''
  let rawCCH: string | null = null
  let rawVerifierResult: unknown = null

  if (config.mode === 'sub2api' && routePolicy?.action === 'suppress') {
    const controlPlaneCheck = verifySuppressedControlPlaneRequest(
      req,
      body,
      config,
      accountIdentity!,
      accountContext!.policyVersion || String(config.env.version),
      trustedPersonaClient,
    )
    if (!controlPlaneCheck.ok) {
      writeControlPlaneError(res, controlPlaneCheck.status, controlPlaneCheck.code, controlPlaneCheck.message)
      return
    }
    res.writeHead(204, { 'X-CC-Gateway-Event-Policy': 'suppress' })
    res.end()
    if (config.logging.audit) audit(clientName, method, safePath, 204)
    return
  }

  let parsedBody: unknown = null
  if (config.mode === 'sub2api' && body.length > 0) {
    try {
      parsedBody = JSON.parse(body.toString('utf-8'))
    } catch {
      parsedBody = null
    }
  }
  const sessionId = accountIdentity ? normalizeSharedPoolSessionId(parsedBody, readHeader(req, 'x-claude-code-session-id'), accountIdentity) : undefined
  if (config.mode === 'sub2api' && !sessionId) {
    writeControlPlaneError(res, 400, 'session_binding_failed', 'Unable to bind X-Claude-Code-Session-Id to metadata.user_id')
    return
  }
  if (config.mode === 'sub2api' && formalPoolAttestation) {
    const sessionCheck = verifyFormalPoolAttestedSession(config, runtimeState, formalPoolAttestation, sessionId)
    if (!sessionCheck.ok) {
      writeControlPlaneError(res, sessionCheck.status, sessionCheck.code, 'Formal-pool scheduler context does not match canonical session')
      return
    }
  }
  if (parsedBody && body.length > 0) {
    body = Buffer.from(JSON.stringify(parsedBody), 'utf-8')
  }

  if (config.mode === 'sub2api') {
    if (billingMode === 'sign' && formalPoolRequestUsesPolicyVersion('2.1.177', config, accountContext, accountIdentity, formalPoolAttestation)) {
      if (!isSignPrimaryAllowedForVersion('2.1.177', config)) {
        writeControlPlaneError(res, 403, 'sign_primary_2177_oracle_missing', 'Manual signing mode is disabled or signer verification failed')
        return
      }
    }
    const requestedModel = parsedBody && typeof (parsedBody as any).model === 'string' ? String((parsedBody as any).model) : ''
    personaDecision = resolveSharedPoolPersonaDecision(
      configWithHealthcheckPersona(config, healthcheckPersonaProfile),
      accountIdentity,
      accountContext!.policyVersion || String(config.env.version),
      requestedModel,
      trustedPersonaClient,
      sharedPoolRoute,
      requestedContext1M,
    )
    if (personaDecision.status.startsWith('quarantine') || personaDecision.status.startsWith('reject')) {
      const code = personaDecision.status === 'reject_context_1m_unsupported_model'
        ? 'context_1m_unsupported_model'
        : `persona_${personaDecision.status}`
      writeControlPlaneError(res, 403, code, 'Persona policy rejected request')
      return
    }
    if (formalPoolAttestation) {
      const personaCheck = verifyFormalPoolAttestedPersona(formalPoolAttestation, accountIdentity?.persona_variant, personaDecision.profile.id, personaDecision.profile.messageBetaProfile)
      if (!personaCheck.ok) {
        writeControlPlaneError(res, personaCheck.status, personaCheck.code, 'Formal-pool scheduler context does not match effective persona profile')
        return
      }
      const sessionAuthorityCheck = verifyFormalPoolSessionAuthorityBinding(config, runtimeState, formalPoolAttestation, accountIdentity!)
      if (!sessionAuthorityCheck.ok) {
        writeControlPlaneError(res, sessionAuthorityCheck.status, sessionAuthorityCheck.code, sessionAuthorityCheck.message)
        return
      }
    }
  }

  if (config.mode === 'sub2api') {
    const canaryCostEnvelope = evaluateCanaryCostEnvelope(config, body)
    if (!canaryCostEnvelope.ok) {
      writeControlPlaneError(res, canaryCostEnvelope.status, canaryCostEnvelope.code, 'Canary request exceeds the configured cost envelope')
      return
    }
  }

  if (config.mode === 'sub2api') {
    const retryContract = verifyRetryFinalOutputContract(req, billingMode)
    if (!retryContract.ok) {
      writeControlPlaneError(res, retryContract.status, retryContract.code, retryContract.message)
      return
    }
  }

  if (config.mode === 'sub2api' && billingMode === 'disabled') {
    writeControlPlaneError(res, 403, 'billing_cch_mode_disabled', 'Shared-pool billing/CCH mode is disabled')
    return
  }
  if (config.mode === 'sub2api' && !['strip', 'no_cch', 'sign'].includes(String(billingMode))) {
    writeControlPlaneError(res, 403, 'unsupported_billing_cch_mode', 'Unsupported shared-pool billing/CCH mode')
    return
  }

  // Rewrite identity fields in body
  if (body.length > 0) {
    try {
      body = rewriteBody(body, target.pathname, config, { accountIdentity: accountIdentity ?? undefined, sessionId }) as Buffer<ArrayBuffer>
    } catch (err) {
      log('error', `Body rewrite failed for ${safePath}: ${redactSensitiveText(String(err))}`)
    }
  }

  // Rewrite headers (strips client auth, normalizes identity headers)
  const rewrittenHeaders = rewriteHeaders(
    req.headers as Record<string, string | string[] | undefined>,
    configWithHealthcheckPersona(config, healthcheckPersonaProfile),
    config.mode === 'sub2api'
      ? {
          upstreamAuth: accountContext!.tokenType,
          providerKind: formalPoolAttestation?.provider_kind,
          upstreamAuthScheme: formalPoolAttestation?.upstream_auth_scheme,
          anthropicWorkspaceId: formalPoolAttestation?.provider_kind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND ? accountIdentity?.anthropic_workspace_id : undefined,
          stripGatewayControlHeaders: true,
          sharedPool: true,
          route: target.pathname,
          accountIdentity: accountIdentity ?? undefined,
          requestedPolicyVersion: accountContext!.policyVersion,
          requestedModel: parsedBody && typeof (parsedBody as any).model === 'string' ? String((parsedBody as any).model) : '',
          trustedClient: personaDecision?.trustedClient ?? false,
          sessionId,
          requestedContext1M,
        }
      : {},
  )

  if (sessionId && config.mode === 'sub2api') {
    rewrittenHeaders['X-Claude-Code-Session-Id'] = sessionId
  }

  const signingInputBody = body.toString('utf-8')
  if (config.mode === 'sub2api' && billingMode === 'no_cch') {
    const noCch = runNoCchBillingPipeline(body, personaDecision?.effectiveVersion || String(config.env.version))
    if (!noCch.ok) {
      writeControlPlaneError(res, 400, noCch.code, 'Shared-pool no-CCH verifier failed')
      return
    }
    body = noCch.body
  }
  if (config.mode === 'sub2api' && billingMode === 'sign') {
    const signing = runSigningPipeline(config, body, {
      cliVersion: personaDecision?.effectiveVersion || String(config.env.version),
    })
    if (!signing.ok) {
      writeControlPlaneError(res, 403, signing.code, 'Manual signing mode is disabled or signer verification failed')
      return
    }
    body = signing.body
    rawSigningOutputBody = body.toString('utf-8')
    rawCCH = signing.cch
    const verifier = verifySharedPoolFinalOutput(config, rewrittenHeaders, body, {
      route: sharedPoolRoute,
      sessionId,
      accountIdentity: accountIdentity ?? undefined,
      expectedVersion: personaDecision?.effectiveVersion,
      expectedBeta: personaDecision?.betaHeader,
      billingMode: 'sign',
      requestShapeProfileRef: formalPoolAttestation?.request_shape_profile_ref,
      cacheParityProfileRef: formalPoolAttestation?.cache_parity_profile_ref,
      attestation: formalPoolAttestation ?? undefined,
    })
    rawVerifierResult = verifier
    if (!verifier.ok) {
      writeControlPlaneError(res, 400, verifier.code, 'Shared-pool signing verifier failed')
      return
    }
  } else if (config.mode === 'sub2api') {
    const verifier = verifySharedPoolFinalOutput(config, rewrittenHeaders, body, {
      route: sharedPoolRoute,
      sessionId,
      accountIdentity: accountIdentity ?? undefined,
      expectedVersion: personaDecision?.effectiveVersion,
      expectedBeta: personaDecision?.betaHeader,
      billingMode: billingMode === 'no_cch' ? 'no_cch' : 'strip',
      requestShapeProfileRef: formalPoolAttestation?.request_shape_profile_ref,
      cacheParityProfileRef: formalPoolAttestation?.cache_parity_profile_ref,
      attestation: formalPoolAttestation ?? undefined,
    })
    rawVerifierResult = verifier
    if (!verifier.ok) {
      writeControlPlaneError(res, 400, verifier.code, 'Shared-pool final-output verifier failed')
      return
    }
  }

  if (oauthToken) {
    // Inject the real OAuth token via x-api-key (Anthropic uses this header for both
    // API keys and OAuth tokens, distinguished by provider-defined token class prefixes)
    rewrittenHeaders['x-api-key'] = oauthToken
  }

  // Forward to upstream
  const upstreamUrl = buildFixedUpstreamUrl(target, upstream)
  if (formalPoolAttestation?.provider_kind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND) {
    upstreamUrl.pathname = CLAUDE_PLATFORM_AWS_ALLOWED_PATH
    upstreamUrl.search = ''
  }

  const agentKey = config.mode === 'sub2api' && accountContext && egress
    ? proxyAgentCacheKey(accountContext, upstream, egress)
    : 'default'
  const agent = config.mode === 'sub2api' && egress
    ? getProxyAgent(agentKey, egress.proxyUrl)
    : getProxyAgent(agentKey)
  if (config.mode === 'sub2api' && !agent) {
    writeControlPlaneError(res, 403, 'missing_egress_proxy', 'Configured egress proxy is unavailable')
    return
  }
  const forwardHeaders = {
    ...rewrittenHeaders,
    host: formalPoolAttestation?.provider_kind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND && formalPoolAttestation.upstream_host
      ? formalPoolAttestation.upstream_host
      : upstream.host,
    'content-length': String(body.length),
  }
  if (config.mode === 'sub2api' && formalPoolAttestation?.provider_kind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND) {
    const finalAWSCheck = verifyClaudePlatformAWSFinalRequest(config, upstreamUrl, forwardHeaders, formalPoolAttestation)
    if (!finalAWSCheck.ok) {
      writeControlPlaneError(res, 403, finalAWSCheck.code, 'Claude Platform on AWS final verifier failed')
      return
    }
  }
  const requestCapturePayload: Record<string, unknown> = {
    method,
    inbound_route: safeSub2ApiCompatInboundRoute(req, target),
    cc_gateway_route: safeSub2ApiCompatCCGatewayRoute(req, target),
    client_type: safeCompatHeaderValue(req, 'x-sub2api-compat-client-type', ['claude_code_compat']),
    server_filled_shape: safeCompatBoolHeader(req, 'x-sub2api-compat-server-filled-shape'),
    server_filled_fields: safeCompatFilledFields(req),
    persona_source: safeCompatHeaderValue(req, 'x-sub2api-compat-persona-source', ['server_selected']),
    compat_fidelity_level: safeCompatHeaderValue(req, 'x-sub2api-compat-fidelity-level', ['L0', 'L1', 'L2', 'L3']),
    tool_search_mode: safeCompatHeaderValue(req, 'x-sub2api-compat-tool-search-mode', ['not_present', 'truthful_pass_through', 'strip_with_audit', 'capability_backed']),
    tool_reference_present: safeCompatBoolHeader(req, 'x-sub2api-compat-tool-reference-present'),
    defer_loading_present: safeCompatBoolHeader(req, 'x-sub2api-compat-defer-loading-present'),
    eager_input_streaming_present: safeCompatBoolHeader(req, 'x-sub2api-compat-eager-input-streaming-present'),
    capability_backed: safeCompatBoolHeader(req, 'x-sub2api-compat-capability-backed'),
    path: upstreamUrl.pathname,
    query_keys: safeQueryKeys(upstreamUrl.search),
    header_names: safeHeaderNames(forwardHeaders),
    sensitive_header_presence: safeSensitiveHeaderPresence(forwardHeaders),
    body_length: body.length,
    body_length_bucket: rawCaptureBodyLengthBucket(body.length),
    schema_summary: safeSchemaSummaryFromBuffer(body),
    body_omitted_reason: 'raw_upstream_request_forbidden',
    digest_omitted_reason: 'plain_body_digest_forbidden',
  }
  if (rawCapture.fullRaw) {
    requestCapturePayload.raw_capture_scope = 'safe_summary_only_full_raw_disabled_by_policy'
    requestCapturePayload.safe_headers = { names: safeHeaderNames(forwardHeaders), sensitive_presence: safeSensitiveHeaderPresence(forwardHeaders) }
    requestCapturePayload.raw_body_omitted_reason = 'full_raw_capture_must_not_persist_body'
  }
  writeRawCaptureFile(rawCapture, '01_final_upstream_request.json', requestCapturePayload)

  const finalOutputCapturePayload: Record<string, unknown> = {
    billing_cch_mode: billingMode,
    body_length: body.length,
    body_length_bucket: rawCaptureBodyLengthBucket(body.length),
    schema_summary: safeSchemaSummaryFromBuffer(body),
    body_omitted_reason: 'raw_final_output_forbidden',
    digest_omitted_reason: 'plain_body_digest_forbidden',
    signing_input_length: Buffer.byteLength(signingInputBody),
    signing_output_length: rawSigningOutputBody ? Buffer.byteLength(rawSigningOutputBody) : body.length,
    cch_present: rawCCH !== null,
    verifier_result: safeVerifierSummary(rawVerifierResult),
    post_sign_mutation_check: {
      final_body_length: body.length,
      signing_output_length: rawSigningOutputBody ? Buffer.byteLength(rawSigningOutputBody) : body.length,
      pass: !rawSigningOutputBody || body.toString('utf-8') === rawSigningOutputBody,
    },
    fallback_check: {
      sign_to_strip_fallback: false,
      direct_fallback: false,
    },
  }
  if (rawCapture.fullRaw) {
    finalOutputCapturePayload.raw_capture_scope = 'safe_summary_only_full_raw_disabled_by_policy'
    finalOutputCapturePayload.raw_body_omitted_reason = 'full_raw_capture_must_not_persist_final_body'
  }
  writeRawCaptureFile(rawCapture, '03_final_output.json', finalOutputCapturePayload)

  const requestFn = upstreamUrl.protocol === 'http:' ? httpRequest : httpsRequest
  const proxyReq = requestFn(
    upstreamUrl,
    {
      method,
      headers: forwardHeaders,
      ...(agent && { agent }),
    },
    (proxyRes) => {
      const status = proxyRes.statusCode || 502

      let responseHeaders = { ...proxyRes.headers }
      delete responseHeaders['transfer-encoding']
      responseHeaders = applyGatewayEvidenceHeaders(responseHeaders, rawCapture)

      if (rawCapture.dir) {
        const chunks: Buffer[] = []
        res.writeHead(status, responseHeaders)
        proxyRes.on('data', (chunk) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          chunks.push(buffer)
          if (!res.destroyed && !res.write(buffer)) {
            proxyRes.pause()
          }
        })
        res.on('drain', () => {
          proxyRes.resume()
        })
        proxyRes.on('end', () => {
          const responseBody = Buffer.concat(chunks)
          writeRawCaptureFile(rawCapture, '02_upstream_response.json', rawResponseCapturePayload(status, responseHeaders, responseBody, rawCapture))
          if (!res.destroyed) res.end()
          if (config.logging.audit) audit(clientName, method, safePath, status)
        })
      } else {
        res.writeHead(status, responseHeaders)
        // Stream response directly (SSE for Claude responses)
        proxyRes.pipe(res)
        if (config.logging.audit) audit(clientName, method, safePath, status)
      }
    },
  )

  proxyReq.on('error', (err) => {
    const safeMessage = redactSensitiveText(err.message)
    log('error', `Upstream error: ${safeMessage}`)
    if (!res.headersSent) {
      if (config.mode === 'sub2api') {
        writeControlPlaneError(res, 502, 'egress_proxy_failure', 'Configured egress proxy failed before upstream response')
      } else {
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Bad gateway', detail: safeMessage }))
      }
    }
    if (config.logging.audit) {
      audit(clientName, method, safePath, 502)
    }
  })

  proxyReq.write(body)
  proxyReq.end()
}



type NoCchBillingPipelineResult =
  | { ok: true; body: Buffer; ccVersionSuffix: string }
  | { ok: false; code: 'no_cch_verifier_failed' }

function runNoCchBillingPipeline(body: Buffer, cliVersion: string): NoCchBillingPipelineResult {
  let parsed: any
  try {
    parsed = JSON.parse(body.toString('utf-8'))
  } catch {
    return { ok: false, code: 'no_cch_verifier_failed' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, code: 'no_cch_verifier_failed' }
  stripSystemBillingBlocks(parsed)
  if (containsCchMarker(parsed)) return { ok: false, code: 'no_cch_verifier_failed' }
  const version = String(cliVersion || '').trim()
  if (version !== '2.1.179') return { ok: false, code: 'no_cch_verifier_failed' }
  const ccVersionSuffix = computeCCVersionSuffix(firstUserTextForBilling(parsed.messages), version)
  prependNoCchBillingHeader(parsed, `x-anthropic-billing-header: cc_version=${version}.${ccVersionSuffix}; cc_entrypoint=sdk-cli;`)
  const next = Buffer.from(JSON.stringify(parsed), 'utf-8')
  const nextText = next.toString('utf-8')
  return /x-anthropic-billing-header:[^"\n]*cc_version=2\.1\.179\.[a-f0-9]{3};[^"\n]*cc_entrypoint=sdk-cli;/i.test(nextText)
    && !/\bcch=/i.test(nextText)
    ? { ok: true, body: next, ccVersionSuffix }
    : { ok: false, code: 'no_cch_verifier_failed' }
}

function stripSystemBillingBlocks(parsed: any) {
  if (Array.isArray(parsed.system)) {
    parsed.system = parsed.system.filter((item: any) => {
      const text = typeof item === 'string' ? item : item?.text
      return !(typeof text === 'string' && text.trimStart().toLowerCase().startsWith('x-anthropic-billing-header:'))
    })
  } else if (typeof parsed.system === 'string') {
    parsed.system = parsed.system
      .split(/\r?\n/)
      .filter((line: string) => !line.trimStart().toLowerCase().startsWith('x-anthropic-billing-header:'))
      .join('\n')
  }
}

function containsCchMarker(value: unknown): boolean {
  if (typeof value === 'string') return /\bcch=[a-f0-9]{5}\b/i.test(value)
  if (Array.isArray(value)) return value.some(containsCchMarker)
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(containsCchMarker)
  return false
}

function firstUserTextForBilling(messages: unknown): string {
  if (!Array.isArray(messages)) return ''
  const firstUser = messages.find((message: any) => message?.role === 'user') as any
  if (!firstUser) return ''
  if (typeof firstUser.content === 'string') return firstUser.content.includes('<system-reminder>') ? '' : firstUser.content
  if (Array.isArray(firstUser.content)) {
    const block = firstUser.content.find((item: any) => item?.type === 'text' && typeof item.text === 'string' && !item.text.includes('<system-reminder>'))
    return block?.text || ''
  }
  return ''
}

function prependNoCchBillingHeader(parsed: any, header: string) {
  const billingBlock = { type: 'text', text: header }
  if (Array.isArray(parsed.system)) {
    parsed.system = [billingBlock, ...parsed.system]
    return
  }
  if (typeof parsed.system === 'string' && parsed.system.trim() !== '') {
    parsed.system = [billingBlock, { type: 'text', text: parsed.system }]
    return
  }
  parsed.system = [billingBlock]
}

export function verifySharedPoolFinalOutput(
  config: Config,
  headers: Record<string, string>,
  body: Buffer,
  options: {
    route: SharedPoolPersonaRoute
    sessionId?: string
    accountIdentity?: AccountIdentityRecord
    expectedVersion?: string
    expectedBeta?: string
    billingMode: FormalPoolBillingMode
    requestShapeProfileRef?: string
    cacheParityProfileRef?: string
    attestation?: AttestedFormalPoolContext
  },
): { ok: true } | { ok: false; code: string } {
  if (options.attestation?.provider_kind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND) {
    const awsHeaderCheck = verifyClaudePlatformAWSFinalHeaders(headers, options.attestation)
    if (!awsHeaderCheck.ok) return awsHeaderCheck
  } else {
    try {
      validateSharedPoolPersonaHeaderSchema(headers, options.route, options.sessionId)
    } catch {
      return { ok: false, code: 'persona_header_mismatch' }
    }
  }
  if (options.expectedVersion && userAgentVersion(headers['User-Agent']) !== options.expectedVersion) {
    return { ok: false, code: 'persona_header_mismatch' }
  }
  if (options.expectedBeta && options.attestation?.provider_kind !== CLAUDE_PLATFORM_AWS_PROVIDER_KIND && headers['anthropic-beta'] !== options.expectedBeta) {
    return { ok: false, code: 'persona_header_mismatch' }
  }
  if (options.sessionId && headers['X-Claude-Code-Session-Id'] !== options.sessionId) {
    return { ok: false, code: 'session_binding_failed' }
  }
  const headerKeys = Object.keys(headers).map((key) => key.toLowerCase())
  const bodyText = body.toString('utf-8')
  if (options.billingMode === 'sign') {
    if (headerKeys.includes('x-anthropic-billing-header')) return { ok: false, code: 'persona_cch_version_mismatch' }
    const billingVersion = extractBillingHeaderVersion(bodyText)
    if (!billingVersion) return { ok: false, code: 'persona_cch_version_mismatch' }
    if (options.expectedVersion && billingVersion !== options.expectedVersion) {
      return { ok: false, code: 'persona_cch_version_mismatch' }
    }
    const verifier = verifySignedCCH(body)
    if (!verifier.ok) return { ok: false, code: verifier.code }
  } else if (options.billingMode === 'no_cch') {
    if (headerKeys.includes('x-anthropic-billing-header')) return { ok: false, code: 'no_cch_verifier_failed' }
    const noCchBillingVersion = extractNoCchBillingHeaderVersion(bodyText)
    if (!noCchBillingVersion || /\bcch=/i.test(bodyText)) return { ok: false, code: 'no_cch_verifier_failed' }
    if (options.expectedVersion && noCchBillingVersion !== options.expectedVersion) {
      return { ok: false, code: 'persona_cch_version_mismatch' }
    }
  } else {
    if (headerKeys.includes('x-anthropic-billing-header')) return { ok: false, code: 'strip_verifier_failed' }
    if (/x-anthropic-billing-header/i.test(bodyText) || /\bcch=/i.test(bodyText)) {
      return { ok: false, code: 'strip_verifier_failed' }
    }
  }
  try {
    const parsed = JSON.parse(bodyText)
    const shapeCheck = verifyFormalPoolFinalRequestShape(parsed, options)
    if (!shapeCheck.ok) return shapeCheck
    const userIdRaw = parsed?.metadata?.user_id
    if (typeof userIdRaw !== 'string') return { ok: false, code: 'session_binding_failed' }
    const userId = JSON.parse(userIdRaw)
    const allowed = ['account_uuid', 'device_id', 'session_id']
    if (!allowed.every((key) => typeof userId[key] === 'string')) return { ok: false, code: 'session_binding_failed' }
    if (Object.keys(userId).some((key) => !allowed.includes(key))) return { ok: false, code: 'identity_verifier_failed' }
    if (options.sessionId && userId.session_id !== options.sessionId) return { ok: false, code: 'session_binding_failed' }
    if (options.accountIdentity) {
      if (userId.device_id !== options.accountIdentity.device_id) return { ok: false, code: 'identity_verifier_failed' }
      if (userId.account_uuid !== accountIdentityRef(options.accountIdentity)) return { ok: false, code: 'identity_verifier_failed' }
    }
  } catch {
    return { ok: false, code: 'identity_verifier_failed' }
  }
  return { ok: true }
}

function verifyClaudePlatformAWSFinalHeaders(
  headers: Record<string, string>,
  attested: AttestedFormalPoolContext,
): { ok: true } | { ok: false; code: string } {
  if (attested.upstream_auth_scheme !== 'x_api_key') {
    return { ok: false, code: 'claude_platform_aws_auth_profile_unproven' }
  }
  const normalized = Object.keys(headers).map((key) => key.toLowerCase())
  if (normalized.filter((key) => key === 'anthropic-workspace-id').length !== 1) {
    return { ok: false, code: 'claude_platform_aws_workspace_header_mismatch' }
  }
  if (normalized.filter((key) => key === 'x-api-key').length !== 1 || normalized.includes('authorization')) {
    return { ok: false, code: 'claude_platform_aws_auth_header_mismatch' }
  }
  if (normalized.includes('anthropic-beta') || normalized.includes('x-anthropic-billing-header')) {
    return { ok: false, code: 'claude_platform_aws_header_policy_mismatch' }
  }
  if (normalized.some((key) => key.startsWith('x-cc-') || key.startsWith('x-sub2api-'))) {
    return { ok: false, code: 'claude_platform_aws_header_policy_mismatch' }
  }
  if (!headers['anthropic-workspace-id']) return { ok: false, code: 'claude_platform_aws_workspace_header_mismatch' }
  if (!headers['x-api-key']) return { ok: false, code: 'claude_platform_aws_auth_header_mismatch' }
  return { ok: true }
}

function verifyClaudePlatformAWSFinalRequest(
  config: Config,
  upstreamUrl: URL,
  headers: Record<string, string>,
  attested: AttestedFormalPoolContext,
): { ok: true } | { ok: false; code: string } {
  if (attested.provider_kind !== CLAUDE_PLATFORM_AWS_PROVIDER_KIND) {
    return { ok: false, code: 'claude_platform_aws_provider_mismatch' }
  }
  if (attested.aws_region !== 'us-east-1') {
    return { ok: false, code: 'claude_platform_aws_region_mismatch' }
  }
  const expectedHost = claudePlatformAWSHostForRegion(attested.aws_region)
  if (attested.upstream_host !== expectedHost || headers.host !== expectedHost) {
    return { ok: false, code: 'claude_platform_aws_endpoint_mismatch' }
  }
  if (claudePlatformAWSRequiresRealEndpoint(config)
    && (upstreamUrl.protocol !== 'https:' || upstreamUrl.hostname !== expectedHost || upstreamUrl.host !== expectedHost)) {
    return { ok: false, code: 'claude_platform_aws_endpoint_mismatch' }
  }
  if (upstreamUrl.pathname !== CLAUDE_PLATFORM_AWS_ALLOWED_PATH || upstreamUrl.search !== '') {
    return { ok: false, code: 'claude_platform_aws_route_mismatch' }
  }
  return verifyClaudePlatformAWSFinalHeaders(headers, attested)
}

function claudePlatformAWSRequiresRealEndpoint(config: Config): boolean {
  const upstreamMode = String(((config as any).shared_pool || {}).upstream_mode || 'preflight')
  return upstreamMode === 'production' || upstreamMode === 'real-canary'
}


function verifyFormalPoolFinalRequestShape(
  parsed: any,
  options: {
    route: SharedPoolPersonaRoute
    billingMode: FormalPoolBillingMode
    requestShapeProfileRef?: string
    cacheParityProfileRef?: string
  },
): { ok: true } | { ok: false; code: string } {
  if (options.route !== 'messages') return { ok: true }
  if (options.requestShapeProfileRef === CLAUDE_PLATFORM_AWS_REQUEST_SHAPE_PROFILE_REF || options.cacheParityProfileRef === CLAUDE_PLATFORM_AWS_CACHE_PARITY_PROFILE_REF) {
    if (options.requestShapeProfileRef !== CLAUDE_PLATFORM_AWS_REQUEST_SHAPE_PROFILE_REF) {
      return { ok: false, code: 'request_shape_profile_mismatch' }
    }
    if (options.cacheParityProfileRef !== CLAUDE_PLATFORM_AWS_CACHE_PARITY_PROFILE_REF) {
      return { ok: false, code: 'cache_parity_profile_mismatch' }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, code: 'request_shape_profile_mismatch' }
    const allowedTopLevel = new Set([
      'context_management',
      'max_tokens',
      'messages',
      'metadata',
      'model',
      'output_config',
      'stream',
      'system',
      'thinking',
      'tool_choice',
      'tools',
    ])
    for (const key of Object.keys(parsed)) {
      if (!allowedTopLevel.has(key)) return { ok: false, code: 'request_shape_profile_mismatch' }
    }
    if (!Array.isArray(parsed.messages)) return { ok: false, code: 'request_shape_profile_mismatch' }
    if (containsUnknownCacheControlPlacement(parsed)) return { ok: false, code: 'cache_parity_profile_mismatch' }
    return { ok: true }
  }
  if (options.requestShapeProfileRef && options.requestShapeProfileRef !== FORMAL_POOL_2179_REQUEST_SHAPE_PROFILE_REF) {
    return { ok: false, code: 'request_shape_profile_mismatch' }
  }
  if (options.cacheParityProfileRef && options.cacheParityProfileRef !== FORMAL_POOL_2179_CACHE_PARITY_PROFILE_REF) {
    return { ok: false, code: 'cache_parity_profile_mismatch' }
  }
  if (!options.requestShapeProfileRef && !options.cacheParityProfileRef) return { ok: true }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, code: 'request_shape_profile_mismatch' }
  const allowedTopLevel = new Set([
    'context_management',
    'max_tokens',
    'messages',
    'metadata',
    'model',
    'output_config',
    'stream',
    'system',
    'thinking',
    'tool_choice',
    'tools',
  ])
  for (const key of Object.keys(parsed)) {
    if (!allowedTopLevel.has(key)) return { ok: false, code: 'request_shape_profile_mismatch' }
  }
  if (!Array.isArray(parsed.messages)) return { ok: false, code: 'request_shape_profile_mismatch' }
  if (parsed.system !== undefined && !isAllowedSystemShape(parsed.system)) return { ok: false, code: 'cache_parity_profile_mismatch' }
  if (parsed.tools !== undefined && !Array.isArray(parsed.tools)) return { ok: false, code: 'request_shape_profile_mismatch' }
  if (containsUnknownCacheControlPlacement(parsed)) return { ok: false, code: 'cache_parity_profile_mismatch' }
  return { ok: true }
}

function isAllowedSystemShape(system: unknown): boolean {
  if (typeof system === 'string') return true
  if (!Array.isArray(system)) return false
  return system.every((item) => {
    if (typeof item === 'string') return true
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const record = item as Record<string, unknown>
    return record.type === 'text' && typeof record.text === 'string'
  })
}

function containsUnknownCacheControlPlacement(value: unknown, path: Array<string | number> = []): boolean {
  if (Array.isArray(value)) return value.some((item, index) => containsUnknownCacheControlPlacement(item, [...path, index]))
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.cache_control !== undefined) {
    const container = String(path[0] || '')
    if (container !== 'system' && container !== 'tools' && container !== 'messages') return true
    const cache = record.cache_control
    if (!cache || typeof cache !== 'object' || Array.isArray(cache) || (cache as Record<string, unknown>).type !== 'ephemeral') return true
  }
  return Object.entries(record).some(([key, child]) => containsUnknownCacheControlPlacement(child, [...path, key]))
}

function verifySuppressedControlPlaneRequest(
  req: IncomingMessage,
  body: Buffer,
  config: Config,
  accountIdentity: AccountIdentityRecord,
  requestedPolicyVersion: string,
  trustedPersonaClient: boolean,
): { ok: true } | { ok: false; status: number; code: string; message: string } {
  const rawSessionId = readHeader(req, 'x-claude-code-session-id')
  const sessionId = canonicalClaudeCodeSessionId(rawSessionId)
  if (rawSessionId && !sessionId) {
    return {
      ok: false,
      status: 403,
      code: 'control_plane_persona_mismatch',
      message: 'Control-plane session header is not a canonical Claude Code UUID',
    }
  }

  const decision = resolveSharedPoolPersonaDecision(
    config,
    accountIdentity,
    requestedPolicyVersion,
    '',
    trustedPersonaClient,
    'control_plane',
  )
  if (decision.status.startsWith('quarantine') || decision.status.startsWith('reject')) {
    return {
      ok: false,
      status: 403,
      code: `persona_${decision.status}`,
      message: 'Control-plane persona policy rejected request',
    }
  }

  if (hasControlPlaneBillingMarker(req.headers, body)) {
    return {
      ok: false,
      status: 400,
      code: 'control_plane_cch_marker_forbidden',
      message: 'Control-plane routes must not carry messages billing/CCH material',
    }
  }

  const expectedHeaders = canonicalPersonaHeaders(config, 'control_plane', sessionId, {
    identity: accountIdentity,
    requestedPolicyVersion,
    trustedClient: decision.trustedClient,
  })
  if (findControlPlanePersonaMismatch(req.headers, expectedHeaders)) {
    return {
      ok: false,
      status: 403,
      code: 'control_plane_persona_mismatch',
      message: 'Control-plane persona headers do not match the resolver decision',
    }
  }
  return { ok: true }
}

function hasProtectedInternalControlInput(req: IncomingMessage): boolean {
  return [
    TRUSTED_PERSONA_HEADER,
    HEALTHCHECK_PERSONA_HEADER,
    CONTEXT_1M_REQUEST_HEADER,
    INTERNAL_CONTROL_HEADER,
  ].some((name) => readHeader(req, name) !== undefined)
}

function isTrustedInternalControl(req: IncomingMessage, config: Config): boolean {
  const expected = config.auth.internal_control_token
  if (typeof expected !== 'string' || !expected.trim()) return false
  const actual = readHeader(req, INTERNAL_CONTROL_HEADER)
  if (typeof actual !== 'string') return false
  const actualBuffer = Buffer.from(actual, 'utf-8')
  const expectedBuffer = Buffer.from(expected.trim(), 'utf-8')
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer) && isLocalRequest(req)
}

function isTrustedPersonaClient(req: IncomingMessage, trustedInternalControl: boolean): boolean {
  const marker = readHeader(req, TRUSTED_PERSONA_HEADER)
  if (marker !== '1' && marker?.toLowerCase() !== 'true') return false
  return trustedInternalControl
}

function readTrustedHealthcheckPersonaProfile(req: IncomingMessage, clientName: string | null, trustedInternalControl: boolean): string | null {
  const profile = readHeader(req, HEALTHCHECK_PERSONA_HEADER)?.trim()
  if (!profile) return null
  return clientName === 'gateway' && trustedInternalControl ? profile : null
}

function isSupportedHealthcheckPersonaForPolicy(profile: string, policyVersion: string): boolean {
  const normalizedProfile = profile.trim()
  const normalizedPolicyVersion = policyVersion.trim()
  if (normalizedPolicyVersion === '2.1.179') {
    return normalizedProfile === HEALTHCHECK_2179_NATIVE_DEGRADED_PROFILE
  }
  if (normalizedPolicyVersion === '2.1.175') {
    return normalizedProfile === HEALTHCHECK_2175_NON_1M_PROFILE
  }
  return false
}

function readTrustedContext1MRequest(req: IncomingMessage, clientName: string | null, trustedInternalControl: boolean): boolean {
  if (clientName !== 'gateway' || !trustedInternalControl) return false
  return readBooleanHeader(req, CONTEXT_1M_REQUEST_HEADER)
}

function isLocalRequest(req: IncomingMessage): boolean {
  const remote = (req.socket?.remoteAddress || '').trim()
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
}

function configWithHealthcheckPersona(config: Config, profile: string | null): Config {
  if (!profile) return config
  return {
    ...config,
    shared_pool: {
      ...((config as any).shared_pool || {}),
      message_beta_profile: profile,
    },
  } as Config
}

function userAgentVersion(userAgent: string | undefined): string | null {
  const match = String(userAgent || '').match(/^claude-cli\/(\d+\.\d+\.\d+) \(external, sdk-cli\)$/)
  return match ? match[1] : null
}

function extractBillingHeaderVersion(bodyText: string): string | null {
  const match = bodyText.match(/x-anthropic-billing-header:[^"\n]*cc_version=(\d+\.\d+\.\d+)\.[a-f0-9]{3};/i)
  return match ? match[1] : null
}

function extractNoCchBillingHeaderVersion(bodyText: string): string | null {
  const match = bodyText.match(/x-anthropic-billing-header:[^"\n]*cc_version=(\d+\.\d+\.\d+)\.[a-f0-9]{3};[^"\n]*cc_entrypoint=sdk-cli;(?!(?:[^"\n]*\bcch=))/i)
  return match ? match[1] : null
}

function hasControlPlaneBillingMarker(
  headers: IncomingMessage['headers'],
  body: Buffer,
): boolean {
  if (readHeaderValue(headers, 'x-anthropic-billing-header')) return true
  const text = body.toString('utf-8')
  return /x-anthropic-billing-header/i.test(text) || /\bcch=[a-f0-9]{5}\b/i.test(text)
}

function findControlPlanePersonaMismatch(
  headers: IncomingMessage['headers'],
  expectedHeaders: Record<string, string>,
): string | null {
  const personaHeaderNames = new Set([
    'anthropic-beta',
    'anthropic-dangerous-direct-browser-access',
    'anthropic-version',
    'user-agent',
    'x-app',
    'x-claude-code-session-id',
    'x-stainless-arch',
    'x-stainless-lang',
    'x-stainless-os',
    'x-stainless-package-version',
    'x-stainless-retry-count',
    'x-stainless-runtime',
    'x-stainless-runtime-version',
    'x-stainless-timeout',
  ])
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    const normalized = key.toLowerCase()
    if (!personaHeaderNames.has(normalized) && !normalized.startsWith('x-stainless-')) continue
    const expectedKey = Object.keys(expectedHeaders).find((candidate) => candidate.toLowerCase() === normalized)
    if (!expectedKey) return key
    const actual = Array.isArray(value) ? value.join(', ') : value
    if (actual !== expectedHeaders[expectedKey]) return key
  }
  return null
}

function verifyRetryFinalOutputContract(
  req: IncomingMessage,
  billingMode: string,
): { ok: true } | { ok: false; status: number; code: string; message: string } {
  const retryAttempt = readHeader(req, 'x-cc-retry-attempt')
  if (!retryAttempt || retryAttempt === '0') return { ok: true }

  const finalOutputReentered = readBooleanHeader(req, 'x-cc-retry-final-output-reentered')
  const previousBillingMode = readHeader(req, 'x-cc-retry-previous-billing-cch-mode')
  if (previousBillingMode && previousBillingMode !== billingMode) {
    return {
      ok: false,
      status: 409,
      code: 'retry_billing_mode_changed',
      message: 'Retry billing/CCH mode changed; refusing silent downgrade or unsigned fallback',
    }
  }

  if (readBooleanHeader(req, 'x-cc-retry-body-mutated') && !finalOutputReentered) {
    return {
      ok: false,
      status: 409,
      code: 'retry_body_mutation_without_reentry',
      message: 'Body-mutating retry must re-enter final-output pipeline',
    }
  }

  if (readBooleanHeader(req, 'x-cc-retry-header-policy-changed') && !finalOutputReentered) {
    return {
      ok: false,
      status: 409,
      code: 'retry_policy_changed_without_reentry',
      message: 'Retry with changed header policy or signing gates must re-enter final-output pipeline',
    }
  }

  return { ok: true }
}

function readBooleanHeader(req: IncomingMessage, name: string): boolean {
  const value = readHeader(req, name)
  return value === '1' || value?.toLowerCase() === 'true'
}

function authenticateForMode(req: IncomingMessage, config: Config): string | null {
  return config.mode === 'sub2api' ? authenticateGateway(req) : authenticate(req)
}

function parseAccountContext(req: IncomingMessage, config: Config): { context: AccountContext } | { status: number; code: string; error: string } {
  const provider = readHeader(req, 'x-cc-provider')
  if (!provider) {
    return { status: 400, code: 'missing_provider', error: 'Missing x-cc-provider' }
  }
  if (provider !== 'anthropic') {
    return { status: 403, code: 'unsupported_provider', error: 'Unsupported provider' }
  }
  if (!config.providers.anthropic) {
    return { status: 403, code: 'provider_disabled', error: 'Provider disabled: anthropic' }
  }

  const tokenType = readHeader(req, 'x-cc-token-type')
  if (!tokenType) {
    return { status: 400, code: 'missing_token_type', error: 'Missing x-cc-token-type' }
  }
  if (!['oauth', 'apikey'].includes(tokenType)) {
    return { status: 400, code: 'unsupported_token_type', error: 'Unsupported x-cc-token-type' }
  }
  const normalizedTokenType = tokenType as 'oauth' | 'apikey'
  if (normalizedTokenType === 'oauth' && !readHeader(req, 'authorization')) {
    return { status: 400, code: 'missing_authorization', error: 'Missing authorization for oauth token type' }
  }
  if (normalizedTokenType === 'apikey' && !readHeader(req, 'x-api-key')) {
    return { status: 400, code: 'missing_api_key', error: 'Missing x-api-key for apikey token type' }
  }

  const accountId = readHeader(req, 'x-cc-account-id')
  if (!accountId) {
    return { status: 400, code: 'missing_account_id', error: 'Missing x-cc-account-id' }
  }

  const egressBucket = readHeader(req, 'x-cc-egress-bucket')
  if (!egressBucket) {
    return { status: 400, code: 'missing_egress_bucket', error: 'Missing x-cc-egress-bucket' }
  }

  const policyVersion = readHeader(req, 'x-cc-policy-version')
  if (!policyVersion) {
    return { status: 400, code: 'missing_policy_version', error: 'Missing x-cc-policy-version' }
  }
  const credentialRef = readHeader(req, 'x-cc-credential-ref')

  return {
    context: {
      provider,
      accountId,
      tokenType: normalizedTokenType,
      credentialRef,
      egressBucket,
      policyVersion,
    },
  }
}

function maybeAllowClaudePlatformAWSMessagesRoute(
  req: IncomingMessage,
  config: Config,
  method: string,
  target: RequestTarget,
  current: ReturnType<typeof selectSharedPoolRoute>,
): { routePolicy: ReturnType<typeof selectSharedPoolRoute> } | { status: number; code: string } {
  if (current.action !== 'block' || method !== 'POST' || target.pathname !== CLAUDE_PLATFORM_AWS_ALLOWED_PATH || target.search !== '') {
    return { routePolicy: current }
  }
  const attestation = parseFormalPoolContext(req, config)
  if (!attestation.ok) {
    return { status: attestation.status, code: attestation.code }
  }
  if (attestation.context.provider_kind !== CLAUDE_PLATFORM_AWS_PROVIDER_KIND) {
    return { routePolicy: current }
  }
  return { routePolicy: { action: 'forward', kind: 'messages' } }
}

function formalPoolAttestationRequired(config: Config): boolean {
  return config.mode === 'sub2api'
}

function formalPoolAttestationSecret(config: Config): string | undefined {
  const sharedPool = (config as any).shared_pool || {}
  const direct = typeof sharedPool.context_attestation_secret === 'string' ? sharedPool.context_attestation_secret.trim() : ''
  if (direct) return direct
  const envName = typeof sharedPool.context_attestation_secret_env === 'string' ? sharedPool.context_attestation_secret_env.trim() : ''
  if (envName && process.env[envName]?.trim()) return process.env[envName]!.trim()
  const fallback = process.env.CC_GATEWAY_CONTEXT_ATTESTATION_SECRET?.trim()
  return fallback || undefined
}

function canonicalFormalPoolContext(value: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) sorted[key] = value[key]
  return JSON.stringify(sorted)
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b) || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

function parseFormalPoolContext(req: IncomingMessage, config: Config): { ok: true; context: AttestedFormalPoolContext; canonical: string } | { ok: false; status: number; code: string } {
  if (!formalPoolAttestationRequired(config)) return { ok: false, status: 204, code: 'formal_pool_context_attestation_not_required' }
  const encodedContext = readHeader(req, FORMAL_POOL_CONTEXT_HEADER)
  const signature = readHeader(req, FORMAL_POOL_SIGNATURE_HEADER)
  if (!encodedContext || !signature) return { ok: false, status: 403, code: 'missing_formal_pool_context_attestation' }

  const secret = formalPoolAttestationSecret(config)
  if (!secret) return { ok: false, status: 403, code: 'missing_formal_pool_context_attestation_secret' }

  let rawContext = ''
  try {
    rawContext = Buffer.from(encodedContext, 'base64url').toString('utf-8')
  } catch {
    return { ok: false, status: 403, code: 'malformed_formal_pool_context_attestation' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawContext)
  } catch {
    return { ok: false, status: 403, code: 'malformed_formal_pool_context_attestation' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, status: 403, code: 'malformed_formal_pool_context_attestation' }
  }
  const obj = parsed as Record<string, unknown>
  const requiredStringFields = [
    'method',
    'route_class',
    'path',
    'account_id',
    'token_type',
    'credential_ref',
    'credential_source',
    'egress_bucket',
    'proxy_identity_ref',
    'policy_version',
    'persona_profile',
    'trusted_egress_profile_ref',
    'profile_policy_version',
    'billing_shape_policy',
    'request_shape_profile_ref',
    'cache_parity_profile_ref',
    'session_id',
    'nonce',
  ]
  for (const field of requiredStringFields) {
    if (typeof obj[field] !== 'string' || !(obj[field] as string).trim() || /[\r\n]/.test(obj[field] as string)) {
      return { ok: false, status: 403, code: 'malformed_formal_pool_context_attestation' }
    }
  }
  if (obj.token_type !== 'oauth' && obj.token_type !== 'apikey') {
    return { ok: false, status: 403, code: 'malformed_formal_pool_context_attestation' }
  }
  if (obj.credential_source !== 'server_account_credentials') {
    return { ok: false, status: 403, code: 'malformed_formal_pool_context_attestation' }
  }
  if (typeof obj.timestamp_ms !== 'number' || !Number.isFinite(obj.timestamp_ms)) {
    return { ok: false, status: 403, code: 'malformed_formal_pool_context_attestation' }
  }
  if (!isSafeIdentityRef(obj.credential_ref) || !isSafeIdentityRef(obj.proxy_identity_ref)) {
    return { ok: false, status: 403, code: 'malformed_formal_pool_context_attestation' }
  }
  const providerKind = typeof obj.provider_kind === 'string' ? obj.provider_kind : undefined
  if (providerKind !== undefined && providerKind !== 'anthropic_first_party' && providerKind !== CLAUDE_PLATFORM_AWS_PROVIDER_KIND) {
    return { ok: false, status: 403, code: 'malformed_formal_pool_context_attestation' }
  }
  if (providerKind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND) {
    const awsRequired = [
      'upstream_auth_scheme',
      'credential_binding_hmac',
      'workspace_ref',
      'workspace_binding_hmac',
      'upstream_endpoint_ref',
      'aws_region',
      'upstream_host',
      'allowed_upstream_path',
      'beta_policy_ref',
    ]
    for (const field of awsRequired) {
      if (typeof obj[field] !== 'string' || !(obj[field] as string).trim() || /[\r\n]/.test(obj[field] as string)) {
        return { ok: false, status: 403, code: 'malformed_formal_pool_context_attestation' }
      }
    }
    if (!isSafeClaudePlatformAWSRef(obj.workspace_ref, 'workspace:')
      || !isSafeClaudePlatformAWSRef(obj.upstream_endpoint_ref, 'endpoint:')
      || !/^hmac-sha256:[a-f0-9]{64}$/i.test(String(obj.credential_binding_hmac))
      || !/^hmac-sha256:[a-f0-9]{64}$/i.test(String(obj.workspace_binding_hmac))
      || !isSafeAWSRegion(obj.aws_region)
      || obj.upstream_host !== claudePlatformAWSHostForRegion(String(obj.aws_region))
      || obj.allowed_upstream_path !== CLAUDE_PLATFORM_AWS_ALLOWED_PATH
      || (obj.upstream_auth_scheme !== 'x_api_key' && obj.upstream_auth_scheme !== 'bearer_api_key')
      || !isSafeProfileRef(obj.beta_policy_ref)) {
      return { ok: false, status: 403, code: 'malformed_formal_pool_context_attestation' }
    }
  }
  if (!isSafeProfileRef(obj.trusted_egress_profile_ref)
    || !isSafeProfileRef(obj.profile_policy_version)
    || !isSafeProfileRef(obj.request_shape_profile_ref)
    || !isSafeProfileRef(obj.cache_parity_profile_ref)
    || !isFormalPoolBillingShapePolicy(obj.billing_shape_policy)
    || !isSafeObservedClientProfile(obj.observed_client_profile)) {
    return { ok: false, status: 403, code: 'malformed_formal_pool_context_attestation' }
  }

  const canonical = canonicalFormalPoolContext(obj)
  const expected = createHmac('sha256', secret).update(canonical).digest('hex')
  const actual = signature.startsWith('hmac-sha256:') ? signature.slice('hmac-sha256:'.length) : signature
  if (!safeEqualHex(actual, expected)) {
    return { ok: false, status: 403, code: 'invalid_formal_pool_context_attestation' }
  }

  if (Math.abs(Date.now() - obj.timestamp_ms) > FORMAL_POOL_ATTESTATION_MAX_SKEW_MS) {
    return { ok: false, status: 403, code: 'expired_formal_pool_context_attestation' }
  }

  return {
    ok: true,
    context: {
      method: obj.method,
      route_class: obj.route_class,
      path: obj.path,
      account_id: obj.account_id,
      token_type: obj.token_type,
      credential_ref: obj.credential_ref,
      credential_source: obj.credential_source,
      egress_bucket: obj.egress_bucket,
      proxy_identity_ref: obj.proxy_identity_ref,
      policy_version: obj.policy_version,
      persona_profile: obj.persona_profile,
      trusted_egress_profile_ref: obj.trusted_egress_profile_ref,
      profile_policy_version: obj.profile_policy_version,
      billing_shape_policy: obj.billing_shape_policy,
      request_shape_profile_ref: obj.request_shape_profile_ref,
      cache_parity_profile_ref: obj.cache_parity_profile_ref,
      observed_client_profile: obj.observed_client_profile as Record<string, unknown>,
      session_id: obj.session_id,
      timestamp_ms: obj.timestamp_ms,
      nonce: obj.nonce,
      ...(providerKind ? { provider_kind: providerKind } : {}),
      ...(providerKind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND ? {
        credential_binding_hmac: obj.credential_binding_hmac,
        upstream_auth_scheme: obj.upstream_auth_scheme,
        workspace_ref: obj.workspace_ref,
        workspace_binding_hmac: obj.workspace_binding_hmac,
        upstream_endpoint_ref: obj.upstream_endpoint_ref,
        aws_region: obj.aws_region,
        upstream_host: obj.upstream_host,
        allowed_upstream_path: obj.allowed_upstream_path,
        beta_policy_ref: obj.beta_policy_ref,
      } : {}),
    } as AttestedFormalPoolContext,
    canonical,
  }
}


function isSafeProfileRef(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed === value && SAFE_PROFILE_REF.test(trimmed)
}

function isSafeProviderScopedRef(value: unknown, prefix: string): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed !== value || !trimmed.startsWith(prefix) || trimmed.length <= prefix.length || trimmed.length > 512) return false
  if (/[\r\n]/.test(trimmed) || trimmed.includes('://') || trimmed.includes('@')) return false
  if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) return false
  return true
}

function isSafeClaudePlatformAWSRef(value: unknown, prefix: string): value is string {
  return isSafeIdentityRef(value) || isSafeProviderScopedRef(value, prefix)
}

function isSafeAWSRegion(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z]{2}-[a-z]+-\d$/.test(value)
}

function claudePlatformAWSHostForRegion(region: string): string {
  return `${CLAUDE_PLATFORM_AWS_HOST_PREFIX}${region}${CLAUDE_PLATFORM_AWS_HOST_SUFFIX}`
}

function isConfiguredClaudePlatformAWSUpstream(upstream: URL): boolean {
  const host = upstream.hostname.toLowerCase()
  return host.startsWith(CLAUDE_PLATFORM_AWS_HOST_PREFIX) && host.endsWith(CLAUDE_PLATFORM_AWS_HOST_SUFFIX)
}

function isFormalPoolBillingShapePolicy(value: unknown): value is FormalPoolBillingShapePolicy {
  return value === 'strip' || value === 'no_cch' || value === 'signed_cch'
}

function isSafeObservedClientProfile(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const profile = value as Record<string, unknown>
  for (const key of Object.keys(profile)) {
    if (!OBSERVED_CLIENT_PROFILE_SAFE_KEYS.has(key)) return false
  }
  if (profile.schema_version !== undefined && profile.schema_version !== 'observed_client_profile.v1') return false
  if (profile.cli_version_bucket !== undefined && !isSafeObservedBucket(profile.cli_version_bucket)) return false
  if (profile.route_class !== undefined && !['messages', 'count_tokens', 'control_plane', 'event_logging_legacy', 'event_logging_v2'].includes(String(profile.route_class))) return false
  if (profile.billing_shape !== undefined && !['absent', 'no_cch', 'cch_present', 'unknown'].includes(String(profile.billing_shape))) return false
  if (profile.cc_entrypoint_bucket !== undefined && !['absent', 'cli', 'sdk-cli', 'other', 'unknown'].includes(String(profile.cc_entrypoint_bucket))) return false
  if (profile.stream !== undefined && typeof profile.stream !== 'boolean') return false
  for (const key of ['thinking_present', 'output_config_present', 'context_management_present']) {
    if (profile[key] !== undefined && typeof profile[key] !== 'boolean') return false
  }
  for (const key of ['unknown_top_level_body_key_count', 'tool_count', 'billing_block_count']) {
    const value = profile[key]
    if (value !== undefined && (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 1000)) return false
  }
  if (profile.top_level_body_keys !== undefined) {
    if (!Array.isArray(profile.top_level_body_keys)) return false
    for (const key of profile.top_level_body_keys) {
      if (typeof key !== 'string' || !/^[a-z_]{1,64}$/.test(key)) return false
    }
  }
  return true
}

function isSafeObservedBucket(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return /^(unknown|latest|\d+\.\d+\.\d+)$/.test(value)
}

function formalPoolBillingModeFromAttestation(attested: AttestedFormalPoolContext): FormalPoolBillingMode {
  if (attested.billing_shape_policy === 'signed_cch') return 'sign'
  if (attested.billing_shape_policy === 'no_cch') return 'no_cch'
  return 'strip'
}

function verifyFormalPoolAttestedProfiles(
  config: Config,
  attested: AttestedFormalPoolContext,
): { ok: true } | { ok: false; status: number; code: string; message: string } {
  const profileRefCheck = verifyFormalPoolProfileRefs(attested)
  if (!profileRefCheck.ok) return profileRefCheck

  const optionalProfile = attested.trusted_egress_profile_ref === FORMAL_POOL_2179_NO_CCH_PROFILE_REF
    || attested.trusted_egress_profile_ref === FORMAL_POOL_2179_SIGNED_CCH_PROFILE_REF
  const observedCheck = verifyObservedClientProfileAdmission(attested, optionalProfile)
  if (!observedCheck.ok) return observedCheck

  if (attested.trusted_egress_profile_ref === FORMAL_POOL_DEFAULT_EGRESS_PROFILE_REF) {
    if (attested.billing_shape_policy !== 'strip') {
      return { ok: false, status: 403, code: 'formal_pool_billing_policy_mismatch', message: 'Formal-pool strip_attribution profile requires strip billing policy' }
    }
    return { ok: true }
  }

  if (attested.trusted_egress_profile_ref === FORMAL_POOL_2179_NO_CCH_PROFILE_REF) {
    if (attested.billing_shape_policy !== 'no_cch') {
      return { ok: false, status: 403, code: 'formal_pool_billing_policy_mismatch', message: 'Formal-pool no-CCH profile requires no_cch billing policy' }
    }
    const tupleCheck = verifyFormalPool2179OracleTuple(config, attested, 'no_cch')
    if (!tupleCheck.ok) return tupleCheck
    return { ok: true }
  }

  if (attested.trusted_egress_profile_ref === FORMAL_POOL_2179_SIGNED_CCH_PROFILE_REF) {
    if (attested.billing_shape_policy !== 'signed_cch') {
      return { ok: false, status: 403, code: 'formal_pool_billing_policy_mismatch', message: 'Formal-pool signed-CCH profile requires signed_cch billing policy' }
    }
    const tupleCheck = verifyFormalPool2179OracleTuple(config, attested, 'signed_cch')
    if (!tupleCheck.ok) return tupleCheck
    return { ok: true }
  }

  return { ok: false, status: 403, code: 'formal_pool_profile_ref_unapproved', message: 'Formal-pool egress profile is not approved' }
}

function verifyFormalPoolProfileRefs(attested: AttestedFormalPoolContext): { ok: true } | { ok: false; status: number; code: string; message: string } {
  if (attested.provider_kind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND) {
    if (attested.profile_policy_version !== FORMAL_POOL_2179_PROFILE_POLICY_VERSION) {
      return { ok: false, status: 403, code: 'formal_pool_profile_ref_unapproved', message: 'Formal-pool profile policy version is not approved' }
    }
    if (attested.trusted_egress_profile_ref !== FORMAL_POOL_DEFAULT_EGRESS_PROFILE_REF || attested.billing_shape_policy !== 'strip') {
      return { ok: false, status: 403, code: 'formal_pool_billing_policy_mismatch', message: 'Claude Platform on AWS phase 1 requires strip billing policy' }
    }
    if (attested.request_shape_profile_ref !== CLAUDE_PLATFORM_AWS_REQUEST_SHAPE_PROFILE_REF
      || attested.cache_parity_profile_ref !== CLAUDE_PLATFORM_AWS_CACHE_PARITY_PROFILE_REF
      || attested.beta_policy_ref !== CLAUDE_PLATFORM_AWS_BETA_POLICY_REF) {
      return { ok: false, status: 403, code: 'formal_pool_profile_ref_unapproved', message: 'Claude Platform on AWS provider-scoped profile is not approved' }
    }
    if (attested.upstream_auth_scheme !== 'x_api_key') {
      return { ok: false, status: 403, code: 'claude_platform_aws_auth_profile_unproven', message: 'Claude Platform on AWS auth profile has not been proven by CP0' }
    }
    return { ok: true }
  }
  if (attested.profile_policy_version !== FORMAL_POOL_2179_PROFILE_POLICY_VERSION) {
    return { ok: false, status: 403, code: 'formal_pool_profile_ref_unapproved', message: 'Formal-pool profile policy version is not approved' }
  }
  if (attested.request_shape_profile_ref !== FORMAL_POOL_2179_REQUEST_SHAPE_PROFILE_REF) {
    return { ok: false, status: 403, code: 'formal_pool_profile_ref_unapproved', message: 'Formal-pool request shape profile is not approved' }
  }
  if (attested.cache_parity_profile_ref !== FORMAL_POOL_2179_CACHE_PARITY_PROFILE_REF) {
    return { ok: false, status: 403, code: 'formal_pool_profile_ref_unapproved', message: 'Formal-pool cache parity profile is not approved' }
  }
  return { ok: true }
}

function verifyObservedClientProfileAdmission(attested: AttestedFormalPoolContext, requireExact2179 = false): { ok: true } | { ok: false; status: number; code: string; message: string } {
  const profile = attested.observed_client_profile
  if ((profile.unknown_top_level_body_key_count as number | undefined) && Number(profile.unknown_top_level_body_key_count) > 0) {
    return { ok: false, status: 403, code: 'formal_pool_observed_client_profile_unapproved', message: 'Formal-pool observed client profile contains unknown body keys' }
  }
  const version = typeof profile.cli_version_bucket === 'string' ? profile.cli_version_bucket : ''
  if (requireExact2179 && version !== '2.1.179') {
    return { ok: false, status: 403, code: 'formal_pool_observed_client_profile_unapproved', message: 'Formal-pool optional egress profiles require exact 2.1.179 observed client proof' }
  }
  if (version && version !== '2.1.179' && version !== 'unknown') {
    return { ok: false, status: 403, code: 'formal_pool_observed_client_profile_unapproved', message: 'Formal-pool observed client version is not approved for this profile' }
  }
  const billingShape = typeof profile.billing_shape === 'string' ? profile.billing_shape : ''
  if (billingShape && !['absent', 'no_cch', 'cch_present'].includes(billingShape)) {
    return { ok: false, status: 403, code: 'formal_pool_observed_client_profile_unapproved', message: 'Formal-pool observed billing shape is not approved' }
  }
  return { ok: true }
}

function verifyFormalPool2179OracleTuple(
  config: Config,
  attested: AttestedFormalPoolContext,
  shape: 'no_cch' | 'signed_cch',
): { ok: true } | { ok: false; status: number; code: string; message: string } {
  if (attested.policy_version !== '2.1.179') {
    return { ok: false, status: 403, code: 'formal_pool_egress_profile_oracle_tuple_mismatch', message: 'Formal-pool optional egress profile is not bound to the 2.1.179 oracle tuple' }
  }
  const sharedPool = (config as any).shared_pool || {}
  const prefix = shape === 'no_cch' ? 'no_cch_2179' : 'signed_cch_2179'
  const expectedRef = shape === 'no_cch' ? FORMAL_POOL_2179_NO_CCH_ORACLE_PROFILE_REF : FORMAL_POOL_2179_SIGNED_CCH_ORACLE_PROFILE_REF
  if (sharedPool[`${prefix}_oracle_profile_approved`] !== true || sharedPool[`${prefix}_oracle_profile_ref`] !== expectedRef) {
    return { ok: false, status: 403, code: 'formal_pool_egress_profile_oracle_missing', message: 'Formal-pool optional 2.1.179 egress profile requires exact oracle proof ref' }
  }
  return { ok: true }
}

function expectedFormalPoolRouteClass(routePolicy: ReturnType<typeof selectSharedPoolRoute> | null): string {
  if (routePolicy?.action === 'forward') return 'messages'
  if (routePolicy?.action === 'suppress') return routePolicy.kind
  return 'messages'
}

function verifyFormalPoolAttestedHeaders(
  req: IncomingMessage,
  method: string,
  target: RequestTarget,
  routePolicy: ReturnType<typeof selectSharedPoolRoute> | null,
  accountContext: AccountContext,
  attested: AttestedFormalPoolContext,
  egress?: EgressBucketResolution,
): { ok: true } | { ok: false; status: number; code: string } {
  const mismatches = [
    attested.method !== method,
    attested.path !== target.pathname,
    attested.route_class !== expectedFormalPoolRouteClass(routePolicy),
    attested.account_id !== accountContext.accountId,
    attested.token_type !== accountContext.tokenType,
    attested.credential_ref !== accountContext.credentialRef,
    attested.credential_source !== 'server_account_credentials',
    attested.egress_bucket !== accountContext.egressBucket,
    attested.policy_version !== accountContext.policyVersion,
  ]
  if (egress) mismatches.push(attested.proxy_identity_ref !== egress.proxyIdentityRef)
  if (attested.provider_kind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND) {
    mismatches.push(
      target.search !== '',
      attested.allowed_upstream_path !== CLAUDE_PLATFORM_AWS_ALLOWED_PATH,
      attested.path !== CLAUDE_PLATFORM_AWS_ALLOWED_PATH,
      attested.upstream_host !== claudePlatformAWSHostForRegion(String(attested.aws_region || '')),
    )
  }
  if (mismatches.some(Boolean)) return { ok: false, status: 403, code: 'formal_pool_context_mismatch' }
  return { ok: true }
}

function verifyFormalPoolAttestedAccountIdentity(
  attested: AttestedFormalPoolContext,
  identity: AccountIdentityRecord,
): { ok: true } | { ok: false; status: number; code: string } {
  const mismatches = [
    !identity.credential_ref,
    attested.credential_ref !== identity.credential_ref,
    attested.policy_version !== identity.policy_version,
  ]
  if (attested.provider_kind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND) {
    mismatches.push(
      identity.provider_kind !== CLAUDE_PLATFORM_AWS_PROVIDER_KIND,
      identity.token_type !== 'apikey',
      attested.workspace_ref !== identity.workspace_ref,
      attested.workspace_binding_hmac !== identity.workspace_binding_hmac,
      attested.upstream_endpoint_ref !== identity.upstream_endpoint_ref,
      attested.aws_region !== identity.aws_region,
      attested.upstream_host !== identity.upstream_host,
      attested.allowed_upstream_path !== identity.allowed_upstream_path,
      attested.upstream_auth_scheme !== identity.upstream_auth_scheme,
      attested.beta_policy_ref !== identity.beta_policy_ref,
      attested.request_shape_profile_ref !== identity.request_shape_profile_ref,
      attested.cache_parity_profile_ref !== identity.cache_parity_profile_ref,
      !identity.anthropic_workspace_id,
    )
  } else if (identity.provider_kind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND) {
    mismatches.push(true)
  }
  if (mismatches.some(Boolean)) return { ok: false, status: 403, code: 'formal_pool_context_mismatch' }
  return { ok: true }
}

function verifySelectedCredentialBinding(
  req: IncomingMessage,
  config: Config,
  accountContext: AccountContext,
  identity: AccountIdentityRecord,
  attestedCredentialRef: string,
  attestedCredentialBindingHmac?: string,
): { ok: true } | { ok: false; status: number; code: string } {
  if (!identity.credential_ref || accountContext.credentialRef !== identity.credential_ref || attestedCredentialRef !== identity.credential_ref) {
    return { ok: false, status: 403, code: 'credential_account_mismatch' }
  }
  const binding = typeof identity.credential_binding_hmac === 'string' ? identity.credential_binding_hmac.trim() : ''
  if (attestedCredentialBindingHmac !== undefined && attestedCredentialBindingHmac !== binding) {
    return { ok: false, status: 403, code: 'credential_account_mismatch' }
  }
  const expectedHex = /^hmac-sha256:[a-f0-9]{64}$/i.test(binding) ? binding.slice('hmac-sha256:'.length) : ''
  const selectedCredential = selectedRawCredentialForBinding(req, accountContext.tokenType)
  const secret = formalPoolAttestationSecret(config)
  if (!expectedHex || !selectedCredential || !secret) {
    return { ok: false, status: 403, code: 'credential_account_mismatch' }
  }
  const actualHex = credentialBindingHmacHex(secret, accountContext.tokenType, selectedCredential)
  if (!safeEqualHex(actualHex, expectedHex)) {
    return { ok: false, status: 403, code: 'credential_account_mismatch' }
  }
  return { ok: true }
}

function selectedRawCredentialForBinding(req: IncomingMessage, tokenType: 'oauth' | 'apikey'): string | undefined {
  return tokenType === 'oauth' ? readHeader(req, 'authorization') : readHeader(req, 'x-api-key')
}

function credentialBindingHmacHex(secret: string, tokenType: 'oauth' | 'apikey', rawCredential: string): string {
  return createHmac('sha256', secret)
    .update('formal_pool_credential_binding_v1')
    .update('\0')
    .update(tokenType)
    .update('\0')
    .update(rawCredential)
    .digest('hex')
}

function verifyFormalPoolAttestedSession(
  config: Config,
  runtimeState: ProxyRuntimeState,
  attested: AttestedFormalPoolContext,
  sessionId: string | undefined,
): { ok: true } | { ok: false; status: number; code: string } {
  if (!sessionId || attested.session_id !== sessionId) {
    return { ok: false, status: 403, code: 'formal_pool_context_mismatch' }
  }
  const ledgerFile = formalPoolSessionLedgerFilePath()
  if (formalPoolSessionLedgerPersistenceRequired(config) && !ledgerFile) {
    return { ok: false, status: 403, code: 'formal_pool_session_ledger_unavailable' }
  }
  const nonceRef = formalPoolAttestationNonceRef(config, attested)
  if (!nonceRef) return { ok: false, status: 403, code: 'formal_pool_session_ledger_unavailable' }
  const now = Date.now()
  if (ledgerFile) {
    let persisted: FormalPoolSessionAuthorityLedgerFile
    try {
      persisted = loadFormalPoolSessionAuthorityLedger(ledgerFile)
    } catch {
      return { ok: false, status: 403, code: 'formal_pool_session_ledger_unavailable' }
    }
    pruneFormalPoolAttestationNonces(persisted.attestation_nonces, now)
    if (persisted.attestation_nonces[nonceRef]) {
      return { ok: false, status: 403, code: 'replayed_formal_pool_context_attestation' }
    }
    return { ok: true }
  }
  pruneFormalPoolAttestationNonceMap(runtimeState.formalPoolAttestationNonces, now)
  if (runtimeState.formalPoolAttestationNonces.has(nonceRef)) {
    return { ok: false, status: 403, code: 'replayed_formal_pool_context_attestation' }
  }
  return { ok: true }
}

function verifyFormalPoolSessionAuthorityBinding(
  config: Config,
  runtimeState: ProxyRuntimeState,
  attested: AttestedFormalPoolContext,
  identity: AccountIdentityRecord,
): { ok: true } | { ok: false; status: number; code: string; message: string } {
  const sessionKey = formalPoolSessionAuthorityRef(config, 'session', attested.session_id)
  const deviceRef = formalPoolSessionAuthorityRef(config, 'device', identity.device_id)
  const nonceRef = formalPoolAttestationNonceRef(config, attested)
  if (!sessionKey || !deviceRef || !nonceRef) {
    return { ok: false, status: 403, code: 'formal_pool_session_ledger_unavailable', message: 'Formal-pool session authority ledger is unavailable' }
  }
  const binding: FormalPoolSessionAuthorityBinding = {
    account_id: attested.account_id,
    credential_ref: attested.credential_ref,
    credential_source: attested.credential_source,
    egress_bucket: attested.egress_bucket,
    proxy_identity_ref: attested.proxy_identity_ref,
    policy_version: attested.policy_version,
    persona_profile: attested.persona_profile,
    trusted_egress_profile_ref: attested.trusted_egress_profile_ref,
    profile_policy_version: attested.profile_policy_version,
    billing_shape_policy: attested.billing_shape_policy,
    request_shape_profile_ref: attested.request_shape_profile_ref,
    cache_parity_profile_ref: attested.cache_parity_profile_ref,
    device_ref: deviceRef,
    ...(attested.provider_kind ? { provider_kind: attested.provider_kind } : {}),
    ...(attested.provider_kind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND ? {
      workspace_ref: attested.workspace_ref,
      workspace_binding_hmac: attested.workspace_binding_hmac,
      upstream_endpoint_ref: attested.upstream_endpoint_ref,
      aws_region: attested.aws_region,
      upstream_host: attested.upstream_host,
      allowed_upstream_path: attested.allowed_upstream_path,
      upstream_auth_scheme: attested.upstream_auth_scheme,
      beta_policy_ref: attested.beta_policy_ref,
    } : {}),
  }
  const ledgerFile = formalPoolSessionLedgerFilePath()
  if (formalPoolSessionLedgerPersistenceRequired(config) && !ledgerFile) {
    return { ok: false, status: 403, code: 'formal_pool_session_ledger_unavailable', message: 'Formal-pool production requires a persistent session authority ledger' }
  }

  const now = Date.now()
  const nonceExpiry = formalPoolAttestationNonceExpiry(attested, now)
  let previous = runtimeState.formalPoolSessionAuthorityLedger.get(sessionKey)
  if (ledgerFile) {
    let persisted: FormalPoolSessionAuthorityLedgerFile
    try {
      persisted = loadFormalPoolSessionAuthorityLedger(ledgerFile)
    } catch {
      return { ok: false, status: 403, code: 'formal_pool_session_ledger_unavailable', message: 'Formal-pool session authority ledger is unavailable' }
    }
    pruneFormalPoolAttestationNonces(persisted.attestation_nonces, now)
    if (persisted.attestation_nonces[nonceRef]) {
      return { ok: false, status: 403, code: 'replayed_formal_pool_context_attestation', message: 'Formal-pool scheduler context attestation was already used' }
    }
    const persistedSession = persisted.sessions[sessionKey]
    previous = persistedSession || previous
    if (previous && !sameFormalPoolSessionAuthorityBinding(previous, binding)) {
      return { ok: false, status: 403, code: 'formal_pool_session_authority_mismatch', message: 'Formal-pool session authority changed across requests' }
    }
    const next: FormalPoolSessionAuthorityLedgerFile = {
      version: 1,
      sessions: { ...persisted.sessions, ...(persistedSession ? {} : { [sessionKey]: binding }) },
      attestation_nonces: { ...persisted.attestation_nonces, [nonceRef]: nonceExpiry },
    }
    try {
      writeFormalPoolSessionAuthorityLedger(ledgerFile, next, 'session_authority')
    } catch (err) {
      log('error', 'Formal-pool session authority ledger persistence failed', { error: err instanceof Error ? err.message : 'unknown' })
      return { ok: false, status: 500, code: 'formal_pool_session_ledger_persist_failed', message: 'Formal-pool session authority ledger could not be persisted' }
    }
    runtimeState.formalPoolSessionAuthorityLedger.set(sessionKey, binding)
    runtimeState.formalPoolAttestationNonces.set(nonceRef, nonceExpiry)
    return { ok: true }
  }

  pruneFormalPoolAttestationNonceMap(runtimeState.formalPoolAttestationNonces, now)
  if (runtimeState.formalPoolAttestationNonces.has(nonceRef)) {
    return { ok: false, status: 403, code: 'replayed_formal_pool_context_attestation', message: 'Formal-pool scheduler context attestation was already used' }
  }
  if (previous && !sameFormalPoolSessionAuthorityBinding(previous, binding)) {
    return { ok: false, status: 403, code: 'formal_pool_session_authority_mismatch', message: 'Formal-pool session authority changed across requests' }
  }
  runtimeState.formalPoolSessionAuthorityLedger.set(sessionKey, binding)
  runtimeState.formalPoolAttestationNonces.set(nonceRef, nonceExpiry)
  return { ok: true }
}

function formalPoolSessionAuthorityRef(config: Config, scope: 'session' | 'device', value: string): string {
  const secret = formalPoolAttestationSecret(config)
  if (!secret || !value) return ''
  return `hmac-sha256:${createHmac('sha256', secret)
    .update(`formal_pool_session_authority_${scope}`)
    .update('\0')
    .update(value)
    .digest('hex')}`
}

function formalPoolAttestationNonceRef(config: Config, attested: AttestedFormalPoolContext): string {
  const secret = formalPoolAttestationSecret(config)
  if (!secret || !attested.nonce || !Number.isFinite(attested.timestamp_ms)) return ''
  return `hmac-sha256:${createHmac('sha256', secret)
    .update('formal_pool_attestation_nonce')
    .update('\0')
    .update(String(attested.timestamp_ms))
    .update('\0')
    .update(attested.nonce)
    .digest('hex')}`
}

function formalPoolAttestationNonceExpiry(attested: AttestedFormalPoolContext, now = Date.now()): number {
  return Math.max(now, attested.timestamp_ms) + FORMAL_POOL_ATTESTATION_MAX_SKEW_MS
}

function pruneFormalPoolAttestationNonces(nonces: Record<string, number>, now = Date.now()) {
  for (const [key, expiresAt] of Object.entries(nonces)) {
    if (expiresAt < now) delete nonces[key]
  }
}

function pruneFormalPoolAttestationNonceMap(nonces: Map<string, number>, now = Date.now()) {
  for (const [key, expiresAt] of nonces) {
    if (expiresAt < now) nonces.delete(key)
  }
}

function sameFormalPoolSessionAuthorityBinding(a: FormalPoolSessionAuthorityBinding, b: FormalPoolSessionAuthorityBinding): boolean {
  return a.account_id === b.account_id
    && a.credential_ref === b.credential_ref
    && a.credential_source === b.credential_source
    && a.egress_bucket === b.egress_bucket
    && a.proxy_identity_ref === b.proxy_identity_ref
    && a.policy_version === b.policy_version
    && a.persona_profile === b.persona_profile
    && a.trusted_egress_profile_ref === b.trusted_egress_profile_ref
    && a.profile_policy_version === b.profile_policy_version
    && a.billing_shape_policy === b.billing_shape_policy
    && a.request_shape_profile_ref === b.request_shape_profile_ref
    && a.cache_parity_profile_ref === b.cache_parity_profile_ref
    && a.device_ref === b.device_ref
    && (a.provider_kind || '') === (b.provider_kind || '')
    && (a.workspace_ref || '') === (b.workspace_ref || '')
    && (a.workspace_binding_hmac || '') === (b.workspace_binding_hmac || '')
    && (a.upstream_endpoint_ref || '') === (b.upstream_endpoint_ref || '')
    && (a.aws_region || '') === (b.aws_region || '')
    && (a.upstream_host || '') === (b.upstream_host || '')
    && (a.allowed_upstream_path || '') === (b.allowed_upstream_path || '')
    && (a.upstream_auth_scheme || '') === (b.upstream_auth_scheme || '')
    && (a.beta_policy_ref || '') === (b.beta_policy_ref || '')
}


function formalPoolRequestUsesPolicyVersion(
  version: string,
  config: Config,
  accountContext: AccountContext | null,
  accountIdentity: AccountIdentityRecord | null,
  formalPoolAttestation: AttestedFormalPoolContext | null,
): boolean {
  const expected = String(version || '').trim()
  if (!expected) return false
  return [
    accountContext?.policyVersion,
    formalPoolAttestation?.policy_version,
    accountIdentity?.policy_version,
    config.env?.version,
  ].some((candidate) => String(candidate || '').trim() === expected)
}

function verifyFormalPoolAttestedPersona(attested: AttestedFormalPoolContext, ...acceptedProfiles: Array<string | undefined>): { ok: true } | { ok: false; status: number; code: string } {
  const accepted = new Set<string>()
  for (const profile of acceptedProfiles) {
    if (!profile) continue
    accepted.add(profile)
    const canonical = resolvePersonaProfileId(profile)
    if (canonical) accepted.add(canonical)
  }
  if (!accepted.has(attested.persona_profile)) {
    return { ok: false, status: 403, code: 'formal_pool_context_mismatch' }
  }
  return { ok: true }
}

function readHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  if (Array.isArray(value)) return value[0]
  return value
}

function readHeaderValue(
  headers: IncomingMessage['headers'],
  name: string,
): string | undefined {
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target || value === undefined) continue
    return Array.isArray(value) ? value.join(', ') : value
  }
  return undefined
}

type RequestTarget = {
  path: string
  pathname: string
  search: string
}

function normalizeRequestTarget(reqUrl: string): RequestTarget {
  const parsed = new URL(reqUrl, 'http://cc-gateway.local')
  return {
    path: `${parsed.pathname}${parsed.search}`,
    pathname: parsed.pathname,
    search: parsed.search,
  }
}

function buildFixedUpstreamUrl(target: RequestTarget, upstream: URL): URL {
  const upstreamUrl = new URL(upstream.toString())
  upstreamUrl.pathname = target.pathname
  upstreamUrl.search = target.search
  return upstreamUrl
}

async function readRequestBody(req: IncomingMessage, maxBytes?: number): Promise<{ body: Buffer } | { error: 'body_too_large' }> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    total += buffer.length
    if (maxBytes !== undefined && total > maxBytes) {
      for await (const _ of req) {
        // Drain remaining bytes so the client receives the control-plane response.
      }
      return { error: 'body_too_large' }
    }
    chunks.push(buffer)
  }
  return { body: Buffer.concat(chunks) }
}

async function drainRequestWithinLimit(req: IncomingMessage, maxBytes: number, res: ServerResponse): Promise<void> {
  const result = await readRequestBody(req, maxBytes)
  if ('error' in result) {
    writeControlPlaneError(res, 413, 'body_too_large', 'Shared-pool request body exceeds configured cap')
  }
}

/**
 * Build a sample payload showing what the rewriter produces.
 * Used by /_verify endpoint for admin validation.
 */
function buildVerificationPayload(config: Config) {
  // Simulate a /v1/messages request body
  const sampleInput = {
    metadata: {
      user_id: JSON.stringify({
        device_id: 'REAL_DEVICE_ID_FROM_CLIENT_abc123',
        account_uuid: 'shared-account-uuid',
        session_id: 'session-xxx',
      }),
    },
    system: [
      {
        type: 'text',
        text: `x-anthropic-billing-header: cc_version=${config.env.version}.a1b;`,
      },
      {
        type: 'text',
        text: `Here is useful information about the environment:\n<env>\nWorking directory: /home/bob/myproject\nPlatform: linux\nShell: bash\nOS Version: Linux 6.5.0-generic\n</env>`,
      },
    ],
    messages: [{ role: 'user', content: 'hello' }],
  }

  const rewritten = JSON.parse(
    rewriteBody(Buffer.from(JSON.stringify(sampleInput)), '/v1/messages', config).toString('utf-8'),
  )

  return {
    _info: 'This shows how the gateway rewrites a sample request',
    before: {
      'metadata.user_id': JSON.parse(sampleInput.metadata.user_id),
      billing_header: sampleInput.system[0].text,
      system_prompt_env: sampleInput.system[1].text,
      system_block_count: sampleInput.system.length,
    },
    after: {
      'metadata.user_id': JSON.parse(rewritten.metadata.user_id),
      billing_header: '(stripped)',
      system_prompt_env: rewritten.system[0]?.text ?? '(empty)',
      system_block_count: rewritten.system.length,
    },
  }
}
