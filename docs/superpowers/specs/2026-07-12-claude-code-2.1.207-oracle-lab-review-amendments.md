# Claude Code 2.1.207 Oracle Lab Review Amendments

## Status

- Date: 2026-07-12
- Type: normative review amendment and execution-quality supplement
- Implementation status: adopted normative overlay; this document does not claim that any
  requirement or runtime behavior is implemented
- Governing documents, highest precedence first:
  1. `docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md`
  2. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md`
  3. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-adversarial-validation-v2.md`
  4. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-design.md`
- Canonical requirement registry (Task 1/2 schema v1; Task 3 migrates this path in place to v2):
  `docs/superpowers/registry/oracle-lab-requirements.json`
- Preserved Registry v1 snapshot (created by Task 2):
  `docs/superpowers/registry/oracle-lab-requirements-v1.json`
- Registry adoption state: pending through Task 2 and Task 3 for Registry v2 and RA adoption; this
  Status does not claim those migrations are complete
- Conflict handling: every conflict MUST be registered explicitly by the reviewed Task 2/3
  migration; registration remains pending, and no document, requirement, or authority statement
  may be silently replaced or superseded
- Public release state verified at review time:
  - npm `latest=2.1.207`
  - npm `next=2.1.207`
  - npm `stable=2.1.197`

This document MUST be read together with the other three governing documents above and
`docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md`.

This amendment does not weaken any existing fail-closed rule. It adds missing ownership,
deliverables, acceptance gates, and implementation sequencing. If this amendment appears to
conflict with a parent document, the conflict MUST be registered and resolved explicitly. An
agent MUST NOT silently choose the less restrictive interpretation.

## 1. Executive Decision

The existing designs define a strong evidence and security framework. The primary remaining
problem is not a lack of research topics. It is the missing executable bridge between evidence
and a deployable, cross-project compatibility profile.

CC Gateway currently realizes only part of its intended value. It already performs substantial
request-side identity, persona, billing-shape, session, proxy, and final-byte validation. It has
not yet fully become:

1. a versioned protocol compatibility firewall;
2. a response and streaming-semantics authority;
3. a consumer and constraint enforcer for independently issued single-request transport
   capabilities;
4. a task-lineage and cross-version session authority;
5. a cross-project compatibility and readiness authority;
6. a safe protocol-drift and control-plane discovery sensor.

The implementation objective is therefore:

```text
Pinned Claude Code package
  -> hermetic evidence
  -> deterministic safe manifests
  -> profile compiler
  -> CC Gateway executable profile
  -> Sub2API allowed compatibility tuple
  -> deterministic compiler/config/fixture/local-conformance output
  -> Phase 6A signed complete local staging
  -> separately approved candidate/canary decision
