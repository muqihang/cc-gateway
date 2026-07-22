import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalJson, Phase3AError, sha256Bytes, sha256File } from './core.js'
import { classifyScenarioPairRuns, SCENARIO_PAIRS } from './scenario-campaign.js'

type Row = { pair_id: string; status: string; effect: string; source_sha256: string }
function fail(code: string, message: string): never { throw new Phase3AError(code, message) }

export function closeScenarioPairs(expectedIds: string[], rows: Row[]): Record<string, any> {
  const byId = new Map<string, Row>()
  for (const row of rows) {
    if (byId.has(row.pair_id)) fail('scenario_closure_duplicate', `duplicate scenario pair: ${row.pair_id}`)
    if (row.status !== 'REPRODUCED' || !/^[a-f0-9]{64}$/.test(row.source_sha256)) fail('scenario_closure_incomplete', `scenario pair is not reproduced: ${row.pair_id}`)
    byId.set(row.pair_id, row)
  }
  if (byId.size !== expectedIds.length || expectedIds.some((id) => !byId.has(id))) fail('scenario_closure_coverage', `scenario coverage mismatch: expected ${expectedIds.length}, observed ${byId.size}`)
  const pairs = expectedIds.map((id) => byId.get(id)!)
  const effects = pairs.reduce<Record<string, number>>((counts, row) => { counts[row.effect] = (counts[row.effect] ?? 0) + 1; return counts }, {})
  const base = { schema_version: 'oracle-lab-phase3a-scenario-closure.v1', status: 'PASS', pair_count: pairs.length, effects, pairs, external_socket_budget: 0, raw_material_persisted: false }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const primary = argument('--primary'); const http500 = argument('--http500'); const http529 = argument('--http529')
  const reset = argument('--reset'); const partial = argument('--partial'); const complete = argument('--complete'); const out = argument('--out')
  if (!primary || !http500 || !http529 || !reset || !partial || !complete || !out) fail('usage', 'scenario-closure requires primary, five supplements, and out')
  const sources = [
    ...[0, 1, 2, 3].map((index) => path.join(primary, 'pairs', String(index).padStart(2, '0'), 'summary.json')),
    path.join(http500, 'pairs/04/summary.json'), path.join(http529, 'pairs/05/summary.json'), path.join(reset, 'pairs/06/summary.json'),
    path.join(partial, 'pairs/07/summary.json'), path.join(complete, 'pairs/08/summary.json'),
  ]
  const rows = sources.map((file) => {
    const row = JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>
    const classified = classifyScenarioPairRuns({ repetitions: Number(row.repetitions), runs: row.runs })
    return { pair_id: row.pair_id, status: classified.status, effect: classified.effect, source_sha256: sha256File(file) }
  })
  const result = closeScenarioPairs(SCENARIO_PAIRS.map((pair) => pair.pair_id), rows)
  writeFileSync(out, `${canonicalJson(result)}\n`, { flag: 'wx', mode: 0o600 }); process.stdout.write(`${canonicalJson(result)}\n`)
}
