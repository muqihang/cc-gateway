# Claude Code 2.1.215 Oracle Lab Phase 3B Profile Synthesis Plan

> **Plan-only status (2026-07-22):** this document authorizes no Phase 3B implementation,
> production path, runtime enforcement, profile promotion, deployment, real upstream, real
> credential, or canary. `Phase 3B` is canonical; `3.5` is a durable alias, not an eighth
> top-level phase. The current Phase 3B entry is **BLOCKED** by the resume/lineage evidence gate
> in Section 7.2. A fresh independent plan review and plan merge are required before a new
> execution controller is created.

## 1. Decision and scope

This plan converts the current Phase 2 contract and the reviewed, de-identified Phase 3A handoff
into a future deterministic profile compiler, generated CC Gateway/Sub2API artifacts, typed
fixtures, and local loopback conformance checks. It deliberately does not wire any artifact into
`startProxy`, `handleRequest`, Sub2API scheduling, sidecar transport, DNS, sockets, readiness
propagation, replay storage, or account lifecycle runtime.

The planning decision is:

1. The two and only two usable Phase 3A conclusions are
   `CL-P3A-R2-CONFIG-AUTH` and `CL-P3A-R2-FAILURE-STREAM`.
2. Compact/cache lifecycle, positive telemetry/update behavior, restart/resume/child lineage,
   provider TLS equivalence, Linux/Windows runtime behavior, and incomplete Tier-A pairs for
   `2.1.214`, `2.1.212`, and `2.1.211` remain explicit negative capabilities.
3. New-session streaming and bounded local failure/stream fixtures are eligible for future
   compilation, subject to schema-valid safe-field extraction from those two conclusion rows.
4. Resumed-session streaming is not supported by the current handoff. It is a hard blocked row,
   not a value to infer from new-session or `2.1.208` child-lineage evidence.
5. The future implementation is a paired CC Gateway/Sub2API change. The plan PR changes only this
   document in CC Gateway; Sub2API remains unchanged until a post-merge execution controller opens
   a paired implementation PR.
6. Local compiler success is not profile promotion. Phase 4 owns runtime enforcement and Phase 6A
   owns the signed full-chain local staging bundle and zero-external-socket proof.

### 1.1 Planning artifacts versus future implementation outputs

| Class | Produced by this planning task | Produced only by a future Phase 3B controller |
| --- | --- | --- |
| Authoritative plan | this file | no |
| Fresh baseline and CodeGraph observations | reported in this file and PR description | independently re-frozen, not trusted from planning alone |
| Product/compiler code | no | TypeScript compiler/validators and Go validators |
| Generated profiles/configuration | no | canonical generated artifacts under the paths in Section 9 |
| Typed fixture corpus | no | de-identified JSON fixtures and mutation corpus |
| Runtime wiring | no | not Phase 3B; remains Phase 4 |
| Signed staging/canary output | no | not Phase 3B; remains Phase 6A/6B |

## 2. Governing inputs and precedence

Conflicts resolve in this order:

1. the active operator scope and safety boundary for this planning task;
2. `docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md`;
3. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md`;
4. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-adversarial-validation-v2.md`;
5. `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-design.md`;
6. `docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md`;
7. `docs/superpowers/plans/2026-07-19-claude-code-2.1.215-phase-2-normative-compatibility.md` and
   `docs/superpowers/2026-07-19-claude-code-2.1.215-phase-2-handoff.md` for the merged P2 state;
8. the external Phase 3A v13 handoff bindings in Section 4.

Review Amendments Section 4 is normative for Phase 3B. In particular, unsupported behavior being
safely disabled is insufficient for exit; all five minimum cases must pass truthfully. The
historical text names a `2.1.207` candidate while the merged Phase 2 active-target overlay and this
task name `2.1.215` and retain `2.1.207` only as a reference role. A lower-precedence overlay must
not silently rewrite higher-precedence text. Therefore the consolidated independent plan review
must record one of these decisions before implementation starts:

- the active-target overlay validly parameterizes the Section 4.4 candidate version to `2.1.215`;
  or
- a separately reviewed `2.1.207` usable evidence input is also required.

Absent that explicit decision, the version-role gate remains blocked even if the resume supplement
passes. No `2.1.207` observation may be copied onto `2.1.215`, and no `2.1.215` conclusion may be
relabeled as `2.1.207`.

## 3. Fresh planning baseline

The following heads were fetched from `muqihang/main` on 2026-07-22 and inspected in new planning
roots. A future implementation controller must fetch again and must not assume these remain
current.

| Repository | Planning root | Fresh `muqihang/main` head | Tree | State before planning-local indexes |
| --- | --- | --- | --- | --- |
| CC Gateway | `/Users/muqihang/chelingxi_workspace/cc-gateway-phase3b-plan-215` | `6192a0fea87975e29c1486b2285ce6b7a9f06906` | `8903d7bab2e3aeade3a88b9b601037ef834f7b1c` | clean worktree from PR #38 merge |
| Sub2API | `/Users/muqihang/chelingxi_workspace/sub2api-phase3b-plan-215` | `fb840673afc0ff590fef9bb147fce5b9b70eb098` | `eeb8654eddf7a4c38364202f5024161e65d2a6d1` | clean clone from PR #7 merge |

CodeGraph 1.1.6 was rebuilt in both roots. The protected
`backend/internal/service/openai_compact_sse_keepalive_test.go` path was excluded before Sub2API
indexing and was not read, searched, modified, staged, or committed.

