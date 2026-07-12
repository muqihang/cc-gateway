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
- Current CC Gateway planning base: `7827aac`; the parent `main` fast-forward is held by a release/process gate because the baseline test suite currently has a stale contract-fixture failure.
- Precedence: `Hardening Amendments > Adversarial Validation v2 > Oracle Lab Design` until the registry records a consolidated source map.
- Real upstream requests, real credentials, profile promotion, and production deployment are forbidden in Phase 0.
- No raw prompts, bodies, credentials, CCH, ClientHello, account identifiers, proxy credentials, or unrestricted diagnostics may be persisted.
- Every requirement, claim, baseline input, test result, and generated artifact has a stable reference and digest.
- Missing, stale, contradictory, or expired inputs fail closed and are never replaced by guessed defaults.
- Existing user-created untracked files, including `.DS_Store`, are not staged, modified, or deleted.
- Every JSON schema carries `schema_version`, `compatibility_policy`, `retention_class`, `redaction_policy`, and `destruction_procedure`.

## Task Metadata and Execution Order

Execute tasks in this order: `Task 0 -> Task 0.5 -> Task 1 -> Task 2 -> Task 4 -> Task 5 -> Task 6 -> Task 7 -> Task 8 -> Task 9`.

| Task | Requirement IDs | Owner | Depends on | Rollback |
| --- | --- | --- | --- | --- |
| 0 | `HA-P0-000` | release-engineering | none | remove only the newly registered Phase 0 worktree after explicit approval |
| 0.5 | `HA-P0-004`, `OL-LEGACY-001` | cc-gateway-oracle-owner | Task 0 | mark the phase blocked and retain the bootstrap commit plus durable entry artifact for audit; no history rewrite |
| 1 | `HA-P0-001`, `HA-P0-002`, `HA-P0-009`, `HA-P1-001`-`HA-P1-006` | cc-gateway-oracle-owner | Task 0.5 | revert the task commit; keep source documents intact |
| 2 | `HA-P0-003` | cc-gateway-oracle-owner | Task 1 | revert claim registry/validator commit |
| 4 | `HA-P0-005` | cc-gateway-oracle-owner and release-approver | Task 1, Task 2 | disable formal-pool mode when the boundary is missing or unsupported |
| 5 | `HA-P0-006` | cc-gateway-oracle-owner | Task 0.5 | restore only the test fixture references; never restore stale paths |
| 6 | `AV-B1-001`, `AV-B2-001`, `AV-B3-001` | sub2api-formal-pool-owner | Task 0, Task 1 | remove only the phase0red test commit |
| 7 | `AV-B4-001`, `AV-B5-001`, `AV-B6-001` | cc-gateway-oracle-owner and sidecar-owner | Task 1, Task 2 | remove only the phase0red test commit; keep baseline resolver |
| 8 | `HA-P0-007` | cc-gateway-oracle-owner | Task 1, Task 2, Task 0.5 | disable H0 commands; retain safe registry artifacts |
| 9 | `HA-P0-008` | cc-gateway-oracle-owner and security-reviewer | all prior tasks | mark roadmap `blocked_by_baseline`; do not promote or deploy |

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

## Task 0: Create the Sub2API Phase 0 Worktree and Verify Its Baseline

**Files:**
- Git worktree only: `/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-phase-0`

**Interfaces:**
- Branch: `codex/oracle-phase-0-governance` from Sub2API `main@a0c51e3c674c858fb11b09f21d94d72ec909f554`.
- The worktree must be created only after this plan is approved and only after `.worktrees/` passes `git check-ignore`.

- [ ] **Step 1: Verify ignored worktree directory**

Run from `/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main`: `git check-ignore -q .worktrees`.

Expected: exit code `0`; do not edit `.gitignore` because the directory is already ignored.

- [ ] **Step 2: Create the worktree**

Run from `/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main`: `git worktree add .worktrees/oracle-phase-0 -b codex/oracle-phase-0-governance a0c51e3c674c858fb11b09f21d94d72ec909f554`.

Expected: the new worktree is registered at the declared path and has the declared branch/HEAD.

- [ ] **Step 3: Install and run the baseline**

Run from `/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-phase-0/backend`: `go mod download`.

Run separately: `go test ./internal/service ./internal/server/routes ./internal/handler/admin -count=1`.

Expected: dependencies resolve and the targeted baseline either passes or produces a recorded pre-existing failure; no implementation proceeds on an unexplained failure.

## Task 1: Reconcile Document Authority and Requirement IDs

**Files:**
- Modify: `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-design.md`
- Modify: `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-adversarial-validation-v2.md`
- Modify: `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md`
- Create: `docs/superpowers/registry/oracle-lab-requirements.json`
- Create: `docs/superpowers/schemas/oracle-lab-requirement.schema.json`
- Create: `tools/oracle-lab/validate-requirements.ts`
- Test: `tests/oracle-lab-traceability.test.ts`

**Interfaces:**
- IDs use `OL-*`, `AV-*`, and `HA-*`; IDs do not depend on mutable line numbers.
- Each record contains `requirement_id`, `source_document`, `source_section`, `precedence`, `priority`, `depends_on`, `acceptance_gate`, `implementation_status`, `owner`, `repository`, `implementation_files`, `test_files`, `verification_command`, `evidence_artifact`, `last_verified_commit`, `last_verified_at`, `expiry`, `known_gaps`, `canary_evidence_ids`, `production_gate_ids`, `rollback_evidence_ids`, `deployed_artifacts`, and `contradiction_ids`.
- `implementation_status` is exactly `design_only | deferred | failing_test_added | locally_verified | upstream_canary_observed | production_verified | blocked_by_baseline`.
- The production-only fields are exact: `canary_evidence_ids`, `production_gate_ids`, `rollback_evidence_ids`, and `contradiction_ids` are `string[]`; `deployed_artifacts` is `Array<{ repository: string; commit: string; config_digest: string; manifest_digest: string; deployed_at: string }>`; `expiry` is an ISO-8601 timestamp or `null`. Non-production records carry empty arrays, never omit the fields.
- `validateRequirements(path: string): ValidationResult` rejects unknown fields, duplicate IDs, missing sections, unresolved dependencies, invalid status transitions, and unowned P0/P1 records.
- `ValidationResult` is exactly `{ ok: true; errors: [] } | { ok: false; errors: Array<{ code: string; path: string; message: string }> }`.

