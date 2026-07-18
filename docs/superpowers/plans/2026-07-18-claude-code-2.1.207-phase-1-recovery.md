# Claude Code 2.1.207 Phase 1 Recovery Plan

Status: draft for bounded acceptance-contract review. This document does not authorize execution.

## 1. Objective

Resume the paused Phase 1 once, under Oracle Delivery Operating Model v2, without replaying the old
authorization loop or reimplementing completed Task 1-7 work. The recovery must:

1. freeze a new Program Baseline Envelope and sequence-zero Run Lease;
2. prove one real pre-replay RED from current main;
3. rehydrate the exact reviewed 8 CC Gateway and 10 Sub2API implementation commits from validated
   source bundles into fresh branches;
4. prove B1-B3 and the Phase 1 listener slice GREEN while preserving the exact B4-B6 RED corpus;
5. complete Task 8 feature capture, bounded review, ordinary merge, post-integration recapture, and
   handoff;
6. leave production, real upstream, real canary, feature-profile promotion, and cleanup disabled.

Phase 1 Task 1-8 remains paused until this exact plan is merged, independently approved with zero
Critical and zero Important findings, and its fresh sequence-zero lease is issued.

## 2. Authority And Precedence

For this recovery only, conflicts are resolved in this order:

1. `docs/superpowers/roadmaps/2026-07-18-oracle-lab-delivery-operating-model-v2.md`
2. `docs/superpowers/evidence/delivery-model/delivery-mechanism-transition-exit-report.md`
3. this Recovery Plan and its embedded Phase Acceptance Contract
4. `docs/superpowers/plans/2026-07-15-claude-code-2.1.207-phase-1-control-plane-boundary-repairs.md`
   for Task 1-8 product requirements, file ownership, and acceptance semantics only
5. the seven-phase roadmap and the four design/amendment documents in their existing precedence

The old Phase 1 plan's Mandatory Preflight, execution-context renewal, authority-repair instances
`0001`/`0002`, fixed v8 branch names, repeated holistic-plan review, and restart artifact lifecycle
are historical only. They cannot authorize this recovery. Its Task 1-8 requirements remain binding
unless this plan narrows an execution mechanism explicitly.

## 3. Planning Baseline

| Input | Frozen planning value |
| --- | --- |
| CC Gateway main after transition acceptance report | `04c6ffa059061238bc41f3658701f73c9a6020ce` |
| Sub2API current `muqihang/main` | `b0b77933716487da5fca00329443f88ce9a1c3db` |
| Operating model v2 | `sha256:a53e7384d6cf353877af82f16196b8d58ed823277e76e03337dfc9fadff7d0ea` |
| Seven-phase roadmap | `sha256:00519348d9dd8972dbea92a647d67c2fc42e9015ece6dcb0eb427df02480b107` |
| Transition plan | `sha256:f21023b1d6705855e00ee0f9ceafc78c6cf1c7b928982fd88e821faffa7a8111` |
| Transition exit report | `sha256:44c9322ba157c1ce4f3b9a974387026aad143f73c6991848be3f50f13af00f48` |
| Accepted terminal controller chain | `sha256:3faa939ec6f78a7478a5ea5c2773ea74d5ea42d0b699e1880798cac980192433` |
| Terminal acceptance record | `sha256:00f84b989d0db40d0c47429bcd5d444709159027f21f4dec0e33812b9c539ecd` |
| Shared contract | `sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1` |
| CC source bundle | `sha256:27e9e3cea6a2d18eb1e6423e9e7589aa53b5779fcf71a55008bbdbca838c9fd3` |
| Sub2API source bundle | `sha256:3df0933834ed3bcc692b421e317c19314c1594492571a4abeae84375152fe47e` |
| Merged-main transition T2 | `sha256:f5326ec6b055b30ababbab548018bcc5bf8233e23c690917bdaf197af3c46963` |

The execution baseline is not the planning commit above. After this plan merges, Mandatory Entry
fetches both remotes again. The merged Recovery Plan commit becomes the CC baseline; fetched
Sub2API main becomes the Sub2API baseline. Any unrelated remote movement before sequence zero is a
new baseline-envelope input, not a reason to edit this plan, provided all authority bytes and the
shared contract remain identical. A rewind, unrelated history, or byte drift stops entry.

