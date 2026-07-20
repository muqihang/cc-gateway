import { createServer, type Server } from 'node:net'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, stableError } from './core.js'

export type HermeticityProbe = {
  declared_loopback_reachable: boolean
  alternate_loopback_blocked: boolean
  unix_socket_blocked: boolean
  ipv4_external_tcp_blocked: boolean
  ipv6_external_tcp_blocked: boolean
  external_udp_blocked: boolean
  external_socket_budget: number
}

export type HermeticityResult = {
  schema_version: 'oracle-lab-phase3a-hermeticity.v1'
  status: 'PASS' | 'BLOCKED_DYNAMIC_EGRESS_GUARD'
  guard_type: 'sandbox-exec-declared-loopback' | 'not-available'
  profile_sha256: string | null
  probe: HermeticityProbe | null
  stderr_sha256: string | null
  real_cli_executed: false
}

function listen(server: Server, target: number | string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(target, () => { server.off('error', reject); resolve() })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

function childProbe(profile: string, declaredPort: number, alternatePort: number, unixPath: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const script = String.raw`
const net = require('node:net');
const dgram = require('node:dgram');
function tcp(host, port) { return new Promise((resolve) => { const socket = net.createConnection({host, port}); const done=(ok)=>{socket.destroy();resolve(ok)}; socket.setTimeout(700,()=>done(false)); socket.once('connect',()=>done(true)); socket.once('error',()=>done(false)); }); }
function unix(target) { return new Promise((resolve) => { const socket = net.createConnection(target); const done=(ok)=>{socket.destroy();resolve(ok)}; socket.setTimeout(700,()=>done(false)); socket.once('connect',()=>done(true)); socket.once('error',()=>done(false)); }); }
function udp() { return new Promise((resolve) => { const socket=dgram.createSocket('udp4'); let settled=false; const done=(ok)=>{if(settled)return;settled=true;clearTimeout(timer);socket.close();resolve(ok)}; const timer=setTimeout(()=>done(false),700); socket.once('error',()=>done(false)); socket.send(Buffer.from([0]),53,'1.1.1.1',(error)=>done(!error)); }); }
(async()=>{ const declared=await tcp('127.0.0.1',Number(process.argv[1])); const alternate=await tcp('127.0.0.1',Number(process.argv[2])); const unixOk=await unix(process.argv[3]); const ipv4=await tcp('1.1.1.1',443); const ipv6=await tcp('2606:4700:4700::1111',443); const udpOk=await udp(); console.log(JSON.stringify({declared_loopback_reachable:declared,alternate_loopback_blocked:!alternate,unix_socket_blocked:!unixOk,ipv4_external_tcp_blocked:!ipv4,ipv6_external_tcp_blocked:!ipv6,external_udp_blocked:!udpOk,external_socket_budget:Number(ipv4)+Number(ipv6)+Number(udpOk)})); })().catch(()=>process.exit(2));`
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, process.execPath, '-e', script, String(declaredPort), String(alternatePort), unixPath], {
      env: { PATH: '/usr/bin:/bin', HOME: tmpdir(), TMPDIR: tmpdir(), LANG: 'C', LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { if (stdout.length < 64 * 1024) stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { if (stderr.length < 64 * 1024) stderr += chunk.toString('utf8') })
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }) })
    child.on('error', (error) => { clearTimeout(timer); resolve({ status: null, stdout, stderr: String(error.message) }) })
  })
}

export function evaluateHermeticity(probe: HermeticityProbe | null, profileSha256: string | null, stderrSha256: string | null): HermeticityResult {
  const passed = probe !== null
    && probe.declared_loopback_reachable
    && probe.alternate_loopback_blocked
    && probe.unix_socket_blocked
    && probe.ipv4_external_tcp_blocked
    && probe.ipv6_external_tcp_blocked
    && probe.external_udp_blocked
    && probe.external_socket_budget === 0
  return {
    schema_version: 'oracle-lab-phase3a-hermeticity.v1',
    status: passed ? 'PASS' : 'BLOCKED_DYNAMIC_EGRESS_GUARD',
    guard_type: profileSha256 ? 'sandbox-exec-declared-loopback' : 'not-available',
    profile_sha256: profileSha256,
    probe,
    stderr_sha256: stderrSha256,
    real_cli_executed: false,
  }
}

export async function runHermeticitySelfTest(): Promise<HermeticityResult> {
  if (process.platform !== 'darwin') return evaluateHermeticity(null, null, null)
  const respond = (value: string) => (socket: import('node:net').Socket) => {
    socket.on('error', () => {})
    socket.end(value)
  }
  const declared = createServer(respond('ok'))
  const alternate = createServer(respond('alternate'))
  const unix = createServer(respond('unix'))
  const socketRoot = mkdtempSync(path.join(tmpdir(), 'phase3a-hermeticity-'))
  const unixPath = path.join(socketRoot, 'control.sock')
  try {
    await listen(declared, 0)
    await listen(alternate, 0)
    await listen(unix, unixPath)
    const declaredAddress = declared.address()
    const alternateAddress = alternate.address()
    if (!declaredAddress || typeof declaredAddress === 'string' || !alternateAddress || typeof alternateAddress === 'string') {
      return evaluateHermeticity(null, null, null)
    }
    const profile = `(version 1) (deny network*) (allow default) (allow network-outbound (remote tcp "localhost:${declaredAddress.port}"))`
    const profileSha256 = sha256Bytes(profile)
    const child = await childProbe(profile, declaredAddress.port, alternateAddress.port, unixPath)
    let probe: HermeticityProbe | null = null
    if (child.status === 0) {
      try { probe = JSON.parse(child.stdout.trim()) as HermeticityProbe } catch { probe = null }
    }
    return evaluateHermeticity(probe, profileSha256, sha256Bytes(child.stderr))
  } finally {
    await Promise.all([close(declared), close(alternate), close(unix)])
  }
}

export async function writeHermeticity(evidenceRootInput: string): Promise<HermeticityResult> {
  const evidenceRoot = ensureEvidenceRoot(evidenceRootInput)
  const result = await runHermeticitySelfTest()
  const output = assertEvidencePath(evidenceRoot, path.join(evidenceRoot, 'guards', 'hermeticity.json'))
  mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 })
  writeFileSync(output, `${canonicalJson(result)}\n`, { flag: 'wx', mode: 0o600 })
  if (result.status !== 'PASS') throw new Phase3AError('isolation_unavailable', 'same-scope loopback/external socket guard did not pass')
  return result
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = argument('--evidence-root')
  if (!root) {
    console.error(canonicalJson(stableError(new Phase3AError('hermeticity_usage', '--evidence-root is required'))))
    process.exitCode = 1
  } else {
    writeHermeticity(root).then((result) => console.log(canonicalJson(result))).catch((error) => {
      console.error(canonicalJson(stableError(error)))
      process.exitCode = 1
    })
  }
}
