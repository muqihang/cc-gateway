import { strict as assert } from 'assert'
import type { AddressInfo } from 'net'
import { once } from 'events'
import { ConfigValidationError, type Config } from '../src/config.js'
import { resolveListenerBoundary } from '../src/listener-boundary.js'
import { startProxy } from '../src/proxy.js'
import { baseConfig, close, finish, observedStartupPrimitives, test } from './helpers.js'

console.log('\ntests/listener-boundary.test.ts')

const strongClientToken = 'remote-client-material-1234567890abcdef'
const strongGatewayToken = 'remote-gateway-material-1234567890abcdef'
const strongInternalToken = 'remote-internal-material-1234567890abcdef'

function remoteConfig(): Config {
  return baseConfig({
    mode: 'standalone',
    server: {
      port: 0,
      host: '0.0.0.0',
      tls: { cert: 'fixture-cert.pem', key: 'fixture-key.pem' },
      remote_listen: {
        capability: 'remote-listen-v1',
        exposure_policy_ref: 'network-exposure-policy:private-ingress-v1',
      },
    },
    auth: { tokens: [{ name: 'client', token: strongClientToken }] },
  })
}

const remoteFailures: Array<[string, (config: Config) => Config, string]> = [
  ['remote capability is required', (config) => ({ ...config, server: { ...config.server, remote_listen: {} } }), 'remote_listen_capability_required'],
  ['remote TLS is required', (config) => ({ ...config, server: { ...config.server, tls: { cert: '', key: '' } } }), 'remote_listen_tls_required'],
  ['remote auth is required when no credential exists', (config) => ({ ...config, auth: { gateway_token: '', internal_control_token: '', tokens: [] } }), 'remote_listen_strong_auth_required'],
  ['remote strong auth is required', (config) => ({ ...config, auth: { tokens: [{ name: 'client', token: 'weak' }] } }), 'remote_listen_strong_auth_required'],
  ['placeholder remote auth is rejected', (config) => ({ ...config, auth: { tokens: [{ name: 'client', token: `example-${'x'.repeat(40)}` }] } }), 'remote_listen_strong_auth_required'],
  ['leading whitespace remote auth is rejected', (config) => ({ ...config, auth: { tokens: [{ name: 'client', token: ` ${strongClientToken}` }] } }), 'remote_listen_strong_auth_required'],
  ['trailing whitespace remote auth is rejected', (config) => ({ ...config, auth: { tokens: [{ name: 'client', token: `${strongClientToken} ` }] } }), 'remote_listen_strong_auth_required'],
  ['control characters in remote auth are rejected', (config) => ({ ...config, auth: { tokens: [{ name: 'client', token: `${strongClientToken}\u0000` }] } }), 'remote_listen_strong_auth_required'],
  ['Sub2API remote internal auth is required', (config) => ({ ...config, mode: 'sub2api', auth: { gateway_token: strongGatewayToken, internal_control_token: '', tokens: [] } }), 'remote_listen_strong_auth_required'],
  ['Sub2API remote internal auth is independent', (config) => ({ ...config, mode: 'sub2api', auth: { gateway_token: strongGatewayToken, internal_control_token: strongGatewayToken, tokens: [] } }), 'remote_listen_strong_auth_required'],
  ['Sub2API canonical internal auth equality is rejected', (config) => ({ ...config, mode: 'sub2api', auth: { gateway_token: strongGatewayToken, internal_control_token: `${strongGatewayToken}   `, tokens: [] } }), 'remote_listen_strong_auth_required'],
  ['Sub2API remote fallback auth is strong', (config) => ({ ...config, mode: 'sub2api', auth: { gateway_token: strongGatewayToken, internal_control_token: strongInternalToken, tokens: [{ name: 'legacy', token: 'weak' }] } }), 'remote_listen_strong_auth_required'],
  ['remote exposure policy is required', (config) => ({ ...config, server: { ...config.server, remote_listen: { capability: 'remote-listen-v1' } } }), 'remote_listen_exposure_policy_required'],
  ['syntactic but unapproved policy is rejected', (config) => ({ ...config, server: { ...config.server, remote_listen: { capability: 'remote-listen-v1', exposure_policy_ref: 'network-exposure-policy:invented-v1' } } }), 'remote_listen_exposure_policy_unapproved'],
]

test('omitted listener host resolves to IPv4 loopback', () => {
  assert.deepEqual(resolveListenerBoundary(baseConfig()), { host: '127.0.0.1', remote: false })
})

test('bracketed IPv6 loopback is normalized for Node listen', () => {
  const config = baseConfig({ server: { port: 0, host: '[::1]', tls: { cert: '', key: '' } } })
  assert.deepEqual(resolveListenerBoundary(config), { host: '::1', remote: false })
})

test('IPv4 127/8 listener addresses remain loopback-only', () => {
  const config = baseConfig({ server: { port: 0, host: '127.0.0.2', tls: { cert: '', key: '' } } })
  assert.deepEqual(resolveListenerBoundary(config), { host: '127.0.0.2', remote: false })
})

test('approved remote listener resolves without reading TLS files', () => {
  assert.deepEqual(resolveListenerBoundary(remoteConfig()), { host: '0.0.0.0', remote: true })
})

test('Sub2API approved remote listener requires independent strong controls', () => {
  const config = remoteConfig()
  config.mode = 'sub2api'
  config.auth = { gateway_token: strongGatewayToken, internal_control_token: strongInternalToken, tokens: [] }
  assert.deepEqual(resolveListenerBoundary(config), { host: '0.0.0.0', remote: true })
})

for (const [name, mutate, code] of remoteFailures) {
  test(name, () => {
    assert.throws(
      () => resolveListenerBoundary(mutate(remoteConfig())),
      (error: unknown) => error instanceof ConfigValidationError
        && error.code === code
        && error.message === `config: ${code}`,
    )
  })

  test(`${name} is rejected by startProxy before startup effects`, () => {
    const observed = observedStartupPrimitives()
    assert.throws(
      () => startProxy(mutate(remoteConfig()), observed.primitives),
      (error: unknown) => error instanceof ConfigValidationError
        && error.code === code
        && error.message === `config: ${code}`,
    )
    assert.deepEqual(observed.calls, [])
  })
}

test('omitted host binds observed IPv4 loopback socket state', async () => {
  const server = startProxy(baseConfig({ server: { port: 0, tls: { cert: '', key: '' } } }))
  try {
    if (!server.listening) await once(server, 'listening')
    const address = server.address() as AddressInfo
    assert.equal(address.address, '127.0.0.1')
  } finally {
    await close(server)
  }
})

test('explicit IPv4 loopback binds observed IPv4 socket state', async () => {
  const server = startProxy(baseConfig({ server: { port: 0, host: '127.0.0.1', tls: { cert: '', key: '' } } }))
  try {
    if (!server.listening) await once(server, 'listening')
    assert.equal((server.address() as AddressInfo).address, '127.0.0.1')
  } finally {
    await close(server)
  }
})

test('bracketed IPv6 loopback binds observed unbracketed IPv6 socket state', async () => {
  const server = startProxy(baseConfig({ server: { port: 0, host: '[::1]', tls: { cert: '', key: '' } } }))
  try {
    if (!server.listening) await once(server, 'listening')
    assert.equal((server.address() as AddressInfo).address, '::1')
  } finally {
    await close(server)
  }
})

await finish()
