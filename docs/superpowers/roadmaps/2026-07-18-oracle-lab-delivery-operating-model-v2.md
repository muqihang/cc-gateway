# Oracle Lab Delivery Operating Model v2

## Status

- Date: 2026-07-18
- Scope: all seven top-level Oracle Lab delivery phases
- State: candidate operating model; no implementation or execution authority until operator approval
- Product authority remains, in precedence order:
  1. Review Amendments
  2. Hardening Amendments
  3. Adversarial Validation v2
  4. Oracle Lab Design
- Phase ownership and dependency authority remain in the Oracle Lab Delivery Roadmap.
- This document governs delivery mechanics only. It cannot weaken a product requirement, evidence
  ceiling, production prohibition, or canary approval boundary.

## 1. Why This Model Exists

The Phase 1 repair sequence demonstrated a systemic delivery failure. From PR #10 through PR #20,
eleven governance or authority-repair merge commits landed over roughly fifty-two hours while the
real post-replay restart transaction still had not completed. Focused tests, repeated full suites,
and independent reviews were individually green, but they did not execute the state in which the
next real command failed.

The immediate failure was mechanically predictable:

```text
pre-replay main runtime equality
+ a reviewed replay commit that changes package.json
+ a post-replay build command that re-enforces pre-replay equality
= deterministic post-replay rejection
```

The process optimized local proof depth while omitting vertical transaction coverage. This model
changes the unit of delivery from a document, task, or reviewer verdict to an executable phase
transaction with explicit states and authority sources.

## 2. Objectives

The model MUST:

1. discover state and authority contradictions before an implementation or repair PR is merged;
2. preserve fail-closed security, evidence safety, traceability, and claim ceilings;
3. make the cheapest relevant test fail first and reserve expensive campaigns for stable tips;
4. prevent lease renewal from reopening immutable design or implementation review;
5. limit one phase to one consolidated authority-repair wave before mandatory simplification;
6. use real pinned artifacts and commits for vertical proof instead of synthetic substitutes;
7. bound worktree, clone, cache, review, and evidence growth;
8. let a new Claude Code version reuse unaffected contracts and phase evidence;
9. produce a durable handoff that another controller can execute without reconstructing intent;
10. stop honestly when evidence remains unknown, contradictory, expired, or unavailable.

The model does not promise zero defects. It moves material defects earlier, makes their detection
executable, and caps the number of repair loops.

## 3. Retained, Simplified, and Retired Controls

### 3.1 Retained

The following controls remain mandatory:

- requirement registry and Claim Matrix;
- governing-document precedence and phase ownership;
- immutable Git and dependency baselines;
- dirty-tree and unexpected-delta detection;
- CodeGraph-assisted discovery when an index exists;
- expected RED separated from accidental regression;
- exact negative-capability and fail-closed behavior;
- safe evidence, retention, redaction, and destruction rules;
- production and real-canary prohibitions;
- phase exit report, registry delta, and handoff bundle;
- independent review for security boundaries and cross-repository contracts.

### 3.2 Simplified

These controls remain but operate at a coarser, useful boundary:

- holistic review occurs at baseline authority changes and final integrated candidates, not at
  every lease renewal or small task commit;
- full regression runs at stable transaction tips, not after every plan wording change;
- context freshness is enforced by a lightweight run lease, not a new design review;
- task commits remain small and traceable, but independent review is batched at the integrated
  vertical transaction unless the task crosses an irreversible or external boundary;
- phase evidence uses existing generic run-manifest and handoff concepts before adding any new
  schema family.

### 3.3 Retired

The following patterns are forbidden for future phases:

- prose-regex tests used as a substitute for an executable state transition;
- three repeated full-suite runs treated as proof of untested scenarios;
- synthetic replay commits used as the only proof for real pinned replay history;
- a new permanent clone, worktree, receipt, or schema for every discovered blocker;
- automatic holistic re-review when only a run lease timestamp changes;
- one reviewer round per task followed by another unbounded holistic review chain;
- fixing only the most recently observed gate without replaying the complete affected transaction;
- caller-selected exceptions, hidden refs, restored files, or manual state that make a gate pass.

