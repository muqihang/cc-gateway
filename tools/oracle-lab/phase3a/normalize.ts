import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalJson, Phase3AError, sha256Bytes, sha256File } from './core.js'
import { assertPhase3A } from './schemas.js'

type JsonObject = Record<string, any>

export type NormalizedObservation = {
  schema_version: 'oracle-lab-phase3a-normalized-observation.v1'
  observation_id: string
  run_id: string
  pair_id: string
  artifact_digest: string
  request: JsonObject
  response: JsonObject
  control_plane: JsonObject
  runtime: JsonObject
  perturbation: JsonObject
  source_agreement: 'single-source' | 'two-source' | 'three-source' | 'contradicted'
  limitations: string[]
}

function json(file: string): JsonObject {
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Phase3AError('normalization_input_type', `${path.basename(file)} must be a regular file`)
  try { return JSON.parse(readFileSync(file, 'utf8')) as JsonObject }
  catch { throw new Phase3AError('normalization_input_invalid', `cannot parse ${path.basename(file)}`) }
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string'))].sort()
}

function durationBucket(milliseconds: number): string {
  if (milliseconds < 1_000) return 'lt-1s'
  if (milliseconds < 5_000) return '1s-to-5s'
  if (milliseconds < 30_000) return '5s-to-30s'
  return 'gte-30s'
}

function verifyFileBindings(directory: string, summary: JsonObject): void {
  for (const name of ['manifest', 'guard', 'observer', 'result'] as const) {
    const expected = summary[`${name}_sha256`]
    if (typeof expected !== 'string' || sha256File(path.join(directory, `${name}.json`)) !== expected) {
      throw new Phase3AError('normalization_digest_mismatch', `${name}.json does not match summary binding`)
    }
  }
}

