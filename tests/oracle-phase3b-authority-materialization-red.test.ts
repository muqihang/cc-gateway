import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { bindMaterializedCrossRepoAuthority, buildEs7TypedFixtureContract, buildEs9CoverageContract, launchRecipe, rebuildProbe, validateCodesignToolchain } from '../tools/oracle-lab/phase3b-evidence-sufficiency/authority-materializer.js'
import { main as materializerMain } from '../tools/oracle-lab/phase3b-evidence-sufficiency/authority-materializer-cli.js'
import { validateCoverageContract, validateTypedFixtureContract } from '../tools/oracle-lab/phase3b-evidence-sufficiency/closeout.js'
import { canonicalBytes, canonicalJson, sha256Bytes, sha256Canonical } from '../tools/oracle-lab/phase3b-evidence-sufficiency/core.js'
import { CROSS_REPO_AUTHORITY, ES7_REQUEST_FIELDS, ES7_RESPONSE_FIELDS } from '../tools/oracle-lab/phase3b-evidence-sufficiency/ledger.js'
import { buildCampaignLedger, crossRepoAuthority } from '../tools/oracle-lab/phase3b-evidence-sufficiency/ledger.js'
import { createRequirementsSignerSession, signEphemeralRecord, signImplementationReviewEphemeral } from '../tools/oracle-lab/phase3b-evidence-sufficiency/ephemeral-signer.js'
import { TARGET_EXECUTABLE_MAXIMUM_BYTES } from '../tools/oracle-lab/phase3b-evidence-sufficiency/launch-image.js'
import { FIXED_LITERAL_TABLE_SHA256, TARGET_PROFILE } from '../tools/oracle-lab/phase3b-evidence-sufficiency/ledger.js'
import { materializeRequestAst, normalizeRequestAst, REQUEST_AST_MATERIALIZER } from '../tools/oracle-lab/phase3b-evidence-sufficiency/receiver.js'
import { buildSandboxProfile } from '../tools/oracle-lab/phase3b-evidence-sufficiency/sandbox-policy.js'
import { GITHUB_WEB_FLOW_FINGERPRINT, GITHUB_WEB_FLOW_PUBLIC_KEY_SHA256, validateAttestationCommit, validateCampaignReviewerRegistry, verifyGithubWebFlowCommit, verifyTrustedSignature, type TrustedReviewer } from '../tools/oracle-lab/phase3b-evidence-sufficiency/trust.js'

const REGISTRY_PATH = 'docs/superpowers/registry/oracle-lab-phase3b-campaign-reviewers.json'
const REVIEW_PATH = 'docs/superpowers/evidence/phase3b/phase3b-implementation-review.json'

function git(repository: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).trim()
}

function reviewer(role: TrustedReviewer['reviewer_role'], identity: string): { entry: TrustedReviewer; privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'] } {
  const pair = generateKeyPairSync('ed25519')
  const der = pair.publicKey.export({ format: 'der', type: 'spki' })
  return {
    entry: { key_id: `sha256:${sha256Bytes(der)}`, public_key_der_base64: der.toString('base64'), reviewer_identity: identity, reviewer_role: role },
    privateKey: pair.privateKey,
  }
}

function signedReview(candidate: { commit: string; tree: string }, requirements: ReturnType<typeof reviewer>, security: ReturnType<typeof reviewer>): Record<string, unknown> {
  const unsigned = {
    schema_id: 'oracle-lab-p3b-implementation-review.v3', review_kind: 'phase3b-production-executor',
    reviewed_candidate_commit: candidate.commit, reviewed_candidate_tree: candidate.tree,
    reviewed_artifact_set_sha256: 'a'.repeat(64), cross_repo_review_sha256: 'b'.repeat(64), requirements_public_entry_sha256: sha256Canonical(requirements.entry),
    critical: 0, important: 0, verdict: 'PASS', created_at_ms: 1, expires_at_ms: 2,
    reviewer_identity: security.entry.reviewer_identity, reviewer_role: security.entry.reviewer_role,
    signing_key_id: security.entry.key_id, signature_algorithm: 'ed25519_canonical_json_v1',
  }
  const signature = sign(null, Buffer.concat([canonicalBytes(unsigned), Buffer.from('\n')]), security.privateKey).toString('base64')
  const signed = { ...unsigned, signature }
  return { ...signed, review_sha256: sha256Canonical(signed) }
}

