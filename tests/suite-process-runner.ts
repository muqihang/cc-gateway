import { spawnSync } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import { userInfo } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type SuiteProcessSpecification = Readonly<{
  label: string
  argv: readonly [string, ...string[]]
}>

export type SuiteProcessResult = Readonly<{
  label: string
  stdout: string
  stderr: string
}>

type RunSerialSuiteProcessOptions = Readonly<{
  cwd?: string
  environment?: NodeJS.ProcessEnv
  stdio?: 'inherit' | 'pipe'
}>

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

const UNSAFE_FULL_SUITE_STARTUP_VARIABLES = Object.freeze([
  'NODE' + '_OPTIONS',
  'NODE' + '_PATH',
  'NODE' + '_EXTRA_CA_CERTS',
  'TSX_TSCONFIG_PATH',
  'LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
])

export function buildClosedFullSuiteEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  for (const name of UNSAFE_FULL_SUITE_STARTUP_VARIABLES) {
    if ((source[name] ?? '').length > 0) {
      fail('unsafe_full_suite_environment', `${name} is forbidden for the full-suite launcher`)
    }
  }

  let goModuleCache: string
  let localExecutableDirectory: string
  try {
    goModuleCache = realpathSync(path.join(userInfo().homedir, 'go', 'pkg', 'mod'))
    if (!statSync(goModuleCache).isDirectory()) throw new Error('not a directory')
    localExecutableDirectory = realpathSync(fileURLToPath(new URL('../node_modules/.bin', import.meta.url)))
    if (!statSync(localExecutableDirectory).isDirectory()) throw new Error('not a directory')
  } catch {
    fail('full_suite_dependency_cache_unavailable', 'the reviewed offline Go module cache is unavailable')
  }

  const environment: NodeJS.ProcessEnv = {
    PATH: [localExecutableDirectory, path.dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':'),
    HOME: '/tmp',
    TMPDIR: '/tmp',
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    npm_config_userconfig: '/dev/null',
    npm_config_globalconfig: '/nonexistent/oracle-lab-empty-global-npmrc',
    npm_config_offline: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    GOENV: 'off',
    GOFLAGS: '-mod=readonly',
    GOPROXY: 'off',
    GOSUMDB: 'off',
    GOTOOLCHAIN: 'local',
    GOMODCACHE: goModuleCache,
    GOCACHE: `/tmp/oracle-lab-phase1-go-build-${process.pid}`,
    HTTP_PROXY: 'http://127.0.0.1:9',
    HTTPS_PROXY: 'http://127.0.0.1:9',
    ALL_PROXY: 'http://127.0.0.1:9',
    NO_PROXY: '127.0.0.1,localhost,::1',
    http_proxy: 'http://127.0.0.1:9',
    https_proxy: 'http://127.0.0.1:9',
    all_proxy: 'http://127.0.0.1:9',
    no_proxy: '127.0.0.1,localhost,::1',
  }
  const contractPath = source.SUB2API_FORMAL_POOL_CONTRACT_PATH
  if (contractPath !== undefined && contractPath.length > 0) {
    environment.SUB2API_FORMAL_POOL_CONTRACT_PATH = contractPath
  }
  return environment
}

export function defaultSuiteProcessSpecifications(): readonly SuiteProcessSpecification[] {
  const runP01 = fileURLToPath(new URL('./run-p0-1.ts', import.meta.url))
  const runAll = fileURLToPath(new URL('./run-all.ts', import.meta.url))
  return Object.freeze([
    Object.freeze({
      label: 'oracle-p0-1',
      argv: Object.freeze([process.execPath, '--import', 'tsx', runP01]),
    }),
    Object.freeze({
      label: 'non-p0-1',
      argv: Object.freeze([process.execPath, '--import', 'tsx', runAll, '--exclude-oracle-p0-1']),
    }),
  ])
}

export function runSerialSuiteProcesses(
  specifications: readonly SuiteProcessSpecification[],
  options: RunSerialSuiteProcessOptions = {},
): readonly SuiteProcessResult[] {
  const results: SuiteProcessResult[] = []
  for (const specification of specifications) {
    if (specification.label.length === 0 || specification.argv.length === 0) {
      fail('invalid_suite_process', 'suite process label and argv are required')
    }
    const observed = spawnSync(specification.argv[0], specification.argv.slice(1), {
      cwd: options.cwd,
      encoding: 'utf8',
      env: options.environment === undefined
        ? buildClosedFullSuiteEnvironment(process.env)
        : { ...options.environment },
      shell: false,
      stdio: options.stdio ?? 'inherit',
    })
    if (observed.error || observed.signal !== null || observed.status === null) {
      fail('suite_process_failed', `${specification.label} test process did not exit normally`)
    }
    if (observed.status !== 0) {
      fail('suite_process_failed', `${specification.label} test process exited with status ${observed.status}`)
    }
    results.push(Object.freeze({
      label: specification.label,
      stdout: observed.stdout ?? '',
      stderr: observed.stderr ?? '',
    }))
  }
  return Object.freeze(results)
}
