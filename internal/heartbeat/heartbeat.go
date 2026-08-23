// Package heartbeat keeps a long activity alive and, just as importantly, makes
// it cancellable.
//
// Ported from temporal-terraform-demo. A terraform apply can run for minutes; if
// it does not heartbeat, the server cannot tell a slow apply from a dead worker,
// and -- the part people forget -- an activity that never heartbeats never learns
// it has been cancelled. Cancellation is delivered on the heartbeat response.
package heartbeat

import (
	"context"
	"time"

	"go.temporal.io/sdk/activity"
)

// Begin starts heartbeating every interval and returns a context that is
// cancelled when the server asks the activity to stop. Always defer the cancel.
//
// The returned context is what you must hand to anything that should die with
// the activity -- notably the terraform subprocess.
func Begin(ctx context.Context, interval time.Duration) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(ctx)

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				activity.RecordHeartbeat(ctx)
			}
		}
	}()

	return ctx, cancel
}

// Detailed heartbeats a single progress line. The reconciler streams terraform's
// stdout through this, which is why a student can watch an apply progress from
// the Temporal UI instead of guessing whether it hung.
func Detailed(ctx context.Context, detail string) {
	activity.RecordHeartbeat(ctx, detail)
}
