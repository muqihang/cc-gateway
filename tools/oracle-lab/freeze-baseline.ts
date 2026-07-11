import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type DigestMarker = { status: 'present'; sha256: string } | { status: 'absent'; reason: string };
type GovernanceMarker = { status: 'absent_pre_governance_bootstrap' } | { status: 'present'; sha256: string };
type ToolDigest = { status: 'present'; sha256: string; provenance: string } | { status: 'absent'; reason: 'tool_not_found'; required: boolean };

export const PHASE_0_BINDINGS = {
  ccGatewayHead: 'b9745da781397111a77465a1afb6bbbcb7cfd692',
  ccGatewayBranch: 'codex/oracle-phase-0-governance',
  sub2apiHead: 'a0c51e3c674c858fb11b09f21d94d72ec909f554',
  sub2apiBranch: 'codex/oracle-phase-0-governance',
  contractSha256: '70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1',
  contractRelativePath: 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json',
} as const;

export type DirtyRecord = {
  status: string;
  destination_path_base64url: string;
  source_path_base64url?: string;
  object_type: 'regular_file' | 'symlink' | 'directory' | 'submodule' | 'deleted' | 'other';
  file_mode: string;
  content_sha256?: string;
  symlink_target_sha256?: string;
  deletion_marker?: true;
  submodule_head?: string;
  submodule_dirty?: boolean;
};

export type RepositoryState = {
  head: string;
  branch: string;
  clean: boolean;
  dirty_digest: string;
  dirty_records: DirtyRecord[];
  dirty_record_format: string;
  ignored_exclusion_rules: Array<{ source_category: string; source_path_base64url?: string; rule_sha256: string }>;
};

export type BaselineOptions = {
  ccGatewayRoot: string;
  sub2apiRoot: string;
  contractPath: string;
  approvedToolHead: string;
  allowCcGatewayDirtyDigest?: string;
  allowSub2apiDirtyDigest?: string;
  strictBindings?: boolean;
  outputPath?: string;
};

export type BaselineManifest = ReturnType<typeof captureBaseline>;

class BaselineError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const EMPTY_SHA256 = sha256(Buffer.alloc(0));
const GOVERNANCE_ABSENCE = 'absent_pre_governance_bootstrap' as const;
const RECORD_FORMAT = 'u32be_length_prefixed_fields(status,destination,source,object_type,file_mode,content_sha256,symlink_target_sha256,deletion_marker,submodule_head,submodule_dirty); records sorted by destination bytes then source bytes; sha256(records || git_diff_binary_head)';

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function run(root: string, args: string[], encoding: 'utf8' | 'buffer' = 'utf8'): any {
  return execFileSync(args[0], args.slice(1), { cwd: root, encoding: encoding === 'buffer' ? 'buffer' : 'utf8' });
}

function gitBuffer(root: string, ...args: string[]): Buffer {
  return run(root, ['git', ...args], 'buffer');
}

function gitText(root: string, ...args: string[]): string {
  return String(run(root, ['git', ...args], 'utf8')).trim();
}

function encodePath(value: Buffer): string {
  return value.toString('base64url');
}

function field(value: Buffer | string | undefined): Buffer {
  const bytes = value === undefined ? Buffer.alloc(0) : Buffer.isBuffer(value) ? value : Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function bufferPath(root: string, relative: Buffer): Buffer {
  return Buffer.concat([Buffer.from(root), Buffer.from(path.sep), relative]);
}

function indexEntries(root: string): Map<string, { mode: string; object: string; path: Buffer }> {
  const output = gitBuffer(root, 'ls-files', '-s', '-z');
  const entries = new Map<string, { mode: string; object: string; path: Buffer }>();
  let start = 0;
  for (let i = 0; i < output.length; i++) {
    if (output[i] !== 0) continue;
    const entry = output.subarray(start, i);
    start = i + 1;
    const tab = entry.indexOf(0x09);
    const metadata = entry.subarray(0, tab).toString('ascii').split(' ');
    const rawPath = Buffer.from(entry.subarray(tab + 1));
    entries.set(encodePath(rawPath), { mode: metadata[0], object: metadata[1], path: rawPath });
  }
  return entries;
}

function statRecord(root: string, status: string, destination: Buffer, source: Buffer | undefined, index: Map<string, { mode: string; object: string; path: Buffer }>): DirtyRecord {
  const target = bufferPath(root, destination);
  const base = {
    status,
    destination_path_base64url: encodePath(destination),
    ...(source ? { source_path_base64url: encodePath(source) } : {}),
  };
  if (!existsSync(target)) {
    return { ...base, object_type: 'deleted', file_mode: '000000', deletion_marker: true };
  }
  const stat = lstatSync(target);
  const indexMode = index.get(encodePath(destination))?.mode || '';
  const mode = indexMode || (stat.isSymbolicLink() ? '120000' : stat.isDirectory() ? '040000' : (stat.mode & 0o111) ? '100755' : '100644');
  if (mode === '160000') {
    let head = 'unavailable';
    let dirty = true;
    try {
      const targetText = target.toString();
      head = gitText(targetText, 'rev-parse', 'HEAD');
      dirty = gitBuffer(targetText, 'status', '--porcelain=v1', '-z', '--untracked-files=all').length > 0;
    } catch { /* fail-closed state is represented */ }
    return { ...base, object_type: 'submodule', file_mode: mode, submodule_head: head, submodule_dirty: dirty };
  }
  if (stat.isSymbolicLink()) {
    return { ...base, object_type: 'symlink', file_mode: mode, symlink_target_sha256: sha256(readlinkSync(target, { encoding: 'buffer' })) };
  }
  if (stat.isFile()) {
    return { ...base, object_type: 'regular_file', file_mode: mode, content_sha256: sha256(readFileSync(target)) };
  }
  return { ...base, object_type: stat.isDirectory() ? 'directory' : 'other', file_mode: mode };
}

export function parsePorcelainPathRecords(output: Buffer): Array<{ status: string; destination: Buffer; source?: Buffer }> {
  const parts: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < output.length; i++) {
    if (output[i] === 0) {
      parts.push(output.subarray(start, i));
      start = i + 1;
    }
  }
  const parsed: Array<{ status: string; destination: Buffer; source?: Buffer }> = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4 || entry[2] !== 0x20) throw new BaselineError('invalid_git_status', 'unexpected porcelain v1 -z record');
    const status = entry.subarray(0, 2).toString('ascii');
    const destination = Buffer.from(entry.subarray(3));
    let source: Buffer | undefined;
    if (status.includes('R') || status.includes('C')) source = Buffer.from(parts[++i] || Buffer.alloc(0));
    parsed.push({ status, destination, source });
  }
  return parsed.sort((a, b) => Buffer.compare(a.destination, b.destination) || Buffer.compare(a.source || Buffer.alloc(0), b.source || Buffer.alloc(0)));
}