| Repository | Files | Nodes | Edges | Status |
| --- | ---: | ---: | ---: | --- |
| CC Gateway | 262 | 9,229 | 32,322 | up to date |
| Sub2API | 1,909 | 71,683 | 97,383 | up to date; CLI reports an engine-improvement reindex notice despite the fresh build |

The merged Phase 2 contract index is byte-identical in both repositories:

```text
oracle.compatibility.v1 contract-index SHA-256
2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce

Phase 1 predecessor SHA-256
70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1

supported schema range
1:0-0
```

## 4. External Phase 3A v13 binding

Phase 3B must bind the existing safe handoff by path and digest. It must not copy, regenerate, or
walk raw Phase 3A evidence. The authoritative planning bindings are:

| Artifact | Absolute existing path | SHA-256 |
| --- | --- | --- |
| P3A exit v13 | `/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-4/phase-3a-exit-report-v13.json` | `57f16b207933b3a751f96471733d435fa4b0c9801fbef2f5495e8884dfe0bd1b` |
| P3A/3.5 handoff v13 | `/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-4/phase-3b-3.5-handoff-v13.json` | `9d188072719dc27a2f9cc9939bc79afa598802b84dd4d9161fb1da3263a792d7` |
| terminal manifest v8 | `/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-4/closure-terminal-manifest-v8.json` | `c9ee57fbe29125c88278961565f814326b052077b861bb41008cdde6161f12f5` |
| artifact index v23 | `/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-4/artifact-index-v23.json` | `e8645c7ed4bc984a926f91e3df1b756c4b009b3a02408de213cbe81b060e80d4` |
| leak scan v23 | `/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-4/leak-scan-v23.json` | `7ed3e2776c7fcc47d6c8d513318b33547919c92a33a068a4f0c0cb3706bad145` |

The terminal manifest is GREEN and the leak scan is PASS with zero findings. This means the P3A
closure package is internally complete; it does not mean every Claude behavior is classified.
The handoff's only candidate input rows are:

```json
[
  {"conclusion_id":"CL-P3A-R2-CONFIG-AUTH","phase3b_usable":true},
  {"conclusion_id":"CL-P3A-R2-FAILURE-STREAM","phase3b_usable":true}
]
```

The compiler must verify all five hashes, schema validity, expiry, conclusion IDs, and
`phase3b_usable: true` before reading safe conclusion projections. It must reject a path outside
the bound evidence root, a symlink, digest mismatch, unknown row, expired row, contradiction,
parser disagreement, or an attempt to traverse supporting raw artifacts.

## 5. Requirement traceability

| Requirement | Phase 3B interpretation | Planned gate/output |
| --- | --- | --- |
| `RA-P0-001` | deterministic evidence-to-profile compiler | P3B-2 compiler, repeat-build byte equality, bundle digest |
| `RA-P0-002` | at least one truthful complete candidate; negative-only completion forbidden | five-case coverage gate; currently blocked on resume and version-role review |
| `RA-P0-005` | preserve the P2 versioned cross-project contract/readiness vocabulary | exact P2 digest/range binding and paired TS/Go artifacts; no P2 in-place mutation |
| `RA-P0-007` | bounded response/failure/retry facts | de-identified failure/stream profile and conformance fixtures only; runtime OutcomeEnvelope remains Phase 4 |
| `RA-P0-009` | protected production remains disabled | generated negative manifest includes production, canary, real upstream, and protected runtime denies |
| `RA-P1-002` | coherent build/request/response/control/auth/transport outputs | one evidence-bound tuple graph; no mixed refs or handwritten upstream-visible constants |
| `RA-P1-003` | typed de-identified fixtures and bounded drift facts | typed request/response/state/failure fixtures and mutation corpus; no raw values |
| `RA-P1-004` | lineage and migration contract | generated fail-closed lineage profile; resume stays disabled until supplement; runtime state machine remains Phase 4 |
| `RA-P1-007` | liveness/readiness/capability generations | generated readiness expectation artifact only; no endpoint or scheduling wiring |
| `HA-P0-001`, `HA-P0-002`, `HA-P0-004` | registry, precedence, and fresh baseline truthfulness | input binding, current heads, immutable requirement mapping |
| `HA-P0-006` | shared contract discovery | P2 contract digest/range/predecessor check |
| `HA-P0-009` | negative capability is explicit and fail closed | missing/Unknown/unsupported/expired/contradicted input denies generation |
| `HA-P1-002` | lifecycle/resume needs reproduced evidence | resume supplement hard gate and convergence criteria |
| `HA-P1-003` | bounded safe error classification | stable compiler/validator error codes and leak-canary mutation tests |
| `OL-LEGACY-001` | legacy/reference tuple is comparison-only | no mutation or promotion of a legacy tuple |
| `AV-B4-001`, `AV-B5-001`, `AV-B6-001` | direct egress, sidecar auth/replay, and destination runtime remain RED/deferred | negative entries only; no Phase 4 implementation or GREEN claim |

Registry status is not rewritten by plan or compiler generation. The future exit handoff may
propose evidence references for Phase 3B-owned rows, but a separate reviewed registry update owns
status transitions.

## 6. Current code and call-path anchors

These anchors come from the fresh CodeGraph indexes, not historical P3A/P1 context.

### 6.1 CC Gateway

