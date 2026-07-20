import { evaluate, parse } from '@humanwhocodes/momoa'

import { OracleContractError, oracleError } from './errors.js'

type AstNode = Record<string, unknown>

function loneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

function inspectNode(node: unknown, location = '$'): void {
  if (!node || typeof node !== 'object') return
  const record = node as AstNode
  if (record.type === 'Object') {
    const seen = new Set<string>()
    for (const rawMember of record.members as unknown[]) {
      const member = rawMember as AstNode
      const name = ((member.name as AstNode).value)
      if (typeof name !== 'string') oracleError('json_invalid', `${location} has a non-string object key`)
      if (seen.has(name)) oracleError('json_duplicate_key', `${location} has duplicate key ${JSON.stringify(name)}`)
      seen.add(name)
      if (loneSurrogate(name)) oracleError('json_lone_surrogate', `${location} has a lone surrogate in an object key`)
      inspectNode(member.value, `${location}.${name}`)
    }
    return
  }
  if (record.type === 'Array') {
    for (const [index, element] of (record.elements as unknown[]).entries()) inspectNode(element, `${location}[${index}]`)
    return
  }
  if (record.type === 'Number') {
    const value = record.value
    if (typeof value !== 'number' || !Number.isFinite(value)) oracleError('json_number_invalid', `${location} is not finite`)
    if (Object.is(value, -0)) oracleError('json_negative_zero', `${location} is negative zero`)
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) oracleError('json_number_unsafe', `${location} exceeds the I-JSON safe integer range`)
    return
  }
  if (record.type === 'String' && typeof record.value === 'string' && loneSurrogate(record.value)) {
    oracleError('json_lone_surrogate', `${location} contains a lone surrogate`)
  }
}

function looksLikeTrailingData(value: string): boolean {
  return /(?:}|]|true|false|null|-?\d(?:\.\d+)?(?:[eE][+-]?\d+)?)\s+\S/.test(value.trim())
}

export function parseStrictJson(input: string | Uint8Array): unknown {
  let text: string
  try {
    text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input)
  } catch {
    oracleError('json_invalid_utf8', 'JSON input is not valid UTF-8')
  }
  try {
    const ast = parse(text)
    inspectNode(ast.body)
    return evaluate(ast)
  } catch (error) {
    if (error instanceof OracleContractError) throw error
    if (looksLikeTrailingData(text)) oracleError('json_trailing_data', 'JSON input has trailing data')
    oracleError('json_invalid', `invalid JSON: ${(error as Error).message}`)
  }
}

export function validateJsonValue(value: unknown, location = '$'): void {
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'string') {
    if (loneSurrogate(value)) oracleError('json_lone_surrogate', `${location} contains a lone surrogate`)
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) oracleError('json_number_invalid', `${location} is not finite`)
    if (Object.is(value, -0)) oracleError('json_negative_zero', `${location} is negative zero`)
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) oracleError('json_number_unsafe', `${location} exceeds the I-JSON safe integer range`)
    return
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) validateJsonValue(item, `${location}[${index}]`)
    return
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (loneSurrogate(key)) oracleError('json_lone_surrogate', `${location} has a lone surrogate in an object key`)
      validateJsonValue(item, `${location}.${key}`)
    }
    return
  }
  oracleError('json_type_invalid', `${location} is not an I-JSON value`)
}
