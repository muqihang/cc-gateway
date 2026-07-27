import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { homedir } from 'node:os'
import path from 'node:path'

import type { ProductionController } from './controller.js'
import { controllerState } from './controller.js'
import { Phase3BProductionError, deepFreeze, sha256Bytes, sha256Canonical } from './core.js'
import { appendSpawned, appendStarted, appendTerminal, type ExecutionStore } from './execution-store.js'
import { type LaunchAuthorityReceipt, assertLaunchAuthority } from './launch-authority.js'
import { TARGET_EXECUTABLE_MAXIMUM_BYTES, type LaunchImageRecord, verifyLaunchImage } from './launch-image.js'
import type { RunLedgerRow } from './ledger.js'
import { type ReceiverAuthority, abortReceiverGroup, assertReceiverAuthority, prepareReceiverLaunch, registerReceiverTarget, sealReceiverGroup } from './receiver.js'
import { prepareScenarioCell, preparedCellState } from './scenario-input.js'
import { buildSandboxProfile } from './sandbox-policy.js'
import { createPrivateDirectory, readCanonical, stableRead, writeExclusiveCanonical } from './sealed-fs.js'

export type RowExecutionResult = Readonly<{
  terminal_class: 'success' | 'spawn_error' | 'failed_after_spawn'
  terminal_receipt_sha256: string
  receiver_result_sha256: string | null
  cell_result_sha256: string
}>

type CellBindings = Readonly<{
  campaign_id: string
  ledger_sha256: string
  launch_authority_sha256: string
  receiver_authority_sha256: string
  launch_image_record_sha256: string
  executable_identity_sha256: string
  input_descriptor_sha256: string
  sandbox_profile_sha256: string
}>

const MAX_WALL_MS = 120_000
const MAX_OUTPUT_BYTES = 1_048_576
const MAX_PROCESSES = 32

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = server.address()
      if (!address || typeof address === 'string') reject(new Phase3BProductionError('guard_probe_failed', 'alternate listener did not bind'))
      else resolve(address.port)
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

