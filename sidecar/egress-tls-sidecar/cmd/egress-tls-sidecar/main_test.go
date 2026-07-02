package main

import (
	"testing"

	"cc-gateway/egress-tls-sidecar/internal/profile"
)

func TestBuildConfigRequiresLoopbackListenAndTestDialOverrideIsExplicit(t *testing.T) {
	t.Setenv("EGRESS_TLS_SIDECAR_LISTEN", "127.0.0.1:0")
	t.Setenv("EGRESS_TLS_SIDECAR_CONTROL_TOKEN", "sidecar-control-material-v1-local-safe-fixture-123456")
	t.Setenv("EGRESS_TLS_SIDECAR_ALLOWED_EGRESS_BUCKETS", "bucket-a")
	t.Setenv("EGRESS_TLS_SIDECAR_ALLOWED_PROXY_REFS", "opaque:proxy-ref:v1:bucket-a")
	t.Setenv("EGRESS_TLS_SIDECAR_TEST_DIAL_OVERRIDE_API_ANTHROPIC", "127.0.0.1:12345")
	cfg, err := buildConfigFromEnv()
	if err != nil {
		t.Fatalf("buildConfigFromEnv() error = %v", err)
	}
	if cfg.Listen != "127.0.0.1:0" || cfg.HandlerConfig.DialOverrides["api.anthropic.com:443"] != "127.0.0.1:12345" {
		t.Fatalf("unexpected config: %+v", cfg)
	}
	if !cfg.HandlerConfig.AllowTestDialOverride {
		t.Fatalf("test dial override must be explicit and test-only")
	}
	if got := cfg.HandlerConfig.Policy.AllowedProfileRefs; len(got) != 2 || got[0] != profile.ClaudeCode2179Ref || got[1] != profile.ClaudeCode2197Ref {
		t.Fatalf("expected 2.1.179 and 2.1.197 default profile refs, got %#v", got)
	}
}

func TestBuildConfigAcceptsExplicitAllowedProfileRefs(t *testing.T) {
	t.Setenv("EGRESS_TLS_SIDECAR_LISTEN", "127.0.0.1:0")
	t.Setenv("EGRESS_TLS_SIDECAR_CONTROL_TOKEN", "sidecar-control-material-v1-local-safe-fixture-123456")
	t.Setenv("EGRESS_TLS_SIDECAR_ALLOWED_EGRESS_BUCKETS", "bucket-a")
	t.Setenv("EGRESS_TLS_SIDECAR_ALLOWED_PROXY_REFS", "opaque:proxy-ref:v1:bucket-a")
	t.Setenv("EGRESS_TLS_SIDECAR_TEST_DIAL_OVERRIDE_API_ANTHROPIC", "127.0.0.1:12345")
	t.Setenv("EGRESS_TLS_SIDECAR_ALLOWED_PROFILE_REFS", profile.ClaudeCode2197Ref)
	cfg, err := buildConfigFromEnv()
	if err != nil {
		t.Fatalf("buildConfigFromEnv() error = %v", err)
	}
	if got := cfg.HandlerConfig.Policy.AllowedProfileRefs; len(got) != 1 || got[0] != profile.ClaudeCode2197Ref {
		t.Fatalf("unexpected profile refs: %#v", got)
	}
}

func TestBuildConfigRejectsNonLoopbackListenAndMissingOverride(t *testing.T) {
	for name, env := range map[string]map[string]string{
		"non_loopback_listen": {"EGRESS_TLS_SIDECAR_LISTEN": "0.0.0.0:8080", "EGRESS_TLS_SIDECAR_TEST_DIAL_OVERRIDE_API_ANTHROPIC": "127.0.0.1:1"},
		"missing_override":    {"EGRESS_TLS_SIDECAR_LISTEN": "127.0.0.1:0"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("EGRESS_TLS_SIDECAR_CONTROL_TOKEN", "sidecar-control-material-v1-local-safe-fixture-123456")
			t.Setenv("EGRESS_TLS_SIDECAR_ALLOWED_EGRESS_BUCKETS", "bucket-a")
			t.Setenv("EGRESS_TLS_SIDECAR_ALLOWED_PROXY_REFS", "opaque:proxy-ref:v1:bucket-a")
			for k, v := range env {
				t.Setenv(k, v)
			}
			if _, err := buildConfigFromEnv(); err == nil {
				t.Fatalf("expected config rejection")
			}
		})
	}
}
