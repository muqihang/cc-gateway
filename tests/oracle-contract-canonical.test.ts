import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { canonicalizeJson, formatAuthority, normalizePathQuery, sha256Hex } from '../src/oracle-contract/canonical.js'
import { decodeDeterministicCbor, encodeDeterministicCbor, frameCbor, unframeCbor } from '../src/oracle-contract/cbor-envelope.js'

type JsonCase = { id: string; input_json?: string; input_hex?: string; valid: boolean; expected_code?: string; expected_canonical_hex?: string; expected_sha256?: string }
type CborCase = { id: string; input_hex?: string; value?: unknown; valid: boolean; expected_code?: string; expected_hex?: string }
type NormalizationCase = { id: string; path?: string; query_pairs?: Array<[string, string]>; expected_path_query?: string; host?: string; port?: number; expected_authority?: string }
type Corpus = { json_cases: JsonCase[]; cbor_cases: CborCase[]; normalization_cases: NormalizationCase[] }

const corpus = JSON.parse(readFileSync(path.resolve('contracts/oracle-lab/v1/canonicalization-corpus.json'), 'utf8')) as Corpus

function codeOf(error: unknown): string | undefined {
  return (error as { code?: string }).code
}

for (const fixture of corpus.json_cases) {
  test(`JCS corpus: ${fixture.id}`, () => {
    const input = fixture.input_hex ? Buffer.from(fixture.input_hex, 'hex') : Buffer.from(fixture.input_json as string)
    if (!fixture.valid) {
      assert.throws(() => canonicalizeJson(input), (error: unknown) => codeOf(error) === fixture.expected_code)
      return
    }
    const canonical = canonicalizeJson(input)
    if (fixture.expected_canonical_hex) assert.equal(canonical.toString('hex'), fixture.expected_canonical_hex)
    if (fixture.expected_sha256) assert.equal(sha256Hex(canonical), fixture.expected_sha256)
  })
}

for (const fixture of corpus.cbor_cases) {
  test(`CBOR corpus: ${fixture.id}`, () => {
    if (!fixture.valid) {
      assert.throws(() => decodeDeterministicCbor(Buffer.from(fixture.input_hex as string, 'hex')), (error: unknown) => codeOf(error) === fixture.expected_code)
      return
    }
    const encoded = encodeDeterministicCbor(fixture.value)
    assert.equal(encoded.toString('hex'), fixture.expected_hex)
    assert.deepEqual(decodeDeterministicCbor(encoded), fixture.value)
    assert.deepEqual(unframeCbor(frameCbor(encoded)), encoded)
  })
}

for (const fixture of corpus.normalization_cases) {
  test(`normalization corpus: ${fixture.id}`, () => {
    if (fixture.expected_path_query) assert.equal(normalizePathQuery(fixture.path as string, fixture.query_pairs as Array<[string, string]>), fixture.expected_path_query)
    if (fixture.expected_authority) assert.equal(formatAuthority(fixture.host as string, fixture.port as number), fixture.expected_authority)
  })
}

