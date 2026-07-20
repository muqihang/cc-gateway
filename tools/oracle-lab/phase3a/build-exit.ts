import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js'

import { canonicalJson, Phase3AError, sha256Bytes, sha256File } from './core.js'
import { captureRepositoryBinding, validateRepositoryBinding, type RepositoryBinding } from './repository-binding.js'
import { assertPhase3A, scanSafePersisted } from './schemas.js'

type JsonObject = Record<string, any>
type SectionStatus = 'COMPLETE' | 'PARTIAL' | 'BLOCKED'
type Section = { status: SectionStatus; details: JsonObject | unknown[] }

export type CuratedConclusion = {
  conclusion: JsonObject
  authority_ceiling: 'Observed' | 'Reproduced' | 'Inferred' | 'Unknown'
  observation_count: number
  parser_agreement: 'agreed' | 'disagreed' | 'not-applicable'
  perturbed: boolean
}

export type CuratedExitInput = {
  generated_at: string
  exit_report_path: string
  artifact_index_sha256: string
  p2: { bundle_sha256: string; predecessor_sha256: string; schema_range: '1:0-0' }
  repositories: RepositoryBinding[]
  repository_capture_required?: boolean
  artifacts: unknown[]
  toolchain_capabilities: JsonObject | unknown[]
  static_analysis: JsonObject | unknown[]
  coverage: { active: unknown[]; change_points: unknown[]; omitted: unknown[] }
  protocol_runtime_summaries: unknown[]
  perturbation_source_agreement: JsonObject | unknown[]
  evidence_health: { contradictions: unknown[]; expired: unknown[]; errors: unknown[]; unknowns: unknown[] }
  conclusions: CuratedConclusion[]
  p2_mapping: JsonObject | unknown[]
  evidence_hygiene: JsonObject | unknown[]
  reproduction: JsonObject | unknown[]
  phase3b: { negative_capabilities: string[]; candidate_input_schema: JsonObject; acceptance_cases: unknown[]; rollback_reference: JsonObject | null }
  safety_confirmation: {
    no_production: true
    no_real_credentials: true
    no_real_upstream: true
    no_real_canary: true
    no_profile_promotion: true
    no_phase4_wiring: true
    no_protected_file_access: true
    runtime_enforcement_implemented: false
  }
  missing_gates: string[]
}

export type ExitReport = {
  schema_version: 'oracle-lab-phase3a-exit.v1'
  status: 'BLOCKED'
  generated_at: string
  artifact_index_sha256: string
  conclusion_digest: string
  sections: Record<string, Section>
  missing_gates: string[]
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const exitSchema = JSON.parse(readFileSync(path.join(ROOT, 'docs/superpowers/schemas/oracle-lab-phase3a-exit.schema.json'), 'utf8'))
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  formats: { 'date-time': { type: 'string', validate: (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)) } },
})
const validateExit = ajv.compile(exitSchema)

function schemaErrors(errors: ErrorObject[] | null | undefined): string {
  return canonicalJson((errors ?? []).map((error) => ({ keyword: error.keyword, path: error.instancePath || '$' })))
}

export function assertExitReport(value: unknown): asserts value is ExitReport {
  if (!validateExit(value)) throw new Phase3AError('exit_schema_invalid', schemaErrors(validateExit.errors))
  const unsafe = scanSafePersisted(value)
  if (unsafe.length > 0) throw new Phase3AError('exit_unsafe_material', canonicalJson(unsafe))
}

function section(details: JsonObject | unknown[], status: SectionStatus): Section { return { status, details } }

function usable(row: CuratedConclusion, now: number): boolean {
  const conclusion = row.conclusion
  if (conclusion.phase3b_usable !== true || conclusion.level !== 'Reproduced') return false
  if (row.authority_ceiling !== 'Reproduced' || row.observation_count < 2 || row.parser_agreement !== 'agreed' || row.perturbed) return false
  if (!conclusion.static_anchor || !conclusion.dynamic_reproduction || conclusion.dynamic_reproduction.source_count < 2) return false
  if (conclusion.dynamic_reproduction.run_ids.length < 2 || conclusion.dynamic_reproduction.control_run_ids.length < 1) return false
  if (conclusion.contradicting_artifact_ids.length > 0 || Date.parse(conclusion.expiry) <= now) return false
  return true
}

