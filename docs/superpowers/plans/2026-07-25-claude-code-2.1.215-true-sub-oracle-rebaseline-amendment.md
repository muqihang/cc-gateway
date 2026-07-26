# Claude Code 2.1.215 True-Sub Oracle Cross-Repository Rebaseline Amendment

Status: CC-owned plan only; no Sub2API plan or implementation authority; no target, evidence,
Phase 4, product, native-search, runtime-overlay, service, protected-path, upstream, credential, or
production authority

Date: 2026-07-25

## 1. Decision, Scope, and Precedence

The Sub2API repository previously used for Oracle work was not authoritative. This amendment
rebaselines the cross-repository Oracle contract against the only authoritative Sub2API repository,
freezes what remains independently valid in CC Gateway, and invalidates only stale Sub2API and
cross-repository bindings. It does not relabel old results and it does not authorize implementation.

This document is the successor authority for the Sub2API-specific and cross-repository portions of
P0, P1, P2, P3A, P3B/3.5, and the merged PR #47 plan. It is subordinate to the governing roadmap,
specification precedence, and Delivery Operating Model v2. It leaves CC-local, digest-identical
contract bytes intact. On a conflict about Sub2API identity, package location, mirror location,
checker command, or cross-repository result, this amendment wins.

The exact governing CC inputs are:

| Input | SHA-256 / identity | Treatment |
|---|---|---|
| Oracle roadmap | `docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md`, SHA-256 `00519348d9dd8972dbea92a647d67c2fc42e9015ece6dcb0eb427df02480b107` | retained |
| Delivery Operating Model v2 | `docs/superpowers/roadmaps/2026-07-18-oracle-lab-delivery-operating-model-v2.md`, SHA-256 `a53e7384d6cf353877af82f16196b8d58ed823277e76e03337dfc9fadff7d0ea` | retained |
| Phase 3B architecture amendment | SHA-256 `6c015bb842da8ba05a3d541585dca17f73d5b1e7707a884b226fc55e3dbf093c` | retained CC architecture input; stale Sub bindings superseded |
| Normalized-safe supplement | SHA-256 `1583dad45085e3dc18941349f323e2342eedd0ff273eb12a7a1a43f5dc736a57` | retained CC candidate input; Sub/cross-repo binding requires revalidation |
| PR #47 merged plan | commit `45be66d626c32a531d83b3ed00dcd2478681a7d8`, tree `07c5a3b2b96251c6dad02fd944fc0a96f3843914`; plan SHA-256 `64d459997cefda8441c6b60f9d4978d0732867039218d0eb777d3d7d9d60441b` | valid docs history only; no implementation authority |
| Honest closeout candidate | commit `6df1efd5d0eaf0b61c63c3965bcacf6adf2f7e1c`, tree `988591eeaa038458b39ca2f5be3b681f8078549b` | unmerged candidate only; no true-Sub binding |

The governing requirements remain `HA-P0-001`, `HA-P0-006`, `HA-P0-009`, `RA-P0-001`, and
`RA-P0-005`. Their registry status is not promoted by this plan. In particular, P2 requires
cross-language equality and identical rejection semantics; prose agreement is not a substitute.

### 1.1 Stage 1 review record and Stage 1B authority

Stage 1 ended `PLAN_BLOCKED` at `0C/4I`. Its initial review artifact has SHA-256
`58940c5c6c0de15c7ca6504157ffea36b5b9fd81c9181e92ca3ca739747c0b8b`; its same-reviewer closure
artifact has SHA-256 `955df4accf669c7bc107998bdd466490658b92978427f1a0b5279d807982a384`.
Those review results are immutable history and are not relabeled or hidden.

The total controller subsequently issued Stage 1B as a distinct bounded docs-repair authority over
the uncommitted candidate at SHA-256
`3539195a72fbbe5d428287f725d2508c19ef458965df6fdf244e22dfaf4d5644`. Stage 1B permits only the four
mechanical closures identified as `HR-I2`, `HR-I3`, `HR-I4`, and `HR-I6`, plus consequent digest,
line, reference, and static-assertion updates. It is not a second Stage 1 correction wave. It allows
exactly one fresh independent `gpt-5.6-sol` `xhigh` holistic review and no correction wave. Any
Critical or Important finding from that review makes the terminal result `FINAL_PLAN_BLOCKED`.

## 2. Mandatory Entry: Immutable Authority

### 2.1 Selected CC baseline

The controller fetched both configured CC `main` refs. `origin/main` and local `main` are ancestors
of `muqihang/main`; ancestry is unambiguous. The fresh planning worktree was created directly from
the selected ref and was clean before this file was written.

| Binding | Exact value | Class |
|---|---|---|
| repository identity | remote `muqihang`, URL `https://github.com/muqihang/cc-gateway.git`, URL SHA-256 without LF `52de8ee497a784b90b33345865754f3e6b9d5d96eed92549a15a4157cabb568a` | normative context |
| selected ref | `refs/remotes/muqihang/main` -> `45be66d626c32a531d83b3ed00dcd2478681a7d8` | normative |
| selected commit/tree/parent | commit `45be66d626c32a531d83b3ed00dcd2478681a7d8`; tree `07c5a3b2b96251c6dad02fd944fc0a96f3843914`; parent `5b667f90851b7ca3f0de4760179afe847e33e8f2` | normative |
| docs branch | `codex/claude-code-2.1.215-true-sub-oracle-rebaseline-amendment` | publication binding |
| initial tracked state | clean | normative gate |
| CodeGraph | no `.codegraph/` and no project config in the fresh CC worktree; no init or scan performed | recorded fallback |

The absolute planning root and full local remote configuration are diagnostic only. They must not be
copied into an equality-based implementation tuple or a required digest chain.

### 2.2 True Sub2API immutable source authority

The only source repository is `/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main`. Old clone
paths and old worktrees are forbidden sources and were not read for this amendment.

| Binding | Exact value | Rule |
|---|---|---|
| selected authority ref | `refs/heads/codex/native-search-gateway` | local immutable selection; no upstream |
| frozen commit | `3ac410ea02edc53c3925f28eddcbc22b51c0a137` | required base |
| frozen tree | `f7d51fb57c64fbaf6e2db3a7a2d423a491d5788d` | required base |
| parent | `04e42ae0f6c556daad21ac393eb284585092e805` | required ancestry |
| earlier baseline | `fc0b1989d7ba9ce06ff151b17c94b50df4170a93` | proven ancestor |
| origin context | remote `origin`, URL `https://github.com/Wei-Shaw/sub2api.git`, URL SHA-256 without LF `e0ae9390b988b5ab933846c13171778202cbe139888e612a5ea2dd7a7a79a1cf` | repository identity context only; not source authority |
| remote relationship | `origin/main` and `muqihang/main` are each divergent from `3ac410e`; `muqihang/main@fb840673...` and `3ac410e` are divergent | never fast-forward, merge, or infer authority |
| module | `backend/go.mod` SHA-256 `e637999a38f974c9172c8f69c8fbb9c0d727bacf257558307e97e927cbb468de` | normative content |
| sum file | `backend/go.sum` SHA-256 `d3e1fd1510b41f218136b719fdf2c4ef239b05650d3b575fb93c18f25f3dc981` | normative content |
| toolchain directive/runtime | `go 1.26.5`; observed local `go1.26.5 darwin/arm64` with `GOTOOLCHAIN=local` | directive normative; runtime re-frozen at execution |
| surviving predecessor | `backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json`, SHA-256 `70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1` | independently valid read-only predecessor; no caller found |

The product commits `04e42ae` and `3ac410e` are baseline context for native vector search and its
runtime overlay. They are not Oracle implementation and this plan grants no authority to alter,
compile, test, or promote those product surfaces.

### 2.3 Protected-safe CodeGraph gate

The independent read-only reconciliation worktree proved the following CodeGraph gate at the exact
true-Sub commit/tree:

| Gate | Exact value | Authority use |
|---|---|---|
| CLI / extraction | CodeGraph `1.1.6`; extraction revision `24` | required future gate |
| config bytes | exactly the 91 UTF-8 bytes in the block below | required before any scan |
| config SHA-256 | `a7f3ad7c17d655f9d2494b5b05e55ceb4ea9c7667456ff785c5f2a9291c3783a` | required future gate |
| pending | added `0`, modified `0`, removed `0` | required future gate |
| worktree mismatch | `null` | required future gate |
| reindex recommended | `false` | required future gate |
| protected equality query | file rows `0`, node rows `0` | required future gate |

```json codegraph-protected-config
{
  "exclude": [
    "backend/internal/service/openai_compact_sse_keepalive_test.go"
  ]
}
```

The protected path must never be read, searched, diffed, indexed, compiled, tested, modified, or
passed to a package selector. The only permitted reference is the exact exclusion/config and the
file/node zero-count equality gate.

CodeGraph does not embed Git HEAD/tree in its current database metadata. A future Mandatory Entry
must therefore bind, in one contemporaneous controller record, the index root, config digest,
version/extraction revision, status gates above, selected ref resolution, Git commit/tree, and clean
tracked state. This is a joint observation, not a claim that the database cryptographically attests
to Git identity.

## 3. Diagnostic Snapshot Ledger

Diagnostic snapshots explain the rebaseline but are forbidden inputs to implementation equality,
admission authority, bundle digests, result digests, or review approval.

| Snapshot | Procedure and observation | Classification |
|---|---|---|
| original full remote projection | `git config --get-regexp '^remote\..*\.url$'`; each record is `key SP value LF`; byte-sort complete records under `LC_ALL=C`; concatenate including final LF; SHA-256. The 187-byte `legacy`, `muqihang`, `origin` stream is `1b9dcaefa91d96c5d8e2e379bd7909b09c5278a3bac422c661c05746d6d9c06e` with no field diff from recon. | mutable, non-normative |
| broader planner projection | same sorting, but regex included both `.url` and `.fetch`; digest `f2631bef13bfa5aa3a35fa376d01b6a58f9f5910e8f38927001fbb7e82b21abd` | different metric, not drift, non-normative |
| reconciled `/79ad` graph | independent DB; last indexed `2026-07-26T04:49:20.813Z`; 3,064 files, 98,606 nodes, 330,628 edges, unresolved refs `0`; DB 313,729,024 bytes | raw counts/time/size diagnostic only |
| other graph observation | 3,043 files, 98,067 nodes, 253,798 edges from a separate DB rooted at the authority checkout | foreign/unproven provenance; not source drift and not authority |
| planning root / common-dir | absolute host paths and mutable shared Git config | diagnostic only |
| remote tracking refs/divergence | moving ref OIDs and ahead/behind counts | diagnostic only |

The exact machine-readable diagnostic receipt is below. `observed_at` is the final bounded
reconciliation observation; `recorded_at` is the planning receipt time. The foreign DB did not
provide an embedded observation timestamp, so its exact last-index time and receipt upper bound are
recorded separately rather than inventing a time.

