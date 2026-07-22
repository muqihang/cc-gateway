import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'

import { canonicalJson, Phase3AError, sha256Bytes } from '../core.js'

export type FakeScenario =
  | { kind: 'json'; status?: number; response?: unknown }
  | { kind: 'sse'; events: Array<{ event?: string; data: unknown }>; delay_ms?: number; close_after?: number }
  | { kind: 'anthropic' }
  | { kind: 'update' }
  | { kind: 'reset' }
  | { kind: 'delayed'; delay_ms: number; status?: number }

export type SafeUpstreamEvent = {
  sequence: number
  method: string
  path_class: string
  header_names: string[]
  header_value_classes: Record<string, string>
  body_bytes: number
  body_sha256: string
  body_topology: unknown
  response_class: string
  request_class: 'root' | 'messages' | 'count-tokens' | 'other'
  system_summary: { status: 'observed' | 'absent'; byte_length: number; sha256: string; ast_topology: unknown; span_hashes: Array<{ path_sha256: string; ordinal: number; byte_length: number; sha256: string }> }
  cch_class: 'body-cache-control' | 'header-only' | 'not-observed'
}

export type ObserverStringReplacement = { value: string; replacement: '<HOME>' | '<XDG>' | '<TMP>' | '<CWD>' }
export type ObserverHeaderMarker = { header_name: string; value: string; value_class: string }
export type ObserverNormalization = {
  schema_version: 'oracle-lab-phase3a-observer-normalization.v1'
  status: 'none' | 'declared-path-replacement'
  replacements: Array<{ value_sha256: string; replacement: ObserverStringReplacement['replacement'] }>
}
export type FakeUpstream = { url: string; port: number; events: SafeUpstreamEvent[]; normalization: ObserverNormalization; close(): Promise<void> }

function prepareHeaderMarkers(input: ObserverHeaderMarker[]): Map<string, Map<string, string>> {
  if (input.length > 64) throw new Phase3AError('observer_header_marker_invalid', 'observer accepts at most 64 header markers')
  const markers = new Map<string, Map<string, string>>()
  for (const entry of input) {
    const name = entry.header_name.toLowerCase()
    const syntheticValue = name === 'authorization'
      ? /^Bearer oracle-phase3a-placeholder:[A-Za-z0-9._:-]{1,128}$/.test(entry.value)
      : /^oracle-phase3a-placeholder:[A-Za-z0-9._:-]{1,128}$/.test(entry.value)
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(entry.header_name) || name !== entry.header_name || !syntheticValue || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.value_class)) {
      throw new Phase3AError('observer_header_marker_invalid', 'header markers require a canonical name, synthetic placeholder value, and safe class')
    }
    const byValue = markers.get(name) ?? new Map<string, string>()
    if (byValue.has(entry.value)) throw new Phase3AError('observer_header_marker_invalid', 'header marker values must be unique per header')
    byValue.set(entry.value, entry.value_class)
    markers.set(name, byValue)
  }
  return markers
}

function prepareStringReplacements(input: ObserverStringReplacement[]): { values: ObserverStringReplacement[]; record: ObserverNormalization } {
  if (input.length > 32) throw new Phase3AError('observer_normalization_invalid', 'observer accepts at most 32 string replacements')
  const seen = new Set<string>()
  const values = input.map((entry) => {
    if (!path.isAbsolute(entry.value) || path.resolve(entry.value) !== entry.value || entry.value.length < 8 || entry.value.length > 4096 || entry.value.includes('\0')) {
      throw new Phase3AError('observer_normalization_invalid', 'observer replacement source must be a canonical bounded absolute path')
    }
    if (seen.has(entry.value)) throw new Phase3AError('observer_normalization_invalid', 'observer replacement sources must be unique')
    seen.add(entry.value)
    return { ...entry }
  }).sort((left, right) => right.value.length - left.value.length || left.value.localeCompare(right.value))
  return {
    values,
    record: {
      schema_version: 'oracle-lab-phase3a-observer-normalization.v1',
      status: values.length === 0 ? 'none' : 'declared-path-replacement',
      replacements: values.map((entry) => ({ value_sha256: sha256Bytes(entry.value), replacement: entry.replacement })),
    },
  }
}

function normalizeString(value: string, replacements: ObserverStringReplacement[]): string {
  let output = value
  for (const replacement of replacements) output = output.replaceAll(replacement.value, replacement.replacement)
  return output
}

function normalizeJsonStrings(value: unknown, replacements: ObserverStringReplacement[], depth = 0): unknown {
  if (depth > 16) return value
  if (typeof value === 'string') return normalizeString(value, replacements)
  if (Array.isArray(value)) return value.map((entry) => normalizeJsonStrings(entry, replacements, depth + 1))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, normalizeJsonStrings(child, replacements, depth + 1)]))
  }
  return value
}

