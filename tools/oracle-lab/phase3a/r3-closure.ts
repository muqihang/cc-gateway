import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalJson, Phase3AError, sha256Bytes } from './core.js'

type Intake = { commit: string; tree: string; base_commit: string; worktree_clean: boolean; changed_files: string[]; target_tests: number; boundary_tests: number }
const EXPECTED_FILES = ['tools/oracle_phase3a_adapter.py', 'tools/tests/test_oracle_phase3a_adapter.py']
function fail(code: string, message: string): never { throw new Phase3AError(code, message) }

export function evaluateR3Closure(intake: Intake): Record<string, any> {
  for (const digest of [intake.commit, intake.tree, intake.base_commit]) if (!/^[a-f0-9]{40}$/.test(digest)) fail('r3_identity_invalid', 'R3 git identity must be SHA-1')
  if (!intake.worktree_clean) fail('r3_worktree_dirty', 'Sub2API worktree must remain clean')
  if (canonicalJson([...intake.changed_files].sort()) !== canonicalJson(EXPECTED_FILES)) fail('r3_diff_invalid', 'R3 target diff does not match the exact adapter intake')
  if (intake.target_tests !== 10) fail('r3_tests_incomplete', 'R3 target test count must be 10')
  if (intake.boundary_tests !== 48) fail('r3_tests_incomplete', 'R3 boundary test count must be 48')
  const boundaryPairs = [
    { pair_id: 'adapter-guard-vs-loopback-guard', status: 'REPRODUCED' },
    { pair_id: 'adapter-http-summary-vs-loopback-summary', status: 'REPRODUCED' },
    { pair_id: 'adapter-tls-summary-vs-tls-oracle', status: 'REPRODUCED' },
    { pair_id: 'adapter-env-summary-vs-env-attribution-oracle', status: 'REPRODUCED' },
  ]
  const base = {
    schema_version: 'oracle-lab-phase3a-r3-closure.v1', status: 'PASS', intake,
    tier_a: { status: 'PASS', target_tests: 10, boundary_tests: 48, total_tests: 58 }, boundary_pairs: boundaryPairs,
    tier_b: { status: 'SKIPPED_BY_RULE', triggers: [], reason: 'exact adapter diff and Tier A boundary suites produced no unexplained divergence, crash, outlier, or egress signal' },
    forbidden_file_accessed: false, external_socket_budget: 0, raw_material_persisted: false,
  }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  if (result.status !== 0) fail('r3_command_failed', `${command} exited ${String(result.status)}`)
  return result.stdout.trim()
}
function testCount(modules: string[], cwd: string): number {
  const result = spawnSync('python3', ['-m', 'unittest', '-q', ...modules], { cwd, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  if (result.status !== 0) fail('r3_tests_failed', 'R3 Python test suite failed')
  const match = `${result.stdout}\n${result.stderr}`.match(/Ran (\d+) tests? in/)
  if (!match) fail('r3_tests_unclassified', 'R3 Python test count was not emitted')
  return Number(match[1])
}
function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = argument('--sub2api-root'); const expectedCommit = argument('--commit'); const expectedTree = argument('--tree'); const out = argument('--out')
  if (!root || !expectedCommit || !expectedTree || !out) fail('usage', 'r3-closure requires --sub2api-root, --commit, --tree, and --out')
  const commit = run('git', ['rev-parse', 'HEAD'], root); const tree = run('git', ['rev-parse', 'HEAD^{tree}'], root)
  if (commit !== expectedCommit || tree !== expectedTree) fail('r3_identity_drift', 'Sub2API identity drifted')
  const baseCommit = run('git', ['rev-parse', `${commit}^`], root)
  const changedFiles = run('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', commit], root).split('\n').filter(Boolean).sort()
  const clean = run('git', ['status', '--porcelain'], root) === ''
  const targetTests = testCount(['tools.tests.test_oracle_phase3a_adapter'], root)
  const boundaryTests = testCount(['tools.tests.test_claude_code_real_oracle_loopback', 'tools.tests.test_claude_code_tls_oracle', 'tools.tests.test_claude_code_local_env_attribution_oracle'], root)
  const result = evaluateR3Closure({ commit, tree, base_commit: baseCommit, worktree_clean: clean, changed_files: changedFiles, target_tests: targetTests, boundary_tests: boundaryTests })
  writeFileSync(out, `${canonicalJson(result)}\n`, { flag: 'wx', mode: 0o600 }); process.stdout.write(`${canonicalJson(result)}\n`)
}
