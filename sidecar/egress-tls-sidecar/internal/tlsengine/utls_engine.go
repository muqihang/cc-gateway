package tlsengine

import (
	"context"
	"fmt"
	"net"
	"time"

	"cc-gateway/egress-tls-sidecar/internal/profile"
	utls "github.com/refraction-networking/utls"
)

type Request struct {
	Profile               profile.Profile
	TargetHost            string
	DialAddress           string
	AllowTestDialOverride bool
}

func SendClientHello(ctx context.Context, req Request) error {
	if req.Profile.Ref == "" || req.TargetHost == "" {
		return fmt.Errorf("missing TLS engine request authority")
	}
	dialAddr := req.TargetHost + ":443"
	if req.DialAddress != "" {
		if !req.AllowTestDialOverride {
			return fmt.Errorf("test dial override disabled")
		}
		dialAddr = req.DialAddress
	}
	d := &net.Dialer{Timeout: 2 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", dialAddr)
	if err != nil {
		return err
	}
	defer conn.Close()
	u := utls.UClient(conn, &utls.Config{ServerName: req.TargetHost, NextProtos: []string{"http/1.1"}}, utls.HelloCustom)
	if err := u.ApplyPreset(claudeCode2179LogicalSNISpec()); err != nil {
		return fmt.Errorf("apply TLS preset: %w", err)
	}
	return u.HandshakeContext(ctx)
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
