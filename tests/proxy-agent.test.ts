import { strict as assert } from 'assert'

console.log('\ntests/proxy-agent.test.ts')

const proxyUrl = 'http://user:pass@127.0.0.1:3128'
const originalEnv = {
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  https_proxy: process.env.https_proxy,
  HTTP_PROXY: process.env.HTTP_PROXY,
  http_proxy: process.env.http_proxy,
  ALL_PROXY: process.env.ALL_PROXY,
  all_proxy: process.env.all_proxy,
}
process.env.HTTPS_PROXY = proxyUrl
process.env.https_proxy = proxyUrl
process.env.HTTP_PROXY = proxyUrl
process.env.http_proxy = proxyUrl
process.env.ALL_PROXY = proxyUrl
process.env.all_proxy = proxyUrl

const { getProxyAgent, resetProxyAgentCacheForTest } = await import('../src/proxy-agent.js')
const { test, finish } = await import('./helpers.js')

test('proxy agent cache is keyed so per-account pools can stay isolated', () => {
  const logs: string[] = []
  const originalLog = console.log
  console.log = (...args: any[]) => {
    logs.push(args.map(String).join(' '))
  }

  try {
    const agentA1 = getProxyAgent('anthropic|1|bucket-a|proxy-hash-a')
    const agentA2 = getProxyAgent('anthropic|1|bucket-a|proxy-hash-a')
    const agentB = getProxyAgent('anthropic|1|bucket-b|proxy-hash-a')

    assert.ok(agentA1)
    assert.ok(agentA2)
    assert.ok(agentB)
    assert.strictEqual(agentA1, agentA2, 'same cache key should reuse one agent')
    assert.notStrictEqual(agentA1, agentB, 'different bucket cache keys should not reuse the same agent')
    const combinedLogs = logs.join('\n')
    assert.ok(!combinedLogs.includes('user:pass'), 'proxy credentials must not be logged')
    assert.ok(!combinedLogs.includes(proxyUrl), 'raw proxy URL must not be logged')
  } finally {
    console.log = originalLog
    process.env.HTTPS_PROXY = originalEnv.HTTPS_PROXY
    process.env.https_proxy = originalEnv.https_proxy
    process.env.HTTP_PROXY = originalEnv.HTTP_PROXY
    process.env.http_proxy = originalEnv.http_proxy
    process.env.ALL_PROXY = originalEnv.ALL_PROXY
    process.env.all_proxy = originalEnv.all_proxy
    resetProxyAgentCacheForTest()
  }
})

await finish()
