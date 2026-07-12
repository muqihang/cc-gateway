import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import dns from "node:dns";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import {
  computeProxyBinding,
  prepareEgressSidecarRequest,
  type EgressSidecarConfig,
} from "../../src/egress-sidecar-client.js";
import { resolveEgressBucket } from "../../src/policy.js";
import { startProxy } from "../../src/proxy.js";
import { resolveFormalPoolContract } from "../../tools/oracle-lab/resolve-formal-pool-contract.js";
import {
  baseConfig,
  close,
  httpJson,
  listen,
  serverUrl,
  startFakeConnectProxy,
  startFakeUpstream,
} from "../helpers.js";

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

const supportedCapability = {
  model: "claude-sonnet-4-6",
  transport_mode: "sidecar_https",
  entrypoint: "messages",
  beta_tokens: [] as string[],
};

function negativeCapabilityInput(
  overrides: Record<string, unknown> = {},
) {
  return requestInput({
    requested_capability: supportedCapability,
    compatibility_contract: {
      schema_version: 1,
      supported_capabilities: [supportedCapability],
      negative_capabilities: {
        unsupported_models: [],
        unsupported_beta_tokens: [],
        unsupported_transport_modes: [],
        unsupported_entrypoints: [],
        unsupported_fallbacks: [],
        unsupported_feature_combinations: [],
        unsupported_authority_states: [],
      },
    },
    ...overrides,
  });
}

const negativeCapabilityCases: Array<[string, Record<string, unknown>]> = [
  [
    "HA-P0-009 rejects missing negative-capability declaration",
    {
      compatibility_contract: {
        schema_version: 1,
        supported_capabilities: [supportedCapability],
      },
    },
  ],
  [
    "HA-P0-009 rejects unknown negative-capability declaration",
    {
      compatibility_contract: {
        schema_version: 1,
        supported_capabilities: [supportedCapability],
        negative_capabilities: {
          unsupported_models: [],
          unsupported_beta_tokens: [],
          unsupported_transport_modes: [],
          unsupported_entrypoints: [],
          unsupported_fallbacks: [],
          unsupported_feature_combinations: [],
          unsupported_authority_states: [],
          unknown_capability_class: ["opaque-capability:v1:unknown"],
        },
      },
    },
  ],
  [
    "HA-P0-009 rejects contradictory positive and negative capability",
    {
      compatibility_contract: {
        schema_version: 1,
        supported_capabilities: [supportedCapability],
        negative_capabilities: {
          unsupported_models: [supportedCapability.model],
          unsupported_beta_tokens: [],
          unsupported_transport_modes: [],
          unsupported_entrypoints: [],
          unsupported_fallbacks: [],
          unsupported_feature_combinations: [],
          unsupported_authority_states: [],
        },
      },
    },
  ],
  [
    "HA-P0-009 rejects requested capability declared unsupported",
    {
      compatibility_contract: {
        schema_version: 1,
        supported_capabilities: [],
        negative_capabilities: {
          unsupported_models: [supportedCapability.model],
          unsupported_beta_tokens: [],
          unsupported_transport_modes: [],
          unsupported_entrypoints: [],
          unsupported_fallbacks: [],
          unsupported_feature_combinations: [],
          unsupported_authority_states: [],
        },
      },
    },
  ],
  [
    "HA-P0-009 rejects incoherent negative-capability tuple",
    {
      compatibility_contract: {
        schema_version: 1,
        supported_capabilities: [supportedCapability],
        negative_capabilities: {
          unsupported_models: [],
          unsupported_beta_tokens: [],
          unsupported_transport_modes: [],
          unsupported_entrypoints: [],
          unsupported_fallbacks: [],
          unsupported_feature_combinations: [supportedCapability],
          unsupported_authority_states: [],
        },
      },
    },
  ],
];

for (const [name, overrides] of negativeCapabilityCases) {
  test(name, () => {
    const result = prepareEgressSidecarRequest(negativeCapabilityInput(overrides));
    assert.equal(
      result.ok,
      false,
      `${name} was accepted because Phase 2 compatibility enforcement is absent`,
    );
  });
}

const fixture = resolveFormalPoolContract({
  gatewayRoot: new URL("../..", import.meta.url).pathname,
  sub2apiRoot: process.env.SUB2API_ROOT,
  manifestPath: process.env.ORACLE_LAB_MANIFEST_PATH,
}).fixture as any;

function canonicalContext(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().reduce((out, key) => {
    out[key] = value[key];
    return out;
  }, {} as Record<string, unknown>));
}

