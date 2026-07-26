import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { fileURLToPath } from 'node:url'

import { type ProductionController, assertProductionController, controllerState } from './controller.js'
import { Phase3BProductionError, deepFreeze, deterministicUuidV4, sha256Bytes, sha256Canonical } from './core.js'
import type { LaunchAuthorityReceipt } from './launch-authority.js'
import { assertControllerLaunchPrerequisites, assertLaunchAuthority } from './launch-authority.js'
import { type ResponseAction, type RunLedgerRow, materializeResponseBody } from './ledger.js'
import { classifySyntheticAuthHeader, expectedAuthMarkerClass } from './scenario-input.js'
import { createPrivateDirectory, stableRead, writeExclusiveCanonical } from './sealed-fs.js'

type Route = Readonly<{
  route_ordinal: number
  receiver_instance_id: string
  host: '127.0.0.1'
  port: number
  expected_selected: boolean
  listener_identity_sha256: string
}>

export type ReceiverAuthority = Readonly<{
  schema_id: 'oracle-lab-p3b-receiver-authority.v1'
  campaign_id: string
  ledger_sha256: string
  run_id: string
  sequence_index: number
  receiver_group_id: string
  receiver_pid: number
  receiver_executable_identity_sha256: string
  receiver_source_sha256: string
  receiver_schema_sha256: string
  anchor_sha256: string
  response_program_sha256: string
  routes: readonly Route[]
  authority_sha256: string
}>

export type ReceiverTargetBootstrap = Readonly<{
  launch_authority_sha256: string
  selected_base_url: string
  alternate_base_url: string | null
  route_urls: readonly string[]
  custom_headers: string
}>

export type ReceiverResult = Readonly<{
  schema_id: 'oracle-lab-p3b-receiver-result.v1'
  campaign_id: string
  ledger_sha256: string
  run_id: string
  sequence_index: number
  receiver_group_id: string
  receiver_authority_sha256: string
  request_count: number
  response_count: number
  route_request_counts: readonly number[]
  attempt_ordinals: readonly number[]
  connection_ordinals: readonly number[]
  action_ordinals: readonly number[]
  observation_sha256s: readonly string[]
  receiver_terminal: 'sealed'
  result_sha256: string
}>

type MutableRoute = Route & { server: Server; requestCount: number }
type ReceiverState = {
  controller: ProductionController
  row: RunLedgerRow
  authority: ReceiverAuthority
  routes: MutableRoute[]
  armed: boolean
  sealed: boolean
  launchAuthority: LaunchAuthorityReceipt | null
  targetPid: number | null
  executableIdentitySha256: string | null
  targetInstanceId: string | null
  capability: string | null
  targetReady: Promise<void>
  resolveTargetReady: (() => void) | null
  observations: Array<Readonly<Record<string, unknown>>>
  activeRequests: number
  nextConnectionOrdinal: number
  connectionOrdinals: WeakMap<Socket, number>
  violationCode: string | null
}

const receivers = new WeakMap<object, ReceiverState>()
const results = new WeakSet<object>()
const RECEIVER_SCHEMA_SHA256 = sha256Canonical({ schema_id: 'oracle-lab-p3b-receiver-wire.v1', body_limit: 1_048_576, header_limit: 64, attempts: 'program-bound', raw_persistence: false })

function expectedSelectedRoute(row: RunLedgerRow): number {
  if (row.route_count === 1) return 0
  if (row.family !== 'config' || row.schedule_id === 'config-precedence-process-env-vs-local') return 0
  return row.arm.startsWith('treatment/') ? 1 : 0
}

function executableIdentity(): string {
  const identity = stableRead(process.execPath, { maximumBytes: 134_217_728 }).identity
  return sha256Canonical(identity)
}

