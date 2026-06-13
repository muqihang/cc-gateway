export type PersonaCapabilities = {
  context_1m: boolean
  tools: boolean
  thinking: boolean
  context_management: boolean
  stream: boolean
  max_tokens: number
}

export type PersonaProfile = {
  id: string
  version: string
  messageBetaProfile: string
  betaHeader: string
  stainlessPackageVersion: string
  aliases: string[]
  knownModels: string[]
  capabilities: PersonaCapabilities
}

const KNOWN_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-7',
  'claude-opus-4-7-thinking',
  'claude-opus-4-6',
  'claude-opus-4-6-thinking',
  'claude-opus-4-8',
  'claude-fable-5',
  // Observed from Claude Code CLI for lightweight explore/subagent requests.
  'claude-haiku-4-5-20251001',
] as const

const MESSAGE_BETA = 'claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,effort-2025-11-24'
const CLAUDE_CODE_2_1_150_SUBSCRIPTION_BETA = 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advisor-tool-2026-03-01,effort-2025-11-24,extended-cache-ttl-2025-04-11'
const CLAUDE_CODE_2_1_150_SUBSCRIPTION_1M_BETA = 'claude-code-20250219,oauth-2025-04-20,context-1m-2025-08-07,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advisor-tool-2026-03-01,effort-2025-11-24,extended-cache-ttl-2025-04-11'
const CLAUDE_CODE_2_1_170_SUBSCRIPTION_1M_BETA = 'claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,effort-2025-11-24'
// Verified 2.1.175 capture kept the same messages beta set as 2.1.170.
const CLAUDE_CODE_2_1_175_SUBSCRIPTION_1M_BETA = CLAUDE_CODE_2_1_170_SUBSCRIPTION_1M_BETA
const FIRST_200_OAUTH_COMPAT_BETA = CLAUDE_CODE_2_1_150_SUBSCRIPTION_BETA

const FULL_CAPABILITIES: PersonaCapabilities = {
  context_1m: true,
  tools: true,
  thinking: true,
  context_management: true,
  stream: true,
  max_tokens: 32000,
}

const REGISTRY: PersonaProfile[] = [
  {
    id: 'claude_code_2_1_146',
    version: '2.1.146',
    messageBetaProfile: 'claude_code_2_1_146',
    betaHeader: MESSAGE_BETA,
    stainlessPackageVersion: '0.94.0',
    aliases: ['claude-code-2.1.146-macos-local'],
    knownModels: [...KNOWN_MODELS],
    capabilities: { ...FULL_CAPABILITIES },
  },
  {
    id: 'claude_code_2_1_150_subscription',
    version: '2.1.150',
    messageBetaProfile: 'claude_code_2_1_150_subscription',
    betaHeader: CLAUDE_CODE_2_1_150_SUBSCRIPTION_BETA,
    stainlessPackageVersion: '0.94.0',
    aliases: ['claude-code-2.1.150-subscription-local'],
    knownModels: [...KNOWN_MODELS],
    capabilities: { ...FULL_CAPABILITIES },
  },
  {
    id: 'claude_code_2_1_150_subscription_1m',
    version: '2.1.150',
    messageBetaProfile: 'claude_code_2_1_150_subscription_1m',
    betaHeader: CLAUDE_CODE_2_1_150_SUBSCRIPTION_1M_BETA,
    stainlessPackageVersion: '0.94.0',
    aliases: ['claude-code-2.1.150-macos-local'],
    knownModels: [...KNOWN_MODELS],
    capabilities: { ...FULL_CAPABILITIES },
  },

  {
    id: 'claude_code_2_1_170_subscription_1m',
    version: '2.1.170',
    messageBetaProfile: 'claude_code_2_1_170_subscription_1m',
    betaHeader: CLAUDE_CODE_2_1_170_SUBSCRIPTION_1M_BETA,
    stainlessPackageVersion: '0.94.0',
    aliases: ['claude-code-2.1.170-macos-local'],
    knownModels: [...KNOWN_MODELS],
    capabilities: { ...FULL_CAPABILITIES },
  },
  {
    id: 'claude_code_2_1_175_subscription_1m',
    version: '2.1.175',
    messageBetaProfile: 'claude_code_2_1_175_subscription_1m',
    betaHeader: CLAUDE_CODE_2_1_175_SUBSCRIPTION_1M_BETA,
    stainlessPackageVersion: '0.94.0',
    aliases: ['claude-code-2.1.175-macos-local'],
    knownModels: [...KNOWN_MODELS],
    capabilities: { ...FULL_CAPABILITIES },
  },
  {
    id: 'first_200_oauth_compat',
    version: '2.1.150',
    messageBetaProfile: 'first_200_oauth_compat',
    betaHeader: FIRST_200_OAUTH_COMPAT_BETA,
    stainlessPackageVersion: '0.94.0',
    aliases: ['claude-code-first-200-oauth-compat'],
    knownModels: [...KNOWN_MODELS],
    capabilities: { ...FULL_CAPABILITIES },
  },
]

const PROFILE_BY_ID = new Map(REGISTRY.map((profile) => [profile.id, profile]))
const PROFILE_ID_BY_ALIAS = new Map<string, string>()
for (const profile of REGISTRY) {
  PROFILE_ID_BY_ALIAS.set(profile.id, profile.id)
  PROFILE_ID_BY_ALIAS.set(profile.messageBetaProfile, profile.id)
  for (const alias of profile.aliases) PROFILE_ID_BY_ALIAS.set(alias, profile.id)
}

export function getPersonaProfile(id: string): PersonaProfile {
  const profile = PROFILE_BY_ID.get(id)
  if (!profile) {
    throw new Error(`unknown persona profile: ${id}`)
  }
  return profile
}

export function resolvePersonaProfileId(variant: string | undefined | null): string | null {
  if (!variant) return null
  return PROFILE_ID_BY_ALIAS.get(String(variant)) || null
}

export function knownPersonaProfiles(): PersonaProfile[] {
  return REGISTRY.map((profile) => ({ ...profile, aliases: [...profile.aliases], knownModels: [...profile.knownModels], capabilities: { ...profile.capabilities } }))
}

export function betaHeaderForProfile(profileId: string): string {
  return getPersonaProfile(profileId).betaHeader
}

export function inferLegacyPersonaVariant(version: string): string {
  if (version.startsWith('2.1.175')) return 'claude-code-2.1.175-macos-local'
  if (version.startsWith('2.1.170')) return 'claude-code-2.1.170-macos-local'
  if (version.startsWith('2.1.150')) return 'claude-code-2.1.150-macos-local'
  return 'claude-code-2.1.146-macos-local'
}
