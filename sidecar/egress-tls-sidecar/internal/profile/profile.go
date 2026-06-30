package profile

import (
	"fmt"
	"regexp"

	"cc-gateway/egress-tls-sidecar/internal/summary"
)

type Profile struct {
	Ref                   string
	ExpectedSummaryBucket string
	Expected              summary.SafeSummary
	RequireLogicalSNI     bool
}

const ClaudeCode2179Ref = "tls-profile:claude-code-2.1.179-real-oracle-tcp-v1"
const ClaudeCode2179Bucket = "tls-bucket:claude-code-real-oracle-2179"

var rawTLSMaterialMarker = regexp.MustCompile(`(?i)(raw[_-]?client[_-]?hello|clienthello|cipher|extension|ja3[_-]?raw|private[_-]?key|certificate|cert[_-]?pem|pcap|BEGIN .*(PRIVATE KEY|CERTIFICATE))`)

func Lookup(ref string) (Profile, bool) {
	if ref != ClaudeCode2179Ref {
		return Profile{}, false
	}
	return Profile{Ref: ref, ExpectedSummaryBucket: ClaudeCode2179Bucket, Expected: summary.ExpectedClaudeCode2179(), RequireLogicalSNI: true}, true
}

func RejectRawTLSRuntimeConfig(values map[string]string) error {
	for key, value := range values {
		if rawTLSMaterialMarker.MatchString(key) || rawTLSMaterialMarker.MatchString(value) {
			return fmt.Errorf("raw TLS material is not allowed in runtime profile config")
		}
	}
	return nil
}
