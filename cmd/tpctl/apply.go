package main

import (
	"fmt"
	"time"

	"github.com/spf13/cobra"
	"go.temporal.io/sdk/client"

	"github.com/taonic/temporal-platform-workshop/internal/platform"
	"github.com/taonic/temporal-platform-workshop/internal/spec"
)

// applyCmd is the imperative driver: start a workflow, watch it, print the result.
//
// This is challenge 1. It is not a toy that gets deleted later -- it runs the same
// child workflows and the same activities the reconciler does, so when the loop
// misbehaves in challenge 3 there is a working baseline to compare against.
func applyCmd() *cobra.Command {
	var file string

	c := &cobra.Command{
		Use:   "apply",
		Short: "Provision a spec now and wait for the result",
		RunE: func(cmd *cobra.Command, _ []string) error {
			s, err := spec.Load(file)
			if err != nil {
				return err
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

			ctx, cancel := withTimeout(time.Hour)
			defer cancel()

			in := platform.ReconcileInput{
				Spec:     *s,
				Username: username,
				Cohort:   cohort,
				RunID:    envOr("WORKSHOP_RUN_ID", "local"),
			}

			fmt.Printf("provisioning %s for %s\n", s.Name, s.Owner)
			for _, e := range s.Environments {
				fmt.Printf("  %s -> %s\n", e, s.PhysicalName(username, e))
			}
			fmt.Println()

			run, err := cl.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
				ID:        "provision-" + s.Name,
				TaskQueue: platform.TaskQueue,
			}, platform.ProvisionWorkflow, in)
			if err != nil {
				return err
			}
			fmt.Printf("workflow %s started (run %s)\n", run.GetID(), run.GetRunID())
			fmt.Println("watch it: temporal workflow show -w " + run.GetID())
			fmt.Println()

			var statuses []platform.EnvStatus
			if err := run.Get(ctx, &statuses); err != nil {
				printStatuses(statuses)
				return err
			}
			printStatuses(statuses)
			return nil
		},
	}

	c.Flags().StringVarP(&file, "file", "f", "", "spec file to apply")
	_ = c.MarkFlagRequired("file")
	addIdentityFlags(c)
	return c
}

func printStatuses(statuses []platform.EnvStatus) {
	if len(statuses) == 0 {
		return
	}
	fmt.Printf("%-9s %-28s %s\n", "ENV", "NAMESPACE", "CREDENTIAL")
	for _, s := range statuses {
		if !s.OK {
			fmt.Printf("%-9s %-28s failed: %s\n", s.Env, dash(s.NamespaceID), s.Error)
			continue
		}
		fmt.Printf("%-9s %-28s %s\n", s.Env, s.NamespaceID, s.VaultPath)
	}
	fmt.Println()
	fmt.Println("The credential column is a Vault path, not a key. That is the point:")
	fmt.Println("the token never entered the workflow's event history.")
}

func dash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}
