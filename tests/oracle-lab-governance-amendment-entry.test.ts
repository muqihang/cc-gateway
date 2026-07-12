import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'

const repositoryRoot = path.resolve(new URL('..', import.meta.url).pathname)
const toolRelative = 'tools/oracle-lab/governance-amendment-entry.ts'
const entrySchemaRelative = 'docs/superpowers/schemas/oracle-lab-governance-amendment-entry.schema.json'
const receiptSchemaRelative = 'docs/superpowers/schemas/oracle-lab-governance-amendment-entry-receipt.schema.json'

for (const relative of [toolRelative, entrySchemaRelative, receiptSchemaRelative]) {
  assert.equal(existsSync(path.join(repositoryRoot, relative)), true, `${relative} must exist`)
}

const entryTool = await import(pathToFileURL(path.join(repositoryRoot, toolRelative)).href)
const BRANCH = 'codex/oracle-p0-1-governance'
const HERMETIC_ENVIRONMENT = {
  npm_config_offline: 'true',
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  GOPROXY: 'off',
  GOSUMDB: 'off',
  GOTOOLCHAIN: 'local',
  HTTP_PROXY: 'http://127.0.0.1:9',
  HTTPS_PROXY: 'http://127.0.0.1:9',
  ALL_PROXY: 'http://127.0.0.1:9',
  NO_PROXY: '127.0.0.1,localhost',
}
const EXPECTED_IN_SCOPE = [
  'adopt_and_correct_review_amendment',
  'overlay_prior_specifications',
  'preserve_seven_phases_with_mandatory_3b_3_5',
  'wp_r0_through_wp_r9_traceability_umbrellas',
  'requirement_registry_v2_and_v1_migration',
  'register_18_ra_requirements_as_deferred',
  'claim_matrix_prohibited_conclusions',
  'ra_current_observation_ledger',
  'bounded_ra_current_009_four_local_test_yaml_repairs',
  'two_joint_tests_in_successor_cross_repository_green_inventory',
  'successor_p0_1_evidence_chain',
  'exact_p1_entry_conditions',
]
const EXPECTED_OUT_OF_SCOPE = [
  'b1_through_b3_implementation',
  'b4_through_b6_implementation',
  'shared_readiness_handshake_or_contract_redesign',
  'profile_compiler_profile_or_evidence_factory_implementation',
  'account_policy_replay_response_scheduler_or_replica_runtime_work',
  'large_scale_proxy_refactor',
  'production_credentials_external_network_canary_or_promotion',
  'historical_phase_zero_or_post_integration_evidence_mutation',
]
const EXPECTED_DISABLED_CAPABILITIES = [
  'real_upstream_access',
  'real_credentials',
  'provider_internal_authority',
  'profile_promotion',
  'production_deployment',
  'real_canary',
  'direct_egress_trust',
  'unverified_pinned_wire_claims',
  'unsupported_negative_capabilities',
  'expired_or_missing_negative_capabilities',
  'unrestricted_capture',
  'external_network_requests',
]