```json diagnostic-snapshots
{"recorded_at":"2026-07-26T05:18:50Z","schema_id":"oracle.rebaseline.diagnostics","schema_major":1,"schema_revision":0,"snapshots":[{"common_dir":"/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.git","git_dir":"/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.git/worktrees/sub2api-zhumeng-main","id":"remote-url-only-projection","observed_at":"2026-07-26T05:15:04Z","procedure":["git config --get-regexp '^remote\\..*\\.url$'","emit key SP value LF","LC_ALL=C byte-sort complete records","concatenate with final LF","SHA-256 exact stream"],"projection":["remote.legacy.url /Users/muqihang/chelingxi_workspace/sub2api-legacy\n","remote.muqihang.url https://github.com/muqihang/sub2api.git\n","remote.origin.url https://github.com/Wei-Shaw/sub2api.git\n"],"repository_root":"/Users/muqihang/.codex/worktrees/79ad/sub2api-zhumeng-main","sha256":"1b9dcaefa91d96c5d8e2e379bd7909b09c5278a3bac422c661c05746d6d9c06e","stream_bytes":187},{"codegraph_executable":"/Users/muqihang/.codegraph/versions/v1.1.6/bin/codegraph","config_path":"/Users/muqihang/.codex/worktrees/79ad/sub2api-zhumeng-main/codegraph.json","config_sha256":"a7f3ad7c17d655f9d2494b5b05e55ceb4ea9c7667456ff785c5f2a9291c3783a","db_path":"/Users/muqihang/.codex/worktrees/79ad/sub2api-zhumeng-main/.codegraph/codegraph.db","db_size_bytes":313729024,"edge_count":330628,"extraction_revision":24,"file_count":3064,"id":"reconciled-codegraph","last_indexed":"2026-07-26T04:49:20.813Z","local_metadata_side_effects":1,"metadata_procedure":["Stage1 recorded logical query classes but not literal sqlite argv or SQL","therefore historical SQL procedure is unavailable and is not represented as exact"],"node_count":98606,"observed_at":"2026-07-26T05:15:04Z","pending":{"added":0,"modified":0,"removed":0},"protected":{"file_rows":0,"node_rows":0},"reindex_recommended":false,"repository_root":"/Users/muqihang/.codex/worktrees/79ad/sub2api-zhumeng-main","tracked_source_index_writes":0,"unresolved_refs":0,"version":"1.1.6","worktree_mismatch":null,"observed_argv":[["/Users/muqihang/.codegraph/versions/v1.1.6/bin/codegraph","--version"],["/Users/muqihang/.codegraph/versions/v1.1.6/bin/codegraph","status"],["/Users/muqihang/.codegraph/versions/v1.1.6/bin/codegraph","status","--json"]],"historical_sql_status":"unknown_not_recorded"},{"config_path":null,"db_path":"/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.codegraph/codegraph.db","edge_count":253798,"file_count":3043,"id":"foreign-unproven-codegraph","last_indexed":"2026-07-16T03:12:56.383Z","node_count":98067,"observation_time_status":"unknown-before-receipt","procedure":["codegraph status --json from authority checkout","no rebuild or provenance migration"],"provenance":"unresolved","receipt_upper_bound":"2026-07-26T05:18:50Z","repository_root":"/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main"}],"procedure_contract":{"id":"future-true-sub-mandatory-entry-v1","authority_class":"procedure-normative; measured outputs diagnostic except named mandatory gates","cwd":"/Users/muqihang/.codex/worktrees/79ad/sub2api-zhumeng-main","common_dir":"/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main/.git","environment":{"HOME":"/Users/muqihang","LANG":"C","LC_ALL":"C","PATH":"/Users/muqihang/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin","TZ":"UTC"},"locator_rules":{"repository_root":"stdout of git-root after stripping exactly one LF; must equal cwd and be absolute","common_dir":"stdout of git-common-dir after stripping exactly one LF; resolve relative output against cwd; must equal common_dir","config_path":"repository_root + /codegraph.json; lstat regular file; no symlink","database_path":"repository_root + /.codegraph/codegraph.db; lstat regular file; no symlink"},"commands":[{"id":"time-before","argv":["/bin/date","-u","+%Y-%m-%dT%H:%M:%SZ"]},{"id":"git-root","argv":["/usr/bin/git","-C","/Users/muqihang/.codex/worktrees/79ad/sub2api-zhumeng-main","rev-parse","--path-format=absolute","--show-toplevel"]},{"id":"git-common-dir","argv":["/usr/bin/git","-C","/Users/muqihang/.codex/worktrees/79ad/sub2api-zhumeng-main","rev-parse","--path-format=absolute","--git-common-dir"]},{"id":"git-dir","argv":["/usr/bin/git","-C","/Users/muqihang/.codex/worktrees/79ad/sub2api-zhumeng-main","rev-parse","--path-format=absolute","--git-dir"]},{"id":"git-status","argv":["/usr/bin/git","-C","/Users/muqihang/.codex/worktrees/79ad/sub2api-zhumeng-main","status","--porcelain=v1","--untracked-files=no"]},{"id":"git-selected-commit","argv":["/usr/bin/git","-C","/Users/muqihang/.codex/worktrees/79ad/sub2api-zhumeng-main","rev-parse","--verify","refs/heads/codex/native-search-gateway^{commit}"]},{"id":"git-selected-tree","argv":["/usr/bin/git","-C","/Users/muqihang/.codex/worktrees/79ad/sub2api-zhumeng-main","rev-parse","--verify","refs/heads/codex/native-search-gateway^{tree}"]},{"id":"git-selected-parent","argv":["/usr/bin/git","-C","/Users/muqihang/.codex/worktrees/79ad/sub2api-zhumeng-main","rev-parse","--verify","refs/heads/codex/native-search-gateway^"]},{"id":"git-remote-url-projection","argv":["/usr/bin/git","-C","/Users/muqihang/.codex/worktrees/79ad/sub2api-zhumeng-main","config","--get-regexp","^remote\\..*\\.url$"]},{"id":"config-sha256","argv":["/usr/bin/shasum","-a","256","/Users/muqihang/.codex/worktrees/79ad/sub2api-zhumeng-main/codegraph.json"]},{"id":"codegraph-version","argv":["/Users/muqihang/.codegraph/versions/v1.1.6/bin/codegraph","--version"]},{"id":"codegraph-status-text","argv":["/Users/muqihang/.codegraph/versions/v1.1.6/bin/codegraph","status"]},{"id":"codegraph-status-json","argv":["/Users/muqihang/.codegraph/versions/v1.1.6/bin/codegraph","status","--json"]},{"id":"sqlite-project-metadata","argv":["/usr/bin/sqlite3","-readonly","-json","/Users/muqihang/.codex/worktrees/79ad/sub2api-zhumeng-main/.codegraph/codegraph.db","PRAGMA query_only=ON; SELECT key,value FROM project_metadata ORDER BY key COLLATE BINARY;"]},{"id":"sqlite-counts","argv":["/usr/bin/sqlite3","-readonly","-json","/Users/muqihang/.codex/worktrees/79ad/sub2api-zhumeng-main/.codegraph/codegraph.db","PRAGMA query_only=ON; SELECT (SELECT COUNT(*) FROM files) AS file_count,(SELECT COUNT(*) FROM nodes) AS node_count,(SELECT COUNT(*) FROM edges) AS edge_count,(SELECT COUNT(*) FROM unresolved_refs) AS unresolved_refs;"]},{"id":"sqlite-protected-equality","argv":["/usr/bin/sqlite3","-readonly","-json","/Users/muqihang/.codex/worktrees/79ad/sub2api-zhumeng-main/.codegraph/codegraph.db","PRAGMA query_only=ON; SELECT (SELECT COUNT(*) FROM files WHERE path='backend/internal/service/openai_compact_sse_keepalive_test.go') AS file_rows,(SELECT COUNT(*) FROM nodes WHERE file_path='backend/internal/service/openai_compact_sse_keepalive_test.go') AS node_rows;"]},{"id":"time-after","argv":["/bin/date","-u","+%Y-%m-%dT%H:%M:%SZ"]}],"execution_order":["time-before","git-root","git-common-dir","git-dir","git-status","git-selected-commit","git-selected-tree","git-selected-parent","git-remote-url-projection","config-sha256","codegraph-version","codegraph-status-text","codegraph-status-json","sqlite-project-metadata","sqlite-counts","sqlite-protected-equality","time-after"],"output_canonicalization":{"single_line_git_and_version":"require UTF-8, exactly one non-empty line plus LF; strip that LF only","git_status":"require zero stdout bytes","remote_projection":"require key SP value LF records; LC_ALL=C byte-sort whole records; concatenate with final LF; SHA-256 exact bytes","status_json":"strict JSON parse with duplicate-key denial; JCS for receipt only","sqlite_json":"strict JSON parse; metadata rows remain SQL key order; count queries require exactly one object with integer values","timestamps":"strict UTC YYYY-MM-DDTHH:MM:SSZ; observed_at is time-after; require time-before <= time-after"},"gates":{"every_exit_code":0,"selected_ref_commit":"3ac410ea02edc53c3925f28eddcbc22b51c0a137","selected_ref_tree":"f7d51fb57c64fbaf6e2db3a7a2d423a491d5788d","selected_ref_parent":"04e42ae0f6c556daad21ac393eb284585092e805","config_sha256":"a7f3ad7c17d655f9d2494b5b05e55ceb4ea9c7667456ff785c5f2a9291c3783a","codegraph_version":"1.1.6","extraction_revision":24,"pending":{"added":0,"modified":0,"removed":0},"worktree_mismatch":null,"reindex_recommended":false,"protected":{"file_rows":0,"node_rows":0}},"side_effect_accounting":{"expected_local_metadata_side_effects":1,"permitted":"status calls may transiently create ignored SQLite WAL/SHM and change only .codegraph directory mtime","postcondition":"database/config/source/tracked/index bytes unchanged; WAL/SHM absent after close","diagnostic_only":["directory mtime","WAL/SHM lifecycle","raw counts","DB size and timestamps","remote projection digest"]},"stop_rule":"any argv/env/cwd/locator/schema/exit/output/gate/postcondition mismatch requires fresh authority; never adapt SQL or rebuild"}}
```

The receipt deliberately marks the historical SQLite argv/SQL as unavailable: Stage 1 recorded the
observed values and logical query classes but did not retain literal SQL. The embedded
`procedure_contract` is the exact procedure for the future true-Sub Mandatory Entry rebind; it does
not retroactively claim that its SQL produced the historical counts. Its executor uses `execve`
semantics with the listed argv, environment, and cwd, with no shell expansion. A database schema
that lacks any named table or column causes the named SQLite command to exit nonzero and triggers
the stop rule; the operator must not adapt the SQL in place. The protected equality query selects
counts only and never selects source/content columns.

No mismatch in this table is immutable source drift. No rebuild is allowed merely to force raw count
equality. Requested `codegraph status` calls did not change DB, config, source, tracked Git, or index
bytes, but SQLite full-WAL operation transiently created and removed ignored WAL/SHM sidecars and
changed only the ignored `.codegraph` directory mtime. Accounting is therefore
`tracked_source_index_writes=0` and `local_metadata_side_effects=1`, not `filesystem_writes=0`.
Directory mtime and WAL lifecycle remain diagnostic and non-blocking.

Any future artifact that places `full_remote_config_digest`, `absolute_worktree_path`, raw
file/node/edge counts, DB size/timestamps, directory mtime, or divergence counts in a normative
authority tuple must fail closed with `authority_diagnostic_promotion`.

## 4. Invalidation and Supersession Model

The ledger uses four statuses: `retain_cc_local`, `retain_predecessor_only`,
`historical_invalid_binding`, and `fresh_authority_required`. Old records keep their original labels;
this amendment adds a successor interpretation and never rewrites history.

| Slice | Preserved | Invalidated or superseded | New state |
|---|---|---|---|
| P0 governance | roadmap/spec precedence, requirement registry, CC traceability mechanisms | any baseline envelope, receipt, context, or claim that identifies the old Sub clone, its worktrees, commits, modules, or graph | `fresh_authority_required` for cross-repo use |
| P1 predecessor | the one `70c26d...` formal-pool blob at its true-Sub path | old-clone callers, replay, mirror, module hashes, review conclusions, and any inference that P1 established Oracle code in true Sub | blob is `retain_predecessor_only`; no caller authority |
| P2 core contract | all nine CC-local `contracts/oracle-lab/v1/**` files, candidate TS primitives, schema range `1:0-0` | old Sub mirror, old Go validators/tests, old cross-language equality, old checker receipts, old module digests | CC bytes `retain_cc_local`; Sub mirror and parity `fresh_authority_required` |
| P3A | independently valid CC-only reverse/safe evidence may remain candidate input after exact digest, scope, contradiction, and 24-hour expiry revalidation | every old Sub or cross-repository binding, including any P0-P3B handoff that names old identities | no target/evidence action; future revalidation only |
| P3B/3.5 | CC architecture and normalized-safe documents as bounded candidate specifications; honest closeout only as unmerged candidate | old-clone ES8 package, 50-file mirror, mutation fixtures, validators, RED/GREEN logs, reviews, and ES8 closure conclusions | entire Sub implementation binding `historical_invalid_binding` |
| PR #47 | merged docs commit/tree and plan blob as history | sections binding `fb840673`, `f0e6bf7f`, `09e866ad`, `7972307d`, `68b465aa`, old worktrees, mirror digest `1dd8...`, old review artifacts, old module hashes, old graph counts/config, or `./internal/service` | superseded by this plan; never implementation authority |

The permanently forbidden source set includes `/Users/muqihang/chelingxi_workspace/sub2api`, every
old-clone worktree, commits `fb840673`, `f0e6bf7f`, `09e866ad`, `7972307d`, `68b465aa`, and any
validator, fixture, test, review, digest, or ES8 conclusion derived from them. They may be named only
in this invalidation ledger. They must not be opened, copied, ported, migrated, compiled, searched,
or used as examples by downstream controllers.

Reusable true-Sub primitives such as `CanonicalizeControlPlaneQuery`,
`ControlPlanePathPolicy.Evaluate`, transcript/evidence canonicalization, safe hashes,
`hmac_audit_digest`, matrix manifest comparison, native-shape healthcheck evaluation,
`internal/util/logredact`, sensitive scanning, and full-chain reporting are patterns only. They are
domain-specific, some have filesystem side effects, and none is generic strict JSON, schema,
admission, manifest-authority, mutation, or ES8 validation authority.

