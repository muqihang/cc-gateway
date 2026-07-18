# Oracle Lab Delivery Mechanism Transition Plan

## Status

- Date: 2026-07-18
- State: candidate transition plan; no implementation or Phase 1 execution authority
- CC Gateway planning base: `ed4ef46dc41b547ecee9ec25dda974274c5cd110`
- Sub2API remote-main discovery base: `b0b77933716487da5fca00329443f88ce9a1c3db`
- Governing delivery mechanics:
  `docs/superpowers/roadmaps/2026-07-18-oracle-lab-delivery-operating-model-v2.md`
  (`sha256:a53e7384d6cf353877af82f16196b8d58ed823277e76e03337dfc9fadff7d0ea`)
- Governing phase ownership and DAG:
  `docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md`
  (`sha256:00519348d9dd8972dbea92a647d67c2fc42e9015ece6dcb0eb427df02480b107`)
- Existing execution-context schema:
  `sha256:0c9d478bbc5aa810da044c07c6fc0ffaf016aa014ff416b2ea75c6069dec4e56`
- Existing plan-review schema:
  `sha256:9c4262da2cc8620f6297ecdaacb39c6741fdaba3564a4c795da3d5149abab65a`
- Shared formal-pool contract:
  `sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1`
- Product authority and precedence remain unchanged.
- Phase 1 remains paused. This plan does not authorize Task 1-8, feature capture, restart-artifact
  publication, production, real canary, or upstream traffic.

This document is the compact Phase Acceptance Contract and implementation plan for the delivery
mechanism transition. Implementation begins only after operator approval and the real expected-RED
rehearsal in Task 0.

## 1. Goal

Replace the Phase 1 repair loop with the minimum executable mechanics required by Delivery
Operating Model v2:

1. derive immutable Program Baseline Envelope authority separately from short-lived Run Lease
   state without creating another schema family;
2. execute the real pinned Phase 1 replay-to-artifact transaction before an authority repair can
   merge;
3. separate reviewed launcher/runtime authority from replay-mutable product files;
4. retain existing security and evidence controls that already work;
5. cap the transition at one implementation wave, one integrated review, and one closure wave;
6. produce a transition exit report that is the sole input to a later Phase 1 Recovery Plan.

## 2. Non-Goals

The transition MUST NOT:

- complete or restart Phase 1;
- modify CC Gateway or Sub2API product behavior;
- modify the shared formal-pool contract;
- create a generic all-phase JSON Schema, receipt chain, registry family, or signing service;
- rewrite the existing Phase 1 plan or manufacture authority-repair instance `0003`;
- rerun Task 7 or Task 8 evidence capture;
- require three identical full-suite runs;
- delete a worktree, cache, bundle, branch, or evidence artifact;
- read, modify, stage, or commit
  `backend/internal/service/openai_compact_sse_keepalive_test.go`.

## 3. Frozen Discovery

### 3.1 Current Real Failure

The preserved real transaction reached these replay heads:

- CC Gateway: `56c79205f70f2c57b2f703cf51dfad4ea2a7943f`
- Sub2API: `5ccc8b3166f058ab286c448b596456db64c9ea56`

The exact reviewed launcher `build` command then exited nonzero with
`authority_restart_runtime_binding_mismatch`; canonical restart artifact
`docs/superpowers/evidence/phase-1/phase-1-authority-restart-0002.json` was absent.

The contradiction is observable in current code, controller behavior, and pinned replay history:

- `tools/oracle-lab/phase-1-authority-bootstrap.mjs` includes `package.json` in
  `RUNTIME_PATHS` and requires working bytes to equal fetched main;
- source commit `beabd36547daa6236c1caa142a0a1b5a926bbde3` legitimately modifies
  `package.json` as part of Task 7;
- the reviewed transaction invokes `build` only after that commit is replayed and launches the
  reviewed entry point from the CC replacement root, conflating tool authority with replay product
  state.

This prior result is discovery evidence, not current execution authority. Task 0 MUST reproduce it
in disposable roots before an implementation edit.

### 3.2 Preserved Source Authority

The transition uses these read-only source roots until bundle capture and GREEN rehearsal complete:

| Repository | Preserved root | Branch | Head |
| --- | --- | --- | --- |
| CC Gateway | `/Users/muqihang/chelingxi_workspace/cc-gateway-oracle-phase-1-h1-cache-checkpoint` | `codex/oracle-phase-1-h1-cache-checkpoint` | `d5a711614177906d18486b98ff4c5d45d97e04c7` |
| Sub2API | `/Users/muqihang/chelingxi_workspace/sub2api-oracle-phase-1-v7` | `codex/oracle-phase-1-sub2api` | `20217731da9521f9676434b7bd5f9cb73020c32c` |

The CC source branch is still published at the exact head. The Sub2API source branch is not
published; only the preserved local source root currently carries its exact replay history. Before
any cleanup, Task 0 creates a read-only Git bundle from that clean source root, validates the bundle,
and records its digest outside the repository. Bundle bytes are not committed.

The preserved authorization/replay roots used only to reproduce the existing transaction are:

- `/Users/muqihang/chelingxi_workspace/cc-gateway-oracle-phase-1-v8-52469ac`
- `/Users/muqihang/chelingxi_workspace/sub2api-oracle-phase-1-v8-52469ac`

They MUST remain read-only. Rehearsal clones from them; it does not edit, reset, clean, restore, or
switch them.

### 3.3 Existing Components

CodeGraph discovery at merged main found the reusable control surface:

- generic H0 canonical JSON, safe-artifact, command-result, context, and handoff helpers under
  `tools/oracle-lab/`;
- `tools/oracle-lab/secure-runtime.ts` for reviewed Git and startup-environment controls;
- `tools/oracle-lab/bounded-repository-state.ts` and
  `tools/oracle-lab/ignored-path-inventory.ts` for declared state transitions;
- `tests/suite-process-runner.ts` for serial process isolation;
- Phase 1 execution-context schema v2 with initial and successor modes;
- the authority-restart semantic validator, exact source mappings, projected-tree checks, and
  pre/post-commit validation.

The existing H0 run-manifest schema is hard-coded to Phase 0 entry/exit. It MUST remain immutable;
the transition does not pretend that it is a generic Baseline Envelope schema.

## 4. Control Disposition

| Existing control | Disposition | Transition rule |
| --- | --- | --- |
| Governing precedence, registry, Claim Matrix, shared-contract digest | Retain | No authority change. |
| `secure-runtime`, bounded repository state, ignored inventory, safe artifacts | Retain | Reuse directly; no forked implementation. |
| Exact RED leaf/family/lifecycle validation | Retain | Still required for P1 Recovery, not rerun by this transition. |
| Serial full-suite process isolation | Retain | One stable run after vertical GREEN; repetition needs a named hypothesis. |
| Phase 1 context schema v2 | Retain as physical carrier | Derive immutable envelope and mutable lease projections; do not add schema v3. |
| Initial and successor context review behavior | Simplify | Same-state refresh and declared successor transitions never reopen baseline review. |
| Authority-restart source mappings and projected-tree validation | Retain | Use exact instance `0002` mappings only for the preserved P1 recovery transaction. |
| Launcher runtime equality | Simplify | Make the clean reviewed tool root a distinct mandatory role; replacement-tree bytes never select launcher or dependency authority. |
| Holistic review after every lease renewal | Retire | Lease renewal is a focused state check only. |
| Universal three-run full-suite rule | Retire | T3 follows a declared confidence/flakiness budget. |
| Prose-regex planning checks as vertical proof | Retire | They may check documentation presence but cannot authorize integration. |
| Authority-repair instances `0001` and `0002` as future templates | Retire after P1 Recovery | Preserve history; do not generate `0003`. |
| Task 7/8 evidence capture and registry transition | Defer | Owned by the later P1 Recovery Plan. |
| Generic all-phase envelope/lease schema | Defer | Add only when a later accepted phase transaction proves the need. |
| Worktree and cache deletion | Defer | Requires a separate operator-approved cleanup action. |

## 5. Transition Acceptance Contract

### 5.1 State Machine

```text
candidate
  -> source_authority_frozen
  -> expected_red_confirmed
  -> implementation_complete
  -> vertical_green_confirmed
  -> review_decided
       -> integrated_reviewed                         (zero Critical/Important)
       -> closure_required -> closure_green_confirmed (one C/I batch)
                           -> integrated_reviewed      (zero Critical/Important)
  -> merged_green_confirmed
  -> transition_accepted
```

The only branch is the objective integrated-review verdict. Zero Critical/Important proceeds
directly; a nonzero result permits exactly one closure path. A material finding after closure stops
the transition and does not create another repair instance.

