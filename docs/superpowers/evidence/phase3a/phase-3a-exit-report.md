# Oracle Lab Phase 3A Exit Report

Status: BLOCKED
Generated: 2026-07-20T12:00:00.000Z
Artifact index: ff0597e052a8e28082df312ffc10d3d545b0f698a967e005feed67b40d97c24d
Conclusion digest: 76847ced274db43f628214624b37e131998280717425eeb7f94bb0e221f5d8d7

## 1. Repository State

Status: PARTIAL

```json
[{"base":"d02b7b3e8e746167a67d39c82792565be05fb3de","codegraph":{"binding_sha256":"450d9f401bc0067f9bd06c9609705b7c752c43311140cc6fa6039f213d96dc43","built_with_version":"1.1.6","edge_count":27038,"extraction_version":24,"file_count":209,"node_count":7468,"up_to_date":true,"version":"1.1.6"},"dirty_path_count":0,"dirty_state_sha256":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","head":"432f76fa0b88a69bf57880b270c9604ca08f30a7","repository":"cc-gateway","repository_binding_sha256":"be0cba7673f125aa7c28b4aa7e612cc77635eeaad53584fe2b8ddbbfb750d7c6","tool_review_freeze_head":"432f76fa0b88a69bf57880b270c9604ca08f30a7","tree":"777ee4c3ce52f010f959d08c8a1888df7ad95342"},{"base":"cea7de895b8b523f3a6bb46be77ba09bc31a11bc","codegraph":{"binding_sha256":"8fe243ba5fa330dc63e12acfcc306f0dd4184ff4b8f95dbf6449ec49e298c34f","built_with_version":"1.1.6","edge_count":332127,"extraction_version":24,"file_count":3065,"node_count":98792,"up_to_date":true,"version":"1.1.6"},"dirty_path_count":0,"dirty_state_sha256":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","head":"8c107d84fee391ce5030d19725a705d4d77973a3","repository":"sub2api","repository_binding_sha256":"67001101ec04268563b3e5a89c1e1e9748d62c4465b13b1d788bce603c3c8054","tool_review_freeze_head":"8c107d84fee391ce5030d19725a705d4d77973a3","tree":"eeb8654eddf7a4c38364202f5024161e65d2a6d1"}]
```

## 2. Artifact Identity

Status: PARTIAL

```json
[{"archive_sha256":"1a5cf8e491689154264c0b2f28371bf645cdee2903b45c497915868308502d7b","artifact_id":"claude-code-2.1.215-wrapper","independent_unpack_roots":2,"inventory_agreement":true,"lifecycle_scripts_executed":false,"npm_integrity":"verified","source_class":"official-npm","tree_sha256":"024fa410b532ced37cd9e45a95aae6f9eb22e9ce8491e1fad843f24d958f4a88"},{"archive_sha256":"b5dd6a135c96957dae232218c4ae5b04328a788f8c509202c92a2fec550601b2","artifact_id":"claude-code-2.1.215-platform","entrypoint_sha256":"90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58","lifecycle_scripts_executed":false,"npm_integrity":"verified","source_class":"official-npm-platform","tree_sha256":"864f493d9fc237df6a858e1620c83279b8f6c15f205dbb47c058f3f537e924a6"},{"archive_sha256":"599883973d2b4c8bb25e3490c84d65646f78d158cdc86adc73c1f5a6cfbbd600","artifact_id":"claude-code-2.1.215-release","entrypoint_sha256":"90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58","lifecycle_scripts_executed":false,"macos_code_signature":"valid","release_detached_signature":"Unknown","release_shasums":"verified","source_class":"official-github-release","tree_sha256":"f5a04795289524b639b479fe6ffac187218d7c558a5a5be312ee228850c6e7fe"},{"aggregate_sha256":"4ce1e08ae3b410f95dd58add5f26ca4a0a580d652eb423ca09078bb7f79547f3","artifact_id":"official-source-integrity-signature-execution-graph","edges":16,"execution_runs":6,"external_socket_budget":0,"file_sha256":"22138b54249f759fd19e86eaee5fbaaa755b49af0a145f2a9f946293ab67803f","nodes":18,"schema_version":"oracle-lab-phase3a-artifact-identity-graph.v1","status":"verified-with-explicit-signature-unknown"}]
```

