package control

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

type oracleCBORCorpus struct {
	CBORCases []struct {
		ID           string           `json:"id"`
		InputHex     string           `json:"input_hex"`
		Value        map[string]int64 `json:"value"`
		Valid        bool             `json:"valid"`
		ExpectedCode string           `json:"expected_code"`
		ExpectedHex  string           `json:"expected_hex"`
	} `json:"cbor_cases"`
}

func TestEnvelopeV2CanonicalCorpus(t *testing.T) {
	_, current, _, _ := runtime.Caller(0)
	corpusPath := filepath.Join(filepath.Dir(current), "..", "..", "..", "..", "contracts", "oracle-lab", "v1", "canonicalization-corpus.json")
	raw, err := os.ReadFile(corpusPath)
	if err != nil {
		t.Fatal(err)
	}
	var corpus oracleCBORCorpus
	if err := json.Unmarshal(raw, &corpus); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range corpus.CBORCases {
		fixture := fixture
		t.Run(fixture.ID, func(t *testing.T) {
			if !fixture.Valid {
				input, err := hex.DecodeString(fixture.InputHex)
				if err != nil {
					t.Fatal(err)
				}
				var decoded any
				err = DecodeOracleDeterministicCBOR(input, &decoded)
				if OracleCBORCode(err) != fixture.ExpectedCode {
					t.Fatalf("expected %s, got %v", fixture.ExpectedCode, err)
				}
				return
			}
			encoded, err := EncodeOracleDeterministicCBOR(fixture.Value)
			if err != nil {
				t.Fatal(err)
			}
			if hex.EncodeToString(encoded) != fixture.ExpectedHex {
				t.Fatalf("encoded bytes differ: %x", encoded)
			}
			frame, err := FrameOracleCBOR(encoded)
			if err != nil {
				t.Fatal(err)
			}
			unframed, err := UnframeOracleCBOR(frame)
			if err != nil {
				t.Fatal(err)
			}
			if hex.EncodeToString(unframed) != fixture.ExpectedHex {
				t.Fatalf("framed bytes differ")
			}
		})
	}
}
