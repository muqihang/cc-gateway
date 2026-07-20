import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { analyzeConvergence, type ConvergenceRun } from './converge.js'
import { canonicalJson, Phase3AError, sha256Bytes } from './core.js'

type JsonObject = Record<string, any>
type Arm = 'control' | 'treatment'

function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value as JsonObject).map(([key, child]) => [key, shape(child)]))
  if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) return '<sha256>'
  return value
}

export function convergenceProjection(observation: JsonObject): JsonObject {
  return {
    artifact_digest: observation.artifact_digest,
    request: {
      endpoint_class: observation.request.endpoint_class,
      header_names: observation.request.header_names,
      header_value_classes: observation.request.header_value_classes,
      body_ast_shape: shape(observation.request.body_ast_topology),
      cch_class: observation.request.cch_class,
      system: { byte_length: observation.request.system_summary.byte_length, span_layout: observation.request.system_summary.stable_spans.map((span: JsonObject) => ({ ordinal: span.ordinal, byte_length: span.byte_length })) },
    },
    response: { http_sse_ast: observation.response.http_sse_ast, event_order: observation.response.event_order, terminal_state: observation.response.terminal_state, retry_eligibility: observation.response.retry_eligibility },
    runtime: { exec_digests: observation.runtime.exec_digests, process_lineage: observation.runtime.process_lineage },
    source_agreement: observation.source_agreement,
  }
}

function spanMap(observation: JsonObject): Map<string, JsonObject> {
  return new Map(observation.request.system_summary.stable_spans.map((span: JsonObject) => [`${span.path_sha256}:${span.ordinal}`, span]))
}

export function analyzePair(input: { pair_id: string; seed: number; rows: Array<{ repetition: number; arm: Arm; observation: JsonObject }> }): JsonObject {
  const runs: ConvergenceRun[] = input.rows.map((row) => ({ run_id: row.observation.run_id, repetition: row.repetition, arm: row.arm, success: row.observation.response.terminal_state === 'complete', observer_failures: [], instrumented: false, perturbation: 'not-applicable', normalized: convergenceProjection(row.observation) }))
  const convergence = analyzeConvergence(input.pair_id, runs)
  const byArm: Record<Arm, Array<Map<string, JsonObject>>> = { control: [], treatment: [] }
  input.rows.forEach((row) => byArm[row.arm].push(spanMap(row.observation)))
  const keys = [...new Set(input.rows.flatMap((row) => [...spanMap(row.observation).keys()]))].sort()
  const associated: JsonObject[] = []
  const unresolved: JsonObject[] = []
  for (const key of keys) {
    const values = (arm: Arm) => new Set(byArm[arm].map((map) => map.get(key)?.sha256).filter(Boolean))
    const control = values('control'); const treatment = values('treatment')
    const keyDigest = sha256Bytes(key)
    if (control.size === 1 && treatment.size === 1 && [...control][0] !== [...treatment][0]) associated.push({ span_key_sha256: keyDigest, control_values: 1, treatment_values: 1 })
    else if (control.size > 1 || treatment.size > 1 || control.size === 0 || treatment.size === 0) unresolved.push({ span_key_sha256: keyDigest, control_values: control.size, treatment_values: treatment.size })
  }
  const base = { schema_version: 'oracle-lab-phase3a-pair-analysis.v1', pair_id: input.pair_id, seed: input.seed, convergence, prompt_spans: { total: keys.length, associated, unresolved }, raw_material_persisted: false }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = argument('--input'); const out = argument('--out')
  if (!input) throw new Phase3AError('usage', 'usage: campaign.ts --input PAIR.json [--out RESULT.json]')
  const definition = JSON.parse(readFileSync(input, 'utf8')) as { pair_id: string; seed: number; rows: Array<{ repetition: number; arm: Arm; observation_file: string }> }
  const result = analyzePair({ ...definition, rows: definition.rows.map((row) => ({ ...row, observation: JSON.parse(readFileSync(row.observation_file, 'utf8')) })) })
  const bytes = `${canonicalJson(result)}\n`
  if (out) writeFileSync(out, bytes, { flag: 'wx', mode: 0o600 }); else process.stdout.write(bytes)
}
