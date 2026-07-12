# PI-2 Implementation Report

Status: `DONE_PENDING_REVIEW`

## Scope

- Reviewed tool HEAD: `cb9019edfbb5ae548fe2550fa673fea9ddfca747`
- Integrated CC Gateway `main`: `414c520f1e06120275c0b4a2f9c6879ba640604e`
- Integrated Sub2API `main`: `d5a42bbd24d15af2ce7646d050a5ae5c77911d4f`
- Repository: CC Gateway evidence branch only
- Phase 1 implementation remains disabled.
- No tooling, schema, catalog, test, Phase 0 evidence, or integrated `main` bytes were changed.

## Clean Capture Repositories

The artifacts were generated against preserved external clones, not either
user working copy:

- `/Users/muqihang/chelingxi_workspace/cc-gateway-post-integration-capture-main`
- `/Users/muqihang/chelingxi_workspace/sub2api-post-integration-capture-main`

Both clones were created from the `muqihang` fork, remained on `main`, bound
`refs/remotes/muqihang/main` to the exact integrated commit, used remote name
`muqihang`, and had an empty porcelain status before and after every catalog
command. `npm ci` was run only in the CC Gateway capture clone.

The CC capture clone also carries a local
`codex/oracle-phase-0-governance` ref at reviewed commit `a54a44d107164d11428da06cc3eea979f488d350`.
This ref is required by the existing baseline regression fixture, which clones
that branch by local name. It does not change the active `main` branch, files,
or manifest repository binding.

## Generated Artifacts

| Artifact | SHA-256 |
|---|---|
| `docs/superpowers/evidence/post-integration/post-integration-entry-baseline.json` | `sha256:a0d1ffedc8fb15dfc209d9c6d14b518e3d567183a047f05aa8df57074bd20bd7` |
| `docs/superpowers/evidence/post-integration/post-integration-command-results.json` | `sha256:f67c104bdea5aa71abc5877900d0c642df71d1d5c05e986df8364c48cbbc15af` |
| command result-set digest | `sha256:da945b5e6eff112255e2c8f4843bc3b1e39221c3d7c9d430de508929ccc2abe5` |
| `docs/superpowers/evidence/post-integration/post-integration-context.json` | `sha256:a8f0d4ccdd1351b6215a2871e15dbcae718d96fa816e8770d7ca5cadf996d2ee` |
| `docs/superpowers/evidence/post-integration/post-integration-handoff.json` | `sha256:aaa190ccb5f187e73de2efb8f11a35f4d9621f841a74645a5e42a1ab7e31ac43` |

The independently generated GREEN and RED group result sets are retained as
`post-integration-green-results.json` and
`post-integration-red-results.json`. The complete result set is the artifact
bound by context, handoff, and receipt.

## Command Results

| Command ID | Real exit | Classification |
|---|---:|---|
| `cc-build` | 0 | `pass` |
| `cc-test` | 0 | `pass` |
| `sidecar-test` | 0 | `pass` |
| `sub2api-test` | 0 | `pass` |
| `cc-b4-b6-red` | 1 | `expected_fail` |
| `sidecar-b4-b6-red` | 1 | `expected_fail` |
| `sub2api-b1-b3-red` | 1 | `expected_fail` |

All catalog commands were executed separately by group through the dedicated
post-integration runner. The final validation rechecked the reviewed catalog,
both repository heads and remote refs, contract digest, manifest byte digest,
all seven catalog bindings, accepted classifications, context/result binding,
handoff binding, expiry, and the safe-artifact policy.

## Debugging Record

The first GREEN invocation completed but its result write was rejected with
`artifact_path_escape` because `/tmp` is outside the persistent evidence root.
The command was rerun with a repository evidence path.

That rerun recorded `cc-test` as `unexpected_fail`. A direct reproduction
showed the existing baseline test expected a local
`codex/oracle-phase-0-governance` branch in the clean capture clone. The
reviewed remote-tracking branch and commit were already present, so the local
ref described above was added and the complete GREEN group was rerun. The
failed result set is preserved at
`/Users/muqihang/chelingxi_workspace/post-integration-debug-artifacts/post-integration-green-results-missing-local-branch.json`.
No test, assertion, schema, catalog, or implementation byte was weakened.

## Safety

- `assertSafeArtifact` passed for the baseline, both group result sets, the
  complete result set, context, and handoff.
- Persistent command evidence contains output digests and bounded redacted
  excerpts only.
- No raw prompt, body, credential, CCH, ClientHello, account identifier,
  proxy credential, or unrestricted log was persisted.
- No real upstream request, credential use, profile promotion, canary,
  deployment, negative-capability implementation, or Phase 1 work occurred.

## Commit Protocol

This report is included in the artifact commit with the exact baseline,
results, context, and handoff bytes. The artifact commit is recorded in the
subsequently generated post-integration receipt. That receipt is committed as
the only file in the receipt-only successor commit and validated from the
successor with `validate-receipt`.
