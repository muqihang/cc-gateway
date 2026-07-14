# Claude Code 2.1.207 P0.1 / WP-R0 Governance Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task starts with a failing test or an explicit baseline failure, ends with an independent requirements and code-quality review, and is committed separately.

**Goal:** Adopt and reconcile the reviewed governance amendment, upgrade H0 to validate its requirements and observations, repair the bounded local joint-test fixture drift, and issue a successor P0.1 receipt plus a fail-closed P1 handoff.

**Architecture:** Treat P0.1 as a successor governance release layered over immutable Phase 0 and post-integration receipts. Split reviewed tooling from evidence capture, migrate the Requirement Registry homogeneously from v1 to v2, record current-code observations in a separate append-only ledger, and bind both repositories into a deterministic cross-repository exit chain.

**Tech Stack:** TypeScript/Node.js 22, JSON Schema plus the repository's existing exact TypeScript validators, Go tests, Git commit-object verification, CodeGraph CLI 1.1.6, and the existing `tools/oracle-lab/harness-core.ts` safety primitives. Ajv `8.20.0` is pinned as a development-only schema-test dependency; no new runtime dependency is introduced.

## Global Constraints

- Historical evidence under `docs/superpowers/evidence/phase-0`, `docs/superpowers/evidence/post-integration`, and `docs/superpowers/evidence/post-integration-v2` is byte-immutable.
- Frozen bases are CC Gateway `9ca9ea72d881fccd2cfb3fd1b939a2f56db69516` and Sub2API `d5a42bbd24d15af2ce7646d050a5ae5c77911d4f`; both equal `refs/remotes/muqihang/main` at entry.
- The shared-contract digest remains `sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1`.
- No production endpoint, real credential, unrestricted capture, real canary, profile promotion, or external network request is permitted.
- Every validation command inherits exact `HERMETIC_NETWORK_ENV`: `npm_config_offline=true`, `npm_config_audit=false`, `npm_config_fund=false`, `GOPROXY=off`, `GOSUMDB=off`, `GOTOOLCHAIN=local`, `HTTP_PROXY=http://127.0.0.1:9`, `HTTPS_PROXY=http://127.0.0.1:9`, `ALL_PROXY=http://127.0.0.1:9`, and `NO_PROXY=127.0.0.1,localhost`; a missing cached module or local toolchain fails closed.
- All persisted evidence is repository-relative, schema-exact, secret-free, size-bounded, deterministic in stable fields, and bound to reviewed commits.
- CodeGraph is updated after indexed changes and must be up to date in both repositories before final capture.
- No deletion, history rewrite, force push, or worktree cleanup occurs without operator approval.
- No reviewer approves implementation they authored; every Critical or Important finding is fixed and re-reviewed before the next gate.
- Historical Phase 0 completion is not reopened; P0.1 governs only the newly adopted overlay and its successor evidence.

## Status

- Plan date: 2026-07-12
- Plan state: revision 5; all known findings applied and ready for closing review; execution is prohibited until both independent reviewers approve this exact digest
- Primary work package: `WP-R0` requirement and roadmap reconciliation
- Narrow evidence-integrity repair: `RA-CURRENT-009` local test-fixture drift only; no production or runtime implementation
- CC Gateway worktree: `/Users/muqihang/chelingxi_workspace/cc-gateway-oracle-p0-1`
- Sub2API worktree: `/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-p0-1`
- Branch in both repositories: `codex/oracle-p0-1-governance`

## Objective

Adopt the reviewed amendment without overstating implementation, reconcile it with the existing seven-phase roadmap, evolve H0 so the new requirements and observations are machine-checkable, repair the known local joint-test fixture drift, and produce a successor governance receipt and P1 handoff.

P0.1 is a post-Phase-0 governance release. It does not reopen, rewrite, or invalidate the historical Phase 0 exit. It makes later planning truthful after a fourth normative document was introduced.

## Frozen Reconnaissance Inputs

| Input | Frozen value |
| --- | --- |
| CC Gateway base | `main@9ca9ea72d881fccd2cfb3fd1b939a2f56db69516` |
| Sub2API base | `main@d5a42bbd24d15af2ce7646d050a5ae5c77911d4f` |
| User-fork refs | both bases equal `refs/remotes/muqihang/main` |
| Phase 0 exit receipt | `sha256:5a2bef840e04d6533bfc657520c73cbc8fcc5f27ede181d168d9b2bf8a3fedee` |
| Post-integration V2 receipt | `sha256:c6b64e233dfa2df8c4cd8937aa2b8552ac54c68d4593a32a837af20d4923fb64` |
| Unadopted review-amendment source | `sha256:76e662ede1e113018eb5bf8cb835e2e825ae094d426a1c73c4af17f8a643dbf4` |
| Shared contract | `backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json`, `sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1` |
| CodeGraph CLI | `1.1.6` |
| CC Gateway CodeGraph | up to date, 102 files, 3,127 nodes, 11,974 edges |
| Sub2API CodeGraph | full rebuild with `CODEGRAPH_NO_WATCHDOG=1`, up to date, 3,042 files, 98,075 nodes, 328,728 edges |
| CC Gateway baseline | `npm test` PASS, `npm run build` PASS, sidecar `go test ./...` PASS |
| H0 baseline | traceability 16/16, claims 14/14, harness 25/25, reviewed snapshot 4/4, post-entry 17/17, post-handoff 7/7 |
| Known accidental RED | the two joint local-chain tests fail because their generated Gateway config lacks a declared compromise boundary |

The two failing commands were reproduced on the frozen Sub2API base:

```bash
go test ./internal/service \
  -run 'Test(ClaudePlatformAWSLocalFullChainE2EUsesCCGatewayAndSafeMockUpstream|JointLocalCaptureAcceptanceArtifact)$' \
  -count=1 -v
```

Both fail before health with `shared_pool.gateway_compromise_boundary is required for formal-pool mode`. CodeGraph also confirms that `protected_gateway` requires `upstream_mode: local-capture` for these loopback-only fixtures. Adding only the boundary is not a complete repair.

## Authority and Scope

After P0.1, normative precedence is:

```text
Review Amendments > Hardening Amendments > Adversarial Validation v2 > Oracle Lab Design
```

Precedence does not silently erase conflicts. Every refinement, supersession, or unresolved contradiction remains explicit in the Registry.

### In Scope

- adopt and correct the review amendment;
- add overlay pointers to the three earlier specifications;
- preserve seven top-level phases while splitting Phase 3 into `3A` and mandatory `3B/3.5`;
- make `WP-R0..WP-R9` traceability umbrellas with phase-owned slices;
- create homogeneous Requirement Registry schema v2 and a deterministic v1 migration test;
- register all 18 `RA-P0-*` and `RA-P1-*` requirements as `deferred`;
- add the amendment's prohibited conclusions to the Claim Matrix;
- create and validate a ten-row `RA-CURRENT-*` observation ledger against the frozen bases;
- repair only the four local test YAML blocks implicated by `RA-CURRENT-009`;
- add the two joint tests to the successor cross-repository GREEN inventory;
- create a new P0.1 entry/exit/context/handoff/receipt chain that references, but does not replace, prior receipts;
- generate the exact P1 entry conditions.

### Out of Scope

- B1-B3 implementation;
- B4-B6 implementation;
- a shared readiness handshake or shared contract redesign;
- profile compiler, 2.1.207 profile, or evidence-factory implementation;
- account lifecycle, policy broker, sidecar replay, response semantics, scheduler, or multi-replica runtime work;
- large-scale `src/proxy.ts` refactoring;
- production, real credentials, external network access, real canary, or profile promotion;
- modifying any file under `docs/superpowers/evidence/phase-0`, `docs/superpowers/evidence/post-integration`, or `docs/superpowers/evidence/post-integration-v2`.

## Execution DAG

```text
Plan review and plan-only commit
  -> Task 0A reviewed entry-tool bootstrap
  -> Task 0B immutable entry capture
  -> Task 1 normative document and roadmap reconciliation
  -> Task 2 Requirement Registry v2 and migration
  -> Task 3 RA requirements and Claim Matrix
  -> Task 4 RA-CURRENT observation ledger
  -> Task 5 local joint-fixture drift repair
  -> Task 6 H0.1 successor evidence chain
  -> Task 7 independent final review, exit artifacts, and receipt
```

No task may be combined with its reviewer task. A reviewer who wrote the implementation cannot approve it.

Before Task 0A, commit this reviewed plan by itself. The plan commit may not include `.codegraph`, source, schema, Registry, evidence, or Sub2API changes.

## Task Metadata

| Task | Requirement IDs | Owner | Depends on | Rollback boundary |
| --- | --- | --- | --- | --- |
| 0A | `HA-P0-004`, `HA-P0-007`, `RA-P0-001` | H0 implementer | reviewed plan commit | revert bootstrap-tool commit; retain plan |
| 0B | `HA-P0-004`, `HA-P0-007` | release evidence owner | reviewed 0A tool commit | revert entry-pair commit; retain reviewed tool |
| 1 | `HA-P0-002`, `RA-P0-001`, `RA-P1-001` | oracle governance owner | 0B | revert document/roadmap commit only |
| 2 | `HA-P0-001`, `RA-P0-001` | H0 owner | 1 | revert schema/tool commit; v1 remains accepted |
| 3 | all 18 `RA-*`, `HA-P0-003` | requirement and claims owners | 2 | revert Registry/Claim commit; production remains disabled |
| 4 | `RA-CURRENT-001..010` | evidence reviewer | 3 | revert observation ledger commit; source amendment stays adopted |
| 5 | `RA-CURRENT-009` (`RA-P0-005` related only) | Sub2API test owner | 4 | an authorized future Sub2API revert must be followed by an append-only `changed`/`stale` ledger event bound to the new commit before any new receipt; never delete confirmed/resolved history |
| 6 | `HA-P0-007`, `RA-P0-005`, `RA-P0-009` | H0 owner | 5 | revert successor harness commit; historical receipts remain authoritative for their old scope |
| 7 | all P0.1 rows | controller plus independent reviewers | 6 | mark P0.1 blocked; do not issue an approved receipt |

## Task 0A: Bootstrap and Review the Entry-Capture Tool

### Files

- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tests/oracle-lab-baseline-freeze.test.ts`
- Create: `docs/superpowers/schemas/oracle-lab-governance-amendment-entry.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-governance-amendment-entry-receipt.schema.json`
- Create: `tools/oracle-lab/governance-amendment-entry.ts`
- Create: `tests/oracle-lab-hermetic-dependencies.test.ts`
- Create: `tests/oracle-lab-governance-amendment-entry.test.ts`

- [ ] **Step 1: Make local CodeGraph state non-dirty**

Add `.codegraph/` and `.superpowers/sdd/` to the repository `.gitignore`. Do not delete, commit, or relocate either worktree's index or the durable execution ledger. Sub2API already ignores its index; its existing worktree remains clean while the controller keeps the cross-repository ledger in the CC Gateway worktree.

Run:

```bash
git status --short --branch --untracked-files=all
codegraph status
```

Expected: CodeGraph is up to date; index and SDD scratch state are ignored; only planned tracked changes remain.

- [ ] **Step 2: Eliminate dynamic dependency installation from H0**

Add a failing hermetic-dependency test that requires:

- `package.json` contains exact `devDependencies.ajv: "8.20.0"` and `package-lock.json` resolves the same version/integrity;
- `tests/oracle-lab-baseline-freeze.test.ts` imports `ajv/dist/2020.js` from the repository dependency tree;
- no test or Oracle harness source spawns `npm install`, `npm add`, `npx`, `yarn add`, or `pnpm add` at runtime;
- schema validation uses the pinned local module without a temporary prefix or `NODE_PATH` rewrite.

Run: `npm exec tsx tests/oracle-lab-hermetic-dependencies.test.ts`.

Expected before the fix: FAIL because Ajv is absent from the lockfile and the baseline test dynamically installs it.

Install only from the already populated local npm cache:

```bash
npm install --offline --save-dev --save-exact ajv@8.20.0
```

If the exact tarball is not locally cached, stop rather than enabling network. Replace the temporary install logic with a normal static `Ajv2020` import and keep the same schema-validity assertions.

Run the focused hermetic test, then run the full suite with npm network behavior disabled and dead external proxies while retaining loopback:

```bash
npm_config_offline=true npm_config_audit=false npm_config_fund=false \
GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local \
HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 \
NO_PROXY=127.0.0.1,localhost \
npm test
```

Expected: PASS without a package-manager child install or external registry access. The successor command catalog preserves these npm environment controls.

- [ ] **Step 3: Add failing entry-chain tests**

The test must reject:

- wrong CC Gateway or Sub2API base head;
- a branch that does not descend from the frozen user-fork main;
- dirty tracked/untracked inputs other than ignored CodeGraph files;
- changed shared-contract bytes;
- changed historical Phase 0 or post-integration V2 receipt bytes;
- changed unadopted review-amendment source bytes;
- missing or stale CodeGraph status;
- absolute paths, raw secrets, or unknown schema fields;
- an entry artifact not paired with its receipt.
- an entry commit whose parent is not the reviewed Task 0A tool head, whose delta is not exactly the two entry paths, or whose committed bytes differ from the pre-commit validated pair.

Run:

```bash
npm exec tsx tests/oracle-lab-governance-amendment-entry.test.ts
```

Expected before implementation: FAIL because the schema/tool do not exist.

- [ ] **Step 4: Implement the minimal entry capture**

Reuse `harness-core.ts` safety primitives and the existing commit-byte/ancestry pattern. Do not generalize or rewrite the historical Phase 0 and post-integration tools.

The eventual entry artifact binds:

- immutable `base_main_heads`, the committed `reviewed_tool_head`, ancestry from each base, branch names, user-fork main refs, remote URL digests, and clean dirty-state digests;
- the shared-contract path and digest;
- the two parent receipt paths and digests;
- the unadopted amendment source digest without persisting its absolute path;
- CodeGraph version, up-to-date state, index digests, and graph counts;
- runtime/tool version digests;
- all disabled capabilities and the exact P0.1 scope.

The tests use temporary repositories and fixtures; do not capture the real entry pair while the tool is uncommitted.

- [ ] **Step 5: Sync, review, and commit the tool**

Run `codegraph sync` and `codegraph status`. Requirements reviewer checks byte bindings and non-mutation of historical evidence. Code reviewer checks path confinement, no-follow writes, exact fields, and secret rejection.

Commit only `.gitignore`, `package.json`, `package-lock.json`, the baseline hermetic repair, both entry schemas, the entry tool, and the two Task 0A tests.

Commit message: `feat(oracle): add p0.1 entry capture tool`

## Task 0B: Capture and Commit the Immutable Entry Pair

### Files

- Create: `docs/superpowers/evidence/p0-1/p0-1-entry-baseline.json`
- Create: `docs/superpowers/evidence/p0-1/p0-1-entry-baseline.receipt.json`

- [ ] **Step 1: Verify the reviewed tool snapshot**

The worktree must be clean at the Task 0A commit. The tool must prove that its current bytes equal `reviewed_tool_head`, and that `reviewed_tool_head` descends from frozen CC Gateway `main@9ca9ea72d881fccd2cfb3fd1b939a2f56db69516`.

Run from CC Gateway:

```bash
npm exec tsx tools/oracle-lab/governance-amendment-entry.ts -- capture \
  --cc-gateway-root /Users/muqihang/chelingxi_workspace/cc-gateway-oracle-p0-1 \
  --sub2api-root /Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-p0-1 \
  --review-source /Users/muqihang/chelingxi_workspace/cc-gateway-claude-code-2.1.207-oracle-lab/docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md \
  --out docs/superpowers/evidence/p0-1/p0-1-entry-baseline.json \
  --receipt docs/superpowers/evidence/p0-1/p0-1-entry-baseline.receipt.json
```

The absolute `--review-source` is an input only. No absolute path may be persisted.

- [ ] **Step 2: Validate and independently review the uncommitted entry pair**

```bash
npm exec tsx tools/oracle-lab/governance-amendment-entry.ts -- validate \
  --manifest docs/superpowers/evidence/p0-1/p0-1-entry-baseline.json \
  --receipt docs/superpowers/evidence/p0-1/p0-1-entry-baseline.receipt.json
```

Expected: PASS, with the pair binding the reviewed Task 0A tool head and the two immutable base-main heads.

Before commit, an independent evidence reviewer verifies the Task 0A reviewed tool head, both frozen base heads and clean states, shared-contract digest, amendment-source digest, historical receipt digests, CodeGraph versions/status/counts/index digests, disabled capabilities, repository-relative outputs, and secret/path rejection. Any Critical or Important finding returns to Task 0A or regenerates the pair before commit.

- [ ] **Step 3: Commit the exact pair and validate commit topology**

Commit only the two entry paths.

Commit message: `chore(oracle): freeze p0.1 governance entry`

After commit, run:

```bash
npm exec tsx tools/oracle-lab/governance-amendment-entry.ts -- validate \
  --manifest docs/superpowers/evidence/p0-1/p0-1-entry-baseline.json \
  --receipt docs/superpowers/evidence/p0-1/p0-1-entry-baseline.receipt.json \
  --entry-commit HEAD \
  --tool-commit "$(git rev-parse HEAD^)"
```

Expected: PASS only when `HEAD^` equals the reviewed Task 0A tool commit, the commit delta contains exactly the two entry paths, and `git show HEAD:<path>` for both artifacts is byte-identical to the validated worktree pair. Post-commit validation must not mutate the repository.

## Task 1: Adopt the Review Amendment and Reconcile the Roadmap

### Files

- Create: `docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md`
- Modify: `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-design.md`
- Modify: `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-adversarial-validation-v2.md`
- Modify: `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md`
- Modify: `docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md`
- Create: `tests/oracle-lab-review-overlay.test.ts`

- [ ] **Step 1: Write the failing overlay test**

The test must require:

- all four documents and the Registry v2 path in every Status overlay;
- the four-level precedence order;
- explicit conflict registration instead of silent replacement;
- seven top-level phases with Phase `3A` and mandatory bridge `3B/3.5`;
- the authoritative DAG:

```text
P0 -> P1 --------------------------+
  \-> P2 -> P3A -> P3B/3.5 -------+-> P4 -> P5 -> P6A -> approval -> P6B
