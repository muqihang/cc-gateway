import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { constants as fsConstants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File } from './core.js'
import { assertControlForInstrumentation, buildIsolatedEnvironment, loadLaunchManifest, type Instrumentation, type LaunchManifest, validateLaunchManifest } from './launch-manifest.js'
import { enforceProcessLimits, sampleProcessTree, sampleSocketCount, type ProcessSample } from './process-sampler.js'
import { classifySafeDiagnosticText, type SafeDiagnostic } from './safe-diagnostic.js'

export type GuardAuthority = {
  schema_version: 'oracle-lab-phase3a-cell-guard.v1'
  status: 'PASS'
  profile_sha256: string
  manifest_sha256: string
  allowed_loopback_ports: number[]
  external_socket_budget: 0
  same_scope_probe: true
  probe: {
    declared_loopback_reachable: boolean
    alternate_loopback_blocked: boolean
    unix_socket_blocked: boolean
    ipv4_external_tcp_blocked: boolean
    ipv6_external_tcp_blocked: boolean
    external_udp_blocked: boolean
    inside_root_write_allowed: boolean
    outside_root_write_blocked: boolean
  }
}

export type CellResult = {
  schema_version: 'oracle-lab-phase3a-cell-result.v1'
  run_id: string
  command_digest: string
  status: 'complete' | 'failed' | 'timeout' | 'resource-limit' | 'spawn-error'
  exit_code: number | null
  signal: NodeJS.Signals | null
  duration_ms: number
  termination_reason: string | null
  stdout: { bytes: number; sha256: string; truncated: boolean }
  stderr: { bytes: number; sha256: string; truncated: boolean }
  process_samples: ProcessSample[]
  max_processes: number
  max_sockets: number | null
  retry_events: number
  hook_event_count: number
  safe_diagnostic: SafeDiagnostic
  safe_error_categories: string[]
  safe_error_terms: string[]
  stderr_fingerprint: SafeTextFingerprint
  raw_output_persisted: false
}

export type SafeTextFingerprint = {
  byte_length: number
  utf8_valid: boolean
  line_count: number
  ascii_printable_bytes: number
  whitespace_bytes: number
  control_bytes: number
  non_ascii_bytes: number
  ansi_sequence_count: number
  normalized_sha256: string
  tokens: Array<{ byte_length: number; sha256: string }>
  truncated: boolean
}

export type RunCellOptions = {
  manifest: LaunchManifest
  control_manifest?: LaunchManifest | null
  evidence_root: string
  executable: string
  instrumentation: Instrumentation
  guard: GuardAuthority
  stdin?: Uint8Array
  sample_interval_ms?: number
  trusted_local_ca?: { cert_path: string; sha256: string }
}

/** Persist only a digest of the validated command descriptor with the cell result. */
export function cellCommandDigest(manifest: Pick<LaunchManifest, 'command'>): string {
  return sha256Bytes(canonicalJson(manifest.command))
}

export function evaluateCellCounters(counters: { output_bytes: number; processes: number; retries: number; sockets: number }, limits: LaunchManifest['limits']): string | null {
  if (counters.output_bytes > limits.output_bytes) return 'output_limit'
  if (counters.processes > limits.processes) return 'process_limit'
  if (counters.retries > limits.retries) return 'retry_limit'
  if (counters.sockets > limits.sockets) return 'socket_limit'
  return null
}

