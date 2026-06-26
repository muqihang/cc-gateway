import { strict as assert } from 'assert'
import { readFileSync } from 'fs'
import { loadConfig } from '../src/config.js'
import { configYaml, finish, test, writeConfigYaml } from './helpers.js'

console.log('\ntests/config.test.ts')

const configInternalControlMaterial = 'internal-control-material-v1-abcdef1234567890abcdef'
const configAttestationMaterial = 'scheduler-hmac-material-v1-abcdef1234567890abcdef'

const formalPoolMapsYaml = `
account_identities:
  account-a:
    device_id: ${'a'.repeat(64)}
    account_uuid_ref: opaque:account-ref:v1:acct-a
    account_ref: opaque:account-partition:v1:acct-a
    credential_ref: opaque:credential-ref:v1:cred-a
    credential_binding_hmac: hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    persona_variant: claude-code-2.1.175-macos-local
    session_policy: preserve_downstream_session_id
    policy_version: "2.1.175"
egress_buckets:
  bucket-a:
    enabled: true
    proxy_url: http://127.0.0.1:8080
    proxy_identity_ref: opaque:proxy-ref:v1:bucket-a
    allowed_account_ids: [account-a]
`

test('defaults old config without mode to standalone', () => {
  const config = loadConfig(writeConfigYaml(configYaml()))
  assert.equal(config.mode, 'standalone')
  assert.equal(config.oauth.refresh_token, 'refresh-token')
})

test('standalone still requires oauth.refresh_token', () => {
  const path = writeConfigYaml(configYaml().replace(/oauth:\n  refresh_token: refresh-token\n/, ''))
  assert.throws(() => loadConfig(path), /oauth\.refresh_token is required/)
})

test('sub2api mode can omit oauth', () => {
  const path = writeConfigYaml(configYaml().replace(
    /auth:\n  tokens:\n    - name: client\n      token: client-token\noauth:\n  refresh_token: refresh-token\n/,
    `auth:\n  gateway_token: gateway-token\n  internal_control_token: ${configInternalControlMaterial}\nmode: sub2api\nshared_pool:\n  context_attestation_secret_ref: opaque:attestation-ref:v1:formal-pool\n  context_attestation_secret: ${configAttestationMaterial}\n${formalPoolMapsYaml}`,
  ))
  const config = loadConfig(path)
  assert.equal(config.mode, 'sub2api')
  assert.equal(config.oauth, undefined)
})

test('sub2api mode requires a gateway token or equivalent auth token', () => {
  const path = writeConfigYaml(configYaml().replace(
    /auth:\n  tokens:\n    - name: client\n      token: client-token\noauth:\n  refresh_token: refresh-token\n/,
    'auth: {}\nmode: sub2api\n',
  ))
  assert.throws(() => loadConfig(path), /gateway token/)
})

test('sub2api mode accepts existing auth.tokens as equivalent gateway tokens', () => {
  const path = writeConfigYaml(configYaml().replace(
    /auth:\n  tokens:\n    - name: client\n      token: client-token\noauth:\n  refresh_token: refresh-token\n/,
    `auth:\n  internal_control_token: ${configInternalControlMaterial}\n  tokens:\n    - name: client\n      token: client-token\nmode: sub2api\nshared_pool:\n  context_attestation_secret_ref: opaque:attestation-ref:v1:formal-pool\n  context_attestation_secret: ${configAttestationMaterial}\n${formalPoolMapsYaml}`,
  ))
  const config = loadConfig(path)
  assert.equal(config.mode, 'sub2api')
  assert.equal(config.auth.tokens[0].token, 'client-token')
})

test('sub2api mode rejects auth.tokens reused as internal attestation token', () => {
  const path = writeConfigYaml(configYaml().replace(
    /auth:\n  tokens:\n    - name: client\n      token: client-token\noauth:\n  refresh_token: refresh-token\n/,
    `auth:\n  internal_control_token: client-token\n  tokens:\n    - name: client\n      token: client-token\nmode: sub2api\nshared_pool:\n  context_attestation_secret_ref: opaque:attestation-ref:v1:formal-pool\n  context_attestation_secret: ${configAttestationMaterial}\n${formalPoolMapsYaml}`,
  ))
  assert.throws(() => loadConfig(path), /internal_control_token.*independent/)
})

