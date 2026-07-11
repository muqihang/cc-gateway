import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cli, assertEvidencePath, digestFile, exactKeys, isObject, parseArgs, readJson, requireValid, result, sha256, writeJson, type HarnessErrorRecord, type HarnessResult } from './harness-core.js'
import { validateHandoffValue, type HandoffBundle } from './build-handoff-bundle.js'
import { buildExitReport } from './build-exit-report.js'
import { validateManifestArtifact } from './freeze-baseline.js'
import { validateContextPackValue, type ContextPack } from './validate-context-pack.js'
import { validateRequirements } from './validate-requirements.js'

export type ExitReceipt = { schema_version: 1; generated_at: string; baseline_digest: string; handoff_digest: string; handoff_commit: string; artifact_digests: Record<string, string>; repository_heads: Record<string, string>; retention_class: string; redaction_policy: string; destruction_procedure: string }
const fields = ['schema_version', 'generated_at', 'baseline_digest', 'handoff_digest', 'handoff_commit', 'artifact_digests', 'repository_heads', 'retention_class', 'redaction_policy', 'destruction_procedure'] as const
const REQUIREMENT_REGISTRY = 'docs/superpowers/registry/oracle-lab-requirements.json'
const ROADMAP = 'docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md'

function assertReceiptArtifactPath(file: string): void {
  if (file === REQUIREMENT_REGISTRY || file === ROADMAP) return
  assertEvidencePath(file)
}

export function requiredReceiptArtifacts(phase: string, baseline: string, context: string, handoff: string): string[] {
  const report = path.join(path.dirname(handoff), `${phase}-exit-report.md`)
  return [baseline, context, handoff, report, REQUIREMENT_REGISTRY, ROADMAP].sort()
}

export function validateExitReceiptValue(value: unknown): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  if (!exactKeys(value, fields, '$', errors)) return result(errors)
  if (value.schema_version !== 1 || typeof value.generated_at !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(String(value.baseline_digest)) || !/^sha256:[0-9a-f]{64}$/.test(String(value.handoff_digest)) || !/^[0-9a-f]{40,64}$/.test(String(value.handoff_commit))) errors.push({ code: 'invalid_receipt', path: '$', message: 'receipt header is invalid' })
  if (!isObject(value.artifact_digests) || Object.keys(value.artifact_digests).length !== 6 || Object.entries(value.artifact_digests).some(([file, digest]) => { try { assertReceiptArtifactPath(file) } catch { return true }; return !/^sha256:[0-9a-f]{64}$/.test(String(digest)) })) errors.push({ code: 'invalid_artifact', path: '$.artifact_digests', message: 'artifact digests must contain the exact six-artifact inventory' })
  if (!isObject(value.repository_heads) || Object.keys(value.repository_heads).length !== 2 || !['cc_gateway', 'sub2api'].every((name) => /^[0-9a-f]{40,64}$/.test(String(value.repository_heads[name])))) errors.push({ code: 'invalid_repository_heads', path: '$.repository_heads', message: 'repository heads must contain cc_gateway and sub2api' })
  if (value.retention_class !== 'phase_evidence_permanent' || value.redaction_policy !== 'digests_and_safe_redacted_excerpts_only' || value.destruction_procedure !== 'git_revert_artifact_commit_after_security_approval') errors.push({ code: 'invalid_metadata', path: '$', message: 'metadata is invalid' })
  return result(errors)
}

function commitHasFile(commit: string, file: string): boolean {
  try { execFileSync('git', ['cat-file', '-e', `${commit}:${file}`], { stdio: 'ignore' }); return true } catch { return false }
}

function commitFileDigest(commit: string, file: string): string {
  return sha256(execFileSync('git', ['show', `${commit}:${file}`], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 }))
}