- [ ] **Step 1: Add registry metadata to the three designs**

Each Status section names `docs/superpowers/registry/oracle-lab-requirements.json`, the precedence rule, and the document's ID prefix. Inventory every P0/P1 normative group in the three documents, including all IDs in the Task Metadata table, `OL-LEGACY-001`, and every Phase 0 exit gate; the single example record below is the required shape, not the complete inventory.

The complete Phase 0 P0/P1 inventory is fixed before implementation:

| Requirement ID | Canonical source section |
| --- | --- |
| `HA-P0-000` | Adversarial Validation `WP0. Baseline and Contract Discovery` plus Design `Phase 0: Restore Trustworthy Baselines` |
| `HA-P0-001` | Hardening Amendments `3.1 Requirement Status Registry` |
| `HA-P0-002` | Hardening Amendments `3. Normative Status and Traceability` |
| `HA-P0-003` | Hardening Amendments `3.3 Claim Matrix` |
| `HA-P0-004` | Hardening Amendments `3.2 Baseline Freeze Record` |
| `HA-P0-005` | Hardening Amendments `4. Required Architecture Decision: Gateway Compromise Boundary` |
| `HA-P0-006` | Design `9. Shared Contract Discovery` plus Adversarial Validation `WP0. Baseline and Contract Discovery` |
| `HA-P0-007` | Hardening Amendments `16. Required Deliverables` for the H0 traceability/context/command harness |
| `HA-P0-008` | Hardening Amendments `18. Acceptance Criteria for This Amendment` plus Design `Validation Gates` |
| `HA-P0-009` | Hardening Amendments `15. Priority 0`, item 4; Design `Normative Compatibility Contract`; Adversarial Validation `WP0.5. Normative Compatibility Contract` |
| `OL-LEGACY-001` | Design `Reset of Trust` and `Normative Compatibility Contract` for the comparison-only 2.1.197 tuple |
| `AV-B1-001` | Adversarial Validation `B1. Browser Egress Attestation Bypass` |
| `AV-B2-001` | Adversarial Validation `B2. Onboarding Object Authorization` |
| `AV-B3-001` | Adversarial Validation `B3. Forwarded-Header and Public-Origin Authority` |
| `AV-B4-001` | Adversarial Validation `B4. Formal-Pool Direct-Egress Elimination` |
| `AV-B5-001` | Adversarial Validation `B5. Sidecar Request Authentication v2` |
| `AV-B6-001` | Adversarial Validation `B6. Proxy Destination Policy` |
| `HA-P1-001` | Hardening Amendments `5.1 Key Control-Flow Recovery` and `5.2 Selective Dynamic Instrumentation` |
| `HA-P1-002` | Hardening Amendments `5.6 Long-Duration and Lifecycle Runs` and `5.9 Stability Convergence Instead of Three Runs` |
| `HA-P1-003` | Hardening Amendments `6.1 Safe Error Classifier` |
| `HA-P1-004` | Hardening Amendments `7.1 Proxy Identity Contract` and `7.2 Transport-Cell Resource Model` |
| `HA-P1-005` | Hardening Amendments `7.3 Rotation and Drain State Machine`, `7.4 Restart Recovery`, `8.1 Fail-Closed Backpressure`, and `8.2 Replay-Ledger Partition Semantics` |
| `HA-P1-006` | Hardening Amendments `8.3 Complete Authorization Matrix` and `8.4 Operator and Administrator Threats` |

`HA-P0-009` is registered in Phase 0 as `deferred` to the compatibility-contract phase with negative capabilities disabled by default. `HA-P1-001`-`HA-P1-006` are registered as later-phase `deferred` inputs with owners, dependencies, target acceptance gates, and prohibited promotion states; Phase 0 does not implement them. No additional Phase 0 P0/P1 ID is invented during implementation. A newly discovered normative requirement requires a plan amendment, source-section mapping, owner, dependency, rollback, and review before it enters the registry.

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
  "known_gaps": ["registry validator not implemented"],
  "canary_evidence_ids": [],
  "production_gate_ids": [],
  "rollback_evidence_ids": [],
  "deployed_artifacts": [],
  "contradiction_ids": []
}
```

- [ ] **Step 3: Write and run the failing registry test**

Test duplicate IDs, invalid precedence, missing sections, invalid status ordering, missing P0/P1 owners, omitted production-only fields, non-empty production fields on a non-production record, and `production_verified` without all of: `canary_evidence_ids`, `production_gate_ids`, `rollback_evidence_ids`, current `deployed_artifacts`, non-expired `expiry`, and an empty `contradiction_ids`. Include one fully populated valid `production_verified` fixture so the state is representable, not merely rejected.

Run: `npm exec tsx tests/oracle-lab-traceability.test.ts`

Expected: FAIL because the validator is not implemented.

- [ ] **Step 4: Implement and verify the validator**

Run: `npm exec tsx tests/oracle-lab-traceability.test.ts`

Expected: PASS with invalid fixtures rejected and the seeded registry accepted.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs docs/superpowers/registry/oracle-lab-requirements.json docs/superpowers/schemas/oracle-lab-requirement.schema.json tools/oracle-lab/validate-requirements.ts tests/oracle-lab-traceability.test.ts
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
- `validateClaims(path: string, requirements: RequirementRecord[]): ValidationResult` uses the same structured error type as Task 1.
- A `production_verified` claim requires `upstream_canary_observed`, all production gate IDs, rollback evidence, deployed code/config/manifest digests, non-expired evidence, and no unresolved contradiction.

- [ ] **Step 1: Write RED claim fixtures**

Include a valid direct-egress structural claim, valid pinned-client observation, invalid provider claim derived from synthetic correlation, and invalid production claim without canary evidence.

Run: `npm exec tsx tests/oracle-lab-claim-matrix.test.ts`

Expected: FAIL because claim validation does not exist.

- [ ] **Step 2: Implement strict claim validation**

Implement strict enum parsing and validate class, authority ceiling, evidence scope, server dependency, confidence, contradiction, expiry, canary linkage, deployed digests, rollback evidence, and production-gate references.

Run: `npm exec tsx tests/oracle-lab-claim-matrix.test.ts`

Expected: PASS; provider-internal and pre-canary production claims are rejected.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/registry/oracle-lab-claims.json docs/superpowers/schemas/oracle-lab-claim.schema.json tools/oracle-lab/validate-claims.ts tests/oracle-lab-claim-matrix.test.ts
git commit -m "feat: add oracle lab claim authority matrix"
```

