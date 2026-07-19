# Claude Code 2.1.207 Phase 1 Recovery Plan

Status: draft for bounded acceptance-contract review. This document does not authorize execution.

## 1. Objective

Resume the paused Phase 1 once, under Oracle Delivery Operating Model v2, without replaying the old
authorization loop or reimplementing completed Task 1-7 work. The recovery must:

1. freeze a new Program Baseline Envelope and sequence-zero Run Lease;
2. prove four real pre-replay RED families from current main plus one replay-required sentinel;
3. rehydrate the exact reviewed 8 CC Gateway and 10 Sub2API implementation commits from validated
   source bundles into fresh branches;
4. prove B1-B3 and the Phase 1 listener slice GREEN while preserving the exact B4-B6 RED corpus;
5. complete Task 8 feature capture, bounded review, ordinary merge, post-integration recapture, and
   handoff;
6. leave production, real upstream, real canary, feature-profile promotion, and cleanup disabled.

Phase 1 Task 1-8 remains paused until this exact plan is merged, independently approved with zero
Critical and zero Important findings, and its fresh sequence-zero lease is issued.

## 2. Authority And Precedence

Product authority and delivery-mechanics authority are separate lanes. A document in one lane cannot
silently override the other lane.

Product requirements retain their existing precedence:

1. `docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md`
2. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md`
3. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-adversarial-validation-v2.md`
4. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-design.md`
5. `docs/superpowers/plans/2026-07-15-claude-code-2.1.207-phase-1-control-plane-boundary-repairs.md`
   as the Phase 1 realization of those requirements

The seven-phase roadmap owns phase scope, dependencies, and handoff. Delivery mechanics are governed
by the operating model, the accepted transition report and terminal record, and then this plan's
embedded contract. This Recovery Plan may narrow only Phase 1 execution mechanics. It cannot
override product requirements, requirement precedence, roadmap ownership, or later-phase scope.

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
  {"id":"P1R-01","from":"baseline_frozen","to":"vertical_red_confirmed","command":"run-pre-replay-vertical-red","condition":"exact-real-b1-b2-b3-listener-red-and-replay-sentinel","allowed_delta":["disposable:add:cc-pre-replay-root","disposable:add:sub2api-pre-replay-root","external:add:pre-replay-b1-red-record","external:add:pre-replay-b2-red-record","external:add:pre-replay-b3-red-record","external:add:pre-replay-listener-red-record","external:add:replay-required-sentinel","forbid:external-side-effect","forbid:listener-socket","forbid:product-branch-change","forbid:restart-artifact"]},
  {"id":"P1R-02","from":"vertical_red_confirmed","to":"replay_complete","command":"rehydrate-reviewed-implementation","condition":"exact-8x10-replay","allowed_delta":["git:cc:exact-eight-replay-commits","git:sub2api:exact-ten-replay-commits","external:add:replay-mapping-record"]},
  {"id":"P1R-03","from":"replay_complete","to":"task7_green_confirmed","command":"run-replay-verification","condition":"t0-t1-t2-green","allowed_delta":["external:add:recovery-transaction-record","git:cc:none","git:sub2api:none"]},
  {"id":"P1R-04","from":"task7_green_confirmed","to":"feature_capture_authorized","command":"issue-feature-capture-lease","condition":"fresh-clean-candidate-heads","allowed_delta":["git:cc:add:feature-context","external:add:feature-capture-run-lease","git:sub2api:none"]},
  {"id":"P1R-05","from":"feature_capture_authorized","to":"feature_green_confirmed","command":"capture-feature-evidence","condition":"feature-candidate-green","allowed_delta":["git:cc:add:feature-baseline-and-results","external:add:feature-transaction-record","git:sub2api:none"]},
  {"id":"P1R-06","from":"feature_green_confirmed","to":"review_decided","command":"run-stable-tip-campaign-and-bounded-integrated-review","condition":"stable-tip-t3-green-bound-to-t2-and-review-verdict-recorded","allowed_delta":["external:add:stable-tip-t3-campaign-record","external:add:integrated-review-verdict","git:cc:none","git:sub2api:none"]},
  {"id":"P1R-07A","from":"review_decided","to":"integrated_reviewed","command":"accept-zero-material-findings","condition":"critical-important-zero","allowed_delta":["git:cc:add:feature-review-attestation","git:sub2api:none"]},
  {"id":"P1R-07B","from":"review_decided","to":"closure_required","command":"apply-one-product-closure-wave","condition":"critical-important-nonzero","allowed_delta":["git:cc:declared-product-fix-paths","git:sub2api:declared-product-fix-paths","git:combined:max-one-closure-wave"]},
  {"id":"P1R-08","from":"closure_required","to":"integrated_reviewed","command":"rerun-affected-gates-campaigns-and-closure-review","condition":"affected-t0-t1-t2-t3-green-and-critical-important-zero","allowed_delta":["external:add:closure-transaction-record","external:add:closure-t3-campaign-record","external:add:closure-review-verdict","git:cc:add:closure-feature-evidence-and-attestation","git:sub2api:none"]},
  {"id":"P1R-09","from":"integrated_reviewed","to":"implementation_merged","command":"ordinary-merge-reviewed-implementation","condition":"both-ordinary-merges-match-reviewed-candidates","allowed_delta":["git:cc-main:ordinary-merge","git:sub2api-main:ordinary-merge"]},
  {"id":"P1R-10","from":"implementation_merged","to":"post_integration_captured","command":"capture-and-commit-post-integration-evidence","condition":"merged-main-t2-green-and-exact-artifact-receipt-topology","allowed_delta":["git:cc:add:exact-post-integration-artifact-commit","git:cc:add:one-file-receipt-child","external:add:post-integration-transaction-record","git:sub2api:none"]},
  {"id":"P1R-11","from":"post_integration_captured","to":"evidence_review_decided","command":"review-post-integration-evidence","condition":"independent-evidence-review-verdict-recorded","allowed_delta":["external:add:post-integration-evidence-review-verdict","git:cc:none","git:sub2api:none"]},
  {"id":"P1R-12","from":"evidence_review_decided","to":"evidence_merged","command":"ordinary-merge-post-integration-evidence","condition":"critical-important-zero-and-evidence-pr-merged","allowed_delta":["git:cc-main:ordinary-evidence-merge","git:sub2api:none"]},
  {"id":"P1R-13","from":"evidence_merged","to":"final_remote_verified","command":"verify-final-remote-mains","condition":"fresh-final-remote-verifier-green","allowed_delta":["external:add:final-remote-verification-record","git:cc:none","git:sub2api:none"]},
  {"id":"P1R-14","from":"final_remote_verified","to":"exit_verified","command":"publish-phase1-exit","condition":"receipt-chain-handoff-and-final-remote-green","allowed_delta":["external:add:phase1-exit-record"]}
]
```
<!-- ORACLE_PHASE1_RECOVERY_TRANSITIONS_END -->

