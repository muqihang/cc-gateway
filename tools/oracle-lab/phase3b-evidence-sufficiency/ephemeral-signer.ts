import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto'

import path from 'node:path'

import { reviewedArtifactSetSha256 } from './authority-materializer.js'
import { Phase3BProductionError, assertDigestField, assertExactKeys, canonicalBytes, deepFreeze, sha256Bytes, sha256Canonical } from './core.js'
import { REPOSITORY_AUTHORITY, crossRepoAuthority } from './ledger.js'
import { IMPLEMENTATION_REVIEW_RELATIVE, validateCampaignReviewerRegistry, validateTrustedReviewerPublicEntry, verifyTrustedSignature, type TrustedReviewer, type TrustedReviewerRegistry } from './trust.js'
import { validateSealedGateBResult } from './gates.js'
import { validatePostGateLeakReport } from './closeout.js'

const RESERVED = new Set(['reviewer_identity', 'reviewer_role', 'signing_key_id', 'signature_algorithm', 'signature'])
const LEGACY_REVIEW_INPUT_KEYS = ['identity', 'requirements_public_entry', 'campaign_input', 'reviewed_candidate_commit', 'reviewed_candidate_tree', 'created_at_ms', 'expires_at_ms'] as const
const REVIEW_PAYLOAD_KEYS = ['schema_id', 'review_kind', 'reviewed_candidate_commit', 'reviewed_candidate_tree', 'repositories', 'c1', 'requirements_public_entry_sha256', 'reviewed_artifact_set_sha256', 'critical', 'important', 'verdict', 'created_at_ms', 'expires_at_ms'] as const

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

function validatedWindow(createdAtMs: unknown, expiresAtMs: unknown, code = 'ephemeral_signer_input_invalid'): readonly [number, number] {
  if (typeof createdAtMs !== 'number' || typeof expiresAtMs !== 'number' || !Number.isSafeInteger(createdAtMs) || !Number.isSafeInteger(expiresAtMs) || expiresAtMs <= createdAtMs || expiresAtMs - createdAtMs > 86_400_000) throw new Phase3BProductionError(code, 'signing window must use integer millisecond timestamps and be positive and at most 24 hours')
  return [createdAtMs, expiresAtMs]
}

function assertRequirementsPublicEntry(entry: TrustedReviewer): void {
  assertExactKeys(entry, ['key_id', 'public_key_der_base64', 'reviewer_identity', 'reviewer_role'], 'ephemeral_signer_input_invalid')
  let der: Buffer
  try {
    der = Buffer.from(entry.public_key_der_base64, 'base64')
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' })
    const canonicalDer = key.export({ format: 'der', type: 'spki' })
    if (entry.reviewer_role !== 'requirements' || der.toString('base64') !== entry.public_key_der_base64 || key.asymmetricKeyType !== 'ed25519' || !Buffer.from(canonicalDer).equals(der) || entry.key_id !== `sha256:${sha256Bytes(der)}`) throw new Error('invalid requirements key')
  } catch { throw new Phase3BProductionError('ephemeral_signer_input_invalid', 'implementation review requires the pre-existing canonical requirements public entry') }
}

export function buildCampaignReviewRequest(input: Readonly<{
  requirements_public_entry: TrustedReviewer
  security_public_entry: TrustedReviewer
  campaign_input: Readonly<Record<string, unknown>>
  reviewed_candidate_commit: string
  reviewed_candidate_tree: string
  created_at_ms: number
  expires_at_ms: number
}>): Readonly<{ registry: TrustedReviewerRegistry; review_payload: Readonly<Record<string, unknown>> }> {
  assertExactKeys(input, ['requirements_public_entry', 'security_public_entry', 'campaign_input', 'reviewed_candidate_commit', 'reviewed_candidate_tree', 'created_at_ms', 'expires_at_ms'], 'ephemeral_signer_input_invalid')
  const requirements = validateTrustedReviewerPublicEntry(input.requirements_public_entry, 'requirements')
  const security = validateTrustedReviewerPublicEntry(input.security_public_entry, 'security_quality')
  if (!/^[a-f0-9]{40}$/.test(input.reviewed_candidate_commit) || !/^[a-f0-9]{40}$/.test(input.reviewed_candidate_tree)) throw new Phase3BProductionError('ephemeral_signer_input_invalid', 'review request requires exact candidate identities')
  validatedWindow(input.created_at_ms, input.expires_at_ms)
  assertDigestField(input.campaign_input as Record<string, unknown>, 'input_sha256', 'ephemeral_signer_input_invalid')
  const registryUnsigned = {
    schema_id: 'oracle-lab-p3b-campaign-reviewers.v1' as const,
    reviewed_candidate_commit: input.reviewed_candidate_commit,
    reviewed_candidate_tree: input.reviewed_candidate_tree,
    reviewers: [requirements, security] as const,
  }
  const registry = validateCampaignReviewerRegistry({ ...registryUnsigned, registry_sha256: sha256Canonical(registryUnsigned) })
  const reviewPayload = {
    schema_id: 'oracle-lab-p3b-implementation-review.v3', review_kind: 'phase3b-production-executor', reviewed_candidate_commit: input.reviewed_candidate_commit, reviewed_candidate_tree: input.reviewed_candidate_tree,
    repositories: REPOSITORY_AUTHORITY, c1: crossRepoAuthority(String(input.campaign_input.cross_repo_review_sha256)), requirements_public_entry_sha256: sha256Canonical(requirements), reviewed_artifact_set_sha256: reviewedArtifactSetSha256(input.campaign_input), critical: 0, important: 0, verdict: 'PASS', created_at_ms: input.created_at_ms, expires_at_ms: input.expires_at_ms,
  }
  return deepFreeze({ registry, review_payload: reviewPayload })
}