## 5. Preserved CC Core Contract

### 5.1 Exact file set and digests

The future true-Sub mirror is
`backend/internal/oracleevidence/testdata/oracle_lab_contract/v1/**`. It contains exactly these nine
regular, non-symlink files, byte-identical to CC; no other entry is allowed:

| File | SHA-256 |
|---|---|
| `authority-corpus.json` | `42e89c1933f7c2b9f71dfd41d739345b3f2253f0217c6ebb2ee77b25ab94d8de` |
| `canonicalization-corpus.json` | `a2925a1c04aa90dbc42eee3045574faf829ccddaa776d75d2497558821c0ab20` |
| `coherence-corpus.json` | `85b7209d31370bd56bb4a374cf796ecabd11ee191b30e9e9a485ff65b2d03d82` |
| `contract-index.json` | `2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce` |
| `contract.schema.json` | `380c7f3db80baa2d288838f3a550c3588abd19de11627d34ae90f5d3a0add4fe` |
| `expected-results.json` | `8671744730e94e88b439f05a0e934539fe5b148b3e3dfdc1243beba9774ced44` |
| `interface-corpus.json` | `9c2f0864097911b3b9612ee5bb6a4b62e363b2152abe7bfd5ff07221a6c60dca` |
| `sidecar-envelope.cddl` | `7697364dcaa7189449e94305a4df86d8d5476078b3dee78fac2fb34ccc60905d` |
| `sidecar-envelope.schema.json` | `a9256710c040d2a018fbc42f188a59f11fc1dd9dc46ea7be89ca2294aaace003` |

The index is raw RFC 8785 JCS with no BOM and no trailing LF. It binds the eight non-index files,
schema `oracle.compatibility`, major `1`, revision `0`, compatibility range exactly `1:0-0`, and the
single predecessor `70c26d...`. Existing bytes are not edited by this rebaseline.

### 5.2 Candidate CC implementation primitives

The following CC files are candidate normative behavior because they are CC-local at the selected
base. They are not evidence that true Sub already implements the behavior:

| File | SHA-256 | Owned behavior |
|---|---|---|
| `src/oracle-contract/canonical.ts` | `033e3d9fec42a939dfa0090bab79f2cc9addc17c047fe2a5a31334dfee21807a` | JCS, SHA-256, path/query, authority formatting |
| `src/oracle-contract/strict-json.ts` | `d907aa5d911a8165a3817fba47aa9eb68e9cba37d7ac9b8da5416a89c78ce399` | strict UTF-8 JSON and I-JSON checks |
| `src/oracle-contract/schema.ts` | `08cae3bac8c19d282e80bd5f6ea2fe64cbb53d1b6f82cf0d61284f564c695a96` | Draft 2020-12 certificate validation |
| `src/oracle-contract/admission.ts` | `bee1c89bc73674a215d6971849ba7531594d88d327f700fe86f7bae7b5893a3d` | fail-closed coherence admission |
| `src/oracle-contract/manifest-authority.ts` | `bcad1fa95eaf97e3fca35eaeb42d6d4839f294cb2fe1ca515898bfc9ee18ef33` | signed manifest/checkpoint/rotation/revocation authority |
| `src/oracle-contract/cross-project.ts` | `18d96722c658d405ba9c77d646dd130caa571e1471540955f707e3584abd8300` | readiness, lifecycle, lineage, outcome, replay decisions |
| `src/oracle-contract/cbor-envelope.ts` | `205f5572e472ff9e32cdeffa2e5965a5a99f6cc379529a35aeef89665cc38cbe` | deterministic bounded CBOR and frame parsing |
| `src/oracle-contract/sidecar-envelope.ts` | `0d3031df417f4d7286783e1c0d33e0a34bb042fd9b1ee763278887109b2ebc8b` | sidecar capability and replay decisions |

True Sub must implement from these current CC bytes, the schemas/corpora, and this amendment. It must
not copy or consult old-clone Go code.

## 6. Exact Future True-Sub Package Contract

The provisional future code root is only `backend/internal/oracleevidence/**`. This is planning
authority, not permission to create it now. No file under `backend/internal/service/**` may be added,
changed, compiled, or selected by a Go command.

### 6.1 File and symbol matrix

| Future file | Commit | Required symbols / content |
|---|---|---|
| `doc.go` | R1 | package declaration and non-runtime scope statement |
| `api.go` | R1 then I1 | `Decision`, `MutationCase`, `MutationResult`, `AuthorityInput`, `CrossRepoRecord`, stable code constants, compileable fail-closed public entry points |
| `strictjson.go` | I1 | `ParseStrictJSON`, `ValidateJSONValue`, duplicate-key and bounded-number scanner |
| `canonical.go` | I1 | `CanonicalizeJSON`, `CanonicalizeValue`, `SHA256Hex`; independent RFC 8785 implementation using standard library only |
| `cbor.go` | I1 | `CanonicalizeCBOR`, `DecodeDeterministicCBOR`, `EncodeCBORFrame`, `DecodeCBORFrame`; five CBOR cases and bounded sidecar canonical bytes |
| `schema.go` | I1 | `LoadContractSchema`, `ValidateContractObject`; local-ref-only Draft 2020-12 subset actually used by the frozen schema |
| `admission.go` | I1 | `AdmissionPayloadDigest`, `DecideBehaviorAdmission` |
| `authority.go` | I1 | domain constants, `VerifyManifestAuthorityUpdate`, `VerifyRootRotation`, `VerifyEmergencyRevocation`, `TrustStateDigest` |
| `interface.go` | I1 | `DecideReadiness`, `DecideLifecycle`, `DecideTaskLineage`, `DecideOutcome`, `ExecuteReplay`; all 16 interface/replay cases |
| `sidecar.go` | I1 | `ValidateSidecarEnvelope`, `VerifySidecarCapability`; schema/canonical/signature/key/expiry decisions only, no runtime transport |
| `mutation.go` | I1 | `ParseBoundedPointerIndex`, `ApplyMutation`, `ExecuteMutationCorpus`; no ID-based dispatch |
| `crossrepo.go` | I1 | `InspectMirror`, `ValidateContractIndex`, `ValidateCrossRepoRecord`, exact required-set authority |
| `oracle_contract_test.go` | R1 then I1 | exact named focused tests and behavioral RED controls |
| `testdata/oracle_lab_contract/v1/**` | R1, immutable in I1 | exact nine-file mirror from Section 5.1 |
| `testdata/rebaseline/v1/mutation-corpus.json` | R1, immutable in I1 | canonical mutation descriptors and expected decisions |
| `testdata/rebaseline/v1/source-manifest.json` plus bounded synthetic fixtures | R1, immutable in I1 | actual source bytes, relative paths, kinds, sizes, mode classes, caps, SHA-256; no evidence |

No dependency may be added. `go.mod` and `go.sum` remain byte-identical. I1 may split unexported
helpers inside the listed files, but may not rename the exported symbols or move ownership to another
package.

The compile contract is exact:

```go
type Decision struct {
    Allowed         bool
    Code            string
    Detail          string
    NextState       []byte
    NextStateDigest string
}
type ContractError struct { Code string; Detail string }
func (e *ContractError) Error() string
type RawPort string
type SchemaSet struct { bundleRoot string; authoritySHA256 string }
type MutationOperation struct {
    Kind        string
    Pointer     string
    Value       any
    Offset      uint64
    DeleteCount uint64
    BytesBase64 string
    Path        string
    Mode        uint32
    Target      string
}
type MutationCase struct {
    CaseID    string
    Subject   string
    Source    SourceBinding
    Operation MutationOperation
    Expected  Decision
}
type MutationResult struct { CaseID string; Allowed bool; Code string; OutputSHA256 string }
type SourceBinding struct { RelativePath string; SHA256 string; Size uint64; MaxBytes uint64; Kind string; ModeClass string }
type AuthorityInput struct { State []byte; Candidate []byte; Context []byte }
type CrossRepoRecord struct { Canonical []byte; Digest string }

func ParseStrictJSON(input []byte) (any, error)
func ValidateJSONValue(value any) error
func CanonicalizeJSON(input []byte) ([]byte, error)
func CanonicalizeValue(value any) ([]byte, error)
func NormalizePathQuery(pathname string, pairs [][2]string) (string, error)
func ParseAuthorityPort(raw RawPort) (uint16, error)
func FormatAuthority(host string, rawPort RawPort) (string, error)
func SHA256Hex(input []byte) string
func CanonicalizeCBOR(input []byte) ([]byte, error)
func DecodeDeterministicCBOR(input []byte) (any, error)
func EncodeCBORFrame(value any) ([]byte, error)
func DecodeCBORFrame(input []byte) (any, error)
func LoadContractSchema(bundleRoot string) (*SchemaSet, error)
func ValidateContractObject(schemas *SchemaSet, definition string, input []byte) Decision
func AdmissionPayloadDigest(certificate, signals, negativeCapabilities []byte) (string, error)
func DecideBehaviorAdmission(certificate, context []byte) Decision
func VerifyManifestAuthorityUpdate(input AuthorityInput) Decision
func VerifyRootRotation(input AuthorityInput) Decision
func VerifyEmergencyRevocation(input AuthorityInput) Decision
func TrustStateDigest(state []byte) (string, error)
func DecideReadiness(handshake, expected []byte) Decision
func DecideLifecycle(state, operation []byte) Decision
func DecideTaskLineage(state, candidate []byte, nowMS int64) Decision
func DecideOutcome(outcome []byte) Decision
func ExecuteReplay(state, command []byte) Decision
func ValidateSidecarEnvelope(envelope []byte, schemas *SchemaSet) Decision
func VerifySidecarCapability(envelope, capability, keyring []byte, nowMS int64) Decision
func ParseBoundedPointerIndex(segment string, length uint64, allowEnd bool) (uint64, error)
func ApplyMutation(source []byte, operation MutationOperation) ([]byte, error)
func ExecuteMutationCorpus(root string, corpus []byte, schemas *SchemaSet) ([]MutationResult, error)
func InspectMirror(ccRoot, subRoot, predecessorPath string) Decision
func ValidateContractIndex(bundleRoot string) Decision
func ValidateCrossRepoRecord(input []byte) Decision
```

`RawPort` is the untrusted lexical boundary; callers must not parse, clamp, round, coerce, or cast it
before `ParseAuthorityPort`. The parser accepts only canonical ASCII decimal `[1-9][0-9]{0,4}` and
then performs an unsigned base-10, 16-bit checked parse. It rejects any non-ASCII byte, sign,
whitespace, decimal point, exponent, leading zero, empty value, value above `65535`, or lexical
overflow with `&ContractError{Code:"url_port_invalid"}`. Only after both lexical and range checks may
the value be converted to `uint16`. `FormatAuthority` calls that parser first, returns
`url_host_invalid` for an invalid host only after a valid port, and returns `code=""` with `nil`
error on success. Required exact vectors are:

| Host | Raw port | Expected value / stable code |
|---|---|---|
| `api.example.com` | `443` | `api.example.com:443`, `code=""` |
| `2001:db8::1` | `65535` | `[2001:db8::1]:65535`, `code=""` |
| `api.example.com` | `-1` | `url_port_invalid` |
| `api.example.com` | `0` | `url_port_invalid` |
| `api.example.com` | `443.5` | `url_port_invalid` |
| `api.example.com` | `65536` | `url_port_invalid` |
| `api.example.com` | `18446744073709551616` | `url_port_invalid` |
| `api.example.com` | ``, `+443`, ` 443`, `443 `, `0443`, or `1e3` | `url_port_invalid` |
| empty host | `443` | `url_host_invalid` |

The R1 entry points exist and compile. Every not-yet-implemented `Decision` entry point returns the
stable fail-closed decision `{Allowed:false, Code:"oracle_not_implemented"}`; byte/value entry points
return `nil, &ContractError{Code:"oracle_not_implemented"}`. Both paths parse enough input to prove
that the intended subject and committed fixture were reached. R1 tests require the correct allow/deny
or canonical-byte result from at least one positive and one negative case, so RED is behavioral. R1
must not fail because a package, symbol, fixture, import, syntax, toolchain, cache, or network
dependency is missing.

Every required surface has one future owner and exact focused test:

| Surface | Owner / implementation path | Exact test |
|---|---|---|
| scaffold/stable errors | true-Sub Oracle contract owner; `api.go` | `TestOracleContractScaffold` |
| strict JSON | true-Sub Oracle contract owner; `strictjson.go` | `TestOracleContractStrictJSON` |
| JCS | true-Sub Oracle contract owner; `canonical.go` | `TestOracleContractJCS` |
| path/query/authority normalization | true-Sub Oracle contract owner; `canonical.go` | `TestOracleContractNormalization` |
| deterministic CBOR/frame | true-Sub Oracle contract owner; `cbor.go` | `TestOracleContractCBOR` |
| Draft 2020-12 subset | true-Sub Oracle contract owner; `schema.go` | `TestOracleContractSchema` |
| coherence admission | true-Sub Oracle contract owner; `admission.go` | `TestOracleContractAdmission` |
| manifest/checkpoint/rotation/revocation | true-Sub Oracle contract owner; `authority.go` | `TestOracleContractManifestAuthority` |
| readiness/lifecycle/lineage/outcome | true-Sub Oracle contract owner; `interface.go` | `TestOracleContractInterface` |
| replay reserve/commit/expire/revoke | true-Sub Oracle contract owner; `interface.go` | `TestOracleContractReplay` |
| sidecar schema/capability | true-Sub Oracle contract owner; `sidecar.go` | `TestOracleContractSidecar` |
| generic mutations | true-Sub Oracle contract owner; `mutation.go` | `TestOracleContractMutation` |
| mirror/record agreement | cross-repository contract owner; `crossrepo.go` | `TestOracleContractCrossRepo` |

Each test contributes ordered result rows for every owned frozen case plus at least one allow and one
deny control. The union of those row IDs must equal the required case set before any digest is formed.

### 6.2 Strict JSON and JCS

`ParseStrictJSON` accepts only fatal UTF-8 and exactly one JSON value. It rejects a BOM, malformed
syntax, trailing non-whitespace data, duplicate keys at any depth, unescaped controls, lone UTF-16
surrogates in keys or values, negative zero, non-finite values, and integral values outside
`[-9007199254740991, 9007199254740991]`. Duplicate detection happens before map materialization.

`CanonicalizeValue` first applies the same I-JSON checks, then emits RFC 8785 JCS: UTF-8, minimal
JSON escapes, ECMAScript number serialization, and RFC 8785 property ordering. Core file comparison
uses exact raw bytes; controller records use JCS plus exactly one final LF. Digests always state which
framing applies and cover exact bytes. No Unicode normalization is added.

The exhaustive JSON/JCS denial precedence is `json_invalid_utf8`, `json_duplicate_key`,
`json_lone_surrogate`, `json_trailing_data`, `json_invalid`, `json_type_invalid`,
`json_number_invalid`, `json_negative_zero`, `json_number_unsafe`, then
`json_canonicalization_failed`. The first applicable code in that order is returned.
`json_type_invalid` is limited to a Go value outside the JSON data model before serialization;
`json_number_invalid` is limited to a numeric value or valid numeric token that is non-finite or
cannot be represented by the required finite ECMAScript-number domain, excluding the separately
classified negative-zero and safe-integer cases. Exact controls include an unsupported Go value ->
`json_type_invalid`, `1e400` -> `json_number_invalid`, `-0` -> `json_negative_zero`, and
`9007199254740992` -> `json_number_unsafe`. Diagnostics are bounded to a 200-byte safe field and
never echo source values.

### 6.3 Schema behavior

The schema loader opens only the exact mirror `contract.schema.json`, verifies its digest, and rejects
all remote or non-fragment `$ref` values. It supports the keywords used by the frozen Draft 2020-12
schema: `$defs`, local `$ref`, `oneOf` with exactly one match, `type`, `const`, `enum`, `required`,
`properties`, `additionalProperties:false`, `items`, `minItems`, `maxItems`, `uniqueItems`,
`minLength`, `maxLength`, `pattern`, `minimum`, and `maximum`. An unknown assertion keyword,
unresolved ref, recursive resource overflow, or schema mutation denies instead of being ignored.

Limits are 1 MiB per JSON input, 256 nesting levels, 65,536 aggregate object members and array
items, 4,096 schema nodes, 4,096 array items at any JSON Pointer operation, and 8 KiB per string.
Schema failures return `contract_schema_invalid`; unsupported keyword/ref returns
`contract_schema_keyword_unsupported`; version/range disagreement returns
`contract_schema_range_mismatch`.

### 6.4 Admission behavior and decision precedence

Admission exactly preserves this order:

1. validate the full Behavior Coherence Certificate schema, including unknown-field denial;
2. compare `manifest_payload_digest` to JCS SHA-256 over certificate, signals, and negative
   capabilities;
3. compare generation fields in order `proxy`, `credential`, `profile`, `sidecar_protocol`,
   `replay_ledger`; lower is `admission_downgrade`, unequal higher is `admission_tuple_mismatch`;
4. compare exact contract, manifest, package artifact, and package version fields;
5. deny any selected model, beta token, transport, entrypoint, fallback, feature combination, or
   authority state in the negative-capability sets;
6. iterate gates in order `wire`, `semantic`, `state_sequence`, `failure_semantics`; for each gate,
   first evaluate its status (`fail`, `unsupported`, `unobserved`), then immediately evaluate only
   that gate's referenced signal in order missing signal, open/declared contradiction, expiry,
   invalidated dependency, insufficient authority rank, server-dependent fact with local scope, and
   negative authority state; do not inspect the next gate until both checks pass;
7. only after all four status/signal pairs pass, return `admission_allow` and invoke any allowed
   callback exactly once.

The 14 coherence corpus cases are the minimum acceptance matrix. Removing a required signal,
negative set, tuple field, or gate cannot create allow.

Multi-fault precedence fixtures are mandatory: `wire` contradiction plus `semantic` fail returns
`admission_authority_contradicted`; `wire` pass plus expired `wire` signal plus `semantic` fail returns
`admission_authority_expired`; `wire` pass/signal pass plus `semantic` fail plus later missing signal
returns `admission_gate_failed`. Equivalent mutations cover each adjacent gate boundary.

### 6.5 Manifest authority and cross-project behavior

JCS signatures use exact domain prefixes `oracle-manifest-v1\0`, `oracle-checkpoint-v1\0`,
`oracle-root-rotation-v1\0`, and `oracle-revocation-v1\0`. Only Ed25519, matching role/epoch, unique
signer IDs, non-revoked keys, and thresholds `1..64` are accepted. Key and signature sets are capped
at 64; manifest canonical bytes are capped at 1 MiB.

Manifest update precedence is clock rollback, replica generation, resource limit, manifest
threshold, expiry, parent/rollback lineage, invalidated dependencies, checkpoint threshold,
checkpoint monotonicity/age/expiry, manifest/checkpoint mix-and-match, witness mismatch, and split
view. Root rotation requires both old and new root thresholds. Emergency revocation requires a newer,
unexpired, threshold-signed record and a unique nonempty known-key set. The 21 authority cases and
their exact next-state digests are mandatory.

Readiness, lifecycle CAS, task lineage, outcome/retry ownership, and replay decisions consume all 16
interface cases. Exact schema major/revision, generations, contract/manifest digests, deadlines,
lineage, terminal/side-effect facts, and replica generations fail closed with the existing stable
interface/replay codes.

### 6.6 Mutation execution and JSON Pointer bounds

Each mutation descriptor has exact keys:

```json mutation-descriptor-schema
{"$defs":{"addFile":{"additionalProperties":false,"properties":{"bytes_base64":{"pattern":"^[A-Za-z0-9+/]*={0,2}$","type":"string"},"kind":{"const":"add_file"},"mode":{"maximum":511,"minimum":0,"type":"integer"},"path":{"$ref":"#/$defs/relativePath"}},"required":["kind","path","bytes_base64","mode"],"type":"object"},"expected":{"additionalProperties":false,"properties":{"allowed":{"type":"boolean"},"code":{"$ref":"#/$defs/safeRef"}},"required":["allowed","code"],"type":"object"},"pointer":{"maxLength":8192,"type":"string"},"relativePath":{"maxLength":240,"minLength":1,"pattern":"^(?!/)(?!.*(?:^|/)\\.\\.?(?:/|$))(?!.*\\\\)[A-Za-z0-9._/-]+$","type":"string"},"removeFile":{"additionalProperties":false,"properties":{"kind":{"const":"remove_file"},"path":{"$ref":"#/$defs/relativePath"}},"required":["kind","path"],"type":"object"},"removePointer":{"additionalProperties":false,"properties":{"kind":{"const":"remove_pointer"},"pointer":{"$ref":"#/$defs/pointer"}},"required":["kind","pointer"],"type":"object"},"replaceBytes":{"additionalProperties":false,"properties":{"bytes_base64":{"pattern":"^[A-Za-z0-9+/]*={0,2}$","type":"string"},"delete_count":{"maximum":1048576,"minimum":0,"type":"integer"},"kind":{"const":"replace_bytes"},"offset":{"maximum":1048576,"minimum":0,"type":"integer"}},"required":["kind","offset","delete_count","bytes_base64"],"type":"object"},"replaceWithSymlink":{"additionalProperties":false,"properties":{"kind":{"const":"replace_with_symlink"},"path":{"$ref":"#/$defs/relativePath"},"target":{"$ref":"#/$defs/relativePath"}},"required":["kind","path","target"],"type":"object"},"safeRef":{"maxLength":200,"minLength":1,"pattern":"^[A-Za-z0-9._:/-]+$","type":"string"},"setPointer":{"additionalProperties":false,"properties":{"kind":{"const":"set_pointer"},"pointer":{"$ref":"#/$defs/pointer"},"value":true},"required":["kind","pointer","value"],"type":"object"},"sha256":{"pattern":"^[0-9a-f]{64}$","type":"string"},"source":{"additionalProperties":false,"properties":{"relative_path":{"$ref":"#/$defs/relativePath"},"sha256":{"$ref":"#/$defs/sha256"}},"required":["relative_path","sha256"],"type":"object"}},"$id":"https://oracle-lab.invalid/rebaseline/mutation-case.v1.schema.json","$schema":"https://json-schema.org/draft/2020-12/schema","additionalProperties":false,"properties":{"case_id":{"$ref":"#/$defs/safeRef"},"expected":{"$ref":"#/$defs/expected"},"operation":{"oneOf":[{"$ref":"#/$defs/removePointer"},{"$ref":"#/$defs/setPointer"},{"$ref":"#/$defs/replaceBytes"},{"$ref":"#/$defs/removeFile"},{"$ref":"#/$defs/addFile"},{"$ref":"#/$defs/replaceWithSymlink"}]},"source":{"$ref":"#/$defs/source"},"subject":{"enum":["strict_json","jcs","normalization","cbor","schema","admission","authority","interface","replay","sidecar","mirror","authority_record"]}},"required":["case_id","subject","source","operation","expected"],"type":"object"}
```

The executor opens and digest-validates the declared committed source as a regular non-symlink file,
reads at most cap plus one byte, applies the declared operation generically to an in-memory copy or a
bounded virtual file-set overlay, invokes the independent subject validator, and derives
`MutationResult.Allowed` and `Code` from that validator. It never switches on `case_id`, consults the
expected result before execution, or hard-codes all rows to deny. A positive identity/no-op control
must return the subject's allow code; an all-deny result set returns `mutation_executor_unexercised`.

`replace_bytes` decodes canonical RFC 4648 base64 without whitespace, requires offset and
`offset+delete_count` within source bounds without overflow, and splices decoded bytes. `add_file`
adds one regular virtual-overlay entry at an absent relative path with exact bytes and non-executable
mode. `remove_file` requires and removes one existing virtual entry. `replace_with_symlink` replaces
one existing virtual entry with a non-followed symlink whose relative target remains lexically inside
the overlay; the mirror/source validator must then deny it. File operations never mutate disk.

JSON Pointer decoding accepts root `""` and slash-prefixed segments only, decodes only `~0` and
`~1`, and rejects malformed escapes. Array indices reject empty, signs, nondigits, leading zeros
except `0`, and `-`; accumulation checks `value > (4096-digit)/10` before multiplication. Values over
`4096` deny before conversion to `int`. Access requires `index < length`; add-at-end requires
`index <= length`, compared before conversion. Pointer/overflow failures are
`mutation_pointer_invalid`; source/path/type/digest/cap failures are `mutation_source_invalid`.

Required overflow fixtures are `18446744073709551616`, `9223372036854775808`, `4097`, one thousand
digits of `9`, `-1`, `+1`, `01`, empty, nondigit, and malformed `~` escapes. Required execution
mutations cover every frozen JSON/JCS rejection, missing/unknown schema fields, every coherence and
authority denial family, mirror missing/extra/reordered/symlink/digest/predecessor changes, omission
of a required set member, and diagnostic-to-normative promotion.