The following block is the executable transition contract. Its JSON bytes are parsed from the
committed reviewed plan between the exact markers. Array order is normative. For each row,
`transition_contract_digest` is SHA-256 of its canonical JSON and `permitted_delta_digest` is
SHA-256 of canonical JSON of its `allowed_delta` array. IDs, commands, conditions, and deltas are
never supplied by the caller.

<!-- ORACLE_DELIVERY_TRANSITIONS_BEGIN -->
```json
[
  {"id":"DM-01","from":"candidate","to":"source_authority_frozen","command":"freeze-source-authority","condition":"always","allowed_delta":["external:add:cc-source.bundle","external:add:sub2api-source.bundle","external:append:controller-log"]},
  {"id":"DM-02","from":"source_authority_frozen","to":"expected_red_confirmed","command":"reproduce-real-red","condition":"exact-authority-restart-runtime-binding-mismatch","allowed_delta":["disposable:add:cc-replay-root","disposable:add:sub2api-replay-root","external:append:controller-log","forbid:restart-artifact"]},
  {"id":"DM-03","from":"expected_red_confirmed","to":"implementation_complete","command":"implement-declared-nine-path-wave","condition":"focused-tests-green","allowed_delta":["git:implementation-root:declared-nine-paths","git:implementation-root:max-four-commits"]},
  {"id":"DM-04","from":"implementation_complete","to":"vertical_green_confirmed","command":"run-real-green-transaction","condition":"t0-t1-t2-green","allowed_delta":["disposable:add:cc-green-root","disposable:add:sub2api-green-root","external:add:transaction-record","git:implementation-root:none"]},
  {"id":"DM-05","from":"vertical_green_confirmed","to":"review_decided","command":"run-bounded-integrated-review","condition":"review-verdict-recorded","allowed_delta":["external:add:review-verdict","git:implementation-root:none"]},
  {"id":"DM-06A","from":"review_decided","to":"integrated_reviewed","command":"accept-zero-material-findings","condition":"critical-important-zero","allowed_delta":["state-only"]},
  {"id":"DM-06B","from":"review_decided","to":"closure_required","command":"apply-one-closure-batch","condition":"critical-important-nonzero","allowed_delta":["git:implementation-root:declared-nine-paths","git:implementation-root:max-one-closure-commit"]},
  {"id":"DM-07","from":"closure_required","to":"closure_green_confirmed","command":"rerun-green-and-closure-review","condition":"t0-t1-t2-green-and-critical-important-zero","allowed_delta":["disposable:add:cc-closure-root","disposable:add:sub2api-closure-root","external:add:closure-transaction-record","external:add:closure-review-verdict","git:implementation-root:none"]},
  {"id":"DM-08","from":"closure_green_confirmed","to":"integrated_reviewed","command":"accept-closure","condition":"critical-important-zero","allowed_delta":["state-only"]},
  {"id":"DM-09","from":"integrated_reviewed","to":"merged_green_confirmed","command":"merge-and-rerun-real-green","condition":"ordinary-merge-and-t2-green","allowed_delta":["git:remote-main:ordinary-merge","disposable:add:cc-merged-root","disposable:add:sub2api-merged-root","external:add:merged-transaction-record"]},
  {"id":"DM-10","from":"merged_green_confirmed","to":"transition_accepted","command":"commit-transition-exit-report","condition":"operator-accepts-exit","allowed_delta":["git:remote-main:add:docs/superpowers/evidence/delivery-model/delivery-mechanism-transition-exit-report.md"]}
]
```
<!-- ORACLE_DELIVERY_TRANSITIONS_END -->

`declared-nine-paths` is exactly the four Create paths and five Modify paths enumerated by Tasks
1-3. A closure batch cannot add a tenth path.

### 5.2 Program Baseline Envelope

For this transition, the envelope is a canonical in-memory projection plus a digest in the
controller log and transaction record. No new persisted envelope schema is introduced. It binds:

- exact Operating Model, roadmap, transition-plan, and product-authority digests;
- exact CC Gateway and Sub2API main commits and remote URL digests;
- exact preserved authorization, replay-source, and replay-head commits;
- shared-contract digest;
- exact existing Phase 1 plan-review and execution-context schema digests;
- disabled production, upstream, canary, feature-capture, and profile-promotion capabilities;
- one transition identifier and the real transaction definition below.

