export type ClaudeCodeEnvResidueBucket =
  | 'official_anthropic'
  | 'neutral_gateway'
  | 'cn_tld'
  | 'exact_domain_list'
  | 'keyword'
  | 'exact_domain_and_keyword'
  | 'china_tld'
  | 'china_org_domain'
  | 'china_cloud_domain'
  | 'ai_lab_keyword'
  | 'claude_proxy_resale_like'
  | 'unknown'

export type ClaudeCodeEnvResidueClassification = {
  bucket: ClaudeCodeEnvResidueBucket
  taxonomyVersion: string
  taxonomyCounts: { totalDomainOrTldCount: number; specificDomainCount: number; keywordCount: number }
}

export const CLAUDE_CODE_ENV_RESIDUE_TAXONOMY = {
  version: 'claude-code-2.1.197',
  extraction: 'npm:2.1.91-js-and-2.1.197-native-xor91',
  domainOrTldList: [
  "cn",
  "sankuai.com",
  "netease.com",
  "163.com",
  "baidu-int.com",
  "baidu.com",
  "alibaba-inc.com",
  "alipay.com",
  "antgroup-inc.cn",
  "kuaishou.com",
  "bytedance.net",
  "xiaohongshu.com",
  "ctripcorp.com",
  "jd.com",
  "jdcloud.com",
  "bilibili.co",
  "iflytek.com",
  "stepfun-inc.com",
  "aliyuncs.com",
  "cn-shanghai.fcapp.run",
  "cn-beijing.fcapp.run",
  "xaminim.com",
  "moonshot.ai",
  "anyrouter.top",
  "packyapi.com",
  "aicodemirror.com",
  "aigocode.com",
  "hongshan.com",
  "iwhalecloud.com",
  "dhcoder.net",
  "lemongpt.top",
  "zhihuiapi.top",
  "intsig.net",
  "high-five-ai.xyz",
  "cloudsway.net",
  "4sapi.com",
  "529961.com",
  "88996.cloud",
  "88code.ai",
  "88code.org",
  "91code.pro",
  "992236.xyz",
  "ai.codeqaq.com",
  "ai.hybgzs.com",
  "ai.kjvhh.com",
  "aicanapi.com",
  "aicoding.sh",
  "aifast.site",
  "aihubmix.com",
  "anmory.com",
  "api.5202030.xyz",
  "api.ablai.top",
  "api.bianxie.ai",
  "api.bltcy.ai",
  "api.cpass.cc",
  "api.dev88.tech",
  "api.dreamger.com",
  "api.expansion.chat",
  "api.gueai.com",
  "api.holdai.top",
  "api.ikuncode.cc",
  "api.lconai.com",
  "api.linkapi.org",
  "api.mkeai.com",
  "api.nekoapi.com",
  "api.oaipro.com",
  "api.ruyun.fun",
  "api.ssopen.top",
  "api.tu-zi.com",
  "api.uglycat.cc",
  "api.v3.cm",
  "api.whatai.cc",
  "api.wpgzs.top",
  "api.xty.app",
  "api.yuegle.com",
  "api.zzyu.me",
  "apimart.ai",
  "apipro.maynor1024.live",
  "apiyi.com",
  "applyj.hiapi.top",
  "augmunt.com",
  "b4u.qzz.io",
  "clauddy.com",
  "claude-code-hub.app",
  "claude-opus.top",
  "claudeide.net",
  "co.yes.vg",
  "code.wenwen-ai.com",
  "code.x-aio.com",
  "codeilab.com",
  "cubence.com",
  "deeprouter.top",
  "dimaray.com",
  "dmxapi.com",
  "docs.aigc2d.com",
  "duckcoding.com",
  "fk.hshwk.org",
  "flapcode.com",
  "foxcode.hshwk.org",
  "foxcode.rjj.cc",
  "fuli.hxi.me",
  "getgoapi.com",
  "gpt.zhizengzeng.com",
  "gptgod.cloud",
  "gptkey.eu.org",
  "gptpay.store",
  "hdgsb.com",
  "henapi.top",
  "instcopilot-api.com",
  "jeniya.top",
  "jiekou.ai",
  "kg-api.cloud",
  "n1n.ai",
  "new-api.u4vr.com",
  "new.xychatai.com",
  "one-api.bltcy.top",
  "one.ocoolai.com",
  "oneapi.paintbot.top",
  "open.xiaojingai.com",
  "openclaude.me",
  "opus.gptuu.com",
  "poloai.top",
  "poloapi.top",
  "privnode.com",
  "proxyai.com",
  "qinzhiai.com",
  "right.codes",
  "runanytime.hxi.me",
  "sssaicode.com",
  "store.zzyus.top",
  "tiantianai.pro",
  "uiuiapi.com",
  "uniapi.ai",
  "vip.undyingapi.com",
  "wolfai.top",
  "wzw.de5.net",
  "wzw.pp.ua",
  "xairouter.com",
  "xaixapi.com",
  "xiaohuapi.site",
  "xiaohumini.site",
  "xy.poloapi.com",
  "yansd666.com",
  "yansd666.top",
  "yunwu.ai",
  "yunwu.zeabur.app",
  "zenmux.ai"
],
  keywordList: [
  "deepseek",
  "moonshot",
  "minimax",
  "xaminim",
  "zhipu",
  "bigmodel",
  "baichuan",
  "stepfun",
  "01ai",
  "dashscope",
  "volces"
],
  totalDomainOrTldCount: 147,
  specificDomainCount: 146,
  keywordCount: 11,
} as const

