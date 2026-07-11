//go:build phase0red

package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
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
		next            func(first http.Handler, ledger *phase0ReplayLedger) http.Handler
	}
	cases := []replayCase{
		{name: "same_instance_after_successful_completion", stateAssumption: "same handler and ledger", next: func(first http.Handler, _ *phase0ReplayLedger) http.Handler { return first }},
		{name: "restart_with_persistent_replay_state", stateAssumption: "restarted handler loads the persisted ledger", next: func(_ http.Handler, ledger *phase0ReplayLedger) http.Handler {
			restored := newPhase0ReplayLedgerFromSnapshot(ledger.snapshot())
			return phase0ReplayObservingHandler(phase0ForwardingHandler(dialAddr), restored, "restart")
		}},
		{name: "distinct_replica_with_shared_replay_state", stateAssumption: "independent replica uses the shared ledger", next: func(_ http.Handler, ledger *phase0ReplayLedger) http.Handler {
			return phase0ReplayObservingHandler(phase0ForwardingHandler(dialAddr), ledger, "replica-b")
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ledger := newPhase0ReplayLedger()
			first := phase0ReplayObservingHandler(phase0ForwardingHandler(dialAddr), ledger, "replica-a")
			completed := phase0ForwardingRequest(first)
			if completed.Code != http.StatusOK || !strings.Contains(completed.Body.String(), `"forwarded":true`) {
				t.Fatalf("first authenticated completion did not succeed: status=%d body=%q", completed.Code, completed.Body.String())
			}
			if got := ledger.completions(phase0ReplayNonce); got != 1 {
				t.Fatalf("successful completion ledger count = %d, want 1", got)
			}
			replay := phase0ForwardingRequest(tc.next(first, ledger))
			if replay.Code != http.StatusForbidden {
				t.Fatalf("captured request replay status = %d, want 403 (%s)", replay.Code, tc.stateAssumption)
			}
		})
	}
}

func TestPhase0B5CanonicalizationCrossesControlValidationAndAuthentication(t *testing.T) {
	canonical := safeControlJSON()
	reorderedUnicode := phase0EquivalentControlJSON()
	for name, raw := range map[string]string{"canonical": canonical, "reordered_unicode": reorderedUnicode} {
		t.Run(name, func(t *testing.T) {
			envelope := phase0ValidatedAuthenticatedEnvelope(t, raw)
			provided := phase0EnvelopeBinding(envelope)
			if !verifyProxyBinding(phase0BindingSecret, envelope.Control, envelope.ProxyURL, provided) {
				t.Fatal("semantically equivalent control did not reach and pass signature verification")
			}
		})
	}
}