assert.deepEqual(entryTool.GOVERNANCE_AMENDMENT_BINDINGS.scope.in_scope, EXPECTED_IN_SCOPE)
assert.deepEqual(entryTool.GOVERNANCE_AMENDMENT_BINDINGS.scope.out_of_scope, EXPECTED_OUT_OF_SCOPE)
assert.deepEqual(entryTool.GOVERNANCE_AMENDMENT_BINDINGS.disabledCapabilities, EXPECTED_DISABLED_CAPABILITIES)
assert.deepEqual({
  ccGatewayBaseMainHead: entryTool.GOVERNANCE_AMENDMENT_BINDINGS.ccGatewayBaseMainHead,
  sub2apiBaseMainHead: entryTool.GOVERNANCE_AMENDMENT_BINDINGS.sub2apiBaseMainHead,
  ccGatewayBranch: entryTool.GOVERNANCE_AMENDMENT_BINDINGS.ccGatewayBranch,
  sub2apiBranch: entryTool.GOVERNANCE_AMENDMENT_BINDINGS.sub2apiBranch,
  remoteName: entryTool.GOVERNANCE_AMENDMENT_BINDINGS.remoteName,
  remoteRef: entryTool.GOVERNANCE_AMENDMENT_BINDINGS.remoteRef,
  ccGatewayRemoteUrlDigest: entryTool.GOVERNANCE_AMENDMENT_BINDINGS.ccGatewayRemoteUrlDigest,
  sub2apiRemoteUrlDigest: entryTool.GOVERNANCE_AMENDMENT_BINDINGS.sub2apiRemoteUrlDigest,
  sharedContractPath: entryTool.GOVERNANCE_AMENDMENT_BINDINGS.sharedContractPath,
  sharedContractDigest: entryTool.GOVERNANCE_AMENDMENT_BINDINGS.sharedContractDigest,
  phaseZeroReceiptPath: entryTool.GOVERNANCE_AMENDMENT_BINDINGS.phaseZeroReceiptPath,
  phaseZeroReceiptDigest: entryTool.GOVERNANCE_AMENDMENT_BINDINGS.phaseZeroReceiptDigest,
  postIntegrationV2ReceiptPath: entryTool.GOVERNANCE_AMENDMENT_BINDINGS.postIntegrationV2ReceiptPath,
  postIntegrationV2ReceiptDigest: entryTool.GOVERNANCE_AMENDMENT_BINDINGS.postIntegrationV2ReceiptDigest,
  reviewSourceDigest: entryTool.GOVERNANCE_AMENDMENT_BINDINGS.reviewSourceDigest,
  codegraphVersion: entryTool.GOVERNANCE_AMENDMENT_BINDINGS.codegraphVersion,
  entryPath: entryTool.GOVERNANCE_AMENDMENT_BINDINGS.entryPath,
  receiptPath: entryTool.GOVERNANCE_AMENDMENT_BINDINGS.receiptPath,
}, {
  ccGatewayBaseMainHead: '9ca9ea72d881fccd2cfb3fd1b939a2f56db69516',
  sub2apiBaseMainHead: 'd5a42bbd24d15af2ce7646d050a5ae5c77911d4f',
  ccGatewayBranch: 'codex/oracle-p0-1-governance',
  sub2apiBranch: 'codex/oracle-p0-1-governance',
  remoteName: 'muqihang',
  remoteRef: 'refs/remotes/muqihang/main',
  ccGatewayRemoteUrlDigest: 'sha256:52de8ee497a784b90b33345865754f3e6b9d5d96eed92549a15a4157cabb568a',
  sub2apiRemoteUrlDigest: 'sha256:22c1a9e3cf8e76d2a20bf24a1ff66fa5d7417ba8b8b83a948c8b3ffa5c33a1a9',
  sharedContractPath: 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json',
  sharedContractDigest: 'sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1',
  phaseZeroReceiptPath: 'docs/superpowers/evidence/phase-0/phase-0-exit-receipt.json',
  phaseZeroReceiptDigest: 'sha256:5a2bef840e04d6533bfc657520c73cbc8fcc5f27ede181d168d9b2bf8a3fedee',
  postIntegrationV2ReceiptPath: 'docs/superpowers/evidence/post-integration-v2/post-integration-receipt.json',
  postIntegrationV2ReceiptDigest: 'sha256:c6b64e233dfa2df8c4cd8937aa2b8552ac54c68d4593a32a837af20d4923fb64',
  reviewSourceDigest: 'sha256:76e662ede1e113018eb5bf8cb835e2e825ae094d426a1c73c4af17f8a643dbf4',
  codegraphVersion: '1.1.6',
  entryPath: 'docs/superpowers/evidence/p0-1/p0-1-entry-baseline.json',
  receiptPath: 'docs/superpowers/evidence/p0-1/p0-1-entry-baseline.receipt.json',
})

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function write(root: string, relative: string, value: string | Buffer): void {
  const absolute = path.join(root, relative)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, value)
}

function initRepository(root: string): void {
  mkdirSync(root, { recursive: true })
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'oracle@example.invalid')
  git(root, 'config', 'user.name', 'Oracle Test')
}

type Fixture = {
  cc: string
  sub: string
  reviewSource: string
  reviewedToolHead: string
  bindings: Record<string, unknown>
  graph: Record<string, { version: string; up_to_date: true; index_digest: string; file_count: number; node_count: number; edge_count: number }>
}

let fixtureSerial = 0

