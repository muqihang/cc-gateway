import { parseStrictJson } from '../../../src/oracle-contract/strict-json.js'
import {
  EvidenceSufficiencyError,
  canonicalEvidenceBytes,
  sha256Bytes,
} from './core.js'

export type SyntheticLiteralTable = Record<string, string>

type NullNode = { kind: 'null' }
type BooleanNode = { kind: 'boolean'; value: boolean }
type NumberNode = { kind: 'number'; value: number }
type EnumNode = { kind: 'enum'; value: string }
type LiteralNode = { kind: 'literal'; literal_id: string }
type DigestNode = { kind: 'digest'; byte_length: number; sha256: string }
type ArrayNode = { kind: 'array'; items: NormalizedJsonNode[] }
type ObjectNode = { kind: 'object'; members: Array<{ name: string; value: NormalizedJsonNode }> }

export type NormalizedJsonNode = NullNode | BooleanNode | NumberNode | EnumNode | LiteralNode | DigestNode | ArrayNode | ObjectNode

export type TypedRequestAst = {
  schema_id: 'oracle-lab-p3b-es-request-ast.v1'
  top_level_order: string[]
  present_fields: string[]
  omitted_fields: string[]
  materializable: boolean
  root: ObjectNode
}

export type NormalizedWireRequest = {
  method: string
  path: string
  ordered_query_items: Array<{ name: string; value: LiteralNode | DigestNode | EnumNode }>
  ordered_header_names: string[]
  header_presence: string[]
  header_multiplicity: Record<string, number>
  safe_header_value_classes: string[]
  auth_marker_winner_class: string
  content_type_class: string
  charset_class: string
  content_encoding_class: string
  transfer_encoding_class: string
  body_byte_length: number
  canonical_body_sha256: string
  typed_request_ast: TypedRequestAst
  raw_material_persisted: false
}

const PROTOCOL_ENUMS = new Set([
  'user', 'assistant', 'system', 'text', 'tool_use', 'tool_result', 'input_json_delta', 'text_delta',
  'message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta',
  'message_stop', 'auto', 'any', 'none', 'object', 'array', 'string', 'integer', 'number', 'boolean', 'null',
  'end_turn', 'max_tokens', 'stop_sequence', 'tool_use',
])

const EXPECTED_TOP_LEVEL = ['model', 'max_tokens', 'messages', 'system', 'tools', 'tool_choice', 'stream'] as const
const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'x-api-key', 'anthropic-api-key'])
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/
const SAFE_OBJECT_NAME = /^[A-Za-z_$][A-Za-z0-9_$.-]{0,127}$/

function fail(code: string, message: string, jsonPath = '$'): never {
  throw new EvidenceSufficiencyError(code, message, jsonPath)
}

function inverseLiteralTable(table: SyntheticLiteralTable): Map<string, string> {
  const inverse = new Map<string, string>()
  for (const [id, value] of Object.entries(table)) {
    if (!/^[a-z][a-z0-9_.-]{0,95}$/.test(id) || Buffer.byteLength(value) > 4096) fail('schema_invalid', 'literal table is not bounded')
    if (inverse.has(value)) fail('literal_table_ambiguous', 'literal table values must be byte-unique')
    inverse.set(value, id)
  }
  return inverse
}

function encodeString(value: string, literals: Map<string, string>): EnumNode | LiteralNode | DigestNode {
  if (PROTOCOL_ENUMS.has(value)) return { kind: 'enum', value }
  const literalId = literals.get(value)
  if (literalId) return { kind: 'literal', literal_id: literalId }
  const bytes = Buffer.from(value, 'utf8')
  const node: DigestNode = { kind: 'digest', byte_length: bytes.length, sha256: sha256Bytes(bytes) }
  bytes.fill(0)
  return node
}

function encodeNode(value: unknown, literals: Map<string, string>, location = '$'): NormalizedJsonNode {
  if (value === null) return { kind: 'null' }
  if (typeof value === 'boolean') return { kind: 'boolean', value }
  if (typeof value === 'number') return { kind: 'number', value }
  if (typeof value === 'string') return encodeString(value, literals)
  if (Array.isArray(value)) return { kind: 'array', items: value.map((item, index) => encodeNode(item, literals, `${location}[${index}]`)) }
  if (!value || typeof value !== 'object') fail('schema_invalid', `${location} is not a JSON value`, location)
  const members: ObjectNode['members'] = []
  for (const [name, member] of Object.entries(value as Record<string, unknown>)) {
    if (!SAFE_OBJECT_NAME.test(name)) fail('request_field_uncovered', `${location} has an unsafe field name`, location)
    members.push({ name, value: encodeNode(member, literals, `${location}.${name}`) })
  }
  return { kind: 'object', members }
}

