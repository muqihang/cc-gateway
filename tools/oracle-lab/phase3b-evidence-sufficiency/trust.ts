import { execFileSync, spawnSync } from 'node:child_process'
import { createPublicKey, verify } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  attestation_commit: string
  attestation_tree: string
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
const GITHUB_WEB_FLOW_KEY_SOURCE_SHA256 = GITHUB_WEB_FLOW_PUBLIC_KEY_SHA256
const GITHUB_WEB_FLOW_KEYBOX_SHA256 = 'a0156a662b741340e0e9d2345abaf7a6d7768dec3924e0d58adc8141b626dbd1'
const GITHUB_WEB_FLOW_WRAPPER_SHA256 = '932185b087e72afbdde31b14e5e5a3906a8b386495b3c6c4688076baf152225d'
const GITHUB_GPG_EXECUTABLE = '/opt/homebrew/Cellar/gnupg/2.5.18/bin/gpg'
const GITHUB_GPG_EXECUTABLE_SHA256 = '324a16d99e84c7931dddd8b465b03a16af3ae2fa5f101d3e9961cc7667e4fe8e'
const TRUST_ROOT = path.dirname(fileURLToPath(import.meta.url))

export function verifyGithubWebFlowCommit(repository: string, commit: string): void {
  if (!path.isAbsolute(repository) || !OID.test(commit)) throw new Phase3BProductionError('github_approval_signature_invalid', 'GitHub approval repository or commit is invalid')
  const source = stableRead(path.join(TRUST_ROOT, 'github-web-flow.gpg'), { mode: 0o644, maximumBytes: 4096 })
  const keybox = stableRead(path.join(TRUST_ROOT, 'github-web-flow-gnupg/pubring.kbx'), { mode: 0o644, maximumBytes: 8192 })
  const wrapper = stableRead(path.join(TRUST_ROOT, 'github-web-flow-gpgv'), { mode: 0o755, maximumBytes: 4096 })
  const gpg = stableRead(GITHUB_GPG_EXECUTABLE, { mode: 0o555, maximumBytes: 8_388_608 })
  if (source.identity.sha256 !== GITHUB_WEB_FLOW_KEY_SOURCE_SHA256 || source.identity.size !== 2483 || source.bytes.at(-1) !== 0x2d || keybox.identity.sha256 !== GITHUB_WEB_FLOW_KEYBOX_SHA256 || wrapper.identity.sha256 !== GITHUB_WEB_FLOW_WRAPPER_SHA256 || gpg.identity.sha256 !== GITHUB_GPG_EXECUTABLE_SHA256) throw new Phase3BProductionError('github_approval_signature_invalid', 'fixed GitHub web-flow key or verifier identity drifted')
  const result = spawnSync('/usr/bin/git', ['-C', repository, '-c', `gpg.program=${wrapper.identity.path}`, 'verify-commit', '--raw', commit], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1_048_576, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0' } })
  const status = `${result.stdout}${result.stderr}`
  if (result.status !== 0 || result.error || !status.includes(`[GNUPG:] VALIDSIG ${GITHUB_WEB_FLOW_FINGERPRINT} `) || !status.includes('[GNUPG:] GOODSIG B5690EEEBB952194 GitHub <noreply@github.com>')) throw new Phase3BProductionError('github_approval_signature_invalid', 'approval merge is not signed by the fixed GitHub web-flow key')
}

function git(repository: string, args: readonly string[]): string {
  try {
    return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', timeout: 10_000 }).trim()
  } catch {
    throw new Phase3BProductionError('approval_commit_invalid', 'approval Git identity cannot be read')
  }
}

function gitBytes(repository: string, args: readonly string[], maximumBytes: number): Buffer {
  try {
    return execFileSync('/usr/bin/git', ['-C', repository, ...args], { encoding: 'buffer', timeout: 10_000, maxBuffer: maximumBytes })
  } catch { throw new Phase3BProductionError('approval_commit_invalid', 'approval Git blob cannot be read') }
}

function canonicalRepositoryRecord(repository: string, commit: string, relative: string, maximumBytes = 1_048_576): { value: Record<string, unknown>; sha256: string } {
  const bytes = gitBytes(repository, ['cat-file', 'blob', `${commit}:${relative}`], maximumBytes)
  if (bytes.length > maximumBytes) throw new Phase3BProductionError('approval_commit_invalid', `${relative} exceeds its fixed blob boundary`)
  if (bytes.at(-1) !== 0x0a) throw new Phase3BProductionError('approval_commit_invalid', `${relative} must be canonical JSON plus LF`)
  let value: unknown
  try { value = JSON.parse(bytes.subarray(0, -1).toString('utf8')) } catch { throw new Phase3BProductionError('approval_commit_invalid', `${relative} is invalid JSON`) }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !canonicalBytes(value).equals(bytes.subarray(0, -1))) throw new Phase3BProductionError('approval_commit_invalid', `${relative} is not canonical JSON`)
  return { value: value as Record<string, unknown>, sha256: sha256Bytes(bytes) }
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
      const publicKey = createPublicKey({ key: der, format: 'der', type: 'spki' })
      const canonicalDer = publicKey.export({ format: 'der', type: 'spki' })
      if (der.toString('base64') !== reviewer.public_key_der_base64 || publicKey.asymmetricKeyType !== 'ed25519' || !Buffer.from(canonicalDer).equals(der)) throw new Error('invalid key')
    } catch { throw new Phase3BProductionError('trusted_reviewer_registry_invalid', 'campaign reviewer key is not canonical Ed25519 SPKI') }
    if (reviewer.key_id !== `sha256:${sha256Bytes(der)}` || roles.has(String(reviewer.reviewer_role)) || identities.has(reviewer.reviewer_identity) || keyIds.has(reviewer.key_id) || publicKeys.has(reviewer.public_key_der_base64)) throw new Phase3BProductionError('trusted_reviewer_registry_invalid', 'reviewer role, identity, key ID, and SPKI must be pairwise independent')
    roles.add(String(reviewer.reviewer_role)); identities.add(reviewer.reviewer_identity); keyIds.add(reviewer.key_id); publicKeys.add(reviewer.public_key_der_base64)
  }
  if (value.reviewers[0]?.reviewer_role !== 'requirements' || value.reviewers[1]?.reviewer_role !== 'security_quality' || !roles.has('requirements') || !roles.has('security_quality')) throw new Phase3BProductionError('trusted_reviewer_registry_invalid', 'reviewer roles must use fixed deterministic order')
  return deepFreeze(value as TrustedReviewerRegistry)
}

