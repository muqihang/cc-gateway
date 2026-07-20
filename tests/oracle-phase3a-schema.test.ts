import assert from 'node:assert/strict'

import { canonicalJson } from '../tools/oracle-lab/phase3a/core.js'
import { validatePhase3A } from '../tools/oracle-lab/phase3a/schemas.js'

console.log('\ntests/oracle-phase3a-schema.test.ts')

const sha = 'a'.repeat(64)
const commit = 'b'.repeat(40)
const expiry = '2026-08-03T00:00:00.000Z'
const ids = ['HA-P1-001']

const launch: any = {
  schema_version: 'oracle-lab-phase3a-launch-manifest.v1', run_id: 'run-1', parent_run_id: null, pair_id: 'pair-1', sequence_index: 0, randomization_seed: 7,
  phase: '3A', requirement_ids: ids, hypothesis_id: 'hypothesis-1', evidence_level_ceiling: 'Observed',
  repositories: { cc_gateway: { commit, tree: commit, dirty_digest: sha }, sub2api: { commit, tree: commit, dirty_digest: sha } },
  contract: { bundle_id: 'oracle.compatibility.v1', bundle_sha256: sha, schema_range: '1:0-0', predecessor_sha256: sha },
  artifact: { package: '@anthropic-ai/claude-code', version: '2.1.215', registry_url: 'https://registry.npmjs.org/', archive_sha256: sha, tree_sha256: sha, entrypoint_sha256: sha },
  toolchain_digest: sha, platform: { os: 'darwin', release: '25.5.0', arch: 'arm64', runtime: 'native', virtualization: 'unknown' },
  command: { executable_sha256: sha, argv: ['--version'], cwd: 'runs/run-1', stdin_sha256: sha, timeout_ms: 30000 },
  environment: { allowlist: { PATH: '/usr/bin:/bin' }, explicit_empty: [], unset: ['ANTHROPIC_API_KEY'], home: 'runs/run-1/home', xdg: 'runs/run-1/xdg', tmp: 'runs/run-1/tmp', tz: 'UTC', lang: 'C', lc_all: 'C', base_urls: ['http://127.0.0.1:19001/'] },
  network: { policy: 'declared_loopback_only', loopback_ports: [19001], proxy_mode: 'none', ca_sha256: null, external_socket_budget: 0 },
  matrix: { changed_variable: 'TZ', control_value: 'UTC', treatment_value: 'Asia/Shanghai', fixed_variables: { locale: 'C' } },
  limits: { wall_ms: 30000, cpu_ms: 30000, rss_bytes: 536870912, output_bytes: 1048576, processes: 4, retries: 0, sockets: 8, files: 1024 },
  capture: { hook: false, inspector: false, process: true, fs: true, network: true, tls: false, http: true, pcap: false, stdout: true, stderr: true },
  redaction_policy: 'oracle-lab-phase3a-redaction.v1', retention_class: 'synthetic-raw-14d', expiry, previous_manifest_sha256: null,
  preflight: { status: 'PASS', cc_head: commit, cc_tree: commit, sub2api_head: commit, sub2api_tree: commit, plan_sha256: sha, p2_bundle_sha256: sha, predecessor_sha256: sha, codegraph_current: true },
}

const artifactIndex: any = {
  schema_version: 'oracle-lab-phase3a-artifact-index.v1', generated_at: expiry, evidence_root_id: 'H3A-1', previous_index_sha256: null,
  artifacts: [{
    artifact_schema_version: 'oracle-lab-phase3a-artifact.v1', artifact_id: 'artifact-1', run_id: null, parent_artifact_ids: [], relative_path: 'intake/archive.tgz', media_type: 'application/gzip', byte_size: 1, sha256: sha,
    source_url: 'https://registry.npmjs.org/archive.tgz', generating_command_digest: sha, verification_command_digest: sha, toolchain_digest: sha, created_at: expiry, scope: 'P3A-0', requirement_ids: ids,
    owner: 'phase3a-primary', reviewer: null, sensitivity: 'public-official', redaction_transform: 'none', retention_class: 'official-artifact-until-acceptance', expiry, destruction_procedure: 'operator approval required', disposition: 'retain',
    environment_fingerprint_cell: 'intake', parser_name: 'safe-tar', parser_version: 'v1', parser_agreement: 'agreed', negative_result: null, contradiction_ids: [], contradiction_status: 'none', validation_status: 'valid', run_digest: null, conclusion_digests: [],
  }],
}

