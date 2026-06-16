import { strict as assert } from 'assert'
import { finish, test, baseConfig } from './helpers.js'
import { resolvePersonaDecision } from '../src/persona-resolver.js'
import type { AccountIdentityConfig, Config } from '../src/config.js'

console.log('\ntests/persona-resolver.test.ts')

const identity2175: AccountIdentityConfig = {
  device_id: 'b'.repeat(64),
  account_uuid_hash: 'hmac-sha256:k-test:account-ref:v1:acct-a',
  email_hash: 'hmac-sha256:k-test:email-ref:v1:user-a',
  account_hash: 'hmac-sha256:k-test:account-partition:v1:acct-a',
  persona_variant: 'claude-code-2.1.175-macos-local',
  session_policy: 'preserve_downstream_session_id',
  policy_version: '2.1.175',
}

const identity2170: AccountIdentityConfig = {
  ...identity2175,
  persona_variant: 'claude-code-2.1.170-macos-local',
  policy_version: '2.1.170',
}

const legacyIdentity2150: AccountIdentityConfig = {
  ...identity2175,
  persona_variant: 'claude-code-2.1.150-macos-local',
  policy_version: '2.1.150',
}

function config(overrides: Partial<Config> = {}): Config {
  const base = baseConfig()
  return baseConfig({
    ...overrides,
    env: { ...base.env, version: '2.1.175', version_base: '2.1.175', ...(overrides.env as any) },
    shared_pool: {
      billing_cch_mode: 'sign',
      signing_enabled: true,
      signing_evidence_gates_approved: true,
      message_beta_profile: 'claude_code_2_1_175_subscription_1m',
      candidate_model_allowlist: ['claude-sonnet-4-8'],
      candidate_model_replay_proofs: {
        'claude-sonnet-4-8': 'fixture-sonnet-48',
      },
      candidate_model_kill_switches: {
        'claude-sonnet-4-8': false,
      },
      candidate_model_audit_budgets: {
        'claude-sonnet-4-8': 1,
      },
      candidate_beta_allowlist: ['claude_code_candidate_beta'],
      candidate_beta_replay_proofs: { claude_code_candidate_beta: 'fixture-beta' },
      candidate_beta_kill_switches: { claude_code_candidate_beta: false },
      candidate_beta_audit_budgets: { claude_code_candidate_beta: 1 },
      ...((overrides.shared_pool as any) || {}),
    } as any,
  } as Config)
}

test('exact known 2.1.175 final profile resolves without capability downgrade', () => {
  const decision = resolvePersonaDecision({
    config: config(),
    identity: identity2175,
    route: 'messages',
    requestedPolicyVersion: '2.1.175',
    requestedModel: 'claude-opus-4-8',
    trustedClient: true,
  })
  assert.equal(decision.status, 'exact_known')
  assert.equal(decision.effectiveVersion, '2.1.175')
  assert.equal(decision.profile.id, 'claude_code_2_1_175_subscription_1m')
  assert.equal(decision.capabilities.context_1m, true)
  assert.equal(decision.capabilities.tools, true)
  assert.equal(decision.capabilities.thinking, true)
  assert.equal(decision.capabilities.context_management, true)
  assert.equal(decision.capabilities.stream, true)
  assert.equal(decision.capabilities.max_tokens, 32000)
  assert.ok(decision.betaHeader.includes('mid-conversation-system-2026-04-07'))
  assert.equal(decision.route, 'messages')
})

test('stale 2.1.150 and 2.1.170 Sub2API metadata canonicalize to 2.1.175 final profile', () => {
  for (const [version, identity] of [
    ['2.1.150', legacyIdentity2150],
    ['2.1.170', identity2170],
  ] as const) {
    const decision = resolvePersonaDecision({
      config: config(),
      identity,
      route: 'messages',
      requestedPolicyVersion: version,
      requestedModel: 'claude-opus-4-8',
      trustedClient: true,
    })
    assert.equal(decision.status, 'observed_minor_drift', version)
    assert.equal(decision.effectiveVersion, '2.1.175', version)
    assert.equal(decision.profile.id, 'claude_code_2_1_175_subscription_1m', version)
  }
})

test('2.1.171 and unsupported 2.1.172+ policy versions stay behind the persona rollout gate', () => {
  for (const version of ['2.1.171', '2.1.172', '2.1.173']) {
    const decision = resolvePersonaDecision({
      config: config(),
      identity: identity2175,
      route: 'messages',
      requestedPolicyVersion: version,
      requestedModel: 'claude-opus-4-8',
      trustedClient: true,
    })
    assert.equal(decision.status, 'quarantine_unknown_major', version)
  }
})

