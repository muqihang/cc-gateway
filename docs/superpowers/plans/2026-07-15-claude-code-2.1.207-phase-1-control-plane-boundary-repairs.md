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
- Any mutation that can call OAuth, account persistence, refresh, CC Gateway, healthcheck, cache, or scheduler dependencies must first acquire a CAS reservation. A concurrent request with the same version fails before a second dependency call; an ambiguous external outcome becomes `operation_outcome_unknown` and is never automatically retried.
- Public browser-check responses remain enumeration-resistant and do not distinguish unknown, expired, replayed, mismatched, or cross-session nonces in their response body.
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
- Create `docs/superpowers/schemas/oracle-lab-phase-1-command-catalog.schema.json`, `oracle-lab-phase-1-exit.schema.json`, `oracle-lab-phase-1-results.schema.json`, and `oracle-lab-phase-1-handoff.schema.json`: closed Phase 1 evidence contracts.
- Create `tools/oracle-lab/phase-1-evidence.ts`: a small Phase 1 adapter over the reviewed `runBoundedProcess`, hermetic environment, safe artifact writer, and digest helpers already delivered by H0/P0.1.
- Create `tests/oracle-lab-phase-1-evidence.test.ts`: schema, binding, dirty-tree, unexpected-result, unsafe-output, ancestry, and handoff tests.
- Modify `package.json`: add only `oracle:phase1` for the new adapter; do not alter Phase 0/P0.1 scripts.
- Create `docs/superpowers/evidence/phase-1/phase-1-command-results.json`, `phase-1-exit-baseline.json`, `phase-1-handoff.json`, and `phase-1-exit-report.md` during the final evidence task.
- Modify `docs/superpowers/registry/oracle-lab-requirements.json`, `docs/superpowers/registry/oracle-lab-claims.json`, and `docs/superpowers/registry/oracle-lab-current-observations.json` only after all exit commands pass.

## Dependency Order

