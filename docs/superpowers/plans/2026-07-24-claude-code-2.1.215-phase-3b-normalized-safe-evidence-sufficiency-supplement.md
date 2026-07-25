# Claude Code 2.1.215 Phase 3B Normalized-Safe Evidence-Sufficiency Supplement Plan

Status: plan only; no evidence collection, Phase 3B implementation, product change, or runtime authority

Date: 2026-07-24

## 1. Purpose and Decision Boundary

The merged non-resume amendment proved that Option A removes only the resume hard gate. It did not
provide the executable new-session request and response evidence required by the merged Phase 3B
profile-synthesis plan. This supplement plans a separate, future normalized-safe evidence campaign
that may close that field-level gap. It does not perform that campaign and does not authorize it.

This plan is append-only relative to:

- `docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3b-profile-synthesis.md` at SHA-256
  `367eb28af225ae4d5bf0b666a4c2d3161da7d911f28dc6cb188cb38c1b65a8aa`;
- `docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-non-resume-amendment.md` at SHA-256
  `51a6f19addd87f1591ae15a1f8f14951bf732954b58fcc722a97fee246c0d4f7`.

The current state remains fail closed:

- only `CL-P3A-R2-CONFIG-AUTH` and `CL-P3A-R2-FAILURE-STREAM` are positive predecessor
  conclusions;
- both predecessor conclusions expire at `2026-08-03T00:00:00.000Z` and must be rejected at or
  after that instant;
- their expiry values are immutable historical facts and may not be edited, copied into a new
  conclusion, or extended by changing timestamps;
- the future campaign must independently reproduce the covered behavior, check for contradictions,
  and issue successor conclusions with a genuinely new issue instant and expiry;
- no field becomes `phase3b_usable=true` unless every required E-class leaf in Section 6 is closed
  by Reproduced evidence from the same coherent campaign tuple;
- merging this plan authorizes neither the future campaign nor a Phase 3B successor amendment.

The only target capability is one truthful, executable, new-session, non-resume, streaming Messages
candidate on Claude Code 2.1.215, Darwin arm64, against a synthetic loopback fake upstream with
synthetic credentials. The campaign must not reopen or infer:

- resume, restart, child-process, task, or session lineage;
- P3A-S, its authority, its receipts, or its Observer B lifecycle;
- compact or prompt-cache behavior;
- positive telemetry, diagnostic, or update behavior;
- provider TLS equivalence;
- Linux or Windows runtime equivalence;
- Tier A terminal Unknown pairs or any other omitted P3A cell;
- real upstream, real credentials, production, canary, protected sidecar authority, or Phase 4.

## 2. Frozen Planning Authority

### 2.1 Operator and P3A-S closeout bindings

The following records are decision and negative-scope inputs only. They are not positive behavior
evidence and may not be used as successor conclusion sources.

| Record | Absolute path | SHA-256 | Permitted use |
|---|---|---|---|
| Option A receipt | `/Users/muqihang/.codex/evidence/claude-code-2.1.215-p3as-20260724-controller-thread-label-fix/closeout/p3as-terminal-blocked-v1/operator-decision-option-a.json` | `40395bb8240a89dc2be68674ebca70718702b0ae9d95647f28eb7c62feea8cc6` | Non-resume policy boundary only |
| Terminal report | `/Users/muqihang/.codex/evidence/claude-code-2.1.215-p3as-20260724-controller-thread-label-fix/closeout/p3as-terminal-blocked-v1/terminal-blocked-report.json` | `c9fd98ef3296227a91f09b55e09f72763c5730e560cec63dded594bffbb8bf6c` | Proves resume remains Unknown and target launches were zero |
| Decision memo | `/Users/muqihang/.codex/evidence/claude-code-2.1.215-p3as-20260724-controller-thread-label-fix/closeout/p3as-terminal-blocked-v1/phase3b-handoff-decision-memo.md` | `ec8365bc551e6759ed164b4f7607b6142b2a220d228e83f32dd0fc1e751636c2` | Historical rationale only |
| Static checks | `/Users/muqihang/.codex/evidence/claude-code-2.1.215-p3as-20260724-controller-thread-label-fix/closeout/p3as-terminal-blocked-v1/static-check-result.json` | `dde3d4aa46282cbf41ff7e780b7e97f82dd055131ca70a3f521cf83772e34b89` | Planning-chain validation only |
| Planning handoff | `/Users/muqihang/.codex/evidence/claude-code-2.1.215-p3as-20260724-controller-thread-label-fix/closeout/p3as-terminal-blocked-v1/phase3b-non-resume-amendment-planning-handoff.json` | `be05df33cc14d2d58f6acae6d886833591764857340cfab7ba67dfec865fdfc3` | Plan/review limits and prohibitions |

The P3A-S closeout says `dynamic_cells_started=false`, `target_launches=0`,
`resume_session_lineage=UNKNOWN`, and `phase3b_usable=false`. This plan preserves those facts.

### 2.2 Fresh dual-repository freeze

Fresh fetches were performed during this planning task. The fork main references are the selected
authority because they match the operator-provided commits. The upstream main references are
recorded as drift context and are not silently substituted.

| Repository | Planning root | Selected remote | Selected commit | Selected tree | Upstream observation | State |
|---|---|---|---|---|---|---|
| CC Gateway | `/Users/muqihang/.codex/worktrees/62f3/cc-gateway` | `https://github.com/muqihang/cc-gateway.git` (`muqihang/main`) | `513945e2a5dfda58e5164456ad7bd826d4f7087b` | `5d834a31e2b98b8d5fb741f70d4d6f4c17dca968` | `origin/main=447fad19b2b98602058951cad53895ed56e5ea84`, tree `466ccd6657ae95ca3d3bba3dab6ac8d41e15659a` | tracked clean; branch `codex/claude-code-2.1.215-phase3b-evidence-sufficiency-plan-v2` |
| Sub2API | `/Users/muqihang/.codex/worktrees/e7ac/sub2api-phase3b-non-resume-planning` | `https://github.com/muqihang/sub2api.git` (`muqihang/main`) | `fb840673afc0ff590fef9bb147fce5b9b70eb098` | `eeb8654eddf7a4c38364202f5024161e65d2a6d1` | `origin/main=37ed639d1e696daf1e3266aae3c172e837a53842`, tree `b91974d8e858cc4e6720c7c5dc32f6ff8da3031d` | tracked clean; detached read-only planning root |

The archival branch and worktree
`codex/claude-code-2.1.215-phase3b-normalized-safe-evidence-sufficiency-plan` at
`/Users/muqihang/.codex/worktrees/5066/cc-gateway` are not inputs and must not be written, deleted,
or used as an implementation base.

Future work must fetch both remotes again. A changed fork main, target artifact, schema bundle, or
toolchain does not automatically fail forever, but it requires a new freeze, new CodeGraph output,
and a reviewed rebinding before any implementation or execution.

### 2.3 Toolchain and lock inputs

| Repository | Toolchain | Bound files and SHA-256 |
|---|---|---|
| CC Gateway | Node `v24.7.0`; npm `11.5.1`; CodeGraph `1.1.6` | `package.json` `b13504dd2ba01b995f6c23c161f4766193eba9af29d9fc7fe2d816d07d7f0cc4`; `package-lock.json` `7f9a7df3a55c0a9be91cefda8493e2894cb3f11cec830a06b3bd73c2edd6c966`; `tsconfig.json` `dc694512e2b793c049c0f658322b23b8ba7e7a8db86061f8cd4c7609012af698` |
| Sub2API | `go version go1.26.5 darwin/arm64`; `GOTOOLCHAIN=auto`; CodeGraph `1.1.6` | `backend/go.mod` `5f2ece02ec92a42e30edd5d877c9935d4138d6091981324307efc1d75a81d995`; `backend/go.sum` `443151675298a99dcd94e44e42edf4048547a0acf91c3b659751bc6e120f927f` |

### 2.4 CodeGraph and protected exclusion

Both planning roots were freshly indexed with this exact local-only configuration:

```json
{"exclude":["backend/internal/service/openai_compact_sse_keepalive_test.go"]}
```

The configuration SHA-256 is
`f885ea40698ff4de9881ce6a9537388ce80c04be9515bf2c77ac186d39140e98`.

| Repository | Files | Nodes | Edges | Pending | Protected count |
|---|---:|---:|---:|---:|---:|
| CC Gateway | 264 | 9,362 | 33,245 | 0 | 0 |
| Sub2API | 3,064 | 98,766 | 331,888 | 0 | 0 |

The protected-count query is:

```sql
SELECT COUNT(*) FROM files
WHERE path = 'backend/internal/service/openai_compact_sse_keepalive_test.go';
```

The result must remain zero before and after every future graph refresh. The protected keepalive
file must not be read, searched, indexed, compiled, or tested. Package-wide Go tests and any test
of `./internal/service` are prohibited for this supplement because either could compile it.

### 2.5 CodeGraph reconnaissance bindings

Markdown plans and evidence handoffs are not CodeGraph languages in this index, so they were read
directly only at their exact paths and checked by digest. Code entry points were resolved through
CodeGraph before source inspection.

| Concern | Current symbol and path | Future disposition |
|---|---|---|
| Strict JSON/JCS | `canonicalizeJsonValue`, `normalizePathQuery`, `formatAuthority` in `src/oracle-contract/canonical.ts` | Reuse semantics; add evidence-specific schemas and mutations |
| Admission | `decideBehaviorAdmission` in `src/oracle-contract/admission.ts` | Reuse fail-closed pattern; do not promote local evidence to runtime |
| Authority/rollback | `authorityObjectDigest` and trust/rollback types in `src/oracle-contract/manifest-authority.ts` | Bind predecessor and generation semantics; no authority reuse |
| Cross-repo mirror | `checkSharedContract` and `checkCrossRepoContract` in `tools/oracle-contract/` | Reuse static mirror checks only; replace unsafe service-package test runner |
| Phase 3A sandbox runner | `runCell`, `runCellGuardSelfTest`, `buildCellSandboxProfile` in `tools/oracle-lab/phase3a/run-cell.ts` | Wrap without weakening its exact-profile zero-egress guard |
| Loopback receiver | `startFakeUpstream`, `SafeUpstreamEvent` in `tools/oracle-lab/phase3a/observers/fake-upstream.ts` | Extend in a new namespace; current observer loses raw header order and lacks full typed AST closure |
| Paired perturbation | `runProbeCopyCapability` in `tools/oracle-lab/phase3a/instrumentation-capability.ts` | Independently revalidate `probe-copy`; never inherit its old PASS as new evidence |
| Existing usability gate | `usable` in `tools/oracle-lab/phase3a/build-exit.ts` | Preserve Reproduced, dual-source, static-anchor, control, expiry, and contradiction gates |
| Go JCS | `CanonicalizeOracleJSON` in `backend/internal/service/oracle_contract_canonical.go` | Reference behavior only; new implementation belongs in `internal/oracleevidence` |
| Go admission/authority/cross-project | `oracle_contract_admission.go`, `oracle_contract_authority.go`, `oracle_contract_cross_project.go` | Reference stable codes; do not run or extend `internal/service` tests |
| Current Anthropic ingress | `ValidateAnthropicOnlyCompatIngressWithOptions`, `NormalizeAnthropicCompatMessagesBody` | Product path is out of scope and must not be modified |

## 3. Predecessor Evidence and Truthful Renewal

### 3.1 Exact predecessor safe inputs

The historical root is
`/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A`.
Only these normalized-safe behavior projections may be used as predecessor comparison inputs:

| Binding | Relative path | SHA-256 | Schema | Conclusion | Expiry |
|---|---|---|---|---|---|
| config precedence | `capsules/P3A-2/closure-r2-config-precedence-v2/summary.json` | `a41dbc159b6b17ad6a6a2c52afa9bb3a74055ac8ca0b74a60d112ff044c32b69` | `oracle-lab-phase3a-config-precedence-campaign.v1` | `CL-P3A-R2-CONFIG-AUTH` | `2026-08-03T00:00:00.000Z` |
| auth lifecycle | `capsules/P3A-2/closure-r2-auth-lifecycle-v1/summary.json` | `3c78e19294106d9ad6e72e9ef273f1432b593e47a2f503f93e1d02482ef9e7b3` | `oracle-lab-phase3a-auth-lifecycle-campaign.v1` | `CL-P3A-R2-CONFIG-AUTH` | `2026-08-03T00:00:00.000Z` |
| auth coexistence | `capsules/P3A-2/closure-r2-auth-coexistence-v2/summary.json` | `103f4d7455aabe0954a378ac267479c6d80df0119d306d9877cf44e6417df39e` | `oracle-lab-phase3a-auth-lifecycle-campaign.v1` | `CL-P3A-R2-CONFIG-AUTH` | `2026-08-03T00:00:00.000Z` |
| failure/stream | `capsules/P3A-2/closure-r2-scenario-closure-v2.json` | `0b2d86d8c84fcfeec9c071bcbb739a8bda70cf77fc97324ad36da26092e8c6d0` | `oracle-lab-phase3a-scenario-closure.v1` | `CL-P3A-R2-FAILURE-STREAM` | `2026-08-03T00:00:00.000Z` |
| coverage only | `capsules/P3A-2/closure-r2-coverage-v8.json` | `9496dce47210fb66304431e776c4ff0c49afb1c138066753362a7ff3d9a7b15b` | `oracle-lab-phase3a-r2-closure.v2` | both predecessor IDs | `2026-08-03T00:00:00.000Z` |