| Concern | Current path/symbol | Current call/ownership fact |
| --- | --- | --- |
| config load/validation | `src/config.ts::loadConfig` (line 590), `validateFormalPoolMode` (366) | `src/index.ts` loads config; current profile-like values remain YAML/handwritten and runtime owned |
| persona/profile selection | `src/persona-resolver.ts::resolvePersonaDecision` (72), `src/persona-registry.ts::resolvePersonaProfileId` (202) | invoked from the proxy request path; must not be wired by Phase 3B |
| TLS profile | `src/egress-tls-profile.ts::TLSProfileConfig`, sidecar `internal/profile/profile.go::Profile` | config and TLS engine consumers exist; provider equivalence remains Unknown |
| request transport | `src/direct-upstream-request.ts::requestDirectUpstream`, `src/proxy.ts::startProxy`/`handleRequest` | live transport boundary; explicitly out of Phase 3B |
| P2 types/admission | `src/oracle-contract/types.ts::BehaviorCoherenceCertificate`, `admission.ts::decideBehaviorAdmission` (100) | CodeGraph finds only `tests/oracle-contract-admission.test.ts` as caller; pure/test-only today |
| negative capability | `src/oracle-contract/admission.ts::negativeDecision` (54) | denies matching model, beta, transport, entrypoint, fallback, feature, or authority state |
| canonical hash | `src/oracle-contract/canonical.ts::canonicalizeJsonValue`, `sha256Hex`; `tools/oracle-contract/check-shared-contract.ts::sha256Bytes` (42) | existing RFC 8785 and SHA-256 helpers are the required base |
| existing output/index writer | `tools/oracle-lab/phase3a/artifact-index.ts::buildArtifactIndex` (80), `writeArtifactIndex` (106) | canonical exclusive-create pattern is reusable; its filesystem `mtime` field is not suitable for deterministic Phase 3B output |
| existing manifest reader/writer boundary | `tools/oracle-lab/phase3a/launch-manifest.ts::LaunchManifest`, `loadLaunchManifest`; `build-exit.ts::CuratedExitInput` | safe schema/digest input pattern; Phase 3B binds summaries and never traverses raw evidence |
| rollback/expiry | `src/oracle-contract/manifest-authority.ts::verifyManifestAuthorityUpdate` (217), `trustStateDigest` (159) | verifies expiry, parent, rollback floor/target, dependency invalidation, checkpoint and generation |
| cross-project state | `src/oracle-contract/cross-project.ts::decideReadiness` (102), `transitionLifecycle` (159), `decideTaskLineage` (213), `decideOutcome` (257) | pure P2 interfaces; runtime propagation is Phase 4/5 |
| shared bundle | `tools/oracle-contract/check-shared-contract.ts::checkSharedContract` (167) | checks byte-identical mirrors, index order/digests, predecessor digest |
| TS/Go boundary | `tools/oracle-contract/check-cross-repo.ts::checkCrossRepoContract` (76) | called by CLI and `tests/oracle-contract-cross-repo.test.ts`; runs focused TS/Go checks |
| fake upstream | `tools/oracle-lab/phase3a/observers/fake-upstream.ts::startFakeUpstream`, `requestFacts` (161) | loopback-only request/JSON/SSE/failure observer pattern; reuse only safe typed scenarios |

### 6.2 Sub2API

| Concern | Current path/symbol | Current ownership fact |
| --- | --- | --- |
| Go contract types | `backend/internal/service/oracle_contract_types.go` | Go mirror of P2 certificate, gates, signals, and negative capability objects |
| Go admission | `backend/internal/service/oracle_contract_admission.go::DecideOracleBehaviorAdmission` (154) | pure validator/decision function with focused tests; not a scheduler hook |
| Go canonical hash | `backend/internal/service/oracle_contract_canonical.go::CanonicalizeOracleJSON` (166) | strict duplicate/UTF-8/surrogate/number/trailing-data validation plus JCS/SHA-256 |
| Go authority | `backend/internal/service/oracle_contract_authority.go::VerifyOracleManifestAuthorityUpdate` (272) | matches expiry, rollback, invalidation, checkpoint, and generation semantics |
| Go readiness | `backend/internal/service/oracle_contract_cross_project.go::DecideOracleReadiness` (127) | pure P2 cross-project decision; no Phase 3B runtime wiring |
| P2 mirror | `backend/internal/service/testdata/oracle_lab_contract/v1/` | byte-identical nine-file mirror of `contracts/oracle-lab/v1/` |
| focused tests | `oracle_contract_{canonical,admission,authority,cross_project}_test.go` | exact future regression anchors |

The protected keepalive test is not an anchor and must remain outside every Phase 3B command,
file list, search, mutation, and diff.

## 7. Candidate coverage matrix and hard gates

### 7.1 Minimum exit cases

| Minimum case | P3A usable source | Exact future typed fixture | Planning verdict | Future acceptance |
| --- | --- | --- | --- | --- |
| new session + streaming Messages | `CL-P3A-R2-CONFIG-AUTH` for local config/placeholder auth plus `CL-P3A-R2-FAILURE-STREAM` for complete stream | `fixtures/new-session-streaming.json` | **ELIGIBLE**, not yet implemented | request profile, auth profile, complete SSE grammar, terminal class, tuple refs, TS/Go digest all pass |
| resumed session + streaming Messages | no usable row; `CL-P3A-RESUME-LINEAGE-UNKNOWN` is explicitly non-usable | `fixtures/resumed-session-streaming.json` | **BLOCKED** | only a separately approved P3A supplement may populate the fixture; otherwise fixture is a negative rejection case |
| bounded response failure/recovery | `CL-P3A-R2-FAILURE-STREAM` | `fixtures/bounded-failure-recovery.json` | **ELIGIBLE**, not yet implemented | HTTP failure, reset, partial stream, complete stream, retry-owner and terminal/no-retry expectations agree |
| deterministic regeneration | exact handoff v13 + approved resume supplement + P2 bundle | `fixtures/deterministic-regeneration.json` | **STRUCTURAL GATE** | two isolated compiler runs produce identical file set, JCS bytes, modes, and bundle digest |
| TS/Go/manifest/typed-fixture agreement | v13 rows, approved supplement, and P2 bundle; no additional Claude behavior claim | all three fixtures plus `bundle-index.json` | **STRUCTURAL GATE** | TS and Go validators return identical allow/deny codes and digests for every positive/mutation row |

