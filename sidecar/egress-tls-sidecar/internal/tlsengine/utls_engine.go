package tlsengine

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"cc-gateway/egress-tls-sidecar/internal/profile"
	"cc-gateway/egress-tls-sidecar/internal/summary"
	utls "github.com/refraction-networking/utls"
	xproxy "golang.org/x/net/proxy"
)

type Request struct {
	Profile               profile.Profile
	TargetHost            string
	DialAddress           string
	AllowTestDialOverride bool
	ProxyURL              string
	RequireProxy          bool
}

type ForwardRequest struct {
	Request
	Method  string
	Path    string
	Headers http.Header
	Body    []byte
}

type ForwardResponse struct {
	StatusCode int
	Headers    http.Header
	Body       io.ReadCloser
	Summary    summary.SafeSummary
}

func SendClientHello(ctx context.Context, req Request) error {
	_, err := SendClientHelloSummary(ctx, req)
	return err
}

func SendClientHelloSummary(ctx context.Context, req Request) (summary.SafeSummary, error) {
	u, rec, err := dialUTLS(ctx, req)
	if err != nil {
		return summary.SafeSummary{}, err
	}
	defer u.Close()
	return summarizeRecordedClientHello(req, rec)
}

func ForwardHTTP(ctx context.Context, req ForwardRequest) (ForwardResponse, error) {
	if req.Method != http.MethodPost || req.Path == "" || !strings.HasPrefix(req.Path, "/") || strings.Contains(req.Path, "\r") || strings.Contains(req.Path, "\n") {
		return ForwardResponse{}, fmt.Errorf("unsafe HTTP forward request")
	}
	u, rec, err := dialUTLS(ctx, req.Request)
	if err != nil {
		return ForwardResponse{}, err
	}
	safeSummary, err := summarizeRecordedClientHello(req.Request, rec)
	if err != nil {
		_ = u.Close()
		return ForwardResponse{}, err
	}
	h := req.Headers.Clone()
	h.Set("Host", req.TargetHost)
	h.Set("Content-Length", fmt.Sprintf("%d", len(req.Body)))
	h.Del("Connection")
	h.Del("Proxy-Connection")
	h.Del("Keep-Alive")
	h.Del("Transfer-Encoding")
	h.Del("Upgrade")
	outReq, err := http.NewRequestWithContext(ctx, req.Method, "https://"+req.TargetHost+req.Path, bytes.NewReader(req.Body))
	if err != nil {
		_ = u.Close()
		return ForwardResponse{}, err
	}
	outReq.Header = h
	outReq.Host = req.TargetHost
	outReq.ContentLength = int64(len(req.Body))
	if err := outReq.Write(u); err != nil {
		_ = u.Close()
		return ForwardResponse{}, fmt.Errorf("write upstream request: %w", err)
	}
	br := bufio.NewReader(u)
	resp, err := http.ReadResponse(br, outReq)
	if err != nil {
		_ = u.Close()
		return ForwardResponse{}, fmt.Errorf("read upstream response: %w", err)
	}
	return ForwardResponse{StatusCode: resp.StatusCode, Headers: resp.Header.Clone(), Body: &forwardBody{ReadCloser: resp.Body, conn: u}, Summary: safeSummary}, nil
}

type forwardBody struct {
	io.ReadCloser
	conn io.Closer
}

func (b *forwardBody) Close() error {
	bodyErr := b.ReadCloser.Close()
	connErr := b.conn.Close()
	if bodyErr != nil {
		return bodyErr
	}
	return connErr
}

func dialUTLS(ctx context.Context, req Request) (*utls.UConn, *recordingConn, error) {
	if req.Profile.Ref == "" || req.TargetHost == "" {
		return nil, nil, fmt.Errorf("missing TLS engine request authority")
	}
	dialAddr := req.TargetHost + ":443"
	if req.DialAddress != "" {
		if !req.AllowTestDialOverride {
			return nil, nil, fmt.Errorf("test dial override disabled")
		}
		dialAddr = req.DialAddress
	}
	var conn net.Conn
	var err error
	if req.DialAddress != "" {
		d := &net.Dialer{Timeout: 2 * time.Second}
		conn, err = d.DialContext(ctx, "tcp", dialAddr)
	} else if req.ProxyURL != "" {
		conn, err = dialProxyTunnel(ctx, req.ProxyURL, req.TargetHost, 443)
	} else if req.RequireProxy {
		return nil, nil, fmt.Errorf("production proxy egress required")
	} else {
		d := &net.Dialer{Timeout: 2 * time.Second}
		conn, err = d.DialContext(ctx, "tcp", dialAddr)
	}
	if err != nil {
		return nil, nil, err
	}
	rec := &recordingConn{Conn: conn}
	cfg := &utls.Config{ServerName: req.TargetHost, NextProtos: nextProtosForProfile(req.Profile)}
	if req.DialAddress != "" && req.AllowTestDialOverride {
		cfg.InsecureSkipVerify = true
	}
	u := utls.UClient(rec, cfg, utls.HelloCustom)
	if err := u.ApplyPreset(clientHelloSpecForProfile(req.Profile)); err != nil {
		_ = u.Close()
		return nil, nil, fmt.Errorf("apply TLS preset: %w", err)
	}
	if err := u.HandshakeContext(ctx); err != nil {
		_ = u.Close()
		// Existing proof-only tests intentionally use a raw ClientHello collector, so
		// keep allowing test dial overrides to capture the written ClientHello without
		// requiring a complete TLS server.
		if !(req.DialAddress != "" && req.AllowTestDialOverride) {
			return nil, nil, err
		}
	}
	return u, rec, nil
}


