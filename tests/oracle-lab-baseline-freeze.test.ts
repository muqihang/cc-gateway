import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

// Runtime validation rejects nested type, enum, digest, policy, legacy, and CodeGraph tampering.
const nestedTampering: Array<(candidate: any) => void> = [
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
  manifest_sha256: sha256(manifestBytes),
  schema_sha256: sha256(schemaBytes),
  bootstrap_commit: common.approvedToolHead,
};

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
assert.ok(publishedSchema.$defs.repository.required.includes('dirty_record_format'));
assert.deepEqual(publishedSchema.properties.dependencies.properties.runtime_toolchain.properties.node, { $ref: '#/$defs/sha256' });
assert.deepEqual(publishedSchema.$defs.dirtyRecord.properties.object_type.enum, ['regular_file', 'symlink', 'directory', 'submodule', 'deleted', 'other']);
assert.ok(Array.isArray(publishedSchema.properties.codegraph.oneOf));

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
