# Claude Code 2.1.215 P3A-S Resume/Session-Lineage Supplement Plan

> **Plan-only status (2026-07-22): BLOCKED.** This document authorizes no dynamic Claude Code
> execution, no supplement execution, no Phase 3B implementation, no profile generation, no real
> upstream, no real credential, no canary, and no runtime wiring. The only positive resume claim
> allowed by this plan is `CL-P3A-SUPP-RESUME-LINEAGE`; it may set `phase3b_usable=true` only
> after the future supplement is independently reviewed and all gates below pass.

## 1. Decision and boundary

The current authoritative state is:

1. The active target is Claude Code `2.1.215` on Darwin arm64. `2.1.207` is historical/reference
   only. No observation, digest, fixture, or conclusion may cross that version boundary.
2. The immutable P3A v13 safe closure contains exactly two usable rows:
   `CL-P3A-R2-CONFIG-AUTH` and `CL-P3A-R2-FAILURE-STREAM`. Both expire at
   `2026-08-03T00:00:00.000Z`.
3. `CL-P3A-RESUME-LINEAGE-UNKNOWN` remains non-usable. New-session behavior, fresh-session
   fallback, or historical child-lineage evidence cannot prove resume consumption.
4. Phase 3B remains blocked until a separately approved P3A-S run emits a new, reviewed,
   unexpired `CL-P3A-SUPP-RESUME-LINEAGE` row with `phase3b_usable=true`, and append-only
   successors independently revalidate both existing usable conclusion families.
5. The supplement is an evidence-harness operation only. It does not modify `startProxy`,
   `handleRequest`, Sub2API scheduling, sidecar transport, DNS, sockets, account lifecycle,
   receipt/context/lease/Recovery machinery, or any Phase 4/6A path.

The protected path
`backend/internal/service/openai_compact_sse_keepalive_test.go` is outside every search, CodeGraph
file inventory, command, test, mutation, compile, stage, commit, and diff. The supplement must
also prohibit `go test ./...`, `go test ./internal/service`, and implicit package-wide child
runners. No production, real upstream, real account/token/proxy, real canary, deployment,
promotion, or profile output is permitted.

## 2. Governing inputs and fresh baseline

### 2.1 Precedence

Bind inputs in this order:

1. The merged Phase 3B plan
   `docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3b-profile-synthesis.md`,
   especially Sections 4, 7.2, 8, 10-13, 15, and 16.
2. `docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md`.
3. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md`.
4. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-adversarial-validation-v2.md`.
5. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-design.md`.
6. The merged P2 plan and handoff, then the immutable P3A v13 safe closure bindings below.

The active-target overlay wins over historical wording. The plan never treats a historical
`2.1.207` row as a `2.1.215` input.

### 2.2 Fetched repository heads

Both remotes were fetched on 2026-07-22. The CC Gateway planning worktree is clean on the
plan-only branch from `muqihang/main`. Sub2API was inspected from a separate detached clean
worktree created at the fetched `muqihang/main`; the existing Sub2API feature checkout was not
changed.

| repository | planning root | `muqihang/main` head | tree | role |
| --- | --- | --- | --- | --- |
| CC Gateway | `/Users/muqihang/.codex/worktrees/562a/cc-gateway` | `612dd5ed4f0a152aa5567549e91ea19d10466141` | `ca648860af36fb4394233539264312ec2f486d79` | canonical plan owner |
| Sub2API | `/Users/muqihang/.codex/worktrees/562a/sub2api-main` | `fb840673afc0ff590fef9bb147fce5b9b70eb098` | `eeb8654eddf7a4c38364202f5024161e65d2a6d1` | read-only paired baseline |

The future P3A controller must fetch again and must assert both head and tree before any dynamic
work. No current head is a future execution pin.

The PR review freeze for this one-time revision is also explicit: base
`612dd5ed4f0a152aa5567549e91ea19d10466141` / tree
`ca648860af36fb4394233539264312ec2f486d79`; prior PR head
`c0f4aeee916dc737de4db30c80c207f1b4f1d8fa` / tree
`63f04a35984ee55f1b30209682b1cdf2c51b512c`; prior plan digest
`34902775b63c8bf0960ca02139d00bfd4a51eeff919ac3310c17852f6a28355c`. The prior digest is
invalid after this revision. The new head/tree and revised plan digest are reported only after
the revision commit.

### 2.3 CodeGraph refresh and exclusion proof

CodeGraph 1.1.6 was refreshed from `/Users/muqihang/.local/bin/codegraph` with the exact local-only
configuration bytes:

```json
{"exclude":["backend/internal/service/openai_compact_sse_keepalive_test.go"]}
```

The configuration SHA-256 is
`f885ea40698ff4de9881ce6a9537388ce80c04be9515bf2c77ac186d39140e98`. The CC refresh completed
with `262 files`, `9,229 nodes`, and `32,322 edges`. Its SQLite file inventory query returned
`protected_count=0`. The independent Sub2API main refresh completed with `3,064 files`,
`98,766 nodes`, and `331,888 edges`; its SQLite file inventory query also returned
`protected_count=0`. Both figures are final planning-baseline statistics, not execution output.

The future controller must repeat, around every `init`, `index`, `sync`, and `status`:

```bash
test "$(shasum -a 256 "$ROOT/codegraph.json" | awk '{print $1}')" = \
  f885ea40698ff4de9881ce6a9537388ce80c04be9515bf2c77ac186d39140e98
sqlite3 "$ROOT/.codegraph/codegraph.db" \
  "SELECT COUNT(*) FROM files WHERE path='backend/internal/service/openai_compact_sse_keepalive_test.go';"