## 3. Toolchain Capabilities

Status: PARTIAL

```json
{"codegraph":"available-current","codesign":"available-valid","external_socket_budget":0,"os_trace":"degraded-no-elevation","sandbox_exec":"same-scope-exact-profile-green","toolchain_digest":"6f86c18ddf1f22095d5817ee82ee1ff1d6babae689c1f0ebbe51bb2b8217fd6d"}
```

## 4. Static Analysis

Status: PARTIAL

```json
{"bun_modules":14,"entry_module_ast":"Unknown-node-budget","extraction_digest":"0415b2a41c7be93ef2ece741a32b4fa8dcb204a9755fea4fdb3135e6598c350b","invalid_ast_disposition":"quarantined-superseded","small_module_ast_reproductions":5,"summary_sha256":"0e4e0ca6767fecc8613006798c7c910558fe1f26b7a934589b2eab8d76c3cc6e"}
```

## 5. Coverage

Status: PARTIAL

```json
{"active":[{"messages_request":"Unknown","observed":"HEAD-root-only","platform":"darwin-arm64","status":"BLOCKED","version":"2.1.215"}],"change_points":[{"status":"Unknown-unrun","tier":"A","version":"2.1.214"},{"status":"Unknown-unrun","tier":"A","version":"2.1.212"},{"status":"Unknown-unrun","tier":"A","version":"2.1.211"},{"status":"Unknown-unrun","tier":"A","version":"2.1.208"},{"status":"Unknown-unrun","tier":"A","version":"2.1.207"}],"omitted":[{"cell":"active-messages-baseline","reason":"six safe repetitions reached stable HEAD-only failure before messages coverage"},{"cell":"environment-system-prompt-matrix","reason":"active messages baseline not reproducible"},{"cell":"telemetry-lifecycle-stream-compact","reason":"active messages baseline not reproducible"},{"cell":"tier-a-change-points","reason":"P3A-3 waits for reproducible active baseline"},{"cell":"tier-b-change-points","reason":"Tier B yields to unresolved active and Tier A gates"},{"cell":"windows-linux","reason":"no isolated worker available"}]}
```

## 6. Protocol And Runtime Summaries

Status: PARTIAL

```json
[{"cch":"Unknown","compact":"Unknown","messages":"Unknown","normalized_sha256":"8efd29330d08850e015f0fd590b337de82e466dc43fce92fc334e5e77cad4198","request":"HEAD-root-only","runs":["active-baseline-002","active-baseline-003","active-baseline-004","active-baseline-005","active-baseline-006","active-baseline-007"],"sse":"Unknown","stderr_sha256":"95d184c527424ea77100afcd245bdce94b0118dc3a56abafc4dbc785a5c9da4b","system_prompt_status":"Unknown","telemetry":"Unknown","terminal_state":"failed","tls":"not-exercised"}]
```

## 7. Perturbation And Source Agreement

Status: PARTIAL

```json
{"instrumented_cells":0,"profile_usable":false,"source_agreement":"single-source","uninstrumented_controls":6}
```

## 8. Evidence Health

Status: BLOCKED

```json
{"contradictions":[],"errors":[{"code":"static_budget_exceeded","disposition":"Unknown","scope":"entry-module-ast"},{"code":"stable-unclassified-exit","disposition":"Unknown","stderr_sha256":"95d184c527424ea77100afcd245bdce94b0118dc3a56abafc4dbc785a5c9da4b"}],"expired":[],"unknown_conclusion_ids":["CL-P3A-ACTIVE-BASELINE-UNKNOWN","CL-P3A-CHANGE-POINTS-UNKNOWN","CL-P3A-STATIC-ENTRY-UNKNOWN"],"unknowns":["system-prompt","messages-request","cch","telemetry","tls","sse","compact","lifecycle","change-points"]}
```

## 9. Conclusions

