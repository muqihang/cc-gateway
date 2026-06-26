import { strict as assert } from 'assert'
import { finish, test, baseConfig } from './helpers.js'
import { runSigningPipeline, verifySignedCCH } from '../src/policy.js'

console.log('\ntests/policy-cch.test.ts')

const CCH_COMPAT_CAPTURE_MATRIX = [
  { version: '2.1.150', ccVersionSuffix: 'PASS', cch: 'PASS', preimage: 'legacy-raw' },
  { version: '2.1.153', ccVersionSuffix: 'PASS', cch: 'PASS', preimage: 'legacy-raw' },
  { version: '2.1.169', ccVersionSuffix: 'PASS', cch: 'PASS', preimage: 'legacy-raw' },
  { version: '2.1.170', ccVersionSuffix: 'PASS', cch: 'PASS', preimage: 'legacy-raw' },
  { version: '2.1.172', ccVersionSuffix: 'PASS', cch: 'PASS', preimage: 'normalized-model-max-tokens' },
  { version: '2.1.175', ccVersionSuffix: 'PASS', cch: 'PASS', preimage: 'normalized-model-max-tokens' },
] as const

function syntheticBody() {
  const generatedText = Array.from({ length: 32 }, (_, index) => String.fromCharCode(65 + ((index * 7) % 26))).join('')
  assert.notEqual(generatedText[4], generatedText[7])
  assert.notEqual(generatedText[7], generatedText[20])
  assert.notEqual(generatedText[4], generatedText[20])
  return Buffer.from(JSON.stringify({
    metadata: { user_id: JSON.stringify({ session_id: '123e4567-e89b-42d3-a456-426614174000' }) },
    model: 'claude-opus-4-8',
    messages: [{ role: 'user', content: [{ type: 'text', text: generatedText }] }],
  }), 'utf-8')
}

function approved2179SigningConfig() {
  return baseConfig({
    shared_pool: {
      signing_enabled: true,
      signing_evidence_gates_approved: true,
      signed_cch_2179_oracle_profile_approved: true,
      signed_cch_2179_oracle_profile_ref: 'claude_code_2_1_179_first_party_signed_cch_oracle_cp1_degraded_v1',
    },
  } as any)
}

test('fixed rotl64 signer/verifier round trips explicit 2.1.179 oracle-approved profile locally', () => {
  const signed = runSigningPipeline(approved2179SigningConfig(), syntheticBody(), { cliVersion: '2.1.179' })
  assert.equal(signed.ok, true)
  if (!signed.ok) return
  assert.deepEqual(verifySignedCCH(signed.body), { ok: true, cch: signed.cch })
  assert.match(signed.body.toString('utf-8'), /cc_version=2\.1\.179\.[a-f0-9]{3}; cc_entrypoint=sdk-cli; cch=[a-f0-9]{5};/)
})

test('safe real-capture corpus records version-aware CCH preimage compatibility', () => {
  for (const version of ['2.1.150', '2.1.153', '2.1.169', '2.1.170']) {
    const row = CCH_COMPAT_CAPTURE_MATRIX.find((item) => item.version === version)
    assert.equal(row?.ccVersionSuffix, 'PASS', version)
    assert.equal(row?.cch, 'PASS', version)
    assert.equal(row?.preimage, 'legacy-raw', version)
  }
  for (const version of ['2.1.172', '2.1.175']) {
    const row = CCH_COMPAT_CAPTURE_MATRIX.find((item) => item.version === version)
    assert.equal(row?.ccVersionSuffix, 'PASS', version)
    assert.equal(row?.cch, 'PASS', version)
    assert.equal(row?.preimage, 'normalized-model-max-tokens', version)
  }
})

test('safe corpus evidence alone does not auto-enable unapproved legacy signer versions', () => {
  const config = baseConfig({ shared_pool: { signing_enabled: true, signing_evidence_gates_approved: true } } as any)
  const signed169 = runSigningPipeline(config, syntheticBody(), { cliVersion: '2.1.169' })
  assert.deepEqual(signed169, { ok: false, code: 'sign_primary_2177_oracle_missing' })
})

