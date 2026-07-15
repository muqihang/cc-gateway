# Claude Code 2.1.207 Hermetic Oracle Lab Design

## Status

- Design date: 2026-07-11
- CC Gateway base: `main@2800d39`
- Sub2API base: `main@d449fa7e3`
- npm release state at design time: `latest=2.1.207`, `next=2.1.207`, `stable=2.1.197`
- Real Anthropic requests: forbidden during this design's capture and integration phases
- Real account credentials: forbidden during this design's capture and integration phases
- Governing documents, highest precedence first:
  1. `docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md`
  2. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md`
  3. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-adversarial-validation-v2.md`
  4. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-design.md`
- Canonical in-place requirement registry: `docs/superpowers/registry/oracle-lab-requirements.json` is schema v2 and contains exactly 41 homogeneous records
- Preserved Registry v1 snapshot: `docs/superpowers/registry/oracle-lab-requirements-v1.json` remains the immutable 23-row migration source and evidence
- Reviewed governance adoption: Tasks 2 and 3 completed the in-place Registry v2 migration, explicit conflict registration, and adoption of the exact 18 RA records
- RA authority boundary: all 18 RA records remain `deferred`; governance adoption does not imply implementation, production verification, canary approval, or runtime authority
- Normative precedence: `review_amendments > hardening_amendments > adversarial_validation_v2 > oracle_lab_design`; no conflict, requirement, or authority statement may be silently replaced or superseded
- Requirement ID prefix: `OL-*`

## Objective

Build a repeatable, hermetic evidence lab that determines how the published Claude Code clients behave at the HTTP, request-shape, control-plane, CCH, TLS, proxy, model, and environment boundaries. Use that evidence to produce versioned, safe manifests consumed by CC Gateway and Sub2API.

The operational objective is to make shared-pool accounts as safe as engineering controls can make them: stable account-to-proxy binding, truthful and internally consistent client profiles, no unproved attestation, no direct fallback, model-aware scheduling, fail-closed handling of unknown protocol drift, and safe observability that never persists account or request secrets.

This design does not claim that account bans can be reduced to zero. Anthropic's server-side rules, entitlement state, capacity, and future release behavior are not fully observable. The measurable target is that every locally controllable signal is either backed by reproducible evidence or explicitly disabled.

The no-real-request phases can establish local observation, wire equivalence, integration
correctness, and stateful behavioral equivalence. They cannot establish server acceptance,
hidden attestation validity, provider-side correlation semantics, or production account
safety. Those claims require a separately approved upstream canary and remain explicitly
out of scope until that evidence exists.

## Reset of Trust

The existing `2.1.197` formal-pool tuple is no longer considered trusted merely because it previously passed tests or production requests. Both `2.1.197` and `2.1.207` start at `unverified` and must pass the same evidence pipeline.

Existing profile names, CCH behavior, TLS summaries, Sonnet 5 handling, 1M behavior, system reminders, cache placement, and tool shapes are evidence inputs, not authorities. No existing field is grandfathered into a new `production_verified` profile.

## Safety Boundary

The lab MUST:

- deny all network access except an exact allowlist of observer loopback ports and required
  local IPC endpoints while a Claude Code binary is running;
- use only placeholder credentials generated for the lab;
- route first-party-assumed traffic through a local CONNECT/MITM observer that never opens an external socket;
- keep raw request bodies, response bodies, ClientHello bytes, CCH values, and process diagnostics in memory only for immediate classification;
- persist only bucketed counts, booleans, ordered public protocol identifiers, cryptographic hashes, package provenance, and explicit omission markers;
- discard CLI stderr because it can echo prompts, paths, environment values, or diagnostics;
- use synthetic printable-ASCII prompts with no user content;
- refuse execution when the network sandbox, loopback proxy, pinned package integrity, or output redaction checks are unavailable;

The runner MUST also isolate Unix sockets, inherited file descriptors, system proxy helpers,
credential agents, crash reporters, core dumps, and ambient local services. Platform-specific
enforcement is recorded in the run manifest. A platform that cannot demonstrate the exact
allowlist remains static-only or emits an explicit degraded scope.

The default evidence path never persists raw protocol material. An exceptional encrypted
laboratory evidence capsule may be enabled only by an explicit per-run approval, on an
ephemeral encrypted filesystem, with a declared sensitivity class, short TTL, access audit,
and verified destruction. Production systems never create such capsules.

## Threat Model

The design treats these as independent risk surfaces:

1. **Credential and identity consistency**
   - OAuth versus setup-token scope and refresh lifecycle.
   - Account, organization, device, session, and credential binding stability.
   - Reauthorization invalidating earlier refresh credentials.

2. **Network and proxy consistency**
   - Account fixed to one intended proxy identity and egress bucket.
   - No DNS leak, direct socket, Node fallback, Go fallback, or proxy bypass.
   - CONNECT versus intercepting-proxy behavior recorded as a safe category.
   - DNS caches, connection pools, TLS ticket caches, HTTP/2 state, retry state, and proxy
     generations never cross an account transport boundary.

3. **TLS consistency**
   - ClientHello version, cipher order, extension order, curves, signature schemes, ALPN, GREASE, SNI, key shares, and resumption behavior.
   - HTTP/2 SETTINGS, pseudo-header order, flow control, connection reuse, GOAWAY behavior,
     HPACK state boundaries, and any observed HTTP/3/QUIC negotiation or fallback.
   - Stable profile pinning by real observed client/platform version, never per-request randomization.
   - No raw ClientHello or arbitrary user-supplied TLS material in production configuration.

4. **HTTP and body consistency**
   - Header family, package versions, beta tokens, user agent, content encoding, and request-id behavior.
   - Model aliases, stream mode, system placement, tools, cache controls, thinking, output config, context management, metadata, and 1M markers.
   - Exact differences between CLI, SDK/print, IDE, custom-base, and first-party-assumed modes.
   - Response JSON and SSE semantics, usage and stop reasons, tool/thinking blocks, partial
     streams, terminal errors, and the state mutation caused by every outcome.

5. **Control-plane and environment residue**
   - MCP discovery and authorization boundaries.
   - Base URL, proxy, timezone, locale, date marker, domain taxonomy, and plugin/managed-setting residue.
   - Control-plane data must never become a user-controlled target, proxy, dial override, credential, or authorization source.

6. **Release drift**
   - New Claude Code versions can change model defaults, system-role placement, authentication behavior, MCP, retries, TLS handling, or gateway behavior.
   - Unknown versions remain observable but unpromoted until their evidence manifest passes.

7. **Cross-layer coherence**
   - A production-visible profile must correspond to a combination actually observed from
     one package, platform, entrypoint, authentication mode, and transport family.
   - Header, body, CCH, TLS, HTTP protocol, retry, model-capability, and environment fields
     cannot be assembled independently into a combination the official client never emitted.
   - Unsupported or contradictory combinations fail closed rather than inheriting defaults.

## Evidence Authority Model

Every signal in a manifest carries one authority state and one observation scope:

- `unverified`: copied from existing code, documentation, or historical summaries only;
- `package_observed`: extracted from a pinned, integrity-verified public package or binary;
- `local_wire_observed`: externally observed from the pinned binary in the hermetic lab;
- `cross_checked`: independently confirmed by a second implementation and repeated run;
- `gateway_wire_equivalent`: CC Gateway reproduces the approved final wire representation;
- `stateful_behavior_equivalent`: request, response, retry, connection, and state-transition
  traces match for the approved scenario set;
- `upstream_canary_observed`: observed during a later explicitly approved real-account canary;
- `production_verified`: canary evidence, rollback drills, and production gates all passed.

Each signal also records `observation_scope`, `server_dependency`, `stability_class`,
`confidence`, and any negative or contradictory evidence. No-real-request work may produce a
candidate manifest, but it must not label server-dependent CCH, entitlement, billing,
provider-correlation, or account-safety claims as verified.

Production promotion requires `cross_checked` for local observation, at least
`gateway_wire_equivalent` for request and transport fields, and
`stateful_behavior_equivalent` for retry and lifecycle behavior. Existing
`integration_verified` fields are treated only as legacy local-control evidence during
migration; they cannot supersede the authority states above and are removed after all consumers
adopt the new contract.

## Normative Compatibility Contract

The oracle produces a versioned, schema-validated compatibility contract before any profile
implementation begins. Unknown fields have no implicit defaults. The contract defines exact
required and optional fields, enum values, canonical serialization, version negotiation,
forward/backward compatibility, authority-state ordering, downgrade behavior, and failure
handling for every producer and consumer.

Compatibility has four independent gates:

1. **Wire equivalence**: final method, authority, path, query, headers, content encoding,
   body bytes, TLS summary, and negotiated HTTP behavior match the approved observation.
2. **Semantic equivalence**: canonical request and response ASTs have the same meaning,
   including defaults, ordering-sensitive structures, tool schemas, cache controls, usage,
   stop reasons, and error classes.
3. **State-sequence equivalence**: session creation, count-tokens, streaming, tool use,
   retry, reconnect, credential refresh, and resume traces cause the same bounded state changes.
4. **Failure-semantics equivalence**: timeouts, resets, partial streams, 4xx/5xx responses,
   capacity, entitlement, and proxy failures produce the approved retry, budget, quarantine,
   account-selection, and terminal-error consequences.

A profile is compatible only for the capability classes that pass all applicable gates.
Unobserved capabilities remain disabled.

Every executable request uses a `BehaviorCoherenceCertificate` that binds the package/version
evidence, platform, entrypoint, auth mode, persona, request AST profile, response profile, CCH
policy, TLS/HTTP profile, proxy generation, credential generation, retry policy, environment
profile, and model-capability set. The Gateway rejects a certificate containing an unobserved
or internally contradictory combination.

Every manifest also contains a negative-capability section. It explicitly lists unsupported
models, beta tokens, transport modes, entrypoints, fallbacks, feature combinations, and
authority states. Absence never means permission.

## Architecture

### 1. Package Intake and Provenance

The lab resolves an explicit version, never a floating tag during a run. It records:

- root package name and version;
- npm integrity, shasum, registry signature metadata, publish timestamp, and dist-tag snapshot;
- optional platform package names and versions;
- package file inventory, file sizes, executable hashes, and platform/architecture;
- changelog entries from `2.1.197` through the target version;
- a safe diff against the previous candidate with sufficient recorded authority.

The first target matrix is:

- `2.1.197`: historical baseline, fully re-audited;
- `2.1.201`: Sonnet 5 system-role transition checkpoint;
- `2.1.203`: base URL and background-session transition checkpoint;
- `2.1.206`: expired-login and public-gateway transition checkpoint;
- `2.1.207`: current latest target.

All published platform packages are unpacked for static comparison. Runtime execution is mandatory for local macOS arm64. Linux x64/arm64 and macOS x64 packages receive static comparison; runtime execution is added only when a local container/emulator can preserve the no-external-network boundary. Windows packages receive static comparison unless an equivalent hermetic runtime is available.

The public VS Code extension and any locally installed official extension are inventoried separately by extension identifier, version, package hash, manifest capabilities, bundled Claude binary/runtime reference, entrypoint metadata, and network-related configuration. The lab never reads user workspace history, extension secrets, or logged-in account state.

Provenance follows the complete executed chain, not only the npm tarball. The manifest records
the launcher, downloaded or embedded platform binary, interpreter/runtime, dynamically loaded
libraries, CA source, OS image/build, installer or updater path, and the digest relationship
between every stage that can change executed behavior.

### 2. Static Binary and Embedded-Asset Analysis

Static analysis extracts safe structural evidence without modifying the binary:

- printable strings grouped by endpoint/header/env/model/tool/config categories;
- embedded JavaScript or resource sections identified by format and content hashes;
- base64-plus-XOR taxonomy candidates decoded only into an in-memory classifier, with persisted count/hash/sentinel summaries;
- imported libraries, build metadata, certificate handling references, proxy environment references, model aliases, beta tokens, and known route strings;
- cross-version binary section hashes and category-level diffs;
- package wrapper and installer changes.

The existing versioned public environment-residue taxonomy asset may be refreshed from a verified package extractor. Runtime logs and generated manifests retain only source version, count, category, sentinel, and hash summaries; they do not print matched raw domains.

Raw credentials, hidden keys, raw embedded source, or decompiled proprietary implementation are not persisted in generated evidence. The purpose is compatibility and defensive validation, not circumvention.

### 3. Hermetic Runtime HTTP Observer

The runtime observer launches the pinned binary with:

- a temporary HOME and `CLAUDE_CONFIG_DIR`;
- a minimal allowlisted environment;
- placeholder API/auth values;
- all proxy variables pointed at the local observer;
- nonessential traffic disabled;
- a network sandbox that allows only the observer's loopback ports;
- a fresh session and working directory per matrix cell;
- bounded runtime, output size, process count, and retry count.

The local observer implements JSON and SSE responses sufficient to complete request construction. It records raw bytes only in memory, classifies them, then discards them.

The runtime matrix includes:

- invocation: `--bare`, normal print/SDK, first-party-assumed, custom-base, and `--ide` where locally available;
- response mode: non-stream JSON and streaming SSE;
- model: Haiku 4.5, Sonnet 4.6, Sonnet 5 alias/full name, Fable 5 alias/full name, and Opus 4.8;
- shape: no tools, representative built-in tools, MCP-configured, thinking, adaptive thinking, output config, context management, prompt caching, and 1M context intent;
- route: messages, count_tokens, safe settings/model discovery intent, and locally suppressed telemetry intent;
- environment: Pacific, neutral UTC, China timezone marker, official base, neutral gateway base, and taxonomy residue fixtures;
- entrypoint: CLI, SDK/print, IDE marker, and background/agent mode only when the local stub can terminate it deterministically.
- observer outcome: success JSON, success SSE, upstream 401, upstream 403, model unavailable, capacity/rate 429, retryable 5xx, connection reset, partial-stream error, and timeout.

For non-success outcomes, the manifest records retry count, bounded delay buckets, repeated credential use, model fallback attempt categories, route changes, and terminal error class. It never records the error body. This distinguishes client retry/fallback behavior from server-side account isolation policy.

The VS Code runtime lane uses an isolated VS Code profile and extension directory only if the extension can be configured to the loopback observer without reading an existing login. Otherwise it emits `runtime_unavailable_without_real_login` and remains static-only until the later user-approved canary phase.

Every unsupported matrix cell is emitted as an explicit degraded reason. Missing evidence never becomes a guessed default.

The matrix is not an unbounded Cartesian product. It is divided into:

- a mandatory core covering every release checkpoint and every production capability class;
- risk-selected mandatory interactions such as tools plus streaming plus retry, or proxy
  rotation plus pooled connections;
- deterministic pairwise or higher-strength combinatorial coverage for remaining dimensions;
- seeded property-based and mutation campaigns for malformed and adversarial behavior.

Every run emits the coverage model, selected combinations, seed, omitted combinations,
justification, and maximum time/resource budget. A degraded reason does not count as covered
unless the associated capability remains disabled.

### 4. Hermetic TLS and Proxy Observer

TLS evidence is captured in two complementary modes:

1. **ClientHello-only mode**
   - The binary is configured for the first-party hostname through a local CONNECT proxy.
   - The proxy accepts CONNECT, captures the tunneled ClientHello, and never dials the target.
   - This preserves the intended SNI and proxy behavior while preventing external access.

2. **Local MITM completion mode**
   - A per-run local CA and first-party-host certificate are generated in temporary storage.
   - The binary trusts only that test CA for the run.
   - The local proxy terminates TLS and serves the HTTP observer.
   - The sandbox still denies every socket and IPC endpoint outside the exact observer allowlist.

The persisted TLS summary includes:

- TLS version vector;
- ordered cipher and extension identifiers;
- supported groups, key shares, signature schemes, ALPN, GREASE, SNI category, and session-ticket/resumption categories;
- negotiated HTTP protocol category, connection reuse, mTLS client-certificate request/response category, and proxy CONNECT behavior;
- for HTTP/2, ordered SETTINGS identifiers and values, pseudo-header order, initial flow
  control, stream concurrency, keepalive, GOAWAY/reset response, and HPACK state category;
- any observed HTTP/3/QUIC offer, negotiation, fallback, or explicit absence;
- JA3 and JA4 hashes plus an independent canonical hash over the parsed summary;
- CONNECT target category and proxy mode;
- repeated-run stability result;
- raw ClientHello omission reason.

Each profile is captured at least three times. A field that varies naturally is classified as variable and excluded from an exact production equality check. A field that should be stable but drifts blocks promotion.

The sidecar must implement a small set of real observed profiles. It must not create a unique random fingerprint per account. Accounts are pinned to a stable profile chosen from `cross_checked` client/platform/version combinations, while proxy, credential, device, and session bindings provide account-level isolation.

#### Account Transport Cell

Formal-pool traffic is isolated by an account transport cell keyed by at least:

```text
account_ref
credential_generation
proxy_generation
persona_version
transport_profile_ref
```

DNS caches, resolved addresses, TCP pools, TLS sessions and tickets, HTTP/2 connections,
HPACK dynamic tables, proxy authentication state, cookies, retry state, and connection-local
metadata belong to exactly one cell. HTTP/2 connection coalescing and socket reuse across
cells are forbidden. Credential, proxy, policy, or persona rotation freezes the old cell
before new requests are admitted, invalidates its authority, and deterministically drains or
terminates its connections. Tests prove that no stale cell can carry later traffic.

### 5. CCH and Billing Attribution Decision

CCH is treated as an evidence question, not an assumed requirement.

The lab compares:

- custom-base versus first-party-assumed behavior;
- normal CLI versus bare/SDK/IDE behavior;
- `2.1.197`, transition checkpoints, and `2.1.207`;
- different synthetic prompts and repeated identical prompts;
- body before and after JSON parse/reserialize;
- model, tools, system placement, and stream-mode changes.

The safe result is one of:

- `absent`;
- `billing_header_without_cch`;
- `cch_present_verifier_confirmed`;
- `cch_present_unverified`;
- `cch_context_dependent`;
- `capture_inconclusive`.

Promotion rules:

- Never invent a CCH because an older profile used one.
- Never forward a downstream CCH after the body has been rewritten unless the final-byte verifier proves it is still valid.
- Never recreate CCH if it depends on hidden or server-issued attestation material.
- If the official custom-base client is locally observed without CCH, prefer the
  evidence-backed no-CCH/strip candidate policy.
- If first-party behavior requires proof the gateway cannot truthfully reproduce, fail closed instead of impersonating it.
- Existing signed-CCH code remains `unverified` until the new oracle confirms its algorithm and trust semantics.
- Local verifier agreement does not prove server acceptance. Server-dependent CCH authority
  cannot exceed `stateful_behavior_equivalent` before an approved upstream canary.

### 6. Safe Manifest and Diff

The lab emits `claude_code_oracle_manifest.v2` containing:

- source version and package provenance;
- platform and invocation buckets;
- request route, header-name, beta-token, body-key, model, tool, cache, thinking, context, MCP, environment, and CCH summaries;
- TLS and proxy summaries;
- authority state per signal;
- observation scope, server dependency, confidence, stability class, and contradictory evidence;
- request and response AST schema refs plus state-sequence and failure-semantics refs;
- behavior coherence certificate schema and allowed tuples;
- negative-capability declarations;
- transport-cell isolation and rotation policy refs;
- repeated-run stability and degraded-scope lists;
- raw-material omission flags;
- comparison to the prior version and to the current CC Gateway profile;
- a promotion recommendation: `reject`, `observe`, `candidate`, `canary_candidate`, or
  `production_verified`. No-real-request runs cannot emit the final state.

The manifest MUST reject any field name or value matching token, credential, raw URL, raw domain, email, account identifier, UUID, proxy credential, request body, prompt, response, or raw ClientHello patterns.

Safe manifests used as test fixtures are committed. Temporary packages, binaries, certificates, raw captures, and diagnostics remain outside the repository and are never committed.

### 7. CC Gateway Integration

CC Gateway owns the oracle and the executable transport profile because it owns final request construction and the uTLS sidecar.

Integration occurs only after evidence generation:

- add exact versioned persona entries rather than mutating `2.1.197` in place;
- add a candidate `2.1.207` request/body/beta/cache profile only for observed fields;
- generate a sidecar TLS profile from a candidate manifest with sufficient local authority and
  independently test its parsed summary;
- retain strict sidecar requirement, proxy binding, target allowlist, mock bridge disablement, dial-override disablement, and zero Node direct fallback;
- classify observed newer clients separately from the effective upstream profile;
- ensure final verification operates on final serialized bytes and final headers;
- require a valid behavior coherence certificate before request construction;
- create and select the account transport cell before any DNS lookup or socket creation;
- verify request, response, state-sequence, and failure-semantics profile refs;
- reject every capability listed as negative or absent from the approved tuple;
- record only safe manifest refs, buckets, and omission markers.

The current alias containing `sonnet5` is not an authority. Internal profile names become neutral versioned names. Upstream-visible headers and body fields come only from observed evidence.

### 8. Sub2API Integration

Sub2API consumes a narrow shared contract rather than reimplementing oracle logic.

The contract exposes:

- policy versions and authority states;
- allowed observed-client version ranges;
- persona, request-shape, cache, TLS, CCH, MCP, and environment profile refs;
- supported model/capability buckets;
- explicit negative capabilities and allowed coherence tuples;
- transport-cell keying, rotation, drain, and stale-context consequences;
- request/response AST, state-sequence, and failure-semantics schema refs;
- healthcheck and model-probe policy classes;
- account/auth/proxy binding requirements;
- safe error and scheduling consequences.

Sub2API must:

- preserve current formal-pool account/proxy authority and credential binding;
- never select an unverified profile merely because the client version is numerically newer;
- distinguish base identity/transport failures from model capability or capacity failures;
- avoid account quarantine for model-only entitlement/capacity outcomes once the later model-probe design is implemented;
- keep account credential lifecycle errors separate from CC Gateway control-plane errors;
- reject missing sidecar proof, fallback detection, proxy mismatch, or final-profile mismatch;
- reject a behavior tuple not explicitly allowed by the compatibility contract;
- never schedule a request onto a transport cell owned by another account, credential
  generation, proxy generation, persona, or transport profile;
- emit only safe buckets and contract refs.

### 9. Shared Contract Discovery

The existing CC Gateway tests hard-code a retired Sub2API worktree path. Phase 0 replaces this with:

1. explicit `SUB2API_FORMAL_POOL_CONTRACT_PATH` when supplied;
2. a deterministic sibling-repository discovery of the current Sub2API `main` checkout;
3. fail-closed error when neither exists.

Tests must never silently use a stale feature worktree. The resolved contract file hash and source category are recorded, not the absolute path.

## Validation Gates

### Gate 0: Clean Baselines

- CC Gateway full tests pass with the current Sub2API `main` contract.
- CC Gateway build passes.
- Sidecar Go tests pass.
- Targeted Sub2API formal-pool/CC Gateway/Claude tests pass on `main@d449fa7e3`.
- No existing untracked files are modified, added, or deleted.

### Gate 1: Hermeticity

- Network audit records zero connection attempts outside the exact observer/IPC allowlist.
- Observer refuses to run without sandbox enforcement.
- Placeholder credentials are the only credential-shaped values available to the process.
- No raw artifact remains after process exit.
- Core dumps, crash reporters, inherited sockets, ambient credential agents, and unauthorized
  loopback or Unix-socket access are unavailable.

### Gate 2: Provenance and Repeatability

- npm integrity and signature metadata are recorded.
- Binary hashes match pinned packages.
- Three repeated runs produce the same stable summary fields.
- Independent parsers agree on TLS and request-shape canonical hashes.

### Gate 3: Coverage

- The mandatory core and risk-selected interaction matrix have evidence; combinatorial
  coverage, seeds, omissions, and resource limits are recorded.
- A degraded capability is disabled and cannot be promoted as covered.
- CCH has an explicit policy decision for custom-base and first-party-assumed modes.
- Sonnet 5, Fable 5, Opus 4.8, Haiku 4.5, 1M, tools, thinking, MCP, and IDE lanes are represented.
- `2.1.197` and `2.1.207` receive equal scrutiny.

### Gate 4: Cross-Project Integration

- CC Gateway exact-profile, final-byte verifier, response-semantic, sequence, failure,
  transport-cell, proxy, sidecar, CCH, MCP, environment, and safe-summary tests pass.
- Sub2API tuple selection, observed-version handling, auth/proxy binding, healthcheck classification, scheduler gating, and safe-log tests pass.
- No direct fallback path becomes reachable.
- No DNS, TCP, TLS, HTTP/2, HPACK, retry, or proxy state crosses a transport-cell boundary.
- Every executable request has a valid behavior coherence certificate and allowed capability.
- Secret/raw-material scans pass.

### Gate 5: Pre-Production Review

- Design assumptions are reconciled against generated evidence.
- Every production-visible field maps to a manifest signal with sufficient authority.
- All four compatibility gates pass for each enabled capability class.
- Unknown or contradictory fields have a kill switch and fail-closed behavior.
- Deployment is blocked until the user explicitly approves a single-account canary.

## Phased Delivery

### Phase 0: Restore Trustworthy Baselines

- Repair cross-repository contract discovery.
- Run CC Gateway, sidecar, and targeted Sub2API baselines.
- Freeze the current `2.1.197` tuple as `unverified_legacy` for comparison only.

### Phase 1: Build the Oracle Core

- Add provenance, safe manifest, redaction, hermetic process runner, observer, and diff modules.
- Define the normative compatibility schema, canonical serialization, authority-state lattice,
  behavior coherence certificate, negative capabilities, and transport-cell contract before
  version-specific profile code.
- Make current CCH and native matrix tools use the shared core.
- Fix bare-mode credential setup using placeholder `ANTHROPIC_API_KEY` without exposing it.

### Phase 2: Add Static and Runtime Matrices

- Unpack and classify all target packages.
- Run the mandatory core, risk-selected interaction, combinatorial, and mutation matrices for
  checkpoint versions.
- Produce safe manifests and diffs.

### Phase 3: Add TLS and Proxy Evidence

- Implement ClientHello-only and local MITM observers.
- Cross-check parsed summaries.
- Capture HTTP/2 and any HTTP/3 negotiation, connection-state, and failure behavior.
- Compare official observations with current uTLS sidecar profiles.

### Phase 4: Decide CCH and Profile Semantics

- Resolve CCH requirements from observed evidence.
- Determine which current profile fields remain valid.
- Produce candidate neutral `2.1.207` persona/request/TLS refs.

### Phase 5: Integrate CC Gateway and Sub2API

- Add evidence-backed profiles and contract fields.
- Enforce behavior coherence certificates, negative capabilities, and per-account transport
  cells before any request construction or socket creation.
- Preserve strict proxy/sidecar/security boundaries.
- Add migration, compatibility aliases, safe summaries, and kill switches.

### Phase 6: Staging Without Accounts

- Deploy only to local/staging loopback fixtures.
- Re-run the selected coverage matrix and bounded stateful sequences through
  Sub2API -> CC Gateway -> sidecar -> local mock upstream.
- Confirm zero external sockets and zero raw artifacts.
- Run transport-cell isolation, rotation, drain, retry, HTTP/2, response-semantic, and
  failure-semantic campaigns.

### Phase 7: Later User-Approved Canary

- After the user logs in a single account, run a separately approved bounded sequence for one
  capability class at a time. A sequence may include initial request, stream completion,
  session continuation, reconnect, and one controlled failure/recovery step when approved.
- Compare production safe summaries to the oracle manifest.
- Treat a single canary as upstream observation, not statistical proof of long-term account
  safety or provider-side correlation behavior.
- Do not batch canary, infer fleet safety, or promote additional accounts automatically.

## Rollback and Kill Switches

- Keep `2.1.197` and `2.1.207` profiles independently addressable.
- Provide a global candidate-profile disable switch.
- Provide model-level disable switches for Sonnet 5, Fable 5, Opus 4.8, and 1M.
- Preserve strict sidecar and no-direct-fallback enforcement during rollback.
- Rollback changes routing to the last `production_verified` profile; it never re-enables an
  unverified legacy profile silently.

## Non-Goals

- Guaranteeing that Anthropic will never restrict or disable an account.
- Creating per-account random TLS fingerprints.
- Sending real requests or using real credentials during oracle development.
- Persisting raw prompts, bodies, responses, CCH values, ClientHello bytes, account identifiers, proxy credentials, or raw domain matches in logs/manifests.
- Automatically deploying to production as part of evidence generation.

## Design Acceptance Criteria

This design is complete when:

- the user accepts the safety boundary, evidence model, architecture, and phased delivery;
- the baseline hard-coded worktree dependency is explicitly included as Phase 0;
- `2.1.197` is treated as unverified rather than trusted;
- authority terminology distinguishes local observation, wire equivalence, stateful
  equivalence, upstream canary observation, and production verification;
- the normative compatibility contract defines all four compatibility gates, canonical
  serialization, behavior coherence certificates, negative capabilities, and transport cells;
- the coverage strategy is executable without requiring an unbounded Cartesian product;
- the implementation plan names exact files, tests, RED/GREEN commands, and commit checkpoints;
- implementation occurs in isolated CC Gateway and Sub2API worktrees based on their current local `main` branches.
