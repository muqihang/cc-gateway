# Claude Code 2.1.207 Phase 1 Control-Plane Boundary Repairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close B1-B3 and the complete local Phase 1 `RA-P0-008` deployment boundary with server-side authority, deterministic failures, always-on H1 fixtures, and no expansion into Phase 2 contracts or Phase 4 runtime controls.

**Architecture:** Sub2API remains the durable authority. Its admin guard resolves a principal from server-side user state before the compliance oracle, the handler injects that typed request authority into the service context, and a separate narrow service dependency revalidates current status, role, token version, and JWT expiry after static owner comparison and immediately before version/state/CAS work. Every onboarding mutation checks owner dimensions plus an expected version. Mutations with external effects acquire a CAS-backed single-operation reservation before the first dependency call, then finalize from that reservation without retrying unknown outcomes. Browser egress uses the existing public nonce/IP/proxy verifier, followed by a single-use server proof finalization; absolute browser URLs come only from configured public origin. CC Gateway resolves its deployment boundary before creating a socket: omitted host becomes `127.0.0.1`, non-loopback binds require an explicit capability, inbound TLS, strong authentication, and a code-approved exposure-policy reference, while real upstream modes require HTTPS, system trust, explicit certificate verification, and rejection of unsafe trust-environment overrides. The sidecar keeps `InsecureSkipVerify` confined to explicit loopback test overrides and proves production verification structurally.

**Tech Stack:** Go 1.26, Gin, Testify, TypeScript, Node.js 24, Vue 3, Vitest, Node `http`/`https`/`net`, Ajv 2020, CodeGraph 1.1.6, existing Oracle Lab H0 command/result schemas.

## Global Constraints

- Governing precedence is exact: `review_amendments > hardening_amendments > adversarial_validation_v2 > oracle_lab_design`.
- Phase 1 owns exactly `AV-B1-001`, `AV-B2-001`, `AV-B3-001`, and the full local-structural closure of `RA-P0-008` (`WP-R8:phase_1_loopback_remote_tls_guard`), including upstream certificate verification. This does not create remote-deployment or production authority.
- Phase 1 must not change the shared contract at `backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json` (`sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1`).
- CC formal-pool contract discovery uses a separate clean read-only Sub2API Git clone whose checked-out branch is exactly `main`; it is not a linked worktree, never uses the operator's dirty main, and never uses a non-main implementation worktree. Its origin-URL digest, HEAD/root/branch/clean-status/contract digest are bound as `SUB2API_CONTRACT_ROOT` evidence and must match the applicable frozen remote main. Create or refresh this clone before any CC full-suite validation or capture and never during a sandboxed command. GREEN full-suite commands bind only the exact contract file through `SUB2API_FORMAL_POOL_CONTRACT_PATH`; they do not substitute this clone for the tested Sub2API implementation root. The capture envelope still binds the tested Sub2API implementation root, while the `cc-tests` and `cc-tests-repeat` child environments omit `SUB2API_ROOT` so the existing resolver derives and validates the independent `main` clone from the dedicated file path. The preserved CC RED row alone may override `SUB2API_ROOT` with the clone root because its existing resolver requires a `main` repository root before registering RED leaves.
- B4-B6 remain expected RED and owned by later phases. The CC and sidecar RED commands must still exit nonzero with the command-specific canonical failing-leaf inventories and exact counts frozen in Task 7; failure-family tokens are derived secondary summaries, not sufficient acceptance evidence.
- `real_upstream_access`, `real_credentials`, `profile_promotion`, `production_deployment`, `real_canary`, `unrestricted_capture`, and `external_network_requests` remain disabled.
- Tests use loopback, `httptest`, fake resolvers, and mock upstreams only. No command in this plan may contact a real provider or public host.
- Authorization denials occur before state/version/dependency evaluation and use one stable 401 class plus one stable 403 class, without revealing which owner dimension mismatched.
- Missing or malformed `If-Match` on an onboarding mutation returns `428 FORMAL_POOL_ONBOARDING_VERSION_REQUIRED`; a stale version reuses the existing `409 FORMAL_POOL_ONBOARDING_VERSION_CONFLICT`.
- `AttestBrowserEgress` is the sole ordering exception after authentication and owner authorization. Its exact order is: `context -> record -> static owner -> service-level principal revalidation -> consumed-proof replay -> expected-version -> allowed-state -> remaining-proof-validation -> CAS`. An exact replay of the persisted consumed-proof safe digest returns `FORMAL_POOL_BROWSER_PROOF_REJECTED` with either the old or current version; cross-owner requests still return the common 403 first, revoked/expired/inactive or role-lost owners receive the common 401/403 before replay classification, and nonmatching proofs do not bypass version/state checks.
- The principal guard and service revalidator are intentionally distinct authority checks. The guard's single `Resolve` is the pre-compliance authorization oracle; it does not satisfy reservation-adjacent current-authority revalidation. No `FormalPoolOnboardingHandler` business method or constructor parses credentials or stores or calls either interface; the separate guard middleware owns the resolver call. The service receives only the typed principal plus a narrow `FormalPoolOnboardingPrincipalRevalidator` and must fail closed when that dependency is absent.
- Any mutation that can call OAuth, account persistence, refresh, CC Gateway, healthcheck, cache, or scheduler dependencies must first acquire a CAS reservation. A concurrent request with the same version fails before a second dependency call; an ambiguous external outcome becomes `operation_outcome_unknown` and is never automatically retried.
- Public browser-check responses remain enumeration-resistant and do not distinguish unknown, expired, replayed, mismatched, or cross-session nonces in their response body.
- Listener and upstream negative integration must invoke `startProxy` directly and observe zero TLS-read, server-create, and listen effects; calling a pure resolver before `startProxy` is not startup-order evidence.
- Every non-public onboarding route is exercised against the complete executable caller/session matrix from hardening Section 8.3. Coverage is route-by-dimension, not one route per dimension; revoked/expired sessions, ordinary users, group and tenant administrators, service callers, stale tabs, concurrent role changes, and duplicated callbacks are explicit cases.
- Phase 1 RED evidence is accepted only when the runner-specific parser completes without ambiguity, emits no duplicate leaf, and its canonical UTF-8-byte-sorted failing-leaf names, exact count, and derived family set all equal the command-specific catalog constants. A nonzero exit alone, a missing leaf, an added same-prefix leaf, a duplicate, a persisted-order violation, an unparsed leaf, a count mismatch, or any forged persisted field is always `unexpected_fail`. Raw runner event order is deliberately not authoritative: permutations canonicalize to the same exact inventory.
- Every H1 command runs inside a reviewed OS-enforced loopback-only network sandbox. Proxy variables are defense in depth, not the sandbox. Missing enforcement, a failed public-socket denial canary, or any observed non-loopback DNS/socket violation fails before evidence is written.
- The final Phase 1 handoff is never minted from feature branches. Both implementation PRs must first merge. Post-integration uses one CC evidence/controller worktree whose HEAD remains the exact fetched CC main plus two distinct clean tested roots (detached CC integrated main and Sub2API integrated main); the uncommitted integration entry exists only in the controller root. This preserves clean capture inputs and lets the eventual artifact commit retain the exact integrated CC main as its parent.
- Never commit changes from the operator-owned `backend/internal/service/openai_compact_sse_keepalive_test.go` working copy. Implementation uses a clean Sub2API worktree from `muqihang/main`.
- Before each task, run `codegraph status`; if stale, run `codegraph sync`. Use CodeGraph before locating or reading code.
- The planning entry/context expires at `2026-07-16T08:56:22Z` and is planning provenance only. Before any implementation edit, create and validate the sequence-zero `phase-1-execution-context.json` against schema version 2 of `oracle-lab-phase-1-execution-context.schema.json`; it must bind the exact merged plan digest/commit and an independent approval receipt with zero Critical/Important findings.
- Execution-context freshness is a renewable task-boundary lease, not permission to overwrite history. Sequence zero is immutable; each renewal adds `phase-1-execution-context-0001.json`, then the next contiguous four-digit path. A successor is issued only when both implementation roots are clean, before a new task or feature capture starts. If a lease expires mid-task, finish only the already-started task to a clean checkpoint commit; no next task or evidence capture starts until a successor is validated and committed.
- Feature capture must select the unique latest contiguous context chain head. Post-integration capture does not create another successor stage: `build-integration-entry` seals the latest feature context chain, and the resulting integration entry becomes the sole post-integration stage authority.
- Each repository uses its own branch and worktree: `codex/oracle-phase-1-sub2api` and `codex/oracle-phase-1-cc-gateway`. Do not mix commits across repositories.

---

## File Map

### Sub2API

- Create `backend/internal/service/formal_pool_onboarding_authorization.go`: typed principal/request authority, owner comparison, state/version ordering, CAS operation reservations, and stable errors.
- Create `backend/internal/service/formal_pool_onboarding_authorization_test.go`: authority ordering and version unit tests.
- Create `backend/internal/handler/admin/formal_pool_onboarding_principal.go`: server-side principal resolver, narrow service-level principal revalidator adapter, and `If-Match` parser.
- Modify `backend/internal/server/middleware/auth_subject.go` and `jwt_auth.go`: retain only safe JWT expiry/token-version/auth-method claims for downstream revalidation.
- Modify `backend/internal/server/router.go` and `backend/internal/server/routes/admin.go`: keep the same onboarding URLs but move only that route group from broad `adminAuth` to JWT auth plus the onboarding principal gate while preserving `AdminComplianceGuard` after principal authorization.
- Modify `backend/internal/service/formal_pool_onboarding_store.go`: owner envelope, proof lifecycle, account lookup, active-operation reservation, and CAS-only mutations.
- Modify `backend/internal/service/formal_pool_onboarding_service.go`: authority enforcement, response version, B1 two-step verification/finalization.
- Modify `backend/internal/handler/admin/formal_pool_onboarding_handler.go`: inject authority for every admin route and stop request-derived origin construction.
- Modify `backend/internal/handler/wire.go`: register separate production interface providers for the guard resolver and service revalidator; inject neither into the onboarding handler.
- Regenerate `backend/cmd/server/wire_gen.go`: commit the deterministic Wire graph after provider and router signature changes.
- Modify `backend/internal/config/config.go`: `authority_tenant_id` and `public_origin` configuration.
- Modify `backend/internal/service/formal_pool_config.go` and `backend/internal/service/wire.go`: normalize public origin and wire it into onboarding service.
- Modify `deploy/config.example.yaml`: document explicit tenant and public origin.
- Modify `backend/internal/service/formal_pool_onboarding_phase0_red_test.go`: make B1 corpus always-on and server-verification-aware.
- Modify `backend/internal/server/routes/formal_pool_onboarding_phase0_red_test.go`: make B2/B3 corpus always-on and use a fake server-side principal resolver.
- Modify `backend/internal/service/formal_pool_onboarding_service_test.go`, `backend/internal/service/formal_pool_onboarding_store_test.go`, `backend/internal/service/formal_pool_onboarding_flow_test.go`, `backend/internal/server/routes/formal_pool_onboarding_routes_test.go`, and `backend/internal/handler/formal_pool_onboarding_provider_test.go`: migrate existing fixtures to authority/version semantics.
- Modify `frontend/src/api/admin/claudeOnboarding.ts`: expose `version` on every mutation result and send `If-Match` on mutations.
- Modify `frontend/src/composables/useEgressCheckPolling.ts`: preserve the newest version during polling.
- Modify `frontend/src/components/account/ClaudeFormalPoolOnboardingWizard.vue` and `frontend/src/components/account/ClaudeFormalPoolOnboardingWizardV2.vue`: remove client-chosen confirmation and finalize the server-observed proof once.
- Modify `frontend/src/composables/__tests__/useEgressCheckPolling.spec.ts` and `frontend/src/components/account/__tests__/ClaudeFormalPoolOnboardingWizardV2.spec.ts`: version and one-shot-finalization tests.

### CC Gateway

- Create `src/listener-boundary.ts`: pure listener classification and fail-closed prerequisite validation.
- Create `src/upstream-tls-boundary.ts`: real-mode HTTPS/system-trust verification and unsafe environment rejection.
- Modify `src/config.ts`: typed remote-listen policy and validation call.
- Modify `src/proxy.ts`: bind only the resolved host.
- Modify `config.example.yaml` and `config.sub2api.formal-pool.example.yaml`: loopback default and explicit remote-listen example.
- Create `tests/listener-boundary.test.ts`: configuration corpus plus observed socket bind tests.
- Create `tests/upstream-tls-boundary.test.ts`: direct-egress verification, unsafe trust environment, and approved-policy corpus.
- Modify `tests/security-boundary.test.ts` and `tests/helpers.ts`: shared safe fixtures and regression assertions.
- Modify `sidecar/egress-tls-sidecar/cmd/egress-tls-sidecar/main.go` and its tests: reject production trust-store overrides before listen.
- Modify `sidecar/egress-tls-sidecar/internal/tlsengine/utls_engine.go` and its tests: construct verified production TLS config and confine insecure verification to explicit loopback test overrides.

### H1 Evidence

- Consume schema version 2 of `docs/superpowers/schemas/oracle-lab-phase-1-execution-context.schema.json` and the conditional `oracle-lab-phase-1-plan-review.schema.json`, which are delivered with this reviewed plan.
- Create `docs/superpowers/evidence/phase-1/phase-1-plan-review.json` and sequence-zero `phase-1-execution-context.json` before implementation; later renewals add immutable numbered successors. They are authorization inputs, not implementation evidence.
- Create `docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json`: exact GREEN and preserved-RED commands, including the two normative parser lifecycles, canonical failing-leaf arrays, and counts frozen in Task 7.
- Create `docs/superpowers/schemas/oracle-lab-phase-1-command-catalog.schema.json`, `oracle-lab-phase-1-exit.schema.json`, `oracle-lab-phase-1-results.schema.json`, `oracle-lab-phase-1-feature-review.schema.json`, `oracle-lab-phase-1-handoff.schema.json`, `oracle-lab-phase-1-integration-entry.schema.json`, and `oracle-lab-phase-1-integration-receipt.schema.json`: closed Phase 1 evidence contracts.
- Create `tools/oracle-lab/phase-1-evidence.ts`: a small Phase 1 adapter over the reviewed `runBoundedProcess`, hermetic environment, safe artifact writer, and digest helpers already delivered by H0/P0.1.
- Create `tools/oracle-lab/phase-1-loopback-sandbox.ts`: fail-closed OS sandbox selection, loopback/public-socket canaries, wrapped argv, policy/binary digests, and violation classification.
- Create `tests/oracle-lab-phase-1-evidence.test.ts`: schema, binding, dirty-tree, RED leaf-inventory metamorphic cases, unexpected-result, unsafe-output, ancestry, and handoff tests.
- Modify `package.json`: add only `oracle:phase1` for the new adapter; do not alter Phase 0/P0.1 scripts.
- Create feature-candidate evidence and the closed `phase-1-feature-review.json` first. Task 8 post-merge artifacts live under one immutable `docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/` namespace, beginning with `attempt-0001`; retries never overwrite or reuse an earlier attempt.
- Modify `docs/superpowers/registry/oracle-lab-requirements.json`, `docs/superpowers/registry/oracle-lab-claims.json`, and `docs/superpowers/registry/oracle-lab-current-observations.json` only after all exit commands pass.

## Dependency Order

```text
Mandatory Preflight -> Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5
Task 6 is independent after Mandatory Preflight
Task 5 + Task 6 -> Task 7 -> Task 8 feature capture/review -> merge both implementation PRs -> Task 8 post-integration capture/receipt
```

## Mandatory Preflight: Bind Plan Approval Before Editing

**Files:**
- Create: `docs/superpowers/evidence/phase-1/phase-1-plan-review.json`
- Create: `docs/superpowers/evidence/phase-1/phase-1-execution-context.json`
- Consume: `docs/superpowers/schemas/oracle-lab-phase-1-execution-context.schema.json`
- Consume: `docs/superpowers/schemas/oracle-lab-phase-1-plan-review.schema.json`
- Consume: `docs/superpowers/plans/2026-07-15-claude-code-2.1.207-phase-1-control-plane-boundary-repairs.md`

- [ ] **Step 1: Start both implementation worktrees from current `muqihang/main` and sync CodeGraph**

Fetch `muqihang/main` in both repositories without rebasing or rewriting history. Create the exact branches named in Global Constraints. Run `codegraph sync` and `codegraph status` in both worktrees. Record clean baseline main heads; if either local main differs from `muqihang/main`, stop and reconcile through a reviewed merge before continuing. Create or refresh the independent `SUB2API_CONTRACT_ROOT` clone at the frozen Sub2API remote main before any full CC regression. Every Mandatory Preflight `npm test` run starts from `env -i` with the exact closed full-suite environment defined by Task 7 and sets `SUB2API_FORMAL_POOL_CONTRACT_PATH=${SUB2API_CONTRACT_ROOT}/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json`; a bare run that inherits host state or falls back to a deterministic sibling is not admissible preflight evidence.

- [ ] **Step 2: Independently review the exact merged plan bytes**

The reviewer must inspect the merged plan commit, current authority documents, and current code anchors. The review is holistic, not limited to the latest patch: under `harness_and_evidence_bindings`, explicitly audit the complete acceptance truth table across catalog schema, TAP/Go lifecycle parsing, capture classification, results schema/semantic validation, integration-entry, handoff/report, pre/post-commit receipt binding, and every missing/extra-same-prefix/duplicate-event/raw-permutation/persisted-multiset-or-unique-permutation/event-or-unique-count/family/parser/lifecycle mutation. On the exact frozen roots, rerun both machine-readable RED commands and independently compare their lifecycle summaries, event/unique counts, canonical name digests, and families to the normative JSON before approval. Each blocked round is retained in the controller's external decision package as closed JSON using the plan-review schema and `changes_requested` with at least one Critical or Important finding; blocked-round files are not written into the implementation worktree and cannot authorize an execution context. Only the final zero-Critical/zero-Important round is written once to the authoritative `phase-1-plan-review.json` path with `approved`. A review of an earlier commit or different plan digest is invalid.

- [ ] **Step 3: Build the fresh execution context**

Create schema-v2 sequence zero at `phase-1-execution-context.json`. Set `context_mode: initial`, `sequence: 0`, `stage: implementation_entry`, the exact `artifact_path`, and `predecessor: null`. Its window is greater than zero and no more than 24 hours. Bind the exact plan path/digest/reviewed commit, exact planning entry/context bytes as provenance, the approved review artifact digest, authority precedence bytes, unchanged shared-contract digest, selected requirement IDs, disabled capabilities, and all nine authorization conditions from the closed schema. Bind `gate_schemas.execution_context` to `docs/superpowers/schemas/oracle-lab-phase-1-execution-context.schema.json` at `sha256:5c0f18f3614b30fe82907a74746b1ce2ed7887868bfed1854715297c8e445086` and `gate_schemas.plan_review` to `docs/superpowers/schemas/oracle-lab-phase-1-plan-review.schema.json` at `sha256:9c4262da2cc8620f6297ecdaacb39c6741fdaba3564a4c795da3d5149abab65a`. The planning test also hard-codes those two digests outside either mutable schema, verifies them before schema compilation, and compares working, reviewed-plan-commit, and observed-remote bytes; a context cannot authorize a schema that was loosened by an implementation commit. For each repository bind immutable `baseline_main_head`, pre-commit `authorized_parent_head`, freshly fetched `observed_remote_main_head`, branch/ref, the clean pre-issue fact, and the exact live validation-status entries/digest. Also bind `remote_name: muqihang` and SHA-256 of the reviewed-Git UTF-8 `git remote get-url muqihang` output after removing its command terminator (no surrounding shell text): `sha256:52de8ee497a784b90b33345865754f3e6b9d5d96eed92549a15a4157cabb568a` for exact URL `https://github.com/muqihang/cc-gateway.git` and `sha256:22c1a9e3cf8e76d2a20bf24a1ff66fa5d7417ba8b8b83a948c8b3ffa5c33a1a9` for exact URL `https://github.com/muqihang/sub2api.git`. Initial CC validation status is exactly the untracked plan review plus this context; Sub2API status is empty. These fields are claims until Step 4 verifies them against live reviewed-Git observations.

- [ ] **Step 4: Validate the authorization artifact before implementation**

Run: `PHASE1_REQUIRE_EXECUTION_CONTEXT=1 PHASE1_EXECUTION_CONTEXT_GATE=pre-commit PHASE1_EXECUTION_CONTEXT_MODE=initial PHASE1_EXECUTION_CONTEXT_PATH=docs/superpowers/evidence/phase-1/phase-1-execution-context.json SUB2API_ROOT=${SUB2API_ROOT} npm exec tsx tests/oracle-lab-phase-1-planning.test.ts`

Expected: PASS. Every Git query uses `runReviewedGit`, which selects a reviewed absolute Git executable, supplies the hermetic Git environment, and calls `assertNoGitReplacementRefs`; raw `git`/`execFileSync` is forbidden in this gate. The semantic check parses the review receipt, compares every duplicated approval field, hashes `git show <reviewed_commit>:<plan.path>`, and requires those committed bytes, current plan bytes, context digest, and review receipt digest to agree. It rejects a `generated_at` more than five minutes beyond the observed clock skew, requires the live time to precede `expires_at`, and hashes the Sub2API shared-contract bytes live from both the implementation root and freshly fetched remote-main commit. It also proves the exact authority path order and bytes, exact planning-provenance paths, initial baseline/authorized/observed-remote heads all equal freshly fetched `muqihang/main`, current branches are exactly `codex/oracle-phase-1-cc-gateway` and `codex/oracle-phase-1-sub2api`, CC status contains only the two declared untracked preflight artifacts, Sub2API status is empty, and Critical/Important counts are zero. Any mismatch leaves implementation blocked.

- [ ] **Step 5: Commit authorization provenance as the first CC Gateway Phase 1 commit**

```bash
git add docs/superpowers/evidence/phase-1/phase-1-plan-review.json docs/superpowers/evidence/phase-1/phase-1-execution-context.json
git commit -m "docs(oracle): authorize exact Phase 1 plan bytes"
PHASE1_REQUIRE_EXECUTION_CONTEXT=1 PHASE1_EXECUTION_CONTEXT_GATE=post-commit PHASE1_EXECUTION_CONTEXT_MODE=initial PHASE1_EXECUTION_CONTEXT_PATH=docs/superpowers/evidence/phase-1/phase-1-execution-context.json SUB2API_ROOT=${SUB2API_ROOT} npm exec tsx tests/oracle-lab-phase-1-planning.test.ts
```

No Sub2API or runtime source file may change before this commit. Record the resulting CC commit as `PHASE1_CONTEXT_COMMIT_0000`; its sole parent must be the context's CC `authorized_parent_head`, and its exact delta adds only the approved plan review plus sequence-zero context. The `post-commit` gate derives that commit without self-reference, requires both worktrees clean, verifies both committed artifact digests with `git show`, rejects symlinks, and requires the Sub2API HEAD to remain the bound authorized parent. Task 1 remains blocked until both the pre-commit and post-commit commands pass.

### Execution Context Renewal State Machine

Renewal never repeats or overwrites Steps 1-4. It reuses the exact approved plan review and creates the next immutable successor only at a clean task boundary or immediately before feature capture:

1. Enumerate only `phase-1-execution-context.json` plus `phase-1-execution-context-[0-9]{4}.json`; reject symlinks, alternate spellings, duplicate sequence, missing sequence, more than one sequence zero, or any path not matching its numeric sequence.
2. Validate every artifact under schema version 2. The unique latest contiguous context chain head is the highest sequence, never lexical order or mtime. Every successor has `context_mode: successor`, stage `implementation` or `feature_capture`, and a predecessor binding containing exact path, raw-byte digest, previous sequence/stage, and predecessor artifact commit.
3. Prove the predecessor artifact commit is an ancestor of the new CC `authorized_parent_head`, `git show` contains the exact predecessor bytes, the predecessor path was introduced by that commit and has not changed afterward, and the predecessor commit's sole parent/delta match its own context rules. The new successor commit must later have sole parent equal to its `authorized_parent_head` and add exactly its one numbered context path. This derived commit check closes the context self-reference without putting the new commit hash inside its own bytes.
4. Keep both `baseline_main_head` values, remote names/refs/URL digests, implementation branches, and both `gate_schemas` bindings immutable across the chain. Bind current clean feature heads as `authorized_parent_head`; bind freshly fetched refs separately as `observed_remote_main_head`. Initial mode requires each repository's `authorized_parent_head == baseline_main_head == observed_remote_main_head`, and CC must also equal the reviewed plan commit. Every successor requires the previous CC and Sub2API authorized feature heads to be ancestors of the corresponding new authorized heads. Each observed remote must equal or fast-forward its predecessor. Remote movement does not silently replace the frozen feature baseline or `SUB2API_CONTRACT_ROOT`, but a rewind, force-push, unrelated feature head, changed `muqihang` URL, changed gate schema, or changed remote plan/authority/shared-contract byte blocks renewal and requires a reviewed new plan/preflight.
5. Require monotonically nondecreasing stage and generation time, a window in `(0, 24h]`, `generated_at` no more than five minutes beyond observed clock skew, and a currently unexpired latest head. Earlier immutable predecessors may be expired. All plan, approval, authority, planning-provenance, requirement, disabled-capability, and shared-contract bindings remain byte-identical.
6. Before writing a successor both roots are clean. The `pre-commit` gate requires CC status to contain exactly `?? <new-successor-path>` and Sub2API status to be empty. Commit only that path, then run the `post-commit` gate: CC HEAD must be the unique one-parent child of `authorized_parent_head`, its delta must add only the selected successor, committed bytes must match, and both roots must be clean with Sub2API still at its authorized head. Record the derived artifact commit and only then start the next task or capture. A lease that expires during an already-started task allows only completion to the next clean checkpoint; it never authorizes another task or evidence capture.

For sequence one, the path is `docs/superpowers/evidence/phase-1/phase-1-execution-context-0001.json`. Validate each renewal with:

```bash
PHASE1_REQUIRE_EXECUTION_CONTEXT=1 PHASE1_EXECUTION_CONTEXT_GATE=pre-commit PHASE1_EXECUTION_CONTEXT_MODE=successor PHASE1_EXECUTION_CONTEXT_PATH=${PHASE1_EXECUTION_CONTEXT_PATH} PHASE1_PREVIOUS_EXECUTION_CONTEXT_PATH=${PHASE1_PREVIOUS_EXECUTION_CONTEXT_PATH} SUB2API_ROOT=${SUB2API_ROOT} npm exec tsx tests/oracle-lab-phase-1-planning.test.ts
git add ${PHASE1_EXECUTION_CONTEXT_PATH}
git commit -m "docs(oracle): renew Phase 1 execution context"
PHASE1_REQUIRE_EXECUTION_CONTEXT=1 PHASE1_EXECUTION_CONTEXT_GATE=post-commit PHASE1_EXECUTION_CONTEXT_MODE=successor PHASE1_EXECUTION_CONTEXT_PATH=${PHASE1_EXECUTION_CONTEXT_PATH} PHASE1_PREVIOUS_EXECUTION_CONTEXT_PATH=${PHASE1_PREVIOUS_EXECUTION_CONTEXT_PATH} SUB2API_ROOT=${SUB2API_ROOT} npm exec tsx tests/oracle-lab-phase-1-planning.test.ts
```

Every live-gate rejection is raised through `failContextGate(code, message)` with a machine-readable stable `code`; raw assertion, JSON, filesystem, and child-process errors do not escape the gate boundary. `readGateArtifact`, `readGateJsonArtifact`, `gateDirectoryNames`, and `reviewedGitGate` translate missing/unreadable files, final or ancestor symlinks, malformed JSON, missing refs/objects, and reviewed-Git process failures before semantic validation. Negative tests use real temporary directories, regular files, malformed files, final/ancestor symlinks, and invalid Git refs and bind at least `context_schema_invalid`, `context_schema_binding_drift`, `context_chain_gap`, `stale_execution_context`, `context_not_yet_valid`, `predecessor_context_mutated`, `context_sequence_mismatch`, `context_stage_regression`, `context_timestamp_regression`, `context_head_not_descendant`, `context_initial_head_mismatch`, `context_head_mismatch`, `context_commit_parent_mismatch`, `context_remote_rewind`, `context_remote_authority_drift`, `context_remote_origin_drift`, `context_git_object_invalid`, `context_branch_mismatch`, `context_shared_contract_drift`, `context_binding_drift`, `context_approval_invalid`, `context_symlink`, `context_dirty_tree`, `context_unexpected_delta`, `context_window_invalid`, `context_future_timestamp`, and `context_gate_mode_invalid`. Timestamps up to the clock-skew ceiling may be structurally well formed, but a task or capture cannot start until `generated_at <= now`; it fails `context_not_yet_valid` rather than producing evidence that downstream historical validation cannot consume. `PHASE1_EXECUTION_CONTEXT_PATH` must name the unique latest contiguous context chain head; the previous path must name its immediate predecessor. A caller may not replay an older still-unexpired context after a successor exists.

### Mid-Execution Plan Authority Repair Restart

A direct Important or Critical plan finding discovered after implementation has started is not ordinary lease renewal. In this protocol, plan, review, or gate-schema drift is never represented as an ordinary successor context because schema-v2 requires those bindings to remain immutable across one context chain. Task 7 broad gate remains blocked from the first such finding until the replacement initial preflight and replay gate below pass. No feature capture, H1 result, review attestation, merge, or exit artifact may be minted during the pause.

Use this closed restart protocol instead of overwriting or extending the superseded authority:

1. Preserve the in-flight delta without modifying the operator-owned sibling. If the task began under a then-valid context, it may finish only to the exact clean **quarantine checkpoint** pinned below whose parent is the last clean reviewed task head. The checkpoint makes no PASS, approval, capture, or completion claim. The external controller decision package is informational only; it cannot select or authorize a checkpoint.
2. Merge the repaired plan and planning gate to `muqihang/main` only after a holistic zero-Critical/zero-Important review. The old review and context bytes remain historical only and cannot authorize the replacement branches. They are not copied, rewritten, or selected as the latest authority.
3. Create fresh replacement implementation worktrees on the distinct compiled branches `codex/oracle-phase-1-cc-gateway-v8` and `codex/oracle-phase-1-sub2api-v8`. The source branches `codex/oracle-phase-1-h1-cache-checkpoint` and `codex/oracle-phase-1-sub2api` remain immutable and are never renamed, reset, or reused as replacement roots. The replacement CC branch starts at the newly reviewed merged plan commit, and the replacement Sub2API branch starts at freshly fetched `muqihang/main`.
4. In the replacement branches, run Mandatory Preflight from Step 1 and create a new canonical initial plan review and sequence-zero execution context. The canonical paths are absent because the replacement branches start from main rather than from the superseded feature branches. The new review is holistic over the complete repaired plan; the new context binds only the new plan bytes/commit and the replacement branch heads. Old review/context digests are forbidden inputs.
5. The repaired main already contains reviewed `docs/superpowers/schemas/oracle-lab-phase-1-authority-restart.schema.json`, `tools/oracle-lab/phase-1-authority-restart.ts`, and `tests/oracle-lab-phase-1-authority-restart.test.ts`; they are Mandatory Preflight inputs, not outputs of the checkpoint being replayed. After the initial post-commit context gate passes, run `validatePhase1AuthorityRestartSource` against the hard-coded source histories and both exact H1 cache checkpoint commits before changing either replacement branch. Then replay only the enumerated implementation commits. Do not replay superseded plan review, execution context, or restart artifacts. Preserve selected commit order and repository ownership; reject merge/empty commits, conflict resolution, extra paths, or any source object not hard-coded in the reviewed tool.
6. `validatePhase1AuthorityRestart` independently uses `runReviewedGit` to prove patch-id and implementation-tree equivalence: stable patch-id, exact source parent, contiguous replacement parent order, and exact changed-path/mode set for every source-to-replacement mapping. Before mapping acceptance it proves the CC replay base is the unique one-parent initial-authority child of repaired remote main whose exact delta adds only the bound plan-review and sequence-zero context bytes, and proves the Sub2API replay base equals frozen remote main. It proves the projected tracked-tree comparison excludes exactly the reviewed authority-repair path set and canonical historical authority paths; all nonexcluded projected path, mode, object-type, and object-ID tuples remain byte-identical. Source gaps are forbidden except the two compiled authority-only commits listed below: each must be the exact one-parent object at the exact gap, must change only its one exact historical authority path, and must be consumed exactly once. A caller-derived first parent, any other intervening commit, prose decision package, aggregate diff summary, user-supplied digest, or conflict-resolved cherry-pick is never equivalence evidence.
7. After replay, build and pre-commit validate `docs/superpowers/evidence/phase-1/phase-1-authority-restart-0002.json`, then commit it as a one-path child of the final replay head. The JSON deliberately omits its own digest and commit. Post-commit validation derives `HEAD`, proves its sole parent is the artifact's bound replay head, proves the sole delta adds the canonical restart path with exact committed bytes, and revalidates replacement branch names/heads, latest sequence-zero context digest, both clean worktrees, every mapping, both compiled skipped commits, the pinned checkpoint evidence, and both projected trees. The derived commit is runtime output only and is not written back into the artifact.
8. The final replay head includes the reviewed Task 7 H1 cache implementation and its dependency-reference closure; replay itself makes no new feature-capture or exit claim. After restart post-commit validation, rerun the task-scoped authority/evidence gates and the plan's serial closed-suite requirement on the replacement heads, obtain the bounded closure review, then begin Task 8 with a fresh feature-capture context and fresh baseline/results. Do not create another Task 7 continuation unless those replay-verification gates find a demonstrable implementation regression. Keep source worktrees read-only until replay and closing review complete; removal remains separately approved cleanup.

