# Claude Code 2.1.207 Adversarial Validation Lab v2

## Status

- Design date: 2026-07-11
- Parent design: `2026-07-11-claude-code-2.1.207-oracle-lab-design.md`
- Purpose: authorized defensive red-team validation of CC Gateway and Sub2API
- Delivery state: implementation-driving design; code work has not started under this document
- Real Anthropic credentials and production accounts: forbidden until an explicitly approved canary phase
- Governing documents, highest precedence first:
  1. `docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md`
  2. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md`
  3. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-adversarial-validation-v2.md`
  4. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-design.md`
- Canonical requirement registry (Task 1/2 schema v1; Task 3 migrates this path in place to v2): `docs/superpowers/registry/oracle-lab-requirements.json`
- Preserved Registry v1 snapshot (created by Task 2): `docs/superpowers/registry/oracle-lab-requirements-v1.json`
- Registry adoption state: Registry v2 and RA adoption remain pending reviewed gates through Task 2 and Task 3; this Status does not claim those migrations are complete
- Normative precedence: `review_amendments > hardening_amendments > adversarial_validation_v2 > oracle_lab_design`; every conflict MUST be registered explicitly by the reviewed Task 2/3 migration, which remains pending; no conflict may be silently replaced or superseded
- Requirement ID prefix: `AV-*`

## Baseline Corrections

The parent design must not be treated as current merely because it names a commit.
Before implementation, record and reconcile:

- the parent-design CC Gateway baseline `2800d39` versus the current worktree head;
- the parent-design Sub2API baseline `d449fa7e3` versus the current worktree head;
- the exact shared-contract file and digest used by every test run;
- the current persona, request-shape, CCH, and TLS profile registry contents.

Every claimed current-code finding must carry a finding provenance record:

```text
repository
commit
file_and_symbol
observed_date
minimal_reproduction_or_failing_test
evidence_digest
revalidation_status
```

A finding is not treated as current merely because it appears in this document. Baseline
drift requires revalidation before remediation work begins.

At the time this design was expanded, the checked-out repositories did not match the
parent-design baseline, and the current Gateway implementation still centered its
formal-pool profiles on older `2.1.179` and `2.1.197` evidence. No `2.1.207` profile is
considered implemented or `production_verified` until the evidence and integration loop closes.

## Two-Track Execution Rule

Implementation proceeds on two tracks in parallel:

1. **Immediate boundary repair**: fix already confirmed authorization, attestation,
   direct-egress, sidecar-authentication, proxy-policy, and manifest-integrity defects.
2. **Evidence factory**: reverse, observe, instrument, cross-check, and classify the
   pinned official clients before defining version-specific behavior.

Generic security boundaries do not wait for client reverse engineering. Client-specific
persona, TLS, CCH, retry, model, cache, and request semantics do wait for evidence.

## Why This Is a Second Design

The parent design establishes the evidence oracle, hermetic runtime boundary, safe
manifest format, and cross-project integration contract. This design does not
replace those controls. It adds an adversarial lane that assumes configuration,
control messages, state transitions, proxy records, local processes, and operators
can be malicious or compromised.

The two designs have different acceptance questions:

- Oracle design: "What does the pinned official client actually do?"
- Adversarial design: "Can an attacker make the system violate an approved policy
  without producing a blocking signal?"

## Authorized Objective

Produce reproducible evidence that the shared-pool architecture:

- cannot promote an account without completing every required server-side gate;
- cannot route formal-pool traffic without the selected proxy, authenticated sidecar, and
  approved transport profile;
- cannot accept forged, replayed, cross-session, cross-account, or downgraded authority;
- cannot silently fall back to direct Node, Go, DNS, or alternate proxy egress;
- cannot leak credentials, prompts, request bodies, proxy secrets, or raw account identifiers;
- classifies account, credential, proxy, model, capacity, and control-plane failures independently;
- produces sufficient safe telemetry for blue-team detection and incident reconstruction.

Success is measured by prevention, detection, and evidence quality. Non-detection of
abnormal shared-account behavior is not a success criterion.

## Attacker Capability Levels

Security claims are evaluated against explicit capability levels:

1. **External or tenant attacker**: can call exposed APIs but has no local execution.
2. **Loopback peer**: can reach local TCP/Unix endpoints but cannot read Gateway or sidecar
   memory, files, credentials, or secret mounts.
3. **Same-container unprivileged process**: has local execution with a distinct UID and
   restricted filesystem, IPC, ptrace, and process visibility.
4. **Gateway process compromise**: can issue arbitrary Gateway operations and read Gateway
   process memory, but cannot compromise the independently isolated sidecar or policy broker.
5. **Host/root compromise**: outside the enforceable boundary; detection, secret rotation,
   containment, and recovery are required, but request authenticity cannot be guaranteed.

Complete-message HMAC protects levels 1 through 3 only when its key is unavailable to the
attacker. To retain meaningful enforcement at level 4, authorization and signing authority
must reside in a separately isolated policy broker or the sidecar must independently validate
a narrowly scoped capability issued by that broker. The design must not claim that a secret
held by a compromised Gateway remains trustworthy.

## Phase A: Evidence Acquisition Before Integration

No profile promotion work begins until the following evidence pack is complete.

### A1. Pinned Package and Binary Provenance

- Resolve exact package versions `2.1.197`, `2.1.201`, `2.1.203`, `2.1.206`, and `2.1.207`.
- Record npm integrity, shasum, signature metadata, publish timestamp, package inventory,
  executable hashes, platform, and architecture.
- Verify each artifact with two independent hash/inventory implementations.
- Reject floating tags and reject any runtime artifact whose hash is absent from the run manifest.

### A2. Static Analysis

Perform static analysis without patching the client:

- endpoint, header, beta-token, model, tool, environment, proxy, TLS, MCP, and auth strings;
- executable sections, embedded assets, wrapper scripts, native imports, and package metadata;
- cross-version category diffs and section hashes;
- route construction and environment-variable references;
- retry, fallback, login-expiry, base-URL, background-session, and telemetry code paths.

Persist only safe summaries and hashes. Decompiled proprietary implementation, raw
credentials, embedded secrets, and arbitrary raw strings are not committed.

### A3. Hermetic Runtime Capture

Run the unmodified pinned client with:

- temporary `HOME`, XDG paths, cache paths, config directory, and working directory;
- placeholder credentials only;
- local CONNECT observer and local MITM observer;
- OS-enforced denial of every socket and IPC endpoint except an exact per-run observer allowlist;
- process, file, DNS, socket, and child-process instrumentation;
- bounded runtime, memory, output, retries, and process count.

Capture in memory, classify immediately, and discard:

- HTTP request bytes and request construction order;
- CONNECT targets and proxy behavior;
- TLS ClientHello and negotiated protocol behavior;
- DNS attempts, socket attempts, child processes, opened files, and environment reads;
- retry, timeout, partial-stream, and process-exit behavior.

The evidence output contains only safe field names, ordered public protocol identifiers,
counts, booleans, buckets, hashes, and omission reasons.

The runner disables core dumps and crash reporters, hides ambient credential agents and
inherited descriptors, isolates unauthorized loopback services and Unix sockets, and records
the platform enforcement mechanism. An exceptional raw evidence capsule follows the parent
design's explicit approval, encrypted ephemeral storage, short-TTL, access-audit, and verified
destruction requirements. Production never creates a raw capsule.

### A4. Runtime Instrumentation Cross-Check

At least two independent observation paths must agree:

- application-layer local observer;
- syscall/socket/process instrumentation;
- TLS parser A and independent TLS parser B;
- request-shape parser A and canonical JSON/parser B.

Any unexplained disagreement blocks profile promotion.

Independence is measured at the implementation and dependency level. Two wrappers around the
same parser or canonicalization library do not count as independent confirmation. The evidence
manifest records parser implementation, version, dependency digest, and disagreement handling.

### A5. Cross-Account Correlation Lab

Single-request correctness is insufficient for a shared-pool system. Add a synthetic
population lab with `N` virtual accounts, `M` virtual users, multiple proxy buckets,
multiple Gateway instances, and controlled workload generators.

Persist only HMAC-scoped references and safe time-series features. Measure:

- request, retry, model-switch, session-creation, and tool-use timing correlation;
- concurrency curves and scheduler batch effects;
- proxy ASN/category, geography bucket, DNS path, connection reuse, and TLS resumption categories;
- account-switch and proxy-switch sequences;
- first-byte, stream-duration, and failure-recovery distributions;
- whether multiple accounts exhibit a common controller or scheduler signature.

Outputs include:

- `same_operator_cluster_risk`;
- `synchronized_retry_risk`;
- `shared_scheduler_signature`;
- `cross_account_timing_correlation`;
- `proxy_path_correlation`;
- `account_switch_correlation`.

These outputs are defensive risk indicators. They are used to identify locally created
group-level anomalies, gate scheduling, and explain incidents.

They are not estimators of provider-side detection, policy enforcement, account restriction,
or ban probability. Statistical reports include the baseline cohort, sample size, confidence
interval, effect size, minimum detectable effect, multiple-comparison correction, missing-data
policy, and the workload assumptions under which the result is valid. A correlation score alone
cannot promote a profile or justify broadening a canary.

### A6. Expanded Fault and Adversarial Matrix

The runtime matrix must include more than HTTP status codes:

- DNS success followed by TCP refusal;
- CONNECT success followed by partial TLS failure;
- invalid or unexpected TLS session-ticket behavior;
- HTTP/2 stream reset and connection-level GOAWAY;
- partial, duplicated, malformed, or reordered SSE events;
- slow upstream responses that overlap with client retry timers;
- sidecar profile and summary disagreement;
- Sub2API/Gateway account-proxy mapping TOCTOU;
- concurrent requests for the same session;
- credential expiry or rotation during an active request;
- proxy replacement while an older pooled connection remains alive;
- manifest and policy update during request construction.

Every injected failure records four independent consequences:

1. retry decision and amplification;
2. account-selection change;
3. proxy or connection-path change;
4. account, session, budget, quarantine, and credential-state mutation.

The campaign enforces an account transport-cell invariant. DNS caches, resolved addresses,
TCP connections, TLS tickets, HTTP/2 connections, HPACK state, proxy authentication, retry
state, and connection-local metadata are keyed by account, credential generation, proxy
generation, persona version, and transport profile. Cross-cell connection reuse or coalescing
is a release blocker. Rotation tests require old cells to freeze before admission of new work
and prove deterministic drain or termination without stale traffic.

### A7. Manifest Supply-Chain Authority

Every promoted manifest contains and enforces:

```text
manifest_digest
signature_algorithm
signing_key_id
issued_at
expires_at
monotonic_policy_version
parent_manifest_digest
promotion_approval_refs
source_package_digests
shared_contract_digest
```

Requirements:

- Gateway and Sub2API verify the same manifest digest;
- policy versions cannot move backwards;
- revoked manifests cannot be re-enabled by configuration rollback;
- hot reload is atomic;
- all replicas converge before traffic uses the new policy;
- promotion requires an auditable two-person approval record;
- key rotation and emergency revocation are tested.

The trust bootstrap must define offline root-key custody, online signing roles, threshold and
separation-of-duty rules, trusted-clock behavior, root rotation, key compromise recovery, and
availability behavior when fresh metadata cannot be obtained. Anti-rollback also covers freeze,
mix-and-match, stale-snapshot, expired-timestamp, and clock-rollback attacks. A TUF-like role
split is preferred over one long-lived signing key.

### A8. Replay, Fork, and TOCTOU Evidence

The authority model must answer explicitly:

- whether every nonce is globally one-time;
- the maximum accepted time skew;
- whether context binds account, credential generation, proxy generation, egress,
  persona, session, route, method, final body hash, and final header hash;
- whether a control-plane token can be replayed across accounts or replicas;
- whether register, healthcheck, activate, and promote are idempotent and locked;
- whether proxy or credential rotation invalidates old context immediately;
- whether the sidecar authenticates the calling Gateway instance and complete request.

Build a dedicated replay/fork/TOCTOU harness rather than relying on ordinary unit tests.

The authenticated control protocol uses a deterministic, versioned, length-delimited encoding
such as deterministic protobuf or CBOR. It normatively defines URL and IPv6 normalization,
query ordering and duplication, repeated headers, empty values, Unicode, content encoding,
compressed versus decompressed body identity, and exact final wire-body hashing. The envelope
binds a key epoch, attempt ID, absolute deadline, content length, content encoding, final header
hash, final body hash, and expected response-policy ref.

Replay protection must survive restart and replica changes. It uses either a crash-consistent,
cluster-consistent nonce ledger or an epoch-key design that invalidates every pre-restart token.
Timestamp validation uses monotonic elapsed time where possible and explicitly tests wall-clock
rollback, NTP jumps, suspend/resume, and maximum skew.

### A9. Claude-Specific Behavior Budget

Implement an explicit `ClaudeBehaviorBudget`; do not inherit OpenAI scheduler semantics
by name or assumption. Define budget ownership and accounting for:

- account, user, group, session, and model dimensions;
- request rate, concurrency, five-hour and seven-day windows;
- long context, prompt caching, thinking, adaptive thinking, and tool calls;
- partial streams and upstream failures;
- retries and duplicate-cost prevention;
- account switching, sticky-session preservation, and cooldown behavior;
- capacity or entitlement failures that must not quarantine an account.

The budget engine emits safe decision reasons and supports deterministic replay.

Every logical operation carries an attempt ID, retry budget, and end-to-end deadline. Retries
after a partial stream or externally visible tool side effect require an explicit idempotency
decision. Budget accounting distinguishes requested work, accepted upstream attempts, partial
usage, duplicate attempts, and terminal user-visible results.

### A10. Canonical Semantic Diff

Byte and JSON-key summaries remain necessary but are not sufficient. Build a canonical
request and response AST plus a stateful trace model across versions and entrypoints:

- system block placement and ordering;
- tool-schema ordering, optional fields, and default values;
- cache read/write controls and observed cache behavior;
- `count_tokens` and `messages` semantic consistency;
- retry changes to request ID, session ID, and metadata;
- model alias to full-model resolution;
- 1M context, thinking, adaptive-thinking, output-config, and tool combinations;
- behavior before and after parse/reserialize.
- SSE event ordering, usage, stop reasons, tool and thinking blocks, partial-stream termination,
  malformed terminal events, and error-to-retry classification;
- HTTP/2 SETTINGS and pseudo-header order, flow control, resets, GOAWAY, keepalive, connection
  reuse, HPACK state boundaries, and any observed HTTP/3 negotiation or fallback;
- session start, count-tokens, message stream, tool use, retry, reconnect, credential refresh,
  and session-resume sequences;
- resulting account, budget, cooldown, quarantine, credential, proxy, and session mutations.

Semantic changes receive an explicit compatibility classification and authority state.

Compatibility is granted independently at four layers: wire equivalence, semantic equivalence,
state-sequence equivalence, and failure-semantics equivalence. A capability is enabled only when
all applicable layers pass. Agreement among Gateway, Sub2API, and sidecar is insufficient unless
their result also matches the external oracle observation.

### A11. Safe High-Dimensional Observability

Safe buckets remain the production default, but complex correlation failures need more
diagnostic resolution. Define a fixed feature-vector schema with:

- sensitivity classification per feature;
- HMAC-scoped account, session, proxy, and time-window references;
- bounded cardinality and retention;
- encrypted, short-TTL laboratory evidence capsules;
- audited break-glass access for approved laboratory investigations;
- permanent production prohibition on raw credentials, bodies, prompts, CCH, and ClientHello.

The capsule exception and the default memory-only policy are mutually exclusive per run. The
run manifest records which mode was selected before process start; a process cannot switch modes
after observing data. Capsule access never becomes a production troubleshooting shortcut.

### A12. Quantitative SLO and Rollback Gates

Replace subjective promotion decisions with numeric gates:

- direct fallback count: `0`;
- proxy mismatch count: `0`;
- manifest digest mismatch count: `0`;
- cross-replica policy split count: `0`;
- replay acceptance count: `0`;
- retry amplification ratio: bounded by an evidence-derived limit;
- account-switch rate: bounded by a workload-specific limit;
- repeated-request rate after 429: bounded by a policy limit;
- false-quarantine and missed-quarantine rates: measured and reviewed;
- cross-account correlation risk: below an approved staging threshold;
- automatic rollback: triggered on any hard invariant or sustained SLO breach.

Thresholds are derived from synthetic workloads and approved staging observations. They
are not copied from undocumented assumptions.

Every soft threshold includes baseline distribution, minimum sample size, confidence interval,
effect size, evaluation window, missing-data behavior, and hysteresis. Threshold tuning uses a
held-out workload to reduce overfitting. Synthetic and staging thresholds measure locally created
coupling and regressions only; they do not claim to model provider-side enforcement. Hard
invariants remain exact and do not become statistical tolerances.

### A13. Package, Platform, and Update Drift

Extend provenance and runtime coverage to include:

- npm tarball to platform-binary mapping;
- installer and launcher environment changes;
- Node, Go, TLS library, system CA, and OS differences;
- macOS arm64, macOS x64, and Rosetta behavior where available;
- VS Code extension network activity and bundled runtime selection;
- background updater and in-process version replacement behavior;
- version pinning, staged promotion, and rollback after an update.

The provenance graph follows the complete execution chain from registry artifact through
launcher, downloaded or embedded platform binary, interpreter/runtime, dynamically loaded
libraries, CA source, OS image/build, installer, and updater. Every executable component that
can alter observable behavior has a digest and parent relationship.

Automatic updates must never silently select or create a production profile.

### A14. Matrix Coverage Strategy

The evidence campaign does not require an unbounded Cartesian product. It defines:

- a mandatory core for every target release and production capability class;
- mandatory high-risk interactions selected from the threat model;
- deterministic pairwise or higher-strength combinatorial coverage for remaining dimensions;
- seeded property-based, stateful, mutation, and fault campaigns;
- explicit resource budgets, stop conditions, and reproducible seeds.

Every run emits a machine-readable coverage report listing selected, omitted, degraded, and
disabled combinations. A degraded result counts as safe only when the corresponding capability
is disabled in the negative-capability manifest.

### A15. Cross-Layer Behavior Coherence

Implement the parent design's `BehaviorCoherenceCertificate`. It binds package evidence,
platform, entrypoint, auth mode, persona, request and response profiles, CCH policy, TLS/HTTP
profile, proxy and credential generations, retry policy, environment, and model capabilities.

Mutation tests assemble individually valid fields into combinations never emitted by the pinned
client. Every such Frankenprofile must be rejected before DNS lookup or socket creation. The
manifest also contains explicit negative capabilities; absence never means permission.

## Phase B: Immediate Control-Plane Findings

The following findings are release blockers and require regression tests before any
real-account canary.

Each finding must first be revalidated against the frozen current repository heads and carry
the finding provenance record defined in Baseline Corrections. A superseded finding is retained
as historical evidence but is not patched blindly.

### B1. Browser Egress Attestation Bypass

`FormalPoolOnboardingService.AttestBrowserEgress` currently accepts any non-empty
`verification_code` and sets `BrowserVerified=true` without validating the code or a
successful server-side egress observation.

Required correction:

- remove frontend-controlled confirmation as an authority source;
- allow verification state to be set only by a successful server-side nonce/IP/proxy check;
- if a manual confirmation step remains, use a server-generated one-time code bound to
  session, nonce, proxy identity, expiry, and single-use state;
- reject wrong, expired, replayed, cross-session, and post-proxy-change codes.

### B2. Onboarding Object Authorization

Every onboarding operation must bind the session to an authenticated principal,
tenant, group, creator, and permitted role. Random session IDs are not authorization.

Tests must cover cross-user, cross-admin, cross-group, and cross-tenant reads and writes
for every onboarding route.

### B3. Forwarded-Header and Public-Origin Authority

Browser check URLs must not be constructed from arbitrary `Host` or `X-Forwarded-*`
values. Use an explicit configured public origin or accept forwarded headers only from
an authenticated trusted ingress with host allowlisting.

### B4. Formal-Pool Direct-Egress Elimination

In formal-pool mode, the ordinary Node upstream path must be structurally unreachable.
The requirement must not depend on a separately configurable TLS strictness flag.

Required invariant:

```text
formal_pool_request => verified_context && verified_proxy && verified_sidecar
otherwise => deny before socket creation
```

### B5. Sidecar Request Authentication v2

The current proxy-binding HMAC does not bind the complete sidecar control request.
Replace it with the deterministic binary envelope defined by the normative compatibility
contract, binding:

- nonce and timestamp;
- profile ref and expected TLS summary bucket;
- egress bucket and proxy identity ref;
- canonical proxy URL;
- target host, port, scheme, path, route, and method;
- canonical forwarded-header hash;
- request-body hash.
- envelope version, key epoch, attempt ID, absolute deadline, content length, content encoding,
  and expected response-policy ref.

The sidecar must enforce freshness and a bounded replay cache backed by a crash-consistent,
cross-replica nonce ledger or a restart-invalidating epoch-key design. A captured valid request
must not remain usable after completion, restart, replica change, key rotation, proxy rotation,
or credential rotation. JSON canonicalization is not an acceptable signing boundary.

If the threat model includes compromise of the Gateway process, the Gateway cannot hold the
final authority key. A separately isolated policy broker issues a short-lived, single-request,
scope-limited capability that the sidecar validates independently.

### B6. Proxy Destination Policy

Proxy URLs require network-level validation, not only URL syntax checks:

- resolve hostnames and reject loopback, link-local, multicast, unspecified, metadata,
  and disallowed private ranges;
- normalize IPv4, IPv6, IPv4-mapped IPv6, and unusual textual representations;
- pin the validated resolution for the connection to prevent DNS rebinding;
- reject redirects, nested proxy directives, alternate dial targets, and scheme confusion;
- record only a safe proxy destination category and binding ref.

Private proxy destinations are allowed only by an explicit deployment policy that names the
approved network ranges and trust boundary. They are never permitted through a broad implicit
exception.

## Phase C: Adversarial Test Campaign

### C1. Attestation Mutation and Replay

Mutate one field at a time and require rejection:

- timestamp, nonce, session, account, credential, device, proxy, egress, policy, persona,
  route, method, model, TLS profile, environment profile, and billing policy;
- JSON duplicate keys, reordered keys, alternate Unicode escaping, extra keys, and
  non-canonical numeric forms;
- valid signature with altered unsigned material;
- replay before and after process restart;
- simultaneous replay against multiple gateway replicas.

### C2. State-Machine and Concurrency Fuzzing

Generate random and concurrent sequences across:

```text
draft -> proxy_verified -> browser_verified -> oauth_generated -> imported
      -> runtime_registered -> healthcheck_passed -> warming -> production