func dialProxyTunnel(ctx context.Context, proxyURL string, targetHost string, targetPort int) (net.Conn, error) {
	if targetHost == "" || targetPort != 443 {
		return nil, fmt.Errorf("unsafe proxy tunnel target")
	}
	parsed, err := url.Parse(proxyURL)
	if err != nil || parsed.Hostname() == "" || strings.ContainsAny(proxyURL, "\r\n") {
		return nil, fmt.Errorf("invalid proxy URL")
	}
	if strings.EqualFold(parsed.Hostname(), "api.anthropic.com") {
		return nil, fmt.Errorf("proxy URL must not be provider host")
	}
	proxyAddr := net.JoinHostPort(parsed.Hostname(), proxyPort(parsed))
	switch parsed.Scheme {
	case "http", "https":
		return dialHTTPConnectProxy(ctx, parsed, proxyAddr, targetHost, targetPort)
	case "socks5", "socks5h":
		return dialSOCKS5Proxy(ctx, parsed, proxyAddr, targetHost, targetPort)
	default:
		return nil, fmt.Errorf("unsupported proxy scheme")
	}
}

func dialHTTPConnectProxy(ctx context.Context, parsed *url.URL, proxyAddr, targetHost string, targetPort int) (net.Conn, error) {
	d := &net.Dialer{Timeout: 5 * time.Second}
	rawConn, err := d.DialContext(ctx, "tcp", proxyAddr)
	if err != nil {
		return nil, err
	}
	conn := rawConn
	if parsed.Scheme == "https" {
		tlsConn := tls.Client(rawConn, &tls.Config{ServerName: parsed.Hostname(), MinVersion: tls.VersionTLS12})
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			_ = rawConn.Close()
			return nil, err
		}
		conn = tlsConn
	}
	targetAddr := net.JoinHostPort(targetHost, strconv.Itoa(targetPort))
	var b strings.Builder
	fmt.Fprintf(&b, "CONNECT %s HTTP/1.1\r\n", targetAddr)
	fmt.Fprintf(&b, "Host: %s\r\n", targetAddr)
	b.WriteString("Proxy-Connection: Keep-Alive\r\n")
	if parsed.User != nil {
		username := parsed.User.Username()
		password, _ := parsed.User.Password()
		basic := base64.StdEncoding.EncodeToString([]byte(username + ":" + password))
		fmt.Fprintf(&b, "Proxy-Authorization: Basic %s\r\n", basic)
	}
	b.WriteString("\r\n")
	if _, err := io.WriteString(conn, b.String()); err != nil {
		_ = conn.Close()
		return nil, err
	}
	connectReq, _ := http.NewRequest(http.MethodConnect, "http://"+targetAddr, nil)
	resp, err := http.ReadResponse(bufio.NewReader(conn), connectReq)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_ = conn.Close()
		return nil, fmt.Errorf("proxy CONNECT rejected")
	}
	return conn, nil
}

func dialSOCKS5Proxy(ctx context.Context, parsed *url.URL, proxyAddr, targetHost string, targetPort int) (net.Conn, error) {
	forward := &net.Dialer{Timeout: 5 * time.Second}
	var auth *xproxy.Auth
	if parsed.User != nil {
		password, _ := parsed.User.Password()
		auth = &xproxy.Auth{User: parsed.User.Username(), Password: password}
	}
	dialer, err := xproxy.SOCKS5("tcp", proxyAddr, auth, forward)
	if err != nil {
		return nil, err
	}
	type contextDialer interface {
		DialContext(context.Context, string, string) (net.Conn, error)
	}
	targetAddr := net.JoinHostPort(targetHost, strconv.Itoa(targetPort))
	if cd, ok := dialer.(contextDialer); ok {
		return cd.DialContext(ctx, "tcp", targetAddr)
	}
	type result struct {
		conn net.Conn
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		conn, err := dialer.Dial("tcp", targetAddr)
		ch <- result{conn: conn, err: err}
	}()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case result := <-ch:
		return result.conn, result.err
	}
}

func proxyPort(parsed *url.URL) string {
	if port := parsed.Port(); port != "" {
		return port
	}
	if parsed.Scheme == "https" {
		return "443"
	}
	return "80"
}

