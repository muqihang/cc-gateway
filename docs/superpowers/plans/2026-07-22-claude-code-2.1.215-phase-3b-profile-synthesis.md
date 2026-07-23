# Claude Code 2.1.215 Oracle Lab Phase 3B Profile Synthesis Plan

> **Plan-only status (2026-07-22):** this document authorizes no Phase 3B implementation,
> production path, runtime enforcement, profile promotion, deployment, real upstream, real
> credential, or canary. `Phase 3B` is canonical; `3.5` is a durable alias, not an eighth
> top-level phase. The current Phase 3B entry is **BLOCKED** by the resume/lineage evidence gate
> in Section 7.2. A fresh independent plan review and plan merge are required before a new
> execution controller is created.

## 1. Decision and scope

This plan converts the current Phase 2 contract and the reviewed, de-identified Phase 3A handoff
into a future deterministic profile compiler, generated CC Gateway/Sub2API artifacts, typed
fixtures, and local loopback conformance checks. It deliberately does not wire any artifact into
`startProxy`, `handleRequest`, Sub2API scheduling, sidecar transport, DNS, sockets, readiness
propagation, replay storage, or account lifecycle runtime.

The planning decision is:

1. The two and only two usable Phase 3A conclusions are
   `CL-P3A-R2-CONFIG-AUTH` and `CL-P3A-R2-FAILURE-STREAM`.
2. Compact/cache lifecycle, positive telemetry/update behavior, restart/resume/child lineage,
   provider TLS equivalence, Linux/Windows runtime behavior, and incomplete Tier-A pairs for
   `2.1.214`, `2.1.212`, and `2.1.211` remain explicit negative capabilities.
3. New-session streaming and bounded local failure/stream fixtures are eligible for future
   compilation, subject to schema-valid safe-field extraction from those two conclusion rows.
4. Resumed-session streaming is not supported by the current handoff. It is a hard blocked row,
   not a value to infer from new-session or `2.1.208` child-lineage evidence.
5. The future implementation is a paired CC Gateway/Sub2API change. The plan PR changes only this
   document in CC Gateway; Sub2API remains unchanged until a post-merge execution controller opens
   a paired implementation PR.
6. Local compiler success is not profile promotion. Phase 4 owns runtime enforcement and Phase 6A
   owns the signed full-chain local staging bundle and zero-external-socket proof.

### 1.1 Planning artifacts versus future implementation outputs

| Class | Produced by this planning task | Produced only by a future Phase 3B controller |
| --- | --- | --- |
| Authoritative plan | this file | no |
| Fresh baseline and CodeGraph observations | reported in this file and PR description | independently re-frozen, not trusted from planning alone |
| Product/compiler code | no | TypeScript compiler/validators and Go validators |
| Generated profiles/configuration | no | canonical generated artifacts under the paths in Section 9 |
| Typed fixture corpus | no | de-identified JSON fixtures and mutation corpus |
| Runtime wiring | no | not Phase 3B; remains Phase 4 |
| Signed staging/canary output | no | not Phase 3B; remains Phase 6A/6B |

## 2. Governing inputs and precedence

Conflicts resolve in this order:

1. the active operator scope and safety boundary for this planning task;
2. `docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md`;
3. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md`;
4. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-adversarial-validation-v2.md`;
5. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-design.md`;
6. `docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md`;
7. `docs/superpowers/plans/2026-07-19-claude-code-2.1.215-phase-2-normative-compatibility.md` and
   `docs/superpowers/2026-07-19-claude-code-2.1.215-phase-2-handoff.md` for the merged P2 state;
8. the external Phase 3A v13 handoff bindings in Section 4.

Review Amendments Section 4 is normative for Phase 3B. In particular, unsupported behavior being
safely disabled is insufficient for exit; all five minimum cases must pass truthfully. The
historical text names a `2.1.207` candidate while the merged Phase 2 active-target overlay and this
task name `2.1.215` and retain `2.1.207` only as a reference role. The independent PR #39 review
resolved this authority question: the merged active-target overlay validly parameterizes the
Section 4.4 candidate version to `2.1.215`; `2.1.207` remains historical/reference-only and is not
an additional usable-input requirement. No `2.1.207` observation may be copied onto `2.1.215`, and
no `2.1.215` conclusion may be relabeled as `2.1.207`. Any such relabel is a stable deny.

## 3. Fresh planning baseline

The following heads were fetched from `muqihang/main` on 2026-07-22 and inspected in new planning
roots. A future implementation controller must fetch again and must not assume these remain
current.

| Repository | Planning root | Fresh `muqihang/main` head | Tree | State before planning-local indexes |
| --- | --- | --- | --- | --- |
| CC Gateway | `/Users/muqihang/chelingxi_workspace/cc-gateway-phase3b-plan-215` | `6192a0fea87975e29c1486b2285ce6b7a9f06906` | `8903d7bab2e3aeade3a88b9b601037ef834f7b1c` | clean worktree from PR #38 merge |
| Sub2API | `/Users/muqihang/chelingxi_workspace/sub2api-phase3b-plan-215` | `fb840673afc0ff590fef9bb147fce5b9b70eb098` | `eeb8654eddf7a4c38364202f5024161e65d2a6d1` | clean clone from PR #7 merge |

CodeGraph 1.1.6 was rebuilt in both roots. The protected
`backend/internal/service/openai_compact_sse_keepalive_test.go` path was excluded before Sub2API
indexing and was not directly opened or searched during discovery. It was never modified, staged,
or committed. One initial planning invocation of the existing P2 joint CLI indirectly ran
package-wide `go test ./internal/service`; the Go tool therefore compiled every test in that
package, so this planning run cannot claim a strict zero-read attestation for the protected file.
No file content was displayed. All subsequent checks, and every future command in Section 12, use
explicit P2 file lists or the dedicated `internal/oracleprofile` package to prevent recurrence.

| Repository | Files | Nodes | Edges | Status |
| --- | ---: | ---: | ---: | --- |
| CC Gateway | 262 | 9,229 | 32,322 | up to date |
| Sub2API | 3,064 | 98,766 | 322,427 | up to date; CLI reports an engine-improvement reindex notice despite the fresh build |

The merged Phase 2 contract index is byte-identical in both repositories:

```text
oracle.compatibility.v1 contract-index SHA-256
2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce

Phase 1 predecessor SHA-256
70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1

