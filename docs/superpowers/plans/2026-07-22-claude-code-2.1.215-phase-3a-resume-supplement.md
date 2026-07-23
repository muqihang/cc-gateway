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

### 5.1 Pinned sandbox and synthetic state

The future controller must create a new disposable supplement root under the separately approved
P3A evidence location. The exact runtime root is supplied as `P3A_SUPP_ROOT`; durable paths are
the fixed relative paths in Section 9. It must:

- bind wrapper/platform/release/entrypoint/tree digests from Section 3 and re-probe the version
  without accepting a floating tag;
- run only on Darwin arm64 with a loopback-only fake upstream bound to `127.0.0.1` or `::1`;
- set only synthetic placeholder auth values accepted by the existing manifest validator;
- use a synthetic placeholder transcript and state fixture whose durable representation is a
  safe state reference plus SHA-256, never bytes or decoded fields;
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

Every positive-candidate repetition has a dedicated creation run first:

```text
creation: p3as-resume-lineage-rNN-create
control:  p3as-resume-lineage-rNN-new
treatment:p3as-resume-lineage-rNN-resume
```

The treatment row must bind `creation_run_id`, `creation_run_sha256`,
`prior_state_safe_ref`, `prior_state_safe_digest`, `prior_state_artifact_digest`,
`resume_run_id`, `resume_run_sha256`, and the seed/order/repetition. The creation row is terminal
before treatment launch. The treatment may claim prior-state consumption only if both observers
independently bind the same creation digest and the treatment run is not a new-session fallback.

| cell family | positive/negative | required result |
| --- | --- | --- |
| `new-session-control` | positive control | complete bounded new-session request/stream, no predecessor, no resume claim |
| `resume-candidate` | positive candidate | prior safe state consumed, current request/stream topology agrees, terminal result agrees |
| `missing-predecessor` | negative | bounded deny/Unknown; no positive lineage row |
| `tampered-predecessor` | negative | digest mismatch deny before positive classification |
| `swapped-predecessor` | negative | same-schema state from another cell/run denied |
| `wrong-run-binding` | negative | creation/resume run or digest mismatch denied |
| `fresh-session-fallback` | negative | no prior-state consumption is classified as Unknown, never resume |
| `nonterminal-creation` | negative | incomplete creation cannot be a predecessor |
| `observer-disagreement` | negative | disagreement is terminal Unknown and disables the conclusion |
| `instrumentation-perturbation` | control | instrumented and uninstrumented safe topology must agree; alteration disables |

The negative corpus is not optional. A positive result inferred from the absence of a new
session request, from a matching session ID alone, or from a fallback path fails the run.

### 5.3 Two independent observers

Independence is an implementation property, not a label. The observers must have distinct capture
surfaces, executables, dependency graphs, configurations, and failure modes:

**Observer A: loopback semantic observer.** Extend the existing fake-upstream process only for
the supplement. It captures in memory and emits a safe digest-only result containing request AST
topology/digest, method/path class, header names/value classes, SSE event grammar, terminal class,
retry class, and bounded response classification. It never receives Observer B output and never
reads the state store.

**Observer B: Darwin state-access/process observer.** Build a separate supervisor executable with
its own source, dependency/toolchain digest, config digest, and write-only result pipe. It observes
the dedicated state root and the child process lineage through a Darwin filesystem/process
surface (the approved no-root `fs_usage`/process-sampling capability, or an independently
reviewed equivalent). It records only safe operation classes such as `open`, `stat`, `read`,
`close`, process parent/current safe refs, and state-root relative safe refs. It never parses HTTP,
JSON, SSE, prompts, bodies, or Observer A output.

The future preflight must prove that Observer B can classify a synthetic sentinel open/read and
that it does not require root. If that capability is unavailable, the supplement is BLOCKED; no
same-byte second parser or privileged workaround is allowed. Agreement is performed only by a
third terminal builder after both observers exit. It compares safe topology/lineage facts and
creation/resume digests, not raw observations.