function valueClass(name: string, value: string | string[] | undefined, markers: Map<string, Map<string, string>>): string {
  if (value === undefined) return 'absent'
  const joined = Array.isArray(value) ? value.join(',') : value
  const marker = markers.get(name)?.get(joined)
  if (marker) return marker
  if (name === 'authorization' || name === 'cookie' || name === 'x-api-key') return 'present-redacted'
  if (name === 'content-type') return joined.toLowerCase().includes('json') ? 'json' : 'other'
  if (name === 'content-length') return /^\d+$/.test(joined) ? 'numeric' : 'invalid'
  return joined === '' ? 'empty' : 'present'
}

export function jsonTopology(value: unknown, depth = 0, replacements: ObserverStringReplacement[] = []): unknown {
  if (depth > 16) return 'depth-limit'
  if (value === null) return 'null'
  if (Array.isArray(value)) return { type: 'array', length: value.length, items: [...new Set(value.map((entry) => canonicalJson(jsonTopology(entry, depth + 1, replacements))))].sort().map((entry) => JSON.parse(entry)) }
  if (typeof value === 'object') return { type: 'object', fields: Object.keys(value as Record<string, unknown>).sort().map((key) => ({ key_sha256: sha256Bytes(key), value: jsonTopology((value as Record<string, unknown>)[key], depth + 1, replacements) })) }
  if (typeof value === 'string') {
    const normalized = normalizeString(value, replacements)
    return { type: 'string', bytes: Buffer.byteLength(normalized), sha256: sha256Bytes(normalized) }
  }
  return { type: typeof value }
}

async function collectRequest(request: IncomingMessage, maxBytes: number, replacements: ObserverStringReplacement[]): Promise<{ bytes: number; digest: string; topology: unknown; json: unknown }> {
  const hash = createHash('sha256')
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const part of request) {
    const chunk = Buffer.from(part)
    bytes += chunk.length
    if (bytes > maxBytes) throw new Phase3AError('observer_body_overflow', 'request body exceeded observer cap')
    hash.update(chunk)
    chunks.push(chunk)
  }
  let topology: unknown = { type: 'opaque', bytes }
  let json: unknown = null
  const contentType = String(request.headers['content-type'] ?? '')
  if (bytes > 0 && contentType.toLowerCase().includes('json')) {
    try {
      json = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      topology = jsonTopology(json, 0, replacements)
    } catch { topology = { type: 'invalid-json', bytes } }
  }
  chunks.fill(Buffer.alloc(0))
  return { bytes, digest: hash.digest('hex'), topology, json }
}

function hasKey(value: unknown, target: string, depth = 0): boolean {
  if (depth > 16 || value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((entry) => hasKey(entry, target, depth + 1))
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => key === target || hasKey(child, target, depth + 1))
}

function stringSpanHashes(value: unknown): SafeUpstreamEvent['system_summary']['span_hashes'] {
  const spans: SafeUpstreamEvent['system_summary']['span_hashes'] = []
  const visit = (current: unknown, pathValue: string, depth: number): void => {
    if (depth > 16 || spans.length >= 8192) return
    if (typeof current === 'string') {
      current.split('\n').forEach((line, ordinal) => spans.push({ path_sha256: sha256Bytes(pathValue), ordinal, byte_length: Buffer.byteLength(line), sha256: sha256Bytes(line) }))
    } else if (Array.isArray(current)) current.forEach((child, index) => visit(child, `${pathValue}[${index}]`, depth + 1))
    else if (current !== null && typeof current === 'object') for (const key of Object.keys(current as Record<string, unknown>).sort()) visit((current as Record<string, unknown>)[key], `${pathValue}.${sha256Bytes(key)}`, depth + 1)
  }
  visit(value, '$', 0)
  return spans
}

function requestFacts(request: IncomingMessage, parsed: unknown, replacements: ObserverStringReplacement[]): Pick<SafeUpstreamEvent, 'request_class' | 'system_summary' | 'cch_class'> {
  const pathname = new URL(request.url ?? '/', 'http://loopback.invalid').pathname
  const requestClass = pathname.endsWith('/count_tokens') ? 'count-tokens' : pathname.endsWith('/messages') ? 'messages' : pathname === '/' ? 'root' : 'other'
  const body = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  const system = Object.hasOwn(body, 'system') ? body.system : undefined
  const normalizedSystem = system === undefined ? undefined : normalizeJsonStrings(system, replacements)
  const encoded = normalizedSystem === undefined ? '' : canonicalJson(normalizedSystem)
  const systemSummary = system === undefined
    ? { status: 'absent' as const, byte_length: 0, sha256: sha256Bytes(''), ast_topology: { coverage: 'absent' }, span_hashes: [] }
    : { status: 'observed' as const, byte_length: Buffer.byteLength(encoded), sha256: sha256Bytes(encoded), ast_topology: jsonTopology(normalizedSystem), span_hashes: stringSpanHashes(normalizedSystem) }
  const cchClass = hasKey(body, 'cache_control') ? 'body-cache-control' : request.headers['anthropic-beta'] ? 'header-only' : 'not-observed'
  return { request_class: requestClass, system_summary: systemSummary, cch_class: cchClass }
}