## 4. Delivery Authority Objects

The model uses four logical objects. Existing schemas SHOULD be reused or minimally extended; this
document does not authorize a new schema family by itself.

### 4.1 Program Baseline Envelope

The Program Baseline Envelope binds immutable authority:

- governing document and roadmap digests;
- selected requirement and work-package slices;
- repository commits and remote identity digests;
- shared contract, package, toolchain, and schema digests;
- capability ceilings and disabled external actions;
- phase entry predecessor receipts;
- vertical transaction contract digest;
- owner and required reviewer roles.

The envelope changes only when one of those authority inputs changes. Expiry alone does not change
it. A main-branch advance that is not the bound commit requires a new envelope; ancestry alone is
insufficient. The initial envelope is frozen only after a draft Phase Acceptance Contract exists,
so it binds that contract's exact digest. If the bounded acceptance-contract review changes an
authority input, one consolidated update replaces the envelope and re-proves the expected RED;
remaining material findings after closure stop the phase instead of starting another envelope loop.

### 4.2 Run Lease

The Run Lease is short-lived execution authority. It binds:

- one Program Baseline Envelope digest;
- exact worktree realpaths, branches, and current heads;
- clean-state digests;
- stage and state-machine position;
- the one authorized transition identifier and its permitted-delta digest;
- issue time, expiry, and controller identity;
- disabled network and sensitivity policy.

A same-state lease refresh rechecks those facts but does not reopen the baseline review. It cannot
change a plan, schema, contract, repository head, phase state, transition, or allowed delta.

A successful declared transition issues a chained successor lease. The successor binds the prior
lease digest, completed transition identifier, validated observed delta, resulting clean heads, and
the contract-declared next state. This ordinary head and state advance does not reopen baseline
review because the unchanged envelope already authorized that exact transition. No successor may be
issued for an undeclared delta, invalid predecessor, expired execution, or non-unique next state. A
change to immutable envelope authority still requires a replacement Program Baseline Envelope.

### 4.3 Phase Acceptance Contract

Before a detailed phase plan is approved, it MUST define a compact Phase Acceptance Contract:

- entry state and exact predecessor evidence;
- ordered state transitions;
- command applicable to each state;
- authority source for every protected or mutable path;
- permitted path and side-effect delta for every transition;
- one real vertical transaction and its pinned inputs;
- expected RED location before implementation;
- final expected outputs and exit gate;
- test ladder, resource budget, review policy, and stop rules;
- rollback and preservation behavior.

The contract SHOULD be machine-readable through an existing manifest format. A short reviewed table
is acceptable until generic tooling exists. Long prose is not an executable substitute.

### 4.4 Phase Transaction Record

The Phase Transaction Record is produced only by the declared vertical transaction. It contains:

- acceptance-contract and baseline-envelope digests;
- exact input artifacts, commits, and versions;
- state transition sequence and command results;
- expected RED and final GREEN classification;
- observed permitted deltas and rejected undeclared deltas;
- safe evidence references;
- final repository heads and output digests;
- elapsed time and resource consumption;
- unresolved Minor findings and disabled capabilities.

Reviewer approval without the applicable transaction record cannot authorize integration.

## 5. Common State Model

Every phase maps its work to these common meta-states:

```text
candidate
  -> baseline_frozen
  -> lease_active
  -> vertical_red_confirmed
  -> implementation_complete
  -> vertical_green_confirmed
  -> exit_verified
  -> integrated
```

Research phases may replace `implementation_complete` with `observation_complete`. A legitimate
`unknown` or `disabled` decision may be a GREEN transaction outcome when the acceptance contract
requires honest uncertainty rather than a positive capability.

Each phase MAY define substates, but every substate MUST declare:

- entry head and artifact set;
- authority source for every input;
- mutable and protected paths;
- allowed processes, sockets, files, and credentials;
- command and expected exit classification;
- unique successor or terminal state;
- retry, expiry, and rollback behavior.

A state transition is invalid when a command requires an invariant that an earlier declared
transition legitimately changes. Plans MUST compute the intersection between protected paths and
the union of all planned changed paths before approval.

## 6. Vertical Transaction Rule

### 6.1 Before New Implementation

