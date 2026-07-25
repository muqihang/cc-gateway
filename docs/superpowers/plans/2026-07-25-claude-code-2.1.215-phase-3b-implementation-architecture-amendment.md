# Claude Code 2.1.215 Phase 3B Implementation Architecture Amendment

Status: plan only; no implementation, evidence execution, target launch, product change, or runtime
authority

Date: 2026-07-25

## 1. Purpose and Decision Boundary

The normalized-safe evidence-sufficiency supplement defines a valid evidence contract and a
340-launch experimental design, but its reviewed implementation candidate does not contain the
production campaign and closure architecture required to execute ES3 through ES17. Fresh prelaunch
therefore stopped before the first target launch.

This amendment closes that planning gap in one bounded architecture decision. It does not repair the
implementation, authorize execution, merge PR #45, or promote any Phase 3B field. It defines the
minimum implementation surface that a later, separately authorized correction must provide before a
new evidence namespace can be created.

This amendment is append-only relative to:

- `docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3b-profile-synthesis.md`, SHA-256
  `367eb28af225ae4d5bf0b666a4c2d3161da7d911f28dc6cb188cb38c1b65a8aa`;
- `docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-non-resume-amendment.md`, SHA-256
  `51a6f19addd87f1591ae15a1f8f14951bf732954b58fcc722a97fee246c0d4f7`;
- `docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-normalized-safe-evidence-sufficiency-supplement.md`,
  SHA-256 `1583dad45085e3dc18941349f323e2342eedd0ff273eb12a7a1a43f5dc736a57`.

The earlier plans remain authoritative for capability scope, field semantics, evidence classes,
experimental definitions, conclusion rules, and Gate A/Gate B meaning. Where implementation details
conflict, this amendment controls:

- the executable ES3-ES17 module and caller graph;
- the 340-row launch ledger and per-launch authority gate;
- receiver grouping and cell/observation binding;
- failure-derived honest closeout;
- the implementation commit DAG, review boundary, and namespace migration policy.

The following remain prohibited: resume or session-lineage work, P3A-S Observer B, real upstream,
real credentials, production/staging/canary, provider TLS equivalence, Phase 3B profile compiler,
Phase 4 runtime wiring, package-wide Go tests, and any read/search/index/compile/test of
`backend/internal/service/openai_compact_sse_keepalive_test.go`.

## 2. Frozen Inputs and Current State

### 2.1 Repository and implementation candidate bindings

| Input | Commit | Tree | Role |
|---|---|---|---|
| CC Gateway fresh planning base (`muqihang/main`) | `a275594864d1f53a663ba96cbe599f9781f0c113` | `c47fd0a8e59892e0603b80d2c2edadf5047cb447` | Docs-only amendment base |
| PR #45 implementation candidate | `a718c65b4f22e2c36a193ca517f4fb4c386700f7` | `106ac7800b517a727377b6c303cb37fb2eaf80b6` | Exact implementation audit object; remains open and unmerged |
| Sub2API selected main | `fb840673afc0ff590fef9bb147fce5b9b70eb098` | `eeb8654eddf7a4c38364202f5024161e65d2a6d1` | Read-only ES8 architecture input |

PR #45 is `OPEN`, `isDraft=false`, `mergedAt=null`, with remote head exactly `a718c65`. This plan
does not change its branch, body, merge state, or implementation bytes.

### 2.2 Independent implementation-architecture audit

The read-only audit used model `gpt-5.6-sol`, exact PR object reads, and no target, evidence, Go, or
product execution. The audit worktree had no `.codegraph/`, so immutable `git show`, `git grep`, and
`git ls-tree` reads were used. The protected keepalive path was excluded and was not accessed.

```json implementation-architecture-audit
{"critical_count":2,"important_count":3,"minor_count":0,"pr_head":"a718c65b4f22e2c36a193ca517f4fb4c386700f7","pr_tree":"106ac7800b517a727377b6c303cb37fb2eaf80b6","reviewer_model":"gpt-5.6-sol","reviewer_task":"/root/architecture_audit","schema_id":"oracle-lab-p3b-es-implementation-architecture-audit.v1","supplement_sha256":"1583dad45085e3dc18941349f323e2342eedd0ff273eb12a7a1a43f5dc736a57","verdict":"IMPLEMENTATION_ARCHITECTURE_AUDIT_REQUIRED"}
```

The two Critical findings are a missing ES3-ES5 execution plane and a closeout path that hard-codes
superseded blocker semantics. The three Important findings are a missing per-target-spawn authority
gate, an insufficient cell/receiver binding contract, and incompatible P3A runners.

### 2.3 Frozen fresh1 state

The only post-review namespace is:

`/Users/muqihang/.codex/evidence/claude-code-2.1.215-phase3b-evidence-sufficiency-20260725-a718c65-fresh1`

