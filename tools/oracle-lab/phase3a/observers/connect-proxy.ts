import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer, type Server, type Socket } from 'node:net'
import { createSecureContext, TLSSocket } from 'node:tls'

import { Phase3AError, sha256File } from '../core.js'

export type ConnectEvent = { sequence: number; decision: 'accepted-local-termination' | 'accepted-local-tls' | 'rejected'; target_sha256: string; port: number | null; reason: string }
export type TlsEvent = { sequence: number; decision: 'accepted-local-tls' | 'rejected'; target_sha256: string; protocol: string | null; cipher_bucket: string | null; reason: string }
export type HttpEvent = { sequence: number; method: string; path_class: string; header_names: string[]; body_bytes: number | null; response_status: number }
export type LocalTlsMaterial = { ca_cert_path: string; ca_sha256: string; openssl_sha256: string; leaf_certificate_sha256s: Record<string, string> }
export type ConnectProxy = { port: number; events: ConnectEvent[]; tls_events: TlsEvent[]; http_events: HttpEvent[]; tls?: LocalTlsMaterial; close(): Promise<void> }

type AllowedTarget = { host: string; port: number }
type LocalTlsState = { material: LocalTlsMaterial; root: string; contexts: Map<string, ReturnType<typeof createSecureContext>> }

function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }

function parseAuthority(authority: string): { host: string; port: number } | null {
  const ipv6 = authority.match(/^\[([^\]]+)\]:(\d{1,5})$/)
  const regular = authority.match(/^([^:\s]+):(\d{1,5})$/)
  const match = ipv6 ?? regular
  if (!match) return null
  const port = Number(match[2])
  return port >= 1 && port <= 65535 ? { host: match[1].toLowerCase(), port } : null
}

function validateTargets(targets: AllowedTarget[]): AllowedTarget[] {
  if (targets.length === 0 || targets.length > 32) throw new Phase3AError('observer_target_invalid', 'CONNECT observer requires 1-32 declared targets')
  const seen = new Set<string>()
  return targets.map((target) => {
    const host = target.host.toLowerCase()
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(host) || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
      throw new Phase3AError('observer_target_invalid', 'CONNECT targets must be canonical DNS host and port pairs')
    }
    const key = `${host}:${target.port}`
    if (seen.has(key)) throw new Phase3AError('observer_target_invalid', 'CONNECT targets must be unique')
    seen.add(key)
    return { host, port: target.port }
  })
}

function localOpenSslPath(): string {
  for (const candidate of ['/opt/homebrew/bin/openssl', '/usr/local/bin/openssl', '/usr/bin/openssl']) {
    if (!existsSync(candidate)) continue
    const resolved = realpathSync(candidate)
    if (lstatSync(resolved).isFile()) return resolved
  }
  throw new Phase3AError('observer_local_ca_unavailable', 'no approved local OpenSSL executable is available')
}

