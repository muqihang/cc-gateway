import { createHash } from 'node:crypto'
import { createReadStream, existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  EvidenceSufficiencyError,
  buildDeterministicSchedule,
  canonicalEvidenceBytes,
  sha256Bytes,
  writeExclusiveEvidence,
} from './core.js'
import { parseEvidenceJson, validateEvidenceArtifact, type EvidenceSchemaFile } from './schemas.js'

const CONFIG_PAIRS = [
  'config-precedence-user-vs-default',
  'config-precedence-project-vs-user',
  'config-precedence-local-vs-project',
  'config-precedence-process-env-vs-local',
] as const

const AUTH_PAIRS = [
  'auth-api-key-rotation',
  'auth-token-rotation',
  'auth-credential-coexistence',
  'auth-missing-credential',
] as const

const WIRE_STIMULI = ['prompt_only', 'safe_tool_catalog', 'tool_disabled'] as const

const FAILURE_PROGRAMS = [
  'http_400_terminal',
  'http_401_terminal',
  'http_403_terminal',
  'http_429_terminal',
  'http_500_terminal',
  'http_529_terminal',
  'reset_terminal',
  'partial_sse_then_eof',
  'complete_sse',
  'http_429_then_complete',
  'http_500_then_complete',
  'reset_before_headers_then_complete',
  'delayed_headers_boundary',
] as const

const TARGET_CONTROLS = ['target-guard-control', 'target-perturbation-control'] as const
const PAIRED_ARMS = ['control/instrumented', 'control/uninstrumented', 'treatment/instrumented', 'treatment/uninstrumented'] as const
const INSTRUMENTATION_ARMS = ['instrumented', 'uninstrumented'] as const
const FOURTEEN_DAYS_MS = 1_209_600_000
const ZERO_SHA256 = '0'.repeat(64)
const SCOPE = 'claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume'
const PLAN_RELATIVE = 'docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-normalized-safe-evidence-sufficiency-supplement.md'

export const CLOSURE_ORDER = [
  'artifact-index',
  'leak-report',
  'exit-report',
  'handoff',
  'terminal-manifest',
  'external-digest-set',
] as const

const CLOSURE_PATHS = Object.fromEntries(CLOSURE_ORDER.map((id) => [id, `capsules/P3B-ES1/closure/${id}.json`])) as Record<typeof CLOSURE_ORDER[number], string>
const CONCLUSION_SPECS = [
  ['CL-P3B-ES1-CONFIG-AUTH-REVALIDATED', 'oracle-lab-p3b-es-config-auth.v1', 'capsules/P3B-ES1/conclusions/config-auth-revalidated.json'],
  ['CL-P3B-ES1-NEW-SESSION-WIRE', 'oracle-lab-p3b-es-new-session-wire.v1', 'capsules/P3B-ES1/conclusions/new-session-wire.json'],
  ['CL-P3B-ES1-FAILURE-RECOVERY', 'oracle-lab-p3b-es-failure-recovery.v1', 'capsules/P3B-ES1/conclusions/failure-recovery.json'],
] as const

type MissingRun = {
  run_id: string
  family_id: string
  arm: string
  repetition: number
  status: 'missing'
}

type MissingFamily = {
  family_id: string
  status: 'Unknown'
  expected_rows: number
  observed_rows: 0
  paired_equivalent: false
  projection_sha256: string
}

type CoverageSourceRow = {
  id: string
  leaves: string[]
  class: 'E' | 'C' | 'D'
  source_kind: string
  source_relative_path: string
  source_sha256_binding: string
  source_schema: string
  scope: string
  conclusion_id: string
  expiry_binding: string
  transform: string
  missing_action: string
}

