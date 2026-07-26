import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import canonicalize from 'canonicalize'

import { sha256File } from '../tools/oracle-contract/check-shared-contract.js'
import {
  CROSS_REPO_RECORD_CONSTRAINTS,
  CROSS_REPO_RECORD_SCHEMA_PROJECTION,
  CrossRepoContractError,
  DIAGNOSTIC_FORBIDDEN_KEYS,
  SUB_TEST_ARGS,
  buildCrossRepoRecord,
  checkCrossRepoContract,
  encodeCrossRepoRecord,
  validateCrossRepoRecord,
} from '../tools/oracle-contract/check-cross-repo.js'
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
  const subBundle = path.join(subRoot, 'backend/internal/oracleevidence/testdata/oracle_lab_contract/v1')
  mkdirSync(path.dirname(ccBundle), { recursive: true })
  mkdirSync(path.dirname(subBundle), { recursive: true })
  cpSync(path.join(ccGatewayRoot, 'contracts/oracle-lab/v1'), ccBundle, { recursive: true })
  cpSync(path.join(sub2apiRoot, 'backend/internal/oracleevidence/testdata/oracle_lab_contract/v1'), subBundle, { recursive: true })
  const rebaseline = path.join(subRoot, 'backend/internal/oracleevidence/testdata/rebaseline/v1')
  mkdirSync(path.dirname(rebaseline), { recursive: true })
  cpSync(path.join(sub2apiRoot, 'backend/internal/oracleevidence/testdata/rebaseline/v1'), rebaseline, { recursive: true })
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
  assert.equal(result.decisionRows, 69)
  assert.equal(result.mutationRows, 1)
  assert.equal(result.commandsRun, 1)
  assert.equal(result.stableCodeSetDigest, 'f6f89d48519aaa46b362a474cc6bd8e470b638e1c7f4c3c0a7ac99413a85fa5c')
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
  expectCode(() => checkCrossRepoContract({ ...range, runCommands: false }), 'contract_file_digest_mismatch')

  const decision = fixtureCopy()
  const interfacePath = path.join(decision.ccBundle, 'interface-corpus.json')
  const corpus = JSON.parse(readFileSync(interfacePath, 'utf8')) as { cases: Array<{ expected_code: string }> }
  corpus.cases[0].expected_code = 'interface_unregistered_code'
  writeFileSync(interfacePath, JSON.stringify(corpus))
  refreshIndex(decision)
  expectCode(() => checkCrossRepoContract({ ...decision, runCommands: false }), 'contract_file_digest_mismatch')
})

const recordInput = {
  issuedAtMs: Date.now(),
  ccC1Commit: '1234567890abcdef1234567890abcdef12345678',
  ccC1Tree: 'abcdef1234567890abcdef1234567890abcdef12',
  crossReviewTaskId: 'task:c1-cross-review',
  crossReviewArtifactSha256: '1'.repeat(64),
}

function rebind(record: Record<string, unknown>): Buffer {
  const unsigned = { ...record }
  delete unsigned.record_digest
  const core = canonicalize(unsigned)
  assert.ok(core)
  record.record_digest = createHash('sha256').update(`${core}\n`).digest('hex')
  const encoded = canonicalize(record)
  assert.ok(encoded)
  return Buffer.from(`${encoded}\n`)
}

test('cross-repo record is independently computed, JCS framed, and digest bound', () => {
  const record = buildCrossRepoRecord(ccGatewayRoot, sub2apiRoot, recordInput)
  const raw = encodeCrossRepoRecord(record)
  const parsed = validateCrossRepoRecord(raw, ccGatewayRoot, sub2apiRoot)

  assert.equal(parsed.record_digest, record.record_digest)
  assert.equal(raw.at(-1), 0x0a)
  assert.notEqual(raw.at(-2), 0x0a)
  assert.equal((parsed.result as Record<string, unknown>).decisions_sha256, checkCrossRepoContract({ ccGatewayRoot, sub2apiRoot, runCommands: false }).decisionsDigest)
  assert.throws(() => validateCrossRepoRecord(raw.subarray(0, -1), ccGatewayRoot, sub2apiRoot), (error: unknown) => error instanceof CrossRepoContractError && error.code === 'cross_repo_binding_mismatch')
})

test('schema, constraint, DAG, diagnostic, and result mutations fail closed', () => {
  const original = buildCrossRepoRecord(ccGatewayRoot, sub2apiRoot, recordInput)

  const diagnostic = structuredClone(original) as Record<string, unknown>
  diagnostic[DIAGNOSTIC_FORBIDDEN_KEYS[4]] = 3_064
  assert.throws(() => validateCrossRepoRecord(rebind(diagnostic), ccGatewayRoot, sub2apiRoot), (error: unknown) => error instanceof CrossRepoContractError && error.code === 'authority_diagnostic_promotion')

  const resultDrift = structuredClone(original) as Record<string, unknown>
  const result = resultDrift.result as Record<string, unknown>
  result.case_rows = (result.case_rows as unknown[]).slice(0, -1)
  assert.throws(() => validateCrossRepoRecord(rebind(resultDrift), ccGatewayRoot, sub2apiRoot), (error: unknown) => error instanceof CrossRepoContractError && error.code === 'cross_repo_result_mismatch')

  const dagDrift = structuredClone(original) as Record<string, unknown>
  const dag = dagDrift.commit_dag as { nodes: unknown[] }
  dag.nodes = [...dag.nodes].reverse()
  assert.throws(() => validateCrossRepoRecord(rebind(dagDrift), ccGatewayRoot, sub2apiRoot), (error: unknown) => error instanceof CrossRepoContractError && error.code === 'cross_repo_binding_mismatch')

  const leak = structuredClone(original) as Record<string, unknown>
  leak.credentials = { value: 'Bearer synthetic-secret' }
  assert.throws(() => validateCrossRepoRecord(rebind(leak), ccGatewayRoot, sub2apiRoot), (error: unknown) => error instanceof CrossRepoContractError && error.code === 'leak_detected')
})

test('frozen projection and Sub command contain no service or broad selectors', () => {
  assert.deepEqual(SUB_TEST_ARGS, ['test', './internal/oracleevidence', '-run', '^TestOracleContract(Scaffold|StrictJSON|JCS|Normalization|CBOR|Schema|Admission|ManifestAuthority|Interface|Replay|Sidecar|Mutation|CrossRepo)$', '-count=1'])
  assert.equal(JSON.stringify(SUB_TEST_ARGS).includes('./internal/service'), false)
  assert.equal(JSON.stringify(SUB_TEST_ARGS).includes('./...'), false)
  assert.equal(CROSS_REPO_RECORD_SCHEMA_PROJECTION.mirror_root, 'backend/internal/oracleevidence/testdata/oracle_lab_contract/v1')
  assert.deepEqual(CROSS_REPO_RECORD_CONSTRAINTS.serial_node_order, ['C0', 'S0', 'S1', 'R1', 'I1', 'SR', 'C1', 'CR'])
  assert.deepEqual(CROSS_REPO_RECORD_CONSTRAINTS.command_ids, ['cc-focused-contract-suite-v1', 'sub-focused-oracleevidence-v1'])
})
