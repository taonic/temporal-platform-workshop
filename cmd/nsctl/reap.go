package main

import (
	"fmt"
	"time"

	"github.com/spf13/cobra"

	"github.com/taonic/temporal-platform-workshop/internal/platform"
)

// reapCmd drives the reaper.
//
// The extend and revoke signals are lifted straight from the training portal's
// invitation workflow, for the same reason it has them: somebody always needs
// another hour, and somebody always needs to be cut off early.
func reapCmd() *cobra.Command {
	c := &cobra.Command{Use: "reap", Short: "Collect a participant's namespaces and return their slot"}

	extend := &cobra.Command{
		Use:   "extend <hours>",
		Short: "Give this participant more time",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			var hours int
			if _, err := fmt.Sscanf(args[0], "%d", &hours); err != nil || hours <= 0 {
				return fmt.Errorf("hours must be a positive number, got %q", args[0])
			}
			return signalReaper(cmd, platform.SignalExtend, platform.ExtendRequest{Seconds: hours * 3600},
				fmt.Sprintf("extended by %dh", hours))
		},
	}
	addIdentityFlags(extend)

	now := &cobra.Command{
		Use:   "now",
		Short: "Reap immediately: destroy the namespaces and release the slot",
		RunE: func(cmd *cobra.Command, _ []string) error {
			return signalReaper(cmd, platform.SignalRevoke, nil, "reaping now")
		},
	}
	addIdentityFlags(now)

	status := &cobra.Command{
		Use:   "status",
		Short: "What the reaper is tracking and when it fires",
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

			resp, err := cl.QueryWorkflow(ctx, platform.ReaperWorkflowID(participant), "", platform.QueryReaper)
			if err != nil {
				return err
			}
			var st platform.ReaperStatus
			if err := resp.Get(&st); err != nil {
				return err
			}
			fmt.Printf("participant %s   slot %d\n", st.Participant, st.Slot)
			fmt.Printf("deadline     %s (in %s)\n", st.Deadline.Format(time.RFC3339),
				time.Until(st.Deadline).Round(time.Minute))
			fmt.Printf("tracking     %v\n", st.Tracking)
			return nil
		},
	}
	addIdentityFlags(status)

	c.AddCommand(extend, now, status)
	return c
}

func signalReaper(cmd *cobra.Command, name string, arg any, msg string) error {
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

	if err := cl.SignalWorkflow(ctx, platform.ReaperWorkflowID(participant), "", name, arg); err != nil {
		return err
	}
	fmt.Printf("%s: %s\n", participant, msg)
	return nil
}
