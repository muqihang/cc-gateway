# Claude Code 2.1.207 Phase 1 Control-Plane Boundary Repairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close B1-B3 and the complete local Phase 1 `RA-P0-008` deployment boundary with server-side authority, deterministic failures, always-on H1 fixtures, and no expansion into Phase 2 contracts or Phase 4 runtime controls.

**Architecture:** Sub2API remains the durable authority. Its admin handler resolves a principal from server-side user state, injects a typed request authority into the service context, and every onboarding mutation checks owner dimensions plus an expected version. Mutations with external effects acquire a CAS-backed single-operation reservation before the first dependency call, then finalize from that reservation without retrying unknown outcomes. Browser egress uses the existing public nonce/IP/proxy verifier, followed by a single-use server proof finalization; absolute browser URLs come only from configured public origin. CC Gateway resolves its deployment boundary before creating a socket: omitted host becomes `127.0.0.1`, non-loopback binds require an explicit capability, inbound TLS, strong authentication, and a code-approved exposure-policy reference, while real upstream modes require HTTPS, system trust, explicit certificate verification, and rejection of unsafe trust-environment overrides. The sidecar keeps `InsecureSkipVerify` confined to explicit loopback test overrides and proves production verification structurally.

**Tech Stack:** Go 1.26, Gin, Testify, TypeScript, Node.js 24, Vue 3, Vitest, Node `http`/`https`/`net`, Ajv 2020, CodeGraph 1.1.6, existing Oracle Lab H0 command/result schemas.

## Global Constraints

- Governing precedence is exact: `review_amendments > hardening_amendments > adversarial_validation_v2 > oracle_lab_design`.
- Phase 1 owns exactly `AV-B1-001`, `AV-B2-001`, `AV-B3-001`, and the full local-structural closure of `RA-P0-008` (`WP-R8:phase_1_loopback_remote_tls_guard`), including upstream certificate verification. This does not create remote-deployment or production authority.
- Phase 1 must not change the shared contract at `backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json` (`sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1`).
- B4-B6 remain expected RED and owned by later phases. The CC and sidecar RED commands must still exit nonzero with the frozen B4-B6 failure families.
- `real_upstream_access`, `real_credentials`, `profile_promotion`, `production_deployment`, `real_canary`, `unrestricted_capture`, and `external_network_requests` remain disabled.
- Tests use loopback, `httptest`, fake resolvers, and mock upstreams only. No command in this plan may contact a real provider or public host.
- Authorization denials occur before state/version/dependency evaluation and use one stable 401 class plus one stable 403 class, without revealing which owner dimension mismatched.
- Missing or malformed `If-Match` on an onboarding mutation returns `428 FORMAL_POOL_ONBOARDING_VERSION_REQUIRED`; a stale version reuses the existing `409 FORMAL_POOL_ONBOARDING_VERSION_CONFLICT`.
- `AttestBrowserEgress` is the sole ordering exception after authentication and owner authorization. Its exact order is: `context -> record -> owner -> consumed-proof replay -> expected-version -> allowed-state -> remaining-proof-validation -> CAS`. An exact replay of the persisted consumed-proof safe digest returns `FORMAL_POOL_BROWSER_PROOF_REJECTED` with either the old or current version; cross-owner requests still return the common 403 first, and nonmatching proofs do not bypass version/state checks.
- Any mutation that can call OAuth, account persistence, refresh, CC Gateway, healthcheck, cache, or scheduler dependencies must first acquire a CAS reservation. A concurrent request with the same version fails before a second dependency call; an ambiguous external outcome becomes `operation_outcome_unknown` and is never automatically retried.
- Public browser-check responses remain enumeration-resistant and do not distinguish unknown, expired, replayed, mismatched, or cross-session nonces in their response body.
- Listener and upstream negative integration must invoke `startProxy` directly and observe zero TLS-read, server-create, and listen effects; calling a pure resolver before `startProxy` is not startup-order evidence.
- Every non-public onboarding route is exercised against the complete executable caller/session matrix from hardening Section 8.3. Coverage is route-by-dimension, not one route per dimension; revoked/expired sessions, ordinary users, group and tenant administrators, service callers, stale tabs, concurrent role changes, and duplicated callbacks are explicit cases.
- Phase 1 RED evidence is accepted only when every failing leaf name matches the command-specific frozen allowlist and its safe observed failure-family set exactly equals the catalog set. A nonzero exit, an extra unrelated failure, an unparsed failing leaf, or a forged persisted family field is always `unexpected_fail`.
- Every H1 command runs inside a reviewed OS-enforced loopback-only network sandbox. Proxy variables are defense in depth, not the sandbox. Missing enforcement, a failed public-socket denial canary, or any observed non-loopback DNS/socket violation fails before evidence is written.
- The final Phase 1 handoff is never minted from feature branches. Both implementation PRs must first merge; a clean post-integration worktree then freezes exact `muqihang/main` heads, reruns the complete catalog, and emits an artifact-commit plus one-file receipt-commit chain bound to those integrated heads.
- Never commit changes from the operator-owned `backend/internal/service/openai_compact_sse_keepalive_test.go` working copy. Implementation uses a clean Sub2API worktree from `muqihang/main`.
- Before each task, run `codegraph status`; if stale, run `codegraph sync`. Use CodeGraph before locating or reading code.
- The planning entry/context expires at `2026-07-16T08:56:22Z` and is planning provenance only. Before any implementation edit, create and validate a fresh `phase-1-execution-context.json` against `oracle-lab-phase-1-execution-context.schema.json`; it must bind the exact merged plan digest/commit and an independent approval receipt with zero Critical/Important findings. Refresh it whenever its 24-hour window expires.
- Each repository uses its own branch and worktree: `codex/oracle-phase-1-sub2api` and `codex/oracle-phase-1-cc-gateway`. Do not mix commits across repositories.

---

## File Map

### Sub2API

- Create `backend/internal/service/formal_pool_onboarding_authorization.go`: typed principal/request authority, owner comparison, state/version ordering, CAS operation reservations, and stable errors.
- Create `backend/internal/service/formal_pool_onboarding_authorization_test.go`: authority ordering and version unit tests.
- Create `backend/internal/handler/admin/formal_pool_onboarding_principal.go`: server-side principal resolver and `If-Match` parser.
- Modify `backend/internal/service/formal_pool_onboarding_store.go`: owner envelope, proof lifecycle, account lookup, active-operation reservation, and CAS-only mutations.
- Modify `backend/internal/service/formal_pool_onboarding_service.go`: authority enforcement, response version, B1 two-step verification/finalization.
- Modify `backend/internal/handler/admin/formal_pool_onboarding_handler.go`: inject authority for every admin route and stop request-derived origin construction.
- Modify `backend/internal/handler/wire.go`: inject the production principal resolver.
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

- Consume `docs/superpowers/schemas/oracle-lab-phase-1-execution-context.schema.json` and `oracle-lab-phase-1-plan-review.schema.json`, which are delivered with this reviewed plan.
- Create `docs/superpowers/evidence/phase-1/phase-1-plan-review.json` and `phase-1-execution-context.json` before implementation; they are authorization inputs, not implementation evidence.
- Create `docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json`: exact GREEN and preserved-RED commands.
- Create `docs/superpowers/schemas/oracle-lab-phase-1-command-catalog.schema.json`, `oracle-lab-phase-1-exit.schema.json`, `oracle-lab-phase-1-results.schema.json`, `oracle-lab-phase-1-handoff.schema.json`, `oracle-lab-phase-1-integration-entry.schema.json`, and `oracle-lab-phase-1-integration-receipt.schema.json`: closed Phase 1 evidence contracts.
- Create `tools/oracle-lab/phase-1-evidence.ts`: a small Phase 1 adapter over the reviewed `runBoundedProcess`, hermetic environment, safe artifact writer, and digest helpers already delivered by H0/P0.1.
- Create `tools/oracle-lab/phase-1-loopback-sandbox.ts`: fail-closed OS sandbox selection, loopback/public-socket canaries, wrapped argv, policy/binary digests, and violation classification.
- Create `tests/oracle-lab-phase-1-evidence.test.ts`: schema, binding, dirty-tree, unexpected-result, unsafe-output, ancestry, and handoff tests.
- Modify `package.json`: add only `oracle:phase1` for the new adapter; do not alter Phase 0/P0.1 scripts.
- Create feature-candidate evidence first, then `docs/superpowers/evidence/phase-1/phase-1-integration-entry.json`, `phase-1-command-results.json`, `phase-1-exit-baseline.json`, `phase-1-handoff.json`, `phase-1-exit-report.md`, and `phase-1-integration-receipt.json` only through Task 8's post-merge chain.
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

