package platform

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/workflow"
)

// SlotPoolWorkflowID is the singleton slot pool.
const SlotPoolWorkflowID = "slot-pool"

const (
	UpdateLease   = "lease"
	SignalRelease = "release"
	QueryPool     = "pool"
)

// Slots exist because Temporal Cloud reserves a namespace name after deletion.
//
// A name derived from a participant id -- ws-<participant>-orders-prod -- burns
// that name permanently the first time the namespace is deleted, and a self-paced
// track deletes namespaces constantly. So names are derived from a small integer
// leased from this pool instead: slot 7 is reused by design, and
// reserved-after-deletion stops mattering.
type SlotPoolInput struct {
	Capacity int `json:"capacity"`
}

type LeaseRequest struct {
	Participant string `json:"participant"`
}

type LeaseResponse struct {
	Slot int `json:"slot"`
}

type PoolStatus struct {
	Capacity int            `json:"capacity"`
	Leases   map[string]int `json:"leases"`
	Free     int            `json:"free"`
}

// SlotPoolWorkflow hands out and takes back slots.
//
// The seat-cap lesson from the training portal applies here too: the check and the
// assignment happen inside one update handler, so two participants arriving at the
// same instant cannot both take the last slot. There is no database and no lock --
// the workflow is the datastore, and single-threaded execution is the mutex.
func SlotPoolWorkflow(ctx workflow.Context, in SlotPoolInput) error {
	if in.Capacity <= 0 {
		in.Capacity = 20
	}

	leases := map[string]int{} // participant -> slot

	if err := workflow.SetQueryHandler(ctx, QueryPool, func() (PoolStatus, error) {
		copied := make(map[string]int, len(leases))
		for k, v := range leases {
			copied[k] = v
		}
		return PoolStatus{Capacity: in.Capacity, Leases: copied, Free: in.Capacity - len(copied)}, nil
	}); err != nil {
		return err
	}

	if err := workflow.SetUpdateHandler(ctx, UpdateLease,
		func(ctx workflow.Context, req LeaseRequest) (LeaseResponse, error) {
			if req.Participant == "" {
				return LeaseResponse{}, fmt.Errorf("participant is required")
			}
			// Idempotent: sandbox setup retries, and a participant who already has
			// a slot must get the same one back or their namespaces change name.
			if slot, ok := leases[req.Participant]; ok {
				return LeaseResponse{Slot: slot}, nil
			}

			taken := map[int]bool{}
			for _, s := range leases {
				taken[s] = true
			}
			for slot := 1; slot <= in.Capacity; slot++ {
				if !taken[slot] {
					leases[req.Participant] = slot
					workflow.GetLogger(ctx).Info("leased slot", "slot", slot, "participant", req.Participant)
					return LeaseResponse{Slot: slot}, nil
				}
			}
			return LeaseResponse{}, fmt.Errorf(
				"no free slots: %d of %d in use. Raise capacity or let the reaper collect abandoned sandboxes",
				len(leases), in.Capacity)
		}); err != nil {
		return err
	}

	releaseCh := workflow.GetSignalChannel(ctx, SignalRelease)

	for {
		if workflow.GetInfo(ctx).GetCurrentHistoryLength() > historyLimit {
			// Leases survive continue-as-new by travelling in the input.
			return workflow.NewContinueAsNewError(ctx, SlotPoolWorkflow, SlotPoolInput{Capacity: in.Capacity})
		}

		var released LeaseRequest
		gotRelease := false

		// Selecting on ctx.Done() as well as the channel is what makes a singleton
		// like this shut down cleanly. Receiving on a cancelled context would
		// otherwise spin.
		sel := workflow.NewSelector(ctx)
		sel.AddReceive(releaseCh, func(c workflow.ReceiveChannel, _ bool) {
			c.Receive(ctx, &released)
			gotRelease = true
		})
		sel.AddReceive(ctx.Done(), func(workflow.ReceiveChannel, bool) {})
		sel.Select(ctx)

		if ctx.Err() != nil {
			workflow.GetLogger(ctx).Info("slot pool shutting down", "held", len(leases))
			return nil
		}
		if gotRelease && released.Participant != "" {
			delete(leases, released.Participant)
			workflow.GetLogger(ctx).Info("released slot", "participant", released.Participant)
		}
	}
}

// LeaseTimeout bounds how long the CLI waits for a slot.
const LeaseTimeout = 30 * time.Second