## Task 0.5: Capture the Immutable Entry Baseline

This task runs immediately after Task 0 and before Task 1. It provides the actual Phase 0 entry snapshot; Task 9 creates a separate exit snapshot.

**Files:**
- Create: `docs/superpowers/schemas/oracle-lab-run-manifest.schema.json`
- Create: `tools/oracle-lab/freeze-baseline.ts`
- Test: `tests/oracle-lab-baseline-freeze.test.ts`
- Create: `docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json`
- Create: `docs/superpowers/evidence/phase-0/phase-0-entry-baseline.receipt.json`
- Modify: `.gitignore`

**Interfaces:**
- CLI: `npm exec tsx tools/oracle-lab/freeze-baseline.ts -- --cc-gateway-root "$CC_GATEWAY_ROOT" --sub2api-root "$SUB2API_ROOT" --contract-path "$SUB2API_FORMAL_POOL_CONTRACT_PATH" --approved-tool-head "$BOOTSTRAP_HEAD" --out docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json --receipt docs/superpowers/evidence/phase-0/phase-0-entry-baseline.receipt.json`.
- Persist commits, dirty-state digests, path categories, package/runtime/tool digests, contract digest, declared network/sensitivity policy, persona/request-shape/CCH/TLS registry digests, manifest/root metadata digests or explicit absence markers, CodeGraph index digest/fallback reason, and observer/parser/canonicalizer digests; do not persist machine absolute paths.
- Because Task 0.5 precedes Tasks 1-2, the entry manifest records requirement/claim registries as explicit `absent_pre_governance_bootstrap` markers. The exit manifest requires their real digests; silent omission is invalid in either phase.
- Reject an undeclared dirty tree. `--allow-dirty-digest` is accepted only when its supplied digest exactly matches the computed complete diff digest.
- Parse `git status --porcelain=v1 -z --untracked-files=all` into records before sorting. Preserve rename/copy source-destination pairs as one record; retain repository-relative path bytes and encode them as base64url in JSON; record status, object type, executable/file mode, symlink target digest, regular-file content digest, deletion marker, and submodule HEAD/dirty state. Serialize each length-prefixed field in a documented binary record format, sort complete records by destination-path bytes then source-path bytes, and hash the concatenation plus `git diff --binary HEAD`. Ignored files are excluded and every exclusion rule is recorded.
- Freeze the current `2.1.197` persona/request/CCH/TLS tuple as `unverified_legacy` comparison-only evidence under requirement `OL-LEGACY-001`; it cannot be selected for promotion.
- The bootstrap validator and baseline tool are committed before capture. `BOOTSTRAP_HEAD` is the reviewed CC Gateway commit containing only the plan-approved schema/tool/test bootstrap; implementation work begins only after the entry artifact is committed.
- The entry manifest records `approved_tool_head` and both repository heads. A separate entry receipt records the manifest digest, schema digest, and bootstrap commit, avoiding an impossible self-digest. The tracked manifest plus receipt are the durable source for all later parent references; `/tmp` is permitted only for transient command output.

- [ ] **Step 1: Write and run RED baseline tests**

Cover undeclared tracked and untracked changes, submodule drift, missing contract, digest mismatch, symlink escape, invalid registry/claim absence markers, CodeGraph absence/fallback, and a clean two-repository fixture.

Run: `npm exec tsx tests/oracle-lab-baseline-freeze.test.ts`

Expected: FAIL because the baseline tool does not exist.

- [ ] **Step 2: Implement baseline capture and validation**

Implement the exact canonical dirty-state algorithm above. Hash `src/persona-registry.ts`, `src/persona-resolver.ts`, `src/policy.ts`, `src/egress-tls-profile.ts`, relevant CCH sections in `src/proxy.ts`, the sidecar profile/summary sources, current manifest/root files or absence markers, `tools/claude-*`, parser/canonicalizer modules, package locks, and CodeGraph index metadata.

- [ ] **Step 3: Commit the bootstrap tool before freezing**

Run: `git add .gitignore docs/superpowers/schemas/oracle-lab-run-manifest.schema.json tools/oracle-lab/freeze-baseline.ts tests/oracle-lab-baseline-freeze.test.ts && git commit -m "feat: bootstrap oracle lab baseline freeze"`.

