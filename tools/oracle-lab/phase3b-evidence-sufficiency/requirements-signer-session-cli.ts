#!/usr/bin/env node
import readline from 'node:readline'

import { Phase3BProductionError, assertExactKeys, canonicalJson } from './core.js'
import { createRequirementsSignerSession } from './ephemeral-signer.js'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function main(): void {
  if (process.argv.length !== 8 || process.argv[2] !== '--identity' || process.argv[4] !== '--candidate-commit' || process.argv[6] !== '--candidate-tree') throw new Phase3BProductionError('requirements_signer_cli_invalid', 'fixed requirements signer arguments are required')
  const session = createRequirementsSignerSession({ identity: argument('--identity') ?? '', reviewed_candidate_commit: argument('--candidate-commit') ?? '', reviewed_candidate_tree: argument('--candidate-tree') ?? '' })
  process.stdout.write(`${canonicalJson({ event: 'public_entry', public_entry: session.public_entry })}\n`)
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false })
  lines.on('line', (line) => {
    try {
      const command = JSON.parse(line) as Record<string, unknown>
      if (command.action === 'bind_security_reviewer') {
        assertExactKeys(command, ['action', 'security_public_entry'], 'requirements_signer_cli_invalid')
        process.stdout.write(`${canonicalJson({ event: 'registry', registry: session.bind_security_reviewer(command.security_public_entry as never) })}\n`)
      } else if (command.action === 'sign_operator_authority') {
        assertExactKeys(command, ['action', 'campaign_input', 'signed_implementation_review', 'approval_commit', 'approval_tree', 'attestation_commit', 'attestation_tree', 'created_at_ms', 'expires_at_ms'], 'requirements_signer_cli_invalid')
        const signed = session.sign_operator_authority({ campaign_input: command.campaign_input as Record<string, unknown>, signed_implementation_review: command.signed_implementation_review as Record<string, unknown>, approval_commit: String(command.approval_commit), approval_tree: String(command.approval_tree), attestation_commit: String(command.attestation_commit), attestation_tree: String(command.attestation_tree), created_at_ms: Number(command.created_at_ms), expires_at_ms: Number(command.expires_at_ms) })
        process.stdout.write(`${canonicalJson({ event: 'operator_authority', ...signed })}\n`)
      } else if (command.action === 'sign_gate_b_decision') {
        assertExactKeys(command, ['action', 'payload'], 'requirements_signer_cli_invalid')
        process.stdout.write(`${canonicalJson({ event: 'gate_b_decision', signed_decision: session.sign_gate_b_decision(command.payload as Record<string, unknown>) })}\n`)
      } else if (command.action === 'confirm_gate_b_result') {
        assertExactKeys(command, ['action', 'evidence_root', 'result_path'], 'requirements_signer_cli_invalid')
        process.stdout.write(`${canonicalJson({ event: 'gate_b_confirmed', closure: session.confirm_gate_b_result({ evidence_root: String(command.evidence_root), result_path: String(command.result_path) }) })}\n`)
        lines.close()
      } else if (command.action === 'close') {
        assertExactKeys(command, ['action'], 'requirements_signer_cli_invalid')
        session.close()
        lines.close()
      } else throw new Phase3BProductionError('requirements_signer_cli_invalid', 'unknown requirements signer action')
    } catch (error) {
      session.close()
      process.stderr.write(`${error instanceof Phase3BProductionError ? error.code : 'requirements_signer_failed'}\n`)
      process.exitCode = 1
      lines.close()
    }
  })
  lines.on('close', () => session.close())
}

try { main() } catch (error) {
  process.stderr.write(`${error instanceof Phase3BProductionError ? error.code : 'requirements_signer_failed'}\n`)
  process.exitCode = 1
}
