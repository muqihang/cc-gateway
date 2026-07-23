# Claude Code 2.1.215 P3A-S Static Blocker Recon v1

## Decision

This append-only static recon closes both controller-creation blockers at the metadata/anchor
layer:

- `missing_exact_state_protocol`: **CLOSED** at evidence level `Static-Recovered`.
- `missing_state_dependent_network_signal`: **CLOSED** at evidence level `Static-Recovered`.

The closure does not authorize a controller, target execution, a dynamic supplement, or Phase 3B.
`phase3b_usable` and `dynamic_execution_authorized` remain `false`. A separate reviewed decision is
required before any controller may be created.

The canonical authority record is
`docs/superpowers/evidence/phase3a/claude-code-2.1.215-p3as-static-blocker-recon-v1.json`:

- exact-file SHA-256, including final LF:
  `963038e5629646c2c101b4f81014ab9abd6001f8688175544c07e01f74a86df3`
- internal JCS digest, excluding `record_digest`:
  `731be5a8cba26f5ee867fd46e9798eaec5d8b2ea4e5b77d92fae0648c42143dd`
- schema SHA-256:
  `3c2d28fa8a72956b2c59003e8ac15ec146bb334149a8ea136a5e658bb7e40a0c`
- recon tool SHA-256:
  `019b9377c9508e7a6f9fd8e9d6154ab312403ce34254225a0ba405121f3a70ae`

## Authority And Inputs

The recon binds the merged P3A-S plan predecessor at commit
`7a61020761216e3d80ce76f5e2b253f7e2c16a52`, tree
`d1d99adad0a40b167fd6bc92b1bc0be167280617`, and pre-amendment plan SHA-256
`c13969d1d838e3a921eda8d7a0491fa0472ed35f15bb3ea7374a7b3d153059a6`.
It also binds the Phase 3B authority predecessor SHA-256
`0687ccaea710647a357993aaefc389078d68f54c2d5ae51f6710d63c2e3906d3`.

Fresh main assertions used for this recon:

| Repository | Commit | Tree |
| --- | --- | --- |
| CC Gateway | `7a61020761216e3d80ce76f5e2b253f7e2c16a52` | `d1d99adad0a40b167fd6bc92b1bc0be167280617` |
| Sub2API | `fb840673afc0ff590fef9bb147fce5b9b70eb098` | `eeb8654eddf7a4c38364202f5024161e65d2a6d1` |

CodeGraph was refreshed in isolated worktrees with local-only exclusion config SHA-256
`f885ea40698ff4de9881ce6a9537388ce80c04be9515bf2c77ac186d39140e98`.

| Repository | Files | Nodes | Edges | Protected count |
| --- | ---: | ---: | ---: | ---: |
| CC Gateway | 262 | 9,229 | 32,322 | 0 |
| Sub2API | 3,064 | 98,766 | 331,888 | 0 |

Only the five plan-authorized v13 safe closure fixtures were validated. Their absolute root is not
persisted; the record stores root safe ref
`sr1:root:sha256:3a6aa8c5ed6cf64b1edc584931b3e7ee774a5a2ea6a35fe428f5dd862fa058bf`
plus exact relative path, SHA-256, schema, regular-file, realpath-containment, and no-symlink
checks. No raw P3A artifact was opened.

## Target Identity

The independently copied official Darwin arm64 release has these identities:

| Object | Static identity |
| --- | --- |
| release archive | `599883973d2b4c8bb25e3490c84d65646f78d158cdc86adc73c1f5a6cfbbd600` |
| unpacked release tree | `f5a04795289524b639b479fe6ffac187218d7c558a5a5be312ee228850c6e7fe` |
| direct launcher/executable | archive-relative `claude` |
| executable | `90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58`, 247,124,336 bytes |
| format | thin arm64 Mach-O 64-bit PIE |
| signature | valid; identifier `com.anthropic.claude-code`; team `Q6L2SF6YDW` |
| Bun entry module | artifact offset 217,140,984; 20,163,513 bytes; SHA-256 `67472f5f9cd28b3b83003eb29ee0747bdcebc6969cc14f726bfdae2e4d998d0f` |

The version function `qb` contains the exact `2.1.215` discriminator. No 2.1.207 source,
launcher, or state behavior was relabeled into this result.

## Exact State Protocol

The following is the exact approved token ordering. Values represented by `<safe-ref>` are frozen
launch-manifest inputs and are not persisted in this report.

```text
creation:
  --print --bare --verbose --output-format stream-json --input-format stream-json
  --session-id <creation-session-uuid-safe-ref>

new-control:
  --print --bare --verbose --output-format stream-json --input-format stream-json
  --session-id <new-control-session-uuid-safe-ref>

resume-positive:
  --print --bare --verbose --output-format stream-json --input-format stream-json
  --resume <predecessor-session-uuid-safe-ref>
```