function parsePorcelain(root: string, output: Buffer, index: Map<string, { mode: string; object: string; path: Buffer }>): Array<{ destination: Buffer; source?: Buffer; record: DirtyRecord }> {
  return parsePorcelainPathRecords(output).map(({ status, destination, source }) => ({ destination, source, record: statRecord(root, status, destination, source, index) }));
}

function serializeRecord(record: DirtyRecord, destination: Buffer, source?: Buffer): Buffer {
  return Buffer.concat([
    field(record.status), field(destination), field(source), field(record.object_type), field(record.file_mode),
    field(record.content_sha256), field(record.symlink_target_sha256), field(record.deletion_marker ? '1' : ''),
    field(record.submodule_head), field(record.submodule_dirty === undefined ? '' : record.submodule_dirty ? '1' : '0'),
  ]);
}

function exclusionRules(root: string): RepositoryState['ignored_exclusion_rules'] {
  const sources: Array<{ category: string; relative?: string; absolute: string }> = [];
  for (const relative of gitBuffer(root, 'ls-files', '-z', '--', '.gitignore', '**/.gitignore').toString('utf8').split('\0').filter(Boolean)) {
    sources.push({ category: 'repository_gitignore', relative, absolute: path.join(root, relative) });
  }
  const gitDir = gitText(root, 'rev-parse', '--git-dir');
  const infoExclude = path.resolve(root, gitDir, 'info/exclude');
  if (existsSync(infoExclude)) sources.push({ category: 'repository_info_exclude', absolute: infoExclude });
  try {
    const globalPath = gitText(root, 'config', '--path', '--get', 'core.excludesFile');
    if (globalPath && existsSync(globalPath)) sources.push({ category: 'global_excludes', absolute: globalPath });
  } catch { /* no global excludes file */ }
  return sources.flatMap((source) => readFileSync(source.absolute, 'utf8').split(/\r?\n/)
    .filter((rule) => rule.length > 0 && !rule.startsWith('#'))
    .map((rule) => ({
      source_category: source.category,
      ...(source.relative ? { source_path_base64url: Buffer.from(source.relative).toString('base64url') } : {}),
      rule_sha256: sha256(rule),
    })));
}

