import { createHash } from 'node:crypto'

import { canonicalJson, Phase3AError } from './core.js'

export const SAFE_ERROR_CATEGORIES = ['authentication', 'entitlement', 'capacity', 'model', 'request-shape', 'proxy', 'transport'] as const
export type SafeErrorCategory = typeof SAFE_ERROR_CATEGORIES[number]

const PROVIDER_TYPES: Record<string, SafeErrorCategory> = {
  authentication_error: 'authentication', permission_error: 'entitlement', rate_limit_error: 'capacity',
  overloaded_error: 'capacity', invalid_request_error: 'request-shape', not_found_error: 'request-shape',
  api_error: 'transport', model_error: 'model', proxy_error: 'proxy', transport_error: 'transport',
}

export type SafeError = {
  protocol_status: number | null
  category: SafeErrorCategory
  provider_error_type: keyof typeof PROVIDER_TYPES | null
  retryable: boolean
  retry_after_bucket: 'none' | 'lt-1s' | '1s-to-10s' | '10s-to-60s' | 'gte-60s'
  reauthorization_indicated: boolean
  state_changes: { account: boolean; credential: boolean; session: boolean; budget: boolean; cooldown: boolean; quarantine: boolean }
  request_correlation_sha256: string | null
}

function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }

function boundedInput(value: unknown): string {
  let encoded: string
  try { encoded = canonicalJson(value) } catch { throw new Phase3AError('safe_error_invalid_input', 'error input must be acyclic JSON') }
  if (Buffer.byteLength(encoded) > 1024 * 1024) throw new Phase3AError('safe_error_input_limit', 'error input exceeds 1 MiB')
  return encoded
}

function categoryFor(status: number | null, providerType: string | null, memoryOnlyText: string): SafeErrorCategory | null {
  if (providerType && PROVIDER_TYPES[providerType]) return PROVIDER_TYPES[providerType]
  if (status === 401 || /auth|credential|api.?key|reauthor/i.test(memoryOnlyText)) return 'authentication'
  if (status === 403 || /entitle|permission|forbidden/i.test(memoryOnlyText)) return 'entitlement'
  if (status === 429 || /capacity|quota|rate.?limit|overload/i.test(memoryOnlyText)) return 'capacity'
  if (/\bmodel\b/i.test(memoryOnlyText)) return 'model'
  if (status !== null && status >= 400 && status < 500 || /invalid|request|schema|parse|json/i.test(memoryOnlyText)) return 'request-shape'
  if (/proxy|gateway/i.test(memoryOnlyText)) return 'proxy'
  if (status !== null && status >= 500 || /transport|network|socket|dns|tls|certificate|connect|timeout/i.test(memoryOnlyText)) return 'transport'
  return null
}

function retryBucket(value: unknown): SafeError['retry_after_bucket'] {
  const seconds = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : 0
  if (!(seconds > 0)) return 'none'
  if (seconds < 1) return 'lt-1s'
  if (seconds < 10) return '1s-to-10s'
  if (seconds < 60) return '10s-to-60s'
  return 'gte-60s'
}

export function classifySafeError(input: unknown): SafeError {
  const encoded = boundedInput(input)
  const row = object(input)
  const error = object(row.error)
  const statusValue = row.status ?? row.status_code ?? error.status
  const status = Number.isInteger(statusValue) && Number(statusValue) >= 100 && Number(statusValue) <= 599 ? Number(statusValue) : null
  const typeValue = typeof row.type === 'string' ? row.type : typeof error.type === 'string' ? error.type : null
  const providerType = typeValue && Object.hasOwn(PROVIDER_TYPES, typeValue) ? typeValue as keyof typeof PROVIDER_TYPES : null
  const category = categoryFor(status, providerType, encoded)
  if (!category) throw new Phase3AError('safe_error_unknown_class', 'error does not match the safe taxonomy')
  const retryable = typeof row.retryable === 'boolean' ? row.retryable : status === 429 || (status !== null && status >= 500) || /retry|temporary|timeout/i.test(encoded)
  const correlation = row.request_id ?? row.correlation_id ?? error.request_id
  const correlationHash = typeof correlation === 'string' && correlation.length > 0 && Buffer.byteLength(correlation) <= 4096
    ? createHash('sha256').update(correlation).digest('hex') : null
  const changed = object(row.state_changed)
  const output: SafeError = {
    protocol_status: status,
    category,
    provider_error_type: providerType,
    retryable,
    retry_after_bucket: retryBucket(row.retry_after ?? error.retry_after),
    reauthorization_indicated: category === 'authentication' && /reauthor|log.?in|sign.?in|refresh/i.test(encoded),
    state_changes: {
      account: changed.account === true, credential: changed.credential === true, session: changed.session === true,
      budget: changed.budget === true, cooldown: changed.cooldown === true, quarantine: changed.quarantine === true,
    },
    request_correlation_sha256: correlationHash,
  }
  if (Buffer.byteLength(canonicalJson(output)) > 16 * 1024) throw new Phase3AError('safe_error_output_limit', 'safe output exceeds 16 KiB')
  return output
}