```

Collecting evidence alone is not completion. A safe system that leaves every 2.1.207 capability
disabled may be a valid security result, but it is not a completed 2.1.207 adaptation. The phase
status must say `blocked` when the minimum candidate capabilities cannot be produced truthfully.
In this section and Section 4, `blocked` means that Phase 3B/3.5 is blocked. It does not
retroactively block historical Phase 0 or declare the entire program blocked.

### 1.1 Normative requirement registry

The following identifiers are stable and MUST be copied into the machine-readable requirement
registry. `Owner` identifies the implementation authority, not permission to self-review.
`RA-P0-*` and `RA-P1-*` encode requirement priority, not roadmap phase. Each row has exactly one
primary work package; Registry v2 `related_requirements` and roadmap phase slices carry secondary
ownership.

Under `protected_gateway`, Gateway consumes and constrains an independently issued single-request transport capability. The policy broker issues it and the sidecar verifies it; Gateway does not authorize its own transport.

| Requirement ID | Normative requirement | Owner | Primary work package | Blocks |
| --- | --- | --- | --- | --- |
| RA-P0-001 | Add Phase 3B/3.5 and a deterministic evidence-to-profile compiler | Oracle/Gateway owners | WP-R5 | any 2.1.207 candidate profile |
| RA-P0-002 | Require a minimum truthful 2.1.207 local candidate instead of allowing evidence-only completion | Oracle owner | WP-R5 | Phase 3B/3.5 exit |
| RA-P0-003 | Implement independently verified single-request sidecar capabilities and replay protection | Policy-broker/sidecar owners | WP-R3 | protected production or canary |
| RA-P0-004 | Resolve, classify, pin, and enforce proxy/upstream destinations before dial | Sidecar/Gateway owners | WP-R3 | any production egress |
| RA-P0-005 | Implement one versioned cross-project contract and readiness handshake | Gateway/Sub2API owners | WP-R1 | formal-pool scheduling |
| RA-P0-006 | Close register/rotate/freeze/drain/revoke/delete/reconcile account authority lifecycle | Sub2API/Gateway owners | WP-R2 | account/proxy rotation and production |
| RA-P0-007 | Implement bounded response semantics, retry ownership, and trust-layered outcome facts | Gateway/Sub2API owners | WP-R7 | reliable budget, retry, and quarantine actions |
| RA-P0-008 | Enforce loopback-by-default listen, remote TLS/auth, and upstream certificate verification | Gateway owner | WP-R8 | remote or production deployment |
| RA-P0-009 | Keep protected production disabled while the broker, sidecar, destination, or replay gates are RED | Security reviewer | WP-R3 | production and real canary |
| RA-P1-001 | Add the change-point version roles and machine-readable multidimensional coverage model | Oracle owner | WP-R4 | evidence completeness |
| RA-P1-002 | Generate coherent `ClientBuildIdentity`, request, response, control-plane, auth, and transport profiles from evidence | Oracle/Gateway owners | WP-R5 | profile promotion |
| RA-P1-003 | Emit bounded drift events and typed de-identified canonical fixtures | Oracle/Gateway owners | WP-R4 | explainable version adaptation |
| RA-P1-004 | Model root/child task lineage and controlled same-session client/profile migration | Gateway/Sub2API owners | WP-R6 | background/subagent capability |
| RA-P1-005 | Separate installation identity, client-instance key, and trusted-device proof | Launcher/Gateway owners | WP-R6 | any device-trust claim |
| RA-P1-006 | Make Sub2API the exclusive formal-pool refresh authority and verify durable rotation/restart behavior | Sub2API owner | WP-R2 | subscription/setup-token production |
| RA-P1-007 | Separate Gateway liveness, readiness, and protected capability detail; define replica consistency | Gateway owner | WP-R1 | multi-replica production |
| RA-P1-008 | Observe nonessential traffic enabled and disabled under a hermetic host guard | Launcher/Oracle owners | WP-R4 | control-plane completeness |
| RA-P1-009 | Split security-critical Gateway logic along runtime authority, request, response, provider, and control-plane boundaries | Gateway owner | WP-R6 | independent security review |

Every row requires a named reviewer, source section, dependency list, `implementation_status`,
linked Claim Matrix authority, test artifact, expiry, and promotion gate when entered into the
registry. Registry v2 does not create a second authority lattice. No row starts as
`locally_verified` merely because this document defines it. The superseded secondary WP links for
`RA-P0-001`, `RA-P0-009`, `RA-P1-003`, `RA-P1-007`, and `RA-P1-009` remain traceable through
`related_requirements` and the roadmap phase-slice table, never through a second primary WP.

## 2. Evidence and Claim Boundary

### 2.1 Confirmed public facts

Official public changes between 2.1.197 and 2.1.207 include background agents, daemon and session
recovery, retry and partial-stream behavior, Claude Platform on AWS, remote control, MCP lifecycle,
login expiry, managed settings, updater behavior, and credential refresh changes.

These changes justify new local experiments. They do not prove any private provider-side risk,
fraud, device-trust, or enforcement behavior.

### 2.2 Claims that remain prohibited

No implementation, report, or agent may claim that:

- matching headers proves official-client identity;
- local CCH verification proves server acceptance;
- a stable `device_id` is trusted-device proof;
- a local TLS summary proves complete wire equivalence;
- one successful request proves long-term account safety;
- public changelog entries reveal private risk-control rules;
- a numerically newer client may use a newer outbound persona without profile authority;
- local or mock evidence alone authorizes production traffic.

## 3. Required Architecture Ownership

The following ownership is normative. Implementations MUST NOT duplicate authority across layers.

| Component | Owns | Must not own |
| --- | --- | --- |
| Zhumeng launcher / host guard | process launch, isolated configuration, process tree, socket and IPC observation, bypass detection, client-instance key, optional device-proof acquisition | account scheduling, upstream credentials, outbound persona synthesis |
| Sub2API | account selection, credential refresh and persistence, quota, concurrency, sticky scheduling, account lifecycle, proxy assignment, behavior budget | final request bytes, final transport authorization, oracle profile synthesis |
| CC Gateway | compatibility tuple enforcement, final request bytes, request and response semantics, session/task lineage checks, profile selection, drift classification, bounded semantic observations | account selection, refresh-token ownership in formal-pool mode, self-authorization of a protected sidecar, independent transport authority under `protected_gateway` |
| Policy broker | short-lived single-request capability issuance when Gateway compromise is in scope | request rewriting, account scheduling, long-lived raw credential storage |
| Egress sidecar | capability verification, destination resolution and pinning, proxy-bound dial, TLS/HTTP transport, response byte streaming | profile promotion, account selection, accepting Gateway assertions without independent verification |
| Oracle lab | package intake, static/runtime observation, canonical semantic diff, safe evidence and candidate-manifest generation | automatic profile promotion, production credentials, unrestricted raw evidence retention |

Bypass detection is not a CC Gateway-only feature. A connection created outside the Gateway is not
visible to the Gateway. The launcher or host guard MUST produce the process/socket evidence, while
the Gateway consumes only a bounded signed result or capability.

Outcome facts remain separated by trust layer:

1. the policy broker and sidecar produce independently verifiable transport-authorization and
   transport-completion facts;
2. CC Gateway produces bounded request/response semantic observations;
3. Sub2API owns scheduler, budget, cooldown, quarantine, and account-selection decisions.

A Gateway-signed semantic observation is not independently authoritative under
`protected_gateway`; it cannot substitute for broker/sidecar transport facts or authorize its own
egress.

## 4. New Mandatory Bridge: Phase 3B/3.5 Profile Synthesis and Local Conformance

The delivery roadmap MUST add a phase between evidence production and runtime transport
promotion. Its canonical name is `Phase 3B`; `3.5` remains a durable alias for existing references,
IDs, and receipts. It is not an eighth top-level phase.

### 4.1 Objective

Convert reviewed evidence into deterministic, executable, versioned compatibility artifacts for
CC Gateway and Sub2API without handwritten upstream-visible constants.

### 4.2 Required inputs

- pinned package and executable provenance for the selected version and platform;
- HTTP request and response semantic summaries;
- control-plane and destination inventory;
- authentication-lifecycle evidence;
- TLS/HTTP transport summary;
- state-sequence and failure-semantics traces;
- contradiction, expiry, parser-agreement, and negative-capability records;
- linked Claim Matrix authority and reviewed evidence digests.

### 4.3 Required outputs

The exact repository paths are chosen by the Phase 3B/3.5 implementation plan after a fresh
baseline, but the logical outputs are fixed:

1. `ClientBuildIdentity` manifest:
   - package version and digest;
   - executable digest;
   - build timestamp category;
   - platform, architecture, runtime, installation mode, and entrypoint;
   - observed `User-Agent` and `x-stainless-*` schema and values;
   - stable, variable, conditional, and unexplained field classification.
2. Request profile:
   - method, authority, path, query, headers, content encoding, canonical body AST, and final-byte rules.
3. Response profile:
   - response headers, JSON/SSE event grammar, usage, stop reasons, partial-stream and terminal-error semantics.
4. Control-plane profile:
   - route, method, trigger, destination class, authentication class, and local suppress/stub/block/forward policy.
5. Transport profile:
   - proxy identity, resolver policy, destination set, TLS/HTTP behavior, retry and connection-state boundaries.
6. Authentication profile:
   - credential source, refresh lifecycle, persistence, rotation, revocation, and restart semantics.
7. Task/session lineage profile:
   - root session, parent task, current task, task class, client generation, and allowed migration rules.
8. Negative-capability manifest.
9. Allowed behavior-coherence tuples.
10. Deterministically generated CC Gateway and Sub2API configuration artifacts.
11. Typed, de-identified canonical request/response fixtures for review and regression.
12. Deterministic compiler/config/fixture/local-conformance bundle with cross-language validator
    agreement.

Phase 3B/3.5 does not produce the signed complete local-staging bundle. Phase 6A owns the full
Sub2API -> CC Gateway -> policy broker/sidecar -> mock-upstream staging chain, its signed bundle,
and zero-external-socket proof.

### 4.4 Minimum exit gate

Phase 3B/3.5 cannot exit merely because unsupported behavior is safely disabled. It MUST produce
at least one 2.1.207 candidate tuple that passes all applicable compiler/config/fixture/local-
conformance gates for:

1. a new session with a streaming Messages request;
2. a resumed session with a streaming Messages request;
3. a bounded response failure and recovery sequence;
4. deterministic regeneration of identical logical configuration artifacts;
5. exact agreement between TypeScript, Go, manifest validators, and typed fixtures.

If any of these cannot be produced from truthful evidence, Phase 3B/3.5 exits `blocked` with the
exact missing evidence or capability. Historical Phase 0 and the rest of the program are not
retroactively relabeled. The phase must not be marked complete and must not invent a value.

### 4.5 Compiler requirements

The profile compiler MUST:

- accept only schema-valid, reviewed, unexpired evidence;
- reject floating package tags;
- reject unknown, contradictory, parser-disagreeing, or unexplained inputs;
- generate all upstream-visible version, build, header, body, and transport values;
- never copy raw prompt, credential, account, proxy, response, CCH, or ClientHello material;
- produce deterministic output and a content digest;
- generate the same logical tuple for CC Gateway and Sub2API;
- emit explicit negative capabilities rather than treating absence as permission;
- support rollback to an independently addressable prior tuple;
- never mutate a stable 2.1.197 profile in place to create 2.1.207.

## 5. Mandatory Version and Behavior Matrix

### 5.1 Version roles

| Version | Role | Required coverage |
| --- | --- | --- |
| 2.1.81 | historical behavior boundary for `--bare`, API-key-only bare auth, beta suppression, concurrent OAuth refresh, channels/WebSocket behavior | static comparison plus targeted runtime controls |
| 2.1.169 | legacy CCH compatibility boundary already represented in current code | static and fixture comparison control only; never promotion authority |
| 2.1.179 | current narrow oracle, environment-residue, and TLS evidence boundary | complete regression control against the existing harness; never candidate authority by itself |
| 2.1.197 | current npm stable baseline and Sonnet 5 baseline | complete core matrix |
| 2.1.198 | background-agent default, AWS gateway/provider, network retry, inherited model/thinking | targeted change-point matrix |
| 2.1.199 | partial-stream preservation, TLS certificate failure, retry semantics | targeted response/failure matrix |
| 2.1.200 | daemon build generation, recovery, state persistence | targeted mixed-version and restart matrix |
| 2.1.201 | Sonnet 5 system-role placement | targeted request-semantic matrix |
| 2.1.202 | workflow telemetry and client-certificate rotation | targeted control-plane and TLS lifecycle matrix |
| 2.1.203 | background `ANTHROPIC_BASE_URL`, MCP roots, login expiry, stale session-token recovery | targeted bypass, MCP, and lifecycle matrix |
| 2.1.206 | public gateway login, background `CLAUDE_CODE_EXTRA_BODY`, MCP timeout and OAuth refresh | targeted auth, body-drift, and MCP matrix |
| 2.1.207 | current latest candidate, managed-settings, auto-mode, remote-control, AWS refresh and background recovery changes | complete candidate core matrix |

The full Cartesian product is forbidden. Versions 2.1.81, 2.1.169, 2.1.179, and
2.1.198-2.1.206 are change-point controls. The mandatory complete core applies to 2.1.197 and
2.1.207, with 2.1.81 retained as a historical boundary control and 2.1.169/2.1.179 retained as
explicit pre-2.1.198 controls. Pairwise or higher-strength combinatorial selection applies to the
remaining dimensions.

### 5.2 Required dimensions

The machine-readable coverage model MUST represent:

- client entrypoint:
  - foreground interactive CLI;
  - `--bare`/print/SDK;
  - background agent;
  - nested subagent;
  - agent team or workflow;
  - remote control;
  - VS Code/IDE where hermetically available;
- authentication:
  - API key;
  - subscription OAuth;
  - setup token;
  - Claude Platform on AWS credentials;
  - placeholder-only laboratory auth;
- lifecycle:
  - cold start;
  - warm request;
  - new session;
  - resumed session;
  - reconnect;
  - process restart;
  - credential refresh;
  - proxy rotation;
  - same-session client-version migration;
- feature toggles:
  - billing attribution enabled/disabled;
  - nonessential traffic enabled/disabled;
  - MCP enabled/disabled;
  - extension/IDE enabled/disabled;
  - `CLAUDE_CODE_EXTRA_BODY` absent/present;
  - tools, thinking, adaptive thinking, context management, prompt caching, and 1M intent;
- response and failure:
  - JSON and SSE success;
  - 400, 401, 403, 429, 5xx, and 529 where applicable;
  - connection reset;
  - TLS certificate failure;
  - malformed, duplicated, reordered, and partial SSE;
  - timeout before first byte, idle timeout, and total deadline;
  - visible partial output and tool-side-effect cases;
- platform and installation:
  - macOS arm64;
  - macOS x64 and Rosetta where available;
  - Linux glibc x64/arm64;
  - Linux musl x64/arm64 where published;
  - official native installation and npm installation;
  - runtime and trust-store source;
- environment fingerprint:
  - timezone and locale, including neutral UTC, Pacific, and declared China-region controls;
  - clean minimal environment versus inherited environment;
  - `ANTHROPIC_BASE_URL` absent, official, neutral loopback gateway, and inherited;
  - China-domain taxonomy absent/present with only safe category and hash summaries persisted;
  - proxy environment clean, loopback-only, inherited, and conflicting-variable controls;
  - byte-level System Prompt comparison by length, digest, stable spans, variable spans, and
    first-difference location, without persisting raw prompt material.

### 5.3 Paired comparisons

The following MUST be explicit paired comparisons under otherwise identical conditions:

- billing attribution on versus off;
- nonessential traffic on versus off;
- new session versus resumed session;
- root task versus child task;
- MCP/extension off versus on;
- API key versus subscription OAuth;
- 2.1.197 stable versus 2.1.207 candidate;
- foreground client versus background worker;
- unchanged client generation versus controlled in-session generation migration;
- clean versus inherited environment;
- `ANTHROPIC_BASE_URL` absent versus explicit loopback gateway;
- neutral timezone/locale versus China-region controls;
- clean versus inherited proxy environment;
- byte-level System Prompt equality versus an expected change-point difference.

## 6. CC Gateway Expanded Responsibilities

### 6.1 Client build identity generation

`User-Agent`, `x-stainless-*`, package version, runtime, architecture, and build information MUST
come from the generated `ClientBuildIdentity` manifest. They MUST NOT be maintained as unrelated
handwritten constants.

“Unify headers” means producing an internally coherent, evidence-backed set. It does not mean
blindly overwriting every request with guessed official-client values.

The official gateway protocol treats request headers and body fields as open sets. Therefore:

- trusted, directly observed Claude Code traffic may carry newly observed fields into a bounded
  observation/quarantine path;
- synthesized outbound profiles remain strict and may contain only approved manifest fields;
- unknown fields are never silently discarded or silently admitted;
- the final outbound profile must remain internally consistent across headers, body, response,
  auth, session, transport, and client generation.

### 6.2 Protocol drift events

Unknown-field handling MUST emit a bounded, rate-limited safe drift event containing:

- scoped run and sample reference;
- observed client version and build digest reference;
- entrypoint and route class;
- field-path keyed HMAC, never the raw value;
- type and shape bucket;
- occurrence count and first/last observed time bucket;
- request or response side;
- decision: observed, quarantined, rejected, or promoted only after a separate review;
- associated fixture and manifest digest.

A generic “unknown field rejected” counter is insufficient for adapting a new client version.

### 6.3 Response and streaming authority

CC Gateway MUST incrementally validate, without parse/reserialize mutation:

- status and response-header policy;
- SSE event ordering and block indexes;
- message start/stop and terminal completion;
- tool and thinking block transitions;
- usage and stop-reason shape;
- partial output and partial usage;
- malformed terminal events;
- client disconnect and upstream cancellation behavior;
- whether a retry is semantically permitted.

The Gateway MUST preserve upstream response and error bytes required by Claude Code. It must not
buffer the entire response before forwarding. Diagnostic capture MUST use bounded incremental
classification and a hard memory cap.

For every accepted upstream attempt, the broker/sidecar produces an independently verifiable
transport-authorization and transport-completion fact. The Gateway produces a bounded semantic
`OutcomeEnvelope` observation with:

- attempt reference;
- account, credential, proxy, persona, and client-generation references;
- status/error class;
- response-profile result;
- zero/partial/complete visible-output class;
- usage-presence and usage bucket;
- retry eligibility and idempotency class;
- broker/sidecar transport-fact reference and verification result;
- safe scheduler observation class, not a scheduler decision.

The Gateway may sign this observation for origin integrity, but under `protected_gateway` that
signature is not an independent authority statement. Sub2API consumes the verified transport fact
and Gateway semantic observation as separate inputs. Sub2API remains the owner of account
scheduling, budget mutation, cooldown, quarantine, and retry/failover decisions.

### 6.4 Retry ownership

Every failure class MUST have exactly one retry owner. The contract must distinguish:

- Claude Code client retries;
- CC Gateway transport reconnects;
- sidecar connection retries;
- Sub2API account or model failover;
- credential-refresh recovery.

No layer may retry after visible partial output or an externally visible tool side effect without
an explicit idempotency decision. An end-to-end attempt reference, retry budget, and absolute
deadline MUST cross all layers.

### 6.5 Task lineage and cross-version migration

The internal signed context MUST add safe references for:

- root session;
- parent task/agent;
- current task/agent;
- task class;
- fan-out generation and budget;
- client binary generation;
- profile generation;
- migration state.

Observed upstream headers such as `x-claude-code-session-id`, `agent-id`, and `parent-agent-id`
are session and cost-attribution fields. They MUST NOT be reused as user authentication or trusted
device proof.

A session may not silently change outbound persona. The required migration state machine is:

```text
pinned
  -> freezing
  -> draining
  -> candidate_validated
  -> migrated
  -> rollback_required
