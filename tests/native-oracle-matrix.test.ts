import { strict as assert } from 'assert'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { finish, test } from './helpers.js'
import { buildClaudePrintArgs, resolvePinnedClaudeExecutable, runNativeOracleMatrix } from '../tools/claude-native-oracle-matrix.js'

console.log('\ntests/native-oracle-matrix.test.ts')


test('resolver reuses an existing isolated 2.1.179 runtime root without reinstalling', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-native-oracle-existing-runtime-test-'))
  mkdirSync(join(root, 'node_modules', '@anthropic-ai', 'claude-code'), { recursive: true })
  mkdirSync(join(root, 'node_modules', '@anthropic-ai', 'claude-code-darwin-arm64'), { recursive: true })
  writeFileSync(join(root, 'node_modules', '@anthropic-ai', 'claude-code', 'package.json'), JSON.stringify({ version: '2.1.179' }))
  const binary = join(root, 'node_modules', '@anthropic-ai', 'claude-code-darwin-arm64', 'claude')
  writeFileSync(binary, '#!/bin/sh\necho "2.1.179 (Claude Code)"\n')
  chmodSync(binary, 0o755)

  const resolved = await resolvePinnedClaudeExecutable('2.1.179', root)

  assert.equal(resolved, binary)
})

test('resolver accepts a direct verified 2.1.179 executable path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-native-oracle-direct-binary-test-'))
  const binary = join(root, 'claude')
  writeFileSync(binary, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.179 (Claude Code)"; exit 0; fi\necho "ok"\n')
  chmodSync(binary, 0o755)

  const resolved = await resolvePinnedClaudeExecutable('2.1.179', binary)

  assert.equal(resolved, binary)
})

test('stream-json print invocations include verbose for 2.1.179 compatibility', () => {
  const args = buildClaudePrintArgs('stream-json')

  assert.equal(args.includes('--output-format'), true)
  assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json')
  assert.equal(args.includes('--verbose'), true)
})

test('2.1.179 native oracle mock matrix exposes only safe profile summaries', async () => {
  const matrix = await runNativeOracleMatrix({ mode: 'mock', version: '2.1.179' })

  assert.equal(matrix.schema_version, 'claude_native_oracle_matrix.v1')
  assert.equal(matrix.target_cli_version, '2.1.179')
  assert.equal(matrix.raw_body_persisted, false)
  assert.equal(matrix.raw_prompt_persisted, false)
  assert.equal(matrix.raw_cch_persisted, false)
  assert.equal(matrix.real_anthropic_upstream, false)
  assert.deepEqual(matrix.profiles.map((profile) => profile.profile_ref).sort(), [
    'claude_code_2_1_179_custom_base',
    'claude_code_2_1_179_first_party_assumed',
  ])

  for (const profile of matrix.profiles) {
    assert.equal(profile.cli_version_bucket, '2.1.179')
    assert.match(profile.invocation_mode, /^(custom-base|first-party-assumed)$/)
    assert.equal(profile.samples.length >= 3, true)
    const variants = new Set(profile.samples.map((sample) => sample.variant))
    assert.equal(variants.has('messages_non_streaming'), true)
    assert.equal(variants.has('messages_streaming'), true)
    assert.equal(variants.has('messages_with_tools'), true)
    for (const sample of profile.samples) {
      assert.match(sample.route, /^\/v1\/messages/)
      assert.equal(sample.method, 'POST')
      assert.equal(sample.route_class, 'messages')
      assert.equal(Array.isArray(sample.top_level_body_keys), true)
      assert.equal(typeof sample.system_summary.block_count, 'number')
      assert.equal(typeof sample.messages_summary.message_count, 'number')
      assert.equal(typeof sample.tool_summary.tool_count, 'number')
      assert.match(sample.billing_shape, /^(absent|no_cch|cch_present)$/)
      assert.match(sample.cc_entrypoint_bucket, /^(cli|sdk-cli|other|absent)$/)
      if (sample.billing_shape === 'cch_present') {
        assert.equal(typeof sample.cch_verifier_ok, 'boolean')
      } else {
        assert.equal(sample.cch_verifier_ok, null)
      }
    }
  }

  const serialized = JSON.stringify(matrix)
  assert.equal(/cch=[a-f0-9]{5}/i.test(serialized), false)
  assert.equal(/x-anthropic-billing-header: [^"}]+cch=/i.test(serialized), false)
  assert.equal(/(authorization\s*[:=])|(cookie\s*[:=])|(x-api-key\s*[:=])|(api[_-]?key\s*[:=])|(bearer\s+[a-z0-9._-]+)/i.test(serialized), false)
  assert.equal(/Synthetic prompt|ABCDEFGHIJKLMNOPQRSTUVWXYZ|BDFHJLNPRTVXZ/i.test(serialized), false)
})

await finish()