function signedContextHeaders(context: Record<string, unknown>) {
  const canonical = canonicalContext(context);
  return {
    "x-cc-formal-pool-context": Buffer.from(canonical).toString("base64url"),
    "x-cc-formal-pool-signature": `hmac-sha256:${createHmac("sha256", fixture.materials.context_attestation_material).update(canonical).digest("hex")}`,
  };
}

function credentialBinding(raw: string): string {
  return `hmac-sha256:${createHmac("sha256", fixture.materials.context_attestation_material)
    .update("formal_pool_credential_binding_v1\0oauth\0" + raw).digest("hex")}`;
}

async function startObservedSidecar() {
  const sockets: string[] = [];
  const server = createServer((req, res) => {
    sockets.push(req.socket.remoteAddress || "unknown");
    req.resume();
    req.on("end", () => {
      res.writeHead(200, {
        "content-type": "application/json",
        "x-cc-egress-tls-summary-bucket": primarySummary,
      });
      res.end('{"ok":true}');
    });
  });
  await listen(server);
  return { server, sockets, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/egress` };
}

function b4Config(upstreamUrl: string, sidecarUrl: string, proxyUrl: string, overrides: Record<string, unknown> = {}) {
  return baseConfig({
    mode: "sub2api",
    upstream: { url: upstreamUrl },
    auth: { gateway_token: fixture.materials.gateway_control_material, internal_control_token: fixture.materials.internal_control_material, tokens: [] },
    oauth: undefined,
    shared_pool: {
      gateway_compromise_boundary: "protected_gateway",
      context_attestation_secret_ref: "opaque:attestation-ref:v1:phase0-red",
      context_attestation_secret: fixture.materials.context_attestation_material,
      egress_tls: { enabled: true, strict: true },
    },
    egress_tls_sidecar: sidecarConfig({ endpoint: sidecarUrl }),
    tls_profiles: { primary: { profile_ref: primaryProfile, source: "observed-oracle-63", enabled: true } },
    account_identities: {
      [fixture.account.account_id]: {
        device_id: fixture.account.device_id,
        account_uuid_ref: fixture.account.account_uuid_ref,
        email_ref: fixture.account.email_ref,
        account_ref: fixture.account.account_ref,
        credential_ref: fixture.account.credential_ref,
        credential_binding_hmac: credentialBinding("Bearer selected-oauth-credential-fixture"),
        persona_variant: fixture.account.persona_profile,
        session_policy: "preserve_downstream_session_id",
        policy_version: fixture.account.policy_version,
      },
    },
    egress_buckets: {
      [fixture.account.egress_bucket]: {
        enabled: true,
        proxy_url: proxyUrl,
        proxy_identity_ref: fixture.account.proxy_identity_ref,
        allowed_account_ids: [fixture.account.account_id],
        tls_profile_ref: primaryProfile,
      },
    },
    env: { ...baseConfig().env, version: fixture.account.policy_version, version_base: fixture.account.policy_version },
    ...overrides,
  } as any);
}

function b4Context(overrides: Record<string, unknown> = {}) {
  return {
    ...fixture.valid_context,
    timestamp_ms: Date.now(),
    nonce: `phase0-b4-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    verified_context_ref: "opaque:context-ref:v1:phase0",
    manifest_authority_ref: "opaque:manifest-ref:v1:phase0",
    proxy_generation: 7,
    expected_proxy_generation: 7,
    ...overrides,
  };
}

function b4Headers(context?: Record<string, unknown>) {
  return {
    "x-cc-gateway-token": fixture.materials.gateway_control_material,
    "x-cc-provider": "anthropic",
    "x-cc-account-id": fixture.account.account_id,
    "x-cc-token-type": "oauth",
    "x-cc-credential-ref": fixture.account.credential_ref,
    "x-cc-egress-bucket": fixture.account.egress_bucket,
    "x-cc-policy-version": fixture.account.policy_version,
    "x-claude-code-session-id": fixture.valid_context.session_id,
    authorization: "Bearer selected-oauth-credential-fixture",
    ...(context ? signedContextHeaders(context) : {}),
  };
}

const b4Cases: Array<[string, (config: any, context: any) => void, boolean]> = [
  ["missing sidecar", (config) => { delete config.egress_tls_sidecar; config.shared_pool.egress_tls = { enabled: false, strict: false }; }, true],
  ["missing verified context", (_config, context) => { delete context.verified_context_ref; }, false],
  ["missing proxy generation", (_config, context) => { delete context.proxy_generation; }, false],
  ["mismatched proxy generation", (_config, context) => { context.expected_proxy_generation = 8; }, false],
  ["disabled profile", (config) => { config.tls_profiles.primary.enabled = false; }, false],
  ["missing manifest authority", (_config, context) => { delete context.manifest_authority_ref; }, false],
  ["unknown manifest authority", (_config, context) => { context.manifest_authority_ref = "opaque:manifest-ref:v1:unknown"; }, false],
  ["missing account identity with valid proxy identity", (config) => { delete config.account_identities[fixture.account.account_id]; }, false],
  ["direct fallback configuration", (config) => { config.shared_pool.direct_fallback = true; }, false],
];

