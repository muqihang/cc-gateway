import assert from 'node:assert/strict'
import test from 'node:test'

import {
  defaultSuiteProcessSpecifications,
  runSerialSuiteProcesses,
} from './suite-process-runner.js'

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