function isMaterializable(node: NormalizedJsonNode): boolean {
  if (node.kind === 'digest') return false
  if (node.kind === 'array') return node.items.every(isMaterializable)
  if (node.kind === 'object') return node.members.every((member) => isMaterializable(member.value))
  return true
}

function materializeNode(node: NormalizedJsonNode, literals: SyntheticLiteralTable): unknown {
  switch (node.kind) {
    case 'null': return null
    case 'boolean': return node.value
    case 'number': return node.value
    case 'enum': return node.value
    case 'literal': {
      if (!Object.prototype.hasOwnProperty.call(literals, node.literal_id)) fail('request_literal_unmaterializable', `literal ${node.literal_id} is missing`)
      return literals[node.literal_id]
    }
    case 'digest': return fail('request_literal_unmaterializable', 'digest-only request node cannot be materialized')
    case 'array': return node.items.map((item) => materializeNode(item, literals))
    case 'object': return Object.fromEntries(node.members.map((member) => [member.name, materializeNode(member.value, literals)]))
  }
}

function classifyContentType(value: string): { content_type_class: string; charset_class: string } {
  const parts = value.split(';').map((part) => part.trim().toLowerCase())
  const contentType = parts[0] === 'application/json' ? 'application-json' : parts[0] === 'text/event-stream' ? 'text-event-stream' : 'other-redacted'
  const charset = parts.slice(1).find((part) => part.startsWith('charset='))?.slice('charset='.length)
  return { content_type_class: contentType, charset_class: charset === undefined ? 'absent' : charset === 'utf-8' || charset === 'utf8' ? 'utf-8' : 'other-redacted' }
}

function classifyOrdinaryHeader(name: string, value: string): string {
  if (name === 'content-type') return classifyContentType(value).content_type_class
  if (name === 'content-length') return /^\d+$/.test(value) ? 'decimal-byte-length' : 'invalid-redacted'
  if (name === 'content-encoding') return value.toLowerCase() === 'identity' ? 'identity' : value.toLowerCase() === 'gzip' ? 'gzip' : 'other-redacted'
  if (name === 'transfer-encoding') return value.toLowerCase() === 'chunked' ? 'chunked' : 'other-redacted'
  if (name === 'host') return 'loopback-authority'
  if (name === 'connection') return 'connection-token-redacted'
  return value.length === 0 ? 'empty' : 'present-redacted'
}

function safeQueryItem(value: string, literals: Map<string, string>): LiteralNode | DigestNode | EnumNode {
  return encodeString(value, literals)
}

export function materializeRequestBody(ast: TypedRequestAst, literals: SyntheticLiteralTable): { bytes: Buffer; sha256: string; materializable: true } {
  if (!ast.materializable || !isMaterializable(ast.root)) fail('request_literal_unmaterializable', 'request AST is diagnostic-only')
  const value = materializeNode(ast.root, literals)
  const bytes = canonicalEvidenceBytes(value)
  return { bytes, sha256: sha256Bytes(bytes), materializable: true }
}

