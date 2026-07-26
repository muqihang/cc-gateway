import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import { chmodSync, mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { bindMaterializedCrossRepoAuthority, buildEs7TypedFixtureContract, buildEs9CoverageContract } from '../tools/oracle-lab/phase3b-evidence-sufficiency/authority-materializer.js'
import { main as materializerMain } from '../tools/oracle-lab/phase3b-evidence-sufficiency/authority-materializer-cli.js'
import { validateCoverageContract, validateTypedFixtureContract } from '../tools/oracle-lab/phase3b-evidence-sufficiency/closeout.js'
import { canonicalBytes, canonicalJson, sha256Bytes, sha256Canonical } from '../tools/oracle-lab/phase3b-evidence-sufficiency/core.js'
import { CROSS_REPO_AUTHORITY } from '../tools/oracle-lab/phase3b-evidence-sufficiency/ledger.js'
import { buildCampaignLedger, crossRepoAuthority } from '../tools/oracle-lab/phase3b-evidence-sufficiency/ledger.js'
import { signEphemeralRecord, signImplementationReviewEphemeral, signOperatorAuthorityEphemeral } from '../tools/oracle-lab/phase3b-evidence-sufficiency/ephemeral-signer.js'
import { validateApprovalAttestation, validateCampaignReviewerRegistry, verifyTrustedSignature, type TrustedReviewer } from '../tools/oracle-lab/phase3b-evidence-sufficiency/trust.js'

const REGISTRY_PATH = 'docs/superpowers/registry/oracle-lab-phase3b-campaign-reviewers.json'
const REVIEW_PATH = 'docs/superpowers/evidence/phase3b/phase3b-implementation-review.json'

function git(repository: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).trim()
}

function reviewer(role: TrustedReviewer['reviewer_role'], identity: string): { entry: TrustedReviewer; privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'] } {
  const pair = generateKeyPairSync('ed25519')
  const der = pair.publicKey.export({ format: 'der', type: 'spki' })
  return {
    entry: { key_id: `sha256:${sha256Bytes(der)}`, public_key_der_base64: der.toString('base64'), reviewer_identity: identity, reviewer_role: role },
    privateKey: pair.privateKey,
  }
}

function signedReview(candidate: { commit: string; tree: string }, security: ReturnType<typeof reviewer>): Record<string, unknown> {
  const unsigned = {
    schema_id: 'oracle-lab-p3b-implementation-review.v3', review_kind: 'phase3b-production-executor',
    reviewed_candidate_commit: candidate.commit, reviewed_candidate_tree: candidate.tree,
    reviewed_artifact_set_sha256: 'a'.repeat(64), cross_repo_review_sha256: 'b'.repeat(64),
    critical: 0, important: 0, verdict: 'PASS', created_at_ms: 1, expires_at_ms: 2,
    reviewer_identity: security.entry.reviewer_identity, reviewer_role: security.entry.reviewer_role,
    signing_key_id: security.entry.key_id, signature_algorithm: 'ed25519_canonical_json_v1',
  }
  const signature = sign(null, Buffer.concat([canonicalBytes(unsigned), Buffer.from('\n')]), security.privateKey).toString('base64')
  const signed = { ...unsigned, signature }
  return { ...signed, review_sha256: sha256Canonical(signed) }
}

function approvalFixture(extraPath = false): { repository: string; candidate: { commit: string; tree: string }; requirements: ReturnType<typeof reviewer>; security: ReturnType<typeof reviewer> } {
  const repository = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'p3b-approval-red-')))
  chmodSync(repository, 0o700)
  git(repository, ['init', '-q'])
  writeFileSync(path.join(repository, 'candidate.txt'), 'candidate\n', 'utf8')
  git(repository, ['add', 'candidate.txt'])
  execFileSync('git', ['-C', repository, '-c', 'user.name=Phase3B', '-c', 'user.email=phase3b@example.invalid', 'commit', '-q', '-m', 'candidate'])
  const candidate = { commit: git(repository, ['rev-parse', 'HEAD']), tree: git(repository, ['rev-parse', 'HEAD^{tree}']) }
  const requirements = reviewer('requirements', 'requirements-independent')
  const security = reviewer('security_quality', 'security-independent')
  const registryUnsigned = { schema_id: 'oracle-lab-p3b-campaign-reviewers.v1', reviewed_candidate_commit: candidate.commit, reviewed_candidate_tree: candidate.tree, reviewers: [requirements.entry, security.entry] }
  const registry = { ...registryUnsigned, registry_sha256: sha256Canonical(registryUnsigned) }
  const review = signedReview(candidate, security)
  mkdirSync(path.join(repository, path.dirname(REGISTRY_PATH)), { recursive: true })
  mkdirSync(path.join(repository, path.dirname(REVIEW_PATH)), { recursive: true })
  writeFileSync(path.join(repository, REGISTRY_PATH), `${canonicalJson(registry)}\n`, 'utf8')
  writeFileSync(path.join(repository, REVIEW_PATH), `${canonicalJson(review)}\n`, 'utf8')
  if (extraPath) writeFileSync(path.join(repository, 'extra.txt'), 'not allowed\n', 'utf8')
  git(repository, ['add', '.'])
  execFileSync('git', ['-C', repository, '-c', 'user.name=Phase3B', '-c', 'user.email=phase3b@example.invalid', 'commit', '-q', '-m', 'approval'])
  return { repository, candidate, requirements, security }
}

