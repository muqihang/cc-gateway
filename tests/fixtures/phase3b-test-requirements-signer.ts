#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { CONCLUSION_IDS, CONCLUSION_PATHS, validatePostGateLeakReport } from '../../tools/oracle-lab/phase3b-evidence-sufficiency/closeout.js'
import { canonicalBytes, canonicalJson, sha256Bytes, sha256Canonical } from '../../tools/oracle-lab/phase3b-evidence-sufficiency/core.js'
import { evaluateGateA, GATE_B_SCOPE, OPERATOR_MAX_DELAY_MS, validateSealedGateBResult } from '../../tools/oracle-lab/phase3b-evidence-sufficiency/gates.js'
import { REPOSITORY_AUTHORITY, crossRepoAuthority } from '../../tools/oracle-lab/phase3b-evidence-sufficiency/ledger.js'
import { readCanonical, stableRead } from '../../tools/oracle-lab/phase3b-evidence-sufficiency/sealed-fs.js'
import { controllerExecutableSha256, controllerSourceSetSha256 } from '../../tools/oracle-lab/phase3b-evidence-sufficiency/source-identity.js'
import { CAMPAIGN_REVIEWER_REGISTRY_RELATIVE, IMPLEMENTATION_REVIEW_RELATIVE, validateCampaignReviewerRegistry, verifyTrustedSignature, type TrustedReviewer } from '../../tools/oracle-lab/phase3b-evidence-sufficiency/trust.js'

const PROHIBITED = ['production_ready', 'real_upstream_validated', 'real_credentials_validated', 'resume_supported', 'cross_platform_validated'] as const

function writeCanonical(file: string, value: unknown): string {
  writeFileSync(file, `${canonicalJson(value)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  return stableRead(file, { mode: 0o600, maximumBytes: 16_777_216 }).identity.sha256
}

function externalCanonical(file: string): Record<string, unknown> {
  const record = stableRead(file, { mode: 0o600, maximumBytes: 16_777_216 })
  if (record.bytes.at(-1) !== 0x0a) throw new Error(`noncanonical external artifact: ${path.basename(file)}`)
  const value = JSON.parse(record.bytes.subarray(0, -1).toString('utf8')) as Record<string, unknown>
  if (!canonicalBytes(value).equals(record.bytes.subarray(0, -1))) throw new Error(`noncanonical JSON: ${path.basename(file)}`)
  return value
}

async function waitFor(file: string, timeoutMs = 2_700_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { return externalCanonical(file) } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for ${path.basename(file)}`)
}

function git(repository: string, args: readonly string[]): string {
  return execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '--no-replace-objects', '-C', repository, ...args], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_NO_REPLACE_OBJECTS: '1' } }).trim()
}

function signedRecord(payload: Record<string, unknown>, digestField: string, publicEntry: TrustedReviewer, privateKey: KeyObject): Record<string, unknown> {
  const unsigned = { ...payload, reviewer_identity: publicEntry.reviewer_identity, reviewer_role: publicEntry.reviewer_role, signing_key_id: publicEntry.key_id, signature_algorithm: 'ed25519_canonical_json_v1' }
  const signature = sign(null, Buffer.concat([canonicalBytes(unsigned), Buffer.from('\n', 'utf8')]), privateKey).toString('base64')
  const signed = { ...unsigned, signature }
  return { ...signed, [digestField]: sha256Canonical(signed) }
}

