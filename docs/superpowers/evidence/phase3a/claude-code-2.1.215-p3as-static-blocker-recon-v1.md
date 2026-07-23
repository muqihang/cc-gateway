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
  `b4f1212584afbeb7d2b59457d778713bd3d8b967bd5a0a48f73c0140f41642ff`
- internal JCS digest, excluding `record_digest`:
  `ea6ec9d5b9d027d5ed434714cfc38b28ecd81af93d7b51d102821d9d5ecba5a9`
- schema SHA-256:
  `d685bc7e71e00a4d0fbfb123004b1a7ac5dced46b279d037ec81ba0651605900`
- recon tool SHA-256:
  `275511cd2a0000bd637ae81ddfe4f4760e5a1d8319e6d424d14ae5eb7773c4b8`

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
| CC Gateway | 264 | 9,362 | 32,675 | 0 |
| Sub2API | 3,064 | 98,766 | 331,888 | 0 |

Only the five plan-authorized v13 safe closure fixtures were validated. The builder performed
`lstat`, no-symlink, regular-file, exact-root `realpath`, containment, SHA-256, JSON parse, and
schema-discriminator checks before emitting any `binding_checks=true`. Their absolute root is not
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

The future isolated launch contract is static-only and remains unauthorized for execution:

- manifest allowlist contains only `PATH`, `TERM`, `ANTHROPIC_BASE_URL`, placeholder
  `ANTHROPIC_API_KEY`, nonessential-traffic disablement, and upper/lower loopback `NO_PROXY`;
- `ANTHROPIC_BASE_URL` must resolve from the `fake-upstream-endpoint` safe ref at the declared
  loopback port, with external socket budget zero. Static SDK precedence is explicit client
  `baseURL`, then `ANTHROPIC_BASE_URL`, then the SDK default; this protocol supplies no explicit
  client override;
- `HOME`, `CLAUDE_CONFIG_DIR`, XDG config/cache/data/state, all temp keys, `TZ`, `LANG`, and
  `LC_ALL` are derived inside the isolated root;
- inherited auth, custom-header, cloud bearer, proxy, OAuth, key-fd, and SSH agent variables are
  explicitly unset;
- the executable and stdin SHA-256 are checked before `sandbox-exec` spawn; cwd and env are
  explicit and `shell=false`.

The target state layout is:

```text
NFC(CLAUDE_CONFIG_DIR when nonempty, otherwise join(homedir, ".claude"))
  / join("projects")
  / join(<project-key>)
  / join(<session-uuid> + ".jsonl")
```

The project key applies JavaScript regex replacement `/[^a-zA-Z0-9]/g` to `-`. If the sanitized
string has at most 200 UTF-16 code units it is used unchanged. Otherwise `.slice(0, 200)` is
followed by `-` and base-36 `abs(js-string-hash(original-cwd))`. This is JavaScript string/UTF-16
behavior, not byte truncation.

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

The complete directed state-to-network data-flow path is:

```text
Wz_ resolved path + P1e parsed return -> QMd
QMd state-map return -> xGe reconstructed conversation -> H1e resume state
H1e return -> K7f messages return -> lCS messages argument -> G7f
G7f nested callback messages -> WVf initialMessages -> submitMessage mutable copy
submitMessage appends current input -> $ne -> Rtd -> ntd(callModel=Vrr)
Vrr nested generator request -> xad -> JS_ normalization + QS_ serialization
xad -> beta.messages.create -> SDK create -> POST /v1/messages
```

The explicit `K7f` return-to-`lCS` argument edge closes the prior disconnected slice. Direct-call,
return, argument, assignment, method-dispatch, and nested callback/generator relations are labeled
separately; no containment relation is relabeled as a direct call.

For a future positive result, Observer A must project the creation request plus fake-upstream
response into an ordered safe conversation topology. The resume request's prefix, excluding the
final current input, must equal that projection and include at least one predecessor assistant
entry. A new-control request must have no such prefix.

