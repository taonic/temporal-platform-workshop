package spec

import (
	"path/filepath"
	"strings"
	"testing"
)

func valid() Spec {
	return Spec{
		Name: "orders", Owner: "payments-team", Tier: TierStandard,
		RetentionDays: 7, Region: "aws-us-east-1",
		Environments: []string{EnvStaging, EnvProd}, StateBackend: BackendHTTP,
	}
}

func TestValidSpec(t *testing.T) {
	s := valid()
	if err := s.Validate(); err != nil {
		t.Fatalf("expected valid: %v", err)
	}
}

func TestValidationReportsEveryProblemAtOnce(t *testing.T) {
	s := Spec{Name: "X", Tier: "gold", RetentionDays: 400, Environments: []string{"dev"}}
	err := s.Validate()
	if err != nil {
		msg := err.Error()
		for _, want := range []string{"name", "owner", "tier", "retentionDays", "region", "dev", "stateBackend"} {
			if !contains(msg, want) {
				t.Errorf("error message does not mention %q:\n%s", want, msg)
			}
		}
		return
	}
	t.Fatal("expected the spec to be rejected")
}

// PhysicalName is where the reserved-after-deletion problem is solved, so it is
// worth pinning exactly.
func TestPhysicalNameUsesTheUsername(t *testing.T) {
	s := valid()
	if got, want := s.PhysicalName("alice", EnvProd), "ws-alice-orders-prod"; got != want {
		t.Errorf("PhysicalName = %q, want %q", got, want)
	}
}

func TestNameLengthKeepsPhysicalNameShort(t *testing.T) {
	s := valid()
	s.Name = "thirteenchars" // 13
	if err := s.Validate(); err == nil {
		t.Error("a 13-character name should be rejected: the physical name it derives would be too long")
	}
}

func TestFingerprintChangesWithMeaningfulEdits(t *testing.T) {
	a := valid()
	base := a.Fingerprint()

	b := valid()
	b.RetentionDays = 14
	if b.Fingerprint() == base {
		t.Error("changing retention must change the fingerprint, or the reconciler ignores the apply")
	}

	// Environment order is not a change: the reconciler must not re-apply because
	// somebody reordered a list.
	c := valid()
	c.Environments = []string{EnvProd, EnvStaging}
	if c.Fingerprint() != base {
		t.Error("reordering environments must not change the fingerprint")
	}
}

func TestTagsAreComplete(t *testing.T) {
	// temporalcloud_namespace_tags manages the whole tag set, so a missing key
	// here silently deletes a tag on the next apply.
	v := valid()
	tags := v.Tags(EnvStaging, "run-42")
	for _, k := range []string{"owner", "tier", "environment", "provisioner", "spec", "track-run"} {
		if tags[k] == "" {
			t.Errorf("tag %q is empty", k)
		}
	}
}

func TestLoadDirSkipsUnderscoreFiles(t *testing.T) {
	specs, err := LoadDir(filepath.Join("..", "..", "specs"))
	if err != nil {
		t.Fatalf("LoadDir: %v", err)
	}
	for _, s := range specs {
		if s.Name == "" {
			t.Error("loaded a spec with no name")
		}
	}
	// _example.yaml is documentation and must not become desired state.
	if len(specs) != 0 {
		t.Logf("loaded %d spec(s); _example.yaml correctly skipped", len(specs))
	}
}

func contains(haystack, needle string) bool {
	return strings.Contains(haystack, needle)
}

// TestPhysicalNameFitsCloudsLimit is the reason UsernameRe and nameRe are capped
// where they are. Cloud rejects a namespace name over 39 characters, and the two
// user-supplied parts share one budget -- so neither cap can be checked alone.
func TestPhysicalNameFitsCloudsLimit(t *testing.T) {
	s := &Spec{Name: "aaaaaaaaaaaa"}                        // 12, the maximum a spec name may be
	longest := s.PhysicalName("bbbbbbbbbbbbbb", EnvStaging) // 14, the maximum a username may be
	if len(longest) > 39 {
		t.Fatalf("longest possible namespace name is %d characters, Cloud allows 39: %s", len(longest), longest)
	}
}
