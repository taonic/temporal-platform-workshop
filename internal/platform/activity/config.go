// Package activity holds the control plane's side effects, and the contract for
// them: everything that touches the world, plus the configuration and inputs it
// touches the world with.
//
// The package boundary is the point. Workflows in the parent package are pure
// orchestration and cannot reach a subprocess, a Vault client or the Cloud Ops API
// except by scheduling something in here -- and that is now enforced by the
// compiler rather than asserted in a comment.
//
// The activities are split across three receivers, and the seam is NOT one struct
// per Cloud resource. That split would lie: the namespace, its service account and
// its search attributes are one Terraform module behind one state file and cannot
// be applied independently. The seam that is real is what a FAILURE means:
//
//	terraform.go   minutes long, heartbeating   -> retry with backoff
//	key.go         creates a live credential    -> retry, but did that leak?
//	inspect.go     reads and changes nothing    -> swallow it, ask again next tick
//
// Three postures, three retry policies, three different things to think about when
// one goes wrong. A new resource joins whichever receiver matches how it fails,
// which is why this split keeps working as the platform grows and a
// resource-shaped one would not.
package activity

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/taonic/temporal-platform-workshop/internal/spec"
	"github.com/taonic/temporal-platform-workshop/internal/tfexec"
)

// Config is the platform worker's own configuration -- the things an operator
// sets, as distinct from the things a team asks for in a spec.
type Config struct {
	// StateDir backs the local backend, which is the one the workshop uses.
	StateDir string
	// S3Bucket and S3Region back the s3 backend. Present to prove the interface is
	// real rather than one implementation wearing a costume.
	S3Bucket string
	S3Region string
	// VaultCloudKeyPath is where the platform's own Cloud API key lives, and
	// VaultCloudKeyField which key in that secret. Source role.
	VaultCloudKeyPath  string
	VaultCloudKeyField string
	// VaultSinkPrefix is where minted namespace keys are written. Sink role.
	VaultSinkPrefix string
	// KeyTTL bounds the life of every key the platform mints.
	KeyTTL time.Duration
	// DriftInterval is how often the reconciler asks the Cloud what is actually
	// true, rather than what it was last told.
	DriftInterval time.Duration
	// NamespaceQuota is the account's namespace limit. Zero disables the check.
	// The workshop runs 15 students at a peak of 3 namespaces each against 50.
	NamespaceQuota int
}

func ConfigFromEnv() Config {
	return Config{
		StateDir:           env("STATE_DIR", filepath.Join(".platform-state")),
		S3Bucket:           env("STATE_S3_BUCKET", ""),
		S3Region:           env("STATE_S3_REGION", "us-west-2"),
		VaultCloudKeyPath:  env("VAULT_CLOUD_KEY_PATH", "platform/cloud-api-key"),
		VaultCloudKeyField: env("VAULT_CLOUD_KEY_FIELD", "api_key"),
		VaultSinkPrefix:    env("VAULT_SINK_PREFIX", "namespaces"),
		KeyTTL:             envDuration("PLATFORM_KEY_TTL", 24*time.Hour),
		DriftInterval:      envDuration("PLATFORM_DRIFT_INTERVAL", 2*time.Minute),
		NamespaceQuota:     envInt("PLATFORM_NAMESPACE_QUOTA", 50),
	}
}

// Backend picks the state backend for one environment of one spec.
//
// The state key is per physical namespace. That is not an optimisation: it is
// what makes a per-resource single writer meaningful, and it pairs with the child
// workflow id so that "one workflow, one state file, one resource" holds all the
// way down.
func (c Config) Backend(in EnvInput) (tfexec.Backend, error) {
	key := fmt.Sprintf("%s/%s/%s", in.Username, in.Spec.Name, in.Env)

	switch in.Spec.StateBackend {
	case spec.BackendLocal:
		path := filepath.Join(c.StateDir, in.Username, in.Spec.Name, in.Env+".tfstate")
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return nil, err
		}
		return tfexec.LocalBackend{Path: path}, nil

	case spec.BackendS3:
		if c.S3Bucket == "" {
			return nil, fmt.Errorf("spec asks for the s3 backend but STATE_S3_BUCKET is not set")
		}
		return tfexec.S3Backend{Bucket: c.S3Bucket, Key: key + ".tfstate", Region: c.S3Region}, nil

	default:
		return nil, fmt.Errorf("unknown state backend %q", in.Spec.StateBackend)
	}
}

// SinkPath is where an environment's minted credential is written.
func (c Config) SinkPath(in EnvInput) string {
	return fmt.Sprintf("%s/%s/%s/%s", c.VaultSinkPrefix, in.Username, in.Spec.Name, in.Env)
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	v, err := strconv.Atoi(os.Getenv(k))
	if err != nil || v < 0 {
		return def
	}
	return v
}

func envDuration(k string, def time.Duration) time.Duration {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	if d, err := time.ParseDuration(v); err == nil {
		return d
	}
	if n, err := strconv.Atoi(v); err == nil {
		return time.Duration(n) * time.Second
	}
	return def
}
