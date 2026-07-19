import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

import canonicalize from 'canonicalize'

import { oracleError } from './errors.js'
import { parseStrictJson, validateJsonValue } from './strict-json.js'

export function sha256Hex(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function canonicalizeJson(input: string | Uint8Array): Buffer {
  return canonicalizeJsonValue(parseStrictJson(input))
}

export function canonicalizeJsonValue(value: unknown): Buffer {
  validateJsonValue(value)
  const encoded = canonicalize(value)
  if (encoded === undefined) oracleError('json_canonicalization_failed', 'value cannot be represented by RFC 8785 JCS')
  return Buffer.from(encoded)
}

function encodeQueryComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function normalizePathQuery(pathname: string, pairs: ReadonlyArray<readonly [string, string]>): string {
  if (!pathname.startsWith('/') || /[\r\n?#]/.test(pathname)) oracleError('url_path_invalid', 'path must be an absolute path without query, fragment, or control characters')
  const ordered = pairs.map((pair, index) => ({ key: pair[0], value: pair[1], index }))
    .sort((left, right) => Buffer.compare(Buffer.from(left.key), Buffer.from(right.key)) || left.index - right.index)
  if (ordered.length === 0) return pathname
  return `${pathname}?${ordered.map(({ key, value }) => `${encodeQueryComponent(key)}=${encodeQueryComponent(value)}`).join('&')}`
}

export function formatAuthority(host: string, port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) oracleError('url_port_invalid', 'port is outside 1..65535')
  if (isIP(host) === 6) return `[${host.toLowerCase()}]:${port}`
  if (isIP(host) === 4 || /^[A-Za-z0-9.-]+$/.test(host)) return `${host.toLowerCase()}:${port}`
  return oracleError('url_host_invalid', 'host is not an IPv4, IPv6, or DNS name')
}
