import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import canonicalize from 'canonicalize'

import { sha256File } from '../tools/oracle-contract/check-shared-contract.js'
import { CrossRepoContractError, checkCrossRepoContract } from '../tools/oracle-contract/check-cross-repo.js'
import { resolveSub2apiTestRoot } from './oracle-contract-test-roots.js'

const ccGatewayRoot = process.cwd()
const sub2apiRoot = resolveSub2apiTestRoot()

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => error instanceof CrossRepoContractError && error.code === code)
}

function fixtureCopy(): { ccGatewayRoot: string; sub2apiRoot: string; ccBundle: string; subBundle: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'oracle-phase2-cross-repo-'))
  const ccRoot = path.join(root, 'cc')
  const subRoot = path.join(root, 'sub')
  const ccBundle = path.join(ccRoot, 'contracts/oracle-lab/v1')
  const subBundle = path.join(subRoot, 'backend/internal/service/testdata/oracle_lab_contract/v1')
  mkdirSync(path.dirname(ccBundle), { recursive: true })
  mkdirSync(path.dirname(subBundle), { recursive: true })
  cpSync(path.join(ccGatewayRoot, 'contracts/oracle-lab/v1'), ccBundle, { recursive: true })
  cpSync(path.join(sub2apiRoot, 'backend/internal/service/testdata/oracle_lab_contract/v1'), subBundle, { recursive: true })
  const predecessor = path.join(subRoot, 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json')
  mkdirSync(path.dirname(predecessor), { recursive: true })
  cpSync(path.join(sub2apiRoot, 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json'), predecessor)
  return { ccGatewayRoot: ccRoot, sub2apiRoot: subRoot, ccBundle, subBundle }
}

function refreshIndex(fixture: ReturnType<typeof fixtureCopy>): void {
  const indexPath = path.join(fixture.ccBundle, 'contract-index.json')
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as { files: Array<{ relative_path: string; sha256: string }> }
  for (const entry of index.files) entry.sha256 = sha256File(path.join(fixture.ccBundle, entry.relative_path))
  const raw = canonicalize(index)
  assert.ok(raw)
  writeFileSync(indexPath, raw)
  cpSync(fixture.ccBundle, fixture.subBundle, { recursive: true, force: true })
}

test('joint Phase 2 contract gate passes the real clean pair', () => {
  const result = checkCrossRepoContract({ ccGatewayRoot, sub2apiRoot, runCommands: true })
  assert.equal(result.ok, true)
  assert.equal(result.schemaRange, '1:0-0')
  assert.ok(result.fixtureCases >= 50)
})

test('joint gate rejects mirror, schema-range, and decision drift before commands', () => {
  const mirror = fixtureCopy()
  writeFileSync(path.join(mirror.subBundle, 'sidecar-envelope.cddl'), `${readFileSync(path.join(mirror.subBundle, 'sidecar-envelope.cddl'), 'utf8')} `)
  expectCode(() => checkCrossRepoContract({ ...mirror, runCommands: false }), 'contract_mirror_mismatch')

  const range = fixtureCopy()
  for (const bundle of [range.ccBundle, range.subBundle]) {
    const indexPath = path.join(bundle, 'contract-index.json')
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as Record<string, unknown>
    index.compatibility = [{ schema_major: 1, minimum_revision: 1, maximum_revision: 1 }]
    writeFileSync(indexPath, canonicalize(index) as string)
  }
  expectCode(() => checkCrossRepoContract({ ...range, runCommands: false }), 'contract_schema_range_mismatch')

  const decision = fixtureCopy()
  const interfacePath = path.join(decision.ccBundle, 'interface-corpus.json')
  const corpus = JSON.parse(readFileSync(interfacePath, 'utf8')) as { cases: Array<{ expected_code: string }> }
  corpus.cases[0].expected_code = 'interface_unregistered_code'
  writeFileSync(interfacePath, JSON.stringify(corpus))
  refreshIndex(decision)
  expectCode(() => checkCrossRepoContract({ ...decision, runCommands: false }), 'contract_expected_result_missing')
})
