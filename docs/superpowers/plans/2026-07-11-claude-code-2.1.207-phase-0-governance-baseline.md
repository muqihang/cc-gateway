# Claude Code 2.1.207 Phase 0 Governance and Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Each task must finish with its own test and evidence checkpoint.

**Goal:** Establish a traceable, reproducible Phase 0 control plane for the Claude Code oracle lab, repair the stale cross-repository baseline dependency, select the Gateway compromise boundary, and create the H0 Harness before any profile promotion or real request.

**Architecture:** CC Gateway owns the cross-repository oracle documents, safe registry, run-manifest tooling, and final transport/profile contract. Sub2API remains the owner of onboarding authorization and formal-pool lifecycle behavior. Phase 0 adds governance and failing security tests, not client-specific profile implementation. The two repositories are frozen independently and joined by an explicit contract path plus digest.

**Tech Stack:** TypeScript/Node.js with `tsx` and the existing CC Gateway test runner; Go 1.26 with the existing Sub2API and sidecar test suites; strict JSON artifacts without a new runtime dependency; CodeGraph for symbol discovery when its repository index is present.

## Global Constraints

- Canonical planning owner: CC Gateway `main`; Sub2API consumes the shared contract and does not duplicate the roadmap.
- Current planning worktree: `/Users/muqihang/chelingxi_workspace/cc-gateway-oracle-phase-0`.
- Read-only Sub2API reconnaissance root: `/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main` at `main@a0c51e3c674c858fb11b09f21d94d72ec909f554`.
- Planned Sub2API Phase 0 implementation worktree after plan approval: `/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-phase-0` on branch `codex/oracle-phase-0-governance`.
- Current CC Gateway planning base: `7827aac`; the parent `main` fast-forward is blocked by the stale contract-fixture baseline failure.
- Precedence: `Hardening Amendments > Adversarial Validation v2 > Oracle Lab Design` until the registry records a consolidated source map.
- Real upstream requests, real credentials, profile promotion, and production deployment are forbidden in Phase 0.
- No raw prompts, bodies, credentials, CCH, ClientHello, account identifiers, proxy credentials, or unrestricted diagnostics may be persisted.
- Every requirement, claim, baseline input, test result, and generated artifact has a stable reference and digest.
- Missing, stale, contradictory, or expired inputs fail closed and are never replaced by guessed defaults.
- Existing user-created untracked files, including `.DS_Store`, are not staged, modified, or deleted.

---

## Phase 0 Exit Contract

Phase 0 is complete only when:

1. The three designs have stable requirement IDs and an explicit precedence/overlay record.
2. Requirement Registry, Claim Matrix, Run Manifest, Context Pack, and Handoff schemas validate.
3. CC Gateway, Sub2API, shared contract, sidecar, package, runtime, and toolchain inputs are frozen with digests.
4. The Gateway compromise boundary is selected in an ADR and required explicitly by formal-pool configuration.
5. The stale Sub2API fixture path is replaced by deterministic contract discovery.
6. B1-B6 each have revalidated source evidence, a named failing test or fixture, and an exact verification command.
7. H0 traceability, baseline, command, context-pack, and handoff tooling passes.
8. A safe exit report and handoff bundle identify remaining gaps and exact Phase 1 entry conditions.

No Phase 1 implementation begins while any exit condition is red.

## Task 1: Reconcile Document Authority and Requirement IDs

**Files:**
- Modify: `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-design.md`
- Modify: `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-adversarial-validation-v2.md`
- Modify: `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md`
- Create: `docs/superpowers/registry/oracle-lab-requirements.json`
- Create: `tools/oracle-lab/validate-requirements.ts`
- Test: `tests/oracle-lab-traceability.test.ts`

**Interfaces:**
- IDs use `OL-*`, `AV-*`, and `HA-*`; IDs do not depend on mutable line numbers.
- Each record contains `requirement_id`, `source_document`, `source_section`, `precedence`, `priority`, `depends_on`, `acceptance_gate`, `implementation_status`, `owner`, `repository`, `implementation_files`, `test_files`, `verification_command`, `evidence_artifact`, `last_verified_commit`, `last_verified_at`, `expiry`, and `known_gaps`.
- `validateRequirements(path: string): ValidationResult` rejects unknown fields, duplicate IDs, missing sections, unresolved dependencies, invalid status transitions, and unowned P0/P1 records.