test('rejects invalid mode', () => {
  const path = writeConfigYaml(configYaml(`
mode: transparent
`))
  assert.throws(() => loadConfig(path), /mode/)
})

test('standalone rejects formal-pool shared account maps', () => {
  const path = writeConfigYaml(configYaml(`
mode: standalone
shared_pool:
  max_body_bytes: 2097152
${formalPoolMapsYaml}
`))
  assert.throws(() => loadConfig(path), /formal-pool.*sub2api/i)
})

test('standalone permits benign personal shared_pool body cap without formal-pool maps', () => {
  const path = writeConfigYaml(configYaml(`
mode: standalone
shared_pool:
  max_body_bytes: 2097152
`))
  const config = loadConfig(path)
  assert.equal(config.mode, 'standalone')
  assert.equal(config.shared_pool?.max_body_bytes, 2097152)
})

test('standalone permits benign personal shared_pool strip mode without formal-pool maps', () => {
  const path = writeConfigYaml(configYaml(`
mode: standalone
shared_pool:
  max_body_bytes: 2097152
  billing_cch_mode: strip
`))
  const config = loadConfig(path)
  assert.equal(config.mode, 'standalone')
  assert.equal(config.shared_pool?.billing_cch_mode, 'strip')
})

test('standalone permits dormant personal shared_pool policy knobs without formal-pool maps', () => {
  const path = writeConfigYaml(configYaml(`
mode: standalone
shared_pool:
  max_body_bytes: 2097152
  billing_cch_mode: strip
  signing_enabled: true
  signing_evidence_gates_approved: true
  upstream_mode: preflight
  message_beta_profile: claude_code_2_1_175_subscription_1m
  canary_cost_envelope:
    enabled: true
  candidate_model_allowlist:
    - claude-sonnet-4-6
  production_budget:
    mode: observe_only
`))
  const config = loadConfig(path)
  assert.equal(config.mode, 'standalone')
  assert.equal(config.shared_pool?.upstream_mode, 'preflight')
})

test('standalone rejects active shared_pool formal-pool controls', () => {
  const activeControls = [
    ['upstream_mode_real_canary', '  upstream_mode: real-canary\n'],
    ['upstream_mode_production', '  upstream_mode: production\n'],
    ['real_canary_user_approved', '  real_canary_user_approved: true\n'],
    ['production_upstream_enabled', '  production_upstream_enabled: true\n'],
    ['context_attestation_secret_ref', '  context_attestation_secret_ref: opaque:attestation-ref:v1:formal-pool\n'],
  ]

  for (const [caseName, sharedPoolYaml] of activeControls) {
    const path = writeConfigYaml(configYaml(`
mode: standalone
shared_pool:
${sharedPoolYaml}`))
    assert.throws(() => loadConfig(path), /formal-pool.*sub2api/i, caseName)
  }
})

test('sub2api formal-pool requires account identities and egress buckets', () => {
  const path = writeConfigYaml(configYaml(`
mode: sub2api
auth:
  gateway_token: gateway-token
shared_pool:
  max_body_bytes: 2097152
`).replace(/auth:\n  tokens:\n    - name: client\n      token: client-token\n/, '').replace(/oauth:\n  refresh_token: refresh-token\n/, ''))
  assert.throws(() => loadConfig(path), /account_identities.*egress_buckets/i)
})

