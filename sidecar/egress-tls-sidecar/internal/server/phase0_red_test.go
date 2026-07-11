//go:build phase0red

package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"cc-gateway/egress-tls-sidecar/internal/control"
)

func TestPhase0B5RejectsLegacyPartialProxyBinding(t *testing.T) {
	ctrl := phase0Control(t)
	provided := proxyBindingForTest(phase0BindingSecret, ctrl.EgressBucket, ctrl.ProxyIdentityRef, phase0PublicProxy, ctrl.TargetHost, ctrl.TargetPort)
	if verifyProxyBinding(phase0BindingSecret, ctrl, phase0PublicProxy, provided) {
		t.Fatal("legacy v1 partial proxy binding remains an accepted sidecar authentication boundary")
	}
}

func TestPhase0B5BindingRejectsEveryControlMutation(t *testing.T) {
	base := phase0Control(t)
	provided := proxyBindingForTest(phase0BindingSecret, base.EgressBucket, base.ProxyIdentityRef, phase0PublicProxy, base.TargetHost, base.TargetPort)
	cases := map[string]func(*control.Control){
		"profile_ref":                 func(c *control.Control) { c.ProfileRef = "tls-profile:phase0-alternate-v1" },
		"egress_bucket":               func(c *control.Control) { c.EgressBucket = "bucket-b" },
		"proxy_identity_ref":          func(c *control.Control) { c.ProxyIdentityRef = "opaque:proxy-ref:v1:bucket-b" },
		"target_host":                 func(c *control.Control) { c.TargetHost = "api-alt.anthropic.com" },
		"target_port":                 func(c *control.Control) { c.TargetPort = 8443 },
		"expected_tls_summary_bucket": func(c *control.Control) { c.ExpectedTLSSummaryBucket = "tls-bucket:alternate" },
		"target_scheme":               func(c *control.Control) { c.TargetScheme = "http" },
		"target_path":                 func(c *control.Control) { c.TargetPath = "/v1/alternate" },
		"route":                       func(c *control.Control) { c.Route = "/v1/alternate" },
		"method":                      func(c *control.Control) { c.Method = "PUT" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			changed := base
			mutate(&changed)
			if verifyProxyBinding(phase0BindingSecret, changed, phase0PublicProxy, provided) {
				t.Fatalf("captured authentication accepted mutated %s", name)
			}
		})
	}
}