Its campaign ID is `p3b-es1-a718c65-fresh-20260725-01`. Fresh prelaunch was GREEN, but execution
stopped before ES3 because no campaign runner exists. The namespace is frozen as
`PRELAUNCH_GREEN_ARCHITECTURE_BLOCKED` with:

- target launches `0` and remaining launch ceiling `340`;
- receiver control `1` process and `0` wire observations;
- external socket budget `0`;
- runtime contradictions `0` and leak findings `0`;
- no real upstream, credential, resume, production, or Phase 4 contact.

The sole architecture blocker record is
`capsules/P3B-ES1/control/architecture-blocker.json`, SHA-256
`8b41ac35ba112569bba01f011da66ff978a6d9786a6d8797f8baa5576d7d99c2`, size `2126`, mode
`0600`, link count `1`. It binds `failure_family=campaign_runner_missing`, marks the two old
prelaunch findings as superseded, and records `emitBlockedCloseout allowed=false/invoked=false`.

The record also binds these exact corrected prelaunch inputs:

| Binding | SHA-256 |
|---|---|
| Independent implementation review | `c52c5c1bc39d2fabd8a69a47ee5df81d0133eb6315bdcd72fa377625ce3fbc52` |
| Review binding | `5a1398d3f6e141d11904b0651750447a4a71e8018cf146de84fb6fa587b4de5b` |
| Operator authority | `05547b36e6883dd242b053231a8f5a66ceab635e47a55142b9f1f66ea010243e` |
| Campaign input | `1f03d66b2c6afd287eb36110c1c982f37d39b49a29e30b2da6d076dd49913700` |
| Active anchor selection | `feaa72d4a09f5d43f925838d606f0358466efe2334a76808bac51b9ce182fb60` |
| Selected static anchor | `8fa1494a9aa8feba47b50433eb27149e0b9b960b02a171a6708125c1fd9baee1` |
| Receiver runtime tuple | `bc934e5712de2d6a97b27f72486797307e52a77d5cf1795d86dc1c6063e9f6bf` |
| Schema bundle | `d8c47da09af7c019aa8b009b76a36ec3122e4b32c4bb3d0c403beb6f18930d05` |
| Prelaunch result | `2ab1b414da8b123083d016f5f4423a13bd891bcd4cd1ebfc4901b6f6bd624746` |

fresh1 and the earlier f045 namespace are immutable historical inputs only. They are not executable
authority and must never be copied, migrated, resumed, edited, or used as positive behavior evidence.

## 3. Observed Architecture Gap

At PR #45 head `a718c65`, the Phase 3B implementation directory contains only:

- `closeout.ts`;
- `controls.ts`;
- `core.ts`;
- `normalize-request.ts`;
- `normalize-response.ts`;
- `schemas.ts`;
- `static-anchor.ts`;
- `wire-receiver.ts`.

The supplement names `campaign.ts`, `revalidate-predecessors.ts`, `contradictions.ts`, `coverage.ts`,
and `check-cross-repo.ts`, but none exists. `package.json:15-33` has no Phase 3B campaign command.
`spawnNormalizedSafeReceiver` is called only by focused tests, not by a production campaign caller.

The active-anchor resolver in `wire-receiver.ts:284-313` correctly validates selection, anchor, and
receiver tuple before receiver bind. `static-anchor.ts:479-524` provides reusable verification
primitives. Neither can protect a target launch because no target orchestrator calls them.

The current `closeout.ts:413-430` hard-codes the superseded
`prelaunch-mutation-executor-unproven` and `prelaunch-receiver-identity-omitted` findings;
`closeout.ts:465` unconditionally asserts `es0_to_es15_terminal=true`; and
`closeout.ts:481-521` derives blocked exit/handoff/terminal output from those fixed values rather
than from an actual failure record and launch ledger. It is not a general closeout implementation.

The P3A runners are reference material, not drop-in campaign implementations:

- `config-precedence-campaign.ts:284-322,380-389` uses the old fake upstream, fixed probe
  entrypoint, `instrumentation='none'`, two-arm `balancedPairOrder`, and no active-anchor gate;
- `auth-lifecycle-campaign.ts:277-298,354-363` has the same mismatch;
- `scenario-campaign.ts:199-225,273-280` uses the old two-arm schedule and observer contract;
- `run-cell.ts:275-287` rejects an unprepared `instrumentation:'probe-copy'` request.

The later implementation must pass the already prepared, anchor-bound probe executable to
`runCell` with `instrumentation:'none'`; it must not ask `runCell` to create or infer a probe copy.

## 4. ES3-ES17 Requirement Matrix

