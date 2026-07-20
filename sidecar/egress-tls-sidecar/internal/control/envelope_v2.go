package control

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"reflect"
	"strings"

	"github.com/fxamacker/cbor/v2"
)

const oracleCBORMaxFrameBytes = 65536

type OracleCBORError struct {
	Code string
	Msg  string
}

func (e *OracleCBORError) Error() string {
	return e.Code + ": " + e.Msg
}

func oracleCBORError(code, format string, args ...any) error {
	return &OracleCBORError{Code: code, Msg: fmt.Sprintf(format, args...)}
}

func OracleCBORCode(err error) string {
	if typed, ok := err.(*OracleCBORError); ok {
		return typed.Code
	}
	return ""
}

func oracleCBOREncMode() (cbor.EncMode, error) {
	options := cbor.CoreDetEncOptions()
	options.IndefLength = cbor.IndefLengthForbidden
	options.TagsMd = cbor.TagsForbidden
	mode, err := options.EncMode()
	if err != nil {
		return nil, oracleCBORError("cbor_configuration", "%v", err)
	}
	return mode, nil
}

func oracleCBORDecMode() (cbor.DecMode, error) {
	options := cbor.DecOptions{
		DupMapKey:         cbor.DupMapKeyEnforcedAPF,
		MaxNestedLevels:   32,
		MaxArrayElements:  4096,
		MaxMapPairs:       1024,
		IndefLength:       cbor.IndefLengthForbidden,
		TagsMd:            cbor.TagsForbidden,
		IntDec:            cbor.IntDecConvertNone,
		UTF8:              cbor.UTF8RejectInvalid,
		ExtraReturnErrors: cbor.ExtraDecErrorUnknownField,
		DefaultMapType:    reflect.TypeOf(map[string]any{}),
	}
	mode, err := options.DecMode()
	if err != nil {
		return nil, oracleCBORError("cbor_configuration", "%v", err)
	}
	return mode, nil
}

func validateOracleCBORValue(value reflect.Value, location string) error {
	if !value.IsValid() {
		return nil
	}
	if value.Kind() == reflect.Interface || value.Kind() == reflect.Pointer {
		if value.IsNil() {
			return nil
		}
		return validateOracleCBORValue(value.Elem(), location)
	}
	switch value.Kind() {
	case reflect.Bool, reflect.String:
		return nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return nil
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return nil
	case reflect.Float32, reflect.Float64:
		return oracleCBORError("cbor_float_forbidden", "%s contains a float", location)
	case reflect.Slice, reflect.Array:
		if value.Type().Elem().Kind() == reflect.Uint8 {
			return nil
		}
		if value.Len() > 4096 {
			return oracleCBORError("cbor_resource_limit", "%s exceeds the array limit", location)
		}
		for i := 0; i < value.Len(); i++ {
			if err := validateOracleCBORValue(value.Index(i), fmt.Sprintf("%s[%d]", location, i)); err != nil {
				return err
			}
		}
		return nil
	case reflect.Map:
		if value.Type().Key().Kind() != reflect.String {
			return oracleCBORError("cbor_map_key_invalid", "%s has a non-text map key", location)
		}
		if value.Len() > 1024 {
			return oracleCBORError("cbor_resource_limit", "%s exceeds the map limit", location)
		}
		iterator := value.MapRange()
		for iterator.Next() {
			if err := validateOracleCBORValue(iterator.Value(), location+"."+iterator.Key().String()); err != nil {
				return err
			}
		}
		return nil
	case reflect.Struct:
		for i := 0; i < value.NumField(); i++ {
			if value.Type().Field(i).IsExported() {
				if err := validateOracleCBORValue(value.Field(i), location+"."+value.Type().Field(i).Name); err != nil {
					return err
				}
			}
		}
		return nil
	default:
		return oracleCBORError("cbor_type_invalid", "%s has unsupported kind %s", location, value.Kind())
	}
}

func oracleCBORDecodeError(err error) error {
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "duplicate map key"):
		return oracleCBORError("cbor_duplicate_key", "%v", err)
	case strings.Contains(message, "indefinite-length"):
		return oracleCBORError("cbor_indefinite_length", "%v", err)
	case strings.Contains(message, "extraneous data"):
		return oracleCBORError("cbor_trailing_data", "%v", err)
	case strings.Contains(message, "utf-8"):
		return oracleCBORError("cbor_invalid_utf8", "%v", err)
	case strings.Contains(message, "tag"):
		return oracleCBORError("cbor_tag_forbidden", "%v", err)
	default:
		return oracleCBORError("cbor_invalid", "%v", err)
	}
}