function verifyListenerOwnership(port: number): string {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Phase3BProductionError('receiver_not_loopback', 'production listener sealing supports only darwin-arm64')
  const lsof = existsSync('/usr/sbin/lsof') ? '/usr/sbin/lsof' : '/usr/bin/lsof'
  let output: string
  try { output = execFileSync(lsof, ['-nP', '-a', '-p', String(process.pid), `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpn'], { encoding: 'utf8', timeout: 3_000 }) } catch { throw new Phase3BProductionError('receiver_not_loopback', 'OS could not bind listener to receiver PID') }
  if (!output.split('\n').includes(`p${process.pid}`) || !output.split('\n').some((line) => line === `n127.0.0.1:${port}`)) throw new Phase3BProductionError('receiver_not_loopback', 'listener is not owned by the exact receiver PID on IPv4 loopback')
  return sha256Canonical({ receiver_pid: process.pid, receiver_executable_identity_sha256: executableIdentity(), host: '127.0.0.1', port, transport: 'tcp', state: 'LISTEN' })
}

function sourceSha256(): string {
  return stableRead(fileURLToPath(import.meta.url), { maximumBytes: 1_048_576 }).identity.sha256
}

export function captureReceiverRuntimeIdentity(): Readonly<{ receiver_source_sha256: string; receiver_executable_identity_sha256: string; receiver_schema_sha256: string; receiver_pid: number }> {
  return deepFreeze({ receiver_source_sha256: sourceSha256(), receiver_executable_identity_sha256: executableIdentity(), receiver_schema_sha256: RECEIVER_SCHEMA_SHA256, receiver_pid: process.pid })
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') throw new Phase3BProductionError('receiver_not_loopback', 'receiver failed exact IPv4 loopback bind')
  return address.port
}

export async function bindReceiverGroup(controller: ProductionController, row: RunLedgerRow): Promise<ReceiverAuthority> {
  assertProductionController(controller)
  assertControllerLaunchPrerequisites(controller)
  const control = controllerState(controller)
  if (!control.namespaceSealed || control.runtimeRoot === null || control.anchorSha256 === null) throw new Phase3BProductionError('receiver_authority_invalid', 'receiver requires sealed controller namespace')
  const exact = control.ledger.rows[row.sequence_index]
  if (!exact || exact.row_sha256 !== row.row_sha256) throw new Phase3BProductionError('receiver_authority_invalid', 'receiver row is not from immutable ledger')
  createPrivateDirectory(control.runtimeRoot, 'observations')
  createPrivateDirectory(control.runtimeRoot, 'receiver-results')
  createPrivateDirectory(control.runtimeRoot, 'receiver-authorities')
  let boundAuthority: ReceiverAuthority | undefined
  const mutableRoutes: MutableRoute[] = []
  try {
    for (let routeOrdinal = 0; routeOrdinal < row.route_count; routeOrdinal += 1) {
      const server = createServer((request, response) => {
      if (!boundAuthority) { response.destroy(); return }
      void handleRequest(boundAuthority, routeOrdinal, request, response)
      })
      server.on('connection', (socket) => {
      if (!boundAuthority) return
      const state = receivers.get(boundAuthority)
      if (!state || !state.armed || state.sealed) return
      state.connectionOrdinals.set(socket, state.nextConnectionOrdinal)
      state.nextConnectionOrdinal += 1
      })
      server.maxHeadersCount = 64
      server.requestTimeout = 30_000
      server.headersTimeout = 10_000
      const port = await listen(server)
      mutableRoutes.push({ route_ordinal: routeOrdinal, receiver_instance_id: deterministicUuidV4({ campaign_id: control.ledger.campaign_id, run_id: row.run_id, route_ordinal: routeOrdinal, kind: 'receiver-instance' }), host: '127.0.0.1', port, expected_selected: routeOrdinal === expectedSelectedRoute(row), listener_identity_sha256: verifyListenerOwnership(port), server, requestCount: 0 })
    }
  const unsigned = {
    schema_id: 'oracle-lab-p3b-receiver-authority.v1' as const,
    campaign_id: control.ledger.campaign_id,
    ledger_sha256: control.ledger.ledger_sha256,
    run_id: row.run_id,
    sequence_index: row.sequence_index,
    receiver_group_id: row.receiver_group_id,
    receiver_pid: process.pid,
    receiver_executable_identity_sha256: executableIdentity(),
    receiver_source_sha256: sourceSha256(),
    receiver_schema_sha256: RECEIVER_SCHEMA_SHA256,
    anchor_sha256: control.anchorSha256,
    response_program_sha256: row.response_program_sha256,
    routes: mutableRoutes.map(({ server: _server, requestCount: _count, ...route }) => route),
  }
    const authority = deepFreeze({ ...unsigned, authority_sha256: sha256Canonical(unsigned) })
    boundAuthority = authority
    let resolveTargetReady: (() => void) | null = null
    const targetReady = new Promise<void>((resolve) => { resolveTargetReady = resolve })
    receivers.set(authority, { controller, row, authority, routes: mutableRoutes, armed: false, sealed: false, launchAuthority: null, targetPid: null, executableIdentitySha256: null, targetInstanceId: null, capability: null, targetReady, resolveTargetReady, observations: [], activeRequests: 0, nextConnectionOrdinal: 0, connectionOrdinals: new WeakMap(), violationCode: null })
    writeExclusiveCanonical(control.runtimeRoot, `receiver-authorities/${String(row.sequence_index).padStart(3, '0')}-${row.run_id}.json`, authority)
    return authority
  } catch (error: unknown) {
    await Promise.all(mutableRoutes.map((route) => new Promise<void>((resolve) => route.server.close(() => resolve()))))
    throw error
  }
}

export function assertReceiverAuthority(authority: unknown, row?: RunLedgerRow): asserts authority is ReceiverAuthority {
  const state = authority && typeof authority === 'object' ? receivers.get(authority as object) : undefined
  if (!state) throw new Phase3BProductionError('receiver_authority_invalid', 'opaque bound receiver authority is required')
  if (sourceSha256() !== state.authority.receiver_source_sha256 || executableIdentity() !== state.authority.receiver_executable_identity_sha256 || state.authority.authority_sha256 !== sha256Canonical(Object.fromEntries(Object.entries(state.authority).filter(([key]) => key !== 'authority_sha256')))) throw new Phase3BProductionError('receiver_authority_invalid', 'receiver source/executable/authority identity drifted')
  if (!state.sealed && state.authority.routes.some((route) => verifyListenerOwnership(route.port) !== route.listener_identity_sha256)) throw new Phase3BProductionError('receiver_authority_invalid', 'receiver listener PID/executable identity drifted')
  if (row && (state.row.run_id !== row.run_id || state.row.row_sha256 !== row.row_sha256)) throw new Phase3BProductionError('receiver_authority_invalid', 'receiver does not bind row')
}

export function prepareReceiverLaunch(authority: ReceiverAuthority, launchAuthority: LaunchAuthorityReceipt): ReceiverTargetBootstrap {
  assertReceiverAuthority(authority)
  assertLaunchAuthority(launchAuthority, receivers.get(authority)!.row)
  const state = receivers.get(authority)!
  if (state.armed || state.sealed || launchAuthority.receiver_authority_sha256 !== authority.authority_sha256) throw new Phase3BProductionError('receiver_authority_invalid', 'receiver cannot be armed with this launch')
  state.armed = true
  state.launchAuthority = launchAuthority
  state.capability = sha256Canonical({ launch_authority_sha256: launchAuthority.receipt_sha256, receiver_authority_sha256: authority.authority_sha256, nonce: process.hrtime.bigint().toString() })
  const selected = state.routes.find((route) => route.expected_selected)!
  const alternate = state.routes.find((route) => !route.expected_selected)
  const headers = [
    `x-oracle-launch-authority: ${launchAuthority.receipt_sha256}`,
    `x-oracle-target-capability: ${state.capability}`,
    `x-oracle-run-id: ${state.row.run_id}`,
  ].join('\n')
  return deepFreeze({ launch_authority_sha256: launchAuthority.receipt_sha256, selected_base_url: `http://127.0.0.1:${selected.port}`, alternate_base_url: alternate ? `http://127.0.0.1:${alternate.port}` : null, route_urls: state.routes.map((route) => `http://127.0.0.1:${route.port}`), custom_headers: headers })
}

export function registerReceiverTarget(authority: ReceiverAuthority, targetPid: number, executableIdentitySha256: string): string {
  assertReceiverAuthority(authority)
  const state = receivers.get(authority)!
  if (!state.armed || state.targetPid !== null || state.launchAuthority?.executable_identity_sha256 !== executableIdentitySha256 || !Number.isSafeInteger(targetPid) || targetPid <= 0) throw new Phase3BProductionError('receiver_authority_invalid', 'receiver target registration drifted')
  state.targetPid = targetPid
  state.executableIdentitySha256 = executableIdentitySha256
  state.targetInstanceId = deterministicUuidV4({ receiver_authority_sha256: authority.authority_sha256, target_pid: targetPid, executable_identity_sha256: executableIdentitySha256 })
  state.resolveTargetReady?.()
  state.resolveTargetReady = null
  return state.targetInstanceId
}

function verifyPeerOwnership(pid: number, receiverPort: number, executableIdentitySha256: string): void {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Phase3BProductionError('receiver_peer_identity_invalid', 'production receiver supports only darwin-arm64')
  const lsof = existsSync('/usr/sbin/lsof') ? '/usr/sbin/lsof' : '/usr/bin/lsof'
  let output: string
  try { output = execFileSync(lsof, ['-nP', '-a', '-p', String(pid), '-iTCP', '-Fn'], { encoding: 'utf8', timeout: 3_000 }) } catch { throw new Phase3BProductionError('receiver_peer_identity_invalid', 'OS could not bind receiver connection to target PID') }
  if (!output.includes(`->127.0.0.1:${receiverPort}`) && !output.includes(`->localhost:${receiverPort}`)) throw new Phase3BProductionError('receiver_peer_identity_invalid', 'receiver connection is not owned by the sealed target PID')
  let textFiles: string[]
  try { textFiles = execFileSync(lsof, ['-nP', '-a', '-p', String(pid), '-d', 'txt', '-Fn'], { encoding: 'utf8', timeout: 3_000 }).split('\n').filter((line) => line.startsWith('n/')).map((line) => line.slice(1)) } catch { throw new Phase3BProductionError('receiver_peer_identity_invalid', 'OS could not revalidate target executable identity') }
  if (!textFiles.some((file) => { try { return sha256Canonical(stableRead(file, { maximumBytes: 67_108_864 }).identity) === executableIdentitySha256 } catch { return false } })) throw new Phase3BProductionError('receiver_peer_identity_invalid', 'request PID no longer owns the sealed target executable')
}

function normalizeRequestAst(bytes: Buffer): Readonly<Record<string, unknown>> {
  let value: unknown
  try { value = JSON.parse(bytes.toString('utf8')) } catch { throw new Phase3BProductionError('receiver_request_invalid', 'request body is not JSON') }
  const visit = (node: unknown): unknown => {
    if (node === null) return { type: 'null' }
    if (Array.isArray(node)) return { type: 'array', length: node.length, items: node.map(visit) }
    if (typeof node === 'object') return { type: 'object', fields: Object.keys(node as object).sort().map((name) => ({ name, value: visit((node as Record<string, unknown>)[name]) })) }
    if (typeof node === 'string') return { type: 'string', byte_length: Buffer.byteLength(node), value_sha256: sha256Bytes(Buffer.from(node, 'utf8')) }
    if (typeof node === 'number') return { type: 'number' }
    if (typeof node === 'boolean') return { type: 'boolean' }
    return { type: 'unknown' }
  }
  return deepFreeze(visit(value) as Record<string, unknown>)
}

function safeHeaderProjection(request: IncomingMessage): Readonly<{ ordered: readonly Readonly<Record<string, unknown>>[]; presence: Readonly<Record<string, number>>; authMarkerClass: string }> {
  const ordered: Array<Readonly<Record<string, unknown>>> = []
  const presence: Record<string, number> = {}
  const authMarkers: string[] = []
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index].toLowerCase()
    const value = request.rawHeaders[index + 1]
    presence[name] = (presence[name] ?? 0) + 1
    let valueClass = 'present-redacted'
    if (name === 'authorization' || name === 'x-api-key') {
      const marker = classifySyntheticAuthHeader(name, value)
      if (!marker) throw new Phase3BProductionError('receiver_request_invalid', 'unrecognized credential-like header value')
      valueClass = marker
      authMarkers.push(`${name}:${marker}`)
    } else if (name === 'content-type') valueClass = value.toLowerCase().startsWith('application/json') ? 'application-json' : 'other'
    else if (name === 'anthropic-version') valueClass = /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'date-version' : 'other'
    ordered.push({ ordinal: index / 2, name, value_class: valueClass })
  }
  authMarkers.sort((left, right) => left.startsWith('authorization:') === right.startsWith('authorization:') ? left.localeCompare(right) : left.startsWith('authorization:') ? -1 : 1)
  return deepFreeze({ ordered, presence, authMarkerClass: authMarkers.length === 0 ? 'none' : authMarkers.join('+') })
}

async function readBoundedBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.length
    if (total > 1_048_576) throw new Phase3BProductionError('receiver_overflow', 'request body exceeds fixed receiver limit')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks)
}