The `Disposition` column is closed: `REUSE_PRIMITIVE`, `DO_NOT_REUSE_RUNNER`, `EXTEND_CONTRACT`, or
`MISSING_IMPLEMENTATION`.

| ES | Requirement | Actual symbol/caller at `a718c65` | Focused test/command required | Side effect and authority boundary | Closure requirement | Disposition |
|---|---|---|---|---|---|---|
| ES3 | Four config plus four auth pairs, four arms, five repetitions; 160 launches | `buildDeterministicSchedule` exists; P3A config/auth runners use incompatible observer and two-arm schedule; no Phase 3B caller | `oracle-phase3b-evidence-runner`, `launch-authority`, `family-config-auth` | Serial target spawn only after exact row, selection, anchor, selected executable, guard, and receiver group validation | Actual pair leaves, all repetitions, predecessor comparison, and failure record derived from ledger | Runner `MISSING_IMPLEMENTATION`; schedule/guard primitives `REUSE_PRIMITIVE`; P3A runners `DO_NOT_REUSE_RUNNER` |
| ES4 | Three request stimuli, two instrumentation arms, five repetitions; 30 launches | Request normalizer and receiver exist; receiver called only by tests | `oracle-phase3b-evidence-family-wire-failure`, request AST, receiver | Receiver is sole request evidence writer; target cannot write observation | Every request E leaf and fixture source binds one immutable observation set | Runner `MISSING_IMPLEMENTATION`; receiver/normalizer `REUSE_PRIMITIVE` |
| ES5 | Thirteen response/failure programs, two arms, five repetitions; 130 launches | Scenario builder, response normalizer, and retry classifier exist; no launch/attempt aggregator | `oracle-phase3b-evidence-family-wire-failure`, response AST | Bounded loopback response program; each spawned target and every receiver attempt counted | Attempt ordering, owner, terminal, partial, recovery, and overlap set close from actual observations | Runner/aggregator `MISSING_IMPLEMENTATION`; classifier/normalizer `REUSE_PRIMITIVE` |
| ES3-5 control tranche | Two mandatory target guard/perturbation controls, two arms, five repetitions; 20 launches | Synthetic prelaunch controls exist; no target-control ledger/caller | Runner and launch-authority focused tests | First target tranche; consumes exact rows and stops dependent launches on mismatch | Explicit terminal control records, never inferred from unit tests | `MISSING_IMPLEMENTATION` |
| ES6 | Observation closure and exact predecessor contradictions | Planned `coverage.ts` and `contradictions.ts` absent | `oracle-phase3b-evidence-curation` | Read-only over sealed ES3-ES5 evidence; no target or receiver | Unique pointer sources, exact nine-family overlap, explicit open/closed contradictions | `MISSING_IMPLEMENTATION` |
| ES7 | Fixtures, candidate closure, clock, then three conclusions | Schemas/materializers exist; only blocked candidate/conclusion builders exist | Curation, schema, request/response materialization tests | Writes only after ES6 sealed; clock after last authorizing cell and fixture validation | All three conclusions form one fail-closed set | Success path `MISSING_IMPLEMENTATION`; schema/materializers `REUSE_PRIMITIVE` |
| ES8 | Independent Go validator and TS byte/decision checker | CC checker absent; Sub2API has no `backend/internal/oracleevidence/**` | Exact dedicated Go regex and CC cross-repo test | No import/test/compile of `internal/service`; no protected path | Byte-identical corpus, canonical bytes, digest, decision, stable code | `MISSING_IMPLEMENTATION` |
| ES9 | Final one-to-one provenance and coverage | `coverage.ts` absent; `buildUnknownProvenance` is blocked-only | Curation and cross-repo tests | Read-only over validated immutable sources | Every enabled pointer once, blockers once, no D leaf enabled | `MISSING_IMPLEMENTATION` |
| ES10 | Artifact index after immutable payload | `inventoryPayload` exists only inside blocked closeout | Closeout-blocker and closure tests | O_EXCL write after payload seal | Includes exact payload, excludes closure cycle | Primitive `REUSE_PRIMITIVE`; general caller `MISSING_IMPLEMENTATION` |
| ES11 | Leak report bound to index | Forbidden-key scan exists only inside blocked closeout | Closure tests | Bounded scan of indexed normalized-safe bytes only | Exact indexed set, explicit findings, no unindexed inference | Primitive `REUSE_PRIMITIVE`; general caller `MISSING_IMPLEMENTATION` |
| ES12 | Exit derived from actual ledger/failure | Hard-coded BLOCKED, target count zero | `oracle-phase3b-evidence-closeout-blocker` | No launch; consumes sealed ledger and optional validated failure | Exact planned/started/terminal counts and failure family | Existing caller `DO_NOT_REUSE_RUNNER` |
| ES13 | Handoff derived from exit/conclusions | Hard-coded retain-blocked handoff | Closeout-blocker and closure tests | No launch | Actual Gate A/Gate B inputs and remaining Unknowns | Existing caller `DO_NOT_REUSE_RUNNER` |
| ES14 | Terminal manifest after exact predecessors | Writer exists; blocked caller supplies fixed state | Closure tests | O_EXCL after ES10-ES13 | Exact predecessor path/schema/digest set | Writer `REUSE_PRIMITIVE`; caller `MISSING_IMPLEMENTATION` |
| ES15 | External digest set binds exactly five predecessors | Binding logic exists at `closeout.ts:510-521` | Closure tests | Last O_EXCL write | Artifact index, leak, exit, handoff, terminal only; no self hash | `REUSE_PRIMITIVE` after general closeout |
| ES16 | Truthful Gate A | `evaluateTerminalGates` exists; only caller hard-codes terminal state | Curation/closure tests | Pure evaluation | Honest complete, Unknown, or BLOCKED terminal state from ledger and closure | Evaluator `REUSE_PRIMITIVE`; caller `MISSING_IMPLEMENTATION` |
| ES17 | Gate B plus fresh operator decision | `decideEvidenceAdmission` used only by tests/mutations | Cross-repo/closure tests | Pure evidence resolution; never runtime admission | Gate A plus three Reproduced conclusions and explicit operator decision | Helper `REUSE_PRIMITIVE`; resolver/operator gate `MISSING_IMPLEMENTATION` |