func summarizeRecordedClientHello(req Request, rec *recordingConn) (summary.SafeSummary, error) {
	raw := rec.bytes()
	if len(raw) == 0 {
		return summary.SafeSummary{}, fmt.Errorf("ClientHello was not written")
	}
	got, err := summary.SummarizeClientHello(raw, summary.Metadata{Source: "cc_gateway_utls_sidecar", Version: req.Profile.Ref, ProfileRef: req.Profile.Ref, SummaryBucket: req.Profile.ExpectedSummaryBucket})
	if err != nil {
		return summary.SafeSummary{}, err
	}
	return got, nil
}

func nextProtosForProfile(p profile.Profile) []string {
	if p.Ref == profile.ClaudeCode2197Ref {
		return nil
	}
	return []string{"http/1.1"}
}

func clientHelloSpecForProfile(p profile.Profile) *utls.ClientHelloSpec {
	if p.Ref == profile.ClaudeCode2197Ref {
		return claudeCode2197LogicalSNISpec()
	}
	return claudeCode2179LogicalSNISpec()
}

type recordingConn struct {
	net.Conn
	mu  sync.Mutex
	buf []byte
}

func (c *recordingConn) Write(p []byte) (int, error) {
	c.mu.Lock()
	if len(c.buf) == 0 && len(p) > 0 {
		c.buf = append([]byte(nil), p...)
	}
	c.mu.Unlock()
	return c.Conn.Write(p)
}

func (c *recordingConn) bytes() []byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]byte(nil), c.buf...)
}

func claudeCode2179LogicalSNISpec() *utls.ClientHelloSpec {
	ciphers := []uint16{0x1301, 0x1302, 0x1303, 0xc02b, 0xc02f, 0xc02c, 0xc030, 0xcca9, 0xcca8, 0xc009, 0xc013, 0xc00a, 0xc014, 0x009c, 0x009d, 0x002f, 0x0035}
	sigs := []utls.SignatureScheme{0x0403, 0x0804, 0x0401, 0x0503, 0x0805, 0x0501, 0x0806, 0x0601, 0x0201}
	curves := []utls.CurveID{utls.X25519, utls.CurveP256, utls.CurveP384}
	keyShares := []utls.KeyShare{{Group: utls.X25519}}
	extensions := []utls.TLSExtension{
		&utls.SNIExtension{},
		&utls.ExtendedMasterSecretExtension{},
		&utls.RenegotiationInfoExtension{},
		&utls.SupportedCurvesExtension{Curves: curves},
		&utls.SupportedPointsExtension{SupportedPoints: []uint8{0}},
		&utls.SessionTicketExtension{},
		&utls.ALPNExtension{AlpnProtocols: []string{"http/1.1"}},
		&utls.StatusRequestExtension{},
		&utls.SignatureAlgorithmsExtension{SupportedSignatureAlgorithms: sigs},
		&utls.SCTExtension{},
		&utls.KeyShareExtension{KeyShares: keyShares},
		&utls.PSKKeyExchangeModesExtension{Modes: []uint8{uint8(utls.PskModeDHE)}},
		&utls.SupportedVersionsExtension{Versions: []uint16{utls.VersionTLS13, utls.VersionTLS12}},
		&utls.UtlsPaddingExtension{GetPaddingLen: utls.BoringPaddingStyle},
	}
	return &utls.ClientHelloSpec{CipherSuites: ciphers, CompressionMethods: []uint8{0}, Extensions: extensions, TLSVersMax: utls.VersionTLS13, TLSVersMin: utls.VersionTLS10}
}

func claudeCode2197LogicalSNISpec() *utls.ClientHelloSpec {
	ciphers := []uint16{0x1301, 0x1302, 0x1303, 0xc02b, 0xc02f, 0xc02c, 0xc030, 0xcca9, 0xcca8, 0xc009, 0xc013, 0xc00a, 0xc014, 0x009c, 0x009d, 0x002f, 0x0035}
	sigs := []utls.SignatureScheme{0x0403, 0x0804, 0x0401, 0x0503, 0x0805, 0x0501, 0x0806, 0x0601, 0x0201}
	curves := []utls.CurveID{utls.X25519, utls.CurveP256, utls.CurveP384}
	keyShares := []utls.KeyShare{{Group: utls.X25519}}
	extensions := []utls.TLSExtension{
		&utls.SNIExtension{},
		&utls.ExtendedMasterSecretExtension{},
		&utls.RenegotiationInfoExtension{},
		&utls.SupportedCurvesExtension{Curves: curves},
		&utls.SupportedPointsExtension{SupportedPoints: []uint8{0}},
		&utls.SessionTicketExtension{},
		&utls.SignatureAlgorithmsExtension{SupportedSignatureAlgorithms: sigs},
		&utls.KeyShareExtension{KeyShares: keyShares},
		&utls.PSKKeyExchangeModesExtension{Modes: []uint8{uint8(utls.PskModeDHE)}},
		&utls.SupportedVersionsExtension{Versions: []uint16{utls.VersionTLS13, utls.VersionTLS12}},
	}
	return &utls.ClientHelloSpec{CipherSuites: ciphers, CompressionMethods: []uint8{0}, Extensions: extensions, TLSVersMax: utls.VersionTLS13, TLSVersMin: utls.VersionTLS10}
}
