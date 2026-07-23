# Claude Code 2.1.215 P3A-S Controller-Creation Decision and Execution Plan

> **Plan-only decision (2026-07-23): APPROVE CONTROLLER CREATION AFTER MERGE ONLY.** Until this
> plan-only PR receives one independent holistic review with `0 Critical / 0 Important` and is
> merged, `controller_creation_authorized=false`. Merge changes only that flag. It does not
> authorize a target launch, a P3A-S dynamic cell, Phase 3B implementation, profile promotion, or
> runtime wiring. This task did not create a controller and did not execute Claude Code.

## 1. Decision and four authorization layers

The decision is intentionally split into four non-interchangeable layers:

| layer | present state | transition gate | authority after transition |
| --- | --- | --- | --- |
| merged plan/static recon | COMPLETE | PR #40 and PR #41 are merged; the identities in Section 3 match | planning and static facts only |
| controller creation | DENIED in this PR | this immutable plan tip is independently reviewed `0C/0I`, the PR is merged, and a merge receipt binds the reviewed tip and merge commit/tree | create the exact future worktrees/branch and implement/review a controller; no target launch |
| dynamic target execution | DENIED | the future controller is implemented and independently reviewed, then Mandatory Preflight, immutable input freeze, sandbox, Observer A/B, fake-upstream, Git, disk/resource, and command gates all emit GREEN receipts | launch only the manifest-bound P3A-S cells while their authorization lease is valid |
| Phase 3B use/promotion | DENIED | dynamic P3A-S closure is GREEN; all three required conclusions are `Reproduced`, unexpired, contradiction-free; handoff is `READY`; five closure bindings pass | consume the explicit handoff tuple in Phase 3B; still no runtime promotion without the separate Phase 3B gates |

The controller-creation transition is `DECISION_MERGED_CONTROLLER_CREATION_ONLY`. It permits
source creation and focused tests on the future implementation branch. It never implies
`dynamic_execution_authorized=true` or `phase3b_usable=true`. A controller implementation PR may
not represent itself as an execution receipt.

The active target is Claude Code `2.1.215`, Darwin arm64. `2.1.207` is historical/reference only;
cross-version relabeling is a hard deny. The protected path named by the merged plans remains
outside every file read, search, CodeGraph inventory, edit, compile, stage, commit, and test. The
future command allowlist explicitly rejects package-wide Go runners and implicit package-wide
children. No P1 receipt/context/lease/Recovery mechanism is in scope.

## 2. Fresh planning baseline and exact future worktrees

Both remotes were fetched immediately before this plan was written. The planning roots were clean
before the plan file was added.

| repository | fresh `muqihang/main` commit | tree | planning root | CodeGraph 1.1.6 |
| --- | --- | --- | --- | --- |
| CC Gateway | `6b2759dabe0025f577c131eaa4f2807307befc7c` | `fea93155c7403593d1ce2d8685e45a6deec756cc` | `/Users/muqihang/.codex/worktrees/p3as-execution-plan-20260723/cc-gateway` | 264 files / 9,362 nodes / 33,245 edges |
| Sub2API | `fb840673afc0ff590fef9bb147fce5b9b70eb098` | `eeb8654eddf7a4c38364202f5024161e65d2a6d1` | `/Users/muqihang/.codex/worktrees/p3as-execution-plan-20260723/sub2api-main` | 3,064 files / 98,766 nodes / 331,888 edges |

The local-only CodeGraph configuration is exactly, including final LF:

```json
{"exclude":["backend/internal/service/openai_compact_sse_keepalive_test.go"]}
```

Its SHA-256 is `f885ea40698ff4de9881ce6a9537388ce80c04be9515bf2c77ac186d39140e98`.
The SQLite file-inventory query returned `protected_count=0` in both roots. Every future graph
operation must use the merged `codegraph_with_exclusion` wrapper and repeat the config digest and
zero-count assertions before and after indexing or graph discovery.

The fresh graph resolved the implementation chain that the future controller must reuse:

| concern | current symbol / path | relation |
| --- | --- | --- |
| launch contract | `launch-manifest.ts::validateLaunchManifest`, `loadLaunchManifest`, `buildIsolatedEnvironment` | validates limits, loopback ports, env, then feeds `runCell` |
| target runner/sandbox | `run-cell.ts::runCellGuardSelfTest`, `buildCellSandboxProfile`, `runCell` | digest checks then `sandbox-exec`, process/socket/file/time limits |
| process attribution | `process-sampler.ts::descendants`, `sampleProcessTree`, `sampleSocketCount` | safe process samples for the runner; not Observer B proof |
| loopback observer | `observers/fake-upstream.ts::jsonTopology`, `requestFacts`, `startFakeUpstream` | called by baseline/config/environment/auth/scenario campaigns |
| normalization | `normalize.ts::normalizedEventOrder`, `normalizeCapsule` | verifies cell bindings before safe projection |
| order/convergence | `converge.ts::balancedPairOrder`, `analyzeConvergence` | balanced directions, min/max and unresolved-tail checks |
| index/leak | `artifact-index.ts::buildArtifactIndex`, `verifyArtifactIndex`; `leak-guard.ts::scanArtifactIndex`, `writeLeakScan` | parent graph then safe generated-file scan |
| exit/handoff/terminal | `build-exit.ts::buildExitReport`, `buildHandoff`; `r4-terminal.ts::buildR4TerminalManifest` | closure precedents; no existing resume proof |
| focused tests | `oracle-phase3a-observer.test.ts`, `oracle-phase3a-convergence.test.ts`, `oracle-phase3a-evidence-root.test.ts`, `oracle-phase3a-artifact-identity.test.ts` | current narrow regression anchors |

The call path is `launch-manifest -> run-cell -> process-sampler`, independently
`fake-upstream -> normalize`, then `converge -> artifact-index -> leak-guard -> exit -> handoff ->
terminal`. Observer B is a new independent leaf and cannot be substituted by `process-sampler`.

After the controller-creation gate passes, the exact implementation names are:

