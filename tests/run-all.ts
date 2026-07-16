import { readdirSync } from 'fs'

import { P0_1_TEST_FILES } from './p0-1-suite-files.js'
import { defaultSuiteProcessSpecifications, runSerialSuiteProcesses } from './suite-process-runner.js'

const [mode, ...unexpected] = process.argv.slice(2)
if (unexpected.length > 0 || (mode !== undefined && mode !== '--exclude-oracle-p0-1')) {
  throw new Error('usage: tsx tests/run-all.ts [--exclude-oracle-p0-1]')
}
const excluded = mode === '--exclude-oracle-p0-1' ? new Set<string>(P0_1_TEST_FILES) : new Set<string>()

if (mode === undefined) {
  runSerialSuiteProcesses(defaultSuiteProcessSpecifications())
} else {
  const files = readdirSync(new URL('.', import.meta.url))
    .filter((file) => file.endsWith('.test.ts'))
    .filter((file) => !excluded.has(file))
    .sort()

  console.log(`Running ${files.length} test files`)

  for (const file of files) {
    await import(new URL(`./${file}`, import.meta.url).href)
  }
}