Fetch `muqihang/main` in both repositories without rebasing or rewriting history. Create the exact branches named in Global Constraints. Run `codegraph sync` and `codegraph status` in both worktrees. Record clean baseline main heads; if either local main differs from `muqihang/main`, stop and reconcile through a reviewed merge before continuing.

- [ ] **Step 2: Independently review the exact merged plan bytes**

The reviewer must inspect the merged plan commit, current authority documents, and current code anchors. Persist a closed JSON receipt at `phase-1-plan-review.json` with the exact plan path, reviewed commit/digest, reviewer ID, review round, decision, finding counts, and exact six-item review scope from its schema. `approved` is valid only when Critical and Important counts are zero. A review of an earlier commit or different plan digest is invalid.

- [ ] **Step 3: Build the fresh execution context**

Create `phase-1-execution-context.json` with a window greater than zero and no more than 24 hours. Bind the exact plan path/digest/reviewed commit, exact planning entry/context bytes as provenance, the review artifact digest, both current main heads and implementation branch names, authority precedence bytes, unchanged shared-contract digest, selected requirement IDs, disabled capabilities, and all seven authorization conditions from the closed schema. These fields are claims until Step 4 verifies them against live reviewed-Git observations.

- [ ] **Step 4: Validate the authorization artifact before implementation**

Run: `PHASE1_REQUIRE_EXECUTION_CONTEXT=1 SUB2API_ROOT=${SUB2API_ROOT} npm exec tsx tests/oracle-lab-phase-1-planning.test.ts`

Expected: PASS. Every Git query uses `runReviewedGit`, which selects a reviewed absolute Git executable, supplies the hermetic Git environment, and calls `assertNoGitReplacementRefs`; raw `git`/`execFileSync` is forbidden in this gate. The semantic check parses the review receipt, compares every duplicated approval field, hashes `git show <reviewed_commit>:<plan.path>`, and requires those committed bytes, current plan bytes, context digest, and review receipt digest to agree. It also proves the exact authority path order, exact planning-provenance paths, both baseline heads equal freshly fetched `muqihang/main`, current branches are exactly `codex/oracle-phase-1-cc-gateway` and `codex/oracle-phase-1-sub2api`, CC status contains only the two untracked preflight artifacts, Sub2API status is empty, the context is unexpired, and Critical/Important counts are zero. Any mismatch leaves implementation blocked.

- [ ] **Step 5: Commit authorization provenance as the first CC Gateway Phase 1 commit**

```bash
git add docs/superpowers/evidence/phase-1/phase-1-plan-review.json docs/superpowers/evidence/phase-1/phase-1-execution-context.json
git commit -m "docs(oracle): authorize exact Phase 1 plan bytes"
```

No Sub2API or runtime source file may change before this commit. If the execution context expires during implementation, stop before the next edit/capture, repeat Steps 1-4 against current main/authority state, and commit a successor context; do not silently extend timestamps.

### Task 1: Sub2API Authority Envelope and Optimistic Version Foundation

**Files:**
- Create: `backend/internal/service/formal_pool_onboarding_authorization.go`
- Create: `backend/internal/service/formal_pool_onboarding_authorization_test.go`
- Modify: `backend/internal/service/formal_pool_onboarding_store.go:34-168`
- Modify: `backend/internal/service/formal_pool_onboarding_service.go:62-149,297-415,1661-1702`
- Modify: `backend/internal/service/formal_pool_onboarding_flow_test.go`
- Test: `backend/internal/service/formal_pool_onboarding_authorization_test.go`
- Test: `backend/internal/service/formal_pool_onboarding_store_test.go`

**Interfaces:**
- Produces: `FormalPoolOnboardingPrincipal`, `FormalPoolRequestAuthority`, `WithFormalPoolRequestAuthority`, `FormalPoolRequestAuthorityFromContext`, `authorizeCreate`, `authorizeSession`, and `authorizeAccount`.
- Produces: `FormalPoolOnboardingSession.Version int64`, owner fields, `FormalPoolOperationReservation`, `beginReservedMutation`, `finishReservedMutation`, and `failReservedMutation`.
- Consumes: existing `FormalPoolOnboardingStore.get`, `casUpdate`, session `Version`, `GroupID`, and status constants.

- [ ] **Step 1: Write focused RED tests for authority ordering and versions**

```go
func TestFormalPoolAuthorizeSessionOrdersOwnerBeforeVersionAndState(t *testing.T) {
    svc, owner, session := newAuthorizedOnboardingFixture(t)
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
}

func TestFormalPoolStartSessionRequiresAdminTenantAndAllowedGroup(t *testing.T) {
    svc := NewFormalPoolOnboardingService(FormalPoolOnboardingDeps{Proxy: &formalProxyFake{}})
    _, err := svc.StartSession(context.Background(), FormalPoolOnboardingStartRequest{GroupID: 101})
    require.ErrorIs(t, err, ErrFormalPoolOnboardingAuthenticationRequired)
}

func newAuthorizedOnboardingFixture(t *testing.T) (*FormalPoolOnboardingService, FormalPoolOnboardingPrincipal, *FormalPoolOnboardingSession) {
    t.Helper()
    svc := NewFormalPoolOnboardingService(FormalPoolOnboardingDeps{Proxy: &formalProxyFake{}})
    owner := FormalPoolOnboardingPrincipal{
        SubjectID: 1001, AdministratorID: 1001, TenantID: "tenant-one",
        AllowedGroupIDs: []int64{101}, CreatorID: 1001, Role: RoleAdmin,
        CallerKind: CallerKindHuman, AuthorityRevision: 1, Active: true,
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
    return svc, owner, session
}
```

- [ ] **Step 2: Run the focused tests and confirm the authority API is absent**

Run: `cd backend && go test ./internal/service -run '^TestFormalPoolAuthorize|^TestFormalPoolStartSessionRequiresAdminTenant' -count=1`

Expected: FAIL to compile because `FormalPoolRequestAuthority` and the stable errors do not exist.

- [ ] **Step 3: Add the typed authority model and stable errors**

