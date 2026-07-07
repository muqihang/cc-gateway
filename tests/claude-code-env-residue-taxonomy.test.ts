import { strict as assert } from 'assert'
import { CLAUDE_CODE_ENV_RESIDUE_TAXONOMY, classifyClaudeCodeEnvResidue } from '../src/claude-code-env-residue-taxonomy.js'
import { finish, test } from './helpers.js'

console.log('\ntests/claude-code-env-residue-taxonomy.test.ts')

test('verified Claude Code 2.1.197 env residue taxonomy has expected counts and sentinels', () => {
  assert.equal(CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.version, 'claude-code-2.1.197')
  assert.equal(CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.totalDomainOrTldCount, 147)
  assert.equal(CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.specificDomainCount, 146)
  assert.equal(CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.keywordCount, 11)
  assert.ok(CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.domainOrTldList.includes('cn'))
  assert.ok(CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.domainOrTldList.includes('sankuai.com'))
  assert.ok(CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.domainOrTldList.includes('zenmux.ai'))
  assert.ok(CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.keywordList.includes('deepseek'))
  assert.ok(CLAUDE_CODE_ENV_RESIDUE_TAXONOMY.keywordList.includes('volces'))
})

test('env residue classifier buckets exact domains keywords and neutral hosts without exposing raw values', () => {
  assert.equal(classifyClaudeCodeEnvResidue('https://api.anthropic.com/v1/messages').bucket, 'official_anthropic')
  assert.equal(classifyClaudeCodeEnvResidue('http://127.0.0.1:18080/v1/messages').bucket, 'neutral_gateway')
  assert.equal(classifyClaudeCodeEnvResidue('https://api.sankuai.com/v1').bucket, 'exact_domain_list')
  assert.equal(classifyClaudeCodeEnvResidue('https://example.cn/path').bucket, 'cn_tld')
  assert.equal(classifyClaudeCodeEnvResidue('https://deepseek.example.com/v1').bucket, 'keyword')
  assert.equal(classifyClaudeCodeEnvResidue('https://deepseek.sankuai.com/v1').bucket, 'exact_domain_and_keyword')
  assert.equal(classifyClaudeCodeEnvResidue('https://ordinary.example.com/v1').bucket, 'unknown')
})

await finish()
