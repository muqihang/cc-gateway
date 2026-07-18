# Oracle Delivery Mechanism Transition Exit Report

Date: 2026-07-18

Status: `merged_green_confirmed`; awaiting operator acceptance of this report.

This report closes the delivery-mechanism transition only. It does not resume Phase 1, authorize
Task 1-8, enable feature capture, or authorize any production, canary, profile-promotion, or real
upstream action.

## 1. Authority

| Authority | Digest or commit |
| --- | --- |
| Delivery operating model v2 | `sha256:a53e7384d6cf353877af82f16196b8d58ed823277e76e03337dfc9fadff7d0ea` |
| Seven-phase roadmap | `sha256:00519348d9dd8972dbea92a647d67c2fc42e9015ece6dcb0eb427df02480b107` |
| Delivery transition plan | `sha256:f21023b1d6705855e00ee0f9ceafc78c6cf1c7b928982fd88e821faffa7a8111` |
| Reviewed transition contract | `sha256:08952a6f2ba48b671b6f8792651040a7292e2a2a4bc8036d8d9e851dc6e46463` |
| Shared contract | `sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1` |
| CC Gateway transition base | `4b45c7f905a228dd9f9000ee7694bb36a898cea4` |
| Initial implementation tip | `497bea4ec1887b513628a69f2faaa86f30ff9a0b` |
| Final single closure commit | `71b50571b9bcd677fd43b4e4b487a219519c2ed9` |
| Merged CC Gateway main | `8380f28fe91ac13cd7a445553b97208ca4d81b33` |
| Frozen Sub2API main | `b0b77933716487da5fca00329443f88ce9a1c3db` |

The final closure commit is the sole non-merge child of the initial implementation tip. Its tree
OID is `9b7f61f064d33afed554d6efc3f47844701a3cef`. PR #23 merged it by an ordinary merge commit.

## 2. Preserved Inputs

| Input | Safe digest |
| --- | --- |
| CC Gateway source bundle | `sha256:27e9e3cea6a2d18eb1e6423e9e7589aa53b5779fcf71a55008bbdbca838c9fd3` |
| Sub2API source bundle | `sha256:3df0933834ed3bcc692b421e317c19314c1594492571a4abeae84375152fe47e` |
| Canonical controller chain v2 | `sha256:065a46df3dfef814687b06abc8f73c59b8802fcc1c739ca20b651da4be382edd` |

The canonical controller chain has ten records and ends at sequence 9,
`merged_green_confirmed / DM-10`. It supersedes the original controller log because the final delta
interpreter requires every allowed token and the final topology requires one combined closure
commit. The original log, its rejected incorrect closure identity, and the later superseded closure
lease remain retained as transparent historical evidence.

## 3. RED And GREEN Classification

The pre-implementation real transaction reproduced the expected RED after the exact 8 CC Gateway
and 10 Sub2API replay sequence:

- classification: `authority_restart_runtime_binding_mismatch`;
- process result: nonzero;
- restart artifact: absent;
- preserved inputs: unchanged.

The same vertical transaction then reached GREEN with isolated tool authority. Safe transaction
records are:

| Stage | Tool authority | Transaction digest | Result |
| --- | --- | --- | --- |
| Initial implementation | `497bea4ec1887b513628a69f2faaa86f30ff9a0b` | `sha256:3be5f516ac99c2668a0cf354cdd1bd4425948d8a623c53ad13c5e4ae83d05d80` | GREEN, 8/10 replay |
| Final closure | `71b50571b9bcd677fd43b4e4b487a219519c2ed9` | `sha256:c0e50fef402b64910535a725c18c298e2469093591823c5d9762038c112517ba` | GREEN, 8/10 replay |
| Merged main | `8380f28fe91ac13cd7a445553b97208ca4d81b33` | `sha256:f5326ec6b055b30ababbab548018bcc5bf8233e23c690917bdaf197af3c46963` | GREEN, 8/10 replay |