Canonical contract digest: `sha256:4fb422c47b62519552fe1d21dee53576309df145c280d05c41d575bfdb82c3fe`.

`exit_verified` is terminal. It produces a terminal record rather than a fictitious successor lease.

## 6. Recovery Runtime Bootstrap

The accepted Recovery Plan authorizes one pre-baseline bootstrap wave because the current delivery
authority intentionally recognizes only the completed `DM-*` transition contract. This exception
exists only to make the reviewed Recovery contract executable; it cannot touch product, evidence,
registry, review/context artifact, source bundle, or Sub2API paths.

Exact bootstrap path boundary:

- modify `tools/oracle-lab/delivery-authority.ts` to select a closed authority kind, recognize
  canonical `P1R-*` IDs, bind the exact committed Recovery contract digest, and produce a terminal
  record without inventing a successor lease;
- create `tools/oracle-lab/phase-1-recovery.ts` as the closed bundle/RED/replay/T2 controller;
- create `tests/oracle-lab-phase-1-recovery.test.ts` for contract, bundle, mapping, root, RED,
  successor, terminal, and mutation coverage;
- modify `tests/oracle-lab-delivery-authority.test.ts` only for cross-contract isolation and legacy
  transition regression;
- minimally extend `docs/superpowers/schemas/oracle-lab-phase-1-plan-review.schema.json` and
  `docs/superpowers/schemas/oracle-lab-phase-1-execution-context.schema.json` with a closed Recovery
  mode; the legacy mode and all legacy fixtures remain byte-for-byte semantically valid;
