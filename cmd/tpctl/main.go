// Command tpctl is the platform's front door.
//
// It is a user interface, not a place where logic lives. Notably `tpctl worker
// gen-config` shells out to Python: config generation has to happen where the
// decorators are, and a CLI that reimplemented that in Go would be a second source
// of truth. A platform team's tool delegates to the ecosystem's native tooling.
package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/taonic/temporal-platform-workshop/internal/spec"
	"github.com/taonic/temporal-platform-workshop/internal/vaultkv"
	"go.temporal.io/sdk/client"
)

const defaultSpecDir = "specs"

func main() {
	root := &cobra.Command{
		Use:   "tpctl",
		Short: "Provision Temporal Cloud namespaces through the platform control plane",
		Long: `tpctl is the platform's front door.

  tpctl new                 ask four questions, write a spec
  tpctl apply -f <spec>     provision it now (imperative -- challenge 1)
  tpctl sync                reconcile every spec in specs/ (declarative -- challenge 3)
  tpctl status <name>       what the reconciler thinks is true
  tpctl destroy <name>      tear it all down, and stop the reconciler
  tpctl worker gen-config   generate worker config from the decorated workflows
  tpctl worker manifest     template the Kubernetes deployment
  tpctl deploy --spec <s>   build the worker image and deploy it`,
		SilenceUsage: true,
	}

	root.AddCommand(newCmd(), applyCmd(), syncCmd(), statusCmd(), destroyCmd(), deployCmd(), workerCmd())

	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

// dial connects to whichever Temporal the control plane is running on: the dev
// server early in the workshop, a provisioned Cloud namespace later.
func dial() (client.Client, error) {
	addr := envOr("TEMPORAL_ADDRESS", client.DefaultHostPort)
	opts := client.Options{
		HostPort:  addr,
		Namespace: envOr("TEMPORAL_NAMESPACE", "default"),
	}

	// An explicit key always wins: `workshop exec` sets one, and if someone
	// exported it themselves they meant it.
	key := os.Getenv("TEMPORAL_API_KEY")

	// Otherwise read it from Vault, at the moment it is needed.
	//
	// The key is deliberately absent from the env file -- see `vault_env_lines` in
	// scripts/workshop. Writing it there would put a live Cloud credential in
	// plaintext on disk and in every shell that sources it, which is the thing the
	// whole Vault arrangement exists to avoid. So tpctl does what the platform
	// worker does: reads it fresh from Vault on each use, and holds it only for
	// the life of this process.
	//
	// This is also what makes the paved road paved. A developer running
	// `tpctl apply` should not have to know that a credential is involved, let
	// alone wrap the command in something that supplies one.
	if key == "" && isCloud(addr) {
		var err error
		key, err = cloudKeyFromVault()
		if err != nil {
			return nil, err
		}
	}

	if key != "" {
		opts.Credentials = client.NewAPIKeyStaticCredentials(key)
		opts.ConnectionOptions.TLS = &tls.Config{MinVersion: tls.VersionTLS12}
	}
	return client.Dial(opts)
}

// isCloud is a host test, not a credential test: a dev server takes no
// credentials at all, so "no key" is only a problem when the target is Cloud.
func isCloud(hostPort string) bool {
	return strings.Contains(hostPort, ".tmprl.cloud") ||
		strings.Contains(hostPort, ".temporal.io")
}

// cloudKeyFromVault reads the platform's own Cloud credential.
//
// The failure message matters more than the happy path here. Without it the SDK
// dials Cloud with no TLS, sends a plaintext gRPC preface at a TLS listener, and
// reports "failed reaching server: error reading server preface: EOF" -- which
// names neither the credential nor the thing that supplies it, and reads like the
// server is down.
func cloudKeyFromVault() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	path := envOr("VAULT_CLOUD_KEY_PATH", "platform/cloud-api-key")
	field := envOr("VAULT_CLOUD_KEY_FIELD", "api_key")

	v, err := vaultkv.FromEnv(ctx)
	if err != nil {
		return "", fmt.Errorf(
			"this command needs a Temporal Cloud credential, and it reads one from Vault.\n"+
				"Vault is not configured in this shell: %w\n\n"+
				"  source \"$(./scripts/workshop env-file)\"\n", err)
	}
	key, err := v.ReadString(ctx, path, field)
	if err != nil {
		return "", fmt.Errorf(
			"no Cloud credential at %s in Vault: %w\n\n"+
				"Seed it once and every later command reads it from there:\n"+
				"  ./scripts/workshop init --api-key\n", path, err)
	}
	return key, nil
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
				"It is the name you chose at the workshop portal; ./scripts/workshop init writes it")
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
