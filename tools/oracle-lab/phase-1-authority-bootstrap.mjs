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
  writeFileSync,
} from 'node:fs'
import { userInfo } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const RUNTIME_PATHS = Object.freeze([
  'docs/superpowers/schemas/oracle-lab-phase-1-authority-restart.schema.json',
  'tools/oracle-lab/oracle-phase1-authority-restart',
  'tools/oracle-lab/phase-1-authority-bootstrap.mjs',
  'tools/oracle-lab/phase-1-authority-restart.ts',
  'tools/oracle-lab/secure-runtime.ts',
  'package.json',
  'package-lock.json',
])
const EXPECTED_TOOL_REMOTE_URL_DIGEST = 'sha256:52de8ee497a784b90b33345865754f3e6b9d5d96eed92549a15a4157cabb568a'
const ROOT_FLAGS = Object.freeze(['cc-source-root', 'cc-replacement-root', 'sub2api-source-root', 'sub2api-replacement-root'])

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

function gitBlobOid(bytes, expectedOid) {
  const algorithm = /^[0-9a-f]{40}$/.test(expectedOid)
    ? 'sha1'
    : /^[0-9a-f]{64}$/.test(expectedOid) ? 'sha256' : ''
  if (algorithm === '') fail('authority_restart_runtime_binding_mismatch')
  return createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
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

function gitText(root, git, args) {
  return runGit(root, git, args).toString('utf8').trim()
}

function resolveCommit(root, git, revision) {
  const commit = gitText(root, git, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`])
  if (!/^[0-9a-f]{40,64}$/.test(commit)) fail('authority_restart_git_object_invalid')
  return commit
}

function soleParent(root, git, commit) {
  const fields = gitText(root, git, ['rev-list', '--parents', '-n', '1', commit]).split(' ')
  if (fields.length !== 2) fail('authority_restart_parent_mismatch')
  return fields[1]
}

function exactFlag(argv, name) {
  const values = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name) values.push(argv[index + 1])
  }
  if (values.length !== 1 || values[0] === undefined || values[0].startsWith('--')) fail('authority_restart_cli_arguments_invalid')
  return values[0]
}

function parseBootstrapRootFlags(argv) {
  const command = argv[0]
  if (!['validate-runtime', 'validate-source', 'build', 'validate-pre-commit', 'validate-post-commit'].includes(command)) {
    fail('authority_restart_cli_arguments_invalid')
  }
  const values = {}
  for (let index = 1; index < argv.length; index += 2) {
    const token = argv[index]
    const value = argv[index + 1]
    if (typeof token !== 'string' || !token.startsWith('--') || typeof value !== 'string' || value.startsWith('--')) {
      fail('authority_restart_cli_arguments_invalid')
    }
    const name = token.slice(2)
    if (!ROOT_FLAGS.includes(name)) continue
    if (Object.hasOwn(values, name) || !path.isAbsolute(value)) fail('authority_restart_cli_arguments_invalid')
    values[name] = value
  }
  const expected = command === 'validate-runtime' ? ['cc-replacement-root'] : ROOT_FLAGS
  if (expected.some((name) => !Object.hasOwn(values, name))
    || Object.keys(values).some((name) => !expected.includes(name))) fail('authority_restart_cli_arguments_invalid')
  return Object.freeze({ command, values: Object.freeze(values) })
}

function canonicalExistingRoot(value) {
  try { return realpathSync(value) } catch { fail('authority_restart_cli_arguments_invalid') }
}

function assertDistinctRuntimeRoots(toolRoot, parsedRoots) {
  const roots = [toolRoot, canonicalExistingRoot(parsedRoots.values['cc-replacement-root'])]
  if (parsedRoots.command !== 'validate-runtime') roots.push(canonicalExistingRoot(parsedRoots.values['sub2api-replacement-root']))
  if (new Set(roots).size !== roots.length) fail('authority_restart_tool_replacement_alias')
  return Object.freeze(roots)
}

function verifyRuntime(toolRoot, git) {
  if (realpathSync(process.execPath) !== realpathSync(selectTool('node'))) fail('authority_restart_unsafe_startup_environment')
  if (process.env.ORACLE_PHASE1_AUTHORITY_LAUNCHER !== 'posix-v1'
    || process.env.ORACLE_PHASE1_AUTHORITY_BOOTSTRAP !== 'reviewed-git-object-v3'
    || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(process.env.ORACLE_PHASE1_AUTHORITY_BOOTSTRAP_OID ?? '')
    || process.env.HOME !== '/dev/null'
    || process.env.TMPDIR !== '/tmp') fail('authority_restart_unsafe_startup_environment')
  const replacementRefs = runGit(toolRoot, git, ['for-each-ref', '--format=%(refname)', 'refs/replace'])
  if (replacementRefs.length !== 0) fail('authority_restart_runtime_binding_mismatch')
  const branch = gitText(toolRoot, git, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (branch !== 'main' && !branch.startsWith('codex/')) fail('authority_restart_runtime_binding_mismatch')
  const reviewedRef = `refs/remotes/muqihang/${branch}`
  const reviewedCommit = resolveCommit(toolRoot, git, reviewedRef)
  if (resolveCommit(toolRoot, git, 'HEAD') !== reviewedCommit) fail('authority_restart_runtime_binding_mismatch')
  const remoteUrl = gitText(toolRoot, git, ['remote', 'get-url', 'muqihang'])
  if (sha256(Buffer.from(remoteUrl, 'utf8')) !== EXPECTED_TOOL_REMOTE_URL_DIGEST) fail('authority_restart_runtime_binding_mismatch')
  if (runGit(toolRoot, git, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']).length !== 0) {
    fail('authority_restart_runtime_binding_mismatch')
  }
  const files = []
  for (const file of RUNTIME_PATHS) {
    const target = path.join(toolRoot, file)
    let before
    try { before = lstatSync(target, { bigint: true }) } catch { fail('authority_restart_runtime_binding_mismatch') }
    if (!before.isFile() || before.isSymbolicLink()) fail('authority_restart_runtime_binding_mismatch')
    const working = readFileSync(target)
    const after = lstatSync(target, { bigint: true })
    const reviewed = runGit(toolRoot, git, ['show', `${reviewedCommit}:${file}`])
    if (!sameMetadata(before, after) || !working.equals(reviewed)) fail('authority_restart_runtime_binding_mismatch')
    const oid = gitText(toolRoot, git, ['rev-parse', `${reviewedCommit}:${file}`])
    files.push(Object.freeze({ path: file, bytes: Buffer.from(reviewed), metadata: before, oid }))
  }
  return Object.freeze({ reviewedCommit, reviewedRef, files: Object.freeze(files) })
}

function assertBootstrapStream(runtime) {
  const bootstrap = runtime.files.find((file) => file.path === 'tools/oracle-lab/phase-1-authority-bootstrap.mjs')
  if (!bootstrap) fail('authority_restart_runtime_binding_mismatch')
  const expectedOid = process.env.ORACLE_PHASE1_AUTHORITY_BOOTSTRAP_OID ?? ''
  if (bootstrap.oid !== expectedOid || gitBlobOid(bootstrap.bytes, expectedOid) !== expectedOid) {
    fail('authority_restart_runtime_binding_mismatch')
  }
}

function assertReviewedRuntimeUnchanged(runtime, toolRoot) {
  for (const file of runtime.files) {
    const target = path.join(toolRoot, file.path)
    let metadata
    try { metadata = lstatSync(target, { bigint: true }) } catch { fail('authority_restart_runtime_binding_mismatch') }
    if (!metadata.isFile() || metadata.isSymbolicLink() || !sameMetadata(file.metadata, metadata)
      || !readFileSync(target).equals(file.bytes)) fail('authority_restart_runtime_binding_mismatch')
  }
}

function installDependencies(targetRoot, npm, commandCache) {
  const installed = spawnSync(npm, ['ci', '--offline', '--ignore-scripts', '--cache', commandCache, '--prefix', targetRoot], {
    cwd: targetRoot,
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

function materializeReviewedRuntime(runtime, dependencyRoot, account) {
  for (const file of runtime.files) {
    const destination = path.join(dependencyRoot, file.path)
    const parent = path.dirname(destination)
    mkdirSync(parent, { recursive: true, mode: 0o700 })
    for (let current = parent; current !== dependencyRoot; current = path.dirname(current)) {
      chmodSync(current, 0o700)
      const metadata = lstatSync(current, { bigint: true })
      if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== BigInt(account.uid)
        || (Number(metadata.mode) & 0o777) !== 0o700) {
        fail('authority_restart_runtime_binding_mismatch')
      }
    }
    writeFileSync(destination, file.bytes, { flag: 'wx', mode: 0o600 })
    const metadata = lstatSync(destination, { bigint: true })
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== BigInt(account.uid)
      || (Number(metadata.mode) & 0o777) !== 0o600 || !readFileSync(destination).equals(file.bytes)) {
      fail('authority_restart_runtime_binding_mismatch')
    }
  }
}

function assertMaterializedRuntime(runtime, dependencyRoot, account) {
  for (const file of runtime.files) {
    const target = path.join(dependencyRoot, file.path)
    const metadata = lstatSync(target, { bigint: true })
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== BigInt(account.uid)
      || (Number(metadata.mode) & 0o777) !== 0o600 || !readFileSync(target).equals(file.bytes)) {
      fail('authority_restart_runtime_binding_mismatch')
    }
  }
}

function prepareDependencies(runtime, npm) {
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

  const dependencyRoot = mkdtempSync('/tmp/oracle-phase1-authority-dependencies.')
  chmodSync(dependencyRoot, 0o700)
  assertRealDirectory(dependencyRoot, account.uid, true)
  materializeReviewedRuntime(runtime, dependencyRoot, account)
  installDependencies(dependencyRoot, npm, commandCache)
  assertMaterializedRuntime(runtime, dependencyRoot, account)
  return Object.freeze({ dependencyRoot, commandCache })
}

function assertCanonicalCliPaths(parsed, bindings) {
  if (parsed.command === 'build') {
    if (parsed.values['plan-path'] !== bindings.authorityPaths.plan
      || parsed.values['plan-review-path'] !== bindings.authorityPaths.planReview
      || parsed.values['execution-context-path'] !== bindings.authorityPaths.executionContext
      || path.resolve(parsed.values['cc-replacement-root'], parsed.values.output) !== path.resolve(parsed.values['cc-replacement-root'], bindings.artifactPath)) {
      fail('authority_restart_cli_arguments_invalid')
    }
  } else if (parsed.command !== 'validate-source' && parsed.command !== 'validate-runtime'
    && path.resolve(parsed.values['cc-replacement-root'], parsed.values.artifact) !== path.resolve(parsed.values['cc-replacement-root'], bindings.artifactPath)) {
    fail('authority_restart_cli_arguments_invalid')
  }
}

function authorityFromCommit(root, git, file, commit) {
  const bytes = runGit(root, git, ['show', `${commit}:${file}`])
  return Object.freeze({ path: file, digest: sha256(bytes), commit })
}

async function runAuthorityCommand(toolRoot, git, dependencies, argv) {
  const apiPath = path.join(dependencies.dependencyRoot, 'node_modules/tsx/dist/esm/api/index.mjs')
  const toolPath = path.join(dependencies.dependencyRoot, 'tools/oracle-lab/phase-1-authority-restart.ts')
  for (const target of [apiPath, toolPath]) {
    const metadata = lstatSync(target)
    if (!metadata.isFile() || metadata.isSymbolicLink()) fail('authority_restart_runtime_binding_mismatch')
  }
  const { tsImport } = await import(pathToFileURL(apiPath).href)
  const tool = await tsImport(pathToFileURL(toolPath).href, import.meta.url)
  const parsed = tool.parseAuthorityRestartCli(argv)
  const bindings = tool.AUTHORITY_RESTART_BINDINGS
  assertCanonicalCliPaths(parsed, bindings)
  if (parsed.command === 'validate-runtime') return

  tool.validatePhase1AuthorityRestartSource({
    ccGatewayRoot: parsed.values['cc-source-root'],
    sub2apiRoot: parsed.values['sub2api-source-root'],
    bindings,
  })
  if (parsed.command === 'validate-source') return

  const ccRoot = realpathSync(parsed.values['cc-replacement-root'])
  const subRoot = realpathSync(parsed.values['sub2api-replacement-root'])
  if (parsed.command === 'build') {
    const ccCommits = parsed.repeated['cc-replacement-commit']
    const subCommits = parsed.repeated['sub2api-replacement-commit']
    const authorizedBase = soleParent(ccRoot, git, ccCommits[0])
    const remoteMain = resolveCommit(ccRoot, git, 'refs/remotes/muqihang/main')
    const artifact = tool.buildPhase1AuthorityRestart({
      ccGatewayRoot: ccRoot,
      sub2apiRoot: subRoot,
      repairedAuthority: {
        plan: authorityFromCommit(ccRoot, git, bindings.authorityPaths.plan, remoteMain),
        plan_review: authorityFromCommit(ccRoot, git, bindings.authorityPaths.planReview, authorizedBase),
        execution_context: authorityFromCommit(ccRoot, git, bindings.authorityPaths.executionContext, authorizedBase),
      },
      replacementCommits: { cc_gateway: ccCommits, sub2api: subCommits },
    }, bindings)
    tool.writePhase1AuthorityRestart(ccRoot, artifact, bindings)
    tool.validatePhase1AuthorityRestartPreCommit(artifact, { ccGatewayRoot: ccRoot, sub2apiRoot: subRoot, bindings })
    return
  }

  const artifactPath = path.join(ccRoot, bindings.artifactPath)
  const bytes = readFileSync(artifactPath)
  const artifact = JSON.parse(bytes.toString('utf8'))
  if (parsed.command === 'validate-pre-commit') {
    tool.validatePhase1AuthorityRestartPreCommit(artifact, { ccGatewayRoot: ccRoot, sub2apiRoot: subRoot, bindings })
  } else {
    tool.validatePhase1AuthorityRestartPostCommit(artifact, bytes, { ccGatewayRoot: ccRoot, sub2apiRoot: subRoot, bindings })
  }
}

async function main(argv) {
  if (argv[0] === 'inventory-cache') {
    if (argv.length !== 3 || argv[1] !== '--root') fail('authority_restart_cli_arguments_invalid')
    process.stdout.write(`${JSON.stringify(inventoryCache(argv[2]))}\n`)
    return
  }
  if (process.env.ORACLE_PHASE1_AUTHORITY_BOOTSTRAP !== 'reviewed-git-object-v3'
    || typeof process.env.ORACLE_PHASE1_AUTHORITY_TOOL_ROOT !== 'string'
    || !path.isAbsolute(process.env.ORACLE_PHASE1_AUTHORITY_TOOL_ROOT)) fail('authority_restart_unsafe_startup_environment')
  const toolRoot = realpathSync(process.env.ORACLE_PHASE1_AUTHORITY_TOOL_ROOT)
  const parsedRoots = parseBootstrapRootFlags(argv)
  assertDistinctRuntimeRoots(toolRoot, parsedRoots)
  const git = selectTool('git')
  const runtime = verifyRuntime(toolRoot, git)
  assertBootstrapStream(runtime)
  const npm = selectTool('npm')
  const dependencies = prepareDependencies(runtime, npm)
  try { await runAuthorityCommand(toolRoot, git, dependencies, argv) }
  finally { assertReviewedRuntimeUnchanged(runtime, toolRoot) }
}

try {
  await main(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`${String(error?.code ?? 'authority_restart_failed')}\n`)
  process.exitCode = 1
}
