package platform

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
	// StateServiceURL is the base URL of the workshop's HTTP state backend.
	StateServiceURL string
	// StateToken is the per-participant bearer token, sent as basic-auth password.
	StateToken string
	// StateDir backs the local backend, for when the state service is unreachable.
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
}

func ConfigFromEnv() Config {
	return Config{
		StateServiceURL:    env("STATE_SERVICE_URL", ""),
		StateToken:         env("STATE_TOKEN", ""),
		StateDir:           env("STATE_DIR", filepath.Join(".platform-state")),
		S3Bucket:           env("STATE_S3_BUCKET", ""),
		S3Region:           env("STATE_S3_REGION", "us-west-2"),
		VaultCloudKeyPath:  env("VAULT_CLOUD_KEY_PATH", "platform/cloud-api-key"),
		VaultCloudKeyField: env("VAULT_CLOUD_KEY_FIELD", "api_key"),
		VaultSinkPrefix:    env("VAULT_SINK_PREFIX", "namespaces"),
		KeyTTL:             envDuration("PLATFORM_KEY_TTL", 24*time.Hour),
		DriftInterval:      envDuration("PLATFORM_DRIFT_INTERVAL", 2*time.Minute),
	}
}

// Backend picks the state backend for one environment of one spec.
//
// The state key is per physical namespace. That is not an optimisation: it is
// what makes a per-resource single writer meaningful, and it pairs with the child
// workflow id so that "one workflow, one state file, one resource" holds all the
// way down.
func (c Config) Backend(in EnvInput) (tfexec.Backend, error) {
	key := fmt.Sprintf("%s/%s/%s", in.Participant, in.Spec.Name, in.Env)

	switch in.Spec.StateBackend {
	case spec.BackendHTTP:
		if c.StateServiceURL == "" {
			return nil, fmt.Errorf("spec asks for the http backend but STATE_SERVICE_URL is not set")
		}
		return tfexec.HTTPBackend{
			Address:  fmt.Sprintf("%s/state/%s", c.StateServiceURL, key),
			Username: in.Participant,
			Password: c.StateToken,
		}, nil

	case spec.BackendLocal:
		path := filepath.Join(c.StateDir, in.Participant, in.Spec.Name, in.Env+".tfstate")
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
	return fmt.Sprintf("%s/%s/%s/%s", c.VaultSinkPrefix, in.Participant, in.Spec.Name, in.Env)
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
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
