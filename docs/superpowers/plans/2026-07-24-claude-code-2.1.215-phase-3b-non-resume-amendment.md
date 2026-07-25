# Claude Code 2.1.215 Phase 3B Non-Resume Amendment Plan

Status: `BLOCKED` plan only; Option A operator decision bound; no implementation authority

Date: 2026-07-24

## 1. Decision and Amendment Boundary

This document amends only the resume hard gate in the merged Phase 3B profile-synthesis plan. It does not replace the merged plan, authorize implementation, authorize a dynamic campaign, or authorize Phase 4/runtime wiring.

The controlling operator decision is Option A: proceed with a non-resume-only Phase 3B amendment. The only positive Phase 3A conclusions allowed as behavior evidence are:

- `CL-P3A-R2-CONFIG-AUTH`
- `CL-P3A-R2-FAILURE-STREAM`

Every resume/session-lineage claim and every other Phase 3A Unknown remains fail-closed disabled. A merged amendment is documentation, not authority to execute the future implementation DAG.

### 1.1 Frozen control inputs

| Input | SHA-256 | Required disposition |
|---|---|---|
| Phase 3B non-resume planning prompt | `081777f0b8cc09d36b8fc84b510acf963f6ef1dc239e0505e7c85960f173a011` | Controlling planning instructions |
| Option A operator decision receipt | `40395bb8240a89dc2be68674ebca70718702b0ae9d95647f28eb7c62feea8cc6` | Supersedes only the resume hard gate |
| Planning handoff | `be05df33cc14d2d58f6acae6d886833591764857340cfab7ba67dfec865fdfc3` | Planning input, not implementation authority |
| P3A-S terminal report | `c9fd98ef3296227a91f09b55e09f72763c5730e560cec63dded594bffbb8bf6c` | `TERMINAL_BLOCKED`; no resume evidence |
| P3A-S decision memo | `ec8365bc551e6759ed164b4f7607b6142b2a220d228e83f32dd0fc1e751636c2` | Option A recommendation context |
| P3A-S static checks | `dde3d4aa46282cbf41ff7e780b7e97f82dd055131ca70a3f521cf83772e34b89` | Planning-chain validation only |

### 1.2 Merged plan relationship

The amendment is append-only relative to `docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3b-profile-synthesis.md` at SHA-256 `367eb28af225ae4d5bf0b666a4c2d3161da7d911f28dc6cb188cb38c1b65a8aa`.

The following merged-plan rules remain controlling:

- plan-only scope and no runtime wiring;
- strict schema validation and fail-closed admission;
- deterministic canonicalization and cross-repository agreement;
- provenance, expiry, contradiction, revocation, generation-floor, rollback, and downgrade protection;
- focused RED/GREEN tests before implementation acceptance;
- no modification of live CC Gateway or Sub2API request paths.

The following merged-plan requirement is superseded only for this amendment:

- A positive resumed-session fixture is no longer an implementation entry or exit requirement. Resume becomes a required disabled capability and a required negative fixture.

The amendment does not claim completion of the original full Phase 3B resume scope. It defines a separately reviewable `non_resume_only` capability mode.

Planning verdict: the field-level evidence is insufficient to implement the existing minimum truthful candidate contract. The allowed inputs do not expose an executable new-session streaming Messages request or its required method, authority, path, headers, canonical body, and final-byte fields. Option A supersedes only resume; it does not waive those unrelated requirements. Sections 5 through 12 therefore define the exact bounded projection, terminal A0, and non-authoritative successor concerns. This PR may be merged only as an append-only blocked planning record.

## 2. Frozen Repository and Tooling Baseline

### 2.1 Repository identities

| Repository | Planning root | Remote | Base commit | Base tree | State |
|---|---|---|---|---|---|
| CC Gateway | `/Users/muqihang/.codex/worktrees/e7ac/cc-gateway` | `https://github.com/muqihang/cc-gateway.git` | `be2be3f68753deb79bbc44a1605a03bb18c032b9` | `ecc165832059cdbc771a66bd3be586816006e9c5` | clean; docs-only branch `codex/claude-code-2.1.215-phase3b-non-resume-amendment-plan` |
| Sub2API | `/Users/muqihang/.codex/worktrees/e7ac/sub2api-phase3b-non-resume-planning` | `https://github.com/muqihang/sub2api.git` | `fb840673afc0ff590fef9bb147fce5b9b70eb098` | `eeb8654eddf7a4c38364202f5024161e65d2a6d1` | clean; detached read-only planning root |

Before any later implementation, fetch both remotes again and require these commits to remain ancestors of the selected implementation bases. If either base changes, re-run CodeGraph reconnaissance and re-bind all exact file/symbol references before editing.

### 2.2 Toolchain identities

| Repository | Toolchain | Lock/module inputs | Planning digest |
|---|---|---|---|
| CC Gateway | Node `v24.7.0`; npm `11.5.1` | `package.json` `b13504dd...`; `package-lock.json` `7f9a7df3...`; `tsconfig.json` `dc694512...` | `28ead006320a4f5cdd8caea117795472dadbb1e5e9207a16296b46dc6ce7ccea` |
| Sub2API | `go version go1.26.5 darwin/arm64`; `GOTOOLCHAIN=auto` | `backend/go.mod` `5f2ece02...`; `backend/go.sum` `44315167...` | `ce68d2fc4a8e67e65c597de8bc8f8da2cf74dc57c525cc8019cd493bf6d190d9` |

The abbreviated component hashes above are human orientation only. Future implementation records must capture complete component hashes and recompute the aggregate digest.

### 2.3 CodeGraph and protected-file rule

CodeGraph `1.1.6` was refreshed at both frozen roots with the same exact exclusion configuration:

```json
{"exclude":["backend/internal/service/openai_compact_sse_keepalive_test.go"]}
```

The configuration file SHA-256 is `f885ea40698ff4de9881ce6a9537388ce80c04be9515bf2c77ac186d39140e98`.

| Repository | Indexed files | Nodes | Edges | Pending | Protected count |
|---|---:|---:|---:|---:|---:|
| CC Gateway | 264 | 9,362 | 33,245 | 0 | 0 |
| Sub2API | 3,064 | 98,766 | 331,888 | 0 | 0 |

The protected-count query is:

```sql
SELECT COUNT(*)
FROM files
WHERE path = 'backend/internal/service/openai_compact_sse_keepalive_test.go';
```

The result must remain `0`. The protected keepalive file must not be read, searched, indexed, compiled, or tested during planning or implementation. Package-wide Go tests are prohibited because they could compile that file indirectly.

## 3. Authority and Evidence Bindings

### 3.1 Predecessor contract

The Phase 2 contract bundle is bound through:

- handoff: `docs/superpowers/2026-07-19-claude-code-2.1.215-phase-2-handoff.md`
- handoff SHA-256: `a5454d630dc470cda54adaaed6a4eab5ebd2b8c53909ae5487e4a59b29cee4d9`
- contract bundle digest: `2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce`
- predecessor digest: `70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1`
- schema range: `1:0-0`
- fixture/command inventory: 65 fixtures and 7 commands

Phase 2 supplies structural contract rules only. It is not behavior evidence for uncovered Claude Code fields.

### 3.2 Phase 3A closure authority

The Phase 3A closure root is `/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A`.

| Artifact | Relative path | SHA-256 | Required state |
|---|---|---|---|
| Exit report | `capsules/P3A-4/phase-3a-exit-report-v13.json` | `57f16b207933b3a751f96471733d435fa4b0c9801fbef2f5495e8884dfe0bd1b` | GREEN |
| Phase 3B handoff | `capsules/P3A-4/phase-3b-3.5-handoff-v13.json` | `9d188072719dc27a2f9cc9939bc79afa598802b84dd4d9161fb1da3263a792d7` | READY candidate; two usable conclusions only |
| Terminal manifest | `capsules/P3A-4/closure-terminal-manifest-v8.json` | `c9ee57fbe29125c88278961565f814326b052077b861bb41008cdde6161f12f5` | GREEN |
| Artifact index | `capsules/P3A-4/artifact-index-v23.json` | `e8645c7ed4bc984a926f91e3df1b756c4b009b3a02408de213cbe81b060e80d4` | Complete binding |
| Leak scan | `capsules/P3A-4/leak-scan-v23.json` | `7ed3e2776c7fcc47d6c8d513318b33547919c92a33a068a4f0c0cb3706bad145` | PASS; zero findings |

All allowed Phase 3A evidence expires at `2026-08-03T00:00:00.000Z`. The future compiler must reject it at or after that instant. This plan does not extend the expiry.

### 3.3 Allowed normalized-safe projections

Only the following normalized-safe files may supply behavior fields. Raw transcripts, raw request/response material, and successor P3A-S namespaces are forbidden compiler inputs.

