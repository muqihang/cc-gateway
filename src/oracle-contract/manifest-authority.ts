import { createPublicKey, type KeyObject, verify } from 'node:crypto'

import { canonicalizeJsonValue, sha256Hex } from './canonical.js'

export const MANIFEST_DOMAIN = Buffer.from('oracle-manifest-v1\0')
export const CHECKPOINT_DOMAIN = Buffer.from('oracle-checkpoint-v1\0')
export const ROOT_ROTATION_DOMAIN = Buffer.from('oracle-root-rotation-v1\0')
export const REVOCATION_DOMAIN = Buffer.from('oracle-revocation-v1\0')

export type AuthorityRole = 'root' | 'manifest' | 'checkpoint' | 'revocation' | 'sidecar_capability'

export type TrustKey = {
  keyId: string
  role: AuthorityRole
  epoch: number
  revoked: boolean
  publicKey: KeyObject
}

export type AuthorityThresholds = { root: number; manifest: number; checkpoint: number; revocation: number }

export type TrustState = {
  rootEpoch: number
  policyVersion: number
  rollbackFloor: number
  revocationVersion: number
  manifestDigest: string
  checkpointVersion: number
  checkpointDigest: string
  replicaGeneration: number
  lastWallClockMs: number
  keys: Record<string, TrustKey>
  thresholds: AuthorityThresholds
}

export type AuthorityManifest = {
  schemaId: 'oracle.compatibility'
  schemaMajor: 1
  schemaRevision: 0
  kind: 'manifest_authority'
  manifestId: string
  policyVersion: number
  parentDigest: string
  rollbackDigest: string
  contractDigest: string
  issuedAtMs: number
  expiresAtMs: number
  sourcePackageDigests: string[]
  promotionRefs: string[]
  witnessCheckpointDigest: string
  invalidatingDependencyDigests: string[]
}

export type AuthorityCheckpoint = {
  schemaId: 'oracle.compatibility'
  schemaMajor: 1
  schemaRevision: 0
  kind: 'checkpoint'
  version: number
  manifestDigest: string
  previousCheckpointDigest: string
  witnessCheckpointDigest: string
  issuedAtMs: number
  expiresAtMs: number
}

export type AuthoritySignature = {
  algorithm: 'Ed25519'
  keyId: string
  keyEpoch: number
  role: AuthorityRole
  signatureBase64url: string
}

export type ManifestAuthorityUpdate = {
  manifest: AuthorityManifest
  manifestSignatures: AuthoritySignature[]
  checkpoint: AuthorityCheckpoint
  checkpointSignatures: AuthoritySignature[]
}

export type ManifestAuthorityContext = {
  nowWallClockMs: number
  monotonicElapsedMs: number
  maximumClockRollbackMs: number
  maximumCheckpointAgeMs: number
  expectedReplicaGeneration: number
  invalidatedDependencyDigests: string[]
  witnessedCheckpoints: Record<number, string>
}

export type RootRotationKey = {
  keyId: string
  role: 'root'
  epoch: number
  publicKeySpkiBase64url: string
}

export type RootRotation = {
  schemaId: 'oracle.compatibility'
  schemaMajor: 1
  schemaRevision: 0
  kind: 'root_rotation'
  oldEpoch: number
  newEpoch: number
  newRootThreshold: number
  newKeys: RootRotationKey[]
}

export type AuthorityRevocation = {
  schemaId: 'oracle.compatibility'
  schemaMajor: 1
  schemaRevision: 0
  kind: 'emergency_revocation'
  version: number
  keyEpoch: number
  issuedAtMs: number
  expiresAtMs: number
  revokedKeyIds: string[]
  reasonRef: string
}

export type AuthorityDecision = {
  allowed: boolean
  code: string
  nextState?: TrustState
  nextStateDigest?: string
}

function deny(code: string): AuthorityDecision {
  return { allowed: false, code }
}

export function domainSeparatedJcs(domain: Uint8Array, value: unknown): Buffer {
  return Buffer.concat([Buffer.from(domain), canonicalizeJsonValue(value)])
}

export function authorityObjectDigest(domain: Uint8Array, value: unknown): string {
  return sha256Hex(domainSeparatedJcs(domain, value))
}

function keyMetadata(state: TrustState): Array<{ keyId: string; role: AuthorityRole; epoch: number; revoked: boolean }> {
  return Object.values(state.keys)
    .map(({ keyId, role, epoch, revoked }) => ({ keyId, role, epoch, revoked }))
    .sort((left, right) => Buffer.compare(Buffer.from(left.keyId), Buffer.from(right.keyId)))
}