- modify `tests/oracle-lab-phase-1-planning.test.ts` only to validate the Recovery-mode plan path,
  branch constants, immutable envelope bindings, carrier-schema digests, and sequence-zero topology;
- modify `package.json` only to add one `oracle:phase1:recovery` entry point.

Recovery mode in the two existing carrier schemas uses a top-level closed discriminator; it is not a
new schema family. It permits only this plan path, branches `codex/oracle-phase-1-recovery-cc` and
`codex/oracle-phase-1-recovery-sub2api`, and a closed `recovery_authority` object binding the operating
model, roadmap, transition plan, accepted transition report, terminal controller-chain and acceptance
records, canonical Recovery contract, both source bundles, and shared contract. Both schema digests
are frozen after bootstrap merge and included in the Program Baseline Envelope. Legacy plan paths,
v8 branches, or mixed legacy/Recovery fields are rejected in Recovery mode.

The Recovery plan-review carrier binds exactly the two accepted reviewer roles, identities, reviewed
commit/digest, scopes, verdicts, and finding counts; both must be approved with zero Critical and zero
Important. The Recovery execution-context carrier replaces legacy planning provenance with the
closed authority bindings above, retains the two carrier-schema path/digest bindings, and binds the
fresh CC/Sub2API main and implementation heads, exact Recovery branches, remote URL digests,
protected paths, disabled capabilities, and selected requirements. No optional or free-form field is
accepted in either Recovery mode.

Before bootstrap implementation, the new focused test must prove current main rejects the exact
Recovery marker as unsupported. This is bootstrap TDD RED, not the Phase 1 vertical RED. Implement
the minimum closed selection; caller-provided marker names, rows, digests, source commits, mappings,
or allowed deltas remain forbidden.

Run bootstrap focused tests, legacy delivery-transition tests, planning tests, build, and one real
bundle-to-pre-replay dry transaction that reaches the four real RED records plus
`phase1_recovery_replay_required`. One bounded cross-repository/authority review examines the
immutable bootstrap tip. Batch material findings once and perform one closure review; remaining
material findings stop Recovery. Merge by ordinary PR. After merge, discard every bootstrap test
lease and freeze Mandatory Entry from the new main.

The immutable-tip acceptance review that closes this document is the sole pre-bootstrap approval
gate. After merge, the controller verifies that the committed plan bytes and digest exactly equal
the reviewed bytes; it does not commission a second plan review. Bootstrap review covers only the
implementation of this accepted contract. Bootstrap does not authorize P1R-01. Mandatory Entry then
creates the approved Recovery carrier artifacts, freezes the envelope, and issues sequence zero as
one explicit pre-contract entry operation. That lease is the first authority for P1R-01.

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

### 8.2 Bind the accepted acceptance-contract review

The two independent read-only reviewers required because the contract crosses repositories and
authority boundaries are the pre-bootstrap reviewers of this immutable plan tip:

- Reviewer A: product ownership, B1-B3/listener transaction, expected RED/GREEN, path union;
- Reviewer B: bundle authority, lease/state transitions, evidence, resources, rollback, and stop
  rules.

They review the exact contract JSON, current code anchors, and source-history anchors. They do not
re-review all prose in the old Phase 1 plan. Findings are returned once, batched once, and closed
once. Minor or optional hardening enters the durable ledger. Material findings remaining after
closure stop Recovery and require operator simplification; no plan-repair loop starts
automatically. Mandatory Entry verifies the merge retained the exact reviewed plan bytes and binds
those already accepted verdicts into the plan-review carrier; it does not run another holistic plan
review.

### 8.3 Program Baseline Envelope and sequence zero

Reuse the Recovery mode added to the existing Phase 1 plan-review and execution-context schemas as
physical carriers. Create:

- `docs/superpowers/evidence/phase-1/phase-1-plan-review.json`;
- `docs/superpowers/evidence/phase-1/phase-1-execution-context.json`.