test('authority RED: exact candidate parent and two-path approval commit validate', () => {
  const fixture = approvalFixture()
  const approval = validateApprovalAttestation(fixture.repository, fixture.candidate.commit, fixture.candidate.tree)
  assert.equal(approval.reviewed_candidate_commit, fixture.candidate.commit)
  assert.equal(approval.registry.reviewers.length, 2)
})

test('authority RED: wrong parent and extra approval paths fail closed', () => {
  const extra = approvalFixture(true)
  assert.throws(() => validateApprovalAttestation(extra.repository, extra.candidate.commit, extra.candidate.tree), (error: Error & { code?: string }) => error.code === 'approval_commit_invalid')
  const wrong = approvalFixture()
  assert.throws(() => validateApprovalAttestation(wrong.repository, 'f'.repeat(40), wrong.candidate.tree), (error: Error & { code?: string }) => error.code === 'approval_commit_invalid')
})

test('authority RED: registry rejects same identity, same key, and caller replacement', () => {
  const fixture = approvalFixture()
  const valid = validateApprovalAttestation(fixture.repository, fixture.candidate.commit, fixture.candidate.tree).registry
  const [requirements, security] = valid.reviewers
  for (const reviewers of [
    [requirements, { ...security, reviewer_identity: requirements.reviewer_identity }],
    [requirements, { ...security, key_id: requirements.key_id, public_key_der_base64: requirements.public_key_der_base64 }],
  ]) {
    const unsigned = { schema_id: 'oracle-lab-p3b-campaign-reviewers.v1', reviewed_candidate_commit: fixture.candidate.commit, reviewed_candidate_tree: fixture.candidate.tree, reviewers }
    assert.throws(() => validateCampaignReviewerRegistry({ ...unsigned, registry_sha256: sha256Canonical(unsigned) }), (error: Error & { code?: string }) => error.code === 'trusted_reviewer_registry_invalid')
  }
  writeFileSync(path.join(fixture.repository, REGISTRY_PATH), `${canonicalJson({ ...valid, registry_sha256: 'f'.repeat(64) })}\n`, 'utf8')
  assert.throws(() => validateApprovalAttestation(fixture.repository, fixture.candidate.commit, fixture.candidate.tree), (error: Error & { code?: string }) => error.code === 'approval_commit_invalid')
})

test('authority RED: unsigned and tampered review signatures cannot pass', () => {
  const fixture = approvalFixture()
  const approval = validateApprovalAttestation(fixture.repository, fixture.candidate.commit, fixture.candidate.tree)
  assert.doesNotThrow(() => verifyTrustedSignature(approval.implementation_review as Record<string, unknown>, approval.registry, 'security_quality', 'review_sha256', 'implementation_review_failed'))
  assert.throws(() => verifyTrustedSignature({ ...approval.implementation_review, critical: 1 }, approval.registry, 'security_quality', 'review_sha256', 'implementation_review_failed'), (error: Error & { code?: string }) => error.code === 'implementation_review_failed')
  assert.throws(() => verifyTrustedSignature({ ...approval.implementation_review, signature: '' }, approval.registry, 'security_quality', 'review_sha256', 'implementation_review_failed'), (error: Error & { code?: string }) => error.code === 'implementation_review_failed')
})

test('authority RED: C1 authority is derived from actual canonical raw bytes, never the lost digest', () => {
  assert.deepEqual(CROSS_REPO_AUTHORITY, { verdict: 'CROSS_REPO_PASS' })
  const record = { schema_id: 'oracle.cross_repo_record', review: { cross: { task_id: 'fresh-c1-review', model: 'gpt-5.6-sol', artifact_sha256: 'd'.repeat(64), critical: 0, important: 0, verdict: 'CROSS_REPO_PASS' } } }
  const raw = Buffer.from(`${canonicalJson(record)}\n`, 'utf8')
  assert.deepEqual(bindMaterializedCrossRepoAuthority(raw), { verdict: 'CROSS_REPO_PASS', review_sha256: sha256Bytes(raw) })
})

test('authority GREEN: materialized ES7 and ES9 contracts bind the dynamic C1 ledger', () => {
  const c1 = sha256Bytes(Buffer.from('fresh-c1'))
  const ledger = buildCampaignLedger('p3b-materializer-contracts', crossRepoAuthority(c1))
  assert.doesNotThrow(() => validateTypedFixtureContract(buildEs7TypedFixtureContract(ledger.campaign_id, c1) as Record<string, unknown>, ledger))
  assert.doesNotThrow(() => validateCoverageContract(buildEs9CoverageContract() as Record<string, unknown>, ledger))
})