func EncodeOracleDeterministicCBOR(value any) ([]byte, error) {
	if err := validateOracleCBORValue(reflect.ValueOf(value), "$"); err != nil {
		return nil, err
	}
	mode, err := oracleCBOREncMode()
	if err != nil {
		return nil, err
	}
	encoded, err := mode.Marshal(value)
	if err != nil {
		return nil, oracleCBORError("cbor_invalid", "%v", err)
	}
	return encoded, nil
}

func DecodeOracleDeterministicCBOR(data []byte, target any) error {
	mode, err := oracleCBORDecMode()
	if err != nil {
		return err
	}
	var generic any
	if err := mode.Unmarshal(data, &generic); err != nil {
		return oracleCBORDecodeError(err)
	}
	if err := validateOracleCBORValue(reflect.ValueOf(generic), "$"); err != nil {
		return err
	}
	encoded, err := EncodeOracleDeterministicCBOR(generic)
	if err != nil {
		return err
	}
	if !bytes.Equal(encoded, data) {
		return oracleCBORError("cbor_not_deterministic", "input differs from deterministic re-encoding")
	}
	if err := mode.Unmarshal(data, target); err != nil {
		return oracleCBORDecodeError(err)
	}
	return nil
}

func FrameOracleCBOR(payload []byte) ([]byte, error) {
	if len(payload) == 0 || len(payload) > oracleCBORMaxFrameBytes {
		return nil, oracleCBORError("cbor_frame_length", "payload length is outside 1..65536")
	}
	frame := make([]byte, len(payload)+4)
	binary.BigEndian.PutUint32(frame[:4], uint32(len(payload)))
	copy(frame[4:], payload)
	return frame, nil
}

func UnframeOracleCBOR(frame []byte) ([]byte, error) {
	if len(frame) < 4 {
		return nil, oracleCBORError("cbor_frame_truncated", "frame has no complete length prefix")
	}
	length := int(binary.BigEndian.Uint32(frame[:4]))
	if length == 0 || length > oracleCBORMaxFrameBytes {
		return nil, oracleCBORError("cbor_frame_length", "frame length is outside 1..65536")
	}
	if len(frame) < length+4 {
		return nil, oracleCBORError("cbor_frame_truncated", "frame payload is truncated")
	}
	if len(frame) > length+4 {
		return nil, oracleCBORError("cbor_trailing_data", "frame contains trailing data")
	}
	return append([]byte(nil), frame[4:]...), nil
}

var OracleSidecarCapabilityDomain = []byte("oracle-sidecar-capability-v1\x00")

type OracleSidecarDestination struct {
	Host string `json:"host" cbor:"host"`
	Port int    `json:"port" cbor:"port"`
}

type OracleSidecarCapabilityUnsigned struct {
	SchemaID                    string                     `json:"schema_id" cbor:"schema_id"`
	SchemaMajor                 int                        `json:"schema_major" cbor:"schema_major"`
	SchemaRevision              int                        `json:"schema_revision" cbor:"schema_revision"`
	KeyEpoch                    int64                      `json:"key_epoch" cbor:"key_epoch"`
	CapabilityID                string                     `json:"capability_id" cbor:"capability_id"`
	AttemptID                   string                     `json:"attempt_id" cbor:"attempt_id"`
	Nonce                       string                     `json:"nonce" cbor:"nonce"`
	IssuedAtMS                  int64                      `json:"issued_at_ms" cbor:"issued_at_ms"`
	DeadlineMS                  int64                      `json:"deadline_ms" cbor:"deadline_ms"`
	Method                      string                     `json:"method" cbor:"method"`
	Authority                   string                     `json:"authority" cbor:"authority"`
	NormalizedPathQuery         string                     `json:"normalized_path_query" cbor:"normalized_path_query"`
	OrderedHeadersSHA256        string                     `json:"ordered_headers_sha256" cbor:"ordered_headers_sha256"`
	BodySHA256                  string                     `json:"body_sha256" cbor:"body_sha256"`
	ContentLength               int64                      `json:"content_length" cbor:"content_length"`
	ContentEncoding             string                     `json:"content_encoding" cbor:"content_encoding"`
	ProfileGeneration           int64                      `json:"profile_generation" cbor:"profile_generation"`
	ProxyGeneration             int64                      `json:"proxy_generation" cbor:"proxy_generation"`
	CredentialGeneration        int64                      `json:"credential_generation" cbor:"credential_generation"`
	TransportCellGeneration     int64                      `json:"transport_cell_generation" cbor:"transport_cell_generation"`
	ContractDigest              string                     `json:"contract_digest" cbor:"contract_digest"`
	ManifestDigest              string                     `json:"manifest_digest" cbor:"manifest_digest"`
	DestinationPolicyGeneration int64                      `json:"destination_policy_generation" cbor:"destination_policy_generation"`
	DestinationClass            string                     `json:"destination_class" cbor:"destination_class"`
	AllowedDestinations         []OracleSidecarDestination `json:"allowed_destinations" cbor:"allowed_destinations"`
	ResponsePolicyRef           string                     `json:"response_policy_ref" cbor:"response_policy_ref"`
	RetryOwner                  string                     `json:"retry_owner" cbor:"retry_owner"`
	KeyID                       string                     `json:"key_id" cbor:"key_id"`
	KeyRole                     string                     `json:"key_role" cbor:"key_role"`
}

