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
SUB2API_ROOT=/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main npm exec tsx tests/oracle-lab-baseline-freeze.test.ts
exit: 1
fatal: Remote branch codex/oracle-phase-0-governance not found in upstream origin
```

The test first reduced both declared sources to clean, single-branch `main` clones. The old fixture then failed for the intended missing-feature-ref reason.

### GREEN

```text
SUB2API_ROOT=/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main npm exec tsx tests/oracle-lab-baseline-freeze.test.ts
exit: 0
```

The fixture now clones `main`, creates the historical governance branch at the exact reviewed commit, and asserts branch, HEAD, and clean state before exercising the production CLI. Cross-manifest, branch, digest, and mismatch assertions remain enabled.

## Immutable Reviewed Inputs

- CC Gateway: `a54a44d107164d11428da06cc3eea979f488d350`
- Sub2API: `d596bb461b1cbb4f0ca8b299333f621ed8d4fd4f`

## Final Verification

```text
SUB2API_ROOT=/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main npm exec tsx tests/oracle-lab-baseline-freeze.test.ts
exit: 0

SUB2API_ROOT=/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main npm test
exit: 0; 35 test files passed

npm run build
exit: 0

git diff --check
exit: 0
```

All existing cross-manifest, branch, digest, clean-tree, output-containment, and mismatch assertions remain active.