All options precede any separator. There is no positional prompt. Synthetic input is supplied only
as manifest-bound stream-json stdin with an exact digest. `--continue`, `--fork-session`, and
`--no-session-persistence` are prohibited for these three operations. A resume combined with a
new `--session-id` is also prohibited unless forking, and forking is outside this protocol.

The isolated launch environment reuses `buildIsolatedEnvironment` and `runCell` semantics:

- manifest allowlist contains only `PATH`, `TERM`, the two loopback API-base keys, placeholder
  `ANTHROPIC_API_KEY`, nonessential-traffic disablement, and upper/lower loopback `NO_PROXY`;
- `HOME`, `CLAUDE_CONFIG_DIR`, XDG config/cache/data/state, all temp keys, `TZ`, `LANG`, and
  `LC_ALL` are derived inside the isolated root;
- inherited auth, custom-header, cloud bearer, proxy, OAuth, key-fd, and SSH agent variables are
  explicitly unset;
- the executable and stdin SHA-256 are checked before `sandbox-exec` spawn; cwd and env are
  explicit and `shell=false`.

The target state layout is:

```text
NFC(CLAUDE_CONFIG_DIR or homedir/.claude)
  /projects
  /<canonical-real-cwd with non-alphanumeric bytes mapped to hyphen and bounded hash>
  /<session-uuid>.jsonl
```

The writer appends one UTF-8 JSON object plus LF, creates directories at `0o700`, and writes the
file at `0o600`. The reader resolves the project/session file, parses JSONL, reconstructs parent
chains and message metadata, and returns the selected conversation. The target does not perform a
whole-file cryptographic integrity check; malformed lines can be ignored locally. Therefore every
future positive and tamper control must enforce Observer B's independently bound pre-open file
digest. Target parser tolerance cannot be promoted into integrity evidence.

Static deny branches cover missing predecessor, invalid/ambiguous selector, live background
session, wrong resume-message selector, persistence disabled, malformed state, and target load
failure. A fresh-session fallback never satisfies resume.

## State-Dependent Network Signal

The recovered target-generated signal is the ordered predecessor prefix in the JSON AST at
`POST /v1/messages` -> `$.messages`, immediately before the final current input. It is not a
header, session ID, controller digest, ordinary fresh request, or absence inference.

The complete static data/call path is:

```text
K7f -> H1e -> xGe -> QMd -> Wz_ + P1e
K7f/lCS messages -> G7f -> nested WVf -> GVf mutableMessages
submitMessage copies mutableMessages and appends current input
submitMessage -> $ne -> Rtd -> ntd(callModel=Vrr)
Vrr -> nested xad -> JS_ + nested QS_ -> beta.messages.create
beta.messages.create -> SDK create -> POST /v1/messages
```

`G7f -> WVf`, `Vrr -> xad`, and `xad -> QS_` cross nested callback/generator scopes. The record
labels them `nested-*-containment`; it does not falsify them as direct calls. Direct edges are
separately AST-validated.

For a future positive result, Observer A must project the creation request plus fake-upstream
response into an ordered safe conversation topology. The resume request's prefix, excluding the
final current input, must equal that projection and include at least one predecessor assistant
entry. A new-control request must have no such prefix.

The durable projection is limited to role order, array cardinalities, content representation,
content-block type/order/count, object field-name classes, and SSE event-class order. It stores no
scalar content, body bytes, headers, session IDs, credentials, prompt, or transcript.

Two independent observers remain mandatory:

| Observer | Capture surface | What it proves | Independent failure mode |
| --- | --- | --- | --- |
| A | loopback fake-upstream HTTP JSON AST and SSE topology | predecessor conversation topology reached a target-generated request | request/AST/SSE capture missing or topology mismatch |
| B | Darwin vnode open/read plus process-start attribution | exact predecessor JSONL was read by the unique bound target executable/process | vnode event, PID/start, executable, path, or digest attribution mismatch |

Observer A alone cannot prove a filesystem read. Observer B alone cannot prove network
consumption. Only a terminal builder may compare their safe outputs after both exit. Two parsers
over one byte stream remain insufficient.

Negative controls are fixed for missing, tampered, swapped, fresh-fallback, wrong PID/process
start, and nonterminal predecessor state. Every one denies; absence alone never proves resume.

## Static Anchors

The canonical record contains 30 anchors. Each binds function name, TypeScript AST node kind,
module-local offset, artifact offset, byte length, source SHA-256, verified direct-call subset,
branch-kind counts, and CFG-shape digest. Key offsets are:

| Function | Purpose | Module offset | Source SHA-256 |
| --- | --- | ---: | --- |
| `iKf` | CLI grammar | 19,622,567 | `623d51ffe3fedb4abc3e00e03c195ee1592bb2d1747f94a1b5d669722a95e818` |
| `h5f` | CLI combination validation | 19,106,597 | `625c7dcce260d2e0c4fcf1c44854ef713fe7d7c74f7f4ae7675cc2ce2c1e655e` |
| `fy` | state path derivation | 6,522,072 | `e44e389b302645280a316e50bf152216027968172f72de930a4f613cb1ae18d0` |
| `P1e` | JSONL reader | 11,301,639 | `e633b866ee9bf0a22d48cc6551c35c5173542d25937eab9f210fedee44170555` |
| `QMd` | resolver/reader bridge | 11,307,126 | `7bb433e94616cadd6f025188417d8da9d413a7a49d6cbeb24e1313d5f3019064` |
| `xGe` | message reconstruction | 11,307,504 | `d851b253f918b4ce109a359c27e2b3a534662e0f4ebb2c996b0d18f5f185d86a` |
| `K7f` | print/resume router | 19,599,055 | `717281f6c32c5bb0fb0743a1a19091f8d0d68863623df2f0875f91ecff0ed4b8` |
| `lCS` | headless resume bridge | 19,492,798 | `e808df1258fb42d41fa834d72e3b232a705003b5d7f84e2af3ba141b47b060f9` |
| `submitMessage` | mutable-message copy/current-input append | 19,411,314 | `2a0bb542d8548ebb57e66dbcc76b375623304ef7eb05eba1ded445f2839c75ee` |
| `$ne` | query generator bridge | 8,820,900 | `e673e58de7d8e1d0fabfa8564f7856bc157cb719a1dbf4c66a6d6c22ea5f1db1` |
| `Rtd` | query pipeline | 8,822,092 | `7982c0c3c51c230828542580ece7a4ae07b6d905f963cb0c81028ab4950ede98` |
| `xad` | request construction/network sink | 9,317,249 | `018c69239cd500a5109c4f34bf227c58186073698c97ab183a1f90079885eaf1` |
| `QS_` | request message serializer | 9,374,604 | `180d0aa1f003cb27b91179794b6b3f1a33bf3a7739513f77ab1599d678edf744` |
| SDK `create` | exact `POST /v1/messages` route | 446,081 | `d0519d15b85cd6ee9c1a366b9e7dbbfe843290e76d5709a1b42792a1a28cf2e5` |

The module scan digest is
`29ba48326b823b1305b08644f774a2916f0a5313173d41980a20c1e715f2d6e8`.
The scanner parsed 20,163,513 bytes with TypeScript 5.9.3 and persisted no vendor source in the
repository.

## Reproduction And Validation

All commands below are static. `$ENTRY_MODULE` is a verified isolated extraction of the bound
entry-module digest, `$SCAN_OUT` is a new absent scratch path, and `$SAFE_V13_ROOT` is the exact
plan-authorized safe fixture root.

```bash
npm exec tsx tools/oracle-lab/phase3a/static-blocker-recon.ts -- \
  --source "$ENTRY_MODULE" --artifact-offset 217140984 --out "$SCAN_OUT"

npm exec tsx tools/oracle-lab/phase3a/static-blocker-recon.ts -- \
  --scan-input "$SCAN_OUT" --safe-input-root "$SAFE_V13_ROOT" --out "$RECORD_OUT"

npm exec tsx tests/oracle-phase3a-static-blocker-recon.test.ts
npx tsc --noEmit
```

The focused test checks deterministic scanning, missing marker/call-edge denial, exact operation
order, record self-digest, JSON Schema validation, schema/tool digest binding, two-observer
independence, safe projection exclusions, and semantic/schema mutations. Current result:
`42/42 PASS`.

## Negative Capability And Scope

- No Claude Code process was started.
- No dynamic supplement cell or runtime preflight was executed.
- No P3A-S controller or Phase 3B implementation/runtime wiring was created.
- No real upstream, credential, account, proxy, canary, or deployment was used.
- No raw P3A evidence was accessed; only the five safe closure fixtures and safe projections were
  validated.
- The protected keepalive test was not opened, searched, indexed, compiled, changed, staged, or
  committed.
- Runtime success, Observer B host availability, provider TLS equivalence, telemetry/update
  behavior, compact/cache behavior, and non-Darwin platforms remain Unknown or prohibited.

These limits are deliberate. Closing the two static blockers only makes a separately reviewed
controller-creation decision possible; it does not make the dynamic supplement or Phase 3B green.