```text
CC worktree: /Users/muqihang/.codex/worktrees/claude-code-2.1.215-p3as-execution-controller/cc-gateway
CC branch:   codex/claude-code-2.1.215-p3as-execution-controller
Sub2API WT:  /Users/muqihang/.codex/worktrees/claude-code-2.1.215-p3as-execution-controller/sub2api-main
Sub2API:     detached read-only at fb840673afc0ff590fef9bb147fce5b9b70eb098
```

The merge receipt supplies the exact reviewed plan tip and resulting merge commit/tree. It is an
input, not a floating lookup. Worktree creation must fail if the CC branch/path already exists,
the reviewed tip is not the PR head, the merge commit is not on `muqihang/main`, the merge tree
does not contain the reviewed plan blob, or either frozen repository commit/tree above is absent.
The implementation branch starts at the receipt-bound decision merge commit. Sub2API remains
detached at the exact frozen commit/tree. A later moving `main`, tag, or newest-file scan cannot
replace either input.

## 3. Immutable authority manifest

Before controller source generation, create a reviewed static
`oracle-lab-phase3a-supplement-controller-authority@1.0` manifest. Before any dynamic preflight,
the implemented controller derives exactly one
`oracle-lab-phase3a-supplement-input-manifest@1.0`. Both use strict I-JSON, reject duplicate and
unknown keys, use RFC 8785 JCS UTF-8 plus one final LF, and are written exclusive `0o600` below a
`0o700` root. The second manifest may only add execution-freeze values to the first; it may not
rediscover authority.

### 3.1 Merged plans, P2, and static closure

| input | exact binding |
| --- | --- |
| merged P3A-S plan | `docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3a-resume-supplement.md`; `a937d5d9a1833e9378b4e91bb546f20165062af422f111e172cc0152ed4eb46f` |
| merged Phase 3B plan | `docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3b-profile-synthesis.md`; `367eb28af225ae4d5bf0b666a4c2d3161da7d911f28dc6cb188cb38c1b65a8aa` |
| merged P2 handoff | `docs/superpowers/2026-07-19-claude-code-2.1.215-phase-2-handoff.md`; `a5454d630dc470cda54adaaed6a4eab5ebd2b8c53909ae5487e4a59b29cee4d9` |
| P2 contract | bundle `2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce`; predecessor `70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1`; range `1:0-0` |
| static closure record | `docs/superpowers/evidence/phase3a/claude-code-2.1.215-p3as-static-blocker-recon-v1.json`; exact file `b4f1212584afbeb7d2b59457d778713bd3d8b967bd5a0a48f73c0140f41642ff`; internal JCS `ea6ec9d5b9d027d5ed434714cfc38b28ecd81af93d7b51d102821d9d5ecba5a9`; schema `oracle-lab-phase3a-static-blocker-recon@1.0` |
| static report | `docs/superpowers/evidence/phase3a/claude-code-2.1.215-p3as-static-blocker-recon-v1.md`; `3e1b025ca5f075e21ca528544c9be096e1b1afb090a9aecfe448660563fe38bc` |
| static schema | `docs/superpowers/schemas/oracle-lab-phase3a-static-blocker-recon.schema.json`; `d685bc7e71e00a4d0fbfb123004b1a7ac5dced46b279d037ec81ba0651605900` |
| static builder | `tools/oracle-lab/phase3a/static-blocker-recon.ts`; `275511cd2a0000bd637ae81ddfe4f4760e5a1d8319e6d424d14ae5eb7773c4b8` |

The record's embedded merged-plan digests are append-only predecessor identities, not hashes of
the current merged files. The manifest binds both those embedded predecessors and the current
merged digests above. Any attempt to replace one with the other is `authority_predecessor_drift`.

### 3.2 Official artifact and v13 five-piece safe closure

The official tuple is fixed: direct native entrypoint `claude`, entrypoint SHA-256
`90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58`, size `247124336`,
release archive `599883973d2b4c8bb25e3490c84d65646f78d158cdc86adc73c1f5a6cfbbd600`,
release tree `f5a04795289524b639b479fe6ffac187218d7c558a5a5be312ee228850c6e7fe`,
entry-module SHA-256 `67472f5f9cd28b3b83003eb29ee0747bdcebc6969cc14f726bfdae2e4d998d0f`,
entry-module offset `217140984`, length `20163513`, and scan digest
`cac6799818f1f6780280d993adcb24cf2a834f7f5fd048a9c82fa35d0e464928`.
The wrapper archive/tree are `1a5cf8e491689154264c0b2f28371bf645cdee2903b45c497915868308502d7b` /
`024fa410b532ced37cd9e45a95aae6f9eb22e9ce8491e1fad843f24d958f4a88`; the platform
archive/tree are `b5dd6a135c96957dae232218c4ae5b04328a788f8c509202c92a2fec550601b2` /
`864f493d9fc237df6a858e1620c83279b8f6c15f205dbb47c058f3f537e924a6`.

Only these v13 safe files may be opened from the safe evidence root:

| kind / relative path | SHA-256 | schema |
| --- | --- | --- |
| `phase-3a-exit-report-v13.json` | `57f16b207933b3a751f96471733d435fa4b0c9801fbef2f5495e8884dfe0bd1b` | `oracle-lab-phase3a-exit.v1` |
| `phase-3b-3.5-handoff-v13.json` | `9d188072719dc27a2f9cc9939bc79afa598802b84dd4d9161fb1da3263a792d7` | `oracle-lab-phase3a-handoff.v1` |
| `closure-terminal-manifest-v8.json` | `c9ee57fbe29125c88278961565f814326b052077b861bb41008cdde6161f12f5` | `oracle-lab-phase3a-r4-terminal.v1` |
| `artifact-index-v23.json` | `e8645c7ed4bc984a926f91e3df1b756c4b009b3a02408de213cbe81b060e80d4` | `oracle-lab-phase3a-artifact-index.v1` |
| `leak-scan-v23.json` | `7ed3e2776c7fcc47d6c8d513318b33547919c92a33a068a4f0c0cb3706bad145` | `oracle-lab-phase3a-leak-scan.v1` |

Each binding requires `lstat`, regular-file, no-symlink, exact-root `realpath` containment, exact
SHA-256, and schema discriminator. Raw P3A evidence and every other capsule are forbidden.