```text
Mandatory Preflight -> Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5
Task 6 is independent after Mandatory Preflight
Task 5 + Task 6 -> Task 7 -> Task 8
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

Create `phase-1-execution-context.json` with a window greater than zero and no more than 24 hours. Bind the exact plan path/digest/reviewed commit, exact planning entry/context bytes as provenance, the review artifact digest, both current main heads and implementation branch names, authority precedence bytes, unchanged shared-contract digest, selected requirement IDs, disabled capabilities, and all seven authorization conditions from the closed schema.

- [ ] **Step 4: Validate the authorization artifact before implementation**

Run: `PHASE1_REQUIRE_EXECUTION_CONTEXT=1 SUB2API_ROOT=${SUB2API_ROOT} npm exec tsx tests/oracle-lab-phase-1-planning.test.ts`

Expected: PASS. The semantic check parses the review receipt, compares every duplicated approval field, hashes `git show <reviewed_commit>:<plan.path>`, and requires those committed bytes, current plan bytes, context digest, and review receipt digest to agree. It also proves the exact authority path order, exact planning-provenance paths, both baseline heads equal freshly fetched `muqihang/main`, the context is unexpired, and Critical/Important counts are zero. Any mismatch leaves implementation blocked.

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
    _, err := svc.GetSession(ctx, session.ID)
    require.ErrorIs(t, err, ErrFormalPoolOnboardingForbidden)
    require.NotErrorIs(t, err, ErrFormalPoolOnboardingVersionConflict)
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

Implement exact validation order in `authorizeSession`: context presence, record lookup, subject/admin/tenant/group/creator/role comparison, expected-version requirement for mutations, expected-version equality, then allowed-state membership. All owner mismatches return the same 403 error.

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

`StartSession` requires `ExpectedVersion == 0`, a valid `Idempotency-Key`, admin role, non-empty tenant, positive subject/admin/creator IDs, and requested `GroupID` in `AllowedGroupIDs`. It validates and fingerprints the request, calls `beginCreateReservation`, and only then calls proxy resolution once. Success finalizes the provisional record at version `2`; ambiguous proxy creation finalizes `operation_outcome_unknown` and never auto-retries. `GetSession` authorizes the owner but does not require `If-Match`. `AbortSession` requires an expected version and uses one `casUpdate` because it has no external effect. Add `snapshotByAccountID` and `snapshotByCreateKey` with the same copy/session-expiry behavior as `snapshotByNonce`.

Add a concurrent creation test with a blocking proxy fake: two requests sharing owner, request, `If-Match: "0"`, and idempotency key produce exactly one `ResolveOrCreateProxy` call; the second receives 409 while the first is active, and a post-success replay returns the same session/version without another dependency call. A changed body under the same key is 409 before proxy invocation.

- [ ] **Step 6: Run authority/store/service regression tests**

Run: `cd backend && go test ./internal/service -run 'FormalPoolOnboarding(Store|Authorize|Reservation|StartSession|GetSession|Abort)' -count=1`

Expected: PASS with no owner identifiers in serialized sessions.

- [ ] **Step 7: Commit Task 1**

```bash
git add backend/internal/service/formal_pool_onboarding_authorization.go backend/internal/service/formal_pool_onboarding_authorization_test.go backend/internal/service/formal_pool_onboarding_store.go backend/internal/service/formal_pool_onboarding_store_test.go backend/internal/service/formal_pool_onboarding_service.go backend/internal/service/formal_pool_onboarding_service_test.go
git commit -m "feat(formal-pool): bind onboarding sessions to server authority"
```

### Task 2: B2 Principal Resolution and Route-Wide Enforcement

**Files:**
- Create: `backend/internal/handler/admin/formal_pool_onboarding_principal.go`
- Modify: `backend/internal/handler/admin/formal_pool_onboarding_handler.go:18-522`
- Modify: `backend/internal/handler/wire.go:117-123`
- Modify: `backend/internal/config/config.go:169-181`
- Modify: `backend/internal/service/formal_pool_onboarding_service.go:626-1659`
- Modify: `backend/internal/server/routes/formal_pool_onboarding_phase0_red_test.go:1-347`
- Modify: `backend/internal/server/routes/formal_pool_onboarding_routes_test.go`
- Modify: `backend/internal/handler/formal_pool_onboarding_provider_test.go`
- Modify: `frontend/src/api/admin/claudeOnboarding.ts:57-208`
- Test: `backend/internal/server/routes/formal_pool_onboarding_phase0_red_test.go`

**Interfaces:**
- Consumes: Task 1 authority context and response version.
- Produces: `FormalPoolOnboardingPrincipalResolver.Resolve(*gin.Context)`, `WithFormalPoolOnboardingPrincipalResolver`, and `parseFormalPoolIfMatch`.
- Produces: every mutating frontend API function accepts the current `FormalPoolSession` and sends its version.

- [ ] **Step 1: Make the existing B2 RED corpus always-on**

Remove only `//go:build phase0red` from `formal_pool_onboarding_phase0_red_test.go`; keep the filename for history. Replace test-only `X-Phase0-*` authority headers with a fake `FormalPoolOnboardingPrincipalResolver` whose current principal is set by the fixture before each request. Keep the complete 15-operation matrix, six independent owner dimensions, wrong-state test, and stale-version test.

- [ ] **Step 2: Run B2 tests and capture the expected failures**

Run: `cd backend && go test ./internal/server/routes -run 'TestFormalPoolOnboardingAuthorization' -count=1`

Expected: FAIL because the handler neither resolves the principal nor parses `If-Match`.

- [ ] **Step 3: Add the production principal resolver**

```go
type FormalPoolOnboardingPrincipalResolver interface {
    Resolve(c *gin.Context) (service.FormalPoolOnboardingPrincipal, error)
}

type formalPoolOnboardingPrincipalResolver struct {
    users    *service.UserService
    tenantID string
}

func (r *formalPoolOnboardingPrincipalResolver) Resolve(c *gin.Context) (service.FormalPoolOnboardingPrincipal, error) {
    subject, ok := middleware.GetAuthSubjectFromContext(c)
    if !ok || subject.UserID <= 0 { return service.FormalPoolOnboardingPrincipal{}, service.ErrFormalPoolOnboardingAuthenticationRequired }
    user, err := r.users.GetByID(c.Request.Context(), subject.UserID)
    if err != nil || user == nil { return service.FormalPoolOnboardingPrincipal{}, service.ErrFormalPoolOnboardingAuthenticationRequired }
    return service.FormalPoolOnboardingPrincipal{
        SubjectID: user.ID, AdministratorID: user.ID, TenantID: r.tenantID,
        AllowedGroupIDs: append([]int64(nil), user.AllowedGroups...), CreatorID: user.ID, Role: user.Role,
    }, nil
}
```