test('version boundary does not auto-sign unapproved legacy gaps and switches 2.1.172 to normalized preimage', () => {
  const config = baseConfig({ shared_pool: { signing_enabled: true, signing_evidence_gates_approved: true } } as any)
  const signed171 = runSigningPipeline(config, Buffer.from(JSON.stringify({
    model: 'claude-opus-4-8',
    max_tokens: 64000,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'alpha' }] }],
  }), 'utf-8'), { cliVersion: '2.1.171' })
  assert.deepEqual(signed171, { ok: false, code: 'sign_primary_2177_oracle_missing' })

  const legacyBodyWithNormalizedCCH = '{"model":"claude-opus-4-8","max_tokens":64000,"system":[{"type":"text","text":"x-anthropic-billing-header: cc_version=2.1.171.abc; cc_entrypoint=sdk-cli; cch=7952b;"}],"messages":[{"role":"user","content":[{"type":"text","text":"alpha"}]}]}'
  const normalizedBody = legacyBodyWithNormalizedCCH.replace('2.1.171.abc', '2.1.172.abc').replace('cch=7952b;', 'cch=89ed0;')

  assert.deepEqual(verifySignedCCH(Buffer.from(legacyBodyWithNormalizedCCH, 'utf-8')), { ok: false, code: 'signing_verifier_failed' })
  assert.deepEqual(verifySignedCCH(Buffer.from(normalizedBody, 'utf-8')), { ok: true, cch: '89ed0' })
})

test('2.1.172+ verifier matches real CLI oracle vectors that normalize model and max_tokens', () => {
  const cases = [
    {
      body: '{"model":"claude-opus-4-8","max_tokens":64000,"system":[{"type":"text","text":"x-anthropic-billing-header: cc_version=2.1.175.abc; cc_entrypoint=sdk-cli; cch=7952b;"}],"messages":[{"role":"user","content":[{"type":"text","text":"alpha"}]}]}',
      cch: '7952b',
      note: 'top-level string model is ignored and numeric max_tokens is omitted',
    },
    {
      body: '{"model":"claude-fable-5","max_tokens":1,"system":[{"type":"text","text":"x-anthropic-billing-header: cc_version=2.1.175.abc; cc_entrypoint=sdk-cli; cch=7952b;"}],"messages":[{"role":"user","content":[{"type":"text","text":"alpha"}]}]}',
      cch: '7952b',
      note: 'different string model and numeric max_tokens produce same CCH',
    },
    {
      body: '{"model":"claude-sonnet-4-6","max_tokens":32000,"temperature":1,"system":[{"type":"text","text":"x-anthropic-billing-header: cc_version=2.1.175.abc; cc_entrypoint=sdk-cli; cch=d5d9d;"}],"messages":[{"role":"user","content":[{"type":"text","text":"beta gamma"}]}],"metadata":{"user_id":"u","nested":{"model":"x","max_tokens":7}}}',
      cch: 'd5d9d',
      note: 'normalization is recursive',
    },
    {
      body: '{"max_tokens":"NOT_A_NUMBER","model":12345,"system":[{"type":"text","text":"x-anthropic-billing-header: cc_version=2.1.175.abc; cc_entrypoint=sdk-cli; cch=580b5;"}],"messages":[{"role":"user","content":[{"type":"text","text":"edge"}]}]}',
      cch: '580b5',
      note: 'normalization is type-sensitive',
    },
  ]

  for (const item of cases) {
    assert.deepEqual(verifySignedCCH(Buffer.from(item.body, 'utf-8')), { ok: true, cch: item.cch }, item.note)
  }
})