## 5. Required Production Architecture

### 5.1 One campaign state machine

Add one production CLI at
`tools/oracle-lab/phase3b-evidence-sufficiency/campaign.ts`. It owns a closed state machine with only
these modes:

1. `prelaunch-only`: validates new authority/freeze/input, materializes the static anchor and active
   selection, runs zero-target synthetic controls, seals prelaunch, and exits;
2. `execute-from-sealed-prelaunch`: accepts exactly one sealed prelaunch from the same new namespace,
   validates its complete digest chain, writes the immutable 340-row ledger, executes serial rows,
   seals dynamic observations, and exits;
3. `closeout-only`: accepts a sealed ledger plus either complete results or one schema-valid terminal
   campaign failure, performs ES6-ES17 as far as dependencies permit, and never launches a target.

The modes do not guess state from directory contents. Each consumes explicit relative paths and
digests from campaign input. Re-running a completed mode is rejected because its O_EXCL outputs
already exist. `execute-from-sealed-prelaunch` rejects fresh1 because fresh1 binds the old
implementation/source/schema tuple and is frozen architecture-blocked.

The CLI is a controller tool, not a product runtime path. It must not import gateway handlers,
production configuration, provider clients, or Sub2API service packages.

### 5.2 Immutable 340-row ledger

Before the first target spawn, the controller creates and seals one canonical run ledger. Its row
count, family counts, order, run IDs, selected executable class, receiver group, guard profile, and
resource budget are pure functions of the new campaign input.

```json phase3b-launch-budget
{"auth":80,"config":80,"external_socket_budget":0,"mandatory_target_controls":20,"parallel_target_launches":1,"request_wire":30,"response_failure_recovery":130,"schema_id":"oracle-lab-p3b-es-launch-budget.v1","target_launch_ceiling":340,"total_rows":340}
```

The fixed seeds remain `[215001,215002,215003,215004,215005]`. Every schedule uses the supplement's
fixed base permutation plus cyclic rotation algorithm. There is no RNG, per-repetition rehash,
replacement row, extension, or retry of a target row. Protocol-level attempts within an ES5 row are
bounded observations of that one target launch and do not create replacement target launches.

The first dynamic tranche is the exact 20-row mandatory target guard/perturbation family. It is not
the zero-target synthetic prelaunch control. Only a GREEN terminal control tranche permits the
remaining ES3-ES5 rows. The remaining families are processed in ascending unsigned UTF-8 schedule
ID order while preserving DAG dependencies.

The ledger is immutable. Per-row execution state is represented by separate exclusive records:

- `planned`: present only in the sealed ledger;
- `started`: written immediately before the controller spawns the target and consumes one launch;
- `terminal`: written exactly once after target wait and receiver seal;
- `not_executed`: written during closeout only for rows prevented by a terminal dependency failure.

A `started` row counts as a target launch even if spawn return, signal, timeout, or receiver
coordination later fails. A pre-spawn authority failure writes no `started` record and consumes no
launch, but it creates the one terminal campaign-failure record. Counts are derived from records;
they are never caller assertions.

### 5.3 Per-launch authority gate

Immediately before each `started` record and target spawn, one `launch-authority.ts` gate must:

1. open the evidence root and every fixed authority path with containment, no-follow, bounded-size,
   canonical JSON, mode, link-count, and closed-schema validation;