```

The query must return `0` in both roots. `codegraph explore`, `codegraph node`, and the future
supplement controller may use only this exclusion-aware index. If CodeGraph is unavailable or
stale, the run is `BLOCKED` unless the fallback reason, zero protected inventory proof, and
fallback discovery inventory are recorded in the plan-bound command result.

Every graph operation, including `init`, `index`, `sync`, `status`, `explore`, and `node`, must be
called through the authority wrapper `codegraph_with_exclusion(root, operation, args...)`. The
wrapper accepts only those six operations, verifies the canonical config SHA before and after the
child, and fails closed on drift. `explore` and `node` are not exceptions to the protected-path
boundary. The final SQLite file-inventory query is the only protected-path assertion and returns
zero without opening the protected source.

The future controller ports the merged authority helpers, rather than printing their results:

```bash
assert_no_dangerous_git_env() {
  node --input-type=module -e '
    const forbidden=["GIT_DIR","GIT_WORK_TREE","GIT_INDEX_FILE","GIT_OBJECT_DIRECTORY",
      "GIT_ALTERNATE_OBJECT_DIRECTORIES","GIT_COMMON_DIR","GIT_NAMESPACE","GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_SYSTEM","GIT_CONFIG_NOSYSTEM","GIT_CONFIG_COUNT","GIT_CONFIG_PARAMETERS",
      "GIT_ATTR_NOSYSTEM","GIT_EXEC_PATH","GIT_PREFIX","GIT_CEILING_DIRECTORIES",
      "GIT_DISCOVERY_ACROSS_FILESYSTEM"];
    const inherited=forbidden.filter((name)=>Object.hasOwn(process.env,name));
    if (inherited.length) process.exit(65);
  '
}
assert_git_freeze() {
  root="$1"; reviewed_head="$2"; reviewed_tree="$3"; frozen_remote="$4"; expected_branch="$5"
  test "$(git -C "$root" rev-parse HEAD)" = "$reviewed_head"
  test "$(git -C "$root" rev-parse 'HEAD^{tree}')" = "$reviewed_tree"
  test "$(git -C "$root" rev-parse refs/remotes/muqihang/main)" = "$frozen_remote"
  test "$(git -C "$root" symbolic-ref --quiet --short HEAD)" = "$expected_branch"
  test -z "$(git -C "$root" status --porcelain=v1 --untracked-files=no)"
  git -C "$root" diff-index --quiet HEAD --
}
codegraph_with_exclusion() {
  root="$1"; operation="$2"; shift 2
  case "$operation" in init|index|sync|status|explore|node) ;; *) return 64 ;; esac
  test "$(shasum -a 256 "$root/codegraph.json" | awk '{print $1}')" = \
    f885ea40698ff4de9881ce6a9537388ce80c04be9515bf2c77ac186d39140e98
  (cd "$root" && /Users/muqihang/.local/bin/codegraph "$operation" "$@")
  test "$(shasum -a 256 "$root/codegraph.json" | awk '{print $1}')" = \
    f885ea40698ff4de9881ce6a9537388ce80c04be9515bf2c77ac186d39140e98
}
assert_no_dangerous_git_env
```

The preflight invokes `assert_git_freeze` after fetching `muqihang/main`, installs the canonical
local-only exclusion, and routes every graph operation through `codegraph_with_exclusion`. RED
mutations cover wrong local HEAD, wrong tree, moved remote main, unexpected/detached branch,
staged or untracked dirt, dangerous Git environment, config drift before/after each operation,
and nonzero protected inventory. Any failed assertion stops before a child or target launch.

### 2.4 P2 and merged-plan authority bindings

The supplement input manifest must bind these immutable P2/plan identities exactly:

| input | exact identity |
| --- | --- |
| P2 bundle digest | `2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce` |
| P2 predecessor digest | `70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1` |
| supported schema range | `1:0-0` |
| merged Phase 3B plan | `docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3b-profile-synthesis.md`, SHA-256 `0687ccaea710647a357993aaefc389078d68f54c2d5ae51f6710d63c2e3906d3` |
| merged P2 handoff | `docs/superpowers/2026-07-19-claude-code-2.1.215-phase-2-handoff.md`, SHA-256 `a5454d630dc470cda54adaaed6a4eab5ebd2b8c53909ae5487e4a59b29cee4d9` |

The P2 bundle, predecessor, schema range, merged-plan digest, and handoff digest are immutable
input fields, not prose references. Any mismatch, missing bundle, range drift, or cross-version
substitution is `BLOCKED` before cell generation.

## 3. Immutable P3A v13 inputs

Only these five safe closure artifacts may be read from the v13 evidence root. The raw evidence
root, capsules other than these exact paths, and any supporting raw artifact are not inputs.

| artifact | exact path | SHA-256 | schema |
| --- | --- | --- | --- |
| exit v13 | `/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-4/phase-3a-exit-report-v13.json` | `57f16b207933b3a751f96471733d435fa4b0c9801fbef2f5495e8884dfe0bd1b` | `oracle-lab-phase3a-exit.v1` |
| handoff v13 | `/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-4/phase-3b-3.5-handoff-v13.json` | `9d188072719dc27a2f9cc9939bc79afa598802b84dd4d9161fb1da3263a792d7` | `oracle-lab-phase3a-handoff.v1` |
| terminal v8 | `/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-4/closure-terminal-manifest-v8.json` | `c9ee57fbe29125c88278961565f814326b052077b861bb41008cdde6161f12f5` | `oracle-lab-phase3a-r4-terminal.v1` |
| artifact index v23 | `/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-4/artifact-index-v23.json` | `e8645c7ed4bc984a926f91e3df1b756c4b009b3a02408de213cbe81b060e80d4` | `oracle-lab-phase3a-artifact-index.v1` |
| leak scan v23 | `/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-4/leak-scan-v23.json` | `7ed3e2776c7fcc47d6c8d513318b33547919c92a33a068a4f0c0cb3706bad145` | `oracle-lab-phase3a-leak-scan.v1` |

The v13 artifact identity is bound as follows:

| safe identity | SHA-256 |
| --- | --- |
| `claude-code-2.1.215-wrapper` archive | `1a5cf8e491689154264c0b2f28371bf645cdee2903b45c497915868308502d7b` |
| wrapper unpacked tree | `024fa410b532ced37cd9e45a95aae6f9eb22e9ce8491e1fad843f24d958f4a88` |
| `claude-code-2.1.215-platform` archive | `b5dd6a135c96957dae232218c4ae5b04328a788f8c509202c92a2fec550601b2` |
| platform unpacked tree | `864f493d9fc237df6a858e1620c83279b8f6c15f205dbb47c058f3f537e924a6` |
| executed Darwin arm64 entrypoint | `90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58` |
| official Darwin arm64 release archive | `599883973d2b4c8bb25e3490c84d65646f78d158cdc86adc73c1f5a6cfbbd600` |
| release unpacked tree | `f5a04795289524b639b479fe6ffac187218d7c558a5a5be312ee228850c6e7fe` |

The supplement may copy only typed identity refs/hashes and the normalized-safe v13 candidate
rows. It must preserve the v13 bytes and must never overwrite or relabel them.

## 4. Current implementation anchors

CodeGraph was used first for symbol exploration. The following current source anchors are the
fallback-verified paths and call relations the future implementation must reuse or explicitly
extend. These are observations, not an authorization to edit them in this plan PR.

### 4.1 CC Gateway P3A harness

| concern | current symbol | call path / test anchor |
| --- | --- | --- |
| manifest validation and digest | `tools/oracle-lab/phase3a/launch-manifest.ts:109 validateLaunchManifest`, `:127 loadLaunchManifest`, `:135 manifestDigest` | `run-cell.ts:9` imports them; `runCell` validates the manifest before launch |
| isolated environment | `launch-manifest.ts:190 buildIsolatedEnvironment` | called by `run-cell.ts:305 runCell`; placeholder credentials and loopback proxy are manifest-owned |
| cell guard and execution | `tools/oracle-lab/phase3a/run-cell.ts:186 runCellGuardSelfTest`, `:305 runCell` | `tests/oracle-phase3a-hermeticity.test.ts`, `instrumentation.test.ts`, and campaign modules |
| process lineage | `tools/oracle-lab/phase3a/process-sampler.ts:41 descendants`, `:51 sampleProcessTree`, `:74 sampleSocketCount` | imported by `run-cell.ts`; safe process samples are distinct from upstream HTTP facts |
| fake upstream | `tools/oracle-lab/phase3a/observers/fake-upstream.ts:106 jsonTopology`, `:161 requestFacts`, `:243 startFakeUpstream` | `environment-campaign.ts` and `tier-a-dynamic-campaign.ts` start it; observer test uses two local instances at `tests/oracle-phase3a-observer.test.ts:101` |
| c4 run set | `tools/oracle-lab/phase3a/c4-evidence.ts:6 expectedAuthoritativeC4RunIds`, `:10 validateAuthoritativeC4RunIds` | exactly three pairs, twelve repetitions, both arms, 72 run IDs; artifact identity test asserts 73 execution directories including baseline |
| order/convergence | `tools/oracle-lab/phase3a/converge.ts:48 balancedPairOrder`, `:83 analyzeConvergence` | minimum 5, maximum 12 repetitions; both order directions; tail-of-three unresolved check; `tests/oracle-phase3a-convergence.test.ts:29-59` |
| normalization | `tools/oracle-lab/phase3a/normalize.ts:43 normalizedEventOrder`, `:56 normalizeCapsule` | validates cell file bindings before normalized-safe projection |
| artifact writer | `tools/oracle-lab/phase3a/artifact-index.ts:80 buildArtifactIndex`, `:95 verifyArtifactIndex`, `:106 writeArtifactIndex` | parent graph cycle/orphan checks and exclusive canonical write; current `mtime` field must not be copied into deterministic supplement bytes |
| leak guard | `tools/oracle-lab/phase3a/leak-guard.ts:18 scanArtifactIndex`, `:51 writeLeakScan` | scans indexed artifacts; supplement needs a generated-file-only scanner plus forbidden-field canaries |
| exit/handoff | `tools/oracle-lab/phase3a/build-exit.ts:190 buildExitReport`, `:248 buildHandoff`, `:268 buildBlockedDeliverables` | existing exit requires all five cases, including resumed streaming; supplement must feed only its safe conclusion row |
| terminal | `tools/oracle-lab/phase3a/r4-terminal.ts:105 buildR4TerminalManifest` | current R4 binding is a precedent for final status and digest checks, not a resume proof |
| artifact identity | `tools/oracle-lab/phase3a/artifact-identity.ts:... buildArtifactIdentityGraph`, `verifyArtifactIdentityGraph` | `tests/oracle-phase3a-artifact-identity.test.ts:24-58`; future cells bind the exact v13 entrypoint and tree refs |

The important current call chain is:

```text
launch-manifest -> run-cell -> process-sampler
                              -> fake-upstream -> normalize