### 6.7 Source provenance, required sets, and leak families

Authority comes from frozen package constants and verified mirror/index bytes, never from a caller's
`required` list. Exact required sets are: nine mirror entries; eight index entries in byte-name order;
one predecessor binding; all 9 JSON, 5 CBOR, and normalization cases; 21 authority, 14 coherence,
16 interface/replay cases, the unsigned sidecar canonical result, every sidecar capability/replay
case in its focused test, the stable code registry; and all declared mutation cases. Missing, extra,
duplicate, reordered, consistently omitted, disabled, or caller-redefined members deny.

Every source binding contains a POSIX relative path, expected kind, byte cap, exact size, mode class
`regular_non_executable`, and SHA-256. Absolute, backslash, empty, dot, traversal, hard-link,
symlink-component, final symlink, executable, size/cap, before/after-stat, or digest drift denies.
No diagnostic absolute worktree path enters source provenance.

The exhaustive leak families are:

| Family | Exact detector |
|---|---|
| `credential_like` | normalized key in `authorization,proxy_authorization,x_api_key,api_key,anthropic_api_key,access_token,refresh_token,password,cookie,set_cookie`, or a Bearer/Basic credential or PEM private-key opener in a value |
| `raw_material_key` | normalized key in `prompt,body,request_body,response_body,raw,raw_bytes,raw_material,client_hello,cch,credential,credentials,secret,private_key,session_id,conversation_id,message_id` |
| `absolute_path` | POSIX machine prefixes `/Users/`, `/home/`, `/var/folders/`, drive-letter roots, or UNC roots; protocol paths such as `/v1/messages` are excluded |
| `symlink` | any source component or final source is an `Lstat` symlink |
| `mode_mismatch` | source is executable or violates its manifest mode class |
| `size_overflow` | read observes more than the per-file cap or declared size |

Scanner output contains only family, safe relative source ref, and JSON Pointer; it never includes the
matched value. Any finding returns `leak_detected`. Unknown leak family is
`contract_required_set_mismatch`, not ignored.

## 7. Coverage Before Commit DAG

Coverage is frozen before commit scheduling so the DAG cannot define away a requirement.

| Requirement / risk | Planned files and symbols | Positive proof | Mandatory negative proof | Gate |
|---|---|---|---|---|
| `HA-P0-001` authority/traceability | Sub plan, controller authority, `CrossRepoRecord` | exact selected refs, commits, trees, content digests, 24-hour lease | stale head/tree/content, dirty tracked state, diagnostic promotion | Mandatory Entry |
| `HA-P0-006` shared predecessor | mirror, `InspectMirror`, `ValidateContractIndex` | nine exact bytes and `70c26d...` predecessor | missing/extra/reorder/symlink/digest/predecessor drift | GREEN + cross-repo |
| `HA-P0-009` fail closed | all decision functions | known valid controls allow | missing/unknown/unsupported/incoherent inputs deny | R1 behavioral RED then GREEN |
| `RA-P0-005` versioned contract | schema/JCS/admission/interface | range `1:0-0`, identical bytes/decisions | major/revision/unknown field/downgrade | exact-head review |
| `RA-P0-001` deterministic compiler boundary | mutation executor/result artifact | two isolated executions produce identical JCS result digest | ID dispatch, expected lookup, all-deny, input reorder | cross-repo integration |
| strict JSON/JCS | `strictjson.go`, `canonical.go` | frozen positive corpus | UTF-8, duplicate, surrogate, -0, unsafe int, trailing, ordering | focused test |
| schema/admission | `schema.go`, `admission.go` | valid certificate allows once | required/unknown/gate/tuple/negative/signal mutations | focused test |
| authority/interface | `authority.go`, cross-project decisions | 4 authority allows and valid interface transitions | every frozen deny class | focused test |
| normalization/CBOR | `canonical.go`, `cbor.go`; normalization and five CBOR cases | ordered query/authority and deterministic CBOR match CC | malformed path/host/port, duplicate/indefinite/float/trailing CBOR | focused test |
| interface/replay | `interface.go`; all 16 interface rows | readiness/lifecycle/lineage and reserve/commit allow | stale/mismatch/deadline/reuse/replica conflicts | focused test |
| sidecar | `sidecar.go`; unsigned canonical result and sidecar capability decisions | valid schema/key/epoch/signature/expiry path | decode/schema/key-role/reuse/revoked/signature/expiry mutations | focused test |
| source/leak safety | `crossrepo.go`, mutation fixtures | bounded clean regular files | traversal, link, mode, cap, six leak families | focused test |
| protected boundary | CodeGraph config and command allowlist | protected file/node `0/0` | any protected count/access or service selector | stop |

No DAG node may proceed until every row has an owner, file, symbol, positive control, negative control,
stable code, and focused command.

## 8. Serial Cross-Repository DAG and Authority Boundaries

```json serial-dag
{"edges":[["C0","S0"],["S0","S1"],["S1","R1"],["R1","I1"],["I1","SR"],["SR","C1"],["C1","CR"]],"nodes":[{"id":"C0","role":"merge-this-cc-docs-amendment"},{"id":"S0","role":"fresh-true-sub-mandatory-entry-and-docs-plan"},{"id":"S1","role":"independent-review-and-merge-true-sub-docs-plan"},{"id":"R1","role":"compileable-fail-closed-behavioral-red-scaffold"},{"id":"I1","role":"single-implementation-wave"},{"id":"SR","role":"independent-exact-head-true-sub-review"},{"id":"C1","role":"cc-checker-integration"},{"id":"CR","role":"cross-repo-exact-head-review-and-controller-decision"}]}
```

The order is strictly serial:

1. review and merge this CC docs-only amendment; its merge authorizes only creation of S0;
2. create a separate true-Sub docs-only plan from exact `3ac410e/f7d51fb`, review it, and merge it;
3. only then issue a fresh implementation controller authority and create R1/I1;
4. independently review exact I1 head/tree and the complete range from the frozen true-Sub base;
5. only after `0C/0I` integrate CC checker changes at C1;
6. run exact cross-repo review and return a controller decision. No node implies merge/promotion of the
   next node.

This task must not create S0, a true-Sub worktree, a Sub branch, R1, I1, checker code, test code,
fixtures, or records.

## 9. Future True-Sub Mandatory Entry and Execution Authority

S0 must create a fresh planning worktree from the exact selected local ref and stop if the ref no
longer resolves `3ac410e/f7d51fb`. It must freshly freeze repository realpath/common-dir, clean tracked
state, selected remote name+URL/ref/OID, selected local ref/OID, commit/tree/parent, module digests,
predecessor digest, Go directive/runtime, and the CC amendment merge commit/tree/blob digest.

Because no current remote ref is source authority for `3ac410e`, S0 must either identify a reviewed
remote/ref that resolves the exact OID or obtain a new total-controller decision explicitly allowing
the local selected ref. It must not substitute `origin/main`, `muqihang/main`, or a moving branch.

Before any CodeGraph init/sync, S0 installs the exact 91-byte config from Section 2.3, verifies its
SHA-256, and only then initializes or synchronizes its own worktree-local index. It gates on CLI
`1.1.6`, extraction `24`, root equality, pending zero, mismatch null, reindex false, and protected
file/node `0/0`. Counts are recorded only in a diagnostic snapshot. Any ambiguity or mismatch stops.

After S1 merges, the fresh implementation authority is a canonical controller record with a
24-hour lease. It binds exact base/plan merge identities, allowed paths, R1/I1 parent relations,
reviewer/model, focused command, environment/cache roots, egress `0`, protected `0`, and prohibited
surfaces. It excludes all diagnostic fields listed in Section 3. Expiry, drift, extra paths/commits,
or command deviation ends the authority; a new controller decision is required.

## 10. Exact RED, GREEN, and Review Gates

### 10.1 R1 behavioral RED

R1 contains the complete package scaffold, mirror, synthetic source manifest/fixtures, mutation
descriptors, and tests. The exact command compiles and runs all named tests. It must fail only because
valid controls receive `oracle_not_implemented` or another declared wrong decision. Required R1
failures include: valid JCS control not accepted, valid certificate not admitted, valid authority
update not allowed, positive mutation no-op not allowed, and valid mirror not accepted. Required
negative controls already fail closed and must not panic.

The RED log binds parent head/tree, R1 head/tree, command/env digest, named failing subtests, exit code,
and proof that no failure contains missing package/symbol/fixture, syntax/import, cache, module,
toolchain, network, protected, service, or setup language.

### 10.2 I1 GREEN

I1 is one consolidated implementation commit and may change only the Section 6.1 package files;
R1 mirror/source/mutation fixture bytes remain identical. It executes subjects independently,
matches every frozen corpus result, produces deterministic mutation results twice, and leaves module
digests unchanged. There is no second implementation or fix wave before exact-head review.

### 10.3 Exact Sub command and environment

From `backend/` only:

```sh
env -i \
  HOME="$RUN_ROOT/home" PATH="$PINNED_PATH" TMPDIR="$RUN_ROOT/tmp" \
  GOCACHE="$RUN_ROOT/go-build" GOMODCACHE="$RUN_ROOT/go-mod-empty" \
  GOTMPDIR="$RUN_ROOT/go-tmp" GOENV=off GOTOOLCHAIN=local CGO_ENABLED=0 \
  GOPROXY=off GOSUMDB=off \
  go test ./internal/oracleevidence \
    -run '^TestOracleContract(Scaffold|StrictJSON|JCS|Normalization|CBOR|Schema|Admission|ManifestAuthority|Interface|Replay|Sidecar|Mutation|CrossRepo)$' \
    -count=1
```

The authority pre-creates the declared controller-owned cache/temp directories, proves they are empty
before R1, and allows writes only there. The package imports standard library and itself only, so an
empty `GOMODCACHE` is sufficient. DNS and external socket budget is zero. `go test ./...`, package-wide
Go, `go test ./internal/service`, any service selector, build, vet, race, coverage, wrapper, or implicit
package discovery is forbidden.

### 10.4 Exact CC checker integration

C1 may modify only:

- `tools/oracle-contract/check-shared-contract.ts`;
- `tools/oracle-contract/check-cross-repo.ts`;
- `tests/oracle-contract-shared-bundle.test.ts`;
- `tests/oracle-contract-cross-repo.test.ts`.

It changes the mirror root to
`backend/internal/oracleevidence/testdata/oracle_lab_contract/v1`, invokes only the exact Sub command
above, validates the normative record/schema/DAG, and rejects diagnostic promotion. The stale
`tools/oracle-contract/sync-shared-contract.ts` is out of scope and must not run. The checker never
uses `./internal/service`.

The exact focused CC tests are:

```sh
env npm_config_offline=true node --import tsx tests/oracle-contract-canonical.test.ts
env npm_config_offline=true node --import tsx tests/oracle-contract-admission.test.ts
env npm_config_offline=true node --import tsx tests/oracle-contract-manifest-authority.test.ts
env npm_config_offline=true node --import tsx tests/oracle-contract-cross-project.test.ts
env npm_config_offline=true node --import tsx tests/oracle-contract-sidecar-envelope.test.ts
env npm_config_offline=true node --import tsx tests/oracle-contract-shared-bundle.test.ts
env npm_config_offline=true node --import tsx tests/oracle-contract-cross-repo.test.ts
```

Dependencies must already exist and be digest-bound. No `npm install`, network fallback, broad test
runner, sidecar Go, product test, target/evidence command, or service compile is authorized.

### 10.5 Reviewer gates

SR is one independent `gpt-5.6-sol` holistic exact-head review of base..I1, including actual symbols,
call paths, fixtures, RED/GREEN causality, module hashes, CodeGraph gates, protected/egress accounting,
and all coverage rows. `0C/0I` is required. A C/I makes the implementation `PLAN_BLOCKED` and requires
new authority; this amendment grants no implementation repair loop.

CR independently reviews the C1 exact head and cross-repository result. It may conclude only
`cross_repo_contract_agreement=true|false`. It cannot claim Phase 3B usable, product readiness,
target behavior, upstream equivalence, Phase 4 authority, or production readiness.

## 11. Cross-Repository Record, Digest Agreement, and No-Hash-Cycle DAG

The cross-repository conformance record is a controller-owned artifact outside both repositories. It
is not target/evidence material and contains no raw payload, credential, absolute path, or diagnostic
snapshot. Its exact top-level schema is:

```json cross-repo-record-schema
{"$defs":{"authority":{"additionalProperties":false,"properties":{"cc":{"$ref":"#/$defs/ccAuthority"},"command_id":{"$ref":"#/$defs/safeRef"},"reviewer_model":{"const":"gpt-5.6-sol"},"sub":{"$ref":"#/$defs/subAuthority"}},"required":["cc","sub","command_id","reviewer_model"],"type":"object"},"bundle":{"additionalProperties":false,"properties":{"contract_index_sha256":{"const":"2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce"},"files":{"items":{"$ref":"#/$defs/fileBinding"},"maxItems":9,"minItems":9,"type":"array","uniqueItems":true},"framing":{"const":"core-raw-exact;record-jcs-final-lf"},"mirror_root":{"const":"backend/internal/oracleevidence/testdata/oracle_lab_contract/v1"},"predecessor_sha256":{"const":"70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1"},"schema_range":{"const":"1:0-0"}},"required":["files","contract_index_sha256","predecessor_sha256","schema_range","mirror_root","framing"],"type":"object"},"ccAuthority":{"additionalProperties":false,"properties":{"amendment_sha256":{"$ref":"#/$defs/sha256"},"commit":{"$ref":"#/$defs/sha256"},"repository_url":{"const":"https://github.com/muqihang/cc-gateway.git"},"selected_remote_name":{"const":"muqihang"},"selected_remote_oid":{"$ref":"#/$defs/sha256"},"selected_remote_ref":{"const":"refs/remotes/muqihang/main"},"tree":{"$ref":"#/$defs/sha256"}},"required":["repository_url","selected_remote_name","selected_remote_ref","selected_remote_oid","commit","tree","amendment_sha256"],"type":"object"},"commitDag":{"additionalProperties":false,"properties":{"edges":{"items":{"items":{"$ref":"#/$defs/safeRef"},"maxItems":2,"minItems":2,"type":"array"},"minItems":7,"type":"array"},"nodes":{"items":{"$ref":"#/$defs/dagNode"},"maxItems":8,"minItems":8,"type":"array"}},"required":["nodes","edges"],"type":"object"},"dagNode":{"additionalProperties":false,"properties":{"head":{"oneOf":[{"$ref":"#/$defs/sha256"},{"type":"null"}]},"id":{"enum":["C0","S0","S1","R1","I1","SR","C1","CR"]},"parent_ids":{"items":{"$ref":"#/$defs/safeRef"},"maxItems":2,"type":"array","uniqueItems":true},"role":{"$ref":"#/$defs/safeRef"},"tree":{"oneOf":[{"$ref":"#/$defs/sha256"},{"type":"null"}]}},"required":["id","role","parent_ids","head","tree"],"type":"object"},"decisionRow":{"additionalProperties":false,"properties":{"allowed":{"type":"boolean"},"canonical_hex":{"oneOf":[{"pattern":"^(?:[0-9a-f]{2})*$","type":"string"},{"type":"null"}]},"case_id":{"$ref":"#/$defs/safeRef"},"code":{"$ref":"#/$defs/stableCode"},"next_state_digest":{"oneOf":[{"$ref":"#/$defs/sha256"},{"type":"null"}]}},"required":["case_id","allowed","code","next_state_digest","canonical_hex"],"type":"object"},"fileBinding":{"additionalProperties":false,"properties":{"relative_path":{"enum":["authority-corpus.json","canonicalization-corpus.json","coherence-corpus.json","contract-index.json","contract.schema.json","expected-results.json","interface-corpus.json","sidecar-envelope.cddl","sidecar-envelope.schema.json"]},"sha256":{"$ref":"#/$defs/sha256"}},"required":["relative_path","sha256"],"type":"object"},"result":{"additionalProperties":false,"properties":{"case_rows":{"items":{"$ref":"#/$defs/decisionRow"},"minItems":1,"type":"array"},"command_ids":{"items":{"$ref":"#/$defs/safeRef"},"minItems":2,"type":"array","uniqueItems":true},"decisions_sha256":{"$ref":"#/$defs/sha256"},"egress_count":{"const":0},"mutation_results_sha256":{"$ref":"#/$defs/sha256"},"mutation_rows":{"items":{"$ref":"#/$defs/decisionRow"},"minItems":1,"type":"array"},"protected_file_count":{"const":0},"protected_node_count":{"const":0},"required_set_sha256":{"$ref":"#/$defs/sha256"},"semantic_surfaces":{"additionalProperties":false,"properties":{"admission":{"const":true},"authority":{"const":true},"cbor":{"const":true},"interface":{"const":true},"jcs":{"const":true},"normalization":{"const":true},"replay":{"const":true},"schema":{"const":true},"sidecar":{"const":true},"strict_json":{"const":true}},"required":["strict_json","jcs","normalization","cbor","schema","admission","authority","interface","replay","sidecar"],"type":"object"},"stable_code_set_sha256":{"const":"f6f89d48519aaa46b362a474cc6bd8e470b638e1c7f4c3c0a7ac99413a85fa5c"},"stable_code_count":{"const":119}},"required":["case_rows","mutation_rows","decisions_sha256","mutation_results_sha256","required_set_sha256","stable_code_count","stable_code_set_sha256","semantic_surfaces","protected_file_count","protected_node_count","egress_count","command_ids"],"type":"object"},"review":{"additionalProperties":false,"properties":{"cross":{"$ref":"#/$defs/reviewItem"},"sub":{"$ref":"#/$defs/reviewItem"}},"required":["sub","cross"],"type":"object"},"reviewItem":{"additionalProperties":false,"properties":{"artifact_sha256":{"$ref":"#/$defs/sha256"},"critical":{"const":0},"important":{"const":0},"model":{"const":"gpt-5.6-sol"},"task_id":{"$ref":"#/$defs/safeRef"},"verdict":{"enum":["PLAN_REVIEW_PASS","CROSS_REPO_PASS"]}},"required":["task_id","model","artifact_sha256","critical","important","verdict"],"type":"object"},"safeRef":{"maxLength":200,"minLength":1,"pattern":"^[A-Za-z0-9._:/-]+$","type":"string"},"sha256":{"pattern":"^[0-9a-f]{64}$","type":"string"},"subAuthority":{"additionalProperties":false,"properties":{"repository_url":{"const":"https://github.com/Wei-Shaw/sub2api.git"},"selected_local_ref":{"const":"refs/heads/codex/native-search-gateway"},"selected_local_oid":{"const":"3ac410ea02edc53c3925f28eddcbc22b51c0a137"},"commit":{"const":"3ac410ea02edc53c3925f28eddcbc22b51c0a137"},"tree":{"const":"f7d51fb57c64fbaf6e2db3a7a2d423a491d5788d"},"parent":{"const":"04e42ae0f6c556daad21ac393eb284585092e805"},"ancestor":{"const":"fc0b1989d7ba9ce06ff151b17c94b50df4170a93"},"go_mod_sha256":{"const":"e637999a38f974c9172c8f69c8fbb9c0d727bacf257558307e97e927cbb468de"},"go_sum_sha256":{"const":"d3e1fd1510b41f218136b719fdf2c4ef239b05650d3b575fb93c18f25f3dc981"},"go_directive":{"const":"1.26.5"},"predecessor_relative_path":{"const":"backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json"},"predecessor_sha256":{"const":"70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1"},"codegraph_config_sha256":{"const":"a7f3ad7c17d655f9d2494b5b05e55ceb4ea9c7667456ff785c5f2a9291c3783a"},"codegraph_version":{"const":"1.1.6"},"codegraph_extraction_revision":{"const":24},"selection":{"$ref":"#/$defs/subSelection"},"sub_plan_commit":{"$ref":"#/$defs/sha256"},"sub_plan_tree":{"$ref":"#/$defs/sha256"},"sub_plan_sha256":{"$ref":"#/$defs/sha256"},"r1_commit":{"$ref":"#/$defs/sha256"},"r1_tree":{"$ref":"#/$defs/sha256"},"i1_commit":{"$ref":"#/$defs/sha256"},"i1_tree":{"$ref":"#/$defs/sha256"}},"required":["repository_url","selected_local_ref","selected_local_oid","commit","tree","parent","ancestor","go_mod_sha256","go_sum_sha256","go_directive","predecessor_relative_path","predecessor_sha256","codegraph_config_sha256","codegraph_version","codegraph_extraction_revision","selection","sub_plan_commit","sub_plan_tree","sub_plan_sha256","r1_commit","r1_tree","i1_commit","i1_tree"],"type":"object"},"stableCode":{"type":"string","enum":["admission_allow","admission_authority_contradicted","admission_authority_expired","admission_authority_insufficient","admission_dependency_invalidated","admission_downgrade","admission_gate_failed","admission_gate_unobserved","admission_gate_unsupported","admission_manifest_payload_mismatch","admission_negative_capability","admission_schema_invalid","admission_tuple_mismatch","authority_allow","authority_checkpoint_stale","authority_clock_rollback","authority_dependency_invalidated","authority_diagnostic_promotion","authority_duplicate_signer","authority_expired","authority_freeze","authority_key_revoked","authority_mix_and_match","authority_parent_mismatch","authority_policy_rollback","authority_replica_conflict","authority_resource_limit","authority_revocation_invalid","authority_revocation_stale","authority_rotation_threshold","authority_signature_invalid","authority_split_view","authority_threshold_insufficient","authority_witness_mismatch","authority_wrong_role","cbor_duplicate_key","cbor_float_forbidden","cbor_frame_length","cbor_frame_truncated","cbor_indefinite_length","cbor_integer_unsafe","cbor_invalid","cbor_invalid_utf8","cbor_map_key_invalid","cbor_not_deterministic","cbor_resource_limit","cbor_simple_forbidden","cbor_tag_forbidden","cbor_trailing_data","cbor_truncated","cbor_type_invalid","cbor_undefined_forbidden","contract_bundle_missing","contract_file_digest_mismatch","contract_file_set_invalid","contract_index_not_canonical","contract_index_path_invalid","contract_index_version_invalid","contract_json_invalid","contract_mirror_mismatch","contract_predecessor_mismatch","contract_required_set_mismatch","contract_schema_invalid","contract_schema_keyword_unsupported","contract_schema_range_mismatch","contract_symlink","cross_repo_binding_mismatch","cross_repo_record_expired","cross_repo_result_mismatch","interface_allow","interface_contract_mismatch","interface_deadline_expired","interface_gateway_retry","interface_generation_mismatch","interface_generation_regression","interface_lineage_mismatch","interface_migration_stale","interface_not_ready","interface_owner_mismatch","interface_schema_unsupported","interface_stale_state","interface_state_transition_invalid","interface_sub2api_retry","interface_terminal_no_retry","json_canonicalization_failed","json_duplicate_key","json_invalid","json_invalid_utf8","json_lone_surrogate","json_negative_zero","json_number_invalid","json_number_unsafe","json_trailing_data","json_type_invalid","leak_detected","mutation_descriptor_invalid","mutation_executor_unexercised","mutation_pointer_invalid","mutation_source_invalid","oracle_not_implemented","replay_committed","replay_expired","replay_rejected","replay_replica_conflict","replay_reserved","replay_revoked","sidecar_capability_allow","sidecar_capability_decode_invalid","sidecar_capability_expired","sidecar_capability_schema_invalid","sidecar_key_epoch_mismatch","sidecar_key_not_found","sidecar_key_revoked","sidecar_key_role_invalid","sidecar_key_role_reuse","sidecar_signature_invalid","url_host_invalid","url_path_invalid","url_port_invalid"]},"remoteRefSelection":{"additionalProperties":false,"properties":{"mode":{"const":"remote_ref"},"selected_remote_name":{"$ref":"#/$defs/safeRef"},"selected_remote_url":{"maxLength":2048,"minLength":1,"pattern":"^https://[^\\u0000-\\u001f\\u007f]+$","type":"string"},"selected_remote_ref":{"$ref":"#/$defs/safeRef"},"selected_remote_oid":{"const":"3ac410ea02edc53c3925f28eddcbc22b51c0a137"}},"required":["mode","selected_remote_name","selected_remote_url","selected_remote_ref","selected_remote_oid"],"type":"object"},"localOverrideSelection":{"additionalProperties":false,"properties":{"mode":{"const":"total_controller_local_override"},"selection_override_sha256":{"$ref":"#/$defs/sha256"},"selection_override_controller_id":{"$ref":"#/$defs/safeRef"},"selection_override_task_id":{"$ref":"#/$defs/safeRef"},"selection_override_issued_at_ms":{"maximum":9007199254740991,"minimum":0,"type":"integer"},"selection_override_decision":{"const":"authorize_refs/heads/codex/native-search-gateway_at_3ac410ea02edc53c3925f28eddcbc22b51c0a137"}},"required":["mode","selection_override_sha256","selection_override_controller_id","selection_override_task_id","selection_override_issued_at_ms","selection_override_decision"],"type":"object"},"subSelection":{"oneOf":[{"$ref":"#/$defs/remoteRefSelection"},{"$ref":"#/$defs/localOverrideSelection"}]}},"$id":"https://oracle-lab.invalid/rebaseline/cross-repo-record.v1.schema.json","$schema":"https://json-schema.org/draft/2020-12/schema","additionalProperties":false,"properties":{"authority":{"$ref":"#/$defs/authority"},"bundle":{"$ref":"#/$defs/bundle"},"commit_dag":{"$ref":"#/$defs/commitDag"},"expires_at_ms":{"maximum":9007199254740991,"minimum":0,"type":"integer"},"issued_at_ms":{"maximum":9007199254740991,"minimum":0,"type":"integer"},"kind":{"const":"oracle_contract_rebaseline"},"record_digest":{"$ref":"#/$defs/sha256"},"result":{"$ref":"#/$defs/result"},"review":{"$ref":"#/$defs/review"},"schema_id":{"const":"oracle.cross_repo_record"},"schema_major":{"const":1},"schema_revision":{"const":0}},"required":["schema_id","schema_major","schema_revision","kind","authority","bundle","commit_dag","result","review","issued_at_ms","expires_at_ms","record_digest"],"type":"object"}
```

