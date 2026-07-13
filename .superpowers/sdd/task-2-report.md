# P0.1 / WP-R0 Task 2 Report: Homogeneous Requirement Registry Schema v2

## Result

DONE

- Baseline: `826c987a0251b785fa5df46e4b99fac67f406ae2`
- Branch: `codex/oracle-p0-1-governance`
- Commit: this Task 2 commit, message `feat(oracle): add requirement registry schema v2`; the resulting hash is reported by the task handoff because a commit cannot embed its own hash.

## RED Evidence

The initial hermetic traceability run produced a valid behavioral RED: 22 tests, 16 passed, 6 failed. The v2 fixtures were rejected with `unknown_field` for the eight added fields, and the canonical schema still declared `schema_version: 1.0.0`.

After adding the missing migration fixtures/tests but before upgrading the validator, all four focused suites exited 1:

- Traceability rejected v2 fields, migration output, and schema version 2.
- Claim matrix returned `invalid_requirement_registry` for homogeneous v2 requirements.
- Harness and reviewed-snapshot suites stopped at `invalid_migration_output` because v2 records were unsupported.
- A separate exact-mapping RED passed 22/23 traceability tests and proved that the first migration schema draft incorrectly accepted substituted reviewer/phase metadata.

## Implementation

- Preserved the canonical 23-record v1 Registry bytes at `oracle-lab-requirements-v1.json` and created a v1 schema with a unique versioned `$id`.
- Replaced the canonical requirement record schema with strict v2 fields while retaining the top-level array contract.
- Added an exact 23-row, schema-validated reviewer/phase migration mapping and deterministic CLI/API migration. Missing, duplicate, extra, or substituted governance metadata fails closed.
- Added homogeneous version detection. Mixed and unsupported versions fail before authority derivation.
- Kept all v1 validation, inventory, production evidence, timestamp, repository, dependency, and empty-only contradiction rules unchanged.
- Added v2 RA governance rules, honest legacy `null` history, exact fields, unique relationship arrays, target/self checks, `refines`/`supersedes` cycle checks, symmetric contradictions, and contradiction-free production authority.
- Kept `validateClaims` on its existing normalized `Record[]` API. Its existing call to `validateRequirementRecords` now accepts homogeneous v2 arrays without weakening production authority; the v2 claim tests cover both normal and production paths. No no-op edit was made to `validate-claims.ts` merely to match the planning file list.
- Added the minimal `validate-run-manifest.ts` version guard required for historical H0 fail-closed behavior. Phase 0 entry manifests use `absent_pre_governance_bootstrap`, so digest checks alone would otherwise allow a v2 Registry to reach historical builders. H0 tools now return `historical_registry_version_mismatch`; reviewed Phase 0 exit validation separately proves the 41-v2 versus 23-v1 inventory mismatch.

## GREEN Evidence

- `npm exec tsx tests/oracle-lab-traceability.test.ts`: 23/23 passed.
- `npm exec tsx tests/oracle-lab-claim-matrix.test.ts`: 15/15 passed.
- `npm exec tsx tests/oracle-lab-harness.test.ts`: 26/26 passed.
- `npm exec tsx tests/oracle-lab-reviewed-snapshot-binding.test.ts`: 5/5 passed.
- Focused total: 69/69 passed.
- Migration CLI executed twice with byte-identical output: 23 records, one version `[2]`, SHA-256 `06eb0b463d4753ba10e237e31ee92b54d4c07b41a5e51a6a09a6aa3414c1f262`.
- `npm test`: 40 test files, exit 0; final runners reported no failures.
- `npm run build`: exit 0.
- `git diff --check`: passed.

## Immutability

- Canonical `docs/superpowers/registry/oracle-lab-requirements.json` remains byte-identical to the baseline and v1 preservation file: SHA-256 `2e212e0fd8cfeec8272178fefc3d952a29f76129e5f1c75b1dd57a95456aada5`.
- `git diff --exit-code` against the task baseline passed for the canonical Registry, Claims, and all historical evidence.
- No Sub2API, historical evidence, claim authority, dependency, package/lock, or progress-ledger bytes were changed.
- Task 3 remains solely responsible for atomically replacing the canonical Registry with all 41 validated v2 rows.

## Changed Files

- `docs/superpowers/registry/oracle-lab-requirements-v1.json`
- `docs/superpowers/registry/oracle-lab-requirement-v2-migration.json`
- `docs/superpowers/schemas/oracle-lab-requirement-v1.schema.json`
- `docs/superpowers/schemas/oracle-lab-requirement.schema.json`
- `docs/superpowers/schemas/oracle-lab-requirement-v2-migration.schema.json`
- `tools/oracle-lab/migrate-requirements-v1-to-v2.ts`
- `tools/oracle-lab/validate-requirements.ts`
- `tools/oracle-lab/validate-run-manifest.ts`
- `tests/oracle-lab-traceability.test.ts`
- `tests/oracle-lab-claim-matrix.test.ts`
- `tests/oracle-lab-harness.test.ts`
- `tests/oracle-lab-reviewed-snapshot-binding.test.ts`
- `.superpowers/sdd/task-2-report.md`

## CodeGraph

- Used `codegraph explore` before file reads to locate requirement validation, claim authority, reviewed snapshot, and H0 builder call paths.
- Used `codegraph node` for `validateRequirementRecords`, `validateClaims`, `validateRunInputs`, `validatePendingGovernance`, and `buildContextPack` before editing the relevant surfaces.
- `codegraph sync .` indexed 1 added and 6 modified code files, adding/updating 164 nodes. Final status is required to show zero pending changes.

## Concerns

None. The canonical Registry intentionally remains v1 until Task 3; this is a required sequencing boundary, not an incomplete Task 2 implementation.

## Review Fix Wave: Cross-Field Relationship Cycles

### Result

DONE

Commit: this fix-wave commit, message `fix(oracle): reject cross-field requirement cycles`; the resulting hash is reported by the task handoff because a commit cannot embed its own hash.

### RED

The independent review finding was reproduced with the minimal v2 graph `A.refines = [B]` and `B.supersedes = [A]`. Before the fix, `validateRequirementRecords` returned `{ ok: true, errors: [] }` because `hasCycle` built separate per-field graphs.

Command: `npm exec tsx tests/oracle-lab-traceability.test.ts`

Result: exit 1, 23 tests, 22 passed, 1 failed. The relationship-cycle test failed because no `cyclic_relationship` error was emitted.

### GREEN

`hasCycle` now combines every record's `refines` and `supersedes` targets into one adjacency list and executes one DFS. Existing same-field and multi-hop detection remains on the same traversal, while mixed-field cycles are now rejected.

- `npm exec tsx tests/oracle-lab-traceability.test.ts`: exit 0, 23/23 passed.
- `npm exec tsx tests/oracle-lab-claim-matrix.test.ts`: exit 0, 15/15 passed.
- `npm test`: 40 test files, exit 0; final runners reported no failures.
- `npm run build`: exit 0.
- `git diff --check`: passed.
- Historical immutable diff and canonical-v1 byte comparison: passed.
- `codegraph sync .` followed by `codegraph status .`: required to report an up-to-date index with zero pending changes.

### Concerns

None.
