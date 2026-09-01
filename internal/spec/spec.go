// Package spec is the namespace spec: what a team asks the platform for.
//
// The spec never leaves Go. The CLI writes it, the reconciler reads it, so there
// is no cross-language contract here and no schema file. The contract that does
// cross a language boundary is the worker config -- see internal/workerconfig and
// schema/workerconfig.schema.json.
package spec

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// Environments the platform knows how to build. One region, two environments:
// enough to teach fan-out, partial failure and per-environment identity without
// multiplying real Temporal Cloud resources by six.
const (
	EnvStaging = "staging"
	EnvProd    = "prod"
)

// Tiers exist so that retention and, later, quota and rate limits are policy
// rather than per-team argument. Nothing consumes Tier yet. That is deliberate:
// a spec field with no consumer is how you teach spec-as-policy before you have
// policy.
const (
	TierStandard = "standard"
	TierCritical = "critical"
)

// State backends. Locking is deliberately absent from all of them -- the
// reconciler's workflow id is the resource identity, so Temporal's uniqueness
// constraint is the lock. See DESIGN.md rule 1.
//
// State is local by default. The workshop ran an HTTP state service for a while;
// it was one more thing to deploy, one more credential to hand out, and one more
// way for a sandbox with no egress to fail at challenge 1. A file on the box a
// student is already sitting in front of is debuggable with `cat`.
const (
	BackendLocal = "local"
	BackendS3    = "s3"
)

// Spec is one team's request. Four fields, which is what a real namespace-request
// tool asks for and no more: name, owner, tier, retention.
type Spec struct {
	Name          string   `yaml:"name"`
	Owner         string   `yaml:"owner"`
	Tier          string   `yaml:"tier"`
	RetentionDays int      `yaml:"retentionDays"`
	Region        string   `yaml:"region"`
	Environments  []string `yaml:"environments"`
	StateBackend  string   `yaml:"stateBackend"`
}

// Cloud caps a namespace name at 39 characters, lower-case letters, digits and
// hyphens. The physical name is ws-<username>-<spec>-staging, so the two
// user-supplied parts share one budget:
//
//	len("ws-") + username + len("-") + spec + len("-staging")
//	  3        +    14    +    1    +  12  +      8          = 38
//
// Hence 14 and 12. Both are validated where they are typed -- the same rejection
// arriving from inside a Terraform activity reads as a broken module.
var nameRe = regexp.MustCompile(`^[a-z][a-z0-9-]{1,11}$`)

// UsernameRe is the student's chosen name. It is an identifier, not a display
// name: it becomes part of a namespace name, a Vault path and a tag value.
var UsernameRe = regexp.MustCompile(`^[a-z][a-z0-9-]{1,13}$`)

// ValidateUsername is exported because the portal validates at the join screen and
// tpctl validates at the shell. One rule, two callers, no drift.
func ValidateUsername(u string) error {
	if !UsernameRe.MatchString(u) {
		return fmt.Errorf(
			"username %q must be 2-14 characters, lower-case letters, digits and dashes, starting with a letter", u)
	}
	return nil
}

var validEnvs = map[string]bool{EnvStaging: true, EnvProd: true}
var validTiers = map[string]bool{TierStandard: true, TierCritical: true}
var validBackends = map[string]bool{BackendLocal: true, BackendS3: true}

// Validate reports every problem it finds rather than the first, because a
// student fixing a spec by hand should not have to run the command five times.
func (s *Spec) Validate() error {
	var problems []string

	if !nameRe.MatchString(s.Name) {
		problems = append(problems, fmt.Sprintf(
			"name %q must be 2-12 characters, lower-case letters, digits and dashes, starting with a letter", s.Name))
	}
	if strings.TrimSpace(s.Owner) == "" {
		problems = append(problems, "owner is required: it is who gets paged when this namespace misbehaves")
	}
	if !validTiers[s.Tier] {
		problems = append(problems, fmt.Sprintf("tier %q must be one of standard, critical", s.Tier))
	}
	if s.RetentionDays < 1 || s.RetentionDays > 90 {
		problems = append(problems, fmt.Sprintf("retentionDays %d must be between 1 and 90", s.RetentionDays))
	}
	if strings.TrimSpace(s.Region) == "" {
		problems = append(problems, "region is required, for example aws-us-east-1")
	}
	if len(s.Environments) == 0 {
		problems = append(problems, "environments must list at least one of staging, prod")
	}
	seen := map[string]bool{}
	for _, e := range s.Environments {
		if !validEnvs[e] {
			problems = append(problems, fmt.Sprintf("environment %q must be one of staging, prod", e))
		}
		if seen[e] {
			problems = append(problems, fmt.Sprintf("environment %q listed twice", e))
		}
		seen[e] = true
	}
	if !validBackends[s.StateBackend] {
		problems = append(problems, fmt.Sprintf("stateBackend %q must be one of local, s3", s.StateBackend))
	}

	if len(problems) > 0 {
		return fmt.Errorf("spec is not valid:\n  - %s", strings.Join(problems, "\n  - "))
	}
	return nil
}