Record the resulting CC Gateway commit as `BOOTSTRAP_HEAD`. This commit is the only allowed dirty-state transition before entry capture; the Sub2API Phase 0 worktree must remain at its declared clean baseline.

- [ ] **Step 4: Verify and capture the current baseline**

```bash
export CC_GATEWAY_ROOT=/Users/muqihang/chelingxi_workspace/cc-gateway-oracle-phase-0
export SUB2API_ROOT=/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-phase-0
export SUB2API_FORMAL_POOL_CONTRACT_PATH=/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-phase-0/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json
npm exec tsx tests/oracle-lab-baseline-freeze.test.ts
npm exec tsx tools/oracle-lab/freeze-baseline.ts -- --cc-gateway-root "$CC_GATEWAY_ROOT" --sub2api-root "$SUB2API_ROOT" --contract-path "$SUB2API_FORMAL_POOL_CONTRACT_PATH" --approved-tool-head "$BOOTSTRAP_HEAD" --out docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json --receipt docs/superpowers/evidence/phase-0/phase-0-entry-baseline.receipt.json
```

Expected: PASS and an immutable entry manifest recording `BOOTSTRAP_HEAD`, Sub2API `a0c51e3`, contract SHA-256 `70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1`, the `unverified_legacy` tuple, and every required dependency digest. The artifact is committed before Task 1 and its digest is the only accepted entry parent reference.

- [ ] **Step 5: Commit the durable entry artifact**

```bash
git add docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json docs/superpowers/evidence/phase-0/phase-0-entry-baseline.receipt.json
git commit -m "docs: freeze oracle lab phase 0 entry baseline"
```

## Task 4: Select and Enforce the Gateway Compromise Boundary

