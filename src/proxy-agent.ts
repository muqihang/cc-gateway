import { HttpsProxyAgent } from 'https-proxy-agent'
import type { Agent } from 'https'
import { createHash } from 'crypto'
import { log } from './logger.js'

const agents = new Map<string, Agent>()

export function getProxyAgent(cacheKey = 'default', explicitProxyUrl?: string): Agent | null {
  const proxyUrl = explicitProxyUrl ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy
  if (!proxyUrl || proxyUrl === 'undefined' || proxyUrl === 'null') return null
  const key = cacheKey || 'default'
  const existing = agents.get(key)
  if (existing) return existing
  const agent = new HttpsProxyAgent(proxyUrl)
  agents.set(key, agent)
  log('info', 'Using proxy agent', {
    cacheKeyHash: `sha256:${createHash('sha256').update(key).digest('hex')}`,
    proxyHash: `sha256:${createHash('sha256').update(proxyUrl).digest('hex')}`,
  })
  return agent
}

export function resetProxyAgentCacheForTest() {
  agents.clear()
}