Status: BLOCKED

```json
[{"conclusion_id":"CL-P3A-ACTIVE-BASELINE-UNKNOWN","contradicting_artifact_ids":[],"dynamic_reproduction":null,"expiry":"2026-08-03T00:00:00.000Z","level":"Unknown","negative_capabilities":["messages-request-unobserved","system-prompt-unobserved","dual-source-unavailable"],"phase3b_usable":false,"platform_limits":["Darwin arm64 only","no elevated OS trace","no messages request"],"prohibited_claims":["CL-PINNED-OBS-001","CL-CCH-SERVER-ACCEPTANCE-PROHIBITED","CL-TLS-WIRE-EQUIVALENCE-PROHIBITED","CL-LOCAL-EVIDENCE-PRODUCTION-PROHIBITED"],"schema_version":"oracle-lab-phase3a-conclusion.v1","scope":"Claude Code 2.1.215 Darwin arm64 exact-profile loopback baseline","single_source_reason":"The observer and process sampler did not provide two-source messages semantics, and the terminal error remained safely unclassified.","statement":"Six bounded runs reproduced a HEAD request to the declared loopback root followed by the same failed terminal state, but no messages request or safe error category was observed.","static_anchor":null,"supporting_artifact_ids":["p3a2-active-baseline-002-summary","p3a2-active-baseline-003-summary","p3a2-active-baseline-004-summary","p3a2-active-baseline-005-summary","p3a2-active-baseline-006-summary","p3a2-active-baseline-007-summary","p3a4-normalized-observations"]},{"conclusion_id":"CL-P3A-CHANGE-POINTS-UNKNOWN","contradicting_artifact_ids":[],"dynamic_reproduction":null,"expiry":"2026-08-03T00:00:00.000Z","level":"Unknown","negative_capabilities":["change-point-matrix-unavailable"],"phase3b_usable":false,"platform_limits":["control campaign not admitted"],"prohibited_claims":["CL-CHANGELOG-RISK-RULES-PROHIBITED","CL-LOCAL-EVIDENCE-PRODUCTION-PROHIBITED"],"schema_version":"oracle-lab-phase3a-conclusion.v1","scope":"Selected Phase 3A change-point versions","single_source_reason":"Control intake and comparisons were intentionally not started before active baseline convergence.","statement":"No change-point control was admitted because the active-target baseline did not reach the messages path required by the Phase 3A DAG.","static_anchor":null,"supporting_artifact_ids":["p3a4-normalized-observations"]},{"conclusion_id":"CL-P3A-STATIC-ENTRY-UNKNOWN","contradicting_artifact_ids":[],"dynamic_reproduction":null,"expiry":"2026-08-03T00:00:00.000Z","level":"Unknown","negative_capabilities":["complete-entry-callgraph-unavailable","root-map-incomplete"],"phase3b_usable":false,"platform_limits":["Darwin arm64 only","entry AST node budget exceeded"],"prohibited_claims":["CL-OFFICIAL-CLIENT-IDENTITY-PROHIBITED","CL-LOCAL-EVIDENCE-PRODUCTION-PROHIBITED"],"schema_version":"oracle-lab-phase3a-conclusion.v1","scope":"Claude Code 2.1.215 Darwin arm64 entry module static recovery","single_source_reason":"No successful messages dynamic path was available for static-root corroboration.","statement":"The Bun standalone graph and fourteen module ranges were reproduced, but the 20 MiB entry module exceeded the bounded AST node budget and cannot support a complete root map.","static_anchor":{"artifact_digest":"90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58","location":"__BUN,__bun module 0 offset 217140984 length 20163513","reproduction_command_digest":"0415b2a41c7be93ef2ece741a32b4fa8dcb204a9755fea4fdb3135e6598c350b"},"supporting_artifact_ids":["p3a1-static-summary","p3a1-extraction-a","p3a1-extraction-b"]}]
```

## 10. P2 Mapping

Status: PARTIAL

