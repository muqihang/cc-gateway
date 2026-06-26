# Claude Code CCH oracle regression harness

Date: 2026-06-12

## Purpose

`tools/claude-cch-oracle-regression.ts` is a manual pre-upgrade guard for the
small in-repo CCH signer/verifier. It runs synthetic prompts against a
localhost-only stub, then compares real Claude Code output with the in-repo
`verifySignedCCH` and `computeCCVersionSuffix` implementations.

It is not part of the production signer. Production keeps the small deterministic
implementation from `src/policy.ts`.

## Safety properties

- Real Claude Code execution is opt-in only: set
  `CC_GATEWAY_CCH_ORACLE_REAL_CLI=1`.
- Default real mode resolves and runs the pinned package executable for
  `@anthropic-ai/claude-code@2.1.175`. The npm bootstrap step is outside sample
  capture; actual Claude Code samples run with localhost-only egress guard.
- Optional global mode must be explicit:
  `CC_GATEWAY_CCH_ORACLE_USE_GLOBAL_CLAUDE=1`.
- The stub listens on `127.0.0.1` only.
- `ANTHROPIC_BASE_URL` and `CLAUDE_CODE_API_BASE_URL` point to the local stub.
- During actual Claude Code samples, the harness applies a best-effort
  localhost egress guard: proxy environment variables point to the same local
  stub and CONNECT requests are denied. This catches normal proxy-aware
  control-plane egress, but it is not an OS-level network sandbox.
- The tool uses synthetic printable-ASCII prompts only. They are passed via
  stdin, not command argv.
- Raw request bodies stay in memory for immediate verification only.
- Output is a safe JSON summary: version, sample count, and yes/no checks. It
  does not include raw prompts, raw bodies, tokens, cookies, account IDs, or CCH
  values.

## Self-test

Run the harness logic without real Claude Code:

```bash
npx tsx tests/cch-oracle-harness.test.ts
npx tsx tools/claude-cch-oracle-regression.ts --self-test
```

Expected result:

- synthetic prompt constraints pass;
- mock samples report `allCCVersionSuffixMatch: true`;
- mock samples report `allCCHVerifierMatch: true`;
- mock samples report `allUniqueBillingHeader: true`;
- `rawBodyPersisted` and `rawPromptPersisted` are `false`.

## Real pinned CLI oracle

Run this before changing the pinned verified Claude Code version. It resolves
the pinned package executable, verifies `claude --version`, then runs synthetic
samples with all Claude Code traffic pointed at the localhost stub.

```bash
CC_GATEWAY_CCH_ORACLE_REAL_CLI=1 \
  CC_GATEWAY_CCH_ORACLE_VERSION=2.1.175 \
  npx tsx tools/claude-cch-oracle-regression.ts
```

Expected result for the current verified final target:

- `commandKind` is `pinned-executable`;
- `observedVersion` is `2.1.175 (Claude Code)`;
- `sampleCount` is at least 2;
- `allCliExitOk` is `true`;
- `allCCVersionSuffixMatch` is `true`;
- `allCCHVerifierMatch` is `true`;
- `allUniqueBillingHeader` is `true`.

## Real global CLI oracle

Use this for the best-effort egress-guarded regression when the local global `claude`
is intentionally pinned to the same version:

```bash
CC_GATEWAY_CCH_ORACLE_REAL_CLI=1 \
  CC_GATEWAY_CCH_ORACLE_USE_GLOBAL_CLAUDE=1 \
  CC_GATEWAY_CCH_ORACLE_VERSION=2.1.175 \
  npx tsx tools/claude-cch-oracle-regression.ts
```

The expected result is identical to pinned mode, except `commandKind` is
`global-claude`.

## Failure criteria

Treat any of the following as a release blocker:

- real CLI version differs from the requested pinned version;
- any real CLI sample exits non-zero;
- no unique billing header is found;
- `cc_version` suffix mismatch;
- CCH verifier mismatch;
- any raw prompt/body/token appears in the output.

If this fails for a future Claude Code package, stop the persona upgrade and run
a CCH delta investigation before changing production defaults.

## Claude Code 2.1.179 native formal-pool matrix

`tools/claude-native-oracle-matrix.ts` is the CP1 harness for the native
formal-pool production path. It captures safe summaries for the stable
`2.1.179` CLI in two localhost-only invocation modes:

- `custom-base`
- `first-party-assumed`

Run it only with a pinned, version-verified executable:

```bash
CC_GATEWAY_NATIVE_ORACLE_REAL_CLI=1 \
  CC_GATEWAY_NATIVE_ORACLE_VERSION=2.1.179 \
  CC_GATEWAY_NATIVE_ORACLE_RUNTIME_ROOT=/path/to/pinned/2.1.179/claude \
  CC_GATEWAY_NATIVE_ORACLE_OUTPUT=/private/tmp/native-oracle-matrix-2.1.179.json \
  node --import tsx tools/claude-native-oracle-matrix.ts
```

Safety properties are the same as the CCH regression harness: localhost stub
only, synthetic prompts via stdin, raw request bodies used in memory only, and
JSON output limited to safe summaries. The matrix intentionally records CCH
verifier booleans only; it must not persist raw CCH values or billing strings.

The 2026-06-25 CP1 run observed `billing_shape=cch_present`,
`cc_entrypoint_bucket=sdk-cli`, and verifier success for captured 2.1.179
message samples. It also observed that the minimal 2.1.179 CLI invocations sent
`stream=true` upstream even when the CLI output format was `json`, so
non-streaming upstream body parity remains degraded until separately proven.

This oracle evidence does **not** change the production default:
formal-pool traffic stays on `strip_attribution` unless an explicit
egress/profile proof enables `signed_cch` or `no_cch`. Unknown future versions,
unknown beta/body shapes, or unknown billing shapes must strip/downscope or fail
closed.

## Future-version investigation mode

Real oracle runs are locked to `2.1.175` by default. For a future package
investigation, set both `CC_GATEWAY_CCH_ORACLE_VERSION=<version>` and
`CC_GATEWAY_CCH_ORACLE_ALLOW_FUTURE_VERSION=1`. Treat that mode as exploratory;
it is not approval to change production persona defaults.