2. re-resolve the fixed active selection path and selected static anchor;
3. verify authority, freeze, campaign input, schema bundle, source set, review, and receiver tuple
   bindings;
4. open and hash the exact original entrypoint or prepared probe executable that this row selects;
5. for the instrumented arm, verify probe-copy recipe, pre-sign hash, post-sign hash, signature
   identity, and selected anchor binding;
6. verify the exact ledger row, run ID, family, seed, repetition, arm label, sequence index, receiver
   group, guard profile, remaining budget, and `target_launches < 340`;
7. verify the receiver group is already bound on loopback, within resource ceilings, and has not
   emitted or accepted an observation for this run ID;
8. compute one canonical launch-authority receipt and pass only its closed tuple to the spawn
   adapter.

Any drift stops before target spawn with a stable failure family. The controller never reopens a
caller-selected path and never substitutes a source-only digest for executable identity.

### 5.4 Serial launch adapter and guard

The adapter wraps the existing `runCell`, `runCellGuardSelfTest`, `buildCellSandboxProfile`,
`buildIsolatedEnvironment`, launch-manifest validation, and exact zero-egress guard primitives. It
does not modify their Phase 3A implementations in place.

For `uninstrumented`, the adapter passes the verified original entrypoint. For `instrumented`, it
passes the already prepared, verified probe executable. Both call `runCell` with
`instrumentation:'none'`; the Phase 3B layer owns the semantic arm label and selected-executable
receipt. This preserves `run-cell.ts`'s rejection of unprepared probe-copy instrumentation.

The adapter permits one target at a time. It binds process PID, start/terminal monotonic times, exit
or signal, sandbox manifest digest, guard result, stdout/stderr normalized-safe classification, and
receiver group identity. Raw stdout, stderr, request, response, credentials, home paths, account
identifiers, or transcripts are never evidence outputs.

Any target exit/signal outside the scenario's closed expected terminal class, external socket,
authority drift, anchor drift, observer disagreement, overflow, leak, or exclusive-write conflict
creates one terminal campaign failure and stops dependent launches. There is no unchanged retry.

### 5.5 Receiver groups and ownership

The normalized-safe receiver remains outside the target and probe. It is the sole authority for
request/response wire leaves. The controller alone owns run, cell, result, failure, and closeout
records. Neither side may write the other's files.

Each ledger row binds a `receiver_group_id` and a closed list of receiver instances. Wire and failure
rows use one instance. Config precedence rows may use an explicit two-route group:

- each route has a distinct loopback authority, receiver instance digest, and expected source class;
- exactly one selected route may receive the target request;
- the nonselected route must seal with zero requests;
- route winner is derived from receiver association, never from a persisted URL or secret value;
- both routes share the row's selected anchor, receiver runtime tuple, scenario, seed, and guard.

Every receiver instance enforces bounded body/header/event/attempt limits and fixed scenario
programming. It accepts only the target sandbox's expected run identity. External bind/connect,
unmatched run ID, multiple writer, late observation, or raw-material persistence is terminal.

### 5.6 Cell and observation contract

The later implementation must extend the evidence schema bundle with closed schemas for:

- `run-ledger` and `run-spec`;
- `launch-authority-receipt`;
- `receiver-group` and `receiver-instance-result`;
- `campaign-failure`;
- generalized closeout input/state.

`cell-record` must bind, at minimum, campaign ID, run ID, sequence index, family/schedule ID, seed,
repetition, arm, selected executable digest, active anchor digest, receiver tuple, receiver group,
launch-authority receipt, launch manifest, sandbox guard, target result, and
`observation_bindings[]`.

`observation_bindings[]` replaces the insufficient single `observation_sha256` assumption. Each
entry binds receiver instance, connection ordinal, scenario action ordinal, attempt ordinal,
observation path/schema/digest, and terminal association. ES5 may therefore represent multiple
bounded protocol attempts from one target launch without inventing target rows. Config two-route
cells bind selected and zero-observation route results explicitly.

All schemas are closed and versioned. Existing PR #45 v1 records may be extended only under the
later reviewed correction authority; no compatibility shim may make fresh1 executable.

## 6. ES6-ES17 Curation and Honest Closeout

### 6.1 Curator separation

Launch code may normalize and seal observations but may not issue fixtures, conclusions,
provenance, coverage, or gates. Add separate launch-neutral modules:

- `revalidate-predecessors.ts` for exact safe predecessor projection loading after new observations
  seal;
- `contradictions.ts` for pair, instrumentation, and exact nine-family predecessor comparison;
- `coverage.ts` for JSON Pointer ownership, field closure, and D-leaf exclusion;
- `curate.ts` for fixture materialization, candidate closure, clock, and conclusions;
- `check-cross-repo.ts` for the dedicated TS/Go agreement result.