A new phase cannot make an unimplemented transaction fully GREEN. Before implementation begins,
the real transaction harness MUST:

1. use real entry commits, contracts, packages, and toolchain;
2. execute from the declared entry state to one unique expected RED boundary;
3. prove every preceding transition and authority lookup is executable;
4. prove later commands and states have no contradictory preconditions;
5. record the missing capability that implementation owns;
6. reject unrelated failure families as accidental regression.

Synthetic fixtures MAY supplement mutation coverage but cannot replace this real-path RED.

### 6.2 After Implementation

Before final implementation review or merge, the same transaction MUST run end to end with real
pinned inputs and produce the Phase Transaction Record. No manual state preparation is allowed
unless it is an explicit, reviewed transition in the Phase Acceptance Contract.

### 6.3 Mid-Execution Authority Repair

When implementation already exists and a plan, gate, or authority repair is required, the repaired
vertical transaction MUST run fully in disposable rehearsal roots before the repair PR merges.
Focused tests and a full suite on the repair branch are insufficient when they do not reach the
post-replay or post-migration state.

The rehearsal MUST include the real changed-path union. It MUST fail before review when a protected
runtime path is also a legitimate replay or migration output without a phase-specific authority
rule.

## 7. Test Ladder

Tests run from cheapest to most expensive. A higher tier never compensates for a missing lower-tier
scenario.

### T0: Static and Focused

- formatting, schema syntax, typecheck, and deterministic unit tests;
- changed-path and protected-path intersection;
- one invariant or regression per implementation commit;
- target duration: under ten minutes.

Run T0 after each coherent edit or task commit.

### T1: Contract and Mutation

- cross-language fixtures, parsers, negative capabilities, replay, authorization, and failure
  families owned by the current task slice;
- exact expected RED names and accidental-regression rejection;
- no full repository campaign.

Run T1 at task integration boundaries.

### T2: Real Vertical Transaction

- real pinned inputs and ordered states;
- all participating repositories;
- actual launcher, compiler, observer, scheduler, or runtime path;
- exact final artifact and handoff behavior.

T2 is mandatory before integrated review and after any authority repair.

### T3: Phase Campaign and Convergence

- the current phase's fault, platform, duration, resource, and adversarial campaigns;
- sample count and stop rule follow the Hardening Amendments convergence procedure;
- repeated runs are driven by a declared confidence or flakiness hypothesis.

T3 runs once per stable vertical-GREEN candidate tip, with only the repetitions required by its
declared budget. There is no universal three-run rule. Its record binds that immutable tip and the
T2 transaction digest. A closure fix invalidates every T3 campaign whose declared inputs, changed
paths, or covered invariants intersect the fix; those campaigns rerun on the closure tip. Reuse of
an unaffected campaign requires digest-bound proof that all three sets are disjoint and unchanged.

### T4: Complete Local Staging or Canary

T4 belongs to Phase 6A and separately approved Phase 6B. Earlier phases do not repeatedly run the
complete program merely to validate a local governance edit.

## 8. Review Model

### 8.1 Acceptance-Contract Review

One bounded review occurs before detailed implementation. It checks:

- phase ownership and non-goals;
- state-machine completeness;
- real vertical input selection;
- authority and mutable-path separation;
- expected RED specificity;
- test, resource, evidence, and rollback budgets.

The reviewer does not demand implementation that belongs to a later phase.

### 8.2 Integrated Review

After T2 is GREEN, one integrated review examines the immutable tip and transaction record.

- Reviewer A owns implementation correctness and security boundaries.
- Reviewer B is required only for cross-repository, authority, signing, production, or canary
  boundaries and owns state-transition and evidence completeness.
- Ordinary isolated tasks require one reviewer, not two.

### 8.3 Finding Closure

- All genuine Critical and Important findings are batched into one fix wave.
- Minor findings enter the durable ledger and do not reopen implementation.
- One closure review is allowed after the batch.
- Before closure review, the batch reruns its T0/T1 tests, T2, and every affected T3 campaign on the
  new immutable tip. Exit evidence cannot mix a repaired T2 tip with stale campaign evidence.
