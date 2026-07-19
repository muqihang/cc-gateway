import { sign, type KeyObject, verify } from 'node:crypto'

import { sha256Hex } from './canonical.js'
import { decodeDeterministicCbor, encodeDeterministicCbor, frameCbor, unframeCbor } from './cbor-envelope.js'
import { OracleContractError } from './errors.js'

export const SIDECAR_CAPABILITY_DOMAIN = Buffer.from('oracle-sidecar-capability-v1\0')

export type SidecarDestination = { host: string; port: number }

export type SidecarCapabilityUnsigned = {
  schema_id: 'oracle.sidecar.capability'
  schema_major: 1
  schema_revision: 0
  key_epoch: number
  capability_id: string
  attempt_id: string
  nonce: string
  issued_at_ms: number
  deadline_ms: number
  method: 'POST'
  authority: string
  normalized_path_query: string
  ordered_headers_sha256: string
  body_sha256: string
  content_length: number
  content_encoding: 'identity' | 'gzip' | 'br' | 'zstd'
  profile_generation: number
  proxy_generation: number
  credential_generation: number
  transport_cell_generation: number
  contract_digest: string
  manifest_digest: string
  destination_policy_generation: number
  destination_class: 'public_provider' | 'approved_proxy'
  allowed_destinations: SidecarDestination[]
  response_policy_ref: string
  retry_owner: 'none' | 'cc_gateway' | 'sub2api'
  key_id: string
  key_role: 'sidecar_capability'
}

export type SignedSidecarCapability = SidecarCapabilityUnsigned & { signature: Uint8Array }

export type SidecarCapabilityKey = {
  keyId: string
  role: 'root' | 'manifest' | 'checkpoint' | 'revocation' | 'sidecar_capability'
  epoch: number
  revoked: boolean
  publicKey: KeyObject
}

export type SidecarVerifyContext = { keys: Record<string, SidecarCapabilityKey>; nowMs: number }
export type SidecarVerifyDecision = { allowed: boolean; code: string; envelope?: SignedSidecarCapability }

const UNSIGNED_FIELDS = [
  'schema_id', 'schema_major', 'schema_revision', 'key_epoch', 'capability_id', 'attempt_id', 'nonce',
  'issued_at_ms', 'deadline_ms', 'method', 'authority', 'normalized_path_query', 'ordered_headers_sha256',
  'body_sha256', 'content_length', 'content_encoding', 'profile_generation', 'proxy_generation',
  'credential_generation', 'transport_cell_generation', 'contract_digest', 'manifest_digest',
  'destination_policy_generation', 'destination_class', 'allowed_destinations', 'response_policy_ref',
  'retry_owner', 'key_id', 'key_role',
] as const satisfies ReadonlyArray<keyof SidecarCapabilityUnsigned>

function failure(code: string): SidecarVerifyDecision {
  return { allowed: false, code }
}

function strictUnsigned(value: unknown): SidecarCapabilityUnsigned | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const expected = [...UNSIGNED_FIELDS].sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return undefined
  if (record.schema_id !== 'oracle.sidecar.capability' || record.schema_major !== 1 || record.schema_revision !== 0 || record.key_role !== 'sidecar_capability' || record.method !== 'POST') return undefined
  const integerFields = ['key_epoch', 'issued_at_ms', 'deadline_ms', 'content_length', 'profile_generation', 'proxy_generation', 'credential_generation', 'transport_cell_generation', 'destination_policy_generation']
  if (integerFields.some((field) => !Number.isSafeInteger(record[field]) || (record[field] as number) < 0)) return undefined
  const stringFields = ['capability_id', 'attempt_id', 'nonce', 'authority', 'normalized_path_query', 'ordered_headers_sha256', 'body_sha256', 'contract_digest', 'manifest_digest', 'response_policy_ref', 'retry_owner', 'key_id', 'content_encoding', 'destination_class']
  if (stringFields.some((field) => typeof record[field] !== 'string' || !(record[field] as string))) return undefined
  if (!/^[0-9a-f]{64}$/.test(record.ordered_headers_sha256 as string) || !/^[0-9a-f]{64}$/.test(record.body_sha256 as string) || !/^[0-9a-f]{64}$/.test(record.contract_digest as string) || !/^[0-9a-f]{64}$/.test(record.manifest_digest as string)) return undefined
  if (!['identity', 'gzip', 'br', 'zstd'].includes(record.content_encoding as string) || !['public_provider', 'approved_proxy'].includes(record.destination_class as string) || !['none', 'cc_gateway', 'sub2api'].includes(record.retry_owner as string)) return undefined
  if (!Array.isArray(record.allowed_destinations) || record.allowed_destinations.length < 1 || record.allowed_destinations.length > 16) return undefined
  for (const destination of record.allowed_destinations) {
    if (!destination || typeof destination !== 'object' || Array.isArray(destination)) return undefined
    const typed = destination as Record<string, unknown>
    if (Object.keys(typed).sort().join(',') !== 'host,port' || typeof typed.host !== 'string' || !typed.host || !Number.isInteger(typed.port) || (typed.port as number) < 1 || (typed.port as number) > 65535) return undefined
  }
  return value as SidecarCapabilityUnsigned
}

export function sidecarCapabilitySigningBytes(unsigned: SidecarCapabilityUnsigned): Buffer {
  if (!strictUnsigned(unsigned)) throw new OracleContractError('sidecar_capability_schema_invalid', 'unsigned sidecar capability is invalid')
  return Buffer.concat([SIDECAR_CAPABILITY_DOMAIN, encodeDeterministicCbor(unsigned)])
}

