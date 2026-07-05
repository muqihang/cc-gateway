package server

import (
	"bufio"
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"cc-gateway/egress-tls-sidecar/internal/control"
)

const testToken = "sidecar-control-material-v1-local-safe-fixture-123456"
const expectedBucket = "tls-bucket:claude-code-real-oracle-2179"

func TestHandlerSendsRealUTLSClientHelloAndReturnsVerifiedBucket(t *testing.T) {
	collectorAddr, captured := startClientHelloCollector(t)
	h := NewHandler(Config{Policy: safePolicy(), DialOverrides: map[string]string{"api.anthropic.com:443": collectorAddr}, AllowTestDialOverride: true})
	res := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/egress", bytes.NewBufferString(`{"ok":true}`))
	req.Header.Set("x-cc-egress-sidecar-token", testToken)
	req.Header.Set("x-cc-egress-control", safeControlJSON())
	h.ServeHTTP(res, req)
	if res.Code != 200 {
		t.Fatalf("unexpected status %d body %s", res.Code, res.Body.String())
	}
	if got := res.Header().Get("x-cc-egress-tls-summary-bucket"); got != expectedBucket {
		t.Fatalf("unexpected summary bucket %q", got)
	}
	select {
	case summary := <-captured:
		if summary.JA3Hash != "d871d02cecbde59abbf8f4806134addf" || summary.ExtensionCount != 14 {
			t.Fatalf("unexpected sidecar summary: %+v", summary)
		}
		if !summary.SNIPresent || summary.SNIHostBucket != "anthropic_api" {
			t.Fatalf("unexpected SNI bucket: %+v", summary)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("collector did not capture ClientHello")
	}
}

func TestHandlerForwardsHTTPResponseAfterTLSProof(t *testing.T) {
	upstreamSawAuth := make(chan string, 1)
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Fatalf("unexpected upstream path %q", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected upstream method %q", r.Method)
		}
		upstreamSawAuth <- r.Header.Get("authorization")
		w.Header().Set("content-type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("event: message_start\n"))
		_, _ = w.Write([]byte(`data: {"type":"message_start","message":{"id":"msg_safe","type":"message","role":"assistant","model":"claude-opus-4-8","content":[],"usage":{"input_tokens":1,"output_tokens":0}}}` + "\n\n"))
		_, _ = w.Write([]byte("event: message_delta\n"))
		_, _ = w.Write([]byte(`data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}` + "\n\n"))
		_, _ = w.Write([]byte("event: message_stop\n"))
		_, _ = w.Write([]byte(`data: {"type":"message_stop"}` + "\n\n"))
	}))
	defer upstream.Close()

	dialAddr := strings.TrimPrefix(upstream.URL, "https://")
	h := NewHandler(Config{Policy: safePolicy(), DialOverrides: map[string]string{"api.anthropic.com:443": dialAddr}, AllowTestDialOverride: true})
	res := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/egress", bytes.NewBufferString(`{"stream":true}`))
	req.Header.Set("x-cc-egress-sidecar-token", testToken)
	req.Header.Set("x-cc-egress-control", safeControlJSON())
	req.Header.Set("x-cc-egress-upstream-headers", encodeUpstreamHeadersForTest(map[string]string{
		"authorization":     "Bearer safe-fixture",
		"content-type":      "application/json",
		"accept":            "text/event-stream",
		"anthropic-version": "2023-06-01",
		"anthropic-beta":    "claude-code-2-1-197",
		"x-fixture-header":  "safe",
		"host":              "evil.example",
	}))

	h.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("unexpected status %d body %s", res.Code, res.Body.String())
	}
	if got := res.Header().Get("x-cc-egress-tls-summary-bucket"); got != expectedBucket {
		t.Fatalf("unexpected summary bucket %q", got)
	}
	if ct := res.Header().Get("content-type"); !strings.Contains(ct, "text/event-stream") {
		t.Fatalf("expected upstream content-type to be forwarded, got %q", ct)
	}
	if body := res.Body.String(); !strings.Contains(body, "message_stop") || strings.Contains(body, `"ok":true`) {
		t.Fatalf("sidecar did not forward upstream SSE body, got %q", body)
	}
	select {
	case got := <-upstreamSawAuth:
		if got != "Bearer safe-fixture" {
			t.Fatalf("authorization header was not forwarded safely, got %q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("upstream did not receive forwarded request")
	}
}

func TestHandlerProductionModeRequiresProxyURLAndDoesNotDirectDial(t *testing.T) {
	collectorAddr, captured := startClientHelloCollector(t)
	h := NewHandler(Config{Policy: safePolicy(), RequireProxyEgress: true})
	res := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/egress", bytes.NewBufferString(`{"ok":true}`))
	req.Header.Set("x-cc-egress-sidecar-token", testToken)
	req.Header.Set("x-cc-egress-control", safeControlJSON())
	_ = collectorAddr
	h.ServeHTTP(res, req)
	if res.Code < 400 {
		t.Fatalf("expected production sidecar to fail closed without proxy URL, got %d", res.Code)
	}
	if got := res.Header().Get("x-cc-egress-tls-summary-bucket"); got != "" {
		t.Fatalf("failed request must not report verified bucket, got %q", got)
	}
	select {
	case summary := <-captured:
		t.Fatalf("direct dial occurred without proxy: %+v", summary)
	case <-time.After(150 * time.Millisecond):
	}
}

func TestHandlerProductionModeRejectsForgedProxyBinding(t *testing.T) {
	h := NewHandler(Config{Policy: safePolicy(), RequireProxyEgress: true, ProxyBindingSecret: "proxy-binding-material-v1-local-safe-fixture-123456"})
	res := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/egress", bytes.NewBufferString(`{"ok":true}`))
	req.Header.Set("x-cc-egress-sidecar-token", testToken)
	req.Header.Set("x-cc-egress-control", safeControlJSON())
	req.Header.Set("x-cc-egress-proxy-url", "http://127.0.0.1:9")
	req.Header.Set("x-cc-egress-proxy-binding", proxyBindingForTest("wrong-secret", "bucket-a", "opaque:proxy-ref:v1:bucket-a", "http://127.0.0.1:9", "api.anthropic.com", 443))
	h.ServeHTTP(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("expected forged proxy binding to be rejected with 403, got %d body %s", res.Code, res.Body.String())
	}
}

func TestVerifyProxyBindingBindsEgressBucket(t *testing.T) {
	var ctrl control.Control
	if err := json.Unmarshal([]byte(safeControlJSON()), &ctrl); err != nil {
		t.Fatal(err)
	}
	secret := "proxy-binding-material-v1-local-safe-fixture-123456"
	proxyURL := "http://127.0.0.1:9"
	valid := proxyBindingForTest(secret, ctrl.EgressBucket, ctrl.ProxyIdentityRef, proxyURL, ctrl.TargetHost, ctrl.TargetPort)
	if !verifyProxyBinding(secret, ctrl, proxyURL, valid) {
		t.Fatalf("expected valid egress-bound proxy binding to verify")
	}
	wrongBucket := proxyBindingForTest(secret, "bucket-other", ctrl.ProxyIdentityRef, proxyURL, ctrl.TargetHost, ctrl.TargetPort)
	if verifyProxyBinding(secret, ctrl, proxyURL, wrongBucket) {
		t.Fatalf("expected proxy binding for a different egress bucket to be rejected")
	}
}

func TestSafeProxyURLHeaderRejectsProviderHostAsProxy(t *testing.T) {
	if _, err := safeProxyURLHeader("https://api.anthropic.com:443"); err == nil {
		t.Fatalf("expected provider host proxy URL to be rejected")
	}
}

func TestReadRequestBodyLimitedRejectsOversizedBody(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/egress", bytes.NewBufferString("123456"))
	body, err := readRequestBodyLimited(req, 5)
	if err == nil {
		t.Fatalf("expected oversized body to be rejected, got body length %d", len(body))
	}
}

func TestHandlerHealthDoesNotRequireControlMaterial(t *testing.T) {
	h := NewHandler(Config{Policy: safePolicy()})
	req := httptest.NewRequest(http.MethodGet, "/_health", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("health status = %d, want 200", rec.Code)
	}
	if rec.Header().Get("content-type") != "application/json" {
		t.Fatalf("unexpected content-type: %q", rec.Header().Get("content-type"))
	}
}

func TestHandlerFailsClosedOnSummaryMismatch(t *testing.T) {
	collectorAddr, _ := startClientHelloCollector(t)
	h := NewHandler(Config{Policy: safePolicy(), DialOverrides: map[string]string{"api.anthropic.com:443": collectorAddr}, AllowTestDialOverride: true})
	ctrl := map[string]any{}
	if err := json.Unmarshal([]byte(safeControlJSON()), &ctrl); err != nil {
		t.Fatal(err)
	}
	ctrl["expected_tls_summary_bucket"] = "tls-bucket:wrong"
	raw, _ := json.Marshal(ctrl)
	res := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/egress", bytes.NewBufferString(`{"ok":true}`))
	req.Header.Set("x-cc-egress-sidecar-token", testToken)
	req.Header.Set("x-cc-egress-control", string(raw))
	h.ServeHTTP(res, req)
	if res.Code < 400 {
		t.Fatalf("expected fail-closed status, got %d", res.Code)
	}
	if got := res.Header().Get("x-cc-egress-tls-summary-bucket"); got != "" {
		t.Fatalf("failed request must not report verified bucket, got %q", got)
	}
}

func safePolicy() control.Policy {
	return control.Policy{
		ControlToken:             testToken,
		AllowedTargetHosts:       []string{"api.anthropic.com"},
		AllowedRoutes:            []string{"/v1/messages"},
		AllowedProfileRefs:       []string{"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1"},
		AllowedEgressBuckets:     []string{"bucket-a"},
		AllowedProxyIdentityRefs: []string{"opaque:proxy-ref:v1:bucket-a"},
	}
}

func safeControlJSON() string {
	return `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST","expected_tls_summary_bucket":"tls-bucket:claude-code-real-oracle-2179"}`
}

func startClientHelloCollector(t *testing.T) (string, <-chan CapturedSummary) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ch := make(chan CapturedSummary, 1)
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
		buf := make([]byte, 8192)
		n, _ := bufio.NewReader(conn).Read(buf)
		if n > 0 {
			s, _ := SummarizeCapturedClientHello(context.Background(), buf[:n])
			ch <- s
		}
	}()
	return ln.Addr().String(), ch
}

func encodeUpstreamHeadersForTest(headers map[string]string) string {
	raw, err := json.Marshal(headers)
	if err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}

func proxyBindingForTest(secret, egressBucket, proxyIdentityRef, proxyURL, targetHost string, targetPort int) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("cc-egress-sidecar-proxy-binding-v1"))
	mac.Write([]byte{0})
	mac.Write([]byte(egressBucket))
	mac.Write([]byte{0})
	mac.Write([]byte(proxyIdentityRef))
	mac.Write([]byte{0})
	mac.Write([]byte(proxyURL))
	mac.Write([]byte{0})
	mac.Write([]byte(targetHost))
	mac.Write([]byte{0})
	mac.Write([]byte("443"))
	return "hmac-sha256:" + fmt.Sprintf("%x", mac.Sum(nil))
}
