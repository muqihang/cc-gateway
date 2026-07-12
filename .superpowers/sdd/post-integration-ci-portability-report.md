# Post-Integration CI Portability Report

## Scope

- Repository: CC Gateway
- Branch: `codex/post-integration-ci-portability`
- Base: `414c520f1e06120275c0b4a2f9c6879ba640604e`
- Test: `tests/oracle-lab-baseline-freeze.test.ts`
- No Phase 1 implementation, command-catalog environment change, production request, credential use, or Sub2API file change.

## Root Cause

The reviewed-head CLI regression derived Sub2API from `../sub2api-zhumeng-main` and cloned both repositories with `--branch codex/oracle-phase-0-governance`. A clean cloud `main` clone has the reviewed commits in history after integration, but it does not have those local feature refs or the machine-specific sibling checkout.

## TDD Evidence

### RED

```text
SUB2API_ROOT="$SUB2API_ROOT" npm exec tsx tests/oracle-lab-baseline-freeze.test.ts
exit: 1
fatal: Remote branch codex/oracle-phase-0-governance not found in upstream origin
```

The test first reduced both declared sources to clean, single-branch `main` clones. The old fixture then failed for the intended missing-feature-ref reason.

### GREEN

```text
SUB2API_ROOT="$SUB2API_ROOT" npm exec tsx tests/oracle-lab-baseline-freeze.test.ts
exit: 0
```

The fixture now clones `main`, creates the historical governance branch at the exact reviewed commit, and asserts branch, HEAD, and clean state before exercising the production CLI. Cross-manifest, branch, digest, and mismatch assertions remain enabled.

## Immutable Reviewed Inputs

- CC Gateway: `a54a44d107164d11428da06cc3eea979f488d350`
- Sub2API: `d596bb461b1cbb4f0ca8b299333f621ed8d4fd4f`

## Final Verification

```text
SUB2API_ROOT="$SUB2API_ROOT" npm exec tsx tests/oracle-lab-baseline-freeze.test.ts
exit: 0

SUB2API_ROOT="$SUB2API_ROOT" npm test
exit: 0; 35 test files passed

npm run build
exit: 0

git diff --check
exit: 0
```

All existing cross-manifest, branch, digest, clean-tree, output-containment, and mismatch assertions remain active.

## Portability Review Repair

The cross-repository reviewed-head fixture no longer runs as part of ordinary `npm test`. It has a dedicated `npm run test:oracle:cross-repo` entrypoint with an explicit invocation sentinel and required `SUB2API_ROOT`. This keeps single-repository CI green without claiming that cross-repository coverage ran.

Before any historical governance branch is created, both the clean main-only source and the final fixture clone run:

```text
git merge-base --is-ancestor <reviewed-head> main
```

A repository containing a tagged but unmerged orphan reviewed commit proves this check rejects a non-ancestor before branch creation.

### RED

```text
env -u SUB2API_ROOT npm exec tsx tests/oracle-lab-baseline-freeze.test.ts
exit: 1; ordinary baseline regression incorrectly required SUB2API_ROOT
```

### Three-State Verification

```text
env -u SUB2API_ROOT npm exec tsx tests/oracle-lab-baseline-freeze.test.ts
exit: 0

env -u SUB2API_ROOT npm run test:oracle:cross-repo
exit: 1; explicit SUB2API_ROOT assertion

SUB2API_ROOT="$SUB2API_ROOT" npm run test:oracle:cross-repo
exit: 0; non-ancestor rejection, reviewed-head success, and head-mismatch rejection all exercised
```

No cross-repository assertion was removed or weakened. The ordinary suite and explicit fixture now truthfully report different scopes.

### Final Regression

```text
env -u SUB2API_ROOT npm test
exit: 0; 35 test files, final cumulative count 354 passed and 0 failed

npm run build
exit: 0

git diff --check
exit: 0
```

The report contains no machine-specific absolute path; callers supply `$SUB2API_ROOT` explicitly.