No case is GREEN during planning. A generated negative resume fixture is useful for fail-closed
testing but cannot satisfy the positive resumed-session exit row.

### 7.2 Smallest separately approved resume supplement

Phase 3B remains blocked until a separate P3A supplement produces one new conclusion row such as
`CL-P3A-SUPP-RESUME-LINEAGE` with `phase3b_usable: true`. The supplement is not part of this plan
PR and requires its own approval because it executes P3A evidence work.

Minimum supplement scope:

1. Use the already pinned `2.1.215` Darwin arm64 artifact and a new isolated loopback-only session
   state fixture. Persist only typed safe refs and hashes, never raw session state or prompts.
2. Run paired new/resume controls from the same synthetic placeholder transcript, with at least
   two independent safe observers, perturbation control, seeded order, and the existing
   convergence rule.
3. Capture only: root/session/task safe refs, parent/current relation, client/profile generation,
   request class, header-name/value-class summary, request AST topology/digest, SSE event grammar,
   terminal class, retry class, and local process lineage.
4. Prove the resume command actually consumed the prior safe state; a fresh-session fallback,
   nonterminal cell, or inferred absence remains Unknown.
5. Emit a schema-valid, unexpired, contradiction-free conclusion plus refreshed terminal manifest,
   artifact index, leak scan, exit report, and Phase 3B handoff digests. Do not overwrite v13.
6. Preserve all other v13 Unknown rows. The supplement does not authorize restart migration,
   child-process lineage, compact/cache, telemetry/update, provider TLS, or other platforms.

Supplement acceptance command names are future P3A-owned commands, not commands to run in this
planning task:

```bash
npm exec tsx tests/oracle-phase3a-resume-supplement.test.ts
npm exec tsx tests/oracle-phase3a-convergence.test.ts
npm exec tsx tests/oracle-phase3a-r4-terminal.test.ts
npm exec tsx tests/oracle-phase3a-leak-guard.test.ts
```

If this supplement is not separately approved or cannot produce a usable conclusion, Phase 3B
stays BLOCKED. The implementation controller must stop; it may not weaken the exit gate.

## 8. Logical schemas and evidence provenance

All generated JSON is strict I-JSON and RFC 8785 JCS. Unknown fields, duplicate keys, invalid
UTF-8, lone surrogates, negative zero, unsafe integers, floats where integers are required, and
trailing data are rejected. Artifact files contain no wall-clock generation time; evidence issue
and expiry values are copied as source fields so identical inputs regenerate identical bytes.

### 8.1 Input binding

`Phase3BInputBinding.v1` contains exact repository heads/trees, P2 bundle/range/predecessor,
external handoff/exit/terminal/index/leak paths and digests, usable conclusion IDs, claim ceilings,
compiler schema version, and a sorted negative-capability list. Paths are local verification
inputs; generated distributable artifacts retain only safe relative evidence IDs and digests.

### 8.2 Profile artifacts

Every profile object requires:

```text
schema_id, schema_major, schema_revision, artifact_kind, artifact_id
active_target_version, reference_role_version, platform, architecture, installation_mode, entrypoint
evidence_level, evidence_conclusion_ids, evidence_artifact_digests
issued_at_ms, expires_at_ms, contradiction_ids, parser_agreement
contract_digest, manifest_payload_digest, profile_generation
negative_capability_refs, rollback_profile_digest
```

`evidence_level` is one of `Reproduced`, `Observed-local`, `Unknown`, or `Negative`. Only
`Reproduced` safe fields from `phase3b_usable: true` rows may enable a positive local capability.
`Observed-local` may describe a non-authorizing summary. `Unknown` and `Negative` always disable.

### 8.3 Per-field source map

The compiler emits `field-provenance.json`, sorted by JSON Pointer. Every generated leaf has one
entry: `{pointer, evidence_level, source_kind, source_id, source_digest, transform}`. The following
families are exhaustive; adding a leaf without a provenance row is a schema failure.

