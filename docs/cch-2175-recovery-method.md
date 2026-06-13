# Claude Code 2.1.175 CCH recovery method

Date: 2026-06-12

## Purpose

This memo records how the 2.1.172+ / 2.1.175 CCH delta was recovered so the next
CLI signing change can be investigated quickly without repeating blind guesses.
It intentionally stores only synthetic-local evidence and method notes. Do not
paste real user prompts, tokens, raw production bodies, account UUIDs, or proxy
credentials into this document.

## Final finding

The CCH hash primitive did not change in 2.1.172+:

- hash: `xxh64`
- seed: `0x4d659218e32a3268`
- mask: `0xfffff`
- output: lower-case hex, left-padded to 5 characters

What changed was the preimage.

### Legacy preimage, verified through 2.1.170

```text
preimage = exact UTF-8 JSON request body bytes with the billing block cch reset
to cch=00000;
```

### New preimage, verified for 2.1.172 through 2.1.175

```text
parsed = JSON.parse(exact request body text with cch=00000;)
normalized = recursively normalize parsed:
  - if an object key is "model" and the value is a string, set the value to ""
  - if an object key is "max_tokens" and the value is a number, omit the key
  - otherwise preserve values, object insertion order, and array order
preimage = JSON.stringify(normalized)
cch = hex5(xxh64(utf8(preimage), 0x4d659218e32a3268) & 0xfffff)
```

The transmitted body is not normalized; only the first `cch=00000;` in the
original body is replaced with the computed CCH.

The `cc_version` suffix algorithm stayed unchanged:

```text
sha256("59cf53e54c78" + chars(firstUserText[4], [7], [20]) + cliVersion).hex[:3]
```

Missing character positions are treated as `"0"`.

## Investigation sequence that worked

### 1. Build a request-level ground-truth corpus first

Use a localhost-only stub and synthetic ASCII prompts. Capture the exact outbound
request body and the observed `cch` produced by the real CLI. Also capture an
old-version control known to match the existing implementation.

Required properties:

- `ANTHROPIC_BASE_URL` / equivalent points to `127.0.0.1` only.
- Proxy variables fail closed for non-loopback destinations.
- The stub returns a minimal valid response so the CLI exits normally.
- Corpus rows include exact synthetic body bytes, observed CCH, CLI version,
  cc_version suffix, selected headers, and a copy with `cch=00000;`.

For this recovery, Plan A produced:

- `/tmp/cch-planA/groundtruth.jsonl`
- 7 synthetic 2.1.175 samples
- 2 synthetic 2.1.170 controls

The 2.1.170 controls validated the capture pipeline before analyzing the new
algorithm.

### 2. Stop blind seed/hash guessing once controls pass

2.1.170 passing with the same harness proves raw byte capture and the xxh64
implementation are sound. If 2.1.172+ fails at that point, the likely change is
not transport, OAuth, token state, or random hidden input. Move to white-box and
oracle-driven experiments instead of expanding seed brute force.

### 3. Extract or instrument the bundled CLI, but keep real secrets out

The useful artifacts are source/code structure, constants, and synthetic
oracle vectors. These are safe to record. The unsafe artifacts remain real
prompts, tokens, request bodies, account identifiers, and proxy credentials.

The previous failure mode was over-redaction: reporting only yes/no/unclear hid
exact source-level evidence. For signing interop analysis, it is acceptable and
necessary to record the deobfuscated function shape, seed, mask, and preimage
rules.

### 4. Use the real binary as a synthetic oracle for targeted cases

Once a candidate preimage rule appears, create synthetic bodies that isolate it.
Important probes from this recovery:

- Change only `model` string values: CCH stays the same, proving string `model`
  values are blanked before hashing.
- Change `model` to non-string values: CCH changes, proving the rule is
  type-sensitive.
- Change numeric `max_tokens`: CCH stays the same, proving numeric `max_tokens`
  is omitted.
- Change `max_tokens` to non-number values: CCH changes, proving the rule is
  type-sensitive.
- Put `model` / `max_tokens` inside nested objects and arrays: CCH follows the
  same rule, proving recursive normalization.
- Reorder unrelated keys: CCH changes, proving object insertion order must be
  preserved and implementations must not sort keys.

For this recovery, Plan B wrote:

- `/tmp/cch-planB/reference-2.1.175.mjs`
- `/tmp/cch-planB/test-reference-2.1.175.mjs`
- `/tmp/cch-planB/report.md`

A consolidated spec/vector scratch file was also written to:

- `/tmp/cch-final/cch_spec_and_vectors.json`

Scratch files are useful local evidence but should not be treated as production
state unless copied into reviewed tests/docs.

## Engineering rules for future CCH changes

1. Always verify an old-version positive control before trusting a new failure.
2. Keep synthetic raw bodies in scratch only; never commit real raw captures.
3. Preserve JSON key order in implementations. Do not use canonical serializers
   that sort keys.
4. Make the signer version-aware. Do not infer compatibility from semver alone
   unless a version range is backed by oracle vectors.
5. Keep the production path small: implement the recovered algorithm directly.
   A bundled binary signer oracle is a fallback only when the algorithm cannot be
   recovered or changes too frequently to maintain safely.
6. Add tests that exercise the rule, not only request-level captures where
   `model` and `max_tokens` are constant.

## Decision on signer oracle

A long-lived binary signer oracle was not adopted for this delta because the
algorithm was recovered as a small deterministic function and validated against
real 2.1.172/2.1.175 synthetic oracle vectors. The lower-risk long-term guard is
a CI or manual canary that compares synthetic real-CLI oracle output against the
in-repo implementation when the pinned CLI version is upgraded.
