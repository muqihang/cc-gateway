# Claude Code 2.1.207 Oracle Lab Delivery Roadmap

## Status

- Design date: 2026-07-11
- Governing documents, highest precedence first:
  1. `docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md`
  2. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md`
  3. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-adversarial-validation-v2.md`
  4. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-design.md`
- Canonical requirement registry (Task 1/2 schema v1; Task 3 migrates this path in place to v2): `docs/superpowers/registry/oracle-lab-requirements.json`
- Preserved Registry v1 snapshot (created by Task 2): `docs/superpowers/registry/oracle-lab-requirements-v1.json`
- Registry adoption state: Registry v2 and RA adoption remain pending reviewed gates through Task 2 and Task 3; this Status does not claim those migrations are complete
- Normative precedence: `review_amendments > hardening_amendments > adversarial_validation_v2 > oracle_lab_design`; every conflict MUST be registered explicitly by the reviewed Task 2/3 migration, which remains pending; no conflict may be silently replaced or superseded
- Delivery state: Phase 0 complete; `docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json` (`sha256:d3263421bfb3c1e9b0f52557e1501d5e9ab6ff33616f26c2aa7cc2d4ad4f3ea6`) is the immutable reviewed-input baseline, and `docs/superpowers/evidence/phase-0/phase-0-exit-receipt.json` binds the final roadmap bytes and Phase 0 handoff commit. Phase 1 remains gated on that receipt and the Phase 0 exit contract.
- P0.1 governance state: P0.1 implementation candidate; completion is controlled exclusively by the successor receipt; P1 remains blocked by the integrated-main entry gates.
- Current worktree: CC Gateway repository; Sub2API and other sibling repositories are separate
  implementation surfaces

## Purpose

This roadmap turns the four governing documents into seven independently reviewable delivery
phases. It is the durable navigation document for context handoff. A phase may start only when
all of its declared predecessor gates in the authoritative dependency DAG have passed and its
entry baseline and handoff bundle are fresh; independent branches may proceed concurrently.

The roadmap is not a substitute for a phase implementation plan. It defines order, dependencies,
hard gates, artifacts, and non-goals. The phase plan defines exact files, interfaces, tests,
commands, expected failures and passes, and commit checkpoints.

## Normative Relationship

Conflicts resolve in this order:

```text
Review Amendments > Hardening Amendments > Adversarial Validation v2 > Oracle Lab Design
```

Every conflict MUST be registered explicitly by the reviewed Task 2/3 migration with original
source references and linked Claim Matrix authority. Registry v2 and RA adoption remain pending
reviewed gates through Task 2 and Task 3. Until those gates pass, the canonical registry remains
schema v1 and no conflict, requirement, or authority statement is treated as migrated or silently
replaced. Registry `implementation_status` and Claim Matrix authority remain separate fields; the
in-place v2 migration does not create a second authority lattice.

## Delivery Rules

1. `RA-P0-*` and `RA-P1-*` encode priority, not roadmap phase. Ownership follows the phase slices
   and dependency gates below.
2. `WP-R0..R9` are traceability umbrellas. A phase plan consumes only its explicit WP slices, and
   no plan may cross a phase gate.
3. No phase starts from prose alone. It starts from every applicable predecessor handoff bundle
   and a newly frozen repository and dependency baseline. Phase 1 and Phase 2 branch from Phase 0;
   Phase 3A and mandatory bridge Phase 3B/3.5 follow Phase 2; Phase 4 joins Phase 1 and
   Phase 3B/3.5; Phase 5 follows Phase 4; Phase 6A follows the Phase 4 and Phase 5 gates plus all
   other applicable prior gates; Phase 6B follows only after separate approval.
4. No phase may silently broaden scope because a later design section is convenient to implement.
5. Unknown, contradictory, expired, or missing evidence disables the affected capability.
6. Real upstream requests are prohibited until Phase 6 and require a separate approved canary
   plan.
7. Every phase ends with an evidence-backed exit report, registry update, and context handoff
   bundle.

## Phase Dependency Map

```text
P0 -> P1 --------------------------+
  \-> P2 -> P3A -> P3B/3.5 -------+-> P4 -> P5 -> P6A -> approval -> P6B