```

- B1-B3 owned by Phase 1 and B4-B6 contract/runtime work owned by Phase 2/4;
- `WP-R0..R9` mapped as traceability umbrellas and phase slices, not ten cross-phase implementation plans;
- Phase 3B local compiler/config/fixture conformance separated from Phase 6A full signed local staging;
- Phase 6B remaining a separately approved canary.

Run: `npm exec tsx tests/oracle-lab-review-overlay.test.ts`.

Expected before document edits: FAIL.

- [ ] **Step 2: Correct the amendment before adoption**

Copy the reviewed source bytes mechanically, then make these normative corrections:

1. State that `RA-P0-*` and `RA-P1-*` encode priority, not roadmap phase.
2. State that a `blocked` result in Sections 1 and 4 means Phase 3B/3.5 is blocked, not that historical Phase 0 or the entire program is retroactively blocked.
3. Replace the eighth-phase interpretation with `Phase 3B`, retaining `3.5` only as a durable alias.
4. Replace Phase 3B's signed full-chain output with deterministic compiler/config/fixture/local-conformance output; Phase 6A owns signed complete staging.
5. Give every RA row exactly one primary WP. Put secondary ownership in related requirements and roadmap phase slices.
6. Replace `current authority state` in the Registry instructions with `implementation_status` plus linked Claim Matrix authority; do not create a second authority lattice.
7. Replace the impossible global statement "all parent-document requirements are registered" with "the 23 adopted parent coverage anchors and all 18 RA requirements are registered". Later phase discovery may add IDs only through a reviewed amendment.
8. Expand the version/fingerprint matrix to include the 2.1.169/2.1.179 to 2.1.198 change-point controls and timezone/locale, clean versus inherited environment, `ANTHROPIC_BASE_URL`, China-domain taxonomy, proxy environment, and byte-level System Prompt comparison dimensions.
9. Separate outcome facts by trust layer: broker/sidecar transport facts, Gateway semantic observations, and Sub2API scheduler decisions. A Gateway-signed semantic observation is not independently authoritative under `protected_gateway`.
10. Keep trusted-device proof explicitly unavailable until an independent issuer/verifier lifecycle exists.
11. Correct `RA-CURRENT-004`: re-registration supports limited credential rotation/canonical promotion/TLS backfill, while freeze/drain/revoke/delete/query/reconcile remain absent.
12. Change work-package planning language so phase plans consume explicit WP slices; no plan may cross a phase gate.
13. State that `RA-CURRENT-*` observations are revalidated in a separate ledger and are not requirements or implementation claims.

- [ ] **Step 3: Update parent overlays and roadmap**

Do not duplicate the complete amendment in parent documents. Add concise Status pointers and targeted precedence text. Preserve the historical P0 completion statement, then add a distinct P0.1 governance state.

The roadmap must also add:

- exact Phase 3A and 3B inputs, outputs, non-goals, and artifact gates;
- a phase-slice table for every `WP-R0..R9`;
- immediate Phase 1 ownership for B1-B3 and loopback/remote-listen fail-closed guard planning;
- Phase 2 contract ownership and Phase 4 runtime ownership for B4-B6;
- explicit environment-fingerprint evidence coverage in Phase 3A;
- `P0.1 branch receipt -> merge both repository branches -> prove local main equals muqihang/main -> verify P0.1 artifact/fix ancestry on integrated heads -> fresh P1 entry baseline/context -> P1 detailed plan` as the next sequence.

Run the overlay test. Expected: PASS.

- [ ] **Step 4: Review and commit**

Architecture reviewer checks phase ownership, trust-layer outcome facts, and absence of circular gates. Requirements reviewer checks all 18 IDs and ten work packages against the source.

Commit message: `docs(oracle): adopt reviewed governance amendments`

## Task 2: Add Homogeneous Requirement Registry Schema v2

### Files

- Create: `docs/superpowers/schemas/oracle-lab-requirement-v1.schema.json`
- Modify: `docs/superpowers/schemas/oracle-lab-requirement.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-requirement-v2-migration.schema.json`
- Create: `docs/superpowers/registry/oracle-lab-requirements-v1.json`
- Create: `docs/superpowers/registry/oracle-lab-requirement-v2-migration.json`
- Modify: `tools/oracle-lab/validate-requirements.ts`
- Create: `tools/oracle-lab/migrate-requirements-v1-to-v2.ts`
- Modify: `tools/oracle-lab/validate-claims.ts`
- Modify: `tests/oracle-lab-traceability.test.ts`
- Modify: `tests/oracle-lab-claim-matrix.test.ts`
- Modify: `tests/oracle-lab-harness.test.ts`
- Modify: `tests/oracle-lab-reviewed-snapshot-binding.test.ts`

- [ ] **Step 1: Preserve v1 and write failing v2 tests**

Copy the current 23-record Registry bytes exactly to the `-v1` Registry path and assert its digest before changing the canonical Registry. Create an executable v1 schema with the same constraints but a unique versioned `$id`; do not byte-copy the old schema with a duplicate canonical `$id`.

The new tests must prove:

- a complete v1 array still validates under the v1 path;
- a complete v2 array validates under the canonical path;
- mixed v1/v2 records fail;
- every v2 record has `schema_version: 2`;
- `RA-*` and `review_amendments` are accepted only in v2;
- v2 requires present `reviewer`, `phase_owner`, `work_package`, and `introduced_after_phase` fields plus unique `refines`, `supersedes`, and `related_requirements` arrays;
- RA records require non-empty `work_package` and `introduced_after_phase: phase_0`; legacy coverage anchors require honest `null` for those two fields rather than fabricated WP-R or post-Phase-0 history;
- relationship IDs exist, cannot self-reference, and `supersedes`/`refines` cycles fail;
- v2 `contradiction_ids` may record unresolved requirement-to-requirement conflicts for non-production rows, but every ID must exist, cannot self-reference, and must be symmetric; `production_verified` still requires an empty contradiction set;
- old validation, production evidence, timestamp, repository, dependency, and exact-field rules remain unchanged;
- migration is deterministic, has exact input-ID coverage, and cannot infer missing governance metadata.
- the historical Phase 0 H0 tools reject a canonical-v2/historical-manifest mix instead of silently treating 41 records as the reviewed 23-record snapshot; P0.1 successor tools are the only v2 evidence consumers.

Run:

```bash
npm exec tsx tests/oracle-lab-traceability.test.ts
npm exec tsx tests/oracle-lab-claim-matrix.test.ts
npm exec tsx tests/oracle-lab-harness.test.ts
npm exec tsx tests/oracle-lab-reviewed-snapshot-binding.test.ts
```

Expected before implementation: FAIL on unsupported v2 fields and shape.

- [ ] **Step 2: Implement v2 without changing the top-level array**

Use homogeneous record-level versioning to avoid breaking every array consumer:

- v1 records have the historical exact field set and no `schema_version`;
- v2 records all carry `schema_version: 2` and the expanded exact field set;
- one registry may not mix versions;
- the deterministic Task 2 migration output is entirely v2, but the checked-in canonical Registry remains the preserved v1 bytes until Task 3 atomically assembles and validates all 41 v2 rows;
- migration requires an exact, checked-in metadata mapping for every v1 ID.

The migration mapping is schema-validated and contains exactly these 23 metadata rows. Task 2 tests the 23-row v2 output in an isolated temporary path and does not modify `docs/superpowers/registry/oracle-lab-requirements.json`; Task 3 is the only task that replaces that canonical file. `work_package` and `introduced_after_phase` are `null` for every legacy coverage anchor; existing `depends_on` remains the dependency graph and the three new relationship arrays begin empty unless this plan says otherwise.

| Legacy ID | Independent reviewer | Phase owner |
| --- | --- | --- |
| `HA-P0-000` | release-evidence-reviewer | `phase_0` |
| `HA-P0-001` | requirement-governance-reviewer | `phase_0` |
| `HA-P0-002` | normative-document-reviewer | `phase_0` |
| `HA-P0-003` | claim-authority-reviewer | `phase_0` |
| `HA-P0-004` | baseline-integrity-reviewer | `phase_0` |
| `HA-P0-005` | gateway-boundary-security-reviewer | `phase_0` |
| `HA-P0-006` | cross-repository-contract-reviewer | `phase_0` |
| `HA-P0-007` | harness-security-reviewer | `phase_0` |
| `HA-P0-008` | phase-exit-reviewer | `phase_0` |
| `HA-P0-009` | compatibility-authority-reviewer | `phase_2` |
| `OL-LEGACY-001` | legacy-evidence-reviewer | `phase_0` |
| `AV-B1-001` | onboarding-security-reviewer | `phase_1` |
| `AV-B2-001` | authorization-security-reviewer | `phase_1` |
| `AV-B3-001` | origin-authority-reviewer | `phase_1` |
| `AV-B4-001` | egress-boundary-reviewer | `phase_4` |
| `AV-B5-001` | sidecar-authentication-reviewer | `phase_4` |
| `AV-B6-001` | destination-policy-reviewer | `phase_4` |
| `HA-P1-001` | oracle-evidence-reviewer | `phase_3a` |
| `HA-P1-002` | convergence-method-reviewer | `phase_3a` |
| `HA-P1-003` | error-classification-reviewer | `phase_3a` |
| `HA-P1-004` | transport-contract-reviewer | `phase_4` |
| `HA-P1-005` | lifecycle-resilience-reviewer | `phase_4` |
| `HA-P1-006` | authorization-matrix-reviewer | `phase_4` |

`validateRequirementRecords` returns the same validation result API. Add a small schema-version detector and keep `validateClaims` consuming normalized record arrays. Do not introduce a second runtime dependency.

Preserve v1's historical empty-only `contradiction_ids` behavior. In v2, remove `contradiction_ids` from the generic non-production-evidence prohibition and validate it as the explicit unresolved-conflict relationship described above. This versioned exception is the mechanism behind the precedence rule that conflicts are registered rather than silently erased; it does not grant production authority.

Historical Phase 0 builders and `validate-run-manifest.ts` remain scoped to the 23-record v1 bytes at their reviewed commits. They are not invoked with the canonical 41-record v2 Registry. Add a compatibility test that the mixed historical-manifest/current-v2 use fails closed with the inventory mismatch; the P0.1 successor tool is the v2 evidence consumer.

Run all four focused suites. Expected: PASS.

- [ ] **Step 3: Review and commit**

Reviewer checks v1 byte preservation, complete callers, deterministic migration, cycle detection, exact fields, and that no RA row can be promoted merely by migration.

Commit message: `feat(oracle): add requirement registry schema v2`

## Task 3: Register RA Requirements and Prohibited Claims

### Files

- Modify: `docs/superpowers/registry/oracle-lab-requirements.json`
- Modify: `docs/superpowers/registry/oracle-lab-requirement-v2-migration.json`
- Create: `docs/superpowers/registry/oracle-lab-review-requirements.json`
- Modify: `docs/superpowers/registry/oracle-lab-claims.json`
- Modify: `tests/oracle-lab-traceability.test.ts`
- Modify: `tests/oracle-lab-claim-matrix.test.ts`

- [ ] **Step 1: Add inventory and authority failures**

Tests require exactly 41 requirement records: the migrated 23 plus 18 review-amendment records. They also require all eight prohibited conclusions from amendment Section 2.2 to appear as negative, `unverified` Claim Matrix rows linked to appropriate RA requirements.

Tests must fail if:

- any `RA-P0-001..009` or `RA-P1-001..009` is absent or duplicated;
- any RA `source_section` is not exactly `1.1 Normative requirement registry / <its ID>`, or that stable heading/ID row is absent from the adopted amendment;
- an RA row is `locally_verified`, canary-observed, or production-verified;
- priority is confused with phase ownership;
- a `depends_on` edge targets a later roadmap phase; cross-phase semantic links to future work belong in `related_requirements`, not the gate DAG;
- reviewer equals an implementation-only owner where independent review is required;
- a duplicated/refined requirement lacks explicit relationships;
- a prohibition is written as a positive provider-internal conclusion;
- device proof, server acceptance, complete wire equivalence, account safety, private risk rules, profile promotion, or production authorization is overstated.

Expected before Registry edits: FAIL.

The 18-row additions file is not agent-authored policy. It must implement this canonical mapping exactly. Every row has `introduced_after_phase: phase_0`, `implementation_status: deferred`, and `supersedes: []`. `related` contains secondary coverage; it does not create a second primary WP.

| RA ID | Owner | Independent reviewer | Phase | Primary WP | Acceptance gate | Depends on | Refines | Related |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `RA-P0-001` | oracle-profile-owner | profile-compiler-reviewer | `phase_3b` | `WP-R5` | `phase_3b_profile_compiler` | `HA-P0-001`, `HA-P0-002`, `HA-P0-007`, `HA-P0-009` | none | `RA-P1-001`, `RA-P1-002` |
| `RA-P0-002` | oracle-profile-owner | candidate-truthfulness-reviewer | `phase_3b` | `WP-R5` | `phase_3b_minimum_truthful_candidate` | `RA-P0-001`, `HA-P0-009` | none | `RA-P1-002` |
| `RA-P0-003` | policy-broker-sidecar-owner | sidecar-capability-security-reviewer | `phase_4` | `WP-R3` | `phase_4_sidecar_capability_and_replay` | `HA-P0-005`, `AV-B4-001`, `AV-B5-001` | `AV-B5-001` | `RA-P0-004`, `RA-P0-009` |
| `RA-P0-004` | sidecar-destination-owner | destination-enforcement-reviewer | `phase_4` | `WP-R3` | `phase_4_resolve_classify_pin_dial` | `HA-P0-005`, `AV-B6-001` | `AV-B6-001` | `RA-P0-003`, `RA-P0-009` |
| `RA-P0-005` | cross-repository-contract-owner | cross-repository-contract-reviewer | `phase_2` | `WP-R1` | `phase_2_versioned_contract_and_readiness` | `HA-P0-006` | `HA-P0-006` | `RA-P0-001`, `RA-P1-007` |
| `RA-P0-006` | account-authority-owner | account-lifecycle-security-reviewer | `phase_4` | `WP-R2` | `phase_4_account_authority_lifecycle` | `HA-P0-006`, `RA-P0-005` | none | `HA-P1-005`, `RA-P1-006` |
| `RA-P0-007` | response-outcome-owner | response-authority-reviewer | `phase_4` | `WP-R7` | `phase_4_layered_response_outcome_facts` | `RA-P0-005`, `HA-P1-003` | `HA-P1-003` | `RA-P1-009` |
| `RA-P0-008` | gateway-deployment-owner | deployment-boundary-reviewer | `phase_1` | `WP-R8` | `phase_1_loopback_remote_tls_guard` | `HA-P0-005` | none | `RA-P1-007` |
| `RA-P0-009` | protected-production-gate-owner | protected-boundary-security-reviewer | `phase_4` | `WP-R3` | `phase_4_protected_production_gate` | `HA-P0-005`, `RA-P0-003`, `RA-P0-004`, `RA-P0-008` | `HA-P0-005` | `AV-B4-001`, `AV-B5-001`, `AV-B6-001` |
| `RA-P1-001` | oracle-matrix-owner | evidence-coverage-reviewer | `phase_3a` | `WP-R4` | `phase_3a_change_point_matrix` | `HA-P1-001`, `HA-P1-002` | `HA-P1-001`, `HA-P1-002` | `RA-P0-001`, `RA-P1-008` |
| `RA-P1-002` | profile-coherence-owner | coherent-profile-reviewer | `phase_3b` | `WP-R5` | `phase_3b_coherent_profile_outputs` | `RA-P0-001`, `RA-P1-001` | `HA-P0-009` | `RA-P0-002`, `RA-P1-003` |
| `RA-P1-003` | protocol-drift-owner | drift-fixture-reviewer | `phase_3a` | `WP-R4` | `phase_3a_bounded_drift_fixtures` | `RA-P1-001`, `HA-P1-003` | `HA-P1-003` | `RA-P1-002` |
| `RA-P1-004` | task-lineage-owner | session-migration-reviewer | `phase_4` | `WP-R6` | `phase_4_task_lineage_and_migration` | `RA-P0-005`, `RA-P1-002` | none | `RA-P1-005`, `RA-P1-009` |
| `RA-P1-005` | device-proof-owner | device-trust-reviewer | `phase_2` | `WP-R6` | `phase_2_device_proof_or_negative_capability` | `RA-P0-005` | none | `RA-P1-004` |
| `RA-P1-006` | sub2api-credential-owner | credential-lifecycle-reviewer | `phase_4` | `WP-R2` | `phase_4_refresh_rotation_restart` | `RA-P0-006` | `RA-P0-006` | `HA-P1-005` |
| `RA-P1-007` | gateway-readiness-owner | readiness-replica-reviewer | `phase_4` | `WP-R8` | `phase_4_readiness_replica_consistency` | `RA-P0-005`, `RA-P0-003` | none | `RA-P0-008` |
| `RA-P1-008` | hermetic-host-guard-owner | control-plane-observation-reviewer | `phase_3a` | `WP-R4` | `phase_3a_paired_nonessential_traffic` | `RA-P1-001` | none | `RA-P1-003` |
| `RA-P1-009` | gateway-security-boundary-owner | modular-security-reviewer | `phase_4` | `WP-R6` | `phase_4_incremental_security_boundary_split` | `RA-P0-005`, `RA-P0-007`, `RA-P1-004` | none | `RA-P0-007`, `RA-P1-004` |

For dependency validation, the only phase order is `phase_0 < phase_1 < phase_2 < phase_3a < phase_3b < phase_4 < phase_5 < phase_6a < phase_6b`; same-phase dependencies are allowed and `related_requirements` does not create a gate edge. Every RA row uses source document `2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md`, source section `1.1 Normative requirement registry / <its exact ID>`, precedence `review_amendments`, priority `P0` for `RA-P0-*` or `P1` for `RA-P1-*`, `implementation_status: deferred`, empty implementation/test/production/deployment arrays, null verification timestamps/expiry, and `known_gaps: ["implementation_not_started"]`. The primary repository is `cc-gateway`, except `RA-P0-006` and `RA-P1-006`, whose primary repository is `Sub2API`; cross-repository coverage remains explicit in owners, related requirements, and phase slices.

The eight Claim Matrix additions are also fixed inputs. `server_dependency`, `stability_class`, and `confidence` are not left to the implementer:

| Claim ID | Requirement IDs | Class | Server dependency | Stability | Confidence | Required negative statement |
| --- | --- | --- | --- | --- | --- | --- |
| `CL-OFFICIAL-CLIENT-IDENTITY-PROHIBITED` | `RA-P1-002` | `provider_internal` | `provider` | `provider-unknown` | `1.0` | Matching local headers does not prove official-client identity. |
| `CL-CCH-SERVER-ACCEPTANCE-PROHIBITED` | `RA-P1-001` | `provider_internal` | `server` | `server-version-dependent` | `1.0` | Local CCH verification does not prove server acceptance. |
| `CL-DEVICE-PROOF-PROHIBITED` | `RA-P1-005` | `provider_internal` | `provider` | `provider-unknown` | `1.0` | A stable `device_id` is not trusted-device proof. |
| `CL-TLS-WIRE-EQUIVALENCE-PROHIBITED` | `RA-P0-003`, `RA-P1-001` | `local_observational` | `local` | `transport-version-dependent` | `1.0` | A local TLS summary does not prove complete wire equivalence. |
| `CL-LONG-TERM-ACCOUNT-SAFETY-PROHIBITED` | `RA-P0-009` | `provider_internal` | `provider` | `longitudinal-provider-dependent` | `1.0` | One successful request does not prove long-term account safety. |
| `CL-CHANGELOG-RISK-RULES-PROHIBITED` | `RA-P1-001` | `provider_internal` | `provider` | `provider-private` | `1.0` | Public changelog entries do not reveal private risk-control rules. |
| `CL-NEWER-PERSONA-PROMOTION-PROHIBITED` | `RA-P1-002` | `local_structural` | `local` | `profile-version-dependent` | `1.0` | A newer client version cannot select a newer outbound persona without profile authority. |
| `CL-LOCAL-EVIDENCE-PRODUCTION-PROHIBITED` | `RA-P0-009` | `provider_internal` | `provider` | `deployment-gated` | `1.0` | Local or mock evidence does not authorize production traffic. |

All eight additions use `authority_state: unverified`, `observation_scope: local`, `evidence_ids: []`, `contradiction_ids: []`, `expiry: null`, empty canary/gate/rollback/deployed-artifact arrays, `derived_from: review-amendments-section-2.2`, and `authoritative_provider_disclosure: false`.

- [ ] **Step 2: Generate and validate canonical v2**

Migrate all 23 legacy rows with explicit metadata, then deterministically assemble the 18 checked-in additions. All RA rows remain `deferred`; defining or registering them is not implementation. Keep implementation files, verification commands, and evidence empty or explicitly future-bound where no implementation exists.

Use the canonical relationships above. Do not manufacture a target ID for the prose-only fixed-three-run rule; document its source-section supersession in the amendment and roadmap instead.

Run:

```bash
npm exec tsx tools/oracle-lab/migrate-requirements-v1-to-v2.ts -- \
  --registry-v1 docs/superpowers/registry/oracle-lab-requirements-v1.json \
  --mapping docs/superpowers/registry/oracle-lab-requirement-v2-migration.json \
  --additions docs/superpowers/registry/oracle-lab-review-requirements.json \
  --check docs/superpowers/registry/oracle-lab-requirements.json