// PhysicalName is the namespace name for one environment of this spec.
//
// Derived from the username the student chose. An earlier design used a leased
// integer slot instead, on the belief that Temporal Cloud reserves a namespace
// name after deletion -- it does not, and the reasoning was circular anyway: a
// reserved ws-7-orders-staging burns exactly as ws-alice-orders-staging would,
// and a small fixed set of slots burns out faster than per-person names do.
func (s *Spec) PhysicalName(username, env string) string {
	return fmt.Sprintf("ws-%s-%s-%s", username, s.Name, env)
}

// NamespaceEndpoint is where a namespace answers, derived from its own id.
//
//	ws-me-orders-staging.acct1  ->  ws-me-orders-staging.acct1.tmprl.cloud:7233
//
// Temporal Cloud publishes a per-namespace endpoint alongside the regional ones,
// and it is strictly the better address to hold: it is a pure function of the
// namespace id, so it cannot disagree with the namespace it points at.
//
// The regional form -- <region>.<cloud>.api.temporal.io:7233 -- was used here
// first, and it was a mistake worth recording. A namespace is only reachable on
// ITS OWN region's endpoint, and the region came from the spec while the address
// people had to hand came from the control plane's environment. When those
// differed, Temporal answered "Request unauthorized": a routing error wearing a
// credential error's clothes, which sends you to audit keys and service accounts
// that are all perfectly correct. Deriving the address from the namespace makes
// the mismatch unrepresentable.
func NamespaceEndpoint(namespaceID string) string {
	return namespaceID + ".tmprl.cloud:7233"
}

// Tags are the complete tag set for a namespace. temporalcloud_namespace_tags
// manages the whole set, so this must always return everything we want present.
func (s *Spec) Tags(env, runID string) map[string]string {
	return map[string]string{
		"owner":       s.Owner,
		"tier":        s.Tier,
		"environment": env,
		"provisioner": "platform-reconciler",
		"spec":        s.Name,
		"track-run":   runID,
	}
}

// Fingerprint is a stable digest of everything the platform acts on.
//
// The reconciler uses it to ignore an apply signal that carries no change. Without
// that, the post-commit hook firing on an unrelated commit would re-apply every
// namespace in the repo.
func (s *Spec) Fingerprint() string {
	envs := append([]string(nil), s.Environments...)
	sort.Strings(envs)
	h := sha256.Sum256([]byte(strings.Join([]string{
		s.Name, s.Owner, s.Tier, s.Region, s.StateBackend,
		strconv.Itoa(s.RetentionDays), strings.Join(envs, ","),
	}, "\x00")))
	return hex.EncodeToString(h[:8])
}

// Load reads and validates a single spec file.
func Load(path string) (*Spec, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var s Spec
	dec := yaml.NewDecoder(strings.NewReader(string(data)))
	dec.KnownFields(true) // a typo'd field is a bug, not something to ignore
	if err := dec.Decode(&s); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if err := s.Validate(); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return &s, nil
}

// LoadDir reads every spec in a directory. This is the desired state the
// reconciler works from: the whole directory, not one file, because a spec that
// disappears from the directory has to be noticed too.
func LoadDir(dir string) ([]*Spec, error) {
	matches, err := filepath.Glob(filepath.Join(dir, "*.yaml"))
	if err != nil {
		return nil, err
	}
	sort.Strings(matches)

	var out []*Spec
	for _, m := range matches {
		if strings.HasPrefix(filepath.Base(m), "_") {
			continue // _example.yaml and friends are documentation
		}
		s, err := Load(m)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, nil
}

// Save writes the spec into dir and returns the path written. Validation happens
// on write as well as on read, so a bad spec never reaches a commit.
func (s *Spec) Save(dir string) (string, error) {
	if err := s.Validate(); err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, s.Name+".yaml")

	body, err := yaml.Marshal(s)
	if err != nil {
		return "", err
	}
	header := fmt.Sprintf(`# Namespace spec for %q, owned by %s.
#
# Committing this file is how you ask the platform for something. The reconciler
# is signalled by the post-commit hook and also re-reads this directory on a
# timer, so a change here converges either way -- and a change made behind the
# platform's back in the Cloud UI gets corrected on the next timer tick.
`, s.Name, s.Owner)

	return path, os.WriteFile(path, append([]byte(header), body...), 0o644)
}
