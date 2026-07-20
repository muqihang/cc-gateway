# Claude Code 2.1.215 Phase 2 Handoff

## Status

Phase 2, Normative Compatibility and Manifest Authority, is complete. Claude Code `2.1.215` is
the active target and `2.1.207` remains a historical reference. This handoff is a human-readable
summary, not an execution authority, receipt, context, lease, or recovery artifact.

## Repository Bindings

| Repository | Phase 2 base | Tested head | Tested tree | Integrated main |
| --- | --- | --- | --- | --- |
| CC Gateway | `5ff143e821d2357c7be0dd085afb7b89af955b4e` | `cf541c39bdd76d330dce9f2f589c42ca221d2ace` | `6ae4bc914f31ece90d3aae6c445760fc23ce9fe8` | `68e936f5b2655f1ed42d14258369ef261bf630b7` |
| Sub2API | `069fc473d974e248db780a3ef8e7db5a83e29e22` | `e201616a387e938e6a944fa963e674104c54bd07` | `52efacd397bd0f15861cca4b6a1921a049e5ea28` | `cea7de895b8b523f3a6bb46be77ba09bc31a11bc` |

The integrated Git trees equal the tested trees. CC Gateway merged through PR #34. Sub2API merged
the Phase 2 product range through PR #5 and the single post-merge CI enumeration closure through
PR #6.

## Contract Outputs

- Shared Phase 1 predecessor contract SHA-256:
  `70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1`.
- Phase 2 `oracle.compatibility.v1` bundle SHA-256:
  `2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce`.
- Supported schema range: `1:0-0`.
- Cross-repository gate: `65` fixtures and `7` executable commands.

The CC Gateway implementation is under `src/oracle-contract/`,
`sidecar/egress-tls-sidecar/internal/control/`, and `contracts/oracle-lab/v1/`. The Sub2API mirror
and Go implementation are under `backend/internal/service/oracle_contract_*` and
`backend/internal/service/testdata/oracle_lab_contract/v1/`.

## Verification

- Focused schema, canonical JSON, deterministic CBOR, admission, manifest authority, sidecar
  capability, replay, and cross-project transition tests passed in TypeScript and Go.
- CC Gateway full suite passed: `157` pass, `0` fail, `1` intentional skip.
- Sidecar full Go suite passed.
- Sub2API backend full suite passed. GitHub backend, integration, lint, frontend, and security jobs
  passed on the final tree.
- Sub2API frontend full suite passed with pnpm `9.15.9` and the frozen lockfile; typecheck and build
  passed without changing the lockfile.
- Post-merge cross-repository contract gate passed with bundle digest
  `2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce`.
- Post-merge builds passed for CC Gateway, sidecar, Sub2API backend, and Sub2API frontend.
- CC B4-B6 remained exact expected RED: `61` unique canonical leaves, complete TAP lifecycle,
  SHA-256 `5e89551797fe78e0d63ab771873e15fbbbbbf53557c061c9433416815b2385c2`.
- Sidecar B5-B6 remained exact expected RED: `51` unique canonical leaves, complete Go test
  lifecycle, SHA-256 `774b9c070b9dbbbb643c98fb4ba4e1b403e13ba67e499b0e58167cec6d55020e`.
- Integrated and closure review ended with zero Critical or Important findings. The post-merge CI
  enumeration closure also received an independent zero-Critical/zero-Important review.

## Deferred Work

- Phase 2 defines pure contracts and admission decisions. It does not wire them into live proxy,
  scheduler, DNS, socket, or sidecar server request paths.
- B4-B6 runtime enforcement, durable replay storage, destination enforcement, restart, replica,
  and fault behavior remain Phase 4 work.
- Production, real upstreams, credentials, deployment, profile promotion, and real canary were not
  exercised and are not claimed.

## Phase 3A Entry

Phase 3A is next. Before implementation, freeze the two integrated `muqihang/main` commits above,
refresh each new worktree's CodeGraph index, verify the pinned official Claude Code `2.1.215`
artifact and digest, and write a scoped Phase 3A evidence-factory plan. Phase 3A owns package
unpacking, static reverse engineering, controlled dynamic observation, environment and System
Prompt differentials, request/response/telemetry capture, and cross-version comparison. It must
not use production credentials or real upstream traffic.
