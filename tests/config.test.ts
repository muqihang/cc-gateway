import { strict as assert } from 'assert'
import { readFileSync } from 'fs'
import { loadConfig } from '../src/config.js'
import { configYaml, finish, test, writeConfigYaml } from './helpers.js'

console.log('\ntests/config.test.ts')

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
    'auth:\n  gateway_token: gateway-token\nmode: sub2api\n',
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
  const path = writeConfigYaml(configYaml(`
mode: sub2api
`).replace(/oauth:\n  refresh_token: refresh-token\n/, ''))
  const config = loadConfig(path)
  assert.equal(config.mode, 'sub2api')
  assert.equal(config.auth.tokens[0].token, 'client-token')
})

test('rejects invalid mode', () => {
  const path = writeConfigYaml(configYaml(`
mode: transparent
`))
  assert.throws(() => loadConfig(path), /mode/)
})

test('config.example documents Phase 0 mode/auth/provider and stable persona defaults', () => {
  const example = readFileSync(new URL('../config.example.yaml', import.meta.url), 'utf-8')
  assert.match(example, /^mode: standalone$/m)
  assert.match(example, /^providers:\n  anthropic: true$/m)
  assert.match(example, /gateway_token:/)
  assert.match(example, /account_identities:/)
  assert.match(example, /account_uuid_ref:/)
  assert.match(example, /billing_cch_mode: strip/)
  assert.match(example, /signing_enabled: false/)
  assert.match(example, /egress_buckets:/)
  assert.match(example, /openai_gateway_egress_bucket fallback\n# is intentionally not consumed/)
  assert.match(example, /version: "2\.1\.170"/)
  assert.match(example, /version_base: "2\.1\.170"/)
  assert.match(example, /shared_pool:\n  max_body_bytes: 2097152/)
  assert.match(example, /claude-sonnet-4-6/)
  assert.match(example, /claude-opus-4-7/)
  assert.match(example, /claude-opus-4-6-thinking/)
  assert.match(example, /claude-opus-4-8/)
  assert.match(example, /claude-fable-5/)
  assert.match(example, /dynamic model resolver/)
  assert.match(example, /claude_code_2_1_170_subscription_1m/)
  assert.match(example, /candidate_model_allowlist:/)
  assert.match(example, /candidate_model_audit_budgets:/)
  assert.match(example, /candidate_beta_audit_budgets:/)
  assert.doesNotMatch(example, /sha256:<redacted>/)
  assert.match(example, /scoped_hmac_ref_redacted/)
  assert.match(example, /opaque:proxy-ref:v1:/)
})

await finish()
