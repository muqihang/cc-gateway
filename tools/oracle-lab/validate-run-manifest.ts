import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { validateClaims } from './validate-claims.js'
import { validateManifestArtifact } from './freeze-baseline.js'
import { cli, digestFile, getField, isObject, parseArgs, readJson, requireValid, result, type HarnessErrorRecord, type HarnessResult } from './harness-core.js'
import { validateCommandCatalog } from './validate-command-catalog.js'
import { validateRequirements } from './validate-requirements.js'

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
    for (const [name, file] of [['requirement_registry', registry], ['claim_registry', claims]] as const) {
      const marker = getField(manifest, `governance.${name}`)
      if (isObject(marker) && marker.status === 'present') {
        if (marker.sha256 !== digestFile(file).slice(7)) errors.push({ code: 'referenced_digest_mismatch', path: `$.governance.${name}.sha256`, message: `${name} digest does not match` })
      } else if (!isObject(marker) || marker.status !== 'absent_pre_governance_bootstrap') {
        errors.push({ code: 'missing_referenced_digest', path: `$.governance.${name}`, message: `${name} marker is missing` })
      }
    }
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
