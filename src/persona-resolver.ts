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
const DEFAULT_PERSONA_PROFILE_ID = 'claude_code_2_1_175_subscription_1m'
const LEGACY_CCH_COMPATIBLE_VERSIONS = new Set(['2.1.150', '2.1.153', '2.1.169', '2.1.170'])
const FINAL_2175_STALE_METADATA_VERSIONS = new Set(['2.1.150', '2.1.170'])

export function resolvePersonaDecision(input: ResolvePersonaDecisionInput): PersonaDecision {
  const shared = ((input.config.shared_pool || {}) as SharedPoolCandidateConfig)
  const configuredProfileId = resolvePersonaProfileId(shared.message_beta_profile)
    || resolvePersonaProfileId(inferLegacyPersonaVariant(String(input.config.env.version || '2.1.175')))
  const profileId = configuredProfileId || resolvePersonaProfileId(input.identity.persona_variant)
  if (!profileId) {
    return rejectDecision('reject_unknown_persona', fallbackProfile(), input.requestedPolicyVersion, input.trustedClient, input.route)
  }
  const profile = getPersonaProfile(profileId)
  const resolvedBetaHeader = betaHeaderForConfiguredProfile(shared, profile)
  const versionDecision = resolveVersionStatus(profile.version, input.requestedPolicyVersion, input.trustedClient)
  const selfPromotionVersion = untrustedFinalPersonaSelfPromotionVersion(profile, input)
  if (selfPromotionVersion) {
    return {
      status: 'quarantine_unknown_major',
      profile,
      effectiveVersion: selfPromotionVersion,
      capabilities: { ...profile.capabilities },
      betaHeader: resolvedBetaHeader,
      auditTags: ['unknown_major', `route:${input.route}`],
      route: input.route,
      trustedClient: input.trustedClient,
    }
  }
  if (versionDecision.status === 'quarantine_unknown_major') {
    return {
      status: 'quarantine_unknown_major',
      profile,
      effectiveVersion: versionDecision.effectiveVersion,
      capabilities: { ...profile.capabilities },
      betaHeader: resolvedBetaHeader,
      auditTags: ['unknown_major', `route:${input.route}`],
      route: input.route,
      trustedClient: input.trustedClient,
    }
  }

  const betaProfile = String(shared.message_beta_profile || profile.messageBetaProfile)
  const betaDecision = resolveBetaDecision(betaProfile, shared, input.trustedClient, profile, input.route, versionDecision.effectiveVersion)
  if (betaDecision) return betaDecision

  const modelDecision = resolveModelDecision(input.requestedModel, shared, input.trustedClient, profile, input.route, versionDecision.effectiveVersion)
  if (modelDecision) return modelDecision

  return {
    status: versionDecision.status,
    profile,
    effectiveVersion: versionDecision.effectiveVersion,
    capabilities: { ...profile.capabilities },
    betaHeader: resolvedBetaHeader,
    auditTags: versionDecision.status === 'observed_minor_drift' ? ['minor_drift', `route:${input.route}`] : [`route:${input.route}`],
    route: input.route,
    trustedClient: input.trustedClient,
  }
}


function untrustedFinalPersonaSelfPromotionVersion(profile: PersonaProfile, input: ResolvePersonaDecisionInput): string | null {
  if (profile.id !== DEFAULT_PERSONA_PROFILE_ID || input.trustedClient) return null
  const requestedVersion = normalizeVersion(input.requestedPolicyVersion).raw
  if (requestedVersion !== profile.version) return null
  const identityProfileId = resolvePersonaProfileId(input.identity.persona_variant)
  const identityPolicyVersion = normalizeVersion(String(input.identity.policy_version || '')).raw
  return identityProfileId !== profile.id || identityPolicyVersion !== profile.version ? requestedVersion : null
}

function resolveVersionStatus(profileVersion: string, requestedVersion: string, trustedClient: boolean): { status: 'exact_known' | 'observed_minor_drift' | 'quarantine_unknown_major'; effectiveVersion: string } {
  const requested = normalizeVersion(requestedVersion)
  const profile = normalizeVersion(profileVersion)
  if (requested.raw === profile.raw) return { status: 'exact_known', effectiveVersion: profile.raw }
  if (!trustedClient || requested.major !== profile.major || requested.minor !== profile.minor) {
    return { status: 'quarantine_unknown_major', effectiveVersion: requested.raw }
  }
  const compatible = rolloutCompatibleVersion(profile, requested)
  if (!compatible) {
    return { status: 'quarantine_unknown_major', effectiveVersion: requested.raw }
  }
  return { status: 'observed_minor_drift', effectiveVersion: compatible.effectiveVersion }
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

function rolloutCompatibleVersion(
  profile: ReturnType<typeof normalizeVersion>,
  requested: ReturnType<typeof normalizeVersion>,
): { effectiveVersion: string } | null {
  if (profile.raw === '2.1.175') {
    // 2.1.175 is the active final persona. Only explicitly approved stale
    // Sub2API metadata canonicalizes upward; 2.1.171 was not published and
    // other 2.1.172+ versions need their own persona rollout approval.
    return FINAL_2175_STALE_METADATA_VERSIONS.has(requested.raw)
      ? { effectiveVersion: profile.raw }
      : null
  }
  if (profile.raw === '2.1.170') {
    if (!LEGACY_CCH_COMPATIBLE_VERSIONS.has(requested.raw)) return null
    return { effectiveVersion: requested.patch < profile.patch ? profile.raw : requested.raw }
  }
  if (profile.raw === '2.1.150') {
    if (!LEGACY_CCH_COMPATIBLE_VERSIONS.has(requested.raw)) return null
    return { effectiveVersion: requested.raw }
  }
  return null
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
  return getPersonaProfile(DEFAULT_PERSONA_PROFILE_ID)
}
