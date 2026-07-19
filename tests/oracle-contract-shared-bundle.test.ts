import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import canonicalize from 'canonicalize'

import {
  CONTRACT_FILES,
  PHASE1_CONTRACT_DIGEST,
  SharedContractError,
  checkSharedContract,
  sha256File,
} from '../tools/oracle-contract/check-shared-contract.js'

const ccGatewayRoot = process.cwd()
const sub2apiRoot = process.env.SUB2API_ROOT
assert.ok(sub2apiRoot, 'SUB2API_ROOT must identify the clean Phase 2 Sub2API worktree')

const ccBundle = path.join(ccGatewayRoot, 'contracts/oracle-lab/v1')
const subBundle = path.join(sub2apiRoot, 'backend/internal/service/testdata/oracle_lab_contract/v1')

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => error instanceof SharedContractError && error.code === code)
}

function fixtureCopy(): { ccGatewayRoot: string; sub2apiRoot: string; ccBundle: string; subBundle: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'oracle-phase2-contract-'))
  const ccRoot = path.join(root, 'cc')
  const subRoot = path.join(root, 'sub')
  const ccCopy = path.join(ccRoot, 'contracts/oracle-lab/v1')
  const subCopy = path.join(subRoot, 'backend/internal/service/testdata/oracle_lab_contract/v1')
  mkdirSync(path.dirname(ccCopy), { recursive: true })
  mkdirSync(path.dirname(subCopy), { recursive: true })
  cpSync(ccBundle, ccCopy, { recursive: true })
  cpSync(subBundle, subCopy, { recursive: true })
  return { ccGatewayRoot: ccRoot, sub2apiRoot: subRoot, ccBundle: ccCopy, subBundle: subCopy }
}

function rewriteIndex(bundle: string, mutate: (index: Record<string, unknown>) => void): void {
  const file = path.join(bundle, 'contract-index.json')
  const index = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  mutate(index)
  const encoded = canonicalize(index)
  assert.ok(encoded)
  writeFileSync(file, encoded)
}

test('shared Phase 2 contract mirrors and Phase 1 predecessor are exact', () => {
  const result = checkSharedContract({ ccGatewayRoot, sub2apiRoot })
  assert.equal(result.ok, true)
  assert.equal(result.fileCount, CONTRACT_FILES.length)
  assert.match(result.bundleDigest, /^[0-9a-f]{64}$/)
  assert.equal(
    sha256File(path.join(sub2apiRoot, 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json')),
    PHASE1_CONTRACT_DIGEST,
  )
})

test('missing bundles fail closed', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'oracle-phase2-contract-missing-'))
  expectCode(() => checkSharedContract({ ccGatewayRoot: path.join(root, 'cc'), sub2apiRoot: path.join(root, 'sub') }), 'contract_bundle_missing')
})

test('one-byte mirror drift is rejected', () => {
  const fixture = fixtureCopy()
  const file = path.join(fixture.subBundle, 'expected-results.json')
  writeFileSync(file, `${readFileSync(file, 'utf8')} `)
  expectCode(() => checkSharedContract(fixture), 'contract_mirror_mismatch')
})

test('index ordering and indexed paths are strict', () => {
  const ordering = fixtureCopy()
  for (const bundle of [ordering.ccBundle, ordering.subBundle]) {
    rewriteIndex(bundle, (index) => {
      const files = index.files as unknown[]
      index.files = [...files].reverse()
    })
  }
  expectCode(() => checkSharedContract(ordering), 'contract_index_file_order_invalid')

  const escape = fixtureCopy()
  for (const bundle of [escape.ccBundle, escape.subBundle]) {
    rewriteIndex(bundle, (index) => {
      const files = index.files as Array<Record<string, unknown>>
      files[0].relative_path = '../escape.json'
    })
  }
  expectCode(() => checkSharedContract(escape), 'contract_index_path_invalid')
})

test('stale digests and unknown files are rejected', () => {
  const stale = fixtureCopy()
  for (const bundle of [stale.ccBundle, stale.subBundle]) {
    const file = path.join(bundle, 'coherence-corpus.json')
    writeFileSync(file, `${readFileSync(file, 'utf8')} `)
  }
  expectCode(() => checkSharedContract(stale), 'contract_file_digest_mismatch')

  const unknown = fixtureCopy()
  for (const bundle of [unknown.ccBundle, unknown.subBundle]) {
    writeFileSync(path.join(bundle, 'unexpected.json'), '{}')
  }
  expectCode(() => checkSharedContract(unknown), 'contract_file_set_invalid')
})

test('symlinks and duplicate JSON keys are rejected', () => {
  const symlink = fixtureCopy()
  symlinkSync(path.join(symlink.ccBundle, 'expected-results.json'), path.join(symlink.ccBundle, 'unexpected-link'))
  expectCode(() => checkSharedContract(symlink), 'contract_symlink')

  const duplicate = fixtureCopy()
  for (const bundle of [duplicate.ccBundle, duplicate.subBundle]) {
    writeFileSync(path.join(bundle, 'coherence-corpus.json'), '{"schema_id":"oracle.compatibility","schema_id":"duplicate"}')
  }
  expectCode(() => checkSharedContract(duplicate), 'contract_json_invalid')
})

test('the Phase 1 predecessor digest cannot be rewritten', () => {
  const fixture = fixtureCopy()
  for (const bundle of [fixture.ccBundle, fixture.subBundle]) {
    rewriteIndex(bundle, (index) => {
      index.predecessor = {
        repository: 'sub2api',
        path: 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json',
        sha256: '0'.repeat(64),
      }
    })
  }
  expectCode(() => checkSharedContract(fixture), 'contract_predecessor_mismatch')
})
