//go:build phase0red

package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
	cases := map[string]func(first http.Handler) http.Handler{
		"after_completion": func(first http.Handler) http.Handler { return first },
		"after_restart":    func(http.Handler) http.Handler { return phase0Handler() },
		"second_replica":   func(http.Handler) http.Handler { return phase0Handler() },
	}
	for name, next := range cases {
		t.Run(name, func(t *testing.T) {
			first := phase0Handler()
			phase0AuthenticatedRequest(first)
			replay := phase0AuthenticatedRequest(next(first))
			if replay.Code != http.StatusForbidden {
				t.Fatalf("captured request replay status = %d, want 403", replay.Code)
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

func phase0ControlForRequest() control.Control {
	var ctrl control.Control
	if err := json.Unmarshal([]byte(safeControlJSON()), &ctrl); err != nil {
		panic(err)
	}
	return ctrl
}
