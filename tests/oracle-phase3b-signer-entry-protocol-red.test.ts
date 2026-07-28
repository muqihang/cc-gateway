import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import test from 'node:test'

import { canonicalBytes, canonicalJson, sha256Bytes, sha256Canonical } from '../tools/oracle-lab/phase3b-evidence-sufficiency/core.js'
import { buildCampaignReviewRequest, createRequirementsSignerSession, createSecurityReviewerSignerSession, signEphemeralRecord, signImplementationReviewEphemeral } from '../tools/oracle-lab/phase3b-evidence-sufficiency/ephemeral-signer.js'
import { validateCampaignReviewerRegistry, verifyTrustedSignature, type TrustedReviewer } from '../tools/oracle-lab/phase3b-evidence-sufficiency/trust.js'

const CANDIDATE = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } as const
const CAMPAIGN_INPUT = {
  input_sha256: '',
  cross_repo_review_sha256: 'c'.repeat(64),
  cross_review_artifact_sha256: 'd'.repeat(64),
  probe_source_sha256: 'e'.repeat(64),
  probe_unsigned_source_sha256: 'f'.repeat(64),
  original_recipe_sha256: '1'.repeat(64),
  probe_recipe_sha256: '2'.repeat(64),
  source_tree_sha256: '3'.repeat(64),
  toolchain_sha256: '4'.repeat(64),
  schema_bundle_sha256: '5'.repeat(64),
  focused_suite_sha256: '6'.repeat(64),
  es7_typed_fixtures_sha256: '7'.repeat(64),
  es8_go_receipt_sha256: '8'.repeat(64),
  es8_ts_c1_agreement_sha256: '9'.repeat(64),
  es9_coverage_contract_sha256: '0'.repeat(64),
} as Record<string, unknown>
CAMPAIGN_INPUT.input_sha256 = sha256Canonical(Object.fromEntries(Object.entries(CAMPAIGN_INPUT).filter(([field]) => field !== 'input_sha256')))

function controllerPreparedInput(securityPublicEntry: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const requirements = signEphemeralRecord({ role: 'security_quality', identity: 'requirements-entry-source', digest_field: 'review_sha256', payload: { schema_id: 'entry-source.v1' } }).public_entry
  const requirementsEntry = { ...requirements, reviewer_identity: 'requirements-entry-readback', reviewer_role: 'requirements' }
  const registryUnsigned = {
    schema_id: 'oracle-lab-p3b-campaign-reviewers.v1',
    reviewed_candidate_commit: CANDIDATE.commit,
    reviewed_candidate_tree: CANDIDATE.tree,
    reviewers: [requirementsEntry, securityPublicEntry],
  }
  const registry = validateCampaignReviewerRegistry({ ...registryUnsigned, registry_sha256: sha256Canonical(registryUnsigned) })
  return {
    identity: 'security-actual-signer',
    requirements_public_entry: requirementsEntry,
    campaign_input: CAMPAIGN_INPUT,
    reviewed_candidate_commit: CANDIDATE.commit,
    reviewed_candidate_tree: CANDIDATE.tree,
    created_at_ms: 10,
    expires_at_ms: 20,
    campaign_registry: registry,
    security_public_entry: securityPublicEntry,
  }
}

test('RED: signer rejects a controller registry built from a temporary security entry', () => {
  const temporary = signEphemeralRecord({ role: 'security_quality', identity: 'security-actual-signer', digest_field: 'review_sha256', payload: { schema_id: 'temporary-key.v1' } }).public_entry

  assert.throws(
    () => signImplementationReviewEphemeral(controllerPreparedInput(temporary) as never),
    (error: Error & { code?: string }) => error.code === 'ephemeral_signer_input_invalid',
  )
})

test('RED: signer rejects a substituted or tampered controller public entry', () => {
  const emitted = signEphemeralRecord({ role: 'security_quality', identity: 'security-actual-signer', digest_field: 'review_sha256', payload: { schema_id: 'emitted-entry.v1' } }).public_entry
  const tampered = { ...emitted, reviewer_identity: 'security-substituted-signer' }

  assert.throws(
    () => signImplementationReviewEphemeral(controllerPreparedInput(tampered) as never),
    (error: Error & { code?: string }) => error.code === 'ephemeral_signer_input_invalid',
  )
})