The closure bindings remain:

- exit report `capsules/P3A-4/phase-3a-exit-report-v13.json`, SHA-256
  `57f16b207933b3a751f96471733d435fa4b0c9801fbef2f5495e8884dfe0bd1b`;
- handoff `capsules/P3A-4/phase-3b-3.5-handoff-v13.json`, SHA-256
  `9d188072719dc27a2f9cc9939bc79afa598802b84dd4d9161fb1da3263a792d7`;
- terminal manifest `capsules/P3A-4/closure-terminal-manifest-v8.json`, SHA-256
  `c9ee57fbe29125c88278961565f814326b052077b861bb41008cdde6161f12f5`;
- artifact index `capsules/P3A-4/artifact-index-v23.json`, SHA-256
  `e8645c7ed4bc984a926f91e3df1b756c4b009b3a02408de213cbe81b060e80d4`;
- leak scan `capsules/P3A-4/leak-scan-v23.json`, SHA-256
  `7ed3e2776c7fcc47d6c8d513318b33547919c92a33a068a4f0c0cb3706bad145`.

Raw transcripts, raw request/response material, unlisted files, directory walking, symlinks, and
P3A-S execution namespaces are forbidden inputs.

The structural Phase 2 input is
`docs/superpowers/2026-07-19-claude-code-2.1.215-phase-2-handoff.md`, SHA-256
`a5454d630dc470cda54adaaed6a4eab5ebd2b8c53909ae5487e4a59b29cee4d9`. It binds the
`oracle.compatibility.v1` bundle SHA-256
`2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce`, predecessor SHA-256
`70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1`, schema range `1:0-0`,
and the historical cross-repository gate of 65 fixtures and seven executable commands. This is a
C-class contract input only. It cannot close an E row, authorize execution, or replace fresh
cross-repository validation.

### 3.2 Independent revalidation and successor conclusions

The future campaign creates exactly these new conclusion IDs:

| Successor conclusion | Required independent result | Predecessor relation |
|---|---|---|
| `CL-P3B-ES1-CONFIG-AUTH-REVALIDATED` | Fresh config pairs `config-precedence-user-vs-default`, `config-precedence-project-vs-user`, `config-precedence-local-vs-project`, `config-precedence-process-env-vs-local` and auth pairs `auth-api-key-rotation`, `auth-token-rotation`, `auth-credential-coexistence`, `auth-missing-credential` all Reproduced in both instrumentation modes | May cite `CL-P3A-R2-CONFIG-AUTH` only as predecessor; no field is inherited |
| `CL-P3B-ES1-NEW-SESSION-WIRE` | Complete new-session request identity, method, authority/provenance, path/query, safe headers/auth class, encoding, typed AST, and executable request fixture | No predecessor supplies the missing request fields; this conclusion does not own response acceptance |
| `CL-P3B-ES1-FAILURE-RECOVERY` | Fresh response status/header/SSE/terminal/stop/usage acceptance plus failure, retry, ownership, attempt, timing-class, transport, partial, complete, recovery cells, and executable response fixture all Reproduced | May cite `CL-P3A-R2-FAILURE-STREAM` only as predecessor; no field is inherited |

Each successor conclusion requires a new immutable clock-attestation input captured after the last
authorizing cell completes. The conclusion copies `issued_at_ms` from that attestation and computes
`expires_at_ms = issued_at_ms + 1,209,600,000` (14 days). Regeneration copies the attested values;
it never calls the wall clock. A clock attestation created before the last authorizing cell, an
expiry not exactly 14 days later, or a predecessor timestamp reused as the new issue time is a hard
failure.

Independent means all of the following:

1. New cells use a new evidence root, authority record, campaign ID, manifests, receiver process,
   run IDs, artifact index, leak scan, exit, handoff, terminal manifest, and external digest set.
2. The old safe projections are unavailable to the campaign classifier until new observations have
   been normalized and frozen.
3. A separate contradiction pass then compares every overlapping old/new normalized leaf.
4. Any disagreement produces a stable contradiction ID in both the predecessor comparison record
   and the successor conclusion. Open contradictions force `level=Unknown` and
   `phase3b_usable=false`.
5. Exact agreement does not renew the old conclusion. It permits a new conclusion only when the new
   campaign independently satisfies all observation, pair, repetition, closure, and leak gates.

The failure/stream overlap set is exact and mandatory: `http_400_terminal`, `http_401_terminal`,
`http_403_terminal`, `http_429_terminal`, `http_500_terminal`, `http_529_terminal`,
`reset_terminal`, `partial_sse_then_eof`, and `complete_sse`. The contradiction pass must account
for all nine predecessor scenario families before `CL-P3B-ES1-FAILURE-RECOVERY` may be issued.
Missing, duplicated, renamed, or silently dropped overlap is `predecessor_overlap_incomplete`, not
agreement.

## 4. Future Namespace, Files, and Ownership

No file in this section is created by this planning PR. A later, separately authorized supplement
implementation may create only the following ownership surfaces.

```text
CC Gateway: authoritative schemas, TS harness, and normalized-safe closure
  contracts/oracle-lab/evidence-sufficiency/v1/
    operator-authority.schema.json
    freeze.schema.json
    campaign-input.schema.json
    static-anchor.schema.json
    scenario-program.schema.json
    synthetic-literals.schema.json
    clock-attestation.schema.json
    receiver-observation.schema.json
    request-ast.schema.json
    response-ast.schema.json
    cell-record.schema.json
    contradiction.schema.json
    field-provenance.schema.json
    observation-closure.schema.json
    candidate-field-closure.schema.json
    coverage.schema.json
    conclusion.schema.json
    typed-fixture.schema.json
    cross-repo-result.schema.json
    artifact-index.schema.json
    leak-report.schema.json
    exit-report.schema.json
    handoff.schema.json
    terminal-manifest.schema.json
    external-digest-set.schema.json
    mutation-corpus.json
    expected-results.json
  tools/oracle-lab/phase3b-evidence-sufficiency/
    core.ts
    schemas.ts
    static-anchor.ts
    wire-receiver.ts
    normalize-request.ts
    normalize-response.ts
    campaign.ts
    revalidate-predecessors.ts
    contradictions.ts
    coverage.ts
    closeout.ts
    check-cross-repo.ts
  tests/oracle-phase3b-evidence-*.test.ts

Sub2API: independent Go schema/canonicalization validator and byte-identical testdata mirror
  backend/internal/oracleevidence/
    canonical.go
    schema.go
    validator.go
    canonical_test.go
    validator_test.go
    testdata/v1/  # byte-identical mirror of the CC contract corpus
```

Evidence outputs are local append-only artifacts under one future root. Their fixed relative
namespace is `capsules/P3B-ES1/`. They are not committed to either product repository. Live CC
Gateway source, `src/index.ts`, `src/proxy.ts`, sidecar code, Sub2API handlers/services, deployment
configuration, the protected keepalive test, and Phase 4 remain untouched.

The fixed artifact paths are:

```text
capsules/P3B-ES1/control/operator-authority.json
capsules/P3B-ES1/control/freeze.json
capsules/P3B-ES1/control/campaign-input.json
capsules/P3B-ES1/control/static-anchor.json
capsules/P3B-ES1/control/scenario-programs.json
capsules/P3B-ES1/control/synthetic-literals.json
capsules/P3B-ES1/control/clock-attestation.json
capsules/P3B-ES1/closure/observation-closure.json
capsules/P3B-ES1/closure/contradictions.json
capsules/P3B-ES1/closure/candidate-field-closure.json
capsules/P3B-ES1/conclusions/config-auth-revalidated.json
capsules/P3B-ES1/conclusions/new-session-wire.json
capsules/P3B-ES1/conclusions/failure-recovery.json
capsules/P3B-ES1/fixtures/request-new-session-streaming.json
capsules/P3B-ES1/fixtures/response-new-session-streaming.json
capsules/P3B-ES1/validation/cross-repo-result.json
capsules/P3B-ES1/closure/field-provenance.json
capsules/P3B-ES1/closure/coverage.json
capsules/P3B-ES1/closure/artifact-index.json
capsules/P3B-ES1/closure/leak-report.json
capsules/P3B-ES1/closure/exit-report.json
capsules/P3B-ES1/closure/handoff.json
capsules/P3B-ES1/closure/terminal-manifest.json
capsules/P3B-ES1/closure/external-digest-set.json
```

Every auxiliary artifact has its named strict schema. `synthetic-literals.json` is the only literal
table, `clock-attestation.json` is the only conclusion-time input, and
`cross-repo-result.json` is the only Go/TS agreement record. The artifact index includes every
control, observation, fixture, conclusion, provenance, coverage, clock, contradiction, and
cross-repository artifact, then excludes only the six closure files named in Section 10.

## 5. Evidence Levels, Source Kinds, and Admission

The future schemas use `Reproduced`, `Observed-local`, `Unknown`, and `Negative`. Only Reproduced
leaves from all three successor conclusions may enable a candidate. Static anchors and controlled
scenario bytes are contract facts, not behavior evidence. Observed-local fields may diagnose a gap
but cannot satisfy an E row.

The exhaustive `source_kind` union is:

- `operator_policy`;
- `frozen_repository`;
- `p2_contract`;
- `predecessor_safe_projection`;
- `static_anchor`;
- `scenario_control`;
- `receiver_observation`;
- `paired_cell_result`;
- `successor_conclusion`;
- `derived_structural`;
- `disabled_policy`.

Every distributable candidate leaf has exactly one provenance row containing:

```text
pointer, class, evidence_level, source_kind, source_relative_path, source_sha256,
source_schema_id, source_scope, source_conclusion_id, source_expires_at_ms, transform
```

Duplicate pointers, uncovered pointers, unknown source kinds, absolute source paths, unbound
digests, wrong schemas, mixed scopes, missing expiry on E leaves, or transforms outside the closed
schema are hard failures. Provenance cannot promote C or D leaves into behavior evidence.

`field-provenance.json` is created only after every referenced source exists and stores the actual
64-hex SHA-256 at `sources[source_relative_path].sha256`. Coverage rows use the normative binding
expression `field_provenance.sources[source_relative_path].sha256`; a validator resolves it to the
actual digest and rejects unresolved expressions. Field provenance does not describe its own
artifact leaves, the artifact index does not index itself or any later closure file, and the
external digest set does not contain its own digest. Those exclusions are structural and prevent
hash cycles.

## 6. Normative Coverage Matrix

This matrix is normative and precedes the execution DAG. It is exhaustive for the future
distributable evidence candidate. Schemas may split a listed leaf group into more objects, but may
not introduce an enabled leaf outside this matrix. All E rows remain disabled now and remain
disabled in the future until the referenced successor conclusion is Reproduced and the exact
source SHA is resolved in final field provenance and the resulting payload is bound by the artifact
index and terminal closure chain.

Legend:

- `E`: behavior evidence required for the executable candidate;
- `C`: contract, policy, scenario-control, or deterministic structural field;
- `D`: fail-closed disabled and forbidden from enabled payloads.

`field_provenance.sources[source_relative_path].sha256` means the exact 64-hex digest recorded for
that exact source after it exists. It is a normative lookup expression, not a digest placeholder;
an unresolved lookup disables the row. The later artifact index binds the finalized provenance and
coverage artifacts, and the external digest set binds the five preceding closure records without
feeding a digest backward into conclusions.