Add `AuthorityTenantID string \`mapstructure:"authority_tenant_id"\`` to `FormalPoolRuntimeConfig`. Empty tenant ID makes the production resolver fail closed; it is never accepted from a request header, query, or body.

Wire it with an exact provider: `ProvideFormalPoolOnboardingPrincipalResolver(userService *service.UserService, cfg *config.Config) admin.FormalPoolOnboardingPrincipalResolver`, then pass that resolver into `ProvideFormalPoolOnboardingHandler` via `admin.WithFormalPoolOnboardingPrincipalResolver(resolver)`.

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

Classify operations before implementation:

- no external effect (`AbortSession`, proof finalization after a server proof already exists): one final `casUpdate` is sufficient;
- any OAuth, proxy, account persistence, refresh, CC Gateway, healthcheck, cache, or scheduler call: call `beginReservedMutation` before the first dependency invocation, execute the dependency sequence once, then call `finishReservedMutation` from the reservation version;
- public `VerifyBrowserEgressByNonce` acquires its own CAS reservation before the proxy IP probe; every admin mutation rejects that reservation, and a concurrent public caller returns the same enumeration-resistant pending envelope without a second probe;
- dependency failure before any irreversible call may finalize a stable failure and return the latest version; an error after an irreversible/ambiguous call finalizes `operation_outcome_unknown`, blocks automatic retry, and requires explicit operator reconciliation.

Add a table-driven concurrency test for every side-effect family. The fake dependency blocks on a channel after incrementing an atomic counter. Start request A with version `N`, wait until its reservation is visible, then start request B with the same version. B must return `FORMAL_POOL_ONBOARDING_VERSION_CONFLICT` while the dependency counter remains `1`. Release A, assert one final state transition, `ActiveOperation == nil`, and response version `N+2`. Add failure tests proving no automatic retry after `operation_outcome_unknown` and no owner/state/version detail leakage.

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

`createSession` sends `If-Match: "0"` and one `Idempotency-Key` generated once per submitted wizard attempt with `crypto.randomUUID()`; retries reuse it until a definitive response or explicit form reset. Convert `generateAuthUrl`, `exchangeCodeAndCreate`, `setupTokenCookieAuthAndCreate`, `runAcceptance`, `activate`, `refreshOnly`, `runtimeRegister`, `healthcheck`, `startWarming`, `promoteProduction`, and `abort` to accept the current session and send `versionHeaders(session)`. Every successful mutation response, including `FormalPoolAcceptanceResult`, carries the final server version. Both wizards replace `session.value.version` from that response before enabling the next action; acceptance/healthcheck merge `{version,status}` instead of retaining a stale session. On any 409 or ambiguous mutation error, refetch `getSession` before exposing retry. `getSession(id, signal)` remains version-free so polling can observe a server-side nonce transition.

- [ ] **Step 8: Run the B2 matrix, service tests, and frontend typecheck**

Run: `cd backend && go test ./internal/service ./internal/server/routes ./internal/handler/... -run 'FormalPoolOnboarding|ProvideFormalPoolOnboarding' -count=1`

Run: `cd frontend && npm run typecheck`

Expected: both PASS. The route matrix returns 401 for missing principal, 403 for every owner mismatch, and 409 for stale or already-reserved versions. A sequential `runAcceptance -> startWarming` frontend test proves the second call uses the acceptance result's new version and does not 409.

- [ ] **Step 9: Commit Task 2**

```bash
git add backend/internal/handler/admin/formal_pool_onboarding_principal.go backend/internal/handler/admin/formal_pool_onboarding_handler.go backend/internal/handler/wire.go backend/internal/config/config.go backend/internal/service/formal_pool_onboarding_service.go backend/internal/server/routes/formal_pool_onboarding_phase0_red_test.go backend/internal/server/routes/formal_pool_onboarding_routes_test.go backend/internal/handler/formal_pool_onboarding_provider_test.go frontend/src/api/admin/claudeOnboarding.ts
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
- Produces: server-observed status `verified_pending_finalize`, one-use `verification_code`, consumed-proof replay rejection, and final `browser_egress_verified` state.

- [ ] **Step 1: Convert the B1 RED corpus to the required two-step success path**

Remove only the build tag. For the positive/replay case, call `VerifyBrowserEgressByNonce(ctx, proof, "198.51.100.10")` before `AttestBrowserEgress`; carry the returned version into the authority context. Keep arbitrary, modified, expired, replayed, cross-session, and pre-proxy-change proof cases. Add one case asserting that the correct proof is rejected before the server-side IP/proxy check.

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
    snap, err := s.authorizeSession(ctx, id, true, FormalPoolOnboardingStatusProxyVerified)
    if err != nil { return nil, err }
    proof := strings.TrimSpace(req.VerificationCode)
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
```