for (const [name, mutate, ordinaryPath] of b4Cases) {
  test(`B4 handleRequest denies ${name} before DNS socket or dial`, async () => {
    const upstream = await startFakeUpstream();
    const proxy = await startFakeConnectProxy();
    const sidecar = await startObservedSidecar();
    const proxyHostUrl = proxy.url.replace("127.0.0.1", "phase0-proxy.invalid");
    const config: any = b4Config(upstream.url, sidecar.url, proxyHostUrl);
    const context: any = b4Context();
    mutate(config, context);
    const dnsLookups: string[] = [];
    const originalLookup = dns.lookup;
    (dns as any).lookup = (hostname: string, options: any, callback?: any) => {
      dnsLookups.push(hostname);
      const cb = typeof options === "function" ? options : callback;
      if (typeof options === "object" && options?.all) cb(null, [{ address: "127.0.0.1", family: 4 }]);
      else cb(null, "127.0.0.1", 4);
    };
    const gateway = startProxy(config);
    try {
      const response = await httpJson(serverUrl(gateway, "/v1/messages?beta=true"), {
        headers: b4Headers(context),
        body: { stream: true, metadata: { user_id: JSON.stringify({ session_id: fixture.valid_context.session_id }) }, model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hello" }] },
      });
      assert.deepEqual(dnsLookups, [], `${name} reached ordinary Node DNS lookup`);
      assert.equal(proxy.connectTargets.length, 0, `${name} created an ordinary upstream proxy dial`);
      assert.equal(sidecar.sockets.length, 0, `${name} created a sidecar socket`);
      assert.equal(response.status, 403, `${name} was not denied by handleRequest`);
      assert.equal(ordinaryPath && dnsLookups.length > 0, false);
    } finally {
      (dns as any).lookup = originalLookup;
      await close(gateway);
      await close(sidecar.server);
      await close(proxy.server);
      await close(upstream.server);
    }
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
  "verified_context_ref",
  "account_identity_ref",
  "manifest_authority_ref",
  "proxy_generation",
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

const controlMutations: Array<[string, string, unknown]> = [
  ["target scheme", "target_scheme", "http"], ["target host", "target_host", "api-alt.anthropic.com"],
  ["target port", "target_port", 8443], ["target path", "target_path", "/v1/alternate"],
  ["route", "route", "/v1/alternate"], ["method", "method", "PUT"],
  ["proxy identity", "proxy_identity_ref", "opaque:proxy-ref:v1:bucket-b"],
  ["account identity", "account_identity_ref", "opaque:account-ref:v1:other"],
  ["verified context", "verified_context_ref", "opaque:context-ref:v1:other"],
  ["proxy generation", "proxy_generation", 8], ["profile ref", "profile_ref", alternateProfile],
  ["manifest authority", "manifest_authority_ref", "opaque:manifest-ref:v1:other"],
  ["egress bucket", "egress_bucket", "bucket-b"], ["expected summary", "expected_tls_summary_bucket", "tls-bucket:alternate"],
  ["nonce", "nonce", "nonce-ref-phase0-0002"], ["timestamp", "timestamp_ms", 1783796400001],
  ["final forwarded-header hash", "final_headers_hash", "sha256:" + "c".repeat(64)],
  ["final request-body hash", "request_body_hash", "sha256:" + "d".repeat(64)],
  ["content length", "content_length", 18], ["content encoding", "content_encoding", "gzip"],
  ["absolute deadline", "absolute_deadline_ms", 1783796460001],
  ["response policy", "expected_response_policy_ref", "response-policy:anthropic-v2"],
  ["envelope version", "envelope_version", 3], ["key epoch", "key_epoch", 12],
  ["attempt ID", "attempt_id", "attempt-ref-phase0-0002"],
];

for (const [name, field, value] of controlMutations) {
  test(`B5 authentication changes after ${name} mutation`, () => {
    const base = prepared();
    const mutatedControl = { ...base.control, [field]: value } as any;
    assert.notEqual(
      computeProxyBinding(bindingSecret, mutatedControl, base.proxyUrl),
      base.proxyBinding,
      `${name} is unsigned`,
    );
  });
}

test("B5 authentication changes after canonical proxy URL mutation", () => {
  const base = prepared();
  assert.notEqual(computeProxyBinding(bindingSecret, base.control, "http://198.51.100.41:8080"), base.proxyBinding);
});

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
