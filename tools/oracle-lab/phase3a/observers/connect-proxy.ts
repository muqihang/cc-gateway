import { createHash } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'

import { Phase3AError } from '../core.js'

export type ConnectEvent = { sequence: number; decision: 'accepted-local-termination' | 'rejected'; target_sha256: string; port: number | null; reason: string }
export type ConnectProxy = { port: number; events: ConnectEvent[]; close(): Promise<void> }

function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }

function parseAuthority(authority: string): { host: string; port: number } | null {
  const ipv6 = authority.match(/^\[([^\]]+)]:(\d{1,5})$/)
  const regular = authority.match(/^([^:\s]+):(\d{1,5})$/)
  const match = ipv6 ?? regular
  if (!match) return null
  const port = Number(match[2])
  return port >= 1 && port <= 65535 ? { host: match[1].toLowerCase(), port } : null
}

export async function startConnectProxy(options: { allowed_targets: Array<{ host: string; port: number }>; max_header_bytes?: number; max_events?: number }): Promise<ConnectProxy> {
  const allowed = new Set(options.allowed_targets.map(({ host, port }) => `${host.toLowerCase()}:${port}`))
  const maxHeader = options.max_header_bytes ?? 16 * 1024
  const maxEvents = options.max_events ?? 10_000
  const events: ConnectEvent[] = []
  const sockets = new Set<Socket>()
  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    const remote = socket.remoteAddress
    if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return }
    let buffered = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      if (events.length >= maxEvents) { socket.end('HTTP/1.1 507 Insufficient Storage\r\n\r\n'); return }
      buffered = Buffer.concat([buffered, chunk])
      if (buffered.length > maxHeader) { socket.end('HTTP/1.1 431 Request Header Fields Too Large\r\n\r\n'); return }
      const end = buffered.indexOf('\r\n\r\n')
      if (end < 0) return
      socket.removeAllListeners('data')
      const firstLine = buffered.subarray(0, end).toString('ascii').split('\r\n')[0]
      buffered.fill(0); buffered = Buffer.alloc(0)
      const match = firstLine.match(/^CONNECT ([^\s]+) HTTP\/1\.[01]$/)
      const target = match ? parseAuthority(match[1]) : null
      const key = target ? `${target.host}:${target.port}` : ''
      if (!target || !allowed.has(key)) {
        events.push({ sequence: events.length, decision: 'rejected', target_sha256: digest(match?.[1] ?? 'invalid'), port: target?.port ?? null, reason: target ? 'target-not-declared' : 'invalid-connect' })
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        return
      }
      events.push({ sequence: events.length, decision: 'accepted-local-termination', target_sha256: digest(target.host), port: target.port, reason: 'declared-target-no-upstream-dial' })
      socket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: oracle-phase3a-local\r\n\r\n')
      // The tunnel terminates here. TLS MITM is a separate explicit observer mode.
      socket.end()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Phase3AError('observer_bind_failed', 'CONNECT observer did not bind TCP')
  return {
    port: address.port,
    events,
    close: () => new Promise((resolve) => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()) }),
  }
}
