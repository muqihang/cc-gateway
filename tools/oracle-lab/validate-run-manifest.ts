import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateClaims } from './validate-claims.js'
import { validateManifestArtifact } from './freeze-baseline.js'
import { canonicalJson, cli, COMMIT_RE, digestFile, getField, isObject, parseArgs, readJson, requireValid, result, sha256, type HarnessErrorRecord, type HarnessResult } from './harness-core.js'
import { validateCommandCatalog } from './validate-command-catalog.js'
import { validateRequirements } from './validate-requirements.js'

const REQUIREMENT_REGISTRY_PATH = 'docs/superpowers/registry/oracle-lab-requirements.json'
const CLAIM_REGISTRY_PATH = 'docs/superpowers/registry/oracle-lab-claims.json'
const TASK_9_MUTABLE_REQUIREMENT_FIELDS = new Set([
  'implementation_status', 'implementation_files', 'test_files', 'verification_command',
  'evidence_artifact', 'last_verified_commit', 'last_verified_at', 'known_gaps',
])
const PHASE_0_RED_REQUIREMENTS = new Set(['AV-B1-001', 'AV-B2-001', 'AV-B3-001', 'AV-B4-001', 'AV-B5-001', 'AV-B6-001'])

type ReviewedGovernance = { requirementBytes: Buffer; claimBytes: Buffer }

function git(root: string, args: string[], encoding?: BufferEncoding): string | Buffer {
  const stdio: ['ignore', 'pipe', 'ignore'] = ['ignore', 'pipe', 'ignore']
  return execFileSync('git', ['-C', root, ...args], encoding ? { encoding, maxBuffer: 16 * 1024 * 1024, stdio } : { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, stdio })
}

function resolveReviewedGovernance(registry: string, claims: string, head: string): ReviewedGovernance {
  if (!COMMIT_RE.test(head)) throw Object.assign(new Error('reviewed cc_gateway head is invalid'), { code: 'invalid_reviewed_head' })
  const registryFile = realpathSync(registry)
  const claimsFile = realpathSync(claims)
  const root = realpathSync(String(git(path.dirname(registryFile), ['rev-parse', '--show-toplevel'], 'utf8')).trim())
  const claimsRoot = realpathSync(String(git(path.dirname(claimsFile), ['rev-parse', '--show-toplevel'], 'utf8')).trim())
  if (root !== claimsRoot) throw Object.assign(new Error('registry and claims must belong to the same cc_gateway repository'), { code: 'wrong_governance_repository' })
  const relativeRegistry = path.relative(root, registryFile).split(path.sep).join('/')
  const relativeClaims = path.relative(root, claimsFile).split(path.sep).join('/')
  if (relativeRegistry !== REQUIREMENT_REGISTRY_PATH || relativeClaims !== CLAIM_REGISTRY_PATH) throw Object.assign(new Error('registry or claims path does not match the fixed cc_gateway governance paths'), { code: 'wrong_governance_path' })
  git(root, ['rev-parse', '--verify', `${head}^{commit}`], 'utf8')
  try { git(root, ['merge-base', '--is-ancestor', head, 'HEAD'], 'utf8') } catch {
    throw Object.assign(new Error('reviewed cc_gateway head is not an ancestor of the current repository head'), { code: 'reviewed_head_not_ancestor' })
  }
  try {
    return {
      requirementBytes: git(root, ['cat-file', 'blob', `${head}:${REQUIREMENT_REGISTRY_PATH}`]) as Buffer,
      claimBytes: git(root, ['cat-file', 'blob', `${head}:${CLAIM_REGISTRY_PATH}`]) as Buffer,
    }
  } catch {
    throw Object.assign(new Error('reviewed governance path is missing from the bound cc_gateway commit'), { code: 'missing_reviewed_governance_path' })
  }
}

function validTask9StatusTransition(id: string, before: unknown, after: unknown): boolean {
  if (PHASE_0_RED_REQUIREMENTS.has(id)) return before === 'failing_test_added' && after === 'failing_test_added'
  if (before === 'deferred') return after === 'deferred'
  if (before === 'design_only') return after === 'design_only' || after === 'locally_verified' || after === 'blocked_by_baseline'
  if (before === 'failing_test_added') return after === 'failing_test_added' || after === 'locally_verified' || after === 'blocked_by_baseline'
  if (before === 'locally_verified') return after === 'locally_verified' || after === 'blocked_by_baseline'
  return before === after
}