### 3.3 Static anchor and signal binding

The input manifest copies the complete 36 function/method anchor objects and two constant anchor
objects from the exact static closure record, including offsets, lengths, source hashes,
direct-call lists, and CFG shape digests. Their JCS array digests are:

```text
static_anchors[36]  f69b0c1ec3b5022dd4462a366c5989e2bff643a3f0b620031bbb58bf8b6d37de
static_constants[2] d065d0bcf53ac2ee1d68aff1169e06c97584f9f94ead4bb7531fbea9a60c8ea0
```

The human-review inventory is fixed by ID, in record order:

```text
entrypoint-version, argv-start-classifier, cli-option-grammar, cli-operation-validation,
config-root-env, config-root-provider, cwd-canonicalization, project-path-hash,
project-path-hash-encoding, project-path-sanitizer, project-root-derivation,
project-directory-derivation, state-path-derivation, state-jsonl-writer,
state-selector-parser, state-file-resolver, state-jsonl-reader, state-read-resolver-bridge,
state-message-reconstructor, state-jsonl-tolerant-parser, resume-loader, print-resume-router,
headless-resume-bridge, headless-message-runner, message-transport-bridge,
query-message-input, query-generator-bridge, query-pipeline, default-model-dispatch,
model-call-bridge, request-normalizer, request-serializer, network-request-sink,
sdk-base-url-precedence, sdk-message-post-route, persistence-disable-gate
constants: config-root-assignment, project-key-length-constant
```

The target-generated signal is the ordered predecessor prefix at `POST /v1/messages` JSON AST
`$.messages`, preceding the final current input. Its signal-anchor digest is
`11981d9f74d3e7a7cd0ab0c5e7d78bdbabbeaa0cbc2f69f33b2293e14f05e4d5`; the connected
reader-to-request derivation digest is
`15211ac067c3b8192a49bb451af96dc59960d46e4162bf076ba8371d0d775ecc`.
Their two-field JCS digest is `a920f8a509b02b6eb79cf982ade939b6dcc25f8953d00c7dfa54999aecc71f74`.

## 4. Exact launch contract

No flag, environment key, CWD, state root, endpoint, or selector may be discovered or guessed at
runtime. The execution-only launch manifests are frozen, reviewed, SHA-bound by the input
manifest, and checked immediately before `spawn` with `shell=false`.

```text
creation argv:
  --print --bare --verbose --output-format stream-json --input-format stream-json
  --session-id <creation-session-uuid>
new-control argv:
  --print --bare --verbose --output-format stream-json --input-format stream-json
  --session-id <new-control-session-uuid>
resume-positive argv:
  --print --bare --verbose --output-format stream-json --input-format stream-json
  --resume <predecessor-session-uuid>
```

There is no positional prompt. Stream-JSON stdin bytes are synthetic, fixed before launch, and
digest-bound. The UUID values are generated once at manifest freeze using UUIDv5 namespace
`6a5d31d4-4324-5f36-8dd6-c00f0e6a8021` and name
`p3as-215/<operation>/<cell-id>`; the execution manifest contains the UUID, while durable output
contains only its `sr1:session:sha256:...` ref. `--continue`, `--fork-session`,
`--no-session-persistence`, positional prompts, and any extra token are denied.

`R` is the exact absolute `0o700` evidence root supplied to `freeze-input` by `--evidence-root`;
`S` is the separately supplied exact absolute supplement root and must be lexical-equal to
`$R/capsules/P3A-S`. Freeze performs one `realpath` on each, requires `S` containment, writes the
`sr1:root` binding plus exact paths only into execution-only manifests, and never resolves either
again. Creation and resume share one CWD/config root; new-control uses a different CWD/config root.
The complete mapping is:

```text
creation/resume:
  cwd=$R/runtime/create-resume/cwd
  HOME=$R/runtime/create-resume/home
  CLAUDE_CONFIG_DIR=$R/runtime/create-resume/config
  CLAUDE_CODE_TMPDIR=$R/runtime/create-resume/tmp
  TEMP=$R/runtime/create-resume/tmp
  TMP=$R/runtime/create-resume/tmp
  TMPDIR=$R/runtime/create-resume/tmp
  XDG_CACHE_HOME=$R/runtime/create-resume/xdg/cache
  XDG_CONFIG_HOME=$R/runtime/create-resume/xdg/config
  XDG_DATA_HOME=$R/runtime/create-resume/xdg/data
  XDG_STATE_HOME=$R/runtime/create-resume/xdg/state
new-control:
  cwd=$R/runtime/new-control/cwd
  HOME=$R/runtime/new-control/home
  CLAUDE_CONFIG_DIR=$R/runtime/new-control/config
  CLAUDE_CODE_TMPDIR=$R/runtime/new-control/tmp
  TEMP=$R/runtime/new-control/tmp
  TMP=$R/runtime/new-control/tmp
  TMPDIR=$R/runtime/new-control/tmp
  XDG_CACHE_HOME=$R/runtime/new-control/xdg/cache
  XDG_CONFIG_HOME=$R/runtime/new-control/xdg/config
  XDG_DATA_HOME=$R/runtime/new-control/xdg/data
  XDG_STATE_HOME=$R/runtime/new-control/xdg/state
```

The target state path is derived only as
`NFC(CLAUDE_CONFIG_DIR)/projects/<canonical-cwd-key>/<session-uuid>.jsonl`; directory/file modes
are `0o700/0o600`. Creation is target-attributed queued append. Resume is target-attributed
resolve/read/parse/reconstruct. Because the target has no whole-file integrity check and may
ignore malformed lines, Observer B must independently hash the exact predecessor immediately
before launch and reject any later mismatch before accepting an open/read event.

The environment starts empty and uses these exact literal common values for all three operations:

```text
ANTHROPIC_API_KEY=p3as-synthetic-placeholder-2.1.215
ANTHROPIC_BASE_URL=http://127.0.0.1:43127/
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
NO_PROXY=127.0.0.1,::1
no_proxy=127.0.0.1,::1
PATH=/usr/bin:/bin:/usr/sbin:/sbin
TERM=dumb
TZ=UTC
LANG=C
LC_ALL=C
unset: ALL_PROXY, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_CUSTOM_HEADERS, AWS_BEARER_TOKEN_BEDROCK,
       CLAUDE_CODE_API_BASE_URL, CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR, CLAUDE_CODE_OAUTH_TOKEN,
       HTTPS_PROXY, HTTP_PROXY, SSH_AUTH_SOCK
```

Port `43127` is the only launch-manifest loopback port. Preflight binds the fake upstream to
`127.0.0.1:43127`; an occupied/unavailable port is BLOCKED and no alternate port/address is
selected. SDK precedence remains explicit `baseURL`, then `ANTHROPIC_BASE_URL`, then SDK default;
the first and third routes are denied by the frozen cell. Policy is `declared_loopback_only` and
external socket budget is exactly `0`. No real credential, upstream, account, token, proxy, DNS,
Unix socket, or canary is permitted. Every exact argv array, stdin digest, CWD, absolute env map,
state-root ref, and port is separately hashed into its creation/new/resume launch manifest.

## 5. Mandatory Preflight and dynamic authorization

After controller implementation review, the future controller has exactly five commands and no
implicit default. `R` and `S` below are the already-created exact roots defined in Section 4:

```bash
: "${P3A_EVIDENCE_ROOT:?exact absolute evidence root required}"
: "${P3A_SUPP_ROOT:?exact absolute supplement root required}"
R="$P3A_EVIDENCE_ROOT"
S="$P3A_SUPP_ROOT"
test "$S" = "$R/capsules/P3A-S"
controller create-authority \
  --decision-receipt "$R/reviews/controller-creation-decision.json" \
  --implementation-review-receipt "$R/reviews/controller-implementation-review.json" \
  --out "$S/controller-authority.json"
controller freeze-input \
  --controller-authority "$S/controller-authority.json" \
  --evidence-root "$R" \
  --supp-root "$S" \
  --creation-launch-out "$R/runtime/manifests/creation.json" \
  --new-control-launch-out "$R/runtime/manifests/new-control.json" \
  --resume-launch-out "$R/runtime/manifests/resume-positive.json" \
  --out "$S/input-manifest.json"
controller preflight \
  --controller-authority "$S/controller-authority.json" \
  --input-manifest "$S/input-manifest.json" \
  --implementation-review-receipt "$R/reviews/controller-implementation-review.json" \
  --out "$S/preflight-receipt.json"
controller authorize-execution \
  --input-manifest "$S/input-manifest.json" \
  --preflight-receipt "$S/preflight-receipt.json" \
  --implementation-review-receipt "$R/reviews/controller-implementation-review.json" \
  --out "$S/dynamic-execution-receipt.json"
controller execute \
  --input-manifest "$S/input-manifest.json" \
  --preflight-receipt "$S/preflight-receipt.json" \
  --dynamic-execution-receipt "$S/dynamic-execution-receipt.json" \
  --out-root "$S"
```

The receipt chain and durable contracts are exact:

| object | schema | ceiling / mode | binds |
| --- | --- | --- | --- |
| decision receipt | `oracle-lab-phase3a-supplement-controller-decision@1.0` | 32 KiB / `0o600` | final plan commit/tree/blob digest, decision review `0C/0I`, PR merge commit/tree |
| implementation review receipt | `oracle-lab-phase3a-supplement-controller-implementation-review@1.0` | 32 KiB / `0o600` | exact implementation commit/tree, source-set digest, controller build/executable digest, focused result-set digest, review `0C/0I` |
| controller authority | `oracle-lab-phase3a-supplement-controller-authority@1.0` | 32 KiB / `0o600` | exact SHA-256 of both receipts and all Section 3 authority |
| input manifest | `oracle-lab-phase3a-supplement-input-manifest@1.0` | 32 KiB / `0o600` | authority SHA, three launch-manifest SHAs, root safe ref, trusted freeze time/expiry |
| preflight receipt | `oracle-lab-phase3a-supplement-preflight@1.0` | 32 KiB / `0o600` | implementation commit/tree/build, authority/input/launch SHAs and every preflight result digest |
| execution receipt | `oracle-lab-phase3a-supplement-dynamic-execution@1.0` | 32 KiB / `0o600` | input/preflight/implementation-review SHAs, issued/expiry, exact authorized cell-set digest |

All are JCS plus final LF, exclusive, link-count one, same-root, and exact-byte SHA-bound. The
three execution-only launch manifests are `0o600`, maximum 32 KiB, use the existing strict launch
schema, and are immutable after `freeze-input`. The decision and implementation receipts are
produced by their independent reviewers, not by the controller. `create-authority`, `freeze-input`,
and `preflight` cannot spawn Claude Code. Preflight may run only synthetic harness self-tests and
the Observer B sentinel.

Before every target spawn, `execute` reasserts that HEAD commit/tree, source-set digest,
controller executable digest, and implementation review receipt exactly match the reviewed
implementation tip. A clean worktree alone is insufficient. It also denies unless all of these
receipts are canonical, same-root, unexpired, and digest-bound:

1. decision merge receipt and final reviewed plan-tip `0C/0I` review;
2. implementation review receipt with exact commit/tree/source/build and `0C/0I` review;
3. exact CC/Sub2API commits/trees and clean implementation worktree; no dangerous Git env;
4. CodeGraph config SHA and `protected_count=0` in both roots;
5. all merged-plan, P2, static closure, artifact, 36+2 anchor, signal, and v13 bindings;
6. exact executable version/format/codesign/digest/size and Darwin arm64 platform;
7. immutable launch manifests, stdin digests, UUID mapping, CWD/state-root, env, and endpoint;
8. `sandbox-exec` profile self-test, denied external socket/DNS/Unix-socket probes, and direct
   child process-limit self-test;
9. Observer A fake-upstream JSON/SSE projector self-test and Observer B no-root sentinel
   open/read plus process-start/executable attribution self-test;
10. free scratch at least 8 GiB, root/directory/file mode checks, file-count budget, four-hour
   monotonic deadline, and cleanup manifest;
