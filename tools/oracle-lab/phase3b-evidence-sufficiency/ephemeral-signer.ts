import { generateKeyPairSync, sign } from 'node:crypto'

import path from 'node:path'

import { reviewedArtifactSetSha256 } from './authority-materializer.js'
import { Phase3BProductionError, assertDigestField, canonicalBytes, deepFreeze, sha256Bytes, sha256Canonical } from './core.js'
import { REPOSITORY_AUTHORITY, crossRepoAuthority } from './ledger.js'
import { IMPLEMENTATION_REVIEW_RELATIVE, validateCampaignReviewerRegistry, verifyTrustedSignature, type TrustedReviewer, type TrustedReviewerRegistry } from './trust.js'

const RESERVED = new Set(['reviewer_identity', 'reviewer_role', 'signing_key_id', 'signature_algorithm', 'signature'])

export function signEphemeralRecord(input: Readonly<{ role: TrustedReviewer['reviewer_role']; identity: string; digest_field: string; payload: Readonly<Record<string, unknown>> }>): Readonly<{ public_entry: TrustedReviewer; signed_record: Readonly<Record<string, unknown>> }> {
  if (!/^[A-Za-z0-9._@-]{3,128}$/.test(input.identity) || !['requirements', 'security_quality'].includes(input.role) || !/^[a-z][a-z0-9_]{2,63}$/.test(input.digest_field) || input.digest_field in input.payload || [...RESERVED].some((field) => field in input.payload)) throw new Phase3BProductionError('ephemeral_signer_input_invalid', 'ephemeral signer input contains invalid identity, role, digest, or reserved fields')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicDer = publicKey.export({ format: 'der', type: 'spki' })
  const publicEntry: TrustedReviewer = deepFreeze({ key_id: `sha256:${sha256Bytes(publicDer)}`, public_key_der_base64: publicDer.toString('base64'), reviewer_identity: input.identity, reviewer_role: input.role })
  const unsigned = { ...input.payload, reviewer_identity: publicEntry.reviewer_identity, reviewer_role: publicEntry.reviewer_role, signing_key_id: publicEntry.key_id, signature_algorithm: 'ed25519_canonical_json_v1' }
  const signature = sign(null, Buffer.concat([canonicalBytes(unsigned), Buffer.from('\n', 'utf8')]), privateKey).toString('base64')
  const signed = { ...unsigned, signature }
  return deepFreeze({ public_entry: publicEntry, signed_record: { ...signed, [input.digest_field]: sha256Canonical(signed) } })
}

function assertWindow(createdAtMs: number, expiresAtMs: number): void {
  if (!Number.isSafeInteger(createdAtMs) || !Number.isSafeInteger(expiresAtMs) || expiresAtMs <= createdAtMs || expiresAtMs - createdAtMs > 86_400_000) throw new Phase3BProductionError('ephemeral_signer_input_invalid', 'signing window must be positive and at most 24 hours')
}

export function signImplementationReviewEphemeral(input: Readonly<{ identity: string; campaign_input: Readonly<Record<string, unknown>>; reviewed_candidate_commit: string; reviewed_candidate_tree: string; created_at_ms: number; expires_at_ms: number }>): ReturnType<typeof signEphemeralRecord> {
  assertWindow(input.created_at_ms, input.expires_at_ms)
  assertDigestField(input.campaign_input as Record<string, unknown>, 'input_sha256', 'ephemeral_signer_input_invalid')
  const c1 = crossRepoAuthority(String(input.campaign_input.cross_repo_review_sha256))
  return signEphemeralRecord({
    role: 'security_quality', identity: input.identity, digest_field: 'review_sha256',
    payload: {
      schema_id: 'oracle-lab-p3b-implementation-review.v3', review_kind: 'phase3b-production-executor', reviewed_candidate_commit: input.reviewed_candidate_commit, reviewed_candidate_tree: input.reviewed_candidate_tree,
      repositories: REPOSITORY_AUTHORITY, c1, reviewed_artifact_set_sha256: reviewedArtifactSetSha256(input.campaign_input), critical: 0, important: 0, verdict: 'PASS', created_at_ms: input.created_at_ms, expires_at_ms: input.expires_at_ms,
    },
  })
}