c4-evidence -> converge -> campaign/projection
artifact-index -> leak-guard -> build-exit -> build-handoff -> r4-terminal
```

The supplement adds a separate state-access observer and a separate append-only closure builder;
it must not make `buildExitReport` infer resume from existing `phase3b_usable` rows.

### 4.2 Sub2API baseline

The fresh Sub2API main tree has the P2 mirror and focused contract code, including
`backend/internal/service/oracle_contract_{types,canonical,admission,authority,cross_project}.go`
and `backend/internal/service/testdata/oracle_lab_contract/v1/`. It has no current P3A resume
supplement harness. Future P3A-S implementation is CC Gateway-owned evidence tooling; any later
paired Phase 3B compiler work must add a narrow Sub2API mirror only after this plan is merged and
the supplement closure is independently reviewed.

## 5. Supplement experiment design

### 5.0 Immutable input manifest and unresolved static protocol gate

The future execution freeze creates exactly one immutable
`oracle-lab-phase3a-supplement-input-manifest@1.0` before any cell. It is canonicalized, reviewed,
digested, and then read-only for all generation. It contains, at minimum:

```text
schema_id, schema_major, schema_revision, manifest_id, active_target, platform, architecture,
artifact_refs, cc_gateway_head, cc_gateway_tree, sub2api_head, sub2api_tree,
p2_bundle_sha256, p2_predecessor_sha256, p2_schema_range, merged_plan_sha256,
merged_p2_handoff_sha256, issued_at, expires_at, ttl_policy, trusted_time_source,
namespace, seed, repetitions, balanced_order_digest, state_root_safe_ref,
creation_operation_ref, new_operation_ref, resume_operation_ref,
creation_executable_sha256, resume_executable_sha256, creation_launch_manifest_sha256,
resume_launch_manifest_sha256, creation_cwd_safe_ref, resume_cwd_safe_ref,
creation_argv_class_digest, resume_argv_class_digest,
creation_env_allowlist_digest, resume_env_allowlist_digest, fake_upstream_endpoint_ref,
creator_attribution_rule, reader_attribution_rule, observer_a_binding,
observer_b_binding, schema_registry_digest, input_manifest_digest
```

`issued_at` and `expires_at` come from one trusted time source at freeze time. The fixed TTL
policy, namespace, artifact identity, repository identities, seed, order, endpoint class, and all
operation/config digests are immutable. Generation-time clocks are prohibited; repeated isolated
generation reads the same manifest bytes and must produce the same logical bytes and digests.
Expiry is evaluated only against the separately bound P3B-0 trusted time input.

The exact argv token sequences required by C3 are frozen in a reviewed, execution-only launch
manifest object referenced by `creation_launch_manifest_sha256` and
`resume_launch_manifest_sha256`; the controller may not alter or regenerate them. The durable
safe input manifest stores only those launch-manifest digests and bounded token-class/count
summaries. Raw argv/env tokens are never copied into a durable cell, observer, conclusion, or
closure artifact. If the reviewed launch object is unavailable, the digest cannot be verified, or
any token is not frozen by approved static metadata, the result is `missing_exact_state_protocol`.

The existing safe static anchors are `LaunchManifest` in
`tools/oracle-lab/phase3a/launch-manifest.ts:10-47` (including
`command.executable_sha256`, `command.argv`, `command.cwd`, environment, network, and artifact
identity) and `runCell` at `tools/oracle-lab/phase3a/run-cell.ts:305`. Fresh CodeGraph/static
recon found no approved exact 2.1.215 Darwin arm64 operation, argv token list, state-root
creation operation, or resume-reader operation. The existing `--no-session-persistence` and
`--session-id` references in unrelated native-oracle utilities are not a resume protocol and may
not be promoted into one.

Therefore the plan is explicitly `BLOCKED_STATIC_PROTOCOL`. The smallest missing reconnaissance
is one approved safe static/launch-metadata record from the pinned 2.1.215 Darwin arm64 artifact
that identifies, without raw prompt/session data:

1. the exact target entrypoint and every creation/new/resume argv token in order;
2. the creation and resume operation/symbol or launch route, state-root configuration, cwd, and
   environment allowlist; and
3. the fake-upstream endpoint binding and deterministic creator/reader PID attribution rule.

Until that record is reviewed and its digest is put into the input manifest, no dynamic command is
executable and no positive or negative resume result may be generated. The future controller must
fail with `missing_exact_state_protocol`, never guess a CLI flag, synthesize a state file, or use a
fresh-session fallback as a protocol substitute.

The required manifest-bound protocol, once the missing record exists, is:

```text
creation: pinned target launches with creation_operation_ref and exact creation argv;
          controller creates only an empty isolated root and synthetic input;
          target creates the predecessor state and reaches terminal;
          Observer B records target-attributed state creation metadata.
new-control: pinned target launches with new_operation_ref and no predecessor;
             it must not write or read the creation state root.
resume-positive: pinned target launches with resume_operation_ref and exact resume argv;
                 predecessor safe ref/digest is supplied only through the frozen target protocol;
                 target-attributed reader event and Observer A state-dependent network signal
                 must both bind the same creation state.
negative-control: same protocol with one controlled mutation; expected deny is fixed below.
```

The typed creation-state record is
`oracle-lab-phase3a-supplement-creation-state@1.0` and requires
`record_kind=creation`, `creator_pid_safe_ref`, `creator_process_start_safe_ref`,
`creator_executable_sha256`, `creation_run_id`, `creation_run_digest`, `terminal_state`,
`safe_state_ref`, `state_object_digest`, `state_object_metadata_digest`, `state_root_safe_ref`,
`creation_launch_manifest_sha256`, and `target_attributed_creation_event_digest`. It has no
predecessor field. A resume state record is
`oracle-lab-phase3a-supplement-state@1.0`, requires `record_kind=resume-positive`, the exact
predecessor tuple, `resume_reader_pid_safe_ref`, `resume_reader_process_start_safe_ref`,
`resume_reader_executable_sha256`, `resume_launch_manifest_sha256`, and
`target_attributed_reader_event_digest`. The reader event must bind the creator state ref,
reader process-start identity, target executable digest, operation class, and event digest.
Controller-created files, controller-supplied predecessor digests, an untrusted PID, or a
fresh-session fallback cannot satisfy either proof.

The exact state record field sets are:

```text
creation-state:
schema_id, schema_major, schema_revision, record_kind, creation_run_id,
creator_pid_safe_ref, creator_process_start_safe_ref, creator_executable_sha256,
creation_run_digest, creation_launch_manifest_sha256, terminal_state, safe_state_ref,
state_object_digest, state_object_metadata_digest, state_root_safe_ref,
target_attributed_creation_event_digest, artifact_identity_digest, parent_node_ids,
payload_digest

