package server

import (
	"context"
	"encoding/json"
	"net/http"
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
}

type CapturedSummary = summary.SafeSummary

type Handler struct {
	cfg Config
}

func NewHandler(cfg Config) http.Handler {
	return &Handler{cfg: cfg}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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
	dialAddr := ""
	if h.cfg.DialOverrides != nil {
		dialAddr = h.cfg.DialOverrides[ctrl.TargetHost+":443"]
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	got, err := tlsengine.SendClientHelloSummary(ctx, tlsengine.Request{Profile: p, TargetHost: ctrl.TargetHost, DialAddress: dialAddr, AllowTestDialOverride: h.cfg.AllowTestDialOverride})
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
}

func SummarizeCapturedClientHello(_ context.Context, data []byte) (CapturedSummary, error) {
	p, _ := profile.Lookup(profile.ClaudeCode2179Ref)
	return summary.SummarizeClientHello(data, summary.Metadata{Source: "cc_gateway_utls_sidecar", Version: p.Ref, ProfileRef: p.Ref, SummaryBucket: p.ExpectedSummaryBucket})
}
