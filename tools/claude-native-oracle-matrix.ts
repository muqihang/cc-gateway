#!/usr/bin/env tsx
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'
import { computeCCVersionSuffix, runSigningPipeline, verifySignedCCH } from '../src/policy.js'

const DEFAULT_VERSION = '2.1.179'
const MODEL = 'claude-sonnet-4-6'
const BILLING_PREFIX = 'x-anthropic-billing-header:'

type OracleMode = 'mock' | 'real-cli'
type InvocationMode = 'custom-base' | 'first-party-assumed'
type BillingShape = 'absent' | 'no_cch' | 'cch_present'
type CCEntrypointBucket = 'cli' | 'sdk-cli' | 'other' | 'absent'

type CapturedRequest = {
  profile: InvocationMode
  variant: string
  method: string
  route: string
  headers: IncomingMessage['headers']
  body: Buffer
}

type SampleSummary = {
  variant: string
  method: string
  route: string
  route_class: 'messages' | 'count_tokens' | 'control_plane' | 'unknown'
  observed_streaming: boolean | null
  anthropic_beta_tokens: string[]
  request_id_header_family_presence: Record<string, boolean>
  top_level_body_keys: string[]
  system_summary: {
    block_count: number
    block_type_counts: Record<string, number>
    cache_control_block_count: number
  }
  messages_summary: {
    message_count: number
    role_counts: Record<string, number>
    content_block_types: string[]
  }
  tool_summary: {
    tool_count: number
    feature_flags: Record<'eager_input_streaming' | 'defer_loading' | 'tool_reference', boolean>
  }
  shape_presence: Record<'thinking' | 'output_config' | 'context_management' | 'diagnostics', boolean>
  billing_block_count: number
  billing_shape: BillingShape
  cc_entrypoint_bucket: CCEntrypointBucket
  cch_verifier_ok: boolean | null
  cache_control_summary: {
    total_occurrences: number
    in_system: boolean
    in_messages: boolean
    in_tools: boolean
    top_level: boolean
  }
  response_cache_counter_summary: {
    available: false
  }
}

type ProfileSummary = {
  profile_ref: 'claude_code_2_1_179_custom_base' | 'claude_code_2_1_179_first_party_assumed'
  cli_version_bucket: string
  invocation_mode: InvocationMode
  command_kind: 'mock' | 'pinned-temp-runtime'
  observed_version: string
  samples: SampleSummary[]
  degraded_scope: string[]
}

export type NativeOracleMatrix = {
  schema_version: 'claude_native_oracle_matrix.v1'
  target_cli_version: string
  generated_at: string
  mode: OracleMode
  upstream: '127.0.0.1-stub-only'
  real_anthropic_upstream: false
  raw_body_persisted: false
  raw_prompt_persisted: false
  raw_response_persisted: false
  raw_cch_persisted: false
  profiles: ProfileSummary[]
  matrix_degraded_scope: string[]
}

type MatrixOptions = {
  mode: OracleMode
  version?: string
  runtimeRoot?: string
}

const VARIANTS = [
  { name: 'messages_non_streaming', outputFormat: 'json', prompt: 'Local oracle non streaming sample. Answer OK.' },
  { name: 'messages_streaming', outputFormat: 'stream-json', prompt: 'Local oracle streaming sample. Answer OK.' },
  { name: 'messages_with_tools', outputFormat: 'json', prompt: 'Local oracle tool shaped sample. Answer OK.' },
] as const

export async function runNativeOracleMatrix(options: MatrixOptions): Promise<NativeOracleMatrix> {
  const version = options.version || DEFAULT_VERSION
  const profiles: ProfileSummary[] = []
  const matrixDegradedScope: string[] = []
  for (const invocationMode of ['custom-base', 'first-party-assumed'] as const) {
    const profile = options.mode === 'mock'
      ? await runMockProfile(version, invocationMode)
      : await runRealProfile(version, invocationMode, options.runtimeRoot)
    profiles.push(profile)
    matrixDegradedScope.push(...profile.degraded_scope.map((item) => `${profile.profile_ref}:${item}`))
  }

  return {
    schema_version: 'claude_native_oracle_matrix.v1',
    target_cli_version: version,
    generated_at: new Date().toISOString(),
    mode: options.mode,
    upstream: '127.0.0.1-stub-only',
    real_anthropic_upstream: false,
    raw_body_persisted: false,
    raw_prompt_persisted: false,
    raw_response_persisted: false,
    raw_cch_persisted: false,
    profiles,
    matrix_degraded_scope: Array.from(new Set(matrixDegradedScope)).sort(),
  }
}