npm exec tsx tests/oracle-lab-traceability.test.ts
npm exec tsx tests/oracle-lab-claim-matrix.test.ts
```

Expected: deterministic check and both suites PASS.

- [ ] **Step 3: Review and commit**

Requirements reviewer performs an ID-by-ID source, owner, reviewer, phase, WP, relationship, gate, and status audit. Claims reviewer checks authority ceilings and negative wording.

Commit message: `docs(oracle): register review amendment requirements`

## Task 4: Create the RA-CURRENT Observation Ledger

### Files

- Create: `docs/superpowers/schemas/oracle-lab-current-observation.schema.json`
- Create: `docs/superpowers/registry/oracle-lab-current-observations.json`
- Create: `tools/oracle-lab/validate-current-observations.ts`
- Create: `tests/oracle-lab-current-observations.test.ts`

- [ ] **Step 1: Define failing ledger tests**

The ledger is evidence, not a requirement registry. It must contain exactly `RA-CURRENT-001..010` and classify each as `confirmed`, `partial`, `changed`, `resolved`, or `stale` against named repository commits.

Require for every row:

- source section and revalidation timestamp;
- repository/commit bindings;
- repository-relative files, symbols or test names, and exact verification command;
- bounded evidence/result digest, observation scope, confidence, phase slices, and WP umbrella;
- required consequence and prohibited promotion;
- append-only status history when a row changes. Each event contains `previous_event_digest`; the first event uses `null`. The validator recomputes every event digest and rejects deletion, modification, insertion before the tail, or reordering of prior events.

Reject absolute paths, raw output, credentials, prompts, account/proxy identifiers, missing commits, unknown states, or unregistered WP/phase values.

Expected before implementation: FAIL.

- [ ] **Step 2: Seed from current-main evidence**

The implementer must use this canonical reconnaissance map rather than rediscovering or inventing evidence anchors:

| ID | Initial state | Repository-relative anchors and symbols/tests | Verification IDs | Phase slices | Primary WP | Required consequence | Prohibited promotion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `RA-CURRENT-001` | `confirmed` | CC: `tools/claude-native-oracle-matrix.ts#DEFAULT_VERSION,runNativeOracleMatrix,runMockProfile,runRealProfile`; `tests/native-oracle-matrix.test.ts` | `OBS001-T` | `phase_3a` | `WP-R4` | Expand the version/change-point evidence matrix before profile synthesis. | Existing 2.1.179 harness cannot satisfy 2.1.207 evidence or profile completion. |
| `RA-CURRENT-002` | `confirmed` | CC: `src/persona-registry.ts#PersonaProfile,REGISTRY`; `src/proxy.ts#sameRuntimeMappingAuthorityAllowingCanonicalPromotion,isAllowedRuntimeCanonicalPromotion`; `tests/persona-registry.test.ts`; `tests/formal-pool-canonical-promotion.test.ts` | `OBS002-T1`, `OBS002-T2` | `phase_3b` | `WP-R5` | Generate a coherent 2.1.207 profile from accepted evidence. | No handwritten 2.1.207 persona or outbound-persona promotion. |
| `RA-CURRENT-003` | `confirmed` | CC: `src/proxy.ts#handleRequest,RawCaptureSink`; `src/egress-sidecar-client.ts#EgressSidecarStreamResponse`; `tests/formal-pool-real-chain-mock-response.test.ts` | `OBS003-G`, `OBS003-T` | `phase_3a`, `phase_4` | `WP-R7` | Capture evidence, then implement bounded layered response/outcome facts. | Transparent pipe/chunk capture cannot authorize retry, cost, budget, scheduler, or quarantine decisions. |
| `RA-CURRENT-004` | `partial` | Sub: `backend/internal/service/formal_pool_onboarding_service.go#FormalPoolCCGatewayRuntimeRegistrar,RegisterCCGatewayRuntime`; CC: `src/proxy.ts#RUNTIME_REGISTER_PATH,sameRuntimeMappingAuthorityAllowingCredentialRotation,isAllowedRuntimeCanonicalPromotion,sameRuntimeMappingAuthorityAllowingTLSProfileBackfill` | `OBS004-SUB`, `OBS004-CC` | `phase_2`, `phase_4` | `WP-R2` | Preserve known re-registration rotation/promotion/TLS-backfill behavior while designing the full signed lifecycle. | No freeze/drain/revoke/delete/query/reconcile or complete lifecycle claim. |
| `RA-CURRENT-005` | `confirmed` | CC: `src/egress-sidecar-client.ts#EgressSidecarControl`; `sidecar/egress-tls-sidecar/internal/control/control.go#Control,Validate`; `sidecar/egress-tls-sidecar/internal/server/server.go`; Phase 0 B4-B6 RED tests | `OBS005-CC`, `OBS005-GO-RED` | `phase_2`, `phase_4` | `WP-R3` | Specify then implement request capability, replay ledger, and resolve/classify/pin/dial enforcement. | Protected production and real canary remain disabled. |
| `RA-CURRENT-006` | `confirmed` | Sub: `backend/internal/service/cc_gateway_adapter.go#ccGatewayGeneratedDeviceID,ccGatewayDeviceID`; CC: `src/proxy.ts#normalizeRuntimeAccountMapping,verifyProviderAwareFinalRequest` | `OBS006-SUB`, `OBS006-CC` | `phase_2`, `phase_3b` | `WP-R6` | Record trusted-device proof as an unavailable capability until independent issuer/verifier lifecycle exists. | Stable/equal `device_id` is not device proof. |
| `RA-CURRENT-007` | `confirmed` | CC: `src/proxy.ts#ProxyRuntimeState,replayRuntimeMappings,RUNTIME_MAPPING_FILE_ENV,FORMAL_POOL_SESSION_LEDGER_FILE_ENV`; `/_health` branch; `tests/health-verify.test.ts` | `OBS007-G`, `OBS007-T` | `phase_2`, `phase_4` | `WP-R8` | Add versioned readiness and later shared/replica-consistent authority. | No multi-replica readiness or production capability claim. |
| `RA-CURRENT-008` | `confirmed` | CC: `src/config.ts#Config.server.host`; `src/proxy.ts#startProxy,listenHost`; `tests/security-boundary.test.ts` default `::` assertion | `OBS008-G`, `OBS008-T` | `phase_1`, `phase_4` | `WP-R8` | Plan loopback fail-closed guard in Phase 1 and implement remote TLS/auth/certificate gates before deployment. | No remote-listen or production authorization. |
| `RA-CURRENT-009` | `confirmed` | Sub: `backend/internal/service/claude_platform_aws_full_chain_e2e_test.go#cp6AWSGatewayConfigYAML,TestClaudePlatformAWSLocalFullChainE2EUsesCCGatewayAndSafeMockUpstream`; `backend/internal/service/local_capture_acceptance_artifact_test.go#jointGatewayConfigYAML,jointGatewaySigningConfigYAML,jointGatewayDisabledConfigYAML,TestJointLocalCaptureAcceptanceArtifact` | `OBS009-RED-A`, `OBS009-RED-B` | `phase_2` | `WP-R1` | Preserve the frozen P0.1 failure, repair only four fixture blocks, and add both tests to GREEN. | Joint-chain evidence is not GREEN until the append-only resolved event exists. |
| `RA-CURRENT-010` | `confirmed` | CC: `src/proxy.ts#startProxy,handleRequest,ProxyRuntimeState,RawCaptureSink,RUNTIME_REGISTER_PATH` and CodeGraph file/symbol counts | `OBS010-G` | `phase_4` | `WP-R6` | Split only touched security boundaries incrementally, with `WP-R7` related response ownership. | No big-bang refactor and no claim that current concentrated logic is independently reviewable. |