```json coverage-source-bindings
[
  {"id":"cov.control.envelope","leaves":["/schema_id","/schema_major","/schema_revision","/campaign_id","/capability_mode","/source_bindings"],"class":"C","source_kind":"operator_policy","source_relative_path":"docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-normalized-safe-evidence-sufficiency-supplement.md","source_sha256_binding":"plan_sha256","source_schema":"plan.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"none","expiry_binding":"not_applicable","transform":"exact_policy_copy_v1","missing_action":"reject_bundle"},
  {"id":"cov.identity.target","leaves":["/identity/package","/identity/version","/identity/archive_sha256","/identity/tree_sha256","/identity/entrypoint_sha256","/identity/platform","/identity/architecture"],"class":"E","source_kind":"successor_conclusion","source_relative_path":"capsules/P3B-ES1/conclusions/new-session-wire.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-new-session-wire.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"CL-P3B-ES1-NEW-SESSION-WIRE","expiry_binding":"source.expires_at_ms","transform":"exact_identity_copy_v1","missing_action":"disable_candidate"},
  {"id":"cov.request.base_url","leaves":["/request/base_url/selection_source","/request/base_url/source_precedence","/request/base_url/authority_class","/request/base_url/provenance","/request/base_url/join_rule"],"class":"E","source_kind":"successor_conclusion","source_relative_path":"capsules/P3B-ES1/conclusions/config-auth-revalidated.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-config-auth.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"CL-P3B-ES1-CONFIG-AUTH-REVALIDATED","expiry_binding":"source.expires_at_ms","transform":"exact_base_url_authority_v1","missing_action":"disable_candidate"},
  {"id":"cov.request.target","leaves":["/request/method","/request/target/path","/request/target/query_order","/request/target/query_items"],"class":"E","source_kind":"successor_conclusion","source_relative_path":"capsules/P3B-ES1/conclusions/new-session-wire.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-new-session-wire.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"CL-P3B-ES1-NEW-SESSION-WIRE","expiry_binding":"source.expires_at_ms","transform":"exact_wire_target_v1","missing_action":"disable_candidate"},
  {"id":"cov.request.headers","leaves":["/request/headers/ordered_names","/request/headers/presence","/request/headers/multiplicity","/request/headers/safe_value_classes"],"class":"E","source_kind":"successor_conclusion","source_relative_path":"capsules/P3B-ES1/conclusions/new-session-wire.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-new-session-wire.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"CL-P3B-ES1-NEW-SESSION-WIRE","expiry_binding":"source.expires_at_ms","transform":"normalize_raw_header_order_v1","missing_action":"disable_candidate"},
  {"id":"cov.request.header_values","leaves":["/request/headers/real_authorization_value","/request/headers/real_cookie_value","/request/headers/unclassified_value"],"class":"D","source_kind":"disabled_policy","source_relative_path":"docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-non-resume-amendment.md","source_sha256_binding":"51a6f19addd87f1591ae15a1f8f14951bf732954b58fcc722a97fee246c0d4f7","source_schema":"plan.v1","scope":"all","conclusion_id":"none","expiry_binding":"not_applicable","transform":"disable_and_reject_v1","missing_action":"forbid_enabled_leaf"},
  {"id":"cov.request.auth_winner","leaves":["/request/auth/pair_ids","/request/auth/api_key_rotation_class","/request/auth/token_rotation_class","/request/auth/credential_class","/request/auth/winner_class","/request/auth/header_name","/request/auth/coexistence_order","/request/auth/missing_credential_outcome"],"class":"E","source_kind":"successor_conclusion","source_relative_path":"capsules/P3B-ES1/conclusions/config-auth-revalidated.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-config-auth.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"CL-P3B-ES1-CONFIG-AUTH-REVALIDATED","expiry_binding":"source.expires_at_ms","transform":"classify_synthetic_auth_marker_v1","missing_action":"disable_candidate"},
  {"id":"cov.request.encoding","leaves":["/request/encoding/content_type_class","/request/encoding/charset_class","/request/encoding/content_encoding_class","/request/encoding/transfer_encoding_class","/request/encoding/body_byte_length","/request/encoding/canonical_body_sha256"],"class":"E","source_kind":"successor_conclusion","source_relative_path":"capsules/P3B-ES1/conclusions/new-session-wire.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-new-session-wire.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"CL-P3B-ES1-NEW-SESSION-WIRE","expiry_binding":"source.expires_at_ms","transform":"normalize_body_encoding_v1","missing_action":"disable_candidate"},
  {"id":"cov.request.ast_top","leaves":["/request/body_ast/top_level_order","/request/body_ast/present_fields","/request/body_ast/omitted_fields","/request/body_ast/model","/request/body_ast/max_tokens"],"class":"E","source_kind":"successor_conclusion","source_relative_path":"capsules/P3B-ES1/conclusions/new-session-wire.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-new-session-wire.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"CL-P3B-ES1-NEW-SESSION-WIRE","expiry_binding":"source.expires_at_ms","transform":"typed_request_ast_v1","missing_action":"disable_candidate"},
  {"id":"cov.request.messages","leaves":["/request/body_ast/messages/order","/request/body_ast/messages/roles","/request/body_ast/messages/content_block_order","/request/body_ast/messages/content_block_types","/request/body_ast/messages/synthetic_literal_refs"],"class":"E","source_kind":"successor_conclusion","source_relative_path":"capsules/P3B-ES1/conclusions/new-session-wire.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-new-session-wire.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"CL-P3B-ES1-NEW-SESSION-WIRE","expiry_binding":"source.expires_at_ms","transform":"typed_message_sequence_v1","missing_action":"disable_candidate"},
  {"id":"cov.request.system","leaves":["/request/body_ast/system/presence","/request/body_ast/system/form","/request/body_ast/system/block_order","/request/body_ast/system/block_types","/request/body_ast/system/omission_rule","/request/body_ast/system/synthetic_literal_refs"],"class":"E","source_kind":"successor_conclusion","source_relative_path":"capsules/P3B-ES1/conclusions/new-session-wire.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-new-session-wire.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"CL-P3B-ES1-NEW-SESSION-WIRE","expiry_binding":"source.expires_at_ms","transform":"typed_system_sequence_v1","missing_action":"disable_candidate"},
  {"id":"cov.request.tools","leaves":["/request/body_ast/tools/presence","/request/body_ast/tools/order","/request/body_ast/tools/name_refs","/request/body_ast/tools/description_refs","/request/body_ast/tools/input_schema","/request/body_ast/tools/omission_rule","/request/body_ast/tool_choice"],"class":"E","source_kind":"successor_conclusion","source_relative_path":"capsules/P3B-ES1/conclusions/new-session-wire.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-new-session-wire.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"CL-P3B-ES1-NEW-SESSION-WIRE","expiry_binding":"source.expires_at_ms","transform":"typed_tool_schema_sequence_v1","missing_action":"disable_candidate"},
  {"id":"cov.request.stream","leaves":["/request/body_ast/stream/presence","/request/body_ast/stream/value","/request/body_ast/stream/serialization_order"],"class":"E","source_kind":"successor_conclusion","source_relative_path":"capsules/P3B-ES1/conclusions/new-session-wire.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-new-session-wire.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"CL-P3B-ES1-NEW-SESSION-WIRE","expiry_binding":"source.expires_at_ms","transform":"exact_stream_serialization_v1","missing_action":"disable_candidate"},
  {"id":"cov.fixture.request","leaves":["/fixtures/request/relative_path","/fixtures/request/sha256","/fixtures/request/literal_table_relative_path","/fixtures/request/literal_table_sha256","/fixtures/request/materialization_recipe","/fixtures/request/typed_ast_digest","/fixtures/request/materialized_bytes_sha256","/fixtures/request/receiver_match"],"class":"E","source_kind":"successor_conclusion","source_relative_path":"capsules/P3B-ES1/conclusions/new-session-wire.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-new-session-wire.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"CL-P3B-ES1-NEW-SESSION-WIRE","expiry_binding":"source.expires_at_ms","transform":"bind_materialized_typed_request_v1","missing_action":"disable_candidate"},
  {"id":"cov.response.control","leaves":["/response/injected/status","/response/injected/header_classes","/response/injected/header_order","/response/injected/sse_wire_grammar","/response/injected/event_sequence"],"class":"C","source_kind":"scenario_control","source_relative_path":"capsules/P3B-ES1/control/scenario-programs.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-scenario-program.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"none","expiry_binding":"not_applicable","transform":"exact_scenario_program_v1","missing_action":"reject_bundle"},
  {"id":"cov.response.acceptance","leaves":["/response/observed/status_class","/response/observed/header_class_acceptance","/response/observed/sse_grammar_acceptance","/response/observed/event_order_acceptance"],"class":"E","source_kind":"successor_conclusion","source_relative_path":"capsules/P3B-ES1/conclusions/failure-recovery.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-failure-recovery.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"CL-P3B-ES1-FAILURE-RECOVERY","expiry_binding":"source.expires_at_ms","transform":"normalize_sse_acceptance_v1","missing_action":"disable_candidate"},
  {"id":"cov.response.terminal","leaves":["/response/terminal/event","/response/terminal/stop_reason","/response/terminal/stop_sequence_class","/response/terminal/usage_presence","/response/terminal/usage_field_order","/response/terminal/usage_values","/response/terminal/safe_output_class","/response/terminal/safe_output_sha256","/response/terminal/terminal_state","/response/terminal/client_exit_class"],"class":"E","source_kind":"successor_conclusion","source_relative_path":"capsules/P3B-ES1/conclusions/failure-recovery.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-failure-recovery.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"CL-P3B-ES1-FAILURE-RECOVERY","expiry_binding":"source.expires_at_ms","transform":"typed_terminal_projection_v1","missing_action":"disable_candidate"},
  {"id":"cov.failure.recovery","leaves":["/failure/scenario_id","/failure/attempt_order","/failure/attempt_count","/failure/retry_owner","/failure/timing_schedule","/failure/timing_bucket","/failure/transport_terminal","/failure/partial_stream_rule","/failure/recovery_outcome"],"class":"E","source_kind":"successor_conclusion","source_relative_path":"capsules/P3B-ES1/conclusions/failure-recovery.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-failure-recovery.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"CL-P3B-ES1-FAILURE-RECOVERY","expiry_binding":"source.expires_at_ms","transform":"classify_attempt_owner_and_transport_v1","missing_action":"disable_candidate"},
  {"id":"cov.config.precedence","leaves":["/config/pair_ids","/config/precedence_edges","/config/ordered_sources","/config/base_url_winner_source"],"class":"E","source_kind":"successor_conclusion","source_relative_path":"capsules/P3B-ES1/conclusions/config-auth-revalidated.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-config-auth.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"CL-P3B-ES1-CONFIG-AUTH-REVALIDATED","expiry_binding":"source.expires_at_ms","transform":"derive_precedence_dag_v1","missing_action":"disable_candidate"},
  {"id":"cov.auth.real_values","leaves":["/request/auth/credential_value","/request/auth/token_value","/request/auth/account_identity","/request/auth/persistence_material"],"class":"D","source_kind":"disabled_policy","source_relative_path":"docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-non-resume-amendment.md","source_sha256_binding":"51a6f19addd87f1591ae15a1f8f14951bf732954b58fcc722a97fee246c0d4f7","source_schema":"plan.v1","scope":"all","conclusion_id":"none","expiry_binding":"not_applicable","transform":"disable_and_reject_v1","missing_action":"forbid_enabled_leaf"},
  {"id":"cov.fixture.response","leaves":["/fixtures/response/relative_path","/fixtures/response/sha256","/fixtures/response/literal_table_relative_path","/fixtures/response/literal_table_sha256","/fixtures/response/materialization_recipe","/fixtures/response/typed_ast_digest","/fixtures/response/materialized_bytes_sha256","/fixtures/response/accepted_terminal_match"],"class":"E","source_kind":"successor_conclusion","source_relative_path":"capsules/P3B-ES1/conclusions/failure-recovery.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-failure-recovery.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"CL-P3B-ES1-FAILURE-RECOVERY","expiry_binding":"source.expires_at_ms","transform":"bind_materialized_typed_response_v1","missing_action":"disable_candidate"},
  {"id":"cov.conclusion.config_auth","leaves":["/conclusions/config_auth/level","/conclusions/config_auth/phase3b_usable","/conclusions/config_auth/issued_at_ms","/conclusions/config_auth/expires_at_ms","/conclusions/config_auth/contradiction_ids","/conclusions/config_auth/predecessor_digests","/conclusions/config_auth/field_closure_digest"],"class":"E","source_kind":"successor_conclusion","source_relative_path":"capsules/P3B-ES1/conclusions/config-auth-revalidated.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-config-auth.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"CL-P3B-ES1-CONFIG-AUTH-REVALIDATED","expiry_binding":"source.expires_at_ms","transform":"exact_successor_conclusion_v1","missing_action":"disable_candidate"},
  {"id":"cov.conclusion.new_session_wire","leaves":["/conclusions/new_session_wire/level","/conclusions/new_session_wire/phase3b_usable","/conclusions/new_session_wire/issued_at_ms","/conclusions/new_session_wire/expires_at_ms","/conclusions/new_session_wire/contradiction_ids","/conclusions/new_session_wire/predecessor_digests","/conclusions/new_session_wire/field_closure_digest"],"class":"E","source_kind":"successor_conclusion","source_relative_path":"capsules/P3B-ES1/conclusions/new-session-wire.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-new-session-wire.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"CL-P3B-ES1-NEW-SESSION-WIRE","expiry_binding":"source.expires_at_ms","transform":"exact_successor_conclusion_v1","missing_action":"disable_candidate"},
  {"id":"cov.conclusion.failure_recovery","leaves":["/conclusions/failure_recovery/level","/conclusions/failure_recovery/phase3b_usable","/conclusions/failure_recovery/issued_at_ms","/conclusions/failure_recovery/expires_at_ms","/conclusions/failure_recovery/contradiction_ids","/conclusions/failure_recovery/predecessor_digests","/conclusions/failure_recovery/field_closure_digest"],"class":"E","source_kind":"successor_conclusion","source_relative_path":"capsules/P3B-ES1/conclusions/failure-recovery.json","source_sha256_binding":"field_provenance.sources[source_relative_path].sha256","source_schema":"oracle-lab-p3b-es-failure-recovery.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"CL-P3B-ES1-FAILURE-RECOVERY","expiry_binding":"source.expires_at_ms","transform":"exact_successor_conclusion_v1","missing_action":"disable_candidate"},
  {"id":"cov.structural.provenance","leaves":["/coverage/required_row_ids","/coverage/required_pointer_set","/coverage/required_class_counts"],"class":"C","source_kind":"derived_structural","source_relative_path":"docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-normalized-safe-evidence-sufficiency-supplement.md","source_sha256_binding":"plan_sha256","source_schema":"plan.v1","scope":"claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume","conclusion_id":"none","expiry_binding":"not_applicable","transform":"compile_coverage_shape_v1","missing_action":"reject_bundle"},
  {"id":"cov.disabled.exact_records","leaves":["/negative_capabilities/records/capability_id","/negative_capabilities/records/reason","/negative_capabilities/records/source_relative_path","/negative_capabilities/records/source_sha256","/negative_capabilities/records/affected_pointers","/negative_capabilities/records/failure_action","/negative_capabilities/records/revalidation_requirement"],"class":"D","source_kind":"disabled_policy","source_relative_path":"docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-non-resume-amendment.md","source_sha256_binding":"51a6f19addd87f1591ae15a1f8f14951bf732954b58fcc722a97fee246c0d4f7","source_schema":"plan.v1","scope":"all","conclusion_id":"none","expiry_binding":"not_applicable","transform":"disable_and_reject_v1","missing_action":"forbid_enabled_leaf"}
]
```