const observation: any = {
  schema_version: 'oracle-lab-phase3a-normalized-observation.v1', observation_id: 'obs-1', run_id: 'run-1', pair_id: 'pair-1', artifact_digest: sha,
  request: { endpoint_class: 'loopback_messages', header_names: ['content-type'], header_value_classes: { 'content-type': 'json' }, body_ast_topology: {}, cch_class: 'absent', system_summary: { byte_length: 0, sha256: sha, stable_spans: [], ast_topology: {} }, serialized_bytes_sha256: sha },
  response: { http_sse_ast: {}, event_order: [], partial_output_topology: {}, compact_fields: {}, prompt_cache_fields: {}, terminal_state: 'complete', retry_eligibility: false },
  control_plane: { destination_classes: [], event_schemas: [], timing_buckets: [] }, runtime: { process_lineage: [], exec_digests: [], environment_access: [], filesystem_events: [], dns_events: [], socket_events: [], tls_events: [], http_events: [], timers: [], retries: [] },
  perturbation: { instrumented: false, control_run_id: 'run-1', differences: [], missing_sources: [], profile_usable: true }, source_agreement: 'two-source', limitations: [],
}

const conclusion: any = { schema_version: 'oracle-lab-phase3a-conclusion.v1', conclusion_id: 'c-1', level: 'Unknown', scope: 'darwin-arm64', statement: 'No positive behavior claim.', supporting_artifact_ids: [], contradicting_artifact_ids: [], static_anchor: null, dynamic_reproduction: null, single_source_reason: 'not run', platform_limits: [], expiry, negative_capabilities: ['dynamic-not-run'], phase3b_usable: false, prohibited_claims: ['CL-LOCAL-EVIDENCE-PRODUCTION-PROHIBITED'] }
const handoff: any = { schema_version: 'oracle-lab-phase3a-handoff.v1', status: 'BLOCKED', exit_report_path: 'docs/superpowers/evidence/phase-3a/exit.json', exit_report_sha256: sha, p2: { bundle_sha256: sha, predecessor_sha256: sha, schema_range: '1:0-0' }, artifact_index_sha256: sha, usable_conclusion_ids: [], unknown_conclusion_ids: ['c-1'], contradiction_ids: [], negative_capabilities: ['dynamic-not-run'], candidate_input_schema: {}, candidate_input_rows: [], platform_coverage: [], change_point_coverage: [], omitted_cells: [], runtime_enforcement_implemented: false }

for (const [name, fixture] of [['launch-manifest', launch], ['artifact-index', artifactIndex], ['normalized-observation', observation], ['conclusion', conclusion], ['handoff', handoff]] as const) {
  assert.deepEqual(validatePhase3A(name, fixture), [], `${name} fixture must pass`)
  assert.equal(canonicalJson(JSON.parse(canonicalJson(fixture))), canonicalJson(fixture))
}

const mutations: Array<[string, any, string]> = [
  ['missing lineage', { ...launch, parent_run_id: undefined }, 'schema_invalid'],
  ['floating version', { ...launch, artifact: { ...launch.artifact, version: 'latest' } }, 'schema_invalid'],
  ['external base URL', { ...launch, environment: { ...launch.environment, base_urls: ['https://api.example.test/'] } }, 'schema_invalid'],
  ['socket budget', { ...launch, network: { ...launch.network, external_socket_budget: 1 } }, 'schema_invalid'],
  ['unknown field', { ...launch, receipt: {} }, 'unknown_field'],
  ['raw prompt', { ...observation, request: { ...observation.request, raw_prompt: 'synthetic' } }, 'unknown_field'],
  ['credential value', { ...conclusion, statement: 'Bearer abcdefghijk' }, 'sensitive_material'],
  ['signed URL', { ...artifactIndex, artifacts: [{ ...artifactIndex.artifacts[0], source_url: 'https://example.test/a?sig=secretvalue' }] }, 'sensitive_material'],
  ['outside path', { ...artifactIndex, artifacts: [{ ...artifactIndex.artifacts[0], relative_path: '../escape' }] }, 'schema_invalid'],
]
for (const [label, fixture, code] of mutations) {
  const schema = label === 'raw prompt' ? 'normalized-observation' : label === 'credential value' ? 'conclusion' : label === 'signed URL' || label === 'outside path' ? 'artifact-index' : 'launch-manifest'
  const errors = validatePhase3A(schema, fixture)
  assert.ok(errors.some((error) => error.code === code), `${label} must fail with ${code}: ${JSON.stringify(errors)}`)
  assert.ok(errors.every((error) => error.path.startsWith('$') || error.path.startsWith('/')))
}

console.log(JSON.stringify({ ok: true, schemas: 5, mutations: mutations.length }))