Verification IDs are exact commands. CodeGraph commands run against the already indexed worktree and test commands inherit `HERMETIC_NETWORK_ENV`; only bounded digests and named outcomes enter the ledger:

| Verification ID | Working directory | Argv / expected classification |
| --- | --- | --- |
| `OBS001-T` | CC root | `npm exec tsx tests/native-oracle-matrix.test.ts` / PASS |
| `OBS002-T1` | CC root | `npm exec tsx tests/persona-registry.test.ts` / PASS |
| `OBS002-T2` | CC root | `npm exec tsx tests/formal-pool-canonical-promotion.test.ts` / PASS |
| `OBS003-G` | CC root | `codegraph explore "handleRequest RawCaptureSink EgressSidecarStreamResponse pipe Buffer.concat"` / anchors present, no `OutcomeEnvelope` owner |
| `OBS003-T` | CC root | `npm exec tsx tests/formal-pool-real-chain-mock-response.test.ts` / PASS |
| `OBS004-SUB` | Sub root | `codegraph explore "FormalPoolCCGatewayRuntimeRegistrar RegisterCCGatewayRuntime freeze drain revoke delete query reconcile"` / register present, full lifecycle absent |
| `OBS004-CC` | CC root | `codegraph explore "RUNTIME_REGISTER_PATH sameRuntimeMappingAuthorityAllowingCredentialRotation isAllowedRuntimeCanonicalPromotion sameRuntimeMappingAuthorityAllowingTLSProfileBackfill"` / limited paths present |
| `OBS005-CC` | CC root | `codegraph explore "EgressSidecarControl Control replay nonce deadline body hash header hash attempt key epoch resolve classify pin dial"` / missing capability/replay fields confirmed |
| `OBS005-GO-RED` | CC `sidecar/egress-tls-sidecar` | `go test -tags=phase0red ./internal/control ./internal/server -count=1` / expected FAIL with stable B5/B6 names |
| `OBS006-SUB` | Sub root | `codegraph explore "ccGatewayGeneratedDeviceID ccGatewayDeviceID scopedStickyHMACBytes"` / HMAC-derived ID path present |
| `OBS006-CC` | CC root | `codegraph explore "normalizeRuntimeAccountMapping verifyProviderAwareFinalRequest device_id equality"` / format/equality checks present, issuer/verifier absent |
| `OBS007-G` | CC root | `codegraph explore "ProxyRuntimeState replayRuntimeMappings RUNTIME_MAPPING_FILE_ENV FORMAL_POOL_SESSION_LEDGER_FILE_ENV /_health"` / process-map/local-file authority present |
| `OBS007-T` | CC root | `npm exec tsx tests/health-verify.test.ts` / PASS |
| `OBS008-G` | CC root | `codegraph explore "Config server.host startProxy listenHost server.listen"` / configured host passed to listen |
| `OBS008-T` | CC root | `npm exec tsx tests/security-boundary.test.ts` / PASS including current default `::` behavior |
| `OBS009-RED-A` | Sub `backend` with `CC_GATEWAY_REPO_ROOT` set to the CC worktree | `go test ./internal/service -run ^TestClaudePlatformAWSLocalFullChainE2EUsesCCGatewayAndSafeMockUpstream$ -count=1 -v` / expected FAIL at frozen base with `gateway_compromise_boundary is required` |
| `OBS009-RED-B` | Sub `backend` with `CC_GATEWAY_REPO_ROOT` set to the CC worktree | `go test ./internal/service -run ^TestJointLocalCaptureAcceptanceArtifact$ -count=1 -v` / expected FAIL at frozen base with `gateway_compromise_boundary is required` |
| `OBS010-G` | CC root | `codegraph node src/proxy.ts` / one 4,726-line file with concentrated runtime/request/response/control ownership at the frozen base |

The validator requires every verification ID exactly once where listed, validates its cwd/repository binding and environment profile, and rejects a changed anchor/symbol/test name unless a later append-only revalidation event explains the drift.

For `RA-CURRENT-009`, canonicalize the bounded safe classifications and named failure codes from `OBS009-RED-A` and `OBS009-RED-B` in verification-ID order and store one aggregate `sha256:` result digest. Raw Go output is not persisted.

The ledger header binds the immutable Task 0B entry digest. Every later append also binds the prior committed ledger digest and commit, so Task 5 can prove that it appended a resolution rather than rewriting the original event.

Do not claim provider behavior. Do not mark device proof available. Keep protected production, real canary, and multi-replica authority disabled.

Run: `npm exec tsx tests/oracle-lab-current-observations.test.ts`.

Expected: PASS.

- [ ] **Step 3: Review and commit**

Evidence reviewer re-runs every cheap structural command and spot-checks all CodeGraph paths. Commit message: `docs(oracle): record p0.1 current observations`.

## Task 5: Repair the Local Joint-Test Fixture Drift

### Sub2API Files

- Modify: `backend/internal/service/claude_platform_aws_full_chain_e2e_test.go`
- Modify: `backend/internal/service/local_capture_acceptance_artifact_test.go`

### CC Gateway Files

- Modify: `docs/superpowers/registry/oracle-lab-current-observations.json`

- [ ] **Step 1: Retain the reproduced RED result**

The pre-fix failure from the frozen base is evidence and remains in the `RA-CURRENT-009` history. Do not rewrite it as if P0 had covered these tests.

- [ ] **Step 2: Apply the fixture-only correction**

In all four local-capture YAML `shared_pool` blocks add both:

```yaml
gateway_compromise_boundary: protected_gateway
upstream_mode: local-capture
```

The exact generators are:

- `cp6AWSGatewayConfigYAML` at the `shared_pool` block in `claude_platform_aws_full_chain_e2e_test.go`;
- `jointGatewayConfigYAML`;
- `jointGatewaySigningConfigYAML`;
- `jointGatewayDisabledConfigYAML`.

Do not select `trusted_gateway`. Do not change CC Gateway production behavior, the shared contract, or the test scenarios.

Run from Sub2API `backend`:

```bash
npm_config_offline=true npm_config_audit=false npm_config_fund=false \
GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local \
HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 \
NO_PROXY=127.0.0.1,localhost \
CC_GATEWAY_REPO_ROOT=/Users/muqihang/chelingxi_workspace/cc-gateway-oracle-p0-1 \
go test ./internal/service \
  -run 'Test(ClaudePlatformAWSLocalFullChainE2EUsesCCGatewayAndSafeMockUpstream|JointLocalCaptureAcceptanceArtifact)$' \
  -count=1 -v
```

Expected: both tests PASS with local/mock destinations only.

Then run:

```bash
npm_config_offline=true npm_config_audit=false npm_config_fund=false \
GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local \
HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 \
NO_PROXY=127.0.0.1,localhost \
go test ./internal/service ./internal/server/routes \
  -run 'FormalPool|FormalPoolOperations' -count=1
```

Expected: PASS.

- [ ] **Step 3: Review and commit the Sub2API fixture correction**

An independent Sub2API reviewer confirms the diff is test-only, contains exactly the four YAML block changes in the two named files, preserves all scenarios, and uses only `protected_gateway` plus `local-capture`. A security reviewer confirms the executed destinations are loopback/mock only. If the repair needs product code, the shared contract, or any fifth Sub2API file, stop Task 5 and move that work to a separately planned `WP-R1` slice.

Commit only the two Sub2API test files.

Sub2API commit message: `test: restore protected gateway local-chain fixtures`

Capture the resulting 40-character Sub2API commit and prove its parent is the frozen Sub2API base before editing the CC Gateway ledger.