supported schema range
1:0-0
```

## 4. External Phase 3A v13 binding

Phase 3B must bind the existing safe handoff by path and digest. It must not copy, regenerate, or
walk raw Phase 3A evidence. The authoritative planning bindings are:

| Artifact | Absolute existing path | SHA-256 | Exact `schema_version` |
| --- | --- | --- | --- |
| P3A exit v13 | `/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-4/phase-3a-exit-report-v13.json` | `57f16b207933b3a751f96471733d435fa4b0c9801fbef2f5495e8884dfe0bd1b` | `oracle-lab-phase3a-exit.v1` |
| P3A/3.5 handoff v13 | `/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-4/phase-3b-3.5-handoff-v13.json` | `9d188072719dc27a2f9cc9939bc79afa598802b84dd4d9161fb1da3263a792d7` | `oracle-lab-phase3a-handoff.v1` |
| terminal manifest v8 | `/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-4/closure-terminal-manifest-v8.json` | `c9ee57fbe29125c88278961565f814326b052077b861bb41008cdde6161f12f5` | `oracle-lab-phase3a-r4-terminal.v1` |
| artifact index v23 | `/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-4/artifact-index-v23.json` | `e8645c7ed4bc984a926f91e3df1b756c4b009b3a02408de213cbe81b060e80d4` | `oracle-lab-phase3a-artifact-index.v1` |
| leak scan v23 | `/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-4/leak-scan-v23.json` | `7ed3e2776c7fcc47d6c8d513318b33547919c92a33a068a4f0c0cb3706bad145` | `oracle-lab-phase3a-leak-scan.v1` |

The terminal manifest is GREEN and the leak scan is PASS with zero findings. This means the P3A
closure package is internally complete; it does not mean every Claude behavior is classified.
The handoff's only candidate input rows are:

```json
[
  {"conclusion_id":"CL-P3A-R2-CONFIG-AUTH","phase3b_usable":true},
  {"conclusion_id":"CL-P3A-R2-FAILURE-STREAM","phase3b_usable":true}
]
```

The v13 usable rows both expire at `2026-08-03T00:00:00Z`. They remain the immutable historical
baseline but are not sufficient as selected Phase 3B inputs after expiry. Before the resume row may
unblock Phase 3B, the separately approved supplement must independently revalidate
`CL-P3A-R2-CONFIG-AUTH` and `CL-P3A-R2-FAILURE-STREAM` against the same pinned `2.1.215` Darwin
arm64 artifact. Each revalidation emits a new append-only normalized-safe artifact with a new
conclusion ID, source relative path, SHA-256, schema ID/version, evidence level, issue time, and
expiry; no v13 byte or row is overwritten or relabeled.

Selected-input precedence is exact: v13 remains the historical source and contradiction baseline;
the newest independently reviewed, unexpired append-only revalidation of the same conclusion
family is selected only when its predecessor is the exact v13 conclusion digest, its pinned
artifact identity is unchanged, its safe projection is schema-valid, and the supplement terminal,
index, leak, exit, and handoff bindings all agree. No newest-by-time fallback is permitted. Missing
revalidation, expiry at P3B-0, snapshot/artifact drift, predecessor mismatch, digest mismatch, open
contradiction, parser disagreement, or multiple eligible successors denies selection and keeps
Phase 3B BLOCKED.

The compiler must verify the five v13 hashes plus every selected supplement/revalidation hash,
schema validity, expiry, conclusion IDs, and `phase3b_usable: true` before reading safe conclusion
projections. It must reject a path outside the bound evidence root, a symlink, digest mismatch,
unknown row, expired row, contradiction, parser disagreement, or an attempt to traverse supporting
raw artifacts.

## 5. Requirement traceability

| Requirement | Phase 3B interpretation | Planned gate/output |
| --- | --- | --- |
| `RA-P0-001` | deterministic evidence-to-profile compiler | P3B-2 compiler, repeat-build byte equality, bundle digest |
| `RA-P0-002` | at least one truthful complete candidate; negative-only completion forbidden | five-case coverage gate; currently blocked on usable-row revalidation and resume only |
| `RA-P0-005` | preserve the P2 versioned cross-project contract/readiness vocabulary | exact P2 digest/range binding and paired TS/Go artifacts; no P2 in-place mutation |
| `RA-P0-007` | bounded response/failure/retry facts | de-identified failure/stream profile and conformance fixtures only; runtime OutcomeEnvelope remains Phase 4 |
| `RA-P0-009` | protected production remains disabled | generated negative manifest includes production, canary, real upstream, and protected runtime denies |
| `RA-P1-001` | build/version change-point coverage is evidence-bound | pinned `2.1.215` active-target identity plus reference-only `2.1.207`; cross-version relabel mutation denies |
| `RA-P1-002` | coherent build/request/response/control/auth/transport outputs | one evidence-bound tuple graph; no mixed refs or handwritten upstream-visible constants |
| `RA-P1-003` | typed de-identified fixtures and bounded drift facts | typed request/response/state/failure fixtures and mutation corpus; no raw values |
| `RA-P1-004` | lineage and migration contract | generated fail-closed lineage profile; resume stays disabled until supplement; runtime state machine remains Phase 4 |
| `RA-P1-007` | liveness/readiness/capability generations | generated readiness expectation artifact only; no endpoint or scheduling wiring |
| `RA-P1-008` | telemetry/update claims remain evidence-bounded | negative-capability manifest denies positive telemetry/update; Unknown cannot produce a control-plane route |
| `HA-P0-001`, `HA-P0-002`, `HA-P0-004` | registry, precedence, and fresh baseline truthfulness | input binding, current heads, immutable requirement mapping |
| `HA-P0-003` | claim ceilings prevent evidence overreach | per-field provenance and selected-input allowlist reject a field above its source evidence level |
| `HA-P0-006` | shared contract discovery | P2 contract digest/range/predecessor check |
| `HA-P0-009` | negative capability is explicit and fail closed | missing/Unknown/unsupported/expired/contradicted input denies generation |
| `HA-P1-001` | claims require independent dynamic observation | supplement observers use separate implementations/dependencies and must agree on prior-state consumption |
| `HA-P1-002` | lifecycle/resume needs reproduced evidence | resume supplement hard gate and convergence criteria |
| `HA-P1-003` | bounded safe error classification | stable compiler/validator error codes and leak-canary mutation tests |
| `OL-LEGACY-001` | legacy/reference tuple is comparison-only | no mutation or promotion of a legacy tuple |
| `AV-B4-001`, `AV-B5-001`, `AV-B6-001` | direct egress, sidecar auth/replay, and destination runtime remain RED/deferred | negative entries only; no Phase 4 implementation or GREEN claim |

Registry status is not rewritten by plan or compiler generation. The future exit handoff may
propose evidence references for Phase 3B-owned rows, but a separate reviewed registry update owns
status transitions.

## 6. Current code and call-path anchors

These anchors come from the fresh CodeGraph indexes, not historical P3A/P1 context.

### 6.1 CC Gateway

| Concern | Current path/symbol | Current call/ownership fact |
| --- | --- | --- |
| config load/validation | `src/config.ts::loadConfig` (line 590), `validateFormalPoolMode` (366) | `src/index.ts` loads config; current profile-like values remain YAML/handwritten and runtime owned |
| persona/profile selection | `src/persona-resolver.ts::resolvePersonaDecision` (72), `src/persona-registry.ts::resolvePersonaProfileId` (202) | invoked from the proxy request path; must not be wired by Phase 3B |
| TLS profile | `src/egress-tls-profile.ts::TLSProfileConfig`, sidecar `internal/profile/profile.go::Profile` | config and TLS engine consumers exist; provider equivalence remains Unknown |
| request transport | `src/direct-upstream-request.ts::requestDirectUpstream`, `src/proxy.ts::startProxy`/`handleRequest` | live transport boundary; explicitly out of Phase 3B |
| P2 types/admission | `src/oracle-contract/types.ts::BehaviorCoherenceCertificate`, `admission.ts::decideBehaviorAdmission` (100) | CodeGraph finds only `tests/oracle-contract-admission.test.ts` as caller; pure/test-only today |
| negative capability | `src/oracle-contract/admission.ts::negativeDecision` (54) | denies matching model, beta, transport, entrypoint, fallback, feature, or authority state |
| canonical hash | `src/oracle-contract/canonical.ts::canonicalizeJsonValue`, `sha256Hex`; `tools/oracle-contract/check-shared-contract.ts::sha256Bytes` (42) | existing RFC 8785 and SHA-256 helpers are the required base |
| existing output/index writer | `tools/oracle-lab/phase3a/artifact-index.ts::buildArtifactIndex` (80), `writeArtifactIndex` (106) | canonical exclusive-create pattern is reusable; its filesystem `mtime` field is not suitable for deterministic Phase 3B output |
| existing manifest reader/writer boundary | `tools/oracle-lab/phase3a/launch-manifest.ts::LaunchManifest`, `loadLaunchManifest`; `build-exit.ts::CuratedExitInput` | safe schema/digest input pattern; Phase 3B binds summaries and never traverses raw evidence |
| rollback/expiry | `src/oracle-contract/manifest-authority.ts::verifyManifestAuthorityUpdate` (217), `trustStateDigest` (159) | verifies expiry, parent, rollback floor/target, dependency invalidation, checkpoint and generation |
| cross-project state | `src/oracle-contract/cross-project.ts::decideReadiness` (102), `transitionLifecycle` (159), `decideTaskLineage` (213), `decideOutcome` (257) | pure P2 interfaces; runtime propagation is Phase 4/5 |
| shared bundle | `tools/oracle-contract/check-shared-contract.ts::checkSharedContract` (167) | checks byte-identical mirrors, index order/digests, predecessor digest |
| TS/Go boundary | `tools/oracle-contract/check-cross-repo.ts::checkCrossRepoContract` (76) | called by CLI and `tests/oracle-contract-cross-repo.test.ts`; runs focused TS/Go checks |
| fake upstream | `tools/oracle-lab/phase3a/observers/fake-upstream.ts::startFakeUpstream`, `requestFacts` (161) | loopback-only request/JSON/SSE/failure observer pattern; reuse only safe typed scenarios |

### 6.2 Sub2API

| Concern | Current path/symbol | Current ownership fact |
| --- | --- | --- |
| Go contract types | `backend/internal/service/oracle_contract_types.go` | Go mirror of P2 certificate, gates, signals, and negative capability objects |
| Go admission | `backend/internal/service/oracle_contract_admission.go::DecideOracleBehaviorAdmission` (154) | pure validator/decision function with focused tests; not a scheduler hook |
| Go canonical hash | `backend/internal/service/oracle_contract_canonical.go::CanonicalizeOracleJSON` (166) | strict duplicate/UTF-8/surrogate/number/trailing-data validation plus JCS/SHA-256 |
| Go authority | `backend/internal/service/oracle_contract_authority.go::VerifyOracleManifestAuthorityUpdate` (272) | matches expiry, rollback, invalidation, checkpoint, and generation semantics |
| Go readiness | `backend/internal/service/oracle_contract_cross_project.go::DecideOracleReadiness` (127) | pure P2 cross-project decision; no Phase 3B runtime wiring |
| P2 mirror | `backend/internal/service/testdata/oracle_lab_contract/v1/` | byte-identical nine-file mirror of `contracts/oracle-lab/v1/` |
| focused tests | `oracle_contract_{canonical,admission,authority,cross_project}_test.go` | exact future regression anchors |

The protected keepalive test is not an anchor and must remain outside every Phase 3B command,
file list, search, mutation, and diff.

## 7. Candidate coverage matrix and hard gates

### 7.1 Minimum exit cases

| Minimum case | P3A usable source | Exact future typed fixture | Planning verdict | Future acceptance |
| --- | --- | --- | --- | --- |
| new session + streaming Messages | selected append-only revalidations of `CL-P3A-R2-CONFIG-AUTH` and `CL-P3A-R2-FAILURE-STREAM`, with v13 as predecessor baseline | `fixtures/new-session-streaming.json` | **ELIGIBLE only after revalidation**, not yet implemented | request profile, auth profile, complete SSE grammar, terminal class, tuple refs, TS/Go digest all pass |
| resumed session + streaming Messages | no usable row; `CL-P3A-RESUME-LINEAGE-UNKNOWN` is explicitly non-usable | `fixtures/resumed-session-streaming.json` | **BLOCKED** | only a separately approved P3A supplement may populate the fixture; otherwise fixture is a negative rejection case |
| bounded response failure/recovery | selected append-only revalidation of `CL-P3A-R2-FAILURE-STREAM`, with v13 as predecessor baseline | `fixtures/bounded-failure-recovery.json` | **ELIGIBLE only after revalidation**, not yet implemented | HTTP failure, reset, partial stream, complete stream, retry-owner and terminal/no-retry expectations agree |
| deterministic regeneration | exact v13 bindings + selected revalidations + approved resume supplement + P2 bundle | `fixtures/deterministic-regeneration.json` | **STRUCTURAL GATE** | two isolated compiler runs produce identical file set, JCS bytes, modes, and bundle digest |
| TS/Go/manifest/typed-fixture agreement | v13 rows, approved supplement, and P2 bundle; no additional Claude behavior claim | all three fixtures plus `bundle-index.json` | **STRUCTURAL GATE** | TS and Go validators return identical allow/deny codes and digests for every positive/mutation row |

No case is GREEN during planning. A generated negative resume fixture is useful for fail-closed
testing but cannot satisfy the positive resumed-session exit row.

### 7.2 Smallest separately approved resume supplement

Phase 3B remains blocked until a separate P3A supplement produces one new conclusion row such as
`CL-P3A-SUPP-RESUME-LINEAGE` with `phase3b_usable: true`. The supplement is not part of this plan
PR and requires its own approval because it executes P3A evidence work.

Minimum supplement scope:

1. Use the already pinned `2.1.215` Darwin arm64 artifact and a new isolated loopback-only ephemeral
   session-state fixture. Persist only typed safe refs and hashes, never raw session state or
   prompts. The fixture is destroyed under the supplement's separately approved evidence policy;
   Phase 3B receives no state bytes.
2. Before resume observation, independently revalidate both
   `CL-P3A-R2-CONFIG-AUTH` and `CL-P3A-R2-FAILURE-STREAM` as append-only normalized-safe successors
   with updated expiry and exact v13 predecessor conclusion digests. A successor may narrow a claim
   but may not silently expand, rewrite, or replace v13.
3. Run paired new/resume controls from the same synthetic placeholder transcript, with seeded order,
   perturbation controls, the existing convergence rule, and these two independent observers:
   - **Observer A, loopback semantic observer:** an application-level fake-upstream process records
     normalized request AST topology/digest, header name/value-class facts, SSE grammar, terminal
     class, and retry class. It never receives Observer B output.
   - **Observer B, Darwin process/filesystem observer:** a separately built supervisor records only
     process parent/current safe refs, ephemeral prior-state open/access class, pre-open content
     digest, and local process lineage. It does not parse HTTP, JSON, SSE, or Observer A output.
   Independence requires different executable digests, no shared observation library, no shared
   parser, unidirectional write-only result files, separately recorded dependency/toolchain digests,
   and agreement performed only by the terminal builder after both observers exit.
4. Every resume cell binds `prior_state_creation_run_id`, `prior_state_safe_digest`,
   `prior_state_artifact_digest`, `resume_run_id`, `resume_run_digest`, seed/order cell ID, and the
   exact safe result digests from both observers. The prior-state digest must be created by the
   paired new-session control and consumed by the resume run; a run ID or artifact mismatch denies.
5. Run missing, one-byte-tampered, and same-schema-but-swapped predecessor controls. Each must
   produce a bounded deny/Unknown result with no positive resume conclusion. Fresh-session fallback,
   nonterminal execution, observer disagreement, inferred consumption, or run mismatch is Unknown
   and therefore denies `phase3b_usable`.
6. Capture only root/session/task safe refs, parent/current relation, client/profile generation,
   request class, header-name/value-class summary, request AST topology/digest, SSE event grammar,
   terminal class, retry class, local process lineage, and the run/digest bindings above.
7. Emit append-only, schema-valid, unexpired, contradiction-free normalized-safe conclusions and
   closure artifacts in the one-way DAG below. A leaf cell/run envelope contains only pinned input
   digests, predecessor safe-state digest/run ID, observer-output digests, and a `payload_digest`
   over its canonical payload; it contains no index/leak/exit/handoff/terminal digest. Its file
   digest is assigned externally after the envelope bytes exist. A conclusion aggregates only
   already-existing leaf file digests and never references a closure artifact.
8. Preserve all other v13 Unknown rows. The supplement does not authorize restart migration,
   child-process lineage, compact/cache, telemetry/update, provider TLS, or other platforms.

The DAG uses `node -> depends_on`; every dependency must already exist before its node is emitted.
The artifact index covers immutable supplement payload only: pinned-input identities, observer
results, leaf envelopes, and conclusions. It excludes itself and the later leak, exit, handoff,
terminal, and external digest-set files. Generation order for the five closure files is uniquely
`artifact_index`, `leak_report`, `exit_report`, `handoff`, `terminal_manifest`. A separately reviewed
external digest set is created last and binds all five path/SHA-256/schema identities; none of the
five references that external set.

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

Supplement acceptance command names are future P3A-owned commands, not commands to run in this
planning task:

```bash
npm exec tsx tests/oracle-phase3a-resume-supplement.test.ts
npm exec tsx tests/oracle-phase3a-usable-revalidation.test.ts
npm exec tsx tests/oracle-phase3a-prior-state-controls.test.ts
npm exec tsx tests/oracle-phase3a-observer-independence.test.ts
npm exec tsx tests/oracle-phase3a-closure-dag.test.ts
npm exec tsx tests/oracle-phase3a-convergence.test.ts
npm exec tsx tests/oracle-phase3a-r4-terminal.test.ts
npm exec tsx tests/oracle-phase3a-leak-guard.test.ts
```

If this supplement is not separately approved or cannot produce a usable conclusion, Phase 3B
stays BLOCKED. The implementation controller must stop; it may not weaken the exit gate.

## 8. Logical schemas and evidence provenance

All generated JSON is strict I-JSON and RFC 8785 JCS. Unknown fields, duplicate keys, invalid
UTF-8, lone surrogates, negative zero, unsafe integers, floats where integers are required, and
trailing data are rejected. Artifact files contain no wall-clock generation time; evidence issue
and expiry values are copied as source fields so identical inputs regenerate identical bytes.

### 8.1 Input binding

`Phase3BInputBinding.v1` contains exact repository heads/trees, P2 bundle/range/predecessor,
external handoff/exit/terminal/index/leak paths and digests, selected append-only revalidation and
resume conclusion paths/digests/schemas, usable conclusion IDs, claim ceilings, compiler schema
version, and a sorted negative-capability list. `phase3b-input-binding.schema.json` requires every
safe payload input to contain `{relative_path, sha256, schema_id, schema_major, schema_revision,
evidence_level, conclusion_id, issued_at_ms, expires_at_ms, predecessor_digest}`. Normalized-safe
observer/leaf/conclusion inputs must be present in the independently reviewed artifact index. The
five closure artifacts are the sole exception: they are not index entries and must instead match
the final external digest set plus P3B-0's independent path/SHA/schema/root verification. Directory
walking and implicit supporting-artifact discovery are forbidden. Generated distributable
artifacts retain only safe relative evidence IDs and digests.

Every artifact class has its own exact schema. Schemas use `additionalProperties: false`, require
all listed keys, reject duplicate keys before schema validation, sort object keys by RFC 8785, and
declare every array as either an order-significant sequence or a set sorted by its stable key.
Reordering a sequence is a semantic mutation; noncanonical set ordering is rejected rather than
silently normalized during validation.

| Artifact | Required schema | Array/order rule and canonical identity |
| --- | --- | --- |
| all profile variants | `profile.schema.json` | strict `artifact_kind` discriminator for client-build/request/response/control/transport/authentication/session-lineage; profile refs sorted by kind; JCS SHA-256 |
| all typed fixture variants | `fixture.schema.json` | strict `fixture_kind` discriminator for new-session/resumed-session/failure-recovery/deterministic-regeneration; semantic event sequences retain order; JCS SHA-256 |
| input binding | `phase3b-input-binding.schema.json` | inputs sorted by `(conclusion_id, relative_path)`; JCS SHA-256 |
| field provenance | `field-provenance.schema.json` | unique rows sorted by JSON Pointer; JCS SHA-256 |
| negative capabilities | `negative-capabilities.schema.json` | unique stable IDs sorted lexically; JCS SHA-256 |
| coherent tuples | `coherent-tuples.schema.json` | unique tuple IDs sorted lexically; profile refs sorted by artifact kind; JCS SHA-256 |
| CC/Sub2API config projections | `config-projection.schema.json` | sequence/set arrays declared separately; both bind one tuple digest; JCS SHA-256 |
| rollback tuple | `rollback-tuple.schema.json` | target refs sorted by artifact kind; JCS SHA-256 |
| bundle index | `bundle-index.schema.json` | files sorted by relative POSIX path; aggregate digest over ordered `(path, digest, mode)` rows |

Unknown field, missing field, duplicate key, unsupported schema revision, wrong set order,
reordered sequence, absolute path, unindexed normalized-safe path, or path/schema/digest
disagreement is a stable deny before generation.

`bundle-index.json` contains a schema registry row for every schema in the table:
`{schema_id, schema_digest, artifact_kinds}`. The compiler, generated manifest, TS validator, Go
validator, each artifact, and the bundle index must resolve the same exact schema ID/digest. Profile
and fixture variants receive the complete parser and semantic mutation corpus; they are not covered
by a weaker generic-object check.

### 8.2 Profile artifacts

Every profile object requires:

```text
schema_id, schema_major, schema_revision, artifact_kind, artifact_id
active_target_version, reference_role_version, platform, architecture, installation_mode, entrypoint
evidence_level, evidence_conclusion_ids, evidence_artifact_digests
issued_at_ms, expires_at_ms, contradiction_ids, parser_agreement
contract_digest, manifest_payload_digest, profile_generation
negative_capability_refs, rollback_profile_digest
```

`evidence_level` is one of `Reproduced`, `Observed-local`, `Unknown`, or `Negative`. Only
`Reproduced` safe fields from `phase3b_usable: true` rows may enable a positive local capability.
`Observed-local` may describe a non-authorizing summary. `Unknown` and `Negative` always disable.

### 8.3 Per-field source map

The compiler emits `field-provenance.json`, sorted by JSON Pointer. Every generated leaf has one
entry: `{pointer, evidence_level, source_kind, source_id, source_relative_path, source_digest,
source_schema_id, source_schema_revision, transform}`. `source_relative_path` must be one exact
normalized-safe path allowlisted by the selected artifact index and `source_digest` must match its
bound bytes. The following families are exhaustive; adding a leaf without a provenance row, using
an unindexed path, or traversing from a safe artifact into a raw-support path is a schema failure.

| Generated field family | Evidence level | Allowed source | Rule |
| --- | --- | --- | --- |
| package/version/artifact/entrypoint digest, Darwin arm64/platform/install mode | `Reproduced` | exact indexed normalized-safe artifact identity path/digest/schema | exact copy of safe fields; no floating tag |
| build timestamp category, UA and `x-stainless-*` values | `Reproduced` only if present in an indexed normalized-safe usable projection; otherwise `Unknown` | exact selected projection path/digest/schema | missing values remain disabled; never handwritten |
| request method/path/query/header classes/body AST/final-byte digest | `Reproduced` only if explicitly present | exact selected normalized-safe conclusion projection path/digest/schema | absent support, including absent request AST support, remains Unknown/disabled; raw prompt/body forbidden |
| response headers/SSE ordering/partial/complete/error/terminal classes | `Reproduced` | `CL-P3A-R2-FAILURE-STREAM` | no response bytes persisted; typed placeholders only |
| config precedence and placeholder auth lifecycle | `Reproduced` | `CL-P3A-R2-CONFIG-AUTH` | only placeholder credential class; no account or token material |
| control-plane positive telemetry/update | `Unknown`/`Negative` | `CL-P3A-TELEMETRY-UPDATE-UNKNOWN` via v13 negative list | policy is suppress/block locally; no positive route invented |
| transport local loopback behavior | `Observed-local`/`Reproduced` as present | usable local-loopback rows | `provider_tls_equivalent=false`; no provider ClientHello/TLS constants |
| compact/cache lifecycle | `Unknown`/`Negative` | `CL-P3A-COMPACT-CACHE-UNKNOWN` | capability disabled |
| resume/restart/child lineage | `Unknown`/`Negative` until supplement | `CL-P3A-RESUME-LINEAGE-UNKNOWN` | positive resume tuple forbidden |
| Linux/Windows runtime | `Unknown`/`Negative` | `CL-P3A-CROSS-PLATFORM-UNKNOWN` | Darwin arm64 tuple cannot claim cross-platform behavior |
| P2 schema/range/gates/negative semantics | contract fact | P2 bundle digest `254511...` | preserve schema `1:0-0`; do not edit P2 files in place |
| generation/rollback/expiry/contradiction fields | contract fact plus source evidence | P2 authority semantics plus selected profile/rollback evidence paths | monotonic generation; exact profile predecessor digest; P2 contract digest is never a profile digest; expired/open contradiction denies |
| production/canary/protected sidecar/destination/replay | `Negative` | `RA-P0-009`, `AV-B4/B5/B6`, current deferred runtime state | always disabled in Phase 3B artifacts |

### 8.4 Coherent allowed tuple

`coherent-tuples.json` is a sorted array. A tuple binds the complete set of profile digests,
contract/manifest/input digests, client/profile generations, P2 four-gate results, expiry, negative
manifest digest, rollback target, and fixture digests. A field may not be selected independently
from another tuple. Any missing positive declaration, mixed generation, mismatched platform,
expired evidence, open contradiction, or matching negative rule denies the tuple.

The initial future positive scope is at most:

```text
active target: 2.1.215
platform: darwin
architecture: arm64
installation/source scope: exactly as bound by P3A v13
network: local loopback fake upstream only
auth: synthetic placeholder class only
session: new session only until supplement
response: reproduced bounded local stream/failure classes
```

### 8.5 Negative-capability manifest

`negative-capabilities.json` contains stable IDs, reason, source conclusion/requirement, affected
profile pointers, failure action (`disable` or `rollback`), and expiry/revalidation condition. At
minimum it lists compact/cache, positive telemetry/update, resume/lineage, provider TLS
equivalence, Linux/Windows runtime, incomplete `2.1.214/212/211` pairs, real upstream, real
credentials, profile promotion, production, real canary, protected sidecar authority, replay,
destination enforcement, and direct egress fallback.

Absence is denial. No consumer treats omission as permission.

### 8.6 Rollback tuple

`rollback-tuple.json` is independently addressable and validated by both TS and Go. It is not the
P2 contract bundle or predecessor digest. The root requires the common fields below plus exactly one
`target` branch. The schema uses `oneOf`; each branch uses `additionalProperties: false`; the root
uses `unevaluatedProperties: false` so mixed or ambiguous states cannot validate.

```text
schema_id, schema_major, schema_revision, rollback_tuple_id
active_profile_tuple_digest, evidence_source_relative_path, evidence_source_digest
evidence_source_schema_id, current_generation, issued_at_ms, expires_at_ms, contradiction_ids

