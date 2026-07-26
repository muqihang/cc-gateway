import { execFileSync } from 'node:child_process'
import { createPublicKey, verify } from 'node:crypto'
import path from 'node:path'

import { Phase3BProductionError, assertDigestField, assertExactKeys, canonicalBytes, deepFreeze, sha256Bytes, sha256Canonical, utf8Compare } from './core.js'
import { stableRead } from './sealed-fs.js'

export const CAMPAIGN_REVIEWER_REGISTRY_RELATIVE = 'docs/superpowers/registry/oracle-lab-phase3b-campaign-reviewers.json'
export const IMPLEMENTATION_REVIEW_RELATIVE = 'docs/superpowers/evidence/phase3b/phase3b-implementation-review.json'
export const APPROVAL_ATTESTATION_PATHS = deepFreeze([CAMPAIGN_REVIEWER_REGISTRY_RELATIVE, IMPLEMENTATION_REVIEW_RELATIVE].sort(utf8Compare))

type TrustedRole = 'requirements' | 'security_quality'
export type TrustedReviewer = Readonly<{
  key_id: string
  public_key_der_base64: string
  reviewer_identity: string
  reviewer_role: TrustedRole
}>
export type TrustedReviewerRegistry = Readonly<{
  schema_id: 'oracle-lab-p3b-campaign-reviewers.v1'
  reviewed_candidate_commit: string
  reviewed_candidate_tree: string
  reviewers: readonly TrustedReviewer[]
  registry_sha256: string
}>

export type ApprovalAttestation = Readonly<{
  approval_commit: string
  approval_tree: string
  reviewed_candidate_commit: string
  reviewed_candidate_tree: string
  registry: TrustedReviewerRegistry
  registry_sha256: string
  implementation_review: Readonly<Record<string, unknown>>
  implementation_review_sha256: string
}>

const OID = /^[a-f0-9]{40}$/
export const GITHUB_WEB_FLOW_FINGERPRINT = '968479A1AFF927E37D1A566BB5690EEEBB952194'
export const GITHUB_WEB_FLOW_PUBLIC_KEY_SHA256 = '6e8af687f60cf3f403151c8fb1b26e95e6f9e424ca60cc8f3787bd4466a3ef84'

export function verifyGithubWebFlowCommit(_repository: string, _commit: string): void {
  throw new Phase3BProductionError('github_approval_signature_invalid', 'GitHub web-flow merge verification is not implemented')
}

function git(repository: string, args: readonly string[]): string {
  try {
    return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', timeout: 10_000 }).trim()
  } catch {
    throw new Phase3BProductionError('approval_commit_invalid', 'approval Git identity cannot be read')
  }
}

function canonicalRepositoryRecord(repository: string, relative: string, maximumBytes = 1_048_576): { value: Record<string, unknown>; sha256: string } {
  const file = path.join(repository, relative)
  const { bytes, identity } = stableRead(file, { maximumBytes })
  if (bytes.at(-1) !== 0x0a) throw new Phase3BProductionError('approval_commit_invalid', `${relative} must be canonical JSON plus LF`)
  let value: unknown
  try { value = JSON.parse(bytes.subarray(0, -1).toString('utf8')) } catch { throw new Phase3BProductionError('approval_commit_invalid', `${relative} is invalid JSON`) }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !canonicalBytes(value).equals(bytes.subarray(0, -1))) throw new Phase3BProductionError('approval_commit_invalid', `${relative} is not canonical JSON`)
  return { value: value as Record<string, unknown>, sha256: identity.sha256 }
}

export function validateCampaignReviewerRegistry(value: unknown): TrustedReviewerRegistry {
  assertExactKeys(value, ['schema_id', 'reviewed_candidate_commit', 'reviewed_candidate_tree', 'reviewers', 'registry_sha256'], 'trusted_reviewer_registry_invalid')
  assertDigestField(value, 'registry_sha256', 'trusted_reviewer_registry_invalid')
  if (value.schema_id !== 'oracle-lab-p3b-campaign-reviewers.v1' || !OID.test(String(value.reviewed_candidate_commit)) || !OID.test(String(value.reviewed_candidate_tree)) || !Array.isArray(value.reviewers) || value.reviewers.length !== 2) throw new Phase3BProductionError('trusted_reviewer_registry_invalid', 'campaign reviewer registry shape drifted')
  const roles = new Set<string>()
  const identities = new Set<string>()
  const keyIds = new Set<string>()
  const publicKeys = new Set<string>()
  for (const reviewer of value.reviewers) {
    assertExactKeys(reviewer, ['key_id', 'public_key_der_base64', 'reviewer_identity', 'reviewer_role'], 'trusted_reviewer_registry_invalid')
    if (!['requirements', 'security_quality'].includes(String(reviewer.reviewer_role)) || typeof reviewer.reviewer_identity !== 'string' || !/^[A-Za-z0-9._@-]{3,128}$/.test(reviewer.reviewer_identity)) throw new Phase3BProductionError('trusted_reviewer_registry_invalid', 'campaign reviewer identity or role drifted')
    let der: Buffer
    try {
      der = Buffer.from(String(reviewer.public_key_der_base64), 'base64')
      if (der.toString('base64') !== reviewer.public_key_der_base64 || createPublicKey({ key: der, format: 'der', type: 'spki' }).asymmetricKeyType !== 'ed25519') throw new Error('invalid key')
    } catch { throw new Phase3BProductionError('trusted_reviewer_registry_invalid', 'campaign reviewer key is not canonical Ed25519 SPKI') }
    if (reviewer.key_id !== `sha256:${sha256Bytes(der)}` || roles.has(String(reviewer.reviewer_role)) || identities.has(reviewer.reviewer_identity) || keyIds.has(reviewer.key_id) || publicKeys.has(reviewer.public_key_der_base64)) throw new Phase3BProductionError('trusted_reviewer_registry_invalid', 'reviewer role, identity, key ID, and SPKI must be pairwise independent')
    roles.add(String(reviewer.reviewer_role)); identities.add(reviewer.reviewer_identity); keyIds.add(reviewer.key_id); publicKeys.add(reviewer.public_key_der_base64)
  }
  if (value.reviewers[0]?.reviewer_role !== 'requirements' || value.reviewers[1]?.reviewer_role !== 'security_quality' || !roles.has('requirements') || !roles.has('security_quality')) throw new Phase3BProductionError('trusted_reviewer_registry_invalid', 'reviewer roles must use fixed deterministic order')
  return deepFreeze(value as TrustedReviewerRegistry)
}

