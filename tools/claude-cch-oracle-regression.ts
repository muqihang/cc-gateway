#!/usr/bin/env tsx
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { spawn } from 'child_process'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'
import { computeCCVersionSuffix, runSigningPipeline, verifySignedCCH } from '../src/policy.js'

const DEFAULT_VERSION = '2.1.175'
const BILLING_PREFIX = 'x-anthropic-billing-header:'

const SYNTHETIC_PROMPT_SEEDS = [
  { label: 'sample_a', seed: 1 },
  { label: 'sample_b', seed: 3 },
] as const

export const SYNTHETIC_PROMPTS = SYNTHETIC_PROMPT_SEEDS.map((prompt) => ({
  label: prompt.label,
  text: syntheticPrompt(prompt.seed),
}))

function syntheticPrompt(seed: number): string {
  return Array.from({ length: 24 }, (_, index) => String.fromCharCode(65 + ((index * seed + seed) % 26))).join('')
}

type CapturedRequest = {
  sampleLabel: string
  path: string
  body: Buffer
}

type SafeSampleSummary = {
  label: string
  version: string
  cliExitOk: boolean
  capturedRequestCount: number
  uniqueBillingHeader: boolean
  cchMarkerCount: number
  cchFormat: '5-lower-hex' | 'missing' | 'invalid'
  ccVersionSuffixMatch: boolean
  cchVerifierMatch: boolean
  rawBodyUsedDirectly: true
  parseReserializeForVerification: false
}

type SafeOracleSummary = {
  mode: 'mock' | 'real-cli'
  commandKind: 'mock' | 'pinned-executable' | 'global-claude'
  targetVersion: string
  observedVersion: string
  sampleCount: number
  allCliExitOk: boolean
  allCCVersionSuffixMatch: boolean
  allCCHVerifierMatch: boolean
  allUniqueBillingHeader: boolean
  rawBodyPersisted: false
  rawPromptPersisted: false
  upstream: '127.0.0.1-stub-only'
  samples: SafeSampleSummary[]
}

export function validateSyntheticPrompts(prompts = SYNTHETIC_PROMPTS): void {
  if (prompts.length < 2) throw new Error('at least two synthetic prompts are required')
  for (const prompt of prompts) {
    if (!/^[\x20-\x7e]+$/.test(prompt.text)) throw new Error(`${prompt.label}: prompt must be printable ASCII`)
    if (prompt.text.length < 21) throw new Error(`${prompt.label}: prompt must be at least 21 JS/UTF-16 code units`)
    const chars = [prompt.text[4], prompt.text[7], prompt.text[20]]
    if (new Set(chars).size !== 3) throw new Error(`${prompt.label}: UTF-16 indices 4, 7, and 20 must differ`)
  }
}

export async function runOracleRegression(options: { mode: 'mock' | 'real-cli'; version?: string; useGlobalClaude?: boolean }): Promise<SafeOracleSummary> {
  const version = options.version || DEFAULT_VERSION
  validateSyntheticPrompts()

  const stub = await startStub()
  const samples: SafeSampleSummary[] = []
  let observedVersion = version
  try {
    if (options.mode === 'real-cli') {
      const versionResult = await runClaudeVersion(version, options.useGlobalClaude === true)
      observedVersion = versionResult.trim()
      if (observedVersion !== `${version} (Claude Code)`) {
        throw new Error(`safe version mismatch: expected ${version} (Claude Code), got ${observedVersion || '<empty>'}`)
      }
    }

    for (const prompt of SYNTHETIC_PROMPTS) {
      const startIndex = stub.captured.length
      const cliExitOk = options.mode === 'mock'
        ? await runMockCliSample(stub.url, prompt.label, prompt.text, version)
        : await runRealCliSample(stub.url, prompt.label, prompt.text, version, options.useGlobalClaude === true)
      const captured = stub.captured.slice(startIndex)
      samples.push(analyzeCapturedSample(prompt.label, prompt.text, version, cliExitOk, captured))
    }
  } finally {
    await new Promise<void>((resolveClose) => stub.server.close(() => resolveClose()))
  }

  return {
    mode: options.mode,
    commandKind: options.mode === 'mock' ? 'mock' : options.useGlobalClaude ? 'global-claude' : 'pinned-executable',
    targetVersion: version,
    observedVersion,
    sampleCount: samples.length,
    allCliExitOk: samples.every((sample) => sample.cliExitOk),
    allCCVersionSuffixMatch: samples.every((sample) => sample.ccVersionSuffixMatch),
    allCCHVerifierMatch: samples.every((sample) => sample.cchVerifierMatch),
    allUniqueBillingHeader: samples.every((sample) => sample.uniqueBillingHeader),
    rawBodyPersisted: false,
    rawPromptPersisted: false,
    upstream: '127.0.0.1-stub-only',
    samples,
  }
}