```

Phase 1 and Phase 2 may begin independently after the Phase 0 governance gates pass. Phase 3A
depends on Phase 2 and owns reverse/static/dynamic/protocol/TLS/HTTP2/unknown-transport evidence.
Phase 3B/3.5 is the mandatory local compiler/config/fixture conformance bridge. Phase 4 depends on
both Phase 1 and Phase 3B/3.5. Phase 5 depends on Phase 4. Phase 6A owns signed complete local
staging. Phase 6B is a separately approved canary and cannot begin without the intervening
approval. Version-specific profile promotion remains blocked until every applicable gate passes.

At the seven-top-level-phase compatibility granularity, Phase 3 depends on Phase 2 and comprises
both Phase 3A and Phase 3B/3.5. Phase 4 depends on both Phase 1 and Phase 3, which means the Phase 3B/3.5
mandatory bridge must have passed; these aliases do not add or remove a dependency edge.

## Phase 0: Governance, Baseline, and Harness Foundation

### Objective

Establish one traceable source of truth, freeze the implementation inputs, choose the Gateway
compromise boundary, and create the minimum Harness Engineering layer that prevents agents from
working from stale or invented context.

### Required Work

- Consolidate the three documents or register the explicit precedence overlay.
- Assign stable requirement IDs using `OL-*`, `AV-*`, and `HA-*` prefixes.
- Create the machine-readable requirement status registry and claim matrix.
- Freeze CC Gateway, Sub2API, shared contract, sidecar, package, runtime, and toolchain inputs.
- Choose `Protected-Gateway` or `Trusted-Gateway` in an architecture decision record.
- Revalidate every current-code P0 finding and attach repository, commit, symbol, failing test,
  date, and evidence digest.
- Create exact task packets for each Priority 0 item: owner, repository, files, tests, commands,
  dependencies, and rollback.

### Harness H0: Context and Traceability

The first harness slice is deliberately small and mandatory:

- `run-manifest` schema containing commits, dirty-state digests, dependency digests, platform,
  tool versions, selected requirement IDs, and declared network/sensitivity policy;
- baseline freeze command that fails on undeclared dirty inputs;
- requirement registry validator checking IDs, source references, status transitions, owners,
  evidence digests, and expiry fields;
- claim matrix validator separating local structural, local observational, upstream canary, and
  provider-internal claims;
- deterministic command catalog with command, working directory, expected exit code, and safe
  output policy;
- context pack generator containing only approved files, symbols, line references, registry
  entries, and current test status;
- phase handoff bundle generator containing the exit report, changed files, artifact index,
  unresolved risks, and exact next-entry conditions.

The CC Gateway and Sub2API repositories have `.codegraph` indexes available in sibling
workspaces. H0 uses CodeGraph for symbol discovery when present, records the index digest, and
falls back to explicit file reads only when the index is unavailable or insufficient. The
fallback reason is recorded in the run manifest.

### Exit Gate

Phase 0 is complete only when:

- document precedence is explicit and parent-document reconciliation is tracked;
- the Gateway compromise boundary is selected and represented in configuration and run metadata;
- all P0/P1 requirements have stable IDs, owners, target repositories, and acceptance gates;
- baseline freeze and dirty-input detection pass for every participating repository;
- the requirement registry, claim matrix, context pack, and handoff bundle validate;
- every P0 item has a failing test or evidence fixture and an exact verification command;
- no profile promotion, real request, or production deployment is enabled.

### Non-Goals

- fixing the P0 findings themselves;
- reverse engineering the complete client;
- implementing a production scheduler;
- creating a full observability or canary system.

## Phase 1: Immediate Control-Plane Boundary Repairs

### Objective

Close B1-B3 browser attestation, authorization, and public-origin defects, plus the fail-closed
listener startup boundary, without taking Phase 2 contract or Phase 4 runtime ownership.

### Required Work

- B1 server-side browser egress attestation and replay protection.
- B2 principal, tenant, group, creator, role, object-state, and expected-version authorization.
- B3 trusted public-origin construction and forwarded-header policy.
- Loopback-by-default listen behavior and remote-listen fail-closed startup checks requiring
  explicit capability, inbound TLS, strong authentication, and approved exposure policy.

### Harness H1: Boundary Fixtures

- route and flow authorization matrix fixtures;
- attestation mutation and replay corpus;
- trusted-origin and forwarded-header mutation corpus;
- listener bind and remote-startup configuration corpus;
- secret-canary sinks and leak scanner;
- deterministic failure-class fixtures.

### Exit Gate

- All B1-B3 failing tests are green.
- Cross-user, cross-group, cross-tenant, replay, stale-context, and untrusted-origin tests pass.
- An omitted listen host binds loopback, while any remote listen fails startup without every
  declared encryption, authentication, capability, and exposure-policy prerequisite.
- The harness proves the listener boundary from observed bind state, not application logs alone.

## Phase 2: Normative Compatibility and Manifest Authority

### Objective

Define the contracts that prevent incompatible or fabricated profiles from entering runtime.

### Required Work

- Versioned manifest and shared-contract schemas with deterministic serialization.
- Authority-state lattice, expiry, contradiction, invalidating dependencies, and disablement.
- Four compatibility gates: wire, semantic, state-sequence, and failure-semantics.
- Behavior Coherence Certificate and negative-capability manifest.
- Manifest root trust, signing roles, threshold approval, lineage, anti-rollback, witnessed
  checkpoints, key rotation, and emergency revocation.
- Explicit sidecar envelope schema, canonicalization, replay model, clock policy, and key epoch.

### Harness H2: Contract and Fixture Conformance

- TypeScript, Go, and laboratory implementations consume the same schema fixtures;
- duplicate-key, Unicode, ordering, empty-value, compression, IPv6, and query-normalization
  corpus;
- manifest signature, lineage, split-view, freeze, expiry, rollback, and key-compromise corpus;
- coherence-certificate mutation corpus that rejects unobserved combinations;
- cross-language canonical hash comparison.

### Exit Gate

- All contracts have versioning, compatibility, and downgrade rules.
- Cross-language canonicalization tests agree.
- Unknown fields and unsupported capabilities fail closed.
- Manifest authority and replay semantics are tested under restart, replica split, clock fault,
  and key rotation.

## Phase 3: Evidence Factory and Oracle Coverage

### Objective

Build the repeatable evidence pipeline that captures the pinned client and produces safe,
versioned, scope-labeled evidence without overclaiming provider behavior.

### Required Work

- Complete execution-chain provenance and package intake.
- Static control-flow recovery and selective dynamic instrumentation.
- Hermetic process runner and exact observer/IPC allowlist.
- HTTP, SSE, TLS, HTTP/2, and unknown-transport discovery.
- Configuration precedence and authentication lifecycle matrices.
- Response AST, state-sequence trace, failure-semantics diff, and negative evidence.
- Stability convergence, long-duration, restart, time, randomness, and platform campaigns.
- Safe error classifier and approved evidence-capsule procedure.

### Harness H3: Evidence and Observation

- run manifest and artifact index for every matrix cell;
- independent parser implementations and dependency digests;
- coverage model with mandatory core, risk interactions, combinatorial selection, seeds, and
  degraded capability records;
- instrumented versus uninstrumented perturbation comparator;
- raw-material redaction, destruction, and canary scanner;
- convergence and confidence report generator.

### Exit Gate

- Every enabled capability has package, platform, entrypoint, authority, and evidence scope.
- Unknown transports and unexplained variation remain disabled.
- Stable/variable classification is supported by the declared convergence procedure.
- No raw prompts, bodies, credentials, CCH, ClientHello, or unrestricted diagnostics persist.
- No version-specific profile is promoted solely on local or three-run evidence.

## Phase 4: Transport Cells, Sidecar, and Availability Runtime

### Objective

Implement the runtime isolation and availability controls that preserve account and proxy
identity under normal load, rotation, restart, failure, and resource pressure.

### Required Work

- Account transport-cell resource model and no-cross-cell reuse/coalescing.
- Proxy identity and generation continuity.
- Rotation, freeze, drain, forced termination, and restart recovery.
- Sidecar complete-message authentication and replay ledger/key-epoch implementation.
- Protected-Gateway policy broker if selected in Phase 0.
- Fail-closed backpressure, circuit breakers, retry budgets, and bounded resource rejection.
- HTTP/2 connection, HPACK, TLS ticket, DNS, descriptor, and queue isolation.

### Harness H4: Runtime Fault and Resource Campaigns

- rotation and stale-cell corpus;
- replay-ledger partition, restart, failover, and unknown-state corpus;
- resource exhaustion and descriptor/queue/disk-full campaigns;
- sidecar, broker, proxy, manifest, and contract outage injection;
- cross-account connection-coalescing detector;
- bounded retry and account-switch amplification detector.

### Exit Gate

- No cross-account transport state is observed under normal or adversarial load.
- Rotation and restart cannot reuse stale authority.
- Unknown replay state blocks traffic before egress.
- Resource exhaustion produces deterministic bounded rejection.
- Backpressure does not create retry storms or uncontrolled account switching.

## Phase 5: Scheduler, Operations, and Adversarial Maturity

### Objective

Validate scheduler behavior, cost accounting, operational controls, and blue-team response using
representative workloads and adversarial campaigns.

### Required Work

- ClaudeBehaviorBudget and exact partial-result/cost accounting.
- Feedback-oscillation protection, fairness, starvation prevention, and cooldown hysteresis.
- Counterfactual replay and shadow scheduler with non-mutation guarantees.
- Metric-to-action contracts with prohibited automatic actions.
- Representative de-identified workload-shape replay.
- Operator separation, incident state machine, kill switches, rollback, and periodic
  revalidation.
- Capacity qualification at declared concurrency and resource levels.

### Harness H5: Replay and Operations

- deterministic scheduler event log and replay format;
- synthetic versus representative workload comparison;
- metric baseline, hold-out, sample-size, confidence, effect-size, and hysteresis reports;
- operator approval and privileged-action audit fixtures;
- incident bundle and kill-switch drill generator;
- production verification expiry checker.

### Exit Gate

- Retry amplification, account switching, duplicate cost, starvation, and oscillation remain
  within approved limits.
- Metrics have explicit actions, prohibited actions, and human-review rules.
- Incident, rollback, key rotation, and kill-switch drills meet recovery objectives.
- Production verification expiry and revalidation are operationally enforceable.

## Phase 6: Staging and Controlled Canary

### Objective

Prove the complete local chain, then collect the smallest permitted upstream evidence under an
approved hypothesis without turning the system into an automatic optimization loop.

### Required Work

- Full Sub2API -> CC Gateway -> sidecar/policy broker -> local upstream staging.
- All adversarial, parser, resource, split-brain, rollback, and leak campaigns.
- Canary hypothesis registry, fixed variables, bounded sequence, cost/time/retry limits.
- Delayed and censored outcome classification.
- Stop rules, exit procedure, credential/proxy/session cleanup, and evidence destruction.
- No automatic identity, timing, proxy, request-shape, or profile changes from canary results.

### Harness H6: Staging and Canary

- staging run manifest and signed evidence bundle;
- canary preflight validator;
- safe timeline and delayed-observation recorder;
- kill-switch propagation checker;
- canary conclusion-boundary validator;
- incident and rollback handoff bundle.

### Exit Gate

- All prior phase gates are green and current baselines match the handoff bundle.
- No external socket is reachable during local staging.
- Every canary has one hypothesis, one changed variable, fixed conditions, limits, stop rules,
  and an allowed conclusion.
- Canary evidence is labeled `upstream_canary_observed` and never auto-promotes additional
  accounts or capabilities.

## Harness Engineering Contract

Harness Engineering is a cross-phase control plane, not a one-time test script. Every harness
component must have an owner, schema, version, deterministic command, artifact path, retention
rule, and failure behavior.

### Agent Task Packet

Every implementation task handed to an agent includes:

- phase and requirement IDs;
- exact goal and non-goals;
- repository and worktree;
- allowed files and forbidden files;
- prerequisite handoff bundle and context pack;
- interfaces and expected invariants;
- RED command and expected failure;
- GREEN command and expected pass;
- artifact paths and evidence sensitivity;
- rollback and commit boundary.

### Anti-Hallucination Rules

- An agent may not claim a control exists without a registry entry, code reference, test result,
  and evidence digest.
- An agent may not invent a file, symbol, command, API, or test path; discovery must precede
  planning.
- Missing or stale context blocks implementation and produces a re-baseline request.
- Every failed command, skipped test, degraded cell, and unresolved contradiction is recorded.
- Context compaction is handled by the handoff bundle, not by memory or prose reconstruction.
- Every phase begins by verifying all applicable predecessor exit digests and repository states.

### Phase Handoff Bundle

Each handoff bundle contains:

```text
phase_id
exit_status
repository_heads_and_dirty_digests
requirement_status_delta
changed_files
test_and_command_results
evidence_artifact_index
known_gaps_and_expiry
open_architecture_decisions
rollback_reference
next_phase_entry_conditions
```

## Historical Phase 0 Planning Record (Complete)

The historical Phase 0 planning record is complete and is retained only to explain the reviewed
receipt. It is not an active instruction and must not reopen Phase 0:

1. The Phase 0 implementation plan was written before implementation.
2. The CC Gateway and Sub2API trees, CodeGraph indexes, tests, scripts, and recent commits were
   inspected before files or commands were named.
3. TDD task slices recorded failing tests, minimal implementation, passing commands, artifacts,
   and commit checkpoints.
4. Every plan task mapped to requirement IDs and one phase exit gate.
5. Phase 0 was reviewed, executed, and closed by its immutable exit receipt.

Historical plan files:

```text
docs/superpowers/plans/2026-07-11-claude-code-2.1.207-phase-0-governance-baseline.md
```

## Historical Roadmap Acceptance Record

The historical roadmap admitted Phase 0 planning only after:

- the seven phases, dependencies, non-goals, and exit gates are accepted;
- Phase 0 explicitly contains all P0/P1 governance blockers;
- Harness H0 and the cross-phase handoff contract are defined;
- the Gateway compromise boundary is a Phase 0 decision gate;
- no phase implies that local evidence proves provider-internal behavior;
- its first detailed plan was limited to Phase 0 and named exact files only after repository
  reconnaissance; that plan is complete and is not reopened.

The current next plan begins only after: P0.1 branch receipt -> merge both repository branches -> prove local main equals muqihang/main -> verify P0.1 artifact/fix ancestry on integrated heads -> fresh P1 entry baseline/context -> P1 detailed plan.

## Phase 0 AMEND: Cross-Document Coverage and Ownership

This amendment records the operator-approved dependency DAG:

```text
P0 -> P1 --------------------------+
  \-> P2 -> P3A -> P3B/3.5 -------+-> P4 -> P5 -> P6A -> approval -> P6B