test('untrusted stale identity cannot self-promote directly to 2.1.175', () => {
  for (const requestedPolicyVersion of ['2.1.175', '2.1.175 ', ' 2.1.175']) {
    const decision = resolvePersonaDecision({
      config: config(),
      identity: identity2170,
      route: 'messages',
      requestedPolicyVersion,
      requestedModel: 'claude-opus-4-8',
      trustedClient: false,
    })
    assert.equal(decision.status, 'quarantine_unknown_major', requestedPolicyVersion)
    assert.equal(decision.effectiveVersion, '2.1.175', requestedPolicyVersion)
    assert.equal(decision.profile.id, 'claude_code_2_1_175_subscription_1m', requestedPolicyVersion)
  }
})

test('explicit legacy 2.1.150 profile remains available for rollback tests', () => {
  const decision = resolvePersonaDecision({
    config: config({ shared_pool: { message_beta_profile: 'claude_code_2_1_150_subscription_1m' } as any }),
    identity: legacyIdentity2150,
    route: 'messages',
    requestedPolicyVersion: '2.1.150',
    requestedModel: 'claude-opus-4-7',
    trustedClient: true,
  })
  assert.equal(decision.status, 'exact_known')
  assert.equal(decision.effectiveVersion, '2.1.150')
  assert.equal(decision.profile.id, 'claude_code_2_1_150_subscription_1m')
})

test('verified legacy 2.1.153 drift stays allowed for trusted rollback tests', () => {
  const decision = resolvePersonaDecision({
    config: config({ env: { ...baseConfig().env, version: '2.1.153', version_base: '2.1.153' } as any, shared_pool: { message_beta_profile: 'claude_code_2_1_150_subscription_1m' } as any }),
    identity: legacyIdentity2150,
    route: 'messages',
    requestedPolicyVersion: '2.1.153',
    requestedModel: 'claude-opus-4-6-thinking',
    trustedClient: true,
  })
  assert.equal(decision.status, 'observed_minor_drift')
  assert.equal(decision.effectiveVersion, '2.1.153')
  assert.equal(decision.capabilities.context_1m, true)
  assert.equal(decision.capabilities.tools, true)
  assert.equal(decision.capabilities.thinking, true)
  assert.equal(decision.capabilities.context_management, true)
  assert.equal(decision.capabilities.stream, true)
  assert.equal(decision.capabilities.max_tokens, 32000)
  assert.equal(decision.route, 'messages')
})

test('unknown beta is quarantined unless candidate allowlist, replay proof, kill switch, and audit budget all pass', () => {
  const badConfig = config({
    shared_pool: {
      ...(config().shared_pool as any),
      message_beta_profile: 'unknown_beta_profile',
    } as any,
  })
  const quarantined = resolvePersonaDecision({
    config: badConfig,
    identity: identity2175,
    route: 'messages',
    requestedPolicyVersion: '2.1.175',
    requestedModel: 'claude-opus-4-8',
    trustedClient: true,
  })
  assert.equal(quarantined.status, 'quarantine_unknown_beta')

  const missingAuditBudget = resolvePersonaDecision({
    config: config({
      shared_pool: {
        ...(config().shared_pool as any),
        message_beta_profile: 'claude_code_candidate_beta',
        candidate_beta_audit_budgets: {},
      } as any,
    }),
    identity: identity2175,
    route: 'messages',
    requestedPolicyVersion: '2.1.175',
    requestedModel: 'claude-opus-4-8',
    trustedClient: true,
  })
  assert.equal(missingAuditBudget.status, 'quarantine_unknown_beta')

  const gray = resolvePersonaDecision({
    config: config({
      shared_pool: {
        ...(config().shared_pool as any),
        message_beta_profile: 'claude_code_candidate_beta',
      } as any,
    }),
    identity: identity2175,
    route: 'messages',
    requestedPolicyVersion: '2.1.175',
    requestedModel: 'claude-opus-4-8',
    trustedClient: true,
  })
  assert.equal(gray.status, 'candidate_beta_gray')
  assert.equal(gray.effectiveVersion, '2.1.175')
})


test('non-1m default may safely downshift a 1m identity but does not silently enable 1m', () => {
  const decision = resolvePersonaDecision({
    config: config({ shared_pool: { message_beta_profile: 'claude_code_2_1_175_api_key_non_1m' } as any }),
    identity: identity2175,
    route: 'messages',
    requestedPolicyVersion: '2.1.175',
    requestedModel: 'claude-opus-4-8',
    trustedClient: true,
  })
  assert.equal(decision.status, 'exact_known')
  assert.equal(decision.profile.id, 'claude_code_2_1_175_api_key_non_1m')
  assert.equal(decision.capabilities.context_1m, false)
})

