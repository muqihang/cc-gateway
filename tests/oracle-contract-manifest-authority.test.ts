import assert from 'node:assert/strict'
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'

import {
  CHECKPOINT_DOMAIN,
  MANIFEST_DOMAIN,
  ROOT_ROTATION_DOMAIN,
  REVOCATION_DOMAIN,
  authorityObjectDigest,
  domainSeparatedJcs,
  trustStateDigest,
  verifyManifestAuthorityUpdate,
  verifyEmergencyRevocation,
  verifyRootRotation,
  type AuthorityCheckpoint,
  type AuthorityRevocation,
  type AuthorityManifest,
  type AuthoritySignature,
  type ManifestAuthorityContext,
  type ManifestAuthorityUpdate,
  type RootRotation,
  type TrustKey,
  type TrustState,
} from '../src/oracle-contract/manifest-authority.js'

type Corpus = {
  cases: Array<{ id: string; expected_code: string }>
  limits: { maximum_clock_rollback_ms: number }
  manifest_authority_fixture: AuthorityManifest
  expected_next_state_digests: Record<string, string>
}
const corpus = JSON.parse(readFileSync(path.resolve('contracts/oracle-lab/v1/authority-corpus.json'), 'utf8')) as Corpus

type RuntimeKey = TrustKey & { privateKey: KeyObject }

function runtimeKey(keyId: string, role: TrustKey['role'], epoch: number): RuntimeKey {
  const seed = createHash('sha256').update(keyId).digest()
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der',
    type: 'pkcs8',
  })
  return { keyId, role, epoch, revoked: false, publicKey: createPublicKey(privateKey), privateKey }
}

function signature(key: RuntimeKey, domain: Uint8Array, signed: unknown): AuthoritySignature {
  return {
    algorithm: 'Ed25519',
    keyId: key.keyId,
    keyEpoch: key.epoch,
    role: key.role,
    signatureBase64url: sign(null, domainSeparatedJcs(domain, signed), key.privateKey).toString('base64url'),
  }
}

function fixture(): {
  keys: Record<string, RuntimeKey>
  state: TrustState
  context: ManifestAuthorityContext
  manifest: AuthorityManifest
  checkpoint: AuthorityCheckpoint
} {
  const keys = Object.fromEntries([
    runtimeKey('root-old-1', 'root', 1), runtimeKey('root-old-2', 'root', 1), runtimeKey('root-old-3', 'root', 1),
    runtimeKey('manifest-1', 'manifest', 1), runtimeKey('manifest-2', 'manifest', 1), runtimeKey('manifest-3', 'manifest', 1),
    runtimeKey('checkpoint-1', 'checkpoint', 1), runtimeKey('revocation-1', 'revocation', 1),
  ].map((key) => [key.keyId, key]))
  const state: TrustState = {
    rootEpoch: 1,
    policyVersion: 10,
    rollbackFloor: 10,
    revocationVersion: 1,
    manifestDigest: 'a'.repeat(64),
    manifestPayloadDigest: 'd'.repeat(64),
    checkpointVersion: 5,
    checkpointDigest: 'b'.repeat(64),
    replicaGeneration: 7,
    lastWallClockMs: 1_799_999_999_000,
    keys,
    thresholds: { root: 2, manifest: 2, checkpoint: 1, revocation: 1 },
    rollbackTargets: {},
  }
  const manifest: AuthorityManifest = {
    schemaId: 'oracle.compatibility', schemaMajor: 1, schemaRevision: 0, kind: 'manifest_authority',
    manifestId: 'manifest:fixture:11', policyVersion: 11, parentDigest: state.manifestDigest,
    rollbackDigest: state.manifestDigest, contractDigest: '1'.repeat(64), manifestPayloadDigest: '4'.repeat(64), issuedAtMs: 1_799_999_999_500,
    expiresAtMs: 1_800_003_600_000, sourcePackageDigests: ['2'.repeat(64)], promotionRefs: [],
    witnessCheckpointDigest: 'c'.repeat(64), invalidatingDependencyDigests: ['3'.repeat(64)],
  }
  const manifestDigest = authorityObjectDigest(MANIFEST_DOMAIN, manifest)
  const checkpoint: AuthorityCheckpoint = {
    schemaId: 'oracle.compatibility', schemaMajor: 1, schemaRevision: 0, kind: 'checkpoint',
    version: 6, manifestDigest, previousCheckpointDigest: state.checkpointDigest,
    witnessCheckpointDigest: manifest.witnessCheckpointDigest, issuedAtMs: 1_799_999_999_500,
    expiresAtMs: 1_800_003_600_000,
  }
  const context: ManifestAuthorityContext = {
    nowWallClockMs: 1_800_000_000_000,
    monotonicElapsedMs: 1_000,
    maximumClockRollbackMs: 300_000,
    maximumCheckpointAgeMs: 3_600_000,
    expectedReplicaGeneration: 7,
    invalidatedDependencyDigests: [],
    witnessedCheckpoints: {},
  }
  return { keys, state, context, manifest, checkpoint }
}

