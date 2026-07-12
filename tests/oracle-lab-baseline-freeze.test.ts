import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  captureBaseline,
  computeRepositoryState,
  validateGovernanceMarkers,
  validateManifestArtifact,
  validateReceiptArtifact,
  writeEvidencePair,
  PHASE_0_BINDINGS,
  parsePorcelainPathRecords,
  validateFrozenBindings,
} from '../tools/oracle-lab/freeze-baseline.js';

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fixture(name: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `oracle-baseline-${name}-`));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'oracle@example.invalid');
  git(root, 'config', 'user.name', 'Oracle Test');
  writeFileSync(path.join(root, 'tracked.txt'), 'clean\n');
  git(root, 'add', 'tracked.txt');
  git(root, 'commit', '-qm', 'fixture');
  return root;
}

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.equal((error as { code?: string }).code, code);
    return true;
  });
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nonCanonicalBase64url(value: string): string {
  const decoded = Buffer.from(value, 'base64url');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const candidates = [
    ...alphabet.split('').map((suffix) => `${value.slice(0, -1)}${suffix}`),
    ...alphabet.split('').map((suffix) => `${value}${suffix}`),
  ];
  const alternate = candidates.find((candidate) => candidate !== value
    && /^[A-Za-z0-9_-]+$/.test(candidate)
    && Buffer.from(candidate, 'base64url').equals(decoded));
  assert.ok(alternate, `expected a non-canonical Base64URL spelling for ${value}`);
  return alternate;
}

let ajvRoot: string | undefined;

function ajvValidity(schema: unknown, values: unknown[]): boolean[] {
  if (!ajvRoot) {
    ajvRoot = mkdtempSync(path.join(tmpdir(), 'oracle-ajv-'));
    execFileSync('npm', ['install', '--prefix', ajvRoot, '--no-save', '--no-package-lock', '--ignore-scripts', 'ajv@8.20.0'], {
      stdio: 'ignore',
    });
  }
  const payload = JSON.stringify({ schema, values });
  const script = `
    const Ajv2020 = require('ajv/dist/2020');
    const input = JSON.parse(process.env.AJV_INPUT);
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(input.schema);
    process.stdout.write(JSON.stringify(input.values.map((value) => validate(value))));
  `;
  return JSON.parse(execFileSync('node', ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, AJV_INPUT: payload, NODE_PATH: path.join(ajvRoot, 'node_modules') },
  }));
}

const tracked = fixture('tracked');
writeFileSync(path.join(tracked, 'tracked.txt'), 'changed\n');
expectCode(() => computeRepositoryState(tracked), 'undeclared_dirty_tree');

const untracked = fixture('untracked');
writeFileSync(path.join(untracked, 'new.txt'), 'new\n');
expectCode(() => computeRepositoryState(untracked), 'undeclared_dirty_tree');
const allowed = computeRepositoryState(untracked, computeRepositoryState(untracked, undefined, true).dirty_digest);
assert.equal(allowed.clean, false);
expectCode(() => computeRepositoryState(untracked, '0'.repeat(64)), 'dirty_digest_mismatch');

