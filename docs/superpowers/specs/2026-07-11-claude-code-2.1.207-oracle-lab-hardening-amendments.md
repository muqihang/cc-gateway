# Claude Code 2.1.207 Oracle Lab Hardening Amendments

## Status

- Design date: 2026-07-11
- Applies to:
  - `2026-07-11-claude-code-2.1.207-oracle-lab-design.md`
  - `2026-07-11-claude-code-2.1.207-adversarial-validation-v2.md`
- Purpose: turn identified gaps in the two parent designs into implementation-ready amendments
- Scope: evidence acquisition, local security boundaries, controlled upstream canary evidence,
  production safety, and document traceability
- Delivery state: amendment design only; it does not claim that any listed control is implemented
- Governing documents, highest precedence first:
  1. `docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md`
  2. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md`
  3. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-adversarial-validation-v2.md`
  4. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-design.md`
- Historical requirement registry v1: `docs/superpowers/registry/oracle-lab-requirements.json`
- Requirement registry v2: `docs/superpowers/registry/oracle-lab-requirements-v2.json`
- Normative precedence: `review_amendments > hardening_amendments > adversarial_validation_v2 > oracle_lab_design`; every conflict MUST be registered explicitly in Registry v2, never silently replaced or superseded
- Requirement ID prefix: `HA-*`

## 1. Amendment Objective

The two parent designs already define a strong evidence-driven architecture. They cover package
provenance, static analysis, hermetic runtime observation, HTTP and TLS capture, compatibility
manifests, account transport cells, sidecar enforcement, adversarial testing, scheduling,
rollback, and a bounded real-account canary.

This amendment closes the remaining gaps that could otherwise cause one of four failures:

1. a design requirement is mistaken for an implemented control;
2. local observations are overinterpreted as proof of upstream account safety;
3. strict isolation works functionally but fails under load, restart, rotation, or partial outage;
4. privacy controls remove so much diagnostic information that incidents cannot be classified.

The amended system must be able to answer, for every promoted capability:

- what was observed;
- how it was observed;
- which version, platform, entrypoint, auth mode, proxy mode, and runtime produced it;
- which implementation reproduces it;
- which tests prove the local boundary;
- which claims remain unknown because they depend on Anthropic server-side state;
- what automatically disables the capability when evidence becomes stale or contradictory.

## 2. Explicit Boundary

This amendment does not convert the lab into an upstream detection-evasion program.

The permitted use of real upstream requests is limited to approved, hypothesis-driven canary
validation. A canary may establish that a bounded request sequence was accepted and behaved in
a particular way. It may not be used to claim that hidden provider policy, long-term account
safety, ban probability, or fleet suitability has been discovered.

The implementation must not:

- invent official-client fields, proofs, signatures, or attestations;
- randomize fingerprints per account;
- automatically change proxy, timing, request shape, or transport profile in response to an
  account restriction in order to continue probing;
- hide or misrepresent shared-account behavior;
- promote a profile because a small number of real requests did not immediately fail;
- treat absence of an immediate restriction as proof of safety.

## 3. Normative Status and Traceability

### 3.1 Requirement Status Registry

Add a machine-readable status registry for every normative requirement in all three designs.
Each entry must contain:

```text
requirement_id
source_document
source_section
precedence
priority
depends_on
acceptance_gate
implementation_status
owner
repository
implementation_files
test_files
verification_command
evidence_artifact
last_verified_commit
last_verified_at
expiry
known_gaps
canary_evidence_ids
production_gate_ids
rollback_evidence_ids
deployed_artifacts
contradiction_ids
```

Allowed `implementation_status` values are:

```text
design_only
deferred
failing_test_added
locally_verified
upstream_canary_observed
production_verified
blocked_by_baseline
```

Unknown fields, unknown statuses, missing owners for Priority 0 or Priority 1 requirements,
unresolved dependencies, and invalid verification-state transitions fail closed. The production
evidence fields are always present. They remain empty (and `expiry` remains `null`) before
`production_verified`; production verification requires current canary, gate, rollback,
deployment, and expiry evidence with no open contradiction IDs.

No prose statement in a design document may be presented in operational dashboards as an active
control unless the registry status is at least `locally_verified` and its commit and evidence
digest match the deployed artifact.

### 3.2 Baseline Freeze Record

Every run must freeze and record:

- CC Gateway commit and dirty-state digest;
- Sub2API commit and dirty-state digest;
- shared contract path category and digest;
- package lock digests;
- sidecar source and binary digests;
- policy broker digest when present;
- manifest and root metadata digests;
- operating system build, architecture, runtime, CA source, and relevant library versions;
- observer, parser, canonicalizer, and instrumentation implementation digests.

A run must fail before execution when the frozen inputs do not match the declared run manifest.
Dirty worktrees may be used only when their complete diff digest is recorded and the resulting
evidence is labeled non-promotable.

### 3.3 Claim Matrix

Add a claim matrix separating four classes:

1. **Local structural claim**: for example, direct egress is unreachable before socket creation.
2. **Local observational claim**: for example, the pinned client emitted an observed header set.
3. **Upstream canary claim**: for example, one approved account completed one bounded sequence.
4. **Provider-internal claim**: for example, a field affects hidden provider correlation.

Provider-internal claims remain `unknown` unless supported by authoritative provider disclosure.
Statistical association from a canary is not upgraded into a provider-internal claim.

## 4. Required Architecture Decision: Gateway Compromise Boundary

The parent adversarial design currently permits two outcomes when Gateway-process compromise is
considered: implement an independently isolated policy broker, or stop the threat model below
Gateway compromise. This amendment requires an explicit deployment choice before sidecar
authentication implementation begins.

### 4.1 Protected-Gateway Deployment

If Gateway-process compromise is in scope:

- Gateway must not hold the final sidecar authorization key;
- an independently isolated policy broker must issue a short-lived, single-request capability;
- the capability must bind account, credential generation, proxy generation, persona,
  transport profile, target, method, route, final headers, final body, attempt ID, deadline,
  response policy, key epoch, and nonce;
- the sidecar must independently validate the capability and current manifest authority;
- the policy broker must receive only the minimum safe decision inputs;
- Gateway compromise tests must prove that arbitrary Gateway-generated requests are rejected
  when they lack broker authority.

### 4.2 Trusted-Gateway Deployment

If Gateway-process compromise is explicitly out of scope:

- documentation and telemetry must state that malicious-but-valid Gateway requests cannot be
  prevented by sidecar authentication;
- the deployment must still protect against external, loopback-peer, and same-container
  unprivileged attackers;
- incident response must prioritize Gateway isolation, secret rotation, manifest revocation,
  and forensic preservation;
- no release or security claim may imply protection against a compromised Gateway.

### 4.3 Acceptance

The selected boundary must appear in deployment configuration, the run manifest, generated
evidence, tests, operational documentation, and release approval. A deployment with no declared
choice must fail closed.

## 5. Evidence Factory Enhancements

### 5.1 Key Control-Flow Recovery

Extend static analysis beyond strings, imports, section hashes, and route references. For every
target version, recover a bounded call-path map for:

- request construction and final serialization;
- header and beta-token selection;
- model alias resolution;
- authentication loading and refresh;
- proxy selection and proxy-environment precedence;
- CCH or billing-attribution calculation and insertion;
- request ID, session ID, timestamp, nonce, and retry-jitter generation;
- retry, fallback, reconnect, and model-switch decisions;
- background session and update activity;
- child-process creation and IPC.

The persisted result must contain symbol or offset references, category labels, hashes, and
control-flow relationships. It must not persist proprietary decompiled source or secret values.

**Verification:** each recovered path must be tied to at least one external observation or an
explicit `not_runtime_reached` reason.

### 5.2 Selective Dynamic Instrumentation

Add a controlled instrumentation lane for questions that cannot be answered externally.
Permitted observation points include:

- immediately before final request serialization;
- immediately after compression or content encoding;
- authentication refresh decision boundaries;
- retry and fallback decision functions;
- model and capability resolution;
- proxy selection and address-resolution inputs;
- child-process launch and IPC creation;
- CCH or other derived-value input/output boundaries.

Instrumentation must obey these rules:

- run only with placeholder credentials and synthetic content unless separately approved;
- keep raw inputs and outputs in memory for immediate classification;
- compare every instrumented run to an uninstrumented control;
- label any changed behavior `instrumentation_perturbed`;
- prohibit perturbed evidence from profile promotion;
- record the hook location, instrumentation version, process identity, and evidence digest.

### 5.3 Complete Execution-Chain Provenance

Extend package provenance into an execution graph covering:

```text
registry package
-> installer or launcher
-> selected platform binary
-> interpreter or embedded runtime
-> dynamically loaded libraries
-> CA and trust-store source
-> system resolver and proxy helpers
-> child processes
-> updater or replacement binary
```

Every executable or library that can alter observable behavior must have a digest and parent
relationship. Automatic or background replacement of any node invalidates the active evidence
until the new chain is revalidated.

### 5.4 Configuration Precedence Matrix

Add deterministic tests for conflicts among:

- command-line arguments;
- environment variables;
- user configuration files;
- managed settings;
- IDE settings;
- system proxy settings;
- explicit base URL;
- shell startup files;
- credential helpers and keychain state;
- inherited file descriptors and local agents.

The manifest must record the observed precedence rules. An unobserved precedence combination
must remain disabled rather than inheriting an assumed default.

### 5.5 Authentication Lifecycle Matrix

Add bounded scenarios for:

- initial placeholder credential loading;
- credential expiry;
- refresh success and failure;
- concurrent refresh attempts;
- credential revocation;
- reauthorization invalidating an older refresh credential;
- credential rotation during a stream;
- process restart after rotation;
- IDE and CLI sharing or not sharing credential state.

Each outcome must separately record request retry, credential state, session state, account
state, proxy state, and transport-cell consequences.

### 5.6 Long-Duration and Lifecycle Runs

The mandatory runtime matrix must add bounded long-duration scenarios:

- cold start followed by repeated warm requests;
- idle connection expiry and later resume;
- multiple stream completions over one session;
- connection reset followed by reconnect;
- credential and proxy rotation with active and idle connections;
- process restart and state recovery;
- background task execution over a declared interval;
- update check or updater activation when safely observable;
- sustained but bounded concurrency.

Long-duration evidence must distinguish stable state, monotonic growth, bounded cache behavior,
and leaks in processes, connections, memory, temporary files, or descriptors.

### 5.7 Platform and Runtime Diversity

Replace platform labels with an explicit matrix containing:

- operating system and build;
- architecture and translation layer;
- runtime and standard-library versions;
- TLS and HTTP implementation;
- resolver behavior;
- trust-store source;
- IPv4 and IPv6 availability;
- local proxy implementation;
- container, virtual machine, or host execution mode.

A profile observed on one platform must not be generalized to another platform without either
runtime evidence or an explicit static-only limitation.

### 5.8 Unknown Transport Discovery

Before applying the expected HTTP/TLS matrix, run a transport discovery phase that records safe
categories for all attempted sockets and IPC mechanisms. When a new transport is observed, such
as WebSocket, QUIC, an alternate streaming protocol, a Unix socket, or a local helper protocol:

1. mark the affected capability `transport_unknown`;
2. block promotion;
3. add a bounded parser and fault matrix;
4. update the negative-capability manifest;
5. rerun external and instrumentation cross-checks.

### 5.9 Stability Convergence Instead of Three Runs

Three identical runs are a minimum smoke test, not sufficient proof of stability. Replace the
fixed rule with a convergence procedure:

- run cold-start and warm-start samples separately;
- include fresh and resumed TLS sessions;
- include fresh and reused HTTP connections;
- repeat across declared time windows and environment variants;
- classify each field as stable, conditionally stable, naturally variable, or unexplained;
- continue sampling until the confidence target or maximum evidence budget is reached;
- keep the capability disabled if unexplained variation remains.

The run manifest must declare the sample count, stop condition, observed variation, confidence
method, and resource budget. No universal sample count is assumed to be sufficient.

### 5.10 Time, Randomness, and Resume Behavior

Add tests for:

- wall-clock rollback and forward jumps;
- monotonic-clock continuity;
- timezone and locale changes;
- suspend and resume;
- process restart;
- random-source failure or deterministic test injection;
- request-ID and session-ID collision handling;
- retry jitter and deadline interaction.

Stable profile matching must exclude values that are expected to vary while still verifying
their format, scope, uniqueness, and binding semantics.

### 5.11 Negative Evidence

Every matrix cell must record both observed and explicitly absent behavior, including:

- no direct DNS or socket attempt;
- no child process;
- no credential refresh;
- no model fallback;
- no account switch;
- no proxy switch;
- no CCH;
- no telemetry route;
- no connection reuse;
- no state mutation after a rejected request.

Absence must be supported by the relevant observation mechanism. Application logs alone cannot
prove absence of a socket, process, or file operation.

## 6. Evidence Safety and Diagnostic Quality

### 6.1 Safe Error Classifier

The parent design discards CLI stderr and upstream error bodies. Preserve that default, but add
an in-memory classifier that extracts only allowlisted information:

- protocol status and safe error category;
- provider-defined error type when it matches an allowlisted syntax;
- retryability and safe retry-after bucket;
- authentication, entitlement, capacity, model, request-shape, proxy, and transport categories;
- whether reauthorization is indicated;
- whether account, credential, session, budget, cooldown, or quarantine state changed;
- request correlation reference as a scoped hash when available.

Unknown fields and all free-form text are discarded. The classifier must be fuzzed with token,
email, path, prompt, proxy credential, and account-identifier canaries.

### 6.2 Exceptional Evidence Capsule Procedure

The encrypted evidence capsule must have a complete operating procedure:

- named approver and operator roles;
- declared investigation question;
- sensitivity class;
- dedicated ephemeral encrypted filesystem;
- per-run encryption key with no production reuse;
- access log and read justification;
- maximum TTL;
- export prohibition unless separately approved;
- verified destruction of data and key;
- post-destruction verification record.

Capsules must never be enabled automatically after an error. Approval must occur before process
start and be recorded in the run manifest.

### 6.3 Scoped Reference Governance

HMAC-scoped account, session, proxy, and time-window references require:

- domain-separated keys for each reference type;
- tenant separation;
- time-window separation where long-term linkage is unnecessary;
- key rotation and revocation;
- declared retention and deletion;
- prohibition on joining datasets outside the declared purpose;
- tests proving that references cannot be reversed using low-entropy identifiers without the
  protected key.

### 6.4 Contradiction and Expiry Handling

Every evidence signal must define:

- expiry condition;
- invalidating dependency changes;
- contradictory evidence procedure;
- minimum authority after expiry;
- affected capabilities;
- automatic disable and rollback behavior;
- revalidation owner and command.

A signal becomes non-promotable when its package, platform, runtime, parser, contract, sidecar,
or manifest dependency changes without revalidation.

## 7. Account Transport Cell and Proxy Enhancements

### 7.1 Proxy Identity Contract

Define proxy identity as more than a URL. The binding must include safe references for:

- configured proxy identity;
- proxy generation;
- authentication generation;
- resolved destination set;
- actual egress category;
- network and geography bucket when policy requires them;
- DNS path category;
- IPv4 or IPv6 family;
- validation timestamp and expiry;
- approved natural-drift policy.

The system must distinguish expected address rotation within an approved proxy identity from an
unexpected proxy change. Either case must never reuse a transport cell whose authority no longer
matches.

### 7.2 Transport-Cell Resource Model

Add explicit production limits for:

- maximum cells per account and per process;
- maximum concurrent and idle connections per cell;
- DNS cache entries and TTL;
- TLS ticket and session-cache size;
- HTTP/2 stream concurrency;
- HPACK and connection-local state bounds;
- retry-state memory;
- maximum drain duration;
- maximum frozen-cell lifetime;
- global memory and file-descriptor budgets.

When a limit is reached, the system must apply deterministic backpressure or rejection. It must
not reuse another account's cell, silently bypass the proxy, or create an unbounded number of
replacement cells.

### 7.3 Rotation and Drain State Machine

Define explicit states:

```text
active -> freezing -> draining -> terminated
                  -> forced_termination