function signedUpdate(f: ReturnType<typeof fixture>, manifestSigners = ['manifest-1', 'manifest-2'], checkpointSigners = ['checkpoint-1']): ManifestAuthorityUpdate {
  return {
    manifest: f.manifest,
    manifestSignatures: manifestSigners.map((id) => signature(f.keys[id], MANIFEST_DOMAIN, f.manifest)),
    checkpoint: f.checkpoint,
    checkpointSignatures: checkpointSigners.map((id) => signature(f.keys[id], CHECKPOINT_DOMAIN, f.checkpoint)),
  }
}

test('manifest authority fixture is symmetric with the runtime type and top-level contract schema', () => {
  assert.deepEqual(fixture().manifest, corpus.manifest_authority_fixture)
  const schema = JSON.parse(readFileSync(path.resolve('contracts/oracle-lab/v1/contract.schema.json'), 'utf8'))
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema)
  assert.equal(validate(corpus.manifest_authority_fixture), true, JSON.stringify(validate.errors))
  const missing = structuredClone(corpus.manifest_authority_fixture) as Partial<AuthorityManifest>
  delete missing.manifestPayloadDigest
  assert.equal(validate(missing), false)
})

test('manifest threshold rejects a mixed epoch zero then epoch one signer set', () => {
  const f = fixture()
  const epochZero = runtimeKey('manifest-zero', 'manifest', 0)
  const epochOne = runtimeKey('manifest-one', 'manifest', 1)
  f.keys[epochZero.keyId] = epochZero
  f.keys[epochOne.keyId] = epochOne
  f.state.keys[epochZero.keyId] = epochZero
  f.state.keys[epochOne.keyId] = epochOne
  const update = signedUpdate(f)
  update.manifestSignatures = [signature(epochZero, MANIFEST_DOMAIN, f.manifest), signature(epochOne, MANIFEST_DOMAIN, f.manifest)]
  assert.equal(verifyManifestAuthorityUpdate(f.state, update, f.context).code, 'authority_wrong_role')
})

