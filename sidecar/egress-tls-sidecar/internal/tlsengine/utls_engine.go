package tlsengine

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"cc-gateway/egress-tls-sidecar/internal/profile"
	"cc-gateway/egress-tls-sidecar/internal/summary"
	utls "github.com/refraction-networking/utls"
)

type Request struct {
	Profile               profile.Profile
	TargetHost            string
	DialAddress           string
	AllowTestDialOverride bool
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
	Body       []byte
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
	defer u.Close()
	safeSummary, err := summarizeRecordedClientHello(req.Request, rec)
	if err != nil {
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
		return ForwardResponse{}, err
	}
	outReq.Header = h
	outReq.Host = req.TargetHost
	outReq.ContentLength = int64(len(req.Body))
	if err := outReq.Write(u); err != nil {
		return ForwardResponse{}, fmt.Errorf("write upstream request: %w", err)
	}
	br := bufio.NewReader(u)
	resp, err := http.ReadResponse(br, outReq)
	if err != nil {
		return ForwardResponse{}, fmt.Errorf("read upstream response: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return ForwardResponse{}, fmt.Errorf("read upstream response body: %w", err)
	}
	return ForwardResponse{StatusCode: resp.StatusCode, Headers: resp.Header.Clone(), Body: body, Summary: safeSummary}, nil
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
	d := &net.Dialer{Timeout: 2 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", dialAddr)
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
