import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { runSerialSuiteProcesses } from './suite-process-runner.js'

test('full-suite groups run serially in distinct processes with fresh environments', () => {
  const environment = { ...process.env }
  delete environment.PHASE1_ISOLATION_SENTINEL
  const results = runSerialSuiteProcesses([
    {
      label: 'first',
      argv: [process.execPath, fileURLToPath(new URL('./fixtures/isolation-first.mjs', import.meta.url))],
    },
    {
      label: 'second',
      argv: [process.execPath, fileURLToPath(new URL('./fixtures/isolation-second.mjs', import.meta.url))],
    },
  ], { environment, stdio: 'pipe' })

  assert.equal(results.length, 2)
  const events = results.flatMap((result) => result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)))
  assert.deepEqual(events.map((event) => event.event), ['first:start', 'first:end', 'second:start'])
  assert.notEqual(events[0].pid, events[2].pid)
})
