import { strict as assert } from 'assert'
import { readFileSync } from 'fs'
import { loadConfig } from '../src/config.js'
import { finish, test, writeConfigYaml } from './helpers.js'

console.log('\ntests/formal-pool-canonical-promotion.test.ts')

const internalControlMaterial = 'internal-control-material-v1-plan75-safe-fixture-abcdef'
const attestationMaterial = 'scheduler-hmac-material-v1-plan75-safe-fixture-abcdef'
const rollbackTLSProfileRef = 'tls-profile:claude-code-2.1.179-real-oracle-tcp-v1'
const rollbackTLSBucket = 'tls-bucket:claude-code-real-oracle-2179'

function rollbackOnlyFormalPoolYaml(): string {
  return `
server:
  port: 0
  tls:
    cert: ""
    key: ""
mode: sub2api
upstream:
  url: https://api.anthropic.com
providers:
  anthropic: true
auth:
  gateway_token: gateway-token
  internal_control_token: ${internalControlMaterial}
identity:
  device_id: ${'a'.repeat(64)}
  email: redacted-email
env:
  platform: darwin
  version: "2.1.179"
  version_base: "2.1.179"
prompt_env:
  platform: darwin
  shell: zsh
  os_version: "Darwin 24.4.0"
  working_dir: /Users/jack/projects
process:
  constrained_memory: 34359738368
  rss_range: [300000000, 500000000]
  heap_total_range: [40000000, 80000000]
  heap_used_range: [100000000, 200000000]
shared_pool:
  context_attestation_secret_ref: opaque:attestation-ref:v1:formal-pool
  context_attestation_secret: ${attestationMaterial}
  billing_cch_mode: strip
  upstream_mode: preflight
  real_canary_user_approved: false
  egress_tls:
    enabled: true
    strict: true
  env_residue:
    env_residue_profile_ref: env-residue-profile:claude-code-2.1.179-us-pacific-official-anthropic-v1
    locale_profile_ref: locale-profile:us-pacific-v1
    base_url_residue_profile_ref: base-url-residue-profile:official-anthropic-v1
tls_profiles:
  rollback-2179:
    profile_ref: ${rollbackTLSProfileRef}
    source: observed-oracle-63
    enabled: true
egress_tls_sidecar:
  enabled: true
  endpoint: http://127.0.0.1:19081
  control_token: independent-sidecar-control-token-plan75
  allowed_target_hosts: ["api.anthropic.com"]
  logical_target_host: api.anthropic.com
  allowed_routes: ["/v1/messages"]
  allowed_profile_refs:
    - ${rollbackTLSProfileRef}
  expected_tls_summary_bucket: ${rollbackTLSBucket}
account_identities:
  account-a:
    device_id: ${'b'.repeat(64)}
    account_uuid_ref: opaque:account-ref:v1:acct-a
    account_ref: opaque:account-partition:v1:acct-a
    credential_ref: opaque:credential-ref:v1:cred-a
    credential_binding_hmac: hmac-sha256:${'c'.repeat(64)}
    persona_variant: claude-code-2.1.179-macos-local
    session_policy: preserve_downstream_session_id
    policy_version: "2.1.179"
egress_buckets:
  bucket-a:
    enabled: true
    proxy_url: http://127.0.0.1:19080
    proxy_identity_ref: opaque:proxy-ref:v1:bucket-a
    allowed_account_ids: [account-a]
    tls_profile_ref: ${rollbackTLSProfileRef}
logging:
  level: error
  audit: false
`
}

test('Plan75 blocked path keeps rollback 2.1.179 as the only configured canonical identity', () => {
  const config = loadConfig(writeConfigYaml(rollbackOnlyFormalPoolYaml()))
  assert.equal(config.env.version, '2.1.179')
  assert.equal(config.env.version_base, '2.1.179')
  assert.equal(config.account_identities?.['account-a'].policy_version, '2.1.179')
  assert.equal(config.account_identities?.['account-a'].persona_variant, 'claude-code-2.1.179-macos-local')
  assert.equal(config.egress_buckets?.['bucket-a'].tls_profile_ref, rollbackTLSProfileRef)
  assert.deepEqual(config.egress_tls_sidecar?.allowed_profile_refs, [rollbackTLSProfileRef])
  assert.equal(config.egress_tls_sidecar?.expected_tls_summary_bucket, rollbackTLSBucket)
})

test('Plan75 blocked path leaves 2.1.185 and 2.1.197 absent from CC Gateway formal-pool defaults', () => {
  const example = readFileSync(new URL('../config.sub2api.formal-pool.example.yaml', import.meta.url), 'utf-8')
  const sourceFiles = [
    readFileSync(new URL('../src/config.ts', import.meta.url), 'utf-8'),
    readFileSync(new URL('../src/proxy.ts', import.meta.url), 'utf-8'),
  ].join('\n')

  assert.match(example, /Claude Code 2\.1\.179 stable formal-pool production target/)
  assert.match(example, /version: "2\.1\.179"/)
  assert.match(example, /policy_version: "2\.1\.179"/)
  assert.match(example, /tls-profile:claude-code-2\.1\.179-real-oracle-tcp-v1/)
  assert.match(example, /strip_attribution/)

  for (const promotedVersion of ['2.1.185', '2.1.197']) {
    assert.doesNotMatch(example, new RegExp(`policy_version: "${promotedVersion.replaceAll('.', '\\.')}`))
    assert.doesNotMatch(example, new RegExp(`version: "${promotedVersion.replaceAll('.', '\\.')}`))
    assert.doesNotMatch(sourceFiles, new RegExp(`claude-code-${promotedVersion.replaceAll('.', '\\.')}-macos-local`))
  }
})

test('2.1.197 TLS oracle is compiled only in the sidecar and not promoted into runtime config defaults', () => {
  const profileSource = readFileSync(new URL('../sidecar/egress-tls-sidecar/internal/profile/profile.go', import.meta.url), 'utf-8')
  const example = readFileSync(new URL('../config.sub2api.formal-pool.example.yaml', import.meta.url), 'utf-8')
  assert.match(profileSource, /tls-profile:claude-code-2\.1\.197-real-oracle-tcp-v1/)
  assert.doesNotMatch(example, /tls-profile:claude-code-2\.1\.197-real-oracle-tcp-v1/)
  assert.doesNotMatch(example, /tls-bucket:claude-code-real-oracle-2197/)
})

await finish()