```json
[{"bundle_unchanged":true,"gate":"wire","status":"Unknown"},{"bundle_unchanged":true,"gate":"semantic","status":"Unknown"},{"bundle_unchanged":true,"gate":"state-sequence","status":"Unknown"},{"bundle_unchanged":true,"gate":"failure-semantics","status":"Observed-only"}]
```

## 11. Evidence Hygiene

Status: PARTIAL

```json
{"aggregate_algorithm":"canonical-artifact-set-v1","all_evidence_digest":"a39af6602992bca615ad048983994113cb45b556057f48b9beb23cdc943e2eb0","cleanup_candidates":["capsules/P3A-2/active-baseline-001","static/90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58/ast-a","static/90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58/ast-b","static/90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58/ast-c","phase3a-observer-test temporary directories"],"evidence_root_kib":660680,"free_disk_kib":27064440,"indexed_bytes":21922845,"leak_findings":0,"leak_scan":"PASS","no_deletion":true,"normalized_safe_digest":"92d07197ddf5850f80b85f831f092e23b8c0870b6810092e755bac67a2d58d3b","quarantine_count":3,"raw_quarantine_digest":"428d7f9ff5636f5915c1035e2c7f54fab6b6ce72cd7786df56fcfbc336279c28","retention":"retained","scanned_bytes":1565849,"terminal_index_sha256":"ff0597e052a8e28082df312ffc10d3d545b0f698a967e005feed67b40d97c24d"}
```

## 12. Reproduction

Status: PARTIAL

```json
{"commands":["npm exec tsx tests/oracle-phase3a-static.test.ts","npm exec tsx tests/oracle-phase3a-observer.test.ts","npm exec tsx tests/oracle-phase3a-safe-error.test.ts","npm exec tsx tests/oracle-phase3a-artifact-identity.test.ts","npm exec tsx tests/oracle-phase3a-repository-binding.test.ts","npm exec tsx tests/oracle-phase3a-evidence-root.test.ts","npm exec tsx tests/oracle-phase3a-exit.test.ts","npm exec tsx tests/oracle-phase3a-handoff.test.ts","npm exec tsx tools/oracle-contract/check-cross-repo.ts -- --check","npm exec tsx tools/oracle-lab/phase3a/artifact-identity.ts -- --evidence-root \"$P3A_EVIDENCE_ROOT\" --out \"$P3A_EVIDENCE_ROOT/normalized/P3A-4/artifact-identity-graph.json\" --replace-generated","npm exec tsx tools/oracle-lab/phase3a/build-terminal-index.ts -- --evidence-root \"$P3A_EVIDENCE_ROOT\" --out \"$P3A_EVIDENCE_ROOT/capsules/P3A-4/artifact-index-next.json\"","codegraph sync && codegraph status --json"],"unavailable_tools":["elevated macOS OS tracing","isolated Linux worker","isolated Windows worker"]}
```

## 13. Phase 3B Inputs

Status: BLOCKED

```json
{"acceptance_cases":["new-streaming-session","resumed-streaming-session","bounded-failure-recovery","deterministic-regeneration","ts-go-fixture-agreement"],"candidate_input_rows":[],"candidate_input_schema":{"additionalProperties":false,"properties":{"conclusion_id":{"type":"string"},"phase3b_usable":{"const":true}},"required":["conclusion_id","phase3b_usable"],"type":"object"},"generated_runtime_profile":false,"negative_capabilities":["no-cch","no-change-points","no-compact","no-dual-source","no-messages-request","no-sse","no-system-prompt","no-tls","no-usable-conclusions"],"rollback_reference":{"p2_bundle_sha256":"2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce","predecessor_sha256":"70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1"}}
```

## 14. Safety Confirmation

Status: COMPLETE

```json
{"no_phase4_wiring":true,"no_production":true,"no_profile_promotion":true,"no_protected_file_access":true,"no_real_canary":true,"no_real_credentials":true,"no_real_upstream":true,"runtime_enforcement_implemented":false}
```

## Missing Gates

- active-messages-request-coverage
- cch-coverage
- change-point-coverage
- complete-entry-root-map
- dual-source-agreement
- system-prompt-capture
- tls-sse-compact-coverage