For authority-repair instance `0001`, the superseded clean heads are CC `49e4639c6f36dc51779c14813acd6e277315b969` and Sub2API `e2af1be5176854958a3d7b63a029174ffc5792a8`; the contract clone remains `main@b0b77933716487da5fca00329443f88ce9a1c3db`. CC replay excludes authorization commit `dd5ea716bc84e391daec333ecf03f41643612dde` and permits, in order, only Task 6 commits `2a1553a4d16ccfdcd186ae78d99deeecbd7dfb4c`, `49e4639c6f36dc51779c14813acd6e277315b969`, and exact Task 7 quarantine checkpoint `0403674d4c812e1a14704bfc890d66aac75f0325`. The checkpoint's sole parent is `49e4639c6f36dc51779c14813acd6e277315b969`, stable patch-id is `c48f2a7960e8cdf09ab4be8a3656b789080a0fe0`, and its exact twelve UTF-8 byte-sorted path/mode/status tuples are hard-coded in the restart tool. Substitution by any other valid one-parent child fails `authority_restart_checkpoint_mismatch` before replay. Sub2API replay permits, in order, exactly `b095307407b7b0bf08a7fc629a5d83dea86c26ab`, `fadcbd18c0d49bf3562e568fd6b8282c4417a12c`, `6f1754396b572abf929cb80ea4602306b89fcf9c`, `7aba29c7387b82e37187d11c80ced09cef86b47f`, `4e55cb8b0442c3a0f1734615efaf38967f2fe1aa`, `3b09da2574e07a72e0cac34a28aeb5d4604f4759`, `fe7753fa5b0b046eea42427e29aab3af467d5312`, `540d58cb820811e7beaca26e678f499c8cc66351`, `d25ecc1ddf1cf1e058c903c26915cf11c9c97025`, and `e2af1be5176854958a3d7b63a029174ffc5792a8`. These source SHAs identify replay inputs only; replacement commits receive new SHAs and must satisfy the equivalence and test gates above.

The restart schema is closed with `additionalProperties: false` at every level. It freezes `schema_version: 1`, `repair_id: authority-repair-0001`, the superseded and replacement remote origins/branches/base heads, repaired plan commit/digest, plan-review path/digest, sequence-zero execution-context path/digest/artifact commit, exact quarantine checkpoint/parent/patch-id/tuples, ordered repository-specific replay mappings, projected-tree policy, and replay heads. It intentionally omits the restart artifact's own digest and commit to avoid Git self-reference; post-commit validation derives them from committed bytes and topology. Every mapping contains source/replacement commit and sole parent, stable patch-id, and UTF-8 byte-sorted exact changed-path/mode/status tuples; rename entries bind both endpoints. The projected-tree policy excludes exactly these authority-repair paths: `docs/superpowers/plans/2026-07-15-claude-code-2.1.207-phase-1-control-plane-boundary-repairs.md`, `docs/superpowers/schemas/oracle-lab-phase-1-authority-restart.schema.json`, `tests/oracle-lab-governance-amendment-evidence.test.ts`, `tests/oracle-lab-ignored-path-inventory.test.ts`, `tests/oracle-lab-phase-1-authority-restart.test.ts`, `tests/oracle-lab-phase-1-planning.test.ts`, `tests/suite-process-runner.ts`, `tests/suite-process-runner.test.ts`, `tools/oracle-lab/oracle-phase1-authority-restart`, `tools/oracle-lab/phase-1-authority-bootstrap.mjs`, and `tools/oracle-lab/phase-1-authority-restart.ts`, plus exact canonical historical authority paths `docs/superpowers/evidence/phase-1/phase-1-context.json`, `docs/superpowers/evidence/phase-1/phase-1-entry-baseline.json`, `docs/superpowers/evidence/phase-1/phase-1-plan-review.json`, and `docs/superpowers/evidence/phase-1/phase-1-execution-context.json`. Prefix, glob, regex, caller-supplied exclusion, successor-context wildcard, or any additional path is forbidden. The pinned checkpoint's exact changed-path set is disjoint from every authority-repair and historical exclusion; any overlap fails before mapping validation, so excluded repair paths cannot be laundered through checkpoint replay.

The preceding instance `0001` bindings and schema description are retained only as immutable historical provenance and cannot authorize another replay. Current authority-repair instance `0002` supersedes them. Its source heads are CC `d5a711614177906d18486b98ff4c5d45d97e04c7` on `codex/oracle-phase-1-h1-cache-checkpoint` and Sub2API `20217731da9521f9676434b7bd5f9cb73020c32c` on `codex/oracle-phase-1-sub2api`; its fresh replacement branches are the distinct v8 names in Step 3. The contract clone remains `main@b0b77933716487da5fca00329443f88ce9a1c3db`.

Instance `0002` permits CC source commits, in order, exactly `410fbe0c784c9eea04685cc251909d8df75b6871`, `e2972e6f6b27c658d9a6e91379ba9cea834cd4cb`, `beabd36547daa6236c1caa142a0a1b5a926bbde3`, `bedc81ca5c0aa9e0991a2f0bc42b62c4dd62f8db`, `540962ea9c068c82d5dbe07b5aeae172fa6258e6`, `e43f50816c8b693f875fc485a99dcdf9d985080e`, `8cbc5c633c7f791b395198aedd2db2e55f01915b`, and `d5a711614177906d18486b98ff4c5d45d97e04c7`. The only compiled gaps are old restart artifact commit `1c8f25bb1ca31c5c16262fec71f93dd1e14f512d`, which adds only `docs/superpowers/evidence/phase-1/phase-1-authority-restart-0001.json`, and old renewal commit `6621c7a78432a895d261054e291aed74c04978c3`, which adds only `docs/superpowers/evidence/phase-1/phase-1-execution-context-0001.json`; both are forbidden replay inputs. The H1 cache checkpoint `8cbc5c633c7f791b395198aedd2db2e55f01915b` has parent `e43f50816c8b693f875fc485a99dcdf9d985080e`, stable patch-id `295de5938e2ed0001dc51b520ebf62a223b44a3c`, and exact eight modified 100644 tuples hard-coded in the tool. The dependency-reference closure `d5a711614177906d18486b98ff4c5d45d97e04c7` has parent `8cbc5c633c7f791b395198aedd2db2e55f01915b`, stable patch-id `655f57bc12191566b6f1efd415ce54721252ab08`, and exact two modified 100644 test/tool tuples.

Instance `0002` permits Sub2API source commits, in order, exactly `267b3d074248a7e1f7cf16bf302f91b41fa754ec`, `cff380892f64720c046d581723d0faf13cb566fc`, `b90254865b11be445a73faeeb0bbf1c0ff5384dd`, `e49100746f8e00d83168864dab2a4235053d16d7`, `33cac77640cccf5bbd87ab79ea9e44ef2c125da7`, `7ffaebdaa32aa3b9896cf6a3c554a671255b98d3`, `da7a01ac692553c9886c4ef14d0f9d5cb29c0a45`, `75dc3c0fd38acea12f373207521d9927c01c25ad`, `0f2271946686458458e959d3952e56f75c9e50fe`, and `20217731da9521f9676434b7bd5f9cb73020c32c`. The current closed schema requires `repair_id: authority-repair-0002`; the canonical artifact path is `docs/superpowers/evidence/phase-1/phase-1-authority-restart-0002.json`. The projected-tree policy retains the existing exact repair paths and adds only the two compiled skipped historical paths above. Prefix, glob, regex, caller-supplied exclusions/mappings, or any additional skipped commit remain forbidden.

RED tests build valid temporary Git graphs, then independently mutate a source/replacement commit, parent order, skipped authority commit, skipped historical path, patch-id, path, old/new mode, rename endpoint, repository, mapping order, checkpoint parent, repair-path exclusion, historical authority-path exclusion, projected tuple, replay head, context digest, restart bytes, artifact parent, artifact delta, branch, remote, and clean status. Each fails a stable `authority_restart_*` code before Task 8 command spawn. The builder refuses to overwrite an existing artifact, and pre/post-commit modes make a crash resumable without accepting a partial or replayed restart.

### Task 1: Sub2API Authority Envelope and Optimistic Version Foundation

**Files:**
- Create: `backend/internal/service/formal_pool_onboarding_authorization.go`
- Create: `backend/internal/service/formal_pool_onboarding_authorization_test.go`
- Modify: `backend/internal/service/formal_pool_onboarding_store.go:34-168`
- Modify: `backend/internal/service/formal_pool_onboarding_service.go:62-149,297-415,1661-1702`
- Modify: `backend/internal/service/formal_pool_onboarding_service_test.go`
- Modify: `backend/internal/service/formal_pool_onboarding_flow_test.go`
- Test: `backend/internal/service/formal_pool_onboarding_authorization_test.go`
- Test: `backend/internal/service/formal_pool_onboarding_store_test.go`

**Interfaces:**
- Produces: `FormalPoolOnboardingPrincipal`, exact `CallerKindHumanJWT = "human_jwt"`, `FormalPoolRequestAuthority`, `FormalPoolOnboardingPrincipalRevalidator`, `WithFormalPoolRequestAuthority`, `FormalPoolRequestAuthorityFromContext`, `authorizeCreate`, `authorizeSession`, and `authorizeAccount`.
- Produces: `FormalPoolOnboardingGroupReader` as a narrow adapter over the existing `GroupRepository` for active-group validation during creation.
- Produces: `FormalPoolOnboardingSession.Version int64`, owner fields, `FormalPoolOperationReservation`, `beginReservedMutation`, `finishReservedMutation`, and `failReservedMutation`.
- Consumes: existing `FormalPoolOnboardingStore.get`, `casUpdate`, session `Version`, `GroupID`, and status constants.

- [ ] **Step 1: Write focused RED tests for authority ordering and versions**

```go
func TestFormalPoolAuthorizeSessionOrdersOwnerBeforeVersionAndState(t *testing.T) {
    svc, owner, session, revalidator := newAuthorizedOnboardingFixture(t)
    revalidator.calls.Store(0)
    intruder := owner
    intruder.SubjectID++
    stale := int64(0)
    ctx := WithFormalPoolRequestAuthority(context.Background(), FormalPoolRequestAuthority{
        Principal: intruder,
        ExpectedVersion: &stale,
    })
    _, err := svc.authorizeSession(ctx, session.ID, true, FormalPoolOnboardingStatusWarming)
    require.ErrorIs(t, err, ErrFormalPoolOnboardingForbidden)
    require.NotErrorIs(t, err, ErrFormalPoolOnboardingVersionConflict)
    require.NotErrorIs(t, err, ErrFormalPoolOnboardingInvalidState)
    require.Zero(t, revalidator.calls.Load())
}

func TestFormalPoolAuthorizeSessionRevalidatesAfterOwnerBeforeVersionStateAndReservation(t *testing.T) {
    svc, owner, session, revalidator := newAuthorizedOnboardingFixture(t)
    revalidator.calls.Store(0)
    revalidator.err = ErrFormalPoolOnboardingAuthenticationRequired
    stale := int64(0)
    ctx := WithFormalPoolRequestAuthority(context.Background(), FormalPoolRequestAuthority{
        Principal: owner, ExpectedVersion: &stale,
    })
    _, err := svc.authorizeSession(ctx, session.ID, true, "wrong_state")
    require.ErrorIs(t, err, ErrFormalPoolOnboardingAuthenticationRequired)
    require.Equal(t, int64(1), revalidator.calls.Load())
    rec, ok := svc.store.get(session.ID)
    require.True(t, ok)
    require.Nil(t, rec.ActiveOperation)
}

func TestFormalPoolStartSessionRequiresSystemAdminTenantAndActiveGroup(t *testing.T) {
    svc := NewFormalPoolOnboardingService(FormalPoolOnboardingDeps{
        Proxy: &formalProxyFake{}, Groups: &formalGroupReaderFake{},
    })
    _, err := svc.StartSession(context.Background(), FormalPoolOnboardingStartRequest{GroupID: 101})
    require.ErrorIs(t, err, ErrFormalPoolOnboardingAuthenticationRequired)
}

func newAuthorizedOnboardingFixture(t *testing.T) (*FormalPoolOnboardingService, FormalPoolOnboardingPrincipal, *FormalPoolOnboardingSession, *formalPrincipalRevalidatorFake) {
    t.Helper()
    revalidator := &formalPrincipalRevalidatorFake{}
    svc := NewFormalPoolOnboardingService(FormalPoolOnboardingDeps{
        Proxy: &formalProxyFake{}, PrincipalRevalidator: revalidator,
        Groups: &formalGroupReaderFake{groups: map[int64]*Group{
            101: {ID: 101, Status: StatusActive, Hydrated: true},
        }},
    })
    owner := FormalPoolOnboardingPrincipal{
        SubjectID: 1001, AdministratorID: 1001, TenantID: "tenant-one",
        CreatorID: 1001, Role: RoleAdmin, CallerKind: CallerKindHumanJWT,
        AuthorityRevision: 1, ExpiresAtUnix: 4102444800, Active: true, SystemAdmin: true,
    }
    zero := int64(0)
    ctx := WithFormalPoolRequestAuthority(context.Background(), FormalPoolRequestAuthority{
        Principal: owner, ExpectedVersion: &zero, IdempotencyKey: "fixture-create-key-0001",
    })
    proxyID := int64(9)
    session, err := svc.StartSession(ctx, FormalPoolOnboardingStartRequest{
        ProxyMode: "existing", ProxyID: &proxyID, GroupID: 101, AccountName: "authority-fixture",
    })
    require.NoError(t, err)
    return svc, owner, session, revalidator
}

type formalPrincipalRevalidatorFake struct { err error; calls atomic.Int64 }
func (f *formalPrincipalRevalidatorFake) Revalidate(ctx context.Context, principal FormalPoolOnboardingPrincipal) error {
    _ = ctx
    _ = principal
    f.calls.Add(1)
    return f.err
}

type formalGroupReaderFake struct { groups map[int64]*Group }
func (f *formalGroupReaderFake) GetByID(ctx context.Context, id int64) (*Group, error) {
    _ = ctx
    group := f.groups[id]
    if group == nil { return nil, nil }
    copy := *group
    return &copy, nil
}
```

- [ ] **Step 2: Run the focused tests and confirm the authority API is absent**

Run: `cd backend && go test ./internal/service -run '^TestFormalPoolAuthorize|^TestFormalPoolStartSessionRequiresSystemAdminTenant' -count=1`

Expected: FAIL to compile because `FormalPoolRequestAuthority` and the stable errors do not exist.

- [ ] **Step 3: Add the typed authority model and stable errors**

```go
type FormalPoolOnboardingPrincipal struct {
    SubjectID       int64
    AdministratorID int64
    TenantID        string
    CreatorID       int64
    Role            string
    CallerKind      string
    AuthorityRevision int64
    ExpiresAtUnix     int64
    Active          bool
    SystemAdmin     bool
}

const CallerKindHumanJWT = "human_jwt"

type FormalPoolRequestAuthority struct {
    Principal       FormalPoolOnboardingPrincipal
    ExpectedVersion *int64
    IdempotencyKey  string
}

type FormalPoolOnboardingGroupReader interface {
    GetByID(ctx context.Context, id int64) (*Group, error)
}

type FormalPoolOnboardingPrincipalRevalidator interface {
    Revalidate(ctx context.Context, principal FormalPoolOnboardingPrincipal) error
}

// Add Groups FormalPoolOnboardingGroupReader and
// PrincipalRevalidator FormalPoolOnboardingPrincipalRevalidator to FormalPoolOnboardingDeps;
// store both narrow dependencies on the service.

func WithFormalPoolRequestAuthority(ctx context.Context, authority FormalPoolRequestAuthority) context.Context
func FormalPoolRequestAuthorityFromContext(ctx context.Context) (FormalPoolRequestAuthority, bool)

var ErrFormalPoolOnboardingAuthenticationRequired = infraerrors.Unauthorized(
    "FORMAL_POOL_AUTH_REQUIRED", "formal pool authorization is required",
)
var ErrFormalPoolOnboardingForbidden = infraerrors.Forbidden(
    "FORMAL_POOL_FORBIDDEN", "formal pool operation is forbidden",
)
var ErrFormalPoolOnboardingVersionRequired = infraerrors.New(http.StatusPreconditionRequired,
    "FORMAL_POOL_ONBOARDING_VERSION_REQUIRED", "formal pool expected version is required",
)
```

Reuse the existing `ErrFormalPoolOnboardingVersionConflict`; do not declare a second conflict error or change its reason code.

Implement the generic `authorizeSession` order exactly as `context -> active human-JWT/system-admin shape -> record lookup -> static owner comparison -> service-level principal revalidation -> expected-version requirement -> expected-version equality -> allowed-state membership`. The static owner comparison includes subject/admin/tenant/creator/role plus immutable record-group integrity. `authorizeSession`, `authorizeAccount`, and `authorizeBrowserEgressOwner` each perform exactly one reservation-adjacent revalidation after static owner comparison; there is no repository/dependency call, goroutine, or asynchronous boundary between that revalidation and subsequent version/state/CAS work. A nil revalidator fails closed. Missing, malformed, expired, revoked, inactive, token-version-changed, and non-human/service authorities map to the common 401; static-owner, tenant-envelope, and current-role mismatches map to the common 403.

Creation has no persisted owner to compare and active-group validation is a repository read, so `authorizeCreate` performs two live revalidation calls. Its exact order is `context -> active human-JWT/system-admin shape -> first service revalidation -> active-group lookup result buffered -> second service revalidation -> buffered group result classification -> provisional CAS reservation -> proxy dependency`. The first call preserves authorization-first error ordering and prevents an already revoked caller from probing group validity. The group adapter call buffers both the group value and lookup error without classifying or returning. The second revalidation runs regardless of whether the buffered result is success, error, missing, or inactive. Only after the second revalidation succeeds may creation classify the buffered group result and return its safe validation error. The second call is synchronous and immediately reservation-adjacent, with no repository/dependency call, goroutine, or asynchronous boundary before group classification and provisional CAS. Either revalidation failure returns the same 401/403 mapping and leaves provisional reservation and proxy counters at zero. This remains the generic path for every operation except Task 3 `AttestBrowserEgress`, which must split owner/revalidation from version/state evaluation only to perform the narrow consumed-proof replay check defined in Global Constraints.

The revalidator consumes only the server-created `FormalPoolOnboardingPrincipal`; it never accepts headers, request labels, object owner fields, or raw JWT material. It re-fetches `SubjectID`, verifies `ExpiresAtUnix`, active status, current system-admin role, and `AuthorityRevision == user.TokenVersion`, and verifies that the immutable subject/administrator/tenant/creator/role envelope has not changed. It returns only the common 401/403 classes and no user or owner detail. Unit tests cover nil revalidator, missing/inactive/revoked/expired user, role loss, token-version drift, subject mismatch, revalidator error before stale-version/wrong-state disclosure, and zero CAS/dependency effects. A creation-specific table uses a blocking `FormalPoolOnboardingGroupReader`: it waits for the first revalidation and the group lookup, revokes or changes the principal while the group read is blocked, then releases it with success, repository error, missing group, and inactive group results. In every row the second revalidation must win with 401/403, no group-result detail, no provisional record/reservation, and zero proxy calls. A control proves two successful revalidations, one group read, subsequent safe group classification, one provisional reservation, and one proxy call.

- [ ] **Step 4: Extend the record and response without exposing owner identifiers**

```go
type formalPoolOnboardingSessionRecord struct {
    ID                   string
    Version              int64
    OwnerSubjectID       int64
    OwnerAdministratorID int64
    OwnerTenantID        string
    OwnerCreatorID       int64
    OwnerRole            string
    ActiveOperation      *FormalPoolOperationReservation
    // Existing fields remain unchanged below.
}

type FormalPoolOnboardingSession struct {
    ID      string `json:"id"`
    Version int64  `json:"version"`
    Status  string `json:"status"`
    // Existing public safe fields remain unchanged.
}
```

`sessionResponse` sets `Version: rec.Version` and never places owner IDs or tenant ID in the response or `SafeSummary`.

`FormalPoolOperationReservation` contains only a server-generated operation ID, stable operation kind, input version, reservation version, and start timestamp. It is never accepted from the client and is not serialized. `beginReservedMutation` authorizes owner/state/expected version, atomically installs the reservation and increments `Version`; if any reservation already exists it returns the same 409 conflict before dependencies. `finishReservedMutation` and `failReservedMutation` require the exact operation ID plus reservation version and never retry a failed CAS.

Creation uses the same primitive before a session exists. `beginCreateReservation` atomically indexes `{tenant, administrator, creator, idempotency_key}` and inserts a provisional owner-bound record in `creating_proxy` with version `1`, request fingerprint, and `ActiveOperation=create_session`. The key is supplied through `Idempotency-Key`, is never logged, and is HMAC-safe-ref persisted rather than stored raw. The same key plus the same request returns the completed session or 409 while active; the same key plus a different request returns 409. Neither path invokes proxy resolution twice.

- [ ] **Step 5: Enforce authority on create/read/abort and add account lookup**

`StartSession` requires `ExpectedVersion == 0`, a valid `Idempotency-Key`, active human-JWT system-admin authority, non-empty tenant, positive subject/admin/creator IDs, and a requested `GroupID` proven present and active through an injected adapter over the existing trusted `GroupRepository`. It validates and fingerprints the request, calls `beginCreateReservation`, and only then calls proxy resolution once. Success finalizes the provisional record at version `2`; ambiguous proxy creation finalizes `operation_outcome_unknown` and never auto-retries. `GetSession` authorizes the owner but does not require `If-Match`. `AbortSession` requires an expected version and uses one `casUpdate` because it has no external effect. Add `snapshotByAccountID` and `snapshotByCreateKey` with the same copy/session-expiry behavior as `snapshotByNonce`.

Add a concurrent creation test with a blocking proxy fake: two requests sharing owner, request, `If-Match: "0"`, and idempotency key produce exactly one `ResolveOrCreateProxy` call; the second receives 409 while the first is active, and a post-success replay returns the same session/version without another dependency call. A changed body under the same key is 409 before proxy invocation.

- [ ] **Step 6: Migrate the direct flow harness and run authority/store/service regression tests**

Add one `authorizedFlowContext(t, sessionVersion)` helper to `formal_pool_onboarding_flow_test.go`. Migrate every direct `StartSession` and mutation call in that file to an owner-bound authority plus the current response version; do not weaken production authorization for test compatibility. Migrate every affected fixture in `formal_pool_onboarding_service_test.go`, `formal_pool_onboarding_store_test.go`, and the rest of `internal/service` to an explicit fake group reader and principal revalidator where authorization is expected to succeed. Keep dedicated nil-dependency cases as fail-closed negatives.

Run: `cd backend && go test ./internal/service -count=1`

Expected: PASS with no owner identifiers in serialized sessions.

- [ ] **Step 7: Commit Task 1**

```bash
git add backend/internal/service/formal_pool_onboarding_authorization.go backend/internal/service/formal_pool_onboarding_authorization_test.go backend/internal/service/formal_pool_onboarding_store.go backend/internal/service/formal_pool_onboarding_store_test.go backend/internal/service/formal_pool_onboarding_service.go backend/internal/service/formal_pool_onboarding_service_test.go backend/internal/service/formal_pool_onboarding_flow_test.go
git commit -m "feat(formal-pool): bind onboarding sessions to server authority"
```

### Task 2: B2 Principal Resolution and Route-Wide Enforcement

**Files:**
- Create: `backend/internal/handler/admin/formal_pool_onboarding_principal.go`
- Modify: `backend/internal/handler/admin/formal_pool_onboarding_handler.go:18-522`
- Modify: `backend/internal/handler/wire.go:117-123`
- Modify: `backend/internal/server/middleware/auth_subject.go`
- Modify: `backend/internal/server/middleware/jwt_auth.go`
- Modify: `backend/internal/server/middleware/jwt_auth_test.go`
- Create: `backend/internal/server/middleware/formal_pool_onboarding_auth.go`
- Create: `backend/internal/server/middleware/formal_pool_onboarding_auth_test.go`
- Modify: `backend/internal/server/middleware/wire.go`
- Modify: `backend/internal/server/http.go`
- Modify: `backend/internal/server/router.go`
- Modify: `backend/internal/server/routes/admin.go`
- Create: `backend/internal/server/routes/formal_pool_onboarding_auth_integration_test.go`
- Modify: `backend/internal/config/config.go:169-181`
- Modify: `backend/internal/service/formal_pool_onboarding_authorization.go`
- Modify: `backend/internal/service/formal_pool_onboarding_service.go:626-1659`
- Modify: `backend/internal/service/wire.go`
- Modify: `backend/cmd/server/wire_gen.go` (generated deterministically by `go generate ./cmd/server`)
- Modify: `backend/internal/server/routes/formal_pool_onboarding_phase0_red_test.go:1-347`
- Modify: `backend/internal/server/routes/formal_pool_onboarding_routes_test.go`
- Modify: `backend/internal/handler/formal_pool_onboarding_provider_test.go`
- Modify: `frontend/src/api/admin/claudeOnboarding.ts:57-208`
- Modify: `frontend/src/composables/useEgressCheckPolling.ts`
- Modify: `frontend/src/components/account/ClaudeFormalPoolOnboardingWizard.vue`
- Modify: `frontend/src/components/account/ClaudeFormalPoolOnboardingWizardV2.vue`
- Modify: `frontend/src/composables/__tests__/useEgressCheckPolling.spec.ts`
- Modify: `frontend/src/components/account/__tests__/ClaudeFormalPoolOnboardingWizardV2.spec.ts`
- Test: `backend/internal/server/routes/formal_pool_onboarding_phase0_red_test.go`

**Interfaces:**
- Consumes: Task 1 authority context and response version.
- Produces: `FormalPoolOnboardingJWTAuthMiddleware`, `RegisterFormalPoolOnboardingAdminRoutes`, an `AuthSubject` safe claims snapshot, `FormalPoolOnboardingPrincipalResolver.Resolve(*gin.Context)`, `FormalPoolOnboardingPrincipalGuard(resolver)`, the production adapter for `service.FormalPoolOnboardingPrincipalRevalidator`, `FormalPoolOnboardingPrincipalFromGin`, and `parseFormalPoolIfMatch`.
- Produces: every mutating frontend API function accepts the current `FormalPoolSession` and sends its version.

- [ ] **Step 1: Make the existing B2 RED corpus always-on and complete**

Remove only `//go:build phase0red` from `formal_pool_onboarding_phase0_red_test.go`; keep the filename for history. Replace test-only `X-Phase0-*` authority headers with a fake `FormalPoolOnboardingPrincipalResolver` whose current principal is set by the fixture before each request. Inject a separate fake `FormalPoolOnboardingPrincipalRevalidator` into the service for every matrix fixture; its default mirrors the resolver principal and succeeds, while the concurrent-revocation rows mutate its result at the named boundary. A nil revalidator is tested only by the focused fail-closed unit row and must not make the route matrix pass for the wrong reason.

Freeze `formalPoolAdminOperationCases` as these exact 15 existing non-public object operations: `GetSession`, `TestProxy`, `BrowserEgressAttestation`, `GenerateOAuth`, `ExchangeOAuth`, `ExchangeSetupToken`, `Acceptance`, `RefreshOnly`, `RuntimeRegistration`, `SessionHealthcheck`, `AccountHealthcheck`, `StartWarming`, `Abort`, `Activation`, and `Promotion`. Each operation must execute every row in `formalPoolAuthorityCases`; sampling six dimensions on `GetSession` is forbidden. `CreateSession` is a separately frozen sixteenth route and executes the same authentication/caller/session/role/tenant/group matrix, with creator/object-owner and stale-tab cases marked structurally not applicable rather than silently omitted:

| Caller/session case | Required result |
| --- | --- |
| unauthenticated | common 401 |
| active ordinary user, creator and non-creator | common 403 |
| would-be group administrator: active non-admin JWT with existing `AllowedGroups`, same/cross requested tenant or group | common 403; `AllowedGroups` is a binding permission, not an administrator grant, and this repository has no group-admin production role |
| would-be tenant administrator: active non-admin JWT with same/cross requested tenant labels | common 403; request labels grant no authority and this repository has no tenant-admin production role |
| initially revoked session; initially expired session | common 401 in JWT middleware/guard before compliance or record lookup |
| stale browser tab | 409 only after authority succeeds |
| service-to-service/admin-API-key caller | common 401; onboarding is JWT-human-only in Phase 1 |
| concurrent user status, role, or token-version change after JWT middleware, including after the principal guard succeeds but before the service revalidator runs | common 401/403 before CAS reservation or dependency |
| duplicated OAuth callback and concurrent promote with the same operation key/fingerprint | idempotent pending/completed result; one dependency invocation |

For every mutation family, add a combined negative in which owner mismatch, stale version, and wrong state are simultaneously true. It must return the common 403 and leave its proxy/OAuth/account/healthcheck/cache/scheduler dependency counter at zero. The table also asserts the exact route inventory; adding a route without a matrix row fails the test.

Freeze the two revocation timing classes separately: an initially expired or revoked JWT is rejected by middleware/guard before compliance or record lookup. A post-guard change for a statically matching owner is rejected after record/static-owner checks but before version, state, CAS, or dependency work; inactive/deleted/token-version drift returns 401 and role loss returns 403. If post-guard revocation is combined with a static cross-owner mismatch, the static owner check remains first and returns the common 403 without invoking the service revalidator. Tests must not collapse these timing classes into one impossible “before record” claim.

- [ ] **Step 2: Run B2 tests and capture the expected failures**

Run: `cd backend && go test ./internal/server/routes -run 'TestFormalPoolOnboardingAuthorization' -count=1`

Expected: FAIL because onboarding still inherits `adminAuth`, `AuthSubject` lacks the safe JWT claims snapshot, the service has no `FormalPoolOnboardingPrincipalRevalidator`, and the handler does not transport typed authority or parse `If-Match`.

- [ ] **Step 3: Put onboarding behind JWT auth and add the production principal resolver**

This phase deliberately authorizes only an active system `RoleAdmin` using a nonexpired, nonrevoked human JWT. Group/tenant administrators remain mandatory denial cases; Phase 1 does not invent new role tables, tenant grants, or group-policy persistence. Extract the existing role-agnostic JWT validation/user-active/token-version logic into a shared internal helper. Keep `NewJWTAuthMiddleware` behavior unchanged. Add `FormalPoolOnboardingJWTAuthMiddleware`, which calls the same helper but maps every missing/malformed/expired/revoked/inactive credential failure to the one `401 FORMAL_POOL_AUTH_REQUIRED` envelope and allows every valid human JWT role to reach the onboarding principal resolver.