export function computeRepositoryState(rootInput: string, allowedDirtyDigest?: string, inspectOnly = false): RepositoryState {
  const root = realpathSync(rootInput);
  const index = indexEntries(root);
  const status = gitBuffer(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all');
  const parsed = parsePorcelain(root, status, index);
  const seen = new Set(parsed.map(({ destination }) => encodePath(destination)));
  for (const entry of index.values()) {
    if (entry.mode !== '160000' || seen.has(encodePath(entry.path))) continue;
    const target = bufferPath(root, entry.path);
    let head = 'unavailable';
    let dirty = true;
    try {
      head = gitText(target.toString(), 'rev-parse', 'HEAD');
      dirty = gitBuffer(target.toString(), 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none').length > 0;
    } catch { /* missing/unreadable submodule is drift */ }
    if (head !== entry.object || dirty) {
      parsed.push({ destination: entry.path, record: { status: 'SM', destination_path_base64url: encodePath(entry.path), object_type: 'submodule', file_mode: '160000', submodule_head: head, submodule_dirty: dirty } });
    }
  }
  parsed.sort((a, b) => Buffer.compare(a.destination, b.destination) || Buffer.compare(a.source || Buffer.alloc(0), b.source || Buffer.alloc(0)));
  const diff = gitBuffer(root, 'diff', '--binary', 'HEAD');
  const serialized = Buffer.concat(parsed.map(({ record, destination, source }) => serializeRecord(record, destination, source)));
  const dirtyDigest = sha256(Buffer.concat([serialized, diff]));
  const clean = parsed.length === 0 && diff.length === 0;
  if (!clean && !inspectOnly) {
    if (!allowedDirtyDigest) throw new BaselineError('undeclared_dirty_tree', 'repository has undeclared tracked, untracked, or submodule changes');
    if (allowedDirtyDigest !== dirtyDigest) throw new BaselineError('dirty_digest_mismatch', 'declared dirty digest does not match complete repository state');
  }
  if (clean && allowedDirtyDigest && allowedDirtyDigest !== dirtyDigest) {
    throw new BaselineError('dirty_digest_mismatch', 'declared dirty digest does not match clean repository state');
  }
  return {
    head: gitText(root, 'rev-parse', 'HEAD'),
    branch: gitText(root, 'rev-parse', '--abbrev-ref', 'HEAD'),
    clean,
    dirty_digest: dirtyDigest,
    dirty_records: parsed.map((item) => item.record),
    dirty_record_format: RECORD_FORMAT,
    ignored_exclusion_rules: exclusionRules(root),
  };
}

function digestFile(root: string, relative: string): DigestMarker {
  const absolute = path.join(root, relative);
  return existsSync(absolute) ? { status: 'present', sha256: sha256(readFileSync(absolute)) } : { status: 'absent', reason: 'path_not_present_at_entry' };
}

function digestMatchingFiles(root: string, predicate: (relative: string) => boolean): Array<{ path_base64url: string; sha256: string }> {
  const files = gitBuffer(root, 'ls-files', '-z').toString('utf8').split('\0').filter(Boolean).filter(predicate).sort();
  return files.map((relative) => ({ path_base64url: Buffer.from(relative).toString('base64url'), sha256: sha256(readFileSync(path.join(root, relative))) }));
}

function digestTree(root: string): string {
  const entries: Buffer[] = [];
  const walk = (directory: string, prefix = ''): void => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(absolute);
      entries.push(field(relative));
      entries.push(field(stat.isFile() ? sha256(readFileSync(absolute)) : stat.isSymbolicLink() ? sha256(readlinkSync(absolute)) : 'directory'));
      if (stat.isDirectory()) walk(absolute, relative);
    }
  };
  walk(root);
  return sha256(Buffer.concat(entries));
}

export function validateGovernanceMarkers(governance: Record<string, any>): void {
  for (const key of ['requirement_registry', 'claim_registry']) {
    const marker = governance[key];
    if (!marker || (marker.status !== GOVERNANCE_ABSENCE && !(marker.status === 'present' && /^[0-9a-f]{64}$/.test(marker.sha256)))) {
      throw new BaselineError('invalid_governance_marker', `${key} must be an explicit bootstrap absence marker or a digest`);
    }
  }
}

function governanceMarker(root: string, relative: string): GovernanceMarker {
  return existsSync(path.join(root, relative))
    ? { status: 'present', sha256: sha256(readFileSync(path.join(root, relative))) }
    : { status: GOVERNANCE_ABSENCE };
}

function ensureOutputContainment(rootInput: string, candidateInput: string): void {
  const root = realpathSync(rootInput);
  const candidate = path.resolve(candidateInput);
  const parent = path.dirname(candidate);
  const parentReal = realpathSync(parent);
  if (!pathInside(root, parentReal) || !pathInside(root, candidate)) throw new BaselineError('output_path_escape', 'output parent must resolve inside CC Gateway root');
}

function exactObject(value: unknown, keys: string[], code: string): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BaselineError(code, 'expected object');
  const actual = Object.keys(value as object).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i])) throw new BaselineError(code, `unexpected or missing properties: ${actual.join(',')}`);
}