function approvalFixture(extraPath = false): { repository: string; candidate: { commit: string; tree: string }; requirements: ReturnType<typeof reviewer>; security: ReturnType<typeof reviewer> } {
  const repository = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'p3b-approval-red-')))
  chmodSync(repository, 0o700)
  git(repository, ['init', '-q'])
  writeFileSync(path.join(repository, 'candidate.txt'), 'candidate\n', 'utf8')
  git(repository, ['add', 'candidate.txt'])
  execFileSync('git', ['-C', repository, '-c', 'user.name=Phase3B', '-c', 'user.email=phase3b@example.invalid', 'commit', '-q', '-m', 'candidate'])
  const candidate = { commit: git(repository, ['rev-parse', 'HEAD']), tree: git(repository, ['rev-parse', 'HEAD^{tree}']) }
  const requirements = reviewer('requirements', 'requirements-independent')
  const security = reviewer('security_quality', 'security-independent')
  const registryUnsigned = { schema_id: 'oracle-lab-p3b-campaign-reviewers.v1', reviewed_candidate_commit: candidate.commit, reviewed_candidate_tree: candidate.tree, reviewers: [requirements.entry, security.entry] }
  const registry = { ...registryUnsigned, registry_sha256: sha256Canonical(registryUnsigned) }
  const review = signedReview(candidate, requirements, security)
  mkdirSync(path.join(repository, path.dirname(REGISTRY_PATH)), { recursive: true })
  mkdirSync(path.join(repository, path.dirname(REVIEW_PATH)), { recursive: true })
  writeFileSync(path.join(repository, REGISTRY_PATH), `${canonicalJson(registry)}\n`, 'utf8')
  writeFileSync(path.join(repository, REVIEW_PATH), `${canonicalJson(review)}\n`, 'utf8')
  if (extraPath) writeFileSync(path.join(repository, 'extra.txt'), 'not allowed\n', 'utf8')
  git(repository, ['add', '.'])
  execFileSync('git', ['-C', repository, '-c', 'user.name=Phase3B', '-c', 'user.email=phase3b@example.invalid', 'commit', '-q', '-m', 'approval'])
  return { repository, candidate, requirements, security }
}

test('authority RED: exact candidate parent and two-path approval commit validate', () => {
  const fixture = approvalFixture()
  const approval = validateAttestationCommit(fixture.repository, git(fixture.repository, ['rev-parse', 'HEAD']), fixture.candidate.commit, fixture.candidate.tree)
  assert.equal(approval.reviewed_candidate_commit, fixture.candidate.commit)
  assert.equal(approval.registry.reviewers.length, 2)
})

test('authority RED: official fixed GitHub web-flow key verifies the known signed merge anchor', () => {
  assert.equal(GITHUB_WEB_FLOW_FINGERPRINT, '968479A1AFF927E37D1A566BB5690EEEBB952194')
  assert.equal(GITHUB_WEB_FLOW_PUBLIC_KEY_SHA256, '6e8af687f60cf3f403151c8fb1b26e95e6f9e424ca60cc8f3787bd4466a3ef84')
  assert.doesNotThrow(() => verifyGithubWebFlowCommit(realpathSync(path.join(import.meta.dirname, '..')), '56dc4f86a68157709fb529e9ad64d6386365608a'))
})

test('authority RED: unsigned local approval ancestry cannot substitute for a GitHub merge signature', () => {
  const fixture = approvalFixture()
  assert.throws(() => verifyGithubWebFlowCommit(fixture.repository, git(fixture.repository, ['rev-parse', 'HEAD'])), (error: Error & { code?: string }) => error.code === 'github_approval_signature_invalid')
})

test('authority RED: wrong parent and extra approval paths fail closed', () => {
  const extra = approvalFixture(true)
  assert.throws(() => validateAttestationCommit(extra.repository, git(extra.repository, ['rev-parse', 'HEAD']), extra.candidate.commit, extra.candidate.tree), (error: Error & { code?: string }) => error.code === 'approval_commit_invalid')
  const wrong = approvalFixture()
  assert.throws(() => validateAttestationCommit(wrong.repository, git(wrong.repository, ['rev-parse', 'HEAD']), 'f'.repeat(40), wrong.candidate.tree), (error: Error & { code?: string }) => error.code === 'approval_commit_invalid')
})

test('authority RED: registry rejects same identity, same key, and caller replacement', () => {
  const fixture = approvalFixture()
  const valid = validateAttestationCommit(fixture.repository, git(fixture.repository, ['rev-parse', 'HEAD']), fixture.candidate.commit, fixture.candidate.tree).registry
  const [requirements, security] = valid.reviewers
  for (const reviewers of [
    [requirements, { ...security, reviewer_identity: requirements.reviewer_identity }],
    [requirements, { ...security, key_id: requirements.key_id, public_key_der_base64: requirements.public_key_der_base64 }],
  ]) {
    const unsigned = { schema_id: 'oracle-lab-p3b-campaign-reviewers.v1', reviewed_candidate_commit: fixture.candidate.commit, reviewed_candidate_tree: fixture.candidate.tree, reviewers }
    assert.throws(() => validateCampaignReviewerRegistry({ ...unsigned, registry_sha256: sha256Canonical(unsigned) }), (error: Error & { code?: string }) => error.code === 'trusted_reviewer_registry_invalid')
  }
  writeFileSync(path.join(fixture.repository, REGISTRY_PATH), `${canonicalJson({ ...valid, registry_sha256: 'f'.repeat(64) })}\n`, 'utf8')
  assert.equal(validateAttestationCommit(fixture.repository, git(fixture.repository, ['rev-parse', 'HEAD']), fixture.candidate.commit, fixture.candidate.tree).registry.registry_sha256, valid.registry_sha256)
})