- [ ] **Step 4: Append and validate the observation history**

Append a `resolved` revalidation event for `RA-CURRENT-009` bound to the exact committed Sub2API fix head and to the prior committed CC Gateway ledger digest/commit. Preserve the original confirmed event. The broader missing versioned readiness handshake remains deferred under `RA-P0-005`; only the fixture drift is resolved. Re-run `npm exec tsx tests/oracle-lab-current-observations.test.ts` and require PASS.

- [ ] **Step 5: Independently review and commit the ledger append**

An evidence reviewer who did not author the append verifies the Sub2API commit object, both GREEN results, prior-event digest chain, unchanged original event, and the narrow resolution statement. `RA-P0-005` remains `deferred` regardless of fixture success.

Add a transition test for an authorized future fixture revert: the validator must reject a ledger that still ends in `resolved` at the reverted Sub2API head, reject deletion of the resolved event, and accept only a later append-only `changed` or `stale` event bound to the new commit and prior event digest. This test defines rollback truthfulness; P0.1 itself does not perform a revert.

CC Gateway ledger commit message: `docs(oracle): resolve joint fixture drift observation`

## Task 6: Implement and Review the H0.1 Successor Tooling

### Files

- Modify: `docs/superpowers/plans/2026-07-12-claude-code-2.1.207-p0-1-wp-r0-governance-reconciliation.md`
- Modify: `package.json`
- Create: `docs/superpowers/schemas/oracle-lab-governance-amendment-exit.schema.json` (including both repositories' safe initial ignored-inventory summaries)
- Create: `docs/superpowers/schemas/oracle-lab-governance-amendment-command-catalog.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-governance-amendment-command-results.schema.json` (including both repositories' safe initial/terminal ignored-inventory summaries)
- Create: `docs/superpowers/schemas/oracle-lab-governance-amendment-context.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-governance-amendment-handoff.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-governance-amendment-receipt.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-governance-amendment-report.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-governance-amendment-review-import.schema.json`
- Create: `docs/superpowers/schemas/oracle-lab-governance-amendment-review.schema.json`
- Create: `docs/superpowers/registry/oracle-lab-governance-amendment-command-catalog.json`
- Create: `tools/oracle-lab/governance-amendment-evidence.ts` (including the local cross-stage two-repository journal)
- Create: `tools/oracle-lab/ignored-path-inventory.ts` (including fixed joint-surface modes)
- Modify: `tests/oracle-lab-post-integration-entry.test.ts`
- Modify: `tests/oracle-lab-post-integration-handoff.test.ts`
- Create: `tests/run-p0-1.ts`
- Create: `tests/oracle-lab-ignored-path-inventory.test.ts` (including direct mode-only negatives for every joint-surface node)
- Create: `tests/oracle-lab-governance-amendment-evidence.test.ts` (including bounded real-production-CLI cross-stage continuity and spawned mode negatives)

Task 6 creates no real exit/result/context/handoff/receipt artifact. Those artifacts may only be generated by the committed, independently reviewed Task 6 tool in Task 7.

- [ ] **Step 1: Add failing evidence-chain tests**

The successor chain is new. Existing Phase 0 and post-integration tools are hard-coded to historical heads, branches, command counts, and artifact sets; do not mutate them into P0.1 tools.

Tests must reject:

- missing parent P0 or post-integration V2 receipt bindings;
- a changed P0.1 entry baseline;
- uncommitted or unreviewed implementation heads;
- missing amendment, Registry, Claims, Roadmap, observation ledger, schema, validator, plan, review-import, or review digest;
- review-import bytes not generated from the named original/adopted amendment pair;
- review attestations with wrong repository heads/diff digests, duplicate reviewer identity or role, a non-`approved` decision, or nonzero Critical/Important counts;
- a command catalog missing either joint test;
- any catalog entry missing or overriding the exact npm-offline, Go-offline/local-toolchain, and proxy-deny `HERMETIC_NETWORK_ENV`;
- a joint command without `CC_GATEWAY_REPO_ROOT=${CC_GATEWAY_ROOT}`;
- a joint command that does not bind both repository heads, both before/after worktree snapshots, and the shared-contract digest;
- wrong CC Gateway head, wrong Sub2API head, any undeclared dirty path, or mutation of either repository outside the exact declared evidence-output set during the joint command;
- persistent ignored regular-file creation, modification, deletion, mode/type change, directory change, symlink creation, or symlink-target change in either repository;
- a missing, unknown, or misplaced ignored-output policy, any free-form ignored path allowance, or a joint allowance with the wrong date/name/count/type/size, a third leaf, deletion, symlink, or drift outside the exact safe-deliverable surface;
- unexpected pass/fail classification or incomplete GREEN/RED inventory;
- timeout, oversized output, or a surviving descendant process after termination;
- expired context/handoff, an invalid canonical report, a Markdown report that is not the exact deterministic render of its canonical JSON, unknown fields, path escape, symlink output, or unsafe evidence;
- pre-commit receipt validation with an invalid schema, wrong artifact commit, or mismatched bound artifact bytes;
- a receipt commit whose parent is not the artifact commit, whose diff is not exactly the one receipt path, or whose committed receipt bytes differ from the validated worktree bytes;
- P1 handoff that enables any deferred capability.

Expected before implementation: FAIL.

- [ ] **Step 2: Implement a narrow, bounded successor tool**

Reuse `harness-core.ts` and `computeRepositoryState`. Add package script `oracle:p0-1` that invokes `tsx tools/oracle-lab/governance-amendment-evidence.ts`.

Commands execute with argv arrays and `shell: false`; inherited environment is allowlisted. Hash stdout/stderr incrementally without retaining the full stream. Retain at most 8 MiB of bounded output for redaction/failure-name extraction; exceeding the bound is an unexpected failure. On timeout or overflow terminate the child process group, wait a bounded grace period, then force termination. Tests prove descendants do not survive.

Successor commands run sequentially in one declared artifact chain. `capture-exit` starts from two clean reviewed repositories and atomically creates the first output only after the clean snapshot. Every later subcommand accepts only the exact, schema-valid prior outputs named by the manifest/catalog as an allowlist; it rejects any other tracked or untracked delta. Child-process before/after snapshots cover both repositories while excluding only those immutable prior outputs, and the current `--out` is written with no-follow/atomic semantics after the child exits. Tests prove that a same-prefix extra file, changed prior output, symlink, or mutation outside the exact allowlist fails closed.

`capture-exit` also initializes one local journal with the canonical CC Gateway and Sub2API roots and the exact safe ignored-inventory summaries captured into the exit evidence. Absolute roots remain local journal state and never enter evidence. Every later artifact-chain stage recomputes both inventories before accepting prior outputs and requires equality with the preceding accepted terminal summaries. GREEN initial state equals exit; GREEN advances the terminal only after the exact joint allowance is accepted; RED initial equals GREEN terminal. Merge, report, controller-report, context, handoff, and receipt preserve that terminal. A failed stage never advances the journal, and residue or between-stage drift remains blocking pending operator-approved cleanup.

The exit schema exposes each repository's safe initial ignored summary. GREEN, RED, and merged result sets bind safe initial/terminal summaries into their self-digests. Merge and receipt validation re-read the separate exit, GREEN, RED, and merged artifacts and prove exit-to-GREEN-to-RED continuity from those evidence bytes, so the mutable local journal is not the only continuity claim. Production negatives use shared sparse checkpoints and the real npm/main boundary for persistent create, modify, delete, type, mode, and symlink-target drift in both repositories across both capture-exit-to-GREEN and GREEN-to-RED boundaries.

Plain Git status is not an ignored-path boundary. Each successor snapshot additionally binds the canonical digest of `computeRepositoryState(...).ignored_exclusion_rules`, the fixed ignored-output policy digest, and a complete `git_exclude_standard_recursive_v1` inventory discovered with Git's effective `--exclude-standard` semantics. `tools/oracle-lab/ignored-path-inventory.ts` parses and sorts raw path bytes, recursively inventories regular files/directories/symlinks without following links, streams regular-file SHA-256 through a fixed 1 MiB buffer, binds path/type/mode/size/content/symlink target, excludes volatile filesystem metadata, and fails closed above 100,000 endpoint roots, 250,000 entries, or 1 GiB regular-file bytes. Only summary digests/counts/bytes may be serialized; paths, contents, and symlink targets remain process-local.

The inventory covers current and future Git-ignored endpoints in both repositories, including CC Gateway `node_modules/`, `dist/`, `.codegraph/`, `.superpowers/sdd/`, `.env`, `config.yaml`, `certs/`, `clients/`, and `runtime/`, plus Sub2API `.codegraph/`, `.superpowers/`, and ignored joint-capture directories. The worktree `.git` marker, resolved Git directory, and `oracle-p0-1-chain-state.json` are intentionally excluded because HEAD/branch/status/diff and the chain journal remain explicit independent boundaries; hooks, reflogs, unreachable objects, unrelated Git config, and files outside the two repository roots remain out of scope. Endpoint equality does not claim detection of transient mutate/use/restore behavior between snapshots.

Nine catalog commands use closed policy `none`: every protected ignored record must be endpoint-identical before/after. Only `sub2api-joint-local-chain`, and only for Sub2API, uses `sub2api_joint_safe_deliverable_v1`. It may create or rewrite exactly one command-start/end local-date pair under `docs/anti-ban/captures/real-baseline/YYYY-MM-DD-sub2api-cc-gateway-joint-local-capture/safe-deliverable/`: regular `README.md` (at most 131,072 bytes) and regular `joint_local_capture_summary.redacted.json` (at most 262,144 bytes), total at most 393,216 bytes, with only the necessary real directory nodes. The dated directory and `safe-deliverable/` must each be mode `0755`; both regular leaves must be mode `0644`, and no executable deliverable is accepted. Wrong/second dates, missing/third/wrong leaves, deletion, symlinks, type or mode changes, or any other ignored drift fail closed. The protected projection remains equal and the result record separately binds one safe Sub2API observation containing only the fixed policy digest and before/after inventory digest/count/byte summaries; all other records require an empty observation array, and record/result-set digests cover the observation.

`run` captures one initial CC/Sub snapshot pair per GREEN or RED group and one after pair per child command. Each verified after snapshot is rebound to the next command's closed policy and reused as that command's before snapshot without weakening either per-command before/after digest. This yields 8 pairs for GREEN and 4 for RED. Warm acceptance budgets are at most 2 seconds for either repository's single inventory, target below 20 seconds for all 12 pairs, and hard review threshold below 60 seconds on the reviewed host.

The mandatory GREEN inventory has exactly these catalog IDs and argv:

1. `cc-build`: CC Gateway root, `npm run build`;
2. `cc-tests`: CC Gateway root, `npm test`;
3. `cc-cross-repo-baseline`: CC Gateway root with `SUB2API_ROOT=${SUB2API_ROOT}`, `npm run test:oracle:cross-repo`;
4. `sidecar-tests`: `sidecar/egress-tls-sidecar`, `go test ./... -count=1`;
5. `sub2api-formal-pool`: Sub2API `backend`, `go test ./internal/service ./internal/server/routes -run FormalPool|FormalPoolOperations -count=1`;
6. `sub2api-joint-local-chain`: Sub2API `backend` with `CC_GATEWAY_REPO_ROOT=${CC_GATEWAY_ROOT}`, `go test ./internal/service -run ^(TestClaudePlatformAWSLocalFullChainE2EUsesCCGatewayAndSafeMockUpstream|TestJointLocalCaptureAcceptanceArtifact)$ -count=1 -v`, with dual-repository binding;
7. `p0-1-focused`: CC Gateway root, `npm run test:oracle:p0-1`.

Every catalog entry uses the exact `HERMETIC_NETWORK_ENV` from Global Constraints, including `GOPROXY=off`, `GOSUMDB=off`, and `GOTOOLCHAIN=local` for direct Go commands and Go children of npm tests. The catalog validator rejects omission or override, and a missing cached module/toolchain is an unexpected fail-closed result rather than permission to download.

`tests/run-p0-1.ts` imports exactly the hermetic-dependency, entry, overlay, traceability, claim-matrix, current-observation, harness, reviewed-snapshot-binding, and successor-evidence test files in a fixed order. It is not named `*.test.ts`, so the existing full `tests/run-all.ts` does not execute the focused suite twice. Add package script `test:oracle:p0-1` as `tsx tests/run-p0-1.ts`.

The mandatory expected-RED inventory remains CC Gateway B4-B6, sidecar B4-B6, and Sub2API B1-B3. The repaired joint tests are GREEN, never expected RED.

- [ ] **Step 3: Define and test the CLI contract**

Every subcommand returns `0` only for a schema-valid artifact and accepted classifications:

```bash
npm run oracle:p0-1 -- capture-exit --entry <entry> --entry-receipt <receipt> --cc-gateway-root <root> --sub2api-root <root> --out <exit>
npm run oracle:p0-1 -- run --manifest <exit> --catalog <catalog> --group green --cc-gateway-root <root> --sub2api-root <root> --out <green>
npm run oracle:p0-1 -- run --manifest <exit> --catalog <catalog> --group red --cc-gateway-root <root> --sub2api-root <root> --out <red>
npm run oracle:p0-1 -- merge --manifest <exit> --green <green> --red <red> --out <results>
npm run oracle:p0-1 -- review-import --review-source <source> --adopted-amendment <adopted> --out <import>
npm run oracle:p0-1 -- validate-review-import --review-import <import> --review-source <source> --adopted-amendment <adopted>
npm run oracle:p0-1 -- validate-reviews --requirements-review <review> --security-review <review> --review-import <import> --cc-gateway-root <root> --sub2api-root <root>
npm run oracle:p0-1 -- report --manifest <exit> --results <results> --requirements-review <review> --security-review <review> --out <report-json> --markdown <report-md>
npm run oracle:p0-1 -- controller-report --manifest <exit> --results <results> --requirements-review <review> --security-review <review> --report <report-json> --report-markdown <report-md> --out <controller-json> --markdown <controller-md>
npm run oracle:p0-1 -- validate-report --report <report-json> --markdown <report-md>
npm run oracle:p0-1 -- context --manifest <exit> --results <results> --review-import <import> --requirements-review <review> --security-review <review> --report <report-json> --report-markdown <report-md> --controller-report <controller-json> --controller-report-markdown <controller-md> --out <context>
npm run oracle:p0-1 -- handoff --manifest <exit> --results <results> --context <context> --report <report-json> --report-markdown <report-md> --controller-report <controller-json> --controller-report-markdown <controller-md> --out <handoff>
npm run oracle:p0-1 -- receipt --artifact-commit <commit> --manifest <exit> --results <results> --context <context> --handoff <handoff> --report <report-json> --report-markdown <report-md> --controller-report <controller-json> --controller-report-markdown <controller-md> --out <receipt>
npm run oracle:p0-1 -- validate-receipt --receipt <receipt> --artifact-commit <commit>
npm run oracle:p0-1 -- validate-receipt --receipt <receipt> --artifact-commit <commit> --receipt-commit <receipt-commit>
```

Formal artifact dispatch is module-private. The executable `main` path always
uses one frozen production runtime; no exported TypeScript API, CLI flag,
environment variable, import hook, or optional callback may replace the
repository root, bounded process runner, CodeGraph inspector, or output sink.
Tests must prove that `runCliEntry`, `dispatch`, and
`PRODUCTION_CLI_RUNTIME` are absent from the runtime module namespace and that
a native ESM named import of `runCliEntry` fails to link.

The complete positive chain is accepted only through 16 separate OS processes
using an absolute real npm executable and
`npm run oracle:p0-1 -- <subcommand> ...`. The sequence covers all 13 distinct
subcommands, including both `run` groups, both report validations, and receipt
validation before and after the receipt-only commit. Its disposable topology
uses shared no-checkout sparse clones, 30 exact materialized CC Gateway tracked
inputs (including the statically imported
`tools/oracle-lab/ignored-path-inventory.ts`), four exact Sub2API tracked
inputs, and fixed sparse patterns for generated evidence. Both clone-local
CodeGraph indexes are created and queried by the real CodeGraph CLI, have
positive counts and no pending/mismatch/reindex state, and bind the SHA-256 of
their own regular SQLite database.

Only the ten reviewed catalog child `npm`/`go` executables may be shortened by
external PATH shims. The outer npm, clone-local tsx, `cli(main)`, Git, CodeGraph,
schemas, snapshots, stage journal, artifact commit, receipt commit, and receipt
validation remain real. Shims fail closed on unknown argv/cwd, write an
external audit that binds exact argv, cwd, environment keys/values, and command
order, and cannot provide `git`, `codegraph`, `node`, or `tsx`. The fixture must
observe 16/16 accepted outer process exits, 13/13 supported subcommands, 10/10
audited catalog children, both CodeGraph statuses, steady disk below 30 MiB,
observed peak below 60 MiB, and elapsed time no greater than 90 seconds.

GREEN/RED/merged results share one strict results schema. Exit and controller reports share one strict report schema with a `report_type` discriminator. Each report command stages and exclusively publishes a canonical JSON artifact and its exact deterministic Markdown rendering with no-follow path checks, then accepts the pair as a completed stage only after both on-disk files pass exact schema/semantic/render validation and one chain-state transition binds both digests. `validate-report` regenerates the Markdown from JSON, requires byte equality, and requires that accepted chain binding. A crash can leave one or both exclusive output paths as an incomplete residue that blocks validation and later stages until operator-approved cleanup; the contract does not claim simultaneous physical visibility of two POSIX pathnames. No-follow/exclusive pathname checks reject persistent leaf or ancestor symlinks observed at check/use boundaries, but Node's pathname APIs do not provide `openat`-style protection against a concurrent same-user ancestor replacement between those boundaries. Final Git artifact and receipt commits, not the pre-commit pathname checks, are the integrity anchor. Every other persisted component has its own schema and version.

The two review inputs are strict JSON attestations under `oracle-lab-governance-amendment-review.schema.json`, not free-form Markdown. The tool requires two distinct reviewer identities and the exact roles `requirements` and `security_quality`; both must bind the reviewed candidate heads/diffs, declare `decision: approved`, and contain `critical: 0` plus `important: 0`. Human reasoning may appear only in bounded safe summary arrays covered by the schema.

- [ ] **Step 4: Sync, review, and commit the complete Task 6 prerequisite scope**

Run `codegraph sync && codegraph status`. Commit the successor tooling, schemas, catalog, focused runner/tests, the Task 7 plan prerequisite, and the two freshness-sensitive post-integration test corrections listed above as one reviewed Task 6 scope. H0 reviewer checks command completeness, dual-repository mutation detection, bounded process/output handling, safe output, schemas, and deterministic digests. Requirements reviewer checks every P0.1 exit item is representable. This step still creates no formal Task 7 exit/result/report/context/handoff/receipt artifact.

Commit message: `feat(oracle): add p0.1 successor evidence tooling`

## Task 7: Final Review, Frozen Exit, and Successor Receipt

### Files

- Modify before review: `docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md`
- Create before review: `docs/superpowers/evidence/p0-1/p0-1-review-import.json`
- Create after review, before final capture: `docs/superpowers/evidence/p0-1/requirements-review.json`
- Create after review, before final capture: `docs/superpowers/evidence/p0-1/security-quality-review.json`
- Create after final capture: `docs/superpowers/evidence/p0-1/p0-1-exit-baseline.json`
- Create after final capture: `docs/superpowers/evidence/p0-1/p0-1-green-results.json`
- Create after final capture: `docs/superpowers/evidence/p0-1/p0-1-red-results.json`
- Create after final capture: `docs/superpowers/evidence/p0-1/p0-1-command-results.json`
- Create after final capture: `docs/superpowers/evidence/p0-1/p0-1-exit-report.json`
- Create after final capture: `docs/superpowers/evidence/p0-1/p0-1-exit-report.md`
- Create after final capture: `docs/superpowers/evidence/p0-1/controller-final-report.json`
- Create after final capture: `docs/superpowers/evidence/p0-1/controller-final-report.md`
- Create after final capture: `docs/superpowers/evidence/p0-1/p0-1-context.json`
- Create after final capture: `docs/superpowers/evidence/p0-1/p0-1-handoff.json`
- Create after artifact commit: `docs/superpowers/evidence/p0-1/p0-1-successor-receipt.json`

- [ ] **Step 1: Freeze the review candidate, obtain independent approvals, and commit attestations**

First finalize the Roadmap status as `P0.1 implementation candidate; completion is controlled exclusively by the successor receipt; P1 remains blocked by the integrated-main entry gates`. Use the exact `review-import` and `validate-review-import` subcommands to generate `p0-1-review-import.json` from the original source and committed revised amendment, validate both files, and commit only this final candidate delta.

Candidate commit message: `docs(oracle): freeze p0.1 review candidate`

Dispatch two reviewers:

1. Goal/requirements reviewer checks all four specs, 18 RA records, ten observations, ten WP mappings, phase DAG, precedence, historical immutability, and exit contract.
2. Security/code-quality reviewer checks validators, migration, relationship cycles, evidence path safety, bounded command execution, secret handling, local-only fixture repair, tests, and regression risk.

Both reviewers inspect the exact candidate CC Gateway head, the exact Sub2API fix head, and the complete branch diffs from the frozen bases. Any Critical or Important finding blocks capture. Fix findings in a separate implementation commit, update the candidate bindings, and repeat both reviews from a new candidate head.

Only after both reviewers approve, create the two schema-valid JSON approval files. Each approval binds reviewer identity/role, reviewed CC Gateway and Sub2API heads, frozen-base-to-head diff digests, plan digest, review-import digest, `decision: approved`, zero Critical/Important counts, and bounded verification evidence. Commit only the two approval attestations; no reviewed normative, Registry, Claim, observation, schema, tool, catalog, plan, Roadmap, review-import, or Sub2API file changes after approval.

Approval commit message: `docs(oracle): attest p0.1 governance approval`

Run `validate-reviews` after this commit. It rejects duplicate identities or roles, verifies both approvals against the candidate heads/diffs and review-import, proves the approval commit's parent is the reviewed CC Gateway candidate, and proves the approval commit adds only the two attestation paths. The exit manifest records both `reviewed_candidate_heads` and the CC Gateway approval-attestation head. A later implementation or governance fix invalidates the approvals and restarts both reviews and final capture; only generated exit artifacts and the final receipt may be added afterward.

- [ ] **Step 2: Sync both indexes and capture the clean reviewed exit**

Run `codegraph sync` and `codegraph status` in both worktrees. Capture the exit from clean reviewed heads. The manifest binds both heads, both clean states, shared contract, CodeGraph index digests/counts, all governance/review artifacts, both parent receipts, and the Task 0B entry pair.

Run the GREEN and RED groups separately and merge them. Generate the schema-valid `p0-1-exit-report.json` plus exact `p0-1-exit-report.md` render pair, then generate the schema-valid `controller-final-report.json` plus exact `controller-final-report.md` render pair from the accepted results and two reviews. Run `validate-report` on both pairs. Generate context after both reports with all four explicit report bindings, then generate handoff with the same bindings. At each report step, the successor tool exclusively publishes both files and completes one chain transition binding both verified digests; any incomplete pair or other delta remains unaccepted and aborts validation and later capture. This transaction contract intentionally does not promise simultaneous two-path visibility, and crash residue requires operator-approved cleanup rather than automatic deletion.

Required outcomes:

- all seven GREEN entries pass;
- all three RED entries are `expected_fail` with stable named failures;
- all v1/v2 migration, traceability, claims, overlay, observation, entry, and evidence tests pass;
- both CodeGraph indexes are up to date at the reviewed heads;
- both repositories have no undeclared worktree delta; the only allowed CC Gateway delta is the exact schema-valid P0.1 output chain created so far, and Sub2API remains clean;
- no external request, credential, promotion, deployment, or canary occurs.

Prove deterministic stable fields without deleting or recreating any fixed-path formal output: rely on the reviewed fixed-time builder tests; each producer's schema, semantic, and self-digest validation; deterministic Markdown re-render and byte comparison for both report pairs; and final receipt-chain validation that rehashes every bound artifact against the artifact commit. No bound input may change between capture and artifact commit. There is no in-place regeneration or chain-reset step.

- [ ] **Step 3: Commit the artifact set, then issue a receipt-only commit**

Commit all generated exit artifacts except the successor receipt. The artifact commit tree and its ancestry must contain the exact exit baseline, result sets, reports, context, handoff, Registry, Claims, Roadmap, observation ledger, schemas, tools, plan, review-import, and reviews named by the chain.

Artifact commit message: `docs(oracle): record p0.1 governance handoff`

Generate the receipt against that artifact commit. The pre-commit `validate-receipt` mode omits `--receipt-commit` and validates schema, artifact-tree ancestry inputs, and every bound byte. The post-commit mode adds `--receipt-commit` and additionally validates commit topology and the one-file delta. The receipt binds:

- historical Phase 0 and post-integration V2 receipt digests;
- P0.1 entry baseline and receipt digests;
- original review source and adopted amendment digests;
- Requirement Registry, Claim Matrix, Roadmap, observation ledger, schemas, tools, plan, review-import, and reviews;
- CC Gateway and Sub2API reviewed heads and shared-contract digest;
- GREEN/RED/merged result digests, both canonical report JSON files and both deterministic Markdown renders, context, and handoff;
- disabled capabilities and fixed P1 integration/entry gates.

Validate the uncommitted receipt against the artifact commit, then commit only the receipt.

Receipt commit message: `docs(oracle): bind p0.1 successor receipt`

After the receipt commit exists, run `validate-receipt` again with both `--artifact-commit <artifact-commit>` and `--receipt-commit HEAD`. It must prove `HEAD^` equals the artifact commit, the commit delta contains exactly `docs/superpowers/evidence/p0-1/p0-1-successor-receipt.json`, and `git show HEAD:<receipt-path>` is byte-identical to the schema-valid receipt bound to the parent artifact tree. Post-commit validation must not modify either repository.

- [ ] **Step 4: Record the exact post-branch integration gate**

P0.1 branch implementation is complete after the receipt commit, but P1 is not authorized from feature-branch heads. The handoff separates the gate for writing the detailed P1 plan from the stricter gate for executing it.

The fixed `next_planning_entry_conditions` list is:

```text
p0_1_successor_receipt_valid
cc_gateway_p0_1_branch_merged_to_main
sub2api_p0_1_branch_merged_to_main
local_main_equals_muqihang_main_in_both_repositories
p0_1_artifact_and_sub2api_fix_ancestry_verified
historical_phase_0_and_post_integration_v2_receipts_valid
joint_local_chain_green_on_integrated_heads
b1_b3_expected_red_revalidated_for_phase_1
protected_gateway_production_and_real_canary_disabled
fresh_unexpired_p1_entry_baseline_and_context
```

The fixed `next_implementation_entry_conditions` list starts with every planning condition above, in the same order, then appends:

```text
b4_b6_expected_red_preserved_for_phase_4
p1_detailed_plan_independently_approved
```

After branch completion, use the normal PR/merge decision workflow. After both merges, either issue an integration receipt or make the P1 entry validator prove artifact/fix ancestry and integrated-head equality. Only then run fresh CodeGraph sync/reconnaissance and write the Phase 1 plan. P1 implementation remains unstarted.

## P0.1 Exit Contract

P0.1 is complete only when all conditions are true:

1. The review amendment is adopted with all identified corrections.
2. All three parent specs point to the fourth overlay and the precedence order is identical everywhere.
3. The roadmap still has seven top-level phases, with Phase 3A/3B and Phase 6A/6B gates explicit.
4. B1-B3 and B4-B6 ownership is no longer contradictory.
5. Registry v2 contains exactly 41 homogeneous records and deterministically preserves all 23 v1 rows.
6. All 18 RA rows remain `deferred` and have owners, independent reviewers, phase owners, one primary WP, gates, and relationships.
7. The Claim Matrix contains every prohibited conclusion without exceeding local evidence authority.
8. The observation ledger contains all ten current observations; `RA-CURRENT-004` is partial and `RA-CURRENT-009` preserves confirmed-to-resolved history.
9. Both joint local-chain tests pass with `protected_gateway` and `local-capture`; no runtime/production behavior changed.
10. The complete H0.1 GREEN inventory passes and the B1-B6 RED inventory remains expected RED.
11. Historical Phase 0 and post-integration evidence bytes and receipts are unchanged and validate at their original commits.
12. Both independent whole-branch reviews report no Critical or Important finding.
13. The successor receipt binds the final artifact commit and both repository heads.
14. Production, real canary, real credentials, profile promotion, unverified device proof, direct egress trust, and unsupported capabilities remain disabled.
15. The P1 handoff is fresh, exact, and blocks P1 planning until both feature branches are integrated and their ancestry is verified.

If any condition fails, set P0.1 to `blocked`, retain safe failure digests, and do not issue an approved receipt.

## Safety and Stop Rules

- No real Anthropic endpoint, credential, account, proxy credential, or unrestricted capture is used.
- No deletion, history rewrite, force push, or worktree cleanup occurs without operator approval.
- Existing user files in main worktrees remain untouched.
- Raw stdout/stderr is not committed.
- Absolute local paths do not enter safe JSON evidence.
- A missing or stale CodeGraph index triggers `codegraph sync` or a full rebuild before planning/review continues.
- After Tasks 0A, 2, 4, 5, and 6, sync every worktree whose indexed code changed before the task review. Perform one final two-repository sync immediately before Task 7 capture.
- A changed base, shared contract, parent receipt, amendment source, or unplanned file blocks the task.
- No reviewer approves their own implementation.
- No local or mock result authorizes production or real canary.

## Final Verification Commands

The H0.1 catalog is authoritative. The human-readable commands have explicit working directories and environments:

`HERMETIC_NETWORK_ENV` below is the exact environment defined in Global Constraints; it is not an operator-defined alias.

| Catalog ID | Classification | Working directory | Environment | Argv |
| --- | --- | --- | --- | --- |
| `cc-build` | GREEN | CC Gateway root | `CI=1` + exact `HERMETIC_NETWORK_ENV` above | `npm run build` |
| `cc-tests` | GREEN | CC Gateway root | `CI=1` + exact `HERMETIC_NETWORK_ENV` above | `npm test` |
| `cc-cross-repo-baseline` | GREEN | CC Gateway root | `CI=1`, `SUB2API_ROOT=/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.worktrees/oracle-p0-1` + exact `HERMETIC_NETWORK_ENV` above | `npm run test:oracle:cross-repo` |
| `sidecar-tests` | GREEN | `sidecar/egress-tls-sidecar` | `CI=1` + exact `HERMETIC_NETWORK_ENV` above | `go test ./... -count=1` |
| `sub2api-formal-pool` | GREEN | Sub2API `backend` | `CI=1` + exact `HERMETIC_NETWORK_ENV` above | `go test ./internal/service ./internal/server/routes -run FormalPool\|FormalPoolOperations -count=1` |
| `sub2api-joint-local-chain` | GREEN | Sub2API `backend` | `CI=1`, `CC_GATEWAY_REPO_ROOT=/Users/muqihang/chelingxi_workspace/cc-gateway-oracle-p0-1` + exact `HERMETIC_NETWORK_ENV` above | `go test ./internal/service -run ^(TestClaudePlatformAWSLocalFullChainE2EUsesCCGatewayAndSafeMockUpstream\|TestJointLocalCaptureAcceptanceArtifact)$ -count=1 -v` |
| `p0-1-focused` | GREEN | CC Gateway root | `CI=1` + exact `HERMETIC_NETWORK_ENV` above | `npm run test:oracle:p0-1` |
| `cc-boundary-red` | expected RED | CC Gateway root | `CI=1` + exact `HERMETIC_NETWORK_ENV` above | `npm exec tsx tests/red/phase0-boundary.red.test.ts` |
| `sidecar-boundary-red` | expected RED | `sidecar/egress-tls-sidecar` | `CI=1` + exact `HERMETIC_NETWORK_ENV` above | `go test -tags=phase0red ./internal/control ./internal/server -count=1` |
| `sub2api-boundary-red` | expected RED | Sub2API `backend` | `CI=1` + exact `HERMETIC_NETWORK_ENV` above | `go test -tags=phase0red ./internal/service ./internal/server/routes -run FormalPoolOnboarding\|FormalPoolOperations\|Browser\|Egress -count=1` |

Run `codegraph status` separately in both roots. Historical evidence immutability is checked from CC Gateway with:

```bash
git diff --exit-code 9ca9ea72d881fccd2cfb3fd1b939a2f56db69516 -- \
  docs/superpowers/evidence/phase-0 \
  docs/superpowers/evidence/post-integration \
  docs/superpowers/evidence/post-integration-v2
```

The final controller report records real exits and digests; this plan does not predict success merely because a command is listed.