The D-class registry is an exact import of the blocker amendment's Section 4.2 negative capability
IDs. All records remain active throughout the supplement. This campaign may add evidence for the
request/response subset, but it cannot retire or relabel a negative capability. Only a later
operator-authorized successor amendment may retire individually proven IDs.

```json closed-disabled-capabilities
[
  "compact-cache-lifecycle-untriggered",
  "positive-nonessential-traffic-untriggered",
  "resume-restart-lineage-untriggered",
  "provider-tls-equivalence-out-of-scope",
  "cross-platform-runtime-unavailable",
  "linux-runtime-equivalence-unknown",
  "windows-runtime-equivalence-unknown",
  "tier-a-2.1.214-long-run-unknown",
  "tier-a-2.1.214-restart-unknown",
  "tier-a-2.1.212-restart-unknown",
  "tier-a-2.1.211-base-url-background-restart-unknown",
  "option-a-resume-session-lineage-disabled",
  "option-a-task-lineage-disabled",
  "option-a-parent-child-lineage-disabled",
  "option-a-transcript-recovery-disabled",
  "build-timestamp-category-uncovered",
  "user-agent-uncovered",
  "x-stainless-values-uncovered",
  "installation-mode-uncovered",
  "runtime-metadata-uncovered",
  "detached-signature-unknown",
  "request-method-uncovered",
  "request-authority-uncovered",
  "request-path-uncovered",
  "request-query-uncovered",
  "request-headers-uncovered",
  "request-content-encoding-uncovered",
  "request-body-ast-uncovered",
  "request-final-bytes-uncovered",
  "request-system-prompt-uncovered",
  "request-tool-schema-uncovered",
  "response-headers-uncovered",
  "response-body-uncovered",
  "sse-event-grammar-uncovered",
  "usage-semantics-uncovered",
  "stop-reason-uncovered",
  "retry-owner-uncovered",
  "retry-count-uncovered",
  "retry-timing-uncovered",
  "recovery-mechanics-uncovered",
  "control-plane-route-uncovered",
  "control-plane-method-uncovered",
  "control-plane-trigger-uncovered",
  "control-plane-destination-uncovered",
  "transport-proxy-identity-uncovered",
  "transport-resolver-policy-uncovered",
  "transport-destination-set-uncovered",
  "transport-tls-http-uncovered",
  "transport-connection-state-uncovered",
  "auth-header-serialization-uncovered",
  "auth-coexistence-winner-uncovered",
  "credential-persistence-uncovered",
  "credential-refresh-uncovered",
  "credential-revocation-uncovered",
  "credential-restart-uncovered",
  "minimum-truthful-candidate-unavailable",
  "evidence-version-relabel-disabled",
  "real-upstream-disabled",
  "real-credentials-disabled",
  "profile-promotion-disabled",
  "staging-disabled",
  "production-disabled",
  "real-canary-disabled",
  "protected-sidecar-authority-disabled",
  "replay-disabled",
  "destination-enforcement-disabled",
  "direct-egress-fallback-disabled",
  "phase4-runtime-wiring-disabled",
  "dynamic-campaign-disabled"
]
```

The request and response fixture rows are not satisfied by merely observing hashes. The typed AST,
safe literal table, deterministic materializer, and receiver bytes must round-trip to the same
digest. If a client-generated string cannot be represented by an approved synthetic literal or a
lossless safe typed value, that fixture is not executable and the candidate remains disabled.

## 7. Normalized-Safe Schema Contract

### 7.1 Common encoding

All artifacts use strict I-JSON and RFC 8785 JCS. Validators reject duplicate keys, invalid UTF-8,
lone surrogates, negative zero, unsafe integers, non-integer numbers where integers are required,
trailing data, unknown fields, unknown enums, absolute paths, path traversal, symlinks, and
noncanonical set order. Semantic sequences retain observed order. Validators reject a reordered
sequence even when its members are otherwise equal.

No schema permits fields named or semantically equivalent to raw prompt, raw body, response body,
credential value, token, cookie, secret, account identifier, home path, or unnormalized transcript.
Raw request bytes may exist only in bounded receiver memory, are zeroed after projection, and are
never written. Raw stdout/stderr, hook logs, packets, and transcripts are never persisted.

### 7.2 Static anchor

`static-anchor.json` binds the complete target identity before any launch:

```text
package=@anthropic-ai/claude-code-darwin-arm64
version=2.1.215
platform=darwin
architecture=arm64
platform_archive_sha256=b5dd6a135c96957dae232218c4ae5b04328a788f8c509202c92a2fec550601b2
platform_tree_sha256=864f493d9fc237df6a858e1620c83279b8f6c15f205dbb47c058f3f537e924a6
entrypoint_sha256=90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58
```

It also binds the selected CC/Sub2API commits and trees, toolchain files, schema bundle digest,
invocation descriptor digest, and receiver executable digest. Static extraction may identify
candidate config names, URL-join sites, request builders, and response parsers, but those facts are
`Observed-local` and cannot close E rows without receiver reproduction.

### 7.3 Receiver observation

`receiver-observation.schema.json` requires:

```text
schema_id, schema_major, schema_revision, campaign_id, cell_id, pair_id, arm,
repetition, deterministic_seed, sequence_index, receiver_process_digest,
authority_class, base_url_provenance_ref,
method, path, ordered_query_items,
ordered_header_names, header_presence, header_multiplicity, safe_header_value_classes,
auth_marker_winner_class,
content_type_class, charset_class, content_encoding_class, transfer_encoding_class,
body_byte_length, canonical_body_sha256, typed_request_ast,
connection_ordinal, attempt_ordinal, scenario_action_ordinal,
response_program_ref, raw_material_persisted=false
```

The receiver uses `IncomingMessage.rawHeaders`, not the normalized header map, to preserve safe
name order and multiplicity. Names are lowercased only after the original ordinal is assigned.
Values are never stored except exact campaign-owned synthetic marker classes and closed safe
content/encoding enums. Authorization, cookie, and API-key values are reduced to marker class or
`present-redacted`; an unrecognized value is a leak failure, not a new class.

The receiver runs in a separate process and is the only source for wire-visible request fields.
Target-side instrumentation and controller manifests may corroborate identity and attempt mapping,
but cannot supply or override wire leaves. The target sandbox cannot write receiver artifacts.

### 7.4 Typed request AST and safe literal table

`request-ast.schema.json` defines closed variants for top-level fields, ordered messages, content
blocks, system blocks, tools, JSON Schema nodes, tool choice, and stream. It records field presence,
semantic array order, and omission explicitly. A missing member is not represented as null unless
null was actually observed and the schema variant permits it.

All string leaves are one of:

- a closed protocol enum;
- a bounded safe identifier matching the schema;
- a reference into campaign-owned `synthetic-literals.json`;
- a digest/length-only diagnostic field that cannot satisfy fixture materialization.

`synthetic-literals.json` is a reviewed C-class scenario input containing only fixed non-secret
prompts, model names, tool names, descriptions, and schema literals. The receiver maps a value to a
literal ID only on byte equality. An unmatched client-generated value may be summarized for
diagnostics, but it prevents exact materialization and therefore prevents `phase3b_usable=true`.

The request fixture materializer resolves literal IDs, emits the observed typed AST using the
observed encoding and ordering rules, and must reproduce the receiver's canonical body SHA-256 and
complete materialized request SHA-256.

### 7.5 Typed response AST and normalized SSE grammar

`response-ast.schema.json` separates controlled input from observed acceptance:

- injected HTTP status and ordered safe header classes;
- line-ending class, event-line presence, data-line count, blank-line framing, and UTF-8 class;
- ordered event variants and their typed data payloads;
- content-block indexes, delta types, terminal event, stop reason/sequence classes, and usage fields;
- target exit class and normalized safe diagnostic class.

Scenario payloads use only synthetic IDs and bounded safe integers. The response fixture
materializer must reproduce the exact controlled response bytes. The successor conclusion enables
only the response grammar whose complete sequence was accepted in all required paired repetitions.
Injected bytes alone are C-class and never prove client behavior.

Response acceptance additionally requires an independent target-output projection from the cell
result: `safe_output_class`, `safe_output_sha256`, and `terminal_state`. The expected safe output is
derived in memory from the campaign-owned synthetic literal table, and its SHA-256 is compared to
the target projection without storing raw stdout. Receiver delivery plus a zero exit code is not
acceptance by itself. The response conclusion requires receiver action/attempt order, parsed target
safe-output digest, terminal state, and exit class to agree with the same scenario tuple.

### 7.6 Failure, retry, recovery, and timing

The fake upstream uses this exact attempt-indexed scenario program set:

```json failure-programs
[
  "http_400_terminal",
  "http_401_terminal",
  "http_403_terminal",
  "http_429_terminal",
  "http_500_terminal",
  "http_529_terminal",
  "reset_terminal",
  "partial_sse_then_eof",
  "complete_sse",
  "http_429_then_complete",
  "http_500_then_complete",
  "reset_before_headers_then_complete",
  "delayed_headers_boundary"
]
```

The first nine programs are the complete predecessor renewal overlap. The last four add explicit
retry/recovery and timing-boundary closure. No status or transport family may stand in for another.

For each request it records connection, request, attempt, and action ordinals. The campaign launcher
performs exactly one target launch and no retry. Therefore repeated requests from that launch are
client-owned. Receiver negative controls use a synthetic client and an explicit launcher retry to
prove that `client`, `launcher`, and `none` are distinguishable before target evidence is admitted.

Timing evidence never records wall-clock timestamps. The scenario program contains deterministic
delay/deadline classes as C fields; the receiver records only order and a closed observed bucket
(`before_boundary`, `at_or_after_boundary`, `not_observed`). Raw monotonic duration is diagnostic
memory only and is excluded from canonical evidence identity.

Partial-stream retry or recovery after any accepted data event is a separate field from pre-header
retry. Attempt mixing, duplicate ordinals, skipped action ordinals, recovery attributed to the
wrong owner, or an outcome outside the scenario program is a contradiction.

## 8. Future Experimental Design

### 8.1 Mandatory preconditions

No future implementation or target launch starts until all of these exist:

1. this plan is independently reviewed and merged;
2. an operator issues a separate supplement implementation/execution decision with exact repository,
   artifact, evidence-root, resource-budget, and no-real-egress bindings;
3. both repository freezes, toolchains, target artifact, and CodeGraph exclusion are refreshed;
4. the protected count is zero in both roots;
5. schema and mutation RED tests fail for the intended missing behavior, then GREEN after the
   evidence tooling implementation;
6. receiver negative controls, guard self-tests, and the `probe-copy` perturbation capability are
   independently GREEN in the new namespace;
7. the external socket budget is exactly zero.

### 8.2 Observation boundary and paired modes

Every authorizing config, auth, wire, and failure cell has two outer instrumentation arms:

- `uninstrumented`: the frozen original entrypoint;
- `instrumented`: a separately created, digest-bound, ad-hoc-signed `probe-copy` whose recipe and
  pre/post-sign digests are frozen in the new static anchor.

For config/auth, each control/treatment pair therefore has four labels:
`control/instrumented`, `control/uninstrumented`, `treatment/instrumented`, and
`treatment/uninstrumented`. Wire/failure labels are `instrumented` and `uninstrumented`. The current
P3A perturbation result is not inherited. The new campaign must re-prove semantic equivalence. All
arms run through the same exact sandbox guard, fresh isolated HOME/XDG/TMP/CWD, same synthetic
literals, same receiver scenario, same seed, and same resource limits. Only the intended pair
variable and frozen entrypoint/probe binding differ.

The receiver is outside the target process and outside the probe. It emits append-only
normalized-safe observations through an exclusive-create writer. Probe or hook output is never a
source for request/response leaves. Any canonical observation difference between paired arms marks
the family `paired_perturbation` and prevents Reproduced status.

This receiver is not P3A-S Observer B, does not use `fs_usage`, does not observe session files, and
does not reopen the P3A-S coordination problem.

### 8.3 Deterministic schedule and repetitions

The fixed repetition seeds are:

```json
[215001,215002,215003,215004,215005]
```

Families and schedule IDs are processed in ascending unsigned UTF-8 byte order. A schedule ID is the
exact `pair_id` for paired cells and exact `family_id` otherwise. Arm labels use the exact sets above,
must be nonempty and unique, and are sorted by the same byte rule. Define `U32(x)` as unsigned 32-bit
big-endian encoding and `LP(x)` as `U32(byte_length(UTF8(x))) || UTF8(x)`. First encode the entire
seed vector exactly once as:

```text
LP("p3b-es1-seed-vector-v1") || U32(5) || U32(215001) || U32(215002) ||
U32(215003) || U32(215004) || U32(215005)
```

Its SHA-256 is the canonical full seed-vector digest. Reordering, duplicating, omitting, or changing
a seed changes or invalidates this binding. Derive one fixed base permutation per schedule by
encoding exactly:

```text
LP("p3b-es1-arm-order-v2") || LP(campaign_id) || LP(schedule_id) ||
U32(arm_count) || U32(label_count) || LP(sorted_label_0) || ... ||
LP(sorted_label_n_minus_1) || U32(32) || canonical_seed_vector_digest
```

Require `arm_count === label_count` and `arm_count` in `{2,4}`. Let
`digest=SHA-256(encoded)`, `offset=u32be(digest[0..3]) mod arm_count`, and
`direction=(digest[4] & 1) === 0 ? +1 : -1`. Freeze
`base[j] = sorted_labels[(offset + direction*j) mod arm_count]` once for the schedule. For zero-based
repetition index `r`, set `order_r[j] = base[(j+r) mod arm_count]`. The seed at index `r` is only the
stimulus seed and is never hashed separately to derive offset, direction, base, or `order_r`.

For a fixed arm at base index `k` and ordinal `j`, the first `n=arm_count` repetitions contain the
unique solution `r = (k-j) mod n`; therefore every arm occupies every ordinal exactly once. For
`R=5`, each arm/ordinal count is `floor(R/n)` or `ceil(R/n)`: for `n=2` it is 2 or 3, and for `n=4`
it is 1 or 2. Thus max-minus-min imbalance is at most one for both actual arm counts. The executable
static selfcheck enumerates every offset and direction for `n=2` and `n=4`, proves these counts,
re-derives each schedule twice, and rejects a repeat mismatch. Run IDs are SHA-256 identities over
length-prefixed domain, campaign ID, schedule ID, arm label, `U32(r)`, and the stimulus seed; the
checker requires all `R*n` IDs to be unique. No ambiguous concatenation, locale, or RNG state is
permitted. Runs remain serial; sequence indexes, fixture IDs, and artifact paths remain pure
functions of the frozen input tuple.

The future campaign has this exact target-launch ceiling:

| Family | Definitions | Arms | Repetitions | Maximum target launches |
|---|---:|---:|---:|---:|
| config precedence revalidation | 4 control/treatment pairs | 2 pair arms x 2 instrumentation arms | 5 | 80 |
| auth lifecycle/coexistence revalidation | 4 control/treatment pairs | 2 pair arms x 2 instrumentation arms | 5 | 80 |
| request shape and omission closure | 3 stimuli (`prompt_only`, `safe_tool_catalog`, `tool_disabled`) | 2 instrumentation arms | 5 | 30 |
| response/failure/recovery | 13 scenario programs | 2 instrumentation arms | 5 | 130 |
| mandatory target guard/perturbation controls | 2 controls | 2 instrumentation arms | 5 | 20 |
| **total ceiling** |  |  |  | **340** |

The safe tool stimuli may execute only if the static anchor and focused unit tests prove an exact
synthetic tool injection and disable mechanism. If either mechanism is unavailable, its row is not
replaced by a guessed CLI flag: the affected tool/system/omission leaves remain uncovered and the
candidate is disabled.

### 8.4 Saturation and stop rule

Five repetitions are fixed before execution. A family is Reproduced only when:

- all expected rows exist exactly once;
- every exact config/auth pair label and every wire/failure instrumentation label has five terminal,
  schema-valid observations;
- each arm is internally identical on authorizing normalized leaves;
- paired arms are identical on those leaves;
- the receiver and cell-result boundary agree on attempt and terminal ordering;
- all negative controls passed before the first target launch;
- no resource, leak, contradiction, or external-egress event occurred.

There is no sequential extension, convergence fishing, or replacement run. A mismatch, missing
row, nondeterminism, or safety failure makes that family Unknown and stops dependent families. The
campaign may still produce an honest terminal closeout, but no extra repetition can convert the
failed family to Reproduced under this authority.

### 8.5 Resource budget

```json resource-budget
{
  "target_launches_max":340,
  "target_launches_parallel":1,
  "campaign_wall_ms_max":36000000,
  "cell_wall_ms_max":90000,
  "cell_cpu_ms_max":60000,
  "cell_rss_bytes_max":1073741824,
  "cell_output_bytes_max":8388608,
  "cell_processes_max":16,
  "cell_sockets_max":8,
  "cell_retries_max":8,
  "cell_files_max":512,
  "receiver_body_bytes_max":8388608,
  "receiver_headers_max":256,
  "receiver_events_max":1024,
  "receiver_attempts_max":8,
  "external_socket_budget":0
}
```

Exceeding any ceiling produces a terminal failure; limits are never raised in-place.

## 9. Negative Controls and Mutation Corpus

Before any target launch, focused synthetic controls must prove:

- non-loopback connections are rejected;
- undeclared loopback ports are rejected by the exact sandbox profile;
- body, header, event, attempt, process, socket, file, output, CPU, RSS, and wall limits terminate;
- raw header order and multiplicity survive normalization;
- synthetic auth marker classes are distinguishable while values never persist;
- an unrecognized credential-like value causes `leak_detected`;
- raw prompt/body/response/credential keys are schema-invalid;
- receiver, controller, and probe paths cannot write each other's artifact namespaces;
- a synthetic client retry, launcher retry, and no-retry case classify distinct owners;
- request and response typed fixtures round-trip to exact materialized digests;
- the uninstrumented/instrumented comparator detects one mutated leaf;
- old expiry mutation, new issue-time reuse, open contradiction, and missing field closure all deny
  `phase3b_usable`.

The shared TS/Go mutation corpus includes at least:

```json static-mutations
[
  "duplicate_json_key",
  "invalid_utf8",
  "lone_surrogate",
  "negative_zero",
  "unsafe_integer",
  "trailing_data",
  "unknown_field",
  "wrong_schema_revision",
  "absolute_path",
  "path_traversal",
  "symlink_source",
  "header_order_swap",
  "header_multiplicity_change",
  "auth_winner_class_change",
  "request_field_omission_change",
  "message_order_swap",
  "system_block_order_swap",
  "tool_order_swap",
  "tool_schema_change",
  "stream_presence_change",
  "request_digest_mismatch",
  "sse_event_order_swap",
  "sse_missing_terminal",
  "sse_usage_order_change",
  "stop_reason_change",
  "attempt_duplicate",
  "attempt_gap",
  "retry_owner_change",
  "transport_terminal_change",
  "paired_instrumentation_difference",
  "arm_order_per_repetition_hashing",
  "arm_order_wrong_rotation",
  "arm_order_seed_reorder",
  "arm_order_seed_duplicate",
  "arm_order_seed_missing",
  "arm_order_label_duplicate",
  "arm_order_label_missing",
  "arm_order_ambiguous_encoding",
  "arm_order_count_mismatch",
  "arm_order_repeat_mismatch",
  "predecessor_expiry_edit",
  "successor_issue_time_reuse",
  "successor_expiry_not_14_days",
  "open_contradiction",
  "uncovered_e_leaf",
  "artifact_index_omission",
  "external_digest_set_mismatch",
  "leak_scan_finding"
]
```

Every mutation has one stable expected deny code in `expected-results.json`, and TS/Go must agree on
both decision and code.

## 10. Future Execution DAG

This DAG is a future design. No node is authorized by merging this plan. The edge relation is
`node -> deps`, and all dependencies must be complete before the node starts.

```json evidence-sufficiency-dag
{
  "nodes":[
    {"id":"ES0","name":"operator-authority-and-fresh-freeze","deps":[]},
    {"id":"ES1","name":"schemas-corpus-and-red-tests","deps":["ES0"]},
    {"id":"ES2","name":"static-anchor-receiver-and-green-controls","deps":["ES1"]},
    {"id":"ES3","name":"independent-config-auth-revalidation","deps":["ES2"]},
    {"id":"ES4","name":"new-session-wire-campaign","deps":["ES2"]},
    {"id":"ES5","name":"failure-retry-recovery-campaign","deps":["ES2"]},
    {"id":"ES6","name":"observation-closure-and-contradiction-pass","deps":["ES3","ES4","ES5"]},
    {"id":"ES7","name":"typed-fixtures-clock-and-successor-conclusions","deps":["ES6"]},
    {"id":"ES8","name":"independent-go-validator-and-cross-repo-agreement","deps":["ES7"]},
    {"id":"ES9","name":"final-field-provenance-and-coverage","deps":["ES8"]},
    {"id":"ES10","name":"artifact-index","deps":["ES9"]},
    {"id":"ES11","name":"leak-report","deps":["ES10"]},
    {"id":"ES12","name":"exit-report","deps":["ES10","ES11"]},
    {"id":"ES13","name":"handoff","deps":["ES10","ES11","ES12"]},
    {"id":"ES14","name":"terminal-manifest","deps":["ES10","ES11","ES12","ES13"]},
    {"id":"ES15","name":"external-digest-set","deps":["ES10","ES11","ES12","ES13","ES14"]},
    {"id":"ES16","name":"evidence-supplement-complete-gate","deps":["ES15"]},
    {"id":"ES17","name":"successor-amendment-startable-gate","deps":["ES16"]}
  ],
  "closure_order":["artifact-index","leak-report","exit-report","handoff","terminal-manifest","external-digest-set"],
  "artifact_index_includes":["operator-authority","freeze","campaign-input","static-anchor","scenario-programs","synthetic-literals","clock-attestation","receiver-observations","cell-records","observation-closure","contradictions","candidate-field-closure","successor-conclusions","typed-fixtures","cross-repo-result","field-provenance","coverage"],
  "artifact_index_excludes":["artifact-index","leak-report","exit-report","handoff","terminal-manifest","external-digest-set"]
}
```

The six closure records are emitted in the unique listed order after the immutable evidence payload.
The artifact index cannot contain its own digest or any of the five later closure records. The
external digest set is emitted last and binds exactly the preceding five closure path/SHA/schema
identities: artifact index, leak report, exit report, handoff, and terminal manifest. It never binds
itself. Its own SHA-256 is reported out of band in the independent review record, PR, and operator
decision. No conclusion, fixture, provenance row, coverage row, index entry, or earlier closure file
references the external set, so the graph has no hash cycle.

## 11. Exact Work Packages

### ES0: operator authority and fresh freeze

- **Owner:** supplement controller.
- **Files:** no repository changes; new local authority/freeze artifacts only.
- **Symbols:** existing bounded repository-state capture and CodeGraph status/protected query.
- **Actions:** require a new operator decision; reject inherited dangerous Git variables; fetch both
  remotes; bind exact fork/upstream commits/trees, tracked-clean state, target identity, toolchains,
  schema plan digest, evidence root, and resource budget; recreate the exact CodeGraph exclusion;
  prove protected count zero.
- **RED:** missing authority, wrong root, dirty tracked file, mismatched target digest, wrong plan
  digest, symlink, protected count nonzero, or external socket budget nonzero.
- **GREEN:** immutable `campaign-input.json`, `freeze.json`, and no target launch.
- **Commands:** static repository/CodeGraph checks only. No Claude Code command exists in ES0.

### ES1: schemas, corpus, and genuine RED

- **Owner:** CC Gateway contract owner.
- **Files:** every exact schema/corpus file listed in Section 4 under
  `contracts/oracle-lab/evidence-sufficiency/v1/`, TS schema loader,
  and focused `tests/oracle-phase3b-evidence-*.test.ts` files.
- **Symbols:** `parseStrictJson`, `canonicalizeJsonValue`, evidence-specific AJV validators, and
  mutation executor.
- **RED commands:** each focused test file is run directly with
  `node --import tsx tests/<exact-file>.test.ts`. RED must be missing schema/validator behavior, not
  syntax failure, skipped tests, or fixture absence.
- **GREEN:** strict schemas, complete mutation expected-code map, and byte-stable JCS fixtures.
- **Failure codes:** `schema_invalid`, `json_noncanonical`, `source_binding_invalid`,
  `coverage_leaf_unmapped`, `mutation_expected_code_missing`.

### ES2: static anchor, receiver, guard, and paired controls

- **Owner:** CC Gateway evidence-tooling owner.
- **Files:** `static-anchor.ts`, `wire-receiver.ts`, request/response normalizers, core writer, and
  their focused tests.
- **Symbols:** wrap `runCell`, `runCellGuardSelfTest`, `buildCellSandboxProfile`, and the safe parts
  of `startFakeUpstream`; do not modify the Phase 3A implementations in place.
- **RED:** raw header order lost, raw value persisted, receiver writable by target, non-loopback
  accepted, wrong digest, overflow, paired mutation not detected, or `probe-copy` not independently
  equivalent.
- **GREEN:** all Section 9 controls pass; receiver output is normalized-safe, append-only, and
  receiver-only for wire leaves.
- **No evidence claim:** ES2 proves harness capability, not Claude behavior.

### ES3: independent config/auth revalidation

