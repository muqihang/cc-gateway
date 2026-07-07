import { createServer as createHttpsServer, type ServerOptions } from 'https'
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'http'
import { isIP } from 'net'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { request as httpsRequest } from 'https'
import { URL } from 'url'
import { dirname } from 'path'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'zlib'
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import { isProductionFormalPool, type Config } from './config.js'
import { authenticate, authenticateGateway, initAuth } from './auth.js'
import { getAccessToken } from './oauth.js'
import { rewriteBody, rewriteHeaders } from './rewriter.js'
import { audit, log } from './logger.js'
import { getProxyAgent } from './proxy-agent.js'
import { callEgressSidecar, egressSidecarEnabled, egressSidecarTargetHost, openEgressSidecar, prepareEgressSidecarRequest } from './egress-sidecar-client.js'
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
import { isKnownEnabledTLSProfileRef, isSafeTLSProfileRef, tlsProfileMode } from './egress-tls-profile.js'
import { resolvePersonaProfileId } from './persona-registry.js'
import { claudeCodeEnvResidueTaxonomySummary, classifyClaudeCodeEnvResidue } from './claude-code-env-residue-taxonomy.js'

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
const FORMAL_POOL_2197_PROFILE_POLICY_VERSION = 'claude_code_2_1_197_plan76_native_policy_v1'
const FORMAL_POOL_2197_LEGACY_PROFILE_POLICY_VERSION = 'claude_code_2_1_197_plan76_sonnet5_policy_v1'
const FORMAL_POOL_2179_REQUEST_SHAPE_PROFILE_REF = 'claude_code_2_1_179_messages_streaming_tooldefs_degraded_v1'
const FORMAL_POOL_2197_REQUEST_SHAPE_PROFILE_REF = 'claude_code_2_1_197_messages_streaming_tooldefs_native_v1'
const FORMAL_POOL_2197_LEGACY_REQUEST_SHAPE_PROFILE_REF = 'claude_code_2_1_197_messages_streaming_tooldefs_sonnet5_v1'
const FORMAL_POOL_2179_CACHE_PARITY_PROFILE_REF = 'claude_code_2_1_179_cache_parity_degraded_v1'
const FORMAL_POOL_2197_CACHE_PARITY_PROFILE_REF = 'claude_code_2_1_197_cache_parity_native_v1'
const FORMAL_POOL_2197_LEGACY_CACHE_PARITY_PROFILE_REF = 'claude_code_2_1_197_cache_parity_sonnet5_v1'
const FORMAL_POOL_2197_TLS_PROFILE_REF = 'tls-profile:claude-code-2.1.197-real-oracle-tcp-v1'
const FORMAL_POOL_ENV_RESIDUE_PROFILE_REF = 'env-residue-profile:claude-code-2.1.179-us-pacific-official-anthropic-v1'
const FORMAL_POOL_LOCALE_PROFILE_REF = 'locale-profile:us-pacific-v1'
const FORMAL_POOL_BASE_URL_RESIDUE_PROFILE_REF = 'base-url-residue-profile:official-anthropic-v1'
const FORMAL_POOL_2179_NO_CCH_PROFILE_REF = 'claude_code_2_1_179_custom_base_no_cch'
const FORMAL_POOL_2179_SIGNED_CCH_PROFILE_REF = 'claude_code_2_1_179_first_party_signed_cch'
const FORMAL_POOL_2179_NO_CCH_ORACLE_PROFILE_REF = 'claude_code_2_1_179_custom_base_no_cch_oracle_cp1_degraded_v1'
const FORMAL_POOL_2179_SIGNED_CCH_ORACLE_PROFILE_REF = 'claude_code_2_1_179_first_party_signed_cch_oracle_cp1_degraded_v1'
const FORMAL_POOL_OBSERVED_MIN_CLI_VERSION = '2.1.179'
const CLAUDE_PLATFORM_AWS_PROVIDER_KIND = 'claude_platform_aws'
const CLAUDE_PLATFORM_AWS_REQUEST_SHAPE_PROFILE_REF = 'request-shape:claude-platform-aws-v1-strip'
const CLAUDE_PLATFORM_AWS_CACHE_PARITY_PROFILE_REF = 'cache-profile:claude-platform-aws-v1-strip'
const CLAUDE_PLATFORM_AWS_BETA_POLICY_REF = 'beta-policy:claude-platform-aws-v1-strip'
const CLAUDE_PLATFORM_AWS_ALLOWED_PATH = '/v1/messages'
const CLAUDE_PLATFORM_AWS_HOST_PREFIX = 'aws-external-anthropic.'
const CLAUDE_PLATFORM_AWS_HOST_SUFFIX = '.api.aws'
const CLAUDE_PLATFORM_AWS_WORKSPACE_REF_DOMAIN = 'claude_platform_aws_workspace_ref_v1'
const CLAUDE_PLATFORM_AWS_BINDING_DOMAIN = 'claude_platform_aws_workspace_binding_v1'
const CLAUDE_PLATFORM_AWS_SIGV4_SERVICE = 'aws-external-anthropic'
const CLAUDE_PLATFORM_AWS_SIGV4_ALGORITHM = 'AWS4-HMAC-SHA256'
const SAFE_PROFILE_REF = /^[A-Za-z0-9._:-]{1,160}$/
const FORMAL_POOL_MCP_CONNECTOR_POLICY_REF = 'mcp-connector-policy:official-remote-https-v1'
const FORMAL_POOL_MCP_BETA = 'mcp-client-2025-11-20'

function isFormalPool2197ProfilePolicyVersion(value: unknown): boolean {
  return value === FORMAL_POOL_2197_PROFILE_POLICY_VERSION || value === FORMAL_POOL_2197_LEGACY_PROFILE_POLICY_VERSION
}

function isFormalPool2197RequestShapeProfileRef(value: unknown): boolean {
  return value === FORMAL_POOL_2197_REQUEST_SHAPE_PROFILE_REF || value === FORMAL_POOL_2197_LEGACY_REQUEST_SHAPE_PROFILE_REF
}

function isFormalPool2197CacheParityProfileRef(value: unknown): boolean {
  return value === FORMAL_POOL_2197_CACHE_PARITY_PROFILE_REF || value === FORMAL_POOL_2197_LEGACY_CACHE_PARITY_PROFILE_REF
}
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
  'client_family_bucket',
  'local_env_residue_present',
  'date_format_bucket',
  'apostrophe_bucket',
  'base_url_category_bucket',
  'proxy_env_bucket',
  'mcp_configured_absent_diff_bucket',
  'mcp_shape_bucket',
  'mcp_server_count_bucket',
  'mcp_toolset_count_bucket',
  'mcp_auth_bucket',
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
  egress_tls_profile_ref?: unknown
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
  aws_access_key_id?: unknown
  aws_secret_access_key?: unknown
  aws_session_token?: unknown
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
  egress_tls_profile_ref?: string
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
  upstream_auth_scheme?: 'x_api_key' | 'bearer_api_key' | 'sigv4'
  beta_policy_ref?: string
  request_shape_profile_ref?: string
  cache_parity_profile_ref?: string
  anthropic_workspace_id?: string
  aws_access_key_id?: string
  aws_secret_access_key?: string
  aws_session_token?: string
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
  egress_tls_profile_ref?: string
  env_residue_profile_ref: string
  locale_profile_ref: string
  base_url_residue_profile_ref: string
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
  upstream_auth_scheme?: 'x_api_key' | 'bearer_api_key' | 'sigv4'
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

