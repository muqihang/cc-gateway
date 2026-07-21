import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalJson, Phase3AError, sha256Bytes, sha256File } from './core.js'
import type { EnvironmentMatrix } from './environment-matrix.js'

type ClosureRow = { pair_id: string; status: string; effect: string; source: string; source_sha256: string }
type ExpectedRow = { pair_id: string; family: string }

function fail(code: string, message: string): never { throw new Phase3AError(code, message) }

export function closeEnvironmentMatrix(input: { matrix_sha256: string; expected: ExpectedRow[]; rows: ClosureRow[] }): Record<string, any> {
  if (!/^[a-f0-9]{64}$/.test(input.matrix_sha256)) fail('invalid_digest', 'matrix digest must be SHA-256')
  const expected = new Map(input.expected.map((row) => [row.pair_id, row]))
  if (expected.size !== input.expected.length) fail('matrix_closure_duplicate', 'expected matrix contains a duplicate pair')
  const observed = new Map<string, ClosureRow>()
  for (const row of input.rows) {
    if (observed.has(row.pair_id)) fail('matrix_closure_duplicate', `duplicate pair in closure rows: ${row.pair_id}`)
    if (!expected.has(row.pair_id)) fail('matrix_closure_unexpected', `unexpected pair in closure rows: ${row.pair_id}`)
    if (row.status !== 'REPRODUCED' || !/^[a-f0-9]{64}$/.test(row.source_sha256)) fail('matrix_closure_incomplete', `pair is not reproduced or digest-bound: ${row.pair_id}`)
    observed.set(row.pair_id, row)
  }
  if (observed.size !== expected.size) fail('matrix_closure_coverage', `matrix closure coverage mismatch: expected ${expected.size}, observed ${observed.size}`)
  const pairs = input.expected.map((row) => ({ ...observed.get(row.pair_id)!, family: row.family }))
  const effects = pairs.reduce<Record<string, number>>((counts, row) => { counts[row.effect] = (counts[row.effect] ?? 0) + 1; return counts }, {})
  const families = pairs.reduce<Record<string, number>>((counts, row) => { counts[row.family] = (counts[row.family] ?? 0) + 1; return counts }, {})
  const base = { schema_version: 'oracle-lab-phase3a-environment-matrix-closure.v1', status: 'PASS', matrix_sha256: input.matrix_sha256, pair_count: pairs.length, families, effects, pairs, external_socket_budget: 0, raw_material_persisted: false }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const matrixFile = argument('--matrix'); const coreFile = argument('--core-reclassification')
  const providerDirectory = argument('--provider-campaign'); const supplementDirectory = argument('--provider-supplement'); const out = argument('--out')
  if (!matrixFile || !coreFile || !providerDirectory || !supplementDirectory || !out) fail('usage', 'environment-closure requires --matrix, --core-reclassification, --provider-campaign, --provider-supplement, and --out')
  const matrix = JSON.parse(readFileSync(matrixFile, 'utf8')) as EnvironmentMatrix
  const core = JSON.parse(readFileSync(coreFile, 'utf8')) as { pairs: Array<Record<string, any>> }
  const coreRows = new Map(core.pairs.filter((row) => row.status === 'REPRODUCED').map((row) => [row.pair_id, row]))
  const rows: ClosureRow[] = matrix.pairs.map((pair, index) => {
    const coreRow = coreRows.get(pair.pair_id)
    if (coreRow) return { pair_id: pair.pair_id, status: coreRow.status, effect: coreRow.effect, source: 'core-reclassification', source_sha256: sha256File(coreFile) }
    const relative = path.join('pairs', String(index).padStart(2, '0'), 'summary.json')
    const candidate = existsSync(path.join(providerDirectory, relative)) ? path.join(providerDirectory, relative) : path.join(supplementDirectory, relative)
    if (!existsSync(candidate)) fail('matrix_closure_coverage', `no provider summary for ${pair.pair_id}`)
    const row = JSON.parse(readFileSync(candidate, 'utf8')) as Record<string, any>
    return { pair_id: row.pair_id, status: row.status, effect: row.effect, source: candidate.startsWith(path.resolve(providerDirectory)) ? 'provider-campaign' : 'provider-supplement', source_sha256: sha256File(candidate) }
  })
  const result = closeEnvironmentMatrix({ matrix_sha256: sha256File(matrixFile), expected: matrix.pairs.map((pair) => ({ pair_id: pair.pair_id, family: pair.family })), rows })
  writeFileSync(out, `${canonicalJson(result)}\n`, { flag: 'wx', mode: 0o600 })
  process.stdout.write(`${canonicalJson(result)}\n`)
}