| Binding ID | Relative path | SHA-256 / schema | Conclusion / scope / expiry | Permitted use |
|---|---|---|---|---|
| `safe.config-precedence` | `capsules/P3A-2/closure-r2-config-precedence-v2/summary.json` | `a41dbc159b6b17ad6a6a2c52afa9bb3a74055ac8ca0b74a60d112ff044c32b69`; `oracle-lab-phase3a-config-precedence-campaign.v1` | `CL-P3A-R2-CONFIG-AUTH`; `claude-code-2.1.215 darwin-arm64 synthetic loopback fixtures`; `2026-08-03T00:00:00.000Z` | Four reproduced precedence edges |
| `safe.auth-lifecycle` | `capsules/P3A-2/closure-r2-auth-lifecycle-v1/summary.json` | `3c78e19294106d9ad6e72e9ef273f1432b593e47a2f503f93e1d02482ef9e7b3`; `oracle-lab-phase3a-auth-lifecycle-campaign.v1` | `CL-P3A-R2-CONFIG-AUTH`; `claude-code-2.1.215 darwin-arm64 synthetic loopback fixtures`; `2026-08-03T00:00:00.000Z` | Rotation and missing-credential outcomes |
| `safe.auth-coexistence` | `capsules/P3A-2/closure-r2-auth-coexistence-v2/summary.json` | `103f4d7455aabe0954a378ac267479c6d80df0119d306d9877cf44e6417df39e`; `oracle-lab-phase3a-auth-lifecycle-campaign.v1` | `CL-P3A-R2-CONFIG-AUTH`; `claude-code-2.1.215 darwin-arm64 synthetic loopback fixtures`; `2026-08-03T00:00:00.000Z` | Stable selection only; not winner identity |
| `safe.failure-stream` | `capsules/P3A-2/closure-r2-scenario-closure-v2.json` | `0b2d86d8c84fcfeec9c071bcbb739a8bda70cf77fc97324ad36da26092e8c6d0`; `oracle-lab-phase3a-scenario-closure.v1` | `CL-P3A-R2-FAILURE-STREAM`; `claude-code-2.1.215 darwin-arm64 synthetic loopback fixtures`; `2026-08-03T00:00:00.000Z` | Bounded terminal outcome classes |
| `safe.coverage` | `capsules/P3A-2/closure-r2-coverage-v8.json` | `9496dce47210fb66304431e776c4ff0c49afb1c138066753362a7ff3d9a7b15b`; `oracle-lab-phase3a-r2-closure.v2` | both allowed conclusion IDs; `claude-code-2.1.215 darwin-arm64 synthetic loopback fixtures`; `2026-08-03T00:00:00.000Z` | Coverage/Unknown consistency only; no behavior leaf |

Every row has sensitivity `normalized-safe`. The compiler must whitelist these exact paths, schema IDs, digests, conclusion IDs, scope, expiry, and sensitivity. Symlinks, path traversal, replacement files, additional files, and schema-version drift are hard failures.

### 3.4 Namespace separation

The future implementation must create a new Phase 3B profile namespace, for example `oracle-lab-profile-synthesis.v1`. It must not reuse any P3A-S authority, context, receipt, evidence, attempt, cell, or terminal namespace. P3A-S artifacts may be cited only as the signed record that resume remains unavailable and that Option A was selected.

### 3.5 Normative source and requirement traceability

| Normative source | SHA-256 | Application to this amendment |
|---|---|---|
| `docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md` | `00519348d9dd8972dbea92a647d67c2fc42e9015ece6dcb0eb427df02480b107` | Phase ordering and no direct evidence-to-runtime promotion |
| `docs/superpowers/roadmaps/2026-07-18-oracle-lab-delivery-operating-model-v2.md` | `a53e7384d6cf353877af82f16196b8d58ed823277e76e03337dfc9fadff7d0ea` | Plan/review/implementation authority separation |
| `docs/superpowers/registry/oracle-lab-requirements.json` | `875086715d3a05b0af81fdc2d0bf2988a61106621f632f87efdb5d76f2492772` | Machine-readable requirement ownership and gates |
| `docs/superpowers/registry/oracle-lab-review-requirements.json` | `06b7dca841b3a3288c128db48616398659b5ba3e2bf82fc490ed84aa8a4b5ac4` | Independent review requirements |
| `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-design.md` | `f54f3aa730144e4d2b438c9af63f83aaaaab22e6e4c56d8b99983d5aadb54fc8` | Normative compatibility model |
| `docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md` | `f1ccedc813e6edfbd50fb7779221e0fa4b9fd62863e0562fecf9c06c920f478e` | Fail-closed negative-capability enforcement |
| `docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md` | `6883d66d74bd1e92f97625348c67559aa56c1f5e7542398635228a88814c57b2` | Section 4 Phase 3B inputs, outputs, minimum candidate, compiler, and WP-R5 gates |

The 2.1.207 source document names are structural governance predecessors incorporated by the merged 2.1.215 plan. They are not behavior evidence and cannot be relabeled as 2.1.215 observations.

| Requirement | Disposition |
|---|---|
| `RA-P0-001` deterministic evidence-to-profile compiler | Conditionally specified in Sections 6-12; implementation not authorized |
| `RA-P0-002` minimum truthful local candidate | **BLOCKED**: no allowed executable new-session request projection |
| `RA-P0-005` versioned cross-project contract/readiness | Preserved as validator/manifest agreement only; runtime readiness stays out of scope |
| `RA-P0-007` bounded response/retry authority | Only terminal outcome classes are covered; retry ownership remains disabled |
| `RA-P0-009` protected production disabled | Preserved absolutely |
| `RA-P1-001` machine-readable coverage | Section 5 field-level matrix |
| `RA-P1-002` coherent identity/request/response/control/auth/transport profiles | Covered fields specified; required uncovered executable fields disabled, so promotion remains blocked |
| `RA-P1-003` de-identified canonical fixtures | Conditional bounded fixtures specified; truthful request fixture unavailable |
| `RA-P1-004` lineage/migration | Explicitly disabled by Option A |
| `RA-P1-007` liveness/readiness/capability separation | Runtime readiness remains out of scope |
| `RA-P1-008` nonessential traffic observation | Telemetry/diagnostic/update remains disabled |
| `HA-P0-003`, `HA-P0-009`, `HA-P1-001` | Existing authority, negative-capability, and compatibility gates remain unchanged |

### 3.6 Exact plan-level blocker

The existing review amendment Section 4.3 requires request, response, control-plane, transport, authentication, lineage, negative-capability, tuple, config, and typed canonical fixture outputs. Section 4.4 requires at least one truthful candidate with a new-session streaming Messages request after removing only the resume case. Section 4.5 requires the compiler to generate all upstream-visible version, header, body, and transport values.

The allowed projections establish only:

- four config precedence relationships;
- API-key/token rotation outcome classes, missing-credential failure, and stable coexistence selection without winner identity;
- six HTTP status outcome classes, connection reset, partial-stream terminal, and complete-stream terminal classes;
- Darwin arm64 synthetic-loopback scope and artifact identity.

They do not establish method, authority, path, query, headers, content encoding, body AST, final bytes, exact response/SSE grammar, stop/usage semantics, control-plane route/trigger/destination, transport/retry boundaries, or a typed request/response fixture. Those fields are correctly `D` in Section 5. A tuple containing only the covered envelope is evidence metadata, not the executable local candidate required by `RA-P0-002`.

The minimum revision is one new operator decision that preserves Option A and chooses exactly one path:

1. Authorize a separate plan-only, normalized-safe evidence-sufficiency task for the missing non-resume new-session request/response fields, followed by a new reviewed conclusion allowlist; or
2. Explicitly amend the Section 4.3-4.5 minimum candidate contract beyond the resume hard gate.

The first path preserves the current compatibility bar and is preferred. Neither path is authorized by Option A, and neither may be executed in this planning task.

## 4. Scope and Fail-Closed Capability Policy

### 4.1 Enabled capability classes

Only these bounded classes may produce enabled profile fields:

1. New-session, non-resume policy scope.
2. Reproduced config precedence edges.
3. Synthetic placeholder credential lifecycle outcomes.
4. Bounded HTTP failure, reset, partial-stream, and complete-stream terminal classes.
5. Structural identity, provenance, canonicalization, expiry, contradiction, revocation, generation, rollback, and cross-repository agreement fields required by the predecessor contract.

### 4.2 Required disabled capability IDs

`negative-capabilities.schema.json` uses the following exhaustive closed `capability_id` enum for this amendment. Each ID must have an explicit record with reason, source conclusion/requirement, affected profile pointers, failure action, and expiry/revalidation condition.

P3A Unknown/omitted/terminal-pair IDs:

```text
compact-cache-lifecycle-untriggered
positive-nonessential-traffic-untriggered
resume-restart-lineage-untriggered
provider-tls-equivalence-out-of-scope
cross-platform-runtime-unavailable
linux-runtime-equivalence-unknown
windows-runtime-equivalence-unknown
tier-a-2.1.214-long-run-unknown
tier-a-2.1.214-restart-unknown
tier-a-2.1.212-restart-unknown
tier-a-2.1.211-base-url-background-restart-unknown
```

The four Tier A IDs above are the exact terminal Unknown pairs; reproduced pairs from those versions are not relabeled as 2.1.215 evidence. The eleven IDs collectively cover all eight omitted-cell families, with Linux and Windows split explicitly under cross-platform corroboration and the three Tier A cells expanded to their four exact terminal pairs.

Option A and uncovered-field IDs:

```text
option-a-resume-session-lineage-disabled
option-a-task-lineage-disabled
option-a-parent-child-lineage-disabled
option-a-transcript-recovery-disabled
build-timestamp-category-uncovered
user-agent-uncovered
x-stainless-values-uncovered
installation-mode-uncovered
runtime-metadata-uncovered
detached-signature-unknown
request-method-uncovered
request-authority-uncovered
request-path-uncovered
request-query-uncovered
request-headers-uncovered
request-content-encoding-uncovered
request-body-ast-uncovered
request-final-bytes-uncovered
request-system-prompt-uncovered
request-tool-schema-uncovered
response-headers-uncovered
response-body-uncovered
sse-event-grammar-uncovered
usage-semantics-uncovered
stop-reason-uncovered
retry-owner-uncovered
retry-count-uncovered
retry-timing-uncovered
recovery-mechanics-uncovered
control-plane-route-uncovered
control-plane-method-uncovered
control-plane-trigger-uncovered
control-plane-destination-uncovered
transport-proxy-identity-uncovered
transport-resolver-policy-uncovered
transport-destination-set-uncovered
transport-tls-http-uncovered
transport-connection-state-uncovered
auth-header-serialization-uncovered
auth-coexistence-winner-uncovered
credential-persistence-uncovered
credential-refresh-uncovered
credential-revocation-uncovered
credential-restart-uncovered
minimum-truthful-candidate-unavailable
```

Preserved predecessor/runtime-boundary IDs:

```text
evidence-version-relabel-disabled
real-upstream-disabled
real-credentials-disabled
profile-promotion-disabled
staging-disabled
production-disabled
real-canary-disabled
protected-sidecar-authority-disabled
replay-disabled
destination-enforcement-disabled
direct-egress-fallback-disabled
phase4-runtime-wiring-disabled
dynamic-campaign-disabled
```

No wildcard, free-form capability ID, or omission is valid. Disabled means absent from enabled payloads and present in a tagged record. It never means an enabled field with an empty, zero, default, or guessed value.

## 5. Field-Level Coverage Matrix

This matrix is normative and precedes the implementation DAG. A future implementation may narrow a row, but may not broaden it without a new operator decision and newly reviewed evidence.

Legend:

- `E`: enabled evidence-derived field.
- `C`: enabled contract/control field, not a Claude Code behavior claim.
- `D`: required fail-closed disabled field.

| Profile/object | Exact field or enum | Class | Source and transformation | Negative/expiry rule |
|---|---|---:|---|---|
| `bundle` | `schema_id = oracle-lab-profile-synthesis.v1` | C | Phase 2 schema discipline plus this amendment | Unknown schema or version rejected |
| `bundle` | `capability_mode = non_resume_only` | C | Option A receipt, exact digest bound | Any resume-capable mode rejected |
| `bundle` | `active_target = claude-code@2.1.215` | C | Frozen Phase 3A exit identity | Version mismatch rejected |
| `identity` | wrapper archive `1a5cf8e491689154264c0b2f28371bf645cdee2903b45c497915868308502d7b`; wrapper tree `024fa410b532ced37cd9e45a95aae6f9eb22e9ce8491e1fad843f24d958f4a88` | E | Exact normalized-safe exit-report identity fields | Missing or mismatched digest rejected |
| `identity` | platform archive `b5dd6a135c96957dae232218c4ae5b04328a788f8c509202c92a2fec550601b2`; platform tree `864f493d9fc237df6a858e1620c83279b8f6c15f205dbb47c058f3f537e924a6` | E | Exact normalized-safe exit-report identity fields | Missing or mismatched digest rejected |
| `identity` | release archive `599883973d2b4c8bb25e3490c84d65646f78d158cdc86adc73c1f5a6cfbbd600`; release tree `f5a04795289524b639b479fe6ffac187218d7c558a5a5be312ee228850c6e7fe` | E | Exact normalized-safe exit-report identity fields | Missing or mismatched digest rejected |
| `identity` | `entrypoint_sha256 = 90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58` | E | Exact exit-report field | Platform/release disagreement rejected |
| `identity` | `platform = darwin/arm64` | E | Allowed conclusion scope | Other platform emitted as disabled, not equivalent |
| `identity` | macOS signature state | E | Exact normalized-safe exit field | Detached-signature status remains disabled/Unknown |
| `identity` | build timestamp, user-agent value, install mode, runtime-global state | D | No allowed normalized-safe field | Must not appear in enabled identity payload |
| `request_scope` | `session_mode = new_non_resume` | C | Option A policy boundary | `resume`, `restart`, `child`, or lineage-bearing values rejected |
| `request_scope` | `transport_scope = synthetic_loopback` | E | Both allowed conclusion scopes | Real-upstream or credentialed scope rejected |
| `request_scope` | `stream_scenario_supported = true` | E | `CL-P3A-R2-FAILURE-STREAM` reproduced partial/complete stream classes | Does not imply exact request or SSE grammar |
| `request_scope` | method, path, headers, body, system prompt, tool schema, exact stream flag serialization | D | Not present in allowed safe projections | Fields forbidden in enabled payload |
| `config` | precedence edge `default < user` | E | `config-precedence-user-vs-default` reproduced pair | Pair must be present and reproduced |
| `config` | precedence edge `user < project` | E | `config-precedence-project-vs-user` reproduced pair | Pair must be present and reproduced |
| `config` | precedence edge `project < local` | E | `config-precedence-local-vs-project` reproduced pair | Pair must be present and reproduced |
| `config` | precedence edge `local < process_env` | E | `config-precedence-process-env-vs-local` reproduced pair | Pair must be present and reproduced |
| `config` | ordered precedence `default,user,project,local,process_env` | E | Deterministic transitive reduction of exactly the four edges above | Missing, duplicate, cyclic, or additional edge rejected |
| `config` | concrete config keys and values | D | Not exposed by allowed safe projections | Never copied or guessed |
| `auth` | credential class `synthetic_placeholder_api_key` | E | Auth lifecycle safe projection | Real credential values forbidden |
| `auth` | credential class `synthetic_placeholder_token` | E | Auth lifecycle safe projection | Real credential values forbidden |
| `auth` | lifecycle `api_key_rotation = reproduced` | E | Exact reproduced outcome | Header/value mechanics disabled |
| `auth` | lifecycle `token_rotation = reproduced` | E | Exact reproduced outcome | Refresh/persistence disabled |
| `auth` | lifecycle `missing_credential_failure = reproduced` | E | Exact reproduced outcome | Exact error bytes disabled |
| `auth` | coexistence `stable_selection = reproduced` | E | Auth coexistence supplement | Winning credential identity/order disabled |
| `auth` | header name, serialization, precedence winner, persistence, refresh, revocation, restart behavior | D | Not present in allowed projections | Forbidden in enabled payload |
| `failure_stream` | `http_400`, `http_401`, `http_403`, `http_429`, `http_500`, `http_529` | E | Exact reproduced scenario outcome classes | Status-class enum closed; response body/headers disabled |
| `failure_stream` | `connection_reset` | E | Exact reproduced reset scenario | Retry owner/count/timing disabled |
| `failure_stream` | `partial_sse_terminal` | E | Exact reproduced partial-stream terminal class | Exact event sequence/grammar disabled |
| `failure_stream` | `complete_sse_terminal` | E | Exact reproduced complete-stream terminal class | Exact event sequence/grammar disabled |
| `failure_stream` | terminal-class ordering | C | Closed enum sorted lexicographically during canonicalization | Source array order cannot add semantics |
| `failure_stream` | exact bytes, headers, SSE events, retry/recovery mechanics, timing | D | Not present in allowed projections | Forbidden in enabled payload |
| `disabled_capability` | `capability_id` exhaustive closed enum | C | Every exact ID in Section 4.2 | Missing or unknown capability IDs rejected |
| `disabled_capability` | `state = disabled` | C | Option A and fail-closed policy | No `unknown-but-enabled` state |
| `disabled_capability` | `reason_code` | C | One of `evidence_unknown`, `outside_observed_scope`, `option_a_exclusion`, `field_not_covered` | Free-form behavioral claim rejected |
| `disabled_capability` | resume/session/task lineage family | D | P3A-S terminal block plus Phase 3A Unknown | Must be disabled in every coherent tuple |
| `input_binding.safe_payload[]` | `relative_path`, `sha256`, `schema_id`, `schema_major`, `schema_revision`, `evidence_level`, `conclusion_id`, `issued_at_ms`, `expires_at_ms`, `predecessor_digest` | C | Exact predecessor `Phase3BInputBinding.v1`; Section 3 allowlist only | Any missing/unbound field, wrong repository/root, or unindexed safe payload rejects input |
| `input_binding` | exact repository heads/trees; P2 bundle/range/predecessor; exit/handoff/terminal/index/leak bindings; compiler schema version; sorted negative IDs | C | Frozen repositories, P2 handoff, and Sections 1-4 | Drift or missing predecessor binding rejects input |
| `input_binding` | `phase3b_usable = true` for each positive conclusion | C | Exact Phase 3A handoff/exit field | False/missing rejects conclusion |
| `input_binding` | source kind | C | Closed union `p3a_safe_projection`, `p3a_safe_closure`, `p2_contract`, `operator_policy`, `derived_structural` | Raw or P3A-S execution-receipt reuse rejected; exact Option A policy receipt required |
| `provenance` | every generated leaf JSON pointer to exactly one source binding | C | Evidence, P2 contract, or Option A policy source kind | Any unmapped leaf, including negative/control/rollback/config/tuple/index leaves, rejects bundle |
| `provenance` | transform ID and transform version | C | Closed deterministic transformation registry | Unknown transform rejects bundle |
| `provenance` | observed scope and expiry | C | Minimum scope and earliest expiry of contributing sources | Scope broadening or expiry extension rejected |
| `expiry` | `expires_at` | C | Minimum of all behavior-source expiries, currently no later than `2026-08-03T00:00:00.000Z` | Reject at `now >= expires_at` |
| `contradiction` | contradiction IDs and state | C | Exact closure/index cross-check | Any open/nonempty contradiction disables admission |
| `revocation` | evidence/profile revocation IDs | C | Closed digest-addressed lists | Any matching source/profile digest disables admission |
| `generation_state` | tagged union `initial` or `successor` | C | Reviewed generation input; no clock/random generation | Union mixing or missing predecessor rejected |
| `generation_state.initial` | `current_generation = 1`, `rollback_floor_generation = 0`, `predecessor_tuple_digest = null` | C | Allowed only when both repositories contain no prior profile bundle | Existing prior bundle makes initial invalid |
| `generation_state.successor` | positive current generation, floor, predecessor tuple digest | C | Explicit reviewed input bound to current canonical predecessor | Current must exceed predecessor; floor cannot decrease |
| `coherent_tuple` | bundle/profile/fixture/config/provenance digests and generation | C | Canonical SHA-256 over exact generated leaves | Any mismatched member rejects tuple |
| `rollback` | tagged target union | C | Section 8 exact union | Mixed target fields rejected |
| `config_projection` | `enabled` plus profile/tuple refs | C | Generated from admitted coherent tuple | Non-admitted tuple cannot be referenced |
| `config_projection` | disable-to-no-profile state | C | Exact no-profile branch | All profile and tuple refs must be null/absent |
| `cross_repo` | TS/Go schema, canonical bytes, digest, decision, reason code | C | Shared fixture corpus and independent validators | Any disagreement blocks release |

