import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareEgressSidecarRequest,
  type EgressSidecarConfig,
} from "../../src/egress-sidecar-client.js";
import { resolveEgressBucket } from "../../src/policy.js";

const primaryProfile = "tls-profile:claude-code-2.1.179-real-oracle-tcp-v1";
const alternateProfile = "tls-profile:phase0-alternate-v1";
const primarySummary = "tls-bucket:claude-code-real-oracle-2179";
const bindingSecret = "phase0-red-independent-binding-material-20260711";

function sidecarConfig(
  overrides: Partial<EgressSidecarConfig> = {},
): EgressSidecarConfig {
  return {
    enabled: true,
    endpoint: "http://127.0.0.1:19091/egress",
    control_token: "phase0-red-sidecar-control-material-20260711",
    allowed_target_hosts: ["api.anthropic.com"],
    logical_target_host: "api.anthropic.com",
    allowed_routes: ["/v1/messages", "/v1/alternate"],
    allowed_profile_refs: [primaryProfile, alternateProfile],
    expected_tls_summary_bucket: primarySummary,
    proxy_binding_secret: bindingSecret,
    ...overrides,
  };
}

function requestInput(overrides: Record<string, unknown> = {}) {
  return {
    config: { egress_tls_sidecar: sidecarConfig() },
    profileRef: primaryProfile,
    egressBucket: "bucket-a",
    proxyIdentityRef: "opaque:proxy-ref:v1:bucket-a",
    proxyUrl: "http://198.51.100.40:8080",
    targetHost: "api.anthropic.com",
    targetPort: 443,
    targetScheme: "https",
    targetPath: "/v1/messages",
    route: "/v1/messages",
    method: "POST",
    verifiedContextRef: "opaque:context-ref:v1:phase0",
    accountIdentityRef: "opaque:account-ref:v1:phase0",
    manifestAuthorityRef: "opaque:manifest-ref:v1:phase0",
    proxyGeneration: 7,
    expectedProxyGeneration: 7,
    profileEnabled: true,
    directFallback: false,
    nonce: "nonce-ref-phase0-0001",
    timestampMs: 1783796400000,
    finalHeadersHash: "sha256:" + "a".repeat(64),
    requestBodyHash: "sha256:" + "b".repeat(64),
    envelopeVersion: 2,
    keyEpoch: 11,
    attemptId: "attempt-ref-phase0-0001",
    absoluteDeadlineMs: 1783796460000,
    contentLength: 17,
    contentEncoding: "identity",
    expectedResponsePolicyRef: "response-policy:anthropic-v1",
    ...overrides,
  } as any;
}

type Observer = { dns: number; sockets: number };

function exercisePreSocketBoundary(overrides: Record<string, unknown>): {
  decision: ReturnType<typeof prepareEgressSidecarRequest>;
  observer: Observer;
} {
  const observer: Observer = { dns: 0, sockets: 0 };
  const decision = prepareEgressSidecarRequest(requestInput(overrides));
  if (decision.ok) {
    // These hooks stand in for the first resolver/dial operations after policy preparation.
    observer.dns++;
    observer.sockets++;
  }
  return { decision, observer };
}

const b4Cases: Array<[string, Record<string, unknown>]> = [
  ["missing sidecar", { config: {} }],
  ["missing verified context", { verifiedContextRef: undefined }],
  ["missing proxy generation", { proxyGeneration: undefined }],
  ["mismatched proxy generation", { expectedProxyGeneration: 8 }],
  ["missing profile", { profileRef: undefined }],
  ["disabled profile", { profileEnabled: false }],
  ["missing manifest authority", { manifestAuthorityRef: undefined }],
  [
    "unknown manifest authority",
    { manifestAuthorityRef: "opaque:manifest-ref:v1:unknown" },
  ],
  [
    "missing account identity",
    { accountIdentityRef: undefined, proxyIdentityRef: undefined },
  ],
  ["direct fallback enabled", { directFallback: true }],
];

for (const [name, overrides] of b4Cases) {
  test(`B4 denies ${name} before DNS or socket creation`, () => {
    const { decision, observer } = exercisePreSocketBoundary(overrides);
    assert.equal(decision.ok, false, `${name} reached the transport boundary`);
    assert.deepEqual(
      observer,
      { dns: 0, sockets: 0 },
      `${name} performed resolver or socket work`,
    );
  });
}

function prepared(overrides: Record<string, unknown> = {}) {
  const result = prepareEgressSidecarRequest(requestInput(overrides));
  assert.equal(
    result.ok,
    true,
    `fixture must reach binding code: ${JSON.stringify(result)}`,
  );
  return result.prepared;
}

const requiredEnvelopeFields = [
  "nonce",
  "timestamp_ms",
  "final_headers_hash",
  "request_body_hash",
  "envelope_version",
  "key_epoch",
  "attempt_id",
  "absolute_deadline_ms",
  "content_length",
  "content_encoding",
  "expected_response_policy_ref",
];

for (const field of requiredEnvelopeFields) {
  test(`B5 complete control includes ${field}`, () => {
    const control = prepared().control as unknown as Record<string, unknown>;
    assert.ok(
      Object.prototype.hasOwnProperty.call(control, field),
      `authenticated control omits ${field}`,
    );
  });
}