async function runMockProfile(version: string, invocationMode: InvocationMode): Promise<ProfileSummary> {
  const samples = VARIANTS.map((variant) => {
    const body = mockBody(version, invocationMode, variant.name, variant.name === 'messages_streaming')
    return summarizeRequest({
      profile: invocationMode,
      variant: variant.name,
      method: 'POST',
      route: '/v1/messages?beta=true',
      headers: {
        'anthropic-beta': invocationMode === 'first-party-assumed'
          ? 'claude-code-20250219,advanced-tool-use-2025-11-20,cache-diagnosis-2026-04-07'
          : 'claude-code-20250219,prompt-caching-scope-2026-01-05',
        'request-id': 'req_safe_mock',
      },
      body,
    })
  })
  return {
    profile_ref: profileRef(invocationMode),
    cli_version_bucket: version,
    invocation_mode: invocationMode,
    command_kind: 'mock',
    observed_version: `${version} (mock)`,
    samples,
    degraded_scope: [],
  }
}

async function runRealProfile(version: string, invocationMode: InvocationMode, runtimeRoot?: string): Promise<ProfileSummary> {
  const stub = await startStub()
  const captured: CapturedRequest[] = []
  let observedVersion = ''
  const degraded = new Set<string>()
  try {
    const command = await resolvePinnedClaudeExecutable(version, runtimeRoot)
    const versionResult = await runCommand(command, ['--version'], undefined, undefined, undefined, 30_000)
    observedVersion = versionResult.stdout.trim()
    if (versionResult.code !== 0 || observedVersion !== `${version} (Claude Code)`) {
      degraded.add('version_command_mismatch')
    }

    for (const variant of VARIANTS) {
      const before = stub.captured.length
      const env = oracleEnv(stub.url, invocationMode, variant.name)
      const cwd = mkdtempSync(join(tmpdir(), 'cc-native-oracle-cwd-'))
      const args = buildClaudePrintArgs(variant.outputFormat)
      const result = await runCommand(command, args, env, variant.prompt, cwd, 120_000)
      if (result.code !== 0) degraded.add(`${variant.name}_cli_exit_nonzero`)
      for (const request of stub.captured.slice(before)) {
        captured.push({ ...request, profile: invocationMode, variant: variant.name })
      }
      if (stub.captured.length === before) degraded.add(`${variant.name}_no_request_captured`)
    }
  } finally {
    await new Promise<void>((resolveClose) => stub.server.close(() => resolveClose()))
  }

  const samples: SampleSummary[] = []
  for (const variant of VARIANTS) {
    const candidates = captured.filter((request) => request.variant === variant.name && routeClass(request.route) === 'messages')
    const selected = candidates.find((request) => request.body.length > 0) || candidates[0]
    if (!selected) {
      degraded.add(`${variant.name}_missing_messages_request`)
      continue
    }
    samples.push(summarizeRequest(selected))
  }

  if (!samples.some((sample) => sample.observed_streaming === true)) degraded.add('streaming_messages_not_observed')
  if (!samples.some((sample) => sample.observed_streaming === false)) degraded.add('non_streaming_messages_not_observed')
  if (!samples.some((sample) => sample.tool_summary.tool_count > 0)) degraded.add('tool_shaped_request_not_observed')

  return {
    profile_ref: profileRef(invocationMode),
    cli_version_bucket: version,
    invocation_mode: invocationMode,
    command_kind: 'pinned-temp-runtime',
    observed_version: observedVersion || 'unknown',
    samples,
    degraded_scope: Array.from(degraded).sort(),
  }
}

export function buildClaudePrintArgs(outputFormat: 'json' | 'stream-json'): string[] {
  const args = [
    '--bare',
    '--print',
    '--output-format', outputFormat,
    '--no-session-persistence',
    '--session-id', randomUUID(),
    '--model', MODEL,
    '--permission-mode', 'bypassPermissions',
  ]
  if (outputFormat === 'stream-json') args.push('--verbose')
  return args
}

