import { strict as assert } from 'assert'
import { ConfigValidationError, type Config } from '../src/config.js'
import { startProxy } from '../src/proxy.js'
import { resolveUpstreamTLSBoundary } from '../src/upstream-tls-boundary.js'
import { baseConfig, finish, observedStartupPrimitives, test } from './helpers.js'

console.log('\ntests/upstream-tls-boundary.test.ts')

function realConfig(mode: 'real-canary' | 'production' = 'production'): Config {
  return baseConfig({
    upstream: {
      url: 'https://api.anthropic.com',
      tls: { verification: 'required', trust_store: 'system' },
    },
    shared_pool: { upstream_mode: mode },
  })
}

const unsafeEnvironment = `unsafe-trust-${'z'.repeat(40)}`
const upstreamFailures: Array<[
  string,
  (config: Config) => Config,
  NodeJS.ProcessEnv,
  string,
]> = [
  ['real upstream requires HTTPS', (config) => ({ ...config, upstream: { ...config.upstream, url: 'http://api.anthropic.com' } }), {}, 'upstream_https_required'],
  ['real upstream requires certificate verification', (config) => ({ ...config, upstream: { ...config.upstream, tls: { verification: undefined, trust_store: 'system' } } }), {}, 'upstream_tls_verification_required'],
  ['real upstream requires system trust store', (config) => ({ ...config, upstream: { ...config.upstream, tls: { verification: 'required', trust_store: undefined } } }), {}, 'upstream_tls_trust_store_required'],
  ['NODE_TLS_REJECT_UNAUTHORIZED=0 is forbidden case-insensitively', (config) => config, { node_tls_reject_unauthorized: ' 0 ' }, 'upstream_tls_trust_override_forbidden'],
  ['NODE_EXTRA_CA_CERTS is forbidden', (config) => config, { NODE_EXTRA_CA_CERTS: unsafeEnvironment }, 'upstream_tls_trust_override_forbidden'],
  ['SSL_CERT_FILE is forbidden', (config) => config, { SSL_CERT_FILE: unsafeEnvironment }, 'upstream_tls_trust_override_forbidden'],
  ['SSL_CERT_DIR is forbidden', (config) => config, { SSL_CERT_DIR: unsafeEnvironment }, 'upstream_tls_trust_override_forbidden'],
]

for (const mode of ['real-canary', 'production'] as const) {
  test(`${mode} returns verified Node HTTPS request options`, () => {
    assert.deepEqual(resolveUpstreamTLSBoundary(realConfig(mode), {}), {
      real: true,
      requestOptions: { rejectUnauthorized: true },
    })
  })

  for (const [name, mutate, env, code] of upstreamFailures) {
    test(`${mode}: ${name}`, () => {
      assert.throws(
        () => resolveUpstreamTLSBoundary(mutate(realConfig(mode)), env),
        (error: unknown) => error instanceof ConfigValidationError
          && error.code === code
          && error.message === `config: ${code}`
          && !error.message.includes(unsafeEnvironment),
      )
    })

    test(`${mode}: ${name} is rejected by startProxy before startup effects`, () => {
      const observed = observedStartupPrimitives()
      const originalValues = new Map<string, string | undefined>()
      for (const [key, value] of Object.entries(env)) {
        const actualKey = Object.keys(process.env).find((candidate) => candidate.toUpperCase() === key.toUpperCase()) || key
        originalValues.set(actualKey, process.env[actualKey])
        process.env[actualKey] = value
      }
      try {
        assert.throws(
          () => startProxy(mutate(realConfig(mode)), observed.primitives),
          (error: unknown) => error instanceof ConfigValidationError
            && error.code === code
            && error.message === `config: ${code}`
            && !error.message.includes(unsafeEnvironment),
        )
        assert.deepEqual(observed.calls, [])
      } finally {
        for (const [key, value] of originalValues) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }
    })
  }
}

test('loopback HTTP remains limited to non-real mock modes', () => {
  const config = baseConfig({
    upstream: { url: 'http://127.0.0.1:43123' },
    shared_pool: { upstream_mode: 'local-capture' },
  })
  assert.deepEqual(resolveUpstreamTLSBoundary(config, {}), { real: false, requestOptions: {} })
})

test('non-loopback HTTP is rejected outside real modes', () => {
  const config = baseConfig({
    upstream: { url: 'http://example.invalid' },
    shared_pool: { upstream_mode: 'local-capture' },
  })
  assert.throws(
    () => resolveUpstreamTLSBoundary(config, {}),
    (error: unknown) => error instanceof ConfigValidationError
      && error.code === 'upstream_http_loopback_required',
  )
})

test('unsupported upstream protocols are rejected before startup effects', () => {
  const config = baseConfig({
    upstream: { url: 'ftp://127.0.0.1/resource' },
    shared_pool: { upstream_mode: 'local-capture' },
  })
  const observed = observedStartupPrimitives()
  assert.throws(
    () => startProxy(config, observed.primitives),
    (error: unknown) => error instanceof ConfigValidationError
      && error.code === 'upstream_protocol_unsupported',
  )
  assert.deepEqual(observed.calls, [])
})

await finish()
