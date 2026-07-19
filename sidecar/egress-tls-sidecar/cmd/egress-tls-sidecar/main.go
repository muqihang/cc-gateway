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
	cfg, ln, err := openListenerFromEnvironment(os.Getenv, os.Environ(), net.Listen)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("egress TLS sidecar listening on %s", ln.Addr().String())
	if err := http.Serve(ln, server.NewHandler(cfg.HandlerConfig)); err != nil {
		log.Fatal(err)
	}
}

func buildConfigFromEnv() (config, error) {
	return buildConfigFromEnvironment(os.Getenv, os.Environ())
}

func buildConfigFromEnvironment(getenv func(string) string, environ []string) (config, error) {
	listen := strings.TrimSpace(getenv("EGRESS_TLS_SIDECAR_LISTEN"))
	if listen == "" {
		listen = "127.0.0.1:0"
	}
	if !isLoopbackListen(listen) {
		return config{}, errors.New("listen address must be loopback")
	}
	token := strings.TrimSpace(getenv("EGRESS_TLS_SIDECAR_CONTROL_TOKEN"))
	if len(token) < 24 {
		return config{}, errors.New("control token missing")
	}
	dialMode := strings.TrimSpace(getenv("EGRESS_TLS_SIDECAR_DIAL_MODE"))
	if dialMode == "" {
		dialMode = "production"
	}
	if err := validatedProductionTrustEnvironment(dialMode, environ); err != nil {
		return config{}, err
	}
	override := strings.TrimSpace(getenv("EGRESS_TLS_SIDECAR_TEST_DIAL_OVERRIDE_API_ANTHROPIC"))
	dialOverrides := map[string]string(nil)
	allowTestDialOverride := false
	requireProxyEgress := true
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
		requireProxyEgress = false
	default:
		return config{}, errors.New("dial mode must be production or test")
	}
	egressBuckets := splitCSV(getenv("EGRESS_TLS_SIDECAR_ALLOWED_EGRESS_BUCKETS"))
	proxyRefs := splitCSV(getenv("EGRESS_TLS_SIDECAR_ALLOWED_PROXY_REFS"))
	if len(egressBuckets) == 0 || len(proxyRefs) == 0 {
		return config{}, errors.New("egress/proxy allowlists missing")
	}
	proxyBindingSecret := strings.TrimSpace(getenv("EGRESS_TLS_SIDECAR_PROXY_BINDING_SECRET"))
	if requireProxyEgress {
		if weakProductionMaterial(proxyBindingSecret) {
			return config{}, errors.New("proxy binding secret missing or weak")
		}
		if proxyBindingSecret == token {
			return config{}, errors.New("proxy binding secret must be independent")
		}
	}
	profileRefs := splitCSV(getenv("EGRESS_TLS_SIDECAR_ALLOWED_PROFILE_REFS"))
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
			RequireProxyEgress:    requireProxyEgress,
			ProxyBindingSecret:    proxyBindingSecret,
		},
	}, nil
}

func validatedProductionTrustEnvironment(dialMode string, environ []string) error {
	if dialMode != "production" {
		return nil
	}
	for _, entry := range environ {
		parts := strings.SplitN(entry, "=", 2)
		key := strings.ToUpper(strings.TrimSpace(parts[0]))
		value := ""
		if len(parts) == 2 {
			value = strings.TrimSpace(parts[1])
		}
		if key == "NODE_TLS_REJECT_UNAUTHORIZED" && value == "0" {
			return errors.New("production trust environment override forbidden")
		}
		if (key == "NODE_EXTRA_CA_CERTS" || key == "SSL_CERT_FILE" || key == "SSL_CERT_DIR") && value != "" {
			return errors.New("production trust environment override forbidden")
		}
	}
	return nil
}

func openListenerFromEnvironment(
	getenv func(string) string,
	environ []string,
	listen func(network, address string) (net.Listener, error),
) (config, net.Listener, error) {
	cfg, err := buildConfigFromEnvironment(getenv, environ)
	if err != nil {
		return config{}, nil, err
	}
	ln, err := listen("tcp", cfg.Listen)
	if err != nil {
		return config{}, nil, err
	}
	return cfg, ln, nil
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

func weakProductionMaterial(value string) bool {
	if len(value) < 32 {
		return true
	}
	lower := strings.ToLower(value)
	for _, marker := range []string{"change-me", "change_me", "placeholder", "example", "sample", "dummy", "test"} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}