async function handleRequest(authority: ReceiverAuthority, routeOrdinal: number, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const state = receivers.get(authority)
  if (!state || !state.armed) { response.destroy(); return }
  if (state.sealed || state.activeRequests !== 0) { state.violationCode ??= state.sealed ? 'late_observation' : 'multiple_writer'; response.destroy(); return }
  state.activeRequests += 1
  try {
    await Promise.race([state.targetReady, new Promise((_, reject) => setTimeout(() => reject(new Phase3BProductionError('receiver_target_unbound', 'target PID was not registered in time')), 10_000))])
    if (request.method !== 'POST' || request.url !== '/v1/messages') throw new Phase3BProductionError('receiver_request_invalid', 'only POST /v1/messages is accepted')
    if (request.headers['x-oracle-launch-authority'] !== state.launchAuthority!.receipt_sha256 || request.headers['x-oracle-target-capability'] !== state.capability || request.headers['x-oracle-run-id'] !== state.row.run_id) throw new Phase3BProductionError('receiver_request_invalid', 'request does not carry the controller-installed authority headers')
    const route = state.routes[routeOrdinal]
    verifyPeerOwnership(state.targetPid!, route.port, state.executableIdentitySha256!)
    const attemptOrdinal = state.observations.length
    if (attemptOrdinal >= state.row.response_program.maximum_attempts) throw new Phase3BProductionError('receiver_attempt_overflow', 'request exceeds fixed scenario attempts')
    const action = state.row.response_program.actions[attemptOrdinal]
    const body = await readBoundedBody(request)
    const connectionOrdinal = state.connectionOrdinals.get(request.socket)
    if (connectionOrdinal === undefined) throw new Phase3BProductionError('receiver_peer_identity_invalid', 'request socket was not accepted in the armed receiver epoch')
    const bodyByteLength = body.length
    const bodySha256 = sha256Bytes(body)
    let bodyAst: Readonly<Record<string, unknown>>
    try { bodyAst = normalizeRequestAst(body) } finally { body.fill(0) }
    const headers = safeHeaderProjection(request)
    if (state.row.family === 'auth' && headers.authMarkerClass !== expectedAuthMarkerClass(state.row)) throw new Phase3BProductionError('receiver_request_invalid', 'synthetic auth marker does not match the sealed arm')
    const responseObservation = await sendAction(response, action)
    const requestObservation = {
      schema_id: 'oracle-lab-p3b-wire-observation.v1', campaign_id: authority.campaign_id, ledger_sha256: authority.ledger_sha256,
      run_id: state.row.run_id, sequence_index: state.row.sequence_index, receiver_group_id: authority.receiver_group_id,
      receiver_instance_id: route.receiver_instance_id, receiver_authority_sha256: authority.authority_sha256,
      target_pid: state.targetPid, target_instance_id: state.targetInstanceId, executable_identity_sha256: state.executableIdentitySha256,
      route_ordinal: routeOrdinal, connection_ordinal: connectionOrdinal, attempt_ordinal: attemptOrdinal, action_ordinal: action.action_ordinal,
      method: 'POST', path: '/v1/messages', query_present: false, ordered_header_classes: headers.ordered, header_presence: headers.presence, auth_marker_winner_class: headers.authMarkerClass,
      body_byte_length: bodyByteLength, body_sha256: bodySha256, body_ast: bodyAst, response_program_sha256: state.row.response_program_sha256,
      response: responseObservation,
    }
    const observation = deepFreeze({ ...requestObservation, observation_sha256: sha256Canonical(requestObservation) })
    const runtimeRoot = controllerState(state.controller).runtimeRoot!
    writeExclusiveCanonical(runtimeRoot, `observations/${String(state.row.sequence_index).padStart(3, '0')}-${state.row.run_id}-${String(attemptOrdinal).padStart(2, '0')}.json`, observation)
    state.observations.push(observation)
    route.requestCount += 1
  } catch (error: unknown) {
    state.violationCode ??= String((error as { code?: string }).code ?? 'receiver_request_invalid')
    response.destroy()
  } finally { state.activeRequests -= 1 }
}