export function normalizeCapsule(directoryInput: string): NormalizedObservation {
  const directory = path.resolve(directoryInput)
  const manifest = json(path.join(directory, 'manifest.json'))
  const guard = json(path.join(directory, 'guard.json'))
  const observer = json(path.join(directory, 'observer.json'))
  const result = json(path.join(directory, 'result.json'))
  const summary = json(path.join(directory, 'summary.json'))
  assertPhase3A('launch-manifest', manifest)
  verifyFileBindings(directory, summary)

  const runId = manifest.run_id
  if (![result.run_id, summary.run_id].every((value) => value === runId)) throw new Phase3AError('normalization_run_mismatch', 'capsule run IDs disagree')
  if (guard.status !== 'PASS' || guard.external_socket_budget !== 0 || guard.same_scope_probe !== true) throw new Phase3AError('normalization_guard_invalid', 'same-scope zero-egress guard is not PASS')
  if (guard.manifest_sha256 !== sha256Bytes(canonicalJson(manifest))) throw new Phase3AError('normalization_guard_mismatch', 'guard does not bind the canonical manifest')
  if (observer.raw_material_persisted !== false || result.raw_output_persisted !== false || summary.raw_material_persisted !== false) {
    throw new Phase3AError('normalization_raw_material', 'capsule declares persisted raw material')
  }

  const events = Array.isArray(observer.events) ? observer.events as JsonObject[] : []
  const first = events[0] ?? {}
  const primary = events.find((event) => event.request_class === 'messages' || (event.method === 'POST' && String(event.path_class).endsWith('/messages'))) ?? first
  const headerNames = unique(events.flatMap((event) => Array.isArray(event.header_names) ? event.header_names : []))
  const headerClasses: Record<string, string> = {}
  for (const name of headerNames) {
    const classes = unique(events.map((event) => event.header_value_classes?.[name]))
    headerClasses[name] = classes.length === 1 ? classes[0] : 'varied'
  }
  const lineage = new Map<string, JsonObject>()
  for (const sample of Array.isArray(result.process_samples) ? result.process_samples : []) {
    const key = `${sample.executable_class}:${sample.executable_sha256 ?? 'unresolved'}`
    lineage.set(key, { executable_class: sample.executable_class, executable_sha256: sample.executable_sha256 ?? null })
  }
  const missingSources = unique([
    manifest.capture.tls ? null : 'tls', manifest.capture.pcap ? null : 'pcap', manifest.capture.hook ? null : 'hook',
    manifest.capture.inspector ? null : 'inspector', events.length === 0 ? 'http' : null,
  ])
  const limitations = unique([
    `cell-status:${String(result.status)}`,
    'single-observation-only',
    ...missingSources.map((source) => `source-unavailable:${source}`),
    primary.system_summary?.status === 'observed' ? null : 'system-prompt-not-observed',
    primary.cch_class && primary.cch_class !== 'not-observed' ? null : 'cch-not-observed',
    events.some((event) => String(event.response_class).includes('sse')) ? null : 'sse-not-observed', 'compact-not-observed',
  ])
  const instrumented = manifest.capture.hook === true || manifest.capture.inspector === true
  const emptySha = sha256Bytes('')
  const observation: NormalizedObservation = {
    schema_version: 'oracle-lab-phase3a-normalized-observation.v1',
    observation_id: `obs:${runId}`,
    run_id: runId,
    pair_id: manifest.pair_id,
    artifact_digest: manifest.artifact.entrypoint_sha256,
    request: {
      endpoint_class: events.length === 0 ? 'not-observed' : unique(events.map((event) => `${event.method}:${event.path_class}`)).join(','),
      header_names: headerNames,
      header_value_classes: headerClasses,
      body_ast_topology: primary.body_topology ?? { coverage: 'not-observed' },
      cch_class: primary.cch_class ?? 'not-observed',
      system_summary: primary.system_summary
        ? { byte_length: primary.system_summary.byte_length, sha256: primary.system_summary.sha256, stable_spans: primary.system_summary.span_hashes ?? [], ast_topology: primary.system_summary.ast_topology }
        : { byte_length: 0, sha256: emptySha, stable_spans: [], ast_topology: { coverage: 'not-observed' } },
      serialized_bytes_sha256: typeof primary.body_sha256 === 'string' ? primary.body_sha256 : emptySha,
    },
    response: {
      http_sse_ast: { response_classes: unique(events.map((event) => event.response_class)) },
      event_order: events.map((event) => String(event.response_class)),
      partial_output_topology: { coverage: 'not-observed' },
      compact_fields: { coverage: 'not-observed' },
      prompt_cache_fields: { coverage: 'not-observed' },
      terminal_state: String(result.status),
      retry_eligibility: Number(result.retry_events ?? 0) > 0,
    },
    control_plane: {
      destination_classes: events.length > 0 ? ['declared-loopback'] : [],
      event_schemas: unique(events.map((event) => event.response_class)).map((response_class) => ({ response_class })),
      timing_buckets: [durationBucket(Number(result.duration_ms ?? 0))],
    },
    runtime: {
      process_lineage: [...lineage.values()].sort((left, right) => canonicalJson(left) < canonicalJson(right) ? -1 : canonicalJson(left) > canonicalJson(right) ? 1 : 0),
      exec_digests: unique([...lineage.values()].map((entry) => entry.executable_sha256)),
      environment_access: [], filesystem_events: [], dns_events: [], socket_events: [], tls_events: [],
      http_events: events.map((event) => ({ sequence: event.sequence, method: event.method, path_class: event.path_class, body_bytes: event.body_bytes, body_sha256: event.body_sha256, response_class: event.response_class })),
      timers: [{ bucket: durationBucket(Number(result.duration_ms ?? 0)) }],
      retries: Number(result.retry_events ?? 0) === 0 ? [] : [{ count: Number(result.retry_events) }],
    },
    perturbation: {
      instrumented,
      control_run_id: runId,
      differences: instrumented ? ['instrumentation-control-not-normalized'] : [],
      missing_sources: missingSources,
      profile_usable: false,
    },
    source_agreement: 'single-source',
    limitations,
  }
  assertPhase3A('normalized-observation', observation)
  return observation
}

export function normalizeBaselineSet(capsulesRoot: string, runIds = ['active-baseline-002', 'active-baseline-003', 'active-baseline-004', 'active-baseline-005', 'active-baseline-006', 'active-baseline-007']): NormalizedObservation[] {
  return [...runIds].sort().map((runId) => normalizeCapsule(path.join(capsulesRoot, runId)))
}

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const capsule = argument('--capsule')
  const root = argument('--capsules-root')
  const out = argument('--out')
  if ((!capsule && !root) || (capsule && root)) throw new Phase3AError('usage', 'use exactly one of --capsule DIR or --capsules-root DIR')
  const normalized = capsule ? normalizeCapsule(capsule) : normalizeBaselineSet(root!)
  const serialized = `${canonicalJson(normalized)}\n`
  if (out) {
    mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 })
    writeFileSync(out, serialized, { flag: 'wx', mode: 0o600 })
    process.stdout.write(`${canonicalJson({ out, sha256: sha256File(out) })}\n`)
  } else process.stdout.write(serialized)
}