export function signSidecarCapability(unsigned: SidecarCapabilityUnsigned, keyId: string, keyEpoch: number, privateKey: KeyObject): SignedSidecarCapability {
  if (unsigned.key_id !== keyId || unsigned.key_epoch !== keyEpoch || unsigned.key_role !== 'sidecar_capability') {
    throw new OracleContractError('sidecar_key_epoch_mismatch', 'signing key does not match the capability key binding')
  }
  return { ...unsigned, signature: sign(null, sidecarCapabilitySigningBytes(unsigned), privateKey) }
}

export function encodeSidecarCapability(envelope: SignedSidecarCapability): Buffer {
  return frameCbor(encodeDeterministicCbor(envelope))
}

function publicKeyFingerprint(key: KeyObject): string {
  return sha256Hex(key.export({ type: 'spki', format: 'der' }))
}

export function verifySidecarCapability(frame: Uint8Array, context: SidecarVerifyContext): SidecarVerifyDecision {
  let decoded: unknown
  try {
    decoded = decodeDeterministicCbor(unframeCbor(frame))
  } catch (error) {
    return failure((error as { code?: string }).code ?? 'sidecar_capability_decode_invalid')
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return failure('sidecar_capability_schema_invalid')
  const record = decoded as Record<string, unknown>
  const signature = record.signature
  const unsignedRecord = { ...record }
  delete unsignedRecord.signature
  const unsigned = strictUnsigned(unsignedRecord)
  if (!unsigned || !(signature instanceof Uint8Array) || signature.length !== 64) return failure('sidecar_capability_schema_invalid')
  if (unsigned.issued_at_ms > context.nowMs || unsigned.deadline_ms < context.nowMs || unsigned.deadline_ms < unsigned.issued_at_ms) return failure('sidecar_capability_expired')
  const key = context.keys[unsigned.key_id]
  if (!key) return failure('sidecar_key_not_found')
  if (key.role !== 'sidecar_capability' || unsigned.key_role !== 'sidecar_capability') return failure('sidecar_key_role_invalid')
  if (key.epoch !== unsigned.key_epoch) return failure('sidecar_key_epoch_mismatch')
  if (key.revoked) return failure('sidecar_key_revoked')
  const fingerprint = publicKeyFingerprint(key.publicKey)
  if (Object.values(context.keys).some((candidate) => candidate.keyId !== key.keyId && candidate.role !== 'sidecar_capability' && publicKeyFingerprint(candidate.publicKey) === fingerprint)) {
    return failure('sidecar_key_role_reuse')
  }
  if (!verify(null, sidecarCapabilitySigningBytes(unsigned), key.publicKey, Buffer.from(signature))) return failure('sidecar_signature_invalid')
  return { allowed: true, code: 'sidecar_capability_allow', envelope: { ...unsigned, signature } }
}

export type ReplayEntry = { state: 'reserved' | 'committed' | 'expired' | 'revoked'; expires_at_ms: number }
export type ReplayState = { ledger_generation: number; entries: Record<string, ReplayEntry> }
export type ReplayCommand = {
  operation: 'reserve' | 'commit' | 'expire' | 'revoke'
  expected_generation: number
  now_ms: number
  expires_at_ms: number
  key_epoch: number
  capability_id: string
  attempt_id: string
  nonce: string
}
export type ReplayDecision = { allowed: boolean; code: string; nextState?: ReplayState; nextStateDigest?: string }

function replayIdentity(command: ReplayCommand): string {
  return sha256Hex(encodeDeterministicCbor({
    attempt_id: command.attempt_id,
    capability_id: command.capability_id,
    key_epoch: command.key_epoch,
    nonce: command.nonce,
  }))
}

export function replayStateDigest(state: ReplayState): string {
  return sha256Hex(encodeDeterministicCbor(state))
}

export function transitionReplayState(state: ReplayState, command: ReplayCommand): ReplayDecision {
  if (command.expected_generation !== state.ledger_generation) return { allowed: false, code: 'replay_replica_conflict' }
  const identity = replayIdentity(command)
  const current = state.entries[identity]
  let nextEntry: ReplayEntry
  if (command.operation === 'reserve') {
    if (current || command.expires_at_ms <= command.now_ms) return { allowed: false, code: 'replay_rejected' }
    nextEntry = { state: 'reserved', expires_at_ms: command.expires_at_ms }
  } else if (command.operation === 'commit') {
    if (!current || current.state !== 'reserved' || current.expires_at_ms <= command.now_ms) return { allowed: false, code: 'replay_rejected' }
    nextEntry = { ...current, state: 'committed' }
  } else if (command.operation === 'expire') {
    if (!current || current.state !== 'reserved' || current.expires_at_ms > command.now_ms) return { allowed: false, code: 'replay_rejected' }
    nextEntry = { ...current, state: 'expired' }
  } else {
    if (!current || current.state !== 'reserved') return { allowed: false, code: 'replay_rejected' }
    nextEntry = { ...current, state: 'revoked' }
  }
  const nextState: ReplayState = {
    ledger_generation: state.ledger_generation + 1,
    entries: { ...state.entries, [identity]: nextEntry },
  }
  const code = command.operation === 'reserve' ? 'replay_reserved' : command.operation === 'commit' ? 'replay_committed' : command.operation === 'expire' ? 'replay_expired' : 'replay_revoked'
  return { allowed: true, code, nextState, nextStateDigest: replayStateDigest(nextState) }
}
