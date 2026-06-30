package control

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strings"
)

type Policy struct {
	ControlToken             string
	AllowedTargetHosts       []string
	AllowedRoutes            []string
	AllowedProfileRefs       []string
	AllowedEgressBuckets     []string
	AllowedProxyIdentityRefs []string
	AllowTestNon443          bool
}

type Control struct {
	ProfileRef               string `json:"profile_ref"`
	EgressBucket             string `json:"egress_bucket"`
	ProxyIdentityRef         string `json:"proxy_identity_ref"`
	TargetHost               string `json:"target_host"`
	TargetPort               int    `json:"target_port"`
	TargetScheme             string `json:"target_scheme"`
	TargetPath               string `json:"target_path"`
	Route                    string `json:"route"`
	Method                   string `json:"method"`
	ExpectedTLSSummaryBucket string `json:"expected_tls_summary_bucket,omitempty"`
}

var safeRefRE = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,160}$`)
var safeTLSProfileRE = regexp.MustCompile(`^tls-profile:[A-Za-z0-9._:-]{1,140}$`)
var forbiddenKeyRE = regexp.MustCompile(`(?i)(authorization|x-api-key|cookie|raw[_-]?body|clienthello|cipher|extension|proxy[_-]?url|proxy[_-]?username|proxy[_-]?password|proxy-authorization|x-forwarded|dial[_-]?host|dial[_-]?override|tls[_-]?server[_-]?name|server[_-]?name|sni|alpn|account[_-]?uuid)`)
var forbiddenValueRE = regexp.MustCompile(`(?i)(bearer\s+|basic\s+|sk-|clienthello|BEGIN .*PRIVATE KEY|-----BEGIN CERTIFICATE-----|pcap)`)

var allowedKeys = map[string]struct{}{
	"profile_ref": {}, "egress_bucket": {}, "proxy_identity_ref": {}, "target_host": {},
	"target_port": {}, "target_scheme": {}, "target_path": {}, "route": {}, "method": {},
	"expected_tls_summary_bucket": {},
}

func Validate(token string, raw []byte, policy Policy) (Control, error) {
	if policy.ControlToken == "" || token == "" || subtle.ConstantTimeCompare([]byte(token), []byte(policy.ControlToken)) != 1 {
		return Control{}, errors.New("unauthenticated")
	}
	obj, err := decodeControlObject(raw)
	if err != nil {
		return Control{}, err
	}
	if len(obj) == 0 {
		return Control{}, errors.New("empty control")
	}
	for key, rawValue := range obj {
		if _, ok := allowedKeys[key]; !ok || forbiddenKeyRE.MatchString(key) {
			return Control{}, fmt.Errorf("forbidden control key %q", key)
		}
		var s string
		if err := json.Unmarshal(rawValue, &s); err == nil && forbiddenValueRE.MatchString(s) {
			return Control{}, fmt.Errorf("forbidden control value at %q", key)
		}
	}
	var ctrl Control
	if err := unmarshalStrictSingleObject(raw, &ctrl); err != nil {
		return Control{}, err
	}
	if !safeTLSProfileRE.MatchString(ctrl.ProfileRef) || !contains(policy.AllowedProfileRefs, ctrl.ProfileRef) {
		return Control{}, errors.New("profile not allowed")
	}
	if !safeRef(ctrl.EgressBucket) || !contains(policy.AllowedEgressBuckets, ctrl.EgressBucket) {
		return Control{}, errors.New("egress bucket not allowed")
	}
	if !safeRef(ctrl.ProxyIdentityRef) || !contains(policy.AllowedProxyIdentityRefs, ctrl.ProxyIdentityRef) {
		return Control{}, errors.New("proxy identity not allowed")
	}
	if !contains(policy.AllowedTargetHosts, ctrl.TargetHost) || strings.ContainsAny(ctrl.TargetHost, "\r\n/") {
		return Control{}, errors.New("target host not allowed")
	}
	if ctrl.TargetScheme != "https" {
		return Control{}, errors.New("target scheme not allowed")
	}
	if ctrl.TargetPort != 443 && !policy.AllowTestNon443 {
		return Control{}, errors.New("target port not allowed")
	}
	if ctrl.Method != "POST" {
		return Control{}, errors.New("method not allowed")
	}
	if ctrl.TargetPath != ctrl.Route || !contains(policy.AllowedRoutes, ctrl.TargetPath) {
		return Control{}, errors.New("route not allowed")
	}
	if !safePath(ctrl.TargetPath) {
		return Control{}, errors.New("target path not allowed")
	}
	if ctrl.ExpectedTLSSummaryBucket == "" || !safeRef(ctrl.ExpectedTLSSummaryBucket) {
		return Control{}, errors.New("summary bucket unsafe")
	}
	return ctrl, nil
}

func decodeControlObject(raw []byte) (map[string]json.RawMessage, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	tok, err := dec.Token()
	if err != nil {
		return nil, fmt.Errorf("decode control: %w", err)
	}
	delim, ok := tok.(json.Delim)
	if !ok || delim != '{' {
		return nil, errors.New("control must be a JSON object")
	}
	obj := make(map[string]json.RawMessage)
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return nil, fmt.Errorf("decode control key: %w", err)
		}
		key, ok := tok.(string)
		if !ok {
			return nil, errors.New("control key must be a string")
		}
		if _, exists := obj[key]; exists {
			return nil, fmt.Errorf("duplicate control key %q", key)
		}
		var value json.RawMessage
		if err := dec.Decode(&value); err != nil {
			return nil, fmt.Errorf("decode control value: %w", err)
		}
		obj[key] = value
	}
	tok, err = dec.Token()
	if err != nil {
		return nil, fmt.Errorf("decode control: %w", err)
	}
	if delim, ok := tok.(json.Delim); !ok || delim != '}' {
		return nil, errors.New("control object not closed")
	}
	var trailing json.RawMessage
	if err := dec.Decode(&trailing); err != io.EOF {
		return nil, errors.New("trailing control data")
	}
	return obj, nil
}

func unmarshalStrictSingleObject(raw []byte, target any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(target); err != nil {
		return fmt.Errorf("decode control: %w", err)
	}
	var trailing json.RawMessage
	if err := dec.Decode(&trailing); err != io.EOF {
		return errors.New("trailing control data")
	}
	return nil
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

func safeRef(value string) bool {
	return safeRefRE.MatchString(value) && !strings.ContainsAny(value, "\r\n") && !forbiddenValueRE.MatchString(value)
}

func safePath(value string) bool {
	if value == "" || !strings.HasPrefix(value, "/") || strings.ContainsAny(value, "\r\n") || strings.Contains(value, "//") {
		return false
	}
	decoded, err := url.PathUnescape(value)
	if err != nil {
		return false
	}
	if strings.Contains(decoded, "..") || strings.ContainsAny(decoded, "\\") {
		return false
	}
	return true
}