```

Inject CAS conflicts, database retries, Redis failures, process restarts, token refresh
failure, proxy replacement, sidecar outage, and duplicated OAuth callbacks.

Forbidden outcomes include premature promotion, double account creation, stale credential
use, schedulability after quarantine, or cross-session state mutation.

### C3. HTTP Parser Differential Testing

Exercise the complete Sub2API -> CC Gateway -> sidecar chain with:

- conflicting `Content-Length` and `Transfer-Encoding`;
- duplicate headers and mixed casing;
- gzip, deflate, and zstd malformed bodies and decompression bombs;
- chunk boundaries inside UTF-8, JSON tokens, tool blocks, and SSE frames;
- absolute-form URLs, encoded traversal, query duplication, and path normalization;
- half-closed streams, partial SSE errors, resets, and retry races.
- HTTP/2 SETTINGS disagreement, pseudo-header ordering, flow-control exhaustion, HPACK state
  leakage, cross-account connection coalescing, GOAWAY races, and stream-ID exhaustion;
- response JSON/SSE usage, stop-reason, tool/thinking-block, malformed terminal event, and
  partial-stream semantic differences;
- any observed HTTP/3 offer, negotiation, downgrade, or fallback behavior.

All components must agree on the same final method, path, headers, body bytes, transport state,
response semantics, and resulting state mutation. Their agreement must also match the external
oracle; internal agreement alone does not establish compatibility.

### C4. Egress Fault Injection

Prove zero egress outside the exact observer/IPC allowlist under:

- sidecar disabled, unavailable, slow, malformed, or returning an incorrect summary;
- proxy authentication failure, DNS failure, timeout, reset, and address change;
- missing ledger, read-only ledger, corrupt ledger, and disk-full conditions;
- missing profile, unknown profile, disabled profile, and authority downgrade;
- malformed environment and inherited proxy variables.

Verification requires syscall/socket evidence, not only application logs.

### C5. Secret and Raw-Material Leak Testing

Seed uniquely identifiable synthetic canary values into every secret-bearing input and
scan all observable sinks:

- stdout, stderr, structured logs, access logs, panic output, and audit events;
- temporary files, caches, evidence files, crash reports, and core dumps;
- process environment, command line, open file descriptors, and child processes;
- reverse proxy and sidecar request logs;
- committed fixtures and generated manifests.

Any exact canary match outside approved in-memory handling fails the gate.

### C6. Authorization and Tenant Isolation

Use at least two users, two administrators, two groups, and two tenant fixtures. Attempt
every onboarding and account operation across boundaries. Include stale browser tabs,
revoked sessions, CSRF attempts, and concurrent role changes.

## Phase C2: Advanced Adversarial Engineering Campaigns

The following ten campaigns extend the basic adversarial matrix. They are implementation
work, not optional research notes.

### X1. Evidence Factory and Perturbation Control

Build a repeatable evidence pipeline combining static analysis, unmodified external
observation, and selective internal instrumentation.

Rules:

- unmodified external observation is the primary runtime authority;
- internal hooks are used only for questions external observation cannot answer;
- every instrumented result is compared to an uninstrumented control run;
- behavior changed by instrumentation is marked `instrumentation_perturbed` and cannot
  promote a production profile;
- stable and naturally variable fields are classified separately;
- every promoted observation repeats at least three times and passes independent parsing.

Capture safe temporal features in addition to request shape: retry-delay buckets,
connection lifetime, first-byte latency, stream duration, session lifetime, model-switch
sequence, credential-refresh timing, and background-task timing.

### X2. Causal Fault Injection

Run controlled experiments in which exactly one failure cause changes while all other
inputs remain fixed. Examples include DNS failure, TCP refusal, partial TLS, SSE reset,
credential expiry, proxy rotation, ledger failure, and sidecar mismatch.

The result must distinguish correlation from causation and identify the exact trigger
for retry, account switch, proxy switch, budget change, or quarantine.

### X3. State-Machine Model Checking

Represent onboarding and account lifecycle as an explicit transition system and enforce
runtime and test invariants such as:

```text
Production => HealthcheckPassed
HealthcheckPassed => RuntimeRegistered
RuntimeRegistered => ProxyBindingValid
BrowserVerified => ServerSideEgressObserved
Quarantined => Schedulable == false
ProxyChanged => OldContextInvalid
CredentialRotated => OldCredentialBindingInvalid
```

Use property-based generation and concurrent execution to explore duplicate callbacks,
CAS conflicts, retry races, partial rollback, restart recovery, and idempotency failures.

### X4. Multi-Replica Split-Brain Campaign

Attack inconsistent replicas and partial deployments:

- Gateway replicas load different manifest versions;
- Sub2API and Gateway disagree on contract or policy digest;
- sidecars expose different profile registries;
- a nonce is consumed on one replica and replayed on another;
- runtime registration reaches one instance while traffic reaches another;
- proxy or credential generation changes propagate partially;
- a ledger write races with process termination.

Required outcome: version disagreement, stale authority, and unknown nonce state block
traffic before egress. Old replicas must be removed from service automatically.

### X5. Counterfactual Scheduler Replay

Record safe staging event sequences and replay them offline through multiple scheduler
versions. Compare active and candidate decisions for:

- selected account and proxy bucket;
- cooldown and quarantine;
- sticky-session preservation;
- retry amplification;
- budget consumption;
- behavior under 429, timeout, long-context, thinking, and tool-heavy workloads.

This exposes regressions before a scheduler controls traffic.

### X6. Shadow Scheduler

Run the candidate `ClaudeBehaviorBudget` and scheduler in shadow mode for an approved
observation period. The active scheduler controls traffic; the shadow scheduler only
emits safe decision differences.

Track:

- account-selection disagreement;
- proxy-selection disagreement;
- account-switch and cooldown disagreement;
- budget and risk-score disagreement;
- predicted quarantine disagreement.

Promotion requires stable metrics and an explicit review. Shadow mode never mutates
account state.

### X7. Local Compromise and Sidecar Boundary

Run separate campaigns for loopback-peer, same-container unprivileged-process, Gateway-process,
and host/root capability levels. Validate only claims enforceable at each level:

- sidecar token, proxy-binding secret, ledger, and manifest confidentiality;
- resistance to captured-request replay and mutation;
- Unix-socket or equivalent local transport permissions;
- read-only filesystem, independent secret mounts, disabled core dumps, and process isolation;
- sidecar health endpoint information exposure;
- inability to use proxy configuration as an internal-network access primitive.

Production sidecar requests use short-lived complete-message authentication and replay
protection, not only a static bearer token.

At Gateway-process compromise level, a Gateway-held HMAC key is assumed compromised. The test
therefore validates an independently isolated policy broker and scope-limited capability, or it
records that malicious-but-valid Gateway requests are outside the sidecar's prevention boundary.
At host/root level, prevention claims are replaced by containment, rotation, forensic evidence,
and recovery-time objectives.

### X8. Manifest Transparency Log

Maintain an append-only manifest lineage:

```text
manifest v8 digest -> manifest v9 parent digest -> manifest v10 parent digest
```

Gateway, Sub2API, deployment control, and the evidence repository independently record
the loaded digest. Detect rollback, skipped lineage, split deployment, revoked-profile
reuse, and configuration-center equivocation.

An append-only local file is not sufficient evidence against an equivocating configuration
service. Signed checkpoints are witnessed by at least one independent store or deployment
authority, and replicas gossip or compare recent checkpoints. Tests cover split views, withheld
updates, stale timestamps, mixed role metadata, and recovery after signing-key compromise.

### X9. Runtime Invariant Enforcement

Promote key assumptions from tests into pre-socket runtime assertions:

```text
formal_pool => verified_sidecar
formal_pool => verified_proxy
formal_pool => verified_manifest_digest
formal_pool => verified_account_identity
profile_mismatch => deny
proxy_generation_mismatch => deny
credential_generation_mismatch => deny
stale_context => deny
```

Invariant failures produce bounded safe telemetry and no network attempt.

### X10. Change-Point and Drift Detection

Detect abrupt changes in safe behavior metrics rather than relying only on fixed limits:

- retry and account-switch ratios;
- TLS summary and request AST;
- proxy connection lifetime;
- model-failure classification;
- manifest or contract digest by replica;
- cross-account correlation features;
- scheduler decision distributions.

An unexplained change pauses candidate promotion and can trigger automatic rollback.

Change-point results include baseline and hold-out windows, sample size, confidence or posterior
interval, effect size, missing-data behavior, and alert hysteresis. Synthetic correlation and
drift results are treated as local coupling indicators, never as direct estimates of external
provider policy or account restriction probability.

## Phase D: Blue-Team Validation

The lab must verify that defensive telemetry detects and explains:

- repeated attestation failures and replays;
- cross-session or cross-account binding changes;
- proxy destination changes and DNS rebinding attempts;
- sidecar authentication and TLS summary failures;
- direct socket attempts and configuration downgrades;
- abnormal state transitions and repeated account promotion attempts;
- credential refresh anomalies and model-only failures.
- synchronized multi-account behavior and common scheduler signatures;
- replica manifest or contract split-brain;
- change-point alerts in retry, switching, latency, and proxy-path distributions;
- shadow-scheduler disagreement and budget-accounting drift.

Telemetry must be safe, bounded, rate-limited, and usable without exposing account or
request secrets.

## Implementation Work Packages

The implementation is split into small reviewable packages. Each package has a failing
test or evidence fixture before implementation and a green command after implementation.

### WP0. Baseline and Contract Discovery

CC Gateway:

- `tests/` baseline and contract-discovery fixtures;
- `package.json` build/test commands;
- `config*.yaml` provenance and production-safety fixtures.

Sub2API:

- `backend/internal/server/routes/formal_pool_onboarding_routes_test.go`;
- `backend/internal/service/formal_pool_onboarding_service_test.go`;
- `backend/internal/service/formal_pool_onboarding_flow_test.go`;
- `backend/internal/service/formal_pool_account_healthcheck_test.go`.

Record `git rev-parse HEAD`, contract path, contract digest, package lock digest, and
sidecar binary digest. A stale sibling worktree must fail the run. Revalidate every Phase B
finding and attach its repository, commit, symbol, failing test, date, and evidence digest.

### WP0.5. Normative Compatibility Contract

Before version-specific implementation, define and test:

- manifest and shared-contract schemas with canonical serialization and unknown-field behavior;
- authority-state ordering and the prohibition on pre-canary server-dependent verification;
- wire, semantic, state-sequence, and failure-semantics compatibility gates;
- request and response AST schemas;
- `BehaviorCoherenceCertificate` fields and allowed tuple rules;
- negative-capability semantics;
- account transport-cell keying, isolation, rotation, freeze, and drain behavior;
- deterministic sidecar envelope encoding and replay/key-epoch rules.

Schema fixtures are consumed independently by TypeScript, Go, and laboratory tooling. Producer
and consumer version compatibility and downgrade tests fail before implementation proceeds.

### WP1. Evidence Factory

CC Gateway modules:

- `tools/claude_code_real_oracle_loopback.py`;
- `tools/claude-native-oracle-matrix.ts`;
- `tools/claude-cch-oracle-regression.ts`;
- new provenance, safe-summary, semantic-diff, and temporal-feature modules under `tools/`.
- new response-semantic, state-sequence, failure-semantic, coverage-model, and transport-trace
  modules under `tools/`.

Required tests:

- package hash mismatch is rejected;
- any socket or IPC attempt outside the exact observer allowlist blocks the run;
- raw body, credential, CCH, and ClientHello material never persists;
- independent parsers produce identical canonical summaries;
- instrumented and uninstrumented runs are compared.
- the mandatory core, high-risk interactions, combinatorial selections, omitted cases, resource
  budget, and deterministic seeds are emitted in a coverage report;
- response, transport, and stateful sequence traces match the external oracle.

### WP2. Manifest Authority and Promotion

CC Gateway modules:

- new signed manifest verifier and lineage store under `src/`;
- `src/config.ts` production validation;
- `src/proxy.ts` final digest and policy enforcement;
- sidecar profile registry and summary validation.

Sub2API modules:

- formal-pool config and runtime evidence fields under `backend/internal/service/`;
- safe contract digest propagation and validation.

Required tests:

- signature, key rotation, expiry, monotonic version, parent digest, revoke, rollback,
  split-replica, and atomic hot-reload tests.
- offline root and online role separation, threshold approval, freeze, mix-and-match,
  stale-snapshot, clock-rollback, split-view, signed-checkpoint witness, and key-compromise
  recovery tests.

### WP3. Onboarding Authorization and Replay Hardening

Sub2API modules:

- `backend/internal/service/formal_pool_onboarding_service.go`;
- `backend/internal/handler/admin/formal_pool_onboarding_handler.go`;
- `backend/internal/server/routes/admin.go`;
- `backend/internal/service/formal_pool_onboarding_store.go`;
- corresponding route, flow, concurrency, and tenant-isolation tests.

Required tests:

- invalid and replayed browser attestation codes fail;
- browser verification requires server-side egress evidence;
- cross-principal, cross-group, and cross-tenant session access fails;
- proxy and credential generation changes invalidate old context;
- duplicate OAuth callback and concurrent promote are idempotent.

### WP4. Sidecar Complete-Message Authentication

CC Gateway modules:

- `src/egress-sidecar-client.ts`;
- `sidecar/egress-tls-sidecar/internal/control/control.go`;
- `sidecar/egress-tls-sidecar/internal/server/server.go`;
- corresponding Go and TypeScript sidecar tests.

The deterministic binary envelope binds version, key epoch, attempt ID, profile, target, route,
method, proxy, egress, headers, content length and encoding, final body hash, timestamp, nonce,
absolute deadline, expected response policy, and expected summary bucket. Static-token-only,
JSON-canonicalized, partial-binding, restart-replay, replica-replay, and clock-rollback tests
must fail.

If Gateway-process compromise is in scope, this package also implements or integrates the
separately isolated policy broker that issues single-request capabilities. Otherwise the threat
model and test expectations explicitly stop at same-container unprivileged compromise.

### WP5. Claude Behavior Budget and Scheduler

Sub2API modules:

- new `backend/internal/service/claude_behavior_budget.go`;
- new scheduler selection and decision modules under `backend/internal/service/`;
- deterministic replay fixtures and shadow-mode metrics.

Required tests cover account/user/group/session/model budget ownership, retries, partial
streams, long context, thinking, tools, 429 cooldown, account switching, and model-only
failure classification.

Tests also cover attempt IDs, end-to-end deadlines, retry budgets, partial-stream idempotency,
tool-side-effect ambiguity, duplicate upstream cost, and exact separation between attempted,
accepted, partial, duplicated, and user-visible work.

### WP6. Correlation, Fault, and State Campaigns

New lab tools under `tools/` and `tests/`:

- cross-account correlation runner;
- causal fault-injection runner;
- onboarding state-machine/property-based fuzzer;
- HTTP/SSE differential parser runner;
- HTTP/2 and transport-state differential runner;
- account transport-cell isolation, rotation, drain, and coalescing harness;
- multi-replica split-brain harness;
- counterfactual replay and shadow scheduler runner;
- proxy destination and DNS-rebinding harness;
- secret-canary scanner;
- change-point evaluator.

All runners use synthetic identities and local endpoints only.

Correlation and change-point reports include baseline cohorts, hold-out workloads, sample size,
confidence intervals, effect sizes, multiple-comparison handling, missing-data behavior, and
hysteresis. They report local coupling risk only.

### WP7. Staging and Canary Gate

Run the complete Sub2API -> CC Gateway -> sidecar -> local upstream chain with every socket and
IPC endpoint outside the exact laboratory allowlist denied. Produce:

- signed manifest and lineage record;
- evidence digest bundle;
- safe correlation and scheduler report;
- fault-injection report;
- leak scan report;
- replica consistency report;
- compatibility-layer and behavior-coherence report;
- transport-cell isolation and rotation report;
- coverage selection and disabled-capability report;
- rollback drill report.

No production canary is eligible until every hard gate is green and the evidence bundle
has an explicit human approval record.

## Production Canary Boundary

The no-real-account phases remain mandatory. A production canary requires explicit
written approval and all gates passing.

The initial canary is one approved test account, one capability class at a time, with:

- fixed proxy and rollback path;
- request and cost envelope;
- immediate kill switch;
- safe summary comparison against the canary-candidate manifest;
- an explicitly approved bounded sequence such as initial request, stream completion, session
  continuation, reconnect, and one controlled failure/recovery step when required;
- no automatic promotion of additional accounts;
- no attempt to hide or misrepresent shared-account behavior.

The canary establishes limited upstream observation only. It does not statistically prove
long-term account safety, provider-side correlation behavior, or fleet suitability. Expanding
beyond one canary requires a separate review based on observed evidence.

## Required Tooling Deliverables

- pinned package intake and provenance tool;
- normative compatibility schema, canonicalization, and cross-language fixture validator;
- hermetic process runner with exact socket and IPC allowlist enforcement;
- HTTP/SSE local observer;
- response-semantic and state-sequence oracle;
- CONNECT ClientHello observer;
- local MITM observer;
- syscall/socket/process/file instrumentation collector;
- independent TLS summary parsers;
- HTTP/2 and transport-state parser/differential runner;
- safe manifest and redaction validator;
- behavior-coherence certificate and negative-capability validator;
- account transport-cell isolation, rotation, drain, and coalescing harness;
- coverage-model generator and coverage-report validator;
- attestation mutation/replay harness;
- sidecar control-envelope mutation harness;
- sidecar replay-ledger/key-epoch and clock-fault harness;
- isolated policy-broker capability harness when Gateway-process compromise is in scope;
- proxy destination and DNS-rebinding test harness;
- secret-canary leak scanner;
- cross-account correlation runner;
- causal fault-injection runner;
- HTTP/SSE differential parser runner;
- multi-replica split-brain harness;
- counterfactual replay runner;
- shadow scheduler and budget-diff runner;
- onboarding state-machine/property-based fuzzer;
- manifest root-role, signature, lineage, witnessed-checkpoint, and transparency-log verifier;
- change-point and drift evaluator;
- cross-project loopback E2E runner.

## Promotion Gates

1. Evidence provenance is pinned and independently verified, and every current-code finding has
   been revalidated against the frozen heads.
2. The normative contract, canonical serialization, authority-state ordering, negative
   capabilities, and cross-language compatibility fixtures are green.
3. Browser egress verification cannot be manually forged.
4. All onboarding objects enforce principal and tenant authorization.
5. Formal-pool direct egress is structurally unreachable.
6. Sidecar controls are deterministic complete-message authenticated, restart/replica replay
   protected, and enforce the declared attacker-capability boundary.
7. Proxy destinations pass normalized network-level policy.
8. No DNS, TCP, TLS, HTTP/2, HPACK, retry, proxy-authentication, or connection state crosses an
   account transport-cell boundary.
9. Wire, semantic, state-sequence, and failure-semantics compatibility gates pass for every
   enabled capability, and every request has a valid behavior coherence certificate.
10. State-machine, parser, and fault-injection campaigns produce no forbidden outcome.
11. Synthetic secret canaries do not appear in persisted sinks.
12. Blue-team telemetry detects every injected adversarial condition.
13. A human approves the single-account canary.
14. Manifest root trust, threshold signature, lineage, witnessed checkpoint, digest, expiry,
   freeze, mix-and-match, rollback, and key-compromise recovery checks are green.
15. Cross-account correlation, retry amplification, account-switch, and 429-repeat metrics
    remain below approved staging thresholds.
16. Statistical gates meet their declared sample-size, confidence, effect-size, hold-out,
   missing-data, and hysteresis requirements and are interpreted only as local coupling metrics.
17. Shadow scheduler disagreement is reviewed and does not violate budget or identity
    invariants.
18. All replicas converge on one contract digest and manifest digest before traffic.
19. Change-point and drift checks show no unexplained candidate behavior.
20. Canary evidence is labeled `upstream_canary_observed`; it does not automatically establish
   `production_verified` or authorize fleet expansion.

## Immediate Execution Order

1. Freeze repository heads, contract digest, package digests, sidecar digest, and finding
   provenance; revalidate every immediate control-plane finding.
2. Define the normative compatibility schema, authority lattice, four compatibility gates,
   deterministic sidecar encoding, behavior coherence certificate, negative capabilities, and
   account transport-cell contract.
3. Add failing tests for browser egress attestation bypass and onboarding IDOR.
4. Remove formal-pool reachability of the ordinary Node upstream path.
5. Implement manifest root trust, role separation, lineage, witnessed checkpoints,
   anti-rollback, and replica convergence checks.
6. Implement deterministic sidecar complete-message authentication, restart/replica replay
   protection, clock-fault handling, and the declared policy-broker boundary.
7. Harden proxy destination validation, DNS pinning, and redirect handling.
8. Implement account transport-cell isolation, rotation, freeze, drain, and no-coalescing rules.
9. Build the pinned 2.1.207 evidence pack using the hermetic runtime lab and explicit coverage
   model.
10. Add request/response semantic ASTs, state-sequence and failure-semantic diff,
   ClaudeBehaviorBudget, and shadow scheduler.
11. Run cross-account correlation, causal fault, state-machine, parser, transport, split-brain,
   counterfactual, egress, and leak campaigns.
12. Reconcile evidence into signed versioned manifests and cross-project contracts.
13. Run staging E2E with every socket and IPC endpoint outside the exact allowlist denied.
14. Execute rollback, root/key rotation, compromise recovery, update drift, transport-cell
   rotation, and kill-switch drills.
15. Review evidence, coverage, compatibility layers, threat-boundary claims, and quantitative
   SLOs before any production canary.
