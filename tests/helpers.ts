import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { request as httpRequest } from 'http'
import type { AddressInfo } from 'net'
import type { Config } from '../src/config.js'

let passed = 0
let failed = 0
let chain = Promise.resolve()

export function test(name: string, fn: () => void | Promise<void>) {
  chain = chain
    .then(fn)
    .then(() => {
      passed++
      console.log(`  ✓ ${name}`)
    })
    .catch((err) => {
      failed++
      console.log(`  ✗ ${name}`)
      console.log(`    ${err instanceof Error ? err.stack || err.message : err}`)
    })
}

export async function finish() {
  await chain
  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
}

export const validDeviceId = 'a'.repeat(64)

export function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    server: { port: 0, tls: { cert: '', key: '' } },
    upstream: { url: 'https://api.anthropic.com' },
    providers: { anthropic: true },
    auth: { tokens: [{ name: 'client', token: 'client-token' }] },
    oauth: { access_token: 'gateway-token', refresh_token: 'refresh-token', expires_at: Date.now() + 3600_000 },
    identity: {
      device_id: validDeviceId,
      email: 'canonical@example.com',
    },
    env: {
      platform: 'darwin',
      platform_raw: 'darwin',
      arch: 'arm64',
      node_version: 'v24.3.0',
      terminal: 'iTerm2.app',
      package_managers: 'npm,pnpm',
      runtimes: 'node',
      is_running_with_bun: false,
      is_ci: false,
      is_claude_ai_auth: true,
      version: '2.1.119',
      version_base: '2.1.119',
      build_time: '2026-04-23T19:08:52Z',
      deployment_environment: 'unknown-darwin',
      vcs: 'git',
    },
    prompt_env: {
      platform: 'darwin',
      shell: 'zsh',
      os_version: 'Darwin 24.4.0',
      working_dir: '/Users/jack/projects',
    },
    process: {
      constrained_memory: 34359738368,
      rss_range: [300000000, 500000000],
      heap_total_range: [40000000, 80000000],
      heap_used_range: [100000000, 200000000],
    },
    logging: { level: 'error', audit: false },
    ...overrides,
  } as Config
}

export function writeConfigYaml(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-gateway-test-'))
  const file = join(dir, 'config.yaml')
  writeFileSync(file, yaml)
  return file
}

export function configYaml(extra = ''): string {
  return `
server:
  port: 0
  tls:
    cert: ""
    key: ""
upstream:
  url: "https://api.anthropic.com"
providers:
  anthropic: true
auth:
  tokens:
    - name: client
      token: client-token
oauth:
  refresh_token: refresh-token
identity:
  device_id: "${validDeviceId}"
  email: "canonical@example.com"
env:
  platform: darwin
  version: "2.1.119"
  version_base: "2.1.119"
  build_time: "2026-04-23T19:08:52Z"
prompt_env:
  platform: darwin
  shell: zsh
  os_version: "Darwin 24.4.0"
  working_dir: "/Users/jack/projects"
process:
  constrained_memory: 34359738368
  rss_range: [300000000, 500000000]
  heap_total_range: [40000000, 80000000]
  heap_used_range: [100000000, 200000000]
logging:
  level: error
  audit: false
${extra}
`
}

export type CapturedRequest = {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  body: string
}

export async function startFakeUpstream(handler?: (req: IncomingMessage, res: ServerResponse, body: string) => void) {
  const captured: CapturedRequest[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8')
      captured.push({
        method: req.method || 'GET',
        url: req.url || '/',
        headers: req.headers,
        body,
      })
      if (handler) {
        handler(req, res, body)
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
  })
  await listen(server)
  const { port } = server.address() as AddressInfo
  return { server, captured, url: `http://127.0.0.1:${port}` }
}

export function listen(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (server.listening) {
      resolve()
      return
    }
    server.listen(0, '127.0.0.1', () => resolve())
  })
}

export function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve())
  })
}

export async function httpJson(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
) {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body)
  return new Promise<{ status: number; headers: IncomingMessage['headers']; body: string; json: any }>((resolve, reject) => {
    const req = httpRequest(url, {
      method: options.method || (body ? 'POST' : 'GET'),
      headers: {
        ...(body ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } : {}),
        ...options.headers,
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf-8')
        let json: any = null
        try {
          json = JSON.parse(responseBody)
        } catch {
          // ignored
        }
        resolve({ status: res.statusCode || 0, headers: res.headers, body: responseBody, json })
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

export function serverUrl(server: Server, path: string): string {
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}${path}`
}