export function createSecurityReviewerSignerSession(input: Readonly<{ identity: string; reviewed_candidate_commit: string; reviewed_candidate_tree: string }>): Readonly<{
  public_entry: TrustedReviewer
  sign_implementation_review: (request: Readonly<{ registry: TrustedReviewerRegistry; review_payload: Readonly<Record<string, unknown>> }>) => Readonly<Record<string, unknown>>
  close: () => void
}> {
  assertExactKeys(input, ['identity', 'reviewed_candidate_commit', 'reviewed_candidate_tree'], 'ephemeral_signer_input_invalid')
  if (!/^[A-Za-z0-9._@-]{3,128}$/.test(input.identity) || !/^[a-f0-9]{40}$/.test(input.reviewed_candidate_commit) || !/^[a-f0-9]{40}$/.test(input.reviewed_candidate_tree)) throw new Phase3BProductionError('ephemeral_signer_input_invalid', 'security signer identity or candidate is invalid')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicDer = publicKey.export({ format: 'der', type: 'spki' })
  const publicEntry = validateTrustedReviewerPublicEntry({ key_id: `sha256:${sha256Bytes(publicDer)}`, public_key_der_base64: publicDer.toString('base64'), reviewer_identity: input.identity, reviewer_role: 'security_quality' }, 'security_quality')
  let livePrivateKey: typeof privateKey | null = privateKey

  function signImplementationReview(request: Readonly<{ registry: TrustedReviewerRegistry; review_payload: Readonly<Record<string, unknown>> }>): Readonly<Record<string, unknown>> {
    const key = livePrivateKey
    if (!key) throw new Phase3BProductionError('ephemeral_signer_session_closed', 'security signer session is closed')
    try {
      assertExactKeys(request, ['registry', 'review_payload'], 'ephemeral_signer_input_invalid')
      const registry = validateCampaignReviewerRegistry(request.registry)
      const payload = request.review_payload as Record<string, unknown>
      assertExactKeys(payload, REVIEW_PAYLOAD_KEYS, 'ephemeral_signer_input_invalid')
      if (registry.reviewed_candidate_commit !== input.reviewed_candidate_commit || registry.reviewed_candidate_tree !== input.reviewed_candidate_tree || sha256Canonical(registry.reviewers[1]) !== sha256Canonical(publicEntry)) throw new Phase3BProductionError('ephemeral_signer_input_invalid', 'registry does not contain the exact emitted security signer entry')
      validatedWindow(payload.created_at_ms, payload.expires_at_ms)
      const c1 = payload.c1 as Record<string, unknown>
      if (payload.schema_id !== 'oracle-lab-p3b-implementation-review.v3' || payload.review_kind !== 'phase3b-production-executor' || payload.reviewed_candidate_commit !== input.reviewed_candidate_commit || payload.reviewed_candidate_tree !== input.reviewed_candidate_tree || payload.requirements_public_entry_sha256 !== sha256Canonical(registry.reviewers[0]) || !/^[a-f0-9]{64}$/.test(String(payload.reviewed_artifact_set_sha256)) || payload.critical !== 0 || payload.important !== 0 || payload.verdict !== 'PASS' || sha256Canonical(payload.repositories) !== sha256Canonical(REPOSITORY_AUTHORITY) || !c1 || c1.verdict !== 'CROSS_REPO_PASS' || sha256Canonical(c1) !== sha256Canonical(crossRepoAuthority(String(c1.review_sha256)))) throw new Phase3BProductionError('ephemeral_signer_input_invalid', 'implementation review payload does not bind the exact emitted signer registry')
      const unsigned = { ...payload, reviewer_identity: publicEntry.reviewer_identity, reviewer_role: publicEntry.reviewer_role, signing_key_id: publicEntry.key_id, signature_algorithm: 'ed25519_canonical_json_v1' }
      const signature = sign(null, Buffer.concat([canonicalBytes(unsigned), Buffer.from('\n', 'utf8')]), key).toString('base64')
      const signed = { ...unsigned, signature }
      livePrivateKey = null
      return deepFreeze({ ...signed, review_sha256: sha256Canonical(signed) })
    } catch (error) {
      livePrivateKey = null
      throw error
    }
  }

  return Object.freeze({ public_entry: publicEntry, sign_implementation_review: signImplementationReview, close: () => { livePrivateKey = null } })
}

