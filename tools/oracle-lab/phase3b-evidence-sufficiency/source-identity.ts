import { fileURLToPath } from 'node:url'

import { sha256Canonical } from './core.js'
import { stableRead } from './sealed-fs.js'

const CONTROLLER_SOURCES = ['core.ts', 'sealed-fs.ts', 'trust.ts', 'github-web-flow.gpg', 'github-web-flow-keyring.gpg', 'github-web-flow-keyring.kbx', 'github-web-flow-gnupg/pubring.kbx', 'github-web-flow-gpgv', 'authority-materializer.ts', 'authority-materializer-cli.ts', 'ephemeral-signer.ts', 'requirements-signer-session-cli.ts', 'sandbox-policy.ts', 'route-policy.ts', 'source-identity.ts', 'ledger.ts', '../../../docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-normalized-safe-evidence-sufficiency-supplement.md', 'controller.ts', 'launch-image.ts', 'launch-authority.ts', 'execution-store.ts', 'receiver.ts', 'scenario-input.ts', 'spawn-adapter.ts', 'campaign-controller.ts', 'closeout.ts', 'gates.ts', 'campaign.ts', 'operator-decision.ts', 'production-executor.ts'] as const

export function controllerSourceSetSha256(): string {
  return sha256Canonical(CONTROLLER_SOURCES.map((name) => ({ name, sha256: stableRead(fileURLToPath(new URL(`./${name}`, import.meta.url)), { maximumBytes: 2_097_152 }).identity.sha256 })))
}

export function controllerExecutableSha256(): string {
  return stableRead(process.execPath, { maximumBytes: 134_217_728 }).identity.sha256
}