## 4. Scope And Non-Goals

Owned requirements:

- B1 server-observed browser egress proof and single-use finalization;
- B2 owner/tenant/group/creator/role/state/version authority and reservation-adjacent principal
  revalidation;
- B3 configured `public_origin` authority;
- RA-P0-008 listener exposure and upstream certificate startup gates;
- Task 7 hermetic H1 catalog, exact RED parsing, ignored-state, dependency, and sandbox evidence;
- Task 8 feature review, integration receipt, registry transition, and handoff.

Preserved expected RED:

- B4-B6 exact canonical leaves, names, counts, sorted multiset, unique names, families, TAP/Go
  lifecycle, and mutation corpus;
- CC inventory: 61 canonical failing leaves;
- sidecar inventory: 51 canonical failing leaves.

Non-goals:

- no new Claude Code version selection;
- no protocol/profile synthesis, production compatibility claim, real upstream request, credential,
  canary, account promotion, or production deployment;
- no redesign of Task 1-7 when exact replay is equivalent and tests pass;
- no cleanup or branch deletion;
- no direct read, search, modification, staging, or commit of
  `backend/internal/service/openai_compact_sse_keepalive_test.go`.

New Claude Code releases go through the operating model's Version Intake Lane. They do not mutate
this Recovery envelope or change the selected 2.1.207 task requirements.

## 5. Phase Acceptance Contract

The JSON block is normative. The recovery authority implementation must bind its exact canonical
JSON digest and reject caller-supplied rows, omitted delta tokens, duplicate categories, ambiguous
successors, or any transition not listed here.

<!-- ORACLE_PHASE1_RECOVERY_TRANSITIONS_BEGIN -->
```json
[
  {"id":"P1R-01","from":"candidate","to":"baseline_frozen","command":"freeze-recovery-authority","condition":"always","allowed_delta":["git:cc:add:plan-review-and-context","external:add:baseline-envelope","external:add:sequence-zero-run-lease"]},
  {"id":"P1R-02","from":"baseline_frozen","to":"vertical_red_confirmed","command":"run-pre-replay-vertical-red","condition":"exact-recovery-replay-required","allowed_delta":["disposable:add:cc-pre-replay-root","disposable:add:sub2api-pre-replay-root","external:add:pre-replay-red-record","forbid:product-branch-change","forbid:restart-artifact"]},
  {"id":"P1R-03","from":"vertical_red_confirmed","to":"replay_complete","command":"rehydrate-reviewed-implementation","condition":"exact-8x10-replay","allowed_delta":["git:cc:exact-eight-replay-commits","git:sub2api:exact-ten-replay-commits","external:add:replay-mapping-record"]},
  {"id":"P1R-04","from":"replay_complete","to":"task7_green_confirmed","command":"run-replay-verification","condition":"t0-t1-t2-green","allowed_delta":["external:add:recovery-transaction-record","git:cc:none","git:sub2api:none"]},
  {"id":"P1R-05","from":"task7_green_confirmed","to":"feature_capture_authorized","command":"issue-feature-capture-lease","condition":"fresh-clean-candidate-heads","allowed_delta":["git:cc:add:feature-context","external:add:feature-capture-run-lease","git:sub2api:none"]},
  {"id":"P1R-06","from":"feature_capture_authorized","to":"feature_green_confirmed","command":"capture-feature-evidence","condition":"feature-candidate-green","allowed_delta":["git:cc:add:feature-baseline-and-results","external:add:feature-transaction-record","git:sub2api:none"]},
  {"id":"P1R-07","from":"feature_green_confirmed","to":"review_decided","command":"run-bounded-integrated-review","condition":"review-verdict-recorded","allowed_delta":["git:cc:add:feature-review-attestation","external:add:integrated-review-verdict","git:sub2api:none"]},
  {"id":"P1R-08A","from":"review_decided","to":"integrated_reviewed","command":"accept-zero-material-findings","condition":"critical-important-zero","allowed_delta":["state-only"]},
  {"id":"P1R-08B","from":"review_decided","to":"closure_required","command":"apply-one-product-closure-wave","condition":"critical-important-nonzero","allowed_delta":["git:cc:declared-product-fix-paths","git:sub2api:declared-product-fix-paths","git:combined:max-one-closure-wave"]},
  {"id":"P1R-09","from":"closure_required","to":"integrated_reviewed","command":"rerun-affected-gates-and-closure-review","condition":"affected-t0-t1-t2-green-and-critical-important-zero","allowed_delta":["external:add:closure-transaction-record","external:add:closure-review-verdict","git:cc:add:closure-feature-evidence","git:sub2api:none"]},
  {"id":"P1R-10","from":"integrated_reviewed","to":"integrated","command":"ordinary-merge-and-post-integration-capture","condition":"both-merges-and-post-integration-green","allowed_delta":["git:cc-main:ordinary-merge","git:sub2api-main:ordinary-merge","git:cc:add:attempt-evidence","external:add:post-integration-transaction-record"]},
  {"id":"P1R-11","from":"integrated","to":"exit_verified","command":"commit-phase1-handoff-and-receipt","condition":"receipt-chain-and-handoff-green","allowed_delta":["git:cc:add:handoff-receipt-and-registry-delta","external:add:phase1-exit-record"]}
]
```
<!-- ORACLE_PHASE1_RECOVERY_TRANSITIONS_END -->

