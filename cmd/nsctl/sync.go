package main

import (
	"fmt"
	"time"

	"github.com/spf13/cobra"
	"go.temporal.io/sdk/client"

	"github.com/taonic/temporal-platform-workshop/internal/platform"
	"github.com/taonic/temporal-platform-workshop/internal/spec"
)

// syncCmd is the declarative driver: hand the whole directory of specs to the
// reconcilers and return immediately.
//
// This is what the post-commit hook runs. It is signal-with-start, so the first
// commit creates the reconciler and every later commit signals the one that
// already exists -- one entity workflow per logical namespace, for its whole life.
//
// Note it does not wait. Intent has been delivered; convergence is the
// reconciler's problem, and `nsctl status` is how you watch it. That difference
// from `nsctl apply` is the entire lesson of challenge 3.
func syncCmd() *cobra.Command {
	var (
		dir      string
		driftSec int
	)

	c := &cobra.Command{
		Use:   "sync",
		Short: "Reconcile every spec in the directory (declarative)",
		RunE: func(cmd *cobra.Command, _ []string) error {
			specs, err := spec.LoadDir(dir)
			if err != nil {
				return err
			}
			if len(specs) == 0 {
				fmt.Printf("no specs in %s/ -- try `nsctl new`\n", dir)
				return nil
			}
			username, cohort, err := identity(cmd)
			if err != nil {
				return err
			}

			cl, err := dial()
			if err != nil {
				return err
			}
			defer cl.Close()

			ctx, cancel := withTimeout(2 * time.Minute)
			defer cancel()

			for _, s := range specs {
				in := platform.ReconcileInput{
					Spec:                 *s,
					Username:             username,
					Cohort:               cohort,
					RunID:                envOr("WORKSHOP_RUN_ID", "local"),
					DriftIntervalSeconds: driftSec,
				}
				run, err := cl.SignalWithStartWorkflow(ctx,
					platform.NamespaceWorkflowID(s.Name), platform.SignalApply, in,
					client.StartWorkflowOptions{
						ID:        platform.NamespaceWorkflowID(s.Name),
						TaskQueue: platform.TaskQueue,
					},
					platform.NamespaceWorkflow, in)
				if err != nil {
					return fmt.Errorf("%s: %w", s.Name, err)
				}
				fmt.Printf("%-14s %s  fingerprint=%s\n", s.Name, run.GetID(), s.Fingerprint())
			}

			fmt.Println()
			fmt.Printf("%d spec(s) delivered. The reconcilers converge on their own.\n", len(specs))
			fmt.Println("  nsctl status <name>    what the loop currently believes")
			return nil
		},
	}

	c.Flags().StringVar(&dir, "dir", defaultSpecDir, "directory of specs")
	c.Flags().IntVar(&driftSec, "drift-interval", 120, "seconds between drift checks")
	addIdentityFlags(c)
	return c
}