- A further loop requires a demonstrable Critical regression introduced by that batch, with exact
  reproduction and affected requirement.
- If Critical or Important findings remain after closure, the phase stops and the architecture or
  acceptance contract is simplified. Another authority-repair PR is forbidden without operator
  approval.

Reviewer scope cannot expand to optional hardening, later-phase work, wording preference, or a new
schema family after the acceptance contract is frozen.

## 9. Blocker Classification

Every failure is classified before changing a plan or authority artifact.

| Class | Meaning | Default action |
|---|---|---|
| `expected_red` | Exact declared missing capability or negative result | Continue implementation |
| `implementation_bug` | Existing contract gives a complete answer | Fix code and T0/T1 tests |
| `harness_bug` | Runner, fixture, parser, or environment violates the contract | Fix harness; do not broaden product authority |
| `environment_drift` | Tool, dependency, remote, disk, or platform binding changed | Re-baseline or restore declared environment |
| `contract_contradiction` | Two normative requirements or states cannot both hold | Stop and batch one authority repair |
| `architecture_failure` | Repeated fixes expose incompatible ownership or state model | Stop and simplify architecture |
| `optional_hardening` | Useful but outside the current acceptance contract | Record for owning phase/backlog |
| `minor` | Nonblocking quality or documentation issue | Ledger; do not reopen |

A nonzero exit, reviewer concern, or unfamiliar output is not automatically a plan blocker.

## 10. Planning and Execution Sequence

Each future phase follows this order:

1. Read predecessor handoff and governing requirement slices.
2. Perform repository, artifact, and environment discovery.
3. Draft the Phase Acceptance Contract and vertical transaction skeleton.
4. Freeze the Program Baseline Envelope with the draft contract digest.
5. Issue the sequence-zero Run Lease and run the real transaction to the exact expected RED.
6. Review the acceptance contract once. Batch material corrections once; when they change authority,
   freeze one replacement envelope, issue a new sequence-zero lease, and re-prove the RED before
   closure. Remaining Critical or Important findings stop the phase.
7. Write the detailed implementation plan using discovered files and symbols.
8. Implement in small task commits with T0 and T1, issuing a validated chained successor lease for
   each contract-declared head and state transition.
9. Integrate tasks and run T2 with real pinned inputs.
10. Run T3 only on the stable T2-GREEN tip.
11. Perform the bounded integrated review. If one closure wave is needed, rerun T0/T1, T2, and all
    affected T3 campaigns on its immutable tip before the single closure review.
12. Merge, rerun the required integrated transaction on merged heads, and issue the exit handoff.

The detailed plan is just in time. The program does not write all future phase file-level plans
before their evidence and predecessor contracts exist.

## 11. Resource and Workspace Budget

Unless the Phase Acceptance Contract justifies more, each participating repository may have:

- one immutable source or baseline root;
- one active implementation root;
- one disposable vertical-transaction rehearsal root;
- one clean contract or package clone when cross-repository input requires it.

Program defaults:

- no more than one active implementation branch per phase per repository;
- no parallel broad suites on one host;
- no permanent retention of failed temporary fixtures or dependency caches;
- disk free-space floor and cleanup candidates checked before T2/T3;
- evidence roots, active worktrees, and operator-owned checkouts are never automatic cleanup
  candidates;
- deletion remains an operator-approved action under local safety policy;
- a failed rehearsal root is retained only when it is the minimal reproduction or required
  evidence, and its retention reason is recorded.

## 12. Evidence and Research Material

Phase 3 and later campaigns distinguish three artifact classes:

1. raw ephemeral material in an approved isolated evidence root;
2. safe durable evidence capsules containing bounded summaries, digests, recipes, and provenance;
3. derived decision rows and negative capabilities.

Raw material follows the governing retention and destruction policy. Durable capsules MUST retain
the method needed to reproduce analysis on a future client version:

- package identity and digest;
- platform and toolchain;
- entrypoint and configuration matrix;
- instrumentation and observer recipe;
- parser and schema version;
- safe result digest and confidence/convergence record;
- known perturbation and missing-coverage notes.

The method is versioned independently from the observed result. A new version reuses the method
but never inherits a prior positive conclusion without evidence.