For perturbation, run each positive cell once with no observer instrumentation and once with the
approved observers attached. The treatment outcome, fake-upstream topology digest, terminal
class, and state-consumption classification must remain equivalent. Any perturbation, missing
observer output, parser disagreement, or observer crash is `Unknown` and disables the row.

## 6. Safe schemas and field allowlist

All JSON is strict I-JSON, duplicate-key rejected, RFC 8785 JCS canonicalized, UTF-8 validated,
and written with a final LF. Object schemas use `additionalProperties:false`; schema validators
must reject unknown fields before semantic validation. Durable artifacts have no generation-time
clock field; issue/expiry values are bound input fields. Arrays are either explicitly ordered
sequences or sorted sets.

### 6.1 Allowed safe field families

The exhaustive durable allowlist is:

- `root_safe_ref`, `session_safe_ref`, `task_safe_ref`, `parent_safe_ref`, `current_safe_ref`;
- `parent_current_relation` and bounded `lineage_class`;
- `creation_run_id`, `creation_run_sha256`, `resume_run_id`, `resume_run_sha256`,
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

`oracle-lab-phase3a-supplement-cell-run.v1` contains exactly:

```text
schema_id, schema_major, schema_revision, record_kind, cell_id, run_id, arm,
seed, repetition, order_position, active_target, platform, architecture,
artifact_refs, creation_run_id, creation_run_sha256, predecessor_safe_ref,
predecessor_safe_digest, predecessor_artifact_digest, resume_run_id, resume_run_sha256,
observer_a_ref, observer_a_sha256, observer_b_ref, observer_b_sha256,
safe_result_digest, topology_digest, lineage_class, terminal_class, retry_class,
perturbation_class, evidence_level, parser_agreement, deny_code, payload_digest,
parent_node_ids
```

`creation_run_id` and predecessor fields are null only for the new-session control. The schema
requires a non-null, exact-matching predecessor tuple for a resume candidate; null, swapped, or
wrong-run values are typed negative outcomes, not omitted permissions.

`oracle-lab-phase3a-supplement-conclusion.v1` contains exactly:

```text
schema_id, schema_major, schema_revision, conclusion_id, phase3b_usable, level, scope,
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
`oracle-lab-phase3a-revalidated-conclusion.v1`, a new conclusion ID
(`CL-P3A-SUPP-R2-CONFIG-AUTH` and `CL-P3A-SUPP-R2-FAILURE-STREAM`), new issue/expiry fields,
the exact v13 predecessor conclusion digest, selected leaf digests, and a safe projection only.
The successor may narrow a claim, never expand or rewrite v13.

Selection is exact, not newest-by-time:

1. v13 remains the historical baseline and contradiction source.
2. A successor is eligible only if its path is under the supplement root, non-symlink, schema
   valid, digest-valid, unexpired at P3B-0, exact active artifact identity, exact predecessor
   digest, no open contradiction, and terminal/index/leak/exit/handoff bindings agree.
3. Exactly one eligible successor per conclusion family is required. Missing, expired, drifted,
   contradicted, parser-disagreeing, swapped, or duplicate eligible successors fail closed.
4. v13 is never overwritten. A digest mismatch, version relabel, or precedence ambiguity keeps
   both the original family and Phase 3B disabled.

## 8. Append-only artifact DAG

The edge direction is `node -> depends_on`; a node may reference only already-emitted nodes. A
real parser and Kahn topological sort must reject self-loop, two-node cycle, reverse edge, and
swapped-generation-order mutations. A DFS-only assertion is insufficient.

```json
{
  "nodes": [
    {"id":"pinned_inputs","stage":0},
    {"id":"creation_safe_state","stage":0},
    {"id":"observer_a_outputs","stage":1},
    {"id":"observer_b_outputs","stage":1},
    {"id":"cell_run_records","stage":2},
    {"id":"successor_conclusions","stage":3},
    {"id":"bounded_payload_index","stage":4},
    {"id":"leak_report","stage":5},
    {"id":"terminal_manifest","stage":6},
    {"id":"exit_report","stage":7},
    {"id":"handoff","stage":8},
    {"id":"external_digest_set","stage":9}
  ],
  "closure_order":["bounded_payload_index","leak_report","terminal_manifest","exit_report","handoff"],
  "index_scope":["pinned_inputs","creation_safe_state","observer_a_outputs","observer_b_outputs","cell_run_records","successor_conclusions"],
  "external_digest_set_scope":["bounded_payload_index","leak_report","terminal_manifest","exit_report","handoff"]
}
```

Required edges are: observers depend on pinned inputs and B additionally on the creation safe
state; cell records depend on pinned inputs, creation state, and both observer outputs;
conclusions depend on cell records; the bounded index depends on conclusions; leak depends on the
bounded index; terminal depends on index and leak; exit depends on index, leak, and terminal;
handoff depends on index, leak, terminal, and exit; external digest set depends on all five later
closure files. The five closure files do not reference the external digest set. This scope avoids
the hash cycle that would occur if the index included its own or later closure hashes.

## 9. Exact future output paths and bindings

All paths below are relative to the separately approved `P3A_SUPP_ROOT`; no absolute ephemeral
path is written inside an artifact.

| output | exact relative path | schema ID |
| --- | --- | --- |
| cell/run records | `capsules/P3A-S/cells/<cell_id>/run-record.json` | `oracle-lab-phase3a-supplement-cell-run@1.0` |
| revalidated CONFIG-AUTH | `normalized/P3A-S/conclusions/CL-P3A-SUPP-R2-CONFIG-AUTH.json` | `oracle-lab-phase3a-revalidated-conclusion@1.0` |
| revalidated FAILURE-STREAM | `normalized/P3A-S/conclusions/CL-P3A-SUPP-R2-FAILURE-STREAM.json` | `oracle-lab-phase3a-revalidated-conclusion@1.0` |
| resume conclusion | `normalized/P3A-S/conclusions/CL-P3A-SUPP-RESUME-LINEAGE.json` | `oracle-lab-phase3a-supplement-conclusion@1.0` |
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

## 10. Future implementation work packages

The following are implementation tasks for a later, separately approved P3A-S controller, not
work performed by this plan PR.

1. **P3AS-0 freeze and RED first:** freeze repositories, artifact identity, toolchain, exclusion,
   root policy, placeholder policy, and capability matrix. Add RED tests before implementation.
2. **P3AS-1 schema/codec:** add strict schemas, duplicate-key/JCS codec, safe-field scanner,
   relative-path validator, typed record writer, and deterministic digest helpers.
3. **P3AS-2 observers:** implement Observer A adapter and independent Darwin Observer B. Add
   implementation/config/dependency digests and no-root capability preflight. No observer shares
   a parser, capture library, result file, or normalized byte stream with the other.
4. **P3AS-3 cells:** add creation/new/resume paired runner using the existing manifest guard,
   fake upstream, process sampler, and bounded fixture. Add all negative controls and perturbation.
5. **P3AS-4 revalidation/convergence:** call existing c4 order/convergence semantics with the
   fixed seed, generate both successor families and resume conclusion only on `Reproduced`.
6. **P3AS-5 closure:** add DAG parser/topological sorter, bounded index, leak report, terminal,
   exit, handoff, external digest set, and exact path/digest/schema binding.
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
perturbation, and raw-material canaries.

DAG RED mutations are mandatory and explicit: self-loop, two-node cycle, reverse edge, swapped
generation order, orphan dependency, duplicate node ID, missing stage, and later-closure hash
inserted into the bounded index.

Command-chain mutations must deny before child execution for missing/wrong config, wrong config
digest, wrong root, unsupported operation, dangerous Git environment, wrong head/tree/remote,
tracked dirt, protected CodeGraph count nonzero, protected path in the file list, forbidden
package-wide test command, implicit child runner, missing fixed artifact, swapped fixed artifact,
schema mismatch, path escape, symlink, digest mismatch, expiry, and closure binding mismatch.

### 11.2 Future command ladder

These commands are future P3A-S commands and were not run in this planning task:

```bash
npm exec tsx tests/oracle-phase3a-resume-supplement.test.ts
npm exec tsx tests/oracle-phase3a-usable-revalidation.test.ts
npm exec tsx tests/oracle-phase3a-prior-state-controls.test.ts
npm exec tsx tests/oracle-phase3a-observer-independence.test.ts
npm exec tsx tests/oracle-phase3a-closure-dag.test.ts
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
2. The pinned 2.1.215 identity and all five v13 path/SHA/schema bindings match exactly.
3. Both v13 usable families have one exact append-only unexpired successor with the v13
   predecessor digest; no successor ambiguity or contradiction exists.