- [ ] **Step 1: Add registry metadata to the three designs**

Each Status section names `docs/superpowers/registry/oracle-lab-requirements.json`, the precedence rule, and the document's ID prefix.

- [ ] **Step 2: Seed the registry**

Use this exact record shape:

```json
{
  "requirement_id": "HA-P0-001",
  "source_document": "2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md",
  "source_section": "3.1 Requirement Status Registry",
  "precedence": "hardening_amendments",
  "priority": "P0",
  "depends_on": [],
  "acceptance_gate": "phase_0_traceability",
  "implementation_status": "design_only",
  "owner": "cc-gateway-oracle-owner",
  "repository": "cc-gateway",
  "implementation_files": [],
  "test_files": ["tests/oracle-lab-traceability.test.ts"],
  "verification_command": "npm exec tsx tests/oracle-lab-traceability.test.ts",
  "evidence_artifact": "phase-0/traceability.json",
  "last_verified_commit": null,
  "last_verified_at": null,
  "expiry": null,
  "known_gaps": ["registry validator not implemented"]
}
```

- [ ] **Step 3: Write and run the failing registry test**

Test duplicate IDs, invalid precedence, missing sections, invalid status ordering, missing P0/P1 owners, and `production_verified` without an upstream canary dependency.

Run: `npm exec tsx tests/oracle-lab-traceability.test.ts`

Expected: FAIL because the validator is not implemented.

- [ ] **Step 4: Implement and verify the validator**

Run: `npm exec tsx tests/oracle-lab-traceability.test.ts`

Expected: PASS with invalid fixtures rejected and the seeded registry accepted.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs docs/superpowers/registry/oracle-lab-requirements.json tools/oracle-lab/validate-requirements.ts tests/oracle-lab-traceability.test.ts
git commit -m "feat: add oracle lab requirement traceability"
```

## Task 2: Add the Claim Matrix and Authority Rules

**Files:**
- Create: `docs/superpowers/registry/oracle-lab-claims.json`
- Create: `docs/superpowers/schemas/oracle-lab-claim.schema.json`
- Create: `tools/oracle-lab/validate-claims.ts`
- Test: `tests/oracle-lab-claim-matrix.test.ts`

**Interfaces:**
- Claim classes: `local_structural`, `local_observational`, `upstream_canary`, `provider_internal`.
- Authority states: `unverified`, `package_observed`, `local_wire_observed`, `cross_checked`, `gateway_wire_equivalent`, `stateful_behavior_equivalent`, `upstream_canary_observed`, `production_verified`.
- A provider-internal claim remains unknown without authoritative provider disclosure; a local claim cannot imply server acceptance.

- [ ] **Step 1: Write RED claim fixtures**

Include a valid direct-egress structural claim, valid pinned-client observation, invalid provider claim derived from synthetic correlation, and invalid production claim without canary evidence.

Run: `npm exec tsx tests/oracle-lab-claim-matrix.test.ts`

Expected: FAIL because claim validation does not exist.

- [ ] **Step 2: Implement strict claim validation**

Validate class, authority ceiling, evidence scope, server dependency, confidence, contradiction, expiry, and canary linkage.

Run: `npm exec tsx tests/oracle-lab-claim-matrix.test.ts`

Expected: PASS; provider-internal and pre-canary production claims are rejected.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/registry/oracle-lab-claims.json docs/superpowers/schemas/oracle-lab-claim.schema.json tools/oracle-lab/validate-claims.ts tests/oracle-lab-claim-matrix.test.ts
git commit -m "feat: add oracle lab claim authority matrix"
```

## Task 3: Freeze Both Repositories and the Shared Contract