## 13. Version Intake Lane

A new Claude Code version does not restart the seven-phase program automatically. It enters a
bounded Version Intake lane:

```text
package intake
  -> static and dependency delta
  -> affected requirement and transport map
  -> Phase 3A evidence capsule
  -> Phase 3B deterministic profile/config candidate
  -> impacted Phase 2/4/5 gates
  -> Phase 6A staging when required
```

The intake record classifies each existing Baseline Envelope binding as:

- `unchanged_reusable`;
- `changed_revalidation_required`;
- `removed_disable`;
- `unknown_disable`.

Unchanged contracts and negative capabilities remain reusable by digest. Version-specific observed
behavior, profiles, TLS/HTTP characteristics, environment fingerprints, and private-provider
conclusions never transfer automatically.

## 14. Phase-Specific Vertical Transactions

### Phase 0: Governance and Baseline

```text
governing documents + repository heads
  -> precedence and requirement registry
  -> claim ceilings and baseline manifest
  -> failing fixtures and command catalog
  -> reviewed exit handoff
```

Phase 0 is historical and MUST NOT be reopened by adoption of this operating model.

### Phase 1: Control-Plane Boundaries

```text
fresh baseline + authorization lease
  -> real B1/B2/B3/listener RED transactions
  -> implementation and exact side-effect reservations
  -> cross-repository replay or migration when applicable
  -> artifact, review, merged-head recapture, and exit handoff
```

Any authority repair after replay begins MUST rehearse the exact real replay through artifact
post-commit before its repair PR merges.

### Phase 2: Contract and Manifest Authority

```text
requirements + shared contract inputs
  -> schema and canonical encoding
  -> TS/Go/lab round trip
  -> signing, lineage, expiry, rollback, and negative mutation corpus
  -> versioned contract bundle and disablement decisions
```

Cross-language equality and rejection semantics are the vertical result; prose agreement is not.

### Phase 3A: Evidence Factory

```text
pinned package + platform + entrypoint
  -> static recovery and selective observation
  -> transport/config/auth/state matrix
  -> safe evidence capsule and convergence record
  -> claim or explicit unknown/disabled decision
```

The transaction is GREEN when evidence handling and decision boundaries are correct, even if the
observed capability remains unknown or disabled.

### Phase 3B/3.5: Evidence-to-Configuration Synthesis

```text
reviewed Phase 2 contract + Phase 3A evidence
  -> deterministic compiler
  -> canonical profile/config/fixture outputs
  -> TS/Go validators and local conformance
  -> byte-identical repeated compilation and frozen tuple
```

Handwritten upstream-visible tuples cannot satisfy the transaction.

### Phase 4: Runtime Isolation and Availability

```text
frozen contract/profile + account request
  -> transport cell + policy/sidecar authorization
  -> proxy generation and destination enforcement
  -> rotation/restart/replay/fault/resource campaigns
  -> bounded rejection or verified local response
```

The real path must prove no unauthorized DNS, dial, connection reuse, or cross-cell state.

### Phase 5: Scheduler and Operations

```text
recorded workload and behavior budget
  -> scheduler decisions
  -> retry/backpressure/cost/fairness outcomes
  -> counterfactual non-mutating replay
  -> incident, kill-switch, and recovery handoff
```

The same event log must reproduce the same bounded decisions under the declared deterministic
inputs. Statistical campaigns use declared confidence and maximum budgets.

### Phase 6A: Complete Local Staging

```text
all current phase handoffs
  -> full Sub2API/Gateway/sidecar local chain
  -> signed staging bundle
  -> adversarial, rollback, split-brain, and leak campaigns
  -> zero-external-socket proof and staging exit
```

Phase 6A revalidates integration; it does not silently repair earlier ownership failures.

### Phase 6B: Separately Approved Canary

```text
approved hypothesis + fixed variables + bounded budget
  -> canary preflight
  -> one controlled upstream sequence
  -> delayed observation and stop-rule evaluation
  -> rollback, cleanup, destruction, and bounded conclusion
```

No local or staging result grants Phase 6B authority. Each canary remains separately approved.

## 15. Transition From the Current Program State