function actualReadback<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T
}

function reviewRequest(requirementsEntry: TrustedReviewer, securityEntry: TrustedReviewer) {
  return buildCampaignReviewRequest({
    requirements_public_entry: actualReadback(requirementsEntry),
    security_public_entry: actualReadback(securityEntry),
    campaign_input: CAMPAIGN_INPUT,
    reviewed_candidate_commit: CANDIDATE.commit,
    reviewed_candidate_tree: CANDIDATE.tree,
    created_at_ms: 10,
    expires_at_ms: 20,
  })
}

function independentlySignedMalformedReview(requirementsEntry: TrustedReviewer, createdAtMs: unknown, expiresAtMs: unknown): Readonly<{ publicEntry: TrustedReviewer; signedReview: Readonly<Record<string, unknown>> }> {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicDer = publicKey.export({ format: 'der', type: 'spki' })
  const publicEntry: TrustedReviewer = {
    key_id: `sha256:${sha256Bytes(publicDer)}`,
    public_key_der_base64: publicDer.toString('base64'),
    reviewer_identity: 'security-malformed-review-source',
    reviewer_role: 'security_quality',
  }
  const request = reviewRequest(requirementsEntry, publicEntry)
  const payload = { ...request.review_payload, created_at_ms: createdAtMs, expires_at_ms: expiresAtMs }
  const unsigned = {
    ...payload,
    reviewer_identity: publicEntry.reviewer_identity,
    reviewer_role: publicEntry.reviewer_role,
    signing_key_id: publicEntry.key_id,
    signature_algorithm: 'ed25519_canonical_json_v1',
  }
  const signature = sign(null, Buffer.concat([canonicalBytes(unsigned), Buffer.from('\n', 'utf8')]), privateKey).toString('base64')
  const signed = { ...unsigned, signature }
  return { publicEntry, signedReview: { ...signed, review_sha256: sha256Canonical(signed) } }
}

test('RED: security signer rejects raw coercible review timestamps and destroys the one-shot session', () => {
  const malformedWindows = [
    { created_at_ms: '10', expires_at_ms: 20 },
    { created_at_ms: 0, expires_at_ms: '20' },
    { created_at_ms: true, expires_at_ms: 20 },
    { created_at_ms: 0, expires_at_ms: true },
    { created_at_ms: null, expires_at_ms: 20 },
  ] as const

  for (const malformedWindow of malformedWindows) {
    const requirements = createRequirementsSignerSession({ identity: `requirements-window-${String(malformedWindow.created_at_ms)}-${String(malformedWindow.expires_at_ms)}`, reviewed_candidate_commit: CANDIDATE.commit, reviewed_candidate_tree: CANDIDATE.tree })
    const security = createSecurityReviewerSignerSession({ identity: `security-window-${String(malformedWindow.created_at_ms)}-${String(malformedWindow.expires_at_ms)}`, reviewed_candidate_commit: CANDIDATE.commit, reviewed_candidate_tree: CANDIDATE.tree })
    const validRequest = reviewRequest(requirements.public_entry, security.public_entry)
    const malformedRequest = {
      ...validRequest,
      review_payload: { ...validRequest.review_payload, ...malformedWindow },
    }

    assert.throws(() => security.sign_implementation_review(malformedRequest), (error: Error & { code?: string }) => error.code === 'ephemeral_signer_input_invalid')
    assert.throws(() => security.sign_implementation_review(validRequest), (error: Error & { code?: string }) => error.code === 'ephemeral_signer_session_closed')
    requirements.close()
  }
})

test('RED: requirements signer independently rejects a signed review with malformed timestamp types', () => {
  const requirements = createRequirementsSignerSession({ identity: 'requirements-malformed-review', reviewed_candidate_commit: CANDIDATE.commit, reviewed_candidate_tree: CANDIDATE.tree })
  const malformed = independentlySignedMalformedReview(requirements.public_entry, '10', '20')
  requirements.bind_security_reviewer(malformed.publicEntry)

  assert.throws(
    () => requirements.sign_operator_authority({
      campaign_input: CAMPAIGN_INPUT,
      signed_implementation_review: malformed.signedReview,
      approval_commit: 'c'.repeat(40),
      approval_tree: 'd'.repeat(40),
      attestation_commit: 'e'.repeat(40),
      attestation_tree: 'f'.repeat(40),
      created_at_ms: 11,
      expires_at_ms: 21,
    }),
    (error: Error & { code?: string }) => error.code === 'implementation_review_failed',
  )
  requirements.close()
})

