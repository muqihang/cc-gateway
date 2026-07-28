#!/usr/bin/env node
import readline from 'node:readline'

import { Phase3BProductionError, assertExactKeys, canonicalJson } from './core.js'
import { createSecurityReviewerSignerSession } from './ephemeral-signer.js'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function main(): void {
  if (process.argv.length !== 8 || process.argv[2] !== '--identity' || process.argv[4] !== '--candidate-commit' || process.argv[6] !== '--candidate-tree') throw new Phase3BProductionError('security_signer_cli_invalid', 'fixed security signer arguments are required')
  const session = createSecurityReviewerSignerSession({ identity: argument('--identity') ?? '', reviewed_candidate_commit: argument('--candidate-commit') ?? '', reviewed_candidate_tree: argument('--candidate-tree') ?? '' })
  process.stdout.write(`${canonicalJson({ event: 'public_entry', public_entry: session.public_entry })}\n`)
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false })
  lines.on('line', (line) => {
    try {
      const command = JSON.parse(line) as Record<string, unknown>
      if (command.action === 'sign_implementation_review') {
        assertExactKeys(command, ['action', 'registry', 'review_payload'], 'security_signer_cli_invalid')
        const signedReview = session.sign_implementation_review({ registry: command.registry as never, review_payload: command.review_payload as Record<string, unknown> })
        process.stdout.write(`${canonicalJson({ event: 'signed_implementation_review', signed_review: signedReview })}\n`)
        lines.close()
      } else if (command.action === 'close') {
        assertExactKeys(command, ['action'], 'security_signer_cli_invalid')
        session.close()
        lines.close()
      } else throw new Phase3BProductionError('security_signer_cli_invalid', 'unknown security signer action')
    } catch (error) {
      session.close()
      process.stderr.write(`${error instanceof Phase3BProductionError ? error.code : 'security_signer_failed'}\n`)
      process.exitCode = 1
      lines.close()
    }
  })
  lines.on('close', () => session.close())
}

try { main() } catch (error) {
  process.stderr.write(`${error instanceof Phase3BProductionError ? error.code : 'security_signer_failed'}\n`)
  process.exitCode = 1
}