function validatePendingGovernance(currentRequirements: unknown, currentClaims: unknown, reviewed: ReviewedGovernance, errors: HarnessErrorRecord[]): void {
  let reviewedRequirements: unknown
  let reviewedClaims: unknown
  try {
    reviewedRequirements = JSON.parse(reviewed.requirementBytes.toString('utf8'))
    reviewedClaims = JSON.parse(reviewed.claimBytes.toString('utf8'))
  } catch {
    errors.push({ code: 'invalid_reviewed_governance', path: '$.governance', message: 'reviewed governance bytes are not valid JSON' })
    return
  }
  if (!Array.isArray(currentRequirements) || !Array.isArray(reviewedRequirements)) return
  const currentIds = currentRequirements.map((record) => isObject(record) ? record.requirement_id : undefined)
  const reviewedIds = reviewedRequirements.map((record) => isObject(record) ? record.requirement_id : undefined)
  if (canonicalJson(currentIds) !== canonicalJson(reviewedIds)) {
    errors.push({ code: 'pending_inventory_mismatch', path: '$', message: 'pending registry order and inventory must match the reviewed snapshot exactly' })
    return
  }
  for (let index = 0; index < reviewedRequirements.length; index += 1) {
    const before = reviewedRequirements[index]
    const after = currentRequirements[index]
    if (!isObject(before) || !isObject(after) || typeof before.requirement_id !== 'string') continue
    for (const key of Object.keys(before)) {
      if (!TASK_9_MUTABLE_REQUIREMENT_FIELDS.has(key) && canonicalJson(before[key]) !== canonicalJson(after[key])) {
        errors.push({ code: 'pending_registry_authority_mismatch', path: `$[${index}].${key}`, message: `${key} cannot change after the reviewed snapshot` })
      }
    }
    if (!validTask9StatusTransition(before.requirement_id, before.implementation_status, after.implementation_status)) {
      errors.push({ code: 'invalid_pending_status_transition', path: `$[${index}].implementation_status`, message: `${before.requirement_id} has an invalid Task 9 status transition` })
    }
  }
  if (canonicalJson(currentClaims) !== canonicalJson(reviewedClaims)) {
    errors.push({ code: 'pending_claim_authority_mismatch', path: '$', message: 'Task 9 cannot replace the reviewed claim authority matrix' })
  }
}

export function validateRunInputs(registry: string, claims: string, manifestFile: string, catalog: string): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  const requirementValidation = validateRequirements(registry)
  if (!requirementValidation.ok) errors.push(...requirementValidation.errors)
  const requirements = readJson(registry)
  if (Array.isArray(requirements)) {
    const claimValidation = validateClaims(claims, requirements.filter(isObject))
    if (!claimValidation.ok) errors.push(...claimValidation.errors)
  } else errors.push({ code: 'invalid_registry', path: '$', message: 'registry must be an array' })
  const catalogValidation = validateCommandCatalog(catalog, registry)
  if (!catalogValidation.ok) errors.push(...catalogValidation.errors)
  let manifest: unknown
  try { manifest = readJson(manifestFile); validateManifestArtifact(manifest) }
  catch (error) { errors.push({ code: (error as Error & { code?: string }).code ?? 'invalid_manifest', path: '$', message: (error as Error).message }) }
  if (isObject(manifest)) {
    let reviewed: ReviewedGovernance | undefined
    if (manifest.phase === 'phase_0_exit') {
      const head = getField(manifest, 'repositories.cc_gateway.head')
      try { reviewed = resolveReviewedGovernance(registry, claims, String(head ?? '')) }
      catch (error) { errors.push({ code: (error as Error & { code?: string }).code ?? 'invalid_reviewed_governance', path: '$.repositories.cc_gateway.head', message: (error as Error).message }) }
    }
    for (const [name, file, reviewedBytes] of [
      ['requirement_registry', registry, reviewed?.requirementBytes],
      ['claim_registry', claims, reviewed?.claimBytes],
    ] as const) {
      const marker = getField(manifest, `governance.${name}`)
      if (isObject(marker) && marker.status === 'present') {
        const expected = reviewedBytes ? sha256(reviewedBytes).slice(7) : manifest.phase === 'phase_0_exit' ? undefined : digestFile(file).slice(7)
        if (expected !== undefined && marker.sha256 !== expected) errors.push({ code: 'referenced_digest_mismatch', path: `$.governance.${name}.sha256`, message: `${name} digest does not match` })
      } else if (!isObject(marker) || marker.status !== 'absent_pre_governance_bootstrap') {
        errors.push({ code: 'missing_referenced_digest', path: `$.governance.${name}`, message: `${name} marker is missing` })
      }
    }
    if (reviewed) validatePendingGovernance(requirements, readJson(claims), reviewed, errors)
    const repositoryValues = getField(manifest, 'repositories')
    if (!isObject(repositoryValues)) errors.push({ code: 'missing_repository_digests', path: '$.repositories', message: 'repositories are missing' })
    else for (const name of ['cc_gateway', 'sub2api']) {
      const repository = repositoryValues[name]
      if (!isObject(repository) || typeof repository.head !== 'string' || typeof repository.dirty_digest !== 'string') errors.push({ code: 'missing_repository_digests', path: `$.repositories.${name}`, message: 'repository head and dirty digest are required' })
    }
  }
  return result(errors)
}

if (realpathSync(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) cli(() => {
  const args = parseArgs(process.argv.slice(2))
  const registry = args.values.registry?.[0]; const claims = args.values.claims?.[0]; const manifest = args.values.manifest?.[0]
  const catalog = args.values.catalog?.[0] ?? 'docs/superpowers/registry/oracle-lab-command-catalog.json'
  if (!registry || !claims || !manifest) throw Object.assign(new Error('--registry, --claims, and --manifest are required'), { code: 'invalid_arguments' })
  requireValid(validateRunInputs(registry, claims, manifest, catalog)); console.log(JSON.stringify({ valid: true }))
})