```go
type FormalPoolOnboardingPrincipal struct {
    SubjectID       int64
    AdministratorID int64
    TenantID        string
    AllowedGroupIDs []int64
    CreatorID       int64
    Role            string
    CallerKind      string
    AuthorityRevision int64
    Active          bool
}

type FormalPoolRequestAuthority struct {
    Principal       FormalPoolOnboardingPrincipal
    ExpectedVersion *int64
    IdempotencyKey  string
}

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

Implement exact validation order in `authorizeSession`: context presence; active human-caller shape; record lookup; subject/admin/tenant/group/creator/role comparison; authority-revision revalidation when the Task 2 policy dependency is installed; expected-version requirement for mutations; expected-version equality; then allowed-state membership. Revoked/expired sessions return the common 401, while caller/owner/policy mismatches return the common 403. This remains the generic path for every operation except Task 3 `AttestBrowserEgress`, which must split owner authorization from version/state evaluation only to perform the narrow consumed-proof replay check defined in Global Constraints.

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

`StartSession` requires `ExpectedVersion == 0`, a valid `Idempotency-Key`, active human administrator authority, non-empty tenant, positive subject/admin/creator IDs, and requested `GroupID` granted by the trusted policy resolver. It validates and fingerprints the request, calls `beginCreateReservation`, and only then calls proxy resolution once. Success finalizes the provisional record at version `2`; ambiguous proxy creation finalizes `operation_outcome_unknown` and never auto-retries. `GetSession` authorizes the owner but does not require `If-Match`. `AbortSession` requires an expected version and uses one `casUpdate` because it has no external effect. Add `snapshotByAccountID` and `snapshotByCreateKey` with the same copy/session-expiry behavior as `snapshotByNonce`.

Add a concurrent creation test with a blocking proxy fake: two requests sharing owner, request, `If-Match: "0"`, and idempotency key produce exactly one `ResolveOrCreateProxy` call; the second receives 409 while the first is active, and a post-success replay returns the same session/version without another dependency call. A changed body under the same key is 409 before proxy invocation.

- [ ] **Step 6: Migrate the direct flow harness and run authority/store/service regression tests**

Add one `authorizedFlowContext(t, sessionVersion)` helper to `formal_pool_onboarding_flow_test.go`. Migrate every direct `StartSession` and mutation call in that file to an owner-bound authority plus the current response version; do not weaken production authorization for test compatibility. Add this file to the focused command so Task 1 cannot commit while the direct flow harness still uses the old API.

Run: `cd backend && go test ./internal/service -run 'FormalPoolOnboarding(Store|Authorize|Reservation|StartSession|GetSession|Abort|Flow)' -count=1`

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
- Modify: `backend/internal/config/config.go:169-181`
- Modify: `backend/internal/service/formal_pool_onboarding_authorization.go`
- Modify: `backend/internal/service/formal_pool_onboarding_service.go:626-1659`
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
- Produces: `FormalPoolAuthSessionAuthority`, `FormalPoolAuthorizationPolicy`, the per-operation authority revalidator, `FormalPoolOnboardingPrincipalResolver.Resolve(*gin.Context)`, `WithFormalPoolOnboardingPrincipalResolver`, and `parseFormalPoolIfMatch`.
- Produces: every mutating frontend API function accepts the current `FormalPoolSession` and sends its version.

- [ ] **Step 1: Make the existing B2 RED corpus always-on and complete**

Remove only `//go:build phase0red` from `formal_pool_onboarding_phase0_red_test.go`; keep the filename for history. Replace test-only `X-Phase0-*` authority headers with a fake `FormalPoolOnboardingPrincipalResolver` whose current principal is set by the fixture before each request.

Freeze `formalPoolAdminOperationCases` as these exact 15 existing non-public object operations: `GetSession`, `TestProxy`, `BrowserEgressAttestation`, `GenerateOAuth`, `ExchangeOAuth`, `ExchangeSetupToken`, `Acceptance`, `RefreshOnly`, `RuntimeRegistration`, `SessionHealthcheck`, `AccountHealthcheck`, `StartWarming`, `Abort`, `Activation`, and `Promotion`. Each operation must execute every row in `formalPoolAuthorityCases`; sampling six dimensions on `GetSession` is forbidden. `CreateSession` is a separately frozen sixteenth route and executes the same authentication/caller/session/role/tenant/group matrix, with creator/object-owner and stale-tab cases marked structurally not applicable rather than silently omitted:

| Caller/session case | Required result |
| --- | --- |
| unauthenticated | common 401 |
| active ordinary user, creator and non-creator | common 403 |
| active group administrator, same tenant and granted group | allowed to reach state/version evaluation |
| group administrator, ungranted or cross-group | common 403 |
| active tenant administrator, same tenant | allowed to reach state/version evaluation |
| tenant administrator, cross-tenant | common 403 |
| revoked session; expired session | common 401 before record/state/version |
| stale browser tab | 409 only after authority succeeds |
| service-to-service caller | common 403; Phase 1 admin routes are human-only |
| concurrent role/policy revision changed after initial resolve | common 403 before reservation or dependency |
| duplicated OAuth callback and concurrent promote with the same operation key/fingerprint | idempotent pending/completed result; one dependency invocation |

For every mutation family, add a combined negative in which owner mismatch, stale version, and wrong state are simultaneously true. It must return the common 403 and leave its proxy/OAuth/account/healthcheck/cache/scheduler dependency counter at zero. The table also asserts the exact route inventory; adding a route without a matrix row fails the test.

- [ ] **Step 2: Run B2 tests and capture the expected failures**

Run: `cd backend && go test ./internal/server/routes -run 'TestFormalPoolOnboardingAuthorization' -count=1`

Expected: FAIL because the handler neither resolves the principal nor parses `If-Match`.

- [ ] **Step 3: Add the production principal resolver**

```go
type FormalPoolOnboardingPrincipalResolver interface {
    Resolve(c *gin.Context) (service.FormalPoolOnboardingPrincipal, error)
}

type formalPoolOnboardingPrincipalResolver struct {
    sessions service.FormalPoolAuthSessionAuthority
    policy   service.FormalPoolAuthorizationPolicy
    tenantID string
    now      func() time.Time
}

func (r *formalPoolOnboardingPrincipalResolver) Resolve(c *gin.Context) (service.FormalPoolOnboardingPrincipal, error) {
    subject, ok := middleware.GetAuthSubjectFromContext(c)
    if !ok || subject.UserID <= 0 { return service.FormalPoolOnboardingPrincipal{}, service.ErrFormalPoolOnboardingAuthenticationRequired }
    session, err := r.sessions.ResolveActive(c.Request.Context(), subject)
    if err != nil || session.Revoked || !session.ExpiresAt.After(r.now()) { return service.FormalPoolOnboardingPrincipal{}, service.ErrFormalPoolOnboardingAuthenticationRequired }
    grant, err := r.policy.ResolveOnboardingGrant(c.Request.Context(), session.UserID, r.tenantID)
    if err != nil || !grant.Active { return service.FormalPoolOnboardingPrincipal{}, service.ErrFormalPoolOnboardingForbidden }
    return service.FormalPoolOnboardingPrincipal{
        SubjectID: session.UserID, AdministratorID: grant.AdministratorID, TenantID: grant.TenantID,
        AllowedGroupIDs: append([]int64(nil), grant.GroupIDs...), CreatorID: session.UserID,
        Role: grant.Role, CallerKind: grant.CallerKind, AuthorityRevision: grant.Revision, Active: grant.Active,
    }, nil
}
```

`FormalPoolAuthSessionAuthority` revalidates the server-side session record rather than trusting only middleware presence. `FormalPoolAuthorizationPolicy` resolves group-administrator or tenant-administrator grants from the trusted group/tenant policy source; `User.AllowedGroups` is not itself an administrator grant. Ordinary users and service callers are denied. Add `AuthorityTenantID string \`mapstructure:"authority_tenant_id"\`` to `FormalPoolRuntimeConfig`. Empty tenant ID makes the production resolver fail closed; it is never accepted from a request header, query, or body.

Wire it with an exact provider: `ProvideFormalPoolOnboardingPrincipalResolver(sessionAuthority service.FormalPoolAuthSessionAuthority, policy service.FormalPoolAuthorizationPolicy, cfg *config.Config) admin.FormalPoolOnboardingPrincipalResolver`, then pass that resolver into `ProvideFormalPoolOnboardingHandler` via `admin.WithFormalPoolOnboardingPrincipalResolver(resolver)`. Production sets `now: time.Now`; tests inject a fixed clock.

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

- [ ] **Step 5: Inject authority into all admin handler calls**

Add one handler helper that resolves the principal, parses `If-Match`, and returns `service.WithFormalPoolRequestAuthority(c.Request.Context(), ...)`. Apply it to these exact operations: `CreateSession`, `GetSession`, `TestProxy`, `BrowserEgressAttestation`, `GenerateAuthURL`, `ExchangeCodeAndCreate`, `SetupTokenCookieAuthAndCreate`, `Acceptance`, `Activate`, `RefreshOnly`, `RuntimeRegister`, `Healthcheck`, `StartWarming`, `PromoteProduction`, `Abort`, and `AccountHealthcheck`. `BrowserEgressCheck` remains public nonce-capability handling and never uses admin principal headers.

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

