# Oracle Lab Phase 2 Normative Compatibility and Manifest Authority Plan

> **Execution note:** This is the implementation plan for Phase 2 only. Execute it on one clean,
> ordinary branch per repository after re-freezing `muqihang/main`. Do not revive the Phase 1
> Recovery workflow or create execution receipts, contexts, leases, envelopes, source bundles, or
> authority branches. The product-level sidecar envelope defined below is a protocol object, not an
> execution-governance artifact.

## 1. Goal

Phase 2 defines and tests the contracts that prevent fabricated, incompatible, expired,
contradictory, or unsupported profiles from being admitted to later runtime phases.

The deliverable is a versioned product contract consumed consistently by CC Gateway, its Go
sidecar, and Sub2API. It includes:

- deterministic serialization and a cross-language fixture corpus;
- authority-state, expiry, contradiction, invalidation, and disablement semantics;
- independent wire, semantic, state-sequence, and failure-semantics gates;
- `BehaviorCoherenceCertificate` and negative-capability semantics;
- signed manifest trust, threshold roles, lineage, anti-rollback, checkpoint, rotation, and
  revocation decisions;
- a deterministic sidecar capability envelope and replay-state contract;
- cross-project readiness, lifecycle, lineage, migration, outcome, and retry interfaces.

Phase 2 does not gather new Claude Code behavior evidence and does not enable production paths.

## 2. Governing Inputs and Precedence

Read these documents before implementation. If they conflict, use this precedence:

1. `docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md`
2. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md`
3. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-adversarial-validation-v2.md`
4. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-design.md`
5. `docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md`

The historical filenames remain unchanged. The active target for this phase is Claude Code
`2.1.215`; `2.1.207` remains the reference baseline. The pin is recorded in
`docs/superpowers/claude-code-active-target.json`. Do not follow a newer npm release during this
phase.

Normative external formats:

- JSON objects used for digests and signatures use RFC 8785 JCS. Reject duplicate keys,
  non-I-JSON numbers, lone surrogates, invalid UTF-8, trailing data, and negative zero before
  canonicalization. See `https://www.rfc-editor.org/rfc/rfc8785` and its verified errata.
- The sidecar envelope uses RFC 8949 core deterministic CBOR inside one unsigned 32-bit big-endian
  length prefix. Indefinite lengths, floats, tags, undefined values, duplicate map keys, trailing
  items, and non-text map keys are forbidden unless a future schema version explicitly adds them.

The dependency candidates frozen for implementation review on 2026-07-19 are:

- TypeScript strict JSON AST: `@humanwhocodes/momoa@3.3.10`;
- TypeScript JCS: `canonicalize@3.0.0`;
- TypeScript deterministic CBOR: `cborg@5.1.7` with `rfc8949EncodeOptions`, strict decode,
  duplicate-map-key rejection, and decode/re-encode byte equality;
- Go JCS: `github.com/gowebpki/jcs@v1.0.1`;
- Go deterministic CBOR: `github.com/fxamacker/cbor/v2@v2.9.2` with explicit deterministic
  encoding and duplicate-key rejection options.

Task 0 verifies these exact pins against the corpus before accepting them. A failed candidate is a
stop, not permission to replace the standard with a local serializer.

## 3. Frozen Baseline

At plan authoring time, the merged Phase 1 baselines are:

| Repository | `muqihang/main` commit | Tree |
| --- | --- | --- |
| CC Gateway | `7b26d09c8ab7bfe0ae9e98ede94438dad969b9a0` | `d3a898c67f8f49e467f822d9449a93aa166fc446` |
| Sub2API | `069fc473d974e248db780a3ef8e7db5a83e29e22` | `b76d6000a8a0b10e9c6a953adf7095978787a284` |

The Phase 1 shared contract remains byte-identical at:

`backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json`

Its SHA-256 is:

`70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1`

Do not mutate that file to represent Phase 2. Phase 2 creates a separate versioned contract
bundle and may reference the Phase 1 digest as a predecessor.

The exact Phase 1 B4-B6 RED inventories are also frozen inputs:

- CC Gateway: 61 failing leaves, digest
  `5e89551797fe78e0d63ab771873e15fbbbbbf53557c061c9433416815b2385c2`.
- Sidecar: 51 failing leaves, digest
  `774b9c070b9dbbbb643c98fb4ba4e1b403e13ba67e499b0e58167cec6d55020e`.

Phase 2 defines the contracts and pure admission decisions that those runtime paths will consume.
Phase 4 owns request-path wiring, durable replay storage, destination enforcement, restart and
replica behavior, and the transition of the Phase 0 runtime RED fixtures. Therefore Phase 2 must
preserve the two exact RED inventories rather than claiming them green.

## 4. Scope Ledger

### In scope

- Roadmap Phase 2 and the Phase 2 slices of `WP-R1`, `WP-R2`, `WP-R3`, `WP-R6`, and `WP-R7`.
- A shared logical contract bundle with byte-identical mirrors in both repositories.
- Pure validators, canonicalizers, trust/admission decision functions, and protocol codecs.
- Test-only keys, clocks, stores, replicas, and restart snapshots.
- A lightweight cross-repository checker that emits only a process result and concise diagnostics.
- Dependency and lockfile changes required by reviewed RFC 8785 and RFC 8949 implementations.

### Out of scope

- Reworking P0, P0.1, or P1.
- Changing historical `2.1.207` documents, reports, or evidence.
- Phase 3A package intake, reverse engineering, matrices, observation, or profile evidence.
- Phase 3B/3.5 profile compilation, generated runtime configuration, or local conformance.
- Phase 4 request-path enforcement, policy broker, durable replay ledger, DNS pinning, dial control,
  readiness propagation, lifecycle execution, or multi-replica runtime.
- Phase 5 scheduler policy or Phase 6 staging/canary work.
- Production, real upstreams, credentials, real-canary, profile promotion, or deployment.
- Any repair or reuse of Recovery validators, mapping artifacts, receipt machinery, or historical
  authority digests.

## 5. Ownership Boundary

Phase 2 may add product libraries and pure state machines, but must not wire them into live request
or scheduling paths.

| Concern | Phase 2 output | Later owner |
| --- | --- | --- |
| Compatibility | Schemas, validators, four independent gate decisions | Phase 3 supplies evidence; Phase 4 enforces admission at runtime |
| Negative capabilities | Explicit deny model and pure admission result | Phase 4 wires fail-closed request rejection |
| Cross-project readiness | Message schema and compatibility decision | Phase 4 propagates and enforces readiness |
| Account lifecycle | Operations, generations, CAS and transition rules | Phase 4 executes; Phase 5 consumes scheduler effects |
| Sidecar protection | Capability envelope, destination and replay semantics | Phase 4 implements broker, ledger, resolve/pin/dial, and zero-fallback path |
| Task lineage | Identity, parentage, migration and retry contracts | Phase 4 implements request/session state machine |
| Outcomes | `OutcomeEnvelope` facts and retry-ownership matrix | Phase 4 produces; Phase 5 consumes |
| Full chain | No signed staging bundle | Phase 6A |

The Phase 2 acceptance test is a pure admission boundary: an invalid artifact returns a stable deny
code without invoking a supplied request-construction, DNS, socket, scheduling, or sidecar callback.
The callbacks are test spies, not production wiring.

## 6. Contract Bundle Layout

Create one logical bundle named `oracle.compatibility.v1`. Store byte-identical mirrors at:

- CC Gateway: `contracts/oracle-lab/v1/`
- Sub2API: `backend/internal/service/testdata/oracle_lab_contract/v1/`

The mirrors contain only these product-contract files:

| File | Purpose |
| --- | --- |
| `contract.schema.json` | Draft 2020-12 schema for manifest, authority signal, four gates, coherence certificate, negative capabilities, readiness, lifecycle, lineage, migration, outcome, and replay state |
| `sidecar-envelope.schema.json` | Diagnostic JSON projection of the normative CBOR envelope; it does not replace the CBOR wire format |
| `sidecar-envelope.cddl` | Normative CDDL field types and CBOR map shape; prose alone is not the wire schema |
| `contract-index.json` | Bundle ID, schema versions, compatibility ranges, predecessor digest, and sorted file SHA-256 entries |
| `canonicalization-corpus.json` | Valid and invalid JSON/JCS and CBOR cases, including the H2 edge corpus |
| `authority-corpus.json` | Authority, expiry, contradiction, lineage, checkpoint, rotation, revocation, clock, split-view, and rollback cases |
| `coherence-corpus.json` | Valid tuples and one-mutation-at-a-time Frankenprofile rejections |
| `interface-corpus.json` | Readiness, lifecycle, destination, lineage, migration, outcome, retry, and replay transitions |
| `expected-results.json` | Canonical bytes or byte encodings, SHA-256 values, allow/deny decisions, and stable error codes |

`contract-index.json` lists the other eight files, not itself. Its own raw bytes must already be JCS
canonical. The shared-contract digest is `sha256(contract-index.json raw bytes)`. This avoids a
self-referential digest and gives both repositories one comparison value.

Mirrors are synchronized by one small copy/check command. There is no publication service,
registry, receipt, or evidence directory. A cross-repository check fails on any byte difference.
The Sub2API mirror is not independently editable.

## 7. Normative Data Rules

### 7.1 Version and downgrade

- `schema_id` is the exact string `oracle.compatibility`; `schema_major` and `schema_revision` are
  non-negative JSON integers, initially `1` and `0`.
- Each consumer declares a sorted list of supported `{schema_major, minimum_revision,
  maximum_revision}` ranges. All comparisons are numeric. Overlapping or inverted ranges deny the
  handshake.
- Unknown schema IDs or major versions, revisions outside an explicit range, unknown fields,
  missing required fields, and unrecognized enum values deny admission.
- A newer optional field is not silently ignored. Forward compatibility requires an explicitly
  declared schema range and a schema revision that defines the field.
- A manifest may reference only a contract digest and schema version supported by every required
  consumer.
- Downgrade is allowed only to an explicit, non-revoked rollback digest whose policy version is not
  below the stored rollback floor. Absence of a rollback reference denies downgrade.

### 7.2 Authority signal

Every signal includes:

- `authority_state`: `unverified`, `package_observed`, `local_wire_observed`, `cross_checked`,
  `gateway_wire_equivalent`, `stateful_behavior_equivalent`, `upstream_canary_observed`, or
  `production_verified`;
- `observation_scope`, `server_dependency`, `stability_class`, and `confidence`;
- `issued_at_ms`, `expires_at_ms`, owner, revalidation command ID, and invalidating dependency
  digests;
- negative evidence, contradictory evidence, contradiction status, minimum authority after expiry,
  affected capabilities, and disable/rollback action.

Authority is a partial order, not a string comparison. Server-dependent claims cannot exceed
`unverified` in local-only Phase 2 fixtures. Expired, contradicted, dependency-invalidated, or
revoked signals contribute no positive capability and trigger the declared fail-closed action.

### 7.3 Four gates

Each capability has four separate gate objects:

- `wire`: method, authority, path/query, ordered/repeated headers, encoding, final body bytes,
  transport summary, and negotiated protocol;
- `semantic`: request/response AST meaning, defaults, order-sensitive structures, tools, cache,
  usage, stop reasons, and error class;
- `state_sequence`: bounded session, count-token, stream, tool, retry, reconnect, refresh, and resume
  transitions;
- `failure_semantics`: timeout, reset, partial stream, status class, capacity, entitlement, proxy,
  retry, budget, quarantine, selection, and terminal result.

Each gate is `pass`, `fail`, `unsupported`, or `unobserved`, with an evidence reference and authority
signal. A capability is admissible only when every applicable gate is `pass`. `unsupported` and
`unobserved` are denies, never defaults.

### 7.4 Behavior coherence and negative capability

`BehaviorCoherenceCertificate` binds one complete tuple:

- package name/version/artifact digest and build identity;
- platform, architecture, entrypoint, authentication mode, and environment profile;
- persona, request AST, response, CCH, TLS/HTTP, proxy generation, credential generation, retry,
  state-sequence, failure-semantics, and model-capability references;
- contract, manifest, profile, sidecar protocol, and replay-ledger generations;
- four-gate results and all dependency digests.

The negative-capability object explicitly denies models, beta tokens, transports, entrypoints,
fallbacks, feature combinations, and insufficient authority states. A tuple is denied when a
negative rule matches, a required positive declaration is absent, or fields come from different
approved tuples.

The corpus includes one target-role case with reference `2.1.207` and active `2.1.215`, bound to the
existing active-target overlay and downloaded artifact digest. It tests version-role vocabulary
only. It must not attach new behavior authority, reuse `2.1.207` observations for `2.1.215`, or
promote either target.

### 7.5 Signed manifest authority

The signed payload uses RFC 8785 bytes with domain separation
`oracle-manifest-v1\x00`. Use Ed25519 test keys through standard crypto APIs. Do not invent a new
signature primitive and do not commit private production material.

The trust model defines:

- offline `root`, online `manifest`, `checkpoint`, and emergency `revocation` roles;
- distinct key IDs, role membership, threshold counts, key epochs, and validity intervals;
- manifest digest, monotonic policy version, parent digest, rollback target, contract digest,
  source package digests, promotion references, and witness checkpoint;
- root rotation signed by both the old and new root thresholds;
- manifest/checkpoint freshness, freeze detection, mix-and-match rejection, split-view detection,
  monotonic rollback floors, and emergency revocation precedence.

Phase 2 implements a deterministic verifier and pure state transition against a caller-supplied
trust state. Durable storage, atomic reload, replica transport, and operational key custody remain
Phase 4/6 concerns. Restart and replica tests serialize the pure trust state, reload it, and compare
decisions; they do not claim a production store.

### 7.6 Sidecar envelope and replay

The CBOR envelope binds:

- schema version, key epoch, capability ID, attempt ID, nonce, issued time, deadline, and maximum
  encoded length;
- final method, authority, normalized path/query, ordered header digest, body digest, content length,
  and content encoding;
- profile, proxy, credential, account transport-cell, contract, manifest, and destination-policy
  generations;
- resolved destination class and allowed host/port set, without raw proxy credentials;
- response-policy reference and retry owner;
- Ed25519 key ID and signature over the deterministic unsigned envelope bytes.

The exact signature input is the ASCII domain separator
`oracle-sidecar-capability-v1\x00` followed by the deterministic unsigned-envelope CBOR bytes; the
four-byte frame length is not part of the signature input. Capability keys belong to a dedicated
`sidecar_capability` role and key epoch. A verifier must reject a key ID from the `root`,
`manifest`, `checkpoint`, or `revocation` roles, reject role or epoch reuse, and reject a signature
created for any other signed object even when the same public-key bytes appear in a malformed test
trust state. Production key reuse across roles is forbidden.

Replay identity is `(key_epoch, capability_id, attempt_id, nonce)`. The pure ledger transition
model supports `reserve`, `commit`, `expire`, and `revoke`, rejects reuse after any terminal state,
and defines conflict results for stale replica generations. Clock decisions take an explicit wall
clock sample, monotonic elapsed time, and rollback tolerance. They never call system time inside the
decision function.

## 8. Implementation Sequence

Use test-first changes and one reviewable invariant per commit. Do not run broad suites until Task 8.

### Task 0: Re-freeze main and pin dependencies

**Files:** lockfiles only if a new dependency is accepted.

1. Fetch both `muqihang/main` refs and record commit/tree IDs in the PR description.
2. Stop on remote-main drift that changes a Phase 2 product anchor or the Phase 1 shared contract.
3. Create one clean linked worktree and ordinary `codex/` branch per repository. Do not create
   additional clones or touch historical Recovery roots.
4. Confirm `docs/superpowers/claude-code-active-target.json` still pins active `2.1.215` and reference
   `2.1.207`.
