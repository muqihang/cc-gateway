import { createServer, request as httpRequest, type Server } from 'node:http'

import { Phase3AError, sha256Bytes } from '../core.js'

export type SafeForwardProxyEvent = {
  sequence: number
  method: string
  path_class: string
  authority_sha256: string
  decision: 'forwarded-loopback' | 'rejected-authority' | 'rejected-request'
}

export type HttpForwardProxy = { url: string; port: number; events: SafeForwardProxyEvent[]; close(): Promise<void> }

export async function startHttpForwardProxy(options: { upstream_url: string; max_events?: number }): Promise<HttpForwardProxy> {
  const upstream = new URL(options.upstream_url)
  if (upstream.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(upstream.hostname)) {
    throw new Phase3AError('proxy_upstream_invalid', 'forward proxy upstream must be loopback HTTP')
  }
  const maxEvents = options.max_events ?? 10_000
  const events: SafeForwardProxyEvent[] = []
  const server: Server = createServer((request, response) => {
    if (events.length >= maxEvents) { response.writeHead(507); response.end(); return }
    let target: URL
    try { target = new URL(request.url ?? '') } catch {
      events.push({ sequence: events.length, method: request.method ?? 'UNKNOWN', path_class: '/', authority_sha256: sha256Bytes('invalid'), decision: 'rejected-request' })
      response.writeHead(400); response.end(); return
    }
    const pathClass = target.pathname
    if (target.protocol !== 'http:' || !target.hostname.endsWith('.test')) {
      events.push({ sequence: events.length, method: request.method ?? 'UNKNOWN', path_class: pathClass, authority_sha256: sha256Bytes(target.host), decision: 'rejected-authority' })
      response.writeHead(403); response.end(); return
    }
    events.push({ sequence: events.length, method: request.method ?? 'UNKNOWN', path_class: pathClass, authority_sha256: sha256Bytes(target.host), decision: 'forwarded-loopback' })
    const headers = { ...request.headers, host: target.host }
    delete headers['proxy-authorization']; delete headers['proxy-connection']
    const forwarded = httpRequest({
      protocol: 'http:', hostname: upstream.hostname.replace(/^\[|\]$/g, ''), port: upstream.port,
      method: request.method, path: `${target.pathname}${target.search}`, headers,
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
      upstreamResponse.pipe(response)
    })
    forwarded.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end() })
    request.pipe(forwarded)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Phase3AError('proxy_bind_failed', 'forward proxy did not bind loopback TCP')
  return { url: `http://127.0.0.1:${address.port}/`, port: address.port, events, close: () => new Promise((resolve) => server.close(() => resolve())) }
}