Use `crypto/subtle.ConstantTimeCompare`. Define `formalPoolProofDigest(proof string) string { return formalPoolSafeRef("browser_proof_consumed", proof) }`; it persists only the existing HMAC safe-ref form, never a raw proof. When `BrowserNonce` is empty and the supplied digest equals the consumed digest, return the same safe `FORMAL_POOL_BROWSER_PROOF_REJECTED` class as every other invalid proof.

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
- Modify: `frontend/src/api/admin/claudeOnboarding.ts:41-208`
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

- [ ] **Step 4: Migrate both wizards and preserve version monotonicity**

Every mutation passes the current session object. Polling accepts a session only when its `version >= local.version`; a stale response cannot overwrite a newer finalized session. The legacy wizard uses the same polling/finalization path and removes `attestationCode` plus its manual confirmation control.

- [ ] **Step 5: Run frontend tests, typecheck, and build**

Run: `cd frontend && npm run test:run -- src/components/account/__tests__/ClaudeFormalPoolOnboardingWizardV2.spec.ts src/composables/__tests__/useEgressCheckPolling.spec.ts`

Run: `cd frontend && npm run typecheck && npm run build`

Expected: PASS. No rendered control accepts client-chosen egress confirmation text.

- [ ] **Step 6: Commit Task 4**

```bash
git add frontend/src/api/admin/claudeOnboarding.ts frontend/src/composables/useEgressCheckPolling.ts frontend/src/components/account/ClaudeFormalPoolOnboardingWizard.vue frontend/src/components/account/ClaudeFormalPoolOnboardingWizardV2.vue frontend/src/composables/__tests__/useEgressCheckPolling.spec.ts frontend/src/components/account/__tests__/ClaudeFormalPoolOnboardingWizardV2.spec.ts
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
- Produces: `RemoteListenConfig`, `ApprovedNetworkExposurePolicyRef`, `ListenerBoundary`, `resolveListenerBoundary(config)`, `resolveUpstreamTLSBoundary(config, env)`, and sidecar `validatedProductionTrustEnvironment`/`utlsConfigForRequest`.
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

- [ ] **Step 5: Validate all deployment boundaries before any server or socket creation**

`loadConfig` calls both resolvers after auth/mode parsing. `startProxy` calls both again defensively before `createHttpServer`/`createHttpsServer`, then passes only `boundary.host` to `server.listen`. TLS files are read only after all pure prerequisite checks pass. Sidecar `main` validates production trust environment before `net.Listen`.

- [ ] **Step 6: Prove observed bind state, verified TLS options, and secret-safe failures**

Tests inspect `server.address()` for omitted host, `127.0.0.1`, and `::1`. Remote negative fixtures assert no `listening` event and no socket object is created by calling the pure resolver before `startProxy`. Inject a secret canary as token/policy/trust-env suffix and assert thrown/logged text is exactly `config: <stable_code>` with no canary bytes. Node request-option tests assert `rejectUnauthorized: true`; sidecar tests assert production config never sets `InsecureSkipVerify` and unsafe trust env fails before the listen observer fires.

- [ ] **Step 7: Run listener, upstream TLS, sidecar, security, full CC tests, and build**

Run: `npm exec tsx tests/listener-boundary.test.ts`

Run: `npm exec tsx tests/upstream-tls-boundary.test.ts`

Run: `npm exec tsx tests/security-boundary.test.ts`

Run: `cd sidecar/egress-tls-sidecar && go test ./cmd/egress-tls-sidecar ./internal/tlsengine -count=1`

Run: `npm test`

Run: `npm run build`

Expected: all PASS; omitted host is proven as `127.0.0.1` from actual server state, syntactic-but-unapproved policies are RED, real modes expose only verified HTTPS request options, and the sidecar cannot enter production with insecure/custom test trust.

- [ ] **Step 8: Commit Task 6**

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
- Create: `tools/oracle-lab/phase-1-evidence.ts`
- Create: `tests/oracle-lab-phase-1-evidence.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: reviewed `runBoundedProcess`, `classifyBoundedProcess`, `HERMETIC_NETWORK_ENV`, `DISABLED_CAPABILITIES`, `writeExclusiveArtifact`, `canonicalJson`, `digestFile`, and `sha256` from P0.1/H0.
- Produces: `validatePhase1CatalogValue`, `captureAndRunPhase1`, `validatePhase1ResultsValue`, `buildPhase1Handoff`, `validatePhase1HandoffValue`, and deterministic Markdown rendering.
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

