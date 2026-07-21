import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalJson, Phase3AError, sha256Bytes, sha256File } from './core.js'

type Bound = { sha256: string; [key: string]: any }
type Inputs = { probe: Bound; environment: Bound; saturation: Bound; scenario: Bound; config: Bound; auth_primary: Bound; auth_supplement: Bound }
function fail(code: string, message: string): never { throw new Phase3AError(code, message) }

export function buildR2CoverageClosure(inputs: Inputs): Record<string, any> {
  if (inputs.probe.status !== 'PASS') fail('r2_probe_incomplete', 'instrumentation probe is not PASS')
  if (!['PASS', 'CLOSED_WITH_UNKNOWN'].includes(inputs.environment.status) || inputs.environment.pair_count !== 60) fail('r2_environment_incomplete', 'environment closure must contain 60 classified pairs')
  if (inputs.saturation.status !== 'SATURATED' || inputs.saturation.consecutive_no_new_batches !== 3) fail('r2_saturation_incomplete', 'saturation closure must contain three no-new batches')
  if (inputs.scenario.status !== 'PASS' || inputs.scenario.pair_count !== 9) fail('r2_scenario_incomplete', 'scenario closure must contain nine PASS pairs')
  if (inputs.config.statuses?.REPRODUCED !== 4) fail('r2_config_incomplete', 'config precedence must contain four reproduced pairs')
  if (inputs.auth_primary.statuses?.REPRODUCED !== 3 || inputs.auth_supplement.statuses?.REPRODUCED !== 1) fail('r2_auth_incomplete', 'auth lifecycle must contain four reproduced pairs across primary and supplement')
  for (const bound of Object.values(inputs)) if (!/^[a-f0-9]{64}$/.test(bound.sha256)) fail('r2_binding_invalid', 'R2 input binding must be SHA-256')
  const coverage = [
    { hypothesis: 'instrumentation-equivalence', evidence_level: 'Reproduced', source: 'probe' },
    inputs.environment.status === 'PASS'
      ? { hypothesis: 'environment-routing-and-provider-selection', evidence_level: 'Reproduced', source: 'environment+saturation' }
      : { hypothesis: 'environment-routing-and-provider-selection', evidence_level: 'Unknown', reason: `${String(inputs.environment.statuses?.UNKNOWN ?? 0)} matrix pairs lacked complete protocol observation`, next_minimal_action: 'Route default API and empty socket arms through a loopback protocol observer, then rerun only the three unresolved pairs.' },
    { hypothesis: 'config-precedence-and-phase-split', evidence_level: 'Reproduced', source: 'config' },
    { hypothesis: 'placeholder-auth-initialization-rotation-coexistence-and-missing', evidence_level: 'Reproduced', source: 'auth' },
    { hypothesis: 'http-failure-reset-and-terminal-outcomes', evidence_level: 'Reproduced', source: 'scenario' },
    { hypothesis: 'partial-and-complete-sse-topology', evidence_level: 'Reproduced', source: 'scenario' },
    { hypothesis: 'request-cache-control-surface', evidence_level: 'Reproduced', source: 'environment+observer' },
    { hypothesis: 'compact-and-prompt-cache-lifecycle', evidence_level: 'Unknown', reason: 'bounded prompts did not trigger a positive compact/cache lifecycle', next_minimal_action: 'Run a bounded multi-turn long-context session against the fake upstream and stop after the first compact or cache transition.' },
    { hypothesis: 'telemetry-diagnostic-update-error-traffic', evidence_level: 'Unknown', reason: 'nonessential traffic was negative under the hermetic command profile; positive branches were not triggered', next_minimal_action: 'Invoke one bounded diagnostic or update command with nonessential traffic enabled and all destinations mapped to loopback.' },
    { hypothesis: 'restart-resume-and-child-process-lineage', evidence_level: 'Unknown', reason: 'fresh-process isolation observed launch lineage but did not trigger a resume/restart workflow', next_minimal_action: 'Create one synthetic session, restart in a fresh process, resume by safe session reference, and compare process lineage.' },
  ]
  const coverageCounts = coverage.reduce<Record<string, number>>((counts, row) => { counts[row.evidence_level] = (counts[row.evidence_level] ?? 0) + 1; return counts }, {})
  const base = { schema_version: 'oracle-lab-phase3a-r2-closure.v1', status: 'CLOSED_WITH_UNKNOWN', inputs, coverage_counts: coverageCounts, coverage, external_socket_budget: 0, raw_material_persisted: false }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
function bound(file: string): Bound { return { ...(JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>), sha256: sha256File(file) } }
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const names = ['probe', 'environment', 'saturation', 'scenario', 'config', 'auth-primary', 'auth-supplement', 'out']
  const values = Object.fromEntries(names.map((name) => [name, argument(`--${name}`)]))
  if (names.some((name) => !values[name])) fail('usage', 'r2-closure requires seven input summaries and --out')
  const result = buildR2CoverageClosure({ probe: bound(values.probe!), environment: bound(values.environment!), saturation: bound(values.saturation!), scenario: bound(values.scenario!), config: bound(values.config!), auth_primary: bound(values['auth-primary']!), auth_supplement: bound(values['auth-supplement']!) })
  writeFileSync(values.out!, `${canonicalJson(result)}\n`, { flag: 'wx', mode: 0o600 }); process.stdout.write(`${canonicalJson(result)}\n`)
}