test('authority RED: approval validation reads committed blobs despite assume-unchanged worktree replacement', () => {
  const fixture = approvalFixture()
  const attestation = git(fixture.repository, ['rev-parse', 'HEAD'])
  const committed = validateAttestationCommit(fixture.repository, attestation, fixture.candidate.commit, fixture.candidate.tree)
  git(fixture.repository, ['update-index', '--assume-unchanged', REGISTRY_PATH, REVIEW_PATH])
  const replacementRequirements = reviewer('requirements', 'replacement-requirements')
  const replacementSecurity = reviewer('security_quality', 'replacement-security')
  const registryUnsigned = { schema_id: 'oracle-lab-p3b-campaign-reviewers.v1', reviewed_candidate_commit: fixture.candidate.commit, reviewed_candidate_tree: fixture.candidate.tree, reviewers: [replacementRequirements.entry, replacementSecurity.entry] }
  const replacementRegistry = { ...registryUnsigned, registry_sha256: sha256Canonical(registryUnsigned) }
  writeFileSync(path.join(fixture.repository, REGISTRY_PATH), `${canonicalJson(replacementRegistry)}\n`, 'utf8')
  writeFileSync(path.join(fixture.repository, REVIEW_PATH), `${canonicalJson(signedReview(fixture.candidate, fixture.requirements, replacementSecurity))}\n`, 'utf8')
  assert.equal(git(fixture.repository, ['status', '--porcelain=v1', '--untracked-files=normal']), '')
  const validated = validateAttestationCommit(fixture.repository, attestation, fixture.candidate.commit, fixture.candidate.tree)
  assert.equal(validated.registry_sha256, committed.registry_sha256)
  assert.equal(validated.registry.reviewers[1]?.key_id, committed.registry.reviewers[1]?.key_id)
})

test('authority RED: approval topology and blobs ignore caller-controlled Git replace refs', () => {
  const fixture = approvalFixture()
  const attestation = git(fixture.repository, ['rev-parse', 'HEAD'])
  git(fixture.repository, ['switch', '-q', '-c', 'replacement', fixture.candidate.commit])
  writeFileSync(path.join(fixture.repository, 'replacement.txt'), 'replacement\n', 'utf8')
  git(fixture.repository, ['add', 'replacement.txt'])
  execFileSync('/usr/bin/git', ['-C', fixture.repository, '-c', 'user.name=Phase3B', '-c', 'user.email=phase3b@example.invalid', 'commit', '-q', '-m', 'replacement'])
  const replacement = git(fixture.repository, ['rev-parse', 'HEAD'])
  git(fixture.repository, ['replace', attestation, replacement])
  git(fixture.repository, ['switch', '-q', '-'])
  const validated = validateAttestationCommit(fixture.repository, attestation, fixture.candidate.commit, fixture.candidate.tree)
  assert.equal(validated.attestation_commit, attestation)
  assert.equal(validated.registry.reviewed_candidate_commit, fixture.candidate.commit)
})

test('authority RED: canonical SPKI rejects trailing DER aliases of the same Ed25519 key', () => {
  const pair = generateKeyPairSync('ed25519')
  const canonical = pair.publicKey.export({ format: 'der', type: 'spki' })
  const trailing = Buffer.concat([canonical, Buffer.from([0])])
  const reviewers = [
    { key_id: `sha256:${sha256Bytes(canonical)}`, public_key_der_base64: canonical.toString('base64'), reviewer_identity: 'requirements-canonical', reviewer_role: 'requirements' },
    { key_id: `sha256:${sha256Bytes(trailing)}`, public_key_der_base64: trailing.toString('base64'), reviewer_identity: 'security-alias', reviewer_role: 'security_quality' },
  ]
  const unsigned = { schema_id: 'oracle-lab-p3b-campaign-reviewers.v1', reviewed_candidate_commit: 'a'.repeat(40), reviewed_candidate_tree: 'b'.repeat(40), reviewers }
  assert.throws(() => validateCampaignReviewerRegistry({ ...unsigned, registry_sha256: sha256Canonical(unsigned) }), (error: Error & { code?: string }) => error.code === 'trusted_reviewer_registry_invalid')
})

