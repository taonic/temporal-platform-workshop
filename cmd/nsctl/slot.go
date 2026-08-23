package main

import (
	"fmt"
	"time"

	"github.com/spf13/cobra"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/client"

	"github.com/taonic/temporal-platform-workshop/internal/platform"
)

// slotCmd leases and releases slots.
//
// Slots exist because Temporal Cloud reserves a namespace name after deletion. A
// name derived from a participant id burns that name the first time the namespace
// is deleted; a name derived from a leased integer is reusable by design.
func slotCmd() *cobra.Command {
	c := &cobra.Command{Use: "slot", Short: "Lease, release and inspect namespace-name slots"}

	lease := &cobra.Command{
		Use:   "lease",
		Short: "Lease a slot for this participant (idempotent)",
		RunE: func(cmd *cobra.Command, _ []string) error {
			participant, _, err := identity(cmd)
			if err != nil {
				return err
			}
			capacity, _ := cmd.Flags().GetInt("capacity")

			cl, err := dial()
			if err != nil {
				return err
			}
			defer cl.Close()

			ctx, cancel := withTimeout(platform.LeaseTimeout)
			defer cancel()

			// Update-with-start: the pool is created by whoever needs it first, and
			// the lease is answered in the same round trip. The check and the
			// assignment happen inside one update handler, so two participants
			// arriving together cannot both take the last slot.
			handle, err := cl.UpdateWithStartWorkflow(ctx, client.UpdateWithStartWorkflowOptions{
				StartWorkflowOperation: cl.NewWithStartWorkflowOperation(
					client.StartWorkflowOptions{
						ID:                       platform.SlotPoolWorkflowID,
						TaskQueue:                platform.TaskQueue,
						WorkflowIDConflictPolicy: enumspb.WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING,
					},
					platform.SlotPoolWorkflow, platform.SlotPoolInput{Capacity: capacity},
				),
				UpdateOptions: client.UpdateWorkflowOptions{
					WorkflowID:   platform.SlotPoolWorkflowID,
					UpdateName:   platform.UpdateLease,
					Args:         []any{platform.LeaseRequest{Participant: participant}},
					WaitForStage: client.WorkflowUpdateStageCompleted,
				},
			})
			if err != nil {
				return err
			}

			var resp platform.LeaseResponse
			if err := handle.Get(ctx, &resp); err != nil {
				return err
			}
			// Printed bare so the sandbox script can do WORKSHOP_SLOT=$(nsctl slot lease)
			fmt.Println(resp.Slot)
			return nil
		},
	}
	lease.Flags().Int("capacity", 20, "pool size, only used when creating the pool")
	addIdentityFlags(lease)

	release := &cobra.Command{
		Use:   "release",
		Short: "Return this participant's slot to the pool",
		RunE: func(cmd *cobra.Command, _ []string) error {
			participant, _, err := identity(cmd)
			if err != nil {
				return err
			}
			cl, err := dial()
			if err != nil {
				return err
			}
			defer cl.Close()

			ctx, cancel := withTimeout(20 * time.Second)
			defer cancel()

			if err := cl.SignalWorkflow(ctx, platform.SlotPoolWorkflowID, "",
				platform.SignalRelease, platform.LeaseRequest{Participant: participant}); err != nil {
				return err
			}
			fmt.Printf("released %s\n", participant)
			return nil
		},
	}
	addIdentityFlags(release)

	status := &cobra.Command{
		Use:   "status",
		Short: "Who holds which slot",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cl, err := dial()
			if err != nil {
				return err
			}
			defer cl.Close()

			ctx, cancel := withTimeout(20 * time.Second)
			defer cancel()

			resp, err := cl.QueryWorkflow(ctx, platform.SlotPoolWorkflowID, "", platform.QueryPool)
			if err != nil {
				return err
			}
			var st platform.PoolStatus
			if err := resp.Get(&st); err != nil {
				return err
			}
			fmt.Printf("%d of %d slots in use\n\n", len(st.Leases), st.Capacity)
			for participant, slot := range st.Leases {
				fmt.Printf("  %-3d %s\n", slot, participant)
			}
			return nil
		},
	}

	c.AddCommand(lease, release, status)
	return c
}