type TerminalGateInput = {
  es0_to_es15_terminal: boolean
  closure_chain_valid: boolean
  protected_count: number
  raw_or_sensitive_persisted: boolean
  repositories_clean: boolean
  conclusions: readonly string[]
  phase3b_usable: readonly boolean[]
  uncovered_e_leaves: number
  open_contradictions: number
  leak_findings: number
  mutation_disagreements: number
  fixtures_materializable: boolean
  cross_repo_agreement: boolean
  expiry_exact: boolean
  unexpired: boolean
}

type CloseoutOptions = {
  evidence_root: string
  cc_root: string
  campaign_id: string
  issued_at_ms: number
  protected_count: number
  repositories_clean: boolean
}

function fail(code: string, message: string): never {
  throw new EvidenceSufficiencyError(code, message)
}

function canonicalSort(values: readonly string[]): string[] {
  return [...values].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
}

export function validateClosureOrder(order: readonly string[]): void {
  if (order.length !== CLOSURE_ORDER.length || order.some((entry, index) => entry !== CLOSURE_ORDER[index])) {
    fail('dag_invalid', 'closure records are not in the fixed append-only order')
  }
}

export function buildMissingCampaignMatrix(campaignId: string): {
  families: MissingFamily[]
  runs: MissingRun[]
  counts: { config: number; auth: number; wire: number; failure: number; controls: number; total: number }
} {
  const families: MissingFamily[] = []
  const runs: MissingRun[] = []
  const append = (familyId: string, arms: readonly string[]): void => {
    const schedule = buildDeterministicSchedule(campaignId, familyId, arms)
    const familyRuns = schedule.orders.flatMap((order, repetition) => order.map((arm, ordinal) => ({
      run_id: schedule.run_ids[repetition][ordinal], family_id: familyId, arm, repetition, status: 'missing' as const,
    })))
    runs.push(...familyRuns)
    families.push({
      family_id: familyId,
      status: 'Unknown',
      expected_rows: familyRuns.length,
      observed_rows: 0,
      paired_equivalent: false,
      projection_sha256: sha256Bytes(canonicalEvidenceBytes({ family_id: familyId, status: 'missing', expected_rows: familyRuns.length })),
    })
  }
  for (const pair of CONFIG_PAIRS) append(pair, PAIRED_ARMS)
  for (const pair of AUTH_PAIRS) append(pair, PAIRED_ARMS)
  for (const stimulus of WIRE_STIMULI) append(stimulus, INSTRUMENTATION_ARMS)
  for (const program of FAILURE_PROGRAMS) append(program, INSTRUMENTATION_ARMS)
  for (const control of TARGET_CONTROLS) append(control, INSTRUMENTATION_ARMS)
  const counts = { config: 80, auth: 80, wire: 30, failure: 130, controls: 20, total: 340 }
  if (runs.length !== counts.total || new Set(runs.map((run) => run.run_id)).size !== counts.total) fail('dag_invalid', 'missing-run matrix does not account for exactly 340 unique runs')
  return { families, runs, counts }
}

export function buildBlockedCandidateClosure(campaignId: string, runs: MissingRun[], ownedEPointers: string[]) {
  return {
    schema_id: 'oracle-lab-p3b-es-candidate-field-closure.v1', schema_major: 1, schema_revision: 0,
    campaign_id: campaignId, complete: false, fixture_bindings: [],
    owned_e_pointers: canonicalSort([...new Set(ownedEPointers)]),
    prospective_conclusions: CONCLUSION_SPECS.map(([conclusion_id, schema_id]) => ({ conclusion_id, schema_id })),
    required_runs: runs,
  }
}

export function buildBlockedConclusions(campaignId: string, issuedAtMs: number, contradictionIds: string[]) {
  if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs < 0) fail('schema_invalid', 'issued_at_ms must be a non-negative safe integer')
  return CONCLUSION_SPECS.map(([conclusion_id, schema_id, relative_path]) => ({
    relative_path,
    value: {
      schema_id, schema_major: 1, schema_revision: 0, campaign_id: campaignId, conclusion_id,
      contradiction_ids: canonicalSort([...new Set(contradictionIds)]),
      issued_at_ms: issuedAtMs, expires_at_ms: issuedAtMs + FOURTEEN_DAYS_MS,
      fixture_bindings: [], owned_fields: [], level: 'Unknown' as const, phase3b_usable: false,
    },
  }))
}

