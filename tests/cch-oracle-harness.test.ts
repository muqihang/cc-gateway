import { strict as assert } from 'assert'
import { finish, test } from './helpers.js'
import { runOracleRegression, SYNTHETIC_PROMPTS, validateSyntheticPrompts } from '../tools/claude-cch-oracle-regression.js'

console.log('\ntests/cch-oracle-harness.test.ts')

test('oracle synthetic prompts meet CCH suffix safety constraints', () => {
  validateSyntheticPrompts()
  assert.equal(SYNTHETIC_PROMPTS.length >= 2, true)
  for (const prompt of SYNTHETIC_PROMPTS) {
    assert.match(prompt.text, /^[\x20-\x7e]+$/)
    assert.equal(prompt.text.length >= 21, true)
    assert.equal(new Set([prompt.text[4], prompt.text[7], prompt.text[20]]).size, 3)
  }
})

test('oracle mock harness returns only safe summary fields', async () => {
  const summary = await runOracleRegression({ mode: 'mock', version: '2.1.179' })
  assert.equal(summary.mode, 'mock')
  assert.equal(summary.targetVersion, '2.1.179')
  assert.equal(summary.sampleCount, SYNTHETIC_PROMPTS.length)
  assert.equal(summary.allCliExitOk, true)
  assert.equal(summary.allCCVersionSuffixMatch, true)
  assert.equal(summary.allCCHVerifierMatch, true)
  assert.equal(summary.allUniqueBillingHeader, true)
  assert.equal(summary.rawBodyPersisted, false)
  assert.equal(summary.rawPromptPersisted, false)
  const serialized = JSON.stringify(summary)
  for (const prompt of SYNTHETIC_PROMPTS) {
    assert.equal(serialized.includes(prompt.text), false)
  }
  assert.equal(/cch=[a-f0-9]{5}/i.test(serialized), false)
})


test('oracle mock harness fails closed for legacy version without explicit 2.1.179 proof', async () => {
  const summary = await runOracleRegression({ mode: 'mock', version: '2.1.175' })
  assert.equal(summary.mode, 'mock')
  assert.equal(summary.targetVersion, '2.1.175')
  assert.equal(summary.sampleCount, SYNTHETIC_PROMPTS.length)
  assert.equal(summary.allCliExitOk, false)
  assert.equal(summary.allCCVersionSuffixMatch, false)
  assert.equal(summary.allCCHVerifierMatch, false)
  assert.equal(summary.allUniqueBillingHeader, false)
  assert.equal(summary.rawBodyPersisted, false)
  assert.equal(summary.rawPromptPersisted, false)
  const serialized = JSON.stringify(summary)
  for (const prompt of SYNTHETIC_PROMPTS) {
    assert.equal(serialized.includes(prompt.text), false)
  }
  assert.equal(/cch=[a-f0-9]{5}/i.test(serialized), false)
})

await finish()