```

New work stops on the old generation before migration. In-flight work follows an explicit finish
or terminate rule. A failed migration returns to the last independently addressable profile and
does not reuse old connection or retry state.

### 6.6 Trusted-device separation

The architecture MUST distinguish:

1. an upstream-visible stable installation identifier;
2. a local client-instance signing key;
3. an operating-system, hardware, or trusted-launcher device proof.

The existing 64-hex `device_id` is an identifier, not proof. Device proof, if available, requires
its own issuer, audience, nonce, freshness, expiry, revocation, replay, key rotation, and privacy
contract. CC Gateway verifies such proof; it does not synthesize it.

Trusted-device proof remains explicitly `unavailable` until an independent issuer/verifier
lifecycle with the controls above exists and is verified. It must not be represented by a
generated request field or inferred from the installation identifier or client-instance key.

### 6.7 Destination and bypass authority

The system MUST maintain two separate inventories:

1. Gateway/sidecar outbound destination policy;
2. client-process attempted destination inventory from the launcher/host guard.

The first controls Gateway-owned egress. The second detects requests that never entered the
Gateway. Neither may substitute for the other.

Destination policy MUST support safe versioned destination references while keeping production
logs free of unrestricted raw domains. The reviewed policy source may contain the exact required
public destinations; runtime telemetry records only approved identifiers and mismatch buckets.

The sidecar must resolve once, classify, pin the selected address, and dial that exact address.
It must reject loopback, private, link-local, multicast, unspecified, cloud metadata, DNS
rebinding, redirects, nested proxies, and alternate dial-target directives unless an explicit
laboratory-only policy permits a local fixture.

### 6.8 Readiness and compatibility handshake

`/_health` MUST be split into:

- liveness: process can answer;
- readiness: process is safe to receive formal-pool traffic;
- protected capability details: authenticated and redacted.

Readiness must include digest references or generations for:

- Gateway build;
- shared compatibility contract;
- active manifest set;
- persona/request/response/transport profiles;
- sidecar and policy broker;
- replay/session ledger;
- runtime account mapping generation;
- loaded account count bucket;
- production/canary capability state.

Sub2API MUST stop scheduling formal-pool work when required digests or generations disagree.

## 7. Account and Credential Lifecycle Corrections

### 7.1 Runtime account authority protocol

Registration alone is insufficient. The cross-project protocol MUST provide signed operations for:

- register;
- replace/rotate;
- freeze;
- drain;
- revoke;
- delete;
- query;
- acknowledge/reconcile.

Each operation binds account generation, credential generation, proxy generation, policy/profile
generation, expiry, expected previous generation, and an idempotency key. Proxy swap, credential
rotation, account quarantine, and account deletion must update Sub2API and CC Gateway as one
recoverable state transition.

### 7.2 Source of truth

Sub2API is the durable account and credential authority. CC Gateway should hold only the minimum
runtime capability needed for current requests. Long-lived duplicate account authority and raw
secret material in a replay JSON file are not the target production design.

Protected deployment should prefer short-lived capabilities and a secret store or in-memory
lease. If sensitive runtime persistence remains temporarily necessary, it requires encryption,
key rotation, expiry, revocation, atomic replacement, startup reconciliation, and leak tests.

### 7.3 Refresh-token ownership

In formal-pool mode, Sub2API exclusively owns credential refresh and durable persistence. The
Gateway receives only request-scoped selected credential authority and must not run an independent
refresh loop.

The existing Sub2API refresh path already persists refreshed credentials under local and
distributed locking. Its required regression remains:

```text
refresh succeeds
  -> new refresh credential is atomically persisted
  -> process restarts
  -> new credential is read
  -> old credential cannot be reused