export function validateAttestationCommit(repository: string, attestationCommit: string, reviewedCandidateCommit: string, reviewedCandidateTree: string): Omit<ApprovalAttestation, 'approval_commit' | 'approval_tree'> {
  if (!path.isAbsolute(repository) || !OID.test(attestationCommit) || !OID.test(reviewedCandidateCommit) || !OID.test(reviewedCandidateTree)) throw new Phase3BProductionError('approval_commit_invalid', 'approval repository, attestation, or candidate identity is invalid')
  const attestationTree = git(repository, ['rev-parse', `${attestationCommit}^{tree}`])
  const parents = git(repository, ['show', '-s', '--format=%P', attestationCommit]).split(' ').filter(Boolean)
  if (!OID.test(attestationTree) || parents.length !== 1 || parents[0] !== reviewedCandidateCommit || git(repository, ['rev-parse', `${reviewedCandidateCommit}^{tree}`]) !== reviewedCandidateTree) throw new Phase3BProductionError('approval_commit_invalid', 'attestation must be a single-parent child of the exact reviewed candidate')
  const changed = git(repository, ['diff-tree', '--no-commit-id', '--name-only', '-r', attestationCommit]).split('\n').filter(Boolean).sort(utf8Compare)
  if (sha256Canonical(changed) !== sha256Canonical(APPROVAL_ATTESTATION_PATHS)) throw new Phase3BProductionError('approval_commit_invalid', 'approval commit must change only the fixed registry and implementation review paths')
  for (const relative of APPROVAL_ATTESTATION_PATHS) {
    const entry = git(repository, ['ls-tree', attestationCommit, '--', relative]).split(/\s+/)
    if (entry.length < 4 || entry[0] !== '100644' || entry[1] !== 'blob' || entry[3] !== relative) throw new Phase3BProductionError('approval_commit_invalid', 'approval artifacts must be ordinary non-executable Git blobs')
  }
  const registryRecord = canonicalRepositoryRecord(repository, attestationCommit, CAMPAIGN_REVIEWER_REGISTRY_RELATIVE, 32_768)
  const registry = validateCampaignReviewerRegistry(registryRecord.value)
  if (registry.reviewed_candidate_commit !== reviewedCandidateCommit || registry.reviewed_candidate_tree !== reviewedCandidateTree) throw new Phase3BProductionError('trusted_reviewer_registry_invalid', 'campaign registry does not bind the exact reviewed candidate')
  const reviewRecord = canonicalRepositoryRecord(repository, attestationCommit, IMPLEMENTATION_REVIEW_RELATIVE)
  assertDigestField(reviewRecord.value, 'review_sha256', 'implementation_review_failed')
  verifyTrustedSignature(reviewRecord.value, registry, 'security_quality', 'review_sha256', 'implementation_review_failed')
  return deepFreeze({ attestation_commit: attestationCommit, attestation_tree: attestationTree, reviewed_candidate_commit: reviewedCandidateCommit, reviewed_candidate_tree: reviewedCandidateTree, registry, registry_sha256: registryRecord.sha256, implementation_review: reviewRecord.value, implementation_review_sha256: reviewRecord.sha256 })
}

export function validateApprovalAttestation(repository: string, reviewedCandidateCommit: string, reviewedCandidateTree: string): ApprovalAttestation {
  if (!path.isAbsolute(repository)) throw new Phase3BProductionError('approval_commit_invalid', 'approval repository is invalid')
  const approvalCommit = git(repository, ['rev-parse', 'HEAD'])
  const approvalTree = git(repository, ['rev-parse', 'HEAD^{tree}'])
  const parents = git(repository, ['show', '-s', '--format=%P', approvalCommit]).split(' ').filter(Boolean)
  if (!OID.test(approvalCommit) || !OID.test(approvalTree) || parents.length !== 2 || git(repository, ['status', '--porcelain=v1', '--untracked-files=normal']) !== '') throw new Phase3BProductionError('approval_commit_invalid', 'approval must be a clean two-parent GitHub merge')
  verifyGithubWebFlowCommit(repository, approvalCommit)
  const attestation = validateAttestationCommit(repository, parents[1], reviewedCandidateCommit, reviewedCandidateTree)
  try { git(repository, ['merge-base', '--is-ancestor', parents[0], reviewedCandidateCommit]) } catch { throw new Phase3BProductionError('approval_commit_invalid', 'approval first parent is not an ancestor of the reviewed candidate') }
  if (approvalTree !== attestation.attestation_tree) throw new Phase3BProductionError('approval_commit_invalid', 'approval merge tree must equal the reviewed attestation tree')
  return deepFreeze({ approval_commit: approvalCommit, approval_tree: approvalTree, ...attestation })
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