test('sub2api formal-pool rejects incomplete account identity maps', () => {
  const invalidDevice = writeConfigYaml(configYaml(`
mode: sub2api
auth:
  gateway_token: gateway-token
account_identities:
  account-a:
    device_id: not-hex
    account_uuid_ref: opaque:account-ref:v1:acct-a
    credential_ref: opaque:credential-ref:v1:cred-a
    credential_binding_hmac: hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    persona_variant: claude-code-2.1.175-macos-local
    session_policy: preserve_downstream_session_id
    policy_version: "2.1.175"
egress_buckets:
  bucket-a:
    enabled: true
    proxy_url: http://127.0.0.1:8080
    proxy_identity_ref: opaque:proxy-ref:v1:bucket-a
    allowed_account_ids: [account-a]
`).replace(/auth:\n  tokens:\n    - name: client\n      token: client-token\n/, '').replace(/oauth:\n  refresh_token: refresh-token\n/, ''))
  assert.throws(() => loadConfig(invalidDevice), /account_identities\.account-a\.device_id/)

  const missingCredentialBinding = writeConfigYaml(configYaml(`
mode: sub2api
auth:
  gateway_token: gateway-token
account_identities:
  account-a:
    device_id: ${'a'.repeat(64)}
    account_uuid_ref: opaque:account-ref:v1:acct-a
    credential_ref: opaque:credential-ref:v1:cred-a
    persona_variant: claude-code-2.1.175-macos-local
    session_policy: preserve_downstream_session_id
    policy_version: "2.1.175"
egress_buckets:
  bucket-a:
    enabled: true
    proxy_url: http://127.0.0.1:8080
    proxy_identity_ref: opaque:proxy-ref:v1:bucket-a
    allowed_account_ids: [account-a]
`).replace(/auth:\n  tokens:\n    - name: client\n      token: client-token\n/, '').replace(/oauth:\n  refresh_token: refresh-token\n/, ''))
  assert.throws(() => loadConfig(missingCredentialBinding), /credential_binding_hmac/)
})


test('sub2api formal-pool rejects gateway_generated session policy until implemented', () => {
  const path = writeConfigYaml(configYaml(`
mode: sub2api
auth:
  gateway_token: gateway-token
  internal_control_token: ${configInternalControlMaterial}
shared_pool:
  context_attestation_secret_ref: opaque:attestation-ref:v1:formal-pool
  context_attestation_secret: ${configAttestationMaterial}
${formalPoolMapsYaml.replace('session_policy: preserve_downstream_session_id', 'session_policy: gateway_generated')}
`).replace(/auth:\n  tokens:\n    - name: client\n      token: client-token\n/, '').replace(/oauth:\n  refresh_token: refresh-token\n/, ''))
  assert.throws(() => loadConfig(path), /session_policy.*preserve_downstream_session_id/i)
})

test('sub2api formal-pool rejects unsafe identity and egress refs', () => {
  const unsafeAccountRef = writeConfigYaml(configYaml(`
mode: sub2api
auth:
  gateway_token: gateway-token
account_identities:
  account-a:
    device_id: ${'a'.repeat(64)}
    account_uuid_ref: user@example.com
    credential_ref: opaque:credential-ref:v1:cred-a
    credential_binding_hmac: hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    persona_variant: claude-code-2.1.175-macos-local
    session_policy: preserve_downstream_session_id
    policy_version: "2.1.175"
egress_buckets:
  bucket-a:
    enabled: true
    proxy_url: http://127.0.0.1:8080
    proxy_identity_ref: opaque:proxy-ref:v1:bucket-a
    allowed_account_ids: [account-a]
`).replace(/auth:\n  tokens:\n    - name: client\n      token: client-token\n/, '').replace(/oauth:\n  refresh_token: refresh-token\n/, ''))
  assert.throws(() => loadConfig(unsafeAccountRef), /account_uuid_ref/)

  const missingAllowlist = writeConfigYaml(configYaml(`
mode: sub2api
auth:
  gateway_token: gateway-token
account_identities:
  account-a:
    device_id: ${'a'.repeat(64)}
    account_uuid_ref: opaque:account-ref:v1:acct-a
    credential_ref: opaque:credential-ref:v1:cred-a
    credential_binding_hmac: hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    persona_variant: claude-code-2.1.175-macos-local
    session_policy: preserve_downstream_session_id
    policy_version: "2.1.175"
egress_buckets:
  bucket-a:
    enabled: true
    proxy_url: http://127.0.0.1:8080
    proxy_identity_ref: opaque:proxy-ref:v1:bucket-a
    allowed_account_ids: []
`).replace(/auth:\n  tokens:\n    - name: client\n      token: client-token\n/, '').replace(/oauth:\n  refresh_token: refresh-token\n/, ''))
  assert.throws(() => loadConfig(missingAllowlist), /allowed_account_ids/)
})