target oneOf:
  coherent_tuple:
    target_kind="coherent_tuple"
    rollback_target_tuple_digest, rollback_profile_refs, target_generation
    rollback_floor_generation, target_expires_at_ms, revoked, revocation_ids
  disable_to_no_profile:
    target_kind="disable_to_no_profile"
    deny_reason_code, negative_capability_ref
    removal_semantics="remove_generated_profile_refs_and_disable_local_conformance"
    # rollback_target_tuple_digest, rollback_profile_refs, target_generation,
    # rollback_floor_generation, target_expires_at_ms, revoked, revocation_ids are forbidden
```

The target is selected only from an independently generated, schema-valid coherent tuple whose
profile digests all resolve, whose generation is lower than current but not below the rollback
floor, whose platform/build/install scope exactly matches, and whose evidence remains unexpired,
unrevoked, and contradiction-free. If no such positive target exists, the tuple uses the
`disable_to_no_profile` branch and removes all generated profile refs from both local config
projections while denying local conformance; it may never substitute a P2 contract digest or invent
a profile. Missing tag, mixed branches, forbidden extra fields, missing branch requirements, stale,
revoked, regressed, mismatched, or ambiguous targets, contract-as-profile substitution, or TS/Go
digest/code disagreement fail closed before config generation.

## 9. Future repository layout and ownership

The implementation controller may refine filenames only through the consolidated review if the
fresh baseline changed. It must preserve these ownership boundaries.

```text
CC Gateway (authoritative source and TS implementation)
  contracts/oracle-lab/profile-synthesis/v1/
    profile.schema.json
    fixture.schema.json
    phase3b-input-binding.schema.json
    field-provenance.schema.json
    negative-capabilities.schema.json
    coherent-tuples.schema.json
    config-projection.schema.json
    rollback-tuple.schema.json
    bundle-index.schema.json
    mutation-corpus.json
    expected-results.json
    generated/
      input-binding.json
      client-build-identity.json
      request-profile.json
      response-stream-profile.json
      control-plane-profile.json
      transport-profile.json
      authentication-profile.json
      session-task-lineage-profile.json
      negative-capabilities.json
      coherent-tuples.json
      rollback-tuple.json
      cc-gateway-config.json
      sub2api-config.json
      field-provenance.json
      fixtures/new-session-streaming.json
      fixtures/resumed-session-streaming.json
      fixtures/bounded-failure-recovery.json
      fixtures/deterministic-regeneration.json
      bundle-index.json
  tools/oracle-profile/
    compile.ts
    input.ts
    deterministic-writer.ts
    validate.ts
    check-cross-repo.ts
  src/oracle-profile/
    types.ts
    schema.ts
    validator.ts
  tests/oracle-profile-*.test.ts