5. Review and pin the exact dependency candidates listed in Section 2. Record npm integrity values
   in the PR description and let `package-lock.json`/`go.sum` record resolved bytes. AJV 8 remains
   the TypeScript Draft 2020-12 schema validator.
6. Reject libraries that cannot detect duplicate map/object keys, enforce resource limits, disable
   indefinite CBOR, or produce the required deterministic form.

**Pass condition:** clean bases are frozen, dependencies are pinned, and a tiny upstream RFC vector
passes in each language. If no acceptable implementation exists, stop here instead of writing an
ad hoc canonicalizer.

### Task 1: Add the shared contract bundle and mirror check

**CC Gateway files:**

- `contracts/oracle-lab/v1/*`
- `tools/oracle-contract/sync-shared-contract.ts`
- `tools/oracle-contract/check-shared-contract.ts`
- `package.json`

**Sub2API files:**

- `backend/internal/service/testdata/oracle_lab_contract/v1/*`

**Test first:** add a CC test that fails because the bundle is absent, then fails for one-byte mirror
drift, wrong index ordering, stale file digest, unknown file, path escape, symlink, duplicate JSON
key, and a mutated Phase 1 predecessor digest. Every mutation runs against temporary directory
copies and proves the real worktrees remain byte-identical and clean.

**Implementation:** add the schemas/corpora/index and a small deterministic copy/check tool. The
tool accepts explicit repository roots, refuses paths outside the two bundle directories, does not
write evidence, and has separate `--check` and explicit `--sync` modes. CI uses only `--check`.

**Focused verification:**

```bash
npx tsx tests/oracle-contract-shared-bundle.test.ts
npm run oracle:phase2:contract -- --sub2api-root "$SUB2API_ROOT" --check
```

**Pass condition:** both mirrors and their bundle digest agree; the Phase 1 vector digest is
unchanged.

### Task 2: Implement strict decode and canonicalization agreement

**CC Gateway files:**

- `src/oracle-contract/strict-json.ts`
- `src/oracle-contract/canonical.ts`
- `src/oracle-contract/cbor-envelope.ts`
- `tests/oracle-contract-canonical.test.ts`

**Sub2API files:**

- `backend/internal/service/oracle_contract_canonical.go`
- `backend/internal/service/oracle_contract_canonical_test.go`

**Sidecar files:**

- `sidecar/egress-tls-sidecar/internal/control/envelope_v2.go`
- `sidecar/egress-tls-sidecar/internal/control/envelope_v2_test.go`

**Test first:** consume `canonicalization-corpus.json` in TS and Go. Cover duplicate keys at every
depth, Unicode and escaping, object order, arrays, empty and null values, integer bounds, negative
zero, invalid UTF-8, trailing data, compression metadata, IPv6 forms, duplicate query parameters,
query ordering, repeated headers, deterministic CBOR, length mismatch, oversized frames, and
trailing CBOR items.

**Implementation:** wrap the pinned libraries behind narrow local APIs. Normalize URL, query, and
header data only where the schema explicitly requires it. Never parse and reserialize request body
bytes to obtain the final body hash.

**Focused verification:**

```bash
npx tsx tests/oracle-contract-canonical.test.ts
(cd sidecar/egress-tls-sidecar && go test ./internal/control -run 'TestEnvelopeV2')
(cd "$SUB2API_ROOT/backend" && go test ./internal/service -run 'TestOracleContractCanonical')
```

**Pass condition:** TS, sidecar Go, and Sub2API Go produce exactly the fixture bytes, hashes, and
stable rejection codes.

### Task 3: Implement schema validation, four gates, coherence, and negative admission

**CC Gateway files:**

- `src/oracle-contract/types.ts`
- `src/oracle-contract/schema.ts`
- `src/oracle-contract/admission.ts`
- `tests/oracle-contract-admission.test.ts`

**Sub2API files:**

- `backend/internal/service/oracle_contract_types.go`
- `backend/internal/service/oracle_contract_admission.go`
- `backend/internal/service/oracle_contract_admission_test.go`

