package main

import (
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"strings"

	"cc-gateway/egress-tls-sidecar/internal/control"
	"cc-gateway/egress-tls-sidecar/internal/profile"
	"cc-gateway/egress-tls-sidecar/internal/server"
)

type config struct {
	Listen        string
	HandlerConfig server.Config
}

func main() {
	cfg, err := buildConfigFromEnv()
	if err != nil {
		log.Fatal(err)
	}
	ln, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("egress TLS sidecar listening on %s", ln.Addr().String())
	if err := http.Serve(ln, server.NewHandler(cfg.HandlerConfig)); err != nil {
		log.Fatal(err)
	}
}

func buildConfigFromEnv() (config, error) {
	listen := strings.TrimSpace(os.Getenv("EGRESS_TLS_SIDECAR_LISTEN"))
	if listen == "" {
		listen = "127.0.0.1:0"
	}
	if !isLoopbackListen(listen) {
		return config{}, errors.New("listen address must be loopback")
	}
	token := strings.TrimSpace(os.Getenv("EGRESS_TLS_SIDECAR_CONTROL_TOKEN"))
	if len(token) < 24 {
		return config{}, errors.New("control token missing")
	}
	dialMode := strings.TrimSpace(os.Getenv("EGRESS_TLS_SIDECAR_DIAL_MODE"))
	if dialMode == "" {
		dialMode = "production"
	}
	override := strings.TrimSpace(os.Getenv("EGRESS_TLS_SIDECAR_TEST_DIAL_OVERRIDE_API_ANTHROPIC"))
	dialOverrides := map[string]string(nil)
	allowTestDialOverride := false
	switch dialMode {
	case "production":
		if override != "" {
			return config{}, errors.New("test dial override is forbidden in production mode")
		}
	case "test":
		if override == "" || !isLoopbackListen(override) {
			return config{}, errors.New("test dial override must be explicit loopback")
		}
		dialOverrides = map[string]string{"api.anthropic.com:443": override}
		allowTestDialOverride = true
	default:
		return config{}, errors.New("dial mode must be production or test")
	}
	egressBuckets := splitCSV(os.Getenv("EGRESS_TLS_SIDECAR_ALLOWED_EGRESS_BUCKETS"))
	proxyRefs := splitCSV(os.Getenv("EGRESS_TLS_SIDECAR_ALLOWED_PROXY_REFS"))
	if len(egressBuckets) == 0 || len(proxyRefs) == 0 {
		return config{}, errors.New("egress/proxy allowlists missing")
	}
	profileRefs := splitCSV(os.Getenv("EGRESS_TLS_SIDECAR_ALLOWED_PROFILE_REFS"))
	if len(profileRefs) == 0 {
		profileRefs = []string{profile.ClaudeCode2179Ref, profile.ClaudeCode2197Ref}
	}
	return config{
		Listen: listen,
		HandlerConfig: server.Config{
			Policy: control.Policy{
				ControlToken:             token,
				AllowedTargetHosts:       []string{"api.anthropic.com"},
				AllowedRoutes:            []string{"/v1/messages"},
				AllowedProfileRefs:       profileRefs,
				AllowedEgressBuckets:     egressBuckets,
				AllowedProxyIdentityRefs: proxyRefs,
			},
			DialOverrides:         dialOverrides,
			AllowTestDialOverride: allowTestDialOverride,
		},
	}, nil
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func isLoopbackListen(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}