test('sub2api formal-pool rejects prefix-only refs and embedded plain digests', () => {
  for (const unsafeRef of ['opaque:', 'hmac-sha256:', 'scoped_hmac_ref:', 'opaque:credential-ref:v1:sha256:abcdef', 'opaque:credential-ref:v1:secret-ref-test']) {
    const path = writeConfigYaml(configYaml(`
mode: sub2api
auth:
  gateway_token: gateway-token
account_identities:
  account-a:
    device_id: ${'a'.repeat(64)}
    account_uuid_ref: opaque:account-ref:v1:acct-a
    credential_ref: ${unsafeRef}
    credential_binding_hmac: hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    persona_variant: claude-code-2.1.175-macos-local
    session_policy: preserve_downstream_session_id
    policy_version: "2.1.175"
egress_buckets:
  bucket-a:
    enabled: true
    proxy_url: http://127.0.0.1:8080
    proxy_identity_ref: opaque:proxy-ref:v1:bucket-a
    allowed_account_ids: [account-a]
`).replace(/auth:\n  tokens:\n    - name: client\n      token: client-token\n/, '').replace(/oauth:\n  refresh_token: refresh-token\n/, ''))
    assert.throws(() => loadConfig(path), /credential_ref/, unsafeRef)
  }
})

test('sub2api formal-pool requires independent context attestation secret material', () => {
  const formalPoolWithAttestationYaml = (authYaml: string) => configYaml(`
mode: sub2api
auth:
${authYaml}
shared_pool:
  context_attestation_secret_ref: opaque:attestation-ref:v1:formal-pool
  context_attestation_secret: ${configAttestationMaterial}
${formalPoolMapsYaml}
`).replace(/auth:\n  tokens:\n    - name: client\n      token: client-token\n/, '').replace(/oauth:\n  refresh_token: refresh-token\n/, '')

  assert.throws(
    () => loadConfig(writeConfigYaml(formalPoolWithAttestationYaml('  gateway_token: gateway-token\n'))),
    /internal_control_token/,
  )
  assert.throws(
    () => loadConfig(writeConfigYaml(formalPoolWithAttestationYaml('  gateway_token: same-token\n  internal_control_token: same-token\n'))),
    /internal_control_token.*independent/,
  )
  assert.throws(
    () => loadConfig(writeConfigYaml(formalPoolWithAttestationYaml('  gateway_token: gateway-token\n  internal_control_token: client-token\n  tokens:\n    - name: client\n      token: client-token\n'))),
    /internal_control_token.*independent/,
  )

  const config = loadConfig(writeConfigYaml(formalPoolWithAttestationYaml(`  gateway_token: gateway-token\n  internal_control_token: ${configInternalControlMaterial}\n`)))
  assert.equal(config.auth.internal_control_token, configInternalControlMaterial)
})

test('sub2api formal-pool requires context attestation to be configured', () => {
  const path = writeConfigYaml(configYaml(`
mode: sub2api
auth:
  gateway_token: gateway-token
  internal_control_token: ${configInternalControlMaterial}
${formalPoolMapsYaml}
`).replace(/auth:\n  tokens:\n    - name: client\n      token: client-token\n/, '').replace(/oauth:\n  refresh_token: refresh-token\n/, ''))
  assert.throws(() => loadConfig(path), /context_attestation_secret_ref/)
})

