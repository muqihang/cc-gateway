import assert from 'node:assert/strict'

import { analyzePair, convergenceProjection } from '../tools/oracle-lab/phase3a/campaign.js'
import { balancedPairOrder } from '../tools/oracle-lab/phase3a/converge.js'
import { Phase3AError } from '../tools/oracle-lab/phase3a/core.js'

console.log('\ntests/oracle-phase3a-campaign.test.ts')

function observation(run_id: string, arm: 'control' | 'treatment', repetition: number): any {
  return { run_id, artifact_digest: 'a'.repeat(64), request: { endpoint_class: 'POST:/v1/messages', header_names: [], header_value_classes: {}, body_ast_topology: { value: 'b'.repeat(64) }, cch_class: 'body-cache-control', system_summary: { byte_length: 10, stable_spans: [{ path_sha256: 'c'.repeat(64), ordinal: 0, byte_length: 4, sha256: (arm === 'control' ? 'd' : 'e').repeat(64) }, { path_sha256: 'f'.repeat(64), ordinal: 0, byte_length: 2, sha256: String(repetition).padStart(64, '0') }] } }, response: { http_sse_ast: {}, event_order: [], terminal_state: 'complete', retry_eligibility: false }, runtime: { exec_digests: ['a'.repeat(64)], process_lineage: [] }, source_agreement: 'two-source' }
}
const rows = balancedPairOrder(1, 5).flatMap((order, repetition) => order.map((arm, position) => ({ repetition, sequence_index: repetition * 2 + position, arm, observation: observation(`${repetition}-${arm}`, arm, repetition) })))
const result: any = analyzePair({ pair_id: 'pair', seed: 1, rows })
const reversedResult: any = analyzePair({ pair_id: 'pair', seed: 1, rows: [...rows].reverse() })
assert.equal(result.convergence.status, 'CONVERGED')
assert.equal(result.schedule_validated, true)
assert.equal(reversedResult.deterministic_digest, result.deterministic_digest)
assert.equal(result.prompt_spans.associated.length, 1)
assert.equal(result.prompt_spans.unresolved.length, 1)
assert.equal(JSON.stringify(result).includes('synthetic'), false)
assert.equal((convergenceProjection(rows[0].observation) as any).request.body_ast_shape.value, '<sha256>')
const scheduleError = (error: unknown) => error instanceof Phase3AError && error.code === 'campaign_schedule_mismatch'
assert.throws(() => analyzePair({ pair_id: 'pair', seed: 2, rows }), scheduleError)
assert.throws(() => analyzePair({ pair_id: 'pair', seed: 1, rows: rows.map((row, index) => index === 0 ? { ...row, sequence_index: 1 } : row) }), scheduleError)
assert.throws(() => analyzePair({ pair_id: 'pair', seed: 1, rows: rows.slice(1) }), scheduleError)
assert.throws(() => analyzePair({ pair_id: 'pair', seed: 1, rows: rows.map((row, index) => index < 2 ? { ...row, arm: rows[1 - index].arm } : row) }), scheduleError)
console.log(JSON.stringify({ ok: true, associated: 1, unresolved: 1 }))