export function classifySafeErrorText(value: string): string[] {
  const categories = new Set<string>()
  if (/api[- ]?key|auth(?:entication|orization)?|credential|oauth|token/i.test(value)) categories.add('authentication')
  if (/base[- ]?url|config(?:uration)?|setting|environment/i.test(value)) categories.add('configuration')
  if (/connect|network|socket|dns|tls|certificate|proxy|fetch/i.test(value)) categories.add('transport')
  if (/invalid|parse|json|request|response|protocol/i.test(value)) categories.add('request-shape')
  if (/permission|permitted|denied|forbidden|eperm/i.test(value)) categories.add('permission')
  if (/model/i.test(value)) categories.add('model')
  if (/capacity|overload|rate.?limit|quota/i.test(value)) categories.add('capacity')
  if (/country|region|supported location/i.test(value)) categories.add('region-policy')
  if (/platform|architecture|operating system/i.test(value)) categories.add('platform')
  if (/terminal|tty|interactive/i.test(value)) categories.add('terminal')
  if (/sandbox|exec(?:vp)?|spawn|launch|process/i.test(value)) categories.add('process-launch')
  if (/file|directory|read|write|open|mkdir|eperm/i.test(value)) categories.add('filesystem')
  if (/update|version|server|endpoint|url/i.test(value)) categories.add('runtime-service')
  if (categories.size === 0 && value.length > 0) categories.add('unknown')
  return [...categories].sort()
}

const SAFE_ERROR_TERMS = ['api', 'bare', 'cannot', 'country', 'directory', 'endpoint', 'eperm', 'error', 'exec', 'failed', 'file', 'input', 'interactive', 'invalid', 'key', 'launch', 'location', 'mkdir', 'open', 'permission', 'permitted', 'platform', 'print', 'process', 'prompt', 'read', 'region', 'require', 'response', 'sandbox', 'server', 'session', 'spawn', 'stdin', 'supported', 'terminal', 'token', 'tty', 'unsupported', 'update', 'url', 'uuid', 'version', 'write'] as const

export function extractSafeErrorTerms(value: string): string[] {
  return SAFE_ERROR_TERMS.filter((term) => new RegExp(`\\b${term}\\b`, 'i').test(value))
}

export function fingerprintSafeErrorText(bytesInput: Uint8Array): SafeTextFingerprint {
  const bytes = Buffer.from(bytesInput)
  let utf8Valid = true
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { utf8Valid = false; text = new TextDecoder('utf-8').decode(bytes) }
  const ansiSequenceCount = text.match(/\x1b\[[0-?]*[ -/]*[@-~]/g)?.length ?? 0
  const normalized = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').normalize('NFKC').toLowerCase()
  const tokenValues = normalized.match(/[\p{L}\p{N}]+/gu) ?? []
  let asciiPrintableBytes = 0; let whitespaceBytes = 0; let controlBytes = 0; let nonAsciiBytes = 0
  for (const byte of bytes) {
    if (byte >= 0x20 && byte <= 0x7e) asciiPrintableBytes += 1
    else if (byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x20) whitespaceBytes += 1
    else if (byte < 0x20 || byte === 0x7f) controlBytes += 1
    else nonAsciiBytes += 1
  }
  const tokens = tokenValues.slice(0, 64).map((token) => ({ byte_length: Buffer.byteLength(token), sha256: sha256Bytes(token) }))
  const result = {
    byte_length: bytes.length, utf8_valid: utf8Valid, line_count: text.split('\n').length,
    ascii_printable_bytes: asciiPrintableBytes, whitespace_bytes: whitespaceBytes, control_bytes: controlBytes, non_ascii_bytes: nonAsciiBytes,
    ansi_sequence_count: ansiSequenceCount, normalized_sha256: sha256Bytes(normalized), tokens, truncated: tokenValues.length > tokens.length,
  }
  bytes.fill(0)
  return result
}

function profileEscape(value: string): string { return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') }

export function buildCellSandboxProfile(manifestInput: LaunchManifest, evidenceRoot: string): string {
  const manifest = validateLaunchManifest(manifestInput)
  const root = ensureEvidenceRoot(evidenceRoot)
  const writableRoots = [manifest.environment.home, manifest.environment.xdg, manifest.environment.tmp, manifest.command.cwd]
    .map((relative) => assertEvidencePath(root, path.join(root, relative)))
    .sort()
  const endpoints = manifest.network.loopback_ports.flatMap((port) => [
    `(allow network-outbound (remote tcp "localhost:${port}"))`,
    `(allow network-outbound (remote udp "localhost:${port}"))`,
  ])
  return [
    '(version 1)', '(allow default)', '(deny network*)', '(deny file-write*)',
    ...writableRoots.map((root) => `(allow file-write* (subpath "${profileEscape(root)}"))`),
    ...endpoints,
  ].join(' ')
}

export function assertGuardAuthority(manifestInput: LaunchManifest, guard: GuardAuthority, profile: string): void {
  const manifest = validateLaunchManifest(manifestInput)
  if (guard.status !== 'PASS' || !guard.same_scope_probe || guard.external_socket_budget !== 0) throw new Phase3AError('guard_not_green', 'same-scope zero-egress guard is required')
  if (!Object.values(guard.probe).every(Boolean)) throw new Phase3AError('guard_not_green', 'one or more exact-profile guard probes failed')
  if (guard.profile_sha256 !== sha256Bytes(profile)) throw new Phase3AError('guard_profile_mismatch', 'guard did not test the exact sandbox profile')
  const manifestSha = sha256Bytes(canonicalJson(manifest))
  if (guard.manifest_sha256 !== manifestSha) throw new Phase3AError('guard_manifest_mismatch', 'guard did not test the exact launch manifest')
  if (canonicalJson([...guard.allowed_loopback_ports].sort((a, b) => a - b)) !== canonicalJson([...manifest.network.loopback_ports].sort((a, b) => a - b))) {
    throw new Phase3AError('guard_port_mismatch', 'guard loopback allowlist differs from manifest')
  }
}

function listen(server: Server, target: number | string, host?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    if (typeof target === 'string') server.listen(target, () => { server.off('error', reject); resolve() })
    else server.listen(target, host, () => { server.off('error', reject); resolve() })
  })
}