function rootRotation(f: ReturnType<typeof fixture>): { rotation: RootRotation; oldSignatures: AuthoritySignature[]; newSignatures: AuthoritySignature[]; newKeys: RuntimeKey[] } {
  const newKeys = [runtimeKey('root-new-1', 'root', 2), runtimeKey('root-new-2', 'root', 2), runtimeKey('root-new-3', 'root', 2)]
  const rotation: RootRotation = {
    schemaId: 'oracle.compatibility', schemaMajor: 1, schemaRevision: 0, kind: 'root_rotation',
    oldEpoch: 1, newEpoch: 2, newRootThreshold: 2,
    newKeys: newKeys.map((key) => ({ keyId: key.keyId, role: 'root', epoch: 2, publicKeySpkiBase64url: key.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url') })),
  }
  return {
    rotation,
    oldSignatures: ['root-old-1', 'root-old-2'].map((id) => signature(f.keys[id], ROOT_ROTATION_DOMAIN, rotation)),
    newSignatures: newKeys.slice(0, 2).map((key) => signature(key, ROOT_ROTATION_DOMAIN, rotation)),
    newKeys,
  }
}

for (const testcase of corpus.cases) {
  test(`manifest authority corpus: ${testcase.id}`, () => {
    const f = fixture()
    if (testcase.id.startsWith('authority-root-rotation')) {
      const candidate = rootRotation(f)
      if (testcase.id.endsWith('old-only')) candidate.newSignatures = []
      if (testcase.id.endsWith('new-only')) candidate.oldSignatures = []
      const decision = verifyRootRotation(f.state, candidate.rotation, candidate.oldSignatures, candidate.newSignatures)
      assert.equal(decision.code, testcase.expected_code)
      if (decision.allowed) {
        assert.match(decision.nextStateDigest as string, /^[0-9a-f]{64}$/)
        assert.equal(decision.nextStateDigest, corpus.expected_next_state_digests[testcase.id])
        if (process.env.ORACLE_PHASE2_DEBUG_DIGESTS === '1') console.log(`authority-digest ${testcase.id} ${decision.nextStateDigest}`)
      }
      return
    }
    if (testcase.id === 'authority-emergency-revocation') {
      const revocation: AuthorityRevocation = {
        schemaId: 'oracle.compatibility', schemaMajor: 1, schemaRevision: 0, kind: 'emergency_revocation',
        version: 2, keyEpoch: 1, issuedAtMs: f.context.nowWallClockMs,
        expiresAtMs: f.context.nowWallClockMs + 60_000, revokedKeyIds: ['manifest-3'], reasonRef: 'reason:key-compromise-fixture',
      }
      const decision = verifyEmergencyRevocation(f.state, revocation, [signature(f.keys['revocation-1'], REVOCATION_DOMAIN, revocation)], f.context.nowWallClockMs)
      assert.equal(decision.code, testcase.expected_code)
      assert.equal(decision.nextState?.keys['manifest-3'].revoked, true)
      assert.equal(decision.nextStateDigest, corpus.expected_next_state_digests[testcase.id])
      if (process.env.ORACLE_PHASE2_DEBUG_DIGESTS === '1') console.log(`authority-digest ${testcase.id} ${decision.nextStateDigest}`)
      return
    }
    if (testcase.id === 'authority-insufficient-threshold') {
      const decision = verifyManifestAuthorityUpdate(f.state, signedUpdate(f, ['manifest-1']), f.context)
      assert.equal(decision.code, testcase.expected_code)
      return
    }
    if (testcase.id === 'authority-duplicate-signer') {
      const update = signedUpdate(f, ['manifest-1'])
      update.manifestSignatures.push(update.manifestSignatures[0])
      assert.equal(verifyManifestAuthorityUpdate(f.state, update, f.context).code, testcase.expected_code)
      return
    }
    if (testcase.id === 'authority-wrong-role') {
      const update = signedUpdate(f, [])
      update.manifestSignatures = [signature(f.keys['root-old-1'], MANIFEST_DOMAIN, f.manifest)]
      assert.equal(verifyManifestAuthorityUpdate(f.state, update, f.context).code, testcase.expected_code)
      return
    }
    if (testcase.id === 'authority-expired') f.manifest.expiresAtMs = f.context.nowWallClockMs - 1
    if (testcase.id === 'authority-parent-mismatch') f.manifest.parentDigest = '0'.repeat(64)
    if (testcase.id === 'authority-policy-rollback') f.manifest.policyVersion = 9
    if (testcase.id === 'authority-revoked-key') f.state.keys['manifest-1'].revoked = true
    if (testcase.id === 'authority-stale-checkpoint') f.checkpoint.version = f.state.checkpointVersion
    if (testcase.id === 'authority-freeze') f.checkpoint.issuedAtMs = f.context.nowWallClockMs - f.context.maximumCheckpointAgeMs - 1
    if (testcase.id === 'authority-mix-and-match') f.checkpoint.manifestDigest = '0'.repeat(64)
    if (testcase.id === 'authority-split-view') f.context.witnessedCheckpoints[f.checkpoint.version] = '0'.repeat(64)
    if (testcase.id === 'authority-witness-mismatch') f.manifest.witnessCheckpointDigest = '0'.repeat(64)
    if (testcase.id === 'authority-clock-rollback') f.context.nowWallClockMs = f.state.lastWallClockMs - f.context.maximumClockRollbackMs - 1
    if (testcase.id === 'authority-dependency-invalidated') f.context.invalidatedDependencyDigests = [f.manifest.invalidatingDependencyDigests[0]]
    if (testcase.id === 'authority-replica-generation-conflict') f.context.expectedReplicaGeneration += 1
    f.checkpoint.manifestDigest = testcase.id === 'authority-mix-and-match' ? f.checkpoint.manifestDigest : authorityObjectDigest(MANIFEST_DOMAIN, f.manifest)
    const update = signedUpdate(f)
    const decision = verifyManifestAuthorityUpdate(f.state, update, f.context)
    assert.equal(decision.code, testcase.expected_code)
    if (decision.allowed) {
      assert.equal(decision.nextStateDigest, trustStateDigest(decision.nextState as TrustState))
      assert.equal(decision.nextStateDigest, corpus.expected_next_state_digests[testcase.id])
      if (process.env.ORACLE_PHASE2_DEBUG_DIGESTS === '1') console.log(`authority-digest ${testcase.id} ${decision.nextStateDigest}`)
      if (testcase.id === 'authority-restart-snapshot') {
        const restarted = { ...f.state, keys: { ...f.state.keys }, thresholds: { ...f.state.thresholds } }
        assert.equal(verifyManifestAuthorityUpdate(restarted, update, f.context).nextStateDigest, decision.nextStateDigest)
      }
    }
  })
}

test('trust-state digest binds public-key bytes', () => {
  const f = fixture()
  const replaced = { ...f.state, keys: { ...f.state.keys } }
  replaced.keys['manifest-1'] = { ...replaced.keys['manifest-1'], publicKey: generateKeyPairSync('ed25519').publicKey }
  assert.notEqual(trustStateDigest(replaced), trustStateDigest(f.state))
})

test('zero authority thresholds never admit unsigned objects', () => {
  const f = fixture()
  f.state.thresholds.manifest = 0
  f.state.thresholds.checkpoint = 0
  assert.equal(verifyManifestAuthorityUpdate(f.state, signedUpdate(f, [], []), f.context).code, 'authority_threshold_insufficient')
})

test('root rotation preserves explicitly retained online-role key epochs', () => {
  const f = fixture()
  const candidate = rootRotation(f)
  const rotated = verifyRootRotation(f.state, candidate.rotation, candidate.oldSignatures, candidate.newSignatures)
  assert.equal(rotated.allowed, true)
  f.context.expectedReplicaGeneration = 8
  const decision = verifyManifestAuthorityUpdate(rotated.nextState as TrustState, signedUpdate(f), f.context)
  assert.equal(decision.code, 'authority_allow')
})

test('an explicit non-revoked rollback target above the floor is admitted', () => {
  const f = fixture()
  const rollbackDigest = '9'.repeat(64)
  ;(f.state as TrustState & { rollbackTargets: Record<string, { policyVersion: number; revoked: boolean }> }).rollbackTargets = {
    [rollbackDigest]: { policyVersion: 9, revoked: false },
  }
  f.state.rollbackFloor = 9
  f.manifest.policyVersion = 9
  f.manifest.rollbackDigest = rollbackDigest
  f.checkpoint.manifestDigest = authorityObjectDigest(MANIFEST_DOMAIN, f.manifest)
  assert.equal(verifyManifestAuthorityUpdate(f.state, signedUpdate(f), f.context).code, 'authority_allow')

  ;(f.state as TrustState & { rollbackTargets: Record<string, { policyVersion: number; revoked: boolean }> }).rollbackTargets[rollbackDigest].revoked = true
  assert.equal(verifyManifestAuthorityUpdate(f.state, signedUpdate(f), f.context).code, 'authority_policy_rollback')
})