test('formal-pool config errors redact unsafe account and bucket map keys', () => {
  const unsafeAccountId = 'user@example.com'
  const unsafeBucketId = '123e4567-e89b-42d3-a456-426614174999'
  const path = writeConfigYaml(configYaml(`
mode: sub2api
auth:
  gateway_token: gateway-token
account_identities:
  ${unsafeAccountId}:
    device_id: ${'a'.repeat(64)}
    account_uuid_ref: opaque:account-ref:v1:acct-a
    credential_ref: opaque:credential-ref:v1:cred-a
    credential_binding_hmac: hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    persona_variant: claude-code-2.1.175-macos-local
    session_policy: preserve_downstream_session_id
    policy_version: "2.1.175"
egress_buckets:
  ${unsafeBucketId}:
    enabled: true
    proxy_url: http://127.0.0.1:8080
    proxy_identity_ref: opaque:proxy-ref:v1:bucket-a
    allowed_account_ids: [${unsafeAccountId}]
`).replace(/auth:\n  tokens:\n    - name: client\n      token: client-token\n/, '').replace(/oauth:\n  refresh_token: refresh-token\n/, ''))
  assert.throws(
    () => loadConfig(path),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.doesNotMatch(err.message, new RegExp(unsafeAccountId.replace('.', '\\.')))
      assert.doesNotMatch(err.message, new RegExp(unsafeBucketId))
      assert.match(err.message, /<redacted>/)
      return true
    },
  )

  const unsafeBucketPath = writeConfigYaml(configYaml(`
mode: sub2api
auth:
  gateway_token: gateway-token
account_identities:
  account-a:
    device_id: ${'a'.repeat(64)}
    account_uuid_ref: opaque:account-ref:v1:acct-a
    credential_ref: opaque:credential-ref:v1:cred-a
    credential_binding_hmac: hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    persona_variant: claude-code-2.1.175-macos-local
    session_policy: preserve_downstream_session_id
    policy_version: "2.1.175"
egress_buckets:
  ${unsafeBucketId}:
    enabled: true
    proxy_url: http://127.0.0.1:8080
    proxy_identity_ref: opaque:proxy-ref:v1:bucket-a
    allowed_account_ids: [account-a]
`).replace(/auth:\n  tokens:\n    - name: client\n      token: client-token\n/, '').replace(/oauth:\n  refresh_token: refresh-token\n/, ''))
  assert.throws(
    () => loadConfig(unsafeBucketPath),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.doesNotMatch(err.message, new RegExp(unsafeBucketId))
      assert.match(err.message, /<redacted>/)
      return true
    },
  )
})



test('sub2api formal-pool rejects non-hex credential binding hmac at startup', () => {
  const path = writeConfigYaml(configYaml(`
mode: sub2api
auth:
  gateway_token: gateway-token
  internal_control_token: ${configInternalControlMaterial}
shared_pool:
  context_attestation_secret_ref: opaque:attestation-ref:v1:formal-pool
  context_attestation_secret: ${configAttestationMaterial}
${formalPoolMapsYaml.replace(/credential_binding_hmac: hmac-sha256:[a-f0-9]{64}/, 'credential_binding_hmac: hmac-sha256:not-hex-placeholder')}
`).replace(/auth:\n  tokens:\n    - name: client\n      token: client-token\n/, '').replace(/oauth:\n  refresh_token: refresh-token\n/, ''))
  assert.throws(() => loadConfig(path), /credential_binding_hmac.*hmac-sha256/i)
})