async function runExactGuard(controller: ProductionController, row: RunLedgerRow, profile: string, routePorts: readonly number[]): Promise<string> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || !existsSync('/usr/bin/sandbox-exec')) throw new Phase3BProductionError('isolation_unavailable', 'darwin-arm64 sandbox-exec is required')
  const alternate = createServer((socket) => socket.end())
  const alternatePort = await listen(alternate)
  const script = String.raw`
require 'socket'
require 'json'
def tcp(host, port)
  Socket.tcp(host, port, connect_timeout: 0.6) { true }
rescue StandardError
  false
end
def udp
  socket = UDPSocket.new
  socket.connect('1.1.1.1', 53)
  socket.send("\0", 0)
  true
rescue StandardError
  false
ensure
  socket&.close
end
def write_once(file)
  File.open(file, File::WRONLY | File::CREAT | File::EXCL, 0o600) { |io| io.write("{\"schema_id\":\"oracle-lab-p3b-guard-write.v1\",\"value\":\"synthetic\"}\n") }
  true
rescue StandardError
  false
end
def readable(file)
  File.binread(file)
  true
rescue StandardError
  false
end
def process_info
  system('/bin/ps', '-p', Process.pid.to_s, out: File::NULL, err: File::NULL) == true
rescue StandardError
  false
end
ports = JSON.parse(ARGV[0])
probe = {
  declared: ports.map { |port| tcp('127.0.0.1', port) },
  alternate: tcp('127.0.0.1', Integer(ARGV[1])),
  ipv4: tcp('1.1.1.1', 443),
  ipv6: tcp('2606:4700:4700::1111', 443),
  udp: udp,
  inside: write_once(ARGV[2]),
  outside: write_once(ARGV[3]),
  host_read: readable('/etc/passwd'),
  credential_read: readable(ARGV[4]),
  process_info: process_info,
}
STDOUT.write(JSON.generate(probe))`
  const state = controllerState(controller)
  const runRoot = path.join(state.runtimeRoot!, 'runs', `${String(row.sequence_index).padStart(3, '0')}-${row.run_id}`)
  const inside = path.join(runRoot, 'guard-allowed.tmp')
  const outside = path.join(state.runtimeRoot!, 'guard-denied.tmp')
  try {
    const result = await new Promise<{ code: number | null; stdout: string }>((resolve) => {
      const credentialPath = path.join(homedir(), '.ssh', 'config')
      const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, '/usr/bin/ruby', '--disable=gems', '-e', script, JSON.stringify(routePorts), String(alternatePort), inside, outside, credentialPath], { cwd: runRoot, env: { PATH: '/usr/bin:/bin', HOME: runRoot, TMPDIR: runRoot, LANG: 'C', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore'] })
      let stdout = ''
      child.stdout!.on('data', (chunk: Buffer) => { if (stdout.length < 16_384) stdout += chunk.toString('utf8') })
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
      child.once('close', (code) => { clearTimeout(timer); resolve({ code, stdout }) })
      child.once('error', () => { clearTimeout(timer); resolve({ code: null, stdout }) })
    })
    let probe: { declared: boolean[]; alternate: boolean; ipv4: boolean; ipv6: boolean; udp: boolean; inside: boolean; outside: boolean; host_read: boolean; credential_read: boolean; process_info: boolean }
    try { probe = JSON.parse(result.stdout.trim()) } catch { throw new Phase3BProductionError('guard_probe_failed', 'guard probe returned invalid output') }
    if (result.code !== 0 || probe.declared.length !== routePorts.length || !probe.declared.every(Boolean) || probe.alternate || probe.ipv4 || probe.ipv6 || probe.udp || !probe.inside || probe.outside || probe.host_read || probe.credential_read || probe.process_info) throw new Phase3BProductionError('guard_probe_failed', 'exact sandbox profile failed loopback/no-egress/read/process/write guard')
    const allowedWrite = readCanonical(state.runtimeRoot!, `${runRelativeFromRoot(runRoot, state.runtimeRoot!)}/guard-allowed.tmp`)
    if (allowedWrite.value.schema_id !== 'oracle-lab-p3b-guard-write.v1' || allowedWrite.value.value !== 'synthetic') throw new Phase3BProductionError('guard_probe_failed', 'guard allowed-write artifact drifted')
    const unsigned = { schema_id: 'oracle-lab-p3b-guard-receipt.v1', run_id: row.run_id, sequence_index: row.sequence_index, profile_sha256: sha256Bytes(Buffer.from(profile, 'utf8')), allowed_loopback_ports: [...routePorts].sort((a, b) => a - b), allowed_write_sha256: allowedWrite.identity.sha256, denied_host_read: probe.host_read === false, denied_credential_read: probe.credential_read === false, denied_process_info: probe.process_info === false, external_socket_budget: 0, same_scope_probe: true, status: 'PASS' }
    const digest = sha256Canonical(unsigned)
    writeExclusiveCanonical(state.runtimeRoot!, `guards/${String(row.sequence_index).padStart(3, '0')}-${row.run_id}.json`, { ...unsigned, guard_receipt_sha256: digest })
    return digest
  } finally { await close(alternate) }
}

function runRelativeFromRoot(absolute: string, root: string): string {
  const prefix = `${root}${path.sep}`
  if (!absolute.startsWith(prefix)) throw new Phase3BProductionError('guard_probe_failed', 'guard run root escaped sealed runtime')
  return absolute.slice(prefix.length)
}

function psRows(): Array<{ pid: number; ppid: number }> {
  const output = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', timeout: 3_000 })
  return output.trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number)).filter(([pid, ppid]) => Number.isSafeInteger(pid) && Number.isSafeInteger(ppid)).map(([pid, ppid]) => ({ pid, ppid }))
}

function descendants(rootPid: number): number[] {
  const rows = psRows()
  const values = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) if (values.has(row.ppid) && !values.has(row.pid)) { values.add(row.pid); changed = true }
  }
  return [...values]
}

function executablePaths(pid: number): string[] {
  const lsof = existsSync('/usr/sbin/lsof') ? '/usr/sbin/lsof' : '/usr/bin/lsof'
  try {
    const output = execFileSync(lsof, ['-nP', '-a', '-p', String(pid), '-d', 'txt', '-Fn'], { encoding: 'utf8', timeout: 3_000 })
    return output.split('\n').filter((line) => line.startsWith('n/')).map((line) => line.slice(1))
  } catch { return [] }
}