The committed transition-plan digest is computed from `git show <reviewed-plan-commit>:<path>`
during implementation preflight. It is never embedded into its own bytes or supplied as an
unverified caller value.

Any change to those inputs requires a replacement envelope and one re-run of expected RED before
implementation continues. Expiry alone never changes the envelope.

### 5.3 Run Lease

Before `DM-01`, the controller derives the envelope from committed plan bytes and live frozen inputs,
selects the exact `DM-01` row from the bound transition block, and issues an in-memory sequence-zero
lease. No bundle, disposable root, or implementation edit may exist first.

For this transition, each in-memory lease is the canonical object:

```text
envelope_digest
sequence
state
transition_id
transition_contract_digest
permitted_delta_digest
predecessor_lease_digest
issued_at
expires_at
repository_heads_and_clean_state_digests
observed_delta_digest
```

`predecessor_lease_digest` is `null` only for sequence zero. `observed_delta_digest` is empty before
the command and is replaced by the digest of canonical concrete delta records only when issuing the
successor. `permitted_delta_digest` binds the policy tokens; it is not a digest of concrete records.
For each closed command ID, the validator interprets those bound tokens and proves the concrete
records are exactly permitted or a permitted subset where the token explicitly defines a maximum.
Every `forbid:*` assertion must remain absent. No caller supplies an interpreter or exception.
Lease digests are appended to the controller log and final transaction record but no lease file is
persisted.

The existing Phase 1 execution-context JSON remains the later P1 Recovery physical carrier for
repository observations and time bounds. The transition adds pure projection and validation
functions:

- `derivePhase1BaselineEnvelope` includes only fields that must remain identical across the context
  chain: plan, planning provenance, approval, gate schemas, baseline/remote identities, shared
  contract, authority order, selected requirements, branch identity, and disabled capabilities;
- `derivePhase1RunLease` combines sequence, mode, stage, artifact path, predecessor, issue/expiry,
  authorized parent heads, clean-state observation, and validation status from existing context
  bytes with the exact transition row selected from the committed Phase 1 Recovery Plan;
- `validatePhase1LeaseSuccessor` requires the predecessor digest, contiguous sequence, unexpired
  execution, exact contract-declared transition, observed allowed delta, resulting clean heads, and
  unique next state;
- same-state refresh may change only time and revalidated live observations;
- a valid successor may advance head and state without reopening the envelope review;
- an immutable projection change fails and requires a replacement envelope.

The transition identifier, state edge, command, condition, and permitted delta always come from the
reviewed plan transition block, never from existing context bytes or a caller. These functions
validate existing bytes plus that bound row. They do not mint a new context, overwrite a context,
or change schema v2.

### 5.4 Real Vertical Transaction

The transaction uses the actual instance `0002` authorization and source histories:

1. validate the preserved source and authorization roots and freeze bundle digests;
2. create one exclusive disposable CC root and one exclusive disposable Sub2API root;
3. reproduce the authorization bases without copying untracked or ignored state;
4. replay the exact compiled eight CC and ten Sub2API source commits in order;
5. prove projected-tree, patch-id, parent, path/mode, and protected-path intersection rules;
6. enter `tool_runtime_isolated` by invoking the launcher from a separate clean reviewed tool root;
7. build the canonical restart artifact, validate it pre-commit, create its one-path local rehearsal
   commit, and validate it post-commit;
8. emit a safe transaction record containing only commits, digests, classifications, elapsed time,
   and cleanup paths.

Before implementation, the legacy transaction has no enforced `tool_runtime_isolated` transition:
it launches from the disposable replay replacement root and Step 6 MUST stop at the exact current
`authority_restart_runtime_binding_mismatch`, with all earlier steps successful and no artifact.
Implementation adds and enforces that missing transition. After implementation, the same ordered
transaction uses its distinct reviewed tool root and all eight steps MUST pass from newly created
disposable roots. A focused fixture or a prebuilt replay head cannot substitute for this GREEN
transaction.

### 5.5 Authority and Mutability Matrix