The context binds the accepted transition report, terminal record, this plan and contract digest,
source bundles, freshly fetched heads, branches, remote identities, shared contract, disabled
capabilities, protected paths, selected requirements, and both freshly merged carrier-schema
digests. Derive a logical Program Baseline Envelope from immutable fields and issue an external
sequence-zero Run Lease for `P1R-01`.

This carrier commit, envelope freeze, and sequence-zero issuance are a controller-authorized
pre-contract entry operation, not an observed `P1R-*` delta. The initial CC commit adds exactly the
review and context paths. Sub2API remains unchanged. Initial pre/post-commit gates validate that
topology. Run Lease refresh may update only time, clean-state, and identical heads. Declared
transitions use chained successors. Refresh never reopens plan review.

## 9. Real Pre-Replay RED

Run from fresh disposable roots created from the new baseline commits, before importing source
objects. The Recovery driver must first verify both bundles, authority artifacts, tool root, shared
contract, branches, and clean state. A controller-owned closed harness then invokes the actual
current-main product entrypoints, not a mock catalog or missing-adapter shortcut, and records four
independent RED families:

1. **B1:** execute
   `TestFormalPoolBrowserEgressAttestationRejectsUntrustedProofs` through the real
   `FormalPoolOnboardingService`; exact failure classification is `b1_proof_finalization_missing`,
   with zero proxy-observer and account-creation calls;
2. **B2:** execute `TestFormalPoolOnboardingAuthorizationRejectsCrossBoundaryOperations` and
   `TestFormalPoolOnboardingAuthorizationDimensionsAreIndependent` through the real handler,
   middleware, service, and reservation paths; exact classification is
   `b2_authority_reservation_missing`, with zero external dependency calls;
3. **B3:** execute `TestFormalPoolOnboardingPublicOriginAuthority` through the real route; hostile
   Host and `X-Forwarded-*` mutation changing emitted authority produces exact classification
   `b3_public_origin_authority_missing`, with zero external calls;
4. **Listener/TLS:** invoke the real CC `startProxy` with the remote-listener-without-prerequisites
   and invalid-TLS/upstream fixtures; exact classifications are `listener_boundary_not_enforced` and
   `tls_boundary_order_not_enforced`. The harness closes any unexpectedly returned server, proves
   zero upstream calls, and proves no listener remains after the command.

Each family has its own command identity, exact failing leaf names/count, parser lifecycle, side-
effect counters, before/after root inventory, and immutable external RED record. An unrelated Go,
Node, import, dependency, or compilation failure cannot satisfy a family. After those four real
transactions, the driver attempts the current-main catalog-to-feature-artifact transaction. Its
additional expected replay sentinel is:

```text
phase1_recovery_replay_required
```

The sentinel is valid only when all of these are simultaneously true:

- the current-main roots lack the reviewed Phase 1 command catalog and evidence adapter;
- no source object or product change has been imported;
- no restart artifact, feature artifact, plan review, or old execution context is selected;
- both product branches remain unchanged and the intended feature artifact is absent;
- attempts to supply any pre-transition review/context/restart bytes fail separately as
  `phase1_recovery_historical_authority_forbidden`.

A compiler error, missing dependency, stale ref, dirty root, bundle failure, network attempt, any
B4-B6 leaf, or the replay sentinel without all four real RED records is unrelated and cannot satisfy
P1R-01.

## 10. Exact Rehydration

The Recovery driver imports objects from the validated bundles into disposable object quarantine,
then replays to the fresh feature branches. It never fetches source worktree HEAD implicitly and
never creates archival local branches in implementation roots.

CC source authority is `d5a711614177906d18486b98ff4c5d45d97e04c7`; Sub2API source authority is
`20217731da9521f9676434b7bd5f9cb73020c32c`. This plan directly authorizes these exact ordered source
commits; no retired restart instance supplies runtime authority:

```text
CC: 410fbe0c784c9eea04685cc251909d8df75b6871
    e2972e6f6b27c658d9a6e91379ba9cea834cd4cb
    beabd36547daa6236c1caa142a0a1b5a926bbde3
    bedc81ca5c0aa9e0991a2f0bc42b62c4dd62f8db
    540962ea9c068c82d5dbe07b5aeae172fa6258e6
    e43f50816c8b693f875fc485a99dcdf9d985080e
    8cbc5c633c7f791b395198aedd2db2e55f01915b
    d5a711614177906d18486b98ff4c5d45d97e04c7

Sub2API: 267b3d074248a7e1f7cf16bf302f91b41fa754ec
         cff380892f64720c046d581723d0faf13cb566fc
         b90254865b11be445a73faeeb0bbf1c0ff5384dd
         e49100746f8e00d83168864dab2a4235053d16d7
         33cac77640cccf5bbd87ab79ea9e44ef2c125da7
         7ffaebdaa32aa3b9896cf6a3c554a671255b98d3
         da7a01ac692553c9886c4ef14d0f9d5cb29c0a45
         75dc3c0fd38acea12f373207521d9927c01c25ad
         0f2271946686458458e959d3952e56f75c9e50fe
         20217731da9521f9676434b7bd5f9cb73020c32c
```

Skip exactly CC commits `1c8f25bb1ca31c5c16262fec71f93dd1e14f512d` and
`6621c7a78432a895d261054e291aed74c04978c3`, which contain only historical authority artifacts.
Every old review, context, and restart artifact remains excluded. No other gap or source commit is
allowed.

For every mapping prove:

- source object and sole parent;
- zero-context verbatim semantic patch-id (`git diff --binary --full-index -U0 | git patch-id --verbatim`);
- UTF-8 sorted path/status/mode tuples;
- contiguous replacement parent;
- no protected-path intersection;
- projected tree equality after exact historical-authority exclusions;
- resulting branch clean state.

The mapping record is safe metadata only. It contains no raw patch, secret, absolute root, or source
material. Any conflict, empty commit, extra commit, skipped product commit, changed mode, unexpected
path, or caller-selected mapping stops Recovery without conflict resolution.

The semantic patch fingerprint intentionally excludes hunk context so an unrelated adjacent line
already present on the reviewed current main cannot change the source-to-replacement identity. The
verbatim mode retains whitespace in every added and removed line, so string, regex, indentation, and
other whitespace-sensitive content cannot collide. Because patch-id intentionally ignores hunk line
numbers, it is necessary but not sufficient: the validator must also load the replacement parent into
an isolated command-scoped index/object database, apply the exact source `-U0` binary patch with
`git apply --cached --unidiff-zero`, and require the resulting `git write-tree` OID to equal the
replacement commit tree OID. The scratch object database may read the authenticated replacement
object database only as an alternate and must be removed without changing the replacement repository.
This rejects relocating an otherwise identical delta between repeated hunks while retaining the
adjacent-current-main compatibility proved by the semantic fingerprint. It does not relax any other
mapping proof: exact sole parents, zero-context verbatim content delta, UTF-8 sorted
path/status/mode tuples, protected-path exclusion, projected-tree equality, and clean replacement
state remain mandatory.

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

The campaign record binds the immutable feature tip and exact T2 transaction digest. P1R-06 cannot
record a review verdict until that record is GREEN. A closure batch reruns every T3 campaign whose
declared inputs, changed paths, or covered invariants intersect the batch. Recovery uses the simpler
closed rule that all Phase 1 product closure paths are intersecting, so P1R-08 always requires a new
closure-tip T3 record; it does not reuse the earlier campaign through a caller-asserted disjointness
claim.

## 13. Task 8 Completion

After P1R-03 GREEN, issue a fresh feature-capture lease at identical clean candidate heads. Use a
new immutable namespace, starting at the first unused `feature-NNNN`; never reuse prior ignored or
historical output.

1. Capture feature baseline and command results through `captureAndRunPhase1`.
2. Commit exactly those two paths as one child of the tested CC head; Sub2API does not move.
3. Run the stable-tip T3 campaign, then the bounded integrated review against the tested
   implementation trees and exact T2/T3 records. The verdict is external and changes no repository.