function validSha(value: unknown): boolean { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }
function validCommit(value: unknown): boolean { return typeof value === 'string' && /^[0-9a-f]{40,64}$/.test(value); }
function validPathBytes(value: unknown): boolean { return typeof value === 'string' && value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value); }
const DIRTY_STATUSES = new Set(['??', '!!', 'SM', ' M', 'M ', 'MM', ' T', 'T ', 'TT', 'A ', 'AM', 'AT', ' D', 'D ', 'DT', 'R ', 'RM', 'RT', 'C ', 'CM', 'CT', 'DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
const OBJECT_TYPES = new Set(['regular_file', 'symlink', 'directory', 'submodule', 'deleted', 'other']);
const FILE_MODES = new Set(['000000', '040000', '100644', '100755', '120000', '160000']);
const ABSENT_REASON = 'path_not_present_at_entry';
function validateRepositoryArtifact(value: unknown): void {
  exactObject(value, ['head', 'branch', 'clean', 'dirty_digest', 'dirty_records', 'dirty_record_format', 'ignored_exclusion_rules'], 'manifest_schema_invalid');
  const repository = value as any;
  if (typeof repository.branch !== 'string' || repository.branch.length === 0 || typeof repository.clean !== 'boolean' || !validCommit(repository.head) || !validSha(repository.dirty_digest) || repository.dirty_record_format !== RECORD_FORMAT || !Array.isArray(repository.dirty_records) || !Array.isArray(repository.ignored_exclusion_rules)) throw new BaselineError('manifest_schema_invalid', 'invalid repository properties');
  for (const record of (value as any).dirty_records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new BaselineError('manifest_schema_invalid', 'invalid dirty record');
    const keys = ['status', 'destination_path_base64url', 'object_type', 'file_mode', 'source_path_base64url', 'content_sha256', 'symlink_target_sha256', 'deletion_marker', 'submodule_head', 'submodule_dirty'];
    if (Object.keys(record).some((key) => !keys.includes(key))) throw new BaselineError('manifest_schema_invalid', 'unknown dirty record field');
    if (typeof record.status !== 'string' || !DIRTY_STATUSES.has(record.status) || !validPathBytes(record.destination_path_base64url) || (record.source_path_base64url !== undefined && !validPathBytes(record.source_path_base64url)) || !OBJECT_TYPES.has(record.object_type) || !FILE_MODES.has(record.file_mode)) throw new BaselineError('manifest_schema_invalid', 'invalid dirty record fields');
    if (record.content_sha256 !== undefined && !validSha(record.content_sha256)) throw new BaselineError('manifest_schema_invalid', 'invalid content digest');
    if (record.symlink_target_sha256 !== undefined && !validSha(record.symlink_target_sha256)) throw new BaselineError('manifest_schema_invalid', 'invalid symlink digest');
    if (record.deletion_marker !== undefined && record.deletion_marker !== true) throw new BaselineError('manifest_schema_invalid', 'invalid deletion marker');
    if (record.submodule_head !== undefined && !validCommit(record.submodule_head)) throw new BaselineError('manifest_schema_invalid', 'invalid submodule head');
    if (record.submodule_dirty !== undefined && typeof record.submodule_dirty !== 'boolean') throw new BaselineError('manifest_schema_invalid', 'invalid submodule dirty state');
    if (record.object_type === 'regular_file' && !validSha(record.content_sha256)) throw new BaselineError('manifest_schema_invalid', 'regular file requires content digest');
    if (record.object_type === 'symlink' && !validSha(record.symlink_target_sha256)) throw new BaselineError('manifest_schema_invalid', 'symlink requires target digest');
    if (record.object_type === 'deleted' && record.deletion_marker !== true) throw new BaselineError('manifest_schema_invalid', 'deleted record requires deletion marker');
    if (record.object_type === 'submodule' && (!validCommit(record.submodule_head) || typeof record.submodule_dirty !== 'boolean')) throw new BaselineError('manifest_schema_invalid', 'submodule requires provenance');
    const sourceExpected = record.status[0] === 'R' || record.status[0] === 'C';
    if (sourceExpected !== (record.source_path_base64url !== undefined)) throw new BaselineError('manifest_schema_invalid', 'rename/copy source field incompatible with status');
    if (record.object_type !== 'regular_file' && record.content_sha256 !== undefined) throw new BaselineError('manifest_schema_invalid', 'content digest incompatible with object type');
    if (record.object_type !== 'symlink' && record.symlink_target_sha256 !== undefined) throw new BaselineError('manifest_schema_invalid', 'symlink digest incompatible with object type');
    if (record.object_type !== 'deleted' && record.deletion_marker !== undefined) throw new BaselineError('manifest_schema_invalid', 'deletion marker incompatible with object type');
    if (record.object_type !== 'submodule' && (record.submodule_head !== undefined || record.submodule_dirty !== undefined)) throw new BaselineError('manifest_schema_invalid', 'submodule fields incompatible with object type');
  }
  for (const rule of repository.ignored_exclusion_rules) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new BaselineError('manifest_schema_invalid', 'invalid exclusion rule');
    exactObject(rule, ['source_category', ...(rule.source_path_base64url === undefined ? [] : ['source_path_base64url']), 'rule_sha256'], 'manifest_schema_invalid');
    if (!['repository_gitignore', 'repository_info_exclude', 'global_excludes'].includes(rule.source_category) || (rule.source_path_base64url !== undefined && !validPathBytes(rule.source_path_base64url)) || !validSha(rule.rule_sha256)) throw new BaselineError('manifest_schema_invalid', 'invalid exclusion rule');
  }
}

function validateDigestMarker(value: unknown): void {
  const marker = value as any;
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) throw new BaselineError('manifest_schema_invalid', 'invalid dependency digest marker');
  if (marker.status === 'present') { exactObject(marker, ['status', 'sha256'], 'manifest_schema_invalid'); if (!validSha(marker.sha256)) throw new BaselineError('manifest_schema_invalid', 'invalid dependency digest marker'); return; }
  exactObject(marker, ['status', 'reason'], 'manifest_schema_invalid');
  if (marker.status !== 'absent' || marker.reason !== ABSENT_REASON) throw new BaselineError('manifest_schema_invalid', 'invalid dependency digest marker');
}

