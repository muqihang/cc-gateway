import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildClosedFullSuiteEnvironment,
  defaultSuiteProcessSpecifications,
  runSerialSuiteProcesses,
} from './suite-process-runner.js'

test('default full-suite child environment is closed and preserves only the dedicated contract path', () => {
  const contractPath = '/tmp/sub2api-contract-main/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json'
  const observed = buildClosedFullSuiteEnvironment({
    PATH: '/hostile/bin',
    HOME: '/hostile/home',
    SUB2API_FORMAL_POOL_CONTRACT_PATH: contractPath,
    SUB2API_ROOT: '/operator/sibling',
    ORACLE_LAB_MANIFEST_PATH: '/tmp/forged.json',
    PHASE1_REQUIRE_EXECUTION_CONTEXT: '1',
    GIT_DIR: '/tmp/forged-git',
    npm_config_userconfig: '/tmp/forged-npmrc',
  })

  assert.equal(observed.SUB2API_FORMAL_POOL_CONTRACT_PATH, contractPath)
  assert.equal(observed.SUB2API_ROOT, undefined)
  assert.equal(observed.ORACLE_LAB_MANIFEST_PATH, undefined)
  assert.equal(observed.PHASE1_REQUIRE_EXECUTION_CONTEXT, undefined)
  assert.equal(observed.GIT_DIR, undefined)
  assert.equal(observed.npm_config_userconfig, '/dev/null')
  assert.equal(observed.npm_config_globalconfig, '/nonexistent/oracle-lab-empty-global-npmrc')
  assert.notEqual(observed.PATH, '/hostile/bin')
  assert.match(observed.PATH ?? '', /node_modules\/\.bin/)
  assert.equal(observed.HOME, '/tmp')
  assert.equal(observed.HTTP_PROXY, 'http://127.0.0.1:9')
  assert.equal(observed.GOPROXY, 'off')
  assert.equal(observed.GOFLAGS, '-mod=readonly')
  assert.match(observed.GOMODCACHE ?? '', /^\//)
  assert.match(observed.GOCACHE ?? '', /^\/tmp\/oracle-lab-phase1-go-build-[0-9]+$/)
})

test('full-suite launcher rejects inherited Node loader and dynamic-library startup injection', () => {
  for (const name of [
    'NODE' + '_OPTIONS', 'NODE' + '_PATH', 'NODE' + '_EXTRA_CA_CERTS', 'TSX_TSCONFIG_PATH',
    'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH',
  ]) {
    assert.throws(
      () => buildClosedFullSuiteEnvironment({ [name]: '/tmp/hostile' }),
      (error: unknown) => (error as { code?: string }).code === 'unsafe_full_suite_environment',
      name,
    )
  }
})

test('full test suites run serially in isolated child processes', () => {
  const environment = { ...process.env }
  delete environment.ORACLE_SUITE_ISOLATION_CANARY
  const observed = runSerialSuiteProcesses([
    {
      label: 'first',
      argv: [
        process.execPath,
        '-e',
        "process.env.ORACLE_SUITE_ISOLATION_CANARY='mutated';console.log(JSON.stringify({pid:process.pid,value:process.env.ORACLE_SUITE_ISOLATION_CANARY}))",
      ],
    },
    {
      label: 'second',
      argv: [
        process.execPath,
        '-e',
        "console.log(JSON.stringify({pid:process.pid,hasCanary:Object.hasOwn(process.env,'ORACLE_SUITE_ISOLATION_CANARY')}))",
      ],
    },
  ], { environment, stdio: 'pipe' })

  const first = JSON.parse(observed[0].stdout.trim()) as { pid: number; value: string }
  const second = JSON.parse(observed[1].stdout.trim()) as { pid: number; hasCanary: boolean }
  assert.notEqual(first.pid, second.pid)
  assert.equal(first.value, 'mutated')
  assert.equal(second.hasCanary, false)
  assert.deepEqual(observed.map((result) => result.label), ['first', 'second'])
})

test('default full test order isolates P0.1 before non-P0.1 tests', () => {
  const specifications = defaultSuiteProcessSpecifications()
  assert.deepEqual(specifications.map((specification) => specification.label), [
    'oracle-p0-1',
    'non-p0-1',
  ])
  assert.match(specifications[0].argv.join('\n'), /run-p0-1\.ts/)
  assert.match(specifications[1].argv.join('\n'), /run-all\.ts\n--exclude-oracle-p0-1/)
})

test('suite process failures stop the serial runner with a stable code', () => {
  assert.throws(
    () => runSerialSuiteProcesses([{
      label: 'nonzero',
      argv: [process.execPath, '-e', 'process.exit(7)'],
    }], { stdio: 'pipe' }),
    (error: unknown) => (error as { code?: string }).code === 'suite_process_failed',
  )

  assert.throws(
    () => runSerialSuiteProcesses([{
      label: 'signalled',
      argv: [process.execPath, '-e', "process.kill(process.pid, 'SIGTERM')"],
    }], { stdio: 'pipe' }),
    (error: unknown) => (error as { code?: string }).code === 'suite_process_failed',
  )
})