- **Owner:** supplement campaign controller.
- **Files:** new namespace revalidation runner/classifier and local cell artifacts.
- **Symbols:** reuse the manifest/guard patterns from `config-precedence-campaign.ts` and
  `auth-lifecycle-campaign.ts`, with new run IDs and outputs.
- **Actions:** execute the exact four config pair IDs and exact four auth pair IDs in Section 3.2,
  all four pair/instrumentation labels, at five repetitions; use only synthetic markers; freeze new
  results before exposing predecessor projections; then compare every overlapping leaf.
- **RED:** old input visible to classifier, winner value persisted, API-key or token rotation omitted,
  pair ID drift, fewer than 80+80 expected
  launches, wrong precedence edge, unstable class, predecessor disagreement, or open contradiction.
- **GREEN:** `CL-P3B-ES1-CONFIG-AUTH-REVALIDATED` is Reproduced with new issue/expiry values.
- **Failure codes:** `revalidation_not_independent`, `auth_value_unsafe`, `precedence_unstable`,
  `predecessor_contradiction`.

### ES4: new-session wire campaign

- **Owner:** supplement campaign controller.
- **Files:** campaign runner, three scenario control manifests, receiver observations, and typed
  request projections.
- **Actions:** run three stimuli through both instrumentation arms and five seeds; close method,
  base URL authority/provenance, path/query, header name/order/presence, safe auth class, encoding,
  message/system/tool/stream presence/order/omission, and request AST/materialization.
- **RED:** any required leaf missing, raw value unsafe, unmatched synthetic literal, fixture digest
  mismatch, nondeterminism, or instrumentation difference.
- **GREEN:** all request E rows close under `CL-P3B-ES1-NEW-SESSION-WIRE`.
- **Failure codes:** `request_field_uncovered`, `request_literal_unmaterializable`,
  `request_digest_mismatch`, `paired_perturbation`.

### ES5: response, failure, retry, and recovery campaign

- **Owner:** supplement campaign controller.
- **Files:** the exact 13 scenario programs in Section 7.6, receiver attempt records, response projections, and typed
  response fixture.
- **Actions:** run all 13 programs through both instrumentation arms and five seeds; require all nine
  predecessor-overlap families before contradiction closure; classify
  status/header/SSE acceptance, event order, terminal/stop/usage, retry owner, attempt order/count,
  timing class, transport terminal, partial-stream behavior, and recovery outcome.
- **RED:** unexpected extra attempt, owner ambiguity, action/attempt mismatch, partial-stream merge,
  missing terminal/usage, timing outside closed buckets, or response materialization mismatch.
- **GREEN:** all response/failure E rows close under `CL-P3B-ES1-FAILURE-RECOVERY`.
- **Failure codes:** `attempt_sequence_invalid`, `retry_owner_ambiguous`,
  `transport_terminal_uncovered`, `sse_grammar_uncovered`, `response_digest_mismatch`.

### ES6: field closure and contradiction pass

- **Owner:** evidence curator independent from campaign launch code.
- **Files:** `coverage.ts`, `contradictions.ts`, normalized coverage and contradiction artifacts.
- **Actions:** close receiver observations and paired cell records without issuing conclusions or
  fixtures; join observed leaves to Section 6 by JSON Pointer; compare paired arms and the exact
  predecessor overlap; reject multiple sources and uncovered E leaves.
- **RED:** missing/duplicate pointer, source path/schema/digest/scope/expiry mismatch, cross-family
  tuple mix, open contradiction, or class promotion.
- **GREEN:** observation closure and contradiction artifacts are immutable,
  `uncovered_observation_count=0`, and `open_contradiction_count=0`; no conclusion SHA exists yet.

### ES7: typed fixtures, clock, then successor conclusions

- **Owner:** evidence curator.
- **Files:** `conclusion.schema.json`, `typed-fixture.schema.json`,
  `candidate-field-closure.schema.json`, `clock-attestation.schema.json`,
  exact clock/fixture/conclusion paths from Section 4.
- **Actions:** in strict order, first materialize and validate request/response fixtures against the
  frozen literal table and receiver/control digests; second, compile the immutable candidate field
  closure; third, after the last authorizing cell and fixture validation, create the immutable clock
  attestation; fourth and last, issue the three successor conclusion files with exact 14-day expiry
  and fixture path/SHA bindings. Set usability
  only through the complete-field gate. Conclusions never predate or authorize their fixtures.
- **Complete-field rule:** before writing the clock or first conclusion, create
  `closure/candidate-field-closure.json` over
  one immutable prospective
  closure over every non-conclusion E pointer, both fixture path/SHA/literal/materialization tuples,
  every required pair/program/repetition, and the three prospective conclusion schemas. All three
  conclusion files are one fail-closed set: `phase3b_usable=true` may appear in each only when every
  owned result is Reproduced and the prospective closure is complete; otherwise all three are
  Unknown/false. ES9 verifies and binds this set but cannot add evidence or promote it.
- **RED:** predecessor timestamp reused, stale clock, wrong expiry delta, fixture not executable,
  mixed tuple, or any non-Reproduced E leaf.
- **GREEN:** three coherent Reproduced conclusions and two exact typed canonical fixtures.

### ES8: independent Go validator and cross-repo agreement

- **Owner:** Sub2API contract owner, separate repository commit.
- **Files:** only `backend/internal/oracleevidence/**` and its byte-identical testdata mirror.
- **Symbols:** independent strict JSON/JCS, schema, digest, coverage, fixture, conclusion, and mutation
  validators. No import from `internal/service` is allowed.
- **RED command:**
  `go test ./internal/oracleevidence -run 'TestEvidence(StrictJSON|Schema|Coverage|Fixtures|Mutations|Admission)$' -count=1`
  must fail because the package behavior is absent, not because another package compiled.
- **GREEN command:** the same exact focused command passes; the TS cross-repo checker confirms every
  mirrored byte, digest, decision, and stable code.
- **Prohibited:** `go test ./...`, `go test ./internal/service`, implicit package runners, and any
  command that compiles the protected file.

### ES9: final provenance and coverage

- **Owner:** evidence curator after all sources and cross-repository results exist.
- **Files:** `closure/field-provenance.json` and `closure/coverage.json`.
- **Actions:** resolve every normative source lookup to an actual 64-hex source SHA; validate closed
  source-kind, schema, scope, conclusion, expiry, and transform sets; join every enabled candidate
  pointer exactly once; import every blocker negative capability ID exactly once.
- **RED:** unresolved lookup, missing source, wrong source kind/path/schema/scope/expiry/transform,
  self-source row, missing blocker ID, duplicate pointer, uncovered E leaf, or D leaf enabled.
- **GREEN:** final provenance and coverage exist with zero uncovered E leaves only when all three
  conclusions are Reproduced; otherwise an honest Unknown coverage record is emitted.

### ES10-ES15: append-only closure

- **Owner:** supplement closeout controller.
- **Files:** fixed relative paths:
  `closure/artifact-index.json`, `closure/leak-report.json`, `closure/exit-report.json`,
  `closure/handoff.json`, `closure/terminal-manifest.json`, and
  `closure/external-digest-set.json`.
- **Actions:** exclusive creation, schema validation, Kahn graph validation, leak scan, exact digest
  binding, tracked-clean review, protected count query, and cross-repo result binding.
- **RED:** index omission, hash cycle, wrong closure order, leak finding, missing terminal field,
  wrong exit code, dirty repository, protected count nonzero, or digest-set mismatch.
- **GREEN:** append-only terminal closeout exists even when conclusions are Unknown.

## 12. Failure Families and Stable Actions

```json failure-families
{
  "freeze_mismatch":"stop_before_write",
  "authority_absent":"stop_before_write",
  "protected_indexed":"stop_before_write",
  "static_anchor_mismatch":"stop_before_target",
  "schema_invalid":"reject_artifact",
  "source_binding_invalid":"reject_artifact",
  "observer_boundary_broken":"terminal_unknown",
  "receiver_overflow":"terminal_unknown",
  "external_egress_observed":"terminal_blocked",
  "leak_detected":"quarantine_and_terminal_blocked",
  "paired_perturbation":"terminal_unknown",
  "field_uncovered":"disable_candidate",
  "evidence_not_reproduced":"disable_candidate",
  "predecessor_contradiction":"disable_candidate",
  "predecessor_overlap_incomplete":"disable_candidate",
  "contradiction_open":"disable_candidate",
  "evidence_expired":"disable_candidate",
  "fixture_not_materializable":"disable_candidate",
  "request_digest_mismatch":"disable_candidate",
  "response_digest_mismatch":"disable_candidate",
  "cross_repo_mismatch":"terminal_blocked",
  "dag_invalid":"terminal_blocked",
  "closure_incomplete":"not_complete"
}
```

No failure falls back to guessed values, omitted negative records, weaker schemas, extra repetitions,
real upstream, or product implementation.

## 13. Two Independent Gates

### 13.1 Gate A: `EVIDENCE_SUPPLEMENT_COMPLETE`

This gate means the authorized future supplement ended truthfully. It does not mean the evidence is
sufficient. It requires:

- ES0 through ES15 are terminal under their schemas;
- the exact planned matrix and resource budget were either executed or explicitly closed as not
  executed after a terminal safety failure;
- artifact index, leak report, exit, handoff, terminal manifest, and external digest set exist in
  the unique order and validate;
- every failed or Unknown family is represented explicitly;
- no raw or sensitive material persisted;
- both repositories remain tracked clean except separately reviewed evidence-tooling commits;
- protected count remains zero.

An honest Unknown or BLOCKED closeout may pass Gate A.

### 13.2 Gate B: `SUCCESSOR_AMENDMENT_STARTABLE`

This gate permits only an operator decision to draft a new docs-only Phase 3B successor amendment.
It does not authorize Phase 3B implementation. It requires Gate A plus:

- all three successor conclusions are `Reproduced`;
- all required E leaves have complete one-to-one provenance and field closure;
- request and response typed fixtures are executable and round-trip exact digests;
- `phase3b_usable=true` is present on all three conclusion rows and the handoff tuple;
- all conclusion issue times are fresh, all expiries are exactly 14 days later, and none is expired;
- zero open contradictions, zero leak findings, and zero mutation disagreement;
- TS/Go schema, canonical bytes, digest, decision, and stable-code agreement;
- the candidate remains strictly `new_non_resume`, synthetic loopback, Darwin arm64, and synthetic
  credentials;
- a fresh operator decision explicitly selects drafting the successor amendment.

If Gate A passes and Gate B fails, Phase 3B remains BLOCKED. The only next decisions are a new,
separately planned evidence campaign or stop.

## 14. Commit Boundaries

This PR has one CC Gateway docs-only commit containing only this plan.

If later authorized, future supplement implementation commits remain separate and reviewable:

1. CC `test(oracle-evidence): add schemas corpus and genuine RED tests`.
2. CC `feat(oracle-evidence): add normalized-safe receiver and static controls`.
3. CC `feat(oracle-evidence): add bounded campaigns classifiers and closeout`.
4. Sub2API `test(oracle-evidence): add independent Go RED corpus`.
5. Sub2API `feat(oracle-evidence): add focused Go validator and mirror`.
6. CC `test(oracle-evidence): bind cross-repo agreement and closure checks`.

No commit mixes repositories. Evidence outputs and local authority records are never committed.
No commit contains product handlers, live configuration, sidecar authority, deployment, protected
files, real credentials, real-upstream behavior, Phase 3B compiler output, or Phase 4 wiring.

## 15. Future Command Contract

These are command names for a separately authorized future task, shown as inert text. They are not
commands for this planning task.

```text
node --import tsx tests/oracle-phase3b-evidence-schema.test.ts
node --import tsx tests/oracle-phase3b-evidence-receiver.test.ts
node --import tsx tests/oracle-phase3b-evidence-request-ast.test.ts
node --import tsx tests/oracle-phase3b-evidence-response-ast.test.ts
node --import tsx tests/oracle-phase3b-evidence-campaign.test.ts
node --import tsx tests/oracle-phase3b-evidence-revalidation.test.ts
node --import tsx tests/oracle-phase3b-evidence-coverage.test.ts
node --import tsx tests/oracle-phase3b-evidence-closure.test.ts
node --import tsx tests/oracle-phase3b-evidence-cross-repo.test.ts

go test ./internal/oracleevidence -run 'TestEvidence(StrictJSON|Schema|Coverage|Fixtures|Mutations|Admission)$' -count=1

node --import tsx tools/oracle-lab/phase3b-evidence-sufficiency/campaign.ts \
  --operator-authority <exact-new-authority.json> \
  --campaign-input <exact-campaign-input.json> \
  --evidence-root <new-empty-root> \
  --execute
```

The campaign CLI must reject `--execute` unless the exact new operator authority exists, hashes to
the input binding, names the selected plan digest, and authorizes the exact resource budget. It must
also reject a nonempty evidence root, a symlinked root, or any dynamic P3A/P3A-S authority.

## 16. Plan-Only Static Checks

Only the following checks are permitted for this PR:

- all fixed path/SHA bindings in Sections 1-3;
- strict parsing of every tagged JSON block;
- coverage-source required fields and E/C/D classes;
- coverage section before DAG section;
- DAG node/dependency uniqueness, Kahn completion, and cycle/unknown-dependency mutations;
- mutation list uniqueness and required critical mutations;
- resource budget exact ceilings;
- CodeGraph version/status/config digest and protected count zero in both roots;
- tracked change set restricted to this plan;
- `git diff --check`.