test('RED: production materializer identity and focused closures include the signer protocol surface', () => {
  const root = path.join(import.meta.dirname, '..')
  const materializer = readFileSync(path.join(root, 'tools/oracle-lab/phase3b-evidence-sufficiency/authority-materializer.ts'), 'utf8')
  const sourceIdentity = readFileSync(path.join(root, 'tools/oracle-lab/phase3b-evidence-sufficiency/source-identity.ts'), 'utf8')

  assert.match(materializer, /const focused = \[[^\]]*tests\/oracle-phase3b-signer-entry-protocol-red\.test\.ts[^\]]*\]/s)
  assert.match(materializer, /const sources = \[[^\]]*security-reviewer-session-cli\.ts[^\]]*\]/s)
  assert.match(materializer, /const schemaFiles = \[[^\]]*security-reviewer-session-cli\.ts[^\]]*\]/s)
  assert.match(sourceIdentity, /const CONTROLLER_SOURCES = \[[^\]]*security-reviewer-session-cli\.ts[^\]]*\]/s)
})

test('GREEN: controller-built registry uses exact signer readbacks and the same security session signs', () => {
  const requirements = createRequirementsSignerSession({ identity: 'requirements-readback', reviewed_candidate_commit: CANDIDATE.commit, reviewed_candidate_tree: CANDIDATE.tree })
  const security = createSecurityReviewerSignerSession({ identity: 'security-readback', reviewed_candidate_commit: CANDIDATE.commit, reviewed_candidate_tree: CANDIDATE.tree })
  const request = reviewRequest(requirements.public_entry, security.public_entry)
  const signed = security.sign_implementation_review(request)

  assert.deepEqual(request.registry.reviewers, [requirements.public_entry, security.public_entry])
  assert.equal(signed.signing_key_id, security.public_entry.key_id)
  assert.doesNotThrow(() => verifyTrustedSignature(signed as Record<string, unknown>, request.registry, 'security_quality', 'review_sha256', 'implementation_review_failed'))
  assert.throws(() => security.sign_implementation_review(request), (error: Error & { code?: string }) => error.code === 'ephemeral_signer_session_closed')
  requirements.close()
})

test('GREEN: substituted or temporary security entry cannot be signed by another session', () => {
  const requirements = createRequirementsSignerSession({ identity: 'requirements-substitution', reviewed_candidate_commit: CANDIDATE.commit, reviewed_candidate_tree: CANDIDATE.tree })
  const actual = createSecurityReviewerSignerSession({ identity: 'security-substitution', reviewed_candidate_commit: CANDIDATE.commit, reviewed_candidate_tree: CANDIDATE.tree })
  const temporary = createSecurityReviewerSignerSession({ identity: 'security-substitution', reviewed_candidate_commit: CANDIDATE.commit, reviewed_candidate_tree: CANDIDATE.tree })
  const request = reviewRequest(requirements.public_entry, temporary.public_entry)

  assert.throws(() => actual.sign_implementation_review(request), (error: Error & { code?: string }) => error.code === 'ephemeral_signer_input_invalid')
  requirements.close(); temporary.close()
})

test('GREEN: trailing DER and tampered key IDs fail before registry construction', () => {
  const requirements = createRequirementsSignerSession({ identity: 'requirements-der', reviewed_candidate_commit: CANDIDATE.commit, reviewed_candidate_tree: CANDIDATE.tree })
  const security = createSecurityReviewerSignerSession({ identity: 'security-der', reviewed_candidate_commit: CANDIDATE.commit, reviewed_candidate_tree: CANDIDATE.tree })
  const trailingDer = Buffer.concat([Buffer.from(security.public_entry.public_key_der_base64, 'base64'), Buffer.from([0])])
  const trailingEntry = { ...security.public_entry, public_key_der_base64: trailingDer.toString('base64'), key_id: `sha256:${sha256Bytes(trailingDer)}` }
  const tamperedEntry = { ...security.public_entry, key_id: `sha256:${'0'.repeat(64)}` }

  assert.throws(() => reviewRequest(requirements.public_entry, trailingEntry), (error: Error & { code?: string }) => error.code === 'trusted_reviewer_registry_invalid')
  assert.throws(() => reviewRequest(requirements.public_entry, tamperedEntry), (error: Error & { code?: string }) => error.code === 'trusted_reviewer_registry_invalid')
  requirements.close(); security.close()
})

