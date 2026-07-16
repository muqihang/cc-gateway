import { spawnSync } from 'node:child_process'
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
      env: { ...(options.environment ?? process.env) },
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