function mockBody(version: string, invocationMode: InvocationMode, variant: string, stream: boolean): Buffer {
  const prompt = 'Local oracle synthetic prompt for safe matrix only.'
  const body: any = {
    model: MODEL,
    max_tokens: 32,
    stream,
    system: [
      { type: 'text', text: 'Safe oracle system block.', cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    output_config: { effort: 'medium' },
  }
  if (variant === 'messages_with_tools') {
    body.tools = [{
      name: 'SafeEcho',
      description: 'Synthetic safe echo tool.',
      input_schema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      eager_input_streaming: invocationMode === 'first-party-assumed',
    }]
  }
  if (invocationMode === 'custom-base') {
    const suffix = computeCCVersionSuffix(prompt, version)
    body.system.unshift({ type: 'text', text: `${BILLING_PREFIX} cc_version=${version}.${suffix}; cc_entrypoint=sdk-cli;` })
    return Buffer.from(JSON.stringify(body), 'utf-8')
  }
  const config = {
    env: { version },
    shared_pool: {
      signing_enabled: true,
      signing_evidence_gates_approved: true,
      signed_cch_2179_oracle_profile_approved: true,
      signed_cch_2179_oracle_profile_ref: 'claude_code_2_1_179_first_party_signed_cch_oracle_cp1_degraded_v1',
    },
  } as any
  const signed = runSigningPipeline(config, Buffer.from(JSON.stringify(body), 'utf-8'), { cliVersion: version })
  if (!signed.ok) throw new Error(`mock signing failed: ${signed.code}`)
  return signed.body
}

async function startStub(): Promise<{ server: ReturnType<typeof createServer>; url: string; captured: Array<Omit<CapturedRequest, 'profile' | 'variant'>> }> {
  const captured: Array<Omit<CapturedRequest, 'profile' | 'variant'>> = []
  const server = createServer(async (req, res) => {
    const body = await readRequestBody(req)
    if (req.method === 'POST' && body.length > 0) {
      captured.push({ method: req.method, route: req.url || '/', headers: req.headers, body })
    }
    writeStubResponse(req, res, body)
  })
  server.on('connect', (_req, socket) => {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('oracle stub failed to listen')
  return { server, url: `http://127.0.0.1:${address.port}`, captured }
}

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveRead, rejectRead) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => resolveRead(Buffer.concat(chunks)))
    req.on('error', rejectRead)
  })
}

function writeStubResponse(req: IncomingMessage, res: ServerResponse, body: Buffer): void {
  let parsed: any = {}
  try {
    parsed = body.length > 0 ? JSON.parse(body.toString('utf-8')) : {}
  } catch {
    parsed = {}
  }

  if ((req.url || '').includes('/v1/messages/count_tokens')) {
    writeJson(res, 200, { input_tokens: 1 })
    return
  }

  if ((req.url || '').includes('/v1/messages') && parsed?.stream === true) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'request-id': 'req_oracle_stub',
    })
    writeSSE(res, 'message_start', {
      type: 'message_start',
      message: {
        id: 'msg_oracle_stub',
        type: 'message',
        role: 'assistant',
        model: typeof parsed.model === 'string' ? parsed.model : MODEL,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    })
    writeSSE(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    writeSSE(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } })
    writeSSE(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
    writeSSE(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
    writeSSE(res, 'message_stop', { type: 'message_stop' })
    res.end()
    return
  }

  if ((req.url || '').includes('/v1/messages')) {
    writeJson(res, 200, {
      id: 'msg_oracle_stub',
      type: 'message',
      role: 'assistant',
      model: typeof parsed.model === 'string' ? parsed.model : MODEL,
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })
    return
  }

  writeJson(res, 200, { ok: true })
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'request-id': 'req_oracle_stub' })
  res.end(JSON.stringify(body))
}