11. focused RED then GREEN tests, two isolated deterministic closure regenerations, and zero-leak
    static fixtures.

Only `authorize-execution` may emit `P3AS_DYNAMIC_EXECUTION_GREEN`. Its expiry is
`min(preflight_completed_at+4h,input_manifest.expires_at)` from the bound trusted time input. It
sets `dynamic_execution_authorized=true` only for the exact input, implementation, preflight, and
cell-set digests. Any drift returns it to false. Controller creation, clean Git, or GREEN unit
tests never set this receipt.

## 6. Independent observers

### 6.1 Observer A: loopback JSON AST/SSE

Extend the existing `startFakeUpstream -> collectRequest -> requestFacts/jsonTopology` path with a
supplement-only projector. It accepts only loopback HTTP, parses strict request JSON in memory,
and emits the ordered topology of `$.messages`. A resume proof requires the ordered predecessor
projection from the creation exchange, including at least one predecessor assistant entry,
before the final current input. New-control must contain current input only. The response side
emits only bounded SSE event-name/data-shape/start/stop/terminal/retry classes. It persists no
body, message text, headers, session UUID, or controller-supplied predecessor digest.

Observer A's source, executable/runtime, parser dependency, config, signal-anchor, derivation,
and output digests are independent fields. Missing AST, wrong prefix/order, malformed JSON/SSE,
fresh fallback, controller injection, or topology/parser disagreement yields Unknown.

### 6.2 Observer B: Darwin vnode/process-start

Implement a separate Swift supervisor source and compiled executable under the supplement module.
Its only filesystem event source is the exact executable `/usr/bin/fs_usage` with argv
`-w -f filesystem`; its executable SHA-256 and version output digest are frozen in the input
manifest. The Swift supervisor obtains process-start, parent relation, and executable path through
Darwin `proc_pidinfo`/`proc_pidpath`, then hashes the executable itself. Preflight launches a
synthetic sentinel process, requires one attributable open/read/close sequence, and proves this
exact command needs no root. If `/usr/bin/fs_usage`, either libproc call, or event attribution is
unavailable, ambiguous, privileged, or lossy, execution is BLOCKED. No equivalent surface,
alternate argv, fallback parser, or runtime selection is allowed.

Observer B hashes the bound predecessor from its own process before resume launch, records only
typed vnode operation classes and safe refs, and accepts the read only from the unique descendant
whose process-start ref and executable SHA match the run manifest. Its write-only result pipe and
`observer-b-filesystem-process.json` are not readable by Observer A. It never parses HTTP, JSON,
SSE, prompts, messages, or A output.

The two observers share only immutable manifest digests and the terminal builder's later safe
comparison. They do not share capture bytes, parsers, libraries, output files, normalized streams,
or failure modes. A third builder joins their already-closed outputs. Observer perturbation is
tested by paired unobserved/observed positive cells; topology, terminal class, and consumption
classification must remain equivalent.

## 7. Frozen A01-A15 matrix

Use `seed=3141592653`, `repetitions=6`, and only
`balancedPairOrder(3141592653, 6)`. Slots `0..5` contain three control-first and three
treatment-first orders. Every row has exactly six repetitions. A03-A15 are evaluated for stable
denial and never enter positive convergence. The side-effect tuple is
`target_launches/upstream_safe_requests/filesystem_safe_records`.

| arm | family | deny / terminal | side effects | observer rule | positive convergence |
| --- | --- | --- | --- | --- | --- |
| A01 `a01-new` | new-session-control | `new_control_no_predecessor` / `CONTROL_NEW_SESSION` | `1/1/0` | no predecessor proof | control only |
| A02 `a02-resume` | resume-candidate | none / `REPRODUCED_RESUME_CANDIDATE` | `1/1/1` | A/B same creation digest | yes |
| A03 `a03-neg-missing-predecessor` | missing-predecessor | `missing_predecessor` / `DENY_MISSING_PREDECESSOR` | `0/0/0` | neither starts | no |
| A04 `a04-neg-tampered-predecessor` | tampered-predecessor | `predecessor_digest_mismatch` / `DENY_PREDECESSOR_DIGEST` | `1/0/1` | A/B mismatch | no |
| A05 `a05-neg-swapped-predecessor` | swapped-predecessor | `predecessor_cell_mismatch` / `DENY_PREDECESSOR_CELL` | `1/0/1` | wrong cell | no |
| A06 `a06-neg-wrong-run-binding` | wrong-run-binding | `run_binding_mismatch` / `DENY_RUN_BINDING` | `0/0/0` | neither starts | no |
| A07 `a07-neg-fresh-session-fallback` | fresh-session-fallback | `fresh_session_fallback` / `UNKNOWN_FRESH_FALLBACK` | `1/1/0` | A/B absence of consumption | no |
| A08 `a08-neg-nonterminal-creation` | nonterminal-creation | `predecessor_nonterminal` / `DENY_PREDECESSOR_NONTERMINAL` | `0/0/0` | neither starts | no |
| A09 `a09-neg-observer-disagreement` | observer-disagreement | `observer_disagreement` / `UNKNOWN_OBSERVER_DISAGREEMENT` | `1/1/1` | stable disagreement | no |
| A10 `a10-neg-instrumentation-perturbation` | instrumentation-perturbation | `instrumentation_perturbation` / `UNKNOWN_INSTRUMENTATION_PERTURBATION` | `1/1/1` | perturbation invalidates | no |
| A11 `a11-neg-network-only-proof` | network-only-proof | `observer_b_missing` / `UNKNOWN_OBSERVER_INCOMPLETE` | `1/1/0` | A only | no |
| A12 `a12-neg-filesystem-only-proof` | filesystem-only-proof | `observer_a_missing` / `UNKNOWN_OBSERVER_INCOMPLETE` | `1/0/1` | B only | no |
| A13 `a13-neg-missing-state-dependent-network-signal` | missing-network-signal | `missing_state_dependent_network_signal` / `UNKNOWN_NETWORK_SIGNAL` | `1/1/1` | B present/A signal absent | no |
| A14 `a14-neg-controller-supplied-predecessor-proof` | controller-proof | `controller_supplied_proof` / `DENY_CONTROLLER_PROOF` | `0/0/0` | controller proof never counts | no |
| A15 `a15-neg-wrong-reader-pid-process-start` | wrong-reader-identity | `wrong_reader_process_identity` / `UNKNOWN_WRONG_READER_IDENTITY` | `1/1/1` | A present/B wrong attribution | no |