4. Commit exactly the feature-review attestation only after zero-Critical/zero-Important approval.
5. If material findings exist, batch them once across declared product paths, rerun affected
   T0/T1/T2/T3, recapture baseline/results/review attestation under the next immutable feature
   namespace, and perform one closure review. Earlier evidence remains historical and cannot be
   selected by integration entry. Remaining material findings stop Phase 1.

No reviewer may expand closure into Phase 2, upstream compatibility, optional hardening, wording,
or production/canary requirements.

## 14. Merge, Post-Integration, And Exit

Merge Sub2API and CC candidate branches by ordinary implementation PR merge commits only. Then use
fresh clean main roots and a distinct controller root to:

1. verify merge parents and reviewed candidate ancestry;
2. recapture post-integration results under the first unused `attempt-NNNN` namespace and rerun the
   merged-main T2 transaction;
3. validate implementation-tree equality with the feature review;
4. create one exact artifact commit containing integration entry, baseline, results, handoff, exit
   report, and only the three governance-file deltas authorized by the original Task 8 requirements;
5. create its sole one-file child containing only the self-reference-safe integration receipt;
6. independently review both exact commits, receipt-chain topology, merged-main bindings, RED
   inventories, sandbox proof, leak audit, disabled capabilities, and governance transitions;
7. after zero Critical and zero Important findings, merge the post-integration evidence branch by an
   ordinary evidence PR merge commit;
8. fetch both remotes into new clean detached roots and run the closed final-remote verifier. It must
   prove remote identities, implementation-tree equality, merge ancestry, artifact/receipt commit
   topology, complete reachable receipt history, evidence-only CC descendants, no Sub2API tracked
   descendant delta, and ignored-state stability during verification;
9. produce the Phase Transaction Record and terminal `exit_verified` record only after the final
   verifier returns GREEN (`ready` or a fully validated later `superseded` receipt).

Changes requested by the post-integration evidence review stop the attempt and follow only the
evidence-retry rules already defined by the original Task 8 plan. They cannot modify implementation,
reuse an invalid receipt, or enter `evidence_merged`. Implementation-tree drift invalidates the
feature review and stops this Recovery Plan rather than opening another repair loop.

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
- ordinary implementation merge commits;
- one exact post-integration artifact commit and its one-file receipt child;
- one ordinary post-integration evidence PR merge commit.

Run Lease records and large transaction records remain external; repository evidence stores safe
digests and closed summaries only.

## 16. Stop Rules

Stop without another repair loop when:

- either source bundle, source head, remote identity, shared contract, or plan authority drifts;
- P1R-01 does not reach all four real RED records and its replay sentinel after all preceding checks
  pass;
- replay needs caller mappings, hidden refs, conflict resolution, extra commits, or protected-file
  modification;
- any preserved B4-B6 name/count/family/lifecycle differs;
- T2 requires real network, credentials, manual cache warmup, user checkout mutation, or substituted
  contract bytes;
- resource use exceeds the declared roots or free space falls below 12 GiB before a new heavy step;
- a second integrated-review fix wave would be required;
- post-integration evidence review reports material implementation drift, or final-remote
  verification is not GREEN;
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
- four exact real pre-replay RED records plus the replay-required sentinel;
- 8/10 replay mapping record;
- T0/T1/T2/T3 results on immutable tips;
- feature baseline, command results, and review attestation;
- ordinary implementation and evidence merge identities, exact artifact/receipt commit chain, and
  post-integration attempt receipt;
- final-remote verification, Phase 1 handoff, exit record, Minor ledger, and cleanup candidates;
- explicit confirmation that the protected keepalive test was not directly accessed or changed.

## 19. Exit Gate

This plan may be approved only when its bounded pre-bootstrap acceptance-contract review returns zero
Critical and zero Important findings. Approval authorizes only the exact Recovery Runtime Bootstrap
path set. After the plan and bootstrap merge, byte-identity validation plus Mandatory Entry creates
the Recovery carriers and envelope and issues sequence zero as a pre-contract entry operation.
Sequence-zero authority then permits P1R-01. Each later command requires the current unexpired
chained Run Lease.

Phase 1 completes only at `exit_verified`. A merged Recovery Plan, GREEN preflight, replay success,
or feature review alone is not Phase 1 completion.