Sub2API (paired Go validator and byte-identical generated mirror)
  backend/internal/oracleprofile/
    types.go
    validator.go
    validator_test.go
  backend/internal/service/testdata/oracle_profile_contract/v1/
    # byte-identical mirror of the CC contract/generated tree
```

The dedicated Go package prevents focused Phase 3B tests from compiling unrelated
`backend/internal/service` tests. The generated `cc-gateway-config.json` and
`sub2api-config.json` are typed local-conformance
artifacts, not production config files and not automatically loaded. Phase 3B must not modify
`src/index.ts`, `src/proxy.ts`, live Sub2API handlers/services, sidecar server code, deployment
manifests, or the protected keepalive test.

## 10. Dependency DAG and work packages

```text
independent plan review -> plan merge
  -> P3A-S usable-row revalidation + resume supplement approval/execution/review
  -> P3B-0 fresh freeze + target-role decision + input preflight
  -> P3B-1 schemas and RED corpus
  -> P3B-2 deterministic compiler core
      -> P3B-3 profile/provenance/negative tuple synthesis
      -> P3B-4 typed fixtures and generated configs
  -> P3B-5 TS validator/local conformance
  -> P3B-6 paired Sub2API Go validator/mirror
  -> P3B-7 cross-language mutation and deterministic regeneration
  -> P3B-8 consolidated review, exit decision, and handoff