The static checker must not run Claude Code, any dynamic cell, sudo, a real upstream, product tests,
package-wide Go tests, Phase 3B implementation, or Phase 4.

Reference checker logic for this plan:

```javascript
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const file = 'docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-normalized-safe-evidence-sufficiency-supplement.md'
const text = fs.readFileSync(file, 'utf8')
const referenceText = text.slice(0, text.indexOf('Reference checker logic for this plan:'))
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const block = (tag) => {
  const match = text.match(new RegExp('```json ' + tag + '\\n([\\s\\S]*?)\\n```'))
  if (!match) throw new Error('missing JSON block ' + tag)
  return JSON.parse(match[1])
}

for (const match of text.matchAll(/^```json(?: [a-z0-9-]+)?\n([\s\S]*?)^```$/gm)) JSON.parse(match[1])

const fixedFiles = new Map([
  ['docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3b-profile-synthesis.md','367eb28af225ae4d5bf0b666a4c2d3161da7d911f28dc6cb188cb38c1b65a8aa'],
  ['docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-non-resume-amendment.md','51a6f19addd87f1591ae15a1f8f14951bf732954b58fcc722a97fee246c0d4f7'],
  ['docs/superpowers/2026-07-19-claude-code-2.1.215-phase-2-handoff.md','a5454d630dc470cda54adaaed6a4eab5ebd2b8c53909ae5487e4a59b29cee4d9'],
  ['/Users/muqihang/.codex/evidence/claude-code-2.1.215-p3as-20260724-controller-thread-label-fix/closeout/p3as-terminal-blocked-v1/operator-decision-option-a.json','40395bb8240a89dc2be68674ebca70718702b0ae9d95647f28eb7c62feea8cc6'],
  ['/Users/muqihang/.codex/evidence/claude-code-2.1.215-p3as-20260724-controller-thread-label-fix/closeout/p3as-terminal-blocked-v1/terminal-blocked-report.json','c9fd98ef3296227a91f09b55e09f72763c5730e560cec63dded594bffbb8bf6c'],
  ['/Users/muqihang/.codex/evidence/claude-code-2.1.215-p3as-20260724-controller-thread-label-fix/closeout/p3as-terminal-blocked-v1/phase3b-handoff-decision-memo.md','ec8365bc551e6759ed164b4f7607b6142b2a220d228e83f32dd0fc1e751636c2'],
  ['/Users/muqihang/.codex/evidence/claude-code-2.1.215-p3as-20260724-controller-thread-label-fix/closeout/p3as-terminal-blocked-v1/static-check-result.json','dde3d4aa46282cbf41ff7e780b7e97f82dd055131ca70a3f521cf83772e34b89'],
  ['/Users/muqihang/.codex/evidence/claude-code-2.1.215-p3as-20260724-controller-thread-label-fix/closeout/p3as-terminal-blocked-v1/phase3b-non-resume-amendment-planning-handoff.json','be05df33cc14d2d58f6acae6d886833591764857340cfab7ba67dfec865fdfc3'],
  ['/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-2/closure-r2-config-precedence-v2/summary.json','a41dbc159b6b17ad6a6a2c52afa9bb3a74055ac8ca0b74a60d112ff044c32b69'],
  ['/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-2/closure-r2-auth-lifecycle-v1/summary.json','3c78e19294106d9ad6e72e9ef273f1432b593e47a2f503f93e1d02482ef9e7b3'],
  ['/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-2/closure-r2-auth-coexistence-v2/summary.json','103f4d7455aabe0954a378ac267479c6d80df0119d306d9877cf44e6417df39e'],
  ['/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-2/closure-r2-scenario-closure-v2.json','0b2d86d8c84fcfeec9c071bcbb739a8bda70cf77fc97324ad36da26092e8c6d0'],
  ['/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-2/closure-r2-coverage-v8.json','9496dce47210fb66304431e776c4ff0c49afb1c138066753362a7ff3d9a7b15b'],
  ['/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-4/phase-3a-exit-report-v13.json','57f16b207933b3a751f96471733d435fa4b0c9801fbef2f5495e8884dfe0bd1b'],
  ['/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-4/phase-3b-3.5-handoff-v13.json','9d188072719dc27a2f9cc9939bc79afa598802b84dd4d9161fb1da3263a792d7'],
  ['/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-4/closure-terminal-manifest-v8.json','c9ee57fbe29125c88278961565f814326b052077b861bb41008cdde6161f12f5'],
  ['/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-4/artifact-index-v23.json','e8645c7ed4bc984a926f91e3df1b756c4b009b3a02408de213cbe81b060e80d4'],
  ['/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/capsules/P3A-4/leak-scan-v23.json','7ed3e2776c7fcc47d6c8d513318b33547919c92a33a068a4f0c0cb3706bad145']
])
for (const [source, expected] of fixedFiles) {
  if (sha256(fs.readFileSync(source)) !== expected) throw new Error(`fixed digest mismatch ${source}`)
  if (!referenceText.includes(expected)) throw new Error(`fixed digest unbound ${source}`)
}
for (const binding of ['2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce','70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1','schema range `1:0-0`','65 fixtures and seven executable commands']) if (!referenceText.includes(binding)) throw new Error(`P2 binding absent ${binding}`)
for (const requiredArtifact of ['operator-authority.schema.json','freeze.schema.json','clock-attestation.schema.json','synthetic-literals.schema.json','contradiction.schema.json','field-provenance.schema.json','observation-closure.schema.json','candidate-field-closure.schema.json','cross-repo-result.schema.json','capsules/P3B-ES1/control/operator-authority.json','capsules/P3B-ES1/control/freeze.json','capsules/P3B-ES1/control/clock-attestation.json','capsules/P3B-ES1/closure/candidate-field-closure.json','capsules/P3B-ES1/closure/field-provenance.json','capsules/P3B-ES1/validation/cross-repo-result.json']) if (!referenceText.includes(requiredArtifact)) throw new Error(`auxiliary artifact absent ${requiredArtifact}`)

const coverage = block('coverage-source-bindings')
const required = ['id','leaves','class','source_kind','source_relative_path','source_sha256_binding','source_schema','scope','conclusion_id','expiry_binding','transform','missing_action']
if (!Array.isArray(coverage) || coverage.length < 26) throw new Error('coverage too small')
const SCOPE = 'claude-code-2.1.215/darwin-arm64/synthetic-loopback/new_non_resume'
const SOURCE_KINDS = new Set(['operator_policy','frozen_repository','p2_contract','predecessor_safe_projection','static_anchor','scenario_control','receiver_observation','paired_cell_result','successor_conclusion','derived_structural','disabled_policy'])
const CONCLUSIONS = new Map([
  ['CL-P3B-ES1-CONFIG-AUTH-REVALIDATED',['capsules/P3B-ES1/conclusions/config-auth-revalidated.json','oracle-lab-p3b-es-config-auth.v1']],
  ['CL-P3B-ES1-NEW-SESSION-WIRE',['capsules/P3B-ES1/conclusions/new-session-wire.json','oracle-lab-p3b-es-new-session-wire.v1']],
  ['CL-P3B-ES1-FAILURE-RECOVERY',['capsules/P3B-ES1/conclusions/failure-recovery.json','oracle-lab-p3b-es-failure-recovery.v1']]
])
const TRANSFORMS = new Set(['exact_policy_copy_v1','exact_identity_copy_v1','exact_base_url_authority_v1','exact_wire_target_v1','normalize_raw_header_order_v1','disable_and_reject_v1','classify_synthetic_auth_marker_v1','normalize_body_encoding_v1','typed_request_ast_v1','typed_message_sequence_v1','typed_system_sequence_v1','typed_tool_schema_sequence_v1','exact_stream_serialization_v1','bind_materialized_typed_request_v1','exact_scenario_program_v1','normalize_sse_acceptance_v1','typed_terminal_projection_v1','classify_attempt_owner_and_transport_v1','derive_precedence_dag_v1','bind_materialized_typed_response_v1','exact_successor_conclusion_v1','compile_coverage_shape_v1'])
const BLOCKER = 'docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-non-resume-amendment.md'
const BLOCKER_SHA = '51a6f19addd87f1591ae15a1f8f14951bf732954b58fcc722a97fee246c0d4f7'
const C_ROWS = new Map([
  ['cov.control.envelope',['operator_policy',file,'plan_sha256','plan.v1',SCOPE,'not_applicable','exact_policy_copy_v1','reject_bundle']],
  ['cov.response.control',['scenario_control','capsules/P3B-ES1/control/scenario-programs.json','field_provenance.sources[source_relative_path].sha256','oracle-lab-p3b-es-scenario-program.v1',SCOPE,'not_applicable','exact_scenario_program_v1','reject_bundle']],
  ['cov.structural.provenance',['derived_structural',file,'plan_sha256','plan.v1',SCOPE,'not_applicable','compile_coverage_shape_v1','reject_bundle']]
])
const safeSourcePath = (source) => !path.posix.isAbsolute(source) && path.posix.normalize(source) === source && !source.split('/').includes('..') && !/[<>]/.test(source) && (source.startsWith('docs/') || source.startsWith('capsules/P3B-ES1/'))
const ids = new Set()
const pointers = new Set()
for (const row of coverage) {
  for (const key of required) if (!(key in row)) throw new Error(`coverage ${row.id} missing ${key}`)
  if (!['E','C','D'].includes(row.class)) throw new Error(`bad class ${row.id}`)
  if (!SOURCE_KINDS.has(row.source_kind)) throw new Error(`bad source kind ${row.id}`)
  if (!safeSourcePath(row.source_relative_path)) throw new Error(`bad source path ${row.id}`)
  if (typeof row.source_schema !== 'string' || row.source_schema.length === 0) throw new Error(`bad source schema ${row.id}`)
  if (!TRANSFORMS.has(row.transform)) throw new Error(`bad transform ${row.id}`)
  if (ids.has(row.id)) throw new Error(`duplicate coverage id ${row.id}`)
  ids.add(row.id)
  if (!Array.isArray(row.leaves) || row.leaves.length === 0) throw new Error(`empty leaves ${row.id}`)
  for (const pointer of row.leaves) {
    if (!pointer.startsWith('/')) throw new Error(`bad pointer ${pointer}`)
    if (pointers.has(pointer)) throw new Error(`duplicate pointer ${pointer}`)
    pointers.add(pointer)
  }
  if (row.class === 'E') {
    const expected = CONCLUSIONS.get(row.conclusion_id)
    if (!expected || row.source_kind !== 'successor_conclusion' || row.source_relative_path !== expected[0] || row.source_schema !== expected[1] || row.scope !== SCOPE || row.expiry_binding !== 'source.expires_at_ms' || row.source_sha256_binding !== 'field_provenance.sources[source_relative_path].sha256' || row.missing_action !== 'disable_candidate') throw new Error(`invalid E source tuple ${row.id}`)
  }
  if (row.class === 'D' && (row.source_kind !== 'disabled_policy' || row.source_relative_path !== BLOCKER || row.source_sha256_binding !== BLOCKER_SHA || row.source_schema !== 'plan.v1' || row.scope !== 'all' || row.conclusion_id !== 'none' || row.expiry_binding !== 'not_applicable' || row.transform !== 'disable_and_reject_v1' || row.missing_action !== 'forbid_enabled_leaf')) throw new Error(`weak D row ${row.id}`)
  if (row.class === 'C') {
    const expected = C_ROWS.get(row.id)
    const actual = [row.source_kind,row.source_relative_path,row.source_sha256_binding,row.source_schema,row.scope,row.expiry_binding,row.transform,row.missing_action]
    if (!expected || row.conclusion_id !== 'none' || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`invalid C source tuple ${row.id}`)
  }
}
if (coverage.filter((row) => row.class === 'E').length < 20) throw new Error('insufficient E rows')
const negativeLeaves = ['/negative_capabilities/records/capability_id','/negative_capabilities/records/reason','/negative_capabilities/records/source_relative_path','/negative_capabilities/records/source_sha256','/negative_capabilities/records/affected_pointers','/negative_capabilities/records/failure_action','/negative_capabilities/records/revalidation_requirement']
const negativeRow = coverage.find((row) => row.id === 'cov.disabled.exact_records')
if (!negativeRow || JSON.stringify(negativeRow.leaves) !== JSON.stringify(negativeLeaves)) throw new Error('exact negative record row missing')

const disabled = block('closed-disabled-capabilities')
const blockerText = fs.readFileSync(BLOCKER, 'utf8')
const blockerScope = blockerText.slice(blockerText.indexOf('### 4.2 Required disabled capability IDs'), blockerText.indexOf('\n## 5. Field-Level Coverage Matrix'))
const blockerIds = [...blockerScope.matchAll(/```text\n([\s\S]*?)\n```/g)].flatMap((match) => match[1].trim().split('\n'))
if (JSON.stringify(disabled) !== JSON.stringify(blockerIds)) throw new Error('blocker negative capability set drift')
if (new Set(disabled).size !== disabled.length) throw new Error('duplicate disabled capability')

const coverageHeading = text.indexOf('## 6. Normative Coverage Matrix')
const dagHeading = text.indexOf('## 10. Future Execution DAG')
if (coverageHeading < 0 || dagHeading < 0 || coverageHeading >= dagHeading) throw new Error('coverage/DAG order')

const dag = block('evidence-sufficiency-dag')
const validateDag = (value) => {
  const byId = new Map(value.nodes.map((node) => [node.id, node]))
  if (byId.size !== value.nodes.length) throw new Error('duplicate DAG node')
  for (const node of value.nodes) for (const dep of node.deps) if (!byId.has(dep)) throw new Error(`unknown DAG dep ${dep}`)
  const done = new Set()
  while (done.size < value.nodes.length) {
    const ready = value.nodes.filter((node) => !done.has(node.id) && node.deps.every((dep) => done.has(dep)))
    if (ready.length === 0) throw new Error('DAG cycle')
    ready.forEach((node) => done.add(node.id))
  }
  return done.size
}
if (validateDag(dag) !== 18) throw new Error('DAG Kahn count')
if (JSON.stringify(dag.closure_order) !== JSON.stringify(['artifact-index','leak-report','exit-report','handoff','terminal-manifest','external-digest-set'])) throw new Error('closure order drift')
if (dag.artifact_index_includes.includes('artifact-index') || dag.artifact_index_excludes.length !== 6) throw new Error('artifact index cycle')
for (const mutate of [
  (copy) => copy.nodes.find((node) => node.id === 'ES0').deps.push('MISSING'),
  (copy) => copy.nodes.find((node) => node.id === 'ES0').deps.push('ES17'),
]) {
  const copy = structuredClone(dag)
  mutate(copy)
  let rejected = false
  try { validateDag(copy) } catch { rejected = true }
  if (!rejected) throw new Error('DAG mutation accepted')
}

const FIXED_SEEDS = [215001,215002,215003,215004,215005]
const u32 = (value) => {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error('u32 invalid')
  const output = Buffer.alloc(4)
  output.writeUInt32BE(value)
  return output
}
const lp = (value) => {
  const bytes = Buffer.from(value, 'utf8')
  return Buffer.concat([u32(bytes.length), bytes])
}
if (Buffer.concat([lp('ab'),lp('c')]).equals(Buffer.concat([lp('a'),lp('bc')]))) throw new Error('length-prefix ambiguity')
const hashBytes = (value) => createHash('sha256').update(value).digest()
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const validateSeeds = (seeds) => {
  if (!equal(seeds, FIXED_SEEDS) || new Set(seeds).size !== FIXED_SEEDS.length) throw new Error('seed vector invalid')
}
const seedVectorDigest = (seeds) => {
  validateSeeds(seeds)
  return hashBytes(Buffer.concat([lp('p3b-es1-seed-vector-v1'),u32(seeds.length),...seeds.map(u32)]))
}
const validateLabels = (labels, armCount) => {
  if (![2,4].includes(armCount) || labels.length !== armCount || new Set(labels).size !== armCount || labels.some((label) => typeof label !== 'string' || label.length === 0)) throw new Error('arm label/count invalid')
  const sorted = [...labels].sort((left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')))
  if (!equal(labels, sorted)) throw new Error('arm labels not canonical')
}
const positiveMod = (value, modulus) => ((value % modulus) + modulus) % modulus
const deriveBase = (campaignId, scheduleId, labels, armCount, seeds = FIXED_SEEDS) => {
  validateSeeds(seeds)
  validateLabels(labels, armCount)
  const seedDigest = seedVectorDigest(seeds)
  const encoded = Buffer.concat([lp('p3b-es1-arm-order-v2'),lp(campaignId),lp(scheduleId),u32(armCount),u32(labels.length),...labels.map(lp),u32(seedDigest.length),seedDigest])
  const digest = hashBytes(encoded)
  const offset = digest.readUInt32BE(0) % armCount
  const direction = (digest[4] & 1) === 0 ? 1 : -1
  const base = labels.map((_, index) => labels[positiveMod(offset + direction * index, armCount)])
  return { seed_vector_digest: seedDigest.toString('hex'), base_permutation_digest: digest.toString('hex'), offset, direction, base }
}
const runId = (campaignId, scheduleId, label, repetition, stimulusSeed) => hashBytes(Buffer.concat([lp('p3b-es1-run-id-v1'),lp(campaignId),lp(scheduleId),lp(label),u32(repetition),u32(stimulusSeed)])).toString('hex')
const buildSchedule = (campaignId, scheduleId, labels, armCount, seeds = FIXED_SEEDS) => {
  const derived = deriveBase(campaignId, scheduleId, labels, armCount, seeds)
  const orders = seeds.map((_, repetition) => derived.base.map((__, ordinal) => derived.base[(ordinal + repetition) % armCount]))
  const run_ids = orders.map((order, repetition) => order.map((label) => runId(campaignId, scheduleId, label, repetition, seeds[repetition])))
  const payload = { algorithm_id:'fixed-base-plus-cyclic-rotation-v2', encoding_id:'lp-u32be-v1', campaign_id:campaignId, schedule_id:scheduleId, arm_count:armCount, seeds:[...seeds], seed_vector_digest:derived.seed_vector_digest, sorted_labels:[...labels], base_permutation_digest:derived.base_permutation_digest, offset:derived.offset, direction:derived.direction, base:derived.base, orders, run_ids }
  return { ...payload, deterministic_repeat_digest:sha256(Buffer.from(JSON.stringify(payload),'utf8')) }
}
const assertBalance = (base) => {
  const n = base.length
  const counts = (repetitions) => {
    const result = new Map(base.map((label) => [label, Array(n).fill(0)]))
    for (let repetition = 0; repetition < repetitions; repetition++) for (let ordinal = 0; ordinal < n; ordinal++) result.get(base[(ordinal + repetition) % n])[ordinal]++
    return [...result.values()].flat()
  }
  if (counts(n).some((count) => count !== 1)) throw new Error(`first-cycle balance invalid n=${n}`)
  const all = counts(FIXED_SEEDS.length)
  const floor = Math.floor(FIXED_SEEDS.length / n)
  const ceil = Math.ceil(FIXED_SEEDS.length / n)
  if (all.some((count) => count !== floor && count !== ceil) || Math.max(...all) - Math.min(...all) > 1) throw new Error(`five-run balance invalid n=${n}`)
}
const validateSchedule = (record) => {
  const expected = buildSchedule(record.campaign_id, record.schedule_id, record.sorted_labels, record.arm_count, record.seeds)
  if (!equal(record, expected)) throw new Error('schedule mismatch')
  assertBalance(record.base)
  const ids = record.run_ids.flat()
  if (ids.length !== record.arm_count * FIXED_SEEDS.length || new Set(ids).size !== ids.length) throw new Error('run id uniqueness invalid')
  const repeat = buildSchedule(record.campaign_id, record.schedule_id, record.sorted_labels, record.arm_count, record.seeds)
  if (!equal(record, repeat)) throw new Error('deterministic repeat mismatch')
}
const actualLabelSets = [
  ['instrumented','uninstrumented'],
  ['control/instrumented','control/uninstrumented','treatment/instrumented','treatment/uninstrumented']
]
for (const labels of actualLabelSets) {
  const n = labels.length
  for (let offset = 0; offset < n; offset++) for (const direction of [1,-1]) assertBalance(labels.map((_, index) => labels[positiveMod(offset + direction * index, n)]))
  validateSchedule(buildSchedule('campaign-selfcheck','schedule-' + n,labels,n))
}
const expectScheduleReject = (name, mutate) => {
  const record = buildSchedule('campaign-mutation','schedule-mutation',['instrumented','uninstrumented'],2)
  mutate(record)
  let rejected = false
  try { validateSchedule(record) } catch { rejected = true }
  if (!rejected) throw new Error(`arm-order mutation accepted ${name}`)
}
expectScheduleReject('arm_order_per_repetition_hashing', (record) => { record.algorithm_id='per-repetition-hash-v1'; record.base_permutation_digest=record.seeds.map((seed) => sha256(Buffer.concat([lp('per-repetition-hash-v1'),u32(seed)]))) })
expectScheduleReject('arm_order_wrong_rotation', (record) => { record.orders[1].reverse() })
expectScheduleReject('arm_order_seed_reorder', (record) => { record.seeds.reverse() })
expectScheduleReject('arm_order_seed_duplicate', (record) => { record.seeds[4]=record.seeds[3] })
expectScheduleReject('arm_order_seed_missing', (record) => { record.seeds.pop() })
expectScheduleReject('arm_order_label_duplicate', (record) => { record.sorted_labels[1]=record.sorted_labels[0] })
expectScheduleReject('arm_order_label_missing', (record) => { record.sorted_labels.pop() })
expectScheduleReject('arm_order_ambiguous_encoding', (record) => { record.encoding_id='naive-concatenation-v0' })
expectScheduleReject('arm_order_count_mismatch', (record) => { record.arm_count=4 })
expectScheduleReject('arm_order_repeat_mismatch', (record) => { record.deterministic_repeat_digest='0'.repeat(64) })

const mutations = block('static-mutations')
if (new Set(mutations).size !== mutations.length) throw new Error('duplicate mutation')
for (const name of ['header_order_swap','request_digest_mismatch','sse_missing_terminal','arm_order_per_repetition_hashing','arm_order_wrong_rotation','arm_order_seed_reorder','arm_order_seed_duplicate','arm_order_seed_missing','arm_order_label_duplicate','arm_order_label_missing','arm_order_ambiguous_encoding','arm_order_count_mismatch','arm_order_repeat_mismatch','predecessor_expiry_edit','open_contradiction','uncovered_e_leaf','leak_scan_finding']) {
  if (!mutations.includes(name)) throw new Error(`missing mutation ${name}`)
}

const budget = block('resource-budget')
if (budget.target_launches_max !== 340 || budget.target_launches_parallel !== 1 || budget.campaign_wall_ms_max !== 36000000 || budget.external_socket_budget !== 0) throw new Error('resource budget drift')
const programs = block('failure-programs')
const expectedPrograms = ['http_400_terminal','http_401_terminal','http_403_terminal','http_429_terminal','http_500_terminal','http_529_terminal','reset_terminal','partial_sse_then_eof','complete_sse','http_429_then_complete','http_500_then_complete','reset_before_headers_then_complete','delayed_headers_boundary']
if (JSON.stringify(programs) !== JSON.stringify(expectedPrograms)) throw new Error('failure program drift')
for (const pair of ['config-precedence-user-vs-default','config-precedence-project-vs-user','config-precedence-local-vs-project','config-precedence-process-env-vs-local','auth-api-key-rotation','auth-token-rotation','auth-credential-coexistence','auth-missing-credential']) if (!text.includes(pair)) throw new Error(`missing pair ${pair}`)
block('failure-families')
console.log(JSON.stringify({status:'PASS',fixed_digests:fixedFiles.size,coverage_rows:coverage.length,coverage_leaves:pointers.size,coverage_E:coverage.filter((row) => row.class === 'E').length,coverage_C:coverage.filter((row) => row.class === 'C').length,coverage_D:coverage.filter((row) => row.class === 'D').length,disabled_capabilities:disabled.length,failure_programs:programs.length,dag_nodes:dag.nodes.length,mutations:mutations.length,arm_order_counts:[2,4],arm_order_repetitions:FIXED_SEEDS.length,arm_order_red_mutations:10,target_launches_max:budget.target_launches_max}))
```

