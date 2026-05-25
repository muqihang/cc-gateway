import type { Config, AccountIdentityConfig } from './config.js'
import {
  betaHeaderForProfile,
  getPersonaProfile,
  inferLegacyPersonaVariant,
  resolvePersonaProfileId,
  type PersonaCapabilities,
  type PersonaProfile,
} from './persona-registry.js'

export type PersonaDecisionStatus =
  | 'exact_known'
  | 'observed_minor_drift'
  | 'candidate_model_gray'
  | 'candidate_beta_gray'
  | 'quarantine_unknown_major'
  | 'quarantine_unknown_beta'
  | 'reject_untrusted_model'
  | 'reject_unknown_persona'

export type PersonaDecision = {
  status: PersonaDecisionStatus
  profile: PersonaProfile
  effectiveVersion: string
  capabilities: PersonaCapabilities
  betaHeader: string
  auditTags: string[]
  route: ResolvePersonaDecisionInput['route']
  trustedClient: boolean
}

type ResolvePersonaDecisionInput = {
  config: Config
  identity: AccountIdentityConfig
  route: 'messages' | 'count_tokens' | 'control_plane'
  requestedPolicyVersion: string
  requestedModel: string
  trustedClient: boolean
}

type SharedPoolCandidateConfig = {
  candidate_model_allowlist?: string[]
  candidate_model_replay_proofs?: Record<string, string>
  candidate_model_kill_switches?: Record<string, boolean>
  candidate_model_audit_budgets?: Record<string, number>
  candidate_beta_allowlist?: string[]
  candidate_beta_replay_proofs?: Record<string, string>
  candidate_beta_kill_switches?: Record<string, boolean>
  candidate_beta_audit_budgets?: Record<string, number>
  message_beta_profile?: string
}

const FUTURE_TRUSTED_MODEL_RE = /^claude-(sonnet|opus)-\d+-\d+(?:-thinking)?$/

export function resolvePersonaDecision(input: ResolvePersonaDecisionInput): PersonaDecision {
  const profileId = resolvePersonaProfileId(input.identity.persona_variant)
    || resolvePersonaProfileId((input.config.shared_pool as any)?.message_beta_profile)
    || resolvePersonaProfileId(inferLegacyPersonaVariant(String(input.config.env.version || '2.1.150')))
  if (!profileId) {
    return rejectDecision('reject_unknown_persona', fallbackProfile(), input.requestedPolicyVersion, input.trustedClient, input.route)
  }
  const profile = getPersonaProfile(profileId)
  const shared = ((input.config.shared_pool || {}) as SharedPoolCandidateConfig)
  const resolvedBetaHeader = betaHeaderForConfiguredProfile(shared, profile)
  const versionDecision = resolveVersionStatus(profile.version, input.requestedPolicyVersion, input.trustedClient)
  if (versionDecision.status === 'quarantine_unknown_major') {
    return {
      status: 'quarantine_unknown_major',
      profile,
      effectiveVersion: input.requestedPolicyVersion,
      capabilities: { ...profile.capabilities },
      betaHeader: resolvedBetaHeader,
      auditTags: ['unknown_major', `route:${input.route}`],
      route: input.route,
      trustedClient: input.trustedClient,
    }
  }

  const betaProfile = String(shared.message_beta_profile || profile.messageBetaProfile)
  const betaDecision = resolveBetaDecision(betaProfile, shared, input.trustedClient, profile, input.route, input.requestedPolicyVersion)
  if (betaDecision) return betaDecision

  const modelDecision = resolveModelDecision(input.requestedModel, shared, input.trustedClient, profile, input.route, input.requestedPolicyVersion)
  if (modelDecision) return modelDecision

  return {
    status: versionDecision.status,
    profile,
    effectiveVersion: input.requestedPolicyVersion,
    capabilities: { ...profile.capabilities },
    betaHeader: resolvedBetaHeader,
    auditTags: versionDecision.status === 'observed_minor_drift' ? ['minor_drift', `route:${input.route}`] : [`route:${input.route}`],
    route: input.route,
    trustedClient: input.trustedClient,
  }
}

function resolveVersionStatus(profileVersion: string, requestedVersion: string, trustedClient: boolean): { status: 'exact_known' | 'observed_minor_drift' | 'quarantine_unknown_major' } {
  const requested = normalizeVersion(requestedVersion)
  const profile = normalizeVersion(profileVersion)
  if (requested.raw === profile.raw) return { status: 'exact_known' }
  if (trustedClient && requested.major === profile.major && requested.minor === profile.minor) return { status: 'observed_minor_drift' }
  return { status: 'quarantine_unknown_major' }
}

