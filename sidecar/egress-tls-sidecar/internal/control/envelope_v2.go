package control

import (
	"bytes"
	"encoding/binary"
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
		DupMapKey:        cbor.DupMapKeyEnforcedAPF,
		MaxNestedLevels:  32,
		MaxArrayElements: 4096,
		MaxMapPairs:      1024,
		IndefLength:      cbor.IndefLengthForbidden,
		TagsMd:           cbor.TagsForbidden,
		IntDec:           cbor.IntDecConvertNone,
		UTF8:             cbor.UTF8RejectInvalid,
		DefaultMapType:   reflect.TypeOf(map[string]any{}),
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
