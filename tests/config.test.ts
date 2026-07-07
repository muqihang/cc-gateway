import { strict as assert } from 'assert'
import { readFileSync } from 'fs'
import { loadConfig } from '../src/config.js'
import { configYaml, finish, test, writeConfigYaml } from './helpers.js'

console.log('\ntests/config.test.ts')

const configInternalControlMaterial = 'internal-control-material-v1-abcdef1234567890abcdef'
const configAttestationMaterial = 'scheduler-hmac-material-v1-abcdef1234567890abcdef'
const configProxyBindingMaterial = 'proxy-binding-material-v1-abcdef1234567890abcdef'

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

function formalPoolMCPConnectorConfigYaml(
  mcpConnectorYaml = '',
  sidecarYaml = `
egress_tls_sidecar:
  enabled: true
  endpoint: http://127.0.0.1:19484
  control_token: ${configInternalControlMaterial}
  proxy_binding_secret: ${configProxyBindingMaterial}
  allowed_target_hosts: [api.anthropic.com]
  logical_target_host: api.anthropic.com
  allowed_routes: [/v1/messages]
  allowed_profile_refs:
    - tls-profile:claude-code-2.1.179-real-oracle-tcp-v1
    - tls-profile:claude-code-2.1.197-real-oracle-tcp-v1
  expected_tls_summary_bucket: tls-bucket:claude-code-real-oracle-2197
  mock_messages_response:
    enabled: false
    mode: local_smoke
tls_profiles:
  oracle:
    profile_ref: tls-profile:claude-code-2.1.197-real-oracle-tcp-v1
    enabled: true
`,
) {
  return configYaml(`
mode: sub2api
auth:
  gateway_token: gateway-token
  internal_control_token: ${configInternalControlMaterial}
shared_pool:
  upstream_mode: production
  production_upstream_enabled: true
  context_attestation_secret_ref: opaque:attestation-ref:v1:formal-pool
  context_attestation_secret: ${configAttestationMaterial}
formal_pool:
  enabled: true
${mcpConnectorYaml}
${sidecarYaml}
${formalPoolMapsYaml.replace('proxy_url: http://127.0.0.1:8080', 'proxy_url: http://127.0.0.1:9')}
`).replace(
    /auth:\n  tokens:\n    - name: client\n      token: client-token\noauth:\n  refresh_token: refresh-token\n/,
    '',
  )
}

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


