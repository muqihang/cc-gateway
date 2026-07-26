import { generateKeyPairSync, sign } from 'node:crypto'

import path from 'node:path'

import { reviewedArtifactSetSha256 } from './authority-materializer.js'
import { Phase3BProductionError, assertDigestField, assertExactKeys, canonicalBytes, deepFreeze, sha256Bytes, sha256Canonical } from './core.js'
import { REPOSITORY_AUTHORITY, crossRepoAuthority } from './ledger.js'
import { IMPLEMENTATION_REVIEW_RELATIVE, validateCampaignReviewerRegistry, verifyTrustedSignature, type TrustedReviewer, type TrustedReviewerRegistry } from './trust.js'

const RESERVED = new Set(['reviewer_identity', 'reviewer_role', 'signing_key_id', 'signature_algorithm', 'signature'])

export function signEphemeralRecord(input: Readonly<{ role: TrustedReviewer['reviewer_role']; identity: string; digest_field: string; payload: Readonly<Record<string, unknown>> }>): Readonly<{ public_entry: TrustedReviewer; signed_record: Readonly<Record<string, unknown>> }> {
  if (!/^[A-Za-z0-9._@-]{3,128}$/.test(input.identity) || input.role !== 'security_quality' || !/^[a-z][a-z0-9_]{2,63}$/.test(input.digest_field) || input.digest_field in input.payload || [...RESERVED].some((field) => field in input.payload)) throw new Phase3BProductionError('ephemeral_signer_input_invalid', 'generic ephemeral signing is restricted to the isolated security-review role')
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

const GATE_B_UNSIGNED_KEYS = ['schema_id', 'decision_id', 'decision', 'campaign_id', 'gate_a_path', 'gate_a_sha256', 'gate_a_clock_sha256', 'external_set_path', 'external_set_sha256', 'conclusion_paths', 'conclusion_sha256s', 'implementation_review_sha256', 'issued_at_ms', 'issued_monotonic_ns', 'maximum_evaluation_delay_ms', 'scope', 'prohibited_claims'] as const

export function createRequirementsSignerSession(input: Readonly<{ identity: string; reviewed_candidate_commit: string; reviewed_candidate_tree: string }>): Readonly<{
  public_entry: TrustedReviewer
  bind_security_reviewer: (securityPublicEntry: TrustedReviewer) => TrustedReviewerRegistry
  sign_operator_authority: (authorityInput: Readonly<{ campaign_input: Readonly<Record<string, unknown>>; signed_implementation_review: Readonly<Record<string, unknown>>; approval_commit: string; approval_tree: string; attestation_commit: string; attestation_tree: string; created_at_ms: number; expires_at_ms: number }>) => Readonly<{ registry: TrustedReviewerRegistry; signed_authority: Readonly<Record<string, unknown>> }>
  sign_gate_b_decision: (payload: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>
  close: () => void
}> {
  if (!/^[A-Za-z0-9._@-]{3,128}$/.test(input.identity) || !/^[a-f0-9]{40}$/.test(input.reviewed_candidate_commit) || !/^[a-f0-9]{40}$/.test(input.reviewed_candidate_tree)) throw new Phase3BProductionError('ephemeral_signer_input_invalid', 'requirements signer identity or candidate is invalid')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicDer = publicKey.export({ format: 'der', type: 'spki' })
  const publicEntry: TrustedReviewer = deepFreeze({ key_id: `sha256:${sha256Bytes(publicDer)}`, public_key_der_base64: publicDer.toString('base64'), reviewer_identity: input.identity, reviewer_role: 'requirements' })
  let livePrivateKey: typeof privateKey | null = privateKey
  let registry: TrustedReviewerRegistry | null = null
  let campaignId: string | null = null
  let implementationReviewRawSha256: string | null = null
  let authoritySigned = false

  function requireKey(): typeof privateKey {
    if (!livePrivateKey) throw new Phase3BProductionError('ephemeral_signer_session_closed', 'requirements signer session is closed')
    return livePrivateKey
  }

  function bindSecurityReviewer(securityPublicEntry: TrustedReviewer): TrustedReviewerRegistry {
    requireKey()
    if (registry && registry.reviewers[1]?.key_id !== securityPublicEntry.key_id) throw new Phase3BProductionError('ephemeral_signer_input_invalid', 'security reviewer cannot be rebound')
    const registryUnsigned = { schema_id: 'oracle-lab-p3b-campaign-reviewers.v1', reviewed_candidate_commit: input.reviewed_candidate_commit, reviewed_candidate_tree: input.reviewed_candidate_tree, reviewers: [publicEntry, securityPublicEntry] }
    registry = validateCampaignReviewerRegistry({ ...registryUnsigned, registry_sha256: sha256Canonical(registryUnsigned) })
    return registry
  }

  function signOperatorAuthority(authorityInput: Readonly<{ campaign_input: Readonly<Record<string, unknown>>; signed_implementation_review: Readonly<Record<string, unknown>>; approval_commit: string; approval_tree: string; attestation_commit: string; attestation_tree: string; created_at_ms: number; expires_at_ms: number }>): Readonly<{ registry: TrustedReviewerRegistry; signed_authority: Readonly<Record<string, unknown>> }> {
    const key = requireKey()
    if (authoritySigned || !registry) throw new Phase3BProductionError('ephemeral_signer_lifecycle_invalid', 'registry must be fixed once before a single authority signature')
    assertWindow(authorityInput.created_at_ms, authorityInput.expires_at_ms)
    if (![authorityInput.approval_commit, authorityInput.approval_tree, authorityInput.attestation_commit, authorityInput.attestation_tree].every((value) => /^[a-f0-9]{40}$/.test(value))) throw new Phase3BProductionError('ephemeral_signer_input_invalid', 'operator authority requires exact approval merge and attestation identities')
    assertDigestField(authorityInput.campaign_input as Record<string, unknown>, 'input_sha256', 'ephemeral_signer_input_invalid')
    assertDigestField(authorityInput.signed_implementation_review as Record<string, unknown>, 'review_sha256', 'ephemeral_signer_input_invalid')
    verifyTrustedSignature(authorityInput.signed_implementation_review as Record<string, unknown>, registry, 'security_quality', 'review_sha256', 'implementation_review_failed')
    const expectedArtifactSet = reviewedArtifactSetSha256(authorityInput.campaign_input)
    const expectedC1 = crossRepoAuthority(String(authorityInput.campaign_input.cross_repo_review_sha256))
    const review = authorityInput.signed_implementation_review
    if (review.schema_id !== 'oracle-lab-p3b-implementation-review.v3' || review.review_kind !== 'phase3b-production-executor' || review.reviewed_candidate_commit !== input.reviewed_candidate_commit || review.reviewed_candidate_tree !== input.reviewed_candidate_tree || review.reviewed_artifact_set_sha256 !== expectedArtifactSet || review.critical !== 0 || review.important !== 0 || review.verdict !== 'PASS' || sha256Canonical(review.repositories) !== sha256Canonical(REPOSITORY_AUTHORITY) || sha256Canonical(review.c1) !== sha256Canonical(expectedC1)) throw new Phase3BProductionError('implementation_review_failed', 'requirements signer received a non-PASS or drifted implementation review')
    implementationReviewRawSha256 = sha256Bytes(Buffer.concat([canonicalBytes(review), Buffer.from('\n', 'utf8')]))
    const registryRawSha256 = sha256Bytes(Buffer.concat([canonicalBytes(registry), Buffer.from('\n', 'utf8')]))
    campaignId = String(authorityInput.campaign_input.campaign_id)
    const authorityUnsigned = {
      schema_id: 'oracle-lab-p3b-production-authority.v2', decision: 'authorize_fresh_phase3b_production_campaign', campaign_id: campaignId, campaign_input_sha256: authorityInput.campaign_input.input_sha256,
      repositories: REPOSITORY_AUTHORITY, c1: expectedC1, reviewed_candidate_commit: input.reviewed_candidate_commit, reviewed_candidate_tree: input.reviewed_candidate_tree, approval_commit: authorityInput.approval_commit, approval_tree: authorityInput.approval_tree, attestation_commit: authorityInput.attestation_commit, attestation_tree: authorityInput.attestation_tree, campaign_registry_sha256: registryRawSha256,
      implementation_review_path: path.join(String(authorityInput.campaign_input.cc_repository), IMPLEMENTATION_REVIEW_RELATIVE), implementation_review_sha256: implementationReviewRawSha256, reviewed_artifact_set_sha256: expectedArtifactSet, critical: 0, important: 0, dynamic_launch_authorized: true,
      created_at_ms: authorityInput.created_at_ms, expires_at_ms: authorityInput.expires_at_ms, reviewer_identity: publicEntry.reviewer_identity, reviewer_role: publicEntry.reviewer_role, signing_key_id: publicEntry.key_id, signature_algorithm: 'ed25519_canonical_json_v1',
    }
    const signature = sign(null, Buffer.concat([canonicalBytes(authorityUnsigned), Buffer.from('\n', 'utf8')]), key).toString('base64')
    const authorityWithSignature = { ...authorityUnsigned, signature }
    authoritySigned = true
    return deepFreeze({ registry, signed_authority: { ...authorityWithSignature, authority_sha256: sha256Canonical(authorityWithSignature) } })
  }

  function signGateBDecision(payload: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    const key = requireKey()
    if (!authoritySigned || !registry || !campaignId || !implementationReviewRawSha256) throw new Phase3BProductionError('ephemeral_signer_lifecycle_invalid', 'Gate B decision requires the earlier authority signature')
    assertExactKeys(payload, GATE_B_UNSIGNED_KEYS, 'ephemeral_signer_input_invalid')
    if (payload.schema_id !== 'oracle-lab-p3b-operator-decision.v2' || payload.decision !== 'evaluate_successor_amendment_startable' || payload.campaign_id !== campaignId || payload.implementation_review_sha256 !== implementationReviewRawSha256) throw new Phase3BProductionError('ephemeral_signer_input_invalid', 'Gate B decision scope does not match the retained authority session')
    const unsigned = { ...payload, reviewer_identity: publicEntry.reviewer_identity, reviewer_role: publicEntry.reviewer_role, signing_key_id: publicEntry.key_id, signature_algorithm: 'ed25519_canonical_json_v1' }
    const signature = sign(null, Buffer.concat([canonicalBytes(unsigned), Buffer.from('\n', 'utf8')]), key).toString('base64')
    const signed = { ...unsigned, signature }
    livePrivateKey = null
    return deepFreeze({ ...signed, decision_sha256: sha256Canonical(signed) })
  }

  return Object.freeze({ public_entry: publicEntry, bind_security_reviewer: bindSecurityReviewer, sign_operator_authority: signOperatorAuthority, sign_gate_b_decision: signGateBDecision, close: () => { livePrivateKey = null } })
}
