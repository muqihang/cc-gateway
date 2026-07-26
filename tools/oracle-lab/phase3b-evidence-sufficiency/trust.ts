import { createPublicKey, verify } from 'node:crypto'
import path from 'node:path'

import { Phase3BProductionError, assertExactKeys, canonicalBytes, sha256Bytes } from './core.js'
import { stableRead } from './sealed-fs.js'

export const TRUSTED_REVIEWER_REGISTRY_RELATIVE = 'docs/superpowers/registry/oracle-lab-p0-1-trusted-reviewers.json'
export const TRUSTED_REVIEWER_REGISTRY_SHA256 = '8116b284cd47217f3a217af7e348bc0a555b79421179aae1ee9cd4010227d87d'

type TrustedRole = 'requirements' | 'security_quality'
type TrustedReviewer = Readonly<{
  key_id: string
  public_key_der_base64: string
  reviewer_identity: string
  reviewer_role: TrustedRole
}>
export type TrustedReviewerRegistry = Readonly<{
  schema_version: 1
  trust_model: 'ed25519_ephemeral_independent_reviewers_v1'
  reviewers: readonly TrustedReviewer[]
}>

export function loadTrustedReviewerRegistry(repository: string): TrustedReviewerRegistry {
  const file = path.join(repository, TRUSTED_REVIEWER_REGISTRY_RELATIVE)
  const { bytes, identity } = stableRead(file, { maximumBytes: 32_768 })
  if (identity.sha256 !== TRUSTED_REVIEWER_REGISTRY_SHA256 || bytes.at(-1) !== 0x0a) throw new Phase3BProductionError('trusted_reviewer_registry_invalid', 'trusted reviewer registry bytes drifted from the exact base authority')
  let value: unknown
  try { value = JSON.parse(bytes.subarray(0, -1).toString('utf8')) } catch { throw new Phase3BProductionError('trusted_reviewer_registry_invalid', 'trusted reviewer registry is invalid JSON') }
  assertExactKeys(value, ['schema_version', 'trust_model', 'reviewers'], 'trusted_reviewer_registry_invalid')
  if (value.schema_version !== 1 || value.trust_model !== 'ed25519_ephemeral_independent_reviewers_v1' || !Array.isArray(value.reviewers) || value.reviewers.length !== 2) throw new Phase3BProductionError('trusted_reviewer_registry_invalid', 'trusted reviewer registry shape drifted')
  const roles = new Set<string>()
  for (const reviewer of value.reviewers) {
    assertExactKeys(reviewer, ['key_id', 'public_key_der_base64', 'reviewer_identity', 'reviewer_role'], 'trusted_reviewer_registry_invalid')
    if (!['requirements', 'security_quality'].includes(String(reviewer.reviewer_role)) || typeof reviewer.reviewer_identity !== 'string' || !/^[A-Za-z0-9._@-]{3,128}$/.test(reviewer.reviewer_identity)) throw new Phase3BProductionError('trusted_reviewer_registry_invalid', 'trusted reviewer identity or role drifted')
    let der: Buffer
    try {
      der = Buffer.from(String(reviewer.public_key_der_base64), 'base64')
      if (der.toString('base64') !== reviewer.public_key_der_base64 || createPublicKey({ key: der, format: 'der', type: 'spki' }).asymmetricKeyType !== 'ed25519') throw new Error('invalid key')
    } catch { throw new Phase3BProductionError('trusted_reviewer_registry_invalid', 'trusted reviewer key is not canonical Ed25519') }
    if (reviewer.key_id !== `sha256:${sha256Bytes(der)}` || roles.has(String(reviewer.reviewer_role))) throw new Phase3BProductionError('trusted_reviewer_registry_invalid', 'trusted reviewer key ID or role uniqueness drifted')
    roles.add(String(reviewer.reviewer_role))
  }
  if (!roles.has('requirements') || !roles.has('security_quality')) throw new Phase3BProductionError('trusted_reviewer_registry_invalid', 'both independent reviewer roles are required')
  return Object.freeze(value as TrustedReviewerRegistry)
}

export function verifyTrustedSignature(value: Record<string, unknown>, registry: TrustedReviewerRegistry, role: TrustedRole, digestField: string, code: string): void {
  if (value.signature_algorithm !== 'ed25519_canonical_json_v1' || value.reviewer_role !== role || typeof value.reviewer_identity !== 'string' || typeof value.signing_key_id !== 'string' || typeof value.signature !== 'string') throw new Phase3BProductionError(code, 'signed authority metadata is incomplete')
  const reviewer = registry.reviewers.find((candidate) => candidate.reviewer_role === role)
  if (!reviewer || reviewer.reviewer_identity !== value.reviewer_identity || reviewer.key_id !== value.signing_key_id) throw new Phase3BProductionError(code, 'signed authority is not from the fixed independent reviewer')
  const unsigned = Object.fromEntries(Object.entries(value).filter(([name]) => name !== 'signature' && name !== digestField))
  const payload = Buffer.concat([canonicalBytes(unsigned), Buffer.from('\n', 'utf8')])
  let signature: Buffer
  try {
    signature = Buffer.from(value.signature, 'base64')
    if (signature.toString('base64') !== value.signature || !verify(null, payload, createPublicKey({ key: Buffer.from(reviewer.public_key_der_base64, 'base64'), format: 'der', type: 'spki' }), signature)) throw new Error('invalid signature')
  } catch { throw new Phase3BProductionError(code, 'signed authority signature is invalid') }
}