async function sendAction(response: ServerResponse, action: ResponseAction): Promise<Readonly<Record<string, unknown>>> {
  if (action.delay_ms > 0) await new Promise((resolve) => setTimeout(resolve, action.delay_ms))
  if (action.kind === 'reset') {
    response.socket?.destroy()
    return deepFreeze({ status: null, ordered_header_classes: [], body_byte_length: 0, body_sha256: sha256Bytes(Buffer.alloc(0)), sse_event_order: [], transport_terminal: 'reset_before_headers', timing_bucket: 'not_observed' })
  }
  const body = Buffer.from(materializeResponseBody(action.body_kind), 'utf8')
  response.statusCode = action.status!
  for (const header of action.ordered_headers) response.setHeader(header.name, header.value_class === 'text/event-stream' ? 'text/event-stream' : 'application/json')
  await new Promise<void>((resolve) => response.end(body, () => resolve()))
  const eventOrder = action.body_kind === 'complete_sse' ? ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop'] : action.body_kind === 'partial_sse' ? ['message_start', 'content_block_start', 'content_block_delta'] : []
  return deepFreeze({ status: action.status, ordered_header_classes: action.ordered_headers, body_byte_length: body.length, body_sha256: sha256Bytes(body), sse_event_order: eventOrder, transport_terminal: action.transport_terminal, timing_bucket: action.delay_class === 'bounded_before_headers' ? 'at_or_after_boundary' : 'not_observed' })
}