resume-state:
schema_id, schema_major, schema_revision, record_kind, creation_run_id,
creation_run_digest, predecessor_safe_ref, predecessor_safe_digest,
predecessor_artifact_digest, resume_run_id, resume_run_digest,
resume_reader_pid_safe_ref, resume_reader_process_start_safe_ref,
resume_reader_executable_sha256, resume_launch_manifest_sha256, state_root_safe_ref,
target_attributed_reader_event_digest, observer_a_consumption_digest,
observer_b_consumption_digest, parent_node_ids, payload_digest
```

The exact observer output field set is:

```text
schema_id, schema_major, schema_revision, observer_kind, observer_run_id,
implementation_digest, version_digest, dependency_digest, toolchain_digest, config_digest,
capture_surface, failure_mode, creation_state_digest, reader_event_digest,
state_dependent_signal_digest, operation_class, process_start_safe_ref,
executable_sha256, state_root_safe_ref, request_ast_topology_digest,
sse_grammar_digest, terminal_class, retry_class, parser_agreement, output_digest
```

Observer A requires `state_dependent_signal_digest` and `request_ast_topology_digest`; Observer B
requires `operation_class`, `process_start_safe_ref`, `executable_sha256`, and
`state_root_safe_ref`. Cross-populating fields from the other observer is invalid.

Observer A is also statically blocked until its exact signal anchor is found. Ordinary loopback
HTTP or SSE, a matching session ID, absence of a new request, or a digest injected by the
controller is not sufficient. The smallest missing A-side record must identify a target-generated,
state-dependent, network-visible safe signal, its producer symbol/launch metadata, bounded request
AST location, derivation digest, and how it binds the creation state without controller input.
Without that record the gate is `missing_state_dependent_network_signal` and the resume conclusion
stays Unknown. This is an evidence impossibility gate, not permission to add a second parser.

### 5.1 Pinned sandbox and synthetic state

The future controller must create a new disposable supplement root under the separately approved
P3A evidence location. The exact runtime root is supplied as `P3A_SUPP_ROOT`; durable paths are
the fixed relative paths in Section 9. It must:

- bind wrapper/platform/release/entrypoint/tree digests from Section 3 and re-probe the version
  without accepting a floating tag;
- run only on Darwin arm64 with a loopback-only fake upstream bound to `127.0.0.1` or `::1`;
- set only synthetic placeholder auth values accepted by the existing manifest validator;
- use a synthetic placeholder transcript as target input and an empty isolated state root; the
  pinned target, never the controller, must create the predecessor state. Durable representation
  is a safe state reference plus SHA-256, never bytes or decoded fields;
- allocate a fresh HOME/XDG/TMP/CWD and reject inherited credentials, proxy variables, unsafe
  file descriptors, external sockets, DNS, Unix sockets, and non-loopback destinations;
- destroy disposable state according to the separately approved evidence policy; no raw prompt,
  transcript, session state, CCH, ClientHello, provider TLS content, response body, account,
  token, or proxy credential may enter durable output.

### 5.2 Seeded paired cells

Use `seed=3141592653` and `repetitions=6`. Generate order only through the existing
`balancedPairOrder(seed, 6)`: three `control,treatment` and three `treatment,control` repetitions.
Each repetition has a deterministic cell ID and exactly one control arm plus one treatment arm.
The convergence analyzer is reused with `min=5`, `max=12`; six is the planned minimum completed
campaign, while any unresolved leaf continues to a maximum of twelve and then becomes
`MAX_UNRESOLVED`/disabled.

Every repetition has a dedicated creation run first only for the resume-positive and its paired
negative arms. The exact safe IDs are:

```text
creation: p3as-215-sNN-rNN-a00-create
new:      p3as-215-sNN-rNN-a01-new
resume:   p3as-215-sNN-rNN-a02-resume
negative: p3as-215-sNN-rNN-a03-neg-<case>
```

The treatment row must bind `creation_run_id`, `creation_run_digest`,
`prior_state_safe_ref`, `prior_state_safe_digest`, `prior_state_artifact_digest`,
`resume_run_id`, `resume_run_digest`, and the seed/order/repetition. The creation row is terminal
before treatment launch. The treatment may claim prior-state consumption only if both observers
independently bind the same creation digest and the treatment run is not a new-session fallback.

Every dynamic negative uses `seed=3141592653`, the exact six-position
`balancedPairOrder(seed, 6)`, and six repetitions. It is evaluated for stable denial, not passed to
positive convergence; parser/schema mutations are counted separately. The exact matrix is:

| cell family | arm ID / run suffix | expected stable deny code | side-effect expectation | positive convergence |
| --- | --- | --- | --- | --- |
| `new-session-control` | `a01-new` | `new_control_no_predecessor` | target may create only its own fresh state; no predecessor read; no resume claim | paired control only |
| `resume-candidate` | `a02-resume` | none; requires `Reproduced` | target-created predecessor read by target; no controller state write | yes |
| `missing-predecessor` | `a03-neg-missing-predecessor` | `missing_predecessor` | deny before resume launch; no state read/write; no positive output | no |
| `tampered-predecessor` | `a03-neg-tampered-predecessor` | `predecessor_digest_mismatch` | target read denied or classified mismatch; no state write; no positive output | no |
| `swapped-predecessor` | `a03-neg-swapped-predecessor` | `predecessor_cell_mismatch` | target read denied; no access to another cell's state; no positive output | no |
| `wrong-run-binding` | `a03-neg-wrong-run-binding` | `run_binding_mismatch` | deny before positive classification; no state write; no positive output | no |
| `fresh-session-fallback` | `a03-neg-fresh-session-fallback` | `fresh_session_fallback` | fresh target session only; no predecessor read; no positive output | no |
| `nonterminal-creation` | `a03-neg-nonterminal-creation` | `predecessor_nonterminal` | predecessor rejected; no resume reader event; no state write | no |
| `observer-disagreement` | `a03-neg-observer-disagreement` | `observer_disagreement` | both observer results retained as bounded digests only; no conclusion | no |
| `instrumentation-perturbation` | `a03-neg-instrumentation-perturbation` | `instrumentation_perturbation` | instrumented result not selected; no positive output | no |

For every row, `arm_id` is `P3AS-215-SNN-RNN-<suffix>`, `run_id` is
`p3as-215-sNN-rNN-aNN-<suffix>`, and `NN` is zero-padded decimal. Each repetition must emit the
same deny code and side-effect class. One mismatch is `Unknown` and disables the entire supplement.
The `new-session-control` is not evidence of resume consumption; it only proves the negative
control is a distinct new operation. A negative must never enter `analyzeConvergence`'s positive
leaf set.

The negative corpus is not optional. A positive result inferred from the absence of a new
session request, from a matching session ID alone, or from a fallback path fails the run.

### 5.3 Two independent observers

Independence is an implementation property, not a label. The observers must have distinct capture
surfaces, executables, dependency graphs, configurations, and failure modes:

**Observer A: target-generated state-dependent network observer.** The existing fake-upstream
`requestFacts`/`jsonTopology` surface is only a transport/topology observer and is insufficient
for consumption proof. A supplement A adapter may be admitted only after the missing static
signal-anchor record in Section 5.0 is found. It must capture a target-generated,
state-dependent, network-visible safe signal and bind its bounded request-AST location and
derivation digest to the creation state. It may additionally emit method/path class, header
name/value classes, SSE event grammar, terminal class, retry class, and bounded response class,
but it must not accept a predecessor digest, session ref, or proof value from the controller.
Failure modes are signal absent, signal not state-dependent, fake-upstream-only observation,
controller injection, topology disagreement, and parser disagreement. Any one is Unknown.

**Observer B: Darwin state-access/process observer.** Build a separate supervisor executable with
its own source, executable/version/dependency/toolchain digest, config digest, and write-only
result pipe. It observes the dedicated state root and target child lineage through a Darwin
filesystem/process surface (the approved no-root `fs_usage`/process-sampling capability, or an
independently reviewed equivalent). It records only typed operation classes such as `open`,
`stat`, `read`, `close`, target-attributed parent/current safe refs, creator/reader process-start
safe refs, executable digest, state-root safe ref, and event digest. It never parses HTTP, JSON,
SSE, prompts, bodies, or Observer A output. Failure modes are missed open/read, wrong PID or
process-start attribution, wrong executable digest, out-of-root access, unavailable no-root
capability, and observer-side perturbation.

The future preflight must prove that Observer B can classify a synthetic sentinel open/read and
that it does not require root. If that capability is unavailable, the supplement is BLOCKED; no
same-byte second parser or privileged workaround is allowed. Agreement is performed only by a
third terminal builder after both observers exit. It compares safe topology/lineage facts and
creation/resume digests, not raw observations.

For perturbation, run each positive cell once with no observer instrumentation and once with the
approved observers attached. The treatment outcome, bounded network topology, terminal class,
and state-consumption classification must remain equivalent. A network-only observer control,
filesystem/process-only observer control, missing-signal control, controller-supplied-proof
control, wrong-reader-PID control, and observer-disagreement control are separate negatives. Any
perturbation, missing observer output, parser disagreement, shared raw-byte source, or observer
crash is `Unknown` and disables the row. Agreement is never obtained by running two parsers over
the same captured bytes.

## 6. Safe schemas and field allowlist

All JSON is strict I-JSON, duplicate-key rejected, RFC 8785 JCS canonicalized, UTF-8 validated,
and written with a final LF. Object schemas use `additionalProperties:false`; schema validators
must reject unknown fields before semantic validation. Durable artifacts have no generation-time
clock field; issue/expiry values are bound input fields. Arrays are either explicitly ordered
sequences or sorted sets.

All new supplement schemas use exactly `oracle-lab-phase3a-supplement-<kind>@1.0`, where the
literal `@` separates `schema_id` from decimal `schema_major.schema_revision`. The manifest,
state records, observer outputs, cell records, conclusions, index, leak, terminal, exit, handoff,
and digest-set tables use this grammar and the same `schema_id`, `schema_major`, and
`schema_revision` fields. Immutable v13/P2 inputs retain their already-authoritative legacy
`schema_version` strings and are never rewritten as supplement schemas.

Safe refs use exactly
`sr1:<kind>:sha256:<64 lowercase hexadecimal characters>` and no other syntax. `<kind>` is one
of `root`, `session`, `task`, `state`, `process`, `path`, `payload`, or `artifact`; the maximum
encoded length is 84 bytes. The digest preimage is domain-separated
`oracle-lab/p3a-s/safe-ref/v1/<kind>\0<JCS(value)>`, computed in memory. Raw values, absolute
paths, PIDs, hostnames, and identifiers are never stored in the ref. Unknown kind, uppercase or
short digest, wrong domain, oversize value, collision, or digest mismatch is a stable
`invalid_safe_ref` deny. Run IDs are the separate bounded grammar
`p3as-215-sNN-rNN-aNN-(create|new|resume|neg-[a-z0-9-]+)`; they contain no user/provider
identifier and are validated before binding.

The manifest maximum is 32 KiB, state/cell records 64 KiB each, each observer output 16 KiB,
each normalized conclusion 64 KiB, and each closure artifact 256 KiB. Canonical bytes are
UTF-8 JCS with one final LF; the SHA-256 is over the exact canonical bytes including LF. Required
ordered arrays retain order; set-like arrays are lexicographically sorted. Duplicate keys,
unknown keys, missing keys, wrong discriminator, wrong scalar type, non-canonical bytes, extra
array members, and size overflow fail before semantic checks. Every digest field excludes the
field being computed and is bound by the input manifest or an already-emitted DAG node.

### 6.1 Allowed safe field families

The exhaustive durable allowlist is:

- `root_safe_ref`, `session_safe_ref`, `task_safe_ref`, `parent_safe_ref`, `current_safe_ref`;
- `parent_current_relation` and bounded `lineage_class`;
- `creation_run_id`, `creation_run_digest`, `resume_run_id`, `resume_run_digest`,
  `repetition`, `seed`, `arm`, and predecessor safe refs/digests;
- active target `2.1.215`, Darwin/arm64, pinned artifact IDs and SHA-256 refs;
- `client_generation`, `profile_generation`, `request_class`;
- header name set and header value classes only, never values;
- request method/path class, bounded request AST topology, and topology digest;
- bounded SSE grammar: ordered event-name class, data-shape class, start/stop/terminal class;
- bounded `terminal_class`, `retry_class`, `response_class`, and `error_class`;
- local process lineage safe refs, executable digest refs, and bounded filesystem operation class;
- observer implementation/config/dependency/toolchain digests;
- schema IDs/revisions, evidence levels, conclusion IDs, path refs, SHA-256 digests, expiry,
  contradiction IDs, parser agreement, and bounded deny codes.

The following are forbidden in every cell, observer, closure, test fixture, command output, and
durable artifact: raw prompt, raw transcript, raw session state, raw request/response body,
credential/token/account/proxy value or identifier, CCH, ClientHello, provider TLS contents,
absolute ephemeral path, hostname/domain value, raw process argv/env, or raw upstream output.
The leak guard must fail on both field names and canary values.

### 6.2 Exact logical records

`oracle-lab-phase3a-supplement-cell-run@1.0` contains exactly:

```text
schema_id, schema_major, schema_revision, record_kind, cell_id, run_id, arm,
seed, repetition, order_position, active_target, platform, architecture,
artifact_refs, creation_run_id, creation_run_digest, predecessor_safe_ref,
predecessor_safe_digest, predecessor_artifact_digest, resume_run_id, resume_run_digest,
observer_a_ref, observer_a_sha256, observer_b_ref, observer_b_sha256,
safe_result_digest, topology_digest, lineage_class, terminal_class, retry_class,
perturbation_class, evidence_level, parser_agreement, deny_code, payload_digest,
parent_node_ids
```

The strict discriminator is `record_kind` with exactly these variants:

| record kind | required discriminator fields | forbidden/required relation |
| --- | --- | --- |
| `creation` | `creation_run_id`, creator identity, terminal state, state ref/object digests | no predecessor; target-created proof required |
| `new-control` | no predecessor; new operation binding; `control_kind=new-session-control` | no state read/write event; no resume conclusion |
| `resume-positive` | exact predecessor tuple, resume reader identity, both consumption proofs | only this variant can support a positive resume leaf |
| `negative-control` | `control_kind`, `expected_deny_code`, mutation binding, side-effect expectation | `phase3b_usable=false`; never enters positive convergence |

`creation_run_id` and predecessor fields are null only for `new-control` and `creation`. A
`resume-positive` record requires non-null exact predecessor state/run/artifact digests and both
independent consumption proofs. Missing, swapped, or wrong-run values are typed negative-control
records with an explicit deny code, not omitted permissions.

`oracle-lab-phase3a-supplement-creation-state@1.0` and
`oracle-lab-phase3a-supplement-state@1.0` use the exact required fields from Section 5.0 and
allow only the safe field families in this section. `oracle-lab-phase3a-supplement-observer-a@1.0`
requires `observer_kind=network-state-signal`, `implementation_digest`, `version_digest`,
`dependency_digest`, `config_digest`, `capture_surface`, `failure_mode`, `signal_anchor_digest`,
`creation_state_digest`, `reader_event_digest`, `topology_digest`, `parser_agreement`, and
`output_digest`. Observer B uses `observer_kind=darwin-state-process`, the same identity fields,
and typed filesystem/process event classes; it must not contain A fields or any raw event bytes.

The cell/run record below includes the union of these typed bindings but its discriminator selects
one variant. The validator rejects an observer output from the controller, a shared raw-byte
source, a missing implementation/config/dependency digest, or an observer output whose root is
outside the manifest namespace.

`oracle-lab-phase3a-supplement-conclusion@1.0` contains exactly:

```text
schema_id, schema_major, schema_revision, conclusion_kind, conclusion_id, phase3b_usable, level, scope,
active_target, platform, architecture, statement, supporting_leaf_digests,
observer_a_digests, observer_b_digests, convergence_digests, predecessor_conclusion_digest,
artifact_identity_digest, issued_at, expires_at, contradiction_ids, parser_agreement,
negative_capability_refs, source_relative_paths, conclusion_digest, parent_node_ids
```

Only `level=Reproduced`, `phase3b_usable=true`, exact observer agreement, six-or-more converged
repetitions, no unresolved/variable lineage leaves, no contradiction, and exact artifact identity
may produce the positive resume row. `Observed-local`, `Unknown`, and `Negative` always set
`phase3b_usable=false`.

## 7. Revalidation and expiry

Before any resume candidate is considered, independently revalidate the two v13 usable families
against the same pinned 2.1.215 Darwin arm64 artifact:

- `CL-P3A-R2-CONFIG-AUTH` uses the existing config/auth campaign primitives, synthetic auth only,
  six balanced repetitions, and both observers where the request topology is relevant.
- `CL-P3A-R2-FAILURE-STREAM` uses the existing fake-upstream JSON/SSE/failure scenarios, six
  balanced repetitions, bounded reset/partial/terminal/retry classes, and no response bytes.

Each emits an append-only successor with schema
`oracle-lab-phase3a-supplement-conclusion@1.0` and `conclusion_kind=revalidated`, a new conclusion ID
(`CL-P3A-SUPP-R2-CONFIG-AUTH` and `CL-P3A-SUPP-R2-FAILURE-STREAM`), new issue/expiry fields,
the exact v13 predecessor conclusion digest, selected leaf digests, and a safe projection only.
The successor may narrow a claim, never expand or rewrite v13.

Selection is exact, not newest-by-time:

1. v13 remains the historical baseline and contradiction source.
2. A successor is eligible only if its exact path is under `capsules/P3A-S`, non-symlink, schema
   valid, digest-valid, unexpired at P3B-0 from the frozen manifest, exact active artifact
   identity, exact predecessor digest, no open contradiction, and index/leak/exit/handoff/
   terminal bindings agree.
3. Exactly one eligible successor per conclusion family is required. Missing, expired, drifted,
   contradicted, parser-disagreeing, swapped, or duplicate eligible successors fail closed.
4. v13 is never overwritten. A generation-time clock, digest mismatch, version relabel, or
   precedence ambiguity keeps both the original family and Phase 3B disabled. Expired, drifted,
   contradicted, parser-disagreeing, or duplicate successors fail closed.

## 8. Append-only artifact DAG

The merged Phase 3B plan's `supplement-closure-dag` JSON block at lines 284-339 is the sole
authority. The supplement must copy it byte-for-byte semantically: edge direction is
`node -> depends_on`, and generation order is exactly
`artifact_index -> leak_report -> exit_report -> handoff -> terminal_manifest -> external_digest_set`.
There is no `terminal_manifest -> exit_report` or `terminal_manifest -> handoff` edge. A real
parser canonicalizes the authority block and this plan's block and requires exact structured
equality before running Kahn topological sort.

```json supplement-closure-dag
{
  "nodes": [
    {"id":"pinned_inputs","stage":0},
    {"id":"predecessor_safe_state","stage":0},
    {"id":"observer_a_output","stage":1},
    {"id":"observer_b_output","stage":1},
    {"id":"leaf_cell_run_records","stage":2},
    {"id":"normalized_safe_conclusions","stage":3},
    {"id":"artifact_index","stage":4},
    {"id":"leak_report","stage":5},
    {"id":"exit_report","stage":6},
    {"id":"handoff","stage":7},
    {"id":"terminal_manifest","stage":8},
    {"id":"external_digest_set","stage":9}
  ],
  "edges": [
    {"node":"observer_a_output","depends_on":"pinned_inputs"},
    {"node":"observer_b_output","depends_on":"pinned_inputs"},
    {"node":"observer_b_output","depends_on":"predecessor_safe_state"},
    {"node":"leaf_cell_run_records","depends_on":"pinned_inputs"},
    {"node":"leaf_cell_run_records","depends_on":"predecessor_safe_state"},
    {"node":"leaf_cell_run_records","depends_on":"observer_a_output"},
    {"node":"leaf_cell_run_records","depends_on":"observer_b_output"},
    {"node":"normalized_safe_conclusions","depends_on":"leaf_cell_run_records"},
    {"node":"artifact_index","depends_on":"normalized_safe_conclusions"},
    {"node":"leak_report","depends_on":"artifact_index"},
    {"node":"exit_report","depends_on":"artifact_index"},
    {"node":"exit_report","depends_on":"leak_report"},
    {"node":"handoff","depends_on":"artifact_index"},
    {"node":"handoff","depends_on":"leak_report"},
    {"node":"handoff","depends_on":"exit_report"},
    {"node":"terminal_manifest","depends_on":"artifact_index"},
    {"node":"terminal_manifest","depends_on":"leak_report"},
    {"node":"terminal_manifest","depends_on":"exit_report"},
    {"node":"terminal_manifest","depends_on":"handoff"},
    {"node":"external_digest_set","depends_on":"artifact_index"},
    {"node":"external_digest_set","depends_on":"leak_report"},
    {"node":"external_digest_set","depends_on":"exit_report"},
    {"node":"external_digest_set","depends_on":"handoff"},
    {"node":"external_digest_set","depends_on":"terminal_manifest"}
  ],
  "closure_order":["artifact_index","leak_report","exit_report","handoff","terminal_manifest"],
  "index_scope":{
    "includes":["pinned_inputs","predecessor_safe_state","observer_a_output","observer_b_output","leaf_cell_run_records","normalized_safe_conclusions"],
    "excludes":["artifact_index","leak_report","exit_report","handoff","terminal_manifest","external_digest_set"]
  }
}
```

The authority equality/compatibility gate is a future focused test and command, not a dynamic
execution in this plan task:

```text
parse authority JSON block and local JSON block
canonicalize object keys and arrays without reordering semantic edge lists
assert deep-equal(nodes, edges, closure_order, index_scope)
assert Kahn(local_graph) == [pinned_inputs, predecessor_safe_state, observer_a_output,
  observer_b_output, leaf_cell_run_records, normalized_safe_conclusions, artifact_index,
  leak_report, exit_report, handoff, terminal_manifest, external_digest_set]