Move only the onboarding admin route registration out of the broad `RegisterAdminRoutes(... adminAuth ...)` group. Export `RegisterFormalPoolOnboardingAdminRoutes(v1, h, formalPoolJWTAuth, principalResolver, settingService)` and register its unchanged `/api/v1/admin/claude-onboarding/...` paths directly from `server/router.go`. Its exact middleware order is: `FormalPoolOnboardingJWTAuthMiddleware` -> `admin.FormalPoolOnboardingPrincipalGuard(principalResolver)` -> existing `middleware.AdminComplianceGuard(settingService)` -> handler. The principal guard calls `Resolve` once, writes only the typed principal to a private Gin key, maps ordinary/would-be delegated users to the common 403, and aborts before compliance; the handler consumes that stored principal through `FormalPoolOnboardingPrincipalFromGin` and never resolves it again. Therefore an unacknowledged system admin receives the existing `423 ADMIN_COMPLIANCE_ACK_REQUIRED`, while an ordinary unacknowledged JWT still receives the onboarding common 403 and cannot use compliance state as an authorization oracle. Wire the JWT middleware and resolver through `middleware.ProviderSet`, `ProvideRouter`, and `SetupRouter`; pass the existing `SettingService` into route registration. The public nonce route remains unchanged. All other admin routes retain `AdminAuthMiddleware` plus the same compliance guard, including Admin API Key support.

The guard and service checks have noninterchangeable scopes. The guard's one `Resolve` call decides whether the request may observe the compliance result and captures a safe principal snapshot. The handler only transports that snapshot. Each service authorization path then calls `FormalPoolOnboardingPrincipalRevalidator.Revalidate` against current durable user state after static owner comparison and immediately before version/state/CAS or other dependency work. “Resolve exactly once” applies only to the guard method; it does not limit, replace, or count the service revalidator call.

Extend the safe middleware context snapshot without storing the raw JWT:

```go
type AuthSubject struct {
    UserID        int64
    Concurrency   int
    AuthMethod    string // exact: "jwt" for onboarding
    TokenVersion  int64
    ExpiresAtUnix int64
}
```

The shared JWT helper sets these fields from validated `JWTClaims` (`ExpiresAtUnix` from `claims.ExpiresAt.Time.Unix()` when present) after current user-active and token-version checks. A missing expiry is represented as zero so existing non-onboarding behavior remains unchanged; the onboarding middleware rejects zero through its common 401. Existing consumers continue using `UserID`/`Concurrency`. Admin API Key never reaches the onboarding route and is a tested 401 service-caller case.

```go
type FormalPoolOnboardingPrincipalResolver interface {
    Resolve(c *gin.Context) (service.FormalPoolOnboardingPrincipal, error)
}

type formalPoolOnboardingPrincipalResolver struct {
    users    *service.UserService
    tenantID string
    now      func() time.Time
}

func NewFormalPoolOnboardingPrincipalResolver(users *service.UserService, tenantID string, now func() time.Time) FormalPoolOnboardingPrincipalResolver {
    return &formalPoolOnboardingPrincipalResolver{users: users, tenantID: strings.TrimSpace(tenantID), now: now}
}

func NewFormalPoolOnboardingPrincipalRevalidator(users *service.UserService, tenantID string, now func() time.Time) service.FormalPoolOnboardingPrincipalRevalidator {
    return &formalPoolOnboardingPrincipalResolver{users: users, tenantID: strings.TrimSpace(tenantID), now: now}
}

func (r *formalPoolOnboardingPrincipalResolver) Resolve(c *gin.Context) (service.FormalPoolOnboardingPrincipal, error) {
    if r == nil || r.users == nil || r.now == nil || c == nil || c.Request == nil {
        return service.FormalPoolOnboardingPrincipal{}, service.ErrFormalPoolOnboardingAuthenticationRequired
    }
    subject, ok := middleware.GetAuthSubjectFromContext(c)
    if !ok || subject.UserID <= 0 { return service.FormalPoolOnboardingPrincipal{}, service.ErrFormalPoolOnboardingAuthenticationRequired }
    if subject.AuthMethod != "jwt" || subject.ExpiresAtUnix <= r.now().Unix() { return service.FormalPoolOnboardingPrincipal{}, service.ErrFormalPoolOnboardingAuthenticationRequired }
    if r.tenantID == "" { return service.FormalPoolOnboardingPrincipal{}, service.ErrFormalPoolOnboardingForbidden }
    user, err := r.users.GetByID(c.Request.Context(), subject.UserID)
    if err != nil || user == nil || !user.IsActive() || user.TokenVersion != subject.TokenVersion { return service.FormalPoolOnboardingPrincipal{}, service.ErrFormalPoolOnboardingAuthenticationRequired }
    if !user.IsAdmin() { return service.FormalPoolOnboardingPrincipal{}, service.ErrFormalPoolOnboardingForbidden }
    return service.FormalPoolOnboardingPrincipal{
        SubjectID: user.ID, AdministratorID: user.ID, TenantID: r.tenantID,
        CreatorID: user.ID, Role: user.Role, CallerKind: service.CallerKindHumanJWT,
        AuthorityRevision: user.TokenVersion, ExpiresAtUnix: subject.ExpiresAtUnix,
        Active: true, SystemAdmin: true,
    }, nil
}

func (r *formalPoolOnboardingPrincipalResolver) Revalidate(ctx context.Context, principal service.FormalPoolOnboardingPrincipal) error {
    if r == nil || r.users == nil || r.now == nil || ctx == nil {
        return service.ErrFormalPoolOnboardingAuthenticationRequired
    }
    if principal.SubjectID <= 0 || principal.CallerKind != service.CallerKindHumanJWT || principal.ExpiresAtUnix <= r.now().Unix() {
        return service.ErrFormalPoolOnboardingAuthenticationRequired
    }
    if r.tenantID == "" { return service.ErrFormalPoolOnboardingForbidden }
    user, err := r.users.GetByID(ctx, principal.SubjectID)
    if err != nil || user == nil || !user.IsActive() || user.TokenVersion != principal.AuthorityRevision {
        return service.ErrFormalPoolOnboardingAuthenticationRequired
    }
    if !user.IsAdmin() || user.Role != principal.Role || principal.AdministratorID != user.ID || principal.CreatorID != user.ID || principal.TenantID != r.tenantID {
        return service.ErrFormalPoolOnboardingForbidden
    }
    return nil
}
```

`formalPoolOnboardingPrincipalResolver` implements two narrow interfaces, but no consumer outside package `admin` receives or names the concrete type. The two exported constructors above are the only construction boundary and return narrow interfaces. Table tests cover nil receiver, nil user service, nil clock, nil Gin context, and nil Gin request for `Resolve`, plus nil receiver/user service/clock/context for `Revalidate`; every case returns the common 401 without panic or repository access. `Resolve` and `Revalidate` share one private current-user classification helper so status/token-version/role mappings cannot drift; each valid public invocation performs exactly one current-user fetch. The resolver receives Gin and safe middleware claims only at the guard boundary. The service revalidator receives `context.Context` plus the already typed principal only and therefore cannot parse or trust request credentials.

Add `AuthorityTenantID string \`mapstructure:"authority_tenant_id"\`` to `FormalPoolRuntimeConfig`. An empty `AuthorityTenantID` returns the common 403 from `Resolve` before compliance and from `Revalidate` before service work; a valid-shaped principal with empty tenant returns 403 with zero user-repository fetch. Missing/malformed/expired principal shape still returns 401 before this configuration check. The tenant is never accepted from a request header, query, or body. `StartSession` validates the requested group exists and is active through the existing trusted group repository; system-admin scope does not turn a client-supplied group ID into authority.

Register these exact parent-package providers in `handler.ProviderSet`:

```go
func ProvideFormalPoolOnboardingPrincipalResolver(userService *service.UserService, cfg *config.Config) admin.FormalPoolOnboardingPrincipalResolver {
    return admin.NewFormalPoolOnboardingPrincipalResolver(userService, cfg.FormalPool.AuthorityTenantID, time.Now)
}

func ProvideFormalPoolOnboardingPrincipalRevalidator(userService *service.UserService, cfg *config.Config) service.FormalPoolOnboardingPrincipalRevalidator {
    return admin.NewFormalPoolOnboardingPrincipalRevalidator(userService, cfg.FormalPool.AuthorityTenantID, time.Now)
}
```

Inject only the resolver into `ProvideRouter`, `SetupRouter`, and `RegisterFormalPoolOnboardingAdminRoutes`; add the revalidator as an explicit parameter to `service.ProvideFormalPoolOnboardingService` and set `FormalPoolOnboardingDeps.PrincipalRevalidator`. `ProvideFormalPoolOnboardingHandler` keeps its existing constructor signature and never receives either interface or a fallback option. Tests call the exported admin constructors with fixed clocks. Wire must construct the revalidator before the onboarding service, and the service must not import the handler package. Provider tests compile both exported constructor paths, assert their narrow interface types, and require generated `wire_gen.go` to call `handler.ProvideFormalPoolOnboardingPrincipalRevalidator` before `service.ProvideFormalPoolOnboardingService`.

After changing middleware/handler/server/service ProviderSets or provider signatures, run `cd backend && go generate ./cmd/server`. This repository commits `backend/cmd/server/wire_gen.go`; omitting it is a build failure. Record its SHA-256, run the same generation command a second time, and require the digest to remain identical. Then run `git diff --check -- cmd/server/wire_gen.go` and `go test ./cmd/server -count=1` so the generated call graph must compile with the new `ProvideFormalPoolOnboardingHandler`, middleware provider, `ProvideRouter`, and `SetupRouter` signatures.

Add a production-route integration test that mounts the real JWT middleware, principal guard, existing compliance guard, router registration, stored-principal handler path, handler, and service revalidator. It proves: an acknowledged valid system-admin JWT reaches the handler; an unacknowledged valid system-admin receives exact `423 ADMIN_COMPLIANCE_ACK_REQUIRED`; ordinary JWTs, non-admin users with `AllowedGroups`, and non-admin users carrying same/cross request tenant/group labels receive the common 403 whether compliance is acknowledged or not; expired/revoked/inactive JWTs receive the common 401; and Admin API Key does not authenticate. An unacknowledged system-admin JWT with empty tenant configuration still receives 403 with zero compliance, handler, service, and dependency calls. One hook changes user role/status/token version after JWT middleware but before the principal guard and must return 401/403 with zero service calls. A second deterministic compliance-fixture hook changes status, role, or token version after the principal guard succeeds but before the service revalidator runs; each of the 16 routes must return the common 401/403, and CAS reservation, proxy, OAuth, account, healthcheck, cache, and scheduler counters all remain zero. The `CreateSession` row additionally blocks the active-group reader after its first successful service revalidation, mutates current authority, releases the group read, and proves the second revalidation rejects before provisional CAS or proxy creation. The role-loss row is 403; inactive, deleted, expired, token-version-drift, non-human, and service-caller rows are 401. These are the executable group/tenant-administrator denial rows: no test may fabricate a production role or policy table that the repository does not have. Assert the 16-route inventory so a path cannot silently remain under `adminAuth`, lose its compliance gate, or bypass service revalidation.

- [ ] **Step 4: Parse optimistic versions centrally**

```go
func parseFormalPoolIfMatch(c *gin.Context, required bool) (*int64, error) {
    raw := strings.TrimSpace(c.GetHeader("If-Match"))
    if raw == "" && !required { return nil, nil }
    if len(raw) < 3 || raw[0] != '"' || raw[len(raw)-1] != '"' { return nil, service.ErrFormalPoolOnboardingVersionRequired }
    version, err := strconv.ParseInt(raw[1:len(raw)-1], 10, 64)
    if err != nil || version < 0 { return nil, service.ErrFormalPoolOnboardingVersionRequired }
    return &version, nil
}
```

`CreateSession` requires version `0` plus one canonical `Idempotency-Key` of 16-128 URL-safe characters; missing/malformed keys return `428 FORMAL_POOL_IDEMPOTENCY_KEY_REQUIRED`. `GetSession` does not require a version; every POST under `/sessions/:id`, `/accounts/:id/healthcheck`, and the deprecated attestation POST requires a positive current version.

- [ ] **Step 5: Consume the guard-stored principal in all admin handler calls**

Add one handler helper that reads the already authorized principal only through `FormalPoolOnboardingPrincipalFromGin`, parses `If-Match`, and returns `service.WithFormalPoolRequestAuthority(c.Request.Context(), ...)`. A missing private Gin principal is the common 401 and must not trigger resolver lookup. No handler method or constructor stores or calls `FormalPoolOnboardingPrincipalResolver`. No handler method or constructor stores or calls `FormalPoolOnboardingPrincipalRevalidator`. A code-search assertion over `backend/internal/handler/admin/formal_pool_onboarding_handler.go` permits only `FormalPoolOnboardingPrincipalFromGin` and rejects both authority interface names. Apply the helper to these exact operations: `CreateSession`, `GetSession`, `TestProxy`, `BrowserEgressAttestation`, `GenerateAuthURL`, `ExchangeCodeAndCreate`, `SetupTokenCookieAuthAndCreate`, `Acceptance`, `Activate`, `RefreshOnly`, `RuntimeRegister`, `Healthcheck`, `StartWarming`, `PromoteProduction`, `Abort`, and `AccountHealthcheck`. `BrowserEgressCheck` remains public nonce-capability handling and never uses admin principal headers.

- [ ] **Step 6: Enforce owner/state/version before dependencies in every service operation**

Use this state contract exactly:

| Operation | Allowed state before dependency work |
| --- | --- |
| `TestProxy` | `draft`, `proxy_verified` |
| `AttestBrowserEgress` | `proxy_verified` |
| `GenerateAuthURL` | `browser_egress_verified` |
| `ExchangeCodeAndCreate`, `SetupTokenCookieAuthAndCreate` | `oauth_url_generated`, `proxy_verified` respectively |
| `RunAcceptance`, `RefreshOnly`, `RunHealthcheck` | imported/refreshed/runtime-registered states already accepted by current flow |
| `RegisterRuntime` | `refreshed` |
| `Activate` | pending-acceptance/healthcheck-passed states already accepted by current flow |
| `StartWarming` | accepted/healthcheck-passed |
| `PromoteProduction` | `warming` |
| `AbortSession` | every nonterminal state |
| `AccountHealthcheck` | owner session resolved through `snapshotByAccountID` |

The handler transports the guard-created authority snapshot without re-fetching or resolving. For every object read and mutation, the service first performs static identity/owner checks, then synchronously calls its narrow revalidator before state/version evaluation, reservation, or dependency work. `authorizeCreate` revalidates once before active-group lookup and again after that lookup immediately before provisional creation reservation; `authorizeSession` revalidates after record/static-owner checks; `authorizeAccount` revalidates after resolving and statically authorizing the owning session. A concurrent status/role/token-version/expiry change returns the same 401/403 before reservation and before any business dependency. Classify operations before implementation:

- no external effect (`AbortSession`, proof finalization after a server proof already exists): one final `casUpdate` is sufficient;
- any OAuth, proxy, account persistence, refresh, CC Gateway, healthcheck, cache, or scheduler call: call `beginReservedMutation` before the first dependency invocation, execute the dependency sequence once, then call `finishReservedMutation` from the reservation version;
- public `VerifyBrowserEgressByNonce` acquires its own CAS reservation before the proxy IP probe; every admin mutation rejects that reservation, and a concurrent public caller returns the same enumeration-resistant pending envelope without a second probe;
- dependency failure before any irreversible call may finalize a stable failure and return the latest version; an error after an irreversible/ambiguous call finalizes `operation_outcome_unknown`, blocks automatic retry, and requires explicit operator reconciliation.

Add a table-driven concurrency test for every side-effect family. The fake dependency blocks on a channel after incrementing an atomic counter. Start request A with version `N`, wait until its reservation is visible, then start request B with the same version. B must return `FORMAL_POOL_ONBOARDING_VERSION_CONFLICT` while the dependency counter remains `1`. Release A, assert one final state transition, `ActiveOperation == nil`, and response version `N+2`. Add failure tests proving no automatic retry after `operation_outcome_unknown` and no owner/state/version detail leakage.

`ExchangeCodeAndCreate` and `PromoteProduction` additionally require an `Idempotency-Key`. Persist only its HMAC safe ref plus a request fingerprint in the reservation/outcome. An exact duplicate while active returns the same safe pending session/version; an exact post-success duplicate returns the stored safe result; a changed fingerprint returns 409. Tests run both operations concurrently and prove one OAuth/account or scheduler invocation. No raw OAuth code or idempotency key is persisted or logged.

- [ ] **Step 7: Add response versions and `If-Match` to the frontend API**

```typescript
export interface FormalPoolSession {
  id: string
  version: number
  status: string
  // Existing fields remain.
}

export interface FormalPoolMutationResult {
  version: number
  status: string
}

export interface FormalPoolAcceptanceResult extends FormalPoolMutationResult {
  // Existing acceptance fields remain.
}

function versionHeaders(session: Pick<FormalPoolSession, 'version'>) {
  return { headers: { 'If-Match': `"${session.version}"` } }
}

export async function testProxy(session: FormalPoolSession): Promise<FormalPoolSession> {
  const { data } = await apiClient.post<FormalPoolSession>(
    `/admin/claude-onboarding/sessions/${session.id}/test-proxy`, {}, versionHeaders(session),
  )
  return data
}
```

`createSession` sends `If-Match: "0"` and one `Idempotency-Key` generated once per submitted wizard attempt with `crypto.randomUUID()`; retries reuse it until a definitive response or explicit form reset. Convert `generateAuthUrl`, `exchangeCodeAndCreate`, `setupTokenCookieAuthAndCreate`, `runAcceptance`, `activate`, `refreshOnly`, `runtimeRegister`, `healthcheck`, `startWarming`, `promoteProduction`, and `abort` to accept the current session and send `versionHeaders(session)`. `exchangeCodeAndCreate` and `promoteProduction` also reuse one operation idempotency key across ambiguous retries. Every successful mutation response, including `FormalPoolAcceptanceResult`, carries the final server version. In this task, migrate both wizard call sites and polling state so `npm run typecheck` is green: every mutation passes the current session, both wizards replace `session.value.version` from the response before enabling the next action, and acceptance/healthcheck merge `{version,status}` instead of retaining a stale session. On any 409 or ambiguous mutation error, refetch `getSession` before exposing retry. `getSession(id, signal)` remains version-free so polling can observe a server-side nonce transition. Task 4 adds only server-proof auto-finalization behavior; it does not repair these call sites later.

- [ ] **Step 8: Run the B2 matrix, service tests, and frontend typecheck**

Run: `cd backend && go test ./internal/service ./internal/server/middleware ./internal/server/routes ./internal/handler/... -run 'FormalPoolOnboarding|ProvideFormalPoolOnboarding|JWTAuth' -count=1`

Run: `cd backend && go generate ./cmd/server && go test ./cmd/server -count=1`

Run: `cd frontend && npm run typecheck`

Expected: both PASS. The exact 15-route cross-product returns 401 for missing/revoked/expired JWTs and Admin API Key service callers, 403 for valid non-admin JWTs before compliance (including would-be group/tenant administrator fixtures and cross-boundary labels), 423 only for an authorized system admin missing compliance acknowledgment, 401/403 for concurrently invalidated authority according to status/token-version versus role failure, and 409 for stale or conflicting versions only after authority and compliance succeed. Combined owner+stale+wrong-state cases return 403 with zero dependency calls. Duplicate OAuth callback and concurrent promote are idempotent with one dependency call. A sequential `runAcceptance -> startWarming` frontend test proves the second call uses the acceptance result's new version and does not 409.

- [ ] **Step 9: Commit Task 2**

```bash
git add backend/internal/handler/admin/formal_pool_onboarding_principal.go backend/internal/handler/admin/formal_pool_onboarding_handler.go backend/internal/handler/wire.go backend/internal/config/config.go backend/internal/service/formal_pool_onboarding_authorization.go backend/internal/service/formal_pool_onboarding_service.go backend/internal/service/wire.go backend/internal/server/middleware/auth_subject.go backend/internal/server/middleware/jwt_auth.go backend/internal/server/middleware/jwt_auth_test.go backend/internal/server/middleware/formal_pool_onboarding_auth.go backend/internal/server/middleware/formal_pool_onboarding_auth_test.go backend/internal/server/middleware/wire.go backend/internal/server/http.go backend/internal/server/router.go backend/internal/server/routes/admin.go backend/internal/server/routes/formal_pool_onboarding_auth_integration_test.go backend/internal/server/routes/formal_pool_onboarding_phase0_red_test.go backend/internal/server/routes/formal_pool_onboarding_routes_test.go backend/internal/handler/formal_pool_onboarding_provider_test.go backend/cmd/server/wire_gen.go frontend/src/api/admin/claudeOnboarding.ts frontend/src/composables/useEgressCheckPolling.ts frontend/src/components/account/ClaudeFormalPoolOnboardingWizard.vue frontend/src/components/account/ClaudeFormalPoolOnboardingWizardV2.vue frontend/src/composables/__tests__/useEgressCheckPolling.spec.ts frontend/src/components/account/__tests__/ClaudeFormalPoolOnboardingWizardV2.spec.ts
git commit -m "feat(formal-pool): enforce owner and version on every onboarding route"
```

### Task 3: B1 Server-Verified Browser Egress and Single-Use Finalization

**Files:**
- Modify: `backend/internal/service/formal_pool_onboarding_store.go:34-191`
- Modify: `backend/internal/service/formal_pool_onboarding_service.go:165-168,418-678`
- Modify: `backend/internal/handler/admin/formal_pool_onboarding_handler.go:95-141`
- Modify: `backend/internal/service/formal_pool_onboarding_phase0_red_test.go:1-88`
- Modify: `backend/internal/service/formal_pool_onboarding_service_test.go`
- Test: `backend/internal/service/formal_pool_onboarding_phase0_red_test.go`

**Interfaces:**
- Consumes: Task 2 owner/version authority.
- Produces: server-observed status `verified_pending_finalize`, one-use `verification_code`, `authorizeBrowserEgressOwner`, `authorizeBrowserEgressVersionAndState`, consumed-proof replay rejection, and final `browser_egress_verified` state.

- [ ] **Step 1: Convert the B1 RED corpus to the required two-step success path**

Remove only the build tag. For the positive/replay case, call `VerifyBrowserEgressByNonce(ctx, proof, "198.51.100.10")` before `AttestBrowserEgress`; carry the returned version into the authority context. Keep arbitrary, modified, expired, replayed, cross-session, and pre-proxy-change proof cases. Add one case asserting that the correct proof is rejected before the server-side IP/proxy check.

Add an exact error-reason matrix after the first successful consume:

| Caller/proof/version | Required reason |
| --- | --- |
| owner, exact consumed proof, old consume-input version | `FORMAL_POOL_BROWSER_PROOF_REJECTED` |
| owner, exact consumed proof, current post-consume version | `FORMAL_POOL_BROWSER_PROOF_REJECTED` |
| different owner, exact consumed proof, either version | `FORMAL_POOL_FORBIDDEN` |
| statically matching owner revoked/inactive/expired/token-version-changed after guard, exact consumed proof | `FORMAL_POOL_AUTH_REQUIRED` |
| statically matching owner loses system-admin role after guard, exact consumed proof | `FORMAL_POOL_FORBIDDEN` |
| owner, different proof, old consume-input version | `FORMAL_POOL_ONBOARDING_VERSION_CONFLICT` |

```go
func requireFormalPoolReason(t *testing.T, err error, reason string) {
    t.Helper()
    var appErr *infraerrors.ApplicationError
    require.ErrorAs(t, err, &appErr)
    require.Equal(t, reason, appErr.Reason)
}

func TestFormalPoolConsumedBrowserProofReplayReasonPrecedesOnlyVersionAndState(t *testing.T) {
    svc, owner, observed, proof := newServerObservedBrowserProofFixture(t)
    consumeInputVersion := observed.Version
    consumed, err := svc.AttestBrowserEgress(
        formalPoolAuthorityContext(owner, consumeInputVersion), observed.ID,
        FormalPoolBrowserEgressAttestationRequest{Confirmed: true, VerificationCode: proof},
    )
    require.NoError(t, err)

    _, err = svc.AttestBrowserEgress(
        formalPoolAuthorityContext(owner, consumeInputVersion), observed.ID,
        FormalPoolBrowserEgressAttestationRequest{Confirmed: true, VerificationCode: proof},
    )
    requireFormalPoolReason(t, err, "FORMAL_POOL_BROWSER_PROOF_REJECTED")

    _, err = svc.AttestBrowserEgress(
        formalPoolAuthorityContext(owner, consumed.Version), observed.ID,
        FormalPoolBrowserEgressAttestationRequest{Confirmed: true, VerificationCode: proof},
    )
    requireFormalPoolReason(t, err, "FORMAL_POOL_BROWSER_PROOF_REJECTED")

    intruder := owner
    intruder.SubjectID++
    _, err = svc.AttestBrowserEgress(
        formalPoolAuthorityContext(intruder, consumeInputVersion), observed.ID,
        FormalPoolBrowserEgressAttestationRequest{Confirmed: true, VerificationCode: proof},
    )
    requireFormalPoolReason(t, err, "FORMAL_POOL_FORBIDDEN")

    _, err = svc.AttestBrowserEgress(
        formalPoolAuthorityContext(owner, consumeInputVersion), observed.ID,
        FormalPoolBrowserEgressAttestationRequest{Confirmed: true, VerificationCode: proof + "0"},
    )
    requireFormalPoolReason(t, err, "FORMAL_POOL_ONBOARDING_VERSION_CONFLICT")
}
```

- [ ] **Step 2: Run the B1 corpus and confirm manual confirmation is still authoritative**

Run: `cd backend && go test ./internal/service -run '^TestFormalPoolBrowserEgressAttestationRejectsUntrustedProofs$' -count=1`

Expected: FAIL because a correct/nonempty code can still promote without server observation and replay remains accepted after current state handling.

- [ ] **Step 3: Add explicit proof lifecycle fields**

```go
type formalPoolOnboardingSessionRecord struct {
    BrowserNonce              string
    NonceExpiresAt            time.Time
    BrowserProofConsumedHash  string
    BrowserProofConsumedAt    time.Time
    BrowserVerified           bool
    BrowserEgressCheckStatus  string
    BrowserEgressObservedAt   time.Time
    // Existing safe bucket/error fields remain.
}
```

`TestProxy` always creates a new 128-bit nonce and clears `BrowserProofConsumedHash`, `BrowserProofConsumedAt`, observation fields, buckets, errors, and final verification. This invalidates every earlier proof even when the proxy ID is unchanged.

- [ ] **Step 4: Separate observation from finalization**

Before calling the proxy observer, `VerifyBrowserEgressByNonce` snapshots by nonce and CAS-installs `ActiveOperation=browser_egress_verify`, advancing the version once. If another verifier already owns the reservation, return the same safe pending envelope and do not call the proxy. The owner calls the observer once and finalizes match/mismatch/expiry from the reservation version, clearing `ActiveOperation`. On a match it sets `BrowserEgressCheckStatus = "verified_pending_finalize"`, records safe buckets and `BrowserEgressObservedAt`, but leaves `BrowserVerified = false` and session status `proxy_verified`. A repeated public check returns the same safe success envelope without another proxy call, proof mint, or version advance.

Add a blocking-proxy concurrency test: two simultaneous public checks for one nonce increment the proxy observer counter once, expose no owner/version/conflict detail, and end with one finalized observation. Add an interleaving test proving an admin mutation started during the verifier reservation fails before its dependency and succeeds only after polling the new version.

- [ ] **Step 5: Make attestation a server-gated one-time consume**

```go
func (s *FormalPoolOnboardingService) AttestBrowserEgress(ctx context.Context, id string, req FormalPoolBrowserEgressAttestationRequest) (*FormalPoolOnboardingSession, error) {
    authority, snap, err := s.authorizeBrowserEgressOwner(ctx, id)
    if err != nil { return nil, err }
    proof := strings.TrimSpace(req.VerificationCode)

    // Sole exception: static owner and current authority are already proven, so
    // exact consumed proof is classified before version or terminal state.
    if proof != "" && consumedBrowserProofMatches(snap, proof) {
        return nil, ErrFormalPoolOnboardingProofRejected
    }

    snap, err = s.authorizeBrowserEgressVersionAndState(
        authority, snap, FormalPoolOnboardingStatusProxyVerified,
    )
    if err != nil { return nil, err }
    if !req.Confirmed || proof == "" || nonceExpired(snap, s.store.now()) {
        return nil, ErrFormalPoolOnboardingProofRejected
    }
    if snap.BrowserEgressCheckStatus != "verified_pending_finalize" || !constantTimeEqual(proof, snap.BrowserNonce) {
        return nil, ErrFormalPoolOnboardingProofRejected
    }
    return s.store.casUpdate(snap.ID, snap.Version, func(rec *formalPoolOnboardingSessionRecord) error {
        rec.BrowserProofConsumedHash = formalPoolProofDigest(proof)
        rec.BrowserProofConsumedAt = s.store.now()
        rec.BrowserNonce = ""
        rec.BrowserVerified = true
        rec.BrowserVerifiedAt = s.store.now()
        rec.BrowserEgressCheckStatus = "verified"
        rec.Status = FormalPoolOnboardingStatusBrowserEgressVerified
        return nil
    })
}

func consumedBrowserProofMatches(rec *formalPoolOnboardingSessionRecord, proof string) bool {
    if rec.BrowserProofConsumedHash == "" || proof == "" { return false }
    return constantTimeEqual(formalPoolProofDigest(proof), rec.BrowserProofConsumedHash)
}
```

`authorizeBrowserEgressOwner` performs context presence, record lookup, the complete static subject/admin/tenant/group/creator/role comparison, and then exactly one service-level `PrincipalRevalidator.Revalidate` call. It returns the common authentication/forbidden errors and does not inspect proof, expected version, or state. `authorizeBrowserEgressVersionAndState` then requires `ExpectedVersion`, compares it, and validates `proxy_verified`. Its complete order is `context -> record -> static owner -> service-level principal revalidation -> consumed-proof replay -> expected-version -> allowed-state -> remaining-proof-validation -> CAS`. Do not call generic `authorizeSession` before `consumedBrowserProofMatches`, and do not reuse this split ordering for any other mutation. Tests revoke/inactivate/expire the owner, change token version, and remove the admin role after the guard snapshot; all must beat exact consumed-proof classification and leave the attestation CAS counter at zero.

Use `crypto/subtle.ConstantTimeCompare`. Define `formalPoolProofDigest(proof string) string { return formalPoolSafeRef("browser_proof_consumed", proof) }`; it persists only the existing HMAC safe-ref form, never a raw proof. When the supplied digest equals the consumed digest, return the same safe `FORMAL_POOL_BROWSER_PROOF_REJECTED` reason for both old and current versions. A nonmatching proof continues through the generic version/state ordering and cannot use this exception to hide a stale version or wrong state.

Define `ErrFormalPoolOnboardingProofRejected = infraerrors.BadRequest("FORMAL_POOL_BROWSER_PROOF_REJECTED", "browser egress proof was rejected")` and `constantTimeEqual(left, right string) bool` as a length check followed by `subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1`.

- [ ] **Step 6: Verify B1 and existing public-route safety tests**

Run: `cd backend && go test ./internal/service ./internal/server/routes -run 'BrowserEgress|Nonce|PublicRoute' -count=1`

Expected: PASS. The final session response omits raw nonce, proof hash, remote IP, and owner data.

- [ ] **Step 7: Commit Task 3**

```bash
git add backend/internal/service/formal_pool_onboarding_store.go backend/internal/service/formal_pool_onboarding_service.go backend/internal/handler/admin/formal_pool_onboarding_handler.go backend/internal/service/formal_pool_onboarding_phase0_red_test.go backend/internal/service/formal_pool_onboarding_service_test.go
git commit -m "fix(formal-pool): require server-observed one-time egress proof"
```

### Task 4: B1 Frontend Auto-Finalization Without Client-Chosen Authority

**Files:**
- Modify: `frontend/src/composables/useEgressCheckPolling.ts:8-98`
- Modify: `frontend/src/components/account/ClaudeFormalPoolOnboardingWizard.vue:148-204`
- Modify: `frontend/src/components/account/ClaudeFormalPoolOnboardingWizardV2.vue:532-584,1205-1285`
- Modify: `frontend/src/composables/__tests__/useEgressCheckPolling.spec.ts`
- Modify: `frontend/src/components/account/__tests__/ClaudeFormalPoolOnboardingWizardV2.spec.ts`

**Interfaces:**
- Consumes: Task 3 `verified_pending_finalize`, session version, and server-minted nonce URL.
- Produces: one automatic finalization call per `{session id, version, proof}` tuple.

- [ ] **Step 1: Write a V2 RED test for one-shot auto-finalization**

Mock polling to return `browser_egress_check_status: 'verified_pending_finalize'`, `browser_egress_verified: false`, current `version`, and a server URL ending in the nonce. Assert `attestBrowserEgress(session, nonce)` is called exactly once, its returned newer session replaces local state, and a repeated identical poll does not call it again.