func TestPhase0B5ReplayRejectedAfterCompletionRestartAndReplicaChange(t *testing.T) {
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"forwarded":true}`))
	}))
	defer upstream.Close()
	dialAddr := strings.TrimPrefix(upstream.URL, "https://")
	type replayCase struct {
		name            string
		stateAssumption string
		next            func(first http.Handler) http.Handler
	}
	cases := []replayCase{
		{name: "same_instance_after_successful_completion", stateAssumption: "same in-memory replay state", next: func(first http.Handler) http.Handler { return first }},
		{name: "restart_with_persistent_replay_state", stateAssumption: "new handler loads the same persistent replay store", next: func(http.Handler) http.Handler { return phase0ForwardingHandler(dialAddr) }},
		{name: "distinct_replica_with_shared_replay_state", stateAssumption: "independent replica consults the shared replay store", next: func(http.Handler) http.Handler { return phase0ForwardingHandler(dialAddr) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			first := phase0ForwardingHandler(dialAddr)
			completed := phase0ForwardingRequest(first)
			if completed.Code != http.StatusOK || !strings.Contains(completed.Body.String(), `"forwarded":true`) {
				t.Fatalf("first authenticated completion did not succeed: status=%d body=%q", completed.Code, completed.Body.String())
			}
			replay := phase0ForwardingRequest(tc.next(first))
			if replay.Code != http.StatusForbidden {
				t.Fatalf("captured request replay status = %d, want 403 (%s)", replay.Code, tc.stateAssumption)
			}
		})
	}
}

func TestPhase0B5CanonicalizationCrossesHandlerAuthenticationBoundary(t *testing.T) {
	canonical := phase0CompleteControlJSONForServer(false)
	reorderedUnicode := phase0CompleteControlJSONForServer(true)
	for name, raw := range map[string]string{"canonical": canonical, "reordered_unicode": reorderedUnicode} {
		t.Run(name, func(t *testing.T) {
			recorder := phase0RawAuthenticatedRequest(phase0Handler(), raw, phase0PublicProxy)
			if recorder.Code == http.StatusForbidden {
				t.Fatalf("semantic envelope representation was rejected before authenticated envelope verification")
			}
		})
	}
}

func TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations(t *testing.T) {
	mutations := map[string]any{
		"target_scheme": "http", "target_host": "api-alt.anthropic.com", "target_port": 8443,
		"target_path": "/v1/alternate", "route": "/v1/alternate", "method": "PUT",
		"proxy_identity_ref": "opaque:proxy-ref:v1:bucket-b", "account_identity_ref": "opaque:account-ref:v1:other",
		"verified_context_ref": "opaque:context-ref:v1:other", "proxy_generation": 8,
		"profile_ref": "tls-profile:phase0-alternate-v1", "manifest_authority_ref": "opaque:manifest-ref:v1:other",
		"egress_bucket": "bucket-b", "expected_tls_summary_bucket": "tls-bucket:alternate",
		"nonce": "nonce-ref-phase0-0002", "timestamp_ms": float64(1783796400001),
		"final_headers_hash": "sha256:" + strings.Repeat("c", 64), "request_body_hash": "sha256:" + strings.Repeat("d", 64),
		"content_length": float64(18), "content_encoding": "gzip", "absolute_deadline_ms": float64(1783796460001),
		"expected_response_policy_ref": "response-policy:anthropic-v2", "envelope_version": float64(3),
		"key_epoch": float64(12), "attempt_id": "attempt-ref-phase0-0002",
	}
	for field, value := range mutations {
		t.Run(field, func(t *testing.T) {
			baseRaw := phase0CompleteControlJSONForServer(false)
			baseline := phase0RawAuthenticatedRequest(phase0Handler(), baseRaw, phase0PublicProxy)
			if baseline.Code == http.StatusForbidden {
				t.Fatalf("complete authenticated baseline was rejected before %s mutation reached envelope verification", field)
			}
			var envelope map[string]any
			if err := json.Unmarshal([]byte(baseRaw), &envelope); err != nil {
				t.Fatal(err)
			}
			envelope[field] = value
			mutatedRaw, err := json.Marshal(envelope)
			if err != nil {
				t.Fatal(err)
			}
			mutated := phase0RawAuthenticatedRequest(phase0Handler(), string(mutatedRaw), phase0PublicProxy)
			if mutated.Code != http.StatusForbidden {
				t.Fatalf("captured authentication accepted independently mutated %s", field)
			}
		})
	}
}

func TestPhase0B6RejectsUnsafeProxyDestinationsBeforeDial(t *testing.T) {
	cases := map[string]string{
		"ipv4_loopback":          "http://127.0.0.1:8080",
		"ipv4_link_local":        "http://169.254.20.10:8080",
		"metadata":               "http://169.254.169.254:8080",
		"ipv4_multicast":         "http://224.0.0.1:8080",
		"ipv4_unspecified":       "http://0.0.0.0:8080",
		"private_without_policy": "http://10.20.30.40:8080",
		"ipv4_mapped_ipv6":       "http://[::ffff:127.0.0.1]:8080",
		"expanded_mapped_ipv6":   "http://[0:0:0:0:0:ffff:7f00:1]:8080",
		"ipv6_loopback":          "http://[::1]:8080",
		"ipv6_link_local":        "http://[fe80::1]:8080",
		"ipv6_multicast":         "http://[ff02::1]:8080",
		"ipv6_unspecified":       "http://[::]:8080",
		"dns_rebinding_unpinned": "http://rebinding.invalid:8080",
		"redirect_directive":     "http://198.51.100.40:8080/?redirect=http%3A%2F%2F127.0.0.1",
		"nested_proxy_directive": "http://198.51.100.40:8080/?proxy=socks5%3A%2F%2F127.0.0.1",
		"alternate_dial_target":  "http://198.51.100.40:8080/?dial_host=127.0.0.1",
		"scheme_confusion":       "http://198.51.100.40:8080/%2f%2fsocks5:%2f%2f127.0.0.1",
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			if got, err := safeProxyURLHeader(raw); err == nil {
				t.Fatalf("unsafe destination accepted before dial as %q", got)
			}
		})
	}
}

func TestPhase0B6RebindingResolutionIsPinnedBeforeDial(t *testing.T) {
	resolved := []string{"198.51.100.40", "127.0.0.1"}
	resolverCalls := 0
	dialTargets := []string{}
	resolver := func(_ string) ([]net.IP, error) {
		value := resolved[resolverCalls]
		resolverCalls++
		return []net.IP{net.ParseIP(value)}, nil
	}
	dialObserver := func(address string) { dialTargets = append(dialTargets, address) }

	// The real handler must own resolution and pass only the pinned public address to its dial path.
	h := phase0HandlerWithNetworkObservers(resolver, dialObserver)
	_ = phase0RawAuthenticatedRequest(h, safeControlJSON(), "http://rebinding.invalid:8080")
	if resolverCalls != 1 {
		t.Fatalf("handler resolver calls = %d, want exactly one pinned resolution", resolverCalls)
	}
	if len(dialTargets) != 1 || dialTargets[0] != "198.51.100.40:8080" {
		t.Fatalf("handler dial targets = %v, want pinned public address only", dialTargets)
	}
}

const phase0BindingSecret = "phase0-red-independent-binding-material-20260711"
const phase0PublicProxy = "http://198.51.100.40:8080"

func phase0Control(t *testing.T) control.Control {
	t.Helper()
	var ctrl control.Control
	if err := json.Unmarshal([]byte(safeControlJSON()), &ctrl); err != nil {
		t.Fatal(err)
	}
	return ctrl
}

func phase0Handler() http.Handler {
	return NewHandler(Config{
		Policy:             safePolicy(),
		RequireProxyEgress: true,
		ProxyBindingSecret: phase0BindingSecret,
		ForwardTimeout:     100 * time.Millisecond,
	})
}

func phase0ForwardingHandler(dialAddr string) http.Handler {
	return NewHandler(Config{
		Policy:                safePolicy(),
		DialOverrides:         map[string]string{"api.anthropic.com:443": dialAddr},
		AllowTestDialOverride: true,
		ForwardTimeout:        time.Second,
	})
}

func phase0HandlerWithNetworkObservers(
	resolver func(string) ([]net.IP, error),
	dialObserver func(string),
) http.Handler {
	return NewHandler(Config{
		Policy:             safePolicy(),
		RequireProxyEgress: true,
		ProxyBindingSecret: phase0BindingSecret,
		ForwardTimeout:     100 * time.Millisecond,
		ProxyResolver: func(_ context.Context, host string) ([]net.IP, error) {
			return resolver(host)
		},
		ProxyDialObserver: dialObserver,
	})
}

func phase0AuthenticatedRequest(handler http.Handler) *httptest.ResponseRecorder {
	ctrl := phase0ControlForRequest()
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/egress", bytes.NewBufferString(`{"fixture":true}`))
	req.Header.Set("x-cc-egress-sidecar-token", testToken)
	req.Header.Set("x-cc-egress-control", safeControlJSON())
	req.Header.Set("x-cc-egress-proxy-url", phase0PublicProxy)
	req.Header.Set("x-cc-egress-proxy-binding", proxyBindingForTest(phase0BindingSecret, ctrl.EgressBucket, ctrl.ProxyIdentityRef, phase0PublicProxy, ctrl.TargetHost, ctrl.TargetPort))
	handler.ServeHTTP(recorder, req)
	return recorder
}

func phase0ForwardingRequest(handler http.Handler) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/egress", bytes.NewBufferString(`{"fixture":true}`))
	req.Header.Set("x-cc-egress-sidecar-token", testToken)
	req.Header.Set("x-cc-egress-control", safeControlJSON())
	req.Header.Set("x-cc-egress-upstream-headers", encodeUpstreamHeadersForTest(map[string]string{"content-type": "application/json"}))
	handler.ServeHTTP(recorder, req)
	return recorder
}

func phase0RawAuthenticatedRequest(handler http.Handler, rawControl, proxyURL string) *httptest.ResponseRecorder {
	ctrl := phase0ControlForRequest()
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/egress", bytes.NewBufferString(`{"fixture":true}`))
	req.Header.Set("x-cc-egress-sidecar-token", testToken)
	req.Header.Set("x-cc-egress-control", rawControl)
	req.Header.Set("x-cc-egress-proxy-url", proxyURL)
	req.Header.Set("x-cc-egress-proxy-binding", proxyBindingForTest(phase0BindingSecret, ctrl.EgressBucket, ctrl.ProxyIdentityRef, proxyURL, ctrl.TargetHost, ctrl.TargetPort))
	handler.ServeHTTP(recorder, req)
	return recorder
}

func phase0CompleteControlJSONForServer(reorderedUnicode bool) string {
	if reorderedUnicode {
		return `{"method":"POST","route":"/v1/messages","target_path":"/v1/messages","target_scheme":"https","target_port":443,"target_host":"api.anthropic.com","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","egress_bucket":"bucket-a","profile_ref":"tls-profile:claude-code-\\u0032.1.179-real-oracle-tcp-v1","expected_tls_summary_bucket":"tls-bucket:claude-code-real-oracle-2179","nonce":"nonce-ref-phase0-0001","timestamp_ms":1783796400000,"final_headers_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","request_body_hash":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","envelope_version":2,"key_epoch":11,"attempt_id":"attempt-ref-phase0-0001","absolute_deadline_ms":1783796460000,"content_length":17,"content_encoding":"identity","expected_response_policy_ref":"response-policy:anthropic-v1","verified_context_ref":"opaque:context-ref:v1:phase0","account_identity_ref":"opaque:account-ref:v1:phase0","manifest_authority_ref":"opaque:manifest-ref:v1:phase0","proxy_generation":7}`
	}
	return `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST","expected_tls_summary_bucket":"tls-bucket:claude-code-real-oracle-2179","nonce":"nonce-ref-phase0-0001","timestamp_ms":1783796400000,"final_headers_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","request_body_hash":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","envelope_version":2,"key_epoch":11,"attempt_id":"attempt-ref-phase0-0001","absolute_deadline_ms":1783796460000,"content_length":17,"content_encoding":"identity","expected_response_policy_ref":"response-policy:anthropic-v1","verified_context_ref":"opaque:context-ref:v1:phase0","account_identity_ref":"opaque:account-ref:v1:phase0","manifest_authority_ref":"opaque:manifest-ref:v1:phase0","proxy_generation":7}`
}

func phase0ControlForRequest() control.Control {
	var ctrl control.Control
	if err := json.Unmarshal([]byte(safeControlJSON()), &ctrl); err != nil {
		panic(err)
	}
	return ctrl
}
