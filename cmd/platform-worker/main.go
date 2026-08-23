// Command platform-worker is the control plane.
//
// It hosts the reconciler, the terraform activities, the slot pool and the reaper.
// In the workshop it runs against `temporal server start-dev` for the first
// challenges and then, once the student's own CLI has provisioned a namespace,
// against that namespace -- the control plane's first customer is itself.
package main

import (
	"context"
	"crypto/tls"
	"log"
	"os"

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

	if _, err := vault.ReadString(ctx, cfg.VaultCloudKeyPath, cfg.VaultCloudKeyField); err != nil {
		log.Fatalf("cannot read the platform cloud api key at %s: %v", cfg.VaultCloudKeyPath, err)
	}

	c, err := dial()
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
	})
	platform.Register(w, platform.NewActivities(cfg, vault))

	log.Printf("platform control plane listening on task queue %q", platform.TaskQueue)
	if err := w.Run(worker.InterruptCh()); err != nil {
		log.Fatalf("worker stopped: %v", err)
	}
}

func dial() (client.Client, error) {
	opts := client.Options{
		HostPort:  envOr("TEMPORAL_ADDRESS", client.DefaultHostPort),
		Namespace: envOr("TEMPORAL_NAMESPACE", "default"),
	}
	if key := os.Getenv("TEMPORAL_API_KEY"); key != "" {
		opts.Credentials = client.NewAPIKeyStaticCredentials(key)
		opts.ConnectionOptions.TLS = &tls.Config{MinVersion: tls.VersionTLS12}
	}
	return client.Dial(opts)
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