**Test first:** run every `coherence-corpus.json` case through both implementations. Mutate one tuple
dimension at a time. Include absent, unknown, unsupported, expired, contradicted,
dependency-invalidated, insufficient-authority, cross-tuple, and downgrade cases. Assert exact
decision code, affected capability, disable/rollback action, and that all supplied boundary spies
remain uncalled on deny.

**Implementation:** add strict Draft 2020-12 validation in TS and equivalent typed/strict validation
in Go, then pure authority and admission decisions. Keep the four gates independent in diagnostics;
do not collapse them into one boolean. Do not import these modules from `src/proxy.ts`,
`src/egress-sidecar-client.ts`, or Sub2API runtime services in this phase.

**Focused verification:**

```bash
npx tsx tests/oracle-contract-admission.test.ts
(cd "$SUB2API_ROOT/backend" && go test ./internal/service -run 'TestOracleContractAdmission')
```

**Pass condition:** both languages accept and reject the same cases with the same stable code, and
no denied case reaches a test boundary callback.

### Task 4: Implement manifest trust, lineage, and clock decisions

**CC Gateway files:**

- `src/oracle-contract/manifest-authority.ts`
- `src/oracle-contract/trust-state.ts`
- `tests/oracle-contract-manifest-authority.test.ts`

**Sub2API files:**

- `backend/internal/service/oracle_contract_authority.go`
- `backend/internal/service/oracle_contract_authority_test.go`

**Test first:** consume `authority-corpus.json` for valid thresholds, insufficient or duplicate
signers, wrong roles, expiry, parent mismatch, policy rollback, revoked manifest/key, root rotation,
old-root-only/new-root-only rotation, stale checkpoint, freeze, mix-and-match, split-view, witnessed
checkpoint mismatch, clock rollback, dependency invalidation, restart snapshot, and two-replica
generation conflict.

**Implementation:** use standard Ed25519 verification over domain-separated JCS bytes. Return a new
immutable trust state plus decision; never mutate global state or read system time. Bound key count,
signature count, manifest size, lineage depth, and clock skew.

**Focused verification:**

```bash
npx tsx tests/oracle-contract-manifest-authority.test.ts
(cd "$SUB2API_ROOT/backend" && go test ./internal/service -run 'TestOracleContractAuthority')
```

**Pass condition:** TS and Go decisions and next-state digests match every fixture. Only public test
keys are committed.

### Task 5: Implement the sidecar envelope and replay-state contract

**CC Gateway files:**

- `src/oracle-contract/sidecar-envelope.ts`
- `tests/oracle-contract-sidecar-envelope.test.ts`

**Sidecar files:**

- `sidecar/egress-tls-sidecar/internal/control/envelope_v2.go`
- `sidecar/egress-tls-sidecar/internal/control/envelope_v2_test.go`

**Test first:** verify round trips and exact CBOR bytes for final header/body hashes, content length
and encoding, IPv6 authority, duplicate query values, proxy/profile/credential generations,
destination class, deadline, key epoch, response policy, signature, replay reserve/commit, expired
reservation, revoked epoch, restart snapshot, and stale replica generation. Mutate every signed
field and require denial. Also reject missing or changed domain separation, manifest/checkpoint/
revocation signatures presented as capability signatures, a key assigned to the wrong role, key
role reuse, and an otherwise valid signature from the wrong key epoch.

**Implementation:** add encoder, strict decoder, signature verification, and pure replay transition.
Do not alter `EgressSidecarControl`, `prepareEgressSidecarRequest`, Go `control.Validate`,
`server.Handler`, network dialing, or any live sidecar route in Phase 2.

**Focused verification:**

```bash
npx tsx tests/oracle-contract-sidecar-envelope.test.ts
(cd sidecar/egress-tls-sidecar && go test ./internal/control -run 'TestEnvelopeV2|TestReplayTransitionV1')
```

**Pass condition:** TS and Go bytes, signatures, replay decisions, and error codes agree. The Phase 1
sidecar behavior and exact RED inventory remain unchanged.

### Task 6: Implement cross-project interface contracts

**CC Gateway files:**

