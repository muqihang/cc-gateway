import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import { chmodSync, mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { bindMaterializedCrossRepoAuthority } from '../tools/oracle-lab/phase3b-evidence-sufficiency/authority-materializer.js'
import { canonicalBytes, canonicalJson, sha256Bytes, sha256Canonical } from '../tools/oracle-lab/phase3b-evidence-sufficiency/core.js'
import { CROSS_REPO_AUTHORITY } from '../tools/oracle-lab/phase3b-evidence-sufficiency/ledger.js'
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
  return { ...unsigned, signature, review_sha256: sha256Canonical(unsigned) }
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
  const record = { schema_id: 'oracle.cross_repo_record', review: { cross: { critical: 0, important: 0, verdict: 'CROSS_REPO_PASS' } } }
  const raw = Buffer.from(`${canonicalJson(record)}\n`, 'utf8')
  assert.deepEqual(bindMaterializedCrossRepoAuthority(raw), { verdict: 'CROSS_REPO_PASS', review_sha256: sha256Bytes(raw) })
})
