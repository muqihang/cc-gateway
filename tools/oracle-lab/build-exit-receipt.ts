import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { cli, assertEvidencePath, digestFile, exactKeys, isObject, parseArgs, readJson, requireValid, result, sha256, writeJson, type HarnessErrorRecord, type HarnessResult } from './harness-core.js'

export type ExitReceipt = { schema_version: 1; generated_at: string; baseline_digest: string; handoff_digest: string; handoff_commit: string; artifact_digests: Record<string, string>; repository_heads: Record<string, string>; retention_class: string; redaction_policy: string; destruction_procedure: string }
const fields = ['schema_version', 'generated_at', 'baseline_digest', 'handoff_digest', 'handoff_commit', 'artifact_digests', 'repository_heads', 'retention_class', 'redaction_policy', 'destruction_procedure'] as const

export function validateExitReceiptValue(value: unknown): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  if (!exactKeys(value, fields, '$', errors)) return result(errors)
  if (value.schema_version !== 1 || typeof value.generated_at !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(String(value.baseline_digest)) || !/^sha256:[0-9a-f]{64}$/.test(String(value.handoff_digest)) || !/^[0-9a-f]{40,64}$/.test(String(value.handoff_commit))) errors.push({ code: 'invalid_receipt', path: '$', message: 'receipt header is invalid' })
  if (!isObject(value.artifact_digests) || Object.entries(value.artifact_digests).some(([file, digest]) => { try { assertEvidencePath(file) } catch { return true }; return !/^sha256:[0-9a-f]{64}$/.test(String(digest)) })) errors.push({ code: 'invalid_artifact', path: '$.artifact_digests', message: 'artifact digests are invalid' })
  if (!isObject(value.repository_heads) || Object.entries(value.repository_heads).some(([name, commit]) => !/^[0-9a-f]{40,64}$/.test(String(commit)) || typeof name !== 'string')) errors.push({ code: 'invalid_repository_heads', path: '$.repository_heads', message: 'repository heads are invalid' })
  if (typeof value.retention_class !== 'string' || typeof value.redaction_policy !== 'string' || typeof value.destruction_procedure !== 'string') errors.push({ code: 'invalid_metadata', path: '$', message: 'metadata is required' })
  return result(errors)
}

function commitHasFile(commit: string, file: string): boolean {
  try { execFileSync('git', ['cat-file', '-e', `${commit}:${file}`], { stdio: 'ignore' }); return true } catch { return false }
}

function commitFileDigest(commit: string, file: string): string {
  return sha256(execFileSync('git', ['show', `${commit}:${file}`], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 }))
}

export function buildExitReceipt(options: { baseline: string; handoff: string; handoffCommit: string; artifacts?: string[]; generatedAt?: string }): ExitReceipt {
  const baseline = readJson(options.baseline); const handoff = readJson(options.handoff); const artifacts = [...new Set([options.baseline, options.handoff, ...(options.artifacts ?? [])])]
  for (const file of artifacts) {
    assertEvidencePath(file)
    if (!commitHasFile(options.handoffCommit, file)) throw Object.assign(new Error(`${options.handoffCommit} does not contain ${file}`), { code: 'commit_missing_artifact' })
    if (commitFileDigest(options.handoffCommit, file) !== digestFile(file)) throw Object.assign(new Error(`${options.handoffCommit} does not contain the current bytes of ${file}`), { code: 'commit_artifact_digest_mismatch' })
  }
  const repositoryHeads: Record<string, string> = {}
  if (isObject(baseline) && isObject(baseline.repositories)) for (const [name, repository] of Object.entries(baseline.repositories)) if (isObject(repository) && typeof repository.head === 'string') repositoryHeads[name] = repository.head
  const receipt: ExitReceipt = { schema_version: 1, generated_at: new Date(options.generatedAt ?? new Date().toISOString()).toISOString(), baseline_digest: digestFile(options.baseline), handoff_digest: digestFile(options.handoff), handoff_commit: options.handoffCommit, artifact_digests: Object.fromEntries(artifacts.map((file) => [file, digestFile(file)])), repository_heads: repositoryHeads, retention_class: 'phase_evidence_permanent', redaction_policy: 'digests_and_safe_redacted_excerpts_only', destruction_procedure: 'git_revert_artifact_commit_after_security_approval' }
  requireValid(validateExitReceiptValue(receipt)); return receipt
}

if (realpathSync(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) cli(() => {
  const args = parseArgs(process.argv.slice(2)); const baseline = args.values.baseline?.[0]; const handoff = args.values.handoff?.[0]; const handoffCommit = args.values['handoff-commit']?.[0]; const out = args.values.out?.[0]
  if (!baseline || !handoff || !handoffCommit || !out) throw Object.assign(new Error('--baseline, --handoff, --handoff-commit, and --out are required'), { code: 'invalid_arguments' })
  writeJson(out, buildExitReceipt({ baseline, handoff, handoffCommit, artifacts: args.values.artifact }))
})
