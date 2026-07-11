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
  '--out', 'docs/entry.json',
  '--receipt', 'docs/entry.receipt.json',
];
const cliEnvironment = { ...process.env, ORACLE_TEST_BINDINGS: JSON.stringify(cliBindings) };
const tamperedCli = spawnSync('tsx', cliArgs, {
  cwd: mkdtempSync(path.join(tmpdir(), 'oracle-cli-cwd-')),
  encoding: 'utf8',
  env: { ...cliEnvironment, ORACLE_TAMPER_BOOTSTRAP: '1' },
});
assert.equal(tamperedCli.status, 1);
assert.match(tamperedCli.stderr, /"code":"receipt_bootstrap_mismatch"/);
assert.match(tamperedCli.stderr, /receipt bootstrap commit does not match manifest approved tool head/);
assert.equal(existsSync(path.join(cliGateway, 'docs/entry.json')), false);
assert.equal(existsSync(path.join(cliGateway, 'docs/entry.receipt.json')), false);

const successfulCli = spawnSync('tsx', cliArgs, {
  cwd: mkdtempSync(path.join(tmpdir(), 'oracle-cli-cwd-')),
  encoding: 'utf8',
  env: cliEnvironment,
});
assert.equal(successfulCli.status, 0, successfulCli.stderr);
assert.equal(successfulCli.stderr, '');
const cliManifestPath = path.join(cliGateway, 'docs/entry.json');
const cliReceiptPath = path.join(cliGateway, 'docs/entry.receipt.json');
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
validateManifestArtifact({ ...manifest, phase: 'phase_0_exit', entry_kind: 'phase_0_exit' });
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
assert.equal(checkedReceipt.bootstrap_commit, checkedManifest.approved_tool_head);
assert.equal(checkedReceipt.manifest_sha256, sha256(readFileSync(path.join(process.cwd(), 'docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json'))));
assert.equal(checkedReceipt.schema_sha256, sha256(schemaBytes));

console.log('oracle lab baseline freeze tests passed');