| Generated field family | Evidence level | Allowed source | Rule |
| --- | --- | --- | --- |
| package/version/artifact/entrypoint digest, Darwin arm64/platform/install mode | `Reproduced` | bound P3A v13 safe artifact identity and usable conclusions' static anchors | exact copy of safe fields; no floating tag |
| build timestamp category, UA and `x-stainless-*` values | `Reproduced` only if present in safe usable projection; otherwise `Unknown` | usable conclusion projection | missing values disable synthesis; never handwritten |
| request method/path/query/header classes/body AST/final-byte digest | `Reproduced` only | the two usable rows' safe projections | exact normalized fields; raw prompt/body forbidden |
| response headers/SSE ordering/partial/complete/error/terminal classes | `Reproduced` | `CL-P3A-R2-FAILURE-STREAM` | no response bytes persisted; typed placeholders only |
| config precedence and placeholder auth lifecycle | `Reproduced` | `CL-P3A-R2-CONFIG-AUTH` | only placeholder credential class; no account or token material |
| control-plane positive telemetry/update | `Unknown`/`Negative` | `CL-P3A-TELEMETRY-UPDATE-UNKNOWN` via v13 negative list | policy is suppress/block locally; no positive route invented |
| transport local loopback behavior | `Observed-local`/`Reproduced` as present | usable local-loopback rows | `provider_tls_equivalent=false`; no provider ClientHello/TLS constants |
| compact/cache lifecycle | `Unknown`/`Negative` | `CL-P3A-COMPACT-CACHE-UNKNOWN` | capability disabled |
| resume/restart/child lineage | `Unknown`/`Negative` until supplement | `CL-P3A-RESUME-LINEAGE-UNKNOWN` | positive resume tuple forbidden |
| Linux/Windows runtime | `Unknown`/`Negative` | `CL-P3A-CROSS-PLATFORM-UNKNOWN` | Darwin arm64 tuple cannot claim cross-platform behavior |
| P2 schema/range/gates/negative semantics | contract fact | P2 bundle digest `254511...` | preserve schema `1:0-0`; do not edit P2 files in place |
| generation/rollback/expiry/contradiction fields | contract fact plus source evidence | P2 authority model and bound handoff rows | monotonic nonnegative generation; exact prior digest; expired/open contradiction denies |
| production/canary/protected sidecar/destination/replay | `Negative` | `RA-P0-009`, `AV-B4/B5/B6`, current deferred runtime state | always disabled in Phase 3B artifacts |

### 8.4 Coherent allowed tuple

`coherent-tuples.json` is a sorted array. A tuple binds the complete set of profile digests,
contract/manifest/input digests, client/profile generations, P2 four-gate results, expiry, negative
manifest digest, rollback target, and fixture digests. A field may not be selected independently
from another tuple. Any missing positive declaration, mixed generation, mismatched platform,
expired evidence, open contradiction, or matching negative rule denies the tuple.

The initial future positive scope is at most:

```text
active target: 2.1.215
platform: darwin
architecture: arm64
installation/source scope: exactly as bound by P3A v13
network: local loopback fake upstream only
auth: synthetic placeholder class only
session: new session only until supplement
response: reproduced bounded local stream/failure classes
```

### 8.5 Negative-capability manifest

`negative-capabilities.json` contains stable IDs, reason, source conclusion/requirement, affected
profile pointers, failure action (`disable` or `rollback`), and expiry/revalidation condition. At
minimum it lists compact/cache, positive telemetry/update, resume/lineage, provider TLS
equivalence, Linux/Windows runtime, incomplete `2.1.214/212/211` pairs, real upstream, real
credentials, profile promotion, production, real canary, protected sidecar authority, replay,
destination enforcement, and direct egress fallback.

Absence is denial. No consumer treats omission as permission.

## 9. Future repository layout and ownership

The implementation controller may refine filenames only through the consolidated review if the
fresh baseline changed. It must preserve these ownership boundaries.

```text
CC Gateway (authoritative source and TS implementation)
  contracts/oracle-lab/profile-synthesis/v1/
    profile.schema.json
    fixture.schema.json
    mutation-corpus.json
    expected-results.json
    generated/
      input-binding.json
      client-build-identity.json
      request-profile.json
      response-stream-profile.json
      control-plane-profile.json
      transport-profile.json
      authentication-profile.json
      session-task-lineage-profile.json
      negative-capabilities.json
      coherent-tuples.json
      cc-gateway-config.json
      sub2api-config.json
      field-provenance.json
      fixtures/new-session-streaming.json
      fixtures/resumed-session-streaming.json
      fixtures/bounded-failure-recovery.json
      fixtures/deterministic-regeneration.json
      bundle-index.json
  tools/oracle-profile/
    compile.ts
    input.ts
    deterministic-writer.ts
    validate.ts
    check-cross-repo.ts
  src/oracle-profile/
    types.ts
    schema.ts
    validator.ts
  tests/oracle-profile-*.test.ts

Sub2API (paired Go validator and byte-identical generated mirror)
  backend/internal/oracleprofile/
    types.go
    validator.go
    validator_test.go
  backend/internal/service/testdata/oracle_profile_contract/v1/
    # byte-identical mirror of the CC contract/generated tree
```

The dedicated Go package prevents focused Phase 3B tests from compiling unrelated
`backend/internal/service` tests. The generated `cc-gateway-config.json` and
`sub2api-config.json` are typed local-conformance
artifacts, not production config files and not automatically loaded. Phase 3B must not modify
`src/index.ts`, `src/proxy.ts`, live Sub2API handlers/services, sidecar server code, deployment
manifests, or the protected keepalive test.

## 10. Dependency DAG and work packages

```text
independent plan review -> plan merge
  -> P3A-S resume supplement approval/execution/review
  -> P3B-0 fresh freeze + target-role decision + input preflight
  -> P3B-1 schemas and RED corpus
  -> P3B-2 deterministic compiler core
      -> P3B-3 profile/provenance/negative tuple synthesis
      -> P3B-4 typed fixtures and generated configs
  -> P3B-5 TS validator/local conformance
  -> P3B-6 paired Sub2API Go validator/mirror
  -> P3B-7 cross-language mutation and deterministic regeneration
  -> P3B-8 consolidated review, exit decision, and handoff
```

No Phase 3B implementation task starts before P3A-S and the version-role decision are green.
P3B-3 and P3B-4 may be developed in parallel only after the compiler's input/output contracts are
green. P3B-6 starts after schemas and expected results freeze; it does not independently edit the
mirror. There is one consolidated review at P3B-8, not a per-task review loop.