## 6. Planned Schemas, Files, and Symbols

All paths in this section are future implementation targets. None are created by this plan-only PR.

Exact predecessor-to-amendment delta:

| Merged-plan contract item | Amendment disposition |
|---|---|
| Nine schema filenames and strict variant ownership | Unchanged |
| `mutation-corpus.json` and `expected-results.json` | Unchanged and required |
| All non-lineage generated artifact filenames | Unchanged |
| `session-task-lineage-profile.json` | Filename retained; payload is the Option A disabled tagged branch only |
| `fixtures/resumed-session-streaming.json` | Sole removed positive artifact; replaced by negative `fixtures/resume-denied.json` |
| Entire CC contract/generated tree mirrored under Sub2API testdata | Unchanged |
| Product/runtime/load paths | Unchanged and out of scope |

No other predecessor schema, field, artifact, mirror, validator, or ownership requirement is deleted or renamed.

### 6.1 CC Gateway contract and compiler files

Create under `contracts/oracle-lab/profile-synthesis/v1/`:

- `profile.schema.json`
- `fixture.schema.json`
- `phase3b-input-binding.schema.json`
- `field-provenance.schema.json`
- `negative-capabilities.schema.json`
- `coherent-tuples.schema.json`
- `config-projection.schema.json`
- `rollback-tuple.schema.json`
- `bundle-index.schema.json`
- `mutation-corpus.json`
- `expected-results.json`

Create compiler modules:

- `tools/oracle-profile/input.ts`
  - `loadProfileSynthesisInputs`
  - `verifyAllowedInputBinding`
  - `verifyClosureConsistency`
  - `verifyEvidenceFreshness`
- `tools/oracle-profile/compile.ts`
  - `compileNonResumeProfileBundle`
  - `projectConfigAuthProfile`
  - `projectFailureStreamProfile`
  - `projectDisabledCapabilities`
  - `buildFieldProvenance`
- `tools/oracle-profile/deterministic-writer.ts`
  - `encodeCanonicalProfileJson`
  - `writeProfileBundleAtomically`
- `tools/oracle-profile/validate.ts`
  - `validateProfileBundle`
  - `decideProfileAdmission`
  - `validateRollbackDecision`
- `tools/oracle-profile/check-cross-repo.ts`
  - `checkProfileCrossRepoAgreement`
  - `loadGoAgreementResults`

Create reusable TypeScript validation surface:

- `src/oracle-profile/types.ts`
- `src/oracle-profile/schema.ts`
- `src/oracle-profile/validator.ts`

The implementation should reuse, without weakening:

- `src/oracle-contract/canonical.ts::canonicalizeJsonValue`
- `src/oracle-contract/canonical.ts::sha256Hex`
- `src/oracle-contract/admission.ts::decideBehaviorAdmission`
- `src/oracle-contract/manifest-authority.ts::trustStateDigest`
- `src/oracle-contract/manifest-authority.ts::verifyManifestAuthorityUpdate`
- `src/oracle-contract/cross-project.ts::decideReadiness`
- `tools/oracle-contract/check-shared-contract.ts::checkSharedContract`
- `tools/oracle-contract/check-cross-repo.ts::checkCrossRepoContract`

The Phase 3A artifact writer uses exclusive creation but is not a deterministic profile-bundle writer because filesystem metadata is not a bundle identity. Reuse its safe atomicity pattern only; profile identity must be canonical content plus explicit schema/generation state.

### 6.2 Generated CC Gateway artifacts

Generate under `contracts/oracle-lab/profile-synthesis/v1/generated/`:

- `input-binding.json`
- `client-build-identity.json`
- `request-profile.json`
- `response-stream-profile.json`
- `control-plane-profile.json`
- `transport-profile.json`
- `authentication-profile.json`
- `session-task-lineage-profile.json`
- `negative-capabilities.json`
- `coherent-tuples.json`
- `rollback-tuple.json`
- `cc-gateway-config.json`
- `sub2api-config.json`
- `field-provenance.json`
- `fixtures/new-session-streaming.json`
- `fixtures/bounded-failure-recovery.json`
- `fixtures/resume-denied.json`
- `fixtures/deterministic-regeneration.json`
- `bundle-index.json`

`session-task-lineage-profile.json` is a strict disabled tagged branch, and `resume-denied.json` is a negative admission fixture. No positive resumed-session profile or fixture may be generated. All other names preserve the merged plan's ownership boundary.

### 6.3 TypeScript test files

Create focused test files:

- `tests/oracle-profile-input.test.ts`
- `tests/oracle-profile-compile.test.ts`
- `tests/oracle-profile-canonical.test.ts`
- `tests/oracle-profile-admission.test.ts`
- `tests/oracle-profile-rollback.test.ts`
- `tests/oracle-profile-cross-repo.test.ts`

Do not add these tests to a broader command that executes unrelated runtime integration suites.

### 6.4 Sub2API mirror and validator files

Create:

- `backend/internal/oracleprofile/types.go`
- `backend/internal/oracleprofile/validator.go`
- `backend/internal/oracleprofile/validator_test.go`
- `backend/internal/oracleprofile/testdata/go-agreement-result.json`

Mirror the entire byte-identical CC `contracts/oracle-lab/profile-synthesis/v1/` schema/corpus/expected/generated tree under:

- `backend/internal/service/testdata/oracle_profile_contract/v1/`

Planned Go symbols:

- `ParseProfileBundleStrict`
- `CanonicalizeProfileJSON`
- `ValidateProfileBundle`
- `DecideProfileAdmission`
- `ValidateRollbackDecision`
- `VerifyCrossRepoManifest`
- `WriteAgreementResult`