- `src/oracle-contract/cross-project.ts`
- `tests/oracle-contract-cross-project.test.ts`

**Sub2API files:**

- `backend/internal/service/oracle_contract_cross_project.go`
- `backend/internal/service/oracle_contract_cross_project_test.go`

**Test first:** consume `interface-corpus.json` for:

- liveness versus readiness versus protected capability;
- build/contract/manifest/profile/sidecar/replay-ledger generations;
- register, replace, freeze, drain, revoke, delete, query, and reconcile operations;
- account, credential, proxy, and profile generation/CAS conflicts;
- root/parent/current task lineage and controlled migration;
- attempt, deadline, idempotency, retry owner, final header/body hash, transport fact, semantic
  outcome, partial output, and tool-side-effect facts;
- incompatible repository revision, stale authority, restart snapshot, and replica split.

**Implementation:** add typed messages, strict validators, and pure compatibility/transition
functions. Reuse the Phase 1 owner/version/state/CAS vocabulary where compatible. Do not call or
modify the current runtime replay, onboarding, scheduler, proxy, or response paths.

**Focused verification:**

```bash
npx tsx tests/oracle-contract-cross-project.test.ts
(cd "$SUB2API_ROOT/backend" && go test ./internal/service -run 'TestOracleContractCrossProject')
```

**Pass condition:** both repositories return identical decisions for the same fixture, and an
incompatible handshake is denied before scheduling/boundary spies.

### Task 7: Add one joint contract gate

**CC Gateway files:**

- `tools/oracle-contract/check-cross-repo.ts`
- `tests/oracle-contract-cross-repo.test.ts`
- `package.json`

**Sub2API files:** CI command wiring only if required by the existing workflow.

The checker accepts explicit CC and Sub2API roots, verifies clean contract mirrors, runs TS and Go
fixture evaluators, and compares:

- bundle digest and supported schema range;
- canonical JSON and CBOR hashes;
- stable decision code and next-state digest for every corpus case;
- readiness generation tuple and negative-capability decision.

It must not create a report, receipt, context, lease, evidence bundle, or mutable cache. JSON output
to stdout is allowed for CI diagnostics.

**Focused verification:**

```bash
npm run oracle:phase2:contract -- --sub2api-root "$SUB2API_ROOT" --check
npx tsx tests/oracle-contract-cross-repo.test.ts
```

**Pass condition:** one intentional mirror, hash, schema-range, or decision drift fails with a stable
code; the unmodified pair passes.

### Task 8: Serial integration verification and handoff

Run gates serially in this order. Stop on the first product failure, diagnose once, and apply one
consolidated fix wave before review.

1. All Task 1-7 focused tests.
2. CC Gateway full local suite: `npm test`.
3. CC sidecar full suite: `(cd sidecar/egress-tls-sidecar && go test ./...)`.
4. Sub2API backend full suite: `(cd "$SUB2API_ROOT/backend" && go test ./...)`.
5. Sub2API frontend full suite: `(cd "$SUB2API_ROOT/frontend" && pnpm test:run)`.
6. Joint contract gate from Task 7.
7. Phase 1 B4-B6 exact expected RED checks. Require the same leaf counts and digests from Section 3.
8. Build/typecheck: CC `npm run build`; sidecar `go build ./...`; Sub2API backend `go build ./...`;
   Sub2API frontend `(cd "$SUB2API_ROOT/frontend" && pnpm typecheck && pnpm build)`.

Create a short Phase 2 handoff containing only base/head/tree IDs, changed product paths, bundle
digest, focused/full test summary, exact RED result, review verdict, PR/merge commits, and deferred
Phase 3A entry conditions. It is a human handoff, not an authority artifact.

## 9. Review Protocol

Use one independent, read-only integrated review of the immutable Task 8 heads. The reviewer must
review the two exact base-to-head ranges and may not expand Phase 2 scope or request optional
hardening as a blocking finding.

Review for:

- scope leakage into Phase 3/4/5/6 or live runtime wiring;
- ambiguity or disagreement in version, canonicalization, signature, threshold, lineage, expiry,
  contradiction, rollback, replay, clock, destination, or retry semantics;