export function evaluateTerminalGates(input: TerminalGateInput): { gate_a: 'PASS' | 'FAIL'; gate_b: 'PASS' | 'FAIL' } {
  const gateA = input.es0_to_es15_terminal && input.closure_chain_valid && input.protected_count === 0
    && !input.raw_or_sensitive_persisted && input.repositories_clean
  const gateB = gateA && input.conclusions.length === 3 && input.conclusions.every((level) => level === 'Reproduced')
    && input.phase3b_usable.length === 3 && input.phase3b_usable.every(Boolean)
    && input.uncovered_e_leaves === 0 && input.open_contradictions === 0 && input.leak_findings === 0
    && input.mutation_disagreements === 0 && input.fixtures_materializable && input.cross_repo_agreement
    && input.expiry_exact && input.unexpired
  return { gate_a: gateA ? 'PASS' : 'FAIL', gate_b: gateB ? 'PASS' : 'FAIL' }
}

function coverageRowsFromPlan(planText: string): CoverageSourceRow[] {
  const match = /```json coverage-source-bindings\n([\s\S]*?)\n```/.exec(planText)
  if (!match) fail('source_binding_invalid', 'normative coverage-source-bindings block is missing')
  const rows = parseEvidenceJson(match[1])
  if (!Array.isArray(rows)) fail('source_binding_invalid', 'normative coverage block is not an array')
  return rows as CoverageSourceRow[]
}

function validateArtifact(schema: EvidenceSchemaFile, value: unknown): void {
  const decision = validateEvidenceArtifact(schema, value)
  if (!decision.allowed) fail(decision.code, `${schema} rejected closeout artifact`)
}

function writeValidated(root: string, relative: string, schema: EvidenceSchemaFile, value: unknown) {
  validateArtifact(schema, value)
  return writeExclusiveEvidence(root, relative, value, 'controller')
}

async function sha256File(file: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const digest = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('data', (chunk) => digest.update(chunk))
    stream.once('error', reject)
    stream.once('end', () => resolve(digest.digest('hex')))
  })
}

function modeOf(file: string): number {
  return lstatSync(file).mode & 0o777
}

function walkFiles(root: string, relative = 'capsules/P3B-ES1'): Array<{ relative_path: string; symlink: boolean }> {
  const absolute = path.join(root, ...relative.split('/'))
  if (!existsSync(absolute)) return []
  const output: Array<{ relative_path: string; symlink: boolean }> = []
  for (const name of canonicalSort(readdirSync(absolute))) {
    const childRelative = `${relative}/${name}`
    const child = path.join(root, ...childRelative.split('/'))
    const stat = lstatSync(child)
    if (stat.isSymbolicLink()) output.push({ relative_path: childRelative, symlink: true })
    else if (stat.isDirectory()) output.push(...walkFiles(root, childRelative))
    else if (stat.isFile()) output.push({ relative_path: childRelative, symlink: false })
  }
  return output
}

function kindFor(relative: string): 'control' | 'observation' | 'cell' | 'closure' | 'conclusion' | 'fixture' | 'validation' {
  if (relative.includes('/control/')) return 'control'
  if (relative.includes('/observations/')) return 'observation'
  if (relative.includes('/cells/')) return 'cell'
  if (relative.includes('/conclusions/')) return 'conclusion'
  if (relative.includes('/fixtures/')) return 'fixture'
  if (relative.includes('/validation/')) return 'validation'
  return 'closure'
}