function writeSSE(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function summarizeRequest(request: CapturedRequest): SampleSummary {
  let parsed: any = {}
  try {
    parsed = JSON.parse(request.body.toString('utf-8'))
  } catch {
    parsed = {}
  }
  const billingHeaders = collectBillingHeaderTexts(parsed)
  const billingShape = billingHeaders.length === 0
    ? 'absent'
    : billingHeaders.some((header) => /\bcch=[a-f0-9]{5};/i.test(header)) ? 'cch_present' : 'no_cch'
  const entrypoint = billingHeaders.map((header) => header.match(/\bcc_entrypoint=([^;]+);/i)?.[1]).find(Boolean)
  const cchVerifier = billingShape === 'cch_present' ? verifySignedCCH(request.body).ok : null

  return {
    variant: request.variant,
    method: request.method,
    route: safeRoute(request.route),
    route_class: routeClass(request.route),
    observed_streaming: typeof parsed?.stream === 'boolean' ? parsed.stream : null,
    anthropic_beta_tokens: betaTokens(request.headers),
    request_id_header_family_presence: requestIdHeaderFamilies(request.headers),
    top_level_body_keys: objectKeys(parsed),
    system_summary: summarizeSystem(parsed?.system),
    messages_summary: summarizeMessages(parsed?.messages),
    tool_summary: summarizeTools(parsed?.tools),
    shape_presence: {
      thinking: Object.prototype.hasOwnProperty.call(parsed || {}, 'thinking'),
      output_config: Object.prototype.hasOwnProperty.call(parsed || {}, 'output_config'),
      context_management: Object.prototype.hasOwnProperty.call(parsed || {}, 'context_management'),
      diagnostics: Object.prototype.hasOwnProperty.call(parsed || {}, 'diagnostics'),
    },
    billing_block_count: billingHeaders.length,
    billing_shape: billingShape,
    cc_entrypoint_bucket: entrypointBucket(entrypoint),
    cch_verifier_ok: cchVerifier,
    cache_control_summary: summarizeCacheControl(parsed),
    response_cache_counter_summary: { available: false },
  }
}

function collectBillingHeaderTexts(value: unknown): string[] {
  const found: string[] = []
  walk(value, (child) => {
    if (typeof child === 'string' && child.trimStart().toLowerCase().startsWith(BILLING_PREFIX)) found.push(child)
  })
  return found
}

function walk(value: unknown, visit: (value: unknown, path: Array<string | number>) => void, path: Array<string | number> = []): void {
  visit(value, path)
  if (Array.isArray(value)) {
    value.forEach((child, index) => walk(child, visit, [...path, index]))
    return
  }
  if (value && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => walk(child, visit, [...path, key]))
  }
}

function objectKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.keys(value as Record<string, unknown>).sort()
}

function summarizeSystem(system: unknown): SampleSummary['system_summary'] {
  const blocks = Array.isArray(system) ? system : typeof system === 'string' ? [system] : []
  const blockTypeCounts: Record<string, number> = {}
  let cacheControlBlockCount = 0
  for (const block of blocks) {
    const type = typeof block === 'string' ? 'string' : String((block as any)?.type || 'object')
    blockTypeCounts[type] = (blockTypeCounts[type] || 0) + 1
    if (block && typeof block === 'object' && Object.prototype.hasOwnProperty.call(block, 'cache_control')) cacheControlBlockCount++
  }
  return { block_count: blocks.length, block_type_counts: blockTypeCounts, cache_control_block_count: cacheControlBlockCount }
}

function summarizeMessages(messages: unknown): SampleSummary['messages_summary'] {
  const roleCounts: Record<string, number> = {}
  const blockTypes = new Set<string>()
  if (!Array.isArray(messages)) return { message_count: 0, role_counts: {}, content_block_types: [] }
  for (const message of messages) {
    const role = String((message as any)?.role || 'unknown')
    roleCounts[role] = (roleCounts[role] || 0) + 1
    const content = (message as any)?.content
    if (typeof content === 'string') blockTypes.add('string')
    if (Array.isArray(content)) {
      for (const block of content) blockTypes.add(String(block?.type || 'unknown'))
    }
  }
  return { message_count: messages.length, role_counts: roleCounts, content_block_types: Array.from(blockTypes).sort() }
}

