# Oracle Lab Phase 1 Fresh Integration Handoff

## Scope

- Frozen bases: CC Gateway `1302a8c1a2f8c2a5bd92a5bc0da8bd11458c513f`; Sub2API `b0b77933716487da5fca00329443f88ce9a1c3db`.
- Tested product heads: CC Gateway `d99738c600075c44c7bc741365555a4e23fdfded` (tree `8b2759d915d6a1baf077465f3720110a368a68ed`); Sub2API `a759b455600e9a4c5c361a492e4f3ce3cd5ad70f` (tree `b76d6000a8a0b10e9c6a953adf7095978787a284`).
- Shared contract: `backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json`, SHA-256 `70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1`.
- Active Claude Code target: `2.1.215`; reference baseline: `2.1.207`. The pinned registry metadata and artifact SHA-256 are in `docs/superpowers/claude-code-active-target.json`.

## Verification

- Focused listener, upstream TLS, auth/security, onboarding authority/version/CAS, browser proof, public-origin, frontend version-continuity, and Claude Code `2.1.215` loopback fixture tests passed.
- CC Gateway full local suite passed (`456` product checks; isolated Node runner `76` pass and `1` expected live-context skip); sidecar `go test ./...` passed.
- Sub2API backend `go test ./...` passed; frontend full suite passed (`190` files, `1376` tests).
- Cross-repository loopback/mock contract checks passed (`2/2`). CC Gateway, sidecar, Sub2API backend, and Sub2API frontend build/typecheck gates passed.
- Preserved RED inventories are exact: CC B4-B6 `61` failing leaves (SHA-256 `5e89551797fe78e0d63ab771873e15fbbbbbf53557c061c9433416815b2385c2`); sidecar B5-B6 `51` failing leaves (SHA-256 `774b9c070b9dbbbb643c98fb4ba4e1b403e13ba67e499b0e58167cec6d55020e`).
- Integrated review and closure review ended with zero Critical or Important findings.

## Residuals

- `go generate ./cmd/server` could not redownload `github.com/google/subcommands` because the local Go proxy request timed out. The committed generated graph compiled, `go test ./cmd/server` passed, and wire compatibility tests passed; generation itself is not claimed as successful.
- Production, real upstreams, credentials, real-canary, profile promotion, and deployment were not exercised.
- P2-P6 remain deferred. No Recovery receipt, context, lease, replay, mapping artifact, or authority digest is part of this handoff.