export function trustStateDigest(state: TrustState): string {
  return sha256Hex(canonicalizeJsonValue({
    checkpointDigest: state.checkpointDigest,
    checkpointVersion: state.checkpointVersion,
    keyMetadata: keyMetadata(state),
    lastWallClockMs: state.lastWallClockMs,
    manifestDigest: state.manifestDigest,
    policyVersion: state.policyVersion,
    replicaGeneration: state.replicaGeneration,
    revocationVersion: state.revocationVersion,
    rollbackFloor: state.rollbackFloor,
    rootEpoch: state.rootEpoch,
    thresholds: state.thresholds,
  }))
}

function verifyThreshold(
  signed: unknown,
  signatures: AuthoritySignature[],
  role: keyof AuthorityThresholds,
  epoch: number,
  keys: Record<string, TrustKey>,
  threshold: number,
  domain: Uint8Array,
): string | undefined {
  if (signatures.length > 64 || Object.keys(keys).length > 64) return 'authority_resource_limit'
  const seen = new Set<string>()
  let valid = 0
  const bytes = domainSeparatedJcs(domain, signed)
  for (const signature of signatures) {
    if (seen.has(signature.keyId)) return 'authority_duplicate_signer'
    seen.add(signature.keyId)
    const key = keys[signature.keyId]
    if (!key || key.role !== role || signature.role !== role || key.epoch !== epoch || signature.keyEpoch !== epoch) return 'authority_wrong_role'
    if (key.revoked) return 'authority_key_revoked'
    let raw: Buffer
    try {
      raw = Buffer.from(signature.signatureBase64url, 'base64url')
    } catch {
      return 'authority_signature_invalid'
    }
    if (signature.algorithm !== 'Ed25519' || raw.length !== 64 || !verify(null, bytes, key.publicKey, raw)) return 'authority_signature_invalid'
    valid += 1
  }
  return valid < threshold ? 'authority_threshold_insufficient' : undefined
}

function checkpointDigest(checkpoint: AuthorityCheckpoint): string {
  return authorityObjectDigest(CHECKPOINT_DOMAIN, checkpoint)
}

export function verifyManifestAuthorityUpdate(state: TrustState, update: ManifestAuthorityUpdate, context: ManifestAuthorityContext): AuthorityDecision {
  if (context.nowWallClockMs + context.maximumClockRollbackMs < state.lastWallClockMs || context.monotonicElapsedMs < 0) return deny('authority_clock_rollback')
  if (context.expectedReplicaGeneration !== state.replicaGeneration) return deny('authority_replica_conflict')
  const manifestBytes = canonicalizeJsonValue(update.manifest)
  if (manifestBytes.length > 1_048_576) return deny('authority_resource_limit')
  const manifestSignatures = verifyThreshold(update.manifest, update.manifestSignatures, 'manifest', state.rootEpoch, state.keys, state.thresholds.manifest, MANIFEST_DOMAIN)
  if (manifestSignatures) return deny(manifestSignatures)
  if (update.manifest.expiresAtMs < context.nowWallClockMs) return deny('authority_expired')
  if (update.manifest.parentDigest !== state.manifestDigest || update.manifest.rollbackDigest !== state.manifestDigest) return deny('authority_parent_mismatch')
  if (update.manifest.policyVersion <= state.policyVersion || update.manifest.policyVersion < state.rollbackFloor) return deny('authority_policy_rollback')
  if (update.manifest.invalidatingDependencyDigests.some((digest) => context.invalidatedDependencyDigests.includes(digest))) return deny('authority_dependency_invalidated')
  const manifestDigest = authorityObjectDigest(MANIFEST_DOMAIN, update.manifest)
  const checkpointSignatures = verifyThreshold(update.checkpoint, update.checkpointSignatures, 'checkpoint', state.rootEpoch, state.keys, state.thresholds.checkpoint, CHECKPOINT_DOMAIN)
  if (checkpointSignatures) return deny(checkpointSignatures)
  if (update.checkpoint.version <= state.checkpointVersion || update.checkpoint.previousCheckpointDigest !== state.checkpointDigest) return deny('authority_checkpoint_stale')
  if (context.nowWallClockMs - update.checkpoint.issuedAtMs > context.maximumCheckpointAgeMs || update.checkpoint.expiresAtMs < context.nowWallClockMs) return deny('authority_freeze')
  if (update.checkpoint.manifestDigest !== manifestDigest) return deny('authority_mix_and_match')
  if (update.checkpoint.witnessCheckpointDigest !== update.manifest.witnessCheckpointDigest) return deny('authority_witness_mismatch')
  const nextCheckpointDigest = checkpointDigest(update.checkpoint)
  const witnessed = context.witnessedCheckpoints[update.checkpoint.version]
  if (witnessed && witnessed !== nextCheckpointDigest) return deny('authority_split_view')
  const nextState: TrustState = {
    ...state,
    policyVersion: update.manifest.policyVersion,
    manifestDigest,
    checkpointVersion: update.checkpoint.version,
    checkpointDigest: nextCheckpointDigest,
    replicaGeneration: state.replicaGeneration + 1,
    lastWallClockMs: context.nowWallClockMs,
    keys: { ...state.keys },
    thresholds: { ...state.thresholds },
  }
  return { allowed: true, code: 'authority_allow', nextState, nextStateDigest: trustStateDigest(nextState) }
}

