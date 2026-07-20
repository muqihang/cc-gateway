import { decode, encode, rfc8949EncodeOptions } from 'cborg'

import { OracleContractError, oracleError } from './errors.js'

const MAX_FRAME_BYTES = 65_536
const MAX_NESTING = 32
const MAX_ARRAY_ITEMS = 4_096
const MAX_MAP_PAIRS = 1_024

type ScanResult = { offset: number; text?: string }

function readArgument(data: Uint8Array, offset: number, additional: number): { offset: number; value: number } {
  if (additional < 24) return { offset, value: additional }
  const widths: Record<number, number> = { 24: 1, 25: 2, 26: 4, 27: 8 }
  const width = widths[additional]
  if (!width) {
    if (additional === 31) oracleError('cbor_indefinite_length', 'indefinite-length CBOR is forbidden')
    oracleError('cbor_invalid', 'reserved CBOR additional information')
  }
  if (offset + width > data.length) oracleError('cbor_truncated', 'CBOR argument is truncated')
  let value = 0
  for (let index = 0; index < width; index += 1) {
    value = value * 256 + data[offset + index]
    if (!Number.isSafeInteger(value)) oracleError('cbor_integer_unsafe', 'CBOR integer exceeds the safe range')
  }
  const minimum = width === 1 ? 24 : width === 2 ? 256 : width === 4 ? 65_536 : 4_294_967_296
  if (value < minimum) oracleError('cbor_not_deterministic', 'CBOR integer or length is not shortest form')
  return { offset: offset + width, value }
}

function scanItem(data: Uint8Array, start: number, depth: number): ScanResult {
  if (depth > MAX_NESTING) oracleError('cbor_resource_limit', 'CBOR nesting exceeds the limit')
  if (start >= data.length) oracleError('cbor_truncated', 'CBOR item is truncated')
  const initial = data[start]
  const major = initial >> 5
  const additional = initial & 0x1f
  if (major === 6) oracleError('cbor_tag_forbidden', 'CBOR tags are forbidden')
  if (major === 7) {
    if (additional === 20 || additional === 21 || additional === 22) return { offset: start + 1 }
    if (additional === 25 || additional === 26 || additional === 27) oracleError('cbor_float_forbidden', 'CBOR floats are forbidden')
    if (additional === 23) oracleError('cbor_undefined_forbidden', 'CBOR undefined is forbidden')
    return oracleError('cbor_simple_forbidden', 'CBOR simple values are forbidden')
  }
  const argument = readArgument(data, start + 1, additional)
  if (major === 0 || major === 1) return { offset: argument.offset }
  if (major === 2 || major === 3) {
    const end = argument.offset + argument.value
    if (end > data.length) oracleError('cbor_truncated', 'CBOR string is truncated')
    if (major === 3) {
      try {
        return { offset: end, text: new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(argument.offset, end)) }
      } catch {
        return oracleError('cbor_invalid_utf8', 'CBOR text is not valid UTF-8')
      }
    }
    return { offset: end }
  }
  if (major === 4) {
    if (argument.value > MAX_ARRAY_ITEMS) oracleError('cbor_resource_limit', 'CBOR array exceeds the item limit')
    let offset = argument.offset
    for (let index = 0; index < argument.value; index += 1) offset = scanItem(data, offset, depth + 1).offset
    return { offset }
  }
  if (major === 5) {
    if (argument.value > MAX_MAP_PAIRS) oracleError('cbor_resource_limit', 'CBOR map exceeds the pair limit')
    let offset = argument.offset
    let previousKey: Uint8Array | undefined
    const keys = new Set<string>()
    for (let index = 0; index < argument.value; index += 1) {
      const keyStart = offset
      if ((data[keyStart] >> 5) !== 3) oracleError('cbor_map_key_invalid', 'CBOR map keys must be text')
      const key = scanItem(data, keyStart, depth + 1)
      if (key.text === undefined) oracleError('cbor_map_key_invalid', 'CBOR map key is not text')
      if (keys.has(key.text)) oracleError('cbor_duplicate_key', `duplicate CBOR map key ${JSON.stringify(key.text)}`)
      keys.add(key.text)
      const encodedKey = data.subarray(keyStart, key.offset)
      if (previousKey && Buffer.compare(Buffer.from(previousKey), Buffer.from(encodedKey)) >= 0) {
        oracleError('cbor_not_deterministic', 'CBOR map keys are not in deterministic order')
      }
      previousKey = encodedKey
      offset = scanItem(data, key.offset, depth + 1).offset
    }
    return { offset }
  }
  return oracleError('cbor_invalid', 'unknown CBOR major type')
}

function validateCborValue(value: unknown, location = '$'): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || value instanceof Uint8Array) return
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) oracleError('cbor_integer_unsafe', `${location} is not a safe integer`)
    return
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) oracleError('cbor_resource_limit', `${location} exceeds the array limit`)
    value.forEach((item, index) => validateCborValue(item, `${location}[${index}]`))
    return
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length > MAX_MAP_PAIRS) oracleError('cbor_resource_limit', `${location} exceeds the map limit`)
    entries.forEach(([key, item]) => {
      if (typeof key !== 'string') oracleError('cbor_map_key_invalid', `${location} has a non-text key`)
      validateCborValue(item, `${location}.${key}`)
    })
    return
  }
  oracleError('cbor_type_invalid', `${location} has an unsupported CBOR type`)
}

export function encodeDeterministicCbor(value: unknown): Buffer {
  validateCborValue(value)
  const encoded = Buffer.from(encode(value, rfc8949EncodeOptions))
  scanDeterministicCbor(encoded)
  return encoded
}

function scanDeterministicCbor(data: Uint8Array): void {
  const result = scanItem(data, 0, 0)
  if (result.offset !== data.length) oracleError('cbor_trailing_data', 'CBOR contains trailing data')
}

export function decodeDeterministicCbor(data: Uint8Array): unknown {
  scanDeterministicCbor(data)
  let value: unknown
  try {
    value = decode(data, { strict: true, rejectDuplicateMapKeys: true })
  } catch (error) {
    if (error instanceof OracleContractError) throw error
    oracleError('cbor_invalid', `CBOR decode failed: ${(error as Error).message}`)
  }
  validateCborValue(value)
  const canonical = encodeDeterministicCbor(value)
  if (!canonical.equals(Buffer.from(data))) oracleError('cbor_not_deterministic', 'CBOR bytes do not match deterministic re-encoding')
  return value
}

export function frameCbor(payload: Uint8Array): Buffer {
  if (payload.length === 0 || payload.length > MAX_FRAME_BYTES) oracleError('cbor_frame_length', 'CBOR payload length is outside 1..65536')
  const frame = Buffer.allocUnsafe(payload.length + 4)
  frame.writeUInt32BE(payload.length, 0)
  Buffer.from(payload).copy(frame, 4)
  return frame
}

export function unframeCbor(frame: Uint8Array): Buffer {
  if (frame.length < 4) oracleError('cbor_frame_truncated', 'CBOR frame has no complete length prefix')
  const input = Buffer.from(frame)
  const length = input.readUInt32BE(0)
  if (length === 0 || length > MAX_FRAME_BYTES) oracleError('cbor_frame_length', 'CBOR frame length is outside 1..65536')
  if (input.length !== length + 4) oracleError(input.length < length + 4 ? 'cbor_frame_truncated' : 'cbor_trailing_data', 'CBOR frame length does not match payload')
  return input.subarray(4)
}
