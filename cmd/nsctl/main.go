// Command nsctl is the platform's front door.
//
// It is a user interface, not a place where logic lives. Notably `nsctl worker
// gen-config` shells out to Python: config generation has to happen where the
// decorators are, and a CLI that reimplemented that in Go would be a second source
// of truth. A platform team's tool delegates to the ecosystem's native tooling.
package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/taonic/temporal-platform-workshop/internal/spec"
	"go.temporal.io/sdk/client"
)

const defaultSpecDir = "specs"

func main() {
	root := &cobra.Command{
		Use:   "nsctl",
		Short: "Provision Temporal Cloud namespaces through the platform control plane",
		Long: `nsctl is the platform's front door.

  nsctl new                 ask four questions, write a spec
  nsctl apply -f <spec>     provision it now (imperative -- challenge 1)
  nsctl sync                reconcile every spec in specs/ (declarative -- challenge 3)
  nsctl status <name>       what the reconciler thinks is true
  nsctl worker gen-config   generate worker config from the decorated workflows
  nsctl worker manifest     template the Kubernetes deployment
  nsctl status              what the reconciler believes`,
		SilenceUsage: true,
	}

	root.AddCommand(newCmd(), applyCmd(), syncCmd(), statusCmd(), workerCmd())

	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

// dial connects to whichever Temporal the control plane is running on: the dev
// server early in the workshop, a provisioned Cloud namespace later.
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

func withTimeout(d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), d)
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// identity resolves the platform-assigned facts that are deliberately not in the
// spec: who this is, and which cohort they belong to.
//
// One identifier, chosen by the student at the join screen. It names their
// namespaces, their Vault paths, their tfstate paths and the tag the grader
// reads -- so it is validated here as well as at the portal, because the same
// rejection arriving from inside a Terraform activity reads as a broken module.
func identity(cmd *cobra.Command) (username, cohort string, err error) {
	username, _ = cmd.Flags().GetString("username")
	if username == "" {
		username = os.Getenv("WORKSHOP_USERNAME")
	}
	if username == "" {
		return "", "", fmt.Errorf(
			"no username. Set $WORKSHOP_USERNAME or pass --username.\n" +
				"It is the name you chose at the workshop portal; ./scripts/workshop-creds init writes it")
	}
	if err := spec.ValidateUsername(username); err != nil {
		return "", "", err
	}

	cohort, _ = cmd.Flags().GetString("cohort")
	if cohort == "" {
		cohort = envOr("WORKSHOP_COHORT", "local")
	}
	return username, cohort, nil
}

func addIdentityFlags(c *cobra.Command) {
	c.Flags().String("username", "", "your workshop username (default $WORKSHOP_USERNAME)")
	c.Flags().String("cohort", "", "cohort id, used as a teardown tag (default $WORKSHOP_COHORT)")
}