`backend/internal/oracleprofile/testdata/go-agreement-result.json` is the exact deterministic Go result consumed by `tools/oracle-profile/check-cross-repo.ts::loadGoAgreementResults`. It binds corpus digest, per-fixture parse/canonical/admission/rollback decisions, closed reason codes, Go validator version, and Sub2API commit/tree. It is not part of the byte-identical mirror and is regenerated only by the focused oracleprofile checker.

The implementation should reuse or preserve parity with:

- `backend/internal/service/oracle_contract_canonical.go::CanonicalizeOracleJSON`
- `backend/internal/service/oracle_contract_admission.go::DecideOracleBehaviorAdmission`
- `backend/internal/service/oracle_contract_authority.go::VerifyOracleManifestAuthorityUpdate`
- `backend/internal/service/oracle_contract_cross_project.go::DecideOracleReadiness`

Do not modify live handlers, schedulers, sidecars, deployment configuration, or the protected keepalive test.

## 7. Deterministic Input, Canonicalization, and Provenance Rules

### 7.1 Strict input parser

`Phase3BInputBinding.v1` is unchanged outside the Option A conclusion/negative selection. It binds exact repository heads/trees, P2 bundle/range/predecessor, the five closure paths/digests/schemas, the five normalized-safe payloads, the two allowed conclusion IDs, claim ceilings, compiler schema version, and the complete sorted Section 4.2 enum. Every safe payload row requires all of `relative_path`, `sha256`, `schema_id`, `schema_major`, `schema_revision`, `evidence_level`, `conclusion_id`, `issued_at_ms`, `expires_at_ms`, and `predecessor_digest`. Normalized-safe payloads must be present in the exact artifact index; only the five closure artifacts use the independently checked external binding exception. Directory walking and implicit supporting-artifact discovery remain forbidden.

Both language implementations must reject:

- duplicate JSON object keys;
- unknown fields at every schema object;
- trailing content;
- invalid UTF-8, unpaired surrogates, non-I-JSON numbers, non-finite numbers, and integer overflow;
- symlinked inputs, path traversal, files outside the bound root, and path case ambiguity;
- wrong schema ID/version, digest, sensitivity, scope, conclusion ID, or `phase3b_usable` state;
- expired, revoked, contradicted, incomplete, or internally inconsistent closure artifacts;
- any P3A-S evidence/receipt/context namespace used as positive behavior evidence;
- source files larger than their fixed cap.

Caps:

- each safe projection: 256 KiB;
- each closure/control JSON input: 2 MiB;
- generated leaf: 256 KiB;
- generated bundle: 8 MiB and at most 128 files;
- JSON depth: 64;
- object keys per document: 4,096;
- array elements per document: 16,384.

These are parser resource limits, not observed behavior claims. A later implementation may lower them with test updates but may not raise them without review.

### 7.2 Canonical bytes

Canonical in-memory values use RFC 8785/JCS-compatible JSON semantics through the existing TS and Go canonicalization surfaces. Generated files use:

1. strict schema-normalized value;
2. canonical JSON bytes;
3. exactly one final LF for the filesystem representation;
4. SHA-256 over the canonical JSON bytes without the final LF for logical object identity;
5. SHA-256 over the exact file bytes for bundle file binding.

Generators sort sets lexicographically by their documented identity key. Validators reject noncanonical set order rather than silently sorting or normalizing it. Semantic sequences retain schema-declared order, and validators reject a reordered semantic sequence even when it contains the same elements. The config precedence list is a semantic sequence derived only from the four reproduced edges. Source filesystem enumeration, map iteration, wall clock, locale, host path, inode, mtime, process ID, and random values must never affect output.

### 7.3 Deterministic writer

`writeProfileBundleAtomically` must:

- compile into a new sibling staging directory;
- create files exclusively with mode `0600`;
- fsync files and directory where supported;
- verify every staged digest and bundle index;
- refuse to overwrite a non-identical existing generation;
- rename the verified directory atomically;
- leave the prior generation intact until admission of the new coherent tuple succeeds;
- emit no secret or raw evidence bytes in paths, logs, diagnostics, or generated files.

The implementation must use a temporary location outside the final bundle namespace and clean it only through ordinary scoped program cleanup. No repository-wide `git clean` or destructive workspace command is allowed.

### 7.4 Per-field provenance

Every generated leaf in the input binding, every profile variant, negative-capability manifest, coherent tuple, rollback tuple, both config projections, every fixture, expected results, agreement result, and bundle index must have exactly one JSON Pointer row in `field-provenance.json`. Coverage is not limited to enabled behavior fields.

Each row preserves the predecessor shape:

```text
pointer, evidence_level, source_kind, source_id, source_relative_path,
source_digest, source_schema_id, source_schema_revision, transform
```

- Evidence-derived leaves bind one exact Section 3 normalized-safe input and allowed conclusion ID.
- P2 schema/range/admission/authority/rollback leaves bind the P2 bundle and predecessor digest.
- Option A mode, disabled records, and planning-policy leaves bind the exact operator receipt or normative requirement.
- Derived tuple/config/fixture/index leaves bind their complete ordered inputs through a closed transform ID; they do not claim behavior evidence.
- Negative, rollback, generation, revocation, contradiction, config, tuple, and manifest/index fields are never exempt.

The provenance map's own representation is schema-attested and its file digest is bound by the bundle index; it does not recursively map its own rows. The bundle index does not contain its own file digest. These two exclusions avoid a hash cycle without exempting any independently consumable generated field.

Allowed transform IDs:

- `copy_exact.v1`
- `closed_enum_projection.v1`
- `precedence_chain_from_reproduced_edges.v1`
- `minimum_expiry.v1`
- `scope_intersection.v1`
- `disabled_from_unknown.v1`
- `canonical_digest.v1`

Any required leaf without exactly one provenance row is invalid. Duplicate pointers, uncovered pointers, unbound source kinds, and source path/schema/digest mismatches are invalid. Provenance cannot convert an Unknown, contract fact, or policy field into behavior evidence.

## 8. Admission, Contradiction, Expiry, Revocation, Generation, and Rollback

### 8.1 Admission decision

`decideProfileAdmission` returns a closed tagged union:

```text
admitted { coherent_tuple_digest, generation, expires_at }
denied   { reason_code, subject_digest?, detail_id? }
```

Closed denial reason codes:

- `schema_invalid`
- `canonicalization_mismatch`
- `digest_mismatch`
- `input_binding_invalid`
- `evidence_expired`
- `evidence_revoked`
- `evidence_contradicted`
- `scope_mismatch`
- `capability_disabled`
- `generation_invalid`
- `generation_below_floor`
- `predecessor_mismatch`
- `tuple_incoherent`
- `cross_repo_disagreement`
- `authority_insufficient`

Unknown reason codes are themselves schema failures.

### 8.2 Expiry and contradiction

The profile expiry is the earliest behavior-source expiry. With the bound inputs, it cannot exceed `2026-08-03T00:00:00.000Z`. The compiler and validators use an injected RFC 3339 `now` for tests and a single captured UTC time for a real run. Admission denies at equality.

Any of these is a contradiction failure:

- the closure/index reports an open or nonempty contradiction for an allowed conclusion;
- the exit, handoff, terminal manifest, index, or safe projection disagrees on conclusion state, scope, expiry, sensitivity, digest, or usability;
- TypeScript and Go derive different canonical values, digests, or decisions;
- an enabled field conflicts with a disabled capability boundary.

Contradiction resolution requires new reviewed evidence. The compiler cannot choose one source silently.

### 8.3 Revocation

The input binding carries digest-addressed evidence revocations and profile revocations. A revocation match invalidates every dependent profile, tuple, rollback target, and config projection. Revocation lists are canonical sorted sets and are included in the trust-state digest. Removing a revocation requires a strictly newer reviewed authority generation; it cannot occur through ordinary recompilation.

### 8.4 Generation floor

Generation state is an exact tagged union:

```text
initial {
  current_generation: 1,
  rollback_floor_generation: 0,
  predecessor_tuple_digest: null
}

successor {
  current_generation: integer >= 2,
  rollback_floor_generation: integer >= 0 and <= current_generation,
  predecessor_tuple_digest: sha256
}
```

`initial` is valid only when both repositories contain no prior profile bundle or mirror. A successor must increment the admitted predecessor generation, bind its canonical tuple digest, and keep the rollback floor monotonically nondecreasing. Generation is explicit reviewed input, never time- or randomness-derived.

### 8.5 Exact rollback tagged union

The amendment preserves the merged predecessor union exactly. `rollback-tuple.schema.json` uses root `oneOf`, branch `additionalProperties: false`, and root `unevaluatedProperties: false`.

