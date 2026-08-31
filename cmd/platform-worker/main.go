// Command platform-worker is the control plane.
//
// It hosts the reconciler and the activities it schedules -- terraform, key
// minting, and the read-only Cloud inspections that drive drift detection.
// In the workshop it runs against `temporal server start-dev` for the first
// challenges and then, once the student's own CLI has provisioned a namespace,
// against that namespace -- the control plane's first customer is itself.
package main

import (
	"context"
	"crypto/tls"
	"log"
	"os"
	"strings"
	"time"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"

	"github.com/taonic/temporal-platform-workshop/internal/platform"
	"github.com/taonic/temporal-platform-workshop/internal/vaultkv"
)

func main() {
	ctx := context.Background()

	// Vault before Temporal, deliberately: if the platform cannot reach its own
	// credential store it should say so now rather than fail inside the first
	// activity, where the error arrives as a workflow failure instead of a
	// startup error.
	vault, err := vaultkv.FromEnv(ctx)
	if err != nil {
		log.Fatalf("vault: %v\n\nThe platform reads its own Temporal Cloud API key from Vault.\nSet VAULT_ADDR and either VAULT_TOKEN (dev) or VAULT_K8S_ROLE (in-cluster).", err)
	}

	cfg := platform.ConfigFromEnv()

	// The same key twice over: the Ops API uses it to provision, and the worker
	// uses it to authenticate to the control-plane namespace. Reading it here
	// rather than taking TEMPORAL_API_KEY from the environment is what keeps the
	// credential out of the Deployment manifest -- see deploy/platform.
	cloudKey, err := vault.ReadString(ctx, cfg.VaultCloudKeyPath, cfg.VaultCloudKeyField)
	if err != nil {
		log.Fatalf("cannot read the platform cloud api key at %s: %v", cfg.VaultCloudKeyPath, err)
	}

	c, err := dial(cloudKey)
	if err != nil {
		log.Fatalf("temporal: %v", err)
	}
	defer c.Close()

	w := worker.New(c, platform.TaskQueue, worker.Options{
		// Terraform is a subprocess, so concurrency here is bounded by disk and
		// provider downloads rather than by CPU. Keep it modest: fifteen students
		// applying at once against one worker is a thundering herd of terraform
		// inits, not a demonstration of scale.
		MaxConcurrentActivityExecutionSize: 8,

		// Send heartbeats at most every 10s, rather than the SDK's default of
		// 80% of the activity's HeartbeatTimeout.
		//
		// This is the setting that makes a short HeartbeatTimeout safe. Left
		// alone, a 30s timeout throttles sends to 24s and leaves a 6s margin --
		// one dropped RPC from a spurious timeout, which reschedules the activity
		// while the original terraform is still unwinding from its SIGINT. Two
		// applies against one state file is precisely what the workflow-id lock
		// cannot protect against, because both are the same workflow.
		//
		// Capping it here decouples detection speed from the safety margin: 30s
		// timeout, 10s sends, three missed beats before anything is declared dead.
		MaxHeartbeatThrottleInterval: 10 * time.Second,
	})
	platform.Register(w, platform.NewActivities(cfg, vault))

	log.Printf("platform control plane listening on task queue %q", platform.TaskQueue)
	if err := w.Run(worker.InterruptCh()); err != nil {
		log.Fatalf("worker stopped: %v", err)
	}
}

// dial connects to whichever Temporal the control plane runs on: a dev server
// when TEMPORAL_ADDRESS is unset, a Cloud namespace when it is.
//
// vaultKey is the fallback, not the default. An explicit TEMPORAL_API_KEY still
// wins, because local runs and tests need a way in that does not involve Vault.
func dial(vaultKey string) (client.Client, error) {
	opts := client.Options{
		HostPort:  envOr("TEMPORAL_ADDRESS", client.DefaultHostPort),
		Namespace: envOr("TEMPORAL_NAMESPACE", "default"),
	}
	// A dev server accepts no credentials at all, so the address decides whether
	// the Vault key is offered. An explicit TEMPORAL_API_KEY is always honoured:
	// if someone set it, they meant it.
	key := os.Getenv("TEMPORAL_API_KEY")
	if key == "" && isCloud(opts.HostPort) {
		key = vaultKey
	}
	if key != "" {
		opts.Credentials = client.NewAPIKeyStaticCredentials(key)
		opts.ConnectionOptions.TLS = &tls.Config{MinVersion: tls.VersionTLS12}
	}
	return client.Dial(opts)
}

func isCloud(hostPort string) bool {
	return strings.Contains(hostPort, "tmprl.cloud") ||
		strings.Contains(hostPort, "api.temporal.io")
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