Adopting this model does not reopen Phase 0 or claim Phase 1 completion.

Current Phase 1 execution remains paused. Its authorization, review, context, replay heads, and
failure reproduction are retained as historical evidence only. No current restart artifact exists.
They MUST NOT authorize resumed execution after a plan, tool, schema, or operating-model change.

After operator approval of this document, the next artifact is a short Delivery Mechanism
Transition Plan. It MUST:

1. inventory existing gates as retain, simplify, retire, or defer;
2. prefer existing manifests and schemas;
3. specify the minimum Baseline Envelope and Run Lease change;
4. add the real Phase 1 replay-to-artifact transaction before any authority repair;
5. separate pinned authority runtime inputs from replay-mutable product inputs;
6. define exact cleanup candidates without deleting anything;
7. fit in one reviewed implementation wave;
8. issue a new P1 Recovery Plan only after the transition itself is accepted.

No P1 code, replay, test campaign, context, review, or worktree mutation resumes merely because
this document is drafted or merged.

## 16. Operating-Model Acceptance Checklist

The operating model is acceptable only if one bounded review confirms:

- all seven top-level phases and Phase 3B/3.5 are covered;
- the existing product-document precedence and roadmap DAG remain unchanged;
- pre-implementation expected RED and post-implementation GREEN are distinct;
- mid-execution repairs require a pre-merge real vertical rehearsal;
- Baseline Envelope and Run Lease authority cannot be confused;
- protected-path and planned-change intersection is mandatory;
- review and repair loops have explicit limits;
- test repetition is evidence-budget-driven rather than ceremonial;
- research can exit honestly with unknown or disabled capabilities;
- version intake reuses only unchanged digest-bound authority;
- evidence safety, production prohibition, and canary approval remain intact;
- P1 remains paused until a separately approved transition and recovery plan exist.

## 17. Controller Rules

The master controller MUST:

1. refuse a detailed phase plan without a Phase Acceptance Contract;
2. refuse implementation without the real-path expected RED transaction;
3. refuse integrated review without a real Phase Transaction Record;
4. classify a failure before changing authority;
5. batch Critical and Important findings once;
6. stop after the single closure wave if material findings remain;
7. keep Minor and optional hardening out of the active critical path;
8. refresh a Run Lease without reopening baseline review when immutable inputs are unchanged;
9. prevent worktree and cache growth beyond the declared budget;
10. preserve operator changes and local destructive-operation approval boundaries;
11. never substitute synthetic proof for a declared real artifact or state transition;
12. never resume a paused phase without explicit operator approval of its transition plan.

## 18. Self-Audit

### 18.1 Seven-Phase Applicability

| Phase | Main uncertainty | How this model avoids false progress | Valid terminal result |
| --- | --- | --- | --- |
| P0 | Authority and traceability are incomplete | Run a real registry-to-handoff mutation transaction | Frozen and traceable governance baseline |
| P1 | Cross-repository ordering and side effects | Execute the real request/replay-to-artifact path before review | Boundary implementation or explicit blocked contract |
| P2 | TS/Go contract drift | Require one byte-identical artifact and identical rejection matrix | Versioned local contract bundle |
| P3A | Reverse-engineering evidence may remain inconclusive | Grade the evidence process, convergence, and claim ceiling rather than demand a positive capability | Supported claim, `unknown`, or disabled capability |
| P3B/3.5 | Evidence may not compile into executable behavior | Require deterministic compilation and dual-validator conformance | Frozen profile/config/fixture tuple or disabled tuple |
| P4 | Runtime cells may leak state, DNS, or connections | Run the actual isolated request path plus restart and fault transitions | Verified local cell or fail-closed disabled path |
| P5 | Scheduler behavior is statistical and stateful | Bind workload/event log, confidence budget, counterfactual replay, and stop rule | Bounded operational policy or disabled policy |
| P6A | Individually valid components may fail together | Require complete local staging and zero-external-socket proof | Signed local staging exit or blocked integration |
| P6B | A real upstream action is irreversible and externally observed | Preserve separate operator approval, one-variable hypothesis, stop rules, and cleanup | Bounded canary conclusion only |