export function validateManifestArtifact(value: unknown): void {
  exactObject(value, ['schema_version', 'compatibility_policy', 'retention_class', 'redaction_policy', 'destruction_procedure', 'phase', 'entry_kind', 'approved_tool_head', 'repositories', 'contract', 'governance', 'policies', 'dependencies', 'codegraph', 'legacy_comparison'], 'manifest_schema_invalid');
  const v = value as any;
  if (v.schema_version !== '1.0.0' || v.compatibility_policy !== 'fail_closed_exact_schema' || v.retention_class !== 'phase_evidence_permanent' || v.redaction_policy !== 'digests_and_safe_categories_only' || v.destruction_procedure !== 'git_revert_artifact_commit_after_security_approval' || !['phase_0_entry', 'phase_0_exit'].includes(v.phase) || v.entry_kind !== v.phase || !validCommit(v.approved_tool_head)) throw new BaselineError('manifest_schema_invalid', 'invalid manifest header');
  exactObject(v.repositories, ['cc_gateway', 'sub2api'], 'manifest_schema_invalid'); validateRepositoryArtifact(v.repositories.cc_gateway); validateRepositoryArtifact(v.repositories.sub2api);
  exactObject(v.contract, ['path_category', 'repository_relative_path_base64url', 'sha256'], 'manifest_schema_invalid'); if (v.contract.path_category !== 'sub2api_formal_pool_contract' || !validPathBytes(v.contract.repository_relative_path_base64url) || !validSha(v.contract.sha256)) throw new BaselineError('manifest_schema_invalid', 'invalid contract');
  exactObject(v.governance, ['requirement_registry', 'claim_registry'], 'manifest_schema_invalid'); validateGovernanceMarkers(v.governance);
  exactObject(v.policies, ['network', 'sensitivity'], 'manifest_schema_invalid'); exactObject(v.policies.network, ['real_upstream_requests', 'local_fixture_only'], 'manifest_schema_invalid'); if (v.policies.network.real_upstream_requests !== 'forbidden' || v.policies.network.local_fixture_only !== true) throw new BaselineError('manifest_schema_invalid', 'invalid network policy'); exactObject(v.policies.sensitivity, ['persisted_material', 'forbidden'], 'manifest_schema_invalid'); if (v.policies.sensitivity.persisted_material !== 'safe_categories_and_sha256_digests_only' || !Array.isArray(v.policies.sensitivity.forbidden) || JSON.stringify(v.policies.sensitivity.forbidden) !== JSON.stringify(['raw_prompt', 'raw_body', 'credential', 'raw_cch', 'raw_client_hello', 'account_identifier', 'proxy_credential'])) throw new BaselineError('manifest_schema_invalid', 'invalid sensitivity policy');
  const dependencyKeys = ['persona_registry', 'persona_resolver', 'request_policy', 'tls_registry', 'cch_request_construction', 'sidecar_profile', 'sidecar_summary', 'package_manifest', 'package_lock', 'sidecar_go_manifest', 'sidecar_go_lock', 'repository_root_metadata', 'tools', 'observer_parser_canonicalizer', 'runtime_toolchain'];
  exactObject(v.dependencies, dependencyKeys, 'manifest_schema_invalid');
  for (const key of dependencyKeys.slice(0, 11)) validateDigestMarker(v.dependencies[key]);
  exactObject(v.dependencies.repository_root_metadata, ['cc_gateway_augmentroot', 'sub2api_augmentroot'], 'manifest_schema_invalid'); validateDigestMarker(v.dependencies.repository_root_metadata.cc_gateway_augmentroot); validateDigestMarker(v.dependencies.repository_root_metadata.sub2api_augmentroot);
  for (const list of [v.dependencies.tools, v.dependencies.observer_parser_canonicalizer]) { if (!Array.isArray(list)) throw new BaselineError('manifest_schema_invalid', 'dependency file list must be an array'); for (const item of list) { exactObject(item, ['path_base64url', 'sha256'], 'manifest_schema_invalid'); if (!validPathBytes(item.path_base64url) || !validSha(item.sha256)) throw new BaselineError('manifest_schema_invalid', 'invalid dependency file digest'); } }
  exactObject(v.dependencies.runtime_toolchain, ['node', 'git', 'npm', 'go'], 'manifest_schema_invalid');
  if (!validSha(v.dependencies.runtime_toolchain.node) || !validSha(v.dependencies.runtime_toolchain.git) || !validSha(v.dependencies.runtime_toolchain.npm)) throw new BaselineError('manifest_schema_invalid', 'invalid runtime digest');
  const go = v.dependencies.runtime_toolchain.go; exactObject(go, go?.status === 'present' ? ['status', 'sha256', 'provenance'] : ['status', 'reason', 'required'], 'manifest_schema_invalid');
  if (go.status === 'present' ? !validSha(go.sha256) || typeof go.provenance !== 'string' || go.provenance.length === 0 : go.status !== 'absent' || go.reason !== 'tool_not_found' || go.required !== true) throw new BaselineError('manifest_schema_invalid', 'invalid Go provenance');
  exactObject(v.codegraph, v.codegraph?.status === 'present' ? ['status', 'index_sha256'] : ['status', 'fallback_reason'], 'manifest_schema_invalid'); if (v.codegraph.status === 'present' ? !validSha(v.codegraph.index_sha256) : v.codegraph.status !== 'absent' || typeof v.codegraph.fallback_reason !== 'string' || v.codegraph.fallback_reason.length === 0) throw new BaselineError('manifest_schema_invalid', 'invalid CodeGraph provenance');
  exactObject(v.legacy_comparison, ['requirement_id', 'version', 'authority', 'use', 'promotion_eligible', 'tuple_digests'], 'manifest_schema_invalid');
  if (v.legacy_comparison.requirement_id !== 'OL-LEGACY-001' || v.legacy_comparison.version !== '2.1.197' || v.legacy_comparison.authority !== 'unverified_legacy' || v.legacy_comparison.use !== 'comparison_only' || v.legacy_comparison.promotion_eligible !== false) throw new BaselineError('manifest_schema_invalid', 'invalid legacy comparison controls');
  exactObject(v.legacy_comparison.tuple_digests, ['persona', 'request_shape', 'cch', 'tls'], 'manifest_schema_invalid'); for (const tuple of Object.values(v.legacy_comparison.tuple_digests)) validateDigestMarker(tuple);
  if (v.phase === 'phase_0_entry' && (v.approved_tool_head !== PHASE_0_BINDINGS.ccGatewayHead || v.repositories.cc_gateway.head !== PHASE_0_BINDINGS.ccGatewayHead || v.repositories.cc_gateway.branch !== PHASE_0_BINDINGS.ccGatewayBranch || v.repositories.sub2api.head !== PHASE_0_BINDINGS.sub2apiHead || v.repositories.sub2api.branch !== PHASE_0_BINDINGS.sub2apiBranch || v.contract.sha256 !== PHASE_0_BINDINGS.contractSha256 || Buffer.from(v.contract.repository_relative_path_base64url, 'base64url').toString() !== PHASE_0_BINDINGS.contractRelativePath)) throw new BaselineError('manifest_binding_mismatch', 'entry artifact does not match frozen Phase 0 bindings');
}