- [ ] **Step 2: Run the focused frontend tests**

Run: `cd frontend && npm run test:run -- src/components/account/__tests__/ClaudeFormalPoolOnboardingWizardV2.spec.ts src/composables/__tests__/useEgressCheckPolling.spec.ts`

Expected: FAIL because no automatic server-proof finalization exists.

- [ ] **Step 3: Add strict proof extraction and one-shot guard**

```typescript
function serverProofFromBrowserURL(raw: string | undefined): string {
  if (!raw) return ''
  const parsed = new URL(raw, window.location.origin)
  const parts = parsed.pathname.split('/').filter(Boolean)
  const proof = parts.at(-1) ?? ''
  return /^nonce_[0-9a-f]{32}$/.test(proof) ? proof : ''
}

const finalizingProofKey = ref('')

async function finalizeObservedBrowserEgress(next: FormalPoolSession) {
  if (next.browser_egress_check_status !== 'verified_pending_finalize' || next.browser_egress_verified) return
  const proof = serverProofFromBrowserURL(next.browser_egress_check_url)
  const key = `${next.id}:${next.version}:${proof}`
  if (!proof || finalizingProofKey.value === key) return
  finalizingProofKey.value = key
  const finalized = await run(() => claudeOnboarding.attestBrowserEgress(next, proof))
  if (finalized) session.value = finalized
}
```

Call this only from the polling watcher after merging the newest session. Clear the guard when `TestProxy` returns a new version/proof. Do not render a free-form attestation-code input.

- [ ] **Step 4: Add auto-finalization to both already-migrated wizards and preserve version monotonicity**

Task 2 already made every mutation pass the current session object. Here, polling accepts a session only when its `version >= local.version`; a stale response cannot overwrite a newer finalized session. The legacy wizard uses the same polling/finalization path and removes `attestationCode` plus its manual confirmation control.

- [ ] **Step 5: Run frontend tests, typecheck, and build**

Run: `cd frontend && npm run test:run -- src/components/account/__tests__/ClaudeFormalPoolOnboardingWizardV2.spec.ts src/composables/__tests__/useEgressCheckPolling.spec.ts`

Run: `cd frontend && npm run typecheck && npm run build`

Expected: PASS. No rendered control accepts client-chosen egress confirmation text.

- [ ] **Step 6: Commit Task 4**

```bash
git add frontend/src/composables/useEgressCheckPolling.ts frontend/src/components/account/ClaudeFormalPoolOnboardingWizard.vue frontend/src/components/account/ClaudeFormalPoolOnboardingWizardV2.vue frontend/src/composables/__tests__/useEgressCheckPolling.spec.ts frontend/src/components/account/__tests__/ClaudeFormalPoolOnboardingWizardV2.spec.ts
git commit -m "fix(frontend): finalize only server-observed browser egress"
```

### Task 5: B3 Configured Public-Origin Authority

**Files:**
- Modify: `backend/internal/config/config.go:169-181`
- Modify: `backend/internal/service/formal_pool_config.go:12-90`
- Modify: `backend/internal/service/wire.go:71-150`
- Modify: `backend/internal/handler/admin/formal_pool_onboarding_handler.go:212-268`
- Modify: `deploy/config.example.yaml`
- Modify: `backend/internal/server/routes/formal_pool_onboarding_phase0_red_test.go:158-197`
- Modify: `backend/internal/server/routes/formal_pool_onboarding_routes_test.go`
- Test: `backend/internal/server/routes/formal_pool_onboarding_phase0_red_test.go`

**Interfaces:**
- Produces: `FormalPoolRuntimeConfig.PublicOrigin` and `NormalizeFormalPoolPublicOrigin`.
- Consumes: existing `FormalPoolOnboardingDeps.PublicURLPrefix` and `browserURL`.

- [ ] **Step 1: Run the always-on B3 corpus and preserve the current failure**

Run: `cd backend && go test ./internal/server/routes -run '^TestFormalPoolOnboardingPublicOriginAuthority$' -count=1`

Expected: FAIL for hostile `Host`, `X-Forwarded-Host`, or `X-Forwarded-Proto` mutations.

- [ ] **Step 2: Add strict public-origin normalization**

```go
func NormalizeFormalPoolPublicOrigin(raw string) (string, error) {
    parsed, err := url.Parse(strings.TrimSpace(raw))
    if err != nil || parsed.Opaque != "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
        return "", fmt.Errorf("invalid formal_pool public_origin")
    }
    host := parsed.Hostname()
    loopback := host == "localhost" || (net.ParseIP(host) != nil && net.ParseIP(host).IsLoopback())
    if parsed.Scheme != "https" && !(parsed.Scheme == "http" && loopback) {
        return "", fmt.Errorf("formal_pool public_origin requires https except loopback")
    }
    if parsed.Host == "" { return "", fmt.Errorf("formal_pool public_origin requires host") }
    return parsed.Scheme + "://" + parsed.Host, nil
}
```

Add `PublicOrigin string \`mapstructure:"public_origin"\``. `formalPoolConfigFromAppConfig` validates it, and `ProvideFormalPoolOnboardingService` passes it as `PublicURLPrefix`.

- [ ] **Step 3: Remove all request-derived authority**

`withAbsoluteBrowserEgressURL` must never call `formalPoolRequestPublicBaseURL`. If the service returns a relative URL because no origin is configured, leave it relative. If it returns an absolute URL, accept only `https`, or `http` on loopback. `Host` and every `X-Forwarded-*` header are ignored for this feature in Phase 1.

- [ ] **Step 4: Extend config and mutation tests**

Cover: configured HTTPS origin, loopback HTTP, userinfo, path, query, fragment, non-loopback HTTP, hostile Host, hostile forwarded host/proto, and missing origin returning a relative URL whose authority does not change between requests.

- [ ] **Step 5: Run B3 and full formal-pool backend regression**

Run: `cd backend && go test ./internal/service ./internal/server/routes -run 'FormalPoolOnboarding|FormalPoolPublicOrigin' -count=1`

Expected: PASS. The configured origin wins byte-for-byte and hostile request headers never enter the response.

- [ ] **Step 6: Commit Task 5**

```bash
git add backend/internal/config/config.go backend/internal/service/formal_pool_config.go backend/internal/service/wire.go backend/internal/handler/admin/formal_pool_onboarding_handler.go deploy/config.example.yaml backend/internal/server/routes/formal_pool_onboarding_phase0_red_test.go backend/internal/server/routes/formal_pool_onboarding_routes_test.go
git commit -m "fix(formal-pool): make configured public origin authoritative"
```

### Task 6: CC Gateway Listener and Upstream Certificate Startup Gates

**Files:**
- Create: `src/listener-boundary.ts`
- Create: `src/upstream-tls-boundary.ts`
- Create: `tests/listener-boundary.test.ts`
- Create: `tests/upstream-tls-boundary.test.ts`
- Modify: `src/config.ts:73-82,582-618`
- Modify: `src/proxy.ts:246-284,2186-2193`
- Modify: `tests/helpers.ts:36-79`
- Modify: `tests/security-boundary.test.ts`
- Modify: `config.example.yaml:4-10`
- Modify: `config.sub2api.formal-pool.example.yaml:4-10`
- Modify: `sidecar/egress-tls-sidecar/cmd/egress-tls-sidecar/main.go:16-105`
- Modify: `sidecar/egress-tls-sidecar/cmd/egress-tls-sidecar/main_test.go`
- Modify: `sidecar/egress-tls-sidecar/internal/tlsengine/utls_engine.go:25-165`
- Modify: `sidecar/egress-tls-sidecar/internal/tlsengine/utls_engine_test.go`

**Interfaces:**
- Produces: `RemoteListenConfig`, `ApprovedNetworkExposurePolicyRef`, `ListenerBoundary`, `resolveListenerBoundary(config)`, `resolveUpstreamTLSBoundary(config, env)`, the test-observable `ProxyStartupPrimitives`, and sidecar `validatedProductionTrustEnvironment`/`utlsConfigForRequest`.
- Consumes: existing `ConfigValidationError`, auth tokens, inbound TLS paths, upstream mode/URL, `startProxy`, Node `https.request`, sidecar `buildConfigFromEnv`/`dialUTLS`, and Node server `address()`.

- [ ] **Step 1: Write the listener RED corpus before changing config**

```typescript
test('omitted host binds IPv4 loopback from observed socket state', async () => {
  const server = startProxy(baseConfig({ server: { port: 0, tls: { cert: '', key: '' } } }))
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  assert.equal(address.address, '127.0.0.1')
  await close(server)
})

test('bracketed IPv6 loopback is normalized for Node listen', () => {
  const config = baseConfig({ server: { port: 0, host: '[::1]', tls: { cert: '', key: '' } } })
  assert.deepEqual(resolveListenerBoundary(config), { host: '::1', remote: false })
})

for (const [name, mutate, code] of remoteFailures) {
  test(name, () => assert.throws(() => resolveListenerBoundary(mutate(remoteConfig())),
    (error: ConfigValidationError) => error.code === code))
}

function remoteConfig(): Config {
  return baseConfig({
    mode: 'standalone',
    server: {
      port: 0,
      host: '0.0.0.0',
      tls: { cert: 'fixture-cert.pem', key: 'fixture-key.pem' },
      remote_listen: { capability: 'remote-listen-v1', exposure_policy_ref: 'network-exposure-policy:private-ingress-v1' },
    },
    auth: { tokens: [{ name: 'client', token: 'remote-client-material-1234567890abcdef' }] },
  })
}

const remoteFailures: Array<[string, (config: Config) => Config, string]> = [
  ['remote capability is required', (config) => ({ ...config, server: { ...config.server, remote_listen: {} } }), 'remote_listen_capability_required'],
  ['remote TLS is required', (config) => ({ ...config, server: { ...config.server, tls: { cert: '', key: '' } } }), 'remote_listen_tls_required'],
  ['remote auth is required when no credential exists', (config) => ({ ...config, auth: { gateway_token: '', internal_control_token: '', tokens: [] } }), 'remote_listen_strong_auth_required'],
  ['remote strong auth is required', (config) => ({ ...config, auth: { tokens: [{ name: 'client', token: 'weak' }] } }), 'remote_listen_strong_auth_required'],
  ['Sub2API remote internal auth is required', (config) => ({ ...config, mode: 'sub2api', auth: { gateway_token: 'remote-gateway-material-1234567890abcdef', internal_control_token: '', tokens: [] } }), 'remote_listen_strong_auth_required'],
  ['remote exposure policy is required', (config) => ({ ...config, server: { ...config.server, remote_listen: { capability: 'remote-listen-v1' } } }), 'remote_listen_exposure_policy_required'],
  ['syntactic but unapproved policy is rejected', (config) => ({ ...config, server: { ...config.server, remote_listen: { capability: 'remote-listen-v1', exposure_policy_ref: 'network-exposure-policy:invented-v1' } } }), 'remote_listen_exposure_policy_unapproved'],
]
```

The mutation table independently removes capability, cert/key, strong client auth, internal control auth in Sub2API mode, and exposure policy. It also proves a regex-shaped but unregistered policy is rejected.

In `tests/upstream-tls-boundary.test.ts`, add a table that sets production or real-canary mode and independently mutates: `http:` upstream, `upstream.tls.verification != required`, `upstream.tls.trust_store != system`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, non-empty `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, or `SSL_CERT_DIR`. Every case must fail before server/socket/request creation with a stable secret-safe code. A positive fixture returns `{ rejectUnauthorized: true }`.

- [ ] **Step 2: Run the listener corpus and confirm wildcard/default gaps**

Run: `npm exec tsx tests/listener-boundary.test.ts && npm exec tsx tests/upstream-tls-boundary.test.ts`

Expected: FAIL because both resolvers are absent and omitted host is not forced to loopback.

- [ ] **Step 3: Add the pure listener boundary resolver**

```typescript
export type ApprovedNetworkExposurePolicyRef = 'network-exposure-policy:private-ingress-v1'

export type RemoteListenConfig = {
  capability?: 'remote-listen-v1'
  exposure_policy_ref?: ApprovedNetworkExposurePolicyRef | string
}

const APPROVED_NETWORK_EXPOSURE_POLICY_REFS = new Set<ApprovedNetworkExposurePolicyRef>([
  'network-exposure-policy:private-ingress-v1',
])

export type ListenerBoundary = { host: string; remote: boolean }

export function resolveListenerBoundary(config: Config): ListenerBoundary {
  const configuredHost = String(config.server.host || '').trim() || '127.0.0.1'
  const host = configuredHost === '[::1]' ? '::1' : configuredHost
  if (host === '127.0.0.1' || host === '::1') return { host, remote: false }
  const remote = config.server.remote_listen
  if (remote?.capability !== 'remote-listen-v1') throw new ConfigValidationError('remote_listen_capability_required')
  if (!config.server.tls?.cert || !config.server.tls?.key) throw new ConfigValidationError('remote_listen_tls_required')
  if (!hasStrongRemoteAuth(config)) throw new ConfigValidationError('remote_listen_strong_auth_required')
  if (!remote?.exposure_policy_ref) throw new ConfigValidationError('remote_listen_exposure_policy_required')
  if (!APPROVED_NETWORK_EXPOSURE_POLICY_REFS.has(remote.exposure_policy_ref as ApprovedNetworkExposurePolicyRef)) {
    throw new ConfigValidationError('remote_listen_exposure_policy_unapproved')
  }
  return { host, remote: true }
}
```

`hasStrongRemoteAuth` requires each active client/gateway token used by the mode to contain at least 32 characters, rejects `change-me|placeholder|example|sample|dummy|test`, and in Sub2API mode also requires an independent 32-character `internal_control_token`. The exposure-policy registry is code-owned and exact; adding a policy requires a reviewed source change and corpus case, not a config-only string. Error messages contain only stable codes.

- [ ] **Step 4: Add explicit real-upstream certificate policy**

Add `upstream.tls.verification?: 'required'` and `upstream.tls.trust_store?: 'system'` to `Config`. For `shared_pool.upstream_mode` equal to `real-canary` or `production`, `resolveUpstreamTLSBoundary` requires `https:`, those two exact values, and no unsafe process trust override. Reject `NODE_TLS_REJECT_UNAUTHORIZED=0` case-insensitively and any non-empty `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, or `SSL_CERT_DIR`. Do not persist environment values in errors/evidence.

The returned request options contain `rejectUnauthorized: true`; spread them into direct `httpsRequest` options. HTTP is still allowed only for loopback mock modes. The resolver does not authorize real traffic: existing preflight/canary/production gates still run and production/real-canary remain disabled in this phase.

In the sidecar, extract a pure production trust-environment validator from `buildConfigFromEnv`. Production mode rejects custom/test root variables before `net.Listen`. Extract `utlsConfigForRequest(req)` and prove `InsecureSkipVerify == false` for every production request; it may be true only when both `DialAddress` is an explicit loopback test override and `AllowTestDialOverride` is true. Add a negative test for each single-condition mutation and preserve the existing raw-ClientHello test behavior.

- [ ] **Step 5: Add a behavior-preserving startup-primitives seam**

Add one optional, code-owned dependency argument to `startProxy`; production callers omit it and receive the frozen default. Do not move validation in this sub-step. Route only the four startup effects through this object: inbound TLS file reads, HTTP server creation, HTTPS server creation, and `listen`. The seam cannot override policy resolution, auth, host selection, or upstream TLS options.

```typescript
type ProxyRequestListener = (request: IncomingMessage, response: ServerResponse) => void
type ProxyStartupServer = ReturnType<typeof createHttpServer> | ReturnType<typeof createHttpsServer>

export type ProxyStartupPrimitives = Readonly<{
  readTLSFile: (path: string) => Buffer
  createHTTPServer: (handler: ProxyRequestListener) => ReturnType<typeof createHttpServer>
  createHTTPSServer: (options: ServerOptions, handler: ProxyRequestListener) => ReturnType<typeof createHttpsServer>
  listen: (server: ProxyStartupServer, port: number, host: string, ready: () => void) => void
}>

const DEFAULT_PROXY_STARTUP_PRIMITIVES: ProxyStartupPrimitives = Object.freeze({
  readTLSFile: (file) => readFileSync(file),
  createHTTPServer: createHttpServer,
  createHTTPSServer: createHttpsServer,
  listen: (server, port, host, ready) => { server.listen(port, host, ready) },
})
```

Run the existing proxy, health, and security tests before continuing. Expected: PASS, proving the default path has not changed.

- [ ] **Step 6: Add direct `startProxy` negative integration tests and confirm RED**

Keep the pure resolver unit table, then run the same `remoteFailures` mutations through `startProxy` itself. `observedStartupPrimitives()` returns inert fake servers and appends only `tls_read`, `http_server_create`, `https_server_create`, or `listen` when the corresponding primitive is invoked. It performs no file or socket operation.

```typescript
for (const [name, mutate, code] of remoteFailures) {
  test(`${name} is rejected by startProxy before startup effects`, () => {
    const observed = observedStartupPrimitives()
    assert.throws(
      () => startProxy(mutate(remoteConfig()), observed.primitives),
      (error: ConfigValidationError) => error.code === code,
    )
    assert.deepEqual(observed.calls, [])
  })
}
```

Add the equivalent direct-`startProxy` table for every production/real-canary upstream TLS mutation in `tests/upstream-tls-boundary.test.ts`. Each case must return its exact stable `ConfigValidationError` code and leave all four startup-effect counters at zero. Run both test files now. Expected: FAIL because the behavior-preserving seam observes TLS reads/server creation/listen before `startProxy` performs either defensive resolver call. A pure-resolver assertion alone does not satisfy this step.

- [ ] **Step 7: Validate all deployment boundaries at the top of `startProxy`**

`loadConfig` calls both resolvers after auth/mode parsing. The first executable statements in `startProxy` call both resolvers again, before `initAuth`, runtime-mapping replay, URL construction, any startup primitive, or any socket object. Use only the resolved host and upstream TLS options afterward.

```typescript
export function startProxy(config: Config, startup = DEFAULT_PROXY_STARTUP_PRIMITIVES) {
  const listenerBoundary = resolveListenerBoundary(config)
  const upstreamTLSBoundary = resolveUpstreamTLSBoundary(config, process.env)

  initAuth(config)
  replayRuntimeMappings(config)
  // Build handlers only after both defensive validations succeed.

  const tlsOptions = config.server.tls?.cert && config.server.tls?.key
    ? { cert: startup.readTLSFile(config.server.tls.cert), key: startup.readTLSFile(config.server.tls.key) }
    : undefined
  const server = tlsOptions
    ? startup.createHTTPSServer(tlsOptions, handler)
    : startup.createHTTPServer(handler)
  startup.listen(server, config.server.port, listenerBoundary.host, onListening)
  // Direct HTTPS requests consume upstreamTLSBoundary.requestOptions.
  return server
}
```

TLS paths may be deliberately nonexistent in negative fixtures: the required stable policy error, plus zero `tls_read`, proves boundary validation preceded filesystem access. Zero server-create and listen counters independently prove the remaining ordering. Sidecar `main` likewise validates production trust environment before `net.Listen`.

- [ ] **Step 8: Prove observed bind state, verified TLS options, and secret-safe failures**

Tests inspect `server.address()` for omitted host, `127.0.0.1`, and `::1`; a configured `[::1]` must resolve and bind as unbracketed `::1`, never reach Node DNS as a bracketed hostname. The direct `startProxy` negative tables must cover every listener and upstream mutation and assert zero TLS-read, server-create, and listen effects; do not substitute a pre-call to either pure resolver. Inject a secret canary as token/policy/trust-env suffix and assert thrown/logged text is exactly `config: <stable_code>` with no canary bytes. Node request-option tests assert `rejectUnauthorized: true`; sidecar tests assert production config never sets `InsecureSkipVerify` and unsafe trust env fails before the listen observer fires.

- [ ] **Step 9: Run listener, upstream TLS, sidecar, security, full CC tests, and build**

Run: `npm exec tsx tests/listener-boundary.test.ts`

Run: `npm exec tsx tests/upstream-tls-boundary.test.ts`

Run: `npm exec tsx tests/security-boundary.test.ts`

Run: `cd sidecar/egress-tls-sidecar && go test ./cmd/egress-tls-sidecar ./internal/tlsengine -count=1`

Run: `npm test`

Run: `npm run build`

Expected: all PASS; omitted host is proven as `127.0.0.1` from actual server state, syntactic-but-unapproved policies are RED, real modes expose only verified HTTPS request options, and the sidecar cannot enter production with insecure/custom test trust.

- [ ] **Step 10: Commit Task 6**

```bash
git add src/listener-boundary.ts src/upstream-tls-boundary.ts src/config.ts src/proxy.ts tests/listener-boundary.test.ts tests/upstream-tls-boundary.test.ts tests/helpers.ts tests/security-boundary.test.ts config.example.yaml config.sub2api.formal-pool.example.yaml sidecar/egress-tls-sidecar/cmd/egress-tls-sidecar/main.go sidecar/egress-tls-sidecar/cmd/egress-tls-sidecar/main_test.go sidecar/egress-tls-sidecar/internal/tlsengine/utls_engine.go sidecar/egress-tls-sidecar/internal/tlsengine/utls_engine_test.go
git commit -m "fix(security): fail closed on listener and upstream TLS boundaries"
```

### Task 7: Lightweight H1 Evidence Adapter and Hermetic Command Catalog

**Merged authority prerequisite:** `package.json` launches the full suite as `node --import tsx tests/run-all.ts`, without the `tsx` CLI IPC server. `tests/run-all.ts` is only an orchestrator. It invokes the reviewed `tests/suite-process-runner.ts`, which runs `tests/run-p0-1.ts` and then `tests/run-all.ts --exclude-oracle-p0-1` serially in two distinct child processes. `buildClosedFullSuiteEnvironment` constructs each default child environment from a fixed allowlist rather than copying `process.env`: the inventory-bound repository-local `node_modules/.bin`, fixed reviewed system tool paths, `/tmp` home/temp, C locale, UTC, user npm config `/dev/null`, global npm config `/nonexistent/oracle-lab-empty-global-npmrc`, offline Go/npm settings, an authenticated OS-account-derived Go module-cache realpath, `GOFLAGS=-mod=readonly`, one exclusive empty mode-0700 `mkdtemp` Go build cache, loopback-denial proxies, and optionally the dedicated `SUB2API_FORMAL_POOL_CONTRACT_PATH`. It omits `SUB2API_ROOT`, every `ORACLE_*`, `PHASE1_*`, `GIT_*`, and undeclared npm variable, and fails before spawn on startup injection, caller-selected cache, failed dependency authentication, or unsafe cache type/owner/mode/content. PID, environment-leak, child-order, abnormal-exit, nonzero-exit, exact allowlist, dependency-cache-unavailable, exclusive-cache, and startup-injection regression tests live in `tests/suite-process-runner.test.ts` and `tests/run-all-process-isolation.test.ts`. No top-level P0.1 assertion module shares a Node process with asynchronous `node:test` registration. Repeated P0.1 clone fixtures derive each temporary branch suffix from the already-created unique temporary parent and never force, delete, or reuse a prior fixture ref. The ignored-state build regression uses an actual fresh shared Git clone with no `dist`, invokes the reviewed TypeScript compiler twice, and proves seed output followed by byte/mode-stable repeat output. Mandatory Preflight retains `npm test` as GREEN only after three consecutive `env -i` isolated `npm test` runs pass on one unchanged clean HEAD.

**Files:**
- Create: `docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json`
- Create: `docs/superpowers/schemas/oracle-lab-phase-1-command-catalog.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-phase-1-exit.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-phase-1-results.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-phase-1-feature-review.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-phase-1-handoff.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-phase-1-integration-entry.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-phase-1-integration-receipt.schema.json`
- Create: `tools/oracle-lab/phase-1-evidence.ts`
- Create: `tools/oracle-lab/phase-1-loopback-sandbox.ts`
- Create: `tests/oracle-lab-phase-1-evidence.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: reviewed `runBoundedProcess`, `classifyBoundedProcess`, `runReviewedGit`, `assertNoGitReplacementRefs`, `computeIgnoredPathInventory`, `compareIgnoredPathInventories`, `HERMETIC_NETWORK_ENV`, `DISABLED_CAPABILITIES`, `writeExclusiveArtifact`, `canonicalJson`, `digestFile`, and `sha256` from P0.1/H0. The older `tools/claude-native-oracle-matrix.ts` profile is a discovery reference only; H1 accepts only the exact profile below after live canaries pass.
- Produces: `validatePhase1AuthorityRestartSource`, `buildPhase1AuthorityRestart`, `validatePhase1AuthorityRestart`, `validatePhase1AuthorityRestartPreCommit`, `validatePhase1AuthorityRestartPostCommit`, the closed authority-restart CLI dispatcher, `resolvePhase1LoopbackSandbox`, `runPhase1SandboxCanaries`, `wrapPhase1Command`, `parsePhase1RedFailureLeaves`, `canonicalizePhase1FailureEvents`, `parsePhase1TrackedTree`, `derivePhase1ImplementationTreeBinding`, `validatePhase1IgnoredSymlinkClosure`, `derivePhase1IgnoredStateBinding`, `comparePhase1IgnoredState`, `validatePhase1CatalogValue`, `validatePhase1CaptureInputs`, `captureAndRunPhase1`, `validatePhase1ResultsValue`, `validatePhase1FeatureEvidenceCommit`, `validatePhase1FeatureReviewValue`, `validatePhase1FeatureReviewAttestation`, `buildPhase1IntegrationEntry`, `validatePhase1IntegrationEntryValue`, `buildPhase1Handoff`, `validatePhase1HandoffValue`, `buildPhase1IntegrationReceipt`, `validatePhase1IntegrationReceiptValue`, `verifyPhase1FinalRemote`, `authorizePhase1Retry`, and deterministic Markdown rendering.
- Does not modify the Phase 0 command catalog, Registry v1 validators, P0.1 CLI, or their schemas.

- [ ] **Step 1: Write RED tests for the Phase 1 adapter contract**

In `tests/oracle-lab-phase-1-evidence.test.ts`, define `CC_RED_FAILURE_NAMES`, `SIDECAR_RED_FAILURE_NAMES`, `CC_RED_LIFECYCLE`, and `SIDECAR_RED_LIFECYCLE` as literal copies of the normative arrays/objects in Step 3 below. Do not derive expected fixtures from the catalog under test; the independent literals make catalog omission, addition, duplication, reordering, lifecycle, and count drift observable.

```typescript
const EXPECTED_COMMAND_IDS = [
  'sub-b1-b3', 'sub-formal-pool', 'sub-full-go', 'sub-frontend-h1',
  'sub-frontend-typecheck', 'sub-frontend-build', 'sub-frontend-build-repeat',
  'cc-listener-h1', 'cc-upstream-tls-h1',
  'cc-build', 'cc-build-repeat', 'cc-tests', 'cc-tests-repeat',
  'sidecar-tests', 'joint-local-chain', 'cc-b4-b6-red', 'sidecar-b5-b6-red',
]

const hasCode = (code: string) => (error: unknown) =>
  error instanceof Error && (error as Error & { code?: string }).code === code

const RED_SEMANTIC_MUTATIONS = [
  'missing_leaf', 'same_prefix_extra_leaf', 'unrelated_extra_leaf', 'duplicate_leaf_event',
  'wrong_event_count', 'wrong_unique_count', 'wrong_family', 'wrong_parser', 'wrong_lifecycle',
  'reordered_event_multiset', 'reordered_unique_names',
] as const

const IMPLEMENTATION_TREE_MUTATIONS = [
  'source_add', 'source_modify', 'source_delete', 'source_rename',
  'config_modify', 'test_modify', 'nonexcluded_docs_modify',
  'executable_mode_change', 'symlink_target_change', 'submodule_pointer_change',
  'excluded_evidence_change', 'excluded_governance_change', 'untracked_dirty_path',
] as const

const IGNORED_STATE_MUTATIONS = [
  'ignored_create', 'ignored_modify', 'ignored_delete', 'ignored_rename',
  'ignored_mode_change', 'ignored_type_change', 'ignored_symlink_target_change',
] as const

const RAW_TREE_STREAM_MUTATIONS = [
  'missing_nul', 'missing_tab', 'bad_field_count', 'invalid_oid', 'duplicate_path',
  'invalid_utf8_path', 'absolute_path', 'dotdot_path', 'non_normalized_path',
  'unsupported_mode', 'blob_with_submodule_mode', 'commit_without_submodule_mode',
  'phase1_prefix_collision', 'governance_suffix_collision',
] as const

const FEATURE_REVIEW_MUTATIONS = [
  'wrong_tested_cc_head', 'wrong_tested_sub2api_head',
  'wrong_candidate_cc_head', 'wrong_candidate_sub2api_head',
  'wrong_baseline_path', 'wrong_baseline_digest', 'wrong_results_path', 'wrong_results_digest',
  'wrong_context_path', 'wrong_context_digest', 'wrong_context_sequence', 'wrong_context_artifact_commit',
  'wrong_plan_review_path', 'wrong_plan_review_digest', 'wrong_plan_commit',
  'changes_requested', 'approved_nonzero_critical', 'approved_nonzero_important',
  'wrong_reviewer_identity', 'missing_review_scope', 'extra_review_scope', 'unknown_field',
  'tested_candidate_tree_mismatch',
] as const

test('Phase 1 catalog has exact IDs, groups, repositories, argv and expected exits', async () => {
  const catalog = await readJson(catalogPath)
  assert.deepEqual(catalog.map((entry: any) => entry.id), EXPECTED_COMMAND_IDS)
  assert.deepEqual(validatePhase1CatalogValue(catalog), { ok: true, errors: [] })
  const ccRed = catalog.find((entry: any) => entry.id === 'cc-b4-b6-red')
  const sidecarRed = catalog.find((entry: any) => entry.id === 'sidecar-b5-b6-red')
  assert.equal(ccRed.failure_parser, 'node_test_tap_v1')
  assert.deepEqual(ccRed.expected_parser_lifecycle, CC_RED_LIFECYCLE)
  assert.equal(ccRed.expected_failure_count, 61)
  assert.deepEqual(ccRed.expected_failure_names, CC_RED_FAILURE_NAMES)
  assert.deepEqual(ccRed.expected_failure_families, ['B4', 'B5', 'B6'])
  assert.equal(sidecarRed.failure_parser, 'go_test_json_leaf_v1')
  assert.deepEqual(sidecarRed.expected_parser_lifecycle, SIDECAR_RED_LIFECYCLE)
  assert.equal(sidecarRed.expected_failure_count, 51)
  assert.deepEqual(sidecarRed.expected_failure_names, SIDECAR_RED_FAILURE_NAMES)
  assert.deepEqual(sidecarRed.expected_failure_families, ['TestPhase0B5', 'TestPhase0B6'])

  const duplicate = structuredClone(catalog)
  duplicate.find((entry: any) => entry.id === 'cc-b4-b6-red').expected_failure_names.push(CC_RED_FAILURE_NAMES[0])
  assert.equal(validatePhase1CatalogValue(duplicate).ok, false)
  const wrongCount = structuredClone(catalog)
  wrongCount.find((entry: any) => entry.id === 'sidecar-b5-b6-red').expected_failure_count = 50
  assert.equal(validatePhase1CatalogValue(wrongCount).ok, false)
  const wrongLifecycle = structuredClone(catalog)
  wrongLifecycle.find((entry: any) => entry.id === 'sidecar-b5-b6-red').expected_parser_lifecycle.packages[1].run_test_count = 63
  assert.equal(validatePhase1CatalogValue(wrongLifecycle).ok, false)
  const extraKey = structuredClone(catalog)
  extraKey.find((entry: any) => entry.id === 'cc-b4-b6-red').undeclared = true
  assert.equal(validatePhase1CatalogValue(extraKey).ok, false)
})

test('GREEN CC full-suite rows bind the exact dedicated contract path without replacing capture authority', async () => {
  const catalog = await readJson(catalogPath)
  const exactPath = '${SUB2API_CONTRACT_ROOT}/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json'
  assert.deepEqual(catalog.find((entry: any) => entry.id === 'cc-tests').env, {
    SUB2API_FORMAL_POOL_CONTRACT_PATH: exactPath,
  })
  assert.deepEqual(catalog.find((entry: any) => entry.id === 'cc-tests-repeat').env, {
    SUB2API_FORMAL_POOL_CONTRACT_PATH: exactPath,
  })
  for (const mutation of [
    'missing', 'relative', 'alternate-root', 'wrong-suffix', 'symlink', 'inherited-startup',
  ]) assert.throws(
    () => captureAndRunPhase1(contractEnvironmentMutation(catalog, mutation), zeroSpawnFixture),
    hasCode('contract_root_not_authorized'),
  )
  for (const commandID of EXPECTED_COMMAND_IDS.filter((id) => !['cc-tests', 'cc-tests-repeat'].includes(id))) {
    const mutation = injectContractPathIntoCommand(catalog, commandID, exactPath)
    assert.throws(
      () => captureAndRunPhase1(mutation, zeroSpawnFixture),
      hasCode('contract_root_not_authorized'),
      commandID,
    )
    assert.equal(zeroSpawnFixture.spawnCount, 0)
  }
})