function fixture(): Fixture {
  fixtureSerial += 1
  const root = mkdtempSync(path.join(tmpdir(), `oracle-governance-entry-${fixtureSerial}-`))
  const cc = path.join(root, 'cc-gateway')
  const sub = path.join(root, 'sub2api')
  const reviewSource = path.join(root, 'review-source.md')
  initRepository(cc)
  initRepository(sub)

  write(cc, '.gitignore', '.codegraph/\n')
  write(cc, 'base.txt', 'cc base\n')
  write(cc, entryTool.GOVERNANCE_AMENDMENT_BINDINGS.phaseZeroReceiptPath, '{"receipt":"phase-zero"}\n')
  write(cc, entryTool.GOVERNANCE_AMENDMENT_BINDINGS.postIntegrationV2ReceiptPath, '{"receipt":"post-integration-v2"}\n')
  git(cc, 'add', '.')
  git(cc, 'commit', '-qm', 'frozen cc main')
  git(cc, 'branch', '-M', BRANCH)
  const ccBase = git(cc, 'rev-parse', 'HEAD')
  const ccRemote = `https://example.invalid/cc-${fixtureSerial}.git`
  git(cc, 'remote', 'add', 'muqihang', ccRemote)
  git(cc, 'update-ref', 'refs/remotes/muqihang/main', ccBase)

  write(sub, '.gitignore', '.codegraph/\n')
  write(sub, entryTool.GOVERNANCE_AMENDMENT_BINDINGS.sharedContractPath, '{"contract":"frozen"}\n')
  git(sub, 'add', '.')
  git(sub, 'commit', '-qm', 'frozen sub2api main')
  git(sub, 'branch', '-M', BRANCH)
  const subBase = git(sub, 'rev-parse', 'HEAD')
  const subRemote = `https://example.invalid/sub-${fixtureSerial}.git`
  git(sub, 'remote', 'add', 'muqihang', subRemote)
  git(sub, 'update-ref', 'refs/remotes/muqihang/main', subBase)

  for (const relative of [toolRelative, entrySchemaRelative, receiptSchemaRelative]) {
    write(cc, relative, readFileSync(path.join(repositoryRoot, relative)))
  }
  git(cc, 'add', toolRelative, entrySchemaRelative, receiptSchemaRelative)
  git(cc, 'commit', '-qm', 'reviewed Task 0A tool')
  const reviewedToolHead = git(cc, 'rev-parse', 'HEAD')

  writeFileSync(reviewSource, `review amendment ${fixtureSerial}\n`)
  const defaults = entryTool.GOVERNANCE_AMENDMENT_BINDINGS
  const bindings = {
    ...defaults,
    ccGatewayBaseMainHead: ccBase,
    sub2apiBaseMainHead: subBase,
    ccGatewayRemoteUrlDigest: sha256(ccRemote),
    sub2apiRemoteUrlDigest: sha256(subRemote),
    sharedContractDigest: sha256(readFileSync(path.join(sub, defaults.sharedContractPath))),
    phaseZeroReceiptDigest: sha256(readFileSync(path.join(cc, defaults.phaseZeroReceiptPath))),
    postIntegrationV2ReceiptDigest: sha256(readFileSync(path.join(cc, defaults.postIntegrationV2ReceiptPath))),
    reviewSourceDigest: sha256(readFileSync(reviewSource)),
  }
  const graph = {
    [realpathSync(cc)]: { version: '1.1.6', up_to_date: true as const, index_digest: sha256(`cc-index-${fixtureSerial}`), file_count: 103, node_count: 3200, edge_count: 12000 },
    [realpathSync(sub)]: { version: '1.1.6', up_to_date: true as const, index_digest: sha256(`sub-index-${fixtureSerial}`), file_count: 3042, node_count: 98075, edge_count: 328728 },
  }
  return { cc, sub, reviewSource, reviewedToolHead, bindings, graph }
}

function capture(
  current: Fixture,
  inspectCodeGraph = (root: string) => current.graph[root],
  environment: Record<string, string | undefined> = HERMETIC_ENVIRONMENT,
): { entry: Record<string, unknown>; receipt: Record<string, unknown> } {
  return entryTool.captureGovernanceAmendmentEntry({
    ccGatewayRoot: current.cc,
    sub2apiRoot: current.sub,
    reviewSourcePath: current.reviewSource,
    bindings: current.bindings,
    inspectCodeGraph,
    environment,
    generatedAt: '2026-07-12T20:00:00.000Z',
  })
}

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.equal((error as { code?: string }).code, code)
    return true
  })
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const validFixture = fixture()
const validPair = capture(validFixture)
assert.equal(validPair.entry.reviewed_tool_head, validFixture.reviewedToolHead)
assert.deepEqual(validPair.entry.base_main_heads, {
  cc_gateway: validFixture.bindings.ccGatewayBaseMainHead,
  sub2api: validFixture.bindings.sub2apiBaseMainHead,
})
entryTool.validateGovernanceAmendmentEntryPair(validPair.entry, validPair.receipt, { bindings: validFixture.bindings })