### P3B-0: Fresh freeze and preflight

- **Owner:** Phase 3B controller.
- **Inputs:** fresh `muqihang/main` heads, merged plan, P2 bundle, approved resume supplement,
  reviewed version-role decision.
- **Actions:** rebuild CodeGraph with the protected exclusion; verify clean trees and exact external
  digests; validate conclusion usability/expiry/contradictions; run the protected-safe static P2
  joint check plus explicit-file P2 Go tests. The existing CLI's package-wide Go child command is
  not used under this task boundary.
- **RED gate:** a deliberately mutated handoff digest and a non-usable resume row both return stable
  deny codes before any output directory is written.
- **Output:** in-memory preflight decision and safe command result only; no receipt/context/lease.

### P3B-1: Schemas and test-first corpus

- **Owner:** CC Gateway contract owner.
- **Files:** schemas, mutation corpus, expected results, TS schema tests.
- **RED first:** missing provenance, Unknown positive field, omitted negative list, extra field,
  duplicate key, Frankenprofile tuple, and positive resume without supplement fail.
- **Acceptance:** both schema validators enumerate identical stable codes; no compiler yet passes.

### P3B-2: Deterministic compiler core

- **Owner:** Oracle profile compiler owner.
- **Files/symbols:** `compile.ts::compileProfileBundle`, `input.ts::loadBoundInput`,
  `deterministic-writer.ts::writeCanonicalBundle`.
- **Rules:** strict safe input allowlist, JCS, sorted paths/arrays where semantically sets, fixed
  file modes, no clock/random/hostname/absolute output paths, atomic scratch-to-output write,
  content-addressed index, no partial output on failure.
- **Acceptance:** two clean output roots produce byte-identical trees and digest; changing one
  logical leaf changes the expected artifact and index digest only.

### P3B-3: Profile, provenance, negatives, and tuple synthesis

- **Owner:** profile coherence owner.
- **Files:** generated profile objects, field provenance, negative manifest, coherent tuples.
- **Rules:** every leaf has evidence; Unknown/negative fails closed; rollback is independently
  addressable; generations cannot regress; no handwritten upstream-visible value.
- **Acceptance:** new-session tuple can be constructed only from usable safe fields; resume tuple
  requires supplement; all prohibited capability mutations deny.

### P3B-4: Typed fixtures and generated local configs

- **Owner:** fixture owner with CC/Sub2API contract owners.
- **Files:** four fixtures and two generated config projections.
- **Rules:** placeholders such as `SESSION_REF`, `ROOT_TASK_REF`, `ACCOUNT_REF`, `MODEL_NAME`, and
  `VARIABLE_REQUEST_ID`; no raw prompt, credential, account, proxy, response, CCH, ClientHello,
  unrestricted domain, or absolute evidence path.
- **Acceptance:** fixture-to-profile references resolve exactly; body/headers are typed AST/classes,
  not captured raw bytes; generated configs represent the same logical tuple.

### P3B-5: TypeScript validator and local conformance

- **Owner:** CC Gateway validator owner.
- **Symbols:** `validateProfileBundle`, `validateTypedFixture`, `decideLocalConformance`.
- **Harness:** reuse the loopback fake-upstream pattern without importing raw P3A evidence.
- **Cases:** new streaming, resumed streaming, bounded failure/reset/partial/complete sequence,
  malformed SSE, deadline/terminal/retry ownership, negative capability, rollback and expiry.
- **Boundary:** validates generated artifacts only; never calls live request construction or DNS.

### P3B-6: Sub2API paired Go validator and mirror

- **Owner:** Sub2API Go contract owner.
- **Package/symbols:** `internal/oracleprofile`; `ValidateOracleProfileBundle`, `ValidateOracleTypedFixture`,
  `DecideOracleLocalConformance`.
- **Rules:** use current `CanonicalizeOracleJSON` and P2 types; do not create a second serializer;
  mirror is synchronized from CC and fails if independently edited.
- **Acceptance:** Go returns the same digest and stable decision code as TS for every row. This work
  requires a paired Sub2API implementation PR; Sub2API cannot remain unchanged at Phase 3B exit.

### P3B-7: Mutation, regeneration, and cross-repository gate

- **Owner:** cross-project contract owner.
- **Actions:** run full mutation corpus through TS, Go, manifest, fixture, and index validators;
  regenerate twice under different temp roots, timezone/locale, umask, and file enumeration order;
  compare file list, bytes, modes, and digest.
- **Acceptance:** zero disagreement, zero unproven generated leaf, zero leak canary, exact mirror.

### P3B-8: One consolidated review and handoff

- **Reviewers:** independent profile/compiler reviewer, Sub2API contract reviewer, security reviewer.
- **Review once:** schemas, sources, generated semantic diff, mutation results, determinism,
  cross-language agreement, negative list, rollback, expiry, and protected-path inventory.
- **Exit:** GREEN only if all five Section 7.1 cases, including positive resumed session, pass and
  the version-role decision is resolved. Otherwise publish a precise BLOCKED handoff.
- **Handoff:** safe digests, heads/trees, commands/results, generated bundle digest, negative list,
  rollback target, expiry, contradiction state, remaining runtime non-goals, and next Phase 4 gate.
  No P1 receipt/context/lease/Recovery machinery is created.

## 11. Mutation corpus

The future corpus is table-driven and every mutation changes one dimension at a time:

1. input path escape, symlink, digest mismatch, wrong artifact index/terminal/leak pairing;
2. floating package tag, wrong active/reference version, `2.1.207`/`2.1.215` evidence relabel;
3. missing, false, unknown, expired, contradicted, parser-disagreeing, or non-usable conclusion;
4. duplicate JSON key, invalid UTF-8, lone surrogate, negative zero, unsafe integer, trailing data,
   unknown field, enum extension, unordered set, and oversized object;
5. missing field-provenance row, source digest mismatch, illegal evidence level, handwritten
   upstream-visible UA/header/body/transport constant;
6. missing negative capability, negative match, absent positive declaration, unsupported
   platform/auth/entrypoint, positive telemetry/update, compact/cache, provider TLS, Linux/Windows;
7. positive resume without supplement, fresh-session fallback mislabeled resume, lineage parent/root
   mismatch, stale migration sequence, generation regression;
8. mixed request/response/auth/transport profile refs, profile/manifest/contract mismatch,
   Frankenprofile tuple, stale fixture digest;
9. expired manifest, open contradiction, invalidated dependency, missing rollback target, rollback
   below floor, revoked target, parent/checkpoint mismatch;
10. SSE missing start/stop, duplicated/reordered event, malformed JSON, reset before first byte,
    partial visible output, terminal error, retry after partial output, wrong retry owner;
11. raw prompt/credential/account/proxy/response/CCH/ClientHello and representative secret-canary
    strings in any generated file or diagnostic;
12. different temp root, locale, timezone, wall clock, file order, umask, and repeated generation;
13. one-byte CC/Sub2API mirror drift, TS/Go decision disagreement, manifest/fixture digest mismatch;
14. attempts to enable real upstream, real credentials, profile promotion, protected runtime,
    deployment, production, canary, Phase 4/6A behavior, or direct egress fallback.

Positive cases are not weakened to make mutations pass. Stable error codes are part of
`expected-results.json`.

## 12. Exact future command ladder

Paths are environment variables so the controller can use fresh roots:

```bash
export CC_GATEWAY_ROOT=/absolute/fresh/cc-gateway
export SUB2API_ROOT=/absolute/fresh/sub2api
export P3A_ROOT=/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A
: "${P3A_RESUME_HANDOFF:?set to the separately approved resume-supplement handoff path}"
: "${P3A_RESUME_HANDOFF_SHA256:?set to its independently reviewed SHA-256}"

# Freshness and immutable inputs
git -C "$CC_GATEWAY_ROOT" fetch muqihang main --prune
git -C "$SUB2API_ROOT" fetch muqihang main --prune
git -C "$CC_GATEWAY_ROOT" status --short --branch
git -C "$SUB2API_ROOT" status --short --branch
/Users/muqihang/.local/bin/codegraph index "$CC_GATEWAY_ROOT"
/Users/muqihang/.local/bin/codegraph index "$SUB2API_ROOT"
/Users/muqihang/.local/bin/codegraph status "$CC_GATEWAY_ROOT"
/Users/muqihang/.local/bin/codegraph status "$SUB2API_ROOT"
shasum -a 256 "$P3A_ROOT/capsules/P3A-4/phase-3b-3.5-handoff-v13.json"
test "$(shasum -a 256 "$P3A_RESUME_HANDOFF" | awk '{print $1}')" = \
  "$P3A_RESUME_HANDOFF_SHA256"

# Unchanged P2 gate
cd "$CC_GATEWAY_ROOT"
npm ci
node --import tsx --input-type=module -e "import { checkCrossRepoContract } from './tools/oracle-contract/check-cross-repo.ts'; console.log(JSON.stringify(checkCrossRepoContract({ccGatewayRoot:process.cwd(),sub2apiRoot:process.env.SUB2API_ROOT,runCommands:false})))"
npm exec tsx tests/oracle-contract-canonical.test.ts
npm exec tsx tests/oracle-contract-admission.test.ts
npm exec tsx tests/oracle-contract-manifest-authority.test.ts
npm exec tsx tests/oracle-contract-cross-project.test.ts
cd "$SUB2API_ROOT/backend/internal/service"
go test oracle_contract_canonical.go oracle_contract_types.go \
  oracle_contract_admission.go oracle_contract_authority.go \
  oracle_contract_cross_project.go oracle_contract_canonical_test.go \
  oracle_contract_admission_test.go oracle_contract_authority_test.go \
  oracle_contract_cross_project_test.go \
  -run 'TestOracleContract(Canonical|Admission|Authority|CrossProject)$' -count=1

# RED then GREEN schema/compiler/validator gates
npm exec tsx tests/oracle-profile-input.test.ts
npm exec tsx tests/oracle-profile-schema.test.ts
npm exec tsx tests/oracle-profile-compiler.test.ts
npm exec tsx tests/oracle-profile-provenance.test.ts
npm exec tsx tests/oracle-profile-negative-capability.test.ts
npm exec tsx tests/oracle-profile-fixture.test.ts
npm exec tsx tests/oracle-profile-local-conformance.test.ts
npm exec tsx tests/oracle-profile-mutation.test.ts

cd "$SUB2API_ROOT/backend"
go test ./internal/oracleprofile -run '^TestOracleProfile' -count=1

# Deterministic generation and exact cross-project agreement
cd "$CC_GATEWAY_ROOT"
npm exec tsx tools/oracle-profile/compile.ts -- \
  --base-handoff "$P3A_ROOT/capsules/P3A-4/phase-3b-3.5-handoff-v13.json" \
  --resume-supplement "$P3A_RESUME_HANDOFF" \
  --out /tmp/oracle-profile-a
TZ=Asia/Shanghai LANG=C LC_ALL=C npm exec tsx tools/oracle-profile/compile.ts -- \
  --base-handoff "$P3A_ROOT/capsules/P3A-4/phase-3b-3.5-handoff-v13.json" \
  --resume-supplement "$P3A_RESUME_HANDOFF" \
  --out /tmp/oracle-profile-b
diff -ru /tmp/oracle-profile-a /tmp/oracle-profile-b
npm exec tsx tools/oracle-profile/check-cross-repo.ts -- \
  --cc-gateway-root "$CC_GATEWAY_ROOT" --sub2api-root "$SUB2API_ROOT" --check

# Leak and forbidden-scope checks over generated files only
! rg -n -i 'sk-ant-|authorization:|refresh[_-]?token|clienthello|raw_prompt|raw_response' \
  contracts/oracle-lab/profile-synthesis/v1/generated \
  "$SUB2API_ROOT/backend/internal/service/testdata/oracle_profile_contract/v1"
```