test('GREEN: same key or same identity cannot occupy both reviewer roles', () => {
  const requirements = createRequirementsSignerSession({ identity: 'requirements-distinctness', reviewed_candidate_commit: CANDIDATE.commit, reviewed_candidate_tree: CANDIDATE.tree })
  const security = createSecurityReviewerSignerSession({ identity: 'security-distinctness', reviewed_candidate_commit: CANDIDATE.commit, reviewed_candidate_tree: CANDIDATE.tree })
  const sameKey = { ...security.public_entry, reviewer_identity: 'requirements-same-key', reviewer_role: 'requirements' as const }
  const sameIdentity = { ...requirements.public_entry, reviewer_identity: security.public_entry.reviewer_identity }

  assert.throws(() => reviewRequest(sameKey, security.public_entry), (error: Error & { code?: string }) => error.code === 'trusted_reviewer_registry_invalid')
  assert.throws(() => reviewRequest(sameIdentity, security.public_entry), (error: Error & { code?: string }) => error.code === 'trusted_reviewer_registry_invalid')
  requirements.close(); security.close()
})

test('GREEN: security child emits its entry before signing the controller-built request', async () => {
  const requirementsChild = spawn(process.execPath, ['--import', 'tsx', 'tools/oracle-lab/phase3b-evidence-sufficiency/requirements-signer-session-cli.ts', '--identity', 'requirements-child-readback', '--candidate-commit', CANDIDATE.commit, '--candidate-tree', CANDIDATE.tree], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] })
  const requirementsLines = readline.createInterface({ input: requirementsChild.stdout })
  const [requirementsLine] = await once(requirementsLines, 'line') as [string]
  const requirementsEvent = JSON.parse(requirementsLine) as { event: string; public_entry: TrustedReviewer }
  assert.equal(requirementsEvent.event, 'public_entry')

  const securityChild = spawn(process.execPath, ['--import', 'tsx', 'tools/oracle-lab/phase3b-evidence-sufficiency/security-reviewer-session-cli.ts', '--identity', 'security-child-readback', '--candidate-commit', CANDIDATE.commit, '--candidate-tree', CANDIDATE.tree], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] })
  const securityLines = readline.createInterface({ input: securityChild.stdout })
  const [publicLine] = await once(securityLines, 'line') as [string]
  const publicEvent = JSON.parse(publicLine) as { event: string; public_entry: TrustedReviewer }
  assert.equal(publicEvent.event, 'public_entry')
  const request = reviewRequest(requirementsEvent.public_entry, publicEvent.public_entry)
  const signedLine = once(securityLines, 'line') as Promise<[string]>
  securityChild.stdin.end(`${canonicalJson({ action: 'sign_implementation_review', ...request })}\n`)
  const [reviewLine] = await signedLine
  const reviewEvent = JSON.parse(reviewLine) as { event: string; signed_review: Record<string, unknown> }
  const [securityExitCode] = await once(securityChild, 'exit') as [number]
  const requirementsExit = once(requirementsChild, 'exit') as Promise<[number]>
  requirementsChild.stdin.end(`${canonicalJson({ action: 'close' })}\n`)
  const [requirementsExitCode] = await requirementsExit

  assert.equal(securityExitCode, 0)
  assert.equal(requirementsExitCode, 0)
  assert.equal(reviewEvent.event, 'signed_implementation_review')
  assert.equal(reviewEvent.signed_review.signing_key_id, publicEvent.public_entry.key_id)
  assert.doesNotThrow(() => verifyTrustedSignature(reviewEvent.signed_review, request.registry, 'security_quality', 'review_sha256', 'implementation_review_failed'))
})