type OracleSidecarCapability struct {
	OracleSidecarCapabilityUnsigned `cbor:",inline"`
	Signature                       []byte `json:"signature" cbor:"signature"`
}

type oracleSidecarCapabilityUnsignedWire struct {
	SchemaID                    string                     `cbor:"schema_id"`
	SchemaMajor                 int                        `cbor:"schema_major"`
	SchemaRevision              int                        `cbor:"schema_revision"`
	KeyEpoch                    int64                      `cbor:"key_epoch"`
	CapabilityID                string                     `cbor:"capability_id"`
	AttemptID                   string                     `cbor:"attempt_id"`
	Nonce                       string                     `cbor:"nonce"`
	IssuedAtMS                  int64                      `cbor:"issued_at_ms"`
	DeadlineMS                  int64                      `cbor:"deadline_ms"`
	Method                      string                     `cbor:"method"`
	Authority                   string                     `cbor:"authority"`
	NormalizedPathQuery         string                     `cbor:"normalized_path_query"`
	OrderedHeadersSHA256        []byte                     `cbor:"ordered_headers_sha256"`
	BodySHA256                  []byte                     `cbor:"body_sha256"`
	ContentLength               int64                      `cbor:"content_length"`
	ContentEncoding             string                     `cbor:"content_encoding"`
	ProfileGeneration           int64                      `cbor:"profile_generation"`
	ProxyGeneration             int64                      `cbor:"proxy_generation"`
	CredentialGeneration        int64                      `cbor:"credential_generation"`
	TransportCellGeneration     int64                      `cbor:"transport_cell_generation"`
	ContractDigest              []byte                     `cbor:"contract_digest"`
	ManifestDigest              []byte                     `cbor:"manifest_digest"`
	DestinationPolicyGeneration int64                      `cbor:"destination_policy_generation"`
	DestinationClass            string                     `cbor:"destination_class"`
	AllowedDestinations         []OracleSidecarDestination `cbor:"allowed_destinations"`
	ResponsePolicyRef           string                     `cbor:"response_policy_ref"`
	RetryOwner                  string                     `cbor:"retry_owner"`
	KeyID                       string                     `cbor:"key_id"`
	KeyRole                     string                     `cbor:"key_role"`
}

type oracleSidecarCapabilityWire struct {
	oracleSidecarCapabilityUnsignedWire `cbor:",inline"`
	Signature                           []byte `cbor:"signature"`
}

func oracleSidecarUnsignedToWire(value OracleSidecarCapabilityUnsigned) (oracleSidecarCapabilityUnsignedWire, error) {
	orderedHeaders, err := hex.DecodeString(value.OrderedHeadersSHA256)
	if err != nil || len(orderedHeaders) != 32 {
		return oracleSidecarCapabilityUnsignedWire{}, oracleCBORError("sidecar_capability_schema_invalid", "invalid ordered headers digest")
	}
	body, err := hex.DecodeString(value.BodySHA256)
	if err != nil || len(body) != 32 {
		return oracleSidecarCapabilityUnsignedWire{}, oracleCBORError("sidecar_capability_schema_invalid", "invalid body digest")
	}
	contract, err := hex.DecodeString(value.ContractDigest)
	if err != nil || len(contract) != 32 {
		return oracleSidecarCapabilityUnsignedWire{}, oracleCBORError("sidecar_capability_schema_invalid", "invalid contract digest")
	}
	manifest, err := hex.DecodeString(value.ManifestDigest)
	if err != nil || len(manifest) != 32 {
		return oracleSidecarCapabilityUnsignedWire{}, oracleCBORError("sidecar_capability_schema_invalid", "invalid manifest digest")
	}
	return oracleSidecarCapabilityUnsignedWire{
		value.SchemaID, value.SchemaMajor, value.SchemaRevision, value.KeyEpoch, value.CapabilityID, value.AttemptID, value.Nonce,
		value.IssuedAtMS, value.DeadlineMS, value.Method, value.Authority, value.NormalizedPathQuery, orderedHeaders, body,
		value.ContentLength, value.ContentEncoding, value.ProfileGeneration, value.ProxyGeneration, value.CredentialGeneration,
		value.TransportCellGeneration, contract, manifest, value.DestinationPolicyGeneration, value.DestinationClass,
		value.AllowedDestinations, value.ResponsePolicyRef, value.RetryOwner, value.KeyID, value.KeyRole,
	}, nil
}