const entrySchema = JSON.parse(readFileSync(path.join(repositoryRoot, entrySchemaRelative), 'utf8'))
const receiptSchema = JSON.parse(readFileSync(path.join(repositoryRoot, receiptSchemaRelative), 'utf8'))
const ajv = new Ajv2020({ strict: false })
const validateEntrySchema = ajv.compile(entrySchema)
const validateReceiptSchema = ajv.compile(receiptSchema)
assert.equal(validateEntrySchema(validPair.entry), true, JSON.stringify(validateEntrySchema.errors))
assert.equal(validateReceiptSchema(validPair.receipt), true, JSON.stringify(validateReceiptSchema.errors))
const schemaUnknown = { ...clone(validPair.entry), surprise: true }
assert.equal(validateEntrySchema(schemaUnknown), false)
const schemaAbsolute = clone(validPair.entry) as any
schemaAbsolute.artifacts.entry_path = '/tmp/p0-1-entry.json'
assert.equal(validateEntrySchema(schemaAbsolute), false)
const nonRfc3339Pair = clone(validPair) as any
nonRfc3339Pair.entry.generated_at = '2026-07-12'
nonRfc3339Pair.receipt.generated_at = '2026-07-12'
nonRfc3339Pair.receipt.entry.digest = sha256(`${canonicalJson(nonRfc3339Pair.entry)}\n`)
expectCode(() => entryTool.validateGovernanceAmendmentEntryPair(nonRfc3339Pair.entry, nonRfc3339Pair.receipt, { bindings: validFixture.bindings }), 'invalid_timestamp')

const wrongCcBase = fixture()
git(wrongCcBase.cc, 'update-ref', 'refs/remotes/muqihang/main', wrongCcBase.reviewedToolHead)
expectCode(() => capture(wrongCcBase), 'wrong_base_main_head')

const wrongSubBase = fixture()
write(wrongSubBase.sub, 'later.txt', 'later\n')
git(wrongSubBase.sub, 'add', 'later.txt')
git(wrongSubBase.sub, 'commit', '-qm', 'unexpected Sub2API head')
git(wrongSubBase.sub, 'update-ref', 'refs/remotes/muqihang/main', git(wrongSubBase.sub, 'rev-parse', 'HEAD'))
expectCode(() => capture(wrongSubBase), 'wrong_base_main_head')

const unrelated = fixture()
const unrelatedCommit = git(unrelated.cc, 'commit-tree', `${unrelated.reviewedToolHead}^{tree}`, '-m', 'unrelated branch root')
git(unrelated.cc, 'update-ref', `refs/heads/${BRANCH}`, unrelatedCommit)
expectCode(() => capture(unrelated), 'invalid_base_ancestry')

const wrongBranch = fixture()
git(wrongBranch.cc, 'branch', '-m', 'wrong-branch')
expectCode(() => capture(wrongBranch), 'wrong_repository_branch')

const wrongRemoteUrl = fixture()
git(wrongRemoteUrl.sub, 'remote', 'set-url', 'muqihang', 'https://example.invalid/wrong.git')
expectCode(() => capture(wrongRemoteUrl), 'wrong_remote_ref')

const ignoredIndex = fixture()
write(ignoredIndex.cc, '.codegraph/local-state', 'ignored\n')
write(ignoredIndex.sub, '.codegraph/local-state', 'ignored\n')
capture(ignoredIndex)

const trackedDirty = fixture()
write(trackedDirty.cc, 'base.txt', 'dirty\n')
expectCode(() => capture(trackedDirty), 'dirty_repository')

const untrackedDirty = fixture()
write(untrackedDirty.sub, 'untracked.txt', 'dirty\n')
expectCode(() => capture(untrackedDirty), 'dirty_repository')

const contractDrift = fixture()
write(contractDrift.sub, entryTool.GOVERNANCE_AMENDMENT_BINDINGS.sharedContractPath, '{"contract":"changed"}\n')
expectCode(() => capture(contractDrift), 'contract_drift')

