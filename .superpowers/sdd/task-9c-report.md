# Pre-Status Amendment 9C Report

## Status

COMPLETE

Implemented reviewed-snapshot governance binding for Phase 0 exit manifests without changing entry-manifest behavior or any real governance/evidence artifact.

## Implementation

- Exit validation resolves the repository containing the exact fixed registry and claim paths.
- The bound `repositories.cc_gateway.head` must resolve to a commit in that repository and be an ancestor of current `HEAD`.
- Requirement and claim bytes are read directly from Git objects with `git cat-file blob`; no checkout or worktree mutation occurs.
- Exit manifest governance digests are checked against those reviewed commit bytes, while current pending registry and claim bytes are independently validated.
- Pending registry inventory/order, owners, gates, source authority, repository authority, dependencies, and production-only authority fields remain equal to the reviewed snapshot.
- Task 9 may change only implementation/status evidence fields, through constrained Phase 0 status transitions. B1-B6 remain `failing_test_added`; deferred requirements remain deferred.
- The claim authority matrix remains equal to the reviewed snapshot.
- Existing context digest binding, handoff revalidation, receipt commit-byte binding, command-result binding, catalog binding, and repository binding remain fail closed.

## TDD Coverage

Temporary Git repositories and real commits cover:

- reviewed exit snapshot plus valid pending `locally_verified` registry bytes;
- context, handoff, report, committed registry, roadmap, and receipt binding across a real two-commit fixture;
- tampered reviewed governance digest;
- unavailable/non-ancestor reviewed head;
- wrong repository and missing committed governance path;
- owner, gate, inventory/order, status-transition, and claim-authority replacement;
- unchanged entry-manifest current-byte digest behavior.

## Verification

- `npm exec tsx tests/oracle-lab-reviewed-snapshot-binding.test.ts`: PASS, 4/4.
- `npm exec tsx tests/oracle-lab-harness.test.ts`: PASS, 22/22.
- `npm exec tsx tests/oracle-lab-traceability.test.ts`: PASS, 16/16.
- `npm exec tsx tests/oracle-lab-claim-matrix.test.ts`: PASS, 13/13.
- `npm exec tsx tests/oracle-lab-baseline-freeze.test.ts`: PASS.
- Composed `npm run oracle:validate` against the immutable entry baseline: PASS.
- `npm test`: PASS, including 354 main assertions and 55 Node test assertions.
- `npm run build`: PASS.
- `git diff --check`: PASS.

## Scope Audit

- No registry, roadmap, immutable catalog, package lock, Sub2API, or real status/evidence bytes were edited.
- The pre-existing untracked `docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json` was not modified, staged, or used by tests or validation.

## Concerns

- An additional ad hoc TypeScript invocation over the tool graph reaches the pre-existing `tools/oracle-lab/validate-command-catalog.ts:66` unknown-to-string diagnostic. The repository's authoritative `npm run build` and all runtime/tool tests pass; 9C does not change that file.
