package profile

import "testing"

func TestLookupAcceptsClaudeCodeOracleProfile(t *testing.T) {
	p, ok := Lookup("tls-profile:claude-code-2.1.179-real-oracle-tcp-v1")
	if !ok {
		t.Fatalf("Lookup() did not accept oracle profile ref")
	}
	if p.Ref != "tls-profile:claude-code-2.1.179-real-oracle-tcp-v1" {
		t.Fatalf("unexpected ref %q", p.Ref)
	}
	if p.ExpectedSummaryBucket != "tls-bucket:claude-code-real-oracle-2179" {
		t.Fatalf("unexpected summary bucket %q", p.ExpectedSummaryBucket)
	}
	if p.Expected.JA3Hash != "d871d02cecbde59abbf8f4806134addf" {
		t.Fatalf("unexpected expected JA3 %q", p.Expected.JA3Hash)
	}
	if p.Expected.JA4 != "t13d0017h1_18560269b2cb_92d925a272a4" {
		t.Fatalf("unexpected expected JA4 %q", p.Expected.JA4)
	}
	if p.Expected.ExtensionCount != 14 {
		t.Fatalf("unexpected expected extension count %d", p.Expected.ExtensionCount)
	}
	if !p.Expected.SNIPresent || p.Expected.SNIHostBucket != "anthropic_api" {
		t.Fatalf("expected profile must require api.anthropic.com SNI bucket: %+v", p.Expected)
	}
	if !p.RequireLogicalSNI {
		t.Fatalf("profile must require logical provider SNI for formal-pool egress")
	}
}

func TestLookupRejectsUnknownProfilesAndRawMaterialMarkers(t *testing.T) {
	if _, ok := Lookup("tls-profile:unknown"); ok {
		t.Fatalf("unknown profile ref accepted")
	}
	for name, cfg := range map[string]map[string]string{
		"raw clienthello": {"raw_clienthello": "omitted_by_policy"},
		"cipher suites":   {"cipher_suites": "omitted_by_policy"},
		"certificate":     {"cert_pem": "omitted_by_policy"},
		"private key":     {"private_key": "omitted_by_policy"},
	} {
		t.Run(name, func(t *testing.T) {
			if err := RejectRawTLSRuntimeConfig(cfg); err == nil {
				t.Fatalf("expected unsafe runtime config rejection")
			}
		})
	}
}
