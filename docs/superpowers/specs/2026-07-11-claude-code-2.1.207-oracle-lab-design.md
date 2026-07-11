# Claude Code 2.1.207 Hermetic Oracle Lab Design

## Status

- Design date: 2026-07-11
- CC Gateway base: `main@2800d39`
- Sub2API base: `main@d449fa7e3`
- npm release state at design time: `latest=2.1.207`, `next=2.1.207`, `stable=2.1.197`
- Real Anthropic requests: forbidden during this design's capture and integration phases
- Real account credentials: forbidden during this design's capture and integration phases

## Objective

Build a repeatable, hermetic evidence lab that determines how the published Claude Code clients behave at the HTTP, request-shape, control-plane, CCH, TLS, proxy, model, and environment boundaries. Use that evidence to produce versioned, safe manifests consumed by CC Gateway and Sub2API.

The operational objective is to make shared-pool accounts as safe as engineering controls can make them: stable account-to-proxy binding, truthful and internally consistent client profiles, no unproved attestation, no direct fallback, model-aware scheduling, fail-closed handling of unknown protocol drift, and safe observability that never persists account or request secrets.

This design does not claim that account bans can be reduced to zero. Anthropic's server-side rules, entitlement state, capacity, and future release behavior are not fully observable. The measurable target is that every locally controllable signal is either backed by reproducible evidence or explicitly disabled.

## Reset of Trust

The existing `2.1.197` formal-pool tuple is no longer considered trusted merely because it previously passed tests or production requests. Both `2.1.197` and `2.1.207` start at `unverified` and must pass the same evidence pipeline.

Existing profile names, CCH behavior, TLS summaries, Sonnet 5 handling, 1M behavior, system reminders, cache placement, and tool shapes are evidence inputs, not authorities. No existing field is grandfathered into a new verified profile.

## Safety Boundary

The lab MUST:

- deny all non-loopback network access while a Claude Code binary is running;
- use only placeholder credentials generated for the lab;
- route first-party-assumed traffic through a local CONNECT/MITM observer that never opens an external socket;
- keep raw request bodies, response bodies, ClientHello bytes, CCH values, and process diagnostics in memory only for immediate classification;
- persist only bucketed counts, booleans, ordered public protocol identifiers, cryptographic hashes, package provenance, and explicit omission markers;
- discard CLI stderr because it can echo prompts, paths, environment values, or diagnostics;
- use synthetic printable-ASCII prompts with no user content;
- refuse execution when the network sandbox, loopback proxy, pinned package integrity, or output redaction checks are unavailable;
- avoid patching the Claude Code binary, bypassing authentication, defeating code signing, forging server-issued evidence, or emulating hidden attestation secrets.

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

3. **TLS consistency**
   - ClientHello version, cipher order, extension order, curves, signature schemes, ALPN, GREASE, SNI, key shares, and resumption behavior.
   - Stable profile pinning by real observed client/platform version, never per-request randomization.
   - No raw ClientHello or arbitrary user-supplied TLS material in production configuration.

4. **HTTP and body consistency**
   - Header family, package versions, beta tokens, user agent, content encoding, and request-id behavior.
   - Model aliases, stream mode, system placement, tools, cache controls, thinking, output config, context management, metadata, and 1M markers.
   - Exact differences between CLI, SDK/print, IDE, custom-base, and first-party-assumed modes.

5. **Control-plane and environment residue**
   - MCP discovery and authorization boundaries.
   - Base URL, proxy, timezone, locale, date marker, domain taxonomy, and plugin/managed-setting residue.
   - Control-plane data must never become a user-controlled target, proxy, dial override, credential, or authorization source.

6. **Release drift**
   - New Claude Code versions can change model defaults, system-role placement, authentication behavior, MCP, retries, TLS handling, or gateway behavior.
   - Unknown versions remain observable but unpromoted until their evidence manifest passes.

## Evidence Authority Model

Every signal in a manifest carries one authority state:

- `unverified`: copied from existing code, documentation, or historical summaries only;
- `package_observed`: extracted from a pinned, integrity-verified public package or binary;
- `runtime_observed`: observed from the pinned binary in the hermetic loopback lab;
- `cross_checked`: independently confirmed by a second parser, repeated run, or second platform package;
- `integration_verified`: CC Gateway and Sub2API reproduce the approved behavior in local end-to-end tests;
- `canary_verified`: reserved for the later user-approved single real request after account login.

Production promotion requires at least `cross_checked` for TLS/CCH/request-shape fields and `integration_verified` for routing, redaction, proxy binding, and final verification. `canary_verified` is not part of the current no-real-request phase.

## Architecture

### 1. Package Intake and Provenance

