import { spawnSync } from 'node:child_process'
import { lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'

const UNSAFE_STARTUP_VARIABLES = Object.freeze([
  'NODE_OPTIONS',
  ['NODE', 'PATH'].join('_'),
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_REPLACE_REF_BASE',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_GLOBAL',
])

const REVIEWED_TOOL_CANDIDATES = Object.freeze({
  node: Object.freeze(['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']),
  git: Object.freeze(['/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git']),
  codegraph: Object.freeze(['/opt/homebrew/bin/codegraph', '/usr/local/bin/codegraph']),
})

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

function reviewedExecutable(name: keyof typeof REVIEWED_TOOL_CANDIDATES, selected?: string): string {
  const allowed = new Set<string>()
  for (const candidate of REVIEWED_TOOL_CANDIDATES[name]) {
    try { allowed.add(realpathSync(candidate)) } catch { /* unavailable reviewed candidate */ }
  }
  if (allowed.size === 0) fail('missing_reviewed_tool', `reviewed ${name} executable is unavailable`)
  if (selected !== undefined) {
    if (!path.isAbsolute(selected)) fail('unsafe_startup_environment', `reviewed ${name} executable must be absolute`)
    let canonical: string
    try { canonical = realpathSync(selected) } catch { fail('missing_reviewed_tool', `reviewed ${name} executable is unavailable`) }
    if (!allowed.has(canonical)) fail('unsafe_startup_environment', `unreviewed ${name} executable was selected`)
    return canonical
  }
  return [...allowed][0]
}

export const REVIEWED_NODE_EXECUTABLE = reviewedExecutable('node', process.env.ORACLE_P0_1_NODE)
export const REVIEWED_GIT_EXECUTABLE = reviewedExecutable('git', process.env.ORACLE_P0_1_GIT)
export const REVIEWED_CODEGRAPH_EXECUTABLE = reviewedExecutable('codegraph', process.env.ORACLE_P0_1_CODEGRAPH)

export const REVIEWED_GIT_ENVIRONMENT = Object.freeze({
  HOME: '/dev/null',
  PATH: `${path.dirname(REVIEWED_GIT_EXECUTABLE)}:/usr/bin:/bin`,
  LANG: 'C',
  LC_ALL: 'C',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_COUNT: '0',
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
})

export const DEFAULT_GIT_OUTPUT_BYTES = 32 * 1024 * 1024

export type ReviewedGitResult = Readonly<{ stdout: Buffer; stderr: Buffer; status: number }>
export type ReviewedGitOptions = Readonly<{
  maxOutputBytes?: number
  allowedExitCodes?: readonly number[]
}>

type ReplacementStorage = Readonly<{ commonDirectory: string; signature: string }>
const replacementStorageCache = new Map<string, ReplacementStorage>()

function storageSignature(file: string, expected: 'directory' | 'regular_file', typeErrorCode: string): string {
  try {
    const stat = lstatSync(file, { bigint: true })
    if ((expected === 'directory' && !stat.isDirectory()) || (expected === 'regular_file' && !stat.isFile()) || stat.isSymbolicLink()) {
      fail(typeErrorCode, `Git replacement storage must be a real ${expected === 'directory' ? 'directory' : 'regular file'}`)
    }
    return [expected, stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
  } catch (error) {
    if ((error as Error & { code?: string }).code === typeErrorCode) throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent'
    fail('git_inspection_failed', 'Git replacement storage is unavailable')
  }
}

function replacementStorageSignature(commonDirectory: string): string {
  return `${storageSignature(path.join(commonDirectory, 'refs/replace'), 'directory', 'git_replace_refs_storage_type')}|${storageSignature(path.join(commonDirectory, 'packed-refs'), 'regular_file', 'git_packed_refs_storage_type')}`
}

function runReviewedGitRaw(rootInput: string, args: readonly string[], options: ReviewedGitOptions = {}): ReviewedGitResult {
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_GIT_OUTPUT_BYTES
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > DEFAULT_GIT_OUTPUT_BYTES) {
    fail('invalid_git_output_limit', 'Git output limit must be a positive safe integer within the reviewed bound')
  }
  const root = realpathSync(rootInput)
  const observed = spawnSync(REVIEWED_GIT_EXECUTABLE, [...args], {
    cwd: root,
    encoding: 'buffer',
    env: { ...REVIEWED_GIT_ENVIRONMENT },
    maxBuffer: maxOutputBytes,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (observed.error && (observed.error as NodeJS.ErrnoException).code === 'ENOBUFS') {
    fail('git_output_limit_exceeded', 'Git output exceeded the reviewed bound')
  }
  if (observed.error || observed.signal !== null || observed.status === null) fail('git_inspection_failed', 'Git inspection process failed')
  const allowedExitCodes = options.allowedExitCodes ?? [0]
  if (!allowedExitCodes.includes(observed.status)) fail('git_command_failed', 'Git inspection command failed')
  return Object.freeze({ stdout: Buffer.from(observed.stdout), stderr: Buffer.from(observed.stderr), status: observed.status })
}

export function assertNoGitReplacementRefs(rootInput: string): void {
  const root = realpathSync(rootInput)
  const cached = replacementStorageCache.get(root)
  if (cached && replacementStorageSignature(cached.commonDirectory) === cached.signature) return
  const commonOutput = runReviewedGitRaw(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).stdout.toString('utf8').trim()
  const commonDirectory = realpathSync(commonOutput)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = replacementStorageSignature(commonDirectory)
    const observed = runReviewedGitRaw(root, ['for-each-ref', '--format=%(refname)', 'refs/replace'])
    const after = replacementStorageSignature(commonDirectory)
    if (before !== after) continue
    if (observed.stdout.length > 0) fail('git_replace_refs_present', 'local Git replacement refs are forbidden')
    replacementStorageCache.set(root, Object.freeze({ commonDirectory, signature: after }))
    return
  }
  fail('git_replacement_refs_unstable', 'Git replacement storage changed during inspection')
}

export function runReviewedGit(rootInput: string, args: readonly string[], options: ReviewedGitOptions = {}): ReviewedGitResult {
  assertNoGitReplacementRefs(rootInput)
  return runReviewedGitRaw(rootInput, args, options)
}

export function assertProductionStartupEnvironment(): void {
  if (process.env.ORACLE_P0_1_LAUNCHER !== 'posix-v1') fail('unsafe_startup_environment', 'authoritative POSIX launcher is required')
  for (const name of UNSAFE_STARTUP_VARIABLES) {
    if (Object.hasOwn(process.env, name)) fail('unsafe_startup_environment', 'unsafe inherited startup state rejected')
  }
  if (realpathSync(process.execPath) !== REVIEWED_NODE_EXECUTABLE) fail('unsafe_startup_environment', 'production Node executable differs from the reviewed binding')
  if (process.env.HOME !== '/dev/null' || process.env.TMPDIR !== '/tmp') fail('unsafe_startup_environment', 'production HOME and TMPDIR must be isolated')
  if (process.env.npm_config_userconfig !== '/dev/null' || process.env.npm_config_globalconfig !== '/etc/oracle-p0-1-empty-npmrc' || process.env.GOENV !== 'off') fail('unsafe_startup_environment', 'user package and Go configuration must be disabled')
}

export function minimalToolEnvironment(): NodeJS.ProcessEnv {
  return {
    HOME: process.env.HOME ?? '/tmp',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    PATH: `${path.dirname(REVIEWED_NODE_EXECUTABLE)}:/usr/bin:/bin`,
    LANG: 'C',
    LC_ALL: 'C',
  }
}
