import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  captureBaseline,
  computeRepositoryState,
  validateGovernanceMarkers,
  validateManifestArtifact,
  validateReceiptArtifact,
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
const contract = path.join(sub2api, 'vectors.json');
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
validateManifestArtifact(manifest);
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

// Output parent realpath containment rejects a symlinked parent.
const outputRoot = mkdtempSync(path.join(tmpdir(), 'oracle-output-'));
const outputLink = path.join(gateway, 'out-link');
symlinkSync(outputRoot, outputLink);
expectCode(() => captureBaseline({ ...common, outputPath: path.join(outputLink, 'manifest.json') }), 'output_path_escape');
unlinkSync(outputLink);

// Invalid raw path bytes are retained as bytes in dirty records.
const invalidPath = Buffer.from([0x62, 0x61, 0x64, 0xff]);
const rawRecords = parsePorcelainPathRecords(Buffer.concat([Buffer.from('?? '), invalidPath, Buffer.from([0])]));
assert.equal(rawRecords[0].destination.toString('base64url'), invalidPath.toString('base64url'));

const checkedManifest = JSON.parse(readFileSync(path.join(process.cwd(), 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json'), 'utf8'));
const checkedReceipt = JSON.parse(readFileSync(path.join(process.cwd(), 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.receipt.json'), 'utf8'));
validateManifestArtifact(checkedManifest);
validateReceiptArtifact(checkedReceipt);

console.log('oracle lab baseline freeze tests passed');