**Files:**
- Create: `docs/superpowers/schemas/oracle-lab-run-manifest.schema.json`
- Create: `tools/oracle-lab/freeze-baseline.ts`
- Test: `tests/oracle-lab-baseline-freeze.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- CLI: `npm exec tsx tools/oracle-lab/freeze-baseline.ts -- --cc-gateway-root "$CC_GATEWAY_ROOT" --sub2api-root "$SUB2API_ROOT" --contract-path "$SUB2API_FORMAL_POOL_CONTRACT_PATH" --out /tmp/oracle-lab-phase-0-baseline.json`.
- Persist commits, dirty-state digests, path categories, package/runtime/tool digests, contract digest, and declared network/sensitivity policy; do not persist machine absolute paths.
- Reject an undeclared dirty tree. `--allow-dirty-digest` is accepted only when its supplied digest exactly matches the computed complete diff digest.

- [ ] **Step 1: Write and run RED baseline tests**

Cover undeclared dirty tree, missing contract, digest mismatch, symlink escape, and a clean two-repository fixture.

Run: `npm exec tsx tests/oracle-lab-baseline-freeze.test.ts`

Expected: FAIL because the baseline tool does not exist.

- [ ] **Step 2: Implement baseline capture and validation**

Capture repository role, HEAD, branch, dirty digest, contract source category/SHA-256, package lock, sidecar source/binary, OS/build/architecture/runtime/CA/tool digests, selected requirements, and policies.

- [ ] **Step 3: Verify and capture the current baseline**

```bash
export CC_GATEWAY_ROOT=/Users/muqihang/chelingxi_workspace/cc-gateway-oracle-phase-0
export SUB2API_ROOT=/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main
export SUB2API_FORMAL_POOL_CONTRACT_PATH=/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json
npm exec tsx tests/oracle-lab-baseline-freeze.test.ts
npm exec tsx tools/oracle-lab/freeze-baseline.ts -- --cc-gateway-root "$CC_GATEWAY_ROOT" --sub2api-root "$SUB2API_ROOT" --contract-path "$SUB2API_FORMAL_POOL_CONTRACT_PATH" --out /tmp/oracle-lab-phase-0-baseline.json
```

Expected: PASS and an entry manifest recording CC Gateway `7827aac`, Sub2API `a0c51e3`, and contract SHA-256 `70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1`. Task 9 creates a separate exit manifest after the phase commits.

- [ ] **Step 4: Commit**

```bash
git add .gitignore docs/superpowers/schemas/oracle-lab-run-manifest.schema.json tools/oracle-lab/freeze-baseline.ts tests/oracle-lab-baseline-freeze.test.ts
git commit -m "feat: add oracle lab baseline freeze manifest"
```

## Task 4: Select and Enforce the Gateway Compromise Boundary

**Files:**
- Create: `docs/superpowers/adr/0001-gateway-compromise-boundary.md`
- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`
- Modify: `docs/superpowers/registry/oracle-lab-requirements.json`

**Decision Gate:** Evaluate `protected_gateway` and `trusted_gateway`. The recommended choice is `protected_gateway`. Formal-pool configuration has no implicit default and must declare one choice.

**Interfaces:**
- Add `shared_pool.gateway_compromise_boundary?: 'protected_gateway' | 'trusted_gateway'`.
- `validateFormalPoolMode` rejects omission or unknown values in formal-pool mode.
- The safe run manifest records the normalized choice.
- Phase 0 does not implement the policy broker; the ADR maps that work to Phase 4 when `protected_gateway` is selected.

- [ ] **Step 1: Write the ADR and RED config tests**

Cover missing, invalid, explicit trusted, and explicit protected values.

Run: `npm exec tsx tests/config.test.ts`

Expected: FAIL because the boundary field and validation do not exist.

- [ ] **Step 2: Implement the normalized config gate**

Update the config type, YAML parsing, validation, and safe summary.

Run: `npm exec tsx tests/config.test.ts`