Before state/version evaluation, the service calls the injected policy revalidator with `{subject, tenant, role, group, authority_revision}`. A concurrent role/revocation/policy change returns the same 401/403 before reservation and before any business dependency. Classify operations before implementation:

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

Run: `cd backend && go test ./internal/service ./internal/server/routes ./internal/handler/... -run 'FormalPoolOnboarding|ProvideFormalPoolOnboarding' -count=1`

Run: `cd frontend && npm run typecheck`

Expected: both PASS. The exact 15-route cross-product returns 401 for missing/revoked/expired sessions, 403 for ordinary/service/cross-boundary/concurrently revoked authority, and 409 for stale or conflicting versions only after authority succeeds. Combined owner+stale+wrong-state cases return 403 with zero dependency calls. Duplicate OAuth callback and concurrent promote are idempotent with one dependency call. A sequential `runAcceptance -> startWarming` frontend test proves the second call uses the acceptance result's new version and does not 409.

- [ ] **Step 9: Commit Task 2**

```bash
git add backend/internal/handler/admin/formal_pool_onboarding_principal.go backend/internal/handler/admin/formal_pool_onboarding_handler.go backend/internal/handler/wire.go backend/internal/config/config.go backend/internal/service/formal_pool_onboarding_authorization.go backend/internal/service/formal_pool_onboarding_service.go backend/internal/server/routes/formal_pool_onboarding_phase0_red_test.go backend/internal/server/routes/formal_pool_onboarding_routes_test.go backend/internal/handler/formal_pool_onboarding_provider_test.go frontend/src/api/admin/claudeOnboarding.ts frontend/src/composables/useEgressCheckPolling.ts frontend/src/components/account/ClaudeFormalPoolOnboardingWizard.vue frontend/src/components/account/ClaudeFormalPoolOnboardingWizardV2.vue frontend/src/composables/__tests__/useEgressCheckPolling.spec.ts frontend/src/components/account/__tests__/ClaudeFormalPoolOnboardingWizardV2.spec.ts
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

    // Sole exception: owner is already proven, so an exact consumed proof is
    // classified as replay before stale-version or terminal-state handling.
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

`authorizeBrowserEgressOwner` performs context presence, record lookup, and the complete subject/admin/tenant/group/creator/role comparison, returning the common authentication/forbidden errors. It does not inspect proof, expected version, or state. `authorizeBrowserEgressVersionAndState` then requires `ExpectedVersion`, compares it, and validates `proxy_verified`. Do not call generic `authorizeSession` before `consumedBrowserProofMatches`, and do not reuse this split ordering for any other mutation.

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
  const host = String(config.server.host || '').trim() || '127.0.0.1'
  if (host === '127.0.0.1' || host === '::1' || host === '[::1]') return { host, remote: false }
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
export type ProxyStartupPrimitives = Readonly<{
  readTLSFile: (path: string) => Buffer
  createHTTPServer: typeof createHttpServer
  createHTTPSServer: typeof createHttpsServer
  listen: (server: ReturnType<typeof createHttpServer>, port: number, host: string, ready: () => void) => void
}>

const DEFAULT_PROXY_STARTUP_PRIMITIVES: ProxyStartupPrimitives = Object.freeze({
  readTLSFile: (file) => readFileSync(file),
  createHTTPServer: (handler) => createHttpServer(handler),
  createHTTPSServer: (options, handler) => createHttpsServer(options, handler),
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

Tests inspect `server.address()` for omitted host, `127.0.0.1`, and `::1`. The direct `startProxy` negative tables must cover every listener and upstream mutation and assert zero TLS-read, server-create, and listen effects; do not substitute a pre-call to either pure resolver. Inject a secret canary as token/policy/trust-env suffix and assert thrown/logged text is exactly `config: <stable_code>` with no canary bytes. Node request-option tests assert `rejectUnauthorized: true`; sidecar tests assert production config never sets `InsecureSkipVerify` and unsafe trust env fails before the listen observer fires.

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

**Files:**
- Create: `docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json`
- Create: `docs/superpowers/schemas/oracle-lab-phase-1-command-catalog.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-phase-1-exit.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-phase-1-results.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-phase-1-handoff.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-phase-1-integration-entry.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-phase-1-integration-receipt.schema.json`
- Create: `tools/oracle-lab/phase-1-evidence.ts`
- Create: `tools/oracle-lab/phase-1-loopback-sandbox.ts`
- Create: `tests/oracle-lab-phase-1-evidence.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: reviewed `runBoundedProcess`, `classifyBoundedProcess`, `runReviewedGit`, `assertNoGitReplacementRefs`, `HERMETIC_NETWORK_ENV`, `DISABLED_CAPABILITIES`, `writeExclusiveArtifact`, `canonicalJson`, `digestFile`, and `sha256` from P0.1/H0. The older `tools/claude-native-oracle-matrix.ts` profile is a discovery reference only; H1 accepts only the exact profile below after live canaries pass.
- Produces: `resolvePhase1LoopbackSandbox`, `runPhase1SandboxCanaries`, `wrapPhase1Command`, `validatePhase1CatalogValue`, `captureAndRunPhase1`, `validatePhase1ResultsValue`, `buildPhase1Handoff`, `validatePhase1HandoffValue`, and deterministic Markdown rendering.
- Does not modify the Phase 0 command catalog, Registry v1 validators, P0.1 CLI, or their schemas.

- [ ] **Step 1: Write RED tests for the Phase 1 adapter contract**

