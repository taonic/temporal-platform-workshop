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
  nsctl slot / nsctl reap   platform housekeeping`,
		SilenceUsage: true,
	}

	root.AddCommand(newCmd(), applyCmd(), syncCmd(), statusCmd(), workerCmd(), slotCmd(), reapCmd())

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
// spec: which participant this is and which slot they hold.
func identity(cmd *cobra.Command) (participant string, slot int, err error) {
	participant, _ = cmd.Flags().GetString("participant")
	if participant == "" {
		participant = os.Getenv("WORKSHOP_PARTICIPANT")
	}
	if participant == "" {
		participant = "local"
	}

	slot, _ = cmd.Flags().GetInt("slot")
	if slot == 0 {
		if v := os.Getenv("WORKSHOP_SLOT"); v != "" {
			if _, scanErr := fmt.Sscanf(v, "%d", &slot); scanErr != nil {
				return "", 0, fmt.Errorf("WORKSHOP_SLOT=%q is not a number", v)
			}
		}
	}
	if slot == 0 {
		slot = 1 // local development gets slot 1
	}
	return participant, slot, nil
}

func addIdentityFlags(c *cobra.Command) {
	c.Flags().String("participant", "", "Instruqt participant id (default $WORKSHOP_PARTICIPANT)")
	c.Flags().Int("slot", 0, "leased slot number (default $WORKSHOP_SLOT)")
}
