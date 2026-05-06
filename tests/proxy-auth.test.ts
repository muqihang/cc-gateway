import { strict as assert } from 'assert'
import { authenticate, authenticateGateway, initAuth } from '../src/auth.js'
import { baseConfig, finish, test } from './helpers.js'

console.log('\ntests/proxy-auth.test.ts')

function req(headers: Record<string, string>) {
  return { headers } as any
}

test('standalone mode still accepts legacy x-api-key client token', () => {
  initAuth(baseConfig())
  assert.equal(authenticate(req({ 'x-api-key': 'client-token' })), 'client')
})

test('sub2api mode does not use x-api-key for gateway authentication', () => {
  initAuth(baseConfig({ mode: 'sub2api', auth: { gateway_token: 'gateway-token', tokens: [{ name: 'legacy', token: 'selected-api-key' }] } } as any))
  assert.equal(authenticateGateway(req({ 'x-api-key': 'selected-api-key' })), null)
})

test('sub2api mode does not use authorization for gateway authentication', () => {
  initAuth(baseConfig({ mode: 'sub2api', auth: { gateway_token: 'gateway-token', tokens: [{ name: 'legacy', token: 'selected-token' }] } } as any))
  assert.equal(authenticateGateway(req({ authorization: 'Bearer selected-token' })), null)
})

test('sub2api mode requires x-cc-gateway-token', () => {
  initAuth(baseConfig({ mode: 'sub2api', auth: { gateway_token: 'gateway-token', tokens: [] } } as any))
  assert.equal(authenticateGateway(req({ 'x-cc-gateway-token': 'gateway-token' })), 'gateway')
})

test('sub2api mode rejects wrong x-cc-gateway-token', () => {
  initAuth(baseConfig({ mode: 'sub2api', auth: { gateway_token: 'gateway-token', tokens: [] } } as any))
  assert.equal(authenticateGateway(req({ 'x-cc-gateway-token': 'wrong-token' })), null)
})

await finish()