```typescript
const EXPECTED_COMMAND_IDS = [
  'sub-b1-b3', 'sub-formal-pool', 'sub-full-go', 'sub-frontend-h1',
  'sub-frontend-typecheck', 'sub-frontend-build', 'cc-listener-h1', 'cc-upstream-tls-h1',
  'cc-build', 'cc-tests', 'sidecar-tests', 'joint-local-chain', 'cc-b4-b6-red', 'sidecar-b5-b6-red',
]

const hasCode = (code: string) => (error: unknown) =>
  error instanceof Error && (error as Error & { code?: string }).code === code

test('Phase 1 catalog has exact IDs, groups, repositories, argv and expected exits', async () => {
  const catalog = await readJson(catalogPath)
  assert.deepEqual(catalog.map((entry: any) => entry.id), EXPECTED_COMMAND_IDS)
  assert.deepEqual(validatePhase1CatalogValue(catalog), { ok: true, errors: [] })
  assert.deepEqual(catalog.find((entry: any) => entry.id === 'cc-b4-b6-red').expected_failure_families, ['B4', 'B5', 'B6'])
  assert.deepEqual(catalog.find((entry: any) => entry.id === 'sidecar-b5-b6-red').expected_failure_families, ['TestPhase0B5', 'TestPhase0B6'])

  const duplicate = structuredClone(catalog)
  duplicate.find((entry: any) => entry.id === 'cc-b4-b6-red').expected_failure_families.push('B6')
  assert.equal(validatePhase1CatalogValue(duplicate).ok, false)
})

test('RED classification requires the exact frozen failure-family set', () => {
  for (const observed of [[], ['B4'], ['B4', 'B5'], ['B4', 'B5', 'unknown'], ['unrelated']]) {
    const result = classifyPhase1Result(redNonzeroFixture({
      commandID: 'cc-b4-b6-red', observedFailureFamilies: observed,
    }))
    assert.equal(result.status, 'unexpected_fail')
  }
  assert.equal(classifyPhase1Result(redNonzeroFixture({
    commandID: 'cc-b4-b6-red', observedFailureFamilies: ['B4', 'B5', 'B6'],
  })).status, 'expected_fail')

  for (const observed of [[], ['TestPhase0B5'], ['TestPhase0B6'], ['TestPhase0B5', 'unknown']]) {
    assert.equal(classifyPhase1Result(redNonzeroFixture({
      commandID: 'sidecar-b5-b6-red', observedFailureFamilies: observed,
    })).status, 'unexpected_fail')
  }
  assert.equal(classifyPhase1Result(redNonzeroFixture({
    commandID: 'sidecar-b5-b6-red', observedFailureFamilies: ['TestPhase0B5', 'TestPhase0B6'],
  })).status, 'expected_fail')
})

test('RED classification rejects a valid family set plus any unrelated failing leaf', () => {
  const result = classifyPhase1Result(redNonzeroFixture({
    commandID: 'cc-b4-b6-red',
    failureNames: ['B4 fixture', 'B5 fixture', 'B6 fixture', 'HA-P0-009 unrelated failure'],
  }))
  assert.equal(result.status, 'unexpected_fail')
  assert.equal(result.unclassified_failure_names.length, 1)
})

test('result validation re-derives RED families instead of trusting persisted tokens', () => {
  const valid = redResultFixture({
    commandID: 'cc-b4-b6-red',
    failureNames: ['B4 fixture', 'B5 fixture', 'B6 fixture'],
    observedFailureFamilies: ['B4', 'B5', 'B6'],
  })
  assert.equal(validatePhase1ResultsValue(valid).ok, true)
  for (const forged of [
    { ...valid, failure_names: ['unrelated failure'] },
    { ...valid, observed_failure_families: ['B4', 'B5'] },
    { ...valid, observed_failure_families: ['B4', 'B5', 'B6', 'TestPhase0B5'] },
  ]) assert.equal(validatePhase1ResultsValue(rehash(forged)).ok, false)
})

test('capture rejects a dirty repository before running the first command', () => {
  assert.throws(() => captureAndRunPhase1(dirtyFixture), hasCode('dirty_repository'))
})

test('capture rejects missing, expired, tampered, or unapproved execution context before spawning', () => {
  for (const fixture of invalidExecutionContexts) {
    assert.throws(() => captureAndRunPhase1({ ...baseOptions, executionContextPath: fixture }),
      hasCode('execution_context_not_authorized'))
  }
  assert.equal(spawnObserver.count, 0)
})

test('capture refuses proxy-only networking and requires an OS loopback sandbox', async () => {
  assert.throws(() => captureAndRunPhase1({ ...baseOptions, sandbox: unavailableSandbox }),
    hasCode('network_sandbox_unavailable'))
  const canaries = await runPhase1SandboxCanaries(reviewedSandboxFixture)
  assert.equal(canaries.loopback_socket, 'pass')
  assert.equal(canaries.non_loopback_test_net_socket, 'denied_by_policy')
  assert.equal(canaries.policy_bypass_detected, false)
})

test('handoff rejects unexpected pass/fail, cross-head results, unsafe output and non-ancestor artifact head', () => {
  for (const fixture of invalidHandoffFixtures) {
    assert.equal(validatePhase1HandoffValue(fixture).ok, false)
  }
})
```

The dirty fixture is a temporary Git repository with one committed file plus one untracked file. Execution-context mutations independently change expiry, plan bytes/digest, plan commit, approval artifact bytes/digest, reviewer decision/counts, base head, branch, live status, shared contract, and disabled capabilities. Add hostile inherited `PATH`, `GIT_DIR`, `GIT_WORK_TREE`, object-directory, alternate-object, config, and replace-object environment cases; reviewed Git must either ignore them through its closed environment or fail with the existing stable replacement-ref code. Invalid handoff fixtures each mutate one field of a valid fixture: unexpected status, repository head, `unsafe_output_detected`, reviewed-head ancestry, expiry, artifact path traversal, or report bytes.

- [ ] **Step 2: Run adapter tests and confirm files are absent**

Run: `npm exec tsx tests/oracle-lab-phase-1-evidence.test.ts`

Expected: FAIL because the schemas, catalog, and adapter do not exist.

- [ ] **Step 3: Define closed evidence types and safe execution boundaries**

```typescript
export type Phase1Group = 'phase1-green' | 'phase1-red'
export type Phase1ImplementedRequirement = 'AV-B1-001' | 'AV-B2-001' | 'AV-B3-001' | 'RA-P0-008'
export type Phase1PreservedRedRequirement = 'AV-B4-001' | 'AV-B5-001' | 'AV-B6-001'
export type Phase1RedFailureFamily = 'B4' | 'B5' | 'B6' | 'TestPhase0B5' | 'TestPhase0B6'
export type Phase1Command = {
  id: string
  group: Phase1Group
  repository: 'cc-gateway' | 'sub2api' | 'egress-tls-sidecar'
  cwd: string
  argv: string[]
  expected_exit: 0 | 'nonzero'
  expected_failure_families: Phase1RedFailureFamily[]
  timeout_ms: number
  requirement_ids: Array<Phase1ImplementedRequirement | Phase1PreservedRedRequirement>
}

export type Phase1Result = {
  command_id: string
  repository: Phase1Command['repository']
  repository_commit: string
  exit_code: number
  status: 'pass' | 'expected_fail' | 'unexpected_fail' | 'unexpected_pass'
  stdout_digest: string
  stderr_digest: string
  failure_names: string[]
  observed_failure_families: Phase1RedFailureFamily[]
  unclassified_failure_names: string[]
  sandbox_policy_digest: string
  network_policy_violations: number
  unsafe_output_detected: boolean
  result_digest: string
}
```

The catalog schema makes the group-to-requirement split structural: `phase1-green` entries may contain only `Phase1ImplementedRequirement` and require `expected_failure_families: []`; `phase1-red` entries may contain only `Phase1PreservedRedRequirement` and require the command-specific exact nonempty family array below. Arrays are ordered, unique, closed enums. Every implemented ID must appear on at least one GREEN row, and no RED row contributes satisfaction evidence for Phase 1.

The adapter accepts no shell strings. It expands only `${CC_GATEWAY_ROOT}` and `${SUB2API_ROOT}`, caps output at 8 MiB, records digests and safe test names only, and writes artifacts with `writeExclusiveArtifact` under `docs/superpowers/evidence/phase-1`. `HERMETIC_NETWORK_ENV` plus offline package-manager variables remain defense in depth, but raw argv never goes directly to `runBoundedProcess`: `wrapPhase1Command` places every command and all descendants inside the reviewed OS loopback-only sandbox.

On the frozen macOS runner, `resolvePhase1LoopbackSandbox` requires the reviewed absolute `/usr/bin/sandbox-exec`, records its binary digest, and generates a private mode-0600 profile with exactly `(allow default)`, `(deny network*)`, `(allow network-outbound (remote tcp "localhost:*"))`, and `(allow network-inbound (local tcp "localhost:*"))` after the required `(version 1)`. The `localhost:*` rule is live-tested for both `127.0.0.1` and `::1`; address-literal profile rules are forbidden because they are rejected by the current Seatbelt parser. Record the policy digest. Before the first catalog command, canaries prove dynamically allocated IPv4 and IPv6 loopback servers are reachable while a direct socket to the RFC 5737 TEST-NET address `198.51.100.1` fails with `EPERM` or `EACCES`, never timeout, refusal, or success. The canary carries no credential or user data. Unsupported platforms, unexpected denial codes, or unavailable enforcement return `network_sandbox_unavailable`; there is no proxy-only degraded mode. Each result binds the same policy digest and zero observed sandbox violations. A sandbox denial/violation during a command terminates that capture as `unexpected_fail`; no evidence file is written. Unit tests prove a Node direct socket and a spawned child cannot bypass the guard. A later Linux runner requires a separately reviewed namespace adapter and equivalent canaries; it is not silently accepted by this plan.