function schemaIdFor(file: string, relative: string): string {
  if (!relative.endsWith('.json')) return relative.endsWith('claude-probe-copy') ? 'oracle-lab-p3b-es-probe-copy.v1' : 'oracle-lab-p3b-es-opaque.v1'
  try {
    const value = parseEvidenceJson(readFileSync(file)) as { schema_id?: unknown }
    return typeof value === 'object' && value !== null && typeof value.schema_id === 'string' ? value.schema_id : 'oracle-lab-p3b-es-unregistered-control.v1'
  } catch {
    return 'oracle-lab-p3b-es-invalid-json.v1'
  }
}

function forbiddenKeyPaths(value: unknown, pointer = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((entry, index) => forbiddenKeyPaths(entry, `${pointer}/${index}`))
  if (!value || typeof value !== 'object') return []
  const output: string[] = []
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const child = `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`
    if (/^(?:raw_prompt|raw_body|response_body|credential_value|token_value|cookie_value|secret|raw_stdout|raw_stderr|raw_headers|raw_response|raw_request)$/i.test(key)) output.push(child)
    output.push(...forbiddenKeyPaths(entry, child))
  }
  return output
}

async function inventoryPayload(root: string): Promise<{
  artifacts: Array<{ relative_path: string; sha256: string; size_bytes: number; mode: 384 | 493; schema_id: string; kind: ReturnType<typeof kindFor> }>
  findings: Array<{ finding_id: string; relative_path: string; code: 'raw_material_key' | 'symlink' | 'mode_mismatch'; value_sha256: string }>
  omitted: string[]
}> {
  const closureSet = new Set(Object.values(CLOSURE_PATHS))
  const artifacts: Array<{ relative_path: string; sha256: string; size_bytes: number; mode: 384 | 493; schema_id: string; kind: ReturnType<typeof kindFor> }> = []
  const rawFindings: Array<{ relative_path: string; code: 'raw_material_key' | 'symlink' | 'mode_mismatch'; identity: string }> = []
  const omitted: string[] = []
  for (const entry of walkFiles(root)) {
    if (closureSet.has(entry.relative_path)) continue
    const file = path.join(root, ...entry.relative_path.split('/'))
    if (entry.symlink) {
      omitted.push(entry.relative_path)
      rawFindings.push({ relative_path: entry.relative_path, code: 'symlink', identity: entry.relative_path })
      continue
    }
    const mode = modeOf(file)
    if (mode !== 0o600 && mode !== 0o755) {
      omitted.push(entry.relative_path)
      rawFindings.push({ relative_path: entry.relative_path, code: 'mode_mismatch', identity: `${entry.relative_path}:${mode.toString(8)}` })
      continue
    }
    if (entry.relative_path.endsWith('.json')) {
      try {
        const forbidden = forbiddenKeyPaths(parseEvidenceJson(readFileSync(file)))
        for (const pointer of forbidden) rawFindings.push({ relative_path: entry.relative_path, code: 'raw_material_key', identity: `${entry.relative_path}:${pointer}` })
      } catch {
        rawFindings.push({ relative_path: entry.relative_path, code: 'raw_material_key', identity: `${entry.relative_path}:invalid-json` })
      }
    }
    const stat = lstatSync(file)
    artifacts.push({
      relative_path: entry.relative_path,
      sha256: await sha256File(file),
      size_bytes: stat.size,
      mode: mode as 384 | 493,
      schema_id: schemaIdFor(file, entry.relative_path),
      kind: kindFor(entry.relative_path),
    })
  }
  const findings = rawFindings.map((finding, index) => ({
    finding_id: `finding-${String(index + 1).padStart(3, '0')}`,
    relative_path: finding.relative_path,
    code: finding.code,
    value_sha256: sha256Bytes(finding.identity),
  }))
  return { artifacts, findings, omitted }
}

