import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { SharedContractError, checkSharedContract } from './check-shared-contract.js'

export class CrossRepoContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'CrossRepoContractError'
  }
}

export type CrossRepoContractResult = {
  ok: true
  bundleDigest: string
  schemaRange: string
  fixtureCases: number
  commandsRun: number
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

function validateStaticContract(ccGatewayRoot: string): { schemaRange: string; fixtureCases: number } {
  const bundle = path.join(ccGatewayRoot, 'contracts/oracle-lab/v1')
  const index = readJson<{ compatibility: Array<{ schema_major: number; minimum_revision: number; maximum_revision: number }> }>(path.join(bundle, 'contract-index.json'))
  if (index.compatibility.length !== 1 || index.compatibility[0].schema_major !== 1 || index.compatibility[0].minimum_revision !== 0 || index.compatibility[0].maximum_revision !== 0) {
    throw new CrossRepoContractError('contract_schema_range_mismatch', 'contract compatibility range must be exactly 1:0-0')
  }
  const expected = readJson<{ stable_error_codes: string[] }>(path.join(bundle, 'expected-results.json'))
  const registered = new Set(expected.stable_error_codes)
  const allowed = new Set([
    'admission_allow', 'authority_allow', 'interface_allow', 'interface_terminal_no_retry',
    'interface_sub2api_retry', 'replay_reserved', 'replay_committed',
  ])
  const canonical = readJson<{ json_cases: unknown[]; cbor_cases: unknown[] }>(path.join(bundle, 'canonicalization-corpus.json'))
  const authority = readJson<{ cases: Array<{ expected_code: string }> }>(path.join(bundle, 'authority-corpus.json'))
  const coherence = readJson<{ cases: Array<{ expected_code: string }> }>(path.join(bundle, 'coherence-corpus.json'))
  const interfaces = readJson<{ cases: Array<{ expected_code: string }> }>(path.join(bundle, 'interface-corpus.json'))
  for (const fixture of [...authority.cases, ...coherence.cases, ...interfaces.cases]) {
    if (!registered.has(fixture.expected_code) && !allowed.has(fixture.expected_code)) {
      throw new CrossRepoContractError('contract_expected_result_missing', `unregistered expected code ${fixture.expected_code}`)
    }
  }
  return {
    schemaRange: '1:0-0',
    fixtureCases: canonical.json_cases.length + canonical.cbor_cases.length + authority.cases.length + coherence.cases.length + interfaces.cases.length,
  }
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 120_000 })
  if (result.status !== 0) {
    throw new CrossRepoContractError('contract_command_failed', `${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`)
  }
}

function runFixtureCommands(ccGatewayRoot: string, sub2apiRoot: string): number {
  const env = { ...process.env, SUB2API_ROOT: sub2apiRoot }
  const tsTests = [
    'tests/oracle-contract-canonical.test.ts',
    'tests/oracle-contract-admission.test.ts',
    'tests/oracle-contract-manifest-authority.test.ts',
    'tests/oracle-contract-sidecar-envelope.test.ts',
    'tests/oracle-contract-cross-project.test.ts',
  ]
  for (const test of tsTests) run(process.execPath, ['--import', 'tsx', test], ccGatewayRoot, env)
  run('go', ['test', './internal/control', '-run', 'TestEnvelopeV2(CanonicalCorpus|SignedCapabilityAndReplay)$', '-count=1'], path.join(ccGatewayRoot, 'sidecar/egress-tls-sidecar'), env)
  run('go', ['test', './internal/service', '-run', 'TestOracleContract(Canonical|Admission|Authority|CrossProject)$', '-count=1'], path.join(sub2apiRoot, 'backend'), env)
  return tsTests.length + 2
}

export function checkCrossRepoContract(input: { ccGatewayRoot: string; sub2apiRoot: string; runCommands: boolean }): CrossRepoContractResult {
  let shared
  try {
    shared = checkSharedContract({ ccGatewayRoot: input.ccGatewayRoot, sub2apiRoot: input.sub2apiRoot })
  } catch (error) {
    if (error instanceof SharedContractError) throw new CrossRepoContractError(error.code, error.message)
    throw error
  }
  const staticResult = validateStaticContract(input.ccGatewayRoot)
  const commandsRun = input.runCommands ? runFixtureCommands(input.ccGatewayRoot, input.sub2apiRoot) : 0
  return { ok: true, bundleDigest: shared.bundleDigest, schemaRange: staticResult.schemaRange, fixtureCases: staticResult.fixtureCases, commandsRun }
}

function argument(name: string): string | undefined {
  const position = process.argv.indexOf(name)
  return position === -1 ? undefined : process.argv[position + 1]
}

function runCli(): void {
  if (!process.argv.includes('--check')) throw new CrossRepoContractError('contract_cli_usage', 'usage: check-cross-repo.ts --sub2api-root PATH [--cc-gateway-root PATH] --check')
  const sub2apiRoot = argument('--sub2api-root')
  if (!sub2apiRoot) throw new CrossRepoContractError('contract_cli_usage', '--sub2api-root is required')
  console.log(JSON.stringify(checkCrossRepoContract({ ccGatewayRoot: path.resolve(argument('--cc-gateway-root') ?? process.cwd()), sub2apiRoot: path.resolve(sub2apiRoot), runCommands: true })))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    runCli()
  } catch (error) {
    const typed = error instanceof CrossRepoContractError ? error : new CrossRepoContractError('contract_check_failed', (error as Error).message)
    console.error(JSON.stringify({ code: typed.code, message: typed.message }))
    process.exitCode = 1
  }
}
