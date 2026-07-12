# PI-1.6 Implementation Report

Status: `DONE`

## Scope

- Base commit: `106016c`
- Repository: CC Gateway only
- Integrated CC Gateway binding: `b38198763ab7e337321e3a0d9e545375d3fb3ad0`
- Integrated Sub2API binding remains: `d5a42bbd24d15af2ce7646d050a5ae5c77911d4f`
- Existing Phase 0 manifests, validators, and evidence chain were not changed.
- Superseded PI-2 artifacts were not regenerated in this task.
- Phase 1 and all real upstream, credential, promotion, canary, and deployment capabilities remain disabled.

## TDD Evidence

RED command:

```text
npm exec tsx --test tests/oracle-lab-post-integration-entry.test.ts tests/oracle-lab-post-integration-handoff.test.ts
```

Observed RED: the post-integration catalog module did not export
`postIntegrationCommandEnvironment`. The new head/inventory assertions also
targeted the new integrated main and eight-command inventory before production
code was changed.

GREEN command:

```text
node --import tsx --test tests/oracle-lab-post-integration-entry.test.ts tests/oracle-lab-post-integration-handoff.test.ts
```

Final result: `21 passed, 0 failed` after the catalog mutation checks were
added.

## Implementation

- Rebound the immutable integrated CC Gateway main from `414c520...` to the
  clone-portable portability merge `b381987...`.
- Added the unique `cc-cross-repo-baseline` GREEN catalog command with exact
  argv `npm run test:oracle:cross-repo` and explicit
  `SUB2API_ROOT=${SUB2API_ROOT}`.
- The command runner expands the declared root into the child environment and
  hashes that complete environment, so a changed Sub2API capture root changes
  `environment_digest` without persisting the raw path in result evidence.
- Catalog validation now requires exactly five GREEN plus three RED IDs and
  rejects a changed cross-repository argv or missing capture-root binding.
- Results binding, context, handoff, schemas, and fixtures now require the
  complete eight-command inventory; handoff `record_count` is exactly 8.

## Verification

| Command | Result |
|---|---|
| focused PI entry/handoff/receipt tests | pass |
| strict TypeScript over PI tools/tests | pass |
| package/catalog/schema JSON parse | 8 files pass |
| old Phase 0 baseline freeze regression | pass |
| old H0 harness regression | 25 passed, 0 failed |
| `env -u SUB2API_ROOT npm test` | 37 files; 354 passed, 0 failed; Node harness 80 passed, 0 failed |
| explicit `SUB2API_ROOT=... npm run test:oracle:cross-repo` | pass |
| `npm run build` | pass |
| `git diff --check` | pass |

## Self-Review

- Controller-owned `.superpowers/sdd/post-integration-plan.md` and
  `.superpowers/sdd/post-integration-progress.md` remain unstaged.
- No existing evidence artifact was modified.
- Persisted changes contain no raw prompt, body, credential, CCH, ClientHello,
  account identifier, proxy credential, unrestricted log, or machine-specific
  capture path.
- No file deletion, history rewrite, force push, external request, or Phase 1
  implementation occurred.

## Concerns

None.

## Cross-Repository Binding Remediation

Status: `DONE`

- Remediation base: `ef9ab2d`
- Implementation commit: `3b3d587`
- Independent review finding addressed: `cc-cross-repo-baseline` touched both
  CC Gateway and Sub2API, while the per-command pre/post guard checked only
  the catalog entry's primary repository.
- The runner now derives an explicit touched-repository set from the entry's
  declared root placeholders. Every touched repository is checked both before
  and after execution for the exact manifest HEAD, `main` branch,
  `muqihang/main` remote ref and commit, remote URL digest, and clean worktree.
- A touched Sub2API repository also revalidates the manifest-bound shared
  contract before command execution.
- Post-command drift throws `worktree_delta_mismatch` before a result record
  can be returned or persisted. Both an uncommitted Sub2API mutation and a
  clean committed Sub2API HEAD change are covered by real Git fixture commands.
- The existing Phase 0 and post-integration evidence artifacts were not
  modified. Phase 1 remains disabled.

TDD RED was observed with the focused test failing because the new
`postIntegrationTouchedRepositories` export did not yet exist. Final
verification:

| Command | Result |
|---|---|
| focused post-integration entry tests | `16 passed, 0 failed` |
| strict TypeScript over changed tools/test | pass |
| Phase 0 baseline freeze regression | pass |
| H0 harness regression | `25 passed, 0 failed` |
| `env -u SUB2API_ROOT npm test` | 37 files; `354 passed, 0 failed`; Node harness `82 passed, 0 failed` |
| `npm run build` | pass |
| `git diff --check` | pass |

### Contract Postcondition Remediation

Status: `DONE`

- Implementation commit: `1f10b6f`
- A touched Sub2API formal-pool contract is now hashed both before command
  execution and after all touched repository bindings are revalidated.
- The postcondition compares the real contract bytes to the exact manifest
  digest before constructing or returning a command result record.
- A real Git fixture marks the tracked contract `skip-worktree`, changes its
  bytes, and confirms `git status` remains clean. The runner still rejects the
  command as `worktree_delta_mismatch`, with the contract-drift error retained
  as its cause, and returns no accepted evidence.

TDD RED was `Missing expected rejection`: the pre-fix runner returned a record
for the hidden contract mutation. Final verification:

| Command | Result |
|---|---|
| focused post-integration entry tests | `17 passed, 0 failed` |
| strict TypeScript over changed tools/test | pass |
| Phase 0 baseline plus H0 harness | `26 passed, 0 failed` |
| `env -u SUB2API_ROOT npm test` | 37 files; `354 passed, 0 failed`; Node harness `83 passed, 0 failed` |
| `npm run build` | pass |
| `git diff --check` | pass |
