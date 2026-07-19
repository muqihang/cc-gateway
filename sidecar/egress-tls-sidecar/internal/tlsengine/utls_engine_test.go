package tlsengine

import (
	"bufio"
	"context"
	"io"
	"net"
	"testing"
	"time"

	"cc-gateway/egress-tls-sidecar/internal/profile"
	"cc-gateway/egress-tls-sidecar/internal/summary"
)

func TestUTLSConfigForRequestRequiresDualLoopbackTestAuthority(t *testing.T) {
	p, ok := profile.Lookup("tls-profile:claude-code-2.1.179-real-oracle-tcp-v1")
	if !ok {
		t.Fatal("profile missing")
	}
	production, err := utlsConfigForRequest(Request{Profile: p, TargetHost: "api.anthropic.com"})
	if err != nil {
		t.Fatalf("production config error: %v", err)
	}
	if production.InsecureSkipVerify {
		t.Fatal("production uTLS config must verify certificates")
	}

	for name, req := range map[string]Request{
		"dial without allow": {
			Profile: p, TargetHost: "api.anthropic.com", DialAddress: "127.0.0.1:443",
		},
		"allow without dial": {
			Profile: p, TargetHost: "api.anthropic.com", AllowTestDialOverride: true,
		},
		"non-loopback dial with allow": {
			Profile: p, TargetHost: "api.anthropic.com", DialAddress: "192.0.2.10:443", AllowTestDialOverride: true,
		},
		"malformed dial with allow": {
			Profile: p, TargetHost: "api.anthropic.com", DialAddress: "not-a-listener", AllowTestDialOverride: true,
		},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := utlsConfigForRequest(req); err == nil {
				t.Fatal("expected test dial authority rejection")
			}
		})
	}

	testOnly, err := utlsConfigForRequest(Request{
		Profile: p, TargetHost: "api.anthropic.com", DialAddress: "127.0.0.1:443", AllowTestDialOverride: true,
	})
	if err != nil {
		t.Fatalf("dual-authority test config error: %v", err)
	}
	if !testOnly.InsecureSkipVerify {
		t.Fatal("explicit loopback test override must preserve raw ClientHello fixture behavior")
	}
}

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

func TestDialViaHTTPConnectProxyUsesProxyAndNeverDirectTarget(t *testing.T) {
	proxySawConnect := make(chan string, 1)
	proxyLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer proxyLn.Close()
	go func() {
		conn, err := proxyLn.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
		line, err := bufio.NewReader(conn).ReadString('\n')
		if err == nil {
			proxySawConnect <- line
		}
	}()

	targetLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer targetLn.Close()
	targetSawDirect := make(chan struct{}, 1)
	go func() {
		conn, err := targetLn.Accept()
		if err != nil {
			return
		}
		_ = conn.Close()
		targetSawDirect <- struct{}{}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err = dialProxyTunnel(ctx, "http://"+proxyLn.Addr().String(), "api.anthropic.com", 443)
	if err == nil {
		t.Fatalf("expected proxy tunnel to fail after fake proxy closes")
	}
	select {
	case line := <-proxySawConnect:
		if line != "CONNECT api.anthropic.com:443 HTTP/1.1\r\n" {
			t.Fatalf("unexpected CONNECT line %q", line)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("proxy did not receive CONNECT")
	}
	select {
	case <-targetSawDirect:
		t.Fatalf("target listener received a direct connection")
	case <-time.After(100 * time.Millisecond):
	}
}

func TestDialProxyTunnelRejectsProviderHostAsProxy(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err := dialProxyTunnel(ctx, "https://api.anthropic.com:443", "api.anthropic.com", 443); err == nil {
		t.Fatalf("expected provider host proxy URL to be rejected before any network dial")
	}
}

func TestDialViaHTTPConnectProxyReturnsUsableTunnel(t *testing.T) {
	proxyLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer proxyLn.Close()
	go func() {
		conn, err := proxyLn.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
		reader := bufio.NewReader(conn)
		for {
			line, err := reader.ReadString('\n')
			if err != nil || line == "\r\n" {
				break
			}
		}
		_, _ = conn.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))
		buf := make([]byte, 4)
		if _, err := io.ReadFull(reader, buf); err == nil && string(buf) == "ping" {
			_, _ = conn.Write([]byte("pong"))
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	conn, err := dialProxyTunnel(ctx, "http://"+proxyLn.Addr().String(), "api.anthropic.com", 443)
	if err != nil {
		t.Fatalf("dialProxyTunnel() error = %v", err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
	if _, err := conn.Write([]byte("ping")); err != nil {
		t.Fatalf("write tunnel: %v", err)
	}
	buf := make([]byte, 4)
	if _, err := io.ReadFull(conn, buf); err != nil {
		t.Fatalf("read tunnel: %v", err)
	}
	if string(buf) != "pong" {
		t.Fatalf("unexpected tunnel echo %q", string(buf))
	}
}