const phaseReceiptDrift = fixture()
write(phaseReceiptDrift.cc, entryTool.GOVERNANCE_AMENDMENT_BINDINGS.phaseZeroReceiptPath, '{"receipt":"changed"}\n')
expectCode(() => capture(phaseReceiptDrift), 'parent_receipt_drift')

const postReceiptDrift = fixture()
write(postReceiptDrift.cc, entryTool.GOVERNANCE_AMENDMENT_BINDINGS.postIntegrationV2ReceiptPath, '{"receipt":"changed"}\n')
expectCode(() => capture(postReceiptDrift), 'parent_receipt_drift')

const reviewDrift = fixture()
writeFileSync(reviewDrift.reviewSource, 'changed amendment\n')
expectCode(() => capture(reviewDrift), 'review_amendment_drift')

const missingGraph = fixture()
expectCode(() => capture(missingGraph, () => {
  throw Object.assign(new Error('missing'), { code: 'missing_codegraph_index' })
}), 'missing_codegraph_index')

const staleGraph = fixture()
expectCode(() => capture(staleGraph, (root: string) => ({ ...staleGraph.graph[root], up_to_date: false })), 'stale_codegraph_index')

const wrongGraphVersion = fixture()
expectCode(() => capture(wrongGraphVersion, (root: string) => ({ ...wrongGraphVersion.graph[root], version: '1.1.5' })), 'wrong_codegraph_version')

const nonHermeticEnvironment = fixture()
expectCode(() => capture(nonHermeticEnvironment, undefined, { ...HERMETIC_ENVIRONMENT, npm_config_offline: 'false' }), 'non_hermetic_environment')

const unknownEntry = { ...clone(validPair.entry), unknown: true }
assert.equal(entryTool.validateGovernanceAmendmentEntryValue(unknownEntry, validFixture.bindings).errors[0].code, 'unknown_field')
const absoluteEntry = clone(validPair.entry) as any
absoluteEntry.artifacts.entry_path = '/Users/operator/p0-1-entry.json'
assert.equal(entryTool.validateGovernanceAmendmentEntryValue(absoluteEntry, validFixture.bindings).errors[0].code, 'unsafe_artifact')
const secretReceipt = clone(validPair.receipt) as any
secretReceipt.raw_secret = 'sk-secret-canary-value'
const secretResult = entryTool.validateGovernanceAmendmentEntryReceiptValue(secretReceipt, validFixture.bindings)
assert.ok(secretResult.errors.some((error: { code: string }) => error.code === 'unsafe_artifact'))
expectCode(() => entryTool.validateGovernanceAmendmentEntryPair(validPair.entry, undefined, { bindings: validFixture.bindings }), 'missing_entry_pair')

function commitPair(current: Fixture, pair: typeof validPair, extraPath?: string): string {
  entryTool.writeGovernanceAmendmentEntryPair(current.cc, pair.entry, pair.receipt, { bindings: current.bindings })
  const entryPath = current.bindings.entryPath as string
  const receiptPath = current.bindings.receiptPath as string
  git(current.cc, 'add', entryPath, receiptPath)
  if (extraPath) {
    write(current.cc, extraPath, 'unexpected\n')
    git(current.cc, 'add', extraPath)
  }
  git(current.cc, 'commit', '-qm', 'entry pair')
  return git(current.cc, 'rev-parse', 'HEAD')
}

const failedPublish = fixture()
const failedPublishPair = capture(failedPublish)
let publishCount = 0
expectCode(() => entryTool.writeGovernanceAmendmentEntryPair(failedPublish.cc, failedPublishPair.entry, failedPublishPair.receipt, {
  bindings: failedPublish.bindings,
  publishLink: (source: string, destination: string) => {
    publishCount += 1
    if (publishCount === 2) throw Object.assign(new Error('injected second publish failure'), { code: 'injected_publish_failure' })
    linkSync(source, destination)
  },
}), 'injected_publish_failure')
assert.equal(existsSync(path.join(failedPublish.cc, failedPublish.bindings.entryPath as string)), false)
assert.equal(existsSync(path.join(failedPublish.cc, failedPublish.bindings.receiptPath as string)), false)