The following exact constraint projection is part of the schema authority. The checker requires
equality to it after schema validation; it prevents duplicate-name/different-digest file rows,
permuted or duplicate DAG nodes, review-role swapping, and diagnostic aliases that a generic JSON
Schema keyword cannot conveniently express.

```json cross-repo-record-constraints
{"bundle_files":[{"relative_path":"authority-corpus.json","sha256":"42e89c1933f7c2b9f71dfd41d739345b3f2253f0217c6ebb2ee77b25ab94d8de"},{"relative_path":"canonicalization-corpus.json","sha256":"a2925a1c04aa90dbc42eee3045574faf829ccddaa776d75d2497558821c0ab20"},{"relative_path":"coherence-corpus.json","sha256":"85b7209d31370bd56bb4a374cf796ecabd11ee191b30e9e9a485ff65b2d03d82"},{"relative_path":"contract-index.json","sha256":"2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce"},{"relative_path":"contract.schema.json","sha256":"380c7f3db80baa2d288838f3a550c3588abd19de11627d34ae90f5d3a0add4fe"},{"relative_path":"expected-results.json","sha256":"8671744730e94e88b439f05a0e934539fe5b148b3e3dfdc1243beba9774ced44"},{"relative_path":"interface-corpus.json","sha256":"9c2f0864097911b3b9612ee5bb6a4b62e363b2152abe7bfd5ff07221a6c60dca"},{"relative_path":"sidecar-envelope.cddl","sha256":"7697364dcaa7189449e94305a4df86d8d5476078b3dee78fac2fb34ccc60905d"},{"relative_path":"sidecar-envelope.schema.json","sha256":"a9256710c040d2a018fbc42f188a59f11fc1dd9dc46ea7be89ca2294aaace003"}],"command_ids":["cc-focused-contract-suite-v1","sub-focused-oracleevidence-v1"],"diagnostic_forbidden_keys":["absolute_worktree_path","db_mtime","db_size_bytes","divergence","edge_count","file_count","full_remote_config_digest","last_indexed","node_count","remote_projection_digest","worktree_directory_mtime"],"serial_edges":[["C0","S0"],["S0","S1"],["S1","R1"],["R1","I1"],["I1","SR"],["SR","C1"],["C1","CR"]],"serial_node_order":["C0","S0","S1","R1","I1","SR","C1","CR"],"verdict_by_review_role":{"cross":"CROSS_REPO_PASS","sub":"PLAN_REVIEW_PASS"},"sub_immutable_bindings":{"ancestor":"fc0b1989d7ba9ce06ff151b17c94b50df4170a93","codegraph_config_sha256":"a7f3ad7c17d655f9d2494b5b05e55ceb4ea9c7667456ff785c5f2a9291c3783a","codegraph_extraction_revision":24,"codegraph_version":"1.1.6","commit":"3ac410ea02edc53c3925f28eddcbc22b51c0a137","go_directive":"1.26.5","go_mod_sha256":"e637999a38f974c9172c8f69c8fbb9c0d727bacf257558307e97e927cbb468de","go_sum_sha256":"d3e1fd1510b41f218136b719fdf2c4ef239b05650d3b575fb93c18f25f3dc981","parent":"04e42ae0f6c556daad21ac393eb284585092e805","predecessor_relative_path":"backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json","predecessor_sha256":"70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1","repository_url":"https://github.com/Wei-Shaw/sub2api.git","selected_local_oid":"3ac410ea02edc53c3925f28eddcbc22b51c0a137","selected_local_ref":"refs/heads/codex/native-search-gateway","tree":"f7d51fb57c64fbaf6e2db3a7a2d423a491d5788d"},"selection_branches":{"remote_ref":{"required":["mode","selected_remote_name","selected_remote_url","selected_remote_ref","selected_remote_oid"],"forbidden":["selection_override_sha256","selection_override_controller_id","selection_override_task_id","selection_override_issued_at_ms","selection_override_decision"],"oid_must_equal":"3ac410ea02edc53c3925f28eddcbc22b51c0a137"},"total_controller_local_override":{"required":["mode","selection_override_sha256","selection_override_controller_id","selection_override_task_id","selection_override_issued_at_ms","selection_override_decision"],"forbidden":["selected_remote_name","selected_remote_url","selected_remote_ref","selected_remote_oid"],"digest_rule":"SHA-256 of exact reviewed controller decision artifact bytes; equality required","decision_const":"authorize_refs/heads/codex/native-search-gateway_at_3ac410ea02edc53c3925f28eddcbc22b51c0a137"}},"stable_code_binding":{"count":119,"union_jcs_sha256":"f6f89d48519aaa46b362a474cc6bd8e470b638e1c7f4c3c0a7ac99413a85fa5c","equality_surfaces":["schema.$defs.stableCode.enum","stable-code-set.union","Sub constant set","fixture expected-code set","mutation result classifier","CC checker set","cross-repo record set"]},"stage1b_negative_vectors":[{"id":"wrong-sub-commit","pointer":"/authority/sub/commit","replacement":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","expected_code":"contract_schema_invalid"},{"id":"wrong-sub-tree","pointer":"/authority/sub/tree","replacement":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","expected_code":"contract_schema_invalid"},{"id":"wrong-go-mod","pointer":"/authority/sub/go_mod_sha256","replacement":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","expected_code":"contract_schema_invalid"},{"id":"wrong-go-sum","pointer":"/authority/sub/go_sum_sha256","replacement":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","expected_code":"contract_schema_invalid"},{"id":"wrong-predecessor-blob","pointer":"/authority/sub/predecessor_sha256","replacement":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","expected_code":"contract_schema_invalid"},{"id":"wrong-selected-ref","pointer":"/authority/sub/selected_local_ref","replacement":"refs/heads/main","expected_code":"contract_schema_invalid"},{"id":"enabled-null-override-digest","pointer":"/authority/sub/selection/selection_override_sha256","replacement":null,"selection_mode":"total_controller_local_override","expected_code":"contract_schema_invalid"},{"id":"disabled-present-override-digest","pointer":"/authority/sub/selection/selection_override_sha256","replacement":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","selection_mode":"remote_ref","expected_code":"contract_schema_invalid"},{"id":"unknown-sub-field","pointer":"/authority/sub/unexpected","replacement":true,"expected_code":"contract_schema_invalid"}],"stage1b_static_red_assertions":[{"id":"B1-prevalidated-port","mutation":"replace FormatAuthority(host string, rawPort RawPort) with FormatAuthority(host string, port uint16)","expected":"reject_unrepresentable_raw_port_domain"},{"id":"B2-frozen-binding-substitution","mutation":"replace any sub_immutable_bindings value or accept any stage1b_negative_vectors row","expected":"reject_closed_schema_or_vector_failure"},{"id":"B3-procedure-ambiguity","mutation":"remove or alter any diagnostic-snapshots.procedure_contract argv, SQL, env, cwd, order, canonicalization, exit, locator, gate, or side-effect field","expected":"reject_procedure_contract_mismatch"},{"id":"B4-code-set-divergence","mutation":"remove json_number_invalid or json_type_invalid, or make stable-code-set.union differ from schema.$defs.stableCode.enum/count/digest","expected":"reject_contract_required_set_mismatch"}]}
```

Required nested bindings are:

- `authority`: CC amendment merge commit/tree/blob SHA, true-Sub base/ref/commit/tree/parent, S1 merge
  commit/tree/plan SHA, I1 head/tree, module digests, reviewer ID/model, lease issue/expiry;
- `bundle`: all nine file digests, contract-index digest, predecessor digest, schema range, mirror root
  relative path, strict-JCS framing;
- `commit_dag`: exact C0..CR IDs/parents and actual R1/I1/C1 heads/trees;
- `result`: ordered case IDs, decisions digest, mutation results digest, required-set digest, stable-code
  set digest, protected `0/0`, egress `0`, exact command IDs;
- `review`: SR and CR artifact digests and `0C/0I` verdicts.

Every known immutable true-Sub base, ancestry, module, predecessor, exclusion, and tool-version value
is a `const` in `subAuthority` and is duplicated exactly in `sub_immutable_bindings`; schema and
projection must be equal. `selection` is a closed `oneOf`: `remote_ref` requires the selected remote
name, URL, ref, and the exact `3ac410e...` OID and forbids every override field;
`total_controller_local_override` requires the non-null SHA-256 of the exact reviewed controller
decision artifact plus controller ID, task ID, issue time, and the constant decision string, and
forbids every remote-selection field. The checker recomputes `selection_override_sha256` from the
retained controller artifact before accepting it. Missing, null, present-in-the-wrong-branch, or
self-asserted/unretained override provenance fails schema validation. Each
`stage1b_negative_vectors` mutation is executed against an otherwise valid record and must return
`contract_schema_invalid`; accepting any row is a static-gate failure.

`expires_at_ms` is exactly `issued_at_ms + 86,400,000`. Arrays are byte-name sorted unless a decision
order is explicitly specified. The record is JCS plus one LF. `record_digest` is SHA-256 of the same
object with `record_digest` omitted, framed as JCS plus one LF.

```json digest-dag
{"edges":[["core_files","contract_index"],["contract_index","mirror_binding"],["predecessor","mirror_binding"],["mirror_binding","required_set"],["corpus_results","decision_digest"],["mutation_results","decision_digest"],["required_set","result_payload"],["decision_digest","result_payload"],["commit_identities","authority_payload"],["review_artifacts","authority_payload"],["authority_payload","record_payload"],["result_payload","record_payload"],["record_payload","record_digest"]],"isolated_diagnostic_nodes":["full_remote_projection","absolute_worktree","raw_graph_counts","db_metadata","divergence"],"nodes":["core_files","contract_index","predecessor","mirror_binding","required_set","corpus_results","mutation_results","decision_digest","commit_identities","review_artifacts","authority_payload","result_payload","record_payload","record_digest","full_remote_projection","absolute_worktree","raw_graph_counts","db_metadata","divergence"]}
```

Kahn sorting must consume every non-diagnostic node once and leave no edge. Diagnostic nodes must
have in-degree and out-degree zero and must not be properties of `authority_payload`, `result_payload`,
or `record_payload`. A static RED mutation that promotes each diagnostic field to one of those
payloads must return `authority_diagnostic_promotion`. This is the mandatory no-hash-cycle proof.

CC and Sub independently compute all leaf, result, and record digests. Byte equality of the nine-file
mirror, per-case `(id, allowed, code, next_state_digest?)` JCS rows, mutation rows, required sets, and
final record digest is required. A shared implementation, one process calling both languages, or a
checker copying one side's digest to the other is not agreement.

## 12. Stable Codes and Failure Ownership

There is one authoritative stable-code set. It is the sorted unique union of: (A) the exact 57
strings in `expected-results.json` at SHA-256 `867174...`; (B) the exact preserved CC source/result
additions below; and (C) the exact rebaseline wrappers below. JCS of the sorted 119-string union has
SHA-256 `f6f89d48519aaa46b362a474cc6bd8e470b638e1c7f4c3c0a7ac99413a85fa5c`.

