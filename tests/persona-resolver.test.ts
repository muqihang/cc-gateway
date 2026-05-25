import { strict as assert } from 'assert'
import { finish, test, baseConfig } from './helpers.js'
import { resolvePersonaDecision } from '../src/persona-resolver.js'
import type { AccountIdentityConfig, Config } from '../src/config.js'

console.log('\ntests/persona-resolver.test.ts')

const identity: AccountIdentityConfig = {
  device_id: 'b'.repeat(64),
  account_uuid_hash: 'hmac-sha256:k-test:account-ref:v1:acct-a',
  email_hash: 'hmac-sha256:k-test:email-ref:v1:user-a',
  account_hash: 'hmac-sha256:k-test:account-partition:v1:acct-a',
  persona_variant: 'claude-code-2.1.150-macos-local',
  session_policy: 'preserve_downstream_session_id',
  policy_version: '2.1.150',
}

function config(overrides: Partial<Config> = {}): Config {
  const base = baseConfig()
  return baseConfig({
    ...overrides,
    env: { ...base.env, version: '2.1.150', version_base: '2.1.150', ...(overrides.env as any) },
    shared_pool: {
      billing_cch_mode: 'sign',
      signing_enabled: true,
      signing_evidence_gates_approved: true,
      message_beta_profile: 'claude_code_2_1_150_subscription_1m',
      candidate_model_allowlist: ['claude-sonnet-4-8', 'claude-opus-4-8'],
      candidate_model_replay_proofs: {
        'claude-sonnet-4-8': 'fixture-sonnet-48',
        'claude-opus-4-8': 'fixture-opus-48',
      },
      candidate_model_kill_switches: {
        'claude-sonnet-4-8': false,
        'claude-opus-4-8': false,
      },
      candidate_model_audit_budgets: {
        'claude-sonnet-4-8': 1,
        'claude-opus-4-8': 1,
      },
      candidate_beta_allowlist: ['claude_code_candidate_beta'],
      candidate_beta_replay_proofs: { claude_code_candidate_beta: 'fixture-beta' },
      candidate_beta_kill_switches: { claude_code_candidate_beta: false },
      candidate_beta_audit_budgets: { claude_code_candidate_beta: 1 },
      ...((overrides.shared_pool as any) || {}),
    } as any,
  } as Config)
}

test('exact known 2.1.150 profile resolves without capability downgrade', () => {
  const decision = resolvePersonaDecision({
    config: config(),
    identity,
    route: 'messages',
    requestedPolicyVersion: '2.1.150',
    requestedModel: 'claude-opus-4-7',
    trustedClient: true,
  })
  assert.equal(decision.status, 'exact_known')
  assert.equal(decision.effectiveVersion, '2.1.150')
  assert.equal(decision.capabilities.context_1m, true)
  assert.equal(decision.capabilities.tools, true)
  assert.equal(decision.capabilities.thinking, true)
  assert.equal(decision.capabilities.context_management, true)
  assert.equal(decision.capabilities.stream, true)
  assert.equal(decision.capabilities.max_tokens, 32000)
  assert.match(decision.betaHeader, /^claude-code-20250219,/)
  assert.equal(decision.route, 'messages')
})

test('same-minor drift 2.1.151 stays allowed with no capability downgrade', () => {
  const decision = resolvePersonaDecision({
    config: config({ env: { ...baseConfig().env, version: '2.1.151', version_base: '2.1.151' } as any }),
    identity,
    route: 'messages',
    requestedPolicyVersion: '2.1.151',
    requestedModel: 'claude-opus-4-6-thinking',
    trustedClient: true,
  })
  assert.equal(decision.status, 'observed_minor_drift')
  assert.equal(decision.effectiveVersion, '2.1.151')
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
    identity,
    route: 'messages',
    requestedPolicyVersion: '2.1.150',
    requestedModel: 'claude-opus-4-7',
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
    identity,
    route: 'messages',
    requestedPolicyVersion: '2.1.150',
    requestedModel: 'claude-opus-4-7',
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
    identity,
    route: 'messages',
    requestedPolicyVersion: '2.1.150',
    requestedModel: 'claude-opus-4-7',
    trustedClient: true,
  })
  assert.equal(gray.status, 'candidate_beta_gray')
})

test('future trusted sonnet/opus candidate models gray without capability downgrade', () => {
  const sonnet = resolvePersonaDecision({
    config: config(),
    identity,
    route: 'messages',
    requestedPolicyVersion: '2.1.150',
    requestedModel: 'claude-sonnet-4-8',
    trustedClient: true,
  })
  assert.equal(sonnet.status, 'candidate_model_gray')
  assert.equal(sonnet.capabilities.max_tokens, 32000)
  assert.equal(sonnet.capabilities.context_1m, true)

  const opus = resolvePersonaDecision({
    config: config(),
    identity,
    route: 'messages',
    requestedPolicyVersion: '2.1.150',
    requestedModel: 'claude-opus-4-8',
    trustedClient: true,
  })
  assert.equal(opus.status, 'candidate_model_gray')
  assert.equal(opus.capabilities.max_tokens, 32000)
  assert.equal(opus.capabilities.thinking, true)
})

test('untrusted unknown model rejects and unknown major quarantines', () => {
  const unknownMajor = resolvePersonaDecision({
    config: config({ env: { ...baseConfig().env, version: '3.0.0', version_base: '3.0.0' } as any }),
    identity,
    route: 'messages',
    requestedPolicyVersion: '3.0.0',
    requestedModel: 'claude-opus-4-7',
    trustedClient: true,
  })
  assert.equal(unknownMajor.status, 'quarantine_unknown_major')

  const untrusted = resolvePersonaDecision({
    config: config(),
    identity,
    route: 'messages',
    requestedPolicyVersion: '2.1.150',
    requestedModel: 'claude-opus-4-8',
    trustedClient: false,
  })
  assert.equal(untrusted.status, 'reject_untrusted_model')
})

test('control-plane route decisions remain route-aware and fail closed on unknown major drift', () => {
  const decision = resolvePersonaDecision({
    config: config({ env: { ...baseConfig().env, version: '2.1.150', version_base: '2.1.150' } as any }),
    identity,
    route: 'control_plane',
    requestedPolicyVersion: '3.0.0',
    requestedModel: '',
    trustedClient: true,
  })
  assert.equal(decision.status, 'quarantine_unknown_major')
  assert.equal(decision.route, 'control_plane')
})

await finish()