export function signImplementationReviewEphemeral(input: Readonly<{ identity: string; requirements_public_entry: TrustedReviewer; campaign_input: Readonly<Record<string, unknown>>; reviewed_candidate_commit: string; reviewed_candidate_tree: string; created_at_ms: number; expires_at_ms: number }>): ReturnType<typeof signEphemeralRecord> {
  assertExactKeys(input, LEGACY_REVIEW_INPUT_KEYS, 'ephemeral_signer_input_invalid')
  assertRequirementsPublicEntry(input.requirements_public_entry)
  if (input.identity === input.requirements_public_entry.reviewer_identity) throw new Phase3BProductionError('ephemeral_signer_input_invalid', 'security review requires an independent reviewer identity')
  const signer = createSecurityReviewerSignerSession({ identity: input.identity, reviewed_candidate_commit: input.reviewed_candidate_commit, reviewed_candidate_tree: input.reviewed_candidate_tree })
  const request = buildCampaignReviewRequest({ requirements_public_entry: input.requirements_public_entry, security_public_entry: signer.public_entry, campaign_input: input.campaign_input, reviewed_candidate_commit: input.reviewed_candidate_commit, reviewed_candidate_tree: input.reviewed_candidate_tree, created_at_ms: input.created_at_ms, expires_at_ms: input.expires_at_ms })
  return deepFreeze({ public_entry: signer.public_entry, signed_record: signer.sign_implementation_review(request) })
}

const GATE_B_UNSIGNED_KEYS = ['schema_id', 'decision_id', 'decision', 'campaign_id', 'gate_a_path', 'gate_a_sha256', 'gate_a_clock_sha256', 'external_set_path', 'external_set_sha256', 'conclusion_paths', 'conclusion_sha256s', 'implementation_review_sha256', 'issued_at_ms', 'issued_monotonic_ns', 'maximum_evaluation_delay_ms', 'scope', 'prohibited_claims'] as const