async function discoverTargetPid(sandboxPid: number, image: LaunchImageRecord): Promise<number> {
  const deadline = Date.now() + 5_000
  do {
    const matches = descendants(sandboxPid).filter((pid) => executablePaths(pid).some((file) => {
      try { return sha256Canonical(stableRead(file, { maximumBytes: TARGET_EXECUTABLE_MAXIMUM_BYTES }).identity) === sha256Canonical(image.image_identity) } catch { return false }
    }))
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) throw new Phase3BProductionError('target_pid_ambiguous', 'multiple target executable identities exist in sandbox tree')
    await new Promise((resolve) => setTimeout(resolve, 25))
  } while (Date.now() < deadline)
  throw new Phase3BProductionError('target_pid_missing', 'no target PID matches sealed executable identity')
}

function killOwnedTree(child: ChildProcess): void {
  if (!child.pid) return
  try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch {} }
}

function waitChild(child: ChildProcess): Promise<{ exitCode: number | null; signal: string | null }> {
  return new Promise((resolve) => {
    let settled = false
    const done = (exitCode: number | null, signal: NodeJS.Signals | null) => { if (!settled) { settled = true; resolve({ exitCode, signal }) } }
    child.once('close', done)
    child.once('error', () => done(null, 'spawn_error' as NodeJS.Signals))
  })
}

function installOwnedSignalHandlers(child: ChildProcess, onSignal: (signal: NodeJS.Signals) => void): () => void {
  const onSigint = () => { onSignal('SIGINT'); killOwnedTree(child) }
  const onSigterm = () => { onSignal('SIGTERM'); killOwnedTree(child) }
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)
  return () => {
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
  }
}

function externalSocketCount(pids: readonly number[], allowedPorts: readonly number[]): number {
  const lsof = existsSync('/usr/sbin/lsof') ? '/usr/sbin/lsof' : '/usr/bin/lsof'
  let count = 0
  for (const pid of pids) {
    let output = ''
    try { output = execFileSync(lsof, ['-nP', '-a', '-p', String(pid), '-i', '-Fn'], { encoding: 'utf8', timeout: 3_000 }) } catch { continue }
    for (const line of output.split('\n').filter((value) => value.startsWith('n') && value.includes('->'))) {
      if (!allowedPorts.some((port) => line.includes(`->127.0.0.1:${port}`) || line.includes(`->localhost:${port}`))) count += 1
    }
  }
  return count
}

function expectedExit(row: RunLedgerRow, exitCode: number | null, signal: string | null): boolean {
  if (signal !== null) return false
  const expectsFailure = (row.family === 'auth' && row.schedule_id === 'auth-missing-credential' && row.arm.startsWith('treatment/'))
    || (row.family === 'response_failure_recovery' && /_terminal$|^reset_terminal$|^partial_sse_then_eof$/.test(row.schedule_id))
  return expectsFailure ? exitCode !== null && exitCode !== 0 : exitCode === 0
}

function safeDiagnostic(bytes: Buffer): Readonly<Record<string, unknown>> {
  const text = bytes.toString('utf8').normalize('NFKC').toLowerCase()
  const categories = ['authentication', 'rate_limit', 'transport', 'server', 'configuration'].filter((category) => ({ authentication: /auth|credential|api.?key|token/, rate_limit: /rate|429/, transport: /network|socket|reset|eof|timeout/, server: /500|529|server/, configuration: /config|setting/ }[category]!.test(text)))
  bytes.fill(0)
  return deepFreeze({ categories, normalized_sha256: sha256Bytes(Buffer.from(text, 'utf8')) })
}

function safeOutputProjection(bytes: Buffer): Readonly<{ safe_output_class: 'synthetic-output-complete' | 'absent' | 'unexpected'; safe_output_sha256: string | null }> {
  if (bytes.length === 0) return deepFreeze({ safe_output_class: 'absent', safe_output_sha256: null })
  let value: unknown
  try { value = JSON.parse(bytes.toString('utf8').trim()) } catch { bytes.fill(0); return deepFreeze({ safe_output_class: 'unexpected', safe_output_sha256: null }) }
  const candidate = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).result : null
  bytes.fill(0)
  if (candidate !== 'output.complete') return deepFreeze({ safe_output_class: 'unexpected', safe_output_sha256: null })
  return deepFreeze({ safe_output_class: 'synthetic-output-complete', safe_output_sha256: sha256Bytes(Buffer.from('output.complete', 'utf8')) })
}

