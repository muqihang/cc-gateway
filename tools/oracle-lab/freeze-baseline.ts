import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type DigestMarker = { status: 'present'; sha256: string } | { status: 'absent'; reason: string };
type GovernanceMarker = { status: 'absent_pre_governance_bootstrap' } | { status: 'present'; sha256: string };

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

function statRecord(root: string, status: string, destination: Buffer, source?: Buffer): DirtyRecord {
  const relative = destination.toString('utf8');
  const target = path.join(root, relative);
  const base = {
    status,
    destination_path_base64url: encodePath(destination),
    ...(source ? { source_path_base64url: encodePath(source) } : {}),
  };
  if (!existsSync(target)) {
    return { ...base, object_type: 'deleted', file_mode: '000000', deletion_marker: true };
  }
  const stat = lstatSync(target);
  const indexMode = (() => {
    try {
      const line = gitText(root, 'ls-files', '-s', '--', relative).split('\n')[0];
      return /^\d{6}\s/.test(line) ? line.slice(0, 6) : '';
    } catch { return ''; }
  })();
  const mode = indexMode || (stat.isSymbolicLink() ? '120000' : stat.isDirectory() ? '040000' : (stat.mode & 0o111) ? '100755' : '100644');
  if (mode === '160000') {
    let head = 'unavailable';
    let dirty = true;
    try {
      head = gitText(target, 'rev-parse', 'HEAD');
      dirty = gitBuffer(target, 'status', '--porcelain=v1', '-z', '--untracked-files=all').length > 0;
    } catch { /* fail-closed state is represented */ }
    return { ...base, object_type: 'submodule', file_mode: mode, submodule_head: head, submodule_dirty: dirty };
  }
  if (stat.isSymbolicLink()) {
    return { ...base, object_type: 'symlink', file_mode: mode, symlink_target_sha256: sha256(Buffer.from(readlinkSync(target))) };
  }
  if (stat.isFile()) {
    return { ...base, object_type: 'regular_file', file_mode: mode, content_sha256: sha256(readFileSync(target)) };
  }
  return { ...base, object_type: stat.isDirectory() ? 'directory' : 'other', file_mode: mode };
}

function parsePorcelain(root: string, output: Buffer): Array<{ destination: Buffer; source?: Buffer; record: DirtyRecord }> {
  const parts: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < output.length; i++) {
    if (output[i] === 0) {
      parts.push(output.subarray(start, i));
      start = i + 1;
    }
  }
  const parsed: Array<{ destination: Buffer; source?: Buffer; record: DirtyRecord }> = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4 || entry[2] !== 0x20) throw new BaselineError('invalid_git_status', 'unexpected porcelain v1 -z record');
    const status = entry.subarray(0, 2).toString('ascii');
    const destination = Buffer.from(entry.subarray(3));
    let source: Buffer | undefined;
    if (status.includes('R') || status.includes('C')) source = Buffer.from(parts[++i] || Buffer.alloc(0));
    parsed.push({ destination, source, record: statRecord(root, status, destination, source) });
  }
  return parsed.sort((a, b) => Buffer.compare(a.destination, b.destination) || Buffer.compare(a.source || Buffer.alloc(0), b.source || Buffer.alloc(0)));
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
  const status = gitBuffer(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all');
  const parsed = parsePorcelain(root, status);
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

export function captureBaseline(options: BaselineOptions) {
  const ccRoot = realpathSync(options.ccGatewayRoot);
  const subRoot = realpathSync(options.sub2apiRoot);
  if (!existsSync(options.contractPath)) throw new BaselineError('missing_contract', 'formal-pool contract does not exist');
  const contractReal = realpathSync(options.contractPath);
  if (!pathInside(subRoot, contractReal)) throw new BaselineError('contract_symlink_escape', 'formal-pool contract resolves outside the declared Sub2API root');
  const ccState = computeRepositoryState(ccRoot, options.allowCcGatewayDirtyDigest);
  const subState = computeRepositoryState(subRoot, options.allowSub2apiDirtyDigest);
  if (!/^[0-9a-f]{40,64}$/.test(options.approvedToolHead) || options.approvedToolHead !== ccState.head) {
    throw new BaselineError('approved_tool_head_mismatch', 'approved tool commit must exactly equal the CC Gateway repository HEAD');
  }
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
    go: (() => { try { return sha256(String(run(ccRoot, ['go', 'version'], 'utf8')).trim()); } catch { return EMPTY_SHA256; } })(),
  };
  return {
    schema_version: '1.0.0',
    compatibility_policy: 'fail_closed_exact_schema',
    retention_class: 'phase_evidence_permanent',
    redaction_policy: 'digests_and_safe_categories_only',
    destruction_procedure: 'git_revert_artifact_commit_after_security_approval',
    phase: 'phase_0_entry',
    approved_tool_head: options.approvedToolHead,
    repositories: { cc_gateway: ccState, sub2api: subState },
    contract: {
      path_category: 'sub2api_formal_pool_contract',
      repository_relative_path_base64url: Buffer.from(path.relative(subRoot, contractReal)).toString('base64url'),
      sha256: sha256(readFileSync(contractReal)),
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
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, target);
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
  });
  const out = path.resolve(args['cc-gateway-root'], args.out);
  const receipt = path.resolve(args['cc-gateway-root'], args.receipt);
  if (!pathInside(realpathSync(args['cc-gateway-root']), out) || !pathInside(realpathSync(args['cc-gateway-root']), receipt)) {
    throw new BaselineError('output_path_escape', 'output and receipt must remain inside CC Gateway root');
  }
  writeJsonAtomic(out, manifest);
  const schemaPath = path.join(realpathSync(args['cc-gateway-root']), 'docs/superpowers/schemas/oracle-lab-run-manifest.schema.json');
  writeJsonAtomic(receipt, {
    schema_version: '1.0.0',
    compatibility_policy: 'fail_closed_exact_schema',
    retention_class: 'phase_evidence_permanent',
    redaction_policy: 'digests_only',
    destruction_procedure: 'git_revert_artifact_commit_after_security_approval',
    manifest_sha256: sha256(readFileSync(out)),
    schema_sha256: sha256(readFileSync(schemaPath)),
    bootstrap_commit: args['approved-tool-head'],
  });
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