**Files:**
- Create: `docs/superpowers/adr/0001-gateway-compromise-boundary.md`
- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`
- Modify: `config.sub2api.formal-pool.example.yaml`
- Modify: `docs/formal-pool-sub2api-safety.md`
- Modify: `tests/formal-pool-safety-doc.test.ts`
- Modify: `docs/superpowers/registry/oracle-lab-requirements.json`

**Decision Gate:** Evaluate `protected_gateway` and `trusted_gateway`. The recommended choice is `protected_gateway`. Formal-pool configuration has no implicit default and must declare one choice.

**Interfaces:**
- Add `shared_pool.gateway_compromise_boundary?: 'protected_gateway' | 'trusted_gateway'`.
- `validateFormalPoolMode` rejects omission or unknown values in formal-pool mode.
- The safe run manifest records the normalized choice.
- `protected_gateway` is accepted only for local-capture/preflight in Phase 0. Any production or real-canary mode with `protected_gateway` fails closed with `protected_gateway_authority_unavailable` until the Phase 4 policy broker is locally verified. This is a deferred capability gate, not a Phase 0 completion blocker: Phase 0 may complete with production disabled and the Phase 4 broker recorded as a mandatory later gate.
- `trusted_gateway` is the only Phase 0 production-compatible choice and the ADR/config/docs must state that a compromised Gateway is outside the sidecar prevention boundary.
- The example config and operator safety document use an explicit boundary value and state the limitation; no implicit default is introduced.

- [ ] **Step 1: Write the ADR and RED config tests**

Cover missing, invalid, explicit trusted, explicit protected local-capture, protected production rejection, and safe-document/config-example consistency.

Run: `npm exec tsx tests/config.test.ts`

Expected: FAIL because the boundary field and validation do not exist.

- [ ] **Step 2: Implement the normalized config gate**

Update the config type, YAML parsing, validation, and safe summary.

Run: `npm exec tsx tests/config.test.ts`

Expected: PASS with explicit trusted production accepted, protected local-capture accepted, protected production rejected, and omission rejected in formal-pool mode.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/adr/0001-gateway-compromise-boundary.md src/config.ts tests/config.test.ts config.sub2api.formal-pool.example.yaml docs/formal-pool-sub2api-safety.md tests/formal-pool-safety-doc.test.ts docs/superpowers/registry/oracle-lab-requirements.json
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
- Export `resolveFormalPoolContract(input: { explicitPath?: string; gatewayRoot: string; sub2apiRoot?: string; manifestPath?: string; expectedBranch?: string; expectedHead?: string; expectedDigest?: string }): { path: string; sourceCategory: 'explicit_env' | 'sibling_main' | 'declared_root' | 'declared_worktree'; digest: string; fixture: SharedContractFixture }`.
- Resolution order is `SUB2API_FORMAL_POOL_CONTRACT_PATH`, then a declared `SUB2API_ROOT`, then the deterministic sibling main repository only when its current checkout is `main` and the contract exists.
- Accept an explicitly declared worktree only when `sub2apiRoot` is explicit and `manifestPath` points to the committed entry/exit manifest whose Sub2API role, path category, HEAD, branch, and contract digest match the realpath and repository state. Exact `expectedBranch`, `expectedHead`, and `expectedDigest` may tighten but never weaken the manifest. Reject undeclared or stale feature worktrees, missing manifest input, missing files, symlinks escaping the root, and digest changes during one process.
- `SharedContractFixture` is the exact union of fields already consumed by the three migrated tests: `materials`, `account`, `client_input`, `valid_context`, and optional `cases`.

- [ ] **Step 1: Write and run RED discovery tests**

Cover explicit override, current Sub2API main fallback, missing root, stale feature-worktree rejection, symlink escape rejection, digest mismatch, and source-category reporting.

Run: `npm exec tsx tests/egress-tls-sidecar-real.test.ts`.

Run separately: `npm exec tsx tests/oracle-lab-contract-discovery.test.ts`.

Expected: the existing real sidecar test fails with `ENOENT` for `claude-platform-aws-formal-pool`; the new discovery test fails because the resolver does not exist.

- [ ] **Step 2: Implement the resolver and migrate the three test families**

Remove the four stale constants from the three named test files. Resolve once at test startup, assert the returned digest/source category, and pass the parsed fixture to existing helpers.

- [ ] **Step 3: Verify the focused tests**

Run: `SUB2API_ROOT=/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-phase-0 ORACLE_LAB_MANIFEST_PATH=docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json SUB2API_FORMAL_POOL_CONTRACT_PATH=/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-phase-0/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json npm exec tsx tests/oracle-lab-contract-discovery.test.ts`.

Run separately with the same `SUB2API_ROOT`, `ORACLE_LAB_MANIFEST_PATH`, and `SUB2API_FORMAL_POOL_CONTRACT_PATH`: `npm exec tsx tests/proxy-sub2api.test.ts`.

Run separately with the same declared environment: `npm exec tsx tests/egress-tls-sidecar.test.ts`.

Run separately with the same declared environment: `npm exec tsx tests/egress-tls-sidecar-real.test.ts`.

Expected: all focused contract tests pass while remaining local-only.

- [ ] **Step 4: Verify the Sub2API fixture**

Run from `/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-phase-0/backend`: `go test ./internal/service -run 'FormalPool|ClaudeCode|Contract' -count=1`.

Expected: PASS against `backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json`.

- [ ] **Step 5: Commit**

Run: `git add tools/oracle-lab/resolve-formal-pool-contract.ts tests/oracle-lab-contract-discovery.test.ts tests/egress-tls-sidecar-real.test.ts tests/egress-tls-sidecar.test.ts tests/proxy-sub2api.test.ts && git commit -m "fix: resolve formal-pool contract from declared repository"`

## Task 6: Add B1-B3 Revalidation and RED Security Tests

**Files:**
- Create: `/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-phase-0/backend/internal/service/formal_pool_onboarding_phase0_red_test.go`
- Create: `/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-phase-0/backend/internal/server/routes/formal_pool_onboarding_phase0_red_test.go`

**Interfaces and RED expectations:**
- B1 `AttestBrowserEgress` must require a server-generated, session-bound, single-use proof or completed server-side egress observation. The current non-empty `verification_code` behavior is at `formal_pool_onboarding_service.go:663`.
- B2 every session operation must receive authenticated principal context and enforce principal, tenant, group, creator, role, object ownership, current state, and expected version.
- B3 `withAbsoluteBrowserEgressURL` must use an explicit configured public origin or trusted-ingress forwarded-header policy. The existing forwarded-host test is the RED regression.

- [ ] **Step 1: Add B1 failing service tests**

Add arbitrary non-empty, wrong, expired, replayed, cross-session, and post-proxy-change code cases.

Run from `/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-phase-0/backend`: `go test -tags=phase0red ./internal/service -run 'Test.*Browser.*Attest|Test.*Egress.*Attest' -count=1`.

Expected: the arbitrary non-empty code case fails against the current implementation; unsupported proof cases are recorded as explicit RED coverage rather than skipped.

- [ ] **Step 2: Add B2 failing authorization tests**

Create two principals, two administrators, two groups, and two tenants. Attempt cross-boundary reads/writes for session creation, `GetSession`, `TestProxy`, browser attestation, OAuth generation/exchange, setup-token exchange, acceptance, refresh-only, runtime registration, session healthcheck, separate account `AccountHealthcheck`, start-warming, abort, activation, and promotion.

Run from `/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-phase-0/backend`: `go test -tags=phase0red ./internal/service ./internal/server/routes -run 'FormalPoolOnboarding|FormalPoolOperations' -count=1`.

Expected: at least one random-ID-only access path fails the cross-boundary assertion.

- [ ] **Step 3: Convert B3 forwarded-origin behavior into a RED security test**

Keep a positive configured-origin test. Add hostile `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto` values and assert they cannot change the browser URL.

- [ ] **Step 4: Record provenance and commit the RED fixtures**

Each B1-B3 record includes repository, commit, symbol, test name, observed date, failure digest, and `implementation_status: failing_test_added`. The RED files carry `//go:build phase0red`, so the normal backend suite remains green while the explicit revalidation suite records the known failures.

- [ ] **Step 5: Commit the Sub2API RED fixtures**

Run from the Sub2API Phase 0 worktree: `git add backend/internal/service/formal_pool_onboarding_phase0_red_test.go backend/internal/server/routes/formal_pool_onboarding_phase0_red_test.go && git commit -m "test: revalidate onboarding authorization boundaries"`.

- [ ] **Step 6: Update the CC Gateway registry in its own repository commit**

Run from `/Users/muqihang/chelingxi_workspace/cc-gateway-oracle-phase-0`: `git add docs/superpowers/registry/oracle-lab-requirements.json && git commit -m "docs: record onboarding boundary revalidation"`.

## Task 7: Add B4-B6 Revalidation and RED Sidecar Tests

**Files:**
- Create: `tests/red/phase0-boundary.red.test.ts`
- Create: `sidecar/egress-tls-sidecar/internal/control/phase0_red_test.go`
- Create: `sidecar/egress-tls-sidecar/internal/server/phase0_red_test.go`
- Modify: `docs/superpowers/registry/oracle-lab-requirements.json`