func oracleSidecarWireToUnsigned(value oracleSidecarCapabilityUnsignedWire) (OracleSidecarCapabilityUnsigned, error) {
	if len(value.OrderedHeadersSHA256) != 32 || len(value.BodySHA256) != 32 || len(value.ContractDigest) != 32 || len(value.ManifestDigest) != 32 {
		return OracleSidecarCapabilityUnsigned{}, oracleCBORError("sidecar_capability_schema_invalid", "wire digests must be 32-byte byte strings")
	}
	return OracleSidecarCapabilityUnsigned{
		value.SchemaID, value.SchemaMajor, value.SchemaRevision, value.KeyEpoch, value.CapabilityID, value.AttemptID, value.Nonce,
		value.IssuedAtMS, value.DeadlineMS, value.Method, value.Authority, value.NormalizedPathQuery,
		hex.EncodeToString(value.OrderedHeadersSHA256), hex.EncodeToString(value.BodySHA256), value.ContentLength, value.ContentEncoding,
		value.ProfileGeneration, value.ProxyGeneration, value.CredentialGeneration, value.TransportCellGeneration,
		hex.EncodeToString(value.ContractDigest), hex.EncodeToString(value.ManifestDigest), value.DestinationPolicyGeneration,
		value.DestinationClass, value.AllowedDestinations, value.ResponsePolicyRef, value.RetryOwner, value.KeyID, value.KeyRole,
	}, nil
}

type OracleSidecarCapabilityKey struct {
	KeyID     string
	Role      string
	Epoch     int64
	Revoked   bool
	PublicKey ed25519.PublicKey
}

type OracleSidecarVerifyContext struct {
	Keys  map[string]OracleSidecarCapabilityKey
	NowMS int64
}

type OracleSidecarVerifyDecision struct {
	Allowed  bool
	Code     string
	Envelope *OracleSidecarCapability
}