export function createRequirementsSignerSession(input: Readonly<{ identity: string; reviewed_candidate_commit: string; reviewed_candidate_tree: string }>): Readonly<{
  public_entry: TrustedReviewer
  bind_security_reviewer: (securityPublicEntry: TrustedReviewer) => TrustedReviewerRegistry
  sign_operator_authority: (authorityInput: Readonly<{ campaign_input: Readonly<Record<string, unknown>>; signed_implementation_review: Readonly<Record<string, unknown>>; approval_commit: string; approval_tree: string; attestation_commit: string; attestation_tree: string; created_at_ms: unknown; expires_at_ms: unknown }>) => Readonly<{ registry: TrustedReviewerRegistry; signed_authority: Readonly<Record<string, unknown>> }>
  sign_gate_b_decision: (payload: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>
  confirm_gate_b_result: (input: Readonly<{ evidence_root?: string; result_path?: string } & Record<string, unknown>>) => Readonly<Record<string, unknown>>
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
  let gateBDecision: Readonly<Record<string, unknown>> | null = null

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

  function signOperatorAuthority(authorityInput: Readonly<{ campaign_input: Readonly<Record<string, unknown>>; signed_implementation_review: Readonly<Record<string, unknown>>; approval_commit: string; approval_tree: string; attestation_commit: string; attestation_tree: string; created_at_ms: unknown; expires_at_ms: unknown }>): Readonly<{ registry: TrustedReviewerRegistry; signed_authority: Readonly<Record<string, unknown>> }> {
    const key = requireKey()
    if (authoritySigned || !registry) throw new Phase3BProductionError('ephemeral_signer_lifecycle_invalid', 'registry must be fixed once before a single authority signature')
    const [createdAtMs, expiresAtMs] = validatedWindow(authorityInput.created_at_ms, authorityInput.expires_at_ms)
    if (![authorityInput.approval_commit, authorityInput.approval_tree, authorityInput.attestation_commit, authorityInput.attestation_tree].every((value) => /^[a-f0-9]{40}$/.test(value))) throw new Phase3BProductionError('ephemeral_signer_input_invalid', 'operator authority requires exact approval merge and attestation identities')
    assertDigestField(authorityInput.campaign_input as Record<string, unknown>, 'input_sha256', 'ephemeral_signer_input_invalid')
    assertDigestField(authorityInput.signed_implementation_review as Record<string, unknown>, 'review_sha256', 'ephemeral_signer_input_invalid')
    verifyTrustedSignature(authorityInput.signed_implementation_review as Record<string, unknown>, registry, 'security_quality', 'review_sha256', 'implementation_review_failed')
    const expectedArtifactSet = reviewedArtifactSetSha256(authorityInput.campaign_input)
    const expectedC1 = crossRepoAuthority(String(authorityInput.campaign_input.cross_repo_review_sha256))
    const review = authorityInput.signed_implementation_review
    validatedWindow(review.created_at_ms, review.expires_at_ms, 'implementation_review_failed')
    if (review.schema_id !== 'oracle-lab-p3b-implementation-review.v3' || review.review_kind !== 'phase3b-production-executor' || review.reviewed_candidate_commit !== input.reviewed_candidate_commit || review.reviewed_candidate_tree !== input.reviewed_candidate_tree || review.requirements_public_entry_sha256 !== sha256Canonical(publicEntry) || review.reviewed_artifact_set_sha256 !== expectedArtifactSet || review.critical !== 0 || review.important !== 0 || review.verdict !== 'PASS' || sha256Canonical(review.repositories) !== sha256Canonical(REPOSITORY_AUTHORITY) || sha256Canonical(review.c1) !== sha256Canonical(expectedC1)) throw new Phase3BProductionError('implementation_review_failed', 'requirements signer received a non-PASS or drifted implementation review')
    implementationReviewRawSha256 = sha256Bytes(Buffer.concat([canonicalBytes(review), Buffer.from('\n', 'utf8')]))
    const registryRawSha256 = sha256Bytes(Buffer.concat([canonicalBytes(registry), Buffer.from('\n', 'utf8')]))
    campaignId = String(authorityInput.campaign_input.campaign_id)
    const authorityUnsigned = {
      schema_id: 'oracle-lab-p3b-production-authority.v2', decision: 'authorize_fresh_phase3b_production_campaign', campaign_id: campaignId, campaign_input_sha256: authorityInput.campaign_input.input_sha256,
      repositories: REPOSITORY_AUTHORITY, c1: expectedC1, reviewed_candidate_commit: input.reviewed_candidate_commit, reviewed_candidate_tree: input.reviewed_candidate_tree, approval_commit: authorityInput.approval_commit, approval_tree: authorityInput.approval_tree, attestation_commit: authorityInput.attestation_commit, attestation_tree: authorityInput.attestation_tree, campaign_registry_sha256: registryRawSha256,
      implementation_review_path: path.join(String(authorityInput.campaign_input.cc_repository), IMPLEMENTATION_REVIEW_RELATIVE), implementation_review_sha256: implementationReviewRawSha256, reviewed_artifact_set_sha256: expectedArtifactSet, critical: 0, important: 0, dynamic_launch_authorized: true,
      created_at_ms: createdAtMs, expires_at_ms: expiresAtMs, reviewer_identity: publicEntry.reviewer_identity, reviewer_role: publicEntry.reviewer_role, signing_key_id: publicEntry.key_id, signature_algorithm: 'ed25519_canonical_json_v1',
    }
    const signature = sign(null, Buffer.concat([canonicalBytes(authorityUnsigned), Buffer.from('\n', 'utf8')]), key).toString('base64')
    const authorityWithSignature = { ...authorityUnsigned, signature }
    authoritySigned = true
    return deepFreeze({ registry, signed_authority: { ...authorityWithSignature, authority_sha256: sha256Canonical(authorityWithSignature) } })
  }

  function signGateBDecision(payload: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    const key = requireKey()
    if (!authoritySigned || !registry || !campaignId || !implementationReviewRawSha256) throw new Phase3BProductionError('ephemeral_signer_lifecycle_invalid', 'Gate B decision requires the earlier authority signature')
    if (gateBDecision) throw new Phase3BProductionError('ephemeral_signer_lifecycle_invalid', 'Gate B decision may be signed only once')
    assertExactKeys(payload, GATE_B_UNSIGNED_KEYS, 'ephemeral_signer_input_invalid')
    if (payload.schema_id !== 'oracle-lab-p3b-operator-decision.v2' || payload.decision !== 'evaluate_successor_amendment_startable' || payload.campaign_id !== campaignId || payload.implementation_review_sha256 !== implementationReviewRawSha256) throw new Phase3BProductionError('ephemeral_signer_input_invalid', 'Gate B decision scope does not match the retained authority session')
    const unsigned = { ...payload, reviewer_identity: publicEntry.reviewer_identity, reviewer_role: publicEntry.reviewer_role, signing_key_id: publicEntry.key_id, signature_algorithm: 'ed25519_canonical_json_v1' }
    const signature = sign(null, Buffer.concat([canonicalBytes(unsigned), Buffer.from('\n', 'utf8')]), key).toString('base64')
    const signed = { ...unsigned, signature }
    gateBDecision = deepFreeze({ ...signed, decision_sha256: sha256Canonical(signed) })
    return gateBDecision
  }

  function confirmGateBResult(input: Readonly<{ evidence_root?: string; result_path?: string } & Record<string, unknown>>): Readonly<Record<string, unknown>> {
    requireKey()
    if (!gateBDecision || !campaignId) throw new Phase3BProductionError('ephemeral_signer_lifecycle_invalid', 'Gate B result confirmation requires the retained signed decision')
    if (!input || typeof input.evidence_root !== 'string' || typeof input.result_path !== 'string') throw new Phase3BProductionError('ephemeral_signer_input_invalid', 'Gate B confirmation accepts only the fixed sealed result path')
    const sealed = validateSealedGateBResult(input.evidence_root, input.result_path)
    const postGateLeak = validatePostGateLeakReport(input.evidence_root)
    const payload = sealed.value
    assertExactKeys(payload, ['schema_id', 'gate', 'decision', 'campaign_id', 'gate_a_sha256', 'external_set_sha256', 'operator_decision_sha256', 'conclusion_sha256s', 'gate_clock_sha256', 'evaluation_input_sha256', 'phase3b_usable', 'gate_result_sha256'], 'ephemeral_signer_input_invalid')
    assertDigestField(payload as Record<string, unknown>, 'gate_result_sha256', 'ephemeral_signer_input_invalid')
    if (payload.schema_id !== 'oracle-lab-p3b-gate-result.v1' || payload.gate !== 'B' || payload.decision !== 'PASS' || payload.phase3b_usable !== true || payload.campaign_id !== campaignId || payload.gate_a_sha256 !== gateBDecision.gate_a_sha256 || payload.external_set_sha256 !== gateBDecision.external_set_sha256 || payload.operator_decision_sha256 !== gateBDecision.decision_sha256 || sha256Canonical(payload.conclusion_sha256s) !== sha256Canonical(gateBDecision.conclusion_sha256s) || typeof payload.gate_clock_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(payload.gate_clock_sha256)) throw new Phase3BProductionError('ephemeral_signer_input_invalid', 'Gate B result does not bind the retained decision and Gate A support')
    const key = requireKey()
    const unsigned = { schema_id: 'oracle-lab-p3b-requirements-signer-closure.v2', campaign_id: campaignId, operator_decision_sha256: gateBDecision.decision_sha256, gate_b_result_sha256: payload.gate_result_sha256, gate_b_result_raw_sha256: sealed.identity.sha256, gate_b_result_dev: sealed.identity.dev, gate_b_result_ino: sealed.identity.ino, gate_b_result_size: sealed.identity.size, post_gate_leak_report_sha256: postGateLeak.post_gate_leak_report_sha256, evaluation_input_sha256: payload.evaluation_input_sha256, evidence_root: path.resolve(input.evidence_root), result_path: path.resolve(input.result_path), reviewer_identity: publicEntry.reviewer_identity, reviewer_role: publicEntry.reviewer_role, signing_key_id: publicEntry.key_id, signature_algorithm: 'ed25519_canonical_json_v1', status: 'private_key_destroyed_after_gate_b' }
    const signature = sign(null, Buffer.concat([canonicalBytes(unsigned), Buffer.from('\n', 'utf8')]), key).toString('base64')
    const signed = { ...unsigned, signature }
    livePrivateKey = null
    return deepFreeze({ ...signed, closure_sha256: sha256Canonical(signed) })
  }

  return Object.freeze({ public_entry: publicEntry, bind_security_reviewer: bindSecurityReviewer, sign_operator_authority: signOperatorAuthority, sign_gate_b_decision: signGateBDecision, confirm_gate_b_result: confirmGateBResult, close: () => { livePrivateKey = null } })
}