test('sub2api formal-pool env residue config accepts only canonical safe refs', () => {
  const yaml = (envResidueYaml: string) => configYaml(`
mode: sub2api
auth:
  gateway_token: gateway-token
  internal_control_token: ${configInternalControlMaterial}
shared_pool:
  context_attestation_secret_ref: opaque:attestation-ref:v1:formal-pool
  context_attestation_secret: ${configAttestationMaterial}
  env_residue:
${envResidueYaml}
${formalPoolMapsYaml}
`).replace(/auth:\n  tokens:\n    - name: client\n      token: client-token\n/, '').replace(/oauth:\n  refresh_token: refresh-token\n/, '')

  const canonical = loadConfig(writeConfigYaml(yaml(`    env_residue_profile_ref: env-residue-profile:claude-code-2.1.179-us-pacific-official-anthropic-v1
    locale_profile_ref: locale-profile:us-pacific-v1
    base_url_residue_profile_ref: base-url-residue-profile:official-anthropic-v1`)))
  assert.equal(canonical.shared_pool?.env_residue?.locale_profile_ref, 'locale-profile:us-pacific-v1')

  assert.throws(
    () => loadConfig(writeConfigYaml(yaml('    env_residue_profile_ref: env-residue-profile:unknown-fixture'))),
    /canonical profile ref/,
  )
  assert.throws(
    () => loadConfig(writeConfigYaml(yaml('    locale_profile_ref: locale-profile:Bearer-token-fixture'))),
    /canonical profile ref/,
  )
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



test('sub2api production formal-pool rejects sidecar mock messages response bridge', () => {
  const yaml = configYaml(`
mode: sub2api
shared_pool:
  upstream_mode: production
  production_upstream_enabled: true
  context_attestation_secret_ref: opaque:attestation-ref:v1:formal-pool
  context_attestation_secret: ${configAttestationMaterial}
egress_tls_sidecar:
  enabled: true
  endpoint: http://127.0.0.1:19084
  control_token: ${configInternalControlMaterial}
  proxy_binding_secret: ${configProxyBindingMaterial}
  allowed_target_hosts: [api.anthropic.com]
  logical_target_host: api.anthropic.com
  allowed_routes: [/v1/messages]
  allowed_profile_refs: [tls-profile:claude-code-2.1.179-real-oracle-tcp-v1]
  expected_tls_summary_bucket: tls-bucket:claude-code-real-oracle-2179
  mock_messages_response:
    enabled: true
    mode: local_smoke
tls_profiles:
  oracle:
    profile_ref: tls-profile:claude-code-2.1.179-real-oracle-tcp-v1
    enabled: true
${formalPoolMapsYaml.replace('proxy_url: http://127.0.0.1:8080', 'proxy_url: http://127.0.0.1:9')}
`).replace(
    /auth:\n  tokens:\n    - name: client\n      token: client-token\noauth:\n  refresh_token: refresh-token\n/,
    `auth:\n  gateway_token: gateway-token\n  internal_control_token: ${configInternalControlMaterial}\n`,
  )
  const path = writeConfigYaml(yaml)
  assert.throws(() => loadConfig(path), /mock_messages_response.*production|production.*mock_messages_response/i)
})

test('sub2api production formal-pool rejects weak or reused sidecar proxy binding secret', () => {
  const productionSidecarYaml = (proxyBinding: string) => configYaml(`
mode: sub2api
shared_pool:
  upstream_mode: production
  production_upstream_enabled: true
  context_attestation_secret_ref: opaque:attestation-ref:v1:formal-pool
  context_attestation_secret: ${configAttestationMaterial}
egress_tls_sidecar:
  enabled: true
  endpoint: http://127.0.0.1:19484
  control_token: ${configInternalControlMaterial}
  proxy_binding_secret: ${proxyBinding}
  allowed_target_hosts: [api.anthropic.com]
  logical_target_host: api.anthropic.com
  allowed_routes: [/v1/messages]
  allowed_profile_refs: [tls-profile:claude-code-2.1.197-real-oracle-tcp-v1]
  expected_tls_summary_bucket: tls-bucket:claude-code-real-oracle-2197
  mock_messages_response:
    enabled: false
    mode: local_smoke
tls_profiles:
  oracle:
    profile_ref: tls-profile:claude-code-2.1.197-real-oracle-tcp-v1
    enabled: true
${formalPoolMapsYaml.replace('proxy_url: http://127.0.0.1:8080', 'proxy_url: http://127.0.0.1:9')}
`).replace(
    /auth:\n  tokens:\n    - name: client\n      token: client-token\noauth:\n  refresh_token: refresh-token\n/,
    `auth:\n  gateway_token: gateway-token\n  internal_control_token: ${configInternalControlMaterial}\n`,
  )
  for (const weak of ['short-material', 'change-me-proxy-binding-secret', 'placeholder-proxy-binding-secret', configInternalControlMaterial, configAttestationMaterial, 'gateway-token']) {
    assert.throws(() => loadConfig(writeConfigYaml(productionSidecarYaml(weak))), /proxy_binding_secret.*(?:production|independent|high-entropy)/i, weak)
  }
})

test('sub2api production formal-pool can enable production TLS sidecar with mock bridge disabled', () => {
  const yaml = configYaml(`
mode: sub2api
shared_pool:
  upstream_mode: production
  production_upstream_enabled: true
  context_attestation_secret_ref: opaque:attestation-ref:v1:formal-pool
  context_attestation_secret: ${configAttestationMaterial}
egress_tls_sidecar:
  enabled: true
  endpoint: http://127.0.0.1:19484
  control_token: ${configInternalControlMaterial}
  proxy_binding_secret: ${configProxyBindingMaterial}
  allowed_target_hosts: [api.anthropic.com]
  logical_target_host: api.anthropic.com
  allowed_routes: [/v1/messages]
  allowed_profile_refs:
    - tls-profile:claude-code-2.1.179-real-oracle-tcp-v1
    - tls-profile:claude-code-2.1.197-real-oracle-tcp-v1
  expected_tls_summary_bucket: tls-bucket:claude-code-real-oracle-2197
  mock_messages_response:
    enabled: false
    mode: local_smoke
tls_profiles:
  oracle:
    profile_ref: tls-profile:claude-code-2.1.197-real-oracle-tcp-v1
    enabled: true
${formalPoolMapsYaml.replace('proxy_url: http://127.0.0.1:8080', 'proxy_url: http://127.0.0.1:9')}
`).replace(
    /auth:\n  tokens:\n    - name: client\n      token: client-token\noauth:\n  refresh_token: refresh-token\n/,
    `auth:\n  gateway_token: gateway-token\n  internal_control_token: ${configInternalControlMaterial}\n`,
  )
  const config = loadConfig(writeConfigYaml(yaml))
  assert.equal(config.egress_tls_sidecar?.enabled, true)
  assert.equal(config.egress_tls_sidecar?.mock_messages_response?.enabled, false)
  assert.deepEqual(config.egress_tls_sidecar?.allowed_target_hosts, ['api.anthropic.com'])
  assert.deepEqual(config.egress_tls_sidecar?.allowed_routes, ['/v1/messages'])
})

test('formal-pool mcp connector policy is disabled by default in production', () => {
  const config = loadConfig(writeConfigYaml(formalPoolMCPConnectorConfigYaml()))
  assert.equal(config.formal_pool?.mcp_connector?.enabled ?? false, false)
})

test('production rejects disabled mcp connector carrying forbidden or unknown config', () => {
  const cases = [
    [
      'disabled raw authorization token',
      `  mcp_connector:
    enabled: false
    authorization_token: fixture-token
`,
      /formal_pool_mcp_connector_control_key_forbidden/,
    ],
    [
      'disabled target override',
      `  mcp_connector:
    enabled: false
    target_url: https://other.example.invalid
`,
      /formal_pool_mcp_connector_control_key_forbidden/,
    ],
    [
      'disabled unknown key',
      `  mcp_connector:
    enabled: false
    extra_future_toggle: true
`,
      /formal_pool_mcp_connector_unknown_key/,
    ],
    [
      'disabled latent authorization opt-in',
      `  mcp_connector:
    enabled: false
    allow_authorization_token: true
`,
      /formal_pool_mcp_connector_auth_credentials_forbidden/,
    ],
  ] as const

  for (const [name, snippet, expected] of cases) {
    assert.throws(
      () => loadConfig(writeConfigYaml(formalPoolMCPConnectorConfigYaml(snippet))),
      expected,
      name,
    )
  }
})

test('production rejects mcp connector enabled without explicit host allowlist', () => {
  assert.throws(
    () => loadConfig(writeConfigYaml(formalPoolMCPConnectorConfigYaml(`  mcp_connector:
    enabled: true
    mode: official_remote_https
    allowed_models:
      - claude-opus-4-8
`))),
    /formal_pool_mcp_connector_allowlist_required/,
  )
})

test('production rejects mcp connector enabled without explicit model allowlist', () => {
  assert.throws(
    () => loadConfig(writeConfigYaml(formalPoolMCPConnectorConfigYaml(`  mcp_connector:
    enabled: true
    mode: official_remote_https
    allowed_hosts:
      - docs.example.com
`))),
    /formal_pool_mcp_connector_model_allowlist_required/,
  )
})

test('production rejects mcp connector when sidecar is disabled, mock bridge enabled, or dial override present', () => {
  const cases = [
    [
      'sidecar_disabled',
      `
egress_tls_sidecar:
  enabled: false
`,
      /formal_pool_mcp_connector_requires_sidecar/,
    ],
    [
      'mock_bridge_enabled',
      `
egress_tls_sidecar:
  enabled: true
  endpoint: http://127.0.0.1:19484
  control_token: ${configInternalControlMaterial}
  proxy_binding_secret: ${configProxyBindingMaterial}
  allowed_target_hosts: [api.anthropic.com]
  logical_target_host: api.anthropic.com
  allowed_routes: [/v1/messages]
  allowed_profile_refs: [tls-profile:claude-code-2.1.197-real-oracle-tcp-v1]
  expected_tls_summary_bucket: tls-bucket:claude-code-real-oracle-2197
  mock_messages_response:
    enabled: true
    mode: local_smoke
tls_profiles:
  oracle:
    profile_ref: tls-profile:claude-code-2.1.197-real-oracle-tcp-v1
    enabled: true
`,
      /formal_pool_mcp_connector_mock_bridge_forbidden|mock_messages_response.*production|production.*mock_messages_response/,
    ],
    [
      'dial_override',
      `
egress_tls_sidecar:
  enabled: true
  endpoint: http://127.0.0.1:19484
  control_token: ${configInternalControlMaterial}
  proxy_binding_secret: ${configProxyBindingMaterial}
  allowed_target_hosts: [api.anthropic.com]
  logical_target_host: api.anthropic.com
  allowed_routes: [/v1/messages]
  allowed_profile_refs: [tls-profile:claude-code-2.1.197-real-oracle-tcp-v1]
  expected_tls_summary_bucket: tls-bucket:claude-code-real-oracle-2197
  dial_override:
    api.anthropic.com: 127.0.0.1:19685
tls_profiles:
  oracle:
    profile_ref: tls-profile:claude-code-2.1.197-real-oracle-tcp-v1
    enabled: true
`,
      /dial_override/,
    ],
  ] as const

  for (const [name, sidecarYaml, expected] of cases) {
    assert.throws(
      () => loadConfig(writeConfigYaml(formalPoolMCPConnectorConfigYaml(`  mcp_connector:
    enabled: true
    mode: official_remote_https
    allowed_hosts:
      - docs.example.com
    allowed_models:
      - claude-opus-4-8
`, sidecarYaml))),
      expected,
      name,
    )
  }
})

test('production rejects mcp connector with unknown auth or target control keys', () => {
  const forbiddenSnippets = [
    ['authorization_token', '    authorization_token: fixture-token\n', /formal_pool_mcp_connector_control_key_forbidden/],
    ['headers', '    headers:\n      Authorization: fixture-token\n', /formal_pool_mcp_connector_control_key_forbidden/],
    ['api_key', '    api_key: fixture-key\n', /formal_pool_mcp_connector_control_key_forbidden/],
    ['target_url', '    target_url: https://other.example.invalid\n', /formal_pool_mcp_connector_control_key_forbidden/],
    ['dial_override', '    dial_override: 127.0.0.1:19685\n', /formal_pool_mcp_connector_control_key_forbidden/],
    ['unknown_key', '    extra_future_toggle: true\n', /formal_pool_mcp_connector_unknown_key/],
  ] as const

  for (const [name, snippet, expected] of forbiddenSnippets) {
    assert.throws(
      () => loadConfig(writeConfigYaml(formalPoolMCPConnectorConfigYaml(`  mcp_connector:
    enabled: true
    mode: official_remote_https
    allowed_hosts:
      - docs.example.com
    allowed_models:
      - claude-opus-4-8
${snippet}`))),
      expected,
      name,
    )
  }
})

test('production mcp connector requires sidecar target host allowlist exactly api.anthropic.com', () => {
  assert.throws(
    () => loadConfig(writeConfigYaml(formalPoolMCPConnectorConfigYaml(`  mcp_connector:
    enabled: true
    mode: official_remote_https
    allowed_hosts:
      - docs.example.com
    allowed_models:
      - claude-opus-4-8
`, `
egress_tls_sidecar:
  enabled: true
  endpoint: http://127.0.0.1:19484
  control_token: ${configInternalControlMaterial}
  proxy_binding_secret: ${configProxyBindingMaterial}
  allowed_target_hosts:
    - api.anthropic.com
    - other.example.invalid
  logical_target_host: api.anthropic.com
  allowed_routes: [/v1/messages]
  allowed_profile_refs: [tls-profile:claude-code-2.1.197-real-oracle-tcp-v1]
  expected_tls_summary_bucket: tls-bucket:claude-code-real-oracle-2197
  mock_messages_response:
    enabled: false
    mode: local_smoke
tls_profiles:
  oracle:
    profile_ref: tls-profile:claude-code-2.1.197-real-oracle-tcp-v1
    enabled: true
`))),
    /formal_pool_mcp_connector_requires_anthropic_sidecar_target/,
  )
})

test('production accepts explicit mcp connector allowlist with complete sidecar and no mock bridge', () => {
  const config = loadConfig(writeConfigYaml(formalPoolMCPConnectorConfigYaml(`  mcp_connector:
    enabled: true
    mode: official_remote_https
    allowed_hosts:
      - docs.example.com
    allowed_models:
      - claude-opus-4-8
`)))
  assert.equal(config.formal_pool?.mcp_connector?.enabled, true)
  assert.deepEqual(config.formal_pool?.mcp_connector?.allowed_hosts, ['docs.example.com'])
  assert.deepEqual(config.formal_pool?.mcp_connector?.allowed_models, ['claude-opus-4-8'])
})

test('production accepts explicit mcp connector suffix allowlist with complete sidecar and no mock bridge', () => {
  const config = loadConfig(writeConfigYaml(formalPoolMCPConnectorConfigYaml(`  mcp_connector:
    enabled: true
    mode: official_remote_https
    allowed_hosts:
      - "*.example.com"
      - .docs.example.org
    allowed_models:
      - claude-opus-4-8
`)))
  assert.equal(config.formal_pool?.mcp_connector?.enabled, true)
  assert.deepEqual(config.formal_pool?.mcp_connector?.allowed_hosts, ['*.example.com', '.docs.example.org'])
  assert.deepEqual(config.formal_pool?.mcp_connector?.allowed_models, ['claude-opus-4-8'])
})

test('production rejects mcp connector wildcard host allowlist', () => {
  assert.throws(() => loadConfig(writeConfigYaml(formalPoolMCPConnectorConfigYaml(`  mcp_connector:
    enabled: true
    mode: official_remote_https
    allowed_hosts:
      - "*"
    allowed_models:
      - claude-opus-4-8
`))), /formal_pool_mcp_connector_allowlist_required/)
})

test('production rejects mcp connector overly broad suffix host allowlist', () => {
  for (const host of ['*.com', '.com']) {
    assert.throws(() => loadConfig(writeConfigYaml(formalPoolMCPConnectorConfigYaml(`  mcp_connector:
    enabled: true
    mode: official_remote_https
    allowed_hosts:
      - "${host}"
    allowed_models:
      - claude-opus-4-8
`))), /formal_pool_mcp_connector_allowlist_required/, host)
  }
})

test('production accepts explicit mcp connector wildcard model allowlist only as opt-in config', () => {
  const config = loadConfig(writeConfigYaml(formalPoolMCPConnectorConfigYaml(`  mcp_connector:
    enabled: true
    mode: official_remote_https
    allowed_hosts:
      - docs.example.com
    allowed_models:
      - "*"
`)))
  assert.equal(config.formal_pool?.mcp_connector?.enabled, true)
  assert.deepEqual(config.formal_pool?.mcp_connector?.allowed_hosts, ['docs.example.com'])
  assert.deepEqual(config.formal_pool?.mcp_connector?.allowed_models, ['*'])
})

test('sub2api local smoke formal-pool can explicitly enable sidecar mock messages response bridge', () => {
  const yaml = configYaml(`
mode: sub2api
shared_pool:
  upstream_mode: local-capture
  context_attestation_secret_ref: opaque:attestation-ref:v1:formal-pool
  context_attestation_secret: ${configAttestationMaterial}
egress_tls_sidecar:
  enabled: true
  endpoint: http://127.0.0.1:19284
  control_token: ${configInternalControlMaterial}
  proxy_binding_secret: ${configProxyBindingMaterial}
  allowed_target_hosts: [api.anthropic.com]
  logical_target_host: api.anthropic.com
  allowed_routes: [/v1/messages]
  allowed_profile_refs: [tls-profile:claude-code-2.1.179-real-oracle-tcp-v1]
  expected_tls_summary_bucket: tls-bucket:claude-code-real-oracle-2179
  mock_messages_response:
    enabled: true
    mode: local_smoke
tls_profiles:
  oracle:
    profile_ref: tls-profile:claude-code-2.1.179-real-oracle-tcp-v1
    enabled: true
${formalPoolMapsYaml.replace('proxy_url: http://127.0.0.1:8080', 'proxy_url: http://127.0.0.1:9')}
`).replace(
    /upstream:\n  url: "https:\/\/api\.anthropic\.com"\n/,
    'upstream:\n  url: http://127.0.0.1:19285\n',
  ).replace(
    /auth:\n  tokens:\n    - name: client\n      token: client-token\noauth:\n  refresh_token: refresh-token\n/,
    `auth:\n  gateway_token: gateway-token\n  internal_control_token: ${configInternalControlMaterial}\n`,
  )
  const path = writeConfigYaml(yaml)
  const config = loadConfig(path)
  assert.equal(config.egress_tls_sidecar?.mock_messages_response?.enabled, true)
  assert.equal(config.egress_tls_sidecar?.mock_messages_response?.mode, 'local_smoke')
})

test('sidecar mock messages response bridge requires parent sidecar enabled', () => {
  const yaml = configYaml(`
mode: sub2api
shared_pool:
  upstream_mode: local-capture
  context_attestation_secret_ref: opaque:attestation-ref:v1:formal-pool
  context_attestation_secret: ${configAttestationMaterial}
egress_tls_sidecar:
  enabled: false
  endpoint: http://127.0.0.1:19284
  control_token: ${configInternalControlMaterial}
  proxy_binding_secret: ${configProxyBindingMaterial}
  allowed_target_hosts: [api.anthropic.com]
  logical_target_host: api.anthropic.com
  allowed_routes: [/v1/messages]
  allowed_profile_refs: [tls-profile:claude-code-2.1.179-real-oracle-tcp-v1]
  expected_tls_summary_bucket: tls-bucket:claude-code-real-oracle-2179
  mock_messages_response:
    enabled: true
    mode: local_smoke
tls_profiles:
  oracle:
    profile_ref: tls-profile:claude-code-2.1.179-real-oracle-tcp-v1
    enabled: true
${formalPoolMapsYaml.replace('proxy_url: http://127.0.0.1:8080', 'proxy_url: http://127.0.0.1:9')}
`).replace(
    /upstream:\n  url: "https:\/\/api\.anthropic\.com"\n/,
    'upstream:\n  url: http://127.0.0.1:19285\n',
  ).replace(
    /auth:\n  tokens:\n    - name: client\n      token: client-token\noauth:\n  refresh_token: refresh-token\n/,
    `auth:\n  gateway_token: gateway-token\n  internal_control_token: ${configInternalControlMaterial}\n`,
  )
  const path = writeConfigYaml(yaml)
  assert.throws(() => loadConfig(path), /mock_messages_response.*sidecar.*enabled|sidecar.*enabled.*mock_messages_response/i)
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
  assert.match(formalPoolExample, /egress_tls:/)
  assert.match(formalPoolExample, /tls_profiles:/)
  assert.match(formalPoolExample, /egress_tls_sidecar:/)
  assert.match(formalPoolExample, /tls_profile_ref: tls-profile:claude-code-2\.1\.179-real-oracle-tcp-v1/)
  assert.match(formalPoolExample, /expected_tls_summary_bucket: tls-bucket:claude-code-real-oracle-2179/)
  assert.doesNotMatch(example, /sha256:<redacted>/)
  assert.doesNotMatch(formalPoolExample, /sha256:<redacted>/)
  assert.match(formalPoolExample, /opaque:proxy-ref:v1:/)
})

await finish()
