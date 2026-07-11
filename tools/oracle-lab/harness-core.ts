import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export type HarnessErrorRecord = { code: string; path: string; message: string }
export type HarnessResult = { ok: true; errors: [] } | { ok: false; errors: HarnessErrorRecord[] }

export const DIGEST_RE = /^sha256:[0-9a-f]{64}$/
export const COMMIT_RE = /^[0-9a-f]{40,64}$/
export const ARTIFACT_METADATA = {
  compatibility_policy: 'phase_0_additive_only_breaking_requires_new_version_and_migration_test',
  retention_class: 'phase_evidence_permanent',
  redaction_policy: 'digests_and_safe_redacted_excerpts_only',
  destruction_procedure: 'git_revert_artifact_commit_after_security_approval',
} as const

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function exactKeys(value: unknown, expected: readonly string[], where: string, errors: HarnessErrorRecord[]): value is Record<string, unknown> {
  if (!isObject(value)) {
    errors.push({ code: 'invalid_object', path: where, message: 'expected an object' })
    return false
  }
  const expectedSet = new Set(expected)
  for (const key of expected) if (!(key in value)) errors.push({ code: 'missing_field', path: `${where}.${key}`, message: `${key} is required` })
  for (const key of Object.keys(value)) if (!expectedSet.has(key)) errors.push({ code: 'unknown_field', path: `${where}.${key}`, message: `${key} is not allowed` })
  return true
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (!isObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]))
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sorted(value))
}

export function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

export function digestValue(value: unknown): string {
  return sha256(canonicalJson(value))
}

export function digestFile(file: string): string {
  return sha256(readFileSync(file))
}

export function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8')) as unknown
}

export function writeJson(file: string, value: unknown): void {
  assertSafeArtifact(value)
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

const UNSAFE_ARTIFACT = /(?:ORACLE[_-]?SECRET[_-]?CANARY|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{8,}|\bBearer\s+[A-Za-z0-9._~+\/-]{4,}|\b(?:Cookie|Set-Cookie|Authorization)\s*:|\b(?:TOKEN|SECRET|API_KEY)\s*[:=]\s*[^\s"']+|https?:\/\/[^\s/]+@|(?:^|[\s"'])(?:\/Users\/|\/home\/|\/private\/|\/tmp\/|\/var\/folders\/|[A-Za-z]:\\Users\\))/i

export function assertSafeArtifact(value: unknown): void {
  if (UNSAFE_ARTIFACT.test(JSON.stringify(value))) throw Object.assign(new Error('unsafe content in safe artifact'), { code: 'unsafe_artifact' })
}

export function parseArgs(argv: string[]): { values: Record<string, string[]>; positionals: string[] } {
  const values: Record<string, string[]> = {}
  const positionals: string[] = []
  const args = argv[0] === '--' ? argv.slice(1) : argv
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (!token.startsWith('--')) { positionals.push(token); continue }
    const name = token.slice(2)
    const next = args[i + 1]
    if (!next || next.startsWith('--')) throw Object.assign(new Error(`--${name} requires a value`), { code: 'invalid_arguments' })
    ;(values[name] ??= []).push(next)
    i += 1
  }
  return { values, positionals }
}

export function one(args: ReturnType<typeof parseArgs>, name: string, required = true): string | undefined {
  const values = args.values[name]
  if ((!values || values.length !== 1) && required) throw Object.assign(new Error(`--${name} is required exactly once`), { code: 'invalid_arguments' })
  if (values && values.length > 1) throw Object.assign(new Error(`--${name} may appear only once`), { code: 'invalid_arguments' })
  return values?.[0]
}

export function cli(main: () => void): void {
  try { main() }
  catch (error) {
    const typed = error as Error & { code?: string }
    console.error(JSON.stringify({ code: typed.code ?? 'harness_error', message: typed.message }))
    process.exitCode = 1
  }
}

export function result(errors: HarnessErrorRecord[]): HarnessResult {
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors }
}

export function requireValid(validation: HarnessResult): void {
  if (!validation.ok) throw Object.assign(new Error(JSON.stringify(validation.errors)), { code: validation.errors[0]?.code ?? 'validation_failed' })
}

export function assertEvidencePath(file: string, root = path.resolve('docs/superpowers/evidence')): void {
  const resolved = path.resolve(file)
  const relative = path.relative(root, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative === '') {
    throw Object.assign(new Error(`${file} is outside the evidence root`), { code: 'artifact_path_escape' })
  }
}

export function getField(value: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((current, key) => isObject(current) ? current[key] : undefined, value)
}

export function schemaMetadata(title: string): Record<string, unknown> {
  return { title, ...ARTIFACT_METADATA }
}

export function stableDigest(value: Record<string, unknown>, volatile: readonly string[]): string {
  const stable = Object.fromEntries(Object.entries(value).filter(([key]) => !volatile.includes(key)))
  return digestValue(stable)
}
