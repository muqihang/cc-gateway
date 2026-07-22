import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalJson, Phase3AError, sha256Bytes, sha256File } from './core.js'

type Batch = { family: string; signatures: string[] }

function fail(code: string, message: string): never { throw new Phase3AError(code, message) }

export function analyzeSaturation(input: { baseline_signatures: string[]; batches: Batch[] }): Record<string, any> {
  if (input.batches.length !== 3 || new Set(input.batches.map((batch) => batch.family)).size !== 3) fail('saturation_batch_invalid', 'saturation requires exactly three distinct trigger families')
  const known = new Set(input.baseline_signatures)
  const batches = input.batches.map((batch) => {
    const signatures = [...new Set(batch.signatures)].sort()
    const added = signatures.filter((signature) => !known.has(signature))
    for (const signature of signatures) known.add(signature)
    return { family: batch.family, signature_count: signatures.length, signatures_sha256: sha256Bytes(canonicalJson(signatures)), new_signatures: added }
  })
  const consecutive = batches.reduce((count, batch) => batch.new_signatures.length === 0 ? count + 1 : 0, 0)
  const base = { schema_version: 'oracle-lab-phase3a-saturation.v1', status: consecutive === 3 ? 'SATURATED' : 'NOT_SATURATED', baseline_signature_count: new Set(input.baseline_signatures).size, terminal_signature_count: known.size, consecutive_no_new_batches: consecutive, batches }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

function pairSummaries(directory: string): Array<Record<string, any>> {
  const pairs = path.join(directory, 'pairs')
  return readdirSync(pairs, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    const file = path.join(pairs, entry.name, 'summary.json')
    try { return [JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>] } catch { return [] }
  })
}

function signatures(rows: Array<Record<string, any>>): string[] {
  const output = new Set<string>()
  for (const row of rows) {
    output.add(`family:${String(row.family)}`); output.add(`effect:${String(row.effect)}`); output.add(`pair-status:${String(row.status)}`)
    for (const run of Array.isArray(row.runs) ? row.runs : []) {
      output.add(`terminal:${String(run.status)}`); output.add(`source-count:${String(run.source_count ?? 0)}`)
      output.add(`hook:${run.hook_event_count > 0}`); output.add(`observer:${run.observer_event_count > 0}`); output.add(`proxy:${run.proxy_event_count > 0}`)
    }
  }
  return [...output].sort()
}

function directorySummaryDigest(directory: string): string {
  const summary = path.join(directory, 'summary.json')
  if (existsSync(summary)) return sha256File(summary)
  const pairFiles = readdirSync(path.join(directory, 'pairs'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => path.join(directory, 'pairs', entry.name, 'summary.json')).filter(existsSync).sort()
  return sha256Bytes(canonicalJson(pairFiles.map((file) => sha256File(file))))
}

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const baselineCore = argument('--baseline-core'); const baselineProvider = argument('--baseline-provider'); const baselineSupplement = argument('--baseline-supplement')
  const routing = argument('--routing'); const region = argument('--region'); const auth = argument('--auth'); const out = argument('--out')
  if (!baselineCore || !baselineProvider || !baselineSupplement || !routing || !region || !auth || !out) fail('usage', 'saturation requires three baseline and three batch directories plus --out')
  const baselineRows = [...pairSummaries(baselineCore), ...pairSummaries(baselineProvider), ...pairSummaries(baselineSupplement)]
  const result = analyzeSaturation({ baseline_signatures: signatures(baselineRows), batches: [
    { family: 'routing', signatures: signatures(pairSummaries(routing)) },
    { family: 'region', signatures: signatures(pairSummaries(region)) },
    { family: 'auth', signatures: signatures(pairSummaries(auth)) },
  ] })
  const bound = { ...result, input_summary_sha256: [baselineCore, baselineProvider, baselineSupplement, routing, region, auth].map(directorySummaryDigest) }
  writeFileSync(out, `${canonicalJson(bound)}\n`, { flag: 'wx', mode: 0o600 }); process.stdout.write(`${canonicalJson(bound)}\n`)
}
