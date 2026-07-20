import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { canonicalJson, Phase3AError, sha256Bytes } from '../core.js'

export type FakeScenario =
  | { kind: 'json'; status?: number; response?: unknown }
  | { kind: 'sse'; events: Array<{ event?: string; data: unknown }>; delay_ms?: number; close_after?: number }
  | { kind: 'anthropic' }
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
}

export type FakeUpstream = { url: string; port: number; events: SafeUpstreamEvent[]; close(): Promise<void> }

function valueClass(name: string, value: string | string[] | undefined): string {
  if (value === undefined) return 'absent'
  const joined = Array.isArray(value) ? value.join(',') : value
  if (name === 'authorization' || name === 'cookie' || name === 'x-api-key') return 'present-redacted'
  if (name === 'content-type') return joined.toLowerCase().includes('json') ? 'json' : 'other'
  if (name === 'content-length') return /^\d+$/.test(joined) ? 'numeric' : 'invalid'
  return joined === '' ? 'empty' : 'present'
}

export function jsonTopology(value: unknown, depth = 0): unknown {
  if (depth > 16) return 'depth-limit'
  if (value === null) return 'null'
  if (Array.isArray(value)) return { type: 'array', length: value.length, items: [...new Set(value.map((entry) => canonicalJson(jsonTopology(entry, depth + 1))))].sort().map((entry) => JSON.parse(entry)) }
  if (typeof value === 'object') return { type: 'object', fields: Object.keys(value as Record<string, unknown>).sort().map((key) => ({ key_sha256: sha256Bytes(key), value: jsonTopology((value as Record<string, unknown>)[key], depth + 1) })) }
  if (typeof value === 'string') return { type: 'string', bytes: Buffer.byteLength(value), sha256: sha256Bytes(value) }
  return { type: typeof value }
}

async function collectRequest(request: IncomingMessage, maxBytes: number): Promise<{ bytes: number; digest: string; topology: unknown; json: unknown }> {
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
      topology = jsonTopology(json)
    } catch { topology = { type: 'invalid-json', bytes } }
  }
  chunks.fill(Buffer.alloc(0))
  return { bytes, digest: hash.digest('hex'), topology, json }
}

function writeAnthropicSse(response: ServerResponse, model: string): void {
  const event = (name: string, data: unknown): void => response.write(`event: ${name}\ndata: ${canonicalJson(data)}\n\n`)
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
  const body = canonicalJson(scenario.response ?? { type: 'message', synthetic: true })
  response.writeHead(scenario.status ?? 200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  response.end(body)
  return `json:${scenario.status ?? 200}`
}

export async function startFakeUpstream(options: { scenario: FakeScenario; max_body_bytes?: number; max_events?: number; host?: '127.0.0.1' | '::1' }): Promise<FakeUpstream> {
  const maxBody = options.max_body_bytes ?? 1024 * 1024
  const maxEvents = options.max_events ?? 10_000
  const events: SafeUpstreamEvent[] = []
  const server: Server = createServer(async (request, response) => {
    const remote = request.socket.remoteAddress
    if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') { response.writeHead(403); response.end(); return }
    if (events.length >= maxEvents) { response.writeHead(507); response.end(); return }
    try {
      const collected = await collectRequest(request, maxBody)
      const names = Object.keys(request.headers).map((name) => name.toLowerCase()).sort()
      const classes = Object.fromEntries(names.map((name) => [name, valueClass(name, request.headers[name])]))
      const responseClass = respond(request, response, options.scenario, collected.json)
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
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
