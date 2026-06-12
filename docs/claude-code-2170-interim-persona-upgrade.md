# Claude Code 2.1.170 interim persona upgrade

Date: 2026-06-12

## Scope

This CC Gateway change adds the 2.1.170 interim persona profile and keeps 2.1.146 / 2.1.150 profiles as explicit legacy rollback profiles. It is not a final/latest 2.1.175 upgrade.

## Verified interim profile

- Profile id: `claude_code_2_1_170_subscription_1m`
- Alias: `claude-code-2.1.170-macos-local`
- User-Agent: `claude-cli/2.1.170 (external, sdk-cli)`
- Stainless package version: `0.94.0`
- 2.1.170 messages beta adds `mid-conversation-system-2026-04-07` versus the older 2.1.150 capture.

## CCH gate

Sanitized raw-body capture/verifier results show 2.1.150, 2.1.153, 2.1.169, and 2.1.170 pass with the fixed rotl64 verifier. Runtime compatibility gates use this explicit verified corpus; unverified intermediate patches are not inferred as compatible. Version 2.1.171 is not published. Version 2.1.172 and later fail the old CCH verifier and must remain behind a separate delta investigation.

No raw request bodies, prompts, tokens, observed CCH values, native binaries, or strings/disassembly output are committed.

## Model markers and canary caveat

- `claude-opus-4-8` marker starts at 2.1.154.
- `claude-fable-5` marker starts at 2.1.170.
- Local mock outbound shape passed for both models under 2.1.170, but real upstream entitlement still requires a separately approved low-token production canary.