These modules operate only on schema-valid, indexed, immutable normalized-safe records. They do not
walk unlisted evidence directories, open old raw evidence, launch a process, or contact a socket.

ES6 first emits observation closure and contradictions. ES7 then materializes request/response
fixtures, candidate field closure, clock attestation, and the three conclusions in the supplement's
strict order. ES8 validates the exact mirror independently. ES9 emits final provenance and coverage.
Missing or contradictory evidence produces explicit Unknown rows; it never produces absent rows or
default values.

### 6.2 General campaign failure

`campaign-failure.json` is optional only for a fully successful 340-row campaign. Otherwise exactly
one such record is required. It is derived at the first terminal stop and binds:

- stable failure family and action;
- failing ES node, family, schedule, and run ID when applicable;
- whether failure occurred before or after target spawn;
- exact planned, started, terminal, and not-executed counts;
- authority/anchor/receiver/guard/ledger digests at the decision point;
- affected dependency closure and prohibited continuation;
- safe diagnostic class and digest, never raw output;
- whether leak quarantine is required.

The stable failure-family registry must include `campaign_runner_missing` for historical blocker
interpretation, but a newly implemented runner cannot emit it merely because execution failed.
Other families remain those in the supplement plus precise launch-ledger, authority, receiver-group,
target-terminal, and exclusive-write failures. Tests reject unknown families and any family whose
action disagrees with the registry.

### 6.3 General closeout

Replace the blocked-only `emitBlockedCloseout` caller with a general closeout controller. Reuse its
exclusive writer, payload inventory, leak scan, terminal-manifest writer, and external digest-set
primitive only after they are separated from hard-coded findings.

Closeout derives truth exclusively from:

1. sealed campaign authority and input;
2. sealed run ledger and row execution records;
3. validated receiver/cell/result records;
4. optional validated campaign failure;
5. ES6-ES9 curator outputs that actually exist.

It must not accept caller-provided terminal counts, fixed contradiction IDs, fixed Gate A state, or
handwritten missing-row lists. It emits the unique append-only order:

1. artifact index;
2. leak report;
3. exit report;
4. handoff;
5. terminal manifest;
6. external digest set.

The artifact index excludes itself and all later closure records. The external set binds exactly the
preceding five records and never itself. A closure write conflict is terminal and is not repaired by
overwriting or choosing another path.

Gate A may PASS for an honest complete, Unknown, or BLOCKED campaign only when the planned matrix is
either terminal or explicitly not executed because of the validated dependency failure, all
existing evidence is indexed and leak-scanned, and ES10-ES15 close truthfully. Gate B remains
fail-closed unless all original supplement conditions pass. A missing runner before any launch can
be represented by the historical fresh1 blocker record, but fresh1 itself is not retroactively
closed by new code.

## 7. Sub2API ES8 Boundary

The later Sub2API work may create or modify only `backend/internal/oracleevidence/**` and its
byte-identical testdata mirror. It must not import `backend/internal/service`, reuse service package
validators, add side effects, or touch any product handler.

The only Go test command is:

```sh
go test ./internal/oracleevidence -run '^TestEvidence(StrictJSON|Schema|Coverage|Fixtures|Mutations|Admission)$' -count=1
```

It runs from `backend/`. Both RED and GREEN use the same exact command. RED must fail because the
dedicated behavior is absent or incorrect, not because a fixture is missing, syntax is invalid, or
another package compiled.

The protected keepalive file must be absent from CodeGraph, file searches, test inputs, compiler
inputs, and diffs. `go test ./...`, `go test ./internal/service`, package-wide wrappers, and implicit
test commands are forbidden. The CC checker consumes only explicit mirror paths and the focused Go
result record.

## 8. TDD and Commit DAG

Merging this docs-only amendment still grants no implementation authority. A later operator
decision must bind the amendment digest and merge commit, exact PR #45 ancestry, both repository
heads/trees, toolchains, target artifact, schema bundle, resource budget, and a new empty namespace.

The recommended non-rebase integration preserves `a718c65` ancestry: after this amendment merges to
`muqihang/main`, merge that exact main plan commit into the PR #45 feature branch, then add the
authorized implementation commits. Do not reset, rebase, rewrite, or force-push PR #45.

The implementation commit DAG is:

1. CC `test(oracle-evidence): specify ledger authority and honest closeout`.
   Genuine RED for missing run ledger, per-launch gate, receiver groups, observation arrays,
   campaign failure, and blocker-derived closeout.
2. CC `feat(oracle-evidence): add serial campaign and launch authority`.
   Implement the 340-row state machine, per-launch authority, receiver group contract, serial spawn
   adapter, and 20-row control tranche.
