# Post-Integration Entry Evidence Plan

Authoritative inputs:

- CC Gateway integrated `main`: `414c520f1e06120275c0b4a2f9c6879ba640604e`
- Sub2API integrated `main`: `d5a42bbd24d15af2ce7646d050a5ae5c77911d4f`
- Phase 0 exit receipt: `docs/superpowers/evidence/phase-0/phase-0-exit-receipt.json`

Global constraints:

- Do not modify or reinterpret the immutable Phase 0 entry/exit manifest schemas or evidence chain.
- Do not start Phase 1 implementation or enable any negative capability, upstream request, credential, promotion, canary, or deployment.
- Fail closed on unknown schema fields, wrong repositories/branches/heads, dirty worktrees, contract drift, missing ancestry, digest drift, cross-manifest results, or expired context.
- Persist only safe categories and SHA-256 digests. Never persist raw prompts, bodies, credentials, CCH, ClientHello, account identifiers, proxy credentials, or unrestricted logs.
- Preserve reviewed commit identities; no squash, rebase, force push, or history rewrite.

## Task 1: Add post-integration entry evidence tooling (PI-1)

Using TDD, add a dedicated post-integration entry manifest/context schema, capture and validation tooling, and a dedicated command-catalog group. The manifest must bind the two integrated `main` heads above, their user-fork remote refs, clean repository states, formal-pool contract digest, governance digests, Phase 0 exit receipt digest and handoff commit ancestry, tool/schema digests, runtime/environment digests, disabled capabilities, and exact next-phase gates. It must not accept or emit `phase_0_entry` or `phase_0_exit` and must not change the old Phase 0 schema or validators.

The catalog must run the existing local GREEN and expected RED suites while binding every result to the new manifest. Add focused RED/GREEN tests for wrong head/branch/remote ref, dirty tree, receipt drift, missing ancestry, contract drift, unknown fields, result cross-binding, unsafe material, and expiry. Commit tooling, schemas, catalog, plan, and tests in CC Gateway only. Write `.superpowers/sdd/task-pi-1-report.md`.

## Task 2: Generate and bind post-integration entry artifacts (PI-2)

At the reviewed clean PI-1 tool HEAD, capture the fresh post-integration baseline. Run each dedicated catalog command independently and classify real exit codes as `pass` or `expected_fail`. Generate a fresh context pack and handoff bound only to the new baseline and results. Validate all artifact digests and forbidden-material scans.

Use two commits: first the baseline/results/context/handoff artifact commit, then a receipt-only commit binding the artifact commit and exact bytes. Record both repository heads and user-fork remote refs. Do not change tooling in this task. Write `.superpowers/sdd/task-pi-2-report.md` and update `.superpowers/sdd/post-integration-progress.md`.