Run IDs are exactly `p3as-215-sNN-rNN-a00-create`, `...-a01-new`, `...-a02-resume`, and
`...-aNN-neg-<case>` for `03..15`. Each positive/negative requiring a predecessor has a dedicated
terminal creation run first. One repetition mismatch in deny code, side-effect tuple, order,
terminal, or observer class makes the family Unknown and disables the supplement. Positive
convergence calls existing `analyzeConvergence` with `min=5,max=12`; the planned campaign stops at
six if stable, may continue only unresolved positive leaves to twelve, and then emits
`MAX_UNRESOLVED`.

## 8. CONFIG-AUTH and FAILURE-STREAM successor revalidation

The v13 usable rows `CL-P3A-R2-CONFIG-AUTH` and `CL-P3A-R2-FAILURE-STREAM` expire at
`2026-08-03T00:00:00.000Z`. They are not silently carried forward. Using the same frozen target,
seed, order, six repetitions, synthetic auth, and bounded fake-upstream scenarios, emit exactly
one append-only successor each:

```text
CL-P3A-SUPP-R2-CONFIG-AUTH
CL-P3A-SUPP-R2-FAILURE-STREAM
```

Each successor binds the exact v13 predecessor conclusion digest, selected leaf digests,
artifact tuple, issue/expiry, parser agreement, contradiction set, and safe projection. The TTL
policy is exactly `trusted-freeze-time-plus-24h`; `issued_at` is the single trusted input-manifest
freeze time and `expires_at=issued_at+24h`. Expiry is checked at freeze, closure, handoff, and
Phase 3B consumption. Missing, stale, revoked, regressed, contradictory, duplicate, ambiguous, or
expired successor makes the closure BLOCKED. A successor may narrow but never expand a v13 claim.

The third required row is `CL-P3A-SUPP-RESUME-LINEAGE`. It is usable only at `Reproduced` with
six stable repetitions, A/B agreement, no unresolved lineage leaf, no contradiction, and the same
24-hour policy. Thus Phase 3B requires all three rows simultaneously unexpired.

## 9. Append-only artifact DAG and durable contract

The following block must be structured-equal to the merged Phase 3B authority before Kahn sort:

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

Generation order is `artifact_index -> leak_report -> exit_report -> handoff -> terminal_manifest
-> external_digest_set`. The index excludes itself and every later closure object. Every write is
exclusive, append-only, canonical, and immediately re-read/validated before the next stage.

The only consumer root is `capsules/P3A-S`, resolved from the handoff dirname. Root and all
directories are `0o700`; JSON files are `0o600`. Fixed outputs are:

| output | relative path | ceiling |
| --- | --- | ---: |
| input manifest | `input-manifest.json` | 32 KiB |
| cell record | `cells/<cell_id>/run-record.json` | 64 KiB |
| creation/resume state | `cells/<cell_id>/state/{creation-state,resume-state}.json` | 64 KiB each |
| Observer A/B | `cells/<cell_id>/observers/{observer-a-network,observer-b-filesystem-process}.json` | 16 KiB each |
| three conclusions | `normalized/conclusions/<exact-conclusion-id>.json` | 64 KiB each |
| artifact index | `artifact-index-v1.json` | 256 KiB |
| leak scan | `leak-scan-v1.json` | 256 KiB |
| exit | `phase-3a-supplement-exit-v1.json` | 256 KiB |
| handoff | `phase-3b-supplement-handoff-v1.json` | 256 KiB |
| terminal | `closure-terminal-manifest-v1.json` | 256 KiB |
| external digest set | `closure-digest-set-v1.json` | 256 KiB |

Every path uses lexical and `realpath` containment, no symlink, link count one, exact mode,
strict schema/path pair, size ceiling, RFC 8785 JCS plus final LF, and exact-byte SHA-256. The leak
scanner covers generated safe files only and rejects forbidden field names and canary values.
Two isolated generation roots must produce identical logical bytes and digests for the five
closure objects and external digest set.

## 10. Implementation work packages

All work below occurs only after controller-creation authorization. No package creates a runtime
profile or Phase 3B wiring.

1. **P3AS-C0 authority and RED:** add strict controller-authority/input-manifest schemas, merge
   receipt validation, Git/CodeGraph freeze, safe binding, exact argv/env/state contracts, and RED
   fixtures. Stop before source generation on authority drift.
2. **P3AS-C1 codec and paths:** add duplicate-key I-JSON parser, JCS writer, safe-ref codec,
   schema registry, root/mode/size validator, exclusive writer, deterministic UUID mapping, and
   generated-only leak scanner.
3. **P3AS-C2 observers:** extend fake upstream with the bounded `$.messages`/SSE projector; add
   the separate Swift Darwin supervisor, build digest, no-root sentinel preflight, write-only pipe,
   and independence/perturbation tests.
4. **P3AS-C3 controller:** compose existing `validateLaunchManifest`, `runCell`, sandbox guard,
   process sampler, fake upstream, and exact creation/new/resume manifests. Add A01-A15 and stable
   side-effect accounting. Do not alter production proxy/runtime paths.
5. **P3AS-C4 convergence/revalidation:** reuse `balancedPairOrder` and `analyzeConvergence`; build
   CONFIG-AUTH, FAILURE-STREAM, and RESUME-LINEAGE conclusions with expiry and predecessor gates.
6. **P3AS-C5 closure:** implement authority DAG equality, Kahn order, bounded index, leak, exit,
   handoff, terminal, external digest set, deterministic regeneration, and Phase 3B explicit tuple.
7. **P3AS-C6 focused closure:** run named RED then GREEN commands, leak zero, one consolidated
   holistic review, one bounded fix wave only for genuine Critical/Important findings, and one
   closure re-review. Minor findings are recorded without reopening unless they invalidate an
   acceptance condition.

