package main

import "testing"

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