## 17. Independent Review Protocol

One independent `gpt-5.6-sol` reviewer receives this exact plan digest, both frozen repository
bindings, the merged Phase 3B plan, the merged non-resume blocker amendment, P2 handoff, the five
P3A safe projections and closure bindings, and the Option A/P3A-S closeout records.

The first pass is one holistic review of scope, evidence fidelity, coverage completeness, schema
closure, receiver independence, paired non-perturbation, deterministic schedule, negative controls,
saturation, expiry renewal, contradiction handling, typed fixture executability, retry ownership,
TS/Go agreement, resource budget, closure DAG, gates, commands, and commit boundaries.

Findings are classified:

- `C`: correctness, safety, authority, or scope defect that blocks merge;
- `I`: incomplete or internally inconsistent requirement that blocks merge;
- `N`: nonblocking note.

If the first pass reports any C or I finding, the controller performs at most one consolidated fix
wave, reruns every plan/static check, computes a new plan digest, and requests one closure re-review
from the same independent reviewer. No second fix wave is allowed. Any remaining C or I is
`BLOCKED`. A `0C/0I` closure verdict is required before push and PR creation.

## 18. Terminal Handoff and Next Operator Decision

This planning task is complete when the docs-only plan passes static checks, receives `0C/0I`, is
committed and pushed, and a ready non-draft plan-only PR is open. It does not satisfy either future
evidence gate.

After the plan PR merges, the next operator decision is exactly one of:

1. authorize a separately controlled implementation and execution of this normalized-safe evidence
   supplement against fresh bindings and a new empty evidence root; or
2. stop and retain Phase 3B as BLOCKED.

Even a future successful supplement authorizes only a new docs-only Phase 3B successor amendment.
That amendment must independently update the merged field matrix, schemas, tests, compiler DAG,
commit boundaries, and handoff, receive its own review, merge, and then await a separate Phase 3B
implementation decision.
