package tlsengine

import (
	"bufio"
	"context"
	"net"
	"testing"
	"time"

	"cc-gateway/egress-tls-sidecar/internal/profile"
)

func TestSendClientHelloSummaryReportsActualWrittenClientHello(t *testing.T) {
	p, ok := profile.Lookup(profile.ClaudeCode2179Ref)
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
	got, err := SendClientHelloSummary(ctx, Request{Profile: p, TargetHost: "api.anthropic.com", DialAddress: ln.Addr().String(), AllowTestDialOverride: true})
	if err != nil {
		t.Fatalf("SendClientHelloSummary() error = %v", err)
	}
	if got.JA3Hash != "d871d02cecbde59abbf8f4806134addf" || got.ExtensionCount != 14 {
		t.Fatalf("unexpected returned summary: %+v", got)
	}
	if !got.SNIPresent || got.SNIHostBucket != "anthropic_api" {
		t.Fatalf("unexpected returned SNI bucket: %+v", got)
	}
	select {
	case raw := <-captured:
		if len(raw) == 0 {
			t.Fatalf("collector captured no ClientHello bytes")
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("collector did not capture ClientHello")
	}
}
