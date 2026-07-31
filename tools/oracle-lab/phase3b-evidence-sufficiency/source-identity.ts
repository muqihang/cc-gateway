import { fileURLToPath } from 'node:url'

import { Phase3BProductionError, sha256Canonical } from './core.js'
import { TARGET_PROFILE } from './ledger.js'
import { stableRead, type StableFileIdentity } from './sealed-fs.js'

const CONTROLLER_SOURCES = ['core.ts', 'sealed-fs.ts', 'trust.ts', 'github-web-flow.gpg', 'github-web-flow-keyring.gpg', 'github-web-flow-keyring.kbx', 'github-web-flow-gnupg/pubring.kbx', 'github-web-flow-gpgv', 'authority-materializer.ts', 'authority-materializer-cli.ts', 'ephemeral-signer.ts', 'requirements-signer-session-cli.ts', 'security-reviewer-session-cli.ts', 'pre-epoch-admission-cli.ts', 'pre-epoch-admission.ts', 'sandbox-policy.ts', 'route-policy.ts', 'source-identity.ts', 'ledger.ts', '../../../docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-normalized-safe-evidence-sufficiency-supplement.md', 'controller.ts', 'launch-image.ts', 'launch-authority.ts', 'execution-store.ts', 'receiver.ts', 'scenario-input.ts', 'spawn-adapter.ts', 'campaign-controller.ts', 'closeout.ts', 'gates.ts', 'campaign.ts', 'operator-decision.ts'] as const

export function controllerSourceSetSha256(): string {
  return sha256Canonical(CONTROLLER_SOURCES.map((name) => ({ name, sha256: stableRead(fileURLToPath(new URL(`./${name}`, import.meta.url)), { maximumBytes: 2_097_152 }).identity.sha256 })))
}

export const RUNTIME_EXECUTABLE_MAXIMUM_BYTES = TARGET_PROFILE.maximum_executable_bytes

export function runtimeExecutableIdentity(executable = process.execPath): StableFileIdentity {
  return stableRead(executable, { mode: 0o755, maximumBytes: RUNTIME_EXECUTABLE_MAXIMUM_BYTES }).identity
}

export function runtimeExecutableIdentitySha256(executable = process.execPath): string {
  return sha256Canonical(runtimeExecutableIdentity(executable))
}

export function assertRuntimeExecutableIdentity(expectedIdentitySha256: string, executable = process.execPath): void {
  if (!/^[a-f0-9]{64}$/.test(expectedIdentitySha256) || runtimeExecutableIdentitySha256(executable) !== expectedIdentitySha256) throw new Phase3BProductionError('controller_identity_invalid', 'runtime executable identity drifted')
}

export function controllerExecutableSha256(): string {
  return runtimeExecutableIdentity().sha256
}