test('handoff rejects unexpected pass/fail, cross-head results, unsafe output and non-ancestor artifact head', () => {
  for (const fixture of invalidHandoffFixtures) {
    assert.equal(validatePhase1HandoffValue(fixture).ok, false)
  }
})
```

The dirty fixture is a temporary Git repository with one committed file plus one untracked file. Execution-context mutations independently change expiry, plan bytes/digest, plan commit, approval artifact bytes/digest, reviewer decision/counts, base head, shared contract, and disabled capabilities. Invalid handoff fixtures each mutate one field of a valid fixture: unexpected status, repository head, `unsafe_output_detected`, reviewed-head ancestry, expiry, artifact path traversal, or report bytes.

- [ ] **Step 2: Run adapter tests and confirm files are absent**

Run: `npm exec tsx tests/oracle-lab-phase-1-evidence.test.ts`

Expected: FAIL because the schemas, catalog, and adapter do not exist.

- [ ] **Step 3: Define closed evidence types and safe execution boundaries**

```typescript
export type Phase1Group = 'phase1-green' | 'phase1-red'
export type Phase1ImplementedRequirement = 'AV-B1-001' | 'AV-B2-001' | 'AV-B3-001' | 'RA-P0-008'
export type Phase1PreservedRedRequirement = 'AV-B4-001' | 'AV-B5-001' | 'AV-B6-001'
export type Phase1Command = {
  id: string
  group: Phase1Group
  repository: 'cc-gateway' | 'sub2api' | 'egress-tls-sidecar'
  cwd: string
  argv: string[]
  expected_exit: 0 | 'nonzero'
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
  unsafe_output_detected: boolean
  result_digest: string
}
```

The catalog schema makes the group-to-requirement split structural: `phase1-green` entries may contain only `Phase1ImplementedRequirement`; `phase1-red` entries may contain only `Phase1PreservedRedRequirement`. Every implemented ID must appear on at least one GREEN row, and no RED row contributes satisfaction evidence for Phase 1.

The adapter accepts no shell strings. It expands only `${CC_GATEWAY_ROOT}` and `${SUB2API_ROOT}`, passes argv directly to `runBoundedProcess`, uses exactly `HERMETIC_NETWORK_ENV` plus `PATH`, caps output at 8 MiB, records digests and safe test names only, and writes artifacts with `writeExclusiveArtifact` under `docs/superpowers/evidence/phase-1`.

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
cc-b4-b6-red: ${CC_GATEWAY_ROOT} :: npm exec tsx tests/red/phase0-boundary.red.test.ts :: nonzero
sidecar-b5-b6-red: ${CC_GATEWAY_ROOT}/sidecar/egress-tls-sidecar :: go test -tags=phase0red ./internal/control ./internal/server -count=1 :: nonzero
```

The first twelve entries use `phase1-green`; the final two use `phase1-red`. Every implemented requirement ID appears on at least one GREEN command. `cc-listener-h1`, `cc-upstream-tls-h1`, and `sidecar-tests` jointly bind `RA-P0-008`. The RED entries carry only `AV-B4-001`, `AV-B5-001`, and `AV-B6-001` links and never satisfy a Phase 1 requirement.

- [ ] **Step 5: Implement one `run-all` capture transaction**

```typescript
export function captureAndRunPhase1(options: {
  ccGatewayRoot: string
  sub2apiRoot: string
  entryPath: string
  executionContextPath: string
  catalogPath: string
  baselineOut: string
  resultsOut: string
  now?: string
  runner?: typeof runBoundedProcess
}): { baseline: Phase1ExitBaseline; results: Phase1Results }
```

