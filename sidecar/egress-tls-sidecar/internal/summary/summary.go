package summary

import (
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

type Metadata struct {
	Source        string
	Version       string
	ProfileRef    string
	SummaryBucket string
}

type SafeSummary struct {
	Source                      string   `json:"source"`
	Version                     string   `json:"version"`
	ProfileRef                  string   `json:"profile_ref"`
	SummaryBucket               string   `json:"summary_bucket"`
	JA3Hash                     string   `json:"ja3_hash"`
	JA4                         string   `json:"ja4"`
	ALPNProtocols               []string `json:"alpn_protocols"`
	TLSVersions                 []string `json:"tls_versions"`
	CipherCount                 int      `json:"cipher_count"`
	ExtensionCount              int      `json:"extension_count"`
	GREASEPresent               bool     `json:"grease_present"`
	SNIPresent                  bool     `json:"sni_present"`
	SNIHostBucket               string   `json:"sni_host_bucket"`
	RawClientHelloOmittedReason string   `json:"raw_clienthello_omitted_reason"`
	MockTLSTrustOverride        bool     `json:"mock_tls_trust_override"`
}

type Comparison struct {
	Status           string   `json:"status"`
	DifferenceFields []string `json:"difference_fields"`
}

func ExpectedClaudeCode2179() SafeSummary {
	return SafeSummary{
		Source:                      "claude_code_cli",
		Version:                     "2.1.179",
		ProfileRef:                  "tls-profile:claude-code-2.1.179-real-oracle-tcp-v1",
		SummaryBucket:               "tls-bucket:claude-code-real-oracle-2179",
		JA3Hash:                     "d871d02cecbde59abbf8f4806134addf",
		JA4:                         "t13d0017h1_18560269b2cb_92d925a272a4",
		ALPNProtocols:               []string{"http/1.1"},
		TLSVersions:                 []string{"0x0304", "0x0303"},
		CipherCount:                 17,
		ExtensionCount:              14,
		GREASEPresent:               false,
		SNIPresent:                  true,
		SNIHostBucket:               "anthropic_api",
		RawClientHelloOmittedReason: "raw_clienthello_forbidden",
		MockTLSTrustOverride:        false,
	}
}

func CompareToExpected(observed SafeSummary, expected SafeSummary) Comparison {
	fields := []struct {
		name  string
		match bool
	}{
		{"ja3_hash", observed.JA3Hash == expected.JA3Hash},
		{"ja4", observed.JA4 == expected.JA4},
		{"alpn_protocols", equalStrings(observed.ALPNProtocols, expected.ALPNProtocols)},
		{"tls_versions", equalStrings(observed.TLSVersions, expected.TLSVersions)},
		{"cipher_count", observed.CipherCount == expected.CipherCount},
		{"extension_count", observed.ExtensionCount == expected.ExtensionCount},
		{"grease_present", observed.GREASEPresent == expected.GREASEPresent},
		{"sni_present", observed.SNIPresent == expected.SNIPresent},
		{"sni_host_bucket", observed.SNIHostBucket == expected.SNIHostBucket},
	}
	diffs := make([]string, 0)
	for _, field := range fields {
		if !field.match {
			diffs = append(diffs, field.name)
		}
	}
	if len(diffs) == 0 {
		return Comparison{Status: "MATCH", DifferenceFields: nil}
	}
	return Comparison{Status: "BLOCKED_TLS_ENGINE_MISMATCH", DifferenceFields: diffs}
}

func SummarizeClientHello(data []byte, meta Metadata) (SafeSummary, error) {
	parsed, err := parseClientHello(data)
	if err != nil {
		return SafeSummary{}, err
	}
	versions := parsed.supportedVersions
	if len(versions) == 0 {
		versions = []uint16{parsed.legacyVersion}
	}
	grease := false
	for _, list := range [][]uint16{parsed.cipherSuites, parsed.extensions, parsed.groups, versions} {
		for _, v := range list {
			if isGREASE(v) {
				grease = true
			}
		}
	}
	return SafeSummary{
		Source:                      meta.Source,
		Version:                     meta.Version,
		ProfileRef:                  meta.ProfileRef,
		SummaryBucket:               meta.SummaryBucket,
		JA3Hash:                     ja3Hash(parsed),
		JA4:                         safeJA4(parsed),
		ALPNProtocols:               append([]string(nil), parsed.alpnProtocols...),
		TLSVersions:                 safeVersions(versions),
		CipherCount:                 len(parsed.cipherSuites),
		ExtensionCount:              len(parsed.extensions),
		GREASEPresent:               grease,
		SNIPresent:                  parsed.sniPresent,
		SNIHostBucket:               parsed.sniHostBucket,
		RawClientHelloOmittedReason: "raw_clienthello_forbidden",
		MockTLSTrustOverride:        false,
	}, nil
}

type clientHello struct {
	legacyVersion     uint16
	cipherSuites      []uint16
	extensions        []uint16
	groups            []uint16
	pointFormats      []uint16
	supportedVersions []uint16
	alpnProtocols     []string
	sniPresent        bool
	sniHostBucket     string
}

func parseClientHello(data []byte) (clientHello, error) {
	if len(data) < 9 || data[0] != 0x16 {
		return clientHello{}, errors.New("not a TLS handshake record")
	}
	recordLen := int(u16(data, 3))
	if len(data) < 5+recordLen {
		return clientHello{}, errors.New("truncated TLS record")
	}
	h := data[5 : 5+recordLen]
	if len(h) < 4 || h[0] != 1 {
		return clientHello{}, errors.New("first handshake is not ClientHello")
	}
	helloLen := int(u24(h, 1))
	if len(h) < 4+helloLen {
		return clientHello{}, errors.New("truncated ClientHello")
	}
	hello := h[4 : 4+helloLen]
	p := 0
	out := clientHello{legacyVersion: u16(hello, p)}
	p += 2 + 32
	if p >= len(hello) {
		return clientHello{}, errors.New("truncated ClientHello")
	}
	sidLen := int(hello[p])
	p += 1 + sidLen
	if p+2 > len(hello) {
		return clientHello{}, errors.New("truncated ClientHello")
	}
	cipherLen := int(u16(hello, p))
	p += 2
	if p+cipherLen > len(hello) {
		return clientHello{}, errors.New("truncated ClientHello")
	}
	for i := p; i+2 <= p+cipherLen; i += 2 {
		out.cipherSuites = append(out.cipherSuites, u16(hello, i))
	}
	p += cipherLen
	if p >= len(hello) {
		return clientHello{}, errors.New("truncated ClientHello")
	}
	compLen := int(hello[p])
	p += 1 + compLen
	if p >= len(hello) {
		return out, nil
	}
	extTotalLen := int(u16(hello, p))
	p += 2
	end := p + extTotalLen
	if end > len(hello) {
		return clientHello{}, errors.New("truncated ClientHello extensions")
	}
	for p+4 <= end {
		typ := u16(hello, p)
		ln := int(u16(hello, p+2))
		p += 4
		if p+ln > end {
			return clientHello{}, errors.New("truncated ClientHello extension")
		}
		ed := hello[p : p+ln]
		p += ln
		out.extensions = append(out.extensions, typ)
		switch typ {
		case 0:
			out.sniPresent, out.sniHostBucket = sniBucket(ed)
		case 10:
			if len(ed) >= 2 {
				gl := int(u16(ed, 0))
				for i := 2; i+2 <= len(ed) && i < 2+gl; i += 2 {
					out.groups = append(out.groups, u16(ed, i))
				}
			}
		case 11:
			if len(ed) >= 1 {
				pl := int(ed[0])
				for _, b := range ed[1:min(1+pl, len(ed))] {
					out.pointFormats = append(out.pointFormats, uint16(b))
				}
			}
		case 43:
			if len(ed) >= 1 {
				vl := int(ed[0])
				for i := 1; i+2 <= len(ed) && i < 1+vl; i += 2 {
					out.supportedVersions = append(out.supportedVersions, u16(ed, i))
				}
			}
		case 16:
			if len(ed) >= 2 {
				al := int(u16(ed, 0))
				q := 2
				for q < 2+al && q < len(ed) {
					n := int(ed[q])
					q++
					if q+n > len(ed) {
						break
					}
					out.alpnProtocols = append(out.alpnProtocols, string(ed[q:q+n]))
					q += n
				}
			}
		}
	}
	return out, nil
}

func sniBucket(ed []byte) (bool, string) {
	if len(ed) < 5 {
		return false, "malformed"
	}
	listLen := int(u16(ed, 0))
	if listLen+2 > len(ed) || ed[2] != 0 {
		return false, "malformed"
	}
	nameLen := int(u16(ed, 3))
	if 5+nameLen > len(ed) {
		return false, "malformed"
	}
	name := string(ed[5 : 5+nameLen])
	if strings.EqualFold(name, "api.anthropic.com") {
		return true, "anthropic_api"
	}
	if listLen > 0 {
		return true, "other"
	}
	return false, "not_present"
}

func ja3Hash(p clientHello) string {
	ja3 := strings.Join([]string{
		fmt.Sprintf("%d", p.legacyVersion),
		joinFiltered(p.cipherSuites, "-"),
		joinFiltered(p.extensions, "-"),
		joinFiltered(p.groups, "-"),
		joinFiltered(p.pointFormats, "-"),
	}, ",")
	sum := md5.Sum([]byte(ja3))
	return hex.EncodeToString(sum[:])
}

func safeJA4(p clientHello) string {
	versions := p.supportedVersions
	if len(versions) == 0 {
		versions = []uint16{p.legacyVersion}
	}
	maxVersion := p.legacyVersion
	for _, v := range versions {
		if !isGREASE(v) && v > maxVersion {
			maxVersion = v
		}
	}
	tlsTag := "t12"
	if maxVersion >= 0x0304 {
		tlsTag = "t13"
	}
	alpn := "00"
	for _, proto := range p.alpnProtocols {
		if proto == "h2" {
			alpn = "h2"
			break
		}
		if proto == "http/1.1" {
			alpn = "h1"
		}
	}
	ch := sha256.Sum256([]byte(joinFiltered(p.cipherSuites, ",")))
	eh := sha256.Sum256([]byte(joinFiltered(p.extensions, ",")))
	return fmt.Sprintf("%sd%04d%s_%s_%s", tlsTag, len(p.cipherSuites), alpn, hex.EncodeToString(ch[:])[:12], hex.EncodeToString(eh[:])[:12])
}

func joinFiltered(values []uint16, sep string) string {
	parts := make([]string, 0, len(values))
	for _, v := range values {
		if !isGREASE(v) {
			parts = append(parts, fmt.Sprintf("%d", v))
		}
	}
	return strings.Join(parts, sep)
}

func safeVersions(values []uint16) []string {
	out := make([]string, 0, len(values))
	for _, v := range values {
		if !isGREASE(v) {
			out = append(out, fmt.Sprintf("0x%04x", v))
		}
	}
	return out
}

func isGREASE(v uint16) bool     { return v&0x0f0f == 0x0a0a && v>>8 == v&0xff }
func u16(b []byte, p int) uint16 { return uint16(b[p])<<8 | uint16(b[p+1]) }
func u24(b []byte, p int) uint32 { return uint32(b[p])<<16 | uint32(b[p+1])<<8 | uint32(b[p+2]) }
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