function resolveBetaDecision(
  betaProfile: string,
  shared: SharedPoolCandidateConfig,
  trustedClient: boolean,
  profile: PersonaProfile,
  route: ResolvePersonaDecisionInput['route'],
  effectiveVersion: string,
): PersonaDecision | null {
  if (resolvePersonaProfileId(betaProfile)) return null
  if (!trustedClient) {
    return rejectDecision('quarantine_unknown_beta', profile, profile.version, trustedClient, route)
  }
  const allowed = new Set(shared.candidate_beta_allowlist || [])
  const proof = shared.candidate_beta_replay_proofs?.[betaProfile]
  const killSwitch = shared.candidate_beta_kill_switches?.[betaProfile]
  const auditBudget = shared.candidate_beta_audit_budgets?.[betaProfile]
  if (!allowed.has(betaProfile) || !proof || killSwitch !== false || !hasPositiveAuditBudget(auditBudget)) {
    return rejectDecision('quarantine_unknown_beta', profile, profile.version, trustedClient, route)
  }
  return {
    status: 'candidate_beta_gray',
    profile,
    effectiveVersion,
    capabilities: { ...profile.capabilities },
    betaHeader: betaHeaderForConfiguredProfile(shared, profile),
    auditTags: ['candidate_beta_gray', `candidate_beta:${betaProfile}`, `route:${route}`],
    route,
    trustedClient,
  }
}

function resolveModelDecision(
  model: string,
  shared: SharedPoolCandidateConfig,
  trustedClient: boolean,
  profile: PersonaProfile,
  route: ResolvePersonaDecisionInput['route'],
  effectiveVersion: string,
): PersonaDecision | null {
  if (!model) return null
  if (profile.knownModels.includes(model)) return null
  if (!trustedClient) {
    return rejectDecision('reject_untrusted_model', profile, profile.version, trustedClient, route)
  }
  const allowed = new Set(shared.candidate_model_allowlist || [])
  const proof = shared.candidate_model_replay_proofs?.[model]
  const killSwitch = shared.candidate_model_kill_switches?.[model]
  const auditBudget = shared.candidate_model_audit_budgets?.[model]
  if (FUTURE_TRUSTED_MODEL_RE.test(model) && allowed.has(model) && proof && killSwitch === false && hasPositiveAuditBudget(auditBudget)) {
    return {
      status: 'candidate_model_gray',
      profile,
      effectiveVersion,
      capabilities: { ...profile.capabilities },
      betaHeader: betaHeaderForConfiguredProfile(shared, profile),
      auditTags: ['candidate_model_gray', `candidate_model:${model}`, `route:${route}`],
      route,
      trustedClient,
    }
  }
  return rejectDecision('reject_untrusted_model', profile, profile.version, trustedClient, route)
}

function rejectDecision(
  status: PersonaDecisionStatus,
  profile: PersonaProfile,
  effectiveVersion: string,
  trustedClient: boolean,
  route: ResolvePersonaDecisionInput['route'],
): PersonaDecision {
  return {
    status,
    profile,
    effectiveVersion,
    capabilities: { ...profile.capabilities },
    betaHeader: betaHeaderForProfile(profile.id),
    auditTags: [status],
    route,
    trustedClient,
  }
}

function normalizeVersion(version: string) {
  const raw = String(version || '').trim() || '0.0.0'
  const [majorRaw = '0', minorRaw = '0', patchRaw = '0'] = raw.split('.')
  return {
    raw,
    major: Number.parseInt(majorRaw, 10) || 0,
    minor: Number.parseInt(minorRaw, 10) || 0,
    patch: Number.parseInt(patchRaw, 10) || 0,
  }
}

function betaHeaderForConfiguredProfile(shared: SharedPoolCandidateConfig, profile: PersonaProfile): string {
  const configured = String(shared.message_beta_profile || profile.messageBetaProfile)
  const configuredProfileId = resolvePersonaProfileId(configured)
  return configuredProfileId ? betaHeaderForProfile(configuredProfileId) : betaHeaderForProfile(profile.id)
}

function hasPositiveAuditBudget(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function fallbackProfile(): PersonaProfile {
  return getPersonaProfile('claude_code_2_1_150_subscription_1m')
}
