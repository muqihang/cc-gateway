# PI-1 Implementation Report

Status: `DONE`

## Scope

- Base commit: `414c520f1e06120275c0b4a2f9c6879ba640604e`
- Implementation commit: `8e2d3dd279910e4af031b4a4adab950d8cd838d9`
- Repository: CC Gateway only
- Phase 1 implementation remains disabled.
- Existing Phase 0 schemas, validators, manifests, command catalog, and evidence were not modified.

## TDD Evidence

RED command:

```text
npm exec tsx -- --test tests/oracle-lab-post-integration-entry.test.ts
```

Observed RED: `ERR_MODULE_NOT_FOUND` for the not-yet-created
`tools/oracle-lab/post-integration-entry.js`. The failure was caused by the
missing PI-1 functionality, before any production implementation existed.

GREEN command:

```text
npm exec tsx -- --test tests/oracle-lab-post-integration-entry.test.ts
```

Result: `7 passed, 0 failed`. Coverage includes the distinct artifact
namespace, the committed dedicated catalog, wrong head, wrong branch, wrong
user-fork remote ref, dirty repository, receipt drift, missing handoff
ancestry, contract drift, unknown fields, unsafe material, result
cross-binding, and expiry.

## Implementation

- Added strict post-integration entry, context, command catalog, and command
  result schemas under a distinct namespace.
- Added capture and validation tooling that binds both integrated `main`
  commits, `muqihang/main` refs and fork URL digests, clean states, the formal
  pool contract, fixed governance bytes, the Phase 0 exit receipt and handoff
  ancestry, reviewed tool/schema/catalog bytes, runtime/environment digests,
  disabled capabilities, and exact next-phase gates.
- Added independent post-integration result classification and digest logic;
  it does not import or change the old Phase 0 catalog validator or result
  merger.
- Added four local GREEN commands and three explicitly expected RED commands.
  Every entry binds to `${POST_INTEGRATION_MANIFEST}` and permits no worktree
  delta.
- Added package scripts for capture, catalog execution, and context building.

## Verification

| Command | Result |
|---|---|
| focused post-integration test | `7 passed, 0 failed` |
| strict TypeScript check over new tools/test | pass |
| JSON parse for package, four schemas, and catalog | pass |
| old baseline/harness focused regression in PI-1 worktree | `25 passed, 1 environment failure`; the failing test could not spawn the worktree-local `node_modules/.bin/tsx`, which is absent before test logic starts |
| full integrated-main `npm test` with installed dependencies | `354 passed, 0 failed`; Node harness also reported `59 passed, 0 failed` |
| integrated-main `npm run build` | pass |
| `git diff --check` | pass |

Post-commit capture smoke used clean temporary shared clones of the two
integrated repositories and the clean reviewed PI-1 tool HEAD. It produced:

```text
kind=post_integration_entry
tool_head=8e2d3dd279910e4af031b4a4adab950d8cd838d9
cc_head=414c520f1e06120275c0b4a2f9c6879ba640604e
sub_head=d5a42bbd24d15af2ce7646d050a5ae5c77911d4f
manifest_digest=sha256:dab96d97cbbfcb3af4e3f15c8bc526171b54c0c22ee8e212cf6929a84fb8dde0
valid=true
```

The smoke manifest was not persisted as Phase 1 evidence. PI-2 must generate
fresh timestamped artifacts from the independently reviewed PI-1 tool HEAD.

## Self-Review

- Scope is limited to PI-1 files plus package scripts and the persistent
  post-integration plan/progress ledger.
- No raw prompt, body, credential, CCH, ClientHello, account identifier,
  proxy credential, or unrestricted command output is persisted.
- No real upstream request, credential use, promotion, canary, deployment, or
  Phase 1 implementation was enabled.
- PI-1 remains `in_progress` in the ledger pending independent controller
  review.

## Concerns

- The isolated PI-1 worktree intentionally has no local dependency tree. This
  blocks one old regression's hardcoded worktree-local `tsx` subprocess and
  ordinary source build dependency resolution there; the identical integrated
  main test/build gates are green, and the new tooling strict compile is green.

## Fix Review

Status: `DONE`

The follow-up review findings were addressed without changing any Phase 0
schema or evidence chain:

- Context construction now requires the reviewed catalog digest, invokes the
  catalog/results binding validator, and requires exactly all four GREEN and
  three expected RED command IDs.
- Catalog execution now validates the complete post-integration artifact,
  including fixed heads, branches, user-fork refs, receipt/ancestry,
  governance, contract, expiry, disabled capabilities, and committed capture
  inputs before spawning the first command. The catalog path itself must also
  match the reviewed manifest digest.
- Context validation now rejects duplicate, missing, unknown, or arbitrarily
  committed repositories and command evidence.
- `validatePostIntegrationCaptureInputsAtToolRoot` re-derives every input
  digest from the reviewed commit object and checks reviewed ancestry. Both
  consuming CLIs require `--tool-root`; no old Phase 0 chain is modified.

Follow-up RED was observed before implementation as an ESM missing-export
failure for the new committed-input validator. Focused follow-up GREEN is
`11 passed, 0 failed`; strict TypeScript, JSON parsing, and `git diff --check`
also pass. Related old baseline/harness regression is `29 passed, 1
environment failure`; the sole failure is the already documented missing
worktree-local `node_modules/.bin/tsx`. Full `npm test`/`npm run build` remain
environment-blocked in this dependency-free worktree by pre-existing missing
`https-proxy-agent` and `socks-proxy-agent`; the prior integrated-main gates
remain the authoritative full-suite result.
