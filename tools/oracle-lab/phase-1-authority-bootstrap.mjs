#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs'
import { userInfo } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RUNTIME_PATHS = Object.freeze([
  'docs/superpowers/schemas/oracle-lab-phase-1-authority-restart.schema.json',
  'tools/oracle-lab/oracle-phase1-authority-restart',
  'tools/oracle-lab/phase-1-authority-bootstrap.mjs',
  'tools/oracle-lab/phase-1-authority-restart.ts',
  'tools/oracle-lab/secure-runtime.ts',
  'package-lock.json',
])

const TOOL_CANDIDATES = Object.freeze({
  node: Object.freeze(['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']),
  git: Object.freeze(['/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git']),
  npm: Object.freeze(['/opt/homebrew/bin/npm', '/usr/local/bin/npm', '/usr/bin/npm']),
})

function fail(code) {
  throw Object.assign(new Error(code), { code })
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function sameMetadata(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
}

function assertRealDirectory(target, expectedUid, forbidSharedWrite = false) {
  let metadata
  try { metadata = lstatSync(target, { bigint: true }) } catch { fail('authority_restart_dependency_cache_unsafe') }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail('authority_restart_dependency_cache_unsafe')
  if (expectedUid !== undefined && metadata.uid !== BigInt(expectedUid)) fail('authority_restart_dependency_cache_unsafe')
  if (forbidSharedWrite && (Number(metadata.mode) & 0o022) !== 0) fail('authority_restart_dependency_cache_unsafe')
  return metadata
}

function inventoryCache(rootInput) {
  const requestedRoot = path.resolve(rootInput)
  assertRealDirectory(requestedRoot)
  const root = realpathSync(requestedRoot)
  const records = []

  function walk(relative) {
    const target = relative === '.' ? root : path.join(root, relative)
    const before = lstatSync(target, { bigint: true })
    if (before.isSymbolicLink()) fail('authority_restart_dependency_cache_unsafe')
    const mode = Number(before.mode) & 0o777
    if (before.isDirectory()) {
      records.push(Object.freeze({ path: relative, type: 'directory', mode }))
      const entries = readdirSync(target).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      for (const entry of entries) walk(relative === '.' ? entry : path.join(relative, entry))
    } else if (before.isFile()) {
      const bytes = readFileSync(target)
      records.push(Object.freeze({ path: relative, type: 'regular_file', mode, size: bytes.length, digest: sha256(bytes) }))
    } else {
      fail('authority_restart_dependency_cache_unsafe')
    }
    const after = lstatSync(target, { bigint: true })
    if (!sameMetadata(before, after)) fail('authority_restart_dependency_cache_unstable')
  }

  walk('.')
  return Object.freeze({ records: Object.freeze(records), digest: sha256(canonicalJson(records)) })
}

function copyFileCow(source, destination) {
  try {
    copyFileSync(source, destination, constants.COPYFILE_FICLONE_FORCE)
    return
  } catch (error) {
    if (error?.code !== 'ENOSYS') throw error
  }
  const copied = spawnSync('/bin/cp', ['-c', source, destination], {
    encoding: 'buffer',
    env: { HOME: '/dev/null', PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (copied.error || copied.signal !== null || copied.status !== 0) fail('authority_restart_dependency_cache_unsafe')
}

function cloneCacheInventory(sourceRoot, destinationRoot, inventory) {
  const rootRecord = inventory.records[0]
  if (rootRecord?.path !== '.' || rootRecord.type !== 'directory') fail('authority_restart_dependency_cache_unsafe')
  mkdirSync(destinationRoot, { mode: rootRecord.mode })
  chmodSync(destinationRoot, rootRecord.mode)
  for (const record of inventory.records.slice(1)) {
    const source = path.join(sourceRoot, record.path)
    const destination = path.join(destinationRoot, record.path)
    const sourceMetadata = lstatSync(source)
    if (sourceMetadata.isSymbolicLink()) fail('authority_restart_dependency_cache_unsafe')
    if (record.type === 'directory') {
      if (!sourceMetadata.isDirectory()) fail('authority_restart_dependency_cache_unstable')
      mkdirSync(destination, { mode: record.mode })
      chmodSync(destination, record.mode)
    } else {
      if (!sourceMetadata.isFile()) fail('authority_restart_dependency_cache_unstable')
      copyFileCow(source, destination)
      chmodSync(destination, record.mode)
    }
  }
}

function selectTool(name) {
  for (const candidate of TOOL_CANDIDATES[name]) {
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch { /* unavailable reviewed candidate */ }
  }
  fail('authority_restart_unsafe_startup_environment')
}

function runGit(root, git, args) {
  const result = spawnSync(git, args, {
    cwd: root,
    encoding: 'buffer',
    env: {
      HOME: '/dev/null',
      PATH: `${path.dirname(git)}:/usr/bin:/bin`,
      LANG: 'C',
      LC_ALL: 'C',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_COUNT: '0',
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
    },
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error || result.signal !== null || result.status !== 0) fail('authority_restart_runtime_binding_mismatch')
  return result.stdout
}

function exactFlag(argv, name) {
  const values = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name) values.push(argv[index + 1])
  }
  if (values.length !== 1 || values[0] === undefined || values[0].startsWith('--')) fail('authority_restart_cli_arguments_invalid')
  return values[0]
}

function verifyRuntime(repositoryRoot, git) {
  if (realpathSync(process.execPath) !== realpathSync(selectTool('node'))) fail('authority_restart_unsafe_startup_environment')
  if (process.env.ORACLE_PHASE1_AUTHORITY_LAUNCHER !== 'posix-v1'
    || process.env.HOME !== '/dev/null'
    || process.env.TMPDIR !== '/tmp') fail('authority_restart_unsafe_startup_environment')
  const replacementRefs = runGit(repositoryRoot, git, ['for-each-ref', '--format=%(refname)', 'refs/replace'])
  if (replacementRefs.length !== 0) fail('authority_restart_runtime_binding_mismatch')
  for (const file of RUNTIME_PATHS) {
    const target = path.join(repositoryRoot, file)
    let metadata
    try { metadata = lstatSync(target) } catch { fail('authority_restart_runtime_binding_mismatch') }
    if (!metadata.isFile() || metadata.isSymbolicLink()) fail('authority_restart_runtime_binding_mismatch')
    const reviewed = runGit(repositoryRoot, git, ['show', `refs/remotes/muqihang/main:${file}`])
    if (!readFileSync(target).equals(reviewed)) fail('authority_restart_runtime_binding_mismatch')
  }
}

function prepareDependencies(repositoryRoot, npm) {
  const account = userInfo()
  const npmRoot = path.join(account.homedir, '.npm')
  const sourceCache = path.join(npmRoot, '_cacache')
  assertRealDirectory(npmRoot, account.uid, true)
  assertRealDirectory(sourceCache, account.uid, true)
  const sourceBefore = inventoryCache(sourceCache)

  const commandCache = mkdtempSync('/tmp/oracle-phase1-authority-npm-cache.')
  chmodSync(commandCache, 0o700)
  const commandMetadata = lstatSync(commandCache)
  if (!commandMetadata.isDirectory() || commandMetadata.isSymbolicLink()
    || commandMetadata.uid !== account.uid || (commandMetadata.mode & 0o777) !== 0o700) {
    fail('authority_restart_dependency_cache_unsafe')
  }

  const destinationCache = path.join(commandCache, '_cacache')
  cloneCacheInventory(sourceCache, destinationCache, sourceBefore)
  const sourceAfter = inventoryCache(sourceCache)
  const destination = inventoryCache(destinationCache)
  if (sourceBefore.digest !== sourceAfter.digest || sourceBefore.digest !== destination.digest
    || canonicalJson(sourceBefore.records) !== canonicalJson(destination.records)) {
    fail('authority_restart_dependency_cache_unstable')
  }

  const installed = spawnSync(npm, ['ci', '--offline', '--ignore-scripts', '--cache', commandCache, '--prefix', repositoryRoot], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    env: {
      HOME: '/dev/null',
      TMPDIR: '/tmp',
      PATH: `${path.dirname(process.execPath)}:${path.dirname(npm)}:/usr/bin:/bin`,
      LANG: 'C',
      LC_ALL: 'C',
      TZ: 'UTC',
      CI: '1',
      npm_config_offline: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_cache: commandCache,
      npm_config_userconfig: '/dev/null',
      npm_config_globalconfig: '/nonexistent/oracle-lab-empty-global-npmrc',
    },
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (installed.error || installed.signal !== null || installed.status !== 0) fail('authority_restart_dependency_install_failed')
}

async function runAuthorityCli(repositoryRoot, argv) {
  const apiPath = path.join(repositoryRoot, 'node_modules/tsx/dist/esm/api/index.mjs')
  const toolPath = path.join(repositoryRoot, 'tools/oracle-lab/phase-1-authority-restart.ts')
  for (const target of [apiPath, toolPath]) {
    const metadata = lstatSync(target)
    if (!metadata.isFile() || metadata.isSymbolicLink()) fail('authority_restart_runtime_binding_mismatch')
  }
  process.env.ORACLE_PHASE1_AUTHORITY_BOOTSTRAP = 'verified-v1'
  process.env.ORACLE_PHASE1_AUTHORITY_CACHE = 'command_scoped_lockfile_verified_v1'
  const { tsImport } = await import(pathToFileURL(apiPath).href)
  const tool = await tsImport(pathToFileURL(toolPath).href, import.meta.url)
  tool.runAuthorityRestartCli(argv)
}

async function main(argv) {
  if (argv[0] === 'inventory-cache') {
    if (argv.length !== 3 || argv[1] !== '--root') fail('authority_restart_cli_arguments_invalid')
    process.stdout.write(`${JSON.stringify(inventoryCache(argv[2]))}\n`)
    return
  }
  const repositoryRoot = realpathSync(exactFlag(argv, '--cc-replacement-root'))
  const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  if (repositoryRoot !== moduleRoot) fail('authority_restart_runtime_binding_mismatch')
  const git = selectTool('git')
  verifyRuntime(repositoryRoot, git)
  prepareDependencies(repositoryRoot, selectTool('npm'))
  await runAuthorityCli(repositoryRoot, argv)
}

try {
  await main(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`${String(error?.code ?? 'authority_restart_failed')}\n`)
  process.exitCode = 1
}