3. CC `feat(oracle-evidence): add config auth wire and failure families`.
   Implement ES3-ES5 family adapters/classifiers without reusing P3A runners.
4. CC `feat(oracle-evidence): add curator and general closeout`.
   Implement ES6-ES7, ES9-ES17, failure-derived closure, and all success/Unknown/BLOCKED paths.
5. Sub2API `test(oracle-evidence): add independent RED corpus`.
   Add only dedicated-package RED fixtures/tests.
6. Sub2API `feat(oracle-evidence): add focused validator and mirror`.
   Implement ES8 without service imports.
7. CC `test(oracle-evidence): bind cross-repo agreement and closure`.
   Add the CC checker, exact result binding, and integrated closure tests.

CC commits 1-4 may be reviewed as one bounded implementation range before any target launch. Sub2API
commits 5-6 are independently reviewed before the cross-repo result. Commit 7 and both repository
heads receive one integrated closure review. Evidence outputs, authority records, local scripts, and
generated namespaces are never committed.

There is at most one consolidated correction wave for each reviewed range and one closure review.
Only a deterministic Critical introduced by the correction itself permits one precise micro-fix.
Wording, optional hardening, and future-phase concerns do not reopen implementation.

## 9. Exact Test and Command Contract

### 9.1 Focused CC RED/GREEN

Run each file directly; no package-wide wrapper substitutes for these commands:

```sh
node --import tsx tests/oracle-phase3b-evidence-schema.test.ts
node --import tsx tests/oracle-phase3b-evidence-campaign.test.ts
node --import tsx tests/oracle-phase3b-evidence-receiver.test.ts
node --import tsx tests/oracle-phase3b-evidence-request-ast.test.ts
node --import tsx tests/oracle-phase3b-evidence-response-ast.test.ts
node --import tsx tests/oracle-phase3b-evidence-anchor-provenance.test.ts
node --import tsx tests/oracle-phase3b-evidence-prelaunch-correction.test.ts
node --import tsx tests/oracle-phase3b-evidence-closure.test.ts
node --import tsx tests/oracle-phase3b-evidence-runner.test.ts
node --import tsx tests/oracle-phase3b-evidence-launch-authority.test.ts
node --import tsx tests/oracle-phase3b-evidence-family-config-auth.test.ts
node --import tsx tests/oracle-phase3b-evidence-family-wire-failure.test.ts
node --import tsx tests/oracle-phase3b-evidence-curation.test.ts
node --import tsx tests/oracle-phase3b-evidence-closeout-blocker.test.ts
node --import tsx tests/oracle-phase3b-evidence-cross-repo.test.ts
npx tsc --noEmit
git diff --check
```

The first eight preserve the reviewed PR #45 behavior. The last seven express the missing
architecture. RED is valid only when it fails for the named missing behavior. No skipped test,
syntax error, absent fixture, import error, or unsafe test setup counts as RED.

### 9.2 Mandatory negative cases

At minimum, focused tests reject:

- missing, duplicate, reordered, over-ceiling, or replacement ledger rows;
- wrong fixed permutation/rotation, seed vector, arm count, run ID, or sequence index;
- `started` count disagreement and any parallel target spawn;
- stale/replaced/symlinked authority, selection, anchor, original entrypoint, probe copy, receiver,
  schema bundle, or ledger;
- caller-selected executable/path/digest and source-only executable substitution;
- receiver group mismatch, wrong config route, both routes hit, unselected route hit, late or
  duplicate observation;
- missing/duplicate/misordered attempt observation bindings;
- target exit/signal mismatch, external socket, guard drift, overflow, writer conflict, and leak;
- caller-provided launch counts, hard-coded old contradiction IDs, false ES0-ES15 terminal state,
  and campaign failure/action mismatch;
- closure hash cycle, wrong order, unindexed payload, external set self-binding, and Gate A promotion
  with unrepresented rows;
- cross-repo byte, schema, canonicalization, digest, decision, or stable-code disagreement.

### 9.3 Static and review gates

Before implementation review and again before any fresh prelaunch:

- both repositories are tracked clean at the reviewed heads;
- CodeGraph is initialized/synchronized independently in each implementation worktree with exact
  exclusion digest `f885ea40698ff4de9881ce6a9537388ce80c04be9515bf2c77ac186d39140e98`;
- graph pending count is zero and protected count is zero;
- schema bundle, source set, target artifact, original entrypoint, probe copy, receiver source,
  receiver executable/launcher tuple, and result-set digests are recomputed from actual bytes;
- all focused tests, `tsc --noEmit`, `git diff --check`, and exact cross-repo checks pass;
- one independent `gpt-5.6-sol` implementation review reports `Critical=0` and `Important=0` for
  the exact commit range.

No target launch or new evidence namespace is allowed before all of these pass.

