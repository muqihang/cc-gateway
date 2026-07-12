# Post-Integration Entry V2 Report

Status: `APPROVED`

## Binding

- Reviewed tooling HEAD: `d20ef998c938540e07c95abbe71560262711b439`
- CC Gateway integrated `main`: `b38198763ab7e337321e3a0d9e545375d3fb3ad0`
- Sub2API integrated `main`: `d5a42bbd24d15af2ce7646d050a5ae5c77911d4f`
- Both capture repositories were clean and bound to `refs/remotes/muqihang/main` before and after every command.
- The formal-pool contract remained bound to `sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1`.
- Phase 1 implementation and all disabled capabilities remain disabled.

## Evidence Chain

| Artifact | SHA-256 |
|---|---|
| `post-integration-entry-baseline.json` | `sha256:7670881a6a1d311a1fc47d9be3f7612ed082ebc6a60ccbc89ce100dbae54cb81` |
| `post-integration-green-results.json` | `sha256:61563eba03ede1b85b048899a93968e893c65fdb204f511de431e080151cef71` |
| `post-integration-red-results.json` | `sha256:a32d0eefbe202cea4536c0d68e797ad1faebc0a43a8da4a4acef4774e6898d45` |
| `post-integration-command-results.json` | `sha256:b25a50071bf0062ad31c963e15154066ff0fe9963bf9cd66a5c8a0675d1f2e9b` |
| command result-set digest | `sha256:22ac4a46760b111cebc3c5fa837229e9dc57b66ffb4c64ba203c3e7dded6e309` |
| `post-integration-context.json` | `sha256:6a3b9594cdf9dddd080325ff85b58ef988c733b8e186e5a66b87d118ec05f84f` |
| `post-integration-handoff.json` | `sha256:f44619b955808805aed20d61c3fdd39ba96029750b6c8cd73db826b7574c8ba2` |

## Command Results

| Command ID | Real exit | Classification |
|---|---:|---|
| `cc-build` | 0 | `pass` |
| `cc-test` | 0 | `pass` |
| `cc-cross-repo-baseline` | 0 | `pass` |
| `sidecar-test` | 0 | `pass` |
| `sub2api-test` | 0 | `pass` |
| `cc-b4-b6-red` | 1 | `expected_fail` |
| `sidecar-b4-b6-red` | 1 | `expected_fail` |
| `sub2api-b1-b3-red` | 1 | `expected_fail` |

The GREEN and RED groups were executed independently. The cross-repository command received the preserved Sub2API capture clone through the explicit `SUB2API_ROOT` binding. The merged result set contains exactly five GREEN passes and three expected RED failures.

## Safety And Known Minor

- The evidence chain contains only safe structured fields, digests, and bounded redacted excerpts.
- No raw prompt, body, credential, CCH, ClientHello, account identifier, proxy credential, or unrestricted log was persisted.
- No real upstream request, credential use, promotion, canary, deployment, or Phase 1 implementation occurred.
- An out-of-repository superseded debug artifact remains for an operator cleanup decision. Its digest is `sha256:fcb72c4acf01d6ed56e070a97f6ef2894ed28613fbd335fee210778d25a52b81`. Its machine path is intentionally omitted.
- The earlier `post-integration/` chain ending at `bd519c8` is superseded and must not be used for Phase 1 entry.

## Commit Protocol

The baseline, five-GREEN group, three-RED group, merged results, context, handoff, and this report are committed together in the artifact commit. A separate receipt-only successor commit binds the exact four authoritative chain artifacts and the artifact commit. Review approval is required before this chain may be treated as the post-integration entry handoff.

## Independent Review

Final artifact review: `APPROVED`, with no Critical or Important findings. The reviewer verified
the exact Git-object bytes at artifact commit `cc9eea4846a50f385799835ae63e05bb921173f1`,
the receipt-only successor `4774bb6fe1d511ce2e26ac80ab7e8d1abd684e7e`, all eight command
classifications and bindings, both repository states, the formal-pool contract, expiry, and the
safe-artifact policy. The superseded out-of-repository debug artifact remains the only Minor.
