import assert from 'node:assert/strict'

import { analyzePair, convergenceProjection } from '../tools/oracle-lab/phase3a/campaign.js'

console.log('\ntests/oracle-phase3a-campaign.test.ts')

function observation(run_id: string, arm: 'control' | 'treatment', repetition: number): any {
  return { run_id, artifact_digest: 'a'.repeat(64), request: { endpoint_class: 'POST:/v1/messages', header_names: [], header_value_classes: {}, body_ast_topology: { value: 'b'.repeat(64) }, cch_class: 'body-cache-control', system_summary: { byte_length: 10, stable_spans: [{ path_sha256: 'c'.repeat(64), ordinal: 0, byte_length: 4, sha256: (arm === 'control' ? 'd' : 'e').repeat(64) }, { path_sha256: 'f'.repeat(64), ordinal: 0, byte_length: 2, sha256: String(repetition).padStart(64, '0') }] } }, response: { http_sse_ast: {}, event_order: [], terminal_state: 'complete', retry_eligibility: false }, runtime: { exec_digests: ['a'.repeat(64)], process_lineage: [] }, source_agreement: 'two-source' }
}
const rows = Array.from({ length: 5 }, (_, repetition) => (repetition % 2 === 0 ? ['control', 'treatment'] : ['treatment', 'control']).map((arm) => ({ repetition, arm: arm as 'control' | 'treatment', observation: observation(`${repetition}-${arm}`, arm as any, repetition) }))).flat()
const result: any = analyzePair({ pair_id: 'pair', seed: 1, rows })
assert.equal(result.convergence.status, 'CONVERGED')
assert.equal(result.prompt_spans.associated.length, 1)
assert.equal(result.prompt_spans.unresolved.length, 1)
assert.equal(JSON.stringify(result).includes('synthetic'), false)
assert.equal((convergenceProjection(rows[0].observation) as any).request.body_ast_shape.value, '<sha256>')
console.log(JSON.stringify({ ok: true, associated: 1, unresolved: 1 }))
