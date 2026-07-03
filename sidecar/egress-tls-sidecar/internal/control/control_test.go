package control

import "testing"

func TestValidateAcceptsSafeControl(t *testing.T) {
	policy := Policy{
		ControlToken:             "sidecar-control-material-v1-local-safe-fixture-123456",
		AllowedTargetHosts:       []string{"api.anthropic.com"},
		AllowedRoutes:            []string{"/v1/messages"},
		AllowedProfileRefs:       []string{"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1"},
		AllowedEgressBuckets:     []string{"bucket-a"},
		AllowedProxyIdentityRefs: []string{"opaque:proxy-ref:v1:bucket-a"},
	}
	ctrl, err := Validate("sidecar-control-material-v1-local-safe-fixture-123456", []byte(`{
		"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1",
		"egress_bucket":"bucket-a",
		"proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a",
		"target_host":"api.anthropic.com",
		"target_port":443,
		"target_scheme":"https",
		"target_path":"/v1/messages",
		"route":"/v1/messages",
		"method":"POST",
		"expected_tls_summary_bucket":"tls-bucket:claude-code-real-oracle-2179"
	}`), policy)
	if err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	if ctrl.TargetHost != "api.anthropic.com" || ctrl.TargetScheme != "https" || ctrl.TargetPort != 443 {
		t.Fatalf("unexpected target authority: %+v", ctrl)
	}
}

func TestValidateRejectsUnsafeControl(t *testing.T) {
	policy := Policy{
		ControlToken:             "sidecar-control-material-v1-local-safe-fixture-123456",
		AllowedTargetHosts:       []string{"api.anthropic.com"},
		AllowedRoutes:            []string{"/v1/messages"},
		AllowedProfileRefs:       []string{"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1"},
		AllowedEgressBuckets:     []string{"bucket-a"},
		AllowedProxyIdentityRefs: []string{"opaque:proxy-ref:v1:bucket-a"},
	}
	cases := map[string]struct {
		token string
		json  string
	}{
		"missing token":        {"", `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST"}`},
		"wrong token":          {"wrong-token", `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST"}`},
		"missing summary":      {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST"}`},
		"extra authorization":  {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST","authorization":"forbidden"}`},
		"raw tls marker":       {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST","clienthello":"forbidden"}`},
		"unknown profile":      {policy.ControlToken, `{"profile_ref":"tls-profile:unknown","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST"}`},
		"connect method":       {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"CONNECT"}`},
		"http scheme":          {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"http","target_path":"/v1/messages","route":"/v1/messages","method":"POST"}`},
		"non allowlisted host": {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"example.invalid","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST","expected_tls_summary_bucket":"tls-bucket:claude-code-real-oracle-2179"}`},
		"non 443 port":         {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":8443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST"}`},
		"absolute form url":    {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"https://api.anthropic.com/v1/messages","route":"https://api.anthropic.com/v1/messages","method":"POST"}`},
		"path traversal":       {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/%2e%2e/messages","route":"/v1/messages","method":"POST"}`},
		"host header":          {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST","Host":"evil.invalid"}`},
		"authority header":     {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST",":authority":"evil.invalid"}`},
		"proxy authorization":  {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST","Proxy-Authorization":"omitted_by_policy"}`},
		"x-forwarded":          {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST","X-Forwarded-For":"127.0.0.1"}`},
		"sni override":         {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST","sni":"evil.invalid"}`},
		"server name override": {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST","server_name":"evil.invalid"}`},
		"alpn override":        {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST","alpn":"h2"}`},
		"dial override":        {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST","dial_override":"127.0.0.1:1"}`},
		"proxy url":            {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST","proxy_url":"http://127.0.0.1:1"}`},
		"route mismatch":       {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/other","method":"POST"}`},
		"trailing unsafe data": {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST"}{"authorization":"forbidden"}`},
		"proxy credential":     {policy.ControlToken, `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST","proxy_password":"forbidden"}`},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := Validate(tc.token, []byte(tc.json), policy); err == nil {
				t.Fatalf("Validate() expected error")
			}
		})
	}
}

func TestValidateRejectsInvalidTrailingDataAfterSafeObject(t *testing.T) {
	policy := safePolicy()
	valid := `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST"}`
	for name, raw := range map[string]string{
		"closing bracket": valid + `]`,
		"unsafe suffix":   valid + `]clienthello-marker`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := Validate(policy.ControlToken, []byte(raw), policy); err == nil {
				t.Fatalf("Validate() expected trailing data error")
			}
		})
	}
}

func TestValidateRejectsDuplicateControlKeysBeforeMapOverwrite(t *testing.T) {
	policy := safePolicy()
	raw := `{"profile_ref":"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1","egress_bucket":"bucket-a","proxy_identity_ref":"opaque:proxy-ref:v1:bucket-a","target_host":"clienthello-marker","target_host":"api.anthropic.com","target_port":443,"target_scheme":"https","target_path":"/v1/messages","route":"/v1/messages","method":"POST"}`
	if _, err := Validate(policy.ControlToken, []byte(raw), policy); err == nil {
		t.Fatalf("Validate() expected duplicate key error")
	}
}

func safePolicy() Policy {
	return Policy{
		ControlToken:             "sidecar-control-material-v1-local-safe-fixture-123456",
		AllowedTargetHosts:       []string{"api.anthropic.com"},
		AllowedRoutes:            []string{"/v1/messages"},
		AllowedProfileRefs:       []string{"tls-profile:claude-code-2.1.179-real-oracle-tcp-v1"},
		AllowedEgressBuckets:     []string{"bucket-a"},
		AllowedProxyIdentityRefs: []string{"opaque:proxy-ref:v1:bucket-a"},
	}
}