- parser differential behavior, resource exhaustion, signature confusion, key/role mix-up,
  cross-tuple coherence bypass, fail-open defaults, and unstable error codes;
- mirrored contract drift and test cases that validate only one implementation;
- accidental secrets, raw request material, or production-capable configuration.

Classify findings as Critical, Important, or Minor. Apply at most one consolidated fix wave for all
real Critical/Important findings, rerun affected focused gates and Task 8, then perform one
independent closure review. When the integrated review reports zero Critical and zero Important,
it is final and no closure review is run. Minor findings go into the short handoff and do not reopen
implementation.

If a required closure review still has any Critical or Important finding, stop. Do not add a new
reviewer round, schema, authority process, branch, clone, or recovery mechanism.

## 10. Completion Definition

Phase 2 is complete only when all of these are true:

- both repositories are based on re-frozen `muqihang/main` and have no unrelated product changes;
- `oracle.compatibility.v1` has exact version, compatibility, and downgrade rules;
- CC Gateway, sidecar Go, and Sub2API Go agree on canonical bytes/hashes and exact rejection results;
- unknown fields, unsupported/absent capabilities, incoherent tuples, invalid authority, expired or
  contradicted signals, invalid signatures/lineage, rollback, and replay fail closed in pure
  admission tests;
- restart snapshot, replica split, clock fault, root/key rotation, revocation, and witnessed
  checkpoint semantics pass fixture tests;
- no denied case invokes request-construction, DNS, socket, scheduling, or sidecar boundary spies;
- all focused tests, one serial full local suite per affected repository, the joint gate, and
  build/typecheck pass;
- Phase 1 B4-B6 exact expected RED inventories are unchanged;
- the independent integrated review has zero Critical or Important findings, and the independent
  closure review also has zero Critical or Important findings when a fix wave made it necessary;
- ordinary PRs merge and one post-merge verification confirms main commit/tree, bundle digest,
  joint gate, builds, and the exact RED inventories;
- the handoff names Phase 3A as next and does not claim profile evidence, runtime enforcement,
  production readiness, or real-upstream behavior.

## 11. Stop Rules

Stop and report without inventing a process when any of these occurs:

- remote main drifts across a Phase 2 product anchor or the Phase 1 contract digest changes;
- TS and Go cannot agree on RFC 8785 or deterministic CBOR semantics with maintained libraries;
- a governing requirement requires live runtime wiring to satisfy Phase 2 acceptance;
- a contract ambiguity needs a product-owner or security-owner decision;
- implementation would touch an excluded/forbidden product path or user-dirty sibling checkout;
- a real product semantic conflict cannot be resolved in the single fix wave;
- the environment fails after one system diagnosis and one repair attempt;
- closure review retains a Critical or Important finding.

## 12. Things Not To Do

- Do not create or renew a receipt, context, lease, governance envelope, source bundle, restart,
  replay/recovery authority, mapping artifact, or evidence schema.
- Do not repair or invoke the Phase 1 Recovery validator.
- Do not create a new clone or a new branch for each failure or review comment.
- Do not mutate the Phase 1 shared vector or historical `2.1.207` artifacts.
- Do not use `tools/oracle-lab/harness-core.ts#canonicalJson` as RFC 8785.
- Do not reuse `docs/superpowers/schemas/oracle-lab-run-manifest.schema.json` as the product manifest.
- Do not hand-roll cryptography, use floating npm tags, or commit private signing material.
- Do not wire Phase 2 libraries into live proxy, scheduler, sidecar server, DNS, or socket paths.
- Do not turn Phase 1 B4-B6 expected RED into an accidental acceptance claim.
- Do not run Phase 3 package intake or multi-version matrices. Keep `2.1.207` reference and
  `2.1.215` active in the contract vocabulary only.
- Do not touch production, real upstreams, credentials, real-canary, profile promotion, or
  deployment.
- Do not run broad suites in parallel or repeatedly. Run them once after focused stability, once
  after the single fix wave if needed, and once post-merge only as specified.
