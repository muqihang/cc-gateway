#!/usr/bin/env node
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertExternalMatchesSealed, runExecuteFromExternalSealedPrelaunch, runPrelaunchOnly } from './campaign-controller.js'
import { deriveCuration, runCloseout } from './closeout.js'
import { Phase3BProductionError, canonicalJson } from './core.js'
import { evaluateGateA, writeGateB } from './gates.js'

const MODES = ['prelaunch-only', 'execute-from-sealed-prelaunch', 'closeout-only', 'evaluate-gate-a', 'evaluate-gate-b'] as const
type Mode = typeof MODES[number]

function parseArguments(argv: readonly string[]): Record<string, string> {
  if (argv.length === 0 || argv.length % 2 !== 0) throw new Phase3BProductionError('runner_cli_invalid', 'arguments must be closed --name value pairs')
  const result: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key.startsWith('--') || key === '--' || !value || Object.hasOwn(result, key.slice(2))) throw new Phase3BProductionError('runner_cli_invalid', 'unknown, missing, or duplicate argument')
    result[key.slice(2)] = value
  }
  return result
}

function exactKeys(value: Record<string, string>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Phase3BProductionError('runner_cli_invalid', 'mode arguments are missing or unknown')
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArguments(argv)
  const mode = args.mode as Mode
  if (!(MODES as readonly string[]).includes(mode)) throw new Phase3BProductionError('runner_cli_invalid', 'campaign mode is invalid')
  const common = ['mode', 'operator-authority', 'campaign-input', 'evidence-root']
  exactKeys(args, mode === 'evaluate-gate-b' ? [...common, 'operator-decision'] : common)
  const authorityPath = path.resolve(args['operator-authority'])
  const inputPath = path.resolve(args['campaign-input'])
  const evidenceRoot = path.resolve(args['evidence-root'])
  let result: Readonly<Record<string, unknown>>
  if (mode === 'prelaunch-only') result = runPrelaunchOnly(authorityPath, inputPath, evidenceRoot)
  else if (mode === 'execute-from-sealed-prelaunch') result = await runExecuteFromExternalSealedPrelaunch(evidenceRoot, authorityPath, inputPath)
  else {
    assertExternalMatchesSealed(evidenceRoot, authorityPath, inputPath)
    if (mode === 'closeout-only') { const curation = deriveCuration(evidenceRoot); result = { curation, closeout: runCloseout(evidenceRoot) } }
    else if (mode === 'evaluate-gate-a') result = evaluateGateA(evidenceRoot)
    else {
      const expected = path.join(evidenceRoot, 'capsules/P3B-ES1/gates/successor-amendment-decision.json')
      if (path.resolve(args['operator-decision']) !== expected) throw new Phase3BProductionError('fixed_path_invalid', 'Gate B operator decision path is fixed')
      result = writeGateB(evidenceRoot)
    }
  }
  process.stdout.write(`${canonicalJson(result)}\n`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Phase3BProductionError ? error.code : 'phase3b_campaign_failed'}\n`)
    process.exitCode = 1
  })
}