func validOracleHexDigest(value string) bool {
	if len(value) != 64 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func validateOracleSidecarUnsigned(value OracleSidecarCapabilityUnsigned) error {
	if value.SchemaID != "oracle.sidecar.capability" || value.SchemaMajor != 1 || value.SchemaRevision != 0 || value.KeyRole != "sidecar_capability" || value.Method != "POST" {
		return oracleCBORError("sidecar_capability_schema_invalid", "invalid schema, role, or method")
	}
	if value.KeyEpoch < 1 || value.CapabilityID == "" || value.AttemptID == "" || value.Nonce == "" || value.Authority == "" || value.NormalizedPathQuery == "" || value.KeyID == "" || value.ResponsePolicyRef == "" {
		return oracleCBORError("sidecar_capability_schema_invalid", "missing required sidecar capability field")
	}
	if value.IssuedAtMS < 0 || value.DeadlineMS < 0 || value.ContentLength < 0 || value.ProfileGeneration < 0 || value.ProxyGeneration < 0 || value.CredentialGeneration < 0 || value.TransportCellGeneration < 0 || value.DestinationPolicyGeneration < 0 {
		return oracleCBORError("sidecar_capability_schema_invalid", "negative sidecar capability number")
	}
	if !validOracleHexDigest(value.OrderedHeadersSHA256) || !validOracleHexDigest(value.BodySHA256) || !validOracleHexDigest(value.ContractDigest) || !validOracleHexDigest(value.ManifestDigest) {
		return oracleCBORError("sidecar_capability_schema_invalid", "invalid sidecar capability digest")
	}
	if !contains([]string{"identity", "gzip", "br", "zstd"}, value.ContentEncoding) || !contains([]string{"public_provider", "approved_proxy"}, value.DestinationClass) || !contains([]string{"none", "cc_gateway", "sub2api"}, value.RetryOwner) {
		return oracleCBORError("sidecar_capability_schema_invalid", "invalid sidecar capability enum")
	}
	if len(value.AllowedDestinations) == 0 || len(value.AllowedDestinations) > 16 {
		return oracleCBORError("sidecar_capability_schema_invalid", "invalid destination count")
	}
	for _, destination := range value.AllowedDestinations {
		if destination.Host == "" || destination.Port < 1 || destination.Port > 65535 {
			return oracleCBORError("sidecar_capability_schema_invalid", "invalid destination")
		}
	}
	return nil
}

func OracleSidecarCapabilitySigningBytes(unsigned OracleSidecarCapabilityUnsigned) ([]byte, error) {
	if err := validateOracleSidecarUnsigned(unsigned); err != nil {
		return nil, err
	}
	wire, err := oracleSidecarUnsignedToWire(unsigned)
	if err != nil {
		return nil, err
	}
	encoded, err := EncodeOracleDeterministicCBOR(wire)
	if err != nil {
		return nil, err
	}
	result := make([]byte, 0, len(OracleSidecarCapabilityDomain)+len(encoded))
	result = append(result, OracleSidecarCapabilityDomain...)
	result = append(result, encoded...)
	return result, nil
}

func SignOracleSidecarCapability(unsigned OracleSidecarCapabilityUnsigned, keyID string, keyEpoch int64, privateKey ed25519.PrivateKey) (OracleSidecarCapability, error) {
	if unsigned.KeyID != keyID || unsigned.KeyEpoch != keyEpoch || unsigned.KeyRole != "sidecar_capability" {
		return OracleSidecarCapability{}, oracleCBORError("sidecar_key_epoch_mismatch", "signing key does not match capability binding")
	}
	bytes, err := OracleSidecarCapabilitySigningBytes(unsigned)
	if err != nil {
		return OracleSidecarCapability{}, err
	}
	return OracleSidecarCapability{OracleSidecarCapabilityUnsigned: unsigned, Signature: ed25519.Sign(privateKey, bytes)}, nil
}

func EncodeOracleSidecarCapability(value OracleSidecarCapability) ([]byte, error) {
	unsigned, err := oracleSidecarUnsignedToWire(value.OracleSidecarCapabilityUnsigned)
	if err != nil {
		return nil, err
	}
	encoded, err := EncodeOracleDeterministicCBOR(oracleSidecarCapabilityWire{unsigned, value.Signature})
	if err != nil {
		return nil, err
	}
	return FrameOracleCBOR(encoded)
}

func oracleSidecarFailure(code string) OracleSidecarVerifyDecision {
	return OracleSidecarVerifyDecision{Code: code}
}

func VerifyOracleSidecarCapability(frame []byte, context OracleSidecarVerifyContext) OracleSidecarVerifyDecision {
	payload, err := UnframeOracleCBOR(frame)
	if err != nil {
		return oracleSidecarFailure(OracleCBORCode(err))
	}
	var wire oracleSidecarCapabilityWire
	if err := DecodeOracleDeterministicCBOR(payload, &wire); err != nil {
		return oracleSidecarFailure(OracleCBORCode(err))
	}
	unsigned, err := oracleSidecarWireToUnsigned(wire.oracleSidecarCapabilityUnsignedWire)
	if err != nil {
		return oracleSidecarFailure(OracleCBORCode(err))
	}
	envelope := OracleSidecarCapability{OracleSidecarCapabilityUnsigned: unsigned, Signature: wire.Signature}
	if err := validateOracleSidecarUnsigned(envelope.OracleSidecarCapabilityUnsigned); err != nil || len(envelope.Signature) != ed25519.SignatureSize {
		return oracleSidecarFailure("sidecar_capability_schema_invalid")
	}
	if envelope.IssuedAtMS > context.NowMS || envelope.DeadlineMS < context.NowMS || envelope.DeadlineMS < envelope.IssuedAtMS {
		return oracleSidecarFailure("sidecar_capability_expired")
	}
	key, exists := context.Keys[envelope.KeyID]
	if !exists {
		return oracleSidecarFailure("sidecar_key_not_found")
	}
	if key.Role != "sidecar_capability" || envelope.KeyRole != "sidecar_capability" {
		return oracleSidecarFailure("sidecar_key_role_invalid")
	}
	if key.Epoch != envelope.KeyEpoch {
		return oracleSidecarFailure("sidecar_key_epoch_mismatch")
	}
	if key.Revoked {
		return oracleSidecarFailure("sidecar_key_revoked")
	}
	for _, candidate := range context.Keys {
		if candidate.KeyID != key.KeyID && candidate.Role != "sidecar_capability" && bytes.Equal(candidate.PublicKey, key.PublicKey) {
			return oracleSidecarFailure("sidecar_key_role_reuse")
		}
	}
	signingBytes, err := OracleSidecarCapabilitySigningBytes(envelope.OracleSidecarCapabilityUnsigned)
	if err != nil || !ed25519.Verify(key.PublicKey, signingBytes, envelope.Signature) {
		return oracleSidecarFailure("sidecar_signature_invalid")
	}
	return OracleSidecarVerifyDecision{Allowed: true, Code: "sidecar_capability_allow", Envelope: &envelope}
}

type OracleReplayEntry struct {
	State       string `json:"state" cbor:"state"`
	ExpiresAtMS int64  `json:"expires_at_ms" cbor:"expires_at_ms"`
}

type OracleReplayState struct {
	LedgerGeneration int64                        `json:"ledger_generation" cbor:"ledger_generation"`
	Entries          map[string]OracleReplayEntry `json:"entries" cbor:"entries"`
}

type OracleReplayCommand struct {
	Operation          string
	ExpectedGeneration int64
	NowMS              int64
	ExpiresAtMS        int64
	KeyEpoch           int64
	CapabilityID       string
	AttemptID          string
	Nonce              string
}

type OracleReplayDecision struct {
	Allowed         bool
	Code            string
	NextState       *OracleReplayState
	NextStateDigest string
}

func oracleReplayIdentity(command OracleReplayCommand) string {
	identity := struct {
		AttemptID    string `cbor:"attempt_id"`
		CapabilityID string `cbor:"capability_id"`
		KeyEpoch     int64  `cbor:"key_epoch"`
		Nonce        string `cbor:"nonce"`
	}{command.AttemptID, command.CapabilityID, command.KeyEpoch, command.Nonce}
	encoded, _ := EncodeOracleDeterministicCBOR(identity)
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}

func OracleReplayStateDigest(state OracleReplayState) string {
	encoded, _ := EncodeOracleDeterministicCBOR(state)
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}

func TransitionOracleReplayState(state OracleReplayState, command OracleReplayCommand) OracleReplayDecision {
	if command.ExpectedGeneration != state.LedgerGeneration {
		return OracleReplayDecision{Code: "replay_replica_conflict"}
	}
	identity := oracleReplayIdentity(command)
	current, exists := state.Entries[identity]
	var nextEntry OracleReplayEntry
	switch command.Operation {
	case "reserve":
		if exists || command.ExpiresAtMS <= command.NowMS {
			return OracleReplayDecision{Code: "replay_rejected"}
		}
		nextEntry = OracleReplayEntry{State: "reserved", ExpiresAtMS: command.ExpiresAtMS}
	case "commit":
		if !exists || current.State != "reserved" || current.ExpiresAtMS <= command.NowMS {
			return OracleReplayDecision{Code: "replay_rejected"}
		}
		nextEntry = current
		nextEntry.State = "committed"
	case "expire":
		if !exists || current.State != "reserved" || current.ExpiresAtMS > command.NowMS {
			return OracleReplayDecision{Code: "replay_rejected"}
		}
		nextEntry = current
		nextEntry.State = "expired"
	case "revoke":
		if !exists || current.State != "reserved" {
			return OracleReplayDecision{Code: "replay_rejected"}
		}
		nextEntry = current
		nextEntry.State = "revoked"
	default:
		return OracleReplayDecision{Code: "replay_rejected"}
	}
	next := OracleReplayState{LedgerGeneration: state.LedgerGeneration + 1, Entries: make(map[string]OracleReplayEntry, len(state.Entries)+1)}
	for key, value := range state.Entries {
		next.Entries[key] = value
	}
	next.Entries[identity] = nextEntry
	code := map[string]string{"reserve": "replay_reserved", "commit": "replay_committed", "expire": "replay_expired", "revoke": "replay_revoked"}[command.Operation]
	return OracleReplayDecision{Allowed: true, Code: code, NextState: &next, NextStateDigest: OracleReplayStateDigest(next)}
}