test('RED classification requires exact lifecycle, sorted event multiset, unique names, counts, and families', () => {
  const valid = redNonzeroFixture({
    commandID: 'cc-b4-b6-red', failureEvents: CC_RED_FAILURE_NAMES, parserLifecycle: CC_RED_LIFECYCLE,
  })
  assert.equal(classifyPhase1Result(valid).status, 'expected_fail')

  for (const failureEvents of [
    CC_RED_FAILURE_NAMES.slice(1),
    [...CC_RED_FAILURE_NAMES, 'B4 invented same-prefix leaf'],
    [...CC_RED_FAILURE_NAMES, CC_RED_FAILURE_NAMES[0]],
    [...CC_RED_FAILURE_NAMES, 'HA-P0-009 unrelated failure'],
  ]) assert.equal(classifyPhase1Result(redNonzeroFixture({
    commandID: 'cc-b4-b6-red', failureEvents, parserLifecycle: CC_RED_LIFECYCLE,
  })).status, 'unexpected_fail')

  const shuffledEvents = [...CC_RED_FAILURE_NAMES].reverse()
  const shuffled = classifyPhase1Result(redNonzeroFixture({
    commandID: 'cc-b4-b6-red', failureEvents: shuffledEvents, parserLifecycle: CC_RED_LIFECYCLE,
  }))
  assert.equal(shuffled.status, 'expected_fail')
  assert.deepEqual(shuffled.failure_event_names, CC_RED_FAILURE_NAMES)
  assert.deepEqual(shuffled.failure_names, CC_RED_FAILURE_NAMES)
})

test('runner parsers reject incomplete or ambiguous TAP and Go lifecycles', () => {
  for (const mutation of [
    'tap_missing_plan', 'tap_duplicate_plan', 'tap_missing_ordinal', 'tap_terminal_then_event',
    'go_missing_package', 'go_missing_test_terminal', 'go_missing_package_terminal',
    'go_json_valid_truncation', 'go_build_failure', 'go_terminal_then_event',
    'unexpected_go_package', 'nonempty_unexplained_stderr', 'go_parent_independent_diagnostic',
  ]) assert.throws(() => parsePhase1RedFailureLeaves(runnerStreamMutation(validRunnerStreams, mutation)),
    hasCode('red_runner_output_incomplete'))
})

test('result validation derives RED multiset, duplicates, unique names, counts, lifecycle, and families', () => {
  const valid = redResultFixture({
    commandID: 'cc-b4-b6-red',
    failureEventNames: CC_RED_FAILURE_NAMES,
    failureEventCount: 61,
    failureNames: CC_RED_FAILURE_NAMES,
    failureCount: 61,
    parserLifecycle: CC_RED_LIFECYCLE,
    observedFailureFamilies: ['B4', 'B5', 'B6'],
  })
  assert.equal(validatePhase1ResultsValue(valid).ok, true)
  for (const mutation of RED_SEMANTIC_MUTATIONS) {
    assert.equal(validatePhase1ResultsValue(rehashDeep(resultMutation(valid, mutation))).ok, false)
  }
})

test('raw event permutations canonicalize to one identical downstream result', () => {
  const forward = classifyPhase1Result(redNonzeroFixture({
    commandID: 'cc-b4-b6-red', failureEvents: CC_RED_FAILURE_NAMES, parserLifecycle: CC_RED_LIFECYCLE,
  }))
  const reverse = classifyPhase1Result(redNonzeroFixture({
    commandID: 'cc-b4-b6-red', failureEvents: [...CC_RED_FAILURE_NAMES].reverse(), parserLifecycle: CC_RED_LIFECYCLE,
  }))
  assert.deepEqual(reverse, forward)
})

test('integration entry, handoff, and receipt builders and validators revalidate RED semantics', () => {
  for (const mutation of ['catalog_digest', ...RED_SEMANTIC_MUTATIONS] as const) {
    const fixture = rehashEveryAffectedArtifact(downstreamMutation(validDownstreamChain, mutation))
    assert.throws(() => buildPhase1IntegrationEntry(fixture.integrationEntryInputs), hasCode('red_evidence_mismatch'))
    assert.equal(validatePhase1IntegrationEntryValue(fixture.integrationEntry).ok, false)
    assert.throws(() => buildPhase1Handoff(fixture.handoffInputs), hasCode('red_evidence_mismatch'))
    assert.equal(validatePhase1HandoffValue(fixture.handoff).ok, false)
    assert.throws(() => buildPhase1IntegrationReceipt(fixture.receiptInputs), hasCode('red_evidence_mismatch'))
    assert.equal(validatePhase1IntegrationReceiptValue(fixture.receiptPreCommit).ok, false)
    assert.equal(validatePhase1IntegrationReceiptValue(fixture.receiptPostCommit).ok, false)
  }
})

test('capture rejects a dirty repository before running the first command', () => {
  assert.throws(() => captureAndRunPhase1(dirtyFixture), hasCode('dirty_repository'))
})

test('capture preserves exact execution-context failure codes before spawning', () => {
  for (const [mutation, code] of [
    ['missing_initial', 'context_chain_gap'],
    ['expired_latest', 'stale_execution_context'],
    ['captured_before_generated_at', 'context_not_yet_valid'],
    ['schema_invalid', 'context_schema_invalid'],
    ['gate_schema_drift', 'context_schema_binding_drift'],
    ['bad_predecessor_digest', 'predecessor_context_mutated'],
    ['unapproved_review', 'context_approval_invalid'],
    ['remote_origin_substitution', 'context_remote_origin_drift'],
  ] as const) {
    assert.throws(() => captureAndRunPhase1({
      ...baseOptions,
      executionContextPath: invalidExecutionContext(mutation),
    }), hasCode(code))
  }
  assert.equal(spawnObserver.count, 0)
})

test('feature capture selects only the latest contiguous immutable context chain head', () => {
  const valid = contextChainFixture({ stages: ['implementation_entry', 'implementation', 'feature_capture'] })
  assert.doesNotThrow(() => selectLatestPhase1ExecutionContext(valid, valid.paths[2]))
  for (const mutation of [
    'expired_latest', 'missing_predecessor', 'bad_predecessor_digest', 'bad_predecessor_commit',
    'gap', 'jump', 'duplicate_sequence', 'stale_context_replay', 'path_sequence_mismatch',
    'stage_regression', 'wrong_branch', 'wrong_authorized_parent_head', 'head_not_descendant',
    'predecessor_path_later_modified', 'dirty_cc', 'dirty_sub2api', 'unexpected_delta',
    'remote_ref_stale', 'remote_rewind', 'remote_authority_drift', 'future_generated_at',
    'plan_drift', 'review_drift', 'shared_contract_drift', 'symlink_context',
  ]) assert.throws(() => selectLatestPhase1ExecutionContext(contextChainMutation(valid, mutation), valid.paths[2]))
})

test('feature review is closed and ordinary merge commits have exact two-parent topology', () => {
  assert.doesNotThrow(() => validatePhase1FeatureEvidenceCommit(validFeatureEvidenceCommit))
  for (const mutation of ['evidence_wrong_parent', 'evidence_extra_delta', 'evidence_wrong_bytes', 'sub2api_head_changed']) {
    assert.throws(() => validatePhase1FeatureEvidenceCommit(featureEvidenceCommitMutation(validFeatureEvidenceCommit, mutation)),
      hasCode('feature_evidence_commit_mismatch'))
  }
  assert.equal(validatePhase1FeatureReviewValue(validFeatureReview).ok, true)
  for (const mutation of FEATURE_REVIEW_MUTATIONS) {
    const changed = rehashFeatureReviewChain(featureReviewMutation(validFeatureReview, mutation))
    assert.equal(validatePhase1FeatureReviewValue(changed.featureReview).ok, false)
    assert.throws(() => buildPhase1IntegrationEntry({
      ...validIntegrationEntryInputs,
      featureReview: changed.featureReview,
      featureBaseline: changed.featureBaseline,
      featureResults: changed.featureResults,
    }), hasCode('feature_review_mismatch'))
  }
  assert.doesNotThrow(() => validatePhase1FeatureReviewAttestation(validFeatureReviewAttestation))
  for (const mutation of [
    'review_attestation_wrong_parent', 'review_attestation_extra_delta',
    'review_attestation_wrong_bytes', 'review_path_later_mutated',
  ]) {
    const changed = featureReviewAttestationMutation(validFeatureReviewAttestation, mutation)
    assert.throws(() => validatePhase1FeatureReviewAttestation(changed),
      hasCode('feature_review_attestation_mismatch'))
    assert.throws(() => buildPhase1IntegrationEntry({ ...validIntegrationEntryInputs, featureReviewAttestation: changed }),
      hasCode('feature_review_attestation_mismatch'))
  }
  assert.doesNotThrow(() => validatePhase1MergeTopology(validMergeTopology))
  for (const mutation of ['squash', 'rebase', 'wrong_first_parent', 'wrong_second_parent', 'non_ancestor_merge']) {
    assert.throws(() => validatePhase1MergeTopology(mergeTopologyMutation(validMergeTopology, mutation)),
      hasCode('merge_commit_parent_mismatch'))
  }
})

test('closed implementation-tree bindings detect every nonexcluded tracked change and stale review', () => {
  const baseline = derivePhase1ImplementationTreeBinding(implementationTreeFixture('baseline'))
  for (const mutation of IMPLEMENTATION_TREE_MUTATIONS.filter((name) =>
    !['excluded_evidence_change', 'excluded_governance_change', 'untracked_dirty_path'].includes(name))) {
    const changed = derivePhase1ImplementationTreeBinding(implementationTreeFixture(mutation))
    assert.notEqual(changed.entries_digest, baseline.entries_digest, mutation)
    const downstream = rehashEveryAffectedArtifact(implementationTreeDownstreamMutation(validDownstreamChain, mutation))
    assert.throws(() => buildPhase1IntegrationEntry(downstream.integrationEntryInputs), hasCode('phase1_implementation_drift'))
    assert.equal(validatePhase1FeatureReviewValue(downstream.featureReview).ok, false)
    assert.equal(validatePhase1HandoffValue(downstream.handoff).ok, false)
    assert.equal(validatePhase1IntegrationReceiptValue(downstream.receiptPostCommit).ok, false)
  }
  for (const mutation of ['excluded_evidence_change', 'excluded_governance_change'] as const) {
    assert.equal(
      derivePhase1ImplementationTreeBinding(implementationTreeFixture(mutation)).entries_digest,
      baseline.entries_digest,
    )
  }
  assert.throws(() => validatePhase1CaptureInputs(implementationTreeFixture('untracked_dirty_path')),
    hasCode('dirty_repository'))
  for (const mutation of [
    'broaden_exclusion', 'remove_exclusion', 'replace_exclusion',
    'reorder_exclusion', 'duplicate_exclusion',
  ]) {
    assert.throws(() => derivePhase1ImplementationTreeBinding(implementationTreeFixture(mutation)),
      hasCode('implementation_tree_policy_invalid'))
  }
})

test('ignored state drift invalidates capture and every downstream authority artifact', () => {
  for (const mutation of IGNORED_STATE_MUTATIONS) {
    const fixture = ignoredStateMutationFixture(validDownstreamChain, mutation)
    assert.throws(() => captureAndRunPhase1(fixture.captureInputs), hasCode('ignored_state_drift'))
    const rehashed = rehashEveryAffectedArtifact(fixture.downstream)
    assert.throws(() => validatePhase1ResultsValue(rehashed.resultsInputs), hasCode('ignored_state_drift'))
    assert.throws(() => buildPhase1IntegrationEntry(rehashed.integrationEntryInputs), hasCode('ignored_state_drift'))
    assert.throws(() => validatePhase1IntegrationEntryValue(rehashed.integrationEntry), hasCode('ignored_state_drift'))
    assert.throws(() => buildPhase1Handoff(rehashed.handoffInputs), hasCode('ignored_state_drift'))
    assert.throws(() => validatePhase1HandoffValue(rehashed.handoffInputs), hasCode('ignored_state_drift'))
    assert.throws(() => buildPhase1IntegrationReceipt(rehashed.receiptInputs), hasCode('ignored_state_drift'))
    assert.throws(() => validatePhase1IntegrationReceiptValue(rehashed.receiptInputs), hasCode('ignored_state_drift'))
    assert.throws(() => validatePhase1IntegrationReceiptValue(rehashed.receiptPostCommit), hasCode('ignored_state_drift'))
    assert.throws(() => verifyPhase1FinalRemote(rehashed.finalRemoteInputs), hasCode('ignored_state_drift'))
  }
})

test('raw ls-tree parser is NUL-safe and exact exclusion boundaries cannot widen', () => {
  assert.deepEqual(parsePhase1TrackedTree(validRawTreeStream), validTrackedTreeEntries)
  for (const mutation of RAW_TREE_STREAM_MUTATIONS.slice(0, 12)) {
    assert.throws(() => parsePhase1TrackedTree(rawTreeStreamMutation(validRawTreeStream, mutation)),
      hasCode('implementation_tree_stream_invalid'))
  }
  const prefixCollision = derivePhase1ImplementationTreeBinding(
    implementationTreeFixture('phase1_prefix_collision'),
  )
  const governanceCollision = derivePhase1ImplementationTreeBinding(
    implementationTreeFixture('governance_suffix_collision'),
  )
  assert.notEqual(prefixCollision.entries_digest, baselineImplementationTree.entries_digest)
  assert.notEqual(governanceCollision.entries_digest, baselineImplementationTree.entries_digest)
})

test('post-integration separates the declared controller delta from clean tested roots', () => {
  const allowed = postIntegrationFixture({
    controllerStatus: ['?? docs/superpowers/evidence/phase-1/attempt-0001/phase-1-integration-entry.json'],
    ccTestedStatus: [], sub2apiTestedStatus: [],
  })
  assert.doesNotThrow(() => validatePhase1CaptureInputs(allowed))
  for (const fixture of [
    postIntegrationFixture({ controllerStatus: ['?? unrelated.txt'] }),
    postIntegrationFixture({ ccTestedStatus: [' M src/proxy.ts'] }),
    postIntegrationFixture({ sub2apiTestedStatus: ['?? stray.txt'] }),
    postIntegrationFixture({ controllerEqualsCCTestedRoot: true }),
  ]) assert.throws(() => validatePhase1CaptureInputs(fixture), hasCode('capture_root_not_authorized'))
})

test('post-integration attempts select the next contiguous committed receipt chain node', () => {
  const initial = attemptChainFixture({ committed: [], requested: 'attempt-0001', predecessor: null })
  assert.doesNotThrow(() => validatePhase1AttemptChain(initial))
  const successor = attemptChainFixture({
    committed: [committedAttemptReceipt('attempt-0001')],
    requested: 'attempt-0002',
    predecessor: predecessorAttemptBinding('attempt-0001'),
  })
  assert.doesNotThrow(() => validatePhase1AttemptChain(successor))
  for (const mutation of [
    'missing_predecessor', 'unexpected_initial_predecessor', 'attempt_gap', 'attempt_jump',
    'duplicate_attempt', 'stale_attempt_replay', 'wrong_predecessor_id', 'wrong_receipt_path',
    'wrong_receipt_digest', 'wrong_receipt_commit', 'receipt_commit_not_ancestor',
    'receipt_commit_wrong_parent', 'receipt_commit_extra_delta', 'predecessor_receipt_mutated',
    'historical_receipt_deleted', 'historical_receipt_deleted_readded',
    'historical_receipt_replaced', 'attempt_chain_reset_to_0001',
  ]) assert.throws(() => validatePhase1AttemptChain(attemptChainMutation(successor, mutation)),
    hasCode('attempt_chain_invalid'))
})

test('pre-merge draft and post-merge canonical retries advance different counters', () => {
  const preMerge = authorizePhase1Retry(validPreMergeEvidenceOnlyFailure)
  assert.equal(preMerge.attempt_id, 'attempt-0002')
  assert.deepEqual(preMerge.predecessor, predecessorAttemptBinding('attempt-0001'))
  assert.equal(preMerge.draft_run_id, 'run-0002')
  assert.deepEqual(preMerge.preserve_paths, validPreMergeEvidenceOnlyFailure.immutablePaths)
  assert.equal(preMerge.require_new_roots, true)
  const postMerge = authorizePhase1Retry(validPostMergeEvidenceOnlyFailure)
  assert.equal(postMerge.attempt_id, 'attempt-0003')
  assert.deepEqual(postMerge.predecessor, predecessorAttemptBinding('attempt-0002'))
  assert.equal(postMerge.draft_run_id, 'run-0001')
  assert.deepEqual(postMerge.preserve_paths, [
    validPostMergeEvidenceOnlyFailure.previousReceiptPath,
    validPostMergeEvidenceOnlyFailure.featureReviewPath,
  ])
  assert.equal(postMerge.require_new_roots, true)
  assert.match(preMerge.root_identity_digest, /^sha256:[0-9a-f]{64}$/)
  assert.match(postMerge.root_identity_digest, /^sha256:[0-9a-f]{64}$/)
  assert.notEqual(preMerge.root_identity_digest, validPreMergeEvidenceOnlyFailure.root_identity_digest)
  assert.notEqual(postMerge.root_identity_digest, validPostMergeEvidenceOnlyFailure.root_identity_digest)
  assert.notEqual(postMerge.root_identity_digest, preMerge.root_identity_digest)
})

test('final remote verifier has exact outcomes and unsafe outcomes cannot allocate an attempt', () => {
  assert.deepEqual(verifyPhase1FinalRemote(validFinalRemoteState).decision, 'ready')
  assert.deepEqual(verifyPhase1FinalRemote(validSupersededRemoteState).decision, 'superseded')
  for (const [mutation, code] of [
    ['remote_rewind', 'context_remote_rewind'],
    ['remote_non_descendant', 'context_remote_rewind'],
    ['remote_url_substitution', 'context_remote_origin_drift'],
    ['receipt_commit_not_ancestor', 'attempt_chain_invalid'],
    ['historical_receipt_deleted', 'attempt_chain_invalid'],
    ['historical_receipt_deleted_readded', 'attempt_chain_invalid'],
    ['attempt_chain_reset_to_0001', 'attempt_chain_invalid'],
    ['implementation_tree_policy_drift', 'implementation_tree_policy_invalid'],
    ['implementation_tree_drift', 'phase1_implementation_drift'],
    ['dirty_final_root', 'dirty_repository'],
    ['final_root_head_mismatch', 'context_head_mismatch'],
  ] as const) {
    attemptAllocationObserver.reset()
    artifactWriteObserver.reset()
    assert.throws(() => verifyPhase1FinalRemote(finalRemoteMutation(validFinalRemoteState, mutation)), hasCode(code))
    assert.equal(attemptAllocationObserver.count, 0)
    assert.equal(artifactWriteObserver.count, 0)
  }
  for (const [mutation, code] of [
    ['remote_rewind', 'context_remote_rewind'],
    ['remote_url_substitution', 'context_remote_origin_drift'],
    ['historical_receipt_deleted_readded', 'attempt_chain_invalid'],
    ['implementation_tree_drift', 'phase1_implementation_drift'],
  ] as const) {
    assert.throws(() => verifyPhase1FinalRemote(
      finalRemoteMutation(validSupersededRemoteState, mutation),
    ), hasCode(code))
  }
})

test('verify-final-remote CLI accepts only its complete explicit flag set', () => {
  assert.doesNotThrow(() => parsePhase1CLI(validFinalRemoteArgv))
  for (const mutation of [
    'missing_catalog', 'missing_cc_root', 'missing_sub2api_root', 'missing_attempt_id',
    'missing_receipt', 'missing_receipt_commit', 'missing_remote_name', 'missing_remote_ref',
    'missing_origin_digest', 'duplicate_flag', 'unknown_flag', 'environment_fallback',
  ]) assert.throws(() => parsePhase1CLI(cliMutation(validFinalRemoteArgv, mutation)),
    hasCode('invalid_arguments'))
})

test('capture refuses proxy-only networking and requires an OS loopback sandbox', async () => {
  assert.throws(() => captureAndRunPhase1({ ...baseOptions, sandbox: unavailableSandbox }),
    hasCode('network_sandbox_unavailable'))
  const canaries = await runPhase1SandboxCanaries(reviewedSandboxFixture)
  assert.equal(canaries.loopback_socket, 'pass')
  assert.equal(canaries.non_loopback_test_net_socket, 'denied_by_policy')
  assert.equal(canaries.policy_bypass_detected, false)
})

test('capture binds one independent clean main contract clone before spawn', () => {
  for (const mutation of [
    'feature_branch', 'wrong_head', 'wrong_origin', 'dirty_status', 'wrong_contract_digest',
    'linked_worktree', 'same_as_sub2api_implementation_root', 'same_as_operator_root',
  ]) {
    assert.throws(() => captureAndRunPhase1(contractRootMutation(baseOptions, mutation)),
      hasCode('contract_root_not_authorized'))
  }
  assert.equal(spawnObserver.count, 0)
})

test('handoff rejects unexpected pass/fail, cross-head results, unsafe output and non-ancestor artifact head', () => {
  for (const fixture of invalidHandoffFixtures) {
    assert.equal(validatePhase1HandoffValue(fixture).ok, false)
  }
})
```

The dirty fixture is a temporary Git repository with one committed file plus one untracked file. The contract-root fixture is a distinct temporary clone with local branch `main`; each named mutation changes exactly one derived binding and all rejection cases assert zero spawned commands and zero persisted evidence. Execution-context mutations independently change expiry, plan bytes/digest, plan commit, approval artifact bytes/digest, reviewer decision/counts, base head, branch, live status, shared contract, and disabled capabilities. Add hostile inherited `PATH`, `GIT_DIR`, `GIT_WORK_TREE`, object-directory, alternate-object, config, and replace-object environment cases; reviewed Git must either ignore them through its closed environment or fail with the existing stable replacement-ref code.

`resultMutation` mutates the persisted sorted event multiset, event count, unique array/count, parser, lifecycle, or family while leaving the other redundant fields untouched. `rehashDeep` recomputes the result and enclosing results-set digests so semantic checks, not stale hashes, cause rejection. `downstreamMutation` starts from one valid feature-result/integration-entry/handoff/report/receipt chain, applies the same one-field mutation at its earliest source, and `rehashEveryAffectedArtifact` recomputes every child digest through the pre/post-commit receipt fixtures. The integration-entry builder/validator, handoff builder/validator, and receipt builder/pre-commit-validator/post-commit-validator each receive every mutation independently and must reject it. The raw-permutation fixture is the sole accepting metamorphic case and must produce byte-identical canonical result JSON/digest before downstream construction. Other invalid handoff fixtures mutate unexpected status, repository head, contract-root binding, `unsafe_output_detected`, reviewed-head ancestry, expiry, artifact path traversal, or report bytes.

- [ ] **Step 2: Run adapter tests and confirm files are absent**

Run: `npm exec tsx tests/oracle-lab-phase-1-evidence.test.ts`

Expected: FAIL because the schemas, catalog, and adapter do not exist.

- [ ] **Step 3: Define closed evidence types and safe execution boundaries**

```typescript
export type Phase1Group = 'phase1-green' | 'phase1-red'
export type Phase1ImplementedRequirement = 'AV-B1-001' | 'AV-B2-001' | 'AV-B3-001' | 'RA-P0-008'
export type Phase1PreservedRedRequirement = 'AV-B4-001' | 'AV-B5-001' | 'AV-B6-001'
export type Phase1RedFailureFamily = 'B4' | 'B5' | 'B6' | 'TestPhase0B5' | 'TestPhase0B6'
export type Phase1FailureParser = 'node_test_tap_v1' | 'go_test_json_leaf_v1'
export type Phase1NodeTapLifecycle = {
  parser: 'node_test_tap_v1'
  tap_version_count: 1
  terminal_plan_count: 1
  declared_test_count: 68
  observed_test_count: 68
  pass_count: 7
  fail_count: 61
  cancelled_count: 0
  skipped_count: 0
  todo_count: 0
  unexplained_stderr_line_count: 0
}
export type Phase1GoControlLifecycle = {
  package_suffix: 'internal/control'
  start_count: 1
  run_test_count: 4
  terminal_test_count: 4
  pass_test_count: 2
  fail_test_count: 2
  skip_test_count: 0
  package_fail_terminal_count: 1
  post_terminal_event_count: 0
}
export type Phase1GoServerLifecycle = {
  package_suffix: 'internal/server'
  start_count: 1
  run_test_count: 64
  terminal_test_count: 64
  pass_test_count: 11
  fail_test_count: 53
  skip_test_count: 0
  package_fail_terminal_count: 1
  post_terminal_event_count: 0
}
export type Phase1GoTestLifecycle = {
  parser: 'go_test_json_leaf_v1'
  packages: [Phase1GoControlLifecycle, Phase1GoServerLifecycle]
  unexplained_stderr_line_count: 0
  malformed_or_unparsed_event_count: 0
}
export type Phase1ParserLifecycle = Phase1NodeTapLifecycle | Phase1GoTestLifecycle
export type Phase1Command = {
  id: string
  group: Phase1Group
  repository: 'cc-gateway' | 'sub2api' | 'egress-tls-sidecar'
  cwd: string
  argv: string[]
  expected_exit: 0 | 'nonzero'
  failure_parser: null | Phase1FailureParser
  expected_parser_lifecycle: null | Phase1ParserLifecycle
  expected_failure_count: number
  expected_failure_names: string[]
  expected_failure_families: Phase1RedFailureFamily[]
  timeout_ms: number
  requirement_ids: Array<Phase1ImplementedRequirement | Phase1PreservedRedRequirement>
  ignored_output_policies: {
    cc_gateway: Phase1IgnoredOutputPolicy
    sub2api: Phase1IgnoredOutputPolicy
  }
}

export type Phase1Result = {
  command_id: string
  repository: Phase1Command['repository']
  repository_commit: string
  exit_code: number
  status: 'pass' | 'expected_fail' | 'unexpected_fail' | 'unexpected_pass'
  stdout_digest: string
  stderr_digest: string
  failure_parser: null | Phase1FailureParser
  parser_lifecycle: null | Phase1ParserLifecycle
  failure_event_count: number
  failure_event_names: string[]
  failure_count: number
  failure_names: string[]
  observed_failure_families: Phase1RedFailureFamily[]
  unclassified_failure_names: string[]
  sandbox_policy_digest: string
  network_policy_violations: number
  unsafe_output_detected: boolean
  ignored_state_transitions: {
    controller: Phase1ControllerIgnoredStateTransition
    cc_gateway: Phase1IgnoredStateTransition
    sub2api: Phase1IgnoredStateTransition
  }
  external_dependency_transition: Phase1ExternalDependencyTransition
  result_digest: string
}

export type Phase1ContractRootBinding = {
  repository: 'sub2api'
  clone_kind: 'independent_clone'
  branch: 'main'
  head: string
  origin_url_digest: string
  root_identity_digest: string
  clean_status_digest: string
  contract_relative_path: 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json'
  contract_digest: 'sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1'
}

export type Phase1ImplementationRepository = 'cc_gateway' | 'sub2api'
export type Phase1TrackedTreeEntry = {
  path: string
  mode: '100644' | '100755' | '120000' | '160000'
  object_type: 'blob' | 'commit'
  object_oid: string
}
export type Phase1ImplementationTreeBinding = {
  algorithm: 'git_ls_tree_v1_sha256_canonical_json'
  repository: Phase1ImplementationRepository
  source_commit: string
  exclusion_policy: 'phase1_evidence_governance_only_v1'
  excluded_prefixes: string[]
  excluded_paths: string[]
  entry_count: number
  entries_digest: string
}

export type Phase1IgnoredOutputPolicy =
  | 'none'
  | 'cc_build_dist_v1'
  | 'sub_frontend_build_v1'
  | 'sub2api_joint_safe_deliverable_v1'
export type Phase1IgnoredStateBinding = {
  algorithm: 'git_exclude_standard_recursive_v1'
  repository: Phase1ImplementationRepository
  endpoint_count: number
  entry_count: number
  regular_file_count: number
  directory_count: number
  symlink_count: number
  regular_file_bytes: number
  digest: string
}
export type Phase1IgnoredStateTransition = {
  policy: Phase1IgnoredOutputPolicy
  policy_digest: string
  before: Phase1IgnoredStateBinding
  after: Phase1IgnoredStateBinding
}
export type Phase1ControllerIgnoredStateTransition = {
  policy: 'none' | 'controller_alias_cc_gateway_v1'
  policy_digest: string
  before: Phase1IgnoredStateBinding
  after: Phase1IgnoredStateBinding
}
export type Phase1IgnoredStateSet = {
  controller: Phase1IgnoredStateBinding
  cc_gateway: Phase1IgnoredStateBinding
  sub2api: Phase1IgnoredStateBinding
}
export type Phase1IgnoredStateChainBinding = {
  initial: Phase1IgnoredStateSet
  final: Phase1IgnoredStateSet
  transition_count: 17
  transitions_digest: string
}
export type Phase1IgnoredStateEvidenceReference = {
  results_path: string
  results_digest: string
  chain_digest: string
  final: Phase1IgnoredStateSet
}

export type Phase1NpmCachePreparation = {
  policy: 'os_account_cow_cache_v1'
  source_before_digest: string
  source_after_digest: string
  command_before_digest: string
  command_after_digest: string
  entry_count: number
  regular_file_count: number
  regular_file_bytes: number
  install_result_digest: string
}
export type Phase1ExternalDependencyBinding = {
  algorithm: 'phase1_external_dependency_content_v1'
  repository: Phase1ImplementationRepository
  preparation: 'npm_ci_offline_authenticated_cache_and_go_mod_verify_v2'
  node_binary_digest: string
  npm_binary_digest: string
  go_binary_digest: string
  npm_cache_preparation: Phase1NpmCachePreparation
  node_dependency_manifests: Array<{
    repository_relative_root: string
    package_json_digest: string
    package_lock_digest: string
    entry_count: number
    content_digest: string
  }>
  go_module_manifests: Array<{
    repository_relative_root: string
    go_mod_digest: string
    go_sum_digest: string
    module_count: number
    module_manifest_digest: string
    module_content_digest: string
    go_mod_verify_digest: string
  }>
  binding_digest: string
}
export type Phase1ExternalDependencySet = {
  cc_gateway: Phase1ExternalDependencyBinding
  sub2api: Phase1ExternalDependencyBinding
}
export type Phase1ExternalDependencyTransition = {
  before: Phase1ExternalDependencySet
  after: Phase1ExternalDependencySet
  ephemeral_build_cache_token: 'command_scoped_empty_mkdtemp_v1'
}
export type Phase1ExternalDependencyChainBinding = {
  initial: Phase1ExternalDependencySet
  final: Phase1ExternalDependencySet
  transition_count: 17
  transitions_digest: string
}
export type Phase1ExternalDependencyEvidenceReference = {
  results_path: string
  results_digest: string
  chain_digest: string
  final: Phase1ExternalDependencySet
}

export type Phase1Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
export type Phase1FourDigits = `${Phase1Digit}${Phase1Digit}${Phase1Digit}${Phase1Digit}`
export type Phase1AttemptID = `attempt-${Phase1FourDigits}`
export type Phase1FeatureAttemptID = `feature-${Phase1FourDigits}`

export type Phase1AttemptPredecessor = null | {
  attempt_id: Phase1AttemptID
  receipt: { path: string; digest: string }
  receipt_commit: string
}

export type Phase1AttemptAuthority = {
  attempt_id: Phase1AttemptID
  sequence: number
  predecessor: Phase1AttemptPredecessor
}

