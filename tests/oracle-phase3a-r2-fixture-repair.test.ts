import assert from 'node:assert/strict'

import { SAFE_ERROR_CATEGORIES } from '../tools/oracle-lab/phase3a/safe-error-classifier.js'
import { classifySafeDiagnosticText } from '../tools/oracle-lab/phase3a/safe-diagnostic.js'
import { classifyUpdateReleasePath } from '../tools/oracle-lab/phase3a/observers/update-loopback-proxy.js'
import { buildR2GapFamilySummary, R2_GAP_CASES, runUpdateLoopbackFixtureSelfTest, selectedR2GapCases, sessionStatePaths } from '../tools/oracle-lab/phase3a/r2-gap-campaign.js'

console.log('\ntests/oracle-phase3a-r2-fixture-repair.test.ts')

const diagnosticMarker = 'r2-private-diagnostic-marker'
const diagnostic = classifySafeDiagnosticText(`transport timeout while using an api key: ${diagnosticMarker}`)
assert.deepEqual(diagnostic.categories, ['authentication', 'transport'])
assert.ok(diagnostic.categories.every((category) => (SAFE_ERROR_CATEGORIES as readonly string[]).includes(category)))
assert.equal(JSON.stringify(diagnostic).includes(diagnosticMarker), false)
assert.deepEqual(Object.keys(diagnostic).sort(), ['categories', 'raw_content_persisted', 'schema_version'])
assert.equal(classifyUpdateReleasePath('/claude-code-releases/stable'), 'version-check')
assert.equal(classifyUpdateReleasePath('/claude-code-releases/2.1.215/manifest.json'), 'manifest')
assert.equal(classifyUpdateReleasePath('/claude-code-releases/2.1.215/darwin-arm64/claude'), 'binary')
assert.equal(classifyUpdateReleasePath('/not-a-release-route'), 'unsupported')

const updateSelfTest = await runUpdateLoopbackFixtureSelfTest()
assert.deepEqual(updateSelfTest, {
  schema_version: 'oracle-lab-phase3a-update-loopback-self-test.v1',
  status: 'PASS',
  request: { method: 'HEAD', path_class: '/' },
  response: { status: 204, response_class: 'update:root-head' },
  version_check: { transport: 'loopback-tls-proxy', response_class: 'current-version' },
  raw_content_persisted: false,
})

const init = sessionStatePaths('r2-gap-fixture-test', R2_GAP_CASES[3], 'r2-gap-fixture-test-restart-resume-init')
const resume = sessionStatePaths('r2-gap-fixture-test', R2_GAP_CASES[4], 'r2-gap-fixture-test-restart-resume-resume')
assert.deepEqual(init, resume)
assert.deepEqual(init, {
  home: 'r2-gap-state/r2-gap-fixture-test/shared-resume-state/home',
  xdg: 'r2-gap-state/r2-gap-fixture-test/shared-resume-state/xdg',
  cwd: 'r2-gap-state/r2-gap-fixture-test/shared-resume-state/cwd',
})

assert.deepEqual(selectedR2GapCases(['restart-resume-resume', 'telemetry-update']).map((entry) => entry.id), ['telemetry-update', 'restart-resume-resume'])
assert.throws(() => selectedR2GapCases(['telemetry-update', 'telemetry-update']), /duplicate/)
assert.throws(() => selectedR2GapCases(['not-a-cell']), /unknown/)

const updateBoundary = buildR2GapFamilySummary('telemetry-diagnostic-update-error-traffic', [{ command_label: 'update', status: 'failed', update_fixture_outcome: 'no-platform' }])
assert.equal(updateBoundary.failure_classification, 'update-no-platform-safe-boundary')
assert.match(String(updateBoundary.reason), /no-platform/)

console.log(JSON.stringify({ ok: true, cases: 19 }))