test('authority RED: unsigned and tampered review signatures cannot pass', () => {
  const fixture = approvalFixture()
  const approval = validateAttestationCommit(fixture.repository, git(fixture.repository, ['rev-parse', 'HEAD']), fixture.candidate.commit, fixture.candidate.tree)
  assert.doesNotThrow(() => verifyTrustedSignature(approval.implementation_review as Record<string, unknown>, approval.registry, 'security_quality', 'review_sha256', 'implementation_review_failed'))
  assert.throws(() => verifyTrustedSignature({ ...approval.implementation_review, critical: 1 }, approval.registry, 'security_quality', 'review_sha256', 'implementation_review_failed'), (error: Error & { code?: string }) => error.code === 'implementation_review_failed')
  assert.throws(() => verifyTrustedSignature({ ...approval.implementation_review, signature: '' }, approval.registry, 'security_quality', 'review_sha256', 'implementation_review_failed'), (error: Error & { code?: string }) => error.code === 'implementation_review_failed')
})

test('authority RED: C1 authority is derived from actual canonical raw bytes, never the lost digest', () => {
  assert.deepEqual(CROSS_REPO_AUTHORITY, { verdict: 'CROSS_REPO_PASS' })
  const record = { schema_id: 'oracle.cross_repo_record', review: { cross: { task_id: 'fresh-c1-review', model: 'gpt-5.6-sol', artifact_sha256: 'd'.repeat(64), critical: 0, important: 0, verdict: 'CROSS_REPO_PASS' } } }
  const raw = Buffer.from(`${canonicalJson(record)}\n`, 'utf8')
  assert.deepEqual(bindMaterializedCrossRepoAuthority(raw), { verdict: 'CROSS_REPO_PASS', review_sha256: sha256Bytes(raw) })
})

test('authority GREEN: materialized ES7 and ES9 contracts bind the dynamic C1 ledger', () => {
  const c1 = sha256Bytes(Buffer.from('fresh-c1'))
  const ledger = buildCampaignLedger('p3b-materializer-contracts', crossRepoAuthority(c1))
  assert.doesNotThrow(() => validateTypedFixtureContract(buildEs7TypedFixtureContract(ledger.campaign_id, c1) as Record<string, unknown>, ledger))
  assert.doesNotThrow(() => validateCoverageContract(buildEs9CoverageContract(ledger) as Record<string, unknown>, ledger))
})

test('authority RED: target ceiling admits the exact fixed 247124336-byte executable', () => {
  assert.equal(TARGET_PROFILE.entrypoint_size, 247_124_336)
  assert.ok(TARGET_EXECUTABLE_MAXIMUM_BYTES >= TARGET_PROFILE.entrypoint_size)
})

test('authority RED: ES7 contains literal-bound executable round-trip fixtures', () => {
  const c1 = sha256Bytes(Buffer.from('fresh-es7-c1'))
  const ledger = buildCampaignLedger('p3b-es7-round-trip', crossRepoAuthority(c1))
  const contract = buildEs7TypedFixtureContract(ledger.campaign_id, c1) as Record<string, any>
  assert.equal(contract.literal_table_sha256, FIXED_LITERAL_TABLE_SHA256)
  assert.deepEqual(contract.materializer, { algorithm: REQUEST_AST_MATERIALIZER, ast_encoding: 'canonical-json-utf8-lf-v1', normalized_encoding: 'canonical-json-utf8-lf-v1', raw_persistence: false, round_trip: 'receiver-capture-verified-normalized' })
  assert.equal(contract.rows.length, 340)
  assert.match(contract.rows[0].request_source_sha256, /^[a-f0-9]{64}$/)
  assert.match(contract.rows[0].response_source_sha256, /^[a-f0-9]{64}$/)
  assert.ok(Number.isSafeInteger(contract.rows[0].request_source_byte_length) && contract.rows[0].request_source_byte_length > 0)
  assert.ok(Number.isSafeInteger(contract.rows[0].response_source_byte_length) && contract.rows[0].response_source_byte_length > 0)
  assert.doesNotThrow(() => validateTypedFixtureContract(contract, ledger))
  const tamperedUnsigned: Record<string, any> = { ...contract, literal_table_sha256: 'f'.repeat(64) }
  delete tamperedUnsigned.contract_sha256
  assert.throws(() => validateTypedFixtureContract({ ...tamperedUnsigned, contract_sha256: sha256Canonical(tamperedUnsigned) }, ledger))
})

test('authority RED: persisted request AST is normalized-safe and contains no raw or encoded secret bytes', () => {
  const marker = 'sk-SECRET12345678'
  const wire = Buffer.from(`{"model":"claude-sonnet-4-6","messages":[{"role":"user","content":"Return exactly the synthetic marker output.complete."}],"stream":true,"max_tokens":17,"description":"${marker}"}`, 'utf8')
  const ast = normalizeRequestAst(wire) as Record<string, unknown>
  assert.equal(ast.materializer, REQUEST_AST_MATERIALIZER)
  const persisted = canonicalJson(ast)
  assert.equal(persisted.includes(marker), false)
  assert.equal(persisted.includes(Buffer.from(wire).toString('base64')), false)
  assert.equal(Object.hasOwn(ast, 'wire_bytes_base64'), false)
  assert.match(persisted, /synthetic-literals\/request_model_v1/)
  const normalized = materializeRequestAst(ast)
  assert.equal(normalized.includes(Buffer.from(marker)), false)
  const tampered = JSON.parse(JSON.stringify(ast)) as Record<string, any>
  const rootFields = tampered.value.fields as Array<Record<string, any>>
  const redacted = rootFields.find((field) => field.field_ref === 'field_13')!.value
  redacted.byte_length += 1
  tampered.normalized_byte_length = 0
  tampered.normalized_sha256 = '0'.repeat(64)
  assert.throws(() => materializeRequestAst(tampered), (error: Error & { code?: string }) => error.code === 'receiver_request_invalid')
})

