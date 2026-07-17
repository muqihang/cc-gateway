import { closeSync, constants, lstatSync, mkdtempSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { canonicalJson, sha256 } from './harness-core.js'

const REVIEWED_SANDBOX_EXEC = '/usr/bin/sandbox-exec'
const PROFILE = [
  '(version 1)',
  '(allow default)',
  '(deny network*)',
  '(allow network-outbound (remote tcp "localhost:*"))',
  '(allow network-inbound (local tcp "localhost:*"))',
  '',
].join('\n')

export type Phase1LoopbackSandbox = Readonly<{
  adapter: 'macos_sandbox_exec_loopback_v1'
  executable: string
  executable_digest: string
  profile_path: string
  policy_digest: string
}>

export type Phase1SandboxCanaries = Readonly<{
  loopback_socket: 'pass'
  loopback_ipv6_socket: 'pass'
  non_loopback_test_net_socket: 'denied_by_policy'
  policy_bypass_detected: false
}>

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

export function buildPhase1SandboxProfile(): string {
  return PROFILE
}

function regularExecutable(file: string): string {
  let canonical: string
  try { canonical = realpathSync(file) } catch { return fail('network_sandbox_unavailable', 'reviewed sandbox executable is unavailable') }
  if (canonical !== REVIEWED_SANDBOX_EXEC) fail('network_sandbox_unavailable', 'sandbox executable differs from reviewed absolute path')
  const metadata = lstatSync(canonical)
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o111) === 0) fail('network_sandbox_unavailable', 'reviewed sandbox executable is not a regular executable')
  return canonical
}

function writePrivateProfile(root: string): string {
  const directory = mkdtempSync(path.join(root, 'oracle-phase1-sandbox-'))
  const profile = path.join(directory, 'loopback.sb')
  const descriptor = openSync(profile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600)
  try { writeFileSync(descriptor, PROFILE) } finally { closeSync(descriptor) }
  const metadata = lstatSync(profile)
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) fail('network_sandbox_unavailable', 'sandbox profile is not private')
  return profile
}

export function resolvePhase1LoopbackSandbox(options: {
  platform?: NodeJS.Platform
  executable?: string
  temporaryRoot?: string
} = {}): Phase1LoopbackSandbox {
  if ((options.platform ?? process.platform) !== 'darwin') fail('network_sandbox_unavailable', 'only the reviewed macOS sandbox adapter is available')
  const executable = regularExecutable(options.executable ?? REVIEWED_SANDBOX_EXEC)
  const profilePath = writePrivateProfile(options.temporaryRoot ?? os.tmpdir())
  return Object.freeze({
    adapter: 'macos_sandbox_exec_loopback_v1',
    executable,
    executable_digest: sha256(readFileSync(executable)),
    profile_path: profilePath,
    policy_digest: sha256(PROFILE),
  })
}

export function wrapPhase1Command(options: { executable: string; profilePath: string; argv: readonly string[] }): string[] {
  if (options.executable !== REVIEWED_SANDBOX_EXEC || !path.isAbsolute(options.profilePath)
    || options.argv.length === 0 || options.argv.some((part) => typeof part !== 'string' || part.length === 0 || part.includes('\0'))) {
    fail('network_sandbox_unavailable', 'sandbox command wrapper received an invalid boundary')
  }
  return [options.executable, '-f', options.profilePath, ...options.argv]
}

export function runPhase1SandboxCanaries(sandbox: Phase1LoopbackSandbox): Phase1SandboxCanaries {
  if (sandbox.executable !== REVIEWED_SANDBOX_EXEC || sandbox.policy_digest !== sha256(PROFILE)
    || sha256(readFileSync(sandbox.profile_path)) !== sandbox.policy_digest) {
    fail('network_sandbox_unavailable', 'sandbox binding drifted before canaries')
  }
  const source = String.raw`
const net = require('node:net')
const connect = (host, port) => new Promise((resolve, reject) => {
  const socket = net.connect({ host, port })
  socket.setTimeout(1500)
  socket.once('connect', () => { socket.destroy(); resolve('pass') })
  socket.once('error', reject)
  socket.once('timeout', () => { socket.destroy(); reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })) })
})
const loopback = (host) => new Promise((resolve, reject) => {
  const server = net.createServer((socket) => socket.end())
  server.once('error', reject)
  server.listen({ host, port: 0, exclusive: true }, async () => {
    try { await connect(host, server.address().port); resolve('pass') }
    catch (error) { reject(error) }
    finally { server.close() }
  })
})
;(async () => {
  const ipv4 = await loopback('127.0.0.1')
  const ipv6 = await loopback('::1')
  let denied = false
  try { await connect('198.51.100.1', 443) }
  catch (error) { denied = error && (error.code === 'EPERM' || error.code === 'EACCES') }
  if (!denied) throw new Error('TEST-NET was not synchronously denied')
  process.stdout.write(JSON.stringify({ ipv4, ipv6, denied }))
})().catch((error) => { process.stderr.write(String(error.code || error.message)); process.exit(17) })
`
  const observed = spawnSync(sandbox.executable, ['-f', sandbox.profile_path, process.execPath, '-e', source], {
    encoding: 'utf8', shell: false, timeout: 10_000,
    env: { PATH: '/usr/bin:/bin', HOME: '/dev/null', LANG: 'C', LC_ALL: 'C' },
  })
  if (observed.error || observed.signal !== null || observed.status !== 0 || observed.stderr.length !== 0) {
    fail('network_sandbox_unavailable', 'sandbox canary execution failed')
  }
  let parsed: unknown
  try { parsed = JSON.parse(observed.stdout) } catch { return fail('network_sandbox_unavailable', 'sandbox canary output is malformed') }
  if (canonicalJson(parsed) !== canonicalJson({ denied: true, ipv4: 'pass', ipv6: 'pass' })) fail('network_sandbox_unavailable', 'sandbox canary verdict drifted')
  return Object.freeze({
    loopback_socket: 'pass',
    loopback_ipv6_socket: 'pass',
    non_loopback_test_net_socket: 'denied_by_policy',
    policy_bypass_detected: false,
  })
}

export function sandboxBinding(sandbox: Phase1LoopbackSandbox, canaries: Phase1SandboxCanaries): Record<string, unknown> {
  return {
    adapter: sandbox.adapter,
    executable_digest: sandbox.executable_digest,
    policy_digest: sandbox.policy_digest,
    loopback_ipv4: canaries.loopback_socket,
    loopback_ipv6: canaries.loopback_ipv6_socket,
    non_loopback: canaries.non_loopback_test_net_socket,
    policy_bypass_detected: canaries.policy_bypass_detected,
  }
}