function rotationKeys(rotation: RootRotation): Record<string, TrustKey> | undefined {
  if (rotation.newKeys.length === 0 || rotation.newKeys.length > 64) return undefined
  const result: Record<string, TrustKey> = {}
  try {
    for (const key of rotation.newKeys) {
      if (result[key.keyId] || key.role !== 'root' || key.epoch !== rotation.newEpoch) return undefined
      result[key.keyId] = {
        keyId: key.keyId,
        role: 'root',
        epoch: key.epoch,
        revoked: false,
        publicKey: createPublicKey({ key: Buffer.from(key.publicKeySpkiBase64url, 'base64url'), type: 'spki', format: 'der' }),
      }
    }
    return result
  } catch {
    return undefined
  }
}

export function verifyRootRotation(state: TrustState, rotation: RootRotation, oldSignatures: AuthoritySignature[], newSignatures: AuthoritySignature[]): AuthorityDecision {
  if (rotation.oldEpoch !== state.rootEpoch || rotation.newEpoch !== state.rootEpoch + 1 || rotation.newRootThreshold < 1) return deny('authority_rotation_threshold')
  const newKeys = rotationKeys(rotation)
  if (!newKeys || rotation.newRootThreshold > Object.keys(newKeys).length) return deny('authority_rotation_threshold')
  const oldError = verifyThreshold(rotation, oldSignatures, 'root', state.rootEpoch, state.keys, state.thresholds.root, ROOT_ROTATION_DOMAIN)
  if (oldError) return deny(oldError === 'authority_threshold_insufficient' ? 'authority_rotation_threshold' : oldError)
  const newError = verifyThreshold(rotation, newSignatures, 'root', rotation.newEpoch, newKeys, rotation.newRootThreshold, ROOT_ROTATION_DOMAIN)
  if (newError) return deny(newError === 'authority_threshold_insufficient' ? 'authority_rotation_threshold' : newError)
  const retained = Object.fromEntries(Object.entries(state.keys).filter(([, key]) => key.role !== 'root'))
  const nextState: TrustState = {
    ...state,
    rootEpoch: rotation.newEpoch,
    keys: { ...retained, ...newKeys },
    thresholds: { ...state.thresholds, root: rotation.newRootThreshold },
    replicaGeneration: state.replicaGeneration + 1,
  }
  return { allowed: true, code: 'authority_allow', nextState, nextStateDigest: trustStateDigest(nextState) }
}

export function verifyEmergencyRevocation(state: TrustState, revocation: AuthorityRevocation, signatures: AuthoritySignature[], nowWallClockMs: number): AuthorityDecision {
  const signatureError = verifyThreshold(revocation, signatures, 'revocation', state.rootEpoch, state.keys, state.thresholds.revocation, REVOCATION_DOMAIN)
  if (signatureError) return deny(signatureError)
  if (revocation.keyEpoch !== state.rootEpoch || revocation.version <= state.revocationVersion || revocation.expiresAtMs < nowWallClockMs) return deny('authority_revocation_stale')
  if (revocation.revokedKeyIds.length === 0 || revocation.revokedKeyIds.length > 64 || new Set(revocation.revokedKeyIds).size !== revocation.revokedKeyIds.length) return deny('authority_revocation_invalid')
  const keys = { ...state.keys }
  for (const keyId of revocation.revokedKeyIds) {
    const key = keys[keyId]
    if (!key) return deny('authority_revocation_invalid')
    keys[keyId] = { ...key, revoked: true }
  }
  const nextState: TrustState = {
    ...state,
    revocationVersion: revocation.version,
    replicaGeneration: state.replicaGeneration + 1,
    keys,
  }
  return { allowed: true, code: 'authority_allow', nextState, nextStateDigest: trustStateDigest(nextState) }
}