Before the first command, validate the unexpired execution context and parse the closed plan-review receipt. Re-derive the digests of planning provenance, review receipt, current plan, and `git show <reviewed_commit>:<plan.path>`; all plan digests and commits must match exactly, not merely by ancestry. Require `approved`, zero Critical/Important findings, and the exact authority/provenance paths. Then verify both worktrees are clean, both heads descend from the execution context's main baselines, both CodeGraph indexes are current, parent receipts validate, shared-contract bytes match the frozen digest, and production/canary environment flags are absent. Capture reviewed heads and CodeGraph digests in memory, run all fourteen commands sequentially, reject any unexpected status or unsafe output, then write baseline and results. No evidence file is written before the last command completes. The expired planning context alone can never authorize capture.

- [ ] **Step 6: Add CLI subcommands and package entry**

```json
{
  "scripts": {
    "oracle:phase1": "tsx tools/oracle-lab/phase-1-evidence.ts"
  }
}
```

Supported subcommands are exact: `validate-catalog`, `run-all`, `validate-results`, `build-handoff`, and `validate-handoff`. Unknown commands, duplicate arguments, path traversal, symlink artifacts, expired inputs, and absolute persisted paths fail with stable error codes.

- [ ] **Step 7: Run adapter, planning, P0.1, and full CC regression**

Run: `npm exec tsx tests/oracle-lab-phase-1-evidence.test.ts`

Run: `npm exec tsx tests/oracle-lab-phase-1-planning.test.ts`

Run: `npm run test:oracle:p0-1`

Run: `npm test && npm run build`

Expected: all PASS. The Phase 0 and P0.1 artifacts and tools remain byte-for-byte unchanged.

- [ ] **Step 8: Commit Task 7 in CC Gateway**

```bash
git add docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json docs/superpowers/schemas/oracle-lab-phase-1-command-catalog.schema.json docs/superpowers/schemas/oracle-lab-phase-1-exit.schema.json docs/superpowers/schemas/oracle-lab-phase-1-results.schema.json docs/superpowers/schemas/oracle-lab-phase-1-handoff.schema.json tools/oracle-lab/phase-1-evidence.ts tests/oracle-lab-phase-1-evidence.test.ts package.json
git commit -m "test(oracle): add bounded Phase 1 H1 evidence adapter"
```

### Task 8: Integrated Exit Evidence, Registry Transition, and Handoff

**Files:**
- Create: `docs/superpowers/evidence/phase-1/phase-1-exit-baseline.json`
- Create: `docs/superpowers/evidence/phase-1/phase-1-command-results.json`
- Create: `docs/superpowers/evidence/phase-1/phase-1-handoff.json`
- Create: `docs/superpowers/evidence/phase-1/phase-1-exit-report.md`
- Modify: `docs/superpowers/registry/oracle-lab-requirements.json`
- Modify: `docs/superpowers/registry/oracle-lab-claims.json`
- Modify: `docs/superpowers/registry/oracle-lab-current-observations.json`
- Test: `tests/oracle-lab-phase-1-evidence.test.ts`
- Test: `tests/oracle-lab-phase-1-planning.test.ts`

**Interfaces:**
- Consumes: Task 7 `run-all`, both clean implementation heads, the planning entry/context as provenance, the unexpired execution context/approval receipt as authority, and four selected requirement rows.
- Produces: reviewed code-head results plus a descendant artifact-head handoff, with exact Phase 2 entry conditions.

- [ ] **Step 1: Update CodeGraph and prove both implementation worktrees are clean**

Run `codegraph sync` then `codegraph status` in each implementation worktree. Run `git status --porcelain=v1 --untracked-files=all` in each worktree.

Expected: both CodeGraph statuses are up to date and both Git status outputs are empty. Do not run evidence capture from the operator's original dirty Sub2API main worktree.

- [ ] **Step 2: Execute one atomic H1 capture**

```bash
npm run oracle:phase1 -- run-all --entry docs/superpowers/evidence/phase-1/phase-1-entry-baseline.json --execution-context docs/superpowers/evidence/phase-1/phase-1-execution-context.json --catalog docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json --cc-gateway-root ${CC_GATEWAY_ROOT} --sub2api-root ${SUB2API_ROOT} --baseline-out docs/superpowers/evidence/phase-1/phase-1-exit-baseline.json --results-out docs/superpowers/evidence/phase-1/phase-1-command-results.json
```

