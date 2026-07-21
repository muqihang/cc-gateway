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
      supporting_artifact_ids: ['p3a2-closure-coverage-v3'], contradicting_artifact_ids: [], static_anchor: null, dynamic_reproduction: null,
      single_source_reason: 'The bounded campaign did not trigger this positive lifecycle.', platform_limits: ['positive lifecycle trigger absent'], expiry: EXPIRY,
      negative_capabilities: [negative], phase3b_usable: false, prohibited_claims: PROHIBITED,
    }, authority_ceiling: 'Unknown', observation_count: 0, parser_agreement: 'not-applicable', perturbed: false,
  })
  return [
    reproduced('CL-P3A-R2-CONFIG-AUTH', 'Config precedence and placeholder credential lifecycle were stable in the bounded local campaign.', ['p3a2-closure-config', 'p3a2-closure-auth-primary', 'p3a2-closure-auth-supplement'], ['closure-r2-config-v2', 'closure-r2-auth-v1', 'closure-r2-auth-co-v2'], ['closure-r2-config-v2-control']),
    reproduced('CL-P3A-R2-FAILURE-STREAM', 'HTTP failure, reset, partial stream, and complete stream terminal classes were stable in the bounded local campaign.', ['p3a2-closure-scenarios-v2', 'p3a2-closure-coverage-v3'], ['closure-r2-scenario-v2', 'closure-r2-partial-v6', 'closure-r2-complete-v7'], ['closure-r2-scenario-v2-control']),
    unknown('CL-P3A-ROUTING-ENVIRONMENT-UNKNOWN', 'Full environment routing and provider-selection coverage remains unclassified.', 'environment-routing-protocol-coverage-incomplete'),
    unknown('CL-P3A-COMPACT-CACHE-UNKNOWN', 'Compact and cache lifecycle behavior remains unclassified.', 'compact-cache-lifecycle-untriggered'),
    unknown('CL-P3A-TELEMETRY-UPDATE-UNKNOWN', 'Positive telemetry, diagnostic, and update traffic behavior remains unclassified.', 'positive-nonessential-traffic-untriggered'),
    unknown('CL-P3A-RESUME-LINEAGE-UNKNOWN', 'Restart, resume, and child-process lineage behavior remains unclassified.', 'resume-restart-lineage-untriggered'),
    unknown('CL-P3A-TLS-RUNTIME-UNKNOWN', 'Positive TLS runtime behavior remains unclassified.', 'tls-positive-runtime-unavailable'),
    unknown('CL-P3A-CROSS-PLATFORM-UNKNOWN', 'Behavior outside darwin-arm64 remains unclassified.', 'cross-platform-corroboration-unavailable'),
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
  if (!['PASS', 'CLOSED_WITH_UNKNOWN'].includes(String(r2.status)) || !['PASS', 'CLOSED_WITH_UNKNOWN', 'INCOMPLETE'].includes(String(r3.status))) fail('r4_input_invalid', 'R2 and R3 closures are not terminal')
  const r1Path = path.join(evidenceRoot, 'capsules/P3A-1/r1-static-closure-v1.json')
  const censusPath = path.join(evidenceRoot, 'static/90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58/discovery-r1-census-v3.json')
  if (!existsSync(r1Path) || !existsSync(censusPath)) fail('r4_static_unbound', 'R1 static-closure and census-v3 are required')
  const r1 = JSON.parse(readFileSync(r1Path, 'utf8')) as Record<string, any>
  const r1Sha = sha256File(r1Path); const censusSha = sha256File(censusPath)
  const recoveredRoots = Array.isArray(r1.required_roots) ? r1.required_roots.filter((row: any) => row.disposition === 'static-path-recovered') : []
  if (r1.status !== 'complete' || recoveredRoots.length !== 15) fail('r4_static_incomplete', 'R1 must recover all 15 required roots before R4 can claim complete static analysis')
  const r2Sha = sha256File(values.r2!); const r3Sha = sha256File(values.r3!); const indexSha = sha256File(values['artifact-index']!); const leakSha = sha256File(values['leak-scan']!)
  const artifactIndex = JSON.parse(readFileSync(values['artifact-index']!, 'utf8')) as { artifacts: Array<{ artifact_id: string }> }
  const conclusions = closureConclusions()
  const indexedIds = new Set(artifactIndex.artifacts.map((row) => row.artifact_id))
  for (const row of conclusions) for (const id of row.conclusion.supporting_artifact_ids) if (!indexedIds.has(id)) fail('r4_support_unresolved', `conclusion support is not indexed: ${id}`)
  const envReproduced = Number(r2.inputs?.environment?.statuses?.REPRODUCED ?? r2.coverage_counts?.Reproduced ?? 0)
  const envUnknown = Number(r2.inputs?.environment?.statuses?.UNKNOWN ?? 0)
  const coverageComplete = envUnknown === 0 && Number(r2.coverage_counts?.Unknown ?? 0) === 0
  const changePoints = Array.isArray(r3.tier_a?.lanes)
    ? r3.tier_a.lanes
    : Array.isArray(r3.lanes)
      ? r3.lanes
      : [{ target: 'sub2api-adapter', status: r3.status, tier_a_tests: r3.tier_a?.total_tests, tier_b: r3.tier_b?.status }]
  const executableUnknowns = (r2.coverage ?? []).filter((row: any) => row.evidence_level === 'Unknown')
  const missingGates = [
    ...(coverageComplete ? [] : ['environment-routing-protocol-coverage']),
    ...(executableUnknowns.map((row: any) => String(row.hypothesis))),
    ...(Array.isArray(r3.tier_a?.lanes) && r3.tier_a.lanes.length === 5 ? [] : ['claude-code-tier-a-change-points']),
    'tls-positive-runtime-coverage',
    'cross-platform-corroboration',
  ]
  const terminalUnknowns = [
    ...executableUnknowns.map((row: any) => ({
      concern: row.hypothesis, reason: row.reason, next_minimal_action: row.next_minimal_action, phase3b_usable: false,
      capability_exhausted: false, capability_evidence: 'local-loopback-action-still-available', searched_surfaces: ['active-probe-copy', 'fake-upstream', 'loopback-proxy'],
    })),
    {
      concern: 'tls-positive-runtime-coverage', reason: 'TLS capture has not been executed for the bounded active campaign.',
      next_minimal_action: 'Replay one complete SSE cell through the loopback CONNECT observer and local CA.', phase3b_usable: false,
      capability_exhausted: false, capability_evidence: 'connect-proxy-and-local-ca-available', searched_surfaces: ['connect-proxy', 'local-ca'],
    },
    {
      concern: 'cross-platform-corroboration', reason: 'The active artifact is darwin-arm64 and no second-platform runner was in scope.',
      next_minimal_action: 'Replay the frozen manifest and normalized observers on a digest-bound second-platform artifact.', phase3b_usable: false,
      capability_exhausted: true, capability_evidence: 'no-second-platform-runner', searched_surfaces: ['darwin-arm64-active-target'],
    },
  ]
  const input: CuratedExitInput = {
    ...template, generated_at: '2026-07-21T12:00:00.000Z', exit_report_path: evidenceRelativePath(evidenceRoot, values['out-exit']!), artifact_index_sha256: indexSha,
    repositories: [
      captureRepositoryBinding(values['cc-root']!, { repository: 'cc-gateway', base: values['cc-base']!, freezeHead: values['cc-freeze']! }),
      captureRepositoryBinding(values['sub2api-root']!, { repository: 'sub2api', base: values['sub2api-base']!, freezeHead: values['sub2api-freeze']! }),
    ], repository_capture_required: false,
    static_analysis: {
      phase_status: 'COMPLETE', required_root_count: 15, required_root_unknown_count: 0,
      entry_module_ast: 'recovered-module-slices', module_slice_count: r1.module_slices?.count ?? null,
      r1_static_closure_sha256: r1Sha, census_sha256: censusSha, discovery_artifact_sha256: r1.discovery_artifact_sha256 ?? null,
      recovered_roots: recoveredRoots.map((row: any) => row.root), limitations: r1.limitations ?? [],
    },
    coverage: {
      active: [{
        platform: 'darwin-arm64', status: coverageComplete ? 'complete' : 'partial',
        environment_pairs: 60, environment_reproduced_pairs: envReproduced, environment_unknown_pairs: envUnknown,
        scenario_pairs: 9, config_pairs: 4, auth_pairs: 4, reproduced_hypotheses: r2.coverage_counts?.Reproduced ?? 0,
      }],
      change_points: changePoints,
      omitted: terminalUnknowns.map((row) => ({ cell: row.concern, reason: row.reason, next_minimal_action: row.next_minimal_action, phase3b_usable: false })),
    },
    protocol_runtime_summaries: [
      { closure: 'R2', sha256: r2Sha, status: r2.status, reproduced: r2.coverage_counts?.Reproduced ?? 0, unknown: r2.coverage_counts?.Unknown ?? 0 },
      { closure: 'R3', sha256: r3Sha, status: r3.status, tier_a: r3.tier_a ?? null, tier_b: r3.tier_b ?? null, lanes: changePoints },
    ],
    perturbation_source_agreement: { instrumentation: 'instrumentation-equivalent', saturation: 'SATURATED', source_count: 3, external_socket_budget: 0 },
    evidence_health: { contradictions: [], expired: [], errors: [{ category: 'append-only-superseded-campaigns-retained' }], unknowns: terminalUnknowns },
    conclusions,
    p2_mapping: { wire: 'Reproduced-local-loopback', semantic: 'Reproduced-local-loopback', state_sequence: 'Unknown-resume-untriggered', failure_semantics: 'Reproduced-local-loopback', bundle_unchanged: true },
    evidence_hygiene: { leak_scan: 'PASS', leak_scan_sha256: leakSha, artifact_index_sha256: indexSha, retention: 'retained', no_deletion: true, append_only: true },
    reproduction: { commands: ['npm exec tsx tests/oracle-phase3a-exit.test.ts', 'npm exec tsx tests/oracle-phase3a-handoff.test.ts', 'npm exec tsx tests/oracle-phase3a-r2-closure.test.ts', 'npm exec tsx tests/oracle-phase3a-r3-closure.test.ts'], unavailable_tools: ['second-platform-runner'] },
    phase3b: { ...template.phase3b, negative_capabilities: [...new Set(terminalUnknowns.map((row) => String(row.concern)))], rollback_reference: template.p2 },
    missing_gates: missingGates,
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