The lab resolves an explicit version, never a floating tag during a run. It records:

- root package name and version;
- npm integrity, shasum, registry signature metadata, publish timestamp, and dist-tag snapshot;
- optional platform package names and versions;
- package file inventory, file sizes, executable hashes, and platform/architecture;
- changelog entries from `2.1.197` through the target version;
- a safe diff against the previous verified candidate.

The first target matrix is:

- `2.1.197`: historical baseline, fully re-audited;
- `2.1.201`: Sonnet 5 system-role transition checkpoint;
- `2.1.203`: base URL and background-session transition checkpoint;
- `2.1.206`: expired-login and public-gateway transition checkpoint;
- `2.1.207`: current latest target.

All published platform packages are unpacked for static comparison. Runtime execution is mandatory for local macOS arm64. Linux x64/arm64 and macOS x64 packages receive static comparison; runtime execution is added only when a local container/emulator can preserve the no-external-network boundary. Windows packages receive static comparison unless an equivalent hermetic runtime is available.

The public VS Code extension and any locally installed official extension are inventoried separately by extension identifier, version, package hash, manifest capabilities, bundled Claude binary/runtime reference, entrypoint metadata, and network-related configuration. The lab never reads user workspace history, extension secrets, or logged-in account state.

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
   - The sandbox still denies all non-loopback sockets.

The persisted TLS summary includes:

- TLS version vector;
- ordered cipher and extension identifiers;
- supported groups, key shares, signature schemes, ALPN, GREASE, SNI category, and session-ticket/resumption categories;
- negotiated HTTP protocol category, connection reuse, mTLS client-certificate request/response category, and proxy CONNECT behavior;
- JA3 and JA4 hashes plus an independent canonical hash over the parsed summary;
- CONNECT target category and proxy mode;
- repeated-run stability result;
- raw ClientHello omission reason.

Each profile is captured at least three times. A field that varies naturally is classified as variable and excluded from an exact production equality check. A field that should be stable but drifts blocks promotion.

The sidecar must implement a small set of real observed profiles. It must not create a unique random fingerprint per account. Accounts are pinned to a stable profile chosen from verified client/platform/version combinations, while proxy, credential, device, and session bindings provide account-level isolation.

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
- If the official custom-base client works without CCH, prefer the verified no-CCH/strip policy.
- If first-party behavior requires proof the gateway cannot truthfully reproduce, fail closed instead of impersonating it.
- Existing signed-CCH code remains `unverified` until the new oracle confirms its algorithm and trust semantics.

### 6. Safe Manifest and Diff

The lab emits `claude_code_oracle_manifest.v2` containing:

- source version and package provenance;
- platform and invocation buckets;
- request route, header-name, beta-token, body-key, model, tool, cache, thinking, context, MCP, environment, and CCH summaries;
- TLS and proxy summaries;
- authority state per signal;
- repeated-run stability and degraded-scope lists;
- raw-material omission flags;
- comparison to the prior version and to the current CC Gateway profile;
- a promotion recommendation: `reject`, `observe`, `candidate`, or `verified`.

The manifest MUST reject any field name or value matching token, credential, raw URL, raw domain, email, account identifier, UUID, proxy credential, request body, prompt, response, or raw ClientHello patterns.

Safe manifests used as test fixtures are committed. Temporary packages, binaries, certificates, raw captures, and diagnostics remain outside the repository and are never committed.

### 7. CC Gateway Integration

CC Gateway owns the oracle and the executable transport profile because it owns final request construction and the uTLS sidecar.

Integration occurs only after evidence generation:

- add exact versioned persona entries rather than mutating `2.1.197` in place;
- add a candidate `2.1.207` request/body/beta/cache profile only for observed fields;
- generate a sidecar TLS profile from the verified manifest and independently test its parsed summary;
- retain strict sidecar requirement, proxy binding, target allowlist, mock bridge disablement, dial-override disablement, and zero Node direct fallback;
- classify observed newer clients separately from the effective upstream profile;
- ensure final verification operates on final serialized bytes and final headers;
- record only safe manifest refs, buckets, and omission markers.

The current alias containing `sonnet5` is not an authority. Internal profile names become neutral versioned names. Upstream-visible headers and body fields come only from observed evidence.

### 8. Sub2API Integration

Sub2API consumes a narrow shared contract rather than reimplementing oracle logic.

The contract exposes:

- verified/candidate policy versions;
- allowed observed-client version ranges;
- persona, request-shape, cache, TLS, CCH, MCP, and environment profile refs;
- supported model/capability buckets;
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

