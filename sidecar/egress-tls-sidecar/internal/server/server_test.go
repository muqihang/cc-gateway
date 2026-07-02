package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
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