export function validateReceiptArtifact(value: unknown): void {
  exactObject(value, ['schema_version', 'compatibility_policy', 'retention_class', 'redaction_policy', 'destruction_procedure', 'manifest_sha256', 'schema_sha256', 'bootstrap_commit'], 'receipt_schema_invalid');
  const v = value as any;
  if (v.schema_version !== '1.0.0' || v.compatibility_policy !== 'fail_closed_exact_schema' || v.retention_class !== 'phase_evidence_permanent' || v.redaction_policy !== 'digests_only' || v.destruction_procedure !== 'git_revert_artifact_commit_after_security_approval' || !validSha(v.manifest_sha256) || !validSha(v.schema_sha256) || !validCommit(v.bootstrap_commit)) throw new BaselineError('receipt_schema_invalid', 'invalid receipt');
}

export function writeEvidencePair(out: string, manifest: unknown, receiptPath: string, receiptValue: unknown, schemaBytes: Buffer): void {
  validateManifestArtifact(manifest);
  validateReceiptArtifact(receiptValue);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const validatedReceipt = receiptValue as any;
  if (validatedReceipt.manifest_sha256 !== sha256(manifestBytes) || validatedReceipt.schema_sha256 !== sha256(schemaBytes)) throw new BaselineError('receipt_digest_mismatch', 'receipt does not bind supplied manifest and schema');
  if (validatedReceipt.bootstrap_commit !== (manifest as any).approved_tool_head) throw new BaselineError('receipt_bootstrap_mismatch', 'receipt bootstrap commit does not match manifest approved tool head');
  writeEvidencePairInternal(out, manifest, receiptPath, receiptValue);
}

export function validateFrozenBindings(ccState: Pick<RepositoryState, 'head' | 'branch'>, subState: Pick<RepositoryState, 'head' | 'branch'>, approvedToolHead: string, contractSha: string): void {
  if (ccState.head !== PHASE_0_BINDINGS.ccGatewayHead) throw new BaselineError('cc_gateway_head_mismatch', 'CC Gateway HEAD is not the frozen Phase 0 bootstrap head');
  if (ccState.branch !== PHASE_0_BINDINGS.ccGatewayBranch) throw new BaselineError('cc_gateway_branch_mismatch', 'CC Gateway branch is not the frozen Phase 0 governance branch');
  if (subState.head !== PHASE_0_BINDINGS.sub2apiHead) throw new BaselineError('sub2api_head_mismatch', 'Sub2API HEAD is not the frozen Phase 0 head');
  if (subState.branch !== PHASE_0_BINDINGS.sub2apiBranch) throw new BaselineError('sub2api_branch_mismatch', 'Sub2API branch is not the frozen Phase 0 governance branch');
  if (approvedToolHead !== PHASE_0_BINDINGS.ccGatewayHead) throw new BaselineError('approved_tool_head_mismatch', 'approved tool commit does not match frozen bootstrap head');
  if (contractSha !== PHASE_0_BINDINGS.contractSha256) throw new BaselineError('contract_digest_mismatch', 'formal-pool contract digest is not the frozen Phase 0 digest');
}