Canonical contract digest: `sha256:b452bac4b990ae4359c433a36242bb6a2323587f3702cac56c4b74239c7f883d`.

`exit_verified` is terminal. It produces a terminal record rather than a fictitious successor lease.

## 6. Recovery Runtime Bootstrap

The accepted Recovery Plan authorizes one pre-baseline bootstrap wave because the current delivery
authority intentionally recognizes only the completed `DM-*` transition contract. This exception
exists only to make the reviewed Recovery contract executable; it cannot touch product, evidence,
registry, review/context, source bundle, or Sub2API paths.

Exact bootstrap path boundary:

- modify `tools/oracle-lab/delivery-authority.ts` to select a closed authority kind, recognize
  canonical `P1R-*` IDs, bind the exact committed Recovery contract digest, and produce a terminal
  record without inventing a successor lease;
- create `tools/oracle-lab/phase-1-recovery.ts` as the closed bundle/RED/replay/T2 controller;
- create `tests/oracle-lab-phase-1-recovery.test.ts` for contract, bundle, mapping, root, RED,
  successor, terminal, and mutation coverage;
- modify `tests/oracle-lab-delivery-authority.test.ts` only for cross-contract isolation and legacy
  transition regression;
- modify `package.json` only to add one `oracle:phase1:recovery` entry point.

Before bootstrap implementation, the new focused test must prove current main rejects the exact
Recovery marker as unsupported. This is bootstrap TDD RED, not the Phase 1 vertical RED. Implement
the minimum closed selection; caller-provided marker names, rows, digests, source commits, mappings,
or allowed deltas remain forbidden.

Run bootstrap focused tests, legacy delivery-transition tests, planning tests, build, and one real
bundle-to-pre-replay dry transaction that stops at `phase1_recovery_replay_required`. One bounded
cross-repository/authority review examines the immutable bootstrap tip. Batch material findings
once and perform one closure review; remaining material findings stop Recovery. Merge by ordinary
PR. After merge, discard every bootstrap test lease and freeze Mandatory Entry from the new main.

The bootstrap wave does not authorize P1R-01. The fresh sequence-zero Run Lease issued after its
merge is the first authority for the Phase Acceptance Contract.

## 7. Workspace And Resource Budget

Execution may create only:

- one clean CC controller/implementation worktree on
  `codex/oracle-phase-1-recovery-cc`;
- one clean Sub2API implementation worktree on
  `codex/oracle-phase-1-recovery-sub2api`;
- one independent clean Sub2API `main` contract clone;
- one clean main tool root per repository when post-integration recapture requires it;
- one disposable T2 replacement pair at a time;
- one external Recovery evidence root containing safe records and Run Leases.