| Path class | Authority | Replay behavior |
| --- | --- | --- |
| Launcher, bootstrap, authority tool, secure runtime, restart schema | Reviewed clean tool-root commit and fetched upstream ref | Never loaded from or validated against replacement-tree working bytes. |
| `package.json`, `package-lock.json` used to install authority-tool dependencies | Bytes read from the reviewed tool-root commit and materialized in an exclusive temporary dependency root | Working replacement bytes are never dependency authority. |
| Product and Task 7 paths, including replayed `package.json` | Exact compiled source commits and projected-tree policy | May change only through the declared replay sequence. |
| Source bundles | Validated preserved source roots plus recorded bundle digests | Read-only; never committed or used as review authority. |
| Restart artifact | Real transaction output | Exists only after GREEN build, then one-path rehearsal commit. |

The implementation MUST bind the tool-root path set and exact replay changed-path union before
spawning the first replay command. It MUST reject a tool-root/replacement-root alias. A relative-path
overlap such as replayed `package.json` is permitted only because the two canonical roots differ and
dependency authority bytes come exclusively from the reviewed tool commit.

### 5.6 Permitted Deltas

- source roots: none;
- reviewed tool root: none during one transaction run;
- disposable replacement roots before artifact build: exact replay commits only;
- CC pre-commit state: exactly the canonical untracked restart artifact;
- CC post-commit state: exactly one child commit adding that artifact;
- Sub2API post-replay state: clean exact replay head;
- external evidence root: source bundles and one transaction record only;
- network: no real upstream traffic; Git fetch is a separate preflight action, not part of T2.

## 6. One-Wave Implementation

### Task 0: Freeze Inputs and Reproduce the Real RED

Files changed: none.

1. Fetch both remotes and freeze actual main commits without changing an operator checkout.
2. Compute the committed transition contract, freeze the envelope, and issue the sequence-zero
   `DM-01` lease before creating any output.
3. Validate the four preserved roots and create/verify read-only source bundles outside the repo;
   validate the observed delta and issue the `DM-02` successor lease.
4. Create exclusive disposable rehearsal roots.
5. Replay the exact compiled histories.
6. Reproduce the legacy launch from the disposable CC replacement root and require exactly
   `authority_restart_runtime_binding_mismatch` after replay, with no restart artifact.
7. Validate the `DM-02` observed delta and condition, record command, heads, bundle digests, failure
   code, and absence of artifact, then issue the `DM-03` successor lease. Any earlier or different
   failure is accidental regression and blocks implementation.

### Task 1: Extract Envelope and Lease Semantics

Create:

- `tools/oracle-lab/delivery-authority.ts`
- `tests/oracle-lab-delivery-authority.test.ts`

Modify:

- `tests/oracle-lab-phase-1-planning.test.ts`

Requirements:

- parse the exact committed transition JSON markers and reject duplicate IDs, malformed rows,
  ambiguous conditional successors, unknown commands, and noncanonical ordering;
- build and validate the exact in-memory lease object and per-row digests defined in Section 5;
- canonical immutable and lease projections over existing context bytes;
- digest-chained same-state refresh and successor validation;
- exact rejection of immutable drift, skipped/duplicate sequence, wrong predecessor, expired
  execution, undeclared head/state advance, dirty result, and ambiguous next state;
- planning test consumes the shared functions instead of maintaining a second implementation;
- no schema or evidence artifact is added.

Focused command:

```bash
npm exec tsx tests/oracle-lab-delivery-authority.test.ts
```

### Task 2: Separate Tool Runtime From Replay Product State

Modify:

- `tools/oracle-lab/oracle-phase1-authority-restart`
- `tools/oracle-lab/phase-1-authority-bootstrap.mjs`
- `tools/oracle-lab/phase-1-authority-restart.ts`
- `tests/oracle-lab-phase-1-authority-restart.test.ts`

Requirements:

- launcher authority is the exact clean tool-root commit and its fetched upstream ref;
- tool-root `HEAD` must equal its fetched `muqihang` upstream branch, and the remote URL digest must
  match reviewed authority; neither commit nor ref is caller-selected;
- the launcher rejects a canonical tool-root/replacement-root alias before dependency preparation;
- the dependency-free bootstrap parses the exact root flags and resolves only canonical root
  identity for that alias check before dependency preparation; it reads no replacement content at
  that point, and source validation still precedes all replacement-content inspection;
- executable runtime files are read once under stable metadata checks and must match that commit;
- authority dependency `package.json` and lock bytes come from that reviewed commit, are materialized
  only in the exclusive temporary dependency root, and are never read from a replacement root;