- Network audit records zero non-loopback connection attempts.
- Observer refuses to run without sandbox enforcement.
- Placeholder credentials are the only credential-shaped values available to the process.
- No raw artifact remains after process exit.

### Gate 2: Provenance and Repeatability

- npm integrity and signature metadata are recorded.
- Binary hashes match pinned packages.
- Three repeated runs produce the same stable summary fields.
- Independent parsers agree on TLS and request-shape canonical hashes.

### Gate 3: Coverage

- Every required matrix cell has evidence or an explicit degraded reason.
- CCH has an explicit policy decision for custom-base and first-party-assumed modes.
- Sonnet 5, Fable 5, Opus 4.8, Haiku 4.5, 1M, tools, thinking, MCP, and IDE lanes are represented.
- `2.1.197` and `2.1.207` receive equal scrutiny.

### Gate 4: Cross-Project Integration

- CC Gateway exact-profile, final-byte verifier, proxy, sidecar, CCH, MCP, environment, and safe-summary tests pass.
- Sub2API tuple selection, observed-version handling, auth/proxy binding, healthcheck classification, scheduler gating, and safe-log tests pass.
- No direct fallback path becomes reachable.
- Secret/raw-material scans pass.

### Gate 5: Pre-Production Review

- Design assumptions are reconciled against generated evidence.
- Every production-visible field maps to a manifest signal with sufficient authority.
- Unknown or contradictory fields have a kill switch and fail-closed behavior.
- Deployment is blocked until the user explicitly approves a single-account canary.

## Phased Delivery

### Phase 0: Restore Trustworthy Baselines

- Repair cross-repository contract discovery.
- Run CC Gateway, sidecar, and targeted Sub2API baselines.
- Freeze the current `2.1.197` tuple as `unverified_legacy` for comparison only.

### Phase 1: Build the Oracle Core

- Add provenance, safe manifest, redaction, hermetic process runner, observer, and diff modules.
- Make current CCH and native matrix tools use the shared core.
- Fix bare-mode credential setup using placeholder `ANTHROPIC_API_KEY` without exposing it.

### Phase 2: Add Static and Runtime Matrices

- Unpack and classify all target packages.
- Run the HTTP/request-shape matrix for checkpoint versions.
- Produce safe manifests and diffs.

### Phase 3: Add TLS and Proxy Evidence

- Implement ClientHello-only and local MITM observers.
- Cross-check parsed summaries.
- Compare official observations with current uTLS sidecar profiles.

### Phase 4: Decide CCH and Profile Semantics

- Resolve CCH requirements from observed evidence.
- Determine which current profile fields remain valid.
- Produce candidate neutral `2.1.207` persona/request/TLS refs.

### Phase 5: Integrate CC Gateway and Sub2API

- Add evidence-backed profiles and contract fields.
- Preserve strict proxy/sidecar/security boundaries.
- Add migration, compatibility aliases, safe summaries, and kill switches.

### Phase 6: Staging Without Accounts

- Deploy only to local/staging loopback fixtures.
- Re-run the full matrix through Sub2API -> CC Gateway -> sidecar -> local mock upstream.
- Confirm zero external sockets and zero raw artifacts.

### Phase 7: Later User-Approved Canary

- After the user logs in a single account, run one minimal request per explicitly approved capability class.
- Compare production safe summaries to the oracle manifest.
- Do not batch canary and do not promote additional accounts automatically.

## Rollback and Kill Switches

- Keep `2.1.197` and `2.1.207` profiles independently addressable.
- Provide a global candidate-profile disable switch.
- Provide model-level disable switches for Sonnet 5, Fable 5, Opus 4.8, and 1M.
- Preserve strict sidecar and no-direct-fallback enforcement during rollback.
- Rollback changes routing to the last verified profile; it never re-enables an unverified legacy profile silently.

## Non-Goals

- Guaranteeing that Anthropic will never restrict or disable an account.
- Defeating server-side abuse controls, hidden attestation, entitlement checks, or authentication policy.
- Creating per-account random TLS fingerprints.
- Sending real requests or using real credentials during oracle development.
- Persisting raw prompts, bodies, responses, CCH values, ClientHello bytes, account identifiers, proxy credentials, or raw domain matches in logs/manifests.
- Automatically deploying to production as part of evidence generation.

## Design Acceptance Criteria

This design is complete when:

- the user accepts the safety boundary, evidence model, architecture, and phased delivery;
- the baseline hard-coded worktree dependency is explicitly included as Phase 0;
- `2.1.197` is treated as unverified rather than trusted;
- the implementation plan names exact files, tests, RED/GREEN commands, and commit checkpoints;
- implementation occurs in isolated CC Gateway and Sub2API worktrees based on their current local `main` branches.
