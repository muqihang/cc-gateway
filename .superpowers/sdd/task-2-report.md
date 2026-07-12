# Task 2 Report: Claim Matrix and Authority Rules

## Result

DONE_WITH_CONCERNS

Commit: `e90f1e6` (`feat: add oracle lab claim authority matrix`)

## RED Evidence

`npm exec tsx tests/oracle-lab-claim-matrix.test.ts` initially failed with `ERR_MODULE_NOT_FOUND` for the missing `tools/oracle-lab/validate-claims.js` implementation.

The follow-up production fixture also correctly failed with `authority_ceiling_exceeded` until the `upstream_canary` ceiling was widened to represent a fully evidenced `production_verified` claim.

## GREEN Evidence

- Claim matrix tests: 6 passed.
- Task 1 traceability regression: 14 passed.
- Task 0.5 baseline freeze regression: passed.
- JSON parsing for registry and schema: passed.
- `git diff --check`: passed.

The tests cover valid local structural and pinned-client observations, provider-internal synthetic correlation rejection, authority/scope mismatch, local server-acceptance overclaiming, pre-canary production rejection, schema enum/strictness parity, and a fully populated production evidence fixture.

## Changed Files

- `docs/superpowers/registry/oracle-lab-claims.json`
- `docs/superpowers/schemas/oracle-lab-claim.schema.json`
- `tools/oracle-lab/validate-claims.ts`
- `tests/oracle-lab-claim-matrix.test.ts`

The validator reuses Task 1's `ValidationError`/`ValidationResult` shape and validates strict fields, enum ceilings, evidence scope, server dependency, confidence, contradictions, expiry, provider disclosure, canary linkage, production gates, rollback evidence, and deployed digests.

## Self-Review

- Provider-internal claims remain `unverified` without an authoritative provider disclosure; synthetic correlation cannot elevate them.
- Local observations cannot imply server acceptance.
- Production verification is fail-closed on canary, required registry gates, rollback evidence, deployed commit/config/manifest digests, expiry, and contradictions.
- No secrets, machine paths, credentials, upstream calls, deployment, package changes, or parent evidence changes were introduced.

## Concerns

Full `npm exec tsc -- --noEmit` remains blocked by the pre-existing missing type declarations/modules for `https-proxy-agent` and `socks-proxy-agent` in `src/proxy-agent.ts`. Package and lock files were intentionally left unchanged per task instructions.

## FIX2

Result: DONE_WITH_CONCERNS

The remaining authority-boundary gap is closed. `validateClaims` now validates the entire caller-supplied requirement array through Task 1's complete strict in-memory registry contract before constructing any requirement map or deriving production authority. This enforces the fixed inventory, canonical source-section mapping, complete record shape, status transitions, production-only field rules, strict timestamps/artifacts, and duplicate evidence-array rejection. Invalid, partial, missing, invented, or fabricated requirement registries fail closed with `invalid_requirement_registry`.

RED/GREEN coverage was added for partial registries, invented inventory IDs, and duplicate requirement evidence arrays. Existing exact evidence-union and artifact linkage behavior remains covered.

Verification:

- `npm exec tsx tests/oracle-lab-claim-matrix.test.ts`: 13 passed.
- `npm exec tsx tests/oracle-lab-traceability.test.ts`: 14 passed.
- `npm exec tsx tests/oracle-lab-baseline-freeze.test.ts`: passed.
- Focused strict `tsc` for both validators and relevant tests: passed.
- JSON parsing for registry/schema/requirements: passed.
- `git diff --check`: passed.
- Full `npm test` and project `npm exec tsc -- --noEmit`: blocked only by pre-existing missing `https-proxy-agent` and `socks-proxy-agent` modules/types in `src/proxy-agent.ts`; package and lock files remain unchanged.

## FIX

Result: DONE_WITH_CONCERNS

Fix commit: `a9b1250` (`fix: bind claim authority to requirement evidence`)

The claim validator now binds every `production_verified` claim to authoritative referenced RequirementRecords. Each referenced requirement must itself be current `production_verified` authority with a verified repository/commit, non-expired canary/gate/rollback evidence, no contradictions, and valid deployed artifacts. Claim canary, production-gate, rollback, aggregate evidence IDs, and deployed repository/commit/config/manifest records must exactly equal the authoritative union; invented, partial, extra, local-only, design-only, deferred, failing-test, or canary-only authority is rejected.

Local structural and observational claims now reject both server and provider dependencies at every authority state. Provider-internal claims remain `unverified` without authoritative disclosure. Authority scopes, ceilings, non-unverified evidence, provider disclosure, local dependency boundaries, production fields, non-production emptiness, strict arrays, and deployed artifact structure are encoded in the JSON schema.

Task 1's strict RFC3339 calendar validator is exported and reused, so impossible dates are rejected consistently.

Verification:

- `npm exec tsx tests/oracle-lab-claim-matrix.test.ts`: 11 passed.
- `npm exec tsx tests/oracle-lab-traceability.test.ts`: 14 passed.
- `npm exec tsx tests/oracle-lab-baseline-freeze.test.ts`: passed.
- Focused strict `tsc` for both validators and the claim tests: passed.
- Claim registry/schema JSON parse: passed.
- `git diff --check`: passed.
- Full `npm exec tsc -- --noEmit` and `npm run build`: blocked only by the pre-existing missing `https-proxy-agent` and `socks-proxy-agent` modules/types in `src/proxy-agent.ts`; package and lock files remain unchanged.
