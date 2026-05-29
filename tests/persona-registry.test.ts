import { strict as assert } from 'assert'
import { finish, test } from './helpers.js'
import { getPersonaProfile, resolvePersonaProfileId } from '../src/persona-registry.js'

console.log('\ntests/persona-registry.test.ts')

test('registry exposes verified 2.1.150 subscription 1m persona with full capability set', () => {
  const profile = getPersonaProfile('claude_code_2_1_150_subscription_1m')
  assert.ok(profile)
  assert.equal(profile.id, 'claude_code_2_1_150_subscription_1m')
  assert.equal(profile.version, '2.1.150')
  assert.equal(profile.messageBetaProfile, 'claude_code_2_1_150_subscription_1m')
  assert.equal(profile.capabilities.context_1m, true)
  assert.equal(profile.capabilities.tools, true)
  assert.equal(profile.capabilities.thinking, true)
  assert.equal(profile.capabilities.context_management, true)
  assert.equal(profile.capabilities.stream, true)
  assert.equal(profile.capabilities.max_tokens, 32000)
  assert.ok(profile.knownModels.includes('claude-opus-4-7'))
  assert.equal(profile.knownModels.includes('claude-opus-4-8'), true)
  assert.ok(profile.knownModels.includes('claude-opus-4-6-thinking'))
})

test('persona variant aliases resolve to registry profile ids', () => {
  assert.equal(resolvePersonaProfileId('claude-code-2.1.150-macos-local'), 'claude_code_2_1_150_subscription_1m')
  assert.equal(resolvePersonaProfileId('claude_code_2_1_150_subscription_1m'), 'claude_code_2_1_150_subscription_1m')
  assert.equal(resolvePersonaProfileId('unknown-variant'), null)
})

await finish()