function close(server: Server): Promise<void> { return new Promise((resolve) => server.close(() => resolve())) }

export async function runCellGuardSelfTest(manifestInput: LaunchManifest, evidenceRoot: string): Promise<GuardAuthority> {
  const manifest = validateLaunchManifest(manifestInput)
  if (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) throw new Phase3AError('isolation_unavailable', 'macOS sandbox-exec is required for this guard adapter')
  const profile = buildCellSandboxProfile(manifest, evidenceRoot)
  const alternate = createServer((socket) => socket.end('alternate'))
  const unix = createServer((socket) => socket.end('unix'))
  const isolated = buildIsolatedEnvironment(manifest, evidenceRoot)
  const guardRoot = isolated.directories.tmp
  const root = ensureEvidenceRoot(evidenceRoot)
  const deniedWriteRoot = assertEvidencePath(root, path.join(root, 'denied-write-probes'))
  mkdirSync(deniedWriteRoot, { recursive: true, mode: 0o700 })
  const unixPath = path.join('/tmp', `p3a-g-${randomUUID().slice(0, 8)}.sock`)
  const insidePath = path.join(guardRoot, `allowed-${randomUUID()}.tmp`)
  const outsidePath = path.join(deniedWriteRoot, `phase3a-denied-${randomUUID()}.tmp`)
  await listen(alternate, 0, '127.0.0.1')
  await listen(unix, unixPath)
  const alternateAddress = alternate.address()
  if (!alternateAddress || typeof alternateAddress === 'string') throw new Phase3AError('guard_probe_failed', 'alternate listener did not bind TCP')
  const script = String.raw`
const net=require('node:net'),dgram=require('node:dgram'),fs=require('node:fs');
function tcp(host,port){return new Promise(r=>{const s=net.createConnection({host,port});let done=false;const end=v=>{if(done)return;done=true;s.destroy();r(v)};s.setTimeout(500,()=>end(false));s.once('connect',()=>end(true));s.once('error',()=>end(false))})}
function unix(file){return new Promise(r=>{const s=net.createConnection(file);let done=false;const end=v=>{if(done)return;done=true;s.destroy();r(v)};s.setTimeout(500,()=>end(false));s.once('connect',()=>end(true));s.once('error',()=>end(false))})}
function udp(){return new Promise(r=>{const s=dgram.createSocket('udp4');let done=false;const end=v=>{if(done)return;done=true;clearTimeout(t);s.close();r(v)};const t=setTimeout(()=>end(false),500);s.once('error',()=>end(false));s.send(Buffer.from([0]),53,'1.1.1.1',e=>end(!e))})}
function write(file){try{fs.writeFileSync(file,'synthetic',{flag:'wx'});return true}catch{return false}}
(async()=>{const ports=JSON.parse(process.argv[1]);const declared=[];for(const p of ports)declared.push(await tcp('127.0.0.1',p));const alternate=await tcp('127.0.0.1',Number(process.argv[2]));const unixOk=await unix(process.argv[3]);const ipv4=await tcp('1.1.1.1',443),ipv6=await tcp('2606:4700:4700::1111',443),udpOk=await udp();console.log(JSON.stringify({declared,alternate,unixOk,ipv4,ipv6,udpOk,inside:write(process.argv[4]),outside:write(process.argv[5])}))})().catch(()=>process.exit(2));`
  try {
    const probe = await new Promise<{ status: number | null; stdout: string }>((resolve) => {
      const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, process.execPath, '-e', script, JSON.stringify(manifest.network.loopback_ports), String(alternateAddress.port), unixPath, insidePath, outsidePath], {
        env: { PATH: '/usr/bin:/bin', HOME: guardRoot, TMPDIR: guardRoot, LANG: 'C', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore'],
      })
      let stdout = ''
      child.stdout.on('data', (chunk) => { if (stdout.length < 64 * 1024) stdout += chunk.toString('utf8') })
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
      child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout }) })
      child.on('error', () => { clearTimeout(timer); resolve({ status: null, stdout }) })
    })
    let result: { declared: boolean[]; alternate: boolean; unixOk: boolean; ipv4: boolean; ipv6: boolean; udpOk: boolean; inside: boolean; outside: boolean } | null = null
    if (probe.status === 0) try { result = JSON.parse(probe.stdout.trim()) } catch {}
    const passed = result !== null && result.declared.length === manifest.network.loopback_ports.length && result.declared.every(Boolean)
      && !result.alternate && !result.unixOk && !result.ipv4 && !result.ipv6 && !result.udpOk && result.inside && !result.outside
    if (!passed) throw new Phase3AError('guard_not_green', 'exact-profile same-scope guard probe failed')
    return {
      schema_version: 'oracle-lab-phase3a-cell-guard.v1', status: 'PASS', profile_sha256: sha256Bytes(profile),
      manifest_sha256: sha256Bytes(canonicalJson(manifest)), allowed_loopback_ports: [...manifest.network.loopback_ports].sort((a, b) => a - b),
      external_socket_budget: 0, same_scope_probe: true,
      probe: {
        declared_loopback_reachable: true, alternate_loopback_blocked: true, unix_socket_blocked: true,
        ipv4_external_tcp_blocked: true, ipv6_external_tcp_blocked: true, external_udp_blocked: true,
        inside_root_write_allowed: true, outside_root_write_blocked: true,
      },
    }
  } finally { await Promise.all([close(alternate), close(unix)]) }
}

