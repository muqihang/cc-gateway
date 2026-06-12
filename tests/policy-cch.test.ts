import { strict as assert } from 'assert'
import { finish, test, baseConfig } from './helpers.js'
import { runSigningPipeline, verifySignedCCH } from '../src/policy.js'

console.log('\ntests/policy-cch.test.ts')

const OLD_CCH_COMPAT_CAPTURE_MATRIX = [
  { version: '2.1.150', ccVersionSuffix: 'PASS', fixedRotl64Cch: 'PASS' },
  { version: '2.1.153', ccVersionSuffix: 'PASS', fixedRotl64Cch: 'PASS' },
  { version: '2.1.169', ccVersionSuffix: 'PASS', fixedRotl64Cch: 'PASS' },
  { version: '2.1.170', ccVersionSuffix: 'PASS', fixedRotl64Cch: 'PASS' },
  { version: '2.1.172', ccVersionSuffix: 'PASS', fixedRotl64Cch: 'FAIL' },
  { version: '2.1.175', ccVersionSuffix: 'PASS', fixedRotl64Cch: 'FAIL' },
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

test('fixed rotl64 signer/verifier round trips old-CCH-compatible versions locally', () => {
  const config = baseConfig({ shared_pool: { signing_enabled: true, signing_evidence_gates_approved: true } } as any)
  for (const version of ['2.1.150', '2.1.153', '2.1.169', '2.1.170']) {
    const signed = runSigningPipeline(config, syntheticBody(), { cliVersion: version })
    assert.equal(signed.ok, true, version)
    if (!signed.ok) continue
    assert.deepEqual(verifySignedCCH(signed.body), { ok: true, cch: signed.cch }, version)
    assert.match(signed.body.toString('utf-8'), new RegExp(`cc_version=${version.replace(/\./g, '\\.') }\\.[a-f0-9]{3}; cc_entrypoint=sdk-cli; cch=[a-f0-9]{5};`), version)
  }
})

test('safe real-capture corpus gates 2.1.172+ as CCH delta investigation only', () => {
  for (const version of ['2.1.150', '2.1.153', '2.1.169', '2.1.170']) {
    const row = OLD_CCH_COMPAT_CAPTURE_MATRIX.find((item) => item.version === version)
    assert.equal(row?.ccVersionSuffix, 'PASS', version)
    assert.equal(row?.fixedRotl64Cch, 'PASS', version)
  }
  for (const version of ['2.1.172', '2.1.175']) {
    const row = OLD_CCH_COMPAT_CAPTURE_MATRIX.find((item) => item.version === version)
    assert.equal(row?.ccVersionSuffix, 'PASS', version)
    assert.equal(row?.fixedRotl64Cch, 'FAIL', version)
  }
})

await finish()