export function signOperatorAuthorityEphemeral(input: Readonly<{ identity: string; campaign_input: Readonly<Record<string, unknown>>; reviewed_candidate_commit: string; reviewed_candidate_tree: string; security_public_entry: TrustedReviewer; signed_implementation_review: Readonly<Record<string, unknown>>; created_at_ms: number; expires_at_ms: number }>): Readonly<{ public_entry: TrustedReviewer; registry: TrustedReviewerRegistry; signed_authority: Readonly<Record<string, unknown>> }> {
  assertWindow(input.created_at_ms, input.expires_at_ms)
  if (!/^[A-Za-z0-9._@-]{3,128}$/.test(input.identity)) throw new Phase3BProductionError('ephemeral_signer_input_invalid', 'requirements signer identity is invalid')
  assertDigestField(input.campaign_input as Record<string, unknown>, 'input_sha256', 'ephemeral_signer_input_invalid')
  assertDigestField(input.signed_implementation_review as Record<string, unknown>, 'review_sha256', 'ephemeral_signer_input_invalid')
  if (input.security_public_entry.reviewer_role !== 'security_quality') throw new Phase3BProductionError('ephemeral_signer_input_invalid', 'operator signer requires the independent security reviewer entry')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicDer = publicKey.export({ format: 'der', type: 'spki' })
  const publicEntry: TrustedReviewer = deepFreeze({ key_id: `sha256:${sha256Bytes(publicDer)}`, public_key_der_base64: publicDer.toString('base64'), reviewer_identity: input.identity, reviewer_role: 'requirements' })
  const registryUnsigned = { schema_id: 'oracle-lab-p3b-campaign-reviewers.v1', reviewed_candidate_commit: input.reviewed_candidate_commit, reviewed_candidate_tree: input.reviewed_candidate_tree, reviewers: [publicEntry, input.security_public_entry] }
  const registry = validateCampaignReviewerRegistry({ ...registryUnsigned, registry_sha256: sha256Canonical(registryUnsigned) })
  verifyTrustedSignature(input.signed_implementation_review as Record<string, unknown>, registry, 'security_quality', 'review_sha256', 'implementation_review_failed')
  const expectedArtifactSet = reviewedArtifactSetSha256(input.campaign_input)
  const expectedC1 = crossRepoAuthority(String(input.campaign_input.cross_repo_review_sha256))
  const review = input.signed_implementation_review
  if (review.schema_id !== 'oracle-lab-p3b-implementation-review.v3' || review.review_kind !== 'phase3b-production-executor' || review.reviewed_candidate_commit !== input.reviewed_candidate_commit || review.reviewed_candidate_tree !== input.reviewed_candidate_tree || review.reviewed_artifact_set_sha256 !== expectedArtifactSet || review.critical !== 0 || review.important !== 0 || review.verdict !== 'PASS' || sha256Canonical(review.repositories) !== sha256Canonical(REPOSITORY_AUTHORITY) || sha256Canonical(review.c1) !== sha256Canonical(expectedC1)) throw new Phase3BProductionError('implementation_review_failed', 'requirements signer received a non-PASS or drifted implementation review')
  const reviewRawSha256 = sha256Bytes(Buffer.concat([canonicalBytes(input.signed_implementation_review), Buffer.from('\n', 'utf8')]))
  const registryRawSha256 = sha256Bytes(Buffer.concat([canonicalBytes(registry), Buffer.from('\n', 'utf8')]))
  const c1 = expectedC1
  const authorityUnsigned = {
    schema_id: 'oracle-lab-p3b-production-authority.v2', decision: 'authorize_fresh_phase3b_production_campaign', campaign_id: input.campaign_input.campaign_id, campaign_input_sha256: input.campaign_input.input_sha256,
    repositories: REPOSITORY_AUTHORITY, c1, reviewed_candidate_commit: input.reviewed_candidate_commit, reviewed_candidate_tree: input.reviewed_candidate_tree, campaign_registry_sha256: registryRawSha256,
    implementation_review_path: path.join(String(input.campaign_input.cc_repository), IMPLEMENTATION_REVIEW_RELATIVE), implementation_review_sha256: reviewRawSha256, reviewed_artifact_set_sha256: reviewedArtifactSetSha256(input.campaign_input), critical: 0, important: 0, dynamic_launch_authorized: true,
    created_at_ms: input.created_at_ms, expires_at_ms: input.expires_at_ms, reviewer_identity: publicEntry.reviewer_identity, reviewer_role: publicEntry.reviewer_role, signing_key_id: publicEntry.key_id, signature_algorithm: 'ed25519_canonical_json_v1',
  }
  const signature = sign(null, Buffer.concat([canonicalBytes(authorityUnsigned), Buffer.from('\n', 'utf8')]), privateKey).toString('base64')
  const authoritySigned = { ...authorityUnsigned, signature }
  return deepFreeze({ public_entry: publicEntry, registry, signed_authority: { ...authoritySigned, authority_sha256: sha256Canonical(authoritySigned) } })
}