Each GREEN run created exactly one restart-artifact commit in the disposable CC Gateway root,
left both replacement roots clean, and revalidated preserved inputs after writing the transaction
record.

## 4. Verification

Final-tip verification ran strictly serially:

- delivery authority: 5 passed, 0 failed;
- authority restart: passed;
- transition rehearsal: 5 passed, 0 failed;
- Phase 1 planning: 22 passed, 1 intentional skip, 0 failed;
- TypeScript build: passed;
- CodeGraph: current, 131 files, 5,187 nodes, 20,207 edges.

The one closed full-suite run required by the transition passed before integrated review:

- P0.1 governance: 111/111;
- product tests: 354/354;
- Node harness: 59 passed, 1 intentional skip, 0 failed.

Closure reran only the intersecting focused and real-transaction gates, as required by the bounded
review policy; it did not add ceremonial full-suite repetitions.

## 5. Review

The first bounded integrated review reported 0 Critical, 5 Important, and 1 Minor finding. All five
Important findings were handled as one closure wave. Final runtime and transaction reviewers each
returned 0 Critical, 0 Important, and 0 Minor with `ACCEPT / GREEN` on the exact final tree and
single-commit topology.

Accepted nonblocking ledger item:

- `DM-TX-M01`: hook suppression is configured after the initial replacement-root branch switch.
  This is bounded hardening debt and must not reopen the completed transition.

## 6. Resource And Preservation State

At exit-report drafting time:

- the external transition evidence root used approximately 1.5 GiB;
- the final implementation checkout used approximately 64 MiB;
- the merged-main checkout used approximately 67 MiB;
- approximately 23 GiB remained free on the data volume.

The source roots and both `v8-52469ac` roots remain protected. They must remain until a Phase 1
Recovery baseline binds both validated source-bundle digests. No cleanup was performed by this
transition.

Cleanup candidates, subject to a separate destructive-operation approval, are:

- the twelve exact legacy paths listed in transition plan section 8;
- superseded transition implementation checkouts ending in `transition-impl` and
  `transition-final` after this report is integrated;
- disposable rehearsal/output roots ending in `green-497bea4`, `closure-8994b84`,
  `closure2-4c32e09`, `final-71b5057`, and `merged-8380f28` after their safe record digests are
  bound by the Recovery baseline;
- command-scoped dependency and npm-cache roots retained under the reviewed temporary-root prefix.

## 7. Phase 1 Recovery Entry Contract

Operator acceptance of this report authorizes only drafting a separate Phase 1 Recovery Plan. That
plan must be independently approved before any Phase 1 mutation or execution. Its entry gate must:

1. fetch and freeze current `muqihang/main` for both repositories without assuming the heads in
   this report are still current;
2. bind this report, the operating model, transition plan, roadmap, shared contract, and both source
   bundle digests in a new Program Baseline Envelope;
3. define a compact Phase Acceptance Contract with one real Phase 1 vertical transaction, exact
   expected RED, permitted deltas, resource budget, stop rules, and unique successors;
4. create fresh clean implementation worktrees and current per-worktree CodeGraph indexes;
5. reject every pre-transition review receipt, execution context, restart artifact, and replay
   authorization as historical-only evidence;
6. reproduce the exact B4-B6 canonical RED leaf names, counts, families, ordering, and parser
   lifecycle before implementation resumes;
7. issue a sequence-zero Run Lease from the new immutable envelope and require chained successor
   leases for ordinary task-boundary head advances;
8. keep production, real canary, real upstream, feature capture, and profile promotion disabled;
9. specify which preserved roots may be retired only after validated bundles and necessary Git
   objects are rehydrated in the fresh Recovery environment;
10. obtain explicit operator approval of the Recovery Plan before Task 1-8 begins.

Until those conditions are met, Phase 1 remains paused. This report makes no claim that Phase 1 is
complete, that Task 7 or Task 8 evidence is current, or that any behavior is production-compatible.