function runOpenSsl(executable: string, args: string[]): void {
  const result = spawnSync(executable, args, {
    env: { PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin', HOME: tmpdir(), LANG: 'C', LC_ALL: 'C' },
    stdio: 'ignore', timeout: 30_000,
  })
  if (result.error || result.status !== 0) throw new Phase3AError('observer_local_ca_failed', 'local OpenSSL certificate generation failed')
}

function createLocalTlsState(targets: AllowedTarget[]): LocalTlsState {
  const root = mkdtempSync(path.join(tmpdir(), 'oracle-phase3a-local-ca-'))
  try {
    chmodSync(root, 0o700)
    const openssl = localOpenSslPath()
    const caKey = path.join(root, 'ca-key.pem')
    const caCert = path.join(root, 'ca-cert.pem')
    runOpenSsl(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caKey, '-out', caCert, '-days', '1', '-sha256', '-subj', '/CN=oracle-phase3a-local-ca'])
    chmodSync(caKey, 0o600)
    chmodSync(caCert, 0o600)
    const contexts = new Map<string, ReturnType<typeof createSecureContext>>()
    const leafCertificateSha256s: Record<string, string> = {}
    for (const target of targets) {
      const stem = `${digest(`${target.host}:${target.port}`).slice(0, 16)}-leaf`
      const key = path.join(root, `${stem}-key.pem`)
      const csr = path.join(root, `${stem}.csr`)
      const cert = path.join(root, `${stem}-cert.pem`)
      runOpenSsl(openssl, ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', csr, '-subj', `/CN=${target.host}`, '-addext', `subjectAltName=DNS:${target.host}`])
      runOpenSsl(openssl, ['x509', '-req', '-in', csr, '-CA', caCert, '-CAkey', caKey, '-CAcreateserial', '-out', cert, '-days', '1', '-sha256', '-copy_extensions', 'copy'])
      chmodSync(key, 0o600)
      chmodSync(cert, 0o600)
      contexts.set(`${target.host}:${target.port}`, createSecureContext({ key: readFileSync(key), cert: readFileSync(cert) }))
      leafCertificateSha256s[digest(`${target.host}:${target.port}`)] = sha256File(cert)
    }
    return {
      root,
      contexts,
      material: {
        ca_cert_path: caCert,
        ca_sha256: sha256File(caCert),
        openssl_sha256: sha256File(openssl),
        leaf_certificate_sha256s: leafCertificateSha256s,
      },
    }
  } catch (error) {
    rmSync(root, { recursive: true, force: true })
    throw error
  }
}

function pathClass(target: string): string {
  try {
    const pathname = new URL(target, 'http://loopback.invalid').pathname
    if (pathname === '/v1/messages') return pathname
    if (pathname === '/v1/messages/count_tokens') return pathname
  } catch {}
  return 'other'
}

function response(): Buffer {
  const body = '{"type":"message","synthetic":true}'
  return Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`, 'utf8')
}

export async function startConnectProxy(options: { allowed_targets: AllowedTarget[]; mode?: 'termination' | 'local-tls'; max_header_bytes?: number; max_events?: number }): Promise<ConnectProxy> {
  const targets = validateTargets(options.allowed_targets)
  const allowed = new Set(targets.map(({ host, port }) => `${host}:${port}`))
  const mode = options.mode ?? 'termination'
  const maxHeader = options.max_header_bytes ?? 16 * 1024
  const maxEvents = options.max_events ?? 10_000
  if (!Number.isSafeInteger(maxHeader) || maxHeader < 1024 || maxHeader > 1024 * 1024 || !Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 10_000) {
    throw new Phase3AError('observer_limits_invalid', 'CONNECT observer limits are outside the approved bounds')
  }
  const localTls = mode === 'local-tls' ? createLocalTlsState(targets) : null
  const events: ConnectEvent[] = []
  const tlsEvents: TlsEvent[] = []
  const httpEvents: HttpEvent[] = []
  const sockets = new Set<Socket | TLSSocket>()
  const atLimit = () => events.length + tlsEvents.length + httpEvents.length >= maxEvents
  const recordTlsFailure = (target: AllowedTarget, reason: string) => {
    if (!atLimit()) tlsEvents.push({ sequence: tlsEvents.length, decision: 'rejected', target_sha256: digest(target.host), protocol: null, cipher_bucket: null, reason })
  }
  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    const remote = socket.remoteAddress
    if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return }
    let buffered = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      if (atLimit()) { socket.end('HTTP/1.1 507 Insufficient Storage\r\n\r\n'); return }
      buffered = Buffer.concat([buffered, chunk])
      if (buffered.length > maxHeader) { socket.end('HTTP/1.1 431 Request Header Fields Too Large\r\n\r\n'); return }
      const end = buffered.indexOf('\r\n\r\n')
      if (end < 0) return
      socket.removeAllListeners('data')
      const firstLine = buffered.subarray(0, end).toString('ascii').split('\r\n')[0]
      const remainder = Buffer.from(buffered.subarray(end + 4))
      buffered.fill(0); buffered = Buffer.alloc(0)
      const match = firstLine.match(/^CONNECT ([^\s]+) HTTP\/1\.[01]$/)
      const target = match ? parseAuthority(match[1]) : null
      const key = target ? `${target.host}:${target.port}` : ''
      if (!target || !allowed.has(key)) {
        events.push({ sequence: events.length, decision: 'rejected', target_sha256: digest(match?.[1] ?? 'invalid'), port: target?.port ?? null, reason: target ? 'target-not-declared' : 'invalid-connect' })
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        return
      }
      if (mode === 'termination') {
        events.push({ sequence: events.length, decision: 'accepted-local-termination', target_sha256: digest(target.host), port: target.port, reason: 'declared-target-no-upstream-dial' })
        socket.end('HTTP/1.1 200 Connection Established\r\nProxy-Agent: oracle-phase3a-local\r\n\r\n')
        return
      }
      const context = localTls?.contexts.get(key)
      if (!context) {
        events.push({ sequence: events.length, decision: 'rejected', target_sha256: digest(target.host), port: target.port, reason: 'local-certificate-unavailable' })
        socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
        return
      }
      events.push({ sequence: events.length, decision: 'accepted-local-tls', target_sha256: digest(target.host), port: target.port, reason: 'declared-target-local-ca-no-upstream-dial' })
      if (remainder.length > 0) socket.unshift(remainder)
      socket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: oracle-phase3a-local\r\n\r\n')
      const tlsSocket = new TLSSocket(socket, { isServer: true, secureContext: context })
      sockets.add(tlsSocket)
      tlsSocket.once('close', () => sockets.delete(tlsSocket))
      let handshakeComplete = false
      tlsSocket.once('secure', () => {
        handshakeComplete = true
        if (atLimit()) { tlsSocket.end(); return }
        const cipher = tlsSocket.getCipher()
        tlsEvents.push({ sequence: tlsEvents.length, decision: 'accepted-local-tls', target_sha256: digest(target.host), protocol: tlsSocket.getProtocol(), cipher_bucket: cipher?.standardName ?? cipher?.name ?? null, reason: 'trusted-local-ca-handshake' })
        let request = Buffer.alloc(0)
        tlsSocket.on('data', (data) => {
          if (request.length + data.length > maxHeader) { tlsSocket.end(); return }
          request = Buffer.concat([request, data])
          const headerEnd = request.indexOf('\r\n\r\n')
          if (headerEnd < 0) return
          tlsSocket.removeAllListeners('data')
          const lines = request.subarray(0, headerEnd).toString('ascii').split('\r\n')
          const requestLine = lines[0]?.match(/^([A-Z]{1,16}) ([^\s]+) HTTP\/1\.[01]$/)
          if (!requestLine || atLimit()) { tlsSocket.end(); return }
          const contentLength = lines.slice(1).find((line) => /^content-length:/i.test(line))?.slice('content-length:'.length).trim()
          const bodyBytes = contentLength && /^\d{1,9}$/.test(contentLength) ? Number(contentLength) : null
          httpEvents.push({ sequence: httpEvents.length, method: requestLine[1], path_class: pathClass(requestLine[2]), header_names: lines.slice(1).map((line) => line.split(':', 1)[0]?.toLowerCase()).filter((name): name is string => !!name).sort(), body_bytes: bodyBytes, response_status: 200 })
          request.fill(0)
          tlsSocket.end(response())
        })
        tlsSocket.setTimeout(15_000, () => tlsSocket.end())
      })
      tlsSocket.once('error', () => { if (!handshakeComplete) recordTlsFailure(target, 'tls-handshake-failed') })
    })
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Phase3AError('observer_bind_failed', 'CONNECT observer did not bind TCP')
    return {
      port: address.port,
      events,
      tls_events: tlsEvents,
      http_events: httpEvents,
      ...(localTls ? { tls: localTls.material } : {}),
      close: () => new Promise((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => {
          if (localTls) rmSync(localTls.root, { recursive: true, force: true })
          resolve()
        })
      }),
    }
  } catch (error) {
    for (const socket of sockets) socket.destroy()
    server.close()
    if (localTls) rmSync(localTls.root, { recursive: true, force: true })
    throw error
  }
}