```

Phase 1 and Phase 2 may start independently after Phase 0. Phase 3A depends on Phase 2 and owns
reverse/static/dynamic/protocol/TLS/HTTP2/unknown-transport evidence capture. Phase 3B/3.5 is the
mandatory compiler/config/fixture/local-conformance bridge. Phase 4 depends on both Phase 1 and
Phase 3B/3.5; Phase 5 depends on Phase 4; Phase 6A depends on every applicable prior gate, and
Phase 6B remains a separately approved canary. Runtime integration and promotion remain blocked
until the relevant predecessor gates pass.

### Design-to-Roadmap Mapping

| Design phase | Roadmap owner |
| --- | --- |
| Design 0 restore baselines | Phase 0 |
| Design 1 oracle core | Phase 0 foundation, Phase 2 contracts, Phase 3A evidence tooling |
| Design 2 static/runtime matrices | Phase 3A |
| Design 3 TLS/proxy evidence | Phase 3A |
| Design 4 CCH/profile decisions | Phase 3A decision output, then Phase 3B/3.5 local conformance, constrained by Phase 2 |
| Design 5 gateway/Sub2API integration | Phases 1, 2, 4, 5 |
| Design 6 staging without accounts | Phase 6A |
| Design 7 approved canary | Phase 6B |

### Coverage Matrix

| Source | Primary phase | Gate/role |
| --- | --- | --- |
| Adversarial A evidence acquisition | P3A | P0 freeze, P2 contracts, P6A integrated rerun |
| Adversarial B immediate findings | P1/P2 | P0 failing fixtures, P4 enforcement, P6 proof |
| Adversarial C campaign | P3A/P4/P5 | P6A complete chain |
| Adversarial C2 advanced campaigns | P2/P3A/P4/P5 | P6A integrated execution |
| Adversarial D blue-team | P5 | P6 timeline validation |
| WP0 baseline/contract discovery | P0 | entry and exit baseline |
| WP0.5 normative compatibility | P0 defines RED fixture; P2 implements | absence is not permission |
| WP1 evidence factory | P3A | evidence artifacts and decision matrix |
| WP2 manifest authority | P2 | P3A candidate evidence, P3B/3.5 conformance, P6B canary evidence |
| WP3 onboarding/replay | P1 | P6 replay acceptance |
| WP4 sidecar authentication | P2 contract, P4 implementation | P4 mutation/restart campaign |
| WP5 behavior budget/scheduler | P5 | operational maturity |
| WP6 correlation/fault/state | P3A/P4/P5 | P6A integrated acceptance |
| WP7 staging/canary | P6A/P6B | separate approval boundaries |
| Hardening Priority 0 | P0/P1/P2 | definitions, boundary repair, enforcement |
| Hardening Priority 1 | P1/P3A/P3B/P4/P5 | reliable evidence and safe operation |
| Hardening Priority 2 | P5/P6 | scheduler, canary, production maturity |
| Sections 5-6 | P3A (P0/P2 schemas) | evidence factory and safety |
| Sections 7-8 | P2/P4/P1 | transport and control plane |
| Sections 9-11 | P5/P6 | scheduler, canary, incident response |
| Sections 12-14 | cross-phase, P0 reconciliation | tests, gates, parent map |
| Sections 15-18 | cross-phase, P0 acceptance | priority, deliverables, prohibited claims, acceptance |

### Contract, Implementation, Campaign Ownership

Phase 2 owns shared contract/specification schemas, authority, compatibility gates, negative
capabilities, replay/envelope, transport and scheduler interfaces. Phase 1 owns immediate
control-plane boundaries; Phase 3A owns observation/evidence tooling and evidence decisions;
Phase 3B/3.5 owns deterministic compiler/config/fixture/local conformance; Phase 4 owns runtime
isolation and enforcement; Phase 5 owns scheduler/operations; Phase 6A owns complete signed local
staging; Phase 6B owns only a separately approved canary. Campaign ownership follows the
implementation phase. Neither Phase 3A nor Phase 3B/3.5 promotes a profile from local evidence.

### Phase 3A: Evidence Factory and Environment-Fingerprint Decisions

**Inputs**

- the Phase 2 contract, authority, compatibility, evidence-schema, and negative-capability gates;
- pinned package/executable provenance and a fresh hermetic run baseline;
- approved matrix dimensions, observation mechanisms, evidence budgets, and safe retention rules;
- current requirement relationships, Claim Matrix ceilings, and contradiction/expiry inputs.

**Outputs**

- request, response, control-plane, authentication, TLS/HTTP, state, failure, and destination
  evidence with parser agreement, convergence, explicit omissions, and negative evidence;
- version/change-point comparisons for 2.1.81, 2.1.169, 2.1.179, 2.1.197, 2.1.198-2.1.207;
- environment-fingerprint evidence covering timezone/locale, clean versus inherited environment,
  `ANTHROPIC_BASE_URL`, China-domain taxonomy, proxy environment, and byte-level System Prompt
  comparison dimensions;
- evidence-to-decision rows and safe candidate inputs, with no profile promotion.

Environment fingerprint evidence is owned by Phase 3A and must be explicit in its coverage report.

**Non-goals**

- generating or activating executable Gateway/Sub2API profiles;
- runtime transport enforcement, complete-chain staging, production, or real canary;
- inferring trusted-device proof or private provider behavior from local evidence.

**Artifact gate**

Every Phase 3A artifact records schema/version, digest, scope, owner/reviewer, sensitivity,
retention/destruction, exact verification, expiry, requirement IDs, environment-fingerprint cell,
parser agreement, and negative/contradictory results. Missing cells remain degraded and disabled.

### Phase 3B/3.5: Mandatory Compiler, Config, Fixture, and Local Conformance Bridge

`Phase 3B` is canonical; `3.5` is its durable alias, not an eighth top-level phase.

**Inputs**

- reviewed, schema-valid, unexpired Phase 3A evidence and decision rows;
- Phase 2 contracts, Claim Matrix ceilings, negative capabilities, and compatibility gates;
- one pinned candidate version/platform/entrypoint/auth tuple and independently addressable rollback
  tuple;
- deterministic compiler schema, CC Gateway/Sub2API config schemas, and typed fixture schemas.

**Outputs**

- deterministic `ClientBuildIdentity`, request, response, control-plane, authentication, transport,
  task/session, negative-capability, and coherence artifacts;
- generated CC Gateway and Sub2API configuration for the same logical tuple;
- typed de-identified request/response/state/failure fixtures and deterministic content digests;
- TypeScript, Go, manifest, and fixture-validator agreement for new-session streaming,
  resumed-session streaming, and bounded response failure/recovery local conformance.

**Non-goals**

- signed complete local-chain staging, runtime transport enforcement, production, or real canary;
- profile promotion from compilation success or local evidence;
- handwritten values for missing, contradictory, unexplained, or unavailable capabilities.

**Artifact gate**

Repeated Phase 3B/3.5 compilation must produce byte-identical canonical outputs and matching
cross-language digests, with all negative capabilities and rollback references preserved. A
truthful failure blocks Phase 3B/3.5 only; it does not retroactively block historical Phase 0 or
the entire program. Phase 6A owns the signed complete staging bundle and zero-external-socket proof.

### Boundary Ownership Reconciliation

B1-B3 are owned by Phase 1 for immediate control-plane boundary implementation and verification.
Phase 1 also owns loopback-by-default and remote-listen fail-closed guard planning and its immediate
startup boundary; later multi-replica hardening remains a Phase 4 slice.

B4-B6 are owned by Phase 2 for contract, envelope, negative-capability, destination, and replay semantics.
B4-B6 are owned by Phase 4 for runtime implementation, enforcement, restart, replica, and fault campaigns.
Phase 6A reruns the integrated acceptance chain; it does not take implementation ownership.

### Review Work-Package Phase Slices

`WP-R0..R9` are traceability umbrellas. The table defines the only slices a phase plan may consume;
no plan may cross a phase gate, and each later slice requires a fresh baseline and plan.

| Work package | Explicit phase slices |
| --- | --- |
| `WP-R0` | P0.1 adopts the overlay and reconciles traceability; each later phase updates only its own requirement/handoff slice. |
| `WP-R1` | Phase 2 defines the cross-project contract; Phase 4 implements readiness propagation; Phase 6A verifies the integrated handshake. |
| `WP-R2` | Phase 2 defines account/secret lifecycle contracts; Phase 4 implements lifecycle runtime; Phase 5 consumes operational decisions; Phase 6A stages them. |
| `WP-R3` | Phase 2 defines broker/sidecar/destination/replay contracts; Phase 4 implements protected runtime enforcement; Phase 6A stages the chain. |
| `WP-R4` | Phase 3A executes the evidence factory and expanded matrix; Phase 6A reruns only frozen integrated coverage. |
| `WP-R5` | Phase 3B/3.5 compiles deterministic profiles/config/fixtures and proves local conformance; Phase 6A consumes the frozen tuple for staging. |
| `WP-R6` | Phase 2 defines lineage/migration contracts; Phase 4 implements request/task runtime enforcement; Phase 6A verifies the integrated state sequence. |
| `WP-R7` | Phase 2 defines trust-layered outcome/retry contracts; Phase 4 implements Gateway response semantics; Phase 5 implements Sub2API scheduler decisions; Phase 6A verifies them. |
| `WP-R8` | Phase 1 owns loopback/remote-listen fail-closed guard planning and immediate startup boundary; Phase 4 owns deployment/replica runtime hardening; Phase 6A verifies staging invariants. |
| `WP-R9` | Phase 6A owns signed complete local staging; after separate approval, Phase 6B owns only the bounded canary. |

### P0.1 Handoff and Next Sequence

The exact next sequence is:

```text
P0.1 branch receipt -> merge both repository branches -> prove local main equals muqihang/main -> verify P0.1 artifact/fix ancestry on integrated heads -> fresh P1 entry baseline/context -> P1 detailed plan
```

P1 planning and implementation remain unstarted until that sequence completes. Phase 6A owns
signed complete local staging. Phase 6B remains a separately approved canary and cannot inherit
approval from any local result.

### Evidence-to-Decision Matrix Contract

The Phase 0 handoff records the following decision rows as the minimum concrete matrix contract.
Every later row uses immutable `sha256:` evidence digests, exact scope, separate wire/semantic/
state/failure compatibility verdicts, explicit negative capabilities, a target change from
`no_change|strip|disable|add|replace`, a named owner and reviewer, and a promotion gate. The
Phase 0 values below are decision inputs, not permission to enable runtime behavior.

| Decision row | Evidence digest | Scope | Compatibility verdict | Negative capabilities | Target change | Owner | Promotion gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P0 governance/exit | Exit baseline `sha256:d3263421bfb3c1e9b0f52557e1501d5e9ab6ff33616f26c2aa7cc2d4ad4f3ea6`; Sub2API formal-pool contract `sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1` | Frozen reviewed CC Gateway and Sub2API heads, branch, exit manifest, formal-pool contract, and entry parent reference | Structural and digest binding verified; wire, semantic, state, and failure compatibility remain unclaimed | Real upstream, profile promotion, production deployment, and real canary | `no_change` | cc-gateway-oracle-owner; security-reviewer | Phase 0 exit receipt, then Phase 2 contract gate |
| HA-P0-009 | `cc-b4-b6-red` result `sha256:49c758af2acf9a1c698001316fd979e4c02285f0162c97baaa963667e361bc8d`; failure artifact `sha256:4e13136e25eb6a1990be46334c83270847230effad58a7742fb67a1cfccf5b4d` | Local gateway HTTP path through `startProxy` and `handleRequest` | Failure compatibility is `incompatible`: missing, unknown, contradictory, unsupported, or incoherent declarations reach transport; wire, semantic, and state remain unclaimed | Absent, unknown, contradictory, expired, unsupported, or incoherent capabilities | `disable` | cc-gateway-oracle-owner; security-reviewer | Phase 2 negative-capability enforcement |
| AV-B1-001 | `sub2api-b1-b3-red` result `sha256:e91e73322e349bcecf7962ca6ecd5ea6e847e29d664cb05c059ae036c658b19f`; failure artifact `sha256:9a8e8243d5433ad61c73e0f0ea58a18c4be5e0a8afd70a1152de3413e2b81339` | Local Sub2API browser-egress attestation fixture | Semantic, state, and failure compatibility are `incompatible`: arbitrary, wrong, expired, cross-session, and post-proxy-change proofs remain accepted | Untrusted, expired, replayed, cross-session, or proxy-mismatched proof | `disable` | sub2api-formal-pool-owner; security-reviewer | Phase 1 browser-egress attestation boundary gate |
| AV-B2-001 | `sub2api-b1-b3-red` result `sha256:e91e73322e349bcecf7962ca6ecd5ea6e847e29d664cb05c059ae036c658b19f`; failure artifact `sha256:3e05b74f37ec8e16f720bc4409b8a10aa930464f961076b211c1299daa4cb6da` | Local Sub2API onboarding/session/account authorization fixture | Semantic, state, and failure compatibility are `incompatible`: cross-boundary operations and independent authorization dimensions are not fail closed | Cross-tenant, cross-group, non-owner, stale-version, wrong-role, or wrong-state operation | `disable` | sub2api-formal-pool-owner; security-reviewer | Phase 1 onboarding authorization boundary gate |
| AV-B3-001 | `sub2api-b1-b3-red` result `sha256:e91e73322e349bcecf7962ca6ecd5ea6e847e29d664cb05c059ae036c658b19f`; failure artifact `sha256:302effcdb78c69f0fb128ef0415667d207300ed030a4605d5f56d7552e7598be` | Local Sub2API public-origin authority fixture | Wire, semantic, and failure compatibility are `incompatible`: untrusted Host and forwarded authority can control browser URLs | Host-derived or untrusted forwarded origin without configured authority | `disable` | sub2api-formal-pool-owner; security-reviewer | Phase 1 public-origin authority boundary gate |
| AV-B4-001 | `cc-b4-b6-red` result `sha256:49c758af2acf9a1c698001316fd979e4c02285f0162c97baaa963667e361bc8d`; `sidecar-b4-b6-red` result `sha256:548fad68cfa6b041380057a1e731125b3ce0437bd959d36657835f9de2018db7`; failure artifact `sha256:83dc5cf5460ef272f9920281f49439eef9ef5185573feea7b808b532fc9c1c0d` | Local CC Gateway and sidecar formal-pool direct-egress fixture | Wire, state, and failure compatibility are `incompatible`: missing context, proxy generation, manifest authority, or fallback prohibition can reach transport | Missing account/context/proxy generation/manifest authority, disabled profile, or direct fallback | `disable` | cc-gateway-oracle-owner and sidecar-owner; security-reviewer | Phase 4 transport-cell direct-egress gate |
| AV-B5-001 | `sidecar-b4-b6-red` result `sha256:548fad68cfa6b041380057a1e731125b3ce0437bd959d36657835f9de2018db7`; failure artifact `sha256:29fd4e3bf4432003fcf6a560c0a5cf69b05b902e637f82dfdfbeef98460745cf` | Local sidecar complete-envelope authentication and replay fixture | Wire, semantic, state, and failure compatibility are `incompatible`: envelope mutations and replay across restart or replicas are not fully rejected | Incomplete, stale, malformed, unauthenticated, replayed, cross-replica, or policy-mismatched envelope | `disable` | sidecar-owner; security-reviewer | Phase 4 sidecar authentication and replay gate |
| AV-B6-001 | `cc-b4-b6-red` result `sha256:49c758af2acf9a1c698001316fd979e4c02285f0162c97baaa963667e361bc8d`; `sidecar-b4-b6-red` result `sha256:548fad68cfa6b041380057a1e731125b3ce0437bd959d36657835f9de2018db7`; failure artifact `sha256:fbefa27d21a62119c46ff74b3a21b8ec5fcd6fd20a95e07e9fba52c68efde9e4` | Local CC Gateway URL policy plus sidecar resolver/dial fixture | Wire, semantic, state, and failure compatibility are `incompatible`: unsafe ranges/directive confusion pass and policy-owned resolution/pinning is absent | Unsafe, private, link-local, rebinding, redirect, nested-proxy, or alternate destination | `disable` | cc-gateway-oracle-owner and sidecar-owner; security-reviewer | Phase 4 proxy destination and DNS-pinning gate |

Unknown, contradictory, expired, parser-disagreeing, or unexplained-transport rows remain disabled
and cannot become acceptable in Phase 4. Each Phase 3A matrix artifact must also bind maximum
authority, blocking contradictions/expiry, rollback reference, retention, redaction, destruction,
requirement IDs, and the verifying command digest.

### Artifact-Level Exit Gates

Phase 3A exits only with schema/version/digest/scope/owner/sensitivity/retention/verification/
expiry/requirement bindings for its execution graph, package inventory, static/dynamic evidence,
HTTP/SSE/TLS/HTTP2/unknown-transport inventory, parser agreement, matrices, diffs, convergence,
negative evidence, classifier leak report, decision matrix, negative-capability manifest, and
destruction record.

Phase 3B/3.5 exits only with deterministic compiler/config/fixture/local-conformance artifacts,
byte-identical repeat output, matching TypeScript/Go/manifest/fixture-validator digests, one
truthful candidate tuple, negative capabilities, and an independently addressable rollback tuple.
It does not emit the signed complete local-staging bundle.

Phase 4 exits only with code/config/contract/manifest-bound transport-cell, proxy identity,
complete-message, replay, policy-broker, rotation/restart, isolation, resource, retry,
split-brain, kill-switch, and rollback artifacts proving fail-closed behavior before egress.

Phase 5 exits only with machine-readable behavior budget, deterministic scheduler replay,
counterfactual/shadow non-mutation, cost/fairness/oscillation, metric-to-action, workload,
blue-team, privileged-action, capacity, incident, rollback, and expiry artifacts.

Phase 6A exits only with a frozen complete local full-chain manifest, signed bundle, zero-external-socket
proof, campaign index, leak scan, convergence/compatibility reports, rollback propagation, and
every capability bound to Phase 3A evidence and Phase 3B/3.5 conformance. Phase 6B additionally requires one approved
hypothesis, fixed manifest/contract/account/proxy/credential/transport digests, bounded timeline,
stop rules, cleanup/destruction, conclusion-boundary validation, and an `upstream_canary_observed`
result with no automatic promotion.

Priority 0 semantics are explicit: Phase 0 defines and registers `HA-P0-009` and keeps its
cross-language/schema fixture failing; Phase 2 implements and enforces the negative-capability
manifest, denying absent, unknown, contradictory, expired, or unsupported capabilities before
request construction, DNS, or socket creation.
