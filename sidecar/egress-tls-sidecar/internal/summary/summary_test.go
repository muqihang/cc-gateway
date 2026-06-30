package summary

import "testing"

func TestCompareToExpectedMarksExactMatchAndMismatch(t *testing.T) {
	expected := ExpectedClaudeCode2179()
	if result := CompareToExpected(expected, expected); result.Status != "MATCH" {
		t.Fatalf("expected MATCH, got %+v", result)
	}
	observed := expected
	observed.ExtensionCount = 13
	observed.JA3Hash = "dc782a9d905fdcee1223a3d4e8108bc6"
	observed.JA4 = "t13d0017h1_18560269b2cb_dd86c69b7cb0"
	result := CompareToExpected(observed, expected)
	if result.Status != "BLOCKED_TLS_ENGINE_MISMATCH" {
		t.Fatalf("expected mismatch block, got %+v", result)
	}
	if len(result.DifferenceFields) == 0 {
		t.Fatalf("expected difference fields")
	}
}
