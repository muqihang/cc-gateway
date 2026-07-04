package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"cc-gateway/egress-tls-sidecar/internal/control"
	"cc-gateway/egress-tls-sidecar/internal/profile"
	"cc-gateway/egress-tls-sidecar/internal/summary"
	"cc-gateway/egress-tls-sidecar/internal/tlsengine"
)

type Config struct {
	Policy                control.Policy
	DialOverrides         map[string]string
	AllowTestDialOverride bool
	ForwardTimeout        time.Duration
}

type CapturedSummary = summary.SafeSummary

type Handler struct {
	cfg Config
}

func NewHandler(cfg Config) http.Handler {
	return &Handler{cfg: cfg}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet && r.URL.Path == "/_health" {
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}
	rawControl := []byte(r.Header.Get("x-cc-egress-control"))
	ctrl, err := control.Validate(r.Header.Get("x-cc-egress-sidecar-token"), rawControl, h.cfg.Policy)
	if err != nil {
		http.Error(w, "control_rejected", http.StatusForbidden)
		return
	}
	p, ok := profile.Lookup(ctrl.ProfileRef)
	if !ok || p.ExpectedSummaryBucket != ctrl.ExpectedTLSSummaryBucket {
		http.Error(w, "profile_rejected", http.StatusForbidden)
		return
	}
	rawForwardHeaders := r.Header.Get("x-cc-egress-upstream-headers")
	dialAddr := ""
	if h.cfg.DialOverrides != nil {
		dialAddr = h.cfg.DialOverrides[ctrl.TargetHost+":443"]
	}
	timeout := h.cfg.ForwardTimeout
	if timeout <= 0 {
		timeout = 10 * time.Minute
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	baseReq := tlsengine.Request{Profile: p, TargetHost: ctrl.TargetHost, DialAddress: dialAddr, AllowTestDialOverride: h.cfg.AllowTestDialOverride}
	if rawForwardHeaders == "" {
		got, err := tlsengine.SendClientHelloSummary(ctx, baseReq)
		if err != nil {
			http.Error(w, "tls_clienthello_failed", http.StatusBadGateway)
			return
		}
		if cmp := summary.CompareToExpected(got, p.Expected); cmp.Status != "MATCH" {
			http.Error(w, "tls_summary_mismatch", http.StatusBadGateway)
			return
		}
		w.Header().Set("content-type", "application/json")
		w.Header().Set("x-cc-egress-tls-summary-bucket", p.ExpectedSummaryBucket)
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
		return
	}
	headers, err := decodeForwardHeaders(rawForwardHeaders)
	if err != nil {
		http.Error(w, "headers_rejected", http.StatusForbidden)
		return
	}
	body, err := readRequestBodyLimited(r, maxForwardRequestBodyBytes)
	if err != nil {
		http.Error(w, "request_body_rejected", http.StatusRequestEntityTooLarge)
		return
	}
	forwarded, err := tlsengine.ForwardHTTP(ctx, tlsengine.ForwardRequest{
		Request: baseReq,
		Method:  ctrl.Method,
		Path:    ctrl.TargetPath,
		Headers: headers,
		Body:    body,
	})
	if err != nil {
		http.Error(w, "upstream_forward_failed", http.StatusBadGateway)
		return
	}
	defer forwarded.Body.Close()
	if cmp := summary.CompareToExpected(forwarded.Summary, p.Expected); cmp.Status != "MATCH" {
		http.Error(w, "tls_summary_mismatch", http.StatusBadGateway)
		return
	}
	copyForwardHeaders(w.Header(), forwarded.Headers)
	w.Header().Set("x-cc-egress-tls-summary-bucket", p.ExpectedSummaryBucket)
	w.WriteHeader(forwarded.StatusCode)
	_, _ = io.Copy(flushingWriter{ResponseWriter: w}, forwarded.Body)
}

type flushingWriter struct {
	http.ResponseWriter
}

func (w flushingWriter) Write(data []byte) (int, error) {
	n, err := w.ResponseWriter.Write(data)
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
	return n, err
}

func SummarizeCapturedClientHello(_ context.Context, data []byte) (CapturedSummary, error) {
	p, _ := profile.Lookup(profile.ClaudeCode2179Ref)
	return summary.SummarizeClientHello(data, summary.Metadata{Source: "cc_gateway_utls_sidecar", Version: p.Ref, ProfileRef: p.Ref, SummaryBucket: p.ExpectedSummaryBucket})
}

var headerNameRE = regexp.MustCompile(`^[!#$%&'*+.^_` + "`" + `|~0-9A-Za-z-]{1,128}$`)

func decodeForwardHeaders(encoded string) (http.Header, error) {
	if encoded == "" || len(encoded) > 32768 {
		return nil, fmt.Errorf("missing or oversized upstream headers")
	}
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return nil, err
	}
	var input map[string]string
	if err := json.Unmarshal(raw, &input); err != nil {
		return nil, err
	}
	out := make(http.Header)
	for name, value := range input {
		canonical := http.CanonicalHeaderKey(strings.TrimSpace(name))
		lower := strings.ToLower(canonical)
		if !headerNameRE.MatchString(canonical) || forbiddenForwardHeader(lower) {
			continue
		}
		if strings.ContainsAny(value, "\r\n") || len(value) > 8192 {
			return nil, fmt.Errorf("unsafe header value")
		}
		out.Set(canonical, value)
	}
	return out, nil
}

func forbiddenForwardHeader(lower string) bool {
	if lower == "host" || lower == "content-length" || lower == "connection" || lower == "proxy-connection" || lower == "keep-alive" || lower == "transfer-encoding" || lower == "upgrade" || lower == "proxy-authorization" || lower == "cookie" {
		return true
	}
	return strings.HasPrefix(lower, "x-forwarded-")
}

func copyForwardHeaders(dst, src http.Header) {
	for name, values := range src {
		lower := strings.ToLower(name)
		if forbiddenForwardHeader(lower) {
			continue
		}
		for _, value := range values {
			if !strings.ContainsAny(value, "\r\n") {
				dst.Add(name, value)
			}
		}
	}
}

const maxForwardRequestBodyBytes int64 = 128 << 20

func readRequestBodyLimited(r *http.Request, limit int64) ([]byte, error) {
	defer r.Body.Close()
	if limit <= 0 {
		return nil, fmt.Errorf("invalid sidecar forward limit")
	}
	limited := io.LimitReader(r.Body, limit+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("request body exceeds sidecar forward limit")
	}
	return data, nil
}