test('sub2api production formal-pool rejects weak placeholder control material', () => {
  const formalPoolWithWeakInternal = (internal: string) => configYaml(`
mode: sub2api
auth:
  gateway_token: gateway-token
  internal_control_token: ${internal}
shared_pool:
  upstream_mode: production
  production_upstream_enabled: true
  context_attestation_secret_ref: opaque:attestation-ref:v1:formal-pool
  context_attestation_secret: ${configAttestationMaterial}
${formalPoolMapsYaml}
`).replace(/auth:\n  tokens:\n    - name: client\n      token: client-token\n/, '').replace(/oauth:\n  refresh_token: refresh-token\n/, '')

  for (const weak of ['change-me-independent-internal-control-token', 'short-material', 'test-token', 'placeholder-token']) {
    assert.throws(() => loadConfig(writeConfigYaml(formalPoolWithWeakInternal(weak))), /internal_control_token.*production/i, weak)
  }
})

test('config examples separate personal standalone from formal-pool sub2api', () => {
  const example = readFileSync(new URL('../config.example.yaml', import.meta.url), 'utf-8')
  const formalPoolExample = readFileSync(new URL('../config.sub2api.formal-pool.example.yaml', import.meta.url), 'utf-8')
  assert.match(example, /^mode: standalone$/m)
  assert.match(example, /^providers:\n  anthropic: true$/m)
  assert.doesNotMatch(example, /^shared_pool:/m)
  assert.doesNotMatch(example, /^account_identities:/m)
  assert.doesNotMatch(example, /^egress_buckets:/m)
  assert.match(example, /standalone: personal\/single-account OAuth proxy only/)
  assert.match(example, /sub2api: required for Sub2API formal-pool\/shared-account production/)
  assert.match(example, /version: "2\.1\.175"/)
  assert.match(example, /version_base: "2\.1\.175"/)
  assert.match(formalPoolExample, /^mode: sub2api$/m)
  assert.match(formalPoolExample, /Claude Code 2\.1\.179 stable formal-pool production target/)
  assert.match(formalPoolExample, /version: "2\.1\.179"/)
  assert.match(formalPoolExample, /version_base: "2\.1\.179"/)
  assert.match(formalPoolExample, /gateway_token: "change-me-gateway-token"/)
  assert.match(formalPoolExample, /internal_control_token: "change-me-independent-internal-control-token"/)
  assert.match(formalPoolExample, /context_attestation_secret_ref: opaque:attestation-ref:v1:formal-pool/)
  assert.match(formalPoolExample, /billing_cch_mode: strip/)
  assert.match(formalPoolExample, /account_identities:/)
  assert.match(formalPoolExample, /credential_ref:/)
  assert.match(formalPoolExample, /credential_binding_hmac:/)
  assert.match(formalPoolExample, /egress_buckets:/)
  assert.match(formalPoolExample, /proxy_identity_ref:/)
  assert.match(formalPoolExample, /allowed_account_ids: \["example-account-id"\]/)
  assert.match(formalPoolExample, /claude-sonnet-4-6/)
  assert.match(formalPoolExample, /claude-opus-4-7/)
  assert.match(formalPoolExample, /claude-opus-4-6-thinking/)
  assert.match(formalPoolExample, /claude-opus-4-8/)
  assert.match(formalPoolExample, /claude-fable-5/)
  assert.match(formalPoolExample, /dynamic model resolver/)
  assert.match(formalPoolExample, /claude_code_2_1_179_native_degraded/)
  assert.match(formalPoolExample, /claude-code-2\.1\.179-macos-local/)
  assert.match(formalPoolExample, /policy_version: "2\.1\.179"/)
  assert.match(formalPoolExample, /strip_attribution/)
  assert.match(formalPoolExample, /2\.1\.191 latest is forward-compatibility evidence only/)
  assert.doesNotMatch(formalPoolExample, /Canonical shared-pool persona for the verified Claude Code 2\.1\.175/)
  assert.match(formalPoolExample, /candidate_model_allowlist:/)
  assert.match(formalPoolExample, /candidate_model_audit_budgets:/)
  assert.match(formalPoolExample, /candidate_beta_audit_budgets:/)
  assert.doesNotMatch(example, /sha256:<redacted>/)
  assert.doesNotMatch(formalPoolExample, /sha256:<redacted>/)
  assert.match(formalPoolExample, /opaque:proxy-ref:v1:/)
})

await finish()
