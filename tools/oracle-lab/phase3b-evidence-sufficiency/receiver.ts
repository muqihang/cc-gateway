import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { fileURLToPath } from 'node:url'

import { type ProductionController, assertProductionController, controllerState } from './controller.js'
import { Phase3BProductionError, assertExactKeys, canonicalBytes, deepFreeze, deterministicUuidV4, sha256Bytes, sha256Canonical } from './core.js'
import type { LaunchAuthorityReceipt } from './launch-authority.js'
import { assertControllerLaunchPrerequisites, assertLaunchAuthority } from './launch-authority.js'
import { BOOTSTRAP_CONTRACT_SCHEMA, CLAUDE_MESSAGES_PATH, CLAUDE_MESSAGES_QUERY, CLAUDE_MESSAGES_REQUEST_CONTRACT, CLAUDE_MESSAGES_REQUEST_TARGET, FIXED_LITERAL_TABLE, FIXED_LITERAL_TABLE_SHA256, TARGET_PROFILE, expectedBootstrapCount, expectedReceiverAttempts, type ResponseAction, type RunLedgerRow, materializeResponseBody } from './ledger.js'
import { classifySyntheticAuthHeader, expectedAuthMarkerClass } from './scenario-input.js'
import { createPrivateDirectory, stableRead, writeExclusiveCanonical } from './sealed-fs.js'
import { expectedBootstrapRoute, expectedSelectedRoute } from './route-policy.js'

type Route = Readonly<{
  route_ordinal: number
  receiver_instance_id: string
  host: '127.0.0.1'
  port: number
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
  selected_route_ordinal: 0 | 1
  bootstrap_contract: RunLedgerRow['bootstrap_contract']
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
  selected_route_ordinal: 0 | 1
  bootstrap_contract: RunLedgerRow['bootstrap_contract']
  bootstrap: Readonly<{
    count: 1
    route_ordinal: number
    receiver_instance_id: string
    raw_socket_ordinal: number
    peer_socket: Readonly<{ target_pid: number; local_address: '127.0.0.1'; local_port: number; remote_address: '127.0.0.1'; remote_port: number; executable_identity_sha256: string; peer_socket_sha256: string }>
    response_status: 200
    response_content_length: 0
    response_finished: true
    socket_closed: true
    socket_close_had_error: false
    post_count_effect: 0
    bootstrap_sha256: string
  }> | Readonly<{
    count: 0
    route_ordinal: null
    receiver_instance_id: null
    raw_socket_ordinal: null
    peer_socket: null
    response_status: null
    response_content_length: null
    response_finished: null
    socket_closed: null
    socket_close_had_error: null
    post_count_effect: 0
    bootstrap_sha256: string
  }>
  request_count: number
  response_count: number
  route_request_counts: readonly number[]
  attempt_ordinals: readonly number[]
  connection_ordinals: readonly number[]
  raw_socket_ordinals: readonly number[]
  action_ordinals: readonly number[]
  observation_sha256s: readonly string[]
  receiver_terminal: 'sealed' | 'sealed_local_auth_failure'
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
  bootstrapCount: number
  bootstrapConnectionOrdinals: number[]
  bootstrapEvidence: ReceiverResult['bootstrap'] | null
  messageConnectionOrdinals: number[]
  activeRequests: number
  nextConnectionOrdinal: number
  connectionOrdinals: WeakMap<Socket, number>
  violationCode: string | null
}

export type ReceiverRequestKind = 'bootstrap_probe' | 'messages'

type CapturedMessagesTarget = Readonly<{ path: string; query_present: true; query_order: readonly string[]; query_items: readonly Readonly<{ name: string; value: string }>[] }>

function parseCanonicalMessagesTarget(value: string | undefined): CapturedMessagesTarget | null {
  if (value !== CLAUDE_MESSAGES_REQUEST_TARGET) return null
  try {
    const parsed = new URL(value, 'http://receiver.invalid')
    const query = [...parsed.searchParams.entries()]
    if (parsed.origin !== 'http://receiver.invalid' || parsed.pathname !== CLAUDE_MESSAGES_PATH || parsed.search !== `?${CLAUDE_MESSAGES_QUERY}` || parsed.hash !== '' || query.length !== 1 || query[0][0] !== 'beta' || query[0][1] !== 'true') return null
    return deepFreeze({ path: parsed.pathname, query_present: true, query_order: query.map(([name]) => name), query_items: query.map(([name, itemValue]) => ({ name, value: itemValue })) })
  } catch { return null }
}

function singleHeader(headers: IncomingMessage['headers'], name: string): string | undefined {
  const value = headers[name]
  if (Array.isArray(value)) throw new Phase3BProductionError('receiver_request_invalid', `${name} must be singular`)
  return value
}

function assertRequestFraming(request: Pick<IncomingMessage, 'method' | 'headers'>): void {
  if (singleHeader(request.headers, 'expect') !== undefined || singleHeader(request.headers, 'upgrade') !== undefined || /(?:^|,)\s*upgrade\s*(?:,|$)/i.test(singleHeader(request.headers, 'connection') ?? '')) throw new Phase3BProductionError('receiver_request_invalid', 'interim or upgraded HTTP is forbidden')
  if (singleHeader(request.headers, 'transfer-encoding') !== undefined) throw new Phase3BProductionError('receiver_request_invalid', 'transfer encoding is forbidden')
  const contentLength = singleHeader(request.headers, 'content-length')
  if (contentLength !== undefined && !/^(?:0|[1-9][0-9]{0,6})$/.test(contentLength)) throw new Phase3BProductionError('receiver_request_invalid', 'content length is ambiguous or invalid')
  if (request.method === 'HEAD' && contentLength !== undefined && contentLength !== '0') throw new Phase3BProductionError('receiver_request_invalid', 'Claude bootstrap probe must have empty framing')
}

