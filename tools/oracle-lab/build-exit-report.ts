import { realpathSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { cli, parseArgs, readJson, requireValid } from './harness-core.js'
import { validateHandoffValue, type HandoffBundle } from './build-handoff-bundle.js'

export function buildExitReport(handoff: HandoffBundle): string {
  requireValid(validateHandoffValue(handoff, Date.now(), false))
  const lines = [
    '# Oracle Lab Phase 0 Exit Report', '',
    `- Phase: ${handoff.phase}`,
    `- Baseline digest: ${handoff.baseline_digest}`,
    `- Command results digest: ${handoff.command_results_digest}`,
    `- Generated: ${handoff.generated_at}`,
    `- Expires: ${handoff.expires_at}`, '',
    '## Observed Command Results', '',
    '| Command | Status | Result digest |',
    '| --- | --- | --- |',
    ...handoff.commands.map((command) => `| ${command.command_id} | ${command.status} | ${command.result_digest} |`), '',
    '## Repository Provenance', '',
    ...handoff.repositories.map((repository) => `- ${repository.name}: commit ${repository.commit}, dirty digest ${repository.dirty_digest}`), '',
    '## Known Unknowns', '',
    ...(handoff.known_unknowns.length ? handoff.known_unknowns.map((entry) => `- ${entry}`) : ['- None recorded']), '',
    '## Safe Artifact References', '',
    ...handoff.artifacts.map((artifact) => `- ${artifact.path} (${artifact.digest})`), '',
    'Raw stdout/stderr, credentials, prompts, request bodies, and unrestricted logs are intentionally excluded.',
  ]
  return `${lines.join('\n')}\n`
}

if (realpathSync(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) cli(() => {
  const args = parseArgs(process.argv.slice(2)); const handoff = args.values.handoff?.[0]; const out = args.values.out?.[0]
  if (!handoff || !out) throw Object.assign(new Error('--handoff and --out are required'), { code: 'invalid_arguments' })
  const value = readJson(handoff); requireValid(validateHandoffValue(value, Date.now(), false)); writeFileSync(out, buildExitReport(value as HandoffBundle), { mode: 0o600 })
})