```text
schema_id, schema_major, schema_revision, rollback_tuple_id
active_profile_tuple_digest, evidence_source_relative_path, evidence_source_digest
evidence_source_schema_id, current_generation, issued_at_ms, expires_at_ms, contradiction_ids

target oneOf:
  coherent_tuple:
    target_kind="coherent_tuple"
    rollback_target_tuple_digest, rollback_profile_refs, target_generation
    rollback_floor_generation, target_expires_at_ms, revoked, revocation_ids
  disable_to_no_profile:
    target_kind="disable_to_no_profile"
    deny_reason_code, negative_capability_ref
    removal_semantics="remove_generated_profile_refs_and_disable_local_conformance"
    # rollback_target_tuple_digest, rollback_profile_refs, target_generation,
    # rollback_floor_generation, target_expires_at_ms, revoked, revocation_ids are forbidden
```

Common rules:

- `issued_at_ms` and `expires_at_ms` are copied from reviewed authority/evidence inputs and cannot use compiler wall clock.
- The two target variants are mutually exclusive. A missing/unknown tag, mixed branch, ambiguous `oneOf`, or extra/missing branch field is invalid.
- A coherent target is selected only from an independently generated, schema-valid coherent tuple whose profile digests all resolve, whose generation is lower than current but not below the rollback floor, whose active build/platform/architecture/installation scope matches, and whose evidence remains unexpired, unrevoked, contradiction-free, and cross-repository agreed.
- A coherent target cannot enable `option-a-resume-session-lineage-disabled` or any other current negative capability.
- A P2 contract/predecessor digest cannot substitute for a profile tuple digest.
- If no coherent target satisfies every condition, the only valid target is `disable_to_no_profile`.

### 8.6 Disable-to-no-profile semantics

For `disable_to_no_profile`:

- both repository config projections set `enabled = false`;
- `negative_capability_ref` is one exact Section 4.2 ID; for the present blocker it is `minimum-truthful-candidate-unavailable`, while resume-specific denials use `option-a-resume-session-lineage-disabled`;
- `removal_semantics` is exactly `remove_generated_profile_refs_and_disable_local_conformance`;
- all generated profile, tuple, generation, fixture, and provenance refs are removed from both local projections, not left as nullable fallback candidates;
- a closed `deny_reason_code` is retained for audit;
- admission of any request as profile-conformant is denied;
- no fallback, default profile, previous unverified file, or runtime-discovered profile is selected;
- runtime wiring remains out of scope, so this is a contract/config artifact only.

## 9. Cross-Repository Agreement Contract

### 9.1 Bundle index as cross-repository manifest

`bundle-index.json` is the cross-repository manifest and binds:

- schema bundle digest;
- every generated logical-object and member-file digest except the bundle index's own file digest; the index logical digest covers its canonical payload without a self row;
- coherent tuple digest and generation;
- profile expiry and scope digest;
- revocation/trust-state digest;
- CC Gateway base commit/tree;
- Sub2API base commit/tree;
- TypeScript and Go validator protocol versions;
- shared fixture corpus digest;
- expected admission and rollback decisions for every fixture.

### 9.2 Independent validation

TypeScript generates the candidate bundle. Go must parse and validate the exact copied bytes independently; it must not consume TypeScript-produced intermediate values. TypeScript then verifies the Go result file against the manifest. This is the required TypeScript, Go, manifest, fixture, and cross-repository agreement. Agreement requires identical:

- strict parse accept/reject result;
- canonical JSON bytes and logical digest;
- file digest;
- normalized schema value;
- admission decision and closed reason code;
- rollback decision;
- disable-to-no-profile projection.

### 9.3 Shared mutation corpus

The corpus must include at least:

- duplicate and unknown keys;
- wrongly ordered set and reordered semantic sequence for every array-bearing schema variant;
- trailing JSON and invalid UTF-8;
- invalid number and integer overflow;
- wrong schema/version/conclusion ID;
- wrong repository identity or repository-root binding;
- path traversal, symlink, wrong digest, wrong sensitivity, or wrong scope;
- expired evidence at the exact boundary;
- revoked evidence/profile;
- open contradiction;
- positive resume or lineage field;
- unsupported platform/TLS/telemetry/update/compact field;
- missing field provenance;
- precedence edge missing, duplicate, additional, or cyclic;
- unsupported HTTP status or exact SSE grammar claim;
- incoherent tuple member;
- initial generation with existing predecessor;
- successor generation replay, skipped predecessor, or decreased floor;
- rollback below floor, expired target, revoked target, wrong scope, or mixed union;
- disable-to-no-profile with a residual profile reference;
- TS/Go manifest digest or decision disagreement;
- oversize file, excessive depth, key count, array count, or bundle file count.

Each mutation must have one exact expected closed denial code in both languages.

## 10. RED/GREEN Test Plan

### 10.1 TypeScript RED tests

Write failing tests before compiler/validator implementation:

- `oracle-profile-input.test.ts`: accepts only the five allowed safe projections and closure bindings; rejects P3A-S namespaces, raw artifacts, mismatches, expiry, contradiction, and symlinks.
- `oracle-profile-compile.test.ts`: emits only matrix-enabled fields; emits all required disabled capabilities; never emits resume, exact request, exact SSE grammar, retry, or real credential fields.
- `oracle-profile-canonical.test.ts`: regenerates byte-identically under shuffled input enumeration, locale/TZ changes, and a different checkout root.
- `oracle-profile-admission.test.ts`: covers every denial reason and exact expiry equality.
- `oracle-profile-rollback.test.ts`: covers the exact union, floor monotonicity, revocation, contradiction, and disable-to-no-profile residual-reference denial.
- `oracle-profile-cross-repo.test.ts`: fails on any manifest, canonical byte, digest, normalized value, decision, or reason-code disagreement.

The expected RED result is a nonzero focused command for every test file with named assertion failures caused by absent Phase 3B schema/compiler/validator behavior, not syntax errors or disabled tests.

### 10.2 TypeScript GREEN tests

Implement the smallest contract/compiler/validator surface needed to make every focused command exit zero with no skipped required case. No `src/index.ts`, `src/proxy.ts`, live network path, credential store, runtime profile loader, or Phase 4 hook may be added.

### 10.3 Go RED/GREEN tests

`backend/internal/oracleprofile/validator_test.go` must first fail against the shared valid and mutation corpus. Implement only the independent strict parser, canonicalizer, admission/rollback validator, and agreement result writer. Do not import service runtime handlers or execute a package-wide test command.

### 10.4 Required future focused commands

CC Gateway commands, subject to repository-script verification at implementation time:

```bash
npm exec tsx tests/oracle-profile-input.test.ts
npm exec tsx tests/oracle-profile-compile.test.ts
npm exec tsx tests/oracle-profile-canonical.test.ts
npm exec tsx tests/oracle-profile-admission.test.ts
npm exec tsx tests/oracle-profile-rollback.test.ts
npm exec tsx tests/oracle-profile-cross-repo.test.ts
npm exec tsc -- --noEmit
```

Sub2API commands from `backend/`:

```bash
go test ./internal/oracleprofile -run 'TestProfile'
go test ./internal/oracleprofile -run 'TestCanonical|TestAdmission|TestRollback|TestCrossRepo'
```

Prohibited commands include `go test ./...`, tests of `./internal/service`, Claude Code execution, dynamic cells, live upstream calls, real credentials, sudo, and any command that reads or compiles the protected keepalive file.

## 11. Terminal Blocked DAG and Successor Outline

The current amendment has one normative DAG node. It is terminal and has no implementation successor under Option A.

```json
{
  "status": "terminal_blocked",
  "nodes": [
    {"id":"A0","name":"publish-blocked-handoff-and-request-operator-decision","owner":"phase3b-planning-controller","deps":[],"terminal":true}
  ]
}
```

### A0: publish blocked handoff and request operator decision

- Publish this exact blocked plan, review verdict, static checks, dual-repository bindings, and PR.
- Request one of the Section 3.6 operator decisions.
- Do not collect evidence, amend the contract, create implementation authority, or enter A1 under this DAG.
- A future operator decision cannot resume this DAG. It must create a successor docs-only amendment that updates the field matrix, schemas, tests, DAG, and handoff against fresh bases; that successor requires independent review and merge, followed by a separate implementation decision.

### Non-authoritative successor work outline

The A1-A9 headings below preserve the implementation concerns and ownership requested by the merged plan, but they are not nodes, dependencies, authority, or executable work in this amendment. A successor amendment must re-derive and review them; it may not copy them as authority after evidence or contract scope changes.

### A1: revalidate evidence and CodeGraph exclusion

- Verify every full digest in Sections 1 and 3.
- Reject implementation if allowed evidence is expired, revoked, contradicted, missing, or schema-drifted.
- Refresh CodeGraph using the exact exclusion configuration and prove `protected_count=0` in both repositories.
- Re-run symbol reconnaissance if either frozen tree differs from Section 2.

