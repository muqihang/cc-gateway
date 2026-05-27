import type { Config } from './config.js'

export type CanaryCostEnvelopeResult =
  | { ok: true; summary: CanaryCostEnvelopeSummary }
  | { ok: false; status: number; code: string; summary: CanaryCostEnvelopeSummary }

export type CanaryCostEnvelopeSummary = {
  enabled: boolean
  model?: string
  maxTokens?: number
  bodyBytes: number
  toolsCount?: number
  thinkingPresent: boolean
  thinkingBudgetTokens?: number
  outputConfigPresent: boolean
  contextManagementPresent: boolean
  limits: Required<CanaryCostEnvelopeLimits>
}

type CanaryCostEnvelopeLimits = {
  max_tokens?: number
  max_body_bytes?: number
  max_tools_count?: number
  allow_thinking?: boolean
  max_thinking_budget_tokens?: number
  allow_output_config?: boolean
  allow_context_management?: boolean
  allowed_models?: string[]
}

const DEFAULT_LIMITS: Required<CanaryCostEnvelopeLimits> = {
  max_tokens: 2048,
  max_body_bytes: 32 * 1024,
  max_tools_count: 3,
  allow_thinking: false,
  max_thinking_budget_tokens: 0,
  allow_output_config: true,
  allow_context_management: true,
  allowed_models: ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-opus-4-7-thinking', 'claude-opus-4-6', 'claude-opus-4-6-thinking', 'claude-haiku-4-5-20251001'],
}

export function evaluateCanaryCostEnvelope(config: Config, body: Buffer): CanaryCostEnvelopeResult {
  const sharedPool = (config as any).shared_pool || {}
  const envelopeConfig = sharedPool.canary_cost_envelope || {}
  const enabled = envelopeConfig.enabled === true || sharedPool.upstream_mode === 'real-canary'
  const limits = normalizeLimits(envelopeConfig)
  const summaryBase: CanaryCostEnvelopeSummary = {
    enabled,
    bodyBytes: body.length,
    thinkingPresent: false,
    outputConfigPresent: false,
    contextManagementPresent: false,
    limits,
  }

  if (!enabled) return { ok: true, summary: summaryBase }

  let parsed: any
  try {
    parsed = JSON.parse(body.toString('utf-8'))
  } catch {
    return { ok: false, status: 400, code: 'canary_cost_envelope_invalid_json', summary: summaryBase }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, status: 400, code: 'canary_cost_envelope_invalid_json', summary: summaryBase }
  }

  const summary: CanaryCostEnvelopeSummary = {
    ...summaryBase,
    model: typeof parsed.model === 'string' ? parsed.model : undefined,
    maxTokens: typeof parsed.max_tokens === 'number' ? parsed.max_tokens : undefined,
    toolsCount: Array.isArray(parsed.tools) ? parsed.tools.length : 0,
    thinkingPresent: parsed.thinking !== undefined,
    thinkingBudgetTokens: parsed.thinking && typeof parsed.thinking === 'object' && typeof parsed.thinking.budget_tokens === 'number'
      ? parsed.thinking.budget_tokens
      : undefined,
    outputConfigPresent: parsed.output_config !== undefined,
    contextManagementPresent: parsed.context_management !== undefined,
  }

  if (!summary.model || (!limits.allowed_models.includes(summary.model) && !isCandidateModelAllowed(sharedPool, summary.model))) {
    return { ok: false, status: 403, code: 'canary_cost_envelope_model_blocked', summary }
  }
  if (summary.maxTokens === undefined || !Number.isFinite(summary.maxTokens) || summary.maxTokens <= 0 || summary.maxTokens > limits.max_tokens) {
    return { ok: false, status: 403, code: 'canary_cost_envelope_max_tokens_exceeded', summary }
  }
  if (body.length > limits.max_body_bytes) {
    return { ok: false, status: 413, code: 'canary_cost_envelope_body_too_large', summary }
  }
  if ((summary.toolsCount ?? 0) > limits.max_tools_count) {
    return { ok: false, status: 403, code: 'canary_cost_envelope_tools_exceeded', summary }
  }
  if (summary.thinkingPresent) {
    const thinking = parsed.thinking
    const disabledThinking = thinking && typeof thinking === 'object' && thinking.type === 'disabled'
    if (!limits.allow_thinking && !disabledThinking) {
      return { ok: false, status: 403, code: 'canary_cost_envelope_thinking_blocked', summary }
    }
    if (limits.allow_thinking && summary.thinkingBudgetTokens !== undefined && summary.thinkingBudgetTokens > limits.max_thinking_budget_tokens) {
      return { ok: false, status: 403, code: 'canary_cost_envelope_thinking_budget_exceeded', summary }
    }
  }
  if (summary.outputConfigPresent && !limits.allow_output_config) {
    return { ok: false, status: 403, code: 'canary_cost_envelope_output_config_blocked', summary }
  }
  if (summary.outputConfigPresent && !isAllowedOutputConfigShape(parsed.output_config)) {
    return { ok: false, status: 403, code: 'canary_cost_envelope_output_config_shape_blocked', summary }
  }
  if (summary.contextManagementPresent && !limits.allow_context_management) {
    return { ok: false, status: 403, code: 'canary_cost_envelope_context_management_blocked', summary }
  }
  return { ok: true, summary }
}