test('authority GREEN: materializer CLI rejects caller-selected flags before side effects', () => {
  assert.throws(() => materializerMain([]), (error: Error & { code?: string }) => error.code === 'authority_materializer_cli_invalid')
  assert.throws(() => materializerMain(['--input', 'relative.json']), (error: Error & { code?: string }) => error.code === 'authority_materializer_cli_invalid')
})

test('authority GREEN: ephemeral signer returns only public material and distinct role keys', () => {
  const security = signEphemeralRecord({ role: 'security_quality', identity: 'security-fresh-context', digest_field: 'review_sha256', payload: { schema_id: 'review.v1', verdict: 'PASS' } })
  const requirements = signEphemeralRecord({ role: 'requirements', identity: 'requirements-fresh-context', digest_field: 'authority_sha256', payload: { schema_id: 'authority.v1', decision: 'authorize' } })
  assert.notEqual(security.public_entry.key_id, requirements.public_entry.key_id)
  assert.notEqual(security.public_entry.reviewer_identity, requirements.public_entry.reviewer_identity)
  assert.equal(JSON.stringify([security, requirements]).includes('private'), false)
  const registryUnsigned = { schema_id: 'oracle-lab-p3b-campaign-reviewers.v1', reviewed_candidate_commit: 'a'.repeat(40), reviewed_candidate_tree: 'b'.repeat(40), reviewers: [requirements.public_entry, security.public_entry] }
  const registry = validateCampaignReviewerRegistry({ ...registryUnsigned, registry_sha256: sha256Canonical(registryUnsigned) })
  assert.doesNotThrow(() => verifyTrustedSignature(security.signed_record as Record<string, unknown>, registry, 'security_quality', 'review_sha256', 'implementation_review_failed'))
  assert.doesNotThrow(() => verifyTrustedSignature(requirements.signed_record as Record<string, unknown>, registry, 'requirements', 'authority_sha256', 'operator_authority_invalid'))
})

test('authority GREEN: independent in-memory signers bind exact input, review, registry, and reject tampering', () => {
  const digestFields = ['cross_repo_review_sha256', 'probe_source_sha256', 'probe_unsigned_source_sha256', 'original_recipe_sha256', 'probe_recipe_sha256', 'source_tree_sha256', 'toolchain_sha256', 'schema_bundle_sha256', 'focused_suite_sha256', 'es7_typed_fixtures_sha256', 'es8_go_receipt_sha256', 'es8_ts_c1_agreement_sha256', 'es9_coverage_contract_sha256']
  const inputUnsigned: Record<string, unknown> = { schema_id: 'oracle-lab-p3b-production-input.v2', campaign_id: 'p3b-signer-test', cc_repository: '/tmp/cc' }
  digestFields.forEach((field, index) => { inputUnsigned[field] = index.toString(16).padStart(64, '0') })
  const campaignInput = { ...inputUnsigned, input_sha256: sha256Canonical(inputUnsigned) }
  const candidate = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) }
  const security = signImplementationReviewEphemeral({ identity: 'security-isolated-context', campaign_input: campaignInput, reviewed_candidate_commit: candidate.commit, reviewed_candidate_tree: candidate.tree, created_at_ms: 10, expires_at_ms: 20 })
  const requirements = signOperatorAuthorityEphemeral({ identity: 'requirements-isolated-context', campaign_input: campaignInput, reviewed_candidate_commit: candidate.commit, reviewed_candidate_tree: candidate.tree, security_public_entry: security.public_entry, signed_implementation_review: security.signed_record, created_at_ms: 11, expires_at_ms: 21 })
  assert.notEqual(requirements.public_entry.key_id, security.public_entry.key_id)
  assert.doesNotThrow(() => verifyTrustedSignature(security.signed_record as Record<string, unknown>, requirements.registry, 'security_quality', 'review_sha256', 'implementation_review_failed'))
  assert.doesNotThrow(() => verifyTrustedSignature(requirements.signed_authority as Record<string, unknown>, requirements.registry, 'requirements', 'authority_sha256', 'operator_authority_invalid'))
  assert.throws(() => signOperatorAuthorityEphemeral({ identity: 'requirements-isolated-context-2', campaign_input: campaignInput, reviewed_candidate_commit: candidate.commit, reviewed_candidate_tree: candidate.tree, security_public_entry: security.public_entry, signed_implementation_review: { ...security.signed_record, reviewed_candidate_tree: 'c'.repeat(40) }, created_at_ms: 11, expires_at_ms: 21 }), (error: Error & { code?: string }) => error.code === 'ephemeral_signer_input_invalid' || error.code === 'implementation_review_failed')
})