function assertRawRequestFraming(request: IncomingMessage): void {
  const names = request.rawHeaders.filter((_value, index) => index % 2 === 0).map((name) => name.toLowerCase())
  for (const name of ['content-length', 'transfer-encoding', 'expect', 'upgrade']) if (names.filter((candidate) => candidate === name).length > 1) throw new Phase3BProductionError('receiver_request_invalid', `${name} framing is duplicated`)
  assertRequestFraming(request)
}

export function classifyReceiverRequestBoundary(request: Pick<IncomingMessage, 'method' | 'url' | 'headers'>, row: RunLedgerRow, bootstrapCount: number, observationCount: number): ReceiverRequestKind {
  assertRequestFraming(request)
  const expectedBootstrap = expectedBootstrapCount(row)
  if (expectedBootstrap === 0) {
    if (request.method !== 'POST' || parseCanonicalMessagesTarget(request.url) === null || bootstrapCount !== 0 || observationCount >= row.response_program.maximum_attempts) throw new Phase3BProductionError('receiver_request_invalid', 'config file-precedence row accepts only its canonical messages attempts without a bootstrap probe')
    return 'messages'
  }
  if (request.method === 'HEAD' && request.url === '/') {
    if (bootstrapCount !== 0 || observationCount !== 0) throw new Phase3BProductionError('receiver_request_invalid', 'Claude bootstrap probe must occur exactly once before messages')
    return 'bootstrap_probe'
  }
  if (request.method !== 'POST' || parseCanonicalMessagesTarget(request.url) === null || bootstrapCount !== 1) throw new Phase3BProductionError('receiver_request_invalid', 'only canonical POST /v1/messages?beta=true after the exact bootstrap probe is accepted')
  return 'messages'
}

export function sendClaudeBootstrapProbeResponse(response: ServerResponse): Promise<Readonly<{ response_finished: true; socket_closed: true; socket_close_had_error: false }>> {
  const socket = response.socket
  if (!socket) throw new Phase3BProductionError('receiver_wire_invalid', 'bootstrap response has no owned socket')
  response.sendDate = false
  response.shouldKeepAlive = false
  response.statusCode = 200
  response.setHeader('content-length', '0')
  response.setHeader('connection', 'close')
  return new Promise((resolve, reject) => {
    let finished = false
    response.once('finish', () => { finished = true })
    response.once('error', reject)
    socket.once('error', reject)
    socket.once('close', (hadError: boolean) => {
      if (!finished || hadError) { reject(new Phase3BProductionError('receiver_wire_invalid', 'bootstrap response did not finish with a clean socket close')); return }
      resolve(deepFreeze({ response_finished: true as const, socket_closed: true as const, socket_close_had_error: false as const }))
    })
    response.end()
  })
}

const receivers = new WeakMap<object, ReceiverState>()
const results = new WeakSet<object>()
export const REQUEST_AST_MATERIALIZER = 'typed-json-ast-normalized-safe-v3'
const REQUEST_FIELD_NAMES = [
  'model', 'messages', 'role', 'content', 'stream', 'max_tokens', 'system', 'tools', 'tool_choice', 'type', 'text', 'name', 'input_schema', 'description', 'input', 'stop_sequences', 'temperature', 'top_p', 'top_k', 'metadata',
  '$schema', 'additionalProperties', 'cache_control', 'command', 'context_management', 'dangerouslyDisableSandbox', 'default', 'display', 'edits', 'effort', 'exclusiveMinimum', 'file_path', 'keep', 'limit', 'maximum', 'minimum', 'new_string', 'offset', 'old_string', 'output_config', 'pages', 'properties', 'replace_all', 'required', 'run_in_background', 'thinking', 'timeout', 'user_id',
] as const
const REQUEST_FIELD_IDS = new Map<string, string>(REQUEST_FIELD_NAMES.map((name, index) => [name, `field_${String(index).padStart(2, '0')}`]))
const REQUEST_FIELD_NAMES_BY_ID = new Map<string, string>([...REQUEST_FIELD_IDS].map(([name, id]) => [id, name]))
const SENSITIVE_FIELD_NAME = /(?:secret|token|password|credential|api[_-]?key|cookie|authorization|raw|prompt|home|private)/i
const RECEIVER_SCHEMA_SHA256 = sha256Canonical({ schema_id: 'oracle-lab-p3b-receiver-wire.v1', body_limit: 1_048_576, header_limit: 64, attempts: 'program-bound-with-exact-local-auth-pre-request-terminal', bootstrap_contract: BOOTSTRAP_CONTRACT_SCHEMA, bootstrap_probe: 'ledger-bound-exact-count-source-and-route', request_route: 'ledger-bound-winner-source-and-selected-route-independent-of-preflight-route', zero_bootstrap: 'canonical-messages-first-selected-route-with-empty-explicit-evidence', messages_target: CLAUDE_MESSAGES_REQUEST_CONTRACT, interim_http: 'fail-closed', raw_body_buffer_persistence: false, reversible_wire_persistence: false, typed_normalized_persistence: true, request_ast_materializer: REQUEST_AST_MATERIALIZER })

export type ResponseWireEvent = Readonly<
  | { kind: 'headers'; monotonic_ns: string; bytes: Uint8Array }
  | { kind: 'body'; monotonic_ns: string; bytes: Uint8Array }
  | { kind: 'response_finish'; monotonic_ns: string }
  | { kind: 'socket_end'; monotonic_ns: string }
  | { kind: 'socket_error'; monotonic_ns: string; error_class: string }
  | { kind: 'reset_requested'; monotonic_ns: string }
  | { kind: 'socket_close'; monotonic_ns: string; had_error: boolean }
>

function monotonicOf(event: ResponseWireEvent): bigint {
  if (!/^\d+$/.test(event.monotonic_ns)) throw new Phase3BProductionError('receiver_wire_invalid', 'wire event monotonic time is invalid')
  return BigInt(event.monotonic_ns)
}