function writeControlPlaneError(res: ServerResponse, status: number, code: string, message: string, rawCapture?: RawCaptureSink, evidence: Record<string, unknown> = {}) {
  const body = JSON.stringify({
    type: 'error',
    error: {
      type: 'cc_gateway_control_plane',
      code,
      message: redactSensitiveText(message),
    },
  })
  writeRawCaptureFile(rawCapture || { dir: null, captureRef: null, generated: false, fullRaw: false }, '00_control_plane_error.json', {
    status,
    code,
    kind: 'control_plane',
    ...evidence,
    taxonomy_summary: claudeCodeEnvResidueTaxonomySummary(),
    body_omitted_reason: 'control_plane_error_body_forbidden',
    raw_body_omitted_reason: 'control_plane_error_raw_body_forbidden',
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
  const egressTLSProfileRef = stringField(input.egress_tls_profile_ref)
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
  const tlsMode = tlsProfileMode((config as any).shared_pool)
  if (egressTLSProfileRef) {
    if (!isSafeTLSProfileRef(egressTLSProfileRef)) {
      return { status: 400, code: 'invalid_egress_tls_profile_ref', message: 'Runtime egress TLS profile ref must be a safe tls-profile ref' }
    }
    if (!isKnownEnabledTLSProfileRef(config as any, egressTLSProfileRef)) {
      return { status: 400, code: 'unknown_egress_tls_profile_ref', message: 'Runtime egress TLS profile ref must reference an enabled TLS profile' }
    }
  } else if (tlsMode.enabled && tlsMode.strict) {
    return { status: 400, code: 'missing_egress_tls_profile_ref', message: 'Strict TLS runtime registration requires an egress TLS profile ref' }
  }
  if (!policyVersion) return { status: 400, code: 'missing_policy_version', message: 'Runtime registration requires policy version' }
  if (!/^[a-f0-9]{64}$/i.test(deviceId)) return { status: 400, code: 'missing_device_id', message: 'Runtime registration requires account-owned 64-hex device_id' }
  if (sessionPolicy !== 'preserve_downstream_session_id') {
    return { status: 400, code: 'invalid_session_policy', message: 'Runtime registration session policy must be preserve_downstream_session_id until gateway_generated is implemented' }
  }
  const awsValidation = validateRuntimeClaudePlatformAWSFields(config, {
    provider_kind: providerKind,
    account_ref: accountRef,
    credential_ref: credentialRef,
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
    egress_bucket: egressBucket,
    proxy_identity_ref: proxyIdentityRef,
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
    ...(egressTLSProfileRef ? { egress_tls_profile_ref: egressTLSProfileRef } : {}),
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
      upstream_auth_scheme: upstreamAuthScheme as 'x_api_key' | 'bearer_api_key' | 'sigv4',
      beta_policy_ref: betaPolicyRef,
      request_shape_profile_ref: requestShapeProfileRef,
      cache_parity_profile_ref: cacheParityProfileRef,
      anthropic_workspace_id: anthropicWorkspaceId,
      ...claudePlatformAWSSigV4CredentialsFromInput(input, upstreamAuthScheme),
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
      ...(mapping.aws_access_key_id ? { aws_access_key_id: mapping.aws_access_key_id } : {}),
      ...(mapping.aws_secret_access_key ? { aws_secret_access_key: mapping.aws_secret_access_key } : {}),
      ...(mapping.aws_session_token ? { aws_session_token: mapping.aws_session_token } : {}),
    } : {}),
  }
  config.egress_buckets = config.egress_buckets || {}
  config.egress_buckets[mapping.egress_bucket] = {
    enabled: true,
    proxy_url: mapping.proxy_url,
    proxy_identity_ref: mapping.proxy_identity_ref,
    allowed_account_ids: [mapping.account_id],
    ...(mapping.egress_tls_profile_ref ? { tls_profile_ref: mapping.egress_tls_profile_ref } : {}),
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


function isClaudePlatformAWSAuthScheme(value: unknown): value is 'x_api_key' | 'bearer_api_key' | 'sigv4' {
  return value === 'x_api_key' || value === 'bearer_api_key' || value === 'sigv4'
}

function claudePlatformAWSSigV4Enabled(config: Config): boolean {
  return ((config as any).shared_pool || {}).claude_platform_aws_sigv4_enabled === true
}

function claudePlatformAWSSigV4CredentialsFromInput(input: RuntimeRegisterRequest, upstreamAuthScheme: string): Partial<RuntimeMappingRecord> {
  if (upstreamAuthScheme !== 'sigv4') return {}
  const accessKeyId = stringField(input.aws_access_key_id)
  const secretAccessKey = stringField(input.aws_secret_access_key)
  const sessionToken = stringField(input.aws_session_token)
  return {
    ...(accessKeyId ? { aws_access_key_id: accessKeyId } : {}),
    ...(secretAccessKey ? { aws_secret_access_key: secretAccessKey } : {}),
    ...(sessionToken ? { aws_session_token: sessionToken } : {}),
  }
}

function validateRuntimeClaudePlatformAWSFields(config: Config, input: Record<string, string>): { status: number; code: string; message: string } | null {
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
  if (!isClaudePlatformAWSAuthScheme(input.upstream_auth_scheme)) {
    return { status: 400, code: 'invalid_upstream_auth_scheme', message: 'Claude Platform on AWS runtime registration requires proven auth scheme' }
  }
  if (input.upstream_auth_scheme === 'bearer_api_key') {
    return { status: 403, code: 'claude_platform_aws_auth_profile_unproven', message: 'Claude Platform on AWS bearer auth scheme is not enabled without CP0 evidence' }
  }
  if (input.upstream_auth_scheme === 'sigv4' && !claudePlatformAWSSigV4Enabled(config)) {
    return { status: 403, code: 'claude_platform_aws_sigv4_profile_unproven', message: 'Claude Platform on AWS SigV4 profile is not enabled without CP7 evidence' }
  }
  if (input.upstream_auth_scheme === 'sigv4') {
    if (!stringField((input as any).aws_access_key_id) || !stringField((input as any).aws_secret_access_key)) {
      return { status: 400, code: 'missing_sigv4_credentials', message: 'Claude Platform on AWS SigV4 requires access key material in sensitive runtime storage' }
    }
  }
  if (input.beta_policy_ref !== CLAUDE_PLATFORM_AWS_BETA_POLICY_REF
    || input.request_shape_profile_ref !== CLAUDE_PLATFORM_AWS_REQUEST_SHAPE_PROFILE_REF
    || input.cache_parity_profile_ref !== CLAUDE_PLATFORM_AWS_CACHE_PARITY_PROFILE_REF) {
    return { status: 400, code: 'invalid_claude_platform_aws_profile', message: 'Claude Platform on AWS runtime registration requires provider-scoped profiles' }
  }
  if (!input.anthropic_workspace_id || /[\r\n]/.test(input.anthropic_workspace_id) || input.anthropic_workspace_id.length > 512) {
    return { status: 400, code: 'missing_anthropic_workspace_id', message: 'Claude Platform on AWS runtime registration requires workspace id in sensitive storage' }
  }
  const authority = verifyClaudePlatformAWSWorkspaceAuthority(config, {
    providerKind,
    accountRef: input.account_ref,
    credentialRef: input.credential_ref,
    workspaceRef: input.workspace_ref,
    workspaceBindingHmac: input.workspace_binding_hmac,
    endpointRef: input.upstream_endpoint_ref,
    region: input.aws_region,
    authScheme: input.upstream_auth_scheme,
    egressBucket: input.egress_bucket,
    proxyIdentityRef: input.proxy_identity_ref,
    rawWorkspaceId: input.anthropic_workspace_id,
  })
  if (!authority.ok) {
    return { status: 403, code: authority.code, message: 'Claude Platform on AWS workspace authority binding is invalid' }
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
        ...(existingIdentity.aws_access_key_id ? { aws_access_key_id: existingIdentity.aws_access_key_id } : {}),
        ...(existingIdentity.aws_secret_access_key ? { aws_secret_access_key: existingIdentity.aws_secret_access_key } : {}),
        ...(existingIdentity.aws_session_token ? { aws_session_token: existingIdentity.aws_session_token } : {}),
      } : {}),
    }
    const existingBucket = findExistingRuntimeBucketForAccount(config, mapping.account_id)
    if (!existingBucket) {
      return { status: 409, code: 'runtime_mapping_authority_exists', message: 'Runtime account authority mapping already exists' }
    }
    const existingAuthority = { ...existing, ...existingBucket }
    if (!sameRuntimeMappingAuthority(existingAuthority, mapping)
      && !sameRuntimeMappingAuthorityAllowingCredentialRotation(existingAuthority, mapping)
      && !sameRuntimeMappingAuthorityAllowingCanonicalPromotion(existingAuthority, mapping)
      && !sameRuntimeMappingAuthorityAllowingTLSProfileBackfill(existingAuthority, mapping)) {
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
): Pick<RuntimeMappingRecord, 'egress_bucket' | 'proxy_url' | 'proxy_identity_ref' | 'egress_tls_profile_ref'> | null {
  for (const [bucketId, bucket] of Object.entries(config.egress_buckets || {})) {
    if (bucket.allowed_account_ids?.includes(accountId)) {
      return {
        egress_bucket: bucketId,
        proxy_url: bucket.proxy_url,
        proxy_identity_ref: bucket.proxy_identity_ref || bucket.proxy_identity_hash || '',
        ...(bucket.tls_profile_ref ? { egress_tls_profile_ref: bucket.tls_profile_ref } : {}),
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
    if ((sameAccount || sameBucket)
      && !sameRuntimeMappingAuthority(existing, mapping)
      && !sameRuntimeMappingAuthorityAllowingCredentialRotation(existing, mapping)
      && !sameRuntimeMappingAuthorityAllowingCanonicalPromotion(existing, mapping)
      && !sameRuntimeMappingAuthorityAllowingTLSProfileBackfill(existing, mapping)) {
      return { status: 409, code: 'runtime_mapping_authority_exists', message: 'Runtime account authority mapping already exists' }
    }
  }
  return null
}

function sameRuntimeMappingAuthorityAllowingCredentialRotation(a: RuntimeMappingRecord, b: RuntimeMappingRecord): boolean {
  return a.account_id === b.account_id
    && a.account_ref === b.account_ref
    && a.account_uuid_ref === b.account_uuid_ref
    && (a.email_ref || '') === (b.email_ref || '')
    && a.token_type === b.token_type
    && a.egress_bucket === b.egress_bucket
    && a.proxy_url === b.proxy_url
    && a.proxy_identity_ref === b.proxy_identity_ref
    && (a.egress_tls_profile_ref || '') === (b.egress_tls_profile_ref || '')
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
    && (a.aws_access_key_id || '') === (b.aws_access_key_id || '')
    && (a.aws_secret_access_key || '') === (b.aws_secret_access_key || '')
    && (a.aws_session_token || '') === (b.aws_session_token || '')
}

function sameRuntimeMappingAuthorityAllowingCanonicalPromotion(a: RuntimeMappingRecord, b: RuntimeMappingRecord): boolean {
  if (!isAllowedRuntimeCanonicalPromotion(a, b)) return false
  return a.account_id === b.account_id
    && a.account_ref === b.account_ref
    && a.account_uuid_ref === b.account_uuid_ref
    && (a.email_ref || '') === (b.email_ref || '')
    && a.token_type === b.token_type
    && a.egress_bucket === b.egress_bucket
    && a.proxy_url === b.proxy_url
    && a.proxy_identity_ref === b.proxy_identity_ref
    && (a.egress_tls_profile_ref || '') === (b.egress_tls_profile_ref || '')
    && a.session_policy === b.session_policy
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
    && (a.aws_access_key_id || '') === (b.aws_access_key_id || '')
    && (a.aws_secret_access_key || '') === (b.aws_secret_access_key || '')
    && (a.aws_session_token || '') === (b.aws_session_token || '')
}

function isAllowedRuntimeCanonicalPromotion(a: RuntimeMappingRecord, b: RuntimeMappingRecord): boolean {
  if (b.policy_version !== '2.1.197' || b.persona_variant !== 'claude-code-2.1.197-macos-local') return false
  if (a.policy_version === '2.1.179' && a.persona_variant === 'claude-code-2.1.179-macos-local') return true
  if (a.policy_version === '2.1.185' && a.persona_variant === 'claude-code-2.1.185-macos-local') return true
  return false
}

function sameRuntimeMappingAuthorityAllowingTLSProfileBackfill(a: RuntimeMappingRecord, b: RuntimeMappingRecord): boolean {
  if (a.egress_tls_profile_ref || !b.egress_tls_profile_ref) return false
  return sameRuntimeMappingAuthority({ ...a, egress_tls_profile_ref: b.egress_tls_profile_ref }, b)
    || sameRuntimeMappingAuthorityAllowingCredentialRotation({ ...a, egress_tls_profile_ref: b.egress_tls_profile_ref }, b)
    || sameRuntimeMappingAuthorityAllowingCanonicalPromotion({ ...a, egress_tls_profile_ref: b.egress_tls_profile_ref }, b)
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
    && (a.egress_tls_profile_ref || '') === (b.egress_tls_profile_ref || '')
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
    && (a.aws_access_key_id || '') === (b.aws_access_key_id || '')
    && (a.aws_secret_access_key || '') === (b.aws_secret_access_key || '')
    && (a.aws_session_token || '') === (b.aws_session_token || '')
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
    && isClaudePlatformAWSAuthScheme(record.upstream_auth_scheme)
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
    && isClaudePlatformAWSAuthScheme(record.upstream_auth_scheme)
    && typeof record.beta_policy_ref === 'string'
    && typeof record.request_shape_profile_ref === 'string'
    && typeof record.cache_parity_profile_ref === 'string'
    && typeof record.anthropic_workspace_id === 'string'
    && (record.upstream_auth_scheme !== 'sigv4' || (typeof record.aws_access_key_id === 'string' && typeof record.aws_secret_access_key === 'string' && (record.aws_session_token === undefined || typeof record.aws_session_token === 'string')))
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


function mockMessagesResponseBridgeRequested(config: Config): boolean {
  return (config as any).egress_tls_sidecar?.mock_messages_response?.enabled === true
}

function mockMessagesResponseBridgeSafety(config: Config): { ok: true } | { ok: false } {
  const sidecar = (config as any).egress_tls_sidecar || {}
  const mock = sidecar.mock_messages_response || {}
  if (mock.enabled !== true) return { ok: true }
  if (sidecar.enabled !== true) return { ok: false }
  const sharedPool = ((config as any).shared_pool || {}) as Record<string, unknown>
  const upstreamMode = String(sharedPool.upstream_mode || '')
  const productionLike = upstreamMode === 'production'
    || upstreamMode === 'real-canary'
    || sharedPool.production_upstream_enabled === true
    || sharedPool.real_canary_user_approved === true
  if (config.mode !== 'sub2api' || mock.mode !== 'local_smoke' || productionLike || !['local-capture', 'preflight'].includes(upstreamMode)) {
    return { ok: false }
  }
  if (sidecar.logical_target_host !== 'api.anthropic.com') return { ok: false }
  if (!isLocalMockBridgeLoopbackUrl(config.upstream?.url)) return { ok: false }
  if (!isLocalMockBridgeLoopbackUrl(sidecar.endpoint)) return { ok: false }
  return { ok: true }
}

function mockMessagesResponseBridgeEnabled(config: Config): boolean {
  return mockMessagesResponseBridgeSafety(config).ok
    && (config as any).egress_tls_sidecar?.mock_messages_response?.enabled === true
}

function isLocalMockBridgeLoopbackUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (parsed.username || parsed.password) return false
  const host = parsed.hostname.toLowerCase()
  return host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === 'localhost'
}

function localSmokeMockMessagesResponseBody(personaDecision: ReturnType<typeof resolveSharedPoolPersonaDecision> | null, parsedBody: unknown): Buffer {
  const requestedModel = parsedBody && typeof (parsedBody as any).model === 'string'
    ? String((parsedBody as any).model)
    : ''
  const model = requestedModel || 'claude-sonnet-4-6'
  void personaDecision
  return Buffer.from(JSON.stringify({
    id: 'msg_local_smoke_mock',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: 'synthetic local smoke response' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  }), 'utf-8')
}

function appendMCPConnectorBeta(betaHeader: string | undefined): string {
  const existing = String(betaHeader || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const withoutMCP = existing.filter((part) => part !== FORMAL_POOL_MCP_BETA)
  return [...withoutMCP, FORMAL_POOL_MCP_BETA].join(',')
}

function applyMCPConnectorEvidenceHeaders(headers: Record<string, any>, evidence: FormalPoolMCPConnectorEvidence): Record<string, any> {
  headers['x-cc-mcp-connector-decision-bucket'] = evidence.decisionBucket
  headers['x-cc-mcp-server-count-bucket'] = evidence.serverCountBucket
  headers['x-cc-mcp-auth-bucket'] = evidence.authBucket
  return headers
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
  egress_tls_profile_ref?: string
  env_residue_profile_ref: string
  locale_profile_ref: string
  base_url_residue_profile_ref: string
  profile_policy_version: string
  billing_shape_policy: FormalPoolBillingShapePolicy
  request_shape_profile_ref: string
  cache_parity_profile_ref: string
  mcp_connector_policy_ref?: string
  observed_client_profile: Record<string, unknown>
  session_id: string
  timestamp_ms: number
  nonce: string
  credential_binding_hmac?: string
  provider_kind?: 'anthropic_first_party' | 'claude_platform_aws'
  upstream_auth_scheme?: 'x_api_key' | 'bearer_api_key' | 'sigv4'
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
  const writeRequestControlPlaneError = (status: number, code: string, message: string, evidence: Record<string, unknown> = {}) => {
    writeControlPlaneError(res, status, code, message, rawCapture, {
      method,
      route: target.pathname,
      query_keys: safeQueryKeys(target.search),
      header_names: safeHeaderNames(req.headers as Record<string, string | string[] | undefined>),
      ...evidence,
    })
  }
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
      writeRequestControlPlaneError(403, 'missing_internal_control_attestation', 'Runtime account registration requires internal control attestation')
      return
    }
    await handleRuntimeRegister(req, res, config, method)
    return
  }

  if (mockMessagesResponseBridgeRequested(config)) {
    const mockBridgeSafety = mockMessagesResponseBridgeSafety(config)
    if (!mockBridgeSafety.ok) {
      writeRequestControlPlaneError(403, 'egress_tls_mock_response_bridge_unsafe', 'TLS sidecar mock response bridge is local-smoke only')
      return
    }
  }

  if (config.mode === 'sub2api') {
    const upstreamSafety = evaluateUpstreamSafety(config, method, target.pathname)
    if (!upstreamSafety.ok && upstreamSafety.code !== 'real_aws_claude_platform_requires_post_attestation') {
      writeRequestControlPlaneError(upstreamSafety.status, upstreamSafety.code, 'Upstream is not allowed for this CC Gateway preflight/canary mode')
      return
    }
    if (hasEnvResidueQuery(target.search)) {
      writeRequestControlPlaneError(400, 'formal_pool_env_residue_verifier_failed', 'Formal-pool env residue verifier failed')
      return
    }
    for (const [key, value] of Object.entries(req.headers)) {
      const joined = Array.isArray(value) ? value.join(', ') : String(value || '')
      if (isEnvResidueStructuralKey(key) || containsEnvResidueLiteral(joined)) {
        writeRequestControlPlaneError(400, 'formal_pool_env_residue_verifier_failed', 'Formal-pool env residue verifier failed')
        return
      }
    }
  }

  // Authenticate client (proxy-level auth)
  const clientName = authenticateForMode(req, config)
  if (!clientName) {
    if (config.mode === 'sub2api') {
      writeRequestControlPlaneError(401, 'missing_gateway_token', 'Unauthorized - provide gateway token via x-cc-gateway-token header')
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
    writeRequestControlPlaneError(403, 'billing_cch_mode_disabled', 'Shared-pool billing/CCH mode is disabled')
    return
  }
  let billingMode: FormalPoolBillingMode | 'disabled' | string = configuredBillingMode
  const trustedInternalControl = isTrustedInternalControl(req, config)
  if (config.mode === 'sub2api' && hasProtectedInternalControlInput(req) && !trustedInternalControl) {
    writeRequestControlPlaneError(403, 'missing_internal_control_attestation', 'Internal Sub2API control headers require internal control attestation')
    return
  }
  const trustedPersonaClient = isTrustedPersonaClient(req, trustedInternalControl)
  const requestedContext1M = readTrustedContext1MRequest(req, clientName, trustedInternalControl)
  const healthcheckPersonaProfile = readTrustedHealthcheckPersonaProfile(req, clientName, trustedInternalControl)
  if (healthcheckPersonaProfile && !isSupportedHealthcheckPersonaForPolicy(healthcheckPersonaProfile, readHeader(req, 'x-cc-policy-version') || String(config.env.version || ''))) {
    writeRequestControlPlaneError(403, 'unsupported_healthcheck_persona', 'Unsupported internal healthcheck persona profile')
    return
  }

  let accountContext: AccountContext | null = null
  let accountIdentity: AccountIdentityRecord | null = null
  let egress: EgressBucketResolution | null = null
  let personaDecision: ReturnType<typeof resolveSharedPoolPersonaDecision> | null = null
  let oauthToken: string | null = null
  let routePolicy: ReturnType<typeof selectSharedPoolRoute> | null = null
  let formalPoolAttestation: AttestedFormalPoolContext | null = null
  let egressTLSProfileStatus: 'verified' | 'tls_profile_unverified' | null = null
  const sharedPoolRoute: SharedPoolPersonaRoute = target.pathname === '/v1/messages/count_tokens' ? 'count_tokens' : (target.pathname === '/v1/models' ? 'control_plane' : 'messages')

  if (config.mode === 'sub2api') {
    routePolicy = selectSharedPoolRoute(method, target.pathname, target.search)
    if (routePolicy.action === 'block') {
      const awsRoutePolicy = maybeAllowClaudePlatformAWSMessagesRoute(req, config, method, target, routePolicy)
      if ('status' in awsRoutePolicy) {
        writeRequestControlPlaneError(awsRoutePolicy.status, awsRoutePolicy.code, 'Formal-pool scheduler context attestation is required')
        return
      }
      routePolicy = awsRoutePolicy.routePolicy
    }
    if (routePolicy.action === 'block' && routePolicy.code !== 'formal_pool_count_tokens_profile_unapproved' && routePolicy.code !== 'formal_pool_control_plane_unapproved') {
      writeRequestControlPlaneError(routePolicy.status, routePolicy.code, `Unsupported route: ${safePath}`)
      return
    }

    const parsed = parseAccountContext(req, config)
    if ('error' in parsed) {
      writeRequestControlPlaneError(parsed.status, parsed.code, parsed.error)
      return
    }
    accountContext = parsed.context

    if (formalPoolAttestationRequired(config)) {
      const attestation = parseFormalPoolContext(req, config)
      if (!attestation.ok) {
        writeRequestControlPlaneError(attestation.status, attestation.code, 'Formal-pool scheduler context attestation is required')
        return
      }
      formalPoolAttestation = attestation.context
      if (isConfiguredClaudePlatformAWSUpstream(upstream) && formalPoolAttestation.provider_kind !== CLAUDE_PLATFORM_AWS_PROVIDER_KIND) {
        writeRequestControlPlaneError(403, 'real_aws_claude_platform_provider_mismatch', 'AWS Claude Platform upstream requires Claude Platform on AWS provider attestation')
        return
      }
      if (formalPoolAttestation.provider_kind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND && target.search !== '') {
        writeRequestControlPlaneError(404, 'unsupported_route', 'Claude Platform on AWS phase 1 allows /v1/messages without internal query markers only')
        return
      }
      if (routePolicy.action === 'block') {
        writeRequestControlPlaneError(routePolicy.status, routePolicy.code, `Unsupported formal-pool control-plane route: ${safePath}`)
        return
      }
      const headerCheck = verifyFormalPoolAttestedHeaders(config, req, method, target, routePolicy, accountContext, formalPoolAttestation)
      if (!headerCheck.ok) {
        const plan76ModelError = plan76ModelVersionUnsupportedFromContext(formalPoolAttestation)
        writeRequestControlPlaneError(headerCheck.status, plan76ModelError || headerCheck.code, 'Formal-pool scheduler context does not match selected request context')
        return
      }
      const profileCheck = verifyFormalPoolAttestedProfiles(config, formalPoolAttestation)
      if (!profileCheck.ok) {
        writeRequestControlPlaneError(profileCheck.status, profileCheck.code, profileCheck.message)
        return
      }
      billingMode = formalPoolBillingModeFromAttestation(formalPoolAttestation)
    }

    accountIdentity = resolveAccountIdentity(config, accountContext.accountId)
    if (!accountIdentity) {
      writeRequestControlPlaneError(403, 'missing_account_identity', 'Missing per-account identity for selected upstream account')
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
        const plan76ModelError = plan76ModelVersionUnsupportedFromIdentity(formalPoolAttestation, selectedIdentity)
        writeRequestControlPlaneError(identityCheck.status, plan76ModelError || identityCheck.code, 'Formal-pool scheduler context does not match selected account identity')
        return
      }
      const credentialBindingCheck = verifySelectedCredentialBinding(req, config, accountContext, selectedIdentity, formalPoolAttestation.credential_ref, formalPoolAttestation.credential_binding_hmac)
      if (!credentialBindingCheck.ok) {
        writeRequestControlPlaneError(credentialBindingCheck.status, credentialBindingCheck.code, 'Selected upstream credential does not match selected account identity')
        return
      }
      const personaCheck = verifyFormalPoolAttestedPersona(formalPoolAttestation, selectedIdentity.persona_variant)
      if (!personaCheck.ok) {
        writeRequestControlPlaneError(personaCheck.status, personaCheck.code, 'Formal-pool scheduler context does not match selected persona profile')
        return
      }
    }

    const resolvedEgress = resolveEgressBucket(config, accountContext.egressBucket, accountContext.accountId)
    if ('error' in resolvedEgress) {
      writeRequestControlPlaneError(403, resolvedEgress.error, 'Egress bucket is not eligible for the selected upstream account')
      return
    }
    egress = resolvedEgress
    if (formalPoolAttestation) {
      const egressCheck = verifyFormalPoolAttestedHeaders(config, req, method, target, routePolicy, accountContext, formalPoolAttestation, egress)
      if (!egressCheck.ok) {
        writeRequestControlPlaneError(egressCheck.status, egressCheck.code, 'Formal-pool scheduler context does not match selected egress context')
        return
      }
      const tlsMode = tlsProfileMode((config as any).shared_pool)
      if (tlsMode.enabled) {
        egressTLSProfileStatus = 'tls_profile_unverified'
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
    writeRequestControlPlaneError(413, 'body_too_large', 'Shared-pool request body exceeds configured cap')
    return
  }
  let body = bodyResult.body
  let rawSigningOutputBody = ''
  let rawCCH: string | null = null
  let rawVerifierResult: unknown = null
  let finalVerifierOptions: FinalOutputVerifierOptions | null = null
  let mcpConnectorEvidence = absentMCPConnectorEvidence()
  let envResidueSanitizerSummary = emptyFormalPoolEnvResidueSanitizerSummary()

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
      writeRequestControlPlaneError(controlPlaneCheck.status, controlPlaneCheck.code, controlPlaneCheck.message)
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
    writeRequestControlPlaneError(400, 'session_binding_failed', 'Unable to bind X-Claude-Code-Session-Id to metadata.user_id')
    return
  }
  if (config.mode === 'sub2api' && formalPoolAttestation) {
    const sessionCheck = verifyFormalPoolAttestedSession(config, runtimeState, formalPoolAttestation, sessionId)
    if (!sessionCheck.ok) {
      writeRequestControlPlaneError(sessionCheck.status, sessionCheck.code, 'Formal-pool scheduler context does not match canonical session')
      return
    }
  }
  if (parsedBody && body.length > 0) {
    body = Buffer.from(JSON.stringify(parsedBody), 'utf-8')
  }

  if (config.mode === 'sub2api' && formalPoolAttestation) {
    const plan76 = verifyPlan76FormalPoolBodyPolicy(config, target.pathname, parsedBody, formalPoolAttestation)
    mcpConnectorEvidence = plan76.mcp || absentMCPConnectorEvidence()
    if (!plan76.ok) {
      writeRequestControlPlaneError(plan76.status, plan76.code, plan76.message)
      return
    }
  }

  if (config.mode === 'sub2api') {
    if (billingMode === 'sign' && formalPoolRequestUsesPolicyVersion('2.1.177', config, accountContext, accountIdentity, formalPoolAttestation)) {
      if (!isSignPrimaryAllowedForVersion('2.1.177', config)) {
        writeRequestControlPlaneError(403, 'sign_primary_2177_oracle_missing', 'Manual signing mode is disabled or signer verification failed')
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
      writeRequestControlPlaneError(403, code, 'Persona policy rejected request')
      return
    }
    if (formalPoolAttestation) {
      const personaCheck = verifyFormalPoolAttestedPersona(formalPoolAttestation, accountIdentity?.persona_variant, personaDecision.profile.id, personaDecision.profile.messageBetaProfile)
      if (!personaCheck.ok) {
        writeRequestControlPlaneError(personaCheck.status, personaCheck.code, 'Formal-pool scheduler context does not match effective persona profile')
        return
      }
      const existingAuthorityCheck = verifyExistingFormalPoolSessionAuthorityBinding(config, runtimeState, formalPoolAttestation, accountIdentity!)
      if (!existingAuthorityCheck.ok) {
        writeRequestControlPlaneError(existingAuthorityCheck.status, existingAuthorityCheck.code, existingAuthorityCheck.message)
        return
      }
      const envResidueCheck = verifyFormalPoolEnvResidueProfiles(config, formalPoolAttestation)
      if (!envResidueCheck.ok) {
        writeRequestControlPlaneError(envResidueCheck.status, envResidueCheck.code, envResidueCheck.message)
        return
      }
      const sessionAuthorityCheck = verifyFormalPoolSessionAuthorityBinding(config, runtimeState, formalPoolAttestation, accountIdentity!)
      if (!sessionAuthorityCheck.ok) {
        writeRequestControlPlaneError(sessionAuthorityCheck.status, sessionAuthorityCheck.code, sessionAuthorityCheck.message)
        return
      }
    }
  }

  if (config.mode === 'sub2api') {
    const canaryCostEnvelope = evaluateCanaryCostEnvelope(config, body)
    if (!canaryCostEnvelope.ok) {
      writeRequestControlPlaneError(canaryCostEnvelope.status, canaryCostEnvelope.code, 'Canary request exceeds the configured cost envelope')
      return
    }
  }

  if (config.mode === 'sub2api') {
    const retryContract = verifyRetryFinalOutputContract(req, billingMode)
    if (!retryContract.ok) {
      writeRequestControlPlaneError(retryContract.status, retryContract.code, retryContract.message)
      return
    }
  }

  if (config.mode === 'sub2api' && billingMode === 'disabled') {
    writeRequestControlPlaneError(403, 'billing_cch_mode_disabled', 'Shared-pool billing/CCH mode is disabled')
    return
  }
  if (config.mode === 'sub2api' && !['strip', 'no_cch', 'sign'].includes(String(billingMode))) {
    writeRequestControlPlaneError(403, 'unsupported_billing_cch_mode', 'Unsupported shared-pool billing/CCH mode')
    return
  }
  if (config.mode === 'sub2api' && formalPoolAttestation) {
    const envRewrite = canonicalizeFormalPoolEnvResidueBody(body)
    if (!envRewrite.ok) {
      envResidueSanitizerSummary = envRewrite.summary
      writeRequestControlPlaneError(400, 'formal_pool_env_residue_verifier_failed', 'Formal-pool env residue verifier failed')
      return
    }
    envResidueSanitizerSummary = envRewrite.summary
    body = envRewrite.body
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
  if (config.mode === 'sub2api' && mcpConnectorEvidence.decisionBucket === 'official_url_connector_allowed') {
    rewrittenHeaders['anthropic-beta'] = appendMCPConnectorBeta(rewrittenHeaders['anthropic-beta'])
  }

  const signingInputBody = body.toString('utf-8')
  if (config.mode === 'sub2api' && billingMode === 'no_cch') {
    const noCch = runNoCchBillingPipeline(body, personaDecision?.effectiveVersion || String(config.env.version))
    if (!noCch.ok) {
      writeRequestControlPlaneError(400, noCch.code, 'Shared-pool no-CCH verifier failed')
      return
    }
    body = noCch.body
  }
  if (config.mode === 'sub2api' && billingMode === 'sign') {
    const signing = runSigningPipeline(config, body, {
      cliVersion: personaDecision?.effectiveVersion || String(config.env.version),
    })
    if (!signing.ok) {
      writeRequestControlPlaneError(403, signing.code, 'Manual signing mode is disabled or signer verification failed')
      return
    }
    body = signing.body
    rawSigningOutputBody = body.toString('utf-8')
    rawCCH = signing.cch
    finalVerifierOptions = {
      route: sharedPoolRoute,
      sessionId,
      accountIdentity: accountIdentity ?? undefined,
      expectedVersion: personaDecision?.effectiveVersion,
      expectedBeta: personaDecision?.betaHeader,
      billingMode: 'sign',
      requestShapeProfileRef: formalPoolAttestation?.request_shape_profile_ref,
      cacheParityProfileRef: formalPoolAttestation?.cache_parity_profile_ref,
      attestation: formalPoolAttestation ?? undefined,
    }
    if (mcpConnectorEvidence.decisionBucket === 'official_url_connector_allowed') {
      finalVerifierOptions.expectedBeta = appendMCPConnectorBeta(finalVerifierOptions.expectedBeta)
    }
  } else if (config.mode === 'sub2api') {
    finalVerifierOptions = {
      route: sharedPoolRoute,
      sessionId,
      accountIdentity: accountIdentity ?? undefined,
      expectedVersion: personaDecision?.effectiveVersion,
      expectedBeta: personaDecision?.betaHeader,
      billingMode: billingMode === 'no_cch' ? 'no_cch' : 'strip',
      requestShapeProfileRef: formalPoolAttestation?.request_shape_profile_ref,
      cacheParityProfileRef: formalPoolAttestation?.cache_parity_profile_ref,
      attestation: formalPoolAttestation ?? undefined,
    }
    if (mcpConnectorEvidence.decisionBucket === 'official_url_connector_allowed') {
      finalVerifierOptions.expectedBeta = appendMCPConnectorBeta(finalVerifierOptions.expectedBeta)
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

  const forwardHeaders = {
    ...rewrittenHeaders,
    host: formalPoolAttestation?.provider_kind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND && formalPoolAttestation.upstream_host
      ? formalPoolAttestation.upstream_host
      : upstream.host,
    'content-length': String(body.length),
  }
  if (formalPoolAttestation?.provider_kind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND && formalPoolAttestation.upstream_auth_scheme === 'sigv4') {
    const signed = signClaudePlatformAWSFinalRequest(config, upstreamUrl, forwardHeaders, body, formalPoolAttestation, accountIdentity ?? undefined)
    if (!signed.ok) {
      writeRequestControlPlaneError(403, signed.code, 'Claude Platform on AWS SigV4 signing failed')
      return
    }
  }
  if (config.mode === 'sub2api' && finalVerifierOptions) {
    const envResidueVerifier = verifyCanonicalFormalPoolEnvResidueFinalRequest(upstreamUrl, forwardHeaders, body)
    if (!envResidueVerifier.ok) {
      writeRequestControlPlaneError(400, envResidueVerifier.code, 'Formal-pool env residue verifier failed')
      return
    }
    const verifier = verifyProviderAwareFinalRequest(config, upstreamUrl, forwardHeaders, body, finalVerifierOptions, accountIdentity ?? undefined, egress ?? undefined)
    rawVerifierResult = verifier
    if (!verifier.ok) {
      if (formalPoolAttestation?.provider_kind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND) {
        writeRequestControlPlaneError(403, verifier.code, 'Claude Platform on AWS final verifier failed')
        return
      }
      writeRequestControlPlaneError(400, verifier.code, 'Shared-pool final-output verifier failed')
      return
    }
  }
  const useTLSSidecar = config.mode === 'sub2api' && egressSidecarEnabled(config as any)
  const activeTLSMode = tlsProfileMode((config as any).shared_pool)
  if (config.mode === 'sub2api' && formalPoolAttestation && activeTLSMode.enabled && activeTLSMode.strict && !useTLSSidecar) {
    writeRequestControlPlaneError(403, 'egress_tls_sidecar_disabled', 'Strict formal-pool TLS egress requires the TLS sidecar')
    return
  }
  const agentKey = config.mode === 'sub2api' && accountContext && egress
    ? proxyAgentCacheKey(accountContext, upstream, egress)
    : 'default'
  const agent = useTLSSidecar
    ? null
    : (config.mode === 'sub2api' && egress
      ? getProxyAgent(agentKey, egress.proxyUrl)
      : getProxyAgent(agentKey))
  if (config.mode === 'sub2api' && !useTLSSidecar && !agent) {
    writeRequestControlPlaneError(403, 'missing_egress_proxy', 'Configured egress proxy is unavailable')
    return
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
    env_residue_sanitizer: envResidueSanitizerSummary,
    taxonomy_summary: claudeCodeEnvResidueTaxonomySummary(),
    mcp_connector_decision_bucket: mcpConnectorEvidence.decisionBucket,
  }
  if (rawCapture.fullRaw) {
    finalOutputCapturePayload.raw_capture_scope = 'safe_summary_only_full_raw_disabled_by_policy'
    finalOutputCapturePayload.raw_body_omitted_reason = 'full_raw_capture_must_not_persist_final_body'
  }
  writeRawCaptureFile(rawCapture, '03_final_output.json', finalOutputCapturePayload)

  if (useTLSSidecar) {
    const profileRef = formalPoolAttestation?.egress_tls_profile_ref
    const prepared = prepareEgressSidecarRequest({
      config: config as any,
      profileRef,
      egressBucket: egress?.bucketId,
      proxyIdentityRef: egress?.proxyIdentityRef,
      proxyUrl: egress?.proxyUrl,
      targetHost: egressSidecarTargetHost(config as any, upstreamUrl.hostname),
      targetPort: 443,
      targetScheme: 'https',
      targetPath: upstreamUrl.pathname,
      route: target.pathname,
      method,
    })
    if (!prepared.ok) {
      writeRequestControlPlaneError(prepared.status, prepared.code, prepared.message)
      return
    }
    if (mockMessagesResponseBridgeEnabled(config)) {
      const sidecarResult = await callEgressSidecar(prepared.prepared, body, forwardHeaders)
      if (!sidecarResult.ok) {
        writeRequestControlPlaneError(sidecarResult.status, sidecarResult.code, sidecarResult.message)
        return
      }
      const responseBody = localSmokeMockMessagesResponseBody(personaDecision, parsedBody)
      let responseHeaders: Record<string, string | string[] | undefined> = {
        ...sidecarResult.response.headers,
        'content-type': 'application/json',
        'content-length': String(responseBody.length),
        'x-cc-mock-response-schema-bucket': 'anthropic-messages:synthetic-local-smoke-v1',
      }
      delete responseHeaders['transfer-encoding']
      responseHeaders['x-cc-egress-tls-profile-status'] = 'tls_profile_unverified'
      responseHeaders = applyMCPConnectorEvidenceHeaders(responseHeaders, mcpConnectorEvidence)
      responseHeaders = applyGatewayEvidenceHeaders(responseHeaders, rawCapture)
      if (rawCapture.dir) writeRawCaptureFile(rawCapture, '02_upstream_response.json', rawResponseCapturePayload(sidecarResult.response.status, responseHeaders, responseBody, rawCapture))
      res.writeHead(sidecarResult.response.status, responseHeaders)
      res.end(responseBody)
      if (config.logging.audit) audit(clientName, method, safePath, sidecarResult.response.status)
      return
    }
    const sidecarResult = await openEgressSidecar(prepared.prepared, body, forwardHeaders)
    if (!sidecarResult.ok) {
      writeRequestControlPlaneError(sidecarResult.status, sidecarResult.code, sidecarResult.message)
      return
    }
    const status = sidecarResult.response.status
    let responseHeaders: Record<string, string | string[] | undefined> = { ...sidecarResult.response.headers }
    delete responseHeaders['transfer-encoding']
    responseHeaders['x-cc-egress-tls-profile-status'] = 'tls_profile_unverified'
    responseHeaders = applyMCPConnectorEvidenceHeaders(responseHeaders, mcpConnectorEvidence)
    responseHeaders = applyGatewayEvidenceHeaders(responseHeaders, rawCapture)
    if (rawCapture.dir) {
      const chunks: Buffer[] = []
      res.writeHead(status, responseHeaders)
      sidecarResult.response.stream.on('data', (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        chunks.push(buffer)
        if (!res.destroyed && !res.write(buffer)) {
          sidecarResult.response.stream.pause()
        }
      })
      res.on('drain', () => {
        sidecarResult.response.stream.resume()
      })
      sidecarResult.response.stream.on('end', () => {
        const responseBody = Buffer.concat(chunks)
        writeRawCaptureFile(rawCapture, '02_upstream_response.json', rawResponseCapturePayload(status, responseHeaders, responseBody, rawCapture))
        if (!res.destroyed) res.end()
        if (config.logging.audit) audit(clientName, method, safePath, status)
      })
      sidecarResult.response.stream.on('error', () => {
        if (!res.destroyed) res.destroy()
      })
    } else {
      res.writeHead(status, responseHeaders)
      sidecarResult.response.stream.pipe(res)
      if (config.logging.audit) audit(clientName, method, safePath, status)
    }
    return
  }

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
      if (egressTLSProfileStatus === 'tls_profile_unverified') responseHeaders['x-cc-egress-tls-profile-status'] = 'tls_profile_unverified'
      delete responseHeaders['transfer-encoding']
      responseHeaders = applyMCPConnectorEvidenceHeaders(responseHeaders, mcpConnectorEvidence)
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
        writeRequestControlPlaneError(502, 'egress_proxy_failure', 'Configured egress proxy failed before upstream response')
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

type FormalPoolEnvResidueSanitizerSummary = {
  changed: boolean
  removed_field_count: number
  removed_field_count_bucket: string
  residue_bucket: string
  taxonomy: ReturnType<typeof claudeCodeEnvResidueTaxonomySummary>
}

function emptyFormalPoolEnvResidueSanitizerSummary(): FormalPoolEnvResidueSanitizerSummary {
  return {
    changed: false,
    removed_field_count: 0,
    removed_field_count_bucket: '0',
    residue_bucket: 'not_observed',
    taxonomy: claudeCodeEnvResidueTaxonomySummary(),
  }
}

function canonicalClaudeCodeDateMarker(now = new Date(), timezone = 'America/Los_Angeles'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const year = parts.find((part) => part.type === 'year')?.value || '0000'
  const month = parts.find((part) => part.type === 'month')?.value || '00'
  const day = parts.find((part) => part.type === 'day')?.value || '00'
  return `Today's date is ${year}-${month}-${day}.`
}

function canonicalizeFormalPoolEnvResidueBody(body: Buffer): { ok: true; body: Buffer; summary: FormalPoolEnvResidueSanitizerSummary } | { ok: false; summary: FormalPoolEnvResidueSanitizerSummary } {
  const summary = emptyFormalPoolEnvResidueSanitizerSummary()
  if (!body.length) return { ok: true, body, summary }
  let parsed: any
  try {
    parsed = JSON.parse(body.toString('utf-8'))
  } catch {
    return { ok: true, body, summary }
  }
  const result = canonicalizeSystemEnvResidue(parsed)
  if (!result.ok) return { ok: false, summary }
  const sanitizer = sanitizeStructuralEnvResidueFields(parsed)
  const nextSummary: FormalPoolEnvResidueSanitizerSummary = {
    ...summary,
    changed: sanitizer.removedCount > 0,
    removed_field_count: sanitizer.removedCount,
    removed_field_count_bucket: residueCountBucket(sanitizer.removedCount),
    residue_bucket: sanitizer.bucket,
  }
  return { ok: true, body: Buffer.from(JSON.stringify(parsed), 'utf-8'), summary: nextSummary }
}

function canonicalizeSystemEnvResidue(parsed: any): { ok: true } | { ok: false } {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.system === undefined) return { ok: true }
  const canonical = canonicalClaudeCodeDateMarker()
  const seenMarkers: string[] = []
  const rewriteText = (text: string, standaloneBlock: boolean): { ok: true; text: string } | { ok: false } => {
    if (containsEnvResidueLiteral(text)) return { ok: false }
    const exact = text.match(/^Today(['\u2019\u2018\u02bc\u02b9])s date is (\d{4})([-/])(\d{2})\3(\d{2})\.$/)
    if (exact) {
      seenMarkers.push(text)
      return { ok: true, text: canonical }
    }
    if (/Today['\u2019\u2018\u02bc\u02b9]s date is/i.test(text)) return { ok: false }
    if (!standaloneBlock && /date is/i.test(text) && /today/i.test(text)) return { ok: false }
    return { ok: true, text }
  }
  if (typeof parsed.system === 'string') {
    const rewritten = rewriteText(parsed.system, true)
    if (!rewritten.ok) return { ok: false }
    parsed.system = rewritten.text
  } else if (Array.isArray(parsed.system)) {
    for (const item of parsed.system) {
      if (typeof item === 'string') {
        const rewritten = rewriteText(item, true)
        if (!rewritten.ok) return { ok: false }
        const index = parsed.system.indexOf(item)
        if (index >= 0) parsed.system[index] = rewritten.text
      } else if (item && typeof item === 'object' && !Array.isArray(item)) {
        const record = item as Record<string, unknown>
        if ((record.type === undefined || record.type === 'text') && typeof record.text === 'string') {
          const rewritten = rewriteText(record.text, true)
          if (!rewritten.ok) return { ok: false }
          record.text = rewritten.text
        }
      }
    }
  } else {
    return { ok: true }
  }
  if (new Set(seenMarkers).size > 1) return { ok: false }
  return { ok: true }
}

function containsEnvResidueLiteral(text: string): boolean {
  return /\b(ANTHROPIC_BASE_URL|BASE_URL|PROXY_URL|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|TZ=)\b/i.test(text)
}

function sanitizeStructuralEnvResidueFields(value: unknown): { removedCount: number; bucket: string } {
  let removedCount = 0
  let bucket = 'not_observed'
  const observe = (candidate: unknown) => {
    const classified = classifyClaudeCodeEnvResidue(candidate)
    bucket = combineEnvResidueBuckets(bucket, classified.bucket)
  }
  const walk = (node: unknown, path: string[]): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index++) walk(node[index], [...path, String(index)])
      return
    }
    const record = node as Record<string, unknown>
    for (const [key, child] of Object.entries(record)) {
      const childPath = [...path, key]
      if (isMessagesContentPath(childPath)) continue
      if (isEnvResidueStructuralKey(key) || (typeof child === 'string' && containsEnvResidueLiteral(child))) {
        if (shouldSanitizeEnvResidueField(childPath)) {
          observe(child)
          delete record[key]
          removedCount++
          continue
        }
      }
      walk(child, childPath)
    }
  }
  walk(value, [])
  return { removedCount, bucket }
}

function shouldSanitizeEnvResidueField(path: string[]): boolean {
  const top = path[0]
  if (top === 'tools' || top === 'mcp_servers') return false
  return !isMessagesContentPath(path)
}

function isMessagesContentPath(path: string[]): boolean {
  return path[0] === 'messages' && path.includes('content')
}

function residueCountBucket(count: number): string {
  if (count <= 0) return '0'
  if (count === 1) return '1'
  if (count <= 5) return '2_5'
  return '6_plus'
}

function combineEnvResidueBuckets(current: string, next: string): string {
  const priority = ['not_observed', 'unknown', 'china_tld', 'china_org_domain', 'china_cloud_domain', 'ai_lab_keyword', 'claude_proxy_resale_like', 'cn_tld', 'keyword', 'exact_domain_list', 'exact_domain_and_keyword', 'neutral_gateway', 'official_anthropic']
  if (current === 'not_observed') return next
  if (next === 'not_observed') return current
  const currentIndex = priority.indexOf(current)
  const nextIndex = priority.indexOf(next)
  return (nextIndex > currentIndex ? next : current) || current
}

function hasEnvResidueQuery(search: string): boolean {
  if (!search) return false
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  for (const [key, value] of params.entries()) {
    if (isEnvResidueStructuralKey(key) || containsEnvResidueLiteral(value)) return true
  }
  return false
}

function verifyCanonicalFormalPoolEnvResidueFinalRequest(
  upstreamUrl: URL,
  headers: Record<string, string>,
  body: Buffer,
): { ok: true } | { ok: false; code: 'formal_pool_env_residue_verifier_failed' } {
  if (hasEnvResidueQuery(upstreamUrl.search)) {
    return { ok: false, code: 'formal_pool_env_residue_verifier_failed' }
  }
  for (const [key, value] of Object.entries(headers)) {
    if (isEnvResidueStructuralKey(key) || containsEnvResidueLiteral(String(value || ''))) {
      return { ok: false, code: 'formal_pool_env_residue_verifier_failed' }
    }
  }
  if (!body.length) return { ok: true }
  let parsed: any
  try {
    parsed = JSON.parse(body.toString('utf-8'))
  } catch {
    return { ok: true }
  }
  if (!verifySystemEnvResidueCanonical(parsed?.system)) return { ok: false, code: 'formal_pool_env_residue_verifier_failed' }
  if (containsStructuralEnvResidue(parsed)) return { ok: false, code: 'formal_pool_env_residue_verifier_failed' }
  return { ok: true }
}

function verifySystemEnvResidueCanonical(system: unknown): boolean {
  const canonical = canonicalClaudeCodeDateMarker()
  const texts: string[] = []
  if (typeof system === 'string') texts.push(system)
  else if (Array.isArray(system)) {
    for (const item of system) {
      if (typeof item === 'string') texts.push(item)
      else if (item && typeof item === 'object' && !Array.isArray(item)) {
        const record = item as Record<string, unknown>
        if ((record.type === undefined || record.type === 'text') && typeof record.text === 'string') texts.push(record.text)
      }
    }
  }
  const markers = texts.filter((text) => /^Today['\u2019\u2018\u02bc\u02b9]s date is /.test(text))
  if (markers.length > 1) return false
  for (const text of texts) {
    if (containsEnvResidueLiteral(text)) return false
    if (/Today['\u2019\u2018\u02bc\u02b9]s date is /.test(text) && text !== canonical) return false
  }
  return true
}

function containsStructuralEnvResidue(value: unknown, path: string[] = []): boolean {
  if (Array.isArray(value)) {
    return value.some((item, index) => containsStructuralEnvResidue(item, [...path, String(index)]))
  }
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  for (const [key, child] of Object.entries(record)) {
    if (path[0] === 'messages' && (path[2] === 'content' || (path.length === 2 && key === 'content'))) continue
    if (isEnvResidueStructuralKey(key)) return true
    if (typeof child === 'string' && containsEnvResidueLiteral(child)) return true
    if (containsStructuralEnvResidue(child, [...path, key])) return true
  }
  return false
}

function isEnvResidueStructuralKey(key: string): boolean {
  const lower = key.toLowerCase()
  const normalized = lower.replace(/[-:.]/g, '_')
  const compact = lower.replace(/[-_:.]/g, '')
  return normalized === 'anthropic_base_url'
    || normalized === 'base_url'
    || normalized === 'proxy_url'
    || normalized === 'http_proxy'
    || normalized === 'https_proxy'
    || normalized === 'all_proxy'
    || normalized === 'no_proxy'
    || normalized === 'tz'
    || normalized === 'timezone'
    || normalized.includes('env_residue_profile')
    || normalized.includes('locale_profile')
    || normalized.includes('base_url_residue_profile')
    || compact.includes('anthropicbaseurl')
    || compact === 'baseurl'
    || compact === 'proxyurl'
    || compact.includes('httpproxy')
    || compact.includes('httpsproxy')
    || compact.includes('allproxy')
    || compact.includes('noproxy')
    || compact.includes('envresidueprofile')
    || compact.includes('localeprofile')
    || compact.includes('baseurlresidueprofile')
    || compact === 'tz'
    || compact === 'timezone'
}

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

type FinalOutputVerifierOptions = {
  route: SharedPoolPersonaRoute
  sessionId?: string
  accountIdentity?: AccountIdentityRecord
  expectedVersion?: string
  expectedBeta?: string
  billingMode: FormalPoolBillingMode
  requestShapeProfileRef?: string
  cacheParityProfileRef?: string
  attestation?: AttestedFormalPoolContext
}

function verifyProviderAwareFinalRequest(
  config: Config,
  upstreamUrl: URL,
  headers: Record<string, string>,
  body: Buffer,
  options: FinalOutputVerifierOptions,
  identity?: AccountIdentityRecord,
  egress?: EgressBucketResolution,
): { ok: true } | { ok: false; code: string } {
  const sharedCheck = verifySharedPoolFinalOutput(config, headers, body, options)
  if (!sharedCheck.ok) return sharedCheck
  if (options.attestation?.provider_kind !== CLAUDE_PLATFORM_AWS_PROVIDER_KIND) return { ok: true }
  return verifyClaudePlatformAWSFinalRequest(config, upstreamUrl, headers, body, options.attestation, identity, egress)
}

export function verifySharedPoolFinalOutput(
  config: Config,
  headers: Record<string, string>,
  body: Buffer,
  options: FinalOutputVerifierOptions,
): { ok: true } | { ok: false; code: string } {
  if (options.attestation?.provider_kind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND) {
    const awsHeaderCheck = verifyClaudePlatformAWSFinalHeaders(headers, options.attestation, options.accountIdentity)
    if (!awsHeaderCheck.ok) return awsHeaderCheck
  } else {
    try {
      validateSharedPoolPersonaHeaderSchema(personaSemanticHeaders(headers), options.route, options.sessionId)
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

function personaSemanticHeaders(headers: Record<string, string>): Record<string, string> {
  const out = { ...headers }
  delete out.host
  delete out.Host
  delete out['content-length']
  delete out['Content-Length']
  return out
}


type ClaudePlatformAWSSigV4SignResult = { ok: true } | { ok: false; code: 'claude_platform_aws_sigv4_profile_unproven' | 'claude_platform_aws_sigv4_credentials_missing' | 'claude_platform_aws_sigv4_region_mismatch' | 'claude_platform_aws_sigv4_workspace_missing' }

function signClaudePlatformAWSFinalRequest(
  config: Config,
  upstreamUrl: URL,
  headers: Record<string, string>,
  body: Buffer,
  attested: AttestedFormalPoolContext,
  identity?: AccountIdentityRecord,
): ClaudePlatformAWSSigV4SignResult {
  if (!claudePlatformAWSSigV4Enabled(config)) return { ok: false, code: 'claude_platform_aws_sigv4_profile_unproven' }
  const region = String(attested.aws_region || '').trim()
  const expectedHost = claudePlatformAWSHostForRegion(region)
  if (!region || attested.upstream_host !== expectedHost || headers.host !== expectedHost) return { ok: false, code: 'claude_platform_aws_sigv4_region_mismatch' }
  const accessKeyId = String(identity?.aws_access_key_id || '').trim()
  const secretAccessKey = String(identity?.aws_secret_access_key || '').trim()
  const sessionToken = String(identity?.aws_session_token || '').trim()
  if (!accessKeyId || !secretAccessKey) return { ok: false, code: 'claude_platform_aws_sigv4_credentials_missing' }
  if (!headers['anthropic-workspace-id']) return { ok: false, code: 'claude_platform_aws_sigv4_workspace_missing' }

  deleteHeaderCaseInsensitive(headers, 'x-api-key')
  deleteHeaderCaseInsensitive(headers, 'authorization')
  headers.host = claudePlatformAWSHostForRegion(region)
  headers['x-amz-date'] = sigv4AmzDate(new Date())
  if (sessionToken) headers['x-amz-security-token'] = sessionToken
  else deleteHeaderCaseInsensitive(headers, 'x-amz-security-token')

  const payloadHash = sha256Hex(body)
  headers['x-amz-content-sha256'] = payloadHash
  const canonical = canonicalSigV4Headers(headers)
  const canonicalRequest = [
    'POST',
    upstreamUrl.pathname || '/',
    '',
    canonical.canonicalHeaders,
    canonical.signedHeaders,
    payloadHash,
  ].join('\n')
  const dateStamp = headers['x-amz-date'].slice(0, 8)
  const credentialScope = `${dateStamp}/${region}/${CLAUDE_PLATFORM_AWS_SIGV4_SERVICE}/aws4_request`
  const stringToSign = [
    CLAUDE_PLATFORM_AWS_SIGV4_ALGORITHM,
    headers['x-amz-date'],
    credentialScope,
    sha256Hex(Buffer.from(canonicalRequest, 'utf-8')),
  ].join('\n')
  const signingKey = sigv4SigningKey(secretAccessKey, dateStamp, region, CLAUDE_PLATFORM_AWS_SIGV4_SERVICE)
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  headers.authorization = `${CLAUDE_PLATFORM_AWS_SIGV4_ALGORITHM} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${canonical.signedHeaders}, Signature=${signature}`
  return { ok: true }
}

function sigv4AmzDate(now: Date): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function sigv4SigningKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = createHmac('sha256', `AWS4${secret}`).update(dateStamp).digest()
  const kRegion = createHmac('sha256', kDate).update(region).digest()
  const kService = createHmac('sha256', kRegion).update(service).digest()
  return createHmac('sha256', kService).update('aws4_request').digest()
}

function canonicalSigV4Headers(headers: Record<string, string>): { canonicalHeaders: string; signedHeaders: string } {
  const values = new Map<string, string>()
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase()
    if (!value || lower === 'content-length') continue
    values.set(lower, String(value).trim().replace(/\s+/g, ' '))
  }
  const names = Array.from(values.keys()).sort()
  return {
    canonicalHeaders: names.map((name) => `${name}:${values.get(name)}\n`).join(''),
    signedHeaders: names.join(';'),
  }
}

function deleteHeaderCaseInsensitive(headers: Record<string, string>, name: string) {
  const target = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) delete headers[key]
  }
}

function verifyClaudePlatformAWSFinalHeaders(
  headers: Record<string, string>,
  attested: AttestedFormalPoolContext,
  identity?: AccountIdentityRecord,
): { ok: true } | { ok: false; code: string } {
  const normalized = Object.keys(headers).map((key) => key.toLowerCase())
  if (normalized.filter((key) => key === 'anthropic-workspace-id').length !== 1) {
    return { ok: false, code: 'claude_platform_aws_workspace_header_mismatch' }
  }
  if (normalized.includes('anthropic-beta') || normalized.includes('x-anthropic-billing-header')) {
    return { ok: false, code: 'claude_platform_aws_header_policy_mismatch' }
  }
  if (normalized.some((key) => key.startsWith('x-cc-') || key.startsWith('x-sub2api-'))) {
    return { ok: false, code: 'claude_platform_aws_header_policy_mismatch' }
  }
  const workspaceHeader = headerValueCaseInsensitive(headers, 'anthropic-workspace-id')
  if (!workspaceHeader) return { ok: false, code: 'claude_platform_aws_workspace_header_mismatch' }
  if (identity?.anthropic_workspace_id && workspaceHeader !== identity.anthropic_workspace_id) {
    return { ok: false, code: 'claude_platform_aws_workspace_header_mismatch' }
  }
  const authHeader = headerValueCaseInsensitive(headers, 'authorization')
  const xAPIKey = headerValueCaseInsensitive(headers, 'x-api-key')
  switch (attested.upstream_auth_scheme) {
    case 'x_api_key':
      if (normalized.filter((key) => key === 'x-api-key').length !== 1 || authHeader) {
        return { ok: false, code: 'claude_platform_aws_auth_header_mismatch' }
      }
      if (!xAPIKey) return { ok: false, code: 'claude_platform_aws_auth_header_mismatch' }
      return { ok: true }
    case 'sigv4': {
      if (xAPIKey || normalized.filter((key) => key === 'authorization').length !== 1 || !authHeader) {
        return { ok: false, code: 'claude_platform_aws_auth_header_mismatch' }
      }
      const region = String(attested.aws_region || '')
      const credentialScope = new RegExp(`/\\d{8}/${escapeRegExp(region)}/${escapeRegExp(CLAUDE_PLATFORM_AWS_SIGV4_SERVICE)}/aws4_request`)
      if (!authHeader.startsWith(`${CLAUDE_PLATFORM_AWS_SIGV4_ALGORITHM} `) || !credentialScope.test(authHeader)) {
        return { ok: false, code: 'claude_platform_aws_auth_header_mismatch' }
      }
      const signedHeaders = authHeader.match(/SignedHeaders=([^,]+)/)?.[1] || ''
      for (const required of ['anthropic-workspace-id', 'host', 'x-amz-content-sha256', 'x-amz-date']) {
        if (!signedHeaders.split(';').includes(required)) return { ok: false, code: 'claude_platform_aws_auth_header_mismatch' }
      }
      if (headerValueCaseInsensitive(headers, 'x-amz-security-token') && !signedHeaders.split(';').includes('x-amz-security-token')) {
        return { ok: false, code: 'claude_platform_aws_auth_header_mismatch' }
      }
      return { ok: true }
    }
    default:
      return { ok: false, code: 'claude_platform_aws_auth_profile_unproven' }
  }
}

function headerValueCaseInsensitive(headers: Record<string, string>, name: string): string {
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return String(value || '')
  }
  return ''
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function verifyClaudePlatformAWSFinalRequest(
  config: Config,
  upstreamUrl: URL,
  headers: Record<string, string>,
  _body: Buffer,
  attested: AttestedFormalPoolContext,
  identity?: AccountIdentityRecord,
  egress?: EgressBucketResolution,
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
  const headerCheck = verifyClaudePlatformAWSFinalHeaders(headers, attested, identity)
  if (!headerCheck.ok) return headerCheck
  if (!identity || !egress) return { ok: false, code: 'claude_platform_aws_workspace_binding_mismatch' }
  return verifyClaudePlatformAWSWorkspaceAuthority(config, {
    providerKind: attested.provider_kind,
    accountRef: accountRefForWorkspaceBinding(identity, attested.account_id),
    credentialRef: attested.credential_ref,
    workspaceRef: attested.workspace_ref || '',
    workspaceBindingHmac: attested.workspace_binding_hmac || '',
    endpointRef: attested.upstream_endpoint_ref || '',
    region: attested.aws_region || '',
    authScheme: attested.upstream_auth_scheme || '',
    egressBucket: attested.egress_bucket,
    proxyIdentityRef: egress.proxyIdentityRef,
    rawWorkspaceId: identity.anthropic_workspace_id || '',
  })
}


type ClaudePlatformAWSWorkspaceAuthorityInput = {
  providerKind: string
  accountRef: string
  credentialRef: string
  workspaceRef: string
  workspaceBindingHmac: string
  endpointRef: string
  region: string
  authScheme: string
  egressBucket: string
  proxyIdentityRef: string
  rawWorkspaceId: string
}

function verifyClaudePlatformAWSWorkspaceAuthority(
  config: Config,
  input: ClaudePlatformAWSWorkspaceAuthorityInput,
): { ok: true } | { ok: false; code: 'claude_platform_aws_workspace_ref_mismatch' | 'claude_platform_aws_workspace_binding_mismatch' | 'claude_platform_aws_workspace_authority_secret_missing' } {
  if (!claudePlatformAWSWorkspaceAuthoritySecretsConfigured(config)) {
    return { ok: false, code: 'claude_platform_aws_workspace_authority_secret_missing' }
  }
  const expectedWorkspaceRef = claudePlatformAWSWorkspaceRef(config, input.region, input.rawWorkspaceId)
  if (!safeEqualHmacRef(input.workspaceRef, expectedWorkspaceRef)) {
    return { ok: false, code: 'claude_platform_aws_workspace_ref_mismatch' }
  }
  const expectedBinding = claudePlatformAWSWorkspaceBindingHmac(config, input)
  if (!safeEqualHmacRef(input.workspaceBindingHmac, expectedBinding)) {
    return { ok: false, code: 'claude_platform_aws_workspace_binding_mismatch' }
  }
  return { ok: true }
}

function claudePlatformAWSWorkspaceRef(config: Config, region: string, rawWorkspaceId: string): string {
  return formalPoolSafeRef(config, 'workspace', [CLAUDE_PLATFORM_AWS_WORKSPACE_REF_DOMAIN, region, rawWorkspaceId].join('\0'))
}

function formalPoolSafeRef(config: Config, scope: string, raw: string): string {
  const secret = formalPoolSafeRefSecret(config)
  return `hmac-sha256:${createHmac('sha256', secret)
    .update(`formal_pool_${scope}`)
    .update('\0')
    .update('v1')
    .update('\0')
    .update(raw)
    .digest('hex')}`
}

function claudePlatformAWSWorkspaceBindingHmac(config: Config, input: ClaudePlatformAWSWorkspaceAuthorityInput): string {
  const secret = claudePlatformAWSWorkspaceBindingSecret(config)
  return `hmac-sha256:${createHmac('sha256', secret)
    .update([
      CLAUDE_PLATFORM_AWS_BINDING_DOMAIN,
      input.providerKind,
      input.accountRef,
      input.credentialRef,
      input.workspaceRef,
      input.endpointRef,
      input.region,
      input.authScheme,
      input.egressBucket,
      input.proxyIdentityRef,
    ].join('\0'))
    .digest('hex')}`
}

function formalPoolSafeRefSecret(config: Config): string {
  return explicitFormalPoolSafeRefSecret(config)
}

function claudePlatformAWSWorkspaceBindingSecret(config: Config): string {
  return explicitClaudePlatformAWSWorkspaceBindingSecret(config)
}

function claudePlatformAWSWorkspaceAuthoritySecretsConfigured(config: Config): boolean {
  return Boolean(explicitFormalPoolSafeRefSecret(config) && explicitClaudePlatformAWSWorkspaceBindingSecret(config))
}

function explicitFormalPoolSafeRefSecret(config: Config): string {
  const sharedPool = (config as any).shared_pool || {}
  const configured = typeof sharedPool.sticky_session_hmac_key === 'string' ? sharedPool.sticky_session_hmac_key.trim() : ''
  const env = process.env.SUB2API_GATEWAY_STICKY_SESSION_HMAC_KEY?.trim() || ''
  return configured || env
}

function explicitClaudePlatformAWSWorkspaceBindingSecret(config: Config): string {
  const sharedPool = (config as any).shared_pool || {}
  const configured = typeof sharedPool.claude_platform_aws_workspace_binding_hmac_key === 'string'
    ? sharedPool.claude_platform_aws_workspace_binding_hmac_key.trim()
    : ''
  const env = process.env.SUB2API_CLAUDE_PLATFORM_AWS_BINDING_HMAC_KEY?.trim() || ''
  return configured || env
}

function safeEqualHmacRef(actual: string, expected: string): boolean {
  if (!/^hmac-sha256:[a-f0-9]{64}$/i.test(actual) || !/^hmac-sha256:[a-f0-9]{64}$/i.test(expected)) return false
  return safeEqualHex(actual.slice('hmac-sha256:'.length), expected.slice('hmac-sha256:'.length))
}

function accountRefForWorkspaceBinding(identity: AccountIdentityRecord, fallbackAccountId: string): string {
  return identity.account_ref || identity.account_hash || identity.account_uuid_ref || identity.account_uuid_hash || fallbackAccountId
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
    attestation?: AttestedFormalPoolContext
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
  const firstPartyShapeRefs = new Set([FORMAL_POOL_2179_REQUEST_SHAPE_PROFILE_REF, FORMAL_POOL_2197_REQUEST_SHAPE_PROFILE_REF, FORMAL_POOL_2197_LEGACY_REQUEST_SHAPE_PROFILE_REF])
  const firstPartyCacheRefs = new Set([FORMAL_POOL_2179_CACHE_PARITY_PROFILE_REF, FORMAL_POOL_2197_CACHE_PARITY_PROFILE_REF, FORMAL_POOL_2197_LEGACY_CACHE_PARITY_PROFILE_REF])
  if (options.requestShapeProfileRef && !firstPartyShapeRefs.has(options.requestShapeProfileRef)) {
    return { ok: false, code: 'request_shape_profile_mismatch' }
  }
  if (options.cacheParityProfileRef && !firstPartyCacheRefs.has(options.cacheParityProfileRef)) {
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
  if (options.attestation?.mcp_connector_policy_ref === FORMAL_POOL_MCP_CONNECTOR_POLICY_REF && isFormalPoolMCPConnectorCanonicalTuple(options.attestation)) {
    allowedTopLevel.add('mcp_servers')
  }
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
  if (normalizedPolicyVersion === '2.1.197') {
    return normalizedProfile === 'claude-code-2.1.197-macos-local'
  }
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
  const tlsMode = tlsProfileMode((config as any).shared_pool)
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
    'env_residue_profile_ref',
    'locale_profile_ref',
    'base_url_residue_profile_ref',
    'profile_policy_version',
    'billing_shape_policy',
    'request_shape_profile_ref',
    'cache_parity_profile_ref',
    'session_id',
    'nonce',
  ]
  if (tlsMode.enabled && tlsMode.strict && (typeof obj.egress_tls_profile_ref !== 'string' || !obj.egress_tls_profile_ref.trim())) {
    return { ok: false, status: 403, code: 'missing_egress_tls_profile_ref' }
  }
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
      || !isClaudePlatformAWSAuthScheme(obj.upstream_auth_scheme)
      || !isSafeProfileRef(obj.beta_policy_ref)) {
      return { ok: false, status: 403, code: 'malformed_formal_pool_context_attestation' }
    }
  }
  if (hasDuplicateFormalPoolSemanticFields(rawContext)) {
    return { ok: false, status: 403, code: 'malformed_formal_pool_context_attestation' }
  }
  if ((obj.egress_tls_profile_ref !== undefined && !isSafeTLSProfileRef(obj.egress_tls_profile_ref))
    || (tlsMode.enabled && tlsMode.strict && !isSafeTLSProfileRef(obj.egress_tls_profile_ref))
    || !isSafeEnvResidueProfileRef(obj.env_residue_profile_ref, 'env-residue-profile:')
    || !isSafeEnvResidueProfileRef(obj.locale_profile_ref, 'locale-profile:')
    || !isSafeEnvResidueProfileRef(obj.base_url_residue_profile_ref, 'base-url-residue-profile:')
    || !isSafeProfileRef(obj.trusted_egress_profile_ref)
    || !isSafeProfileRef(obj.profile_policy_version)
    || !isSafeProfileRef(obj.request_shape_profile_ref)
    || !isSafeProfileRef(obj.cache_parity_profile_ref)
    || (obj.mcp_connector_policy_ref !== undefined && obj.mcp_connector_policy_ref !== FORMAL_POOL_MCP_CONNECTOR_POLICY_REF)
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
      ...(typeof obj.egress_tls_profile_ref === 'string' ? { egress_tls_profile_ref: obj.egress_tls_profile_ref } : {}),
      env_residue_profile_ref: obj.env_residue_profile_ref,
      locale_profile_ref: obj.locale_profile_ref,
      base_url_residue_profile_ref: obj.base_url_residue_profile_ref,
      profile_policy_version: obj.profile_policy_version,
      billing_shape_policy: obj.billing_shape_policy,
      request_shape_profile_ref: obj.request_shape_profile_ref,
      cache_parity_profile_ref: obj.cache_parity_profile_ref,
      ...(typeof obj.mcp_connector_policy_ref === 'string' ? { mcp_connector_policy_ref: obj.mcp_connector_policy_ref } : {}),
      observed_client_profile: obj.observed_client_profile as Record<string, unknown>,
      session_id: obj.session_id,
      timestamp_ms: obj.timestamp_ms,
      nonce: obj.nonce,
      ...(providerKind ? { provider_kind: providerKind } : {}),
      ...(providerKind === CLAUDE_PLATFORM_AWS_PROVIDER_KIND ? {
        credential_binding_hmac: obj.credential_binding_hmac,
        upstream_auth_scheme: obj.upstream_auth_scheme as 'x_api_key' | 'bearer_api_key' | 'sigv4',
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

function isSafeEnvResidueProfileRef(value: unknown, prefix: string): value is string {
  if (!isSafeProfileRef(value) || !value.startsWith(prefix)) return false
  const lower = value.toLowerCase()
  if (lower.includes('://') || lower.includes('@') || lower.includes('bearer') || lower.includes('token') || lower.includes('secret') || lower.includes('api-key') || lower.includes('apikey') || lower.includes('sk-')) return false
  if (lower.includes('anthropic_base_url') || lower.includes('http_proxy') || lower.includes('https_proxy') || lower.includes('all_proxy') || lower.includes('no_proxy') || lower.includes('tz=')) return false
  if (lower.includes('raw-domain-list')) return false
  return true
}

function hasDuplicateFormalPoolSemanticFields(rawContext: string): boolean {
  const counts = new Map<string, number>()
  let depth = 0
  for (let i = 0; i < rawContext.length; i++) {
    const ch = rawContext[i]
    if (ch === '{') {
      depth++
      continue
    }
    if (ch === '}') {
      depth--
      continue
    }
    if (ch !== '"' || depth !== 1) continue
    let value = ''
    let j = i + 1
    let escaped = false
    for (; j < rawContext.length; j++) {
      const c = rawContext[j]
      if (escaped) {
        value += '\\' + c
        escaped = false
        continue
      }
      if (c === '\\') {
        escaped = true
        continue
      }
      if (c === '"') break
      value += c
    }
    let k = j + 1
    while (/\s/.test(rawContext[k] || '')) k++
    if (rawContext[k] === ':') {
      const semanticKey = decodeJSONPropertyKey(value)
      const next = (counts.get(semanticKey) || 0) + 1
      if (next > 1) return true
      counts.set(semanticKey, next)
    }
    i = j
  }
  return false
}

function decodeJSONPropertyKey(rawKey: string): string {
  try {
    const decoded = JSON.parse(`"${rawKey}"`)
    return typeof decoded === 'string' ? decoded : rawKey
  } catch {
    return rawKey
  }
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
  if (profile.cc_entrypoint_bucket !== undefined && !['absent', 'cli', 'sdk-cli', 'claude-vscode', 'other', 'unknown'].includes(String(profile.cc_entrypoint_bucket))) return false
  if (profile.client_family_bucket !== undefined && !['cli', 'desktop', 'vscode', 'unknown'].includes(String(profile.client_family_bucket))) return false
  if (profile.date_format_bucket !== undefined && !['hyphen', 'slash', 'other', 'not_observed'].includes(String(profile.date_format_bucket))) return false
  if (profile.apostrophe_bucket !== undefined && !['ascii', 'unicode_variant_1', 'unicode_variant_2', 'unicode_variant_3', 'other', 'not_observed'].includes(String(profile.apostrophe_bucket))) return false
  if (profile.base_url_category_bucket !== undefined && !['official_anthropic', 'neutral_gateway', 'cn_tld', 'exact_domain_list', 'keyword', 'exact_domain_and_keyword', 'china_tld', 'china_org_domain', 'china_cloud_domain', 'ai_lab_keyword', 'claude_proxy_resale_like', 'unknown', 'not_observed'].includes(String(profile.base_url_category_bucket))) return false
  if (profile.proxy_env_bucket !== undefined && !['no_proxy_env', 'loopback_proxy_only', 'non_loopback_proxy_rejected', 'no_proxy_bypass_guarded', 'unknown'].includes(String(profile.proxy_env_bucket))) return false
  if (profile.mcp_configured_absent_diff_bucket !== undefined && !['absent_no_diff', 'configured_no_upstream_diff', 'configured_marker_present', 'unknown', 'not_observed'].includes(String(profile.mcp_configured_absent_diff_bucket))) return false
  if (profile.mcp_shape_bucket !== undefined && !['absent', 'official_remote_url_connector', 'local_config_shape', 'unsafe_or_unknown'].includes(String(profile.mcp_shape_bucket))) return false
  for (const key of ['mcp_server_count_bucket', 'mcp_toolset_count_bucket']) {
    if (profile[key] !== undefined && !['0', '1', '2_5', '6_plus'].includes(String(profile[key]))) return false
  }
  if (profile.mcp_auth_bucket !== undefined && !['absent', 'present_redacted'].includes(String(profile.mcp_auth_bucket))) return false
  if (profile.local_env_residue_present !== undefined && typeof profile.local_env_residue_present !== 'boolean') return false
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


function plan76ModelVersionUnsupportedFromContext(attested: AttestedFormalPoolContext): string | null {
  if (attested.policy_version === '2.1.197' && (!isFormalPool2197ProfilePolicyVersion(attested.profile_policy_version) || attested.persona_profile !== 'claude-code-2.1.197-macos-local')) return 'formal_pool_model_version_unsupported'
  if (isFormalPool2197ProfilePolicyVersion(attested.profile_policy_version) && attested.policy_version !== '2.1.197') return 'formal_pool_model_version_unsupported'
  return null
}


function plan76ModelVersionUnsupportedFromIdentity(attested: AttestedFormalPoolContext, identity: AccountIdentityRecord): string | null {
  if (identity.policy_version === '2.1.197'
    && (attested.policy_version !== '2.1.197'
      || !isFormalPool2197ProfilePolicyVersion(attested.profile_policy_version)
      || attested.persona_profile !== 'claude-code-2.1.197-macos-local')) {
    return 'formal_pool_model_version_unsupported'
  }
  return null
}

type FormalPoolMCPConnectorEvidence = {
  decisionBucket: string
  serverCountBucket: string
  authBucket: string
}

function absentMCPConnectorEvidence(): FormalPoolMCPConnectorEvidence {
  return { decisionBucket: 'absent', serverCountBucket: '0', authBucket: 'absent' }
}

function verifyPlan76FormalPoolBodyPolicy(
  config: Config,
  pathname: string,
  parsedBody: unknown,
  attested: AttestedFormalPoolContext,
): { ok: true; mcp: FormalPoolMCPConnectorEvidence } | { ok: false; status: number; code: string; message: string; mcp?: FormalPoolMCPConnectorEvidence } {
  if (pathname !== '/v1/messages') return { ok: true, mcp: absentMCPConnectorEvidence() }
  const body = parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody) ? parsedBody as Record<string, unknown> : null
  if (!body) return { ok: true, mcp: absentMCPConnectorEvidence() }
  if (body.stream !== true || attested.observed_client_profile?.stream !== true) {
    return { ok: false, status: 403, code: 'formal_pool_non_streaming_profile_unapproved', message: 'Formal-pool non-streaming profile is not approved' }
  }
  const mcpDecision = verifyFormalPoolMCPConnectorPolicy(body, attested.observed_client_profile || {}, attested, config)
  if (!mcpDecision.ok) return mcpDecision
  const model = typeof body.model === 'string' ? body.model : ''
  if (model === 'claude-sonnet-5') {
    if (attested.policy_version !== '2.1.197' || !isFormalPool2197ProfilePolicyVersion(attested.profile_policy_version) || !isFormalPool2197RequestShapeProfileRef(attested.request_shape_profile_ref) || !isFormalPool2197CacheParityProfileRef(attested.cache_parity_profile_ref)) {
      return { ok: false, status: 403, code: 'formal_pool_model_version_unsupported', message: 'Formal-pool Sonnet 5 requires the server-selected 2.1.197 canonical tuple' }
    }
  }
  return { ok: true, mcp: mcpDecision.mcp }
}

function verifyFormalPoolMCPConnectorPolicy(
  body: Record<string, unknown>,
  observedProfile: Record<string, unknown>,
  attested: AttestedFormalPoolContext,
  config: Config,
): { ok: true; mcp: FormalPoolMCPConnectorEvidence } | { ok: false; status: 403; code: string; message: string; mcp: FormalPoolMCPConnectorEvidence } {
  const classified = classifyFormalPoolMCPConnectorShape(body, observedProfile, attested, config)
  if (!classified.ok) {
    return {
      ok: false,
      status: 403,
      code: classified.code,
      message: classified.message,
      mcp: classified.mcp,
    }
  }
  return { ok: true, mcp: classified.mcp }
}

type FormalPoolMCPConnectorDecision =
  | { ok: true; mcp: FormalPoolMCPConnectorEvidence }
  | { ok: false; code: string; message: string; mcp: FormalPoolMCPConnectorEvidence }

function rejectMCPConnector(code: string, decisionBucket: string, message = 'Formal-pool MCP connector shape is not approved', evidence: Partial<FormalPoolMCPConnectorEvidence> = {}): FormalPoolMCPConnectorDecision {
  return {
    ok: false,
    code,
    message,
    mcp: {
      ...absentMCPConnectorEvidence(),
      ...evidence,
      decisionBucket,
    },
  }
}

function classifyFormalPoolMCPConnectorShape(
  body: Record<string, unknown>,
  observedProfile: Record<string, unknown>,
  attested: AttestedFormalPoolContext,
  config: Config,
): FormalPoolMCPConnectorDecision {
  const marker = observedProfile.mcp_configured_absent_diff_bucket
  const hasMCPServers = Object.prototype.hasOwnProperty.call(body, 'mcp_servers')
  const hasMCPToolset = Array.isArray(body.tools) && body.tools.some((tool) => !!tool && typeof tool === 'object' && (tool as Record<string, unknown>).type === 'mcp_toolset')
  const hasForbiddenTopLevel = ['mcp', 'mcp_config', 'mcp_authority', 'mcp_tools', 'mcpServers'].some((key) => Object.prototype.hasOwnProperty.call(body, key))
  const hasStructuralMCPConfigKey = containsStructuralMCPConfigKey(body)
  if (!hasMCPServers && !hasMCPToolset && !hasForbiddenTopLevel && marker !== 'configured_marker_present' && !hasStructuralMCPConfigKey) {
    return { ok: true, mcp: absentMCPConnectorEvidence() }
  }
  const authBucket = containsRawMCPCredentialKey([body.mcp_servers, body.tools]) ? 'present_rejected' : 'absent'
  const serverCountBucket = mcpCountBucket(Array.isArray(body.mcp_servers) ? body.mcp_servers.length : 0)
  const evidence = { serverCountBucket, authBucket }
  if (hasForbiddenTopLevel || marker === 'configured_marker_present' || (!hasMCPServers && !hasMCPToolset && hasStructuralMCPConfigKey)) return rejectMCPConnector('formal_pool_mcp_legacy_shape_unapproved', 'legacy_shape_rejected', undefined, evidence)
  const connector = (config as any).formal_pool?.mcp_connector as { enabled?: boolean; allowed_hosts?: string[]; allowed_models?: string[]; max_servers?: number } | undefined
  if (connector?.enabled !== true) return rejectMCPConnector('formal_pool_mcp_connector_disabled', 'connector_disabled', undefined, evidence)
  if (attested.mcp_connector_policy_ref !== FORMAL_POOL_MCP_CONNECTOR_POLICY_REF) return rejectMCPConnector('formal_pool_mcp_connector_account_disabled', 'account_policy_missing', undefined, evidence)
  if (!isFormalPoolMCPConnectorCanonicalTuple(attested)) return rejectMCPConnector('formal_pool_mcp_canonical_tuple_required', 'canonical_tuple_rejected', undefined, evidence)
  if (!mcpAllowlistMatches(connector.allowed_models, String(body.model || ''))) return rejectMCPConnector('formal_pool_mcp_model_unapproved', 'model_rejected', undefined, evidence)
  return validateOfficialRemoteMCPConnector(body, connector, evidence)
}

function isFormalPoolMCPConnectorCanonicalTuple(attested: Pick<AttestedFormalPoolContext, 'policy_version' | 'persona_profile' | 'profile_policy_version' | 'request_shape_profile_ref' | 'cache_parity_profile_ref' | 'egress_tls_profile_ref'>): boolean {
  return attested.policy_version === '2.1.197'
    && attested.persona_profile === 'claude-code-2.1.197-macos-local'
    && isFormalPool2197ProfilePolicyVersion(attested.profile_policy_version)
    && isFormalPool2197RequestShapeProfileRef(attested.request_shape_profile_ref)
    && isFormalPool2197CacheParityProfileRef(attested.cache_parity_profile_ref)
    && attested.egress_tls_profile_ref === FORMAL_POOL_2197_TLS_PROFILE_REF
}

function containsStructuralMCPConfigKey(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || value === undefined) return false
  if (Array.isArray(value)) return value.some((item) => containsStructuralMCPConfigKey(item, depth + 1))
  if (typeof value !== 'object') return false
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    if (/^(mcpServers|mcp|mcp_servers|mcp_config|mcpAuthority|mcp_authority|mcpTools|mcp_tools)$/i.test(key)) return true
    return containsStructuralMCPConfigKey(child, depth + 1)
  })
}

function validateOfficialRemoteMCPConnector(
  body: Record<string, unknown>,
  connector: { allowed_hosts?: string[]; max_servers?: number },
  evidence: Partial<FormalPoolMCPConnectorEvidence>,
): FormalPoolMCPConnectorDecision {
  if (!Array.isArray(body.mcp_servers)) return rejectMCPConnector('formal_pool_mcp_schema_unapproved', 'schema_rejected', undefined, evidence)
  const maxServers = connector.max_servers || 1
  if (body.mcp_servers.length < 1 || body.mcp_servers.length > maxServers) return rejectMCPConnector('formal_pool_mcp_schema_unapproved', 'schema_rejected', undefined, { ...evidence, serverCountBucket: mcpCountBucket(body.mcp_servers.length) })
  if (containsRawMCPCredentialKey([body.mcp_servers, body.tools])) return rejectMCPConnector('formal_pool_mcp_raw_credential_unapproved', 'raw_credential_rejected', undefined, { ...evidence, authBucket: 'present_rejected' })
  const approvedNames = new Set<string>()
  for (const server of body.mcp_servers) {
    const result = validateOfficialRemoteMCPServer(server, connector.allowed_hosts || [])
    if (!result.ok) return rejectMCPConnector(result.code, result.bucket, undefined, evidence)
    if (approvedNames.has(result.name)) return rejectMCPConnector('formal_pool_mcp_schema_unapproved', 'schema_rejected', undefined, evidence)
    approvedNames.add(result.name)
  }
  if (!Array.isArray(body.tools)) return rejectMCPConnector('formal_pool_mcp_toolset_unapproved', 'toolset_rejected', undefined, evidence)
  let mcpToolsetCount = 0
  for (const tool of body.tools) {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) continue
    const record = tool as Record<string, unknown>
    if (record.type !== 'mcp_toolset') continue
    mcpToolsetCount++
    const keys = Object.keys(record)
    if (!keys.every((key) => key === 'type' || key === 'mcp_server_name')) return rejectMCPConnector('formal_pool_mcp_toolset_unapproved', 'toolset_rejected', undefined, evidence)
    if (typeof record.mcp_server_name !== 'string' || !approvedNames.has(record.mcp_server_name)) return rejectMCPConnector('formal_pool_mcp_toolset_unapproved', 'toolset_rejected', undefined, evidence)
  }
  if (mcpToolsetCount !== approvedNames.size) return rejectMCPConnector('formal_pool_mcp_toolset_unapproved', 'toolset_rejected', undefined, evidence)
  if (body.tool_choice !== undefined) return rejectMCPConnector('formal_pool_mcp_tool_choice_unapproved', 'tool_choice_rejected', undefined, evidence)
  if (containsMCPCacheControl(body.mcp_servers) || containsMCPCacheControl(body.tools, true)) return rejectMCPConnector('formal_pool_mcp_cache_control_unapproved', 'cache_control_rejected', undefined, evidence)
  return {
    ok: true,
    mcp: {
      decisionBucket: 'official_url_connector_allowed',
      serverCountBucket: mcpCountBucket(body.mcp_servers.length),
      authBucket: 'absent',
    },
  }
}

function validateOfficialRemoteMCPServer(server: unknown, allowedHosts: string[]): { ok: true; name: string } | { ok: false; code: string; bucket: string } {
  if (!server || typeof server !== 'object' || Array.isArray(server)) return { ok: false, code: 'formal_pool_mcp_schema_unapproved', bucket: 'schema_rejected' }
  const record = server as Record<string, unknown>
  const keys = Object.keys(record)
  if (record.type !== 'url') return { ok: false, code: 'formal_pool_mcp_local_stdio_unapproved', bucket: 'local_stdio_rejected' }
  if (record.cache_control !== undefined) return { ok: false, code: 'formal_pool_mcp_cache_control_unapproved', bucket: 'cache_control_rejected' }
  if (keys.some((key) => ['command', 'args', 'cwd'].includes(key))) return { ok: false, code: 'formal_pool_mcp_local_command_unapproved', bucket: 'local_command_rejected' }
  if (keys.some((key) => key === 'env')) return { ok: false, code: 'formal_pool_mcp_raw_credential_unapproved', bucket: 'raw_credential_rejected' }
  if (!keys.every((key) => key === 'type' || key === 'name' || key === 'url')) return { ok: false, code: 'formal_pool_mcp_schema_unapproved', bucket: 'schema_rejected' }
  if (typeof record.name !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(record.name)) return { ok: false, code: 'formal_pool_mcp_schema_unapproved', bucket: 'schema_rejected' }
  const parsed = safeMCPURL(record.url)
  if (!parsed.ok) return { ok: false, code: parsed.code, bucket: 'unsafe_url_rejected' }
  if (!mcpHostAllowlistMatches(allowedHosts, parsed.host)) return { ok: false, code: 'formal_pool_mcp_host_unapproved', bucket: 'host_rejected' }
  return { ok: true, name: record.name }
}

function mcpAllowlistMatches(allowlist: string[] | undefined, value: string): boolean {
  return Array.isArray(allowlist) && (allowlist.includes('*') || allowlist.includes(value))
}

function mcpHostAllowlistMatches(allowlist: string[] | undefined, value: string): boolean {
  if (!Array.isArray(allowlist)) return false
  return allowlist.some((entry) => {
    const normalized = String(entry || '').trim().toLowerCase()
    if (!normalized || normalized === '*') return false
    if (normalized.startsWith('*.')) {
      const suffix = normalized.slice(2)
      return value === suffix || value.endsWith(`.${suffix}`)
    }
    if (normalized.startsWith('.')) {
      const suffix = normalized.slice(1)
      return value === suffix || value.endsWith(`.${suffix}`)
    }
    return value === normalized
  })
}

function safeMCPURL(value: unknown): { ok: true; host: string } | { ok: false; code: string } {
  if (typeof value !== 'string' || value.length > 2048) return { ok: false, code: 'formal_pool_mcp_unsafe_url_unapproved' }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { ok: false, code: 'formal_pool_mcp_unsafe_url_unapproved' }
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return { ok: false, code: 'formal_pool_mcp_unsafe_url_unapproved' }
  if (parsed.port && parsed.port !== '443') return { ok: false, code: 'formal_pool_mcp_unsafe_url_unapproved' }
  if (parsed.search || parsed.hash) return { ok: false, code: 'formal_pool_mcp_unsafe_url_unapproved' }
  let decodedPath = ''
  try {
    decodedPath = decodeURIComponent(parsed.pathname)
  } catch {
    return { ok: false, code: 'formal_pool_mcp_unsafe_url_unapproved' }
  }
  if (/(?:authorization|api[_-]?key|token|cookie|secret|password|credential)/i.test(decodedPath)) {
    return { ok: false, code: 'formal_pool_mcp_unsafe_url_unapproved' }
  }
  const host = parsed.hostname.toLowerCase()
  if (!host || host.endsWith('.') || host === 'localhost' || host.endsWith('.localhost') || isIP(host) !== 0 || host.startsWith('[') || host.endsWith(']')) {
    return { ok: false, code: 'formal_pool_mcp_unsafe_url_unapproved' }
  }
  if (isBlockedSpecialHost(host)) return { ok: false, code: 'formal_pool_mcp_unsafe_url_unapproved' }
  return { ok: true, host }
}

function isBlockedSpecialHost(host: string): boolean {
  return host === '169.254.169.254' || host === 'metadata.google.internal'
}

function containsRawMCPCredentialKey(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || value === undefined) return false
  if (Array.isArray(value)) return value.some((item) => containsRawMCPCredentialKey(item, depth + 1))
  if (typeof value !== 'object') return false
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => /^(authorization_token|authorization|api_key|token|headers|cookie|secret|password|env)$/i.test(key) || containsRawMCPCredentialKey(child, depth + 1))
}

function containsMCPCacheControl(value: unknown, onlyMCPToolset = false): boolean {
  if (!Array.isArray(value)) return false
  return value.some((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const record = item as Record<string, unknown>
    if (onlyMCPToolset && record.type !== 'mcp_toolset') return false
    return record.cache_control !== undefined
  })
}

function mcpCountBucket(count: number): string {
  if (count <= 0) return '0'
  if (count === 1) return '1'
  if (count <= 5) return '2_5'
  return '6_plus'
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
  const profileRefCheck = verifyFormalPoolProfileRefs(config, attested)
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

function verifyFormalPoolProfileRefs(config: Config, attested: AttestedFormalPoolContext): { ok: true } | { ok: false; status: number; code: string; message: string } {
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
    if (attested.upstream_auth_scheme === 'bearer_api_key') {
      return { ok: false, status: 403, code: 'claude_platform_aws_auth_profile_unproven', message: 'Claude Platform on AWS bearer auth profile has not been proven by CP0' }
    }
    if (attested.upstream_auth_scheme === 'sigv4' && !claudePlatformAWSSigV4Enabled(config)) {
      return { ok: false, status: 403, code: 'claude_platform_aws_sigv4_profile_unproven', message: 'Claude Platform on AWS SigV4 profile has not been proven by CP7' }
    }
    if (attested.upstream_auth_scheme !== 'x_api_key' && attested.upstream_auth_scheme !== 'sigv4') {
      return { ok: false, status: 403, code: 'claude_platform_aws_auth_profile_unproven', message: 'Claude Platform on AWS auth profile has not been proven by CP0' }
    }
    return { ok: true }
  }
  if (isFormalPool2197ProfilePolicyVersion(attested.profile_policy_version)) {
    if (attested.policy_version !== '2.1.197' || attested.persona_profile !== 'claude-code-2.1.197-macos-local') {
      return { ok: false, status: 403, code: 'formal_pool_profile_ref_unapproved', message: 'Formal-pool 2.1.197 profile policy must be server-selected as a complete tuple' }
    }
    if (attested.trusted_egress_profile_ref !== FORMAL_POOL_DEFAULT_EGRESS_PROFILE_REF || attested.billing_shape_policy !== 'strip') {
      return { ok: false, status: 403, code: 'formal_pool_billing_policy_mismatch', message: 'Formal-pool 2.1.197 promotion requires strip billing policy' }
    }
    if (!isFormalPool2197RequestShapeProfileRef(attested.request_shape_profile_ref) || !isFormalPool2197CacheParityProfileRef(attested.cache_parity_profile_ref)) {
      return { ok: false, status: 403, code: 'formal_pool_profile_ref_unapproved', message: 'Formal-pool 2.1.197 request/cache profile is not approved' }
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

function formalPoolEnvResidueConfig(config: Config): {
  env_residue_profile_ref: string
  locale_profile_ref: string
  base_url_residue_profile_ref: string
} {
  const sharedPool = ((config as any).shared_pool || {}) as Record<string, any>
  const envResidue = sharedPool.env_residue && typeof sharedPool.env_residue === 'object' ? sharedPool.env_residue : {}
  return {
    env_residue_profile_ref: typeof envResidue.env_residue_profile_ref === 'string' && envResidue.env_residue_profile_ref.trim()
      ? envResidue.env_residue_profile_ref.trim()
      : FORMAL_POOL_ENV_RESIDUE_PROFILE_REF,
    locale_profile_ref: typeof envResidue.locale_profile_ref === 'string' && envResidue.locale_profile_ref.trim()
      ? envResidue.locale_profile_ref.trim()
      : FORMAL_POOL_LOCALE_PROFILE_REF,
    base_url_residue_profile_ref: typeof envResidue.base_url_residue_profile_ref === 'string' && envResidue.base_url_residue_profile_ref.trim()
      ? envResidue.base_url_residue_profile_ref.trim()
      : FORMAL_POOL_BASE_URL_RESIDUE_PROFILE_REF,
  }
}

function verifyFormalPoolEnvResidueProfiles(
  config: Config,
  attested: AttestedFormalPoolContext,
): { ok: true } | { ok: false; status: number; code: string; message: string } {
  const expected = formalPoolEnvResidueConfig(config)
  if (!isSafeEnvResidueProfileRef(attested.env_residue_profile_ref, 'env-residue-profile:')
    || !isSafeEnvResidueProfileRef(attested.locale_profile_ref, 'locale-profile:')
    || !isSafeEnvResidueProfileRef(attested.base_url_residue_profile_ref, 'base-url-residue-profile:')) {
    return { ok: false, status: 403, code: 'formal_pool_env_residue_profile_unapproved', message: 'Formal-pool env residue profile refs are not safe' }
  }
  if (attested.env_residue_profile_ref !== expected.env_residue_profile_ref
    || attested.locale_profile_ref !== expected.locale_profile_ref
    || attested.base_url_residue_profile_ref !== expected.base_url_residue_profile_ref) {
    return { ok: false, status: 403, code: 'formal_pool_env_residue_profile_unapproved', message: 'Formal-pool env residue profile refs are not approved for this account' }
  }
  return { ok: true }
}

function verifyObservedClientProfileAdmission(attested: AttestedFormalPoolContext, requireExact2179 = false): { ok: true } | { ok: false; status: number; code: string; message: string } {
  const profile = attested.observed_client_profile
  if (requireExact2179 && (profile.unknown_top_level_body_key_count as number | undefined) && Number(profile.unknown_top_level_body_key_count) > 0) {
    return { ok: false, status: 403, code: 'formal_pool_observed_client_profile_unapproved', message: 'Formal-pool observed client profile contains unknown body keys' }
  }
  const version = typeof profile.cli_version_bucket === 'string' ? profile.cli_version_bucket : ''
  if (requireExact2179 && version !== '2.1.179') {
    return { ok: false, status: 403, code: 'formal_pool_observed_client_profile_unapproved', message: 'Formal-pool optional egress profiles require exact 2.1.179 observed client proof' }
  }
  if (!isObservedClaudeCodeVersionAtLeast(version, FORMAL_POOL_OBSERVED_MIN_CLI_VERSION)) {
    return { ok: false, status: 403, code: 'formal_pool_observed_client_profile_unapproved', message: 'Formal-pool observed client version is below the approved minimum for this profile' }
  }
  const billingShape = typeof profile.billing_shape === 'string' ? profile.billing_shape : ''
  if (billingShape && !['absent', 'no_cch', 'cch_present'].includes(billingShape)) {
    return { ok: false, status: 403, code: 'formal_pool_observed_client_profile_unapproved', message: 'Formal-pool observed billing shape is not approved' }
  }
  return { ok: true }
}

function isObservedClaudeCodeVersionAtLeast(version: string, minimum: string): boolean {
  const left = parseObservedSemver(version)
  const right = parseObservedSemver(minimum)
  if (!left || !right) return false
  for (let i = 0; i < 3; i++) {
    if (left[i] > right[i]) return true
    if (left[i] < right[i]) return false
  }
  return true
}

function parseObservedSemver(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
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
  config: Config,
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
  if (egress) {
    mismatches.push(attested.proxy_identity_ref !== egress.proxyIdentityRef)
    const tlsCheck = verifyFormalPoolAttestedTLSProfile(config, attested, egress)
    if (!tlsCheck.ok) return tlsCheck
  }
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

function verifyFormalPoolAttestedTLSProfile(
  config: Config,
  attested: AttestedFormalPoolContext,
  egress: EgressBucketResolution,
): { ok: true } | { ok: false; status: number; code: string } {
  const mode = tlsProfileMode((config as any).shared_pool)
  if (!mode.enabled) return { ok: true }
  const expected = egress.tlsProfileRef
  const actual = attested.egress_tls_profile_ref
  if (!expected || !actual) {
    return mode.strict
      ? { ok: false, status: 403, code: 'missing_egress_tls_profile_ref' }
      : { ok: true }
  }
  if (!isKnownEnabledTLSProfileRef(config as any, actual)) {
    return { ok: false, status: 403, code: 'unknown_egress_tls_profile_ref' }
  }
  if (actual !== expected) return { ok: false, status: 403, code: 'formal_pool_context_mismatch' }
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
  const binding = formalPoolSessionAuthorityBinding(attested, deviceRef)
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

function formalPoolSessionAuthorityBinding(attested: AttestedFormalPoolContext, deviceRef: string): FormalPoolSessionAuthorityBinding {
  return {
    account_id: attested.account_id,
    credential_ref: attested.credential_ref,
    credential_source: attested.credential_source,
    egress_bucket: attested.egress_bucket,
    proxy_identity_ref: attested.proxy_identity_ref,
    policy_version: attested.policy_version,
    persona_profile: attested.persona_profile,
    trusted_egress_profile_ref: attested.trusted_egress_profile_ref,
    ...(attested.egress_tls_profile_ref ? { egress_tls_profile_ref: attested.egress_tls_profile_ref } : {}),
    env_residue_profile_ref: attested.env_residue_profile_ref,
    locale_profile_ref: attested.locale_profile_ref,
    base_url_residue_profile_ref: attested.base_url_residue_profile_ref,
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
}

function verifyExistingFormalPoolSessionAuthorityBinding(
  config: Config,
  runtimeState: ProxyRuntimeState,
  attested: AttestedFormalPoolContext,
  identity: AccountIdentityRecord,
): { ok: true } | { ok: false; status: number; code: string; message: string } {
  const sessionKey = formalPoolSessionAuthorityRef(config, 'session', attested.session_id)
  const deviceRef = formalPoolSessionAuthorityRef(config, 'device', identity.device_id)
  if (!sessionKey || !deviceRef) return { ok: false, status: 403, code: 'formal_pool_session_ledger_unavailable', message: 'Formal-pool session authority ledger is unavailable' }
  const binding = formalPoolSessionAuthorityBinding(attested, deviceRef)
  let previous = runtimeState.formalPoolSessionAuthorityLedger.get(sessionKey)
  const ledgerFile = formalPoolSessionLedgerFilePath()
  if (ledgerFile) {
    let persisted: FormalPoolSessionAuthorityLedgerFile
    try {
      persisted = loadFormalPoolSessionAuthorityLedger(ledgerFile)
    } catch {
      return { ok: false, status: 403, code: 'formal_pool_session_ledger_unavailable', message: 'Formal-pool session authority ledger is unavailable' }
    }
    previous = persisted.sessions[sessionKey] || previous
    if (previous && !sameFormalPoolSessionAuthorityBinding(previous, binding)) {
      return { ok: false, status: 403, code: 'formal_pool_session_authority_mismatch', message: 'Formal-pool session authority changed across requests' }
    }
    return { ok: true }
  }
  if (previous && !sameFormalPoolSessionAuthorityBinding(previous, binding)) {
    return { ok: false, status: 403, code: 'formal_pool_session_authority_mismatch', message: 'Formal-pool session authority changed across requests' }
  }
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
    && (a.egress_tls_profile_ref || '') === (b.egress_tls_profile_ref || '')
    && a.env_residue_profile_ref === b.env_residue_profile_ref
    && a.locale_profile_ref === b.locale_profile_ref
    && a.base_url_residue_profile_ref === b.base_url_residue_profile_ref
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
