import { spawnSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { connect, type Socket } from 'node:net'
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSecureContext, connect as connectTls, TLSSocket } from 'node:tls'

import { Phase3AError } from '../core.js'

const UPDATE_AUTHORITY = 'downloads.claude.ai:443'
const CURRENT_VERSION = '2.1.215\n'

export type SafeUpdateProxyEvent = {
  sequence: number
  method: 'GET' | 'other'
  path_class: 'version-check' | 'manifest' | 'binary' | 'unsupported'
  response_class: 'current-version' | 'no-platform' | 'not-found'
}

export type UpdateLoopbackProxy = {
  url: string
  port: number
  events: SafeUpdateProxyEvent[]
  close(): Promise<void>
}

function certificate(): { context: ReturnType<typeof createSecureContext>; close(): void } {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'oracle-phase3a-update-cert-'))
  const key = path.join(directory, 'key.pem')
  const cert = path.join(directory, 'cert.pem')
  try {
    const result = spawnSync('/usr/bin/openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1',
      '-subj', '/CN=downloads.claude.ai', '-addext', 'subjectAltName=DNS:downloads.claude.ai',
    ], { encoding: 'utf8', timeout: 10_000 })
    if (result.status !== 0) throw new Phase3AError('update_fixture_certificate', 'cannot create the synthetic update certificate')
    chmodSync(key, 0o600)
    return { context: createSecureContext({ key: readFileSync(key), cert: readFileSync(cert) }), close: () => rmSync(directory, { recursive: true, force: true }) }
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    if (error instanceof Phase3AError) throw error
    throw new Phase3AError('update_fixture_certificate', 'cannot create the synthetic update certificate')
  }
}

export function classifyUpdateReleasePath(target: string): SafeUpdateProxyEvent['path_class'] {
  if (/^\/claude-code-releases\/(?:stable|latest|canary)$/.test(target)) return 'version-check'
  if (/^\/claude-code-releases\/\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?\/manifest\.json$/.test(target)) return 'manifest'
  if (/^\/claude-code-releases\/\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?\/[a-z0-9-]+\/claude$/.test(target)) return 'binary'
  return 'unsupported'
}

function respond(socket: TLSSocket, status: number, body: string): void {
  socket.end(`HTTP/1.1 ${status} ${status === 200 ? 'OK' : 'Not Found'}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`)
}

function handleTunnel(socket: Socket, events: SafeUpdateProxyEvent[], context: ReturnType<typeof createSecureContext>, head: Buffer): void {
  socket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: oracle-phase3a-update-loopback\r\n\r\n')
  if (head.length > 0) socket.unshift(head)
  const secure = new TLSSocket(socket, { isServer: true, secureContext: context })
  let buffered = Buffer.alloc(0)
  secure.on('data', (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk])
    if (buffered.length > 16 * 1024) { buffered.fill(0); secure.destroy(); return }
    const end = buffered.indexOf('\r\n\r\n')
    if (end < 0) return
    const firstLine = buffered.subarray(0, end).toString('ascii').split('\r\n', 1)[0]
    buffered.fill(0)
    const match = firstLine.match(/^([A-Z]+) ([^ ]+) HTTP\/1\.[01]$/)
    const pathClass = match ? classifyUpdateReleasePath(match[2]) : 'unsupported'
    const method = match?.[1] === 'GET' ? 'GET' : 'other'
    if (method === 'GET' && pathClass === 'version-check') {
      events.push({ sequence: events.length, method, path_class: pathClass, response_class: 'current-version' })
      respond(secure, 200, CURRENT_VERSION)
    } else if (method === 'GET' && pathClass === 'manifest') {
      events.push({ sequence: events.length, method, path_class: pathClass, response_class: 'no-platform' })
      respond(secure, 200, '{"platforms":{}}')
    } else {
      events.push({ sequence: events.length, method, path_class: pathClass, response_class: 'not-found' })
      respond(secure, 404, '')
    }
  })
}

export async function startUpdateLoopbackProxy(): Promise<UpdateLoopbackProxy> {
  const generated = certificate()
  const events: SafeUpdateProxyEvent[] = []
  const sockets = new Set<Socket>()
  const server: Server = createServer()
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  server.on('connect', (request, socket, head) => {
    if (request.url !== UPDATE_AUTHORITY) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    handleTunnel(socket, events, generated.context, head)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Phase3AError('update_fixture_proxy', 'update loopback proxy did not bind TCP')
    return {
      url: `http://127.0.0.1:${address.port}/`, port: address.port, events,
      close: () => new Promise((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => { generated.close(); resolve() })
      }),
    }
  } catch (error) {
    generated.close()
    throw error
  }
}

export async function runUpdateLoopbackProxySelfTest(): Promise<{ transport: 'loopback-tls-proxy'; response_class: 'current-version' }> {
  const proxy = await startUpdateLoopbackProxy()
  try {
    await new Promise<void>((resolve, reject) => {
      const tunnel = connect(proxy.port, '127.0.0.1')
      let connected = false
      let headers = Buffer.alloc(0)
      const fail = (error: Error) => { tunnel.destroy(); reject(error) }
      tunnel.once('error', fail)
      tunnel.once('connect', () => tunnel.write(`CONNECT ${UPDATE_AUTHORITY} HTTP/1.1\r\nHost: ${UPDATE_AUTHORITY}\r\n\r\n`))
      tunnel.on('data', (chunk: Buffer) => {
        if (connected) return
        headers = Buffer.concat([headers, chunk])
        const end = headers.indexOf('\r\n\r\n')
        if (end < 0) return
        const accepted = headers.subarray(0, end).toString('ascii').startsWith('HTTP/1.1 200')
        headers.fill(0)
        if (!accepted) { fail(new Phase3AError('update_fixture_proxy', 'update loopback proxy rejected its declared tunnel')); return }
        connected = true
        tunnel.removeAllListeners('data')
        const secure = connectTls({ socket: tunnel, servername: 'downloads.claude.ai', rejectUnauthorized: false })
        let response = Buffer.alloc(0)
        secure.once('error', (error) => { response.fill(0); reject(error) })
        secure.once('secureConnect', () => secure.write('GET /claude-code-releases/stable HTTP/1.1\r\nHost: downloads.claude.ai\r\nConnection: close\r\n\r\n'))
        secure.on('data', (part: Buffer) => { response = Buffer.concat([response, part]) })
        secure.once('end', () => {
          const acceptedResponse = response.toString('ascii').startsWith('HTTP/1.1 200') && response.includes(Buffer.from(CURRENT_VERSION, 'utf8'))
          response.fill(0)
          if (acceptedResponse) resolve(); else reject(new Phase3AError('update_fixture_proxy', 'update loopback proxy returned an invalid version response'))
        })
      })
    })
    const event = proxy.events[0]
    if (!event || event.method !== 'GET' || event.path_class !== 'version-check' || event.response_class !== 'current-version') {
      throw new Phase3AError('update_fixture_proxy', 'update loopback proxy did not observe the declared version exchange')
    }
    return { transport: 'loopback-tls-proxy', response_class: 'current-version' }
  } finally { await proxy.close() }
}