### A2: shared schemas and TypeScript RED tests

- Add the nine schemas and TS types in Section 6.
- Add all focused TS RED tests and mutation fixtures.
- Commit only schemas/types/tests; record genuine RED output.

### A3: strict input and deterministic compiler

- Implement exact input whitelist, digest/schema/scope/expiry/contradiction checks.
- Project only fields marked `E` or `C` in Section 5.
- Emit explicit disabled records for every `D` row.
- Implement per-field provenance and deterministic canonical writer.

### A4: TypeScript admission, rollback, and GREEN tests

- Implement closed admission and rollback unions.
- Enforce revocation, generation predecessor/floor, coherent tuple, and disable-to-no-profile rules.
- Make the focused TS suite GREEN without runtime wiring.

### A5: generate and verify CC bundle

- Generate from the exact allowed safe inputs into a clean staging path.
- Regenerate twice under perturbed enumeration/root/TZ/locale and require byte equality.
- Verify bundle index, coherent tuple, provenance coverage, negative capabilities, and no secret/raw material.

### A6: Sub2API Go RED/GREEN validator

- Create only `backend/internal/oracleprofile` and its focused tests.
- Independently parse/canonicalize/validate the shared corpus.
- Preserve closed reason-code parity with TS.
- Do not touch or compile service runtime packages.

### A7: mirror and cross-repository agreement

- Copy exact generated bytes from the admitted CC bundle into the Sub2API testdata mirror.
- Never hand-edit the mirror.
- Run independent Go validation and write a deterministic agreement result.
- Run the TS cross-repository checker over exact Go results and both commit/tree identities.

### A8: focused static and determinism closure

- Run only commands in Section 10.4 and plan-approved manifest/digest scripts.
- Re-run protected-count queries and repository clean/status review.
- Confirm no live/runtime/Phase 4 file changed and no raw evidence or credentials entered either repository.

### A9: independent implementation review and handoff

- Review field coverage, namespace separation, evidence freshness, canonicalization, rollback, revocation, generation floor, disabled capabilities, and TS/Go agreement holistically.
- Require zero Critical and zero Important findings before recommending the implementation PR for merge.
- The implementation PR still must not wire runtime behavior.

## 12. Successor-Only Repository Commit Boundaries

These are non-authoritative commit boundaries for the successor amendment to reconsider. No implementation commit is permitted by the current terminal DAG. If retained after the blocker changes the matrix, future commits must be reviewable and must not mix repository ownership.

### 12.1 CC Gateway commits

1. `test(profile): add non-resume schemas and RED corpus`
   - schemas, TS types, focused RED tests, mutations only.
2. `feat(profile): compile deterministic non-resume bundle`
   - strict input, projections, provenance, canonical writer.
3. `feat(profile): enforce admission rollback and generation floor`
   - validators, closed decisions, focused GREEN results.
4. `chore(profile): generate verified profile bundle`
   - generated artifacts and bundle index only.
5. `test(profile): verify cross-repository agreement`
   - cross-repo checker/result binding only.

### 12.2 Sub2API commits

1. `test(oracleprofile): add strict validator RED corpus`
   - package types, tests, and shared mutation expectations.
2. `feat(oracleprofile): validate non-resume profile contract`
   - parser, canonicalizer, admission/rollback validator.
3. `chore(oracleprofile): mirror admitted profile bundle`
   - byte-identical generated mirror and deterministic agreement result only.

No commit may contain runtime handler, scheduler, sidecar, deployment, real-upstream, credential, protected-file, or Phase 4 changes. Cross-repository commit messages should bind the counterpart commit and coherent tuple digest after both histories exist.

## 13. Entry, Exit, and Stop Gates

### 13.1 Plan-only PR exit gate

This amendment is ready for merge recommendation only as a blocked planning record when:

- the PR changes documentation only;
- the plan SHA-256 is reported;
- both frozen repository commit/tree identities are reported;
- prompt/decision/handoff/evidence hashes are validated;
- CodeGraph protected count is zero in both repositories;
- plan/static checks pass;
- one independent `gpt-5.6-sol` holistic review has run;
- if that holistic review reports any Critical or Important finding, at most one consolidated bounded fix wave and exactly one closure re-review are used;
- either the initial no-finding verdict or the required closure re-review reports zero Critical and zero Important findings;
- the PR is ready, not Draft, and is not self-merged.

### 13.2 Future implementation entry gate

Merging this plan does not satisfy implementation entry. A future implementation requires:

- a successor docs-only amendment that resolves Section 3.6, updates the matrix/schemas/tests/DAG/handoff, passes independent review, and merges;
- a separate implementation decision issued only after that successor amendment merges;
- fresh dual-repository freezes and CodeGraph results;
- unexpired, unrevoked, contradiction-free allowed evidence;
- a reviewed Phase 3B generation input/namespace;
- genuine RED tests committed before implementation code.

If the evidence has expired, the next operator decision is either to authorize a separately planned normalized-safe evidence refresh/revalidation or to stop Phase 3B. Option A does not authorize that refresh automatically.

### 13.3 Future non-resume implementation exit gate

This gate is illustrative and cannot be reached or authorized by this amendment. A reviewed successor amendment must restate it after Section 3.6 is resolved. Without weakening unrelated gates, that successor must require all four positive cases and the required negative case:

1. A truthful new-session streaming Messages request with every Section 4.3-4.5 required request/response/control/transport field supported by newly reviewed normalized-safe evidence.
2. Bounded failure/stream terminal-class profile.
3. Deterministic byte-identical regeneration.
4. TypeScript/Go/manifest/fixture agreement.
5. Resume/session/task-lineage fixture is denied with the exact closed reason code.

The current sparse scope/config/auth envelope cannot satisfy the first positive case and cannot be promoted to a candidate tuple.

### 13.4 Immediate stop conditions

Stop and report a plan/implementation blocker if:

- either allowed conclusion is no longer `phase3b_usable=true`;
- any bound digest/schema/scope/expiry disagrees;
- evidence is expired, revoked, contradicted, or outside the observed scope;
- CodeGraph protected count is nonzero;
- the implementation needs a resume, exact request, exact SSE, retry, credential-winner, compact/cache, cross-platform, telemetry/update, or TLS-positive claim;
- TS and Go cannot reach exact agreement;
- a live/runtime file would need modification;
- more than one consolidated review fix wave is required for this plan-only PR.

## 14. Plan-Only Static Checks

Run only static/document checks for this PR:

```bash
node <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const closeout = '/Users/muqihang/.codex/evidence/claude-code-2.1.215-p3as-20260724-controller-thread-label-fix/closeout/p3as-terminal-blocked-v1';
const p3a = '/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A';
const bindings = [
  [path.join(closeout, 'phase3b-non-resume-amendment-planning-prompt.md'), '081777f0b8cc09d36b8fc84b510acf963f6ef1dc239e0505e7c85960f173a011'],
  [path.join(closeout, 'operator-decision-option-a.json'), '40395bb8240a89dc2be68674ebca70718702b0ae9d95647f28eb7c62feea8cc6'],
  [path.join(closeout, 'phase3b-non-resume-amendment-planning-handoff.json'), 'be05df33cc14d2d58f6acae6d886833591764857340cfab7ba67dfec865fdfc3'],
  [path.join(closeout, 'terminal-blocked-report.json'), 'c9fd98ef3296227a91f09b55e09f72763c5730e560cec63dded594bffbb8bf6c'],
  [path.join(closeout, 'phase3b-handoff-decision-memo.md'), 'ec8365bc551e6759ed164b4f7607b6142b2a220d228e83f32dd0fc1e751636c2'],
  [path.join(closeout, 'static-check-result.json'), 'dde3d4aa46282cbf41ff7e780b7e97f82dd055131ca70a3f521cf83772e34b89'],
  [path.join(p3a, 'capsules/P3A-4/phase-3a-exit-report-v13.json'), '57f16b207933b3a751f96471733d435fa4b0c9801fbef2f5495e8884dfe0bd1b'],
  [path.join(p3a, 'capsules/P3A-4/phase-3b-3.5-handoff-v13.json'), '9d188072719dc27a2f9cc9939bc79afa598802b84dd4d9161fb1da3263a792d7'],
  [path.join(p3a, 'capsules/P3A-4/closure-terminal-manifest-v8.json'), 'c9ee57fbe29125c88278961565f814326b052077b861bb41008cdde6161f12f5'],
  [path.join(p3a, 'capsules/P3A-4/artifact-index-v23.json'), 'e8645c7ed4bc984a926f91e3df1b756c4b009b3a02408de213cbe81b060e80d4'],
  [path.join(p3a, 'capsules/P3A-4/leak-scan-v23.json'), '7ed3e2776c7fcc47d6c8d513318b33547919c92a33a068a4f0c0cb3706bad145'],
  [path.join(p3a, 'capsules/P3A-2/closure-r2-config-precedence-v2/summary.json'), 'a41dbc159b6b17ad6a6a2c52afa9bb3a74055ac8ca0b74a60d112ff044c32b69'],
  [path.join(p3a, 'capsules/P3A-2/closure-r2-auth-lifecycle-v1/summary.json'), '3c78e19294106d9ad6e72e9ef273f1432b593e47a2f503f93e1d02482ef9e7b3'],
  [path.join(p3a, 'capsules/P3A-2/closure-r2-auth-coexistence-v2/summary.json'), '103f4d7455aabe0954a378ac267479c6d80df0119d306d9877cf44e6417df39e'],
  [path.join(p3a, 'capsules/P3A-2/closure-r2-scenario-closure-v2.json'), '0b2d86d8c84fcfeec9c071bcbb739a8bda70cf77fc97324ad36da26092e8c6d0'],
  [path.join(p3a, 'capsules/P3A-2/closure-r2-coverage-v8.json'), '9496dce47210fb66304431e776c4ff0c49afb1c138066753362a7ff3d9a7b15b'],
  ['docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3b-profile-synthesis.md', '367eb28af225ae4d5bf0b666a4c2d3161da7d911f28dc6cb188cb38c1b65a8aa'],
  ['docs/superpowers/2026-07-19-claude-code-2.1.215-phase-2-handoff.md', 'a5454d630dc470cda54adaaed6a4eab5ebd2b8c53909ae5487e4a59b29cee4d9'],
  ['docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md', '00519348d9dd8972dbea92a647d67c2fc42e9015ece6dcb0eb427df02480b107'],
  ['docs/superpowers/roadmaps/2026-07-18-oracle-lab-delivery-operating-model-v2.md', 'a53e7384d6cf353877af82f16196b8d58ed823277e76e03337dfc9fadff7d0ea'],
  ['docs/superpowers/registry/oracle-lab-requirements.json', '875086715d3a05b0af81fdc2d0bf2988a61106621f632f87efdb5d76f2492772'],
  ['docs/superpowers/registry/oracle-lab-review-requirements.json', '06b7dca841b3a3288c128db48616398659b5ba3e2bf82fc490ed84aa8a4b5ac4'],
  ['docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-design.md', 'f54f3aa730144e4d2b438c9af63f83aaaaab22e6e4c56d8b99983d5aadb54fc8'],
  ['docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md', 'f1ccedc813e6edfbd50fb7779221e0fa4b9fd62863e0562fecf9c06c920f478e'],
  ['docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md', '6883d66d74bd1e92f97625348c67559aa56c1f5e7542398635228a88814c57b2']
];
for (const [file, expected] of bindings) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`unsafe binding: ${file}`);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (actual !== expected) throw new Error(`digest mismatch: ${file}`);
}
console.log(`binding allowlist: ${bindings.length}/${bindings.length} PASS`);
NODE

test "$(printf '%s\n' '{"exclude":["backend/internal/service/openai_compact_sse_keepalive_test.go"]}' | shasum -a 256 | awk '{print $1}')" = f885ea40698ff4de9881ce6a9537388ce80c04be9515bf2c77ac186d39140e98
test "$(shasum -a 256 codegraph.json | awk '{print $1}')" = f885ea40698ff4de9881ce6a9537388ce80c04be9515bf2c77ac186d39140e98
test "$(shasum -a 256 /Users/muqihang/.codex/worktrees/e7ac/sub2api-phase3b-non-resume-planning/codegraph.json | awk '{print $1}')" = f885ea40698ff4de9881ce6a9537388ce80c04be9515bf2c77ac186d39140e98
codegraph status
codegraph status /Users/muqihang/.codex/worktrees/e7ac/sub2api-phase3b-non-resume-planning
test "$(sqlite3 .codegraph/codegraph.db "SELECT COUNT(*) FROM files WHERE path='backend/internal/service/openai_compact_sse_keepalive_test.go';")" = 0
test "$(sqlite3 /Users/muqihang/.codex/worktrees/e7ac/sub2api-phase3b-non-resume-planning/.codegraph/codegraph.db "SELECT COUNT(*) FROM files WHERE path='backend/internal/service/openai_compact_sse_keepalive_test.go';")" = 0

git diff --check
test "$(git diff --name-only muqihang/main...HEAD)" = docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-non-resume-amendment.md

rg -n 'CL-P3A-R2-(CONFIG-AUTH|FAILURE-STREAM)|non_resume_only|disable_to_no_profile|rollback_floor_generation|protected_count' \
  docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-non-resume-amendment.md

! rg -n 'TO[D]O|TB[D]' \
  docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-non-resume-amendment.md

node <<'NODE'
const fs = require('fs');
const path = 'docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-non-resume-amendment.md';
const text = fs.readFileSync(path, 'utf8');
const matrix = text.indexOf('## 5. Field-Level Coverage Matrix');
const dagHeading = text.indexOf('## 11. Terminal Blocked DAG and Successor Outline');
if (matrix < 0 || dagHeading < 0 || matrix >= dagHeading) throw new Error('matrix/DAG order');
const fence = String.fromCharCode(96).repeat(3);
const rest = text.slice(dagHeading);
const open = rest.indexOf(fence + 'json\n');
const start = open + fence.length + 5;
const end = rest.indexOf('\n' + fence, start);
const dag = JSON.parse(rest.slice(start, end));
if (dag.status !== 'terminal_blocked' || dag.nodes.length !== 1) throw new Error('nonterminal DAG');
const node = dag.nodes[0];
if (node.id !== 'A0' || node.terminal !== true || node.deps.length !== 0) throw new Error('invalid terminal node');
const indegree = new Map([[node.id, 0]]);
const ready = [...indegree].filter(([, n]) => n === 0).map(([id]) => id);
let visited = 0;
while (ready.length) { ready.pop(); visited++; }
if (visited !== 1) throw new Error('Kahn failure');
const bashBlocks = [...text.matchAll(/```bash\n([\s\S]*?)\n```/g)].map((match) => match[1]);
const forbidden = ['go test ./' + '.' + '..', 'su' + 'do ', 'clau' + 'de '];
for (const block of bashBlocks) {
  for (const token of forbidden) {
    if (block.includes(token)) throw new Error(`forbidden plan command: ${token}`);
  }
}
console.log(`terminal DAG Kahn ${visited}/1 PASS; checked ${bashBlocks.length} bash blocks`);
NODE
```

The allowlist checker is read-only, rejects missing paths and symlinks, and never walks an evidence directory. The final `rg` must have zero matches. The structural Node check verifies matrix-before-DAG, the one-node terminal DAG through Kahn, and dangerous/out-of-scope executable forms inside shell command blocks.

Do not run Claude Code, dynamic cells, product tests, package-wide Go tests, live upstream requests, real credentials, sudo, or Phase 4 wiring checks for this plan-only PR.

## 15. Review Protocol

1. Give one independent `gpt-5.6-sol` reviewer the frozen prompt, Option A receipt, planning handoff, this amendment, merged predecessor plan, and exact static-check report.
2. Ask for one holistic pass across evidence fidelity, field coverage, schema closure, deterministic canonicalization, provenance, expiry, contradiction, revocation, generation floor, rollback union, disable-to-no-profile, negative capabilities, TS/Go agreement, tests, commands, and commit boundaries.
3. Consolidate all Critical and Important findings into at most one bounded fix wave. Do not reopen scope for wording or optional hardening.
4. Only if step 3 is used, give the same reviewer the amended plan and fix ledger for exactly one closure re-review. If the first holistic pass already has zero Critical and zero Important, no closure re-review occurs.
5. Recommend merge only at zero Critical and zero Important. Do not merge the PR.

## 16. Remaining Unknowns and Next Operator Decision

The following remain Unknown and disabled after this amendment:

- resume/restart/session/task/parent-child lineage and transcript recovery;
- compact/cache and tier-A dynamic behavior for 2.1.211, 2.1.212, and 2.1.214;
- cross-platform equivalence;
- telemetry, diagnostic, and update behavior;
- positive TLS runtime behavior;
- exact request/response/SSE/retry/auth serialization and lifecycle mechanics not present in the allowed normalized-safe projections;
- detached signature status and uncovered identity/runtime metadata.

The next operator decision after merge is not automatic implementation. It must first resolve Section 3.6 by choosing one of:

1. Authorize a separate normalized-safe evidence-sufficiency planning task for the missing non-resume candidate fields, then review a new conclusion allowlist.
2. Explicitly amend the minimum truthful candidate contract beyond the resume hard gate.
3. Stop Phase 3B and retain disable-to-no-profile behavior.

No option authorizes Phase 4 wiring, live upstream execution, real credentials, dynamic campaign work, or resume support.