The RED parser accepts only failing leaf names, never suite/file summaries or skipped names. It classifies anchored safe names (`^B4(?:\\s|$)`, `^B5(?:\\s|$)`, `^B6(?:\\s|$)`, `^TestPhase0B5[A-Za-z0-9_/]*$`, and `^TestPhase0B6[A-Za-z0-9_/]*$`) into constant family tokens. Repeated failing test names within one family collapse to one token. Any failing leaf that does not match the exact command allowlist is retained only as a safe constant/category in `unclassified_failure_names` and forces `unexpected_fail`. A nonzero exit becomes `expected_fail` only when there are zero unclassified names and the ordered unique observed family set exactly equals the catalog set; empty, partial, unknown, or supersets become `unexpected_fail`, while catalog duplicates fail schema/semantic validation. `validatePhase1ResultsValue` re-parses `failure_names`, compares the derived names/families to the persisted fields and exact catalog row, and rejects a rehashed forgery. A valid B4-B6 set plus `HA-P0-009` or any other failure is always unexpected.

- [ ] **Step 4: Add the exact Phase 1 command catalog**

```text
sub-b1-b3: ${SUB2API_ROOT}/backend :: go test -tags=phase0red ./internal/service ./internal/server/routes -run FormalPoolOnboarding|Browser|Egress -count=1 :: exit 0
sub-formal-pool: ${SUB2API_ROOT}/backend :: go test ./internal/service ./internal/server/routes ./internal/handler/... -run FormalPool|FormalPoolOperations -count=1 :: exit 0
sub-full-go: ${SUB2API_ROOT}/backend :: go test ./... -count=1 :: exit 0
sub-frontend-h1: ${SUB2API_ROOT}/frontend :: npm run test:run -- src/components/account/__tests__/ClaudeFormalPoolOnboardingWizardV2.spec.ts src/composables/__tests__/useEgressCheckPolling.spec.ts :: exit 0
sub-frontend-typecheck: ${SUB2API_ROOT}/frontend :: npm run typecheck :: exit 0
sub-frontend-build: ${SUB2API_ROOT}/frontend :: npm run build :: exit 0
cc-listener-h1: ${CC_GATEWAY_ROOT} :: npm exec tsx tests/listener-boundary.test.ts :: exit 0
cc-upstream-tls-h1: ${CC_GATEWAY_ROOT} :: npm exec tsx tests/upstream-tls-boundary.test.ts :: exit 0
cc-build: ${CC_GATEWAY_ROOT} :: npm run build :: exit 0
cc-tests: ${CC_GATEWAY_ROOT} :: npm test :: exit 0
sidecar-tests: ${CC_GATEWAY_ROOT}/sidecar/egress-tls-sidecar :: go test ./... -count=1 :: exit 0
joint-local-chain: ${SUB2API_ROOT}/backend :: go test ./internal/service -run ^(TestClaudePlatformAWSLocalFullChainE2EUsesCCGatewayAndSafeMockUpstream|TestJointLocalCaptureAcceptanceArtifact)$ -count=1 -v :: exit 0
cc-b4-b6-red: ${CC_GATEWAY_ROOT} :: node --import tsx --test --test-name-pattern=^(B4|B5|B6)(\\s|$) tests/red/phase0-boundary.red.test.ts :: env ORACLE_LAB_MANIFEST_PATH=${CC_GATEWAY_ROOT}/docs/superpowers/evidence/phase-1/phase-1-entry-baseline.json, SUB2API_ROOT=${SUB2API_ROOT} :: nonzero :: failure families [B4,B5,B6] :: allowed failing prefixes [B4 ,B5 ,B6 ]
sidecar-b5-b6-red: ${CC_GATEWAY_ROOT}/sidecar/egress-tls-sidecar :: go test -tags=phase0red ./internal/control ./internal/server -run ^TestPhase0B[56] -count=1 :: nonzero :: failure families [TestPhase0B5,TestPhase0B6] :: allowed failing prefixes [TestPhase0B5,TestPhase0B6]
```

The first twelve entries use `phase1-green`; the final two use `phase1-red`. Every implemented requirement ID appears on at least one GREEN command. `cc-listener-h1`, `cc-upstream-tls-h1`, and `sidecar-tests` jointly bind `RA-P0-008`. The CC RED name filter excludes the separate `HA-P0-009` Phase 2 corpus instead of ignoring its failures; the sidecar filter excludes unrelated Go tests. The RED entries carry only `AV-B4-001`, `AV-B5-001`, and `AV-B6-001` links and never satisfy a Phase 1 requirement. Catalog validation hard-codes exact argv, environment, family arrays, and failing-name prefixes per command ID rather than trusting arbitrary catalog strings.

- [ ] **Step 5: Implement one `run-all` capture transaction**