export function captureBaseline(options: BaselineOptions) {
  const ccRoot = realpathSync(options.ccGatewayRoot);
  const subRoot = realpathSync(options.sub2apiRoot);
  if (!existsSync(options.contractPath)) throw new BaselineError('missing_contract', 'formal-pool contract does not exist');
  const contractReal = realpathSync(options.contractPath);
  if (!pathInside(subRoot, contractReal)) throw new BaselineError('contract_symlink_escape', 'formal-pool contract resolves outside the declared Sub2API root');
  if (path.relative(subRoot, contractReal).split(path.sep).join('/') !== PHASE_0_BINDINGS.contractRelativePath) throw new BaselineError('contract_path_mismatch', 'formal-pool contract must use the frozen repository-relative path');
  if (options.outputPath) ensureOutputContainment(ccRoot, options.outputPath);
  const ccState = computeRepositoryState(ccRoot, options.allowCcGatewayDirtyDigest);
  const subState = computeRepositoryState(subRoot, options.allowSub2apiDirtyDigest);
  const strict = options.strictBindings !== false;
  if (!/^[0-9a-f]{40,64}$/.test(options.approvedToolHead) || (!strict && options.approvedToolHead !== ccState.head)) {
    throw new BaselineError('approved_tool_head_mismatch', 'approved tool commit must exactly equal the CC Gateway repository HEAD');
  }
  const contractSha = sha256(readFileSync(contractReal));
  if (strict) validateFrozenBindings(ccState, subState, options.approvedToolHead, contractSha);
  const governance = {
    requirement_registry: governanceMarker(ccRoot, 'docs/superpowers/registry/oracle-lab-requirements.json'),
    claim_registry: governanceMarker(ccRoot, 'docs/superpowers/registry/oracle-lab-claims.json'),
  };
  validateGovernanceMarkers(governance);
  const codegraphRoot = path.join(ccRoot, '.codegraph');
  const codegraph = existsSync(codegraphRoot)
    ? { status: 'present' as const, index_sha256: digestTree(codegraphRoot) }
    : { status: 'absent' as const, fallback_reason: '.codegraph directory not present; deterministic git/file discovery used' };
  const runtimeDigests = {
    node: sha256(process.version),
    git: sha256(gitText(ccRoot, '--version')),
    npm: sha256(String(run(ccRoot, ['npm', '--version'], 'utf8')).trim()),
    go: (() => { try { const provenance = String(run(ccRoot, ['go', 'version'], 'utf8')).trim(); return { status: 'present' as const, sha256: sha256(provenance), provenance }; } catch { return { status: 'absent' as const, reason: 'tool_not_found' as const, required: true }; } })(),
  };
  return {
    schema_version: '1.0.0',
    compatibility_policy: 'fail_closed_exact_schema',
    retention_class: 'phase_evidence_permanent',
    redaction_policy: 'digests_and_safe_categories_only',
    destruction_procedure: 'git_revert_artifact_commit_after_security_approval',
    phase: 'phase_0_entry',
    entry_kind: 'phase_0_entry',
    approved_tool_head: options.approvedToolHead,
    repositories: { cc_gateway: ccState, sub2api: subState },
    contract: {
      path_category: 'sub2api_formal_pool_contract',
      repository_relative_path_base64url: Buffer.from(path.relative(subRoot, contractReal)).toString('base64url'),
      sha256: contractSha,
    },
    governance,
    policies: {
      network: { real_upstream_requests: 'forbidden', local_fixture_only: true },
      sensitivity: {
        persisted_material: 'safe_categories_and_sha256_digests_only',
        forbidden: ['raw_prompt', 'raw_body', 'credential', 'raw_cch', 'raw_client_hello', 'account_identifier', 'proxy_credential'],
      },
    },
    dependencies: {
      persona_registry: digestFile(ccRoot, 'src/persona-registry.ts'),
      persona_resolver: digestFile(ccRoot, 'src/persona-resolver.ts'),
      request_policy: digestFile(ccRoot, 'src/policy.ts'),
      tls_registry: digestFile(ccRoot, 'src/egress-tls-profile.ts'),
      cch_request_construction: digestFile(ccRoot, 'src/proxy.ts'),
      sidecar_profile: digestFile(ccRoot, 'sidecar/egress-tls-sidecar/internal/profile/profile.go'),
      sidecar_summary: digestFile(ccRoot, 'sidecar/egress-tls-sidecar/internal/summary/summary.go'),
      package_manifest: digestFile(ccRoot, 'package.json'),
      package_lock: digestFile(ccRoot, 'package-lock.json'),
      sidecar_go_manifest: digestFile(ccRoot, 'sidecar/egress-tls-sidecar/go.mod'),
      sidecar_go_lock: digestFile(ccRoot, 'sidecar/egress-tls-sidecar/go.sum'),
      repository_root_metadata: {
        cc_gateway_augmentroot: digestFile(ccRoot, '.augmentroot'),
        sub2api_augmentroot: digestFile(subRoot, '.augmentroot'),
      },
      tools: digestMatchingFiles(ccRoot, (relative) => relative.startsWith('tools/claude-')),
      observer_parser_canonicalizer: digestMatchingFiles(ccRoot, (relative) => /(?:observer|parser|canonicaliz)/i.test(relative)),
      runtime_toolchain: runtimeDigests,
    },
    codegraph,
    legacy_comparison: {
      requirement_id: 'OL-LEGACY-001',
      version: '2.1.197',
      authority: 'unverified_legacy',
      use: 'comparison_only',
      promotion_eligible: false,
      tuple_digests: {
        persona: digestFile(ccRoot, 'src/persona-registry.ts'),
        request_shape: digestFile(ccRoot, 'src/policy.ts'),
        cch: digestFile(ccRoot, 'src/proxy.ts'),
        tls: digestFile(ccRoot, 'src/egress-tls-profile.ts'),
      },
    },
  } as const;
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) throw new BaselineError('invalid_arguments', `missing value for ${key || 'argument'}`);
    out[key.slice(2)] = value;
  }
  return out;
}

