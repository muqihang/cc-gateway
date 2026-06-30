package tlsengine

import (
	"bufio"
	"context"
	"net"
	"testing"
	"time"

	"cc-gateway/egress-tls-sidecar/internal/profile"
	"cc-gateway/egress-tls-sidecar/internal/summary"
)

func TestLogicalSNISidecarClientHelloMatchesPlan70Oracle(t *testing.T) {
	p, ok := profile.Lookup("tls-profile:claude-code-2.1.179-real-oracle-tcp-v1")
	if !ok {
		t.Fatalf("profile missing")
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	captured := make(chan []byte, 1)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
		buf := make([]byte, 8192)
		n, _ := bufio.NewReader(conn).Read(buf)
		captured <- append([]byte(nil), buf[:n]...)
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = SendClientHello(ctx, Request{
		Profile:               p,
		TargetHost:            "api.anthropic.com",
		DialAddress:           ln.Addr().String(),
		AllowTestDialOverride: true,
	})

	var raw []byte
	select {
	case raw = <-captured:
	case <-time.After(3 * time.Second):
		t.Fatalf("collector did not capture ClientHello")
	}
	got, err := summary.SummarizeClientHello(raw, summary.Metadata{
		Source:        "cc_gateway_utls_sidecar",
		Version:       p.Ref,
		ProfileRef:    p.Ref,
		SummaryBucket: p.ExpectedSummaryBucket,
	})
	if err != nil {
		t.Fatalf("summarize ClientHello: %v", err)
	}
	if got.JA3Hash != "d871d02cecbde59abbf8f4806134addf" {
		t.Fatalf("unexpected JA3: got %s", got.JA3Hash)
	}
	if got.JA4 != "t13d0017h1_18560269b2cb_92d925a272a4" {
		t.Fatalf("unexpected JA4: got %s", got.JA4)
	}
	if got.CipherCount != 17 || got.ExtensionCount != 14 {
		t.Fatalf("unexpected logical-SNI counts: %+v", got)
	}
	if !got.SNIPresent || got.SNIHostBucket != "anthropic_api" {
		t.Fatalf("expected api.anthropic.com SNI bucket, got %+v", got)
	}
	if got.GREASEPresent {
		t.Fatalf("logical-SNI profile must not add GREASE")
	}
	if len(got.ALPNProtocols) != 1 || got.ALPNProtocols[0] != "http/1.1" {
		t.Fatalf("unexpected ALPN protocols: %+v", got.ALPNProtocols)
	}
	result := summary.CompareToExpected(got, p.Expected)
	if result.Status != "MATCH" {
		t.Fatalf("expected sidecar to match Plan70 SNI oracle, got %+v", result)
	}
}
