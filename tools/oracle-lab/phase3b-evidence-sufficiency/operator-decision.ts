#!/usr/bin/env node
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { Phase3BProductionError, canonicalJson } from './core.js'
import { issueOperatorDecisionFromTty } from './gates.js'

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  if (argv.length !== 2 || argv[0] !== '--evidence-root') throw new Phase3BProductionError('runner_cli_invalid', 'usage: operator-decision --evidence-root FIXED_ROOT')
  const decision = await issueOperatorDecisionFromTty(path.resolve(argv[1]))
  process.stdout.write(`${canonicalJson({ decision_sha256: decision.decision_sha256 })}\n`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Phase3BProductionError ? error.code : 'phase3b_operator_decision_failed'}\n`)
    process.exitCode = 1
  })
}