The durable projection is limited to role order, array cardinalities, content representation,
content-block type/order/count, object field-name classes, and SSE event-class order. It stores no
scalar content, body bytes, headers, session IDs, credentials, prompt, or transcript.

Projection algorithm `p3as-predecessor-prefix-projection-v1` parses the fake-upstream request JSON,
selects `$.messages`, maps each message to role plus ordered content-block shape without values,
splits the final element as current input, requires a nonempty predecessor prefix with at least one
assistant entry, and compares that prefix to the creation safe-exchange projection using JCS. Its
signal-anchor digest is
`11981d9f74d3e7a7cd0ab0c5e7d78bdbabbeaa0cbc2f69f33b2293e14f05e4d5`; the artifact/flow/surface/
projection derivation digest is
`15211ac067c3b8192a49bb451af96dc59960d46e4162bf076ba8371d0d775ecc`.

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

The canonical record contains 36 function/method anchors and 2 constant anchors. Each function
anchor binds function name, TypeScript AST node kind,
module-local offset, artifact offset, byte length, source SHA-256, verified direct-call subset,
structural CFG node/edge/branch counts, and CFG-shape digest. Key offsets are:

| Function | Purpose | Module offset | Source SHA-256 |
| --- | --- | ---: | --- |
| `iKf` | CLI grammar | 19,622,567 | `623d51ffe3fedb4abc3e00e03c195ee1592bb2d1747f94a1b5d669722a95e818` |
| `h5f` | CLI combination validation | 19,106,597 | `625c7dcce260d2e0c4fcf1c44854ef713fe7d7c74f7f4ae7675cc2ce2c1e655e` |
| `on` | cached config-root provider | 352,564 | `2ce7f58ee0784c0fd25f85e350fb1e2b7d2511cffa193fb7ae6262d2af1b5f2b` |
| `oQe` | JavaScript string hash | 573,190 | `f42acdf72f28aa0ee81b65ad51fec9bbec445ce1bcb483e60e726ac731e58b50` |
| `v8m` | absolute base-36 hash encoding | 1,166,812 | `a8acc343c4583db1a72f8eac3da586844eb9a1a02575b92c84284f9be3ddd442` |
| `gq` | config-root/projects derivation | 6,522,025 | `387bcbd01456df910a64e577577148fa766bb5bc48e89e14dc16bd01a8eafe06` |
| `bb` | project-directory derivation | 6,522,896 | `a45e4c83b64a394d7ed4cc52f6f0a1e42fa2cfe70345c28be5eecbbcb65fb0ec` |
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
| SDK constructor | base-URL/environment precedence | 448,548 | `6beefd093d8afc317356a227b161ec54d66db323ef75d8c148927fa36f30b91e` |
| SDK `create` | exact `POST /v1/messages` route | 446,081 | `d0519d15b85cd6ee9c1a366b9e7dbbfe843290e76d5709a1b42792a1a28cf2e5` |

Constant anchors bind the full `on=Nr(...)` assignment at module offset 352,558, SHA-256
`1a860d51893c9ed7775f1d0f3ce5ae355ca8e995fb825c9980a9a13fc6f09d3c`, and `YEt=200` at
module offset 1,171,876, SHA-256
`e1e11212257149c70b4a064322d5cc432fce8d5b6f525378382a94ed4e4d55a7`.

The module scan digest is
`cac6799818f1f6780280d993adcb24cf2a834f7f5fd048a9c82fa35d0e464928`.
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

The focused test checks deterministic structural CFG scanning, missing marker/call-edge denial,
fixture-root rejection, exact operation/state/environment/endpoint values, connected flow,
projection derivation, record self-digest, JSON Schema validation, schema/tool binding,
two-observer independence, constant anchors, and semantic/schema mutations. Current result:
`61/61 PASS`.

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