function writeJsonAtomic(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW || 0), 0o600);
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    closeSync(fd); fd = undefined;
    renameSync(temporary, target);
  } finally { if (fd !== undefined) closeSync(fd); }
}

function canonicalOutputPath(candidate: string): string {
  const absolute = path.resolve(candidate);
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = path.dirname(absolute);
  const parentReal = realpathSync(parent);
  return path.join(parentReal, path.basename(absolute));
}

function writeEvidencePairInternal(out: string, manifest: unknown, receipt: string, receiptValue: unknown): void {
  const outCanonical = canonicalOutputPath(out);
  const receiptCanonical = canonicalOutputPath(receipt);
  if (outCanonical === receiptCanonical) throw new BaselineError('output_paths_alias', 'manifest and receipt paths must be distinct');
  for (const target of [out, receipt]) {
    if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new BaselineError('output_path_symlink', 'final output path must not be a symlink');
  }
  const temps = [`${out}.tmp`, `${receipt}.tmp`];
  const fds: Array<{ path: string; fd: number }> = [];
  try {
    for (const temporary of temps) {
      if (!pathInside(realpathSync(path.dirname(temporary)), canonicalOutputPath(temporary))) throw new BaselineError('output_path_escape', 'temporary path escapes output root');
      let fd: number;
      try { fd = openSync(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW || 0), 0o600); }
      catch { throw new BaselineError('temporary_path_exists', 'temporary evidence path already exists'); }
      fds.push({ path: temporary, fd });
    }
    writeFileSync(fds[0].fd, `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(fds[1].fd, `${JSON.stringify(receiptValue, null, 2)}\n`);
    for (const item of fds) closeSync(item.fd);
    renameSync(fds[0].path, out);
    renameSync(fds[1].path, receipt);
  } catch (error) {
    for (const item of fds) { try { closeSync(item.fd); } catch {} try { unlinkSync(item.path); } catch {} }
    throw error;
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  for (const required of ['cc-gateway-root', 'sub2api-root', 'contract-path', 'approved-tool-head', 'out', 'receipt']) {
    if (!args[required]) throw new BaselineError('invalid_arguments', `--${required} is required`);
  }
  const manifest = captureBaseline({
    ccGatewayRoot: args['cc-gateway-root'],
    sub2apiRoot: args['sub2api-root'],
    contractPath: args['contract-path'],
    approvedToolHead: args['approved-tool-head'],
    allowCcGatewayDirtyDigest: args['allow-dirty-digest'],
    outputPath: path.resolve(args['cc-gateway-root'], args.out),
  });
  const out = path.resolve(args['cc-gateway-root'], args.out);
  const receipt = path.resolve(args['cc-gateway-root'], args.receipt);
  ensureOutputContainment(args['cc-gateway-root'], out);
  ensureOutputContainment(args['cc-gateway-root'], receipt);
  const schemaPath = path.join(realpathSync(args['cc-gateway-root']), 'docs/superpowers/schemas/oracle-lab-run-manifest.schema.json');
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const receiptValue = {
    schema_version: '1.0.0',
    compatibility_policy: 'fail_closed_exact_schema',
    retention_class: 'phase_evidence_permanent',
    redaction_policy: 'digests_only',
    destruction_procedure: 'git_revert_artifact_commit_after_security_approval',
    manifest_sha256: sha256(manifestBytes),
    schema_sha256: sha256(readFileSync(schemaPath)),
    bootstrap_commit: args['approved-tool-head'],
  };
  validateManifestArtifact(manifest);
  validateReceiptArtifact(receiptValue);
  writeEvidencePair(out, manifest, receipt, receiptValue, readFileSync(schemaPath));
  console.log(JSON.stringify({ manifest_sha256: sha256(readFileSync(out)), receipt_written: true }));
}

const invoked = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (invoked === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    const typed = error as Error & { code?: string };
    console.error(JSON.stringify({ code: typed.code || 'baseline_capture_failed', message: typed.message }));
    process.exitCode = 1;
  }
}