The expected implementation stays under `tools/oracle-lab/phase3a/supplement/`, strict schemas
under `docs/superpowers/schemas/`, and named tests under `tests/`. Production source, Sub2API
runtime, P1 mechanisms, P3A v13, and Phase 3B compiler/runtime remain unchanged.

The source inventory is frozen to these new files; adding another implementation file requires a
new decision review before dynamic authorization:

```text
tools/oracle-lab/phase3a/supplement/authority.ts
tools/oracle-lab/phase3a/supplement/input-manifest.ts
tools/oracle-lab/phase3a/supplement/codec.ts
tools/oracle-lab/phase3a/supplement/observer-a.ts
tools/oracle-lab/phase3a/supplement/observer-b-darwin.swift
tools/oracle-lab/phase3a/supplement/observer-b-build.ts
tools/oracle-lab/phase3a/supplement/matrix.ts
tools/oracle-lab/phase3a/supplement/controller.ts
tools/oracle-lab/phase3a/supplement/conclusions.ts
tools/oracle-lab/phase3a/supplement/closure.ts
docs/superpowers/schemas/oracle-lab-phase3a-supplement-controller-authority.schema.json
docs/superpowers/schemas/oracle-lab-phase3a-supplement-controller-decision.schema.json
docs/superpowers/schemas/oracle-lab-phase3a-supplement-controller-implementation-review.schema.json
docs/superpowers/schemas/oracle-lab-phase3a-supplement-input-manifest.schema.json
docs/superpowers/schemas/oracle-lab-phase3a-supplement-preflight.schema.json
docs/superpowers/schemas/oracle-lab-phase3a-supplement-dynamic-execution.schema.json
docs/superpowers/schemas/oracle-lab-phase3a-supplement-state.schema.json
docs/superpowers/schemas/oracle-lab-phase3a-supplement-observer.schema.json
docs/superpowers/schemas/oracle-lab-phase3a-supplement-cell-run.schema.json
docs/superpowers/schemas/oracle-lab-phase3a-supplement-conclusion.schema.json
docs/superpowers/schemas/oracle-lab-phase3a-supplement-closure.schema.json
```

The eleven test filenames in Section 11 are the complete new test inventory. Existing P3A/P2
files may receive only the narrow imports or fixtures required by those tests; every such edit is
listed in the implementation PR and reviewed against the no-production boundary.

## 11. Focused commands and acceptance

The future implementation test ladder is exact and each file runs separately:

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

The unchanged P2 gate is narrow and explicit:

```bash
cd "$CC_GATEWAY_ROOT"
npm exec tsx tests/oracle-contract-canonical.test.ts
npm exec tsx tests/oracle-contract-admission.test.ts
npm exec tsx tests/oracle-contract-manifest-authority.test.ts
npm exec tsx tests/oracle-contract-cross-project.test.ts
cd "$SUB2API_ROOT/backend/internal/service"
go test oracle_contract_canonical.go oracle_contract_types.go \
  oracle_contract_admission.go oracle_contract_authority.go \
  oracle_contract_cross_project.go oracle_contract_canonical_test.go \
  oracle_contract_admission_test.go oracle_contract_authority_test.go \
  oracle_contract_cross_project_test.go \
  -run 'TestOracleContract(Canonical|Admission|Authority|CrossProject)$' -count=1
```

The command gate parses argv before spawn and denies any unlisted test, package operand, wildcard,
recursive runner, shell expansion, or implicit child. It also denies protected inventory nonzero,
external network, real credentials, production commands, and dynamic execution before the GREEN
receipt.

GREEN requires exact authority bindings, all 15 families at six repetitions, both positive order
directions, three unexpired Reproduced conclusions, independent A/B agreement, zero unresolved
lineage leaves, strict schemas, exact DAG equality/Kahn order, deterministic regeneration, leak
PASS with zero findings, exit `GREEN`, handoff `READY_PENDING_TERMINAL`, terminal `GREEN`, a valid
external digest set, and consumer-derived effective handoff state `READY`. Anything less keeps
`phase3b_usable=false`.

## 12. Resource, stop, rollback, and cleanup rules

Limits are one Darwin arm64 artifact, one disposable root per isolated generation, initially six
and at most twelve positive repetitions, four hours active execution, 8 GiB scratch, 64 files per
cell, 4 processes per cell, 0 external sockets, no privileged observer, and the per-file ceilings
in Section 9. The controller records monotonic elapsed time, peak disk, process/file/socket counts,
and stops before exceeding a bound.

Stop immediately with a canonical BLOCKED receipt on missing observer capability, observer
dependence/disagreement, pre-open digest drift, target/artifact drift, config/schema/path/mode
mismatch, nonconvergence, perturbation, leak, protected-boundary violation, external socket/DNS,
resource exhaustion, expiry, contradiction, or command escape. No automatic relaxation,
mechanism expansion, second observer parser over shared bytes, or review loop is allowed.

Rollback/cleanup is descriptive only in this plan. A future failed run closes servers and pipes,
terminates only the manifest-bound process group, seals safe failure receipts, verifies no child or
socket remains, and removes disposable runtime/state roots only after retention approval. It never
deletes v13/static authority, rewrites Git history, resets/cleans a worktree, or mutates an
append-only closure. This planning task performs none of those actions.

## 13. Exit, handoff, and Phase 3B consumer binding

P3A-S exit is `GREEN` only when its predecessor gates hold. The handoff is generated after exit;
it may become `READY_PENDING_TERMINAL` and bind only already-generated predecessors: the input
manifest, three conclusions, artifact index, leak report, and exit report. It never includes its
own digest and cannot bind terminal or external digest set. The terminal manifest is generated
next, binds those predecessors plus the handoff digest, and sets final closure status `GREEN` or
`BLOCKED`. The external digest set is generated last and binds exactly the five closure files
`artifact_index`, `leak_report`, `exit_report`, `handoff`, and `terminal_manifest`; none of those
five files references the external set.

