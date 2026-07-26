import { fileURLToPath } from 'node:url'

import { sha256Canonical } from './core.js'
import { stableRead } from './sealed-fs.js'

const CONTROLLER_SOURCES = ['core.ts', 'sealed-fs.ts', 'source-identity.ts', 'ledger.ts', 'controller.ts', 'launch-image.ts', 'launch-authority.ts', 'execution-store.ts', 'receiver.ts', 'scenario-input.ts', 'spawn-adapter.ts', 'campaign-controller.ts', 'closeout.ts', 'gates.ts', 'campaign.ts', 'operator-decision.ts', 'production-executor.ts'] as const

export function controllerSourceSetSha256(): string {
  return sha256Canonical(CONTROLLER_SOURCES.map((name) => ({ name, sha256: stableRead(fileURLToPath(new URL(`./${name}`, import.meta.url)), { maximumBytes: 2_097_152 }).identity.sha256 })))
}

export function controllerExecutableSha256(): string {
  return stableRead(process.execPath, { maximumBytes: 134_217_728 }).identity.sha256
}
