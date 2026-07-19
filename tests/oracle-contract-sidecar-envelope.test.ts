import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  SIDECAR_CAPABILITY_DOMAIN,
  encodeSidecarCapability,
  replayStateDigest,
  sidecarCapabilitySigningBytes,
  signSidecarCapability,
  transitionReplayState,
  verifySidecarCapability,
  type ReplayState,
  type SidecarCapabilityKey,
  type SidecarCapabilityUnsigned,
} from '../src/oracle-contract/sidecar-envelope.js'
import { CHECKPOINT_DOMAIN, MANIFEST_DOMAIN, REVOCATION_DOMAIN } from '../src/oracle-contract/manifest-authority.js'

type Corpus = { sidecar_unsigned_envelope: SidecarCapabilityUnsigned }
type Expected = { canonical_results: { sidecar_unsigned_envelope: { canonical_hex: string } }; replay_state_digests: { reserved: string; committed: string } }
const corpus = JSON.parse(readFileSync(path.resolve('contracts/oracle-lab/v1/canonicalization-corpus.json'), 'utf8')) as Corpus
const expected = JSON.parse(readFileSync(path.resolve('contracts/oracle-lab/v1/expected-results.json'), 'utf8')) as Expected

function key(keyId: string, role: SidecarCapabilityKey['role'], epoch: number, pair?: { publicKey: KeyObject; privateKey: KeyObject }): SidecarCapabilityKey & { privateKey: KeyObject } {
  const generated = pair ?? generateKeyPairSync('ed25519')
  return { keyId, role, epoch, revoked: false, publicKey: generated.publicKey, privateKey: generated.privateKey }
}

function changed(value: unknown): unknown {
  if (typeof value === 'number') return value + 1
  if (typeof value === 'string') return `${value}-changed`
  if (Array.isArray(value)) return [...value].reverse()
  return value
}

test('sidecar capability has exact deterministic CBOR and verifies only in its dedicated domain', () => {
  const capabilityKey = key('sidecar-key-11', 'sidecar_capability', 11)
  const signed = signSidecarCapability(corpus.sidecar_unsigned_envelope, capabilityKey.keyId, capabilityKey.epoch, capabilityKey.privateKey)
  const frame = encodeSidecarCapability(signed)
  const decision = verifySidecarCapability(frame, { keys: { [capabilityKey.keyId]: capabilityKey }, nowMs: 1_800_000_000_100 })
  assert.equal(decision.code, 'sidecar_capability_allow')
  assert.equal(decision.allowed, true)

  const unsignedHex = sidecarCapabilitySigningBytes(corpus.sidecar_unsigned_envelope).subarray(SIDECAR_CAPABILITY_DOMAIN.length).toString('hex')
  assert.equal(unsignedHex, expected.canonical_results.sidecar_unsigned_envelope.canonical_hex)

  for (const domain of [MANIFEST_DOMAIN, CHECKPOINT_DOMAIN, REVOCATION_DOMAIN]) {
    const wrongDomain = { ...signed, signature: sign(null, Buffer.concat([domain, Buffer.from(unsignedHex, 'hex')]), capabilityKey.privateKey) }
    assert.equal(verifySidecarCapability(encodeSidecarCapability(wrongDomain), { keys: { [capabilityKey.keyId]: capabilityKey }, nowMs: 1_800_000_000_100 }).code, 'sidecar_signature_invalid')
  }
})

test('every unsigned sidecar field is covered by the signature', () => {
  const capabilityKey = key('sidecar-key-11', 'sidecar_capability', 11)
  const signed = signSidecarCapability(corpus.sidecar_unsigned_envelope, capabilityKey.keyId, capabilityKey.epoch, capabilityKey.privateKey)
  for (const field of Object.keys(corpus.sidecar_unsigned_envelope) as Array<keyof SidecarCapabilityUnsigned>) {
    const mutated = structuredClone(corpus.sidecar_unsigned_envelope)
    ;(mutated as unknown as Record<string, unknown>)[field] = changed(mutated[field])
    const frame = encodeSidecarCapability({ ...mutated, signature: signed.signature })
    const decision = verifySidecarCapability(frame, { keys: { [capabilityKey.keyId]: capabilityKey }, nowMs: 1_800_000_000_100 })
    assert.equal(decision.allowed, false, `${field} was not bound`)
  }
})