function summarizeTools(tools: unknown): SampleSummary['tool_summary'] {
  const serialized = JSON.stringify(tools || [])
  return {
    tool_count: Array.isArray(tools) ? tools.length : 0,
    feature_flags: {
      eager_input_streaming: /"eager_input_streaming"/.test(serialized),
      defer_loading: /"defer_loading"/.test(serialized),
      tool_reference: /"tool_reference"/.test(serialized),
    },
  }
}

function summarizeCacheControl(parsed: unknown): SampleSummary['cache_control_summary'] {
  let total = 0
  let inSystem = false
  let inMessages = false
  let inTools = false
  let topLevel = false
  walk(parsed, (_value, path) => {
    if (path[path.length - 1] !== 'cache_control') return
    total++
    if (path[0] === 'system') inSystem = true
    if (path[0] === 'messages') inMessages = true
    if (path[0] === 'tools') inTools = true
    if (path.length === 1) topLevel = true
  })
  return { total_occurrences: total, in_system: inSystem, in_messages: inMessages, in_tools: inTools, top_level: topLevel }
}

function betaTokens(headers: IncomingMessage['headers']): string[] {
  const raw = headers['anthropic-beta']
  const values = Array.isArray(raw) ? raw : raw ? [raw] : []
  return Array.from(new Set(values.flatMap((value) => String(value).split(',').map((item) => item.trim()).filter(Boolean)))).sort()
}

function requestIdHeaderFamilies(headers: IncomingMessage['headers']): Record<string, boolean> {
  const names = Object.keys(headers).map((name) => name.toLowerCase())
  return {
    request_id: names.includes('request-id'),
    x_request_id: names.includes('x-request-id'),
    anthropic_request_id: names.includes('anthropic-request-id'),
  }
}

function routeClass(route: string): SampleSummary['route_class'] {
  const path = safeRoute(route)
  if (path.startsWith('/v1/messages/count_tokens')) return 'count_tokens'
  if (path.startsWith('/v1/messages')) return 'messages'
  if (path.startsWith('/api/') || path.startsWith('/v1/')) return 'control_plane'
  return 'unknown'
}

function safeRoute(route: string): string {
  try {
    const parsed = new URL(route, 'http://127.0.0.1')
    return parsed.pathname + (parsed.search ? '?<query>' : '')
  } catch {
    return route.split('?')[0] || '/'
  }
}

function entrypointBucket(entrypoint: string | undefined): CCEntrypointBucket {
  if (!entrypoint) return 'absent'
  if (entrypoint === 'cli') return 'cli'
  if (entrypoint === 'sdk-cli') return 'sdk-cli'
  return 'other'
}

function profileRef(invocationMode: InvocationMode): ProfileSummary['profile_ref'] {
  return invocationMode === 'custom-base'
    ? 'claude_code_2_1_179_custom_base'
    : 'claude_code_2_1_179_first_party_assumed'
}

export async function resolvePinnedClaudeExecutable(version: string, runtimeRoot?: string): Promise<string> {
  if (runtimeRoot) {
    if (isExistingFile(runtimeRoot)) {
      const versionResult = await runCommand(runtimeRoot, ['--version'], minimalEnv(), undefined, undefined, 30_000)
      if (versionResult.code !== 0 || versionResult.stdout.trim() !== `${version} (Claude Code)`) {
        throw new Error('safe direct Claude Code executable version mismatch')
      }
      return runtimeRoot
    }
    mkdirSync(runtimeRoot, { recursive: true })
    const existing = existingRuntimeBinary(runtimeRoot, version)
    if (existing) return existing
    const install = await runCommand('npm', ['install', '--prefix', runtimeRoot, '--no-save', '--silent', `@anthropic-ai/claude-code@${version}`], minimalEnv(), undefined, undefined, 180_000)
    if (install.code !== 0) throw new Error('safe pinned Claude Code temp install failed')
    const installed = existingRuntimeBinary(runtimeRoot, version) || join(runtimeRoot, 'node_modules', '.bin', 'claude')
    if (!existsSync(installed)) throw new Error('safe pinned Claude Code executable missing after install')
    return installed
  }
  const result = await runCommand('npm', ['exec', '--yes', '--package', `@anthropic-ai/claude-code@${version}`, '--', 'which', 'claude'], minimalEnv(), undefined, undefined, 120_000)
  const resolved = result.stdout.trim().split(/\r?\n/).find((line) => line.endsWith('/claude') || line.endsWith('\\claude'))
  if (result.code !== 0 || !resolved) throw new Error('safe pinned Claude Code executable resolution failed')
  return resolved
}

function isExistingFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function existingRuntimeBinary(runtimeRoot: string, version: string): string | null {
  const packageJson = join(runtimeRoot, 'node_modules', '@anthropic-ai', 'claude-code', 'package.json')
  if (!existsSync(packageJson)) return null
  try {
    const parsed = JSON.parse(readFileSync(packageJson, 'utf-8'))
    if (String(parsed.version) !== version) return null
  } catch {
    return null
  }
  const platformBinaries = [
    join(runtimeRoot, 'node_modules', '@anthropic-ai', 'claude-code-darwin-arm64', 'claude'),
    join(runtimeRoot, 'node_modules', '.bin', 'claude'),
  ]
  return platformBinaries.find((candidate) => existsSync(candidate)) || null
}

function oracleEnv(baseUrl: string, invocationMode: InvocationMode, variant: string): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(tmpdir(), 'cc-native-oracle-home-'))
  const configDir = mkdtempSync(join(tmpdir(), 'cc-native-oracle-config-'))
  const env = minimalEnv()
  env.HOME = home
  env.CLAUDE_CONFIG_DIR = configDir
  env.ANTHROPIC_BASE_URL = baseUrl
  env.CLAUDE_CODE_API_BASE_URL = baseUrl
  env.ANTHROPIC_AUTH_TOKEN = 'cc-gateway-oracle-placeholder-token'
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  env.CLAUDE_CODE_ATTRIBUTION_HEADER = 'true'
  env.NO_PROXY = '127.0.0.1,localhost,::1'
  env.no_proxy = env.NO_PROXY
  env.HTTP_PROXY = baseUrl
  env.HTTPS_PROXY = baseUrl
  env.ALL_PROXY = baseUrl
  env.http_proxy = baseUrl
  env.https_proxy = baseUrl
  env.all_proxy = baseUrl
  env.CC_GATEWAY_NATIVE_ORACLE_VARIANT = variant
  if (invocationMode === 'first-party-assumed') env._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL = '1'
  return env
}

function minimalEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
    TMPDIR: process.env.TMPDIR || tmpdir(),
    TERM: process.env.TERM || 'xterm-256color',
    LANG: process.env.LANG || 'C.UTF-8',
  }
}

function runCommand(cmd: string, args: string[], env: NodeJS.ProcessEnv | undefined, stdin: string | undefined, cwd: string | undefined, timeoutMs: number): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let settled = false
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      if (!settled) {
        settled = true
        resolveRun({ code: null, stdout })
      }
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf-8')
    })
    child.stderr.on('data', () => {
      // Intentionally discard stderr; CLI diagnostics can echo prompt or environment details.
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        resolveRun({ code, stdout })
      }
    })
    if (stdin !== undefined) child.stdin.end(stdin)
    else child.stdin.end()
  })
}

async function main(): Promise<void> {
  const version = process.env.CC_GATEWAY_NATIVE_ORACLE_VERSION || DEFAULT_VERSION
  const realCli = process.env.CC_GATEWAY_NATIVE_ORACLE_REAL_CLI === '1'
  const mode: OracleMode = realCli ? 'real-cli' : 'mock'
  const runtimeRoot = process.env.CC_GATEWAY_NATIVE_ORACLE_RUNTIME_ROOT
  const output = process.env.CC_GATEWAY_NATIVE_ORACLE_OUTPUT
  const matrix = await runNativeOracleMatrix({ mode, version, runtimeRoot })
  const text = `${JSON.stringify(matrix, null, 2)}\n`
  if (output) {
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, text, { encoding: 'utf-8', mode: 0o600 })
  }
  process.stdout.write(text)
  if (mode === 'real-cli') {
    const hasRequiredMinimum = matrix.profiles.every((profile) => {
      const variants = new Set(profile.samples.map((sample) => sample.variant))
      return variants.has('messages_streaming') && variants.has('messages_non_streaming') && variants.has('messages_with_tools')
    })
    if (!hasRequiredMinimum) process.exit(1)
  }
}

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