async function existingSource(root: string, ccRoot: string, relative: string): Promise<{ sha256: string; schema_id: string; expires_at_ms: number } | null> {
  const file = relative.startsWith('capsules/') ? path.join(root, ...relative.split('/')) : path.join(ccRoot, ...relative.split('/'))
  if (!existsSync(file) || lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) return null
  let schemaId = relative.startsWith('docs/') ? 'plan.v1' : 'unknown.v1'
  let expiresAtMs = 0
  if (relative.endsWith('.json')) {
    const value = parseEvidenceJson(readFileSync(file)) as { schema_id?: unknown; expires_at_ms?: unknown }
    if (typeof value === 'object' && value !== null && typeof value.schema_id === 'string') schemaId = value.schema_id
    if (typeof value === 'object' && value !== null && Number.isSafeInteger(value.expires_at_ms)) expiresAtMs = value.expires_at_ms as number
  }
  return { sha256: await sha256File(file), schema_id: schemaId, expires_at_ms: expiresAtMs }
}

async function buildUnknownProvenance(root: string, ccRoot: string, campaignId: string, rows: CoverageSourceRow[]) {
  const sources: Record<string, { sha256: string; schema_id: string; scope: string; expires_at_ms: number }> = {}
  const sourceCache = new Map<string, Awaited<ReturnType<typeof existingSource>>>()
  for (const row of rows) {
    if (!sourceCache.has(row.source_relative_path)) sourceCache.set(row.source_relative_path, await existingSource(root, ccRoot, row.source_relative_path))
    const source = sourceCache.get(row.source_relative_path) ?? null
    if (source) sources[row.source_relative_path] = { ...source, scope: row.scope }
  }
  const provenanceRows = rows.flatMap((row) => row.leaves.map((pointer) => {
    const source = sourceCache.get(row.source_relative_path) ?? null
    return {
      coverage_id: row.id, pointer, class: row.class, source_relative_path: row.source_relative_path,
      source_sha256: source?.sha256 ?? ZERO_SHA256, source_schema: row.source_schema,
      conclusion_id: row.conclusion_id, expiry_binding: row.expiry_binding,
      status: row.class === 'D' ? 'disabled' as const : row.class === 'C' && source ? 'closed' as const : 'uncovered' as const,
    }
  }))
  const fieldProvenance = {
    schema_id: 'oracle-lab-p3b-es-field-provenance.v1', schema_major: 1, schema_revision: 0,
    campaign_id: campaignId, sources, rows: provenanceRows,
  }
  const classCounts = { E: rows.filter((row) => row.class === 'E').length, C: rows.filter((row) => row.class === 'C').length, D: rows.filter((row) => row.class === 'D').length }
  const coverage = {
    schema_id: 'oracle-lab-p3b-es-coverage.v1', schema_major: 1, schema_revision: 0, campaign_id: campaignId,
    class_counts: classCounts, phase3b_usable: false,
    rows: rows.map((row) => {
      const source = sourceCache.get(row.source_relative_path) ?? null
      return {
        coverage_id: row.id, leaves: row.leaves, class: row.class, source_relative_path: row.source_relative_path,
        source_sha256: source?.sha256 ?? ZERO_SHA256,
        status: row.class === 'D' ? 'disabled' as const : row.class === 'C' && source ? 'closed' as const : 'uncovered' as const,
      }
    }),
    uncovered_e_leaves: rows.filter((row) => row.class === 'E').reduce((count, row) => count + row.leaves.length, 0),
  }
  return { fieldProvenance, coverage }
}

function closureRecord(relative_path: string, schema_id: string, sha256: string) {
  return { relative_path, schema_id, sha256 }
}

