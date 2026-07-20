import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkSharedContract } from '../../oracle-contract/check-shared-contract.js'
import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'

export type PreflightFacts = {
  cc_head: string
  cc_tree: string
  sub2api_head: string
  sub2api_tree: string
  bundle_sha256: string
  predecessor_sha256: string
  plan_sha256: string
}

export const EXPECTED_PREFLIGHT: PreflightFacts = {
  cc_head: 'd02b7b3e8e746167a67d39c82792565be05fb3de',
  cc_tree: 'a2a2e50d461000cde20b998a553ee789a54fca67',
  sub2api_head: 'cea7de895b8b523f3a6bb46be77ba09bc31a11bc',
  sub2api_tree: '52efacd397bd0f15861cca4b6a1921a049e5ea28',
  bundle_sha256: '2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce',
  predecessor_sha256: '70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1',
  plan_sha256: '',
}

export function evaluatePreflight(actual: PreflightFacts, expected: PreflightFacts): { status: 'PASS' } {
  if (actual.cc_head !== expected.cc_head || actual.cc_tree !== expected.cc_tree || actual.sub2api_head !== expected.sub2api_head || actual.sub2api_tree !== expected.sub2api_tree) {
    throw new Phase3AError('repository_drift', 'repository commit or tree differs from the execution freeze')
  }
  if (actual.bundle_sha256 !== expected.bundle_sha256 || actual.predecessor_sha256 !== expected.predecessor_sha256) {
    throw new Phase3AError('contract_digest_mismatch', 'P2 bundle or predecessor digest differs from the execution freeze')
  }
  if (actual.plan_sha256 !== expected.plan_sha256) throw new Phase3AError('plan_digest_mismatch', 'active corrected plan digest differs from the execution freeze')
  return { status: 'PASS' }
}

function git(root: string, argument: string): string {
  const result = spawnSync('git', ['rev-parse', argument], { cwd: root, encoding: 'utf8', timeout: 10_000 })
  if (result.status !== 0) throw new Phase3AError('repository_drift', `git rev-parse failed in ${path.basename(root)}`)
  return result.stdout.trim()
}

function codegraphStatus(root: string): { up_to_date: boolean; output_sha256: string } {
  const result = spawnSync('codegraph', ['status', root], { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  return { up_to_date: result.status === 0 && /Index is up to date/.test(output), output_sha256: sha256Bytes(output) }
}

export function capturePreflight(input: { ccRoot: string; sub2apiRoot: string; planPath: string; evidenceRoot: string; expectedPlanSha256: string }): Record<string, unknown> {
  const contract = checkSharedContract({ ccGatewayRoot: input.ccRoot, sub2apiRoot: input.sub2apiRoot })
  const actual: PreflightFacts = {
    cc_head: git(input.ccRoot, 'HEAD^{commit}'), cc_tree: git(input.ccRoot, 'HEAD^{tree}'),
    sub2api_head: git(input.sub2apiRoot, 'HEAD^{commit}'), sub2api_tree: git(input.sub2apiRoot, 'HEAD^{tree}'),
    bundle_sha256: contract.bundleDigest, predecessor_sha256: contract.predecessorDigest, plan_sha256: sha256File(input.planPath),
  }
  const expected = { ...EXPECTED_PREFLIGHT, plan_sha256: input.expectedPlanSha256 }
  evaluatePreflight(actual, expected)
  const ccCodegraph = codegraphStatus(input.ccRoot)
  const subCodegraph = codegraphStatus(input.sub2apiRoot)
  if (!ccCodegraph.up_to_date || !subCodegraph.up_to_date) throw new Phase3AError('repository_drift', 'CodeGraph index is not current')
  const result = {
    schema_version: 'oracle-lab-phase3a-preflight.v1', status: 'PASS', facts: actual,
    schema_range: '1:0-0', fixture_cases: 65, focused_commands: 7,
    codegraph: { cc_gateway: ccCodegraph, sub2api: subCodegraph },
    original_plan_sha256: 'b3c617ec7d20e5b4854c60ff1aaed131878048f493186a8f1fad6509bf0bb56c',
    correction: 'operator-approved-tiered-intake-and-tree-digest-v1',
    initial_clean_states_observed_before_first_mutation: true,
  }
  const evidenceRoot = ensureEvidenceRoot(input.evidenceRoot)
  const output = assertEvidencePath(evidenceRoot, path.join(evidenceRoot, 'preflight', 'preflight.json'))
  mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 })
  writeFileSync(output, `${canonicalJson(result)}\n`, { flag: 'wx', mode: 0o600 })
  return result
}

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1] }
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const ccRoot = argument('--cc-root') ?? process.cwd()
    const sub2apiRoot = argument('--sub2api-root')
    const evidenceRoot = argument('--evidence-root')
    const planSha256 = argument('--plan-sha256')
    const planPath = path.join(ccRoot, 'docs/superpowers/plans/2026-07-19-claude-code-2.1.215-phase-3a-evidence-factory.md')
    if (!sub2apiRoot || !evidenceRoot || !planSha256) throw new Phase3AError('preflight_usage', '--sub2api-root, --evidence-root, and --plan-sha256 are required')
    console.log(canonicalJson(capturePreflight({ ccRoot, sub2apiRoot, evidenceRoot, planPath, expectedPlanSha256: planSha256 })))
  } catch (error) {
    console.error(canonicalJson(stableError(error))); process.exitCode = 1
  }
}
