# Oracle Lab Phase 0 Exit Report

- Phase: phase-0
- Baseline digest: sha256:21004327cdc573c565d06f90d700515d3e240c631aaad93192fbaaee8392994f
- Command results digest: sha256:342daec47a5929b6d2cef0ca9a8bb2e244863e196058dc3ef4a506efcde7da99
- Generated: 2026-07-12T09:46:31.684Z
- Expires: 2026-07-13T09:46:31.684Z

## Observed Command Results

| Command | Status | Result digest |
| --- | --- | --- |
| cc-b4-b6-red | expected_fail | sha256:66aa23c0303d60d04ce7b29d743f3eb3450262fc03133111117f4e3665fed4da |
| cc-build | pass | sha256:edbabc11a3752c71cfa7e7a9d924e5db2b40eafae1dd62645421e0928f2cd1bb |
| cc-test | pass | sha256:bba3427750b1bae8b8918ed80f9bf6305153db2f45e95b864037b26372c2b6b9 |
| sidecar-b4-b6-red | expected_fail | sha256:0a130c9825f0bf7dc7dc93a4d020369b64a575b58c0ade33b6613c73bcefb669 |
| sidecar-test | pass | sha256:b17f5dcfd3c11378773f3fae785dcfeac1f13c7b3b4fe52e806c92b42722808f |
| sub2api-b1-b3-red | expected_fail | sha256:6b3f1fedc831037bf0eb59db942fb9b62cf78e79f6568060aec4cff64715745e |
| sub2api-test | pass | sha256:928ac7ec3b17e2bb94df59d318886585a94aa13c80a2d8d2d6053dfcdb5a6bba |

## Repository Provenance

- cc_gateway: commit a94462b372b9397d914868450e12f2cc1f6dc002, dirty digest sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
- sub2api: commit d596bb461b1cbb4f0ca8b299333f621ed8d4fd4f, dirty digest sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

## Known Unknowns