`READY_PENDING_TERMINAL` is not Phase 3B readiness. A separate explicit consumer tuple, supplied
only after the terminal and external set close, contains
`{relative_path,sha256,schema_id,schema_major,schema_revision}` for the three conclusions and all
five closure files plus the external digest set. Phase 3B may not walk a directory, select a
newest file, accept an absolute path, infer readiness from controller existence, or use the
handoff alone.

The consumer rechecks all three expiries against its trusted time input, the same artifact tuple,
P2 range, predecessor links, contradictions, parser agreement, terminal `GREEN`, the handoff's
`READY_PENDING_TERMINAL`, and the external digest set's five closure bindings. Only then does the
consumer derive effective handoff state `READY` and permit Phase 3B to treat P3A-S as usable. This
plan neither implements that consumer nor promotes a profile.

## 14. Requirement traceability

| requirement | implementation/test/output | acceptance |
| --- | --- | --- |
| four authorization layers | decision receipt, preflight receipt, exit/handoff | no layer implies a later layer |
| Git/fresh baseline | C0 Git freeze and command-chain RED | exact commits/trees/worktree names; no floating main |
| CodeGraph exclusion | C0 wrapper and SQLite count | config SHA exact; both counts zero |
| immutable inputs | authority/input manifest tests | plans/static/P2/artifact/anchors/signals/v13 all bound |
| exact target protocol | launch-manifest and prior-state tests | argv/env/cwd/state roots/stdin/UUID digests exact |
| Observer A/B independence | observer-independence and perturbation tests | distinct surfaces/deps/parsers/outputs/failures; sentinel GREEN |
| A01-A15 | resume supplement and prior-state controls | 15 unique arms, six reps each, negatives excluded from convergence |
| CONFIG-AUTH / FAILURE-STREAM | usable-revalidation test | exact unexpired append-only successors |
| sandbox/network/resource | preflight and command-chain tests | loopback only, external sockets zero, budgets enforced |
| append-only DAG | DAG equality/compatibility tests | exact authority graph and Kahn order |
| schema/path/mode/size | input, terminal, leak tests | strict JCS, containment, `0o700/0o600`, ceilings |
| deterministic closure | two isolated generations | exact logical bytes/digests equal |
| leak zero | supplement leak guard | no forbidden fields/canaries/raw material |
| P3A-S exit/handoff | terminal and closure tests | exit/terminal GREEN, raw handoff READY_PENDING_TERMINAL, external set valid, consumer-derived READY |
| review boundedness | consolidated review receipt | one holistic review, at most one C/I fix wave and one re-review |
| `RA-P0-001`, `HA-P1-002` | convergence and deterministic closure | stable balanced repetitions and identical output |
| `RA-P0-002`, `RA-P1-004` | resume conclusion and A/B records | only Reproduced prior-state consumption is usable |
| `RA-P0-007`, `RA-P1-003` | safe projector/leak guard | bounded topology only; no raw material |
| `RA-P0-009`, `HA-P0-009` | command/sandbox gates | production, protected path, broad runners denied |
| `RA-P1-001`, `HA-P0-004` | artifact/input bindings | exact 2.1.215 Darwin arm64; 2.1.207 relabel denied |
| `HA-P1-001` | observer independence | true capture and dependency independence |
| `HA-P1-003` | RED corpus and stable deny codes | malformed/missing/contradictory input fails closed |
| Phase 3B boundary | explicit consumer tuple | three unexpired Reproduced rows and READY handoff only |

## 15. Plan-only verification and review freeze

Only static/document checks are permitted for this PR:

```bash
set -euo pipefail
PLAN=docs/superpowers/plans/2026-07-23-claude-code-2.1.215-phase-3a-resume-supplement-execution.md
test -s "$PLAN"
test "$(shasum -a 256 codegraph.json | awk '{print $1}')" = \
  f885ea40698ff4de9881ce6a9537388ce80c04be9515bf2c77ac186d39140e98
test "$(sqlite3 .codegraph/codegraph.db \
  "SELECT COUNT(*) FROM files WHERE path='backend/internal/service/openai_compact_sse_keepalive_test.go';")" = 0
! rg -n 'T[O]DO|T[B]D|FIXM[E]|@lates[t]' "$PLAN"
rg -q 'APPROVE CONTROLLER CREATION AFTER MERGE ONLY' "$PLAN"
rg -q 'dynamic_execution_authorized=true' "$PLAN"
rg -q 'phase3b_usable=false' "$PLAN"
for arm in $(seq -w 1 15); do rg -q "A${arm}" "$PLAN"; done
for digest in a937d5d9a1833e9378b4e91bb546f20165062af422f111e172cc0152ed4eb46f \
  367eb28af225ae4d5bf0b666a4c2d3161da7d911f28dc6cb188cb38c1b65a8aa \
  b4f1212584afbeb7d2b59457d778713bd3d8b967bd5a0a48f73c0140f41642ff \
  ea6ec9d5b9d027d5ed434714cfc38b28ecd81af93d7b51d102821d9d5ecba5a9 \
  11981d9f74d3e7a7cd0ab0c5e7d78bdbabbeaa0cbc2f69f33b2293e14f05e4d5 \
  15211ac067c3b8192a49bb451af96dc59960d46e4162bf076ba8371d0d775ecc; do
  rg -q "$digest" "$PLAN"
done
! rg -n '^go test (\./\.\.\.|\./internal/service)( |$)' "$PLAN"
git diff --check
test "$(git status --short --untracked-files=all)" = "?? $PLAN"
```

After these checks pass, commit the single plan file and freeze the exact branch tip/tree and plan
SHA-256. One independent holistic reviewer examines the immutable tip for decision separation,
schema/command/DAG/matrix/traceability/Git freeze, and forbidden-scope escapes. Genuine Critical
or Important findings are combined into one fix wave, followed by one closure re-review. Minor
wording or future hardening notes are recorded and do not reopen a `0C/0I` closure.

The ready PR must remain plan-only and must not be self-merged. Its final report states the two
fresh heads/trees, CodeGraph stats/zero counts, graph anchors, plan digest, static test results,
review verdict, PR URL, and explicit non-actions: no controller created, no Claude Code or dynamic
cell run, and no Phase 3B implementation.