```typescript
export function captureAndRunPhase1(options: {
  stage: 'feature-candidate' | 'post-integration'
  ccGatewayRoot: string
  sub2apiRoot: string
  entryPath: string
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

`feature-candidate` requires `executionContextPath` and forbids `integrationEntryPath`; `post-integration` requires `integrationEntryPath` and forbids `executionContextPath`. The closed schema rejects every other combination, and only post-integration results may feed `build-handoff`. In the next paragraph, "execution context" means the selected stage authority: the context/review pair for feature capture or the integration entry plus its bound provenance for post-integration capture.

Before the first command, validate the unexpired execution context and parse the closed plan-review receipt. All Git inspection uses `runReviewedGit`; replacement refs and inherited Git/PATH/object-store configuration fail closed. Re-derive the digests of planning provenance, review receipt, current plan, and `git show <reviewed_commit>:<plan.path>`; all plan digests and commits must match exactly, not merely by ancestry. Require `approved`, zero Critical/Important findings, and the exact authority/provenance paths. Then verify both worktrees are on the declared implementation branches, are clean, both heads descend from the execution context's main baselines, both CodeGraph indexes are current, parent receipts validate, shared-contract bytes match the frozen digest, and production/canary environment flags are absent. Resolve the OS sandbox and run both canaries before spawning a catalog command. Capture reviewed heads, CodeGraph digests, sandbox executable/policy digests, and canary verdicts in memory; run all fourteen commands sequentially only through `wrapPhase1Command`. For each RED command, reject every unclassified failing leaf and compare the exact frozen failure-family set before accepting `expected_fail`. Reject any sandbox violation, family/name mismatch, unexpected status, or unsafe output, then write baseline and results. No evidence file is written before the last command completes. The expired planning context alone can never authorize capture.

- [ ] **Step 6: Add CLI subcommands and package entry**

```json
{
  "scripts": {
    "oracle:phase1": "tsx tools/oracle-lab/phase-1-evidence.ts"
  }
}
```

Supported subcommands are exact: `validate-catalog`, `run-all`, `validate-results`, `build-integration-entry`, `build-handoff`, `validate-handoff`, `build-integration-receipt`, and `validate-integration-receipt`. Unknown commands, duplicate arguments, path traversal, symlink artifacts, expired inputs, and absolute persisted paths fail with stable error codes. The receipt builder accepts only a clean exact artifact commit; the validator enforces its one-path child commit when supplied.

- [ ] **Step 7: Run adapter, planning, P0.1, and full CC regression**

Run: `npm exec tsx tests/oracle-lab-phase-1-evidence.test.ts`

Run: `npm exec tsx tests/oracle-lab-phase-1-planning.test.ts`

Run: `npm run test:oracle:p0-1`

Run: `npm test && npm run build`

Expected: all PASS. The Phase 0 and P0.1 artifacts and tools remain byte-for-byte unchanged.

- [ ] **Step 8: Commit Task 7 in CC Gateway**

```bash
git add docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json docs/superpowers/schemas/oracle-lab-phase-1-command-catalog.schema.json docs/superpowers/schemas/oracle-lab-phase-1-exit.schema.json docs/superpowers/schemas/oracle-lab-phase-1-results.schema.json docs/superpowers/schemas/oracle-lab-phase-1-handoff.schema.json docs/superpowers/schemas/oracle-lab-phase-1-integration-entry.schema.json docs/superpowers/schemas/oracle-lab-phase-1-integration-receipt.schema.json tools/oracle-lab/phase-1-evidence.ts tools/oracle-lab/phase-1-loopback-sandbox.ts tests/oracle-lab-phase-1-evidence.test.ts package.json
git commit -m "test(oracle): add bounded Phase 1 H1 evidence adapter"
```

### Task 8: Feature Review, Post-Integration Evidence, Registry Transition, and Handoff

**Files:**
- Create: `docs/superpowers/evidence/phase-1/phase-1-feature-baseline.json`
- Create: `docs/superpowers/evidence/phase-1/phase-1-feature-command-results.json`
- Create: `docs/superpowers/evidence/phase-1/phase-1-feature-review.md`
- Create: `docs/superpowers/evidence/phase-1/phase-1-integration-entry.json`
- Create: `docs/superpowers/evidence/phase-1/phase-1-exit-baseline.json`
- Create: `docs/superpowers/evidence/phase-1/phase-1-command-results.json`
- Create: `docs/superpowers/evidence/phase-1/phase-1-handoff.json`
- Create: `docs/superpowers/evidence/phase-1/phase-1-exit-report.md`
- Create: `docs/superpowers/evidence/phase-1/phase-1-integration-receipt.json`
- Modify: `docs/superpowers/registry/oracle-lab-requirements.json`
- Modify: `docs/superpowers/registry/oracle-lab-claims.json`
- Modify: `docs/superpowers/registry/oracle-lab-current-observations.json`
- Test: `tests/oracle-lab-phase-1-evidence.test.ts`
- Test: `tests/oracle-lab-phase-1-planning.test.ts`

**Interfaces:**
- Consumes: Task 7 `run-all`, both clean feature heads, the exact plan approval/execution context, the two merged implementation PRs, and four selected requirement rows.
- Produces: non-authoritative feature-candidate results, a fresh integration entry bound to exact fetched `muqihang/main` heads, complete post-integration results, a descendant artifact commit, a one-file receipt commit, and final Phase 2 entry conditions.

- [ ] **Step 1: Update CodeGraph and prove both feature worktrees are clean**

Run `codegraph sync` then `codegraph status` in each implementation worktree. Run `git status --porcelain=v1 --untracked-files=all` in each worktree.

Expected: both CodeGraph statuses are up to date and both Git status outputs are empty. Do not run evidence capture from the operator's original dirty Sub2API main worktree.

- [ ] **Step 2: Execute and validate one feature-candidate H1 capture**

```bash
npm run oracle:phase1 -- run-all --stage feature-candidate --entry docs/superpowers/evidence/phase-1/phase-1-entry-baseline.json --execution-context docs/superpowers/evidence/phase-1/phase-1-execution-context.json --catalog docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json --cc-gateway-root ${CC_GATEWAY_ROOT} --sub2api-root ${SUB2API_ROOT} --baseline-out docs/superpowers/evidence/phase-1/phase-1-feature-baseline.json --results-out docs/superpowers/evidence/phase-1/phase-1-feature-command-results.json
```

Expected: twelve `pass`, two `expected_fail`, zero unclassified failure names, zero sandbox violations, exact RED families `[B4,B5,B6]` and `[TestPhase0B5,TestPhase0B6]`, and a proven loopback-only sandbox. Validate with `validate-results`. These results authorize review of the feature heads only; schemas forbid using `stage: feature-candidate` to mint a handoff or transition Registry rows.

- [ ] **Step 3: Commit feature-candidate evidence and obtain independent implementation review**

```bash
git add docs/superpowers/evidence/phase-1/phase-1-feature-baseline.json docs/superpowers/evidence/phase-1/phase-1-feature-command-results.json docs/superpowers/evidence/phase-1/phase-1-feature-review.md
git commit -m "test(oracle): bind Phase 1 feature candidate results"
```

The independent reviewer checks full goal coverage, the exact route-by-authority matrix, authority-before-state/version/dependency ordering, role-revision races, duplicate callback/promote idempotency, replay behavior, frontend version continuity, origin trust, direct `startProxy` startup ordering, direct and sidecar certificate verification, exact RED leaves/families, sandbox enforcement, secret leakage, and scope. Critical and Important findings must be zero before either PR is merged.

- [ ] **Step 4: Merge both implementation PRs before final evidence**

Push `codex/oracle-phase-1-sub2api` and `codex/oracle-phase-1-cc-gateway`, create reviewable PRs, and merge each with an ordinary merge commit after required checks. Do not squash, rebase, force-push, or commit directly to `main`. Record the exact reviewed feature heads and PR merge references. A feature-branch handoff is prohibited.

- [ ] **Step 5: Freeze exact integrated mains in new clean worktrees**

Fetch `muqihang/main` in both repositories after both PRs merge. Create `codex/oracle-phase-1-post-integration` from the fetched CC Gateway main and a clean Sub2API post-integration worktree at its fetched main. Initialize or sync CodeGraph in both and require current indexes and empty status.

Create `phase-1-integration-entry.json` under its closed schema. It binds: exact remote URLs by digest; exact `refs/remotes/muqihang/main` commits; the reviewed feature heads and proof each is an ancestor of its integrated main; exact plan/review/context digests; unchanged shared-contract digest; sandbox executable/policy digests; disabled capabilities; and the exact implementation-path tree digests. Generation fails if either local HEAD differs from fetched remote main, either remote advances during freezing, or any feature head is not an ancestor.

- [ ] **Step 6: Rerun the complete catalog on the exact integrated main heads**

```bash
npm run oracle:phase1 -- run-all --stage post-integration --integration-entry docs/superpowers/evidence/phase-1/phase-1-integration-entry.json --catalog docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json --cc-gateway-root ${CC_GATEWAY_INTEGRATION_ROOT} --sub2api-root ${SUB2API_INTEGRATION_ROOT} --baseline-out docs/superpowers/evidence/phase-1/phase-1-exit-baseline.json --results-out docs/superpowers/evidence/phase-1/phase-1-command-results.json
```

Expected: the same twelve `pass` and two exact `expected_fail` results, zero unclassified names, zero sandbox violations, and repository commits exactly equal the integration entry's two fetched main heads. The adapter re-fetches remote refs before and after the run; any movement invalidates the transaction. Validate results before changing governance state.

- [ ] **Step 7: Transition only the four Phase 1 requirement rows**

For `AV-B1-001`, `AV-B2-001`, `AV-B3-001`, and `RA-P0-008`, set reviewed implemented status, exact implementation/test arrays, exact post-integration command IDs/results, the two integrated main heads, and verification timestamp. Leave every other deferred row unchanged.

Add claims only at `local_structural` or `local_observational`. Do not add `upstream_canary_observed` or `provider_internal_confirmed`. `RA-P0-008` becomes locally implemented only when listener, direct-upstream TLS, and sidecar commands are GREEN. Retain `external_network_exposure_policy_enforcement_not_observed` and `real_upstream_certificate_chain_not_observed` as production gaps. Append one `resolved` event for `RA-CURRENT-008` bound to the two boundary tests, sidecar result, result digests, and integrated CC main head; preserve all prior events.

- [ ] **Step 8: Build and validate the deterministic final handoff/report**

```bash
npm run oracle:phase1 -- build-handoff --integration-entry docs/superpowers/evidence/phase-1/phase-1-integration-entry.json --baseline docs/superpowers/evidence/phase-1/phase-1-exit-baseline.json --results docs/superpowers/evidence/phase-1/phase-1-command-results.json --registry docs/superpowers/registry/oracle-lab-requirements.json --claims docs/superpowers/registry/oracle-lab-claims.json --observations docs/superpowers/registry/oracle-lab-current-observations.json --handoff-out docs/superpowers/evidence/phase-1/phase-1-handoff.json --report-out docs/superpowers/evidence/phase-1/phase-1-exit-report.md
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

It expires exactly 24 hours after generation and binds the exact two fetched integrated main heads, integration-entry/result digests, safe command/failure names, requirement IDs, and repository-relative paths. Validate the handoff/report pair, planning tests, Phase 1 evidence tests, full CC tests, and build before committing.