function boundedConclusions(input: CuratedExitInput): { conclusions: JsonObject[]; usable: JsonObject[]; unknown: JsonObject[] } {
  const now = Date.parse(input.generated_at)
  const conclusions = input.conclusions.map((row) => {
    assertPhase3A('conclusion', row.conclusion)
    const allowed = usable(row, now)
    const conclusion = { ...row.conclusion, phase3b_usable: allowed }
    if (!allowed && conclusion.level !== 'Unknown') {
      conclusion.level = 'Unknown'
      conclusion.dynamic_reproduction = null
      conclusion.single_source_reason = conclusion.single_source_reason ?? 'evidence failed Phase 3B usability gates'
    }
    assertPhase3A('conclusion', conclusion)
    return conclusion
  }).sort((left, right) => left.conclusion_id < right.conclusion_id ? -1 : left.conclusion_id > right.conclusion_id ? 1 : 0)
  return { conclusions, usable: conclusions.filter((row) => row.phase3b_usable), unknown: conclusions.filter((row) => row.level === 'Unknown') }
}

function assertCuratedInput(input: CuratedExitInput): void {
  if (input.repository_capture_required) throw new Phase3AError('repository_capture_required', 'repository bindings must be captured from the frozen worktrees')
  if (!Number.isFinite(Date.parse(input.generated_at))) throw new Phase3AError('exit_input_invalid', 'generated_at must be an ISO timestamp')
  if (!/^[a-f0-9]{64}$/.test(input.artifact_index_sha256)) throw new Phase3AError('exit_input_invalid', 'artifact index digest is invalid')
  if (input.missing_gates.length === 0) throw new Phase3AError('exit_missing_gate_required', 'blocked exit must name at least one missing gate')
  if (Object.values(input.safety_confirmation).some((value) => value !== true && value !== false)) throw new Phase3AError('exit_safety_invalid', 'safety confirmations must be booleans')
  if (input.safety_confirmation.runtime_enforcement_implemented !== false || Object.entries(input.safety_confirmation).some(([key, value]) => key !== 'runtime_enforcement_implemented' && value !== true)) {
    throw new Phase3AError('exit_safety_invalid', 'all safety boundaries must be affirmed and runtime enforcement must remain false')
  }
  const repositoryNames = input.repositories.map((repository) => repository.repository).sort()
  if (canonicalJson(repositoryNames) !== canonicalJson(['cc-gateway', 'sub2api'])) throw new Phase3AError('repository_binding_invalid', 'exit report must bind exactly cc-gateway and sub2api')
  input.repositories.forEach(validateRepositoryBinding)
  if (input.repositories.some((repository) => repository.codegraph.up_to_date === false) && !input.missing_gates.includes('codegraph-current')) {
    throw new Phase3AError('codegraph_unavailable_unacknowledged', 'unavailable CodeGraph must remain an explicit missing gate')
  }
  const unsafe = scanSafePersisted(input)
  if (unsafe.length > 0) throw new Phase3AError('exit_unsafe_material', canonicalJson(unsafe))
  const forbiddenKey = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(forbiddenKey)
    if (!value || typeof value !== 'object') return false
    return Object.entries(value).some(([key, child]) => /^(?:raw|raw_source|prompt|body|runtime_profile|generated_profile|generated_config|profile_config)$/i.test(key) || forbiddenKey(child))
  }
  if (forbiddenKey(input)) throw new Phase3AError('exit_forbidden_material', 'curated input contains raw source/prompt/body/profile material')
}