```

No Phase 3B implementation task starts before P3A-S and the version-role decision are green.
P3B-3 and P3B-4 may be developed in parallel only after the compiler's input/output contracts are
green. P3B-6 starts after schemas and expected results freeze; it does not independently edit the
mirror. There is one consolidated review at P3B-8, not a per-task review loop.

### P3B-0: Fresh freeze and preflight

- **Owner:** Phase 3B controller.
- **Inputs:** fresh `muqihang/main` heads, merged plan, P2 bundle, approved resume supplement, both
  append-only usable-row revalidations, and the resolved version-role decision.
- **Actions:** reject dangerous inherited Git environment variables; assert exact reviewed HEAD,
  tree, frozen remote main, branch, and tracked-clean state; create and digest-check the local-only
  CodeGraph exclusion before every graph command; verify exact path/SHA/schema/root identities for
  all v13 and supplement exit/handoff/terminal/index/leak artifacts;
  validate selected-input precedence, usability, expiry, predecessor, pinned snapshot, and
  contradictions; run the protected-safe static P2 joint check plus explicit-file P2 Go tests. The
  existing CLI's package-wide Go child command and every package-wide implicit runner are forbidden.
- **RED gate:** wrong Git freeze field, dirty tracked state, dangerous Git environment, any missing/
  swapped/mismatched/cross-root/symlinked fixed artifact, a mutated handoff digest, and a non-usable
  resume row all return stable deny codes before any output directory is written.
- **Output:** in-memory preflight decision and safe command result only; no receipt/context/lease.

### P3B-1: Schemas and test-first corpus

- **Owner:** CC Gateway contract owner.
- **Files:** schemas, mutation corpus, expected results, TS schema tests.
- **RED first:** missing provenance, Unknown positive field, omitted negative list, missing/extra/
  unsupported field, duplicate key, wrong set order, reordered sequence, Frankenprofile tuple,
  invalid rollback target, and positive resume without supplement fail.
- **Acceptance:** both schema validators enumerate identical stable codes; no compiler yet passes.

### P3B-2: Deterministic compiler core

- **Owner:** Oracle profile compiler owner.
- **Files/symbols:** `compile.ts::compileProfileBundle`, `input.ts::loadBoundInput`,
  `deterministic-writer.ts::writeCanonicalBundle`.
- **Rules:** strict safe input allowlist, JCS, sorted paths/arrays where semantically sets, fixed
  file modes, no clock/random/hostname/absolute output paths, atomic scratch-to-output write,
  content-addressed index, no partial output on failure.
- **Acceptance:** two clean output roots produce byte-identical trees and digest; changing one
  logical leaf changes the expected artifact and index digest only.

### P3B-3: Profile, provenance, negatives, and tuple synthesis

- **Owner:** profile coherence owner.
- **Files:** generated profile objects, field provenance, negative manifest, coherent tuples, and
  independently addressable rollback tuple.
- **Rules:** every leaf has evidence; Unknown/negative fails closed; rollback is independently
  addressable; generations cannot regress; no handwritten upstream-visible value.
- **Acceptance:** new-session tuple can be constructed only from selected revalidated safe fields;
  resume tuple requires the accepted supplement; rollback target resolves to a real profile tuple
  or explicit disable-to-no-profile; all prohibited capability mutations deny in TS and Go.

### P3B-4: Typed fixtures and generated local configs

- **Owner:** fixture owner with CC/Sub2API contract owners.
- **Files:** four fixtures and two generated config projections.
- **Rules:** placeholders such as `SESSION_REF`, `ROOT_TASK_REF`, `ACCOUNT_REF`, `MODEL_NAME`, and
  `VARIABLE_REQUEST_ID`; no raw prompt, credential, account, proxy, response, CCH, ClientHello,
  unrestricted domain, or absolute evidence path.
- **Acceptance:** fixture-to-profile references resolve exactly; body/headers are typed AST/classes,
  not captured raw bytes; generated configs represent the same logical tuple.

### P3B-5: TypeScript validator and local conformance

- **Owner:** CC Gateway validator owner.
- **Symbols:** `validateProfileBundle`, `validateTypedFixture`, `decideLocalConformance`.
- **Harness:** reuse the loopback fake-upstream pattern without importing raw P3A evidence.
- **Cases:** new streaming, resumed streaming, bounded failure/reset/partial/complete sequence,
  malformed SSE, deadline/terminal/retry ownership, negative capability, rollback and expiry.
- **Boundary:** validates generated artifacts only; never calls live request construction or DNS.

### P3B-6: Sub2API paired Go validator and mirror

- **Owner:** Sub2API Go contract owner.
- **Package/symbols:** `internal/oracleprofile`; `ValidateOracleProfileBundle`, `ValidateOracleTypedFixture`,
  `DecideOracleLocalConformance`.
- **Rules:** use current `CanonicalizeOracleJSON` and P2 types; do not create a second serializer;
  mirror is synchronized from CC and fails if independently edited.
- **Acceptance:** Go returns the same digest and stable decision code as TS for every row. This work
  requires a paired Sub2API implementation PR; Sub2API cannot remain unchanged at Phase 3B exit.

### P3B-7: Mutation, regeneration, and cross-repository gate

- **Owner:** cross-project contract owner.
- **Actions:** run full mutation corpus through TS, Go, manifest, fixture, and index validators;
  regenerate twice under different temp roots, timezone/locale, umask, and file enumeration order;
  compare file list, bytes, modes, and digest.
- **Acceptance:** zero disagreement, zero unproven generated leaf, zero leak canary, exact mirror.

### P3B-8: One consolidated review and handoff

- **Reviewers:** independent profile/compiler reviewer, Sub2API contract reviewer, security reviewer.
- **Review once:** schemas, sources, generated semantic diff, mutation results, determinism,
  cross-language agreement, negative list, rollback, expiry, and protected-path inventory.
- **Exit:** GREEN only if all five Section 7.1 cases, including positive resumed session, pass and
  the version-role decision is resolved. Otherwise publish a precise BLOCKED handoff.
- **Handoff:** safe digests, heads/trees, commands/results, generated bundle digest, negative list,
  rollback target, expiry, contradiction state, remaining runtime non-goals, and next Phase 4 gate.
  No P1 receipt/context/lease/Recovery machinery is created.

## 11. Mutation corpus

The future corpus is table-driven and every mutation changes one dimension at a time:

1. each v13 or supplement fixed artifact missing, swapped, digest-mismatched, schema-mismatched,
   cross-root, symlinked, or paired with the wrong exit/handoff/terminal/index/leak set;
2. floating package tag, wrong active/reference version, `2.1.207`/`2.1.215` evidence relabel;
3. missing, false, unknown, expired, near-expiry-at-P3B-0, contradicted, parser-disagreeing, or
   non-usable conclusion; snapshot drift, predecessor mismatch, or competing eligible successors;
4. duplicate JSON key, invalid UTF-8, lone surrogate, negative zero, unsafe integer, trailing data,
   missing/extra/unsupported field, enum extension, wrongly ordered set, reordered sequence, and
   oversized object for every schema in Section 8.1, including every profile and typed-fixture
   discriminator variant;
5. missing field-provenance row, source digest mismatch, illegal evidence level, handwritten
   upstream-visible UA/header/body/transport constant;
6. missing negative capability, negative match, absent positive declaration, unsupported
   platform/auth/entrypoint, positive telemetry/update, compact/cache, provider TLS, Linux/Windows;
7. positive resume without supplement; missing, tampered, or swapped predecessor; fresh-session
   fallback mislabeled resume; observer disagreement; creation/resume run mismatch; nonterminal
   cell; lineage parent/root mismatch; stale migration sequence; generation regression;
8. mixed request/response/auth/transport profile refs, profile/manifest/contract mismatch,
   Frankenprofile tuple, stale fixture digest;
9. rollback missing/unknown tag, mixed branch, ambiguous `oneOf`, forbidden extra field, or missing
   branch field; expired manifest, open contradiction, invalidated dependency, missing/stale/revoked/regressed/
   platform-mismatched rollback target, rollback below floor, P2 contract digest used as profile
   target, ambiguous target, parent/checkpoint mismatch, or TS/Go rollback disagreement;
10. SSE missing start/stop, duplicated/reordered event, malformed JSON, reset before first byte,
    partial visible output, terminal error, retry after partial output, wrong retry owner;
11. raw prompt/credential/account/proxy/response/CCH/ClientHello and representative secret-canary
    strings in any generated file or diagnostic;
12. different temp root, locale, timezone, wall clock, file order, umask, and repeated generation;
13. one-byte CC/Sub2API mirror drift, TS/Go decision disagreement, manifest/fixture digest mismatch;
14. attempts to enable real upstream, real credentials, profile promotion, protected runtime,
    deployment, production, canary, Phase 4/6A behavior, or direct egress fallback.
15. wrong local HEAD, wrong tree, moved frozen remote main, unexpected/detached branch, staged or
    unstaged tracked dirt, and each forbidden inherited Git environment variable;
16. supplement DAG self-loop, two-node cycle, conclusion dependency on artifact index, leaf or
    conclusion dependency on any later closure node, closure order mismatch, self-entry, and any
    edge whose dependency stage is not strictly earlier.

Positive cases are not weakened to make mutations pass. Stable error codes are part of
`expected-results.json`.

## 12. Exact future command ladder

Paths are environment variables so the controller can use fresh roots:

```bash
export CC_GATEWAY_ROOT=/absolute/fresh/cc-gateway
export SUB2API_ROOT=/absolute/fresh/sub2api
export P3A_ROOT=/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A
: "${CC_REVIEWED_HEAD:?set independently reviewed CC commit}"
: "${CC_REVIEWED_TREE:?set independently reviewed CC tree}"
: "${CC_FROZEN_REMOTE_MAIN:?set frozen CC muqihang/main commit}"
: "${CC_EXPECTED_BRANCH:?set exact reviewed CC branch}"
: "${SUB_REVIEWED_HEAD:?set independently reviewed Sub2API commit}"
: "${SUB_REVIEWED_TREE:?set independently reviewed Sub2API tree}"
: "${SUB_FROZEN_REMOTE_MAIN:?set frozen Sub2API muqihang/main commit}"
: "${SUB_EXPECTED_BRANCH:?set exact reviewed Sub2API branch}"

export P3A_V13_EXIT="$P3A_ROOT/capsules/P3A-4/phase-3a-exit-report-v13.json"
export P3A_V13_EXIT_SHA256=57f16b207933b3a751f96471733d435fa4b0c9801fbef2f5495e8884dfe0bd1b
export P3A_V13_EXIT_SCHEMA=oracle-lab-phase3a-exit.v1
export P3A_V13_HANDOFF="$P3A_ROOT/capsules/P3A-4/phase-3b-3.5-handoff-v13.json"
export P3A_V13_HANDOFF_SHA256=9d188072719dc27a2f9cc9939bc79afa598802b84dd4d9161fb1da3263a792d7
export P3A_V13_HANDOFF_SCHEMA=oracle-lab-phase3a-handoff.v1
export P3A_V13_TERMINAL="$P3A_ROOT/capsules/P3A-4/closure-terminal-manifest-v8.json"
export P3A_V13_TERMINAL_SHA256=c9ee57fbe29125c88278961565f814326b052077b861bb41008cdde6161f12f5
export P3A_V13_TERMINAL_SCHEMA=oracle-lab-phase3a-r4-terminal.v1
export P3A_V13_INDEX="$P3A_ROOT/capsules/P3A-4/artifact-index-v23.json"
export P3A_V13_INDEX_SHA256=e8645c7ed4bc984a926f91e3df1b756c4b009b3a02408de213cbe81b060e80d4
export P3A_V13_INDEX_SCHEMA=oracle-lab-phase3a-artifact-index.v1
export P3A_V13_LEAK="$P3A_ROOT/capsules/P3A-4/leak-scan-v23.json"
export P3A_V13_LEAK_SHA256=7ed3e2776c7fcc47d6c8d513318b33547919c92a33a068a4f0c0cb3706bad145
export P3A_V13_LEAK_SCHEMA=oracle-lab-phase3a-leak-scan.v1
: "${P3A_SUPP_EXIT:?set reviewed supplement exit path}"
: "${P3A_SUPP_EXIT_SHA256:?set reviewed supplement exit SHA-256}"
: "${P3A_SUPP_EXIT_SCHEMA:?set reviewed exit schema_id@major.revision}"
: "${P3A_SUPP_HANDOFF:?set reviewed supplement handoff path}"
: "${P3A_SUPP_HANDOFF_SHA256:?set reviewed supplement handoff SHA-256}"
: "${P3A_SUPP_HANDOFF_SCHEMA:?set reviewed handoff schema_id@major.revision}"
: "${P3A_SUPP_TERMINAL:?set reviewed supplement terminal path}"
: "${P3A_SUPP_TERMINAL_SHA256:?set reviewed supplement terminal SHA-256}"
: "${P3A_SUPP_TERMINAL_SCHEMA:?set reviewed terminal schema_id@major.revision}"
: "${P3A_SUPP_INDEX:?set reviewed supplement index path}"
: "${P3A_SUPP_INDEX_SHA256:?set reviewed supplement index SHA-256}"
: "${P3A_SUPP_INDEX_SCHEMA:?set reviewed index schema_id@major.revision}"
: "${P3A_SUPP_LEAK:?set reviewed supplement leak scan path}"
: "${P3A_SUPP_LEAK_SHA256:?set reviewed supplement leak scan SHA-256}"
: "${P3A_SUPP_LEAK_SCHEMA:?set reviewed leak schema_id@major.revision}"
: "${P3A_REVALIDATED_CONFIG_AUTH:?set normalized-safe CONFIG-AUTH successor path}"
: "${P3A_REVALIDATED_CONFIG_AUTH_SHA256:?set CONFIG-AUTH successor SHA-256}"
: "${P3A_REVALIDATED_CONFIG_AUTH_SCHEMA:?set CONFIG-AUTH schema_id@major.revision}"
: "${P3A_REVALIDATED_FAILURE_STREAM:?set normalized-safe FAILURE-STREAM successor path}"
: "${P3A_REVALIDATED_FAILURE_STREAM_SHA256:?set FAILURE-STREAM successor SHA-256}"
: "${P3A_REVALIDATED_FAILURE_STREAM_SCHEMA:?set FAILURE-STREAM schema_id@major.revision}"