assert closure_order == artifact_index, leak_report, exit_report, handoff, terminal_manifest
```

The RED corpus includes self-loop, two-node cycle, reverse edge, swapped stage/order, missing
explicit edge, authority drift, orphan dependency, duplicate node ID, missing stage, and later
closure hash inserted into index. Equality failure or Kahn failure is `BLOCKED`; no locally
invented DAG is accepted.

Required edges are copied exactly above. The five closure files do not reference the external
digest set. The index excludes itself and every later closure artifact, avoiding a hash cycle.

## 9. Exact future output paths and bindings

The handoff dirname defines the one and only consumer root:
`handoff_dirname = capsules/P3A-S` and `P3A_SUPP_ROOT = realpath(dirname(handoff_path))`.
Every successor conclusion and every closure artifact is below that root. No root-external
normalized path is valid, and no absolute ephemeral path is written inside an artifact.

| output | exact relative path | schema ID |
| --- | --- | --- |
| immutable supplement input manifest | `capsules/P3A-S/input-manifest.json` | `oracle-lab-phase3a-supplement-input-manifest@1.0` |
| cell/run records | `capsules/P3A-S/cells/<cell_id>/run-record.json` | `oracle-lab-phase3a-supplement-cell-run@1.0` |
| revalidated CONFIG-AUTH | `capsules/P3A-S/normalized/conclusions/CL-P3A-SUPP-R2-CONFIG-AUTH.json` | `oracle-lab-phase3a-supplement-conclusion@1.0` |
| revalidated FAILURE-STREAM | `capsules/P3A-S/normalized/conclusions/CL-P3A-SUPP-R2-FAILURE-STREAM.json` | `oracle-lab-phase3a-supplement-conclusion@1.0` |
| resume conclusion | `capsules/P3A-S/normalized/conclusions/CL-P3A-SUPP-RESUME-LINEAGE.json` | `oracle-lab-phase3a-supplement-conclusion@1.0` |
| bounded payload index | `capsules/P3A-S/artifact-index-v1.json` | `oracle-lab-phase3a-supplement-artifact-index@1.0` |
| leak report | `capsules/P3A-S/leak-scan-v1.json` | `oracle-lab-phase3a-supplement-leak-scan@1.0` |
| terminal manifest | `capsules/P3A-S/closure-terminal-manifest-v1.json` | `oracle-lab-phase3a-supplement-terminal@1.0` |
| exit report | `capsules/P3A-S/phase-3a-supplement-exit-v1.json` | `oracle-lab-phase3a-supplement-exit@1.0` |
| Phase 3B handoff | `capsules/P3A-S/phase-3b-supplement-handoff-v1.json` | `oracle-lab-phase3a-supplement-handoff@1.0` |
| external five-piece digest set | `capsules/P3A-S/closure-digest-set-v1.json` | `oracle-lab-phase3a-supplement-digest-set@1.0` |

Every future Phase 3B compiler input is an explicit tuple of `{relative_path, sha256, schema_id,
schema_major, schema_revision}` for each required file. The compiler must receive all five closure
paths/digests/schemas plus both revalidated conclusions and the resume conclusion; it may not walk
the directory or discover a newest file.

The P3B-compatible binding helper is copied from the merged authority and must be used for every
successor and closure path:

```bash
verify_safe_binding() {
  path="$1"; expected_sha="$2"; expected_schema="$3"; expected_root="$4"
  test -f "$path" && test ! -L "$path"
  test "$(node --input-type=module -e '
    import fs from "node:fs"; import path from "node:path";
    const file=fs.realpathSync(process.argv[1]); const root=fs.realpathSync(process.argv[2]);
    process.stdout.write(String(file.startsWith(root + path.sep)));
  ' "$path" "$expected_root")" = true
  test "$(shasum -a 256 "$path" | awk '{print $1}')" = "$expected_sha"
  test "$(node --input-type=module -e '
    import fs from "node:fs";
    const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    process.stdout.write(value.schema_version ??
      `${value.schema_id}@${value.schema_major}.${value.schema_revision}`);
  ' "$path")" = "$expected_schema"
}
P3A_SUPP_ROOT="$(dirname "$P3A_SUPP_HANDOFF")"
verify_safe_binding "$P3A_SUPP_HANDOFF" "$P3A_SUPP_HANDOFF_SHA256" \
  "$P3A_SUPP_HANDOFF_SCHEMA" "$P3A_SUPP_ROOT"