async function startStub(): Promise<{ server: ReturnType<typeof createServer>; url: string; captured: CapturedRequest[] }> {
  const captured: CapturedRequest[] = []
  let activeSampleLabel = 'unknown'
  const server = createServer(async (req, res) => {
    const body = await readRequestBody(req)
    const sampleLabel = req.headers['x-cc-oracle-sample']
    activeSampleLabel = typeof sampleLabel === 'string' ? sampleLabel : activeSampleLabel
    if (req.method === 'POST' && body.length > 0) {
      captured.push({ sampleLabel: activeSampleLabel, path: req.url || '/', body })
    }
    writeStubResponse(req, res, body)
  })
  server.on('connect', (_req, socket) => {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('stub failed to listen on tcp')
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
    const model = typeof parsed.model === 'string' ? parsed.model : 'claude-sonnet-4-6'
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
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
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
      model: typeof parsed.model === 'string' ? parsed.model : 'claude-sonnet-4-6',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
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

async function runMockCliSample(baseUrl: string, sampleLabel: string, prompt: string, version: string): Promise<boolean> {
  const body = Buffer.from(JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 16,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
  }), 'utf-8')
  const config = { env: { version }, shared_pool: { signing_enabled: true, signing_evidence_gates_approved: true } } as any
  const signed = runSigningPipeline(config, body, { cliVersion: version })
  if (!signed.ok) return false
  const response = await fetch(`${baseUrl}/v1/messages?beta=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cc-oracle-sample': sampleLabel },
    body: signed.body,
  })
  await response.arrayBuffer()
  return response.ok
}

async function runClaudeVersion(version: string, useGlobalClaude: boolean): Promise<string> {
  const command = await claudeCommand(version, useGlobalClaude)
  const result = await runCommand(command.cmd, [...command.args, '--version'], undefined, undefined, 30_000)
  if (result.code !== 0) throw new Error('safe claude version command failed')
  return result.stdout.trim()
}

async function runRealCliSample(baseUrl: string, sampleLabel: string, prompt: string, version: string, useGlobalClaude: boolean): Promise<boolean> {
  const command = await claudeCommand(version, useGlobalClaude)
  const env = oracleEnv(baseUrl, sampleLabel)
  const args = [
    ...command.args,
    '--bare',
    '--print',
    '--output-format', 'json',
    '--no-session-persistence',
    '--session-id', randomUUID(),
    '--model', 'claude-sonnet-4-6',
    '--permission-mode', 'bypassPermissions',
  ]
  const result = await runCommand(command.cmd, args, env, prompt, 90_000)
  return result.code === 0
}

async function claudeCommand(version: string, useGlobalClaude: boolean): Promise<{ cmd: string; args: string[] }> {
  if (useGlobalClaude) return { cmd: 'claude', args: [] }
  const resolved = await resolvePinnedClaudeExecutable(version)
  return { cmd: resolved, args: [] }
}

async function resolvePinnedClaudeExecutable(version: string): Promise<string> {
  const result = await runCommand('npm', ['exec', '--yes', '--package', `@anthropic-ai/claude-code@${version}`, '--', 'which', 'claude'], undefined, undefined, 60_000)
  const resolved = result.stdout.trim().split(/\r?\n/).find((line) => line.endsWith('/claude') || line.endsWith('\\claude'))
  if (result.code !== 0 || !resolved) throw new Error('safe pinned claude executable resolution failed')
  return resolved
}

function oracleEnv(baseUrl: string, sampleLabel: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_CUSTOM_HEADERS',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
    'AWS_BEARER_TOKEN_BEDROCK',
    'CLAUDE_CODE_ATTRIBUTION_HEADER',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
  ]) {
    delete env[key]
  }

  const configDir = mkdtempSync(join(tmpdir(), 'cc-gateway-cch-oracle-config-'))
  env.CLAUDE_CONFIG_DIR = configDir
  env.ANTHROPIC_BASE_URL = baseUrl
  env.CLAUDE_CODE_API_BASE_URL = baseUrl
  env.ANTHROPIC_AUTH_TOKEN = 'cc-gateway-oracle-placeholder-token'
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  env.NO_PROXY = '127.0.0.1,localhost,::1'
  env.no_proxy = env.NO_PROXY
  env.HTTP_PROXY = baseUrl
  env.HTTPS_PROXY = baseUrl
  env.ALL_PROXY = baseUrl
  env.http_proxy = baseUrl
  env.https_proxy = baseUrl
  env.all_proxy = baseUrl
  env.TERM = env.TERM || 'xterm-256color'
  env.CC_GATEWAY_CCH_ORACLE_SAMPLE = sampleLabel
  return env
}

function runCommand(cmd: string, args: string[], env: NodeJS.ProcessEnv | undefined, stdin: string | undefined, timeoutMs: number): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
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
      // Intentionally discard stderr; failed CLI diagnostics may echo prompts or paths.
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

function analyzeCapturedSample(sampleLabel: string, prompt: string, version: string, cliExitOk: boolean, captured: CapturedRequest[]): SafeSampleSummary {
  const body = captured.map((item) => item.body).find((candidate) => candidate.includes(Buffer.from(BILLING_PREFIX)))
  if (!body) {
    return {
      label: sampleLabel,
      version,
      cliExitOk,
      capturedRequestCount: captured.length,
      uniqueBillingHeader: false,
      cchMarkerCount: 0,
      cchFormat: 'missing',
      ccVersionSuffixMatch: false,
      cchVerifierMatch: false,
      rawBodyUsedDirectly: true,
      parseReserializeForVerification: false,
    }
  }

  const text = body.toString('utf-8')
  const cchMarkers = text.match(/\bcch=[a-f0-9]{5};/gi) || []
  const billingHeaders = collectBillingHeaderTexts(text)
  const firstBilling = billingHeaders[0] || ''
  const suffix = firstBilling.match(/\bcc_version=(\d+\.\d+\.\d+)\.([a-f0-9]{3});/i)
  const observedCCH = firstBilling.match(/\bcch=([a-f0-9]{5});/i)?.[1]
  const expectedSuffix = computeCCVersionSuffix(prompt, version)
  const verifier = verifySignedCCH(body)

  return {
    label: sampleLabel,
    version,
    cliExitOk,
    capturedRequestCount: captured.length,
    uniqueBillingHeader: billingHeaders.length === 1,
    cchMarkerCount: cchMarkers.length,
    cchFormat: observedCCH ? (/^[a-f0-9]{5}$/.test(observedCCH) ? '5-lower-hex' : 'invalid') : 'missing',
    ccVersionSuffixMatch: suffix?.[1] === version && suffix?.[2] === expectedSuffix,
    cchVerifierMatch: verifier.ok,
    rawBodyUsedDirectly: true,
    parseReserializeForVerification: false,
  }
}

function collectBillingHeaderTexts(text: string): string[] {
  try {
    const parsed = JSON.parse(text)
    const found: string[] = []
    walk(parsed, (value) => {
      if (typeof value === 'string' && value.trimStart().toLowerCase().startsWith(BILLING_PREFIX)) found.push(value)
    })
    return found
  } catch {
    return []
  }
}

function walk(value: unknown, visit: (value: unknown) => void): void {
  visit(value)
  if (Array.isArray(value)) {
    for (const child of value) walk(child, visit)
    return
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) walk(child, visit)
  }
}

async function main(): Promise<void> {
  const version = process.env.CC_GATEWAY_CCH_ORACLE_VERSION || DEFAULT_VERSION
  const selfTest = process.argv.includes('--self-test') || process.env.CC_GATEWAY_CCH_ORACLE_MOCK_CLI === '1'
  const realCli = process.env.CC_GATEWAY_CCH_ORACLE_REAL_CLI === '1'
  const useGlobalClaude = process.env.CC_GATEWAY_CCH_ORACLE_USE_GLOBAL_CLAUDE === '1'
  const allowFutureVersion = process.env.CC_GATEWAY_CCH_ORACLE_ALLOW_FUTURE_VERSION === '1'

  if (!selfTest && !realCli) {
    console.error('Refusing to run real Claude Code oracle without CC_GATEWAY_CCH_ORACLE_REAL_CLI=1. Use --self-test for the local mock harness.')
    process.exit(2)
  }
  if (realCli && version !== DEFAULT_VERSION && !allowFutureVersion) {
    console.error(`Refusing non-${DEFAULT_VERSION} real oracle without CC_GATEWAY_CCH_ORACLE_ALLOW_FUTURE_VERSION=1.`)
    process.exit(2)
  }

  const summary = await runOracleRegression({ mode: selfTest ? 'mock' : 'real-cli', version, useGlobalClaude })
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  if (!summary.allCliExitOk || !summary.allCCVersionSuffixMatch || !summary.allCCHVerifierMatch || !summary.allUniqueBillingHeader) {
    process.exit(1)
  }
}

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