export async function sealReceiverGroup(authority: ReceiverAuthority): Promise<ReceiverResult> {
  assertReceiverAuthority(authority)
  const state = receivers.get(authority)!
  if (!state.armed || state.sealed || state.activeRequests !== 0) throw new Phase3BProductionError('receiver_terminal_invalid', 'receiver is not in a sealable armed state')
  state.sealed = true
  await Promise.all(state.routes.map((route) => new Promise<void>((resolve, reject) => route.server.close((error) => error ? reject(error) : resolve()))))
  assertReceiverAuthority(authority, state.row)
  const routeCounts = state.routes.map((route) => route.requestCount)
  const selected = state.routes.findIndex((route) => route.expected_selected)
  const observedConnections = [...new Set(state.observations.map((observation) => Number(observation.connection_ordinal)))].sort((left, right) => left - right)
  if (state.violationCode !== null || state.observations.length === 0 || routeCounts[selected] === 0 || routeCounts.some((count, index) => index === selected ? false : count !== 0) || state.observations.length !== state.row.response_program.maximum_attempts || observedConnections.length !== state.nextConnectionOrdinal || observedConnections.some((value, index) => value !== index)) throw new Phase3BProductionError('receiver_terminal_invalid', 'receiver violation, zero-request, route selection, connection, or exact attempt predicate failed')
  const unsigned = {
    schema_id: 'oracle-lab-p3b-receiver-result.v1' as const,
    campaign_id: authority.campaign_id,
    ledger_sha256: authority.ledger_sha256,
    run_id: state.row.run_id,
    sequence_index: state.row.sequence_index,
    receiver_group_id: authority.receiver_group_id,
    receiver_authority_sha256: authority.authority_sha256,
    request_count: state.observations.length,
    response_count: state.observations.length,
    route_request_counts: routeCounts,
    attempt_ordinals: state.observations.map((observation) => Number(observation.attempt_ordinal)),
    connection_ordinals: state.observations.map((observation) => Number(observation.connection_ordinal)),
    action_ordinals: state.observations.map((observation) => Number(observation.action_ordinal)),
    observation_sha256s: state.observations.map((observation) => String(observation.observation_sha256)),
    receiver_terminal: 'sealed' as const,
  }
  const result = deepFreeze({ ...unsigned, result_sha256: sha256Canonical(unsigned) })
  results.add(result)
  writeExclusiveCanonical(controllerState(state.controller).runtimeRoot!, `receiver-results/${String(state.row.sequence_index).padStart(3, '0')}-${state.row.run_id}.json`, result)
  return result
}

export async function abortReceiverGroup(authority: ReceiverAuthority): Promise<void> {
  const state = receivers.get(authority as object)
  if (!state || state.sealed) return
  state.sealed = true
  await Promise.all(state.routes.map((route) => new Promise<void>((resolve) => route.server.close(() => resolve()))))
}

export function assertReceiverResult(result: unknown, row?: RunLedgerRow): asserts result is ReceiverResult {
  if (!result || typeof result !== 'object' || !results.has(result as object)) throw new Phase3BProductionError('receiver_terminal_invalid', 'opaque receiver result is required')
  const value = result as ReceiverResult
  if (value.result_sha256 !== sha256Canonical(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'result_sha256')))) throw new Phase3BProductionError('receiver_terminal_invalid', 'receiver result digest drifted')
  if (row && (value.run_id !== row.run_id || value.sequence_index !== row.sequence_index)) throw new Phase3BProductionError('receiver_terminal_invalid', 'receiver result does not bind row')
}