## 10. Launch Accounting and Stop Rules

The ceiling is exact and global: at most `340` target launches, serial only. The controller may
execute fewer because of a stop; it may never execute more, add repetitions, replace a row, or use a
new namespace to continue under the same authority.

The following stop before spawn and consume no target row: authority mismatch, selection/anchor
drift, selected executable drift, schema/source/review binding drift, ledger mismatch, guard-profile
mismatch, receiver-group precondition failure, dirty repository, protected count nonzero, and
external socket budget not equal to zero.

The following stop after the already-started row and consume that row: unexpected target exit or
signal, timeout, resource overflow, external socket, receiver disagreement, paired perturbation,
nondeterminism, attempt overflow/order mismatch, raw-material or leak finding, and exclusive-write
conflict.

The controller seals one campaign failure and marks every dependent unstarted row `not_executed` at
closeout. It does not retry unchanged state. Independent ES3/ES4/ES5 branches may continue only when
the DAG says they do not depend on the failed family and the failure action is not globally terminal.
External egress, leak, authority drift, anchor drift, writer conflict, or launch-budget disagreement
is globally terminal.

## 11. Namespace and Migration Policy

fresh1 remains immutable and architecture-blocked forever. Its prelaunch GREEN status proves only
that the reviewed B-only receiver provenance correction passed its zero-target control. It does not
authorize a later runner and cannot be upgraded by appending new schemas or executables.

After the amendment is merged, later implementation is complete, and exact implementation review is
`0C/0I`, a new operator authority must create a completely empty append-only namespace. The new
namespace must have a new campaign ID and independently generated authority, freeze, campaign input,
source set, result set, schema bundle, review binding, static anchor, active selection, receiver
tuple, probe copy, run ledger, and prelaunch result.

No file, digest assertion, receipt, lease, context, result, observation, or closure output is copied
from f045 or fresh1. The fresh1 architecture blocker may be cited only by absolute path and SHA-256
as a planning predecessor. It is never an evidence source or runtime decision input.

If refreshed repository, artifact, toolchain, or plan bytes drift, stop before namespace creation and
obtain reviewed rebinding. A partially created namespace is never reused; it is retained as an
append-only failed setup record and a different authority is required for another namespace. No old
namespace or cleanup candidate is deleted without explicit operator approval.

## 12. Plan Review and Acceptance

This amendment must receive one independent `gpt-5.6-sol` docs-only review bound to:

- this file's exact SHA-256 and commit;
- the three predecessor plan digests in Section 1;
- PR #45 head/tree `a718c65`/`106ac780`;
- the fresh1 architecture blocker digest `8b41ac35...d99c2`;
- the read-only architecture audit verdict `2C/3I/0M`;
- the Sub2API head/tree in Section 2.1.

The review checks requirements against actual symbols/callers/tests/commands, not only prose. It
must verify the complete ES3-ES17 matrix, 340-row accounting, per-launch authority, receiver route
ownership, multi-attempt observations, honest closeout, Sub2API boundary, namespace migration, and
prohibited scope.

At most one consolidated plan correction wave and one closure review are allowed. The docs-only PR
may open only after the closure review reports `Critical=0` and `Important=0`. Minor findings enter
the plan ledger and do not reopen review unless they prove a false technical claim.

Plan acceptance does not merge PR #45 or authorize implementation. After this amendment PR merges,
the only next valid step is a new operator decision for the exact successor implementation range.

## 13. Plan-Only Verification

This planning task may run only static documentation checks:

```sh
shasum -a 256 \
  docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3b-profile-synthesis.md \
  docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-non-resume-amendment.md \
  docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-normalized-safe-evidence-sufficiency-supplement.md
git diff --check
```

Additionally, parse every tagged JSON block, verify the budget sums to 340, confirm all ES3-ES17
rows and required architecture terms occur, prove only this plan file changes, and recompute the
fresh1 blocker digest without reading any other evidence file.

No repository implementation test, target command, receiver, evidence campaign, Sub2API edit, Go
test, product build, network observation, or production path is permitted during this docs-only
amendment.

## 14. Terminal Handoff

If this plan's independent review closes at `0C/0I`, open one ready, non-draft docs-only PR from
`codex/claude-code-2.1.215-phase3b-implementation-architecture-amendment`. Do not merge it without
the controlling task's explicit plan-merge decision.

Until that plan PR is merged and a new successor implementation authority exists:

- PR #45 stays open and unmerged at `a718c65`;
- fresh1 stays `PRELAUNCH_GREEN_ARCHITECTURE_BLOCKED` with zero target launches;
- no campaign runner, closeout correction, schema correction, Sub2API package, new namespace, or
  target launch may be created;
- all Phase 3B successor conclusions and `phase3b_usable` claims remain unavailable.