test('2.1.179 oracle-approved signing ignores requested string model and numeric max_tokens in CCH preimage only', () => {
  const config = approved2179SigningConfig()
  const first = runSigningPipeline(config, Buffer.from(JSON.stringify({
    model: 'claude-opus-4-8',
    max_tokens: 64000,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'alpha' }] }],
  }), 'utf-8'), { cliVersion: '2.1.179' })
  const second = runSigningPipeline(config, Buffer.from(JSON.stringify({
    model: 'claude-fable-5',
    max_tokens: 1,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'alpha' }] }],
  }), 'utf-8'), { cliVersion: '2.1.179' })

  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  if (!first.ok || !second.ok) return
  assert.equal(first.cch, second.cch)
  assert.match(first.body.toString('utf-8'), /"model":"claude-opus-4-8"/)
  assert.match(second.body.toString('utf-8'), /"model":"claude-fable-5"/)
  assert.deepEqual(verifySignedCCH(first.body), { ok: true, cch: first.cch })
  assert.deepEqual(verifySignedCCH(second.body), { ok: true, cch: second.cch })
})


test('verifier rejects bodies where a user text billing marker appears before the trusted system block', () => {
  const body = Buffer.from(JSON.stringify({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.175.abc; cc_entrypoint=sdk-cli; cch=7952b;' }] }],
    system: [{ type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.175.abc; cc_entrypoint=sdk-cli; cch=7952b;' }],
  }), 'utf-8')

  assert.deepEqual(verifySignedCCH(body), { ok: false, code: 'signing_verifier_failed' })
})

test('verifier rejects non-system CCH markers even when the trusted system block is correctly signed', () => {
  const signedSystemFirst = '{"system":[{"type":"text","text":"x-anthropic-billing-header: cc_version=2.1.175.abc; cc_entrypoint=sdk-cli; cch=7952b;"}],"messages":[{"role":"user","content":[{"type":"text","text":"alpha"}]}]}'
  const polluted = signedSystemFirst.replace('\"alpha\"', '\"x-anthropic-billing-header: cc_version=2.1.175.abc; cc_entrypoint=sdk-cli; cch=7952b; alpha\"')

  assert.deepEqual(verifySignedCCH(Buffer.from(polluted, 'utf-8')), { ok: false, code: 'signing_verifier_failed' })
})

test('verifier rejects duplicate system billing blocks', () => {
  const body = Buffer.from(JSON.stringify({
    system: [
      { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.175.abc; cc_entrypoint=sdk-cli; cch=7952b;' },
      { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.175.abc; cc_entrypoint=sdk-cli; cch=7952b;' },
    ],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'alpha' }] }],
  }), 'utf-8')

  assert.deepEqual(verifySignedCCH(body), { ok: false, code: 'signing_verifier_failed' })
})


test('verifier rejects malformed duplicate system billing headers', () => {
  const body = Buffer.from(JSON.stringify({
    system: [
      { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.175.abc; cc_entrypoint=sdk-cli; cch=7952b;' },
      { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.175.abc; cc_entrypoint=sdk-cli;' },
    ],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'alpha' }] }],
  }), 'utf-8')

  assert.deepEqual(verifySignedCCH(body), { ok: false, code: 'signing_verifier_failed' })
})

test('verifier only trusts text-type system billing objects', () => {
  const body = Buffer.from(JSON.stringify({
    system: [{ type: 'tool_result', text: 'x-anthropic-billing-header: cc_version=2.1.175.abc; cc_entrypoint=sdk-cli; cch=7952b;' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'alpha' }] }],
  }), 'utf-8')

  assert.deepEqual(verifySignedCCH(body), { ok: false, code: 'signing_placeholder_missing' })
})

test('2.1.172+ normalized preimage preserves __proto__ as a data key', () => {
  const body = '{"system":[{"type":"text","text":"x-anthropic-billing-header: cc_version=2.1.175.af1; cc_entrypoint=sdk-cli; cch=ad778;"}],"payload":{"__proto__":{"safe":true},"model":"ignored","max_tokens":8}}'

  assert.deepEqual(verifySignedCCH(Buffer.from(body, 'utf-8')), { ok: true, cch: 'ad778' })
})

await finish()
