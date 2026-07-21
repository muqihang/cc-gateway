import assert from 'node:assert/strict'

import { applyEnvironmentSetting, classifyMatrixPairRuns, reclassifyMatrixPairSummary } from '../tools/oracle-lab/phase3a/environment-campaign.js'
import type { MatrixSetting } from '../tools/oracle-lab/phase3a/environment-matrix.js'
import type { LaunchManifest } from '../tools/oracle-lab/phase3a/launch-manifest.js'

console.log('\ntests/oracle-phase3a-environment-campaign.test.ts')

const environment: LaunchManifest['environment'] = {
  allowlist: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:19001', ANTHROPIC_API_KEY: 'oracle-phase3a-placeholder:baseline' },
  explicit_empty: [], unset: ['ANTHROPIC_AUTH_TOKEN'], home: 'runs/base/home', xdg: 'runs/base/xdg', tmp: 'runs/base/tmp',
  tz: 'UTC', lang: 'C', lc_all: 'C', base_urls: ['http://127.0.0.1:19001'],
}
const apply = (setting: MatrixSetting) => applyEnvironmentSetting(environment, setting, { loopback_base: 'http://127.0.0.1:19002', evidence_root: '/tmp/phase3a-evidence' })
const unset = apply({ variable: 'ANTHROPIC_BASE_URL', state: 'unset', value_class: 'unset' })
assert.equal(unset.allowlist.ANTHROPIC_BASE_URL, undefined)
assert.ok(unset.unset.includes('ANTHROPIC_BASE_URL'))
assert.ok(!unset.explicit_empty.includes('ANTHROPIC_BASE_URL'))
const empty = apply({ variable: 'ANTHROPIC_BASE_URL', state: 'empty', value_class: 'empty' })
assert.equal(empty.allowlist.ANTHROPIC_BASE_URL, undefined)
assert.ok(empty.explicit_empty.includes('ANTHROPIC_BASE_URL'))
assert.ok(!empty.unset.includes('ANTHROPIC_BASE_URL'))
const neutral = apply({ variable: 'ANTHROPIC_BASE_URL', state: 'value', value_class: 'loopback-neutral', value_template: 'LOOPBACK_BASE' })
assert.equal(neutral.allowlist.ANTHROPIC_BASE_URL, 'http://127.0.0.1:19002')
assert.deepEqual(neutral.base_urls, ['http://127.0.0.1:19002'])
const reserved = applyEnvironmentSetting(environment, { variable: 'ANTHROPIC_BASE_URL', state: 'value', value_class: 'aliyun', value_template: 'http://aliyun.phase3a.test:LOOPBACK_PROXY_PORT' }, { loopback_base: 'http://127.0.0.1:19002', loopback_proxy_port: 19003, evidence_root: '/tmp/phase3a-evidence' })
assert.equal(reserved.allowlist.ANTHROPIC_BASE_URL, 'http://aliyun.phase3a.test:19003')
assert.deepEqual(reserved.base_urls, ['http://aliyun.phase3a.test:19003'])
assert.equal(environment.allowlist.ANTHROPIC_BASE_URL, 'http://127.0.0.1:19001')

const classified = (overrides: Record<string, unknown> = {}) => classifyMatrixPairRuns({ repetitions: 5, control_semantic_digests: ['a'], treatment_semantic_digests: ['a'], terminal_cells: 10, dual_source_cells: 10, protocol_cells: 10, complete_schedule: true, ...overrides })
assert.deepEqual(classified(), { status: 'REPRODUCED', effect: 'no-observed-effect', stable: true })
assert.deepEqual(classified({ treatment_semantic_digests: ['b'] }), { status: 'REPRODUCED', effect: 'semantic-change', stable: true })
assert.equal(classified({ control_semantic_digests: ['a', 'b'], treatment_semantic_digests: ['b'] }).status, 'UNKNOWN')
assert.equal(classified({ terminal_cells: 9 }).status, 'UNKNOWN')
assert.equal(classified({ protocol_cells: 9 }).status, 'UNKNOWN')
const timeoutRuns = Array.from({ length: 10 }, (_, index) => ({
  arm: index % 2 === 0 ? 'control' : 'treatment', repetition: Math.floor(index / 2), status: 'timeout', semantic_sha256: index % 2 === 0 ? 'a' : 'b',
  hook_event_count: 1, observer_event_count: 0, process_samples: 2, dual_source: false,
}))
assert.deepEqual(reclassifyMatrixPairSummary({ pair_id: 'timeout-pair', status: 'UNKNOWN', repetitions: 5, runs: timeoutRuns }), {
  pair_id: 'timeout-pair', original_status: 'UNKNOWN', status: 'UNKNOWN', effect: 'semantic-change', stable: true,
  repetitions: 5, terminal_cells: 10, dual_source_cells: 10, protocol_cells: 0, complete_schedule: true,
})

console.log(JSON.stringify({ ok: true, cases: 20 }))