**Interfaces and RED expectations:**
- Both Go files begin with `//go:build phase0red` and are excluded from `go test ./...`; they run only with `-tags=phase0red`.
- B4 formal-pool requests deny before DNS/socket creation unless context, proxy, sidecar, manifest, and account identity are present.
- B5 sidecar authentication must bind complete control, final headers/body hashes, nonce/timestamp, profile, target, route, method, proxy identity, and expected summary. Current `computeProxyBinding` plus JSON `x-cc-egress-control` is incomplete.
- B6 proxy destination policy must normalize addresses, reject unsafe ranges, pin resolution, and reject redirects/alternate dial targets. Current TypeScript/Go URL checks are primarily syntax checks.

- [ ] **Step 1: Add B4 pre-socket RED tests**

Use a fake DNS/socket observer for missing sidecar, missing context, mismatched generations, disabled profile, unknown manifest authority, and direct fallback configuration.

Run: `npm exec tsx tests/red/phase0-boundary.red.test.ts`.

Expected: missing manifest/generation cases remain RED until the Phase 2 contract exists and are listed as explicit findings.

- [ ] **Step 2: Add B5 mutation/replay RED tests**

Mutate fields, duplicate/reorder JSON keys, alter Unicode escaping, change final hashes, replay after completion/restart, and replay against a second replica. Add equivalent Go control/server tests.

Run: `npm exec tsx tests/red/phase0-boundary.red.test.ts`.

Run from `/Users/muqihang/chelingxi_workspace/cc-gateway-oracle-phase-0/sidecar/egress-tls-sidecar`: `go test -tags=phase0red ./internal/control ./internal/server -count=1`.

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
- Create: `tools/oracle-lab/validate-command-catalog.ts`
- Create: `tools/oracle-lab/validate-context-pack.ts`
- Create: `tools/oracle-lab/run-command-catalog.ts`
- Create: `tools/oracle-lab/merge-command-results.ts`
- Create: `tools/oracle-lab/build-exit-report.ts`
- Create: `tools/oracle-lab/build-exit-receipt.ts`
- Create: `tests/oracle-lab-harness.test.ts`
- Create: `docs/superpowers/schemas/oracle-lab-handoff.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-command-catalog.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-command-results.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-context-pack.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-exit-receipt.schema.json`
- Create: `docs/superpowers/registry/oracle-lab-command-catalog.json`
- Modify: `package.json`

**Interfaces:**
- `npm run oracle:validate -- --registry docs/superpowers/registry/oracle-lab-requirements.json --claims docs/superpowers/registry/oracle-lab-claims.json --manifest docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json`.
- `npm run oracle:context -- --registry docs/superpowers/registry/oracle-lab-requirements.json --claims docs/superpowers/registry/oracle-lab-claims.json --manifest docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json --command-results /tmp/oracle-lab-phase-0-command-results.json --requirement HA-P0-001 --requirement HA-P0-002 --out /tmp/oracle-lab-context-pack.json`.
- `npm run oracle:commands -- --catalog docs/superpowers/registry/oracle-lab-command-catalog.json --group phase0-green --results /tmp/oracle-lab-phase-0-green-results.json`.
- `npm run oracle:commands -- --catalog docs/superpowers/registry/oracle-lab-command-catalog.json --group phase0-red --results /tmp/oracle-lab-phase-0-red-results.json`.
- `npm run oracle:merge-results -- --inputs /tmp/oracle-lab-phase-0-green-results.json /tmp/oracle-lab-phase-0-red-results.json --out /tmp/oracle-lab-phase-0-command-results.json`.
- `npm run oracle:handoff -- --phase phase-0 --baseline docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json --command-results /tmp/oracle-lab-phase-0-command-results.json --out docs/superpowers/evidence/phase-0/phase-0-handoff.json`.
- `npm run oracle:exit-report -- --handoff docs/superpowers/evidence/phase-0/phase-0-handoff.json --out docs/superpowers/evidence/phase-0/phase-0-exit-report.md`.
- `npm run oracle:receipt -- --baseline docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json --handoff docs/superpowers/evidence/phase-0/phase-0-handoff.json --handoff-commit "$HANDOFF_COMMIT" --out docs/superpowers/evidence/phase-0/phase-0-exit-receipt.json`.
- Packs contain approved files/symbols, line references, requirement records, and test status; they exclude raw secrets and unrestricted logs.
- The immutable entry baseline remains a separate entry-validation artifact. Final command results, final context, handoff, exit report, and exit receipt bind only `phase-0-exit-baseline.json`; entry-bound artifacts are never reused or accepted as fallback in the exit evidence chain.
- Add these exact package scripts: `oracle:validate`, `oracle:context`, `oracle:commands`, `oracle:merge-results`, `oracle:handoff`, `oracle:exit-report`, and `oracle:receipt`; each delegates to the corresponding `tools/oracle-lab/*.ts` entry point through the existing `tsx` toolchain.
- `oracle:validate` composes run-manifest, requirement, claim, and command-catalog validation and fails closed if any referenced digest or requirement is missing.

`CommandCatalogEntry` is exact and versioned:

```ts
type CommandCatalogEntry = {
  id: string;
  schema_version: 1;
  group: "phase0-green" | "phase0-red";
  owner: string;
  requirement_ids: string[];
  repository: "cc-gateway" | "sub2api" | "egress-tls-sidecar";
  cwd: "${CC_GATEWAY_ROOT}" | "${SUB2API_ROOT}/backend" | "${CC_GATEWAY_ROOT}/sidecar/egress-tls-sidecar";
  argv: string[];
  env: Record<string, string>;
  inherit_env: Array<"PATH" | "HOME" | "TMPDIR">;
  manifest_binding: { manifest_path: string; repository_head_field: string; contract_digest_field?: string };
  allowed_worktree_delta: string[];
  timeout_ms: number;
  expected_exit: 0 | "nonzero";
  output_policy: "digest_only" | "redacted_excerpt";
  rollback: string;
};
```