export function deriveResponseObservationFromWire(events: readonly ResponseWireEvent[], startedMonotonicNs: bigint, delayBoundaryMs: number): Readonly<Record<string, unknown>> {
  if (events.length === 0 || startedMonotonicNs < 0n || !Number.isSafeInteger(delayBoundaryMs) || delayBoundaryMs < 0) throw new Phase3BProductionError('receiver_wire_invalid', 'wire transcript boundary is invalid')
  let previous = startedMonotonicNs
  let headers: Extract<ResponseWireEvent, { kind: 'headers' }> | null = null
  let responseFinished = false
  let socketEnded = false
  let socketError: string | null = null
  let resetRequested = false
  let closed: Extract<ResponseWireEvent, { kind: 'socket_close' }> | null = null
  const bodyChunks: Buffer[] = []
  let bodyLength = 0
  for (const event of events) {
    const at = monotonicOf(event)
    if (at < previous || closed !== null) throw new Phase3BProductionError('receiver_wire_invalid', 'wire events are reordered or continue after socket close')
    previous = at
    if (event.kind === 'headers') {
      if (headers !== null || bodyChunks.length !== 0 || responseFinished || resetRequested) throw new Phase3BProductionError('receiver_wire_invalid', 'headers must be the first and only header event')
      headers = event
    } else if (event.kind === 'body') {
      if (headers === null || responseFinished || event.bytes.byteLength === 0) throw new Phase3BProductionError('receiver_wire_invalid', 'body bytes must follow headers and precede finish')
      bodyLength += event.bytes.byteLength
      if (bodyLength > 1_048_576) throw new Phase3BProductionError('receiver_wire_invalid', 'observed response body exceeds the fixed limit')
      bodyChunks.push(Buffer.from(event.bytes))
    } else if (event.kind === 'response_finish') {
      if (headers === null || responseFinished || resetRequested) throw new Phase3BProductionError('receiver_wire_invalid', 'response finish has no exact response boundary')
      responseFinished = true
    } else if (event.kind === 'socket_end') {
      if (socketEnded) throw new Phase3BProductionError('receiver_wire_invalid', 'socket end is duplicated')
      socketEnded = true
    } else if (event.kind === 'socket_error') {
      if (socketError !== null || !/^[A-Za-z0-9_.-]{1,64}$/.test(event.error_class)) throw new Phase3BProductionError('receiver_wire_invalid', 'socket error class is invalid or duplicated')
      socketError = event.error_class
    } else if (event.kind === 'reset_requested') {
      if (resetRequested || responseFinished) throw new Phase3BProductionError('receiver_wire_invalid', 'reset request is duplicated or follows finish')
      resetRequested = true
    } else closed = event
  }
  if (closed === null) throw new Phase3BProductionError('receiver_wire_invalid', 'wire transcript has no observed socket close')
  const firstAt = headers ? monotonicOf(headers) : monotonicOf(events[0])
  const elapsed = firstAt - startedMonotonicNs
  const timingBucket = delayBoundaryMs === 0 ? 'not_delayed' : elapsed >= BigInt(delayBoundaryMs) * 1_000_000n ? 'at_or_after_boundary' : 'before_boundary'
  const wireEvents = events.map((event) => event.kind === 'headers' || event.kind === 'body'
    ? { kind: event.kind, monotonic_ns: event.monotonic_ns, byte_length: event.bytes.byteLength, bytes_sha256: sha256Bytes(event.bytes) }
    : event)
  const wireEventSha256 = sha256Canonical(wireEvents)
  const errored = closed.had_error || socketError !== null
  if (headers === null) {
    if (!resetRequested && !errored) throw new Phase3BProductionError('receiver_wire_invalid', 'close before headers has no reset or error cause')
    return deepFreeze({ status: null, ordered_header_classes: [], body_byte_length: 0, body_sha256: sha256Bytes(Buffer.alloc(0)), sse_event_order: [], transport_terminal: 'reset_before_headers', delay_elapsed_ns: elapsed.toString(), timing_bucket: timingBucket, wire_events: wireEvents, wire_event_sha256: wireEventSha256, socket_close_had_error: closed.had_error })
  }
  const headerBytes = Buffer.from(headers.bytes)
  if (headerBytes.length > 65_536 || !headerBytes.subarray(-4).equals(Buffer.from('\r\n\r\n', 'ascii'))) throw new Phase3BProductionError('receiver_wire_invalid', 'observed header block is malformed or oversized')
  const lines = headerBytes.subarray(0, -4).toString('latin1').split('\r\n')
  const statusMatch = /^HTTP\/1\.[01] ([1-5][0-9]{2})(?: |$)/.exec(lines.shift() ?? '')
  if (!statusMatch) throw new Phase3BProductionError('receiver_wire_invalid', 'observed status line is invalid')
  const orderedHeaderClasses: Array<Readonly<{ name: string; value_class: string }>> = []
  for (const line of lines) {
    const separator = line.indexOf(':')
    if (separator <= 0 || /^[ \t]/.test(line)) throw new Phase3BProductionError('receiver_wire_invalid', 'observed header line is invalid')
    const name = line.slice(0, separator).toLowerCase()
    const value = line.slice(separator + 1).trim().toLowerCase()
    if (name === 'content-type') orderedHeaderClasses.push({ name, value_class: value.startsWith('text/event-stream') ? 'text/event-stream' : value.startsWith('application/json') ? 'application/json' : 'other' })
  }
  const body = Buffer.concat(bodyChunks, bodyLength)
  const sseEventOrder = [...body.toString('utf8').matchAll(/^event: ([a-z_]+)$/gm)].map((match) => match[1])
  const partialSse = orderedHeaderClasses.some((header) => header.name === 'content-type' && header.value_class === 'text/event-stream') && !sseEventOrder.includes('message_stop')
  const transportTerminal = errored || resetRequested ? 'reset_after_headers' : responseFinished ? partialSse ? 'eof_after_partial' : 'http_complete' : 'truncated_after_headers'
  return deepFreeze({ status: Number(statusMatch[1]), ordered_header_classes: orderedHeaderClasses, body_byte_length: body.length, body_sha256: sha256Bytes(body), sse_event_order: sseEventOrder, transport_terminal: transportTerminal, delay_elapsed_ns: elapsed.toString(), timing_bucket: timingBucket, wire_events: wireEvents, wire_event_sha256: wireEventSha256, socket_close_had_error: closed.had_error })
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

export function createHardenedReceiverServer(onRequest: (request: IncomingMessage, response: ServerResponse) => void, onProtocolViolation: (code: string, socket?: Socket) => void): Server {
  const server = createServer(onRequest)
  server.on('checkContinue', (_request, response) => {
    onProtocolViolation('receiver_request_invalid')
    response.sendDate = false
    response.shouldKeepAlive = false
    response.writeHead(417, { 'content-length': '0', connection: 'close' })
    response.end()
  })
  server.on('upgrade', (_request, socket) => onProtocolViolation('receiver_request_invalid', socket as Socket))
  server.on('clientError', (_error, socket) => onProtocolViolation('receiver_request_invalid', socket as Socket))
  server.maxHeadersCount = 64
  server.requestTimeout = 30_000
  server.headersTimeout = 10_000
  return server
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
  const rejectProtocolBoundary = (code: string, socket?: Socket): void => {
    if (boundAuthority) {
      const state = receivers.get(boundAuthority)
      if (state && !state.sealed) state.violationCode ??= code
    }
    socket?.destroy()
  }
  try {
    for (let routeOrdinal = 0; routeOrdinal < row.route_count; routeOrdinal += 1) {
      const server = createHardenedReceiverServer((request, response) => {
      if (!boundAuthority) { response.destroy(); return }
      void handleRequest(boundAuthority, routeOrdinal, request, response)
      }, rejectProtocolBoundary)
      server.on('connection', (socket) => {
      if (!boundAuthority) return
      const state = receivers.get(boundAuthority)
      if (!state || !state.armed || state.sealed) return
      state.connectionOrdinals.set(socket, state.nextConnectionOrdinal)
      state.nextConnectionOrdinal += 1
      })
      const port = await listen(server)
      mutableRoutes.push({ route_ordinal: routeOrdinal, receiver_instance_id: deterministicUuidV4({ campaign_id: control.ledger.campaign_id, run_id: row.run_id, route_ordinal: routeOrdinal, kind: 'receiver-instance' }), host: '127.0.0.1', port, listener_identity_sha256: verifyListenerOwnership(port), server, requestCount: 0 })
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
    selected_route_ordinal: expectedSelectedRoute(row),
    bootstrap_contract: row.bootstrap_contract,
    routes: mutableRoutes.map(({ server: _server, requestCount: _count, ...route }) => route),
  }
    const authority = deepFreeze({ ...unsigned, authority_sha256: sha256Canonical(unsigned) })
    boundAuthority = authority
    let resolveTargetReady: (() => void) | null = null
    const targetReady = new Promise<void>((resolve) => { resolveTargetReady = resolve })
    receivers.set(authority, { controller, row, authority, routes: mutableRoutes, armed: false, sealed: false, launchAuthority: null, targetPid: null, executableIdentitySha256: null, targetInstanceId: null, capability: null, targetReady, resolveTargetReady, observations: [], bootstrapCount: 0, bootstrapConnectionOrdinals: [], bootstrapEvidence: null, messageConnectionOrdinals: [], activeRequests: 0, nextConnectionOrdinal: 0, connectionOrdinals: new WeakMap(), violationCode: null })
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
  if (sourceSha256() !== state.authority.receiver_source_sha256 || executableIdentity() !== state.authority.receiver_executable_identity_sha256 || state.authority.selected_route_ordinal !== expectedSelectedRoute(state.row) || sha256Canonical(state.authority.bootstrap_contract) !== sha256Canonical(state.row.bootstrap_contract) || state.authority.authority_sha256 !== sha256Canonical(Object.fromEntries(Object.entries(state.authority).filter(([key]) => key !== 'authority_sha256')))) throw new Phase3BProductionError('receiver_authority_invalid', 'receiver source/executable/route/authority identity drifted')
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
  const selected = state.routes[state.authority.selected_route_ordinal]!
  const alternate = state.routes.find((route) => route.route_ordinal !== state.authority.selected_route_ordinal)
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

type PeerSocketBinding = Readonly<{ target_pid: number; local_address: '127.0.0.1'; local_port: number; remote_address: '127.0.0.1'; remote_port: number; executable_identity_sha256: string; peer_socket_sha256: string }>

function verifyPeerOwnership(pid: number, socket: Socket, executableIdentitySha256: string): PeerSocketBinding {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Phase3BProductionError('receiver_peer_identity_invalid', 'production receiver supports only darwin-arm64')
  const localAddress = socket.localAddress === '::ffff:127.0.0.1' ? '127.0.0.1' : socket.localAddress
  const remoteAddress = socket.remoteAddress === '::ffff:127.0.0.1' ? '127.0.0.1' : socket.remoteAddress
  const localPort = socket.localPort
  const remotePort = socket.remotePort
  if (localAddress !== '127.0.0.1' || remoteAddress !== '127.0.0.1' || !Number.isSafeInteger(localPort) || !Number.isSafeInteger(remotePort) || !localPort || !remotePort) throw new Phase3BProductionError('receiver_peer_identity_invalid', 'accepted request socket is not an exact IPv4 loopback tuple')
  const lsof = existsSync('/usr/sbin/lsof') ? '/usr/sbin/lsof' : '/usr/bin/lsof'
  let output: string
  try { output = execFileSync(lsof, ['-nP', '-a', '-p', String(pid), '-iTCP', '-Fn'], { encoding: 'utf8', timeout: 3_000 }) } catch { throw new Phase3BProductionError('receiver_peer_identity_invalid', 'OS could not bind receiver connection to target PID') }
  const exactTuple = `n127.0.0.1:${remotePort}->127.0.0.1:${localPort}`
  if (!output.split('\n').includes(exactTuple)) throw new Phase3BProductionError('receiver_peer_identity_invalid', 'accepted socket tuple is not owned by the sealed target PID')
  let textFiles: string[]
  try { textFiles = execFileSync(lsof, ['-nP', '-a', '-p', String(pid), '-d', 'txt', '-Fn'], { encoding: 'utf8', timeout: 3_000 }).split('\n').filter((line) => line.startsWith('n/')).map((line) => line.slice(1)) } catch { throw new Phase3BProductionError('receiver_peer_identity_invalid', 'OS could not revalidate target executable identity') }
  if (!textFiles.some((file) => { try { return sha256Canonical(stableRead(file, { maximumBytes: TARGET_PROFILE.maximum_executable_bytes }).identity) === executableIdentitySha256 } catch { return false } })) throw new Phase3BProductionError('receiver_peer_identity_invalid', 'request PID no longer owns the sealed target executable')
  const unsigned = { target_pid: pid, local_address: localAddress, local_port: localPort, remote_address: remoteAddress, remote_port: remotePort, executable_identity_sha256: executableIdentitySha256 }
  return deepFreeze({ ...unsigned, peer_socket_sha256: sha256Canonical(unsigned) } as PeerSocketBinding)
}

function semanticRequestAst(value: unknown): unknown {
  const literals = new Map(Object.entries(FIXED_LITERAL_TABLE).map(([name, literal]) => [literal, `synthetic-literals/${name}`]))
  const createRedactedString = (text: string): Readonly<Record<string, unknown>> => {
    const bytes = Buffer.from(text, 'utf8')
    const byteLength = bytes.byteLength
    const valueSha256 = sha256Bytes(bytes)
    return { type: 'redacted_string', byte_length: byteLength, value_sha256: valueSha256 }
  }
  const visit = (node: unknown): unknown => {
    if (node === null) return { type: 'null' }
    if (Array.isArray(node)) return { type: 'array', length: node.length, items: node.map(visit) }
    if (typeof node === 'object') return { type: 'object', fields: Object.keys(node as object).map((name) => {
      const fieldRef = REQUEST_FIELD_IDS.get(name)
      if (!fieldRef || (SENSITIVE_FIELD_NAME.test(name) && name !== 'max_tokens')) throw new Phase3BProductionError('receiver_request_invalid', 'request contains an unknown or sensitive field name')
      return { field_ref: fieldRef, value: visit((node as Record<string, unknown>)[name]) }
    }) }
    if (typeof node === 'string') {
      if (node === FIXED_LITERAL_TABLE['model.test']) throw new Phase3BProductionError('receiver_request_invalid', 'response-only model literal is forbidden in request input')
      const literalRef = literals.get(node)
      return literalRef ? { type: 'string', byte_length: Buffer.byteLength(node), value_sha256: sha256Bytes(Buffer.from(node, 'utf8')), literal_ref: literalRef } : createRedactedString(node)
    }
    if (typeof node === 'number') return { type: 'number', finite: Number.isFinite(node), value_text: String(node) }
    if (typeof node === 'boolean') return { type: 'boolean', value: node }
    throw new Phase3BProductionError('receiver_request_invalid', 'request body contains a non-JSON value')
  }
  return visit(value)
}

export function normalizeRequestAst(bytes: Buffer): Readonly<Record<string, unknown>> {
  let value: unknown
  try { value = JSON.parse(bytes.toString('utf8')) } catch { throw new Phase3BProductionError('receiver_request_invalid', 'request body is not JSON') }
  const valueAst = semanticRequestAst(value)
  if (!valueAst || typeof valueAst !== 'object' || Array.isArray(valueAst) || (valueAst as Record<string, unknown>).type !== 'object' || !Array.isArray((valueAst as Record<string, unknown>).fields)) throw new Phase3BProductionError('receiver_request_invalid', 'request root must be a typed object')
  const modelFields = ((valueAst as Record<string, unknown>).fields as unknown[]).filter((field) => field && typeof field === 'object' && !Array.isArray(field) && (field as Record<string, unknown>).field_ref === 'field_00')
  if (modelFields.length !== 1 || ((modelFields[0] as Record<string, unknown>).value as Record<string, unknown> | undefined)?.literal_ref !== 'synthetic-literals/request_model_v1') throw new Phase3BProductionError('receiver_request_invalid', 'request root model must be exactly claude-sonnet-4-6')
  const normalized = materializeSemanticAst(valueAst)
  const normalizedBytes = Buffer.concat([canonicalBytes(normalized), Buffer.from('\n', 'utf8')])
  return deepFreeze({ schema_id: 'oracle-lab-p3b-request-ast.v3', materializer: REQUEST_AST_MATERIALIZER, literal_table_sha256: FIXED_LITERAL_TABLE_SHA256, wire_byte_length: bytes.length, wire_sha256: sha256Bytes(bytes), normalized_byte_length: normalizedBytes.length, normalized_sha256: sha256Bytes(normalizedBytes), value: valueAst })
}

export function materializeRequestAst(ast: Record<string, unknown>): Buffer {
  assertExactKeys(ast, ['schema_id', 'materializer', 'literal_table_sha256', 'wire_byte_length', 'wire_sha256', 'normalized_byte_length', 'normalized_sha256', 'value'], 'receiver_request_invalid')
  if (ast.schema_id !== 'oracle-lab-p3b-request-ast.v3' || ast.materializer !== REQUEST_AST_MATERIALIZER || ast.literal_table_sha256 !== FIXED_LITERAL_TABLE_SHA256 || !Number.isSafeInteger(ast.wire_byte_length) || Number(ast.wire_byte_length) <= 0 || !/^[a-f0-9]{64}$/.test(String(ast.wire_sha256))) throw new Phase3BProductionError('receiver_request_invalid', 'request AST materializer metadata drifted')
  const bytes = Buffer.concat([canonicalBytes(materializeSemanticAst(ast.value)), Buffer.from('\n', 'utf8')])
  if (bytes.length !== ast.normalized_byte_length || sha256Bytes(bytes) !== ast.normalized_sha256) throw new Phase3BProductionError('receiver_request_invalid', 'normalized request AST bytes do not match their exact identity')
  return bytes
}

function materializeSemanticAst(node: unknown): unknown {
  if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Phase3BProductionError('receiver_request_invalid', 'typed request AST node is not closed')
  const value = node as Record<string, unknown>
  if (value.type === 'null') return null
  if (value.type === 'array' && Array.isArray(value.items)) return value.items.map(materializeSemanticAst)
  if (value.type === 'object' && Array.isArray(value.fields)) {
    const result: Record<string, unknown> = {}
    for (const field of value.fields) {
      if (!field || typeof field !== 'object' || Array.isArray(field) || typeof (field as Record<string, unknown>).field_ref !== 'string') throw new Phase3BProductionError('receiver_request_invalid', 'typed object field is invalid')
      const fieldRef = String((field as Record<string, unknown>).field_ref)
      const name = REQUEST_FIELD_NAMES_BY_ID.get(fieldRef)
      if (!name || (SENSITIVE_FIELD_NAME.test(name) && name !== 'max_tokens')) throw new Phase3BProductionError('receiver_request_invalid', 'typed object field reference is invalid')
      result[name] = materializeSemanticAst((field as Record<string, unknown>).value)
    }
    return result
  }
  if (value.type === 'string' && typeof value.literal_ref === 'string') {
    const name = value.literal_ref.slice('synthetic-literals/'.length)
    const literal = (FIXED_LITERAL_TABLE as Record<string, string>)[name]
    if (name === 'model.test' || value.literal_ref !== `synthetic-literals/${name}` || literal === undefined || sha256Bytes(Buffer.from(literal, 'utf8')) !== value.value_sha256) throw new Phase3BProductionError('receiver_request_invalid', 'typed literal reference is invalid or response-only')
    return literal
  }
  if (value.type === 'redacted_string') {
    assertExactKeys(value, ['type', 'byte_length', 'value_sha256'], 'receiver_request_invalid')
    if (/^[a-f0-9]{64}$/.test(String(value.value_sha256)) && Number.isSafeInteger(value.byte_length) && Number(value.byte_length) >= 0 && Number(value.byte_length) <= 1_048_576) return `<redacted:${value.value_sha256}>`
  }
  if (value.type === 'number' && typeof value.value_text === 'string' && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value.value_text)) return Number(value.value_text)
  if (value.type === 'boolean' && typeof value.value === 'boolean') return value.value
  throw new Phase3BProductionError('receiver_request_invalid', 'typed request AST node is invalid')
}

function safeHeaderProjection(request: IncomingMessage): Readonly<{ ordered: readonly Readonly<Record<string, unknown>>[]; presence: readonly Readonly<{ header_ref: string; count: number }>[]; authMarkerClass: string }> {
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
  const safePresence = Object.entries(presence).sort(([left], [right]) => left.localeCompare(right)).map(([name, count]) => ({ header_ref: `header_${sha256Bytes(Buffer.from(name, 'utf8')).slice(0, 16)}`, count }))
  return deepFreeze({ ordered, presence: safePresence, authMarkerClass: authMarkers.length === 0 ? 'none' : authMarkers.join('+') })
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
  if (state.sealed || state.activeRequests !== 0 || state.violationCode !== null) { state.violationCode ??= state.sealed ? 'late_observation' : 'multiple_writer'; response.destroy(); return }
  state.activeRequests += 1
  try {
    await Promise.race([state.targetReady, new Promise((_, reject) => setTimeout(() => reject(new Phase3BProductionError('receiver_target_unbound', 'target PID was not registered in time')), 10_000))])
    assertRawRequestFraming(request)
    const requestKind = classifyReceiverRequestBoundary(request, state.row, state.bootstrapCount, state.observations.length)
    const route = state.routes[routeOrdinal]
    const peerSocket = verifyPeerOwnership(state.targetPid!, request.socket, state.executableIdentitySha256!)
    const rawConnectionOrdinal = state.connectionOrdinals.get(request.socket)
    if (rawConnectionOrdinal === undefined) throw new Phase3BProductionError('receiver_peer_identity_invalid', 'request socket was not accepted in the armed receiver epoch')
    if (requestKind === 'bootstrap_probe') {
      if (routeOrdinal !== expectedBootstrapRoute(state.row)) throw new Phase3BProductionError('receiver_request_invalid', 'Claude bootstrap probe reached the wrong preflight route')
      const body = await readBoundedBody(request)
      try {
        if (body.length !== 0) throw new Phase3BProductionError('receiver_request_invalid', 'Claude bootstrap probe carried a body')
      } finally { body.fill(0) }
      const completion = await sendClaudeBootstrapProbeResponse(response)
      const bootstrapUnsigned = { count: 1 as const, route_ordinal: routeOrdinal, receiver_instance_id: route.receiver_instance_id, raw_socket_ordinal: rawConnectionOrdinal, peer_socket: peerSocket, response_status: 200 as const, response_content_length: 0 as const, ...completion, post_count_effect: 0 as const }
      state.bootstrapCount = 1
      state.bootstrapConnectionOrdinals.push(rawConnectionOrdinal)
      state.bootstrapEvidence = deepFreeze({ ...bootstrapUnsigned, bootstrap_sha256: sha256Canonical(bootstrapUnsigned) })
      return
    }
    if (routeOrdinal !== state.authority.selected_route_ordinal) throw new Phase3BProductionError('receiver_request_invalid', 'messages request reached a route other than the sealed selected route')
    if (request.headers['x-oracle-launch-authority'] !== state.launchAuthority!.receipt_sha256 || request.headers['x-oracle-target-capability'] !== state.capability || request.headers['x-oracle-run-id'] !== state.row.run_id) throw new Phase3BProductionError('receiver_request_invalid', 'request does not carry the controller-installed authority headers')
    const attemptOrdinal = state.observations.length
    if (attemptOrdinal >= state.row.response_program.maximum_attempts) throw new Phase3BProductionError('receiver_attempt_overflow', 'request exceeds fixed scenario attempts')
    const connectionOrdinal = state.messageConnectionOrdinals.length
    state.messageConnectionOrdinals.push(rawConnectionOrdinal)
    const target = parseCanonicalMessagesTarget(request.url)
    if (target === null) throw new Phase3BProductionError('receiver_request_invalid', 'accepted request target could not be captured exactly')
    const action = state.row.response_program.actions[attemptOrdinal]
    const body = await readBoundedBody(request)
    const bodyByteLength = body.length
    const bodySha256 = sha256Bytes(body)
    let bodyAst: Readonly<Record<string, unknown>>
    try { bodyAst = normalizeRequestAst(body) } finally { body.fill(0) }
    const bodyAstSha256 = sha256Bytes(Buffer.concat([canonicalBytes(bodyAst), Buffer.from('\n', 'utf8')]))
    const normalized = materializeRequestAst(bodyAst as Record<string, unknown>)
    const bodyRoundtripSha256 = sha256Canonical({ materializer: REQUEST_AST_MATERIALIZER, literal_table_sha256: FIXED_LITERAL_TABLE_SHA256, body_byte_length: bodyByteLength, body_sha256: bodySha256, body_ast_sha256: bodyAstSha256, normalized_byte_length: normalized.length, normalized_sha256: sha256Bytes(normalized) })
    const headers = safeHeaderProjection(request)
    if ((state.row.family === 'auth' || state.row.family === 'config') && headers.authMarkerClass !== expectedAuthMarkerClass(state.row)) throw new Phase3BProductionError('receiver_request_invalid', 'synthetic auth marker does not match the sealed arm')
    const responseObservation = await sendAction(response, action)
    const requestObservation = {
      schema_id: 'oracle-lab-p3b-wire-observation.v1', campaign_id: authority.campaign_id, ledger_sha256: authority.ledger_sha256,
      run_id: state.row.run_id, sequence_index: state.row.sequence_index, receiver_group_id: authority.receiver_group_id,
      receiver_instance_id: route.receiver_instance_id, receiver_authority_sha256: authority.authority_sha256,
      target_pid: state.targetPid, target_instance_id: state.targetInstanceId, executable_identity_sha256: state.executableIdentitySha256,
      route_ordinal: routeOrdinal, connection_ordinal: connectionOrdinal, raw_socket_ordinal: rawConnectionOrdinal, attempt_ordinal: attemptOrdinal, action_ordinal: action.action_ordinal, peer_socket: peerSocket,
      method: 'POST', path: target.path, query_present: target.query_present, query_order: target.query_order, query_items: target.query_items, ordered_header_classes: headers.ordered, header_presence: headers.presence, auth_marker_winner_class: headers.authMarkerClass,
      body_byte_length: bodyByteLength, body_sha256: bodySha256, body_ast: bodyAst, body_ast_sha256: bodyAstSha256, body_normalized_byte_length: normalized.length, body_normalized_sha256: sha256Bytes(normalized), body_roundtrip_sha256: bodyRoundtripSha256, response_program_sha256: state.row.response_program_sha256,
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

function observeResponseLifecycle(response: ServerResponse, socket: Socket, events: ResponseWireEvent[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Phase3BProductionError('receiver_wire_invalid', 'response socket did not reach observed close')), 5_000)
    response.once('finish', () => events.push({ kind: 'response_finish', monotonic_ns: process.hrtime.bigint().toString() }))
    socket.once('end', () => events.push({ kind: 'socket_end', monotonic_ns: process.hrtime.bigint().toString() }))
    socket.once('error', (error: Error & { code?: string }) => {
      const errorClass = String(error.code ?? error.name ?? 'socket_error').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64) || 'socket_error'
      events.push({ kind: 'socket_error', monotonic_ns: process.hrtime.bigint().toString(), error_class: errorClass })
    })
    socket.once('close', (hadError: boolean) => {
      clearTimeout(timer)
      events.push({ kind: 'socket_close', monotonic_ns: process.hrtime.bigint().toString(), had_error: hadError })
      resolve()
    })
  })
}

async function sendAction(response: ServerResponse, action: ResponseAction): Promise<Readonly<Record<string, unknown>>> {
  const started = process.hrtime.bigint()
  if (action.delay_ms > 0) await new Promise((resolve) => setTimeout(resolve, action.delay_ms))
  const socket = response.socket
  if (!socket) throw new Phase3BProductionError('receiver_wire_invalid', 'response has no owned socket')
  if (action.kind === 'reset') {
    const events: ResponseWireEvent[] = [{ kind: 'reset_requested', monotonic_ns: process.hrtime.bigint().toString() }]
    const closed = observeResponseLifecycle(response, socket, events)
    socket.destroy()
    await closed
    return deriveResponseObservationFromWire(events, started, action.delay_ms)
  }
  const body = Buffer.from(materializeResponseBody(action.body_kind), 'utf8')
  const events: ResponseWireEvent[] = []
  let pendingHeaders = Buffer.alloc(0)
  let headersCaptured = false
  const originalWrite = socket.write
  const closed = observeResponseLifecycle(response, socket, events)
  socket.write = function (this: Socket, chunk: Uint8Array | string, ...args: unknown[]): boolean {
    const encoding = typeof args[0] === 'string' && Buffer.isEncoding(args[0]) ? args[0] : 'utf8'
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk)
    if (bytes.length !== 0) {
      const at = process.hrtime.bigint().toString()
      if (!headersCaptured) {
        pendingHeaders = Buffer.concat([pendingHeaders, bytes])
        const boundary = pendingHeaders.indexOf('\r\n\r\n')
        if (boundary >= 0) {
          const end = boundary + 4
          events.push({ kind: 'headers', monotonic_ns: at, bytes: Buffer.from(pendingHeaders.subarray(0, end)) })
          if (pendingHeaders.length > end) events.push({ kind: 'body', monotonic_ns: at, bytes: Buffer.from(pendingHeaders.subarray(end)) })
          pendingHeaders = Buffer.alloc(0)
          headersCaptured = true
        }
      } else events.push({ kind: 'body', monotonic_ns: at, bytes: Buffer.from(bytes) })
    }
    return Reflect.apply(originalWrite, this, [chunk, ...args]) as boolean
  } as typeof socket.write
  try {
    response.sendDate = false
    response.shouldKeepAlive = false
    response.statusCode = action.status!
    for (const header of action.ordered_headers) response.setHeader(header.name, header.value_class === 'text/event-stream' ? 'text/event-stream' : 'application/json')
    response.setHeader('content-length', String(body.length))
    response.setHeader('connection', 'close')
    response.end(body)
    await closed
  } finally { socket.write = originalWrite }
  if (!headersCaptured || pendingHeaders.length !== 0) throw new Phase3BProductionError('receiver_wire_invalid', 'response header bytes were not completely observed')
  return deriveResponseObservationFromWire(events, started, action.delay_ms)
}

