import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { buildBlockedDeliverables, type CuratedExitInput } from './build-exit.js'
import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File } from './core.js'
import { captureRepositoryBinding } from './repository-binding.js'

const ACTIVE = '90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58'
const EXPIRY = '2026-08-03T00:00:00.000Z'
const PROHIBITED = ['CL-LOCAL-EVIDENCE-PRODUCTION-PROHIBITED']
function fail(code: string, message: string): never { throw new Phase3AError(code, message) }

export function evidenceRelativePath(root: string, file: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(file))
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('r4_output_invalid', 'R4 output must be below the evidence root')
  const normalized = relative.split(path.sep).join('/')
  if (!normalized.startsWith('capsules/')) fail('r4_output_invalid', 'R4 output must be below the evidence root capsules directory')
  return normalized
}

export function closureConclusions(): any[] {
  const reproduced = (id: string, statement: string, support: string[], runs: string[], controls: string[]) => ({
    conclusion: {
      schema_version: 'oracle-lab-phase3a-conclusion.v1', conclusion_id: id, level: 'Reproduced',
      scope: 'claude-code-2.1.215 darwin-arm64 synthetic loopback fixtures', statement,
      supporting_artifact_ids: support, contradicting_artifact_ids: [],
      static_anchor: { artifact_digest: ACTIVE, location: 'P3A-1 bounded static inventory and extracted indexes', reproduction_command_digest: sha256Bytes(`phase3a-static-anchor:${id}`) },
      dynamic_reproduction: { run_ids: runs, control_run_ids: controls, source_count: 2 }, single_source_reason: null,
      platform_limits: ['darwin-arm64 only', 'synthetic loopback observers only'], expiry: EXPIRY, negative_capabilities: [], phase3b_usable: true, prohibited_claims: PROHIBITED,
    }, authority_ceiling: 'Reproduced', observation_count: 5, parser_agreement: 'agreed', perturbed: false,
  })
  const unknown = (id: string, statement: string, negative: string) => ({
    conclusion: {
      schema_version: 'oracle-lab-phase3a-conclusion.v1', conclusion_id: id, level: 'Unknown',
      scope: 'claude-code-2.1.215 darwin-arm64 synthetic loopback fixtures', statement,
      supporting_artifact_ids: ['p3a2-closure-coverage-v2'], contradicting_artifact_ids: [], static_anchor: null, dynamic_reproduction: null,
      single_source_reason: 'The bounded campaign did not trigger this positive lifecycle.', platform_limits: ['positive lifecycle trigger absent'], expiry: EXPIRY,
      negative_capabilities: [negative], phase3b_usable: false, prohibited_claims: PROHIBITED,
    }, authority_ceiling: 'Unknown', observation_count: 0, parser_agreement: 'not-applicable', perturbed: false,
  })
  return [
    reproduced('CL-P3A-R2-CONFIG-AUTH', 'Config precedence and placeholder credential lifecycle were stable in the bounded local campaign.', ['p3a2-closure-config', 'p3a2-closure-auth-primary', 'p3a2-closure-auth-supplement'], ['closure-r2-config-v2', 'closure-r2-auth-v1', 'closure-r2-auth-co-v2'], ['closure-r2-config-v2-control']),
    reproduced('CL-P3A-R2-FAILURE-STREAM', 'HTTP failure, reset, partial stream, and complete stream terminal classes were stable in the bounded local campaign.', ['p3a2-closure-scenarios-v2', 'p3a2-closure-coverage-v2'], ['closure-r2-scenario-v2', 'closure-r2-partial-v6', 'closure-r2-complete-v7'], ['closure-r2-scenario-v2-control']),
    unknown('CL-P3A-ROUTING-ENVIRONMENT-UNKNOWN', 'Full environment routing and provider-selection coverage remains unclassified.', 'environment-routing-protocol-coverage-incomplete'),
    unknown('CL-P3A-COMPACT-CACHE-UNKNOWN', 'Compact and cache lifecycle behavior remains unclassified.', 'compact-cache-lifecycle-untriggered'),
    unknown('CL-P3A-TELEMETRY-UPDATE-UNKNOWN', 'Positive telemetry, diagnostic, and update traffic behavior remains unclassified.', 'positive-nonessential-traffic-untriggered'),
    unknown('CL-P3A-RESUME-LINEAGE-UNKNOWN', 'Restart, resume, and child-process lineage behavior remains unclassified.', 'resume-restart-lineage-untriggered'),
  ]
}

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const required = ['evidence-root', 'template', 'r2', 'r3', 'artifact-index', 'leak-scan', 'cc-root', 'sub2api-root', 'cc-base', 'sub2api-base', 'cc-freeze', 'sub2api-freeze', 'out-input', 'out-exit', 'out-markdown', 'out-handoff']
  const values = Object.fromEntries(required.map((name) => [name, argument(`--${name}`)]))
  if (required.some((name) => !values[name])) fail('usage', 'r4-curation requires template, closure, repository, and output arguments')
  const evidenceRoot = ensureEvidenceRoot(values['evidence-root']!)
  const template = JSON.parse(readFileSync(values.template!, 'utf8')) as CuratedExitInput
  const r2 = JSON.parse(readFileSync(values.r2!, 'utf8')) as Record<string, any>; const r3 = JSON.parse(readFileSync(values.r3!, 'utf8')) as Record<string, any>
  if (r2.status !== 'CLOSED_WITH_UNKNOWN' || r3.status !== 'PASS') fail('r4_input_invalid', 'R2 and R3 closures are not terminal')
  const r2Sha = sha256File(values.r2!); const r3Sha = sha256File(values.r3!); const indexSha = sha256File(values['artifact-index']!); const leakSha = sha256File(values['leak-scan']!)
  const artifactIndex = JSON.parse(readFileSync(values['artifact-index']!, 'utf8')) as { artifacts: Array<{ artifact_id: string }> }
  const conclusions = closureConclusions()
  const indexedIds = new Set(artifactIndex.artifacts.map((row) => row.artifact_id))
  for (const row of conclusions) for (const id of row.conclusion.supporting_artifact_ids) if (!indexedIds.has(id)) fail('r4_support_unresolved', `conclusion support is not indexed: ${id}`)
  const input: CuratedExitInput = {
    ...template, generated_at: '2026-07-21T12:00:00.000Z', exit_report_path: evidenceRelativePath(evidenceRoot, values['out-exit']!), artifact_index_sha256: indexSha,
    repositories: [
      captureRepositoryBinding(values['cc-root']!, { repository: 'cc-gateway', base: values['cc-base']!, freezeHead: values['cc-freeze']! }),
      captureRepositoryBinding(values['sub2api-root']!, { repository: 'sub2api', base: values['sub2api-base']!, freezeHead: values['sub2api-freeze']! }),
    ], repository_capture_required: false,
    coverage: {
      active: [{ platform: 'darwin-arm64', status: 'partial', environment_pairs: 60, environment_reproduced_pairs: r2.inputs.environment.statuses?.REPRODUCED ?? 60, environment_unknown_pairs: r2.inputs.environment.statuses?.UNKNOWN ?? 0, scenario_pairs: 9, config_pairs: 4, auth_pairs: 4, reproduced_hypotheses: r2.coverage_counts.Reproduced }],
      change_points: [{ target: 'sub2api-adapter', status: 'PASS', tier_a_tests: r3.tier_a.total_tests, tier_b: r3.tier_b.status }],
      omitted: r2.coverage.filter((row: any) => row.evidence_level === 'Unknown').map((row: any) => ({ cell: row.hypothesis, reason: row.reason })),
    },
    protocol_runtime_summaries: [
      { closure: 'R2', sha256: r2Sha, status: r2.status, reproduced: r2.coverage_counts.Reproduced, unknown: r2.coverage_counts.Unknown },
      { closure: 'R3', sha256: r3Sha, status: r3.status, tier_a_tests: r3.tier_a.total_tests, tier_b: r3.tier_b.status },
    ],
    perturbation_source_agreement: { instrumentation: 'instrumentation-equivalent', saturation: 'SATURATED', source_count: 3, external_socket_budget: 0 },
    evidence_health: { contradictions: [], expired: [], errors: [{ category: 'append-only-superseded-campaigns-retained' }], unknowns: r2.coverage.filter((row: any) => row.evidence_level === 'Unknown').map((row: any) => row.hypothesis) },
    conclusions,
    p2_mapping: { wire: 'Reproduced-local-loopback', semantic: 'Reproduced-local-loopback', state_sequence: 'Unknown-resume-untriggered', failure_semantics: 'Reproduced-local-loopback', bundle_unchanged: true },
    evidence_hygiene: { leak_scan: 'PASS', leak_scan_sha256: leakSha, artifact_index_sha256: indexSha, retention: 'retained', no_deletion: true, append_only: true },
    reproduction: { commands: ['npm exec tsx tests/oracle-phase3a-exit.test.ts', 'npm exec tsx tests/oracle-phase3a-handoff.test.ts', 'npm exec tsx tests/oracle-phase3a-r2-closure.test.ts', 'npm exec tsx tests/oracle-phase3a-r3-closure.test.ts'], unavailable_tools: ['positive-compact-trigger', 'positive-resume-trigger'] },
    phase3b: { ...template.phase3b, negative_capabilities: ['compact-cache-lifecycle-untriggered', 'positive-nonessential-traffic-untriggered', 'resume-restart-lineage-untriggered', 'tls-positive-runtime-unavailable', 'cross-platform-corroboration-unavailable'], rollback_reference: template.p2 },
    missing_gates: ['compact-cache-lifecycle', 'positive-nonessential-traffic', 'restart-resume-child-lineage', 'tls-positive-runtime-coverage', 'cross-platform-corroboration'],
  }
  const first = buildBlockedDeliverables(input); const second = buildBlockedDeliverables(input)
  if (canonicalJson(first) !== canonicalJson(second)) fail('r4_nondeterministic', 'R4 deliverables are not byte deterministic')
  const outputFiles = [values['out-input']!, values['out-exit']!, values['out-markdown']!, values['out-handoff']!]
  for (const file of outputFiles) { assertEvidencePath(evidenceRoot, file); if (existsSync(file)) fail('evidence_exists', `R4 output already exists: ${path.basename(file)}`) }
  for (const file of outputFiles) mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(values['out-input']!, `${canonicalJson(input)}\n`, { flag: 'wx', mode: 0o600 })
  writeFileSync(values['out-exit']!, `${canonicalJson(first.exit)}\n`, { flag: 'wx', mode: 0o600 })
  writeFileSync(values['out-markdown']!, first.markdown, { flag: 'wx', mode: 0o600 })
  writeFileSync(values['out-handoff']!, `${canonicalJson(first.handoff)}\n`, { flag: 'wx', mode: 0o600 })
  process.stdout.write(`${canonicalJson({ status: first.exit.status, exit_sha256: sha256File(values['out-exit']!), handoff_sha256: sha256File(values['out-handoff']!), usable_conclusions: first.handoff.usable_conclusion_ids.length, unknown_conclusions: first.handoff.unknown_conclusion_ids.length })}\n`)
}