const DOMAIN_OR_TLD_SET = new Set<string>(CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.domainOrTldList)
const SPECIFIC_DOMAIN_SET = new Set<string>(CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.domainOrTldList.filter((entry) => entry !== 'cn'))
const KEYWORD_LIST = CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.keywordList

export function claudeCodeEnvResidueTaxonomySummary() {
  return {
    version: CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.version,
    extraction: CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.extraction,
    total_domain_or_tld_count: CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.totalDomainOrTldCount,
    specific_domain_count: CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.specificDomainCount,
    keyword_count: CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.keywordCount,
  }
}

export function classifyClaudeCodeEnvResidue(value: unknown): ClaudeCodeEnvResidueClassification {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const host = hostnameFromResidueValue(raw)
  const haystack = host || raw
  const exactDomain = !!host && Array.from(SPECIFIC_DOMAIN_SET).some((domain) => host === domain || host.endsWith(`.${domain}`))
  const keyword = KEYWORD_LIST.some((item) => haystack.includes(item))
  const bucket = classifyBucket(raw, host, exactDomain, keyword)
  return {
    bucket,
    taxonomyVersion: CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.version,
    taxonomyCounts: {
      totalDomainOrTldCount: CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.totalDomainOrTldCount,
      specificDomainCount: CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.specificDomainCount,
      keywordCount: CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.keywordCount,
    },
  }
}

function classifyBucket(raw: string, host: string | null, exactDomain: boolean, keyword: boolean): ClaudeCodeEnvResidueBucket {
  const target = host || raw
  if (!target) return 'unknown'
  if (isOfficialAnthropicHost(host) || raw.includes('api.anthropic.com') || raw.includes('anthropic.com')) return 'official_anthropic'
  if (isNeutralGatewayHost(host) || raw.includes('localhost') || raw.includes('127.0.0.1') || raw.includes('test.invalid') || raw.includes('gateway')) return 'neutral_gateway'
  if (exactDomain && keyword) return 'exact_domain_and_keyword'
  if (exactDomain) return 'exact_domain_list'
  if (keyword) return 'keyword'
  if (host && (host === 'cn' || host.endsWith('.cn') || DOMAIN_OR_TLD_SET.has('cn') && host.split('.').at(-1) === 'cn')) return 'cn_tld'
  if (raw.includes('.cn')) return 'china_tld'
  if (target.endsWith('.org') || raw.includes('.org')) return 'china_org_domain'
  if (target.includes('cloud')) return 'china_cloud_domain'
  if (/(^|[.:-])(ai|lab)([.:-]|$)/.test(target) || target.endsWith('.ai')) return 'ai_lab_keyword'
  if (target.includes('proxy') || target.includes('resale')) return 'claude_proxy_resale_like'
  return 'unknown'
}

function hostnameFromResidueValue(raw: string): string | null {
  if (!raw) return null
  try {
    return new URL(raw).hostname.toLowerCase().replace(/\.$/, '') || null
  } catch {
    // Fall through to a conservative host-shaped extraction below.
  }
  const withoutScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  const candidate = withoutScheme.split(/[/?#\s]/, 1)[0]?.replace(/^\[/, '').replace(/\]$/, '').replace(/:\d+$/, '') || ''
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(candidate)) return candidate.toLowerCase().replace(/\.$/, '')
  return null
}

function isOfficialAnthropicHost(host: string | null): boolean {
  return !!host && (host === 'anthropic.com' || host.endsWith('.anthropic.com'))
}

function isNeutralGatewayHost(host: string | null): boolean {
  return !!host && (host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host === 'test.invalid')
}
