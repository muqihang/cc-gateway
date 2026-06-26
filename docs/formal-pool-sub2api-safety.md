# Formal-Pool Sub2API Safety Boundary

## Scope

This document covers `mode: sub2api` formal-pool/shared-account production. It does not make strict Claude Code 2.1.179 native-parity or sign-primary readiness claims.

The safety boundary assumes requests enter the chain through Sub2API / Server API, where the server-side scheduler selects an account from formal-pool state. End-client supplied authority hints are untrusted. CC Gateway independently validates the attested context before any upstream Anthropic egress.

## Required server-side context

Sub2API must generate the trusted formal-pool context from server-owned scheduler and account state. The context contains safe refs and policy fields only:

- account ref
- credential type
- credential ref
- egress bucket
- persona/profile policy version
- route classification
- session binding
- control-plane disposition
- `egress_profile_ref`
- `profile_policy_version`
- `billing_shape_policy`
- `request_shape_profile_ref`
- `cache_parity_profile_ref`
- `observed_client_profile` as audit-only safe summary, never authority

Do not copy raw prompts, raw request bodies, raw responses, raw telemetry, raw CCH material, upstream tokens, proxy credentials, account UUIDs, or emails into this context or into evidence.

## CC Gateway final-output responsibilities

For `mode: sub2api` formal-pool traffic, CC Gateway is not a transparent pass-through. It owns the final pre-upstream safety checks:

- account identity lookup
- credential/account binding
- egress allowlist verification
- persona/profile header rewrite
- `metadata.user_id` rewrite and verifier
- `X-Claude-Code-Session-Id` body/header equality
- billing/CCH strip or sign verifier
- control-plane separation
- preflight/real-upstream gate

Runtime registration for newly warmed accounts is an internal-control API. It requires the configured internal-control token from the internal path and a server-generated, account-owned 64-hex `device_id`. Formal-pool runtime identity does not use the standalone global `identity.device_id`.

## Claude Code 2.1.179 stable production policy

Claude Code `2.1.179` is the stable production compatibility target for this
formal-pool path. The safe default is `egress_profile_ref=strip_attribution`
with `billing_shape_policy=strip`: inbound attribution/CCH material is removed
and final verification fails closed if billing/CCH markers remain. `no_cch` and
`signed_cch` are optional profiles only; they require explicit 2.1.179
oracle/profile proof and an operator-approved egress profile before use.

2.1.191 latest is forward-compatibility evidence only. It must not promote a
production profile, billing shape, beta set, or request-shape profile by itself.
Unknown future versions, unknown beta/body shapes, or unknown billing shapes must strip/downscope or fail closed; they must not auto-enable `signed_cch` or `no_cch`.

## Capture references

Use only safe summaries from Sub2API docs and localhost harness reports. Do not paste raw prompts, raw bodies, raw CCH, raw telemetry, account UUIDs/emails, tokens, or proxy credentials.

| Field family | Captured expectation | CC Gateway P0 behavior | Status |
|---|---|---|---|
| `metadata.user_id` | Safe summary shows `device_id`, account identity, and `session_id` families are present in native messages | Rewritten from selected account/runtime mapping and session ledger; verified before upstream | PASS |
| session header | `X-Claude-Code-Session-Id` equals body `session_id` for message traffic | Final verifier checks body/header equality and rejects silent formal-pool session authority changes | PASS |
| persona headers | UA, app/stainless, and Anthropic beta families follow a selected Claude Code profile | Rewritten by resolver from safe persona/profile policy version; 2.1.179 strict profile remains gated | PASS_WITH_PROFILE_GATE |
| billing/CCH | Native captures include billing/CCH families, but raw values are not evidence material | Strip is the default safe mode; sign mode requires verifier and explicit 2.1.179 oracle/profile proof before use | PASS_WITH_DEGRADED_SCOPE |
| control-plane | Control-plane routes are separate from message upstream egress | Suppress, defer, stub, or block according to policy; message path remains fail-closed before real upstream when unsafe | PASS_WITH_DEGRADED_SCOPE |

## Operator evidence matrix

| Evidence item | Safe to record | Forbidden in evidence |
|---|---|---|
| Account selection | Safe account ref, policy version, selected credential type | Raw account UUID, email, raw token, raw credential digest/HMAC input |
| Egress selection | Safe egress bucket/ref, allowlist decision, proxy identity ref | Proxy username/password or full proxy URL with credentials |
| Runtime registration | Status, stable error code, per-account device ref shape | Raw internal-control token, raw response body, raw upstream credential |
| Session binding | Safe session ref/hash and sticky-authority decision | Raw prompt/body/response/telemetry or unredacted CCH |
| Control-plane handling | Route family, disposition, stable code | Raw request/response body, Authorization, cookies, tokens |
| Production readiness | Tested commit refs, deployed image/commit/config/profile equivalence status, safe config/profile hash with secrets excluded | Raw config secrets, raw profile captures, raw body material |

## Production readiness gate

Before live formal-pool smoke or production rollout, operators must prove the
deployed image/commit/config/profile equivalence against the exact locally
tested revision. Evidence should contain only safe commit refs, image refs, and
secret-excluded config/profile hashes. If equivalence is not proven, the rollout
status remains `BLOCKED_EXTERNAL_EVIDENCE` even when localhost tests pass.

Safe rollback modes are:

- disable formal-pool egress; or
- force `strip_attribution`.

Rollback must never fall back to direct Anthropic bypass, client-selected
authority headers, ungated sign-primary, or automatic `signed_cch` / `no_cch`
promotion. Any real formal-pool smoke requires explicit user approval, a tiny
cost envelope, safe audit fields only, and no 3012 changes.

## Known degraded claims

- WebSearch/WebFetch bridge is not part of this P0.
- 2.1.179 strict native mimicry and sign-primary remain gated on oracle/profile evidence.
- Full first-party control-plane parity remains separate from safe stub/suppress/block behavior.
- Live 3017, deployed CC Gateway image equivalence, and high cache-hit-rate evidence require separate canary/live proof.