export function validateApprovalAttestation(repository: string, reviewedCandidateCommit: string, reviewedCandidateTree: string): ApprovalAttestation {
  if (!path.isAbsolute(repository) || !OID.test(reviewedCandidateCommit) || !OID.test(reviewedCandidateTree)) throw new Phase3BProductionError('approval_commit_invalid', 'approval repository or candidate identity is invalid')
  const approvalCommit = git(repository, ['rev-parse', 'HEAD'])
  const approvalTree = git(repository, ['rev-parse', 'HEAD^{tree}'])
  const parents = git(repository, ['show', '-s', '--format=%P', approvalCommit]).split(' ').filter(Boolean)
  if (!OID.test(approvalCommit) || !OID.test(approvalTree) || parents.length !== 1 || parents[0] !== reviewedCandidateCommit || git(repository, ['rev-parse', `${reviewedCandidateCommit}^{tree}`]) !== reviewedCandidateTree || git(repository, ['status', '--porcelain=v1', '--untracked-files=normal']) !== '') throw new Phase3BProductionError('approval_commit_invalid', 'approval must be a clean single-parent child of the exact reviewed candidate')
  const changed = git(repository, ['diff-tree', '--no-commit-id', '--name-only', '-r', approvalCommit]).split('\n').filter(Boolean).sort(utf8Compare)
  if (sha256Canonical(changed) !== sha256Canonical(APPROVAL_ATTESTATION_PATHS)) throw new Phase3BProductionError('approval_commit_invalid', 'approval commit must change only the fixed registry and implementation review paths')
  for (const relative of APPROVAL_ATTESTATION_PATHS) {
    const entry = git(repository, ['ls-tree', approvalCommit, '--', relative]).split(/\s+/)
    if (entry.length < 4 || entry[0] !== '100644' || entry[1] !== 'blob' || entry[3] !== relative) throw new Phase3BProductionError('approval_commit_invalid', 'approval artifacts must be ordinary non-executable Git blobs')
  }
  const registryRecord = canonicalRepositoryRecord(repository, CAMPAIGN_REVIEWER_REGISTRY_RELATIVE, 32_768)
  const registry = validateCampaignReviewerRegistry(registryRecord.value)
  if (registry.reviewed_candidate_commit !== reviewedCandidateCommit || registry.reviewed_candidate_tree !== reviewedCandidateTree) throw new Phase3BProductionError('trusted_reviewer_registry_invalid', 'campaign registry does not bind the exact reviewed candidate')
  const reviewRecord = canonicalRepositoryRecord(repository, IMPLEMENTATION_REVIEW_RELATIVE)
  assertDigestField(reviewRecord.value, 'review_sha256', 'implementation_review_failed')
  verifyTrustedSignature(reviewRecord.value, registry, 'security_quality', 'review_sha256', 'implementation_review_failed')
  return deepFreeze({ approval_commit: approvalCommit, approval_tree: approvalTree, reviewed_candidate_commit: reviewedCandidateCommit, reviewed_candidate_tree: reviewedCandidateTree, registry, registry_sha256: registryRecord.sha256, implementation_review: reviewRecord.value, implementation_review_sha256: reviewRecord.sha256 })
}

export function loadTrustedReviewerRegistry(repository: string, reviewedCandidateCommit: string, reviewedCandidateTree: string): TrustedReviewerRegistry {
  return validateApprovalAttestation(repository, reviewedCandidateCommit, reviewedCandidateTree).registry
}

export function verifyTrustedSignature(value: Record<string, unknown>, registry: TrustedReviewerRegistry, role: TrustedRole, digestField: string, code: string): void {
  if (value.signature_algorithm !== 'ed25519_canonical_json_v1' || value.reviewer_role !== role || typeof value.reviewer_identity !== 'string' || typeof value.signing_key_id !== 'string' || typeof value.signature !== 'string') throw new Phase3BProductionError(code, 'signed authority metadata is incomplete')
  const reviewer = registry.reviewers.find((candidate) => candidate.reviewer_role === role)
  if (!reviewer || reviewer.reviewer_identity !== value.reviewer_identity || reviewer.key_id !== value.signing_key_id) throw new Phase3BProductionError(code, 'signed authority is not from the fixed independent campaign reviewer')
  const unsigned = Object.fromEntries(Object.entries(value).filter(([name]) => name !== 'signature' && name !== digestField))
  const payload = Buffer.concat([canonicalBytes(unsigned), Buffer.from('\n', 'utf8')])
  let signature: Buffer
  try {
    signature = Buffer.from(value.signature, 'base64')
    if (signature.length !== 64 || signature.toString('base64') !== value.signature || !verify(null, payload, createPublicKey({ key: Buffer.from(reviewer.public_key_der_base64, 'base64'), format: 'der', type: 'spki' }), signature)) throw new Error('invalid signature')
  } catch { throw new Phase3BProductionError(code, 'signed authority signature is invalid') }
}
