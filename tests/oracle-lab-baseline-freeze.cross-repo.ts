import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PHASE_0_BINDINGS } from '../tools/oracle-lab/freeze-baseline.js';
import { cloneReviewedHead, git, mainOnlySource } from './support/reviewed-main-fixture.js';

assert.equal(
  process.env.ORACLE_REQUIRE_CROSS_REPO_FIXTURE,
  '1',
  'run this fixture only through npm run test:oracle:cross-repo',
);
const configuredSub2apiRoot = process.env.SUB2API_ROOT;
assert.ok(configuredSub2apiRoot, 'SUB2API_ROOT must explicitly identify the clean Sub2API source repository');

const reviewedPhase0CcHead = 'a54a44d107164d11428da06cc3eea979f488d350';
const reviewedPhase0Sub2apiHead = 'd596bb461b1cbb4f0ca8b299333f621ed8d4fd4f';

function nonAncestorSource(): { root: string; reviewedHead: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'oracle-non-ancestor-'));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'oracle@example.invalid');
  git(root, 'config', 'user.name', 'Oracle Test');
  writeFileSync(path.join(root, 'main.txt'), 'main\n');
  git(root, 'add', 'main.txt');
  git(root, 'commit', '-qm', 'main');
  git(root, 'switch', '-q', '--orphan', 'unintegrated-review');
  writeFileSync(path.join(root, 'review.txt'), 'review\n');
  git(root, 'add', 'review.txt');
  git(root, 'commit', '-qm', 'unintegrated review');
  const reviewedHead = git(root, 'rev-parse', 'HEAD');
  git(root, 'tag', 'unintegrated-review-head', reviewedHead);
  git(root, 'switch', '-q', 'main');
  return { root, reviewedHead };
}

const nonAncestor = nonAncestorSource();
assert.throws(
  () => mainOnlySource('non-ancestor', nonAncestor.root, nonAncestor.reviewedHead),
  /is not an ancestor of main/,
);

const reviewedGatewaySource = mainOnlySource('gateway-source', process.cwd(), reviewedPhase0CcHead);
const reviewedSub2apiSource = mainOnlySource('sub2api-source', path.resolve(configuredSub2apiRoot), reviewedPhase0Sub2apiHead);

function reviewedCliClone(name: string): { gateway: string; sub2api: string } {
  const root = mkdtempSync(path.join(tmpdir(), `oracle-reviewed-cli-${name}-`));
  const gatewayClone = path.join(root, 'gateway');
  const sub2apiClone = path.join(root, 'sub2api');
  cloneReviewedHead(reviewedGatewaySource, gatewayClone, PHASE_0_BINDINGS.ccGatewayBranch, reviewedPhase0CcHead);
  cloneReviewedHead(reviewedSub2apiSource, sub2apiClone, PHASE_0_BINDINGS.sub2apiBranch, reviewedPhase0Sub2apiHead);
  symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(gatewayClone, 'node_modules'));
  const exclude = path.resolve(gatewayClone, git(gatewayClone, 'rev-parse', '--git-path', 'info/exclude'));
  writeFileSync(exclude, `${readFileSync(exclude, 'utf8')}\nnode_modules\n`);
  assert.equal(git(gatewayClone, 'status', '--porcelain'), '');
  assert.equal(git(sub2apiClone, 'status', '--porcelain'), '');
  return { gateway: gatewayClone, sub2api: sub2apiClone };
}

function reviewedExitCommand(fixture: { gateway: string; sub2api: string }, expectedCcHead: string): string[] {
  return [
    'exec', 'tsx', 'tools/oracle-lab/freeze-baseline.ts', '--',
    '--cc-gateway-root', fixture.gateway,
    '--sub2api-root', fixture.sub2api,
    '--contract-path', path.join(fixture.sub2api, PHASE_0_BINDINGS.contractRelativePath),
    '--parent-entry', 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json',
    '--parent-entry-receipt', 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.receipt.json',
    '--expected-cc-head', expectedCcHead,
    '--expected-sub2api-head', git(fixture.sub2api, 'rev-parse', 'HEAD'),
    '--out', 'docs/superpowers/evidence/phase-0/task-9b-reviewed-cli-exit.json',
  ];
}

const reviewedCliSuccessFixture = reviewedCliClone('success');
const reviewedCliSuccess = spawnSync('npm', reviewedExitCommand(reviewedCliSuccessFixture, git(reviewedCliSuccessFixture.gateway, 'rev-parse', 'HEAD')), {
  cwd: reviewedCliSuccessFixture.gateway,
  encoding: 'utf8',
});
assert.equal(reviewedCliSuccess.status, 0, reviewedCliSuccess.stderr);
const reviewedCliOutput = path.join(reviewedCliSuccessFixture.gateway, 'docs/superpowers/evidence/phase-0/task-9b-reviewed-cli-exit.json');
assert.equal(existsSync(reviewedCliOutput), true);
assert.equal(existsSync(`${reviewedCliOutput}.receipt.json`), false);
assert.equal(JSON.parse(readFileSync(reviewedCliOutput, 'utf8')).approved_tool_head, git(reviewedCliSuccessFixture.gateway, 'rev-parse', 'HEAD'));

const reviewedCliMismatchFixture = reviewedCliClone('mismatch');
const reviewedCliMismatch = spawnSync('npm', reviewedExitCommand(reviewedCliMismatchFixture, '0'.repeat(40)), {
  cwd: reviewedCliMismatchFixture.gateway,
  encoding: 'utf8',
});
assert.equal(reviewedCliMismatch.status, 1, reviewedCliMismatch.stderr);
assert.match(reviewedCliMismatch.stderr, /"code":"cc_gateway_head_mismatch"/);
assert.equal(existsSync(path.join(reviewedCliMismatchFixture.gateway, 'docs/superpowers/evidence/phase-0/task-9b-reviewed-cli-exit.json')), false);

console.log('oracle cross-repository baseline fixture passed');