test('identity profile wins when shared config only carries default environment version', () => {
  const apiKeyIdentity: AccountIdentityConfig = {
    ...identity2175,
    persona_variant: 'claude_code_2_1_175_api_key_non_1m',
    policy_version: '2.1.175',
  }
  const decision = resolvePersonaDecision({
    config: config({
      shared_pool: {
        billing_cch_mode: 'sign',
        signing_enabled: true,
        signing_evidence_gates_approved: true,
        message_beta_profile: undefined,
      } as any,
    }),
    identity: apiKeyIdentity,
    route: 'messages',
    requestedPolicyVersion: '2.1.175',
    requestedModel: 'claude-fable-5',
    trustedClient: true,
  })
  assert.equal(decision.status, 'exact_known')
  assert.equal(decision.profile.id, 'claude_code_2_1_175_api_key_non_1m')
  assert.equal(decision.capabilities.context_1m, false)
  assert.ok(!decision.betaHeader.includes('context-1m-2025-08-07'))
})

test('non-1m default safely downshifts legacy 1m account identity without quarantining', () => {
  const decision = resolvePersonaDecision({
    config: config({ shared_pool: { message_beta_profile: 'claude_code_2_1_175_api_key_non_1m' } as any }),
    identity: identity2175,
    route: 'messages',
    requestedPolicyVersion: '2.1.175',
    requestedModel: 'claude-sonnet-4-6',
    trustedClient: true,
  })
  assert.equal(decision.status, 'exact_known')
  assert.equal(decision.profile.id, 'claude_code_2_1_175_api_key_non_1m')
  assert.equal(decision.capabilities.context_1m, false)
  assert.equal(decision.route, 'messages')
  assert.equal(decision.trustedClient, true)
})

test('future trusted sonnet candidate model grays without capability downgrade', () => {
  const sonnet = resolvePersonaDecision({
    config: config(),
    identity: identity2175,
    route: 'messages',
    requestedPolicyVersion: '2.1.175',
    requestedModel: 'claude-sonnet-4-8',
    trustedClient: true,
  })
  assert.equal(sonnet.status, 'candidate_model_gray')
  assert.equal(sonnet.effectiveVersion, '2.1.175')
  assert.equal(sonnet.capabilities.max_tokens, 32000)
  assert.equal(sonnet.capabilities.context_1m, true)
  assert.equal(sonnet.capabilities.tools, true)
  assert.equal(sonnet.capabilities.thinking, true)
  assert.equal(sonnet.capabilities.stream, true)
})

test('known native models remain known for existing untrusted strip-mode compatibility path', () => {
  for (const model of ['claude-haiku-4-5-20251001', 'claude-opus-4-8', 'claude-fable-5']) {
    const decision = resolvePersonaDecision({
      config: config(),
      identity: identity2175,
      route: 'messages',
      requestedPolicyVersion: '2.1.175',
      requestedModel: model,
      trustedClient: false,
    })
    assert.equal(decision.status, 'exact_known', model)
  }
})

test('untrusted unknown model rejects and unknown major quarantines', () => {
  const unknownMajor = resolvePersonaDecision({
    config: config({ env: { ...baseConfig().env, version: '3.0.0', version_base: '3.0.0' } as any }),
    identity: identity2175,
    route: 'messages',
    requestedPolicyVersion: '3.0.0',
    requestedModel: 'claude-opus-4-8',
    trustedClient: true,
  })
  assert.equal(unknownMajor.status, 'quarantine_unknown_major')

  const untrusted = resolvePersonaDecision({
    config: config(),
    identity: identity2175,
    route: 'messages',
    requestedPolicyVersion: '2.1.175',
    requestedModel: 'claude-opus-4-9',
    trustedClient: false,
  })
  assert.equal(untrusted.status, 'reject_untrusted_model')
})

test('control-plane route decisions remain route-aware and fail closed on unknown major drift', () => {
  const decision = resolvePersonaDecision({
    config: config(),
    identity: identity2175,
    route: 'control_plane',
    requestedPolicyVersion: '3.0.0',
    requestedModel: '',
    trustedClient: true,
  })
  assert.equal(decision.status, 'quarantine_unknown_major')
  assert.equal(decision.route, 'control_plane')
})

test('explicit context-1m request works when production default profile is non-1m', () => {
  const decision = resolvePersonaDecision({
    config: config({ shared_pool: { message_beta_profile: 'claude_code_2_1_175_api_key_non_1m' } as any }),
    identity: identity2175,
    route: 'messages',
    requestedPolicyVersion: '2.1.175',
    requestedModel: 'claude-sonnet-4-6',
    trustedClient: true,
    requestedContext1M: true,
  })
  assert.equal(decision.status, 'exact_known')
  assert.equal(decision.profile.id, 'claude_code_2_1_175_subscription_1m')
  assert.equal(decision.capabilities.context_1m, true)
  assert.match(decision.betaHeader, /context-1m-2025-08-07/)
})

await finish()