`/tmp/oracle-profile-*` are disposable execution outputs, but deletion still follows the active
operator safety policy. Phase 3B ordinary tasks run focused tests only. Full product suites are a
final integration decision after focused gates, and no test command may include the protected
keepalive test.

## 13. Acceptance criteria and stop rules

Phase 3B may exit GREEN only when all are true:

1. fresh heads/trees and CodeGraph stats are recorded; protected path remains untouched;
2. P2 bundle/predecessor/range and all external handoff digests match;
3. every generated leaf has evidence level/source and every Unknown is explicit/fail closed;
4. all logical profiles, negative capabilities, coherent tuple, generated configs, typed fixtures,
   TS validator, Go validator, manifest, and index agree exactly;
5. new-session streaming, positive resumed-session streaming, and bounded failure/recovery pass
   local loopback conformance;
6. two isolated generations are byte-identical and have the same digest;
7. rollback/version/generation/expiry/contradiction mutations fail with stable codes;
8. leak scan and forbidden raw-material canaries find zero generated leaks;
9. the independent consolidated review has no Critical or Important finding;
10. no promotion, production, upstream, credential, canary, deployment, or runtime claim is made.

True blockers are limited to: missing/expired/contradicted usable evidence, resume supplement
failure, unresolved version-role authority, P2 contract mismatch, TS/Go standard disagreement,
non-deterministic output after root-cause isolation, or inability to keep raw material out of
artifacts. On a true blocker, stop and publish the exact deny code/input digest. Test failure,
ordinary implementation difficulty, or a review comment is not permission to broaden scope or
loop indefinitely.

## 14. Resource and time estimate

| Work | Primary owner | Estimate | Parallelism |
| --- | --- | ---: | --- |
| P3A resume supplement | P3A evidence owner + reviewer | 2-4 engineer-days plus convergence runtime | must finish first |
| P3B-0/1 freeze, schemas, RED corpus | controller + contract owner | 2 days | sequential entry |
| P3B-2 compiler core | TS compiler owner | 2-3 days | precedes synthesis |
| P3B-3/4 profiles, provenance, fixtures/configs | profile + fixture owners | 3-4 days | parallel after compiler contract |
| P3B-5 TS conformance | TS validator owner | 2 days | after generated schema |
| P3B-6 Go validator/mirror | Sub2API owner | 2-3 days | parallel with TS after schema freeze |
| P3B-7 mutation/determinism | cross-project owner | 2 days | after TS/Go |
| P3B-8 consolidated review/handoff | three reviewers + controller | 1-2 days | single review point |

Expected Phase 3B implementation effort after unblock is 14-18 engineer-days, excluding queue
time. Evidence storage should remain small because Phase 3B persists only canonical generated
artifacts and typed fixtures; no raw P3A evidence is duplicated.

## 15. Handoff contract

The future Phase 3B handoff includes:

- exact merged CC/Sub2API heads and trees;
- P2 contract/predecessor/range and external P3A/supplement digests;
- generated bundle index and aggregate digest;
- file-by-file digests for all profile/config/provenance/negative/tuple/fixture artifacts;
- TS/Go/manifest/fixture decision matrix and mutation results;
- deterministic regeneration comparison;
- rollback target, policy/profile generation, evidence expiry, contradiction state;
- remaining negative capabilities and explicit Phase 4/6A non-goals;
- exact focused commands and result summary;
- protected-file untouched assertion and changed-file inventory.

The next step after this plan PR is a fresh independent plan reviewer. Only after plan merge,
resume supplement approval/completion, and version-role resolution may a new Phase 3B execution
controller begin P3B-0. That controller starts from fresh mains and this handoff; it does not rely
on stale P3A/P1 chat context.

## 16. Planning self-checks

This planning task runs only document/baseline checks:

```bash
test -s docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3b-profile-synthesis.md
! rg -n 'TO[D]O|TB[D]|FIXM[E]|PLACEHOLDE[R]|@lates[t]' \
  docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3b-profile-synthesis.md
rg -n 'RA-P0-001|RA-P0-002|RA-P0-005|RA-P0-007|RA-P0-009|RA-P1-002|RA-P1-003|RA-P1-004|RA-P1-007' \
  docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3b-profile-synthesis.md
rg -n 'BLOCKED|CL-P3A-RESUME-LINEAGE-UNKNOWN|phase3b_usable' \
  docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3b-profile-synthesis.md
git diff --check
git diff --name-only
```

The expected planning diff is exactly this plan document. No Phase 3B implementation has started.
