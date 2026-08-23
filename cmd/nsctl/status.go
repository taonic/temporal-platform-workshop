package main

import (
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/taonic/temporal-platform-workshop/internal/platform"
)

// statusCmd queries the reconciler.
//
// This is also what the graders use. Cloud-side state is checkable through the Ops
// API, but platform behaviour -- did the loop notice the drift, did it correct it,
// how many times has it reconciled -- exists only in workflow state. A control
// loop you can interrogate is worth more than a control loop you can only watch.
func statusCmd() *cobra.Command {
	var asJSON bool

	c := &cobra.Command{
		Use:   "status <name>",
		Short: "What the reconciler believes about a spec",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cl, err := dial()
			if err != nil {
				return err
			}
			defer cl.Close()

			ctx, cancel := withTimeout(20 * time.Second)
			defer cancel()

			resp, err := cl.QueryWorkflow(ctx, platform.NamespaceWorkflowID(args[0]), "", platform.QueryStatus)
			if err != nil {
				return fmt.Errorf("querying %s: %w\n\nIs the reconciler running? `nsctl sync` starts it",
					platform.NamespaceWorkflowID(args[0]), err)
			}

			var st platform.Status
			if err := resp.Get(&st); err != nil {
				return err
			}

			if asJSON {
				enc := json.NewEncoder(os.Stdout)
				enc.SetIndent("", "  ")
				return enc.Encode(st)
			}

			fmt.Printf("%s  (slot %d, generation %d)\n", st.Spec.Name, st.Slot, st.Generation)
			fmt.Printf("  owner %s   tier %s   retention %dd\n", st.Spec.Owner, st.Spec.Tier, st.Spec.RetentionDays)
			fmt.Printf("  reconciles %d   drifts detected %d\n", st.Reconciles, st.DriftsDetected)
			if st.LastDrift != "" {
				fmt.Printf("  last drift: %s\n", st.LastDrift)
			}
			if st.Destroying {
				fmt.Println("  destroying")
			}
			fmt.Println()
			for _, e := range st.Environments {
				mark := "ok "
				if !e.OK {
					mark = "ERR"
				}
				fmt.Printf("  %s %-9s %-28s %s\n", mark, e.Env, dash(e.NamespaceID), e.VaultPath)
				if e.Error != "" {
					fmt.Printf("      %s\n", e.Error)
				}
			}
			return nil
		},
	}

	c.Flags().BoolVar(&asJSON, "json", false, "machine-readable output, for checkpoints")
	return c
}