export function buildExitReport(input: CuratedExitInput): ExitReport {
  assertCuratedInput(input)
  const classified = boundedConclusions(input)
  const partial = (value: unknown[] | JsonObject): SectionStatus => Array.isArray(value) && value.length === 0 ? 'BLOCKED' : 'PARTIAL'
  const report: ExitReport = {
    schema_version: 'oracle-lab-phase3a-exit.v1', status: 'BLOCKED', generated_at: input.generated_at,
    artifact_index_sha256: input.artifact_index_sha256,
    conclusion_digest: sha256Bytes(canonicalJson(classified.conclusions)),
    sections: {
      repository_state: section(input.repositories, partial(input.repositories)),
      artifact_identity: section(input.artifacts, partial(input.artifacts)),
      toolchain_capabilities: section(input.toolchain_capabilities, partial(input.toolchain_capabilities)),
      static_analysis: section(input.static_analysis, partial(input.static_analysis)),
      coverage: section(input.coverage, 'PARTIAL'),
      protocol_runtime_summaries: section(input.protocol_runtime_summaries, partial(input.protocol_runtime_summaries)),
      perturbation_source_agreement: section(input.perturbation_source_agreement, 'PARTIAL'),
      evidence_health: section({ ...input.evidence_health, unknown_conclusion_ids: classified.unknown.map((row) => row.conclusion_id) }, 'BLOCKED'),
      conclusions: section(classified.conclusions, classified.usable.length > 0 ? 'PARTIAL' : 'BLOCKED'),
      p2_mapping: section(input.p2_mapping, 'PARTIAL'),
      evidence_hygiene: section(input.evidence_hygiene, 'PARTIAL'),
      reproduction: section(input.reproduction, 'PARTIAL'),
      phase3b_inputs: section({
        candidate_input_schema: input.phase3b.candidate_input_schema,
        candidate_input_rows: classified.usable.map((row) => ({ conclusion_id: row.conclusion_id, phase3b_usable: true })),
        negative_capabilities: [...new Set(input.phase3b.negative_capabilities)].sort(),
        acceptance_cases: input.phase3b.acceptance_cases,
        rollback_reference: input.phase3b.rollback_reference,
        generated_runtime_profile: false,
      }, 'BLOCKED'),
      safety_confirmation: section(input.safety_confirmation, 'COMPLETE'),
    },
    missing_gates: [...new Set(input.missing_gates)].sort(),
  }
  assertExitReport(report)
  return report
}

const TITLES: Array<[string, string]> = [
  ['repository_state', 'Repository State'], ['artifact_identity', 'Artifact Identity'], ['toolchain_capabilities', 'Toolchain Capabilities'],
  ['static_analysis', 'Static Analysis'], ['coverage', 'Coverage'], ['protocol_runtime_summaries', 'Protocol And Runtime Summaries'],
  ['perturbation_source_agreement', 'Perturbation And Source Agreement'], ['evidence_health', 'Evidence Health'], ['conclusions', 'Conclusions'],
  ['p2_mapping', 'P2 Mapping'], ['evidence_hygiene', 'Evidence Hygiene'], ['reproduction', 'Reproduction'],
  ['phase3b_inputs', 'Phase 3B Inputs'], ['safety_confirmation', 'Safety Confirmation'],
]

export function renderExitMarkdown(reportInput: ExitReport): string {
  assertExitReport(reportInput)
  const lines = ['# Oracle Lab Phase 3A Exit Report', '', `Status: ${reportInput.status}`, `Generated: ${reportInput.generated_at}`, `Artifact index: ${reportInput.artifact_index_sha256}`, `Conclusion digest: ${reportInput.conclusion_digest}`, '']
  TITLES.forEach(([key, title], index) => {
    const value = reportInput.sections[key]
    lines.push(`## ${index + 1}. ${title}`, '', `Status: ${value.status}`, '', '```json', canonicalJson(value.details), '```', '')
  })
  lines.push('## Missing Gates', '', ...reportInput.missing_gates.map((gate) => `- ${gate}`), '')
  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}