Require at least 12 GiB free before a disposable pair or broad suite. Broad suites are strictly
serial. No automatic deletion occurs. Command-scoped caches must be outside tracked roots, 0700,
exclusive, source-inventoried, and reported as cleanup candidates. Preserved source roots and both
source bundles remain read-only until Phase 1 reaches `exit_verified`.

## 8. Mandatory Entry

### 8.1 Freeze remote and authority bytes

1. Fetch `muqihang/main` in both repositories using reviewed Git.
2. Prove the CC plan-merge commit and Sub2API main are current, clean, and unrelated rewinds are
   absent.
3. Verify the operating model, roadmap, transition exit report, this plan, original Phase 1 task
   plan, shared contract, source bundles, remote URLs, toolchain, and gate-schema digests.
4. Verify `git bundle verify` for both bundles in a read-only object quarantine. Import no object
   into implementation roots yet.
5. Initialize/sync each worktree's own CodeGraph. CodeGraph may index tracked files automatically,
   but controllers and reviewers must not directly query the protected keepalive test.

### 8.2 One bounded acceptance-contract review

Two independent read-only reviewers are required because the contract crosses repositories and
authority boundaries:

- Reviewer A: product ownership, B1-B3/listener transaction, expected RED/GREEN, path union;
- Reviewer B: bundle authority, lease/state transitions, evidence, resources, rollback, and stop
  rules.

They review this merged plan, the exact contract JSON, current code anchors, and source-history
anchors. They do not re-review all prose in the old Phase 1 plan. Findings are returned once,
batched once, and closed once. Minor or optional hardening enters the durable ledger. Material
findings remaining after closure stop Recovery and require operator simplification; no plan-repair
loop starts automatically.

### 8.3 Program Baseline Envelope and sequence zero

Reuse the existing Phase 1 plan-review and execution-context schemas as physical carriers. Create:

- `docs/superpowers/evidence/phase-1/phase-1-plan-review.json`;
- `docs/superpowers/evidence/phase-1/phase-1-execution-context.json`.

The context binds the accepted transition report, terminal record, this plan and contract digest,
source bundles, freshly fetched heads, branches, remote identities, shared contract, disabled
capabilities, protected paths, and selected requirements. Derive a logical Program Baseline
Envelope from immutable fields and issue an external sequence-zero Run Lease for `P1R-01`.

The initial CC commit adds exactly the review and context paths. Sub2API remains unchanged. Initial
pre/post-commit gates validate that topology. Run Lease refresh may update only time, clean-state,
and identical heads. Declared transitions use chained successors. Refresh never reopens plan review.

## 9. Real Pre-Replay RED

Run from fresh disposable roots created from the new baseline commits, before importing source
objects. The Recovery driver must first verify both bundles, authority artifacts, tool root, shared
contract, branches, and clean state. It then attempts the real Phase 1 catalog-to-feature-artifact
transaction.

The unique expected RED is:

```text
phase1_recovery_replay_required
```

It is valid only when all of these are simultaneously true:

- the current-main roots lack the reviewed Phase 1 command catalog and evidence adapter;
- no source object or product change has been imported;
- no restart artifact, feature artifact, plan review, or old execution context is selected;
- both product branches remain unchanged and the intended feature artifact is absent;
- attempts to supply any pre-transition review/context/restart bytes fail separately as
  `phase1_recovery_historical_authority_forbidden`.

A compiler error, missing dependency, stale ref, dirty root, bundle failure, network attempt, or any
B4-B6 leaf is unrelated and cannot satisfy P1R-02.

## 10. Exact Rehydration

The Recovery driver imports objects from the validated bundles into disposable object quarantine,
then replays to the fresh feature branches. It never fetches source worktree HEAD implicitly and
never creates archival local branches in implementation roots.

CC source authority is `d5a711614177906d18486b98ff4c5d45d97e04c7`; Sub2API source authority is
`20217731da9521f9676434b7bd5f9cb73020c32c`. Replay exactly the 8 CC and 10 Sub2API source commits
already compiled by transition instance `0002`, in the same order. Continue to skip the two exact
historical authority-only CC commits and every old review, context, and restart artifact.

For every mapping prove:

- source object and sole parent;
- stable patch-id;
- UTF-8 sorted path/status/mode tuples;
- contiguous replacement parent;
- no protected-path intersection;
- projected tree equality after exact historical-authority exclusions;
- resulting branch clean state.

The mapping record is safe metadata only. It contains no raw patch, secret, absolute root, or source
material. Any conflict, empty commit, extra commit, skipped product commit, changed mode, unexpected
path, or caller-selected mapping stops Recovery without conflict resolution.

## 11. Replayed Product Anchors

The rehydrated source must retain these existing call paths:

- Sub2API `FormalPoolOnboardingService.authorizeSession`: authority -> record -> owner ->
  reservation-adjacent `FormalPoolOnboardingPrincipalRevalidator` -> version/state;
- Sub2API `beginReservedMutation` and idempotent reservation paths: CAS before external dependency;
- browser egress proof consumption and single-use finalization;
- configured `public_origin`, never Host or `X-Forwarded-*`, as response authority;
- CC `startProxy`: `resolveListenerBoundary` and `resolveUpstreamTLSBoundary` before auth replay,
  TLS-file read, server creation, or listen;
- H1 `captureAndRunPhase1`: exact root/context/catalog/contract binding, sandbox canaries, closed
  dependency preparation, command-by-command ignored-state checks, exact result classification, and
  immutable baseline/results output.

CodeGraph source indexes used during planning were current at CC source head `d5a7116` and Sub2API
source head `2021773`. Execution refreshes indexes after replay and verifies these symbols and their
call paths again.

## 12. Test Ladder And Recovery T2

### T0: focused

- delivery authority and Recovery contract parser/mutation tests;
- bundle, mapping, path-union, branch, clean-state, lease, and terminal-record tests;
- Sub2API authorization ordering, stale principal, owner/version/state, reservation, browser proof,
  public origin, frontend version propagation, and route middleware tests;
- CC listener, upstream TLS, `startProxy` negative integration, sidecar production trust, and
  sandbox tests;
- build/typecheck for both applicable frontend and CC roots.

### T1: contract and exact RED

- shared-contract bytes equal in both repositories and independent contract clone;
- CC preserved RED: exactly 61 canonical leaves;
- sidecar preserved RED: exactly 51 canonical leaves;
- exact event/unique counts, sorted multiset, unique names, families, parser lifecycle, malformed,
  truncated, missing, extra, duplicate, and reordered mutations;
- B1-B3/listener positive and side-effect-zero rejection matrix.

### T2: real Phase 1 vertical transaction

From fresh disposable roots and loopback-only dependencies, execute:

```text
new baseline + valid principal
  -> create session with idempotency reservation
  -> server-observed browser proof and single-use finalization
  -> public-origin response generation
  -> CC listener/upstream TLS startup validation
  -> exact H1 catalog run
  -> feature baseline and command-results artifacts
```

The transaction is GREEN only when B1-B3/listener owned outcomes pass, B4-B6 produce their exact
expected RED inventories, all external side-effect counters match, no unauthorized socket appears,
both tested roots remain clean, and artifacts bind the current Run Lease and tested heads.

T2 runs before integrated review, after an intersecting closure fix, and again from merged main for
post-integration capture. It is not repeated for wording, plan-only, or disjoint evidence changes.

### T3: bounded campaign

Run one stable-tip campaign covering concurrency/replay races, stale principal after guard, proof
reuse, idempotency duplication, public-origin header mutation, listener/TLS negative fixtures,
ignored-state mutation, dependency drift, and evidence parser mutations. Repetition count follows a
declared flakiness or confidence hypothesis; there is no ceremonial three-run rule.

## 13. Task 8 Completion

After P1R-04 GREEN, issue a fresh feature-capture lease at identical clean candidate heads. Use a
new immutable namespace, starting at the first unused `feature-NNNN`; never reuse prior ignored or
historical output.

1. Capture feature baseline and command results through `captureAndRunPhase1`.
2. Commit exactly those two paths as one child of the tested CC head; Sub2API does not move.
3. Run the bounded integrated review against the tested implementation trees and T2/T3 records.
4. Commit exactly the feature-review attestation after zero-Critical/zero-Important approval.
5. If material findings exist, batch them once across declared product paths, rerun affected
   T0/T1/T2/T3, recapture baseline/results/review attestation under the next immutable feature
   namespace, and perform one closure review. Earlier evidence remains historical and cannot be
   selected by integration entry. Remaining material findings stop Phase 1.