```json stable-code-set
{"expected_results_sha256":"8671744730e94e88b439f05a0e934539fe5b148b3e3dfdc1243beba9774ced44","preserved_additions":["admission_allow","authority_allow","authority_resource_limit","authority_signature_invalid","cbor_frame_length","cbor_frame_truncated","cbor_integer_unsafe","cbor_invalid","cbor_invalid_utf8","cbor_map_key_invalid","cbor_not_deterministic","cbor_resource_limit","cbor_simple_forbidden","cbor_tag_forbidden","cbor_truncated","cbor_type_invalid","cbor_undefined_forbidden","interface_allow","interface_deadline_expired","interface_gateway_retry","interface_generation_mismatch","interface_owner_mismatch","interface_state_transition_invalid","interface_sub2api_retry","interface_terminal_no_retry","json_canonicalization_failed","json_invalid","json_number_invalid","json_type_invalid","replay_committed","replay_expired","replay_reserved","replay_revoked","sidecar_capability_allow","sidecar_capability_decode_invalid","url_host_invalid","url_path_invalid","url_port_invalid"],"rebaseline_wrappers":["authority_diagnostic_promotion","contract_bundle_missing","contract_file_digest_mismatch","contract_file_set_invalid","contract_index_not_canonical","contract_index_path_invalid","contract_index_version_invalid","contract_json_invalid","contract_mirror_mismatch","contract_predecessor_mismatch","contract_required_set_mismatch","contract_schema_invalid","contract_schema_keyword_unsupported","contract_schema_range_mismatch","contract_symlink","cross_repo_binding_mismatch","cross_repo_record_expired","cross_repo_result_mismatch","leak_detected","mutation_descriptor_invalid","mutation_executor_unexercised","mutation_pointer_invalid","mutation_source_invalid","oracle_not_implemented"],"union_count":119,"union_jcs_sha256":"f6f89d48519aaa46b362a474cc6bd8e470b638e1c7f4c3c0a7ac99413a85fa5c","union":["admission_allow","admission_authority_contradicted","admission_authority_expired","admission_authority_insufficient","admission_dependency_invalidated","admission_downgrade","admission_gate_failed","admission_gate_unobserved","admission_gate_unsupported","admission_manifest_payload_mismatch","admission_negative_capability","admission_schema_invalid","admission_tuple_mismatch","authority_allow","authority_checkpoint_stale","authority_clock_rollback","authority_dependency_invalidated","authority_diagnostic_promotion","authority_duplicate_signer","authority_expired","authority_freeze","authority_key_revoked","authority_mix_and_match","authority_parent_mismatch","authority_policy_rollback","authority_replica_conflict","authority_resource_limit","authority_revocation_invalid","authority_revocation_stale","authority_rotation_threshold","authority_signature_invalid","authority_split_view","authority_threshold_insufficient","authority_witness_mismatch","authority_wrong_role","cbor_duplicate_key","cbor_float_forbidden","cbor_frame_length","cbor_frame_truncated","cbor_indefinite_length","cbor_integer_unsafe","cbor_invalid","cbor_invalid_utf8","cbor_map_key_invalid","cbor_not_deterministic","cbor_resource_limit","cbor_simple_forbidden","cbor_tag_forbidden","cbor_trailing_data","cbor_truncated","cbor_type_invalid","cbor_undefined_forbidden","contract_bundle_missing","contract_file_digest_mismatch","contract_file_set_invalid","contract_index_not_canonical","contract_index_path_invalid","contract_index_version_invalid","contract_json_invalid","contract_mirror_mismatch","contract_predecessor_mismatch","contract_required_set_mismatch","contract_schema_invalid","contract_schema_keyword_unsupported","contract_schema_range_mismatch","contract_symlink","cross_repo_binding_mismatch","cross_repo_record_expired","cross_repo_result_mismatch","interface_allow","interface_contract_mismatch","interface_deadline_expired","interface_gateway_retry","interface_generation_mismatch","interface_generation_regression","interface_lineage_mismatch","interface_migration_stale","interface_not_ready","interface_owner_mismatch","interface_schema_unsupported","interface_stale_state","interface_state_transition_invalid","interface_sub2api_retry","interface_terminal_no_retry","json_canonicalization_failed","json_duplicate_key","json_invalid","json_invalid_utf8","json_lone_surrogate","json_negative_zero","json_number_invalid","json_number_unsafe","json_trailing_data","json_type_invalid","leak_detected","mutation_descriptor_invalid","mutation_executor_unexercised","mutation_pointer_invalid","mutation_source_invalid","oracle_not_implemented","replay_committed","replay_expired","replay_rejected","replay_replica_conflict","replay_reserved","replay_revoked","sidecar_capability_allow","sidecar_capability_decode_invalid","sidecar_capability_expired","sidecar_capability_schema_invalid","sidecar_key_epoch_mismatch","sidecar_key_not_found","sidecar_key_revoked","sidecar_key_role_invalid","sidecar_key_role_reuse","sidecar_signature_invalid","url_host_invalid","url_path_invalid","url_port_invalid"],"schema_enum_count":119,"schema_enum_jcs_sha256":"f6f89d48519aaa46b362a474cc6bd8e470b638e1c7f4c3c0a7ac99413a85fa5c"}
```

`$defs.stableCode` is the closed schema/type enum and `decisionRow.code` references it. Its enum,
`stable-code-set.union`, the Sub constant set, fixture expected-code set, mutation result classifier,
CC checker set, and cross-repo record set must each equal this union exactly. The checker independently
recomputes A from the frozen file, recomputes the union, requires count `119`, requires JCS SHA-256
`f6f89d48519aaa46b362a474cc6bd8e470b638e1c7f4c3c0a7ac99413a85fa5c`, and rejects missing, extra,
renamed, reordered, or duplicate codes with `contract_required_set_mismatch`.

Precedence is strict JSON -> mirror/source binding -> index/schema -> required set -> subject decision
-> result agreement -> review/expiry. Panics, generic errors, filesystem paths, source bytes, and
environment values are never stable outputs.

## 13. Allowed Paths, Side Effects, and Stop Rules

| Stage | Allowed repository writes | Commands / side effects |
|---|---|---|
| current C0 / Stage 1B | this one Markdown file only | four bounded closures, plan/static checks, one fresh review, then Git commit/push/PR only at `0C/0I`; no correction wave or product tests |
| S0/S1 | one future true-Sub docs plan only | read-only freeze/static/review; no Go/Node tests |
| R1/I1 | exact Section 6.1 paths only | two exact focused Go invocations, controller cache/temp writes only, egress 0 |
| SR | no repository writes | read-only exact-head review |
| C1 | exact four CC checker/test files | seven exact focused CC tests plus one exact Sub command when separately authorized |
| CR | no repository writes | checker and read-only exact-head review only |

Stop and preserve the worktree without destructive Git on any:

- commit/tree/parent, selected ref/OID, module/content, bundle, predecessor, plan, or review drift;
- ambiguous or moving selected remote/ref without new total-controller authority;
- dirty tracked input, unexpected path, extra commit, merge commit, amend, rebase, or history rewrite;
- missing/wrong exclusion bytes, CodeGraph root/version/extraction mismatch, pending nonzero,
  worktreeMismatch non-null, reindex required, or protected file/node count/access above zero;
- diagnostic field promoted into normative authority or any digest cycle;
- RED caused by compile/setup/cache/network/missing input instead of declared behavior;
- Go/Node command outside the exact lists, package-wide/service/protected compile, or dependency fetch;
- DNS/external socket, new egress, credential/upstream/production access, target/receiver/evidence
  execution, or product/native-search/runtime/service/Phase 4 change;
- authority/review older than 24 hours, reviewer/model mismatch, or any remaining C/I.

Rollback is preserve-only: retain branch, worktree, commits, logs, and artifacts as blocked/expired.
Do not delete, reset, clean, restore, use `checkout --`, rebase, amend, force-push, overwrite, or modify
operator work. A retry requires a new root/branch/authority and total-controller decision.

## 14. Current Plan Static and Review Gate

Only plan/static checks are permitted for this amendment:

- exact changed-path and whitespace checks;
- path existence and digest checks for CC-owned inputs; equality against the fixed Stage 1 receipt for
  true-Sub module/predecessor inputs, without a Stage 1B Sub read;
- tagged-JSON parse and exact-key checks;
- coverage-to-file/symbol/test/command traceability;
- serial-DAG and digest-DAG Kahn sorting;
- mutation-matrix completeness and positive-control presence;
- diagnostic-promotion static RED;
- CodeGraph freshness/provenance reconciliation without sync/reindex;
- all four `stage1b_static_red_assertions` and all nine closed-record negative vectors;
- exact equality of the 119-code union, `$defs.stableCode.enum`, count, and JCS digest;
- one fresh holistic independent `gpt-5.6-sol` `xhigh` plan review.

No Go test, Node test, product test, schema generator, target, evidence, network dependency install,
service compile, or protected access is allowed. The planning review receives this file's exact
SHA-256, all Section 2/3 provenance, the invalidation ledger, the future interface, commands, DAGs,
artifact schema, stop rules, and handoff prompt.

The completed Stage 1 review/fix/closure sequence remains the immutable record in Section 1.1.
Stage 1B allows exactly one fresh holistic review and no correction or closure re-review. Any C/I
means `FINAL_PLAN_BLOCKED`. At `0C/0I`, commit and push the docs-only branch and open a ready non-draft
PR against `muqihang/main`; do not merge it automatically.

The PR must say: **Merging this docs-only PR authorizes no true-Sub plan, implementation, checker,
test, fixture, target/evidence execution, cross-repository agreement, Phase 4, product/service change,
upstream access, or production action. The next action requires a separate total-controller decision.**

## 15. Remaining Unknowns and Prohibited Claims

Remaining Unknowns:

1. No remote ref currently supplies source authority for `3ac410e`; S0 needs an exact remote/ref/OID
   binding or explicit local-ref authority.
2. CodeGraph does not embed indexed Git commit/tree; contemporaneous joint binding must be repeated.
3. The true-Sub plan path/branch, implementation root, cache root, controller ID, reviewer task ID,
   and issue time do not exist until their separate authorities are issued.
4. CC-only P3A/P3B candidate inputs may have expired or contradictory leaves; none is usable until
   separately digest/scope/expiry revalidated.
5. The honest closeout candidate is unmerged and cannot bind the true-Sub implementation.
6. Cross-language parity, mutation parity, exact-head approval, and cross-repo agreement are not yet
   established.

Prohibited claims before CR `0C/0I` include: old ES8 implementation or review approved; old mirror
authoritative; true Sub already has Oracle code; CC and Go validators agree; P2/P3B complete;
`phase3b_usable=true`; target behavior reproduced; evidence sufficient; Gate A/B PASS; product/runtime
ready; native-search/runtime overlay Oracle-enabled; Phase 4 authorized; upstream/canary/production
equivalent; protected/service surface tested; or docs merge authorizes code.

## 16. Downstream True-Sub Plan Handoff Prompt

After this amendment is explicitly merged and the total controller authorizes S0, use this exact
handoff prompt:

```text downstream-true-sub-plan-prompt
You are the true-Sub docs-only Oracle rebaseline planner. PLAN ONLY. Use only
/Users/muqihang/chelingxi_workspace/sub2api-zhumeng-main and create a fresh planning worktree from
refs/heads/codex/native-search-gateway only if it still resolves commit
3ac410ea02edc53c3925f28eddcbc22b51c0a137, tree
f7d51fb57c64fbaf6e2db3a7a2d423a491d5788d, parent
04e42ae0f6c556daad21ac393eb284585092e805. Do not read any old clone/worktree or the protected
keepalive file. Before any CodeGraph scan install the exact 91-byte exclusion config with SHA-256
a7f3ad7c17d655f9d2494b5b05e55ceb4ea9c7667456ff785c5f2a9291c3783a. Freshly bind repository
realpath/common-dir, selected remote name+URL/ref/OID or obtain explicit local-ref authority, selected
ref/commit/tree, clean tracked state, Go 1.26.5, go.mod/go.sum/predecessor digests, CodeGraph
1.1.6/extraction24/root/config/pending0/worktreeMismatch-null/reindex-false/protected file+node0.
Raw graph counts, DB times/sizes, absolute paths, divergence, and full remote-config digests are
diagnostic only and must not enter normative digests. Draft one Sub-owned docs plan for the future
backend/internal/oracleevidence/** R1/I1 interface and exact focused command from the merged CC
rebaseline amendment. No package, mirror, test, fixture, Go/Node command, target/evidence, service,
product, runtime, upstream, credential, or production change. One holistic gpt-5.6-sol review, at
most one consolidated docs fix and one closure re-review, then ready PR only; do not merge. Stop and
preserve on any authority ambiguity or drift.
```

Until that separate instruction exists, the terminal decision is `CC_PLAN_REVIEW_ONLY`.