test('authority RED: typed request schema rejects sensitive field names and response-only literals', () => {
  const sensitiveKey = Buffer.from('{"model":"claude-sonnet-4-6","messages":[],"secret":"safe"}', 'utf8')
  assert.throws(() => normalizeRequestAst(sensitiveKey), (error: Error & { code?: string }) => error.code === 'receiver_request_invalid')
  const responseLiteral = Buffer.from('{"model":"model.test","messages":[],"stream":true}', 'utf8')
  assert.throws(() => normalizeRequestAst(responseLiteral), (error: Error & { code?: string }) => error.code === 'receiver_request_invalid')
  const forged = { schema_id: 'oracle-lab-p3b-request-ast.v3', materializer: REQUEST_AST_MATERIALIZER, literal_table_sha256: FIXED_LITERAL_TABLE_SHA256, wire_byte_length: 1, wire_sha256: 'a'.repeat(64), normalized_byte_length: 1, normalized_sha256: 'b'.repeat(64), value: { type: 'redacted_string', byte_length: 999, value_sha256: 'c'.repeat(64) } }
  assert.throws(() => materializeRequestAst(forged), (error: Error & { code?: string }) => error.code === 'receiver_request_invalid')
})

test('authority RED: normative provenance and sealed Gate B cannot use synthetic fallback or self-hashed clock output', () => {
  const closeout = readFileSync(path.join(realpathSync(path.join(import.meta.dirname, '..')), 'tools/oracle-lab/phase3b-evidence-sufficiency/closeout.ts'), 'utf8')
  const gates = readFileSync(path.join(realpathSync(path.join(import.meta.dirname, '..')), 'tools/oracle-lab/phase3b-evidence-sufficiency/gates.ts'), 'utf8')
  assert.doesNotMatch(closeout, /return \{ derived_from: 'sealed_source_and_observations'/)
  assert.match(closeout, /source_value_sha256/)
  assert.match(gates, /validateCurationClock\(/)
  assert.match(gates, /verifyTrustedSignature\(/)
  assert.match(gates, /validateConclusionSupport\(/)
})

test('authority RED: sandbox defaults deny host reads and process inspection', () => {
  const profile = buildSandboxProfile('/private/tmp/p3b-runtime', '/private/tmp/p3b-runtime/run', [43123])
  assert.match(profile, /\(deny default\)/)
  assert.doesNotMatch(profile, /\(allow default\)/)
  assert.match(profile, /deny process-info/)
  assert.match(profile, /deny file-read.*\.ssh/)
  assert.match(profile, /deny file-read.*\.claude/)
})

test('authority RED: ES9 is the exhaustive normative E/C/D matrix, not a caller-sized set', () => {
  const c1 = sha256Bytes(Buffer.from('fresh-es9-c1'))
  const ledger = buildCampaignLedger('p3b-es9-normative', crossRepoAuthority(c1))
  const contract = buildEs9CoverageContract(ledger) as Record<string, any>
  assert.equal(contract.normative_row_count, 26)
  assert.equal(contract.normative_leaf_count, 152)
  assert.equal(contract.normative_e_rows.length, 20)
  assert.equal(contract.normative_c_rows.length, 3)
  assert.equal(contract.normative_d_rows.length, 3)
  assert.ok([...contract.normative_e_rows, ...contract.normative_c_rows, ...contract.normative_d_rows].every((row: Record<string, unknown>) => !Object.hasOwn(row, 'source_bytes_base64') && !Object.hasOwn(row, 'source_sha256')))
  assert.equal(contract.observation_enabled_sources.length, 340 * (ES7_REQUEST_FIELDS.length + ES7_RESPONSE_FIELDS.length))
  assert.equal(contract.observation_disabled_exclusions.length, 340 * 2)
  for (const entry of [...contract.observation_enabled_sources, ...contract.observation_disabled_exclusions]) {
    assert.match(entry.source_pointer, /^\/rows\/\d+\/(request_stimulus|response_program)\//)
    assert.match(entry.source_sha256, /^[a-f0-9]{64}$/)
  }
  const subsetUnsigned: Record<string, unknown> = { ...contract, normative_e_rows: contract.normative_e_rows.slice(1) }
  delete subsetUnsigned.contract_sha256
  assert.throws(() => validateCoverageContract({ ...subsetUnsigned, contract_sha256: sha256Canonical(subsetUnsigned) }, ledger))
  assert.doesNotThrow(() => validateCoverageContract(contract, ledger))
})

test('authority GREEN: materializer CLI rejects caller-selected flags before side effects', () => {
  assert.throws(() => materializerMain([]), (error: Error & { code?: string }) => error.code === 'authority_materializer_cli_invalid')
  assert.throws(() => materializerMain(['--input', 'relative.json']), (error: Error & { code?: string }) => error.code === 'authority_materializer_cli_invalid')
})

test('authority GREEN: ephemeral signer returns only public material and distinct role keys', () => {
  const security = signEphemeralRecord({ role: 'security_quality', identity: 'security-fresh-context', digest_field: 'review_sha256', payload: { schema_id: 'review.v1', verdict: 'PASS' } })
  const requirements = createRequirementsSignerSession({ identity: 'requirements-fresh-context', reviewed_candidate_commit: 'a'.repeat(40), reviewed_candidate_tree: 'b'.repeat(40) })
  assert.notEqual(security.public_entry.key_id, requirements.public_entry.key_id)
  assert.notEqual(security.public_entry.reviewer_identity, requirements.public_entry.reviewer_identity)
  assert.equal(JSON.stringify([security, requirements.public_entry]).includes('private'), false)
  const registry = requirements.bind_security_reviewer(security.public_entry)
  assert.doesNotThrow(() => verifyTrustedSignature(security.signed_record as Record<string, unknown>, registry, 'security_quality', 'review_sha256', 'implementation_review_failed'))
  assert.throws(() => signEphemeralRecord({ role: 'requirements', identity: 'requirements-forbidden', digest_field: 'authority_sha256', payload: { schema_id: 'authority.v1' } }), (error: Error & { code?: string }) => error.code === 'ephemeral_signer_input_invalid')
  requirements.close()
})

test('authority GREEN: independent in-memory signers bind exact input, review, registry, and reject tampering', () => {
  const digestFields = ['cross_review_artifact_sha256', 'cross_repo_review_sha256', 'probe_source_sha256', 'probe_unsigned_source_sha256', 'original_recipe_sha256', 'probe_recipe_sha256', 'source_tree_sha256', 'toolchain_sha256', 'schema_bundle_sha256', 'focused_suite_sha256', 'es7_typed_fixtures_sha256', 'es8_go_receipt_sha256', 'es8_ts_c1_agreement_sha256', 'es9_coverage_contract_sha256']
  const inputUnsigned: Record<string, unknown> = { schema_id: 'oracle-lab-p3b-production-input.v2', campaign_id: 'p3b-signer-test', cc_repository: '/tmp/cc' }
  digestFields.forEach((field, index) => { inputUnsigned[field] = index.toString(16).padStart(64, '0') })
  const campaignInput: Record<string, unknown> = { ...inputUnsigned, input_sha256: sha256Canonical(inputUnsigned) }
  const candidate = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) }
  const requirements = createRequirementsSignerSession({ identity: 'requirements-isolated-context', reviewed_candidate_commit: candidate.commit, reviewed_candidate_tree: candidate.tree })
  assert.throws(() => signImplementationReviewEphemeral({ identity: requirements.public_entry.reviewer_identity, requirements_public_entry: requirements.public_entry, campaign_input: campaignInput, reviewed_candidate_commit: candidate.commit, reviewed_candidate_tree: candidate.tree, created_at_ms: 10, expires_at_ms: 20 }), (error: Error & { code?: string }) => error.code === 'ephemeral_signer_input_invalid')
  const security = signImplementationReviewEphemeral({ identity: 'security-isolated-context', requirements_public_entry: requirements.public_entry, campaign_input: campaignInput, reviewed_candidate_commit: candidate.commit, reviewed_candidate_tree: candidate.tree, created_at_ms: 10, expires_at_ms: 20 })
  const registry = requirements.bind_security_reviewer(security.public_entry)
  const authority = requirements.sign_operator_authority({ campaign_input: campaignInput, signed_implementation_review: security.signed_record, approval_commit: 'c'.repeat(40), approval_tree: 'd'.repeat(40), attestation_commit: 'e'.repeat(40), attestation_tree: 'f'.repeat(40), created_at_ms: 11, expires_at_ms: 21 })
  assert.notEqual(requirements.public_entry.key_id, security.public_entry.key_id)
  assert.doesNotThrow(() => verifyTrustedSignature(security.signed_record as Record<string, unknown>, registry, 'security_quality', 'review_sha256', 'implementation_review_failed'))
  assert.doesNotThrow(() => verifyTrustedSignature(authority.signed_authority as Record<string, unknown>, registry, 'requirements', 'authority_sha256', 'operator_authority_invalid'))
  const tampered = createRequirementsSignerSession({ identity: 'requirements-isolated-context-2', reviewed_candidate_commit: candidate.commit, reviewed_candidate_tree: candidate.tree })
  tampered.bind_security_reviewer(security.public_entry)
  assert.throws(() => tampered.sign_operator_authority({ campaign_input: campaignInput, signed_implementation_review: { ...security.signed_record, reviewed_candidate_tree: 'c'.repeat(40) }, approval_commit: 'c'.repeat(40), approval_tree: 'd'.repeat(40), attestation_commit: 'e'.repeat(40), attestation_tree: 'f'.repeat(40), created_at_ms: 11, expires_at_ms: 21 }), (error: Error & { code?: string }) => error.code === 'ephemeral_signer_input_invalid' || error.code === 'implementation_review_failed')
  requirements.close(); tampered.close()
})

test('authority RED: requirements signer session retains one key for launch authority and later Gate B decision', () => {
  const digestFields = ['cross_review_artifact_sha256', 'cross_repo_review_sha256', 'probe_source_sha256', 'probe_unsigned_source_sha256', 'original_recipe_sha256', 'probe_recipe_sha256', 'source_tree_sha256', 'toolchain_sha256', 'schema_bundle_sha256', 'focused_suite_sha256', 'es7_typed_fixtures_sha256', 'es8_go_receipt_sha256', 'es8_ts_c1_agreement_sha256', 'es9_coverage_contract_sha256']
  const inputUnsigned: Record<string, unknown> = { schema_id: 'oracle-lab-p3b-production-input.v2', campaign_id: 'p3b-session-test', cc_repository: '/tmp/cc' }
  digestFields.forEach((field, index) => { inputUnsigned[field] = (index + 1).toString(16).padStart(64, '0') })
  const campaignInput: Record<string, unknown> = { ...inputUnsigned, input_sha256: sha256Canonical(inputUnsigned) }
  const session = createRequirementsSignerSession({ identity: 'requirements-session-context', reviewed_candidate_commit: 'a'.repeat(40), reviewed_candidate_tree: 'b'.repeat(40) })
  const security = signImplementationReviewEphemeral({ identity: 'security-session-context', requirements_public_entry: session.public_entry, campaign_input: campaignInput, reviewed_candidate_commit: 'a'.repeat(40), reviewed_candidate_tree: 'b'.repeat(40), created_at_ms: 10, expires_at_ms: 20 })
  const registry = session.bind_security_reviewer(security.public_entry)
  session.sign_operator_authority({ campaign_input: campaignInput, signed_implementation_review: security.signed_record, approval_commit: 'c'.repeat(40), approval_tree: 'd'.repeat(40), attestation_commit: 'e'.repeat(40), attestation_tree: 'f'.repeat(40), created_at_ms: 11, expires_at_ms: 21 })
  const reviewRawSha256 = sha256Bytes(Buffer.concat([canonicalBytes(security.signed_record), Buffer.from('\n')]))
  const decision = session.sign_gate_b_decision({ schema_id: 'oracle-lab-p3b-operator-decision.v2', decision_id: 'decision-session-test', decision: 'evaluate_successor_amendment_startable', campaign_id: String(campaignInput.campaign_id), gate_a_path: 'capsules/P3B-ES1/gates/gate-a-result.json', gate_a_sha256: '1'.repeat(64), gate_a_clock_sha256: '2'.repeat(64), external_set_path: 'capsules/P3B-ES1/closure/external-digest-set.json', external_set_sha256: '3'.repeat(64), conclusion_paths: [], conclusion_sha256s: [], implementation_review_sha256: reviewRawSha256, issued_at_ms: 12, issued_monotonic_ns: '13', maximum_evaluation_delay_ms: 300000, scope: 'successor-amendment-only', prohibited_claims: [] })
  assert.equal(decision.signing_key_id, session.public_entry.key_id)
  assert.doesNotThrow(() => verifyTrustedSignature(decision as Record<string, unknown>, registry, 'requirements', 'decision_sha256', 'operator_decision_invalid'))
  const resultUnsigned = { schema_id: 'oracle-lab-p3b-gate-result.v1', gate: 'B', decision: 'PASS', campaign_id: String(campaignInput.campaign_id), gate_a_sha256: '1'.repeat(64), external_set_sha256: '3'.repeat(64), operator_decision_sha256: decision.decision_sha256, conclusion_sha256s: [], gate_clock_sha256: '4'.repeat(64), phase3b_usable: true }
  assert.throws(() => session.confirm_gate_b_result({ ...resultUnsigned, gate_result_sha256: sha256Canonical(resultUnsigned) }), (error: Error & { code?: string }) => error.code === 'ephemeral_signer_input_invalid')
  assert.throws(() => session.sign_gate_b_decision({}), (error: Error & { code?: string }) => error.code === 'ephemeral_signer_lifecycle_invalid')
  session.close()
})

test('authority GREEN: long-lived signer CLI emits only public material and closes without key persistence', async () => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'tools/oracle-lab/phase3b-evidence-sufficiency/requirements-signer-session-cli.ts', '--identity', 'requirements-cli-context', '--candidate-commit', 'a'.repeat(40), '--candidate-tree', 'b'.repeat(40)], { cwd: realpathSync(path.join(import.meta.dirname, '..')), stdio: ['pipe', 'pipe', 'pipe'] })
  const firstLine = await new Promise<string>((resolve, reject) => {
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
      const newline = output.indexOf('\n')
      if (newline !== -1) resolve(output.slice(0, newline))
    })
    child.once('error', reject)
  })
  const publicRecord = JSON.parse(firstLine) as Record<string, unknown>
  assert.equal(publicRecord.event, 'public_entry')
  assert.equal(JSON.stringify(publicRecord).includes('private'), false)
  child.stdin.end(`${canonicalJson({ action: 'close' })}\n`)
  const exitCode = await new Promise<number | null>((resolve) => child.once('exit', resolve))
  assert.equal(exitCode, 0)
})

