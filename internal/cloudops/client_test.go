package cloudops

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func keyWithAccount(t *testing.T, acct string) string {
	t.Helper()
	claims, err := json.Marshal(map[string]string{"account_id": acct})
	if err != nil {
		t.Fatal(err)
	}
	return "hdr." + base64.RawURLEncoding.EncodeToString(claims) + ".sig"
}

func TestAccountIDFromKey(t *testing.T) {
	got, err := AccountIDFromKey(keyWithAccount(t, "bvmon"))
	if err != nil || got != "bvmon" {
		t.Fatalf("got %q, %v; want bvmon", got, err)
	}

	for name, key := range map[string]string{
		"not a jwt":     "nope",
		"bad base64":    "hdr.!!!.sig",
		"no account_id": "hdr." + base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"x"}`)) + ".sig",
	} {
		if _, err := AccountIDFromKey(key); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

// The regression this guards is not a crash, it is a confident wrong answer: a
// bare name reaches the Cloud API as NOT FOUND, which DescribeNamespace reports
// as "the namespace does not exist". In the reconciler that read as drift on
// every timer tick, and started a child workflow every interval to repair a
// namespace that was never broken.
func TestQualify(t *testing.T) {
	c := &Client{accountID: "bvmon"}

	if got, _ := c.qualify("ws-me-orders-staging"); got != "ws-me-orders-staging.bvmon" {
		t.Errorf("bare name: got %q", got)
	}
	// Already qualified: left alone, so a caller holding a module output still works.
	if got, _ := c.qualify("ws-me-orders-staging.bvmon"); got != "ws-me-orders-staging.bvmon" {
		t.Errorf("qualified name: got %q", got)
	}

	// No account id and a bare name is the case that used to fail silently. It
	// must now be loud, because the alternative is inventing "it does not exist".
	bare := &Client{}
	_, err := bare.qualify("ws-me-orders-staging")
	if err == nil {
		t.Fatal("expected an error when the account id is unknown")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error should explain why a bare name is unsafe, got: %v", err)
	}
}
