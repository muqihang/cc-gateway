import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

export function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

export function assertReviewedHeadIntegrated(root: string, reviewedHead: string): void {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', reviewedHead, 'main'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`reviewed head ${reviewedHead} is not an ancestor of main`);
  }
}

export function mainOnlySource(name: string, source: string, reviewedHead: string): string {
  const root = path.join(mkdtempSync(path.join(tmpdir(), `oracle-main-only-${name}-`)), name);
  execFileSync('git', ['clone', '-q', '--single-branch', '--branch', 'main', source, root]);
  assert.equal(git(root, 'branch', '--show-current'), 'main');
  assert.equal(git(root, 'status', '--porcelain'), '');
  assert.doesNotMatch(git(root, 'branch', '-a'), /codex\/oracle-phase-0-governance/);
  assertReviewedHeadIntegrated(root, reviewedHead);
  return root;
}

export function cloneReviewedHead(source: string, destination: string, branch: string, head: string): void {
  execFileSync('git', ['clone', '-q', '--single-branch', '--branch', 'main', source, destination]);
  assertReviewedHeadIntegrated(destination, head);
  git(destination, 'switch', '-q', '-c', branch, head);
  assert.equal(git(destination, 'branch', '--show-current'), branch);
  assert.equal(git(destination, 'rev-parse', 'HEAD'), head);
  assert.equal(git(destination, 'status', '--porcelain'), '');
}