function expectsCompleteOutput(row: RunLedgerRow): boolean {
  return row.response_program.actions.at(-1)?.body_kind === 'complete_sse'
}

export async function executeProductionRow(input: Readonly<{ controller: ProductionController; store: ExecutionStore; row: RunLedgerRow; receiver: ReceiverAuthority; authority: LaunchAuthorityReceipt; image: LaunchImageRecord }>): Promise<RowExecutionResult> {
  assertReceiverAuthority(input.receiver, input.row)
  assertLaunchAuthority(input.authority, input.row)
  const image = verifyLaunchImage(input.image)
  if (input.authority.launch_image_record_sha256 !== image.record_sha256 || input.authority.receiver_authority_sha256 !== input.receiver.authority_sha256) throw new Phase3BProductionError('launch_authority_invalid', 'spawn inputs drifted from authority')
  const runtimeRoot = controllerState(input.controller).runtimeRoot!
  createPrivateDirectory(runtimeRoot, 'guards')
  createPrivateDirectory(runtimeRoot, 'cell-results')
  const runRelative = `runs/${String(input.row.sequence_index).padStart(3, '0')}-${input.row.run_id}`
  createPrivateDirectory(runtimeRoot, runRelative)
  const routePorts = input.receiver.routes.map((route) => route.port)
  const preArmProfile = buildSandboxProfile(runtimeRoot, path.join(runtimeRoot, runRelative), routePorts)
  if (sha256Bytes(Buffer.from(preArmProfile, 'utf8')) !== input.authority.guard_profile_sha256) throw new Phase3BProductionError('guard_profile_invalid', 'actual sandbox profile differs from launch authority')
  const guardReceiptSha256 = await runExactGuard(input.controller, input.row, preArmProfile, routePorts)
  const bootstrap = prepareReceiverLaunch(input.receiver, input.authority)
  const prepared = prepareScenarioCell(input.controller, input.row, bootstrap)
  const cell = preparedCellState(prepared, input.row)
  if (cell.profile !== preArmProfile) throw new Phase3BProductionError('guard_profile_invalid', 'guard profile differs from target launch profile')
  verifyLaunchImage(image)
  const cellBindings: CellBindings = deepFreeze({ campaign_id: prepared.campaign_id, ledger_sha256: prepared.ledger_sha256, launch_authority_sha256: input.authority.receipt_sha256, receiver_authority_sha256: input.receiver.authority_sha256, launch_image_record_sha256: image.record_sha256, executable_identity_sha256: input.authority.executable_identity_sha256, input_descriptor_sha256: prepared.input_descriptor_sha256, sandbox_profile_sha256: prepared.sandbox_profile_sha256 })
  appendStarted(input.store, input.row, input.authority)
  let child: ChildProcess | null = null
  let wait: Promise<{ exitCode: number | null; signal: string | null }> | null = null
  let removeSignalHandlers = () => {}
  const controllerTermination: { signal: NodeJS.Signals | null } = { signal: null }
  try {
    child = spawn('/usr/bin/sandbox-exec', ['-p', cell.profile, image.image_identity.path, ...input.row.argv], { cwd: cell.cwd, env: cell.env, detached: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    wait = waitChild(child)
    removeSignalHandlers = installOwnedSignalHandlers(child, (signal) => { controllerTermination.signal ??= signal })
    if (!child.pid) throw new Phase3BProductionError('spawn_pid_missing', 'sandbox process has no PID')
    try { child.stdin!.end(cell.stdin) } finally { cell.stdin.fill(0) }
  } catch (error: unknown) {
    let exit: { exitCode: number | null; signal: string | null } = { exitCode: null, signal: null }
    if (child) {
      killOwnedTree(child)
      if (wait) exit = await wait
    }
    removeSignalHandlers()
    cell.stdin.fill(0)
    await abortReceiverGroup(input.receiver)
    const terminal = appendTerminal(input.store, input.row, input.authority, { terminalClass: 'spawn_error', exitCode: exit.exitCode, signal: exit.signal, causeCode: (error as NodeJS.ErrnoException).code ?? 'spawn_exception' })
    return writeCellResult(runtimeRoot, input.row, cellBindings, terminal.terminal_class!, terminal.receipt_sha256, null, guardReceiptSha256, 0, 0, 0, exit.exitCode, exit.signal, { categories: ['spawn'], normalized_sha256: sha256Canonical('spawn') })
  }
  const ownedChild = child
  const ownedWait = wait
  let targetPid: number
  try {
    targetPid = await discoverTargetPid(ownedChild.pid!, image)
    appendSpawned(input.store, input.row, input.authority, ownedChild.pid!, targetPid, sha256Canonical(image.image_identity))
    registerReceiverTarget(input.receiver, targetPid, sha256Canonical(image.image_identity))
  } catch (error: unknown) {
    killOwnedTree(ownedChild)
    const exit = await ownedWait
    removeSignalHandlers()
    await abortReceiverGroup(input.receiver)
    const terminal = appendTerminal(input.store, input.row, input.authority, { terminalClass: 'spawn_error', exitCode: exit.exitCode, signal: exit.signal, causeCode: controllerTermination.signal === null ? ((error as { code?: string }).code ?? 'spawn_ownership_failure') : 'controller_signal' })
    return writeCellResult(runtimeRoot, input.row, cellBindings, terminal.terminal_class!, terminal.receipt_sha256, null, guardReceiptSha256, 0, 0, 0, exit.exitCode, exit.signal, { categories: ['spawn'], normalized_sha256: sha256Canonical('spawn') })
  }
  let stdoutBytes = 0; let stderrBytes = 0; const stdoutSafe: Buffer[] = []; const stderrSafe: Buffer[] = []; let stdoutSafeBytes = 0; let stderrSafeBytes = 0; let resourceFailure: string | null = null
  ownedChild.stdout!.on('data', (chunk: Buffer) => { const bytes = Buffer.from(chunk); stdoutBytes += bytes.length; if (stdoutSafeBytes < MAX_OUTPUT_BYTES) { const kept = Buffer.from(bytes.subarray(0, MAX_OUTPUT_BYTES - stdoutSafeBytes)); stdoutSafe.push(kept); stdoutSafeBytes += kept.length } bytes.fill(0); if (stdoutBytes + stderrBytes > MAX_OUTPUT_BYTES) { resourceFailure ??= 'output_limit'; killOwnedTree(ownedChild) } })
  ownedChild.stderr!.on('data', (chunk: Buffer) => { const bytes = Buffer.from(chunk); stderrBytes += bytes.length; if (stderrSafeBytes < 16_384) { const kept = Buffer.from(bytes.subarray(0, 16_384 - stderrSafeBytes)); stderrSafe.push(kept); stderrSafeBytes += kept.length } bytes.fill(0); if (stdoutBytes + stderrBytes > MAX_OUTPUT_BYTES) { resourceFailure ??= 'output_limit'; killOwnedTree(ownedChild) } })
  const timer = setTimeout(() => { resourceFailure ??= 'wall_timeout'; killOwnedTree(ownedChild) }, MAX_WALL_MS)
  const sampler = setInterval(() => {
    try {
      const pids = descendants(ownedChild.pid!)
      if (pids.length > MAX_PROCESSES) { resourceFailure ??= 'process_limit'; killOwnedTree(ownedChild) }
      if (externalSocketCount(pids, cell.routePorts) > 0) { resourceFailure ??= 'external_socket'; killOwnedTree(ownedChild) }
    } catch { resourceFailure ??= 'process_sampler_failure'; killOwnedTree(ownedChild) }
  }, 100)
  const exit = await ownedWait
  clearTimeout(timer); clearInterval(sampler)
  removeSignalHandlers()
  resourceFailure ??= controllerTermination.signal === null ? null : 'controller_signal'
  let receiverResultSha256: string | null = null
  let receiverFailure: string | null = null
  try { receiverResultSha256 = (await sealReceiverGroup(input.receiver)).result_sha256 } catch (error: unknown) { receiverFailure = (error as { code?: string }).code ?? 'receiver_terminal_invalid'; await abortReceiverGroup(input.receiver) }
  let imageFailure: string | null = null
  try { verifyLaunchImage(image) } catch (error: unknown) { imageFailure = (error as { code?: string }).code ?? 'launch_image_drift' }
  const stdoutMaterial = Buffer.concat(stdoutSafe)
  stdoutSafe.forEach((bytes) => bytes.fill(0))
  const outputProjection = safeOutputProjection(stdoutMaterial)
  const outputAccepted = expectsCompleteOutput(input.row) ? outputProjection.safe_output_class === 'synthetic-output-complete' : outputProjection.safe_output_class !== 'synthetic-output-complete'
  const success = !resourceFailure && !receiverFailure && !imageFailure && expectedExit(input.row, exit.exitCode, exit.signal) && outputAccepted
  const cause = resourceFailure ?? receiverFailure ?? imageFailure ?? (success ? null : 'unexpected_target_terminal')
  const terminalClass = success ? 'success' as const : 'failed_after_spawn' as const
  const terminal = appendTerminal(input.store, input.row, input.authority, { terminalClass, exitCode: exit.exitCode, signal: exit.signal, causeCode: cause })
  const stderrMaterial = Buffer.concat(stderrSafe)
  stderrSafe.forEach((bytes) => bytes.fill(0))
  const diagnostic = safeDiagnostic(stderrMaterial)
  return writeCellResult(runtimeRoot, input.row, cellBindings, terminalClass, terminal.receipt_sha256, receiverResultSha256, guardReceiptSha256, stdoutBytes, stderrBytes, externalSocketCount([targetPid], cell.routePorts), exit.exitCode, exit.signal, diagnostic, outputProjection)
}

function writeCellResult(runtimeRoot: string, row: RunLedgerRow, bindings: CellBindings, terminalClass: 'success' | 'spawn_error' | 'failed_after_spawn' | 'not_executed', terminalReceiptSha256: string, receiverResultSha256: string | null, guardReceiptSha256: string, stdoutBytes: number, stderrBytes: number, externalSockets: number, exitCode: number | null, signal: string | null, diagnostic: Readonly<Record<string, unknown>>, outputProjection: Readonly<Record<string, unknown>> = { safe_output_class: 'absent', safe_output_sha256: null }): RowExecutionResult {
  const unsigned = { schema_id: 'oracle-lab-p3b-cell-result.v1', campaign_id: bindings.campaign_id, ledger_sha256: bindings.ledger_sha256, run_id: row.run_id, sequence_index: row.sequence_index, family: row.family, schedule_id: row.schedule_id, seed: row.seed, repetition: row.repetition, arm: row.arm, row_sha256: row.row_sha256, launch_authority_sha256: bindings.launch_authority_sha256, receiver_authority_sha256: bindings.receiver_authority_sha256, launch_image_record_sha256: bindings.launch_image_record_sha256, executable_identity_sha256: bindings.executable_identity_sha256, input_descriptor_sha256: bindings.input_descriptor_sha256, sandbox_profile_sha256: bindings.sandbox_profile_sha256, terminal_class: terminalClass, terminal_receipt_sha256: terminalReceiptSha256, receiver_result_sha256: receiverResultSha256, guard_receipt_sha256: guardReceiptSha256, target_terminal: { exit_code: exitCode, signal }, stdout: { byte_length: stdoutBytes, ...outputProjection }, stderr: { byte_length: stderrBytes, safe_diagnostic: diagnostic }, external_socket_count: externalSockets, raw_material_persisted: false }
  const cellResultSha256 = sha256Canonical(unsigned)
  writeExclusiveCanonical(runtimeRoot, `cell-results/${String(row.sequence_index).padStart(3, '0')}-${row.run_id}.json`, { ...unsigned, cell_result_sha256: cellResultSha256 })
  return deepFreeze({ terminal_class: terminalClass === 'not_executed' ? 'failed_after_spawn' : terminalClass, terminal_receipt_sha256: terminalReceiptSha256, receiver_result_sha256: receiverResultSha256, cell_result_sha256: cellResultSha256 })
}