Expected: PASS with both explicit choices accepted and omission rejected only for formal-pool mode.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/adr/0001-gateway-compromise-boundary.md src/config.ts tests/config.test.ts docs/superpowers/registry/oracle-lab-requirements.json
git commit -m "feat: declare formal-pool gateway compromise boundary"
```

## Task 5: Replace the Stale Shared-Contract Fixture Dependency

**Files:**
- Create: `tools/oracle-lab/resolve-formal-pool-contract.ts`
- Create: `tests/oracle-lab-contract-discovery.test.ts`
- Modify: `tests/egress-tls-sidecar-real.test.ts`
- Modify: `tests/egress-tls-sidecar.test.ts`
- Modify: `tests/proxy-sub2api.test.ts`

**Interfaces:**
- Export `resolveFormalPoolContract(input: { explicitPath?: string; gatewayRoot: string; sub2apiRoot?: string }): { path: string; sourceCategory: 'explicit_env' | 'sibling_main' | 'declared_root'; digest: string }`.
- Resolution order is `SUB2API_FORMAL_POOL_CONTRACT_PATH`, then a declared `SUB2API_ROOT`, then the deterministic sibling main repository only when its current checkout is `main` and the contract exists.
- Reject feature-worktree paths, stale branch names, missing files, symlinks escaping the declared root, and digest changes during one process.
- The helper returns the parsed fixture plus source category; no test contains a machine-specific feature-worktree path.

- [ ] **Step 1: Write and run RED discovery tests**

Cover explicit override, current Sub2API main fallback, missing root, stale feature-worktree rejection, symlink escape rejection, digest mismatch, and source-category reporting.

Run: `npm exec tsx tests/egress-tls-sidecar-real.test.ts && npm exec tsx tests/oracle-lab-contract-discovery.test.ts`

Expected: the existing real sidecar test fails with `ENOENT` for `claude-platform-aws-formal-pool`; the new discovery test fails because the resolver does not exist.

- [ ] **Step 2: Implement the resolver and migrate the three test families**

Remove the four stale constants from the three named test files. Resolve once at test startup, assert the returned digest/source category, and pass the parsed fixture to existing helpers.

- [ ] **Step 3: Verify the focused tests**

Run: `SUB2API_FORMAL_POOL_CONTRACT_PATH=/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json npm exec tsx tests/oracle-lab-contract-discovery.test.ts && SUB2API_FORMAL_POOL_CONTRACT_PATH=/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json npm exec tsx tests/egress-tls-sidecar.test.ts && SUB2API_FORMAL_POOL_CONTRACT_PATH=/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json npm exec tsx tests/egress-tls-sidecar-real.test.ts`

Expected: all three pass while remaining local-only.

- [ ] **Step 4: Verify the Sub2API fixture**

Run from `/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/backend`: `go test ./internal/service -run 'FormalPool|ClaudeCode|Contract' -count=1`.

Expected: PASS against `backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json`.

- [ ] **Step 5: Commit**

Run: `git add tools/oracle-lab/resolve-formal-pool-contract.ts tests/oracle-lab-contract-discovery.test.ts tests/egress-tls-sidecar-real.test.ts tests/egress-tls-sidecar.test.ts tests/proxy-sub2api.test.ts && git commit -m "fix: resolve formal-pool contract from declared repository"`

## Task 6: Add B1-B3 Revalidation and RED Security Tests

**Files:**
- Create: `/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-phase-0/backend/internal/service/formal_pool_onboarding_phase0_red_test.go`
- Create: `/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-phase-0/backend/internal/server/routes/formal_pool_onboarding_phase0_red_test.go`
- Modify: `docs/superpowers/registry/oracle-lab-requirements.json`

**Interfaces and RED expectations:**
- B1 `AttestBrowserEgress` must require a server-generated, session-bound, single-use proof or completed server-side egress observation. The current non-empty `verification_code` behavior is at `formal_pool_onboarding_service.go:663`.
- B2 every session operation must receive authenticated principal context and enforce principal, tenant, group, creator, role, object ownership, current state, and expected version.
- B3 `withAbsoluteBrowserEgressURL` must use an explicit configured public origin or trusted-ingress forwarded-header policy. The existing forwarded-host test is the RED regression.

- [ ] **Step 1: Add B1 failing service tests**

Add arbitrary non-empty, wrong, expired, replayed, cross-session, and post-proxy-change code cases.

Run from `/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-phase-0/backend`: `go test -tags=phase0red ./internal/service -run 'Test.*Browser.*Attest|Test.*Egress.*Attest' -count=1`.

Expected: the arbitrary non-empty code case fails against the current implementation; unsupported proof cases are recorded as explicit RED coverage rather than skipped.

- [ ] **Step 2: Add B2 failing authorization tests**

Create two principals, groups, and tenants. Attempt cross-boundary reads/writes for `GetSession`, `TestProxy`, browser attestation, OAuth generation/exchange, healthcheck, activation, and promotion.

Run from `/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-phase-0/backend`: `go test -tags=phase0red ./internal/service ./internal/server/routes -run 'FormalPoolOnboarding|FormalPoolOperations' -count=1`.

Expected: at least one random-ID-only access path fails the cross-boundary assertion.

- [ ] **Step 3: Convert B3 forwarded-origin behavior into a RED security test**

Keep a positive configured-origin test. Add hostile `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto` values and assert they cannot change the browser URL.

- [ ] **Step 4: Record provenance and commit the RED fixtures**

Each B1-B3 record includes repository, commit, symbol, test name, observed date, failure digest, and `implementation_status: failing_test_added`. The RED files carry `//go:build phase0red`, so the normal backend suite remains green while the explicit revalidation suite records the known failures. The Sub2API implementation/test commit is created only in its Phase 0 worktree after this plan passes review.

