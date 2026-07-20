# Claude Code 2.1.215 Oracle Lab Phase 3A Evidence Factory Plan

> **Plan-only status (2026-07-19):** this document authorizes no Phase 3A implementation or
> observation campaign. The planning branch may contain this document only. Formal execution starts
> from a new operator-approved implementation branch and fresh evidence root after this plan merges.
>
> **Active target:** `@anthropic-ai/claude-code@2.1.215`. No floating tag is accepted. `2.1.207`
> and every other version are historical controls only when a row in Section 12 names the exact
> change-point hypothesis.

## 1. Objective, outputs, and prohibited claims

Phase 3A builds H3A, a repeatable evidence factory that can take a pinned official package through
provenance intake, deep static recovery, controlled local dynamic observation, selected
cross-version comparisons, evidence normalization, and a bounded handoff to Phase 3B/3.5.

Required outputs are:

1. byte-identified package, platform artifact, executed entrypoint, and execution-chain inventory;
2. reproducible static indexes, formatter/AST outputs, module boundaries, xrefs, call graphs,
   control-flow/state-machine summaries, and structural change-point diffs;
3. loopback-only dynamic observations covering process, filesystem, environment, network, TLS,
   HTTP, SSE, compact/prompt-cache, telemetry, diagnostic, retry, restart, and lineage behavior;
4. one-variable-at-a-time differential results with repeated, order-randomized paired runs;
5. raw synthetic-only observation material in a restricted external evidence root, safe normalized
   evidence in durable capsules, and a hash-linked artifact index;
6. `Observed`, `Reproduced`, `Inferred`, or `Unknown` decisions with contradiction, expiry,
   perturbation, platform, and authority ceilings;
7. a Phase 3A exit report and a Phase 3B/3.5 input bundle sufficient to build deterministic
   profile/config candidates without Phase 3A itself generating or activating them.

Phase 3A does **not**:

- modify Phase 2 product code, the `oracle.compatibility.v1` bundle, or runtime wiring;
- implement Phase 4 admission, sidecar, DNS, socket, retry, replay, or transport enforcement;
- generate, promote, activate, deploy, or sign a production profile;
- use production, a real account, a real credential, a real provider endpoint, or real canary;
- infer provider-internal risk controls, official-client identity, long-term account safety, server
  acceptance of CCH, or complete wire equivalence from local evidence;
- treat a missing string, absent hook event, one successful run, or one platform result as proof of
  non-existence or general behavior;
- introduce a receipt, context, lease, Recovery, restart-authority, or parallel governance state
  machine. H3A launch manifests and artifact indexes describe experiments; they grant no authority.

## 2. Frozen planning baseline

### 2.1 Repositories

| Repository | Remote | Frozen commit | Frozen tree | Planning root |
| --- | --- | --- | --- | --- |
| CC Gateway | `https://github.com/muqihang/cc-gateway.git` | `5520e96b0c577eb4f061013b5bcc9973c7f38c3f` | `48e84a70238f68c24637c61783fb75c3cea5b919` | `${CC_GATEWAY_ROOT}` |
| Sub2API | `https://github.com/muqihang/sub2api.git` | `cea7de895b8b523f3a6bb46be77ba09bc31a11bc` | `52efacd397bd0f15861cca4b6a1921a049e5ea28` | `${SUB2API_ROOT}` |

