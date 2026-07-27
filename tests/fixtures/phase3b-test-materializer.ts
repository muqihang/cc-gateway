#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { buildCrossRepoRecord, encodeCrossRepoRecord, executeCrossRepoRecord } from '../../tools/oracle-contract/check-cross-repo.js'
import { buildEs7TypedFixtureContract, buildEs8TsAgreement, buildEs9CoverageContract, launchRecipe, rebuildProbe } from '../../tools/oracle-lab/phase3b-evidence-sufficiency/authority-materializer.js'
import { canonicalBytes, canonicalJson, sha256Bytes, sha256Canonical } from '../../tools/oracle-lab/phase3b-evidence-sufficiency/core.js'
import { buildCampaignLedger, crossRepoAuthority, immutableNormativeSourceBytes, NORMATIVE_COVERAGE_PLAN_RELATIVE, NORMATIVE_COVERAGE_PLAN_SHA256 } from '../../tools/oracle-lab/phase3b-evidence-sufficiency/ledger.js'
import { stableRead } from '../../tools/oracle-lab/phase3b-evidence-sufficiency/sealed-fs.js'

function writeCanonical(file: string, value: unknown): string {
  writeFileSync(file, `${canonicalJson(value)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  return stableRead(file, { mode: 0o600, maximumBytes: 16_777_216 }).identity.sha256
}

function git(repository: string, args: readonly string[]): string {
  return execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.attributesFile=/dev/null', '-c', 'commit.gpgSign=false', '--no-replace-objects', '-C', repository, ...args], { encoding: 'utf8' }).trim()
}

function runReceipt(executable: string, args: readonly string[], cwd: string): Readonly<Record<string, unknown>> {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 8_388_608, env: { ...process.env, PATH: '/usr/bin:/bin:/opt/homebrew/bin', LANG: 'C', LC_ALL: 'C' } })
  const stdout = Buffer.from(result.stdout ?? '', 'utf8')
  const stderr = Buffer.from(result.stderr ?? '', 'utf8')
  return { executable, args, exit_code: result.status, signal: result.signal, stdout_sha256: sha256Bytes(stdout), stderr_sha256: sha256Bytes(stderr), passed: result.status === 0 && !result.error }
}

function main(): void {
  if (process.argv.length !== 5) throw new Error('usage: materializer OUTPUT_ROOT CC_REPOSITORY SUB_REPOSITORY')
  const outputRoot = realpathSync(process.argv[2])
  const ccRepository = realpathSync(process.argv[3])
  const subRepository = realpathSync(process.argv[4])
  const candidateCommit = git(ccRepository, ['rev-parse', 'HEAD'])
  const candidateTree = git(ccRepository, ['rev-parse', 'HEAD^{tree}'])
  const campaignId = `phase3b-controller-${candidateCommit.slice(0, 12)}`

  const targetSource = path.join(outputRoot, 'synthetic-target')
  const targetC = path.join(ccRepository, 'tests/fixtures/phase3b-synthetic-target.c')
  execFileSync('/usr/bin/clang', ['-O2', '-Wall', '-Wextra', '-o', targetSource, targetC], { stdio: 'pipe' })
  chmodSync(targetSource, 0o500)
  const unsignedProbeSource = path.join(outputRoot, 'synthetic-probe-unsigned-source')
  const reviewedProbeSource = path.join(outputRoot, 'synthetic-probe-reviewed')
  copyFileSync(targetSource, unsignedProbeSource, 0)
  copyFileSync(targetSource, reviewedProbeSource, 0)
  chmodSync(unsignedProbeSource, 0o700)
  chmodSync(reviewedProbeSource, 0o700)
  execFileSync('/usr/bin/codesign', ['--remove-signature', unsignedProbeSource], { stdio: 'pipe' })
  chmodSync(unsignedProbeSource, 0o500)
  execFileSync('/usr/bin/codesign', ['--remove-signature', reviewedProbeSource], { stdio: 'pipe' })
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'oracle.phase3b.test.synthetic', '--timestamp=none', reviewedProbeSource], { stdio: 'pipe' })
  chmodSync(reviewedProbeSource, 0o500)
  const rebuilt = rebuildProbe(outputRoot, unsignedProbeSource, reviewedProbeSource)

  const sourceTreePath = path.join(outputRoot, 'phase3b-test-source-tree.bin')
  writeFileSync(sourceTreePath, immutableNormativeSourceBytes(NORMATIVE_COVERAGE_PLAN_RELATIVE, NORMATIVE_COVERAGE_PLAN_SHA256), { flag: 'wx', mode: 0o600 })
  const archivePath = path.join(outputRoot, 'phase3b-test-platform-archive.bin')
  copyFileSync(targetSource, archivePath, 0)
  chmodSync(archivePath, 0o600)
  const sourceTree = stableRead(sourceTreePath, { mode: 0o600, maximumBytes: 16_777_216 }).identity
  const archive = stableRead(archivePath, { mode: 0o600, maximumBytes: 268_435_456 }).identity
  const original = stableRead(targetSource, { mode: 0o500, maximumBytes: 268_435_456 }).identity

  const codesign = stableRead('/usr/bin/codesign', { mode: 0o755, maximumBytes: 1_048_576 }).identity
  const version = spawnSync('/usr/bin/codesign', ['--version'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' } })
  const versionOutput = `${version.stdout ?? ''}${version.stderr ?? ''}`.trim()
  const toolchainUnsigned = { schema_version: 'oracle-lab-phase3a-toolchain.v1', records: [{ name: 'codesign', status: 'available', executable_path: '/usr/bin/codesign', executable_sha256: codesign.sha256, version_output_sha256: sha256Bytes(Buffer.from(versionOutput, 'utf8')), version_first_line: versionOutput.split(/\r?\n/, 1)[0]?.slice(0, 240) || '(no version output)', probe_exit_code: version.status, fallback: false }] }
  const toolchain = { ...toolchainUnsigned, digest: sha256Bytes(canonicalBytes(toolchainUnsigned)) }
  const toolchainPath = path.join(outputRoot, 'phase3b-test-toolchain.json')
  const toolchainSha256 = writeCanonical(toolchainPath, toolchain)

  const originalRecipePath = path.join(outputRoot, 'phase3b-original-launch-recipe.json')
  const probeRecipePath = path.join(outputRoot, 'phase3b-probe-launch-recipe.json')
  const originalRecipe = launchRecipe('original', original.sha256, original.sha256, sourceTree.sha256, toolchainSha256, null)
  const probeRecipe = launchRecipe('probe', rebuilt.rebuilt.sha256, rebuilt.unsigned.sha256, sourceTree.sha256, toolchainSha256, rebuilt.signature, rebuilt.identifier)
  const originalRecipeSha256 = writeCanonical(originalRecipePath, originalRecipe)
  const probeRecipeSha256 = writeCanonical(probeRecipePath, probeRecipe)

  const crossReview = { schema_id: 'oracle-lab-p3b-test-cross-review.v1', task_id: 'phase3b-real-controller-test-review', model: 'gpt-5.6-sol', reviewed_candidate_commit: candidateCommit, reviewed_candidate_tree: candidateTree, critical: 0, important: 0, verdict: 'CROSS_REPO_PASS', created_at_ms: Date.now() }
  const crossReviewPath = path.join(outputRoot, 'phase3b-test-cross-review.json')
  const crossReviewSha256 = writeCanonical(crossReviewPath, crossReview)
  const c1Record = buildCrossRepoRecord(ccRepository, subRepository, { issuedAtMs: Date.now(), ccC1Commit: candidateCommit, ccC1Tree: candidateTree, crossReviewTaskId: 'phase3b-real-controller-test-review', crossReviewArtifactSha256: crossReviewSha256 })
  const c1Bytes = encodeCrossRepoRecord(c1Record)
  const c1Path = path.join(outputRoot, 'phase3b-c1-cross-repo-record.json')
  writeFileSync(c1Path, c1Bytes, { flag: 'wx', mode: 0o600 })
  const c1Sha256 = sha256Bytes(c1Bytes)
  const executed = executeCrossRepoRecord({ ccGatewayRoot: ccRepository, sub2apiRoot: subRepository, recordBytes: c1Bytes })
  const goReceiptPath = path.join(outputRoot, 'phase3b-es8-go-receipt.json')
  writeFileSync(goReceiptPath, executed.receiptBytes, { flag: 'wx', mode: 0o600 })
  const goReceiptSha256 = sha256Bytes(executed.receiptBytes)
  const goReceipt = JSON.parse(executed.receiptBytes.subarray(0, -1).toString('utf8')) as Record<string, unknown>
  const ledger = buildCampaignLedger(campaignId, crossRepoAuthority(c1Sha256))
  const es7Path = path.join(outputRoot, 'phase3b-es7-typed-fixtures.json')
  const es8Path = path.join(outputRoot, 'phase3b-es8-ts-c1-agreement.json')
  const es9Path = path.join(outputRoot, 'phase3b-es9-coverage-contract.json')
  const es7Sha256 = writeCanonical(es7Path, buildEs7TypedFixtureContract(campaignId, c1Sha256))
  const es8Sha256 = writeCanonical(es8Path, buildEs8TsAgreement(goReceipt, goReceiptSha256, campaignId, c1Sha256))
  const es9Sha256 = writeCanonical(es9Path, buildEs9CoverageContract(ledger))

  const focusedPath = path.join(outputRoot, 'phase3b-focused-suite.json')
  const productionSourceRoot = path.join(ccRepository, 'tools/oracle-lab/phase3b-evidence-sufficiency')
  const productionSources = readdirSync(productionSourceRoot).filter((name) => name.endsWith('.ts')).sort().map((name) => path.join(productionSourceRoot, name))
  const focusedCommands = [
    runReceipt(process.execPath, ['--import', 'tsx', '--test', 'tests/oracle-phase3b-production-executor-red.test.ts'], ccRepository),
    runReceipt(path.join(ccRepository, 'node_modules/.bin/tsc'), ['--noEmit', '--strict', '--noUnusedLocals', '--noUnusedParameters', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--types', 'node', ...productionSources], ccRepository),
    runReceipt('/usr/bin/env', ['npm', 'run', 'build'], ccRepository),
    runReceipt('/usr/bin/git', ['--no-replace-objects', 'diff', '--check'], ccRepository),
  ]
  if (focusedCommands.some((command) => command.passed !== true)) throw new Error(`focused command failed: ${canonicalJson(focusedCommands)}`)
  const focusedUnsigned = { schema_id: 'oracle-lab-p3b-test-focused-suite.v2', reviewed_candidate_commit: candidateCommit, reviewed_candidate_tree: candidateTree, focused_files: ['oracle-phase3b-production-executor-red'], command_receipts: focusedCommands, passed: focusedCommands[0].passed, strict_typescript: focusedCommands[1].passed, build: focusedCommands[2].passed, diff_check: focusedCommands[3].passed }
  const focusedSha256 = writeCanonical(focusedPath, { ...focusedUnsigned, receipt_sha256: sha256Canonical(focusedUnsigned) })
  const schemaBundlePath = path.join(outputRoot, 'phase3b-schema-bundle.json')
  const schemaBundleSha256 = writeCanonical(schemaBundlePath, { schema_id: 'oracle-lab-p3b-test-schema-bundle.v1', candidate_commit: candidateCommit, candidate_tree: candidateTree, controller_source_sha256: sha256Bytes(readFileSync(path.join(ccRepository, 'tools/oracle-lab/phase3b-evidence-sufficiency/campaign-controller.ts'))) })
  const predecessorConfigPath = path.join(outputRoot, 'phase3b-predecessor-config-auth-attestation.json')
  const predecessorFailurePath = path.join(outputRoot, 'phase3b-predecessor-failure-stream-attestation.json')
  writeCanonical(predecessorConfigPath, { schema_id: 'oracle-lab-p3b-test-predecessor-attestation.v1', conclusion_id: 'CL-P3A-R2-CONFIG-AUTH', conclusion_sha256: 'acaffa9fe6e2d9f1eede5d6bf65f32369558275cfa893b9e97187bed3f37b905', level: 'Reproduced' })
  writeCanonical(predecessorFailurePath, { schema_id: 'oracle-lab-p3b-test-predecessor-attestation.v1', conclusion_id: 'CL-P3A-R2-FAILURE-STREAM', conclusion_sha256: 'fa0dafe1edc8afccbcc4f10f94513c432c2e61e518bf6e38c47c90b7ba8224e4', level: 'Reproduced' })

  const targetProfile = { package: 'oracle-lab-test-owned-synthetic-target', version: '1', platform: 'darwin', architecture: 'arm64', platform_archive_sha256: archive.sha256, platform_tree_sha256: sourceTree.sha256, entrypoint_sha256: original.sha256, entrypoint_size: original.size, maximum_executable_bytes: 247_124_336 }
  const payload = {
    schema_id: 'oracle-lab-p3b-test-materialized-authority.v1', campaign_id: campaignId, cc_repository: ccRepository, sub_repository: subRepository, reviewed_candidate_commit: candidateCommit, reviewed_candidate_tree: candidateTree,
    c1_path: c1Path, c1_sha256: c1Sha256, cross_review_path: crossReviewPath, cross_review_sha256: crossReviewSha256,
    es7_path: es7Path, es7_sha256: es7Sha256, es8_go_path: goReceiptPath, es8_go_sha256: goReceiptSha256, es8_ts_path: es8Path, es8_ts_sha256: es8Sha256, es9_path: es9Path, es9_sha256: es9Sha256,
    target_profile: targetProfile, original_source: targetSource, probe_source: rebuilt.rebuilt.path, probe_source_sha256: rebuilt.rebuilt.sha256, probe_unsigned_source: rebuilt.unsigned.path, probe_unsigned_source_sha256: rebuilt.unsigned.sha256,
    original_recipe: originalRecipePath, original_recipe_sha256: originalRecipeSha256, probe_recipe: probeRecipePath, probe_recipe_sha256: probeRecipeSha256,
    platform_archive_path: archivePath, platform_archive_sha256: archive.sha256, source_tree_path: sourceTreePath, source_tree_sha256: sourceTree.sha256, toolchain_path: toolchainPath, toolchain_sha256: toolchainSha256, schema_bundle_path: schemaBundlePath, schema_bundle_sha256: schemaBundleSha256, focused_suite_path: focusedPath, focused_suite_sha256: focusedSha256,
    predecessor_config_auth_path: predecessorConfigPath, predecessor_failure_stream_path: predecessorFailurePath,
  }
  const payloadPath = path.join(outputRoot, 'phase3b-test-materialized-authority.json')
  writeCanonical(payloadPath, { ...payload, materialized_authority_sha256: sha256Canonical(payload) })
  process.stdout.write(`${payloadPath}\n`)
}

main()