# Local-only CodeGraph exclusion. These are the exact canonical bytes, including final LF.
export CODEGRAPH_CONFIG_CANONICAL='{"exclude":["backend/internal/service/openai_compact_sse_keepalive_test.go"]}'
export CODEGRAPH_CONFIG_SHA256=f885ea40698ff4de9881ce6a9537388ce80c04be9515bf2c77ac186d39140e98

install_codegraph_exclusion() {
  root="$1"
  ! git -C "$root" ls-files --error-unmatch codegraph.json >/dev/null 2>&1
  common_dir="$(git -C "$root" rev-parse --path-format=absolute --git-common-dir)"
  info_exclude="$common_dir/info/exclude"
  node --input-type=module -e '
    import fs from "node:fs";
    const [configPath, infoExclude, canonical] = process.argv.slice(1);
    fs.writeFileSync(configPath, canonical + "\n", {encoding:"utf8", mode:0o600});
    const old = fs.existsSync(infoExclude) ? fs.readFileSync(infoExclude, "utf8") : "";
    if (!old.split(/\r?\n/).includes("/codegraph.json"))
      fs.appendFileSync(infoExclude, (old && !old.endsWith("\n") ? "\n" : "") + "/codegraph.json\n");
  ' "$root/codegraph.json" "$info_exclude" "$CODEGRAPH_CONFIG_CANONICAL"
  test "$(shasum -a 256 "$root/codegraph.json" | awk '{print $1}')" = \
    "$CODEGRAPH_CONFIG_SHA256"
  git -C "$root" check-ignore -q codegraph.json
}

codegraph_with_exclusion() {
  root="$1"; operation="$2"
  case "$operation" in init|index|sync|status) ;; *) return 64 ;; esac
  test "$(shasum -a 256 "$root/codegraph.json" | awk '{print $1}')" = \
    "$CODEGRAPH_CONFIG_SHA256"
  (cd "$root" && /Users/muqihang/.local/bin/codegraph "$operation" .)
  test "$(shasum -a 256 "$root/codegraph.json" | awk '{print $1}')" = \
    "$CODEGRAPH_CONFIG_SHA256"
}