const symlinkDestination = fixture()
const symlinkDestinationPair = capture(symlinkDestination)
const symlinkEntryPath = path.join(symlinkDestination.cc, symlinkDestination.bindings.entryPath as string)
mkdirSync(path.dirname(symlinkEntryPath), { recursive: true })
symlinkSync(symlinkDestination.reviewSource, symlinkEntryPath)
expectCode(() => entryTool.writeGovernanceAmendmentEntryPair(symlinkDestination.cc, symlinkDestinationPair.entry, symlinkDestinationPair.receipt, { bindings: symlinkDestination.bindings }), 'artifact_symlink')

const committed = fixture()
const committedPair = capture(committed)
const entryCommit = commitPair(committed, committedPair)
entryTool.validateGovernanceAmendmentEntryCommit({
  ccGatewayRoot: committed.cc,
  entryCommit,
  toolCommit: committed.reviewedToolHead,
  entryPath: committed.bindings.entryPath,
  receiptPath: committed.bindings.receiptPath,
  entry: committedPair.entry,
  receipt: committedPair.receipt,
  bindings: committed.bindings,
})

const wrongParent = fixture()
const wrongParentPair = capture(wrongParent)
write(wrongParent.cc, 'intervening.txt', 'intervening\n')
git(wrongParent.cc, 'add', 'intervening.txt')
git(wrongParent.cc, 'commit', '-qm', 'intervening commit')
const wrongParentCommit = commitPair(wrongParent, wrongParentPair)
expectCode(() => entryTool.validateGovernanceAmendmentEntryCommit({
  ccGatewayRoot: wrongParent.cc,
  entryCommit: wrongParentCommit,
  toolCommit: wrongParent.reviewedToolHead,
  entryPath: wrongParent.bindings.entryPath,
  receiptPath: wrongParent.bindings.receiptPath,
  entry: wrongParentPair.entry,
  receipt: wrongParentPair.receipt,
  bindings: wrongParent.bindings,
}), 'entry_commit_parent_mismatch')

const extraDelta = fixture()
const extraDeltaPair = capture(extraDelta)
const extraDeltaCommit = commitPair(extraDelta, extraDeltaPair, 'unexpected.txt')
expectCode(() => entryTool.validateGovernanceAmendmentEntryCommit({
  ccGatewayRoot: extraDelta.cc,
  entryCommit: extraDeltaCommit,
  toolCommit: extraDelta.reviewedToolHead,
  entryPath: extraDelta.bindings.entryPath,
  receiptPath: extraDelta.bindings.receiptPath,
  entry: extraDeltaPair.entry,
  receipt: extraDeltaPair.receipt,
  bindings: extraDelta.bindings,
}), 'entry_commit_delta_mismatch')

const byteDrift = fixture()
const byteDriftPair = capture(byteDrift)
const byteDriftCommit = commitPair(byteDrift, byteDriftPair)
writeFileSync(path.join(byteDrift.cc, byteDrift.bindings.entryPath as string), `${JSON.stringify(byteDriftPair.entry)}\n\n`)
expectCode(() => entryTool.validateGovernanceAmendmentEntryCommit({
  ccGatewayRoot: byteDrift.cc,
  entryCommit: byteDriftCommit,
  toolCommit: byteDrift.reviewedToolHead,
  entryPath: byteDrift.bindings.entryPath,
  receiptPath: byteDrift.bindings.receiptPath,
  entry: byteDriftPair.entry,
  receipt: byteDriftPair.receipt,
  bindings: byteDrift.bindings,
}), 'entry_commit_bytes_mismatch')

const forgedCaptureInput = fixture()
const forgedCapturePair = capture(forgedCaptureInput)
;(forgedCapturePair.entry.capture_inputs as any).capture_tool.digest = `sha256:${'0'.repeat(64)}`
;(forgedCapturePair.receipt.entry as any).digest = sha256(`${canonicalJson(forgedCapturePair.entry)}\n`)
const forgedCaptureCommit = commitPair(forgedCaptureInput, forgedCapturePair)
expectCode(() => entryTool.validateGovernanceAmendmentEntryCommit({
  ccGatewayRoot: forgedCaptureInput.cc,
  entryCommit: forgedCaptureCommit,
  toolCommit: forgedCaptureInput.reviewedToolHead,
  entryPath: forgedCaptureInput.bindings.entryPath,
  receiptPath: forgedCaptureInput.bindings.receiptPath,
  entry: forgedCapturePair.entry,
  receipt: forgedCapturePair.receipt,
  bindings: forgedCaptureInput.bindings,
}), 'capture_input_drift')

console.log('oracle-lab governance amendment entry tests: ok')