export function normalizeWireRequest(input: {
  method: string
  request_target: string
  raw_headers: readonly string[]
  body: Uint8Array
  literal_table: SyntheticLiteralTable
  synthetic_auth_markers: Record<string, string>
  limits: { body_bytes: number; headers: number }
}): NormalizedWireRequest {
  if (!/^[A-Z]{1,16}$/.test(input.method)) fail('request_field_uncovered', 'HTTP method is not a closed uppercase token')
  if (input.raw_headers.length % 2 !== 0) fail('receiver_header_invalid', 'rawHeaders must contain name/value pairs')
  if (input.raw_headers.length / 2 > input.limits.headers) fail('receiver_header_overflow', 'receiver header limit exceeded')
  if (input.body.byteLength > input.limits.body_bytes) fail('receiver_body_overflow', 'receiver body limit exceeded')
  if (!input.request_target.startsWith('/') || /[\r\n#]/.test(input.request_target)) fail('request_field_uncovered', 'request target is not a safe origin-form target')

  const literals = inverseLiteralTable(input.literal_table)
  const markerEntries = Object.entries(input.synthetic_auth_markers)
  if (new Set(markerEntries.map((entry) => entry[1])).size !== markerEntries.length) fail('auth_value_unsafe', 'synthetic auth marker values must be unique')
  const markerByValue = new Map(markerEntries.map(([markerClass, value]) => [value, markerClass]))
  const url = new URL(input.request_target, 'http://127.0.0.1')
  const orderedQueryItems = [...url.searchParams.entries()].map(([name, value]) => {
    if (!SAFE_OBJECT_NAME.test(name)) fail('request_field_uncovered', 'query name is not a bounded safe identifier')
    return { name, value: safeQueryItem(value, literals) }
  })

  const orderedHeaderNames: string[] = []
  const presence: string[] = []
  const multiplicity: Record<string, number> = {}
  const safeClasses: string[] = []
  const authClasses: string[] = []
  let contentTypeClass = 'absent'
  let charsetClass = 'absent'
  let contentEncodingClass = 'absent'
  let transferEncodingClass = 'absent'
  for (let index = 0; index < input.raw_headers.length; index += 2) {
    const originalName = input.raw_headers[index]
    const value = input.raw_headers[index + 1]
    if (!HEADER_NAME.test(originalName) || /[\r\n]/.test(value)) fail('receiver_header_invalid', 'header name or value is malformed')
    const name = originalName.toLowerCase()
    orderedHeaderNames.push(name)
    if (!(name in multiplicity)) presence.push(name)
    multiplicity[name] = (multiplicity[name] ?? 0) + 1
    if (CREDENTIAL_HEADERS.has(name)) {
      const marker = markerByValue.get(value)
      if (!marker) fail('leak_detected', `credential-like ${name} value is not campaign-owned`)
      safeClasses.push(`synthetic-marker:${marker}`)
      authClasses.push(marker)
      continue
    }
    safeClasses.push(classifyOrdinaryHeader(name, value))
    if (name === 'content-type') ({ content_type_class: contentTypeClass, charset_class: charsetClass } = classifyContentType(value))
    if (name === 'content-encoding') contentEncodingClass = value.toLowerCase() === 'identity' ? 'identity' : value.toLowerCase() === 'gzip' ? 'gzip' : 'other-redacted'
    if (name === 'transfer-encoding') transferEncodingClass = value.toLowerCase() === 'chunked' ? 'chunked' : 'other-redacted'
  }

  const body = Buffer.from(input.body)
  let parsed: unknown
  try { parsed = parseStrictJson(body) } finally { body.fill(0) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('request_field_uncovered', 'request body must be a JSON object')
  const root = encodeNode(parsed, literals)
  if (root.kind !== 'object') fail('request_field_uncovered', 'request body AST root must be an object')
  const topLevelOrder = root.members.map((member) => member.name)
  const presentFields = [...topLevelOrder]
  const omittedFields = EXPECTED_TOP_LEVEL.filter((field) => !presentFields.includes(field))
  const ast: TypedRequestAst = {
    schema_id: 'oracle-lab-p3b-es-request-ast.v1',
    top_level_order: topLevelOrder,
    present_fields: presentFields,
    omitted_fields: omittedFields,
    materializable: isMaterializable(root),
    root,
  }
  const canonicalBody = canonicalEvidenceBytes(parsed)
  return {
    method: input.method,
    path: url.pathname,
    ordered_query_items: orderedQueryItems,
    ordered_header_names: orderedHeaderNames,
    header_presence: presence,
    header_multiplicity: Object.fromEntries(Object.entries(multiplicity).sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))),
    safe_header_value_classes: safeClasses,
    auth_marker_winner_class: authClasses.at(-1) ?? 'absent',
    content_type_class: contentTypeClass,
    charset_class: charsetClass,
    content_encoding_class: contentEncodingClass,
    transfer_encoding_class: transferEncodingClass,
    body_byte_length: input.body.byteLength,
    canonical_body_sha256: sha256Bytes(canonicalBody),
    typed_request_ast: ast,
    raw_material_persisted: false,
  }
}
