import assert from 'node:assert/strict'

import { applyEnvironmentSetting, classifyMatrixPairRuns } from '../tools/oracle-lab/phase3a/environment-campaign.js'
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
assert.equal(environment.allowlist.ANTHROPIC_BASE_URL, 'http://127.0.0.1:19001')

assert.deepEqual(classifyMatrixPairRuns({ repetitions: 5, control_semantic_digests: ['a'], treatment_semantic_digests: ['a'], complete_cells: 10, dual_source_cells: 10 }), { status: 'REPRODUCED', effect: 'no-observed-effect', stable: true })
assert.deepEqual(classifyMatrixPairRuns({ repetitions: 5, control_semantic_digests: ['a'], treatment_semantic_digests: ['b'], complete_cells: 10, dual_source_cells: 10 }), { status: 'REPRODUCED', effect: 'semantic-change', stable: true })
assert.equal(classifyMatrixPairRuns({ repetitions: 5, control_semantic_digests: ['a', 'b'], treatment_semantic_digests: ['b'], complete_cells: 10, dual_source_cells: 10 }).status, 'UNKNOWN')

console.log(JSON.stringify({ ok: true, cases: 15 }))
