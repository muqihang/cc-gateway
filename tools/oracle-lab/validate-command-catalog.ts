import { readFileSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { cli, exactKeys, isObject, parseArgs, readJson, requireValid, result, type HarnessErrorRecord, type HarnessResult } from './harness-core.js'

export type CommandCatalogEntry = {
  id: string
  schema_version: 1
  group: 'phase0-green' | 'phase0-red'
  owner: string
  requirement_ids: string[]
  repository: 'cc-gateway' | 'sub2api' | 'egress-tls-sidecar'
  cwd: '${CC_GATEWAY_ROOT}' | '${SUB2API_ROOT}/backend' | '${CC_GATEWAY_ROOT}/sidecar/egress-tls-sidecar'
  argv: string[]
  env: Record<string, string>
  inherit_env: Array<'PATH' | 'HOME' | 'TMPDIR'>
  manifest_binding: { manifest_path: string; repository_head_field: string; contract_digest_field?: string }
  allowed_worktree_delta: string[]
  timeout_ms: number
  expected_exit: 0 | 'nonzero'
  output_policy: 'digest_only' | 'redacted_excerpt'
  rollback: string
}

const fields = ['id', 'schema_version', 'group', 'owner', 'requirement_ids', 'repository', 'cwd', 'argv', 'env', 'inherit_env', 'manifest_binding', 'allowed_worktree_delta', 'timeout_ms', 'expected_exit', 'output_policy', 'rollback'] as const
const bindingFields = ['manifest_path', 'repository_head_field', 'contract_digest_field'] as const
const placeholders = new Set(['CC_GATEWAY_ROOT', 'SUB2API_ROOT', 'ENTRY_MANIFEST', 'EXIT_MANIFEST'])
const cwdByRepository = new Map([
  ['cc-gateway', '${CC_GATEWAY_ROOT}'],
  ['sub2api', '${SUB2API_ROOT}/backend'],
  ['egress-tls-sidecar', '${CC_GATEWAY_ROOT}/sidecar/egress-tls-sidecar'],
])

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0)
}

function expansions(value: string): string[] {
  return [...value.matchAll(/\$\{([^}]+)\}/g)].map((match) => match[1])
}