4. Creation, new-session, and resume cells converge with six repetitions and both order
   directions; all mandatory negative controls deny or remain Unknown.
5. Observer A and B independently demonstrate prior-state consumption and agree on safe topology,
   lineage, run IDs, and digests. Observer perturbation is equivalent.
6. Only safe typed fields are present; generated-only leak scan is PASS with zero findings.
7. The real DAG parser accepts the valid graph and rejects every RED DAG mutation.
8. The five closure artifacts and external digest set are byte-deterministic across two isolated
   roots and have identical logical digests.
9. Only `Reproduced` can enable `phase3b_usable=true`; all Unknown/Observed-local/Negative rows
   remain disabled.
10. One consolidated independent review finds zero Critical and zero Important issues.

Stop immediately and publish the exact deny code/input digest on: missing evidence capability,
Observer B unavailable, observer dependence/disagreement, nonconvergence, instrumentation
perturbation, artifact identity drift, digest/schema mismatch, raw leak, protected-boundary
violation, external socket attempt, or resource exhaustion. Ordinary test defects receive one
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
| `HA-P1-001` | observer independence test and implementation/config digests | distinct capture surfaces, dependencies, result channels, and failure modes are proven |
| `HA-P1-002` | convergence output and `oracle-phase3a-convergence.test.ts` | six repetitions, balanced order, stable leaves, no unresolved lineage leaf |
| `HA-P1-003` | bounded error/deny codes; mutation tests; leak report | malformed, missing, contradictory, and unsafe input fails closed with stable code |
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
exclusion proof, pinned artifact refs, v13 five-piece bindings, both revalidated successor
bindings, resume conclusion digest/schema/level/expiry, cell/run/convergence summaries, observer
implementation/config/dependency digests, DAG/topological result, leak result, terminal/exit/
handoff/external digest-set bindings, mutation results, deterministic regeneration comparison,
negative-capability list, resource usage, and changed-file inventory.

The next action after this plan PR is a fresh independent plan review. Only after zero Critical,
zero Important findings and plan merge may a separately approved P3A-S execution controller run.
Only after the supplement is complete, independently reviewed, and selected by exact path/digest/
schema may Phase 3B create a new execution controller. No dynamic supplement or Phase 3B
implementation ran for this plan.

## 15. Planning self-checks

Run only document/static checks in this plan task:

```bash
PLAN=docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3a-resume-supplement.md
test -s "$PLAN"
! rg -n 'T[O]DO|T[B]D|FIXM[E]|@lates[t]' "$PLAN"
rg -n 'BLOCKED|CL-P3A-SUPP-RESUME-LINEAGE|phase3b_usable|RA-P0-001|RA-P1-004|HA-P1-001|HA-P1-002|HA-P1-003' "$PLAN"
rg -q 'openai_compact_sse_keepalive_test.go' "$PLAN"
rg -q 'self-loop.*two-node cycle|two-node cycle.*reverse edge|swapped.*generation' "$PLAN"
rg -q 'P3A_SUPP_ROOT|closure-digest-set-v1.json|oracle-lab-phase3a-supplement-handoff@1.0' "$PLAN"
git diff --check
```

No command in this task may invoke Claude Code, any P3A-S future command, `go test ./...`,
`go test ./internal/service`, a package-wide runner, or a production/runtime path. The final PR
must contain only this plan file; local CodeGraph files remain ignored and unstaged.