const bindingMutations: Array<[string, Record<string, unknown>]> = [
  ["nonce", { nonce: "nonce-ref-phase0-0002" }],
  ["timestamp", { timestampMs: 1783796400001 }],
  ["profile ref", { profileRef: alternateProfile }],
  ["egress bucket", { egressBucket: "bucket-b" }],
  ["proxy identity", { proxyIdentityRef: "opaque:proxy-ref:v1:bucket-b" }],
  ["canonical proxy URL", { proxyUrl: "http://198.51.100.41:8080" }],
  [
    "target host",
    {
      config: {
        egress_tls_sidecar: sidecarConfig({
          allowed_target_hosts: ["api-alt.anthropic.com"],
          logical_target_host: "api-alt.anthropic.com",
        }),
      },
      targetHost: "api-alt.anthropic.com",
    },
  ],
  [
    "expected summary",
    {
      config: {
        egress_tls_sidecar: sidecarConfig({
          expected_tls_summary_bucket: "tls-bucket:alternate",
        }),
      },
    },
  ],
  [
    "target path and route",
    { targetPath: "/v1/alternate", route: "/v1/alternate" },
  ],
  ["method", { method: "PUT" }],
  [
    "final forwarded-header hash",
    { finalHeadersHash: "sha256:" + "c".repeat(64) },
  ],
  ["final request-body hash", { requestBodyHash: "sha256:" + "d".repeat(64) }],
  ["key epoch", { keyEpoch: 12 }],
  ["attempt ID", { attemptId: "attempt-ref-phase0-0002" }],
  ["absolute deadline", { absoluteDeadlineMs: 1783796460001 }],
  ["content length", { contentLength: 18 }],
  ["content encoding", { contentEncoding: "gzip" }],
  [
    "response policy",
    { expectedResponsePolicyRef: "response-policy:anthropic-v2" },
  ],
];

for (const [name, mutation] of bindingMutations) {
  test(`B5 authentication changes after ${name} mutation`, () => {
    assert.notEqual(
      prepared(mutation).proxyBinding,
      prepared().proxyBinding,
      `${name} is unsigned`,
    );
  });
}

function bucketResolution(
  proxyUrl: string,
  extra: Record<string, unknown> = {},
) {
  return resolveEgressBucket(
    {
      egress_buckets: {
        "bucket-a": {
          enabled: true,
          proxy_url: proxyUrl,
          proxy_identity_ref: "opaque:proxy-ref:v1:bucket-a",
          allowed_account_ids: ["account-a"],
          ...extra,
        },
      },
    } as any,
    "bucket-a",
    "account-a",
  );
}

const unsafeProxyDestinations: Array<
  [string, string, Record<string, unknown>?]
> = [
  ["IPv4 loopback", "http://127.0.0.1:8080"],
  ["IPv4 link-local", "http://169.254.20.10:8080"],
  ["cloud metadata", "http://169.254.169.254:8080"],
  ["IPv4 multicast", "http://224.0.0.1:8080"],
  ["IPv4 unspecified", "http://0.0.0.0:8080"],
  ["private IPv4 without explicit policy", "http://10.20.30.40:8080"],
  ["IPv4-mapped IPv6 loopback", "http://[::ffff:127.0.0.1]:8080"],
  ["expanded IPv4-mapped IPv6", "http://[0:0:0:0:0:ffff:7f00:1]:8080"],
  ["IPv6 loopback", "http://[::1]:8080"],
  ["IPv6 link-local", "http://[fe80::1]:8080"],
  ["IPv6 multicast", "http://[ff02::1]:8080"],
  ["IPv6 unspecified", "http://[::]:8080"],
  ["DNS rebinding without pinned resolution", "http://rebinding.invalid:8080"],
  [
    "redirect directive",
    "http://198.51.100.40:8080/?redirect=http%3A%2F%2F127.0.0.1",
  ],
  [
    "nested proxy directive",
    "http://198.51.100.40:8080/?proxy=socks5%3A%2F%2F127.0.0.1",
  ],
  ["alternate dial target", "http://198.51.100.40:8080/?dial_host=127.0.0.1"],
  [
    "scheme confusion",
    "http://198.51.100.40:8080/%2f%2fsocks5:%2f%2f127.0.0.1",
  ],
];

for (const [name, proxyUrl, extra = {}] of unsafeProxyDestinations) {
  test(`B6 rejects ${name}`, () => {
    const resolution = bucketResolution(proxyUrl, extra);
    assert.ok(
      "error" in resolution,
      `${name} passed URL-only destination policy`,
    );
  });
}

test("B6 permits private proxy only through an explicit approved-range policy", () => {
  const denied = bucketResolution("http://10.20.30.40:8080");
  const approved = bucketResolution("http://10.20.30.40:8080", {
    private_destination_policy: {
      trust_boundary_ref: "trust-boundary:corp-proxy-v1",
      approved_cidrs: ["10.20.30.0/24"],
    },
  });
  assert.ok(
    "error" in denied,
    "implicit private-range exception must be denied",
  );
  assert.ok(
    !("error" in approved),
    "explicit approved private range should be accepted",
  );
});
