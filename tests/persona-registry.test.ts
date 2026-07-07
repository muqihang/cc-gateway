import { strict as assert } from 'assert'
import { finish, test } from './helpers.js'
import { getPersonaProfile, resolvePersonaProfileId } from '../src/persona-registry.js'

console.log('\ntests/persona-registry.test.ts')

test('registry exposes 2.1.175 final subscription 1m persona with full capability set', () => {
  const profile = getPersonaProfile('claude_code_2_1_175_subscription_1m')
  assert.ok(profile)
  assert.equal(profile.id, 'claude_code_2_1_175_subscription_1m')
  assert.equal(profile.version, '2.1.175')
  assert.equal(profile.messageBetaProfile, 'claude_code_2_1_175_subscription_1m')
  assert.equal(profile.capabilities.context_1m, true)
  assert.equal(profile.capabilities.tools, true)
  assert.equal(profile.capabilities.thinking, true)
  assert.equal(profile.capabilities.context_management, true)
  assert.equal(profile.capabilities.stream, true)
  assert.equal(profile.capabilities.max_tokens, 32000)
  assert.ok(profile.betaHeader.includes('mid-conversation-system-2026-04-07'))
  assert.equal(profile.knownModels.includes('claude-opus-4-8'), true)
  assert.equal(profile.knownModels.includes('claude-fable-5'), true)
})

test('registry keeps 2.1.170 interim persona as explicit rollback profile', () => {
  const profile = getPersonaProfile('claude_code_2_1_170_subscription_1m')
  assert.ok(profile)
  assert.equal(profile.id, 'claude_code_2_1_170_subscription_1m')
  assert.equal(profile.version, '2.1.170')
  assert.equal(profile.messageBetaProfile, 'claude_code_2_1_170_subscription_1m')
  assert.equal(profile.knownModels.includes('claude-opus-4-8'), true)
  assert.equal(profile.knownModels.includes('claude-fable-5'), true)
})

test('registry keeps verified 2.1.150 subscription 1m persona as explicit legacy profile', () => {
  const profile = getPersonaProfile('claude_code_2_1_150_subscription_1m')
  assert.ok(profile)
  assert.equal(profile.id, 'claude_code_2_1_150_subscription_1m')
  assert.equal(profile.version, '2.1.150')
  assert.equal(profile.messageBetaProfile, 'claude_code_2_1_150_subscription_1m')
  assert.equal(profile.knownModels.includes('claude-opus-4-8'), true)
})


test('registry separates captured 2.1.175 subscription 1m and api-key non-1m profiles', () => {
  const subscription = getPersonaProfile('claude_code_2_1_175_subscription_1m')
  const apiKey = getPersonaProfile('claude_code_2_1_175_api_key_non_1m')

  assert.equal(subscription.version, '2.1.175')
  assert.equal(apiKey.version, '2.1.175')
  assert.equal(subscription.messageBetaProfile, 'claude_code_2_1_175_subscription_1m')
  assert.equal(apiKey.messageBetaProfile, 'claude_code_2_1_175_api_key_non_1m')
  assert.equal(subscription.capabilities.context_1m, true)
  assert.equal(apiKey.capabilities.context_1m, false)
  assert.equal(subscription.capabilities.tools, true)
  assert.equal(apiKey.capabilities.tools, true)
  assert.equal(subscription.betaHeader, 'claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,effort-2025-11-24')
  assert.equal(apiKey.betaHeader, 'claude-code-20250219,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,effort-2025-11-24')
  assert.equal(apiKey.knownModels.includes('claude-opus-4-8'), true)
  assert.equal(apiKey.knownModels.includes('claude-fable-5'), true)
})

test('registry documents 2.1.175 simple bare profile as distinct low-tool shape', () => {
  const profile = getPersonaProfile('claude_code_2_1_175_simple_bare')
  assert.equal(profile.version, '2.1.175')
  assert.equal(profile.messageBetaProfile, 'claude_code_2_1_175_simple_bare')
  assert.deepEqual(profile.toolProfile, { kind: 'low_tool', toolCount: 3, toolNames: ['Bash', 'Edit', 'Read'] })
  assert.equal(profile.capabilities.context_1m, false)
  assert.equal(profile.capabilities.tools, true)
  assert.equal(profile.capabilities.thinking, true)
  assert.equal(profile.capabilities.context_management, true)
  assert.equal(profile.capabilities.stream, true)
  assert.equal(profile.capabilities.max_tokens, 64000)
  assert.equal(profile.betaHeader, 'claude-code-20250219,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,effort-2025-11-24')
})

test('2.1.197 profile uses neutral native id while preserving macOS local alias', () => {
  const profile = getPersonaProfile('claude_code_2_1_197_native')
  assert.equal(profile.id, 'claude_code_2_1_197_native')
  assert.equal(profile.version, '2.1.197')
  assert.equal(profile.messageBetaProfile, 'claude_code_2_1_197_native')
  assert.equal(resolvePersonaProfileId('claude-code-2.1.197-macos-local'), 'claude_code_2_1_197_native')
  assert.equal(resolvePersonaProfileId('claude_code_2_1_197_sonnet5'), 'claude_code_2_1_197_native')
  assert.doesNotMatch(JSON.stringify(profile), /sonnet5/i)
})

test('persona variant aliases resolve to registry profile ids', () => {
  assert.equal(resolvePersonaProfileId('claude-code-2.1.175-macos-local'), 'claude_code_2_1_175_subscription_1m')
  assert.equal(resolvePersonaProfileId('claude_code_2_1_175_subscription_1m'), 'claude_code_2_1_175_subscription_1m')
  assert.equal(resolvePersonaProfileId('claude-code-2.1.170-macos-local'), 'claude_code_2_1_170_subscription_1m')
  assert.equal(resolvePersonaProfileId('claude_code_2_1_170_subscription_1m'), 'claude_code_2_1_170_subscription_1m')
  assert.equal(resolvePersonaProfileId('claude-code-2.1.150-macos-local'), 'claude_code_2_1_150_subscription_1m')
  assert.equal(resolvePersonaProfileId('claude_code_2_1_150_subscription_1m'), 'claude_code_2_1_150_subscription_1m')
  assert.equal(resolvePersonaProfileId('claude_code_2_1_175_api_key_non_1m'), 'claude_code_2_1_175_api_key_non_1m')
  assert.equal(resolvePersonaProfileId('claude_code_2_1_175_simple_bare'), 'claude_code_2_1_175_simple_bare')
  assert.equal(resolvePersonaProfileId('unknown-variant'), null)
})

await finish()