Planning used the Codex-created CC worktree and a new clean sibling Sub2API clone. The operator's
existing Sub2API checkout is not an input. Both remotes matched the expected commits after
`git fetch muqihang main`. The CC movement from the handoff's integrated product commit to the
frozen commit is only the Phase 2 handoff addition (PR #35), so it does not alter the tested Phase 2
product tree or contract anchor.

Formal execution begins with:

```bash
git -C "$CC_GATEWAY_ROOT" fetch muqihang main
git -C "$SUB2API_ROOT" fetch muqihang main
test "$(git -C "$CC_GATEWAY_ROOT" rev-parse muqihang/main)" = \
  5520e96b0c577eb4f061013b5bcc9973c7f38c3f
test "$(git -C "$SUB2API_ROOT" rev-parse muqihang/main)" = \
  cea7de895b8b523f3a6bb46be77ba09bc31a11bc
test -z "$(git -C "$CC_GATEWAY_ROOT" status --porcelain)"
test -z "$(git -C "$SUB2API_ROOT" status --porcelain)"
test "$(git -C "$CC_GATEWAY_ROOT" rev-parse HEAD^{tree})" = \
  48e84a70238f68c24637c61783fb75c3cea5b919
test "$(git -C "$SUB2API_ROOT" rev-parse HEAD^{tree})" = \
  52efacd397bd0f15861cca4b6a1921a049e5ea28
codegraph sync "$CC_GATEWAY_ROOT" && codegraph status "$CC_GATEWAY_ROOT"
codegraph sync "$SUB2API_ROOT" && codegraph status "$SUB2API_ROOT"
```

Any remote movement that changes `contracts/oracle-lab/v1/`, `src/oracle-contract/`,
`sidecar/egress-tls-sidecar/internal/control/`, Sub2API `oracle_contract_*`, either mirrored fixture
tree, or a P2 checker is a stop condition requiring operator re-freeze. An unrelated documentation
movement may be recorded and rebased only with ordinary non-destructive Git operations.

### 2.2 Phase 2 inputs

- Phase 1 predecessor contract SHA-256:
  `70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1`.
- Phase 2 `oracle.compatibility.v1` bundle SHA-256:
  `2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce`.
- Supported schema range: `1:0-0`.
- Frozen Phase 2 gate: `65` fixtures and `7` commands.

The pre-execution checker is:

```bash
cd "$CC_GATEWAY_ROOT"
npm exec tsx tools/oracle-contract/check-cross-repo.ts \
  --sub2api-root "$SUB2API_ROOT" --cc-gateway-root "$CC_GATEWAY_ROOT" --check
```

H3A references P2 evidence fields and four gates but does not change P2 schemas or admission code.

### 2.3 Official 2.1.215 artifact recon freeze

Planning performed only package identity/layout recon and a network-denied `--version` probe.
Formal P3A-0 must redownload and independently reproduce these values; the planning cache is not
execution authority.

| Item | Frozen value |
| --- | --- |
| npm metadata URL | `https://registry.npmjs.org/@anthropic-ai%2fclaude-code/2.1.215` |
| npm tarball URL | `https://registry.npmjs.org/@anthropic-ai/claude-code/-/claude-code-2.1.215.tgz` |
| package | `@anthropic-ai/claude-code@2.1.215` |
| npm SHA-1 | `c349d13afa43e6cf6f147f36bec121dc9824ed89` |
| npm integrity | `sha512-lsWBvyMyBqg/rOZ06o/HEhlpOzHsH8IBf9RH4u5gzizQ1LWS/oXAh5nqWNUu3hn2d8QkyYg0aseNzMDlGD+3qg==` |
| wrapper archive SHA-256 | `1a5cf8e491689154264c0b2f28371bf645cdee2903b45c497915868308502d7b` |
| wrapper unpacked-tree SHA-256 | `9cec9c9ad4edea1c4f64cf515033fcf3ecac347231e20f6e7f63f54b0ad87b04` |
| platform metadata URL | `https://registry.npmjs.org/@anthropic-ai%2fclaude-code-darwin-arm64/2.1.215` |
| platform npm tarball SHA-256 | `b5dd6a135c96957dae232218c4ae5b04328a788f8c509202c92a2fec550601b2` |
| platform unpacked-tree SHA-256 | `68157adfdf2666cc5afcbab8834405691faf8b8ad22e03a507fce845b2e71c6b` |
| official release page | `https://github.com/anthropics/claude-code/releases/tag/v2.1.215` |
| release arm64 archive SHA-256 | `599883973d2b4c8bb25e3490c84d65646f78d158cdc86adc73c1f5a6cfbbd600` |
| release `SHASUMS256.txt` SHA-256 | `ff3d5757a0dbbfa75b43d03e9e4b360dcfad021520b34e0b40e65a1a1cbe110f` |
| release signature bytes SHA-256 | `d32aa006a5157c28d0d5ed41847ded7a95bae75de2177754b0320ba866d66cb5` |
| executed Mach-O SHA-256 | `90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58` |
| code-sign identity | `Developer ID Application: Anthropic PBC (Q6L2SF6YDW)` |
| observed version probe | `2.1.215 (Claude Code)` under a no-network sandbox |

The npm platform binary and GitHub release binary have the same SHA-256. The wrapper package has
seven files: installer, CJS fallback wrapper, placeholder `bin/claude.exe`, package metadata,
license/readme, and `sdk-tools.d.ts`. Postinstall selects an exact optional platform package and
copies its `claude` binary over the placeholder. On macOS arm64 the executed entrypoint is a signed,
thin PIE Mach-O with a `__BUN,__bun` section. Minimal marker inventory found source-map, module,
resource, chunk, Bun, and Node-builtin strings; it did **not** establish that usable source maps or
recoverable module boundaries exist. Symbols are present but insufficiently characterized.

The unpacked-tree digest algorithm is:

```text
sha256(canonical JSON of path-sorted entries)
file    -> {path,type:"file",mode,size,sha256}
symlink -> {path,type:"symlink",mode,target}
dir     -> {path,type:"dir",mode}
```

Planning tool versions were CodeGraph `1.1.6`, Node `v24.7.0`, npm `11.5.1`, curl `8.6.0`,
jq `1.8.1`, Apple `codesign`/`otool` from the active Xcode command-line tools, and the system tar
and `shasum`. Formal execution records executable paths, version stdout, and executable SHA-256 in
`toolchain.json`; a version string alone is insufficient.

## 3. Governing inputs and precedence

Conflicts resolve in this order:

1. operator's active Phase 3A scope and safety instructions;
2. `2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md`;
3. `2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md`;
4. the adopted adversarial-validation v2 requirements referenced by the registry;
5. `2026-07-11-claude-code-2.1.207-oracle-lab-design.md`;
6. the roadmap, as amended by its Delivery Operating Model v2 section;
7. Delivery Operating Model v2 for delivery mechanics only;
8. the Phase 2 implementation plan and Phase 2 handoff for the current integrated contract state.

Required source paths:

- `docs/superpowers/2026-07-19-claude-code-2.1.215-phase-2-handoff.md`
- `docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md`
- `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-design.md`
- `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md`
- `docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md`
- `docs/superpowers/roadmaps/2026-07-18-oracle-lab-delivery-operating-model-v2.md`
- `docs/superpowers/evidence/delivery-model/delivery-mechanism-transition-exit-report.md`
- `docs/superpowers/plans/2026-07-19-claude-code-2.1.215-phase-2-normative-compatibility.md`
- `docs/superpowers/registry/oracle-lab-requirements.json`
- `docs/superpowers/registry/oracle-lab-claims.json`
- `docs/superpowers/schemas/oracle-lab-run-manifest.schema.json`

The old H0 run-manifest schema is Phase-0-specific and is not silently overloaded. H3A adds
experiment schemas only; it reuses H0's digest, redaction, command, and traceability concepts.

## 4. Requirement and claim traceability

| Requirement | Phase 3A interpretation | Required P3A output |
| --- | --- | --- |
| `HA-P0-003` | obey existing Claim Matrix ceilings | conclusion records reference prohibited claims |
| `HA-P0-006` | bind cross-repository predecessor and P2 contract | repository/contract digest fields |
| `HA-P0-007` | reuse H0 traceability/command concepts | deterministic commands and artifact index, no new authority state |
| `HA-P0-009` | unknown/contradictory/unsupported stays disabled | negative-capability and Unknown rows |
| `HA-P1-001` | deep control-flow recovery plus selective instrumentation | static graph and dynamic reachability cross-links |
| `HA-P1-002` | lifecycle and convergence beyond fixed three runs | randomized repeated runs and convergence report |
| `HA-P1-003` | safe error classification | bounded error/failure taxonomy and leak scan |
| `RA-P0-005` | consume completed versioned P2 contract/readiness vocabulary | P2 digest and gate mapping, no contract edit |
| `RA-P1-001` | reasoned change-point matrix | Section 12 control list and structured diff |
| `RA-P1-003` | bounded drift fixtures | request/response/System Prompt/transport normalized diffs |
| `RA-P1-008` | paired nonessential-traffic observation | telemetry/update/diagnostic on/off pairs |

Applicable existing claim ceilings are:

- `CL-PINNED-OBS-001`: no local-wire claim without a pinned-client capture;
- `CL-OFFICIAL-CLIENT-IDENTITY-PROHIBITED`;
- `CL-CCH-SERVER-ACCEPTANCE-PROHIBITED`;
- `CL-TLS-WIRE-EQUIVALENCE-PROHIBITED`;
- `CL-LONG-TERM-ACCOUNT-SAFETY-PROHIBITED`;
- `CL-CHANGELOG-RISK-RULES-PROHIBITED`;
- `CL-LOCAL-EVIDENCE-PRODUCTION-PROHIBITED`.

The existing registry has stale phase labels on some deferred rows. Phase 3A may emit a proposed
registry delta in the exit bundle, but must not rewrite historical verification facts or mark P2
product work from this evidence campaign.

## 5. Repository recon: real paths, symbols, and focused tests

### 5.1 CC Gateway

| Area | Existing path/symbol | Call/role discovered by CodeGraph |
| --- | --- | --- |
| narrow native matrix | `tools/claude-native-oracle-matrix.ts::runNativeOracleMatrix` | calls mock or real profile; defaults to 2.1.179, two invocation modes, three variants |
| real matrix launch | `runRealProfile -> resolvePinnedClaudeExecutable -> oracleEnv -> buildClaudePrintArgs -> runCommand` | loopback stub and optional `sandbox-exec`; insufficient H3A coverage |
| safe request summary | `summarizeRequest` | request shape, system/tool/cache/CCH buckets; raw body is transient |
| narrow CCH harness | `tools/claude-cch-oracle-regression.ts::runOracleRegression` | local stub, two synthetic prompts, final-byte CCH checks |
| P2 joint checker | `tools/oracle-contract/check-cross-repo.ts::checkCrossRepoContract` | calls shared-bundle check, static fixture validation, TS/Go focused commands |
| P2 contract | `contracts/oracle-lab/v1/`, `src/oracle-contract/` | canonicalization, authority, admission, manifest, sidecar, cross-project types |
| sidecar client | `src/egress-sidecar-client.ts::parseLoopbackEndpoint` | restricts configured sidecar endpoint to loopback |

Focused baselines:

```bash
cd "$CC_GATEWAY_ROOT"
npm exec tsx tests/native-oracle-matrix.test.ts
npm exec tsx tests/cch-oracle-harness.test.ts
npm exec tsx tests/oracle-contract-cross-repo.test.ts
npm exec tsx tests/oracle-contract-admission.test.ts
npm exec tsx tests/oracle-contract-cross-project.test.ts
```

### 5.2 Sub2API

| Area | Existing path/symbol | Role discovered by CodeGraph/source index |
| --- | --- | --- |
| loopback app oracle | `tools/claude_code_real_oracle_loopback.py::run_real_cli_application_oracle` | extracts pinned binary, builds isolated env, uses `SafeRequestCollector` |
| egress guard | `evaluate_egress_guard`, `run_same_scope_self_tests`, `sandbox_exec_loopback_profile` | classifies enforceable/blocked/unavailable guard state |
| TLS oracle | `tools/claude_code_tls_oracle.py::capture_real_cli_sni_preserving_tls` | local CONNECT/SNI collection and safe TLS summary |
| cross-stack TLS | `capture_cc_gateway_node_agent`, `capture_sub2api_utls_builtin_local` | local reference collectors; no production claim |
| env attribution | `tools/claude_code_local_env_attribution_oracle.py::classify_request_summary` | timezone/base URL/proxy/System Prompt presence buckets; expected matrix builder |
| managed launcher | `tools/zhumeng-agent/.../claude_code/launcher.py::run_managed_claude_code` | launch-plan/env/preload plumbing; production/canary paths remain out of scope |
| P2 mirror | `backend/internal/service/oracle_contract_*` | Go canonical, admission, authority, cross-project implementation |

Focused baselines:

```bash
cd "$SUB2API_ROOT"
python3 -m unittest tools.tests.test_claude_code_real_oracle_loopback
python3 -m unittest tools.tests.test_claude_code_tls_oracle
python3 -m unittest tools.tests.test_claude_code_local_env_attribution_oracle
python3 -m pytest -q tools/zhumeng-agent/tests/test_claude_code_launcher.py
(cd backend && go test ./internal/service \
  -run 'TestOracleContract(Canonical|Admission|Authority|CrossProject)$' -count=1)
```

H3A may reuse or wrap these functions after tests prove unchanged semantics. It must not call any
live/canary launcher mode, and it must not claim that the present tools already implement P3A.

## 6. H3A proposed layout and data contracts

Formal implementation adds only evidence-harness code, tests, schemas, safe fixtures, and reports.
Product request/runtime paths remain untouched.

```text
CC Gateway
  tools/oracle-lab/phase3a/
    intake.ts                 # registry/release download and digest verification
    tree-digest.ts            # canonical path/mode/size/content tree digest
    toolchain.ts              # executable path/version/digest capability inventory
    static-inventory.ts       # wrapper/Mach-O/ELF/PE/section/resource inventory
    extract-bundle.ts         # format-aware extraction to a digest-bound scratch copy
    recover-ast.ts            # formatter, AST, stable module IDs, xrefs/call graph
    structural-diff.ts        # module/AST/CFG/state-machine change-point diff
    launch-manifest.ts        # exact one-cell environment and command manifest
    run-cell.ts               # process supervisor, limits, lineage, stdout/stderr capture
    normalize.ts              # safe AST/transcript/trace normalization
    converge.ts               # repetition, order, perturbation, stable/variable report
    safe-error-classifier.ts  # in-memory allowlist classifier and leak canary fuzzing
    build-exit.ts             # exit report and Phase 3B/3.5 handoff bundle
    hooks/
      preload.cjs             # Node module/fs/net/http/tls/child_process/timer probes
      loader.mjs              # ESM resolution/load probe
      bun-preload.ts          # Bun preload capability probe when supported
      inspector-client.mjs    # loopback inspector/debugger capture
    observers/
      fake-upstream.ts        # JSON/SSE/failure/compact response state machine
      connect-proxy.ts        # CONNECT, local MITM, TLS/HTTP transcript
      process-sampler.ts      # child/process/socket/open-file snapshots
  docs/superpowers/schemas/
    oracle-lab-phase3a-launch-manifest.schema.json
    oracle-lab-phase3a-artifact-index.schema.json
    oracle-lab-phase3a-normalized-observation.schema.json
    oracle-lab-phase3a-conclusion.schema.json
    oracle-lab-phase3a-handoff.schema.json
  tests/oracle-phase3a-*.test.ts

Sub2API
  tools/oracle_phase3a_adapter.py       # read-only adapter over the three existing oracle modules
  tools/tests/test_oracle_phase3a_adapter.py
  backend/internal/service/oracle_contract_phase3a_fixture_test.go
```

Raw evidence lives outside Git:

```text
${P3A_EVIDENCE_ROOT}/
  intake/{package}/{version}/{archive,metadata,signature,unpacked}/
  static/{artifact-digest}/{sections,index,ast,xref,cfg,diff}/
  runs/{run-id}/{launch.json,stdout,stderr,process,fs,network,http,tls,pcap,hooks}/
  normalized/{run-id}/{request-ast,response-ast,system-summary,trace,diff}.json
  capsules/{capsule-id}/{artifact-index,convergence,conclusions}.json
  quarantine/                  # bounded sensitive candidates; never committed
```

Durable repository evidence under `docs/superpowers/evidence/phase-3a/` contains only schemas,
digests, safe categories, normalized AST topology, literal length/hash/span summaries, commands,
and conclusions. It never contains credentials, raw user prompts, raw vendor System Prompt text,
raw request/response bodies, raw CCH, proxy credentials, or account identifiers. Raw HTTP/pcap
retention is allowed only for synthetic placeholder traffic; any vendor-injected prompt/body bytes
are transformed in memory into safe AST/hash/span summaries before persistence. A need to retain
those raw bytes triggers the existing exceptional-evidence procedure and separate operator review.

### 6.1 Launch manifest minimum fields

`oracle-lab-phase3a-launch-manifest.v1` requires:

```text
schema_version, run_id, parent_run_id, pair_id, sequence_index, randomization_seed
phase, requirement_ids, hypothesis_id, evidence_level_ceiling
repositories.{cc_gateway,sub2api}.{commit,tree,dirty_digest}
contract.{bundle_id,bundle_sha256,schema_range,predecessor_sha256}
artifact.{package,version,registry_url,archive_sha256,tree_sha256,entrypoint_sha256}
toolchain_digest, platform.{os,release,arch,runtime,virtualization}
command.{executable_sha256,argv,cwd,stdin_sha256,timeout_ms}
environment.{allowlist,explicit_empty,unset,home,xdg,tmp,tz,lang,lc_all,base_urls}
network.{policy,loopback_ports,proxy_mode,ca_sha256,external_socket_budget=0}
matrix.{changed_variable,control_value,treatment_value,fixed_variables}
limits.{wall_ms,cpu_ms,rss_bytes,output_bytes,processes,retries,sockets,files}
capture.{hook,inspector,process,fs,network,tls,http,pcap,stdout,stderr}
redaction_policy, retention_class, expiry, previous_manifest_sha256
```

Every value is explicit. Unset differs from empty string. Secrets are represented only by
placeholder class and digest, never by bytes.

### 6.2 Artifact index minimum fields

Each artifact row directly records `artifact_schema_version`, `artifact_id`, `run_id`, parent
artifact IDs, relative path, media type, byte size, SHA-256, source URL or generating command
digest, **exact verification command digest**, toolchain digest, created time in UTC, scope,
requirement IDs, owner, reviewer, sensitivity, redaction transform, retention/expiry, destruction
procedure/disposition, environment-fingerprint cell, parser name/version/agreement, negative result,
contradiction IDs/status, and validation status. These fields are mandatory on the row itself; an
artifact cannot satisfy the gate by relying on an unbound launch or conclusion object. The index
validator confirms each referenced run/conclusion digest and records `previous_index_sha256`,
creating a hash chain without creating an authorization protocol.

### 6.3 Normalized observation and conclusion

Normalized observations separate:

- request: endpoint class, header names/value classes, body AST topology, CCH class, System Prompt
  byte length/digest/stable-span and AST topology, final serialized-byte digest;
- response: HTTP/SSE AST, event ordering, partial output, compact/prompt-cache fields, terminal
  state and retry eligibility as observed facts;
- control plane: telemetry/update/diagnostic/error-report destination class, event schema, timing;
- runtime: process lineage, exec digest, env/fs access, DNS/socket/TLS/HTTP events, timers/retries;
- perturbation: instrumented/uninstrumented differences and missing observer sources.

A conclusion row requires `level`, `scope`, `statement`, `supporting_artifact_ids`,
`contradicting_artifact_ids`, `static_anchor`, `dynamic_reproduction`, `single_source_reason`,
`platform_limits`, `expiry`, `negative_capabilities`, and `phase3b_usable`.

## 7. Dependency DAG and parallelism

```text
P3A-0.1 freeze
  -> P3A-0.2 artifact intake -> P3A-0.3 toolchain/capability -> P3A-0.4 schemas/RED
  -> P3A-1.1 inventory -> P3A-1.2 extract -> P3A-1.3 AST/module recovery
      -> P3A-1.4 xref/CFG/state machines -> P3A-1.5 structural diff
  -> P3A-2.1 isolation guard -> P3A-2.2 observers -> P3A-2.3 hook capability
      -> P3A-2.4 request/System Prompt matrix
      -> P3A-2.5 telemetry/process/fs/network matrix
      -> P3A-2.6 failure/stream/compact/lifecycle matrix
      -> P3A-2.7 OS/platform corroboration
      -> P3A-2.8 convergence
  -> P3A-3.1 control intake -> P3A-3.2 targeted static diff
      -> P3A-3.3 targeted dynamic pairs -> P3A-3.4 change-point report
  -> P3A-4.1 normalize -> P3A-4.2 contradiction/grade -> P3A-4.3 P2 mapping
      -> P3A-4.4 exit report -> P3A-4.5 Phase 3B/3.5 handoff
```

After P3A-0.4, static extraction and observer implementation may proceed in parallel. Dynamic
campaigns cannot start until isolation RED/GREEN passes. Cross-version dynamic pairs cannot start
until the 2.1.215 active-target baseline is reproducible. Normalization may process completed cells
incrementally, but final conclusions wait for convergence and contradiction handling. Only one
process writes an artifact index generation.

## 8. P3A-0: artifact intake, hash, unpack Harness, and evidence root

### P3A-0.1 Re-freeze and preflight

- **Inputs:** Section 2 commits/trees, Phase 2 digests, clean new worktrees.
- **Files/symbols:** P2 checker and mirrored contract paths in Sections 2 and 5.
- **Command:** Section 2 repository assertions, CodeGraph sync/status, then the P2 joint checker.
- **RED/baseline:** deliberately change a copied expected commit and contract digest; preflight must
  return stable `repository_drift` and `contract_digest_mismatch` before any download or launch.
- **Output/schema:** `preflight.json` embedded in the launch-manifest schema.
- **Done:** exact heads/trees/digests and clean states pass; CodeGraph is current in both roots.
- **Stop/budget:** 20 minutes. Stop on anchor drift, dirty state, or P2 checker disagreement.
- **Parallel/dependency:** first serial task.
- **Nearest deliverable:** drift report naming exact changed paths and digests.

### P3A-0.2 Official artifact intake

- **Inputs:** exact registry and release URLs from Section 2.3; no npm configured registry is trusted.
- **Files:** future `intake.ts`, `tree-digest.ts`; external `intake/` only.
- **Command template:** 

```bash
curl --fail --location --proto '=https' --tlsv1.2 \
  'https://registry.npmjs.org/@anthropic-ai%2fclaude-code/2.1.215' \
  -o "$P3A_EVIDENCE_ROOT/intake/wrapper/registry.json"
# intake.ts extracts the exact dist.tarball URL, downloads it, verifies npm SHA-1/SHA-512,
# computes SHA-256, unpacks without executing lifecycle scripts, and computes the tree digest.
npm exec tsx tools/oracle-lab/phase3a/intake.ts -- \
  --package '@anthropic-ai/claude-code' --version 2.1.215 \
  --registry-url 'https://registry.npmjs.org' --no-scripts \
  --evidence-root "$P3A_EVIDENCE_ROOT"
```

- **RED:** wrong version, tarball redirect outside the allowlist, integrity mismatch, path traversal,
  symlink escape, duplicate path, case collision, decompression ratio, and archive size limits.
- **Output:** archive, metadata, release `SHASUMS256.txt` and signature bytes, unpacked tree, canonical
  inventory, `artifact-index.json`. Signature presence is not signature verification; verified key
  identity must be recorded or the signature result is `Unknown`.
- **Done:** wrapper, selected platform package, release asset, and executed binary agree by digest;
  postinstall mapping is recorded without running postinstall.
- **Stop/budget:** 90 minutes; 1 GiB download/unpack hard cap, 4x expansion cap per archive.
- **Parallel/dependency:** after 0.1; wrapper and platform downloads may be parallel.
- **Nearest deliverable:** metadata plus archive digest and an explicit unpack failure class.

### P3A-0.3 Toolchain and capability freeze

- **Inputs:** host and future isolated Linux/Windows workers.
- **Files:** `toolchain.ts` and `tests/oracle-phase3a-toolchain.test.ts`.
- **Command:** `toolchain.ts` records `command -v`, version output, binary SHA-256, and capability
  probes for Node, TypeScript, Python, Go, curl, tar, jq, OpenSSL, CodeGraph, codesign/otool/nm,
  `xcrun llvm-objdump`, LIEF, Ghidra headless, rizin, mitmproxy, tcpdump, fs_usage, opensnoop,
  dtruss, strace, lsof, and platform equivalents.
- **RED:** a version-only entry or unpinned formatter/parser is rejected.
- **Output/schema:** `toolchain.json` and `capabilities.json`, both artifact-indexed.
- **Done:** every later command references the frozen toolchain digest; unavailable tools have a
  named fallback and evidence downgrade.
- **Stop/budget:** 45 minutes. Tool absence is not a plan blocker unless no archive parser, AST
  parser, loopback guard, or network observer remains.
- **Parallel/dependency:** after 0.1; platform probes may run in parallel, but the canonical
  toolchain digest is emitted only after all selected workers report.
- **Nearest deliverable:** capability matrix with `available|permission_denied|unsupported|unknown`.

### P3A-0.4 Schemas, RED fixtures, and evidence root guard

- **Inputs:** Section 6 field contracts and P2 canonical JSON rules.
- **Files/tests:** proposed schemas plus `tests/oracle-phase3a-schema.test.ts`,
  `tests/oracle-phase3a-evidence-root.test.ts`, `tests/oracle-phase3a-hermeticity.test.ts`.
- **Command:** `npm exec tsx tests/oracle-phase3a-schema.test.ts`, followed by the evidence-root and
  hermeticity focused tests from Section 16.
- **RED:** missing parent lineage, floating version, non-loopback target, real credential-shaped
  value, raw prompt/body field, unknown schema field, path outside evidence root, or artifact hash
  mismatch must fail.
- **Expected output:** strict schema errors with stable codes and JSON paths.
- **Done:** canonical round trip is byte-identical; mutation corpus is green; no receipt/lease field.
- **Stop/budget:** 4 hours, 500 fixture mutations max.
- **Parallel/dependency:** after 0.2 and 0.3 so fixture rows bind real artifact/toolchain digests;
  schema mutation families may run in parallel.
- **Nearest deliverable:** strict schema and mutation corpus even if later observers are unavailable.
- **Commit:** `test(oracle): define Phase 3A evidence contracts`, then
  `feat(oracle): add pinned artifact intake harness`.

## 9. P3A-1: deep static reverse engineering

### P3A-1.1 Archive, wrapper, executable, section, and resource inventory

- **Inputs:** digest-verified wrapper, every listed package file, selected platform package, release
  binary, code signature, and package metadata.
- **Files/symbols:** `static-inventory.ts`, `tree-digest.ts`, wrapper `install.cjs`/
  `cli-wrapper.cjs`, and the selected native entrypoint/sections.
- **Commands:** `file`, `codesign -dv/--verify`, `otool -hv/-L/-l`, `nm`,
  `xcrun llvm-objdump --macho --all-headers`, format-aware LIEF parsing, bounded `strings`, and
  `npm exec tsx tools/oracle-lab/phase3a/static-inventory.ts -- --artifact ARTIFACT_INDEX`.
  Linux uses `readelf`/`objdump`; Windows uses `dumpbin` or LIEF/PE parsing.
- **RED:** inventory must reject a file whose digest differs from intake or whose section range
  overlaps/out-runs the file.
- **Output:** package tree, entrypoint graph, imports, symbols, code-sign facts, section table,
  embedded-resource candidates, source-map/metadata marker availability, and hashes.
- **Done:** every executed byte source has a parent and digest; `__BUN,__bun` is characterized as a
  container candidate, not assumed to be plain JS.
- **Stop/budget:** 4 hours, 2 GiB derived output. Do not persist unrestricted strings.
- **Parallel:** can run with observer implementation after P3A-0.
- **Nearest deliverable:** verified inventory plus explicit opaque sections.

### P3A-1.2 Reproducible extraction and minification/obfuscation classification

- **Inputs:** section/resource candidates from 1.1.
- **Files:** `extract-bundle.ts`; extraction recipes under `static/{digest}/recipes/`.
- **Commands:** `npm exec tsx tools/oracle-lab/phase3a/extract-bundle.ts -- --entrypoint
  ENTRYPOINT --inventory INVENTORY --out STATIC_ROOT`; format-aware extraction first, with
  `binwalk`/LIEF/Ghidra/rizin only from the frozen toolchain. No `eval`, no execution of
  extracted code, and no ad hoc binary mutation.
- **RED:** running the recipe twice must produce byte-identical file inventories; corrupt offsets,
  recursive archives, decompression bombs, and unrecognized encoding become stable failures.
- **Output:** chunk/resource index with offsets, lengths, hashes, entropy, encoding, parser, and
  `plain|minified|bundled|packed|obfuscated|opaque` classification plus evidence.
- **Done:** all candidates are extracted or explicitly opaque; the extraction script reproduces
  the same hashes from the original archive.
- **Stop/budget:** 8 hours per active artifact, 4 GiB output, max two extraction approaches per
  opaque region before marking `Unknown`.
- **Parallel/dependency:** after 1.1; independent digest-bound sections may extract in parallel.
- **Nearest deliverable:** offsets/hashes and a reproducible extractor even without decoded JS.

### P3A-1.3 Formatter, AST, module boundary, and repeatable deobfuscation

- **Inputs:** JavaScript/resource candidates from 1.2.
- **Files:** `recover-ast.ts`; use the lockfile-resolved TypeScript compiler API
  (`createSourceFile`, scope walk, printer) as the required parser/formatter. A second parser may be
  added only at an exact locked version for agreement checks.
- **Pipeline:** parse -> stable scope/module IDs -> safe constant-table decoding -> bundle-table
  boundary recovery -> side-effect-free constant folding -> stable identifier renaming ->
  TypeScript printer -> reparse -> AST canonical hash. Never evaluate vendor code.
- **Command:** `npm exec tsx tools/oracle-lab/phase3a/recover-ast.ts -- --static-root
  "$P3A_EVIDENCE_ROOT/static/$ENTRYPOINT_SHA256" --emit-formatted --emit-ast --emit-modules`.
- **RED:** syntax corruption, nondeterministic names, AST drift after print/reparse, or changed
  literal bytes outside approved decoding fails. Minified input with known synthetic module tables
  must recover the fixture boundaries.
- **Output:** formatted code in restricted static evidence, canonical AST JSON, module/chunk graph,
  literal xref table, transform log, and before/after hashes. Durable capsules retain topology and
  hashes, not proprietary source.
- **Done:** deterministic rerun and parser agreement pass; every transform names its rule and input
  offsets.
- **Stop/budget:** 12 hours active artifact, max 8 GiB scratch, max 3 transform passes.
- **Parallel:** module recovery by independent chunks; merge is serial by stable module ID.
- **Nearest deliverable:** parse coverage percentage and opaque ranges with reason.

### P3A-1.4 Required xrefs, call graphs, control flow, and state machines

- **Inputs:** AST/module graph plus native symbols/offsets.
- **Files/symbols:** `recover-ast.ts`, frozen Ghidra/rizin scripts, 1.3 module IDs, and each
  required root named below.
- **Required roots:** env/config/system-property reads; HOME/XDG/TMP/TZ/LANG/locale/hostname/platform
  access; complete configuration precedence; model alias/capability resolution; authentication
  loading, helper selection, refresh and expiry; Base URL and proxy selection; System Prompt
  construction/mutation; request headers/body and final serialization; request/session IDs,
  timestamps, nonces and random sources; CCH/billing/cache/compact paths;
  telemetry/OTel/diagnostic/update/error reporting; DNS/socket/TLS/HTTP and unknown transports;
  retry/timer/backoff/jitter; child/subtask/fork/process creation and IPC; daemon, restart, resume,
  long-running, suspend/wake and shutdown transitions.
- **Commands:** `recover-ast.ts --roots ... --emit-xref --emit-callgraph --emit-cfg`; native-only
  reachability uses Ghidra headless/rizin scripts whose project and output digests are recorded.
- **RED:** synthetic fixtures include indirect calls, aliasing, dynamic property reads, promise
  chains, event emitters, and state tables; a string-only hit must not satisfy a call-path fixture.
- **Output:** `xref.json`, `callgraph.json`, per-root bounded CFG, state-machine transition tables,
  unresolved dynamic edges, and candidate dynamic hook anchors.
- **Done:** every required root has a static path/offset or `Unknown` with searched surfaces and the
  next minimal action. “String absent” is never an exit result.
- **Stop/budget:** 16 analyst-hours; max 50,000 nodes per root before slicing by module.
- **Parallel/dependency:** after 1.3; roots may be recovered independently, with a serial cross-root
  alias/dynamic-edge merge.
- **Nearest deliverable:** xrefs plus unresolved edge ledger.

### P3A-1.5 Structured current/change-point diff

- **Inputs:** active 2.1.215 static graph and selected controls from Section 12.
- **Files/symbols:** `structural-diff.ts`, the 1.1-1.4 indexes, and each Section 12 hypothesis ID.
- **Command:** `npm exec tsx tools/oracle-lab/phase3a/structural-diff.ts -- --active 2.1.215
  --control VERSION --hypothesis HYPOTHESIS_ID --static-root "$P3A_EVIDENCE_ROOT/static"`.
- **Method:** compare package tree, sections, resource/chunk hashes, recovered module fingerprints,
  AST subtree hashes, API/env literal xrefs, call-graph neighborhoods, CFG/state transitions, and
  serialization schemas. Full-text diff is diagnostic only and cannot be the result.
- **RED:** identifier renaming and formatter-only change fixtures must normalize to no semantic
  change; changed branch/state fixtures must remain visible.
- **Output:** per-hypothesis structural diff with added/removed/changed modules, paths, state edges,
  confidence, and dynamic cells required.
- **Done:** every selected control has a bounded structural reason and no unselected version is
  silently analyzed.
- **Stop/budget:** 6 hours per selected control; stop expanding a control after its hypothesis is
  resolved or the relevant path is `Unknown`.
- **Parallel/dependency:** after 1.4 and the control's P3A-0 intake; controls may diff in parallel.
- **Nearest deliverable:** package/module/AST neighborhood delta with unresolved-path reasons.
- **Commit:** `feat(oracle): recover Phase 3A static structure and change points`.

## 10. P3A-2: controlled dynamic observation

### P3A-2.1 Isolation guard and deterministic launch

- **Inputs:** signed active binary, launch manifest, fake credentials, synthetic prompt/workspace.
- **Files/symbols:** `launch-manifest.ts`, `run-cell.ts`,
  `tests/oracle-phase3a-hermeticity.test.ts`, and existing
  `evaluate_egress_guard`/`run_same_scope_self_tests` adapters.
- **Isolation:** fresh HOME, `CLAUDE_CONFIG_DIR`, XDG config/cache/data/state, TMP/TEMP/TMPDIR,
  working directory, session ID, CA, and stdout/stderr per run; `env -i` allowlist; explicit TZ,
  LANG and LC_ALL; no keychain, credential helper, inherited file descriptor, shell startup file,
  agent socket, or existing Claude config. Network policy permits only declared loopback TCP/UDP and
  local IPC endpoints and denies every external socket.
- **RED:** attempt direct IPv4/IPv6, DNS, Unix socket, inherited listener, alternate loopback port,
  credential helper, or outside-root write; each must be observed and denied before client launch.
- **Command:** `npm exec tsx tests/oracle-phase3a-hermeticity.test.ts`, then
  `run-cell.ts --guard-self-test --manifest MANIFEST`; no client command runs unless GREEN.
- **Output:** guard self-test and exact launch manifest.
- **Done:** same-scope guard proves zero external socket budget. If macOS sandbox enforcement is
  unavailable, the cell cannot run merely with a proxy; use a rootless container/VM or mark blocked.
- **Stop/budget:** 2 hours per platform, 20 self-test cases, 10 process max.
- **Parallel/dependency:** after P3A-0.4; each platform guard is independent.
- **Nearest deliverable:** capability/blocked report; never an unsafe best-effort run.

### P3A-2.2 Fake upstream, proxy, TLS, HTTP/SSE/compact observers

- **Inputs:** Section 6 observers and existing Sub2API collector functions.
- **Files/symbols:** `observers/fake-upstream.ts`, `observers/connect-proxy.ts`,
  `SafeRequestCollector`, `capture_real_cli_sni_preserving_tls`, and their focused tests.
- **Modes:** direct loopback HTTP base URL; SNI-preserving local CONNECT without target dial; local
  MITM with per-run CA/cert; JSON and SSE fake upstream; HTTP 400/401/403/429/5xx/529; reset,
  certificate failure, delayed first byte, idle timeout, partial/reordered/duplicated SSE, GOAWAY
  where available, and compact/prompt-cache response variants.
- **Commands:** generate CA with frozen OpenSSL; bind `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY` to the
  observer; set test-only trust variables; try `SSLKEYLOGFILE` only as a recorded capability. The
  observer refuses non-loopback CONNECT resolution and never calls an upstream.
- **RED:** DNS rebinding fixture, CONNECT alternate host/port, redirect, absolute-form request,
  nested proxy, invalid CA, and observer transcript overflow.
- **Output:** pcap when permitted, TLS summary, HTTP transcript for synthetic bodies, SSE event
  trace, CA/cert digests, request/response AST, and observer state transitions.
- **Done:** request/response/stream/compact/telemetry lanes are captured locally; encrypted paths
  without a controlled decryption method remain `Unknown`.
- **Stop/budget:** 6 hours implementation, 128 MiB/run transcript cap, 10,000 events/run.
- **Parallel/dependency:** observer unit tests may run after 0.4; client capture waits for 2.1 GREEN.
- **Nearest deliverable:** loopback transcript and TLS handshake summary.

### P3A-2.3 Multi-layer instrumentation and perturbation control

- **Inputs:** static hook anchors and signed active binary.
- **Files/symbols:** Section 6 `hooks/*`, `run-cell.ts`, and static anchors from 1.4.
- **Layers:** Node `--require` preload, ESM `--loader`, module hooks, Bun preload, loopback
  Inspector/Debugger, and bounded probe/patch of a digest-verified isolated binary/bundle copy when
  preload/inspector cannot reach the path. Patches never touch the original or installed binary and
  record exact byte/AST diff and patched-copy digest.
- **Observed APIs:** process/env reads, module resolution, fs, child_process, DNS/net/tls/http/fetch,
  timers/retries, update/error/telemetry calls, serialization boundaries, and process exit.
- **Command:** `run-cell.ts --manifest CONTROL --instrumentation none`, then the digest-paired
  `--manifest TREATMENT --instrumentation preload|loader|bun|inspector|probe-copy`.
- **RED:** hook self-tests, missed native socket, recursive hook, output overflow, timestamp leakage,
  and an intentional perturbation fixture.
- **Output:** hook events with monotonic sequence/process/thread/module/stack-anchor hashes and a
  capability result for each layer.
- **Done:** every instrumented cell has an uninstrumented control. Changed normalized behavior is
  `instrumentation_perturbed` and cannot support a Phase 3B input.
- **Stop/budget:** 8 hours; two hook techniques plus one isolated-copy technique per root before
  `Unknown`.
- **Parallel/dependency:** after 1.4 and 2.1; hook self-tests may run in parallel, while each
  perturbation pair is serially indexed.
- **Nearest deliverable:** hook reachability map and explicit unreachable anchors.

### P3A-2.4 Environment/Base URL/System Prompt differential matrix

- **Inputs:** converged uninstrumented 2.1.215 baseline, static configuration/auth roots, exact
  launch-manifest schema, synthetic workspace/auth helpers, and fake upstream.
- **Files/symbols:** `launch-manifest.ts`, `run-cell.ts`, `normalize.ts`,
  `build_isolated_cli_env`, `classify_request_summary`, and static roots from 1.4.

Each pair changes one variable while holding archive, entrypoint, argv, synthetic input, fake
upstream, proxy, CA, model, feature toggles, clock policy, and all other env values fixed.

Required dimensions:

- TZ: `UTC`, `America/Los_Angeles`, `Asia/Shanghai`; locale: `C`, `en_US.UTF-8`,
  `zh_CN.UTF-8` when installed, otherwise exact unavailable reason;
- region env unset/empty/control values; HOSTNAME env and true OS hostname are separate. Actual OS
  hostname/platform/arch variation requires a VM/worker; setting `HOSTNAME` does not claim it;
- `ANTHROPIC_BASE_URL` and every statically discovered related Base URL variable: unset, empty,
  loopback neutral, and reserved `.test` hosts carrying one token from `aliyun`, `qwen`,
  `deepseek`, `volcengine`, `moonshot`, `zhipu`, `china`, `.cn`, `lab`, or `anthropic`;
- controls: unrelated token, edit-distance lookalike (`alivun`, `chinax`), substring control
  (`labyrinth`), same length/punctuation, and empty/unset distinction;
- clean vs inherited env, proxy-variable conflicts, official-hostname-via-CONNECT vs custom base;
- deterministic configuration-precedence conflicts across CLI flags, env, user config, managed
  config, IDE config, system proxy, shell startup, credential helpers, inherited descriptors and
  local agents; each source is introduced alone before pairwise conflicts;
- authentication lifecycle using placeholder-only API-key, setup-token, OAuth-shaped, helper,
  expired/refresh-failed, refreshed, restart and resumed-session fixtures; no real keychain/login;
- System Prompt bytes summarized by length, SHA-256, first difference, stable/variable span hashes,
  and canonical AST topology; request endpoint, headers, body AST, serialized-byte digest, CCH/cache
  class, and telemetry events.

Reserved hostnames terminate only at the local proxy/observer. No public DNS lookup or provider
connection is allowed.

- **RED:** matrix generator intentionally changes two values and must reject the pair.
- **Command:** `npm exec tsx tools/oracle-lab/phase3a/launch-manifest.ts -- --matrix
  environment-config-auth --emit MANIFEST_DIR`, validate every pair, then
  `run-cell.ts --manifest MANIFEST --observer fake-upstream`.
- **Output:** `pair.json`, two launch manifests, normalized observations, byte/AST diff, causal
  boundary, unchanged-fixed-variable digest, configuration-precedence order, and auth transition
  trace under the normalized-observation schema.
- **Done:** every listed dimension is Reproduced or Unknown with next action; no behavior conclusion
  is inferred from token presence alone.
- **Stop/budget:** 60 core pairs, max 12 repetitions/cell; risk-selected interactions only after
  single-variable effects exist.
- **Parallel/dependency:** after 2.1-2.3 and active baseline convergence; independent pair IDs may
  run in parallel, but each control/treatment block remains serial and randomized.
- **Nearest deliverable:** completed pairs plus explicit unrun cells.

### P3A-2.5 Telemetry, diagnostics, updates, process, fs, env, and network

- **Inputs:** static roots, nonessential traffic on/off, local OTLP HTTP collector, proxy observer.
- **Files/symbols:** `run-cell.ts`, `hooks/*`, `process-sampler.ts`, fake OTLP endpoint in
  `fake-upstream.ts`, and telemetry/update/error roots from 1.4.
- **Capture:** event names/attribute schemas and safe values; update-check destinations/timers;
  diagnostic/error-report triggers; crash and timeout paths; env/fs read/write attempts; process
  tree and executable digests; DNS/socket/TLS/HTTP attempts; timers, backoff, retries, and shutdown.
- **Dual source:** hook events must be corroborated by observer/OTLP transcript, filesystem snapshot,
  process sampler, socket table, or OS trace. An uncorroborated source states why.
- **RED:** intentional hook-only fake event, observer-only network event, and missing lineage parent.
- **Command:** generate paired nonessential-traffic manifests, run control/treatment through
  `run-cell.ts`, then `normalize.ts --run RUN_ID --merge-timeline`.
- **Output:** merged causal timeline keyed by monotonic sequence and process lineage.
- **Done:** telemetry/update/error paths are reachable or Unknown; “no event” is bounded to the
  trigger, duration, and observers used.
- **Stop/budget:** 30 minutes normal cell, 2 hours diagnostic cell, 256 MiB/run.
- **Parallel/dependency:** after 2.1-2.3; trigger families may run in parallel after the local OTLP
  and error-report endpoints pass observer RED/GREEN.
- **Nearest deliverable:** single-source trace labeled at the lower evidence level.

### P3A-2.6 Child/subtask, restart, long-running, failure/retry, stream/compact

- **Inputs:** static lineage/retry/random/IPC/state roots, converged active baseline, fake upstream
  state machine, placeholder auth, and isolated state roots.
- **Files/symbols:** `run-cell.ts`, `fake-upstream.ts`, `process-sampler.ts`,
  `converge.ts`, and 1.4 daemon/lineage/randomness roots.
- **Cells:** root vs child/subtask/fork; foreground vs background where locally terminable;
  cold/warm/restart/resume; clean shutdown vs kill/timeout/crash; 30-minute standard and 2-hour
  extended run; partial stream then error; retryable and terminal failures; stream-json slow reader;
  compact/prompt-cache transition; child process exit and daemon replacement; wall-clock forward/
  backward jumps in a VM or injectable clock fixture, suspend/wake, monotonic-vs-wall timing,
  fixed/varied random seeds, request/session ID/nonce generation, retry jitter, and IPC creation.
- **Capture:** parent/child run IDs, process IDs, exec hashes, session IDs as salted hashes, state
  files, sockets, timers, retry attempts, partial output AST, System Prompt/request mutations,
  telemetry correlation IDs as safe hashes, and restart lineage.
- **RED:** orphan process, lineage reuse, retry past limit, external socket, state write outside root,
  and missing terminal record.
- **Command:** `launch-manifest.ts --matrix lifecycle-failure-random-time`, followed by bounded
  `run-cell.ts` runs and `converge.ts --pair PAIR_ID`. Host clock is never changed; unavailable
  virtual/injected time remains `Unknown`.
- **Output:** normalized lifecycle/state-machine trace, randomness/timing classes, IPC/process graph,
  request/response AST, and convergence record.
- **Done:** each state transition has static anchor plus dynamic trace or a single-source reason.
- **Stop/budget:** process max 32, retry max 8 except a dedicated bounded watchdog cell, standard
  30 min, extended 2 h, hard 4 h/cell.
- **Parallel/dependency:** after 2.1-2.5 and active baseline convergence; destructive failure cells
  use distinct roots and may run in parallel within process/disk limits.
- **Nearest deliverable:** bounded state trace ending Unknown rather than an uncontrolled run.

### P3A-2.7 OS-level corroboration and platform limits

- **Inputs:** completed hook/observer cells, platform capability matrix, exact process IDs and
  loopback ports from launch manifests.
- **Files/symbols:** `process-sampler.ts`, platform trace adapters, and normalized observation
  source-agreement fields.
- **macOS:** capability-probe `fs_usage`, `opensnoop`, `dtruss`, Endpoint Security availability,
  `lsof`, process sampling, socket tables, and loopback packet capture. SIP, entitlement, BPF, or
  root restrictions are recorded. No `sudo` is permitted. Fallback is hook + FSEvents/tree diff +
  lsof/socket sampling + proxy transcript.
- **Linux:** `strace -ff -yy -e trace=%file,%process,%network`, rootless namespace/container guard,
  `lsof`/`ss`, and loopback capture when permitted. eBPF is optional and never assumed.
- **Windows:** signed native artifact static lane; dynamic lane only on an isolated Windows worker
  with process/file/network ETW or Procmon available under ordinary permissions. PowerShell
  process/TCP snapshots are fallback. No result is generalized from Wine.
- **RED:** capability probe must distinguish missing binary, permission denied, SIP/entitlement,
  unsupported platform, and tool failure.
- **Command:** `run-cell.ts --manifest MANIFEST --os-trace auto`; adapters execute only the frozen
  available command and always run `normalize.ts --compare-sources RUN_ID`.
- **Output/schema:** OS trace or capability failure artifact plus hook/observer/OS source-agreement
  row in the normalized-observation schema. Unknown transport families (QUIC/UDP, WebSocket,
  HTTP/2, Unix IPC, custom native sockets, encrypted or unparsed framing) each receive an explicit
  discovery result and cannot be collapsed into “no network.”
- **Done:** hook and network/file/process evidence have at least two sources for key conclusions, or
  the conclusion is explicitly single-source/Unknown.
- **Stop/budget:** 4 hours/platform. Do not weaken host security or request elevated permissions.
- **Parallel/dependency:** after 2.1 and at least one 2.2/2.3 cell; platform lanes may run in
  parallel, but a key conclusion waits for source comparison.
- **Nearest deliverable:** capability artifact, single-source trace, and explicit unknown-transport
  ledger.

### P3A-2.8 Repetition, order randomization, and convergence

- **Inputs:** normalized pair runs, observer/tool failures, perturbation comparisons, and declared
  randomization seed.
- **Files/symbols:** `converge.ts` and `tests/oracle-phase3a-convergence.test.ts`.
- **Design:** one non-evidence warmup; minimum five evidence repetitions per selected cell; maximum
  twelve. Pair order is deterministically randomized in balanced blocks from a recorded seed. Stop
  after at least five when stable leaves are identical, no new variable leaf/value appears in the
  last three runs, instrumented/uninstrumented comparison is classified, and both pair orders have
  occurred. Otherwise run to twelve and classify unresolved variation.
- **RED:** fixed three-run completion, identical seed/order for every pair, or a conclusion with a
  hidden failed repetition is rejected.
- **Command:** `npm exec tsx tests/oracle-phase3a-convergence.test.ts`, then
  `converge.ts --pair PAIR_ID --min 5 --max 12 --balanced-order --seed SEED`.
- **Output:** stable/variable/unresolved leaves, run order, outliers, observer failures, and causal
  boundary. Single observations remain `Observed`, never `Reproduced`.
- **Done:** convergence rules, not a positive result, determine GREEN.
- **Stop/budget:** max 96 machine-hours for active-target dynamic campaign.
- **Parallel/dependency:** consumes 2.4-2.7 outputs; pair convergence may run in parallel while the
  final coverage report waits for all selected pair terminal states.
- **Nearest deliverable:** per-pair stable/variable/unresolved report even when the campaign cap
  prevents another repetition.
- **Commit:** `feat(oracle): add hermetic Phase 3A dynamic observation harness`.

## 11. Differential output requirements

Every matrix cell compares at least:

1. System Prompt byte summary and canonical AST topology;
2. endpoint selection, header-name/value classes, body AST, final serialized bytes, CCH/billing/
   cache/compact class;
3. HTTP/SSE state and failure/retry/partial-output behavior;
4. telemetry, diagnostic, update, and error-report events;
5. process/subtask lineage, env/fs access, DNS/socket/TLS/HTTP, timers, restart, and long-run state;
6. hook trace versus network/file/process corroboration;
7. P2 wire/semantic/state/failure evidence fields without changing their gate decisions.

Causal language is limited to the tested intervention under the frozen conditions. A pair that
differs says the variable is associated with the reproduced difference in that scope; it does not
claim a provider-side policy or every platform/version.

## 12. P3A-3: selected version/change-point matrix

2.1.215 receives the complete active-target core. Controls receive only the listed static paths and
dynamic pairs. Selection uses official release notes plus existing repository evidence; release
notes motivate a hypothesis but do not prove behavior.

| Version | Role and evidence-backed reason | Required coverage |
| --- | --- | --- |
| `2.1.214` | immediate substantive predecessor: OTel correlation/content limit, long-tool heartbeat, stream-json drain, background daemon/restart, keep-alive retry changes | static diff plus telemetry, long-run, stream, restart, keep-alive pairs |
| `2.1.212` | `/fork`/`/subtask` lineage, streaming control restart, OTel export/context, gateway prompt-cache system block | static diff plus lineage, restart, OTel, compact/cache pairs |
| `2.1.211` | background Base URL auth after daemon respawn and cross-provider prompt-cache regression | Base URL/background/restart and compact/cache pairs |
| `2.1.208` | `CLAUDE_CODE_PROCESS_WRAPPER` and self-spawn routing | process-wrapper/child lineage static and dynamic pair |
| `2.1.207` | frozen predecessor target for P2 program and nearest pre-2.1.208 boundary | structured active-vs-predecessor diff and risk-targeted core |
| `2.1.203` | historical Base URL/background change and lazy bundled dependency change | Base URL/background plus module-layout static control |
| `2.1.201` | explicit System Prompt system-role placement change | System Prompt byte/AST/request-semantic pair |
| `2.1.200` | daemon build timestamp, restart, stale state and mixed-version persistence | state-machine/restart structured control |
| `2.1.199` | TLS certificate failure, partial stream, retry semantics | TLS/failure/partial-stream pairs |
| `2.1.179` | existing narrow CC/Sub2API oracle and TLS baseline | regression through existing harness, never candidate authority |
| `2.1.169` | legacy CCH compatibility boundary represented in current code; safe-mode/config changes help isolate customizations | static/fixture CCH control; runtime only if unresolved |
| `2.1.81` | `--bare`, API-key-only bare auth, beta suppression, concurrent refresh, channel/WebSocket boundary | static plus targeted bare/auth/beta/transport control |

Scheduling priority is explicit. Tier A is `2.1.214`, `2.1.212`, `2.1.211`, `2.1.208`, and
`2.1.207`: intake and the listed structural/dynamic pair are mandatory. Tier B is `2.1.203`,
`2.1.201`, `2.1.200`, `2.1.199`, `2.1.179`, `2.1.169`, and `2.1.81`: run the listed
static/fixture control first, and add its dynamic pair only when the active/Tier-A result leaves that
specific hypothesis unresolved. Budget exhaustion produces an explicit unrun/Unknown Tier-B row,
not silent coverage or an expanded campaign.

Explicit exclusions unless P3A-1 finds a relevant unresolved structural change:

- `2.1.213` has no official GitHub release artifact at planning time and is `Unknown`, not guessed;
- `2.1.209` is a narrow UI/background dialog release and adds no current evidence hypothesis;
- `2.1.210` changes permission/UI/background details already bounded by later 2.1.214 controls;
- `2.1.197`, `2.1.198`, `2.1.202`, `2.1.204`-`2.1.206` are not blindly rerun. Their old roadmap
  roles are superseded by the 2.1.215 active-target overlay or represented by a more precise selected
  control. They enter intake only if structural diff or a contradiction points to their exact note.

### P3A-3 task contract

- **Inputs:** official exact-version metadata/archive and Section 12 hypothesis.
- **Files/symbols:** `intake.ts`, `structural-diff.ts`, generated targeted launch manifests,
  and existing 2.1.179 native/CCH/TLS/env harness symbols from Section 5.
- **Commands:** reuse P3A-0 intake and P3A-1 structural diff; then only generated cells whose
  `hypothesis_id` names the row.
- **RED:** a control with no reason, floating tag, full Cartesian matrix, or inherited positive
  conclusion is rejected.
- **Output:** `change-point-matrix.json` with selection/exclusion reason, artifact digests, structural
  deltas, dynamic pairs, contradictions, and resolved/Unknown result.
- **Done:** every selected control resolves its bounded question or names the missing minimal action.
- **Stop/budget:** automated intake/static work is capped at 3 hours/control and dynamic work at
  6 machine-hours/control, but the **aggregate control lane** is capped at 16 analyst-hours and
  48 machine-hours (active-target dynamic cap 96 + controls 48 = 144, below the global 160).
  Stop a control as soon as its hypothesis is resolved; Tier B yields to Tier A and the global cap.
  Disk remains 2 GiB/control with only one unpacked control tree retained at a time.
- **Parallel:** controls may run in parallel after active baseline convergence, within disk/process
  budgets. Artifact index merge is serial.
- **Nearest deliverable:** intake plus structured static diff, even if runtime is unavailable.
- **Commit:** `feat(oracle): add reasoned Claude Code change-point matrix`.

## 13. P3A-4: normalization, conflicts, claims, and handoff

### P3A-4.1 Normalize and hash-link evidence

- **Inputs:** all completed raw artifacts and manifests.
- **Files/symbols:** `normalize.ts`, all Phase 3A schemas, artifact-index writer, and independent
  request/TLS parsers.
- **Command:** `normalize.ts --run RUN_ID`, independent parse where required, canonical JSON, schema
  validation, leak scan, artifact/index hash verification.
- **RED:** unknown field, raw sensitive literal, parser disagreement, orphan artifact, parent-cycle,
  digest mismatch, or nondeterministic rerun.
- **Output:** normalized observation, safe capsule, artifact index generation.
- **Done:** reproducible bytes and parser agreement or explicit disagreement.
- **Stop/budget:** 30 minutes/run, 512 MiB normalized output/run.
- **Parallel/dependency:** after a cell reaches a terminal capture state; per-run normalization may
  run in parallel, while index generation is serial.
- **Nearest deliverable:** validated subset plus rejected-artifact ledger.

### P3A-4.2 Evidence levels and contradiction/expiry rules

- **Inputs:** normalized observations, convergence/source-agreement reports, P2 authority ceilings,
  and the static/dynamic cross-link index.
- **Files/symbols:** `safe-error-classifier.ts`, `build-exit.ts`,
  `tests/oracle-phase3a-safe-error.test.ts`, and the conclusion schema.
- **Command:** run the safe-error mutation/fuzz corpus, then
  `safe-error-classifier.ts --artifact-index INDEX --in-memory-only --emit-safe SAFE_ERRORS` and
  `build-exit.ts --classify-conclusions`. The classifier has an exact allowlist of safe error
  codes/categories, bounded lengths, and leak canaries for credentials, URLs/domains, prompts,
  bodies, CCH, IDs, paths, control characters, Unicode confusables, and nested exception causes.
  Raw error strings are classified in memory and discarded.
- **RED:** unknown error class, canary leakage, truncated multibyte text, raw nested cause, missing
  contradiction edge, expired evidence treated as current, or one run upgraded to Reproduced.
- **Output/schema:** safe error taxonomy/leak report plus conclusion rows with the required level,
  scope, supporting/contradicting artifacts, expiry and authority ceiling.

Levels are:

- **Observed:** one bounded observation with exact manifest and sources;
- **Reproduced:** repeated convergence under the same scope, including both randomized pair orders;
- **Inferred:** static/dynamic facts support an explanation but not direct observation;
- **Unknown:** absent coverage, unresolved variation, observer failure, encryption, platform/permission
  limit, version drift, parser disagreement, perturbation, or contradiction.

Key conclusions require a static anchor plus dynamic reproduction. A single-source conclusion is
allowed only when it records why the second source is impossible and remains below `Reproduced`.
Newer, exact-scope evidence does not silently erase old evidence. Contradictions list both artifact
IDs, lower the result to `Unknown`, disable Phase 3B use, and name the next minimal experiment.
Expired evidence remains addressable but unusable. A missing string can only support “not found by
tool X in surfaces Y”; it cannot support “does not exist.”

- **Done:** every conclusion validates; fuzz canaries are fully rejected/redacted; contradictions
  and expiry lower authority deterministically; no raw error bytes persist.
- **Stop/budget:** 4 hours, 10,000 fuzz cases, 1 MiB in-memory error limit and 16 KiB safe output
  limit per case. Any leak stops exit generation.
- **Parallel/dependency:** after 4.1 and relevant convergence; conclusion families may classify in
  parallel, with a serial contradiction merge.
- **Nearest deliverable:** safe error/leak report and Unknown conclusion ledger.

### P3A-4.3 Map evidence to P2 contract

- **Inputs:** normalized request/response/CCH/TLS/state/failure facts and P2 bundle.
- **Files/symbols:** `build-exit.ts`, P2 `decideBehaviorAdmission`, canonicalization,
  cross-project types, and Sub2API `oracle_contract_*` fixture consumers.
- **Output:** evidence references for wire, semantic, state-sequence, and failure-semantics fields;
  behavior-coherence/negative-capability candidates; no changed gate decision or runtime admission.
- **RED:** an evidence row exceeding its authority ceiling, unknown capability treated as allowed,
  or Phase 3A writing the shared contract.
- **Done:** TS and Go P2 fixture consumers accept the safe fixtures and reject mutations; original
  bundle digest remains `254511...bce`.
- **Command:** the focused P2 TS/Go tests and joint checker in Sections 2 and 5.
- **Stop/budget:** 3 hours; stop on any original P2 bundle-byte change or TS/Go interpretation
  disagreement.
- **Parallel/dependency:** after 4.1/4.2; four gate mappings may be built in parallel, then verified
  together.
- **Nearest deliverable:** evidence-reference map with all unusable rows explicitly disabled.

### P3A-4.4 Exit report exact contents

- **Inputs:** terminal artifact index, toolchain/capability records, static/dynamic/change-point
  reports, conclusions, P2 mapping, resource/retention records and leak scan.
- **Files/symbols:** `build-exit.ts --exit-report`, exit/handoff schemas, and
  `tests/oracle-phase3a-exit.test.ts`.
- **Command:** `npm exec tsx tests/oracle-phase3a-exit.test.ts`, then
  `build-exit.ts --exit-report --artifact-index INDEX --out phase-3a-exit-report.json`; render the
  Markdown report only from the validated machine-readable bytes.
- **RED:** omit each required section in turn, insert stale/perturbed/Unknown usable evidence, alter
  an artifact digest, or add a prohibited scope claim; every mutation fails with a stable code.
- **Output/schema:** `phase-3a-exit-report.md` and its machine-readable companion include:

1. repository commits/trees/dirty digests and CodeGraph status/version/index digests;
2. wrapper/platform/release URLs, metadata, archive/tree/entrypoint digests, signature status, and
   complete execution graph;
3. toolchain and observer capability matrix by platform;
4. static inventory, extraction coverage, module/AST/xref/callgraph/CFG/state-machine indexes;
5. active and change-point coverage model, seeds, run order, omissions, degraded reasons;
6. request/response/System Prompt/CCH/telemetry/process/fs/network/TLS/HTTP/SSE/compact summaries;
7. perturbation and dual-source comparison report;
8. convergence, contradictions, expiry, error/tool-failure classes, and Unknown ledger;
9. conclusion table with levels, scopes, authority ceilings, evidence IDs, and prohibited claims;
10. P2 four-gate evidence mapping and unchanged contract digest proof;
11. leak/redaction scan, retention state, cleanup candidates, disk/time usage, and no-deletion note;
12. exact commands and failed/unavailable tool diagnostics;
13. Phase 3B-usable rows and negative capabilities; no generated runtime profile;
14. confirmation of no production, real credential/upstream/canary, profile promotion, Phase 4
    wiring, or protected-file access.

- **Done:** all 14 sections and digests validate, generated Markdown is deterministic, and every
  usable conclusion is backed by its indexed artifacts.
- **Stop/budget:** 4 hours and two deterministic render attempts; a leak/digest/orphan failure stops
  publication.
- **Parallel/dependency:** after 4.1-4.3 and all selected cells are terminal; report build is serial.
- **Nearest deliverable:** validated machine-readable partial report with exact missing gates.

### P3A-4.5 Phase 3B/3.5 handoff bundle

- **Inputs:** validated exit report, P2 bindings, usable conclusion rows, Unknown/negative-capability
  ledger, and deterministic candidate-input schema.
- **Files/symbols:** `build-exit.ts --phase3b-handoff`, handoff schema, and
  `tests/oracle-phase3a-handoff.test.ts`.
- **Command:** `npm exec tsx tests/oracle-phase3a-handoff.test.ts`, then
  `build-exit.ts --phase3b-handoff --exit-report EXIT_JSON --out HANDOFF_JSON`; validate twice and
  compare bytes.
- **RED:** unknown, contradictory, expired, parser-disagreeing, perturbed, single-observation-only,
  or over-authority row marked usable; raw material; generated profile/config; missing rollback.
- **Output/schema:** a byte-deterministic `oracle-lab-phase3a-handoff.v1` bundle contains exactly:

- exit report and machine-readable digest;
- P2 bundle/predecessor digests and supported schema range;
- active artifact identity and execution graph;
- safe normalized evidence/capsule index and verification commands;
- request/response/System Prompt/CCH/TLS/HTTP/telemetry/state/failure decision rows;
- evidence levels, scopes, expiry, contradictions, Unknowns, and negative capabilities;
- deterministic candidate-input schema and rows marked `phase3b_usable=true`;
- platform/change-point coverage and omitted-cell reasons;
- required Phase 3B compiler acceptance cases: new streaming session, resumed streaming session,
  bounded failure/recovery, deterministic regeneration, and TS/Go/fixture agreement;
- rollback reference to prior independently addressable evidence tuple;
- no raw sensitive material, no profile/config output, no signing/promotion/deployment authority.

Phase 3B/3.5 must refuse a row that is Unknown, contradictory, expired, parser-disagreeing,
perturbed, single-observation-only, or above the local evidence authority ceiling.

- **Done:** two builds are byte-identical, all refs resolve, Phase 3B acceptance-case inputs are
  present, and no executable profile/runtime authority exists.
- **Stop/budget:** P3A-4 total 1 analyst-day; any leak, orphan digest, unresolved key contradiction,
  or non-reproducible capsule blocks exit but leaves the validated subset as the nearest deliverable.
- **Parallel/dependency:** after 4.4; serial build only.
- **Nearest deliverable:** schema-valid blocked handoff naming missing evidence/capability.
- **Commit:** `docs(oracle): publish Phase 3A safe evidence and Phase 3B handoff`.

## 14. Error taxonomy and stop rules

Every failure is one of:

```text
repository_drift, contract_drift, artifact_identity, integrity_mismatch, archive_unsafe,
unpack_failed, unsupported_format, extraction_opaque, parse_failed, deobfuscation_nondeterministic,
static_edge_unresolved, isolation_unavailable, external_socket_attempt, observer_failed,
hook_unavailable, instrumentation_perturbed, inspector_unavailable, permission_denied, sip_blocked,
trace_tool_failed, tls_uninspectable, parser_disagreement, timeout, crash, output_truncated,
partial_output, retry_limit, process_limit, disk_limit, version_drift, contradiction,
evidence_expired, sensitive_material, unknown_field, unsupported_platform, unknown
```

Global immediate stops:

- active artifact identity cannot be fixed or wrapper/platform/release bytes disagree unexplained;
- remote main changes a P2/3A contract anchor;
- loopback isolation cannot enforce zero external sockets;
- a real credential or endpoint enters a manifest/process environment;
- a capture contains durable prohibited raw material;
- free disk falls below 8 GiB, evidence root exceeds 22 GiB, or a process/output limit is bypassed;
- a design conflict requires operator authority rather than an evidence classification.

Ordinary missing tools, SIP restrictions, parser failures, and unsupported platforms produce a
reversible fallback and lower evidence level; they do not automatically block unrelated cells.

## 15. Resource, retention, and cleanup budget

Current planning state observed about 30 GiB free. Formal execution uses:

| Class | Soft cap | Hard cap |
| --- | ---: | ---: |
| active wrapper/platform/release artifacts | 1 GiB | 2 GiB |
| selected control archives, unpack one at a time | 3 GiB | 5 GiB |
| static sections/AST/graphs/diffs | 4 GiB | 6 GiB |
| dynamic run traces/transcripts/pcap | 5 GiB | 7 GiB |
| normalized capsules/reports | 1 GiB | 2 GiB |
| **evidence root total** | **16 GiB** | **22 GiB** |

Reserve at least 8 GiB free. Check `du -sk` and `df -k` before every batch. New controls are intake
on demand; do not keep all unpacked trees concurrently. Raw synthetic captures default to 14-day
retention; normalized safe capsules and official archives remain until Phase 3B/3.5 acceptance.
Quarantine is 24 hours pending review. Retention changes are artifact-indexed.

Expected time: P3A-0 0.5 day, P3A-1 2 days, P3A-2 3 days plus bounded machine time, P3A-3 1 day,
P3A-4 1 day. Hard campaign cap is 7 analyst-days and 160 machine-hours before re-planning.

Cleanup candidates, never automatically removed:

- superseded unpacked control trees after their archive/tree/index digests and needed sections are
  bound in a validated capsule;
- isolated patched/probe copies after perturbation records are validated;
- expired synthetic-only pcaps/transcripts after normalized capsules pass dual parser and leak scan;
- failed extractor scratch after the minimal reproduction and error digest are retained;
- planning intake cache, including the accidental literal `${root}` sibling directory created
  during planning recon (approximately 320 MiB), after formal P3A-0 independently reproduces bytes;
- planning-only sibling Sub2API clone and both planning CodeGraph indexes after PR acceptance.

Deletion requires separate operator confirmation under the local safety policy. This planning task
deletes nothing.

## 16. Focused verification ladder

No broad/full product suite runs during planning or ordinary H3A tasks. Formal task tests are:

```bash
# planning/doc checks
test -s docs/superpowers/plans/2026-07-19-claude-code-2.1.215-phase-3a-evidence-factory.md
! rg -n 'TO[D]O|TB[D]|FIXM[E]|PLACEHOLDE[R]|@lates[t]' \
  docs/superpowers/plans/2026-07-19-claude-code-2.1.215-phase-3a-evidence-factory.md

# H3A unit/schema/mutation/focused tests after implementation
npm exec tsx tests/oracle-phase3a-schema.test.ts
npm exec tsx tests/oracle-phase3a-intake.test.ts
npm exec tsx tests/oracle-phase3a-static.test.ts
npm exec tsx tests/oracle-phase3a-hermeticity.test.ts
npm exec tsx tests/oracle-phase3a-observer.test.ts
npm exec tsx tests/oracle-phase3a-normalize.test.ts
npm exec tsx tests/oracle-phase3a-convergence.test.ts
python3 -m unittest tools.tests.test_oracle_phase3a_adapter

# unchanged focused predecessor gates
npm exec tsx tests/native-oracle-matrix.test.ts
npm exec tsx tests/cch-oracle-harness.test.ts
npm exec tsx tests/oracle-contract-cross-repo.test.ts
(cd "$SUB2API_ROOT/backend" && go test ./internal/service \
  -run 'TestOracleContract(Canonical|Admission|Authority|CrossProject)$' -count=1)
```

Campaign commands validate manifests, artifact indexes, normalized observations, leak scans,
convergence, and P2 mapping before an exit report is generated. A test pass proves only the named
harness invariant, not the observed client behavior.

## 17. Formal commit and review strategy

Recommended future commits, each independently testable:

1. `test(oracle): define Phase 3A evidence contracts`
2. `feat(oracle): add pinned Claude Code artifact intake`
3. `feat(oracle): recover static bundle and control flow`
4. `feat(oracle): add hermetic dynamic observation harness`
5. `feat(oracle): add reasoned change-point comparisons`
6. `docs(oracle): publish safe Phase 3A evidence and handoff`

Cross-repository changes are paired by a shared evidence-schema digest and focused checker, not by
receipts or leases. Product files are not mixed into these commits. A formal campaign tip is frozen
before conclusion review; a repair reruns only intersecting focused tests/cells and regenerates
dependent capsules.

The Phase 3A exit gate is GREEN only when:

- exact artifact/execution provenance and toolchain are reproducible;
- static work goes beyond strings to recover AST/module/xref/callgraph/CFG/state evidence or exact
  Unknown ranges;
- dynamic work is hermetic, repeated, order-randomized, and dual-source for key conclusions;
- every required concern has a result or explicit Unknown with a next minimal action;
- every key conclusion has static + dynamic support or an explicit single-source limitation;
- untested platforms, permission-blocked traces, encrypted paths, and unexplained variation remain
  Unknown and disabled;
- evidence is schema-valid, hash-linked, leak-scanned, contradiction-aware, and within retention;
- Phase 3B/3.5 receives sufficient safe inputs to build executable candidate config while Phase 3A
  has not generated it;
- P2 contract bytes remain unchanged and no Phase 4/production behavior is wired.

## 18. Version update policy

`2.1.215` is frozen for the whole phase. A later Claude Code release enters only an intake backlog
with metadata/archive/tree/entrypoint digests, package-tree delta, and affected-hypothesis map. It
does not replace active manifests, reroute cells, inherit positive conclusions, or restart the
phase. Only an explicit operator re-freeze can retarget the active campaign. The H3A method and
schemas are reusable; version-specific evidence and conclusions are not.

## 19. Planning-task self-audit checklist

- [x] Both expected remotes fetched; commits and trees frozen; no anchor drift.
- [x] Separate clean Sub2API planning clone; operator checkout untouched.
- [x] CodeGraph initialized, synced, and queried first in both roots.
- [x] Phase 2 handoff, roadmap, design, hardening, review amendments, operating model, transition
  handoff, registry, Claim Matrix, H0 manifest, P2 contract/checker, and real harness paths covered.
- [x] Official 2.1.215 wrapper/platform/release source, digests, layout, entrypoint, signature bytes,
  and tool versions frozen; no behavior/risk-control conclusion made.
- [x] Static reverse includes formatter/AST/module/xref/callgraph/CFG/state/deobfuscation and
  structured diff, not a string scan/full-text diff.
- [x] Dynamic plan includes isolation, preload/loader/Inspector/probe copy, process/fs/env/network,
  TLS/HTTP/SSE/compact/telemetry, OS tracing/fallback, and dual-source perturbation checks.
- [x] Differential matrix changes one variable, fixes the rest, repeats, randomizes order, and
  reports causal limits.
- [x] Every task names inputs, paths/symbols, commands, RED, output/schema, completion, stop/budget,
  dependencies/parallelism, and nearest deliverable.
- [x] Evidence levels, contradiction/expiry, version intake, exit/handoff, disk/retention/cleanup,
  and commit strategy are explicit.
- [x] No receipt/context/lease/Recovery or overbuilt authorization mechanism added.
- [x] No Phase 2 product/shared-contract mutation, Phase 4 wiring, production, real upstream,
  credential, canary, deployment, or profile promotion authorized.