Expected: twelve `pass`, two `expected_fail`, zero unexpected statuses, zero unsafe-output flags. The exit baseline records the execution-context digest, exact plan/approval digests, reviewed code heads, clean dirty digests, current CodeGraph digests, unchanged shared contract, parent receipts, selected IDs, and disabled capabilities.

- [ ] **Step 3: Validate captured evidence before changing governance state**

Run: `npm run oracle:phase1 -- validate-results --baseline docs/superpowers/evidence/phase-1/phase-1-exit-baseline.json --catalog docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json --results docs/superpowers/evidence/phase-1/phase-1-command-results.json`

Expected: `{"ok":true}`. If any command is unexpected, leave all four requirement rows deferred.

- [ ] **Step 4: Transition only the four Phase 1 requirement rows**

For `AV-B1-001`, `AV-B2-001`, `AV-B3-001`, and `RA-P0-008`, set the registry's reviewed implemented status, exact implementation/test file arrays, exact verification command IDs, `docs/superpowers/evidence/phase-1/phase-1-command-results.json`, reviewed code heads, and verification timestamp. Leave every other deferred row unchanged.

Add claims only at `local_structural` or `local_observational`. Do not add `upstream_canary_observed` or `provider_internal_confirmed` authority. `RA-P0-008` may become locally implemented only when listener, direct-upstream TLS, and sidecar verification commands are all GREEN; retain `external_network_exposure_policy_enforcement_not_observed` and `real_upstream_certificate_chain_not_observed` as production-authority gaps. Append a new `resolved` event for `RA-CURRENT-008` bound to both `tests/listener-boundary.test.ts` and `tests/upstream-tls-boundary.test.ts`, the sidecar TLS result, their result digests, and the reviewed CC code head; preserve all prior events.

- [ ] **Step 5: Commit results and registry transition as the artifact head**

```bash
git add docs/superpowers/evidence/phase-1/phase-1-exit-baseline.json docs/superpowers/evidence/phase-1/phase-1-command-results.json docs/superpowers/registry/oracle-lab-requirements.json docs/superpowers/registry/oracle-lab-claims.json docs/superpowers/registry/oracle-lab-current-observations.json
git commit -m "docs(oracle): bind Phase 1 results to reviewed code heads"
```

The adapter later verifies this artifact head descends from the reviewed CC code head; the Sub2API reviewed head remains exact.

- [ ] **Step 6: Build deterministic handoff and report**

```bash
npm run oracle:phase1 -- build-handoff --baseline docs/superpowers/evidence/phase-1/phase-1-exit-baseline.json --results docs/superpowers/evidence/phase-1/phase-1-command-results.json --registry docs/superpowers/registry/oracle-lab-requirements.json --claims docs/superpowers/registry/oracle-lab-claims.json --observations docs/superpowers/registry/oracle-lab-current-observations.json --handoff-out docs/superpowers/evidence/phase-1/phase-1-handoff.json --report-out docs/superpowers/evidence/phase-1/phase-1-exit-report.md
```

The handoff contains exactly:

```typescript
export const PHASE2_ENTRY_CONDITIONS = [
  'phase_1_handoff_valid',
  'b1_b3_listener_and_upstream_tls_green_on_integrated_heads',
  'b4_b6_expected_red_preserved_for_phase_4',
  'shared_contract_unchanged_or_reviewed_version_bump',
  'production_and_real_canary_disabled',
  'fresh_phase_2_baseline_context_and_detailed_plan',
  'independent_phase_2_plan_approval',
] as const
```

It expires exactly 24 hours after generation, binds reviewed code heads and the descendant artifact head, and contains only digests, safe command IDs, safe failure names, requirement IDs, and repository-relative paths.

- [ ] **Step 7: Validate final artifacts and rerun governance tests**

Run: `npm run oracle:phase1 -- validate-handoff --handoff docs/superpowers/evidence/phase-1/phase-1-handoff.json --report docs/superpowers/evidence/phase-1/phase-1-exit-report.md`

Run: `npm exec tsx tests/oracle-lab-phase-1-evidence.test.ts`

Run: `npm exec tsx tests/oracle-lab-phase-1-planning.test.ts`

Run: `npm test && npm run build`

Expected: all PASS; handoff/report bytes are a deterministic pair.