```

Standalone CC Gateway still has an in-memory-only refreshed token path. If standalone mode remains
supported, it needs an atomic secret-store writeback interface. This standalone defect must not
be confused with formal-pool credential ownership.

### 7.4 Test-secret prohibition

No production-capable path may fall back to a fixed local-test secret. Missing attestation,
runtime-binding, replay, sidecar, or signing material in production-like mode MUST fail startup or
readiness. Test secrets are injected explicitly by test fixtures only.

## 8. Production Deployment Invariants

The following requirements must be added to the production gate:

- default listen host is `127.0.0.1` or an explicitly selected loopback address;
- an omitted host must never bind all interfaces;
- a non-loopback bind requires an explicit remote-listen capability, transport encryption, strong
  authentication, and an approved network exposure policy;
- formal-pool control routes are not exposed through an unauthenticated public listener;
- production and real-canary modes reject missing inbound TLS when remote listen is enabled;
- upstream certificate verification cannot be disabled in production or real-canary modes;
- test certificate authorities and local MITM configuration cannot enter a production manifest;
- redirects do not broaden the approved upstream authority;
- proxy and direct-connect fallbacks remain zero;
- environment variables that disable certificate checks are rejected at startup;
- secret-bearing config values are not logged by health, error, or startup paths.

## 9. Canonical Safe Regression Fixtures

Safe hashes and field-name summaries are necessary but not sufficient for human review. Every
approved tuple MUST include typed, de-identified canonical fixtures for:

- request headers and body AST;
- response JSON and SSE AST;
- state-sequence trace;
- failure-semantics trace;
- control-plane route inventory;
- transport summary;
- negative capabilities.

Fixture values use typed placeholders such as `SESSION_REF`, `ACCOUNT_REF`, `MODEL_NAME`, and
`VARIABLE_REQUEST_ID`. They never contain raw prompts, credentials, account identifiers, proxy
credentials, CCH values, ClientHello bytes, or unrestricted diagnostics.

Each fixture is keyed by:

```text
version
platform
architecture
installation mode
entrypoint
auth mode
provider
scenario
profile authority
```

Regression reports must distinguish expected variable paths from unexplained changes. A digest
change without a reviewable semantic diff cannot promote a profile.

## 10. Current Implementation Gaps to Carry Forward

The following observations were confirmed during the 2026-07-12 read-only review. A phase plan
must reverify them against its fresh baseline before editing. `RA-CURRENT-*` entries are
observations, not requirements or implementation claims. Their confirmed/changed/resolved/stale
state is maintained in a separate revalidation ledger, not in Registry v2's requirement lattice.

### RA-CURRENT-001: Oracle tool is still a narrow 2.1.179 harness

- `tools/claude-native-oracle-matrix.ts` defaults to `2.1.179`.
- It models only `custom-base` and `first-party-assumed` invocation modes.
- It contains three request variants.
- Profile references remain hard-coded to 2.1.179.
- Response cache summary is hard-coded unavailable.

Required consequence: do not treat the present tool as Phase 3 completion. Build the evidence
factory against the machine-readable matrix in this amendment.

### RA-CURRENT-002: Persona values remain handwritten

- The persona registry currently ends at 2.1.197.
- `stainlessPackageVersion` is repeated as a handwritten value.
- Several promotion paths are explicitly hard-coded from 2.1.179/2.1.185 to 2.1.197.

Required consequence: replace version-specific mutation paths with generated immutable tuples and
an explicit migration table.

### RA-CURRENT-003: Response path is transparent

- Ordinary and sidecar responses are primarily streamed directly to the caller.
- No production response AST/SSE state-machine verifier currently owns retry eligibility.
- Diagnostic collection can accumulate response chunks before classification.

Required consequence: implement bounded incremental response validation and `OutcomeEnvelope`
before scheduler integration claims.

### RA-CURRENT-004: Runtime mapping lifecycle is incomplete

- Runtime account registration exists.
- Re-registration supports limited credential rotation, canonical promotion, and TLS backfill.
- Signed freeze, drain, revoke, delete, query, and reconcile operations remain absent.
- Proxy authority replacement outside those limited re-registration paths remains absent.
- Deleted, frozen, drained, revoked, or otherwise rotated accounts can therefore retain stale
  Gateway authority.

Required consequence: implement the lifecycle protocol in Section 7 before formal-pool production.

### RA-CURRENT-005: Protected sidecar and destination controls remain RED

- Complete single-request capability authentication is not implemented.
- Replay across restart/replicas is not fully enforced.
- production resolution pinning and unsafe-destination rejection are not complete.
- existing Phase 0 RED fixtures correctly document these failures.

Required consequence: never select `trusted_gateway` merely to make tests green. Either implement
the protected boundary or explicitly accept and document the narrower threat model.

### RA-CURRENT-006: Device identity is not device proof

- Sub2API derives a stable 64-hex device identifier.
- CC Gateway verifies its format and equality.
- no independent device-proof issuer/verifier lifecycle is implemented.

Required consequence: implement the three-layer separation in Section 6.6 or keep device proof
explicitly unavailable.

### RA-CURRENT-007: Readiness and replica consistency are incomplete

- health does not prove manifest, sidecar, ledger, runtime mapping, and contract readiness.
- session and nonce state use local file persistence.
- no shared atomic replay-consumption store is established for multi-replica production.

Required consequence: production remains single-writer or disabled until a shared consistency
design passes restart, partition, and split-brain tests.

### RA-CURRENT-008: Default listener is not fail-safe

- `server.host` is optional.
- the optional value is passed directly to `server.listen`.
- an omitted value can bind an unspecified/all-interface address.

Required consequence: enforce Section 8 before remote deployment.

### RA-CURRENT-009: Cross-repository contract drift is already observable

At review time, two Sub2API service-layer joint tests failed because their generated CC Gateway
configuration did not include the newly required `shared_pool.gateway_compromise_boundary`:

- `TestClaudePlatformAWSLocalFullChainE2EUsesCCGatewayAndSafeMockUpstream`
- `TestJointLocalCaptureAcceptanceArtifact`

Required consequence: introduce a shared contract schema, compatibility handshake, and paired
cross-repository CI. Local-capture fixtures should declare `protected_gateway`; they must not use
`trusted_gateway` only to bypass the new gate.

### RA-CURRENT-010: Security-critical Gateway logic is concentrated

`src/proxy.ts` currently combines control routes, runtime mapping, persistence, session authority,
request rewriting, final verification, AWS behavior, sidecar behavior, and response forwarding.

Required consequence: split only along security ownership boundaries needed by this work:

- runtime authority registry;
- session/task authority and replay ledger;
- request profile compiler/runtime verifier;
- response semantic verifier;
- provider-specific egress;
- control-plane handlers.

This is a reviewability and invariant-isolation requirement, not a style-only refactor.

## 11. Execution Work Packages

`WP-R0..R9` are traceability umbrellas, not ten cross-phase implementation plans. Each phase plan
consumes only the explicit WP slices assigned to that phase in the roadmap, with its own failing
test, review checkpoint, safe evidence output, and commit. No plan may cross a phase gate. A later
phase receives a fresh plan and baseline even when it consumes another slice of the same WP.

### WP-R0: Requirement and roadmap reconciliation

Produces:

- registered `RA-*` requirements with owners, dependencies, authority, and status;
- explicit `superseded` markers for the old fixed-three-run rule where convergence sampling wins;
- the Phase 3B/3.5 dependency and exit gate;
- corrected version/matrix coverage model;
- no implementation or production claim.

Gate: every requirement in this amendment maps to exactly one primary work package and one exit
gate.

### WP-R1: Cross-project contract and readiness handshake

Produces:

- one versioned schema consumed by TypeScript and Go;
- deterministic canonicalization and digest fixtures;
- liveness/readiness/capability separation;
- build/contract/manifest/profile/sidecar/ledger generation handshake;
- paired cross-repository CI and compatibility matrix;
- fixes for the current joint-test configuration drift.

Gate: incompatible repository revisions fail before account scheduling or DNS/socket creation.

### WP-R2: Account authority lifecycle and secret ownership

Produces:

- register/replace/freeze/drain/revoke/delete/query/reconcile protocol;
- account, credential, proxy, and profile generations;
- short-lived runtime capability model;
- removal of fixed test-secret fallback from production paths;
- restart reconciliation and stale-authority tests;
- formal-pool refresh ownership fixed in Sub2API.

Gate: proxy swap, credential rotation, account quarantine, and deletion leave no stale Gateway
authority under success, failure, retry, or restart.

### WP-R3: Protected sidecar and destination enforcement

Produces:

- isolated policy broker when the protected boundary is selected;
- single-request capability binding final request and transport authority;
- replay ledger with restart/replica semantics;
- resolve/classify/pin/dial destination enforcement;
- proxy, DNS-rebinding, redirect, metadata, and nested-proxy corpus;
- zero direct fallback proof.

Gate: all relevant Phase 0 RED fixtures are green and no unauthorized case reaches a dial.

### WP-R4: Evidence factory and expanded matrix

Produces:

- pinned version intake for the version roles in Section 5;
- hermetic foreground, background, nested-agent, remote, IDE, and auth lanes where available;
- nonessential-traffic enabled and disabled observations;
- response/failure and mixed-version lifecycle traces;
- safe canonical fixtures and drift events;
- convergence and coverage reports.

Gate: every selected cell has an exact result or explicit degraded reason, and degraded cells keep
their capabilities disabled.

### WP-R5: Profile compiler and 2.1.207 candidate tuple

Produces all Phase 3B/3.5 outputs, immutable profile artifacts, TypeScript/Go validators, generated
Gateway/Sub2API configuration, negative capabilities, rollback tuple, and deterministic
compiler/config/fixture local conformance.

Gate: the Phase 3B/3.5 minimum local-conformance exit gate passes, or Phase 3B/3.5 exits explicitly
blocked. Signed complete local staging remains a Phase 6A output.

### WP-R6: Request, task-lineage, and migration enforcement

Produces:

- generated client build identity handling;
- strict synthesized-profile validation;
- bounded observed-field quarantine path;
- root/parent/current task lineage;
- client/profile generation migration state machine;
- retry attempt/deadline/idempotency binding;
- final-byte and final-header validation.

Gate: no mixed, contradictory, stale, or unobserved tuple reaches transport.

### WP-R7: Response and trust-layered outcome authority

Produces:

- bounded JSON/SSE semantic validator;
- response byte transparency tests;
- partial-output and tool-side-effect classification;
- cancellation and timeout model;
- broker/sidecar transport fact plus bounded Gateway semantic `OutcomeEnvelope` observation;
- Sub2API scheduler-consumption adapter;
- retry-ownership matrix.

Gate: injected partial streams, malformed events, disconnects, 401/429/5xx errors, and duplicate
attempts produce deterministic user-visible and scheduler consequences without duplicate cost or
unsafe account switching.

### WP-R8: Deployment and multi-replica hardening

Produces:

- loopback-by-default listener;
- remote-listen capability gate;
- TLS and certificate-verification startup invariants;
- secret and environment leak tests;
- shared atomic replay/session state or an explicit single-writer production restriction;
- readiness propagation and kill-switch drills.

Gate: unsafe bind, insecure certificate configuration, stale replica, split brain, and unknown
ledger state all fail before formal-pool traffic is accepted.

### WP-R9: Staging and separately approved canary

Produces:

- complete local Sub2API -> CC Gateway -> policy broker/sidecar -> mock upstream staging;
- zero external socket proof;
- one fixed candidate tuple and rollback tuple;
- safe result timeline, stop rules, cleanup, and destruction evidence;
- separately approved, narrowly scoped canary only after all prior gates.

Gate: local staging is complete and current. Canary evidence can only become
`upstream_canary_observed`; it cannot automatically promote production.

## 12. Global Acceptance Criteria

The enhanced program is complete only when:

1. the 23 adopted parent coverage anchors and all 18 `RA-*` requirements are registered; later
   phase discovery may add IDs only through a reviewed amendment;
2. every requirement has an owner, reviewer, dependency, test, artifact, and exit gate;
3. profile generation is deterministic and contains no handwritten upstream-visible version tuple;
4. 2.1.197 and 2.1.207 remain independently addressable and rollback-safe;
5. at least one 2.1.207 candidate tuple passes the Phase 3B/3.5 minimum local-conformance gate;
6. unknown request and response drift is safe, bounded, explainable, and reviewable;
7. root and child task lineage is enforced without treating it as user/device authentication;
8. cross-version session migration is explicit and cannot reuse stale transport state;
9. response bytes remain transparent while response semantics and retry eligibility are verified;
10. account, credential, proxy, profile, and transport generations agree across all components;
11. rotation, revocation, deletion, restart, and replica failure cannot retain stale authority;
12. no request reaches DNS or socket creation without required current authority;
13. no external client bypass is hidden by Gateway-only evidence;
14. formal-pool credentials are refreshed and persisted only by Sub2API;
15. production listeners, TLS, certificate verification, secrets, and health endpoints satisfy
    Section 8;
16. all cross-repository tests and the complete local full-chain staging suite pass;
17. real upstream remains disabled until a separate approved canary gate;
18. no result claims knowledge of private provider-side enforcement.

## 13. Instructions for the Master Controller Agent

Before authoring or executing the next phase plan, the controller MUST:

1. read the four parent documents and this amendment;
2. verify current repository heads, worktrees, dirty state, tests, and Phase 0 receipts;
3. revalidate every `RA-CURRENT-*` observation as confirmed, changed, resolved, or stale in its
   separate ledger; never register it as a requirement or implementation claim;
4. copy the defined `RA-P0-*` and `RA-P1-*` requirements into the machine-readable registry and
   bind each to its source section, dependencies, owner, reviewer, tests, artifacts, and gate;
5. add the mandatory Phase 3B bridge to the roadmap and dependency graph, retaining `3.5` as its
   durable alias rather than an eighth top-level phase;
6. repair the current cross-repository configuration drift before using joint tests as evidence;
7. consume only the explicit WP slices owned by the current phase; no implementation plan may
   cross a phase gate;
8. use test-first changes with one reviewable invariant per task;
9. record expected RED tests separately from accidental regressions;
10. preserve user changes and avoid destructive workspace operations;
11. stop and emit a blocked handoff instead of inventing missing evidence;
12. never enable production or real canary merely because a local profile compiles.

The recommended next plan is `WP-R0: Requirement and Roadmap Reconciliation`, followed by
`WP-R1: Cross-Project Contract and Readiness Handshake`. Work on a 2.1.207 profile compiler should
start only after the shared contract can express its outputs and both repositories can reject an
incompatible tuple deterministically.

## 14. Official Public References

- Claude Code v2.1.207 release:
  `https://github.com/anthropics/claude-code/releases/tag/v2.1.207`
- Claude Code v2.1.197 release:
  `https://github.com/anthropics/claude-code/releases/tag/v2.1.197`
- Claude Code v2.1.81 release:
  `https://github.com/anthropics/claude-code/releases/tag/v2.1.81`
- Official changelog:
  `https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md`
- Official LLM gateway protocol:
  `https://code.claude.com/docs/en/llm-gateway-protocol`
- Official network configuration:
  `https://code.claude.com/docs/en/network-config`
- Official environment variables:
  `https://code.claude.com/docs/en/env-vars`
- Official npm registry metadata:
  `https://registry.npmjs.org/@anthropic-ai%2fclaude-code`