- [ ] **Step 5: Commit the Sub2API RED fixtures**

Run from the Sub2API Phase 0 worktree: `git add backend/internal/service/formal_pool_onboarding_phase0_red_test.go backend/internal/server/routes/formal_pool_onboarding_phase0_red_test.go && git commit -m "test: revalidate onboarding authorization boundaries"`.

## Task 7: Add B4-B6 Revalidation and RED Sidecar Tests

**Files:**
- Create: `tests/red/phase0-boundary.red.test.ts`
- Create: `sidecar/egress-tls-sidecar/internal/control/phase0_red_test.go`
- Create: `sidecar/egress-tls-sidecar/internal/server/phase0_red_test.go`
- Modify: `docs/superpowers/registry/oracle-lab-requirements.json`

**Interfaces and RED expectations:**
- B4 formal-pool requests deny before DNS/socket creation unless context, proxy, sidecar, manifest, and account identity are present.
- B5 sidecar authentication must bind complete control, final headers/body hashes, nonce/timestamp, profile, target, route, method, proxy identity, and expected summary. Current `computeProxyBinding` plus JSON `x-cc-egress-control` is incomplete.
- B6 proxy destination policy must normalize addresses, reject unsafe ranges, pin resolution, and reject redirects/alternate dial targets. Current TypeScript/Go URL checks are primarily syntax checks.

- [ ] **Step 1: Add B4 pre-socket RED tests**

Use a fake DNS/socket observer for missing sidecar, missing context, mismatched generations, disabled profile, unknown manifest authority, and direct fallback configuration.

Run: `npm exec tsx tests/red/phase0-boundary.red.test.ts`.

Expected: missing manifest/generation cases remain RED until the Phase 2 contract exists and are listed as explicit findings.

- [ ] **Step 2: Add B5 mutation/replay RED tests**

Mutate fields, duplicate/reorder JSON keys, alter Unicode escaping, change final hashes, replay after completion/restart, and replay against a second replica. Add equivalent Go control/server tests.

Run: `npm exec tsx tests/red/phase0-boundary.red.test.ts && (cd sidecar/egress-tls-sidecar && go test -tags=phase0red ./internal/control ./internal/server -count=1)`.

Expected: current partial-binding and restart-replay gaps are visible as deterministic failures.

- [ ] **Step 3: Add B6 proxy-policy RED tests**

Cover loopback, link-local, multicast, unspecified, metadata, private-range policy, IPv4-mapped IPv6, unusual IPv6, DNS rebinding, redirect, nested proxy, and scheme confusion.

- [ ] **Step 4: Record provenance and commit**

Update the registry with exact symbols, test names, failure digests, and the selected compromise-boundary dependency.

Run: `git add tests/red/phase0-boundary.red.test.ts sidecar/egress-tls-sidecar/internal/control/phase0_red_test.go sidecar/egress-tls-sidecar/internal/server/phase0_red_test.go docs/superpowers/registry/oracle-lab-requirements.json && git commit -m "test: revalidate formal-pool sidecar and proxy boundaries"`.

## Task 8: Build the H0 Harness

**Files:**
- Create: `tools/oracle-lab/validate-run-manifest.ts`
- Create: `tools/oracle-lab/build-context-pack.ts`
- Create: `tools/oracle-lab/build-handoff-bundle.ts`
- Create: `tests/oracle-lab-harness.test.ts`
- Create: `docs/superpowers/schemas/oracle-lab-handoff.schema.json`
- Modify: `package.json`

**Interfaces:**
- `npm run oracle:validate -- --registry docs/superpowers/registry/oracle-lab-requirements.json --claims docs/superpowers/registry/oracle-lab-claims.json --manifest /tmp/oracle-lab-phase-0-baseline.json`.
- `npm run oracle:context -- --requirement HA-P0-001 --requirement HA-P0-002 --out /tmp/oracle-lab-context-pack.json`.
- `npm run oracle:handoff -- --phase phase-0 --baseline /tmp/oracle-lab-phase-0-baseline.json --out /tmp/oracle-lab-phase-0-handoff.json`.
- Packs contain approved files/symbols, line references, requirement records, and test status; they exclude raw secrets and unrestricted logs.