function isCandidateModelAllowed(sharedPool: any, model: string): boolean {
  const allowlist = Array.isArray(sharedPool?.candidate_model_allowlist) ? sharedPool.candidate_model_allowlist : []
  const proofs = sharedPool?.candidate_model_replay_proofs || {}
  const killSwitches = sharedPool?.candidate_model_kill_switches || {}
  const auditBudgets = sharedPool?.candidate_model_audit_budgets || {}
  return allowlist.includes(model)
    && typeof proofs[model] === 'string'
    && proofs[model]
    && killSwitches[model] === false
    && typeof auditBudgets[model] === 'number'
    && Number.isFinite(auditBudgets[model])
    && auditBudgets[model] > 0
}

function isAllowedOutputConfigShape(outputConfig: unknown): boolean {
  if (outputConfig === undefined) return true
  if (!outputConfig || typeof outputConfig !== 'object' || Array.isArray(outputConfig)) return false
  const keys = Object.keys(outputConfig)
  const allowedTopLevel = new Set(['effort', 'format'])
  if (keys.some((key) => !allowedTopLevel.has(key))) return false
  if (!keys.includes('effort')) return false
  if (typeof (outputConfig as { effort?: unknown }).effort !== 'string'
    || (outputConfig as { effort: string }).effort.length === 0) {
    return false
  }
  if (!keys.includes('format')) return keys.length === 1
  return isAllowedOutputConfigFormat((outputConfig as { format?: unknown }).format)
}

function isAllowedOutputConfigFormat(format: unknown): boolean {
  if (!format || typeof format !== 'object' || Array.isArray(format)) return false
  const keys = Object.keys(format)
  if (keys.length !== 2 || !keys.includes('type') || !keys.includes('schema')) return false
  const typed = format as { type?: unknown; schema?: unknown }
  if (typeof typed.type !== 'string' || typed.type.length === 0) return false
  return !!typed.schema && typeof typed.schema === 'object' && !Array.isArray(typed.schema)
}

function normalizeLimits(raw: CanaryCostEnvelopeLimits): Required<CanaryCostEnvelopeLimits> {
  return {
    max_tokens: positiveNumber(raw.max_tokens, DEFAULT_LIMITS.max_tokens),
    max_body_bytes: positiveNumber(raw.max_body_bytes, DEFAULT_LIMITS.max_body_bytes),
    max_tools_count: nonNegativeNumber(raw.max_tools_count, DEFAULT_LIMITS.max_tools_count),
    allow_thinking: typeof raw.allow_thinking === 'boolean' ? raw.allow_thinking : DEFAULT_LIMITS.allow_thinking,
    max_thinking_budget_tokens: nonNegativeNumber(raw.max_thinking_budget_tokens, DEFAULT_LIMITS.max_thinking_budget_tokens),
    allow_output_config: typeof raw.allow_output_config === 'boolean' ? raw.allow_output_config : DEFAULT_LIMITS.allow_output_config,
    allow_context_management: typeof raw.allow_context_management === 'boolean' ? raw.allow_context_management : DEFAULT_LIMITS.allow_context_management,
    allowed_models: Array.isArray(raw.allowed_models) && raw.allowed_models.every((item) => typeof item === 'string') && raw.allowed_models.length > 0
      ? raw.allowed_models
      : DEFAULT_LIMITS.allowed_models,
  }
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}