No reviewer may expand closure into Phase 2, upstream compatibility, optional hardening, wording,
or production/canary requirements.

## 14. Merge, Post-Integration, And Exit

Merge Sub2API and CC candidate branches by ordinary merge commits only. Then use fresh clean main
roots and a distinct controller root to:

1. verify merge parents and reviewed candidate ancestry;
2. recapture post-integration results under the first unused `attempt-NNNN` namespace;
3. validate implementation-tree equality with the feature review;
4. commit integration entry, results, receipt, handoff, and only the exact registry deltas authorized
   by the original Task 8 requirements;
5. produce a Phase Transaction Record and terminal `exit_verified` record.

The final report must state B1-B3/listener outcomes, exact B4-B6 expected RED status, tested and
merged heads, artifact digests, Minor ledger, retained cleanup candidates, and disabled
capabilities. It must not claim production compatibility, upstream equivalence, profile readiness,
or canary authorization.

## 15. Commit Boundaries

Before product replay:

1. one CC authority commit adding plan review and sequence-zero context;
2. no Sub2API commit.

Product recovery:

- exactly 8 mapped CC replacement commits;
- exactly 10 mapped Sub2API replacement commits;
- no conflict-resolution or aggregate squash commit.

Evidence and review:

- one CC feature baseline/results commit;
- one CC feature-review attestation commit;
- at most one combined closure wave if required;
- ordinary merge commits;
- bounded post-integration evidence commits defined by Task 8.

Run Lease records and large transaction records remain external; repository evidence stores safe
digests and closed summaries only.

## 16. Stop Rules

Stop without another repair loop when:

- either source bundle, source head, remote identity, shared contract, or plan authority drifts;
- P1R-02 does not reach its one exact RED after all preceding checks pass;
- replay needs caller mappings, hidden refs, conflict resolution, extra commits, or protected-file
  modification;
- any preserved B4-B6 name/count/family/lifecycle differs;
- T2 requires real network, credentials, manual cache warmup, user checkout mutation, or substituted
  contract bytes;
- resource use exceeds the declared roots or free space falls below 12 GiB before a new heavy step;
- a second integrated-review fix wave would be required;
- Critical or Important findings remain after the one closure review.

The controller reports one classified blocker and an exact retained-root list. It does not edit the
plan, mint a replacement envelope, or start another reviewer unless the operator explicitly chooses
architecture simplification.

## 17. Rollback And Cleanup

Before merge, rollback is branch abandonment; no main branch changes. Failed disposable roots are
retained for evidence and never auto-deleted. After one repository merges and the other fails, stop
with split-integration evidence; do not revert or force-push automatically.

Only after `exit_verified` may a separate cleanup decision consider the candidates in the transition
exit report. Source roots and bundles remain until Recovery records prove all necessary objects and
digests are available from integrated history or retained archives.

## 18. Execution Deliverables

- accepted Recovery Plan review verdict;
- Program Baseline Envelope digest and sequence-zero Run Lease;
- exact pre-replay RED record;
- 8/10 replay mapping record;
- T0/T1/T2/T3 results on immutable tips;
- feature baseline, command results, and review attestation;
- ordinary merge identities and post-integration attempt receipt;
- Phase 1 handoff, exit record, Minor ledger, and cleanup candidates;
- explicit confirmation that the protected keepalive test was not directly accessed or changed.

## 19. Exit Gate

This plan may be approved only when its bounded acceptance-contract review returns zero Critical and
zero Important findings. Approval authorizes only the exact Recovery Runtime Bootstrap path set.
After that bootstrap merges and Mandatory Entry passes, sequence-zero authority permits P1R-01.
Each later command requires the current unexpired chained Run Lease.

Phase 1 completes only at `exit_verified`. A merged Recovery Plan, GREEN preflight, replay success,
or feature review alone is not Phase 1 completion.