`ContextPack` is also exact and versioned:

```ts
type ContextPack = {
  schema_version: 1;
  generated_at: string;
  expires_at: string;
  registry_digest: string;
  claims_digest: string;
  manifest_digest: string;
  requirement_ids: string[];
  repositories: Array<{ name: string; commit: string; dirty_digest: string }>;
  sources: Array<{ path: string; symbol?: string; line?: number; digest: string }>;
  tests: Array<{ command_id: string; status: "pass" | "expected_fail" | "unexpected_fail" | "unexpected_pass"; result_digest: string }>;
  known_unknowns: string[];
};
```

Catalog `env` values are fixed strings or `${CC_GATEWAY_ROOT}`, `${SUB2API_ROOT}`, `${ENTRY_MANIFEST}`, and `${EXIT_MANIFEST}` expansions; all inherited variables must be named in `inherit_env`, and the result record includes an environment digest. `allowed_worktree_delta` is empty for normal execution except Task 9, where CC Gateway entries allow only the just-generated `docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json`; any other delta fails before command execution. All H0 schemas use `schema_version: 1`, reject unknown fields, and carry `compatibility_policy`, `retention_class`, `redaction_policy`, and `destruction_procedure` metadata. Phase 0 allows additive backward-compatible changes only; a breaking schema change requires a new version and migration test. Generated context packs expire after 24 hours by default, command result excerpts after 7 days, and digest-only evidence follows the retention policy recorded in the handoff.

- [ ] **Step 1: Write and run H0 RED tests**

Reject missing repository digests, unknown requirements, duplicate command IDs, shell-string commands, undeclared environment expansion, missing/mismatched manifest bindings, invalid expected-exit values, duplicate or cross-manifest command-result merges, artifacts outside the evidence root, expired context packs, incomplete handoffs/receipts, unknown schema fields, unsupported schema versions, and raw secret canaries in safe artifacts. Assert that a valid command catalog and context pack round-trip through validation, that command-result merging is order-independent, that a receipt rejects a commit not containing its named artifacts, and that breaking schema changes fail without an explicit migration.

Run: `npm exec tsx tests/oracle-lab-harness.test.ts`.

Expected: FAIL because the H0 commands and handoff schema do not exist.

- [ ] **Step 2: Implement and verify H0**

Add the scripts and package commands without a new runtime dependency. `run-command-catalog.ts` executes `argv` without a shell, expands only the declared root placeholders and exact `env` map, validates `manifest_binding` before worktree-backed commands, runs one entry at a time, records the real exit code, duration, redacted output digest, and expected/observed classification, and continues after expected RED failures. `merge-command-results.ts` sorts records by command ID, rejects duplicate IDs or mismatched manifest/commit digests, and writes one canonical result set. All validation and generation commands return `0` only when every referenced artifact and requirement validates; the command runner returns non-zero for an unexpected failure or unexpected pass.

Run: `npm exec tsx tests/oracle-lab-harness.test.ts`.

Expected: PASS with invalid catalogs/packs rejected and a valid catalog, pack, report, and handoff generated twice with identical canonical digests after volatile timestamps are excluded from the digest input.

- [ ] **Step 3: Commit**

Run: `git add tools/oracle-lab tests/oracle-lab-harness.test.ts docs/superpowers/schemas docs/superpowers/registry/oracle-lab-command-catalog.json package.json && git commit -m "feat: add oracle lab phase handoff harness"`.

The complete command catalog is populated, validated, and committed in this step. It includes separate entries for `npm run build`, `npm test`, the sidecar default suite, the Sub2API targeted default suite, the CC Gateway B4-B6 RED suite, the sidecar B4-B6 RED suite, and the Sub2API B1-B3 RED suite, together with exact `env` and `manifest_binding` values. Task 9 consumes this immutable catalog and does not edit it.

## Task 9: Generate the Phase 0 Exit Report and Handoff Bundle

**Files:**
- Create: `docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json`
- Create: `docs/superpowers/evidence/phase-0/phase-0-exit-report.md`
- Create: `docs/superpowers/evidence/phase-0/phase-0-handoff.json`
- Create: `docs/superpowers/evidence/phase-0/phase-0-context-pack.json`
- Create: `docs/superpowers/evidence/phase-0/phase-0-exit-receipt.json`
- Modify: `docs/superpowers/registry/oracle-lab-requirements.json`
- Modify: `docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md`

**Interfaces:**
- The report separates observed facts, local inferences, provider-internal unknowns, RED findings, disabled capabilities, and exact command results.
- The handoff contains safe digests and references only.
- The exit baseline captures the clean, reviewed implementation heads after Tasks 1-8 and before evidence/status artifacts are generated. It is distinct from the immutable entry baseline and is intentionally not self-referential.
- A post-commit exit receipt binds the commit containing the handoff/report/status artifacts to the exit-baseline digest and handoff digest.
- The roadmap marks Phase 0 complete only if every exit condition is green; otherwise it records `blocked_by_baseline` with the failure digest.

- [ ] **Step 1: Re-freeze the reviewed implementation baseline**

After all Phase 0 implementation commits exist in both Phase 0 worktrees, assert both trees are clean, record `CC_REVIEWED_HEAD` and `SUB2API_REVIEWED_HEAD`, and run:

`npm exec tsx tools/oracle-lab/freeze-baseline.ts -- --cc-gateway-root "$CC_GATEWAY_ROOT" --sub2api-root "$SUB2API_ROOT" --contract-path "$SUB2API_FORMAL_POOL_CONTRACT_PATH" --parent-entry docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json --parent-entry-receipt docs/superpowers/evidence/phase-0/phase-0-entry-baseline.receipt.json --expected-cc-head "$CC_REVIEWED_HEAD" --expected-sub2api-head "$SUB2API_REVIEWED_HEAD" --out docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json`.