const child = fixture('submodule-child');
const parent = fixture('submodule-parent');
git(parent, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', child, 'vendor/child');
git(parent, 'commit', '-qam', 'add submodule');
writeFileSync(path.join(parent, 'vendor/child/tracked.txt'), 'drift\n');
expectCode(() => computeRepositoryState(parent), 'undeclared_dirty_tree');
git(parent, 'config', 'submodule.vendor/child.ignore', 'all');
expectCode(() => computeRepositoryState(parent), 'undeclared_dirty_tree');
const ignoredSubmodule = computeRepositoryState(parent, undefined, true).dirty_records.find((record) => record.object_type === 'submodule');
assert.equal(ignoredSubmodule?.submodule_dirty, true);

const gateway = fixture('gateway');
const sub2api = fixture('sub2api');
mkdirSync(path.join(gateway, 'src'), { recursive: true });
mkdirSync(path.join(gateway, 'sidecar/egress-tls-sidecar/internal/profile'), { recursive: true });
mkdirSync(path.join(gateway, 'sidecar/egress-tls-sidecar/internal/summary'), { recursive: true });
mkdirSync(path.join(gateway, 'tools'), { recursive: true });
for (const file of [
  'src/persona-registry.ts', 'src/persona-resolver.ts', 'src/policy.ts',
  'src/egress-tls-profile.ts', 'src/proxy.ts',
  'sidecar/egress-tls-sidecar/internal/profile/profile.go',
  'sidecar/egress-tls-sidecar/internal/summary/summary.go',
  'tools/claude-observer.ts', 'tools/parser.ts', 'tools/canonicalizer.ts',
  'package.json', 'package-lock.json',
]) {
  writeFileSync(path.join(gateway, file), `${file}\n`);
}
const contract = path.join(sub2api, 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json');
mkdirSync(path.dirname(contract), { recursive: true });
writeFileSync(contract, '{"fixture":true}\n');
git(gateway, 'add', '.');
git(gateway, 'commit', '-qm', 'inputs');
git(sub2api, 'add', '.');
git(sub2api, 'commit', '-qm', 'contract');

const common = {
  ccGatewayRoot: gateway,
  sub2apiRoot: sub2api,
  contractPath: contract,
  approvedToolHead: git(gateway, 'rev-parse', 'HEAD'),
  strictBindings: false,
};

// Exercise the real argv/exit/output path with explicit strict bindings in isolated repositories.
const cliFixtureRoot = mkdtempSync(path.join(tmpdir(), 'oracle-cli-fixture-'));
const cliGateway = path.join(cliFixtureRoot, 'gateway');
const cliSub2api = path.join(cliFixtureRoot, 'sub2api');
execFileSync('git', ['clone', '-q', gateway, cliGateway]);
execFileSync('git', ['clone', '-q', sub2api, cliSub2api]);
git(cliGateway, 'config', 'user.email', 'oracle@example.invalid');
git(cliGateway, 'config', 'user.name', 'Oracle Test');
const cliContract = path.join(cliSub2api, 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json');
const fixtureSchemaPath = path.join(cliGateway, 'docs/superpowers/schemas/oracle-lab-run-manifest.schema.json');
mkdirSync(path.dirname(fixtureSchemaPath), { recursive: true });
writeFileSync(fixtureSchemaPath, readFileSync(path.join(process.cwd(), 'docs/superpowers/schemas/oracle-lab-run-manifest.schema.json')));
git(cliGateway, 'add', '.');
git(cliGateway, 'commit', '-qm', 'schema');
const cliBindings = {
  ccGatewayHead: git(cliGateway, 'rev-parse', 'HEAD'),
  ccGatewayBranch: git(cliGateway, 'branch', '--show-current'),
  sub2apiHead: git(cliSub2api, 'rev-parse', 'HEAD'),
  sub2apiBranch: git(cliSub2api, 'branch', '--show-current'),
  contractSha256: sha256(readFileSync(cliContract)),
  contractRelativePath: 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json',
};

const cliHarness = path.join(mkdtempSync(path.join(tmpdir(), 'oracle-cli-harness-')), 'run.ts');
writeFileSync(cliHarness, `
import { runFreezeBaselineCli } from ${JSON.stringify(pathToFileURL(path.join(process.cwd(), 'tools/oracle-lab/freeze-baseline.ts')).href)};
const bindings = JSON.parse(process.env.ORACLE_TEST_BINDINGS!);
const receiptTransform = process.env.ORACLE_TAMPER_BOOTSTRAP === '1'
  ? (receipt: any) => ({ ...receipt, bootstrap_commit: 'a'.repeat(40) })
  : undefined;
process.exitCode = runFreezeBaselineCli(process.argv.slice(2), { bindings, receiptTransform });
`);
const cliArgs = [
  cliHarness,
  '--cc-gateway-root', cliGateway,
  '--sub2api-root', cliSub2api,
  '--contract-path', cliContract,
  '--approved-tool-head', cliBindings.ccGatewayHead,
  '--out', 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json',
  '--receipt', 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.receipt.json',
];
mkdirSync(path.join(cliGateway, 'docs/superpowers/evidence/phase-0'), { recursive: true });
const cliEnvironment = { ...process.env, ORACLE_TEST_BINDINGS: JSON.stringify(cliBindings) };
const tamperedCli = spawnSync('tsx', cliArgs, {
  cwd: mkdtempSync(path.join(tmpdir(), 'oracle-cli-cwd-')),
  encoding: 'utf8',
  env: { ...cliEnvironment, ORACLE_TAMPER_BOOTSTRAP: '1' },
});
assert.equal(tamperedCli.status, 1);
assert.match(tamperedCli.stderr, /"code":"receipt_bootstrap_mismatch"/);
assert.match(tamperedCli.stderr, /receipt bootstrap commit does not match manifest approved tool head/);
assert.equal(existsSync(path.join(cliGateway, 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json')), false);
assert.equal(existsSync(path.join(cliGateway, 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.receipt.json')), false);

const successfulCli = spawnSync('tsx', cliArgs, {
  cwd: mkdtempSync(path.join(tmpdir(), 'oracle-cli-cwd-')),
  encoding: 'utf8',
  env: cliEnvironment,
});
assert.equal(successfulCli.status, 0, successfulCli.stderr);
assert.equal(successfulCli.stderr, '');
const cliManifestPath = path.join(cliGateway, 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json');
const cliReceiptPath = path.join(cliGateway, 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.receipt.json');
const cliManifestBytes = readFileSync(cliManifestPath);
const cliManifest = JSON.parse(cliManifestBytes.toString('utf8'));
const cliReceipt = JSON.parse(readFileSync(cliReceiptPath, 'utf8'));
assert.equal(cliManifest.approved_tool_head, cliBindings.ccGatewayHead);
assert.equal(cliReceipt.bootstrap_commit, cliBindings.ccGatewayHead);
assert.equal(cliReceipt.manifest_sha256, sha256(cliManifestBytes));
assert.equal(cliReceipt.schema_sha256, sha256(readFileSync(fixtureSchemaPath)));
assert.deepEqual(JSON.parse(successfulCli.stdout), {
  manifest_sha256: sha256(cliManifestBytes),
  receipt_written: true,
});

// RED: the exact Task 9 interface creates one exit manifest from committed parent evidence.
mkdirSync(path.join(cliGateway, 'docs/superpowers/registry'), { recursive: true });
mkdirSync(path.join(cliGateway, 'tools/oracle-lab'), { recursive: true });
git(cliGateway, 'add', '.');
git(cliGateway, 'commit', '-qm', 'commit parent evidence');
const exitArgsForHead = (head: string) => [
  cliHarness,
  '--cc-gateway-root', cliGateway,
  '--sub2api-root', cliSub2api,
  '--contract-path', cliContract,
  '--parent-entry', 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json',
  '--parent-entry-receipt', 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.receipt.json',
  '--expected-cc-head', head,
  '--expected-sub2api-head', git(cliSub2api, 'rev-parse', 'HEAD'),
  '--out', 'docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json',
];
const missingToolCli = spawnSync('tsx', exitArgsForHead(git(cliGateway, 'rev-parse', 'HEAD')), {
  cwd: mkdtempSync(path.join(tmpdir(), 'oracle-missing-tool-cwd-')), encoding: 'utf8', env: cliEnvironment,
});
assert.equal(missingToolCli.status, 1);
assert.match(missingToolCli.stderr, /"code":"tool_input_not_committed"/);

writeFileSync(
  path.join(cliGateway, 'tools/oracle-lab/freeze-baseline.ts'),
  readFileSync(path.join(process.cwd(), 'tools/oracle-lab/freeze-baseline.ts')),
);
git(cliGateway, 'add', '.');
git(cliGateway, 'commit', '-qm', 'add reviewed capture tool');
const missingRegistryCli = spawnSync('tsx', exitArgsForHead(git(cliGateway, 'rev-parse', 'HEAD')), {
  cwd: mkdtempSync(path.join(tmpdir(), 'oracle-missing-registry-cwd-')), encoding: 'utf8', env: cliEnvironment,
});
assert.equal(missingRegistryCli.status, 1);
assert.match(missingRegistryCli.stderr, /"code":"missing_governance_registry"/);

writeFileSync(path.join(cliGateway, 'docs/superpowers/registry/oracle-lab-requirements.json'), '[]\n');
git(cliGateway, 'add', '.');
git(cliGateway, 'commit', '-qm', 'add requirement registry');
const missingClaimsCli = spawnSync('tsx', exitArgsForHead(git(cliGateway, 'rev-parse', 'HEAD')), {
  cwd: mkdtempSync(path.join(tmpdir(), 'oracle-missing-claims-cwd-')), encoding: 'utf8', env: cliEnvironment,
});
assert.equal(missingClaimsCli.status, 1);
assert.match(missingClaimsCli.stderr, /"code":"missing_claim_registry"/);

writeFileSync(path.join(cliGateway, 'docs/superpowers/registry/oracle-lab-claims.json'), '[]\n');
git(cliGateway, 'add', '.');
git(cliGateway, 'commit', '-qm', 'add claims registry');
const reviewedCcHead = git(cliGateway, 'rev-parse', 'HEAD');
const reviewedSub2apiHead = git(cliSub2api, 'rev-parse', 'HEAD');
const exitManifestRelative = 'docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json';
const exitManifestPath = path.join(cliGateway, exitManifestRelative);
const exitArgs = exitArgsForHead(reviewedCcHead);
const successfulExitCli = spawnSync('tsx', exitArgs, {
  cwd: mkdtempSync(path.join(tmpdir(), 'oracle-exit-cli-cwd-')),
  encoding: 'utf8',
  env: cliEnvironment,
});
assert.equal(successfulExitCli.status, 0, successfulExitCli.stderr);
assert.equal(successfulExitCli.stderr, '');
assert.equal(existsSync(`${exitManifestPath}.receipt.json`), false);
const exitManifestBytes = readFileSync(exitManifestPath);
const exitManifest = JSON.parse(exitManifestBytes.toString('utf8'));
assert.equal(exitManifest.phase, 'phase_0_exit');
assert.equal(exitManifest.entry_kind, 'phase_0_exit');
assert.equal(exitManifest.approved_tool_head, reviewedCcHead);
assert.equal(exitManifest.repositories.cc_gateway.head, reviewedCcHead);
assert.equal(exitManifest.repositories.sub2api.head, reviewedSub2apiHead);
assert.equal(exitManifest.repositories.cc_gateway.clean, true);
assert.equal(exitManifest.repositories.sub2api.clean, true);
assert.deepEqual(exitManifest.parent_reference, {
  type: 'phase_0_entry_evidence',
  entry_manifest: {
    repository_relative_path_base64url: Buffer.from('docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json').toString('base64url'),
    sha256: sha256(cliManifestBytes),
  },
  entry_receipt: {
    repository_relative_path_base64url: Buffer.from('docs/superpowers/evidence/phase-0/phase-0-entry-baseline.receipt.json').toString('base64url'),
    sha256: sha256(readFileSync(cliReceiptPath)),
  },
});
assert.deepEqual(exitManifest.governance, {
  requirement_registry: { status: 'present', sha256: sha256(readFileSync(path.join(cliGateway, 'docs/superpowers/registry/oracle-lab-requirements.json'))) },
  claim_registry: { status: 'present', sha256: sha256(readFileSync(path.join(cliGateway, 'docs/superpowers/registry/oracle-lab-claims.json'))) },
});
assert.deepEqual(exitManifest.capture_inputs, {
  schema: {
    repository_relative_path_base64url: Buffer.from('docs/superpowers/schemas/oracle-lab-run-manifest.schema.json').toString('base64url'),
    sha256: sha256(readFileSync(fixtureSchemaPath)),
  },
  tool: {
    repository_relative_path_base64url: Buffer.from('tools/oracle-lab/freeze-baseline.ts').toString('base64url'),
    sha256: sha256(readFileSync(path.join(cliGateway, 'tools/oracle-lab/freeze-baseline.ts'))),
  },
});
assert.deepEqual(JSON.parse(successfulExitCli.stdout), {
  manifest_sha256: sha256(exitManifestBytes),
  receipt_written: false,
});

// The production entrypoint must work through npm argument forwarding when the only
// declared source refs are the integrated main branches.
const configuredSub2apiRoot = process.env.SUB2API_ROOT;
assert.ok(configuredSub2apiRoot, 'SUB2API_ROOT must explicitly identify the clean Sub2API source repository');

function mainOnlySource(name: string, source: string): string {
  const root = path.join(mkdtempSync(path.join(tmpdir(), `oracle-main-only-${name}-`)), name);
  execFileSync('git', ['clone', '-q', '--single-branch', '--branch', 'main', source, root]);
  assert.equal(git(root, 'branch', '--show-current'), 'main');
  assert.equal(git(root, 'status', '--porcelain'), '');
  assert.doesNotMatch(git(root, 'branch', '-a'), /codex\/oracle-phase-0-governance/);
  return root;
}

const reviewedGatewaySource = mainOnlySource('gateway-source', process.cwd());
const reviewedSub2apiSource = mainOnlySource('sub2api-source', path.resolve(configuredSub2apiRoot));
const reviewedPhase0CcHead = 'a54a44d107164d11428da06cc3eea979f488d350';
const reviewedPhase0Sub2apiHead = 'd596bb461b1cbb4f0ca8b299333f621ed8d4fd4f';

function cloneReviewedHead(source: string, destination: string, branch: string, head: string): void {
  execFileSync('git', ['clone', '-q', '--single-branch', '--branch', 'main', source, destination]);
  git(destination, 'switch', '-q', '-c', branch, head);
  assert.equal(git(destination, 'branch', '--show-current'), branch);
  assert.equal(git(destination, 'rev-parse', 'HEAD'), head);
  assert.equal(git(destination, 'status', '--porcelain'), '');
}

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

const mixedCli = spawnSync('tsx', [
  ...cliArgs.slice(0, -4),
  '--out', 'docs/mixed-entry.json',
  '--receipt', 'docs/mixed-entry.receipt.json',
  ...exitArgs.slice(7, -2),
], { cwd: mkdtempSync(path.join(tmpdir(), 'oracle-mixed-cli-cwd-')), encoding: 'utf8', env: cliEnvironment });
assert.equal(mixedCli.status, 1);
assert.match(mixedCli.stderr, /"code":"mixed_mode_arguments"/);

const partialExitCli = spawnSync('tsx', exitArgs.slice(0, -4), { cwd: mkdtempSync(path.join(tmpdir(), 'oracle-partial-cli-cwd-')), encoding: 'utf8', env: cliEnvironment });
assert.equal(partialExitCli.status, 1);
assert.match(partialExitCli.stderr, /"code":"invalid_arguments"/);

const wrongHeadGateway = path.join(mkdtempSync(path.join(tmpdir(), 'oracle-wrong-head-')), 'gateway');
execFileSync('git', ['clone', '-q', cliGateway, wrongHeadGateway]);
const wrongHeadArgs = exitArgs.map((value, index) => {
  if (exitArgs[index - 1] === '--cc-gateway-root') return wrongHeadGateway;
  if (exitArgs[index - 1] === '--expected-cc-head') return '0'.repeat(40);
  return value;
});
const wrongHeadCli = spawnSync('tsx', wrongHeadArgs, {
  cwd: mkdtempSync(path.join(tmpdir(), 'oracle-head-cli-cwd-')), encoding: 'utf8', env: cliEnvironment,
});
assert.equal(wrongHeadCli.status, 1);
assert.match(wrongHeadCli.stderr, /"code":"cc_gateway_head_mismatch"/);

function cloneExitGateway(name: string): string {
  const target = path.join(mkdtempSync(path.join(tmpdir(), `oracle-exit-${name}-`)), 'gateway');
  execFileSync('git', ['clone', '-q', cliGateway, target]);
  git(target, 'config', 'user.email', 'oracle@example.invalid');
  git(target, 'config', 'user.name', 'Oracle Test');
  return target;
}

function exitArgsForGateway(root: string): string[] {
  return exitArgs.map((value, index) => {
    if (exitArgs[index - 1] === '--cc-gateway-root') return root;
    if (exitArgs[index - 1] === '--expected-cc-head') return git(root, 'rev-parse', 'HEAD');
    return value;
  });
}

function runExitFailure(args: string[], code: string): void {
  const result = spawnSync('tsx', args, {
    cwd: mkdtempSync(path.join(tmpdir(), 'oracle-exit-failure-cwd-')), encoding: 'utf8', env: cliEnvironment,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, new RegExp(`"code":"${code}"`));
}

const dirtyExitGateway = cloneExitGateway('dirty');
writeFileSync(path.join(dirtyExitGateway, 'untracked-drift.txt'), 'drift\n');
runExitFailure(exitArgsForGateway(dirtyExitGateway), 'undeclared_dirty_tree');

const wrongBranchGateway = cloneExitGateway('branch');
git(wrongBranchGateway, 'switch', '-q', '-c', 'wrong-phase-branch');
runExitFailure(exitArgsForGateway(wrongBranchGateway), 'cc_gateway_branch_mismatch');

const wrongSubHeadGateway = cloneExitGateway('wrong-sub-head');
const wrongSubHeadArgs = exitArgsForGateway(wrongSubHeadGateway).map((value, index) => exitArgs[index - 1] === '--expected-sub2api-head' ? '0'.repeat(40) : value);
runExitFailure(wrongSubHeadArgs, 'sub2api_head_mismatch');

const wrongBranchSub2api = path.join(mkdtempSync(path.join(tmpdir(), 'oracle-exit-sub-branch-')), 'sub2api');
execFileSync('git', ['clone', '-q', cliSub2api, wrongBranchSub2api]);
git(wrongBranchSub2api, 'switch', '-q', '-c', 'wrong-phase-branch');
const wrongSubBranchGateway = cloneExitGateway('wrong-sub-branch');
const wrongSubBranchArgs = exitArgsForGateway(wrongSubBranchGateway).map((value, index) => {
  if (exitArgs[index - 1] === '--sub2api-root') return wrongBranchSub2api;
  if (exitArgs[index - 1] === '--contract-path') return path.join(wrongBranchSub2api, 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json');
  return value;
});
runExitFailure(wrongSubBranchArgs, 'sub2api_branch_mismatch');

const dirtySub2api = path.join(mkdtempSync(path.join(tmpdir(), 'oracle-exit-sub-dirty-')), 'sub2api');
execFileSync('git', ['clone', '-q', cliSub2api, dirtySub2api]);
writeFileSync(path.join(dirtySub2api, 'untracked-drift.txt'), 'drift\n');
const dirtySubGateway = cloneExitGateway('dirty-sub');
const dirtySubArgs = exitArgsForGateway(dirtySubGateway).map((value, index) => {
  if (exitArgs[index - 1] === '--sub2api-root') return dirtySub2api;
  if (exitArgs[index - 1] === '--contract-path') return path.join(dirtySub2api, 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json');
  return value;
});
runExitFailure(dirtySubArgs, 'undeclared_dirty_tree');

const staleParentGateway = cloneExitGateway('stale-parent-path');
const staleParentArgs = exitArgsForGateway(staleParentGateway).map((value, index) => exitArgs[index - 1] === '--parent-entry' ? 'docs/superpowers/evidence/phase-0/stale-entry.json' : value);
runExitFailure(staleParentArgs, 'parent_path_mismatch');

const digestMismatchGateway = cloneExitGateway('parent-digest');
const digestMismatchReceiptPath = path.join(digestMismatchGateway, 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.receipt.json');
const digestMismatchReceipt = JSON.parse(readFileSync(digestMismatchReceiptPath, 'utf8'));
digestMismatchReceipt.manifest_sha256 = '0'.repeat(64);
writeFileSync(digestMismatchReceiptPath, `${JSON.stringify(digestMismatchReceipt, null, 2)}\n`);
git(digestMismatchGateway, 'add', '.');
git(digestMismatchGateway, 'commit', '-qm', 'tamper parent digest');
runExitFailure(exitArgsForGateway(digestMismatchGateway), 'parent_manifest_digest_mismatch');

const bootstrapMismatchGateway = cloneExitGateway('parent-bootstrap');
const bootstrapReceiptPath = path.join(bootstrapMismatchGateway, 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.receipt.json');
const bootstrapReceipt = JSON.parse(readFileSync(bootstrapReceiptPath, 'utf8'));
bootstrapReceipt.bootstrap_commit = '0'.repeat(40);
writeFileSync(bootstrapReceiptPath, `${JSON.stringify(bootstrapReceipt, null, 2)}\n`);
git(bootstrapMismatchGateway, 'add', '.');
git(bootstrapMismatchGateway, 'commit', '-qm', 'tamper parent bootstrap');
runExitFailure(exitArgsForGateway(bootstrapMismatchGateway), 'parent_bootstrap_mismatch');

const schemaMismatchGateway = cloneExitGateway('parent-schema');
const schemaReceiptPath = path.join(schemaMismatchGateway, 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.receipt.json');
const schemaReceipt = JSON.parse(readFileSync(schemaReceiptPath, 'utf8'));
schemaReceipt.schema_sha256 = '0'.repeat(64);
writeFileSync(schemaReceiptPath, `${JSON.stringify(schemaReceipt, null, 2)}\n`);
git(schemaMismatchGateway, 'add', '.');
git(schemaMismatchGateway, 'commit', '-qm', 'tamper parent schema digest');
runExitFailure(exitArgsForGateway(schemaMismatchGateway), 'parent_schema_digest_mismatch');

const semanticMismatchGateway = cloneExitGateway('parent-semantic');
const semanticEntryPath = path.join(semanticMismatchGateway, 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json');
const semanticReceiptPath = path.join(semanticMismatchGateway, 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.receipt.json');
const semanticEntry = JSON.parse(readFileSync(semanticEntryPath, 'utf8'));
semanticEntry.contract.sha256 = '0'.repeat(64);
writeFileSync(semanticEntryPath, `${JSON.stringify(semanticEntry, null, 2)}\n`);
const semanticReceipt = JSON.parse(readFileSync(semanticReceiptPath, 'utf8'));
semanticReceipt.manifest_sha256 = sha256(readFileSync(semanticEntryPath));
writeFileSync(semanticReceiptPath, `${JSON.stringify(semanticReceipt, null, 2)}\n`);
git(semanticMismatchGateway, 'add', '.');
git(semanticMismatchGateway, 'commit', '-qm', 'tamper parent semantics');
runExitFailure(exitArgsForGateway(semanticMismatchGateway), 'parent_entry_invalid');

const contractPathGateway = cloneExitGateway('contract-path');
const wrongContractArgs = exitArgsForGateway(contractPathGateway).map((value, index, values) => values[index - 1] === '--contract-path' ? path.join(cliSub2api, 'tracked.txt') : value);
runExitFailure(wrongContractArgs, 'contract_path_mismatch');

const driftedSub2api = path.join(mkdtempSync(path.join(tmpdir(), 'oracle-exit-contract-digest-')), 'sub2api');
execFileSync('git', ['clone', '-q', cliSub2api, driftedSub2api]);
git(driftedSub2api, 'config', 'user.email', 'oracle@example.invalid');
git(driftedSub2api, 'config', 'user.name', 'Oracle Test');
const driftedContract = path.join(driftedSub2api, 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json');
writeFileSync(driftedContract, '{"fixture":"drifted"}\n');
git(driftedSub2api, 'add', '.');
git(driftedSub2api, 'commit', '-qm', 'drift contract digest');
const contractDigestGateway = cloneExitGateway('contract-digest');
const wrongContractDigestArgs = exitArgsForGateway(contractDigestGateway).map((value, index) => {
  if (exitArgs[index - 1] === '--sub2api-root') return driftedSub2api;
  if (exitArgs[index - 1] === '--contract-path') return driftedContract;
  if (exitArgs[index - 1] === '--expected-sub2api-head') return git(driftedSub2api, 'rev-parse', 'HEAD');
  return value;
});
runExitFailure(wrongContractDigestArgs, 'contract_digest_mismatch');

const escapedOutputGateway = cloneExitGateway('output-escape');
const escapedOutputArgs = exitArgsForGateway(escapedOutputGateway).map((value, index, values) => values[index - 1] === '--out' ? '../escaped-exit.json' : value);
runExitFailure(escapedOutputArgs, 'output_path_escape');

const symlinkOutputGateway = cloneExitGateway('output-symlink');
const symlinkOutputPath = path.join(symlinkOutputGateway, exitManifestRelative);
const symlinkExternalTarget = path.join(mkdtempSync(path.join(tmpdir(), 'oracle-exit-symlink-target-')), 'target.json');
writeFileSync(symlinkExternalTarget, 'unchanged\n');
symlinkSync(symlinkExternalTarget, symlinkOutputPath);
const infoExcludePath = git(symlinkOutputGateway, 'rev-parse', '--git-path', 'info/exclude');
writeFileSync(path.resolve(symlinkOutputGateway, infoExcludePath), `${readFileSync(path.resolve(symlinkOutputGateway, infoExcludePath), 'utf8')}\n${exitManifestRelative}\n`);
runExitFailure(exitArgsForGateway(symlinkOutputGateway), 'output_path_symlink');
assert.equal(readFileSync(symlinkExternalTarget, 'utf8'), 'unchanged\n');

const tempSymlinkGateway = cloneExitGateway('temp-symlink');
const tempSymlinkPath = path.join(tempSymlinkGateway, `${exitManifestRelative}.tmp`);
const tempSymlinkExternalTarget = path.join(mkdtempSync(path.join(tmpdir(), 'oracle-exit-temp-symlink-target-')), 'target.json');
writeFileSync(tempSymlinkExternalTarget, 'temp target unchanged\n');
symlinkSync(tempSymlinkExternalTarget, tempSymlinkPath);
const tempInfoExcludePath = path.resolve(tempSymlinkGateway, git(tempSymlinkGateway, 'rev-parse', '--git-path', 'info/exclude'));
writeFileSync(tempInfoExcludePath, `${readFileSync(tempInfoExcludePath, 'utf8')}\n${exitManifestRelative}.tmp\n`);
runExitFailure(exitArgsForGateway(tempSymlinkGateway), 'temporary_path_exists');
assert.equal(existsSync(tempSymlinkPath), true);
assert.equal(readFileSync(tempSymlinkExternalTarget, 'utf8'), 'temp target unchanged\n');

const unknownArgumentGateway = cloneExitGateway('unknown-argument');
runExitFailure([...exitArgsForGateway(unknownArgumentGateway), '--unknown-field', 'value'], 'invalid_arguments');
expectCode(() => captureBaseline({ ...common, contractPath: path.join(sub2api, 'missing.json') }), 'missing_contract');
const outside = path.join(mkdtempSync(path.join(tmpdir(), 'oracle-outside-')), 'vectors.json');
writeFileSync(outside, '{}\n');
const escaped = path.join(sub2api, 'escaped.json');
symlinkSync(outside, escaped);
expectCode(() => captureBaseline({ ...common, contractPath: escaped }), 'contract_symlink_escape');
unlinkSync(escaped);

expectCode(
  () => validateGovernanceMarkers({ requirement_registry: { status: 'absent' }, claim_registry: { status: 'absent_pre_governance_bootstrap' } }),
  'invalid_governance_marker',
);

const manifest = captureBaseline(common);
Object.assign(manifest as any, {
  entry_kind: 'phase_0_entry',
  approved_tool_head: PHASE_0_BINDINGS.ccGatewayHead,
});
(manifest as any).repositories.cc_gateway.head = PHASE_0_BINDINGS.ccGatewayHead;
(manifest as any).repositories.cc_gateway.branch = PHASE_0_BINDINGS.ccGatewayBranch;
(manifest as any).repositories.sub2api.head = PHASE_0_BINDINGS.sub2apiHead;
(manifest as any).repositories.sub2api.branch = PHASE_0_BINDINGS.sub2apiBranch;
(manifest as any).contract.sha256 = PHASE_0_BINDINGS.contractSha256;
(manifest as any).contract.repository_relative_path_base64url = Buffer.from(PHASE_0_BINDINGS.contractRelativePath).toString('base64url');
expectCode(() => validateManifestArtifact({ ...manifest, phase: 'phase_0_exit', entry_kind: 'phase_0_exit' }), 'manifest_schema_invalid');
assert.equal(manifest.repositories.cc_gateway.clean, true);
assert.equal(manifest.repositories.sub2api.clean, true);
assert.equal(manifest.governance.requirement_registry.status, 'absent_pre_governance_bootstrap');
assert.equal(manifest.governance.claim_registry.status, 'absent_pre_governance_bootstrap');
assert.equal(manifest.codegraph.status, 'absent');
assert.match(manifest.codegraph.fallback_reason, /not present/);
assert.equal(manifest.legacy_comparison.requirement_id, 'OL-LEGACY-001');
assert.equal(manifest.legacy_comparison.version, '2.1.197');
assert.equal(manifest.legacy_comparison.authority, 'unverified_legacy');
assert.equal(manifest.legacy_comparison.promotion_eligible, false);
assert.equal(manifest.gateway_compromise_boundary, 'protected_gateway');
assert.equal(JSON.stringify(manifest).includes(gateway), false);
assert.equal(JSON.stringify(manifest).includes(sub2api), false);
assert.equal(readFileSync(contract, 'utf8'), '{"fixture":true}\n');

// Frozen Phase 0 bindings must fail closed in strict capture mode.
expectCode(() => captureBaseline({ ...common, strictBindings: true }), 'cc_gateway_head_mismatch');
assert.deepEqual(PHASE_0_BINDINGS, {
  ccGatewayHead: 'b9745da781397111a77465a1afb6bbbcb7cfd692',
  ccGatewayBranch: 'codex/oracle-phase-0-governance',
  sub2apiHead: 'a0c51e3c674c858fb11b09f21d94d72ec909f554',
  sub2apiBranch: 'codex/oracle-phase-0-governance',
  contractSha256: '70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1',
  contractRelativePath: 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json',
});
const frozenState = { head: PHASE_0_BINDINGS.ccGatewayHead, branch: PHASE_0_BINDINGS.ccGatewayBranch };
const frozenSubState = { head: PHASE_0_BINDINGS.sub2apiHead, branch: PHASE_0_BINDINGS.sub2apiBranch };
validateFrozenBindings(frozenState, frozenSubState, PHASE_0_BINDINGS.ccGatewayHead, PHASE_0_BINDINGS.contractSha256);
expectCode(() => validateFrozenBindings({ ...frozenState, branch: 'HEAD' }, frozenSubState, PHASE_0_BINDINGS.ccGatewayHead, PHASE_0_BINDINGS.contractSha256), 'cc_gateway_branch_mismatch');
expectCode(() => validateFrozenBindings(frozenState, { ...frozenSubState, head: '0'.repeat(40) }, PHASE_0_BINDINGS.ccGatewayHead, PHASE_0_BINDINGS.contractSha256), 'sub2api_head_mismatch');
expectCode(() => validateFrozenBindings(frozenState, frozenSubState, PHASE_0_BINDINGS.ccGatewayHead, '0'.repeat(64)), 'contract_digest_mismatch');

// Strict schema rejects unknown nested fields and the CLI artifact validators enforce both artifacts.
expectCode(() => validateManifestArtifact({ ...manifest, repositories: { ...manifest.repositories, cc_gateway: { ...manifest.repositories.cc_gateway, extra: true } } }), 'manifest_schema_invalid');
expectCode(() => validateReceiptArtifact({ schema_version: '1.0.0', extra: true }), 'receipt_schema_invalid');

// Runtime validation rejects nested type, enum, digest, policy, legacy, and CodeGraph tampering.
const nestedTampering: Array<(candidate: any) => void> = [
  (candidate) => { delete candidate.gateway_compromise_boundary; },
  (candidate) => { candidate.gateway_compromise_boundary = 'trusted_gateway'; },
  (candidate) => { candidate.repositories.cc_gateway.dirty_record_format = 7; },
  (candidate) => { candidate.repositories.cc_gateway.dirty_records = [{ status: 'XX', destination_path_base64url: 'dHJhY2tlZC50eHQ', object_type: 'regular_file', file_mode: '100644', content_sha256: '0'.repeat(64) }]; },
  (candidate) => { candidate.repositories.cc_gateway.dirty_records = [{ status: '??', destination_path_base64url: 'dHJhY2tlZC50eHQ', object_type: 'socket', file_mode: '100644' }]; },
  (candidate) => { candidate.repositories.cc_gateway.dirty_records = [{ status: '??', destination_path_base64url: 'dHJhY2tlZC50eHQ', object_type: 'regular_file', file_mode: '777777', content_sha256: '0'.repeat(64) }]; },
  (candidate) => { candidate.repositories.cc_gateway.dirty_records = [{ status: ' M', destination_path_base64url: 'dHJhY2tlZC50eHQ', object_type: 'regular_file', file_mode: '100644', content_sha256: 'not-a-sha' }]; },
  (candidate) => { candidate.repositories.cc_gateway.ignored_exclusion_rules = [{ source_category: 9, rule_sha256: '0'.repeat(64) }]; },
  (candidate) => { candidate.dependencies.runtime_toolchain.node = 'not-a-sha'; },
  (candidate) => { candidate.dependencies.runtime_toolchain.go = { status: 'present', sha256: '0'.repeat(64), provenance: '' }; },
  (candidate) => { candidate.contract.path_category = 'arbitrary_contract'; },
  (candidate) => { candidate.contract.repository_relative_path_base64url = 42; },
  (candidate) => { candidate.policies.network.real_upstream_requests = 'allowed'; },
  (candidate) => { candidate.policies.network.local_fixture_only = false; },
  (candidate) => { candidate.policies.sensitivity.persisted_material = 'raw_allowed'; },
  (candidate) => { candidate.policies.sensitivity.forbidden = ['raw_prompt']; },
  (candidate) => { candidate.legacy_comparison.requirement_id = 'OL-LEGACY-999'; },
  (candidate) => { candidate.legacy_comparison.use = 'promotion_candidate'; },
  (candidate) => { candidate.legacy_comparison.promotion_eligible = true; },
  (candidate) => { candidate.legacy_comparison.tuple_digests.persona = { status: 'present', sha256: 'bad' }; },
  (candidate) => { candidate.codegraph = { status: 'present', fallback_reason: 'wrong field' }; },
  (candidate) => { candidate.codegraph = { status: 'absent', index_sha256: '0'.repeat(64) }; },
];
for (const tamper of nestedTampering) {
  const candidate = clone(manifest);
  tamper(candidate);
  expectCode(() => validateManifestArtifact(candidate), 'manifest_schema_invalid');
}

const schemaPath = path.join(process.cwd(), 'docs/superpowers/schemas/oracle-lab-run-manifest.schema.json');
const schemaBytes = readFileSync(schemaPath);
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const receiptValue = {
  schema_version: '1.0.0',
  compatibility_policy: 'fail_closed_exact_schema',
  retention_class: 'phase_evidence_permanent',
  redaction_policy: 'digests_only',
  destruction_procedure: 'git_revert_artifact_commit_after_security_approval',
  gateway_compromise_boundary: 'protected_gateway',
  manifest_sha256: sha256(manifestBytes),
  schema_sha256: sha256(schemaBytes),
  bootstrap_commit: PHASE_0_BINDINGS.ccGatewayHead,
};
const receiptWithoutBoundary = clone(receiptValue) as any;
delete receiptWithoutBoundary.gateway_compromise_boundary;
expectCode(() => validateReceiptArtifact(receiptWithoutBoundary), 'receipt_schema_invalid');
expectCode(() => validateReceiptArtifact({ ...receiptValue, gateway_compromise_boundary: 'trusted_gateway' }), 'receipt_schema_invalid');

// Evidence writes validate the supplied manifest/schema linkage before staging either file.
const pairRoot = mkdtempSync(path.join(tmpdir(), 'oracle-evidence-pair-'));
const pairManifest = path.join(pairRoot, 'manifest.json');
const pairReceipt = path.join(pairRoot, 'manifest.receipt.json');
expectCode(
  () => writeEvidencePair(pairManifest, manifest, pairReceipt, { ...receiptValue, manifest_sha256: '0'.repeat(64) }, schemaBytes),
  'receipt_digest_mismatch',
);
assert.equal(existsSync(pairManifest), false);
assert.equal(existsSync(pairReceipt), false);
assert.equal(existsSync(`${pairManifest}.tmp`), false);
assert.equal(existsSync(`${pairReceipt}.tmp`), false);
expectCode(
  () => writeEvidencePair(pairManifest, manifest, pairReceipt, { ...receiptValue, schema_sha256: '0'.repeat(64) }, schemaBytes),
  'receipt_digest_mismatch',
);
writeEvidencePair(pairManifest, manifest, pairReceipt, receiptValue, schemaBytes);
assert.equal(sha256(readFileSync(pairManifest)), receiptValue.manifest_sha256);
assert.equal(JSON.parse(readFileSync(pairReceipt, 'utf8')).schema_sha256, receiptValue.schema_sha256);
assert.equal(existsSync(`${pairManifest}.tmp`), false);
assert.equal(existsSync(`${pairReceipt}.tmp`), false);

// The published schema carries the same strict nested constraints as runtime validation.
const publishedSchema = JSON.parse(schemaBytes.toString('utf8'));
assert.ok(publishedSchema.required.includes('gateway_compromise_boundary'));
assert.deepEqual(publishedSchema.properties.gateway_compromise_boundary, { const: 'protected_gateway' });
assert.ok(publishedSchema.properties.contract.required.includes('repository_role'));
assert.deepEqual(publishedSchema.properties.contract.properties.repository_role, { const: 'sub2api' });
assert.ok(publishedSchema.$defs.repository.required.includes('dirty_record_format'));
assert.deepEqual(publishedSchema.properties.dependencies.properties.runtime_toolchain.properties.node, { $ref: '#/$defs/sha256' });
assert.deepEqual(publishedSchema.$defs.dirtyRecord.properties.object_type.enum, ['regular_file', 'symlink', 'directory', 'submodule', 'deleted', 'other']);
assert.ok(Array.isArray(publishedSchema.properties.codegraph.oneOf));
assert.deepEqual(publishedSchema.properties.parent_reference, { $ref: '#/$defs/parentReference' });
assert.deepEqual(publishedSchema.properties.capture_inputs, { $ref: '#/$defs/captureInputs' });
const entrySchemaRule = publishedSchema.allOf.find((rule: any) => rule.if?.properties?.phase?.const === 'phase_0_entry');
const exitSchemaRule = publishedSchema.allOf.find((rule: any) => rule.if?.properties?.phase?.const === 'phase_0_exit');
assert.deepEqual(entrySchemaRule.then.not.anyOf, [{ required: ['parent_reference'] }, { required: ['capture_inputs'] }]);
assert.ok(exitSchemaRule.then.required.includes('parent_reference'));
assert.ok(exitSchemaRule.then.required.includes('capture_inputs'));
assert.deepEqual(exitSchemaRule.then.properties.governance.properties.requirement_registry, { $ref: '#/$defs/presentDigestMarker' });

// Output parent realpath containment rejects a symlinked parent.
const outputRoot = mkdtempSync(path.join(tmpdir(), 'oracle-output-'));
const outputLink = path.join(gateway, 'out-link');
symlinkSync(outputRoot, outputLink);
expectCode(() => captureBaseline({ ...common, outputPath: path.join(outputLink, 'manifest.json') }), 'output_path_escape');
unlinkSync(outputLink);

// Entry artifacts bind exact frozen heads, branches, contract path and digest.
const entryBindingTampering: Array<(candidate: any) => void> = [
  (candidate) => { candidate.approved_tool_head = 'a'.repeat(40); },
  (candidate) => { candidate.repositories.cc_gateway.head = 'a'.repeat(40); },
  (candidate) => { candidate.repositories.cc_gateway.branch = 'other'; },
  (candidate) => { candidate.repositories.sub2api.head = 'a'.repeat(40); },
  (candidate) => { candidate.repositories.sub2api.branch = 'other'; },
  (candidate) => { candidate.contract.sha256 = '0'.repeat(64); },
  (candidate) => { candidate.contract.repository_relative_path_base64url = Buffer.from('vectors.json').toString('base64url'); },
];
const frozenLike = clone(manifest) as any;
frozenLike.phase = 'phase_0_entry';
frozenLike.entry_kind = 'phase_0_entry';
frozenLike.approved_tool_head = PHASE_0_BINDINGS.ccGatewayHead;
frozenLike.repositories.cc_gateway.head = PHASE_0_BINDINGS.ccGatewayHead;
frozenLike.repositories.cc_gateway.branch = PHASE_0_BINDINGS.ccGatewayBranch;
frozenLike.repositories.sub2api.head = PHASE_0_BINDINGS.sub2apiHead;
frozenLike.repositories.sub2api.branch = PHASE_0_BINDINGS.sub2apiBranch;
frozenLike.contract.sha256 = PHASE_0_BINDINGS.contractSha256;
frozenLike.contract.repository_relative_path_base64url = Buffer.from(PHASE_0_BINDINGS.contractRelativePath).toString('base64url');
assert.equal(frozenLike.contract.repository_role, 'sub2api');

const canonicalExit = clone(frozenLike) as any;
canonicalExit.phase = 'phase_0_exit';
canonicalExit.entry_kind = 'phase_0_exit';
canonicalExit.governance = {
  requirement_registry: { status: 'present', sha256: '0'.repeat(64) },
  claim_registry: { status: 'present', sha256: '1'.repeat(64) },
};
canonicalExit.parent_reference = {
  type: 'phase_0_entry_evidence',
  entry_manifest: {
    repository_relative_path_base64url: Buffer.from('docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json').toString('base64url'),
    sha256: '2'.repeat(64),
  },
  entry_receipt: {
    repository_relative_path_base64url: Buffer.from('docs/superpowers/evidence/phase-0/phase-0-entry-baseline.receipt.json').toString('base64url'),
    sha256: '3'.repeat(64),
  },
};
canonicalExit.capture_inputs = {
  schema: {
    repository_relative_path_base64url: Buffer.from('docs/superpowers/schemas/oracle-lab-run-manifest.schema.json').toString('base64url'),
    sha256: '4'.repeat(64),
  },
  tool: {
    repository_relative_path_base64url: Buffer.from('tools/oracle-lab/freeze-baseline.ts').toString('base64url'),
    sha256: '5'.repeat(64),
  },
};
validateManifestArtifact(canonicalExit);
for (const selectPath of [
  (candidate: any) => candidate.parent_reference.entry_manifest,
  (candidate: any) => candidate.parent_reference.entry_receipt,
  (candidate: any) => candidate.capture_inputs.schema,
  (candidate: any) => candidate.capture_inputs.tool,
]) {
  const candidate = clone(canonicalExit);
  const pathDigest = selectPath(candidate);
  pathDigest.repository_relative_path_base64url = nonCanonicalBase64url(pathDigest.repository_relative_path_base64url);
  expectCode(() => validateManifestArtifact(candidate), 'manifest_schema_invalid');
}

// Every typed path field must have schema/runtime parity, including variable paths.
const variablePathManifest = clone(canonicalExit) as any;
const arbitraryPaths = [
  Buffer.from([0xff]).toString('base64url'),
  Buffer.from([0xff, 0xee]).toString('base64url'),
  Buffer.from([0x76, 0x61, 0x72]).toString('base64url'),
  Buffer.from([0x76, 0x61, 0x72, 0xff]).toString('base64url'),
  Buffer.from([0x76, 0x61, 0x72, 0xff, 0x00]).toString('base64url'),
];
variablePathManifest.repositories.cc_gateway.dirty_records = [{
  status: 'R ',
  destination_path_base64url: arbitraryPaths[0],
  source_path_base64url: arbitraryPaths[1],
  object_type: 'regular_file',
  file_mode: '100644',
  content_sha256: '0'.repeat(64),
}];
variablePathManifest.repositories.cc_gateway.ignored_exclusion_rules = [{
  source_category: 'repository_gitignore',
  source_path_base64url: arbitraryPaths[2],
  rule_sha256: '1'.repeat(64),
}];
variablePathManifest.dependencies.tools = [{ path_base64url: arbitraryPaths[3], sha256: '2'.repeat(64) }];
variablePathManifest.dependencies.observer_parser_canonicalizer = [{ path_base64url: arbitraryPaths[4], sha256: '3'.repeat(64) }];
validateManifestArtifact(variablePathManifest);
assert.deepEqual(arbitraryPaths.map((encoded) => Buffer.from(encoded, 'base64url').toString('base64url')), arbitraryPaths);
const variablePathSelectors: Array<[(candidate: any) => any, string]> = [
  [(candidate) => candidate.repositories.cc_gateway.dirty_records[0], 'destination_path_base64url'],
  [(candidate) => candidate.repositories.cc_gateway.dirty_records[0], 'source_path_base64url'],
  [(candidate) => candidate.repositories.cc_gateway.ignored_exclusion_rules[0], 'source_path_base64url'],
  [(candidate) => candidate.dependencies.tools[0], 'path_base64url'],
  [(candidate) => candidate.dependencies.observer_parser_canonicalizer[0], 'path_base64url'],
];
const nonCanonicalVariableManifests = [];
for (const [selectPath, field] of variablePathSelectors) {
  const candidate = clone(variablePathManifest);
  const pathValue = selectPath(candidate);
  pathValue[field] = nonCanonicalBase64url(pathValue[field]);
  expectCode(() => validateManifestArtifact(candidate), 'manifest_schema_invalid');
  nonCanonicalVariableManifests.push(candidate);
}
assert.deepEqual(
  ajvValidity(publishedSchema, [variablePathManifest, ...nonCanonicalVariableManifests]),
  [true, false, false, false, false, false],
);

const missingContractRole = clone(frozenLike);
delete missingContractRole.contract.repository_role;
expectCode(() => validateManifestArtifact(missingContractRole), 'manifest_schema_invalid');
const wrongContractRole = clone(frozenLike);
wrongContractRole.contract.repository_role = 'cc_gateway';
expectCode(() => validateManifestArtifact(wrongContractRole), 'manifest_schema_invalid');
for (const tamper of entryBindingTampering) {
  const candidate = clone(frozenLike);
  tamper(candidate);
  expectCode(() => validateManifestArtifact(candidate), 'manifest_binding_mismatch');
}

// Staging rejects identical/aliased outputs and pre-existing temporary symlinks.
expectCode(() => writeEvidencePair(pairManifest, frozenLike, pairManifest, receiptValue, schemaBytes), 'output_paths_alias');
const aliasReceipt = path.join(pairRoot, 'alias-receipt.json');
symlinkSync(pairManifest, aliasReceipt);
expectCode(() => writeEvidencePair(pairManifest, frozenLike, aliasReceipt, receiptValue, schemaBytes), 'output_paths_alias');
unlinkSync(aliasReceipt);
symlinkSync(path.join(pairRoot, 'outside-temp'), `${pairManifest}.tmp`);
expectCode(() => writeEvidencePair(pairManifest, frozenLike, pairReceipt, receiptValue, schemaBytes), 'temporary_path_exists');
unlinkSync(`${pairManifest}.tmp`);

// Invalid raw path bytes are retained as bytes in dirty records.
const invalidPath = Buffer.from([0x62, 0x61, 0x64, 0xff]);
const rawRecords = parsePorcelainPathRecords(Buffer.concat([Buffer.from('?? '), invalidPath, Buffer.from([0])]));
assert.equal(rawRecords[0].destination.toString('base64url'), invalidPath.toString('base64url'));

const checkedManifest = JSON.parse(readFileSync(path.join(process.cwd(), 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json'), 'utf8'));
const checkedReceipt = JSON.parse(readFileSync(path.join(process.cwd(), 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.receipt.json'), 'utf8'));
validateManifestArtifact(checkedManifest);
validateReceiptArtifact(checkedReceipt);
assert.equal(checkedManifest.contract.repository_role, 'sub2api');
assert.equal(checkedReceipt.bootstrap_commit, checkedManifest.approved_tool_head);
assert.equal(checkedReceipt.manifest_sha256, sha256(readFileSync(path.join(process.cwd(), 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json'))));
const checkedEvidenceCommit = git(process.cwd(), 'log', '-1', '--format=%H', 'HEAD', '--', 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.receipt.json');
const checkedEvidenceSchema = execFileSync('git', ['show', `${checkedEvidenceCommit}:docs/superpowers/schemas/oracle-lab-run-manifest.schema.json`]);
assert.equal(checkedReceipt.schema_sha256, sha256(checkedEvidenceSchema));

console.log('oracle lab baseline freeze tests passed');