verify_safe_binding "$P3A_REVALIDATED_CONFIG_AUTH" "$P3A_REVALIDATED_CONFIG_AUTH_SHA256" \
  "$P3A_REVALIDATED_CONFIG_AUTH_SCHEMA" "$P3A_SUPP_ROOT"
verify_safe_binding "$P3A_REVALIDATED_FAILURE_STREAM" "$P3A_REVALIDATED_FAILURE_STREAM_SHA256" \
  "$P3A_REVALIDATED_FAILURE_STREAM_SCHEMA" "$P3A_SUPP_ROOT"
```

The same helper is required for the index, leak, exit, terminal, and digest-set paths, with the
five-piece `external_digest_set` bound last. RED mutations are an out-of-root successor, `..`
escape, symlink, hard-link/swap, handoff dirname mismatch, relative-path spelling mismatch,
SHA-256 mismatch, schema identity mismatch, and a path that is lexically under but realpath
outside the root. All deny before compiler selection.

## 10. Future implementation work packages

The following are implementation tasks for a later, separately approved P3A-S controller, not
work performed by this plan PR.

1. **P3AS-0 freeze and RED first:** freeze repositories, artifact identity, toolchain, exclusion,
   root policy, placeholder policy, capability matrix, and the reviewed exact creation/resume
   protocol. If the static protocol or Observer A state-dependent signal anchor is missing, emit
   the named BLOCKED result and stop; do not guess flags or add a mechanism.
2. **P3AS-1 schema/codec:** add the immutable input manifest, strict discriminator schemas,
   duplicate-key/JCS codec, safe-ref grammar, safe-field scanner, root/path validator, typed
   record writer, and deterministic digest helpers.
3. **P3AS-2 observers:** implement Observer A only from its reviewed target-generated signal anchor
   and independent Darwin Observer B. Add implementation/config/dependency digests and no-root
   capability preflight. No observer shares a parser, capture library, raw-byte source, result
   file, or normalized byte stream with the other.
4. **P3AS-3 cells:** add creation/new/resume paired runner using the existing manifest guard,
   fake upstream, process sampler, and bounded fixture. Add all negative controls and perturbation.
5. **P3AS-4 revalidation/convergence:** call existing c4 order/convergence semantics with the
   fixed seed, generate both successor families and resume conclusion only on `Reproduced`.
6. **P3AS-5 closure:** add authority JSON equality gate, Kahn topological sorter, bounded index,
   leak report, exit, handoff, terminal, external digest set, `verify_safe_binding`, and exact
   single-root path/digest/schema binding.
7. **P3AS-6 focused gates:** run only named P3A-S tests and explicit P2 file lists. Run one
   consolidated independent review after all RED/GREEN and mutation gates; no per-cell review loop.

## 11. Mutation corpus and focused commands

### 11.1 Mandatory RED corpus

Tests must cover malformed JSON, duplicate key, unknown/missing/extra field, invalid digest,
absolute path, `..` traversal, symlink, out-of-root path, schema revision drift, wrong target
version, wrong platform/architecture, v13/successor predecessor mismatch, expired successor,
duplicate eligible successor, open contradiction, parser disagreement, missing observer, stale
observer digest, missing predecessor, tampered predecessor, swapped predecessor, wrong run,
fresh-session fallback, nonterminal creation, missing terminal, out-of-order event, malformed
SSE, changed topology, changed header class, retry/terminal disagreement, unclassified
perturbation, raw-material canaries, invalid safe-ref kind, uppercase/short safe-ref digest,
wrong safe-ref domain, oversize safe-ref value, safe-ref collision, and immutable-manifest
generation-time clock mutation.

DAG RED mutations are mandatory and explicit: self-loop, two-node cycle, reverse edge, swapped
stage/order, missing explicit edge, authority drift, orphan dependency, duplicate node ID, missing
stage, and later-closure hash inserted into the bounded index. Path RED mutations are separate:
cross-root successor, `..` escape, symlink, hard-link/swap, handoff dirname mismatch, lexical
containment with realpath escape, and swapped fixed artifact. Parser/schema mutations and dynamic
controls have separate counts and reports; neither count is silently folded into positive
convergence.

Command-chain mutations must deny before child execution for missing/wrong config, wrong config
digest, wrong root, unsupported operation, dangerous Git environment, wrong head/tree/remote,
tracked dirt, protected CodeGraph count nonzero, protected path in the file list, forbidden
package-wide test command, implicit child runner, missing fixed artifact, swapped fixed artifact,
schema mismatch, path escape, symlink, digest mismatch, expiry, and closure binding mismatch.

### 11.2 Future command ladder

These commands are future P3A-S commands and were not run in this planning task:

```bash
npm exec tsx tests/oracle-phase3a-resume-supplement.test.ts
npm exec tsx tests/oracle-phase3a-input-manifest.test.ts
npm exec tsx tests/oracle-phase3a-p2-binding.test.ts
npm exec tsx tests/oracle-phase3a-usable-revalidation.test.ts
npm exec tsx tests/oracle-phase3a-prior-state-controls.test.ts
npm exec tsx tests/oracle-phase3a-observer-independence.test.ts
npm exec tsx tests/oracle-phase3a-closure-dag.test.ts
npm exec tsx tests/oracle-phase3a-closure-dag-compatibility.test.ts
npm exec tsx tests/oracle-phase3a-convergence.test.ts
npm exec tsx tests/oracle-phase3a-supplement-terminal.test.ts
npm exec tsx tests/oracle-phase3a-supplement-leak-guard.test.ts
```

P2 regression commands remain explicit and narrow: the existing CC TypeScript canonical,
admission, authority, and cross-project tests, plus the existing Sub2API Go contract file list
and named test regex from the merged Phase 3B plan. Never substitute a package-wide runner.

## 12. Acceptance, stop, and resource rules

The supplement is GREEN only if all of the following hold:

1. Fresh repository heads/trees, clean state, CodeGraph stats, canonical exclusion digest, and
   protected count zero are asserted in the command result.
2. The immutable input manifest is canonical, reviewed, digest-bound, unexpired by its trusted
   time input, and has exact creation/new/resume argv and state protocol metadata. Missing static
   protocol or missing Observer A state-dependent signal is `BLOCKED_STATIC_PROTOCOL`/
   `BLOCKED_NETWORK_SIGNAL`, never a best-effort run.
3. The pinned 2.1.215 identity and all five v13 path/SHA/schema bindings match exactly.
4. Both v13 usable families have one exact append-only unexpired successor with the v13
   predecessor digest; no successor ambiguity or contradiction exists.
5. Creation, new-session, and resume cells converge with six repetitions and both order
   directions; all mandatory negative controls deny or remain Unknown.
6. Observer A and B independently demonstrate prior-state consumption and agree on safe topology,
   lineage, run IDs, and digests. Observer perturbation is equivalent.
7. Only safe typed fields are present; generated-only leak scan is PASS with zero findings.
8. The local DAG JSON is structured-equal to the merged Phase 3B authority block, Kahn accepts the
   valid graph, and every RED DAG mutation is rejected.
9. The five closure artifacts and external digest set are byte-deterministic across two isolated
   roots and have identical logical digests.
10. Only `Reproduced` can enable `phase3b_usable=true`; all Unknown/Observed-local/Negative rows
   remain disabled.
11. One consolidated independent review finds zero Critical and zero Important issues.

Stop immediately and publish the exact deny code/input digest on: missing evidence capability,
Observer B unavailable, observer dependence/disagreement, nonconvergence, instrumentation
perturbation, artifact identity drift, digest/schema mismatch, raw leak, protected-boundary
violation, missing exact state protocol, missing state-dependent network signal, external socket
attempt, or resource exhaustion. Ordinary test defects receive one
bounded root-cause/fix wave. Do not expand mechanisms or create an endless review loop.

Resource limits: one Darwin arm64 artifact, one disposable root per isolated generation, six
repetitions initially and at most twelve, no more than 4 hours of active supplement execution,
8 GiB scratch, 64 files per cell, 4 processes per cell, 0 external sockets, and no privileged
observer. Exceeding a limit is a fail-closed block, not a request to loosen it.

## 13. Requirement traceability

Every row below must point to a future file/schema/test/command/output and an acceptance
condition. The IDs are inherited from the merged Phase 3B plan/spec registry; the P3A negative
IDs preserve the current capability ceiling.

| requirement | future file/schema/test/command/output | acceptance condition |
| --- | --- | --- |
| `RA-P0-001` | supplement compiler input binding; `oracle-phase3a-closure-dag.test.ts`; closure digest set | two isolated generations produce identical canonical bytes/digests |
| `RA-P0-002` | `CL-P3A-SUPP-RESUME-LINEAGE` conclusion; supplement exit; resume supplement test | positive resume row is Reproduced; negative-only/Unknown cannot exit usable |
| `RA-P0-007` | safe cell/run schema; Observer A payload; failure-stream successor | only bounded request/SSE/terminal/retry classifications are emitted |
| `RA-P0-009` | terminal, handoff, command-chain test | production, canary, real upstream, credentials, and protected runtime are explicit denies |
| `RA-P1-001` | pinned artifact refs; artifact identity test; version mutation corpus | exact 2.1.215 Darwin arm64 identity; 2.1.207 relabel fails |
| `RA-P1-002` | conclusion provenance and closure DAG | artifact, request, response, auth, and lineage facts resolve to one coherent tuple |
| `RA-P1-003` | safe-field scanner; leak report; leak-guard test | no raw prompt/body/session/CCH/TLS/credential/identifier field survives |
| `RA-P1-004` | cell/run schema; prior-state controls; resume conclusion | creation digest and predecessor relation are consumed and independently corroborated |
| `RA-P1-008` | negative-capability refs in successor and handoff | telemetry/update/compact/cache/platform/TLS Unknown rows remain disabled |
| `HA-P0-003` | per-field provenance in conclusion and revalidated successor | no generated field exceeds its source evidence level |
| `HA-P0-004` | input manifest P2/v13/merged-plan/handoff bindings; `oracle-phase3a-input-manifest.test.ts`; preflight output | registry precedence and fresh-baseline facts are exact, reviewed, and digest-bound |
| `HA-P0-006` | P2 authority section; input manifest schema; `oracle-phase3a-p2-binding.test.ts`; command result | bundle `254511...`, predecessor `70c26d...`, and schema range `1:0-0` match exactly |
| `HA-P1-001` | observer independence test and implementation/config digests | distinct capture surfaces, dependencies, result channels, and failure modes are proven |
| `HA-P1-002` | convergence output and `oracle-phase3a-convergence.test.ts` | six repetitions, balanced order, stable leaves, no unresolved lineage leaf |
| `HA-P1-003` | bounded error/deny codes; mutation tests; leak report | malformed, missing, contradictory, and unsafe input fails closed with stable code |
| `RA-P0-005` | supplement input manifest P2 binding; successor/handoff schema; `oracle-phase3a-p2-binding.test.ts` | P2 vocabulary, digest, predecessor, and `1:0-0` range are preserved without in-place P2 mutation |
| `RA-P1-007` | readiness/lineage conclusion fields; `oracle-phase3a-resume-supplement.test.ts`; handoff output | lifecycle readiness is a safe evidence output only; no endpoint, scheduler, or runtime wiring is added |
| `HA-P0-001` | baseline command result and input binding | current heads/trees and safe inputs are explicit and digest-bound |
| `HA-P0-002` | plan/exit gate and fixed output table | no unbounded authority or implementation is inferred from planning text |
| `HA-P0-007` | safe observer records and bounded response fixtures | only typed safe summaries persist |
| `HA-P0-009` | command-chain RED corpus and terminal manifest | forbidden package-wide runners and protected path are denied before execution |
| `CL-P3A-R2-CONFIG-AUTH` | `CL-P3A-SUPP-R2-CONFIG-AUTH` successor; usable-revalidation test | exact v13 predecessor, same pinned artifact, unexpired Reproduced successor |
| `CL-P3A-R2-FAILURE-STREAM` | `CL-P3A-SUPP-R2-FAILURE-STREAM` successor; usable-revalidation test | bounded failure/SSE result independently revalidated and selected |
| `CL-P3A-RESUME-LINEAGE-UNKNOWN` | negative fixture and precedence mutation | old Unknown is never promoted or inferred away; only new supplement row can supersede capability |
| `CL-P3A-COMPACT-CACHE-UNKNOWN` | negative-capabilities manifest and handoff | compact/cache remains disabled |
| `CL-P3A-TELEMETRY-UPDATE-UNKNOWN` | negative-capabilities manifest and handoff | positive telemetry/update remains disabled |
| `CL-P3A-TLS-RUNTIME-UNKNOWN` | negative-capabilities manifest and handoff | provider TLS equivalence remains disabled |
| `CL-P3A-CROSS-PLATFORM-UNKNOWN` | artifact scope and platform mutation | Darwin arm64 evidence cannot enable Linux/Windows |
| `AV-B4-001`, `AV-B5-001`, `AV-B6-001` | terminal negative manifest and command gate | direct egress, sidecar authority/replay, and destination runtime remain deferred |

## 14. Handoff and next action

The future supplement handoff must include exact repository heads/trees, CodeGraph statistics and
exclusion proof, P2 bundle/predecessor/range and merged-plan/handoff identities, immutable input
manifest path/digest/schema/expiry, pinned artifact refs, v13 five-piece bindings, both revalidated
successor bindings, resume conclusion digest/schema/level/expiry, cell/run/convergence summaries,
observer implementation/config/dependency/signal-anchor digests, exact creation/resume protocol
metadata or the named BLOCKED missing-capability record, DAG equality/topological result, leak
result, terminal/exit/handoff/external digest-set bindings, mutation results, deterministic
regeneration comparison, negative-capability list, resource usage, and changed-file inventory.

The next action after this plan PR is a fresh independent plan review. Only after zero Critical,
zero Important findings and plan merge may a separately approved P3A-S execution controller run.
Only after the supplement is complete, independently reviewed, and selected by exact path/digest/
schema may Phase 3B create a new execution controller. No dynamic supplement or Phase 3B
implementation ran for this plan.

## 15. Planning self-checks

Run only document/static checks in this plan task:

```bash
export PLAN=docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3a-resume-supplement.md
test -s "$PLAN"
! rg -n 'T[O]DO|T[B]D|FIXM[E]|@lates[t]' "$PLAN"
rg -n 'BLOCKED|CL-P3A-SUPP-RESUME-LINEAGE|phase3b_usable|RA-P0-001|RA-P1-004|HA-P1-001|HA-P1-002|HA-P1-003' "$PLAN"
rg -q 'openai_compact_sse_keepalive_test.go' "$PLAN"
rg -q 'self-loop.*two-node cycle|two-node cycle.*reverse edge|swapped.*generation' "$PLAN"
rg -q 'missing explicit edge|authority drift|cross-root successor|hard-link/swap|realpath escape' "$PLAN"
rg -q 'BLOCKED_STATIC_PROTOCOL|missing_state_dependent_network_signal|assert_git_freeze|verify_safe_binding' "$PLAN"
rg -q '2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce' "$PLAN"
rg -q '70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1|schema range.*1:0-0' "$PLAN"
! rg -n 'normalized/[P]3A-S' "$PLAN"
rg -q 'P3A_SUPP_ROOT|closure-digest-set-v1.json|oracle-lab-phase3a-supplement-handoff@1.0' "$PLAN"
node --input-type=module <<'NODE'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const plan = fs.readFileSync(process.env.PLAN, 'utf8')
const authority = fs.readFileSync('docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3b-profile-synthesis.md', 'utf8')
const extract = (value, pattern) => {
  const match = value.match(pattern)
  assert(match, 'missing supplement-closure-dag JSON block')
  return JSON.parse(match[1])
}
assert.deepEqual(
  extract(authority, /```json supplement-closure-dag\n([\s\S]*?)```/),
  extract(plan, /## 8\. Append-only artifact DAG[\s\S]*?```json supplement-closure-dag\n([\s\S]*?)```/),
)
console.log('authority DAG structured equality: PASS')
NODE
git diff --check
```

No command in this task may invoke Claude Code, any P3A-S future command, `go test ./...`,
`go test ./internal/service`, a package-wide runner, or a production/runtime path. The final PR
must contain only this plan file; local CodeGraph files remain ignored and unstaged.