export async function sealReceiverGroup(authority: ReceiverAuthority): Promise<ReceiverResult> {
  assertReceiverAuthority(authority)
  const state = receivers.get(authority)!
  if (!state.armed || state.sealed) throw new Phase3BProductionError('receiver_terminal_invalid', 'receiver is not in a sealable armed state')
  const drainDeadline = Date.now() + 10_000
  while (state.activeRequests !== 0 && state.violationCode === null && Date.now() < drainDeadline) await new Promise((resolve) => setTimeout(resolve, 5))
  if (state.activeRequests !== 0) throw new Phase3BProductionError(state.violationCode ?? 'receiver_terminal_invalid', 'receiver request handling did not reach a sealed terminal state')
  state.sealed = true
  await Promise.all(state.routes.map((route) => new Promise<void>((resolve, reject) => route.server.close((error) => error ? reject(error) : resolve()))))
  assertReceiverAuthority(authority, state.row)
  const routeCounts = state.routes.map((route) => route.requestCount)
  const selected = state.authority.selected_route_ordinal
  const bootstrapRoute = expectedBootstrapRoute(state.row)
  const expectedAttempts = expectedReceiverAttempts(state.row)
  const expectedBootstrap = expectedBootstrapCount(state.row)
  const noBootstrapUnsigned = { count: 0 as const, route_ordinal: null, receiver_instance_id: null, raw_socket_ordinal: null, peer_socket: null, response_status: null, response_content_length: null, response_finished: null, socket_closed: null, socket_close_had_error: null, post_count_effect: 0 as const }
  const bootstrap = state.bootstrapEvidence ?? (expectedBootstrap === 0 ? deepFreeze({ ...noBootstrapUnsigned, bootstrap_sha256: sha256Canonical(noBootstrapUnsigned) }) : null)
  const observedConnections = [...new Set(state.observations.map((observation) => Number(observation.connection_ordinal)))].sort((left, right) => left - right)
  const accountedConnections = [...state.bootstrapConnectionOrdinals, ...state.messageConnectionOrdinals].sort((left, right) => left - right)
  const bootstrapValid = bootstrap !== null && bootstrap.bootstrap_sha256 === sha256Canonical(Object.fromEntries(Object.entries(bootstrap).filter(([key]) => key !== 'bootstrap_sha256')))
    && (expectedBootstrap === 1
      ? bootstrap.count === 1 && bootstrap.route_ordinal === bootstrapRoute && bootstrap.receiver_instance_id === state.routes[bootstrapRoute!]?.receiver_instance_id && state.bootstrapCount === 1 && state.bootstrapConnectionOrdinals.length === 1 && bootstrap.raw_socket_ordinal === state.bootstrapConnectionOrdinals[0]
      : bootstrap.count === 0 && bootstrap.route_ordinal === null && state.bootstrapCount === 0 && state.bootstrapConnectionOrdinals.length === 0 && bootstrap.raw_socket_ordinal === null && bootstrap.peer_socket === null)
  if (state.violationCode !== null || !bootstrapValid || state.messageConnectionOrdinals.length !== state.observations.length || observedConnections.length !== state.observations.length || observedConnections.some((value, index) => value !== index) || routeCounts.some((count, index) => count !== (index === selected ? expectedAttempts : 0)) || state.observations.length !== expectedAttempts || accountedConnections.length !== state.nextConnectionOrdinal || accountedConnections.some((value, index) => value !== index) || state.messageConnectionOrdinals.some((value, index) => value !== index + expectedBootstrap)) throw new Phase3BProductionError(state.violationCode ?? 'receiver_terminal_invalid', 'receiver violation, bootstrap, route selection, connection, or exact attempt predicate failed')
  const unsigned = {
    schema_id: 'oracle-lab-p3b-receiver-result.v1' as const,
    campaign_id: authority.campaign_id,
    ledger_sha256: authority.ledger_sha256,
    run_id: state.row.run_id,
    sequence_index: state.row.sequence_index,
    receiver_group_id: authority.receiver_group_id,
    receiver_authority_sha256: authority.authority_sha256,
    selected_route_ordinal: authority.selected_route_ordinal,
    bootstrap_contract: authority.bootstrap_contract,
    bootstrap,
    request_count: state.observations.length,
    response_count: state.observations.length,
    route_request_counts: routeCounts,
    attempt_ordinals: state.observations.map((observation) => Number(observation.attempt_ordinal)),
    connection_ordinals: state.observations.map((observation) => Number(observation.connection_ordinal)),
    raw_socket_ordinals: state.messageConnectionOrdinals,
    action_ordinals: state.observations.map((observation) => Number(observation.action_ordinal)),
    observation_sha256s: state.observations.map((observation) => String(observation.observation_sha256)),
    receiver_terminal: expectedAttempts === 0 ? 'sealed_local_auth_failure' as const : 'sealed' as const,
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
