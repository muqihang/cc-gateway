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
  assert.match(example, /version: "2\.1\.119"/)
  assert.match(example, /version_base: "2\.1\.119"/)
  assert.match(example, /build_time: "2026-04-23T19:08:52Z"/)
})

await finish()