function writeAnthropicSse(response: ServerResponse, model: string): void {
  const event = (name: string, data: unknown): void => { response.write(`event: ${name}\ndata: ${canonicalJson(data)}\n\n`) }
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'request-id': 'req_phase3a_synthetic' })
  event('message_start', { type: 'message_start', message: { id: 'msg_phase3a_synthetic', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })
  event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } })
  event('content_block_stop', { type: 'content_block_stop', index: 0 })
  event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
  event('message_stop', { type: 'message_stop' })
  response.end()
}

function respond(request: IncomingMessage, response: ServerResponse, scenario: FakeScenario, parsed: unknown): string {
  if (scenario.kind === 'reset') { response.socket?.destroy(); return 'reset' }
  if (scenario.kind === 'delayed') {
    setTimeout(() => { if (!response.destroyed) { response.writeHead(scenario.status ?? 200); response.end() } }, scenario.delay_ms)
    return `delayed:${scenario.status ?? 200}`
  }
  if (scenario.kind === 'sse') {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const events = scenario.close_after === undefined ? scenario.events : scenario.events.slice(0, scenario.close_after)
    let index = 0
    const send = () => {
      if (index >= events.length) { response.end(); return }
      const event = events[index++]
      if (event.event) response.write(`event: ${event.event}\n`)
      response.write(`data: ${canonicalJson(event.data)}\n\n`)
      if (scenario.delay_ms) setTimeout(send, scenario.delay_ms); else send()
    }
    send()
    return `sse:${events.length}`
  }
  if (scenario.kind === 'anthropic') {
    const path = new URL(request.url ?? '/', 'http://loopback.invalid').pathname
    if (path.endsWith('/count_tokens')) {
      const body = canonicalJson({ input_tokens: 1 })
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'request-id': 'req_phase3a_synthetic' })
      response.end(body)
      return 'anthropic:count-tokens'
    }
    const bodyObject = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
    const model = typeof bodyObject.model === 'string' ? bodyObject.model : 'claude-sonnet-4-6'
    if (bodyObject.stream === true) {
      writeAnthropicSse(response, model)
      return 'anthropic:sse'
    }
    const body = canonicalJson({ id: 'msg_phase3a_synthetic', type: 'message', role: 'assistant', model, content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'request-id': 'req_phase3a_synthetic' })
    response.end(body)
    return 'anthropic:json'
  }
  if (scenario.kind === 'update') {
    const pathname = new URL(request.url ?? '/', 'http://loopback.invalid').pathname
    if (request.method === 'HEAD' && pathname === '/') {
      response.writeHead(204, { 'cache-control': 'no-store', 'content-length': '0' })
      response.end()
      return 'update:root-head'
    }
    response.writeHead(404, { 'content-length': '0' })
    response.end()
    return 'update:unsupported'
  }
  const body = canonicalJson(scenario.response ?? { type: 'message', synthetic: true })
  response.writeHead(scenario.status ?? 200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  response.end(body)
  return `json:${scenario.status ?? 200}`
}

export async function startFakeUpstream(options: { scenario: FakeScenario; max_body_bytes?: number; max_events?: number; host?: '127.0.0.1' | '::1'; string_replacements?: ObserverStringReplacement[]; header_markers?: ObserverHeaderMarker[] }): Promise<FakeUpstream> {
  const maxBody = options.max_body_bytes ?? 1024 * 1024
  const maxEvents = options.max_events ?? 10_000
  const normalization = prepareStringReplacements(options.string_replacements ?? [])
  const headerMarkers = prepareHeaderMarkers(options.header_markers ?? [])
  const events: SafeUpstreamEvent[] = []
  const server: Server = createServer(async (request, response) => {
    const remote = request.socket.remoteAddress
    if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') { response.writeHead(403); response.end(); return }
    if (events.length >= maxEvents) { response.writeHead(507); response.end(); return }
    try {
      const collected = await collectRequest(request, maxBody, normalization.values)
      const names = Object.keys(request.headers).map((name) => name.toLowerCase()).sort()
      const classes = Object.fromEntries(names.map((name) => [name, valueClass(name, request.headers[name], headerMarkers)]))
      const responseClass = respond(request, response, options.scenario, collected.json)
      const facts = requestFacts(request, collected.json, normalization.values)
      events.push({
        sequence: events.length,
        method: request.method ?? 'UNKNOWN',
        path_class: new URL(request.url ?? '/', 'http://loopback.invalid').pathname,
        header_names: names,
        header_value_classes: classes,
        body_bytes: collected.bytes,
        body_sha256: collected.digest,
        body_topology: collected.topology,
        response_class: responseClass,
        ...facts,
      })
    } catch (error) {
      response.writeHead(error instanceof Phase3AError && error.code === 'observer_body_overflow' ? 413 : 400)
      response.end()
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, options.host ?? '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Phase3AError('observer_bind_failed', 'fake upstream did not bind TCP')
  return {
    url: `http://${address.family === 'IPv6' ? `[${address.address}]` : address.address}:${address.port}/`,
    port: address.port,
    events,
    normalization: normalization.record,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