The model therefore covers all seven top-level phases without pretending they have identical
outputs. It standardizes authority and transaction mechanics while preserving phase-specific
evidence and safety boundaries.

### 18.2 Phase 1 Failure-Corpus Check

The PR #10 through PR #20 sequence is used as a regression corpus for the mechanism, not as a list
of new permanent schemas. Each observed failure class must be caught by one existing model rule:

| Observed failure class | Earliest required detection |
| --- | --- |
| Initial context rules could not express successor renewal | Baseline Envelope versus Run Lease state table |
| Expected RED accepted incomplete family or leaf sets | T1 exact failure classification and accidental-regression rejection |
| Indirect fixture bypassed the real `startProxy` boundary | Phase Acceptance Contract real vertical path |
| Principal guard and reservation-adjacent revalidation conflicted | Ordered state transitions and side-effect boundary in the acceptance contract |
| One global test process was nondeterministic | T0/T1 process isolation; T3 repetition only after a stated flakiness hypothesis |
| Ignored build, cache, or tool state changed outside the declared delta | Per-transition mutable/protected path and process-state inventory |
| Contract discovery fell back to an operator sibling checkout | Explicit pinned cross-repository input in the Baseline Envelope |
| Offline dependency cache or launcher startup assumptions were absent | Real T2 environment and dependency preparation transition |
| Fresh clone branch, ref, and archival-ref assumptions diverged | Real disposable rehearsal roots with exact remote/ref authority |
| Source validation happened after replacement-root mutation | Command ordering in the phase state machine and pre-side-effect authority check |
| Post-replay `package.json` legitimately changed but the launcher required pre-replay bytes | Protected-path intersection plus complete real replay-to-artifact rehearsal before merge |

The final row is the decisive check. Under this model, a mid-execution repair cannot merge after
focused tests and broad suites alone. The real replay changes `package.json`, and the subsequent
real artifact build must run in the rehearsal. The contradiction is therefore detected before the
repair PR, not after eleven governance merges.

### 18.3 Efficiency and Abuse Checks

The following failure modes were considered and bounded:

- **Impossible pre-implementation GREEN:** the pre-implementation requirement is one exact real
  expected RED, not a fabricated full pass. Full GREEN is required only after implementation.
- **Research forced into a claim:** P3A may end GREEN with `unknown` or `disabled` when the method,
  convergence, and claim boundary are correct.
- **Baseline cannot bind a later contract:** the contract is drafted before the initial envelope;
  one reviewed contract correction may replace the envelope and re-prove RED, after which remaining
  material findings stop the phase.
- **Lease churn reopens review:** an unchanged same-state refresh does not trigger holistic review,
  while each declared transition produces a digest-chained successor lease bound to its validated
  resulting head and state.
- **One large review batch hides task defects:** task commits still run T0/T1; only independent
  integrated review is batched after T2.
- **One repair wave becomes unlimited:** a single closure wave is allowed; remaining material
  findings force simplification and operator decision.
- **Full-suite repetition becomes ritual:** repetition requires a named hypothesis and budget;
  otherwise one stable T3 run is the default.
- **Closure changes leave stale campaign evidence:** the closure tip reruns T2 and every intersecting
  T3 campaign; reuse requires digest-bound proof that inputs, paths, and invariants are unchanged.
- **Minor findings are used to block delivery:** Minor and optional hardening enter the durable
  ledger and cannot reopen the phase.
- **Workspace limits destroy evidence:** active roots and minimal reproductions are protected;
  cleanup remains separately approved and evidence-aware.
- **A new client version invalidates everything:** only changed or version-specific bindings are
  revalidated; digest-identical authority and negative capabilities remain reusable.
- **Old positive observations leak into a new version:** positive behavior and provider-internal
  conclusions never transfer without new evidence.

### 18.4 Known Limits

This model cannot prove undocumented provider internals, eliminate all defects, or predict every
future client change. It also cannot recover time already spent on Phase 1. Its enforceable value is
narrower: it makes the next real transaction the primary proof, caps review and repair loops, and
forces an explicit stop when the architecture cannot satisfy its own state transitions.

No implementation should encode this model until the operator approves both this self-audit and
the bounded independent mechanism review.
