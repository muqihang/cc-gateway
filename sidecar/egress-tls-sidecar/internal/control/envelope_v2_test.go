package control

import (
	"crypto/ed25519"
	"crypto/rand"
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
	SidecarUnsignedEnvelope OracleSidecarCapabilityUnsigned `json:"sidecar_unsigned_envelope"`
}

type oracleCBORExpected struct {
	CanonicalResults struct {
		SidecarUnsignedEnvelope struct {
			CanonicalHex string `json:"canonical_hex"`
		} `json:"sidecar_unsigned_envelope"`
	} `json:"canonical_results"`
	ReplayStateDigests struct {
		Reserved  string `json:"reserved"`
		Committed string `json:"committed"`
	} `json:"replay_state_digests"`
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

func TestEnvelopeV2SignedCapabilityAndReplay(t *testing.T) {
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
	expectedRaw, err := os.ReadFile(filepath.Join(filepath.Dir(current), "..", "..", "..", "..", "contracts", "oracle-lab", "v1", "expected-results.json"))
	if err != nil {
		t.Fatal(err)
	}
	var expected oracleCBORExpected
	if err := json.Unmarshal(expectedRaw, &expected); err != nil {
		t.Fatal(err)
	}
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	key := OracleSidecarCapabilityKey{KeyID: "sidecar-key-11", Role: "sidecar_capability", Epoch: 11, PublicKey: publicKey}
	signed, err := SignOracleSidecarCapability(corpus.SidecarUnsignedEnvelope, key.KeyID, key.Epoch, privateKey)
	if err != nil {
		t.Fatal(err)
	}
	frame, err := EncodeOracleSidecarCapability(signed)
	if err != nil {
		t.Fatal(err)
	}
	decision := VerifyOracleSidecarCapability(frame, OracleSidecarVerifyContext{Keys: map[string]OracleSidecarCapabilityKey{key.KeyID: key}, NowMS: 1800000000100})
	if !decision.Allowed || decision.Code != "sidecar_capability_allow" {
		t.Fatalf("unexpected verify decision: %+v", decision)
	}
	unsignedBytes, err := OracleSidecarCapabilitySigningBytes(corpus.SidecarUnsignedEnvelope)
	if err != nil {
		t.Fatal(err)
	}
	if hex.EncodeToString(unsignedBytes[len(OracleSidecarCapabilityDomain):]) != expected.CanonicalResults.SidecarUnsignedEnvelope.CanonicalHex {
		t.Fatalf("unsigned capability bytes differ")
	}
	if os.Getenv("ORACLE_PHASE2_DEBUG_DIGESTS") == "1" {
		t.Logf("sidecar-unsigned-hex %x", unsignedBytes[len(OracleSidecarCapabilityDomain):])
	}

	wrongEpoch := key
	wrongEpoch.Epoch++
	if code := VerifyOracleSidecarCapability(frame, OracleSidecarVerifyContext{Keys: map[string]OracleSidecarCapabilityKey{key.KeyID: wrongEpoch}, NowMS: 1800000000100}).Code; code != "sidecar_key_epoch_mismatch" {
		t.Fatalf("wrong epoch returned %s", code)
	}
	revoked := key
	revoked.Revoked = true
	if code := VerifyOracleSidecarCapability(frame, OracleSidecarVerifyContext{Keys: map[string]OracleSidecarCapabilityKey{key.KeyID: revoked}, NowMS: 1800000000100}).Code; code != "sidecar_key_revoked" {
		t.Fatalf("revoked key returned %s", code)
	}
	reused := OracleSidecarCapabilityKey{KeyID: "manifest-key-11", Role: "manifest", Epoch: 11, PublicKey: publicKey}
	if code := VerifyOracleSidecarCapability(frame, OracleSidecarVerifyContext{Keys: map[string]OracleSidecarCapabilityKey{key.KeyID: key, reused.KeyID: reused}, NowMS: 1800000000100}).Code; code != "sidecar_key_role_reuse" {
		t.Fatalf("role reuse returned %s", code)
	}

	initial := OracleReplayState{LedgerGeneration: 0, Entries: map[string]OracleReplayEntry{}}
	command := OracleReplayCommand{Operation: "reserve", ExpectedGeneration: 0, NowMS: 1800000000000, ExpiresAtMS: 1800000060000, KeyEpoch: 11, CapabilityID: "capability:fixture:1", AttemptID: "attempt:fixture:1", Nonce: "nonce:fixture:1"}
	reserved := TransitionOracleReplayState(initial, command)
	if reserved.Code != "replay_reserved" {
		t.Fatalf("reserve failed: %+v", reserved)
	}
	if reserved.NextStateDigest != expected.ReplayStateDigests.Reserved {
		t.Fatalf("reserved replay digest differs: %s", reserved.NextStateDigest)
	}
	command.Operation = "commit"
	command.ExpectedGeneration = 1
	command.NowMS++
	committed := TransitionOracleReplayState(*reserved.NextState, command)
	if committed.Code != "replay_committed" {
		t.Fatalf("commit failed: %+v", committed)
	}
	if committed.NextStateDigest != expected.ReplayStateDigests.Committed {
		t.Fatalf("committed replay digest differs: %s", committed.NextStateDigest)
	}
	command.Operation = "reserve"
	command.ExpectedGeneration = 2
	if code := TransitionOracleReplayState(*committed.NextState, command).Code; code != "replay_rejected" {
		t.Fatalf("terminal reuse returned %s", code)
	}
	command.Operation = "commit"
	command.ExpectedGeneration = 0
	if code := TransitionOracleReplayState(*reserved.NextState, command).Code; code != "replay_replica_conflict" {
		t.Fatalf("stale replica returned %s", code)
	}
	if os.Getenv("ORACLE_PHASE2_DEBUG_DIGESTS") == "1" {
		t.Logf("replay-digest reserved %s", reserved.NextStateDigest)
		t.Logf("replay-digest committed %s", committed.NextStateDigest)
	}
}