test('sidecar role, epoch, revocation, and public-key reuse fail closed', () => {
  const pair = generateKeyPairSync('ed25519')
  const capabilityKey = key('sidecar-key-11', 'sidecar_capability', 11, pair)
  const manifestKey = key('manifest-key-11', 'manifest', 11, pair)
  const signed = signSidecarCapability(corpus.sidecar_unsigned_envelope, capabilityKey.keyId, capabilityKey.epoch, capabilityKey.privateKey)

  assert.equal(verifySidecarCapability(encodeSidecarCapability(signed), { keys: { [manifestKey.keyId]: manifestKey }, nowMs: 1_800_000_000_100 }).code, 'sidecar_key_not_found')
  assert.equal(verifySidecarCapability(encodeSidecarCapability(signed), { keys: { [capabilityKey.keyId]: { ...capabilityKey, epoch: 12 } }, nowMs: 1_800_000_000_100 }).code, 'sidecar_key_epoch_mismatch')
  assert.equal(verifySidecarCapability(encodeSidecarCapability(signed), { keys: { [capabilityKey.keyId]: { ...capabilityKey, revoked: true } }, nowMs: 1_800_000_000_100 }).code, 'sidecar_key_revoked')
  assert.equal(verifySidecarCapability(encodeSidecarCapability(signed), { keys: { [capabilityKey.keyId]: capabilityKey, [manifestKey.keyId]: manifestKey }, nowMs: 1_800_000_000_100 }).code, 'sidecar_key_role_reuse')
})

test('replay transitions survive restart and reject stale replicas and terminal reuse', () => {
  const initial: ReplayState = { ledger_generation: 0, entries: {} }
  const identity = { key_epoch: 11, capability_id: 'capability:fixture:1', attempt_id: 'attempt:fixture:1', nonce: 'nonce:fixture:1' }
  const reserved = transitionReplayState(initial, { ...identity, operation: 'reserve', expected_generation: 0, now_ms: 1_800_000_000_000, expires_at_ms: 1_800_000_060_000 })
  assert.equal(reserved.code, 'replay_reserved')
  assert.equal(reserved.nextStateDigest, expected.replay_state_digests.reserved)
  const restarted = JSON.parse(JSON.stringify(reserved.nextState)) as ReplayState
  assert.equal(replayStateDigest(restarted), reserved.nextStateDigest)
  const committed = transitionReplayState(restarted, { ...identity, operation: 'commit', expected_generation: 1, now_ms: 1_800_000_000_100, expires_at_ms: 1_800_000_060_000 })
  assert.equal(committed.code, 'replay_committed')
  assert.equal(committed.nextStateDigest, expected.replay_state_digests.committed)
  assert.equal(transitionReplayState(committed.nextState as ReplayState, { ...identity, operation: 'reserve', expected_generation: 2, now_ms: 1_800_000_000_200, expires_at_ms: 1_800_000_060_000 }).code, 'replay_rejected')
  assert.equal(transitionReplayState(restarted, { ...identity, operation: 'commit', expected_generation: 0, now_ms: 1_800_000_000_100, expires_at_ms: 1_800_000_060_000 }).code, 'replay_replica_conflict')
  const expired = transitionReplayState(reserved.nextState as ReplayState, { ...identity, operation: 'expire', expected_generation: 1, now_ms: 1_800_000_060_000, expires_at_ms: 1_800_000_060_000 })
  assert.equal(expired.code, 'replay_expired')
  const revoked = transitionReplayState(reserved.nextState as ReplayState, { ...identity, operation: 'revoke', expected_generation: 1, now_ms: 1_800_000_000_100, expires_at_ms: 1_800_000_060_000 })
  assert.equal(revoked.code, 'replay_revoked')
  if (process.env.ORACLE_PHASE2_DEBUG_DIGESTS === '1') {
    console.log(`replay-digest reserved ${reserved.nextStateDigest}`)
    console.log(`replay-digest committed ${committed.nextStateDigest}`)
  }
})