function createRegistryRepository(root: string, registry: Record<string, unknown>, review: Record<string, unknown>): Readonly<{ repository: string; commit: string; tree: string; registry_raw_sha256: string; review_raw_sha256: string }> {
  const repository = path.join(root, 'phase3b-test-registry.git-worktree')
  mkdirSync(repository, { mode: 0o700 })
  execFileSync('/usr/bin/git', ['init', '-q', repository], { env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' } })
  git(repository, ['config', 'user.name', 'Phase3B Test Requirements Signer'])
  git(repository, ['config', 'user.email', 'phase3b-test-requirements@example.invalid'])
  const registryPath = path.join(repository, CAMPAIGN_REVIEWER_REGISTRY_RELATIVE)
  const reviewPath = path.join(repository, IMPLEMENTATION_REVIEW_RELATIVE)
  mkdirSync(path.dirname(registryPath), { recursive: true, mode: 0o700 })
  mkdirSync(path.dirname(reviewPath), { recursive: true, mode: 0o700 })
  const registryRawSha256 = writeCanonical(registryPath, registry)
  const reviewRawSha256 = writeCanonical(reviewPath, review)
  git(repository, ['add', '--', CAMPAIGN_REVIEWER_REGISTRY_RELATIVE, IMPLEMENTATION_REVIEW_RELATIVE])
  git(repository, ['commit', '-q', '-m', 'test: bind phase3b independent authority'])
  return { repository: realpathSync(repository), commit: git(repository, ['rev-parse', 'HEAD']), tree: git(repository, ['rev-parse', 'HEAD^{tree}']), registry_raw_sha256: registryRawSha256, review_raw_sha256: reviewRawSha256 }
}

async function main(): Promise<void> {
  if (process.argv.length !== 6) throw new Error('usage: requirements-signer MATERIALIZED SECURITY_ROOT FIXTURE_ROOT EVIDENCE_ROOT')
  const materializedPath = realpathSync(process.argv[2])
  const securityRoot = realpathSync(process.argv[3])
  const fixtureRoot = realpathSync(process.argv[4])
  const evidenceRoot = realpathSync(process.argv[5])
  chmodSync(fixtureRoot, 0o700)
  const materialized = externalCanonical(materializedPath)
  const { publicKey, privateKey: generatedPrivateKey } = generateKeyPairSync('ed25519')
  let privateKey: KeyObject | null = generatedPrivateKey
  const publicDer = publicKey.export({ format: 'der', type: 'spki' })
  const publicEntry: TrustedReviewer = { key_id: `sha256:${sha256Bytes(publicDer)}`, public_key_der_base64: publicDer.toString('base64'), reviewer_identity: 'phase3b-test-requirements-signer', reviewer_role: 'requirements' }
  const requirementsPublicPath = path.join(fixtureRoot, 'phase3b-test-requirements-public-entry.json')
  writeCanonical(requirementsPublicPath, publicEntry)

  const securityPublicPath = path.join(securityRoot, 'phase3b-test-security-public-entry.json')
  const reviewExternalPath = path.join(securityRoot, 'phase3b-test-implementation-review.json')
  const securityPublic = await waitFor(securityPublicPath) as TrustedReviewer
  const review = await waitFor(reviewExternalPath)
  const registryUnsigned = { schema_id: 'oracle-lab-p3b-campaign-reviewers.v1', reviewed_candidate_commit: materialized.reviewed_candidate_commit, reviewed_candidate_tree: materialized.reviewed_candidate_tree, reviewers: [publicEntry, securityPublic] }
  const registry = validateCampaignReviewerRegistry({ ...registryUnsigned, registry_sha256: sha256Canonical(registryUnsigned) })
  verifyTrustedSignature(review, registry, 'security_quality', 'review_sha256', 'implementation_review_failed')
  if (review.requirements_public_entry_sha256 !== sha256Canonical(publicEntry) || review.materialized_authority_sha256 !== stableRead(materializedPath, { mode: 0o600, maximumBytes: 16_777_216 }).identity.sha256 || review.controller_source_sha256 !== controllerSourceSetSha256() || review.controller_executable_sha256 !== controllerExecutableSha256() || review.critical !== 0 || review.important !== 0 || review.verdict !== 'PASS') throw new Error('security review does not bind exact materialized/source bytes')
  const gitAuthority = createRegistryRepository(fixtureRoot, registry, review)

  const campaignInputPath = path.join(fixtureRoot, 'phase3b-test-campaign-input.json')
  const authorityPath = path.join(fixtureRoot, 'phase3b-test-authority-manifest.json')
  const decisionPath = path.join(fixtureRoot, 'phase3b-successor-amendment-decision.json')
  const closurePath = path.join(fixtureRoot, 'phase3b-requirements-signer-closure.json')
  const inputUnsigned = {
    schema_id: 'oracle-lab-p3b-test-production-input.v1', campaign_id: materialized.campaign_id, campaign_input_path: campaignInputPath, operator_authority_path: authorityPath, evidence_root: evidenceRoot,
    cc_repository: materialized.cc_repository, sub_repository: materialized.sub_repository, cross_review_task_id: 'phase3b-real-controller-test-review', cross_review_artifact_path: materialized.cross_review_path, cross_review_artifact_sha256: materialized.cross_review_sha256,
    cross_repo_review_path: materialized.c1_path, cross_repo_review_sha256: materialized.c1_sha256, original_source: materialized.original_source, probe_source: materialized.probe_source, probe_source_sha256: materialized.probe_source_sha256, probe_unsigned_source: materialized.probe_unsigned_source, probe_unsigned_source_sha256: materialized.probe_unsigned_source_sha256,
    original_recipe: materialized.original_recipe, original_recipe_sha256: materialized.original_recipe_sha256, probe_recipe: materialized.probe_recipe, probe_recipe_sha256: materialized.probe_recipe_sha256,
    platform_archive_path: materialized.platform_archive_path, platform_archive_sha256: materialized.platform_archive_sha256, source_tree_path: materialized.source_tree_path, source_tree_sha256: materialized.source_tree_sha256, toolchain_path: materialized.toolchain_path, toolchain_sha256: materialized.toolchain_sha256,
    schema_bundle_path: materialized.schema_bundle_path, schema_bundle_sha256: materialized.schema_bundle_sha256, focused_suite_path: materialized.focused_suite_path, focused_suite_sha256: materialized.focused_suite_sha256,
    es7_typed_fixtures_path: materialized.es7_path, es7_typed_fixtures_sha256: materialized.es7_sha256, es8_go_receipt_path: materialized.es8_go_path, es8_go_receipt_sha256: materialized.es8_go_sha256, es8_ts_c1_agreement_path: materialized.es8_ts_path, es8_ts_c1_agreement_sha256: materialized.es8_ts_sha256, es9_coverage_contract_path: materialized.es9_path, es9_coverage_contract_sha256: materialized.es9_sha256,
    predecessor_config_auth_path: materialized.predecessor_config_auth_path, predecessor_failure_stream_path: materialized.predecessor_failure_stream_path, target_profile: materialized.target_profile,
    controller_source_sha256: controllerSourceSetSha256(), controller_executable_sha256: controllerExecutableSha256(), materialized_authority_path: materializedPath, materialized_authority_sha256: stableRead(materializedPath, { mode: 0o600, maximumBytes: 16_777_216 }).identity.sha256,
    registry_repository: gitAuthority.repository, registry_commit: gitAuthority.commit, registry_tree: gitAuthority.tree,
  }
  const campaignInput = { ...inputUnsigned, input_sha256: sha256Canonical(inputUnsigned) }
  const campaignInputRawSha256 = writeCanonical(campaignInputPath, campaignInput)
  const now = Date.now()
  if (!privateKey) throw new Error('requirements key unavailable before authority')
  const authority = signedRecord({
    schema_id: 'oracle-lab-p3b-test-production-authority.v1', decision: 'authorize_test_owned_offline_campaign', campaign_id: campaignInput.campaign_id, campaign_input_sha256: campaignInput.input_sha256,
    repositories: REPOSITORY_AUTHORITY, c1: crossRepoAuthority(String(materialized.c1_sha256)), reviewed_candidate_commit: materialized.reviewed_candidate_commit, reviewed_candidate_tree: materialized.reviewed_candidate_tree,
    approval_commit: gitAuthority.commit, approval_tree: gitAuthority.tree, attestation_commit: gitAuthority.commit, attestation_tree: gitAuthority.tree, campaign_registry_sha256: gitAuthority.registry_raw_sha256,
    implementation_review_path: path.join(gitAuthority.repository, IMPLEMENTATION_REVIEW_RELATIVE), implementation_review_sha256: gitAuthority.review_raw_sha256, reviewed_artifact_set_sha256: campaignInput.materialized_authority_sha256,
    critical: 0, important: 0, dynamic_launch_authorized: true, created_at_ms: now, expires_at_ms: now + 3_600_000,
    registry_repository: gitAuthority.repository, registry_commit: gitAuthority.commit, registry_tree: gitAuthority.tree, materialized_authority_sha256: campaignInput.materialized_authority_sha256,
    controller_source_sha256: campaignInput.controller_source_sha256, controller_executable_sha256: campaignInput.controller_executable_sha256, campaign_input_path: campaignInputPath, campaign_input_raw_sha256: campaignInputRawSha256,
    signed_gate_b_decision_path: decisionPath, signer_closure_path: closurePath,
  }, 'authority_sha256', publicEntry, privateKey)
  writeCanonical(authorityPath, authority)
  process.stdout.write(`${authorityPath}\n`)

  const externalSetPath = path.join(evidenceRoot, 'capsules/P3B-ES1/closure/external-digest-set.json')
  await waitFor(externalSetPath)
  const leak = readCanonical(evidenceRoot, 'capsules/P3B-ES1/closure/leak-report.json').value
  if (leak.status !== 'PASS' || !Array.isArray(leak.findings) || leak.findings.length !== 0) throw new Error('requirements signer refused pre-Gate leak report')
  const gateA = evaluateGateA(evidenceRoot)
  const gateAClock = readCanonical(evidenceRoot, 'capsules/P3B-ES1/gates/gate-a-clock.json').value
  const external = readCanonical(evidenceRoot, 'capsules/P3B-ES1/closure/external-digest-set.json').value
  const conclusions = CONCLUSION_IDS.map((id) => readCanonical(evidenceRoot, CONCLUSION_PATHS[id]).value)
  const issuedAt = Date.now()
  const issuedMonotonic = process.hrtime.bigint().toString()
  if (!privateKey) throw new Error('requirements key unavailable before operator decision')
  const decision = signedRecord({
    schema_id: 'oracle-lab-p3b-operator-decision.v2', decision_id: `test-${String(campaignInput.campaign_id)}`, decision: 'evaluate_successor_amendment_startable', campaign_id: campaignInput.campaign_id,
    gate_a_path: 'capsules/P3B-ES1/gates/gate-a-result.json', gate_a_sha256: gateA.gate_result_sha256, gate_a_clock_sha256: gateAClock.clock_sha256,
    external_set_path: 'capsules/P3B-ES1/closure/external-digest-set.json', external_set_sha256: external.external_set_sha256, conclusion_paths: CONCLUSION_IDS.map((id) => CONCLUSION_PATHS[id]), conclusion_sha256s: conclusions.map((value) => value.conclusion_sha256),
    implementation_review_sha256: gitAuthority.review_raw_sha256, issued_at_ms: issuedAt, issued_monotonic_ns: issuedMonotonic, maximum_evaluation_delay_ms: OPERATOR_MAX_DELAY_MS, scope: GATE_B_SCOPE, prohibited_claims: PROHIBITED,
  }, 'decision_sha256', publicEntry, privateKey)
  writeCanonical(decisionPath, decision)

  const gateBPath = path.join(evidenceRoot, 'capsules/P3B-ES1/gates/gate-b-result.json')
  const postGatePath = path.join(evidenceRoot, 'capsules/P3B-ES1/gates/post-gate-leak-report.json')
  await waitFor(gateBPath)
  await waitFor(postGatePath)
  const sealed = validateSealedGateBResult(evidenceRoot, gateBPath)
  const postGate = validatePostGateLeakReport(evidenceRoot)
  if (!privateKey || sealed.value.decision !== 'PASS' || postGate.status !== 'PASS') throw new Error('requirements signer refused Gate B or post-Gate leak validation')
  const closure = signedRecord({
    schema_id: 'oracle-lab-p3b-requirements-signer-closure.v2', campaign_id: campaignInput.campaign_id, operator_decision_sha256: decision.decision_sha256,
    gate_b_result_sha256: sealed.value.gate_result_sha256, gate_b_result_raw_sha256: sealed.identity.sha256, gate_b_result_dev: sealed.identity.dev, gate_b_result_ino: sealed.identity.ino, gate_b_result_size: sealed.identity.size,
    post_gate_leak_report_sha256: postGate.post_gate_leak_report_sha256, evaluation_input_sha256: sealed.value.evaluation_input_sha256, evidence_root: evidenceRoot, result_path: gateBPath, status: 'private_key_destroyed_after_gate_b',
  }, 'closure_sha256', publicEntry, privateKey)
  privateKey = null
  writeCanonical(closurePath, closure)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