export function prepareHookFiles(instrumentation: Instrumentation, runtimeRoot?: string): { argv: string[]; env: NodeJS.ProcessEnv } {
  const root = path.dirname(fileURLToPath(import.meta.url))
  if (instrumentation === 'preload') return { argv: ['--require', path.join(root, 'hooks/preload.cjs')], env: {} }
  if (instrumentation === 'loader') return { argv: ['--experimental-loader', path.join(root, 'hooks/loader.mjs')], env: {} }
  if (instrumentation === 'bun') {
    if (!runtimeRoot) throw new Phase3AError('hook_runtime_root_missing', 'bun preload requires an isolated runtime root')
    const target = path.join(runtimeRoot, 'oracle-phase3a-bun-preload.mjs')
    copyFileSync(path.join(root, 'hooks/bun-preload.mjs'), target, fsConstants.COPYFILE_EXCL)
    return { argv: ['--preload', target], env: {} }
  }
  if (instrumentation === 'inspector') return { argv: ['--inspect=127.0.0.1:0'], env: {} }
  if (instrumentation === 'probe-copy') throw new Phase3AError('probe_copy_not_prepared', 'probe-copy requires a separately digest-bound isolated copy')
  return { argv: [], env: {} }
}

function countFiles(rootInputs: string[], maximum: number): number {
  let count = 0
  const roots = [...new Set(rootInputs.map((root) => path.resolve(root)))].filter((root, index, values) => !values.some((other, otherIndex) => otherIndex !== index && root.startsWith(`${other}${path.sep}`)))
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const entry = path.join(directory, name)
      const stat = lstatSync(entry)
      if (stat.isSymbolicLink()) throw new Phase3AError('runtime_symlink', 'cell created a symlink')
      count += 1
      if (count > maximum) throw new Phase3AError('file_limit', 'cell file limit exceeded')
      if (stat.isDirectory()) visit(entry)
    }
  }
  for (const root of roots) visit(root)
  return count
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL')
    else child.kill('SIGKILL')
  } catch { try { child.kill('SIGKILL') } catch {} }
}