```

Rotation requirements:

- new work is rejected from the old cell immediately after authority changes;
- in-flight work follows a declared completion or termination policy;
- no retry may return to the old cell;
- old DNS, TLS, HTTP/2, proxy-authentication, cookie, and retry state is destroyed;
- drain timeout produces safe telemetry and deterministic termination;
- the new cell is not admitted until its authority and resource allocation are complete.

### 7.4 Restart Recovery

Restart tests must prove:

- stale cells are not reconstructed as active;
- stale nonces and capabilities are not accepted;
- proxy and credential generations are reloaded atomically;
- manifest and contract digests are verified before new work;
- interrupted rotations resume safely or terminate deterministically;
- no inherited socket or descriptor carries stale traffic.

### 7.5 Resource-Exhaustion Campaign

Add adversarial tests for:

- large numbers of account cells;
- rapid proxy and credential rotation;
- many idle and half-open connections;
- long-lived streams;
- HTTP/2 stream and identifier exhaustion;
- repeated failed authentication;
- sidecar queue saturation;
- replay-ledger growth;
- disk-full and descriptor exhaustion;
- repeated manifest reloads.

Required outcome: bounded resource use, no cross-account reuse, no direct fallback, no stale
authority, and a deterministic safe error.

## 8. Control-Plane and Availability Enhancements

### 8.1 Fail-Closed Backpressure

Strict fail-closed behavior must not create retry storms or uncontrolled account switching.
When sidecar, policy broker, nonce ledger, manifest authority, proxy validation, or contract
verification is unavailable:

- reject before DNS or socket creation;
- return one deterministic non-retryable or bounded-retry error class;
- stop scheduler amplification;
- prevent automatic account switching unless a separately proven policy allows it;
- expose bounded safe health telemetry;
- trigger a circuit breaker and operator alert after the declared threshold.

### 8.2 Replay-Ledger Partition Semantics

Choose and document the exact replay-protection architecture. It must define:

- consistency model;
- nonce scope and TTL;
- restart behavior;
- replica partition behavior;
- clock-fault handling;
- cleanup and storage bounds;
- key-epoch transition;
- failover and recovery;
- behavior when nonce state is unknown.

Unknown nonce state must block traffic. Availability pressure must not downgrade replay
protection.

### 8.3 Complete Authorization Matrix

Create an executable route-operation matrix covering every onboarding and account lifecycle
operation. Dimensions must include:

- unauthenticated caller;
- ordinary user;
- creator and non-creator;
- group administrator;
- tenant administrator;
- cross-group caller;
- cross-tenant caller;
- revoked or expired session;
- stale browser tab;
- concurrent role change;
- duplicated callback;
- service-to-service caller.

Every object read and mutation must validate principal, tenant, group, role, object ownership,
current state, and expected version. Random object identifiers are not authorization.

### 8.4 Operator and Administrator Threats

Add controls for privileged misuse:

- separate roles for evidence generation, manifest signing, canary approval, deployment, and
  emergency rollback;
- two-person approval for profile promotion and sensitive capsule access;
- immutable audit records for configuration, threshold, proxy policy, and kill-switch changes;
- no single operator may generate evidence, approve it, sign it, and deploy it;
- emergency actions require later review and evidence preservation.

## 9. Scheduler and Correlation Enhancements

### 9.1 Feedback-Oscillation Protection

The scheduler must prevent loops such as:

```text
failure -> account switch -> synchronized retry -> more failures -> more account switches
```

Add global and scoped circuit breakers, retry budgets, account-switch budgets, hysteresis,
minimum cooldown, and maximum decision-change rates. A retry or switch decision must record the
single triggering reason and consumed budget.

### 9.2 Fairness and Starvation

Add tests proving that risk controls do not indefinitely starve:

- specific users or groups;
- long-context requests;
- tool-heavy requests;
- less-capable accounts;
- sessions requiring sticky continuation.

Fairness metrics must not override identity, proxy, credential, transport-cell, or capability
invariants.

### 9.3 Cost and Partial-Result Accounting

The behavior budget must separately account for:

- requested work;
- accepted upstream attempts;
- rejected pre-egress attempts;
- partial streams;
- retries after no visible output;
- retries after visible output;
- tool side effects;
- duplicate upstream cost;
- terminal user-visible result.

No retry after visible output or an external tool side effect may occur without an explicit
idempotency decision.

### 9.4 Metric-to-Action Contract

Every correlation or scheduler metric must define:

- calculation window;
- minimum sample size;
- baseline and hold-out workload;
- missing-data behavior;
- false-positive and false-negative measurement;
- alert and recovery thresholds;
- hysteresis;
- allowed automatic action;
- prohibited automatic action;
- human review requirement.

Correlation metrics may gate locally unsafe scheduling. They must not automatically tune the
system to imitate or evade inferred provider behavior.

### 9.5 Representative Workload Replay

Synthetic workloads must be supplemented with approved, de-identified workload-shape replays.
The replay may retain safe categories such as duration bucket, tool-count bucket, context-size
bucket, stream duration, retry class, and concurrency shape. It must not retain prompts, bodies,
credentials, raw account identifiers, or user content.

Thresholds that behave differently between synthetic and representative replay workloads must
remain staging-only until the difference is explained.

## 10. Controlled Upstream Canary Enhancements

### 10.1 Canary Hypothesis Registry

Every real-request canary must be registered before execution with:

```text
canary_id
approved_account_ref
approvers
hypothesis
single_changed_variable
fixed_conditions
request_sequence
capability_class
proxy_and_credential_generation
request_limit
cost_limit
time_limit
immediate_stop_conditions
delayed_observation_window
expected_safe_evidence
allowed_conclusion
prohibited_conclusion
rollback_and_exit_steps
```

A canary without one clearly stated hypothesis and one controlled change must not run.

### 10.2 Canary Preconditions

Before a canary:

- all local hard gates must pass;
- the exact candidate manifest must be signed and frozen;
- the account, credential, proxy, persona, and transport profile must be fixed;
- synthetic prompts and bounded capabilities must be selected;
- request, cost, duration, and retry budgets must be active;
- the kill switch must be tested immediately before execution;
- safe telemetry and evidence redaction must be verified;
- no automatic profile promotion or additional-account enrollment may be enabled.

### 10.3 Canary Evidence Timeline

Persist only safe classified events, but preserve their order:

- authorization and credential generation used;
- manifest and contract digests;
- proxy and transport-cell references;
- request and attempt IDs as scoped references;
- connection establishment and reuse categories;
- response status and safe error category;
- first-byte and stream-duration buckets;
- retry, reconnect, model-switch, and account-switch decisions;
- authentication refresh category;
- state mutations and rollback actions;
- delayed account-state observations during the approved window.

### 10.4 Delayed and Censored Outcomes

Each canary result must be labeled as one of:

```text
accepted_bounded_sequence
immediate_rejection_classified
partial_or_ambiguous_result
delayed_observation_pending
observation_window_complete_no_known_change
account_state_change_unattributed
account_state_change_temporally_associated
```

`observation_window_complete_no_known_change` means only that no known change was observed in
the declared window. It is not evidence that the behavior is safe indefinitely.

### 10.5 Canary Stop and Expansion Rules

Stop immediately on:

- unexpected authentication or account-state change;
- unknown request or transport drift;
- proxy, credential, manifest, or profile mismatch;
- retry or cost budget breach;
- raw-material leak;
- direct or unapproved egress;
- unclassified response requiring broader collection;
- kill-switch, telemetry, or evidence-integrity failure.

Increasing account count, capability class, concurrency, duration, model coverage, or request
volume is a new canary and requires separate approval. One canary never authorizes fleet
expansion.

### 10.6 Prohibition on Automatic Reverse Optimization

Canary outcomes may cause disablement, rollback, or a new human-reviewed hypothesis. They must
not automatically modify:

- TLS or HTTP profile;
- proxy identity or geography;
- request timing;
- retry rhythm;
- account-switch behavior;
- request fields;
- identity or attestation material.

This prevents the evidence system from becoming an uncontrolled black-box probing loop.

## 11. Production and Incident-Response Enhancements

### 11.1 Capacity Qualification

Before production promotion, measure bounded behavior at declared account, request, connection,
stream, and sidecar concurrency levels. The qualification must demonstrate:

- bounded memory and descriptor use;
- stable isolation;
- no cross-cell reuse;
- no unbounded queue or retry growth;
- predictable rejection under overload;
- successful rotation and drain under load;
- rollback without re-enabling unverified profiles.

### 11.2 Operational Kill Switches

Provide independently testable switches for:

- all candidate profiles;
- each model and capability class;
- each manifest generation;
- each proxy generation;
- upstream canary traffic;
- account scheduling;
- credential refresh;
- sidecar admission.

Kill switches must fail closed, be audited, propagate within a declared time, and have a tested
recovery procedure.

### 11.3 Account Incident State Machine

Define:

```text
active -> observing -> quarantined -> revalidation_pending -> restored
                              -> retired