export function validateCommandCatalogValue(value: unknown, requirementIds?: ReadonlySet<string>): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  if (!Array.isArray(value) || value.length === 0) return result([{ code: 'invalid_catalog', path: '$', message: 'catalog must be a non-empty array' }])
  const ids = new Set<string>()
  for (const [index, item] of value.entries()) {
    const base = `$[${index}]`
    if (!exactKeys(item, fields, base, errors)) continue
    if (item.schema_version !== 1) errors.push({ code: 'unsupported_schema_version', path: `${base}.schema_version`, message: 'only schema_version 1 is supported' })
    if (typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(item.id)) errors.push({ code: 'invalid_command_id', path: `${base}.id`, message: 'invalid command ID' })
    else if (ids.has(item.id)) errors.push({ code: 'duplicate_command_id', path: `${base}.id`, message: `${item.id} is duplicated` })
    else ids.add(item.id)
    if (!['phase0-green', 'phase0-red'].includes(String(item.group))) errors.push({ code: 'invalid_group', path: `${base}.group`, message: 'invalid group' })
    if (typeof item.owner !== 'string' || item.owner.trim() === '') errors.push({ code: 'invalid_owner', path: `${base}.owner`, message: 'owner is required' })
    if (!strings(item.requirement_ids) || new Set(item.requirement_ids).size !== item.requirement_ids.length) errors.push({ code: 'invalid_requirements', path: `${base}.requirement_ids`, message: 'requirement_ids must be unique strings' })
    else if (requirementIds) for (const id of item.requirement_ids) if (!requirementIds.has(id)) errors.push({ code: 'unknown_requirement', path: `${base}.requirement_ids`, message: `${id} is unknown` })
    if (!cwdByRepository.has(String(item.repository))) errors.push({ code: 'invalid_repository', path: `${base}.repository`, message: 'invalid repository' })
    else if (item.cwd !== cwdByRepository.get(String(item.repository))) errors.push({ code: 'invalid_cwd', path: `${base}.cwd`, message: 'cwd does not match repository' })
    if (!strings(item.argv)) errors.push({ code: 'shell_string_command', path: `${base}.argv`, message: 'argv must be a non-empty string array' })
    else {
      if (['sh', 'bash', 'zsh', 'cmd', 'powershell', 'pwsh'].includes(item.argv[0]) || item.argv.some((arg, i) => i > 0 && ['-c', '/c'].includes(arg.toLowerCase()))) errors.push({ code: 'shell_string_command', path: `${base}.argv`, message: 'shell wrappers are forbidden' })
      for (const argument of item.argv) for (const name of expansions(argument)) if (!placeholders.has(name)) errors.push({ code: 'undeclared_expansion', path: `${base}.argv`, message: `${name} is not an allowed expansion` })
    }
    if (!isObject(item.env) || Object.entries(item.env).some(([key, val]) => !/^[A-Z_][A-Z0-9_]*$/.test(key) || typeof val !== 'string')) errors.push({ code: 'invalid_env', path: `${base}.env`, message: 'env must contain fixed string values' })
    else for (const val of Object.values(item.env)) for (const name of expansions(val)) if (!placeholders.has(name)) errors.push({ code: 'undeclared_expansion', path: `${base}.env`, message: `${name} is not an allowed expansion` })
    if (!Array.isArray(item.inherit_env) || item.inherit_env.some((name) => !['PATH', 'HOME', 'TMPDIR'].includes(String(name))) || new Set(item.inherit_env).size !== item.inherit_env.length) errors.push({ code: 'invalid_inherit_env', path: `${base}.inherit_env`, message: 'only PATH, HOME, and TMPDIR may be inherited' })
    if (exactKeys(item.manifest_binding, bindingFields.filter((key) => key !== 'contract_digest_field' || isObject(item.manifest_binding) && key in item.manifest_binding), `${base}.manifest_binding`, errors)) {
      if (item.manifest_binding.manifest_path !== '${ENTRY_MANIFEST}' && item.manifest_binding.manifest_path !== '${EXIT_MANIFEST}') errors.push({ code: 'invalid_manifest_binding', path: `${base}.manifest_binding.manifest_path`, message: 'manifest_path must be exactly ENTRY_MANIFEST or EXIT_MANIFEST' })
      const expectedHead = item.repository === 'sub2api' ? 'repositories.sub2api.head' : 'repositories.cc_gateway.head'
      if (item.manifest_binding.repository_head_field !== expectedHead) errors.push({ code: 'invalid_manifest_binding', path: `${base}.manifest_binding.repository_head_field`, message: 'head field does not match repository' })
      if (item.repository === 'sub2api' && item.manifest_binding.contract_digest_field !== 'contract.sha256') errors.push({ code: 'invalid_manifest_binding', path: `${base}.manifest_binding.contract_digest_field`, message: 'Sub2API requires contract.sha256' })
      if (item.repository !== 'sub2api' && 'contract_digest_field' in item.manifest_binding) errors.push({ code: 'invalid_manifest_binding', path: `${base}.manifest_binding.contract_digest_field`, message: 'contract digest is only valid for Sub2API' })
    }
    if (!strings(item.allowed_worktree_delta) && !(Array.isArray(item.allowed_worktree_delta) && item.allowed_worktree_delta.length === 0)) errors.push({ code: 'invalid_worktree_delta', path: `${base}.allowed_worktree_delta`, message: 'allowed_worktree_delta must be a string array' })
    else if ((item.allowed_worktree_delta as string[]).some((entry) => entry !== 'docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json')) errors.push({ code: 'invalid_worktree_delta', path: `${base}.allowed_worktree_delta`, message: 'only the generated exit baseline may be allowed' })
    if (!Number.isInteger(item.timeout_ms) || Number(item.timeout_ms) < 1 || Number(item.timeout_ms) > 3_600_000) errors.push({ code: 'invalid_timeout', path: `${base}.timeout_ms`, message: 'invalid timeout' })
    if (item.expected_exit !== 0 && item.expected_exit !== 'nonzero') errors.push({ code: 'invalid_expected_exit', path: `${base}.expected_exit`, message: 'expected_exit must be 0 or nonzero' })
    if (item.group === 'phase0-green' && item.expected_exit !== 0 || item.group === 'phase0-red' && item.expected_exit !== 'nonzero') errors.push({ code: 'invalid_expected_exit', path: `${base}.expected_exit`, message: 'expected_exit conflicts with group' })
    if (!['digest_only', 'redacted_excerpt'].includes(String(item.output_policy))) errors.push({ code: 'invalid_output_policy', path: `${base}.output_policy`, message: 'invalid output policy' })
    if (typeof item.rollback !== 'string' || item.rollback.trim() === '') errors.push({ code: 'invalid_rollback', path: `${base}.rollback`, message: 'rollback is required' })
  }
  return result(errors)
}

export function validateCommandCatalog(file: string, requirementsFile?: string): HarnessResult {
  let requirements: ReadonlySet<string> | undefined
  if (requirementsFile) {
    const parsed = readJson(requirementsFile)
    requirements = new Set(Array.isArray(parsed) ? parsed.map((entry) => isObject(entry) ? entry.requirement_id : undefined).filter((id): id is string => typeof id === 'string') : [])
  }
  try { return validateCommandCatalogValue(readJson(file), requirements) }
  catch (error) { return result([{ code: 'invalid_catalog', path: '$', message: (error as Error).message }]) }
}

if (realpathSync(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) cli(() => {
  const args = parseArgs(process.argv.slice(2))
  const catalog = args.values.catalog?.[0]
  if (!catalog) throw Object.assign(new Error('--catalog is required'), { code: 'invalid_arguments' })
  requireValid(validateCommandCatalog(catalog, args.values.registry?.[0]))
  console.log(JSON.stringify({ valid: true, entries: (JSON.parse(readFileSync(catalog, 'utf8')) as unknown[]).length }))
})