Expected: the manifest contains the reviewed implementation heads, clean dirty-state digests, shared-contract digest, CodeGraph provenance, schema/tool digests, and a parent reference to the committed Task 0.5 entry-baseline digest. Fail if either repository commit differs from the reviewed heads. The later evidence commit is bound by the receipt rather than falsely claimed as an input to this manifest.

- [ ] **Step 2: Run the Phase 0 command set against the exit manifest**

Use the complete command catalog committed by Task 8. Its worktree-backed entries bind to `${EXIT_MANIFEST}` and the reviewed repository heads. Do not edit it in Task 9 and do not combine commands with `&&`, `;`, `sh -c`, or an equivalent shell wrapper.

Run: `EXIT_MANIFEST=docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json npm run oracle:commands -- --catalog docs/superpowers/registry/oracle-lab-command-catalog.json --group phase0-green --results /tmp/oracle-lab-phase-0-green-results.json`.

Run: `EXIT_MANIFEST=docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json npm run oracle:commands -- --catalog docs/superpowers/registry/oracle-lab-command-catalog.json --group phase0-red --results /tmp/oracle-lab-phase-0-red-results.json`.

Run: `npm run oracle:merge-results -- --inputs /tmp/oracle-lab-phase-0-green-results.json /tmp/oracle-lab-phase-0-red-results.json --out /tmp/oracle-lab-phase-0-command-results.json`.

The deterministic merge output records command ID, repository commit, exit-manifest digest, environment digest, real exit code, expected exit, classification, duration, and output digest. Raw stdout/stderr stays outside the tracked evidence tree and is redacted before any excerpt is retained.

Expected: the stale contract path failure is gone; normal H0/governance suites are green; explicit `phase0red` suites remain expected RED and are listed as `failing_test_added` until their implementation phases.

- [ ] **Step 3: Generate and validate the safe context, report, and handoff**

First update the working copies of the requirement registry and roadmap to their intended final Phase 0 statuses without committing them. The generators must hash and include those exact pending bytes; Step 4 commits the same bytes unchanged.

Run: `npm run oracle:validate -- --registry docs/superpowers/registry/oracle-lab-requirements.json --claims docs/superpowers/registry/oracle-lab-claims.json --manifest docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json`.

Run: `npm run oracle:context -- --registry docs/superpowers/registry/oracle-lab-requirements.json --claims docs/superpowers/registry/oracle-lab-claims.json --manifest docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json --command-results /tmp/oracle-lab-phase-0-command-results.json --requirement HA-P0-001 --requirement HA-P0-002 --requirement AV-B1-001 --requirement AV-B2-001 --requirement AV-B3-001 --requirement AV-B4-001 --requirement AV-B5-001 --requirement AV-B6-001 --out docs/superpowers/evidence/phase-0/phase-0-context-pack.json`.

Run: `npm exec tsx tools/oracle-lab/validate-context-pack.ts -- --pack docs/superpowers/evidence/phase-0/phase-0-context-pack.json`.

Run: `npm run oracle:handoff -- --phase phase-0 --baseline docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json --command-results /tmp/oracle-lab-phase-0-command-results.json --context docs/superpowers/evidence/phase-0/phase-0-context-pack.json --out docs/superpowers/evidence/phase-0/phase-0-handoff.json`.

Run: `npm run oracle:exit-report -- --handoff docs/superpowers/evidence/phase-0/phase-0-handoff.json --out docs/superpowers/evidence/phase-0/phase-0-exit-report.md`.

Expected: tracked deterministic outputs with no raw secrets or unrestricted logs, populated Phase 1 entry conditions, explicit entry-to-exit baseline differences, and command-by-command classifications. Regenerating them from the same commits and safe result records produces the same canonical digests.

- [ ] **Step 4: Update statuses and commit the handoff artifacts**

Mark governance controls `locally_verified`, keep B1-B6 `failing_test_added`, record expiry/known gaps, and commit the safe exit baseline, context pack, report, and handoff. Do not mark Phase 0 complete if a phase0-green command is not `pass`, a phase0-red command is not `expected_fail`, or the committed artifact digests do not match regeneration. A remaining `protected_gateway` production-authority requirement is recorded as `deferred_phase4_gate`; it disables production/real-canary capability but does not block the Phase 0 governance handoff.

Run: `git add docs/superpowers/evidence/phase-0 docs/superpowers/registry/oracle-lab-requirements.json docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md && git commit -m "docs: record oracle lab phase 0 handoff"`.

- [ ] **Step 5: Bind the evidence commit with a post-commit receipt**

Record `HANDOFF_COMMIT=$(git rev-parse HEAD)` and run:

`npm run oracle:receipt -- --baseline docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json --handoff docs/superpowers/evidence/phase-0/phase-0-handoff.json --handoff-commit "$HANDOFF_COMMIT" --out docs/superpowers/evidence/phase-0/phase-0-exit-receipt.json`.

Validate that `HANDOFF_COMMIT` contains the exact baseline, context pack, handoff, report, registry, and roadmap digests named by the receipt, then commit only the receipt: `git add docs/superpowers/evidence/phase-0/phase-0-exit-receipt.json && git commit -m "docs: bind oracle lab phase 0 evidence receipt"`.

Expected: the receipt names `CC_REVIEWED_HEAD`, `SUB2API_REVIEWED_HEAD`, the entry/exit baseline digests, the handoff digest, and `HANDOFF_COMMIT`. The final receipt commit is the Phase 0 branch tip; the exit baseline remains an honest snapshot of the reviewed implementation inputs.

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