```

Each transition must identify the triggering evidence, allowed traffic, credential action,
proxy action, transport-cell action, operator approval, and recovery test. Model-only capacity
or entitlement failures must not automatically become account quarantine without the declared
classification evidence.

### 11.4 Incident Evidence Bundle

An incident bundle must contain safe references and digests for:

- timeline;
- deployed code and configuration;
- manifest and contract;
- account, credential, proxy, and transport generations;
- scheduler and retry decisions;
- sidecar and policy-broker decisions;
- response classifications;
- detected invariant violations;
- rollback and rotation actions;
- evidence omissions and uncertainty.

The bundle must clearly separate observed facts, system inferences, operator conclusions, and
unknown provider-side causes.

### 11.5 Periodic Revalidation

Production verification expires. Revalidation is required after:

- Claude Code version or package-chain change;
- operating system, runtime, TLS, HTTP, resolver, or CA change;
- Gateway, Sub2API, sidecar, policy-broker, or shared-contract change;
- proxy provider or proxy-policy change;
- unexplained drift alert;
- account-state incident;
- signing-key or manifest-root event;
- declared maximum verification age.

## 12. Required Test Additions

The parent work packages must add the following test families:

### 12.1 Evidence Tests

- control-flow-to-observation trace tests;
- instrumented versus uninstrumented perturbation tests;
- configuration precedence tests;
- authentication lifecycle tests;
- long-duration and restart tests;
- unknown transport discovery tests;
- stability convergence tests;
- time, randomness, suspend, and resume tests;
- negative-evidence completeness tests;
- safe error-classifier leak tests.

### 12.2 Boundary Tests

- declared Gateway-compromise boundary tests;
- policy-broker capability mutation tests when applicable;
- proxy natural-drift and unauthorized-change tests;
- transport-cell quota and exhaustion tests;
- rotation, drain, forced termination, and restart tests;
- fail-closed backpressure and circuit-breaker tests;
- replay-ledger partition and unknown-state tests;
- complete route authorization matrix tests;
- privileged-operator separation tests.

### 12.3 Scheduler Tests

- feedback-oscillation tests;
- retry and account-switch budget tests;
- fairness and starvation tests;
- partial-result and tool-side-effect accounting tests;
- metric-to-action policy tests;
- synthetic versus representative replay drift tests;
- shadow scheduler non-mutation tests.

### 12.4 Canary Tests

- missing or invalid hypothesis registry rejection;
- budget and stop-condition enforcement;
- kill-switch propagation;
- safe timeline completeness;
- delayed and censored result labeling;
- prohibited conclusion checks;
- automatic reverse-optimization prohibition;
- canary exit, credential action, connection termination, and evidence destruction.

## 13. Promotion Gate Amendments

Add these gates to both parent designs:

1. Requirement status registry matches deployed commits and evidence digests.
2. Gateway-compromise boundary is explicitly selected and tested.
3. Key control-flow paths are tied to external observations or explicit non-reachability.
4. Instrumented evidence agrees with uninstrumented controls.
5. Stable fields meet the declared convergence rule rather than only three repeated runs.
6. Long-duration, restart, rotation, and resource-exhaustion campaigns pass.
7. Unknown transports and configuration precedence combinations remain disabled.
8. Safe error classification retains diagnostic value without leaking seeded canaries.
9. Scoped-reference key separation, rotation, retention, and deletion tests pass.
10. Transport-cell resource limits and fail-closed backpressure are enforced.
11. Replay protection remains correct during partition, restart, failover, and clock faults.
12. Scheduler feedback loops, starvation, and duplicate-cost conditions remain bounded.
13. Every metric has an approved action contract and prohibited-action list.
14. Every real canary has a pre-approved hypothesis, fixed conditions, limits, stop rules, and
    allowed conclusion.
15. Canary results use delayed and censored outcome labels and cannot auto-promote a fleet.
16. No canary outcome automatically alters identity, transport, proxy, timing, or request shape.
17. Incident, rollback, rotation, and kill-switch drills meet declared recovery objectives.
18. Production verification has an explicit expiry and revalidation trigger set.

## 14. Parent-Document Revision Map

Apply these amendments to the parent oracle design:

- **Status and Objective**: add the requirement status registry and claim matrix.
- **Safety Boundary**: add the safe error classifier and scoped-reference governance.
- **Evidence Authority Model**: add expiry, contradiction, and invalidating dependency rules.
- **Package and Static Analysis**: add control-flow recovery and complete execution-chain
  provenance.
- **Hermetic Runtime Observer**: add configuration precedence, authentication lifecycle,
  long-duration runs, negative evidence, and unknown transport discovery.
- **TLS and Proxy Observer**: replace the three-run rule with stability convergence and expand
  proxy identity semantics.
- **Account Transport Cell**: add resource budgets, rotation state machine, restart recovery,
  and exhaustion behavior.
- **Validation Gates**: add convergence, long-duration, resource, diagnostic, and revalidation
  gates.
- **Canary Phase**: add the hypothesis registry, safe timeline, delayed outcomes, and prohibited
  automatic optimization.

Apply these amendments to the parent adversarial design:

- **Attacker Capability Levels**: require an explicit Gateway-compromise deployment choice.
- **Evidence Acquisition**: add dynamic instrumentation, lifecycle, platform, and convergence
  campaigns.
- **Quantitative Gates**: add metric-to-action contracts and representative workload replay.
- **Sidecar Authentication**: finalize policy-broker or trusted-Gateway semantics.
- **Proxy Policy**: add proxy identity continuity and natural-drift handling.
- **Adversarial Campaigns**: add resource exhaustion, fail-closed amplification, operator misuse,
  and restart recovery.
- **Scheduler Campaigns**: add feedback oscillation, starvation, and cost-accounting tests.
- **Production Canary Boundary**: add pre-registration, delayed observation, stop rules, exit
  procedure, and automatic reverse-optimization prohibition.
- **Promotion Gates**: incorporate all gates in Section 13 of this amendment.

## 15. Implementation Priority

### Priority 0: Architecture and Truthfulness

1. requirement status registry and baseline freeze;
2. Gateway-compromise boundary decision;
3. claim matrix and evidence expiry rules;
4. compatibility contract and negative-capability enforcement;
5. fail-closed direct-egress and sidecar boundary repairs already identified by the parent
   adversarial design.

### Priority 1: Reliable Evidence and Safe Operation

1. key control-flow recovery and selective instrumentation;
2. stability convergence and long-duration runs;
3. safe error classifier;
4. proxy identity and transport-cell resource model;
5. rotation, restart, replay-ledger, and backpressure behavior;
6. authorization matrix and privileged-role separation.

### Priority 2: Scheduler, Canary, and Production Maturity

1. feedback-oscillation and fairness controls;
2. representative workload replay;
3. metric-to-action contracts;
4. canary hypothesis registry and delayed-outcome model;
5. production capacity qualification;
6. incident bundles, kill-switch drills, and periodic revalidation.

No Priority 2 result may compensate for a failed Priority 0 hard boundary.

## 16. Required Deliverables

- machine-readable requirement status registry;
- baseline freeze and dependency graph artifact;
- claim matrix;
- declared Gateway-compromise boundary configuration;
- key control-flow evidence map;
- instrumentation perturbation report;
- configuration precedence and authentication lifecycle manifests;
- stability convergence report;
- long-duration and resource-exhaustion report;
- safe error-classifier schema and leak-test report;
- scoped-reference key-governance specification;
- proxy identity and transport-cell resource contract;
- rotation, restart, and replay-ledger recovery report;
- metric-to-action policy registry;
- representative workload replay report;
- canary hypothesis registry and safe timeline schema;
- delayed-outcome and conclusion-boundary report;
- incident response, rollback, key rotation, and kill-switch drill report;
- production verification expiry and revalidation schedule.

## 17. Claims That Remain Prohibited

Even after all amendments are implemented, the project must not claim:

- that Anthropic's internal risk rules have been recovered;
- that a particular account will not be restricted or disabled;
- that absence of immediate restriction proves safety;
- that a local correlation score estimates provider ban probability;
- that one canary proves long-term or fleet-wide account safety;
- that wire equivalence proves authorization or server acceptance;
- that a gateway-generated proof is valid when it depends on hidden server-issued material;
- that a compromised Gateway remains trustworthy without an independent policy authority;
- that an unobserved platform, version, transport, model, or capability inherits compatibility;
- that randomized or fabricated client identity improves safety.

The strongest defensible final statement is:

> For the declared versions, platforms, entrypoints, capabilities, and threat boundary, the
> system reproduces independently observed client behavior, enforces verified local identity and
> transport invariants, fails closed on unknown drift, and has completed the declared bounded
> upstream canary. Provider-internal policy and long-term account outcomes remain outside the
> verified claim.

## 18. Acceptance Criteria for This Amendment

This amendment is ready to drive implementation when:

- the user accepts the explicit boundary and prohibited claims;
- the Gateway-compromise boundary is selected for the intended deployment;
- every Priority 0 item has an owner, repository, target files, failing test, and verification
  command;
- all added schemas have versioning and compatibility rules;
- every new evidence type has sensitivity, retention, redaction, and destruction rules;
- every statistical metric has a declared action and conclusion boundary;
- the canary process has limits, stop rules, delayed observation, and an exit procedure;
- the parent designs are revised using the map in Section 14;
- implementation work is decomposed into reviewable packages with no unresolved security
  decision hidden inside a coding task.