- Phase 0 fixture drives complete local HTTP requests through startProxy/handleRequest and proves missing, unknown, contradictory, unsupported, and incoherent compatibility declarations reach the upstream observer instead of failing closed
- URL-only checks accept unsafe ranges and directive confusion; the real Handler does not consume its injected resolver/dial seam, so the rebinding test observes zero policy-owned resolutions instead of one pinned public dial; redirect, nested-proxy, and alternate-target cases remain explicit
- arbitrary, wrong, expired, cross-session, and post-proxy-change proofs remain accepted; replay is rejected only after the current state transition
- configured public origin remains authoritative; without configured origin or trusted ingress, Host, X-Forwarded-Host, and X-Forwarded-Proto each currently control the browser URL authority; the RED assertion accepts rejection, a relative result, or any fixed non-hostile authority
- dependency gates HA-P0-000 and HA-P0-001 plus acceptance gate phase_0_b1_revalidation remain mandatory
- dependency gates HA-P0-000 and HA-P0-001 plus acceptance gate phase_0_b2_revalidation remain mandatory
- dependency gates HA-P0-000 and HA-P0-001 plus acceptance gate phase_0_b3_revalidation remain mandatory
- final exit receipt binds the handoff commit after artifact generation
- first replay completion succeeds and is recorded before same-instance rejection; restart restores an explicit ledger snapshot into a new handler harness, while a distinct replica receives the same shared ledger; all three remain RED because the production handler has no replay enforcement
- implementation and enforcement are deferred to Phase 2
- missing context, proxy generation, manifest authority, and direct-fallback prohibition reach transport; missing account identity is independently tested while proxy identity remains valid; disabled profile already denies before transport
- owner-positive fixtures reach every named operation; authenticated principal, administrator, tenant, group, creator/owner, role, and expected version are varied independently; valid-owner wrong-state is rejected distinctly; AccountHealthcheck uses an owner-bound real account reader fixture
- promotion is prohibited before all compatibility gates and rollback review pass
- roadmap evidence-to-decision matrix binds P0 baseline/contract, B1-B6, and HA-P0-009 rows with evidence digest, scope, compatibility verdict, negative capabilities, target change, owner, and promotion gate
- selected compromise-boundary dependency HA-P0-005 is protected_gateway; an independently isolated policy-broker capability remains mandatory against gateway-process compromise
- selected compromise-boundary dependency HA-P0-005 is protected_gateway; network-level resolution pinning and sidecar enforcement remain mandatory before production authority
- selected compromise-boundary dependency HA-P0-005 is protected_gateway; production and real-canary authority remain disabled pending the policy broker
- symbol FormalPoolOnboardingService.AttestBrowserEgress; test TestFormalPoolBrowserEgressAttestationRejectsUntrustedProofs; expected RED exit 1 with five stable leaf failures; failure-name digest sha256:9d2491b62a39ff5913751c818ba31b21bd3e0200698926824864ab76d7c1a26b reproducible from the committed evidence artifact
- symbols FormalPoolOnboardingHandler.withAbsoluteBrowserEgressURL and formalPoolRequestPublicBaseURL; test TestFormalPoolOnboardingPublicOriginAuthority; expected RED exit 1 with three stable leaf failures; failure-name digest sha256:97d0ee5906218981fbdea0ab0aaa00cc25f12f7ba22c0286024a645a786b3aa8 reproducible from the committed evidence artifact
- symbols prepareEgressSidecarRequest, computeProxyBinding, control.Validate, Handler.ServeHTTP, and verifyProxyBinding; complete TS and Go mutation matrices plus successful local-forward replay cases produce sixty-nine stable leaf failures; failure-name digest sha256:4bf2becea973c187234196218b64fa0b4e07a944e465516ce0c2f3a87aa2eee2 reproducible from the committed evidence artifact
- symbols registerFormalPoolOnboardingAdminRoutes and FormalPoolOnboardingHandler session/account operations; tests TestFormalPoolOnboardingAuthorizationRejectsCrossBoundaryOperations and TestFormalPoolOnboardingAuthorizationDimensionsAreIndependent; expected RED exit 1 with twenty-five stable leaf failures; failure-name digest sha256:6212e1d46e14e3f184709fd847ae2381d3f7ff46cb7946f2556ccec9179ca3f3 reproducible from the committed evidence artifact
- symbols resolveEgressBucket, isSafeProxyUrl, safeProxyURLHeader, Handler.ServeHTTP, and the sidecar dial path; URL destination cases plus an injected public-then-unsafe resolver and pinned-dial observer produce thirty-six stable leaf failures; failure-name digest sha256:765866c3772e802a90779967dfa21ccd5abbbb623fc7cd13f6e3a70edb43c7b2 reproducible from the committed evidence artifact
- symbols startProxy, handleRequest, prepareEgressSidecarRequest, and the ordinary Node proxy path; real gateway requests use deterministic DNS, proxy-dial, and sidecar-socket observers; expected RED exit 1 with seven stable leaf failures; failure-name digest sha256:33bc5b4d516ab1f717f98180fe396e0f861ed8fd4537caf3eddec440bb34ece5 reproducible from the committed evidence artifact
- the deterministic Go complete-envelope fixture first passes the production control schema and actual HMAC verification, then independently mutates target authority/path/route/method, proxy/account/context/generation/profile/manifest, freshness, final hashes, encoding/deadline/response policy, and envelope metadata at the authentication boundary; reordered JSON with an equivalent Unicode escape also passes control validation and actual verification

## Safe Artifact References

- docs/superpowers/evidence/phase-0/phase-0-exit-baseline.json (sha256:21004327cdc573c565d06f90d700515d3e240c631aaad93192fbaaee8392994f)
- docs/superpowers/evidence/phase-0/phase-0-context-pack.json (sha256:19af668c3eca4af0ba2758b9b88ab3e03f1d072874df8ff8040dfa474301849b)

Raw stdout/stderr, credentials, prompts, request bodies, and unrestricted logs are intentionally excluded.