export function buildExitReceipt(options: { baseline: string; handoff: string; handoffCommit: string; artifacts?: string[]; generatedAt?: string }): ExitReceipt {
  const baseline = readJson(options.baseline); const handoff = readJson(options.handoff)
  try { validateManifestArtifact(baseline) } catch { throw Object.assign(new Error('baseline is invalid'), { code: 'invalid_baseline' }) }
  requireValid(validateHandoffValue(handoff)); const typedHandoff = handoff as HandoffBundle
  if (typedHandoff.baseline_digest !== digestFile(options.baseline)) throw Object.assign(new Error('handoff does not bind baseline'), { code: 'handoff_baseline_mismatch' })
  const contextArtifacts = typedHandoff.artifacts.filter((artifact) => artifact.path.endsWith('-context-pack.json'))
  if (contextArtifacts.length !== 1 || !typedHandoff.context_pack_digest) throw Object.assign(new Error('handoff must name exactly one context pack'), { code: 'missing_context_artifact' })
  const contextPath = contextArtifacts[0].path
  const contextValue = readJson(contextPath); requireValid(validateContextPackValue(contextValue)); const context = contextValue as ContextPack
  if (digestFile(contextPath) !== typedHandoff.context_pack_digest || context.manifest_digest !== typedHandoff.baseline_digest) throw Object.assign(new Error('context does not bind handoff and baseline'), { code: 'context_binding_mismatch' })
  const artifacts = requiredReceiptArtifacts(typedHandoff.phase, options.baseline, contextPath, options.handoff)
  if (options.artifacts && (options.artifacts.length !== artifacts.length || [...options.artifacts].sort().some((file, index) => file !== artifacts[index]))) throw Object.assign(new Error('explicit artifact inventory is not exact'), { code: 'artifact_inventory_mismatch' })
  const handoffArtifactPaths = typedHandoff.artifacts.map((artifact) => artifact.path).sort()
  if (JSON.stringify(handoffArtifactPaths) !== JSON.stringify([options.baseline, contextPath].sort())) throw Object.assign(new Error('handoff artifact inventory is not exact'), { code: 'artifact_inventory_mismatch' })
  const reportPath = path.join(path.dirname(options.handoff), `${typedHandoff.phase}-exit-report.md`)
  if (readFileSync(reportPath, 'utf8') !== buildExitReport(typedHandoff)) throw Object.assign(new Error('exit report does not match handoff'), { code: 'report_binding_mismatch' })
  const registryValidation = validateRequirements(REQUIREMENT_REGISTRY); if (!registryValidation.ok) throw Object.assign(new Error(JSON.stringify(registryValidation.errors)), { code: 'invalid_registry' })
  const roadmap = readFileSync(ROADMAP, 'utf8'); if (!roadmap.includes('## Phase 0:') || !roadmap.includes('Phase 0 is complete only when:')) throw Object.assign(new Error('roadmap lacks Phase 0 exit semantics'), { code: 'invalid_roadmap' })
  for (const file of artifacts) {
    assertReceiptArtifactPath(file)
    if (!commitHasFile(options.handoffCommit, file)) throw Object.assign(new Error(`${options.handoffCommit} does not contain ${file}`), { code: 'commit_missing_artifact' })
    if (commitFileDigest(options.handoffCommit, file) !== digestFile(file)) throw Object.assign(new Error(`${options.handoffCommit} does not contain the current bytes of ${file}`), { code: 'commit_artifact_digest_mismatch' })
  }
  const repositoryHeads: Record<string, string> = {}
  if (isObject(baseline) && isObject(baseline.repositories)) for (const [name, repository] of Object.entries(baseline.repositories)) if (isObject(repository) && typeof repository.head === 'string') repositoryHeads[name] = repository.head
  const handoffHeads = Object.fromEntries(typedHandoff.repositories.map((repository) => [repository.name, repository.commit]))
  if (JSON.stringify(repositoryHeads) !== JSON.stringify(handoffHeads)) throw Object.assign(new Error('handoff repository heads differ from baseline'), { code: 'handoff_repository_mismatch' })
  const receipt: ExitReceipt = { schema_version: 1, generated_at: new Date(options.generatedAt ?? new Date().toISOString()).toISOString(), baseline_digest: digestFile(options.baseline), handoff_digest: digestFile(options.handoff), handoff_commit: options.handoffCommit, artifact_digests: Object.fromEntries(artifacts.map((file) => [file, digestFile(file)])), repository_heads: repositoryHeads, retention_class: 'phase_evidence_permanent', redaction_policy: 'digests_and_safe_redacted_excerpts_only', destruction_procedure: 'git_revert_artifact_commit_after_security_approval' }
  requireValid(validateExitReceiptValue(receipt)); return receipt
}

if (realpathSync(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) cli(() => {
  const args = parseArgs(process.argv.slice(2)); const baseline = args.values.baseline?.[0]; const handoff = args.values.handoff?.[0]; const handoffCommit = args.values['handoff-commit']?.[0]; const out = args.values.out?.[0]
  if (!baseline || !handoff || !handoffCommit || !out) throw Object.assign(new Error('--baseline, --handoff, --handoff-commit, and --out are required'), { code: 'invalid_arguments' })
  writeJson(out, buildExitReceipt({ baseline, handoff, handoffCommit, artifacts: args.values.artifact }))
})