- [ ] **Step 1: Write and run H0 RED tests**

Reject missing repository digests, unknown requirements, artifacts outside the evidence root, incomplete handoffs, and raw secret canaries in safe artifacts.

Run: `npm exec tsx tests/oracle-lab-harness.test.ts`.

Expected: FAIL because the H0 commands and handoff schema do not exist.

- [ ] **Step 2: Implement and verify H0**

Add the three scripts and package commands without a new runtime dependency. All commands return `0` only when every referenced artifact and requirement validates.

Run: `npm exec tsx tests/oracle-lab-harness.test.ts`.

Expected: PASS with invalid packs rejected and a valid pack/handoff generated twice with identical canonical digests.

- [ ] **Step 3: Commit**

Run: `git add tools/oracle-lab tests/oracle-lab-harness.test.ts docs/superpowers/schemas/oracle-lab-handoff.schema.json package.json && git commit -m "feat: add oracle lab phase handoff harness"`.

## Task 9: Generate the Phase 0 Exit Report and Handoff Bundle

**Files:**
- Create: `docs/superpowers/evidence/phase-0/phase-0-exit-report.md`
- Create: `docs/superpowers/evidence/phase-0/phase-0-handoff.json`
- Modify: `docs/superpowers/registry/oracle-lab-requirements.json`
- Modify: `docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md`

**Interfaces:**
- The report separates observed facts, local inferences, provider-internal unknowns, RED findings, disabled capabilities, and exact command results.
- The handoff contains safe digests and references only.
- The roadmap marks Phase 0 complete only if every exit condition is green; otherwise it records `blocked_by_baseline` with the failure digest.

- [ ] **Step 1: Run the Phase 0 command set**

Run: `npm run build && npm test && (cd sidecar/egress-tls-sidecar && go test ./...)`.

Run from `/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-phase-0/backend`: `go test ./internal/service ./internal/server/routes ./internal/handler/admin -count=1`.

Run the explicit RED suites and capture their expected non-zero results: `npm exec tsx tests/red/phase0-boundary.red.test.ts; (cd sidecar/egress-tls-sidecar && go test -tags=phase0red ./internal/control ./internal/server -count=1); (cd /Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-phase-0/backend && go test -tags=phase0red ./internal/service ./internal/server/routes -count=1)`.

Expected: the stale contract path failure is gone; normal H0/governance suites are green; explicit `phase0red` suites remain expected RED and are listed as `failing_test_added` until their implementation phases.

- [ ] **Step 2: Generate and validate the safe report/handoff**

Run: `npm run oracle:validate -- --registry docs/superpowers/registry/oracle-lab-requirements.json --claims docs/superpowers/registry/oracle-lab-claims.json --manifest /tmp/oracle-lab-phase-0-baseline.json`.

Run: `npm run oracle:handoff -- --phase phase-0 --baseline /tmp/oracle-lab-phase-0-baseline.json --out /tmp/oracle-lab-phase-0-handoff.json`.

Expected: deterministic outputs with no raw material and populated Phase 1 entry conditions.

- [ ] **Step 3: Update statuses and commit**

Mark governance controls `locally_verified`, keep B1-B6 `failing_test_added`, record expiry/known gaps, and commit the safe report/handoff.

Run: `git add docs/superpowers/evidence/phase-0 docs/superpowers/registry/oracle-lab-requirements.json docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md && git commit -m "docs: record oracle lab phase 0 handoff"`.

## Review and Handoff

Before Phase 1 planning:

1. Requirements review checks that every Phase 0 requirement maps to a registry record, source section, file, test, command, and exit result.
2. Security review checks the authority boundary, stale-path repair, B1-B6 RED tests, artifact redaction, and claim matrix for overstatement.
3. The next plan is written only from the committed handoff bundle and fresh repository heads.

## Plan Self-Review Checklist

- [ ] Every task names exact files, tests, commands, expected failure, expected pass, and commit boundary.
- [ ] No task assumes the old `claude-platform-aws-formal-pool` worktree exists.
- [ ] No task silently chooses Protected-Gateway or Trusted-Gateway; Task 4 records the decision before dependent implementation.
- [ ] No provider-internal or long-term account-safety claim is promoted by Phase 0.
- [ ] H0 artifacts are deterministic, safe, scoped, and reproducible after context compaction.
- [ ] Any red test is listed in the exit report with its exact failure digest rather than hidden or skipped.
