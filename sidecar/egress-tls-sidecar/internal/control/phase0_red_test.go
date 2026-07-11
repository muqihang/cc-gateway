//go:build phase0red

package control

import (
	"strings"
	"testing"
)

func TestPhase0B5ControlRequiresCompleteV2Envelope(t *testing.T) {
	ctrl, err := Validate(safePolicy().ControlToken, []byte(phase0CompleteControlJSON()), safePolicy())
	if err != nil {
		t.Fatalf("complete v2 control must be understood before authentication: %v", err)
	}
	if ctrl.ProfileRef == "" {
		t.Fatal("complete v2 control lost the profile ref")
	}
}

func TestPhase0B5ControlRejectsLegacyIncompleteControl(t *testing.T) {
	if _, err := Validate(safePolicy().ControlToken, []byte(phase0LegacyControlJSON()), safePolicy()); err == nil {
		t.Fatal("legacy control without nonce, freshness, final hashes, and envelope metadata was accepted")
	}
}

func TestPhase0B5ControlRejectsDuplicateKeysAcrossCompleteEnvelope(t *testing.T) {
	raw := strings.Replace(phase0CompleteControlJSON(), `"nonce":"nonce-ref-phase0-0001"`, `"nonce":"nonce-ref-phase0-0002","nonce":"nonce-ref-phase0-0001"`, 1)
	if _, err := Validate(safePolicy().ControlToken, []byte(raw), safePolicy()); err == nil {
		t.Fatal("duplicate nonce was accepted")
	}
}

func TestPhase0B5ControlAcceptsKeyOrderAndUnicodeOnlyAfterBinaryEnvelopeValidation(t *testing.T) {
	reordered := `{"method":"POST","route":"/v1/messages","target_path":"/v1/messages","target_scheme":"https","target_port":443,"target_host":"api.anthropic.com","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","egress_bucket":"bucket-a","profile_ref":"tls-profile:claude-code-\u0032.1.179-real-oracle-tcp-v1","expected_tls_summary_bucket":"tls-bucket:claude-code-real-oracle-2179","nonce":"nonce-ref-phase0-0001","timestamp_ms":1783796400000,"final_headers_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","request_body_hash":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","envelope_version":2,"key_epoch":11,"attempt_id":"attempt-ref-phase0-0001","absolute_deadline_ms":1783796460000,"content_length":17,"content_encoding":"identity","expected_response_policy_ref":"response-policy:anthropic-v1"}`
	if _, err := Validate(safePolicy().ControlToken, []byte(reordered), safePolicy()); err != nil {
		t.Fatalf("semantic key order and Unicode representation must be handled by the binary envelope, not rejected by JSON shape: %v", err)
	}
}

func phase0LegacyControlJSON() string {
	return `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST","expected_tls_summary_bucket":"tls-bucket:claude-code-real-oracle-2179"}`
}

func phase0CompleteControlJSON() string {
	return `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST","expected_tls_summary_bucket":"tls-bucket:claude-code-real-oracle-2179","nonce":"nonce-ref-phase0-0001","timestamp_ms":1783796400000,"final_headers_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","request_body_hash":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","envelope_version":2,"key_epoch":11,"attempt_id":"attempt-ref-phase0-0001","absolute_deadline_ms":1783796460000,"content_length":17,"content_encoding":"identity","expected_response_policy_ref":"response-policy:anthropic-v1"}`
}