export type Phase1ControllerRootBinding =
  | {
      stage: 'feature-candidate'
      head: string
      root_identity_digest: string
      same_as_tested_cc_root: true
      preexisting_delta_paths: []
      declared_output_paths: [
        `docs/superpowers/evidence/phase-1/${Phase1FeatureAttemptID}/phase-1-feature-baseline.json`,
        `docs/superpowers/evidence/phase-1/${Phase1FeatureAttemptID}/phase-1-feature-command-results.json`,
      ]
    }
  | {
      stage: 'post-integration'
      head: string
      root_identity_digest: string
      same_as_tested_cc_root: false
      preexisting_delta_paths: [
        `docs/superpowers/evidence/phase-1/${Phase1AttemptID}/phase-1-integration-entry.json`,
      ]
      declared_output_paths: [
        `docs/superpowers/evidence/phase-1/${Phase1AttemptID}/phase-1-exit-baseline.json`,
        `docs/superpowers/evidence/phase-1/${Phase1AttemptID}/phase-1-command-results.json`,
      ]
    }

export type Phase1CaptureRootEnvelope = {
  controller_root: Phase1ControllerRootBinding
  sub2api_contract_root: Phase1ContractRootBinding
  implementation_trees: {
    cc_gateway: Phase1ImplementationTreeBinding
    sub2api: Phase1ImplementationTreeBinding
  }
  ignored_state: Phase1IgnoredStateSet
  external_dependencies: Phase1ExternalDependencySet
}
export type Phase1Results = Phase1CaptureRootEnvelope & {
  command_results: Phase1Result[]
  ignored_state_chain: Phase1IgnoredStateChainBinding
  external_dependency_chain: Phase1ExternalDependencyChainBinding
}
```

`git_ls_tree_v1_sha256_canonical_json` is closed and commit-independent. For the bound commit, run reviewed Git as `git ls-tree -r -z --full-tree <commit>`, parse every NUL-delimited leaf as exact `{mode, object_type, object_oid, path}` without shell or quoted-path decoding, reject malformed records, invalid UTF-8/non-round-tripping path bytes, non-normalized or absolute paths, duplicate paths, modes outside `100644|100755|120000|160000`, and inconsistent mode/type pairs. Filter only the exact policy below, byte-sort the remaining `path` values as UTF-8 without Unicode normalization, and compute `entries_digest = sha256(canonicalJson(entries))`; `source_commit`, counts, policy, and exclusions are separately schema-bound and are not included in that digest, so an allowed evidence-only descendant can retain the same tree digest. The binding therefore detects content, add/delete/rename, executable-bit, symlink-target, and submodule-pointer changes.

The only CC exclusions are prefix `docs/superpowers/evidence/phase-1/` and exact paths `docs/superpowers/registry/oracle-lab-requirements.json`, `docs/superpowers/registry/oracle-lab-claims.json`, and `docs/superpowers/registry/oracle-lab-current-observations.json`. Sub2API has `excluded_prefixes: []` and `excluded_paths: []`. No source, test, config, tool, schema, plan, non-Phase-1 evidence, or other documentation path is excluded. Schemas use repository-specific `const`/`prefixItems` branches for those arrays. Semantic validation recomputes the complete in-memory entry list and digest at each candidate, reviewed, integrated, artifact, receipt, and live remote head; it never trusts a persisted digest or a changed exclusion list.

The integration-entry, post-integration results, handoff, and receipt schemas all embed the same closed `Phase1AttemptAuthority`. `attempt-0001` is sequence `1` with `predecessor: null`. For sequence `N > 1`, predecessor is required and binds exactly `attempt-(N-1)` plus its canonical receipt path, raw-byte digest, and receipt commit. Semantic validation walks the full commit graph reachable from the current integrated CC main and inspects tree entries for canonical `docs/superpowers/evidence/phase-1/attempt-[0-9]{4}/phase-1-integration-receipt.json` paths, not only paths present in the tip tree. For each path, an introduction is a commit whose tree contains the blob while none of its parents contains that same path/blob; a deletion omits a path present in any parent; a mutation contains a different blob from a parent that contains the path. This graph-aware definition does not double-count an ordinary merge whose second parent already carries the receipt. Require exactly one introduction, zero deletion/mutation events, one blob identity across every reachable tree containing the path, and the same blob still present at the tip. IDs are contiguous from `0001`; deletion, re-addition, replacement, rename, duplicate introduction, and reset-to-`attempt-0001` are forbidden. The validator selects only the next ID, proves the predecessor receipt commit is an ancestor of main, proves it is the one-path child of the artifact commit named inside the validated predecessor receipt, compares `git show` bytes and digest, and proves no later commit changed the predecessor path. Missing, duplicate, deleted/re-added, gap, jump, reset, replay, wrong path/digest/commit, non-ancestor, wrong-parent/delta, and mutated predecessor all fail `attempt_chain_invalid` before any output write.

`Phase1ExitBaseline` and `Phase1Results` both extend `Phase1CaptureRootEnvelope`; `Phase1Results` additionally contains the exact 17 `command_results` and one `Phase1IgnoredStateChainBinding`. The exit/results/integration-entry/handoff schemas require the exact controller and contract-root unions with `additionalProperties: false`. The controller union freezes each stage's only legal preexisting delta and output paths. The template path segment is not arbitrary: feature-candidate paths must share one `feature-[0-9]{4}` ID and post-integration paths must share one `attempt-[0-9]{4}` ID supplied by the closed CLI; cross-attempt paths, extra nesting, and mixed IDs fail schema and semantic validation. Every `root_identity_digest` is the SHA-256 of canonical realpath bytes; no absolute host path is persisted. `clean_status_digest` must equal SHA-256 of empty bytes. Contract `clone_kind`, branch, path, and digest are schema constants. Semantic validation independently derives every field with reviewed Git and filesystem APIs, proves contract `--git-dir` and `--git-common-dir` resolve to the same clone-local `.git` directory, rejects forbidden root equality, and rechecks the same bindings before and after all commands. The catalog schema makes the group-to-requirement split structural: `phase1-green` entries may contain only `Phase1ImplementedRequirement` and require `failure_parser: null`, `expected_parser_lifecycle: null`, `expected_failure_count: 0`, `expected_failure_names: []`, and `expected_failure_families: []`; `phase1-red` entries may contain only `Phase1PreservedRedRequirement` and require the command-specific parser/lifecycle, exact count, exact canonical name array, and exact nonempty family array below. Every command-ID branch also freezes the two tested-repository `ignored_output_policies`; controller policy is derived only from the stage/root identity and is not a caller-controlled catalog field. Absent, extra, reordered, or wrong repository/policy fields fail schema before execution. The schema uses command-ID-specific closed branches, `const`/`prefixItems`, `minItems == maxItems`, and `uniqueItems: true` for the unique catalog/result arrays. `failure_event_names` is the only deliberate non-unique array: it is a deterministic UTF-8-sorted multiset retaining repeated safe leaf events so downstream validation can detect parser de-duplication; `failure_event_count` must equal its length. Semantic validation independently requires canonical ordering, derives duplicate multiplicity, unique `failure_names`, `failure_count`, families, and lifecycle consistency from that multiset, and compares all derived values to the catalog. Every implemented ID must appear on at least one GREEN row, and no RED row contributes satisfaction evidence for Phase 1.

The feature baseline/results, closed feature review, integration entry, post-integration baseline/results, handoff, artifact set, and integration receipt all bind both closed implementation-tree objects without commit self-reference. Feature baseline/results use the clean pre-capture `CC_GATEWAY_TESTED_HEAD` and `SUB2API_TESTED_HEAD` as `source_commit`. After those result files are committed, the feature review uses the resulting `CC_GATEWAY_CANDIDATE_HEAD` and unchanged `SUB2API_CANDIDATE_HEAD`; it proves the CC candidate is the one-parent child of the tested head whose entire delta adds only the two excluded feature evidence files, then requires algorithm, policy/arrays, count, and digest to remain equal. The review-attestation commit is proven separately and contains no implementation change. Integration and post-integration artifacts use merge/integrated heads, and Step 12 bindings use live remote heads. `source_commit` therefore advances by stage and is never compared as tree content; every validator instead recomputes it at the named head and compares the algorithm, exclusion policy/arrays, entry count, and entry digest with the previous reviewed stage. Mutation tests exercise every `IMPLEMENTATION_TREE_MUTATIONS` member: all source/config/test/nonexcluded-doc add/modify/delete/rename/mode/symlink/submodule changes fail `phase1_implementation_drift`; only the exact CC evidence prefix and three exact governance paths may preserve the digest; any untracked path still fails the independent clean-tree gate. Added, removed, reordered, duplicated, or broadened exclusions fail schema or `implementation_tree_policy_invalid`.

Tracked-tree equality is necessary but not sufficient. H1 reuses the reviewed P0.1 `computeIgnoredPathInventory` and `compareIgnoredPathInventories` primitives and adds the closed `cc_build_dist_v1`, `sub_frontend_build_v1`, and symlink-closure comparators. The inventory applies Git's standard excludes to the complete repository filesystem, records path bytes, object type, mode, regular-file size/content digest, and symlink-target digest in memory, and does not follow symbolic links. Before deriving a binding, `validatePhase1IgnoredSymlinkClosure` resolves every symlink lexically without following it: absolute targets, repository escape, escape from the same ignored endpoint root, dangling targets, absent target records, cross-endpoint targets, and cycles fail `ignored_state_symlink_escape`. A permitted chain must terminate at a record in the same ignored inventory, so the target regular-file content or directory descendants are included in the same digest; normal internal links such as `node_modules/.bin/* -> ../<package>/*` remain legal. A top-level `node_modules` symlink to a shared external dependency tree is forbidden. Persisted artifacts contain only the closed `Phase1IgnoredStateBinding` summary; no ignored path or content bytes are persisted. Bounds on endpoint count, entry count, and regular-file bytes fail closed as `ignored_state_inventory_limit`.

Capture computes a full ignored-state binding for the controller root and both tested repositories before and after every catalog command. `node_modules` and `.codegraph` must be byte-for-byte and mode-for-mode identical before and after every command. Policy `none` requires the complete before/after ignored-state digest to match. `joint-local-chain` alone may assign `sub2api_joint_safe_deliverable_v1` to the Sub2API root. `cc-build` alone assigns `cc_build_dist_v1` to the tested CC root: only the exact `dist` directory and descendants may be created or changed, and those entries may be regular files and directories only; symlinks, executable-mode changes, changes outside that surface, or a changed protected-state digest fail `ignored_state_drift`. `sub-frontend-build` alone assigns `sub_frontend_build_v1` to the tested Sub2API root: only the exact `backend/internal/web/dist` directory and its regular-file/directory descendants plus exact regular files `frontend/tsconfig.tsbuildinfo` and `frontend/tsconfig.node.tsbuildinfo` may be created or changed; symlinks, executable modes, any other `*.tsbuildinfo`, and every path outside those exact surfaces are protected. `sub-frontend-build-repeat` and `cc-build-repeat` are the immediate second builds, both use `none`, and must produce ignored-state digests identical to the preceding build's after-state. `cc-tests` and `cc-tests-repeat` use `none`, run in distinct isolated child-process trees, and must leave ignored state unchanged. In feature capture, where `controllerRoot === ccGatewayRoot`, controller transition policy is derived as `controller_alias_cc_gateway_v1` and its before/after summaries must equal the tested CC transition even for `cc-build`; it is not separately compared under `none`. In post-integration, where the controller is distinct, controller policy is derived as `none` and its full inventory must remain stable.

The external dependency surface is also closed. For each of the two reviewed Node dependency roots, preparation resolves the OS account from the account database rather than inherited `HOME`, validates real account-owned non-group/world-writable `.npm` and `_cacache` roots, inventories every directory and regular file without following symlinks, and copy-on-write clones only `_cacache` into a distinct command-scoped mode-0700 root. The source before/after and command before inventories must be byte-identical before exact `npm ci --offline --ignore-scripts --cache <command-scoped-cache>` runs with the same explicit path in `npm_config_cache`; after install, the source and command `_cacache` inventories must still equal the seed. The reviewed lockfile integrity authenticates the untrusted cache seed, and the resulting `node_modules` tree remains the dependency authority. Inherited `HOME`, `npm_config_cache`, user/global npm config, and network fallback cannot select dependency bytes. A preexisting `node_modules` tree is never accepted without this rebuild; failed install, missing tarball, lock drift, lifecycle script, network fallback, or unreviewed binary fails before capture.

Each `Phase1ExternalDependencyBinding` embeds one closed `Phase1NpmCachePreparation` with policy `os_account_cow_cache_v1`, exact `source_before_digest`, `source_after_digest`, `command_before_digest`, `command_after_digest`, inventory counts/bytes, and `install_result_digest`. All four inventory digests must match. The evidence never persists a username, uid, account home, source path, command path, or any absolute npm-cache path; it persists only the policy, counts, bytes, and digests. Derive the remainder of the binding from reviewed Node/npm/Go executable digests; tracked package/lock and go.mod/go.sum bytes; the complete path/mode/type/content digest of each resulting `node_modules` tree; `go list -mod=readonly -m -json all` under `GOENV=off`, `GOFLAGS=-mod=readonly`, `GOPROXY=off`, `GOSUMDB=off`, `GOTOOLCHAIN=local`; the successful `go mod verify` digest; and the complete content/mode/type digest of every selected module directory inside the canonical `GOMODCACHE` realpath. A listed transitive module without `Dir` remains identity-bound in the module manifest but contributes no fabricated content record; a replacement without a real selected directory still fails. Reject a source race, symlink, special file, group/world writable root, missing tarball, command-cache drift, module escape, duplicate module identity, replacement escape, missing sum, addition, deletion, content/mode drift, or any before/after digest change as `external_dependency_drift`.

`Phase1CaptureRootEnvelope.external_dependencies` binds the exact initial `Phase1ExternalDependencySet`, including both path-free npm cache preparation records; every `Phase1Result.external_dependency_transition` binds before/after sets plus Go build-cache token `command_scoped_empty_mkdtemp_v1`; and `Phase1Results.external_dependency_chain` closes all 17 contiguous transitions. Later validation revalidates the historical path-free cache record and recomputes the live installed dependency output; it does not claim to recreate an expired random cache path. Feature review, integration entry, handoff, receipt, and final-remote artifacts each embed `Phase1ExternalDependencyEvidenceReference`, reload the referenced results, recompute both repositories, and reject absent/extra/rehashed fields. Their six existing schemas add local closed definitions rather than a new schema family and retain `additionalProperties: false`. `captureAndRunPhase1`, `validatePhase1ResultsValue`, `buildPhase1IntegrationEntry`, `validatePhase1IntegrationEntryValue`, `buildPhase1Handoff`, `validatePhase1HandoffValue`, `buildPhase1IntegrationReceipt`, both receipt validation modes, and `verifyPhase1FinalRemote` repeat this validation. Mutation tests change source/command cache digests, inventory counts, install result, each Node module identity/content/mode/type, package/lock byte, external Go module identity/content/mode/type, Go binary, go.mod/go.sum byte, replacement target, reference, chain adjacency, and build-cache token independently at every downstream stage; consistently rehashing a forged artifact still fails `external_dependency_drift`.

Go compile outputs use a fresh mode-0700 directory created by `mkdtemp('/tmp/oracle-lab-phase1-go-build-')` for each full-suite invocation. The runner requires a real directory owned by the current uid with no group/world mode bits and zero entries before spawn, ignores inherited `GOCACHE`, never reuses or predicts a path, and normalizes the random path to evidence token `command_scoped_empty_mkdtemp_v1` before environment hashing. A precreated, reused, symlinked, nonempty, wrong-owner, wrong-mode, or caller-selected cache fails `unsafe_full_suite_build_cache` before child execution. The cache is an output-only command root and never an input authority.

Each command result binds the three exact `Phase1IgnoredStateTransition` objects. For every key, a transition's repository, policy, policy digest, before, and after fields are closed; each result after-state must equal the next result before-state, the chain initial state must equal the baseline envelope, the chain final state must equal the final result, `transition_count` is exactly 17, and `transitions_digest` hashes the canonical ordered triples. The feature review, integration entry, handoff, and receipt each carry a closed `Phase1IgnoredStateEvidenceReference` to the applicable results and independently reload the results bytes before accepting it. `captureAndRunPhase1`, `validatePhase1ResultsValue`, `buildPhase1IntegrationEntry`, `validatePhase1IntegrationEntryValue`, `buildPhase1Handoff`, `validatePhase1HandoffValue`, `buildPhase1IntegrationReceipt`, both pre-commit and post-commit `validatePhase1IntegrationReceiptValue` paths, and `verifyPhase1FinalRemote` reject absent/extra/wrong policy, digest, repository, before, after, adjacency, initial, final, count, reference, or chain-digest fields. A later stage on a different root binds that root's own identity and full ignored-state summary rather than pretending path-dependent `.codegraph` bytes are cross-root identical; within one root, every transition is contiguous and exact. The independent feature review covers both the implementation-tree bindings and the complete ignored-state transition chain. Create, modify, delete, rename, executable-mode, regular-file/symlink type, or symlink-target drift under any ignored path must fail `ignored_state_drift`, even when all downstream JSON digests are consistently rehashed. Mutation fixtures exercise each operation independently at capture, results, integration-entry build/validation, handoff build/validation, receipt build/pre-commit/post-commit validation, and final-remote invocation-period validation.

The adapter accepts no shell strings. It expands only `${CC_GATEWAY_ROOT}`, `${SUB2API_ROOT}`, and `${SUB2API_CONTRACT_ROOT}`, caps output at 8 MiB, records digests and safe test names only, and writes artifacts with `writeExclusiveArtifact` under `docs/superpowers/evidence/phase-1`. The capture envelope still binds the tested Sub2API implementation root. The base command environment binds `SUB2API_ROOT` to that tested root for every non-full-suite GREEN row; only `cc-b4-b6-red` may replace it with the validated clone root. For catalog closure, only `cc-tests` and `cc-tests-repeat` may set `SUB2API_FORMAL_POOL_CONTRACT_PATH`; the exact catalog value is `${SUB2API_CONTRACT_ROOT}/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json`, and semantic validation resolves it to the already validated regular contract file inside the independent contract clone. For those two rows, the `cc-tests` and `cc-tests-repeat` child environments omit `SUB2API_ROOT`; the existing unmodified P0/P0.1 resolver derives the clone root from the dedicated file and then proves branch `main`, frozen HEAD, clean status, origin digest, containment, regular-file type, and contract digest. For catalog closure, all other catalog rows forbid `SUB2API_FORMAL_POOL_CONTRACT_PATH`. The missing, relative, alternate-root, wrong-suffix, symlink, inherited-startup, and every forbidden-row environment mutation fails `contract_root_not_authorized` before spawning; every forbidden command ID independently receives the variable and must fail `contract_root_not_authorized` with zero spawned commands. No test relies on one opaque cross-row sample.

The H1 launcher constructs a new closed environment for each spawn and never spreads `process.env`. Its allowlist is exactly the inventory-bound `${CC_GATEWAY_ROOT}/node_modules/.bin`, reviewed executable directory, `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`, `HOME=/tmp`, `TMPDIR=/tmp`, `LANG=C`, `LC_ALL=C`, `TZ=UTC`, npm user config `/dev/null`, npm global config `/nonexistent/oracle-lab-empty-global-npmrc`, npm audit/fund/update disabled, npm and Go offline settings, `GOENV=off`, `GOFLAGS=-mod=readonly`, `GOPROXY=off`, `GOSUMDB=off`, `GOTOOLCHAIN=local`, authenticated canonical `GOMODCACHE`, exclusive empty `mkdtemp` `GOCACHE`, the fixed proxy-denial/`NO_PROXY` set, the command-specific catalog variable, and the sandbox descriptor supplied after validation. Only the two dependency-preparation children additionally receive the freshly created private `npm_config_cache` and matching `--cache` argv; no catalog row receives or persists it. `SUB2API_ROOT`, `ORACLE_*`, `PHASE1_*`, `GIT_*`, arbitrary inherited npm config, caller `GOCACHE`, credentials, custom certificate paths, loader options, and dynamic-library injection are absent. Nonempty `NODE_OPTIONS`, `NODE_PATH`, `NODE_EXTRA_CA_CERTS`, `TSX_TSCONFIG_PATH`, `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`, or `DYLD_LIBRARY_PATH` at the launch boundary fails `unsafe_full_suite_environment` before any child spawn. Invalid build-cache state fails `unsafe_full_suite_build_cache`. `HERMETIC_NETWORK_ENV` plus offline package-manager variables remain defense in depth, but raw argv never goes directly to `runBoundedProcess`: `wrapPhase1Command` places every command and all descendants inside the reviewed OS loopback-only sandbox.

On the frozen macOS runner, `resolvePhase1LoopbackSandbox` requires the reviewed absolute `/usr/bin/sandbox-exec`, records its binary digest, and generates a private mode-0600 profile with exactly `(allow default)`, `(deny network*)`, `(allow network-outbound (remote tcp "localhost:*"))`, and `(allow network-inbound (local tcp "localhost:*"))` after the required `(version 1)`. The `localhost:*` rule is live-tested for both `127.0.0.1` and `::1`; address-literal profile rules are forbidden because they are rejected by the current Seatbelt parser. Record the policy digest. Before the first catalog command, canaries prove dynamically allocated IPv4 and IPv6 loopback servers are reachable while a direct socket to the RFC 5737 TEST-NET address `198.51.100.1` fails with `EPERM` or `EACCES`, never timeout, refusal, or success. The canary carries no credential or user data. Unsupported platforms, unexpected denial codes, or unavailable enforcement return `network_sandbox_unavailable`; there is no proxy-only degraded mode. Each result binds the same policy digest and zero observed sandbox violations. A sandbox denial/violation during a command terminates that capture as `unexpected_fail`; no evidence file is written. Unit tests prove a Node direct socket and a spawned child cannot bypass the guard. A later Linux runner requires a separately reviewed namespace adapter and equivalent canaries; it is not silently accepted by this plan.

The RED parser consumes only complete machine-readable runner streams and requires empty stderr. `node_test_tap_v1` accepts exactly one `TAP version 13` stream, unique contiguous test-point ordinals `1..68`, exactly one terminal `1..68` plan after all test points, and the exact terminal summary `tests 68 / suites 0 / pass 7 / fail 61 / cancelled 0 / skipped 0 / todo 0`. The plan, summary, and parsed point counts must agree. It extracts only failed `B4`/`B5`/`B6` leaf test points, never the file process, suite summaries, YAML diagnostics, passes, or skips; any failed non-leaf/process point is unparsed failure. A second/missing plan, duplicate or missing ordinal, test point after the terminal plan, JSON/YAML diagnostic pretending to be a point, truncated-but-line-valid prefix, or nonempty unexplained stderr is `unexpected_fail`.

`go_test_json_leaf_v1` requires every nonblank stdout line to be one valid `go test -json` object and permits exactly the module packages ending in `internal/control` and `internal/server`. Per package, the first event is the sole package `start`; every unique `Test` has exactly one `run` before exactly one terminal `pass|fail|skip`; no test event follows its terminal; the final package event is the sole package-level `fail`; and no event follows that package terminal. Control must have `4` run/terminal tests (`2` pass, `2` fail), server must have `64` run/terminal tests (`11` pass, `53` fail), and both have zero skips. A package/build failure without this lifecycle, a missing package, missing test/package terminal, duplicate run/terminal, JSON-valid truncation, unexpected package, terminal-after-terminal event, malformed object, or nonempty unexplained stderr is `unexpected_fail`. A failed `Test` is a leaf only when it has no failed strict `/` descendant in the same package. A failed parent with descendants may be excluded as a container only when its own `Output` events contain runner scaffolding and no independent file/line diagnostic; otherwise the parent failure is unparsed and blocks capture.

After runner validation, names are classified by anchored safe patterns (`^B4(?:\\s|$)`, `^B5(?:\\s|$)`, `^B6(?:\\s|$)`, `^TestPhase0B5[A-Za-z0-9_/]*$`, and `^TestPhase0B6[A-Za-z0-9_/]*$`). All safe leaf events, including repeats, are UTF-8-byte-sorted into deterministic `failure_event_names`; raw runner order is ignored. `failure_event_count` equals that multiset length. The validator derives duplicate multiplicity and canonical unique `failure_names` from the multiset rather than trusting either persisted unique field; `failure_count` equals the unique length. A nonzero exit becomes `expected_fail` only when parsing/lifecycle are complete and equal the command's catalog lifecycle, duplicate multiplicity is zero, both event and unique counts equal the catalog constant, unique names equal the command's exact catalog array byte-for-byte, the derived family array exactly equals the catalog family array, and there are zero unclassified names. Missing, added same-prefix, duplicate, reordered persisted multiset/unique array, unknown, partial, lifecycle drift, or supersets become `unexpected_fail`.

`validatePhase1ResultsValue` reloads the catalog, validates the persisted parser lifecycle summary, re-derives sorted multiset/count, duplicates, unique names/count, and families from `failure_event_names`, compares every field to the command-specific catalog row, and rejects a rehashed forgery. It never treats the stdout digest alone as parser proof. `validatePhase1IntegrationEntryValue`, `buildPhase1Handoff`, `validatePhase1HandoffValue`, `buildPhase1IntegrationReceipt`, and both pre/post-commit receipt validators independently reload catalog plus results, require the exact catalog digest, rerun results semantics, and repeat the same per-command comparison before accepting downstream bindings. The closed lifecycle summary preserves only counts and constant package/parser identifiers; raw diagnostics are not persisted.

The following JSON is the normative canonical RED inventory captured at CC Gateway `ca0a1453a855ea6381de98eb66a25667ebd1cbaf` with the Sub2API contract frozen at `b0b77933716487da5fca00329443f88ce9a1c3db`. Task 7 copies these exact lifecycle objects, arrays, and counts into the closed catalog; it must not regenerate or update them implicitly. Any observed drift blocks Phase 1 and requires an explicit reviewed plan/catalog revision.

<!-- PHASE1_RED_FAILURE_INVENTORY_START -->
```json
{
  "cc-b4-b6-red": {
    "failure_parser": "node_test_tap_v1",
    "expected_parser_lifecycle": {
      "parser": "node_test_tap_v1",
      "tap_version_count": 1,
      "terminal_plan_count": 1,
      "declared_test_count": 68,
      "observed_test_count": 68,
      "pass_count": 7,
      "fail_count": 61,
      "cancelled_count": 0,
      "skipped_count": 0,
      "todo_count": 0,
      "unexplained_stderr_line_count": 0
    },
    "expected_failure_count": 61,
    "expected_failure_families": ["B4", "B5", "B6"],
    "expected_failure_names": [
      "B4 handleRequest denies direct fallback configuration before DNS socket or dial",
      "B4 handleRequest denies mismatched proxy generation before DNS socket or dial",
      "B4 handleRequest denies missing manifest authority before DNS socket or dial",
      "B4 handleRequest denies missing proxy generation before DNS socket or dial",
      "B4 handleRequest denies missing sidecar before DNS socket or dial",
      "B4 handleRequest denies missing verified context before DNS socket or dial",
      "B4 handleRequest denies unknown manifest authority before DNS socket or dial",
      "B5 authentication changes after absolute deadline mutation",
      "B5 authentication changes after account identity mutation",
      "B5 authentication changes after attempt ID mutation",
      "B5 authentication changes after content encoding mutation",
      "B5 authentication changes after content length mutation",
      "B5 authentication changes after envelope version mutation",
      "B5 authentication changes after expected summary mutation",
      "B5 authentication changes after final forwarded-header hash mutation",
      "B5 authentication changes after final request-body hash mutation",
      "B5 authentication changes after key epoch mutation",
      "B5 authentication changes after manifest authority mutation",
      "B5 authentication changes after method mutation",
      "B5 authentication changes after nonce mutation",
      "B5 authentication changes after profile ref mutation",
      "B5 authentication changes after proxy generation mutation",
      "B5 authentication changes after response policy mutation",
      "B5 authentication changes after route mutation",
      "B5 authentication changes after target path mutation",
      "B5 authentication changes after target scheme mutation",
      "B5 authentication changes after timestamp mutation",
      "B5 authentication changes after verified context mutation",
      "B5 complete control includes absolute_deadline_ms",
      "B5 complete control includes account_identity_ref",
      "B5 complete control includes attempt_id",
      "B5 complete control includes content_encoding",
      "B5 complete control includes content_length",
      "B5 complete control includes envelope_version",
      "B5 complete control includes expected_response_policy_ref",
      "B5 complete control includes final_headers_hash",
      "B5 complete control includes key_epoch",
      "B5 complete control includes manifest_authority_ref",
      "B5 complete control includes nonce",
      "B5 complete control includes proxy_generation",
      "B5 complete control includes request_body_hash",
      "B5 complete control includes timestamp_ms",
      "B5 complete control includes verified_context_ref",
      "B6 permits private proxy only through an explicit approved-range policy",
      "B6 rejects DNS rebinding without pinned resolution",
      "B6 rejects IPv4 link-local",
      "B6 rejects IPv4 loopback",
      "B6 rejects IPv4 multicast",
      "B6 rejects IPv4 unspecified",
      "B6 rejects IPv4-mapped IPv6 loopback",
      "B6 rejects IPv6 link-local",
      "B6 rejects IPv6 loopback",
      "B6 rejects IPv6 multicast",
      "B6 rejects IPv6 unspecified",
      "B6 rejects alternate dial target",
      "B6 rejects cloud metadata",
      "B6 rejects expanded IPv4-mapped IPv6",
      "B6 rejects nested proxy directive",
      "B6 rejects private IPv4 without explicit policy",
      "B6 rejects redirect directive",
      "B6 rejects scheme confusion"
    ]
  },
  "sidecar-b5-b6-red": {
    "failure_parser": "go_test_json_leaf_v1",
    "expected_parser_lifecycle": {
      "parser": "go_test_json_leaf_v1",
      "packages": [
        {
          "package_suffix": "internal/control",
          "start_count": 1,
          "run_test_count": 4,
          "terminal_test_count": 4,
          "pass_test_count": 2,
          "fail_test_count": 2,
          "skip_test_count": 0,
          "package_fail_terminal_count": 1,
          "post_terminal_event_count": 0
        },
        {
          "package_suffix": "internal/server",
          "start_count": 1,
          "run_test_count": 64,
          "terminal_test_count": 64,
          "pass_test_count": 11,
          "fail_test_count": 53,
          "skip_test_count": 0,
          "package_fail_terminal_count": 1,
          "post_terminal_event_count": 0
        }
      ],
      "unexplained_stderr_line_count": 0,
      "malformed_or_unparsed_event_count": 0
    },
    "expected_failure_count": 51,
    "expected_failure_families": ["TestPhase0B5", "TestPhase0B6"],
    "expected_failure_names": [
      "TestPhase0B5BindingRejectsEveryControlMutation/expected_tls_summary_bucket",
      "TestPhase0B5BindingRejectsEveryControlMutation/method",
      "TestPhase0B5BindingRejectsEveryControlMutation/profile_ref",
      "TestPhase0B5BindingRejectsEveryControlMutation/route",
      "TestPhase0B5BindingRejectsEveryControlMutation/target_path",
      "TestPhase0B5BindingRejectsEveryControlMutation/target_scheme",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/absolute_deadline_ms",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/account_identity_ref",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/attempt_id",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/content_encoding",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/content_length",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/envelope_version",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/expected_response_policy_ref",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/expected_tls_summary_bucket",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/final_headers_hash",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/key_epoch",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/manifest_authority_ref",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/method",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/nonce",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/profile_ref",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/proxy_generation",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/request_body_hash",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/route",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/target_path",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/target_scheme",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/timestamp_ms",
      "TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations/verified_context_ref",
      "TestPhase0B5ControlRejectsLegacyIncompleteControl",
      "TestPhase0B5ControlRequiresCompleteV2Envelope",
      "TestPhase0B5RejectsLegacyPartialProxyBinding",
      "TestPhase0B5ReplayRejectedAfterCompletionRestartAndReplicaChange/distinct_replica_with_shared_replay_state",
      "TestPhase0B5ReplayRejectedAfterCompletionRestartAndReplicaChange/restart_with_persistent_replay_state",
      "TestPhase0B5ReplayRejectedAfterCompletionRestartAndReplicaChange/same_instance_after_successful_completion",
      "TestPhase0B6RebindingResolutionIsPinnedBeforeDial",
      "TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/alternate_dial_target",
      "TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/dns_rebinding_unpinned",
      "TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/expanded_mapped_ipv6",
      "TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/ipv4_link_local",
      "TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/ipv4_loopback",
      "TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/ipv4_mapped_ipv6",
      "TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/ipv4_multicast",
      "TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/ipv4_unspecified",
      "TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/ipv6_link_local",
      "TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/ipv6_loopback",
      "TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/ipv6_multicast",
      "TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/ipv6_unspecified",
      "TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/metadata",
      "TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/nested_proxy_directive",
      "TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/private_without_policy",
      "TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/redirect_directive",
      "TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial/scheme_confusion"
    ]
  }
}
```
<!-- PHASE1_RED_FAILURE_INVENTORY_END -->

The acceptance function is closed by the following truth table. Any row not explicitly accepted fails the transaction before result artifacts are written.

| Command kind | Exit | Parser lifecycle | Event multiset duplicate | Canonical names/count/families | Classification |
| --- | --- | --- | --- | --- | --- |
| GREEN | `0` | not applicable | not applicable | empty RED fields | `pass` |
| GREEN | nonzero | any | any | any | `unexpected_fail` |
| RED | `0` | complete | none | any | `unexpected_pass` |
| RED | nonzero | complete | none | all exact | `expected_fail` |
| RED | nonzero | incomplete/ambiguous | any | any | `unexpected_fail` |
| RED | nonzero | complete | present | otherwise exact or not | `unexpected_fail` |
| RED | nonzero | complete | none | missing/extra/reordered-persisted/count/family mismatch | `unexpected_fail` |

Permuting complete raw runner events must produce the same deterministic sorted multiset, unique canonical array, lifecycle summary, result digest, and `expected_fail`. Permuting either persisted sorted array is invalid. Tests cover missing leaf, added unrelated leaf, added same-prefix leaf, duplicate event retained in the multiset, wrong event/unique count, wrong family/parser/lifecycle, raw-event permutation, persisted multiset/unique-array permutation, malformed TAP/JSON, TAP missing/duplicate plan or ordinal, Go missing package/test/package terminal, JSON-valid truncation, package/build failure, terminal-after-terminal event, nonempty unexplained stderr, unexpected Go package, and failed Go parent/child container handling.

- [ ] **Step 4: Add the exact Phase 1 command catalog**

```text
sub-b1-b3: ${SUB2API_ROOT}/backend :: go test -tags=phase0red ./internal/service ./internal/server/routes -run FormalPoolOnboarding|Browser|Egress -count=1 :: exit 0
sub-formal-pool: ${SUB2API_ROOT}/backend :: go test ./internal/service ./internal/server/routes ./internal/handler/... -run FormalPool|FormalPoolOperations -count=1 :: exit 0
sub-full-go: ${SUB2API_ROOT}/backend :: go test ./... -count=1 :: exit 0
sub-frontend-h1: ${SUB2API_ROOT}/frontend :: npm run test:run -- src/components/account/__tests__/ClaudeFormalPoolOnboardingWizardV2.spec.ts src/composables/__tests__/useEgressCheckPolling.spec.ts :: exit 0
sub-frontend-typecheck: ${SUB2API_ROOT}/frontend :: npm run typecheck :: exit 0
sub-frontend-build: ${SUB2API_ROOT}/frontend :: npm run build :: exit 0
sub-frontend-build-repeat: ${SUB2API_ROOT}/frontend :: npm run build :: exit 0
cc-listener-h1: ${CC_GATEWAY_ROOT} :: npm exec tsx tests/listener-boundary.test.ts :: exit 0
cc-upstream-tls-h1: ${CC_GATEWAY_ROOT} :: npm exec tsx tests/upstream-tls-boundary.test.ts :: exit 0
cc-build: ${CC_GATEWAY_ROOT} :: npm run build :: exit 0
cc-build-repeat: ${CC_GATEWAY_ROOT} :: npm run build :: exit 0
cc-tests: ${CC_GATEWAY_ROOT} :: npm test :: env SUB2API_FORMAL_POOL_CONTRACT_PATH=${SUB2API_CONTRACT_ROOT}/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json :: exit 0
cc-tests-repeat: ${CC_GATEWAY_ROOT} :: npm test :: env SUB2API_FORMAL_POOL_CONTRACT_PATH=${SUB2API_CONTRACT_ROOT}/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json :: exit 0
sidecar-tests: ${CC_GATEWAY_ROOT}/sidecar/egress-tls-sidecar :: go test ./... -count=1 :: exit 0
joint-local-chain: ${SUB2API_ROOT}/backend :: go test ./internal/service -run ^(TestClaudePlatformAWSLocalFullChainE2EUsesCCGatewayAndSafeMockUpstream|TestJointLocalCaptureAcceptanceArtifact)$ -count=1 -v :: exit 0
cc-b4-b6-red: ${CC_GATEWAY_ROOT} :: node --import tsx --test --test-reporter=tap --test-name-pattern=^(B4|B5|B6)(\\s|$) tests/red/phase0-boundary.red.test.ts :: env SUB2API_ROOT=${SUB2API_CONTRACT_ROOT} :: nonzero :: parser node_test_tap_v1 :: lifecycle tests/pass/fail 68/7/61, zero cancelled/skipped/todo/stderr :: exact failing leaves/count 61 :: failure families [B4,B5,B6] :: allowed failing prefixes [B4 ,B5 ,B6 ]
sidecar-b5-b6-red: ${CC_GATEWAY_ROOT}/sidecar/egress-tls-sidecar :: go test -json -tags=phase0red ./internal/control ./internal/server -run ^TestPhase0B[56] -count=1 :: nonzero :: parser go_test_json_leaf_v1 :: lifecycle control run/pass/fail 4/2/2, server 64/11/53, zero skip/stderr :: exact failing leaves/count 51 :: failure families [TestPhase0B5,TestPhase0B6] :: allowed failing prefixes [TestPhase0B5,TestPhase0B6]
```

The first fifteen entries use `phase1-green`; the final two use `phase1-red`. `sub-frontend-build-repeat`, `cc-build-repeat`, and `cc-tests-repeat` are distinct evidence rows, not aliases: they execute only after their first counterpart, record independent real exit/output digests, and use the contiguous ignored-state transition chain. `SUB2API_ROOT` normally expands to the tested implementation root; only `cc-b4-b6-red` overrides it with `${SUB2API_CONTRACT_ROOT}` so the existing fail-closed resolver sees a committed `main` contract clone rather than rejecting the feature branch before test registration. Catalog validation forbids this override on every other row. The two GREEN full-suite capture envelopes retain the tested Sub2API implementation binding, but their closed child environments omit `SUB2API_ROOT` and receive only the dedicated exact contract-file variable above. This lets the existing resolver validate the independent clean `main` clone without substituting it for the tested implementation. Every implemented requirement ID appears on at least one GREEN command. `cc-listener-h1`, `cc-upstream-tls-h1`, and `sidecar-tests` jointly bind `RA-P0-008`. The CC RED name filter excludes the separate `HA-P0-009` Phase 2 corpus instead of ignoring its failures; the sidecar filter excludes unrelated Go tests. The RED entries carry only `AV-B4-001`, `AV-B5-001`, and `AV-B6-001` links and never satisfy a Phase 1 requirement. Catalog validation hard-codes exact argv, environment, parser, canonical name arrays, exact counts, family arrays, both tested-repository ignored-output policies, and failing-name prefixes per command ID rather than trusting arbitrary catalog strings. Both schemas and semantic validation reject a catalog whose count differs from its array length, whose array is not canonical and unique, or whose derived family set differs from the declared set.

- [ ] **Step 5: Implement one `run-all` capture transaction**

```typescript
export function captureAndRunPhase1(options: {
  stage: 'feature-candidate' | 'post-integration'
  controllerRoot: string
  ccGatewayRoot: string
  sub2apiRoot: string
  sub2apiContractRoot: string
  entryPath?: string
  executionContextPath?: string
  integrationEntryPath?: string
  catalogPath: string
  baselineOut: string
  resultsOut: string
  now?: string
  runner?: typeof runBoundedProcess
  sandbox?: Phase1LoopbackSandbox
}): { baseline: Phase1ExitBaseline; results: Phase1Results }
```

`feature-candidate` requires both `entryPath` and `executionContextPath`, forbids `integrationEntryPath`, and requires `controllerRoot === ccGatewayRoot` with a clean pre-run status. The supplied path is not trusted: enumerate the exact initial/numbered artifacts, validate their schemas and raw bytes, prove contiguous sequence plus Git introduction/immutability/ancestry, and require the argument to equal the unique latest contiguous context chain head at stage `feature_capture`; otherwise fail `stale_execution_context` before spawn. `post-integration` requires `integrationEntryPath`, forbids both `entryPath` and `executionContextPath`, requires `controllerRoot !== ccGatewayRoot`, and requires the controller HEAD to equal the frozen CC integrated-main commit with exactly one allowed pre-run delta: the attempt-scoped untracked integration entry. In both stages, `ccGatewayRoot` and `sub2apiRoot` are the tested roots and must be entirely clean before and after every catalog command; only declared output writes in the controller root may change during the transaction. Output paths must resolve inside `controllerRoot`, be absent before capture, and be included in its declared after-status. Both stages also require a distinct clean `sub2apiContractRoot` that is an independent Git clone on branch `main`, bound to the applicable frozen Sub2API remote-main head, origin-URL digest, and shared-contract digest. Before any spawn, validate that root as a clean clone with no replacement refs or alternate object-store injection, exact bound HEAD, expected origin, and the frozen contract path/digest; include the closed `Phase1ContractRootBinding` in before/after snapshots. Reject a linked worktree, the implementation root, or the operator's original repository root. The closed schema rejects every other combination, and only post-integration results may feed `build-handoff`. In the next paragraph, "execution context" means the selected stage authority: the latest context/review chain for feature capture or the integration entry plus its bound provenance for post-integration capture.

Before the first command, validate the selected stage authority and parse the closed plan-review provenance. All Git inspection uses `runReviewedGit`; replacement refs and inherited Git/PATH/object-store configuration fail closed. Re-derive the digests of planning provenance, review receipt, current plan, and `git show <reviewed_commit>:<plan.path>`; all plan digests and commits must match exactly, not merely by ancestry. Require `approved`, zero Critical/Important findings, and the exact authority/provenance paths. For feature capture, the selected latest `feature_capture` context is still an untracked claim during its live gate: derive its CC artifact commit as the unique one-parent child of `repositories.cc_gateway.authorized_parent_head` whose entire delta is `A\t<selected-context-path>`, then require the tested CC feature HEAD to equal that derived artifact commit. Require the tested Sub2API feature HEAD to equal `repositories.sub2api.authorized_parent_head` exactly. Prove the selected bytes at the derived CC HEAD and prove no later commit changes that path; do not compare the post-commit CC HEAD directly to the pre-issue `authorized_parent_head`. Persist `{path,digest,sequence,stage,artifact_commit}` for that context chain head in both baseline and results. Then enforce the stage-specific controller rule above; verify both tested roots are on those exact derived feature heads or exact integrated-main heads, are clean, have current CodeGraph indexes, and remain byte/status stable around each command; validate parent receipts, shared-contract bytes, and absent production/canary flags. Resolve the OS sandbox and run both canaries before spawning a catalog command. Capture controller/tested heads, root-identity/status digests, CodeGraph digests, catalog digest, sandbox executable/policy digests, canary verdicts, and the first ignored-state bindings in memory; run all seventeen commands sequentially only through `wrapPhase1Command`. Before and after each command, recompute the controller and both tested-root inventories, validate symlink closure, and enforce the command-specific closed policy plus contiguous transition chain. For each RED command, require a complete command-specific machine parser/lifecycle, preserve and sort the full safe leaf-event multiset, derive duplicates/unique names/counts/families, and compare exact catalog constants before accepting `expected_fail`. Reject any sandbox violation, root/status/ignored-state change outside policy, parser/lifecycle/event/name/count/family mismatch, unexpected status, or unsafe output, then atomically write the two declared outputs under `controllerRoot`. Results persist the catalog digest, context-chain-head binding, closed ignored-state transitions and chain binding, lifecycle summary, sorted `failure_event_names` multiset/event count, canonical unique names/count, and derived families. No result evidence file is written before the last command completes. An expired or non-latest context can never authorize capture.

In addition to the ignored-state checks above, preparation must clone two independent authenticated npm cache seeds, complete both exact offline npm installations through their explicit private cache roots, and complete Go module verification before the baseline snapshot. Capture the initial `Phase1ExternalDependencySet`; recompute it before and after all 17 commands; attach one `Phase1ExternalDependencyTransition` to every result; and close the chain in `Phase1ExternalDependencyChainBinding`. Every downstream builder and validator reloads the referenced results and embeds/revalidates `Phase1ExternalDependencyEvidenceReference`. Actual random npm-cache and `GOCACHE` paths are never persisted or hashed; only the closed npm cache preparation fields and Go constant `command_scoped_empty_mkdtemp_v1` survive after exclusive cache checks pass.

- [ ] **Step 6: Add CLI subcommands and package entry**

```json
{
  "scripts": {
    "oracle:phase1": "tsx tools/oracle-lab/phase-1-evidence.ts"
  }
}
```

Supported subcommands are exact: `validate-catalog`, `validate-feature-review`, `run-all`, `validate-results`, `build-integration-entry`, `build-handoff`, `validate-handoff`, `build-integration-receipt`, `validate-integration-receipt`, and `verify-final-remote`. Their closed parsers accept only the flags shown verbatim in Task 8. `build-integration-entry` requires controller/tested/contract roots, latest execution-context chain head, plan review, catalog, feature results, closed feature-review JSON, exact reviewed candidate/review-attestation heads, both merge commit SHAs plus their captured pre-merge main heads, both expected remote names/refs/origin digests, attempt ID, and one output path. It reselects the latest chain and requires the results context either to equal it or to be an immutable predecessor followed only by `feature_capture` renewals with identical authorized feature heads. It validates the review receipt, proves ordinary merge topology, revalidates feature results, and binds every digest for post-integration capture. Every results, integration-entry, handoff, and receipt build/validation command requires the explicit catalog path; it reloads the catalog, validates the command-specific parser lifecycle, event multiset/count, canonical unique leaf array/count, and families, and binds its digest rather than trusting an embedded digest alone. Both handoff commands require explicit controller, tested CC, integrated Sub2API, and contract roots so both implementation trees and the contract can be recomputed without persisted absolute paths or environment fallback. `build-integration-receipt` additionally requires controller root, integrated Sub2API root, artifact commit, entry/baseline/results/handoff/report/three registries, and receipt output. `validate-integration-receipt` requires the same bound inputs plus the receipt path; it forbids `--receipt-commit` before commit and requires it for the post-commit child check. Starting or rerunning feature capture requires an unexpired latest feature context. `build-integration-entry` may consume an expired feature context only as immutable historical provenance when the accepted results prove capture occurred inside its validity window and every later renewal satisfies the identical-head rule; the newly built integration entry is the fresh post-integration authority. Every other live builder rejects expired current-stage authority. A committed receipt later validates the bound `historical_valid_at` relationships instead of comparing historical source expiry to the current wall clock. Unknown commands, missing or duplicate arguments, undeclared flags, path traversal, symlink artifacts, invalid historical validity, live expired current-stage inputs, and absolute persisted paths fail with stable error codes. Each attempt builder writes only absent paths within its immutable attempt namespace. The receipt builder accepts only a clean exact artifact commit; the validator enforces its one-path child commit when supplied. `verify-final-remote` is read-only, writes no repository artifact, and emits one canonical JSON object to stdout after the exact live checks in Step 12.

For attempt authority, `build-integration-entry` always accepts the exact four flags `--previous-attempt-id`, `--previous-attempt-receipt`, `--previous-attempt-receipt-digest`, and `--previous-attempt-receipt-commit`. On `attempt-0001`, all four values must be the literal `none` and the schema writes `predecessor: null`. On `attempt-N` for `N > 1`, `none` is forbidden and all four values must bind the validated `attempt-(N-1)` receipt tuple selected from integrated main. Partial tuples, environment fallback, an ID other than the next contiguous committed attempt, and an old receipt replay fail `attempt_chain_invalid` before integration-entry creation.

Authority restart is deliberately not a subcommand of the replayed Task 7 adapter. It is provided by the already reviewed `tools/oracle-lab/oracle-phase1-authority-restart` hermetic launcher, `tools/oracle-lab/phase-1-authority-bootstrap.mjs` dependency-free bootstrap, and `tools/oracle-lab/phase-1-authority-restart.ts` pure operation module on repaired main, with exact commands `validate-runtime`, `validate-source`, `build`, `validate-pre-commit`, and `validate-post-commit`. `validate-runtime` is a no-side-effect positive startup probe after dependency authentication that accepts only `--cc-replacement-root`; it must pass before `validate-source`. The launcher rejects Node/tsx, dynamic-library, and Git startup injection before Node starts; selects reviewed absolute Node/Git executables; and verifies the working launcher, bootstrap, tool, schema, secure runtime, and lock bytes against fetched repaired main. Before loading tsx or Ajv, the dependency-free bootstrap uses only Node built-ins and reviewed absolute OS tools to inventory and copy-on-write clone only `_cacache` from the canonical OS account resolved from the account database rather than inherited `HOME`. The canonical account npm cache is an untrusted content seed only: its `.npm` and `_cacache` roots must be real account-owned directories with no group/world write, every descendant must be a real directory or regular file, and any symlink or special file fails closed. The source inventory is byte-identical before and after the clone, the command-scoped clone has the exact same path/type/mode/size/content inventory, and any source race fails closed. The exclusive command cache is mode 0700 and never supplies authority or persisted evidence. The bootstrap first requires Node's forced clone primitive and, only when the runtime reports `ENOSYS`, uses reviewed absolute `/bin/cp -c`; neither path follows a discovered cache symlink. Under `env -i`, exact `npm ci --offline --ignore-scripts --cache <command-scoped-cache>` authenticates package bytes against the reviewed lockfile integrity before the bootstrap loads tsx/Ajv; writes to the command cache cannot modify the account cache. Inherited `HOME`, `npm_config_cache`, user config, global config, and network fallback cannot select dependency bytes. The actual cache paths are never persisted. No environment or string marker attests bootstrap completion: after verifying runtime bytes and authenticating dependencies, the bootstrap retains command dispatch and imports only pure TypeScript operations. No importable TypeScript export dispatches authority commands, and bootstrap binds the TypeScript module root to the tested CC replacement root. The TypeScript entry point always rejects direct execution; only the reviewed bootstrap may import its pure operations after the dependency gate. The closed parser accepts only explicit CC/Sub2API source and replacement roots, reviewed plan/review/context paths, canonical restart output path, and gate mode; source SHAs, checkpoint, tuples, branch names, exclusion lists, and artifact path are compiled constants rather than CLI or environment inputs.

The exact shared flags are `--cc-source-root`, `--cc-replacement-root`, `--sub2api-source-root`, and `--sub2api-replacement-root`. `validate-runtime` accepts only `--cc-replacement-root`; `validate-source` accepts only the four shared flags. `build` additionally requires exact `--plan-path`, `--plan-review-path`, `--execution-context-path`, and `--output`, plus one ordered `--cc-replacement-commit` per CC replay commit and one ordered `--sub2api-replacement-commit` per Sub2API replay commit. `validate-pre-commit` and `validate-post-commit` additionally accept only `--artifact`. The three path arguments and output/artifact must equal the compiled canonical paths; missing, duplicate, unknown, environment-derived, or command-inapplicable arguments fail `authority_restart_cli_arguments_invalid`. `build` writes the canonical artifact exclusively and immediately runs the strict pre-commit gate. The strict pre-commit gate requires the artifact to be the sole untracked delta and rejects a fully clean tree; post-commit derives the committed bytes and one-path topology from Git.

For `validate-runtime`, "no-side-effect" is limited to authority artifacts, replay, and Git state; its declared ignored-state preparation is the isolated dependency install and command-cache creation above.

- [ ] **Step 7: Run adapter, planning, P0.1, and full CC regression**

Run: `npm exec tsx tests/oracle-lab-phase-1-evidence.test.ts`

Run: `npm exec tsx tests/oracle-lab-phase-1-planning.test.ts`

Run: `npm run test:oracle:p0-1`

Run serially three times from one unchanged clean HEAD: `env -i PATH=/opt/homebrew/Cellar/node/24.7.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin HOME=/tmp TMPDIR=/tmp LANG=C LC_ALL=C TZ=UTC npm_config_userconfig=/dev/null npm_config_globalconfig=/nonexistent/oracle-lab-empty-global-npmrc npm_config_offline=true npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false GOENV=off GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 NO_PROXY=127.0.0.1,localhost,::1 SUB2API_FORMAL_POOL_CONTRACT_PATH=${SUB2API_CONTRACT_ROOT}/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json /opt/homebrew/bin/npm test`. Do not combine or parallelize the three runs. Then run `npm run build` in the same frozen worktree and compare the ignored-state binding to the reviewed build policy.

Expected: all PASS. The Phase 0 and P0.1 artifacts and tools remain byte-for-byte unchanged.

- [ ] **Step 8: Commit the nonempty Task 7 authority-repair continuation**

On the authority-repair path, the pinned checkpoint has already introduced the original Task 7 files. This step must therefore contain only the reviewed post-replay implementation needed for dedicated contract-path child environments, closed dependency bindings/references, exclusive build caches, downstream revalidation, and the expanded mutation corpus. Require a nonempty diff from the restart-artifact commit, forbid plan/restart-tool/restart-artifact/context/review changes, and independently review the entire replayed Task 7 plus this continuation. On a future clean execution with no mid-task repair, the same add list introduces the files normally.

```bash
git add docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json docs/superpowers/schemas/oracle-lab-phase-1-command-catalog.schema.json docs/superpowers/schemas/oracle-lab-phase-1-exit.schema.json docs/superpowers/schemas/oracle-lab-phase-1-results.schema.json docs/superpowers/schemas/oracle-lab-phase-1-feature-review.schema.json docs/superpowers/schemas/oracle-lab-phase-1-handoff.schema.json docs/superpowers/schemas/oracle-lab-phase-1-integration-entry.schema.json docs/superpowers/schemas/oracle-lab-phase-1-integration-receipt.schema.json tools/oracle-lab/phase-1-evidence.ts tools/oracle-lab/phase-1-loopback-sandbox.ts tests/oracle-lab-phase-1-evidence.test.ts package.json
git diff --cached --quiet && { printf 'Task 7 continuation must be nonempty\n' >&2; exit 1; }
git commit -m "test(oracle): complete bounded Phase 1 H1 evidence adapter"
```

### Task 8: Feature Review, Post-Integration Evidence, Registry Transition, and Handoff

**Files:**
- Create: `docs/superpowers/evidence/phase-1/${PHASE1_FEATURE_ATTEMPT_ID}/phase-1-feature-baseline.json`
- Create: `docs/superpowers/evidence/phase-1/${PHASE1_FEATURE_ATTEMPT_ID}/phase-1-feature-command-results.json`
- Create: `docs/superpowers/evidence/phase-1/${PHASE1_FEATURE_ATTEMPT_ID}/phase-1-feature-review.json`
- Create: `docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-integration-entry.json`
- Create: `docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-exit-baseline.json`
- Create: `docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-command-results.json`
- Create: `docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-handoff.json`
- Create: `docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-exit-report.md`
- Create: `docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-integration-receipt.json`
- Modify: `docs/superpowers/registry/oracle-lab-requirements.json`
- Modify: `docs/superpowers/registry/oracle-lab-claims.json`
- Modify: `docs/superpowers/registry/oracle-lab-current-observations.json`
- Test: `tests/oracle-lab-phase-1-evidence.test.ts`
- Test: `tests/oracle-lab-phase-1-planning.test.ts`

**Interfaces:**
- Consumes: Task 7 `run-all`, both clean feature heads, the exact plan approval/latest execution-context chain head, a closed independent feature review, two proven ordinary merge commits, and four selected requirement rows.
- Produces: immutable attempt-scoped non-authoritative feature-candidate results, a fresh integration entry bound to exact fetched `muqihang/main` heads and merge topology, complete post-integration results, a descendant artifact commit, a one-file receipt commit, and final Phase 2 entry conditions.

- [ ] **Step 1: Update CodeGraph and prove both feature worktrees are clean**

Set `PHASE1_FEATURE_ATTEMPT_ID=feature-0001`; later retries increment the four-digit suffix and never overwrite prior paths. Run `codegraph sync` then `codegraph status` in each implementation worktree. Run `git status --porcelain=v1 --untracked-files=all` in each worktree. Expected: both CodeGraph statuses are up to date and both Git status outputs are empty. Do not run evidence capture from the operator's original dirty Sub2API main worktree.

Issue the next successor with `stage: feature_capture`, pass the successor `pre-commit` gate, commit only that numbered context, and pass the `post-commit` gate. Derive its `artifact_commit` from Git after commit. Immediately before capture, CC HEAD must equal that context-only commit and is frozen as `CC_GATEWAY_TESTED_HEAD`; Sub2API HEAD must equal the successor's Sub2API `authorized_parent_head` and is frozen as `SUB2API_TESTED_HEAD`. Both roots must be clean, and no newer numbered context may exist.

- [ ] **Step 2: Execute and validate one feature-candidate H1 capture**

```bash
npm run oracle:phase1 -- validate-catalog --catalog docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json
npm run oracle:phase1 -- run-all --stage feature-candidate --entry docs/superpowers/evidence/phase-1/phase-1-entry-baseline.json --execution-context ${PHASE1_EXECUTION_CONTEXT_PATH} --catalog docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json --controller-root ${CC_GATEWAY_ROOT} --cc-gateway-root ${CC_GATEWAY_ROOT} --sub2api-root ${SUB2API_ROOT} --sub2api-contract-root ${SUB2API_CONTRACT_ROOT} --baseline-out docs/superpowers/evidence/phase-1/${PHASE1_FEATURE_ATTEMPT_ID}/phase-1-feature-baseline.json --results-out docs/superpowers/evidence/phase-1/${PHASE1_FEATURE_ATTEMPT_ID}/phase-1-feature-command-results.json
npm run oracle:phase1 -- validate-results --stage feature-candidate --entry docs/superpowers/evidence/phase-1/phase-1-entry-baseline.json --execution-context ${PHASE1_EXECUTION_CONTEXT_PATH} --catalog docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json --controller-root ${CC_GATEWAY_ROOT} --cc-gateway-root ${CC_GATEWAY_ROOT} --sub2api-root ${SUB2API_ROOT} --sub2api-contract-root ${SUB2API_CONTRACT_ROOT} --baseline docs/superpowers/evidence/phase-1/${PHASE1_FEATURE_ATTEMPT_ID}/phase-1-feature-baseline.json --results docs/superpowers/evidence/phase-1/${PHASE1_FEATURE_ATTEMPT_ID}/phase-1-feature-command-results.json
```

Before this command, create or refresh `SUB2API_CONTRACT_ROOT` as a separate clean local Git clone of the context chain's immutable Sub2API `baseline_main_head` with local branch name exactly `main`; a newer `observed_remote_main_head` never silently retargets this feature capture. Explicitly do not use `git worktree` because `main` may already be checked out elsewhere. Require the expected origin-URL digest and frozen shared-contract digest, make no edits in it, and finish all clone/fetch operations before entering the network sandbox. Expected: fifteen `pass`, two `expected_fail`, four stable build rows, two isolated full-suite rows, exact ignored-state transition chains, exact parser lifecycles, zero unclassified or duplicate failure events, zero sandbox violations, event and unique counts `61/61` and `51/51`, exact canonical RED leaf inventories, exact RED families `[B4,B5,B6]` and `[TestPhase0B5,TestPhase0B6]`, and a proven loopback-only sandbox. Before the first spawn the adapter requires `context.generated_at <= capture_started_at`; results require `context.generated_at <= captured_at < context.expires_at`, and `captured_before_generated_at` fails `context_not_yet_valid` with zero spawned commands or persisted evidence. The feature baseline/results bind `CC_GATEWAY_TESTED_HEAD` and `SUB2API_TESTED_HEAD` as repository commits and implementation-tree `source_commit` values and bind the exact latest context chain head. They do not claim the future evidence commit that will contain their own bytes. These results authorize review of the feature heads only; schemas forbid using `stage: feature-candidate` to mint a handoff or transition Registry rows.

- [ ] **Step 3: Commit feature-candidate evidence and obtain independent implementation review**

First commit only the captured baseline/results and record that commit plus the unchanged clean Sub2API tested head as `CC_GATEWAY_CANDIDATE_HEAD` and `SUB2API_CANDIDATE_HEAD`:

```bash
git add docs/superpowers/evidence/phase-1/${PHASE1_FEATURE_ATTEMPT_ID}/phase-1-feature-baseline.json docs/superpowers/evidence/phase-1/${PHASE1_FEATURE_ATTEMPT_ID}/phase-1-feature-command-results.json
git commit -m "test(oracle): bind Phase 1 feature candidate results"
```

Before review, prove `CC_GATEWAY_CANDIDATE_HEAD` is the unique one-parent child of `CC_GATEWAY_TESTED_HEAD`, its exact delta is `A` for only the two feature baseline/results paths, and the committed bytes equal the validated pre-commit artifacts. Require `SUB2API_CANDIDATE_HEAD == SUB2API_TESTED_HEAD`. Recompute both candidate implementation trees and require their algorithm, exact exclusion policy/arrays, count, and digest to equal the results-bound tested-tree values while their `source_commit` fields equal the candidate heads. This is the self-reference-safe evidence boundary.

The independent reviewer checks those exact two candidate heads, full goal coverage, the route-by-authority matrix, ordering/races/idempotency/replay, frontend version continuity, origin trust, direct `startProxy` ordering, certificate verification, exact RED evidence, sandbox enforcement, leakage, and scope. Persist the sole authoritative review artifact under `oracle-lab-phase-1-feature-review.schema.json` as `phase-1-feature-review.json`; no optional report is part of this boundary. The JSON binds tested heads, candidate heads, both tested and candidate implementation-tree bindings, exact evidence-commit topology, feature baseline/results, latest context chain head, plan approval, reviewer identity, review scope, decision, and finding counts. Only `approved` with zero Critical/Important is accepted. A later integrated head with a different implementation-tree digest has never been reviewed by this artifact and cannot consume it.

Validate, then commit only the JSON as the direct child of `CC_GATEWAY_CANDIDATE_HEAD`:

```bash
npm run oracle:phase1 -- validate-feature-review --catalog docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json --controller-root ${CC_GATEWAY_ROOT} --sub2api-root ${SUB2API_ROOT} --execution-context ${PHASE1_EXECUTION_CONTEXT_PATH} --plan-review docs/superpowers/evidence/phase-1/phase-1-plan-review.json --feature-baseline docs/superpowers/evidence/phase-1/${PHASE1_FEATURE_ATTEMPT_ID}/phase-1-feature-baseline.json --feature-results docs/superpowers/evidence/phase-1/${PHASE1_FEATURE_ATTEMPT_ID}/phase-1-feature-command-results.json --feature-review docs/superpowers/evidence/phase-1/${PHASE1_FEATURE_ATTEMPT_ID}/phase-1-feature-review.json --reviewed-cc-candidate-head ${CC_GATEWAY_CANDIDATE_HEAD} --reviewed-sub2api-candidate-head ${SUB2API_CANDIDATE_HEAD}
git add docs/superpowers/evidence/phase-1/${PHASE1_FEATURE_ATTEMPT_ID}/phase-1-feature-review.json
git commit -m "docs(oracle): attest Phase 1 feature review"
```

Record this commit as `CC_GATEWAY_REVIEW_ATTESTATION_HEAD` and expose the field name `review_attestation_head`. Its sole parent is `CC_GATEWAY_CANDIDATE_HEAD`, and its exact delta adds only the one review JSON path whose committed bytes equal the validated artifact; no later commit before the merge may change that path. `validatePhase1FeatureReviewAttestation` and `build-integration-entry` independently prove those facts and return `feature_review_attestation_mismatch` for wrong parent, extra delta, byte mismatch, or later mutation before any output write. The review commit does not change implementation paths or retroactively change the reviewed candidate heads. The closed validator rejects unknown flags, a dirty Sub2API root, any extra CC delta, review/candidate/context/result drift, and every decision other than `approved` with zero Critical/Important.

- [ ] **Step 4: Merge both implementation PRs before final evidence**

Push `codex/oracle-phase-1-sub2api` and `codex/oracle-phase-1-cc-gateway`, create reviewable PRs, and merge each with an ordinary merge commit after required checks. Do not squash, rebase, force-push, or commit directly to `main`. Immediately before each merge fetch and record that repository's `PRE_MERGE_MAIN_HEAD`. Record exact `CC_MERGE_COMMIT` and `SUB2API_MERGE_COMMIT` SHAs. Each must have exactly two parents: the first is its recorded pre-merge main; the CC second parent is `CC_GATEWAY_REVIEW_ATTESTATION_HEAD`; the Sub2API second parent is `SUB2API_CANDIDATE_HEAD`. The commit must be an ancestor of the fetched integrated main. Squash, rebase, octopus, wrong-parent, or ancestry-only substitutes fail `merge_commit_parent_mismatch`. A feature-branch handoff is prohibited.

- [ ] **Step 5: Freeze exact integrated mains in new clean worktrees**

Fetch `muqihang/main` in both repositories after both PRs merge. Create these three distinct roots, all initially at the exact fetched integrated commits:

- `CC_GATEWAY_EVIDENCE_ROOT`: a CC worktree on uniquely named draft branch `codex/oracle-phase-1-post-integration-${PHASE1_ATTEMPT_ID}-${PHASE1_DRAFT_RUN_ID}` where run IDs match `run-[0-9]{4}`; this is the controller/output root and the eventual artifact/receipt branch.
- `CC_GATEWAY_INTEGRATION_ROOT`: a separate detached CC worktree at fetched `muqihang/main`; this is the clean tested CC root and is never written by evidence generation.
- `SUB2API_INTEGRATION_ROOT`: a separate detached Sub2API worktree at fetched `muqihang/main`; this is the clean tested Sub2API root and is never written by evidence generation.

Enumerate the full reachable-history receipt chain defined in Task 7, including tombstoned canonical paths, from the freshly fetched integrated CC main. Treat the chain as empty only when no canonical receipt path has ever appeared in that reachable history. If empty, set `PHASE1_ATTEMPT_ID=attempt-0001` and all four `PHASE1_PREVIOUS_ATTEMPT_*` values to literal `none`. Otherwise require every historical receipt to remain present and byte-identical at the tip and the committed IDs to be contiguous from `0001`; set `PHASE1_ATTEMPT_ID` to the next four-digit ID, and set `PHASE1_PREVIOUS_ATTEMPT_ID`, `PHASE1_PREVIOUS_ATTEMPT_RECEIPT`, `PHASE1_PREVIOUS_ATTEMPT_RECEIPT_DIGEST`, and `PHASE1_PREVIOUS_ATTEMPT_RECEIPT_COMMIT` from the validated last receipt. Any deletion/re-add/reset fails before attempt allocation. Set `PHASE1_DRAFT_RUN_ID=run-0001`; a pre-merge restart increments only this run ID because an unmerged draft never consumes a canonical attempt sequence. A successor canonical attempt or restarted draft always uses a new branch/root from the newly frozen mains. Initialize or sync CodeGraph in all three and require current indexes. Before building the integration entry, all three statuses are empty. `CC_GATEWAY_EVIDENCE_ROOT` and `CC_GATEWAY_INTEGRATION_ROOT` must have different canonical realpaths but the same exact integrated CC HEAD and the same recomputed `git_ls_tree_v1_sha256_canonical_json` binding.

Create or refresh a separate clean local Git clone as `SUB2API_CONTRACT_ROOT`, on branch `main` at the exact integrated Sub2API remote-main commit; it must not be a linked worktree or either tested repository root. From `CC_GATEWAY_EVIDENCE_ROOT`, create the untracked attempt-scoped integration entry under its closed schema. It binds: attempt ID; exact remote URLs/refs/commits; controller and tested root identities; the closed clone-kind/origin-URL/root-identity/head/branch/clean-status/contract binding; reviewed candidate and review-attestation heads; closed feature review; exact merge commits and two-parent topology; exact plan/review/latest-context-chain digests; feature results context chain head; unchanged shared contract; sandbox policy; disabled capabilities; and both complete implementation-tree bindings. The builder reselects the latest contiguous context chain head from integrated main and rejects any numbered artifact beyond that selected head. It accepts an expired results-bound feature context only as historical provenance when results prove `context.generated_at <= captured_at < context.expires_at`, the review binds those exact results/heads and implementation trees, and every intervening context through the selected head is a contiguous immutable `feature_capture` renewal with identical authorized feature heads; current integration-entry generation has its own fresh 24-hour window. Generation fails on remote movement, dirty roots, controller delta, stale context selection, changed feature heads or implementation trees, review mismatch, or merge topology mismatch. Immediately before Step 6, controller status must contain exactly that one untracked path while both tested roots remain empty; that path is the current attempt-scoped entry.

Run from `CC_GATEWAY_EVIDENCE_ROOT` with values captured from the reviewed feature PRs and freshly fetched remote configuration:

```bash
npm run oracle:phase1 -- build-integration-entry --catalog docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json --controller-root ${CC_GATEWAY_EVIDENCE_ROOT} --attempt-id ${PHASE1_ATTEMPT_ID} --previous-attempt-id ${PHASE1_PREVIOUS_ATTEMPT_ID} --previous-attempt-receipt ${PHASE1_PREVIOUS_ATTEMPT_RECEIPT} --previous-attempt-receipt-digest ${PHASE1_PREVIOUS_ATTEMPT_RECEIPT_DIGEST} --previous-attempt-receipt-commit ${PHASE1_PREVIOUS_ATTEMPT_RECEIPT_COMMIT} --cc-gateway-root ${CC_GATEWAY_INTEGRATION_ROOT} --sub2api-root ${SUB2API_INTEGRATION_ROOT} --sub2api-contract-root ${SUB2API_CONTRACT_ROOT} --execution-context ${PHASE1_EXECUTION_CONTEXT_PATH} --plan-review docs/superpowers/evidence/phase-1/phase-1-plan-review.json --feature-results docs/superpowers/evidence/phase-1/${PHASE1_FEATURE_ATTEMPT_ID}/phase-1-feature-command-results.json --feature-review docs/superpowers/evidence/phase-1/${PHASE1_FEATURE_ATTEMPT_ID}/phase-1-feature-review.json --reviewed-cc-candidate-head ${CC_GATEWAY_CANDIDATE_HEAD} --reviewed-sub2api-candidate-head ${SUB2API_CANDIDATE_HEAD} --cc-review-attestation-head ${CC_GATEWAY_REVIEW_ATTESTATION_HEAD} --cc-pre-merge-main-head ${CC_PRE_MERGE_MAIN_HEAD} --sub2api-pre-merge-main-head ${SUB2API_PRE_MERGE_MAIN_HEAD} --cc-merge-commit ${CC_MERGE_COMMIT} --sub2api-merge-commit ${SUB2API_MERGE_COMMIT} --cc-remote muqihang --cc-remote-ref refs/remotes/muqihang/main --cc-origin-digest ${CC_GATEWAY_ORIGIN_DIGEST} --sub2api-remote muqihang --sub2api-remote-ref refs/remotes/muqihang/main --sub2api-origin-digest ${SUB2API_ORIGIN_DIGEST} --out docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-integration-entry.json
```

Each `${...}` value is a required nonempty pre-captured scalar, not a default: attempt IDs match `^attempt-[0-9]{4}$`, heads/merge commits are lower-hex commits, and origin digests are SHA-256 of canonical remote URLs. The parser rejects environment fallback for an omitted flag. It validates the all-`none` initial predecessor tuple or the complete successor tuple, enumerates the committed attempt chain, and returns `attempt_chain_invalid` for gap, jump, duplicate, replay, wrong receipt bytes/commit/topology, or partial tuple. It validates merge commits through reviewed Git with exact parent order and returns `merge_commit_parent_mismatch` for any substitute. Expected: exit 0, exactly one attempt-scoped untracked entry path in the controller, no tested-root delta, and a valid closed integration-entry schema.

- [ ] **Step 6: Rerun the complete catalog on the exact integrated main heads**

```bash
npm run oracle:phase1 -- run-all --stage post-integration --integration-entry docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-integration-entry.json --catalog docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json --controller-root ${CC_GATEWAY_EVIDENCE_ROOT} --cc-gateway-root ${CC_GATEWAY_INTEGRATION_ROOT} --sub2api-root ${SUB2API_INTEGRATION_ROOT} --sub2api-contract-root ${SUB2API_CONTRACT_ROOT} --baseline-out docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-exit-baseline.json --results-out docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-command-results.json
npm run oracle:phase1 -- validate-results --stage post-integration --integration-entry docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-integration-entry.json --catalog docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json --controller-root ${CC_GATEWAY_EVIDENCE_ROOT} --cc-gateway-root ${CC_GATEWAY_INTEGRATION_ROOT} --sub2api-root ${SUB2API_INTEGRATION_ROOT} --sub2api-contract-root ${SUB2API_CONTRACT_ROOT} --baseline docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-exit-baseline.json --results docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-command-results.json
```

Run this command from `CC_GATEWAY_EVIDENCE_ROOT`. Expected: the same fifteen `pass` and two exact `expected_fail` results, four stable build rows, two isolated full-suite rows, exact ignored-state transition chains, exact parser lifecycles, zero unclassified or duplicate events, event and unique counts `61/61` and `51/51`, exact canonical RED leaf inventories, zero sandbox violations, repository commits exactly equal the integration entry's two fetched main heads, and no status/HEAD change in either tested root. The adapter re-fetches remote refs before and after the run; any movement invalidates the transaction. The controller after-status contains exactly the three paths in the current attempt namespace: entry, baseline, and results. Validate results before changing governance state.

- [ ] **Step 7: Transition only the four Phase 1 requirement rows**

For `AV-B1-001`, `AV-B2-001`, `AV-B3-001`, and `RA-P0-008`, set reviewed implemented status, exact implementation/test arrays, exact post-integration command IDs/results, the two integrated main heads, and verification timestamp. Leave every other deferred row unchanged.

Add claims only at `local_structural` or `local_observational`. Do not add `upstream_canary_observed` or `provider_internal_confirmed`. `RA-P0-008` becomes locally implemented only when listener, direct-upstream TLS, and sidecar commands are GREEN. Retain `external_network_exposure_policy_enforcement_not_observed` and `real_upstream_certificate_chain_not_observed` as production gaps. Append one `resolved` event for `RA-CURRENT-008` bound to the two boundary tests, sidecar result, result digests, and integrated CC main head; preserve all prior events.

- [ ] **Step 8: Build and validate the deterministic final handoff/report**

```bash
npm run oracle:phase1 -- build-handoff --catalog docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json --controller-root ${CC_GATEWAY_EVIDENCE_ROOT} --cc-gateway-root ${CC_GATEWAY_INTEGRATION_ROOT} --sub2api-root ${SUB2API_INTEGRATION_ROOT} --sub2api-contract-root ${SUB2API_CONTRACT_ROOT} --integration-entry docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-integration-entry.json --baseline docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-exit-baseline.json --results docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-command-results.json --registry docs/superpowers/registry/oracle-lab-requirements.json --claims docs/superpowers/registry/oracle-lab-claims.json --observations docs/superpowers/registry/oracle-lab-current-observations.json --handoff-out docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-handoff.json --report-out docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-exit-report.md
npm run oracle:phase1 -- validate-handoff --catalog docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json --controller-root ${CC_GATEWAY_EVIDENCE_ROOT} --cc-gateway-root ${CC_GATEWAY_INTEGRATION_ROOT} --sub2api-root ${SUB2API_INTEGRATION_ROOT} --sub2api-contract-root ${SUB2API_CONTRACT_ROOT} --integration-entry docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-integration-entry.json --baseline docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-exit-baseline.json --results docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-command-results.json --requirements docs/superpowers/registry/oracle-lab-requirements.json --claims docs/superpowers/registry/oracle-lab-claims.json --observations docs/superpowers/registry/oracle-lab-current-observations.json --handoff docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-handoff.json --report docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-exit-report.md
```

The handoff contains exactly:

```typescript
export const PHASE2_ENTRY_CONDITIONS = [
  'phase_1_integration_receipt_valid',
  'current_remote_mains_match_or_descend_from_receipted_integration_chain',
  'b1_b3_listener_and_upstream_tls_green_on_integrated_heads',
  'b4_b6_expected_red_preserved_for_phase_4',
  'shared_contract_unchanged_or_reviewed_version_bump',
  'production_and_real_canary_disabled',
  'fresh_phase_2_baseline_context_and_detailed_plan',
  'independent_phase_2_plan_approval',
] as const
```

It expires exactly 24 hours after generation for live handoff/receipt construction and binds the attempt ID, exact integrated main heads, merge topology, catalog/integration-entry/result digests, context-chain bindings, parser lifecycles, RED evidence, safe command/failure names, requirement IDs, and repository-relative paths. Receipt construction must occur before handoff expiry and persists `historical_valid_at: {validated_at, source_generated_at, source_expires_at}` with `source_generated_at <= validated_at < source_expires_at`. After the receipt is committed, later validation proves that historical relation and immutable bytes; it does not invalidate a reviewed receipt merely because the wall clock passed the source handoff expiry. The builder and validator both accept `--catalog`, independently rerun catalog and result semantics, and regenerate the Markdown. Validate the pair, planning/evidence/full tests, and build before committing.

- [ ] **Step 9: Commit the exact post-integration artifact set**

Run the scope/leak audits from the prior plan, then commit all final artifacts and governance transitions in one artifact commit:

```bash
git add docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-integration-entry.json docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-exit-baseline.json docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-command-results.json docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-handoff.json docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-exit-report.md docs/superpowers/registry/oracle-lab-requirements.json docs/superpowers/registry/oracle-lab-claims.json docs/superpowers/registry/oracle-lab-current-observations.json
git commit -m "docs(oracle): bind Phase 1 to integrated main heads"
```

Because `CC_GATEWAY_EVIDENCE_ROOT` has received no prior commit, the validator requires this artifact commit's sole parent to be the exact captured CC integrated main head and its delta to contain only the declared Phase 1 evidence/governance paths. Every bound artifact digest must equal `git show <artifact_commit>:<path>`. The detached tested roots are never used for commits and remain clean through receipt generation.

- [ ] **Step 10: Generate a self-reference-safe receipt and commit only it**

At the clean artifact commit, generate the attempt-scoped `phase-1-integration-receipt.json`. It binds the artifact commit, attempt ID, exact integrated mains, reviewed candidate/review-attestation heads, merge commits/topology, latest context chain, catalog/entry/results/handoff/report/registry digests, `historical_valid_at`, RED evidence, sandbox digests, disabled capabilities, and Phase 2 gates. Validate it both before and after commit.

```bash
npm run oracle:phase1 -- build-integration-receipt --catalog docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json --controller-root ${CC_GATEWAY_EVIDENCE_ROOT} --sub2api-root ${SUB2API_INTEGRATION_ROOT} --artifact-commit ${PHASE1_ARTIFACT_COMMIT} --integration-entry docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-integration-entry.json --baseline docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-exit-baseline.json --results docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-command-results.json --handoff docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-handoff.json --report docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-exit-report.md --requirements docs/superpowers/registry/oracle-lab-requirements.json --claims docs/superpowers/registry/oracle-lab-claims.json --observations docs/superpowers/registry/oracle-lab-current-observations.json --receipt-out docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-integration-receipt.json
npm run oracle:phase1 -- validate-integration-receipt --catalog docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json --controller-root ${CC_GATEWAY_EVIDENCE_ROOT} --sub2api-root ${SUB2API_INTEGRATION_ROOT} --artifact-commit ${PHASE1_ARTIFACT_COMMIT} --integration-entry docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-integration-entry.json --baseline docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-exit-baseline.json --results docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-command-results.json --handoff docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-handoff.json --report docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-exit-report.md --requirements docs/superpowers/registry/oracle-lab-requirements.json --claims docs/superpowers/registry/oracle-lab-claims.json --observations docs/superpowers/registry/oracle-lab-current-observations.json --receipt docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-integration-receipt.json
git add docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-integration-receipt.json
git commit -m "docs(oracle): publish Phase 1 integration receipt"
PHASE1_RECEIPT_COMMIT=$(git rev-parse HEAD)
npm run oracle:phase1 -- validate-integration-receipt --catalog docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json --controller-root ${CC_GATEWAY_EVIDENCE_ROOT} --sub2api-root ${SUB2API_INTEGRATION_ROOT} --artifact-commit ${PHASE1_ARTIFACT_COMMIT} --receipt-commit HEAD --integration-entry docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-integration-entry.json --baseline docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-exit-baseline.json --results docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-command-results.json --handoff docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-handoff.json --report docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-exit-report.md --requirements docs/superpowers/registry/oracle-lab-requirements.json --claims docs/superpowers/registry/oracle-lab-claims.json --observations docs/superpowers/registry/oracle-lab-current-observations.json --receipt docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-integration-receipt.json
```

Set `PHASE1_ARTIFACT_COMMIT` from `git rev-parse HEAD` immediately after Step 9 and require it to equal the receipt builder's independently derived clean controller HEAD. Immediately after the receipt commit, set `PHASE1_RECEIPT_COMMIT=$(git rev-parse HEAD)` and use that exact immutable commit in the post-commit validator and Step 12. The pre-commit validator forbids `--receipt-commit` and requires controller status to contain only the untracked receipt. The post-commit validator requires `--receipt-commit HEAD`, proves that commit has the artifact commit as its sole parent, and proves its delta adds exactly one path. This two-commit chain is the only permitted solution to the artifact self-reference problem; the receipt never claims to contain its own commit hash.

- [ ] **Step 11: Independently review and merge the post-integration evidence PR**

The reviewer reruns receipt validation and verifies the integrated-main bindings, attempt predecessor chain, context/review/merge topology, exact artifact/receipt commit deltas, complete command set, sandbox proof, Registry transitions, leak audit, and no-production/no-canary boundary. Require zero Critical/Important findings, then merge the exact `codex/oracle-phase-1-post-integration-${PHASE1_ATTEMPT_ID}-${PHASE1_DRAFT_RUN_ID}` draft through an ordinary PR merge commit.

- [ ] **Step 12: Perform final remote-main verification without minting a false receipt**

Fetch both `muqihang/main` refs again, then create new clean detached `CC_GATEWAY_FINAL_VERIFY_ROOT` and `SUB2API_FINAL_VERIFY_ROOT` worktrees at those exact fetched commits. Their repository `muqihang` remotes must be the exact canonical URLs/digests frozen by this plan; an equivalent mirror is not accepted. The closed final-root preparation profile is exact: initialize/sync CodeGraph in both roots; in the CC final root run `npm ci --ignore-scripts --offline --no-audit --no-fund`; do not run either build; and immediately invoke the verifier without any intervening command. Before verifier entry, CC may contain ignored endpoint roots only at exact `node_modules` and `.codegraph`, Sub2API only at exact `.codegraph`, and both must pass symlink closure; `dist`, backend web output, tsbuildinfo, and every other ignored endpoint fail `final_verify_ignored_profile_invalid`. Run the read-only verifier from the CC final root:

```bash
npm run oracle:phase1 -- verify-final-remote --catalog docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json --cc-gateway-root ${CC_GATEWAY_FINAL_VERIFY_ROOT} --sub2api-root ${SUB2API_FINAL_VERIFY_ROOT} --attempt-id ${PHASE1_ATTEMPT_ID} --receipt docs/superpowers/evidence/phase-1/${PHASE1_ATTEMPT_ID}/phase-1-integration-receipt.json --receipt-commit ${PHASE1_RECEIPT_COMMIT} --cc-remote muqihang --cc-remote-ref refs/remotes/muqihang/main --cc-origin-digest sha256:52de8ee497a784b90b33345865754f3e6b9d5d96eed92549a15a4157cabb568a --sub2api-remote muqihang --sub2api-remote-ref refs/remotes/muqihang/main --sub2api-origin-digest sha256:22c1a9e3cf8e76d2a20bf24a1ff66fa5d7417ba8b8b83a948c8b3ffa5c33a1a9
```

`PHASE1_RECEIPT_COMMIT` is the exact one-file commit recorded in Step 10, not the later PR merge commit. The verifier accepts no environment fallback and writes no file. At process entry it validates the closed final-root ignored profile, records full in-memory before inventories, and repeats both inventories immediately before success output; any invocation-period create/modify/delete/rename/mode/type/symlink change fails `ignored_state_drift`. It does not compare fresh-root `.codegraph` or `node_modules` digests with a path-dependent post-integration root and does not claim evidence about a mutation that occurred before the reviewed preparation/invocation boundary. The immediately preceding `npm ci` plus closed endpoint profile is a preparation prerequisite, not historical receipt evidence. Mutation tests for final remote inject each ignored operation after the before snapshot and require rejection; mutations of committed results/references are separately rejected while revalidating the persisted chain.

The verifier then validates both clean detached roots, exact one-line remote URL digests, names, refs, and fetched HEAD/ref equality. From reachable CC history it revalidates the full immutable receipt chain including tombstones, loads the requested receipt bytes from `PHASE1_RECEIPT_COMMIT`, and revalidates its artifact/receipt topology plus the feature and post-integration ignored-state evidence references, exact 17-result chains, catalog/result/handoff bindings from committed Git bytes. If a later valid receipt exists, the verifier selects that unique latest receipt and commit as the effective authority, fully validates its predecessor chain and committed bytes, and then runs every URL, ancestry, tree, and changed-path check below against that later authority before it may return `decision: superseded`; superseded is never an early bypass. It requires each remote main to equal or descend from the effective receipt's corresponding integrated head and the CC remote main additionally to descend from the effective receipt commit. It recomputes `git_ls_tree_v1_sha256_canonical_json` at each current remote head and compares its exact policy/arrays, count, and digest with the effective receipt. A descendant is accepted only when all changed CC paths are under the exact Phase 1 evidence prefix or are one of the three exact governance paths, Sub2API has no changed tracked path, and both recomputed implementation-tree digests remain exact. Success is `decision: ready` when the requested receipt remains latest or `decision: superseded` only after the later effective receipt passes the same checks. Every other tracked change, including source, config, tests, tools, schemas, plans, and nonexcluded documentation, is implementation drift.

On success stdout is exactly one canonical JSON object containing `schema_version`, `verification_kind: phase_1_final_remote`, `verified_at`, `decision: ready|superseded`, `attempt_id`, receipt path/digest/commit, both observed remote heads and URL digests, both implementation-tree bindings, both final-root before/after ignored-state summaries, and the latest receipt-chain head; it contains no absolute path. Remote URL/name/ref mismatch returns `context_remote_origin_drift`; rewind/non-descendant returns `context_remote_rewind`; missing/deleted/re-added/reset receipt history or receipt-commit ancestry failure returns `attempt_chain_invalid`; tree policy drift returns `implementation_tree_policy_invalid`; unexpected initial ignored endpoints return `final_verify_ignored_profile_invalid`; invocation-period ignored drift returns `ignored_state_drift`; any nonexcluded tracked change returns `phase1_implementation_drift`; dirty/detached-head mismatch returns `dirty_repository` or `context_head_mismatch`. All failures exit nonzero before success output. The Phase 2 preflight repeats the closed preparation profile and this exact command. Do not mint a self-invalidating successor receipt merely to record an allowed evidence/governance descendant.

Step 12 uses closed recovery classes and allocates no attempt until its class explicitly permits one:

- `dirty_repository` or `context_head_mismatch`: abandon that verification root, create a new clean detached root at the already fetched ref, and rerun the same command. Do not clean/reset the failed root and do not allocate an attempt.
- `context_remote_origin_drift`: restore the exact configured `muqihang` URL, fetch again, recreate both clean final roots, and rerun. Remote configuration repair alone never allocates an attempt.
- `context_remote_rewind` or a non-descendant remote: no successor attempt is legal. Restore both remote lineages through reviewed non-force reconciliation commits that descend from the effective receipted integrated heads and, for CC, the effective receipt commit; then revise the plan and repeat Mandatory Preflight. If ancestry cannot be restored, Phase 1 remains blocked.
- `attempt_chain_invalid` caused by receipt deletion, re-addition, replacement, reset, gap, or broken receipt topology: later reconciliation cannot erase the bad reachable history, so the current chain remains blocked. Recovery requires an explicit reviewed governance/ADR decision and a revised versioned receipt-chain namespace; no current-chain attempt or old receipt may be reused.
- `implementation_tree_policy_invalid` or `phase1_implementation_drift`: the old feature review is invalid. Stop this plan, preserve prior evidence, revise and merge an authoritative plan, repeat Mandatory Preflight on the new heads, and obtain fresh capture plus independent implementation review before any new integration entry. The revised plan must explicitly define its new branch/merge topology and, for policy changes, the new closed policy version.
- Only an evidence-capture or packaging retry whose remote identity/ancestry, receipt history, implementation policy, and implementation-tree bindings are all unchanged may preserve the prior valid receipt, select the next contiguous canonical `PHASE1_ATTEMPT_ID`, bind its exact predecessor tuple, and rerun Steps 5-12 in a new immutable namespace; a pre-merge retry increments only `PHASE1_DRAFT_RUN_ID`.

Tests cover exact-exclusion descendants (accepted), implementation descendants (`phase1_implementation_drift` and mandatory re-review), rewind/non-ancestor movement (no attempt allocation), stale replay, remote URL substitution, and both pre/post-merge evidence-only retry branches. No path may reuse an old feature review after implementation-tree drift, and no path may allocate an attempt before remote ancestry is restored. This committed-attempt/draft-run split prevents exclusive-write, receipt-predecessor, review-provenance, and sole-parent deadlocks.

## Final Verification Matrix

| Gate | Required result |
| --- | --- |
| B1 arbitrary/wrong/expired/replay/cross-session/proxy-change corpus | GREEN |
| B1 consumed-proof replay classification | same owner returns `FORMAL_POOL_BROWSER_PROOF_REJECTED` for old/current version; cross-owner remains common 403; nonmatching stale proof remains 409 |
| B1 concurrent public verifier reservation | one proxy observer call; enumeration-resistant duplicate response |
| B2 exact 15-route × complete caller/session matrix | GREEN; no route/dimension sampling |
| B2 system-admin/ordinary/would-be group-admin/would-be tenant-admin/service/revoked/expired cases | only an active, nonexpired, nonrevoked system-admin human JWT is allowed; exact common 401/403 outcomes for every denial |
| B2 admin compliance ordering | JWT -> system-admin principal -> compliance -> handler; unacknowledged admin 423, ordinary JWT 403 before compliance |
| B2 owner + wrong-state + stale-version combined ordering | common 403; zero dependency calls |
| B2 concurrent status/role/token-version change | common 401/403 before reservation/dependency |
| Duplicate OAuth callback and concurrent promote | idempotent pending/completed result; one dependency call |
| B2 concurrent same-version side-effect reservation | one dependency call; second request 409 before side effect |
| Session creation idempotency reservation | one proxy creation call per owner/key/request fingerprint |
| Mutation response version continuity | acceptance/healthcheck next action uses latest version |
| B3 Host/forwarded-header mutation corpus | GREEN |
| Listener omitted-host observed bind | `127.0.0.1` |
| Remote-listen prerequisite and approved-policy mutation corpus | GREEN fail-closed through direct `startProxy`; zero TLS-read/server-create/listen effects |
| Direct upstream HTTPS/system-trust/unsafe-env corpus | GREEN fail-closed; `rejectUnauthorized: true` |
| Sidecar production TLS config | `InsecureSkipVerify == false`; unsafe trust env rejected before listen |
| Execution authorization | schema-v2 contiguous immutable context chain; unique latest stage head; exact plan/review/live-contract bindings; zero Critical/Important; latest lease unexpired at task start or feature capture |
| Sub2API full Go regression | GREEN |
| Frontend focused tests, typecheck, build | GREEN |
| CC Gateway full tests and build | GREEN |
| Joint local chain | GREEN |
| OS network boundary | reviewed loopback-only sandbox and canaries; proxy environment alone is insufficient |
| CC B4-B6 and sidecar B5-B6 | machine-readable complete lifecycles; sorted event multiset and unique counts `61/61`, `51/51`; exact canonical unique arrays/families; missing, extra same-prefix, duplicate event, malformed/truncated lifecycle, count, or persisted-order drift is unexpected |
| Feature review and merge authority | closed review JSON binds exact candidate heads/results/context; ordinary merge commit two-parent topology proven |
| Post-integration authority | attempt-scoped final results bind exact fetched `muqihang/main` heads after both implementation PRs merge |
| Receipt chain | artifact commit exact delta plus one-path receipt child; `historical_valid_at` proves source freshness at receipt construction; final CC remote main descends receipt commit |
| Shared contract digest | unchanged |
| Production and real canary | disabled |

## Rollback Boundaries

- Sub2API rollback is the ordered revert of Tasks 5, 4, 3, 2, and 1. Do not partially retain the frontend `If-Match` contract after reverting backend version enforcement.
- CC Gateway deployment-boundary rollback is one Task 6 commit, but rolling it back reopens listener and upstream certificate slices of `RA-P0-008` and invalidates the Phase 1 handoff.
- H1 evidence/registry rollback is the Task 8 receipt commit, Task 8 artifact commit, feature-candidate evidence commit, then Task 7. Reverting evidence never claims the implementation itself was reverted.
- Any rollback marks the affected requirement `changed` or `deferred` in a new registry/observation event; prior evidence is retained and never rewritten.

## Self-Review Checklist

- [ ] Every Phase 1 requirement maps to at least one implementation task and one exit command.
- [ ] No task or feature capture starts without the unique latest contiguous execution-context chain head at the required stage; expired predecessors remain immutable history, while an expired latest lease blocks the next boundary.
- [ ] The guard resolves once before compliance; `authorizeCreate` revalidates before group lookup and again immediately before provisional CAS, while `authorizeSession`, `authorizeAccount`, and `authorizeBrowserEgressOwner` revalidate once after static owner checks and immediately before version/state/CAS work. `FormalPoolOnboardingHandler` business code stores or calls neither authority interface.
- [ ] Every external-effect mutation reserves its version before the first dependency call and returns the final version.
- [ ] Every one of the 15 non-public routes executes every caller/session matrix row: active system-admin JWT allowed; ordinary and would-be group/tenant administrator JWT fixtures denied 403; Admin API Key and revoked/expired/inactive JWTs denied 401; concurrent status/role/token-version changes denied before dependency work.
- [ ] OAuth callback and promote duplicates are idempotent by safe operation key/fingerprint and invoke dependencies once.
- [ ] Session creation reserves a provisional record before proxy creation, and public egress verification reserves before probing the proxy.
- [ ] `AttestBrowserEgress` checks owner before exact consumed-proof replay, checks version/state after that replay classification only, and preserves 403/409 for cross-owner/nonmatching cases.
- [ ] `RA-P0-008` closure includes approved exposure policy and both direct/sidecar certificate verification without claiming production observation.
- [ ] Listener/upstream negative integration calls `startProxy` directly and proves both resolvers precede TLS reads, server creation, and listen through zero observed startup effects.
- [ ] Every H1 subprocess is OS-sandboxed to loopback after passing allow/deny canaries; proxy variables alone never authorize capture.
- [ ] Every Phase 1 RED result binds the command-specific complete parser lifecycle, deterministic sorted leaf-event multiset/count, canonical unique array/count, and derived family set; nonzero, missing, added same-prefix, duplicate event, malformed/truncated lifecycle, count drift, or persisted-order drift never yields `expected_fail`, while raw event permutations canonicalize to byte-identical results.
- [ ] Integration-entry, handoff/report, and pre/post-commit receipt builders and validators each rerun catalog/results semantics and reject every rehashed RED parser/lifecycle/event/name/count/family mutation.
- [ ] B4-B6, Phase 2 manifest authority, reverse/oracle capture, profile synthesis, real canary, and production deployment remain out of scope.
- [ ] All named types and function signatures are consistent between backend, handler, frontend, tests, and H1 catalog.
- [ ] No placeholder language or unspecified test command remains.
- [ ] Feature review is a closed JSON receipt generated after the candidate-results commit, and the review-attestation commit changes only review artifacts.
- [ ] Both implementation PRs merge before final capture; each exact merge commit proves first/second-parent topology rather than ancestry alone.
- [ ] Post-integration keeps the attempt controller/evidence branch distinct from clean detached CC/Sub2API tested roots, allows only the attempt-scoped integration entry before capture, and preserves the exact integrated CC main as the artifact commit parent.
- [ ] Handoff freshness is live during receipt construction and historical afterward; retry increments `PHASE1_ATTEMPT_ID` and never overwrites a tracked artifact path.
- [ ] Every Wire provider/signature change regenerates and commits deterministic `backend/cmd/server/wire_gen.go`, and `go test ./cmd/server` passes.