- [ ] **Step 9: Commit the exact post-integration artifact set**

Run the scope/leak audits from the prior plan, then commit all final artifacts and governance transitions in one artifact commit:

```bash
git add docs/superpowers/evidence/phase-1/phase-1-integration-entry.json docs/superpowers/evidence/phase-1/phase-1-exit-baseline.json docs/superpowers/evidence/phase-1/phase-1-command-results.json docs/superpowers/evidence/phase-1/phase-1-handoff.json docs/superpowers/evidence/phase-1/phase-1-exit-report.md docs/superpowers/registry/oracle-lab-requirements.json docs/superpowers/registry/oracle-lab-claims.json docs/superpowers/registry/oracle-lab-current-observations.json
git commit -m "docs(oracle): bind Phase 1 to integrated main heads"
```

The validator requires this commit's parent to be the exact captured CC integrated main head and its delta to contain only the declared Phase 1 evidence/governance paths. Every bound artifact digest must equal `git show <artifact_commit>:<path>`.

- [ ] **Step 10: Generate a self-reference-safe receipt and commit only it**

At the clean artifact commit, generate `phase-1-integration-receipt.json`. It binds the artifact commit, exact CC/Sub2API integrated main heads, reviewed feature heads, integration-entry/results/handoff/report/registry digests, sandbox digests, disabled capabilities, and Phase 2 gates. Validate it both before and after commit.

```bash
git add docs/superpowers/evidence/phase-1/phase-1-integration-receipt.json
git commit -m "docs(oracle): publish Phase 1 integration receipt"
```

The receipt commit must have the artifact commit as its sole parent and add exactly one path. This two-commit chain is the only permitted solution to the artifact self-reference problem; the receipt never claims to contain its own commit hash.

- [ ] **Step 11: Independently review and merge the post-integration evidence PR**

The reviewer reruns receipt validation and verifies the integrated-main bindings, feature-head ancestry, exact artifact/receipt commit deltas, complete command set, sandbox proof, Registry transitions, leak audit, and no-production/no-canary boundary. Require zero Critical/Important findings, then merge `codex/oracle-phase-1-post-integration` through an ordinary PR merge commit.

- [ ] **Step 12: Perform final remote-main verification without minting a false receipt**

Fetch both `muqihang/main` refs again. Require the Sub2API remote main to remain exactly the receipt's integrated Sub2API head. Require the CC remote main to descend from the receipt commit, and require the only paths changed after the receipted integrated CC code head to be the declared Phase 1 evidence/governance paths plus the reviewed PR merge. Revalidate receipt bytes from remote main, rerun the focused planning/receipt validators, and report the final remote heads plus receipt digest. If either implementation tree changed after capture, the handoff is invalid and Steps 5-12 repeat from new integrated heads.

## Final Verification Matrix

| Gate | Required result |
| --- | --- |
| B1 arbitrary/wrong/expired/replay/cross-session/proxy-change corpus | GREEN |
| B1 consumed-proof replay classification | same owner returns `FORMAL_POOL_BROWSER_PROOF_REJECTED` for old/current version; cross-owner remains common 403; nonmatching stale proof remains 409 |
| B1 concurrent public verifier reservation | one proxy observer call; enumeration-resistant duplicate response |
| B2 exact 15-route × complete caller/session matrix | GREEN; no route/dimension sampling |
| B2 ordinary/group-admin/tenant-admin/service/revoked/expired cases | exact 401/403/allowed outcomes from trusted policy/session state |
| B2 owner + wrong-state + stale-version combined ordering | common 403; zero dependency calls |
| B2 concurrent authority revision change | common 401/403 before reservation/dependency |
| Duplicate OAuth callback and concurrent promote | idempotent pending/completed result; one dependency call |
| B2 concurrent same-version side-effect reservation | one dependency call; second request 409 before side effect |
| Session creation idempotency reservation | one proxy creation call per owner/key/request fingerprint |
| Mutation response version continuity | acceptance/healthcheck next action uses latest version |
| B3 Host/forwarded-header mutation corpus | GREEN |
| Listener omitted-host observed bind | `127.0.0.1` |
| Remote-listen prerequisite and approved-policy mutation corpus | GREEN fail-closed through direct `startProxy`; zero TLS-read/server-create/listen effects |
| Direct upstream HTTPS/system-trust/unsafe-env corpus | GREEN fail-closed; `rejectUnauthorized: true` |
| Sidecar production TLS config | `InsecureSkipVerify == false`; unsafe trust env rejected before listen |
| Execution authorization | exact plan/context/review digests; zero Critical/Important; unexpired |
| Sub2API full Go regression | GREEN |
| Frontend focused tests, typecheck, build | GREEN |
| CC Gateway full tests and build | GREEN |
| Joint local chain | GREEN |
| OS network boundary | reviewed loopback-only sandbox and canaries; proxy environment alone is insufficient |
| CC B4-B6 and sidecar B5-B6 | filtered command, exact failing-name allowlist and families; any extra/unparsed failure is unexpected |
| Post-integration authority | final results bind exact fetched `muqihang/main` heads after both implementation PRs merge |
| Receipt chain | artifact commit exact delta plus one-path receipt child; final CC remote main descends receipt commit |
| Shared contract digest | unchanged |
| Production and real canary | disabled |

## Rollback Boundaries

- Sub2API rollback is the ordered revert of Tasks 5, 4, 3, 2, and 1. Do not partially retain the frontend `If-Match` contract after reverting backend version enforcement.
- CC Gateway deployment-boundary rollback is one Task 6 commit, but rolling it back reopens listener and upstream certificate slices of `RA-P0-008` and invalidates the Phase 1 handoff.
- H1 evidence/registry rollback is the Task 8 receipt commit, Task 8 artifact commit, feature-candidate evidence commit, then Task 7. Reverting evidence never claims the implementation itself was reverted.
- Any rollback marks the affected requirement `changed` or `deferred` in a new registry/observation event; prior evidence is retained and never rewritten.

## Self-Review Checklist

- [ ] Every Phase 1 requirement maps to at least one implementation task and one exit command.
- [ ] No implementation or capture can run from the expired planning context without an exact-plan independent approval and fresh execution context.
- [ ] Every external-effect mutation reserves its version before the first dependency call and returns the final version.
- [ ] Every one of the 15 non-public routes executes every caller/session matrix row, including active group/tenant admins, ordinary/service callers, revoked/expired sessions, and concurrent authority revision changes.
- [ ] OAuth callback and promote duplicates are idempotent by safe operation key/fingerprint and invoke dependencies once.
- [ ] Session creation reserves a provisional record before proxy creation, and public egress verification reserves before probing the proxy.
- [ ] `AttestBrowserEgress` checks owner before exact consumed-proof replay, checks version/state after that replay classification only, and preserves 403/409 for cross-owner/nonmatching cases.
- [ ] `RA-P0-008` closure includes approved exposure policy and both direct/sidecar certificate verification without claiming production observation.
- [ ] Listener/upstream negative integration calls `startProxy` directly and proves both resolvers precede TLS reads, server creation, and listen through zero observed startup effects.
- [ ] Every H1 subprocess is OS-sandboxed to loopback after passing allow/deny canaries; proxy variables alone never authorize capture.
- [ ] Every Phase 1 RED result binds the command-specific exact failing-name allowlist and failure-family set; nonzero or an extra unrelated leaf never yields `expected_fail`.
- [ ] B4-B6, Phase 2 manifest authority, reverse/oracle capture, profile synthesis, real canary, and production deployment remain out of scope.
- [ ] All named types and function signatures are consistent between backend, handler, frontend, tests, and H1 catalog.
- [ ] No placeholder language or unspecified test command remains.
- [ ] Both implementation PRs merge before final capture; the post-integration artifact/receipt chain binds fetched mains and is independently reviewable and revertible.