- replay roots are inspected only after source and tool authority validation;
- protected executable path versus replay-changed-path intersection is checked before replay;
- mutation tests cover replacement `package.json` and lock changes, root aliasing, tool-root drift,
  upstream-ref drift, dependency-byte substitution, symlink/special file, and post-snapshot races;
- no caller-selected commit, exclusion, source mapping, or environment fallback is added.

Focused command:

```bash
npm exec tsx tests/oracle-lab-phase-1-authority-restart.test.ts
```

### Task 3: Add the Real Transaction Driver

Create:

- `tools/oracle-lab/phase-1-transition-rehearsal.ts`
- `tests/oracle-lab-phase-1-transition-rehearsal.test.ts`

Requirements:

- closed CLI accepts only explicit tool, source, authorization, replacement-parent, and output
  roots; source mappings and commit lists remain compiled authority;
- the tool root and both replacement roots must have distinct canonical realpaths;
- replacement and output roots must be absent and are exclusively created mode `0700`;
- all Git operations use reviewed Git with closed environment and no hooks, replacements, global
  config, signing prompt, or network fallback;
- the driver performs the complete transaction in Section 5.4 serially;
- it never edits the preserved roots or persists their absolute paths;
- failure removes nothing automatically and reports exact retained cleanup roots;
- the focused test uses temporary Git graphs for mutation coverage, while the mandatory T2 command
  uses the real preserved commits and roots.

Focused command:

```bash
npm exec tsx tests/oracle-lab-phase-1-transition-rehearsal.test.ts
```

### Task 4: Integrated Verification and Transition Exit

Run strictly serial on one immutable candidate tip:

```bash
npm exec tsx tests/oracle-lab-delivery-authority.test.ts
npm exec tsx tests/oracle-lab-phase-1-authority-restart.test.ts
npm exec tsx tests/oracle-lab-phase-1-transition-rehearsal.test.ts
SUB2API_ROOT=<clean-sub2api-root> npm exec tsx tests/oracle-lab-phase-1-planning.test.ts
npm run build
<real phase-1-transition-rehearsal command from Task 3>
SUB2API_FORMAL_POOL_CONTRACT_PATH=<clean-contract-root>/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json npm test
```

The real rehearsal MUST be GREEN before integrated review. One reviewer covers code/runtime
correctness. A second reviewer covers the cross-repository transaction and authority projection.
All genuine Critical and Important findings are batched once; Minor findings enter the exit report.
One closure review is allowed. A further loop is forbidden unless that batch introduced a directly
reproducible Critical regression.

After merge, rerun the real transaction from fresh disposable roots using the merged main tool
root. Then create:

```text
docs/superpowers/evidence/delivery-model/delivery-mechanism-transition-exit-report.md
```

The report records the merged heads, plan/model digests, bundle digests, tool-root commit, RED and
GREEN classifications, test results, review verdicts, resource use, retained roots, cleanup
candidates, and the exact entry conditions for the Phase 1 Recovery Plan. It contains no raw logs,
credentials, absolute persisted source paths, or upstream material.

## 7. Commit Boundaries

The implementation wave uses at most four commits:

1. `test(oracle): reproduce delivery authority lifecycle gaps`
2. `feat(oracle): derive baseline envelope and run leases`
3. `fix(oracle): separate authority runtime from replay state`
4. `test(oracle): prove the real replay transaction`

The exit report is a separate post-merge evidence commit only after merged-main GREEN. Task commits
may be combined when the diff is smaller, but the wave may not exceed these boundaries or introduce
another plan-repair branch.

## 8. Resource Budget and Cleanup Candidates

The transition may use only:

- this planning/implementation worktree;
- the two preserved source roots;
- the two preserved `v8-52469ac` authorization/replay roots;
- one disposable replacement pair at a time;
- one command-scoped tool dependency root and cache;
- one external source-bundle/evidence root.

No parallel broad suites are allowed. Before T2, require at least `8 GiB` free. If free space falls
below the floor, stop before creating rehearsal roots.

After source bundles validate and the merged transaction is GREEN, these exact paths are cleanup
candidates, not automatic deletions:

```text
/Users/muqihang/chelingxi_workspace/cc-gateway-oracle-delivery-model-v2
/Users/muqihang/chelingxi_workspace/cc-gateway-oracle-phase-1-archival-ref-fix
/Users/muqihang/chelingxi_workspace/cc-gateway-oracle-phase-1-fresh-clone-ref-fix
/Users/muqihang/chelingxi_workspace/cc-gateway-oracle-phase-1-source-first-fix
/Users/muqihang/chelingxi_workspace/cc-gateway-oracle-phase-1-v8
/Users/muqihang/chelingxi_workspace/cc-gateway-oracle-phase-1-v8-20b4d63
/Users/muqihang/chelingxi_workspace/cc-gateway-oracle-phase-1-v8-5df77e
/Users/muqihang/chelingxi_workspace/cc-gateway-oracle-phase-1-v8-8cf4251
/Users/muqihang/chelingxi_workspace/sub2api-oracle-phase-1-v8
/Users/muqihang/chelingxi_workspace/sub2api-oracle-phase-1-v8-20b4d63
/Users/muqihang/chelingxi_workspace/sub2api-oracle-phase-1-v8-5df77e
/Users/muqihang/chelingxi_workspace/sub2api-oracle-phase-1-v8-8cf4251
```

The source roots and both `v8-52469ac` roots remain protected until the transition exit report and
Phase 1 Recovery baseline both bind validated bundle digests. Deletion and branch removal require a
separate operator-approved cleanup action.

## 9. Stop Rules

Stop the transition without another repair wave when:

- Task 0 does not reach the exact expected RED;
- a preserved source commit, branch, remote identity, or bundle is unavailable or inconsistent;
- implementation requires a new schema family, caller-selected source mapping, or hidden ref;
- the real transaction requires editing a preserved root;
- GREEN depends on inherited host environment, a manual cache warmup, or a substituted product file;
- one closure review still has a Critical or Important finding;
- resource use exceeds the declared root or disk budget.

The next action after a stop is architecture simplification and operator decision, not another
authority-repair PR.

## 10. Exit Gate

The transition is accepted only when:

- the exact historical RED is reproduced before implementation;
- the same real transaction is GREEN before review and after merge;
- envelope and lease projections reject every declared mutation;
- reviewed tool authority remains valid because replayed product `package.json` is in a distinct
  replacement root;
- no preserved source or operator checkout changed;
- focused tests, build, one closed full suite, and both bounded reviews pass;
- the transition exit report is committed on merged main;
- cleanup candidates are reported but not deleted;
- P1 remains paused and the report explicitly authorizes only drafting a Phase 1 Recovery Plan.

Only a separately approved Phase 1 Recovery Plan may use the transition exit report to resume work.

## 11. Self-Audit

| Risk | Closure in this plan |
| --- | --- |
| The expected RED uses a different scenario from final GREEN | Both use the same preserved authorization and exact 8+10 replay histories; implementation owns the missing `tool_runtime_isolated` transition. |
| A clean tool root silently becomes caller authority | Tool `HEAD`, fetched upstream ref, remote identity, committed plan, and runtime bytes are envelope-bound; caller-selected commits are forbidden. |
| Sub2API replay objects disappear during cleanup | The unpublished source branch is bundled and verified before any cleanup candidate can be approved. |
| Existing Phase 0 schemas are broadened into a migration project | No schema is changed or added; the Phase 1 context remains the physical carrier and projections are pure. |
| Lease transition authority is invented from old context bytes | IDs, commands, conditions, and allowed deltas come only from the committed canonical transition block; context contributes live observations, not authority. |
| Lease renewal triggers another holistic review | Same-state refresh and declared successor validation use the frozen envelope and focused checks only. |
| Synthetic tests replace the failed real state | Temporary-graph tests are T0/T1 only; actual preserved commits and roots are mandatory T2 before review and after merge. |
| A repair finding starts another PR chain | One C/I batch and one closure review are allowed; remaining material findings stop for simplification. |
| Rehearsal consumes uncontrolled disk | One replacement pair at a time, one external bundle root, an `8 GiB` floor, and no parallel broad suite. |
| Cleanup destroys the only reproduction | Protected source and `v8-52469ac` roots remain until bundle and exit-report bindings are accepted; every deletion remains separately approved. |
| Transition accidentally resumes P1 | Exit authorizes only drafting a separately reviewed Phase 1 Recovery Plan; Task 1-8 and feature capture remain paused. |

The plan therefore changes delivery mechanics without changing product authority, Phase 1 feature
scope, the shared contract, or the seven-phase DAG.