export async function emitBlockedCloseout(options: CloseoutOptions) {
  validateClosureOrder(CLOSURE_ORDER)
  if (!Number.isSafeInteger(options.protected_count) || options.protected_count < 0) fail('schema_invalid', 'protected count is invalid')
  for (const relative of [
    'capsules/P3B-ES1/closure/observation-closure.json',
    'capsules/P3B-ES1/closure/contradictions.json',
    'capsules/P3B-ES1/closure/candidate-field-closure.json',
    'capsules/P3B-ES1/control/clock-attestation.json',
    ...CONCLUSION_SPECS.map((spec) => spec[2]),
    'capsules/P3B-ES1/closure/field-provenance.json',
    'capsules/P3B-ES1/closure/coverage.json',
    ...Object.values(CLOSURE_PATHS),
  ]) if (existsSync(path.join(options.evidence_root, ...relative.split('/')))) fail('evidence_exists', `${relative} already exists`)

  const planFile = path.join(options.cc_root, ...PLAN_RELATIVE.split('/'))
  const planText = readFileSync(planFile, 'utf8')
  const coverageRows = coverageRowsFromPlan(planText)
  const matrix = buildMissingCampaignMatrix(options.campaign_id)
  const ownedEPointers = coverageRows.filter((row) => row.class === 'E' && !row.id.startsWith('cov.conclusion.')).flatMap((row) => row.leaves)
  const reviewIds = ['prelaunch-mutation-executor-unproven', 'prelaunch-receiver-identity-omitted']
  const reviewFileDigests = {
    schemas: await sha256File(path.join(options.cc_root, 'tools/oracle-lab/phase3b-evidence-sufficiency/schemas.ts')),
    core: await sha256File(path.join(options.cc_root, 'tools/oracle-lab/phase3b-evidence-sufficiency/core.ts')),
    plan: await sha256File(planFile),
  }

  const observationClosure = {
    schema_id: 'oracle-lab-p3b-es-observation-closure.v1', schema_major: 1, schema_revision: 0,
    campaign_id: options.campaign_id, families: matrix.families, uncovered_observation_count: 340, open_contradiction_count: 2,
  }
  writeValidated(options.evidence_root, 'capsules/P3B-ES1/closure/observation-closure.json', 'observation-closure.schema.json', observationClosure)
  const contradictions = {
    schema_id: 'oracle-lab-p3b-es-contradiction.v1', schema_major: 1, schema_revision: 0,
    campaign_id: options.campaign_id, open_contradiction_count: 2,
    records: [
      { contradiction_id: reviewIds[0], family_id: 'prelaunch-review', code: 'mutation_contract_unproven', status: 'open', left_sha256: reviewFileDigests.schemas, right_sha256: reviewFileDigests.plan, differing_pointers: ['/mutation_execution/contract_validation'] },
      { contradiction_id: reviewIds[1], family_id: 'prelaunch-review', code: 'receiver_identity_omitted', status: 'open', left_sha256: reviewFileDigests.core, right_sha256: reviewFileDigests.plan, differing_pointers: ['/paired_projection/receiver_process_digest'] },
    ],
  }
  writeValidated(options.evidence_root, 'capsules/P3B-ES1/closure/contradictions.json', 'contradiction.schema.json', contradictions)
  const candidate = buildBlockedCandidateClosure(options.campaign_id, matrix.runs, ownedEPointers)
  writeValidated(options.evidence_root, 'capsules/P3B-ES1/closure/candidate-field-closure.json', 'candidate-field-closure.schema.json', candidate)
  const clock = {
    schema_id: 'oracle-lab-p3b-es-clock-attestation.v1', schema_major: 1, schema_revision: 0,
    campaign_id: options.campaign_id, issued_at_ms: options.issued_at_ms, last_authorizing_cell_sequence: 0,
  }
  writeValidated(options.evidence_root, 'capsules/P3B-ES1/control/clock-attestation.json', 'clock-attestation.schema.json', clock)
  const conclusions = buildBlockedConclusions(options.campaign_id, options.issued_at_ms, reviewIds)
  const conclusionDigests = []
  for (const conclusion of conclusions) {
    const written = writeValidated(options.evidence_root, conclusion.relative_path, 'conclusion.schema.json', conclusion.value)
    conclusionDigests.push({ ...conclusion, sha256: written.sha256 })
  }
  const provenance = await buildUnknownProvenance(options.evidence_root, options.cc_root, options.campaign_id, coverageRows)
  writeValidated(options.evidence_root, 'capsules/P3B-ES1/closure/field-provenance.json', 'field-provenance.schema.json', provenance.fieldProvenance)
  writeValidated(options.evidence_root, 'capsules/P3B-ES1/closure/coverage.json', 'coverage.schema.json', provenance.coverage)

  const inventory = await inventoryPayload(options.evidence_root)
  const artifactIndex = {
    schema_id: 'oracle-lab-p3b-es-artifact-index.v1', schema_major: 1, schema_revision: 0,
    campaign_id: options.campaign_id, artifacts: inventory.artifacts,
    excluded_closure_ids: [...CLOSURE_ORDER],
  }
  const artifactIndexWrite = writeValidated(options.evidence_root, CLOSURE_PATHS['artifact-index'], 'artifact-index.schema.json', artifactIndex)
  const leakReport = {
    schema_id: 'oracle-lab-p3b-es-leak-report.v1', schema_major: 1, schema_revision: 0,
    campaign_id: options.campaign_id, artifact_index_sha256: artifactIndexWrite.sha256,
    finding_count: inventory.findings.length, findings: inventory.findings,
  }
  const leakWrite = writeValidated(options.evidence_root, CLOSURE_PATHS['leak-report'], 'leak-report.schema.json', leakReport)
  const gates = evaluateTerminalGates({
    es0_to_es15_terminal: true,
    closure_chain_valid: inventory.omitted.length === 0,
    protected_count: options.protected_count,
    raw_or_sensitive_persisted: inventory.findings.some((finding) => finding.code === 'raw_material_key'),
    repositories_clean: options.repositories_clean,
    conclusions: conclusionDigests.map((conclusion) => conclusion.value.level),
    phase3b_usable: conclusionDigests.map((conclusion) => conclusion.value.phase3b_usable),
    uncovered_e_leaves: provenance.coverage.uncovered_e_leaves,
    open_contradictions: contradictions.open_contradiction_count,
    leak_findings: inventory.findings.length,
    mutation_disagreements: 0,
    fixtures_materializable: false,
    cross_repo_agreement: false,
    expiry_exact: true,
    unexpired: options.issued_at_ms + FOURTEEN_DAYS_MS > options.issued_at_ms,
  })
  const failureFamilies = canonicalSort([
    'schema_invalid', 'paired_perturbation',
    ...(inventory.omitted.length > 0 ? ['artifact_index_omission'] : []),
    ...(inventory.findings.length > 0 ? ['leak_detected'] : []),
  ])
  const exitReport = {
    schema_id: 'oracle-lab-p3b-es-exit-report.v1', schema_major: 1, schema_revision: 0,
    campaign_id: options.campaign_id, status: 'BLOCKED', target_launches: 0,
    failure_families: failureFamilies, gate_a: gates.gate_a, gate_b: gates.gate_b,
    leak_report_sha256: leakWrite.sha256,
  }
  const exitWrite = writeValidated(options.evidence_root, CLOSURE_PATHS['exit-report'], 'exit-report.schema.json', exitReport)
  const handoff = {
    schema_id: 'oracle-lab-p3b-es-handoff.v1', schema_major: 1, schema_revision: 0,
    campaign_id: options.campaign_id, exit_report_sha256: exitWrite.sha256,
    next_action: 'retain_phase3b_blocked', phase3b_usable: false,
    successor_conclusions: conclusionDigests.map((conclusion) => ({
      conclusion_id: conclusion.value.conclusion_id, level: conclusion.value.level,
      expires_at_ms: conclusion.value.expires_at_ms, phase3b_usable: false, sha256: conclusion.sha256,
    })),
  }
  const handoffWrite = writeValidated(options.evidence_root, CLOSURE_PATHS.handoff, 'handoff.schema.json', handoff)
  const terminalManifest = {
    schema_id: 'oracle-lab-p3b-es-terminal-manifest.v1', schema_major: 1, schema_revision: 0,
    campaign_id: options.campaign_id,
    closure_digests: { artifact_index: artifactIndexWrite.sha256, leak_report: leakWrite.sha256, exit_report: exitWrite.sha256, handoff: handoffWrite.sha256 },
    handoff_sha256: handoffWrite.sha256, protected_count: options.protected_count, repositories_clean: options.repositories_clean,
  }
  const terminalWrite = writeValidated(options.evidence_root, CLOSURE_PATHS['terminal-manifest'], 'terminal-manifest.schema.json', terminalManifest)
  const externalDigestSet = {
    schema_id: 'oracle-lab-p3b-es-external-digest-set.v1', schema_major: 1, schema_revision: 0,
    campaign_id: options.campaign_id,
    records: [
      closureRecord(CLOSURE_PATHS['artifact-index'], artifactIndex.schema_id, artifactIndexWrite.sha256),
      closureRecord(CLOSURE_PATHS['leak-report'], leakReport.schema_id, leakWrite.sha256),
      closureRecord(CLOSURE_PATHS['exit-report'], exitReport.schema_id, exitWrite.sha256),
      closureRecord(CLOSURE_PATHS.handoff, handoff.schema_id, handoffWrite.sha256),
      closureRecord(CLOSURE_PATHS['terminal-manifest'], terminalManifest.schema_id, terminalWrite.sha256),
    ],
  }
  const externalWrite = writeValidated(options.evidence_root, CLOSURE_PATHS['external-digest-set'], 'external-digest-set.schema.json', externalDigestSet)
  return {
    status: 'BLOCKED' as const, target_launches: 0, counts: matrix.counts,
    gates, failure_families: failureFamilies, open_contradictions: 2,
    leak_findings: inventory.findings.length, omitted_artifacts: inventory.omitted,
    conclusions: conclusionDigests.map((conclusion) => ({
      conclusion_id: conclusion.value.conclusion_id, level: conclusion.value.level,
      phase3b_usable: conclusion.value.phase3b_usable, expires_at_ms: conclusion.value.expires_at_ms,
      sha256: conclusion.sha256,
    })),
    closure: {
      artifact_index: artifactIndexWrite.sha256, leak_report: leakWrite.sha256,
      exit_report: exitWrite.sha256, handoff: handoffWrite.sha256,
      terminal_manifest: terminalWrite.sha256, external_digest_set: externalWrite.sha256,
    },
  }
}