export function buildBlockedHandoff(input: CuratedExitInput, reportInput?: ExitReport): JsonObject {
  const report = reportInput ?? buildExitReport(input)
  assertExitReport(report)
  const conclusions = report.sections.conclusions.details as JsonObject[]
  const usableRows = conclusions.filter((row) => row.phase3b_usable === true).map((row) => ({ conclusion_id: row.conclusion_id, phase3b_usable: true }))
  const handoff = {
    schema_version: 'oracle-lab-phase3a-handoff.v1', status: 'BLOCKED', exit_report_path: input.exit_report_path,
    exit_report_sha256: sha256Bytes(`${canonicalJson(report)}\n`), p2: input.p2, artifact_index_sha256: input.artifact_index_sha256,
    usable_conclusion_ids: usableRows.map((row) => row.conclusion_id),
    unknown_conclusion_ids: conclusions.filter((row) => row.level === 'Unknown').map((row) => row.conclusion_id),
    contradiction_ids: [...new Set(input.evidence_health.contradictions.map((row: any) => String(row.contradiction_id ?? row.id ?? row)))].sort(),
    negative_capabilities: [...new Set(input.phase3b.negative_capabilities)].sort(),
    candidate_input_schema: input.phase3b.candidate_input_schema, candidate_input_rows: usableRows,
    platform_coverage: input.coverage.active, change_point_coverage: input.coverage.change_points, omitted_cells: input.coverage.omitted,
    runtime_enforcement_implemented: false,
  }
  assertPhase3A('handoff', handoff)
  return handoff
}

export function buildBlockedDeliverables(input: CuratedExitInput): { exit: ExitReport; markdown: string; handoff: JsonObject } {
  const exit = buildExitReport(input)
  return { exit, markdown: renderExitMarkdown(exit), handoff: buildBlockedHandoff(input, exit) }
}

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const inputFile = argument('--input')
  if (!inputFile) throw new Phase3AError('usage', 'usage: build-exit.ts --input CURATED.json [--handoff|--markdown]')
  const input = JSON.parse(readFileSync(inputFile, 'utf8')) as CuratedExitInput
  if (input.repository_capture_required) {
    const ccRoot = argument('--cc-root'); const sub2apiRoot = argument('--sub2api-root')
    const ccBase = argument('--cc-base'); const sub2apiBase = argument('--sub2api-base')
    const ccFreeze = argument('--cc-freeze-head'); const sub2apiFreeze = argument('--sub2api-freeze-head')
    if (!ccRoot || !sub2apiRoot || !ccBase || !sub2apiBase || !ccFreeze || !sub2apiFreeze) throw new Phase3AError('repository_binding_invalid', 'repository capture roots, bases, and freeze heads are required')
    input.repositories = [
      captureRepositoryBinding(ccRoot, { repository: 'cc-gateway', base: ccBase, freezeHead: ccFreeze }),
      captureRepositoryBinding(sub2apiRoot, { repository: 'sub2api', base: sub2apiBase, freezeHead: sub2apiFreeze }),
    ]
    input.repository_capture_required = false
  }
  const built = buildBlockedDeliverables(input)
  const outputs = [
    [argument('--out-exit'), `${canonicalJson(built.exit)}\n`],
    [argument('--out-markdown'), built.markdown],
    [argument('--out-handoff'), `${canonicalJson(built.handoff)}\n`],
  ] as const
  const requested = outputs.filter((row): row is readonly [string, string] => typeof row[0] === 'string')
  if (requested.length > 0) {
    const flags = process.argv.includes('--replace-generated') ? 'w' : 'wx'
    for (const [file, bytes] of requested) {
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
      writeFileSync(file, bytes, { flag: flags, mode: 0o600 })
    }
    process.stdout.write(`${canonicalJson({ outputs: requested.map(([file]) => ({ file, sha256: sha256File(file) })) })}\n`)
  } else process.stdout.write(process.argv.includes('--handoff') ? `${canonicalJson(built.handoff)}\n` : process.argv.includes('--markdown') ? built.markdown : `${canonicalJson(built.exit)}\n`)
}