func TestPhase0B5CompleteAuthenticatedEnvelopeRejectsIndependentMutations(t *testing.T) {
	base := phase0ValidatedAuthenticatedEnvelope(t, safeControlJSON())
	provided := phase0EnvelopeBinding(base)
	if !verifyProxyBinding(phase0BindingSecret, base.Control, base.ProxyURL, provided) {
		t.Fatal("complete envelope baseline did not pass signature verification")
	}
	mutations := map[string]func(*phase0AuthenticatedEnvelope){
		"target_scheme":                func(e *phase0AuthenticatedEnvelope) { e.Control.TargetScheme = "http" },
		"target_host":                  func(e *phase0AuthenticatedEnvelope) { e.Control.TargetHost = "api-alt.anthropic.com" },
		"target_port":                  func(e *phase0AuthenticatedEnvelope) { e.Control.TargetPort = 8443 },
		"target_path":                  func(e *phase0AuthenticatedEnvelope) { e.Control.TargetPath = "/v1/alternate" },
		"route":                        func(e *phase0AuthenticatedEnvelope) { e.Control.Route = "/v1/alternate" },
		"method":                       func(e *phase0AuthenticatedEnvelope) { e.Control.Method = "PUT" },
		"proxy_identity_ref":           func(e *phase0AuthenticatedEnvelope) { e.Control.ProxyIdentityRef = "opaque:proxy-ref:v1:bucket-b" },
		"account_identity_ref":         func(e *phase0AuthenticatedEnvelope) { e.AccountIdentityRef = "opaque:account-ref:v1:other" },
		"verified_context_ref":         func(e *phase0AuthenticatedEnvelope) { e.VerifiedContextRef = "opaque:context-ref:v1:other" },
		"proxy_generation":             func(e *phase0AuthenticatedEnvelope) { e.ProxyGeneration = 8 },
		"profile_ref":                  func(e *phase0AuthenticatedEnvelope) { e.Control.ProfileRef = "tls-profile:phase0-alternate-v1" },
		"manifest_authority_ref":       func(e *phase0AuthenticatedEnvelope) { e.ManifestAuthorityRef = "opaque:manifest-ref:v1:other" },
		"egress_bucket":                func(e *phase0AuthenticatedEnvelope) { e.Control.EgressBucket = "bucket-b" },
		"expected_tls_summary_bucket":  func(e *phase0AuthenticatedEnvelope) { e.Control.ExpectedTLSSummaryBucket = "tls-bucket:alternate" },
		"nonce":                        func(e *phase0AuthenticatedEnvelope) { e.Nonce = "nonce-ref-phase0-0002" },
		"timestamp_ms":                 func(e *phase0AuthenticatedEnvelope) { e.TimestampMS++ },
		"final_headers_hash":           func(e *phase0AuthenticatedEnvelope) { e.FinalHeadersHash = "sha256:" + strings.Repeat("c", 64) },
		"request_body_hash":            func(e *phase0AuthenticatedEnvelope) { e.RequestBodyHash = "sha256:" + strings.Repeat("d", 64) },
		"content_length":               func(e *phase0AuthenticatedEnvelope) { e.ContentLength++ },
		"content_encoding":             func(e *phase0AuthenticatedEnvelope) { e.ContentEncoding = "gzip" },
		"absolute_deadline_ms":         func(e *phase0AuthenticatedEnvelope) { e.AbsoluteDeadlineMS++ },
		"expected_response_policy_ref": func(e *phase0AuthenticatedEnvelope) { e.ExpectedResponsePolicyRef = "response-policy:anthropic-v2" },
		"envelope_version":             func(e *phase0AuthenticatedEnvelope) { e.EnvelopeVersion++ },
		"key_epoch":                    func(e *phase0AuthenticatedEnvelope) { e.KeyEpoch++ },
		"attempt_id":                   func(e *phase0AuthenticatedEnvelope) { e.AttemptID = "attempt-ref-phase0-0002" },
	}
	for field, mutate := range mutations {
		t.Run(field, func(t *testing.T) {
			changed := base
			mutate(&changed)
			if reflect.DeepEqual(changed, base) {
				t.Fatalf("fixture mutation for %s changed no field", field)
			}
			if verifyProxyBinding(phase0BindingSecret, changed.Control, changed.ProxyURL, provided) {
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
const phase0ReplayNonce = "nonce-ref-phase0-0001"

type phase0AuthenticatedEnvelope struct {
	Control                   control.Control
	ProxyURL                  string
	AccountIdentityRef        string
	VerifiedContextRef        string
	ManifestAuthorityRef      string
	ProxyGeneration           int
	Nonce                     string
	TimestampMS               int64
	FinalHeadersHash          string
	RequestBodyHash           string
	EnvelopeVersion           int
	KeyEpoch                  int
	AttemptID                 string
	AbsoluteDeadlineMS        int64
	ContentLength             int64
	ContentEncoding           string
	ExpectedResponsePolicyRef string
}

func phase0ValidatedAuthenticatedEnvelope(t *testing.T, rawControl string) phase0AuthenticatedEnvelope {
	t.Helper()
	ctrl, err := control.Validate(safePolicy().ControlToken, []byte(rawControl), safePolicy())
	if err != nil {
		t.Fatalf("valid baseline control rejected before authentication: %v", err)
	}
	return phase0AuthenticatedEnvelope{
		Control: ctrl, ProxyURL: phase0PublicProxy,
		AccountIdentityRef: "opaque:account-ref:v1:phase0", VerifiedContextRef: "opaque:context-ref:v1:phase0",
		ManifestAuthorityRef: "opaque:manifest-ref:v1:phase0", ProxyGeneration: 7,
		Nonce: phase0ReplayNonce, TimestampMS: 1783796400000,
		FinalHeadersHash: "sha256:" + strings.Repeat("a", 64), RequestBodyHash: "sha256:" + strings.Repeat("b", 64),
		EnvelopeVersion: 2, KeyEpoch: 11, AttemptID: "attempt-ref-phase0-0001",
		AbsoluteDeadlineMS: 1783796460000, ContentLength: 17, ContentEncoding: "identity",
		ExpectedResponsePolicyRef: "response-policy:anthropic-v1",
	}
}

func phase0EnvelopeBinding(envelope phase0AuthenticatedEnvelope) string {
	return proxyBindingForTest(phase0BindingSecret, envelope.Control.EgressBucket, envelope.Control.ProxyIdentityRef, envelope.ProxyURL, envelope.Control.TargetHost, envelope.Control.TargetPort)
}

func phase0EquivalentControlJSON() string {
	return `{"method":"POST","route":"/v1/messages","target_path":"/v1/messages","target_scheme":"https","target_port":443,"target_host":"api.anthropic.com","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","egress_bucket":"bucket-a","profile_ref":"tls-profile:claude-code-\u0032.1.179-real-oracle-tcp-v1","expected_tls_summary_bucket":"tls-bucket:claude-code-real-oracle-2179"}`
}

type phase0ReplayLedger struct {
	mu     sync.Mutex
	counts map[string]int
}

func newPhase0ReplayLedger() *phase0ReplayLedger {
	return &phase0ReplayLedger{counts: make(map[string]int)}
}

func newPhase0ReplayLedgerFromSnapshot(snapshot map[string]int) *phase0ReplayLedger {
	ledger := newPhase0ReplayLedger()
	for nonce, count := range snapshot {
		ledger.counts[nonce] = count
	}
	return ledger
}

func (l *phase0ReplayLedger) record(nonce string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.counts[nonce]++
}

func (l *phase0ReplayLedger) completions(nonce string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.counts[nonce]
}

func (l *phase0ReplayLedger) snapshot() map[string]int {
	l.mu.Lock()
	defer l.mu.Unlock()
	snapshot := make(map[string]int, len(l.counts))
	for nonce, count := range l.counts {
		snapshot[nonce] = count
	}
	return snapshot
}

func phase0ReplayObservingHandler(next http.Handler, ledger *phase0ReplayLedger, _ string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recorder := httptest.NewRecorder()
		next.ServeHTTP(recorder, r)
		for name, values := range recorder.Header() {
			w.Header()[name] = append([]string(nil), values...)
		}
		w.WriteHeader(recorder.Code)
		_, _ = w.Write(recorder.Body.Bytes())
		if recorder.Code >= 200 && recorder.Code < 300 {
			ledger.record(phase0ReplayNonce)
		}
	})
}

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

func phase0ControlForRequest() control.Control {
	var ctrl control.Control
	if err := json.Unmarshal([]byte(safeControlJSON()), &ctrl); err != nil {
		panic(err)
	}
	return ctrl
}