function args(argv: string[]): Record<string, string> {
  const values = argv[0] === '--' ? argv.slice(1) : argv
  const output: Record<string, string> = {}
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith('--') || !values[index + 1]) fail('invalid_arguments', 'arguments must be --name value pairs')
    output[values[index].slice(2)] = values[index + 1]
  }
  return output
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const values = args(process.argv.slice(2))
    for (const key of ['evidence-root', 'cc-root', 'campaign-id', 'issued-at-ms', 'protected-count', 'repositories-clean']) {
      if (values[key] === undefined) fail('invalid_arguments', `--${key} is required`)
    }
    const result = await emitBlockedCloseout({
      evidence_root: path.resolve(values['evidence-root']), cc_root: path.resolve(values['cc-root']),
      campaign_id: values['campaign-id'], issued_at_ms: Number(values['issued-at-ms']),
      protected_count: Number(values['protected-count']), repositories_clean: values['repositories-clean'] === 'true',
    })
    process.stdout.write(`${canonicalEvidenceBytes(result).toString('utf8')}\n`)
  } catch (error) {
    const stable = error instanceof EvidenceSufficiencyError ? { code: error.code, message: error.message } : { code: 'closeout_error', message: error instanceof Error ? error.message : String(error) }
    process.stderr.write(`${canonicalEvidenceBytes(stable).toString('utf8')}\n`)
    process.exitCode = 1
  }
}