- [ ] **Step 8: Perform the final scope and leak audit**

Run: `git diff --check`

Run: `rg -n 'real_canary_user_approved:\s*true|production_upstream_enabled:\s*true|upstream_mode:\s*(real-canary|production)' docs src config*.yaml`

Expected: no newly enabled production/canary value.

Run: `rg -n 'ORACLE[_-]?SECRET[_-]?CANARY|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|Bearer [A-Za-z0-9._~+/-]{4,}|sk-[A-Za-z0-9_-]{8,}' docs/superpowers/evidence/phase-1`

Expected: no matches.

- [ ] **Step 9: Commit the handoff/report and request independent review**

```bash
git add docs/superpowers/evidence/phase-1/phase-1-handoff.json docs/superpowers/evidence/phase-1/phase-1-exit-report.md
git commit -m "docs(oracle): publish Phase 1 handoff"
```

The reviewer must independently check goal coverage, pre-side-effect reservations, authorization ordering, replay behavior, origin trust, observed bind state, code-approved exposure policy, direct and sidecar certificate verification, execution-context/approval binding, B4-B6 preservation, reviewed-head ancestry, registry transitions, secret leakage, and the no-production/no-canary boundary before either PR is merged.

## Final Verification Matrix

| Gate | Required result |
| --- | --- |
| B1 arbitrary/wrong/expired/replay/cross-session/proxy-change corpus | GREEN |
| B1 concurrent public verifier reservation | one proxy observer call; enumeration-resistant duplicate response |
| B2 15-route owner matrix and six independent dimensions | GREEN |
| B2 wrong-state and stale-version ordering | GREEN |
| B2 concurrent same-version side-effect reservation | one dependency call; second request 409 before side effect |
| Session creation idempotency reservation | one proxy creation call per owner/key/request fingerprint |
| Mutation response version continuity | acceptance/healthcheck next action uses latest version |
| B3 Host/forwarded-header mutation corpus | GREEN |
| Listener omitted-host observed bind | `127.0.0.1` |
| Remote-listen prerequisite and approved-policy mutation corpus | GREEN fail-closed |
| Direct upstream HTTPS/system-trust/unsafe-env corpus | GREEN fail-closed; `rejectUnauthorized: true` |
| Sidecar production TLS config | `InsecureSkipVerify == false`; unsafe trust env rejected before listen |
| Execution authorization | exact plan/context/review digests; zero Critical/Important; unexpired |
| Sub2API full Go regression | GREEN |
| Frontend focused tests, typecheck, build | GREEN |
| CC Gateway full tests and build | GREEN |
| Joint local chain | GREEN |
| CC B4-B6 and sidecar B5-B6 | expected RED |
| Shared contract digest | unchanged |
| Production and real canary | disabled |

## Rollback Boundaries

- Sub2API rollback is the ordered revert of Tasks 5, 4, 3, 2, and 1. Do not partially retain the frontend `If-Match` contract after reverting backend version enforcement.
- CC Gateway deployment-boundary rollback is one Task 6 commit, but rolling it back reopens listener and upstream certificate slices of `RA-P0-008` and invalidates the Phase 1 handoff.
- H1 evidence/registry rollback is Task 8 then Task 7. Reverting evidence never claims the implementation itself was reverted.
- Any rollback marks the affected requirement `changed` or `deferred` in a new registry/observation event; prior evidence is retained and never rewritten.

## Self-Review Checklist

- [ ] Every Phase 1 requirement maps to at least one implementation task and one exit command.
- [ ] No implementation or capture can run from the expired planning context without an exact-plan independent approval and fresh execution context.
- [ ] Every external-effect mutation reserves its version before the first dependency call and returns the final version.
- [ ] Session creation reserves a provisional record before proxy creation, and public egress verification reserves before probing the proxy.
- [ ] `RA-P0-008` closure includes approved exposure policy and both direct/sidecar certificate verification without claiming production observation.
- [ ] B4-B6, Phase 2 manifest authority, reverse/oracle capture, profile synthesis, real canary, and production deployment remain out of scope.
- [ ] All named types and function signatures are consistent between backend, handler, frontend, tests, and H1 catalog.
- [ ] No placeholder language or unspecified test command remains.
- [ ] Both repository PRs can be reviewed and reverted independently before the integrated evidence commit.