test('authority RED: probe recipe rebuilds signed output from the unsigned input', () => {
  const recipe = launchRecipe('probe', 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64), 'e'.repeat(64)) as Record<string, any>
  assert.deepEqual(recipe.build_command, [
    ['/bin/cp', '$UNSIGNED_SOURCE', '$OUTPUT'],
    ['/usr/bin/codesign', '--force', '--sign', '-', '--identifier', '$CODE_SIGNATURE_IDENTIFIER', '--timestamp=none', '$OUTPUT'],
  ])
  assert.equal(recipe.rebuild_verified, true)
  assert.equal(recipe.rebuilt_post_sign_sha256, recipe.post_sign_sha256)
})

test('authority GREEN: synthetic Mach-O probe is actually rebuilt and toolchain-pinned', () => {
  const inputRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'p3b-probe-input-')))
  const outputRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'p3b-probe-output-')))
  chmodSync(inputRoot, 0o700); chmodSync(outputRoot, 0o700)
  const unsigned = path.join(inputRoot, 'probe-unsigned')
  const reviewed = path.join(inputRoot, 'probe-reviewed')
  copyFileSync('/usr/bin/true', unsigned); chmodSync(unsigned, 0o700)
  execFileSync('/usr/bin/codesign', ['--remove-signature', unsigned])
  copyFileSync(unsigned, reviewed); chmodSync(reviewed, 0o700)
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', reviewed])
  const rebuilt = rebuildProbe(outputRoot, unsigned, reviewed)
  assert.equal(rebuilt.rebuilt.sha256, sha256Bytes(readFileSync(reviewed)))
  assert.equal(rebuilt.unsigned.sha256, sha256Bytes(readFileSync(unsigned)))
  const signedAsUnsignedRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'p3b-probe-signed-input-')))
  chmodSync(signedAsUnsignedRoot, 0o700)
  assert.throws(() => rebuildProbe(signedAsUnsignedRoot, reviewed, reviewed), (error: Error & { code?: string }) => error.code === 'authority_materialization_invalid')

  const version = spawnSync('/usr/bin/codesign', ['--version'], { encoding: 'utf8' })
  const versionOutput = `${version.stdout}${version.stderr}`.trim()
  const codesign = { name: 'codesign', status: 'available', executable_path: '/usr/bin/codesign', executable_sha256: sha256Bytes(readFileSync('/usr/bin/codesign')), version_output_sha256: sha256Bytes(Buffer.from(versionOutput, 'utf8')), version_first_line: versionOutput.split(/\r?\n/, 1)[0], probe_exit_code: version.status, fallback: 'none' }
  const toolchainUnsigned = { schema_version: 'oracle-lab-phase3a-toolchain.v1', records: [codesign] }
  const toolchain = { ...toolchainUnsigned, digest: sha256Bytes(canonicalBytes(toolchainUnsigned)) }
  const toolchainPath = path.join(inputRoot, 'toolchain.json')
  writeFileSync(toolchainPath, `${canonicalJson(toolchain)}\n`, { mode: 0o600 })
  assert.doesNotThrow(() => validateCodesignToolchain(toolchainPath))
  const driftedCodesign = { ...codesign, version_output_sha256: '0'.repeat(64) }
  const driftedUnsigned = { schema_version: 'oracle-lab-phase3a-toolchain.v1', records: [driftedCodesign] }
  writeFileSync(toolchainPath, `${canonicalJson({ ...driftedUnsigned, digest: sha256Bytes(canonicalBytes(driftedUnsigned)) })}\n`, { mode: 0o600 })
  assert.throws(() => validateCodesignToolchain(toolchainPath), (error: Error & { code?: string }) => error.code === 'authority_materialization_invalid')
})