function hookSummary(file: string): { count: number; retries: number } {
  if (!existsSync(file)) return { count: 0, retries: 0 }
  let count = 0
  let retries = 0
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    count += 1
    try {
      const event = JSON.parse(line) as { kind?: string }
      if (event.kind && /retry/i.test(event.kind)) retries += 1
    } catch { throw new Phase3AError('invalid_hook_event', 'hook output contains invalid JSONL') }
  }
  return { count, retries }
}

function validateTrustedLocalCa(manifest: LaunchManifest, localCa: RunCellOptions['trusted_local_ca']): string | null {
  if (!localCa) return null
  if (manifest.network.proxy_mode !== 'loopback-mitm' || manifest.network.ca_sha256 !== localCa.sha256) {
    throw new Phase3AError('local_ca_manifest_mismatch', 'runtime local CA does not match the loopback MITM manifest binding')
  }
  if (!path.isAbsolute(localCa.cert_path) || !lstatSync(localCa.cert_path).isFile() || lstatSync(localCa.cert_path).isSymbolicLink() || sha256File(localCa.cert_path) !== localCa.sha256) {
    throw new Phase3AError('local_ca_invalid', 'runtime local CA certificate is not the declared regular file')
  }
  return localCa.cert_path
}

export async function runCell(options: RunCellOptions): Promise<CellResult> {
  const manifest = validateLaunchManifest(options.manifest)
  if (!new Set<Instrumentation>(['none', 'preload', 'loader', 'bun', 'inspector', 'probe-copy']).has(options.instrumentation)) {
    throw new Phase3AError('invalid_instrumentation', 'instrumentation mode is not supported')
  }
  assertControlForInstrumentation(manifest, options.control_manifest ?? null, options.instrumentation)
  if (!path.isAbsolute(options.executable) || !lstatSync(options.executable).isFile()) throw new Phase3AError('invalid_executable', 'executable must be an absolute regular file')
  if (sha256File(options.executable) !== manifest.command.executable_sha256) throw new Phase3AError('executable_digest_mismatch', 'executable bytes differ from manifest')
  const { env, directories } = buildIsolatedEnvironment(manifest, options.evidence_root)
  const localCaPath = validateTrustedLocalCa(manifest, options.trusted_local_ca)
  if (localCaPath) Object.assign(env, { SSL_CERT_FILE: localCaPath, NODE_EXTRA_CA_CERTS: localCaPath })
  const profile = buildCellSandboxProfile(manifest, options.evidence_root)
  assertGuardAuthority(manifest, options.guard, profile)
  if (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) throw new Phase3AError('isolation_unavailable', 'this runner requires the already-tested macOS sandbox adapter')
  const stdin = Buffer.from(options.stdin ?? [])
  if (sha256Bytes(stdin) !== manifest.command.stdin_sha256) throw new Phase3AError('stdin_digest_mismatch', 'stdin bytes differ from manifest')
  const hook = prepareHookFiles(options.instrumentation, directories.tmp)
  const hookOutput = path.join(directories.tmp, 'hook-events.jsonl')
  if (options.instrumentation !== 'none') Object.assign(env, hook.env, { ORACLE_PHASE3A_HOOK_OUTPUT: hookOutput, ORACLE_PHASE3A_HOOK_MAX_EVENTS: '10000', ORACLE_PHASE3A_HOOK_MAX_BYTES: String(Math.min(manifest.limits.output_bytes, 8 * 1024 * 1024)) })
  const targetArgs = [...hook.argv, ...manifest.command.argv]
  const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, options.executable, ...targetArgs], {
    cwd: directories.cwd, env, detached: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stdin.end(stdin); stdin.fill(0)
  const started = process.hrtime.bigint()
  const stdoutHash = createHash('sha256'); const stderrHash = createHash('sha256')
  const safeErrorChunks: Buffer[] = []
  let safeErrorBytes = 0
  let stdoutBytes = 0; let stderrBytes = 0; let exceeded = false; let terminationReason: string | null = null
  const collect = (hash: ReturnType<typeof createHash>, stream: NodeJS.ReadableStream, update: (bytes: number) => void, classify = false): void => {
    stream.on('data', (chunk: Buffer) => {
      const data = Buffer.from(chunk); hash.update(data); update(data.length)
      if (classify && safeErrorBytes < 16 * 1024) {
        const retained = Buffer.from(data.subarray(0, Math.min(data.length, 16 * 1024 - safeErrorBytes)))
        safeErrorChunks.push(retained); safeErrorBytes += retained.length
      }
      data.fill(0)
      if (evaluateCellCounters({ output_bytes: stdoutBytes + stderrBytes, processes: 0, retries: 0, sockets: 0 }, manifest.limits) === 'output_limit' && !exceeded) { exceeded = true; terminationReason ??= 'output_limit'; killTree(child) }
    })
  }
  collect(stdoutHash, child.stdout!, (size) => { stdoutBytes += size })
  collect(stderrHash, child.stderr!, (size) => { stderrBytes += size }, true)
  const samples: ProcessSample[] = []
  let maxProcesses = 0
  let maxSockets: number | null = 0
  let sampling = false
  let pendingSample: Promise<void> = Promise.resolve()
  const sample = async (): Promise<void> => {
    if (!child.pid || child.exitCode !== null) return
    try {
      const current = await sampleProcessTree(child.pid, samples.length)
      samples.push(...current); maxProcesses = Math.max(maxProcesses, current.length)
      const sockets = await sampleSocketCount(current.map((sample) => sample.pid))
      maxSockets = sockets === null || maxSockets === null ? null : Math.max(maxSockets, sockets)
      const violation = enforceProcessLimits(current, manifest.limits)
      const counterViolation = evaluateCellCounters({ output_bytes: stdoutBytes + stderrBytes, processes: current.length, retries: 0, sockets: sockets ?? 0 }, manifest.limits)
      if (violation || counterViolation) {
        terminationReason ??= violation ?? counterViolation; killTree(child)
      }
      countFiles([directories.home, directories.xdg, directories.tmp, directories.cwd], manifest.limits.files)
    } catch (error) { terminationReason ??= error instanceof Phase3AError ? error.code : 'sampler_failure'; killTree(child) }
  }
  const interval = setInterval(() => {
    if (sampling) return
    sampling = true
    pendingSample = sample().finally(() => { sampling = false })
  }, Math.max(50, Math.min(options.sample_interval_ms ?? 250, 1000)))
  const timeout = setTimeout(() => { terminationReason ??= 'wall_timeout'; killTree(child) }, Math.min(manifest.command.timeout_ms, manifest.limits.wall_ms))
  const closed = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; spawnError: boolean }>((resolve) => {
    let spawnError = false
    child.once('error', () => { spawnError = true })
    child.once('close', (code, signal) => resolve({ code, signal, spawnError }))
  })
  clearInterval(interval); clearTimeout(timeout)
  await pendingSample
  const hooks = hookSummary(hookOutput)
  if (evaluateCellCounters({ output_bytes: stdoutBytes + stderrBytes, processes: maxProcesses, retries: hooks.retries, sockets: maxSockets ?? 0 }, manifest.limits) === 'retry_limit') terminationReason ??= 'retry_limit'
  const status: CellResult['status'] = closed.spawnError ? 'spawn-error' : terminationReason === 'wall_timeout' ? 'timeout' : terminationReason ? 'resource-limit' : closed.code === 0 ? 'complete' : 'failed'
  const safeErrorText = Buffer.concat(safeErrorChunks).toString('utf8')
  const safeDiagnostic = classifySafeDiagnosticText(safeErrorText)
  const safeErrorCategories = classifySafeErrorText(safeErrorText)
  const safeErrorTerms = extractSafeErrorTerms(safeErrorText)
  const stderrFingerprint = fingerprintSafeErrorText(Buffer.concat(safeErrorChunks))
  for (const chunk of safeErrorChunks) chunk.fill(0)
  return {
    schema_version: 'oracle-lab-phase3a-cell-result.v1', run_id: manifest.run_id, status,
    command_digest: cellCommandDigest(manifest),
    exit_code: closed.code, signal: closed.signal, duration_ms: Number((process.hrtime.bigint() - started) / 1_000_000n), termination_reason: terminationReason,
    stdout: { bytes: stdoutBytes, sha256: stdoutHash.digest('hex'), truncated: exceeded },
    stderr: { bytes: stderrBytes, sha256: stderrHash.digest('hex'), truncated: exceeded },
    process_samples: samples, max_processes: maxProcesses, max_sockets: maxSockets,
    retry_events: hooks.retries, hook_event_count: hooks.count, safe_diagnostic: safeDiagnostic, safe_error_categories: safeErrorCategories, safe_error_terms: safeErrorTerms, stderr_fingerprint: stderrFingerprint, raw_output_persisted: false,
  }
}

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifestFile = argument('--manifest'); const evidenceRoot = argument('--evidence-root')
  if (process.argv.includes('--guard-self-test')) {
    if (!manifestFile || !evidenceRoot) throw new Phase3AError('usage', 'usage: run-cell.ts --guard-self-test --manifest FILE --evidence-root DIR')
    process.stdout.write(`${canonicalJson(await runCellGuardSelfTest(loadLaunchManifest(manifestFile), evidenceRoot))}\n`)
    process.exit(0)
  }
  const executable = argument('--executable'); const guardFile = argument('--guard')
  if (!manifestFile || !executable || !evidenceRoot || !guardFile) throw new Phase3AError('usage', 'usage: run-cell.ts --manifest FILE --executable FILE --evidence-root DIR --guard FILE [--control FILE] [--instrumentation none]')
  const manifest = loadLaunchManifest(manifestFile)
  const controlFile = argument('--control')
  const result = await runCell({ manifest, control_manifest: controlFile ? loadLaunchManifest(controlFile) : null, evidence_root: evidenceRoot, executable, instrumentation: (argument('--instrumentation') ?? 'none') as Instrumentation, guard: JSON.parse(readFileSync(guardFile, 'utf8')) as GuardAuthority })
  process.stdout.write(`${canonicalJson(result)}\n`)
}