assert_no_dangerous_git_env() {
  node --input-type=module -e '
    const forbidden=["GIT_DIR","GIT_WORK_TREE","GIT_INDEX_FILE","GIT_OBJECT_DIRECTORY",
      "GIT_ALTERNATE_OBJECT_DIRECTORIES","GIT_COMMON_DIR","GIT_NAMESPACE","GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_SYSTEM","GIT_CONFIG_NOSYSTEM","GIT_CONFIG_COUNT","GIT_CONFIG_PARAMETERS",
      "GIT_ATTR_NOSYSTEM","GIT_EXEC_PATH","GIT_PREFIX","GIT_CEILING_DIRECTORIES",
      "GIT_DISCOVERY_ACROSS_FILESYSTEM"];
    const inherited=forbidden.filter((name)=>Object.hasOwn(process.env,name));
    if (inherited.length) { console.error(inherited.join(",")); process.exit(65); }
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

# Freshness and immutable inputs
assert_no_dangerous_git_env
git -C "$CC_GATEWAY_ROOT" fetch muqihang main --prune
git -C "$SUB2API_ROOT" fetch muqihang main --prune
assert_git_freeze "$CC_GATEWAY_ROOT" "$CC_REVIEWED_HEAD" "$CC_REVIEWED_TREE" \
  "$CC_FROZEN_REMOTE_MAIN" "$CC_EXPECTED_BRANCH"
assert_git_freeze "$SUB2API_ROOT" "$SUB_REVIEWED_HEAD" "$SUB_REVIEWED_TREE" \
  "$SUB_FROZEN_REMOTE_MAIN" "$SUB_EXPECTED_BRANCH"
install_codegraph_exclusion "$CC_GATEWAY_ROOT"
install_codegraph_exclusion "$SUB2API_ROOT"
for operation in init index sync status; do
  codegraph_with_exclusion "$CC_GATEWAY_ROOT" "$operation"
  codegraph_with_exclusion "$SUB2API_ROOT" "$operation"
done
test "$(sqlite3 "$CC_GATEWAY_ROOT/.codegraph/codegraph.db" \
  "SELECT COUNT(*) FROM files WHERE path='backend/internal/service/openai_compact_sse_keepalive_test.go';")" = 0
test "$(sqlite3 "$SUB2API_ROOT/.codegraph/codegraph.db" \
  "SELECT COUNT(*) FROM files WHERE path='backend/internal/service/openai_compact_sse_keepalive_test.go';")" = 0
codegraph_with_exclusion "$CC_GATEWAY_ROOT" status > /tmp/cc-codegraph-status.txt
codegraph_with_exclusion "$SUB2API_ROOT" status > /tmp/sub2api-codegraph-status.txt
shasum -a 256 "$CC_GATEWAY_ROOT/codegraph.json" "$SUB2API_ROOT/codegraph.json" \
  /tmp/cc-codegraph-status.txt /tmp/sub2api-codegraph-status.txt
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
verify_safe_binding "$P3A_V13_EXIT" "$P3A_V13_EXIT_SHA256" "$P3A_V13_EXIT_SCHEMA" "$P3A_ROOT"
verify_safe_binding "$P3A_V13_HANDOFF" "$P3A_V13_HANDOFF_SHA256" "$P3A_V13_HANDOFF_SCHEMA" "$P3A_ROOT"
verify_safe_binding "$P3A_V13_TERMINAL" "$P3A_V13_TERMINAL_SHA256" "$P3A_V13_TERMINAL_SCHEMA" "$P3A_ROOT"
verify_safe_binding "$P3A_V13_INDEX" "$P3A_V13_INDEX_SHA256" "$P3A_V13_INDEX_SCHEMA" "$P3A_ROOT"
verify_safe_binding "$P3A_V13_LEAK" "$P3A_V13_LEAK_SHA256" "$P3A_V13_LEAK_SCHEMA" "$P3A_ROOT"
P3A_SUPP_ROOT="$(dirname "$P3A_SUPP_HANDOFF")"
verify_safe_binding "$P3A_SUPP_EXIT" "$P3A_SUPP_EXIT_SHA256" "$P3A_SUPP_EXIT_SCHEMA" "$P3A_SUPP_ROOT"
verify_safe_binding "$P3A_SUPP_HANDOFF" "$P3A_SUPP_HANDOFF_SHA256" "$P3A_SUPP_HANDOFF_SCHEMA" "$P3A_SUPP_ROOT"
verify_safe_binding "$P3A_SUPP_TERMINAL" "$P3A_SUPP_TERMINAL_SHA256" "$P3A_SUPP_TERMINAL_SCHEMA" "$P3A_SUPP_ROOT"
verify_safe_binding "$P3A_SUPP_INDEX" "$P3A_SUPP_INDEX_SHA256" "$P3A_SUPP_INDEX_SCHEMA" "$P3A_SUPP_ROOT"
verify_safe_binding "$P3A_SUPP_LEAK" "$P3A_SUPP_LEAK_SHA256" "$P3A_SUPP_LEAK_SCHEMA" "$P3A_SUPP_ROOT"
verify_safe_binding "$P3A_REVALIDATED_CONFIG_AUTH" "$P3A_REVALIDATED_CONFIG_AUTH_SHA256" \
  "$P3A_REVALIDATED_CONFIG_AUTH_SCHEMA" "$P3A_SUPP_ROOT"
verify_safe_binding "$P3A_REVALIDATED_FAILURE_STREAM" \
  "$P3A_REVALIDATED_FAILURE_STREAM_SHA256" "$P3A_REVALIDATED_FAILURE_STREAM_SCHEMA" "$P3A_SUPP_ROOT"

# Unchanged P2 gate
cd "$CC_GATEWAY_ROOT"
npm ci
node --import tsx --input-type=module -e "import { checkCrossRepoContract } from './tools/oracle-contract/check-cross-repo.ts'; console.log(JSON.stringify(checkCrossRepoContract({ccGatewayRoot:process.cwd(),sub2apiRoot:process.env.SUB2API_ROOT,runCommands:false})))"
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

# RED then GREEN schema/compiler/validator gates
npm exec tsx tests/oracle-profile-input.test.ts
npm exec tsx tests/oracle-profile-schema.test.ts
npm exec tsx tests/oracle-profile-command-chain.test.ts
npm exec tsx tests/oracle-profile-git-freeze.test.ts
npm exec tsx tests/oracle-profile-closure-dag.test.ts
npm exec tsx tests/oracle-profile-compiler.test.ts
npm exec tsx tests/oracle-profile-provenance.test.ts
npm exec tsx tests/oracle-profile-negative-capability.test.ts
npm exec tsx tests/oracle-profile-rollback.test.ts
npm exec tsx tests/oracle-profile-fixture.test.ts
npm exec tsx tests/oracle-profile-local-conformance.test.ts
npm exec tsx tests/oracle-profile-mutation.test.ts

cd "$SUB2API_ROOT/backend"
go test ./internal/oracleprofile -run '^TestOracleProfile' -count=1

# Deterministic generation and exact cross-project agreement
cd "$CC_GATEWAY_ROOT"
npm exec tsx tools/oracle-profile/compile.ts -- \
  --base-exit "$P3A_V13_EXIT" --base-exit-sha "$P3A_V13_EXIT_SHA256" --base-exit-schema "$P3A_V13_EXIT_SCHEMA" \
  --base-handoff "$P3A_V13_HANDOFF" --base-handoff-sha "$P3A_V13_HANDOFF_SHA256" --base-handoff-schema "$P3A_V13_HANDOFF_SCHEMA" \
  --base-terminal "$P3A_V13_TERMINAL" --base-terminal-sha "$P3A_V13_TERMINAL_SHA256" --base-terminal-schema "$P3A_V13_TERMINAL_SCHEMA" \
  --base-index "$P3A_V13_INDEX" --base-index-sha "$P3A_V13_INDEX_SHA256" --base-index-schema "$P3A_V13_INDEX_SCHEMA" \
  --base-leak "$P3A_V13_LEAK" --base-leak-sha "$P3A_V13_LEAK_SHA256" --base-leak-schema "$P3A_V13_LEAK_SCHEMA" \
  --supplement-exit "$P3A_SUPP_EXIT" --supplement-exit-sha "$P3A_SUPP_EXIT_SHA256" --supplement-exit-schema "$P3A_SUPP_EXIT_SCHEMA" \
  --supplement-handoff "$P3A_SUPP_HANDOFF" --supplement-handoff-sha "$P3A_SUPP_HANDOFF_SHA256" --supplement-handoff-schema "$P3A_SUPP_HANDOFF_SCHEMA" \
  --supplement-terminal "$P3A_SUPP_TERMINAL" --supplement-terminal-sha "$P3A_SUPP_TERMINAL_SHA256" --supplement-terminal-schema "$P3A_SUPP_TERMINAL_SCHEMA" \
  --supplement-index "$P3A_SUPP_INDEX" --supplement-index-sha "$P3A_SUPP_INDEX_SHA256" --supplement-index-schema "$P3A_SUPP_INDEX_SCHEMA" \
  --supplement-leak "$P3A_SUPP_LEAK" --supplement-leak-sha "$P3A_SUPP_LEAK_SHA256" --supplement-leak-schema "$P3A_SUPP_LEAK_SCHEMA" \
  --revalidated-config-auth "$P3A_REVALIDATED_CONFIG_AUTH" --revalidated-config-auth-sha "$P3A_REVALIDATED_CONFIG_AUTH_SHA256" --revalidated-config-auth-schema "$P3A_REVALIDATED_CONFIG_AUTH_SCHEMA" \
  --revalidated-failure-stream "$P3A_REVALIDATED_FAILURE_STREAM" --revalidated-failure-stream-sha "$P3A_REVALIDATED_FAILURE_STREAM_SHA256" --revalidated-failure-stream-schema "$P3A_REVALIDATED_FAILURE_STREAM_SCHEMA" \
  --out /tmp/oracle-profile-a
TZ=Asia/Shanghai LANG=C LC_ALL=C npm exec tsx tools/oracle-profile/compile.ts -- \
  --base-exit "$P3A_V13_EXIT" --base-exit-sha "$P3A_V13_EXIT_SHA256" --base-exit-schema "$P3A_V13_EXIT_SCHEMA" \
  --base-handoff "$P3A_V13_HANDOFF" --base-handoff-sha "$P3A_V13_HANDOFF_SHA256" --base-handoff-schema "$P3A_V13_HANDOFF_SCHEMA" \
  --base-terminal "$P3A_V13_TERMINAL" --base-terminal-sha "$P3A_V13_TERMINAL_SHA256" --base-terminal-schema "$P3A_V13_TERMINAL_SCHEMA" \
  --base-index "$P3A_V13_INDEX" --base-index-sha "$P3A_V13_INDEX_SHA256" --base-index-schema "$P3A_V13_INDEX_SCHEMA" \
  --base-leak "$P3A_V13_LEAK" --base-leak-sha "$P3A_V13_LEAK_SHA256" --base-leak-schema "$P3A_V13_LEAK_SCHEMA" \
  --supplement-exit "$P3A_SUPP_EXIT" --supplement-exit-sha "$P3A_SUPP_EXIT_SHA256" --supplement-exit-schema "$P3A_SUPP_EXIT_SCHEMA" \
  --supplement-handoff "$P3A_SUPP_HANDOFF" --supplement-handoff-sha "$P3A_SUPP_HANDOFF_SHA256" --supplement-handoff-schema "$P3A_SUPP_HANDOFF_SCHEMA" \
  --supplement-terminal "$P3A_SUPP_TERMINAL" --supplement-terminal-sha "$P3A_SUPP_TERMINAL_SHA256" --supplement-terminal-schema "$P3A_SUPP_TERMINAL_SCHEMA" \
  --supplement-index "$P3A_SUPP_INDEX" --supplement-index-sha "$P3A_SUPP_INDEX_SHA256" --supplement-index-schema "$P3A_SUPP_INDEX_SCHEMA" \
  --supplement-leak "$P3A_SUPP_LEAK" --supplement-leak-sha "$P3A_SUPP_LEAK_SHA256" --supplement-leak-schema "$P3A_SUPP_LEAK_SCHEMA" \
  --revalidated-config-auth "$P3A_REVALIDATED_CONFIG_AUTH" --revalidated-config-auth-sha "$P3A_REVALIDATED_CONFIG_AUTH_SHA256" --revalidated-config-auth-schema "$P3A_REVALIDATED_CONFIG_AUTH_SCHEMA" \
  --revalidated-failure-stream "$P3A_REVALIDATED_FAILURE_STREAM" --revalidated-failure-stream-sha "$P3A_REVALIDATED_FAILURE_STREAM_SHA256" --revalidated-failure-stream-schema "$P3A_REVALIDATED_FAILURE_STREAM_SCHEMA" \
  --out /tmp/oracle-profile-b
diff -ru /tmp/oracle-profile-a /tmp/oracle-profile-b
npm exec tsx tools/oracle-profile/check-cross-repo.ts -- \
  --cc-gateway-root "$CC_GATEWAY_ROOT" --sub2api-root "$SUB2API_ROOT" --check

# Leak and forbidden-scope checks over generated files only
! rg -n -i 'sk-ant-|authorization:|refresh[_-]?token|clienthello|raw_prompt|raw_response' \
  contracts/oracle-lab/profile-synthesis/v1/generated \
  "$SUB2API_ROOT/backend/internal/service/testdata/oracle_profile_contract/v1"
```

`codegraph.json` is local-only and must remain ignored/untracked; its canonical bytes and SHA-256
are rechecked before and after every `init`, `index`, `sync`, and `status`. The SQLite assertions
query only the CodeGraph file inventory and must return zero; they never open the protected source.
The command-chain test mutates missing config, wrong digest, wrong working directory, unsupported
operation, indexed protected-path inventory, wrong HEAD/tree/remote/branch, tracked dirt, dangerous
Git environment, fixed-artifact missing/swap/digest/schema/root/symlink failures, `go test ./...`,
`go test ./internal/service`, and an implicit package-wide child runner. Every mutation must deny
before command execution.

`/tmp/oracle-profile-*` are disposable execution outputs, but deletion still follows the active
operator safety policy. Phase 3B permits only the explicit P2 Go file list above and
`go test ./internal/oracleprofile`; `go test ./...`, `go test ./internal/service`, full product
suites, and any implicit package-wide runner are forbidden throughout Phase 3B. No command may
include, open, search, compile, or otherwise consume the protected keepalive test.

## 13. Acceptance criteria and stop rules

Phase 3B may exit GREEN only when all are true:

1. reviewed HEAD/tree/frozen remote/branch and tracked-clean state are asserted with no dangerous
   Git environment; CodeGraph stats are recorded; the exclusion config canonical digest is verified
   around every graph command and the protected path inventory count is zero;
2. P2 bundle/predecessor/range, all five v13 artifacts, all five supplement closure artifacts, and
   both append-only usable-row revalidations match their independently reviewed path/digest/schema;
3. every generated leaf has evidence level/source and every Unknown is explicit/fail closed;
4. all logical profiles, negative capabilities, coherent tuple, generated configs, typed fixtures,
   TS validator, Go validator, manifest, and index agree exactly;
5. new-session streaming, positive resumed-session streaming, and bounded failure/recovery pass
   local loopback conformance;
6. two isolated generations are byte-identical and have the same digest;
7. rollback/version/generation/expiry/contradiction and command-chain mutations fail with stable
   TS/Go codes;
8. leak scan and forbidden raw-material canaries find zero generated leaks;
9. the independent consolidated review has no Critical or Important finding;
10. no promotion, production, upstream, credential, canary, deployment, or runtime claim is made.

True blockers are limited to: missing/expired/contradicted usable evidence, revalidation or resume
supplement failure, pinned snapshot/predecessor drift, P2 contract mismatch, TS/Go disagreement,
non-deterministic output after root-cause isolation, or inability to keep raw material out of
artifacts. On a true blocker, stop and publish the exact deny code/input digest. Test failure,
ordinary implementation difficulty, or a review comment is not permission to broaden scope or
loop indefinitely.

## 14. Resource and time estimate

| Work | Primary owner | Estimate | Parallelism |
| --- | --- | ---: | --- |
| P3A usable-row revalidation + resume supplement | P3A evidence owner + reviewer | 2-4 engineer-days plus convergence runtime | must finish first |
| P3B-0/1 freeze, schemas, RED corpus | controller + contract owner | 2 days | sequential entry |
| P3B-2 compiler core | TS compiler owner | 2-3 days | precedes synthesis |
| P3B-3/4 profiles, provenance, fixtures/configs | profile + fixture owners | 3-4 days | parallel after compiler contract |
| P3B-5 TS conformance | TS validator owner | 2 days | after generated schema |
| P3B-6 Go validator/mirror | Sub2API owner | 2-3 days | parallel with TS after schema freeze |
| P3B-7 mutation/determinism | cross-project owner | 2 days | after TS/Go |
| P3B-8 consolidated review/handoff | three reviewers + controller | 1-2 days | single review point |

Expected Phase 3B implementation effort after unblock is 14-18 engineer-days, excluding queue
time. Evidence storage should remain small because Phase 3B persists only canonical generated
artifacts and typed fixtures; no raw P3A evidence is duplicated.

## 15. Handoff contract

The future Phase 3B handoff includes:

- exact merged CC/Sub2API heads and trees;
- P2 contract/predecessor/range, five v13 digests, five supplement closure digests, both selected
  revalidation digests/schemas, and their exact precedence decision;
- generated bundle index and aggregate digest;
- file-by-file digests for all profile/config/provenance/negative/tuple/fixture artifacts;
- TS/Go/manifest/fixture decision matrix and mutation results;
- deterministic regeneration comparison;
- rollback tuple/target digest, policy/profile generation, evidence expiry, contradiction state;
- remaining negative capabilities and explicit Phase 4/6A non-goals;
- exact focused commands and result summary;
- protected-file untouched assertion and changed-file inventory.

The next step after this plan PR is a fresh independent plan reviewer. Only after plan merge and
usable-row revalidation/resume supplement approval/completion may a new Phase 3B execution
controller begin P3B-0. That controller starts from fresh mains and this handoff; it does not rely
on stale P3A/P1 chat context.

## 16. Planning self-checks

This planning task runs only document/baseline checks:

```bash
export PLAN=docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3b-profile-synthesis.md
test -s docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3b-profile-synthesis.md
! rg -n 'TO[D]O|TB[D]|FIXM[E]|PLACEHOLDE[R]|@lates[t]' \
  "$PLAN"
rg -n 'RA-P0-001|RA-P0-002|RA-P0-005|RA-P0-007|RA-P0-009|RA-P1-001|RA-P1-002|RA-P1-003|RA-P1-004|RA-P1-007|RA-P1-008|HA-P0-003|HA-P1-001' \
  "$PLAN"
rg -n 'BLOCKED|CL-P3A-RESUME-LINEAGE-UNKNOWN|phase3b_usable' \
  "$PLAN"
for schema in profile fixture phase3b-input-binding field-provenance negative-capabilities \
  coherent-tuples config-projection rollback-tuple bundle-index; do rg -q "$schema.schema.json" "$PLAN"; done
rg -q 'missing, tampered, or swapped predecessor' "$PLAN"
rg -q 'missing/stale/revoked/regressed' "$PLAN"
rg -q 'missing/extra/unsupported field' "$PLAN"
rg -q 'wrongly ordered set, reordered sequence' "$PLAN"
rg -q 'target_kind="coherent_tuple"' "$PLAN"
rg -q 'target_kind="disable_to_no_profile"' "$PLAN"
rg -q 'oneOf.*additionalProperties: false' "$PLAN"
rg -q 'unevaluatedProperties: false' "$PLAN"
rg -q 'assert_no_dangerous_git_env' "$PLAN"
rg -q 'assert_git_freeze' "$PLAN"
for kind in exit handoff terminal index leak; do
  rg -q -- "--base-$kind .*--base-$kind-sha .*--base-$kind-schema" "$PLAN"
done
for mutation in 'wrong local HEAD' 'moved frozen remote main' 'staged or' \
  'missing/unknown tag' 'ambiguous `oneOf`' 'cross-root' 'schema-mismatched'; do
  rg -q "$mutation" "$PLAN"
done
test "$(printf '%s\n' '{"exclude":["backend/internal/service/openai_compact_sse_keepalive_test.go"]}' | \
  shasum -a 256 | awk '{print $1}')" = f885ea40698ff4de9881ce6a9537388ce80c04be9515bf2c77ac186d39140e98
! rg -n '^go test (\./\.\.\.|\./internal/service)( |$)' "$PLAN"
node --input-type=module <<'NODE'
import fs from "node:fs";
const text=fs.readFileSync(process.env.PLAN,"utf8");
const match=text.match(/```json supplement-closure-dag\n([\s\S]*?)\n```/);
if (!match) throw new Error("missing structured supplement DAG");
const base=JSON.parse(match[1]);
const expectedClosure=["artifact_index","leak_report","exit_report","handoff","terminal_manifest"];
const expectedIncludes=["pinned_inputs","predecessor_safe_state","observer_a_output","observer_b_output","leaf_cell_run_records","normalized_safe_conclusions"];
const expectedExcludes=[...expectedClosure,"external_digest_set"];

function validate(dag) {
  const nodes=new Map();
  for (const node of dag.nodes) {
    if (nodes.has(node.id) || !Number.isInteger(node.stage)) throw new Error("invalid node");
    nodes.set(node.id,node.stage);
  }
  if (JSON.stringify(dag.closure_order)!==JSON.stringify(expectedClosure))
    throw new Error("closure order mismatch");
  expectedClosure.forEach((id,index)=>{
    if (nodes.get(id)!==index+4) throw new Error("closure stage mismatch");
  });
  if (JSON.stringify(dag.index_scope?.includes)!==JSON.stringify(expectedIncludes) ||
      JSON.stringify(dag.index_scope?.excludes)!==JSON.stringify(expectedExcludes))
    throw new Error("index scope mismatch");
  const indegree=new Map([...nodes.keys()].map((id)=>[id,0]));
  const outgoing=new Map([...nodes.keys()].map((id)=>[id,[]]));
  for (const edge of dag.edges) {
    if (!nodes.has(edge.node)||!nodes.has(edge.depends_on)) throw new Error("unknown edge node");
    if (edge.node===edge.depends_on) throw new Error("self loop");
    indegree.set(edge.node,indegree.get(edge.node)+1);
    outgoing.get(edge.depends_on).push(edge.node);
  }
  const ready=[...indegree].filter(([,n])=>n===0).map(([id])=>id).sort();
  let visited=0;
  while (ready.length) {
    const id=ready.shift(); visited++;
    for (const next of outgoing.get(id).sort()) {
      indegree.set(next,indegree.get(next)-1);
      if (indegree.get(next)===0) ready.push(next);
    }
    ready.sort();
  }
  if (visited!==nodes.size) throw new Error("cycle");
  for (const edge of dag.edges)
    if (nodes.get(edge.depends_on)>=nodes.get(edge.node)) throw new Error("closure reverse edge");
}
const clone=()=>structuredClone(base);
validate(base);
const redMutations=[
  (d)=>d.edges.push({node:"artifact_index",depends_on:"artifact_index"}),
  (d)=>d.edges.push({node:"observer_a_output",depends_on:"observer_b_output"},{node:"observer_b_output",depends_on:"observer_a_output"}),
  (d)=>d.edges.push({node:"normalized_safe_conclusions",depends_on:"artifact_index"}),
  (d)=>d.edges.push({node:"leaf_cell_run_records",depends_on:"terminal_manifest"})
];
for (const mutate of redMutations) {
  const candidate=clone(); mutate(candidate);
  let denied=false; try { validate(candidate); } catch { denied=true; }
  if (!denied) throw new Error("DAG mutation unexpectedly accepted");
}
console.log("supplement closure DAG: PASS; RED mutations: 4/4");
NODE
test "$(git diff --name-only | wc -l | tr -d ' ')" = 1
test "$(git diff --name-only)" = "$PLAN"
git diff --check
git diff --name-only
```

The expected planning diff is exactly this plan document. No Phase 3B implementation has started.

## 17. Append-only P3A-S static blocker closure binding (2026-07-23)

This section is an append-only successor to the Phase 3B authority predecessor with SHA-256
`0687ccaea710647a357993aaefc389078d68f54c2d5ae51f6710d63c2e3906d3`. It does not change the
authoritative `supplement-closure-dag`, start Phase 3B, or make any conclusion
`phase3b_usable=true`.

After an independent holistic review of the immutable recon tip reports zero Critical and zero
Important issues, Phase 3B recognizes both P3A-S controller-creation static blockers as closed by
this exact tuple:

| object | exact relative path | schema / digest |
| --- | --- | --- |
| closure record | `docs/superpowers/evidence/phase3a/claude-code-2.1.215-p3as-static-blocker-recon-v1.json` | exact-file SHA-256 `963038e5629646c2c101b4f81014ab9abd6001f8688175544c07e01f74a86df3`; internal JCS digest `731be5a8cba26f5ee867fd46e9798eaec5d8b2ea4e5b77d92fae0648c42143dd`; `oracle-lab-phase3a-static-blocker-recon@1.0` |
| reviewable report | `docs/superpowers/evidence/phase3a/claude-code-2.1.215-p3as-static-blocker-recon-v1.md` | SHA-256 `42f0611fa542aedbc16fefe6b194b198f46f8cdb0d66747ed3a4c6141cda6007` |
| strict schema | `docs/superpowers/schemas/oracle-lab-phase3a-static-blocker-recon.schema.json` | SHA-256 `3c2d28fa8a72956b2c59003e8ac15ec146bb334149a8ea136a5e658bb7e40a0c` |
| deterministic scanner/builder | `tools/oracle-lab/phase3a/static-blocker-recon.ts` | SHA-256 `019b9377c9508e7a6f9fd8e9d6154ab312403ce34254225a0ba405121f3a70ae` |

The tuple is valid only for official Claude Code 2.1.215 Darwin arm64 archive
`599883973d2b4c8bb25e3490c84d65646f78d158cdc86adc73c1f5a6cfbbd600`, tree
`f5a04795289524b639b479fe6ffac187218d7c558a5a5be312ee228850c6e7fe`, and executable
`90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58`. It freezes exact
creation/new-control/resume token order and the state-dependent `$.messages` predecessor-prefix
signal, with independent loopback-network and Darwin-filesystem/process observers required for
any future dynamic conclusion.

This binding changes only the controller-creation precondition from static blockers open to
`RECON_APPEND_ONLY_CLOSED`; the static closure remains `phase3b_usable=false`. Phase 3B remains
blocked until a separately authorized controller
produces and independently reviews the full dynamic P3A-S DAG: both revalidated v13 successors,
the resumed-lineage conclusion, all Observer A/B outputs, convergence, index, leak, exit, handoff,
terminal, and external digest set. Static closure is not a substitute for any of those artifacts.
